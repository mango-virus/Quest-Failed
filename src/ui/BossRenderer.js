// Renders the boss as an animated sprite. The boss's position and behaviour
// are owned by BossSystem (wander tick + fight choreography); this renderer
// just samples that state and picks the right animation each frame.
//
// State priority (highest first):
//   death  — latched on BOSS_DEFEATED_FINAL (final death, frozen forever).
//            Otherwise mirrors BossSystem._deathPoseUntil: a non-final
//            life loss plays the death anim and holds the last frame
//            for ~4s, then the boss recovers and resumes wandering. A
//            new fight or the post-wave summary clears the pose early.
//            Reading BossSystem's timestamp directly keeps the renderer
//            in lockstep with the pose — no separate flag to drift.
//   hurt   — one-shot ~300 ms whenever boss.hp drops vs last sample
//   attack — while fighting and BossSystem._bossState.action is lunge/slam
//   idle   — default; played both when stationary and while wandering
//
// Direction is derived from per-frame movement delta (4-way snap to the
// nearest cardinal). When stationary the last-seen direction is kept.
//
// Sprite size: native 64×64. Tune BOSS_SPRITE_SCALE if the boss feels too big
// or too small relative to adventurers (18-px sprites).

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { isActsEnabled, currentAct } from '../config/acts.js'
import { AbilityVfx } from './AbilityVfx.js'

// Sprites render at their native frame size × BOSS_SPRITE_SCALE. 64-frame
// sheets show at 64×SCALE, 128-frame sheets at 128×SCALE. NEAREST filtering
// on the textures (set in Preload) keeps the pixel art crisp when scaled up.
const BOSS_SPRITE_SCALE = 2.0
// Each ASCENSION grows the boss a little — a subtle "it's getting stronger"
// read. +5% per tier above the first (T1 1.00 → T4 1.15). Acts-mode only; the
// canonical/endless form never grows (see _tierScale).
const BOSS_TIER_GROWTH  = 0.05
const FALLBACK_SKIN     = 'vampire'
const HURT_FLASH_MS     = 300
// Movement gate for walk anim. Boss must move at least this many world px
// per frame to count as "walking"; anything below stays idle (so micro-jitter
// or arrival snapping doesn't flicker the anim).
const WALK_MIN_DELTA    = 0.15
// Sample window for movement detection. We can't trust a single frame —
// the boss's wander tick may not have moved it this frame even though it's
// actively walking. Compare against the position N ms ago instead.
const WALK_SAMPLE_MS    = 120
// Succubus Doppelgänger illusion decoys — translucent pink duplicates of
// the Queen that flank her during the boss fight.
const DECOY_TINT    = 0xffaad6
const DECOY_ALPHA   = 0.5
const DECOY_STEP_PX = 46

// Lerp between two 0xRRGGBB colors (k in 0..1) → packed 0xRRGGBB. Used to give
// a claimed boss the SAME cycling blue↔black flame the shadow minions wear.
function _lerpHex(a, b, k) {
  const r  = Math.round((a >> 16 & 255) + ((b >> 16 & 255) - (a >> 16 & 255)) * k)
  const g  = Math.round((a >> 8  & 255) + ((b >> 8  & 255) - (a >> 8  & 255)) * k)
  const bl = Math.round((a       & 255) + ((b       & 255) - (a       & 255)) * k)
  return (r << 16) | (g << 8) | bl
}

export class BossRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._container = null
    this._sprite    = null

    // Sprite key = the active archetype id (bossArchetypeId on the player).
    // Each id has its own sheet set loaded by Preload (see BOSS_SKINS table).
    // Fall back to FALLBACK_SKIN if the player hasn't picked yet (shouldn't
    // happen once Game has started, but keeps preview/dev paths sane).
    //
    // Evolution (KR P6 "dark ascension"): the boss wears a lesser form in the
    // early acts and grows into its canonical/ascended form as the campaign
    // escalates (Act I→T1, II→T2, III→T3, IV→T4). `_baseId` is the archetype's
    // canonical key (the bare `${id}` sheet); per-tier sheets live at
    // `${id}-t${n}` (loaded by Preload). `_spriteKey` is the *current* tier's
    // key — every texture/anim lookup below is built from it, so advancing a
    // tier is a single re-key + sprite re-texture (see _applyTier). With the
    // acts flag OFF the tier pins to canonical, so the boss looks exactly as it
    // always has — evolution is a campaign-only layer.
    this._baseId = gameState.player?.bossArchetypeId ?? FALLBACK_SKIN
    if (!scene.textures.exists(`${this._baseId}-idle`)) this._baseId = FALLBACK_SKIN
    this._ascended  = false
    this._tier      = this._computeTier()
    this._spriteKey = this._resolveSpriteKey(this._tier)

    this._facing      = 'down'
    this._currentAnim = null         // e.g. 'vampire-idle-down'
    this._lastWorldX  = null
    this._lastWorldY  = null
    this._lastHp      = null
    this._hurtUntil   = 0
    this._dead        = false        // latched on BOSS_DEFEATED_FINAL

    // Slime King — multi-entity boss fight. boss.slimes is populated by
    // BossSystem when a slime fight starts and replaced as splits happen.
    // Map<slime.id, Phaser.Sprite> so we can match sprites to slimes,
    // scale per generation, and reap sprites whose slime is gone.
    this._slimeSprites = new Map()
    this._slimeHurtUntil = new Map()   // per-slime hurt-flash timestamp
    this._slimeLastHp    = new Map()
    // Position sample for walk detection — see WALK_SAMPLE_MS comment above.
    this._sampleX     = null
    this._sampleY     = null
    this._sampleAt    = 0
    this._isMoving    = false

    // The non-final death pose is no longer tracked with a renderer-side
    // flag — _pickState reads BossSystem._deathPoseUntil directly so the
    // anim and the pose can't drift. Only the FINAL death needs a latch
    // here (BossSystem tears down shortly after, into GameOver).
    this._onFinalDeath = () => { this._dead = true }
    EventBus.on('BOSS_DEFEATED_FINAL', this._onFinalDeath)

    // Solo Leveling — when Jinwoo wins his duel he "extracts" the boss on
    // "Arise.": _shadowRevived forces the boss to STAND (overriding the death
    // pose) while it sits at 0 HP mid-outro; boss.shadowClaimed then gives it
    // the blue shadow-flame + tint for the rest of the run.
    this._shadowRevived = false
    this._claimedFlame  = null
    this._claimedTinted = false
    this._onReviveAsShadow = () => { this._shadowRevived = true }
    EventBus.on('BOSS_REVIVE_AS_SHADOW', this._onReviveAsShadow)

    // Succubus Doppelgänger — translucent illusion duplicates that flank
    // the Queen during the boss fight. Driven entirely by BossSystem's
    // SUCCUBUS_DOPPEL_* events (only ever fired for the succubus archetype),
    // so no archetype check is needed here.
    this._decoys = []
    this._onDoppelSplit   = (p) => this._syncDecoys(p?.decoys ?? 0)
    this._onDoppelShatter = () => this._shatterDecoy()
    this._onDoppelClear   = () => this._clearDecoys()
    EventBus.on('SUCCUBUS_DOPPEL_SPLIT',   this._onDoppelSplit)
    EventBus.on('SUCCUBUS_DOPPEL_SHATTER', this._onDoppelShatter)
    EventBus.on('BOSS_FIGHT_RESOLVED',     this._onDoppelClear)
  }

  update() {
    const boss = this._gameState.boss
    if (!boss || boss.worldX === undefined) return

    if (!this._container) this._build(boss)

    // Evolution: the boss's tier tracks the current act. Re-key the sprite the
    // instant it changes (act boundary, or a mid-campaign save-load landing in a
    // later act). The dramatic transformation set-piece is layered on top by
    // BOSS_ASCENDED elsewhere — this keeps the *form* correct no matter how the
    // act was reached, so the boss is never visually stuck a tier behind.
    const wantTier = this._computeTier()
    if (wantTier !== this._tier) this._applyTier(wantTier)
    // Act IV "ascended" treatment: most bosses reuse their canonical (T3) sheet
    // for T4, so a persistent dark-power aura is what makes the final form read
    // as distinct in-world (the succubus, with one sheet, wears it from act II).
    this._updateAscensionAura()
    // Elder Lich — persistent soul aura whose colour/intensity reads his soul
    // saturation (essence ÷ a scaling capacity); overflow → "Oversouled".
    this._updateSoulAura()
    // Slime King — body grows with Mass + a gooey pulsing Glow-outline aura.
    this._updateSlimeAura()
    // Beholder Eye Tyrant — pulsing violet Glow-outline aura; intensity reads
    // the act tier (more eyes open = more danger).
    this._updateBeholderAura()

    // Succubus shapeshift: while she is in bat-form (flight phase 'going'
    // or 'return') the body sprite is hidden so the bat can stand in for
    // her. The transform_out / transform_in phases keep her visible so
    // the transform-anim VFX can overlay correctly.
    const flight = this._gameState?._succubus?.flight
    const inBatForm = flight && (flight.phase === 'going' || flight.phase === 'return')
    if (this._container.visible !== !inBatForm) {
      this._container.setVisible(!inBatForm)
    }

    // Position + Y-sort against adventurers/minions.  Larger worldY
    // (further down the screen) draws on top.  Factor stays small
    // enough that all entities live below DungeonRenderer's overhead
    // layer (depth 8.7+).
    this._container.setPosition(boss.worldX, boss.worldY)
    this._container.setDepth(7 + boss.worldY * 0.0005)

    // Facing — snap to cardinal based on movement delta this frame.
    // Hysteresis: on a perfect diagonal (adx ≈ ady) floating-point jitter
    // flips which component is larger every frame, so a strict adx>ady
    // tie-break makes the boss rapidly toggle between horizontal and
    // vertical walk anims. Require one axis to dominate by AXIS_HYST
    // before switching axes; otherwise keep the existing facing's axis.
    if (this._lastWorldX !== null) {
      const dx = boss.worldX - this._lastWorldX
      const dy = boss.worldY - this._lastWorldY
      const adx = Math.abs(dx), ady = Math.abs(dy)
      const MIN = 0.05  // ignore sub-pixel jitter so direction doesn't flicker
      const AXIS_HYST = 1.15
      if (adx > MIN || ady > MIN) {
        const horizontalNow = this._facing === 'left' || this._facing === 'right'
        let goHorizontal
        if (adx > ady * AXIS_HYST)      goHorizontal = true
        else if (ady > adx * AXIS_HYST) goHorizontal = false
        else                            goHorizontal = horizontalNow
        this._facing = goHorizontal
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'down'  : 'up')
      }
    }
    this._lastWorldX = boss.worldX
    this._lastWorldY = boss.worldY

    // Walk detection — compare against an older position sample so a single
    // stationary frame between wander ticks doesn't drop us back to idle.
    const now = this._scene.time.now
    if (this._sampleX === null || now - this._sampleAt >= WALK_SAMPLE_MS) {
      if (this._sampleX !== null) {
        const sdx = boss.worldX - this._sampleX
        const sdy = boss.worldY - this._sampleY
        this._isMoving = (Math.abs(sdx) >= WALK_MIN_DELTA || Math.abs(sdy) >= WALK_MIN_DELTA)
      }
      this._sampleX  = boss.worldX
      this._sampleY  = boss.worldY
      this._sampleAt = now
    }

    // Hurt detection — fire on any HP drop.
    if (this._lastHp !== null && boss.hp < this._lastHp) {
      this._hurtUntil = this._scene.time.now + HURT_FLASH_MS
    }
    this._lastHp = boss.hp

    // Light Party duel — the boss is staged at chamber centre with the party
    // fanned BELOW it, but the upward stage-in tween leaves `_facing` stuck on
    // 'up' (movement-delta facing) so the boss idles facing away from the
    // party. Force 'down' for the whole duel so it always faces the party it's
    // fighting. (Every duel target — tank/DPS/healer slots — sits below the
    // boss, so 'down' is correct for the slam lunges too.)
    if (this._scene.bossSystem?._lightPartyDuel) this._facing = 'down'

    // Rival "Clash of Dominions" duel — the boss holds the throne (north) and
    // channels its beam at Vorzak to the south. It barely moves, so movement-delta
    // facing would leave it idling whichever way it last walked instead of squaring
    // up to its rival. Force it to face the duel opponent. (Scoped to dominion mode:
    // the Aldric duel MOVES the boss so its facing already tracks the clash, and
    // forcing face-the-foe there would spin it as Aldric orbits.)
    const _nd = this._scene.bossSystem?._nemDuel
    if (_nd?.mode === 'dominion' && _nd.adv && _nd.adv.worldX !== undefined) {
      const fdx = _nd.adv.worldX - boss.worldX
      const fdy = _nd.adv.worldY - boss.worldY
      this._facing = Math.abs(fdx) > Math.abs(fdy) ? (fdx > 0 ? 'right' : 'left')
                                                   : (fdy > 0 ? 'down'  : 'up')
    }

    // Pick state
    const state = this._pickState()
    let animKey = `${this._spriteKey}-${state}-${this._facing}`
    // Death state is the only one where a missing directional variant
    // would visibly leave the boss "stuck" in idle / attack — every
    // other state can naturally keep playing its previous anim. Fall
    // back to the down-facing death anim when the directional one
    // isn't registered (some boss skins ship a single-direction death
    // sheet); if even that's missing, freeze the current frame so the
    // boss at least visually stops instead of looping idle.
    if (state === 'death' && !this._scene.anims.exists(animKey)) {
      const fallback = `${this._spriteKey}-death-down`
      if (this._scene.anims.exists(fallback)) {
        animKey = fallback
      } else {
        // No death sheet at all — stop whatever's currently playing so
        // the boss reads as "defeated" instead of mid-attack-loop.
        if (this._currentAnim !== '__stopped__') {
          this._currentAnim = '__stopped__'
          this._sprite.stop?.()
        }
        return
      }
    }
    if (animKey !== this._currentAnim && this._scene.anims.exists(animKey)) {
      this._currentAnim = animKey
      // ignoreIfPlaying:false so a hurt mid-attack restarts cleanly.
      this._sprite.play(animKey, true)
    }

    // Solo Leveling — once the boss is alive again (next day, HP refilled) the
    // revive-override is moot; drop it so normal poses resume. The claimed
    // shadow-flame + blue tint persist for the rest of the run.
    if (this._shadowRevived && (boss.hp ?? 0) > 0) this._shadowRevived = false
    if (boss.shadowClaimed) {
      this._ensureClaimedFlame()
      this._applyClaimedTint()
      if (this._claimedFlame) {
        // Same cycling blue↔black flame tint the shadow minions wear.
        const k   = (Math.sin(this._scene.time.now / 650) + 1) / 2
        const top = _lerpHex(0x0a2a6b, 0x4aa0ff, k)   // deep-blue → bright-blue
        const bot = _lerpHex(0x02040a, 0x123a8c, k)   // near-black → deep-blue
        this._claimedFlame.setTint(top, top, bot, bot)
      }
    } else if (this._claimedFlame || this._claimedTinted) {
      // Solo Leveling — the boss broke free of Jinwoo's claim (killed him on a
      // rematch; BossSystem cleared shadowClaimed at the night boundary). Drop
      // the shadow-flame + blue tint so it renders normally again. Runs once on
      // the transition (guarded above), so it won't fight per-frame hurt tints.
      this._claimedFlame?.destroy?.(); this._claimedFlame = null
      if (this._claimedTinted) { this._sprite?.clearTint?.(); this._claimedTinted = false }
    }

    // Doppelgänger decoys trail the Queen + mirror her animation.
    this._updateDecoys(boss)

    // Slime King — render N independent slime sprites mirroring the
    // boss.slimes array (BossSystem owns the array; we just visualise).
    // While a slime fight is active, the main `_sprite` is hidden so
    // sprites don't double up at the boss's logical position.
    this._updateSlimeSprites(boss, animKey)
  }

  destroy() {
    EventBus.off('BOSS_DEFEATED_FINAL', this._onFinalDeath)
    EventBus.off('BOSS_REVIVE_AS_SHADOW', this._onReviveAsShadow)
    this._claimedFlame?.destroy?.(); this._claimedFlame = null
    EventBus.off('SUCCUBUS_DOPPEL_SPLIT',   this._onDoppelSplit)
    EventBus.off('SUCCUBUS_DOPPEL_SHATTER', this._onDoppelShatter)
    EventBus.off('BOSS_FIGHT_RESOLVED',     this._onDoppelClear)
    this._clearDecoys()
    // Slime King — reap any live slime sprites alongside the main one.
    for (const sp of this._slimeSprites.values()) sp?.destroy?.()
    this._slimeSprites.clear()
    this._slimeHurtUntil.clear()
    this._slimeLastHp.clear()
    this._ascAura = null   // destroyed with the container below
    this._soulGlow = null  // postFX on the sprite; destroyed with the container below
    this._slimeGlow = null
    this._container?.destroy()
    this._container = null
    this._sprite    = null
  }

  _pickState() {
    if (this._dead) return 'death'
    // Solo Leveling — a freshly-revived shadow boss stands instead of holding
    // its death pose (it's Jinwoo's shadow now, at 0 HP mid-outro). Auto-clears
    // in update() once the boss is alive again (next day).
    if (this._shadowRevived) return this._isMoving ? 'walk' : 'idle'
    // Death pose is owned by BossSystem: _deathPoseUntil is a ~4s
    // timestamp on a non-final life loss (collapse → recover) or
    // Infinity on the final death, cleared to 0 when a new fight starts
    // or the post-wave summary opens. The stalemate-cap win path never
    // sets it, so the boss won't death-anim while it still has HP.
    const bs = this._scene.bossSystem
    const now = this._scene.time.now
    if (bs && (bs._deathPoseUntil ?? 0) > now) return 'death'
    if (now < this._hurtUntil) return 'hurt'
    const action = this._scene.bossSystem?._bossState?.action
    // Attack — latch the pose to the attack anim's full duration so a brief
    // lunge/slam action window doesn't cut the swing short (2026-06-02; mirrors
    // the minion-side fix). Without this the boss flipped back to recover/chase/
    // idle mid-swing and the next play() interrupted the attack anim.
    if (action === 'lunge' || action === 'slam') {
      if (this._lastAtkAction !== action) {
        this._lastAtkAction = action
        const key = `${this._spriteKey}-attack-${this._facing}`
        this._attackUntil = now + (this._scene.anims.get(key)?.duration || 500)
      }
      return 'attack'
    }
    this._lastAtkAction = null
    if (now < (this._attackUntil ?? 0)) return 'attack'
    // 'chase' is BossSystem's fight-mode pursuit — boss is sprinting at the
    // adventurer, so use the run sheet. 'recover' (post-attack) and the
    // wander phase fall through to walk/idle based on actual movement.
    if (action === 'chase') return 'run'
    if (this._isMoving) return 'walk'
    return 'idle'
  }

  // Solo Leveling — attach the looping blue shadow-flame behind the boss once
  // it's been claimed (same VFX the shadow minions wear). Scaled to engulf the
  // boss sprite; sent to back so the boss renders in front.
  _ensureClaimedFlame() {
    if (this._claimedFlame || !this._container || !this._sprite) return
    if (!this._scene.textures.exists('vfx-shadow-flame')) return
    if (!this._scene.anims.exists('vfx-shadow-flame-loop')) {
      const tex = this._scene.textures.get('vfx-shadow-flame')
      if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
      this._scene.anims.create({
        key: 'vfx-shadow-flame-loop',
        frames: this._scene.anims.generateFrameNumbers('vfx-shadow-flame', { start: 0, end: 5 }),
        frameRate: 10, repeat: -1,
      })
    }
    const dsz = this._sprite.displayHeight || 96
    const Sf  = Math.max(1.6, dsz / 40)
    const flame = this._scene.add.sprite(0, -6 * Sf, 'vfx-shadow-flame', 0).setOrigin(0.5, 0.5).setScale(Sf)
    flame.anims.play('vfx-shadow-flame-loop', true)
    this._container.add(flame)
    this._container.sendToBack(flame)
    this._claimedFlame = flame
  }

  // Blue→black gradient tint, matching the extracted shadow minions.
  _applyClaimedTint() {
    if (this._claimedTinted || !this._sprite) return
    this._sprite.setTint(0x4a8bff, 0x4a8bff, 0x0a0a16, 0x0a0a16)
    this._claimedTinted = true
  }

  // ── Evolution: act-driven tier → sprite key ─────────────────────────────
  //
  // The tier the boss should be wearing now. Acts off → the canonical form (3;
  // the tier sheets aren't even loaded, so it resolves to the base sheet — the
  // boss looks exactly as it always has). Acts on → the act number (1..4).
  _computeTier() {
    if (!isActsEnabled()) return 3
    // currentAct (not the day) so the boss DOESN'T ascend during P3 overtime —
    // it grows a form only when an act is actually cleared.
    return Math.max(1, Math.min(4, currentAct(this._gameState)))
  }

  // A small sprite-scale bump per ASCENSION so the boss visibly grows as it
  // climbs the acts. Acts off → the tier pins to canonical (3) with no ascension,
  // so it returns 1 (the boss stays exactly the size it's always been in endless
  // mode). Acts on → +BOSS_TIER_GROWTH per tier above the first (T1 1.00, T2 1.05,
  // T3 1.10, T4 1.15).
  _tierScale(tier) {
    if (!isActsEnabled()) return 1
    const ascensions = Math.max(0, Math.min(3, (tier ?? 1) - 1))
    return 1 + ascensions * BOSS_TIER_GROWTH
  }

  // Resolve a tier to its texture-key base purely by sheet existence: a tier
  // with an explicit `${id}-t${n}` sheet uses it; any tier WITHOUT one (T3 for
  // most bosses, T1–T3 for the succubus, every tier when acts are off and the
  // sheets aren't loaded) falls to the bare canonical sheet. `_ascended` latches
  // on T4 — the per-archetype dark-ascension recolor — driving the aura.
  _resolveSpriteKey(tier) {
    const s = this._scene, id = this._baseId
    if (s.textures?.exists?.(`${id}-t${tier}-idle`)) {
      this._ascended = (tier >= 4)
      return `${id}-t${tier}`
    }
    this._ascended = false
    return id
  }

  // Swap to a new tier: re-key + re-texture the live sprite in place (keeps its
  // depth / position / tint), drop the cached anim so update() replays under the
  // new key, and clear slime sprites so they re-make at the new tier next tick.
  _applyTier(tier) {
    this._tier = tier
    // Grow a touch with the ascension. Done BEFORE the same-sheet early-return:
    // even when a tier reuses the canonical sheet (no re-texture), the ascension
    // still happened, so the size should still tick up.
    this._sprite?.setScale?.(BOSS_SPRITE_SCALE * this._tierScale(tier))
    const newKey = this._resolveSpriteKey(tier)
    if (newKey === this._spriteKey) return
    this._spriteKey   = newKey
    this._currentAnim = null
    if (this._sprite?.setTexture && this._scene.textures.exists(`${newKey}-idle`)) {
      this._sprite.setTexture(`${newKey}-idle`, 0)
    }
    for (const sp of this._slimeSprites.values()) sp?.destroy?.()
    this._slimeSprites.clear(); this._slimeHurtUntil.clear(); this._slimeLastHp.clear()
  }

  // Ascended (T4 / above-canonical) dark-power aura — a layered violet glow
  // behind the boss that slow-pulses, plus a faint dark rim-tint, so the final
  // form is unmistakably more menacing even when it reuses the canonical sheet.
  // The pulse is a Phaser (canvas) tween, so it never hangs preview_screenshot.
  _updateAscensionAura() {
    if (this._ascended) this._ensureAscensionAura()
    else if (this._ascAura) { this._ascAura.destroy(); this._ascAura = null }
  }

  _ensureAscensionAura() {
    if (this._ascAura || !this._container || !this._sprite) return
    const s = this._scene
    const dsz = this._sprite.displayHeight || 96
    const R = Math.max(40, dsz * 0.6)
    const g = s.add.graphics()
    // Concentric fills (outer→inner, rising alpha) fake a soft radial glow.
    const layers = [[R * 1.3, 0.05], [R, 0.09], [R * 0.66, 0.15], [R * 0.4, 0.2]]
    for (const [rad, a] of layers) { g.fillStyle(0x9a4bff, a); g.fillCircle(0, 0, rad) }
    g.setPosition(0, -dsz * 0.08)
    this._container.add(g)
    this._container.sendToBack(g)
    this._ascAura = g
    s.tweens.add({
      targets: g, scaleX: 1.14, scaleY: 1.14, alpha: 0.7,
      duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    })
  }

  // ── Elder Lich — SOUL AURA (the in-world soul tell) ──────────────────────
  // A pulsing Glow OUTLINE tracing the boss silhouette (same technique as the
  // demon's burning wreath), whose colour + strength read soul SATURATION
  // (essence ÷ a capacity that grows with act + level, so it stays a 0–100%
  // read all run). Spending Channel Souls drops essence → the outline visibly
  // dims. Past capacity → "Oversouled" overflow: searing colour, harder pulse,
  // and souls visibly leaking off him. Plus rising-wisp ambiance.
  _soulCapacity() {
    const lvl = this._gameState?.boss?.level ?? 1
    return (Balance.LICH_AURA_CAP_BASE ?? 60)
      + currentAct(this._gameState) * (Balance.LICH_AURA_CAP_PER_ACT ?? 55)
      + lvl * (Balance.LICH_AURA_CAP_PER_LEVEL ?? 7)
  }

  _updateSoulAura() {
    const isLich = this._gameState?.player?.bossArchetypeId === 'lich'
    if (!isLich || !this._container || !this._sprite) { this._clearSoulAura(); return }
    const boss = this._gameState.boss
    const ess  = boss?.soulEssence ?? 0
    const cap  = this._soulCapacity()
    const sat  = Math.max(0, Math.min(1, ess / cap))
    const overK = ess > cap ? Math.max(0, Math.min(1, (ess - cap) / cap)) : 0
    const col  = AbilityVfx.soulAuraColor(sat, overK)
    const now  = this._scene?.time?.now ?? 0
    const dsz  = this._sprite.displayHeight || 96

    // THE AURA — a pulsing Glow outline on the boss sprite (WebGL only).
    if (this._scene.renderer?.type === Phaser.WEBGL && this._sprite.postFX) {
      const p = AbilityVfx.soulGlowParams(sat, overK, now)
      if (!this._soulGlow) { try { this._soulGlow = this._sprite.postFX.addGlow(p.color, p.strength, 0, false, 0.06, 12) } catch (e) { this._soulGlow = true } }
      else if (this._soulGlow !== true) { try { this._soulGlow.color = p.color; this._soulGlow.outerStrength = p.strength } catch (e) {} }
    }

    // rising soul-fire wisps — spawn rate scales with saturation (the "alive" layer).
    const interval = 700 - 560 * sat
    if (sat > 0.04 && now - (this._soulWispAt ?? 0) >= interval) {
      this._soulWispAt = now
      AbilityVfx.spawnSoulWisp(this._scene, boss.worldX, boss.worldY, dsz, col, (7 + boss.worldY * 0.0005) + 0.5)
    }

    // Oversouled overflow — periodically a whole soul peels off and dissipates.
    if (overK > 0 && now - (this._soulLeakAt ?? 0) >= 760) {
      this._soulLeakAt = now
      const ang = now * 0.0007
      const sp = AbilityVfx?.makeSoulSprite?.(this._scene, boss.worldX + Math.cos(ang) * 18, boss.worldY - dsz * 0.2, { color: col, scale: 0.3, depth: (7 + boss.worldY * 0.0005) + 0.6, alpha: 0.85 })
      if (sp) {
        this._scene.tweens.add({ targets: sp, x: sp.x + Math.cos(ang) * 36, y: sp.y - 40 - Math.random() * 20, alpha: 0, scale: 0.18, duration: 900, ease: 'Sine.easeOut', onComplete: () => sp.destroy() })
      }
    }
  }

  _clearSoulAura() {
    if (this._soulGlow && this._soulGlow !== true && this._sprite?.postFX) {
      try { this._sprite.postFX.remove(this._soulGlow) } catch (e) {}
    }
    this._soulGlow = null
  }

  // ── Slime King — Mass body-growth + gooey Glow-outline aura ──────────────
  _updateSlimeAura() {
    const isSlime = this._gameState?.player?.bossArchetypeId === 'slime'
    if (!isSlime || !this._container || !this._sprite) { this._clearSlimeAura(); return }
    const boss = this._gameState.boss
    const mass = boss?.slimeMass ?? 0
    const cap = (Balance.SLIME_MASS_CAP_BASE ?? 40)
      + currentAct(this._gameState) * (Balance.SLIME_MASS_CAP_PER_ACT ?? 40)
      + (boss?.level ?? 1) * (Balance.SLIME_MASS_CAP_PER_LEVEL ?? 6)
    const sat = Math.max(0, Math.min(1, mass / cap))
    const now = this._scene?.time?.now ?? 0
    // body grows with Mass (on top of the tier scale).
    const baseScale = BOSS_SPRITE_SCALE * this._tierScale(this._tier)
    this._sprite.setScale?.(baseScale * (1 + sat * (Balance.SLIME_MASS_SIZE_BONUS ?? 0.45)))
    // gooey glow outline (the standard aura).
    if (this._scene.renderer?.type === Phaser.WEBGL && this._sprite.postFX) {
      const p = AbilityVfx.auraGlowParams(sat, now, 0x2e7d3a, 0x9aff7a)
      if (!this._slimeGlow) { try { this._slimeGlow = this._sprite.postFX.addGlow(p.color, p.strength, 0, false, 0.06, 11) } catch (e) { this._slimeGlow = true } }
      else if (this._slimeGlow !== true) { try { this._slimeGlow.color = p.color; this._slimeGlow.outerStrength = p.strength } catch (e) {} }
    }
  }

  _clearSlimeAura() {
    if (this._slimeGlow && this._slimeGlow !== true && this._sprite?.postFX) {
      try { this._sprite.postFX.remove(this._slimeGlow) } catch (e) {}
    }
    this._slimeGlow = null
  }

  _updateBeholderAura() {
    const isBeholder = this._gameState?.player?.bossArchetypeId === 'beholder'
    if (!isBeholder || !this._container || !this._sprite) { this._clearBeholderAura(); return }
    // Tier-scaled saturation: T1 ≈ 0.25 → T4 = 1 (more eyes open each act).
    const sat = Math.max(0, Math.min(1, currentAct(this._gameState) / 4))
    const now = this._scene?.time?.now ?? 0
    if (this._scene.renderer?.type === Phaser.WEBGL && this._sprite.postFX) {
      // violet aura: dim indigo at low tier → bright amethyst at T4.
      const p = AbilityVfx.auraGlowParams(sat, now, 0x3a2a6a, 0xc9a6ff)
      if (!this._beholderGlow) { try { this._beholderGlow = this._sprite.postFX.addGlow(p.color, p.strength, 0, false, 0.06, 11) } catch (e) { this._beholderGlow = true } }
      else if (this._beholderGlow !== true) { try { this._beholderGlow.color = p.color; this._beholderGlow.outerStrength = p.strength } catch (e) {} }
    }
  }

  _clearBeholderAura() {
    if (this._beholderGlow && this._beholderGlow !== true && this._sprite?.postFX) {
      try { this._sprite.postFX.remove(this._beholderGlow) } catch (e) {}
    }
    this._beholderGlow = null
  }

  _build(boss) {
    const s = this._scene
    const c = s.add.container(boss.worldX, boss.worldY).setDepth(8)

    // Animated sprite. Falls back to a small placeholder rect if the texture
    // didn't load (e.g. asset path typo) so the boss is still visible.
    let sprite
    if (s.textures.exists(`${this._spriteKey}-idle`)) {
      sprite = s.add.sprite(0, 0, `${this._spriteKey}-idle`, 0)
        .setOrigin(0.5, 0.5)
        .setScale(BOSS_SPRITE_SCALE * this._tierScale(this._tier))
    } else {
      sprite = s.add.rectangle(0, 0, 26, 26, 0x140820, 1)
      sprite.setStrokeStyle(2, 0xcc44ff, 1)
    }

    c.add([sprite])

    this._container = c
    this._sprite    = sprite
  }

  // ── Slime King multi-entity rendering ───────────────────────────────────
  //
  // BossSystem owns the boss.slimes array (during a slime fight) — we
  // mirror it visually. Each slime gets one sprite at its own world
  // position, scaled by generation:
  //   gen 0 → 1.00 × BOSS_SPRITE_SCALE  (original size)
  //   gen 1 → 0.70 ×                    (mid)
  //   gen 2 → 0.50 ×                    (small)
  //
  // The main `_sprite` is hidden while boss.slimes is active so we
  // don't render a phantom boss at the logical boss.worldX/Y on top of
  // the slimes. When boss.slimes empties (between fights), the main
  // sprite is restored and slime sprites are torn down.
  _generationScale(gen) {
    if (gen >= 2) return 0.5
    if (gen >= 1) return 0.7
    return 1.0
  }

  _updateSlimeSprites(boss, animKey) {
    const slimes = Array.isArray(boss?.slimes) ? boss.slimes : null
    const active = slimes && slimes.length > 0

    // No active slime fight → tear down any leftover sprites and
    // unhide the main sprite.
    if (!active) {
      if (this._slimeSprites.size === 0) {
        if (this._sprite && this._sprite.visible === false) {
          this._sprite.setVisible(true)
        }
        return
      }
      for (const sp of this._slimeSprites.values()) sp?.destroy?.()
      this._slimeSprites.clear()
      this._slimeHurtUntil.clear()
      this._slimeLastHp.clear()
      if (this._sprite && this._sprite.visible === false) {
        this._sprite.setVisible(true)
      }
      return
    }

    // Active fight — hide the primary sprite so we're not rendering it
    // ON TOP of the gen-0 slime.
    if (this._sprite && this._sprite.visible !== false) {
      this._sprite.setVisible(false)
    }

    // Build/refresh sprite per slime. Each slime now owns its absolute
    // worldX/Y (BossSystem._tickSlimes drifts them independently toward
    // their own nearest adv), so we just mirror those coords here. The
    // boss state machine reads boss.worldX/Y which gets re-derived each
    // tick as the centroid of alive slimes — that's what keeps slam /
    // lunge / attack-range checks meaningful even when the cluster
    // scatters across the chamber.
    const liveIds = new Set()
    for (const s of slimes) {
      liveIds.add(s.id)
      const sx = s.worldX ?? 0
      const sy = s.worldY ?? 0
      let sp = this._slimeSprites.get(s.id)
      if (!sp) {
        sp = this._makeSlimeSprite(s, sx, sy)
        if (!sp) continue
        this._slimeSprites.set(s.id, sp)
      }
      const scale = BOSS_SPRITE_SCALE * this._generationScale(s.generation)
      sp.setPosition(sx, sy)
      sp.setScale(scale)
      sp.setDepth(7 + sy * 0.0005)

      // Hurt flash — per-slime HP drop check.
      const prevHp = this._slimeLastHp.get(s.id)
      if (prevHp != null && (s.hp ?? 0) < prevHp) {
        this._slimeHurtUntil.set(s.id, this._scene.time.now + HURT_FLASH_MS)
      }
      this._slimeLastHp.set(s.id, s.hp ?? 0)
      const hurtUntil = this._slimeHurtUntil.get(s.id) ?? 0
      if (this._scene.time.now < hurtUntil) {
        sp.setTint(0xff8888)
      } else if (sp.tintTopLeft !== 0xffffff) {
        sp.clearTint()
      }

      // Mirror the primary boss's animation so every slime moves in
      // sync. Re-play on key change only so the per-slime sprites stay
      // mid-frame instead of restarting every tick.
      if (animKey && this._scene.anims.exists(animKey) && sp.anims?.getName?.() !== animKey) {
        sp.play(animKey, true)
      }

      // Dead slime — fade out + destroy. Skip the rest of the per-slime
      // logic for this entry; it'll be removed from boss.slimes on the
      // next tick once the death-check fires fightEnd OR it just lingers
      // visually until then.
      if ((s.hp ?? 0) <= 0 && sp.alpha > 0.05) {
        this._scene.tweens.add({
          targets: sp,
          alpha: 0,
          scaleX: scale * 1.3,
          scaleY: scale * 1.3,
          duration: 280,
          ease: 'Cubic.easeOut',
        })
      }
    }

    // Reap sprites whose slime is gone (e.g. parent removed at split).
    for (const [id, sp] of [...this._slimeSprites.entries()]) {
      if (liveIds.has(id)) continue
      sp?.destroy?.()
      this._slimeSprites.delete(id)
      this._slimeHurtUntil.delete(id)
      this._slimeLastHp.delete(id)
    }
  }

  _makeSlimeSprite(slime, worldX, worldY) {
    const s = this._scene
    const key = `${this._spriteKey}-idle`
    if (!s.textures?.exists?.(key)) return null
    const sp = s.add.sprite(worldX ?? 0, worldY ?? 0, key, 0)
      .setOrigin(0.5, 0.5)
      .setScale(BOSS_SPRITE_SCALE * this._generationScale(slime.generation ?? 0))
      .setDepth(8)
    return sp
  }

  // ── Succubus Doppelgänger illusions ─────────────────────────────────────

  // Re-split tops the decoy count back up; new decoys fade in. Shatter is
  // the only path that removes a decoy, so this only ever needs to add.
  _syncDecoys(count) {
    while (this._decoys.length < count) {
      const sp = this._makeDecoySprite()
      if (!sp) break
      this._decoys.push(sp)
      this._scene.tweens.add({
        targets: sp, alpha: DECOY_ALPHA, duration: 260, ease: 'Quad.easeOut',
      })
    }
  }

  _makeDecoySprite() {
    const s = this._scene
    if (!s.textures?.exists?.(`${this._spriteKey}-idle`)) return null
    return s.add.sprite(0, 0, `${this._spriteKey}-idle`, 0)
      .setOrigin(0.5, 0.5)
      .setScale(BOSS_SPRITE_SCALE * this._tierScale(this._tier))
      .setAlpha(0)
      .setTint(DECOY_TINT)
  }

  // Pop the outermost decoy with a shatter tween (scale-up + fade).
  _shatterDecoy() {
    const sp = this._decoys.pop()
    if (!sp) return
    if (!sp.active) { sp.destroy?.(); return }
    this._scene.tweens.add({
      targets: sp, alpha: 0,
      scaleX: BOSS_SPRITE_SCALE * 1.6, scaleY: BOSS_SPRITE_SCALE * 1.6,
      duration: 300, ease: 'Cubic.easeOut',
      onComplete: () => sp.destroy(),
    })
  }

  _clearDecoys() {
    for (const sp of this._decoys) sp?.destroy?.()
    this._decoys = []
  }

  // Each frame: fan the live decoys out to alternating sides of the Queen
  // and mirror her current animation so the whole swarm moves as one.
  _updateDecoys(boss) {
    if (this._decoys.length === 0) return
    const baseDepth = 7 + boss.worldY * 0.0005
    this._decoys.forEach((sp, i) => {
      if (!sp || !sp.active) return
      const pair = Math.floor(i / 2) + 1
      const side = i % 2 === 0 ? 1 : -1
      sp.setPosition(boss.worldX + side * DECOY_STEP_PX * pair,
                     boss.worldY - 6 + (pair % 2) * 12)
      sp.setDepth(baseDepth - 0.02)
      if (this._currentAnim &&
          this._currentAnim !== '__stopped__' &&
          this._scene.anims.exists(this._currentAnim) &&
          sp.anims?.getName?.() !== this._currentAnim) {
        sp.play(this._currentAnim, true)
      }
    })
  }
}

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

// Sprites render at their native frame size × BOSS_SPRITE_SCALE. 64-frame
// sheets show at 64×SCALE, 128-frame sheets at 128×SCALE. NEAREST filtering
// on the textures (set in Preload) keeps the pixel art crisp when scaled up.
const BOSS_SPRITE_SCALE = 2.0
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
    this._spriteKey   = gameState.player?.bossArchetypeId ?? FALLBACK_SKIN
    if (!scene.textures.exists(`${this._spriteKey}-idle`)) this._spriteKey = FALLBACK_SKIN

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
    EventBus.off('SUCCUBUS_DOPPEL_SPLIT',   this._onDoppelSplit)
    EventBus.off('SUCCUBUS_DOPPEL_SHATTER', this._onDoppelShatter)
    EventBus.off('BOSS_FIGHT_RESOLVED',     this._onDoppelClear)
    this._clearDecoys()
    // Slime King — reap any live slime sprites alongside the main one.
    for (const sp of this._slimeSprites.values()) sp?.destroy?.()
    this._slimeSprites.clear()
    this._slimeHurtUntil.clear()
    this._slimeLastHp.clear()
    this._container?.destroy()
    this._container = null
    this._sprite    = null
  }

  _pickState() {
    if (this._dead) return 'death'
    // Death pose is owned by BossSystem: _deathPoseUntil is a ~4s
    // timestamp on a non-final life loss (collapse → recover) or
    // Infinity on the final death, cleared to 0 when a new fight starts
    // or the post-wave summary opens. The stalemate-cap win path never
    // sets it, so the boss won't death-anim while it still has HP.
    const bs = this._scene.bossSystem
    if (bs && (bs._deathPoseUntil ?? 0) > this._scene.time.now) return 'death'
    if (this._scene.time.now < this._hurtUntil) return 'hurt'
    const action = this._scene.bossSystem?._bossState?.action
    if (action === 'lunge' || action === 'slam') return 'attack'
    // 'chase' is BossSystem's fight-mode pursuit — boss is sprinting at the
    // adventurer, so use the run sheet. 'recover' (post-attack) and the
    // wander phase fall through to walk/idle based on actual movement.
    if (action === 'chase') return 'run'
    if (this._isMoving) return 'walk'
    return 'idle'
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
        .setScale(BOSS_SPRITE_SCALE)
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
      .setScale(BOSS_SPRITE_SCALE)
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

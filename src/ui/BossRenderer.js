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
  }

  destroy() {
    EventBus.off('BOSS_DEFEATED_FINAL', this._onFinalDeath)
    EventBus.off('SUCCUBUS_DOPPEL_SPLIT',   this._onDoppelSplit)
    EventBus.off('SUCCUBUS_DOPPEL_SHATTER', this._onDoppelShatter)
    EventBus.off('BOSS_FIGHT_RESOLVED',     this._onDoppelClear)
    this._clearDecoys()
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

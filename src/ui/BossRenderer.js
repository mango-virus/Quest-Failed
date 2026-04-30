// Renders the boss as an animated sprite. The boss's position and behaviour
// are owned by BossSystem (wander tick + fight choreography); this renderer
// just samples that state and picks the right animation each frame.
//
// State priority (highest first):
//   death  — latched once on BOSS_DEFEATED_FINAL; sprite freezes on last frame.
//            Also triggered (non-latched) on BOSS_FIGHT_RESOLVED winner='party'
//            so each life loss plays the death anim during the result overlay,
//            cleared on the next BOSS_FIGHT_INCOMING.
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
    this._playingDeath = false       // one-shot per life loss; cleared on next fight
    // Position sample for walk detection — see WALK_SAMPLE_MS comment above.
    this._sampleX     = null
    this._sampleY     = null
    this._sampleAt    = 0
    this._isMoving    = false

    this._onFinalDeath = () => { this._dead = true }
    this._onFightResolved = ({ winner, bossHpRemaining, deathsRemaining }) => {
      // Only play death anim when the boss actually died this round
      // (hp drained to 0).  Other code paths can resolve the fight in
      // the party's favour while the boss still has hp — e.g. the
      // 24-round stalemate cap that picks a winner by hp fraction —
      // and showing the death anim there is the bug the player
      // reported ("playing death animation when it still has health").
      if (winner === 'party' && (bossHpRemaining ?? 1) <= 0) {
        this._playingDeath = true
        // Auto-revive the sprite after the 4 s linger when this isn't
        // the final death — keeps render and BossSystem's wander gate
        // (also 4 s) in sync so the boss collapses, stays planted on
        // the last frame, then springs back up to idle for the next
        // party.  Final death (deathsRemaining <= 0) latches via
        // `_dead` and overrides _playingDeath, so no auto-clear.
        const isFinal = (deathsRemaining ?? 0) <= 0
        if (!isFinal) {
          this._scene.time.delayedCall(4000, () => {
            // Guard against a fight starting inside the linger window
            // (BOSS_FIGHT_INCOMING already cleared the flag).
            if (this._playingDeath) this._playingDeath = false
          })
        }
      }
    }
    this._onFightIncoming = () => { this._playingDeath = false }
    EventBus.on('BOSS_DEFEATED_FINAL', this._onFinalDeath)
    EventBus.on('BOSS_FIGHT_RESOLVED', this._onFightResolved)
    EventBus.on('BOSS_FIGHT_INCOMING', this._onFightIncoming)
  }

  update() {
    const boss = this._gameState.boss
    if (!boss || boss.worldX === undefined) return

    if (!this._container) this._build(boss)

    // Position
    this._container.setPosition(boss.worldX, boss.worldY)

    // Facing — snap to cardinal based on movement delta this frame.
    if (this._lastWorldX !== null) {
      const dx = boss.worldX - this._lastWorldX
      const dy = boss.worldY - this._lastWorldY
      const adx = Math.abs(dx), ady = Math.abs(dy)
      const MIN = 0.05  // ignore sub-pixel jitter so direction doesn't flicker
      if (adx > MIN || ady > MIN) {
        this._facing = (adx > ady)
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
    const animKey = `${this._spriteKey}-${state}-${this._facing}`
    if (animKey !== this._currentAnim && this._scene.anims.exists(animKey)) {
      this._currentAnim = animKey
      // ignoreIfPlaying:false so a hurt mid-attack restarts cleanly.
      this._sprite.play(animKey, true)
    }
  }

  destroy() {
    EventBus.off('BOSS_DEFEATED_FINAL', this._onFinalDeath)
    EventBus.off('BOSS_FIGHT_RESOLVED', this._onFightResolved)
    EventBus.off('BOSS_FIGHT_INCOMING', this._onFightIncoming)
    this._container?.destroy()
    this._container = null
    this._sprite    = null
  }

  _pickState() {
    if (this._dead || this._playingDeath) return 'death'
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
}

// Renders the Succubus boss's shapeshift choreography (her day-phase VFX):
//
//   1. Boss transform   — when a flight starts (TRANSFORM_OUT) or ends
//      (TRANSFORM_IN), a one-shot `succubus-transform-{left|right}` sprite
//      is layered on the boss with a `succubus-transform-smoke-puff`
//      underneath it. Both sized to match the boss's body scale (2.0×).
//   2. Bat-form flight  — a Phaser sprite playing the directional bat
//      animation (succubus-bat-{ld|rd|lu|ru}) tweens between
//      gameState._succubus.flight.{fromX, fromY} → {toX, toY}. Visible
//      only during the 'going' and 'return' phases so the transform
//      sequence reads boss → smoke → bat (and bat → smoke → boss on
//      return). BossRenderer hides the body sprite during those phases.
//
// The "charmed adventurer" VFX (the apply burst + the persistent thrall aura)
// moved to CharmVfxRenderer (2026-06-09) — it's boss-aware (succubus seduction
// hearts vs vampire blood thrall), so it can't live in a succubus-only renderer.

import { EventBus } from '../systems/EventBus.js'

// Match BossRenderer's BOSS_SPRITE_SCALE so the transform anim + smoke
// puff visually replace the boss at the same physical footprint.
const BOSS_SCALE = 2.0
const BAT_SCALE  = 2.0

export class SuccubusBatRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._batSprite     = null   // active bat sprite during a flight
    this._batPhase      = null   // tracks last-applied flight phase for direction re-pick
    this._transformFx   = []     // one-shot sprites currently animating

    this._onTransformOut  = this._onTransformOut.bind(this)
    this._onTransformIn   = this._onTransformIn.bind(this)
    this._onFlightEnded   = this._onFlightEnded.bind(this)
    EventBus.on('SUCCUBUS_TRANSFORM_OUT',  this._onTransformOut)
    EventBus.on('SUCCUBUS_TRANSFORM_IN',   this._onTransformIn)
    EventBus.on('SUCCUBUS_FLIGHT_ENDED',   this._onFlightEnded)
  }

  destroy() {
    EventBus.off('SUCCUBUS_TRANSFORM_OUT',  this._onTransformOut)
    EventBus.off('SUCCUBUS_TRANSFORM_IN',   this._onTransformIn)
    EventBus.off('SUCCUBUS_FLIGHT_ENDED',   this._onFlightEnded)
    this._destroyBat()
    for (const o of this._transformFx) o?.destroy?.()
    this._transformFx = []
  }

  // ── Bat sprite ──────────────────────────────────────────────────────────

  _destroyBat() {
    this._batSprite?.destroy?.()
    this._batSprite = null
    this._batPhase  = null
  }

  // Pick the bat anim direction from a flight vector. Sheet rows:
  //   0 = LD (left + down)   1 = RD (right + down)
  //   2 = LU (left + up)     3 = RU (right + up)
  _batDirKey(dx, dy) {
    const right = dx >= 0
    const down  = dy >= 0
    if (down)  return right ? 'rd' : 'ld'
    return     right ? 'ru' : 'lu'
  }

  _ensureBatSprite() {
    if (this._batSprite && this._batSprite.scene) return this._batSprite
    if (!this._scene.textures.exists('succubus-bat')) return null
    const s = this._scene.add.sprite(0, 0, 'succubus-bat').setDepth(50)
    s.setScale(BAT_SCALE)
    this._batSprite = s
    this._batPhase  = null
    return s
  }

  _onTransformOut(payload) {
    // Boss is going TO bat-form: smoke + transform on the boss, bat not yet shown
    const x = payload?.bossX, y = payload?.bossY
    if (x == null || y == null) return
    this._spawnTransformFx(x, y, payload?.dx ?? 0)
  }

  _onTransformIn(payload) {
    // Boss is coming BACK from bat-form: smoke + transform on the boss
    // again. Bat is hidden by the per-frame phase check in _updateBat.
    const x = payload?.bossX, y = payload?.bossY
    if (x == null || y == null) return
    this._spawnTransformFx(x, y, 0)
  }

  _onFlightEnded() {
    this._destroyBat()
  }

  // ── Per-frame update ────────────────────────────────────────────────────

  update() {
    const now = this._scene.time?.now ?? 0
    this._updateBat(now)
  }

  _updateBat(now) {
    const f = this._gameState?._succubus?.flight
    // Bat visible only during the actual flight phases. transform_out /
    // transform_in keep the bat hidden so the boss-side transform reads
    // cleanly (boss → transform → smoke → bat).
    const flying = f && (f.phase === 'going' || f.phase === 'return')
    if (!flying) {
      if (this._batSprite) this._destroyBat()
      return
    }
    const sprite = this._ensureBatSprite()
    if (!sprite) return

    // Track live destination per phase so the bat actually meets its
    // target instead of flying to where they / the boss USED to be 1.5 s
    // ago. Outbound chases the adv; return chases the boss (who wanders
    // her chamber during the day). Mirror the live value back to f.toX/Y
    // so BossArchetypeSystem's phase transitions read the up-to-date
    // arrival point — return-leg start, transform_in VFX position, etc.
    let toX = f.toX, toY = f.toY
    if (f.phase === 'going' && f.targetId) {
      const target = this._gameState.adventurers?.active?.find(a => a.instanceId === f.targetId)
      if (target && (target.resources?.hp ?? 0) > 0) {
        toX = target.worldX ?? toX
        toY = target.worldY ?? toY
        f.toX = toX
        f.toY = toY
      }
    } else if (f.phase === 'return') {
      const boss = this._gameState.boss
      if (boss && boss.worldX != null) {
        toX = boss.worldX
        toY = boss.worldY
        f.toX = toX
        f.toY = toY
        // Also keep the pinned bossX/Y current so the transform_in event
        // emitted at the end of `return` lands at the live boss position.
        f.bossX = boss.worldX
        f.bossY = boss.worldY
      }
    }

    const t = Math.max(0, Math.min(1, (now - f.startedAt) / Math.max(1, f.until - f.startedAt)))
    const x = f.fromX + (toX - f.fromX) * t
    const y = f.fromY + (toY - f.fromY) * t
    sprite.x = x
    sprite.y = y - 4

    // Re-pick direction whenever the flight phase flips so the bat faces
    // its travel vector throughout going + return.
    if (this._batPhase !== f.phase) {
      this._batPhase = f.phase
      const dir = this._batDirKey(toX - f.fromX, toY - f.fromY)
      const animKey = 'succubus-bat-' + dir
      if (this._scene.anims.exists(animKey)) sprite.play(animKey)
    }
  }

  // ── Boss transform overlay (sprite + smoke) ─────────────────────────────

  // Spawns one-shot smoke puff + transform sprite at (x,y). `dx` < 0 means
  // the target is to the LEFT, so play the left-facing transform; >= 0
  // plays right-facing. Both auto-destroy when their anims finish.
  _spawnTransformFx(x, y, dx) {
    // Smoke — over the transform sprite so it visibly veils her as she
    // morphs. Centered on her body (no vertical offset) so the puff
    // covers the whole figure rather than just the feet.
    if (this._scene.textures.exists('succubus-transform-smoke')) {
      const smoke = this._scene.add.sprite(x, y, 'succubus-transform-smoke').setDepth(50)
      smoke.setScale(BOSS_SCALE)
      this._transformFx.push(smoke)
      const sk = 'succubus-transform-smoke-puff'
      if (this._scene.anims.exists(sk)) {
        smoke.play(sk)
        smoke.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + sk, () => {
          const i = this._transformFx.indexOf(smoke)
          if (i >= 0) this._transformFx.splice(i, 1)
          smoke.destroy()
        })
      } else {
        smoke.destroy()
      }
    }
    // Transform sprite — under the smoke, on the boss
    if (this._scene.textures.exists('succubus-transform')) {
      const tr = this._scene.add.sprite(x, y, 'succubus-transform').setDepth(48)
      tr.setScale(BOSS_SCALE)
      this._transformFx.push(tr)
      const tk = 'succubus-transform-' + (dx < 0 ? 'left' : 'right')
      if (this._scene.anims.exists(tk)) {
        tr.play(tk)
        tr.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + tk, () => {
          const i = this._transformFx.indexOf(tr)
          if (i >= 0) this._transformFx.splice(i, 1)
          tr.destroy()
        })
      } else {
        tr.destroy()
      }
    }
  }

}

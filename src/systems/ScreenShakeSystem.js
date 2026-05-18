// ScreenShakeSystem — kinetic feedback on impactful events. Listens to a
// curated set of events and calls `cameras.main.shake()` on the world
// camera (the Game scene's camera). The HUD scene runs its own camera so
// chrome stays rock-steady while the dungeon view shakes.
//
// Three intensities:
//   small  — single crit / single ranged hit that crossed the damage gate
//   medium — Beholder Petrify, Lich Phylactery destroyed
//   big    — Golem Earthquake (single big WHAM per fire)
//
// Throttled at SHAKE_MIN_GAP_MS so a flurry of crits doesn't fuse into a
// continuous buzz that loses meaning. Master toggle:
// Balance.VFX_SCREEN_SHAKE_ENABLED.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

const SHAKE_MIN_GAP_MS = 80

// Damage gate for COMBAT_HIT non-crit shake. Below this, hits are normal
// chip damage and don't deserve a kinetic beat (HitSparkSystem already
// shows them). Above it, the hit was a real chunk and the camera reacts.
const BIG_HIT_DAMAGE_GATE = 25

const PROFILES = {
  small:  { durationMs: 90,  intensity: 0.0025 },
  medium: { durationMs: 160, intensity: 0.005  },
  big:    { durationMs: 260, intensity: 0.010  },
}

export class ScreenShakeSystem {
  constructor(scene) {
    this._scene     = scene
    this._lastShake = 0
    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('COMBAT_HIT',                this._onCombatHit)
    on('GOLEM_EARTHQUAKE_FIRED',    this._onBig)
    on('BEHOLDER_PETRIFY_FIRED',    this._onMedium)
    on('PACT_BOSS_PETRIFY_FIRED',   this._onMedium)
    on('PHYLACTERY_DESTROYED',      this._onMedium)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
  }

  _shake(level) {
    if (!Balance.VFX_SCREEN_SHAKE_ENABLED) return
    const now = this._scene.time?.now ?? 0
    if (now - this._lastShake < SHAKE_MIN_GAP_MS) return
    const cam = this._scene._cam ?? this._scene.cameras?.main
    if (!cam?.shake) return
    const p = PROFILES[level] ?? PROFILES.small
    cam.shake(p.durationMs, p.intensity)
    this._lastShake = now
  }

  _onCombatHit({ damage, isCritical } = {}) {
    if (typeof damage !== 'number' || damage <= 0) return
    if (!isCritical && damage < BIG_HIT_DAMAGE_GATE) return
    this._shake('small')
  }

  _onMedium() { this._shake('medium') }
  _onBig()    { this._shake('big')    }
}

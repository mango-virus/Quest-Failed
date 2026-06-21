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
import { userSettings } from '../hud/userSettings.js'

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

  // Public entry so other systems (e.g. CombatJuiceSystem) can request a shake
  // that still respects the master toggle, the user setting, and the throttle.
  shake(level) { this._shake(level) }

  _shake(level) {
    const p = PROFILES[level] ?? PROFILES.small
    this._shakeCustom(p.durationMs, p.intensity)
  }

  // Shared, guarded entry — both the discrete `_shake(level)` profiles and the
  // continuous damage-scaled combat shake route through here so the master
  // toggle, user setting, throttle, and camera lookup live in one place.
  _shakeCustom(durationMs, intensity) {
    if (!Balance.VFX_SCREEN_SHAKE_ENABLED) return
    if (!userSettings.isShakeEnabled()) return
    const now = this._scene.time?.now ?? 0
    if (now - this._lastShake < SHAKE_MIN_GAP_MS) return
    const cam = this._scene._cam ?? this._scene.cameras?.main
    if (!cam?.shake) return
    cam.shake(durationMs, intensity)
    this._lastShake = now
  }

  _onCombatHit({ damage, isCritical, sourceId, targetId } = {}) {
    if (typeof damage !== 'number' || damage <= 0) return
    if (!isCritical && damage < BIG_HIT_DAMAGE_GATE) return
    // Suppress shake whenever a minion is on either side of the hit. At
    // high minion counts in late game the constant low-grade quaking
    // from minion-vs-adv combat reads as noise — boss/trap/archetype-
    // ability hits (Petrify, Earthquake, etc.) and pure adv-vs-boss
    // damage are still shake-eligible. Source-string ids ('boss',
    // 'tremor', 'venom', etc.) don't match any minion instanceId, so
    // they're untouched by this filter.
    const minions = this._scene.gameState?.minions
    if (Array.isArray(minions) && minions.length > 0) {
      for (const m of minions) {
        if (m.instanceId === sourceId || m.instanceId === targetId) return
      }
    }
    // Scale the kinetic beat with the SIZE of the hit so a monster crit reads
    // bigger than a chip crit — continuous, clamped between the small and
    // medium profiles. (A lightweight "trauma" curve without owning a custom
    // per-frame camera offset, which would fight Game._clampCameraToPlayArea.)
    const lo = PROFILES.small.intensity
    const hi = PROFILES.medium.intensity
    const t  = Math.min(1, damage / 120)   // ~120 dmg → full medium intensity
    this._shakeCustom(PROFILES.small.durationMs, lo + (hi - lo) * t)
  }

  _onMedium() { this._shake('medium') }
  _onBig()    { this._shake('big')    }
}

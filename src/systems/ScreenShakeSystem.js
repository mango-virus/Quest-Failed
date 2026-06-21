// ScreenShakeSystem — kinetic feedback on impactful events.
//
// TRAUMA MODEL (default, Balance.VFX_SHAKE_TRAUMA): events add to a 0..1
// `_trauma` accumulator that DECAYS over real time; each frame the camera is
// shaken with intensity = trauma² (squared → big dynamic range: a lone chip
// crit barely wobbles, a whole party wailing on the boss builds a real quake,
// the Golem Earthquake slams). The square is the standard game-feel trauma
// curve (Squirrel Eiserloh, GDC 2016) — it stops minor hits from washing out
// the heavy beats. Shake is biased per-axis toward the impact direction so a
// horizontal blow reads horizontal.
//
// Driven through Phaser's built-in `cam.shake()` (re-issued each frame with
// force=true). That effect applies its offset in the camera's render matrix
// AFTER scroll is set, so it coexists cleanly with Game._clampCameraToPlayArea
// (which writes scrollX/scrollY every frame) — a custom scroll offset would be
// clobbered by that clamp.
//
// The HUD scene runs its own camera, so chrome stays rock-steady while the
// dungeon view shakes. Master toggle Balance.VFX_SCREEN_SHAKE_ENABLED + the
// per-player userSettings.isShakeEnabled().
//
// Flip Balance.VFX_SHAKE_TRAUMA=false to fall back to the legacy discrete
// small/medium/big profiles (fire-and-forget cam.shake per event).

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'
import { userSettings } from '../hud/userSettings.js'

const SHAKE_MIN_GAP_MS = 80

// Damage gate for COMBAT_HIT non-crit shake. Below this, hits are normal
// chip damage and don't deserve a kinetic beat (HitSparkSystem already
// shows them). Above it, the hit was a real chunk and the camera reacts.
const BIG_HIT_DAMAGE_GATE = 25

// Legacy discrete profiles — used only when VFX_SHAKE_TRAUMA is off.
const PROFILES = {
  small:  { durationMs: 90,  intensity: 0.0025 },
  medium: { durationMs: 160, intensity: 0.005  },
  big:    { durationMs: 260, intensity: 0.010  },
}

// ── Trauma-model tuning ──────────────────────────────────────────────────────
// How much trauma a discrete-level request (boss slam, petrify, earthquake)
// adds. Combat hits compute their own amount from damage.
const LEVEL_TRAUMA       = { small: 0.22, medium: 0.45, big: 0.78 }
const TRAUMA_DECAY_PER_S = 1.7      // trauma fully bleeds off in ~0.6s
const SHAKE_MAX_INTENSITY = 0.012   // camera shake intensity at trauma = 1
const SHAKE_FRAME_MS      = 60      // per-frame shake burst length (re-issued)

export class ScreenShakeSystem {
  constructor(scene) {
    this._scene     = scene
    this._lastShake = 0
    this._trauma    = 0
    this._biasX     = 1   // per-axis emphasis from the last impact direction
    this._biasY     = 1
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

  // Public entry so other systems (CombatJuiceSystem, MomentVfxSystem) can
  // request a discrete-level shake that still respects the master toggle, the
  // user setting, and (in legacy mode) the throttle.
  shake(level) {
    if (this._traumaMode()) this._addTrauma(LEVEL_TRAUMA[level] ?? LEVEL_TRAUMA.small)
    else                    this._shake(level)
  }

  _traumaMode() { return Balance.VFX_SHAKE_TRAUMA !== false }
  _enabled()    { return !!Balance.VFX_SCREEN_SHAKE_ENABLED && userSettings.isShakeEnabled() }

  // ── Trauma model ───────────────────────────────────────────────────────────

  _addTrauma(amount, biasX = 1, biasY = 1) {
    if (!this._enabled() || !(amount > 0)) return
    this._trauma = Math.min(1, this._trauma + amount)
    this._biasX  = biasX
    this._biasY  = biasY
  }

  // Per-frame tick (called from Game.update with the REAL frame delta, so shake
  // decays in wall-clock time regardless of the day-phase fast-forward speed).
  update(delta) {
    if (!this._traumaMode() || this._trauma <= 0) return
    if (!this._enabled()) { this._trauma = 0; return }
    const dt = Math.min(0.05, (delta ?? 16) / 1000)
    this._trauma = Math.max(0, this._trauma - TRAUMA_DECAY_PER_S * dt)
    const cam = this._scene._cam ?? this._scene.cameras?.main
    if (!cam?.shake) return
    const s = this._trauma * this._trauma            // trauma² → punchy range
    const base = s * SHAKE_MAX_INTENSITY
    if (base < 0.0002) return
    // Vector2 intensity = per-axis directional bias (Phaser 3.60+). force=true
    // so re-issuing each frame restarts the burst instead of being ignored.
    cam.shake(SHAKE_FRAME_MS, { x: base * this._biasX, y: base * this._biasY }, true)
  }

  // ── Legacy discrete fallback ────────────────────────────────────────────────

  _shake(level) {
    const p = PROFILES[level] ?? PROFILES.small
    this._shakeCustom(p.durationMs, p.intensity)
  }

  // Shared, guarded entry for the discrete path — master toggle, user setting,
  // throttle, and camera lookup live in one place.
  _shakeCustom(durationMs, intensity) {
    if (!this._enabled()) return
    const now = this._scene.time?.now ?? 0
    if (now - this._lastShake < SHAKE_MIN_GAP_MS) return
    const cam = this._scene._cam ?? this._scene.cameras?.main
    if (!cam?.shake) return
    cam.shake(durationMs, intensity)
    this._lastShake = now
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  _onCombatHit({ damage, isCritical, sourceId, targetId } = {}) {
    if (typeof damage !== 'number' || damage <= 0) return
    if (!isCritical && damage < BIG_HIT_DAMAGE_GATE) return
    // Suppress whenever a minion is on either side of the hit. At high minion
    // counts in late game the constant low-grade quaking from minion-vs-adv
    // combat reads as noise — boss/trap/archetype-ability hits (string source
    // ids like 'boss'/'tremor') don't match a minion instanceId, so they pass.
    const minions = this._scene.gameState?.minions
    if (Array.isArray(minions) && minions.length > 0) {
      for (const m of minions) {
        if (m.instanceId === sourceId || m.instanceId === targetId) return
      }
    }
    if (this._traumaMode()) {
      // Trauma scales with the size of the hit (capped so a single huge crit
      // can't max the meter alone — that's reserved for stacked carnage).
      const amt = Math.min(0.5, 0.16 + damage / 320)
      const { bx, by } = this._impactBias(sourceId, targetId)
      this._addTrauma(amt, bx, by)
    } else {
      // Legacy: continuous intensity between the small and medium profiles.
      const lo = PROFILES.small.intensity
      const hi = PROFILES.medium.intensity
      const t  = Math.min(1, damage / 120)
      this._shakeCustom(PROFILES.small.durationMs, lo + (hi - lo) * t)
    }
  }

  _onMedium() { this.shake('medium') }
  _onBig()    { this.shake('big')    }

  // Per-axis emphasis from the attacker→target direction so the shake leans
  // along the impact axis. Returns {bx,by} multipliers (~0.6..1.4); isotropic
  // 1,1 when positions are unavailable (string-id sources, missing entities).
  _impactBias(sourceId, targetId) {
    const gs = this._scene.gameState
    const find = (id) => {
      if (id == null) return null
      if (id === 'boss' || gs?.boss?.instanceId === id) return gs?.boss
      return (gs?.adventurers?.active ?? []).find(a => a.instanceId === id)
          ?? (gs?.minions ?? []).find(m => m.instanceId === id) ?? null
    }
    const s = find(sourceId), t = find(targetId)
    if (!s || !t || !Number.isFinite(s.worldX) || !Number.isFinite(t.worldX)) return { bx: 1, by: 1 }
    const dx = t.worldX - s.worldX, dy = t.worldY - s.worldY
    const len = Math.hypot(dx, dy) || 1
    return { bx: 0.6 + 0.8 * (Math.abs(dx) / len), by: 0.6 + 0.8 * (Math.abs(dy) / len) }
  }
}

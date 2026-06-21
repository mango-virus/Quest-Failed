// HitStopSystem — "impact freeze" feedback. Mirrors ScreenShakeSystem: it
// listens to a curated set of HEAVY combat beats and asks the Game scene to
// briefly near-freeze the day simulation (Game.hitStop) so the blow LANDS,
// then resumes at the player's chosen speed.
//
// Why a separate system (not folded into ScreenShakeSystem): hit-stop and
// shake are independent feedback channels with their own user toggle, and
// keeping them parallel makes each one discoverable + tunable on its own.
//
// Three tiers (real-time freeze lengths):
//   small  — a crit / big single hit that crossed the damage gate
//   medium — a boss melee SLAM, Petrify
//   big    — Golem Earthquake (the heaviest beat)
//
// Throttled at HITSTOP_MIN_GAP_MS so a flurry of crits can't chain into a
// stuttery slideshow. Master toggle Balance.VFX_HITSTOP_ENABLED + the
// per-player userSettings.isHitStopEnabled() (accessibility / reduce-motion).

import { EventBus }     from './EventBus.js'
import { Balance }      from '../config/balance.js'
import { userSettings } from '../hud/userSettings.js'

const HITSTOP_MIN_GAP_MS = 90

// Damage gate for the COMBAT_HIT (non-crit) freeze. Mirrors ScreenShakeSystem's
// gate so the two channels react to the same "this was a real chunk" threshold.
const BIG_HIT_DAMAGE_GATE = 25

// Real-time freeze lengths (ms) per tier.
const PROFILES = { small: 45, medium: 70, big: 110 }

export class HitStopSystem {
  constructor(scene) {
    this._scene     = scene
    this._lastStop  = 0
    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('COMBAT_HIT',              this._onCombatHit)
    on('BOSS_MELEE_HIT',          this._onMedium)
    on('GOLEM_EARTHQUAKE_FIRED',  this._onBig)
    on('BEHOLDER_PETRIFY_FIRED',  this._onMedium)
    on('PACT_BOSS_PETRIFY_FIRED', this._onMedium)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
  }

  _fire(level) {
    if (Balance.VFX_HITSTOP_ENABLED === false) return
    if (!userSettings.isHitStopEnabled()) return
    const now = this._scene.time?.now ?? 0
    if (now - this._lastStop < HITSTOP_MIN_GAP_MS) return
    this._lastStop = now
    this._scene.hitStop?.(PROFILES[level] ?? PROFILES.small)
  }

  _onCombatHit({ damage, isCritical, sourceId, targetId } = {}) {
    if (typeof damage !== 'number' || damage <= 0) return
    if (!isCritical && damage < BIG_HIT_DAMAGE_GATE) return
    // Suppress whenever a minion is on either side of the hit — at high minion
    // counts the constant minion-vs-adv combat would freeze the sim every few
    // frames and read as a stutter. Boss/trap/archetype hits (string source
    // ids like 'boss'/'tremor') don't match a minion instanceId, so they pass.
    const minions = this._scene.gameState?.minions
    if (Array.isArray(minions) && minions.length > 0) {
      for (const m of minions) {
        if (m.instanceId === sourceId || m.instanceId === targetId) return
      }
    }
    this._fire('small')
  }

  _onMedium() { this._fire('medium') }
  _onBig()    { this._fire('big')    }
}

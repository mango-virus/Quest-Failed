// InquisitorSystem — the kingdom's answer to your dark pacts (KR).
//
// While an inquisitor-tagged adventurer is loose in the dungeon, the boss's
// DARK-PACT BENEFITS are PURGED — every upside a pact grants the dungeon (kill-
// gold multipliers, minion/boss combat buffs, the boss's pact attacks, extra
// minion/trap slots, bonus spawns) goes dark. The CURSES stay: you still pay the
// pact's downside, you just lose its gift while the inquisitor lives. A true
// hard-counter to pact-stacking — kill the inquisitor fast to get your gifts back.
//
// Mechanism: a single transient flag, `gameState._mechanicFlags._inqSuppress`,
// recomputed from "is any inquisitor currently in the dungeon". Every pact-
// BENEFIT read site is gated `if (flags.X && !flags._inqSuppress)`; curse reads
// are untouched. Recomputed in the constructor (so a loaded save resolves it from
// the restored adventurer list) and on every adventurer / phase transition.
//
// Replaces the old "dispel one random dungeon mechanic" behaviour (which removed
// curses too, so it was relief, not a threat — and only hit one mechanic).

import { EventBus } from './EventBus.js'

export class InquisitorSystem {
  // Signature kept for Game.js (dungeonMechanicSystem no longer used — we gate
  // benefit reads with a flag rather than deactivating whole mechanics).
  constructor(scene, gameState, _dungeonMechanicSystem, personalitySystem) {
    this._scene = scene
    this._gameState = gameState
    this._personality = personalitySystem
    this._listeners = []
    this._active = false

    this._wire()
    this._recompute()   // resolve from the (possibly just-loaded) active roster
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    // Lift suppression on teardown so a torn-down system can never strand the
    // boss's pact benefits in the OFF state.
    const flags = this._gameState?._mechanicFlags
    if (flags) flags._inqSuppress = false
  }

  _wire() {
    const recompute = () => this._recompute()
    EventBus.on('ADVENTURER_ENTERED_DUNGEON', recompute)
    EventBus.on('ADVENTURER_DIED',            recompute)
    EventBus.on('ADVENTURER_FLED',            recompute)
    EventBus.on('DAY_PHASE_BEGAN',            recompute)
    EventBus.on('DAY_PHASE_ENDED',            recompute)
    this._listeners = [
      ['ADVENTURER_ENTERED_DUNGEON', recompute],
      ['ADVENTURER_DIED',            recompute],
      ['ADVENTURER_FLED',            recompute],
      ['DAY_PHASE_BEGAN',            recompute],
      ['DAY_PHASE_ENDED',            recompute],
    ]
  }

  _isInquisitor(adv) {
    if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 1) <= 0) return false
    const tags = this._personality?.getTags?.(adv) ?? null
    return !!(tags && (tags.has('inquisitor') || tags.has('anti_mechanic')))
  }

  // Set `_inqSuppress` to whether any inquisitor is currently in the dungeon, and
  // announce the flip (banner + HUD) so the player always sees their gifts being
  // purged / restored.
  _recompute() {
    const gs = this._gameState
    if (!gs) return
    const flags = gs._mechanicFlags ?? (gs._mechanicFlags = {})
    const present = (gs.adventurers?.active ?? []).some(a => this._isInquisitor(a))
    if (present === this._active) { flags._inqSuppress = present; return }
    this._active = present
    flags._inqSuppress = present
    EventBus.emit('INQUISITION_SUPPRESS_CHANGED', { active: present })
  }
}

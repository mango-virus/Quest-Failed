// DripCoach — Beat 3 of the onboarding overhaul (see DESIGN.md "Onboarding
// overhaul — LOCKED"). Contextual, just-in-time teaching: a registry of one-time
// coach-marks that each fire the FIRST time a mechanic becomes usable, one at a
// time, only if unused. Replaces the old 42 text popups (retired) with the
// visual-first coach-mark toolkit.
//
// How it works: on phase checkpoints (+ a few mechanic events) it ticks the
// registry and fires the first eligible, unseen drip whose target is on screen.
// Gating: only when tutorials are on, never over another coach-mark, and never
// while the scripted guided run (Beats 1-2) is mid-flow.

import { EventBus }  from '../systems/EventBus.js'
import { CoachMark } from './CoachMark.js'

// Each drip: id (seen-key), optional phase ('night'|'day'), optional minDay, an
// optional when(gs) predicate, the target to spotlight, and the caption. advance
// 'next' — a quick "Got it"; informs, doesn't force the action.
const DRIPS = [
  { id: 'speed',   phase: 'day',                target: '.hc-spd',
    eyebrow: 'SPEED',   text: 'Speed up or pause the day here' },
  { id: 'upgrade',                              target: '.hc-t-upgrade',
    when: () => !!document.querySelector('.hc-t-upgrade .nu'),
    eyebrow: 'UPGRADE', text: 'A minion can evolve — upgrade it' },
  { id: 'sell',    phase: 'night', minDay: 2,   target: '.hc-t-sell',
    eyebrow: 'SELL',    text: 'Sell a placement back for gold' },
  { id: 'move',    phase: 'night', minDay: 2,   target: '.hc-t-move',
    eyebrow: 'MOVE',    text: 'Move a room or minion anytime' },
]

export class DripCoach {
  constructor(gameState, guidedRun = null) {
    this._gameState = gameState
    this._guidedRun = guidedRun
    this._listeners = []
    const sub = (ev, fn) => { EventBus.on(ev, fn); this._listeners.push([ev, fn]) }
    sub('NIGHT_PHASE_BEGAN',    () => this._tick('night'))
    sub('DAY_PHASE_BEGAN',      () => this._tick('day'))
    // Mechanic events that may make a drip newly eligible — re-tick in the current phase.
    sub('MINION_TIER_UNLOCKED', () => this._tick(this._phase()))
    sub('BOSS_LEVELED_UP',      () => this._tick(this._phase()))
    sub('ROOM_PLACED',          () => this._tick(this._phase()))
  }

  _phase() { return this._gameState?.meta?.phase ?? 'night' }

  _resolveEl(t) {
    if (!t) return null
    if (typeof t === 'function') { try { return t() } catch { return null } }
    if (typeof t === 'string') return document.querySelector(t)
    return t
  }

  _tick(phase) {
    const meta = this._gameState?.meta
    if (!meta?.tutorialEnabled) return        // player opted out
    if (CoachMark.isActive) return            // never stack on another coach-mark
    if (this._guidedRun?._active) return       // don't collide with the scripted guided run
    if (globalThis.__qfDevTestStage) return
    meta.seenDrips ??= {}
    const day = meta.dayNumber ?? 1
    for (const d of DRIPS) {
      if (meta.seenDrips[d.id]) continue
      if (d.phase && d.phase !== phase) continue
      if (d.minDay && day < d.minDay) continue
      if (d.when) { let ok; try { ok = d.when(this._gameState) } catch { ok = false } if (!ok) continue }
      const el = this._resolveEl(d.target)
      if (!el) continue                       // target not on screen yet — catch it next tick
      meta.seenDrips[d.id] = true
      CoachMark.show({ target: d.target, eyebrow: d.eyebrow, text: d.text, gesture: 'tap', advance: 'next', nextLabel: 'Got it ›' })
      return                                  // one at a time
    }
  }

  destroy() {
    for (const [ev, fn] of this._listeners) EventBus.off(ev, fn)
    this._listeners = []
  }
}

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

// Each drip: id (seen-key); EITHER `on` (fires only when that EventBus event ticks
// it) OR a `phase` ('night'|'day') checkpoint; optional minDay + when(gs) predicate;
// an optional `target` to spotlight (omit for a centered/anchored info beat, e.g.
// over a modal) + `anchor`/`passThrough`; and the caption. advance 'next' — a quick
// "Got it" that informs, never forces the action.
const TRAPS_TAB = () => [...document.querySelectorAll('.htr-segtab')].find(t => /TRAP/i.test(t.textContent || ''))
const hasLibrary = (gs) => (gs.dungeon?.rooms ?? []).some(r => r.definitionId === 'library_of_whispers')

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
  // Traps tab only exists while the build drawer is open → catch it on a drawer-open tick.
  { id: 'traps',   phase: 'night', minDay: 2,   target: TRAPS_TAB,
    eyebrow: 'TRAPS',   text: 'Traps maim invaders — try the Traps tab' },
  // Intel — once a Library of Whispers is built, the next wave can be scouted.
  { id: 'intel',   phase: 'night', when: hasLibrary, target: '[data-tray-anchor="INTEL"]',
    eyebrow: 'INTEL',   text: 'Scout the coming wave — open Intel' },
  // Pacts — event-driven; the dark-pact picker is a modal, so a top, non-blocking note.
  { id: 'pacts',   on: 'SHOW_DARK_PACT', anchor: 'top', passThrough: true,
    eyebrow: 'DARK PACT', text: 'A mighty boon with a dark price — choose one' },
  // Adventurer autonomy — they aren't scripted; they decide for themselves.
  { id: 'autonomy', on: 'ADVENTURER_ENTERED_DUNGEON', minDay: 2, anchor: 'top', passThrough: true,
    eyebrow: 'THEY THINK FOR THEMSELVES',
    text: 'Adventurers scout, fight and flee by their own wits — you shape the maze, not their minds' },
  // The knowledge system — escapees teach the kingdom your dungeon.
  { id: 'knowledge', on: 'INTEL_LEAKED', anchor: 'top', passThrough: true,
    eyebrow: 'THE KINGDOM LEARNS',
    text: 'An escapee carried your secrets home — future raids route around what the kingdom now knows' },
  // Bestiary — survivors study your MINION types and return with counters.
  { id: 'minionCounter', phase: 'night', anchor: 'top', passThrough: true,
    when: (gs) => Object.keys(gs.knowledge?.sharedPool?.bestiary ?? {}).length > 0,
    eyebrow: 'THEY STUDY YOUR MINIONS',
    text: 'Survivors learn each minion type and bring counters — vary your defenders to stay unpredictable' },
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
    // The build drawer just opened — the TRAPS tab is now in the DOM.
    const onDrawer = () => setTimeout(() => this._tick('night'), 300)
    sub('TOGGLE_BUILD_DRAWER', onDrawer)
    sub('OPEN_BUILD_DRAWER',   onDrawer)
    // Event-driven drips (e.g. the dark-pact picker just opened, an adventurer
    // entered, intel leaked home).
    sub('SHOW_DARK_PACT',            () => setTimeout(() => this._tick(this._phase(), 'SHOW_DARK_PACT'), 300))
    sub('ADVENTURER_ENTERED_DUNGEON', () => this._tick(this._phase(), 'ADVENTURER_ENTERED_DUNGEON'))
    sub('INTEL_LEAKED',              () => this._tick(this._phase(), 'INTEL_LEAKED'))
    // Player toggled Gameplay Hints in Settings — if they turned it back ON, evaluate
    // drips promptly. (Deferred so TutorialSystem syncs meta.tutorialEnabled first.
    // Turned OFF just re-ticks + bails on the tutorialEnabled gate — harmless.)
    sub('SETTINGS_CHANGED', () => setTimeout(() => this._tick(this._phase()), 60))
  }

  _phase() { return this._gameState?.meta?.phase ?? 'night' }

  _resolveEl(t) {
    if (!t) return null
    if (typeof t === 'function') { try { return t() } catch { return null } }
    if (typeof t === 'string') return document.querySelector(t)
    return t
  }

  _tick(phase, ev = null) {
    const meta = this._gameState?.meta
    if (!meta?.tutorialEnabled) return        // player opted out
    if (CoachMark.isActive) return            // never stack on another coach-mark
    if (this._guidedRun?._active) return       // don't collide with the scripted guided run
    if (globalThis.__qfDevTestStage) return
    meta.seenDrips ??= {}
    const day = meta.dayNumber ?? 1
    for (const d of DRIPS) {
      if (meta.seenDrips[d.id]) continue
      // Event ticks fire ONLY their matching event-drip; phase checkpoints fire ONLY
      // phase-drips. (Without this split, a phase-drip would steal an event tick.)
      if (ev) { if (d.on !== ev) continue }
      else { if (d.on) continue; if (d.phase && d.phase !== phase) continue }
      if (d.minDay && day < d.minDay) continue
      if (d.when) { let ok; try { ok = d.when(this._gameState) } catch { ok = false } if (!ok) continue }
      if (d.target && !this._resolveEl(d.target)) continue   // spotlight target not on screen yet
      meta.seenDrips[d.id] = true
      CoachMark.show({
        target: d.target, eyebrow: d.eyebrow, text: d.text,
        gesture: d.target ? 'tap' : undefined, anchor: d.anchor, passThrough: d.passThrough,
        advance: 'next', nextLabel: 'Got it ›',
      })
      return                                  // one at a time
    }
  }

  destroy() {
    for (const [ev, fn] of this._listeners) EventBus.off(ev, fn)
    this._listeners = []
  }
}

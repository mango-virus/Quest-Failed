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
const hasTrapFactory = (gs) => (gs.dungeon?.rooms ?? []).some(r => r.definitionId === 'trap_factory' && r.isActive !== false)

// The live MinionEvolutionSystem (Game scene) — same lookup RosterOverlay uses — so the
// UPGRADE drip fires on REAL eligibility (a placed roster minion whose next tier's
// night-gate has passed), not the always-present `.nu` badge span.
const _evo = () => {
  // Re-looked-up each call (cheap, only on night ticks) — NOT cached, so a Game-scene
  // restart can't leave us holding a stale system bound to an old gameState.
  for (const s of (window.__game?.scene?.scenes || [])) if (s?.minionEvolutionSystem) return s.minionEvolutionSystem
  return null
}
const hasUpgradeableMinion = (gs) => {
  const evo = _evo(); if (!evo?.canUpgrade) return false
  return (gs.minions ?? []).some(m => m && m.faction === 'dungeon' && evo.canUpgrade(m))
}
// The kingdom has mapped at least one of your rooms (survivors leaked it) — so
// there's now intel that can be SCRUBBED. sharedPool is the union of every
// survivor's knowledge (KnowledgeSystem); `.rooms` is keyed by room instanceId.
const kingdomKnowsRoom = (gs) => Object.keys(gs.knowledge?.sharedPool?.rooms ?? {}).length > 0

const DRIPS = [
  { id: 'speed',   phase: 'day',                target: '.hc-spd',
    eyebrow: 'SPEED',   text: 'Speed up or pause the day here' },
  { id: 'upgrade',  phase: 'night',             target: '.hc-t-upgrade',
    when: hasUpgradeableMinion,
    eyebrow: 'UPGRADE', text: 'A minion can evolve — upgrade it' },
  { id: 'sell',    phase: 'night', minDay: 2,   target: '.hc-t-sell',
    eyebrow: 'SELL',    text: 'Sell a placement back for gold' },
  { id: 'move',    phase: 'night', minDay: 2,   target: '.hc-t-move',
    eyebrow: 'MOVE',    text: 'Move a room or minion anytime' },
  // Traps unlock at boss LEVEL 3, and need a Trap Factory FIRST (the gateway room).
  // Two-stage TELL (never forced — they may not afford it): step 1 = build a Factory;
  // step 2 (once one exists) = place a trap. Step 1 is a no-target note above the bar.
  { id: 'trapFactory', phase: 'night', anchor: 'aboveBar', passThrough: true,
    when: (gs) => (gs.boss?.level ?? 1) >= 3 && !hasTrapFactory(gs),
    eyebrow: 'TRAPS', text: 'Traps are unlocked! First build a Trap Factory — then you can place traps inside your rooms' },
  // Step 2: a Factory exists → point at the Traps tab (only in the DOM while the build
  // drawer is open, so this catches on a drawer-open tick).
  { id: 'traps',   phase: 'night', when: (gs) => (gs.boss?.level ?? 1) >= 3 && hasTrapFactory(gs), target: TRAPS_TAB,
    eyebrow: 'TRAPS',   text: 'Now place a trap — open the Traps tab' },
  // Intel — once a Library of Whispers is built, the next wave can be scouted.
  { id: 'intel',   phase: 'night', when: hasLibrary, target: '[data-tray-anchor="INTEL"]',
    eyebrow: 'INTEL',   text: 'Scout the coming wave — open Intel' },
  // Scrub Intel — the OTHER side of intel: once the kingdom has mapped any of your
  // rooms (a survivor leaked it), you can pay to SCRUB that knowledge clean. Points
  // at the Knowledge button (where the per-room SCRUB action lives).
  { id: 'scrubIntel', phase: 'night', when: kingdomKnowsRoom, target: '[data-tray-anchor="MAP"]',
    eyebrow: 'SCRUB INTEL',
    text: 'The kingdom has mapped your halls. Open Knowledge to SCRUB a room — pay gold to wipe what they know, and the next wave walks in blind' },
  // Pacts — the dark-pact picker. Centered + dimmed "Got it" gate (user 2026-06-24):
  // the full-screen coach-mark dim (z 4000) covers the picker (z 50) and blocks pact
  // selection until acknowledged. allowSkip:false → "Got it" is the only way forward.
  { id: 'pacts',   on: 'SHOW_DARK_PACT', allowSkip: false,
    eyebrow: 'DARK PACT',
    text: 'A mighty boon — always with a dark price. Read it, weigh it, then choose one. There is no taking it back.' },
  // Adventurer autonomy — they aren't scripted; they decide for themselves.
  { id: 'autonomy', on: 'ADVENTURER_ENTERED_DUNGEON', minDay: 2, anchor: 'aboveBar', passThrough: true,
    eyebrow: 'THEY THINK FOR THEMSELVES',
    text: 'Adventurers scout, fight and flee by their own wits — you shape the maze, not their minds' },
  // The knowledge system — escapees teach the kingdom your dungeon.
  { id: 'knowledge', on: 'INTEL_LEAKED', anchor: 'aboveBar', passThrough: true,
    eyebrow: 'THE KINGDOM LEARNS',
    text: 'An escapee carried your secrets home — future raids route around what the kingdom now knows' },
  // Returning heroes — adventurers you let escape come BACK, remembering everything.
  { id: 'returningHeroes', on: 'VETERAN_APPROACHING', anchor: 'aboveBar', passThrough: true,
    eyebrow: 'THEY CAME BACK',
    text: 'A hero you let escape has returned — veterans remember your rooms and traps, hit harder, and pay double when they finally fall' },
  // Bounties — a minion that racks up kills earns a kingdom bounty on its head.
  { id: 'bounties', on: 'MINION_BOUNTY_POSTED', anchor: 'aboveBar', passThrough: true,
    eyebrow: 'BOUNTY POSTED',
    text: 'A minion killed enough to earn a kingdom bounty — hunters will come for its head. Cut them down in your halls and the gold is yours instead' },
  // Random events — a day can be hijacked by a one-off twist (heist, rival, visitor).
  { id: 'events', on: 'DUNGEON_EVENT_ANNOUNCED', anchor: 'aboveBar', passThrough: true,
    eyebrow: 'A TWIST IN THE TALE',
    text: 'Some days bring an EVENT — a heist, a rival dungeon, a strange visitor. Read the banner up top and bend your plan to it' },
  // Bestiary — survivors study your MINION types and return with counters.
  { id: 'minionCounter', phase: 'night', anchor: 'aboveBar', passThrough: true,
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
    sub('VETERAN_APPROACHING',       () => this._tick(this._phase(), 'VETERAN_APPROACHING'))
    sub('MINION_BOUNTY_POSTED',      () => this._tick(this._phase(), 'MINION_BOUNTY_POSTED'))
    sub('DUNGEON_EVENT_ANNOUNCED',   () => this._tick(this._phase(), 'DUNGEON_EVENT_ANNOUNCED'))
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
    if (!meta.introSeen) return               // intro cinematic still running — nothing drips yet
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
        advance: 'next', nextLabel: 'Got it ›', allowSkip: d.allowSkip,
      })
      return                                  // one at a time
    }
  }

  destroy() {
    for (const [ev, fn] of this._listeners) EventBus.off(ev, fn)
    this._listeners = []
  }
}

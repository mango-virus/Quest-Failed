// CinematicKit — shared base for the full-screen duel/event cinematics
// (UI_POLISH_PLAN P2-6). The Aldric / Rival cinematics each reimplemented the
// same tracked-timer plumbing and the same "punch in a centred beat label"
// lifecycle, with drift in the timings; the finale cards used raw untracked
// setTimeout to outlive their own teardown.
//
// CinematicBase consolidates that:
//   * tracked timers (_after / _clearTimers) — cleared on phase-end / re-arm
//   * DETACHED timers (_afterDetached) — survive _clearTimers so a finale card
//     isn't yanked when _end() fires on the entity's death moments later, but
//     are still cleaned up on destroy. Replaces the old raw setTimeout.
//   * _destroyTimers() — clears both lists (call from destroy()).
//   * _beatLabel(host, text, className, holdMs) — build → reflow → show →
//     auto-remove the centred beat flash. The caller supplies the per-cinematic
//     CSS class (qf-ald-beat / …); only the lifecycle is shared.
//
// CDUR centralises the previously-hardcoded beat/finale/card hold durations.

import { h } from './dom.js'

// Shared cinematic durations (ms). Harmonises the slightly-drifted per-file
// values (beat 1550/1650/1700 → one; finale 2800/3000 → one).
export const CDUR = {
  beat:       1650,   // centred beat-label hold before it fades
  beatFade:   450,    // generic card fade-out tail
  finaleHold: 2900,   // win/loss finale card hold before it bows out
  cardHold:   2300,   // VS / entrance card hold before it dismisses
}

export class CinematicBase {
  constructor() {
    this._timers   = []   // tracked — cleared by _clearTimers (phase-end / re-arm)
    this._detached = []   // survive _clearTimers; cleared only on _destroyTimers
  }

  // Tracked timeout — cancelled by _clearTimers (and _destroyTimers).
  _after(ms, fn) {
    const id = setTimeout(fn, ms)
    this._timers.push(id)
    return id
  }

  // Detached timeout — NOT cancelled by _clearTimers, so a finale card can
  // outlive the _end()/_teardown that fires moments later. Cleaned on destroy.
  _afterDetached(ms, fn) {
    const id = setTimeout(fn, ms)
    this._detached.push(id)
    return id
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id)
    this._timers = []
  }

  // Clear both lists — call from the cinematic's destroy().
  _destroyTimers() {
    this._clearTimers()
    for (const id of this._detached) clearTimeout(id)
    this._detached = []
  }

  // Punch in a centred beat label: append → force reflow → add `.show` (so its
  // CSS entrance animation runs from frame 0) → auto-remove after holdMs. The
  // caller owns the styling via `className`; this owns only the lifecycle.
  _beatLabel(host, text, className, holdMs = CDUR.beat) {
    if (!host) return null
    const el = h('div', { className }, String(text))
    host.appendChild(el)
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight   // force reflow so the .show transition/animation starts clean
    el.classList.add('show')
    this._after(holdMs, () => el.remove())
    return el
  }
}

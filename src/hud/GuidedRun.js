// GuidedRun — Beat 1 & 2 of the onboarding overhaul (see DESIGN.md "Onboarding
// overhaul — LOCKED"). Drives the coach-mark toolkit through the player's very
// first night + day, teaching VISUALLY (show-don't-tell) instead of text popups.
//
//   Beat 1 (night): exactly TWO actions — place a room, then place a minion.
//   Beat 2 (day):   a deliberately simple party walks in + dies (the payoff that
//                   cements "you ARE the dungeon"); then ONE boss day-ability
//                   taught via arm → target → fire. (Beat 2 lands in a follow-up.)
//
// Starts only on a genuine first run when the player kept "Show me how to play"
// checked in the intro. (The old text-popup TutorialSystem is fully retired — see
// TUTORIAL_POPUPS_RETIRED — so the coach-marks are the only teaching surface.)

import { EventBus }  from '../systems/EventBus.js'
import { CoachMark } from './CoachMark.js'

const wait = (ms) => new Promise(r => setTimeout(r, ms))

export class GuidedRun {
  constructor(gameState) {
    this._gameState = gameState
    this._active = false
    this._listeners = []
    const sub = (ev, fn) => { EventBus.on(ev, fn); this._listeners.push([ev, fn]) }
    sub('INTRO_DISMISSED', (p) => this._maybeStart(p))
  }

  _maybeStart(p) {
    if (this._active) return
    if (!p?.tutorialEnabled || p.skipped) return    // opted out of / skipped the guided run
    const meta = this._gameState?.meta
    if (!meta || meta.guidedRunDone) return          // only ever the first run
    if ((meta.dayNumber ?? 1) > 1) return            // first night only
    this._start()
  }

  async _start() {
    this._active = true
    const meta = this._gameState.meta
    meta.guidedRunDone = true          // never nag again (persisted)
    await wait(420)                    // let the intro cinematic finish tearing down
    try {
      await this._runBeat1()
    } catch { /* swallow — never let the tutorial break the game */ }
    this._end()
  }

  _end() {
    this._active = false
    CoachMark.hide()
  }

  // Show one coach-mark that resolves on whichever comes first:
  //   'skip'    — the player dismissed it (Skip ✕)
  //   'advance' — a 'tap' mark whose target was clicked (no `until` given)
  //   'event'   — the EventBus `until` event fired (multi-step actions: place a
  //               room/minion, where the target click alone isn't completion)
  _coach(opts, until, pred) {
    return new Promise((resolve) => {
      let settled = false, off = null
      const done = (v) => { if (settled) return; settled = true; if (off) off(); CoachMark.hide(); resolve(v) }
      if (until) {
        const fn = (payload) => { if (!pred || pred(payload)) done('event') }
        EventBus.on(until, fn); off = () => EventBus.off(until, fn)
      }
      CoachMark.show(opts).then((ok) => { if (!ok) done('skip'); else if (!until) done('advance') })
    })
  }

  _firstCard() { return document.querySelector('.bsh-card') }
  _minionsTab() { return [...document.querySelectorAll('.htr-segtab')].find(t => /MINION/i.test(t.textContent || '')) }

  async _runBeat1() {
    // ── Action 1 — build a room ──────────────────────────────────────
    if (await this._coach({ target: '.hc-t-place', eyebrow: 'BUILD', text: 'Open the build menu', gesture: 'tap', advance: 'tap' }) === 'skip') return
    await wait(240)   // drawer slides open (defaults to the ROOMS tab)
    if (await this._coach(
      { target: () => this._firstCard(), eyebrow: 'PLACE A ROOM', text: 'Pick a room, drop it on the map', gesture: 'tap', advance: 'hold', hint: 'Place it →' },
      'ROOM_PLACED') === 'skip') return
    await wait(450)   // a beat to admire the new room

    // ── Action 2 — place a minion ────────────────────────────────────
    // Placing the room handed off to MOVE and closed the drawer, so reopen it.
    if (await this._coach({ target: '.hc-t-place', eyebrow: 'BUILD', text: 'Open the build menu again', gesture: 'tap', advance: 'tap' }) === 'skip') return
    await wait(240)
    if (await this._coach({ target: () => this._minionsTab(), eyebrow: 'MINIONS', text: 'Switch to the minions tab', gesture: 'tap', advance: 'tap' }) === 'skip') return
    await wait(180)
    if (await this._coach(
      { target: () => this._firstCard(), eyebrow: 'PLACE A MINION', text: 'Set a minion in your room', gesture: 'tap', advance: 'hold', hint: 'Place it →' },
      'MINION_PLACED') === 'skip') return
    await wait(450)

    // ── Hand off to the day ──────────────────────────────────────────
    await this._coach({ target: '.hc-begin', eyebrow: 'READY', text: 'Begin the day — they come to kill you', gesture: 'tap', advance: 'tap' })
  }

  destroy() {
    for (const [ev, fn] of this._listeners) EventBus.off(ev, fn)
    this._listeners = []
    this._end()
  }
}

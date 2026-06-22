// GuidedRun — Beat 1 & 2 of the onboarding overhaul (see DESIGN.md "Onboarding
// overhaul — LOCKED"). Drives the coach-mark toolkit through the player's very
// first night + day, teaching VISUALLY (show-don't-tell) instead of text popups.
//
//   Beat 1 (night): the real first-night build loop —
//     1. place the ENTRY HALL (required; heroes enter here)
//     2. place a BARRACKS (houses minions — gives the roster slots to place any)
//     3. learn CONNECTION — rooms auto-link with doorways when placed touching;
//        every room must reach the entry hall or the day can't begin
//     4. place a MINION in the barracks
//     5. BEGIN DAY (gated on DUNGEON_READINESS = entry hall + all rooms connected)
//   Beat 2 (day): a simple party walks in + dies, then one boss day-ability.
//     (Beat 2 lands in a follow-up.)
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
    this._ready = false   // latest DUNGEON_READINESS.ready (entry hall + all rooms connected)
    this._listeners = []
    const sub = (ev, fn) => { EventBus.on(ev, fn); this._listeners.push([ev, fn]) }
    sub('INTRO_DISMISSED', (p) => this._maybeStart(p))
    sub('DUNGEON_READINESS', (p) => { this._ready = !!p?.ready })
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
    this._gameState.meta.guidedRunDone = true   // never nag again (persisted)
    await wait(420)                              // let the intro cinematic finish tearing down
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
  //   'event'   — the EventBus `until` event fired (+ optional `pred` filter) — for
  //               multi-step actions (place a room/minion) the target click alone
  //               isn't completion, so we wait for the game event.
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

  // ── target finders (re-resolved live by the coach-mark each frame) ──
  _openBuild(text) { return this._coach({ target: '.hc-t-place', eyebrow: 'BUILD', text, gesture: 'tap', advance: 'tap' }) }
  _minionsTab() { return [...document.querySelectorAll('.htr-segtab')].find(t => /MINION/i.test(t.textContent || '')) }
  _firstCard() { return document.querySelector('.bsh-card') }
  _roomCard(name) {
    const n = name.toLowerCase()
    return [...document.querySelectorAll('.bsh-card')]
      .find(c => (c.querySelector('.bsh-cn')?.textContent || '').trim().toLowerCase() === n) || null
  }
  _placedRoom(defId) { return (p) => p?.room?.definitionId === defId }
  _isReady() { return (p) => !!p?.ready }

  async _runBeat1() {
    // ── 1. Entry Hall — required; adventurers enter here ──────────────
    if (await this._openBuild('Open the build menu') === 'skip') return
    await wait(240)   // drawer slides open (defaults to the ROOMS tab)
    if (await this._coach(
      { target: () => this._roomCard('Entry Hall'), eyebrow: 'ENTRY HALL', text: 'Place it next to the boss chamber', gesture: 'tap', advance: 'hold', hint: 'Place it →', passThrough: true },
      'ROOM_PLACED', this._placedRoom('entry_hall')) === 'skip') return
    await wait(450)

    // ── 2. Barracks — houses your minions ─────────────────────────────
    if (await this._openBuild('Open the build menu again') === 'skip') return
    await wait(240)
    if (await this._coach(
      { target: () => this._roomCard('Barracks'), eyebrow: 'BARRACKS', text: 'Minions live here — place it touching', gesture: 'tap', advance: 'hold', hint: 'Place it →', passThrough: true },
      'ROOM_PLACED', this._placedRoom('starter_barracks')) === 'skip') return
    await wait(450)

    // ── 3. Connection — every room must link to the entry hall ────────
    if (this._ready) {
      if (await this._coach({ eyebrow: 'CONNECTED', text: 'Touching rooms link with doorways', advance: 'next', nextLabel: 'Got it ›' }) === 'skip') return
    } else {
      if (await this._coach(
        { eyebrow: 'CONNECT', text: 'Place rooms touching to link them', advance: 'hold', passThrough: true, hint: 'Connect them →' },
        'DUNGEON_READINESS', this._isReady()) === 'skip') return
    }

    // ── 4. Place a minion in the barracks ─────────────────────────────
    if (await this._openBuild('Open the build menu') === 'skip') return
    await wait(240)
    if (await this._coach({ target: () => this._minionsTab(), eyebrow: 'MINIONS', text: 'Switch to the minions tab', gesture: 'tap', advance: 'tap' }) === 'skip') return
    await wait(180)
    if (await this._coach(
      { target: () => this._firstCard(), eyebrow: 'MINION', text: 'Place a minion in your barracks', gesture: 'tap', advance: 'hold', hint: 'Place it →', passThrough: true },
      'MINION_PLACED') === 'skip') return
    await wait(450)

    // ── 5. Begin the day (only once everything's connected) ───────────
    if (!this._ready) {
      if (await this._coach(
        { eyebrow: 'CONNECT', text: 'Link every room to the entry hall', advance: 'hold', passThrough: true, hint: 'Connect them →' },
        'DUNGEON_READINESS', this._isReady()) === 'skip') return
    }
    await this._coach({ target: '.hc-begin', eyebrow: 'READY', text: 'Begin the day — fight back', gesture: 'tap', advance: 'tap' })
  }

  destroy() {
    for (const [ev, fn] of this._listeners) EventBus.off(ev, fn)
    this._listeners = []
    this._end()
  }
}

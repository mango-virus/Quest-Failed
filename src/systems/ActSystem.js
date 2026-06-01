// ActSystem — KR P1. Owns the run's act state and fires act-transition events.
//
// Gated behind isActsEnabled(): Game.js only constructs this when the `acts`
// flag is on, so the default endless game never touches any of this. Content
// (Champion clear-conditions, the drafted middle, boss evolution, the victory
// screen) lands in later KR phases — this is just the spine that tracks which
// act you're in and announces the boundaries.
//
// Clear-condition note (P1): the only loss is boss-dies-3×, so "you survived
// the act's final day" == "you cleared the act". We therefore treat crossing an
// act's final day as the clear. KR P3 refines this to gate on actually
// defeating the act's Champion before the boundary counts as cleared.

import { EventBus } from './EventBus.js'
import {
  actForDay, actDayIndex, actDef, isActFinalDay, ACT_COUNT,
} from '../config/acts.js'

export class ActSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs = gameState
    this._runStartAnnounced = false
    this._ensureState()
    // DAY_PHASE_ENDED fires from DayPhase._endDay AFTER meta.dayNumber is
    // incremented, so the counter already points at the upcoming day.
    EventBus.on('DAY_PHASE_ENDED', this._onDayEnded, this)
    // Announce the current act once, on the first night of the session — by
    // then the act-intro banner (HudRoot) is mounted to receive ACT_STARTED.
    // Acts II–IV get their intros from the _onDayEnded transition instead, so
    // this only ever fires the Act-I (or current-act-on-continue) intro.
    EventBus.on('NIGHT_PHASE_STARTED', this._onNightStarted, this)
    // The Act IV duel: NemesisSystem emits NEMESIS_SLAIN the moment the boss
    // puts the crowned Hero King down. That's the real, earned victory — fire it
    // immediately rather than waiting for the day to tick over.
    EventBus.on('NEMESIS_SLAIN', this._onNemesisSlain, this)
  }

  destroy() {
    EventBus.off('DAY_PHASE_ENDED', this._onDayEnded, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._onNightStarted, this)
    EventBus.off('NEMESIS_SLAIN', this._onNemesisSlain, this)
  }

  // Defeating Aldric in the Act IV duel wins the run outright.
  _onNemesisSlain({ act } = {}) {
    this._fireVictory({ act: act ?? ACT_COUNT, def: actDef(act ?? ACT_COUNT), cause: 'nemesis_slain' })
  }

  // Single, idempotent victory gate. Whether the run is won by slaying Aldric in
  // the duel (NEMESIS_SLAIN) or — fallback — by simply surviving the final act's
  // last day, RUN_VICTORY fires exactly once. meta.act.won is the guard.
  _fireVictory(payload) {
    const meta = this._gs.meta
    if (!meta?.act) this._ensureState()
    if (this._gs.meta.act.won) return
    this._gs.meta.act.won = true
    EventBus.emit('RUN_VICTORY', payload)
  }

  _onNightStarted() {
    if (this._runStartAnnounced) return
    this._runStartAnnounced = true
    this.announceCurrent()
  }

  // Lazily seed meta.act so fresh runs AND old saves both have it, derived from
  // the current dayNumber. No SaveSystem migration / version bump needed — the
  // block just appears, and absence is always backfilled here on construction.
  _ensureState() {
    const meta = this._gs.meta ?? (this._gs.meta = {})
    const day = meta.dayNumber ?? 1
    meta.act ??= {}
    meta.act.current  ??= actForDay(day)
    meta.act.dayInAct ??= actDayIndex(day)
    meta.act.cleared  ??= []     // act numbers the player has cleared this run
    meta.act.won      ??= false
  }

  // Announce the current act (the act-intro banner listens for ACT_STARTED).
  // Game.js calls this once at run start so a fresh run opens on Act I's intro.
  announceCurrent() {
    const a = this._gs.meta.act.current
    EventBus.emit('ACT_STARTED', {
      act: a, def: actDef(a), dayInAct: this._gs.meta.act.dayInAct, atRunStart: true,
    })
  }

  _onDayEnded() {
    const meta = this._gs.meta
    if (!meta?.act) this._ensureState()

    // The day that just ended = dayNumber - 1 (DayPhase already incremented it).
    const finishedDay = (meta.dayNumber ?? 1) - 1
    if (finishedDay < 1) return

    // Keep the live day-in-act counter fresh for the upcoming day either way.
    meta.act.dayInAct = actDayIndex(meta.dayNumber ?? 1)

    // Only an act's FINAL day clears the act (P1: survival == clear).
    if (!isActFinalDay(finishedDay)) return

    const clearedAct = actForDay(finishedDay)
    if (!meta.act.cleared.includes(clearedAct)) meta.act.cleared.push(clearedAct)
    EventBus.emit('ACT_CLEARED', { act: clearedAct, def: actDef(clearedAct) })

    if (clearedAct >= ACT_COUNT) {
      // Cleared the final act. Normally the duel's NEMESIS_SLAIN has already
      // fired victory mid-day; this is the fallback for the rare case Aldric
      // wasn't put down yet survived the day (e.g. couldn't reach the throne) —
      // you held the realm off, you still win. _fireVictory is idempotent.
      this._fireVictory({ act: clearedAct, def: actDef(clearedAct), cause: 'survived' })
      return
    }

    // Advance to the next act and announce it.
    meta.act.current = clearedAct + 1
    meta.act.dayInAct = 1
    EventBus.emit('ACT_STARTED', {
      act: meta.act.current, def: actDef(meta.act.current), dayInAct: 1, atRunStart: false,
    })
  }
}

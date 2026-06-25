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
  actForDay, actDayIndex, actDef, isActFinalDay, ACT_COUNT, ACT_DAYS,
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

    // The act is PINNED on meta.act.current (not the day) so P3 overtime can hold
    // it past its nominal day range. The climax is the act's final day OR any
    // overtime day we're already on.
    const act = meta.act.current ?? actForDay(finishedDay)
    const def = actDef(act)

    // Self-heal a stale overtime flag. Overtime can only be real once the run has
    // reached the act's nominal final day; if it's set on an earlier day (an old
    // save / drifted state) it would otherwise re-fire ACT_OVERTIME + re-arm the
    // Champion raid every day. Clear it here so the day's normal flow resumes.
    if (meta.act.overtime && finishedDay < act * ACT_DAYS) {
      meta.act.overtime     = false
      meta.act.overtimeDays = 0
    }

    if (!isActFinalDay(finishedDay) && !meta.act.overtime) return

    // KR P3 HARD GATE — drafted acts (II/III) clear ONLY by beating the Champion.
    // Fixed acts (I survival, IV the duel) have no Champion gate.
    const gated        = def?.kind === 'drafted'
    const championDown = !!meta.act.championsDefeated?.[act]
    if (gated && !championDown) {
      // The Champion still stands — the act is NOT won. Stay on it; the raid
      // re-runs (escalating) each day until the Champion falls or the boss does.
      meta.act.overtime     = true
      meta.act.overtimeDays = (meta.act.overtimeDays ?? 0) + 1
      EventBus.emit('ACT_OVERTIME', { act, def, days: meta.act.overtimeDays })
      return
    }

    // Act IV gate (resolves on Aldric, not the day timer) — checked BEFORE the
    // generic "cleared" bookkeeping, because losing the duel with lives left
    // means the act is NOT cleared yet and overtime must accumulate (resetting
    // overtimeDays to 0 here would let the rematch escalation never grow past
    // ×1). NEMESIS_SLAIN already fired victory mid-day if the boss won the
    // duel; if Aldric is still standing, enter rematch overtime — Aldric
    // returns the next day, escalated, until one side falls for good
    // (2026-06-09 spec).
    if (act >= ACT_COUNT) {
      const aldricSlain = !!this._gs.meta?.nemesis?.slainByBoss
      if (aldricSlain) {
        // Cleared the final act. Drop overtime + log clear + fire victory.
        meta.act.overtime     = false
        meta.act.overtimeDays = 0
        if (!meta.act.cleared.includes(act)) meta.act.cleared.push(act)
        EventBus.emit('ACT_CLEARED', { act, def })
        this._fireVictory({ act, def, cause: 'nemesis_slain' })
      } else {
        // Aldric still stands — into rematch overtime.
        meta.act.overtime     = true
        meta.act.overtimeDays = (meta.act.overtimeDays ?? 0) + 1
        EventBus.emit('ACT_OVERTIME', { act, def, days: meta.act.overtimeDays })
      }
      return
    }

    // Cleared (Champion down, or a fixed act survived). Drop overtime + advance.
    meta.act.overtime     = false
    meta.act.overtimeDays = 0
    if (!meta.act.cleared.includes(act)) meta.act.cleared.push(act)
    EventBus.emit('ACT_CLEARED', { act, def })

    // Advance to the next act and announce it.
    meta.act.current = act + 1
    meta.act.dayInAct = 1
    EventBus.emit('ACT_STARTED', {
      act: meta.act.current, def: actDef(meta.act.current), dayInAct: 1, atRunStart: false,
    })
  }
}

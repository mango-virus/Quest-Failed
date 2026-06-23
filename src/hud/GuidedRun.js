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

// Per-archetype day-ability: button selector + the FIRED echo to advance on.
const BOSS_ABILITY = {
  golem:     { sel: '.qf-archstrip-earthquake', fired: 'GOLEM_EARTHQUAKE_FIRED' },
  demon:     { sel: '.qf-archstrip-sacrifice',  fired: 'DEMON_SACRIFICE_FIRED' },
  lich:      { sel: '.qf-archstrip-channel',    fired: 'LICH_CHANNEL_FIRED' },
  slime:     { sel: '.qf-archstrip-surge',      fired: 'SLIME_SURGE_FIRED' },
  beholder:  { sel: '.qf-archstrip-gaze',       fired: 'BEHOLDER_GAZE_FIRED' },
  orc:       { sel: '.qf-archstrip-throw',      fired: 'ORC_TROPHY_THROW_FIRED' },
  myconid:   { sel: '.qf-archstrip-seed',       fired: 'MYCONID_SEED_FIRED' },
  lizardman: { sel: '.qf-archstrip-spit',       fired: 'LIZARD_SPIT_FIRED' },
  vampire:   { sel: '.qf-archstrip-rite',       fired: 'VAMPIRE_RITE_FIRED' },
  wraith:    { sel: '.qf-archstrip-terror',     fired: 'WRAITH_TERROR_FIRED' },
  gnoll:     { sel: '.qf-archstrip-hunt',       fired: 'GNOLL_HUNT_FIRED' },
  succubus:  { sel: '.qf-archstrip-kiss',       fired: 'SUCCUBUS_KISS_FIRED' },
}

export class GuidedRun {
  constructor(gameState) {
    this._gameState = gameState
    this._active = false
    this._ready = false   // latest DUNGEON_READINESS.ready (entry hall + all rooms connected)
    this._listeners = []
    // guidedPlace gates NightPhase's onboarding placement rail — a RUNTIME flag, so
    // reset it on every load (a save taken mid-run must not constrain normal play).
    if (gameState?.meta) gameState.meta.guidedPlace = null
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
      const ok = await this._runBeat1()
      if (ok) await this._runBeat2()
    } catch { /* swallow — never let the tutorial break the game */ }
    this._end()
  }

  _end() {
    this._active = false
    if (this._gameState?.meta) this._gameState.meta.guidedPlace = null
    CoachMark.hide()
  }

  _setPlace(v) { if (this._gameState?.meta) this._gameState.meta.guidedPlace = v }
  // A centered "what / why" info beat (dismiss with Got it) — explains the purpose
  // of the thing they're about to place so they understand WHAT and WHY.
  _explain(eyebrow, text) { return this._coach({ eyebrow, text, advance: 'next', nextLabel: 'Got it ›' }) }

  // Show one coach-mark that resolves on whichever comes first:
  //   'skip'    — the player dismissed it (Skip ✕)
  //   'advance' — a 'tap' mark whose target was clicked (no `until` given)
  //   'event'   — the EventBus `until` event fired (+ optional `pred` filter) — for
  //               multi-step actions (place a room/minion) the target click alone
  //               isn't completion, so we wait for the game event.
  _coach(opts, until, pred) {
    return new Promise((resolve) => {
      let settled = false, off = null
      // opts.lock: keep the player on rails — only the spotlighted target (+ the map)
      // is clickable; clicks on any OTHER room/minion card, tab, or tool are swallowed.
      const lock = opts.lock ? (e) => this._lockClick(e, opts.target) : null
      if (lock) { document.addEventListener('pointerdown', lock, true); document.addEventListener('click', lock, true) }
      const done = (v) => {
        if (settled) return; settled = true
        if (off) off()
        if (lock) { document.removeEventListener('pointerdown', lock, true); document.removeEventListener('click', lock, true) }
        CoachMark.hide(); resolve(v)
      }
      if (until) {
        const fn = (payload) => { if (!pred || pred(payload)) done('event') }
        EventBus.on(until, fn); off = () => EventBus.off(until, fn)
      }
      CoachMark.show(opts).then((ok) => { if (!ok) done('skip'); else if (!until) done('advance') })
    })
  }

  _resolveEl(t) {
    if (!t) return null
    if (typeof t === 'function') { try { return t() } catch { return null } }
    if (typeof t === 'string') return document.querySelector(t)
    return t
  }

  // Capture-phase guard for locked steps: allow the coach-mark controls, the
  // spotlighted target, and the dungeon canvas (the map — needed to place); block
  // clicks on any OTHER build card / category tab / action-bar tool so the player
  // can only do the one thing the onboarding is asking for.
  _lockClick(e, target) {
    const t = e.target
    if (!t || !t.closest) return
    if (t.closest('.qf-cm-skip, .qf-cm-next, .qf-cm-bubble')) return   // coach-mark controls
    if (t.tagName === 'CANVAS' || t.closest('canvas')) return          // the dungeon map (placement clicks)
    const ctrl = t.closest('.bsh-card, .htr-segtab, .hc-btn, .qf-archstrip-btn')
    if (!ctrl) return                                                  // not a restricted control — leave it
    const allowed = this._resolveEl(target)
    if (allowed && (ctrl === allowed || allowed.contains(ctrl) || ctrl.contains(allowed))) return
    e.preventDefault(); e.stopImmediatePropagation()
  }

  // ── target finders (re-resolved live by the coach-mark each frame) ──
  _openBuild(text) { return this._coach({ target: '.hc-t-place', eyebrow: 'BUILD', text, gesture: 'tap', advance: 'tap', lock: true }) }
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
    // Welcome — frame the whole night.
    if (await this._explain('YOUR DUNGEON', 'You are the dungeon. Build it tonight, then watch them die at dawn.') === 'skip') return

    // ── 1. Entry Hall — required; adventurers enter here ──────────────
    if (await this._explain('WHY · ENTRY HALL', 'Adventurers invade through the Entry Hall — every dungeon needs one.') === 'skip') return
    if (await this._openBuild('Open the build menu') === 'skip') return
    await wait(240)   // drawer slides open (defaults to the ROOMS tab)
    this._setPlace('boss')   // rail: can only place where it connects to the boss chamber
    if (await this._coach(
      { target: () => this._roomCard('Entry Hall'), eyebrow: 'STEP 1 · ENTRY HALL', text: 'Drop it where it glows green', gesture: 'tap', advance: 'hold', hint: 'Green = connects to the boss →', passThrough: true, lock: true },
      'ROOM_PLACED', this._placedRoom('entry_hall')) === 'skip') return
    this._setPlace(null)
    await wait(450)

    // ── 2. Barracks — houses your minions ─────────────────────────────
    if (await this._explain('WHY · BARRACKS', 'Barracks house your minions — without one you cannot deploy any.') === 'skip') return
    if (await this._openBuild('Open the build menu again') === 'skip') return
    await wait(240)
    this._setPlace('connected')   // rail: can only place touching an existing room
    if (await this._coach(
      { target: () => this._roomCard('Barracks'), eyebrow: 'STEP 2 · BARRACKS', text: 'Drop it where it glows green', gesture: 'tap', advance: 'hold', hint: 'Green = touching the entry hall →', passThrough: true, lock: true },
      'ROOM_PLACED', this._placedRoom('starter_barracks')) === 'skip') return
    this._setPlace(null)
    await wait(450)

    // ── 3. Connection — rooms auto-link with doorways where they touch ─
    if (this._ready) {
      if (await this._coach({ eyebrow: 'CONNECTED', text: 'See? Touching rooms link with doorways', advance: 'next', nextLabel: 'Got it ›' }) === 'skip') return
    } else {
      if (await this._coach(
        { eyebrow: 'CONNECT THE ROOMS', text: 'Place rooms touching so doorways link them', advance: 'hold', passThrough: true, hint: 'Connect every room →' },
        'DUNGEON_READINESS', this._isReady()) === 'skip') return
    }

    // ── 4. Place a minion in the barracks ─────────────────────────────
    if (await this._explain('WHY · MINIONS', 'Minions defend your halls — they kill the invaders for you.') === 'skip') return
    if (await this._openBuild('Open the build menu') === 'skip') return
    await wait(240)
    if (await this._coach({ target: () => this._minionsTab(), eyebrow: 'STEP 3 · MINIONS', text: 'Open the minions tab', gesture: 'tap', advance: 'tap', lock: true }) === 'skip') return
    await wait(180)
    this._setPlace('minion')   // rail: place exactly ONE — NightPhase disarms after the first
    if (await this._coach(
      { target: () => this._firstCard(), eyebrow: 'STEP 3 · MINIONS', text: 'Place it inside the barracks', gesture: 'tap', advance: 'hold', hint: 'Click the barracks to place →', passThrough: true, lock: true },
      'MINION_PLACED') === 'skip') return
    this._setPlace(null)
    await wait(450)

    // ── 5. Begin the day (only once everything's connected) ───────────
    if (!this._ready) {
      if (await this._coach(
        { eyebrow: 'CONNECT THE ROOMS', text: 'Link every room to begin the day', advance: 'hold', passThrough: true, hint: 'Connect every room →' },
        'DUNGEON_READINESS', this._isReady()) === 'skip') return
    }
    if (await this._coach({ target: '.hc-begin', eyebrow: 'STEP 4 · BEGIN DAY', text: 'Begin the day — they are coming', gesture: 'tap', advance: 'tap', lock: true }) === 'skip') return false
    return true
  }

  // Beat 2 — the guided first DAY: a single weak invader walks in and dies to the
  // dungeon (the payoff that cements the inversion). (The boss-ability lesson —
  // grant a charge + arm→target→fire while the party is alive — lands in 2b.)
  async _runBeat2() {
    // Force a trivial first day: one weak rogue. Reuse the engine's pre-rolled
    // preview so the day/count already line up (day-1 base count is 1); just swap
    // the class to the weakest invader and strip any event/vendetta.
    const wp = this._gameState.run?.nextWavePreview
    if (wp) { wp.classIds = ['rogue']; wp.spriteVariants = ['rogue/v01']; wp.eventType = null; wp.vendettaHunter = null }
    await this._waitEvent('ADVENTURERS_SPAWNED')
    await wait(900)   // let the invader walk in

    // ── Boss-ability lesson (one intervention, while the invader's alive) ──
    const ab = BOSS_ABILITY[this._gameState.player?.bossArchetypeId]
    if (ab && (this._gameState.adventurers?.active?.length ?? 0) > 0) {
      this._grantAbilityCharge()                       // ensure today's power can fire
      EventBus.emit('TIME_SCALE_SET', { scale: 0 })    // freeze so the lesson isn't a race
      await wait(150)                                  // strip re-reads the charge
      const armed = await this._coach(
        { target: ab.sel, eyebrow: 'YOUR POWER', text: 'Arm your dungeon ability', gesture: 'tap', advance: 'tap', lock: true })
      if (armed !== 'skip') {
        await this._coach(
          { eyebrow: 'YOUR POWER', text: 'Now click a room to unleash it', advance: 'hold', passThrough: true, anchor: 'top', lock: true, hint: 'Click a room →' },
          ab.fired)
      }
      EventBus.emit('TIME_SCALE_SET', { scale: 1 })    // resume the day
      await wait(400)
    }

    // ── Watch the dungeon finish them — resolves when the wave is wiped ──
    if (await this._coachUntilCleared({ eyebrow: 'WATCH', text: 'Watch your dungeon kill the invader', advance: 'hold', passThrough: true, anchor: 'top', hint: 'Watch them fall →' }) === 'skip') return
    await wait(500)
    await this._explain('YOU ARE THE DUNGEON', 'They came to kill you — your dungeon killed them. That is your power.')
  }

  // Ensure the player's boss day-ability can fire ONCE for the tutorial, whatever
  // the archetype's normal gate (8 reset daily; lich=essence, orc=trophy, the rest
  // =usesLeft). Pure data on the (JSON) gameState — the existing fire handlers read
  // it. Then tell the strip to re-read so the button enables.
  _grantAbilityCharge() {
    const gs = this._gameState, boss = gs.boss
    if (!boss) return
    const ensure = (obj, key) => { if (!obj) return; obj[key] ??= {}; if (!(obj[key].usesLeft > 0)) obj[key].usesLeft = 1 }
    switch (gs.player?.bossArchetypeId) {
      case 'golem':     boss._golem ??= {}; if (!(boss._golem.earthquakeUsesLeft > 0)) boss._golem.earthquakeUsesLeft = 1; break
      case 'demon':     gs._demon ??= {}; if (!(gs._demon.sacrificeUsesLeft > 0)) gs._demon.sacrificeUsesLeft = 1; break
      case 'lich':      boss.soulEssence = Math.max(boss.soulEssence ?? 0, 30); break  // ≥ LICH_CHANNEL_COST
      case 'slime':     ensure(boss, '_slimeSurge'); break
      case 'beholder':  ensure(boss, '_beholderGaze'); break
      case 'orc':       ensure(boss, '_orcThrow'); boss.trophies ??= {}; if (!Object.keys(boss.trophies).length) boss.trophies.knight = { stacks: 1 }; break
      case 'myconid':   ensure(boss, '_myconidSeed'); break
      case 'lizardman': ensure(boss, '_lizSpit'); break
      case 'vampire':   ensure(boss, '_vampRite'); break
      case 'wraith':    ensure(boss, '_wraithTerror'); break
      case 'gnoll':     ensure(boss, '_gnollHunt'); break
      case 'succubus':  ensure(boss, '_succubusKiss'); break
    }
    EventBus.emit('BOSS_ARCH_STRIP_REFRESH')
  }

  // Resolve on the next EventBus `ev` (one-shot).
  _waitEvent(ev) {
    return new Promise((res) => {
      const fn = () => { EventBus.off(ev, fn); res() }
      EventBus.on(ev, fn)
    })
  }

  // Show a (passive) coach-mark while the player WATCHES; resolve when every
  // adventurer is gone (dead or fled) or the player skips.
  _coachUntilCleared(opts) {
    return new Promise((resolve) => {
      let settled = false, poll = 0
      const done = (v) => { if (settled) return; settled = true; if (poll) clearInterval(poll); CoachMark.hide(); resolve(v) }
      poll = setInterval(() => {
        if ((this._gameState.adventurers?.active?.length ?? 0) === 0) done('cleared')
      }, 400)
      CoachMark.show(opts).then((ok) => { if (!ok) done('skip') })
    })
  }

  destroy() {
    for (const [ev, fn] of this._listeners) EventBus.off(ev, fn)
    this._listeners = []
    this._end()
  }
}

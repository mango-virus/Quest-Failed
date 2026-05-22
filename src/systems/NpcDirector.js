// NpcDirector — the reactive brain behind the companion NPC (Lilith).
//
// Subscribes to a wide swath of EventBus events, decides what she should
// say and which expression to wear, and emits `NPC_SAY` for the DOM
// `NpcCompanion` HUD component to render. It owns ALL pacing so she feels
// alive instead of spammy:
//   - priority bands (0 ambient .. 3 major event .. 4 tutorial)
//   - per-category cooldowns (from npcLines.json)
//   - a global min-gap between any two lines
//   - an interrupt rule (higher priority cuts in; a small queue holds
//     other priority-3+ moments so they aren't lost)
//   - a recently-said ring buffer so she never repeats back-to-back
//   - an idle timer that fills silence with context-aware musings
//
// It also reroutes the tutorial pipeline: `SHOW_TUTORIAL` is converted
// into a paged dialogue she delivers herself, and the tutorial's
// `onClose` is fired once the player pages past the last panel.
//
// Lifecycle: constructed in Game.create() (before TutorialSystem so its
// INTRO_DISMISSED handler runs first), destroyed in Game.shutdown().

import { EventBus } from './EventBus.js'
import { PauseManager } from './PauseManager.js'
import { userSettings } from '../hud/userSettings.js'
import { getCompanion } from './companions.js'

const GLOBAL_GAP_MS = 2600     // min spacing between any two non-interrupt lines
const IDLE_AFTER_MS  = 23000   // silence this long → an ambient line
const RECENT_MAX     = 20      // recently-said templates kept for dedup
const QUEUE_MAX      = 3       // pending priority-3+ moments held while busy
const TICK_MS        = 700     // queue-drain + idle cadence
const MENU_FOLLOWUP_MS = 15000 // gap between her remarks while a menu stays open
const NUDGE_AFTER_MS   = 70000 // night-phase inactivity before she nudges the player
const NUDGE_GAP_MS     = 32000 // spacing between successive inactivity nudges

// event name → { cat, ctx } reaction map. `cat` may be a string or an
// array (lines merged from several categories). `ctx` names the payload
// shape so token resolution knows where to look.
const REACTIONS = {
  NIGHT_PHASE_BEGAN:          { cat: 'night_start' },
  DAY_PHASE_BEGAN:            { cat: 'day_start' },
  DAY_PHASE_ENDED:            { cat: 'wave_cleared' },
  ROOM_PLACED:                { cat: 'room_placed', ctx: 'room', nightOnly: true, specific: 'room' },
  ROOM_REMOVED:               { cat: 'sold_room' },
  ROOM_MOVED:                 { cat: 'moved' },
  MINION_PLACED:              { cat: 'minion_placed', ctx: 'minion', nightOnly: true, specific: 'minion' },
  MINION_DIED:                { cat: 'minion_died', ctx: 'minion' },
  MINION_LEVELED_UP:          { cat: 'minion_levelup', ctx: 'minion' },
  MINION_EVOLVED:             { cat: 'minion_evolved', ctx: 'minion' },
  MINION_BOUNTY_POSTED:       { cat: 'minion_bounty', ctx: 'minion' },
  TRAP_PLACED:                { cat: 'trap_placed', specific: 'trap' },
  TRAP_TRIGGERED:             { cat: 'trap_triggered' },
  LOCK_PLACED:                { cat: 'item_placed', specific: 'item', specificId: 'door_lock' },
  TREASURE_CHEST_PLACED:      { cat: 'item_placed', specific: 'item', specificId: 'treasure_chest' },
  BEACON_PLACED:              { cat: 'item_placed', specific: 'item', specificId: 'soul_bound_beacon' },
  PHYLACTERY_PLACED:          { cat: 'item_placed', specific: 'item', specificId: 'phylactery_heart' },
  ADVENTURER_ENTERED_DUNGEON: { cat: 'adv_entered', ctx: 'adv', specific: 'advClass' },
  ADVENTURER_FLED:            { cat: 'adv_fled', ctx: 'adv' },
  INTEL_LEAKED:               { cat: ['intel_leaked', 'adv_escaped'], ctx: 'adv' },
  PLACEMENT_BLOCKED:          { cat: 'placement_blocked' },
  PACT_SEALED:                { cat: 'pact_sealed', ctx: 'pact' },
  GRID_EXPANDED:              { cat: 'grid_expanded' },
  BOSS_LEVELED_UP:            { cat: 'boss_levelup' },
  BOSS_FIGHT_INCOMING:        { cat: 'boss_fight_incoming' },
  BOSS_FIGHT_STARTED:         { cat: 'boss_fight_start' },
  KNOWLEDGE_PARTY_WIPED:      { cat: 'party_wipe' },
  DUNGEON_EVENT_ANNOUNCED:    { cat: 'dungeon_event', specific: 'event' },
  BOUNTY_HUNTER_ARRIVED:      { cat: 'bounty_hunter_incoming' },
  VETERAN_APPROACHING:        { cat: 'hero_incoming', ctx: 'adv' },
  MARIONETTE_POSSESSED:       { cat: 'marionette' },
  PERSONALITY_COMBO_ACTIVATED:{ cat: 'combo' },
  // Boss-archetype signature abilities firing — one notable, daily-ish
  // event per archetype (high-frequency per-hit/per-tick events excluded).
  GOLEM_EARTHQUAKE_FIRED:     { cat: 'arch_earthquake' },
  DEMON_SACRIFICE_FIRED:      { cat: 'arch_sacrifice' },
  DEMON_HELLGATE_SPAWNED:     { cat: 'arch_hellgate' },
  BEHOLDER_PETRIFY_FIRED:     { cat: 'arch_petrify' },
  VAMPIRE_CHARM_MARKED:       { cat: 'arch_charm' },
  SUCCUBUS_CHARM_APPLIED:     { cat: 'arch_charm' },
  GNOLL_HUNTERS_PACK_REFILLED:{ cat: 'arch_huntpack' },
  MYCONID_SPORE_DAY_BEGAN:    { cat: 'arch_spores' },
  WRAITH_HAUNT_SPAWNED:       { cat: 'arch_haunt' },
}

// Player-initiated events — any of these resets the inactivity-nudge clock.
const ACTION_EVENTS = [
  'ROOM_PLACED', 'MINION_PLACED', 'TRAP_PLACED', 'LOCK_PLACED',
  'TREASURE_CHEST_PLACED', 'BEACON_PLACED', 'PHYLACTERY_PLACED',
  'ROOM_REMOVED', 'MINION_REMOVED', 'TRAP_REMOVED', 'ROOM_MOVED',
  'PACT_SEALED', 'NPC_POKE', 'HUD_MENU_OPENED', 'PHASE_TOGGLE_REQUEST',
  'BUILD_SELECT', 'NIGHT_PHASE_BEGAN', 'DAY_PHASE_BEGAN',
]

export class NpcDirector {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs    = gameState
    // The active companion (Lilith / Malakor) decides which dialogue bank
    // to drive. Each bank shares the same category keys + specifics
    // structure, so nothing downstream of here is companion-specific.
    this._companion = getCompanion(gameState?.meta?.companionId)
    const bank  = scene?.cache?.json?.get(this._companion.linesKey) ?? null
    this._cats  = bank?.categories ?? {}
    this._intro = bank?.intro ?? null
    // Keyed bespoke-line banks — specifics[domain][id] (boss / advClass /
    // room / minion / trap / item / event). Preferred over the generic
    // category when an entry exists.
    this._specifics = bank?.specifics ?? {}
    this._mechanics = scene?.cache?.json?.get('dungeonMechanics') ?? []
    this._minionDefs = scene?.cache?.json?.get('minionTypes') ?? []

    this._recent       = []      // recently-said line templates
    this._catReadyAt   = {}      // categoryId → timestamp it may fire again
    this._lastSayAt    = 0
    this._active       = null    // { priority, endsAt }
    this._queue        = []      // pending { priority, payload, endsAt }
    this._firstKillDay = false   // has the day's first kill been narrated?
    this._tutorials    = new Map() // tutorialId → onClose callback
    this._tutSeq       = 0
    this._pendingTutorial = null   // tutorial waiting for the bubble to free
    this._introDone    = !!gameState?.meta?.introSeen
    this._menuStack    = []        // open HUD menus (kinds) — drives docked commentary
    this._lastActionAt = this._now()  // last player action — drives inactivity nudges
    this._nudgeCount   = 0         // nudges fired since the last player action
    // Seed a full gap in the past so the first nudge is gated only by the
    // inactivity threshold, not by how long the page has been open.
    this._lastNudgeAt  = this._now() - NUDGE_GAP_MS
    this._wipeStreak   = 0           // consecutive days the party fully wiped
    this._wipedToday   = false
    this._minionKills  = new Map()   // minionId → kill count, for named-minion milestones
    this._unsubs       = []

    this._wire()
    this._timer = setInterval(() => this._tick(), TICK_MS)
  }

  destroy() {
    for (const [evt, fn] of this._unsubs) EventBus.off(evt, fn)
    this._unsubs = []
    if (this._timer) { clearInterval(this._timer); this._timer = null }
    this._tutorials.clear()
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  _on(evt, fn) { EventBus.on(evt, fn); this._unsubs.push([evt, fn]) }

  _wire() {
    for (const evt of Object.keys(REACTIONS)) {
      const spec = REACTIONS[evt]
      this._on(evt, (payload) => this._react(spec, payload))
    }
    // First adventurer kill of a day gets its own beat; the rest are
    // ordinary kill reactions.
    this._on('ADVENTURER_DIED', (p) => {
      if (!this._firstKillDay) {
        this._firstKillDay = true
        this._react({ cat: 'first_blood', ctx: 'adv' }, p)
      } else {
        this._react({ cat: 'adv_killed', ctx: 'adv' }, p)
      }
      this._trackMinionKill(p)
    })
    // Boss fight result → won / lost / a "that was close" near-loss.
    this._on('BOSS_FIGHT_RESOLVED', (p) => {
      const bossWon = p?.winner === 'boss'
      if (!bossWon) { this._react({ cat: 'boss_fight_lost' }, p); return }
      const boss = this._gs?.boss
      const frac = boss?.maxHp ? (p?.bossHpRemaining ?? boss.hp ?? 0) / boss.maxHp : 1
      this._react({ cat: frac < 0.34 ? 'boss_damaged' : 'boss_fight_won' }, p)
    })
    // Selling things — split by kind. Non-sell removals (Long Game
    // sacrifice, trap detonation) carry a `reason` and are skipped.
    this._on('MINION_REMOVED', (p) => { if (!p?.reason) this._react({ cat: 'sold_minion' }, p) })
    this._on('TRAP_REMOVED',   (p) => { if (!p?.reason) this._react({ cat: 'sold_trap' }, p) })
    this._on('TREASURE_CHEST_REMOVED', (p) => this._react({ cat: 'sold_item' }, p))
    this._on('BEACON_REMOVED',         (p) => this._react({ cat: 'sold_item' }, p))
    this._on('PHYLACTERY_REMOVED',     (p) => this._react({ cat: 'sold_item' }, p))
    // "Begin Day" click — only meaningful coming out of the night phase.
    this._on('PHASE_TOGGLE_REQUEST', () => {
      if (this._gs?.meta?.phase !== 'day') this._react({ cat: 'begin_day' }, null)
    })
    // New day → reset the first-kill beat + the per-day wipe flag; call
    // out milestone days.
    this._on('DAY_PHASE_BEGAN', () => {
      this._firstKillDay = false
      this._wipedToday = false
      const day = this._gs?.meta?.dayNumber ?? 0
      if ([10, 25, 50, 75, 100, 150, 200].includes(day)) {
        this._react({ cat: 'day_milestone' }, null)
      }
    })
    // Down to the final life — a graver register.
    this._on('BOSS_DEFEATED', (p) => {
      if ((p?.bossDefeatedCount ?? 0) === 2) this._react({ cat: 'last_life' }, null)
    })
    // Party-wipe streak — a day counts toward the streak if the whole
    // party was wiped; any day without one resets it.
    this._on('KNOWLEDGE_PARTY_WIPED', () => { this._wipedToday = true })
    this._on('DAY_PHASE_ENDED', () => {
      this._wipeStreak = this._wipedToday ? this._wipeStreak + 1 : 0
      if ([3, 5, 8, 12, 20, 30].includes(this._wipeStreak)) {
        this._react({ cat: 'streak', ctx: 'count' }, { count: this._wipeStreak })
      }
    })
    // Gambler's Coin — react to the wager outcome.
    this._on('GAMBLER_COIN_FLIP',     (p) => this._react({ cat: p?.won ? 'gamble_won' : 'gamble_lost' }, null))
    this._on('GAMBLER_DOUBLE_RESULT', (p) => this._react({ cat: p?.won ? 'gamble_won' : 'gamble_lost' }, null))
    // Inactivity-nudge clock — any player action resets it.
    for (const evt of ACTION_EVENTS) {
      this._on(evt, () => { this._lastActionAt = this._now(); this._nudgeCount = 0 })
    }
    // Player clicked the portrait.
    this._on('NPC_POKE', () => this._react({ cat: 'poke' }, null))
    // Tutorials — she delivers them herself.
    this._on('SHOW_TUTORIAL', (p) => this._onTutorial(p))
    this._on('NPC_TUTORIAL_DONE', (p) => this._onTutorialDone(p))
    // Intro — on a new run she introduces herself + the game premise.
    // WelcomeIntroOverlay emits NPC_DELIVER_INTRO instead of opening its
    // modal when the companion is enabled.
    this._on('NPC_DELIVER_INTRO', () => this._deliverIntro())
    this._on('NPC_CHOICE', (p) => this._onChoice(p))
    // INTRO_DISMISSED may also arrive from the fallback welcome popup
    // (companion hidden) — either way, reactions may begin afterwards.
    this._on('INTRO_DISMISSED', () => { this._introDone = true })
    // HUD menus — she steps out beside the modal and comments on it.
    this._on('HUD_MENU_OPENED', (p) => {
      const kind = p?.kind
      if (!kind) return
      this._menuStack.push(kind)
      // The pact picker (the Grimoire) drives Lilith's speech itself via
      // NPC_BROKER_SAY; every other menu gets bank commentary.
      if (kind !== 'pact') this._react({ cat: `menu_${kind}` }, null)
    })
    this._on('HUD_MENU_CLOSED', (p) => {
      const i = this._menuStack.lastIndexOf(p?.kind)
      if (i >= 0) this._menuStack.splice(i, 1)
      else this._menuStack.pop()
    })
    // Pact-broker lines — PactPicker routes the Grimoire's contextual
    // dialogue through Lilith. Shown straight away at high priority.
    this._on('NPC_BROKER_SAY', ({ text, expr } = {}) => {
      if (!text || this._mode() === 'off') return
      this._emit(3, { text, expr: expr || 'mischievous', priority: 3, holdMs: this._holdMs(text) })
    })
  }

  // ── reaction pipeline ─────────────────────────────────────────────────────
  _mode() { return userSettings.companionMode() }

  _react(spec, payload) {
    const mode = this._mode()
    if (mode === 'off') return
    if (!this._introDone) return
    if (spec.nightOnly && this._gs?.meta?.phase === 'day') return

    const catIds = Array.isArray(spec.cat) ? spec.cat : [spec.cat]
    const primary = this._cats[catIds[0]]
    if (!primary) return
    const priority = primary.priority ?? 1
    // Quiet mode keeps only notable events (priority 2+) and tutorials.
    if (mode === 'quiet' && priority < 2) return

    const now = this._now()
    // Per-category cooldown — checked on the primary category.
    if (now < (this._catReadyAt[catIds[0]] ?? 0)) return

    const ctx = this._buildCtx(spec.ctx, payload)
    // Prefer a bespoke line for this specific entity (boss / class / room
    // / minion / trap / event) when one exists; else the generic category.
    let pool = null
    if (spec.specific) {
      const id = spec.specificId ?? this._specificId(spec.specific, payload)
      const bank = id && this._specifics?.[spec.specific]?.[id]
      if (Array.isArray(bank) && bank.length) pool = bank
    }
    if (!pool) {
      pool = []
      for (const cid of catIds) { const c = this._cats[cid]; if (c?.lines) pool = pool.concat(c.lines) }
    }
    const line = this._pickFrom(pool, ctx)
    if (!line) return

    const payloadOut = {
      text:     line.text,
      expr:     line.expr,
      priority,
      holdMs:   this._holdMs(line.text),
    }
    this._catReadyAt[catIds[0]] = now + (primary.cooldownMs ?? 6000)

    if (!this._tryShow(priority, payloadOut)) {
      // Couldn't show right now — keep the big moments, drop the chatter.
      if (priority >= 3 && this._queue.length < QUEUE_MAX) {
        this._queue.push({ priority, payload: payloadOut })
      }
    }
  }

  // Try to emit immediately. Returns false if the moment must wait.
  _tryShow(priority, payloadOut) {
    const now = this._now()
    const busy = this._active && now < this._active.endsAt
    if (busy) {
      // Only a strictly higher priority may interrupt a live bubble.
      if (priority <= this._active.priority) return false
    } else if (now - this._lastSayAt < GLOBAL_GAP_MS && priority < 3) {
      // Respect the global breathing room for ordinary chatter.
      return false
    }
    this._emit(priority, payloadOut)
    return true
  }

  _emit(priority, payloadOut) {
    const now = this._now()
    this._lastSayAt = now
    this._active = {
      priority,
      endsAt: now + (payloadOut.text?.length ?? 0) * 30 + (payloadOut.holdMs ?? 2600) + 600,
    }
    EventBus.emit('NPC_SAY', payloadOut)
  }

  // ── per-tick: drain the queue, fill silence ───────────────────────────────
  _tick() {
    const now = this._now()
    if (this._active && now >= this._active.endsAt) this._active = null

    // A tutorial waiting on the current line (e.g. her welcome greeting)
    // gets the bubble the moment it frees up — ahead of ordinary chatter.
    if (!this._active && this._pendingTutorial) {
      const p = this._pendingTutorial
      this._pendingTutorial = null
      this._emitTutorial(p)
      return
    }

    // Drain the highest-priority pending moment once the bubble frees up.
    if (!this._active && this._queue.length) {
      if (now - this._lastSayAt >= 900) {
        this._queue.sort((a, b) => b.priority - a.priority)
        const next = this._queue.shift()
        this._emit(next.priority, next.payload)
        return
      }
    }
    // While a menu is open she comments on it instead of idling.
    if (this._menuStack.length) { this._maybeMenuFollowup(); return }
    // A long silence while the player does nothing → an inactivity nudge.
    if (this._maybeNudge()) return
    this._maybeIdle()
  }

  _maybeIdle() {
    if (this._mode() !== 'normal') return       // idle chatter only on full mode
    if (!this._introDone) return
    if (this._active || this._queue.length) return
    if (PauseManager.isPaused || (PauseManager._softLocks ?? 0) > 0) return
    const now = this._now()
    if (now - this._lastSayAt < IDLE_AFTER_MS) return

    const isDay = this._gs?.meta?.phase === 'day'
    // Once she's been ignored long enough, the inactivity nudge owns the
    // silence — skip ordinary idle chatter.
    if (!isDay && now - this._lastActionAt > NUDGE_AFTER_MS) return

    const ctx = this._buildCtx(null, null)
    const sources = [isDay ? 'idle_day' : 'idle_night', 'idle_general', 'idle_4thwall']
      .filter(id => this._cats[id] && now >= (this._catReadyAt[id] ?? 0))
    // Build-phase advice — a context-aware suggestion (night only).
    if (!isDay && this._cats.suggestion && now >= (this._catReadyAt.suggestion ?? 0)) {
      sources.push('suggestion')
    }
    // Occasionally she muses about the player's specific boss archetype.
    const archId   = this._gs?.player?.bossArchetypeId
    const bossPool = archId && this._specifics?.boss?.[archId]
    if (Array.isArray(bossPool) && bossPool.length && now >= (this._catReadyAt._boss ?? 0)) {
      sources.push('_boss')
    }
    if (!sources.length) return
    const src = sources[(Math.random() * sources.length) | 0]
    let line
    if (src === '_boss') {
      line = this._pickFrom(bossPool, ctx)
      this._catReadyAt._boss = now + 42000
    } else if (src === 'suggestion') {
      const cat = this._cats.suggestion
      const eligible = (cat.lines ?? []).filter(l => !l.when || this._checkCond(l.when))
      line = this._pickFrom(eligible, ctx)
      this._catReadyAt.suggestion = now + (cat.cooldownMs ?? 30000)
    } else {
      line = this._pickLine([src], ctx)
      this._catReadyAt[src] = now + (this._cats[src].cooldownMs ?? 26000)
    }
    if (!line) return
    this._emit(0, { text: line.text, expr: line.expr, priority: 0, holdMs: this._holdMs(line.text) })
  }

  // Night-phase inactivity nudge — escalating "do something" lines when the
  // player has gone a long while without acting. Returns true if it fired.
  _maybeNudge() {
    if (this._mode() !== 'normal') return false
    if (!this._introDone) return false
    if (this._active || this._queue.length) return false
    if (this._gs?.meta?.phase === 'day') return false
    if (PauseManager.isPaused || (PauseManager._softLocks ?? 0) > 0) return false
    const now = this._now()
    if (now - this._lastActionAt < NUDGE_AFTER_MS) return false
    if (now - this._lastNudgeAt  < NUDGE_GAP_MS)   return false
    if (now - this._lastSayAt    < 8000)           return false
    const cat = this._cats.idle_nudge
    if (!cat?.lines?.length) return false
    this._nudgeCount++
    this._lastNudgeAt = now
    const tier = Math.min(3, this._nudgeCount)
    let pool = cat.lines.filter(l => (l.tier ?? 1) === tier)
    if (!pool.length) pool = cat.lines
    const line = this._pickFrom(pool, this._buildCtx(null, null))
    if (!line) return false
    this._emit(1, { text: line.text, expr: line.expr, priority: 1, holdMs: this._holdMs(line.text) })
    return true
  }

  // Evaluate a build-suggestion condition against current game state.
  _checkCond(id) {
    const gs = this._gs
    const rooms = gs?.dungeon?.rooms ?? []
    const hasRoom = (defId) => rooms.some(r => r.definitionId === defId)
    const minions = (gs?.minions ?? []).filter(m => m?.aiState !== 'dead').length
    const traps = (gs?.dungeon?.traps ?? []).length
    const locks = (gs?.dungeon?.locks ?? []).length
    const gold  = gs?.player?.gold ?? gs?.player?.soulEssence ?? 0
    const lvl   = gs?.boss?.level ?? 1
    let exposure = 0
    try { exposure = this._scene?.knowledgeSystem?.getIntelReport?.()?.exposurePct ?? 0 } catch {}
    const expPct = exposure > 1 ? exposure : exposure * 100   // tolerate 0..1 or 0..100
    switch (id) {
      case 'lowGold':       return gold < 25
      case 'richGold':      return gold >= 220
      case 'noTraps':       return traps === 0
      case 'noTrapFactory': return !hasRoom('trap_factory')
      case 'noBarracks':    return !hasRoom('starter_barracks')
      case 'noLibrary':     return !hasRoom('library_of_whispers')
      case 'noTreasury':    return !hasRoom('treasury')
      case 'noGuardPost':   return !hasRoom('starter_guard_post')
      case 'fewMinions':    return minions < 3
      case 'manyMinions':   return minions >= 10
      case 'manyTraps':     return traps >= 6
      case 'noLockedDoors': return locks === 0
      case 'highExposure':  return expPct >= 50
      case 'smallDungeon':  return rooms.length < 6
      case 'bigDungeon':    return rooms.length >= 20
      case 'earlyGame':     return lvl <= 2
      default:              return false
    }
  }

  // ── tutorials ─────────────────────────────────────────────────────────────
  _onTutorial({ title, lead, body, tips, onClose } = {}) {
    if (this._mode() === 'off') return   // hidden → TutorialOverlay handles it
    const id = `tut${++this._tutSeq}`
    this._tutorials.set(id, onClose ?? null)
    const pages = []
    if (lead) pages.push({ text: String(lead), expr: 'commanding' })
    if (body) pages.push({ text: String(body), expr: 'reading' })
    if (Array.isArray(tips) && tips.length) {
      pages.push({ text: tips.map(t => `• ${t}`).join('\n'), expr: 'thinking' })
    }
    if (!pages.length) pages.push({ text: String(title ?? 'A lesson, my liege.'), expr: 'reading' })
    const out = { kind: 'tutorial', id, title: title ?? null, pages, priority: 4, sticky: true }
    // If an ordinary line is still on screen (e.g. her welcome greeting),
    // let it finish — _tick emits the tutorial the moment the bubble frees.
    const now = this._now()
    if (this._active && now < this._active.endsAt) this._pendingTutorial = out
    else this._emitTutorial(out)
  }

  _emitTutorial(out) {
    // Sticky + top-priority — held until the player pages past the last panel.
    this._active = { priority: 4, endsAt: Infinity }
    this._lastSayAt = this._now()
    EventBus.emit('NPC_SAY', out)
  }

  _onTutorialDone({ id } = {}) {
    const cb = this._tutorials.get(id)
    this._tutorials.delete(id)
    this._active = null
    this._lastSayAt = this._now()
    if (typeof cb === 'function') { try { cb() } catch {} }
  }

  // ── intro ─────────────────────────────────────────────────────────────────
  // Paged self-introduction delivered on a new run. The last page carries
  // a choice (enable tutorial hints?) — the player's pick resolves via
  // _onChoice → INTRO_DISMISSED.
  _deliverIntro() {
    if (this._mode() === 'off') return     // hidden → welcome popup handles it
    if (this._introDone || this._gs?.meta?.introSeen) return
    const pages = (this._intro?.pages ?? []).map(p => ({
      text: p.t, expr: p.x, choices: p.choices,
    }))
    if (!pages.length) { this._introDone = true; return }
    // Priority 5 — above everything; the intro is never interrupted.
    this._active = { priority: 5, endsAt: Infinity }
    this._lastSayAt = this._now()
    EventBus.emit('NPC_SAY', { kind: 'intro', id: 'intro', pages, priority: 5, sticky: true })
  }

  _onChoice({ kind, value } = {}) {
    if (kind !== 'intro') return
    const meta = this._gs?.meta
    if (meta) { meta.introSeen = true; meta.tutorialEnabled = !!value }
    try {
      localStorage.setItem('qf.gameplay.tutorials', value ? 'true' : 'false')
      // Mark the intro as seen-ever so future runs offer a "skip intro" link.
      localStorage.setItem('qf.introSeenEver', 'true')
    } catch {}
    this._introDone = true
    this._active = null
    this._lastSayAt = this._now()
    EventBus.emit('INTRO_DISMISSED', { tutorialEnabled: !!value })
  }

  // While a HUD menu is open she comments on it at a relaxed cadence.
  // The pact picker is skipped — it drives her speech on its own.
  _maybeMenuFollowup() {
    if (this._mode() === 'off') return
    if (this._active && this._now() < this._active.endsAt) return
    if (this._now() - this._lastSayAt < MENU_FOLLOWUP_MS) return
    const kind = this._menuStack[this._menuStack.length - 1]
    if (kind && kind !== 'pact') this._react({ cat: `menu_${kind}` }, null)
  }

  // ── line selection ────────────────────────────────────────────────────────
  _pickLine(catIds, ctx) {
    let pool = []
    for (const id of catIds) {
      const c = this._cats[id]
      if (c?.lines) pool = pool.concat(c.lines)
    }
    return this._pickFrom(pool, ctx)
  }

  // Pick from a raw line pool: drop lines with unresolvable tokens, prefer
  // un-said ones (dedup ring), then weighted-random.
  _pickFrom(pool, ctx) {
    if (!pool || !pool.length) return null
    const resolvable = pool.filter(l => this._resolve(l.t, ctx) != null)
    if (!resolvable.length) return null
    let fresh = resolvable.filter(l => !this._recent.includes(l.t))
    if (!fresh.length) fresh = resolvable
    const total = fresh.reduce((s, l) => s + (l.w ?? 1), 0)
    let roll = Math.random() * total
    let chosen = fresh[fresh.length - 1]
    for (const l of fresh) { roll -= (l.w ?? 1); if (roll <= 0) { chosen = l; break } }
    this._recent.push(chosen.t)
    if (this._recent.length > RECENT_MAX) this._recent.shift()
    return { text: this._resolve(chosen.t, ctx), expr: chosen.x }
  }

  // Named-minion kill milestones — track per-minion kill counts (the
  // killer is `killerId` on ADVENTURER_DIED) and celebrate a named
  // veteran when it crosses a milestone.
  _trackMinionKill(p) {
    const killerId = p?.killerId
    if (!killerId) return
    const m = (this._gs?.minions ?? []).find(x => x.instanceId === killerId)
    if (!m) return   // killerId is a keyword (boss / fear / spores / …), not a minion
    const n = (this._minionKills.get(killerId) ?? 0) + 1
    this._minionKills.set(killerId, n)
    if (m.name && [5, 12, 25, 40, 60].includes(n)) {
      this._react({ cat: 'minion_milestone', ctx: 'minionMilestone' },
        { minionName: m.name, count: n })
    }
  }

  // Resolve which id keys the `specifics` bank for a given domain.
  _specificId(domain, payload) {
    if (!payload) return null
    if (domain === 'advClass') return (payload.adventurer ?? payload)?.classId ?? null
    if (domain === 'room')     return (payload.room ?? payload)?.definitionId ?? null
    if (domain === 'trap')     return (payload.trap ?? payload)?.definitionId ?? null
    if (domain === 'event')    return (payload.def ?? payload)?.id ?? null
    if (domain === 'minion') {
      const d = (payload.minion ?? payload)?.definitionId
      return d ? String(d).replace(/\d+$/, '') : null   // family key: skeleton1 → skeleton
    }
    return null
  }

  // Resolve {tokens}. Returns null if any token in the text can't be
  // filled — the caller drops such lines so she never says "{advClass}".
  _resolve(text, ctx) {
    if (!text.includes('{')) return text
    let ok = true
    const out = text.replace(/\{(\w+)\}/g, (_, key) => {
      const v = ctx ? ctx[key] : undefined
      if (v == null || v === '') { ok = false; return '' }
      return String(v)
    })
    return ok ? out : null
  }

  _buildCtx(kind, payload) {
    const gs = this._gs
    const ctx = {
      day:   gs?.meta?.dayNumber ?? null,
      level: gs?.boss?.level ?? null,
      gold:  gs?.player?.gold ?? gs?.player?.soulEssence ?? null,
    }
    if (kind === 'adv' && payload) {
      const a = payload.adventurer ?? payload
      ctx.advClass = this._pretty(a?.classId)
      ctx.advName  = a?.name ?? null
    } else if (kind === 'minion' && payload) {
      const m = payload.minion ?? payload
      ctx.minionType = this._minionName(m?.definitionId)
      ctx.minionName = m?.name ?? ctx.minionType
    } else if (kind === 'pact' && payload) {
      const def = this._mechanics.find(x => x.id === payload.mechanicId)
      ctx.pactName = def?.name ?? null
    } else if (kind === 'count' && payload) {
      ctx.count = payload.count ?? null
    } else if (kind === 'minionMilestone' && payload) {
      ctx.minionName = payload.minionName ?? null
      ctx.count      = payload.count ?? null
    }
    return ctx
  }

  _minionName(defId) {
    if (!defId) return null
    const def = this._minionDefs.find(d => d.id === defId)
    return def?.name ?? this._pretty(defId)
  }

  _pretty(s) {
    if (!s) return null
    return String(s).replace(/[_-]+/g, ' ').replace(/\d+$/, '').trim()
      .replace(/\b\w/g, c => c.toUpperCase())
  }

  // How long a finished line lingers before it fades — generous reading
  // time scaled by length. (The player can still click the bubble to
  // dismiss early.)
  _holdMs(text) {
    const len = text?.length ?? 0
    return Math.max(5500, Math.min(12000, len * 78))
  }

  _now() {
    return (typeof performance !== 'undefined') ? performance.now() : Date.now()
  }
}

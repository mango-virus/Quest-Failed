// EventSystem — schedules + dispatches Dungeon Events.
//
// Cadence (locked 2026-05-05): one event every 6–8 days. Same event cannot
// fire back-to-back. Hard events (legendary_speedrunner, the_tournament,
// rival_dungeon) gated to bossLevel >= 3.
//
// Lifecycle:
//   NIGHT_PHASE_BEGAN   — if today is `nextEventDay`, pick eligible event,
//                         set `gameState.events.scheduled`, emit
//                         DUNGEON_EVENT_ANNOUNCED so EventBanner shows.
//   DAY_PHASE_BEGAN     — if scheduled, set `_eventFlags`, emit
//                         DUNGEON_EVENT_BEGAN. Per-event effect handlers
//                         live in DayPhase / AISystem / etc. and key off
//                         the flags.
//   DAY_PHASE_ENDED     — if scheduled, clear flags + scheduled, set
//                         `lastEventId`, schedule next event day =
//                         currentDay + random(6,8). Emit DUNGEON_EVENT_ENDED.
//
// State (on `gameState.events`):
//   nextEventDay   — int, the calendar day the next event will fire on
//   lastEventId    — string|null, prevents back-to-back repeats
//   scheduledId    — string|null, the event currently announced/active
//
// Per-event effect flags live on `gameState._eventFlags` (mirrors the
// established `_mechanicFlags` pattern used by DungeonMechanicSystem).

import { EventBus } from './EventBus.js'

const MIN_GAP = 6
const MAX_GAP = 8

export class EventSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._defs      = scene.cache?.json?.get?.('events') ?? []

    // Defensive create so a fresh GameState OR an old save without the
    // events slice both end up with a valid structure.
    gameState.events ??= {}
    gameState.events.nextEventDay ??= this._initialNextDay()
    gameState.events.lastEventId  ??= null
    gameState.events.scheduledId  ??= null
    gameState._eventFlags         ??= {}

    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('NIGHT_PHASE_BEGAN', this._onNightPhaseBegan)
    on('DAY_PHASE_BEGAN',   this._onDayPhaseBegan)
    on('DAY_PHASE_ENDED',   this._onDayPhaseEnded)
    // Per-event gameplay hooks: pestilence halves new minion HP, loot
    // goblins steal a slice of treasury when they escape.
    on('MINION_PLACED',     this._onMinionPlaced)
    on('ADVENTURER_FLED',   this._onAdventurerFled)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
  }

  // ── Scheduling ─────────────────────────────────────────────────────────

  // First-time scheduling: pick a day in the [MIN_GAP, MAX_GAP] window from
  // day 1 so the player gets at least 6 event-free days to learn the loop.
  _initialNextDay() {
    return 1 + this._rollGap()
  }

  _rollGap() {
    return MIN_GAP + Math.floor(Math.random() * (MAX_GAP - MIN_GAP + 1))
  }

  _eligibleEvents() {
    const bossLevel = this._gameState.boss?.level ?? 1
    const lastId    = this._gameState.events.lastEventId
    return this._defs.filter(d =>
      (d.minBossLevel ?? 1) <= bossLevel &&
      d.id !== lastId,
    )
  }

  _pickEvent() {
    const pool = this._eligibleEvents()
    if (pool.length === 0) return null
    return pool[Math.floor(Math.random() * pool.length)]
  }

  // ── Phase hooks ────────────────────────────────────────────────────────

  _onNightPhaseBegan() {
    const today = this._gameState.meta?.dayNumber ?? 1
    const ev = this._gameState.events
    if (ev.scheduledId) {
      // Already-announced event (mid-cycle reload) — re-prompt night-phase
      // UI hooks (e.g. Negotiation Day's modal) so a save+load doesn't
      // strand the player without a decision dialog.
      const def = this._defs.find(d => d.id === ev.scheduledId)
      if (def) this._dispatchAnnounceUi(def)
      return
    }
    if (today < (ev.nextEventDay ?? this._initialNextDay())) return

    const def = this._pickEvent()
    if (!def) return                       // nothing eligible (e.g. only one event in pool and it was last)

    ev.scheduledId = def.id
    EventBus.emit('DUNGEON_EVENT_ANNOUNCED', { def, day: today })
    this._dispatchAnnounceUi(def)
  }

  // Some events surface UI during the night phase (modals, demon spawn,
  // etc.) instead of waiting for day to begin. Routed here so EventSystem
  // owns "what fires when" and per-event handlers stay narrow.
  _dispatchAnnounceUi(def) {
    if (def.id === 'negotiation_day') this._promptNegotiation()
  }

  _promptNegotiation() {
    const flags = this._gameState._eventFlags
    // If the player has already decided this run's negotiation (e.g. from
    // a save mid-night), don't re-prompt.
    if (flags.negotiationDecided) return
    const goldNow   = this._gameState.player?.gold ?? 0
    const tribute   = Math.floor(goldNow * 0.25)
    EventBus.emit('SHOW_CONFIRM', {
      message:
        `The Adventurer's Guild offers a deal:\n\n` +
        `PAY ${tribute} gold (25% of treasury) — no adventurers tomorrow.\n` +
        `REFUSE — tomorrow's wave is +50%.`,
      confirmLabel: `PAY ${tribute}`,
      cancelLabel:  'REFUSE',
      onConfirm: () => {
        this._gameState.player.gold = Math.max(0, goldNow - tribute)
        flags.negotiationOutcome = 'pay'
        flags.negotiationDecided = true
      },
      onCancel: () => {
        flags.negotiationOutcome = 'refuse'
        flags.negotiationDecided = true
      },
    })
  }

  _onDayPhaseBegan() {
    const id = this._gameState.events.scheduledId
    if (!id) return
    const def = this._defs.find(d => d.id === id)
    if (!def) return
    this._applyEffect(def)
    EventBus.emit('DUNGEON_EVENT_BEGAN', { def })
  }

  _onDayPhaseEnded() {
    const ev = this._gameState.events
    const id = ev.scheduledId
    if (!id) return
    const def = this._defs.find(d => d.id === id)
    this._clearEffect(def)
    ev.lastEventId  = id
    ev.scheduledId  = null
    ev.nextEventDay = (this._gameState.meta?.dayNumber ?? 1) + 1 + this._rollGap()
    EventBus.emit('DUNGEON_EVENT_ENDED', { def })
  }

  // ── Effect dispatch ────────────────────────────────────────────────────
  // Per-event flags get set here and consumed by the relevant gameplay
  // systems (DayPhase reads guildRaidActive to scale wave size, etc.).
  // Each event's actual mechanic lives next to the system it modifies;
  // EventSystem only owns the flag handoff.

  _applyEffect(def) {
    const flags = this._gameState._eventFlags
    switch (def.id) {
      case 'guild_raid':
        flags.guildRaidActive = true
        break
      case 'blood_moon_eclipse':
        flags.bloodMoonEclipseActive = true
        break
      case 'twitch_con':
        flags.twitchConActive = true
        break
      case 'negotiation_day':
        // The decision was made during night via SHOW_CONFIRM. DayPhase
        // reads `negotiationOutcome` directly to decide spawn behavior;
        // nothing to do here. (If the player ignored the modal — closed
        // it without picking — _promptNegotiation's onCancel handler
        // already defaulted them to "refuse".)
        break
      case 'dungeon_pestilence':
        flags.pestilenceActive = true
        // Halve every live minion's HP at the start of the day. Newly
        // placed minions (Lich necromancy, Demon hellgate spawns, etc.)
        // get the same treatment via the MINION_PLACED listener.
        for (const m of this._gameState.minions ?? []) {
          if (m.aiState === 'dead') continue
          if (m.resources?.maxHp > 0) {
            m.resources.hp = Math.max(1, Math.round(m.resources.maxHp * 0.5))
          }
        }
        break
      case 'loot_goblin_heist':
        flags.lootGoblinHeistActive = true
        break
      case 'legendary_speedrunner':
        // DayPhase spawns the lone speedrunner instead of the regular wave.
        flags.legendarySpeedrunnerActive = true
        break
      case 'cosplay_contest':
        // DayPhase tags every spawned adv with _cosplay so AISystem's
        // engagement logic can branch.
        flags.cosplayContestActive = true
        break
      case 'cartographers_convention':
        // DayPhase spawns 3 scholars instead of the normal wave; they
        // tour every non-boss room then flee, naturally feeding their
        // tour into KnowledgeSystem's sharedPool via the existing
        // ADVENTURER_FLED → _updateSurvivorRecord pipeline. No new
        // infamy field required.
        flags.cartographersConventionActive = true
        break
      case 'the_tournament':
        flags.tournamentActive = true
        break
      case 'rival_dungeon':
        flags.rivalDungeonActive = true
        break
      case 'dark_deal':
        // The demon NPC + pact-pick flow happens in night phase via
        // DarkDealDemonRenderer; if the player accepted, that flow set
        // _eventFlags.darkDealAccepted. Halve boss maxHp for THIS day
        // only — restored in _clearEffect at DAY_PHASE_ENDED.
        if (flags.darkDealAccepted) {
          const boss = this._gameState.boss
          if (boss?.maxHp) {
            flags.darkDealOriginalMaxHp = boss.maxHp
            boss.maxHp = Math.max(1, Math.floor(boss.maxHp * 0.5))
            boss.hp    = Math.min(boss.hp ?? boss.maxHp, boss.maxHp)
          }
        }
        break
      // Other events ship in follow-up passes — flag stub keeps the
      // dispatch table explicit so missing handlers stand out in code review.
      default:
        flags[`${def.id}_active`] = true
        break
    }
  }

  _clearEffect(def) {
    const flags = this._gameState._eventFlags
    switch (def?.id) {
      case 'guild_raid':
        flags.guildRaidActive = false
        break
      case 'blood_moon_eclipse':
        flags.bloodMoonEclipseActive = false
        break
      case 'twitch_con':
        flags.twitchConActive = false
        break
      case 'negotiation_day':
        // Outcome consumed in DayPhase. Clear here so the decision doesn't
        // bleed into the next event's run-up.
        flags.negotiationOutcome = null
        flags.negotiationDecided = false
        break
      case 'dungeon_pestilence':
        flags.pestilenceActive = false
        // Clear any lingering Blight from advs that survived the day —
        // design says it doesn't persist after they leave, but a survivor
        // who returns for the next wave shouldn't keep ticking either.
        for (const a of this._gameState.adventurers?.active ?? []) a._blighted = false
        for (const a of this._gameState.adventurers?.known  ?? []) a._blighted = false
        break
      case 'loot_goblin_heist':
        flags.lootGoblinHeistActive = false
        break
      case 'legendary_speedrunner':
        flags.legendarySpeedrunnerActive = false
        break
      case 'cosplay_contest':
        flags.cosplayContestActive = false
        break
      case 'cartographers_convention':
        flags.cartographersConventionActive = false
        break
      case 'the_tournament':
        flags.tournamentActive = false
        break
      case 'rival_dungeon':
        flags.rivalDungeonActive = false
        break
      case 'dark_deal':
        // Restore boss maxHp captured at apply time. Use the snapshot —
        // DON'T just × 2, since other systems may have modified maxHp
        // mid-day (boss-archetype level-up, etc.). Skip if no snapshot
        // (deal wasn't accepted).
        if (flags.darkDealAccepted && flags.darkDealOriginalMaxHp) {
          const boss = this._gameState.boss
          if (boss) {
            const frac = (boss.maxHp > 0) ? (boss.hp / boss.maxHp) : 1
            boss.maxHp = flags.darkDealOriginalMaxHp
            boss.hp    = Math.round(boss.maxHp * frac)
          }
        }
        flags.darkDealAccepted       = false
        flags.darkDealOriginalMaxHp  = null
        break
      default:
        if (def?.id) flags[`${def.id}_active`] = false
        break
    }
  }

  // Pestilence: any minion placed during the active day inherits the same
  // 50% HP penalty as the ones already on the board.
  _onMinionPlaced({ minion }) {
    if (!this._gameState._eventFlags?.pestilenceActive) return
    if (!minion?.resources?.maxHp) return
    minion.resources.hp = Math.max(1, Math.round(minion.resources.maxHp * 0.5))
  }

  // Loot Goblin Heist: every escapee skims 10% of the current treasury.
  // Stacks per goblin so a full pack escaping cuts gold by ~46% (0.9^6).
  _onAdventurerFled({ adventurer }) {
    if (adventurer?.classId !== 'loot_goblin') return
    const player = this._gameState.player
    if (!player) return
    const stolen = Math.floor((player.gold ?? 0) * 0.10)
    player.gold = Math.max(0, (player.gold ?? 0) - stolen)
    EventBus.emit('LOOT_GOBLIN_ESCAPED', { adventurer, stolen })
  }
}

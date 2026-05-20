// EventSystem — schedules + dispatches Dungeon Events.
//
// Cadence: one event every 5 days. Same event cannot fire back-to-back
// (lastEventId filter in _eligibleEvents). Hard events
// (legendary_speedrunner, the_tournament, rival_dungeon) gated to
// bossLevel >= 3.
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

import { EventBus }         from './EventBus.js'
import { Balance }          from '../config/balance.js'
import { createAdventurer } from '../entities/Adventurer.js'
import { entryDoorTile }    from './DungeonGrid.js'

// Fixed 5-day cadence — every event fires exactly 5 days after the prior
// one resolved. Set MIN_GAP === MAX_GAP for a deterministic schedule.
const MIN_GAP = 5
const MAX_GAP = 5

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

    // Active Phaser timer events for the Twitch Con chaos mechanics. Held
    // here so they can be torn down cleanly (no leaked timers) in both
    // _clearEffect (at day end) and destroy() (scene shutdown).
    this._twitchTimers = []
    // Per-day raid counter — capped so a long day can't spawn endlessly.
    this._twitchRaidsToday = 0

    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('NIGHT_PHASE_BEGAN', this._onNightPhaseBegan)
    on('DAY_PHASE_BEGAN',   this._onDayPhaseBegan)
    on('DAY_PHASE_ENDED',   this._onDayPhaseEnded)
    // Per-event gameplay hooks: pestilence halves new minion HP, loot
    // goblins steal a slice of treasury when they escape.
    on('MINION_PLACED',     this._onMinionPlaced)
    on('ADVENTURER_FLED',   this._onAdventurerFled)
    // Twitch Con — uniformly tag every twitch_streamer that enters the
    // dungeon while the event is live. Catches the initial wave AND every
    // endless-raid reinforcement (both emit ADVENTURER_ENTERED_DUNGEON).
    on('ADVENTURER_ENTERED_DUNGEON', this._onAdventurerEntered)
    // The Tournament ("Bloodsport") — when a tournament rival dies while
    // the event is live, attribute the kill (rival-vs-rival only), buff
    // the killer, and check for last-one-standing.
    on('ADVENTURER_DIED', this._onAdventurerDiedTournament)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    // Tear down any in-flight Twitch Con timers so a scene shutdown
    // mid-event doesn't leak Phaser timer events.
    this._stopTwitchConChaos()
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
    // Gap is measured from the day the previous event fired — so with
    // MIN_GAP/MAX_GAP both = 5, an event on day N schedules the next on
    // day N+5 (no extra +1 offset).
    ev.nextEventDay = (this._gameState.meta?.dayNumber ?? 1) + this._rollGap()
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
        // Spin up the three chaos timers (chat commands, freelance AI,
        // endless raids). The initial wave's twitch_streamers are tagged
        // by the ADVENTURER_ENTERED_DUNGEON listener as they spawn.
        this._startTwitchConChaos()
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
        // Cap every live minion's HP at 50% of max — sickness weakens,
        // never heals. A wounded minion sitting at 10/100 stays at 10;
        // a healthy 100/100 drops to 50.
        for (const m of this._gameState.minions ?? []) {
          if (m.aiState === 'dead') continue
          if (m.resources?.maxHp > 0) {
            const cap = Math.max(1, Math.round(m.resources.maxHp * 0.5))
            m.resources.hp = Math.min(m.resources.hp, cap)
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
        // Stop every chaos timer so they don't bleed into the next day.
        this._stopTwitchConChaos()
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
    // Stamp the take on the adventurer so RunHistorySystem folds it into
    // the adventurers.known record the post-wave summary reads.
    adventurer.goldStolen = (adventurer.goldStolen ?? 0) + stolen
    EventBus.emit('LOOT_GOBLIN_ESCAPED', { adventurer, stolen })
  }

  // ── Dungeon event: Twitch Con — "pure chaos" ───────────────────────────
  // Three timer-driven mechanics, all active only while twitchConActive:
  //   1. Chat-command chaos — random direct mutations on streamers.
  //   2. Freelance AI       — streamers re-roll their agenda constantly.
  //   3. Endless raids      — periodic reinforcement squads (capped).
  // EventSystem OWNS all three: Phaser scene timers (which pause with the
  // game) are stored in `_twitchTimers` and torn down in _clearEffect AND
  // destroy(). Every twitch_streamer that enters the dungeon while the
  // event runs gets tagged `_twitchChaos` by _onAdventurerEntered below.

  // Tag every twitch_streamer joining the dungeon while Twitch Con is live.
  // Catches the initial DayPhase wave AND the endless-raid reinforcements
  // (both emit ADVENTURER_ENTERED_DUNGEON) — one uniform hook.
  _onAdventurerEntered({ adventurer }) {
    if (!this._gameState._eventFlags?.twitchConActive) return
    if (adventurer?.classId === 'twitch_streamer') adventurer._twitchChaos = true
  }

  // ── Dungeon event: The Tournament — "Bloodsport" lifecycle ─────────────
  // EventSystem owns the bookkeeping: rival deaths, the kill-buff handoff,
  // and last-one-standing detection. The scatter→hunt AI lives in AISystem;
  // DayPhase spawns + tags the rivals. Flow:
  //   1. A rival dies → if its killer was ANOTHER rival, buff that killer.
  //      (A minion/boss kill grants nothing.)
  //   2. After every rival death, count living rivals. When exactly one
  //      remains, point them at the boss and show the winner banner.

  // All currently-alive tournament rivals.
  _liveTournamentRivals() {
    return (this._gameState.adventurers?.active ?? []).filter(a =>
      a._tournamentRival && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0,
    )
  }

  _onAdventurerDiedTournament({ adventurer, killerId }) {
    if (!this._gameState._eventFlags?.tournamentActive) return
    if (!adventurer?._tournamentRival) return

    // Attribute the kill. `killerId` is the killing-blow source's
    // instanceId (AISystem._kill derives it from _lastHitBy). The buff is
    // ONLY granted when that id resolves to another living tournament
    // rival — a minion or the boss landing the kill grants nothing.
    const killer = (this._gameState.adventurers?.active ?? []).find(a =>
      a.instanceId === killerId && a._tournamentRival && a.aiState !== 'dead',
    )
    if (killer && killer !== adventurer) {
      this._applyTournamentKillBuff(killer)
    }

    // Last-one-standing check — runs on every rival death regardless of
    // who landed it (a rival killed by minions still thins the field).
    const survivors = this._liveTournamentRivals()
    if (survivors.length === 1) {
      this._crownTournamentWinner(survivors[0])
    }
  }

  // Apply one stack of the kill-buff: scale attack / maxHp / defense,
  // heal to the new full, bump the kill counter (drives sprite growth in
  // AdventurerRenderer). Stacks multiplicatively per kill.
  _applyTournamentKillBuff(rival) {
    rival.stats     ??= {}
    rival.resources ??= {}
    rival._tournamentKills = (rival._tournamentKills ?? 0) + 1

    rival.stats.attack  = Math.round((rival.stats.attack  ?? 1) * Balance.TOURNAMENT_RIVAL_KILL_ATK_MULT)
    rival.stats.defense = Math.round((rival.stats.defense ?? 0) * Balance.TOURNAMENT_RIVAL_KILL_DEF_MULT)
    const newMaxHp = Math.round((rival.resources.maxHp ?? rival.stats.hp ?? 1) * Balance.TOURNAMENT_RIVAL_KILL_HP_MULT)
    rival.resources.maxHp = newMaxHp
    rival.stats.hp        = newMaxHp     // keep stats.hp in sync (used as a maxHp fallback)
    rival.resources.hp    = newMaxHp     // heal to full on the kill

    // Floating "EMPOWERED" tag above the killer, tournament-red.
    this._tournamentFloatText('EMPOWERED', rival.worldX, (rival.worldY ?? 0) - 6)
    EventBus.emit('TOURNAMENT_RIVAL_BUFFED', {
      adventurer: rival,
      kills:      rival._tournamentKills,
    })
  }

  // Last rival standing — switch their goal to the boss (now powered-up)
  // and announce the victor with a centered banner.
  _crownTournamentWinner(rival) {
    if (rival._tournamentWinner) return     // already crowned — don't double-fire
    rival._tournamentWinner = true
    // Hand control to the boss-seek flow; clear path so AISystem re-routes
    // to the boss room on the next tick.
    rival.goal = { type: 'SEEK_BOSS' }
    rival.path = null
    rival.pathIndex = 0
    rival.pathTarget = null
    if (rival.aiState === 'fighting') rival.aiState = 'walking'

    EventBus.emit('TOURNAMENT_WINNER_CROWNED', { adventurer: rival })

    // "TOURNAMENT WINNER" banner — big, centered, scroll-fixed.
    const game = this._scene
    const cam  = game?.cameras?.main
    if (cam) {
      const name = rival.name ?? 'A rival'
      this._tournamentFloatText(`${name}\nTOURNAMENT WINNER`, cam.midPoint.x, cam.midPoint.y - 100, {
        fontSize: '28px',
        strokeThickness: 5,
        rise: 40,
        duration: 2600,
        scrollFixed: true,
      })
    }
  }

  // Floating tournament-red text — mirrors _twitchFloatText but in the
  // event's warn-red palette.
  _tournamentFloatText(text, worldX, worldY, opts = {}) {
    const game = this._scene
    if (!game?.add) return
    const txt = game.add.text(worldX, worldY, text, {
      fontSize:   opts.fontSize ?? '14px',
      color:      '#e0533a',                       // tournament warn-red
      fontFamily: 'monospace',
      fontStyle:  'bold',
      stroke:     '#000000',
      strokeThickness: opts.strokeThickness ?? 3,
      align:      'center',
    }).setOrigin(0.5).setDepth(9999)
    if (opts.scrollFixed) txt.setScrollFactor(0)
    game.tweens.add({
      targets:  txt,
      alpha:    0,
      y:        txt.y - (opts.rise ?? 30),
      duration: opts.duration ?? 1400,
      onComplete: () => txt.destroy(),
    })
  }

  // Start all three chaos timers. Idempotent — clears any existing timers
  // first so a save-load mid-event (DAY_PHASE_BEGAN re-fires) can't stack
  // duplicate timers.
  _startTwitchConChaos() {
    this._stopTwitchConChaos()
    this._twitchRaidsToday = 0
    const time = this._scene?.time
    if (!time) return
    // Looping Phaser timer events — they auto-pause when the game pauses.
    this._twitchTimers.push(time.addEvent({
      delay:    Balance.TWITCH_CON_CHAT_CMD_INTERVAL_MS,
      loop:     true,
      callback: this._twitchChatCommandTick,
      callbackScope: this,
    }))
    this._twitchTimers.push(time.addEvent({
      delay:    Balance.TWITCH_CON_FREELANCE_INTERVAL_MS,
      loop:     true,
      callback: this._twitchFreelanceTick,
      callbackScope: this,
    }))
    this._twitchTimers.push(time.addEvent({
      delay:    Balance.TWITCH_CON_RAID_INTERVAL_MS,
      loop:     true,
      callback: this._twitchRaidTick,
      callbackScope: this,
    }))
  }

  // Tear down every chaos timer. Safe to call when none are running.
  _stopTwitchConChaos() {
    for (const t of this._twitchTimers) t?.remove?.(false)
    this._twitchTimers = []
  }

  // All currently-alive `_twitchChaos` adventurers.
  _liveTwitchStreamers() {
    return (this._gameState.adventurers?.active ?? []).filter(a =>
      a._twitchChaos && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0,
    )
  }

  // Floating "!COMMAND" / banner text above the dungeon, twitch-purple.
  // Copies the floating-text pattern from DayPhase.js (~668-673): a
  // scroll-fixed, top-depth text tweened up + faded then destroyed.
  _twitchFloatText(text, worldX, worldY, opts = {}) {
    const game = this._scene
    if (!game?.add) return
    const txt = game.add.text(worldX, worldY, text, {
      fontSize:   opts.fontSize ?? '14px',
      color:      '#9146ff',                       // twitch purple
      fontFamily: 'monospace',
      fontStyle:  'bold',
      stroke:     '#000000',
      strokeThickness: opts.strokeThickness ?? 3,
      align:      'center',
    }).setOrigin(0.5).setDepth(9999)
    if (opts.scrollFixed) txt.setScrollFactor(0)
    game.tweens.add({
      targets:  txt,
      alpha:    0,
      y:        txt.y - (opts.rise ?? 30),
      duration: opts.duration ?? 1400,
      onComplete: () => txt.destroy(),
    })
  }

  // ── Mechanic 1 — Chat-command chaos ────────────────────────────────────
  // Every ~2.8s, pick a random alive streamer and apply ONE random "chat
  // command" — a direct, immediate mutation on the adventurer object — plus
  // a floating "!COMMAND" tag above them.
  _twitchChatCommandTick() {
    if (!this._gameState._eventFlags?.twitchConActive) return
    const streamers = this._liveTwitchStreamers()
    if (streamers.length === 0) return
    const adv = streamers[Math.floor(Math.random() * streamers.length)]

    // Each command is a self-contained direct mutation — no new flags for
    // other systems to read. AISystem re-paths naturally off cleared paths.
    const commands = ['!HYPE', '!MALDING', '!DONO', "!RATIO'd", '!CLIP IT']
    const cmd = commands[Math.floor(Math.random() * commands.length)]

    switch (cmd) {
      case '!HYPE':
        // Sugar rush — faster movement.
        adv.stats.speed = (adv.stats.speed ?? 1.4) * Balance.TWITCH_CON_HYPE_SPEED_MULT
        break
      case '!MALDING':
        // Tilted — sluggish movement.
        adv.stats.speed = (adv.stats.speed ?? 1.4) * Balance.TWITCH_CON_MALDING_SPEED_MULT
        break
      case '!DONO':
        // A big donation — full heal.
        if (adv.resources) adv.resources.hp = adv.resources.maxHp
        break
      case "!RATIO'd":
        // Chat turns on them — instant chunk of damage.
        if (adv.resources) {
          const dmg = Math.round(adv.resources.maxHp * Balance.TWITCH_CON_RATIO_DMG_FRAC)
          adv.resources.hp = Math.max(0, adv.resources.hp - dmg)
        }
        break
      case '!CLIP IT': {
        // Teleport — jump to another streamer's tile, or a random walkable
        // floor tile if there's nobody else. Clear path state so AISystem
        // re-paths from the new position next tick.
        const dest = this._pickTeleportTile(adv)
        if (dest) {
          const TS = Balance.TILE_SIZE
          adv.tileX  = dest.x
          adv.tileY  = dest.y
          adv.worldX = dest.x * TS + TS / 2
          adv.worldY = dest.y * TS + TS / 2
          adv.path       = null
          adv.pathIndex  = 0
          adv.pathTarget = null
        }
        break
      }
    }

    this._twitchFloatText(cmd, adv.worldX, adv.worldY - 4)
    EventBus.emit('TWITCH_CON_CHAT_COMMAND', { adventurer: adv, command: cmd })
  }

  // Pick a teleport destination for !CLIP IT: another live streamer's tile
  // preferred, else a random walkable floor tile (a non-boss room center —
  // always walkable). Returns { x, y } or null.
  _pickTeleportTile(self) {
    const others = this._liveTwitchStreamers().filter(a => a !== self)
    if (others.length > 0) {
      const peer = others[Math.floor(Math.random() * others.length)]
      return { x: peer.tileX, y: peer.tileY }
    }
    // Fallback — a random non-boss room's center tile.
    const rooms = (this._gameState.dungeon?.rooms ?? [])
      .filter(r => r.definitionId !== 'boss_chamber')
    if (rooms.length === 0) return null
    const room = rooms[Math.floor(Math.random() * rooms.length)]
    return {
      x: room.gridX + Math.floor(room.width  / 2),
      y: room.gridY + Math.floor(room.height / 2),
    }
  }

  // ── Mechanic 2 — Freelance AI ──────────────────────────────────────────
  // Every ~4s, each live streamer re-rolls its agenda. They behave like an
  // uncoordinated mob: charge the boss / raid a random non-boss room /
  // wander in place / flee — plus an occasional "streamer beef" where they
  // pick a fight with each other (a WANDER goal flagged `beef`, which
  // AISystem's _twitchChaos infighting branch targets the nearest peer for).
  // Re-rolling to goal types AISystem already executes keeps combat intact:
  // streamers still fight (and die to) the player's minions and boss.
  _twitchFreelanceTick() {
    if (!this._gameState._eventFlags?.twitchConActive) return
    const dungeon = this._gameState.dungeon
    if (!dungeon) return
    const nonBossRooms = (dungeon.rooms ?? [])
      .filter(r => r.definitionId !== 'boss_chamber')

    for (const adv of this._liveTwitchStreamers()) {
      // Don't yank an adv out of an active fight or a flee — let those
      // resolve; the next re-roll catches them once they're free.
      if (adv.aiState === 'fighting' || adv.aiState === 'fleeing') continue
      // 4-way agenda roll, with a low chance of "streamer beef" mixed in.
      const beef = Math.random() < Balance.TWITCH_CON_BEEF_CHANCE
      if (beef) {
        // WANDER + beef — AISystem's _twitchChaos branch makes them swing
        // at the nearest other streamer, drifting around in between.
        adv.goal = { type: 'WANDER', beef: true, reason: 'streamer_beef' }
      } else {
        const roll = Math.floor(Math.random() * 4)
        switch (roll) {
          case 0:   // charge the boss
            adv.goal = { type: 'SEEK_BOSS' }
            break
          case 1: { // raid a random non-boss room
            if (nonBossRooms.length > 0) {
              const room = nonBossRooms[Math.floor(Math.random() * nonBossRooms.length)]
              adv.goal = { type: 'EXPLORE_ROOM', roomId: room.instanceId }
            } else {
              adv.goal = { type: 'SEEK_BOSS' }
            }
            break
          }
          case 2:   // wander aimlessly in place
            adv.goal = { type: 'WANDER', reason: 'freelance_wander' }
            break
          case 3:   // bail out
            adv.goal = { type: 'FLEE', reason: 'freelance_flee' }
            adv.aiState = 'fleeing'
            break
        }
      }
      // Clear path state so AISystem re-paths to the new goal next tick.
      adv.path       = null
      adv.pathIndex  = 0
      adv.pathTarget = null
    }
    EventBus.emit('TWITCH_CON_FREELANCE_REROLL', {})
  }

  // ── Mechanic 3 — Endless raids ─────────────────────────────────────────
  // Every ~9s, show a big "RAID INCOMING!" banner and spawn a small squad
  // of twitch_streamers at the dungeon entry. They auto-tag `_twitchChaos`
  // via _onAdventurerEntered. Capped: stop after TWITCH_CON_RAID_MAX_PER_DAY
  // raids, or once there are already too many streamers active.
  _twitchRaidTick() {
    if (!this._gameState._eventFlags?.twitchConActive) return
    // Cap 1 — total raids this day.
    if (this._twitchRaidsToday >= Balance.TWITCH_CON_RAID_MAX_PER_DAY) return
    // Cap 2 — don't pile on if the dungeon is already swamped.
    if (this._liveTwitchStreamers().length >= Balance.TWITCH_CON_RAID_STREAMER_CAP) return

    const game = this._scene
    const aiSystem = game?.aiSystem
    if (!aiSystem) return
    // Entry spawn tile — same source the other event-spawn code uses.
    const entry = this._gameState.dungeon?.rooms
      ?.find(r => r.definitionId === 'entry_hall')
    const spawn = aiSystem.pickSpawnTile?.() ?? (entry ? entryDoorTile(entry) : null)
    if (!spawn) return

    const allClasses = game.cache?.json?.get?.('adventurerClasses') ?? []
    const streamerDef = allClasses.find(c => c.id === 'twitch_streamer')
    if (!streamerDef) return

    // Squad size 2-3 (inclusive).
    const min  = Balance.TWITCH_CON_RAID_SQUAD_MIN
    const max  = Balance.TWITCH_CON_RAID_SQUAD_MAX
    const size = min + Math.floor(Math.random() * (max - min + 1))
    const partyId = `twitch_raid_${Date.now()}`
    const spawned = []
    for (let i = 0; i < size; i++) {
      // Fan the squad out around the entry tile (same offset pattern as
      // DayPhase._spawnLootGoblinHeist).
      const offset = i === 0 ? { x: 0, y: 0 } : { x: ((i % 2 === 0) ? 1 : -1), y: Math.floor(i / 2) }
      const tile   = { x: spawn.x + offset.x, y: spawn.y + offset.y }
      const adv    = createAdventurer(streamerDef, tile)
      adv.partyId    = partyId
      adv.spawnTileX = tile.x
      adv.spawnTileY = tile.y
      this._gameState.adventurers.active.push(adv)
      // Give them a valid starting goal (the freelance timer re-rolls it
      // within ~4s anyway, but this avoids a tick with a stale goal).
      aiSystem.pickInitialGoal?.(adv)
      // ADVENTURER_ENTERED_DUNGEON tags them `_twitchChaos` via the
      // listener and lets AISystem/renderers pick them up.
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
      spawned.push(adv)
    }
    if (spawned.length === 0) return
    this._twitchRaidsToday++
    EventBus.emit('ADVENTURERS_SPAWNED', { adventurers: spawned })
    EventBus.emit('TWITCH_CON_RAID_SPAWNED', { adventurers: spawned, raidNumber: this._twitchRaidsToday })

    // "RAID INCOMING!" banner — big, centered, twitch-purple, scroll-fixed.
    const cam = game.cameras?.main
    if (cam) {
      this._twitchFloatText('RAID INCOMING!', cam.midPoint.x, cam.midPoint.y - 100, {
        fontSize: '32px',
        strokeThickness: 5,
        rise: 40,
        duration: 2200,
        scrollFixed: true,
      })
    }
  }
}

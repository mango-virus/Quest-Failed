// EventSystem — schedules + dispatches Dungeon Events.
//
// Cadence: first event on day 3, then one every 3 days. Same event
// cannot fire back-to-back (lastEventId filter in _eligibleEvents).
// Every event is eligible from day one — no boss-level or day gate.
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
import { AbilitySystem }    from './AbilitySystem.js'
import { createAdventurer } from '../entities/Adventurer.js'
import { createMinion, applyMinionScaling } from '../entities/Minion.js'
import { entryDoorTile }    from './DungeonGrid.js'
import { AbilityVfx }       from '../ui/AbilityVfx.js'
// `h` is the DOM-tree helper used by every HUD component. Imported
// here so per-event SHOW_CONFIRM payloads can build styled message
// bodies (vs the default plain-string message) — see
// _promptSacrificialAltar's messageNode below.
import { h }                from '../hud/dom.js'

// Fixed 3-day cadence — every event fires exactly 3 days after the prior
// one resolved. Set MIN_GAP === MAX_GAP for a deterministic schedule.
const MIN_GAP = 3
const MAX_GAP = 3

// ── Day-long state-modifier event tuning ───────────────────────────────
// Miasma — chip damage to everything, every tick. Damage per tick is
// computed as a % of each target's maxHp (Balance.MIASMA_TICK_PCT_PER_TICK)
// so the chip-damage feel survives the post-day-9 HP curve. The old
// flat MIASMA_TICK_DMG = 2 became cosmetic by day ~20 (~3% of an adv's
// HP over their entire 60-90s run).
const MIASMA_TICK_MS  = 2000
// Tremors — a quake strikes a random room on this interval. Each
// successive quake this day hits harder than the last. Per-quake damage
// is now % of each target's maxHp (Balance.TREMOR_PCT_*) for the same
// HP-curve reason; flat scaling capped quake damage around ~1.5% of
// a late-game adv's HP.
const TREMOR_INTERVAL_MS = 8000
// Arcane Storm — class-ability cooldowns multiplied by this while active.
const ARCANE_STORM_COOLDOWN_SCALE = 0.4

export class EventSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._defs      = scene.cache?.json?.get?.('events') ?? []
    // Minion-type table — used by the Black Market / Mercenary events to
    // pick a minion to grant.
    this._minionTypes = scene.cache?.json?.get?.('minionTypes') ?? []

    // Defensive create so a fresh GameState OR an old save without the
    // events slice both end up with a valid structure.
    gameState.events ??= {}
    gameState.events.nextEventDay ??= this._initialNextDay()
    gameState.events.lastEventId  ??= null
    gameState.events.scheduledId  ??= null
    gameState.events.scheduledDay ??= null
    gameState._eventFlags         ??= {}

    // Active Phaser timer events for the Twitch Con chaos mechanics. Held
    // here so they can be torn down cleanly (no leaked timers) in both
    // _clearEffect (at day end) and destroy() (scene shutdown).
    this._twitchTimers = []
    // Per-day raid counter — capped so a long day can't spawn endlessly.
    this._twitchRaidsToday = 0
    // PATCH 0.0.0 timers — glitch tile flashes + admin console command
    // roulette. Same teardown contract as the twitch timers.
    this._patchZeroTimers = []
    // Looping timers for the day-long state-modifier events (Miasma chip
    // DoT, Tremor quakes). Torn down in _clearEffect and destroy().
    this._eventTimers = []
    // How many tremor quakes have struck so far this day — drives the
    // escalating per-quake damage. Reset in _applyEffect / _clearEffect.
    this._tremorCount = 0

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
    // Gambler's Coin — the player clicked the imp NPC; surface the wager.
    on('GAMBLER_IMP_CLICKED', this._onGamblerImpClicked)
    // Gambler's Coin — the player chose DOUBLE OR NOTHING in the cinematic.
    on('GAMBLER_DOUBLE_REQUEST', this._onGamblerDoubleRequest)
    // Tinkerer's Workshop — the HUD picker emits this when the player
    // picks one of the 3 offered upgrade cards.
    on('TINKERER_PICK', (p) => this._onTinkererPicked(p ?? {}))
    // Demon's Wager — clicking the demon NPC opens the wager modal.
    on('DEMON_WAGER_NPC_CLICKED', () => this._promptDemonsWager())
    // Dev-only — mango-gated TEST EVENT button forces an event to fire
    // immediately for testing. Bypasses the 3-day cadence + eligibility
    // filter. See _onDevForceEvent below.
    on('DEV_FORCE_EVENT', (p) => this._onDevForceEvent(p ?? {}))
    // Sacrificial Altar slot-reveal cinematic — AltarRewardSlot fires
    // this when its reveal animation finishes (or the player dismisses
    // early). Applies the pending reward effect at that point.
    on('SACRIFICIAL_ALTAR_SPIN_DONE', () => this._onAltarSpinDone())
    // Solo Leveling — Shadow Extraction. Every dungeon minion that dies
    // while Jinwoo is in the dungeon (and he's under the 10-shadow cap)
    // is raised as a shadow on his side. When Jinwoo himself leaves or
    // dies, his shadows vanish with him.
    on('MINION_DIED',     (p) => this._onMinionDiedShadowExtraction(p ?? {}))
    on('ADVENTURER_DIED', (p) => this._onShadowMonarchGone(p ?? {}))
    on('ADVENTURER_FLED', (p) => this._onShadowMonarchGone(p ?? {}))
  }

  // Dev-only force-fire path used by the mango TEST EVENT picker. Tears
  // down any in-progress event for today, sets the picked event as the
  // schedule, then immediately applies its effect AND fires its
  // announce-UI hooks so the modal / NPC / chest spawns right away.
  // Skips the eligibility filter so even back-to-back identical events
  // can be tested. Resets nextEventDay to the next normal cadence slot
  // after the forced event resolves.
  _onDevForceEvent({ eventId } = {}) {
    if (!eventId) return
    const def = this._defs.find(d => d.id === eventId)
    if (!def) return
    const ev = this._gameState.events
    // Tear down any in-progress event first so its day-end cleanup runs.
    if (ev?.scheduledId) {
      const prev = this._defs.find(d => d.id === ev.scheduledId)
      if (prev) this._clearEffect(prev)
    }
    // Clear single-shot decision flags so the new event's prompt re-fires.
    const flags = this._gameState._eventFlags ?? (this._gameState._eventFlags = {})
    flags.sacrificialAltarDecided = false
    flags.demonsWagerDecided      = false
    flags.tinkerersWorkshopDecided = false
    flags.blackMarketDecided      = false
    flags.mercenaryDecided        = false
    flags.cursedRelicDecided      = false
    flags.gamblerDecided          = false
    flags.negotiationDecided      = false

    const today = this._gameState.meta?.dayNumber ?? 1
    ev.scheduledId  = def.id
    ev.scheduledDay = today

    // Fire the announce events so EventBanner + DUNGEON_EVENT_ANNOUNCED
    // listeners react. Then immediately apply the day-time effect for
    // events that have one (most replacement waves / day-long buffs).
    EventBus.emit('DUNGEON_EVENT_ANNOUNCED', { def, day: today, dev: true })
    this._dispatchAnnounceUi(def)
    // For events whose primary effect plays out during the DAY (most),
    // also fire _applyEffect so the test actually sees the in-game
    // consequence on the next dawn (or now, if already daytime).
    this._applyEffect(def)
    EventBus.emit('DUNGEON_EVENT_BEGAN', { def, dev: true })
  }

  // Gambler's Coin — fired by GamblerImpRenderer when the player clicks
  // the imp. Surfaces the wager modal (the imp leaves once it resolves).
  _onGamblerImpClicked() {
    this._promptGamblersCoin()
  }

  // Gambler's Coin — the second wager. WIN doubles the player's current
  // gold; LOSE wipes it out entirely. Result is dramatised by the
  // CoinFlipCinematic (it requested this via GAMBLER_DOUBLE_REQUEST).
  _onGamblerDoubleRequest() {
    const player = this._gameState.player
    if (!player) return
    const goldBefore = player.gold ?? 0
    const won = Math.random() < 0.5
    const goldAfter = won ? goldBefore * 2 : 0
    player.gold = goldAfter
    EventBus.emit('GAMBLER_DOUBLE_RESULT', { won, goldBefore, goldAfter })
  }

  // ── Solo Leveling — Shadow Extraction ──────────────────────────────────
  // Max simultaneous shadows Jinwoo can field. (His army cap.)
  static SHADOW_CAP = 10

  // The live Shadow Monarch (Sung Jinwoo) instance, or null if he's not in
  // the dungeon / already dead.
  _liveShadowMonarch() {
    return (this._gameState.adventurers?.active ?? [])
      .find(a => a?._shadowMonarch && a.aiState !== 'dead') ?? null
  }

  _countShadows() {
    let n = 0
    for (const m of this._gameState.minions ?? []) {
      if (m?._shadowExtracted && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0) n++
    }
    return n
  }

  // A dungeon minion fell while Jinwoo is present → raise its shadow on his
  // side (faction-flip, full HP, follows + fights the dungeon like a
  // necromancer summon). Capped at SHADOW_CAP. No-op unless solo_leveling
  // is live, Jinwoo is alive, and the fallen unit was a dungeon minion
  // (never re-raise a shadow, a tamed beast, or a necro summon).
  _onMinionDiedShadowExtraction({ minion } = {}) {
    if (!(this._gameState._eventFlags ?? {}).soloLevelingActive) return
    if (!minion || minion.faction !== 'dungeon') return
    if (minion._shadowExtracted) return
    // Hard cap — never more than SHADOW_CAP (10) shadows alive at once.
    if (this._countShadows() >= EventSystem.SHADOW_CAP) return
    const jinwoo = this._liveShadowMonarch()
    if (!jinwoo) return
    // Shadows can't raise more shadows — only JINWOO raises. If the fallen
    // minion's last hit came from one of his shadows (or any adventurer-side
    // minion), skip. This stops the army chain-multiplying as it clears rooms.
    const killer = (this._gameState.minions ?? []).find(m => m.instanceId === minion._lastHitBy)
    if (killer && killer.faction !== 'dungeon') return
    // Only raise minions that fell in the SAME ROOM Jinwoo is standing in
    // (his shadows hunting elsewhere don't create new shadows across the map).
    const grid = this._scene?.dungeonGrid
    if (grid?.getRoomAtTile) {
      const minRoom = grid.getRoomAtTile(minion.tileX, minion.tileY)?.instanceId ?? null
      const jinRoom = grid.getRoomAtTile(jinwoo.tileX, jinwoo.tileY)?.instanceId ?? null
      if (!minRoom || minRoom !== jinRoom) return
    }
    this._extractShadow(minion, jinwoo)
  }

  // Build a shadow copy of `src` (a fallen dungeon minion) on Jinwoo's
  // side. Mirrors ClassAbilitySystem._createSummonedUndead but clones the
  // dead minion's type/stats so the shadow looks + fights like what it
  // rose from. The `_shadowExtracted` flag drives the dark glow
  // (MinionRenderer) and excludes it from the 1:1 throne duel (BossSystem).
  _extractShadow(src, jinwoo) {
    const TS = Balance.TILE_SIZE
    const tileX = src.tileX, tileY = src.tileY
    // Risen shadows are STRONGER than they were in life — the Monarch's power
    // reforges them. Buff over the source minion's stats so they can carve
    // through the dungeon's other minions.
    const SHADOW_HP_MULT  = 1.8
    const SHADOW_ATK_MULT = 1.8
    const SHADOW_DEF_BONUS = 3
    const srcMaxHp  = src.resources?.maxHp ?? src.resources?.hp ?? src.stats?.hp ?? 8
    const shadowHp  = Math.max(1, Math.round(srcMaxHp * SHADOW_HP_MULT))
    const shadowAtk = Math.max(1, Math.round((src.stats?.attack ?? 3) * SHADOW_ATK_MULT))
    const shadowDef = (src.stats?.defense ?? 0) + SHADOW_DEF_BONUS
    const shadow = {
      instanceId: `shadow_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      definitionId: src.definitionId,
      name: null, color: 0x9b2fe0, sigil: 'S',
      tileX, tileY,
      worldX: src.worldX ?? (tileX * TS + TS / 2),
      worldY: src.worldY ?? (tileY * TS + TS / 2),
      homeTileX: tileX, homeTileY: tileY,
      assignedRoomId: null,
      behaviorType: 'guard',
      tags: [...(src.tags ?? [])],
      damageType: src.damageType ?? 'physical',
      attackRange: src.attackRange ?? 1,
      faction: 'adventurer', factionExpiresOn: null,
      raisedByAdvId: jinwoo.instanceId, tamedByAdvId: null,
      isMiniBoss: false,
      stats: {
        hp:      shadowHp,
        attack:  shadowAtk,
        defense: shadowDef,
        // 1.5× base speed — fast, but NOT as fast as the 2×-base Monarch, so
        // the shadow army trails him rather than matching pace. Jinwoo's speed
        // is 2× base, so 0.75× his speed = 1.5× base.
        speed:   (jinwoo.stats?.speed ?? 2.8) * 0.75,
        abilities: [...(src.stats?.abilities ?? [])],
      },
      resources: {
        hp:    shadowHp,
        maxHp: shadowHp,
      },
      level: src.level ?? 1, xp: 0,
      aiState: 'idle', currentTargetId: null, deathDay: null, killHistory: [],
      _shadowExtracted: true,
    }
    this._gameState.minions.push(shadow)
    EventBus.emit('MINION_SUMMONED', { minion: shadow, summoner: jinwoo })
    EventBus.emit('SHADOW_EXTRACTED', { minion: shadow, monarch: jinwoo })
    // Extraction VFX — a purple "ARISE" pop + shadow burst ring at the
    // raised minion (world-space; the screen-space cinematics live in
    // SoloLevelingCinematic).
    const scene = this._scene
    if (scene) {
      AbilityVfx.floatingText(scene, shadow.worldX, shadow.worldY - 16, 'ARISE', {
        color: '#c9a9ff', fontSize: '13px',
      })
      AbilityVfx.pulseRing(scene, shadow.worldX, shadow.worldY, { color: 0x9b2fe0 })
    }
  }

  // Jinwoo left the dungeon (died or — rare — fled). His shadows are bound
  // to him: they vanish the moment he's gone.
  _onShadowMonarchGone({ adventurer } = {}) {
    if (!adventurer?._shadowMonarch) return
    this._despawnShadows()
  }

  // Remove every shadow from the roster outright — their sprites are culled
  // on the renderer's next tick. Splicing (vs marking dead) guarantees no
  // faction='adventurer' entries linger into the next day.
  _despawnShadows() {
    const list = this._gameState.minions
    if (!Array.isArray(list)) return
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?._shadowExtracted) list.splice(i, 1)
    }
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    // Tear down any in-flight Twitch Con timers so a scene shutdown
    // mid-event doesn't leak Phaser timer events.
    this._stopTwitchConChaos()
    this._stopPatchZeroChaos()
    this._stopEventTimers()
    // Drop any Arcane Storm cooldown scaling so it can't leak past a
    // scene teardown into a fresh run.
    AbilitySystem.setCooldownScale(1)
  }

  // ── Scheduling ─────────────────────────────────────────────────────────

  // First-time scheduling: the first dungeon event lands on day 3, then
  // every MIN_GAP/MAX_GAP days after each one resolves.
  _initialNextDay() {
    return 3
  }

  _rollGap() {
    return MIN_GAP + Math.floor(Math.random() * (MAX_GAP - MIN_GAP + 1))
  }

  _eligibleEvents() {
    // Every event is eligible from day one — no boss-level or day-count
    // gate. The only filters are the no-repeat rule (an event can't fire
    // twice in a row) plus per-event state PRECONDITIONS (see _eventPrecondMet).
    // (`minBossLevel` in events.json is now vestigial — kept as a
    // difficulty-tier hint, not enforced.)
    const lastId = this._gameState.events.lastEventId
    return this._defs.filter(d => d.id !== lastId && this._eventPrecondMet(d))
  }

  // Conditional-eligibility gate. Most events are always eligible (returns
  // true); a few only make sense when the game is in a particular state.
  // First use (2026-05-27): Treasure Hunters can't fire if the player owns
  // no treasure chests — there'd be nothing to rob.
  _eventPrecondMet(def) {
    // Solo Leveling is DISABLED in the natural rotation for now — only the
    // mango TEST EVENT picker (DEV_FORCE_EVENT) can fire it, and that path
    // bypasses _eligibleEvents entirely (see _onDevForceEvent). Flip this
    // back to allow it to roll organically.
    if (def.id === 'solo_leveling') return false
    if (def.id === 'treasure_hunters') {
      return (this._gameState.dungeon?.treasureChests ?? []).length > 0
    }
    return true
  }

  _pickEvent() {
    const pool = this._eligibleEvents()
    if (pool.length === 0) return null
    return pool[Math.floor(Math.random() * pool.length)]
  }

  // ── Phase hooks ────────────────────────────────────────────────────────

  _onNightPhaseBegan() {
    const today = this._gameState.meta?.dayNumber ?? 1
    // Expire any mercenary contracts that have run their course.
    this._cullExpiredMercenaries()
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

    ev.scheduledId  = def.id
    // The day the event's effect actually plays out — used to schedule
    // the NEXT event from the correct anchor (see _onDayPhaseEnded).
    ev.scheduledDay = today
    EventBus.emit('DUNGEON_EVENT_ANNOUNCED', { def, day: today })
    this._dispatchAnnounceUi(def)
  }

  // Some events surface UI during the night phase (modals, demon spawn,
  // etc.) instead of waiting for day to begin. Routed here so EventSystem
  // owns "what fires when" and per-event handlers stay narrow.
  _dispatchAnnounceUi(def) {
    if (def.id === 'negotiation_day')    this._promptNegotiation()
    // Gambler's Coin no longer prompts on announce — GamblerImpRenderer
    // spawns the imp NPC; clicking it fires GAMBLER_IMP_CLICKED, which
    // surfaces the wager modal via _onGamblerImpClicked.
    if (def.id === 'memory_plague')      this._wipeKnowledgePool()
    if (def.id === 'black_market')       this._promptBlackMarket()
    if (def.id === 'mercenary_contract') this._promptMercenary()
    if (def.id === 'cursed_relic')       this._promptCursedRelic()
    // New events (2026-05-27)
    if (def.id === 'sacrificial_altar')  this._promptSacrificialAltar()
    // demons_wager — auto-prompts at announce per user direction
    // (2026-05-27). The DemonWagerRenderer NPC still spawns as visual
    // flavour during the night, but the modal no longer waits for a
    // click. Clicking the demon AFTER the modal is up is a no-op
    // because _promptDemonsWager early-returns on demonsWagerDecided.
    if (def.id === 'demons_wager')       this._promptDemonsWager()
    if (def.id === 'tinkerers_workshop') this._promptTinkerersWorkshop()
    // speedrun_channel — roll the class HERE (at announce) so the
    // NightPhase wave-preview can lock to it too. Stored on _eventFlags
    // so DayPhase reads the same value when spawning the actual wave.
    if (def.id === 'speedrun_channel') {
      const flags = this._gameState._eventFlags ?? (this._gameState._eventFlags = {})
      if (!flags.speedrunChannelClassId) {
        flags.speedrunChannelClassId = this._pickSpeedrunClass()
      }
    }
    // speedrun_channel resolves at DAY_PHASE_BEGAN via the wave-replace
    // flag, same pattern as zombie_horde / bounty_hunters.
    // Goblin Market — reprice the build menu for THIS night. Rolled here
    // (at announce) so the prices + badges are live the moment the build
    // night starts; guarded against re-roll on save/load re-entry.
    if (def.id === 'goblin_market')      this._rollGoblinMarketPrices()
  }

  // Goblin Market — roll a one-night buy-price multiplier for every
  // purchasable room / minion / trap / item. Discounts are capped at 0.5
  // (50% off) so they can never be cheaper than the 50%-of-base refund
  // (no buy-low/sell-back arbitrage); markups go up to +300% ("outrageous
  // ripoffs"). Only changed entries are stored, so the map doubles as the
  // "which cards show a badge" set. Idempotent — a stored map means we've
  // already rolled (save/load mid-night re-enters _dispatchAnnounceUi).
  _rollGoblinMarketPrices() {
    const flags = this._gameState._eventFlags ?? (this._gameState._eventFlags = {})
    if (flags.goblinMarketPrices) return   // already rolled this night
    const cache = this._scene?.cache?.json
    const ids = []
    const collect = (arr, skip) => {
      for (const d of (arr ?? [])) {
        if (!d?.id) continue
        if (skip && skip(d)) continue
        ids.push(d.id)
      }
    }
    collect(cache?.get?.('rooms'), d =>
      d.id === 'boss_chamber' || d.id === 'entry_hall' || d.placementRules?.fixed)
    collect(this._minionTypes)
    collect(cache?.get?.('trapTypes'))
    collect(cache?.get?.('items'), d => (d.goldCost ?? 0) <= 0)   // free items can't be repriced

    // Discount % (off) and markup % (up) menus — round values so the
    // build-menu badges read cleanly ("-30%", "+150%").
    const DISCOUNTS = [0.50, 0.45, 0.40, 0.35, 0.30, 0.25, 0.20, 0.15, 0.10]
    const MARKUPS   = [0.50, 1.00, 1.50, 2.00, 2.50, 3.00]
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

    const map = {}
    for (const id of ids) {
      const r = Math.random()
      if (r < 0.35) {
        map[id] = +(1 - pick(DISCOUNTS)).toFixed(2)        // 0.50 .. 0.90
      } else if (r < 0.80) {
        map[id] = +(1 + pick(MARKUPS)).toFixed(2)          // 1.50 .. 4.00
      }
      // else: unchanged — not stored (no badge, mult defaults to 1)
    }
    flags.goblinMarketPrices = map
    // Build menu (LeftPanels) re-renders on this so prices + badges update.
    EventBus.emit('GOBLIN_MARKET_PRICES_SET', { prices: map })
  }

  // Theme / icon / title for an event's SHOW_CONFIRM modal — pulled from
  // events.json so the confirm popup is styled to match the event banner
  // (ConfirmPopup renders the themed variant when payload.event is set).
  _eventConfirmMeta(id) {
    const def = this._defs.find(d => d.id === id) ?? {}
    return {
      theme: def.colorTheme ?? 'gold',
      icon:  def.icon ?? '',
      title: def.title ?? 'DUNGEON EVENT',
    }
  }

  // Build a styled messageNode for a SHOW_CONFIRM payload. Each row is
  // { kind, label, value } where kind is one of: cost / reward / wager
  // / win / lose / skip (drives the color theme via .qf-event-prompt-row
  // CSS variants). Used by every event prompt below — keeps the
  // headline-row typography consistent across the suite.
  _eventPromptNode(rows) {
    return h('div', { className: 'qf-event-prompt' },
      rows.map(r => h('div', { className: `qf-event-prompt-row ${r.kind ?? ''}` }, [
        h('div', { className: 'qf-event-prompt-label pix' }, r.label),
        h('div', { className: 'qf-event-prompt-value pix' }, r.value),
      ]))
    )
  }

  // ── Night-phase choice events ──────────────────────────────────────────
  // Black Market / Mercenary Contract / Cursed Relic — all surface a
  // SHOW_CONFIRM modal at announce. Each guards against re-prompt on a
  // save-load mid-night with a `*Decided` flag (cleared in _clearEffect).

  // Minion types unlocked at the current boss level.
  _unlockedMinionTypes() {
    const lv = this._gameState.boss?.level ?? 1
    return (this._minionTypes ?? []).filter(t => (t.unlockLevel ?? 1) <= lv)
  }

  // A random Tier-3 minion type — the chain[2] final form of an
  // evolution chain (used for the Mercenary Contract's elite hire).
  _randomTier3MinionType() {
    const chains = this._scene?.cache?.json?.get?.('minionEvolutions') ?? {}
    const tier3  = []
    for (const data of Object.values(chains)) {
      const chain = data?.chain
      if (Array.isArray(chain) && chain.length >= 3) tier3.push(chain[2])
    }
    if (tier3.length === 0) return null
    const id = tier3[Math.floor(Math.random() * tier3.length)]
    return (this._minionTypes ?? []).find(t => t.id === id) ?? null
  }

  // Drop an event-granted minion into a random non-boss room. Garrison
  // class so it never interferes with the Barracks cap. Returns the
  // minion, or null if the dungeon has no room to place it.
  _spawnEventMinion(typeDef, extra = {}) {
    if (!typeDef) return null
    const rooms = this._gameState.dungeon?.rooms ?? []
    const pool  = rooms.filter(r => r.definitionId !== 'boss_chamber')
    const src   = pool.length ? pool : rooms
    const room  = src[Math.floor(Math.random() * src.length)]
    if (!room) return null
    const tile = {
      x: room.gridX + Math.floor((room.width  ?? 1) / 2),
      y: room.gridY + Math.floor((room.height ?? 1) / 2),
    }
    const minion = createMinion(typeDef, tile, room.instanceId, {
      class:     'garrison',
      bossLevel: this._gameState.boss?.level ?? 1,
      dayNumber: this._gameState.meta?.dayNumber ?? 1,
    })
    Object.assign(minion, extra)
    this._gameState.minions ??= []
    this._gameState.minions.push(minion)
    EventBus.emit('MINION_PLACED', { minion })
    return minion
  }

  _promptBlackMarket() {
    const flags = this._gameState._eventFlags
    if (flags.blackMarketDecided) return
    // Scale by (day - 1) and (bossLv - 1) so the gold cost tracks
    // player wealth. See Balance.EVENT_BLACK_MARKET_* for the curve;
    // anchored to ~10% of the day-50 treasury (~2,000g at day 50 / lv 10).
    const _day    = this._gameState.meta?.dayNumber ?? 1
    const _bossLv = this._gameState.boss?.level     ?? 1
    const price = Math.round(
      Balance.EVENT_BLACK_MARKET_BASE_COST
      + Math.max(0, _day    - 1) * Balance.EVENT_BLACK_MARKET_PER_DAY
      + Math.max(0, _bossLv - 1) * Balance.EVENT_BLACK_MARKET_PER_BOSS_LV
    )
    EventBus.emit('SHOW_CONFIRM', {
      event: this._eventConfirmMeta('black_market'),
      messageNode: this._eventPromptNode([
        { kind: 'cost',   label: 'PAY',    value: `${price}g` },
        { kind: 'reward', label: 'REWARD', value: '1 RANDOM UNLOCKED MINION' },
      ]),
      confirmLabel: `BUY (${price}g)`,
      cancelLabel:  'DECLINE',
      onConfirm: () => {
        flags.blackMarketDecided = true
        const player = this._gameState.player
        if (!player || (player.gold ?? 0) < price) {
          EventBus.emit('SHOW_TOAST', { message: 'Not enough gold for the black market', type: 'error' })
          return
        }
        const types = this._unlockedMinionTypes()
        if (types.length === 0) return
        player.gold -= price
        const pick = types[Math.floor(Math.random() * types.length)]
        const m = this._spawnEventMinion(pick)
        EventBus.emit('SHOW_TOAST', {
          message: m ? `Black market — a ${pick.name ?? pick.id} joins your dungeon!`
                     : 'No room to place the minion',
          type: 'gold',
        })
      },
      onCancel: () => { flags.blackMarketDecided = true },
    })
  }

  _promptMercenary() {
    const flags = this._gameState._eventFlags
    if (flags.mercenaryDecided) return
    // Scale by (day - 1) and (bossLv - 1) so the gold cost tracks
    // player wealth. See Balance.EVENT_MERCENARY_* for the curve;
    // anchored to ~25% of the day-50 treasury (~5,000g at day 50 / lv 10).
    // Steeper than Black Market because the reward — a Tier 3 elite with
    // doubled stats for 3 days — is a far bigger combat asset.
    const _day    = this._gameState.meta?.dayNumber ?? 1
    const _bossLv = this._gameState.boss?.level     ?? 1
    const price = Math.round(
      Balance.EVENT_MERCENARY_BASE_COST
      + Math.max(0, _day    - 1) * Balance.EVENT_MERCENARY_PER_DAY
      + Math.max(0, _bossLv - 1) * Balance.EVENT_MERCENARY_PER_BOSS_LV
    )
    EventBus.emit('SHOW_CONFIRM', {
      event: this._eventConfirmMeta('mercenary_contract'),
      messageNode: this._eventPromptNode([
        { kind: 'cost',   label: 'PAY',    value: `${price}g` },
        { kind: 'reward', label: 'REWARD', value: 'ELITE TIER-3 MINION (3 DAYS)' },
      ]),
      confirmLabel: `HIRE (${price}g)`,
      cancelLabel:  'DECLINE',
      onConfirm: () => {
        flags.mercenaryDecided = true
        const player = this._gameState.player
        if (!player || (player.gold ?? 0) < price) {
          EventBus.emit('SHOW_TOAST', { message: 'Not enough gold to hire the mercenary', type: 'error' })
          return
        }
        const pick = this._randomTier3MinionType()
        if (!pick) return
        player.gold -= price
        const day = this._gameState.meta?.dayNumber ?? 1
        const m = this._spawnEventMinion(pick, {
          _mercenary: true,
          _mercenaryUntilDay: day + 3,
          name: 'Mercenary',
        })
        if (m) {
          // Elite hire — double every combat stat. The `_base*` values
          // are doubled too so the buff survives the nightly re-scale
          // in MinionAISystem.respawnAll (applyMinionScaling recomputes
          // hp/attack from _baseMaxHp / _baseAtk each dawn).
          m._baseMaxHp      = (m._baseMaxHp ?? m.resources.maxHp) * 2
          m._baseAtk        = (m._baseAtk   ?? m.stats.attack)    * 2
          m.resources.maxHp = (m.resources.maxHp ?? 0) * 2
          m.resources.hp    = m.resources.maxHp
          m.stats.attack    = (m.stats.attack  ?? 0) * 2
          m.stats.defense   = (m.stats.defense ?? 0) * 2
        }
        EventBus.emit('SHOW_TOAST', {
          message: m ? `Mercenary hired — a ${pick.name ?? pick.id} fights for you!`
                     : 'No room for the mercenary',
          type: 'gold',
        })
      },
      onCancel: () => { flags.mercenaryDecided = true },
    })
  }

  _promptCursedRelic() {
    const flags = this._gameState._eventFlags
    if (flags.cursedRelicDecided) return
    // Preview the relic chest's tier + gold/day so the player can see
    // the offer before deciding. Mirrors the formula in
    // _placeCursedRelic (which runs again on confirm — single source
    // of truth for the chest itself; this is just the preview).
    const _crLv = this._gameState.boss?.level ?? 1
    const _crTier = Math.max(1, Math.min(
      Balance.EVENT_CURSED_RELIC_TIER_MAX ?? 10,
      (Balance.EVENT_CURSED_RELIC_TIER_BASE ?? 4)
        + Math.floor(Math.max(0, _crLv - 1) / 2) * (Balance.EVENT_CURSED_RELIC_TIER_PER_2_LV ?? 1)
    ))
    const _crItems = this._scene?.cache?.json?.get?.('items') ?? []
    const _crGoldPerDay = _crItems.find(i => i.id === `treasure_chest_${_crTier}`)?.treasure?.goldPerDay ?? 0
    EventBus.emit('SHOW_CONFIRM', {
      event: this._eventConfirmMeta('cursed_relic'),
      messageNode: this._eventPromptNode([
        { kind: 'reward', label: 'REWARD', value: `TIER ${_crTier} CHEST (${_crGoldPerDay}g/DAY)` },
        { kind: 'cost',   label: 'CURSE',  value: 'EVERY ADVENTURER WAVE DOUBLES WHILE KEPT' },
      ]),
      confirmLabel: 'CLAIM',
      cancelLabel:  'BANISH',
      onConfirm: () => {
        flags.cursedRelicDecided = true
        this._placeCursedRelic()
      },
      onCancel: () => { flags.cursedRelicDecided = true },
    })
  }

  // Drop the cursed relic — a high-tier treasure chest tagged `_cursed`
  // — into the boss room. TreasureChestRenderer paints it with a purple-
  // black glow; DayPhase swells waves while it exists; the player can
  // SELL it like any treasure chest to lift the curse.
  //
  // Tier scales with boss level so the reward stays proportional to the
  // era. Previously the chest was hardcoded tier 5 (80g/day), which by
  // day 50 was dwarfed by the wave-doubling kill income (+660g/day) and
  // made the curse a net-positive grab. Now:
  //   bossLv 1  → tier 4   (55g/day)
  //   bossLv 5  → tier 6   (110g/day)
  //   bossLv 10 → tier 9   (230g/day)
  //   bossLv 12+ → tier 10 (300g/day, capped)
  _placeCursedRelic() {
    const rooms = this._gameState.dungeon?.rooms ?? []
    const bossRoom = rooms.find(r => r.definitionId === 'boss_chamber') ?? rooms[0]
    if (!bossRoom) return
    const tx = bossRoom.gridX + Math.floor((bossRoom.width  ?? 1) / 2)
    const ty = bossRoom.gridY + Math.floor((bossRoom.height ?? 1) / 2)
    const bossLv = this._gameState.boss?.level ?? 1
    const tier = Math.max(1, Math.min(
      Balance.EVENT_CURSED_RELIC_TIER_MAX ?? 10,
      (Balance.EVENT_CURSED_RELIC_TIER_BASE ?? 4)
        + Math.floor(Math.max(0, bossLv - 1) / 2) * (Balance.EVENT_CURSED_RELIC_TIER_PER_2_LV ?? 1)
    ))
    this._gameState.dungeon.treasureChests ??= []
    this._gameState.dungeon.treasureChests.push({
      instanceId: `cursed_relic_${Date.now()}`,
      tileX: tx, tileY: ty, tier, opened: false, _cursed: true,
    })
    EventBus.emit('TREASURE_CHEST_PLACED', { tier, tileX: tx, tileY: ty, cursed: true })
    EventBus.emit('SHOW_TOAST', { message: 'The cursed relic festers in your hoard…', type: 'leak' })
  }

  // ── Sacrificial Altar (KNOWN cost + random reward) ─────────────────────
  // Per user direction (2026-05-27 v2): the cost is rolled BEFORE the
  // modal opens so the player sees exactly what they're committing to;
  // only the reward stays a mystery. Cost pool is filtered to non-
  // trivial entries (zero gold / zero pacts / single roster minion all
  // dropped) so the bargain can never resolve to a free reward, and
  // boss-life is dropped at 1 life so the altar can't end the run on RNG.
  // Reward accumulates on player._altarMinionStatBuff and is read by
  // applyMinionScaling, so it survives every rescale + carries to future
  // placements automatically.
  _promptSacrificialAltar() {
    const flags = this._gameState._eventFlags
    if (flags.sacrificialAltarDecided) return
    const gs = this._gameState
    const player = gs.player
    if (!player) return

    // Pre-roll the cost so the player sees what they'll pay before
    // accepting. _rollAltarCost returns null when the pool is empty —
    // in that case the altar declines the bargain entirely.
    const rolled = this._rollAltarCost()
    if (!rolled) {
      flags.sacrificialAltarDecided = true
      EventBus.emit('SHOW_TOAST', {
        message: 'The altar finds nothing worth taking and crumbles to dust.',
        type: 'info', duration: 4500,
      })
      EventBus.emit('SACRIFICIAL_ALTAR_RESOLVED', { cost: 'none', reward: 0, totalReward: player._altarMinionStatBuff ?? 0 })
      return
    }

    // Stash the roll on the event flags so onConfirm can apply the
    // exact cost the player saw (vs re-rolling and surprising them).
    flags.sacrificialAltarCost = rolled

    EventBus.emit('SHOW_CONFIRM', {
      event: this._eventConfirmMeta('sacrificial_altar'),
      // Styled DOM body (2026-05-27 v3) — the PAY / REWARD lines are
      // the actual decision the player is making, so they should read
      // as headline rows, not body text. Two-row stack with the LABEL
      // small + dim and the VALUE big + bold + theme-coloured. CSS
      // class hooks live in styles.css under .qf-altar-prompt-*.
      messageNode: this._eventPromptNode([
        { kind: 'cost',   label: 'PAY',    value: rolled.label },
        { kind: 'reward', label: 'REWARD', value: 'RANDOM BUFF' },
      ]),
      confirmLabel: 'ACCEPT THE BARGAIN',
      cancelLabel:  'WALK AWAY',
      onConfirm: () => {
        flags.sacrificialAltarDecided = true
        this._resolveSacrificialAltar()
      },
      onCancel: () => {
        flags.sacrificialAltarDecided = true
        flags.sacrificialAltarCost = null
      },
    })
  }

  // Build the cost pool, drop trivial/catastrophic options, pick one.
  // Returns null when nothing is eligible (avoids the free-reward case).
  // Returned object carries:
  //   kind   — 'life' | 'gold' | 'pacts' | 'minions'
  //   label  — human-readable string used in the prompt header
  //   data   — kind-specific payload used by _resolveSacrificialAltar
  //            (the exact minions / pacts pre-selected so the rolled
  //            "Half your roster" promise is honoured by the SAME set
  //            the player saw — no second-roll surprise).
  _rollAltarCost() {
    const gs = this._gameState
    const player = gs.player
    if (!player) return null
    const roster = (gs.minions ?? []).filter(m =>
      m && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 &&
      m.faction === 'dungeon' &&
      // Garrison minions belong to rooms (Risen Bones, Revenants, Mini-
      // Bosses). Sacrificing those would break the room's refill logic
      // — exclude them. Only "free" roster minions are eligible.
      m.class !== 'garrison' && !m._isGoopling && !m._isDemonImp &&
      !m._isHauntGhost && !m._isVampireThrall && !m._myconidSprout)
    const activePacts = (gs.activeMechanics ?? []).slice()

    const costPool = []
    if (roster.length >= 2)                      costPool.push('minions')
    if ((player.gold ?? 0) >= 10)                costPool.push('gold')
    if (activePacts.length >= 2)                 costPool.push('pacts')
    if ((gs.boss?.deathsRemaining ?? 0) > 1)     costPool.push('life')
    if (costPool.length === 0) return null
    const kind = costPool[Math.floor(Math.random() * costPool.length)]

    // Labels are ALL-CAPS to match the pixel-font headline treatment
    // of the PAY/REWARD prompt rows (see _promptSacrificialAltar +
    // .qf-altar-prompt-value styling). Numeric values stay digits;
    // lowercase 'g' in gold + lowercase '—' em-dash are kept for
    // readability (raw-caps "G" reads as a separate word).
    if (kind === 'life') {
      const left = gs.boss?.deathsRemaining ?? 0
      return { kind, label: `A BOSS LIFE (${left} → ${left - 1} REMAINING)` }
    }
    if (kind === 'gold') {
      const lost = Math.floor((player.gold ?? 0) / 2)
      return { kind, label: `HALF YOUR GOLD (-${lost}g)`, data: { lost } }
    }
    if (kind === 'pacts') {
      const n = Math.floor(activePacts.length / 2)
      // Fisher-Yates partial shuffle to pre-select which N pacts get
      // burned. Store the IDs so resolve removes the SAME pacts the
      // player implicitly committed to (no second-roll).
      const shuffled = activePacts.slice()
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(Math.random() * (shuffled.length - i))
        const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp
      }
      const removed = shuffled.slice(0, n)
      return {
        kind,
        label: `${n} OF YOUR ${activePacts.length} ACTIVE PACTS (RANDOM)`,
        data: { removedPactIds: removed },
      }
    }
    if (kind === 'minions') {
      const n = Math.floor(roster.length / 2)
      const shuffled = roster.slice()
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(Math.random() * (shuffled.length - i))
        const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp
      }
      const sacrificed = shuffled.slice(0, n)
      // Persist instanceIds (not refs) — flags are JSON-serialised by
      // SaveSystem and a save/load between prompt + accept must still
      // resolve to the same minions.
      const sacrificedIds = sacrificed.map(m => m.instanceId).filter(Boolean)
      return {
        kind,
        label: `${n} OF YOUR ${roster.length} ROSTER MINIONS (RANDOM — NO REVIVAL)`,
        data: { sacrificedIds },
      }
    }
    return null
  }

  // Apply the pre-rolled cost + roll the random reward. Cost data comes
  // from flags.sacrificialAltarCost (stamped during _promptSacrificialAltar)
  // so the same items the player committed to are the ones consumed.
  _resolveSacrificialAltar() {
    const gs = this._gameState
    const player = gs.player
    if (!player) return
    const flags = gs._eventFlags ?? {}
    const rolled = flags.sacrificialAltarCost
    if (!rolled) return
    const costKind = rolled.kind

    // ── Apply the cost. Pre-rolled at prompt time (see _rollAltarCost),
    //    so this branch just consumes the captured data — no re-roll.
    let costText = ''
    if (costKind === 'life') {
      gs.boss.deathsRemaining = Math.max(1, (gs.boss.deathsRemaining ?? 1) - 1)
      costText = `A boss life was taken (${gs.boss.deathsRemaining} remaining)`
      EventBus.emit('BOSS_LIFE_LOST', { source: 'sacrificial_altar' })
    } else if (costKind === 'gold') {
      // Use the captured `lost` from the roll so the player loses exactly
      // what the modal showed (vs re-floored on a stale balance).
      const lost = rolled.data?.lost ?? Math.floor((player.gold ?? 0) / 2)
      player.gold = Math.max(0, (player.gold ?? 0) - lost)
      costText = `Half your gold was taken (-${lost}g)`
    } else if (costKind === 'pacts') {
      const removed = rolled.data?.removedPactIds ?? []
      const dms = this._scene?.dungeonMechanicSystem
      // Defensive: a pact could have been deactivated between prompt
      // and accept (e.g. another event). Skip any ids no longer active.
      const active = new Set(gs.activeMechanics ?? [])
      const actuallyRemoved = removed.filter(id => active.has(id))
      for (const id of actuallyRemoved) dms?.deactivate?.(id)
      costText = `${actuallyRemoved.length} pact${actuallyRemoved.length === 1 ? '' : 's'} undone`
    } else if (costKind === 'minions') {
      const ids = rolled.data?.sacrificedIds ?? []
      let count = 0
      for (const id of ids) {
        const idx = (gs.minions ?? []).findIndex(m => m && m.instanceId === id)
        if (idx < 0) continue                      // already dead / despawned since prompt
        const m = gs.minions[idx]
        gs.minions.splice(idx, 1)
        // Splice from the live roster; emit MINION_DIED with a perma flag
        // so renderers clean up sprites and MinionAISystem.respawnAll
        // skips them at the next dawn. No boss XP awarded.
        EventBus.emit('MINION_DIED', { minion: m, source: 'altar_sacrifice', perma: true })
        count++
      }
      costText = `${count} minion${count === 1 ? '' : 's'} sacrificed forever`
    }
    // Clear the stamped roll so the next event-fire starts fresh.
    flags.sacrificialAltarCost = null

    // ── Roll the reward (uniform over the six tiers).
    //
    //   minion_3   — +3% minion stats permanently
    //   minion_10  — +10% minion stats permanently
    //   boss_3     — +3% boss stats permanently (HP/ATK/DEF)
    //   boss_10    — +10% boss stats permanently
    //   boss_level — top up XP and force one level-up via _awardBossXp
    //                (fires the normal celebration + grid expansion +
    //                minion rescale, same as a natural level)
    //   free_pact  — opens the Grimoire (PactPicker via SHOW_DARK_PACT);
    //                player picks any of the 3 offered pacts. Existing
    //                PACT_SEALED pipeline handles activation.
    //
    // The reward roll is DECIDED here but the actual effect is APPLIED
    // by _applyAltarReward, invoked after the slot-machine reveal
    // cinematic (AltarRewardSlot.js) finishes via SACRIFICIAL_ALTAR_SPIN_DONE.
    // The cinematic is purely cosmetic — if the player dismisses it
    // early the reward still lands.
    const REWARDS = ['minion_3', 'minion_10', 'boss_3', 'boss_10', 'boss_level', 'free_pact']
    const rewardKind = REWARDS[Math.floor(Math.random() * REWARDS.length)]
    const rewardLabel = this._altarRewardLabel(rewardKind, player)

    EventBus.emit('SACRIFICIAL_ALTAR_RESOLVED', {
      cost:   costKind,
      reward: rewardKind,
    })
    EventBus.emit('SHOW_TOAST', { message: `Altar: ${costText}`, type: 'leak', duration: 4500 })

    // Kick off the slot-reel cinematic; the reward applies on its
    // dismiss callback. Stash the rolled reward + label on flags so a
    // save/load mid-spin can resume cleanly.
    flags.sacrificialAltarPendingReward = { rewardKind, rewardLabel }
    EventBus.emit('SACRIFICIAL_ALTAR_SPIN', { rewardKind, rewardLabel })
  }

  // Human-readable text for the slot-reveal "YOU RECEIVED" line + the
  // post-resolve toast. Computed at roll time so it can show the
  // BEFORE/AFTER stack total in the same string.
  _altarRewardLabel(rewardKind, player) {
    if (rewardKind === 'minion_3') {
      const total = (player._altarMinionStatBuff ?? 0) + 0.03
      return `+3% permanent minion stats (total: +${(total * 100).toFixed(0)}%)`
    }
    if (rewardKind === 'minion_10') {
      const total = (player._altarMinionStatBuff ?? 0) + 0.10
      return `+10% permanent minion stats (total: +${(total * 100).toFixed(0)}%)`
    }
    if (rewardKind === 'boss_3') {
      const total = (player._altarBossStatBuff ?? 0) + 0.03
      return `+3% permanent boss stats (total: +${(total * 100).toFixed(0)}%)`
    }
    if (rewardKind === 'boss_10') {
      const total = (player._altarBossStatBuff ?? 0) + 0.10
      return `+10% permanent boss stats (total: +${(total * 100).toFixed(0)}%)`
    }
    if (rewardKind === 'boss_level') {
      const nextLv = (this._gameState.boss?.level ?? 1) + 1
      return `+1 boss level — now Lv ${nextLv}`
    }
    if (rewardKind === 'free_pact') {
      return 'Free Dark Pact — choose in the Grimoire'
    }
    return ''
  }

  // AltarRewardSlot fires this once its reveal animation finishes (or
  // the player dismisses early). Applies the rolled reward effect.
  _onAltarSpinDone() {
    const gs = this._gameState
    const player = gs.player
    if (!player) return
    const flags = gs._eventFlags ?? {}
    const pending = flags.sacrificialAltarPendingReward
    if (!pending) return
    flags.sacrificialAltarPendingReward = null
    const { rewardKind, rewardLabel } = pending

    if (rewardKind === 'minion_3' || rewardKind === 'minion_10') {
      const pct = rewardKind === 'minion_3' ? 0.03 : 0.10
      player._altarMinionStatBuff = (player._altarMinionStatBuff ?? 0) + pct
      this._reapplyMinionScalingAll()
    } else if (rewardKind === 'boss_3' || rewardKind === 'boss_10') {
      const pct = rewardKind === 'boss_3' ? 0.03 : 0.10
      player._altarBossStatBuff = (player._altarBossStatBuff ?? 0) + pct
      this._scene?.bossSystem?._recomputeBossFightStats?.()
    } else if (rewardKind === 'boss_level') {
      const boss = gs.boss
      if (boss) {
        const oldLevel = boss.level ?? 1
        const need = Math.max(0, (boss.xpToNext ?? Balance.BOSS_XP_BASE) - (boss.xp ?? 0))
        boss.xp = (boss.xp ?? 0) + need
        this._scene?.aiSystem?._awardBossXp?.()
        // Mid-night level grant — the natural EndOfDay drain chain isn't
        // running, so manually chain into the SHOW_BOSS_LEVEL_UP →
        // SHOW_DARK_PACT celebration sequence so the player sees the same
        // overlay + pact picker they get from a normal end-of-day level-up.
        const newLevel = boss.level ?? oldLevel
        if (newLevel > oldLevel) {
          this._scene?.time?.delayedCall?.(50, () =>
            this._chainLevelUpCelebration(oldLevel, newLevel))
        }
      }
    } else if (rewardKind === 'free_pact') {
      // Slot has already closed by the time this fires — open the
      // Grimoire on the next tick so transitions don't overlap.
      this._scene?.time?.delayedCall?.(50, () => EventBus.emit('SHOW_DARK_PACT'))
    }

    EventBus.emit('SHOW_TOAST', { message: `Altar: ${rewardLabel}`, type: 'gold',  duration: 4500 })
  }

  // Walk every live minion through applyMinionScaling using its captured
  // bossLevel + scaledDay (preserved on the instance). The function reads
  // the new player._altarMinionStatBuff every call, so the stat boost
  // applies on next recompute.
  _reapplyMinionScalingAll() {
    const gs = this._gameState
    const bossLv = gs.boss?.level ?? 1
    const day    = gs.meta?.dayNumber ?? 1
    for (const m of gs.minions ?? []) {
      if (!m || m.aiState === 'dead') continue
      applyMinionScaling(m, m.bossLevel ?? bossLv, m._scaledDay ?? day)
    }
  }

  // ── Demon's Wager (boss-level coin flip) ───────────────────────────────
  // Click the demon NPC during night → coin-flip modal. Stake the boss's
  // level. WIN → +1 level (regular up-path). LOSE → -1 level (down-path
  // routed via BOSS_LEVEL_CHANGED, no celebratory listeners fire).
  // Refused at boss level 1 (demon dismisses; nothing to take).
  _promptDemonsWager() {
    const flags = this._gameState._eventFlags
    if (flags.demonsWagerDecided) return
    const bossLv = this._gameState.boss?.level ?? 1
    if (bossLv <= 1) {
      // The demon won't gamble with a "weak" boss — no level to lose.
      // Surface a flavour toast so the player understands why no modal.
      flags.demonsWagerDecided = true
      EventBus.emit('SHOW_TOAST', {
        message: 'The demon sneers — "you have nothing worth taking" — and vanishes.',
        type: 'info', duration: 4500,
      })
      return
    }
    EventBus.emit('SHOW_CONFIRM', {
      event: this._eventConfirmMeta('demons_wager'),
      messageNode: this._eventPromptNode([
        { kind: 'wager', label: 'WAGER', value: `BOSS LEVEL (${bossLv})` },
        { kind: 'win',   label: 'WIN',   value: `LV ${bossLv} → ${bossLv + 1}` },
        { kind: 'lose',  label: 'LOSE',  value: `LV ${bossLv} → ${bossLv - 1}` },
      ]),
      confirmLabel: 'WAGER',
      cancelLabel:  'DECLINE',
      onConfirm: () => {
        flags.demonsWagerDecided = true
        EventBus.emit('DEMON_WAGER_NPC_DISMISS')
        this._resolveDemonsWager()
      },
      onCancel: () => {
        flags.demonsWagerDecided = true
        EventBus.emit('DEMON_WAGER_NPC_DISMISS')
      },
    })
  }

  _resolveDemonsWager() {
    const boss = this._gameState.boss
    if (!boss) return
    // The demon's coin is loaded — 40% WIN / 60% LOSE. The wager looks
    // like a fair coin flip to the player (heads/tails), but the demon
    // always weights the odds in his favour. Flavour-justified by the
    // demon being, well, a demon; mechanically gates the +level reward
    // behind a real risk so it isn't a free expected-value gain.
    const won = Math.random() < 0.4
    const oldLevel = boss.level ?? 1
    // Demon-themed cinematic — reuses the CoinFlipCinematic event shape
    // with a `theme: 'demon'` marker so the renderer can swap palette + SFX.
    EventBus.emit('DEMON_WAGER_FLIP', {
      won, oldLevel,
      newLevel: oldLevel + (won ? +1 : -1),
      theme: 'demon',
    })
    if (won) {
      // Top up XP to threshold + use the existing level-up path so all
      // celebratory listeners (achievements, chat bubbles, level-up
      // overlay, grid expansion, gnoll-pack-refill, etc.) fire normally.
      const need = Math.max(0, (boss.xpToNext ?? Balance.BOSS_XP_BASE) - (boss.xp ?? 0))
      boss.xp = (boss.xp ?? 0) + need
      const tmpAi = this._scene?.aiSystem
      tmpAi?._awardBossXp?.()
      // The natural end-of-day chain (SHOW_BOSS_LEVEL_UP → SHOW_DARK_PACT)
      // is owned by EndOfDay.js, which isn't active mid-night. Wire a one-
      // shot listener for the cinematic-done signal (CoinFlipCinematic
      // emits DEMON_WAGER_CINEMATIC_DONE on _teardown for the demon
      // variant) so the celebration overlay + Grimoire pact picker open
      // AFTER the coin animation finishes, not on top of it. Fires for
      // both auto-close + click-to-dismiss paths.
      const newLevel = boss.level ?? oldLevel
      if (newLevel > oldLevel) {
        const onCinematicDone = () => {
          EventBus.off('DEMON_WAGER_CINEMATIC_DONE', onCinematicDone)
          this._chainLevelUpCelebration(oldLevel, newLevel)
        }
        EventBus.on('DEMON_WAGER_CINEMATIC_DONE', onCinematicDone)
      }
      return
    }
    // LOSE — drop a level. Stats re-derive from the canonical formula
    // in BossSystem._recomputeBossFightStats (additive + multiplicative
    // per-level scaling, plus the altar boss-stat buff if any) — NOT a
    // manual `-15 HP` subtract. The manual approach (used pre-2026-05-27)
    // wildly under-counted the drop at high levels because the real
    // formula stacks a 1.20^lvOver multiplier on HP and 1.10^lvOver on
    // ATK/DEF, so a lv 10 → 9 demotion needs to shed ~25% maxHp (1728 →
    // 1376), not just 15. The recompute function also snapshots + restores
    // the HP FRACTION across the rescale, so a wounded boss mid-fight
    // doesn't full-heal on a demotion.
    const newLevel = Math.max(1, oldLevel - 1)
    boss.level   = newLevel
    // Recompute xpToNext for the new (lower) level + clamp current xp.
    const raw = Balance.BOSS_XP_BASE * Math.pow(Balance.BOSS_XP_SCALE, newLevel - 1)
    boss.xpToNext = Math.ceil(raw / 10) * 10
    boss.xp = Math.min(boss.xp ?? 0, boss.xpToNext)
    // Re-derive maxHp / attack / defense from the new level. _recompute-
    // BossFightStats reads boss.level + the archetype's baseFightStats
    // + the altar boss-stat buff (if any) and snapshots/restores the
    // HP fraction across the rescale.
    this._scene?.bossSystem?._recomputeBossFightStats?.()
    EventBus.emit('BOSS_LEVEL_CHANGED', { newLevel, oldLevel, delta: -1, source: 'demons_wager' })
    EventBus.emit('BOSS_DIMINISHED', { newLevel, oldLevel })
    // Use the existing "error" sound channel — no new SFX file needed.
    EventBus.emit('SFX_PLAY', { id: 'error' })
  }

  // Open the level-up celebration overlay + Dark Pact picker for a mid-
  // night level grant (Demon's Wager WIN, Altar boss_level reward).
  //
  // Mirrors the EndOfDay.js drain pattern: emit SHOW_BOSS_LEVEL_UP for
  // every level gained (one popup per level for multi-level grants —
  // though current callers only ever grant +1), then on dismissal emit
  // SHOW_DARK_PACT once per level. Listeners are one-shots tied to this
  // helper's lifetime so a second mid-night grant later in the same
  // night spins up its own clean chain.
  _chainLevelUpCelebration(fromLevel, toLevel) {
    const queue = []
    for (let lv = fromLevel; lv < toLevel; lv++) {
      queue.push({ fromLevel: lv, toLevel: lv + 1 })
    }
    if (queue.length === 0) return
    let pactPicksRemaining = queue.length

    const onLevelUpDismissed = () => {
      if (queue.length > 0) {
        EventBus.emit('SHOW_BOSS_LEVEL_UP', queue.shift())
        return
      }
      EventBus.off('BOSS_LEVEL_UP_DISMISSED', onLevelUpDismissed)
      // After every queued level-up popup is dismissed, open the Grimoire —
      // one pact pick per level gained. Subsequent picks chain through
      // onPactSealed (deferred a beat to let the sealed picker animate out).
      pactPicksRemaining--
      EventBus.emit('SHOW_DARK_PACT')
    }
    const onPactSealed = () => {
      if (pactPicksRemaining > 0) {
        pactPicksRemaining--
        this._scene?.time?.delayedCall?.(600, () => EventBus.emit('SHOW_DARK_PACT'))
        return
      }
      EventBus.off('DARK_PACT_SEALED', onPactSealed)
    }
    EventBus.on('BOSS_LEVEL_UP_DISMISSED', onLevelUpDismissed)
    EventBus.on('DARK_PACT_SEALED',        onPactSealed)

    // Kick the chain off with the first queued level-up.
    EventBus.emit('SHOW_BOSS_LEVEL_UP', queue.shift())
  }

  // ── Tinkerer's Workshop (per-room-type permanent upgrade) ──────────────
  // The goblin offers 3 unique upgrades drawn from room types the player
  // CURRENTLY OWNS that aren't already tinkered. Picking applies the
  // upgrade to that room TYPE — every current AND future placement of
  // that type benefits. Build menu surfaces an "★ UPGRADED" badge on
  // the upgraded type's card with hover-tooltip describing the effect.
  _promptTinkerersWorkshop() {
    const flags = this._gameState._eventFlags
    if (flags.tinkerersWorkshopDecided) return

    // Catalog of upgrades — keyed by room definitionId. Each entry has a
    // human-readable name + short description (used by the build-menu
    // hover tooltip + the picker modal). The mechanical effects are
    // wired into the individual systems (RoomBehaviorSystem, AISystem,
    // etc.) which check gameState._tinkeredRoomTypes for the type id.
    const TINKER_CATALOG = this._tinkerCatalog()

    // Eligible room types: those the player currently has placed AND not
    // already tinkered AND for which we have an upgrade defined.
    const placed = new Set((this._gameState.dungeon?.rooms ?? [])
      .map(r => r.definitionId)
      .filter(id => id && id !== 'boss_chamber' && id !== 'entry_hall'))
    const tinkered = new Set(this._gameState._tinkeredRoomTypes ?? [])
    const eligible = [...placed].filter(id => TINKER_CATALOG[id] && !tinkered.has(id))

    if (eligible.length === 0) {
      // Nothing to upgrade — flavour out the event so the player
      // understands why no picker.
      flags.tinkerersWorkshopDecided = true
      EventBus.emit('SHOW_TOAST', {
        message: 'The tinkerer shrugs — your dungeon has nothing left to improve. He moves on.',
        type: 'info', duration: 4500,
      })
      return
    }

    // Fisher-Yates partial shuffle to pick up to 3 distinct types.
    const pool = eligible.slice()
    const offerCount = Math.min(3, pool.length)
    for (let i = 0; i < offerCount; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i))
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp
    }
    // Build a roomId → display-name lookup from rooms.json so the picker
    // can label each card with the AFFECTED room (some upgrade names like
    // "Oracle's Tome" / "Cannonade" / "Tyrant Throne" don't make the
    // target room obvious from the name + description alone).
    const roomDefs = this._scene?.cache?.json?.get?.('rooms') ?? []
    const roomNameById = new Map(roomDefs.map(r => [r.id, r.name]))

    const offers = pool.slice(0, offerCount).map(id => ({
      roomId:      id,
      roomName:    roomNameById.get(id) ?? id.replace(/_/g, ' '),
      name:        TINKER_CATALOG[id].name,
      description: TINKER_CATALOG[id].description,
    }))

    EventBus.emit('SHOW_TINKERER_OFFER', { offers })
  }

  // Apply a tinkerer pick. Routed via EventBus from the picker UI
  // (HUD overlay listens for SHOW_TINKERER_OFFER and emits this when the
  // player picks a card).
  _onTinkererPicked({ roomId }) {
    if (!roomId) return
    const gs = this._gameState
    gs._tinkeredRoomTypes ??= []
    if (!gs._tinkeredRoomTypes.includes(roomId)) gs._tinkeredRoomTypes.push(roomId)
    EventBus.emit('TINKERER_UPGRADE_APPLIED', { roomId })
    EventBus.emit('SHOW_TOAST', {
      message: `${roomId.replace(/_/g, ' ')} upgraded — affects all current + future rooms of this type`,
      type: 'gold', duration: 4500,
    })
  }

  // The full upgrade catalog — 19 rooms, one entry each. Keep
  // descriptions short (build-menu hover tooltips have limited room).
  _tinkerCatalog() {
    return {
      // Description text appears on the picker cards AND the build-menu
      // hover tooltip — kept short (~30-50 chars) so cards don't bloat.
      starter_corridor:    { name: 'Greased Corridor',  description: '−25% damage taken in Corridors' },
      starter_barracks:    { name: 'Drill Sergeant',    description: '+5 roster slots per Barracks' },
      starter_guard_post:  { name: 'Eagle Eye',         description: '+25% Guard Post ambush damage' },
      crypt:               { name: 'Crowded Crypt',     description: '+2 Risen Bones per Crypt (6 total)' },
      trap_factory:        { name: 'Assembly Line',     description: '+1 trap slot per Trap Factory' },
      treasury:            { name: 'Golden Vault',      description: 'Treasury stipend +50% · chests +1 tier' },
      armory:              { name: 'Weaponsmith',       description: 'Armory ATK aura doubled' },
      library_of_whispers: { name: "Oracle's Tome",     description: '+1 boss XP per kill, per Library' },
      watchtower:          { name: 'Cannonade',         description: '2× Watchtower first-strike damage' },
      wandering_gate:      { name: 'Skewed Gate',       description: 'Boss-chamber teleport 5% → 15%' },
      veil_of_forgetting:  { name: 'Deeper Veil',       description: 'Also wipes 2-hop neighbour intel' },
      catacombs:           { name: 'Restless Tomb',     description: '+1 Revenant per Catacombs (3 max)' },
      mimic_vault:         { name: 'Hungry Vault',      description: '+2 mimic slots per Vault' },
      hall_of_trials:      { name: 'Champion Trials',   description: 'Tier-3 spawn instead of Tier-2' },
      wishing_well:        { name: 'Cursed Well',       description: 'Curse chance 50% → 70%' },
      false_exit:          { name: 'Painful Landing',   description: 'Teleported fleers take 25% maxHp' },
      hall_of_madness:     { name: 'Total Frenzy',      description: 'Friendly-fire 60% → 90%' },
      throne_room:         { name: 'Tyrant Throne',     description: 'Mini-boss +50% HP and +50% ATK' },
      sanctum:             { name: "Sanctum's Heart",   description: 'Boss HP regen doubled' },
    }
  }

  // ── Speedrun Channel (wave-class lock) ─────────────────────────────────
  // Pick a random class from the curated pool. DayPhase reads this flag
  // when building today's wave and locks every spawn to this class.
  _pickSpeedrunClass() {
    // Curated pool — excludes event-only / monster / cheater classes that
    // shouldn't appear in normal waves AND twitch_streamer (per user
    // direction: streamer is already an event class via Twitch Con).
    const SPEEDRUN_POOL = [
      'knight', 'rogue', 'mage', 'cleric', 'ranger',
      'barbarian', 'monk', 'bard', 'necromancer', 'beast_master',
    ]
    return SPEEDRUN_POOL[Math.floor(Math.random() * SPEEDRUN_POOL.length)]
  }

  // Mercenaries serve a fixed contract then walk off the job. Checked
  // each night — any whose contract has run out is removed.
  _cullExpiredMercenaries() {
    const day = this._gameState.meta?.dayNumber ?? 1
    const minions = this._gameState.minions
    if (!Array.isArray(minions)) return
    let left = 0
    for (let i = minions.length - 1; i >= 0; i--) {
      const m = minions[i]
      if (m?._mercenary && day > (m._mercenaryUntilDay ?? 0)) {
        minions.splice(i, 1)
        left++
      }
    }
    if (left > 0) {
      EventBus.emit('SHOW_TOAST', {
        message: `${left} mercenary contract${left === 1 ? '' : 's'} expired`, type: 'info',
      })
    }
  }

  // Dungeon event: The Gambler's Coin — a night-phase wager. 50/50 to
  // double the treasury or halve it. Re-prompt-safe via `gamblerDecided`.
  _promptGamblersCoin() {
    const flags = this._gameState._eventFlags
    if (flags.gamblerDecided) return
    const goldNow = this._gameState.player?.gold ?? 0
    const goldDouble = goldNow * 2
    const goldHalve  = Math.floor(goldNow / 2)
    EventBus.emit('SHOW_CONFIRM', {
      event: this._eventConfirmMeta('gamblers_coin'),
      messageNode: this._eventPromptNode([
        { kind: 'wager', label: 'WAGER', value: `YOUR GOLD (${goldNow}g)` },
        { kind: 'win',   label: 'WIN',   value: `DOUBLE → ${goldDouble}g` },
        { kind: 'lose',  label: 'LOSE',  value: `HALVE → ${goldHalve}g` },
      ]),
      confirmLabel: 'WAGER',
      cancelLabel:  'DECLINE',
      onConfirm: () => {
        flags.gamblerDecided = true
        // The imp's work is done — send it out of the dungeon.
        EventBus.emit('GAMBLER_IMP_DISMISS')
        const player = this._gameState.player
        if (!player) return
        const won = Math.random() < 0.5
        const goldBefore = goldNow
        const goldAfter  = won ? goldBefore * 2 : Math.floor(goldBefore / 2)
        player.gold = goldAfter
        // The full-screen coin-flip cinematic (CoinFlipCinematic.js)
        // dramatises the result — it replaces the old plain toast.
        // `canDouble` lets the cinematic offer a DOUBLE OR NOTHING follow-up.
        EventBus.emit('GAMBLER_COIN_FLIP', { won, goldBefore, goldAfter, canDouble: true })
      },
      onCancel: () => {
        flags.gamblerDecided = true
        EventBus.emit('GAMBLER_IMP_DISMISS')
      },
    })
  }

  // Dungeon event: Memory Plague — wipe the shared knowledge pool the
  // moment the event is announced (night), so the next day's wave spawns
  // with no inherited intel. One-shot, guarded against save-load re-fire.
  _wipeKnowledgePool() {
    const flags = this._gameState._eventFlags
    if (flags.memoryPlagueWiped) return
    flags.memoryPlagueWiped = true
    EventBus.emit('KNOWLEDGE_WIPE_ALL', {})
  }

  _promptNegotiation() {
    const flags = this._gameState._eventFlags
    // If the player has already decided this run's negotiation (e.g. from
    // a save mid-night), don't re-prompt.
    if (flags.negotiationDecided) return
    const goldNow   = this._gameState.player?.gold ?? 0
    const tribute   = Math.floor(goldNow * 0.25)
    EventBus.emit('SHOW_CONFIRM', {
      event: this._eventConfirmMeta('negotiation_day'),
      messageNode: this._eventPromptNode([
        { kind: 'cost',   label: 'PAY',    value: `${tribute}g (25% OF TREASURY)` },
        { kind: 'skip',   label: 'SKIP',   value: 'NO WAVE TOMORROW' },
        { kind: 'lose',   label: 'REFUSE', value: '+50% WAVE TOMORROW' },
      ]),
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
    // Gap is measured from the day the event actually FIRED, not from
    // `meta.dayNumber` here — by DAY_PHASE_ENDED the day counter has
    // already rolled to the next day, so reading it gave an off-by-one
    // (event on day 3 → next scheduled day 7 instead of 6).
    const firedDay  = ev.scheduledDay ?? this._gameState.meta?.dayNumber ?? 1
    ev.nextEventDay = firedDay + this._rollGap()
    ev.scheduledId  = null
    ev.scheduledDay = null
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
        // Seed the daily-loss-cap accumulator. Each escapee compounds
        // 10% off the current treasury; without a cap, a late-game
        // pack of 46 goblins fully escaping = 99.2% gold lost. We
        // snapshot today's starting treasury so _onAdventurerFled can
        // refuse a steal once the player has already lost
        // LOOT_GOBLIN_DAILY_LOSS_CAP_PCT of it.
        flags.lootGoblinStartGold = this._gameState.player?.gold ?? 0
        flags.lootGoblinStolenToday = 0
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
      case 'patch_zero':
        // PATCH 0.0.0 — entire day's wave is cheater class (DayPhase /
        // NightPhase wave-replacement hooks read patchZeroActive).
        // Anti-cheat gate in ClassAbilitySystem disabled by the same
        // flag. CombatSystem reads it for the bumped instakill chance
        // and the 2× kill-gold ban bounty. ClassAbilitySystem uses it
        // to halve teleport + speed-hack cooldowns. The two chaos
        // timers (glitch tiles + console command roulette) are spun
        // up here and torn down in _clearEffect.
        flags.patchZeroActive = true
        this._startPatchZeroChaos()
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
      case 'boss_royale':
        // DayPhase spawns the 11-boss gauntlet (one per other archetype)
        // instead of the normal wave. _spawnBossRoyale reads this flag.
        flags.bossRoyaleActive = true
        break
      case 'treasure_hunters':
        // DayPhase tags every spawned adv _treasureHunter; AISystem routes
        // them to chests (ignore the boss). The night sell-block keys off
        // events.scheduledId (the flag isn't set until now, day-begin).
        flags.treasureHuntersActive = true
        break
      case 'solo_leveling':
        // DayPhase spawns ONLY Sung Jinwoo (the Shadow Monarch) instead of
        // the normal wave. He beelines the boss, raises fallen minions as
        // shadows, and duels the boss stat-matched. _spawnSoloLeveling reads
        // this flag.
        flags.soloLevelingActive = true
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
      case 'tax_season': {
        // Guild tax — skim 20% of the treasury the instant the day
        // starts. The trade-off (2× kill gold) is applied in AISystem.
        flags.taxSeasonActive = true
        const player = this._gameState.player
        if (player) {
          const tax = Math.floor((player.gold ?? 0) * 0.20)
          player.gold = Math.max(0, (player.gold ?? 0) - tax)
          if (tax > 0) {
            EventBus.emit('SHOW_TOAST', { message: `Tax Season — ${tax} gold levied`, type: 'error' })
          }
        }
        break
      }
      case 'patrons_blessing':
        // Boss XP from every kill is doubled — applied in AISystem._kill.
        flags.patronsBlessingActive = true
        break
      case 'memory_plague':
        // The pool wipe already fired at announce (_wipeKnowledgePool).
        // Nothing to do at day start.
        break
      case 'gamblers_coin':
        // The wager resolved at announce via the night modal. No day effect.
        break
      case 'dense_fog':
        // KnowledgeSystem reads this flag — all intel gained today is
        // downgraded to RUMOR tier so exposure barely rises.
        flags.denseFogActive = true
        break
      case 'miasma':
        // Chip DoT on every combatant — see _miasmaTick.
        flags.miasmaActive = true
        this._startEventTimer(MIASMA_TICK_MS, this._miasmaTick)
        break
      case 'tremors':
        // Periodic quake on a random room — see _tremorTick. The counter
        // resets here so each day's tremors escalate from the base again.
        flags.tremorsActive = true
        this._tremorCount = 0
        this._startEventTimer(TREMOR_INTERVAL_MS, this._tremorTick)
        break
      case 'arcane_storm':
        // Class-ability cooldowns slashed dungeon-wide (AbilitySystem).
        flags.arcaneStormActive = true
        AbilitySystem.setCooldownScale(ARCANE_STORM_COOLDOWN_SCALE)
        break
      case 'bounty_hunters':
        // DayPhase replaces the wave with a hunter pack (_spawnBountyHunterWave).
        flags.bountyHuntersActive = true
        break
      case 'zombie_horde':
        // DayPhase replaces the wave with a zombie swarm (_spawnZombieHorde).
        flags.zombieHordeActive = true
        break
      case 'infamy_spike':
        // DayPhase reads this to inflate the wave + buff every adv to hero grade.
        flags.infamySpikeActive = true
        break
      case 'black_market':
      case 'mercenary_contract':
      case 'cursed_relic':
      case 'sacrificial_altar':
      case 'demons_wager':
      case 'tinkerers_workshop':
        // All resolved at announce via their night modal. No day effect.
        break
      case 'speedrun_channel':
        // DayPhase reads `speedrunChannelClassId` to lock today's wave
        // to one random class (see _spawnDailyAdventurers). The id is
        // pre-rolled at announce time (_dispatchAnnounceUi) so the
        // night-phase wave preview can show the correct locked class.
        // Defensive: if announce somehow didn't roll one, pick now.
        flags.speedrunChannelActive = true
        if (!flags.speedrunChannelClassId) {
          flags.speedrunChannelClassId = this._pickSpeedrunClass()
        }
        break
      case 'the_saboteur':
        // DayPhase replaces the wave with the lone Saboteur (_spawnSaboteur).
        flags.saboteurActive = true
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
      case 'patch_zero':
        flags.patchZeroActive = false
        this._stopPatchZeroChaos()
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
        flags.lootGoblinStartGold = null
        flags.lootGoblinStolenToday = null
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
      case 'boss_royale':
        flags.bossRoyaleActive = false
        break
      case 'treasure_hunters':
        flags.treasureHuntersActive = false
        break
      case 'solo_leveling':
        flags.soloLevelingActive = false
        // Belt-and-suspenders: drop any shadows still on the roster so
        // faction='adventurer' minions never persist into the next day.
        this._despawnShadows()
        break
      case 'goblin_market':
        // The peddler packs up — prices revert. Null the map + tell the
        // build menu to drop the badges and show normal prices again.
        flags.goblinMarketPrices = null
        EventBus.emit('GOBLIN_MARKET_PRICES_SET', { prices: null })
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
      case 'tax_season':
        flags.taxSeasonActive = false
        break
      case 'patrons_blessing':
        flags.patronsBlessingActive = false
        break
      case 'memory_plague':
        // Clear the one-shot guard so a future Memory Plague wipes again.
        flags.memoryPlagueWiped = false
        break
      case 'gamblers_coin':
        // Clear the decision guard so a future Gambler's Coin re-prompts.
        flags.gamblerDecided = false
        break
      case 'dense_fog':
        flags.denseFogActive = false
        break
      case 'miasma':
        flags.miasmaActive = false
        this._stopEventTimers()
        break
      case 'tremors':
        flags.tremorsActive = false
        this._tremorCount = 0
        this._stopEventTimers()
        break
      case 'arcane_storm':
        flags.arcaneStormActive = false
        AbilitySystem.setCooldownScale(1)
        break
      case 'bounty_hunters':
        flags.bountyHuntersActive = false
        break
      case 'zombie_horde':
        flags.zombieHordeActive = false
        break
      case 'infamy_spike':
        flags.infamySpikeActive = false
        break
      case 'black_market':
        flags.blackMarketDecided = false
        break
      case 'mercenary_contract':
        flags.mercenaryDecided = false
        break
      case 'cursed_relic':
        flags.cursedRelicDecided = false
        break
      case 'sacrificial_altar':
        flags.sacrificialAltarDecided        = false
        flags.sacrificialAltarCost           = null
        flags.sacrificialAltarPendingReward  = null
        break
      case 'demons_wager':
        flags.demonsWagerDecided = false
        break
      case 'tinkerers_workshop':
        flags.tinkerersWorkshopDecided = false
        break
      case 'speedrun_channel':
        flags.speedrunChannelActive  = false
        flags.speedrunChannelClassId = null
        break
      case 'the_saboteur':
        flags.saboteurActive = false
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
  // Stacks per goblin, capped at LOOT_GOBLIN_DAILY_LOSS_CAP_PCT of the
  // gold the player held when the event started. Without the cap, the
  // pack scaling (5 + (day-9)) makes the event run-ending late game
  // (day 50 = 46 goblins, full escape = 99% gold lost). With the cap,
  // the worst-case loss is bounded but individual goblin escapes still
  // sting (per-goblin steal stays a flat 10%, just truncated to the
  // remaining cap budget once we're at the floor).
  _onAdventurerFled({ adventurer }) {
    if (adventurer?.classId !== 'loot_goblin') return
    const player = this._gameState.player
    if (!player) return
    const flags = this._gameState._eventFlags ?? {}
    const startGold = flags.lootGoblinStartGold ?? (player.gold ?? 0)
    const stolenToday = flags.lootGoblinStolenToday ?? 0
    const cap = Math.floor(startGold * (Balance.LOOT_GOBLIN_DAILY_LOSS_CAP_PCT ?? 0.5))
    const remaining = Math.max(0, cap - stolenToday)
    // Per-goblin raw take: 10% of current treasury (unchanged compounding
    // behaviour up to the cap). Truncated to the remaining cap budget so
    // the LAST goblin to escape may steal less than 10% — keeps the cap
    // hard while preserving the "each escape compounds" feel up to it.
    const raw = Math.floor((player.gold ?? 0) * 0.10)
    const stolen = Math.min(raw, remaining)
    player.gold = Math.max(0, (player.gold ?? 0) - stolen)
    flags.lootGoblinStolenToday = stolenToday + stolen
    // Stamp the take on the adventurer so RunHistorySystem folds it into
    // the adventurers.known record the post-wave summary reads.
    adventurer.goldStolen = (adventurer.goldStolen ?? 0) + stolen
    EventBus.emit('LOOT_GOBLIN_ESCAPED', { adventurer, stolen })
  }

  // ── Day-long state-modifier event timers (Miasma / Tremors) ────────────
  // Looping Phaser scene timers (auto-pause with the game). Started in
  // _applyEffect, torn down in _clearEffect and destroy().

  _startEventTimer(delayMs, callback) {
    const time = this._scene?.time
    if (!time) return
    this._eventTimers.push(time.addEvent({
      delay: delayMs, loop: true, callback, callbackScope: this,
    }))
  }

  _stopEventTimers() {
    for (const t of this._eventTimers) t?.remove?.(false)
    this._eventTimers = []
  }

  // Miasma — chip damage to every living combatant each tick. Invaders
  // bleed to death (their AISystem tick kills them at hp<=0); your
  // minions are weakened but never killed by the fumes alone, and the
  // boss is whittled toward — but never below — a 25% HP floor.
  _miasmaTick() {
    if (!this._gameState._eventFlags?.miasmaActive) return
    // % of maxHp per tick, floored at 1 dmg so very-low-HP entities
    // still take a chip. Same pattern as MYCONID_SPORE_DMG_PCT_PER_TICK.
    const pct = Balance.MIASMA_TICK_PCT_PER_TICK ?? 0.004
    const dmgFor = (maxHp) => Math.max(1, Math.round((maxHp ?? 0) * pct))
    for (const a of this._gameState.adventurers?.active ?? []) {
      if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      const dmg = dmgFor(a.resources?.maxHp)
      a.resources.hp = Math.max(0, a.resources.hp - dmg)
    }
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const dmg = dmgFor(m.resources?.maxHp)
      m.resources.hp = Math.max(1, m.resources.hp - dmg)
    }
    const boss = this._gameState.boss
    if (boss && (boss.hp ?? 0) > 0 && boss.maxHp) {
      const floor = Math.max(1, Math.round(boss.maxHp * 0.25))
      const dmg = dmgFor(boss.maxHp)
      boss.hp = Math.max(floor, boss.hp - dmg)
    }
  }

  // Tremors — a quake rocks one random non-boss room: screen shake plus a
  // damage hit to everything standing in it. Invaders can be killed by
  // the collapse; your minions take a non-lethal floor of 1 HP. Each quake
  // this day hits harder than the last (TREMOR_DMG_STEP). Every hit emits
  // COMBAT_HIT so CombatFeedback floats a damage number over the victim,
  // and an "EARTHQUAKE" label pops above the struck room.
  _tremorTick() {
    if (!this._gameState._eventFlags?.tremorsActive) return
    const rooms = (this._gameState.dungeon?.rooms ?? [])
      .filter(r => r.definitionId !== 'boss_chamber')
    if (rooms.length === 0) return
    const room = rooms[Math.floor(Math.random() * rooms.length)]
    const inRoom = (e) =>
      e && e.tileX >= room.gridX && e.tileX < room.gridX + (room.width ?? 1) &&
      e.tileY >= room.gridY && e.tileY < room.gridY + (room.height ?? 1)

    // Escalating damage as a fraction of each target's maxHp — first
    // quake = TREMOR_PCT_BASE, each later quake adds TREMOR_PCT_STEP,
    // capped per-hit at TREMOR_PCT_CAP so a late-day quake can't insta-
    // kill. Final per-target damage is computed against THAT target's
    // own maxHp, so a frail mage and a tanky knight both lose a
    // proportional chunk in the same quake.
    const tremorPct = Math.min(
      Balance.TREMOR_PCT_CAP ?? 0.15,
      (Balance.TREMOR_PCT_BASE ?? 0.03)
        + (Balance.TREMOR_PCT_STEP ?? 0.015) * (this._tremorCount ?? 0)
    )
    this._tremorCount = (this._tremorCount ?? 0) + 1
    const dmgFor = (maxHp) => Math.max(1, Math.round((maxHp ?? 0) * tremorPct))

    // Track the largest per-target damage so the floating label + the
    // TREMOR_STRUCK event have a meaningful number to display. With
    // percent-based damage every target's `dmg` differs; the prior
    // code referenced a loop-local `dmg` outside both loops, throwing
    // ReferenceError when the second loop was empty (or the first if
    // both were empty). Aggregating here is crash-safe AND gives the
    // player a sensible peak-damage readout. (2026-05-27 freeze fix —
    // EventSystem.js:1632 ReferenceError on day 56.)
    let maxDmg = 0
    for (const a of this._gameState.adventurers?.active ?? []) {
      if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      if (!inRoom(a)) continue
      const dmg = dmgFor(a.resources?.maxHp)
      if (dmg > maxDmg) maxDmg = dmg
      a.resources.hp = Math.max(0, a.resources.hp - dmg)
      EventBus.emit('COMBAT_HIT', {
        sourceId: 'tremor', targetId: a.instanceId,
        damage: dmg, damageType: 'earthquake', isCritical: false,
      })
    }
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (!inRoom(m)) continue
      const dmg = dmgFor(m.resources?.maxHp)
      if (dmg > maxDmg) maxDmg = dmg
      m.resources.hp = Math.max(1, m.resources.hp - dmg)
      EventBus.emit('COMBAT_HIT', {
        sourceId: 'tremor', targetId: m.instanceId,
        damage: dmg, damageType: 'earthquake', isCritical: false,
      })
    }
    this._scene?.cameras?.main?.shake?.(360, 0.012)
    // Skip the floating "-N" label when nothing was actually hit
    // (empty room). The screen-shake still fires so the tremor reads
    // as a real environmental event; the misleading "-0" is just gone.
    if (maxDmg > 0) this._tremorLabel(room, maxDmg)
    EventBus.emit('TREMOR_STRUCK', { roomId: room.instanceId, damage: maxDmg })
  }

  // Floating "EARTHQUAKE -dmg" label above the struck room's center —
  // mirrors the Golem earthquake floater so the player can read the hit.
  _tremorLabel(room, dmg) {
    const game = this._scene
    if (!game?.add || !room) return
    const TS = Balance.TILE_SIZE
    const cx = (room.gridX + (room.width  ?? 1) / 2) * TS
    const cy = (room.gridY + (room.height ?? 1) / 2) * TS
    const txt = game.add.text(cx, cy, `EARTHQUAKE\n-${dmg}`, {
      fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold',
      color: '#ffcc66', stroke: '#3a1a00', strokeThickness: 4,
      align: 'center',
    }).setOrigin(0.5).setDepth(200)
    game.tweens?.add({
      targets: txt, y: cy - 36, alpha: 0,
      duration: 1100,
      onComplete: () => txt.destroy(),
    })
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

  // ── PATCH 0.0.0 chaos timers ──────────────────────────────────────────
  // Two looping Phaser timers running for the day:
  //   1. Glitch tiles — every ~1.2 s pick a random floor tile and fire
  //      an RGB particle burst there. Purely cosmetic — sells the "the
  //      whole server is glitching" vibe without any gameplay impact.
  //   2. Console command roulette — every ~8 s pick from a curated list
  //      of fake admin commands and fire its effect. A floating
  //      "> /command" banner shows over the dungeon centre so the
  //      player sees which exploit just dropped.
  _startPatchZeroChaos() {
    this._stopPatchZeroChaos()
    const time = this._scene?.time
    if (!time) return
    this._patchZeroTimers.push(time.addEvent({
      delay:    Balance.PATCH_ZERO_GLITCH_TILE_MS ?? 1200,
      loop:     true,
      callback: this._patchZeroGlitchTileTick,
      callbackScope: this,
    }))
    this._patchZeroTimers.push(time.addEvent({
      delay:    Balance.PATCH_ZERO_CONSOLE_CMD_MS ?? 8000,
      loop:     true,
      callback: this._patchZeroConsoleCmdTick,
      callbackScope: this,
    }))
  }

  _stopPatchZeroChaos() {
    for (const t of this._patchZeroTimers) t?.remove?.(false)
    this._patchZeroTimers = []
  }

  // Pick a random in-bounds floor tile and fire an RGB-cycling particle
  // burst at its world center. No state changes — purely visual chaos.
  _patchZeroGlitchTileTick() {
    if (!this._gameState._eventFlags?.patchZeroActive) return
    const grid = this._scene?.dungeonGrid
    if (!grid?.getRoomAtTile) return
    const rooms = this._gameState.dungeon?.rooms ?? []
    if (rooms.length === 0) return
    const room = rooms[Math.floor(Math.random() * rooms.length)]
    if (!room) return
    const tx = room.gridX + Math.floor(Math.random() * room.width)
    const ty = room.gridY + Math.floor(Math.random() * room.height)
    const TS = Balance.TILE_SIZE
    const wx = tx * TS + TS / 2
    const wy = ty * TS + TS / 2
    // Lazy import — keeps EventSystem free of UI cycles at module load.
    import('../util/cheaterVfx.js').then(({ rgbParticleBurst }) => {
      rgbParticleBurst(this._scene, wx, wy,
        { count: 8, durationMs: 380, speed: 50, depth: 1.5 })
    }).catch(() => {})
  }

  // Roulette of "admin console commands" that fire random server-side
  // effects. Each entry is `{ name, fire }`. The pool sits inline so
  // adding/removing commands is a one-place edit.
  _patchZeroConsoleCmdTick() {
    if (!this._gameState._eventFlags?.patchZeroActive) return
    const cmds = [
      { name: '/godmode_minion',  fire: () => this._cmdGodmodeMinion() },
      { name: '/banhammer',       fire: () => this._cmdBanhammer() },
      { name: '/give_gold',       fire: () => this._cmdGiveGold() },
      { name: '/lag_switch',      fire: () => this._cmdLagSwitch() },
      { name: '/buff_boss',       fire: () => this._cmdBuffBoss() },
      { name: '/respawn',         fire: () => this._cmdRespawn() },
      { name: '/fps_drop',        fire: () => this._cmdFpsDrop() },
      { name: '/spawn_extra',     fire: () => this._cmdSpawnExtra() },
    ]
    const pick = cmds[Math.floor(Math.random() * cmds.length)]
    if (!pick) return
    // Banner floater over the dungeon centre — uses the same RGB
    // helper as the cheater floaters so the visual language stays
    // consistent across the event.
    const grid = this._scene?.dungeonGrid
    const w = (grid?.getWidth?.()  ?? 30) * Balance.TILE_SIZE
    const h = (grid?.getHeight?.() ?? 30) * Balance.TILE_SIZE
    import('../util/cheaterVfx.js').then(({ rgbFloatingText }) => {
      rgbFloatingText(this._scene, w * 0.5, h * 0.5,
        `> ${pick.name}`, { fontSize: '18px', durationMs: 1600, driftY: -40 })
    }).catch(() => {})
    EventBus.emit('PATCH_ZERO_CONSOLE_CMD', { cmd: pick.name })
    try { pick.fire() } catch (e) { /* swallow — chaos shouldn't crash the day */ }
  }

  // ── Console command effects ───────────────────────────────────────────
  // /godmode_minion — random dungeon-faction minion full-heals + 2× defense for 5 s.
  _cmdGodmodeMinion() {
    const alive = (this._gameState.minions ?? []).filter(m =>
      m && m.faction === 'dungeon' && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0,
    )
    if (alive.length === 0) return
    const m = alive[Math.floor(Math.random() * alive.length)]
    if (m?.resources?.maxHp) m.resources.hp = m.resources.maxHp
    if (m?.stats) {
      m._godmodeOrigDef = m.stats.defense ?? 0
      m.stats.defense = (m.stats.defense ?? 0) * 2
      this._scene?.time?.delayedCall?.(5000, () => {
        if (m?.stats && m._godmodeOrigDef != null) {
          m.stats.defense = m._godmodeOrigDef
          delete m._godmodeOrigDef
        }
      })
    }
  }

  // /banhammer — instant-ban a random LIVE cheater. Set _reportCount
  // past threshold so ClassAbilitySystem flips them on the next tick.
  // Banned cheaters lose all cheats and forced-flee.
  _cmdBanhammer() {
    const cheaters = (this._gameState.adventurers?.active ?? []).filter(a =>
      a && a.classId === 'cheater' && !a._banned && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0,
    )
    if (cheaters.length === 0) return
    const target = cheaters[Math.floor(Math.random() * cheaters.length)]
    if (!target) return
    // PATCH 0.0.0 disables the normal ban check — but /banhammer
    // bypasses that by setting _banned directly. Mimic the same flee
    // handoff so the rest of the pipeline runs.
    target._banned = true
    target.goal = { type: 'FLEE', reason: 'cheater_banned', context: null }
    target.aiState = 'fleeing'
    target.path = null
    EventBus.emit('CHEATER_BANNED', { adventurer: target })
  }

  // /give_gold — drop a chunk of gold straight into the player's
  // treasury. The broken patch hands out resources for free.
  _cmdGiveGold() {
    const amount = 20 + Math.floor(Math.random() * 30)   // 20-49 gold
    if (this._gameState.player) {
      this._gameState.player.gold = (this._gameState.player.gold ?? 0) + amount
    }
    EventBus.emit('RESOURCES_AWARDED', { gold: amount, source: 'patch_zero_console' })
  }

  // /lag_switch — global time scale to 0.6 for 2 s, then snap back.
  // Uses scene.time.delayedCall (not setTimeout) so the restore
  // pauses cleanly with the game and auto-cancels if the scene shuts
  // down before the 2 s elapses. Without this, a player pausing
  // mid-lag-spike would see the speed restore fire on real time and
  // the game would resume at 1.0× while still meant to be at 0.6×.
  _cmdLagSwitch() {
    const t = this._scene?.time
    if (!t) return
    const prev = t.timeScale ?? 1
    t.timeScale = 0.6
    t.delayedCall?.(2000, () => {
      if (this._scene?.time) this._scene.time.timeScale = prev
    })
  }

  // /buff_boss — boss attack +50% for 5 s.
  _cmdBuffBoss() {
    const boss = this._gameState.boss
    if (!boss) return
    const baseAtk = boss.attack ?? 0
    if (baseAtk <= 0) return
    boss._patchZeroBuffOrigAtk = baseAtk
    boss.attack = Math.round(baseAtk * 1.5)
    this._scene?.time?.delayedCall?.(5000, () => {
      if (boss && boss._patchZeroBuffOrigAtk != null) {
        boss.attack = boss._patchZeroBuffOrigAtk
        delete boss._patchZeroBuffOrigAtk
      }
    })
  }

  // /respawn — revive ONE dead dungeon-faction minion at full HP.
  // Helpful for the player; the patch is "broken in their favor".
  // We deliberately do NOT emit MINION_PLACED here — that event is
  // the "player just built a new minion" signal and triggers
  // KnowledgeSystem intel seeding, Pestilence HP-halving on first
  // placement, NpcDirector flavor lines, etc. A console-command
  // revive should slip back into play without retriggering those.
  // The dedicated MINION_REVIVED event is purely informational so the
  // renderer (or future systems) can react if they want.
  _cmdRespawn() {
    const dead = (this._gameState.minions ?? []).filter(m =>
      m && m.faction === 'dungeon' && (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0),
    )
    if (dead.length === 0) return
    const m = dead[Math.floor(Math.random() * dead.length)]
    if (!m) return
    m.aiState = 'idle'
    if (m.resources?.maxHp) m.resources.hp = m.resources.maxHp
    m.tileX = m.homeTileX ?? m.tileX
    m.tileY = m.homeTileY ?? m.tileY
    const TS = Balance.TILE_SIZE
    m.worldX = (m.tileX ?? 0) * TS + TS / 2
    m.worldY = (m.tileY ?? 0) * TS + TS / 2
    EventBus.emit('MINION_REVIVED', { minion: m, source: 'patch_zero_console' })
  }

  // /fps_drop — extra burst of glitch tiles for 1.5 s. Pure visual.
  _cmdFpsDrop() {
    const t = this._scene?.time
    if (!t) return
    for (let i = 0; i < 6; i++) {
      t.delayedCall(i * 220, () => this._patchZeroGlitchTileTick())
    }
  }

  // /spawn_extra — add one extra Cheater to the active wave. Spawns
  // at a random non-boss-room floor tile (no-clip cheats handle the
  // pathing from wherever they land).
  _cmdSpawnExtra() {
    const ai = this._scene?.aiSystem
    if (!ai?.pickSpawnTile) return
    const allClasses = this._scene?.cache?.json?.get?.('adventurerClasses') ?? []
    const def = allClasses.find(c => c.id === 'cheater')
    if (!def) return
    const tile = ai.pickSpawnTile() ?? { x: 1, y: 1 }
    // Lazy-import so EventSystem doesn't depend on the entities module
    // at top level.
    import('../entities/Adventurer.js').then(({ createAdventurer }) => {
      const adv = createAdventurer(def, { x: tile.x, y: tile.y })
      adv.spawnTileX = tile.x
      adv.spawnTileY = tile.y
      this._gameState.adventurers?.active?.push(adv)
      EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: adv })
    }).catch(() => {})
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
  //
  // The boss chamber is OFF-LIMITS as a destination — the boss fight is
  // gated on adventurers reaching the throne by walking the dungeon, so a
  // !CLIP IT shortcut straight into the boss room is disallowed. The peer
  // pick filters out any streamer currently standing in it; the fallback
  // already only draws from non-boss rooms.
  _pickTeleportTile(self) {
    const boss = (this._gameState.dungeon?.rooms ?? [])
      .find(r => r.definitionId === 'boss_chamber')
    const inBoss = (tx, ty) => !!boss &&
      tx >= boss.gridX && tx < boss.gridX + boss.width &&
      ty >= boss.gridY && ty < boss.gridY + boss.height
    const others = this._liveTwitchStreamers()
      .filter(a => a !== self && !inBoss(a.tileX, a.tileY))
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
          case 1: { // raid a random UNVISITED non-boss room
            // Previously rolled from all non-boss rooms, which meant the
            // 4s reroll cadence sent streamers back into rooms they'd
            // already cleared — they ping-ponged between visited rooms
            // and never made it to the boss. Match the chat-poll's
            // unvisited filter so each freelance pick is a fresh
            // destination. When every non-boss room has been visited,
            // fall through to SEEK_BOSS instead of looping.
            const visited = new Set(adv.visitedRooms ?? [])
            const unvisited = nonBossRooms.filter(r => !visited.has(r.instanceId))
            if (unvisited.length > 0) {
              const room = unvisited[Math.floor(Math.random() * unvisited.length)]
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
  // via _onAdventurerEntered. Two caps: total raids/day (now scales with
  // day past day 10 so late-game floods feel real) and active-streamer
  // count (TWITCH_CON_RAID_STREAMER_CAP — keeps things from running away).
  _twitchRaidTick() {
    if (!this._gameState._eventFlags?.twitchConActive) return
    // Cap 1 — total raids this day. Scales with day past day 10 so late
    // game Twitch Con actually plays like a flood. Day 10: 2 raids,
    // Day 20: 5, Day 30: 8, Day 50: 14 (capped by the streamer cap
    // before all those raids realistically fire).
    const _day = this._gameState.meta?.dayNumber ?? 1
    const _raidCap = Math.floor(
      Balance.TWITCH_CON_RAID_MAX_BASE
      + Math.max(0, _day - 10) * Balance.TWITCH_CON_RAID_MAX_PER_DAY_PAST_10
    )
    if (this._twitchRaidsToday >= _raidCap) return
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

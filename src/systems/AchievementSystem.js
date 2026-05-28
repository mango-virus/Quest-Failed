// AchievementSystem — the runtime tracker for the 45-achievement set.
//
// Responsibilities:
//   • Subscribe to EventBus signals (BOSS_LEVELED_UP, ADVENTURER_DIED,
//     MINION_PLACED, RESOURCES_AWARDED, etc.) and accumulate metrics.
//   • Persist the accumulated metrics + the unlocked-id set via
//     PlayerProfile (which owns the localStorage keys).
//   • When a metric crosses a threshold from a definition in
//     `src/data/achievements.json`, mark the achievement unlocked, fire
//     the ACHIEVEMENT_UNLOCKED event (for toast + UI), and apply any
//     reward (companion unlock for `hoard_lord` → Zul'Gath).
//   • On first init with a non-empty save profile, retroactively unlock
//     any achievements whose threshold is already met (so adding the
//     system to an existing save doesn't reset the player's progress).
//
// Architecture notes:
//   • Singleton — one instance per session, lives across scene swaps.
//     `init()` is idempotent + must be called after Preload finishes
//     (when the `achievements` JSON cache entry exists).
//   • Three layers of state:
//       (a) CAREER metrics — cumulative + persisted to localStorage.
//           Things like total kills, max-days-in-any-run, room-types-
//           ever-placed.
//       (b) RUN metrics — reset on each new run (GAME_STATE_LOADED).
//           Things like rooms placed this run, max gold this run.
//       (c) DAY metrics — reset on each DAY_PHASE_BEGAN. Things like
//           kills today, trap-kills today, minions lost today.
//     DAY metrics roll up into CAREER metrics on DAY_PHASE_ENDED.
//   • Boss unlocks DO NOT need explicit reward handling — they're still
//     gated by `qf.player.maxBossLevel` in ArchetypeSelect (which the
//     same BOSS_LEVELED_UP event already drives). The achievement just
//     surfaces the milestone. Companion unlocks ARE handled here — the
//     reward.type === 'companion' path calls PlayerProfile.unlockCompanion.

import { EventBus } from './EventBus.js'
import { PlayerProfile } from './PlayerProfile.js'
import { UNLOCK_GATES } from '../data/bossUnlocks.js'
import { ACHIEVEMENT_BIT_ORDER } from '../data/achievementBitOrder.js'

// Reverse-lookup helper for the unlock-notification queue. Given the
// achievement id that just unlocked, returns the boss-archetype id it
// gates (if any) so the queue can push a "NEW BOSS UNLOCKED" card.
// UNLOCK_GATES maps boss id → { achId, ... }, so we have to scan
// values; the table is small (~9 entries) so the linear walk is cheap.
function _bossUnlockedByAchievement(achId) {
  if (!achId) return null
  for (const [bossId, gate] of Object.entries(UNLOCK_GATES)) {
    if (gate?.achId === achId) return bossId
  }
  return null
}

// Default career-metric shape. Used as the seed when `getAchievementMetrics()`
// returns {} (first-ever boot). Adding a new metric: append a default here
// AND wire its update path in one of the `_on*` handlers below.
const DEFAULT_METRICS = {
  // CAREER cumulative
  maxBossLevel:               0,
  killsTotal:                 0,
  soulsTotal:                 0,
  veteransKilled:             0,
  // Best single-run veteran-kill count (gates Veteran Exterminator —
  // 50 veterans in ONE run). Career total stays in veteransKilled.
  veteransKilledInRunMax:     0,
  // Career cumulative adventurer kills credited to traps (across ALL
  // runs). Gates Curtain Call (Rattle Bones unlock) — changed from the
  // per-run `trapKillsInRunMax` so the player can grind it over time.
  trapKillsTotal:             0,
  minionsPlacedTotal:         0,
  trapsPlacedTotal:           0,
  nonStarterRoomsPlacedTotal: 0,
  // CAREER cumulative (added 2026-05-28 — event + activity achievements)
  eventsSeenTotal:            0,   // dungeon events experienced (DUNGEON_EVENT_BEGAN)
  adventurersEnteredTotal:    0,   // adventurers that entered the dungeon
  daysSurvivedTotal:          0,   // total days survived across ALL runs
  goldEarnedTotal:            0,   // cumulative gold awarded
  bossKillsTotal:             0,   // career kills credited to the boss
  minionsLostTotal:           0,   // career minion deaths
  runsEndedTotal:             0,   // runs that reached game-over
  trapsFiredTotal:            0,   // career trap activations (not placements)
  bossDamageTakenTotal:       0,   // cumulative damage the boss has taken
  // CAREER best-of-any-run maxes
  daysSurvivedMax:            0,
  goldInRunMax:               0,
  bossKillsInRunMax:          0,
  killsInDayMax:              0,
  trapKillsInDayMax:          0,
  // Best-in-a-single-run count of adventurer kills credited to traps.
  // Gates the legendary `curtain_call` achievement (which unlocks Rattle
  // Bones). Mirrors `bossKillsInRunMax`'s tracking shape — incremented
  // in `_onAdventurerDied` whenever a death is sourced to a trap.
  trapKillsInRunMax:          0,
  // Longest streak of consecutive days survived in a single run during
  // which the boss took ZERO damage from ANY source — adventurer hits,
  // mechanic self-costs (Lightning HP cost), summon-add toll, etc. Once
  // a single damage event lands, the run's no-hit streak FREEZES — no
  // further days are added even if subsequent days are clean. The player
  // has to start a fresh run to climb again. Gates the legendary
  // `flawless_reign` achievement (Spectra unlock — 30 days untouched).
  daysSurvivedNoHitMax:       0,
  // Best global-leaderboard placement, stored as a SCORE so the
  // achievement system's `>= target` comparison works (rank is
  // lower-is-better). score = max(0, 4 - rank): #1 → 3, #2 → 2, #3 → 1,
  // outside top-3 → 0. Updated by recordLeaderboardRank(); gates the
  // three leaderboard_top1/2/3 legendaries (targets 3 / 2 / 1).
  leaderboardBestRankScore:   0,
  minionsInRunMax:            0,
  roomsInRunMax:              0,
  minionTypesActiveMax:       0,
  // CAREER one-shot booleans (stored as 0/1)
  partyWipedInDayEver:        0,
  noMinionsLostInDayEver:     0,
  // Defeated Sung Jinwoo in the Solo Leveling event — gates monarch_slayer
  // (→ necroknight companion). Seeded here so it persists + appears in the
  // metric snapshot; set to 1 by the boss-fight resolution handler.
  shadowMonarchDefeated:      0,
  // CAREER sets — persisted as arrays, hydrated to Sets in memory
  roomTypesPlaced:            [],
  trapTypesFired:             [],
  classesKilled:              [],
  personalitiesSeen:          [],
  eventTypesSeen:             [],
  companionsCompleted:        [],
}

class AchievementSystemImpl {
  constructor() {
    this._inited      = false
    this._defs        = []        // achievement definitions from JSON
    this._byId        = new Map() // id → def
    this._metrics     = null      // career metrics (hydrated from PlayerProfile)
    this._sets        = null      // hydrated Sets keyed by metric name
    this._runState    = null      // per-run transient counters
    this._dayState    = null      // per-day transient counters
    this._unsubs      = []        // EventBus disposers (for tear-down in tests)
  }

  // Boot — load definitions from the Phaser JSON cache + hydrate state +
  // subscribe to events + retroactively unlock anything already met.
  // Safe to call multiple times; the second + later call is a no-op.
  // Called from Preload at the end of create(), so the cache is populated.
  init(achievementDefs) {
    if (this._inited) return
    if (!Array.isArray(achievementDefs) || achievementDefs.length === 0) {
      console.warn('[AchievementSystem] init() called without definitions — skipping')
      return
    }
    this._defs = achievementDefs.slice()
    this._byId = new Map(this._defs.map(d => [d.id, d]))
    this._hydrate()
    this._subscribe()
    // Subscribe to NAME_CHANGED so switching player names mid-session
    // re-hydrates the in-memory state from the new name's slot. Without
    // this, the system would keep showing the previous name's unlocks
    // (in-memory metrics + sets) until a page refresh — confusing during
    // mango ↔ real-player testing.
    const onNameChanged = () => this._reloadForCurrentPlayer()
    EventBus.on('NAME_CHANGED', onNameChanged)
    this._unsubs.push(() => EventBus.off('NAME_CHANGED', onNameChanged))
    this._inited = true

    this._applyMangoUnlockAllIfNeeded()
    this._retroactiveScan()
  }

  // Re-hydrate everything for the current player name. Called when
  // NAME_CHANGED fires — re-reads metrics/sets from the new slot, wipes
  // per-run/per-day transient state (a fresh name shouldn't inherit
  // mid-run state from the previous name), and re-runs the mango bulk
  // unlock + retroactive scan in case the new name is mango or has
  // pending retroactive thresholds.
  _reloadForCurrentPlayer() {
    this._hydrate()
    this._applyMangoUnlockAllIfNeeded()
    this._retroactiveScan()
  }

  // Mango cheat — silently force-unlock every achievement so the
  // overlay shows them all unlocked + every title-bearing achievement
  // grants its title + every companion-reward achievement (Hoard Lord
  // → Zul'Gath) fires its reward. Runs BEFORE the retroactive scan so
  // the scan finds nothing left to do. Silent (no toast cascade) — the
  // cheat name unlocks should be invisible-by-design (`mango` already
  // bypasses every gate elsewhere; this just makes the achievement UI
  // match that bypass).
  //
  // Per-name storage (refactor 2026-05-26): mango's writes land in the
  // mango slot ONLY, so switching to a non-mango name shows that
  // player's actual state — no bleed.
  _applyMangoUnlockAllIfNeeded() {
    if (!PlayerProfile.isCheatName?.()) return
    for (const def of this._defs) {
      const isFresh = PlayerProfile.unlockAchievement(def.id)
      if (!isFresh) continue
      if (def.reward?.type === 'companion' && def.reward.id) {
        PlayerProfile.unlockCompanion(def.reward.id)
      }
      if (def.title) {
        PlayerProfile.unlockTitle(def.id, def.title)
      }
    }
  }

  // Hydrate the metrics + sets from localStorage (via PlayerProfile).
  // Sets are stored as arrays + reconstituted in memory for O(1) add+has.
  _hydrate() {
    const persisted = PlayerProfile.getAchievementMetrics()
    this._metrics = { ...DEFAULT_METRICS, ...persisted }
    // Sync maxBossLevel with the canonical PlayerProfile value — the two
    // can drift if the player's profile was bumped before this system
    // existed; PlayerProfile wins as the source of truth.
    const profileMax = PlayerProfile.getMaxBossLevel?.() ?? 0
    if (profileMax > this._metrics.maxBossLevel) this._metrics.maxBossLevel = profileMax
    // Hydrate sets — persisted as arrays.
    this._sets = {
      roomTypesPlaced:     new Set(this._metrics.roomTypesPlaced || []),
      trapTypesFired:      new Set(this._metrics.trapTypesFired || []),
      classesKilled:       new Set(this._metrics.classesKilled || []),
      personalitiesSeen:   new Set(this._metrics.personalitiesSeen || []),
      companionsCompleted: new Set(this._metrics.companionsCompleted || []),
      eventTypesSeen:      new Set(this._metrics.eventTypesSeen || []),
    }
    this._resetRunState()
    this._resetDayState()
  }

  _resetRunState() {
    this._runState = {
      goldMax:           0,
      roomsPlaced:       0,
      minionsPlaced:     0,
      bossKills:         0,
      // Veterans (returning escapees) killed this run — feeds the per-run
      // best `veteransKilledInRunMax` (Veteran Exterminator). Career total
      // is the separate metric `veteransKilled` (Veteran's Bane).
      veteransKilled:    0,
      // Trap-credited kills this run. Feeds the per-run best
      // (trapKillsInRunMax) + rolls into the career trapKillsTotal that
      // now gates Curtain Call (Rattle Bones unlock — 500 trap kills
      // ACROSS ALL RUNS). Mirrors the bossKills pattern.
      trapKills:         0,
      // Live-set of active minion types this run (for minionTypesActiveMax).
      activeMinionTypes: new Set(),
      // No-hit run tracking (Flawless Reign legendary — Spectra unlock).
      // `bossEverDamagedThisRun` flips to true the FIRST time the boss
      // takes any damage from any source in the run (combat, mechanic
      // self-cost, summon-add toll). Once true, it stays true for the
      // rest of the run — `daysSurvivedNoHit` stops incrementing.
      // The counter rolls up into the career metric `daysSurvivedNoHitMax`
      // at each DAY_PHASE_ENDED while the flag is still false.
      bossEverDamagedThisRun: false,
      daysSurvivedNoHit:      0,
    }
  }

  _resetDayState() {
    this._dayState = {
      kills:              0,
      trapKills:          0,
      minionsLost:        0,
      // Party-wipe detection — track per-party how many advs entered today
      // and how many were killed. If killed === entered for a party that
      // had 1+ members, that's a Total Annihilation.
      partyArrivals:      new Map(), // partyId → { entered, killed }
    }
  }

  // ── Subscriptions ─────────────────────────────────────────────────────
  _subscribe() {
    const on = (sig, fn) => {
      EventBus.on(sig, fn)
      this._unsubs.push(() => EventBus.off(sig, fn))
    }
    on('BOSS_LEVELED_UP',         (p) => this._onBossLeveledUp(p))
    on('ADVENTURER_DIED',         (p) => this._onAdventurerDied(p))
    on('ADVENTURER_ENTERED_DUNGEON', (p) => this._onAdventurerEntered(p))
    on('ADVENTURERS_SPAWNED',     (p) => this._onAdventurersSpawned(p))
    on('MINION_PLACED',           (p) => this._onMinionPlaced(p))
    on('MINION_DIED',             (p) => this._onMinionDied(p))
    on('MINION_REMOVED',          (p) => this._onMinionRemoved(p))
    on('TRAP_PLACED',             (p) => this._onTrapPlaced(p))
    on('TRAP_FIRED',              (p) => this._onTrapFired(p))
    on('ROOM_PLACED',             (p) => this._onRoomPlaced(p))
    on('RESOURCES_AWARDED',       (p) => this._onResourcesAwarded(p))
    on('DAY_PHASE_BEGAN',         () => this._onDayPhaseBegan())
    on('DAY_PHASE_ENDED',         (p) => this._onDayPhaseEnded(p))
    on('DUNGEON_EVENT_BEGAN',     (p) => this._onDungeonEventBegan(p))
    on('GAME_STATE_LOADED',       (p) => this._onGameStateLoaded(p))
    on('SHOW_GAME_OVER',          (p) => this._onGameOver(p))
    // Flawless Reign damage tracking — three signal paths, all flip the
    // per-run no-hit flag the same way. Splitting per-source emits keeps
    // existing payload shapes intact; we just normalise here.
    on('BOSS_DAMAGED',            (p) => this._onBossDamaged(p?.amount))
    on('SUMMON_ADD_DEATH_BOSS_TOLL', (p) => this._onBossDamaged(p?.amount))
    on('PACT_BOSS_LIGHTNING_FIRED', (p) => this._onBossDamaged(p?.selfCost))
  }

  // Flawless Reign damage signal — flips the per-run flag the first
  // time the boss loses HP from any source in a run. Once flipped, the
  // run's no-hit streak is frozen for the remainder of the run; the
  // player has to start a fresh run to chase 30 days clean.
  _onBossDamaged(amount) {
    if (!(amount > 0)) return
    // Career cumulative boss damage taken (The Unbreaking / Punching Bag).
    this._metrics.bossDamageTakenTotal = (this._metrics.bossDamageTakenTotal ?? 0) + amount
    this._persistMetrics()
    this._checkMetric('bossDamageTakenTotal')
    if (this._runState.bossEverDamagedThisRun) return  // no-hit streak already broken
    this._runState.bossEverDamagedThisRun = true
  }

  // Dungeon event experienced (Disturbance / Eventful / event-type sets).
  _onDungeonEventBegan(payload) {
    this._metrics.eventsSeenTotal = (this._metrics.eventsSeenTotal ?? 0) + 1
    const id = payload?.def?.id || null
    if (id && !this._sets.eventTypesSeen.has(id)) {
      this._sets.eventTypesSeen.add(id)
      this._checkMetric('eventTypesSeenCount')
    }
    this._persistMetrics()
    this._checkMetric('eventsSeenTotal')
  }

  // ── Handlers ──────────────────────────────────────────────────────────
  _onBossLeveledUp(payload) {
    const newLevel = payload?.newLevel ?? 1
    if (newLevel > this._metrics.maxBossLevel) {
      this._metrics.maxBossLevel = newLevel
      this._persistMetrics()
      this._checkMetric('maxBossLevel')
    }
  }

  _onAdventurerDied(payload) {
    const adv = payload?.adventurer || payload?.adv || null
    // Cumulative + per-day kills.
    this._metrics.killsTotal += 1
    this._dayState.kills += 1
    if (this._dayState.kills > this._metrics.killsInDayMax) {
      this._metrics.killsInDayMax = this._dayState.kills
    }
    // Track class set.
    const cls = adv?.classId || adv?.class || null
    if (cls && !this._sets.classesKilled.has(cls)) {
      this._sets.classesKilled.add(cls)
    }
    // Veterans (escapeCount > 0 means they fled a previous run and returned).
    if ((adv?.escapeCount ?? 0) > 0) {
      this._metrics.veteransKilled += 1
      this._runState.veteransKilled = (this._runState.veteransKilled ?? 0) + 1
      if (this._runState.veteransKilled > this._metrics.veteransKilledInRunMax) {
        this._metrics.veteransKilledInRunMax = this._runState.veteransKilled
      }
    }
    // Killer-source tracking — trap kills (per-day for Trap Master) +
    // boss kills (per-run for Boss Slayer).
    const cause     = payload?.cause || payload?.source || null
    const killerId  = payload?.killerId || payload?.killer || null
    const isTrap    = cause === 'trap' || cause === 'TRAP' ||
                      (typeof killerId === 'string' && killerId.startsWith('trap-'))
    if (isTrap) {
      this._dayState.trapKills += 1
      if (this._dayState.trapKills > this._metrics.trapKillsInDayMax) {
        this._metrics.trapKillsInDayMax = this._dayState.trapKills
      }
      // Per-run trap-kill best (still tracked for any per-run achievements).
      this._runState.trapKills += 1
      if (this._runState.trapKills > this._metrics.trapKillsInRunMax) {
        this._metrics.trapKillsInRunMax = this._runState.trapKills
      }
      // Career cumulative trap kills (for Curtain Call → Rattle Bones
      // unlock — now an across-all-runs total, not single-run).
      this._metrics.trapKillsTotal = (this._metrics.trapKillsTotal ?? 0) + 1
    }
    const isBoss = cause === 'boss' || killerId === 'boss' ||
                   killerId === 'boss-archetype'
    if (isBoss) {
      this._runState.bossKills += 1
      if (this._runState.bossKills > this._metrics.bossKillsInRunMax) {
        this._metrics.bossKillsInRunMax = this._runState.bossKills
      }
      // Career boss-kill count (Brawler / The Headsman).
      this._metrics.bossKillsTotal = (this._metrics.bossKillsTotal ?? 0) + 1
    }
    // Track party-wipe — find the adv's party and increment its killed count.
    if (adv?.partyId != null) {
      const rec = this._dayState.partyArrivals.get(adv.partyId)
      if (rec) {
        rec.killed += 1
        if (rec.killed >= rec.entered && rec.entered > 0) {
          this._metrics.partyWipedInDayEver = 1
          this._checkMetric('partyWipedInDayEver')
        }
      }
    }
    // Solo Leveling — the legendary 'monarch_slayer' achievement (→ Necroknight
    // companion + "King of the Dead" title) is earned ONLY when the player's
    // BOSS kills Sung Jinwoo in the throne-room duel. Jinwoo is unkillable by
    // anything else (minions, traps, abilities all floor him at 10%), so a boss
    // kill is the sole qualifying death — gate explicitly on `isBoss` so no
    // other death source can ever grant it. One-shot latch metric.
    if (adv?._shadowMonarch && isBoss) {
      this._metrics.shadowMonarchDefeated = 1
    }
    this._persistMetrics()
    // Check threshold-based metrics that may have just crossed.
    this._checkMetric('killsTotal')
    this._checkMetric('killsInDayMax')
    this._checkMetric('trapKillsInDayMax')
    this._checkMetric('trapKillsInRunMax')
    this._checkMetric('trapKillsTotal')
    this._checkMetric('bossKillsInRunMax')
    this._checkMetric('bossKillsTotal')
    this._checkMetric('veteransKilled')
    this._checkMetric('veteransKilledInRunMax')
    this._checkMetric('classesKilledCount')
    this._checkMetric('shadowMonarchDefeated')
  }

  _onAdventurerEntered(payload) {
    const adv = payload?.adventurer || payload?.adv || null
    if (!adv) return
    // Career count of adventurers that crossed the threshold (Open House
    // / Innkeeper of the Damned).
    this._metrics.adventurersEnteredTotal = (this._metrics.adventurersEnteredTotal ?? 0) + 1
    this._checkMetric('adventurersEnteredTotal')
    // Track personality seen.
    const p = adv.personalityId || adv.personality || null
    if (p && !this._sets.personalitiesSeen.has(p)) {
      this._sets.personalitiesSeen.add(p)
      this._persistMetrics()
      this._checkMetric('personalitiesSeenCount')
    }
    // Track party arrival — count entries per party id, used by the
    // Total Annihilation check in `_onAdventurerDied`.
    if (adv.partyId != null) {
      const rec = this._dayState.partyArrivals.get(adv.partyId)
      if (rec) rec.entered += 1
      else this._dayState.partyArrivals.set(adv.partyId, { entered: 1, killed: 0 })
    }
  }

  _onAdventurersSpawned(payload) {
    // Wave-spawn events also carry a list — fan out to entered tracking
    // for safety in case ADVENTURER_ENTERED_DUNGEON doesn't fire per-adv.
    const advs = payload?.adventurers || payload?.list || []
    for (const adv of advs) {
      if (!adv) continue
      const p = adv.personalityId || adv.personality || null
      if (p && !this._sets.personalitiesSeen.has(p)) {
        this._sets.personalitiesSeen.add(p)
      }
    }
    this._persistMetrics()
    this._checkMetric('personalitiesSeenCount')
  }

  _onMinionPlaced(payload) {
    const minion = payload?.minion || null
    this._metrics.minionsPlacedTotal += 1
    this._runState.minionsPlaced += 1
    if (this._runState.minionsPlaced > this._metrics.minionsInRunMax) {
      this._metrics.minionsInRunMax = this._runState.minionsPlaced
    }
    // Track distinct active minion types (for Diverse Roster). A "type"
    // is the minion's `definitionId` (e.g. `skeleton1`, `imp2`).
    const type = minion?.definitionId || minion?.typeId || null
    if (type) {
      this._runState.activeMinionTypes.add(type)
      const n = this._runState.activeMinionTypes.size
      if (n > this._metrics.minionTypesActiveMax) {
        this._metrics.minionTypesActiveMax = n
        this._checkMetric('minionTypesActiveMax')
      }
    }
    this._persistMetrics()
    this._checkMetric('minionsPlacedTotal')
    this._checkMetric('minionsInRunMax')
  }

  _onMinionDied(payload) {
    this._dayState.minionsLost += 1
    // Career minion-death count (Acceptable Losses / Martyrmaker). The
    // per-day Untouchable check still happens at DAY_PHASE_ENDED.
    this._metrics.minionsLostTotal = (this._metrics.minionsLostTotal ?? 0) + 1
    this._persistMetrics()
    this._checkMetric('minionsLostTotal')
  }

  _onMinionRemoved() {
    // Sold or removed minions — we don't decrement minionsPlacedTotal (it's
    // a career counter), but we DO refresh the active-types set since the
    // mix may have changed. Recompute from gameState on next placement /
    // day-end rather than maintaining incrementally — cheaper + correct.
    this._runState.activeMinionTypes.clear()
    const gs = this._getGameState()
    if (gs?.minions) {
      for (const m of gs.minions) {
        const t = m?.definitionId || m?.typeId
        if (t) this._runState.activeMinionTypes.add(t)
      }
    }
  }

  _onTrapPlaced() {
    this._metrics.trapsPlacedTotal += 1
    this._persistMetrics()
    this._checkMetric('trapsPlacedTotal')
  }

  _onTrapFired(payload) {
    // Career trap-activation count (Tinkerer / Munitions Expert) — counts
    // every fire, distinct from trapsPlacedTotal (placements).
    this._metrics.trapsFiredTotal = (this._metrics.trapsFiredTotal ?? 0) + 1
    this._checkMetric('trapsFiredTotal')
    const def = payload?.def || payload?.trap?.definition || null
    const type = def?.id || payload?.trap?.definitionId || null
    if (type && !this._sets.trapTypesFired.has(type)) {
      this._sets.trapTypesFired.add(type)
      this._checkMetric('trapTypesFiredCount')
    }
    this._persistMetrics()
  }

  _onRoomPlaced(payload) {
    const room = payload?.room || null
    const def  = room?.definitionId || room?.typeId || null
    // Distinguish starter rooms (which are placed automatically at run
    // start) from player-placed rooms. The 5 starter room ids all begin
    // with `starter_` per the data file.
    const isStarter = typeof def === 'string' && def.startsWith('starter_')
    if (!isStarter) {
      this._metrics.nonStarterRoomsPlacedTotal += 1
      this._runState.roomsPlaced += 1
      if (this._runState.roomsPlaced > this._metrics.roomsInRunMax) {
        this._metrics.roomsInRunMax = this._runState.roomsPlaced
      }
    }
    if (def && !this._sets.roomTypesPlaced.has(def)) {
      this._sets.roomTypesPlaced.add(def)
    }
    this._persistMetrics()
    this._checkMetric('nonStarterRoomsPlacedTotal')
    this._checkMetric('roomsInRunMax')
    this._checkMetric('roomTypesPlacedCount')
  }

  _onResourcesAwarded(payload) {
    const gold  = payload?.gold ?? 0
    const souls = payload?.souls ?? 0
    if (souls > 0) {
      this._metrics.soulsTotal += souls
      this._checkMetric('soulsTotal')
    }
    if (gold > 0) {
      // Career cumulative gold earned (Petty Cash / The Magnate).
      this._metrics.goldEarnedTotal = (this._metrics.goldEarnedTotal ?? 0) + gold
      this._checkMetric('goldEarnedTotal')
    }
    // For Hoard Lord — Hoard Lord cares about PEAK gold in a single run,
    // not cumulative. Read the gameState's current gold after the award.
    if (gold > 0) {
      const gs = this._getGameState()
      const current = gs?.player?.gold ?? 0
      if (current > this._runState.goldMax) {
        this._runState.goldMax = current
        if (current > this._metrics.goldInRunMax) {
          this._metrics.goldInRunMax = current
          this._checkMetric('goldInRunMax')
        }
      }
    }
    this._persistMetrics()
  }

  _onDayPhaseBegan() {
    // Snapshot the day's day-number for survival metric on day-end.
    // Reset per-day counters.
    this._resetDayState()
  }

  _onDayPhaseEnded(payload) {
    // Days-survived — read from gameState (gameState.meta.dayNumber).
    const gs = this._getGameState()
    const day = gs?.meta?.dayNumber ?? payload?.day ?? 0
    if (day > this._metrics.daysSurvivedMax) {
      this._metrics.daysSurvivedMax = day
      this._checkMetric('daysSurvivedMax')
    }
    // Career cumulative days survived across ALL runs (Landlord / Eternal
    // Host) — one per day-phase ended.
    this._metrics.daysSurvivedTotal = (this._metrics.daysSurvivedTotal ?? 0) + 1
    this._checkMetric('daysSurvivedTotal')
    // Untouchable — if NO minions died today AND the player had at least
    // one minion deployed at any point today, flip the career flag.
    // We approximate "at least one deployed" by checking gameState.minions
    // having ≥1 at day end (most runs will). Avoids edge case where the
    // player has no minions for a whole day and gets a hollow unlock.
    if (this._dayState.minionsLost === 0) {
      const aliveMinions = (gs?.minions?.length || 0) >= 1
      if (aliveMinions) {
        this._metrics.noMinionsLostInDayEver = 1
        this._checkMetric('noMinionsLostInDayEver')
      }
    }
    // Flawless Reign — increment the no-hit run counter ONLY if the boss
    // hasn't taken any damage yet this run. Once the flag is flipped, the
    // counter freezes (no further increments) until the next run starts
    // (`_onGameStateLoaded` calls `_resetRunState` which clears both).
    if (!this._runState.bossEverDamagedThisRun) {
      this._runState.daysSurvivedNoHit += 1
      if (this._runState.daysSurvivedNoHit > this._metrics.daysSurvivedNoHitMax) {
        this._metrics.daysSurvivedNoHitMax = this._runState.daysSurvivedNoHit
        this._checkMetric('daysSurvivedNoHitMax')
      }
    }
    this._persistMetrics()
  }

  _onGameStateLoaded(payload) {
    // New run started OR existing save loaded. Reset RUN state but NOT
    // career state. Active minion types repopulated from the loaded
    // state's minions list (handles continue-from-save correctly).
    this._resetRunState()
    const gs = payload?.gameState || this._getGameState()
    if (gs?.minions) {
      for (const m of gs.minions) {
        const t = m?.definitionId || m?.typeId
        if (t) this._runState.activeMinionTypes.add(t)
      }
      // Restore peak gold so a continued run doesn't reset the chase.
      this._runState.goldMax = gs.player?.gold ?? 0
    }
  }

  _onGameOver(payload) {
    // Career count of runs that reached game-over (Persistence / Campaigner).
    this._metrics.runsEndedTotal = (this._metrics.runsEndedTotal ?? 0) + 1
    this._checkMetric('runsEndedTotal')
    // A run "completed" — fulfils Keeper of Keepers if this companion
    // hasn't already counted. The Keeper achievement requires completing
    // a run with EACH unlocked companion. We track the set by id.
    const gs = this._getGameState()
    const companionId = gs?.meta?.companionId || payload?.companionId || null
    if (companionId && !this._sets.companionsCompleted.has(companionId)) {
      this._sets.companionsCompleted.add(companionId)
      this._checkMetric('companionsCompletedCount')
    }
    this._persistMetrics()
  }

  // ── Threshold checks + unlock pipeline ────────────────────────────────
  // Iterate all achievement definitions whose `metric` matches the given
  // metric name; for each, compare current progress to target and unlock
  // if it crosses. Cheap — definitions are small + most checks are array
  // skims, no per-frame work.
  _checkMetric(metric) {
    for (const def of this._defs) {
      if (def.metric !== metric) continue
      if (PlayerProfile.isAchievementUnlocked(def.id)) continue
      const progress = this._getProgress(metric)
      if (progress >= (def.target ?? 1)) {
        this._unlock(def)
      }
    }
  }

  // Resolve the current numeric progress for a metric name. Set-based
  // metrics use the in-memory Set size, not the persisted array length.
  _getProgress(metric) {
    if (metric === 'roomTypesPlacedCount')     return this._sets.roomTypesPlaced.size
    if (metric === 'trapTypesFiredCount')      return this._sets.trapTypesFired.size
    if (metric === 'classesKilledCount')       return this._sets.classesKilled.size
    if (metric === 'personalitiesSeenCount')   return this._sets.personalitiesSeen.size
    if (metric === 'companionsCompletedCount') return this._sets.companionsCompleted.size
    if (metric === 'eventTypesSeenCount')      return this._sets.eventTypesSeen.size
    // Live-computed from PlayerProfile (not a stored metric) — counts how
    // many companions the player has unlocked. Gates "The Whole Coven"
    // (target = total companion count). Re-checked after every
    // unlockCompanion + on the retroactive boot scan.
    if (metric === 'companionsUnlockedCount')  return PlayerProfile.getUnlockedCompanions?.()?.size ?? 0
    return this._metrics[metric] ?? 0
  }

  // `opts.fromRetroactive=true` — caller is the boot-time scan that
  // backfills missing achievement unlock state for save data created
  // before this code shipped. We deliberately SKIP queuing notification
  // entries in that path so existing players don't get a flood of
  // unlock cards on the next main-menu open for stuff they earned long
  // before the notification system existed. Live in-game checks
  // (`_checkMetric`) use the default `false` and queue normally.
  _unlock(def, opts = {}) {
    const isFresh = PlayerProfile.unlockAchievement(def.id)
    if (!isFresh) return
    // Apply rewards:
    //   • companion — fires PlayerProfile.unlockCompanion (Zul'Gath via
    //     Hoard Lord today; future companions follow the same path).
    //   • boss — handled by ArchetypeSelect via isAchievementUnlocked
    //     checks; no per-unlock work needed here (the gate flips on
    //     next visit to the boss picker).
    //   • title (separate def.title field) — added to PlayerProfile.
    //     Active title auto-promotes to the latest unlock.
    if (def.reward?.type === 'companion' && def.reward.id) {
      PlayerProfile.unlockCompanion(def.reward.id)
      // This unlock may complete "The Whole Coven" (all companions). Re-
      // check that metric now. Safe from recursion — whole_coven's reward
      // is a title, not a companion, so it won't loop back here.
      this._checkMetric('companionsUnlockedCount')
    }
    if (def.title) {
      PlayerProfile.unlockTitle(def.id, def.title)
    }
    // Queue full-card unlock notifications for the next main-menu open.
    // Live unlocks only — retroactive boot-scan unlocks skip the queue.
    // Ordering: achievement first (worked-for), then the reward(s) it
    // grants — feels like a "you earned it → here's what it gives you"
    // sequence.
    if (!opts.fromRetroactive) {
      PlayerProfile.queueUnlock({ type: 'achievement', id: def.id })
      if (def.reward?.type === 'companion' && def.reward.id) {
        PlayerProfile.queueUnlock({ type: 'companion', id: def.reward.id, achId: def.id })
      }
      const bossId = _bossUnlockedByAchievement(def.id)
      if (bossId) {
        PlayerProfile.queueUnlock({ type: 'boss', id: bossId, achId: def.id })
      }
      if (def.title) {
        PlayerProfile.queueUnlock({ type: 'title', id: def.id, title: def.title, titleFx: def.titleFx ?? null, titleColor: def.titleColor ?? null, achId: def.id })
      }
    }
    // Tell the world — toast UI, HUD chips, leaderboard sync, etc.
    EventBus.emit('ACHIEVEMENT_UNLOCKED', { id: def.id, def })
  }

  // Retroactive scan — call every metric's check so existing save data
  // grants any threshold the player already met before the system existed.
  // Unlocks are DELAYED (queued via setTimeout with stagger) so when many
  // achievements unlock at once (e.g. a player at maxBossLevel=10 boots
  // and qualifies for level 1-10), the toasts don't all fire in the same
  // tick and overflow the ToastQueue cap. Each tier waits ~700ms before
  // the next. First tier waits 900ms so the overlay-mount animations
  // finish first.
  _retroactiveScan() {
    // Pass 1: collect everything that would unlock without firing them
    // yet. Reads progress directly via _getProgress so we don't go
    // through _checkMetric (which would unlock immediately).
    const pending = []
    for (const def of this._defs) {
      if (PlayerProfile.isAchievementUnlocked(def.id)) continue
      const progress = this._getProgress(def.metric)
      if (progress >= (def.target ?? 1)) pending.push(def)
    }
    if (pending.length === 0) return
    // Pass 2: schedule with stagger. The first toast waits 900ms so the
    // main menu has time to settle visually; each subsequent unlock
    // follows 700ms later (slightly shorter than the toast TTL of 6500ms
    // so a 5-unlock retro can still all be on-screen briefly).
    let delay = 900
    for (const def of pending) {
      setTimeout(() => this._unlock(def, { fromRetroactive: true }), delay)
      delay += 700
    }
  }

  // ── Rarity (Phase 4 follow-up — 2026-05-25) ───────────────────────────
  // Client-side rarity computation: given a sample of leaderboard rows
  // (each carrying an achievement_bits string), tally how many players
  // have each achievement and store as a fraction 0..1. The achievements
  // overlay shows this as "Earned by X%" next to unlocked cards. Single
  // ingest function — caller (LEADERBOARD tab activation) does the
  // fetching and hands us the rows.
  _rarity = null
  ingestRarityFromRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return
    const ids = this.getOrderedIds()
    const counts = new Array(ids.length).fill(0)
    let total = 0
    for (const r of rows) {
      const bits = r?.achievementBits || ''
      if (!bits) continue
      total++
      for (let i = 0; i < ids.length && i < bits.length; i++) {
        if (bits[i] === '1') counts[i]++
      }
    }
    if (total === 0) return
    const out = new Map()
    for (let i = 0; i < ids.length; i++) {
      out.set(ids[i], { fraction: counts[i] / total, sample: total })
    }
    this._rarity = out
  }
  // Returns { fraction, sample } or null if rarity hasn't been computed.
  getRarity(id) {
    return this._rarity?.get(id) ?? null
  }

  // ── Persistence ───────────────────────────────────────────────────────
  _persistMetrics() {
    // Sync sets back into the persisted-array shape before writing.
    this._metrics.roomTypesPlaced     = Array.from(this._sets.roomTypesPlaced)
    this._metrics.trapTypesFired      = Array.from(this._sets.trapTypesFired)
    this._metrics.classesKilled       = Array.from(this._sets.classesKilled)
    this._metrics.personalitiesSeen   = Array.from(this._sets.personalitiesSeen)
    this._metrics.companionsCompleted = Array.from(this._sets.companionsCompleted)
    this._metrics.eventTypesSeen      = Array.from(this._sets.eventTypesSeen)
    PlayerProfile.setAchievementMetrics(this._metrics)
  }

  _getGameState() {
    try {
      const game = (typeof window !== 'undefined') ? window.__game : null
      const gameScene = game?.scene?.getScene?.('Game')
      return gameScene?.gameState ?? null
    } catch { return null }
  }

  // ── Public read API ───────────────────────────────────────────────────
  // Used by AchievementsOverlay (Phase B) + future LeaderboardOverlay
  // viewer modal (Phase C). Keep tightly scoped so consumers don't poke
  // at internal state directly.
  getDefinitions() { return this._defs.slice() }
  getDefinition(id) { return this._byId.get(id) || null }

  // Title visual-effect lookup. Titles are stored / submitted as plain
  // strings (PlayerProfile, leaderboard meta), so render sites that only
  // have the title NAME resolve its fx by name. Returns the `titleFx`
  // string ('rainbow' | 'frost' | …) or null if the title has no effect.
  // Built lazily into a Map on first call.
  getTitleFxByName(name) {
    if (!name) return null
    if (!this._titleFxByName) {
      this._titleFxByName = new Map()
      for (const d of this._defs) {
        if (d.title && d.titleFx) this._titleFxByName.set(d.title, d.titleFx)
      }
    }
    return this._titleFxByName.get(name) ?? null
  }
  // By achievement id — used where the granting def is known (title chip
  // sources its def via getActiveTitle().id).
  getTitleFxById(id) {
    const def = this._byId.get(id)
    return def?.titleFx ?? null
  }

  // Static per-title color (for non-fx "normal" titles). Same name→value
  // lookup shape as the fx resolver — render sites that only have the
  // title string resolve the color by name; sites with the def use the
  // id. Returns a hex string or null.
  getTitleColorByName(name) {
    if (!name) return null
    if (!this._titleColorByName) {
      this._titleColorByName = new Map()
      for (const d of this._defs) {
        if (d.title && d.titleColor) this._titleColorByName.set(d.title, d.titleColor)
      }
    }
    return this._titleColorByName.get(name) ?? null
  }
  getTitleColorById(id) {
    const def = this._byId.get(id)
    return def?.titleColor ?? null
  }

  // Record a global-leaderboard placement (1/2/3). Called by
  // MainMenuOverlay once it has resolved the player's rank from the
  // fetched leaderboard rows. Keeps the BEST placement ever (highest
  // score) and checks the three leaderboard legendaries. Idempotent —
  // re-recording the same/worse rank is a no-op.
  recordLeaderboardRank(rank) {
    if (!this._inited || !this._metrics) return
    const r = Number(rank)
    if (!Number.isFinite(r) || r < 1) return
    const score = Math.max(0, 4 - r)   // #1→3, #2→2, #3→1, else 0
    if (score <= 0) return
    if (score > (this._metrics.leaderboardBestRankScore ?? 0)) {
      this._metrics.leaderboardBestRankScore = score
      this._persistMetrics()
    }
    this._checkMetric('leaderboardBestRankScore')
  }
  isUnlocked(id) { return PlayerProfile.isAchievementUnlocked(id) }
  getProgress(id) {
    const def = this._byId.get(id)
    if (!def) return 0
    return this._getProgress(def.metric)
  }
  getUnlockedCount() {
    return PlayerProfile.getUnlockedAchievements().size
  }
  getTotalCount() { return this._defs.length }
  // Ordered ids for the leaderboard bitmask. Bit positions are LOCKED by the
  // append-only ACHIEVEMENT_BIT_ORDER list (src/data/achievementBitOrder.js)
  // — NOT the achievements.json display order — so reordering / inserting
  // achievements in the JSON can never again shift an existing bit and
  // corrupt old leaderboard rows (the level-19-player-shows-level-25 bug).
  // Any live definition not yet in that list is appended at the END (beyond
  // every older row's mask length, so it can't misalign them) with a warn so
  // it gets locked into the list.
  getOrderedIds() {
    const locked = new Set(ACHIEVEMENT_BIT_ORDER)
    const extras = this._defs.map(d => d.id).filter(id => !locked.has(id))
    if (extras.length) {
      console.warn('[AchievementSystem] achievements missing from ' +
        'ACHIEVEMENT_BIT_ORDER — append them there to lock their leaderboard ' +
        'bit position:', extras)
    }
    return [...ACHIEVEMENT_BIT_ORDER, ...extras]
  }

  // Snapshot of every metric the achievement set references, mapped to
  // its current resolved value (scalar metrics + set-count metrics).
  // JSON-serializable — submitted to the leaderboard under
  // `meta.ach_metrics` so the achievement viewer can draw progress bars
  // for OTHER players (how close they are to each metric-based
  // achievement), exactly the way self-view does. The read side looks
  // up `def.metric` against this map. Compact (~25 keys of small ints).
  getMetricsSnapshot() {
    const snap = {}
    for (const def of this._defs) {
      const m = def?.metric
      if (!m || m in snap) continue
      snap[m] = this._getProgress(m)
    }
    return snap
  }
}

// Singleton export — same pattern as PlayerProfile / SaveSystem.
export const AchievementSystem = new AchievementSystemImpl()

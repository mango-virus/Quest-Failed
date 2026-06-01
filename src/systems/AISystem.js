// Per-tick adventurer AI.
// Phase 4: walk to boss → instant kill on arrival.
// Phase 5: personality-driven goal selection + EXPLORE_ROOM detours.
// Phase 6 (kernel): real combat with minions, FLEE goal, mid-dungeon death.

import { EventBus }         from './EventBus.js'
import { PathfinderSystem } from './PathfinderSystem.js'
import { MinionAbilities }  from './MinionAbilities.js'
import { Balance, passiveIncomeMul } from '../config/balance.js'
import { DebugOverlay }     from './DebugOverlay.js'
import { TILE, entryDoorTile, entryDoorWorldCenter, entryDoorSide } from './DungeonGrid.js'
import { minionLabel, roomLabel } from '../util/displayNames.js'

const TS = Balance.TILE_SIZE

// ── Adventurer-life goals (Phase: alive AI) ──────────────────────────────
// These are personality-agnostic (any adv can roll them) and short-lived.
// Tuned for "reads as alive without spamming chat bubbles."
const GLOAT_CHANCE                 = 0.25   // roll on COMBAT_KILL
const GLOAT_DURATION_MS            = 1500   // freeze in place this long
// Fleeing adventurers sprint hard for the exit. Bumped 1.1 → 1.6
// (2026-05-27) so end-of-day clears faster when many advs are heading
// home at once — combined with the splice-on-door-contact change in
// the FLEE atExitEdge handler, the conga line at the doorway resolves
// in a fraction of the time it used to.
const FLEE_SPEED_MULT              = 1.6
const WARN_RADIUS                  = 5      // tiles around the threat
const WARN_CHANCE                  = 0.5    // roll per nearby ally on threat detect
const WARN_COOLDOWN_MS             = 8000   // per-warner cooldown
const LOOT_SIGHT_RANGE             = 14     // tiles between adv and dropped pile
const LOOT_CHANCE                  = 0.45   // per-adv roll on pile drop
const LOOT_DURATION_MS             = 2500   // looting freeze
const LOOT_PILE_TTL_MS             = 30000  // piles vanish if untouched
// SEEK_TREASURE repick budget (anti-thrash, 2026-05-27). When the sticky
// pick + interrupt-and-repick cycle still ends up firing SEEK_TREASURE
// more than this many times in one day for one adv, we conclude the adv
// genuinely can't reach any chest (geometry, blockers, etc.) and set
// `adv.flags.chestGivenUp` so the chest pull is skipped for the rest of
// the day. Both counter + flag reset in `_onNightStartedAI` (the
// NIGHT_PHASE_STARTED handler). 3 is generous — normal flow only
// re-picks once per uninterrupted run (stack-based interrupts like
// SEEK_HEAL preserves SEEK_TREASURE without calling
// _pickNextGoal); only the day-42 bug pattern burns through the budget.
const MAX_CHEST_SEEKS_PER_DAY      = 3
// Pathfinder cost multiplier for any tile inside a room that this adv
// knows contains at least one trap. Coarse, ROOM-level avoidance instead
// of per-tile dodging — every tile in the trapped room gets the same
// multiplier, so A* prefers routes that don't transit the room but
// happily walks straight through if no alternative exists. Replaces the
// per-tile penalty + per-adv side-bias (both removed 2026-05-27) which
// produced visible ping-pong loops as A* threaded between adjacent
// trap tiles and the side-tiebreaker re-rolled per replan. With this
// multiplier an alt route can be up to ~5× as long as the trapped-room
// route before they take the trap — strong preference, never absolute.
const ROOM_TRAP_PENALTY            = 5.0
// Cap on consecutive EXPLORE_ROOM goal picks before forcing SEEK_BOSS. On-
// screen F4 diagnostics (2026-05-27) showed advs cycling between 2-3 rooms
// indefinitely because _pickNextGoal kept returning another EXPLORE_ROOM
// each time one was reached. Forcing SEEK_BOSS after this many in a row
// guarantees forward progress; any non-EXPLORE_ROOM goal pick resets the
// counter, so normal exploration of a long dungeon still works.
const EXPLORE_STREAK_CAP           = 5
// Position-stagnation watchdog (2026-05-27). The pathTarget-based watchdog
// further down resets its progress baseline every time the goal flips,
// because pathTarget changes too. That blind-spots the classic chokepoint
// loop: adv walks toward room A, hits trap, replan picks room B, walks
// back, replan picks room A again, etc. Distance to current target drops
// each step so the baseline keeps moving, but the adv physically oscillates
// in a small radius. This watchdog tracks the adv's tile position directly
// (anchor + Chebyshev radius); independent of goals/targets, so goal-churn
// can't fool it. STAG_RADIUS = 3 means the adv must move >3 tiles (5×5
// Chebyshev box) from the anchor for the timer to reset.
const STAG_RADIUS_TILES            = 3
const STAG_TIMEOUT_MS              = 5000
// Starvation failsafe (2026-05-27). After every other anti-loop mechanism
// (knowledge gate, EXPLORE_ROOM streak cap, give-up escalation, position-
// stagnation watchdog, panic-walk through traps), if an adv has STILL
// re-entered already-visited rooms this many times in a single day,
// they're definitively in a multi-room loop the AI can't solve — kill
// them via flavor "starvation" so they stop wasting tick budget.
//
// We count REVISITS (entries to rooms the adv has been in before), not
// raw transitions, so a legit linear sweep of a giant 30+-room dungeon
// doesn't trip the failsafe. Normal play backtracks a few times (chest
// → locked door, fountain → goal, regroup detours); 20 revisits is well
// past that and only happens when the adv is bouncing between the same
// 2-4 rooms repeatedly.
const STARVATION_ROOM_REVISITS     = 20
// Beast Master tame protection — how long a minion stays off-limits to
// other adventurers' melee after a Beast Master last stamped it as a
// tame target. ClassAbilitySystem refreshes the stamp every tick the
// minion is in tame range, so this only needs to outlast a frame or two;
// the slack covers high-speed sub-stepping and frame hitches.
const TAME_PROTECT_MS              = 1500

export class AISystem {
  constructor(scene, gameState, dungeonGrid, personalitySystem = null, combatSystem = null, knowledgeSystem = null) {
    this._scene       = scene
    this._gameState   = gameState
    this._dungeonGrid = dungeonGrid
    this._personalitySystem = personalitySystem
    this._combatSystem      = combatSystem
    this._knowledgeSystem   = knowledgeSystem
    EventBus.on('COMBAT_HIT',          this._onCombatHit,        this)
    EventBus.on('ADVENTURER_DIED',     this._onAdventurerDied,   this)
    EventBus.on('BOSS_FIGHT_RESOLVED', this._onBossFightResolved, this)
    // INVESTIGATE_NOISE goal removed 2026-05-31. AISystem no longer reacts
    // to TRAP_TRIGGERED or MINION_DIED: the old "noise" handlers pulled
    // adventurers toward the noise source, and because traps re-fire
    // continuously the loop (trap fires → investigate → walk onto trap →
    // trap fires again) made advs pace on top of traps forever. Trap
    // locations are still recorded for routing by KnowledgeSystem's own
    // TRAP_TRIGGERED handler — do NOT re-add an AI reaction to trap hits.
    EventBus.on('COMBAT_KILL',         this._onCombatKill,       this)
    // Phase: alive AI — wipe leftover loot piles when day ends so the
    // dungeon doesn't accumulate them across nights.
    EventBus.on('NIGHT_PHASE_STARTED', this._onNightStartedAI,   this)
  }

  destroy() {
    EventBus.off('COMBAT_HIT',          this._onCombatHit,        this)
    EventBus.off('ADVENTURER_DIED',     this._onAdventurerDied,   this)
    EventBus.off('BOSS_FIGHT_RESOLVED', this._onBossFightResolved, this)
    EventBus.off('COMBAT_KILL',         this._onCombatKill,       this)
    EventBus.off('NIGHT_PHASE_STARTED', this._onNightStartedAI,   this)
  }

  _onNightStartedAI() {
    if (this._gameState.dungeon?.lootPiles?.length) {
      this._gameState.dungeon.lootPiles = []
    }
    // Mimic — every spent ('sprung') mimic re-disguises overnight. The
    // chest visibly closes again, ready to trap tomorrow's wave. Mimics
    // killed via combat (aiState='dead') stay dead until respawnAll
    // handles them (Mimic Vault auto-spawns) or the player rebuilds
    // (placeable mimics).
    this._resetSprungMimics()
    // Phase: items — every locked door re-locks, every key chest re-fills,
    // class lockpick/break-down counters reset, and any keys carried by
    // adventurers (active or fled) drop. The dungeon resets to its built
    // configuration each night.
    for (const c of this._gameState.dungeon?.keyChests ?? []) c.opened = false
    for (const l of this._gameState.dungeon?.locks ?? []) {
      l.unlocked = false
      l.broken   = false
    }
    for (const a of this._gameState.adventurers?.active ?? []) {
      a.keys = []
      a.lockpickUsedToday = 0
      a.breakdownUsedToday = 0
      // Phase: items — fresh day, fountain is usable again. Knowledge of
      // fountain locations carries over (knownFountains persists).
      a.fountainUsedToday = false
      // SEEK_TREASURE anti-thrash counter resets per day so yesterday's
      // unreachable chest doesn't permanently disable today's chest pulls.
      // `flags.chestGivenUp` latches per day; clear here in lockstep.
      a._chestSeekCount = 0
      if (a.flags) a.flags.chestGivenUp = false
    }
    // Phase D — Treasure Chest passive payout + reset. Every placed chest
    // re-closes (sprite snaps to frame 0 via TreasureChestRenderer.update)
    // and pays its tier's gold/day to the player. An opened chest from
    // the previous day still pays — the steal already cost the player.
    //
    // Per-day guard: NIGHT_PHASE_STARTED fires whenever NightPhase.create
    // runs — which includes save-load (Continue from a mid-night save
    // re-emits the event). Without this guard the player gets a fresh
    // chest payout every time they continue, effectively duping gold by
    // quit+continue cycling. We stamp the last paid day on player and
    // skip if it matches the current day number.
    const day = this._gameState.meta?.dayNumber ?? 0
    const lastPaid = this._gameState.player?._lastChestPayoutDay
    if (lastPaid !== day) {
      const itemsCache = this._scene.cache.json.get('items') ?? []
      let chestPayout = 0
      for (const chest of this._gameState.dungeon?.treasureChests ?? []) {
        const def = itemsCache.find(it => it.id === `treasure_chest_${chest.tier}`)
        chestPayout += (def?.treasure?.goldPerDay ?? 0)
        chest.opened = false
      }
      // Scale the day's chest income with the run so it keeps pace with the
      // climbing build economy (boss-level-only by default — see
      // passiveIncomeMul / Balance.PASSIVE_INCOME_*).
      chestPayout = Math.round(chestPayout * passiveIncomeMul(
        this._gameState.boss?.level ?? 1, day))
      if (chestPayout > 0) {
        this._gameState.player.gold = (this._gameState.player.gold ?? 0) + chestPayout
        EventBus.emit('TREASURE_PAYOUT', { gold: chestPayout })
      }
      // Stamp regardless of payout amount — re-running on the same day
      // shouldn't even reset `chest.opened` twice.
      if (this._gameState.player) this._gameState.player._lastChestPayoutDay = day
    }
    EventBus.emit('LOCKS_CHANGED')
  }

  // Nearest unopened treasure chest by Manhattan tile distance — NOT
  // knowledge-gated (used by the Treasure Hunters event, whose looters
  // have a "treasure map" and target any live chest). Returns a chest
  // entry from gameState.dungeon.treasureChests, or null if none unopened.
  _nearestUnopenedChest(adv) {
    const chests = (this._gameState.dungeon?.treasureChests ?? []).filter(c => !c.opened)
    if (chests.length === 0) return null
    let best = null, bestD = Infinity
    for (const c of chests) {
      const d = Math.abs(c.tileX - adv.tileX) + Math.abs(c.tileY - adv.tileY)
      if (d < bestD) { bestD = d; best = c }
    }
    return best
  }

  // Nearest unopened chest the RAID has DISCOVERED THIS raid (2026-05-29).
  // Gated on "the chest's room has been physically visited by some living
  // raider today" (union of every raider's visitedRooms) rather than on
  // adv.knowledge.treasureChests — because fresh adventurers inherit the
  // shared knowledge pool at spawn, and gating on the knowledge bucket let
  // raiders "already know" every chest a prior wave's survivor had logged
  // (the "raiders always know where the chest is" bug). Tying chest-targeting
  // to visitedRooms forces the raid to actually scout for itself: a chest
  // becomes targetable the moment any raider sets foot in its room, the whole
  // wave converges, and once every room's been swept + every found chest
  // looted the raid leaves. Aggressive (nearest, no temptPct roll) so an
  // informed raider always commits. Boss-chamber chests are excluded (raiders
  // never enter the throne — see the pathfinding hard-block below); disguised
  // mimics are excluded too (real-chest list only — proximity trigger still
  // springs one if a raider wanders adjacent). Returns a chest or null.
  _nearestRaidKnownChest(adv) {
    const visitedRooms = new Set()
    for (const a of (this._gameState.adventurers?.active ?? [])) {
      if (!a._treasureHunter || a.aiState === 'dead') continue
      for (const id of (a.visitedRooms ?? [])) visitedRooms.add(id)
    }
    if (visitedRooms.size === 0) return null
    const chests = (this._gameState.dungeon?.treasureChests ?? []).filter(c => {
      if (c.opened) return false
      const room = this._dungeonGrid?.getRoomAtTile?.(c.tileX, c.tileY)
      if (!room) return false
      if (room.definitionId === 'boss_chamber') return false
      return visitedRooms.has(room.instanceId)
    })
    if (chests.length === 0) return null
    let best = null, bestD = Infinity
    for (const c of chests) {
      const d = Math.abs(c.tileX - adv.tileX) + Math.abs(c.tileY - adv.tileY)
      if (d < bestD) { bestD = d; best = c }
    }
    return best
  }

  // Closest room the RAID hasn't explored yet (room centre, Euclidean),
  // excluding the boss chamber — used by the Treasure Hunters explore-to-find
  // fallback. The raid shares scouting (2026-05-29): a room counts as explored
  // once ANY living raider has set foot in it (union of every raider's
  // visitedRooms), so the wave collectively sweeps the dungeon instead of each
  // raider re-touring every room. Raiders also fan out — a room another raider
  // is already walking to (its EXPLORE_ROOM goal) is "claimed" and skipped, so
  // the wave splits across the map; if every remaining room is claimed we fall
  // back to the nearest unexplored one (a little overlap beats idling, and
  // never returns null while a room is still unseen, so nobody flees early).
  // Returns null only when the raid has collectively visited everything.
  _nearestRaidUnexploredRoom(adv) {
    const visited = new Set()
    const claimed = new Set()
    for (const a of (this._gameState.adventurers?.active ?? [])) {
      if (!a._treasureHunter || a.aiState === 'dead') continue
      for (const id of (a.visitedRooms ?? [])) visited.add(id)
      if (a !== adv && a.goal?.type === 'EXPLORE_ROOM' && a.goal.roomId != null) {
        claimed.add(a.goal.roomId)
      }
    }
    let bestUnclaimed = null, bestUnclaimedD = Infinity
    let bestAny = null, bestAnyD = Infinity
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId === 'boss_chamber') continue
      if (visited.has(room.instanceId)) continue
      const cx = room.gridX + Math.floor(room.width / 2)
      const cy = room.gridY + Math.floor(room.height / 2)
      const d = Math.hypot(adv.tileX - cx, adv.tileY - cy)
      if (d < bestAnyD) { bestAny = room; bestAnyD = d }
      if (!claimed.has(room.instanceId) && d < bestUnclaimedD) {
        bestUnclaimed = room; bestUnclaimedD = d
      }
    }
    return bestUnclaimed ?? bestAny
  }

  // ── Treasure Chest ──────────────────────────────────────────────────
  // Iterate unopened chests highest-tier first. Greedy / vulture /
  // loot_seeker advs always pick the top tier they can reach. Other advs
  // roll the chest's `temptPct` per chest in tier order; first hit wins.
  // Returns a chest entry or null.
  _maybePickTreasureChest(adv) {
    // Knowledge gate: only chests the adv has personally seen (or
    // inherited from a survivor) qualify. Stale entries are skipped —
    // the chest may have been removed since the intel was gathered.
    const known = adv.knowledge?.treasureChests ?? {}
    const knownIds = Object.keys(known).filter(id => known[id]?.stale !== true)
    if (knownIds.length === 0) return null
    // Real chests — uncopen, in the live `treasureChests` list.
    const realChests = (this._gameState.dungeon?.treasureChests ?? [])
      .filter(c => !c.opened && knownIds.includes(c.instanceId))
    // Mimic chests — disguised mimics the adv perceives as chests.
    // KnowledgeSystem.observeRoomContents copies them into `knowledge.
    // treasureChests` with `_isMimic: true`, so they show up in the same
    // tempt loop. An adv whose `knowledge.mimics[id]` is set knows the
    // disguise and SKIPS the tempt (no opens) — they're handled by the
    // normal hostile-engagement path elsewhere instead.
    const mimicSightings = []
    for (const id of knownIds) {
      const entry = known[id]
      if (!entry?._isMimic) continue
      if (adv.knowledge?.mimics?.[id]) continue   // sees through the disguise
      const m = (this._gameState.minions ?? []).find(x => x.instanceId === id)
      if (!m || m.aiState === 'dead' || m.mimicState !== 'chest') continue
      // Wrap as a chest-shaped target so the rest of the goal flow
      // (pathing + reach-and-open) treats it uniformly.
      mimicSightings.push({
        instanceId: m.instanceId,
        tileX: m.tileX, tileY: m.tileY,
        tier: m.chestTier ?? 1,
        _isMimic: true,
      })
    }
    const chests = [...realChests, ...mimicSightings]
    if (chests.length === 0) return null
    chests.sort((a, b) => b.tier - a.tier)
    const tags = this._personalitySystem?.getTags(adv) ?? new Set()
    if (tags.has('anti_loot')) return null
    const greedy = tags.has('greedy') || tags.has('vulture') || tags.has('loot_seeker')
    // ── Sticky pick (anti-thrash, 2026-05-27) ───────────────────────────
    // When `_pickNextGoal` is repeatedly called mid-walk (combat scuffle,
    // etc.) and the adv is already on a SEEK_TREASURE goal, prefer the
    // previously-targeted
    // chest as long as it's still in the candidate pool. Without this,
    // every repick re-rolls each chest's temptPct independently, so two
    // equal-tier chests with the same temptPct flip the adv's heading
    // ~50/50 each time → multi-room ping-pong (day-42 bug report).
    // Greedy advs are already deterministic (highest tier wins) but we
    // still want the stickiness for them — if a higher-tier chest gets
    // placed mid-day, that override is fine; the previous-target check
    // re-validates against the live `chests` list each call.
    if (adv.goal?.type === 'SEEK_TREASURE' && adv.goal.chestId) {
      const prev = chests.find(c => c.instanceId === adv.goal.chestId)
      if (prev) return prev
    }
    const itemsCache = this._scene.cache.json.get('items') ?? []
    for (const chest of chests) {
      if (greedy) return chest
      const def = itemsCache.find(it => it.id === `treasure_chest_${chest.tier}`)
      const temptPct = def?.treasure?.temptPct ?? 10
      if (Math.random() * 100 < temptPct) return chest
    }
    return null
  }

  // Mimic-chest proximity trigger. Runs alongside _tryOpenTreasureChest
  // every tile-step. An adv adjacent to a 'chest'-state mimic THEY DON'T
  // YET KNOW IS A MIMIC triggers the trap: chest-open animation plays
  // (via the renderer reacting to mimicState='sprung'), all alive party
  // members + the shared knowledge pool learn this specific mimic is
  // dangerous, and the opener is instantly killed (routed through the
  // standard adventurer-died path so the player gets normal kill credit).
  //
  // The mimic itself transitions to 'sprung' and stays open till
  // NIGHT_PHASE_STARTED resets it back to 'chest' for the next day.
  _tryTriggerMimic(adv) {
    if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) return
    // Sung Jinwoo ignores chests entirely — he never opens a real one
    // (_tryOpenTreasureChest) and never springs a mimic disguised as one.
    // He marches past, eyes on the boss. Aldric the Nemesis disdains loot too.
    if (adv._shadowMonarch || adv._nemesis || adv._nemesisDuel) return
    // Light Party — a coordinated raid is here for the boss, not loot.
    // Skip mimic-bait disguised chests the same way as Jinwoo: walking
    // through one shouldn't spring it.
    if (adv._lightParty) return
    for (const m of (this._gameState.minions ?? [])) {
      if (!m.isMimic) continue
      if (m.mimicState !== 'chest') continue
      if (m.aiState === 'dead') continue
      // Knowledge-aware advs see through the disguise and refuse to open
      // it — they handle the mimic via normal hostile engagement (see
      // the adv-targeting allow-list in _findEngageableMinion).
      if (adv.knowledge?.mimics?.[m.instanceId]) continue
      const d = Math.max(Math.abs(m.tileX - adv.tileX), Math.abs(m.tileY - adv.tileY))
      if (d > 1) continue
      this._springMimic(m, adv)
      return   // opener is now dead; bail before the caller advances them
    }
  }

  // Trigger sequence — flip state, propagate knowledge, kill the opener.
  // Knowledge propagation:
  //   * every alive adv (any party) gets `knowledge.mimics[mimicId]`
  //   * the shared `knowledge.sharedPool.mimics[mimicId]` slot is set so
  //     next-day spawns inherit the warning when KnowledgeSystem
  //     initialises their knowledge from the pool.
  _springMimic(mimic, opener) {
    mimic.mimicState = 'sprung'
    const today = this._gameState.meta?.dayNumber ?? 1
    // Mark this mimic known on every currently-alive adventurer (not
    // just the opener's party — the dungeon scream of "DON'T OPEN
    // THAT CHEST" carries). Future-day spawns inherit via sharedPool.
    for (const a of (this._gameState.adventurers?.active ?? [])) {
      if (a.aiState === 'dead' || a === opener) continue
      a.knowledge ??= { rooms: {}, traps: {}, enemiesPerRoom: {}, loot: {}, mimics: {} }
      a.knowledge.mimics ??= {}
      a.knowledge.mimics[mimic.instanceId] = {
        type:       mimic.definitionId,
        roomId:     this._dungeonGrid?.getRoomAtTile?.(mimic.tileX, mimic.tileY)?.instanceId ?? null,
        confirmed:  true,
        stale:      false,
        dayLearned: today,
      }
    }
    // Shared pool — KnowledgeSystem._mergeKnowledge unions this into
    // fresh adv knowledge on spawn so tomorrow's wave already knows.
    const pool = this._gameState.knowledge ??= { sharedPool: {} }
    pool.sharedPool ??= {}
    pool.sharedPool.mimics ??= {}
    pool.sharedPool.mimics[mimic.instanceId] = {
      type:       mimic.definitionId,
      roomId:     this._dungeonGrid?.getRoomAtTile?.(mimic.tileX, mimic.tileY)?.instanceId ?? null,
      confirmed:  true,
      stale:      false,
      dayLearned: today,
    }
    EventBus.emit('MIMIC_SPRUNG', { mimic, opener })
    EventBus.emit('COMBAT_KILL', {
      sourceId:   mimic.instanceId,
      targetId:   opener.instanceId,
      damageType: 'physical',
      method:     'mimic_devour',
      roomId:     this._dungeonGrid?.getRoomAtTile?.(opener.tileX, opener.tileY)?.instanceId ?? null,
      day:        today,
    })
    // The opener dies instantly. Route through the standard _kill path
    // so AdventurerRenderer, the post-wave tally, gold/XP credit, and
    // the graveyard record all fire correctly. _kill reads
    // adv.resources.hp + adv._lastHitBy; both are set above.
    opener.resources.hp = 0
    opener._lastHitBy   = mimic.instanceId
    opener._lastHitType = 'mimic_devour'
    const idx = (this._gameState.adventurers?.active ?? []).indexOf(opener)
    this._kill(opener, idx, mimic.instanceId)
  }

  // Reset every 'sprung' mimic back to 'chest' state at the start of
  // a new night so they're armed and ready for tomorrow's wave. Called
  // from a NIGHT_PHASE_STARTED hook — placed here (next to the mimic
  // logic) for locality. Knowledge that THIS mimic exists persists on
  // the shared pool so next-day advs still avoid it.
  _resetSprungMimics() {
    for (const m of (this._gameState.minions ?? [])) {
      if (m.isMimic && m.mimicState === 'sprung' && m.aiState !== 'dead') {
        m.mimicState = 'chest'
      }
    }
  }

  // Open a treasure chest the adv has reached, debit the player by
  // stealPct% of current gold, mark the gold on the adv. 30% chance the
  // adv switches to ESCAPE_WITH_LOOT (entry-hall beeline). Otherwise
  // they continue with their original goal carrying the prize.
  _tryOpenTreasureChest(adv) {
    // Sung Jinwoo has no interest in the dungeon's gold — he's here for the
    // boss alone. Skip the proximity loot entirely so he never pops a chest
    // he happens to beeline past on his way to the throne. Aldric ignores loot too.
    if (adv._shadowMonarch || adv._nemesis || adv._nemesisDuel) return
    // Light Party — same deal: a coordinated raid is here for the boss, not
    // loot. Walking past a chest doesn't rob it.
    if (adv._lightParty) return
    if (adv.stolenGold > 0 || adv._raiderLooted) return   // already carrying — don't rob another
    for (const chest of this._gameState.dungeon?.treasureChests ?? []) {
      if (chest.opened) continue
      const d = Math.max(Math.abs(chest.tileX - adv.tileX), Math.abs(chest.tileY - adv.tileY))
      if (d > 1) continue
      chest.opened = true
      const itemsCache = this._scene.cache.json.get('items') ?? []
      const def = itemsCache.find(it => it.id === `treasure_chest_${chest.tier}`)
      const tr  = def?.treasure ?? {}
      // Treasure-Raid raiders don't debit gold per-chest — their loss is the
      // liquid-gold skim taken when they ESCAPE (EventSystem._skimTreasureRaider),
      // capped across the whole raid. The chest is still "robbed" for flavor
      // (re-arms next night like any chest; income is opened-independent). The
      // _raiderLooted latch sends them to ESCAPE_WITH_LOOT (vs the stolenGold
      // latch normal proximity-loot uses). Non-raid adventurers keep the
      // classic stealPct% proximity-loot debit.
      let stolen = 0
      if (adv._treasureHunter) {
        adv._raiderLooted = true
      } else {
        const playerGold = this._gameState.player.gold ?? 0
        stolen = Math.max(0, Math.floor(playerGold * (tr.stealPct ?? 10) / 100))
        this._gameState.player.gold = Math.max(0, playerGold - stolen)
        adv.stolenGold = (adv.stolenGold ?? 0) + stolen
        adv.stolenFromChestTier = chest.tier
      }
      EventBus.emit('TREASURE_CHEST_OPENED', { chest, adv, stolen })
      if (stolen > 0) EventBus.emit('TREASURE_STOLEN', { adv, gold: stolen, tier: chest.tier })
      EventBus.emit('SAY_stoleTreasure', { adventurer: adv })
      // Roll for escape goal — if hit, the adv abandons everything and
      // sprints for the exit. Treasure Hunters ALWAYS bolt the instant
      // they've got loot (that's the whole point — grab and run), so they
      // skip the roll. (The `stolenGold > 0` guard at the top also stops
      // them robbing a second chest, and _pickNextGoal re-routes any that
      // somehow don't escape straight to ESCAPE_WITH_LOOT.)
      if (adv._treasureHunter || Math.random() < (tr.escapeChance ?? 0.30)) {
        adv.goalStack = []   // wipe stack — escape supersedes everything
        adv.goal = { type: 'ESCAPE_WITH_LOOT' }
        adv.path = null
        EventBus.emit('SAY_escapingWithLoot', { adventurer: adv })
      }
      return
    }
  }

  // ── Healing Fountain (knowledge-gated) ──────────────────────────────
  // Discovery now rides on KnowledgeSystem.observeRoomContents (called from
  // observeCurrentRoom) — when the adv enters a room, every fountain /
  // treasure chest / key chest in that room is recorded into
  // adv.knowledge.{fountains,treasureChests,keyChests}. Returning
  // survivors inherit those entries via the shared pool. _maybeSeekHeal
  // below reads adv.knowledge.fountains directly.

  // If conditions hold (low HP, knows a fountain, hasn't healed today,
  // not on a higher-priority goal), set SEEK_HEAL targeting the closest
  // known unblocked fountain.
  _maybeSeekHeal(adv) {
    // Once-per-day cap removed 2026-05-27 — advs now re-seek a fountain
    // whenever they drop below LOW_HP_THRESHOLD. The "only when actually
    // low" gate below is self-limiting (a freshly-healed adv is at full
    // HP and won't re-seek until damaged again), so no extra cooldown
    // is needed here.
    if (adv.aiState === 'fleeing' || adv.aiState === 'dead') return
    const hpFrac = adv.resources.hp / Math.max(1, adv.resources.maxHp)
    if (hpFrac >= Balance.LOW_HP_THRESHOLD) return
    const t = adv.goal?.type
    if (t === 'CHARM_WALK' || t === 'HUNT_PHYLACTERY' || t === 'AT_BOSS'
        || t === 'FLEE' || t === 'SEEK_HEAL'
        || t === 'OPEN_LOCKED_DOOR' || t === 'SEEK_KEY_CHEST') return
    // Knowledge gate: only fountains the adv has seen (or inherited from
    // survivors) are valid heal targets. Stale entries (RUMOR tier — the
    // fountain may have been removed) drop out so they don't waste a trip.
    const knownIds = Object.keys(adv.knowledge?.fountains ?? {}).filter(id =>
      adv.knowledge.fountains[id]?.stale !== true,
    )
    if (knownIds.length === 0) return
    const fts = (this._gameState.dungeon?.fountains ?? []).filter(f => knownIds.includes(f.instanceId))
    if (fts.length === 0) return
    let best = null, bestD = Infinity
    for (const f of fts) {
      const d = Math.hypot(adv.tileX - f.tileX, adv.tileY - f.tileY)
      if (d < bestD) { best = f; bestD = d }
    }
    if (!best) return
    adv.goalStack ??= []
    if (adv.goal) adv.goalStack.push(adv.goal)
    adv.goal = { type: 'SEEK_HEAL', fountainId: best.instanceId }
    adv.path = null
    EventBus.emit('SAY_seekHeal', { adventurer: adv })
  }

  // Proximity heal when an adv steps onto / adjacent to a fountain.
  // Reworked 2026-05-27: no longer once-per-day. On contact the adv is
  // healed to full AND granted the Fountain Blessing — a heal-over-time
  // (FOUNTAIN_BLESS_REGEN_PCT/sec for FOUNTAIN_BLESS_DURATION_MS) that
  // persists into the boss fight (ticked in _tickAdventurer). The
  // instant top-up is gated by FOUNTAIN_REHEAL_COOLDOWN_MS so standing
  // on the fountain doesn't re-fire every frame; re-touching after the
  // cooldown refreshes both the heal and the blessing. The blessing is
  // granted even at full HP (so an adv topping off before the throne
  // still carries regen into the fight).
  _tryHealAtFountain(adv) {
    const now = this._scene?.time?.now ?? 0
    if (now < (adv._fountainTouchAt ?? 0)) return
    for (const f of this._gameState.dungeon?.fountains ?? []) {
      const d = Math.max(Math.abs(f.tileX - adv.tileX), Math.abs(f.tileY - adv.tileY))
      if (d > 1) continue
      const healed = Math.max(0, adv.resources.maxHp - adv.resources.hp)
      adv.resources.hp        = adv.resources.maxHp
      adv._fountainTouchAt    = now + Balance.FOUNTAIN_REHEAL_COOLDOWN_MS
      adv._fountainBlessUntil = now + Balance.FOUNTAIN_BLESS_DURATION_MS
      EventBus.emit('FOUNTAIN_HEAL_USED', { adventurer: adv, fountain: f, healed })
      EventBus.emit('SAY_healed', { adventurer: adv })
      return
    }
  }

  // ── Diagnostic helper (anti-ping-pong investigation, 2026-05-27) ────
  // No-op stub. Originally logged AI state to console when DebugOverlay
  // .aiDiagnostics was on (F4 toggle), but per user request 2026-05-27
  // the on-screen AiDiagOverlay carries all the visible diagnostics
  // now — no console spam, even when the flag is on. Kept as a no-op
  // so the existing call sites (watchdog fire, path recompute, goal
  // change, stuck warnings) don't have to be deleted; if we ever want
  // console logging again, just restore the body here. NB: also keep
  // the call sites so the per-adv `_diagLastGoal` / `_lastDiagAt`
  // bookkeeping fields stay populated (other code may read them).
  _aiDiag(_adv, _msg) {
    /* on-screen-only diagnostics — see src/ui/AiDiagOverlay.js */
  }

  // Find the closest unopened key chest reachable by `adv` given the
  // current set of locks they can't pass. Returns the chest entry or
  // null. Used as a fallback when normal pathfinding fails so they go
  // grab a key instead of giving up and fleeing.
  _findReachableUnopenedKeyChest(adv) {
    // Knowledge gate: only key chests the adv has seen (or learned from a
    // returning survivor) are valid targets. Without this, every adv knew
    // every key chest's location at spawn — too forgiving for a stealth
    // economy. Stale entries (chest moved/destroyed) drop out.
    const known = adv.knowledge?.keyChests ?? {}
    const knownIds = Object.keys(known).filter(id => known[id]?.stale !== true)
    if (knownIds.length === 0) return null
    const chests = (this._gameState.dungeon?.keyChests ?? [])
      .filter(c => !c.opened && knownIds.includes(c.instanceId))
    if (chests.length === 0) return null
    const blocked = new Set()
    for (const lock of this._gameState.dungeon?.locks ?? []) {
      if (lock.unlocked || lock.broken) continue
      if (this._canAdvUnlockHere(adv, lock)) continue
      for (const t of lock.doorTiles) blocked.add(`${t.x},${t.y}`)
    }
    let best = null, bestLen = Infinity
    for (const chest of chests) {
      const path = PathfinderSystem.findPath(
        { x: adv.tileX, y: adv.tileY },
        { x: chest.tileX, y: chest.tileY },
        this._dungeonGrid, null, 0, blocked,
      )
      if (path && path.length < bestLen) { best = chest; bestLen = path.length }
    }
    return best
  }

  // Returns the lock entry that owns the given tile, or null. Used by the
  // pathfinder cost wrapper to mark unowned-key locked doors as walls and
  // by _tryUnlockTile to consume the unlock method on step.
  _lockOnTile(tx, ty) {
    for (const l of this._gameState.dungeon?.locks ?? []) {
      if (l.unlocked || l.broken) continue
      if (l.doorTiles.some(t => t.x === tx && t.y === ty)) return l
    }
    return null
  }

  // Whether `adv` has any way to pass `lock` right now (key OR uses-left
  // for their class ability). Doesn't consume — see _tryUnlockTile.
  _canAdvUnlockHere(adv, lock) {
    if ((adv.keys ?? []).includes(lock.id)) return true
    if (adv.classId === 'rogue'     && (adv.lockpickUsedToday  ?? 0) < 2) return true
    if (adv.classId === 'barbarian' && (adv.breakdownUsedToday ?? 0) < 2) return true
    return false
  }

  // When `adv` steps onto a locked door tile, consume the highest-
  // priority unlock method they have (key > lockpick > break) and flip
  // the lock open. Broken locks stay broken until night reset.
  _tryUnlockTile(adv, tx, ty) {
    const lock = this._lockOnTile(tx, ty)
    if (!lock) return
    if ((adv.keys ?? []).includes(lock.id)) {
      adv.keys = adv.keys.filter(k => k !== lock.id)
      lock.unlocked = true
      EventBus.emit('LOCK_OPENED', { lock, adv, method: 'key' })
      EventBus.emit('LOCKS_CHANGED')
      EventBus.emit('SAY_unlockedDoor', { adventurer: adv })
      return
    }
    if (adv.classId === 'rogue' && (adv.lockpickUsedToday ?? 0) < 2) {
      adv.lockpickUsedToday = (adv.lockpickUsedToday ?? 0) + 1
      lock.unlocked = true
      EventBus.emit('LOCK_OPENED', { lock, adv, method: 'lockpick' })
      EventBus.emit('LOCKS_CHANGED')
      EventBus.emit('SAY_lockpicked', { adventurer: adv })
      return
    }
    if (adv.classId === 'barbarian' && (adv.breakdownUsedToday ?? 0) < 2) {
      adv.breakdownUsedToday = (adv.breakdownUsedToday ?? 0) + 1
      lock.unlocked = true
      lock.broken = true
      EventBus.emit('LOCK_OPENED', { lock, adv, method: 'break' })
      EventBus.emit('LOCKS_CHANGED')
      EventBus.emit('SAY_brokeDoor', { adventurer: adv })
      return
    }
  }

  // When `adv` steps onto an unopened key chest tile, open it, give them
  // the key, and stack an OPEN_LOCKED_DOOR goal so they head straight to
  // the matching door. Existing goal is pushed onto goalStack and resumes
  // after the door is opened.
  _tryPickKey(adv) {
    for (const chest of this._gameState.dungeon?.keyChests ?? []) {
      if (chest.opened) continue
      // Proximity pickup — adv just needs to be within Chebyshev range 1
      // (same tile or any 8-neighbour). Path smoothing can skip the
      // exact chest tile, so an exact-tile check made advs walk past.
      const d = Math.max(Math.abs(chest.tileX - adv.tileX), Math.abs(chest.tileY - adv.tileY))
      if (d > 1) continue
      chest.opened = true
      adv.keys ??= []
      if (!adv.keys.includes(chest.lockId)) adv.keys.push(chest.lockId)
      EventBus.emit('KEY_CHEST_OPENED', { chest, adv })
      const t = adv.goal?.type
      if (t !== 'CHARM_WALK' && t !== 'HUNT_PHYLACTERY' && t !== 'AT_BOSS' && t !== 'FLEE') {
        adv.goalStack ??= []
        if (adv.goal) adv.goalStack.push(adv.goal)
        adv.goal = { type: 'OPEN_LOCKED_DOOR', lockId: chest.lockId }
        adv.path = null
      }
      EventBus.emit('SAY_pickedKey', { adventurer: adv })
      return
    }
  }

  setPersonalitySystem(ps) { this._personalitySystem = ps }
  setCombatSystem(cs)      { this._combatSystem = cs }
  setKnowledgeSystem(ks)   { this._knowledgeSystem = ks }

  // Track who hit whom so death attribution is accurate, and trigger flee on damage.
  _onCombatHit({ sourceId, targetId, damageType }) {
    const adv = this._gameState.adventurers.active.find(a => a.instanceId === targetId)
    if (!adv) return
    adv._lastHitBy   = sourceId
    adv._lastHitType = damageType
    this._checkFleeTrigger(adv)
  }

  // True if a live hostile minion is within melee range of the adventurer.
  _minionAdjacent(adv) {
    for (const m of this._gameState.minions ?? []) {
      if (m.faction !== 'dungeon') continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (Math.abs(m.tileX - adv.tileX) <= 1 && Math.abs(m.tileY - adv.tileY) <= 1) return true
    }
    return false
  }

  // Whenever an adventurer kills something, ~25% chance for a brief gloat
  // pause + chat line. Skipped for boss kills (BOSS_FIGHT_INCOMING flow
  // owns those reactions) and for fleeing/dying adventurers.
  _onCombatKill({ source, victim }) {
    if (!source?.instanceId) return
    const adv = this._gameState.adventurers?.active?.find(a => a.instanceId === source.instanceId)
    if (!adv || adv.aiState === 'dead' || adv.aiState === 'fleeing') return
    if (victim?.isBoss) return
    if (Math.random() >= GLOAT_CHANCE) return
    // Don't interrupt critical goals (charm, hunt phylactery, etc.).
    const t = adv.goal?.type
    if (t === 'CHARM_WALK' || t === 'HUNT_PHYLACTERY' || t === 'FLEE' || t === 'AT_BOSS') return
    adv._gloatUntil = this._scene.time.now + GLOAT_DURATION_MS
    EventBus.emit('SAY_gloatOverKill', { adventurer: adv })
  }

  // ── LOOT_CORPSE ──────────────────────────────────────────────────────
  // Pile shape: { instanceId, tileX, tileY, fromAdvId, fromAdvName,
  //              buff: { stat, amount, label } }
  //
  // Buffs are tiny so even a string of looted corpses doesn't break combat
  // balance. Stats reach into adv.stats (attack/defense/maxHp/speed).
  // The +<n> floater is rendered by AdventurerRenderer after we emit
  // BUFF_GAINED with the same label string.
  _dropLootPile(adv) {
    const buffPool = [
      { stat: 'attack',  amount: 2, label: '+2 ATK' },
      { stat: 'defense', amount: 1, label: '+1 DEF' },
      { stat: 'maxHp',   amount: 5, label: '+5 HP'  },
      { stat: 'speed',   amount: 0.15, label: '+SPD' },
    ]
    const buff = buffPool[Math.floor(Math.random() * buffPool.length)]
    const pile = {
      instanceId:  `loot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tileX:       adv.tileX,
      tileY:       adv.tileY,
      worldX:      adv.worldX,
      worldY:      adv.worldY,
      fromAdvId:   adv.instanceId,
      fromAdvName: adv.name ?? 'unknown',
      buff,
    }
    this._gameState.dungeon.lootPiles ??= []
    this._gameState.dungeon.lootPiles.push(pile)
    EventBus.emit('LOOT_PILE_DROPPED', { pile })
    // Boss-chamber corpses are not lootable — adventurers there are
    // already locked into the fight and shouldn't peel off to grab loot.
    const pileRoom = this._dungeonGrid?.getRoomAtTile?.(pile.tileX, pile.tileY)
    if (pileRoom?.definitionId === 'boss_chamber') return
    // Roll nearby walking advs for the LOOT_CORPSE goal.
    //   • greedy / vulture → 100% if in sight
    //   • anti_loot         → never (refuses to grab even free loot)
    //   • everyone else     → LOOT_CHANCE roll
    const advs = this._gameState.adventurers?.active ?? []
    for (const a of advs) {
      if (a.instanceId === adv.instanceId) continue
      if (a.aiState === 'dead' || a.aiState === 'fleeing') continue
      const t = a.goal?.type
      if (t === 'CHARM_WALK' || t === 'HUNT_PHYLACTERY' || t === 'AT_BOSS'
          || t === 'FLEE' || t === 'LOOT_CORPSE') continue
      const d = Math.hypot(a.tileX - pile.tileX, a.tileY - pile.tileY)
      if (d > LOOT_SIGHT_RANGE) continue
      const tags = this._personalitySystem?.getTags(a) ?? new Set()
      if (tags.has('anti_loot')) continue
      const greedy = tags.has('greedy') || tags.has('vulture') || tags.has('loot_seeker')
      if (!greedy && Math.random() >= LOOT_CHANCE) continue
      a.goalStack ??= []
      if (a.goal) a.goalStack.push(a.goal)
      a.goal = { type: 'LOOT_CORPSE', pileId: pile.instanceId }
      a.path = null
      EventBus.emit('SAY_lootCorpseStart', { adventurer: a })
    }
  }

  // Apply a loot-pile buff to the adventurer and emit BUFF_GAINED so the
  // renderer can pop a "+2 ATK" floater above their head.
  _applyLootBuff(adv, pile) {
    const { stat, amount, label } = pile.buff
    if (!adv.stats) adv.stats = {}
    if (stat === 'maxHp') {
      adv.resources.maxHp = (adv.resources.maxHp ?? 0) + amount
      adv.resources.hp    = Math.min(adv.resources.maxHp, (adv.resources.hp ?? 0) + amount)
    } else {
      adv.stats[stat] = (adv.stats[stat] ?? 0) + amount
    }
    adv.flags ??= {}
    adv.flags.lootedCorpses = (adv.flags.lootedCorpses ?? 0) + 1
    EventBus.emit('BUFF_GAINED', { adventurer: adv, label })
    EventBus.emit('SAY_lootCorpseDone', { adventurer: adv })
  }

  // When an adventurer enters a room with a real threat, they shout to
  // their party. Threat = a high-tier minion (evolved minion or boss-level
  // ≥3 boss-spawn) OR an armed trap they already know about. The warner
  // gets the chat line; nearby party-mates get a brief trapCaution-ish
  // boost (currently just a flag — pathfinder hookup lands with AVOID_TRAP
  // in Phase 3).
  _maybeWarnParty(adv, roomId) {
    const now = this._scene.time.now
    if ((adv._lastWarnAt ?? 0) + WARN_COOLDOWN_MS > now) return
    const room = this._gameState.dungeon.rooms.find(r => r.instanceId === roomId)
    if (!room) return

    // Evolved minions or strong minions (definitionId ending with a digit
    // ≥3, e.g. orc3, slime9) count as a threat.
    const minionsHere = (this._gameState.minions ?? []).filter(m =>
      m.aiState !== 'dead' && m.tileX != null &&
      m.tileX >= room.gridX && m.tileX < room.gridX + room.width &&
      m.tileY >= room.gridY && m.tileY < room.gridY + room.height
    )
    const strongMinion = minionsHere.find(m => {
      const id = String(m.definitionId ?? '')
      const lastChar = id[id.length - 1]
      return /\d/.test(lastChar) && Number(lastChar) >= 3
    })

    // A trap THIS adventurer knows about, sitting in this room, counts as
    // a threat worth shouting "trap!" over. Knowledge is per-adventurer —
    // adv.knowledge.traps is keyed by trap instanceId (populated on a
    // personal trigger-sighting or inherited from the shared pool).
    const knownTraps = (this._gameState.dungeon.traps ?? []).filter(t =>
      t.disarmed !== true &&
      t.tileX >= room.gridX && t.tileX < room.gridX + room.width &&
      t.tileY >= room.gridY && t.tileY < room.gridY + room.height &&
      adv.knowledge?.traps?.[t.instanceId] != null
    )

    if (!strongMinion && knownTraps.length === 0) return

    adv._lastWarnAt = now
    EventBus.emit('SAY_warnParty', { adventurer: adv })
    // Brief party caution flag — picked up by AVOID_TRAP pathfinder hook
    // in Phase 3. Set on every party-mate within WARN_RADIUS tiles.
    const advs = this._gameState.adventurers?.active ?? []
    for (const mate of advs) {
      if (mate.instanceId === adv.instanceId) continue
      if (mate.aiState === 'dead') continue
      const d = Math.hypot(mate.tileX - adv.tileX, mate.tileY - adv.tileY)
      if (d > WARN_RADIUS) continue
      if (Math.random() >= WARN_CHANCE) continue
      mate._warnedUntil = now + WARN_COOLDOWN_MS
    }
  }

  // Push every nearby walking adventurer toward the noise tile, with a
  // probability roll per adv. Skips advs already on a higher-priority
  // goal so we don't yank them off a flee or boss path.
  // Detect PARTY_WIPED — fires when the last living party member dies AND any
  // surviving traumatized member should panic-flee (sole survivor scenario).
  _onAdventurerDied({ adventurer }) {
    if (!adventurer?.partyId) return
    const survivors = this._gameState.adventurers.active.filter(
      a => a.partyId === adventurer.partyId && a.aiState !== 'dead'
    )

    if (survivors.length === 0) {
      EventBus.emit('PARTY_WIPED', { partyId: adventurer.partyId, lastDead: adventurer })
      return
    }
    if (survivors.length === 1) {
      const survivor = survivors[0]
      const isTraumatized = survivor.personalityIds?.includes('traumatized')
      if (isTraumatized) {
        EventBus.emit('PARTY_WIPED', { partyId: adventurer.partyId, lastSurvivor: survivor })
        survivor.flags = survivor.flags ?? {}
        survivor.flags.fullKnowledgeOnFlee = true   // Phase 8 will read this
        this._setFleeGoal(survivor, 'traumatized_panic')
      }
    }

  }

  // When the party wins a boss fight, force every adventurer still in the dungeon
  // to flee — not just those who were inside _fightStates. Split-off adventurers
  // (solo, chat_poll redirect, etc.) never receive the BossSystem handoff and
  // would otherwise keep exploring indefinitely.
  // Barbarian and noFlee flags are intentionally bypassed: the dungeon run is
  // over for this wave and everyone must exit.
  _onBossFightResolved({ winner, bossHpRemaining }) {
    if (winner !== 'party') return
    // Stalemate cap: party "won" on HP-fraction while the boss is still
    // alive. Use a different reason so the log doesn't claim the boss
    // was slain (matches BossFightOverlay's "INTRUDER WITHDREW" slate).
    const reason = (bossHpRemaining ?? 0) <= 0 ? 'boss_defeated' : 'boss_stalemate'
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead' || adv.aiState === 'fleeing' ||
          adv.aiState === 'fled' || adv.aiState === 'leaving') continue
      // Cinematic-duel survivors own their OWN scripted exit — don't generic-
      // flee them. Light Party fires BOSS_FIGHT_RESOLVED the instant the boss
      // falls (start of its win outro), so without this skip the members would
      // walk out of the throne room mid-cutscene instead of staying for their
      // victory lines + Recall. (Shadow Monarch normally fires this only after
      // his outro, but skip him too for safety/symmetry.)
      if (adv._lightParty || adv._shadowMonarch) continue
      adv.goal    = { type: 'FLEE', reason }
      adv.aiState = 'fleeing'
      adv.path    = null
    }
  }

  // Called every Game.update() frame. delta is in ms, already scaled by time scale.
  update(delta) {
    const active = this._gameState.adventurers.active

    // Solo Leveling — throttled HP feed (~10/s) for the persistent corner HP
    // bar (SoloLevelingCinematic) shown while Jinwoo roams the dungeon. Only
    // emits when a live Shadow Monarch is present; the bar hides itself once
    // the boss duel begins (the duel has its own two-bar header).
    this._smHpAccum = (this._smHpAccum ?? 0) + delta
    if (this._smHpAccum >= 100) {
      this._smHpAccum = 0
      const jin = active.find(a => a._shadowMonarch && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)
      if (jin) {
        const mx = jin.resources?.maxHp ?? jin.resources?.hp ?? 1
        EventBus.emit('SHADOW_MONARCH_HP', {
          instanceId: jin.instanceId,
          hp:    Math.max(0, Math.round(jin.resources?.hp ?? 0)),
          maxHp: Math.max(1, Math.round(mx)),
          frac:  mx > 0 ? Math.max(0, Math.min(1, (jin.resources?.hp ?? 0) / mx)) : 0,
          name:  jin.name ?? 'THE SHADOW MONARCH',
        })
      }
      // Light Party — same shape, batched into a single LIGHT_PARTY_HP event
      // per member (no per-event chatter on the bus). The cinematic corner
      // panel listens and updates each row. Cheap no-op on every other day.
      for (const a of active) {
        if (!a?._lightParty) continue
        EventBus.emit('LIGHT_PARTY_HP', {
          instanceId: a.instanceId,
          hp:    Math.max(0, Math.round(a.resources?.hp ?? 0)),
          maxHp: Math.max(1, Math.round(a.resources?.maxHp ?? a.resources?.hp ?? 1)),
        })
      }
    }

    // Tile occupancy map for this tick — used to keep adventurers from
    // physically overlapping each other while walking. Built once per
    // update so every adventurer sees a consistent snapshot.
    //   key: "x,y"  →  instanceId of the adventurer currently on that tile
    // Adventurers in combat/healing/sleeping count too — they're standing
    // on the tile and shouldn't be walked through.
    this._occupancy = {}
    for (const a of active) {
      if (a.aiState === 'dead' || a.resources.hp <= 0) continue
      this._occupancy[`${a.tileX},${a.tileY}`] = a.instanceId
    }

    // Per-frame A* pathfinder budget. Caps the number of full A* calls
    // any single frame can make so a burst of simultaneous "path
    // exhausted" / "goal target changed" / "room removed" events
    // doesn't stack N expensive grid searches in the same tick (visible
    // as a frame-time spike during day-22+ waves with many advs).
    // Advs over budget keep their existing path (or wait one extra
    // frame if path was null) — the queued repath fires next tick.
    // Movement still tracks the current waypoint, so visible-side this
    // looks like one extra ~16ms of "carry on doing what you were
    // doing" rather than a freeze.
    this._aiPathBudget = 6

    // Per-tick blocker caches — beacons / fountains / treasure chests are
    // soft-blockers for EVERY adv pathfind this tick. The previous code
    // rebuilt the Set per-adv inside _tickAdv even though the dungeon
    // state is identical across all advs that tick. Snapshot here, reuse
    // per-adv. Locks need per-adv filtering (canAdvUnlockHere varies by
    // class/keys), so we only stash the full LOCKED tile set; per-adv
    // code still filters out the ones the adv can open.
    this._tickSoftBlocked = new Set()
    for (const b of this._gameState.dungeon?.beacons        ?? []) this._tickSoftBlocked.add(`${b.tileX},${b.tileY}`)
    for (const f of this._gameState.dungeon?.fountains      ?? []) this._tickSoftBlocked.add(`${f.tileX},${f.tileY}`)
    for (const c of this._gameState.dungeon?.treasureChests ?? []) this._tickSoftBlocked.add(`${c.tileX},${c.tileY}`)
    // NOTE: `gameState.phylactery` is intentionally NOT added here.
    // The Lich heart must be freely walk-through so non-hunter advs
    // (and even other hunters routing to a different cardinal slot)
    // can cross its tile if their path runs through the room. Hunters
    // path to a cardinal neighbour via the explicit logic in
    // `_goalToTile` HUNT_PHYLACTERY — they don't rely on a soft-block
    // here. If you ever feel the urge to add the heart to this set,
    // don't: it'll trap any adv whose only route to the boss room
    // (or any room past the heart) runs through the heart's tile.
    // Per-tick list of locks that ANY adv might hard-block. Per-adv code
    // skips locks the adv can unlock and adds the remaining doorTiles.
    this._tickLockedLocks = (this._gameState.dungeon?.locks ?? [])
      .filter(l => !l.unlocked && !l.broken)

    // Flee-decision broadcast. Many sites set adv.goal to FLEE (the
    // central _setFleeGoal helper, the oscillation/no_route/goal_lost
    // inline assignments, BossSystem._handOffToAIFlee, etc.). Rather
    // than emit at every call site, we diff goal.type against the
    // previous tick and broadcast ADVENTURER_FLEE_DECIDED the frame
    // anyone first enters FLEE. The dungeon log subscribes to THIS
    // event for the flavor message so the player sees "X panics" at
    // the moment the AI decides, not minutes later when the adv
    // finally crosses the entry-hall threshold and ADVENTURER_FLED
    // fires. Reason / context come straight off the goal — every
    // setter populates them.
    for (const a of active) {
      if (a.aiState === 'dead' || a.aiState === 'fled') continue
      const goalType = a.goal?.type ?? null
      if (goalType === 'FLEE' && a._lastGoalTypeForFleeDetect !== 'FLEE') {
        EventBus.emit('ADVENTURER_FLEE_DECIDED', {
          adventurer: a,
          reason:  a.goal?.reason  ?? null,
          context: a.goal?.context ?? null,
        })
      }
      a._lastGoalTypeForFleeDetect = goalType
    }

    // Dungeon event: Dungeon Pestilence — Blight DoT. ~1 dmg per 2s on
    // any adv who melee'd a minion this day. Accumulator on the adv so
    // the rate is independent of frame timing. Cleared automatically on
    // death (adv removed) or flee (EventSystem clears at end of day).
    if (this._gameState._eventFlags?.pestilenceActive) {
      for (const a of active) {
        if (!a._blighted) continue
        if (a.aiState === 'dead' || a.aiState === 'fleeing' || a.resources.hp <= 0) continue
        a._blightAcc = (a._blightAcc ?? 0) + delta
        while (a._blightAcc >= 2000) {
          a._blightAcc -= 2000
          a.resources.hp = Math.max(0, a.resources.hp - 1)
          if (a.resources.hp <= 0) {
            this._kill(a, active.indexOf(a), 'pestilence')
            break
          }
        }
      }
    }

    // Iterate in reverse so we can splice on death without index trouble
    for (let i = active.length - 1; i >= 0; i--) {
      this._tickAdventurer(active[i], delta, i)
    }
  }

  // Returns true if (tx,ty) is currently occupied by an adventurer other than `selfAdv`.
  _tileOccupiedByOtherAdv(tx, ty, selfAdv) {
    const id = this._occupancy?.[`${tx},${ty}`]
    return !!id && id !== selfAdv.instanceId
  }

  // World-space center of the entry hall's doorway rect, wherever the
  // (possibly rotated) entrance ended up. Delegates to the shared
  // rotation-aware helper so leave-fade snaps the adv to the same spot
  // the spawn-fade snaps to.
  _entryDoorWorldCenter(entry) {
    return entryDoorWorldCenter(entry)
  }

  // ── Per-adventurer tick ─────────────────────────────────────────────────────

  _tickAdventurer(adv, delta, idx) {
    if (adv.aiState === 'dead') return
    if (adv.resources.hp <= 0) {
      this._kill(adv, idx, adv._lastHitBy ?? 'unknown')
      return
    }
    // Healing Fountain blessing tick (2026-05-27). Granted on fountain
    // touch in _tryHealAtFountain; heals a % of maxHp per second while
    // active. Runs here — above the AT_BOSS early-return below — so it
    // ticks even while the adv is locked in the boss fight, which is the
    // whole point: BossSystem reads adv.resources.hp live each combat
    // tick, so this regen directly extends how long they survive the
    // boss. Fractional regen is accumulated so small per-frame amounts
    // aren't lost to integer rounding.
    {
      const bNow = this._scene?.time?.now ?? 0
      if ((adv._fountainBlessUntil ?? 0) > bNow) {
        if (adv.resources.hp < adv.resources.maxHp) {
          const tick = adv.resources.maxHp * Balance.FOUNTAIN_BLESS_REGEN_PCT * (delta / 1000)
          adv._fountainRegenAcc = (adv._fountainRegenAcc ?? 0) + tick
          if (adv._fountainRegenAcc >= 1) {
            const whole = Math.floor(adv._fountainRegenAcc)
            adv._fountainRegenAcc -= whole
            adv.resources.hp = Math.min(adv.resources.maxHp, adv.resources.hp + whole)
          }
        }
      } else if (adv._fountainRegenAcc) {
        adv._fountainRegenAcc = 0
      }
    }
    // Vampire charm — a charmed adventurer must walk to the boss to be
    // turned into a thrall; they NEVER flee. Soft panics (low HP, coward,
    // raid-leader-dead, etc.) are already ignored via _setFleeGoal's
    // _charmed guard, but the hard path-failure conversions (oscillation,
    // blocked/no-route, goal lost) assign a FLEE goal directly. If a
    // charmed adv ends up with one it means they genuinely cannot reach
    // the boss — kill them on the spot rather than let them flee.
    if (adv._charmed && adv.goal?.type === 'FLEE') {
      this._kill(adv, idx, 'vampire_charm')
      return
    }
    // Dungeon event: Rival Dungeon boss — it invades to destroy the
    // player's boss and never flees out of panic. The hard path-failure
    // conversions (oscillation, blocked/no-route, goal lost) assign a FLEE
    // goal directly, bypassing `noFlee`. Intercept those here, BEFORE any
    // movement runs, and re-pick a normal explore/seek goal so the rival
    // boss keeps hunting the dungeon instead of leaving.
    //
    // EXCEPTION: a `boss_defeated` flee is NOT a panic — it's the normal
    // post-fight exit every adventurer takes once the player's boss loses
    // a life. The rival boss leaves on that just like anyone else, so it
    // doesn't loiter and immediately re-engage the refreshed boss.
    if (adv._rivalBoss && adv.goal?.type === 'FLEE' && adv.goal.reason !== 'boss_defeated') {
      const next = this._pickNextGoal(adv)
      adv.goal    = (next && next.type !== 'FLEE') ? next : { type: 'SEEK_BOSS' }
      adv.path    = null
      adv.aiState = 'walking'
    }
    // Solo Leveling — Sung Jinwoo NEVER flees the dungeon. Any flee goal
    // (panic, low HP, fear, day-end "all out", or the post-duel boss_defeated
    // handoff) is turned straight back into SEEK_BOSS — he marches back at the
    // throne. The ONLY exception is when the player's boss is truly dead (no
    // lives left): his work is done and he may leave. This catches every flee
    // path, including the duel's _handOffToAIFlee, so he fights to the death.
    if (adv._shadowMonarch && adv.goal?.type === 'FLEE') {
      const boss = this._gameState.boss
      const bossDead = !!boss && (boss.deathsRemaining ?? 1) <= 0
      if (!bossDead) {
        const next = this._pickNextGoal(adv)
        adv.goal    = (next && next.type !== 'FLEE') ? next : { type: 'SEEK_BOSS' }
        adv.path    = null
        adv.aiState = 'walking'
      }
    }
    // Succubus charm — adv hunts down a former ally and attacks them.
    // Self-destructs after killing 1 ally, or after 5s of finding nothing.
    if (adv.aiState === 'charmed') {
      this._tickCharmedAdv(adv, delta, idx)
      return
    }
    // Phase 5c — while the spawn fade-in is still running, the adv idles
    // in the doorway. Skip movement, pathing, goal switches, and combat
    // checks until AdventurerRenderer clears the fade flags.
    if (adv._spawnFadeEnd != null && (this._scene?.time?.now ?? 0) < adv._spawnFadeEnd) {
      return
    }
    // Mirror — while the leave fade-out is running, the adv idles in
    // the doorway center until the fade completes (handled below near
    // the FLEE → atNorthEdge splice).  Same skip semantics as spawn.
    if (adv._leaveFadeEnd != null && (this._scene?.time?.now ?? 0) < adv._leaveFadeEnd) {
      return
    }
    // Phase: alive AI — gloat-pause after a kill. Adv stands in place,
    // chat bubble is already firing via the COMBAT_KILL listener.
    if (adv._gloatUntil != null && (this._scene?.time?.now ?? 0) < adv._gloatUntil) {
      return
    }
    // Phase: alive AI — looting freeze. Adv idles next to the corpse
    // until the timer expires, then takes the buff and resumes normal
    // goals. If the pile vanished mid-loot (other adv stole it, day
    // ended), bail without applying the buff.
    if (adv._lootingUntil != null) {
      const now = this._scene?.time?.now ?? 0
      if (now < adv._lootingUntil) return
      const pileId = adv._lootingPileId
      const piles  = this._gameState.dungeon.lootPiles ??= []
      const idx2   = piles.findIndex(p => p.instanceId === pileId)
      if (idx2 >= 0) {
        const pile = piles[idx2]
        piles.splice(idx2, 1)
        EventBus.emit('LOOT_PILE_REMOVED', { pile, looterId: adv.instanceId })
        this._applyLootBuff(adv, pile)
      }
      adv._lootingUntil = null
      adv._lootingPileId = null
      adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
      adv.path = null
      return
    }
    // ── Anti-ping-pong watchdog (2026-05-27) ────────────────────────────
    // If the adv has been failing to make any meaningful progress toward
    // their pathTarget for 5+ seconds (visible "running back and forth"
    // loop around a known trap), flip them into PANIC-WALK mode for the
    // next 3 seconds: the path block reads `_panicWalkUntil` and disables
    // BOTH the trap-knowledge cost weighting AND the sprung-trap soft-
    // block. The pathfinder then picks the most direct route — even if
    // that means walking straight through the trap. The adv triggers
    // the trap, takes damage (or dies), and the loop is broken.
    // Resets on goal change so a normal "switched to a new objective"
    // doesn't get punished as no-progress.
    {
      const wNow = this._scene?.time?.now ?? 0
      const goalTypeKey = adv.goal?.type ?? 'none'
      if (adv._loopGoalKey !== goalTypeKey || adv._loopBestDist == null) {
        // Goal changed (or first time) — reset the watchdog baseline.
        adv._loopGoalKey  = goalTypeKey
        adv._loopBestDist = null
        adv._loopBestAt   = wNow
      }
      // Use pathTarget when present (the actual A* destination); fall
      // back to nothing — we can't measure progress without a target.
      const tgt = adv.pathTarget
      if (tgt && typeof tgt.x === 'number' && typeof tgt.y === 'number') {
        const dist = Math.abs(adv.tileX - tgt.x) + Math.abs(adv.tileY - tgt.y)
        const best = adv._loopBestDist
        if (best == null || dist < best - 0.5) {
          // Made meaningful progress — reset the timer.
          adv._loopBestDist = dist
          adv._loopBestAt   = wNow
        } else if (wNow - (adv._loopBestAt ?? wNow) > 5000) {
          // 5+ seconds without progress — confirmed loop. Panic-walk.
          adv._panicWalkUntil = wNow + 3000
          adv.path            = null  // force re-path with the new flag
          adv._loopBestDist   = dist  // reset so we don't re-trigger
          adv._loopBestAt     = wNow
          this._aiDiag(adv, `WATCHDOG FIRED panic-walk +3s | goal=${goalTypeKey} target=(${tgt.x},${tgt.y}) dist=${dist}`)
          this._escalateStuckExplore(adv)
        }
        // Diagnostic: warn every ~1s when an adv is in the no-progress
        // window (3-5s) but not yet panic-walked. Catches the case
        // where the watchdog WOULD fire but something else (goal change,
        // path null) keeps resetting it just before the 5s mark.
        const noProgressMs = wNow - (adv._loopBestAt ?? wNow)
        if (noProgressMs > 3000 && (wNow - (adv._lastDiagAt ?? 0)) > 1000) {
          adv._lastDiagAt = wNow
          this._aiDiag(adv,
            `STUCK ${(noProgressMs / 1000).toFixed(1)}s | tile=(${adv.tileX},${adv.tileY}) goal=${goalTypeKey} target=(${tgt.x},${tgt.y}) dist=${dist} bestDist=${adv._loopBestDist} panicWalk=${(adv._panicWalkUntil ?? 0) > wNow}`)
        }
      }
      // Diagnostic: log every goal change so we can see if the adv is
      // goal-flickering (cause of ping-pong that the watchdog can't fix
      // because the progress baseline keeps resetting).
      if (adv._diagLastGoal !== goalTypeKey) {
        this._aiDiag(adv, `goal: ${adv._diagLastGoal ?? '(none)'} -> ${goalTypeKey}`)
        adv._diagLastGoal = goalTypeKey
      }

      // Position-stagnation watchdog (2026-05-27 follow-up). The pathTarget
      // tracker above resets every time the goal flips (because pathTarget
      // changes too) — so an adv ping-ponging between two EXPLORE_ROOM
      // goals around a trapped chokepoint never trips it: dist-to-target
      // drops each step even though their tile position oscillates in
      // place. Player's screenshots showed exactly this: 12+ advs stuck
      // walking up to a trap, turning around, walking to the other room,
      // and repeating, with the pathTarget watchdog never escalating.
      //
      // This watchdog tracks the adv's actual tile position via an anchor
      // + Chebyshev radius. As long as they stay within STAG_RADIUS_TILES
      // of the anchor, the timer runs; only a move >RADIUS away resets the
      // anchor. Independent of goals, so goal-churn can't fool it.
      // Gated on aiState === 'walking' && pathTarget so we don't false-fire
      // on intentionally stationary states (fighting, looting, idle, etc.).
      if (adv.aiState === 'walking' && adv.pathTarget) {
        const ax = adv._stagAnchorX
        const ay = adv._stagAnchorY
        const farFromAnchor = (ax == null || ay == null) ||
          Math.max(Math.abs(adv.tileX - ax), Math.abs(adv.tileY - ay)) > STAG_RADIUS_TILES
        if (farFromAnchor) {
          adv._stagAnchorX  = adv.tileX
          adv._stagAnchorY  = adv.tileY
          adv._stagAnchorAt = wNow
        } else if (wNow - (adv._stagAnchorAt ?? wNow) > STAG_TIMEOUT_MS) {
          adv._panicWalkUntil = wNow + 3000
          adv.path            = null
          adv._stagAnchorX    = adv.tileX
          adv._stagAnchorY    = adv.tileY
          adv._stagAnchorAt   = wNow
          this._aiDiag(adv, `STAG WATCHDOG FIRED panic-walk +3s | goal=${goalTypeKey} pos=(${adv.tileX},${adv.tileY})`)
          this._escalateStuckExplore(adv)
        }
      } else {
        // Not actively walking — clear the anchor so the timer doesn't
        // carry over once they resume movement.
        adv._stagAnchorX  = null
        adv._stagAnchorY  = null
        adv._stagAnchorAt = null
      }
    }
    // AT_BOSS adventurers are owned by BossSystem.  Skip every other AI
    // branch and free our occupancy entry so the 4th party member can
    // path through the doorway tile this one used to hold.  Without the
    // short-circuit, _goalToTile returns null for AT_BOSS, the recent
    // path-failure → FLEE conversion fires, and the adv flickers between
    // AI flee-walk and BossSystem orbit every frame ("teleporting").
    if (adv.goal?.type === 'AT_BOSS') {
      if (this._occupancy) {
        const key = `${adv.tileX},${adv.tileY}`
        if (this._occupancy[key] === adv.instanceId) delete this._occupancy[key]
      }
      return
    }

    // Pass-1 minion abilities — DoT damage + status expiry. Run early so an
    // adv that drops to 0 HP from poison/burn is killed this tick rather than
    // continuing to walk through goals first.
    MinionAbilities.tickEntity(adv, this._scene, delta)
    if (adv.resources.hp <= 0) {
      this._kill(adv, idx, adv._lastHitBy ?? 'dot')
      return
    }
    // Root / stagger gate — adv stands still for the duration. Any minion
    // already in range gets free swings (CombatSystem hits them normally).
    const _now = this._scene?.time?.now ?? 0
    if (MinionAbilities.isRooted(adv, _now) || MinionAbilities.isStaggered(adv, _now)) {
      return
    }
    // Sundered Floor pact stun — adv that just dropped into a sundered tile
    // is briefly frozen. _sunderedStunUntil is stamped by the pact handler
    // in DungeonMechanicSystem on tile entry; same freeze-in-place semantics
    // as root/stagger.
    if (adv._sunderedStunUntil != null && _now < adv._sunderedStunUntil) {
      return
    }

    // Hall of Madness — clear stale frenzy state up front (target dead /
    // left the room / adv left the Hall). When this returns true the goal
    // was just restored, so we let the rest of the tick recompute paths.
    this._maybeClearMadness(adv)

    // General stuck detector — if the adv hasn't made meaningful progress
    // (either tile change OR ~half-tile of world movement) for >1.5s and
    // they're not in a freeze-by-design state, assume something (usually
    // a mimic-block edge case) is locking them in place and force the
    // mimic-bypass flag so they shove through next plan. The flag clears
    // on the next successful blocked replan.
    //
    // 'fighting' is intentionally NOT exempt: if combat freezes them on
    // one tile for >1.5s it's almost always because the target is
    // unreachable (across a chest blockade or behind a wall) and forcing
    // a bypass replan resolves that.
    //
    // World-position tracking catches a case the tile-based variant
    // missed: an adv whose worldX/Y oscillates around a tile boundary
    // (so tileX/Y flickers between two adjacent values each tick) was
    // resetting the detector every frame.
    const stuckExempt = adv.aiState === 'dead' ||
                        adv.goal?.type === 'AT_BOSS' ||
                        adv._leaveFadeEnd != null ||
                        adv._spawnFadeEnd != null
    if (!stuckExempt) {
      const STUCK_MS = 1500
      const PROGRESS_PX = TS / 2     // ~half-tile counts as moved
      const lastWX = adv._lastWorldX ?? adv.worldX
      const lastWY = adv._lastWorldY ?? adv.worldY
      const moved = Math.hypot(adv.worldX - lastWX, adv.worldY - lastWY) >= PROGRESS_PX
      if (moved) {
        adv._lastWorldX = adv.worldX
        adv._lastWorldY = adv.worldY
        adv._tileStuckMs = 0
      } else {
        adv._tileStuckMs = (adv._tileStuckMs ?? 0) + delta
        if (adv._tileStuckMs > STUCK_MS) {
          adv.path = null
          adv._tileStuckMs = 0
          adv._waitMs = 0
          adv._lastWorldX = adv.worldX
          adv._lastWorldY = adv.worldY
          EventBus.emit('ADVENTURER_UNSTUCK', {
            adventurer:    adv,
            tile:          { x: adv.tileX, y: adv.tileY },
            goal:          adv.goal?.type ?? null,
            aiState:       adv.aiState,
          })
          // Diagnostic routed through _aiDiag (no-op stub by default; the
          // F4 on-screen overlay surfaces these without spamming the
          // console). Previously a raw console.log that fired per-stuck-
          // tick — fine with 10 advs, an unreadable torrent at 95+.
          this._aiDiag(adv, `stuck-unstuck at (${adv.tileX},${adv.tileY}) goal=${adv.goal?.type ?? '(none)'} state=${adv.aiState}`)
        }
      }

      // Oscillation failsafe — catches the case the soft detector above
      // misses: an adv that ping-pongs between two adjacent tiles passes
      // the half-tile-per-1.5s displacement check every frame, but
      // never makes real progress. Sample the current tile every
      // OSC_SAMPLE_MS, keep a rolling OSC_WINDOW_MS window of samples,
      // and if the window covers a full sustained period (≥3s of
      // samples) but only contains ≤2 unique tiles, give up on the
      // original goal and force a FLEE so they head home instead of
      // hanging the day. Skipped for already-fleeing advs (they can't
      // escalate further) and for advs the soft detector exempts.
      const OSC_SAMPLE_MS = 200
      const OSC_WINDOW_MS = 5000
      const OSC_TRIGGER_SAMPLES = 15      // 15 × 200ms = 3s of samples
      const now = this._scene.time?.now ?? 0
      adv._oscNextAt ??= 0
      if (now >= adv._oscNextAt) {
        adv._oscNextAt = now + OSC_SAMPLE_MS
        // In melee, standing still IS the correct behaviour — an adventurer
        // toe-to-toe with a hostile minion is fighting, not wedged. Wipe the
        // sample window while a minion is in melee range so a long fight
        // can't trip the failsafe and flee them mid-swing. The `fighting`
        // state also covers adventurer-vs-adventurer duels (Tournament
        // rivals, Twitch beef) — those legitimately hold a tile too.
        if (this._minionAdjacent(adv) || adv.aiState === 'fighting') adv._oscRing = []
        adv._oscRing ??= []
        adv._oscRing.push({ x: adv.tileX, y: adv.tileY, t: now })
        while (adv._oscRing.length > 0 && (now - adv._oscRing[0].t) > OSC_WINDOW_MS) {
          adv._oscRing.shift()
        }
        if (adv._oscRing.length >= OSC_TRIGGER_SAMPLES) {
          const unique = new Set(adv._oscRing.map(e => `${e.x},${e.y}`))
          // Standard 2-tile ping-pong (e.g. wedged against a wall).
          let oscillating = unique.size <= 2
          // Doorway ping-pong: adv walks room A → DOOR → room B → DOOR
          // → room A → ... or paces back and forth in front of a door
          // they can't pass. The DOOR check keeps the threshold from
          // over-firing on legit travel (real walking sweeps ≥5 unique
          // tiles in 3 s); widened to ≤4 unique tiles so we also catch
          // the "two approach tiles + door + back-step" pattern.
          if (!oscillating && unique.size <= 4 && this._dungeonGrid?.getTileType) {
            for (const k of unique) {
              const [x, y] = k.split(',').map(Number)
              if (this._dungeonGrid.getTileType(x, y) === TILE.DOOR) {
                oscillating = true
                break
              }
            }
          }
          if (oscillating) {
            // Escalation depends on whether they're already fleeing.
            // Non-FLEE goals: convert to FLEE so they head home — that's
            // usually enough to break a self-induced ping-pong because
            // FLEE re-targets the entry hall door from scratch.
            // FLEE that's STILL oscillating means the entry path itself
            // is broken (door won't open, blocked by minion in a way
            // pathfind can't route around). Force-despawn — better to
            // boot one stuck adv than freeze day-end forever waiting on
            // them to find their way out.
            const wasFlee = adv.goal?.type === 'FLEE'
            EventBus.emit('ADVENTURER_OSCILLATION_BREAK', {
              adventurer: adv,
              tile:       { x: adv.tileX, y: adv.tileY },
              uniqueTiles: [...unique],
              escalation: wasFlee ? 'despawn' : 'flee',
            })
            // eslint-disable-next-line no-console
            console.log('[oscillation-break] adv', adv.instanceId,
              'at', adv.tileX, adv.tileY, 'unique:', unique.size,
              'goalWas:', adv.goal?.type, 'reason:', adv.goal?.reason)
            if (wasFlee) {
              this._despawn(adv, idx, 'oscillation_at_exit')
              return
            }
            // noFlee advs (zombie horde, tournament rivals, rival-dungeon
            // monsters) AND Treasure-Hunter raiders must NEVER be converted to
            // FLEE by this failsafe — that's the "event wave walks in then
            // immediately bolts" bug. Raiders fan out to explore the WHOLE
            // dungeon hunting chests (2026-05-29); a full wave crowding the
            // doorways trips the oscillation detector, and fleeing them mid-
            // search both spams the log ("lost in the dungeon") and aborts the
            // hunt. Just replanning isn't enough either: a body wedged at a
            // doorway re-plans the same route and keeps pacing. Shove it forward
            // along its own path past the chokepoint instead; if it has no
            // usable path, fall back to a replan. The hard-stuck failsafe below
            // still clears anyone genuinely pinned, so no day-end hang.
            if (adv.flags?.noFlee || adv._treasureHunter) {
              if (!this._shoveAlongPath(adv, 4)) {
                adv.path = null
                adv.goal = this._pickNextGoal(adv)
              }
              adv._oscRing = []
              adv._tileStuckMs = 0
            } else {
              adv.goal    = { type: 'FLEE', reason: 'oscillation' }
              adv.path    = null
              adv.aiState = 'fleeing'
              adv._oscRing = []
              adv._tileStuckMs = 0
            }
          }
        }
      }
    }

    // Hard stuck failsafe — if the soft detectors above have not freed
    // the adv after STUCK_FAILSAFE_MS of zero tile change, kill them.
    // Prevents day-end hangs from genuine pins (collision bug, unreachable
    // goal, etc.). Same exemptions as the soft detector + petrify
    // (Beholder Gaze legitimately freezes for 2 s) + fighting (combat
    // legitimately holds the adv on a tile while they trade blows).
    const _hardStuckNow = this._scene?.time?.now ?? 0
    const hardStuckExempt = stuckExempt ||
      adv.aiState === 'fighting' ||
      (adv._petrifiedUntil != null && _hardStuckNow < adv._petrifiedUntil)
    if (!hardStuckExempt) {
      if (adv._hardStuckTileX !== adv.tileX || adv._hardStuckTileY !== adv.tileY) {
        adv._hardStuckTileX = adv.tileX
        adv._hardStuckTileY = adv.tileY
        adv._hardStuckMs = 0
      } else {
        adv._hardStuckMs = (adv._hardStuckMs ?? 0) + delta
        if (adv._hardStuckMs > Balance.STUCK_FAILSAFE_MS) {
          // Boss Royale invaders + the Rival Dungeon boss legitimately
          // QUEUE at the throne: ~11 rush the boss chamber at once and
          // only as many as fit the doorway funnel can convert to AT_BOSS
          // (fighting) at a time. The overflow sits in SEEK_BOSS, pinned
          // by occupancy — which this failsafe was auto-killing, surfacing
          // as the "stuck in the middle of the room, then die" bug. Don't
          // cull them: shove them forward along their path (or replan) so
          // the funnel keeps flowing, and reset the timer. The boss fight
          // always resolves (combatants die → interior tiles free up, or
          // the boss dies → everyone flees), so the queue drains without a
          // day-end hang — same nudge the soft oscillation detector gives
          // noFlee event waves above.
          if (this._beelinesBoss(adv)) {
            if (!this._shoveAlongPath(adv, 4)) {
              adv.path = null
              adv.goal = this._pickNextGoal(adv)
            }
            adv._hardStuckMs = 0
          } else {
            // eslint-disable-next-line no-console
            console.log('[stuck-failsafe] adv', adv.instanceId, 'pinned at',
              adv.tileX, adv.tileY, 'for >',
              Balance.STUCK_FAILSAFE_MS, 'ms — auto-kill')
            this._kill(adv, idx, 'stuck_failsafe')
            return
          }
        }
      }
    } else {
      // Reset while exempt so the timer starts fresh once exemption clears.
      adv._hardStuckMs = 0
    }

    // Track whether the adventurer has ever been outside ALL entry halls.
    // Without this, advs that get a FLEE goal immediately on spawn (e.g.
    // their first pathfind failed and we converted to FLEE) would auto-
    // splice on the first tick because they're still standing in the
    // entry from spawn time.
    //
    // Adventurers spawn from — and escape through — any entry hall, so
    // these checks scan ALL of them:
    //   insideEntry — the entry hall the adventurer currently stands in
    //   exitEntry   — the entry hall whose external exit edge they're on
    const entries = this._entryHalls()
    const insideEntry = entries.find(e =>
      adv.tileX >= e.gridX && adv.tileX < e.gridX + e.width &&
      adv.tileY >= e.gridY && adv.tileY < e.gridY + e.height) ?? null
    const inEntry = insideEntry != null
    if (!inEntry) adv._leftEntry = true

    // The dungeon entrance is an entry hall's external doorway — the
    // canonical exit/entry gate. An Entry Hall can be rotated, so the
    // doorway may sit on any edge; fleeing counts as "escaped" once the
    // adventurer reaches the edge row/column that doorway is on, for ANY
    // entry hall.
    let exitEntry = null
    for (const e of entries) {
      const inX = adv.tileX >= e.gridX && adv.tileX < e.gridX + e.width
      const inY = adv.tileY >= e.gridY && adv.tileY < e.gridY + e.height
      let atEdge = false
      switch (entryDoorSide(e)) {
        case 'N': atEdge = inX && adv.tileY === e.gridY;                 break
        case 'S': atEdge = inX && adv.tileY === e.gridY + e.height - 1;   break
        case 'W': atEdge = inY && adv.tileX === e.gridX;                  break
        case 'E': atEdge = inY && adv.tileX === e.gridX + e.width - 1;    break
      }
      if (atEdge) { exitEntry = e; break }
    }
    const atExitEdge = exitEntry != null

    // If fleeing and physically RETURNING to the entry_hall's exit edge
    // (must have left at some point), leave the dungeon. Snap to the
    // doorway center for the visual flourish, then splice IMMEDIATELY
    // — no 600 ms fade-out hold (2026-05-27).
    //
    // The old fade-and-then-splice path made every fleeing adv occupy
    // the door tile for 600 ms before despawning. With many advs at
    // end-of-day this stacked into a visible queue and the player had
    // to wait for each one. Splice-on-contact keeps the "they reached
    // the door, they're gone" beat without the wait. Pairs with the
    // FLEE_SPEED_MULT bump so the doorway clears fast.
    if (adv.goal?.type === 'FLEE' && atExitEdge && adv._leftEntry) {
      // Phase 9: Sealed Paths — 50% chance to reroute fleeing
      // adventurers back into the dungeon. Fires BEFORE the splice (so
      // reroute can still happen) but is now a single-tick decision
      // instead of waiting until a fade completed.
      if ((this._gameState._mechanicFlags ?? {}).sealedPaths && !adv._sealedPathsChecked) {
        adv._sealedPathsChecked = true
        if (Math.random() < Balance.MECHANIC_SEALED_PATHS_BLOCK_CHANCE) {
          const rooms = (this._gameState.dungeon.rooms ?? []).filter(
            r => r.definitionId !== 'entry_hall' && r.isActive !== false
          )
          if (rooms.length > 0) {
            const dest = rooms[Math.floor(Math.random() * rooms.length)]
            adv.aiState = 'walking'
            adv.goal    = { type: 'EXPLORE_ROOM', roomId: dest.instanceId }
            adv.path    = null
            EventBus.emit('SEALED_PATHS_BLOCKED', { adventurer: adv, roomId: dest.instanceId })
            return
          }
        }
      }
      // Snap to the doorway center for the "they walked through the
      // door" visual, then splice in the same tick.
      const door = this._entryDoorWorldCenter(exitEntry)
      if (door) {
        adv.tileX  = door.tileX
        adv.tileY  = door.tileY
        adv.worldX = door.worldX
        adv.worldY = door.worldY
      }
      adv.aiState = 'fled'
      this._gameState.adventurers.active.splice(idx, 1)
      EventBus.emit('ADVENTURER_FLED', {
        adventurer: adv,
        reason: adv.goal.reason ?? 'low_hp_retreat',
        context: adv.goal.context ?? null,
      })
      return
    }
    // Stuck-in-entry timeout — handles the disconnected-dungeon case
    // where an adventurer spawned at entry, couldn't path to anything
    // (got auto-converted to FLEE by the goal-unreachable fallback), and
    // now has nowhere to go.  After ~3 s of being stuck fleeing without
    // ever leaving entry, give up so the day phase can still end.
    if (adv.goal?.type === 'FLEE' && inEntry && !adv._leftEntry) {
      adv._stuckInEntryMs = (adv._stuckInEntryMs ?? 0) + delta
      if (adv._stuckInEntryMs > 3000) {
        // Match the normal-leave flow — snap to doorway center and run
        // the fade-out so we never see an instant disappear.
        const now = this._scene?.time?.now ?? 0
        if (adv._leaveFadeEnd == null) {
          const door = this._entryDoorWorldCenter(insideEntry)
          if (door) {
            adv.tileX  = door.tileX
            adv.tileY  = door.tileY
            adv.worldX = door.worldX
            adv.worldY = door.worldY
          }
          adv.path = null
          adv.aiState = 'leaving'
          adv._leaveFadeStart = now
          adv._leaveFadeEnd   = now + 600
          return
        }
        if (now < adv._leaveFadeEnd) return
        adv.aiState = 'fled'
        this._gameState.adventurers.active.splice(idx, 1)
        EventBus.emit('ADVENTURER_FLED', {
          adventurer: adv,
          reason: 'goal_unreachable',
          context: adv.goal?.context ?? null,
        })
        return
      }
    } else if (adv._stuckInEntryMs) {
      adv._stuckInEntryMs = 0
    }
    // Engage the boss only once we're past the wall thickness on a true
    // INTERIOR floor tile of the chamber.  If we flipped on the bounding
    // rect, the doorway tiles would qualify and BossSystem's interior
    // clamp would snap the adv several tiles into the room — the
    // visible "teleport to the boss" the player kept seeing.  Letting
    // SEEK_BOSS keep control through the doorway lane means AISystem
    // walks them naturally into the room; once they hit the first real
    // floor tile we hand off to BossSystem and the `dash` action runs
    // them at 7 tiles/sec to their orbit slot.
    if (adv.goal?.type === 'SEEK_BOSS') {
      const bossRoom = this._gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
      const WT = Balance.WALL_THICKNESS
      if (bossRoom &&
          adv.tileX >= bossRoom.gridX + WT && adv.tileX < bossRoom.gridX + bossRoom.width  - WT &&
          adv.tileY >= bossRoom.gridY + WT && adv.tileY < bossRoom.gridY + bossRoom.height - WT) {
        // Only redirect to FLEE on TRUE death (no lives left, no
        // phylactery). A non-final death leaves boss.hp at 0 ("death
        // pose") between fights but the boss is still alive overall —
        // the next BOSS_FIGHT_INCOMING refreshes hp to maxHp and starts
        // the fight normally. The prior `boss.hp <= 0` check was too
        // broad: it stopped the second adventurer wave of a single day
        // (or a vendetta-hunter arriving alone after the main party)
        // from ever triggering a fight, leaving them stuck at the
        // boss-room interior with goal SEEK_BOSS → no AT_BOSS handoff,
        // no BOSS_FIGHT_INCOMING, and no path home because they were
        // already on a SEEK_BOSS path — visually a freeze.
        const boss = this._gameState.boss
        const finallyDead = !!boss && (boss.deathsRemaining ?? 1) <= 0
                            && !((this._gameState.phylactery?.resources?.hp ?? 0) > 0)
        if (finallyDead) {
          adv.goal = { type: 'FLEE' }
          adv.path = null
          adv.aiState = 'walking'
          return
        }
        adv.goal    = { type: 'AT_BOSS' }
        adv.path    = null
        adv.aiState = 'fighting'
        EventBus.emit('BOSS_FIGHT_INCOMING', { adventurer: adv })
        return
      }
    }

    // Phase 8: log the room the adventurer is in (idempotent — first visit only emits)
    this._knowledgeSystem?.observeCurrentRoom(adv)

    // Bug fix — emit ADVENTURER_ROOM_CHANGED on every actual room transition
    // (not just on goal completion). RoomBehaviorSystem listens for this to
    // trigger Colosseum gates, False Exit teleports, etc.
    const curRoomId = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId ?? null
    if (curRoomId !== adv._lastRoomId) {
      const prev = adv._lastRoomId ?? null
      adv._lastRoomId = curRoomId
      if (curRoomId) {
        EventBus.emit('ADVENTURER_ROOM_CHANGED', {
          adventurer: adv, fromRoomId: prev, toRoomId: curRoomId,
        })
        this._maybeWarnParty(adv, curRoomId)
        // Starvation failsafe (2026-05-27). Only count REVISITS — entries
        // to rooms the adv has been in before. A legit linear sweep of a
        // giant dungeon (every room once, then exit) tallies zero revisits;
        // a 4-room ping-pong loop racks them up fast. Threshold:
        // STARVATION_ROOM_REVISITS. Skip advs already fighting the boss,
        // fleeing, or with a dedicated event role (saboteur, speedrunner,
        // tournament rival) so we don't murder a legitimately-busy adv.
        // After the kill, return — this adv is out of the array now and
        // the rest of the tick is moot.
        adv._roomsEntered ??= {}   // {roomId: true} — JSON-safe per the
                                   // GameState invariant (no Sets/Maps).
        if (adv._roomsEntered[curRoomId]) {
          adv._roomRevisits = (adv._roomRevisits ?? 0) + 1
        } else {
          adv._roomsEntered[curRoomId] = true
        }
        if (adv._roomRevisits > STARVATION_ROOM_REVISITS &&
            adv.aiState !== 'dead' && adv.aiState !== 'fleeing' &&
            adv.goal?.type !== 'AT_BOSS' &&
            // Dedicated event roles beeline / pile at the throne by design
            // and must not be starved out while queued (single source of
            // truth: _beelinesBoss — Boss Royale gauntlet, the whole Rival
            // Dungeon pack, Shadow Monarch, …). Culling them mid-queue made
            // the gauntlet self-destruct.
            !adv._saboteur && !adv._speedrunner && !adv._tournamentRival &&
            !this._beelinesBoss(adv)) {
          // Light Party + Shadow Monarch NEVER die to the starvation failsafe
          // (immune to all instakill / failsafe deaths by design — they die
          // only to normal combat or the boss duel). If one somehow loops this
          // long, redirect it straight to the throne — bypass the knowledge
          // gate via _forceBossBeeline — so it can't freeze the day, instead
          // of culling it. (2026-05-30)
          if (adv._lightParty || adv._shadowMonarch) {
            adv._forceBossBeeline    = true
            adv._seekExploreTargetId = null
            adv._roomRevisits        = 0
            adv.goal = { type: 'SEEK_BOSS' }
            adv.path = null
            return
          }
          // Death attribution — credit "Starvation" so the graveyard /
          // toast / log read "killed by Starvation" instead of "Unknown".
          // _lookupKillerName resolves the 'starvation' id to its label.
          adv._lastHitBy   = 'starvation'
          adv._lastHitType = 'starvation'
          EventBus.emit('SAY_starvation', { adventurer: adv })
          this._kill(adv, idx, 'starvation')
          return
        }
        // Fountain / chest / key-chest discovery now rides on
        // KnowledgeSystem.observeRoomContents (called from
        // observeCurrentRoom). The old _maybeDiscoverFountain helper was
        // removed when knowledge buckets replaced adv.knownFountains.
      }
    }

    // Phase 8b: sample path for replay ghosts
    this._samplePath(adv, delta)

    // Phase 10b — Twitch Streamer chat_poll: every ~10s, chat picks a random
    // unvisited room and the streamer abandons whatever they were doing
    // to "follow viewer suggestion". Wildly chaotic; loved by the boss.
    // Suppressed when the boss is already dead (hp <= 0) so the poll can't
    // override the flee goal that _onBossFightResolved just set.
    if (adv.classId === 'twitch_streamer' && adv.aiState !== 'fighting' && adv.aiState !== 'fleeing' &&
        (this._gameState.boss?.hp ?? 1) > 0) {
      adv._chatPollAccum = (adv._chatPollAccum ?? 0) + delta
      if (adv._chatPollAccum >= 10000) {
        adv._chatPollAccum = 0
        const visited = new Set(adv.visitedRooms ?? [])
        const candidates = this._gameState.dungeon.rooms.filter(r =>
          !visited.has(r.instanceId) && r.definitionId !== 'boss_chamber'
        )
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)]
          adv.goal = { type: 'EXPLORE_ROOM', roomId: pick.instanceId }
          adv.path = null
          EventBus.emit('TWITCH_CHAT_POLL', { adventurer: adv, targetRoomId: pick.instanceId })
        }
      }
    }

    // Phase 6e: passive room effects (healing fountain heal-on-stand)
    this._applyRoomEffects(adv, delta)

    // Phase 6c: detect coward seeing enemies — flee before engaging
    const spookMinion = this._cowardShouldFlee(adv)
    if (spookMinion) {
      this._setFleeGoal(adv, 'coward_panic', {
        minionName: this._minionDisplayName(spookMinion),
      })
    }

    // Phase 6e: resource-depletion flee. Mana removed in 5b rework, so this
    // now only fires for rangers running out of arrows. Ranger arrow logic is
    // itself slated for removal when the Volley/Trap-Expert ability rework
    // ships, but until then the flee trigger remains valid.
    if (this._resourceExhaustedShouldFlee(adv)) {
      this._setFleeGoal(adv, 'out_of_arrows')
    }

    // Standard flee check (HP threshold)
    this._checkFleeTrigger(adv)

    // Phase: items — Healing Fountain heal-seeking. If the adv knows a
    // fountain, hasn't healed today, and is below the low-HP threshold,
    // detour to the closest known fountain. Skips when already on a
    // higher-priority goal so a charm/flee doesn't get hijacked.
    this._maybeSeekHeal(adv)

    // Phase QW — solo: split off from party on first tick. Once stripped,
    // they ignore party effects and pursue their own goals. No combo banner
    // detection picks them up after this point — they're effectively a lone
    // wolf for the rest of the run.
    if (this._personalitySystem && adv.partyId) {
      const tags = this._personalitySystem.getTags(adv)
      if (tags.has('solo') && !adv.flags?.soloSplit) {
        adv.flags = adv.flags ?? {}
        adv.flags.soloSplit = true
        adv.flags.formerPartyId = adv.partyId
        adv.partyId = null
        EventBus.emit('SOLO_SPLIT', { adventurer: adv })
      }
    }

    // Phase 5c — Cleric heal moved to ClassAbilitySystem._considerCleric
    // (cooldown-driven, no mana). The legacy unconditional-heal-every-tick
    // block here was deleted to avoid double-firing.

    // Hall of Madness: frenzied advs swing at their locked-on ally if in
    // melee range. Bypass the normal _findEngageableMinion flow because
    // that scopes to dungeon-faction targets.
    if (adv.flags?.madnessTargetId && this._combatSystem && adv.aiState !== 'fleeing') {
      const ally = this._gameState.adventurers.active.find(a => a.instanceId === adv.flags.madnessTargetId)
      if (ally && ally.aiState !== 'dead' && (ally.resources?.hp ?? 0) > 0) {
        const reach = Math.max(adv.attackRange ?? 1, Balance.MELEE_RANGE_TILES)
        const d = Math.hypot(ally.tileX - adv.tileX, ally.tileY - adv.tileY)
        if (d <= reach + 0.01) {
          adv.aiState = 'fighting'
          adv.path = null
          this._combatSystem.tryAttack(adv, ally, {
            roomId: this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId,
            method: 'madness',
          })
          return
        }
      }
    }

    // Succubus Charm counter — a charmed adventurer turns traitor and
    // attacks their own party. Allies rallied by _rallyAgainstCharmed
    // carry `flags.charmRetaliateId` and gang up on the traitor: they
    // swing the moment the charmed adv is in melee/attack range (the
    // charmed adv isn't a dungeon-faction target, so _findEngageableMinion
    // never sees them — this mirrors the Hall of Madness block above).
    if (adv.flags?.charmRetaliateId && this._combatSystem && adv.aiState !== 'fleeing') {
      const traitor = this._gameState.adventurers.active.find(
        a => a.instanceId === adv.flags.charmRetaliateId)
      if (!traitor || traitor.aiState !== 'charmed' || (traitor.resources?.hp ?? 0) <= 0) {
        // Traitor cut down, or the charm already broke on its own —
        // drop the vendetta and resume a normal goal.
        adv.flags.charmRetaliateId = null
        if (adv.goal?.type === 'ATTACK_ALLY' && adv.goal?.source === 'charm_retaliation') {
          adv.goal = this._pickNextGoal(adv)
          adv.path = null
        }
      } else {
        const reach = Math.max(adv.attackRange ?? 1, Balance.MELEE_RANGE_TILES)
        const d = Math.hypot(traitor.tileX - adv.tileX, traitor.tileY - adv.tileY)
        if (d <= reach + 0.01) {
          adv.aiState = 'fighting'
          adv.path = null
          this._combatSystem.tryAttack(adv, traitor, {
            roomId: this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId,
            method: 'charm_retaliation',
          })
          return
        }
      }
    }

    // Phase 9 — Pact of the Whisperer: panic-flee on sight of a hostile minion.
    if (adv.flags?.panicFlee && adv.aiState !== 'fleeing' && this._combatSystem) {
      const enemy = this._findEngageableMinion(adv)
      if (enemy) {
        this._setFleeGoal(adv, 'whisperer_panic', {
          minionName: this._minionDisplayName(enemy),
        })
        return
      }
    }
    // Phase 9 — Sworn Rivals: when both rivals fall below half HP, they
    // break ranks and attack each other on sight (in melee/attack-range).
    if (adv.flags?.swornRivalOf && adv.aiState !== 'fleeing' && this._combatSystem) {
      const rival = this._gameState.adventurers.active.find(a =>
        a.instanceId === adv.flags.swornRivalOf && a.aiState !== 'dead'
      )
      if (rival) {
        const myFrac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
        const rvFrac = rival.resources.maxHp > 0 ? rival.resources.hp / rival.resources.maxHp : 1
        const thr   = Balance.MECHANIC_SWORN_RIVALS_HP_THRESHOLD
        if (myFrac <= thr && rvFrac <= thr) {
          const reach = Math.max(adv.attackRange ?? 1, Balance.MELEE_RANGE_TILES)
          const d = Math.hypot(rival.tileX - adv.tileX, rival.tileY - adv.tileY)
          if (d <= reach + 0.01) {
            adv.aiState = 'fighting'
            adv.path = null
            this._combatSystem.tryAttack(adv, rival, {
              roomId: this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId,
              method: 'sworn_rivals',
            })
            return
          }
        }
      }
    }

    // Dungeon event: The Tournament — scatter→hunt timeout. A rival
    // still in its SCATTER_ROOM phase past `_scatterUntil` (e.g. pinned
    // in combat by minions and never reaching its room) flips to
    // HUNT_RIVAL anyway so the bloodsport always progresses.
    if (adv._tournamentRival && adv.goal?.type === 'SCATTER_ROOM' &&
        this._scene.time.now >= (adv._scatterUntil ?? 0)) {
      adv.goal = { type: 'HUNT_RIVAL' }
      adv.path = null
    }

    // Dungeon event: The Tournament ("Bloodsport") — rivals hunt each
    // other to the death. The seeking is goal-driven (HUNT_RIVAL goal,
    // resolved in _goalToTile to the nearest living rival's tile); this
    // block is the in-range ENGAGEMENT half: whenever ANOTHER living
    // rival is within attack range — whether the adv is scattering,
    // hunting, or seeking the boss — drop everything and swing at the
    // nearest one. No HP gate (aggressive from the start). Falls through
    // to normal minion engagement if no rival is in reach, so the
    // player's minions/boss still fight (and can kill) them.
    // Gated on `_leftEntry`: a rival only starts swinging at other rivals
    // once it has physically left the entry hall. Without this gate all
    // three rivals — snapped onto the same doorway tile by the renderer's
    // spawn handler — brawl on the spot the instant they appear, never
    // scatter, and the oscillation failsafe eventually flees them. The
    // gate forces them to path out to their scatter rooms first.
    if (adv._tournamentRival && adv.aiState !== 'fleeing' && adv._leftEntry && this._combatSystem) {
      // A rival mid-doorway cannot trade blows — CombatSystem's doorway
      // gate rejects any swing where the attacker OR target stands on a
      // TILE.DOOR tile. If we engaged from a door anyway we'd zero out
      // the path, hold aiState 'fighting' (which exempts the stuck
      // failsafes), and freeze the pair on the threshold forever doing
      // no damage and playing no swing. So a rival standing on a door
      // skips engagement entirely and falls through to movement — it
      // keeps pathing toward its prey, steps off the door into a room,
      // and fights there. A foe still on a door isn't a valid target
      // yet either (the swing would just be rejected).
      const onDoor = (e) =>
        this._dungeonGrid?.getTileType?.(e.tileX, e.tileY) === TILE.DOOR
      if (!onDoor(adv)) {
        const reach = Math.max(adv.attackRange ?? 1, Balance.MELEE_RANGE_TILES)
        let target = null, bestDist = Infinity
        for (const other of this._gameState.adventurers.active) {
          if (other === adv) continue
          if (!other._tournamentRival) continue
          if (!other._leftEntry) continue
          if (other.aiState === 'dead' || other.aiState === 'fleeing') continue
          if (onDoor(other)) continue
          const d = Math.hypot(other.tileX - adv.tileX, other.tileY - adv.tileY)
          if (d > reach + 0.01) continue
          if (d < bestDist) { target = other; bestDist = d }
        }
        if (target) {
          // Reaching a rival in combat counts as "scatter complete" — flip
          // straight to HUNT so once this target dies the adv keeps hunting.
          if (adv.goal?.type === 'SCATTER_ROOM') adv.goal = { type: 'HUNT_RIVAL' }
          adv.aiState = 'fighting'
          adv.path = null
          this._combatSystem.tryAttack(adv, target, {
            roomId: this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId,
            method: 'tournament_rivalry',
          })
          return
        }
      }
    }

    // Dungeon event: Twitch Con — "streamer beef". A `_twitchChaos`
    // adventurer whose freelance agenda rolled BEEF (goal.type === 'WANDER'
    // with beef=true) attacks the nearest OTHER `_twitchChaos` adv in range.
    // Mirrors the Tournament rivalry block above — uncoordinated infighting,
    // no HP gate. Falls through to normal minion engagement if no other
    // streamer is in reach, so the player's minions/boss can still fight
    // (and kill) them as usual.
    if (adv._twitchChaos && adv.goal?.type === 'WANDER' && adv.goal?.beef &&
        adv.aiState !== 'fleeing' && this._combatSystem) {
      const reach = Math.max(adv.attackRange ?? 1, Balance.MELEE_RANGE_TILES)
      let target = null, bestDist = Infinity
      for (const other of this._gameState.adventurers.active) {
        if (other === adv) continue
        if (!other._twitchChaos) continue
        if (other.aiState === 'dead' || other.aiState === 'fleeing') continue
        const d = Math.hypot(other.tileX - adv.tileX, other.tileY - adv.tileY)
        if (d > reach + 0.01) continue
        if (d < bestDist) { target = other; bestDist = d }
      }
      if (target) {
        adv.aiState = 'fighting'
        adv.path = null
        this._combatSystem.tryAttack(adv, target, {
          roomId: this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId,
          method: 'streamer_beef',
        })
        return
      }
    }

    // Engage hostile minion in melee range
    if (adv.aiState !== 'fleeing' && this._combatSystem) {
      const enemy = this._findEngageableMinion(adv)
      if (enemy) {
        // Phase 5c — Beast Master tame logic moved to ClassAbilitySystem.
        // The legacy tag-based tame attempt is gone; tame is now a proper
        // cooldown ability with single-companion enforcement.

        adv.aiState = 'fighting'
        adv.path = null
        this._combatSystem.tryAttack(adv, enemy, {
          roomId: this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId,
        })
        this._checkFleeTrigger(adv)
        return
      } else if (adv.aiState === 'fighting' || adv.aiState === 'healing') {
        adv.aiState = 'walking'
      }
    }

    // Recompute path if we don't have one or our goal target changed
    if (!adv.path || adv.pathIndex >= adv.path.length) {
      const target = this._goalToTile(adv)
      if (!target) {
        // Goal dissolved (room removed, ally died, etc.).  Switch to FLEE
        // so they at least try to head home — only an actual entry-hall
        // arrival or death is allowed to remove them from active.
        if (adv.goal?.type !== 'FLEE') {
          const lostLabel = this._goalRoomLabel(adv)
          adv.goal    = { type: 'FLEE', reason: 'goal_lost', context: lostLabel ? { goalLabel: lostLabel } : null }
          adv.path    = null
          adv.aiState = 'fleeing'
          return
        }
        // Already fleeing and STILL no target — every fallback exhausted.
        // Fall through to despawn as the absolute last resort.
        this._despawn(adv, idx, 'no_target')
        return
      }
      // Phase 8: weight tiles by this adventurer's knowledge (avoid known-
      // trapped ROOMS at the room level) — but skip knowledge weighting
      // when fleeing. A panicking adventurer takes the fastest route home,
      // traps be damned.
      //
      // Per-tile detour + per-adv side-bias removed 2026-05-27: they
      // produced visible ping-pong loops as A* threaded between adjacent
      // trap tiles and the side tiebreaker re-rolled per replan. Now
      // every tile inside a known-trapped room gets the same multiplier
      // (ROOM_TRAP_PENALTY), so there's no in-room ambiguity at all.
      //
      // Panic-walk override (anti-ping-pong watchdog). When the
      // watchdog at the top of _tickAdventurer set `_panicWalkUntil`,
      // skip trap-knowledge cost weighting AND don't apply the sprung-
      // trap soft-block (set further down on softOpts). The pathfinder
      // picks the most direct route — through traps if needed.
      const panicWalk = (adv._panicWalkUntil ?? 0) > this._scene.time.now
      const useKnowledgeCost = this._knowledgeSystem && adv.goal?.type !== 'FLEE' && !panicWalk
      let trapRejectsThisPath = 0
      // Room-level trap avoidance (replaces per-tile detour + side-bias,
      // 2026-05-27). Pre-compute the set of room instanceIds this adv
      // knows contain at least one trap. The cost-fn applies a uniform
      // multiplier to ALL tiles inside any such room, regardless of
      // which tile holds the trap — so A* prefers routes that detour
      // around the whole room but walks straight through if no
      // alternative exists. Per-tile detour caused ping-pong loops as
      // A* threaded between adjacent trap tiles and the side-tiebreaker
      // re-rolled per replan; coarse room-level avoidance has no such
      // multi-route ambiguity inside a single room (every tile is equal
      // cost), so the watchdog no longer has to fix in-room oscillation.
      const trappedRoomIds = new Set()
      if (useKnowledgeCost && adv.knowledge?.traps) {
        for (const t of Object.values(adv.knowledge.traps)) {
          if (!t || typeof t.tileX !== 'number') continue
          const room = this._dungeonGrid?.getRoomAtTile?.(t.tileX, t.tileY)
          if (room) trappedRoomIds.add(room.instanceId)
        }
      }
      // Minion-room avoidance (preserved from the previous per-tile cost
      // system, 2026-05-27). KnowledgeSystem.costMultiplierForTile used to
      // weight any room the adv knew contained living minions; when we
      // dropped per-tile trap detour we accidentally removed minion-room
      // avoidance too. Restore it here with the same tier-scaled formula
      // and live-presence filter (skip dead/wandered-out minions) — so
      // strategic minion placement still herds advs around the long way.
      // Precomputed per-path so the cost-fn doesn't redo the room+entry
      // scan per A* expansion.
      const minionRoomCost = new Map()
      if (useKnowledgeCost && adv.knowledge?.enemiesPerRoom && this._knowledgeSystem) {
        const liveMinions = this._gameState?.minions ?? []
        const rank = { FULL: 0, PARTIAL: 1, RUMOR: 2 }
        for (const roomIdStr of Object.keys(adv.knowledge.enemiesPerRoom)) {
          const list = adv.knowledge.enemiesPerRoom[roomIdStr]
          if (!Array.isArray(list) || list.length === 0) continue
          // Object keys are strings; instanceIds may be numbers — match both.
          const room = this._gameState.dungeon?.rooms?.find(r =>
            r.instanceId === roomIdStr || r.instanceId === Number(roomIdStr))
          if (!room) continue
          const rx0 = room.gridX, ry0 = room.gridY
          const rx1 = rx0 + room.width, ry1 = ry0 + room.height
          let bestTier = null
          for (const e of list) {
            // Live-presence filter — skip entries whose minion has
            // wandered out (roaming families) or died. Entries without
            // an instanceId fall through (legacy / synthetic intel).
            if (e?.instanceId) {
              const m = liveMinions.find(x => x?.instanceId === e.instanceId)
              if (!m) continue
              if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
              const inRoom = Number.isFinite(m.tileX) && Number.isFinite(m.tileY) &&
                m.tileX >= rx0 && m.tileX < rx1 && m.tileY >= ry0 && m.tileY < ry1
              if (!inRoom) continue
            }
            const tier = this._knowledgeSystem.tierForEntry?.(e)
            if (!tier) continue
            if (bestTier == null || (rank[tier] ?? 9) < (rank[bestTier] ?? 9)) bestTier = tier
          }
          if (bestTier) {
            const scale = this._knowledgeSystem.costMultiplierForTier?.(bestTier) ?? 1
            const mult  = 1 + (Balance.KNOWLEDGE_DANGER_ROOM_MULT - 1) * scale
            minionRoomCost.set(room.instanceId, mult)
          }
        }
      }
      // The room the adv is STANDING IN right now. Tiles in this room are
      // exempt from the trap/minion avoidance penalty below — see the
      // commit-to-cross note in the cost-fn. (2026-05-27)
      const currentRoomId = this._dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)?.instanceId ?? null
      const costFn = (tx, ty) => {
        if (!useKnowledgeCost) return 1
        const room = this._dungeonGrid?.getRoomAtTile?.(tx, ty)
        if (!room) return 1
        // Commit-to-cross (2026-05-27 floor-spike oscillation fix). The
        // room the adv is ALREADY inside gets no avoidance penalty. The
        // 5× trap penalty is meant to deter ENTERING a trapped room from
        // outside — but once the adv is in it, penalizing it just makes
        // A* prefer backtracking out and detouring around. Combined with
        // the per-path jitter (and the spike re-clearing the path every
        // ~4s on each hit), that flip-flops the route and produces the
        // "walk over the floor spikes, back out, walk in again" loop the
        // player kept seeing. Exempting the current room means once they
        // commit they cross via the shortest path and leave.
        if (room.instanceId === currentRoomId) return 1
        // Locked-room defensive cost (matches legacy
        // KnowledgeSystem.costMultiplierForTile behavior — locked doors
        // are hard-blocked via blockedForAdv but this guards any bypass
        // path like a teleporter or cheater noclip). Runs regardless of
        // trap/minion knowledge so a fresh adv with empty buckets still
        // gets the safety check.
        if (room.locked) return 9999
        // Trap room wins over minion room — same priority as the old
        // costMultiplierForTile (trap is the more localized hazard).
        if (trappedRoomIds.has(room.instanceId)) {
          trapRejectsThisPath++
          return ROOM_TRAP_PENALTY
        }
        const mm = minionRoomCost.get(room.instanceId)
        if (mm != null) return mm
        return 1
      }
      // Phase: items — HARD-block every locked-door tile this adv has no
      // way to open. The pathfinder skips these entirely, so an adv with
      // no key / lockpick / break truly cannot route through a lock.
      // Applies to FLEE too — locks are real barriers.
      // Iterate the per-tick LOCKED snapshot (already filters unlocked /
      // broken) and only skip ones THIS adv can unlock.
      const blockedForAdv = new Set()
      const lockedLocks = this._tickLockedLocks ?? (this._gameState.dungeon?.locks ?? [])
        .filter(l => !l.unlocked && !l.broken)
      for (const lock of lockedLocks) {
        if (this._canAdvUnlockHere(adv, lock)) continue
        for (const t of lock.doorTiles) blockedForAdv.add(`${t.x},${t.y}`)
      }
      // Treasure Hunters raid (2026-05-29): raiders are here for LOOT and must
      // NEVER enter the boss chamber — not even as a transit shortcut. Hard-
      // block every boss-room tile so the pathfinder routes entirely around it;
      // if a target is only reachable through the throne, the raider gives up
      // on it rather than walking in and waking the boss.
      if (adv._treasureHunter) {
        for (const room of (this._gameState.dungeon?.rooms ?? [])) {
          if (room.definitionId !== 'boss_chamber') continue
          for (let ry = room.gridY; ry < room.gridY + room.height; ry++) {
            for (let rx = room.gridX; rx < room.gridX + room.width; rx++) {
              blockedForAdv.add(`${rx},${ry}`)
            }
          }
        }
      }
      // Collision items (Beacon / Fountain / Treasure Chest) are SOFT
      // blockers — identical for every adv that tick, so we reuse the
      // dungeon-wide snapshot built in update(). Clone (Set ctor) so
      // per-adv trap-recoil additions below don't leak into the shared
      // cache.
      const softBlockedForAdv = this._tickSoftBlocked
        ? new Set(this._tickSoftBlocked)
        : new Set()
      if (!this._tickSoftBlocked) {
        for (const b of this._gameState.dungeon?.beacons        ?? []) softBlockedForAdv.add(`${b.tileX},${b.tileY}`)
        for (const f of this._gameState.dungeon?.fountains      ?? []) softBlockedForAdv.add(`${f.tileX},${f.tileY}`)
        for (const c of this._gameState.dungeon?.treasureChests ?? []) softBlockedForAdv.add(`${c.tileX},${c.tileY}`)
      }
      // Trap recoil — DISABLED 2026-05-27. Used to soft-block the
      // trap's footprint + 1-tile ring + dangerTiles for ~3 s after a
      // hit. Per-tile detour like this is exactly what the user asked
      // us to remove — the +100K SOFT_BLOCK_COST stamp overrode the
      // 5× ROOM_TRAP_PENALTY and re-introduced the per-tile dodging
      // (ping-pong around the just-hit trap). With room-level trap
      // avoidance the adv already knows the room is dangerous and
      // pays 5× to be there; no need for an additional per-tile stamp.
      // Just expire the field so old saves clean up on their own.
      if (adv._trapRecoil) adv._trapRecoil = null
      // Cheater no-clip: the modded client ignores walls + locked doors
      // entirely. Pass opts.noClip to the pathfinder (wall / door /
      // void tiles become walkable) and bypass blockedForAdv (lock
      // tiles drop out of the hard-block set). A "banned" cheater
      // loses the privilege so the eject flee actually has to use
      // real corridors.
      const cheaterNoClip = adv.classId === 'cheater' && !adv._banned
      const softOpts = {
        softBlocked:      softBlockedForAdv,
        // Solid traps (pillars / blades / cannons) stay as +SOFT_BLOCK_COST
        // physical obstacles — they're walls you can walk through as a
        // last resort. NOT knowledge-based avoidance: this applies to
        // every adv regardless of intel, because the tile is physically
        // occupied.
        softTraps:        true,
        // Sprung-trap soft-block (+SOFT_BLOCK_COST per sprung-pit tile)
        // DISABLED 2026-05-27. It was the engine-level per-tile detour
        // that made advs zig-zag around spike pits inside a room. With
        // ROOM_TRAP_PENALTY (5×) already discouraging entry, once an
        // adv DOES enter a trapped room they should walk straight
        // through — eat the damage, no dodging. panicWalk no longer
        // matters here since sprung-trap avoidance is off for everyone.
        avoidSprungTraps: false,
        noClip:           cheaterNoClip,
      }
      // Add path jitter for non-flee goals so adventurers don't all march the
      // same straight line — they pick varied routes between rooms each repath.
      // Fleeing advs skip jitter (panic = beeline home). Event monsters KEEP
      // jitter on: it spreads a 14-strong horde across parallel routes — with
      // jitter off they pathed an identical line in lockstep and a single
      // obstacle wedged the whole blob at once.
      const pathJitter = adv.goal?.type === 'FLEE' ? 0 : 0.6
      // Per-frame A* budget gate. If we're out of repaths for this
      // frame, leave the adv with their current (possibly null) path
      // and try again next tick. The per-adv tick body bails right
      // after this when path stays null — no movement that frame, but
      // also no expensive A* call. Spreads frame-time spikes across
      // ticks instead of stacking them. FLEEING advs bypass the budget
      // so panic-routes are never delayed.
      if (adv.goal?.type !== 'FLEE') {
        if (this._aiPathBudget <= 0) {
          // Leave adv.path as-is (null or stale). The tick body below
          // returns when path is null/empty, so the adv just waits.
          return
        }
        this._aiPathBudget--
      }
      const path = PathfinderSystem.findPath(
        { x: adv.tileX, y: adv.tileY }, target, this._dungeonGrid, costFn, pathJitter,
        cheaterNoClip ? null : blockedForAdv, softOpts,
      )
      // Phase: alive AI — if the pathfinder rejected at least one known
      // trap tile, occasionally have the adv shout about avoiding it.
      // Cooldown via _lastAvoidTrapAt prevents constant chatter.
      if (trapRejectsThisPath > 0) {
        const now = this._scene.time.now
        if ((adv._lastAvoidTrapAt ?? 0) + 6000 < now && Math.random() < 0.12) {
          adv._lastAvoidTrapAt = now
          EventBus.emit('SAY_avoidTrap', { adventurer: adv })
        }
      }
      // Diagnostic: log each path computation with its key inputs so we
      // can correlate "stuck adv" warnings to actual A* output.
      this._aiDiag(adv,
        `path: ${path ? path.length : 0} tiles | from=(${adv.tileX},${adv.tileY}) to=(${target.x},${target.y}) goal=${adv.goal?.type ?? '(none)'} panicWalk=${panicWalk} useKnowCost=${useKnowledgeCost} trapRejects=${trapRejectsThisPath} trappedRooms=${trappedRoomIds.size} minionRooms=${minionRoomCost.size}`)
      if (!path || path.length === 0) {
        // An empty path means either "already at goal" (start === target) or
        // "no route exists".  Only treat the former as a true arrival; the
        // latter for a FLEE goal is "got turned around" and should re-roll.
        if (adv.tileX === target.x && adv.tileY === target.y) {
          this._onGoalReached(adv, idx)
          return
        }
        if (adv.goal?.type === 'FLEE') {
          adv.goal.fleeTargetX = null
          adv.goal.fleeTargetY = null
          adv.goal.fleeIsEntry = false
          adv.path             = null
          return
        }
        // Phase: items — before giving up and fleeing, see if there's an
        // unopened key chest the adv could grab. If so, push the current
        // goal onto the stack and head for the chest. _tryPickKey will
        // hand them the key on arrival, and OPEN_LOCKED_DOOR follows.
        const chest = this._findReachableUnopenedKeyChest(adv)
        if (chest) {
          adv.goalStack ??= []
          if (adv.goal) adv.goalStack.push(adv.goal)
          adv.goal = { type: 'SEEK_KEY_CHEST', chestId: chest.instanceId }
          adv.path = null
          EventBus.emit('SAY_seekKey', { adventurer: adv })
          return
        }
        // Pre-flee retarget: the current goal's target is unreachable,
        // but the dungeon usually has OTHER reachable rooms — the failure
        // is almost always a player placing a single room with no
        // connecting corridor, not the whole dungeon being sealed. Walk
        // the rooms list and re-target to the first one we can actually
        // path to, so the adv keeps exploring instead of bolting back to
        // entry with "can't find a way through". Only flee if literally
        // nothing is reachable (truly boxed in / no corridors at all).
        const alt = this._findReachableAlternateGoal(adv, target, blockedForAdv, softOpts)
        if (alt) {
          adv.goal = alt
          adv.path = null
          return
        }
        // Non-flee goal blocked — convert to FLEE rather than despawn.
        // Diagnose the blocker for the dungeon log: with collision items
        // and traps now soft, the only hard barrier left is a locked
        // door — re-path with locks ignored, and if THAT succeeds we
        // know a lock sealed them off; otherwise they're truly boxed in.
        let blockReason = 'no_route'
        if (blockedForAdv.size > 0) {
          const unlocked = PathfinderSystem.findPath(
            { x: adv.tileX, y: adv.tileY }, target, this._dungeonGrid, null, 0,
            null, softOpts,
          )
          if (unlocked && unlocked.length > 0) blockReason = 'blocked_by_lock'
        }
        const blockLabel = this._goalRoomLabel(adv)
        adv.goal    = { type: 'FLEE', reason: blockReason, context: blockLabel ? { goalLabel: blockLabel } : null }
        adv.path    = null
        adv.aiState = 'fleeing'
        return
      }
      adv.path = path
      adv.pathIndex = 0
      adv.pathTarget = target
    }

    // Path smoothing — pick the furthest waypoint with a clear straight-line
    // walkable corridor from current world position. The pathfinder returns
    // tile-by-tile axis-aligned waypoints; without smoothing advs march only
    // N/S/E/W between tile centers and look grid-locked. With it, they cut
    // diagonals across open rooms at any angle (matching how the boss
    // wanders its room).
    let wpIndex = adv.pathIndex
    const tilesGrid = this._dungeonGrid.getTiles?.()
    if (tilesGrid) {
      const MAX_LOOKAHEAD = 16
      const limit = Math.min(adv.path.length - 1, adv.pathIndex + MAX_LOOKAHEAD)
      for (let i = adv.pathIndex + 1; i <= limit; i++) {
        const wp2 = adv.path[i]
        // Stop smoothing the moment a candidate target enters the
        // doorway corridor (canonical lane tile OR the floor approach
        // tile flanking it).  Forces cardinal stepping through the
        // entire entry → lane → exit sequence so the lateral
        // alignment to the seam happens BEFORE the entity touches
        // the corridor, not while passing the door.
        if (this._dungeonGrid.isLaneOrApproach?.(wp2.x, wp2.y)) break
        // Once committed to the corridor, every step must be cardinal
        // — break if the SOURCE position is in the corridor too.
        if (this._dungeonGrid.isLaneOrApproach?.(adv.tileX, adv.tileY)) break
        const tx2 = wp2.x * TS + TS / 2
        const ty2 = wp2.y * TS + TS / 2
        if (this._losClear(adv.worldX, adv.worldY, tx2, ty2, tilesGrid)) wpIndex = i
        else break
      }
    }

    // Move toward smoothed waypoint.  For canonical doorway lane tiles
    // (and the floor approach/exit tiles flanking them) the target is
    // shifted ½-tile along the along-axis so the entity walks through
    // the visual CENTRE of the 2-wide doorway opening (the seam between
    // the two door tiles), not through one column's tile centre.
    const wp = adv.path[wpIndex]
    const laneCenter = this._dungeonGrid.getLaneCenterWorld?.(wp.x, wp.y)
    const targetWX = laneCenter ? laneCenter.worldX : (wp.x * TS + TS / 2)
    const targetWY = laneCenter ? laneCenter.worldY : (wp.y * TS + TS / 2)
    const dx = targetWX - adv.worldX
    const dy = targetWY - adv.worldY
    const dist = Math.hypot(dx, dy)

    // Door pause: if the next waypoint sits on a closed connection-point
    // door, hold position until the split-open animation finishes. We
    // trigger the opening here (idempotent) so the animation starts the
    // moment the adventurer reaches the door rather than after they walk
    // through it.
    const enteringDoor = this._dungeonGrid.getCpForDoorTile?.(wp.x, wp.y)
    if (enteringDoor && !enteringDoor.cp.open) {
      // Route through DungeonRenderer.openDoor so the sprite path swaps
      // to the open swatch immediately (full redraw). Setting cp.opening
      // directly only updates the procedural panel layer, leaving the
      // painted door sprite stuck on closed art until the animation
      // completes.
      this._scene?._dungeonRenderer?.openDoor(enteringDoor.cp)
      // Reset stuck + oscillation counters while we're legitimately
      // holding for the door animation. The animation takes 500 ms of
      // REAL time (DungeonRenderer.update consumes raw delta) but the
      // stuck-failsafe (1500 ms) and oscillation detector (3 s window)
      // both tick on SCALED delta — at 8× speed the stuck cap elapses
      // in 187 ms real, far less than the door animation. Without this
      // reset the path gets nulled mid-open, the next jitter picks a
      // different route, the adv walks away, the new path eventually
      // points back through this same door, and the player sees them
      // ping-ponging at the doorway threshold.
      adv._tileStuckMs = 0
      adv._oscRing    = []
      adv._oscNextAt  = (this._scene.time?.now ?? 0) + 200
      adv._lastWorldX = adv.worldX
      adv._lastWorldY = adv.worldY
      return
    }

    // Adventurers walk through each other freely — no yield-on-overlap.
    // The single-occupant invariant was visually cleaner but produced
    // soft-locks in narrow corridors and at room thresholds. Multiple
    // adventurer bodies on one tile is an acceptable trade.
    adv._waitMs = 0

    // Phase 6c: paranoid types move slower in unfamiliar rooms.
    // Without knowledge system (Phase 8) we just slow them whenever they're
    // not in a barracks/starter room — proxy for "unfamiliar".
    // Cheater lag-spike self-stun — frozen while _lagStunUntil > now.
    // Set by CombatSystem on a 5% per-attack roll: the high-damage swing
    // costs them a brief stand-still window (the player's counter-play
    // window). Banned cheaters lose the cheat entirely, so the freeze
    // can't strand a fleeing one in a minion's range forever.
    if ((adv._lagStunUntil ?? 0) > this._scene.time.now && !adv._banned) {
      return
    }

    const speedMul = this._paranoidSpeedMultiplier(adv)
    // Fleeing adventurers sprint — FLEE_SPEED_MULT × their normal pace.
    // Sells the "running away in panic" feel and (more importantly)
    // clears the end-of-day exit queue at the entry hall doorway
    // before the player has time to get bored.
    const fleeMul  = adv.aiState === 'fleeing' ? FLEE_SPEED_MULT : 1
    // Phase 5c — Bard Song of Speed: same-party advs within 2 tiles of a
    // speed-song-active Bard move 20% faster.
    const songMul  = this._songOfSpeedMul(adv)
    // Cheater speed hack — 2× movement burst while _speedhackUntil > now,
    // set by ClassAbilitySystem on its 12s/3s windowed ability. Stacks
    // multiplicatively with flee / scout / song so a banned cheater
    // running for the exit still benefits from any leftover sprint. The
    // cheat shuts off automatically once the timestamp expires.
    const cheaterSpeedhackActive = (adv._speedhackUntil ?? 0) > this._scene.time.now
    const cheaterSpdMul = cheaterSpeedhackActive ? 2.0 : 1
    const stepPx   = (adv.stats.speed * speedMul * fleeMul * songMul * cheaterSpdMul * TS * delta) / 1000

    if (stepPx >= dist || dist < 0.5) {
      // Commit to the new tile — update occupancy so subsequent
      // adventurers in this same tick see we now own it.
      const prevKey = `${adv.tileX},${adv.tileY}`
      if (this._occupancy?.[prevKey] === adv.instanceId) delete this._occupancy[prevKey]
      adv.worldX = targetWX
      adv.worldY = targetWY
      adv.tileX  = wp.x
      adv.tileY  = wp.y
      if (this._occupancy) this._occupancy[`${wp.x},${wp.y}`] = adv.instanceId
      this._maybeOpenDoorAt(wp.x, wp.y)
      // Phase: items — if the new tile is a locked door tile, consume the
      // best available unlock method (key > lockpick > break). If it's a
      // key-chest tile, open it and stack the OPEN_LOCKED_DOOR goal.
      this._tryUnlockTile(adv, wp.x, wp.y)
      this._tryPickKey(adv)
      this._tryHealAtFountain(adv)
      this._tryOpenTreasureChest(adv)
      // Mimic trigger — same proximity rule as a real chest, but
      // routes to the kill-the-opener path instead of looting. Bails
      // early if the adv is now dead so subsequent step-logic skips.
      this._tryTriggerMimic(adv)
      if (adv.aiState === 'dead') return
      // _tryPickKey may have nulled adv.path (it switches the goal to
      // OPEN_LOCKED_DOOR and clears the path so a fresh repath happens
      // next tick). Guard the .length read so the update loop doesn't
      // throw — when path is null we're already done with this step.
      if (!adv.path) return
      // Advance past every waypoint we collapsed via LOS smoothing.
      adv.pathIndex = wpIndex + 1

      if (adv.pathIndex >= adv.path.length) {
        adv.path = null
        this._onGoalReached(adv, idx)
      }
    } else {
      // Doorway-corridor L-shape motion.  Inside the corridor (lane
      // tile or approach/exit floor) the entity may move ONLY along
      // the lane (forward) axis — no lateral drift while passing
      // through the door shadow.  Entering the corridor from outside
      // applies lateral correction first (so the seam-align happens
      // BEFORE the doorway).  Exiting the corridor applies forward
      // first (so the seam-undo happens AFTER the entity is fully
      // out of the door shadow).  Outside the corridor, regular
      // proportional diagonal motion as before.
      const advLane = this._dungeonGrid.isLaneOrApproach?.(adv.tileX, adv.tileY)
      const wpLane  = this._dungeonGrid.isLaneOrApproach?.(wp.x, wp.y)
      const laneAxis = advLane || wpLane
      const ALIGN_EPS = 0.5
      let moved = false
      if (laneAxis === 'y' || laneAxis === 'x') {
        const forwardD = laneAxis === 'y' ? dy : dx
        const lateralD = laneAxis === 'y' ? dx : dy
        const forwardKey = laneAxis === 'y' ? 'worldY' : 'worldX'
        const lateralKey = laneAxis === 'y' ? 'worldX' : 'worldY'
        const inside    = !!advLane && !!wpLane
        const entering  = !advLane && !!wpLane
        const exiting   = !!advLane && !wpLane
        const moveAxis = (key, d) => {
          adv[key] += Math.sign(d) * Math.min(Math.abs(d), stepPx)
          moved = true
        }
        if (inside) {
          // Pure forward only inside the corridor.
          if (Math.abs(forwardD) > ALIGN_EPS) moveAxis(forwardKey, forwardD)
        } else if (entering) {
          // Lateral first (while still outside the corridor), then forward.
          if (Math.abs(lateralD) > ALIGN_EPS)      moveAxis(lateralKey, lateralD)
          else if (Math.abs(forwardD) > ALIGN_EPS) moveAxis(forwardKey, forwardD)
        } else if (exiting) {
          // Forward first (out of the corridor), then lateral.
          if (Math.abs(forwardD) > ALIGN_EPS)      moveAxis(forwardKey, forwardD)
          else if (Math.abs(lateralD) > ALIGN_EPS) moveAxis(lateralKey, lateralD)
        }
      }
      // Fallback — if the L-shape branch declined to move (both axes
      // within the alignment epsilon, or laneAxis was null), use the
      // ordinary proportional diagonal so the entity never freezes
      // mid-segment.
      if (!moved) {
        adv.worldX += (dx / dist) * stepPx
        adv.worldY += (dy / dist) * stepPx
      }
      // Sync tile coords each frame from world position so room-membership,
      // combat-range, and occupancy checks see the actual location while
      // traversing a smoothed (multi-tile) segment.
      const newTileX = Math.floor(adv.worldX / TS)
      const newTileY = Math.floor(adv.worldY / TS)
      // Doorway-seam guard: when worldX/Y sits on the seam between the
      // canonical and secondary doorway tiles (because lane centring
      // shifted the target ½-tile), floor() can briefly resolve to the
      // secondary tile.  That tile is pathfinder-blocked, so latching
      // tileX onto it would corrupt the next path call and trigger the
      // snap-back below.  Skip the sync; the explicit commit at line
      // 587-588 will set tileX once the entity reaches the wp.
      if (this._dungeonGrid.isDoorBlocked?.(newTileX, newTileY)) {
        // intentionally skip tile sync this frame
      } else if (newTileX !== adv.tileX || newTileY !== adv.tileY) {
        // Defensive: if smoothing/precision somehow puts us in a non-walkable
        // tile, snap back to the last good tile center and force a re-path.
        // Prevents the "stuck in walls" state when an LOS edge case slips
        // through.
        //
        // Exception: during lane/approach L-shape motion the ½-tile seam
        // shift puts targetWX = N×TS (exactly on a tile boundary). moveAxis()
        // can land worldX there in one step, making floor() resolve to the
        // adjacent wall column — non-walkable, but NOT a stuck state.  Skip
        // the snap-back; the commit branch sets tileX from wp.x when dist<0.5.
        const tilesGuard = this._dungeonGrid.getTiles?.()
        const guardRow   = tilesGuard?.[newTileY]
        // Cheater no-clip: the modded client phases through walls, so a
        // wall-tile destination is legitimate for them. Skip the
        // snap-back-to-walkable guard entirely and let tileX/Y latch onto
        // the wall cell — otherwise every step into a wall would cancel
        // the path and bounce them back to the prior tile, which both
        // strands the cheater AND falsely trips the FLEE/stuck-in-entry
        // 3 s timeout (worldX/Y advances, tileX/Y never does, never
        // leaves entry hall → forced flee). Banned cheaters lose no-clip
        // so they fall through to the normal guard like everyone else.
        const cheaterNoClipMove = adv.classId === 'cheater' && !adv._banned
        if (!cheaterNoClipMove && (!guardRow || !PathfinderSystem.isWalkable(guardRow[newTileX]))) {
          if (advLane || wpLane) {
            // Seam-shift boundary overshoot: world position legitimately
            // sits on the tile boundary (lane-centre shift puts targetWX/Y
            // exactly at N×TS), but tileX/Y must NOT be latched to the
            // non-walkable cell — doing so corrupts the next path call and
            // produces a backward oscillation as the pathfinder plans from
            // a wall tile. Leave tileX/Y alone; the commit branch will set
            // them correctly from wp.x/y once dist < 0.5.
          } else {
            adv.worldX = adv.tileX * TS + TS / 2
            adv.worldY = adv.tileY * TS + TS / 2
            adv.path = null
            return
          }
        } else {
          const oldKey = `${adv.tileX},${adv.tileY}`
          if (this._occupancy?.[oldKey] === adv.instanceId) delete this._occupancy[oldKey]
          adv.tileX = newTileX
          adv.tileY = newTileY
          if (this._occupancy) this._occupancy[`${newTileX},${newTileY}`] = adv.instanceId
          this._maybeOpenDoorAt(newTileX, newTileY)
        }
      }
    }
  }

  // Trigger the split-open animation when an adventurer first steps onto a
  // DOOR cell whose connection point is still closed. Idempotent — a cp
  // already opening or open is left alone. Routed through
  // DungeonRenderer.openDoor so the sprite path swaps to the open swatch
  // immediately (full redraw); the animation tick in DungeonRenderer.update
  // advances cp.openProgress and flips cp.open=true at the end.
  _maybeOpenDoorAt(tx, ty) {
    const found = this._dungeonGrid.getCpForDoorTile?.(tx, ty)
    if (!found) return
    this._scene?._dungeonRenderer?.openDoor(found.cp)
  }

  // Walkable line-of-sight check — Amanatides-Woo grid traversal that visits
  // every tile the line from (sx,sy) to (tx,ty) actually crosses, plus both
  // neighbors at exact corner grazes. Returns false if any visited tile is
  // non-walkable so path smoothing never cuts through wall corners or clips
  // diagonals through 1-tile-wide walls (the bug a naive sampled LOS hits).
  _losClear(sx, sy, tx, ty, tiles) {
    const x0 = sx / TS, y0 = sy / TS
    const x1 = tx / TS, y1 = ty / TS
    const dx = x1 - x0, dy = y1 - y0
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return true

    const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0)
    const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0)
    const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx)
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy)
    let cx = Math.floor(x0), cy = Math.floor(y0)
    const endCx = Math.floor(x1), endCy = Math.floor(y1)
    let tMaxX = stepX === 0 ? Infinity
      : ((stepX > 0 ? Math.floor(x0) + 1 : Math.floor(x0)) - x0) / dx
    let tMaxY = stepY === 0 ? Infinity
      : ((stepY > 0 ? Math.floor(y0) + 1 : Math.floor(y0)) - y0) / dy

    // A tile is "walkable" for line-of-sight if its type allows movement
    // AND nothing dynamic is sitting on it. Mimics (in any state) count
    // as solid for INTERMEDIATE tiles — without this guard,
    // path-smoothing happily greenlights a diagonal that visually crosses
    // a chest tile even when the planned path correctly routes around it.
    // The adv's own start tile is exempt from the mimic check (they can't
    // be standing on a mimic, but float-edge cases shouldn't lock them
    // in place if they are).
    const walkable = (x, y) => {
      const row = tiles[y]
      return !!row && PathfinderSystem.isWalkable(row[x])
    }
    if (!walkable(cx, cy)) return false

    // Bound iterations so a degenerate input can't loop forever.
    const maxSteps = Math.abs(endCx - cx) + Math.abs(endCy - cy) + 4
    for (let i = 0; i < maxSteps; i++) {
      if (cx === endCx && cy === endCy) return true
      if (Math.abs(tMaxX - tMaxY) < 1e-9) {
        // Exact corner graze — both diagonal neighbors of the corner must
        // be walkable, otherwise the line clips a wall corner.
        if (!walkable(cx + stepX, cy)) return false
        if (!walkable(cx, cy + stepY)) return false
        cx += stepX; cy += stepY
        tMaxX += tDeltaX; tMaxY += tDeltaY
      } else if (tMaxX < tMaxY) {
        cx += stepX
        tMaxX += tDeltaX
      } else {
        cy += stepY
        tMaxY += tDeltaY
      }
      if (!walkable(cx, cy)) return false
    }
    return true
  }

  // ── Combat / Flee helpers ──────────────────────────────────────────────────

  _findEngageableMinion(adv) {
    // Vampire Charm — a charmed adv is being walked toward the boss
    // room as a future thrall. They don't engage anything along the
    // way; the symmetric "minions don't attack the charmed adv" rule
    // lives in MinionAISystem._pickTarget.
    if (adv._charmed) return null
    // Dungeon event: Legendary Speed Runner — beelines to the boss,
    // ignores every minion on the way (no engagement at all). Minions
    // can still hit the speedrunner from MinionAISystem; this only
    // suppresses the adv-side targeting.
    if (adv._speedrunner) return null
    // Dungeon event: Cosplay Contest — passive cosplayers walk past
    // minions until provoked (CombatSystem flips _provoked when a
    // minion lands a hit). The 25% non-passive cosplayers fall through
    // and engage normally.
    if (adv._cosplay && adv._cosplayPassive && !adv._provoked) return null
    // Dungeon event: Cartographer's Convention — scholars never engage,
    // they're just here to map. Minions can still hit them; they'll
    // flee when low and feed their tour into KnowledgeSystem on escape.
    if (adv._cartographer) return null
    // Dungeon event: The Saboteur — never fights anything; they're here
    // only to disarm traps. (Minions ignore them too — MinionAISystem.)
    if (adv._saboteur) return null
    // Phase 5c — ranged classes (Mage / Cleric / Necromancer / Ranger / Bard)
    // engage at their declared attackRange instead of melee. Falls back to
    // MELEE_RANGE_TILES (1.5) for melee classes.
    const reach = Math.max(adv.attackRange ?? 1, Balance.MELEE_RANGE_TILES)
    // Doorway pass-through: an adventurer in a doorway keeps walking and
    // ignores all targets. Stops the adv from halting path mid-doorway.
    if (this._dungeonGrid?.getTileType?.(adv.tileX, adv.tileY) === TILE.DOOR) return null
    const nowMs = this._scene?.time?.now ?? 0
    let best = null, bestDist = Infinity
    // Manhattan-bounds early-exit BEFORE the per-pair hypot. With `reach`
    // capped at ~6 tiles and minion counts climbing into the dozens on big
    // dungeons, 95%+ of pairs are obviously out of range — the cheap
    // bounds check culls them without the sqrt cost.
    const reachCeil = Math.ceil(reach + 0.01)
    for (const m of this._gameState.minions) {
      if (m.aiState === 'dead' || m.resources.hp <= 0) continue
      if (m.faction === 'adventurer') continue
      const dxAbs = Math.abs(m.tileX - adv.tileX)
      const dyAbs = Math.abs(m.tileY - adv.tileY)
      if (dxAbs > reachCeil || dyAbs > reachCeil) continue
      // Beast Master tame protection — a minion a Beast Master has tamed,
      // OR is actively trying to tame (recent _tameTargetedAt stamp from
      // ClassAbilitySystem), is off-limits to every other adventurer's
      // melee. Lets the Beast Master secure the tame without the rest of
      // the party killing the beast first, and keeps the tamed companion
      // safe afterward.
      if (m.tamedByAdvId) continue
      if (m._tameTargetedAt != null &&
          (nowMs - m._tameTargetedAt) >= 0 &&
          (nowMs - m._tameTargetedAt) < TAME_PROTECT_MS) continue
      // Mimic — disguised mimics look like ordinary chests, so the adv
      // doesn't perceive them as hostile by default. EXCEPTION: an adv
      // who has knowledge of THIS specific mimic (witnessed a kill,
      // or inherited intel from a survivor / shared pool) sees through
      // the disguise and may attack it as a normal hostile. We also
      // skip 'sprung' mimics — they're visibly spent for the day and
      // not a threat until they re-disguise at night.
      if (m.isMimic && (m.mimicState === 'chest' || m.mimicState === 'sprung')) {
        const known = !!adv.knowledge?.mimics?.[m.instanceId]
        if (!known) continue
        // Sprung mimics aren't a meaningful threat — let the adv ignore
        // them even when known; they have bigger problems.
        if (m.mimicState === 'sprung') continue
      }
      // Phase 1b.6 — Lizardman Camouflage. Adventurers literally cannot see
      // camouflaged minions, so they're invisible to targeting until the
      // minion reveals on its first attack.
      if (m._camouflaged) continue
      // Vampire Sleep on Ceiling / Golem Camouflaged Pillar — minion is
      // invisible until the trigger condition flips _hidden off (vampires:
      // adv enters room, golems: adv steps adjacent). MinionRenderer drops
      // alpha to 0; this skip makes the hide mechanically real.
      if (m._hidden) continue
      if (adv.flags?.idolizedMinionClass === m.definitionId) continue
      // Skip minions standing in a doorway — they're mid-passage and
      // untouchable; the adventurer walks through rather than stopping to fight.
      if (this._dungeonGrid?.getTileType?.(m.tileX, m.tileY) === TILE.DOOR) continue
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d > reach + 0.01) continue
      // No overlap-attacks: an adv standing on the same tile as a minion
      // walks through rather than swinging. They'll engage as soon as
      // they're a tile apart.
      if (d < 0.99) continue
      // Phase 8: any minion within engagement range is also "observed"
      this._knowledgeSystem?.observeMinion(adv, m)
      if (d < bestDist) { best = m; bestDist = d }
    }
    return best
  }

  // Failsafe un-stick for noFlee monsters the oscillation detector caught
  // pacing — almost always wedged at a doorway chokepoint. Teleport them
  // `steps` waypoints further along their CURRENT path (the path itself is
  // valid — it routes through the door — only the per-tick movement was
  // ping-ponging). Snaps onto a genuinely walkable waypoint only. Returns
  // true if it moved them, false if there's no usable path to shove along.
  _shoveAlongPath(adv, steps) {
    if (!Array.isArray(adv.path) || adv.path.length === 0) return false
    const from = Math.max(0, adv.pathIndex ?? 0)
    const to   = Math.min(adv.path.length - 1, from + steps)
    if (to <= from) return false
    const wp = adv.path[to]
    if (!wp) return false
    const tiles = this._dungeonGrid?.getTiles?.()
    const row   = tiles?.[wp.y]
    if (!row || !PathfinderSystem.isWalkable(row[wp.x])) return false
    const oldKey = `${adv.tileX},${adv.tileY}`
    if (this._occupancy?.[oldKey] === adv.instanceId) delete this._occupancy[oldKey]
    adv.tileX  = wp.x
    adv.tileY  = wp.y
    adv.worldX = wp.x * TS + TS / 2
    adv.worldY = wp.y * TS + TS / 2
    adv.pathIndex = to + 1
    adv._lastWorldX = adv.worldX
    adv._lastWorldY = adv.worldY
    if (this._occupancy) this._occupancy[`${wp.x},${wp.y}`] = adv.instanceId
    return true
  }

  _checkFleeTrigger(adv) {
    if (adv.goal?.type === 'FLEE') return  // already fleeing
    // Skip while undamaged — for very cowardly personalities (traumatized
    // has fleeThreshold 0.95) the threshold + FLEE_BUFFER otherwise
    // exceeds 1.0 and triggers every tick at spawn, freezing them at
    // entry where their flee target == their current tile.
    if (adv.resources.hp >= adv.resources.maxHp) {
      adv._fleeRolled = false
      return
    }
    const hpFrac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
    // Plunderers (KR P5 response) bail at the first sign of trouble — they're
    // here to rob you and run, not die for the crown. High threshold = flee
    // early (and try to abscond with what they've pocketed).
    const threshold = adv.flags?.plundererThief
      ? 0.85
      : this._personalitySystem
        ? (this._personalitySystem.getWeights(adv).fleeThreshold ?? 0.5)
        : 0.3
    if (hpFrac <= threshold + Balance.FLEE_BUFFER) {
      // 50% chance to ignore the trigger — roll once per threshold crossing,
      // not every tick (otherwise repeated rolls converge to ~100% flee).
      // Flag clears when HP recovers above threshold so a future drop re-rolls.
      if (adv._fleeRolled) return
      adv._fleeRolled = true
      if (Math.random() < 0.8) return
      this._setFleeGoal(adv, 'low_hp_retreat', {
        hpPct: Math.max(1, Math.round(hpFrac * 100)),
      })
    } else {
      adv._fleeRolled = false
    }
  }

  // Display-name helpers for flee-context strings. Prefer the minion's
  // instance name (proper noun like "Grunt") when set, else fall back to
  // the JSON definition's display name ("Orc"). Returns a string that
  // reads cleanly inside flavor templates without "the" prefixes/suffixes.
  _minionDisplayName(m) {
    if (!m) return 'a hostile'
    if (m.name && m.name !== m.definitionId) return m.name
    return minionLabel(m.definitionId, 'hostile')
  }

  // Resolve the room name behind an adv's current goal so flee messages
  // can mention WHERE they were trying to get to. Returns null when the
  // goal isn't room-shaped (e.g. HUNT_PHYLACTERY).
  _goalRoomLabel(adv) {
    const g = adv?.goal
    if (!g) return null
    if (g.type === 'EXPLORE_ROOM' || g.type === 'SCATTER_ROOM') {
      const room = this._gameState.dungeon?.rooms?.find(r => r.instanceId === g.roomId)
      if (room) return roomLabel(room.definitionId)
    }
    if (g.type === 'SEEK_BOSS' || g.type === 'AT_BOSS') return 'boss chamber'
    return null
  }

  _setFleeGoal(adv, reason = 'low_hp_retreat', context = null) {
    // Phase 5c — Barbarian Unstoppable: immune to ALL flee triggers.
    if (adv.classId === 'barbarian') return
    // Phase 9 — Schism / Glory Hounds: solo / glory adventurers fight to the death.
    if (adv.flags?.noFlee) return
    // Vampire charm: charmed adventurers are walking to the boss to be turned
    // into thralls — they cannot break off and flee.
    if (adv._charmed) return

    // Phase 5c — partial-retreat option. For "soft" panic reasons
    // (coward_panic, low_hp_retreat) there's a 50% chance the adv pulls
    // back to a known safer room and resumes exploring from there instead
    // of bolting all the way to the entry hall. Hard panics (raid leader
    // fell, traumatized sole survivor, out of arrows, goal_unreachable)
    // still go straight for the door.
    const SOFT_PANIC = reason === 'coward_panic' || reason === 'low_hp_retreat'
    if (SOFT_PANIC && Math.random() < 0.5) {
      const safe = this._findSafeRetreatRoom(adv)
      if (safe) {
        adv.goal = { type: 'TACTICAL_RETREAT', roomId: safe.instanceId, fromReason: reason, fromContext: context }
        adv.aiState = 'walking'
        adv.path = null
        return
      }
    }

    adv.goal = { type: 'FLEE', reason, context }
    // 50% chance to flee toward a False Exit (if one exists) instead of a
    // real entry hall — the adv mistakes the fake door for a way out.
    // _fleeExitTile routes them to the false exit; on arrival
    // RoomBehaviorSystem teleports them to a random room and clears this
    // flag, after which they flee to a REAL entry. Matches DESIGN:
    // "Adventurers fleeing ... have a chance to flee here instead of the
    // Entry Hall." (2026-05-27 — was incidental-on-cross, now a roll.)
    const falseExits = (this._gameState.dungeon?.rooms ?? []).filter(r =>
      r.definitionId === 'false_exit' && r.isActive !== false)
    if (falseExits.length > 0 && Math.random() < 0.5) {
      const fe = falseExits[Math.floor(Math.random() * falseExits.length)]
      adv.goal.fleeViaFalseExitId = fe.instanceId
    }
    adv.aiState = 'fleeing'
    adv.path = null
  }

  // Phase 5c — pick a "safer" already-visited room to fall back to. "Safer"
  // means no hostile minions within 4 tiles of the room center AND the room
  // isn't the one the adv currently stands in. Prefers rooms farthest from
  // the current threat. Returns null if nothing qualifies.
  _findSafeRetreatRoom(adv) {
    const rooms = this._gameState.dungeon?.rooms ?? []
    const visited = adv.visitedRooms ?? []
    const currentRoom = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    let best = null, bestDist = -1
    for (const room of rooms) {
      if (currentRoom && room.instanceId === currentRoom.instanceId) continue
      // Only retreat to rooms we've actually been to before — fleeing into
      // the unknown defeats the point of "tactical retreat."
      if (!visited.includes(room.instanceId)) continue
      // Don't retreat to entry_hall — that's just normal flee with extra steps.
      if (room.definitionId === 'entry_hall') continue
      const cx = room.gridX + Math.floor(room.width  / 2)
      const cy = room.gridY + Math.floor(room.height / 2)
      // Reject rooms with a hostile minion close to the center.
      const tooClose = (this._gameState.minions ?? []).some(m => {
        if (m.aiState === 'dead' || m.resources?.hp <= 0) return false
        if (m.faction === 'adventurer') return false
        const d = Math.hypot(m.tileX - cx, m.tileY - cy)
        return d <= 4
      })
      if (tooClose) continue
      // Prefer rooms farthest from the current adv tile (more space between
      // them and whatever spooked them).
      const dist = Math.hypot(adv.tileX - cx, adv.tileY - cy)
      if (dist > bestDist) { best = room; bestDist = dist }
    }
    return best
  }

  // Phase 8b: per-adventurer path sampling for Replay Ghost rendering
  _samplePath(adv, delta) {
    adv.pathHistory ??= []
    adv._pathSampleAccum = (adv._pathSampleAccum ?? 0) + delta
    if (adv._pathSampleAccum < Balance.REPLAY_PATH_SAMPLE_MS) return
    adv._pathSampleAccum = 0
    adv.pathHistory.push({ x: adv.tileX, y: adv.tileY, day: this._gameState.meta.dayNumber })
    if (adv.pathHistory.length > Balance.REPLAY_PATH_MAX_SAMPLES) {
      adv.pathHistory.shift()
    }
  }

  // Phase 6e: passive room effects driven by definitionId.
  // (Healing Fountain is now a placeable ITEM, not a room — see Phase C.)
  _applyRoomEffects(adv, delta) {
    const room = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    if (!room || room.isActive === false) return

    // [Removed 2026-04-30] Per-room blocks for prison_block, serpent_pit,
    // obelisk_room, lava_floor, collapsing_pillars, healing_fountain.
    // These rooms were retired in the Room redesign — see DESIGN.md for
    // the replacement set.

    // Room redesign 2026-04-30 — Hall of Madness: on first entry, roll 60%
    // for sustained frenzy. A frenzied adventurer locks onto a random
    // party-mate in the room as their ATTACK_ALLY target — they
    // pathfind to and swing at the ally until either side dies, the
    // target leaves the room, or the frenzy adv themselves leaves.
    // Combat resolves through CombatSystem.tryAttack so all existing
    // damage modifiers (Marked, armor adjacency, etc.) apply. When the
    // condition breaks the adv's previous goal is restored.
    if (room.definitionId === 'hall_of_madness') {
      adv.flags ??= {}
      if (adv.flags._madnessEntryRoom !== room.instanceId) {
        adv.flags._madnessEntryRoom = room.instanceId
        // Tinkerer's Workshop "Total Frenzy" — chance bumped to 90%
        // (was 60%) when the Hall of Madness type is upgraded.
        const madnessChance = (this._gameState._tinkeredRoomTypes ?? []).includes('hall_of_madness')
          ? 0.90 : 0.60
        if (!adv.flags.madnessTargetId && Math.random() < madnessChance) {
          const others = this._gameState.adventurers.active.filter(o =>
            o !== adv && o.aiState !== 'dead' && (o.resources?.hp ?? 0) > 0 &&
            this._dungeonGrid.getRoomAtTile(o.tileX, o.tileY)?.instanceId === room.instanceId
          )
          if (others.length > 0) {
            const victim = others[Math.floor(Math.random() * others.length)]
            adv.flags.madnessTargetId   = victim.instanceId
            adv.flags.madnessSavedGoal  = adv.goal ? { ...adv.goal } : null
            adv.goal = { type: 'ATTACK_ALLY', allyId: victim.instanceId, source: 'hall_of_madness' }
            adv.path = null
            EventBus.emit('HALL_OF_MADNESS_FRENZY_BEGIN', {
              attacker: adv, victim, roomId: room.instanceId,
            })
          }
        }
      }
    } else if (adv.flags?._madnessEntryRoom) {
      // Left the Hall — clear the entry-roll flag so a re-entry rolls again
      adv.flags._madnessEntryRoom = null
    }
  }

  // Frenzy housekeeping: called at the top of _tickAdventurer to clear stale
  // madness state (target dead, target left the room, or frenzied adv left
  // the Hall). Returns true when the goal was just restored to the saved
  // goal so the caller can recompute path on this tick.
  _maybeClearMadness(adv) {
    const targetId = adv.flags?.madnessTargetId
    if (!targetId) return false
    const target = this._gameState.adventurers.active.find(a => a.instanceId === targetId)
    const advRoom = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    const stillInHall = advRoom?.definitionId === 'hall_of_madness'
    const targetRoom = target ? this._dungeonGrid.getRoomAtTile(target.tileX, target.tileY) : null
    const targetInSameRoom = !!(target && targetRoom && advRoom && targetRoom.instanceId === advRoom.instanceId)
    const targetAlive = target && target.aiState !== 'dead' && (target.resources?.hp ?? 0) > 0
    if (stillInHall && targetInSameRoom && targetAlive) return false
    // Conditions broken — restore goal + clear flags.
    EventBus.emit('HALL_OF_MADNESS_FRENZY_END', {
      attacker: adv, targetId,
      reason: !stillInHall ? 'left_hall' : !targetAlive ? 'target_dead' : 'target_left',
    })
    const saved = adv.flags?.madnessSavedGoal
    adv.flags.madnessTargetId = null
    adv.flags.madnessSavedGoal = null
    if (adv.goal?.type === 'ATTACK_ALLY' && adv.goal?.source === 'hall_of_madness') {
      adv.goal = saved ?? this._pickNextGoal(adv)
      adv.path = null
    }
    return true
  }

  // Phase 6e: resource depletion → leave dungeon.
  // Rangers without arrows have no offensive option (until the Volley/Trap-
  // Expert rework removes arrow consumption). Mage flee-on-empty-mana removed
  // along with the mana system in Phase 5b.
  _resourceExhaustedShouldFlee(adv) {
    if (adv.aiState === 'fleeing') return false
    if (adv.classId === 'ranger') {
      const arrows = adv.resources?.arrows ?? 0
      if (arrows <= 0 && this._anyHostileMinionInRoom(adv)) return true
    }
    return false
  }

  _anyHostileMinionInRoom(adv) {
    const room = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    if (!room) return false
    return this._gameState.minions.some(m =>
      m.aiState !== 'dead' &&
      m.faction !== 'adventurer' &&
      m.assignedRoomId === room.instanceId
    )
  }

  // Coward: flees the moment a hostile minion is in the same room.
  // Returns the spotted minion if the coward should flee, else null.
  // Returning the actual minion lets callers thread the trigger into
  // flee-flavor context ("Lyra catches sight of the Orc and panics!").
  _cowardShouldFlee(adv) {
    if (adv.aiState === 'fleeing') return null
    const tags = this._personalitySystem?.getTags(adv) ?? new Set()
    if (!tags.has('coward')) return null
    // Phase 5c — proximity-based instead of "any minion in this room."
    // Previously cowards bolted the moment they spawned into a room that
    // happened to contain a placed minion (even one tile away in a 14×14
    // chamber). Now they only flee when a hostile minion is genuinely
    // within sight (≤ 4 tiles), so they at least walk a few tiles before
    // panicking.
    const SIGHT = 4
    let closest = null
    let closestD = Infinity
    for (const m of this._gameState.minions) {
      if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
      if (m.faction === 'adventurer') continue   // friendly defectors don't scare them
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d <= SIGHT && d < closestD) { closest = m; closestD = d }
    }
    return closest
  }

  // Cleric heal target: same-party ally below HP threshold, in heal range, alive.
  _findHealTarget(cleric) {
    const partyId = cleric.partyId
    let best = null, bestFrac = Infinity
    for (const adv of this._gameState.adventurers.active) {
      if (adv === cleric) continue
      if (adv.aiState === 'dead' || adv.resources.hp <= 0) continue
      if (partyId && adv.partyId !== partyId) continue
      const frac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
      if (frac > Balance.CLERIC_HEAL_TARGET_THRESHOLD) continue
      const d = Math.hypot(adv.tileX - cleric.tileX, adv.tileY - cleric.tileY)
      if (d > Balance.HEAL_RANGE_TILES + 0.01) continue
      if (frac < bestFrac) { best = adv; bestFrac = frac }
    }
    return best
  }

  // Beast tamer attempt: returns true if the attempt was made (success OR fail uses the turn).
  // Returns false when on cooldown — in that case AI falls through to standard attack.
  // Note: this remains tag-driven for now; the Beast Master class rework will
  // replace it with the new ability-system Tame Beast (50% success, single
  // companion enforcement).
  _tryTame(adv, target) {
    const now = this._scene.time.now
    const last = adv._lastTameAt ?? 0
    if (now - last < Balance.TAME_COOLDOWN_MS) return false
    if (target.faction === 'adventurer') return false  // already tamed
    const dist = Math.hypot(target.tileX - adv.tileX, target.tileY - adv.tileY)
    if (dist > Balance.TAME_RANGE_TILES + 0.01) return false

    adv._lastTameAt = now

    if (Math.random() < Balance.TAME_SUCCESS_RATE) {
      // Success — defect
      target.faction          = 'adventurer'
      target.factionExpiresOn = this._gameState.meta.dayNumber
      target.tamedByAdvId     = adv.instanceId
      target.currentTargetId  = null
      EventBus.emit('MINION_TAMED', { minion: target, tamer: adv })
    } else {
      EventBus.emit('TAME_FAILED', { minion: target, tamer: adv })
    }
    return true
  }

  // Paranoid types apply a movement speed reduction in non-starter rooms
  // (proxy for "unfamiliar" until knowledge system in Phase 8).
  _paranoidSpeedMultiplier(adv) {
    const tags = this._personalitySystem?.getTags(adv) ?? new Set()
    if (!tags.has('paranoid')) return 1
    const room = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    if (!room) return 1
    // "Familiar" rooms = the starter set
    const isFamiliar = (room.definitionId ?? '').startsWith('starter_')
    return isFamiliar ? 1 : Balance.PARANOID_SPEED_MULTIPLIER
  }

  // Phase 5c — Bard Song of Speed: returns 1.20 if a same-party Bard within
  // 2 tiles has an active speed-song buff, else 1. The Bard themselves get
  // the buff while their own song is active.
  _songOfSpeedMul(adv) {
    const advs = this._gameState.adventurers?.active ?? []
    const now  = this._scene.time.now
    for (const bard of advs) {
      if (bard.classId !== 'bard') continue
      if (!bard._songSpeedActiveUntil || now >= bard._songSpeedActiveUntil) continue
      if (bard !== adv) {
        if (!bard.partyId || bard.partyId !== adv.partyId) continue
      }
      const d = Math.hypot(adv.tileX - bard.tileX, adv.tileY - bard.tileY)
      if (d > 2.01) continue
      return 1.20
    }
    return 1
  }

  // ── Goal handling ──────────────────────────────────────────────────────────

  _goalToTile(adv) {
    const dungeon = this._gameState.dungeon
    // Light Party leashing — non-tank members stick within LEASH tiles of the
    // tank. When they drift outside the leash, their next pathing pick targets
    // the TANK's tile instead of whatever the underlying goal points at (which
    // is SEEK_BOSS for the whole party). The tank itself routes normally, so
    // the party moves as one unit: tank picks the destination, everyone else
    // catches up. Fixes the splitting-off symptom (most visibly the healer,
    // who never engages combat so nothing else slowed her down).
    // Per-role leash so ranged DPS can stand farther back without being
    // dragged onto the tank's tile every tick.
    if (adv._lightParty && adv._lightPartyRole && adv._lightPartyRole !== 'tank') {
      const tank = (this._gameState.adventurers?.active ?? [])
        .find(a => a?._lightParty && a._lightPartyRole === 'tank'
                && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)
      if (tank) {
        const LEASH = adv._lightPartyRole === 'rangedDps' ? 3 : 2
        const d = Math.hypot(adv.tileX - tank.tileX, adv.tileY - tank.tileY)
        if (d > LEASH) return { x: tank.tileX, y: tank.tileY }
      }
    }
    // Dungeon event: The Saboteur — route to the targeted trap's tile.
    // If that trap is already disabled or gone, re-pick the next one.
    if (adv.goal.type === 'DISARM_TRAP') {
      const trap = (dungeon.traps ?? []).find(t => t.instanceId === adv.goal.trapId)
      if (!trap || trap._disabledThisDay) {
        adv.goal = this._nextSaboteurGoal(adv)
        return this._goalToTile(adv)
      }
      return { x: trap.tileX, y: trap.tileY }
    }
    if (adv.goal.type === 'SEEK_BOSS') {
      // Heart-life redirect (2026-05-27, Lich balance pass). When the
      // boss is currently borrowing a life from the heart, NOBODY walks
      // to the throne — `_diedThisDay` already bounced this day's fight
      // and there's a more important target somewhere in the dungeon.
      //
      //   Knows the heart  → HUNT_PHYLACTERY, beeline to its tile.
      //   No heart intel   → EXPLORE_ROOM on a random non-boss /
      //                      non-entry room they haven't visited yet.
      //                      They'll find the heart by wandering; the
      //                      moment they step into its room,
      //                      `_lichOnAdvRoomChanged` auto-converts them
      //                      to a hunter (100% in heart-life mode).
      //
      // Stack-push preserves the SEEK_BOSS goal so the adv resumes
      // throne-bound behaviour if the heart dies mid-walk and the
      // boss-life economy resets to "normal life remaining" — though
      // in practice the heart dying with deathsRemaining<=0 ends the
      // run, so the stacked goal is mostly defensive.
      const bossState = this._gameState.boss
      const phyl      = this._gameState.phylactery
      const phylAlive = phyl && (phyl.resources?.hp ?? 0) > 0
      // Same-day rest gate (2026-05-27): if the boss has already fallen
      // this day, the redirect pauses — no new advs get rerouted away
      // from the throne. `_diedThisDay` already bounces same-day SEEK_BOSS
      // arrivals via _onIncoming's handoff, so the redirect would just
      // be moving them around for no reason. Resumes on next NIGHT_PHASE
      // when the flag clears.
      if (bossState?._onHeartLife && !bossState?._diedThisDay && phylAlive) {
        if (adv.knowledge?.items?.[phyl.instanceId]) {
          adv.goalStack ??= []
          adv.goalStack.push(adv.goal)
          adv._huntPhylactery = true
          adv.goal = { type: 'HUNT_PHYLACTERY', roomId: phyl.roomId }
          adv.path = null
          return this._goalToTile(adv)
        }
        // Searching path — pick an unvisited non-boss room. Falls back
        // to ANY non-boss / non-entry room if everything's been
        // visited (one more sweep lets them re-cross the heart's
        // room). Degenerate "no rooms left" case falls through to the
        // original SEEK_BOSS behaviour as a last resort so the goal
        // resolution doesn't return null and stall the adv.
        const visited = new Set(adv.visitedRooms ?? [])
        const rooms = this._gameState.dungeon?.rooms ?? []
        const isSearchable = (r) =>
          r.definitionId !== 'boss_chamber' &&
          r.definitionId !== 'entry_hall' &&
          !r.locked
        let pool = rooms.filter(r => isSearchable(r) && !visited.has(r.instanceId))
        if (pool.length === 0) pool = rooms.filter(isSearchable)
        if (pool.length > 0) {
          const pick = pool[Math.floor(Math.random() * pool.length)]
          adv.goalStack ??= []
          adv.goalStack.push(adv.goal)
          adv.goal = { type: 'EXPLORE_ROOM', roomId: pick.instanceId }
          adv.path = null
          return this._goalToTile(adv)
        }
        // No non-boss rooms to search → degenerate dungeon. Fall
        // through to the standard SEEK_BOSS path below so the adv
        // isn't goal-less.
      }
      const boss = dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
      if (!boss) return null
      // Knowledge gate (2026-05-27). Advs may only path DIRECTLY to the
      // boss when they actually know where it is — they've visited it
      // OR inherited briefing AND have an unbroken chain of known rooms
      // from their current room. Otherwise they keep the SEEK_BOSS goal
      // but walk toward the nearest unvisited room instead, discovering
      // the dungeon until the chain links up. Also tightens the
      // Legendary Speed Runner event (they still skip combat/scout/
      // treasure via _pickNextGoal but no longer cheat their way to
      // the throne with omniscient room awareness).
      //
      // EXEMPTION — event invaders that exist solely to challenge the
      // throne bypass the gate and path straight to the boss (single
      // source of truth: _beelinesBoss — add future beeline-event flags
      // there, in ONE place). They came for the throne and know exactly
      // where it is, so they rush it rather than wander. Speedrunner is
      // intentionally NOT exempt (the gate is meant to make it discover
      // the throne) — and even gated roles can no longer freeze here:
      // _exploreFallbackForSeekBoss now walks them OUTWARD through
      // unentered rooms toward the boss instead of stranding them.
      // `_forceBossBeeline` (set by the starvation-loop redirect for the
      // instakill-immune roles — Light Party / Jinwoo) bypasses the explore
      // phase so a looping member heads straight to the throne instead of
      // being culled.
      if (!this._beelinesBoss(adv) && !adv._forceBossBeeline && !this._knowsBossLocation(adv)) {
        const explore = this._exploreFallbackForSeekBoss(adv)
        if (explore) return explore
        // Nothing left to explore — fall through to boss tile so the
        // adv isn't stranded goal-less in a degenerate dungeon.
      }
      return {
        x: boss.gridX + Math.floor(boss.width  / 2),
        y: boss.gridY + Math.floor(boss.height / 2),
      }
    }
    if (adv.goal.type === 'EXPLORE_ROOM') {
      const room = dungeon.rooms.find(r => r.instanceId === adv.goal.roomId)
      if (!room) return null
      return {
        x: room.gridX + Math.floor(room.width  / 2),
        y: room.gridY + Math.floor(room.height / 2),
      }
    }
    // Dungeon event: The Tournament — scatter phase. Route the rival to
    // the center of its assigned non-boss room. If the room is gone,
    // skip straight to HUNT.
    if (adv.goal.type === 'SCATTER_ROOM') {
      const room = dungeon.rooms.find(r => r.instanceId === adv.goal.roomId)
      if (!room || room.definitionId === 'boss_chamber') {
        adv.goal = { type: 'HUNT_RIVAL' }
        return this._goalToTile(adv)
      }
      return {
        x: room.gridX + Math.floor(room.width  / 2),
        y: room.gridY + Math.floor(room.height / 2),
      }
    }
    // Dungeon event: The Tournament — HUNT phase. Path toward the nearest
    // living OTHER rival's current tile (tracked fresh each replan so the
    // hunter chases as the prey moves). If no other rival is alive this
    // adv is the last one standing — switch to SEEK_BOSS (EventSystem
    // also sets this on the last-standing detection, but this is a safety
    // net so a HUNT_RIVAL goal never strands a lone survivor).
    if (adv.goal.type === 'HUNT_RIVAL') {
      const prey = this._nearestLivingRival(adv)
      if (!prey) {
        adv.goal = { type: 'SEEK_BOSS' }
        return this._goalToTile(adv)
      }
      return { x: prey.tileX, y: prey.tileY }
    }
    // Phase 1b.4 — Lich Phylactery: route the adv directly to the heart's
    // tile. If the heart is gone (destroyed mid-walk), fall back to FLEE.
    if (adv.goal.type === 'HUNT_PHYLACTERY') {
      const phyl = this._gameState.phylactery
      if (!phyl || (phyl.resources?.hp ?? 0) <= 0) {
        adv.goal = { type: 'FLEE', reason: 'phylactery_gone' }
        adv.aiState = 'fleeing'
        return this._goalToTile(adv)
      }
      // Path to a cardinal neighbour of the heart, NOT the heart tile
      // itself. The heart entity doesn't register with PathfinderSystem
      // (it's not in DungeonGrid's tile pool), so without this the adv
      // walks straight onto the heart's tile and stands on top of it —
      // visually wrong (they should attack from beside) and crowds out
      // every other hunter who also wants the same tile.
      //
      // BossArchetypeSystem.tick() applies damage to any HUNT_PHYLACTERY
      // adv within Manhattan d <= 1, so a cardinal neighbour is enough
      // to land the hit. With 4 cardinals available, up to 4 hunters
      // can be in-range simultaneously; extra hunters queue at d=2 and
      // don't damage the heart until a slot opens.
      const NEIGHBORS = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
        { dx: 0, dy: 1 }, { dx: 0,  dy: -1 },
      ]
      let best = null, bestD = Infinity
      for (const { dx, dy } of NEIGHBORS) {
        const nx = phyl.tileX + dx
        const ny = phyl.tileY + dy
        const tt = this._dungeonGrid?.getTileType?.(nx, ny)
        if (tt == null) continue
        if (!PathfinderSystem.isWalkable(tt)) continue
        const d = Math.abs(adv.tileX - nx) + Math.abs(adv.tileY - ny)
        if (d < bestD) { best = { x: nx, y: ny }; bestD = d }
      }
      // Defensive fallback — if every cardinal neighbour is somehow
      // unwalkable (heart wedged against walls in a malformed room?),
      // fall back to the heart's tile so the adv at least reaches
      // melee range instead of giving up entirely.
      return best ?? { x: phyl.tileX, y: phyl.tileY }
    }
    // Phase 1b.10 — Vampire Charm: walk to the boss itself (not just the room).
    // Route to the boss's current tile so the adv tracks the boss as it moves.
    // BossArchetypeSystem converts them into a thrall once they get close enough.
    if (adv.goal.type === 'CHARM_WALK') {
      const boss = this._gameState.boss
      if (boss?.tileX != null && boss?.tileY != null) return { x: boss.tileX, y: boss.tileY }
      // Fallback: boss not yet positioned — use room center.
      const room = dungeon.rooms.find(r => r.instanceId === adv.goal.roomId)
      if (!room) return null
      return {
        x: room.gridX + Math.floor(room.width  / 2),
        y: room.gridY + Math.floor(room.height / 2),
      }
    }
    if (adv.goal.type === 'SEEK_VENDETTA') {
      // Hunter targets the specific minion. If that minion is dead/missing, fall back to boss.
      const targetMinion = this._gameState.minions.find(m => m.instanceId === adv.goal.minionId && m.aiState !== 'dead')
      if (!targetMinion) {
        adv.goal = { type: 'SEEK_BOSS' }
        const boss = dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
        if (!boss) return null
        return { x: boss.gridX + Math.floor(boss.width  / 2), y: boss.gridY + Math.floor(boss.height / 2) }
      }
      return { x: targetMinion.tileX, y: targetMinion.tileY }
    }
    if (adv.goal.type === 'FOLLOW_LEADER') {
      // Phase 10 — Echo: follow the leader's CURRENT tile every replan
      const leader = this._gameState.adventurers.active.find(a => a.instanceId === adv.goal.leaderId)
      if (!leader || leader.aiState === 'dead') {
        // Leader is gone — fall back to boss
        adv.goal = { type: 'SEEK_BOSS' }
        return this._goalToTile(adv)
      }
      return { x: leader.tileX, y: leader.tileY }
    }
    if (adv.goal.type === 'ATTACK_ALLY') {
      // Room redesign 2026-04-30 — Hall of Madness frenzy. Pathfind to a
      // fellow adventurer; engagement happens through the engage block
      // when in melee range.
      const target = this._gameState.adventurers.active.find(a => a.instanceId === adv.goal.allyId)
      if (!target || target.aiState === 'dead') return null
      return { x: target.tileX, y: target.tileY }
    }
    if (adv.goal.type === 'FLEE') {
      // Run for an entry hall doorway — the canonical exit. With multiple
      // entry halls the adventurer locks onto the nearest one when the
      // flee begins (stored on the goal) so they don't oscillate between
      // two equidistant exits as they move. Pathfinder still routes from
      // each adventurer's own tile.
      return this._fleeExitTile(adv)
    }
    // Dungeon event: Twitch Con — "wander in place". A freelance streamer
    // who rolled WANDER drifts to a random walkable tile a few steps from
    // wherever they currently are (a fresh tile is picked each replan, so
    // they mill around aimlessly). EventSystem's freelance timer re-rolls
    // the agenda every ~4s so this never permanently strands them.
    if (adv.goal.type === 'WANDER') {
      const tilesGrid = this._dungeonGrid.getTiles?.()
      if (tilesGrid) {
        // Try a handful of random offsets in a small radius; first walkable,
        // non-door tile wins. Fall back to standing still if none found.
        for (let tries = 0; tries < 8; tries++) {
          const ox = Math.floor(Math.random() * 7) - 3   // [-3, 3]
          const oy = Math.floor(Math.random() * 7) - 3
          const tx = adv.tileX + ox
          const ty = adv.tileY + oy
          const row = tilesGrid[ty]
          if (!row) continue
          const t = row[tx]
          if (!PathfinderSystem.isWalkable(t)) continue
          if (t === TILE.DOOR) continue
          return { x: tx, y: ty }
        }
      }
      return { x: adv.tileX, y: adv.tileY }
    }
    // Phase D — beeline to the targeted treasure chest. If it's gone or
    // already opened, pop back to whatever we were doing.
    if (adv.goal.type === 'SEEK_TREASURE') {
      const chest = (this._gameState.dungeon.treasureChests ?? [])
        .find(c => c.instanceId === adv.goal.chestId && !c.opened)
      if (!chest) {
        adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
        return this._goalToTile(adv)
      }
      return { x: chest.tileX, y: chest.tileY }
    }
    // Phase D — escape with stolen loot. Same target as FLEE (the
    // entry-hall doorway), but the adv keeps full speed (not panicked)
    // and the gold is gone for good when they leave.
    if (adv.goal.type === 'ESCAPE_WITH_LOOT') {
      return this._fleeExitTile(adv)
    }
    // Phase: items — beeline to a known healing fountain. If the fountain
    // is gone (sold mid-walk), pick up where we left off.
    if (adv.goal.type === 'SEEK_HEAL') {
      const f = (this._gameState.dungeon.fountains ?? [])
        .find(x => x.instanceId === adv.goal.fountainId)
      if (!f) {
        adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
        return this._goalToTile(adv)
      }
      return { x: f.tileX, y: f.tileY }
    }
    // Phase: items — beeline to the key chest. If it's been opened
    // (someone else got there first) or sold, drop the goal.
    if (adv.goal.type === 'SEEK_KEY_CHEST') {
      const chest = (this._gameState.dungeon.keyChests ?? [])
        .find(c => c.instanceId === adv.goal.chestId && !c.opened)
      if (!chest) {
        adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
        return this._goalToTile(adv)
      }
      return { x: chest.tileX, y: chest.tileY }
    }
    // Phase: items — beeline to the closest tile of the matching lock.
    // If the lock is gone (sold) or already open, drop the goal.
    if (adv.goal.type === 'OPEN_LOCKED_DOOR') {
      const lock = (this._gameState.dungeon.locks ?? []).find(l => l.id === adv.goal.lockId)
      if (!lock || lock.unlocked || lock.broken) {
        adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
        return this._goalToTile(adv)
      }
      let best = null, bestD = Infinity
      for (const t of lock.doorTiles) {
        const d = Math.hypot(adv.tileX - t.x, adv.tileY - t.y)
        if (d < bestD) { best = t; bestD = d }
      }
      return best ? { x: best.x, y: best.y } : null
    }
    // Phase: alive AI — walk to the loot pile. If it's already gone
    // (someone else grabbed it, or the day ended), repick.
    if (adv.goal.type === 'LOOT_CORPSE') {
      const pile = (this._gameState.dungeon.lootPiles ?? [])
        .find(p => p.instanceId === adv.goal.pileId)
      if (!pile) {
        adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
        return this._goalToTile(adv)
      }
      return { x: pile.tileX, y: pile.tileY }
    }
    if (adv.goal.type === 'TACTICAL_RETREAT') {
      // Phase 5c — head to the chosen safer visited room. If the room was
      // removed mid-retreat (player undo, etc.) fall back to FLEE so the
      // adv at least heads home.
      const room = dungeon.rooms.find(r => r.instanceId === adv.goal.roomId)
      if (!room) {
        adv.goal = { type: 'FLEE', reason: adv.goal.fromReason ?? 'retreat_room_gone' }
        adv.aiState = 'fleeing'
        return this._goalToTile(adv)
      }
      return {
        x: room.gridX + Math.floor(room.width  / 2),
        y: room.gridY + Math.floor(room.height / 2),
      }
    }
    return null
  }

  _onGoalReached(adv, idx) {
    // Dungeon event: The Saboteur reached a trap — disable it for the
    // day (TrapSystem re-arms every trap overnight), then move on to the
    // next still-armed trap, or flee once they're all dead.
    if (adv.goal.type === 'DISARM_TRAP') {
      const trap = (this._gameState.dungeon.traps ?? []).find(t => t.instanceId === adv.goal.trapId)
      if (trap && !trap._disabledThisDay) {
        trap._disabledThisDay = true
        EventBus.emit('TRAP_DISARMED', { trap, by: 'saboteur' })
      }
      adv.goal = this._nextSaboteurGoal(adv)
      adv.path = null
      if (adv.goal.type === 'FLEE') adv.aiState = 'fleeing'
      return
    }
    // Phase D — reached a treasure chest. The actual open + steal +
    // escape-roll already fired in _tryOpenTreasureChest during the
    // tile commit (proximity-based). Resume normal flow.
    if (adv.goal.type === 'SEEK_TREASURE') {
      adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
      adv.path = null
      return
    }
    // Phase D — reached the entry hall while carrying stolen gold. The
    // actual splice + ADVENTURER_FLED emission happens in the existing
    // FLEE atNorthEdge code (same exit tile). Mark gold as permanently
    // lost. Treat the rest like FLEE — convert to it so the existing
    // splice path runs.
    if (adv.goal.type === 'ESCAPE_WITH_LOOT') {
      EventBus.emit('TREASURE_ESCAPED', { adventurer: adv, gold: adv.stolenGold ?? 0 })
      adv.goal = { type: 'FLEE', reason: 'treasure_escape' }
      adv.aiState = 'fleeing'
      adv.path = null
      return
    }
    // Phase: items — reached the fountain. The actual heal already
    // fired in _tryHealAtFountain when the adv stepped within range,
    // so we just pop back to the prior goal.
    if (adv.goal.type === 'SEEK_HEAL') {
      adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
      adv.path = null
      return
    }
    // Phase: items — reached the chest tile. _tryPickKey already fired
    // (proximity-based) during the per-tile commit, picking the key up
    // and stacking OPEN_LOCKED_DOOR on top. If the chest somehow wasn't
    // grabbed (e.g. opened by someone else mid-walk), pop the stack.
    if (adv.goal.type === 'SEEK_KEY_CHEST') {
      adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
      adv.path = null
      return
    }
    // Phase: items — reached the locked door. The unlock fired during
    // _tryUnlockTile when the adv stepped onto the tile, so by the time
    // we get here the door is open. Pop back to the prior goal.
    if (adv.goal.type === 'OPEN_LOCKED_DOOR') {
      adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
      adv.path = null
      return
    }
    // Phase: alive AI — reached the loot pile. Start the looting timer;
    // the per-tick guard freezes the adv until _lootingUntil expires,
    // then _applyLootBuff fires and the pile is removed.
    if (adv.goal.type === 'LOOT_CORPSE') {
      const pile = (this._gameState.dungeon.lootPiles ?? [])
        .find(p => p.instanceId === adv.goal.pileId)
      if (!pile) {
        adv.goal = adv.goalStack?.pop() ?? this._pickNextGoal(adv)
        adv.path = null
        return
      }
      adv._lootingUntil = this._scene.time.now + LOOT_DURATION_MS
      adv._lootingPileId = pile.instanceId
      adv.path = null
      return
    }
    if (adv.goal.type === 'EXPLORE_ROOM') {
      adv.visitedRooms ??= []
      if (!adv.visitedRooms.includes(adv.goal.roomId)) {
        adv.visitedRooms.push(adv.goal.roomId)
      }
      // Note: per-tick room-change detection in _tickAdventurer already
      // emitted ADVENTURER_ROOM_CHANGED when the adventurer first crossed
      // into this room — no need to re-emit here. (Was a duplicate.)
      //
      // EXPLORE_ROOM cycle cap (anti-room-bounce, 2026-05-27). On-screen
      // F4 diagnostics showed advs stuck cycling between 2-3 rooms forever
      // because _pickNextGoal kept returning another EXPLORE_ROOM. After
      // EXPLORE_STREAK_CAP consecutive room-arrivals, force SEEK_BOSS so
      // the adv stops wandering and commits to the throne. Streak resets
      // any time _pickNextGoal returns something other than EXPLORE_ROOM
      // (treasure, scout, regroup, etc.) — those are real progress.
      adv._exploreStreak = (adv._exploreStreak ?? 0) + 1
      const next = this._pickNextGoal(adv)
      if (next?.type === 'EXPLORE_ROOM' && adv._exploreStreak >= EXPLORE_STREAK_CAP && !adv._nemesis) {
        adv._exploreStreak = 0
        adv.goal = { type: 'SEEK_BOSS' }
        EventBus.emit('SAY_seekBoss', { adventurer: adv })
      } else {
        adv.goal = next
        if (next?.type !== 'EXPLORE_ROOM') adv._exploreStreak = 0
      }
      return
    }
    // Dungeon event: The Tournament — rival reached its scatter room.
    // Flip into HUNT mode: from here on it actively chases + kills the
    // nearest living other rival.
    if (adv.goal.type === 'SCATTER_ROOM') {
      adv.visitedRooms ??= []
      if (adv.goal.roomId && !adv.visitedRooms.includes(adv.goal.roomId)) {
        adv.visitedRooms.push(adv.goal.roomId)
      }
      adv.goal = { type: 'HUNT_RIVAL' }
      adv.path = null
      return
    }
    // Dungeon event: The Tournament — hunter reached the prey's tile.
    // Just clear the path; _goalToTile re-resolves the nearest living
    // rival on the next replan (the in-range engagement block does the
    // actual attacking). If the prey is now dead, _goalToTile flips this
    // to SEEK_BOSS for the last one standing.
    if (adv.goal.type === 'HUNT_RIVAL') {
      adv.path = null
      return
    }

    if (adv.goal.type === 'SEEK_BOSS') {
      // Knowledge-gated SEEK_BOSS (2026-05-27). When the adv doesn't
      // know where the boss is, _goalToTile resolves their pathTarget
      // to an unvisited room's center instead. Arrivals at THAT tile
      // must NOT hand off to BossSystem — that would phantom-trigger
      // BOSS_FIGHT_INCOMING from across the map. Verify the adv is
      // actually standing in the boss room before the handoff. If not,
      // they just arrived at an exploration target — clear the path so
      // the next replan re-resolves (either to the boss now that the
      // chain may have linked up via the just-observed room, or to the
      // next unvisited room).
      const hereRoom = this._dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)
      if (!hereRoom || hereRoom.definitionId !== 'boss_chamber') {
        adv.path = null
        return
      }
      // Only redirect to FLEE on TRUE death (no lives left, no
      // phylactery). A non-final death leaves boss.hp at 0 ("death
      // pose") between fights but the boss is still alive overall —
      // the next BOSS_FIGHT_INCOMING refreshes hp and starts the fight
      // normally. Prior `boss.hp <= 0` check was too broad and stopped
      // any second-fight scenario (later-arriving adv that day, lone
      // vendetta hunter, guild-raid staggered party) from kicking off.
      const boss = this._gameState.boss
      const finallyDead = !!boss && (boss.deathsRemaining ?? 1) <= 0
                          && !((this._gameState.phylactery?.resources?.hp ?? 0) > 0)
      if (finallyDead) {
        adv.goal = { type: 'FLEE' }
        adv.path = null
        adv.aiState = 'walking'
        return
      }
      // Phase 10: hand control to BossSystem. Adventurer freezes in place at
      // boss-chamber threshold; BossSystem auto-resolves the fight.
      adv.goal = { type: 'AT_BOSS' }
      adv.path = null
      adv.aiState = 'fighting'
      EventBus.emit('BOSS_FIGHT_INCOMING', { adventurer: adv })
      return
    }
    if (adv.goal.type === 'AT_BOSS') {
      // Frozen — BossSystem will kill or flee them when the fight resolves
      adv.path = null
      return
    }

    // Dungeon event: Twitch Con — wandering streamer reached its drift
    // tile. Just clear the path; _goalToTile picks a fresh random tile on
    // the next replan, and EventSystem's freelance timer will re-roll the
    // whole agenda within a few seconds anyway.
    if (adv.goal.type === 'WANDER') {
      adv.path = null
      return
    }

    if (adv.goal.type === 'FOLLOW_LEADER') {
      // Reached the leader's tile — replan to track their next move
      adv.goal = this._pickNextGoal(adv)
      return
    }

    if (adv.goal.type === 'FLEE') {
      // _tickAdventurer's per-tick "in entry" check handles the actual
      // splice on arrival.  Just clear the path so the next tick picks a
      // fresh route if we ended up somewhere other than entry.
      adv.path = null
      return
    }

    // Phase 1b.4 — Reached the phylactery: freeze the adv on the heart's
    // tile. BossArchetypeSystem ticks per second to apply damage. Once the
    // heart breaks (or the adv dies / flees), this goal resolves.
    if (adv.goal.type === 'HUNT_PHYLACTERY') {
      adv.path = null
      const phyl = this._gameState.phylactery
      if (!phyl || (phyl.resources?.hp ?? 0) <= 0) {
        adv.goal = this._pickNextGoal(adv)
        return
      }
      // Adjacent to the heart → flip to fighting state so
      // AdventurerRenderer plays the attack animation. The actual
      // damage tick lives in BossArchetypeSystem.tick() and only
      // checks goal type + Manhattan d≤1, so without this the adv was
      // silently dealing damage while looking idle. Heart-destroyed
      // cleanup in BossArchetypeSystem (`_huntPhylactery` block, ~1265)
      // resets aiState to 'fleeing' when the heart dies, so we don't
      // need a manual clear path here.
      const dx = Math.abs(adv.tileX - phyl.tileX)
      const dy = Math.abs(adv.tileY - phyl.tileY)
      if (dx + dy <= 1) adv.aiState = 'fighting'
      return
    }
    // Phase 1b.10 — Vampire Charm: arrived at the boss room. Hold the adv
    // in place; BossArchetypeSystem.tick converts them into a thrall on the
    // very next frame.
    if (adv.goal.type === 'CHARM_WALK') {
      adv.path = null
      adv.aiState = 'idle'
      return
    }

    if (adv.goal.type === 'TACTICAL_RETREAT') {
      // Phase 5c — arrived at the safer room. Mark it visited (it should be
      // already), then resume normal exploration from here. The next
      // _pickNextGoal will pick an unvisited room or SEEK_BOSS depending on
      // personality / state.
      adv.visitedRooms ??= []
      if (!adv.visitedRooms.includes(adv.goal.roomId)) {
        adv.visitedRooms.push(adv.goal.roomId)
      }
      adv.aiState = 'walking'
      adv.path = null
      adv.goal = this._pickNextGoal(adv)
      EventBus.emit('ADVENTURER_TACTICAL_RETREAT_DONE', { adventurer: adv })
      return
    }

  }

  // Stuck-EXPLORE_ROOM escalation. Called from both watchdogs (pathTarget
  // and position-stagnation) when they fire. If the adv's current goal is
  // EXPLORE_ROOM, marks the unreachable room as visited (so the
  // personality picker won't re-select it — cartographer + scout already
  // respect visitedRooms), bumps _exploreStreak, and either forces
  // SEEK_BOSS (cap hit) or re-rolls the goal via _pickNextGoal. After
  // EXPLORE_STREAK_CAP give-ups (~25s of stuckness) the adv hard-commits
  // to the throne — the knowledge gate in _goalToTile handles the
  // redirect-to-exploration case if they don't yet know the path there.
  // No-op if the goal isn't EXPLORE_ROOM. (2026-05-27)
  _escalateStuckExplore(adv) {
    if (adv.goal?.type !== 'EXPLORE_ROOM') return
    adv.visitedRooms ??= []
    if (adv.goal.roomId != null && !adv.visitedRooms.includes(adv.goal.roomId)) {
      adv.visitedRooms.push(adv.goal.roomId)
    }
    adv._exploreStreak = (adv._exploreStreak ?? 0) + 1
    if (adv._exploreStreak >= EXPLORE_STREAK_CAP) {
      adv._exploreStreak = 0
      // Treasure-Hunter raiders never hard-commit to the boss — re-pick through
      // the raid flow instead (next unvisited room, or flee once every room has
      // been explored). The stuck room was just marked visited above, so the
      // re-pick can't re-select it and exploration keeps advancing.
      if (adv._treasureHunter || adv._nemesis) {
        adv.goal = this._pickNextGoal(adv)
        this._aiDiag(adv, `STREAK CAP (raider/nemesis) → ${adv.goal?.type ?? '?'}`)
      } else {
        adv.goal = { type: 'SEEK_BOSS' }
        EventBus.emit('SAY_seekBoss', { adventurer: adv })
        this._aiDiag(adv, `STREAK CAP via watchdog → SEEK_BOSS`)
      }
    } else {
      const next = this._pickNextGoal(adv)
      adv.goal = next
      if (next?.type !== 'EXPLORE_ROOM') adv._exploreStreak = 0
      this._aiDiag(adv, `gave up on EXPLORE_ROOM → ${next?.type ?? '?'} (streak=${adv._exploreStreak})`)
    }
  }

  // Neighbour rooms reachable from `room` via its connectionPoints.
  // Mirrors the pattern in DungeonGrid._unpairNeighbourCps: each cp
  // points one tile in cp.direction into the next room. External cps
  // (dungeon edge) yield nothing. (2026-05-27 — knowledge-gated SEEK_BOSS)
  _getRoomNeighbors(room) {
    if (!room) return []
    const DIR = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }
    const out = []
    for (const cp of room.connectionPoints ?? []) {
      if (cp.external) continue
      const v = DIR[cp.direction]
      if (!v) continue
      const tx = room.gridX + cp.x + v[0]
      const ty = room.gridY + cp.y + v[1]
      const other = this._dungeonGrid?.getRoomAtTile?.(tx, ty)
      if (other && other.instanceId !== room.instanceId && !out.includes(other)) {
        out.push(other)
      }
    }
    return out
  }

  // True iff the boss is reachable along a KNOWN route — i.e. (a) the boss
  // room is known, AND (b) there's an unbroken chain of known rooms (via
  // connectionPoints) from the adv's current room back to the boss room.
  // Without (b) they might know the throne exists but have no charted route
  // there, so they keep exploring until the chain links up.
  //
  // "Known" is COLLECTIVE: a room counts if it's in the shared knowledge pool
  // (gameState.knowledge.sharedPool.rooms) OR this adv has personally seen it
  // this wave. So once any prior survivor charts the boss room + a connecting
  // route, that knowledge lives in the shared pool and EVERY later adventurer
  // marches straight in along it instead of re-exploring the whole dungeon —
  // even brand-new arrivals who never inherited a full briefing. (2026-05-29:
  // switched from per-adv knowledge to the shared pool per design.)
  //
  // Knowledge sources (KnowledgeSystem.js):
  //   - Visiting a room (ADVENTURER_ROOM_CHANGED → observeCurrentRoom), which
  //     feeds the shared pool when survivors share at end of day / on death
  //   - Briefing on spawn (initKnowledgeForSpawn inherits a fraction of
  //     the shared pool from prior survivors; veterans inherit 100%)
  //
  // Used by the SEEK_BOSS branch of _goalToTile to gate direct-to-boss
  // pathing (and, transitively, by speedrunner — they still skip combat/
  // scout/treasure via _pickNextGoal, but no longer cheat their way to
  // the throne). BFS is capped at 200 visits as a safety belt against a
  // pathological dungeon. (2026-05-27)
  _knowsBossLocation(adv) {
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const boss  = rooms.find(r => r.definitionId === 'boss_chamber')
    if (!boss) return false
    const shared   = this._gameState?.knowledge?.sharedPool?.rooms ?? {}
    const personal = adv.knowledge?.rooms ?? {}
    const isKnown  = (id) => !!(shared[id] || personal[id])
    if (!isKnown(boss.instanceId)) return false
    const here = this._dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)
    if (!here) return false
    if (here.instanceId === boss.instanceId) return true
    const seen = new Set([here.instanceId])
    const queue = [here]
    let safety = 200
    while (queue.length && safety-- > 0) {
      const r = queue.shift()
      for (const n of this._getRoomNeighbors(r)) {
        if (seen.has(n.instanceId)) continue
        if (n.instanceId === boss.instanceId) return true
        // Can only traverse rooms that are known (shared pool or personal).
        if (!isKnown(n.instanceId)) continue
        seen.add(n.instanceId)
        queue.push(n)
      }
    }
    return false
  }

  // SINGLE SOURCE OF TRUTH — does this adventurer beeline the throne by
  // design? These are the event roles that return { type: 'SEEK_BOSS' }
  // unconditionally from _pickNextGoal with no EXPLORE phase: they exist
  // to rush + fight the boss, so they BYPASS the SEEK_BOSS knowledge gate
  // (path straight to the throne) AND the stuck/starvation cull failsafes
  // (so they're not culled while queued at the boss-room doorway).
  //
  // *** ADDING A FUTURE BEELINE EVENT? Add its flag HERE, in this one
  // place — the gate + both failsafes all read this. *** And even if you
  // forget: _exploreFallbackForSeekBoss (below) guarantees a gated role
  // EXPLORES toward the boss instead of freezing, so the worst case for a
  // forgotten flag is "wanders to the throne" rather than "stuck in a
  // room and dies".
  _beelinesBoss(adv) {
    return !!(
      adv?._bossRoyaleInvader ||   // Boss Royale gauntlet (11 boss invaders)
      adv?._monsterInvader   ||   // Rival Dungeon pack (monsters)
      adv?._rivalBoss        ||   // Rival Dungeon champion
      adv?._speedrunner           // Legendary Speed Runner — has the route memorized; always knows where the throne is
      // NOTE: Sung Jinwoo (_shadowMonarch) is deliberately EXCLUDED — he
      // keeps a SEEK_BOSS goal but must DISCOVER the throne by exploring
      // (the knowledge-gated SEEK_BOSS + _exploreFallbackForSeekBoss path).
      // He doesn't magically know where the boss is.
    )
  }

  // Fallback target for an adv whose goal is SEEK_BOSS but who doesn't
  // know where the boss is yet. Walks them toward the nearest room they
  // have NOT YET ENTERED so they discover the dungeon; once they enter
  // it, observeCurrentRoom links it into their knowledge and the next
  // replan may resolve straight to the boss. When every non-boss room
  // has been entered, returns null and the caller paths straight to the
  // throne — so the adv always makes forward progress.
  //
  // CRITICAL (2026-05-28): keyed on `_roomsEntered` (stamped on EVERY
  // room entry, for every adv — see the room-change handler) NOT
  // `visitedRooms`. visitedRooms is only filled by the EXPLORE_ROOM goal
  // flow, so advs that go straight to SEEK_BOSS (event beeliners, and any
  // future role) never populate it — the old code then kept returning the
  // room they were already standing in, producing zero movement: they
  // froze in place across the dungeon (the reported Boss Royale / Rival
  // Dungeon bug). We also explicitly skip the room the adv is currently
  // in so the target is always somewhere to move TO. Using _roomsEntered
  // makes this safe for ANY SEEK_BOSS adventurer, present or future.
  _exploreFallbackForSeekBoss(adv) {
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const entered = adv._roomsEntered ?? {}
    const hereId = this._dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)?.instanceId
    // Candidate rooms = everything NOT yet entered, not the one we're standing
    // in, not locked. The boss chamber IS a candidate now — discovery should be
    // organic ("stumble onto the throne"), NOT deterministically last.
    // (Before 2026-05-30 this excluded boss_chamber AND picked strictly
    // nearest, so an adv toured every other room before finally reaching the
    // throne — the "visits every room first" complaint. Walking INTO the boss
    // chamber triggers the normal SEEK_BOSS→AT_BOSS handoff; walking into a
    // boss-adjacent room flips _knowsBossLocation and the caller then paths
    // straight in. Fix covers Light Party + Jinwoo, which discover via here.)
    const candidates = rooms.filter(room =>
      room.instanceId !== hereId &&
      !entered[room.instanceId] &&
      !room.locked)
    if (candidates.length === 0) return null
    // Commit to ONE target room until it's entered, so the adv walks there
    // decisively rather than re-rolling a destination every replan (which
    // would dither them in place). Re-pick RANDOMLY when the committed target
    // is gone (entered, or no longer a candidate) — random, not nearest, so the
    // throne turns up at a different point each run instead of always last.
    let target = candidates.find(r => r.instanceId === adv._seekExploreTargetId)
    if (!target) {
      target = candidates[Math.floor(Math.random() * candidates.length)]
      adv._seekExploreTargetId = target.instanceId
    }
    return {
      x: target.gridX + Math.floor(target.width  / 2),
      y: target.gridY + Math.floor(target.height / 2),
    }
  }

  // Personality-driven goal selection.
  // Falls back to SEEK_BOSS if no PersonalitySystem is wired yet.
  // Dungeon event: The Tournament — nearest living OTHER tournament
  // rival to `adv` (by Euclidean tile distance). Returns null when `adv`
  // is the last rival standing. Excludes dead/fleeing rivals — though
  // rivals carry noFlee, the dead check still matters once one is killed.
  _nearestLivingRival(adv) {
    let best = null, bestDist = Infinity
    for (const other of this._gameState.adventurers.active) {
      if (other === adv) continue
      if (!other._tournamentRival) continue
      if (other.aiState === 'dead' || other.aiState === 'fleeing') continue
      if ((other.resources?.hp ?? 0) <= 0) continue
      const d = Math.hypot(other.tileX - adv.tileX, other.tileY - adv.tileY)
      if (d < bestDist) { best = other; bestDist = d }
    }
    return best
  }

  _pickNextGoal(adv) {
    // The Nemesis (Aldric, KR P2) — "scout & withdraw". In Acts I–III he is
    // plot-armored (can't die) and must NOT duel the boss — that's the Act IV
    // duel, which spawns him WITHOUT the _nemesis flag, so this branch never
    // applies there. He explores + fights minions to test you, then withdraws
    // with a vow: FLEE once chipped near his HP floor OR after roaming enough
    // rooms. Never SEEK_BOSS, never loot.
    if (adv._nemesis) {
      const hp = adv.resources?.hp ?? 1, maxHp = adv.resources?.maxHp ?? 1
      const roomsSeen = adv.visitedRooms?.length ?? 0
      const withdraw = hp <= maxHp * 0.18 || roomsSeen >= 6
      return withdraw ? { type: 'FLEE' } : { type: 'EXPLORE_ROOM' }
    }
    // The Nemesis, Act IV form — the crowned Hero King (spawned with
    // _nemesisDuel, NOT _nemesis, so he's killable and never flees) storms the
    // throne for the duel. Same knowledge-gated SEEK_BOSS march as the Shadow
    // Monarch: he explores until he finds the boss room, then commits. Putting
    // him down at the throne wins the run.
    if (adv._nemesisDuel) return { type: 'SEEK_BOSS' }
    // Dungeon event: Legendary Speed Runner — pure beeline to the boss.
    // Skips the entire goal-picking flow (no scout, no regroup, no
    // treasure, no chest detours, no personality variants) so they march
    // straight at the boss room every replan.
    if (adv._speedrunner) return { type: 'SEEK_BOSS' }
    // Dungeon event: Solo Leveling — the Shadow Monarch hunts the throne, but
    // he does NOT start out knowing where it is (excluded from _beelinesBoss).
    // This SEEK_BOSS goal is therefore knowledge-gated: he EXPLORES room to
    // room (via the SEEK_BOSS explore-fallback), cutting through + raising the
    // minions he meets, until he discovers the boss room — then marches on it.
    if (adv._shadowMonarch) return { type: 'SEEK_BOSS' }
    // Dungeon event: Light Party — every party member uses the same
    // knowledge-gated SEEK_BOSS goal so the whole raid moves toward the
    // throne together. LightPartyAi.js layers the per-role behaviors (tank
    // provoke aura, healer never-attack + raise cast, DPS positioning) and
    // formation on top; the underlying pathing is the standard SEEK_BOSS
    // explore-then-march flow.
    if (adv._lightParty) return { type: 'SEEK_BOSS' }
    // Dungeon event: Boss Royale — every invading boss cooperates and
    // beelines the throne (no exploration, no friendly fire). Same pure
    // SEEK_BOSS flow as the speedrunner so all 11 converge on the boss.
    if (adv._bossRoyaleInvader) return { type: 'SEEK_BOSS' }
    // Dungeon event: Rival Dungeon — the ENTIRE invading pack (monsters +
    // champion) beelines the throne together. Previously the pack wandered
    // room-to-room like a normal wave, so the only real boss-threat was the
    // lone champion and the event was trivial; now the whole horde converges
    // on the boss so it reads as a genuine overrun (2026-05-27 re-tune).
    if (adv._monsterInvader) return { type: 'SEEK_BOSS' }
    // Dungeon event: Treasure Hunters — here for the LOOT only; they ignore
    // the boss entirely. As of 2026-05-29 they respect the knowledge system
    // like normal advs (no treasure map), but the raid shares discoveries:
    //   1. Beeline the nearest chest ANY living raider knows about — the moment
    //      one raider spots a chest, the whole raid converges on it to loot it.
    //   2. Flee the instant they're carrying loot.
    //   3. No known chest left to grab → help SCOUT the dungeon: head to the
    //      nearest room the RAID hasn't explored yet (shared map — a room
    //      counts as seen once any raider enters it, and raiders fan out to
    //      different rooms). Once the raid has collectively visited every room
    //      AND every found chest is looted, there's nothing left → they leave.
    if (adv._treasureHunter) {
      if ((adv.stolenGold ?? 0) > 0 || adv._raiderLooted) return { type: 'ESCAPE_WITH_LOOT' }
      const chest = this._nearestRaidKnownChest(adv)
      if (chest) return { type: 'SEEK_TREASURE', chestId: chest.instanceId }
      const room = this._nearestRaidUnexploredRoom(adv)
      if (room) return { type: 'EXPLORE_ROOM', roomId: room.instanceId }
      return { type: 'FLEE', reason: 'no_loot_left' }
    }
    // Dungeon event: The Saboteur — tours the dungeon disabling every
    // trap, then flees. Never picks a combat or exploration goal.
    if (adv._saboteur) return this._nextSaboteurGoal(adv)
    // Dungeon event: The Tournament — a rival's goal-picking is fully
    // owned by the bloodsport flow (scatter → hunt → seek boss). It never
    // runs the normal personality/scout/treasure goal picker. While any
    // other rival is alive, HUNT them; otherwise (last one standing) go
    // for the boss. EventSystem also sets SEEK_BOSS on the winner, so
    // this is the fallback for any unexpected goal dissolve.
    if (adv._tournamentRival) {
      return this._nearestLivingRival(adv)
        ? { type: 'HUNT_RIVAL' }
        : { type: 'SEEK_BOSS' }
    }
    // Dungeon event: Cartographer's Convention — pick the closest
    // unvisited non-boss room and explore it. When all rooms are
    // visited (or unreachable), flee. Never engages combat goals.
    if (adv._cartographer) {
      const visited = new Set(adv.visitedRooms ?? [])
      let best = null, bestDist = Infinity
      for (const room of this._gameState.dungeon.rooms) {
        if (visited.has(room.instanceId)) continue
        if (room.definitionId === 'boss_chamber') continue
        const cx = room.gridX + Math.floor(room.width / 2)
        const cy = room.gridY + Math.floor(room.height / 2)
        const d = Math.hypot(adv.tileX - cx, adv.tileY - cy)
        if (d < bestDist) { best = room; bestDist = d }
      }
      if (best) return { type: 'EXPLORE_ROOM', roomId: best.instanceId }
      return { type: 'FLEE', reason: 'tour_complete' }
    }
    // Phase D — Treasure chest pull. Greedy types always go for the
    // highest-tier unopened chest; everyone else rolls each chest's
    // tempt %. Skipped if the adv is already carrying stolen gold.
    //
    // Anti-thrash budget (2026-05-27): each adv gets MAX_CHEST_SEEKS_PER_DAY
    // SEEK_TREASURE picks per day. After that, `flags.chestGivenUp` latches
    // for the rest of the day and we fall through to the normal goal flow.
    // Pairs with the sticky-pick in `_maybePickTreasureChest`: the sticky
    // keeps each pick on the SAME chest, the budget caps how many distinct
    // "I'm trying for a chest" sessions one adv can spawn per day.
    // Re-counts the SAME SEEK_TREASURE goal as one pick even when interrupt-
    // and-repick keeps re-entering this branch with the same chest, so a
    // genuinely unreachable chest can't sink an adv's whole day.
    if (!adv.stolenGold && !(adv.flags?.chestGivenUp)) {
      if ((adv._chestSeekCount ?? 0) >= MAX_CHEST_SEEKS_PER_DAY) {
        adv.flags ??= {}
        adv.flags.chestGivenUp = true
      } else {
        const chest = this._maybePickTreasureChest(adv)
        if (chest) {
          adv._chestSeekCount = (adv._chestSeekCount ?? 0) + 1
          EventBus.emit('SAY_seekTreasure', { adventurer: adv })
          return { type: 'SEEK_TREASURE', chestId: chest.instanceId }
        }
      }
    }

    // Phase: alive AI — greedy / vulture types prioritize visible loot
    // piles over any normal goal. They scan every pile each replan and
    // grab the closest within sight range. anti_loot advs skip this.
    const tags0 = this._personalitySystem?.getTags(adv) ?? new Set()
    const greedy = tags0.has('greedy') || tags0.has('vulture') || tags0.has('loot_seeker')
    if (greedy && !tags0.has('anti_loot')) {
      const piles = this._gameState.dungeon?.lootPiles ?? []
      let best = null, bestDist = LOOT_SIGHT_RANGE
      for (const p of piles) {
        const d = Math.hypot(adv.tileX - p.tileX, adv.tileY - p.tileY)
        if (d > bestDist) continue
        // Skip boss-chamber corpses — advs there are committed to the fight.
        const pRoom = this._dungeonGrid?.getRoomAtTile?.(p.tileX, p.tileY)
        if (pRoom?.definitionId === 'boss_chamber') continue
        best = p; bestDist = d
      }
      if (best) {
        EventBus.emit('SAY_lootCorpseStart', { adventurer: adv })
        return { type: 'LOOT_CORPSE', pileId: best.instanceId }
      }
    }

    if (!this._personalitySystem) return { type: 'SEEK_BOSS' }

    // Phase 10 — Echo personality follows the most-recent non-echo party
    // member's tile. If their leader entered a trap, so does the echo.
    const tags = this._personalitySystem.getTags(adv)
    if (tags.has('echo')) {
      const leader = this._gameState.adventurers.active.find(a =>
        a.partyId === adv.partyId && a.instanceId !== adv.instanceId &&
        !this._personalitySystem.getTags(a).has('echo') && a.aiState !== 'dead'
      )
      if (leader) {
        return { type: 'FOLLOW_LEADER', leaderId: leader.instanceId, targetX: leader.tileX, targetY: leader.tileY }
      }
    }

    const visited = new Set(adv.visitedRooms ?? [])
    const unvisited = this._gameState.dungeon.rooms.filter(r =>
      !visited.has(r.instanceId) && r.definitionId !== 'boss_chamber' &&
      // Locked rooms are always skipped now that key-loot is gone.
      !r.locked
    )
    return this._personalitySystem.evaluateGoal(adv, {
      unvisitedRooms: unvisited,
    })
  }

  // Public: called by DayPhase after spawning so the adventurer's first goal
  // reflects their personality (cartographer detours, reckless beelines, etc.)
  // Pre-flee fallback used by _tickAdventurer's pathfinder-failed block.
  // Walks the rooms list and returns the first goal we can actually path
  // to with the adv's current blocked/soft-blocked tile sets — preserving
  // the same lock blocks and trap recoils the original failed call used.
  // Order: unvisited non-boss rooms first (preserves exploration intent),
  // then boss chamber, then visited rooms as a last-resort wander. Returns
  // null only when no goal is reachable at all (truly boxed in).
  _findReachableAlternateGoal(adv, failedTarget, blockedForAdv, softOpts) {
    const rooms = this._gameState.dungeon?.rooms ?? []
    if (rooms.length === 0) return null
    const failedKey = failedTarget ? `${failedTarget.x},${failedTarget.y}` : null
    const visited = new Set(adv.visitedRooms ?? [])
    const skipRoomId = adv.goal?.type === 'EXPLORE_ROOM' ? adv.goal.roomId : null

    const tryRoom = (room) => {
      if (!room || room.locked) return null
      const target = {
        x: room.gridX + Math.floor(room.width / 2),
        y: room.gridY + Math.floor(room.height / 2),
      }
      if (adv.tileX === target.x && adv.tileY === target.y) return null
      if (failedKey && `${target.x},${target.y}` === failedKey) return null
      const p = PathfinderSystem.findPath(
        { x: adv.tileX, y: adv.tileY }, target, this._dungeonGrid, null, 0,
        blockedForAdv, softOpts,
      )
      return (p && p.length > 0) ? target : null
    }

    // Pass 1: unvisited non-boss rooms (shuffled for variety so a party
    // doesn't all converge on the same fallback).
    const unvisited = rooms.filter(r =>
      !visited.has(r.instanceId) &&
      r.instanceId !== skipRoomId &&
      r.definitionId !== 'boss_chamber'
    )
    for (let i = unvisited.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[unvisited[i], unvisited[j]] = [unvisited[j], unvisited[i]]
    }
    for (const room of unvisited) {
      if (tryRoom(room)) {
        return { type: 'EXPLORE_ROOM', roomId: room.instanceId }
      }
    }

    // Pass 2: boss chamber (don't reuse if the original failed goal WAS
    // SEEK_BOSS — pathfinding would just fail the same way again).
    if (adv.goal?.type !== 'SEEK_BOSS') {
      const boss = rooms.find(r => r.definitionId === 'boss_chamber')
      if (boss && tryRoom(boss)) return { type: 'SEEK_BOSS' }
    }

    // Pass 3: visited rooms as a last-resort wander. Better than fleeing
    // — the adv keeps moving and may pick up a new goal naturally next
    // replan.
    const visitedRooms = rooms.filter(r =>
      visited.has(r.instanceId) &&
      r.instanceId !== skipRoomId &&
      r.definitionId !== 'boss_chamber'
    )
    for (const room of visitedRooms) {
      if (tryRoom(room)) {
        return { type: 'EXPLORE_ROOM', roomId: room.instanceId }
      }
    }

    return null
  }

  // Dungeon event: The Saboteur — pick the nearest still-armed trap to
  // disarm, or FLEE once every trap in the dungeon is disabled.
  _nextSaboteurGoal(adv) {
    const traps = (this._gameState.dungeon?.traps ?? []).filter(t => t && !t._disabledThisDay)
    let best = null, bestD = Infinity
    for (const t of traps) {
      const d = Math.hypot((t.tileX ?? 0) - adv.tileX, (t.tileY ?? 0) - adv.tileY)
      if (d < bestD) { bestD = d; best = t }
    }
    return best
      ? { type: 'DISARM_TRAP', trapId: best.instanceId }
      : { type: 'FLEE', reason: 'saboteur_done' }
  }

  pickInitialGoal(adv) {
    // Don't re-explore the spawn room
    const spawnRoom = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    if (spawnRoom) {
      adv.visitedRooms ??= []
      if (!adv.visitedRooms.includes(spawnRoom.instanceId)) {
        adv.visitedRooms.push(spawnRoom.instanceId)
      }
    }
    // Phase 6d: the_fan picks a random minion class to idolize (refuses to attack it).
    if (adv.personalityIds?.includes('the_fan') && !adv.flags?.idolizedMinionClass) {
      const types = this._scene.cache.json.get('minionTypes') ?? []
      const choice = types[Math.floor(Math.random() * types.length)]
      if (choice) {
        adv.flags = adv.flags ?? {}
        adv.flags.idolizedMinionClass = choice.id
      }
    }
    adv.goal = this._pickNextGoal(adv)
    return adv.goal
  }

  // ── Death / despawn ────────────────────────────────────────────────────────

  _kill(adv, idx, killerHint) {
    // Solo Leveling + Light Party — these duel-bound adventurers can ONLY be
    // slain by the boss duel itself. BossSystem._killAdv stamps _lastHitBy='boss'
    // for the duel; that's the sole killer allowed through. Every OTHER lethal
    // source routed to this chokepoint (minions, traps incl. instakill, charm,
    // starvation, pestilence, DoT, stuck-failsafe, …) is refused — they're
    // clamped to 10% max HP and survive. This is the single guarantee that
    // "nothing can kill them until the boss fight"; the per-source HP floors
    // elsewhere are belt-and-suspenders, but THIS is the one that always holds.
    // (Boss ABILITIES like the demon sacrifice never reach _kill; they're
    // floored in BossArchetypeSystem.)
    if ((adv?._shadowMonarch || adv?._lightParty) && (adv._lastHitBy ?? killerHint) !== 'boss') {
      adv.resources = adv.resources ?? {}
      const floor = Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10))
      adv.resources.hp = Math.max(floor, adv.resources.hp ?? floor)
      return
    }
    // Phase 5c — Cleric Resurrection: if a same-party Cleric still has the
    // ability today, revive the falling adv at 30% HP and skip death.
    if (this._scene.classAbilitySystem?.attemptClericResurrect?.(adv)) {
      EventBus.emit('ADVENTURER_RESURRECTED', { adventurer: adv })
      return
    }
    adv.aiState = 'dead'
    adv.resources.hp = 0

    // Death attribution: prefer the most-recent combat-hit source, fall back to hint
    const killerId   = adv._lastHitBy ?? killerHint
    const killerName = this._lookupKillerName(killerId)
    const damageType = adv._lastHitType ?? 'physical'

    // Room redesign 2026-04-30 — Catacombs: if the adv died in a Catacombs
    // room and there are <2 alive Revenants there, raise one Tier-2 garrison.
    const deathRoom = this._dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)
    if (deathRoom?.definitionId === 'catacombs') {
      const aliveRevenants = (this._gameState.minions ?? []).filter(m =>
        m.assignedRoomId === deathRoom.instanceId && m.isCatacombsRevenant && m.aiState !== 'dead'
      ).length
      // Tinkerer's Workshop "Restless Tomb" — cap +1 (3 max) when type
      // is upgraded.
      const revenantCap = (this._gameState._tinkeredRoomTypes ?? []).includes('catacombs') ? 3 : 2
      if (aliveRevenants < revenantCap) {
        const minionTypes = this._scene.cache.json.get('minionTypes') ?? []
        const revenantDef = minionTypes.find(d => d.id === 'skeleton2') ?? minionTypes[0]
        if (revenantDef) {
          const TS = 32
          const tx = adv.tileX, ty = adv.tileY
          const baseStats = revenantDef.baseStats ?? { hp: 50, attack: 10, defense: 5, speed: 1 }
          this._gameState.minions ??= []
          this._gameState.minions.push({
            instanceId:    `revenant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            definitionId:  revenantDef.id,
            name:          'Revenant',
            faction:       'dungeon',
            class:         'garrison',
            isCatacombsRevenant: true,
            assignedRoomId: deathRoom.instanceId,
            behaviorType:  revenantDef.behaviorType ?? 'patrol',
            homeTileX: tx, homeTileY: ty, tileX: tx, tileY: ty,
            worldX: tx * TS + TS / 2, worldY: ty * TS + TS / 2,
            stats: { ...baseStats },
            resources: { hp: baseStats.hp ?? 50, maxHp: baseStats.hp ?? 50 },
            aiState: 'idle', level: 1, xp: 0,
            tags: [...(revenantDef.tags ?? []), 'undead'],
            equippedGear: [], killHistory: [], evolutionHistory: [],
            timesKilledAndRespawned: 0, lastAttackAt: 0, currentTargetId: null,
          })
          EventBus.emit('CATACOMBS_REVENANT_RAISED', {
            roomId: deathRoom.instanceId,
            fromAdv: adv.instanceId,
          })
        }
      }
    }

    // Phase D — if the adv was carrying stolen treasure, refund the
    // player. Loot returns on death; only successful escape costs gold
    // permanently.
    if (adv.stolenGold > 0) {
      this._gameState.player.gold = (this._gameState.player.gold ?? 0) + adv.stolenGold
      EventBus.emit('TREASURE_RECOVERED', { adv, gold: adv.stolenGold })
      adv.stolenGold = 0
    }
    this._gameState.adventurers.active.splice(idx, 1)
    // Held so the kill gold (computed below) can be stamped onto the
    // record after the fact — the post-wave summary reads goldDropped
    // off the graveyard entry.
    const graveEntry = {
      ...adv,
      diedOnDay:  this._gameState.meta.dayNumber,
      killedBy:   killerId,
      killerName,
      damageType,
    }
    this._gameState.adventurers.graveyard.push(graveEntry)
    // Phase: alive AI — drop a loot pile at the death tile. Other advs
    // can roll the LOOT_CORPSE goal to walk over and pick it up. Buff is
    // a small permanent stat boost. Skip if dropped during fade-out.
    this._dropLootPile(adv)

    // Phase 6e: archetype goldGainMultiplier (e.g. Lich 1.2×)
    const arch = this._gameState.player?.archetypeModifiers
    let goldMul = arch?.goldGainMultiplier ?? 1
    // Phase 9: Taxation of Souls reduces gold yield (already-weakened victim)
    const flags = this._gameState._mechanicFlags ?? {}
    if (flags.taxationOfSouls) goldMul *= Balance.MECHANIC_TAXATION_GOLD_PENALTY
    if (flags.goldRush)        goldMul *= Balance.MECHANIC_GOLD_RUSH_GOLD_MULT
    if (flags.famishedDark)    goldMul *= Balance.MECHANIC_FAMISHED_DARK_GOLD_MULT  // DAMNED — kills pay half
    if (flags.crownOfAvarice)  goldMul *= Balance.MECHANIC_AVARICE_GOLD_MULT        // LEGENDARY — gold x2
    if (flags.theIronPrice)    goldMul  = 0                                          // LEGENDARY — no gold income
    if (flags.gildedDemise)    goldMul *= Balance.MECHANIC_GILDED_DEMISE_GOLD_MULT
    if (flags.inquisitorsMark && adv.flags?.inquisitorsMark) {
      goldMul *= Balance.MECHANIC_INQUISITORS_GOLD_MULT
    }
    // Phase 9 — Cursed Soil: +50% gold on kills inside any room.
    if (flags.cursedSoil) {
      const room = this._dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)
      if (room) goldMul *= Balance.MECHANIC_CURSED_SOIL_GOLD_MULT
    }
    if (flags.pyramidScheme) {
      const k = flags.pyramidKillsToday ?? 0
      goldMul *= (k === 0)
        ? Balance.MECHANIC_PYRAMID_FIRST_KILL_MULT
        : Balance.MECHANIC_PYRAMID_REST_KILL_MULT
      flags.pyramidKillsToday = k + 1
    }
    // Dungeon event: Blood Moon Eclipse — no gold from kills today (the
    // empowered minions tear advs apart, but the eclipse's dark glow taints
    // the loot). Pairs with the symmetric 2× damage modifier in CombatSystem.
    if ((this._gameState._eventFlags ?? {}).bloodMoonEclipseActive) goldMul = 0
    // Dungeon event: Tax Season — the guild taxed your treasury at dawn,
    // but the bounties on you pay double: kill gold is doubled.
    if ((this._gameState._eventFlags ?? {}).taxSeasonActive) goldMul *= 2
    // Dungeon event: Loot Goblin Heist — every goblin killed drops a
    // hefty gold pile (5× normal) since the whole point of the event is
    // racing the pack before they escape with the treasury.
    if (adv.classId === 'loot_goblin') goldMul *= 5
    // Dungeon event: Rival Dungeon — rewards on rival-boss kill are
    // owned by RivalBossShowdown (+200 gold + 1 boss level, applied via
    // RESOURCES_AWARDED + BOSS_LEVELED_UP). Suppress the standard kill
    // gold here so rewards don't double-count.
    if (adv._rivalBoss) goldMul = 0
    // Returning veterans are worth double — they've raided before and
    // carry better spoils. Applied after _rivalBoss so a rival boss (which
    // zeroes goldMul) is unaffected; veterans are never rival bosses.
    if (adv.flags?.returningVeteran) goldMul *= 2
    // Bounty hunters are a high-value kill — they came for one of your
    // minions and pay out accordingly.
    if (adv.flags?.bountyHunter) goldMul *= Balance.BOUNTY_HUNTER_GOLD_MULT
    // Dungeon event: PATCH 0.0.0 — "ban bounty". Killing a cheater
    // during the event pays double, framing it as collecting the
    // anti-cheat ban payout. Encourages the player to actually engage
    // with the harder wave instead of turtling.
    if (adv.classId === 'cheater' && (this._gameState._eventFlags ?? {}).patchZeroActive) {
      goldMul *= Balance.PATCH_ZERO_KILL_GOLD_MULT ?? 2.0
    }
    let goldGained = Math.round(Balance.GOLD_PER_KILL * goldMul)
    // Dungeon event: Zombie Horde — flat 2 gold per shambler regardless
    // of pacts / mechanics / events. The horde is 14+ strong, so default
    // kill gold (10/each × bonuses) would pay out wildly more than any
    // normal wave; cap it so the event's reward feels proportionate to
    // the threat. Hard override (not a multiplier) so Goldrush / Cursed
    // Soil / Tax Season etc. don't accidentally re-inflate it.
    if (adv.flags?.zombieShambler) goldGained = 2
    // Dungeon event: Boss Royale — flat 200 gold per slain invader boss
    // (no other bonus, per design). Hard override so pacts / events /
    // veteran mults can't inflate the gauntlet payout beyond the set bounty.
    if (adv._bossRoyaleInvader) goldGained = Balance.BOSS_ROYALE_KILL_GOLD ?? 200
    // Solo Leveling — slaying Sung Jinwoo (only the boss can, in the duel) pays
    // a flat 1000-gold bounty. Hard override so it's exactly 1000 (no pact /
    // event / veteran inflation, and no double with the normal kill gold).
    if (adv._shadowMonarch) goldGained = 1000
    this._gameState.player.gold += goldGained
    this._gameState.player.totalKills++
    // Record the loot drop on both the live adv (the ADVENTURER_DIED
    // payload — DungeonFx's coin-drop float reads it) and the graveyard
    // record (the post-wave summary's per-adventurer "+Ng LOOT" chip).
    adv.goldDropped = goldGained
    graveEntry.goldDropped = goldGained

    EventBus.emit('RESOURCES_AWARDED', {
      gold:   goldGained,
      reason: 'adventurer_kill',
      // World position so the renderer can spawn a coin-burst at the
      // exact death tile instead of a generic "you got gold" toast.
      worldX: adv.worldX,
      worldY: adv.worldY,
    })

    this._awardBossXp()
    // Dungeon event: Patron's Blessing — boss XP from every kill doubled.
    if ((this._gameState._eventFlags ?? {}).patronsBlessingActive) this._awardBossXp()
    // Dungeon event: Legendary Speed Runner — killing the speedrunner
    // grants a *massive* XP windfall (9× the normal kill on top of the
    // base award above = 10× total). Tunes the high-risk encounter into
    // a clear high-reward payoff if the player can actually stop them.
    if (adv._speedrunner) {
      for (let i = 0; i < 9; i++) this._awardBossXp()
    }
    // Rival Dungeon — rewards (gold + level) handled by RivalBossShowdown's
    // ADVENTURER_DIED listener so the standard XP path here stays the
    // base 10 XP per kill, with the +1 level applied separately.

    EventBus.emit('ADVENTURER_DIED', {
      adventurer: adv,
      killerId,
      killerName,
      roomId:     this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId ?? null,
      damageType,
    })
  }

  // Succubus Charm counter — when a charmed adventurer turns on the
  // party, rally every nearby non-charmed ally to hunt the traitor
  // down. Tags them with `flags.charmRetaliateId` + an ATTACK_ALLY goal
  // (which paths them to the traitor); the charm-retaliation engage
  // block in _tickAdventurer makes them swing once in range. They drop
  // the vendetta when the traitor falls.
  _rallyAgainstCharmed(charmed) {
    if (!charmed) return
    const RANGE = 6   // tiles — allies this close notice the betrayal
    for (const o of this._gameState.adventurers.active) {
      if (o === charmed) continue
      if (o.aiState === 'dead' || o.aiState === 'fled' || o.aiState === 'charmed') continue
      // Don't drag a fleeing adventurer back into the brawl.
      if (o.aiState === 'fleeing' || o.goal?.type === 'FLEE') continue
      if ((o.resources?.hp ?? 0) <= 0) continue
      const d = Math.hypot((o.tileX ?? 0) - (charmed.tileX ?? 0),
                           (o.tileY ?? 0) - (charmed.tileY ?? 0))
      if (d > RANGE) continue
      o.flags ??= {}
      o.flags.charmRetaliateId = charmed.instanceId
      if (o.goal?.type !== 'ATTACK_ALLY' || o.goal?.allyId !== charmed.instanceId) {
        o.goal = { type: 'ATTACK_ALLY', allyId: charmed.instanceId, source: 'charm_retaliation' }
        o.path = null
      }
    }
  }

  // ── Succubus charm — adv hunts a former ally and attacks them ───────────
  //
  // Set when the Succubus boss applies CHARM (BossArchetypeSystem._tickSuccubus).
  // The adv is detached from their party (partyId=null), aiState='charmed',
  // and has _charmedKills=0, _charmedAloneTimer=0. They home in on the nearest
  // non-charmed living adv and deal damage tick-by-tick. After they kill one
  // ally — OR spend 5s with no targets — they collapse dead.
  _tickCharmedAdv(adv, delta, idx) {
    // Already killed an ally → drop dead now.
    if ((adv._charmedKills ?? 0) >= 1) {
      this._kill(adv, idx, adv._charmerId ?? 'succubus_charm')
      return
    }
    // Find the nearest other living, non-charmed adv to attack
    const active = this._gameState.adventurers.active
    let target = null, bestD = Infinity
    for (const o of active) {
      if (o === adv) continue
      if (o.aiState === 'dead' || o.aiState === 'fleeing' || o.aiState === 'fled' || o.aiState === 'charmed') continue
      if ((o.resources?.hp ?? 0) <= 0) continue
      const d = Math.hypot((o.tileX ?? 0) - adv.tileX, (o.tileY ?? 0) - adv.tileY)
      if (d < bestD) { bestD = d; target = o }
    }
    if (!target) {
      // No allies left → wander dazed, collapse after 5s
      adv._charmedAloneTimer = (adv._charmedAloneTimer ?? 0) + delta
      if (adv._charmedAloneTimer >= 5000) {
        this._kill(adv, idx, adv._charmerId ?? 'succubus_charm')
      }
      return
    }
    adv._charmedAloneTimer = 0
    // The charmed adv has turned on the party — rally nearby allies to
    // cut the traitor down before they land a kill.
    this._rallyAgainstCharmed(adv)
    // Adjacent? Apply damage tick. Otherwise pathfind toward the target.
    const dx = target.tileX - adv.tileX
    const dy = target.tileY - adv.tileY
    const cheb = Math.max(Math.abs(dx), Math.abs(dy))
    if (cheb <= 1) {
      // Face the victim so the attack animation plays in the right direction
      const adx = Math.abs(target.worldX - adv.worldX)
      const ady = Math.abs(target.worldY - adv.worldY)
      adv._lpcDir = (adx > ady)
        ? (target.worldX > adv.worldX ? 'right' : 'left')
        : (target.worldY > adv.worldY ? 'down'  : 'up')

      // Damage tick — every 400 ms hit for full adv.attack so kills land
      // in a few seconds, not half a minute.
      adv._charmedAtkAcc = (adv._charmedAtkAcc ?? 0) + delta
      if (adv._charmedAtkAcc >= 400) {
        adv._charmedAtkAcc = 0
        const dmg = Math.max(1, Math.round(adv.stats?.attack ?? 6))
        target.resources.hp = Math.max(0, (target.resources.hp ?? 0) - dmg)
        target._lastHitBy   = adv.instanceId
        // COMBAT_HIT drives AdventurerRenderer's attack-anim trigger
        // (slash / thrust / spellcast / shoot per class). Same event
        // shape as minion-vs-adv hits.
        EventBus.emit('COMBAT_HIT', {
          sourceId:   adv.instanceId,
          targetId:   target.instanceId,
          damage:     dmg,
          damageType: 'physical',
        })
        EventBus.emit('CHARMED_ATTACK', {
          attackerId: adv.instanceId, victimId: target.instanceId, dmg,
        })
        if (target.resources.hp <= 0) {
          // Mark this adv's kill so next charmed-tick drops them dead.
          adv._charmedKills = (adv._charmedKills ?? 0) + 1
        }
      }
      return
    }
    // Path toward the target. Re-path every ~300 ms so the charmed adv
    // tracks a moving target rather than walking to where they USED to be.
    const now = this._scene?.time?.now ?? 0
    const lastPathAt = adv._charmedPathAt ?? 0
    const needsPath = !adv.path || adv.pathIndex == null || adv.pathIndex >= adv.path.length
                    || (now - lastPathAt) > 300
    if (needsPath) {
      // Try direct path first; if pathfinder rejects the target tile (some
      // builds treat occupied tiles as unwalkable), retry with each of the
      // 8 adjacent tiles as the destination.
      let path = PathfinderSystem.findPath(
        { x: adv.tileX, y: adv.tileY },
        { x: target.tileX, y: target.tileY },
        this._dungeonGrid, null, 0, null,
      )
      if (!path || path.length < 2) {
        const offsets = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]
        for (const [ox, oy] of offsets) {
          path = PathfinderSystem.findPath(
            { x: adv.tileX, y: adv.tileY },
            { x: target.tileX + ox, y: target.tileY + oy },
            this._dungeonGrid, null, 0, null,
          )
          if (path && path.length >= 2) break
        }
      }
      if (path && path.length > 1) {
        adv.path = path
        adv.pathIndex = 1   // skip the starting tile
        adv._charmedPathAt = now
      }
    }
    // Walk along the path. Use the same straight-line stepper the other
    // states use so the renderer's worldX/worldY remain accurate.
    if (adv.path && adv.pathIndex < adv.path.length) {
      const wp = adv.path[adv.pathIndex]
      const targetWX = wp.x * TS + TS / 2
      const targetWY = wp.y * TS + TS / 2
      const ddx = targetWX - adv.worldX, ddy = targetWY - adv.worldY
      const dist = Math.hypot(ddx, ddy) || 1
      // Speed: same formula the regular adv movement uses upstream —
      // adv.stats.speed × TS × delta / 1000 (px/frame). The earlier
      // version multiplied by Balance.ADVENTURER_BASE_SPEED, which
      // doesn't exist — every step computed NaN and the charmed adv
      // never moved.
      const stepPx = ((adv.stats?.speed ?? 1) * TS * delta) / 1000
      if (dist <= stepPx) {
        adv.worldX = targetWX
        adv.worldY = targetWY
        adv.tileX  = wp.x
        adv.tileY  = wp.y
        adv.pathIndex++
      } else {
        adv.worldX += (ddx / dist) * stepPx
        adv.worldY += (ddy / dist) * stepPx
        adv.tileX = Math.floor(adv.worldX / TS)
        adv.tileY = Math.floor(adv.worldY / TS)
      }
    }
  }

  // Award boss XP on each kill and level up when xpToNext is reached.
  // Curve: xpToNext for level N = BOSS_XP_BASE * BOSS_XP_SCALE^(N-1).
  _awardBossXp() {
    const boss = this._gameState.boss
    if (!boss) return
    // Tinkerer's Workshop "Oracle's Tome" — +1 boss XP per kill per
    // active Library when the library_of_whispers type is upgraded.
    // Cumulative — more libraries = more bonus XP.
    let bonus = 0
    if ((this._gameState._tinkeredRoomTypes ?? []).includes('library_of_whispers')) {
      bonus = (this._gameState.dungeon?.rooms ?? [])
        .filter(r => r.definitionId === 'library_of_whispers' && r.isActive !== false).length
    }
    boss.xp = (boss.xp ?? 0) + Balance.BOSS_XP_PER_KILL + bonus
    while (boss.xp >= (boss.xpToNext ?? Balance.BOSS_XP_BASE)) {
      boss.xp -= boss.xpToNext
      const oldLevel = boss.level ?? 1
      boss.level = oldLevel + 1
      boss.xpToNext = this._xpToNextLevel(boss.level)
      // BOSS_LEVELED_UP — celebratory listeners (achievements, chat
      // bubbles, level-up overlay, grid expansion). Fires ONLY on up.
      EventBus.emit('BOSS_LEVELED_UP', { newLevel: boss.level })
      // BOSS_LEVEL_CHANGED — bidirectional listeners (BuildMenu re-
      // render, minion rescale, archetype-system live recompute).
      // The Demon's Wager event emits this with delta=-1 to drive
      // level-DOWN behaviour without firing the celebratory listeners.
      EventBus.emit('BOSS_LEVEL_CHANGED', { newLevel: boss.level, oldLevel, delta: +1 })
    }
  }

  _xpToNextLevel(currentLevel) {
    // Round UP to the nearest 10 so the threshold always aligns with the
    // XP-per-kill granularity (10 per kill). Without this, a level cap of
    // e.g. 113 means the boss levels up at exactly 120 XP anyway, but the
    // displayed threshold doesn't match the kill cadence.
    const raw = Balance.BOSS_XP_BASE * Math.pow(Balance.BOSS_XP_SCALE, currentLevel - 1)
    return Math.ceil(raw / 10) * 10
  }

  _lookupKillerName(killerId) {
    if (!killerId) return 'Unknown'
    // Self-inflicted / cause-only deaths (no entity killer). The starvation
    // failsafe culls advs stuck looping rooms; credit "Starvation" so the
    // graveyard reads "killed by Starvation" rather than "Unknown".
    if (killerId === 'starvation') return 'Starvation'
    if (killerId === 'boss') {
      const archId = this._gameState.player?.bossArchetypeId
      const arch   = this._scene.cache.json.get('bossArchetypes')
        ?.find(a => a.id === archId)
      return arch?.name ?? 'The Boss'
    }
    // Trap?
    const trap = this._gameState.dungeon?.traps?.find(t => t.instanceId === killerId)
    if (trap) {
      return this._scene.cache.json.get('trapTypes')
        ?.find(d => d.id === trap.definitionId)?.name ?? trap.definitionId
    }
    // Minion?
    const m = this._gameState.minions.find(x => x.instanceId === killerId)
    if (m) return m.name ?? this._scene.cache.json.get('minionTypes')
      ?.find(d => d.id === m.definitionId)?.name ?? m.definitionId
    // Bug fix — adventurer killer (e.g. Hall of Madness frenzy). Fall back to
    // the active list, then the graveyard for killers who died after their target.
    const adv = this._gameState.adventurers.active.find(a => a.instanceId === killerId) ??
                this._gameState.adventurers.graveyard.find(a => a.instanceId === killerId)
    if (adv) return `${adv.name ?? 'A Rival'} (rival adventurer)`
    return 'Unknown'
  }

  _despawn(adv, idx, reason) {
    adv.aiState = 'fled'
    this._gameState.adventurers.active.splice(idx, 1)
    EventBus.emit('ADVENTURER_FLED', {
      adventurer: adv,
      reason,
      context: adv.goal?.context ?? null,
    })
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  // Pick a spawn tile for a new adventurer.
  // Strategy: walk outward from each room's connection point until we find a
  // walkable tile that has a path back to the boss. Falls back to the deepest
  // room's centre. Returns null if dungeon is unreachable from outside.
  // Adventurers always enter through the Entry Hall — that's the contract.
  // ── Entry halls ───────────────────────────────────────────────────────────
  //
  // The dungeon has 1-3 entry halls (a 2nd is forced at boss level 5, a 3rd
  // at level 10). Adventurers spawn from — and flee to — any of them.

  // Every entry-hall room in the dungeon.
  _entryHalls() {
    return (this._gameState.dungeon?.rooms ?? [])
      .filter(r => r.definitionId === 'entry_hall')
  }

  // The entry hall closest to `adv` (straight-line). A fleeing adventurer
  // runs for the nearest exit, not always the first-placed one.
  _nearestEntryHall(adv) {
    let best = null, bestD = Infinity
    for (const e of this._entryHalls()) {
      const door = entryDoorTile(e)
      const d = Math.hypot((adv.tileX ?? 0) - door.x, (adv.tileY ?? 0) - door.y)
      if (d < bestD) { bestD = d; best = e }
    }
    return best
  }

  // Door tile of the entry hall a fleeing / escaping adventurer is heading
  // for. Locks onto the nearest entry hall the first time it's asked
  // (stored as goal.fleeEntryId) so the target stays stable even as the
  // adventurer moves between two equidistant exits. Returns null if there
  // are no entry halls at all.
  _fleeExitTile(adv) {
    // False Exit detour (2026-05-27). When _setFleeGoal rolled the 50%
    // false-exit flee, head for that room's center first — entering it
    // fires RoomBehaviorSystem's teleport, which scatters the adv to a
    // random room and clears `fleeViaFalseExitId`, after which this
    // falls through to a real entry hall. If the false exit was removed
    // (sold / dungeon edit) mid-flee, drop the flag and flee normally.
    const feId = adv.goal?.fleeViaFalseExitId
    if (feId) {
      const fe = (this._gameState.dungeon?.rooms ?? []).find(r =>
        r.instanceId === feId && r.definitionId === 'false_exit' && r.isActive !== false)
      if (fe) {
        return {
          x: fe.gridX + Math.floor(fe.width  / 2),
          y: fe.gridY + Math.floor(fe.height / 2),
        }
      }
      if (adv.goal) adv.goal.fleeViaFalseExitId = null
    }
    const halls = this._entryHalls()
    if (halls.length === 0) return null
    let entry = adv.goal?.fleeEntryId
      ? halls.find(e => e.instanceId === adv.goal.fleeEntryId)
      : null
    if (!entry) {
      entry = this._nearestEntryHall(adv)
      if (entry && adv.goal) adv.goal.fleeEntryId = entry.instanceId
    }
    return entry ? entryDoorTile(entry) : null
  }

  // Returns a spawn-door tile for a fresh adventurer, or null (no entry
  // halls — caller should block day-start). Picks UNIFORMLY at random
  // from every placed entry hall — DayPhase calls this once per adventurer,
  // so a wave naturally splits across every entrance.
  //
  // No A* path filter (was: silently dropped entries whose doorway tile
  // A* couldn't path from to the boss). Subtle gating in the pathfinder
  // — door-lane convention, decor, traps, the start tile sometimes
  // landing on the non-canonical column of a 2-tile-wide doorway — was
  // dropping one of two perfectly usable entries and funneling whole
  // waves through the other. The day-start gate already enforces
  // dungeon-wide reachability via the doorway graph; trust it. If an
  // individual adv really can't path from their spawn the AI's normal
  // flee / stuck-in-wall handlers take over (same fallback DayPhase
  // already uses when pickSpawnTile returns null).
  pickSpawnTile() {
    const halls = this._entryHalls()
    if (halls.length === 0) return null
    const entry = halls[Math.floor(Math.random() * halls.length)]
    return entryDoorTile(entry)
  }

}

function _pointInRoom(tx, ty, room) {
  return tx >= room.gridX && tx < room.gridX + room.width &&
         ty >= room.gridY && ty < room.gridY + room.height
}

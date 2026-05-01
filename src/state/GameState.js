import { Balance } from '../config/balance.js'
import { DungeonGrid } from '../systems/DungeonGrid.js'

// Boss chamber definition (must match src/data/rooms.json)
const BOSS_CHAMBER_DEF = {
  id: 'boss_chamber',
  width: 14,
  height: 14,
  connectionPoints: [{ x: 6, y: 0, direction: 'N' }],
  upkeepCost: 0,
  placementRules: { fixed: false, maxPerDungeon: 1 }, // fixed:false so _writeTiles runs
  tags: ['boss', 'special', 'fixed'],
}

export function createGameState(bossArchetypeId = 'the_lich', roomDefs = null) {
  const gw = Balance.STARTING_GRID_WIDTH
  const gh = Balance.STARTING_GRID_HEIGHT

  const dungeon = {
    gridWidth: gw,
    gridHeight: gh,
    tiles: _createEmptyGrid(gw, gh),
    rooms: [],
    corridors: [],
    traps: [],
    activeMechanics: [],
    expansions: [],
  }

  // Pre-place boss chamber at grid center. Pull `theme` + `tileLayout` from
  // the rooms.json cache (if the caller passed it) so per-cell paints made
  // in the Room Editor land on the boss chamber too. Other fields stay
  // pinned to BOSS_CHAMBER_DEF — we don't want a stale/empty
  // connectionPoints from rooms.json overriding the bootstrap value.
  const grid = new DungeonGrid(dungeon)
  const cacheBoss = Array.isArray(roomDefs)
    ? roomDefs.find(r => r.id === 'boss_chamber')
    : null
  const def = { ...BOSS_CHAMBER_DEF }
  if (cacheBoss) {
    if (typeof cacheBoss.theme === 'string') def.theme = cacheBoss.theme
    if (Array.isArray(cacheBoss.tileLayout) && cacheBoss.tileLayout.length) {
      def.tileLayout = cacheBoss.tileLayout
    }
  }
  const bx = Math.floor((gw - def.width) / 2)
  const by = Math.floor((gh - def.height) / 2)
  const bossRoom = grid.placeRoom(def, bx, by,
    { noSnap: true, allowFixed: true, allowDisconnected: true })
  if (bossRoom) {
    bossRoom.definitionId = 'boss_chamber' // ensure correct id
  }

  return {
    meta: {
      version: '1.0.0',
      dayNumber: 1,
      dungeonLevel: 1,
      bossDefeatedCount: 0,
      reputation: 0,
      runId: _generateRunId(),
      phase: 'night',
    },
    player: {
      bossArchetypeId,
      bossEvolution: {
        unlockedAbilities: [],
        appliedEvolutions: [],
      },
      soulEssence: Balance.STARTING_SOUL_ESSENCE,
      darkPower: Balance.STARTING_DARK_POWER,
      totalKills: 0,
      totalDaysElapsed: 0,
    },
    dungeon,
    minions: [],
    adventurers: {
      active: [],
      known: [],
      graveyard: [],
    },
    guilds: [],
    loot: {
      dungeon: [],
      minionEquipment: {},
    },
    history: {
      days: [],
      events: [],
      // Per-day Dark Pact picks. Populated by EndOfDay when a mechanic seals.
      // Shape: [{ day, mechanicId, rarity }]. Game Over (Phase 31H) timeline reads this.
      pacts: [],
    },
    // Run-wide rolling counters. RunHistorySystem updates these as events fire;
    // Game Over / Post-Wave Summary screens read them. Plain integers so the
    // whole gameState stays JSON-serializable.
    run: {
      startedAt: Date.now(),
      totals: {
        kills:            0,   // adventurers slain by anything in the dungeon
        dmgDealt:         0,   // damage minions/traps/boss inflicted on advs
        dmgTaken:         0,   // damage advs inflicted on minions/boss
        advsKilled:       0,   // alias of kills, kept distinct in case mimics start counting separately
        advsEscaped:      0,
        gold:             0,   // cumulative soul-essence (gold) earned across the run
        souls:            0,   // cumulative dark-power gained across the run
        roomsBuilt:       0,
        roomsDestroyed:   0,
        minionsSummoned:  0,
        minionsLost:      0,
        trapsPlaced:      0,
        trapsDisarmed:    0,
      },
    },
    knowledge: {
      sharedPool: { rooms: {}, traps: {}, enemiesPerRoom: {}, loot: {} },
      survivors: [],
      partyWipeOccurred: false,
    },
    unlocks: {
      // Synced with src/data/rooms.json (Room redesign 2026-04-30).
      // Boss-level gating via room.unlockLevel is a separate phase — for now everything is in the allowlist.
      rooms: [
        'boss_chamber', 'entry_hall',
        'starter_corridor', 'starter_barracks', 'starter_guard_post',
        'crypt',
        'trap_factory', 'treasury', 'armory',
        'library_of_whispers',
        'watchtower',
        'wandering_gate', 'veil_of_forgetting',
        'catacombs', 'mimic_vault', 'hall_of_trials',
        'wishing_well', 'false_exit',
        'hall_of_madness', 'throne_room',
        'sanctum',
      ],
      minionTypes: [
        'beholder1', 'beholder2',
        'demon1', 'demon2',
        'elder_slime1', 'elder_slime2', 'elder_slime3',
        'ent1', 'ent2', 'ent3',
        'ghost1', 'ghost2',
        'gnoll1', 'gnoll2',
        'goblin1', 'goblin2', 'goblin3',
        'golem1', 'golem2',
        'imp1', 'imp2', 'imp3',
        'lich1', 'lich2',
        'lizardman1', 'lizardman2',
        'mushroom1', 'mushroom2',
        'orc1', 'orc2',
        'plant1', 'plant2', 'plant3',
        'rat1', 'rat2', 'rat3',
        'skeleton1', 'skeleton2', 'skeleton3',
        'slime1', 'slime2', 'slime3', 'slime4', 'slime5', 'slime6', 'slime7', 'slime8', 'slime9',
        'vampire_minion1', 'vampire_minion2',
        'zombie1', 'zombie2', 'zombie3',
        'mimic',
      ],
      trapTypes: [],
      dungeonMechanics: [],
      bossAbilities: [],
      archetypes: ['the_lich', 'the_architect', 'the_beast_lord', 'the_trickster', 'the_tyrant'],
    },
  }
}

function _createEmptyGrid(width, height) {
  return Array.from({ length: height }, () => new Array(width).fill(0))
}

function _generateRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

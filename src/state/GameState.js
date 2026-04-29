import { Balance } from '../config/balance.js'
import { DungeonGrid } from '../systems/DungeonGrid.js'

// Boss chamber definition (must match src/data/rooms.json)
const BOSS_CHAMBER_DEF = {
  id: 'boss_chamber',
  width: 12,
  height: 12,
  connectionPoints: [{ x: 5, y: 0, direction: 'N' }],
  upkeepCost: 0,
  placementRules: { fixed: false, maxPerDungeon: 1 }, // fixed:false so _writeTiles runs
  tags: ['boss', 'special', 'fixed'],
}

export function createGameState(bossArchetypeId = 'the_lich') {
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

  // Pre-place boss chamber at grid center
  const grid = new DungeonGrid(dungeon)
  const bx = Math.floor((gw - BOSS_CHAMBER_DEF.width) / 2)
  const by = Math.floor((gh - BOSS_CHAMBER_DEF.height) / 2)
  const bossRoom = grid.placeRoom(BOSS_CHAMBER_DEF, bx, by,
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
    },
    knowledge: {
      sharedPool: { rooms: {}, traps: {}, enemiesPerRoom: {}, loot: {} },
      survivors: [],
      partyWipeOccurred: false,
    },
    unlocks: {
      rooms: [
        'boss_chamber',
        'starter_barracks', 'starter_corridor', 'starter_guard_post', 'entry_hall',
        'crypt', 'trap_room', 'healing_fountain', 'armory', 'prison_block', 'serpent_pit',
        'hall_of_echoes', 'mirror_maze', 'lava_floor', 'collapsing_pillars',
        'obelisk_room', 'secret_passage', 'power_core',
        'necropolis_wing', 'colosseum', 'false_exit',
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
      ],
      trapTypes: ['spike_trap', 'arrow_trap', 'pitfall_trap', 'patience_trap', 'speed_trap', 'mercy_trap', 'echo_mine', 'curse_brand_trap', 'greed_trap', 'whisper_trap', 'torch_trap'],
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

// Runtime adventurer entity factory.
// Adventurers are plain JS objects in gameState.adventurers.active so they survive serialization.
// Phase 4: minimal stats + path state. Personality, knowledge, party come in later phases.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

const FIRST_NAMES = [
  'Aldric', 'Brenna', 'Cael', 'Dara', 'Eryn', 'Fenn', 'Galia', 'Halric',
  'Iona', 'Joren', 'Kaeda', 'Lyra', 'Maric', 'Nyssa', 'Oren', 'Petra',
  'Quill', 'Roen', 'Sable', 'Tovald', 'Una', 'Varic', 'Wren', 'Xandra',
  'Yorn', 'Zev',
]

const SURNAMES = [
  'Ashbrook', 'Brightblade', 'Crowmoor', 'Dunhollow', 'Emberfall',
  'Frostvale', 'Greycairn', 'Hollowstone', 'Ironvein', 'Jorisbane',
  'Kessler', 'Lanthorn', 'Marrowick', 'Northway', 'Oldroot', 'Penmark',
]

function _generateName() {
  const f = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const s = SURNAMES[Math.floor(Math.random()  * SURNAMES.length)]
  return `${f} ${s}`
}

function _uid() {
  return `adv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function createAdventurer(classDef, spawnTile, dungeonLevel = 1) {
  const baseStats = classDef.baseStats ?? {}
  const colorInt  = parseInt(classDef.color, 16) || 0xaabbcc

  return {
    instanceId:    _uid(),
    name:          _generateName(),
    classId:       classDef.id,
    classColor:    colorInt,
    personalityIds: [], // Phase 5
    partyId:       null,

    // Position — both tile (logical) and world (smooth render)
    tileX:   spawnTile.x,
    tileY:   spawnTile.y,
    worldX:  spawnTile.x * TS + TS / 2,
    worldY:  spawnTile.y * TS + TS / 2,
    // Original spawn tile — used as the FLEE goal target (where they came in)
    spawnTileX: spawnTile.x,
    spawnTileY: spawnTile.y,

    // Stats (cloned from definition)
    stats: { ...baseStats },

    resources: {
      hp:      baseStats.hp ?? 30,
      maxHp:   baseStats.hp ?? 30,
      mana:    classDef.startingResources?.mana    ?? null,
      maxMana: classDef.startingResources?.mana    ?? null,   // regen caps here
      arrows:  classDef.startingResources?.arrows  ?? null,
      potions: classDef.startingResources?.potions ?? 0,
    },

    // Knowledge (Phase 8 will fill this in)
    knowledge: { rooms: {}, traps: {}, minions: {} },

    gear:       [],
    gold:       0,

    goal:       { type: 'SEEK_BOSS' },
    goalStack:  [],
    aiState:    'walking', // "walking" | "fleeing" | "fighting" | "dead"

    // Phase 4 path state (transient but serializable)
    path:       null,      // array of { x, y } waypoints
    pathIndex:  0,
    pathTarget: null,      // { x, y } the path was generated for (invalidate when goal moves)

    // Phase 5 — rooms this adventurer has entered (drives EXPLORE_ROOM picking)
    visitedRooms: [],
    activeCombos: [],      // combo IDs currently affecting this adventurer

    flags:      {},

    // Render hint — replaced by sprite in tileset phase
    sigil: classDef.id[0].toUpperCase(),
  }
}

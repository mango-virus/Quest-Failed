// Runtime adventurer entity factory.
// Adventurers are plain JS objects in gameState.adventurers.active so they survive serialization.
// Phase 4: minimal stats + path state. Personality, knowledge, party come in later phases.

import { Balance } from '../config/balance.js'
import { generateCheaterName } from '../util/cheaterNames.js'

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

  // Cheater class overrides the fantasy-name roll with a procedural
  // leet-speak handle (xX_d4rk_l0rd_Xx, n0sc0pe, etc.) so they read
  // instantly as an online-gamer skid rather than a noble adventurer.
  const rolledName = classDef.id === 'cheater' ? generateCheaterName() : _generateName()

  return {
    instanceId:    _uid(),
    name:          rolledName,
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

    // Top-level attack range — read by AISystem._findEngageableMinion and
    // CombatSystem.tryAttack. Mirrors Minion entity convention. Mage / Cleric /
    // Necromancer / Bard / Ranger are ranged via baseStats.attackRange in
    // adventurerClasses.json; everyone else defaults to 1 tile (melee).
    attackRange: baseStats.attackRange ?? 1,

    resources: {
      hp:      baseStats.hp ?? 30,
      maxHp:   baseStats.hp ?? 30,
      arrows:  classDef.startingResources?.arrows  ?? null,
    },

    // Per-instance ability cooldowns + per-day usage budgets.
    // Format: cooldowns[abilityId] = nextReadyAt (game-time ms);
    //         usesLeftToday[abilityId] = number remaining (refilled at day start).
    // AbilitySystem reads/writes these. Save-stable plain objects.
    cooldowns:     {},
    usesLeftToday: {},

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

    // Nerve / morale (AI overhaul 2026-06-10). `nerve` (0–100) is the inner
    // morale value NerveSystem drives from dungeon events; `mood` is the derived
    // band ('bold'|'steady'|'wary'|'spooked'|'breaking'). Both SERIALIZE (a
    // spooked adventurer stays spooked on Continue — do NOT add to the SaveSystem
    // transient strip). Seeded to the personality baseline on the first NerveSystem
    // tick (personalityIds aren't known here at creation), so 100/steady are just
    // placeholders until then; `_nerveSeeded` guards the one-time seed.
    nerve:        100,
    mood:         'steady',

    flags:      {},

    // Lifetime escape count for this *named identity* (Phase 31I — UI overhaul).
    // Per-instance starting value; RunHistorySystem reconciles to the
    // gameState.adventurers.known entry on flee so a returning adventurer
    // accumulates across visits. Game Over's "biggest leak" panel reads
    // the known-list value, not this one.
    escapeCount: 0,

    // Render hint — replaced by sprite in tileset phase
    sigil: classDef.id[0].toUpperCase(),
  }
}

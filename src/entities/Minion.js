// Runtime minion entity factory.
// Plain JS objects so they serialize via SaveSystem.
// Each minion is "homed" to a room (assignedRoomId) — its patrol/guard radius
// is centred on that room. CombatSystem reads stats; MinionAISystem reads
// behaviorType + assignedRoomId; MinionRenderer reads tile/world pos + hp.

import { Balance }         from '../config/balance.js'
import { MinionAbilities } from '../systems/MinionAbilities.js'

const TS = Balance.TILE_SIZE

function _uid() {
  return `min_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function _parseColor(c) {
  if (typeof c === 'number') return c
  if (typeof c === 'string') {
    const s = c.startsWith('0x') || c.startsWith('0X') ? c.slice(2) : c
    const n = parseInt(s, 16)
    if (!Number.isNaN(n)) return n
  }
  return 0xbbbbbb
}

export function applyMinionScaling(minion, bossLevel, day = 1) {
  // Defensive: a minion missing its stats/resources block (malformed or
  // legacy entry) would throw here and take down the whole dawn rescale pass
  // (respawnAll → _dawnRefresh), silently killing the day's spawn pipeline.
  // Skip such an entry instead of crashing.
  if (!minion || !minion.stats || !minion.resources) return minion
  // Record base stats on first call so repeated rescales don't stack.
  if (minion._baseMaxHp == null) {
    minion._baseMaxHp = minion.resources.maxHp
    minion._baseAtk   = minion.stats.attack
  }
  const lvOver  = Math.max(0, (bossLevel ?? 1) - 1)
  const dayOver = Math.max(0, (day ?? 1) - 1)
  // Sacrificial Altar reward — accumulator on player._altarMinionStatBuff
  // (stamped by EventSystem._resolveSacrificialAltar). Multiplies every
  // minion's final maxHp + attack so the bargain compounds across multiple
  // altar accepts and applies to future placements automatically. Read
  // lazily via window.__game so this module stays gameState-free.
  let altarBuff = 0
  // Damned-pact minion-HP curses, read lazily from gameState (same global
  // lookup as the altar buff so this module stays gameState-free):
  //   Pact of Glass halves max HP; The Wasting sheds 5%/day (compounding).
  let curseHpMul = 1
  try {
    const scenes = (typeof window !== 'undefined' ? window.__game?.scene?.scenes : null) ?? []
    const gs = scenes.find(s => s?.gameState)?.gameState
    altarBuff = gs?.player?._altarMinionStatBuff ?? 0
    const f = gs?._mechanicFlags ?? {}
    if (f.pactOfGlass) curseHpMul *= (Balance.MECHANIC_GLASS_HP_MULT ?? 0.5)
    if (f.theWasting && (f.wastingDays ?? 0) > 0) {
      curseHpMul *= Math.pow(1 - (Balance.MECHANIC_WASTING_HP_LOSS_PER_DAY ?? 0.05), f.wastingDays)
    }
  } catch { /* no global available — non-fatal */ }
  const altarMul = 1 + altarBuff
  const hpMult  = (1 + Balance.MINION_HP_PER_BOSS_LV  * lvOver + Balance.MINION_HP_PER_DAY  * dayOver) * altarMul * curseHpMul
  const atkMult = (1 + Balance.MINION_ATK_PER_BOSS_LV * lvOver + Balance.MINION_ATK_PER_DAY * dayOver) * altarMul
  minion.resources.maxHp = Math.round(minion._baseMaxHp * hpMult)
  minion.resources.hp    = minion.resources.maxHp
  minion.stats.attack    = Math.round(minion._baseAtk   * atkMult)
  minion.bossLevel       = bossLevel ?? 1
  minion._scaledDay      = day ?? 1
}

// Backward-compat alias used by older callsites that don't have day context.
export function applyBossLevelToMinion(minion, bossLevel) {
  applyMinionScaling(minion, bossLevel, minion._scaledDay ?? 1)
}

export function createMinion(typeDef, tile, assignedRoomId, options = {}) {
  const baseStats = typeDef.baseStats ?? {}
  const colorInt  = _parseColor(typeDef.color)

  const minion = {
    instanceId:    _uid(),
    definitionId:  typeDef.id,
    name:          null,                 // populated on first level-up (Phase 7)
    color:         colorInt,
    sigil:         typeDef.id[0]?.toUpperCase() ?? 'M',

    // Position
    tileX:   tile.x,
    tileY:   tile.y,
    worldX:  tile.x * TS + TS / 2,
    worldY:  tile.y * TS + TS / 2,
    homeTileX: tile.x,
    homeTileY: tile.y,

    // Identity / lineage
    assignedRoomId,
    // 'roster' = produced by Barracks; counts toward Barracks cap; can patrol/follow.
    // 'garrison' = produced by Crypt/Catacombs/etc; room-bound; does NOT count toward cap.
    class:         options.class ?? 'roster',
    behaviorType:  typeDef.behaviorType ?? 'guard',
    tags:          typeDef.tags ?? [],
    damageType:    baseStats.damageType ?? 'physical',
    attackRange:   baseStats.attackRange ?? 1,  // 1 = melee, >1 = ranged

    // Phase 6d: faction (defection mechanics)
    //   'dungeon'    = loyal to player; attacks adventurers and 'adventurer' minions
    //   'adventurer' = defected; attacks 'dungeon' minions, follows nearest adventurer
    faction:       'dungeon',
    factionExpiresOn: null,    // day number when temp-defection ends (null = permanent)
    raisedByAdvId: null,       // necromancer who raised this corpse, if any
    tamedByAdvId:  null,       // beast_tamer who tamed this minion, if any

    // Phase 7b: mini-boss flag — set when placed in a treasure room.
    // Boosts stats and guarantees a high-tier drop on death.
    isMiniBoss:    false,

    // Stats (cloned from definition)
    stats: {
      hp:      baseStats.hp ?? 20,
      attack:  baseStats.attack ?? 5,
      defense: baseStats.defense ?? 0,
      speed:   baseStats.speed ?? 1.0,
      abilities: [...(baseStats.abilities ?? [])],
    },

    resources: {
      hp:    baseStats.hp ?? 20,
      maxHp: baseStats.hp ?? 20,
    },

    // Progression
    level:           1,
    xp:              0,
    evolutionHistory: [],
    killHistory:     [],

    // Lifetime stats (Phase 31I — UI overhaul). killHistory.length tracks the
    // same kill count, but a flat counter is cheaper for HUD/Roster reads and
    // damageDealt has no other home.
    lifetime: { kills: 0, damageDealt: 0 },

    // Equipment + bounty (Phase 7+)
    equippedGear:     [],
    hasBounty:        false,
    bountyKillCount:  0,

    // Transient AI / combat state
    aiState:         'idle',   // 'idle' | 'engaging' | 'returning' | 'dead'
    currentTargetId: null,
    lastAttackAt:    0,        // timestamp of last attack (for cooldown)
    deathDay:        null,     // day number when it last died (respawn at next night)

    // Path state for chasing
    path:       null,
    pathIndex:  0,

    // Boss level at which this minion was last scaled
    bossLevel:  1,
  }

  // Mimic — every mimic spawn (player-built or Mimic Vault) starts in
  // chest disguise. The mimic poses as a random Treasure Chest tier (1-10)
  // — visible to the player as a red-tinted chest so they can position it
  // tactically, but to adventurers it reads as an ordinary chest. State
  // machine:
  //   'chest'  — disguised, ready to spring. Stationary. Untargetable
  //              by advs unless they know (knowledge.mimics[id]).
  //   'sprung' — open animation played + an adv was instantly killed.
  //              Stays open visually until NIGHT_PHASE_STARTED reset.
  //   ('dead' is the standard aiState path when a knowledgeable adv
  //   kills the mimic via direct combat.)
  if (typeDef.id === 'mimic') {
    minion.isMimic    = true
    minion.mimicState = 'chest'
    minion.chestTier  = 1 + Math.floor(Math.random() * 10)   // 1..10 random tier
  }

  if (options.bossLevel || options.dayNumber) {
    applyMinionScaling(minion, options.bossLevel ?? 1, options.dayNumber ?? 1)
  }

  // Pass-1 ability flag setup — currently arms Lizardman Camouflage at spawn
  // (cleared on first attack via CombatSystem, re-armed each night).
  MinionAbilities.initFlags(minion, typeDef)

  return minion
}

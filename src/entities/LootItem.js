// Runtime loot entity factory.
// Plain JS objects so they survive serialization in gameState.loot.dungeon[].
// Each LootItem carries provenance — a chronological list of who crafted, wielded,
// dropped, and equipped it. This drives:
//   - Loot stories ("wielded by Sir Aldric, killed in Room 7")
//   - Vendetta hunts (sibling adventurer comes for the gear)
//   - Newspaper flavor in Phase 9

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

function _uid() {
  return `loot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Create a loot item from a definition + initial provenance entry.
 * @param {object} def — entry from lootDefinitions.json
 * @param {object} firstProvenance — { type, entityName, entityClass, roomId, day, flavorText }
 * @param {object} location — { tileX, tileY }
 */
export function createLootItem(def, firstProvenance, location) {
  const tx = location?.tileX ?? 0
  const ty = location?.tileY ?? 0
  return {
    instanceId:    _uid(),
    definitionId:  def.id,

    // Position on dungeon floor (null when equipped)
    tileX:         tx,
    tileY:         ty,
    worldX:        tx * TS + TS / 2,
    worldY:        ty * TS + TS / 2,
    dungeonRoomId: firstProvenance?.roomId ?? null,

    // Provenance chain — append-only
    provenance: firstProvenance ? [firstProvenance] : [],

    // Equipment + curse + vendetta state
    currentEquippedBy:  null,
    statModifiers:      _statsToModifiers(def.baseStats),
    curseLevel:         0,        // Phase 9 mechanic
    isVendettaTarget:   false,    // Phase 7b
    vendettaHunterId:   null,
  }
}

// Append a new entry to a loot item's provenance chain.
export function appendProvenance(item, entry) {
  item.provenance ??= []
  item.provenance.push(entry)
}

// Convert lootDef.baseStats { attackBonus: 3, defenseBonus: 2 } → modifier list
function _statsToModifiers(baseStats) {
  if (!baseStats) return []
  return Object.entries(baseStats).map(([key, value]) => ({
    stat:  key,
    delta: value,
  }))
}

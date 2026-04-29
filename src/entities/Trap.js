// Runtime trap entity factory.
// Plain JS objects — serialize via SaveSystem.
// Lives in `gameState.dungeon.traps[]`. Triggered traps stay in the array but show
// `isTriggered: true` until a Sapper repairs them (Phase 7 mechanic — for now they
// auto-reset at NIGHT_PHASE_STARTED so the dungeon stays interesting day-over-day).

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

function _uid() {
  return `trap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function createTrap(typeDef, tile) {
  return {
    instanceId:   _uid(),
    definitionId: typeDef.id,
    tileX:        tile.x,
    tileY:        tile.y,
    worldX:       tile.x * TS + TS / 2,
    worldY:       tile.y * TS + TS / 2,
    isTriggered:  false,
    isKnownToAdventurers: false,   // Phase 8 — flips when an adventurer survives + reports it
    repairProgress: 0,             // 0..1, Phase 7 Sapper repair
    upkeepCost:   typeDef.upkeepCost ?? 1,
    state:        {},              // trap-type-specific scratch state (e.g. timers per adv)
  }
}

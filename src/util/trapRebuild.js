// Pay-to-rebuild shared helpers for BROKEN traps.
//
// Traps have a 5% chance to break after firing on an adventurer (TrapSystem
// rolls this once per firing). A broken trap is removed from the live
// `dungeon.traps` array and a placement snapshot is pushed onto
// `dungeon._brokenTraps`. A night-phase REBUILD button (BottomBar) brings them
// all back for gold — half each trap's current construction-menu build cost,
// mirroring the pay-to-revive flow for minions.
//
// Cost math mirrors NightPhase._effectiveTrapCost EXACTLY (same pact discounts
// + buildScaleMul + Goblin-Market repricing) so "half the build cost" always
// matches the price the player sees in the construction menu, then halves it.

import { Balance } from '../config/balance.js'
import { buildScaleMul, applyMerchantPrice } from './merchantPricing.js'

// Broken traps awaiting rebuild (placement snapshots). Lives on the dungeon so
// it persists with the rest of the layout across save/load.
export function brokenTraps(gameState) {
  return gameState?.dungeon?._brokenTraps ?? []
}

// Current construction-menu build cost for a trap def — kept in lockstep with
// NightPhase._effectiveTrapCost.
function effectiveTrapCost(gameState, trapDef) {
  const f = gameState?._mechanicFlags ?? {}
  let cost = trapDef?.goldCost ?? 0
  if (f.hastyArchitect)   cost *= Balance.MECHANIC_HASTY_ARCHITECT_TRAP_DISCOUNT ?? 1
  if (f.pactOfTheJester)  cost *= Balance.MECHANIC_JESTER_TRAP_DISCOUNT ?? 1
  if (f.trapGoldCostMult) cost *= f.trapGoldCostMult
  cost *= buildScaleMul(gameState)
  return applyMerchantPrice(gameState, trapDef?.id, Math.max(0, Math.round(cost)))
}

// Gold to rebuild ONE broken trap = BUILD_REVIVE_COST_FRAC × its current
// build cost (so rebuild is cheaper than re-buying, exactly like minion revive).
export function trapRebuildCost(gameState, trapDef) {
  if (!trapDef) return 0
  const frac = Balance.BUILD_REVIVE_COST_FRAC ?? 0.5
  return Math.max(0, Math.round(effectiveTrapCost(gameState, trapDef) * frac))
}

// Total gold to rebuild ALL broken traps. `trapDefs` is the raw trapTypes array
// from the JSON cache (passed by the caller).
export function totalTrapRebuildCost(gameState, trapDefs) {
  const byId = {}
  for (const d of (trapDefs ?? [])) byId[d.id] = d
  let sum = 0
  for (const t of brokenTraps(gameState)) sum += trapRebuildCost(gameState, byId[t.definitionId])
  return sum
}

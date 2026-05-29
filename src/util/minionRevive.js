// Pay-to-revive shared helpers.
//
// As of 2026-05-28 the dungeon no longer auto-revives fallen roster minions
// for free at dawn. Instead a night-phase REVIVE button brings them back for
// gold, and anything left unrevived is lost when the day starts.
//
// `isPermadeadAtDawn` is the SINGLE definition of "this minion stays dead" —
// the event / ability / pact one-shots and perma-death pacts that were never
// meant to come back. It is shared by BOTH:
//   • MinionAISystem.respawnAll — which strips these from the roster at dawn
//   • the pay-to-revive flow      — which must NEVER resurrect them
// so the two can never drift. If you add a new "stays dead" minion type,
// add it here ONCE and both paths honour it.

import { Balance }       from '../config/balance.js'
import { buildScaleMul } from './merchantPricing.js'

// True when `m` must be permanently removed at dawn (never revivable). Mirrors
// the strip chain MinionAISystem.respawnAll applies. `flags` is
// gameState._mechanicFlags.
export function isPermadeadAtDawn(m, flags = {}) {
  if (!m) return false
  const dead = m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0
  // Defected minions (temporary tame/raise) never persist past the night.
  if (m.faction === 'adventurer') return true
  // DAMNED · Bloodbound — every fallen minion is gone for good.
  if (flags.bloodbound && dead) return true
  // Undying Horde undead that die a second time don't return.
  if (m.isUndead && m.aiState === 'dead') return true
  // Demon Hellgate imps — re-emitted fresh each dawn, killed ones stay dead.
  if (m._isDemonImp && dead) return true
  // Myconid Corpse-Bloom Vinekins are one-shot per corpse.
  if (m._myconidSprout && dead) return true
  // Wraith Haunt ghosts are bound to one death; killed ones don't reform.
  if (m._isHauntGhost && dead) return true
  // Hall of Trials elites are one-shot; the room rolls a fresh one instead.
  if (m.isHallOfTrialsSpawn && dead) return true
  // Throne Room mini-bosses are re-rolled fresh, not resurrected.
  if (m.isThroneMiniBoss && dead) return true
  // Mercenary-contract hires don't revive — a fallen merc ends the contract.
  if (m._mercenary && dead) return true
  // Slime Split mini-slimes are temporary — wiped every dawn regardless.
  if (m._isMiniSlime) return true
  // Slime King Absorb & Excrete gooplings are one-shot.
  if (m._isGoopling && dead) return true
  return false
}

// The fallen minions the player can pay to revive right now: dead, player-built
// ROSTER minions that aren't one of the permanent-death specials.
//
// Scoped to `roster` on purpose: auto-managed GARRISON spawns (Gnoll hunters
// pack, Crypt risen bones, Catacombs revenants, etc.) are owned by their host
// room / boss-archetype system, which still auto-revives or re-spawns them
// each dawn — the player neither built nor paid for them, so they're never in
// the pay-to-revive pool. The permadead specials are also excluded defensively
// (respawnAll already strips them at night start).
export function fallenRevivable(gameState) {
  const flags = gameState?._mechanicFlags ?? {}
  return (gameState?.minions ?? []).filter(m =>
    (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0)
    && (m.class ?? 'roster') === 'roster'
    && !isPermadeadAtDawn(m, flags)
  )
}

// Gold to revive ONE fallen minion = BUILD_REVIVE_COST_FRAC × its current
// day-scaled build cost (so revive is cheaper than re-buying, and scales with
// the run exactly like build costs do).
export function reviveCost(gameState, minionDef) {
  const base = minionDef?.goldCost ?? 0
  if (base <= 0) return 0
  const frac = Balance.BUILD_REVIVE_COST_FRAC ?? 0.5
  return Math.max(0, Math.round(base * frac * buildScaleMul(gameState)))
}

// Total gold to revive ALL currently-fallen revivable minions. `minionDefs` is
// the raw minionTypes array (the caller pulls it from the JSON cache).
export function totalReviveCost(gameState, minionDefs) {
  const byId = {}
  for (const d of (minionDefs ?? [])) byId[d.id] = d
  let sum = 0
  for (const m of fallenRevivable(gameState)) sum += reviveCost(gameState, byId[m.definitionId])
  return sum
}

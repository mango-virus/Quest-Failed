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
  // Zombie Reanimate / Mass Grave Risen — slain heroes raised as permanent
  // undead minions: a LIVING Risen persists across nights/days (it's garrison
  // class → no cap, no pay-to-revive, not sellable/movable). Only a KILLED Risen
  // stays dead (no free dawn auto-revive that other garrison spawns get) — so the
  // outbreak army grows only while they survive.
  if (m._raisedZombie && dead) return true
  // Summoner adds (Bone Totem) are net-new transient entities — wiped every
  // dawn so a summoner can't grow a permanent army. (Elder Lich's Raise-Dead
  // reanimates EXISTING minions, which just follow their normal revive rules.)
  if (m._isSummonedAdd) return true
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

// Locate a minion id's evolution chain root + tier index. `chains` is the
// raw minionEvolutions.json object ({ rootId: { chain: [...] } }). Returns
// null when the id isn't part of any chain (e.g. mimic, or unknown ids).
function chainInfoFor(chains, id) {
  if (!chains || !id) return null
  for (const v of Object.values(chains)) {
    const chain = v?.chain
    if (!Array.isArray(chain)) continue
    const idx = chain.indexOf(id)
    if (idx >= 0) return { rootId: chain[0], idx, len: chain.length, chain }
  }
  return null
}

// Gold to revive ONE fallen minion = BUILD_REVIVE_COST_FRAC × its current
// day-scaled build cost (so revive is cheaper than re-buying, and scales with
// the run exactly like build costs do).
//
// Evolved / named forms (beholder2, demon_lord, elder_slime…) have goldCost 0
// in minionTypes.json — they evolve up from a buildable root instead of being
// purchased. Reviving them off a 0 base would be FREE, which badly undercharges
// a mid/late-game roster. When `ctx` supplies the evolution chains + a def-by-id
// map, derive the base from the chain ROOT's build cost × the per-tier
// multiplier (Balance.REVIVE_EVOLVED_TIER_MULT). Without `ctx` it falls back to
// the raw (possibly 0) build cost so the helper stays usable standalone.
export function reviveCost(gameState, minionDef, ctx = null) {
  const frac  = Balance.BUILD_REVIVE_COST_FRAC ?? 0.5
  const scale = buildScaleMul(gameState)
  let base = minionDef?.goldCost ?? 0
  if (base <= 0 && ctx?.chains && ctx?.defsById) {
    const info = chainInfoFor(ctx.chains, minionDef?.id)
    if (info) {
      const rootGold = ctx.defsById[info.rootId]?.goldCost ?? 0
      const mults = Balance.REVIVE_EVOLVED_TIER_MULT ?? [1, 2.2, 4, 6]
      const mult  = mults[Math.min(info.idx, mults.length - 1)] ?? 1
      base = rootGold * mult
    }
  }
  if (base <= 0) return 0
  return Math.max(0, Math.round(base * frac * scale))
}

// Total gold to revive ALL currently-fallen revivable minions. `minionDefs` is
// the raw minionTypes array; `chains` is the raw minionEvolutions object (both
// pulled from the JSON cache by the caller). Passing `chains` is what lets
// evolved forms cost their tier-scaled value instead of 0.
export function totalReviveCost(gameState, minionDefs, chains = null) {
  const byId = {}
  for (const d of (minionDefs ?? [])) byId[d.id] = d
  const ctx = { defsById: byId, chains }
  let sum = 0
  for (const m of fallenRevivable(gameState)) sum += reviveCost(gameState, byId[m.definitionId], ctx)
  return sum
}

// Per-fallen-minion revive candidates, each stamped with its individual cost
// (evolution-aware) and maxHp (used only as a deterministic tiebreak). Feeds
// both the partial-revive plan and the choice-popup previews.
export function reviveCandidates(gameState, minionDefs, chains = null) {
  const byId = {}
  for (const d of (minionDefs ?? [])) byId[d.id] = d
  const ctx = { defsById: byId, chains }
  return fallenRevivable(gameState).map(m => ({
    instanceId: m.instanceId,
    cost:       reviveCost(gameState, byId[m.definitionId], ctx),
    maxHp:      m.resources?.maxHp ?? 0,
  }))
}

// Greedily choose which fallen minions to bring back within `budget` gold.
//   mode 'strongest' → most expensive first; skips any that don't fit but keeps
//                      going so leftover gold still pulls back cheaper ones.
//   mode 'quantity'  → cheapest first → maximizes the NUMBER revived.
// Ties (equal cost) prefer the higher-maxHp minion, then a stable id order, so
// the result is deterministic. Returns { ids, cost, count }.
export function planRevive(candidates, budget, mode = 'strongest') {
  const dir = mode === 'quantity' ? 1 : -1   // asc cost vs desc cost
  const sorted = [...(candidates ?? [])].sort((a, b) =>
    (a.cost - b.cost) * dir
    || (b.maxHp - a.maxHp)
    || (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0)
  )
  const ids = []
  let cost = 0
  for (const c of sorted) {
    if (cost + c.cost <= budget) { ids.push(c.instanceId); cost += c.cost }
  }
  return { ids, cost, count: ids.length }
}

// ── Gold-gated tier upgrades (2026-05-29) ───────────────────────────────────

// Gold to upgrade a minion ONE tier up its evolution chain. Cost = the chain
// ROOT's build cost × Balance.MINION_UPGRADE_TIER_MULT[targetTierIdx] ×
// buildScaleMul — so each tier costs more, it scales with the run, and it's
// pricier than buying a fresh root (upgrading should feel like an investment).
// Returns 0 when the minion has no chain, is already at its final tier, or its
// root isn't a purchasable def. `minionDefs` is the raw minionTypes array,
// `chains` the raw minionEvolutions object (both from the JSON cache).
export function upgradeCost(gameState, minion, minionDefs, chains) {
  if (!minion || !chains) return 0
  const info = chainInfoFor(chains, minion.definitionId)
  if (!info) return 0
  const targetIdx = info.idx + 1
  if (targetIdx > info.len - 1) return 0   // already at the final tier
  const byId = {}
  for (const d of (minionDefs ?? [])) byId[d.id] = d
  const rootGold = byId[info.rootId]?.goldCost ?? 0
  if (rootGold <= 0) return 0
  const mults = Balance.MINION_UPGRADE_TIER_MULT ?? [0, 2.5, 5, 8]
  const mult  = mults[Math.min(targetIdx, mults.length - 1)] ?? 0
  if (mult <= 0) return 0
  return Math.max(0, Math.round(rootGold * mult * buildScaleMul(gameState)))
}

// Describe a minion's tier position + the def it would become if upgraded —
// feeds the upgrade-confirm popup's before/after preview. All tier numbers are
// 1-based (T1 = chain root). Returns null when the minion has no chain or is
// already at its final tier (nothing to preview).
export function nextTierInfo(minion, minionDefs, chains) {
  const info = chainInfoFor(chains, minion?.definitionId)
  if (!info) return null
  const targetIdx = info.idx + 1
  if (targetIdx > info.len - 1) return null
  const byId = {}
  for (const d of (minionDefs ?? [])) byId[d.id] = d
  return {
    currentTier: info.idx + 1,
    nextTier:    targetIdx + 1,
    maxTier:     info.len,
    isFinalNext: targetIdx === info.len - 1,
    nextId:      info.chain[targetIdx],
    nextDef:     byId[info.chain[targetIdx]] ?? null,
  }
}

// 1-based current tier of a minion (T1 = chain root). 1 for chainless minions
// (mimic, etc.). Shared by roster / inspector / badge displays so every surface
// reports the same tier.
export function tierOf(minion, chains) {
  const info = chainInfoFor(chains, minion?.definitionId)
  return info ? info.idx + 1 : 1
}

// Total tiers in a minion's chain (1 for chainless minions).
export function maxTierOf(minion, chains) {
  const info = chainInfoFor(chains, minion?.definitionId)
  return info ? info.len : 1
}

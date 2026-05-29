// Goblin Market event — shared buy-price multiplier.
//
// The "Goblin Market" dungeon event reprices everything purchasable for a
// single build night: each room / minion / trap / item definition gets a
// rolled multiplier stored on gameState._eventFlags.goblinMarketPrices,
// keyed by definition id. Discounts are capped at 0.5 (50% off) so a player
// can never buy below half price and re-sell at the 50%-of-base refund for
// infinite gold; markups are uncapped ("outrageous").
//
// Both the build-menu DISPLAY (LeftPanels._costFor) and the placement CHARGE
// sites (NightPhase._effectiveMinionCost / _effectiveTrapCost / room + item
// debits) route their final cost through applyMerchantPrice so the price the
// player sees always equals the price they pay.

import { Balance } from '../config/balance.js'

// Unified build-cost scaling for EVERY buildable (minion / trap / room /
// item). Multiplies the BASE gold cost before per-kind discounts and the
// Goblin-Market / Mounting-Debt repricing in applyMerchantPrice. Single
// source of truth so the build-menu display and the placement charge can
// never drift.
//
//   mul = 1 + BUILD_COST_PER_BOSS_LV·(bossLv−1) + BUILD_COST_PER_DAY·max(0, day−9)
//
// The boss-level term mirrors the long-standing +20%/level on minions &
// traps; the DAY term (post-day-9, added 2026-05-28) makes costs keep pace
// with the day-driven income curve (wave size balloons with the calendar
// while boss level plateaus), so gold keeps its value late game. See the
// BUILD_COST_* block in config/balance.js for the full rationale.
export function buildScaleMul(gameState) {
  const lv  = gameState?.boss?.level   ?? 1
  const day = gameState?.meta?.dayNumber ?? 1
  const lvTerm  = (Balance.BUILD_COST_PER_BOSS_LV ?? 0.20) * Math.max(0, lv - 1)
  const dayTerm = (Balance.BUILD_COST_PER_DAY     ?? 0.12) * Math.max(0, day - 9)
  return 1 + lvTerm + dayTerm
}

// Raw multiplier for a definition id (1 = unchanged / no active market).
export function merchantPriceMult(gameState, defId) {
  const map = gameState?._eventFlags?.goblinMarketPrices
  if (!map || defId == null) return 1
  return map[defId] ?? 1
}

// Apply the Goblin Market multiplier to an already-computed cost. Free
// things (cost 0 — phylactery, freeFirstN rooms) stay free. Rounds to a
// whole gold value, matching the rest of the cost pipeline.
export function applyMerchantPrice(gameState, defId, cost) {
  if (!cost) return cost
  const mult = merchantPriceMult(gameState, defId)
  // DAMNED · Mounting Debt — build costs inflate 5%/day (compounding). The
  // multiplier lives on _mechanicFlags.mountingDebtMult so both the display
  // (LeftPanels._costFor) and the charge sites stay in sync.
  const debtMul = gameState?._mechanicFlags?.mountingDebtMult ?? 1
  const eff = mult * debtMul
  if (eff === 1) return cost
  return Math.max(0, Math.round(cost * eff))
}

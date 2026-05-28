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
  if (mult === 1) return cost
  return Math.max(0, Math.round(cost * mult))
}

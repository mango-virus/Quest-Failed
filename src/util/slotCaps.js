// Single source of truth for the trap + minion-roster slot caps.
//
// Both the build-menu DISPLAY (LeftPanels) and the placement ENFORCEMENT
// (NightPhase) route through these, plus The Undying Court's "no free slots"
// check — so the counter can never lie about what you can actually place. A
// previous duplicate formula drifted (Trap Factory ×5 in the display vs ×3 at
// placement, and the Hollow Horde halving was missing from the display); this
// module exists to prevent that recurring.

// Trap slots: by default the FIRST Trap Factory grants 5 slots and each
// additional one adds +3 (so 1 → 5, 2 → 8, 3 → 11, 4 → 14, 5 → 17 at the
// per-boss-level room cap). The "Assembly Line" tinker adds +1 per factory on
// top. Pact override (`trapSlotsPerFactory`, e.g. Trap Mason's Touch) replaces
// the default ramp with a flat per-factory value.
export function trapCap(gameState) {
  const f = gameState?._mechanicFlags ?? {}
  const factories = (gameState?.dungeon?.rooms ?? [])
    .filter(r => r.definitionId === 'trap_factory' && r.isActive !== false).length
  const perFactoryOverride = f.trapSlotsPerFactory   // pact: flat slots per factory
  const factoryBase = perFactoryOverride != null
    ? factories * perFactoryOverride
    : (factories > 0 ? 5 + (factories - 1) * 3 : 0)
  const tinkerBonus = (gameState?._tinkeredRoomTypes ?? []).includes('trap_factory')
    ? factories * 1 : 0
  const bonus = f.maxTrapSlotBonus ?? 0
  return Math.max(0, factoryBase + tinkerBonus + bonus)
}

// Minion roster slots: Barracks grant `minionSlotsPerBarracks` each (default
// 10, +5 each when tinkered into "Drill Sergeant"), plus/minus flat
// bonuses/penalties; The Hollow Horde (DAMNED) then halves the total.
export function rosterCap(gameState) {
  const f = gameState?._mechanicFlags ?? {}
  const barracks = (gameState?.dungeon?.rooms ?? [])
    .filter(r => r.definitionId === 'starter_barracks' && r.isActive !== false).length
  const perBarracks = f.minionSlotsPerBarracks ?? 10
  const tinkerBonus = (gameState?._tinkeredRoomTypes ?? []).includes('starter_barracks')
    ? barracks * 5 : 0
  const bonus   = f.maxMinionSlotBonus ?? 0
  const penalty = f.longGameMinionSlotPenalty ?? 0
  let total = barracks * perBarracks + tinkerBonus + bonus - penalty
  if (f.theHollowHorde) total = Math.floor(total * 0.5)   // DAMNED · The Hollow Horde
  return Math.max(0, total)
}

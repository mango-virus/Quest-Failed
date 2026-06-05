// Adventurer-class spawn helpers — the SINGLE source of truth for which
// classes can spawn, and how rare each is.

// getEligibleClasses — the day-gated normal-wave class pool. Classes unlock in
// 10-day TIERS via each class's `unlockDay` (1 / 11 / 21 / 31); a new cohort
// joins the threat pool every 10 days. Event-only classes (Shadow Monarch, the
// Light Party, Loot Goblin, the Rival pack, Aldric, etc.) carry the
// `unlockLevel: 99` sentinel and are NEVER part of the normal pool. In
// Reckoning NG+ the full roster is unlocked from day 1 (`opts.ngPlus`).
//
// ⚠ ALL five spawn/preview call sites MUST route through this so the actual
// wave (DayPhase) and every forecast (NightPhase preview, RightPanels,
// AdventurerIntelPopup, RoomBehaviorSystem library) agree on the same pool.
export function getEligibleClasses(allClasses, dayNum, opts = {}) {
  const ngPlus = !!opts.ngPlus
  const day = Number.isFinite(dayNum) ? dayNum : 1
  return (Array.isArray(allClasses) ? allClasses : []).filter(c =>
    c &&
    c.id !== 'shadow_monarch' &&        // never in the normal pool (also 99 below)
    (c.unlockLevel ?? 1) < 99 &&        // event-only sentinel → excluded
    (ngPlus || (c.unlockDay ?? 1) <= day)
  )
}

// Weighted class picker used by NightPhase's wave preview and DayPhase's
// fallback spawn loop. Each adventurer class JSON entry may carry an
// optional `spawnWeight` (default 1.0). Lower weight = rarer roll.
//
// Rarity is FLAT by design — every eligible class is equal-weight (no
// spawnWeight = default 1) EXCEPT the Cheater (`spawnWeight: 0.08`, ~12×
// rarer than a default class) so a cheating adventurer is a rare event.
// Drop-in replacement for the previous uniform random — returns the same
// shape (a class def object) and degrades to uniform when all are unweighted.
export function pickWeightedClass(classes) {
  if (!Array.isArray(classes) || classes.length === 0) return null
  let total = 0
  for (const c of classes) total += Math.max(0, c?.spawnWeight ?? 1)
  // Degenerate case (all weights zero or undefined → 0): fall back to
  // uniform so spawning still works.
  if (total <= 0) return classes[Math.floor(Math.random() * classes.length)]
  let roll = Math.random() * total
  for (const c of classes) {
    roll -= Math.max(0, c?.spawnWeight ?? 1)
    if (roll <= 0) return c
  }
  return classes[classes.length - 1]
}

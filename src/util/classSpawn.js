// Weighted class picker used by NightPhase's wave preview and DayPhase's
// fallback spawn loop. Each adventurer class JSON entry may carry an
// optional `spawnWeight` (default 1.0). Lower weight = rarer roll.
//
// Used by the Cheater class (spawnWeight: 0.25, ~4× rarer than a default
// class) and reserved for any future class that needs scarcity tuning
// without leaning on unlockLevel/unlockDay gates. Drop-in replacement
// for the previous `classes[Math.floor(Math.random() * classes.length)]`
// uniform random — returns the same shape (a class def object) and
// gracefully degrades to uniform random when every class is unweighted.
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

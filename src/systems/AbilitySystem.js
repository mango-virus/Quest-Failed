// Phase 5b — class ability framework.
//
// Replaces the old per-class ad-hoc handlers (mana costs, _lastTameAt, etc.)
// with a uniform per-instance cooldown + per-day-budget registry. Each adv
// stores `cooldowns` and `usesLeftToday` plain objects on its entity (defined
// in src/entities/Adventurer.js so they're save-stable JSON).
//
// Lifecycle:
//   - canUse(adv, abilityId, defs):           ready check (cooldown + budget)
//   - markUsed(adv, abilityId, cdMs, defs):   start cooldown, decrement budget
//   - resetForNewDay(adv, defs):              refill per-day budgets
//
// Each ability definition (passed in `defs` or read off classDef) shapes:
//   {
//     id:            'protective_aura',
//     cooldownMs:    20000,        // optional. omit for non-CD abilities.
//     usesPerDay:    null | num,   // optional. null = no per-day cap.
//     usesPerDayPerLevel: null | { 1: 1, 5: 5 },  // tier table by adv level
//   }
//
// AbilitySystem itself is a singleton (no scene state); class-specific
// behavior lives in per-class handlers that call canUse / markUsed.

import { EventBus } from './EventBus.js'

export const AbilitySystem = {
  // Global cooldown scale — 1 normally. The Arcane Storm dungeon event
  // drops it (e.g. 0.4) so every class ability comes back far faster.
  // EventSystem owns the value (set on event begin/end).
  _cooldownScale: 1,
  setCooldownScale(mult) {
    this._cooldownScale = (typeof mult === 'number' && mult > 0) ? mult : 1
  },

  // Returns { ready: bool, reason?: 'cooldown' | 'no_uses_left' }.
  canUse(adv, abilityDef, nowMs) {
    if (!adv || !abilityDef) return { ready: false, reason: 'invalid' }
    const id = abilityDef.id
    // Per-day budget check
    if (abilityDef.usesPerDay != null || abilityDef.usesPerDayPerLevel) {
      const left = adv.usesLeftToday?.[id]
      if (left != null && left <= 0) return { ready: false, reason: 'no_uses_left' }
    }
    // Cooldown check
    if (abilityDef.cooldownMs != null) {
      const ready = adv.cooldowns?.[id] ?? 0
      if (nowMs < ready) return { ready: false, reason: 'cooldown' }
    }
    return { ready: true }
  },

  // Start the cooldown timer and decrement the per-day usage counter.
  markUsed(adv, abilityDef, nowMs) {
    if (!adv || !abilityDef) return
    const id = abilityDef.id
    if (abilityDef.cooldownMs != null) {
      adv.cooldowns ??= {}
      adv.cooldowns[id] = nowMs + abilityDef.cooldownMs * AbilitySystem._cooldownScale
    }
    if (abilityDef.usesPerDay != null || abilityDef.usesPerDayPerLevel) {
      adv.usesLeftToday ??= {}
      const max = AbilitySystem.usesForLevel(abilityDef, adv.level ?? 1)
      const cur = adv.usesLeftToday[id] ?? max
      adv.usesLeftToday[id] = Math.max(0, cur - 1)
    }
    EventBus.emit('ABILITY_USED', { adventurer: adv, abilityId: id })
  },

  // Refill per-day budgets at the start of a new day.
  // Called from DayPhase / NightPhase transition listeners.
  resetForNewDay(adv, abilityDefs) {
    if (!adv) return
    adv.usesLeftToday ??= {}
    for (const def of abilityDefs ?? []) {
      if (def.usesPerDay != null || def.usesPerDayPerLevel) {
        adv.usesLeftToday[def.id] = AbilitySystem.usesForLevel(def, adv.level ?? 1)
      }
    }
  },

  // Tier table: { 1: 1, 3: 2, 5: 3 } means lvl 1-2 → 1 use, 3-4 → 2, 5+ → 3.
  // Plain `usesPerDay: N` overrides if set.
  usesForLevel(abilityDef, level) {
    if (abilityDef.usesPerDay != null) return abilityDef.usesPerDay
    const tiers = abilityDef.usesPerDayPerLevel
    if (!tiers) return Infinity
    let best = 0
    for (const [tierLvl, count] of Object.entries(tiers)) {
      if (level >= +tierLvl) best = Math.max(best, count)
    }
    return best
  },
}

// Per-instance minion tier upgrades (gold-gated).
//
// Each minion belongs to an evolution chain (data in
// `src/data/minionEvolutions.json`); chain[0] is the buildable starter tier,
// later entries are progressively stronger tiers. The player pays gold in the
// night-phase UPGRADE tool to advance a minion one tier — kills no longer
// auto-evolve (removed 2026-05-29).
//
// `upgrade()` advances the definitionId and RE-BASES the scaling anchors
// (_baseMaxHp/_baseAtk) to the new tier's base stats. Because
// applyMinionScaling always computes maxHp/attack as _base × boss-level-mult,
// every future rescale (boss level-up, dawn respawn, paid revive) now derives
// from the upgraded tier — an upgraded minion NEVER reverts to a lower tier,
// even after dying and being revived. On the final tier, the mini-boss
// multipliers fold into the base so they persist through rescaling too.
//
// The DAMNED · The Wasting bribe still force-advances every minion one tier for
// free via evolveAllOnce(); DAMNED · The Unteachable blocks paid upgrades.

import { EventBus }           from './EventBus.js'
import { Balance }            from '../config/balance.js'
import { applyMinionScaling } from '../entities/Minion.js'
import { PlayerProfile }      from './PlayerProfile.js'

export class MinionEvolutionSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._chains    = scene.cache.json.get('minionEvolutions') ?? {}
    const defs      = scene.cache.json.get('minionTypes') ?? []
    this._defMap    = Object.fromEntries(defs.map(d => [d.id, d]))
    this._unlockNights = Balance.MINION_TIER_UNLOCK_NIGHTS ?? 10
    // Each night: record when newly-available families unlocked, then announce
    // any family whose next tier just opened (so the player knows to upgrade).
    this._onNight = () => { this._stampUnlockDays(); this._announceTierUnlocks() }
    EventBus.on('NIGHT_PHASE_STARTED', this._onNight)
    this._stampUnlockDays()   // seed for the current state (day-1 starters, or a loaded run)
  }

  destroy() { EventBus.off('NIGHT_PHASE_STARTED', this._onNight) }

  // ── Tier-unlock gating (night-based, per family) ────────────────────────────
  // chain[0] is the family's buildable T1 — its unlockLevel is when the family
  // becomes available, and the per-family clock starts there.
  _familyRoot(minion) {
    const chain = this._chainContaining(minion?.definitionId)
    return chain ? chain[0] : null
  }
  // Stamp the day each family first becomes available (boss reached its T1
  // unlockLevel). Idempotent — only stamps families with no record yet.
  _stampUnlockDays() {
    const gs = this._gameState
    const bossLv = gs.boss?.level ?? 1
    const day    = gs.meta?.dayNumber ?? 1
    gs.minionUnlockDay ??= {}
    for (const v of Object.values(this._chains)) {
      const root = Array.isArray(v?.chain) ? v.chain[0] : null
      if (!root || gs.minionUnlockDay[root] != null) continue
      if (bossLv >= (this._defMap[root]?.unlockLevel ?? 1)) gs.minionUnlockDay[root] = day
    }
  }
  // Nights elapsed since a minion's family unlocked (unlock night = night 1).
  _nightsSinceUnlock(minion) {
    const root = this._familyRoot(minion)
    const u = this._gameState.minionUnlockDay?.[root]
    if (u == null) return 0
    return Math.max(0, (this._gameState.meta?.dayNumber ?? 1) - u + 1)
  }
  // Nights a family must have been unlocked to reach a given tier (T2=N, T3=2N…).
  _nightsForTier(tier) { return this._unlockNights * Math.max(0, tier - 1) }
  // Is `targetTier` night-unlocked for this minion's family yet?
  // Cheat name (`mango`) bypasses the tier-unlock night-gate entirely so dev
  // testing can upgrade any owned minion to any tier immediately.
  tierUnlockedByNight(minion, targetTier) {
    if (PlayerProfile.isCheatName?.()) return true
    return this._nightsSinceUnlock(minion) >= this._nightsForTier(targetTier)
  }
  // Nights remaining until this minion's NEXT tier opens (0 = available now).
  nightsUntilNextTier(minion) {
    const chain = this._chainContaining(minion?.definitionId)
    if (!chain) return 0
    const idx = chain.indexOf(minion.definitionId)
    if (idx < 0 || idx >= chain.length - 1) return 0   // final tier — nothing to wait for
    return Math.max(0, this._nightsForTier(idx + 2) - this._nightsSinceUnlock(minion))
  }
  // True when the only thing blocking an upgrade is the night-gate (so the UI can
  // show "Evolves in N nights" rather than hiding the affordance entirely).
  isTierTimeLocked(minion) {
    if (!minion || minion.aiState === 'dead') return false
    const chain = this._chainContaining(minion.definitionId)
    if (!chain) return false
    const idx = chain.indexOf(minion.definitionId)
    if (idx < 0 || idx >= chain.length - 1) return false
    return !this.tierUnlockedByNight(minion, idx + 2)
  }

  // Announce (toast) when a family the player OWNS has its next tier come due.
  // _minionTierSeen[root] = highest tier already announced, so each tier fires once.
  _announceTierUnlocks() {
    const gs = this._gameState
    gs._minionTierSeen ??= {}
    const owned = {}   // root → { minTier, chainLen, sample }
    for (const m of gs.minions ?? []) {
      if (m.aiState === 'dead' || (m.class ?? 'roster') !== 'roster') continue
      const chain = this._chainContaining(m.definitionId)
      if (!chain) continue
      const root = chain[0]
      const tier = chain.indexOf(m.definitionId) + 1
      const o = owned[root] ??= { minTier: 99, chainLen: chain.length, sample: m }
      if (tier < o.minTier) { o.minTier = tier; o.sample = m }
    }
    let unlocked = 0
    for (const [root, o] of Object.entries(owned)) {
      const nights = this._nightsSinceUnlock(o.sample)
      const tierNow = Math.min(o.chainLen, 1 + Math.floor(nights / this._unlockNights))
      if (tierNow < 2 || o.minTier >= tierNow) continue   // no owned minion can use it yet
      if (tierNow > (gs._minionTierSeen[root] ?? 1)) {
        gs._minionTierSeen[root] = tierNow
        const name = this._defMap[root]?.name ?? 'Your minions'
        EventBus.emit('SHOW_TOAST', { type: 'info', duration: 5500,
          message: `${name} can now evolve to Tier ${tierNow} — use the UPGRADE tool.` })
        unlocked++
      }
    }
    if (unlocked > 0) EventBus.emit('MINION_TIER_UNLOCKED', { count: unlocked })
  }

  // Look up the chain that contains the given def id.
  _chainContaining(defId) {
    for (const v of Object.values(this._chains)) {
      if (Array.isArray(v?.chain) && v.chain.includes(defId)) return v.chain
    }
    return null
  }

  // Current 1-based tier of a minion (T1 = chain[0]). Returns 1 for minions
  // with no chain (e.g. mimic) so callers always have a sane number to show.
  tierOf(minion) {
    const chain = this._chainContaining(minion?.definitionId)
    if (!chain) return 1
    const idx = chain.indexOf(minion.definitionId)
    return idx < 0 ? 1 : idx + 1
  }

  // Total number of tiers in a minion's chain (1 if it has no chain).
  maxTierOf(minion) {
    const chain = this._chainContaining(minion?.definitionId)
    return chain ? chain.length : 1
  }

  // Is this minion eligible for a paid upgrade right now? (Has a chain, isn't at
  // the final tier, isn't a locked Haunt ghost, and The Unteachable is off.)
  canUpgrade(minion) {
    if (!minion || minion.aiState === 'dead') return false
    if (minion._isHauntGhost) return false
    // Only player-built ROSTER minions are upgradeable. Auto-managed GARRISON
    // spawns (gnoll pack, crypt risen, catacomb revenants, etc.) are re-rolled
    // by their host room, so a paid upgrade wouldn't persist — exclude them
    // (mirrors the pay-to-revive scoping in util/minionRevive.fallenRevivable).
    if ((minion.class ?? 'roster') !== 'roster') return false
    const f = this._gameState._mechanicFlags ?? {}
    if (f.theUnteachable) return false
    // Undying Horde — the risen "shambling echoes" (minion.isUndead, set when a
    // dead minion rises via the pact) cannot evolve. Built undead minions (the
    // `undead` TAG only, no isUndead property) still evolve normally.
    if (f.undyingHorde && minion.isUndead) return false
    const chain = this._chainContaining(minion.definitionId)
    if (!chain) return false
    const idx = chain.indexOf(minion.definitionId)
    if (idx < 0 || idx >= chain.length - 1) return false
    // Night-gate: the family must have been unlocked long enough for the next tier.
    return this.tierUnlockedByNight(minion, idx + 2)
  }

  // ── Gold-gated upgrade ──────────────────────────────────────────────────────
  // Player-initiated tier advance. Gold is charged by the caller (the NightPhase
  // UPGRADE tool) BEFORE this runs — this only performs the mutation. Returns
  // true if the minion advanced a tier.
  upgrade(minion) {
    if (!this.canUpgrade(minion)) return false
    const ok = this._advanceTier(minion)
    if (ok) EventBus.emit('MINION_UPGRADED', { minion })
    return ok
  }

  // ── Core tier advance ───────────────────────────────────────────────────────
  // Advances the minion one step up its chain and re-bases its scaling anchors
  // so the gain is permanent. Shared by upgrade() (gold) and evolveAllOnce()
  // (The Wasting). Returns true if it advanced.
  _advanceTier(minion) {
    const chain = this._chainContaining(minion.definitionId)
    if (!chain) return false
    const idx = chain.indexOf(minion.definitionId)
    if (idx < 0 || idx >= chain.length - 1) return false  // already at final tier

    const nextId  = chain[idx + 1]
    const nextDef = this._defMap[nextId]
    if (!nextDef) return false

    minion.definitionId = nextId
    minion.spriteKey    = nextDef.spriteKey

    const stats = nextDef.baseStats ?? {}
    if (stats.defense != null) minion.stats.defense = stats.defense
    if (stats.speed   != null) minion.stats.speed   = stats.speed
    if (stats.damageType) minion.damageType = stats.damageType
    minion.attackRange = nextDef.attackRange ?? stats.attackRange ?? minion.attackRange ?? 1

    // PERSISTENCE LYNCHPIN — rebase the scaling anchors to the new tier's base
    // stats. applyMinionScaling computes maxHp/attack as _base × mult, so every
    // future rescale (boss level-up, dawn respawn, paid revive) now derives from
    // the upgraded tier. Without this, the next rescale would snap the minion
    // back to its previous tier's base (the pre-2026-05-29 evolve bug).
    minion._baseMaxHp = stats.hp     ?? minion.resources.maxHp
    minion._baseAtk   = stats.attack ?? minion.stats.attack

    // Final tier → mini-boss promotion. Fold the multipliers into the BASE so
    // they survive rescaling (the old code multiplied resources.maxHp directly,
    // which a later rescale would wipe).
    const isFinal = (idx + 1 === chain.length - 1)
    if (isFinal && !minion.isMiniBoss) {
      minion.isMiniBoss = true
      minion._baseMaxHp = Math.round(minion._baseMaxHp * Balance.MINIBOSS_HP_MULT)
      minion._baseAtk   = Math.round(minion._baseAtk   * Balance.MINIBOSS_ATTACK_MULT)
      EventBus.emit('MINIBOSS_PROMOTED', { minion })
    }

    // Re-scale to the current boss level (day term is 0 now) and full-heal.
    const bossLv = this._gameState.boss?.level ?? 1
    const day    = this._gameState.meta?.dayNumber ?? 1
    applyMinionScaling(minion, bossLv, day)
    minion.resources.hp = minion.resources.maxHp

    EventBus.emit('MINION_EVOLVED', { minion, fromIdx: idx, toIdx: idx + 1, isFinal })
    return true
  }

  // DAMNED · The Wasting bribe — force every alive dungeon minion up one tier
  // for free (no-op for minions already at their final form).
  evolveAllOnce() {
    for (const m of (this._gameState.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead') continue
      this._advanceTier(m)
    }
  }
}

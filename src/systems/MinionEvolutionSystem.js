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

export class MinionEvolutionSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._chains    = scene.cache.json.get('minionEvolutions') ?? {}
    const defs      = scene.cache.json.get('minionTypes') ?? []
    this._defMap    = Object.fromEntries(defs.map(d => [d.id, d]))
  }

  destroy() {}

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
    if ((this._gameState._mechanicFlags ?? {}).theUnteachable) return false
    const chain = this._chainContaining(minion.definitionId)
    if (!chain) return false
    const idx = chain.indexOf(minion.definitionId)
    return idx >= 0 && idx < chain.length - 1
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

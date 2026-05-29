// Minion specialization + bounty + adventurer-XP system.
//
// Minion kill-XP / leveling was REMOVED 2026-05-29 — minion power now comes from
// boss-level scaling (Minion.applyMinionScaling) plus gold-paid tier upgrades
// (MinionEvolutionSystem.upgrade). This system now only:
//   • Triggers evolutionPath specializations from minionTypes.json against
//     killHistory — granting a kill-themed NAME + ABILITY only (stat deltas
//     stripped, so no raw power) — see _applyEvolution.
//   • Marks minions with `hasBounty=true` once their kill count crosses the
//     bounty threshold (drives the Bounty-Hunter event + ★ badge).
//   • Awards ADVENTURER XP when an adventurer kills a minion (Phase 7b, underdog
//     2× + Believer's-Boost combo) — unaffected by the minion-XP removal.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

export class EvolutionSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._defs = {}
    this._loaded = false

    EventBus.on('COMBAT_KILL',     this._onCombatKill,     this)
    EventBus.on('MINION_RESPAWNED', this._onMinionRespawn, this)
  }

  destroy() {
    EventBus.off('COMBAT_KILL',     this._onCombatKill,     this)
    EventBus.off('MINION_RESPAWNED', this._onMinionRespawn, this)
  }

  // Phase 7b: respawn-driven evolutions (vengeful_wraith) check after each return from death
  _onMinionRespawn({ minion }) {
    if (!this._loaded) this.loadDefinitions()
    if (!minion) return
    this._checkEvolutions(minion, {})
  }

  loadDefinitions() {
    if (this._loaded) return
    const defs = this._scene.cache.json.get('minionTypes') ?? []
    this._defs = Object.fromEntries(defs.map(d => [d.id, d]))
    this._loaded = true
  }

  // ── Event handler ─────────────────────────────────────────────────────────

  _onCombatKill({ sourceId, targetId, damageType, method }) {
    if (!this._loaded) this.loadDefinitions()

    // Phase 7b: adventurer kills minion → adventurer XP (underdog 2×)
    const advSrc = this._gameState.adventurers.active.find(a => a.instanceId === sourceId)
    if (advSrc) {
      const ps = this._scene.personalitySystem
      const tags = ps?.getTags?.(advSrc) ?? new Set()
      const isUnderdog = tags.has('underdog')
      const baseXp = 8
      let xpMul = isUnderdog ? Balance.UNDERDOG_XP_MULT : 1

      // Phase QW — underdog_cleric_fan combo ("Believer's Boost"): if any
      // alive party-mate has the `fan` tag, the underdog's XP multiplier
      // gains an extra 50% on top of UNDERDOG_XP_MULT (2× → 3×).
      if (isUnderdog && advSrc.partyId && ps) {
        const hasFanInParty = this._gameState.adventurers.active.some(a =>
          a.partyId === advSrc.partyId &&
          a.instanceId !== advSrc.instanceId &&
          a.aiState !== 'dead' &&
          ps.getTags(a).has('fan')
        )
        if (hasFanInParty) {
          xpMul *= 1.5
          EventBus.emit('BELIEVERS_BOOST', { underdog: advSrc, finalXpMul: xpMul })
        }
      }
      this._awardAdventurerXp(advSrc, Math.round(baseXp * xpMul))
      return
    }

    // Minion kills no longer grant XP / levels (kill-XP removed 2026-05-29 —
    // minion power now comes from boss-level scaling + gold-paid tier upgrades).
    // Kills still trigger the kill-themed evolutionPath specializations (names +
    // abilities, with stat deltas stripped — see _applyEvolution) and the
    // bounty/★ danger flag for the Bounty-Hunter event.
    const minion = this._gameState.minions.find(m => m.instanceId === sourceId)
    if (!minion) return
    if (minion.faction === 'adventurer') return
    if (minion._isHauntGhost) return
    const victim = this._gameState.adventurers.graveyard.find(a => a.instanceId === targetId) ??
                   this._gameState.adventurers.active.find(a => a.instanceId === targetId)
    if (!victim) return
    this._checkEvolutions(minion, { damageType, method })
    this._checkBounty(minion)
  }

  // Phase 7b: very simple adventurer XP curve (lv2 at 30, +30/lv).
  // Each level: +3 attack, +5 maxHp.
  _awardAdventurerXp(adv, amount) {
    adv.xp = (adv.xp ?? 0) + amount
    while (adv.xp >= 30 * (adv.level ?? 1)) {
      adv.level = (adv.level ?? 1) + 1
      adv.stats.attack    = (adv.stats.attack    ?? 0) + 3
      adv.resources.maxHp = (adv.resources.maxHp ?? 0) + 5
      adv.resources.hp    = Math.min(adv.resources.maxHp, adv.resources.hp + 5)
      // The cosmetic display level rises in step with the XP level-up so
      // the UI reflects the +3 ATK / +5 HP they just gained.
      if (adv.displayLevel != null) adv.displayLevel += 1
      EventBus.emit('ADVENTURER_LEVELED_UP', { adventurer: adv, newLevel: adv.level })
    }
  }

  // ── Evolution check ───────────────────────────────────────────────────────

  _checkEvolutions(minion) {
    // Phase 1b.8 — Wraith Haunt ghosts are spectres locked to their summoning
    // form (ghost2). They never advance an evolution stage no matter how many
    // adventurers they cull, since the boss's ability defines what they are.
    if (minion?._isHauntGhost) return
    const def = this._defs[minion.definitionId]
    if (!def?.evolutionPaths?.length) return

    const history = minion.killHistory ?? []
    const alreadyEvolved = new Set((minion.evolutionHistory ?? []).map(e => e.id))

    for (const path of def.evolutionPaths) {
      if (alreadyEvolved.has(path.id)) continue
      if (!this._evolutionConditionMet(history, minion, path.condition)) continue
      this._applyEvolution(minion, path)
      EventBus.emit('MINION_EVOLVED', { minion, evolutionId: path.id, evolution: path })
      // Allow chained evolutions in the same kill (rare but possible)
    }
  }

  _evolutionConditionMet(history, minion, cond) {
    if (!cond) return false

    if (cond.killMethod && cond.killCount) {
      const matches = history.filter(k => k.method === cond.killMethod || k.damageType === cond.killMethod)
      return matches.length >= cond.killCount
    }
    if (cond.killedClassType && cond.killCount) {
      const matches = history.filter(k => k.targetClass === cond.killedClassType)
      return matches.length >= cond.killCount
    }
    if (cond.daysAliveWithoutKill != null) {
      const lastKillDay = history.length ? history[history.length - 1].day : null
      const days = (this._gameState.meta.dayNumber - (lastKillDay ?? 0))
      return history.length === 0 && days >= cond.daysAliveWithoutKill
    }
    if (cond.timesKilledAndRespawned != null) {
      // Phase 7b: counter is incremented in MinionAISystem.respawnAll
      return (minion.timesKilledAndRespawned ?? 0) >= cond.timesKilledAndRespawned
    }
    return false
  }

  _applyEvolution(minion, path) {
    // Stat deltas stripped 2026-05-29: evolutionPath specializations now grant
    // only the kill-themed NAME + ABILITY (flavor / utility), never raw stats.
    // Minion power comes solely from boss-level scaling + gold tier upgrades.
    if (path.newAbility) {
      minion.stats.abilities ??= []
      if (!minion.stats.abilities.includes(path.newAbility)) {
        minion.stats.abilities.push(path.newAbility)
      }
    }

    minion.evolutionHistory ??= []
    minion.evolutionHistory.push({
      id:         path.id,
      name:       path.name,
      day:        this._gameState.meta.dayNumber,
      flavorText: path.flavorText ?? null,
    })

    // Evolved minions take on the evolution's name as their new title
    minion.name = path.name + (minion.name ? ` (was ${minion.name})` : '')
  }

  // ── Bounty ────────────────────────────────────────────────────────────────

  _checkBounty(minion) {
    minion.bountyKillCount = (minion.bountyKillCount ?? 0) + 1
    if (!minion.hasBounty && minion.bountyKillCount >= 3) {
      minion.hasBounty = true
      EventBus.emit('MINION_BOUNTY_POSTED', { minion })
    }
  }
}

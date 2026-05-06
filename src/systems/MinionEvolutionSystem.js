// Per-instance minion evolution.
//
// Each minion that lands an adventurer kill increments `_killsSinceReset`.
// At KILLS_TO_EVOLVE, the minion mutates `definitionId` to the next id in
// its evolution chain (data lives in `src/data/minionEvolutions.json`),
// adopts the new def's base stats, full-heals, and the kill counter resets.
// On the final form, mini-boss multipliers apply.
//
// Death sets `_pendingEvolutionReset = true`. Game._onNightStart calls
// `applyResets()` BEFORE `MinionAISystem.respawnAll()` so the starter def's
// stats are in place when respawn full-heals to maxHp.

import { EventBus }             from './EventBus.js'
import { Balance }              from '../config/balance.js'
import { applyMinionScaling } from '../entities/Minion.js'

const KILLS_TO_EVOLVE = 2

export class MinionEvolutionSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._chains    = scene.cache.json.get('minionEvolutions') ?? {}
    const defs      = scene.cache.json.get('minionTypes') ?? []
    this._defMap    = Object.fromEntries(defs.map(d => [d.id, d]))

    EventBus.on('COMBAT_KILL', this._onCombatKill, this)
    EventBus.on('MINION_DIED', this._onMinionDied, this)
  }

  destroy() {
    EventBus.off('COMBAT_KILL', this._onCombatKill, this)
    EventBus.off('MINION_DIED', this._onMinionDied, this)
  }

  // Look up the chain that contains the given def id.
  _chainContaining(defId) {
    for (const v of Object.values(this._chains)) {
      if (Array.isArray(v?.chain) && v.chain.includes(defId)) return v.chain
    }
    return null
  }

  // ── Kill / evolve ─────────────────────────────────────────────────────────

  _onCombatKill({ sourceId, targetId }) {
    const minion = (this._gameState.minions ?? []).find(m => m.instanceId === sourceId)
    if (!minion || minion.aiState === 'dead') return
    // Phase 1b.8 — Wraith Haunt ghosts are locked to ghost2; they don't
    // advance up the chain regardless of kill count.
    if (minion._isHauntGhost) return
    // Only adventurer kills count toward evolution.
    const target = (this._gameState.adventurers?.active ?? []).find(a => a.instanceId === targetId)
    if (!target) return

    minion._killsSinceReset = (minion._killsSinceReset ?? 0) + 1
    if (minion._killsSinceReset >= KILLS_TO_EVOLVE) {
      this._evolve(minion)
      minion._killsSinceReset = 0
    }
  }

  _evolve(minion) {
    const chain = this._chainContaining(minion.definitionId)
    if (!chain) return
    const idx = chain.indexOf(minion.definitionId)
    if (idx < 0 || idx >= chain.length - 1) return  // already at final form

    const nextId  = chain[idx + 1]
    const nextDef = this._defMap[nextId]
    if (!nextDef) return

    minion.definitionId = nextId
    minion.spriteKey    = nextDef.spriteKey

    // Adopt new base stats; full heal to new max HP.
    const stats = nextDef.baseStats ?? {}
    if (stats.attack  != null) minion.stats.attack  = stats.attack
    if (stats.defense != null) minion.stats.defense = stats.defense
    if (stats.speed   != null) minion.stats.speed   = stats.speed
    if (stats.damageType) minion.damageType = stats.damageType
    minion.attackRange = nextDef.attackRange ?? stats.attackRange ?? minion.attackRange ?? 1
    if (stats.hp != null) minion.resources.maxHp = stats.hp
    minion.resources.hp = minion.resources.maxHp

    // Final form → mini-boss promotion using the existing constants.
    const isFinal = (idx + 1 === chain.length - 1)
    if (isFinal) {
      minion.isMiniBoss      = true
      minion.stats.attack    = Math.round(minion.stats.attack    * Balance.MINIBOSS_ATTACK_MULT)
      minion.resources.maxHp = Math.round(minion.resources.maxHp * Balance.MINIBOSS_HP_MULT)
      minion.resources.hp    = minion.resources.maxHp
      EventBus.emit('MINIBOSS_PROMOTED', { minion })
    }
    EventBus.emit('MINION_EVOLVED', { minion, fromIdx: idx, toIdx: idx + 1, isFinal })
  }

  // ── Death / reset ─────────────────────────────────────────────────────────

  _onMinionDied({ minion }) {
    if (!minion) return
    minion._pendingEvolutionReset = true
  }

  // Called from Game._onNightStart BEFORE respawnAll(). Reverts any minion
  // flagged with `_pendingEvolutionReset` back to its chain's starter def.
  // Does nothing for minions never tied to a chain.
  applyResets() {
    for (const m of this._gameState.minions ?? []) {
      if (!m._pendingEvolutionReset) continue
      if (m.isUndead) { m._pendingEvolutionReset = false; continue }
      const chain = this._chainContaining(m.definitionId)
      if (!chain) {
        m._pendingEvolutionReset = false
        continue
      }
      const starterId  = chain[0]
      const starterDef = this._defMap[starterId]
      if (!starterDef) {
        m._pendingEvolutionReset = false
        continue
      }
      m.definitionId = starterId
      m.spriteKey    = starterDef.spriteKey
      m.isMiniBoss   = false
      m._killsSinceReset = 0
      const stats = starterDef.baseStats ?? {}
      if (stats.attack  != null) m.stats.attack  = stats.attack
      if (stats.defense != null) m.stats.defense = stats.defense
      if (stats.speed   != null) m.stats.speed   = stats.speed
      if (stats.damageType) m.damageType = stats.damageType
      m.attackRange = starterDef.attackRange ?? stats.attackRange ?? m.attackRange ?? 1
      if (stats.hp != null) m.resources.maxHp = stats.hp
      m.resources.hp = m.resources.maxHp
      m.bossLevel = 1
      const bossLv = this._gameState.boss?.level ?? 1
      const day    = this._gameState.meta?.dayNumber ?? 1
      applyMinionScaling(m, bossLv, day)
      m._pendingEvolutionReset = false
      EventBus.emit('MINION_EVOLUTION_RESET', { minion: m })
    }
  }
}

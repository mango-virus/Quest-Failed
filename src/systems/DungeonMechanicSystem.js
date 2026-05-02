// Phase 9 — DungeonMechanicSystem.
//
// Manages the set of "active" dungeon mechanics chosen by the player at end-of-day.
// Mechanics are JSON-defined in src/data/dungeonMechanics.json. Each definition
// references handler IDs (onActivate, onDeactivate, onDailyTick) which are
// looked up in the handler registry below.
//
// Active mechanics live on `gameState.activeMechanics` (an array of mechanic
// IDs) so they survive saves. On Game scene boot we re-activate every entry by
// calling its onActivate handler — most handlers just subscribe to bus events.
//
// Public API:
//   loadDefinitions()                  // pull from cache.json('dungeonMechanics')
//   activate(mechanicId)               // adds to active set + runs onActivate
//   deactivate(mechanicId)             // removes + runs onDeactivate
//   isActive(mechanicId) → boolean
//   getDefinition(id) → def
//   getOfferings(count, archetypeId)   // filtered random selection for EndOfDay
//   tickDay(deltaMs)                   // routed by Game.update during day phase
//   tickEndOfDay()                     // newspaper + onDailyTick handlers fire
//
// Handlers receive `(ctx)` where ctx exposes scene, gameState, and the system itself.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

export class DungeonMechanicSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._defs = {}
    this._loaded = false
    this._handlers = _buildHandlerRegistry()
    // Per-mechanic local state (timers, subscriptions) — keyed by mechanicId
    this._state = {}

    this._gameState.activeMechanics ??= []

    // Per-mechanic event subscriptions are registered in the handler registry
    // and we track them here so deactivate can clean up.
    this._subscriptions = {}    // mechanicId → [[event, fn], ...]
  }

  destroy() {
    for (const id of [...this._gameState.activeMechanics]) {
      this._runDeactivate(id)
    }
  }

  loadDefinitions() {
    if (this._loaded) return
    const defs = this._scene.cache.json.get('dungeonMechanics') ?? []
    this._defs = Object.fromEntries(defs.map(d => [d.id, d]))
    this._loaded = true

    // Re-activate any mechanics already in saved state (subscribes their listeners)
    for (const id of this._gameState.activeMechanics) {
      this._runActivate(id)
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  isActive(mechanicId) { return this._gameState.activeMechanics.includes(mechanicId) }

  getDefinition(id)    { return this._defs[id] ?? null }

  allDefinitions()     { return Object.values(this._defs) }

  activate(mechanicId) {
    if (this.isActive(mechanicId)) return
    const def = this._defs[mechanicId]
    if (!def) {
      console.warn(`[DungeonMechanicSystem] Unknown mechanic '${mechanicId}'`)
      return
    }
    // Enforce exclusiveWith — drop mechanics that conflict
    for (const conflictId of (def.exclusiveWith ?? [])) {
      if (this.isActive(conflictId)) this.deactivate(conflictId)
    }
    this._gameState.activeMechanics.push(mechanicId)
    this._runActivate(mechanicId)
    EventBus.emit('MECHANIC_ACTIVATED', { mechanicId, def })
  }

  deactivate(mechanicId) {
    const idx = this._gameState.activeMechanics.indexOf(mechanicId)
    if (idx === -1) return
    this._runDeactivate(mechanicId)
    this._gameState.activeMechanics.splice(idx, 1)
    EventBus.emit('MECHANIC_DEACTIVATED', { mechanicId })
  }

  // Random N mechanics that are: not already active, not blocked by archetype,
  // unlockLevel ≤ current dungeon level + 1 (so unlocks ladder smoothly).
  getOfferings(count, archetypeId, dungeonLevel = 1) {
    const active = new Set(this._gameState.activeMechanics)
    // Bug fix — JSON modifiers expose `blockedMechanicTags` (array of tag
    // strings), not `blockedMechanics` (mechanic IDs). Match by tag.
    const mods = this._gameState.player?.archetypeModifiers ?? {}
    const blockedTags = new Set(mods.blockedMechanicTags ?? [])
    const availableTags = new Set(mods.availableMechanicTags ?? [])
    const candidates = this.allDefinitions().filter(def => {
      if (active.has(def.id)) return false
      const defTags = def.tags ?? []
      // Block if any of this def's tags is in the archetype's blocked set
      if (defTags.some(t => blockedTags.has(t))) return false
      if ((def.unlockLevel ?? 1) > dungeonLevel + 1) return false
      // exclusiveWith already-active → not offerable
      for (const conflictId of (def.exclusiveWith ?? [])) {
        if (active.has(conflictId)) return false
      }
      // If archetype declares an availableMechanicTags list, this def must
      // overlap at least one of those tags. Empty list = no preference.
      if (availableTags.size > 0 && !defTags.some(t => availableTags.has(t))) {
        // Allow the def through if it's untagged-relevant — only filter when
        // the archetype explicitly enumerated its preferred mechanic theme.
        // Use as a soft-preference rather than hard filter to avoid empty pools.
        // (Soft preference: keep candidates list but rerank could be added later.)
      }
      // archetype availability (string 'all' or array of archetype ids)
      const avail = def.availableToArchetypes
      if (Array.isArray(avail) && archetypeId && !avail.includes(archetypeId)) return false
      return true
    })
    return _weightedSample(candidates, count)
  }

  // Day-phase tick — fires per-mechanic onDailyTick handlers (when registered).
  tickDay(deltaMs) {
    for (const id of this._gameState.activeMechanics) {
      const def = this._defs[id]
      const tickHandler = def?.onDailyTick && this._handlers[def.onDailyTick]
      if (!tickHandler) continue
      tickHandler(this._ctx(), deltaMs)
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  _runActivate(mechanicId) {
    const def = this._defs[mechanicId]
    if (!def) return
    const handler = this._handlers[def.onActivate]
    if (!handler) {
      // Soft-fail — definition exists but handler not yet implemented (data-only)
      return
    }
    this._state[mechanicId] ??= {}
    handler(this._ctx(mechanicId))
  }

  _runDeactivate(mechanicId) {
    const def = this._defs[mechanicId]
    if (!def) return
    const handler = this._handlers[def.onDeactivate]
    if (handler) handler(this._ctx(mechanicId))

    // Clean up any subscriptions registered under this mechanicId
    for (const [event, fn] of (this._subscriptions[mechanicId] ?? [])) {
      EventBus.off(event, fn)
    }
    this._subscriptions[mechanicId] = []
    this._state[mechanicId] = {}
  }

  _ctx(mechanicId) {
    return {
      scene:      this._scene,
      gameState:  this._gameState,
      system:     this,
      mechanicId,
      state:      mechanicId ? (this._state[mechanicId] ??= {}) : null,
      subscribe:  (event, fn) => {
        EventBus.on(event, fn)
        this._subscriptions[mechanicId] ??= []
        this._subscriptions[mechanicId].push([event, fn])
      },
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

// Draws `count` unique items from `pool` without replacement, respecting each
// item's `weight` field (defaults to 1). Higher weight = proportionally more
// likely to be picked on each draw.
function _weightedSample(pool, count) {
  if (pool.length === 0) return []
  const result = []
  const remaining = pool.map(def => ({ def, weight: def.weight ?? 1 }))
  const n = Math.min(count, pool.length)
  for (let i = 0; i < n; i++) {
    const total = remaining.reduce((s, e) => s + e.weight, 0)
    let roll = Math.random() * total
    let idx = 0
    for (; idx < remaining.length - 1; idx++) {
      roll -= remaining[idx].weight
      if (roll <= 0) break
    }
    result.push(remaining[idx].def)
    remaining.splice(idx, 1)
  }
  return result
}

// ── Handler registry ──────────────────────────────────────────────────────
// Each handler is (ctx) => void. Use ctx.subscribe(event, fn) for bus listeners
// so they unwire automatically on deactivate.

function _buildHandlerRegistry() {
  return {
    // ── Taxation of Souls ────────────────────────────────────────────────
    taxationOfSouls_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), taxationOfSouls: true }
      subscribe('ROOM_OBSERVED', ({ adventurer, firstVisit }) => {
        if (!firstVisit || !adventurer) return
        const dmg = Math.max(1, Math.round((adventurer.resources?.maxHp ?? 0) * Balance.MECHANIC_TAXATION_HP_FRACTION))
        adventurer.resources.hp = Math.max(0, adventurer.resources.hp - dmg)
        EventBus.emit('TAXED', { adventurer, damage: dmg })
      })
    },
    taxationOfSouls_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.taxationOfSouls = false
    },

    // ── Bloodbound ───────────────────────────────────────────────────────
    bloodbound_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), bloodbound: true }
    },
    bloodbound_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.bloodbound = false
    },

    // ── Gold Rush ────────────────────────────────────────────────────────
    goldRush_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), goldRush: true }
    },
    goldRush_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.goldRush = false
    },

    // ── Undying Horde ────────────────────────────────────────────────────
    undyingHorde_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), undyingHorde: true }
      subscribe('MINION_DIED', ({ minion }) => {
        if (!minion || minion.isUndead) return
        if (Math.random() > Balance.MECHANIC_UNDYING_HORDE_REVIVE_CHANCE) return
        minion.aiState = 'idle'
        minion.resources.hp = Math.max(1,
          Math.floor(minion.resources.maxHp * Balance.MECHANIC_UNDYING_HORDE_HP_FRACTION))
        minion.isUndead = true
        minion._pendingEvolutionReset = false
        EventBus.emit('UNDYING_HORDE_REVIVED', { minion })
      })
    },
    undyingHorde_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.undyingHorde = false
      for (const m of gameState.minions ?? []) m.isUndead = false
    },

    // ── Sealed Paths ─────────────────────────────────────────────────────
    sealedPaths_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), sealedPaths: true }
    },
    sealedPaths_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.sealedPaths = false
    },

    // ── Pack Synergy ─────────────────────────────────────────────────────
    packSynergy_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), packSynergy: true }
    },
    packSynergy_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.packSynergy = false
    },

    // ── Blood Money ──────────────────────────────────────────────────────
    bloodMoney_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), bloodMoney: true }
      gameState._mechanicFlags.bloodMoneyKills   ??= 0
      gameState._mechanicFlags.bloodMoneyHpBonus ??= 0
      subscribe('RESOURCES_AWARDED', ({ reason }) => {
        if (reason !== 'adventurer_kill') return
        gameState._mechanicFlags.bloodMoneyKills++
        gameState._mechanicFlags.bloodMoneyHpBonus =
          Math.floor(gameState._mechanicFlags.bloodMoneyKills / 5)
          * Balance.MECHANIC_BLOOD_MONEY_HP_PER_FIVE_KILLS
      })
      subscribe('NIGHT_PHASE_STARTED', () => {
        const passive = gameState._mechanicFlags.bloodMoneyKills ?? 0
        if (passive > 0) {
          gameState.player.soulEssence = (gameState.player.soulEssence ?? 0) + passive
          EventBus.emit('RESOURCES_AWARDED', { gold: passive, reason: 'blood_money_passive' })
        }
      })
    },
    bloodMoney_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.bloodMoney = false
    },
  }
}


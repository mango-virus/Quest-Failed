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
import { createMinion, applyBossLevelToMinion } from '../entities/Minion.js'
import { rosterCap } from '../util/slotCaps.js'

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
  // unlockLevel gating REMOVED 2026-05-06 per user direction: every
  // pact is eligible from day 1, with rarity weighting (TIER_WEIGHTS in
  // _weightedSample) preserving the "legendaries are rare" feel. The
  // dungeonLevel param is still accepted so callers don't need to change.
  // opts.onlyDamned — when true (a "black grimoire" hand), draw exclusively
  // from the Damned (solid-black) tier so every offered card is a curse.
  getOfferings(count, archetypeId, dungeonLevel = 1, opts = {}) {
    const onlyDamned = !!opts.onlyDamned
    const active = new Set(this._gameState.activeMechanics)
    // Bug fix — JSON modifiers expose `blockedMechanicTags` (array of tag
    // strings), not `blockedMechanics` (mechanic IDs). Match by tag.
    const mods = this._gameState.player?.archetypeModifiers ?? {}
    const blockedTags = new Set(mods.blockedMechanicTags ?? [])
    const availableTags = new Set(mods.availableMechanicTags ?? [])
    const candidates = this.allDefinitions().filter(def => {
      if (active.has(def.id)) return false
      // Black-grimoire hands draw only from the damned tier; the normal
      // (purple) pool keeps damned pacts mixed in at their epic-equal weight.
      if (onlyDamned && def.rarity !== 'damned') return false
      const defTags = def.tags ?? []
      // Block if any of this def's tags is in the archetype's blocked set
      if (defTags.some(t => blockedTags.has(t))) return false
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

  // Pact of the Crucible — once-per-run sacrifice. UI hooks call this with
  // a sacrifice victim and an evolve target in the same room. Returns
  // { ok: true } or { ok: false, error }.
  crucibleSacrifice(victimId, targetId) {
    const f = this._gameState._mechanicFlags ?? {}
    if (!f.pactOfTheCrucible) return { ok: false, error: 'pact not active' }
    if (f.crucibleUsed)       return { ok: false, error: 'already used this run' }
    const minions = this._gameState.minions ?? []
    const victim  = minions.find(m => m.instanceId === victimId)
    const target  = minions.find(m => m.instanceId === targetId)
    if (!victim || !target) return { ok: false, error: 'minion not found' }
    if (victim.assignedRoomId !== target.assignedRoomId) return { ok: false, error: 'must be in same room' }
    // Remove victim, evolve target (delegate to evolution system if present)
    const idx = minions.indexOf(victim)
    if (idx >= 0) minions.splice(idx, 1)
    const evoSys = this._scene.scene?.get?.('Game')?.minionEvolutionSystem ?? this._scene.minionEvolutionSystem
    if (evoSys?._evolve) evoSys._evolve(target)
    f.crucibleUsed = true
    EventBus.emit('CRUCIBLE_SACRIFICED', { victimId, targetId })
    return { ok: true }
  }

  // Day-phase tick — fires per-mechanic onDailyTick handlers (when registered).
  tickDay(deltaMs) {
    for (const id of this._gameState.activeMechanics) {
      const def = this._defs[id]
      const tickHandler = def?.onDailyTick && this._handlers[def.onDailyTick]
      if (!tickHandler) continue
      tickHandler(this._ctx(), deltaMs)
    }
    this._tickSunderedFloor()
    this._tickCursedSoil(deltaMs)
  }

  // Sundered Floor pit triggers — fires when telegraph elapses, dmg+stuns
  // anyone standing on the tile, then marks tile blackened until night.
  _tickSunderedFloor() {
    const f = this._gameState._mechanicFlags ?? {}
    if (!f.sunderedFloor) return
    const pits = f.sunderedFloorPits ?? []
    const now = this._scene?.time?.now ?? 0
    for (const pit of pits) {
      if (pit.fired) continue
      if (now < pit.triggerAt) continue
      pit.fired = true
      pit.blackened = true
      const dmgFrac = Balance.MECHANIC_SUNDERED_FLOOR_DAMAGE_FRAC
      const stunMs  = Balance.MECHANIC_SUNDERED_FLOOR_STUN_MS
      // Hit any adv on the pit tile.
      for (const adv of (this._gameState.adventurers?.active ?? [])) {
        if (adv.tileX === pit.tileX && adv.tileY === pit.tileY) {
          const dmg = Math.max(1, Math.floor((adv.resources.maxHp ?? 0) * dmgFrac))
          adv.resources.hp = Math.max(0, adv.resources.hp - dmg)
          // Death attribution — a sundered-floor pit that kills is credited
          // to the boss (the dungeon's mechanic) so it doesn't show as
          // "Unknown" in the graveyard.
          adv._lastHitBy   = 'boss'
          adv._lastHitType = 'collapse'
          adv._sunderedStunUntil = now + stunMs
        }
      }
      // Hit any minion on the pit tile (also catches the backfire case).
      for (const m of (this._gameState.minions ?? [])) {
        if (m.aiState === 'dead') continue
        if (m.tileX === pit.tileX && m.tileY === pit.tileY) {
          const dmg = Math.max(1, Math.floor((m.resources.maxHp ?? 0) * dmgFrac))
          m.resources.hp = Math.max(0, m.resources.hp - dmg)
        }
      }
      EventBus.emit('SUNDERED_FLOOR_FIRED', { tileX: pit.tileX, tileY: pit.tileY, backfire: !!pit._backfire })
    }
  }

  // Cursed Soil — 1 dmg/sec to anyone standing on an "empty floor" tile:
  // a dungeon floor tile that lies outside every room (the bare connective
  // corridors). Standing inside a room is safe ground.
  _tickCursedSoil(deltaMs) {
    const f = this._gameState._mechanicFlags ?? {}
    if (!f.cursedSoil) return
    f._cursedSoilAccumMs = (f._cursedSoilAccumMs ?? 0) + deltaMs
    if (f._cursedSoilAccumMs < 1000) return
    f._cursedSoilAccumMs -= 1000
    const dmg = Balance.MECHANIC_CURSED_SOIL_DPS
    const rooms = this._gameState.dungeon?.rooms ?? []
    // True only when the tile lies outside every room footprint.
    const onEmptyFloor = (tx, ty) => {
      if (tx == null || ty == null) return false
      for (const r of rooms) {
        if (tx >= r.gridX && tx < r.gridX + r.width &&
            ty >= r.gridY && ty < r.gridY + r.height) return false
      }
      return true
    }
    for (const adv of (this._gameState.adventurers?.active ?? [])) {
      if (adv.aiState === 'dead' || adv.aiState === 'leaving') continue
      if (!onEmptyFloor(adv.tileX, adv.tileY)) continue
      adv.resources.hp = Math.max(0, adv.resources.hp - dmg)
      // Death attribution — cursed-soil ticks credit the boss so a kill on
      // a standing-still adv (parked on a corridor tile) doesn't read as
      // "Unknown" in the graveyard.
      adv._lastHitBy   = 'boss'
      adv._lastHitType = 'curse'
    }
    for (const m of (this._gameState.minions ?? [])) {
      if (m.aiState === 'dead') continue
      if (!onEmptyFloor(m.tileX, m.tileY)) continue
      m.resources.hp = Math.max(0, m.resources.hp - dmg)
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

// Aggregate per-card draw rates per rarity tier. These numbers ARE the
// observed percentages (sum to 100), so picking a card means: roll a tier
// using these weights, then pick a random pact within that tier. Empty
// tiers collapse to 0 weight for that draw.
const TIER_WEIGHTS = {
  common:    Balance.MECHANIC_RARITY_WEIGHT_COMMON    ?? 45,
  uncommon:  Balance.MECHANIC_RARITY_WEIGHT_UNCOMMON  ?? 25,
  rare:      Balance.MECHANIC_RARITY_WEIGHT_RARE      ?? 15,
  epic:      Balance.MECHANIC_RARITY_WEIGHT_EPIC      ?? 10,
  legendary: Balance.MECHANIC_RARITY_WEIGHT_LEGENDARY ?? 5,
  // Damned (solid-black) pacts mix into the normal pool at epic weight.
  damned:    Balance.MECHANIC_RARITY_WEIGHT_DAMNED    ?? 12,
}
const TIER_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'damned']

// Draws `count` unique pacts from `pool`, picking a rarity tier first
// according to TIER_WEIGHTS then a random pact within that tier. If the
// chosen tier is exhausted its weight collapses to 0 for the next draws.
function _weightedSample(pool, count) {
  if (pool.length === 0) return []
  const buckets = { common: [], uncommon: [], rare: [], epic: [], legendary: [], damned: [] }
  for (const def of pool) {
    const tier = def.rarity ?? 'common'
    if (buckets[tier]) buckets[tier].push(def)
    else buckets.common.push(def)   // unknown rarity -> common pool
  }
  const result = []
  const drawn  = new Set()
  const n = Math.min(count, pool.length)
  for (let i = 0; i < n; i++) {
    // Build effective tier weights — drop tiers that have no candidates left.
    const eligible = TIER_ORDER.filter(t => buckets[t].some(d => !drawn.has(d.id)))
    if (eligible.length === 0) break
    const totalW = eligible.reduce((s, t) => s + TIER_WEIGHTS[t], 0)
    let roll = Math.random() * totalW
    let tier = eligible[eligible.length - 1]
    for (const t of eligible) {
      roll -= TIER_WEIGHTS[t]
      if (roll <= 0) { tier = t; break }
    }
    const candidates = buckets[tier].filter(d => !drawn.has(d.id))
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    drawn.add(pick.id)
    result.push(pick)
  }
  return result
}

// Pick a random minion definition id at the given evolution tier (1-3) by
// reading `minionEvolutions.json` chains. Returns null if no chain has the
// requested tier slot.
function _pickRandomMinionByTier(scene, tier) {
  const chains = scene?.cache?.json?.get('minionEvolutions') ?? {}
  const candidates = []
  for (const v of Object.values(chains)) {
    if (Array.isArray(v?.chain) && v.chain[tier - 1]) candidates.push(v.chain[tier - 1])
  }
  if (candidates.length === 0) return null
  return candidates[Math.floor(Math.random() * candidates.length)]
}

function _spawnSummonAdds(scene, gameState, tier, count) {
  const bossRoom = gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
  if (!bossRoom) return
  const defs = scene?.cache?.json?.get('minionTypes') ?? []
  const defMap = Object.fromEntries(defs.map(d => [d.id, d]))
  const bossLevel = gameState.boss?.level ?? gameState.player?.bossLevel ?? 1
  for (let i = 0; i < count; i++) {
    const id = _pickRandomMinionByTier(scene, tier)
    const def = id ? defMap[id] : null
    if (!def) continue
    const tx = bossRoom.gridX + Math.floor(bossRoom.width / 2) + (i % 2 === 0 ? -1 : 1)
    const ty = bossRoom.gridY + Math.floor(bossRoom.height / 2)
    const minion = createMinion(def, { x: tx, y: ty }, bossRoom.instanceId, {
      class: 'garrison', bossLevel,
    })
    minion._summonedAdd = true
    minion._summonAddTier = tier
    gameState.minions.push(minion)
    EventBus.emit('MINION_PLACED', { minion })
    EventBus.emit('SUMMON_ADD_SPAWNED', { minion, tier })
  }
}

function _despawnSummonAdds(gameState) {
  if (!Array.isArray(gameState.minions)) return
  const before = gameState.minions.length
  gameState.minions = gameState.minions.filter(m => !m._summonedAdd)
  const removed = before - gameState.minions.length
  if (removed > 0) EventBus.emit('SUMMON_ADDS_DESPAWNED', { count: removed })
}

// Grant a free random Legendary pact (not already active) — the bribe for
// several Damned pacts (Hollow Crown, Pact of the Last Heart). Returns the
// granted pact's id/name (or nulls if the legendary pool is exhausted).
function _grantFreeLegendaryPact(system, excludeId) {
  const pool = system.allDefinitions().filter(d =>
    d.rarity === 'legendary' && !system.isActive(d.id) && d.id !== excludeId)
  if (pool.length === 0) return { grantedId: null, grantedName: null }
  const pickDef = pool[Math.floor(Math.random() * pool.length)]
  system.activate(pickDef.id)
  return { grantedId: pickDef.id, grantedName: pickDef.name ?? pickDef.id }
}

// Apply a permanent stat buff to every alive dungeon minion (the bribe for
// Hollow Horde / Brittle Bones). Bumps the recorded BASE stats so the buff
// survives later level-up rescales, then re-applies scaling.
function _buffCurrentMinions(gameState, { hp = 0, atk = 0, def = 0 } = {}) {
  const bossLv = gameState.boss?.level ?? 1
  for (const m of (gameState.minions ?? [])) {
    if (m.faction !== 'dungeon' || m.aiState === 'dead') continue
    if (m._baseMaxHp == null || m._baseAtk == null) applyBossLevelToMinion(m, bossLv) // init bases
    if (hp)  m._baseMaxHp = Math.round((m._baseMaxHp ?? 0) * (1 + hp))
    if (atk) m._baseAtk   = Math.round((m._baseAtk ?? 0) * (1 + atk))
    if (def && m.stats) m.stats.defense = Math.round((m.stats.defense ?? 0) * (1 + def))
    applyBossLevelToMinion(m, bossLv)
  }
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
        // 5% of CURRENT HP — compounds down per room so a healthy adv
        // loses a real chunk early and a wounded survivor only sheds a
        // sliver (the tax can't itself kill them, and won't tip them into
        // one-shot territory the way a flat max-HP tax used to).
        const dmg = Math.max(1, Math.round((adventurer.resources?.hp ?? 0) * Balance.MECHANIC_TAXATION_HP_FRACTION))
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
          gameState.player.gold = (gameState.player.gold ?? 0) + passive
          EventBus.emit('RESOURCES_AWARDED', { gold: passive, reason: 'blood_money_passive' })
        }
      })
    },
    bloodMoney_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.bloodMoney = false
    },

    // ── The Hasty Architect ──────────────────────────────────────────────
    // Pure flag — trap placement cost is read by NightPhase / BuildMenu
    // and the jam roll is checked by TrapSystem._fireTrap.
    hastyArchitect_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), hastyArchitect: true }
    },
    hastyArchitect_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.hastyArchitect = false
    },

    // ── Pact of the Great Erasure ────────────────────────────────────────
    // Flag suppresses survivor-knowledge saves (KnowledgeSystem reads the
    // flag in its ADVENTURER_FLED handler). On adventurer entry, double
    // base hp/attack/speed.
    greatErasure_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), greatErasure: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer || adventurer._greatErasureBuffed) return
        const m = Balance.MECHANIC_GREAT_ERASURE_STAT_MULT
        adventurer.resources.maxHp = Math.round((adventurer.resources.maxHp ?? 0) * m)
        adventurer.resources.hp    = adventurer.resources.maxHp
        if (adventurer.stats) {
          if (adventurer.stats.attack != null) adventurer.stats.attack = Math.round(adventurer.stats.attack * m)
          if (adventurer.stats.speed  != null) adventurer.stats.speed  = adventurer.stats.speed * m
          if (adventurer.stats.hp     != null) adventurer.stats.hp     = Math.round(adventurer.stats.hp * m)
        }
        adventurer._greatErasureBuffed = true
      })
    },
    greatErasure_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.greatErasure = false
    },

    // ── Schism ───────────────────────────────────────────────────────────
    // Each entering adv has their party bond severed (partyId = null) and
    // gets the noFlee flag so they fight to the death. The null partyId
    // also disables cleric/bard/inspire same-party checks for them.
    schism_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), schism: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer) return
        adventurer.partyId = null
        adventurer.flags ??= {}
        adventurer.flags.noFlee = true
      })
    },
    schism_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.schism = false
    },

    // ── Glory Hounds ─────────────────────────────────────────────────────
    // noFlee at entry; CombatSystem reads gloryHounds flag to apply +50%
    // attack damage when adv hpFrac <= MECHANIC_GLORY_HOUNDS_HP_THRESHOLD.
    gloryHounds_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), gloryHounds: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer) return
        adventurer.flags ??= {}
        adventurer.flags.noFlee = true
      })
    },
    gloryHounds_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.gloryHounds = false
    },

    // ── Sworn Rivals ─────────────────────────────────────────────────────
    // First two same-party arrivals are paired via flags.swornRivalOf.
    // AISystem combat fork attacks the rival when both <= 50% HP.
    // CombatSystem grants +25% damage at full HP.
    swornRivals_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), swornRivals: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer?.partyId) return
        const sameParty = (gameState.adventurers?.active ?? []).filter(a =>
          a.partyId === adventurer.partyId && a.aiState !== 'dead'
        )
        // Skip if anyone in this party already has a rival assigned.
        if (sameParty.some(a => a.flags?.swornRivalOf)) return
        const candidates = sameParty.filter(a => !a.flags?.swornRivalOf)
        if (candidates.length < 2) return
        const [a, b] = candidates
        a.flags ??= {}; b.flags ??= {}
        a.flags.swornRivalOf = b.instanceId
        b.flags.swornRivalOf = a.instanceId
      })
    },
    swornRivals_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.swornRivals = false
    },

    // ── Famine Decree ────────────────────────────────────────────────────
    // Pure flag — CombatSystem._computeDamage scales adv attack by hpFrac.
    famineDecree_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), famineDecree: true }
    },
    famineDecree_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.famineDecree = false
    },

    // ── Gilded Demise ────────────────────────────────────────────────────
    // +50% gold (applied in AISystem._kill alongside other gold mults).
    // Tracks today's kill-gold; at NIGHT_PHASE_STARTED it converts to
    // gildedDemiseExtraAdvs which DayPhase reads next morning.
    gildedDemise_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.gildedDemise = true
      f.gildedDemiseEarnedToday ??= 0
      f.gildedDemiseExtraAdvs   ??= 0
      subscribe('RESOURCES_AWARDED', ({ reason, gold }) => {
        if (reason !== 'adventurer_kill' || !gold) return
        gameState._mechanicFlags.gildedDemiseEarnedToday =
          (gameState._mechanicFlags.gildedDemiseEarnedToday ?? 0) + gold
      })
      subscribe('NIGHT_PHASE_STARTED', () => {
        const earned = gameState._mechanicFlags.gildedDemiseEarnedToday ?? 0
        gameState._mechanicFlags.gildedDemiseExtraAdvs =
          Math.floor(earned / Balance.MECHANIC_GILDED_DEMISE_GOLD_PER_ADV)
        gameState._mechanicFlags.gildedDemiseEarnedToday = 0
      })
    },
    gildedDemise_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.gildedDemise = false
    },

    // ── Pyramid Scheme ───────────────────────────────────────────────────
    // First kill of day = 5× gold; rest = 0.5×. AISystem._kill reads the
    // counter; this handler resets it on DAY_PHASE_STARTED.
    pyramidScheme_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.pyramidScheme = true
      f.pyramidKillsToday ??= 0
      subscribe('DAY_PHASE_STARTED', () => {
        gameState._mechanicFlags.pyramidKillsToday = 0
      })
    },
    pyramidScheme_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.pyramidScheme = false
    },

    // ── Ransom Note ──────────────────────────────────────────────────────
    // Speed bump on entry, ransom payout on flee.
    ransomNote_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), ransomNote: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer?.stats || adventurer._ransomBuffed) return
        adventurer.stats.speed = (adventurer.stats.speed ?? 1.5) * Balance.MECHANIC_RANSOM_SPEED_MULT
        adventurer._ransomBuffed = true
      })
      subscribe('ADVENTURER_FLED', () => {
        gameState.player.gold = (gameState.player.gold ?? 0) + Balance.MECHANIC_RANSOM_GOLD_PER_ESCAPE
        EventBus.emit('RESOURCES_AWARDED', {
          gold:   Balance.MECHANIC_RANSOM_GOLD_PER_ESCAPE,
          reason: 'ransom_payout',
        })
      })
    },
    ransomNote_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.ransomNote = false
    },

    // ── Tax the Living ───────────────────────────────────────────────────
    // 3g per entry + 20% maxHp at spawn.
    taxTheLiving_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), taxTheLiving: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer || adventurer._taxLivingBuffed) return
        gameState.player.gold = (gameState.player.gold ?? 0) + Balance.MECHANIC_TAX_LIVING_GOLD_PER_ENTRY
        EventBus.emit('RESOURCES_AWARDED', {
          gold:   Balance.MECHANIC_TAX_LIVING_GOLD_PER_ENTRY,
          reason: 'tax_living_toll',
        })
        adventurer.resources.maxHp = Math.round((adventurer.resources.maxHp ?? 0) * Balance.MECHANIC_TAX_LIVING_HP_MULT)
        adventurer.resources.hp    = adventurer.resources.maxHp
        adventurer._taxLivingBuffed = true
      })
    },
    taxTheLiving_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.taxTheLiving = false
    },

    // ── Tower Tax ────────────────────────────────────────────────────────
    // Pure flag — CombatSystem reads attacker._towerTaxFirstShotConsumed.
    // The "first attack of the day" promise needs an explicit daily reset
    // so returning adventurers (KNOWLEDGE_RETURN_CHANCE) miss again on
    // their second visit.
    towerTax_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), towerTax: true }
      subscribe('DAY_PHASE_STARTED', () => {
        for (const adv of (gameState.adventurers?.active ?? [])) {
          adv._towerTaxFirstShotConsumed = false
        }
      })
    },
    towerTax_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.towerTax = false
    },

    // ── Crusader's Curse ─────────────────────────────────────────────────
    // +50% HP for healer classes at spawn; ClassAbilitySystem reads flag
    // to skip cleric/bard heal effects.
    crusadersCurse_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), crusadersCurse: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer || adventurer._crusaderBuffed) return
        if (adventurer.classId === 'cleric' || adventurer.classId === 'bard') {
          adventurer.resources.maxHp = Math.round((adventurer.resources.maxHp ?? 0) * Balance.MECHANIC_CRUSADERS_HP_MULT)
          adventurer.resources.hp    = adventurer.resources.maxHp
          adventurer._crusaderBuffed = true
        }
      })
    },
    crusadersCurse_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.crusadersCurse = false
    },

    // ── Kennel Discipline ────────────────────────────────────────────────
    // Apply +50% speed to all current and future minions; flag blocks
    // patrol logic in MinionAISystem.
    kennelDiscipline_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), kennelDiscipline: true }
      const buff = (m) => {
        if (!m?.stats || m._kennelBuffed) return
        m.stats.speed = (m.stats.speed ?? 1) * Balance.MECHANIC_KENNEL_SPEED_MULT
        m._kennelBuffed = true
      }
      for (const m of (gameState.minions ?? [])) buff(m)
      subscribe('MINION_PLACED', ({ minion }) => buff(minion))
    },
    kennelDiscipline_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.kennelDiscipline = false
    },

    // ── Ironhide Rite ────────────────────────────────────────────────────
    // Pure flag — CombatSystem reads ironhideRite to scale incoming damage
    // by attacker.attackRange (melee 0.5×, ranged 2×) when target is a minion.
    ironhideRite_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), ironhideRite: true }
    },
    ironhideRite_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.ironhideRite = false
    },

    // ── Frenzy Pact ──────────────────────────────────────────────────────
    // Per-room stack tracker on _mechanicFlags.frenzyStacks[roomId].
    // CombatSystem reads attacker.assignedRoomId → looks up stack.
    // Resets on NIGHT_PHASE_STARTED.
    frenzyPact_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.frenzyPact = true
      f.frenzyStacks ??= {}
      subscribe('MINION_DIED', ({ minion }) => {
        const room = minion?.assignedRoomId
        if (!room) return
        gameState._mechanicFlags.frenzyStacks[room] =
          (gameState._mechanicFlags.frenzyStacks[room] ?? 0) + 1
      })
      subscribe('NIGHT_PHASE_STARTED', () => {
        gameState._mechanicFlags.frenzyStacks = {}
      })
    },
    frenzyPact_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) {
        gameState._mechanicFlags.frenzyPact = false
        gameState._mechanicFlags.frenzyStacks = {}
      }
    },

    // ── Last Stand Doctrine ──────────────────────────────────────────────
    // Pure flag — CombatSystem checks if attacker is the last alive minion
    // in its room. When the bonus fires, mark the minion with
    // _lastStandUsed; respawnAll halves their HP next night.
    lastStandDoctrine_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), lastStandDoctrine: true }
    },
    lastStandDoctrine_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.lastStandDoctrine = false
    },

    // ── Mage Hunt ────────────────────────────────────────────────────────
    // Pure flag — CombatSystem scales minion-vs-adv damage by adv.attackRange.
    mageHunt_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), mageHunt: true }
    },
    mageHunt_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.mageHunt = false
    },

    // ── Vampire's Toll ───────────────────────────────────────────────────
    // Boss heals 5% maxHp per kill; takes 5% maxHp damage per escape.
    // Modifies gameState.boss.hp directly so it persists into the next
    // boss fight.
    vampiresToll_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), vampiresToll: true }
      subscribe('ADVENTURER_DIED', () => {
        if (!gameState.boss) return
        const heal = Math.max(1, Math.round((gameState.boss.maxHp ?? 0) * Balance.MECHANIC_VAMPIRE_KILL_HEAL_FRAC))
        gameState.boss.hp = Math.min(gameState.boss.maxHp ?? heal, (gameState.boss.hp ?? 0) + heal)
        EventBus.emit('VAMPIRE_TOLL_HEALED', { amount: heal })
      })
      subscribe('ADVENTURER_FLED', () => {
        if (!gameState.boss) return
        const dmg = Math.max(1, Math.round((gameState.boss.maxHp ?? 0) * Balance.MECHANIC_VAMPIRE_ESCAPE_DAMAGE_FRAC))
        gameState.boss.hp = Math.max(1, (gameState.boss.hp ?? 0) - dmg)
        EventBus.emit('VAMPIRE_TOLL_DAMAGED', { amount: dmg })
      })
    },
    vampiresToll_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.vampiresToll = false
    },

    // ── Tyrant's Gaze ────────────────────────────────────────────────────
    // Reset minion atk-stack tracker at NIGHT_PHASE_STARTED. BossSystem
    // applies the actual +1 atk / -1 hp during fight rounds.
    tyrantsGaze_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), tyrantsGaze: true }
      subscribe('NIGHT_PHASE_STARTED', () => {
        for (const m of (gameState.minions ?? [])) {
          if (m._tyrantStacksToday) {
            m.stats.attack = Math.max(0, (m.stats.attack ?? 0) - m._tyrantStacksToday)
            m._tyrantStacksToday = 0
          }
        }
      })
    },
    tyrantsGaze_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.tyrantsGaze = false
    },

    // ── Soul Tether ──────────────────────────────────────────────────────
    soulTether_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), soulTether: true }
      subscribe('MINION_DIED', ({ minion }) => {
        if (!minion || !gameState.boss) return
        const bossRoom = gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
        const inBossRoom = bossRoom && minion.assignedRoomId === bossRoom.instanceId
        if (inBossRoom) {
          const heal = Math.max(1, Math.round((gameState.boss.maxHp ?? 0) * Balance.MECHANIC_SOUL_TETHER_HEAL_FRAC))
          gameState.boss.hp = Math.min(gameState.boss.maxHp ?? heal, (gameState.boss.hp ?? 0) + heal)
          EventBus.emit('SOUL_TETHER_HEALED', { amount: heal })
        } else {
          const dmg = Math.max(1, Math.round((gameState.boss.maxHp ?? 0) * Balance.MECHANIC_SOUL_TETHER_DAMAGE_FRAC))
          gameState.boss.hp = Math.max(1, (gameState.boss.hp ?? 0) - dmg)
          EventBus.emit('SOUL_TETHER_DAMAGED', { amount: dmg })
        }
      })
    },
    soulTether_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.soulTether = false
    },

    // ── Avenger's Rite ───────────────────────────────────────────────────
    // Sets boss._avengerBuffUntil on minion death; sets boss._avengerDazeUntil
    // ONCE per boss fight — only for the FIRST adventurer to reach the boss
    // chamber (re-armed each dawn). BossSystem reads these.
    avengersRite_activate: ({ subscribe, gameState, scene }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), avengersRite: true }
      f.avengerDazeArmed ??= true
      subscribe('MINION_DIED', () => {
        if (!gameState.boss) return
        const now = scene?.time?.now ?? 0
        gameState.boss._avengerBuffUntil = now + Balance.MECHANIC_AVENGER_BUFF_DURATION_MS
      })
      // Re-arm the daze each dawn so it can fire once per boss fight.
      subscribe('DAY_PHASE_STARTED', () => {
        gameState._mechanicFlags.avengerDazeArmed = true
      })
      // Daze only for the FIRST adventurer to enter the boss chamber.
      subscribe('ADVENTURER_ROOM_CHANGED', ({ toRoomId }) => {
        if (!gameState.boss || !toRoomId) return
        if (!gameState._mechanicFlags.avengerDazeArmed) return
        const bossRoom = gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
        if (!bossRoom || bossRoom.instanceId !== toRoomId) return
        gameState._mechanicFlags.avengerDazeArmed = false
        const now = scene?.time?.now ?? 0
        gameState.boss._avengerDazeUntil = now + Balance.MECHANIC_AVENGER_DAZE_DURATION_MS
      })
    },
    avengersRite_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.avengersRite = false
    },

    // ── Final Breath ─────────────────────────────────────────────────────
    // Pure flag — BossSystem checks `flags.finalBreath && !flags.finalBreathUsed`
    // before applying lethal damage during the boss-fight loop.
    // Once used, sets gameState.boss.dmgPenaltyAfterBreath (read by BossSystem boss-attack code).
    finalBreath_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), finalBreath: true }
      gameState._mechanicFlags.finalBreathUsed ??= false
      subscribe('FINAL_BREATH_TRIGGERED', () => {
        gameState._mechanicFlags.finalBreathUsed = true
      })
    },
    finalBreath_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.finalBreath = false
    },

    // ── False Maps ───────────────────────────────────────────────────────
    // Scramble adv room labels at spawn. KnowledgeSystem.observeCurrentRoom
    // checks for label mismatch and triggers rage in CombatSystem.
    falseMaps_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), falseMaps: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer?.knowledge?.rooms) return
        const ids   = Object.keys(adventurer.knowledge.rooms)
        if (ids.length < 2) return
        const types = ids.map(id => adventurer.knowledge.rooms[id].roomType)
        // Rotate by 1 — each entry now claims the wrong roomType.
        const rotated = [...types.slice(1), types[0]]
        ids.forEach((id, i) => {
          adventurer.knowledge.rooms[id].roomType = rotated[i]
          adventurer.knowledge.rooms[id]._falseMapped = true
        })
      })
    },
    falseMaps_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.falseMaps = false
    },

    // ── Whispered Lies ───────────────────────────────────────────────────
    // Inject fake trap markers into adv knowledge.traps at spawn.
    whisperedLies_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), whisperedLies: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer?.knowledge) return
        adventurer.knowledge.traps ??= {}
        const realCount = Object.keys(adventurer.knowledge.traps).length
        const fakeCount = Math.max(2, Math.floor(realCount * Balance.MECHANIC_WHISPERED_LIES_FAKE_RATIO))
        const rooms = (gameState.dungeon?.rooms ?? []).filter(r => r.definitionId !== 'boss_chamber')
        for (let i = 0; i < fakeCount; i++) {
          const rm = rooms[Math.floor(Math.random() * rooms.length)]
          if (!rm) continue
          const tx = rm.gridX + Math.floor(Math.random() * rm.width)
          const ty = rm.gridY + Math.floor(Math.random() * rm.height)
          const fakeId = `fake_${adventurer.instanceId}_${i}`
          adventurer.knowledge.traps[fakeId] = {
            type:      'spike',
            tileX:     tx,
            tileY:     ty,
            confirmed: true,
            stale:     false,
            _fake:     true,
            dayLearned: gameState.meta?.dayNumber ?? 1,
          }
        }
      })
    },
    whisperedLies_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.whisperedLies = false
    },

    // ── Open Book ────────────────────────────────────────────────────────
    // Reveal every trap + minion to adv at spawn. CombatSystem reads flag
    // for trap dmg 2× and minion-taken dmg 0.5×.
    openBook_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), openBook: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer?.knowledge) return
        adventurer.knowledge.traps          ??= {}
        adventurer.knowledge.enemiesPerRoom ??= {}
        const today = gameState.meta?.dayNumber ?? 1
        for (const trap of (gameState.dungeon?.traps ?? [])) {
          adventurer.knowledge.traps[trap.instanceId] = {
            type: trap.definitionId, tileX: trap.tileX, tileY: trap.tileY,
            confirmed: true, stale: false, dayLearned: today,
          }
          trap.isKnownToAdventurers = true
        }
        for (const m of (gameState.minions ?? [])) {
          if (m.faction !== 'dungeon' || !m.assignedRoomId) continue
          const list = adventurer.knowledge.enemiesPerRoom[m.assignedRoomId] ??= []
          if (!list.find(e => e.minionType === m.definitionId)) {
            list.push({ minionType: m.definitionId, confirmed: true, stale: false, dayLearned: today })
          }
        }
      })
    },
    openBook_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.openBook = false
    },

    // ── Whisperer's Tongue ───────────────────────────────────────────────
    // Adv side: full minion knowledge at spawn. Minion side: MinionAISystem
    // reads flag to drop the same-room engagement requirement (cross-room
    // aggro within their normal aggro range).
    whisperersTongue_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), whisperersTongue: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer?.knowledge) return
        adventurer.knowledge.enemiesPerRoom ??= {}
        const today = gameState.meta?.dayNumber ?? 1
        for (const m of (gameState.minions ?? [])) {
          if (m.faction !== 'dungeon' || !m.assignedRoomId) continue
          const list = adventurer.knowledge.enemiesPerRoom[m.assignedRoomId] ??= []
          if (!list.find(e => e.minionType === m.definitionId)) {
            list.push({ minionType: m.definitionId, confirmed: true, stale: false, dayLearned: today })
          }
        }
      })
    },
    whisperersTongue_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.whisperersTongue = false
    },

    // ── Doomsday Clock ───────────────────────────────────────────────────
    // +500g on activate. On day N+7, set a flag; DayPhase reads it and
    // doubles the day's natural wave size (via MECHANIC_DOOMSDAY_WAVE_MULT).
    // The per-adv 2× stat buff was removed — the doubled wave is now the
    // entire tradeoff. No buff subscriber needed.
    doomsdayClock_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.doomsdayClock = true
      gameState.player.gold = (gameState.player.gold ?? 0) + Balance.MECHANIC_DOOMSDAY_GOLD_BONUS
      EventBus.emit('RESOURCES_AWARDED', { gold: Balance.MECHANIC_DOOMSDAY_GOLD_BONUS, reason: 'doomsday_bargain' })
      f.doomsdayRaidDay = (gameState.meta?.dayNumber ?? 1) + Balance.MECHANIC_DOOMSDAY_DAYS_UNTIL_RAID
      subscribe('DAY_PHASE_STARTED', () => {
        if ((gameState.meta?.dayNumber ?? 1) === gameState._mechanicFlags.doomsdayRaidDay) {
          gameState._mechanicFlags.doomsdayRaidToday = true
        }
      })
      subscribe('NIGHT_PHASE_STARTED', () => {
        gameState._mechanicFlags.doomsdayRaidToday = false
      })
    },
    doomsdayClock_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.doomsdayClock = false
    },

    // ── The Long Game ────────────────────────────────────────────────────
    // Every 3 days: grant a free random rare pact + lose a random minion +
    // shrink max-minion-slots by 1. Banner shown on each trigger.
    theLongGame_activate: ({ subscribe, gameState, scene, system }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theLongGame = true
      f.longGameStartDay ??= (gameState.meta?.dayNumber ?? 1)
      f.longGameMinionSlotPenalty ??= 0
      subscribe('DAY_PHASE_STARTED', () => {
        const day = gameState.meta?.dayNumber ?? 1
        const start = f.longGameStartDay
        if (day === start) return
        if ((day - start) % Balance.MECHANIC_LONG_GAME_INTERVAL_DAYS !== 0) return

        // 1) Grant a free random rare pact (offered pool minus active).
        let grantedName = '— none —'
        let grantedId   = null
        const allDefs = system.allDefinitions().filter(d =>
          d.rarity === 'rare' &&
          !system.isActive(d.id) &&
          d.id !== 'the_long_game'
        )
        if (allDefs.length > 0) {
          const pick = allDefs[Math.floor(Math.random() * allDefs.length)]
          grantedId = pick.id
          grantedName = pick.name ?? pick.id
          system.activate(pick.id)
        }

        // 2) Lose a random alive minion permanently.
        const alive = (gameState.minions ?? []).filter(m =>
          m.faction === 'dungeon' && m.aiState !== 'dead'
        )
        let lostName = null
        if (alive.length > 0) {
          const victim = alive[Math.floor(Math.random() * alive.length)]
          lostName = victim.definitionId
          const idx = gameState.minions.indexOf(victim)
          if (idx >= 0) gameState.minions.splice(idx, 1)
          EventBus.emit('MINION_REMOVED', { minion: victim, reason: 'long_game' })
        }

        // 3) Shrink max minion slots.
        gameState._mechanicFlags.longGameMinionSlotPenalty =
          (gameState._mechanicFlags.longGameMinionSlotPenalty ?? 0) + 1

        EventBus.emit('LONG_GAME_TRIGGERED', { grantedId, grantedName, lostName, day })
      })
    },
    theLongGame_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.theLongGame = false
    },

    // ── Inquisitor's Mark ────────────────────────────────────────────────
    // Mark the FIRST adv to enter each day. Buff their stats. Award 5×
    // gold on their kill. Mark resets at NIGHT_PHASE_STARTED.
    inquisitorsMark_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.inquisitorsMark = true
      f.inquisitorsMarkedToday = false
      subscribe('DAY_PHASE_STARTED', () => {
        gameState._mechanicFlags.inquisitorsMarkedToday = false
      })
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer || gameState._mechanicFlags.inquisitorsMarkedToday) return
        adventurer.flags ??= {}
        adventurer.flags.inquisitorsMark = true
        adventurer.resources.maxHp = Math.round((adventurer.resources.maxHp ?? 0) * Balance.MECHANIC_INQUISITORS_HP_MULT)
        adventurer.resources.hp    = adventurer.resources.maxHp
        if (adventurer.stats?.attack != null) adventurer.stats.attack = Math.round(adventurer.stats.attack * Balance.MECHANIC_INQUISITORS_ATK_MULT)
        gameState._mechanicFlags.inquisitorsMarkedToday = true
        EventBus.emit('INQUISITORS_MARK_PLACED', { adventurer })
      })
    },
    inquisitorsMark_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.inquisitorsMark = false
    },

    // ── Summon Adds I/II/III ─────────────────────────────────────────────
    // All three pacts share a single spawn-on-day-start helper. Each pact
    // installs its own subscriber so they stack cleanly.
    summonAddsI_activate: ({ subscribe, gameState, scene }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), summonAddsI: true }
      subscribe('DAY_PHASE_STARTED', () => _spawnSummonAdds(scene, gameState, 1, Balance.MECHANIC_SUMMON_ADDS_I_COUNT))
      subscribe('NIGHT_PHASE_STARTED', () => _despawnSummonAdds(gameState))
      // Tradeoff: boss loses 5% maxHp per killed add.
      subscribe('MINION_DIED', ({ minion }) => {
        if (!minion?._summonedAdd || !gameState.boss) return
        const dmg = Math.max(1, Math.round((gameState.boss.maxHp ?? 0) * Balance.MECHANIC_SUMMON_ADDS_I_BOSS_HP_LOSS_FRAC))
        gameState.boss.hp = Math.max(1, (gameState.boss.hp ?? 0) - dmg)
        EventBus.emit('SUMMON_ADD_DEATH_BOSS_TOLL', { amount: dmg })
      })
    },
    summonAddsI_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.summonAddsI = false
    },

    summonAddsII_activate: ({ subscribe, gameState, scene }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), summonAddsII: true }
      subscribe('DAY_PHASE_STARTED', () => _spawnSummonAdds(scene, gameState, 2, Balance.MECHANIC_SUMMON_ADDS_II_COUNT))
      subscribe('NIGHT_PHASE_STARTED', () => _despawnSummonAdds(gameState))
      // Tradeoff: +25% adv damage in boss room handled by CombatSystem reading flag.
    },
    summonAddsII_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.summonAddsII = false
    },

    summonAddsIII_activate: ({ subscribe, gameState, scene }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), summonAddsIII: true }
      f.extraAdvsPerDay = (f.extraAdvsPerDay ?? 0) + Balance.MECHANIC_SUMMON_ADDS_III_EXTRA_ADVS
      subscribe('DAY_PHASE_STARTED', () => _spawnSummonAdds(scene, gameState, 3, Balance.MECHANIC_SUMMON_ADDS_III_COUNT))
      subscribe('NIGHT_PHASE_STARTED', () => _despawnSummonAdds(gameState))
    },
    summonAddsIII_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) {
        gameState._mechanicFlags.summonAddsIII = false
        gameState._mechanicFlags.extraAdvsPerDay = Math.max(0,
          (gameState._mechanicFlags.extraAdvsPerDay ?? 0) - Balance.MECHANIC_SUMMON_ADDS_III_EXTRA_ADVS)
      }
    },

    // ── Drill Sergeant — +5 minion slots, +50% minion gold cost ─────────
    drillSergeant_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.drillSergeant = true
      f.maxMinionSlotBonus = (f.maxMinionSlotBonus ?? 0) + Balance.MECHANIC_DRILL_SERGEANT_SLOTS
      f.minionGoldCostMult = Math.max(f.minionGoldCostMult ?? 1, Balance.MECHANIC_DRILL_SERGEANT_GOLD_MULT)
    },
    drillSergeant_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.drillSergeant = false
      gameState._mechanicFlags.maxMinionSlotBonus = Math.max(0,
        (gameState._mechanicFlags.maxMinionSlotBonus ?? 0) - Balance.MECHANIC_DRILL_SERGEANT_SLOTS)
    },

    // ── Endless Garrison — 15/Barracks, -15% minion damage ──────────────
    endlessGarrison_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.endlessGarrison = true
      f.minionSlotsPerBarracks = Balance.MECHANIC_ENDLESS_GARRISON_PER_BARRACKS
      f.minionDamageMult = Balance.MECHANIC_ENDLESS_GARRISON_DAMAGE_MULT
    },
    endlessGarrison_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.endlessGarrison = false
      gameState._mechanicFlags.minionSlotsPerBarracks = null
      gameState._mechanicFlags.minionDamageMult = null
    },

    // ── The Cull — +10 minion slots, weakest culled at end of day ───────
    theCull_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theCull = true
      f.maxMinionSlotBonus = (f.maxMinionSlotBonus ?? 0) + Balance.MECHANIC_CULL_SLOTS
      subscribe('NIGHT_PHASE_STARTED', () => {
        const alive = (gameState.minions ?? []).filter(m =>
          m.faction === 'dungeon' && m.aiState !== 'dead' && !m._summonedAdd
        )
        if (alive.length === 0) return
        // Weakest = lowest stats.attack (tiebreaker: lowest maxHp).
        let weakest = alive[0]
        for (const m of alive) {
          const a = m.stats?.attack ?? 0, b = weakest.stats?.attack ?? 0
          if (a < b || (a === b && (m.resources?.maxHp ?? 0) < (weakest.resources?.maxHp ?? 0))) weakest = m
        }
        const idx = gameState.minions.indexOf(weakest)
        if (idx >= 0) gameState.minions.splice(idx, 1)
        EventBus.emit('CULL_TRIGGERED', { minionId: weakest.instanceId, definitionId: weakest.definitionId })
      })
    },
    theCull_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.theCull = false
      gameState._mechanicFlags.maxMinionSlotBonus = Math.max(0,
        (gameState._mechanicFlags.maxMinionSlotBonus ?? 0) - Balance.MECHANIC_CULL_SLOTS)
    },

    // ── Trap Mason's Touch — +5 trap slots, +50% trap gold cost ─────────
    trapMasonsTouch_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.trapMasonsTouch = true
      f.maxTrapSlotBonus = (f.maxTrapSlotBonus ?? 0) + Balance.MECHANIC_TRAP_MASON_SLOTS
      f.trapGoldCostMult = Math.max(f.trapGoldCostMult ?? 1, Balance.MECHANIC_TRAP_MASON_GOLD_MULT)
    },
    trapMasonsTouch_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.trapMasonsTouch = false
      gameState._mechanicFlags.maxTrapSlotBonus = Math.max(0,
        (gameState._mechanicFlags.maxTrapSlotBonus ?? 0) - Balance.MECHANIC_TRAP_MASON_SLOTS)
    },

    // ── Trapsmith's Guild — 10/Factory, -25% trap damage ────────────────
    trapsmithsGuild_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.trapsmithsGuild = true
      f.trapSlotsPerFactory = Balance.MECHANIC_TRAPSMITH_PER_FACTORY
      f.trapDamageMult = Balance.MECHANIC_TRAPSMITH_DAMAGE_MULT
    },
    trapsmithsGuild_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.trapsmithsGuild = false
      gameState._mechanicFlags.trapSlotsPerFactory = null
      gameState._mechanicFlags.trapDamageMult = null
    },

    // ── Forbidden Workshop — +10 trap slots, 25% disabled at dawn ──────
    forbiddenWorkshop_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.forbiddenWorkshop = true
      f.maxTrapSlotBonus = (f.maxTrapSlotBonus ?? 0) + Balance.MECHANIC_FORBIDDEN_WORKSHOP_SLOTS
      subscribe('DAY_PHASE_STARTED', () => {
        const traps = gameState.dungeon?.traps ?? []
        const disableCount = Math.floor(traps.length * Balance.MECHANIC_FORBIDDEN_WORKSHOP_DISABLE_FRAC)
        const shuffled = [...traps].sort(() => Math.random() - 0.5)
        for (let i = 0; i < disableCount; i++) {
          shuffled[i]._disabledThisDay = true
        }
        if (disableCount > 0) EventBus.emit('FORBIDDEN_WORKSHOP_DISABLED', { count: disableCount })
      })
    },
    forbiddenWorkshop_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.forbiddenWorkshop = false
      gameState._mechanicFlags.maxTrapSlotBonus = Math.max(0,
        (gameState._mechanicFlags.maxTrapSlotBonus ?? 0) - Balance.MECHANIC_FORBIDDEN_WORKSHOP_SLOTS)
    },

    // ── Architect's Vision — +3 minion + +3 trap slots, +1 adv/day ─────
    architectsVision_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.architectsVision = true
      f.maxMinionSlotBonus = (f.maxMinionSlotBonus ?? 0) + Balance.MECHANIC_ARCHITECTS_VISION_MIN_SLOTS
      f.maxTrapSlotBonus   = (f.maxTrapSlotBonus   ?? 0) + Balance.MECHANIC_ARCHITECTS_VISION_TRAP_SLOTS
      f.extraAdvsPerDay    = (f.extraAdvsPerDay    ?? 0) + Balance.MECHANIC_ARCHITECTS_VISION_EXTRA_ADVS
    },
    architectsVision_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      const f = gameState._mechanicFlags
      f.architectsVision = false
      f.maxMinionSlotBonus = Math.max(0, (f.maxMinionSlotBonus ?? 0) - Balance.MECHANIC_ARCHITECTS_VISION_MIN_SLOTS)
      f.maxTrapSlotBonus   = Math.max(0, (f.maxTrapSlotBonus   ?? 0) - Balance.MECHANIC_ARCHITECTS_VISION_TRAP_SLOTS)
      f.extraAdvsPerDay    = Math.max(0, (f.extraAdvsPerDay    ?? 0) - Balance.MECHANIC_ARCHITECTS_VISION_EXTRA_ADVS)
    },

    // ── Boss-attack pacts (Batch G) ──────────────────────────────────────
    // All flag-only; BossSystem._tickFightRound reads these and runs the
    // special-attack ladder on cooldown.
    hellfireBreath_activate:    ({ gameState }) => { (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).hellfireBreath = true },
    hellfireBreath_deactivate:  ({ gameState }) => { if (gameState._mechanicFlags) gameState._mechanicFlags.hellfireBreath = false },
    lightningStrike_activate:   ({ gameState }) => { (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).lightningStrike = true },
    lightningStrike_deactivate: ({ gameState }) => { if (gameState._mechanicFlags) gameState._mechanicFlags.lightningStrike = false },
    shockwaveSlam_activate:     ({ gameState }) => { (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).shockwaveSlam = true },
    shockwaveSlam_deactivate:   ({ gameState }) => { if (gameState._mechanicFlags) gameState._mechanicFlags.shockwaveSlam = false },
    spectralReach_activate:     ({ gameState }) => { (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).spectralReach = true },
    spectralReach_deactivate:   ({ gameState }) => { if (gameState._mechanicFlags) gameState._mechanicFlags.spectralReach = false },
    darkVortex_activate:        ({ gameState }) => { (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).darkVortex = true },
    darkVortex_deactivate:      ({ gameState }) => { if (gameState._mechanicFlags) gameState._mechanicFlags.darkVortex = false },
    soulDrain_activate:         ({ gameState }) => { (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).soulDrain = true },
    soulDrain_deactivate:       ({ gameState }) => { if (gameState._mechanicFlags) gameState._mechanicFlags.soulDrain = false },
    doppelgangers_activate:     ({ gameState }) => { (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).doppelgangers = true },
    doppelgangers_deactivate:   ({ gameState }) => { if (gameState._mechanicFlags) gameState._mechanicFlags.doppelgangers = false },
    petrifyingStare_activate:   ({ gameState }) => { (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).petrifyingStare = true },
    petrifyingStare_deactivate: ({ gameState }) => { if (gameState._mechanicFlags) gameState._mechanicFlags.petrifyingStare = false },

    // ── Cursed Soil ──────────────────────────────────────────────────────
    // Pure flag — AISystem/MinionAISystem tick floor-tile damage; AISystem
    // gold calc reads cursedSoil flag for the +50% in-room kill bonus.
    cursedSoil_activate:   ({ gameState }) => { (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).cursedSoil = true },
    cursedSoil_deactivate: ({ gameState }) => { if (gameState._mechanicFlags) gameState._mechanicFlags.cursedSoil = false },

    // ── Sundered Floor ───────────────────────────────────────────────────
    // Each DAY_PHASE_STARTED, pick a random floor tile; after 5s telegraph,
    // it triggers — anyone on it takes 25% maxHp + stun. 5% backfire onto
    // a random alive minion. After triggering, tile is marked "blackened"
    // for renderer. Cleared on NIGHT_PHASE_STARTED.
    sunderedFloor_activate: ({ subscribe, gameState, scene }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), sunderedFloor: true }
      gameState._mechanicFlags.sunderedFloorPits ??= []
      subscribe('DAY_PHASE_STARTED', () => {
        const rooms = (gameState.dungeon?.rooms ?? []).filter(r => r.definitionId !== 'boss_chamber')
        if (rooms.length === 0) return
        const rm = rooms[Math.floor(Math.random() * rooms.length)]
        const tx = rm.gridX + Math.floor(Math.random() * rm.width)
        const ty = rm.gridY + Math.floor(Math.random() * rm.height)
        const now = scene?.time?.now ?? 0
        const pit = { tileX: tx, tileY: ty, triggerAt: now + Balance.MECHANIC_SUNDERED_FLOOR_TELEGRAPH_MS, fired: false, blackened: false }
        // 5% backfire onto a minion before telegraph completes — pre-roll the target.
        if (Math.random() < Balance.MECHANIC_SUNDERED_FLOOR_BACKFIRE_CHANCE) {
          const alive = (gameState.minions ?? []).filter(m => m.faction === 'dungeon' && m.aiState !== 'dead')
          const victim = alive[Math.floor(Math.random() * alive.length)]
          if (victim) { pit.tileX = victim.tileX; pit.tileY = victim.tileY; pit._backfire = true }
        }
        gameState._mechanicFlags.sunderedFloorPits.push(pit)
        EventBus.emit('SUNDERED_FLOOR_TELEGRAPHED', { tileX: pit.tileX, tileY: pit.tileY, triggerAt: pit.triggerAt })
      })
      subscribe('NIGHT_PHASE_STARTED', () => {
        gameState._mechanicFlags.sunderedFloorPits = []
      })
    },
    sunderedFloor_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) {
        gameState._mechanicFlags.sunderedFloor = false
        gameState._mechanicFlags.sunderedFloorPits = []
      }
    },

    // ── Pact of the Mirror ───────────────────────────────────────────────
    // At dawn, pick a minion, duplicate it (half HP, paired). MINION_DIED
    // on either twin kills the other.
    pactOfTheMirror_activate: ({ subscribe, gameState, scene }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), pactOfTheMirror: true }
      subscribe('DAY_PHASE_STARTED', () => {
        const eligible = (gameState.minions ?? []).filter(m =>
          m.faction === 'dungeon' && m.aiState !== 'dead' && !m._mirrorTwinId && !m._summonedAdd
        )
        if (eligible.length === 0) return
        const src = eligible[Math.floor(Math.random() * eligible.length)]
        const defs = scene?.cache?.json?.get?.('minionTypes') ?? []
        const def = defs.find?.(d => d.id === src.definitionId)
        if (!def) return
        const twin = createMinion(def, { x: src.tileX, y: src.tileY }, src.assignedRoomId, {
          class: src.class ?? 'roster', bossLevel: gameState.boss?.level ?? 1,
        })
        twin.resources.maxHp = src.resources.maxHp
        twin.resources.hp    = Math.floor(src.resources.maxHp * 0.5)
        twin._mirrorTwinId = src.instanceId
        src._mirrorTwinId  = twin.instanceId
        gameState.minions.push(twin)
        EventBus.emit('MINION_PLACED', { minion: twin })
        EventBus.emit('MIRROR_TWIN_SPAWNED', { srcId: src.instanceId, twinId: twin.instanceId })
      })
      subscribe('MINION_DIED', ({ minion }) => {
        if (!minion?._mirrorTwinId) return
        const twin = (gameState.minions ?? []).find(m => m.instanceId === minion._mirrorTwinId && m.aiState !== 'dead')
        if (twin) {
          twin.resources.hp = 0
          twin.aiState = 'dead'
          EventBus.emit('MINION_DIED', { minion: twin, killedBy: 'mirror_pact' })
        }
      })
    },
    pactOfTheMirror_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.pactOfTheMirror = false
    },

    // ── Pact of the Cartographer ─────────────────────────────────────────
    // Adv +25% speed at entry. Visual path overlay deferred to UI polish;
    // emits PACT_CARTOGRAPHER_PATH_REVEALED for future renderer.
    pactOfTheCartographer_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), pactOfTheCartographer: true }
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer?.stats || adventurer._cartographerSpeed) return
        adventurer.stats.speed = (adventurer.stats.speed ?? 1.5) * Balance.MECHANIC_CARTOGRAPHER_SPEED_MULT
        adventurer._cartographerSpeed = true
        EventBus.emit('PACT_CARTOGRAPHER_PATH_REVEALED', { adventurerId: adventurer.instanceId })
      })
    },
    pactOfTheCartographer_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.pactOfTheCartographer = false
    },

    // ── Pact of the Jester ───────────────────────────────────────────────
    // Pure flag — NightPhase trap-cost helper reads jester for -75%, TrapSystem
    // applies +50% damage. BuildMenu name-scramble is a follow-up UI task.
    pactOfTheJester_activate:   ({ gameState }) => { (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).pactOfTheJester = true },
    pactOfTheJester_deactivate: ({ gameState }) => { if (gameState._mechanicFlags) gameState._mechanicFlags.pactOfTheJester = false },

    // ── Pact of the Whisperer ────────────────────────────────────────────
    // Mark the FIRST adv each day with panicFlee. Their party gets
    // +50% damage via flag.whispererPartyDmg + party id check.
    pactOfTheWhisperer_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.pactOfTheWhisperer = true
      f.whispererMarkedToday = false
      f.whispererPartyId = null
      subscribe('DAY_PHASE_STARTED', () => {
        gameState._mechanicFlags.whispererMarkedToday = false
        gameState._mechanicFlags.whispererPartyId = null
      })
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer || gameState._mechanicFlags.whispererMarkedToday) return
        adventurer.flags ??= {}
        adventurer.flags.panicFlee = true
        gameState._mechanicFlags.whispererMarkedToday = true
        gameState._mechanicFlags.whispererPartyId = adventurer.partyId
        EventBus.emit('WHISPERER_MARK_PLACED', { adventurerId: adventurer.instanceId })
      })
    },
    pactOfTheWhisperer_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.pactOfTheWhisperer = false
    },

    // ── Pact of the Brand ────────────────────────────────────────────────
    // Tracks which trap is blessed. TrapSystem reads trap._brandBlessed
    // to apply 5× damage, then destroys the trap on fire. Player selects
    // the trap during night phase via right-click (NightPhase emits
    // BRAND_TRAP_SELECTED).
    pactOfTheBrand_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), pactOfTheBrand: true }
      subscribe('NIGHT_PHASE_STARTED', () => {
        // Clear any prior unfired blessing — player must re-select each night.
        for (const t of (gameState.dungeon?.traps ?? [])) {
          if (t._brandBlessed) t._brandBlessed = false
        }
        EventBus.emit('BRAND_AWAITING_SELECTION', {})
      })
      // NightPhase emits BRAND_TRAP_SELECTED with a trap instanceId when
      // the player right-clicks a trap during night phase.
      subscribe('BRAND_TRAP_SELECTED', ({ trapId }) => {
        const traps = gameState.dungeon?.traps ?? []
        // Clear any prior selection first (allow re-picking before day starts).
        for (const t of traps) t._brandBlessed = false
        const pick = traps.find(t => t.instanceId === trapId && !t.isTriggered)
        if (!pick) return
        pick._brandBlessed = true
        EventBus.emit('BRAND_TRAP_BLESSED', { trapId: pick.instanceId })
      })
    },
    pactOfTheBrand_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.pactOfTheBrand = false
    },

    // ── Pact of the Reaper ───────────────────────────────────────────────
    // Track per-room "next-adv-cursed" markers. ADVENTURER_DIED sets the
    // marker for the room where they died. ADVENTURER_ROOM_CHANGED reads
    // the marker, applies HP/dmg debuff, clears it.
    pactOfTheReaper_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.pactOfTheReaper = true
      f.reaperRooms ??= {}
      subscribe('ADVENTURER_DIED', ({ roomId }) => {
        if (!roomId) return
        gameState._mechanicFlags.reaperRooms[roomId] = true
      })
      subscribe('ADVENTURER_ROOM_CHANGED', ({ adventurer, toRoomId }) => {
        if (!adventurer || !toRoomId) return
        if (!gameState._mechanicFlags.reaperRooms[toRoomId]) return
        if (adventurer._reaperCursed) return
        adventurer.resources.maxHp = Math.max(1, Math.floor((adventurer.resources.maxHp ?? 0) * Balance.MECHANIC_REAPER_HP_DEBUFF_MULT))
        adventurer.resources.hp    = Math.min(adventurer.resources.hp ?? 0, adventurer.resources.maxHp)
        if (adventurer.stats?.attack != null) adventurer.stats.attack = Math.max(1, Math.floor(adventurer.stats.attack * Balance.MECHANIC_REAPER_DMG_DEBUFF_MULT))
        adventurer._reaperCursed = true
        delete gameState._mechanicFlags.reaperRooms[toRoomId]
        EventBus.emit('REAPER_MARK_APPLIED', { adventurerId: adventurer.instanceId, roomId: toRoomId })
      })
    },
    pactOfTheReaper_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) {
        gameState._mechanicFlags.pactOfTheReaper = false
        gameState._mechanicFlags.reaperRooms = {}
      }
    },

    // ── Pact of the Crucible ─────────────────────────────────────────────
    // Once-per-run sacrifice. Exposes a method on the system instance for
    // the UI to call: system.crucibleSacrifice(srcId, victimId).
    // For testability, the activate handler just sets the flag; the actual
    // sacrifice action happens via a method (see DungeonMechanicSystem
    // public API below). Run-scoped used flag prevents repeats.
    pactOfTheCrucible_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.pactOfTheCrucible = true
      f.crucibleUsed ??= false
    },
    pactOfTheCrucible_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.pactOfTheCrucible = false
    },

    // ── Pact of the Marionette ───────────────────────────────────────────
    // Click-to-possess minion + WASD direct control. Game scene owns the
    // input wiring; this handler tracks the once-per-day flag and ends
    // possession on minion death / day end.
    pactOfTheMarionette_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.pactOfTheMarionette = true
      f.marionetteUsedToday = false
      f.possessedMinionId = null
      subscribe('DAY_PHASE_STARTED', () => {
        gameState._mechanicFlags.marionetteUsedToday = false
        gameState._mechanicFlags.possessedMinionId = null
      })
      subscribe('NIGHT_PHASE_STARTED', () => {
        if (gameState._mechanicFlags.possessedMinionId) {
          EventBus.emit('MARIONETTE_RELEASED', { reason: 'night' })
        }
        gameState._mechanicFlags.possessedMinionId = null
      })
      subscribe('MINION_DIED', ({ minion }) => {
        if (!minion) return
        if (gameState._mechanicFlags.possessedMinionId === minion.instanceId) {
          gameState._mechanicFlags.possessedMinionId = null
          EventBus.emit('MARIONETTE_RELEASED', { reason: 'killed', minionId: minion.instanceId })
        }
      })
    },
    pactOfTheMarionette_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) {
        gameState._mechanicFlags.pactOfTheMarionette = false
        gameState._mechanicFlags.possessedMinionId = null
      }
    },

    // ── DAMNED · The Leech ───────────────────────────────────────────────
    // Devil's bargain: a one-time gold bribe on sealing, then the dungeon
    // bleeds 8% of your treasury every dawn for the rest of the run.
    theLeech_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theLeech = true
      // Bribe — paid once, immediately.
      const bribe = Balance.MECHANIC_LEECH_BRIBE_GOLD ?? 800
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'leech_bribe' })
      // Curse — drain a slice of the treasury at the start of every day.
      subscribe('DAY_PHASE_STARTED', () => {
        const frac = Balance.MECHANIC_LEECH_GOLD_DRAIN_FRACTION ?? 0.08
        const held = gameState.player.gold ?? 0
        const drain = Math.floor(held * frac)
        if (drain <= 0) return
        gameState.player.gold = held - drain
        EventBus.emit('LEECH_DRAINED', { amount: drain, remaining: gameState.player.gold })
      })
    },
    theLeech_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.theLeech = false
    },

    // ── DAMNED · Pact of the Last Heart ──────────────────────────────────
    // Bribe: a free Legendary pact. Curse: the boss is capped at a single
    // heart (one lost boss fight ends the run) and can never regain a life.
    pactOfTheLastHeart_activate: ({ gameState, system }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.lastHeart = true
      // Curse — collapse the boss's lives to a single heart, forever.
      const lives = Balance.MECHANIC_LAST_HEART_LIVES ?? 1
      if (gameState.boss) {
        gameState.boss.deathsRemaining   = Math.min(gameState.boss.deathsRemaining ?? lives, lives)
        gameState.boss.totalLivesEverHad = lives
      }
      // Bribe — grant a free random Legendary pact (not already active).
      let grantedId = null
      let grantedName = null
      const pool = system.allDefinitions().filter(d =>
        d.rarity === 'legendary' &&
        !system.isActive(d.id) &&
        d.id !== 'pact_of_the_last_heart'
      )
      if (pool.length > 0) {
        const pickDef = pool[Math.floor(Math.random() * pool.length)]
        grantedId = pickDef.id
        grantedName = pickDef.name ?? pickDef.id
        system.activate(pickDef.id)
      }
      EventBus.emit('LAST_HEART_SEALED', { grantedId, grantedName })
    },
    pactOfTheLastHeart_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.lastHeart = false
    },

    // ── DAMNED · Famished Dark ───────────────────────────────────────────
    // Bribe: gold lump. Curse: kills pay half gold (AISystem goldMul read).
    famishedDark_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.famishedDark = true
      const bribe = Balance.MECHANIC_FAMISHED_DARK_BRIBE_GOLD ?? 1500
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'famished_dark_bribe' })
    },
    famishedDark_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.famishedDark = false
    },

    // ── DAMNED · The Open Gate ───────────────────────────────────────────
    // Bribe: gold lump. Curse: +10 adventurers/day (DayPhase extraAdvsPerDay).
    theOpenGate_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theOpenGate = true
      f.extraAdvsPerDay = (f.extraAdvsPerDay ?? 0) + (Balance.MECHANIC_OPEN_GATE_EXTRA_ADVS ?? 10)
      const bribe = Balance.MECHANIC_OPEN_GATE_BRIBE_GOLD ?? 1500
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'open_gate_bribe' })
    },
    theOpenGate_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.theOpenGate = false
      gameState._mechanicFlags.extraAdvsPerDay = Math.max(0,
        (gameState._mechanicFlags.extraAdvsPerDay ?? 0) - (Balance.MECHANIC_OPEN_GATE_EXTRA_ADVS ?? 10))
    },

    // ── DAMNED · Hollow Crown ────────────────────────────────────────────
    // Bribe: free Legendary pact. Curse: boss max HP halved (recompute reads
    // the flag); emit BOSS_STATS_DIRTY so the top-bar updates immediately.
    hollowCrown_activate: ({ gameState, system }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.hollowCrown = true
      const { grantedId, grantedName } = _grantFreeLegendaryPact(system, 'hollow_crown')
      EventBus.emit('BOSS_STATS_DIRTY')
      EventBus.emit('HOLLOW_CROWN_SEALED', { grantedId, grantedName })
    },
    hollowCrown_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.hollowCrown = false
      EventBus.emit('BOSS_STATS_DIRTY')
    },

    // ── DAMNED · The Bleeding Crown ──────────────────────────────────────
    // Bribe: gold lump. Curse: boss loses 2% max HP permanently each day
    // (recompute reads bleedingCrownDays; daily tick bumps it + recomputes).
    theBleedingCrown_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theBleedingCrown = true
      f.bleedingCrownDays ??= 0
      const bribe = Balance.MECHANIC_BLEEDING_CROWN_BRIBE_GOLD ?? 1200
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'bleeding_crown_bribe' })
      subscribe('DAY_PHASE_STARTED', () => {
        gameState._mechanicFlags.bleedingCrownDays = (gameState._mechanicFlags.bleedingCrownDays ?? 0) + 1
        EventBus.emit('BOSS_STATS_DIRTY')
      })
    },
    theBleedingCrown_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.theBleedingCrown = false
      EventBus.emit('BOSS_STATS_DIRTY')
    },

    // ── DAMNED · Sleepless Throne ────────────────────────────────────────
    // Bribe: +10 minion slots. Curse: boss starts every fight at 50% HP
    // (BossSystem._onIncoming reads the flag).
    sleeplessThrone_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.sleeplessThrone = true
      f.maxMinionSlotBonus = (f.maxMinionSlotBonus ?? 0) + (Balance.MECHANIC_SLEEPLESS_THRONE_SLOT_BRIBE ?? 10)
    },
    sleeplessThrone_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.sleeplessThrone = false
      gameState._mechanicFlags.maxMinionSlotBonus = Math.max(0,
        (gameState._mechanicFlags.maxMinionSlotBonus ?? 0) - (Balance.MECHANIC_SLEEPLESS_THRONE_SLOT_BRIBE ?? 10))
    },

    // ── DAMNED · Tribute of Flesh ────────────────────────────────────────
    // Bribe: gold lump. Curse: each escaped adventurer loots gold from you.
    tributeOfFlesh_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.tributeOfFlesh = true
      const bribe = Balance.MECHANIC_TRIBUTE_BRIBE_GOLD ?? 700
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'tribute_bribe' })
      subscribe('ADVENTURER_FLED', () => {
        const loot = Balance.MECHANIC_TRIBUTE_GOLD_PER_ESCAPE ?? 20
        const before = gameState.player.gold ?? 0
        gameState.player.gold = Math.max(0, before - loot)
        EventBus.emit('TRIBUTE_LOOTED', { amount: Math.min(loot, before) })
      })
    },
    tributeOfFlesh_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.tributeOfFlesh = false
    },

    // ── DAMNED · Cursed Blood ────────────────────────────────────────────
    // Bribe: gold lump. Curse: every minion death damages the boss for 3%
    // max HP (floored at 1 HP — won't itself end the run, like Soul Tether).
    cursedBlood_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.cursedBlood = true
      const bribe = Balance.MECHANIC_CURSED_BLOOD_BRIBE_GOLD ?? 1000
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'cursed_blood_bribe' })
      subscribe('MINION_DIED', ({ minion }) => {
        if (!minion || !gameState.boss) return
        const dmg = Math.max(1, Math.round((gameState.boss.maxHp ?? 0) * (Balance.MECHANIC_CURSED_BLOOD_BOSS_DMG_FRAC ?? 0.03)))
        gameState.boss.hp = Math.max(1, (gameState.boss.hp ?? 0) - dmg)
        EventBus.emit('CURSED_BLOOD_BOSS_HURT', { amount: dmg })
      })
    },
    cursedBlood_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.cursedBlood = false
    },

    // ── DAMNED · The Hollow Horde ────────────────────────────────────────
    // Bribe: all current minions +20% to all stats. Curse: max minion slots
    // halved (NightPhase._rosterCap reads theHollowHorde).
    theHollowHorde_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theHollowHorde = true
      const b = Balance.MECHANIC_HOLLOW_HORDE_STAT_BUFF ?? 0.2
      _buffCurrentMinions(gameState, { hp: b, atk: b, def: b })
    },
    theHollowHorde_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.theHollowHorde = false
    },

    // ── DAMNED · Brittle Bones ───────────────────────────────────────────
    // Bribe: current minions +25% damage. Curse: a minion struck below 50%
    // HP shatters instantly (CombatSystem reads brittleBones).
    brittleBones_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.brittleBones = true
      _buffCurrentMinions(gameState, { atk: Balance.MECHANIC_BRITTLE_BONES_DMG_BUFF ?? 0.25 })
    },
    brittleBones_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.brittleBones = false
    },

    // ── DAMNED · The Wasting ─────────────────────────────────────────────
    // Bribe: evolve all current minions one tier. Curse: every surviving
    // minion sheds 5% max HP at the end of each day (compounding). The
    // penalty lives as wastingDays, read in applyMinionScaling so it survives
    // level-up rescales; the nightly tick bumps it and re-applies scaling.
    theWasting_activate: ({ subscribe, gameState, scene }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theWasting = true
      f.wastingDays ??= 0
      scene?.minionEvolutionSystem?.evolveAllOnce?.()
      subscribe('NIGHT_PHASE_STARTED', () => {
        gameState._mechanicFlags.wastingDays = (gameState._mechanicFlags.wastingDays ?? 0) + 1
        const bossLv = gameState.boss?.level ?? 1
        for (const m of (gameState.minions ?? [])) {
          if (m.faction !== 'dungeon' || m.aiState === 'dead') continue
          applyBossLevelToMinion(m, bossLv)
        }
        EventBus.emit('WASTING_TICK', { days: gameState._mechanicFlags.wastingDays })
      })
    },
    theWasting_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.theWasting = false
    },

    // ── DAMNED · The Hunger ──────────────────────────────────────────────
    // Bribe: gold lump. Curse: each dawn, 20% of your minions die permanently
    // (spliced from gameState.minions so they never respawn).
    theHunger_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theHunger = true
      const bribe = Balance.MECHANIC_HUNGER_BRIBE_GOLD ?? 1000
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'hunger_bribe' })
      subscribe('DAY_PHASE_STARTED', () => {
        const alive = (gameState.minions ?? []).filter(m => m.faction === 'dungeon' && m.aiState !== 'dead')
        const n = Math.floor(alive.length * (Balance.MECHANIC_HUNGER_DEATH_FRAC ?? 0.2))
        if (n <= 0) return
        const victims = [...alive].sort(() => Math.random() - 0.5).slice(0, n)
        for (const v of victims) {
          const idx = gameState.minions.indexOf(v)
          if (idx >= 0) gameState.minions.splice(idx, 1)
          EventBus.emit('MINION_REMOVED', { minion: v, reason: 'hunger' })
        }
        EventBus.emit('HUNGER_DEVOURED', { count: victims.length })
      })
    },
    theHunger_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.theHunger = false
    },

    // ── DAMNED · The Unteachable ─────────────────────────────────────────
    // Bribe: gold lump. Curse: minions can't gain XP/evolve (MinionEvolution
    // System._onCombatKill bails on the flag).
    theUnteachable_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theUnteachable = true
      const bribe = Balance.MECHANIC_UNTEACHABLE_BRIBE_GOLD ?? 1000
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'unteachable_bribe' })
    },
    theUnteachable_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.theUnteachable = false
    },

    // ── DAMNED · The Martyr's Curse ──────────────────────────────────────
    // Bribe: gold lump. Curse: when a minion dies, adventurers within a few
    // tiles of the death heal 25% of their max HP.
    theMartyrsCurse_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theMartyrsCurse = true
      const bribe = Balance.MECHANIC_MARTYR_BRIBE_GOLD ?? 800
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'martyr_bribe' })
      subscribe('MINION_DIED', ({ minion }) => {
        if (!minion) return
        const advs = gameState.adventurers?.active ?? []
        const R    = Balance.MECHANIC_MARTYR_RADIUS_TILES ?? 4
        const frac = Balance.MECHANIC_MARTYR_HEAL_FRAC ?? 0.25
        const mx = minion.tileX ?? 0, my = minion.tileY ?? 0
        for (const a of advs) {
          if (!a?.resources || a.aiState === 'dead') continue
          const d = Math.hypot((a.tileX ?? 0) - mx, (a.tileY ?? 0) - my)
          if (d > R) continue
          const heal = Math.round((a.resources.maxHp ?? 0) * frac)
          if (heal <= 0) continue
          a.resources.hp = Math.min(a.resources.maxHp ?? heal, (a.resources.hp ?? 0) + heal)
          EventBus.emit('MARTYR_HEAL', { adventurerId: a.instanceId, amount: heal })
        }
      })
    },
    theMartyrsCurse_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.theMartyrsCurse = false
    },

    // ── DAMNED · Mounting Debt ───────────────────────────────────────────
    // Bribe: gold lump. Curse: build costs inflate 5%/day, compounding
    // (applyMerchantPrice reads mountingDebtMult).
    mountingDebt_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.mountingDebt = true
      f.mountingDebtMult ??= 1
      const bribe = Balance.MECHANIC_MOUNTING_DEBT_BRIBE_GOLD ?? 1000
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'mounting_debt_bribe' })
      subscribe('DAY_PHASE_STARTED', () => {
        const step = 1 + (Balance.MECHANIC_MOUNTING_DEBT_PER_DAY ?? 0.05)
        gameState._mechanicFlags.mountingDebtMult = (gameState._mechanicFlags.mountingDebtMult ?? 1) * step
        EventBus.emit('MOUNTING_DEBT_TICK', { mult: gameState._mechanicFlags.mountingDebtMult })
      })
    },
    mountingDebt_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) {
        gameState._mechanicFlags.mountingDebt = false
        gameState._mechanicFlags.mountingDebtMult = 1   // lift the inflation
      }
    },

    // ── DAMNED · The Sealed Vault ────────────────────────────────────────
    // Bribe: gold lump. Curse: selling is forbidden (NightPhase._executeSellAt).
    theSealedVault_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theSealedVault = true
      const bribe = Balance.MECHANIC_SEALED_VAULT_BRIBE_GOLD ?? 1500
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'sealed_vault_bribe' })
    },
    theSealedVault_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.theSealedVault = false
    },

    // ── DAMNED · Brittle Engines ─────────────────────────────────────────
    // Bribe: traps +100% damage (trapDamageMult, read by TrapSystem). Curse:
    // each trap breaks permanently the moment it fires (sets trap._broken,
    // which the TrapSystem trigger loops skip).
    brittleEngines_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.brittleEngines = true
      f.trapDamageMult = (f.trapDamageMult ?? 1) * (Balance.MECHANIC_BRITTLE_ENGINES_DMG_MULT ?? 2)
      subscribe('TRAP_FIRED', ({ trap }) => { if (trap) trap._broken = true })
    },
    brittleEngines_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.brittleEngines = false
      const m = Balance.MECHANIC_BRITTLE_ENGINES_DMG_MULT ?? 2
      gameState._mechanicFlags.trapDamageMult = (gameState._mechanicFlags.trapDamageMult ?? 1) / m
    },

    // ── DAMNED · Trapless Halls ──────────────────────────────────────────
    // Bribe: existing traps +50% damage + gold. Curse: no NEW traps may be
    // placed (NightPhase placement validation reads traplessHalls).
    traplessHalls_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.traplessHalls = true
      f.trapDamageMult = (f.trapDamageMult ?? 1) * (Balance.MECHANIC_TRAPLESS_HALLS_DMG_MULT ?? 1.5)
      const bribe = Balance.MECHANIC_TRAPLESS_HALLS_BRIBE_GOLD ?? 600
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'trapless_halls_bribe' })
    },
    traplessHalls_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.traplessHalls = false
      const m = Balance.MECHANIC_TRAPLESS_HALLS_DMG_MULT ?? 1.5
      gameState._mechanicFlags.trapDamageMult = (gameState._mechanicFlags.trapDamageMult ?? 1) / m
    },

    // ── DAMNED · Famine's Grip ───────────────────────────────────────────
    // Bribe: gold lump. Curse: treasure-room payouts pay 50% less
    // (RoomBehaviorSystem treasury stipend reads faminesGrip).
    faminesGrip_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.faminesGrip = true
      const bribe = Balance.MECHANIC_FAMINES_GRIP_BRIBE_GOLD ?? 800
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'famines_grip_bribe' })
    },
    faminesGrip_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.faminesGrip = false
    },

    // ── DAMNED · Pact of Glass ───────────────────────────────────────────
    // Bribe: minions free to place during the sealing build phase only
    // (NightPhase._effectiveMinionCost reads glassFreeNight; those minions
    // are marked _noSellValue). Curse: all minion max HP halved permanently
    // (applyMinionScaling reads pactOfGlass for current + future minions).
    pactOfGlass_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.pactOfGlass = true
      f.glassFreeNight = true
      const bossLv = gameState.boss?.level ?? 1
      for (const m of (gameState.minions ?? [])) {
        if (m.faction !== 'dungeon' || m.aiState === 'dead') continue
        applyBossLevelToMinion(m, bossLv)   // re-apply scaling -> half HP now
      }
      subscribe('DAY_PHASE_STARTED', () => { gameState._mechanicFlags.glassFreeNight = false })
    },
    pactOfGlass_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.pactOfGlass = false
    },

    // ── DAMNED · The Insomniac ───────────────────────────────────────────
    // Bribe: gold lump. Curse: every Nth night gives no build phase — the
    // NightPhase placement validations reject everything while
    // insomniacLockTonight is set (cleared at dawn).
    theInsomniac_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theInsomniac = true
      f.insomniacNightCount ??= 0
      const bribe = Balance.MECHANIC_INSOMNIAC_BRIBE_GOLD ?? 600
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'insomniac_bribe' })
      subscribe('NIGHT_PHASE_STARTED', () => {
        const n = (gameState._mechanicFlags.insomniacNightCount ?? 0) + 1
        gameState._mechanicFlags.insomniacNightCount = n
        const interval = Balance.MECHANIC_INSOMNIAC_INTERVAL_NIGHTS ?? 3
        const locked = (n % interval === 0)
        gameState._mechanicFlags.insomniacLockTonight = locked
        if (locked) {
          EventBus.emit('INSOMNIAC_LOCKED', { night: n })
          EventBus.emit('SHOW_TOAST', { text: 'The Insomniac — no building tonight.', kind: 'warn' })
        }
      })
      subscribe('DAY_PHASE_STARTED', () => { gameState._mechanicFlags.insomniacLockTonight = false })
    },
    theInsomniac_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) {
        gameState._mechanicFlags.theInsomniac = false
        gameState._mechanicFlags.insomniacLockTonight = false
      }
    },

    // ── DAMNED · Crumbling Halls ─────────────────────────────────────────
    // Bribe: gold + trap slots. Curse: at the start of every night a random
    // room is destroyed with its contents — NEVER the Boss Chamber or an
    // Entry Hall (and never a fixed room). Uses the Game scene's DungeonGrid
    // (the same instance NightPhase uses, so removal stays consistent).
    crumblingHalls_activate: ({ subscribe, gameState, scene }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.crumblingHalls = true
      const bribe = Balance.MECHANIC_CRUMBLING_BRIBE_GOLD ?? 600
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'crumbling_halls_bribe' })
      f.maxTrapSlotBonus = (f.maxTrapSlotBonus ?? 0) + (Balance.MECHANIC_CRUMBLING_TRAP_SLOTS ?? 3)
      subscribe('NIGHT_PHASE_STARTED', () => {
        const grid  = scene?.dungeonGrid
        const rooms = gameState.dungeon?.rooms ?? []
        const eligible = rooms.filter(r =>
          r.definitionId !== 'boss_chamber' &&
          r.definitionId !== 'entry_hall' &&
          !(r.placementRules?.fixed))
        if (eligible.length === 0) return
        const victim = eligible[Math.floor(Math.random() * eligible.length)]
        // Drop minions homed to the doomed room.
        const minions = gameState.minions ?? []
        for (let i = minions.length - 1; i >= 0; i--) {
          if (minions[i]?.assignedRoomId === victim.instanceId) {
            const m = minions[i]; minions.splice(i, 1)
            EventBus.emit('MINION_REMOVED', { minion: m, reason: 'crumbling_halls' })
          }
        }
        // Drop traps inside the room footprint.
        const traps = gameState.dungeon?.traps ?? []
        for (let i = traps.length - 1; i >= 0; i--) {
          const t = traps[i]
          if (t && t.tileX >= victim.gridX && t.tileX < victim.gridX + victim.width &&
                   t.tileY >= victim.gridY && t.tileY < victim.gridY + victim.height) {
            traps.splice(i, 1)
            EventBus.emit('TRAP_REMOVED', { trap: t, refund: 0 })
          }
        }
        // Remove the room itself (same call the Sell tool uses on any room).
        try { grid?.removeRoom?.(victim.instanceId) }
        catch (e) { console.warn('[crumbling_halls] removeRoom failed:', e?.message) }
        EventBus.emit('ROOM_REMOVED', { room: victim, reason: 'crumbling_halls' })
        EventBus.emit('CRUMBLING_HALLS_DESTROYED', { roomId: victim.instanceId })
        EventBus.emit('SHOW_TOAST', { text: 'Crumbling Halls — a room collapses to dust!', kind: 'warn' })
      })
    },
    crumblingHalls_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.crumblingHalls = false
    },

    // ── DAMNED · Blind Architect ─────────────────────────────────────────
    // Bribe: gold lump (stand-in for the "perfect-day preview" idea — see
    // DESIGN notes). Curse: the minimap is hidden (scoped CSS class on
    // #hud-stage) and the adventurer-intel panel is gated shut
    // (AdvIntelOverlay.open reads blindArchitect).
    blindArchitect_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.blindArchitect = true
      const bribe = Balance.MECHANIC_BLIND_ARCHITECT_BRIBE_GOLD ?? 400
      gameState.player.gold = (gameState.player.gold ?? 0) + bribe
      EventBus.emit('RESOURCES_AWARDED', { gold: bribe, reason: 'blind_architect_bribe' })
      try { document.getElementById('hud-stage')?.classList.add('qf-blind-architect') } catch {}
    },
    blindArchitect_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.blindArchitect = false
      try { document.getElementById('hud-stage')?.classList.remove('qf-blind-architect') } catch {}
    },

    // ── LEGENDARY · Colossus Heart ───────────────────────────────────────
    // Boss max HP x2 / attacks 50% slower (atk x0.5). Read in recompute.
    colossusHeart_activate: ({ gameState }) => {
      (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).colossusHeart = true
      EventBus.emit('BOSS_STATS_DIRTY')
    },
    colossusHeart_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.colossusHeart = false
      EventBus.emit('BOSS_STATS_DIRTY')
    },

    // ── LEGENDARY · The Apex Tyrant ──────────────────────────────────────
    // Boss +100% HP, +50% atk & def (recompute); all waves doubled (DayPhase).
    theApexTyrant_activate: ({ gameState }) => {
      (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).apexTyrant = true
      EventBus.emit('BOSS_STATS_DIRTY')
    },
    theApexTyrant_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.apexTyrant = false
      EventBus.emit('BOSS_STATS_DIRTY')
    },

    // ── LEGENDARY · Avatar of Ruin ───────────────────────────────────────
    // Boss max HP -50% (recompute); invincible first 10s of each fight
    // (_applyDamageToBoss reads avatarOfRuin + _fightStartedAt).
    avatarOfRuin_activate: ({ gameState }) => {
      (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).avatarOfRuin = true
      EventBus.emit('BOSS_STATS_DIRTY')
    },
    avatarOfRuin_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.avatarOfRuin = false
      EventBus.emit('BOSS_STATS_DIRTY')
    },

    // ── LEGENDARY · Wrath Unbound ────────────────────────────────────────
    // Boss attack scales up to +100% as HP falls (boss-fight bossAtk hook);
    // boss takes +50% damage (_applyDamageToBoss). Pure flag — dynamic per round.
    wrathUnbound_activate: ({ gameState }) => {
      (gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }).wrathUnbound = true
    },
    wrathUnbound_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.wrathUnbound = false
    },

    // ── LEGENDARY · Crown of Avarice ─────────────────────────────────────
    // All gold income x2 (AISystem goldMul + treasury); every Nth day a
    // guaranteed hero-grade raid (DayPhase wave x2 + +50% adv stats here).
    crownOfAvarice_activate: ({ subscribe, gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.crownOfAvarice = true
      f.avariceDayCount ??= 0
      subscribe('DAY_PHASE_STARTED', () => {
        const n = (gameState._mechanicFlags.avariceDayCount ?? 0) + 1
        gameState._mechanicFlags.avariceDayCount = n
        const interval = Balance.MECHANIC_AVARICE_RAID_INTERVAL_DAYS ?? 5
        gameState._mechanicFlags.avariceRaidToday = (n % interval === 0)
        if (gameState._mechanicFlags.avariceRaidToday) {
          EventBus.emit('SHOW_TOAST', { text: 'Crown of Avarice — a hero-grade raid descends!', kind: 'warn' })
        }
      })
      subscribe('NIGHT_PHASE_STARTED', () => { gameState._mechanicFlags.avariceRaidToday = false })
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!gameState._mechanicFlags.avariceRaidToday || !adventurer || adventurer._avariceHero) return
        adventurer._avariceHero = true
        const b = 1 + (Balance.MECHANIC_AVARICE_RAID_HERO_BUFF ?? 0.5)
        if (adventurer.resources) {
          adventurer.resources.maxHp = Math.round((adventurer.resources.maxHp ?? 0) * b)
          adventurer.resources.hp    = adventurer.resources.maxHp
        }
        if (adventurer.stats?.attack != null) adventurer.stats.attack = Math.round(adventurer.stats.attack * b)
      })
    },
    crownOfAvarice_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.crownOfAvarice = false
    },

    // ── LEGENDARY · The Iron Price ───────────────────────────────────────
    // Minions deal 2x (CombatSystem) + traps 2x (trapDamageMult); gold income
    // zeroed (AISystem goldMul=0 + treasury x0).
    theIronPrice_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theIronPrice = true
      f.trapDamageMult = (f.trapDamageMult ?? 1) * (Balance.MECHANIC_IRON_PRICE_DMG_MULT ?? 2)
    },
    theIronPrice_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.theIronPrice = false
      const m = Balance.MECHANIC_IRON_PRICE_DMG_MULT ?? 2
      gameState._mechanicFlags.trapDamageMult = (gameState._mechanicFlags.trapDamageMult ?? 1) / m
    },

    // ── LEGENDARY · Sudden Death ─────────────────────────────────────────
    // Everyone deals 5x: CombatSystem (minion<->adv), TrapSystem (trapDamageMult),
    // boss fight (_applyDamageToBoss party->boss + bossAtk boss->party).
    suddenDeath_activate: ({ gameState }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.suddenDeath = true
      f.trapDamageMult = (f.trapDamageMult ?? 1) * (Balance.MECHANIC_SUDDEN_DEATH_DMG_MULT ?? 5)
    },
    suddenDeath_deactivate: ({ gameState }) => {
      if (!gameState._mechanicFlags) return
      gameState._mechanicFlags.suddenDeath = false
      const m = Balance.MECHANIC_SUDDEN_DEATH_DMG_MULT ?? 5
      gameState._mechanicFlags.trapDamageMult = (gameState._mechanicFlags.trapDamageMult ?? 1) / m
    },

    // ── LEGENDARY · The Undying Court ────────────────────────────────────
    // Adventurers that die are queued; at night they rise as undead minions
    // of their class (stats carried over). With no free roster slots, 2 random
    // minions are sacrificed to make room. Living adventurers are buffed +2%
    // per court member.
    theUndyingCourt_activate: ({ subscribe, gameState, scene }) => {
      const f = gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}) }
      f.theUndyingCourt = true
      f.undyingCourtQueue ??= []
      f.undyingCourtCount ??= 0
      subscribe('ADVENTURER_DIED', ({ adventurer }) => {
        if (!adventurer) return
        gameState._mechanicFlags.undyingCourtQueue.push({
          classId: adventurer.classId ?? 'adventurer',
          name:    adventurer.name ?? adventurer.classId ?? 'Adventurer',
          level:   adventurer.level ?? 1,
          // LPC sheet id so MinionRenderer draws the risen minion as the dead
          // adventurer's sprite (tinted) — the "of its own class" look.
          spriteVariant: adventurer.spriteVariant ?? null,
          maxHp:   Math.max(1, Math.round(adventurer.resources?.maxHp ?? adventurer.resources?.hp ?? 20)),
          attack:  Math.max(1, Math.round(adventurer.stats?.attack ?? 5)),
          defense: Math.max(0, Math.round(adventurer.stats?.defense ?? 0)),
        })
      })
      subscribe('NIGHT_PHASE_STARTED', () => {
        const queue = gameState._mechanicFlags.undyingCourtQueue ?? []
        if (queue.length === 0) return
        const defs = scene?.cache?.json?.get('minionTypes') ?? []
        // Same base the Lich Necromancy uses; the dead adv's sprite is layered
        // on top via _raisedSpriteVariant so it reads as an undead of its class.
        const baseDef = defs.find(d => d.id === 'skeleton1') ?? defs[0]
        if (!baseDef) { gameState._mechanicFlags.undyingCourtQueue = []; return }
        const bossRoom = gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
        const bossLevel = gameState.boss?.level ?? 1
        const cap = rosterCap(gameState)
        for (const snap of queue) {
          // Make room: if the roster is full, sacrifice random roster minions.
          let roster = (gameState.minions ?? []).filter(m => m.faction === 'dungeon' && m.aiState !== 'dead' && (m.class ?? 'roster') === 'roster')
          if (roster.length >= cap && cap > 0) {
            const victims = [...roster].sort(() => Math.random() - 0.5).slice(0, Balance.MECHANIC_UNDYING_COURT_DISPLACE ?? 2)
            for (const v of victims) {
              const idx = gameState.minions.indexOf(v)
              if (idx >= 0) gameState.minions.splice(idx, 1)
              EventBus.emit('MINION_REMOVED', { minion: v, reason: 'undying_court' })
            }
          }
          const tx = (bossRoom?.gridX ?? 1) + 1
          const ty = (bossRoom?.gridY ?? 1) + 1
          const minion = createMinion(baseDef, { x: tx, y: ty }, bossRoom?.instanceId ?? null, { class: 'roster', bossLevel })
          // Rise as an undead of the fallen hero's class — mirror the Lich's
          // Necromancy recipe: class-tinted adventurer sprite + carried stats +
          // class-kit retention (range / damage type / tags).
          minion.isUndead             = true
          minion._undeadCourt         = true
          minion._raisedFromAdvDeath  = true
          minion._raisedClassId       = snap.classId
          minion._raisedAdvName       = snap.name
          minion._raisedSpriteVariant = snap.spriteVariant ?? null
          minion.displayName          = 'Risen ' + snap.name
          // Carry the hero's combat profile, then re-apply its class kit (range,
          // damage type, tags) the same way the Lich raise does.
          minion._baseMaxHp = snap.maxHp
          minion._baseAtk   = snap.attack
          if (minion.stats) minion.stats.defense = snap.defense
          applyBossLevelToMinion(minion, bossLevel)
          try { scene?.bossArchetypeSystem?._applyClassRetentionBuffs?.(minion, snap.classId) } catch {}
          gameState.minions.push(minion)
          gameState._mechanicFlags.undyingCourtCount = (gameState._mechanicFlags.undyingCourtCount ?? 0) + 1
          EventBus.emit('MINION_PLACED', { minion })
          EventBus.emit('UNDYING_COURT_RISEN', { minion, fromClass: snap.classId })
        }
        gameState._mechanicFlags.undyingCourtQueue = []
      })
      // Living adventurers grow stronger as the court swells.
      subscribe('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
        if (!adventurer || adventurer._courtBuffed) return
        const count = gameState._mechanicFlags.undyingCourtCount ?? 0
        if (count <= 0) return
        adventurer._courtBuffed = true
        const b = 1 + (Balance.MECHANIC_UNDYING_COURT_LIVING_BUFF_PER ?? 0.02) * count
        if (adventurer.resources) {
          adventurer.resources.maxHp = Math.round((adventurer.resources.maxHp ?? 0) * b)
          adventurer.resources.hp    = adventurer.resources.maxHp
        }
        if (adventurer.stats?.attack != null) adventurer.stats.attack = Math.round(adventurer.stats.attack * b)
      })
    },
    theUndyingCourt_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.theUndyingCourt = false
    },
  }
}


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
    return _shuffle(candidates).slice(0, count)
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

// ── Handler registry ──────────────────────────────────────────────────────
// Each handler is (ctx) => void. Use ctx.subscribe(event, fn) for bus listeners
// so they unwire automatically on deactivate.

function _buildHandlerRegistry() {
  return {
    // ── Eternal Night ────────────────────────────────────────────────────
    eternalNight_activate: ({ scene, gameState }) => {
      // The KnowledgeSystem already reads gameState.activeMechanics. The
      // EternalNightOverlay renderer (Game.js) reads the same flag and
      // dims rooms outside visibleRoomIds. No event subscriptions needed.
      scene.eternalNightOverlay?.setEnabled?.(true)
    },
    eternalNight_deactivate: ({ scene }) => {
      scene.eternalNightOverlay?.setEnabled?.(false)
    },

    // ── Memory Fog ───────────────────────────────────────────────────────
    memoryFog_activate: ({ subscribe, gameState }) => {
      // When an adventurer "sleeps" (handled by AISystem SLEEP goal completion),
      // forget MEMORY_FOG_FORGET_FRACTION of their knowledge entries.
      subscribe('ADVENTURER_SLEPT', ({ adventurer }) => {
        if (!adventurer?.knowledge) return
        _forgetFraction(adventurer.knowledge.rooms,   Balance.MECHANIC_MEMORY_FOG_FORGET_FRACTION)
        _forgetFraction(adventurer.knowledge.traps,   Balance.MECHANIC_MEMORY_FOG_FORGET_FRACTION)
        _forgetFraction(adventurer.knowledge.minions, Balance.MECHANIC_MEMORY_FOG_FORGET_FRACTION)
        EventBus.emit('KNOWLEDGE_FORGOTTEN', { adventurer, source: 'memory_fog' })
      })
    },
    memoryFog_deactivate: () => { /* subscriptions auto-cleaned */ },

    // ── Hunger ───────────────────────────────────────────────────────────
    hunger_activate: ({ state }) => { state.timeAccum = 0 },
    hunger_tick: ({ gameState, state }, deltaMs) => {
      state.timeAccum = (state.timeAccum ?? 0) + deltaMs
      while (state.timeAccum >= Balance.MECHANIC_HUNGER_TICK_INTERVAL_MS) {
        state.timeAccum -= Balance.MECHANIC_HUNGER_TICK_INTERVAL_MS
        for (const adv of gameState.adventurers.active) {
          if (adv.aiState === 'dead') continue
          adv.resources.hp = Math.max(0, adv.resources.hp - Balance.MECHANIC_HUNGER_DAMAGE_PER_TICK)
          EventBus.emit('HUNGER_BITE', { adventurer: adv })
        }
      }
    },
    hunger_deactivate: () => {},

    // ── Taxation of Souls ────────────────────────────────────────────────
    taxationOfSouls_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), taxationOfSouls: true }
      // ROOM_OBSERVED fires from KnowledgeSystem on first visit to a room each day.
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

    // ── Cursed Fountains ────────────────────────────────────────────────
    // Read by AISystem._applyRoomEffects — when active, healing_fountain damages
    // instead of healing. This handler just sets a runtime flag for systems to read.
    cursedFountains_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), cursedFountains: true }
    },
    cursedFountains_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.cursedFountains = false
    },

    // ── No Health Regen ──────────────────────────────────────────────────
    noHealthRegen_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), noHealthRegen: true }
    },
    noHealthRegen_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.noHealthRegen = false
    },

    // ── Bloodbound ───────────────────────────────────────────────────────
    bloodbound_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), bloodbound: true }
    },
    bloodbound_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.bloodbound = false
    },

    // ── Knowledge is Pain ────────────────────────────────────────────────
    knowledgeIsPain_activate: ({ subscribe, gameState }) => {
      subscribe('COMBAT_HIT', (payload) => {
        // Boost damage if the room is "cleared" (visited multiple times) for that adventurer
        const adv = gameState.adventurers.active.find(a => a.instanceId === payload.targetId)
        if (!adv) return
        const here = adv.knowledge?.rooms ?? {}
        // Find the room the adventurer is in
        for (const entry of Object.values(here)) {
          if (entry?.lastVisitedDay === gameState.meta.dayNumber && entry.visitCount >= 2) {
            const bonus = Math.round(payload.damage * Balance.MECHANIC_KNOWLEDGE_PAIN_BONUS)
            if (bonus > 0) {
              adv.resources.hp = Math.max(0, adv.resources.hp - bonus)
              EventBus.emit('KNOWLEDGE_PAIN_TICK', { adventurer: adv, bonus })
            }
            break
          }
        }
      })
    },
    knowledgeIsPain_deactivate: () => {},

    // ── Gravitational Anomaly ────────────────────────────────────────────
    gravitationalAnomaly_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), gravAnomaly: true }
    },
    gravitationalAnomaly_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.gravAnomaly = false
    },

    // ── Mimicry Plague ───────────────────────────────────────────────────
    // Phase 10: at the start of each day, ~20% of dropped loot is replaced
    // by hidden Mimic minions disguised as the same item. The first
    // adventurer to attempt pickup triggers the reveal — Mimic stops being
    // hidden, attacks them in melee, normal MinionAISystem takes over.
    mimicryPlague_activate: ({ gameState, scene, subscribe }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), mimicryPlague: true }
      subscribe('DAY_PHASE_STARTED', () => _spawnMimics(scene, gameState))
    },
    mimicryPlague_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.mimicryPlague = false
    },

    // ── Paranoia Protocol (data flag — UI overlay deferred) ──────────────
    paranoiaProtocol_activate: ({ gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), paranoiaProtocol: true }
    },
    paranoiaProtocol_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.paranoiaProtocol = false
    },

    // ── Loot Curse ───────────────────────────────────────────────────────
    lootCurse_activate: ({ subscribe, gameState }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), lootCurse: true }
      // Tag freshly dropped loot as cursed. Higher-rarity items roll a
      // higher curseLevel (1 common → 3 rare/mythic) so the debuff stacks
      // are proportional to the lure of the gear.
      subscribe('LOOT_DROPPED', ({ item }) => {
        if (!item) return
        item.cursed = true
        const rarityToLevel = { common: 1, uncommon: 2, rare: 3, mythic: 3 }
        item.curseLevel = rarityToLevel[item.rarity ?? 'common'] ?? 1
      })
    },
    lootCurse_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.lootCurse = false
    },
    lootCurse_tickDebuffs: ({ gameState }) => {
      // Phase QW — cursed equipment debuff scales with curseLevel:
      //   level 1 → -1 attack per day, level 2 → -2, level 3 → -3.
      // Stacks persist across days; minions wearing rare cursed gear bleed
      // out their stats fast. Adventurers will too once equip code lands.
      for (const m of gameState.minions ?? []) {
        const equipped = m.equippedGear ?? []
        const dungeonLoot = gameState.loot?.dungeon ?? []
        let cursedAtkLoss = 0
        for (const itemId of equipped) {
          const it = dungeonLoot.find(i => i.instanceId === itemId)
          if (it?.cursed) cursedAtkLoss += (it.curseLevel ?? 1)
        }
        if (cursedAtkLoss > 0) {
          m._cursedDebuffStacks = (m._cursedDebuffStacks ?? 0) + cursedAtkLoss
          m.stats = m.stats ?? {}
          m.stats.attack = Math.max(1, (m.stats.attack ?? 1) - cursedAtkLoss)
        }
      }
    },

    // ── Spectral Reinforcements ──────────────────────────────────────────
    // Phase 9b: at the start of each day, spawn one minion-faction ghost in
    // each room where an adventurer died, capped at 3 ghosts/day to avoid
    // snowballing. Ghosts are dungeon-faction (helpful) phantom skeletons
    // that fight for the boss. Ticked via DAY_PHASE_STARTED rather than
    // onDailyTick so the spawn happens before adventurers arrive.
    spectralReinforcements_activate: ({ gameState, scene, subscribe }) => {
      gameState._mechanicFlags = { ...(gameState._mechanicFlags ?? {}), spectralReinforcements: true }
      subscribe('DAY_PHASE_STARTED', () => {
        _spawnSpectralGhosts(scene, gameState)
      })
    },
    spectralReinforcements_deactivate: ({ gameState }) => {
      if (gameState._mechanicFlags) gameState._mechanicFlags.spectralReinforcements = false
    },
    spectralReinforcements_spawnGhosts: () => { /* tick-based spawn handled via DAY_PHASE_STARTED */ },
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _forgetFraction(map, fraction) {
  if (!map) return
  const keys = Object.keys(map)
  const dropCount = Math.floor(keys.length * fraction)
  if (dropCount === 0) return
  const shuffled = _shuffle([...keys])
  for (let i = 0; i < dropCount; i++) delete map[shuffled[i]]
}

function _shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Spawn dungeon-faction "ghost" minions in rooms where adventurers died recently.
// Caps at 3 per day; reuses the cheapest minion definition so we don't have
// to introduce a new type. Ghosts are flagged isSpectral so renderers can
// draw them translucent.
function _spawnSpectralGhosts(scene, gameState) {
  const minionTypes = scene.cache.json.get('minionTypes') ?? []
  if (minionTypes.length === 0) return
  const baseDef = minionTypes.find(d => d.id === 'ghost1') ?? minionTypes[0]
  const TS = (gameState.dungeon?.tileSize ?? 32)

  // Find rooms where a recent death happened (within last 3 days)
  const today = gameState.meta?.dayNumber ?? 1
  const recent = (gameState.adventurers?.graveyard ?? [])
    .filter(g => today - (g.diedOnDay ?? 0) <= 3)
  if (recent.length === 0) return

  const roomsWithDeaths = new Map()  // roomId → tileX/tileY
  for (const g of recent) {
    if (!g.tileX || !g.tileY) continue
    const room = (gameState.dungeon.rooms ?? []).find(r =>
      g.tileX >= r.gridX && g.tileX < r.gridX + r.width &&
      g.tileY >= r.gridY && g.tileY < r.gridY + r.height
    )
    if (!room) continue
    if (!roomsWithDeaths.has(room.instanceId)) {
      roomsWithDeaths.set(room.instanceId, { x: g.tileX, y: g.tileY, room })
    }
  }

  let spawned = 0
  for (const { x, y, room } of roomsWithDeaths.values()) {
    if (spawned >= 3) break
    const ghost = {
      instanceId:    `ghost_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      definitionId:  baseDef.id,
      name:          `Spectre of ${room.definitionId}`,
      faction:       'dungeon',
      isSpectral:    true,
      assignedRoomId: room.instanceId,
      homeTileX:     x,
      homeTileY:     y,
      tileX: x, tileY: y,
      worldX: x * TS + TS / 2, worldY: y * TS + TS / 2,
      stats: { ...(baseDef.baseStats ?? { attack: 4, defense: 1, speed: 1 }) },
      resources: {
        hp:    Math.floor((baseDef.baseStats?.hp ?? 20) * 0.6),
        maxHp: Math.floor((baseDef.baseStats?.hp ?? 20) * 0.6),
      },
      aiState: 'idle',
      level:   1,
      xp:      0,
      tags:    ['undead', 'spectral'],
      equippedGear: [],
      killHistory: [],
      evolutionHistory: [],
      timesKilledAndRespawned: 0,
      lastAttackAt: 0,
      currentTargetId: null,
    }
    gameState.minions ??= []
    gameState.minions.push(ghost)
    spawned++
    EventBus.emit('SPECTRAL_GHOST_SPAWNED', { minion: ghost, roomId: room.instanceId })
  }
}

// Phase 10 — Spawn Mimics for 20% of unclaimed dungeon loot. Each mimic
// attaches to the loot tile and is hidden until any adventurer steps onto
// the tile (handled by AISystem trigger lookup).
function _spawnMimics(scene, gameState) {
  const minionTypes = scene.cache.json.get('minionTypes') ?? []
  const mimicDef = minionTypes.find(d => d.id === 'mimic')
  if (!mimicDef) return
  const TS = 32

  const loot = (gameState.loot?.dungeon ?? []).filter(i => i.tileX != null)
  let count = 0
  for (const item of loot) {
    if (item.isMimicSpawn) continue
    if (Math.random() > Balance.MECHANIC_MIMICRY_CHEST_RATE) continue
    item.isMimicSpawn = true   // mark so it can't be picked up cleanly

    const room = (gameState.dungeon.rooms ?? []).find(r =>
      item.tileX >= r.gridX && item.tileX < r.gridX + r.width &&
      item.tileY >= r.gridY && item.tileY < r.gridY + r.height
    )

    const mimic = {
      instanceId:    `mimic_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      definitionId:  'mimic',
      name:          'Mimic',
      faction:       'dungeon',
      isMimic:       true,
      hiddenAsLoot:  true,
      disguisedItemId: item.instanceId,
      assignedRoomId: room?.instanceId ?? null,
      homeTileX:     item.tileX,
      homeTileY:     item.tileY,
      tileX: item.tileX, tileY: item.tileY,
      worldX: item.tileX * TS + TS / 2, worldY: item.tileY * TS + TS / 2,
      stats: { ...mimicDef.baseStats },
      resources: {
        hp:    mimicDef.baseStats.hp,
        maxHp: mimicDef.baseStats.hp,
      },
      aiState: 'idle',
      level:   1, xp: 0,
      tags:    [...(mimicDef.tags ?? [])],
      equippedGear: [],
      killHistory: [],
      evolutionHistory: [],
      timesKilledAndRespawned: 0,
      lastAttackAt: 0,
      currentTargetId: null,
    }
    gameState.minions ??= []
    gameState.minions.push(mimic)
    count++
  }
  if (count > 0) EventBus.emit('MIMICS_SPAWNED', { count })
}

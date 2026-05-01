// Phase QW (extension of Phase 6e behaviors).
//
// Handles per-room special behaviors that don't fit neatly into AISystem.
// Each handler is called by Game.js or DayPhase/NightPhase at the relevant
// lifecycle moment (night start, adventurer entry, etc.).
//
// Currently:
//   - necropolis_convertCorpses (NIGHT_PHASE_STARTED) — raises a fresh
//     skeleton minion in each Necropolis Wing room from the most-recent
//     uncollected corpse.
//   - colosseum_lockGates (ADVENTURER_ENTERED_ROOM) — spawns a wave of 3
//     skeleton warriors when an adventurer first enters a Colosseum room.
//   - falseExit_teleport (ADVENTURER_ROOM_CHANGED) — when a fleeing
//     adventurer crosses through a False Exit, teleport them adjacent to
//     the boss chamber instead of letting them escape.
//
// All behaviors are no-ops when their host room doesn't exist.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

export class RoomBehaviorSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._listeners = []
    this._lastRoomByAdv = {}    // for false-exit detection (entering from flee)

    EventBus.on('NIGHT_PHASE_STARTED', this._onNightStart, this)
    EventBus.on('ADVENTURER_ROOM_CHANGED', this._onRoomChanged, this)
    this._listeners = [
      ['NIGHT_PHASE_STARTED', this._onNightStart],
      ['ADVENTURER_ROOM_CHANGED', this._onRoomChanged],
    ]
  }

  destroy() {
    for (const [evt] of this._listeners) {
      // Bound methods need explicit ref — recreate to off cleanly.
    }
    EventBus.off('NIGHT_PHASE_STARTED', this._onNightStart, this)
    EventBus.off('ADVENTURER_ROOM_CHANGED', this._onRoomChanged, this)
  }

  // ── Necropolis Wing — corpse-to-minion conversion at night ───────────────

  _onNightStart() {
    // Bug fix — reset per-day flags on rooms so Colosseum waves re-arm
    // and any future per-day room state can ride this same hook.
    for (const room of (this._gameState.dungeon.rooms ?? [])) {
      room._wavesSpawned = false
    }

    // Phase QW — Hidden Keys: if any room is locked but no iron_key sits in
    // the dungeon, drop one in a random non-boss room each night so progression
    // doesn't stall. Adventurers must find it before they can enter the locked room.
    const dungeon = this._gameState.dungeon
    const hasLockedRoom = (dungeon.rooms ?? []).some(r => r.locked)
    const hasKeyOnFloor = (this._gameState.loot?.dungeon ?? []).some(
      i => i.definitionId === 'iron_key' && i.tileX != null
    )
    if (hasLockedRoom && !hasKeyOnFloor) {
      const candidates = (dungeon.rooms ?? []).filter(r =>
        r.definitionId !== 'boss_chamber' && !r.locked
      )
      if (candidates.length > 0) {
        const room = candidates[Math.floor(Math.random() * candidates.length)]
        const x = room.gridX + Math.floor(room.width / 2)
        const y = room.gridY + Math.floor(room.height / 2)
        const key = {
          instanceId:    `key_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          definitionId:  'iron_key',
          type:          'key',
          rarity:        'uncommon',
          tier:          1,
          tileX: x, tileY: y,
          worldX: x * 32 + 16, worldY: y * 32 + 16,
          dungeonRoomId: room.instanceId,
          provenance: [{ kind: 'hidden_drop', day: this._gameState.meta.dayNumber }],
        }
        this._gameState.loot ??= { dungeon: [] }
        this._gameState.loot.dungeon ??= []
        this._gameState.loot.dungeon.push(key)
        EventBus.emit('HIDDEN_KEY_DROPPED', { key, roomId: room.instanceId })
      }
    }

    // Room redesign 2026-04-30 — Treasury: spawn / refill chests, pay daily
    // stipend (+5 essence per active Treasury). Chests refill to 4 each
    // night; daily stipend is independent of chest theft. Chests with
    // `_treasuryChest: true` are intercepted in AISystem on pickup so they
    // attach to the carrier rather than equipping like normal loot.
    const treasuries = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.definitionId === 'treasury' && r.isActive !== false
    )
    if (treasuries.length > 0) {
      const stipend = 5 * treasuries.length
      this._gameState.player.soulEssence = (this._gameState.player.soulEssence ?? 0) + stipend
      EventBus.emit('TREASURY_STIPEND', { amount: stipend, treasuryCount: treasuries.length })

      this._gameState.loot ??= { dungeon: [] }
      this._gameState.loot.dungeon ??= []
      for (const room of treasuries) {
        const existing = this._gameState.loot.dungeon.filter(i =>
          i._treasuryChest && i._sourceTreasuryId === room.instanceId
        ).length
        const toSpawn = Math.max(0, 4 - existing)
        // Place chests on a small grid inside the room, biased to corners.
        const inner = {
          x0: room.gridX + Balance.WALL_THICKNESS,
          y0: room.gridY + Balance.WALL_THICKNESS,
          x1: room.gridX + room.width  - Balance.WALL_THICKNESS - 1,
          y1: room.gridY + room.height - Balance.WALL_THICKNESS - 1,
        }
        const slots = [
          [inner.x0,     inner.y0],
          [inner.x1,     inner.y0],
          [inner.x0,     inner.y1],
          [inner.x1,     inner.y1],
        ]
        // Skip slots that already have a chest there.
        const occupied = new Set(
          this._gameState.loot.dungeon
            .filter(i => i._treasuryChest && i._sourceTreasuryId === room.instanceId)
            .map(i => `${i.tileX},${i.tileY}`)
        )
        let spawned = 0
        for (const [x, y] of slots) {
          if (spawned >= toSpawn) break
          if (occupied.has(`${x},${y}`)) continue
          this._gameState.loot.dungeon.push({
            instanceId:     `chest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${spawned}`,
            definitionId:   'treasury_chest',
            _treasuryChest: true,
            _essenceValue:  10,
            _sourceTreasuryId: room.instanceId,
            tileX: x, tileY: y,
            worldX: x * 32 + 16, worldY: y * 32 + 16,
            dungeonRoomId: room.instanceId,
            provenance: [{ kind: 'treasury_spawn', day: this._gameState.meta.dayNumber, roomId: room.instanceId }],
            statModifiers: [],
            curseLevel: 0,
            currentEquippedBy: null,
          })
          spawned++
        }
      }
    }

    // Room redesign 2026-04-30 — Library of Whispers: forecast next day's
    // base party composition so the player can plan ahead. Tier scales with
    // boss level (L4 size+classes baseline; L6 +personalities, L8 +stats,
    // L10 +route — those tiers ship with boss-level gating later).
    const hasLibrary = (this._gameState.dungeon.rooms ?? []).some(r =>
      r.definitionId === 'library_of_whispers' && r.isActive !== false
    )
    if (hasLibrary) {
      const allClasses = this._scene.cache.json.get('adventurerClasses') ?? []
      const dungeonLv = this._gameState.meta.dungeonLevel ?? 1
      const classes = allClasses.filter(c => (c.unlockLevel ?? 1) <= dungeonLv)
      const day = this._gameState.meta.dayNumber
      const baseCount = Balance.ADVENTURERS_PER_DAY_BASE + Math.floor((day - 1) / 2)
      const size = Math.max(0, Math.min(baseCount, classes.length * 2))
      const classCounts = {}
      for (let i = 0; i < size && classes.length; i++) {
        const cls = classes[Math.floor(Math.random() * classes.length)]
        classCounts[cls.id] = (classCounts[cls.id] ?? 0) + 1
      }
      this._gameState.meta.nextPartyPreview = { day, size, classCounts }
      EventBus.emit('LIBRARY_FORECAST', this._gameState.meta.nextPartyPreview)
    } else if (this._gameState.meta.nextPartyPreview) {
      // No Library this night — clear stale forecast so the panel hides.
      this._gameState.meta.nextPartyPreview = null
    }

    // Room redesign 2026-04-30 — Veil of Forgetting: scrub adventurer
    // intel of all rooms directly door-connected to each Veil. Only the
    // shared rumour pool is touched; per-adv knowledge is on the dead.
    const veils = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.definitionId === 'veil_of_forgetting' && r.isActive !== false
    )
    if (veils.length > 0 && this._scene?.dungeonGrid && this._gameState.knowledge?.sharedPool) {
      const pool = this._gameState.knowledge.sharedPool
      const erased = new Set()
      for (const veil of veils) {
        const neighbors = this._scene.dungeonGrid.getNeighborRooms(veil.instanceId) ?? []
        for (const n of neighbors) {
          if (n.definitionId === 'boss_chamber' || n.definitionId === 'entry_hall') continue
          delete pool.rooms?.[n.instanceId]
          delete pool.enemiesPerRoom?.[n.instanceId]
          // Trap and loot intel are keyed by item id but stamped with a roomId — wipe matching entries.
          if (pool.traps) {
            for (const tid of Object.keys(pool.traps)) {
              if (pool.traps[tid]?.roomId === n.instanceId) delete pool.traps[tid]
            }
          }
          if (pool.loot) {
            for (const lid of Object.keys(pool.loot)) {
              if (pool.loot[lid]?.roomId === n.instanceId) delete pool.loot[lid]
            }
          }
          erased.add(n.instanceId)
        }
      }
      if (erased.size > 0) {
        EventBus.emit('VEIL_ERASED_INTEL', { roomIds: [...erased] })
      }
    }

    const minionTypes = this._scene.cache.json.get('minionTypes') ?? []
    const baseDef = minionTypes.find(d => d.id === 'skeleton1') ?? minionTypes[0]
    if (!baseDef) return
    const TS = 32

    // Room redesign 2026-04-30 — Crypt spawns up to 4 garrison Risen Bones,
    // refilling each Night Phase. Garrison minions are room-bound (cannot
    // patrol or chase outside the Crypt) and do NOT count toward the
    // Barracks roster cap.
    const crypts = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.definitionId === 'crypt' && r.isActive !== false
    )
    for (const room of crypts) {
      const alreadyHere = (this._gameState.minions ?? [])
        .filter(m => m.assignedRoomId === room.instanceId && m.isCryptSpawn).length
      const toSpawn = Math.max(0, 4 - alreadyHere)
      for (let i = 0; i < toSpawn; i++) {
        // Spread the spawn points so they don't all stack on one tile.
        const x = room.gridX + Balance.WALL_THICKNESS + (i % Math.max(1, room.width - 2 * Balance.WALL_THICKNESS))
        const y = room.gridY + Math.floor(room.height / 2)
        const m = {
          instanceId:    `crypt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${i}`,
          definitionId:  baseDef.id,
          name:          'Risen Bones',
          faction:       'dungeon',
          class:         'garrison',
          isCryptSpawn:  true,
          assignedRoomId: room.instanceId,
          behaviorType:  baseDef.behaviorType ?? 'patrol',
          homeTileX: x, homeTileY: y, tileX: x, tileY: y,
          worldX: x * TS + TS / 2, worldY: y * TS + TS / 2,
          stats: { ...(baseDef.baseStats ?? { hp: 30, attack: 8, defense: 4, speed: 1 }) },
          resources: { hp: baseDef.baseStats?.hp ?? 30, maxHp: baseDef.baseStats?.hp ?? 30 },
          aiState: 'idle', level: 1, xp: 0,
          tags: [...(baseDef.tags ?? []), 'undead'],
          equippedGear: [], killHistory: [], evolutionHistory: [],
          timesKilledAndRespawned: 0, lastAttackAt: 0, currentTargetId: null,
        }
        this._gameState.minions ??= []
        this._gameState.minions.push(m)
        EventBus.emit('CRYPT_SPAWNED', { minion: m, roomId: room.instanceId })
      }
    }

    // Phase QW — Necropolis Wing — corpse-to-minion conversion at night.
    const necros = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.definitionId === 'necropolis_wing' && r.isActive !== false
    )
    if (necros.length === 0) return

    for (const room of necros) {
      const corpse = (this._gameState.adventurers.graveyard ?? []).find(g =>
        !g.collected && !g.raisedAsMinion
      )
      if (!corpse) continue
      corpse.raisedAsMinion = true

      const x = room.gridX + Math.floor(room.width / 2)
      const y = room.gridY + Math.floor(room.height / 2)
      const m = {
        instanceId:    `necro_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        definitionId:  baseDef.id,
        name:          `Risen ${corpse.name ?? 'Adventurer'}`,
        faction:       'dungeon',
        isRaisedFromCorpse: true,
        raisedFromAdvId: corpse.instanceId,
        assignedRoomId: room.instanceId,
        homeTileX: x, homeTileY: y,
        tileX: x, tileY: y,
        worldX: x * TS + TS / 2, worldY: y * TS + TS / 2,
        stats: { ...(baseDef.baseStats ?? { hp: 30, attack: 8, defense: 4, speed: 1 }) },
        resources: {
          hp:    baseDef.baseStats?.hp ?? 30,
          maxHp: baseDef.baseStats?.hp ?? 30,
        },
        aiState: 'idle', level: 1, xp: 0,
        tags: [...(baseDef.tags ?? []), 'undead'],
        equippedGear: [],
        killHistory: [], evolutionHistory: [],
        timesKilledAndRespawned: 0,
        lastAttackAt: 0, currentTargetId: null,
      }
      this._gameState.minions ??= []
      this._gameState.minions.push(m)
      EventBus.emit('CORPSE_RAISED', { minion: m, fromCorpse: corpse, roomId: room.instanceId })
    }
  }

  // ── Colosseum + False Exit — react on room change ────────────────────────

  _onRoomChanged({ adventurer, fromRoomId, toRoomId }) {
    if (!adventurer || !toRoomId) return
    const room = this._gameState.dungeon.rooms.find(r => r.instanceId === toRoomId)
    if (!room) return

    if (room.definitionId === 'colosseum') {
      this._lockColosseumGates(room, adventurer)
    }

    if (room.definitionId === 'false_exit') {
      // Only "trigger" when the adventurer is fleeing — i.e. their goal type
      // is FLEE and they think they're heading out.
      if (adventurer.goal?.type === 'FLEE') {
        this._teleportToNearBoss(adventurer)
      }
    }

    // Room redesign 2026-04-30 — Wandering Gate: weighted teleport on entry.
    // Cooldown prevents the teleport-induced ROOM_CHANGED from re-triggering.
    if (room.definitionId === 'wandering_gate') {
      const today = this._gameState.meta.dayNumber
      if (adventurer._wanderingGateCooldownDay !== today) {
        adventurer._wanderingGateCooldownDay = today
        this._teleportFromWanderingGate(adventurer, room)
      }
    }

    // Room redesign 2026-04-30 — Wishing Well: coin flip once per day per adv.
    if (room.definitionId === 'wishing_well') {
      const today = this._gameState.meta.dayNumber
      adventurer.flags ??= {}
      if (adventurer.flags.wishingWellRolledOnDay !== today) {
        adventurer.flags.wishingWellRolledOnDay = today
        this._rollWishingWell(adventurer)
      }
    }
  }

  _teleportFromWanderingGate(adv, gateRoom) {
    const rooms = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.isActive !== false && r.definitionId !== 'wandering_gate'
    )
    const boss = rooms.find(r => r.definitionId === 'boss_chamber')
    const neighbors = (this._scene?.dungeonGrid?.getNeighborRooms?.(gateRoom.instanceId) ?? [])
      .filter(r => r.definitionId !== 'wandering_gate' && r.isActive !== false)
    const anyBuilt = rooms.filter(r => r.definitionId !== 'boss_chamber')

    const roll = Math.random()
    let target = null
    if (roll < 0.60 && neighbors.length > 0) {
      target = neighbors[Math.floor(Math.random() * neighbors.length)]
    } else if (roll < 0.95 && anyBuilt.length > 0) {
      target = anyBuilt[Math.floor(Math.random() * anyBuilt.length)]
    } else if (boss) {
      target = boss
    }
    // Fallbacks if buckets were empty (very small dungeons)
    if (!target && anyBuilt.length > 0) target = anyBuilt[Math.floor(Math.random() * anyBuilt.length)]
    if (!target) return

    const tx = target.gridX + Math.floor(target.width / 2)
    const ty = target.gridY + Math.floor(target.height / 2)
    const TS = 32
    adv.tileX = tx; adv.tileY = ty
    adv.worldX = tx * TS + TS / 2
    adv.worldY = ty * TS + TS / 2
    adv.path = null
    EventBus.emit('WANDERING_GATE_TELEPORTED', {
      adventurer: adv,
      destinationRoomId: target.instanceId,
      destinationDefId: target.definitionId,
    })
  }

  _rollWishingWell(adv) {
    const heads = Math.random() < 0.5
    if (heads) {
      // Buff: +3 ATK, +20 maxHp, full heal
      adv.stats ??= {}
      adv.stats.attack = (adv.stats.attack ?? 0) + 3
      adv.resources ??= { hp: 0, maxHp: 0 }
      adv.resources.maxHp = (adv.resources.maxHp ?? 0) + 20
      adv.resources.hp = adv.resources.maxHp
      EventBus.emit('WISHING_WELL_BOON', { adventurer: adv })
    } else {
      // Tails: Marked — +50% damage from minions for the rest of the day.
      adv.flags ??= {}
      adv.flags.marked = true
      adv.flags.markedExpiresOnDay = this._gameState.meta.dayNumber
      EventBus.emit('WISHING_WELL_CURSE', { adventurer: adv })
    }
  }

  _lockColosseumGates(room, adventurer) {
    if (room._wavesSpawned) return    // one wave per day
    room._wavesSpawned = true
    const minionTypes = this._scene.cache.json.get('minionTypes') ?? []
    const def = minionTypes.find(d => d.id === 'skeleton_warrior') ?? minionTypes[0]
    if (!def) return
    const TS = 32

    for (let i = 0; i < 3; i++) {
      const x = room.gridX + Balance.WALL_THICKNESS + i
      const y = room.gridY + Math.floor(room.height / 2)
      const m = {
        instanceId:    `colo_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 4)}`,
        definitionId:  def.id,
        name:          'Colosseum Champion',
        faction:       'dungeon',
        isColosseumWave: true,
        assignedRoomId: room.instanceId,
        homeTileX: x, homeTileY: y, tileX: x, tileY: y,
        worldX: x * TS + TS / 2, worldY: y * TS + TS / 2,
        stats: { ...(def.baseStats ?? { hp: 30, attack: 8, defense: 4, speed: 1 }) },
        resources: { hp: def.baseStats?.hp ?? 30, maxHp: def.baseStats?.hp ?? 30 },
        aiState: 'idle', level: 1, xp: 0,
        tags: [...(def.tags ?? [])],
        equippedGear: [], killHistory: [], evolutionHistory: [],
        timesKilledAndRespawned: 0, lastAttackAt: 0, currentTargetId: null,
      }
      this._gameState.minions ??= []
      this._gameState.minions.push(m)
    }
    EventBus.emit('COLOSSEUM_WAVE_SPAWNED', { roomId: room.instanceId, count: 3 })
  }

  _teleportToNearBoss(adv) {
    const boss = this._gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
    if (!boss) return
    const tx = boss.gridX + Math.floor(boss.width / 2)
    const ty = boss.gridY + Math.floor(boss.height / 2) + 1
    adv.tileX = tx; adv.tileY = ty
    const TS = 32
    adv.worldX = tx * TS + TS / 2
    adv.worldY = ty * TS + TS / 2
    adv.path = null
    adv.goal = { type: 'AT_BOSS' }
    adv.aiState = 'fighting'
    EventBus.emit('FALSE_EXIT_TELEPORTED', { adventurer: adv })
  }
}

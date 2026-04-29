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

    const minionTypes = this._scene.cache.json.get('minionTypes') ?? []
    const baseDef = minionTypes.find(d => d.id === 'skeleton1') ?? minionTypes[0]
    if (!baseDef) return
    const TS = 32

    // Phase QW — Crypt rooms spawn one fresh undead each night (free!).
    // Caps at 1 per crypt to avoid runaway numbers.
    const crypts = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.definitionId === 'crypt' && r.isActive !== false
    )
    for (const room of crypts) {
      const alreadyHere = (this._gameState.minions ?? [])
        .filter(m => m.assignedRoomId === room.instanceId && m.isCryptSpawn).length
      if (alreadyHere >= 2) continue   // soft cap so it doesn't snowball
      const x = room.gridX + Math.floor(room.width / 2)
      const y = room.gridY + Math.floor(room.height / 2)
      const m = {
        instanceId:    `crypt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        definitionId:  baseDef.id,
        name:          'Risen Skeleton',
        faction:       'dungeon',
        isCryptSpawn:  true,
        assignedRoomId: room.instanceId,
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
  }

  _lockColosseumGates(room, adventurer) {
    if (room._wavesSpawned) return    // one wave per day
    room._wavesSpawned = true
    const minionTypes = this._scene.cache.json.get('minionTypes') ?? []
    const def = minionTypes.find(d => d.id === 'skeleton_warrior') ?? minionTypes[0]
    if (!def) return
    const TS = 32

    for (let i = 0; i < 3; i++) {
      const x = room.gridX + 1 + i
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

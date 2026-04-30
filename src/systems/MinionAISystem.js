// Per-tick minion AI.
// Phase 6 kernel:
//   - guard:  hold home tile; engage adventurer in same room within aggro range
//   - patrol: wander home room idly; engage on contact
//   - utility (sapper, herald): no combat behaviour yet (Phase 6b)
// Engagement: chase target until in attackRange, then call CombatSystem.tryAttack.
// Minions return to home tile when target leaves their assigned room.

import { EventBus }         from './EventBus.js'
import { PathfinderSystem } from './PathfinderSystem.js'
import { Balance }          from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class MinionAISystem {
  constructor(scene, gameState, dungeonGrid, combatSystem) {
    this._scene = scene
    this._gameState = gameState
    this._dungeonGrid = dungeonGrid
    this._combatSystem = combatSystem
    // Phase 6e:
    //   _wokenRooms — barracks-style rooms where combat has started (minions sleep until then)
    //   _alertedRooms — rooms whose minions are alerted (hall_of_echoes propagation)
    this._wokenRooms = new Set()
    this._alertedRooms = new Map()  // roomId → expiresAt (scene.time.now)

    EventBus.on('COMBAT_HIT', this._onCombatHit, this)
    EventBus.on('NIGHT_PHASE_STARTED', this._resetRoomState, this)
    EventBus.on('MINION_DIED', this._onMinionDied, this)
  }

  destroy() {
    EventBus.off('COMBAT_HIT', this._onCombatHit, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._resetRoomState, this)
    EventBus.off('MINION_DIED', this._onMinionDied, this)
  }

  // Mourner stacking: attack buff for any same-room ally that's still standing
  _onMinionDied({ minion: dead }) {
    if (!dead) return
    const room = dead.assignedRoomId
    for (const m of this._gameState.minions) {
      if (m === dead || m.aiState === 'dead') continue
      if (m.faction !== 'dungeon') continue
      if (m.assignedRoomId !== room) continue
      if (m.definitionId !== 'mourner') continue
      m.stats.attack = (m.stats.attack ?? 0) + Balance.MOURNER_DAMAGE_BUFF_PER_DEATH
      m._mournerStacks = (m._mournerStacks ?? 0) + 1
      EventBus.emit('MOURNER_STACKED', { minion: m, stacks: m._mournerStacks })
    }
  }

  _resetRoomState() {
    this._wokenRooms.clear()
    this._alertedRooms.clear()
  }

  // Combat in a barracks wakes everyone there. Combat in a hall_of_echoes
  // alerts minions in adjacent rooms (they'll cross-room engage briefly).
  _onCombatHit({ sourceId, targetId, roomId: hintRoomId }) {
    const source = this._gameState.adventurers.active.find(a => a.instanceId === sourceId)
                 ?? this._gameState.minions.find(m => m.instanceId === sourceId)
    const target = this._gameState.adventurers.active.find(a => a.instanceId === targetId)
                 ?? this._gameState.minions.find(m => m.instanceId === targetId)
    const tile   = source ?? target
    if (!tile) return
    const room = this._dungeonGrid.getRoomAtTile(tile.tileX, tile.tileY)
    if (!room) return

    // Wake barracks-style rooms on first combat
    if (room.definitionId === 'starter_barracks' || room.definitionId === 'barracks') {
      this._wokenRooms.add(room.instanceId)
    }

    // Hall of Echoes — propagate alert to adjacent rooms
    if (room.definitionId === 'hall_of_echoes') {
      const expiresAt = (this._scene.time?.now ?? 0) + 8000  // 8s alert window
      const neighbors = this._dungeonGrid.getNeighborRooms(room.instanceId)
      for (const n of neighbors) this._alertedRooms.set(n.instanceId, expiresAt)
    }
  }

  _isRoomSleeping(room) {
    // Phase 6e: starter_barracks sleeps until combat in it.
    const sleepy = room.definitionId === 'starter_barracks' || room.definitionId === 'barracks'
    if (!sleepy) return false
    return !this._wokenRooms.has(room.instanceId)
  }

  _isRoomAlerted(roomId) {
    const exp = this._alertedRooms.get(roomId)
    if (!exp) return false
    if ((this._scene.time?.now ?? 0) >= exp) {
      this._alertedRooms.delete(roomId)
      return false
    }
    return true
  }

  update(delta) {
    const minions = this._gameState.minions
    for (let i = 0; i < minions.length; i++) {
      this._tickMinion(minions[i], delta, i)
    }
  }

  // ── Per-minion tick ────────────────────────────────────────────────────────

  _tickMinion(minion, delta, idx) {
    if (minion.aiState === 'dead') return

    if (minion.resources.hp <= 0) {
      this._die(minion, idx)
      return
    }

    // Phase QW — Patrol behavior: idle minions with `behaviorType: 'patrol'`
    // shuffle to a random walkable tile in their home room every ~3s when no
    // hostiles are in sight. Cosmetic but makes the dungeon feel alive.
    if (minion.behaviorType === 'patrol' && minion.aiState === 'idle' && minion.faction === 'dungeon') {
      minion._patrolAccum = (minion._patrolAccum ?? 0) + delta
      if (minion._patrolAccum >= 3000) {
        minion._patrolAccum = 0
        const home = this._gameState.dungeon.rooms.find(r => r.instanceId === minion.assignedRoomId)
        if (home) {
          const rx = home.gridX + Math.floor(Math.random() * home.width)
          const ry = home.gridY + Math.floor(Math.random() * home.height)
          minion.tileX = rx; minion.tileY = ry
          const TS = 32
          minion.worldX = rx * TS + TS / 2
          minion.worldY = ry * TS + TS / 2
        }
      }
    }

    // Phase QW — Sleeping in barracks: idle minions assigned to a
    // starter_barracks regen 0.5 HP/sec when no adventurers are visible.
    // When an adventurer enters their home room they wake up immediately
    // (the targeting block below picks up the threat).
    if (minion.aiState === 'idle' &&
        minion.resources.hp < minion.resources.maxHp &&
        minion.faction === 'dungeon') {
      const home = this._gameState.dungeon.rooms.find(r => r.instanceId === minion.assignedRoomId)
      if (home && home.definitionId === 'starter_barracks') {
        const anyHostileNearby = this._gameState.adventurers.active.some(a =>
          a.aiState !== 'dead' && _pointInRoom(a.tileX, a.tileY, home)
        )
        if (!anyHostileNearby) {
          minion.resources.hp = Math.min(
            minion.resources.maxHp,
            minion.resources.hp + (0.5 * delta) / 1000
          )
        }
      }
    }

    // Phase 10 — hidden mimic: stay completely passive until an adventurer
    // steps on the disguised tile. Once revealed, fall through to normal
    // engagement on the same tick.
    if (minion.isMimic && minion.hiddenAsLoot) {
      const trespasser = this._gameState.adventurers.active.find(
        a => a.tileX === minion.tileX && a.tileY === minion.tileY && a.aiState !== 'dead'
      )
      if (!trespasser) return
      minion.hiddenAsLoot = false
      // Remove the disguising loot item so the renderer stops drawing both
      const dlist = this._gameState.loot?.dungeon ?? []
      const idxLoot = dlist.findIndex(i => i.instanceId === minion.disguisedItemId)
      if (idxLoot !== -1) dlist.splice(idxLoot, 1)
      EventBus.emit('MIMIC_REVEALED', { minion, victim: trespasser })
    }

    // Phase 6e: utility minions perform their non-combat roles instead
    if (minion.behaviorType === 'utility') {
      this._tickUtility(minion, delta)
      return
    }

    // Re-acquire target each tick (cheap; small entity counts in this jam)
    const target = this._pickTarget(minion)

    // Phase QW — Echo minion copies the class of the last adventurer it sees.
    // Stored on `mimickedClassId`; CombatSystem treats this as the attacker's
    // classId for damage-flavor purposes via `_resolveAttackerClass`.
    if (minion.definitionId === 'echo' && target && target.classId) {
      minion.mimickedClassId = target.classId
    }

    if (target) {
      minion.currentTargetId = target.instanceId
      minion.aiState = 'engaging'
      this._engageTarget(minion, target, delta)
      return
    }

    // No target — return home / patrol
    minion.currentTargetId = null
    if (this._atHome(minion)) {
      minion.aiState = 'idle'
      // Patrol = small drift around home (Phase 6b will improve)
    } else {
      minion.aiState = 'returning'
      this._moveToward(minion, { x: minion.homeTileX, y: minion.homeTileY }, delta)
    }
  }

  // ── Utility minion behaviors (Phase 6e) ───────────────────────────────────

  _tickUtility(minion, delta) {
    if (minion.definitionId === 'sapper') {
      this._tickSapper(minion, delta)
    } else if (minion.definitionId === 'herald') {
      this._tickHerald(minion, delta)
    } else if (minion.definitionId === 'cleaner') {
      this._tickCleaner(minion, delta)
    } else if (minion.definitionId === 'scavenger') {
      this._tickScavenger(minion, delta)
    } else if (minion.definitionId === 'whisperer') {
      this._tickWhisperer(minion, delta)
    }
    // Engineer is passive (handled in CombatSystem when traps fire — see _engineerBuffMultiplier)
    // Mourner is event-driven (see _onMinionDied)
  }

  // Phase QW — Cleaner: removes adventurer corpses from gameState.adventurers.graveyard
  // (well, marks them collected). Reduces vulture loot grabs and dispels spectral
  // ghost spawn potential at the start of next day.
  _tickCleaner(cleaner, delta) {
    cleaner._cleanAccum = (cleaner._cleanAccum ?? 0) + delta
    if (cleaner._cleanAccum < 5000) return
    cleaner._cleanAccum = 0

    const room = this._gameState.dungeon.rooms.find(r => r.instanceId === cleaner.assignedRoomId)
    if (!room) return
    const today = this._gameState.meta.dayNumber
    // Find a corpse in this room from today or yesterday
    const corpse = (this._gameState.adventurers.graveyard ?? []).find(g =>
      !g.collected &&
      (today - (g.diedOnDay ?? 0)) <= 2 &&
      g.tileX != null &&
      _pointInRoom(g.tileX, g.tileY, room)
    )
    if (!corpse) return
    corpse.collected = true
    corpse.collectedBy = cleaner.instanceId
    EventBus.emit('CORPSE_COLLECTED', { corpse, by: cleaner })
  }

  // Phase QW — Whisperer: every ~10s, corrupts a random entry in the
  // adventurers' shared knowledge pool (flips `accuracy` low, jitters trap
  // tile coords). Returning adventurers will trust the rumour and walk into
  // walls or the wrong corridor.
  _tickWhisperer(whisperer, delta) {
    whisperer._whisperAccum = (whisperer._whisperAccum ?? 0) + delta
    if (whisperer._whisperAccum < 10000) return
    whisperer._whisperAccum = 0

    const shared = this._gameState.sharedKnowledge
    if (!shared) return

    // Pick a random accurate entry and degrade it
    const buckets = ['rooms', 'traps', 'minions']
    const bucket = buckets[Math.floor(Math.random() * buckets.length)]
    const entries = Object.values(shared[bucket] ?? {})
    if (entries.length === 0) return
    const entry = entries[Math.floor(Math.random() * entries.length)]
    entry.accuracy = Math.min(entry.accuracy ?? 1, 0.3)
    entry.source   = 'whispered_lie'
    if (bucket === 'traps' && entry.tile) {
      entry.tile.x += Math.floor((Math.random() - 0.5) * 4)
      entry.tile.y += Math.floor((Math.random() - 0.5) * 4)
    }
    EventBus.emit('FALSE_RUMOR_PLANTED', { whisperer, bucket, entry })
  }

  // Phase QW — Scavenger: drags unclaimed loot in its room toward the
  // nearest treasure_room, removing it from adventurer reach.
  _tickScavenger(scav, delta) {
    scav._scavAccum = (scav._scavAccum ?? 0) + delta
    if (scav._scavAccum < 4000) return
    scav._scavAccum = 0

    const room = this._gameState.dungeon.rooms.find(r => r.instanceId === scav.assignedRoomId)
    if (!room) return
    const item = (this._gameState.loot?.dungeon ?? []).find(i =>
      i.tileX != null && i.dungeonRoomId === room.instanceId
    )
    if (!item) return

    const treasure = this._gameState.dungeon.rooms.find(r => r.definitionId === 'treasure_room')
    if (!treasure) return
    item.tileX = treasure.gridX + Math.floor(treasure.width / 2)
    item.tileY = treasure.gridY + Math.floor(treasure.height / 2)
    item.dungeonRoomId = treasure.instanceId
    EventBus.emit('LOOT_SCAVENGED', { item, by: scav, toRoomId: treasure.instanceId })
  }

  _tickSapper(sapper, delta) {
    // Repair triggered traps in the same room over time. Each tick increments
    // trap.repairProgress; at >= 1.0 we reset isTriggered.
    const room = sapper.assignedRoomId
    if (!room) return
    const traps = (this._gameState.dungeon.traps ?? [])
      .filter(t => t.isTriggered && this._dungeonGrid.getRoomAtTile(t.tileX, t.tileY)?.instanceId === room)
    if (!traps.length) return

    const repairRate = 0.0004  // ~2.5 seconds per trap at 1× speed
    for (const trap of traps) {
      trap.repairProgress = (trap.repairProgress ?? 0) + repairRate * delta
      if (trap.repairProgress >= 1) {
        trap.isTriggered = false
        trap.repairProgress = 0
        trap.state = {}
        EventBus.emit('TRAP_REPAIRED', { trap, by: sapper })
      }
    }
  }

  _tickHerald(herald, delta) {
    // If any adventurer is in the herald's home room, alert adjacent rooms.
    const room = this._gameState.dungeon.rooms.find(r => r.instanceId === herald.assignedRoomId)
    if (!room) return
    const seesAdv = this._gameState.adventurers.active.some(a =>
      _pointInRoom(a.tileX, a.tileY, room) && a.aiState !== 'dead'
    )
    if (!seesAdv) return
    const expiresAt = (this._scene.time?.now ?? 0) + Balance.HERALD_ALERT_DURATION_MS
    const neighbors = this._dungeonGrid.getNeighborRooms(room.instanceId)
    for (const n of neighbors) {
      const cur = this._alertedRooms.get(n.instanceId) ?? 0
      if (expiresAt > cur) this._alertedRooms.set(n.instanceId, expiresAt)
    }
    EventBus.emit('HERALD_ALERTED', { herald, room })
  }

  // ── Targeting ──────────────────────────────────────────────────────────────

  _pickTarget(minion) {
    const homeRoom = this._gameState.dungeon.rooms.find(r => r.instanceId === minion.assignedRoomId)
    if (!homeRoom) return null

    // Phase 6e: Barracks-style rooms — minions sleep until combat happens here.
    if (this._isRoomSleeping(homeRoom)) return null

    let best = null
    let bestDist = Infinity
    let bestPriority = 0
    const aggro = Balance.AGGRO_RANGE_TILES
    // Phase 6e: minions in alerted rooms (hall of echoes propagation) chase across rooms briefly.
    const isAlerted = this._isRoomAlerted(homeRoom.instanceId)
    // Phase QW — `behaviorType: 'hunt'` minions chase across rooms freely
    // (no same-room restriction). Useful for boss-add adds and aggressive
    // archetype unlocks. Patrol/guard/ambush still respect same-room rule.
    const isHunter = minion.behaviorType === 'hunt'
    const requireSameRoom = Balance.ENGAGE_REQUIRES_SAME_ROOM && !isAlerted && !isHunter

    if (minion.faction === 'adventurer') {
      // Defected minions hunt dungeon-faction minions (and skip adventurers)
      for (const m of this._gameState.minions) {
        if (m === minion || m.aiState === 'dead' || m.resources.hp <= 0) continue
        if (m.faction !== 'dungeon') continue
        const d = Math.hypot(m.tileX - minion.tileX, m.tileY - minion.tileY)
        if (d > aggro) continue
        if (d < bestDist) { best = m; bestDist = d }
      }
      return best
    }

    // Default 'dungeon' faction: attack adventurers, plus any 'adventurer'-faction minions
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead' || adv.resources.hp <= 0) continue
      // Phase 5c — Rogue Invisibility: minions ignore invisible advs.
      // (Boss can still target — that's BossSystem's responsibility.)
      if (adv._invisible) continue

      if (requireSameRoom) {
        if (!_pointInRoom(adv.tileX, adv.tileY, homeRoom)) continue
      }
      // When alerted, extend reach so we can hunt across rooms
      const range = isAlerted ? aggro * 2.5 : aggro
      const d = Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY)
      if (d > range) continue

      // Priority overrides — curse brand > martyr > default
      const priority = _adventurerPriority(adv)
      if (priority > bestPriority || (priority === bestPriority && d < bestDist)) {
        best = adv
        bestDist = d
        bestPriority = priority
      }
    }

    // Also pursue any defector minions in the same room
    for (const m of this._gameState.minions) {
      if (m === minion || m.aiState === 'dead' || m.resources.hp <= 0) continue
      if (m.faction !== 'adventurer') continue
      if (Balance.ENGAGE_REQUIRES_SAME_ROOM &&
          !_pointInRoom(m.tileX, m.tileY, homeRoom)) continue
      const d = Math.hypot(m.tileX - minion.tileX, m.tileY - minion.tileY)
      if (d > aggro) continue
      // Defectors get priority 1 (above default 0, below tauntable martyrs at 2)
      const priority = 1
      if (priority > bestPriority || (priority === bestPriority && d < bestDist)) {
        best = m
        bestDist = d
        bestPriority = priority
      }
    }
    return best
  }

  // ── Engagement ────────────────────────────────────────────────────────────

  _engageTarget(minion, target, delta) {
    const reach = minion.attackRange ?? Balance.MELEE_RANGE_TILES
    const d = Math.hypot(target.tileX - minion.tileX, target.tileY - minion.tileY)

    if (d <= reach + 0.01) {
      // In range — attack
      this._combatSystem.tryAttack(minion, target, {
        roomId: minion.assignedRoomId,
      })
      return
    }
    // Out of range — chase one tile at a time
    this._moveToward(minion, { x: target.tileX, y: target.tileY }, delta)
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  _moveToward(minion, targetTile, delta) {
    const targetWX = targetTile.x * TS + TS / 2
    const targetWY = targetTile.y * TS + TS / 2
    const dx = targetWX - minion.worldX
    const dy = targetWY - minion.worldY
    const dist = Math.hypot(dx, dy)

    const stepPx = (minion.stats.speed * TS * delta) / 1000
    if (stepPx >= dist || dist < 0.5) {
      minion.worldX = targetWX
      minion.worldY = targetWY
    } else {
      minion.worldX += (dx / dist) * stepPx
      minion.worldY += (dy / dist) * stepPx
    }
    // Always sync tile coords from world position so distance + room checks
    // reflect actual location (otherwise tiles only update at waypoints).
    minion.tileX = Math.floor(minion.worldX / TS)
    minion.tileY = Math.floor(minion.worldY / TS)
  }

  _atHome(m) {
    return m.tileX === m.homeTileX && m.tileY === m.homeTileY
  }

  // ── Death / respawn ───────────────────────────────────────────────────────

  _die(minion, idx) {
    minion.aiState = 'dead'
    minion.deathDay = this._gameState.meta.dayNumber
    minion.currentTargetId = null
    EventBus.emit('MINION_DIED', { minion, killerId: null })
    // Phase 6 kernel: minions auto-respawn at next NIGHT_PHASE_STARTED.
    // We KEEP the entity in the array (with hp=0, aiState='dead') so respawn
    // logic in Game.js can revive it without re-allocating.
  }

  // Called from Game.js on NIGHT_PHASE_STARTED.
  // Default: full overnight regeneration; dead minions revive, wounded heal, all return home.
  // Phase 6d: defected minions (faction='adventurer') are removed entirely — temporary tame/raise
  // does not persist past the night. (Bloodbound mechanic in Phase 9 will disable revival.)
  respawnAll() {
    this._gameState.minions = this._gameState.minions.filter(m => m.faction !== 'adventurer')

    // Phase 9: Bloodbound — dead minions are gone forever, no revival
    const flags = this._gameState._mechanicFlags ?? {}
    if (flags.bloodbound) {
      const before = this._gameState.minions.length
      this._gameState.minions = this._gameState.minions.filter(
        m => m.aiState !== 'dead' && m.resources.hp > 0
      )
      const lost = before - this._gameState.minions.length
      if (lost > 0) EventBus.emit('BLOODBOUND_LOSSES', { count: lost })
    }

    for (const m of this._gameState.minions) {
      // Phase 7b: track times-killed-and-respawned for vengeful_wraith evolution
      if (m.aiState === 'dead' || m.resources.hp <= 0) {
        m.timesKilledAndRespawned = (m.timesKilledAndRespawned ?? 0) + 1
        EventBus.emit('MINION_RESPAWNED', { minion: m, count: m.timesKilledAndRespawned })
      }
      m.resources.hp = m.resources.maxHp
      m.tileX  = m.homeTileX
      m.tileY  = m.homeTileY
      m.worldX = m.homeTileX * TS + TS / 2
      m.worldY = m.homeTileY * TS + TS / 2
      m.aiState = 'idle'
      m.currentTargetId = null
      m.deathDay = null
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function _pointInRoom(tx, ty, room) {
  return tx >= room.gridX && tx < room.gridX + room.width &&
         ty >= room.gridY && ty < room.gridY + room.height
}

// Targeting priority overrides (higher wins):
//   - Curse-branded adventurer (curse_brand_trap mark)        → priority 3
//   - Martyr at low HP (taunting)                             → priority 2
//   - Default                                                  → priority 0
function _adventurerPriority(adv) {
  // Phase 5c — Knight Taunt: highest priority while taunt buff is active.
  // ClassAbilitySystem stamps `_tauntActiveUntil` (game-time ms) on the
  // Knight when Taunt fires. We don't have direct scene-time access here,
  // so we accept "any non-zero future timestamp" as active and rely on
  // ClassAbilitySystem._tickActiveBuffs to clear it on expiry.
  if (adv._tauntActiveUntil && adv._tauntActiveUntil > 0) return 4
  if (adv.flags?.cursedBrand) return 3
  if (adv.personalityIds?.includes('martyr')) {
    const frac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
    if (frac <= Balance.MARTYR_TAUNT_HP_FRACTION) return 2
  }
  return 0
}

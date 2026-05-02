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
// Local alias so _tickMimic can reach Balance constants without piping
// the whole module name through every reference. Same module — just shorter.
const _Balance = Balance

// Mimic state-machine timings (ms). Match Preload's anim FPS × frame counts:
//   reveal        15 frames @  8 fps ≈ 1875 ms
//   turn_into_chest 10 frames @ 8 fps ≈ 1250 ms
//   death         13 frames @  8 fps ≈ 1625 ms
//   attack1       12 frames @ 12 fps ≈ 1000 ms
//   attack2       10 frames @ 12 fps ≈  833 ms
//   hurt           7 frames @ 12 fps ≈  583 ms
const MIMIC_REVEAL_ANIM_MS    = 1900
const MIMIC_REDISGUISE_ANIM_MS = 1300
const MIMIC_DEATH_ANIM_MS     = 1700
const MIMIC_ATTACK1_MS        = 1000
const MIMIC_ATTACK2_MS        =  900
const MIMIC_HURT_MS           =  600
// Game-feel knobs for the disguise lifecycle.
const MIMIC_NEARBY_RADIUS     = 4    // tiles — adv within this resets re-disguise timer
const MIMIC_REDISGUISE_MS     = 5000 // 5s of no nearby adv → turn_into_chest
const MIMIC_DEATH_LINGER_MS   = 2000 // last frame holds 2s after death anim ends

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

  // Combat in a barracks wakes everyone there.
  // [Removed 2026-04-30] Hall of Echoes cross-room alert — room retired.
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

    // Mimic hurt reaction — when a mimic takes damage in an attackable
    // state (idle/walking/attacking), play hurt anim + reset re-disguise
    // timer. Skip if already dead or in a one-shot state.
    if (target?.isMimic) {
      const skip = ['dying', 'chest', 'revealing', 'redisguising', 'hurt']
      if (!skip.includes(target.mimicState)) {
        const now = this._scene.time?.now ?? 0
        target.mimicState        = 'hurt'
        target.mimicStateUntil   = now + MIMIC_HURT_MS
        target._mimicHurtFlashAt = now
        target.mimicLastAdvNearbyAt = now
      }
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

  // Room redesign 2026-04-30 — true if `roomId` shares a door with any
  // active Sanctum room. Used to extend the barracks-style HP regen
  // aura to door-connected neighbors.
  _isAdjacentToSanctum(roomId) {
    const neighbors = this._dungeonGrid.getNeighborRooms(roomId) ?? []
    return neighbors.some(n =>
      n.definitionId === 'sanctum' && n.isActive !== false
    )
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

    // Player is dragging this minion to a new tile — suspend AI until drop.
    if (minion._heldByPlayer) return

    // Mimic state machine — owns its own lifecycle (chest disguise →
    // reveal on adv interaction → idle/walk/attack → re-disguise after
    // 5s of no nearby adv → chest). Bypasses the standard tick.
    if (minion.isMimic) {
      this._tickMimic(minion, delta, idx)
      return
    }

    if (minion.resources.hp <= 0) {
      this._die(minion, idx)
      return
    }

    // Idle wander: any non-utility dungeon minion explores its assigned room
    // when no hostiles are in sight. Picks a random tile in the home room,
    // walks there via `_moveToward`, then idles ~3s before picking a new
    // target. Originally gated on `behaviorType === 'patrol'`; opened up to
    // guards too so the dungeon feels alive everywhere.
    if (minion.behaviorType !== 'utility' && minion.aiState === 'idle' && minion.faction === 'dungeon') {
      if (minion._patrolTarget) {
        if (minion.tileX === minion._patrolTarget.x && minion.tileY === minion._patrolTarget.y) {
          minion._patrolTarget = null
          minion._patrolAccum  = 0
        } else {
          this._moveToward(minion, minion._patrolTarget, delta)
        }
      } else {
        minion._patrolAccum = (minion._patrolAccum ?? 0) + delta
        if (minion._patrolAccum >= 3000) {
          minion._patrolAccum = 0
          const home = this._gameState.dungeon.rooms.find(r => r.instanceId === minion.assignedRoomId)
          if (home) {
            const rx = home.gridX + Math.floor(Math.random() * home.width)
            const ry = home.gridY + Math.floor(Math.random() * home.height)
            minion._patrolTarget = { x: rx, y: ry }
          }
        }
      }
    }

    // Phase QW — Sleeping in barracks: idle minions assigned to a
    // starter_barracks regen 0.5 HP/sec when no adventurers are visible.
    // When an adventurer enters their home room they wake up immediately
    // (the targeting block below picks up the threat).
    //
    // Room redesign 2026-04-30 — Sanctum aura: same regen applies to
    // minions whose home room is directly door-connected to a Sanctum.
    if (minion.aiState === 'idle' &&
        minion.resources.hp < minion.resources.maxHp &&
        minion.faction === 'dungeon') {
      const home = this._gameState.dungeon.rooms.find(r => r.instanceId === minion.assignedRoomId)
      if (home) {
        const isBarracks = home.definitionId === 'starter_barracks'
        const isSanctumAura = !isBarracks && this._isAdjacentToSanctum(home.instanceId)
        if (isBarracks || isSanctumAura) {
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

    // No target — summons trail their summoner; everyone else returns home / patrols.
    minion.currentTargetId = null
    if (minion.raisedByAdvId) {
      const summoner = this._gameState.adventurers.active.find(
        a => a.instanceId === minion.raisedByAdvId && a.aiState !== 'dead'
      )
      if (summoner) {
        const dist = Math.hypot(summoner.tileX - minion.tileX, summoner.tileY - minion.tileY)
        if (dist > 1.4) {
          minion.aiState = 'following'
          // Pathfind to the summoner so we don't clip through walls between
          // rooms. _walkAlongPath caches and reuses paths.
          this._walkAlongPath(minion, { x: summoner.tileX, y: summoner.tileY }, delta)
        } else {
          minion.aiState = 'idle'
        }
        return
      }
      // Summoner gone (fled/died) — fall through to home behavior.
    }
    if (this._atHome(minion)) {
      minion.aiState = 'idle'
      // Patrol = small drift around home (Phase 6b will improve)
    } else {
      minion.aiState = 'returning'
      // Pathfind back home rather than straight-lining through walls.
      this._walkAlongPath(minion, { x: minion.homeTileX, y: minion.homeTileY }, delta)
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
  // nearest Treasury, removing it from adventurer reach.
  // [Updated 2026-04-30] Repointed treasure_room → treasury after the
  // Room redesign.
  _tickScavenger(scav, delta) {
    scav._scavAccum = (scav._scavAccum ?? 0) + delta
    if (scav._scavAccum < 4000) return
    scav._scavAccum = 0

    const room = this._gameState.dungeon.rooms.find(r => r.instanceId === scav.assignedRoomId)
    if (!room) return
    const item = (this._gameState.loot?.dungeon ?? []).find(i =>
      i.tileX != null &&
      i.dungeonRoomId === room.instanceId &&
      !i._treasuryChest   // never drag chests — they belong to their Treasury
    )
    if (!item) return

    const treasury = this._gameState.dungeon.rooms.find(r => r.definitionId === 'treasury')
    if (!treasury) return
    item.tileX = treasury.gridX + Math.floor(treasury.width / 2)
    item.tileY = treasury.gridY + Math.floor(treasury.height / 2)
    item.dungeonRoomId = treasury.instanceId
    EventBus.emit('LOOT_SCAVENGED', { item, by: scav, toRoomId: treasury.instanceId })
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
    // Room redesign 2026-04-30 — garrison minions (Crypt et al.) are
    // strictly room-bound: alerts and hunt-behavior overrides do not apply.
    const isGarrison = minion.class === 'garrison'
    const requireSameRoom = isGarrison ||
      (Balance.ENGAGE_REQUIRES_SAME_ROOM && !isAlerted && !isHunter)

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
      if ((isGarrison || Balance.ENGAGE_REQUIRES_SAME_ROOM) &&
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
    // Out of range — chase along an A* path so the minion follows
    // walkable tiles (through doorways) instead of straight-lining
    // through walls. The previous straight-line _moveToward made
    // cross-room engagements look like teleports.
    this._walkAlongPath(minion, { x: target.tileX, y: target.tileY }, delta)
  }

  // Generalised pathfinding walker. One step per call toward `targetTile`,
  // following an A* path that's cached on the minion (`_chasePath` for
  // legacy reasons) and refreshed when the target changes or every ~600ms.
  // Used for: chasing combat targets, following the summoner (raised
  // necromancer minions), and returning to the home tile. Replaces the
  // straight-line `_moveToward(target)` so minions don't clip through
  // walls between rooms.
  _walkAlongPath(minion, targetTile, delta) {
    const cache = minion._chasePath
    const sameTarget = cache &&
      cache.targetX === targetTile.x &&
      cache.targetY === targetTile.y &&
      cache.path && cache.path.length > 0
    let path = sameTarget ? cache.path : null

    // Recompute when stale (no path, target changed, or every ~600ms).
    const now = this._scene.time?.now ?? 0
    const stale = !path || (cache && now - cache.computedAt > 600)
    if (stale) {
      // Mimic chests block any minion's path the same way they block
      // adventurers — disguised mimics aren't walkable terrain.
      const blockedTiles = this._buildChestBlockSet(minion)
      const fresh = PathfinderSystem.findPath(
        { x: minion.tileX, y: minion.tileY },
        targetTile,
        this._dungeonGrid,
        null, 0, blockedTiles,
      )
      if (fresh && fresh.length > 0) {
        path = fresh
        minion._chasePath = { targetX: targetTile.x, targetY: targetTile.y, path, computedAt: now }
      } else {
        // No path exists (target unreachable or in a sealed room) — stand
        // still rather than straight-line through walls.
        minion._chasePath = null
        return
      }
    }

    // Walk toward the next waypoint; advance when reached.
    const next = path[0]
    this._moveToward(minion, next, delta)
    if (minion.tileX === next.x && minion.tileY === next.y) {
      path.shift()
      if (path.length === 0) minion._chasePath = null
    }
  }

  // Tiles occupied by ANY alive mimic (any mimicState). Both the
  // pathfinder (planning) and per-frame _moveToward (committing) consult
  // this so non-mimic minions can't clip through disguised OR revealed
  // mimics. `selfMinion` is excluded so a mimic doesn't block its own
  // tick. Adventurers use AISystem's mirror of this set.
  _buildChestBlockSet(selfMinion) {
    const set = new Set()
    for (const m of this._gameState.minions ?? []) {
      if (!m.isMimic) continue
      if (m === selfMinion) continue
      if (m.aiState === 'dead') continue
      set.add(`${m.tileX},${m.tileY}`)
    }
    return set
  }

  _isChestMimicAt(tx, ty, selfMinion) {
    for (const m of this._gameState.minions ?? []) {
      if (!m.isMimic) continue
      if (m === selfMinion) continue
      if (m.aiState === 'dead') continue
      if (m.tileX !== tx || m.tileY !== ty) continue
      return true
    }
    return false
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  _moveToward(minion, targetTile, delta) {
    // Mimic-chest block — patrol movement uses straight-line _moveToward
    // without the pathfinder, so a chest mimic in the same room would
    // otherwise be walked through. Refuse to commit a step into a
    // chest tile (and clear any cached chase path so the mimic gets
    // routed around on the next replan).
    if (this._isChestMimicAt(targetTile.x, targetTile.y, minion)) {
      minion._chasePath = null
      minion._patrolTarget = null
      return
    }
    // Lane-centred world target — see DungeonGrid.getLaneCenterWorld.
    // Canonical doorway lane tiles + their floor approach/exit tiles
    // shift ½-tile so minions and summons walk through the geometric
    // centre of the 2-wide doorway opening.  Falls back to the regular
    // tile centre for everything else.
    const lc = this._dungeonGrid?.getLaneCenterWorld?.(targetTile.x, targetTile.y)
    const targetWX = lc ? lc.worldX : (targetTile.x * TS + TS / 2)
    const targetWY = lc ? lc.worldY : (targetTile.y * TS + TS / 2)
    const dx = targetWX - minion.worldX
    const dy = targetWY - minion.worldY
    const dist = Math.hypot(dx, dy)

    const stepPx = (minion.stats.speed * TS * delta) / 1000
    if (stepPx >= dist || dist < 0.5) {
      minion.worldX = targetWX
      minion.worldY = targetWY
    } else {
      // Doorway-corridor L-shape motion (mirrors AISystem) — see
      // DungeonGrid.isLaneOrApproach.  Inside the corridor: pure
      // forward only.  Entering: lateral first.  Exiting: forward
      // first.  Outside: regular diagonal proportional motion.
      const advLane = this._dungeonGrid?.isLaneOrApproach?.(minion.tileX, minion.tileY)
      const wpLane  = this._dungeonGrid?.isLaneOrApproach?.(targetTile.x, targetTile.y)
      const laneAxis = advLane || wpLane
      const ALIGN_EPS = 0.5
      let moved = false
      if (laneAxis === 'y' || laneAxis === 'x') {
        const forwardD = laneAxis === 'y' ? dy : dx
        const lateralD = laneAxis === 'y' ? dx : dy
        const forwardKey = laneAxis === 'y' ? 'worldY' : 'worldX'
        const lateralKey = laneAxis === 'y' ? 'worldX' : 'worldY'
        const inside    = !!advLane && !!wpLane
        const entering  = !advLane && !!wpLane
        const exiting   = !!advLane && !wpLane
        const moveAxis = (key, d) => {
          minion[key] += Math.sign(d) * Math.min(Math.abs(d), stepPx)
          moved = true
        }
        if (inside) {
          if (Math.abs(forwardD) > ALIGN_EPS) moveAxis(forwardKey, forwardD)
        } else if (entering) {
          if (Math.abs(lateralD) > ALIGN_EPS)      moveAxis(lateralKey, lateralD)
          else if (Math.abs(forwardD) > ALIGN_EPS) moveAxis(forwardKey, forwardD)
        } else if (exiting) {
          if (Math.abs(forwardD) > ALIGN_EPS)      moveAxis(forwardKey, forwardD)
          else if (Math.abs(lateralD) > ALIGN_EPS) moveAxis(lateralKey, lateralD)
        }
      }
      if (!moved) {
        minion.worldX += (dx / dist) * stepPx
        minion.worldY += (dy / dist) * stepPx
      }
    }
    // Always sync tile coords from world position so distance + room checks
    // reflect actual location.  Doorway-seam guard: when worldX/Y sits on
    // the seam between the canonical and secondary doorway tiles (because
    // lane centring shifted the target ½-tile), floor() can briefly
    // resolve to the secondary (pathfinder-blocked) tile.  When that
    // happens, snap tileX/tileY to the explicit target tile instead so
    // path computation never starts from a blocked tile.
    const ntx = Math.floor(minion.worldX / TS)
    const nty = Math.floor(minion.worldY / TS)
    if (this._dungeonGrid?.isDoorBlocked?.(ntx, nty)) {
      minion.tileX = targetTile.x
      minion.tileY = targetTile.y
    } else {
      minion.tileX = ntx
      minion.tileY = nty
    }
  }

  _atHome(m) {
    return m.tileX === m.homeTileX && m.tileY === m.homeTileY
  }

  // ── Mimic state machine ──────────────────────────────────────────────────
  //
  // States and transitions (driven entirely from this method):
  //   chest         (default; static; targetable as loot)
  //     → revealing on adv "open"  (set externally by AISystem chest pickup)
  //   revealing     (one-shot; invulnerable; locks position)
  //     → idle when reveal anim ends (mimicStateUntil reached)
  //   idle / walking  (active combat; pick target, chase, attack)
  //     → attacking when target in range
  //     → hurt on damage hook (mimicStateUntil set by CombatSystem)
  //     → redisguising after MIMIC_REDISGUISE_MS without nearby adv
  //   attacking     (one-shot; back to idle when anim ends)
  //   hurt          (one-shot; back to idle when anim ends)
  //   redisguising  (one-shot turn_into_chest; back to chest when anim ends;
  //                  spawns a fresh disguise loot entry so advs can re-target)
  //   dying         (one-shot Death; lingers MIMIC_DEATH_LINGER_MS, then
  //                  splices via _die)
  _tickMimic(minion, delta, idx) {
    const now = this._scene.time?.now ?? 0
    minion.mimicState        ??= 'chest'
    minion.mimicFacing       ??= 'right'
    minion.mimicLastAdvNearbyAt ??= now

    // Death takes priority over everything except the linger timer.
    if (minion.aiState === 'dead' || (minion.resources?.hp ?? 0) <= 0) {
      if (minion.mimicState !== 'dying') {
        minion.mimicState = 'dying'
        minion.mimicStateUntil    = now + MIMIC_DEATH_ANIM_MS
        minion.mimicDeathFadeAt   = now + MIMIC_DEATH_ANIM_MS
        minion.mimicDespawnAt     = now + MIMIC_DEATH_ANIM_MS + MIMIC_DEATH_LINGER_MS
      }
      if (now >= (minion.mimicDespawnAt ?? Infinity)) {
        this._die(minion, idx)
      }
      return
    }

    // One-shot animation timeouts — flip back to a default state when
    // the registered anim duration elapses.
    if (minion.mimicStateUntil && now >= minion.mimicStateUntil) {
      minion.mimicStateUntil = 0
      switch (minion.mimicState) {
        case 'revealing':
          // First reveal — face the most recent adventurer if we know who
          // triggered us, else default to right.
          minion.mimicState = 'idle'
          minion.aiState    = 'idle'
          this._faceTowardNearestAdv(minion)
          EventBus.emit('MIMIC_REVEAL_DONE', { minion })
          break
        case 'attacking':
          minion.mimicState = 'idle'
          minion.aiState    = 'idle'
          break
        case 'hurt':
          minion.mimicState = 'idle'
          minion.aiState    = 'idle'
          break
        case 'redisguising':
          this._mimicReturnToChest(minion)
          EventBus.emit('MIMIC_REDISGUISED', { minion })
          break
      }
    }

    // While disguised, revealing, or re-disguising, mimic does no AI.
    if (minion.mimicState === 'chest'         ||
        minion.mimicState === 'revealing'     ||
        minion.mimicState === 'redisguising') {
      return
    }

    // Active states from here on.
    // Re-disguise timer: count time since last adventurer was within
    // MIMIC_NEARBY_RADIUS tiles. When the gap exceeds MIMIC_REDISGUISE_MS,
    // play the turn_into_chest animation. The timer resets whenever a
    // nearby adv is observed (below).
    const nearestAdv = this._findNearestAdvForMimic(minion)
    if (nearestAdv.distance <= MIMIC_NEARBY_RADIUS) {
      minion.mimicLastAdvNearbyAt = now
    }
    const timeSinceNearby = now - (minion.mimicLastAdvNearbyAt ?? now)
    if (timeSinceNearby >= MIMIC_REDISGUISE_MS &&
        minion.mimicState !== 'attacking' && minion.mimicState !== 'hurt') {
      minion.mimicState      = 'redisguising'
      minion.aiState         = 'idle'
      minion.path            = null
      minion.mimicStateUntil = now + MIMIC_REDISGUISE_ANIM_MS
      EventBus.emit('MIMIC_REDISGUISING', { minion })
      return
    }

    // Hurt animation locks behavior — just wait for it to end (timer above
    // flips back to idle).
    if (minion.mimicState === 'hurt') return

    // Pick / track target. If no adv in same room, idle around home.
    const target = nearestAdv.adv
    if (!target) {
      // Drift to idle if we have no target. Don't redisguise mid-anim.
      if (minion.mimicState !== 'attacking') {
        minion.mimicState = 'idle'
        minion.aiState    = 'idle'
      }
      return
    }

    // Compute melee/ranged distance & pick attack variant.
    const dist = Math.hypot(target.tileX - minion.tileX, target.tileY - minion.tileY)
    const reach = Math.max(minion.attackRange ?? 1, _Balance.MELEE_RANGE_TILES ?? 1.5)
    // Update facing whenever we have a target.
    minion.mimicFacing = target.tileX < minion.tileX ? 'left' : 'right'

    // In attack range — swing.
    if (dist <= reach + 0.01) {
      // If we're already in an attack anim, let it finish.
      if (minion.mimicState === 'attacking') return
      // Pick variant by distance (>=2 tiles → ranged, else melee)
      minion.mimicAttackVariant = dist >= 2 ? 'attack1' : 'attack2'
      minion.mimicState         = 'attacking'
      minion.aiState            = 'engaging'
      minion.path               = null
      const animMs = minion.mimicAttackVariant === 'attack1'
        ? MIMIC_ATTACK1_MS
        : MIMIC_ATTACK2_MS
      minion.mimicStateUntil    = now + animMs
      this._combatSystem?.tryAttack(minion, target, { roomId: minion.assignedRoomId })
      return
    }

    // Out of range — chase via straight-line move toward target tile.
    if (minion.mimicState === 'attacking') return  // wait for swing to end
    minion.mimicState = 'walking'
    minion.aiState    = 'engaging'
    this._moveToward(minion, { x: target.tileX, y: target.tileY }, delta)
  }

  // Spawn a fresh disguise loot item at the mimic's tile so adventurers
  // can target it again, and snap mimic back to chest state.
  _mimicReturnToChest(minion) {
    minion.mimicState   = 'chest'
    minion.aiState      = 'idle'
    minion.path         = null
    minion.mimicStateUntil = 0
    minion.mimicLastAdvNearbyAt = this._scene.time?.now ?? 0
    minion.tileX = minion.homeTileX
    minion.tileY = minion.homeTileY
    const TS = 32
    minion.worldX = minion.tileX * TS + TS / 2
    minion.worldY = minion.tileY * TS + TS / 2
    // Re-spawn the disguising loot (RoomBehaviorSystem clears it on reveal)
    this._gameState.loot ??= { dungeon: [] }
    this._gameState.loot.dungeon ??= []
    const exists = this._gameState.loot.dungeon.some(i => i._mimicMinionId === minion.instanceId)
    if (!exists) {
      this._gameState.loot.dungeon.push({
        instanceId: `mvchest_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        definitionId: 'treasury_chest',
        _treasuryChest: true,
        _isMimicVaultDisguise: true,
        _mimicMinionId: minion.instanceId,
        _essenceValue: 0,
        _sourceTreasuryId: minion.assignedRoomId,
        tileX: minion.tileX, tileY: minion.tileY,
        worldX: minion.worldX, worldY: minion.worldY,
        dungeonRoomId: minion.assignedRoomId,
        isMimicSpawn: true,
        provenance: [], statModifiers: [], curseLevel: 0, currentEquippedBy: null,
      })
    }
  }

  _findNearestAdvForMimic(minion) {
    let best = null
    let bestDist = Infinity
    const home = this._gameState.dungeon.rooms.find(r => r.instanceId === minion.assignedRoomId)
    for (const a of this._gameState.adventurers.active) {
      if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      // Same room only — mimic is room-bound (garrison).
      if (home && !_pointInRoom(a.tileX, a.tileY, home)) continue
      const d = Math.hypot(a.tileX - minion.tileX, a.tileY - minion.tileY)
      if (d < bestDist) { best = a; bestDist = d }
    }
    return { adv: best, distance: bestDist }
  }

  _faceTowardNearestAdv(minion) {
    const { adv } = this._findNearestAdvForMimic(minion)
    if (adv) minion.mimicFacing = adv.tileX < minion.tileX ? 'left' : 'right'
  }

  // ── Death / respawn ───────────────────────────────────────────────────────

  _die(minion, idx) {
    minion.aiState = 'dead'
    minion.deathDay = this._gameState.meta.dayNumber
    minion.currentTargetId = null
    // Mimic cleanup — yank any disguise loot pointing at this mimic so a
    // wandering adventurer doesn't open a "ghost" chest.
    if (minion.isMimic && this._gameState.loot?.dungeon) {
      this._gameState.loot.dungeon = this._gameState.loot.dungeon.filter(
        i => i._mimicMinionId !== minion.instanceId
      )
    }
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
    // Phase 9: Undying Horde — undead minions that die again are gone permanently
    this._gameState.minions = this._gameState.minions.filter(
      m => !(m.isUndead && m.aiState === 'dead')
    )

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

      // Mimic-specific reset: re-disguise as chest and re-spawn the
      // paired disguise loot (which gets stripped in _die so revealed
      // mimics can't be re-targeted mid-day). Without this, after a
      // mimic respawns adventurers see a chest sprite but SEEK_LOOT has
      // nothing to target.
      if (m.isMimic) {
        m.mimicState           = 'chest'
        m.mimicFacing          = m.mimicFacing ?? 'right'
        m.mimicStateUntil      = 0
        m.mimicDeathFadeAt     = null
        m.mimicDespawnAt       = null
        m.mimicLastAdvNearbyAt = 0
        m._mimicHurtFlashAt    = 0
        // Avoid duplicate disguises if one somehow survived.
        const existingDisguise = (this._gameState.loot?.dungeon ?? []).find(
          i => i._mimicMinionId === m.instanceId
        )
        if (!existingDisguise) {
          this._gameState.loot ??= { dungeon: [] }
          this._gameState.loot.dungeon ??= []
          this._gameState.loot.dungeon.push({
            instanceId: `mvchest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_resp`,
            definitionId: 'treasury_chest',
            _treasuryChest: true,
            _isMimicVaultDisguise: true,
            _mimicMinionId: m.instanceId,
            _essenceValue: 0,
            _sourceTreasuryId: m.assignedRoomId ?? null,
            tileX: m.tileX, tileY: m.tileY,
            worldX: m.worldX, worldY: m.worldY,
            dungeonRoomId: m.assignedRoomId ?? null,
            isMimicSpawn: true,
            provenance: [], statModifiers: [], curseLevel: 0, currentEquippedBy: null,
          })
        }
      }
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

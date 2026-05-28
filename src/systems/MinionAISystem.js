// Per-tick minion AI.
// Phase 6 kernel:
//   - guard:  hold home tile; engage adventurer in same room within aggro range
//   - patrol: wander home room idly; engage on contact
//   - utility (sapper, herald): no combat behaviour yet (Phase 6b)
// Engagement: chase target until in attackRange, then call CombatSystem.tryAttack.
// Minions return to home tile when target leaves their assigned room.

import { EventBus }         from './EventBus.js'
import { PathfinderSystem } from './PathfinderSystem.js'
import { MinionAbilities }  from './MinionAbilities.js'
import { Balance }          from '../config/balance.js'
import { TILE }             from './DungeonGrid.js'
import { applyMinionScaling } from '../entities/Minion.js'
import { AbilityVfx }       from '../ui/AbilityVfx.js'

const TS = Balance.TILE_SIZE

// Defs that never move — they hold their home tile until aggro'd, never
// wander. Single source of truth used by both the wander block (skip
// patrol target picking) and _pickTarget (exempt from flee-chase
// follow-through; a stationary def can't physically pursue across rooms).
// Listed minions' tooltip BEHAVIOR text honestly says "never moves" /
// "rooted" / "haunts a tile" — don't add a def here without matching its
// player-facing description.
const STATIONARY_DEF_IDS = new Set([
  'plant1',
  'mushroom1',
  'mushroom2',
  'lizardman1',
  'ghost1',
])

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

    // Pass-3: wire global behavior listeners (e.g. Mimic Migrate on
    // NIGHT_PHASE_STARTED). Idempotent — re-attaching is a no-op.
    MinionAbilities.attach(scene, gameState, dungeonGrid)
  }

  destroy() {
    EventBus.off('COMBAT_HIT', this._onCombatHit, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._resetRoomState, this)
    EventBus.off('MINION_DIED', this._onMinionDied, this)
    MinionAbilities.detach()
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
    if (!source && !target) return

    // Retaliation tracking — if a minion was the target, stamp who hit it so
    // _pickTarget can override its same-room / aggro-range filters and
    // engage that adv specifically. Without this, a minion attacked from
    // outside its home room (ranged adv across a doorway, melee adv at a
    // room boundary) never retaliates because _pickTarget rejects every
    // adv outside the home room.
    if (target && target.faction === 'dungeon' && source) {
      target._lastHitBy = sourceId
      target._lastHitAt = this._scene.time?.now ?? 0
    }

    // Wake barracks-style rooms on first combat. Check BOTH the attacker's
    // and the target's room so a sleepy barracks-minion still wakes when
    // hit from outside the barracks (e.g. by a ranged adv shooting in).
    for (const t of [source, target]) {
      if (!t) continue
      const room = this._dungeonGrid.getRoomAtTile(t.tileX, t.tileY)
      if (!room) continue
      if (room.definitionId === 'starter_barracks' || room.definitionId === 'barracks') {
        this._wokenRooms.add(room.instanceId)
      }
    }
  }

  _isRoomSleeping(room) {
    // Phase 6e: starter_barracks sleeps until either (a) combat fires in
    // the room (handled by _onCombatHit) OR (b) a live, non-invisible
    // adventurer is currently INSIDE the room. The latter is the
    // intended "wake on intrusion" behavior — minions shouldn't let an
    // adv stroll past them in their own quarters and only react once
    // they've been hit. Invisible (Rogue) advs still slip through
    // undetected, matching the boss-targeting rule.
    const sleepy = room.definitionId === 'starter_barracks' || room.definitionId === 'barracks'
    if (!sleepy) return false
    if (this._wokenRooms.has(room.instanceId)) return false
    const advs = this._gameState?.adventurers?.active ?? []
    for (const a of advs) {
      if (!a || a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      if (a._invisible) continue
      if (a.tileX >= room.gridX && a.tileX < room.gridX + room.width &&
          a.tileY >= room.gridY && a.tileY < room.gridY + room.height) {
        // Latch awake so subsequent ticks don't re-scan, and so the room
        // stays alert for the rest of the day even if the adv leaves.
        this._wokenRooms.add(room.instanceId)
        return false
      }
    }
    return true
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
    // Per-tick spatial cache: roomId → alive-adv[]. Lets _pickTarget skip
    // iterating every adv on the map when `requireSameRoom` is true (the
    // common case — most minions only engage in their home room). Built
    // once here so all N minions amortize one O(advs) sweep instead of
    // each doing their own.
    this._tickAdvsByRoom = new Map()
    for (const a of (this._gameState.adventurers?.active ?? [])) {
      if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      const r = this._dungeonGrid?.getRoomAtTile?.(a.tileX, a.tileY)
      if (!r) continue
      const arr = this._tickAdvsByRoom.get(r.instanceId)
      if (arr) arr.push(a)
      else this._tickAdvsByRoom.set(r.instanceId, [a])
    }
    for (let i = 0; i < minions.length; i++) {
      this._tickMinion(minions[i], delta, i)
    }
    this._tickAdvsByRoom = null
    // Phase 1b — patrolling minions close (and re-lock) doors behind them.
    // Generic — applies to every patrolling minion regardless of archetype
    // (Vampire Thralls, Demon Imps, Wraith Haunt Ghosts).
    this._tickPatrollerDoors()
    // Phase: items — Soul-Bound Beacon: +30% damage / +30% maxHp to every
    // minion in the same room, scaling +5% per boss level above 1. Stats
    // are reverted when the minion leaves the room.
    this._tickBeaconBuffs()
  }

  _tickBeaconBuffs() {
    const beacons = this._gameState.dungeon?.beacons ?? []
    if (beacons.length === 0) {
      // Fast path: no beacons → strip any leftover buffs.
      for (const m of this._gameState.minions ?? []) {
        if (m._beaconBuffed) this._stripBeaconBuff(m)
      }
      return
    }
    const bossLevel = this._gameState.boss?.level ?? 1
    const bonus     = 0.30 + Math.max(0, bossLevel - 1) * 0.05
    const beaconRoomIds = new Set(beacons.map(b => b.roomId))
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead') continue
      const room = this._dungeonGrid.getRoomAtTile?.(m.tileX, m.tileY)
      const inBeaconRoom = !!(room && beaconRoomIds.has(room.instanceId))
      if (inBeaconRoom && !m._beaconBuffed) {
        m._beaconBuffMul = 1 + bonus
        m._beaconHpAdd   = Math.round((m.resources?.maxHp ?? 0) * bonus)
        m.resources.maxHp += m._beaconHpAdd
        m.resources.hp     = Math.min(m.resources.maxHp, m.resources.hp + m._beaconHpAdd)
        m._beaconBuffed = true
      } else if (!inBeaconRoom && m._beaconBuffed) {
        this._stripBeaconBuff(m)
      }
    }
  }

  _stripBeaconBuff(m) {
    if (m._beaconHpAdd) {
      m.resources.maxHp = Math.max(1, m.resources.maxHp - m._beaconHpAdd)
      m.resources.hp    = Math.min(m.resources.maxHp, m.resources.hp)
    }
    m._beaconBuffed = false
    m._beaconBuffMul = null
    m._beaconHpAdd = null
  }

  _isPatrollerMinion(m) {
    return !!(m && (m._isVampireThrall || m._isDemonImp || m._isHauntGhost))
  }

  _tickPatrollerDoors() {
    const grid = this._dungeonGrid
    if (!grid?.getCpForDoorTile) return
    const renderer = this._scene?._dungeonRenderer
    const minions = this._gameState?.minions ?? []
    for (const m of minions) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (!this._isPatrollerMinion(m)) {
        // Drop tracking state on non-patrollers (e.g. minion lost its tag).
        m._doorPatLastCp = null
        continue
      }

      const onCpEntry = grid.getCpForDoorTile(m.tileX, m.tileY)
      const onCp = onCpEntry?.cp ?? null

      if (onCp) {
        // On a door tile this frame. If it's a NEW door (different cp than
        // the one we were tracking), record cp + its current lock state and
        // make sure the door is visibly open (matches the adventurer
        // behavior of opening on approach).
        if (m._doorPatLastCp !== onCp) {
          m._doorPatLastCp        = onCp
          m._doorPatLockedSnapshot = !!onCp.locked
          if (renderer?.openDoor) renderer.openDoor(onCp)
        }
      } else if (m._doorPatLastCp) {
        // Just stepped off a door tile — close it (paired side too via
        // closeDoor's mirror logic) and re-lock if the snapshot says so.
        // Defer the close if an adventurer (or another patroller) is
        // currently standing on the same doorway. Slamming the door on a
        // mid-traversal walker leaves them in inconsistent waypoint state
        // and was the source of a crash when imps and advs crossed at the
        // same doorway.
        const cp = m._doorPatLastCp
        if (this._anyoneOnCp(cp, m)) {
          // Hold the close — keep _doorPatLastCp so we retry next tick.
          continue
        }
        const wasLocked = !!m._doorPatLockedSnapshot
        renderer?.closeDoor?.(cp)
        if (wasLocked) cp.locked = true
        m._doorPatLastCp        = null
        m._doorPatLockedSnapshot = false
      }
    }
  }

  // True if any live adventurer or any other patroller minion is currently
  // standing on a tile that belongs to `cp`'s doorway. Used to defer door
  // slams when traffic is in the way.
  _anyoneOnCp(cp, exceptMinion) {
    if (!cp) return false
    const grid = this._dungeonGrid
    if (!grid?.getCpForDoorTile) return false
    const advs = this._gameState?.adventurers?.active ?? []
    for (const a of advs) {
      if (!a || a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      const e = grid.getCpForDoorTile(a.tileX, a.tileY)
      if (e?.cp === cp) return true
    }
    const minions = this._gameState?.minions ?? []
    for (const o of minions) {
      if (o === exceptMinion) continue
      if (!o || o.aiState === 'dead' || (o.resources?.hp ?? 0) <= 0) continue
      const e = grid.getCpForDoorTile(o.tileX, o.tileY)
      if (e?.cp === cp) return true
    }
    return false
  }

  // ── Per-minion tick ────────────────────────────────────────────────────────

  _tickMinion(minion, delta, idx) {
    if (minion.aiState === 'dead') return

    // Player is dragging this minion to a new tile — suspend AI until drop.
    if (minion._heldByPlayer) return

    // Phase 1b.8 — Wraith Haunt ghosts are owned by BossArchetypeSystem's
    // _tickHauntGhosts (wall-phase lerp + melee engage). Letting the regular
    // minion AI also process them causes conflicting per-frame tile-coord
    // writes (fractional from the lerp vs integer from _moveToward) + repeated
    // pathfinder calls from fractional start tiles, which thrashes the path
    // cache and locks up frames once an adv enters the haunt's room.
    //
    // We still need to detect and route the death so MINION_DIED fires (drives
    // sprite cleanup, aiState='dead', and the respawnAll filter that strips
    // dead haunt ghosts permanently). Without this, a ghost killed by an adv
    // sits at hp=0 with aiState='engaging' and slips back through respawn.
    if (minion._isHauntGhost) {
      if (minion.resources.hp <= 0 && minion.aiState !== 'dead') {
        this._die(minion, idx)
      }
      return
    }

    // Phase 9 — Pact of the Marionette: while the player is possessing a
    // minion, every other dungeon minion stands idle. The possessed one
    // is driven by Game._tickMarionette and must NOT also run AI here.
    const possessedId = this._gameState?._mechanicFlags?.possessedMinionId
    if (possessedId && minion.faction === 'dungeon') return

    // Mimic — disguised-chest minions sit still in BOTH the active
    // 'chest' state (waiting to spring) AND the spent 'sprung' state
    // (just killed an adv; visually open till next night). They never
    // patrol or hunt. EXCEPTION: if a knowledge-aware adv has attacked
    // them within the retaliation window, fall through to the normal
    // _pickTarget/_engageTarget flow so the mimic swings back. Without
    // this carve-out the mimic is invulnerable from inside the chest.
    if (minion.isMimic && (minion.mimicState === 'chest' || minion.mimicState === 'sprung')) {
      // Hard pin to homeTile — mimics never move on their own.
      // Some other system (room MOVE displacement on rotation, knockback,
      // a stray AI write) was nudging them off-tile by the next night.
      // This guard snaps them back every tick they don't retaliate, so
      // their physical position is locked even if something tries to
      // shift it. When the player explicitly MOVES the mimic (pickup +
      // drop) the MOVE handler updates homeTileX/Y too, so this pin
      // honours intentional relocations.
      if (minion.tileX !== minion.homeTileX || minion.tileY !== minion.homeTileY) {
        minion.tileX  = minion.homeTileX
        minion.tileY  = minion.homeTileY
        minion.worldX = minion.homeTileX * TS + TS / 2
        minion.worldY = minion.homeTileY * TS + TS / 2
        minion._patrolTarget = null
        minion._chasePath    = null
      }
      const RETALIATE_MS = 3000
      const now = this._scene.time?.now ?? 0
      const retaliating = minion._lastHitBy &&
        (now - (minion._lastHitAt ?? 0)) < RETALIATE_MS
      if (!retaliating) return
    }

    if (minion.resources.hp <= 0) {
      this._die(minion, idx)
      return
    }

    // Pass-1: status tick (DoTs / root-stagger expiry). Cheap to run on every
    // minion every tick; nothing applies these to minions yet but the plumbing
    // is in place for future passes.
    MinionAbilities.tickEntity(minion, this._scene, delta)
    if (minion.resources.hp <= 0) {
      this._die(minion, idx)
      return
    }

    // Pass-1: Lich Heal Undead aura. Bone Cleric heals the most-wounded
    // undead-tagged ally within its home room every 3s for 6 HP.
    if (minion.definitionId === 'lich1') {
      this._tickLichHealAura(minion, delta)
    }

    // Pass-3: per-minion behavior dispatcher. Sets _hidden, _patrolTarget,
    // teleports, etc. Runs before the wander block so its overrides are
    // visible to that block immediately.
    MinionAbilities.tickBehavior(minion, this._scene, this._gameState, this._dungeonGrid, delta)

    // Pass-1/3: stationary behavior gates. Vinekin/Mushrooms never patrol
    // — they hold their tile until aggro'd. Pass-3 adds Lizardman Lurk
    // and Ghost Haunts a Tile to the same set. The aiState is left at
    // 'idle' so combat targeting still works; we just skip the wander
    // block below. (Zombies were previously here but now roam — see the
    // 'roam' behaviorType handling further down.)
    const isStationary = STATIONARY_DEF_IDS.has(minion.definitionId)

    // Idle wander: any non-utility dungeon minion explores its assigned room
    // when no hostiles are in sight. Picks a random tile in the home room,
    // walks there via `_moveToward`, then idles ~3s before picking a new
    // target. Originally gated on `behaviorType === 'patrol'`; opened up to
    // guards too so the dungeon feels alive everywhere.
    if (!isStationary &&
        minion.behaviorType !== 'utility' && minion.aiState === 'idle' && minion.faction === 'dungeon' &&
        !((this._gameState._mechanicFlags ?? {}).kennelDiscipline)) {
      // Pass-3: Ent Slow Guard — temporarily reduce movement speed during
      // wander only. Restore real speed after the move call.
      const isEnt   = minion.definitionId === 'ent1' ||
                      minion.definitionId === 'ent2' ||
                      minion.definitionId === 'ent3'
      const isSlime = minion.definitionId === 'slime1' ||
                      minion.definitionId === 'slime2' ||
                      minion.definitionId === 'slime3' ||
                      minion.definitionId === 'slime4'
      const realSpeed = minion.stats?.speed ?? 1.0
      if (isEnt && minion.stats) minion.stats.speed = realSpeed * 0.4

      // Wander dispatch — three patrol scopes share the same picker:
      //   - 'roam' behaviorType (JSON-driven: zombies, imps, gnolls,
      //     slimes, orcs) wanders any active non-boss room. Movement
      //     uses A* so they actually traverse doorways.
      //   - Guard-Post-home minions get the same dungeon-wide pool.
      //   - Boss-chamber-home minions (boss-archetype summon adds, lich
      //     raises, gnoll hunters pack) patrol the chamber via A* (the
      //     room has the boss + decor in the way) with a shorter idle
      //     pause so they read as actively patrolling, not standing
      //     still during the fight.
      //   - Everyone else does straight-line drift inside home room.
      const home = this._gameState.dungeon.rooms.find(r => r.instanceId === minion.assignedRoomId)
      const isGuardPostHome = home?.definitionId === 'starter_guard_post'
      const isBossChamberHome = home?.definitionId === 'boss_chamber'
      const isRoamer = minion.behaviorType === 'roam'
      const wanderCrossRoom = isRoamer || isGuardPostHome
      const usePathfinder   = wanderCrossRoom || isBossChamberHome
      const patrolPauseMs   = isBossChamberHome ? 1200 : 3000

      if (minion._patrolTarget) {
        if (minion.tileX === minion._patrolTarget.x && minion.tileY === minion._patrolTarget.y) {
          minion._patrolTarget = null
          // Pass-3 Slime Bouncy Path — re-pick a new direction immediately
          // (no rest period), giving Bomb Slimes their erratic feel.
          minion._patrolAccum = isSlime ? patrolPauseMs : 0
        } else if (usePathfinder) {
          // A* routing for cross-room patrol (roam / guard post) and
          // intra-room patrol around obstacles (boss chamber).
          this._walkAlongPath(minion, minion._patrolTarget, delta)
        } else {
          this._moveToward(minion, minion._patrolTarget, delta)
        }
      } else {
        minion._patrolAccum = (minion._patrolAccum ?? 0) + delta
        if (minion._patrolAccum >= patrolPauseMs) {
          minion._patrolAccum = 0
          // Restrict wander targets to INTERIOR FLOOR tiles only. The
          // raw bounding rect includes walls and door tiles; picking a
          // door tile combines with _moveToward's open-door-on-approach
          // hook to leave the minion idling on the opened doorway,
          // looking like they tried to leave but stopped halfway.
          // Picking a wall tile leaves them walking into a wall they
          // can never reach. Constrain to the inner band, verify the
          // tile is FLOOR/BOSS_FLOOR, and retry a few times if the
          // pick lands on decor or anything else non-floor.
          const candidateRooms = wanderCrossRoom
            ? this._gameState.dungeon.rooms.filter(r =>
                r.isActive !== false && r.definitionId !== 'boss_chamber')
            : (home ? [home] : [])
          const room = candidateRooms.length
            ? candidateRooms[Math.floor(Math.random() * candidateRooms.length)]
            : null
          if (room) {
            const WT = Balance.WALL_THICKNESS
            const minX = room.gridX + WT
            const minY = room.gridY + WT
            const innerW = Math.max(1, room.width  - 2 * WT)
            const innerH = Math.max(1, room.height - 2 * WT)
            let pick = null
            for (let attempt = 0; attempt < 8 && !pick; attempt++) {
              const rx = minX + Math.floor(Math.random() * innerW)
              const ry = minY + Math.floor(Math.random() * innerH)
              const t = this._dungeonGrid?.getTileType?.(rx, ry)
              if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) pick = { x: rx, y: ry }
            }
            // Fall back to the minion's own home tile if every roll failed
            // (tiny room fully covered by decor / etc.) — they'll just
            // hold position this cycle.
            if (!pick) pick = { x: minion.homeTileX, y: minion.homeTileY }
            minion._patrolTarget = pick
          }
        }
      }
      if (isEnt && minion.stats) minion.stats.speed = realSpeed
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

    // Phase 6e: utility minions perform their non-combat roles instead
    if (minion.behaviorType === 'utility') {
      this._tickUtility(minion, delta)
      return
    }

    // Owned allies — necromancer-raised undead AND beast-master tames are
    // tethered to their owner adventurer.
    //   • If the owner has died, fled, or otherwise left the dungeon, the
    //     ally drops dead immediately (the necro's will / the BM's bond
    //     is what kept them on-side).
    //   • While the owner is alive, sync speed each tick so owner buffs /
    //     debuffs propagate to the leash, and force-follow when the leash
    //     stretches past FOLLOW_LEASH_TILES — this beats out engaging
    //     distant targets, so the pack stays with the owner instead of
    //     scattering. Within leash range the tick falls through to normal
    //     target selection (so they happily engage anything hostile near
    //     the owner).
    const ownerId = minion.raisedByAdvId ?? minion.tamedByAdvId ?? null
    if (ownerId) {
      const owner = this._gameState.adventurers.active.find(
        a => a.instanceId === ownerId &&
             a.aiState !== 'dead' && a.aiState !== 'fled' && a.aiState !== 'fleeing'
      )
      if (!owner) {
        minion.resources.hp = 0
        this._die(minion, idx)
        return
      }
      if (owner.stats?.speed) minion.stats.speed = owner.stats.speed
      const FOLLOW_LEASH_TILES = 3
      const distToOwner = Math.hypot(
        owner.tileX - minion.tileX,
        owner.tileY - minion.tileY,
      )
      if (distToOwner > FOLLOW_LEASH_TILES) {
        minion.aiState = 'following'
        minion.currentTargetId = null
        this._walkAlongPath(minion, { x: owner.tileX, y: owner.tileY }, delta)
        return
      }
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

    // No target — owned allies (raised undead / tames) at this point are
    // within leash range (the force-follow block above handles the far
    // case + owner-gone despawn), so they just close the small remaining
    // gap or idle next to the owner. Other faction='dungeon' minions
    // return home / patrol.
    minion.currentTargetId = null
    const closeOwnerId = minion.raisedByAdvId ?? minion.tamedByAdvId ?? null
    if (closeOwnerId) {
      const owner = this._gameState.adventurers.active.find(
        a => a.instanceId === closeOwnerId && a.aiState !== 'dead'
      )
      if (owner) {
        const dist = Math.hypot(owner.tileX - minion.tileX, owner.tileY - minion.tileY)
        if (dist > 1.4) {
          minion.aiState = 'following'
          this._walkAlongPath(minion, { x: owner.tileX, y: owner.tileY }, delta)
        } else {
          minion.aiState = 'idle'
        }
      }
      return
    }
    // Guard Post minions don't get pulled back home between fights —
    // their job is to patrol the WHOLE dungeon, so wherever they are
    // when combat resolves they keep wandering. The wander block above
    // picks the next destination (any active non-boss room) and
    // _walkAlongPath routes them there through doorways. Without this,
    // every kill triggered a forced return home and they'd ping-pong
    // between the post and the next patrol target.
    //
    // EXCEPTION: if this minion just lost a fleeing chase (adv escaped
    // into the entry hall or otherwise dropped off the target list),
    // force a single return-home cycle so they actually head back to
    // their original room before resuming patrol — matches the user
    // request that abandoned chases end with the minion regrouping at
    // its post, not just patrolling onward.
    const homeRoom = this._gameState.dungeon.rooms.find(r => r.instanceId === minion.assignedRoomId)
    const isGuardPostHomeForReturn = homeRoom?.definitionId === 'starter_guard_post'
    const isRoamerForReturn = minion.behaviorType === 'roam'
    if (this._atHome(minion)) {
      minion.aiState = 'idle'
      minion._wasChasingFlee = false
      // Patrol = small drift around home (Phase 6b will improve)
    } else if (isGuardPostHomeForReturn && !minion._wasChasingFlee) {
      minion.aiState = 'idle'
      // Patrol = small drift around home (Phase 6b will improve)
    } else if (isRoamerForReturn) {
      // 'roam' behaviorType minions never head home autonomously —
      // they keep wandering from wherever the chase / combat ended.
      // Drops the _wasChasingFlee return-home pass on purpose so a
      // chase that lost its target doesn't force a regroup beat.
      minion.aiState = 'idle'
      minion._wasChasingFlee = false
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
    } else if (minion.definitionId === 'whisperer') {
      this._tickWhisperer(minion, delta)
    }
    // Engineer is passive (handled in CombatSystem when traps fire — see _engineerBuffMultiplier)
    // Mourner is event-driven (see _onMinionDied)
  }

  // Phase QW — Cleaner: removes adventurer corpses from gameState.adventurers.graveyard
  // (well, marks them collected). Dispels spectral ghost spawn potential at the
  // start of next day.
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

  // ── Lich Heal Undead aura (Pass-1) ────────────────────────────────────────
  // Every HEAL_INTERVAL_MS, the Bone Cleric finds the most-wounded undead-tagged
  // ally inside its home room and restores HEAL_AMOUNT HP. Skips itself unless
  // it's the only undead present (mostly self-preservation).
  _tickLichHealAura(lich, delta) {
    const HEAL_INTERVAL_MS = 3000
    const HEAL_AMOUNT      = 6
    lich._lichHealAccum = (lich._lichHealAccum ?? 0) + delta
    if (lich._lichHealAccum < HEAL_INTERVAL_MS) return
    lich._lichHealAccum = 0

    const home = this._gameState.dungeon.rooms.find(r => r.instanceId === lich.assignedRoomId)
    if (!home) return

    let best = null
    let bestMissing = 0
    for (const m of this._gameState.minions) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.faction !== 'dungeon') continue
      if (!Array.isArray(m.tags) || !m.tags.includes('undead')) continue
      if (!_pointInRoom(m.tileX, m.tileY, home)) continue
      const missing = (m.resources?.maxHp ?? 0) - (m.resources?.hp ?? 0)
      if (missing > bestMissing) { best = m; bestMissing = missing }
    }
    if (!best) return
    const before = best.resources.hp
    best.resources.hp = Math.min(best.resources.maxHp ?? 0, best.resources.hp + HEAL_AMOUNT)
    const restored = best.resources.hp - before
    if (restored > 0) {
      EventBus.emit('ALLY_HEALED', {
        sourceId: lich.instanceId,
        targetId: best.instanceId,
        amount:   restored,
        roomId:   lich.assignedRoomId,
      })
      // Heal pulse VFX so the player sees the lich working — gold ring
      // around the healed target + floating "+N" text above their head.
      if (Number.isFinite(best.worldX)) {
        AbilityVfx.pulseRing(this._scene, best.worldX, best.worldY,
          { color: 0xffd966, fromR: 4, toR: 22, alpha: 0.7, durationMs: 400 })
        AbilityVfx.floatingText(this._scene, best.worldX, best.worldY - 18,
          `+${restored}`, { color: '#ffd966', fontSize: '11px' })
      }
    }
  }

  // ── Targeting ──────────────────────────────────────────────────────────────

  _pickTarget(minion) {
    const homeRoom = this._gameState.dungeon.rooms.find(r => r.instanceId === minion.assignedRoomId)
    if (!homeRoom) return null

    // Phase 6e: Barracks-style rooms — minions sleep until combat happens here.
    if (this._isRoomSleeping(homeRoom)) return null

    // Doorway pass-through: a minion in a doorway keeps walking and ignores
    // all targets so it doesn't halt mid-passage to fight.
    if (this._dungeonGrid?.getTileType?.(minion.tileX, minion.tileY) === TILE.DOOR) return null

    // Boss-chamber override: minions standing inside the boss room engage
    // any adventurer also inside the boss room, regardless of where their
    // home is. Reaches them via boss abilities / dark pacts (Final Breath
    // revives, summoned adds, displacement effects), which is the only way
    // a minion can end up here. Without this, a minion whose home is some
    // other room would refuse to attack the adventurers raiding the boss.
    const standingRoom = this._dungeonGrid?.getRoomAtTile?.(minion.tileX, minion.tileY)
    if (standingRoom?.definitionId === 'boss_chamber') {
      let bestB = null
      let bestBd = Infinity
      for (const adv of this._gameState.adventurers.active) {
        if (adv.aiState === 'dead' || adv.resources.hp <= 0) continue
        if (adv._invisible) continue
        // Vampire Charm — charmed advs are walking peacefully to the
        // boss to be turned; minions ignore them.
        if (adv._charmed) continue
        // The Saboteur is untouchable — minions pay it no mind.
        if (adv._saboteur) continue
        if (this._dungeonGrid?.getTileType?.(adv.tileX, adv.tileY) === TILE.DOOR) continue
        if (!_pointInRoom(adv.tileX, adv.tileY, standingRoom)) continue
        // No distance gate — a minion in the boss chamber engages any
        // adventurer who has reached the chamber, however far across it
        // (the chamber is 14×14, far larger than AGGRO_RANGE_TILES).
        const d = Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY)
        if (d < bestBd) { bestB = adv; bestBd = d }
      }
      if (bestB) return bestB
      // No adv in the boss chamber yet — fall through to normal logic so
      // the minion still patrols and can react to defectors etc.
    }

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
    // Phase 9 — Whisperer's Tongue: minions can hear advs across rooms,
    // so the same-room requirement drops (garrison still hard-bound).
    const whisperersTongue = !!((this._gameState._mechanicFlags ?? {}).whisperersTongue)
    // Phase QW (Guard Post) — minions whose home room is a Guard Post
    // act as a forward operating base. They actively engage adventurers
    // in any room directly door-connected to the post, NOT the whole
    // dungeon (unlike `behaviorType: 'hunt'`). Garrison minions are
    // still hard-bound to their assigned room and ignore this aura.
    const isGuardPost = !isGarrison && homeRoom.definitionId === 'starter_guard_post'
    const guardPostConnectedIds = isGuardPost && this._dungeonGrid?.getNeighborRooms
      ? new Set((this._dungeonGrid.getNeighborRooms(homeRoom.instanceId) ?? [])
          .filter(r => r.isActive !== false)
          .map(r => r.instanceId))
      : null
    const requireSameRoom = isGarrison ||
      (Balance.ENGAGE_REQUIRES_SAME_ROOM && !isAlerted && !isHunter && !whisperersTongue)
    // Mobile chase exception: any minion that can actually move (not
    // garrison, not stationary) pursues a FLEEING adventurer through the
    // whole dungeon. Same-room and aggro-range gates are dropped for
    // fleeing targets; pursuit ends when the adv reaches the entry hall
    // (the explicit "give up at the door" cutoff). Stationary defs (see
    // STATIONARY_DEF_IDS at the top of this file) and garrison can't
    // follow, so they keep their normal room-bound targeting.
    const isStationaryForChase = STATIONARY_DEF_IDS.has(minion.definitionId)
    const canChaseFleeing = !isGarrison && !isStationaryForChase

    if (minion.faction === 'adventurer') {
      // Defected minions hunt dungeon-faction minions (and skip adventurers).
      // Manhattan-bounds early-exit before hypot keeps this cheap on large
      // minion rosters.
      const aggroCeil = Math.ceil(aggro)
      for (const m of this._gameState.minions) {
        if (m === minion || m.aiState === 'dead' || m.resources.hp <= 0) continue
        if (m.faction !== 'dungeon') continue
        if (this._dungeonGrid?.getTileType?.(m.tileX, m.tileY) === TILE.DOOR) continue
        const dxAbs = Math.abs(m.tileX - minion.tileX)
        const dyAbs = Math.abs(m.tileY - minion.tileY)
        if (dxAbs > aggroCeil || dyAbs > aggroCeil) continue
        const d = Math.hypot(dxAbs, dyAbs)
        if (d > aggro) continue
        if (d < bestDist) { best = m; bestDist = d }
      }
      return best
    }

    // Default 'dungeon' faction: attack adventurers, plus any 'adventurer'-faction minions
    // Retaliation window — an adv that hit us in the last 3 s bypasses the
    // same-room and aggro-range filters so we always swing back, even
    // across room boundaries (ranged adv shooting in, melee adv at door
    // approach). Cleared implicitly by time expiry.
    const RETALIATION_WINDOW_MS = 3000
    const nowMs = this._scene.time?.now ?? 0
    const retaliateId = (minion._lastHitBy && (nowMs - (minion._lastHitAt ?? 0)) < RETALIATION_WINDOW_MS)
      ? minion._lastHitBy : null
    // Spatial-bucket fast path: when this minion is strictly same-room
    // (garrison, or the standard ENGAGE_REQUIRES_SAME_ROOM rule with no
    // alert/hunt/whisperer/guardpost override), iterate ONLY the advs
    // bucketed into this minion's home room. Cuts the per-tick scan from
    // O(minions × advs) to O(minions × advs-in-room). The non-same-room
    // paths fall back to the full adv list because they legitimately
    // engage across rooms.
    const advPool = (requireSameRoom && this._tickAdvsByRoom)
      ? (this._tickAdvsByRoom.get(homeRoom.instanceId) ?? [])
      : this._gameState.adventurers.active
    for (const adv of advPool) {
      if (adv.aiState === 'dead' || adv.resources.hp <= 0) continue
      const isRetaliationTarget = retaliateId && adv.instanceId === retaliateId
      // Phase 5c — Rogue Invisibility: minions ignore invisible advs.
      // (Boss can still target — that's BossSystem's responsibility.)
      if (adv._invisible) continue
      // Vampire Charm — same rationale as the boss-chamber override
      // above: charmed advs are walking peacefully to the boss room
      // and shouldn't be interrupted by minion attacks. The matching
      // "charmed adv ignores minions" rule lives in
      // AISystem._findEngageableMinion.
      if (adv._charmed) continue
      // The Saboteur is untouchable — minions pay it no mind.
      if (adv._saboteur) continue
      // Adventurers in a doorway are passing through — untargetable so they
      // can walk past a blocking minion without the minion halting to fight.
      if (this._dungeonGrid?.getTileType?.(adv.tileX, adv.tileY) === TILE.DOOR) continue

      // Fleeing-chase gate. Cross-room pursuit is gated on the minion
      // having ALREADY engaged this specific adv on a prior tick
      // (currentTargetId match). That naturally limits chasers to:
      //   - minions that were fighting the adv when they started fleeing
      //     (currentTargetId was set during the in-room engagement and
      //     persists across the room transition)
      //   - minions in rooms the fleeing adv subsequently enters (they
      //     pick the adv up via the regular same-room match below, set
      //     currentTargetId, and from the next tick onward inherit the
      //     cross-room exception)
      // Distant minions that never saw the adv have no lock and stay
      // home — no dungeon-wide stampede every time someone runs.
      // Pursuit ends when the adv reaches entry_hall regardless.
      const advRoom = this._dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)
      const isFleeingAdv = adv.aiState === 'fleeing'
      const wasMyTarget = !!(minion.currentTargetId && adv.instanceId === minion.currentTargetId)
      if (isFleeingAdv && canChaseFleeing && wasMyTarget && advRoom?.definitionId === 'entry_hall') continue
      const isFleeChaseTarget = isFleeingAdv && canChaseFleeing && wasMyTarget &&
                                advRoom?.definitionId !== 'entry_hall'

      // Is this adv inside the minion's home room, or the room the
      // minion is currently standing in? A minion that drifted out of
      // its home room (chased a target, got displaced, path home broken
      // by a locked door) sits idle in some foreign room — the
      // standingRoom fallback keeps advs who walk into that foreign room
      // visible. Garrison minions are strictly home-bound — no
      // standingRoom fallback (if they're away from home, the fix is to
      // send them back, not let them engage abroad).
      const inHome = _pointInRoom(adv.tileX, adv.tileY, homeRoom)
      const inStanding = !!(standingRoom && standingRoom.instanceId !== homeRoom.instanceId &&
                            _pointInRoom(adv.tileX, adv.tileY, standingRoom))
      // Guard Post forward operating base — the adv is in a room
      // directly door-connected to the minion's home Guard Post.
      // _pickTarget will pick this adv, _engageTarget will path the
      // minion through the door to engage, and when the connected
      // rooms clear the default no-target return-home flow brings them
      // back. Cheaper than a full new AI state, leans on the existing
      // walk-along-path code.
      let inGuardPostBeat = false
      if (isGuardPost && guardPostConnectedIds && !inHome && !inStanding) {
        if (advRoom && guardPostConnectedIds.has(advRoom.instanceId)) {
          inGuardPostBeat = true
        }
      }
      const inMinionRoom = inHome || (inStanding && !isGarrison) || inGuardPostBeat

      if (requireSameRoom && !isRetaliationTarget && !inMinionRoom && !isFleeChaseTarget) continue

      // Distance gate. An adv sharing the minion's room is ALWAYS
      // engageable — a guard notices any intruder who walks in, no
      // matter how far across the room they entered. Rooms run up to
      // 14×14, well past AGGRO_RANGE_TILES, so gating same-room targets
      // by aggro range used to make a minion near one wall ignore an
      // adventurer who entered by the far wall. The aggro range only
      // limits cross-room targets — an alerted / hunt / whisperersTongue
      // minion scanning neighbouring rooms.
      const d = Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY)
      if (!inMinionRoom && !isRetaliationTarget && !isFleeChaseTarget) {
        const range = isAlerted ? aggro * 2.5 : aggro
        if (d > range) continue
      }

      // Priority overrides — curse brand > martyr > retaliation > default.
      // Retaliation gets priority 2 so the minion locks onto the actual
      // attacker over an unrelated adv standing slightly closer.
      // Flee-chase targets get priority bumped to retaliation tier so
      // a minion already locked on doesn't flicker to a closer non-
      // fleeing adv mid-pursuit (which would let the original quarry
      // escape).
      const basePriority = isRetaliationTarget ? Math.max(2, _adventurerPriority(adv)) : _adventurerPriority(adv)
      const priority = isFleeChaseTarget ? Math.max(2, basePriority) : basePriority
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

    // Flee-chase speed match: a fleeing adv runs at adv.stats.speed *
    // 1.1 (the AISystem flee multiplier). Mirror that exact speed on
    // the chaser so the pursuit is purely positional — whoever was
    // closer wins, neither side magically out-paces the other. Saved
    // and restored around the move calls below so the minion's base
    // speed stays untouched between ticks. Also stamp a _wasChasingFlee
    // flag so the no-target block can force a one-shot return home
    // after the chase ends (otherwise guard-post minions would just
    // resume patrol from wherever the adv escaped, instead of heading
    // back to their post).
    const fleeing = target?.aiState === 'fleeing'
    const savedSpeed = minion.stats?.speed
    if (fleeing && minion.stats && (target.stats?.speed ?? 0) > 0) {
      minion.stats.speed = target.stats.speed * 1.1
      minion._wasChasingFlee = true
    }
    try {
      // No overlap-attacks: a minion standing on the same tile as the
      // target doesn't swing at point-blank — they wait for the adv to
      // step off. Symmetric with the adv-side rule in AISystem.
      if (d >= 0.99 && d <= reach + 0.01) {
        // In range — attack
        this._combatSystem.tryAttack(minion, target, {
          roomId: minion.assignedRoomId,
        })
        return
      }
      // Pass-3: Imp Flying / Rat Wall Squeeze — bypass the A* walker and
      // straight-line through walls toward the target. Floats / squeezes
      // through gaps that A* refuses to plot.
      if (minion.definitionId === 'imp1' || minion.definitionId === 'rat1') {
        this._moveToward(minion, { x: target.tileX, y: target.tileY }, delta)
        return
      }
      // Out of range — chase along an A* path so the minion follows
      // walkable tiles (through doorways) instead of straight-lining
      // through walls. The previous straight-line _moveToward made
      // cross-room engagements look like teleports.
      this._walkAlongPath(minion, { x: target.tileX, y: target.tileY }, delta)
    } finally {
      if (fleeing && minion.stats) minion.stats.speed = savedSpeed
    }
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
      // Phase: items — block beacon/fountain/treasure-chest tiles so
      // minions navigate around the structures (collision parity with
      // adventurers).
      const blocked = new Set()
      for (const b of this._gameState.dungeon?.beacons        ?? []) blocked.add(`${b.tileX},${b.tileY}`)
      for (const f of this._gameState.dungeon?.fountains      ?? []) blocked.add(`${f.tileX},${f.tileY}`)
      for (const c of this._gameState.dungeon?.treasureChests ?? []) blocked.add(`${c.tileX},${c.tileY}`)
      const fresh = PathfinderSystem.findPath(
        { x: minion.tileX, y: minion.tileY },
        targetTile,
        this._dungeonGrid,
        null, 0,
        blocked,
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

  // ── Movement ──────────────────────────────────────────────────────────────

  _moveToward(minion, targetTile, delta) {
    // Door pause: if the next waypoint sits on a closed connection-point
    // door, trigger the split-open animation (idempotent) and hold position
    // until it finishes — mirrors the adventurer pattern in
    // AISystem._moveToward so minions don't phase silently through closed
    // doors when chasing, returning home, or following a summoner.
    // Patroller minions (vampire thrall / demon imp / wraith haunt) keep
    // their re-lock-behind behavior via _tickPatrollerDoors; this just
    // makes the open visible for every minion that crosses a doorway.
    const enteringDoor = this._dungeonGrid?.getCpForDoorTile?.(targetTile.x, targetTile.y)
    if (enteringDoor && !enteringDoor.cp.open) {
      this._scene?._dungeonRenderer?.openDoor(enteringDoor.cp)
      // Dungeon minions HOLD at the doorway until the 0.5 s open animation
      // finishes (so they don't visibly phase through a closed door while
      // patrolling). Owner-following allies — necromancer raises, beast-master
      // tames, and Jinwoo's shadow army — instead walk through as it opens,
      // exactly like the adventurer they follow (AISystem opens-on-step, never
      // pauses). Without this the per-door 0.5 s pause compounds across every
      // doorway and a fast owner (the 2x-speed Shadow Monarch) leaves his army
      // stranded behind each door. They still trigger the open above.
      const isFollowingAlly = minion.raisedByAdvId || minion.tamedByAdvId
      if (!isFollowingAlly) return
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

  // ── Death / respawn ───────────────────────────────────────────────────────

  _die(minion, idx) {
    // Pass-2 revive interrupt — Zombie One More Time, Skeleton Reassemble.
    // Returns true if the death was aborted (minion is now alive again).
    if (MinionAbilities.onMinionDying(this._scene, minion, this._gameState)) {
      minion.aiState = 'idle'
      minion.currentTargetId = null
      return
    }
    minion.aiState = 'dead'
    minion.deathDay = this._gameState.meta.dayNumber
    minion.currentTargetId = null
    // Pass-1/2 ability hook — credits stolen gold (Goblin / Mimic), spawns
    // mini-slimes, fires Imp blast, releases Mushroom spores. Safe no-op for
    // everything else.
    MinionAbilities.onMinionDeath(this._scene, minion, this._gameState)
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
    // Phase 1b.9 — Demon Hellgate imps don't respawn. Killed (or sacrificed,
    // though those are stripped on burn) imps stay dead; the Hellgate emits a
    // fresh batch of N=bossLevel imps each dawn from BossArchetypeSystem.
    this._gameState.minions = this._gameState.minions.filter(
      m => !(m._isDemonImp && (m.aiState === 'dead' || m.resources.hp <= 0))
    )
    // Phase 1b.7 — Myconid Corpse Bloom Vinekins are one-shot. Each fungal
    // corpse only sprouts a single Vinekin; if it dies, the slot is gone for
    // good (unless another corpse blooms). Otherwise the cap on simultaneous
    // corpses is meaningless and Vinekin numbers compound week over week.
    this._gameState.minions = this._gameState.minions.filter(
      m => !(m._myconidSprout && (m.aiState === 'dead' || m.resources.hp <= 0))
    )
    // Phase 1b.8 — Wraith Haunt ghosts are spectres bound to one specific
    // death. If killed, they don't reform; the boss has to claim a fresh
    // adventurer to spawn another one. Without this, ghosts accumulate every
    // night and Wraith snowballs uncontrollably.
    this._gameState.minions = this._gameState.minions.filter(
      m => !(m._isHauntGhost && (m.aiState === 'dead' || m.resources.hp <= 0))
    )
    // Hall of Trials spawns are one-shot. The room's promise is "one
    // random Tier-2 minion per day, and if it dies it doesn't come
    // back" — letting respawnAll revive a killed HoT spawn put it back
    // alive next dawn, AND MinionEvolutionSystem.applyResets would
    // demote it to its Tier-1 base (skeleton2 → skeleton1, etc.),
    // which is the "respawning as T1" bug the player reported. Filter
    // dead HoT spawns out permanently here; RoomBehaviorSystem.
    // _onDayStart then sees no alive HoT spawn in the room and rolls
    // a FRESH random Tier-2 — the design's intended replacement.
    this._gameState.minions = this._gameState.minions.filter(
      m => !(m.isHallOfTrialsSpawn && (m.aiState === 'dead' || m.resources.hp <= 0))
    )
    // Throne Room mini-bosses are the same shape — kill drops the
    // tagged entity entirely so the next _spawnThroneMinibosses pass
    // rolls a fresh random chain-APEX (each family's final form — T3
    // for 3-link chains, T4 elder slime for the 4-link slime chains)
    // with double-base stats. Without this filter, respawnAll would
    // resurrect the dead mini-boss at full HP and applyResets would
    // demote its apex def to a Tier-1 base, mirroring the HoT
    // regression but worse — the mini-boss would come back puny.
    this._gameState.minions = this._gameState.minions.filter(
      m => !(m.isThroneMiniBoss && (m.aiState === 'dead' || m.resources.hp <= 0))
    )
    // Mercenary-contract minions don't revive — if the hire falls in
    // battle, the contract is over. (Surviving mercenaries are removed
    // separately by EventSystem when their 3-day contract expires.)
    this._gameState.minions = this._gameState.minions.filter(
      m => !(m._mercenary && (m.aiState === 'dead' || m.resources.hp <= 0))
    )
    // Pass-2: mini-slimes from Slime Split are temporary — wipe them all at
    // dawn (alive or dead) so they can't accumulate forever.
    this._gameState.minions = this._gameState.minions.filter(m => !m._isMiniSlime)
    // Slime King Absorb & Excrete Gooplings are one-shot: a Goopling that
    // dies stays dead (per user spec — no respawn). Alive ones DO persist
    // across nights so the player keeps their goop-army between days,
    // matching how regular night-spawned minions persist when they survive.
    this._gameState.minions = this._gameState.minions.filter(
      m => !(m._isGoopling && (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0))
    )

    const bossLv = this._gameState.boss?.level ?? 1
    const day    = this._gameState.meta?.dayNumber ?? 1

    for (const m of this._gameState.minions) {
      // Phase 7b: track times-killed-and-respawned for vengeful_wraith evolution
      if (m.aiState === 'dead' || m.resources.hp <= 0) {
        m.timesKilledAndRespawned = (m.timesKilledAndRespawned ?? 0) + 1
        EventBus.emit('MINION_RESPAWNED', { minion: m, count: m.timesKilledAndRespawned })
        // A minion that died loses the XP it earned — it revives next
        // dawn as a fresh level-1 recruit. (Evolution is reverted
        // separately by MinionEvolutionSystem.applyResets.)
        m.level = 1
        m.xp    = 0
      }
      // Re-apply day+boss scaling each dawn so retained minions stay competitive.
      // applyMinionScaling always recomputes from _baseMaxHp/_baseAtk, never stacks.
      applyMinionScaling(m, bossLv, day)
      // Phase 9 — Last Stand Doctrine: minions that triggered the bonus
      // respawn drained at 50% HP next day (overrides the full-heal above).
      if (m._lastStandUsed) {
        m.resources.hp = Math.max(1, Math.floor((m.resources.maxHp ?? 0) * Balance.MECHANIC_LAST_STAND_RESPAWN_HP_FRAC))
        m._lastStandUsed = false
      }
      m.tileX  = m.homeTileX
      m.tileY  = m.homeTileY
      m.worldX = m.homeTileX * TS + TS / 2
      m.worldY = m.homeTileY * TS + TS / 2
      m.aiState = 'idle'
      m.currentTargetId = null
      m.deathDay = null
      // Pass-1: bank any pickpocketed gold from minions that survived the day
      // (Goblin / Mimic). Death-time crediting is handled in _die.
      if (m._stolenGold > 0 && this._gameState.player) {
        this._gameState.player.gold = (this._gameState.player.gold ?? 0) + m._stolenGold
        m._stolenGold = 0
      }
      // Pass-3: Lizardman Lurk — re-anchor to a random corner of the home
      // room each dawn so they don't telegraph by always sitting on the
      // same tile.
      if (m.definitionId === 'lizardman1' || m.definitionId === 'lizardman2') {
        MinionAbilities._placeLizardmanInCorner(m, this._gameState)
      }
      // Pass-3: clear behavior-state accumulators (teleport timer, demon
      // sense flag, scavenger target) so they restart each day.
      m._teleAccum     = 0
      m._demonSensing  = false
      m._patrolTarget  = null
      m._patrolAccum   = 0
      m._chasePath     = null
      // Clear per-fight ability flags so Vinekin Snare re-arms and Lizardman
      // Camouflage re-hides each night.
      MinionAbilities.resetOneShotsForNight(m)
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

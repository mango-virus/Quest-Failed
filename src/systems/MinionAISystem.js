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
import { isPermadeadAtDawn, fallenRevivable } from '../util/minionRevive.js'
import { applyCrowdSeparation } from '../util/crowdSeparation.js'
import { meleeSlotTile } from '../util/combatSlots.js'

const TS = Balance.TILE_SIZE

// Wander anti-stuck watchdog (game-time ms). A roaming/patrolling minion must
// never freeze forever on a target it can't actually reach — an unreachable
// pick (target in a decor-boxed pocket / behind a contested doorway), or a rare
// movement jam. If it makes NO tile progress for this long while heading to a
// patrol target, it abandons the target and re-picks. Two thresholds because a
// minion legitimately holds still on a doorway tile while the 0.5 s open
// animation plays — and that animation runs on REAL time, so at the 16× HYPER
// speed it eats ~8 s of GAME-time delta. The door threshold sits safely above
// that; the off-door one is snappy (nothing should pin a minion in open floor).
const PATROL_STUCK_MS      = 3500    // frozen in open floor → re-pick fast
const PATROL_STUCK_DOOR_MS = 12000   // frozen at a doorway → above the 16× door-open hold

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
  // Summoner totems (Widen) — rooted founts of swarmlings; never patrol.
  'bone_totem1',
  'bone_totem2',
  'necro_obelisk',
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
      if (a._invisible || a._underground) continue   // invisible rogue / burrowed miner — not present to wake the room
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

    // Hazard zones (Thread E / Widen terrain-shaper) — lingering damage tiles
    // dropped by hazard-trail minions; ticked + expired once per frame.
    MinionAbilities.tickHazards(this._scene, this._gameState, delta)

    // Goblin Plunder marks — bleed gold off branded heroes + expire marks.
    MinionAbilities.tickPlunderMarks(this._scene, this._gameState, delta)

    // De-clump STANDING minions — idle guards / settled packs that share a tile
    // fan out so they don't read as one blob. STATIONARY only (idle with no
    // patrol target): walking minions are excluded (nudging them backfires) and
    // so are combat / leashed / never-move defs. Doorway-safe (see crowdSeparation).
    applyCrowdSeparation(minions, this._dungeonGrid, {
      radius: 10,
      eligible: (m) =>
        m.aiState === 'idle' && !m._patrolTarget && (m.resources?.hp ?? 0) > 0 &&
        !STATIONARY_DEF_IDS.has(m.definitionId),
    })
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

    // VFX Lab — a frozen lab entity never runs AI (stays put for review).
    if (minion._vfxLabFrozen) return

    // Player is dragging this minion to a new tile — suspend AI until drop.
    if (minion._heldByPlayer) return

    // Mage Tower POLYMORPH — a minion turned into a harmless critter just idles
    // (no targeting, no movement) until the transmute expires.
    if (minion._polymorphed) return

    // Betrayer NIGHT-DASH — the traitor minion is driven by a scripted tween
    // (KingdomModifierSystem); the AI mustn't fight it for control.
    if (minion._saboteurDashing) return

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

    // Lich Heal Undead aura is now data-driven (healAura onTick in
    // minionTypes.json) so ALL lich tiers heal — see MinionAbilities.tickAbilities
    // below. (The old lich1-only _tickLichHealAura call lived here.)

    // Pass-3: per-minion behavior dispatcher. Sets _hidden, _patrolTarget,
    // teleports, etc. Runs before the wander block so its overrides are
    // visible to that block immediately.
    MinionAbilities.tickBehavior(minion, this._scene, this._gameState, this._dungeonGrid, delta)

    // Data-driven onTick abilities (Thread E) — heal/revive/buff/contagion/
    // summon/hazard auras authored in JSON. Interval-gated internally.
    MinionAbilities.tickAbilities(minion, this._scene, this._gameState, this._dungeonGrid, delta)

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
          minion._patrolStuckMs = 0
          // Pass-3 Slime Bouncy Path — re-pick a new direction immediately
          // (no rest period), giving Bomb Slimes their erratic feel.
          minion._patrolAccum = isSlime ? patrolPauseMs : 0
        } else if (usePathfinder) {
          // A* routing for cross-room patrol (roam / guard post) and
          // intra-room patrol around obstacles (boss chamber).
          const reachable = this._walkAlongPath(minion, minion._patrolTarget, delta)
          // Anti-stuck watchdog. A roamer must never stand frozen forever on a
          // target it can't reach (the dominant "minion stuck at the door /
          // never leaves the room" bug: an unreachable pick, or a movement jam,
          // left _patrolTarget set — it only ever cleared on ARRIVAL). If A*
          // found NO path, or the minion makes no tile progress for too long,
          // drop the target and re-pick next cycle. This is a gentle re-pick —
          // never a teleport across a door (see project_quest_failed_door_teleport).
          const tileKey = minion.tileX + ',' + minion.tileY
          if (minion._patrolProgressTile !== tileKey) {
            minion._patrolProgressTile = tileKey
            minion._patrolStuckMs = 0
          } else {
            minion._patrolStuckMs = (minion._patrolStuckMs ?? 0) + delta
          }
          const atDoorway = !!(this._dungeonGrid?.getCpForDoorTile?.(minion.tileX, minion.tileY)
                            ||  this._dungeonGrid?.isLaneOrApproach?.(minion.tileX, minion.tileY))
          const stuckLimit = atDoorway ? PATROL_STUCK_DOOR_MS : PATROL_STUCK_MS
          if (reachable === false || (minion._patrolStuckMs ?? 0) >= stuckLimit) {
            minion._patrolTarget = null
            minion._chasePath = null
            minion._patrolStuckMs = 0
            minion._patrolAccum = patrolPauseMs   // re-pick on the next tick
          }
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
      // Necro raises / beast tames keep pace with their owner. Shadows keep
      // their OWN 1.5×-base speed set at extraction (slower than the 2×-base
      // Monarch) — don't override it back to his pace each tick.
      if (owner.stats?.speed && !minion._shadowExtracted) minion.stats.speed = owner.stats.speed
      // Necro raises / beast tames LEASH to their owner. Jinwoo's extracted
      // shadows do NOT — they fan out and hunt the dungeon's own minions
      // (target selection below is dungeon-wide for them). They still die with
      // the Monarch via the owner-gone check above.
      if (!minion._shadowExtracted) {
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
    // Shadows with no hunt target (dungeon cleared) hold position — they never
    // leash back to the Monarch.
    if (minion._shadowExtracted) {
      minion.aiState = 'idle'
      return
    }
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
    // Solo Leveling — extracted shadows are dungeon-wide hunters. They have no
    // home room and ignore the aggro-range gate: they relentlessly seek the
    // nearest living dungeon-faction minion ANYWHERE on the map and march on it
    // (cross-room A* via _engageTarget). This runs before the home-room gate
    // below (which would otherwise return null for their assignedRoomId=null).
    if (minion._shadowExtracted) {
      // Sticky — keep hunting the current quarry until it's dead, so the army
      // doesn't re-pick (and re-clump) every tick.
      if (minion.currentTargetId) {
        const cur = this._gameState.minions.find(m => m.instanceId === minion.currentTargetId)
        if (cur && cur.faction === 'dungeon' && cur.aiState !== 'dead' && (cur.resources?.hp ?? 0) > 0) {
          return cur
        }
      }
      // Load-balance: tally how many OTHER shadows are already locked onto each
      // dungeon minion, then pick the nearest one with the FEWEST claimants.
      // This fans the army out across the dungeon instead of every shadow
      // dogpiling the single nearest target (the "all run around together"
      // clump). CLAIM_WEIGHT is large so a far UNclaimed minion always beats a
      // near already-claimed one.
      const claims = {}
      for (const sh of this._gameState.minions) {
        if (sh !== minion && sh._shadowExtracted && sh.aiState !== 'dead' && sh.currentTargetId) {
          claims[sh.currentTargetId] = (claims[sh.currentTargetId] ?? 0) + 1
        }
      }
      const CLAIM_WEIGHT = 1000
      let best = null
      let bestScore = Infinity
      for (const m of this._gameState.minions) {
        if (m === minion || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        if (m.faction !== 'dungeon') continue
        const d = Math.hypot(m.tileX - minion.tileX, m.tileY - minion.tileY)
        const score = (claims[m.instanceId] ?? 0) * CLAIM_WEIGHT + d
        if (score < bestScore) { bestScore = score; best = m }
      }
      return best
    }

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
        if (adv._invisible || adv._underground) continue   // invisible rogue / burrowed miner — untargetable
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
      if (adv._invisible || adv._underground) continue   // + burrowed miner
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
      // Short leash (2026-06-09, by user): a NON-fleeing adv this minion is
      // ALREADY fighting (currentTargetId) stays engaged a few tiles past the
      // room boundary, so a hero just walking through can't make the minion
      // abruptly give up mid-fight. Anchored to the HOME room (not the minion)
      // and capped tight so the minion stays a room defender, never a dungeon-
      // wide chaser — once the quarry is >LEASH from home the leash breaks and
      // the no-target return-home flow takes over. (Fleeing advs use the wider
      // isFleeChaseTarget path above.)
      const LEASH_TILES = 4
      const _lx = Math.max(homeRoom.gridX - adv.tileX, 0, adv.tileX - (homeRoom.gridX + homeRoom.width - 1))
      const _ly = Math.max(homeRoom.gridY - adv.tileY, 0, adv.tileY - (homeRoom.gridY + homeRoom.height - 1))
      // Garrison minions (Crypt, Throne Room mini-bosses, …) are strictly
      // home-bound and NEVER leash-chase out of their room — matches
      // canChaseFleeing = !isGarrison above; keeps a throne mini-boss on its throne.
      const isLeashedTarget = !isGarrison && wasMyTarget && !isFleeingAdv && Math.hypot(_lx, _ly) <= LEASH_TILES

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

      if (requireSameRoom && !isRetaliationTarget && !inMinionRoom && !isFleeChaseTarget && !isLeashedTarget) continue

      // Distance gate. An adv sharing the minion's room is ALWAYS
      // engageable — a guard notices any intruder who walks in, no
      // matter how far across the room they entered. Rooms run up to
      // 14×14, well past AGGRO_RANGE_TILES, so gating same-room targets
      // by aggro range used to make a minion near one wall ignore an
      // adventurer who entered by the far wall. The aggro range only
      // limits cross-room targets — an alerted / hunt / whisperersTongue
      // minion scanning neighbouring rooms.
      const d = Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY)
      if (!inMinionRoom && !isRetaliationTarget && !isFleeChaseTarget && !isLeashedTarget) {
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
      const priority = (isFleeChaseTarget || isLeashedTarget) ? Math.max(2, basePriority) : basePriority
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
    // Light Party — tank Provoke aura. If the chosen target is a non-tank
    // Light Party member AND a living tank is within PROVOKE range of THIS
    // minion, swap to the tank. Reads as "the paladin steps in front" —
    // minions can't pick off the squishies as long as the tank is nearby.
    // PROVOKE_RANGE = 4 tiles. Range is measured FROM THE MINION because the
    // tank's role is to draw aggro within his own threat radius, not to
    // teleport-block from across the room.
    if (best && best._lightParty && best._lightPartyRole !== 'tank') {
      const PROVOKE_RANGE = 4
      let tank = null, tankD = Infinity
      for (const a of this._gameState.adventurers?.active ?? []) {
        if (!a?._lightParty || a._lightPartyRole !== 'tank') continue
        if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
        const d = Math.hypot(a.tileX - minion.tileX, a.tileY - minion.tileY)
        if (d <= PROVOKE_RANGE && d < tankD) { tank = a; tankD = d }
      }
      if (tank) best = tank
    }
    return best
  }

  // ── Engagement ────────────────────────────────────────────────────────────

  _engageTarget(minion, target, delta) {
    const reach = minion.attackRange ?? Balance.MELEE_RANGE_TILES
    const d = Math.hypot(target.tileX - minion.tileX, target.tileY - minion.tileY)

    // Thread C — reactive wounded states (mix per-archetype): bruisers ENRAGE,
    // ranged/casters KITE, fragile/support FALL BACK. Returns true when it owns
    // this tick's movement (kite/fall-back); enrage just flags + falls through.
    if (this._reactiveCombat(minion, target, d, reach, delta)) return

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
      // Same-room attack gate (2026-06-02, by user): only SWING when the
      // minion and target share a room. A minion that has chased a target to
      // within reach but is still one tile shy of the doorway must keep pathing
      // THROUGH the door (fall through below) instead of swinging across the
      // wall — no cross-door attacks (mirrors CombatSystem.tryAttack). Corridors
      // count as rooms, so a minion + adv in the same corridor still fight.
      const _rm = this._dungeonGrid?.getRoomAtTile?.(minion.tileX, minion.tileY)
      const _rt = this._dungeonGrid?.getRoomAtTile?.(target.tileX, target.tileY)
      const sameRoom = !!(_rm && _rt && _rm.instanceId === _rt.instanceId)
      // No overlap-attacks: a minion standing on the same tile as the
      // target doesn't swing at point-blank — they wait for the adv to
      // step off. Symmetric with the adv-side rule in AISystem.
      if (sameRoom && d >= 0.99 && d <= reach + 0.01) {
        // In range AND same room — attack
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
      //
      // Surround the target: a melee swarm RINGS the adventurer (each minion
      // claims a distinct adjacent slot) instead of all pathing to its exact
      // tile and piling into one blob. Ranged minions keep pathing toward the
      // target (they stop at range, so they don't stack). Falls back to the
      // target's tile if no slot is free/walkable.
      let dest = { x: target.tileX, y: target.tileY }
      if ((minion.attackRange ?? 1) <= 1) {
        const tgtRoom = this._dungeonGrid?.getRoomAtTile?.(target.tileX, target.tileY)
        const tiles   = this._dungeonGrid?.getTiles?.()
        dest = meleeSlotTile(minion, target, this._gameState.minions, (tx, ty) => {
          if (!tiles?.[ty] || !PathfinderSystem.isWalkable(tiles[ty][tx])) return false
          if (this._dungeonGrid?.isDoorBlocked?.(tx, ty)) return false
          const rs = this._dungeonGrid?.getRoomAtTile?.(tx, ty)
          return !!(tgtRoom && rs && rs.instanceId === tgtRoom.instanceId)
        })
      }
      this._walkAlongPath(minion, dest, delta)
    } finally {
      if (fleeing && minion.stats) minion.stats.speed = savedSpeed
    }
  }

  // ── Thread C: reactive wounded states ─────────────────────────────────────

  // Classify a minion's combat archetype from its tags / range so the wounded
  // reaction matches its kit (a glass caster shouldn't stand and trade).
  _archetypeOf(minion) {
    const tags = minion.tags ?? []
    const ranged  = (minion.attackRange ?? 1) > 1 || tags.includes('ranged') || tags.includes('caster')
    const support = tags.includes('support') || tags.includes('commander') || tags.includes('summoner')
    return { ranged, support, bruiser: !ranged && !support }
  }

  // Per-tick reactive behavior while engaged. ENRAGE flags the minion for the
  // CombatSystem damage bonus (no movement change → falls through to normal
  // engage). KITE / FALL BACK take over movement and return true.
  _reactiveCombat(minion, target, d, reach, delta) {
    const ENRAGE_FRAC = 0.35, FALLBACK_FRAC = 0.35, KITE_MIN = 2.0, FRAGILE_MAXHP = 55
    const maxHp  = minion.resources?.maxHp ?? 1
    const hpFrac = maxHp > 0 ? (minion.resources?.hp ?? 0) / maxHp : 1
    const arch   = this._archetypeOf(minion)
    const stationary = STATIONARY_DEF_IDS.has(minion.definitionId)
    const garrison   = minion.class === 'garrison'

    // ENRAGE — wounded bruisers hit harder (read in CombatSystem._computeDamage).
    // Orcs are excluded: they already have Berserker Rage (attack-speed) as their
    // family signature, so we don't double-dip the wounded escalation on them.
    if (arch.bruiser && !stationary && !(minion.tags ?? []).includes('orc')) {
      if (hpFrac < ENRAGE_FRAC && !minion._enraged) {
        minion._enraged = true
        if (Number.isFinite(minion.worldX)) {
          AbilityVfx.pulseRing(this._scene, minion.worldX, minion.worldY, { color: 0xcc2222, fromR: 6, toR: 24, alpha: 0.7, durationMs: 500 })
          AbilityVfx.floatingText(this._scene, minion.worldX, minion.worldY - 20, 'ENRAGED', { color: '#ff5544' })
        }
      } else if (hpFrac >= ENRAGE_FRAC && minion._enraged) {
        minion._enraged = false
      }
      // No movement change — let normal engage continue.
    }

    // KITE — a ranged attacker that an adventurer has closed on backsteps to
    // restore its range (still firing if it can), staying inside its home room
    // so it never kites out of its leash or through a doorway.
    if (arch.ranged && !stationary && d > 0 && d < KITE_MIN) {
      const _rm = this._dungeonGrid?.getRoomAtTile?.(minion.tileX, minion.tileY)
      const _rt = this._dungeonGrid?.getRoomAtTile?.(target.tileX, target.tileY)
      if (_rm && _rt && _rm.instanceId === _rt.instanceId && d <= reach + 0.01 && d >= 0.99) {
        this._combatSystem.tryAttack(minion, target, { roomId: minion.assignedRoomId })
      }
      this._kiteStep(minion, target, delta)
      return true
    }

    // FALL BACK — a wounded fragile/support minion retreats toward its home tile
    // to regroup (next to its barracks/allies) instead of trading to the death.
    // Garrison mini-bosses and stationary minions hold their post.
    const fragile = arch.support || (!arch.bruiser && maxHp <= FRAGILE_MAXHP)
    if (fragile && !garrison && !stationary && hpFrac < FALLBACK_FRAC && !this._atHome(minion)) {
      if (!minion._fallingBack) {
        minion._fallingBack = true
        if (Number.isFinite(minion.worldX)) AbilityVfx.floatingText(this._scene, minion.worldX, minion.worldY - 20, 'FALL BACK', { color: '#ffcc44' })
      }
      minion.aiState = 'returning'
      this._walkAlongPath(minion, { x: minion.homeTileX, y: minion.homeTileY }, delta)
      return true
    }
    if (minion._fallingBack && (hpFrac >= FALLBACK_FRAC || this._atHome(minion))) minion._fallingBack = false

    return false
  }

  // One backstep directly away from `target`, constrained to walkable, non-door
  // tiles inside the minion's home room. Holds position if cornered.
  _kiteStep(minion, target, delta) {
    const home = this._gameState.dungeon.rooms.find(r => r.instanceId === minion.assignedRoomId)
    const dx = Math.sign(minion.tileX - target.tileX)
    const dy = Math.sign(minion.tileY - target.tileY)
    if (dx === 0 && dy === 0) return
    const tiles = this._dungeonGrid?.getTiles?.()
    const inHome = (x, y) => !home || (x >= home.gridX && x < home.gridX + home.width && y >= home.gridY && y < home.gridY + home.height)
    for (const c of [{ x: minion.tileX + dx, y: minion.tileY + dy }, { x: minion.tileX + dx, y: minion.tileY }, { x: minion.tileX, y: minion.tileY + dy }]) {
      if (!inHome(c.x, c.y)) continue
      if (!tiles?.[c.y] || !PathfinderSystem.isWalkable(tiles[c.y][c.x])) continue
      if (this._dungeonGrid?.isDoorBlocked?.(c.x, c.y)) continue
      this._moveToward(minion, c, delta)
      return
    }
    // Cornered — nowhere safe to retreat; hold and keep firing.
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
        // still rather than straight-line through walls. Report the failure so
        // a wandering caller abandons this target instead of freezing on it.
        minion._chasePath = null
        return false
      }
    }

    // Walk toward the next waypoint; advance when reached.
    const next = path[0]
    this._moveToward(minion, next, delta)
    if (minion.tileX === next.x && minion.tileY === next.y) {
      path.shift()
      if (path.length === 0) minion._chasePath = null
    }
    return true
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

    // Owner-following allies (necromancer raises, beast-master tames),
    // extracted shadows, AND any minion currently crossing a doorway all skip
    // the ½-tile doorway-lane shift + lane L-shape logic below. The diagnosis
    // (shadows frozen at the first doorway, necromancer summons stuck in doors,
    // and the Gnoll Hunters-Pack jamming at the boss-room entrance — only one
    // gets out, the rest stand on the threshold): the lane-centre target lands
    // exactly on a doorway seam (world coord = N×TS) and the dist<0.5 snap parks
    // the unit ON that seam, with every subsequent approach/lane waypoint
    // re-targeting the same seam — so it never moves off it. Hits faster at 2×
    // speed (shadows) but surfaces on ANY minion whose step lands near the seam,
    // which is why a whole pack funnelling through one door reliably jams.
    // Nobody needs the single-file lane prettiness badly enough to deadlock —
    // A* already routes everyone down the canonical (walkable) door column, so a
    // dead-simple centre-to-centre step through the doorway is both correct and
    // deadlock-proof. Off-doors, minions keep the lane motion below.
    const nearDoorway = !!(this._dungeonGrid?.isLaneOrApproach?.(minion.tileX, minion.tileY)
                        ||  this._dungeonGrid?.isLaneOrApproach?.(targetTile.x, targetTile.y))
    if (minion._shadowExtracted || minion.raisedByAdvId || minion.tamedByAdvId || nearDoorway) {
      const cx = targetTile.x * TS + TS / 2
      const cy = targetTile.y * TS + TS / 2
      const sdx = cx - minion.worldX
      const sdy = cy - minion.worldY
      const sdist = Math.hypot(sdx, sdy)
      const sStep = (minion.stats.speed * TS * delta) / 1000
      if (sStep >= sdist || sdist < 0.5) {
        minion.worldX = cx
        minion.worldY = cy
      } else {
        minion.worldX += (sdx / sdist) * sStep
        minion.worldY += (sdy / sdist) * sStep
      }
      const sntx = Math.floor(minion.worldX / TS)
      const snty = Math.floor(minion.worldY / TS)
      const sTiles = this._dungeonGrid?.getTiles?.()
      const sWalk = !!sTiles?.[snty] && PathfinderSystem.isWalkable(sTiles[snty][sntx])
      if (this._dungeonGrid?.isDoorBlocked?.(sntx, snty) || !sWalk) {
        minion.tileX = targetTile.x
        minion.tileY = targetTile.y
      } else {
        minion.tileX = sntx
        minion.tileY = snty
      }
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
    // Never latch tileX/tileY onto a non-walkable cell. The ½-tile doorway-lane
    // shift combined with a LARGE per-step move (fast followers — Jinwoo's
    // 2×-speed shadow army) can overshoot the lane and floor() into the wall
    // column beside the 2-wide opening, or onto the pathfinder-blocked
    // secondary door tile. Latching there makes the next _walkAlongPath
    // findPath START from a non-walkable tile and return null → the minion
    // freezes at the doorway forever (reported: shadows stuck at the first
    // door). Snap to the explicit target waypoint instead — it always comes
    // from the pathfinder (the walkable canonical lane / next step), so the
    // following findPath always starts somewhere it can route out of.
    const gTiles = this._dungeonGrid?.getTiles?.()
    const ntWalkable = !!gTiles?.[nty] && PathfinderSystem.isWalkable(gTiles[nty][ntx])
    if (this._dungeonGrid?.isDoorBlocked?.(ntx, nty) || !ntWalkable) {
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
    const flags = this._gameState._mechanicFlags ?? {}

    // Bloodbound loss count for the UI, measured BEFORE the strip below
    // (Bloodbound makes every fallen minion a permanent loss — folded into
    // isPermadeadAtDawn).
    let bloodboundLost = 0
    if (flags.bloodbound) {
      bloodboundLost = this._gameState.minions.filter(m =>
        m.faction !== 'adventurer' && (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0)
      ).length
    }

    // Strip every permanent-death minion at dawn. isPermadeadAtDawn
    // (util/minionRevive.js) is the SINGLE definition of "stays dead" —
    // defectors, Bloodbound losses, re-died Undying-Horde undead, Demon
    // imps, Myconid sprouts, Wraith haunt ghosts, Hall-of-Trials elites,
    // Throne mini-bosses, mercenaries, mini-slimes and gooplings. The
    // pay-to-revive button reads the SAME predicate, so it can never
    // resurrect a unit meant to stay down.
    this._gameState.minions = this._gameState.minions.filter(m => !isPermadeadAtDawn(m, flags))
    if (flags.bloodbound && bloodboundLost > 0) EventBus.emit('BLOODBOUND_LOSSES', { count: bloodboundLost })

    const bossLv = this._gameState.boss?.level ?? 1
    const day    = this._gameState.meta?.dayNumber ?? 1

    for (const m of this._gameState.minions) {
      const dead = m.aiState === 'dead' || m.resources.hp <= 0
      if (dead) {
        // Pay-to-revive (2026-05-28): player ROSTER minions are NO LONGER
        // auto-revived for free at dawn. They stay fallen (aiState 'dead', in
        // place) until the player pays at the night-phase REVIVE button
        // (reviveFallen), and are purged at day start if left unrevived.
        if ((m.class ?? 'roster') === 'roster') continue
        // Auto-managed GARRISON spawns that survived the permadead strip above
        // (Gnoll hunters pack, Crypt risen bones, Catacombs revenants, …) keep
        // their free dawn revival, exactly as before — their host room /
        // archetype system counts on it (e.g. _refillHuntersPack). They were
        // never player-built, so they're never in the pay-to-revive pool.
        m.timesKilledAndRespawned = (m.timesKilledAndRespawned ?? 0) + 1
        EventBus.emit('MINION_RESPAWNED', { minion: m, count: m.timesKilledAndRespawned })
        // Tier upgrades PERSIST through death (2026-05-29) — _dawnRefresh
        // rescales from the minion's upgraded base, so it returns at the tier
        // the player paid for. No XP/level reset (the kill-XP system was removed).
      }
      this._dawnRefresh(m, bossLv, day)
    }
  }

  // Per-minion "fresh dawn" reset — rescale to the current boss level / day,
  // full-heal, return home, clear per-night ability + behaviour state. Shared
  // by respawnAll (living survivors) and reviveFallen (paid revives) so the
  // two can never drift apart.
  _dawnRefresh(m, bossLv, day) {
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
    // (Lizardman dawn-corner re-anchor was wiped with the behavior quirks.)
    // Clear any residual per-tick accumulators so a loaded save recovers.
    m._teleAccum     = 0
    m._demonSensing  = false
    m._patrolTarget  = null
    m._patrolAccum   = 0
    m._chasePath     = null
    // Clear per-fight ability flags so Vinekin Snare re-arms and Lizardman
    // Camouflage re-hides each night.
    MinionAbilities.resetOneShotsForNight(m)
  }

  // Pay-to-revive (2026-05-28): bring every currently-fallen revivable minion
  // back to life. Gold is charged by the caller (Game._onReviveFallenRequest)
  // BEFORE this runs — this method only performs the revive transform: the
  // shared dawn refresh rescales the minion from its (possibly upgraded) base,
  // full-heals it, and returns it home. Tier upgrades persist through death
  // (2026-05-29), so a revived minion comes back at its paid tier. The polling
  // MinionRenderer recreates
  // the sprite next frame. Permanent-death specials are excluded via
  // fallenRevivable's shared predicate, so they're never touched. Returns the
  // number revived.
  // `instanceIds` (array or Set) restricts the revive to that subset — used by
  // the pay-to-revive partial flow when the player can't afford everyone. Omit
  // to revive all fallen revivable.
  reviveFallen(instanceIds = null) {
    let fallen = fallenRevivable(this._gameState)
    if (instanceIds) {
      const set = instanceIds instanceof Set ? instanceIds : new Set(instanceIds)
      fallen = fallen.filter(m => set.has(m.instanceId))
    }
    if (fallen.length === 0) return 0
    const bossLv = this._gameState.boss?.level ?? 1
    const day    = this._gameState.meta?.dayNumber ?? 1
    for (const m of fallen) {
      // Track times-killed-and-respawned for vengeful_wraith evolution.
      m.timesKilledAndRespawned = (m.timesKilledAndRespawned ?? 0) + 1
      EventBus.emit('MINION_RESPAWNED', { minion: m, count: m.timesKilledAndRespawned })
      // A paid revive returns the minion at its UPGRADED tier (2026-05-29) —
      // _dawnRefresh rescales from its upgraded base. No XP/level reset (the
      // kill-XP system was removed).
      this._dawnRefresh(m, bossLv, day)
    }
    EventBus.emit('MINIONS_REVIVED', { count: fallen.length })
    return fallen.length
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

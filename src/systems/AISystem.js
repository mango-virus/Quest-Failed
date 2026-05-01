// Per-tick adventurer AI.
// Phase 4: walk to boss → instant kill on arrival.
// Phase 5: personality-driven goal selection + EXPLORE_ROOM detours.
// Phase 6 (kernel): real combat with minions, FLEE goal, mid-dungeon death.

import { EventBus }         from './EventBus.js'
import { PathfinderSystem } from './PathfinderSystem.js'
import { Balance }          from '../config/balance.js'
import { TILE }             from './DungeonGrid.js'

const TS = Balance.TILE_SIZE

export class AISystem {
  constructor(scene, gameState, dungeonGrid, personalitySystem = null, combatSystem = null, knowledgeSystem = null) {
    this._scene       = scene
    this._gameState   = gameState
    this._dungeonGrid = dungeonGrid
    this._personalitySystem = personalitySystem
    this._combatSystem      = combatSystem
    this._knowledgeSystem   = knowledgeSystem
    EventBus.on('COMBAT_HIT',      this._onCombatHit,    this)
    EventBus.on('MINION_DIED',     this._onMinionDied,   this)
    EventBus.on('ADVENTURER_DIED', this._onAdventurerDied, this)
  }

  destroy() {
    EventBus.off('COMBAT_HIT',      this._onCombatHit,    this)
    EventBus.off('MINION_DIED',     this._onMinionDied,   this)
    EventBus.off('ADVENTURER_DIED', this._onAdventurerDied, this)
  }

  setPersonalitySystem(ps) { this._personalitySystem = ps }
  setCombatSystem(cs)      { this._combatSystem = cs }
  setKnowledgeSystem(ks)   { this._knowledgeSystem = ks }

  // Track who hit whom so death attribution is accurate, and trigger flee on damage.
  _onCombatHit({ sourceId, targetId, damageType }) {
    const adv = this._gameState.adventurers.active.find(a => a.instanceId === targetId)
    if (!adv) return
    adv._lastHitBy   = sourceId
    adv._lastHitType = damageType
    this._checkFleeTrigger(adv)
  }

  // (Stub) Necromancer's old raise-on-minion-death behavior has been retired.
  // The new Summon Undead ability (cooldown-driven, summons fresh skeletons
  // from nothing rather than raising corpses) will be wired in the
  // Necromancer class-rework pass.
  _onMinionDied({ minion }) { /* intentionally empty after Phase 5b rework */ }

  // Detect PARTY_WIPED — fires when the last living party member dies AND any
  // surviving traumatized member should panic-flee (sole survivor scenario).
  _onAdventurerDied({ adventurer }) {
    if (!adventurer?.partyId) return
    const survivors = this._gameState.adventurers.active.filter(
      a => a.partyId === adventurer.partyId && a.aiState !== 'dead'
    )

    // Phase QW — raid_leader cascade-flee: if the dead adventurer was a
    // raid_leader, every surviving party-mate panics and flees. Their
    // morale was wholly tied to the leader.
    const wasRaidLeader = adventurer.personalityIds?.includes('raid_leader')
    if (wasRaidLeader && survivors.length > 0) {
      EventBus.emit('RAID_LEADER_FELL', { leader: adventurer, partyId: adventurer.partyId })
      for (const s of survivors) {
        if (s.aiState === 'fleeing') continue
        this._setFleeGoal(s, 'raid_leader_dead')
      }
    }

    if (survivors.length === 0) {
      EventBus.emit('PARTY_WIPED', { partyId: adventurer.partyId, lastDead: adventurer })
      return
    }
    if (survivors.length === 1) {
      const survivor = survivors[0]
      const isTraumatized = survivor.personalityIds?.includes('traumatized')
      if (isTraumatized) {
        EventBus.emit('PARTY_WIPED', { partyId: adventurer.partyId, lastSurvivor: survivor })
        survivor.flags = survivor.flags ?? {}
        survivor.flags.fullKnowledgeOnFlee = true   // Phase 8 will read this
        this._setFleeGoal(survivor, 'traumatized_panic')
      }
    }
  }

  // Called every Game.update() frame. delta is in ms, already scaled by time scale.
  update(delta) {
    const active = this._gameState.adventurers.active

    // Tile occupancy map for this tick — used to keep adventurers from
    // physically overlapping each other while walking. Built once per
    // update so every adventurer sees a consistent snapshot.
    //   key: "x,y"  →  instanceId of the adventurer currently on that tile
    // Adventurers in combat/healing/sleeping count too — they're standing
    // on the tile and shouldn't be walked through.
    this._occupancy = {}
    for (const a of active) {
      if (a.aiState === 'dead' || a.resources.hp <= 0) continue
      this._occupancy[`${a.tileX},${a.tileY}`] = a.instanceId
    }

    // Iterate in reverse so we can splice on death without index trouble
    for (let i = active.length - 1; i >= 0; i--) {
      this._tickAdventurer(active[i], delta, i)
    }
  }

  // Returns true if (tx,ty) is currently occupied by an adventurer other than `selfAdv`.
  _tileOccupiedByOtherAdv(tx, ty, selfAdv) {
    const id = this._occupancy?.[`${tx},${ty}`]
    return !!id && id !== selfAdv.instanceId
  }

  // World-space center of the entry hall's north-facing door rect.
  // Mirrors AdventurerRenderer._entryDoorWorldCenter / DungeonRenderer
  // _cpDoorRect: 2-tile width slid into the side with more wall space,
  // WALL_THICKNESS-tile height starting at the top row.  Used so leave-
  // fade snaps the adv to the same spot the spawn-fade snaps to.
  _entryDoorWorldCenter(entry) {
    if (!entry) return null
    const cp = (entry.connectionPoints ?? []).find(c => c.direction === 'N')
    if (!cp) {
      const x = entry.gridX + Math.floor(entry.width / 2)
      return { tileX: x, tileY: entry.gridY, worldX: x * TS + TS / 2, worldY: entry.gridY * TS + TS / 2 }
    }
    const WT      = 2
    const alongDx = ((entry.width - 1) - cp.x) >= cp.x ? 1 : -1
    const xStart  = Math.min(cp.x, cp.x + alongDx)
    const tileX   = entry.gridX + xStart
    const tileY   = entry.gridY
    const worldX  = tileX * TS + TS
    const worldY  = tileY * TS + (WT * TS) / 2
    return { tileX, tileY, worldX, worldY }
  }

  // ── Per-adventurer tick ─────────────────────────────────────────────────────

  _tickAdventurer(adv, delta, idx) {
    if (adv.aiState === 'dead') return
    if (adv.resources.hp <= 0) {
      this._kill(adv, idx, adv._lastHitBy ?? 'unknown')
      return
    }
    // Phase 5c — while the spawn fade-in is still running, the adv idles
    // in the doorway. Skip movement, pathing, goal switches, and combat
    // checks until AdventurerRenderer clears the fade flags.
    if (adv._spawnFadeEnd != null && (this._scene?.time?.now ?? 0) < adv._spawnFadeEnd) {
      return
    }
    // Mirror — while the leave fade-out is running, the adv idles in
    // the doorway center until the fade completes (handled below near
    // the FLEE → atNorthEdge splice).  Same skip semantics as spawn.
    if (adv._leaveFadeEnd != null && (this._scene?.time?.now ?? 0) < adv._leaveFadeEnd) {
      return
    }
    // AT_BOSS adventurers are owned by BossSystem.  Skip every other AI
    // branch and free our occupancy entry so the 4th party member can
    // path through the doorway tile this one used to hold.  Without the
    // short-circuit, _goalToTile returns null for AT_BOSS, the recent
    // path-failure → FLEE conversion fires, and the adv flickers between
    // AI flee-walk and BossSystem orbit every frame ("teleporting").
    if (adv.goal?.type === 'AT_BOSS') {
      if (this._occupancy) {
        const key = `${adv.tileX},${adv.tileY}`
        if (this._occupancy[key] === adv.instanceId) delete this._occupancy[key]
      }
      return
    }

    // Track whether the adventurer has ever been outside the entry hall.
    // Without this, advs that get a FLEE goal immediately on spawn (e.g.
    // their first pathfind failed and we converted to FLEE) would auto-
    // splice on the first tick because they're still standing in the
    // entry from spawn time.
    const entry = this._gameState.dungeon.rooms.find(r => r.definitionId === 'entry_hall')
    const inEntry = entry &&
      adv.tileX >= entry.gridX && adv.tileX < entry.gridX + entry.width &&
      adv.tileY >= entry.gridY && adv.tileY < entry.gridY + entry.height
    if (!inEntry) adv._leftEntry = true

    // The dungeon entrance is fixed at the north edge of entry_hall — the
    // canonical exit/entry gate. Fleeing only counts as "escaped" when the
    // adventurer's tile is on entry_hall's northmost row (the doorway row).
    const atNorthEdge = entry &&
      adv.tileY === entry.gridY &&
      adv.tileX >= entry.gridX && adv.tileX < entry.gridX + entry.width

    // If fleeing and physically RETURNING to the north edge of entry_hall
    // (must have left at some point), leave the dungeon.  Mirrors the
    // entry flow: snap to the doorway center, idle while fading out,
    // then splice + emit ADVENTURER_FLED when the fade completes.
    if (adv.goal?.type === 'FLEE' && atNorthEdge && adv._leftEntry) {
      const now = this._scene?.time?.now ?? 0
      if (adv._leaveFadeEnd == null) {
        const door = this._entryDoorWorldCenter(entry)
        if (door) {
          adv.tileX  = door.tileX
          adv.tileY  = door.tileY
          adv.worldX = door.worldX
          adv.worldY = door.worldY
        }
        adv.path = null
        adv.aiState = 'leaving'
        adv._leaveFadeStart = now
        adv._leaveFadeEnd   = now + 600
        return
      }
      if (now < adv._leaveFadeEnd) return
      adv.aiState = 'fled'
      // Room redesign 2026-04-30 — Treasury theft resolves on alive exit.
      // If the adventurer made it to the door carrying a chest, deduct the
      // chest's value from the player's Soul Essence. Death (handled
      // elsewhere in _die) clears carriedChest with no deduction.
      if (adv.carriedChest) {
        const value = adv.carriedChest.value ?? 0
        this._gameState.player.soulEssence = Math.max(0,
          (this._gameState.player.soulEssence ?? 0) - value
        )
        EventBus.emit('TREASURY_CHEST_STOLEN', {
          adventurer: adv,
          value,
          sourceTreasuryId: adv.carriedChest.sourceTreasuryId,
        })
        adv.carriedChest = null
      }
      this._gameState.adventurers.active.splice(idx, 1)
      EventBus.emit('ADVENTURER_FLED', {
        adventurer: adv,
        reason: adv.goal.reason ?? 'low_hp_retreat',
      })
      return
    }
    // Stuck-in-entry timeout — handles the disconnected-dungeon case
    // where an adventurer spawned at entry, couldn't path to anything
    // (got auto-converted to FLEE by the goal-unreachable fallback), and
    // now has nowhere to go.  After ~3 s of being stuck fleeing without
    // ever leaving entry, give up so the day phase can still end.
    if (adv.goal?.type === 'FLEE' && inEntry && !adv._leftEntry) {
      adv._stuckInEntryMs = (adv._stuckInEntryMs ?? 0) + delta
      if (adv._stuckInEntryMs > 3000) {
        // Match the normal-leave flow — snap to doorway center and run
        // the fade-out so we never see an instant disappear.
        const now = this._scene?.time?.now ?? 0
        if (adv._leaveFadeEnd == null) {
          const door = this._entryDoorWorldCenter(entry)
          if (door) {
            adv.tileX  = door.tileX
            adv.tileY  = door.tileY
            adv.worldX = door.worldX
            adv.worldY = door.worldY
          }
          adv.path = null
          adv.aiState = 'leaving'
          adv._leaveFadeStart = now
          adv._leaveFadeEnd   = now + 600
          return
        }
        if (now < adv._leaveFadeEnd) return
        adv.aiState = 'fled'
        this._gameState.adventurers.active.splice(idx, 1)
        EventBus.emit('ADVENTURER_FLED', {
          adventurer: adv,
          reason: 'goal_unreachable',
        })
        return
      }
    } else if (adv._stuckInEntryMs) {
      adv._stuckInEntryMs = 0
    }
    // Engage the boss only once we're past the wall thickness on a true
    // INTERIOR floor tile of the chamber.  If we flipped on the bounding
    // rect, the doorway tiles would qualify and BossSystem's interior
    // clamp would snap the adv several tiles into the room — the
    // visible "teleport to the boss" the player kept seeing.  Letting
    // SEEK_BOSS keep control through the doorway lane means AISystem
    // walks them naturally into the room; once they hit the first real
    // floor tile we hand off to BossSystem and the `dash` action runs
    // them at 7 tiles/sec to their orbit slot.
    if (adv.goal?.type === 'SEEK_BOSS') {
      const bossRoom = this._gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
      const WT = Balance.WALL_THICKNESS
      if (bossRoom &&
          adv.tileX >= bossRoom.gridX + WT && adv.tileX < bossRoom.gridX + bossRoom.width  - WT &&
          adv.tileY >= bossRoom.gridY + WT && adv.tileY < bossRoom.gridY + bossRoom.height - WT) {
        adv.goal    = { type: 'AT_BOSS' }
        adv.path    = null
        adv.aiState = 'fighting'
        EventBus.emit('BOSS_FIGHT_INCOMING', { adventurer: adv })
        return
      }
    }

    // Phase 8: log the room the adventurer is in (idempotent — first visit only emits)
    this._knowledgeSystem?.observeCurrentRoom(adv)

    // Bug fix — emit ADVENTURER_ROOM_CHANGED on every actual room transition
    // (not just on goal completion). RoomBehaviorSystem listens for this to
    // trigger Colosseum gates, False Exit teleports, etc.
    const curRoomId = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId ?? null
    if (curRoomId !== adv._lastRoomId) {
      const prev = adv._lastRoomId ?? null
      adv._lastRoomId = curRoomId
      if (curRoomId) {
        EventBus.emit('ADVENTURER_ROOM_CHANGED', {
          adventurer: adv, fromRoomId: prev, toRoomId: curRoomId,
        })
      }
    }

    // Phase 8b: sample path for replay ghosts
    this._samplePath(adv, delta)

    // Phase 10b — Twitch Streamer chat_poll: every ~10s, chat picks a random
    // unvisited room and the streamer abandons whatever they were doing
    // to "follow viewer suggestion". Wildly chaotic; loved by the boss.
    if (adv.classId === 'twitch_streamer' && adv.aiState !== 'fighting' && adv.aiState !== 'fleeing') {
      adv._chatPollAccum = (adv._chatPollAccum ?? 0) + delta
      if (adv._chatPollAccum >= 10000) {
        adv._chatPollAccum = 0
        const visited = new Set(adv.visitedRooms ?? [])
        const candidates = this._gameState.dungeon.rooms.filter(r =>
          !visited.has(r.instanceId) && r.definitionId !== 'boss_chamber'
        )
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)]
          adv.goal = { type: 'EXPLORE_ROOM', roomId: pick.instanceId }
          adv.path = null
          EventBus.emit('TWITCH_CHAT_POLL', { adventurer: adv, targetRoomId: pick.instanceId })
        }
      }
    }

    // Phase 6e: passive room effects (healing fountain heal-on-stand)
    this._applyRoomEffects(adv, delta)

    // Phase 6c: detect coward seeing enemies — flee before engaging
    if (this._cowardShouldFlee(adv)) {
      this._setFleeGoal(adv, 'coward_panic')
    }

    // Phase 6e: resource-depletion flee. Mana removed in 5b rework, so this
    // now only fires for rangers running out of arrows. Ranger arrow logic is
    // itself slated for removal when the Volley/Trap-Expert ability rework
    // ships, but until then the flee trigger remains valid.
    if (this._resourceExhaustedShouldFlee(adv)) {
      this._setFleeGoal(adv, 'out_of_arrows')
    }

    // Phase 6e: SLEEP goal — if HP is moderate-low and no enemies in room,
    // sleep here to slowly heal back to full. Vulnerable while sleeping.
    if (this._shouldSleep(adv)) {
      this._sleep(adv, delta)
      return
    }

    // Standard flee check (HP threshold)
    this._checkFleeTrigger(adv)

    // Phase QW — solo: split off from party on first tick. Once stripped,
    // they ignore party effects and pursue their own goals. No combo banner
    // detection picks them up after this point — they're effectively a lone
    // wolf for the rest of the run.
    if (this._personalitySystem && adv.partyId) {
      const tags = this._personalitySystem.getTags(adv)
      if (tags.has('solo') && !adv.flags?.soloSplit) {
        adv.flags = adv.flags ?? {}
        adv.flags.soloSplit = true
        adv.flags.formerPartyId = adv.partyId
        adv.partyId = null
        EventBus.emit('SOLO_SPLIT', { adventurer: adv })
      }
    }

    // Phase QW — party_loyal: when a party-mate drops below 40% HP, abandon
    // current goal and rush to their tile to interpose. Acts like a temporary
    // FOLLOW_LEADER but targets the wounded ally instead.
    if (this._personalitySystem) {
      const tags = this._personalitySystem.getTags(adv)
      if (tags.has('party_loyal') && adv.partyId && adv.aiState !== 'fighting' && adv.aiState !== 'fleeing') {
        const wounded = this._gameState.adventurers.active.find(a =>
          a.partyId === adv.partyId &&
          a.instanceId !== adv.instanceId &&
          a.aiState !== 'dead' &&
          (a.resources.hp / Math.max(1, a.resources.maxHp)) < 0.4
        )
        if (wounded && adv.goal?.type !== 'DEFEND_ALLY') {
          adv.goal = { type: 'DEFEND_ALLY', allyId: wounded.instanceId }
          adv.path = null
          EventBus.emit('PARTY_LOYAL_RALLIED', { defender: adv, ally: wounded })
        }
      }
    }

    // Phase 5c — Cleric heal moved to ClassAbilitySystem._considerCleric
    // (cooldown-driven, no mana). The legacy unconditional-heal-every-tick
    // block here was deleted to avoid double-firing.

    // Engage hostile minion in melee range
    if (adv.aiState !== 'fleeing' && this._combatSystem) {
      const enemy = this._findEngageableMinion(adv)
      if (enemy) {
        // Phase 7b: vultures skip combat when there's loot to snag in the room
        const tagsEarly = this._personalitySystem?.getTags(adv) ?? new Set()
        if (tagsEarly.has('vulture') && this._lootInSameRoom(adv)) {
          // Just keep moving toward the loot — don't engage
          return
        }

        // Phase QW — martyr_vulture combo ("Sacrifice and Salvage"): if a
        // party-mate is currently taunting (martyr at low HP), the vulture
        // refuses to engage at all — they wait for the martyr to draw fire,
        // then loot the carnage.
        if (tagsEarly.has('vulture') && adv.partyId) {
          const tauntingMartyr = this._gameState.adventurers.active.find(a =>
            a.partyId === adv.partyId &&
            a.instanceId !== adv.instanceId &&
            a.aiState !== 'dead' &&
            a.personalityIds?.includes('martyr') &&
            (a.resources.hp / Math.max(1, a.resources.maxHp)) <= Balance.MARTYR_TAUNT_HP_FRACTION
          )
          if (tauntingMartyr) {
            adv.flags = adv.flags ?? {}
            adv.flags.vultureWaitingForCarnage = true
            return
          }
        }

        // Phase 5c — Beast Master tame logic moved to ClassAbilitySystem.
        // The legacy tag-based tame attempt is gone; tame is now a proper
        // cooldown ability with single-companion enforcement.

        adv.aiState = 'fighting'
        adv.path = null
        this._combatSystem.tryAttack(adv, enemy, {
          roomId: this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId,
        })
        this._checkFleeTrigger(adv)
        return
      } else if (adv.aiState === 'fighting' || adv.aiState === 'healing') {
        adv.aiState = 'walking'
      }
    }

    // Recompute path if we don't have one or our goal target changed
    if (!adv.path || adv.pathIndex >= adv.path.length) {
      const target = this._goalToTile(adv)
      if (!target) {
        // Goal dissolved (room removed, ally died, etc.).  Switch to FLEE
        // so they at least try to head home — only an actual entry-hall
        // arrival or death is allowed to remove them from active.
        if (adv.goal?.type !== 'FLEE') {
          adv.goal    = { type: 'FLEE', reason: 'goal_unreachable' }
          adv.path    = null
          adv.aiState = 'fleeing'
          return
        }
        // Already fleeing and STILL no target — every fallback exhausted.
        // Fall through to despawn as the absolute last resort.
        this._despawn(adv, idx, 'no_target')
        return
      }
      // Phase 8: weight tiles by this adventurer's knowledge (avoid known
      // traps) — but skip knowledge weighting when fleeing.  A panicking
      // adventurer takes the fastest route home, traps be damned.
      const useKnowledgeCost = this._knowledgeSystem && adv.goal?.type !== 'FLEE'
      const costFn = useKnowledgeCost
        ? (tx, ty) => this._knowledgeSystem.costMultiplierForTile(adv, tx, ty)
        : null
      // Add path jitter for non-flee goals so adventurers don't all march the
      // same straight line — they pick varied routes between rooms each repath.
      // Fleeing advs skip jitter (panic = beeline home).
      const pathJitter = adv.goal?.type === 'FLEE' ? 0 : 0.6
      const path = PathfinderSystem.findPath(
        { x: adv.tileX, y: adv.tileY }, target, this._dungeonGrid, costFn, pathJitter,
      )
      if (!path || path.length === 0) {
        // An empty path means either "already at goal" (start === target) or
        // "no route exists".  Only treat the former as a true arrival; the
        // latter for a FLEE goal is "got turned around" and should re-roll.
        if (adv.tileX === target.x && adv.tileY === target.y) {
          this._onGoalReached(adv, idx)
          return
        }
        if (adv.goal?.type === 'FLEE') {
          adv.goal.fleeTargetX = null
          adv.goal.fleeTargetY = null
          adv.goal.fleeIsEntry = false
          adv.path             = null
          return
        }
        // Non-flee goal blocked — convert to FLEE rather than despawn.
        adv.goal    = { type: 'FLEE', reason: 'goal_unreachable' }
        adv.path    = null
        adv.aiState = 'fleeing'
        return
      }
      adv.path = path
      adv.pathIndex = 0
      adv.pathTarget = target
    }

    // Path smoothing — pick the furthest waypoint with a clear straight-line
    // walkable corridor from current world position. The pathfinder returns
    // tile-by-tile axis-aligned waypoints; without smoothing advs march only
    // N/S/E/W between tile centers and look grid-locked. With it, they cut
    // diagonals across open rooms at any angle (matching how the boss
    // wanders its room).
    let wpIndex = adv.pathIndex
    const tilesGrid = this._dungeonGrid.getTiles?.()
    if (tilesGrid) {
      const MAX_LOOKAHEAD = 16
      const limit = Math.min(adv.path.length - 1, adv.pathIndex + MAX_LOOKAHEAD)
      for (let i = adv.pathIndex + 1; i <= limit; i++) {
        const wp2 = adv.path[i]
        // Stop smoothing the moment a candidate target enters the
        // doorway corridor (canonical lane tile OR the floor approach
        // tile flanking it).  Forces cardinal stepping through the
        // entire entry → lane → exit sequence so the lateral
        // alignment to the seam happens BEFORE the entity touches
        // the corridor, not while passing the door.
        if (this._dungeonGrid.isLaneOrApproach?.(wp2.x, wp2.y)) break
        // Once committed to the corridor, every step must be cardinal
        // — break if the SOURCE position is in the corridor too.
        if (this._dungeonGrid.isLaneOrApproach?.(adv.tileX, adv.tileY)) break
        const tx2 = wp2.x * TS + TS / 2
        const ty2 = wp2.y * TS + TS / 2
        if (this._losClear(adv.worldX, adv.worldY, tx2, ty2, tilesGrid)) wpIndex = i
        else break
      }
    }

    // Move toward smoothed waypoint.  For canonical doorway lane tiles
    // (and the floor approach/exit tiles flanking them) the target is
    // shifted ½-tile along the along-axis so the entity walks through
    // the visual CENTRE of the 2-wide doorway opening (the seam between
    // the two door tiles), not through one column's tile centre.
    const wp = adv.path[wpIndex]
    const laneCenter = this._dungeonGrid.getLaneCenterWorld?.(wp.x, wp.y)
    const targetWX = laneCenter ? laneCenter.worldX : (wp.x * TS + TS / 2)
    const targetWY = laneCenter ? laneCenter.worldY : (wp.y * TS + TS / 2)
    const dx = targetWX - adv.worldX
    const dy = targetWY - adv.worldY
    const dist = Math.hypot(dx, dy)

    // Door pause: if the next waypoint sits on a closed connection-point
    // door, hold position until the split-open animation finishes. We
    // trigger the opening here (idempotent) so the animation starts the
    // moment the adventurer reaches the door rather than after they walk
    // through it.
    const enteringDoor = this._dungeonGrid.getCpForDoorTile?.(wp.x, wp.y)
    if (enteringDoor && !enteringDoor.cp.open) {
      if (!enteringDoor.cp.opening) {
        enteringDoor.cp.opening = true
        enteringDoor.cp.openProgress = 0
        EventBus.emit('DOOR_OPENING', { cp: enteringDoor.cp })
      }
      return
    }

    // Yield-on-overlap: if the tile we're walking into is currently held by
    // another active adventurer, hold position this tick. They'll move along
    // and we'll resume next tick. Adventurers physically overlapping each
    // other looked wrong (multiple bodies stacked on the same square), so
    // walkers now respect a single-occupant-per-tile invariant.
    //
    // We only block when the next tile is a *different* tile than our
    // current one — i.e. we're about to commit to entering it. This prevents
    // self-deadlock where an adventurer's own occupancy entry blocks them.
    const enteringNewTile = (wp.x !== adv.tileX || wp.y !== adv.tileY)
    if (enteringNewTile && this._tileOccupiedByOtherAdv(wp.x, wp.y, adv)) {
      // Head-on swap escape valve: if the blocker is *also* trying to enter
      // our current tile (i.e. we're walking straight at each other in a
      // 1-wide corridor), relax the single-occupant invariant for this
      // tick.  Both adventurers commit their move in the same frame and
      // cross paths.  Without this, the 1.2 s repath loop just gives the
      // same blocked route back forever.
      const blocker = this._gameState.adventurers.active.find(a =>
        a.instanceId !== adv.instanceId && a.tileX === wp.x && a.tileY === wp.y
      )
      const blockerNext = blocker?.path?.[blocker.pathIndex]
      const isHeadOn = !!(blockerNext &&
        blockerNext.x === adv.tileX && blockerNext.y === adv.tileY)
      if (!isHeadOn) {
        adv._waitMs = (adv._waitMs ?? 0) + delta
        // Stuck for more than ~1.2 s? Drop the path and let the next tick
        // recompute — pathfinder might find a way around, or the blocker
        // will have shifted.
        if (adv._waitMs > 1200) {
          adv.path = null
          adv._waitMs = 0
        }
        return
      }
      // Fall through — commit the swap move.
    }
    adv._waitMs = 0

    // Phase 6c: paranoid types move slower in unfamiliar rooms.
    // Without knowledge system (Phase 8) we just slow them whenever they're
    // not in a barracks/starter room — proxy for "unfamiliar".
    const speedMul = this._paranoidSpeedMultiplier(adv)
    // Fleeing adventurers sprint — 1.1× their normal pace.  Sells the
    // "running away in panic" feel and helps unlucky lost-flee wanderers find
    // the entry hall faster.
    const fleeMul  = adv.aiState === 'fleeing' ? 1.1 : 1
    // Phase 5c — Bard Song of Speed: same-party advs within 2 tiles of a
    // speed-song-active Bard move 20% faster.
    const songMul  = this._songOfSpeedMul(adv)
    const stepPx   = (adv.stats.speed * speedMul * fleeMul * songMul * TS * delta) / 1000

    if (stepPx >= dist || dist < 0.5) {
      // Commit to the new tile — update occupancy so subsequent
      // adventurers in this same tick see we now own it.
      const prevKey = `${adv.tileX},${adv.tileY}`
      if (this._occupancy?.[prevKey] === adv.instanceId) delete this._occupancy[prevKey]
      adv.worldX = targetWX
      adv.worldY = targetWY
      adv.tileX  = wp.x
      adv.tileY  = wp.y
      if (this._occupancy) this._occupancy[`${wp.x},${wp.y}`] = adv.instanceId
      this._maybeOpenDoorAt(wp.x, wp.y)
      // Advance past every waypoint we collapsed via LOS smoothing.
      adv.pathIndex = wpIndex + 1

      if (adv.pathIndex >= adv.path.length) {
        adv.path = null
        this._onGoalReached(adv, idx)
      }
    } else {
      // Doorway-corridor L-shape motion.  Inside the corridor (lane
      // tile or approach/exit floor) the entity may move ONLY along
      // the lane (forward) axis — no lateral drift while passing
      // through the door shadow.  Entering the corridor from outside
      // applies lateral correction first (so the seam-align happens
      // BEFORE the doorway).  Exiting the corridor applies forward
      // first (so the seam-undo happens AFTER the entity is fully
      // out of the door shadow).  Outside the corridor, regular
      // proportional diagonal motion as before.
      const advLane = this._dungeonGrid.isLaneOrApproach?.(adv.tileX, adv.tileY)
      const wpLane  = this._dungeonGrid.isLaneOrApproach?.(wp.x, wp.y)
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
          adv[key] += Math.sign(d) * Math.min(Math.abs(d), stepPx)
          moved = true
        }
        if (inside) {
          // Pure forward only inside the corridor.
          if (Math.abs(forwardD) > ALIGN_EPS) moveAxis(forwardKey, forwardD)
        } else if (entering) {
          // Lateral first (while still outside the corridor), then forward.
          if (Math.abs(lateralD) > ALIGN_EPS)      moveAxis(lateralKey, lateralD)
          else if (Math.abs(forwardD) > ALIGN_EPS) moveAxis(forwardKey, forwardD)
        } else if (exiting) {
          // Forward first (out of the corridor), then lateral.
          if (Math.abs(forwardD) > ALIGN_EPS)      moveAxis(forwardKey, forwardD)
          else if (Math.abs(lateralD) > ALIGN_EPS) moveAxis(lateralKey, lateralD)
        }
      }
      // Fallback — if the L-shape branch declined to move (both axes
      // within the alignment epsilon, or laneAxis was null), use the
      // ordinary proportional diagonal so the entity never freezes
      // mid-segment.
      if (!moved) {
        adv.worldX += (dx / dist) * stepPx
        adv.worldY += (dy / dist) * stepPx
      }
      // Sync tile coords each frame from world position so room-membership,
      // combat-range, and occupancy checks see the actual location while
      // traversing a smoothed (multi-tile) segment.
      const newTileX = Math.floor(adv.worldX / TS)
      const newTileY = Math.floor(adv.worldY / TS)
      // Doorway-seam guard: when worldX/Y sits on the seam between the
      // canonical and secondary doorway tiles (because lane centring
      // shifted the target ½-tile), floor() can briefly resolve to the
      // secondary tile.  That tile is pathfinder-blocked, so latching
      // tileX onto it would corrupt the next path call and trigger the
      // snap-back below.  Skip the sync; the explicit commit at line
      // 587-588 will set tileX once the entity reaches the wp.
      if (this._dungeonGrid.isDoorBlocked?.(newTileX, newTileY)) {
        // intentionally skip tile sync this frame
      } else if (newTileX !== adv.tileX || newTileY !== adv.tileY) {
        // Defensive: if smoothing/precision somehow puts us in a non-walkable
        // tile, snap back to the last good tile center and force a re-path.
        // Prevents the "stuck in walls" state when an LOS edge case slips
        // through.
        const tilesGuard = this._dungeonGrid.getTiles?.()
        const guardRow   = tilesGuard?.[newTileY]
        if (!guardRow || !PathfinderSystem.isWalkable(guardRow[newTileX])) {
          adv.worldX = adv.tileX * TS + TS / 2
          adv.worldY = adv.tileY * TS + TS / 2
          adv.path = null
          return
        }
        const oldKey = `${adv.tileX},${adv.tileY}`
        if (this._occupancy?.[oldKey] === adv.instanceId) delete this._occupancy[oldKey]
        adv.tileX = newTileX
        adv.tileY = newTileY
        if (this._occupancy) this._occupancy[`${newTileX},${newTileY}`] = adv.instanceId
        this._maybeOpenDoorAt(newTileX, newTileY)
      }
    }
  }

  // Trigger the split-open animation when an adventurer first steps onto a
  // DOOR cell whose connection point is still closed. Idempotent — a cp
  // already opening or open is left alone. The animation tick in
  // DungeonRenderer.update advances the progress and flips cp.open=true.
  _maybeOpenDoorAt(tx, ty) {
    const found = this._dungeonGrid.getCpForDoorTile?.(tx, ty)
    if (!found) return
    const { cp } = found
    if (cp.open || cp.opening) return
    cp.opening = true
    cp.openProgress = 0
    EventBus.emit('DOOR_OPENING', { cp })
  }

  // Walkable line-of-sight check — Amanatides-Woo grid traversal that visits
  // every tile the line from (sx,sy) to (tx,ty) actually crosses, plus both
  // neighbors at exact corner grazes. Returns false if any visited tile is
  // non-walkable so path smoothing never cuts through wall corners or clips
  // diagonals through 1-tile-wide walls (the bug a naive sampled LOS hits).
  _losClear(sx, sy, tx, ty, tiles) {
    const x0 = sx / TS, y0 = sy / TS
    const x1 = tx / TS, y1 = ty / TS
    const dx = x1 - x0, dy = y1 - y0
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return true

    const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0)
    const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0)
    const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx)
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy)
    let cx = Math.floor(x0), cy = Math.floor(y0)
    const endCx = Math.floor(x1), endCy = Math.floor(y1)
    let tMaxX = stepX === 0 ? Infinity
      : ((stepX > 0 ? Math.floor(x0) + 1 : Math.floor(x0)) - x0) / dx
    let tMaxY = stepY === 0 ? Infinity
      : ((stepY > 0 ? Math.floor(y0) + 1 : Math.floor(y0)) - y0) / dy

    const walkable = (x, y) => {
      const row = tiles[y]
      return !!row && PathfinderSystem.isWalkable(row[x])
    }
    if (!walkable(cx, cy)) return false

    // Bound iterations so a degenerate input can't loop forever.
    const maxSteps = Math.abs(endCx - cx) + Math.abs(endCy - cy) + 4
    for (let i = 0; i < maxSteps; i++) {
      if (cx === endCx && cy === endCy) return true
      if (Math.abs(tMaxX - tMaxY) < 1e-9) {
        // Exact corner graze — both diagonal neighbors of the corner must
        // be walkable, otherwise the line clips a wall corner.
        if (!walkable(cx + stepX, cy)) return false
        if (!walkable(cx, cy + stepY)) return false
        cx += stepX; cy += stepY
        tMaxX += tDeltaX; tMaxY += tDeltaY
      } else if (tMaxX < tMaxY) {
        cx += stepX
        tMaxX += tDeltaX
      } else {
        cy += stepY
        tMaxY += tDeltaY
      }
      if (!walkable(cx, cy)) return false
    }
    return true
  }

  // ── Combat / Flee helpers ──────────────────────────────────────────────────

  _findEngageableMinion(adv) {
    // Phase 5c — ranged classes (Mage / Cleric / Necromancer / Ranger / Bard)
    // engage at their declared attackRange instead of melee. Falls back to
    // MELEE_RANGE_TILES (1.5) for melee classes.
    const reach = Math.max(adv.attackRange ?? 1, Balance.MELEE_RANGE_TILES)
    let best = null, bestDist = Infinity
    for (const m of this._gameState.minions) {
      if (m.aiState === 'dead' || m.resources.hp <= 0) continue
      if (m.faction === 'adventurer') continue
      if (adv.flags?.idolizedMinionClass === m.definitionId) continue
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d > reach + 0.01) continue
      // Phase 8: any minion within engagement range is also "observed"
      this._knowledgeSystem?.observeMinion(adv, m)
      if (d < bestDist) { best = m; bestDist = d }
    }
    return best
  }

  _checkFleeTrigger(adv) {
    if (adv.goal?.type === 'FLEE') return  // already fleeing
    // Skip while undamaged — for very cowardly personalities (traumatized
    // has fleeThreshold 0.95) the threshold + FLEE_BUFFER otherwise
    // exceeds 1.0 and triggers every tick at spawn, freezing them at
    // entry where their flee target == their current tile.
    if (adv.resources.hp >= adv.resources.maxHp) {
      adv._fleeRolled = false
      return
    }
    const hpFrac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
    const threshold = this._personalitySystem
      ? (this._personalitySystem.getWeights(adv).fleeThreshold ?? 0.5)
      : 0.3
    if (hpFrac <= threshold + Balance.FLEE_BUFFER) {
      // 50% chance to ignore the trigger — roll once per threshold crossing,
      // not every tick (otherwise repeated rolls converge to ~100% flee).
      // Flag clears when HP recovers above threshold so a future drop re-rolls.
      if (adv._fleeRolled) return
      adv._fleeRolled = true
      if (Math.random() < 0.5) return
      this._setFleeGoal(adv)
    } else {
      adv._fleeRolled = false
    }
  }

  _setFleeGoal(adv, reason = 'low_hp_retreat') {
    // Phase 5c — Barbarian Unstoppable: immune to ALL flee triggers.
    if (adv.classId === 'barbarian') return

    // Phase 5c — partial-retreat option. For "soft" panic reasons
    // (coward_panic, low_hp_retreat) there's a 50% chance the adv pulls
    // back to a known safer room and resumes exploring from there instead
    // of bolting all the way to the entry hall. Hard panics (raid leader
    // fell, traumatized sole survivor, out of arrows, goal_unreachable)
    // still go straight for the door.
    const SOFT_PANIC = reason === 'coward_panic' || reason === 'low_hp_retreat'
    if (SOFT_PANIC && Math.random() < 0.5) {
      const safe = this._findSafeRetreatRoom(adv)
      if (safe) {
        adv.goal = { type: 'TACTICAL_RETREAT', roomId: safe.instanceId, fromReason: reason }
        adv.aiState = 'walking'
        adv.path = null
        return
      }
    }

    adv.goal = { type: 'FLEE', reason }
    adv.aiState = 'fleeing'
    adv.path = null
  }

  // Phase 5c — pick a "safer" already-visited room to fall back to. "Safer"
  // means no hostile minions within 4 tiles of the room center AND the room
  // isn't the one the adv currently stands in. Prefers rooms farthest from
  // the current threat. Returns null if nothing qualifies.
  _findSafeRetreatRoom(adv) {
    const rooms = this._gameState.dungeon?.rooms ?? []
    const visited = adv.visitedRooms ?? []
    const currentRoom = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    let best = null, bestDist = -1
    for (const room of rooms) {
      if (currentRoom && room.instanceId === currentRoom.instanceId) continue
      // Only retreat to rooms we've actually been to before — fleeing into
      // the unknown defeats the point of "tactical retreat."
      if (!visited.includes(room.instanceId)) continue
      // Don't retreat to entry_hall — that's just normal flee with extra steps.
      if (room.definitionId === 'entry_hall') continue
      const cx = room.gridX + Math.floor(room.width  / 2)
      const cy = room.gridY + Math.floor(room.height / 2)
      // Reject rooms with a hostile minion close to the center.
      const tooClose = (this._gameState.minions ?? []).some(m => {
        if (m.aiState === 'dead' || m.resources?.hp <= 0) return false
        if (m.faction === 'adventurer') return false
        const d = Math.hypot(m.tileX - cx, m.tileY - cy)
        return d <= 4
      })
      if (tooClose) continue
      // Prefer rooms farthest from the current adv tile (more space between
      // them and whatever spooked them).
      const dist = Math.hypot(adv.tileX - cx, adv.tileY - cy)
      if (dist > bestDist) { best = room; bestDist = dist }
    }
    return best
  }

  // Phase 6e: SLEEP goal — adventurer naps in a safe room to recover HP slowly.
  // Triggered when:
  //   - HP fraction is low (≤ LOW_HP_THRESHOLD)
  //   - No hostile minions in same room (SLEEP_REQUIRES_NO_HOSTILES)
  //   - HP < maxHp
  // While sleeping, aiState='sleeping', they don't move/attack. Damage from any
  // source breaks sleep (handled implicitly — _checkFleeTrigger runs on incoming hits).
  _shouldSleep(adv) {
    if (adv.aiState === 'fleeing') return false
    if (adv.resources.hp >= adv.resources.maxHp) return false
    // Inner Peace already regenerates the Monk; layering Sleep on top freezes
    // them in place ("stuck while inner peace is active").
    if (adv._innerPeaceUntil && this._scene.time.now < adv._innerPeaceUntil) return false
    const hpFrac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
    if (hpFrac > Balance.LOW_HP_THRESHOLD) return false
    if (Balance.SLEEP_REQUIRES_NO_HOSTILES && this._anyHostileMinionInRoom(adv)) return false
    return true
  }

  _sleep(adv, delta) {
    adv.aiState = 'sleeping'
    adv.path = null   // stop moving
    // Phase 9: noHealthRegen mechanic blocks all sleep healing
    const flags = this._gameState._mechanicFlags ?? {}
    const rate = flags.noHealthRegen ? 0 : (Balance.SLEEP_HP_PER_SEC ?? 3)
    adv.resources.hp = Math.min(
      adv.resources.maxHp,
      adv.resources.hp + (rate * delta) / 1000
    )
    if (adv.resources.hp >= adv.resources.maxHp) {
      adv.aiState = 'walking'   // wake up at full HP
      // Phase 9: emit so memory_fog mechanic can degrade their knowledge
      EventBus.emit('ADVENTURER_SLEPT', { adventurer: adv })
    }
  }

  // Phase 8b: per-adventurer path sampling for Replay Ghost rendering
  _samplePath(adv, delta) {
    adv.pathHistory ??= []
    adv._pathSampleAccum = (adv._pathSampleAccum ?? 0) + delta
    if (adv._pathSampleAccum < Balance.REPLAY_PATH_SAMPLE_MS) return
    adv._pathSampleAccum = 0
    adv.pathHistory.push({ x: adv.tileX, y: adv.tileY, day: this._gameState.meta.dayNumber })
    if (adv.pathHistory.length > Balance.REPLAY_PATH_MAX_SAMPLES) {
      adv.pathHistory.shift()
    }
  }

  // Phase 6e: passive room effects driven by definitionId.
  // Healing Fountain restores HP slowly while standing in it (and not in combat).
  _applyRoomEffects(adv, delta) {
    const room = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    if (!room || room.isActive === false) return

    // Phase QW — Prison Block: 30% chance on first entry to "detain" the
    // adventurer (frozen for 5s of game-time). Heralded by ADVENTURER_DETAINED
    // so combat log can mention it. Once detained, they sit until expiry.
    if (room.definitionId === 'prison_block') {
      adv.flags = adv.flags ?? {}
      const enteredKey = `_prisonChecked_${room.instanceId}`
      if (!adv.flags[enteredKey]) {
        adv.flags[enteredKey] = true
        if (Math.random() < 0.3) {
          adv.flags.detainedUntil = this._scene.time.now + 5000
          EventBus.emit('ADVENTURER_DETAINED', { adventurer: adv, roomId: room.instanceId })
        }
      }
      // While detained, freeze movement
      if (adv.flags.detainedUntil && this._scene.time.now < adv.flags.detainedUntil) {
        adv.path = null
        adv.aiState = 'detained'
        return
      } else if (adv.flags.detainedUntil) {
        adv.flags.detainedUntil = null
      }
    }

    // Phase QW — Serpent Pit: 2 HP/sec poison while standing in it
    if (room.definitionId === 'serpent_pit') {
      const dmg = (2 * delta) / 1000
      adv.resources.hp = Math.max(0, adv.resources.hp - dmg)
      adv._lastHitType = 'poison'
      return
    }

    // Phase QW — Obelisk Room: alternates between HEAL and CHARGE states every 6 s.
    // We store the toggle on the room itself so all advs see the same phase.
    if (room.definitionId === 'obelisk_room') {
      room._obeliskAccum = (room._obeliskAccum ?? 0) + delta
      if (room._obeliskAccum >= 6000) {
        room._obeliskAccum = 0
        room._obeliskState = (room._obeliskState === 'charge') ? 'heal' : 'charge'
      }
      const state = room._obeliskState ?? 'heal'
      if (state === 'heal' && adv.aiState !== 'fighting' && adv.resources.hp < adv.resources.maxHp) {
        adv.resources.hp = Math.min(adv.resources.maxHp, adv.resources.hp + (2 * delta) / 1000)
      } else if (state === 'charge') {
        adv.flags = adv.flags ?? {}
        adv.flags.obeliskChargedNextAttack = true
      }
      return
    }

    // Phase 10b — Lava Floor: 3 HP/sec passive fire damage
    if (room.definitionId === 'lava_floor') {
      const dmg = (3 * delta) / 1000
      adv.resources.hp = Math.max(0, adv.resources.hp - dmg)
      adv._lastHitType = 'fire'
      return
    }

    // Phase 10b — Collapsing Pillars: every ~4 s, hit one random adventurer in the room for 8 dmg
    if (room.definitionId === 'collapsing_pillars') {
      adv._collapseAccum = (adv._collapseAccum ?? 0) + delta
      if (adv._collapseAccum >= 4000) {
        adv._collapseAccum = 0
        if (Math.random() < 0.5) {
          adv.resources.hp = Math.max(0, adv.resources.hp - 8)
          adv._lastHitType = 'physical'
          EventBus.emit('PILLAR_FALLEN', { adventurer: adv, roomId: room.instanceId })
        }
      }
      return
    }

    if (room.definitionId === 'healing_fountain') {
      const flags = this._gameState._mechanicFlags ?? {}
      if (flags.cursedFountains) {
        // Phase 9: Cursed Fountains — healing fountain damages instead
        const rate = Balance.MECHANIC_CURSED_FOUNTAIN_DAMAGE_PER_SEC ?? 4
        const dmg = (rate * delta) / 1000
        adv.resources.hp = Math.max(0, adv.resources.hp - dmg)
        adv._lastHitType = 'curse'
      } else if (adv.aiState !== 'fighting' && adv.resources.hp < adv.resources.maxHp) {
        const rate = Balance.HEALING_FOUNTAIN_HP_PER_SEC ?? 4
        adv.resources.hp = Math.min(
          adv.resources.maxHp,
          adv.resources.hp + (rate * delta) / 1000
        )
      }
    }
  }

  // Phase 6e: resource depletion → leave dungeon.
  // Rangers without arrows have no offensive option (until the Volley/Trap-
  // Expert rework removes arrow consumption). Mage flee-on-empty-mana removed
  // along with the mana system in Phase 5b.
  _resourceExhaustedShouldFlee(adv) {
    if (adv.aiState === 'fleeing') return false
    if (adv.classId === 'ranger') {
      const arrows = adv.resources?.arrows ?? 0
      if (arrows <= 0 && this._anyHostileMinionInRoom(adv)) return true
    }
    return false
  }

  _lootInSameRoom(adv) {
    const room = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    if (!room) return false
    return (this._gameState.loot?.dungeon ?? []).some(i => i.dungeonRoomId === room.instanceId)
  }

  _anyHostileMinionInRoom(adv) {
    const room = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    if (!room) return false
    return this._gameState.minions.some(m =>
      m.aiState !== 'dead' &&
      m.faction !== 'adventurer' &&
      m.assignedRoomId === room.instanceId
    )
  }

  // Coward: flees the moment a hostile minion is in the same room.
  _cowardShouldFlee(adv) {
    if (adv.aiState === 'fleeing') return false
    const tags = this._personalitySystem?.getTags(adv) ?? new Set()
    if (!tags.has('coward')) return false
    // Phase 5c — proximity-based instead of "any minion in this room."
    // Previously cowards bolted the moment they spawned into a room that
    // happened to contain a placed minion (even one tile away in a 14×14
    // chamber). Now they only flee when a hostile minion is genuinely
    // within sight (≤ 4 tiles), so they at least walk a few tiles before
    // panicking.
    const SIGHT = 4
    return this._gameState.minions.some(m => {
      if (m.aiState === 'dead' || m.resources?.hp <= 0) return false
      if (m.faction === 'adventurer') return false   // friendly defectors don't scare them
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      return d <= SIGHT
    })
  }

  // Cleric heal target: same-party ally below HP threshold, in heal range, alive.
  _findHealTarget(cleric) {
    const partyId = cleric.partyId
    let best = null, bestFrac = Infinity
    for (const adv of this._gameState.adventurers.active) {
      if (adv === cleric) continue
      if (adv.aiState === 'dead' || adv.resources.hp <= 0) continue
      if (partyId && adv.partyId !== partyId) continue
      const frac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
      if (frac > Balance.CLERIC_HEAL_TARGET_THRESHOLD) continue
      const d = Math.hypot(adv.tileX - cleric.tileX, adv.tileY - cleric.tileY)
      if (d > Balance.HEAL_RANGE_TILES + 0.01) continue
      if (frac < bestFrac) { best = adv; bestFrac = frac }
    }
    return best
  }

  // Beast tamer attempt: returns true if the attempt was made (success OR fail uses the turn).
  // Returns false when on cooldown — in that case AI falls through to standard attack.
  // Note: this remains tag-driven for now; the Beast Master class rework will
  // replace it with the new ability-system Tame Beast (50% success, single
  // companion enforcement).
  _tryTame(adv, target) {
    const now = this._scene.time.now
    const last = adv._lastTameAt ?? 0
    if (now - last < Balance.TAME_COOLDOWN_MS) return false
    if (target.faction === 'adventurer') return false  // already tamed
    const dist = Math.hypot(target.tileX - adv.tileX, target.tileY - adv.tileY)
    if (dist > Balance.TAME_RANGE_TILES + 0.01) return false

    adv._lastTameAt = now

    if (Math.random() < Balance.TAME_SUCCESS_RATE) {
      // Success — defect
      target.faction          = 'adventurer'
      target.factionExpiresOn = this._gameState.meta.dayNumber
      target.tamedByAdvId     = adv.instanceId
      target.currentTargetId  = null
      EventBus.emit('MINION_TAMED', { minion: target, tamer: adv })
    } else {
      EventBus.emit('TAME_FAILED', { minion: target, tamer: adv })
    }
    return true
  }

  // Paranoid types apply a movement speed reduction in non-starter rooms
  // (proxy for "unfamiliar" until knowledge system in Phase 8).
  _paranoidSpeedMultiplier(adv) {
    const tags = this._personalitySystem?.getTags(adv) ?? new Set()
    if (!tags.has('paranoid')) return 1
    const room = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    if (!room) return 1
    // "Familiar" rooms = the starter set
    const isFamiliar = (room.definitionId ?? '').startsWith('starter_')
    return isFamiliar ? 1 : Balance.PARANOID_SPEED_MULTIPLIER
  }

  // Phase 5c — Bard Song of Speed: returns 1.20 if a same-party Bard within
  // 2 tiles has an active speed-song buff, else 1. The Bard themselves get
  // the buff while their own song is active.
  _songOfSpeedMul(adv) {
    const advs = this._gameState.adventurers?.active ?? []
    const now  = this._scene.time.now
    for (const bard of advs) {
      if (bard.classId !== 'bard') continue
      if (!bard._songSpeedActiveUntil || now >= bard._songSpeedActiveUntil) continue
      if (bard !== adv) {
        if (!bard.partyId || bard.partyId !== adv.partyId) continue
      }
      const d = Math.hypot(adv.tileX - bard.tileX, adv.tileY - bard.tileY)
      if (d > 2.01) continue
      return 1.20
    }
    return 1
  }

  // ── Goal handling ──────────────────────────────────────────────────────────

  _goalToTile(adv) {
    const dungeon = this._gameState.dungeon
    if (adv.goal.type === 'SEEK_BOSS') {
      const boss = dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
      if (!boss) return null
      return {
        x: boss.gridX + Math.floor(boss.width  / 2),
        y: boss.gridY + Math.floor(boss.height / 2),
      }
    }
    if (adv.goal.type === 'EXPLORE_ROOM') {
      const room = dungeon.rooms.find(r => r.instanceId === adv.goal.roomId)
      if (!room) return null
      return {
        x: room.gridX + Math.floor(room.width  / 2),
        y: room.gridY + Math.floor(room.height / 2),
      }
    }
    if (adv.goal.type === 'SEEK_LOOT') {
      const item = (dungeon.loot?.dungeon ?? this._gameState.loot.dungeon)
        .find(i => i.instanceId === adv.goal.itemId)
      if (!item || item.tileX == null) {
        // Loot already picked up or vanished — fall back to boss
        adv.goal = { type: 'SEEK_BOSS' }
        return this._goalToTile(adv)
      }
      return { x: item.tileX, y: item.tileY }
    }
    if (adv.goal.type === 'SEEK_VENDETTA') {
      // Hunter targets the specific minion. If that minion is dead/missing, fall back to boss.
      const targetMinion = this._gameState.minions.find(m => m.instanceId === adv.goal.minionId && m.aiState !== 'dead')
      if (!targetMinion) {
        adv.goal = { type: 'SEEK_BOSS' }
        const boss = dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
        if (!boss) return null
        return { x: boss.gridX + Math.floor(boss.width  / 2), y: boss.gridY + Math.floor(boss.height / 2) }
      }
      return { x: targetMinion.tileX, y: targetMinion.tileY }
    }
    if (adv.goal.type === 'FOLLOW_LEADER') {
      // Phase 10 — Echo: follow the leader's CURRENT tile every replan
      const leader = this._gameState.adventurers.active.find(a => a.instanceId === adv.goal.leaderId)
      if (!leader || leader.aiState === 'dead') {
        // Leader is gone — fall back to boss
        adv.goal = { type: 'SEEK_BOSS' }
        return this._goalToTile(adv)
      }
      return { x: leader.tileX, y: leader.tileY }
    }
    if (adv.goal.type === 'DEFEND_ALLY') {
      // Phase QW — party_loyal: stand on/next to the wounded ally
      const ally = this._gameState.adventurers.active.find(a => a.instanceId === adv.goal.allyId)
      if (!ally || ally.aiState === 'dead' || (ally.resources.hp / Math.max(1, ally.resources.maxHp)) >= 0.6) {
        // Ally died or recovered — back to normal goals
        adv.goal = this._pickNextGoal(adv)
        return this._goalToTile(adv)
      }
      return { x: ally.tileX, y: ally.tileY }
    }
    if (adv.goal.type === 'FLEE') {
      // Always target the entry hall's north entrance — that's the canonical
      // exit. Pathfinder routes from each adventurer's current tile, so two
      // fleeing advs at different positions still find their own shortest
      // route to the door.
      const entry = dungeon.rooms.find(r => r.definitionId === 'entry_hall')
      if (!entry) return null
      return _entryNorthTile(entry)
    }
    if (adv.goal.type === 'TACTICAL_RETREAT') {
      // Phase 5c — head to the chosen safer visited room. If the room was
      // removed mid-retreat (player undo, etc.) fall back to FLEE so the
      // adv at least heads home.
      const room = dungeon.rooms.find(r => r.instanceId === adv.goal.roomId)
      if (!room) {
        adv.goal = { type: 'FLEE', reason: adv.goal.fromReason ?? 'retreat_room_gone' }
        adv.aiState = 'fleeing'
        return this._goalToTile(adv)
      }
      return {
        x: room.gridX + Math.floor(room.width  / 2),
        y: room.gridY + Math.floor(room.height / 2),
      }
    }
    return null
  }

  _onGoalReached(adv, idx) {
    if (adv.goal.type === 'EXPLORE_ROOM') {
      adv.visitedRooms ??= []
      if (!adv.visitedRooms.includes(adv.goal.roomId)) {
        adv.visitedRooms.push(adv.goal.roomId)
      }
      // Note: per-tick room-change detection in _tickAdventurer already
      // emitted ADVENTURER_ROOM_CHANGED when the adventurer first crossed
      // into this room — no need to re-emit here. (Was a duplicate.)
      adv.goal = this._pickNextGoal(adv)
      return
    }

    if (adv.goal.type === 'SEEK_BOSS') {
      // Phase 10: hand control to BossSystem. Adventurer freezes in place at
      // boss-chamber threshold; BossSystem auto-resolves the fight.
      adv.goal = { type: 'AT_BOSS' }
      adv.path = null
      adv.aiState = 'fighting'
      EventBus.emit('BOSS_FIGHT_INCOMING', { adventurer: adv })
      return
    }
    if (adv.goal.type === 'AT_BOSS') {
      // Frozen — BossSystem will kill or flee them when the fight resolves
      adv.path = null
      return
    }

    if (adv.goal.type === 'FOLLOW_LEADER') {
      // Reached the leader's tile — replan to track their next move
      adv.goal = this._pickNextGoal(adv)
      return
    }

    if (adv.goal.type === 'DEFEND_ALLY') {
      // Stayed by the ally; the per-tick check decides when to release the goal
      return
    }

    if (adv.goal.type === 'FLEE') {
      // _tickAdventurer's per-tick "in entry" check handles the actual
      // splice on arrival.  Just clear the path so the next tick picks a
      // fresh route if we ended up somewhere other than entry.
      adv.path = null
      return
    }

    if (adv.goal.type === 'TACTICAL_RETREAT') {
      // Phase 5c — arrived at the safer room. Mark it visited (it should be
      // already), then resume normal exploration from here. The next
      // _pickNextGoal will pick an unvisited room or SEEK_BOSS depending on
      // personality / state.
      adv.visitedRooms ??= []
      if (!adv.visitedRooms.includes(adv.goal.roomId)) {
        adv.visitedRooms.push(adv.goal.roomId)
      }
      adv.aiState = 'walking'
      adv.path = null
      adv.goal = this._pickNextGoal(adv)
      EventBus.emit('ADVENTURER_TACTICAL_RETREAT_DONE', { adventurer: adv })
      return
    }

    // Phase 7b: SEEK_LOOT — pick up the item, gain its bonuses, pick next goal
    if (adv.goal.type === 'SEEK_LOOT') {
      const itemId = adv.goal.itemId
      const lootList = this._gameState.loot.dungeon
      const lootIdx = lootList.findIndex(i => i.instanceId === itemId)
      if (lootIdx >= 0) {
        const item = lootList[lootIdx]
        lootList.splice(lootIdx, 1)
        // Room redesign 2026-04-30 — Treasury chest: don't equip, attach
        // as carriedChest. Adventurer must escape alive to actually steal
        // the essence (resolved in the FLEE/atNorthEdge block above).
        if (item._treasuryChest) {
          adv.carriedChest = {
            value:             item._essenceValue ?? 0,
            sourceTreasuryId:  item._sourceTreasuryId ?? null,
            grabbedDay:        this._gameState.meta.dayNumber,
          }
          EventBus.emit('TREASURY_CHEST_GRABBED', {
            adventurer: adv,
            chest: item,
            value: adv.carriedChest.value,
          })
          // Force a flee — they got what they came for; head for the door.
          adv.goal = { type: 'FLEE', reason: 'chest_grabbed' }
          return
        }
        adv.gear ??= []
        adv.gear.push(item.instanceId)
        item.currentEquippedBy = adv.instanceId
        item.tileX = null; item.tileY = null
        EventBus.emit('GEAR_PICKED_UP', { item, adventurer: adv })
        // Phase QW — surface a generic LOOT_PICKED_UP for trap (greed_trap) hooks
        EventBus.emit('LOOT_PICKED_UP', {
          item,
          adventurer: adv,
          tileX: adv.tileX, tileY: adv.tileY,
          roomId: this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId ?? null,
        })
      }
      adv.goal = this._pickNextGoal(adv)
      return
    }
  }

  // Personality-driven goal selection.
  // Falls back to SEEK_BOSS if no PersonalitySystem is wired yet.
  _pickNextGoal(adv) {
    if (!this._personalitySystem) return { type: 'SEEK_BOSS' }

    // Phase 10 — Echo personality follows the most-recent non-echo party
    // member's tile. If their leader entered a trap, so does the echo.
    const tags = this._personalitySystem.getTags(adv)
    if (tags.has('echo')) {
      const leader = this._gameState.adventurers.active.find(a =>
        a.partyId === adv.partyId && a.instanceId !== adv.instanceId &&
        !this._personalitySystem.getTags(a).has('echo') && a.aiState !== 'dead'
      )
      if (leader) {
        return { type: 'FOLLOW_LEADER', leaderId: leader.instanceId, targetX: leader.tileX, targetY: leader.tileY }
      }
    }

    const visited = new Set(adv.visitedRooms ?? [])
    // Bug fix — adv.gear is an array of loot instanceId strings, not full
    // loot objects. Resolve through gameState.loot.dungeon to read the item.
    const dungeonLoot = this._gameState.loot?.dungeon ?? []
    const hasKey = (adv.gear ?? []).some(id => {
      const item = dungeonLoot.find(i => i.instanceId === id)
      return item?.type === 'key' || item?.definitionId === 'iron_key'
    })
    // Phase QW — secret rooms are invisible to most advs. Cartographers,
    // completionists, and anyone who's already visited can see them.
    const canSeeSecrets = tags.has('mapper') || tags.has('completionist')
    const unvisited = this._gameState.dungeon.rooms.filter(r =>
      !visited.has(r.instanceId) && r.definitionId !== 'boss_chamber' &&
      // Phase 10: skip locked rooms unless adventurer has a key
      (!r.locked || hasKey) &&
      // Phase QW: skip secret rooms unless adv is cartographer/completionist
      (r.definitionId !== 'secret_passage' || canSeeSecrets)
    )
    // Phase 7b: include floor loot for SEEK_LOOT goal evaluation
    let floorLoot = (this._gameState.loot?.dungeon ?? []).filter(i => i.tileX != null)
    // Phase QW — mimic_handler personality refuses suspect chests.
    if (tags.has('mimic_handler')) {
      floorLoot = floorLoot.filter(i => !i.isMimicSpawn)
    }
    return this._personalitySystem.evaluateGoal(adv, {
      unvisitedRooms: unvisited,
      floorLoot,
    })
  }

  // Public: called by DayPhase after spawning so the adventurer's first goal
  // reflects their personality (cartographer detours, reckless beelines, etc.)
  pickInitialGoal(adv) {
    // Don't re-explore the spawn room
    const spawnRoom = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    if (spawnRoom) {
      adv.visitedRooms ??= []
      if (!adv.visitedRooms.includes(spawnRoom.instanceId)) {
        adv.visitedRooms.push(spawnRoom.instanceId)
      }
    }
    // Phase 6d: the_fan picks a random minion class to idolize (refuses to attack it).
    if (adv.personalityIds?.includes('the_fan') && !adv.flags?.idolizedMinionClass) {
      const types = this._scene.cache.json.get('minionTypes') ?? []
      const choice = types[Math.floor(Math.random() * types.length)]
      if (choice) {
        adv.flags = adv.flags ?? {}
        adv.flags.idolizedMinionClass = choice.id
      }
    }
    adv.goal = this._pickNextGoal(adv)
    return adv.goal
  }

  // ── Death / despawn ────────────────────────────────────────────────────────

  _kill(adv, idx, killerHint) {
    // Phase 5c — Cleric Resurrection: if a same-party Cleric still has the
    // ability today, revive the falling adv at 30% HP and skip death.
    if (this._scene.classAbilitySystem?.attemptClericResurrect?.(adv)) {
      EventBus.emit('ADVENTURER_RESURRECTED', { adventurer: adv })
      return
    }
    adv.aiState = 'dead'
    adv.resources.hp = 0

    // Room redesign 2026-04-30 — Treasury chest reclaimed on death. The
    // adventurer never made it out; player keeps the essence. Chest itself
    // is gone; refill happens at next Night Phase.
    if (adv.carriedChest) {
      EventBus.emit('TREASURY_CHEST_RECLAIMED', {
        adventurer: adv,
        value: adv.carriedChest.value,
        sourceTreasuryId: adv.carriedChest.sourceTreasuryId,
      })
      adv.carriedChest = null
    }

    // Death attribution: prefer the most-recent combat-hit source, fall back to hint
    const killerId   = adv._lastHitBy ?? killerHint
    const killerName = this._lookupKillerName(killerId)
    const damageType = adv._lastHitType ?? 'physical'

    this._gameState.adventurers.active.splice(idx, 1)
    this._gameState.adventurers.graveyard.push({
      ...adv,
      diedOnDay:  this._gameState.meta.dayNumber,
      killedBy:   killerId,
      killerName,
      damageType,
    })

    // Phase 6e: archetype essenceGainMultiplier (e.g. Lich 1.2×)
    const arch = this._gameState.player?.archetypeModifiers
    let essMul = arch?.essenceGainMultiplier ?? 1
    // Phase 9: Taxation of Souls reduces essence yield (already-weakened victim)
    const flags = this._gameState._mechanicFlags ?? {}
    if (flags.taxationOfSouls) essMul *= Balance.MECHANIC_TAXATION_ESSENCE_PENALTY
    this._gameState.player.soulEssence += Math.round(Balance.SOUL_ESSENCE_PER_KILL * essMul)
    this._gameState.player.darkPower   += Balance.DARK_POWER_PER_KILL
    this._gameState.player.totalKills++

    // Phase 7b: dungeon level progression — check whether the new kill total
    // crossed the next-level threshold.
    this._checkDungeonLevelUp()

    EventBus.emit('ADVENTURER_DIED', {
      adventurer: adv,
      killerId,
      killerName,
      roomId:     this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId ?? null,
      damageType,
    })
  }

  // Phase 7b: increment meta.dungeonLevel when cumulative kills crosses the curve.
  // Curve: kills needed to reach lv N = BASE * SCALE^(N-2), summed.
  _checkDungeonLevelUp() {
    const lv = this._gameState.meta.dungeonLevel ?? 1
    if (lv >= Balance.DUNGEON_LEVEL_MAX) return
    const totalKills = this._gameState.player.totalKills
    const required = this._cumulativeKillsForLevel(lv + 1)
    if (totalKills >= required) {
      this._gameState.meta.dungeonLevel = lv + 1
      EventBus.emit('DUNGEON_LEVELED_UP', { newLevel: lv + 1, totalKills })
    }
  }

  _cumulativeKillsForLevel(targetLevel) {
    let total = 0
    for (let n = 2; n <= targetLevel; n++) {
      total += Math.round(
        Balance.DUNGEON_LEVEL_KILLS_BASE * Math.pow(Balance.DUNGEON_LEVEL_KILLS_SCALE, n - 2)
      )
    }
    return total
  }

  _lookupKillerName(killerId) {
    if (!killerId) return 'Unknown'
    if (killerId === 'boss') {
      const archId = this._gameState.player?.bossArchetypeId
      const arch   = this._scene.cache.json.get('bossArchetypes')
        ?.find(a => a.id === archId)
      return arch?.name ?? 'The Boss'
    }
    // Trap?
    const trap = this._gameState.dungeon?.traps?.find(t => t.instanceId === killerId)
    if (trap) {
      return this._scene.cache.json.get('trapTypes')
        ?.find(d => d.id === trap.definitionId)?.name ?? trap.definitionId
    }
    // Minion?
    const m = this._gameState.minions.find(x => x.instanceId === killerId)
    if (m) return m.name ?? this._scene.cache.json.get('minionTypes')
      ?.find(d => d.id === m.definitionId)?.name ?? m.definitionId
    // Bug fix — adventurer killer (greedy brawls in LootGreedSystem can produce
    // adv-on-adv deaths). Fall back to active list, then graveyard for fallen
    // brawlers who died after their target.
    const adv = this._gameState.adventurers.active.find(a => a.instanceId === killerId) ??
                this._gameState.adventurers.graveyard.find(a => a.instanceId === killerId)
    if (adv) return `${adv.name ?? 'A Rival'} (rival adventurer)`
    return 'Unknown'
  }

  _despawn(adv, idx, reason) {
    adv.aiState = 'fled'
    this._gameState.adventurers.active.splice(idx, 1)
    EventBus.emit('ADVENTURER_FLED', { adventurer: adv, reason })
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  // Pick a spawn tile for a new adventurer.
  // Strategy: walk outward from each room's connection point until we find a
  // walkable tile that has a path back to the boss. Falls back to the deepest
  // room's centre. Returns null if dungeon is unreachable from outside.
  // Adventurers always enter through the Entry Hall — that's the contract.
  // Returns the centre tile of the entry_hall if it exists AND has a valid
  // path to the boss chamber. Returns null otherwise (caller should block
  // day-start in that case).
  pickSpawnTile() {
    const dungeon = this._gameState.dungeon
    const boss = dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
    if (!boss) return null

    const entry = dungeon.rooms.find(r => r.definitionId === 'entry_hall')
    if (!entry) return null

    const candidate = _entryNorthTile(entry)
    const bossCentre = {
      x: boss.gridX + Math.floor(boss.width  / 2),
      y: boss.gridY + Math.floor(boss.height / 2),
    }
    const path = PathfinderSystem.findPath(candidate, bossCentre, this._dungeonGrid)
    if (!path || path.length === 0) return null
    return candidate
  }

}

function _pointInRoom(tx, ty, room) {
  return tx >= room.gridX && tx < room.gridX + room.width &&
         ty >= room.gridY && ty < room.gridY + room.height
}

// Dungeon-coords tile of the entry hall's north entrance — used as both the
// spawn point (adventurers walk in from the north) and the exit gate (fleeing
// advs must reach this row to escape). Falls back to the top-row centre if
// the entry_hall has no explicit north connection point.
function _entryNorthTile(entry) {
  const cp = (entry.connectionPoints ?? []).find(c => c.direction === 'N')
  const localX = cp ? cp.x : Math.floor(entry.width / 2)
  return { x: entry.gridX + localX, y: entry.gridY }
}

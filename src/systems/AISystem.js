// Per-tick adventurer AI.
// Phase 4: walk to boss → instant kill on arrival.
// Phase 5: personality-driven goal selection + EXPLORE_ROOM detours.
// Phase 6 (kernel): real combat with minions, FLEE goal, mid-dungeon death.

import { EventBus }         from './EventBus.js'
import { PathfinderSystem } from './PathfinderSystem.js'
import { Balance }          from '../config/balance.js'

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

  // When a minion dies, see if a nearby necromancer can raise it.
  _onMinionDied({ minion }) {
    if (!minion) return
    if (minion.faction === 'adventurer') return  // don't raise an already-defected corpse

    const room = this._dungeonGrid.getRoomAtTile(minion.tileX, minion.tileY)
    if (!room) return

    const today = this._gameState.meta.dayNumber

    for (const adv of this._gameState.adventurers.active) {
      if (adv.classId !== 'necromancer') continue
      if (adv.aiState === 'dead' || adv.resources.hp <= 0) continue
      if (!_pointInRoom(adv.tileX, adv.tileY, room)) continue
      // (helper defined at bottom of file)
      const d = Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY)
      if (d > Balance.NECROMANCER_RAISE_RANGE) continue
      // Daily quota
      if (adv._raisesUsedDay !== today) {
        adv._raisesUsedDay = today
        adv._raisesUsedCount = 0
      }
      if (adv._raisesUsedCount >= Balance.NECROMANCER_RAISES_PER_DAY) continue
      // Mana check
      if ((adv.resources.mana ?? 0) < Balance.NECROMANCER_RAISE_MANA_COST) continue

      // Resurrect on the adventurer's faction
      adv.resources.mana -= Balance.NECROMANCER_RAISE_MANA_COST
      adv._raisesUsedCount = (adv._raisesUsedCount ?? 0) + 1

      minion.faction          = 'adventurer'
      minion.factionExpiresOn = today
      minion.raisedByAdvId    = adv.instanceId
      minion.resources.hp     = Math.max(1, Math.floor(minion.resources.maxHp * Balance.NECROMANCER_RAISE_HP_FRACTION))
      minion.aiState          = 'idle'
      minion.deathDay         = null
      minion.currentTargetId  = null

      EventBus.emit('MINION_RAISED', { minion, raiser: adv })
      return
    }
  }

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

  // ── Per-adventurer tick ─────────────────────────────────────────────────────

  _tickAdventurer(adv, delta, idx) {
    if (adv.aiState === 'dead') return
    if (adv.resources.hp <= 0) {
      this._kill(adv, idx, adv._lastHitBy ?? 'unknown')
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
    // (must have left at some point), leave the dungeon.
    if (adv.goal?.type === 'FLEE' && atNorthEdge && adv._leftEntry) {
      adv.aiState = 'fled'
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
    // Engage the boss as soon as we step into the chamber instead of waiting
    // for SEEK_BOSS pathfinding to land us at the room centre.  Mirrors the
    // fleeing-in-entry pattern above — the room boundary is the trigger.
    if (adv.goal?.type === 'SEEK_BOSS') {
      const bossRoom = this._gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
      if (bossRoom &&
          adv.tileX >= bossRoom.gridX && adv.tileX < bossRoom.gridX + bossRoom.width &&
          adv.tileY >= bossRoom.gridY && adv.tileY < bossRoom.gridY + bossRoom.height) {
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

    // Phase 6d: mage mana regen while standing still (or in idle states)
    this._regenManaIfIdle(adv, delta)

    // Phase 6c: detect coward seeing enemies — flee before engaging
    if (this._cowardShouldFlee(adv)) {
      this._setFleeGoal(adv, 'coward_panic')
    }

    // Phase 6e: resource depletion — mage out of mana or ranger out of arrows
    // decides to leave the dungeon to resupply.
    if (this._resourceExhaustedShouldFlee(adv)) {
      this._setFleeGoal(adv,
        adv.classId === 'mage' ? 'out_of_mana' : 'out_of_arrows')
    }

    // Phase 6c: HEAL goal — drink potion to recover HP
    if (this._shouldDrinkPotion(adv)) {
      this._drinkPotion(adv)
      return
    }

    // Phase 6e: SLEEP goal — if HP is moderate-low, no potions, no enemies in room,
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

    // Phase 6c: cleric heal — when an ally is below threshold, heal instead of fight
    if (adv.classId === 'cleric' && adv.aiState !== 'fleeing' && this._combatSystem) {
      const ally = this._findHealTarget(adv)
      if (ally) {
        adv.aiState = 'healing'
        adv.path = null
        this._combatSystem.tryHeal(adv, ally, {
          roomId: this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId,
        })
        return
      }
    }

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

        // Beast tamer: attempt tame on cooldown instead of attacking
        const tags = this._personalitySystem?.getTags(adv) ?? new Set()
        if (tags.has('beast_tamer')) {
          const attempted = this._tryTame(adv, enemy)
          if (attempted) {
            adv.aiState = 'fighting'  // visually "engaged"
            adv.path = null
            return
          }
        }

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
      const path = PathfinderSystem.findPath(
        { x: adv.tileX, y: adv.tileY }, target, this._dungeonGrid, costFn,
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

    // Move toward next waypoint
    const wp = adv.path[adv.pathIndex]
    const targetWX = wp.x * TS + TS / 2
    const targetWY = wp.y * TS + TS / 2
    const dx = targetWX - adv.worldX
    const dy = targetWY - adv.worldY
    const dist = Math.hypot(dx, dy)

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
    // Fleeing adventurers sprint — 1.5× their normal pace.  Sells the
    // "running away in panic" feel and helps unlucky lost-flee wanderers find
    // the entry hall faster.
    const fleeMul  = adv.aiState === 'fleeing' ? 1.5 : 1
    const stepPx   = (adv.stats.speed * speedMul * fleeMul * TS * delta) / 1000

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
      adv.pathIndex++

      if (adv.pathIndex >= adv.path.length) {
        adv.path = null
        this._onGoalReached(adv, idx)
      }
    } else {
      adv.worldX += (dx / dist) * stepPx
      adv.worldY += (dy / dist) * stepPx
    }
  }

  // ── Combat / Flee helpers ──────────────────────────────────────────────────

  _findEngageableMinion(adv) {
    const reach = Balance.MELEE_RANGE_TILES
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
    if (adv.resources.hp >= adv.resources.maxHp) return
    const hpFrac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
    const threshold = this._personalitySystem
      ? (this._personalitySystem.getWeights(adv).fleeThreshold ?? 0.5)
      : 0.3
    if (hpFrac <= threshold + Balance.FLEE_BUFFER) {
      this._setFleeGoal(adv)
    }
  }

  _setFleeGoal(adv, reason = 'low_hp_retreat') {
    adv.goal = { type: 'FLEE', reason }
    adv.aiState = 'fleeing'
    adv.path = null
  }

  // Phase 6e: SLEEP goal — adventurer naps in a safe room to recover HP slowly.
  // Triggered when:
  //   - HP fraction is low (≤ POTION_HEAL_THRESHOLD) AND no potions left
  //   - No hostile minions in same room (SLEEP_REQUIRES_NO_HOSTILES)
  //   - HP < maxHp
  // While sleeping, aiState='sleeping', they don't move/attack. Damage from any
  // source breaks sleep (handled implicitly — _checkFleeTrigger runs on incoming hits).
  _shouldSleep(adv) {
    if (adv.aiState === 'fleeing') return false
    if (adv.resources.hp >= adv.resources.maxHp) return false
    const hpFrac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
    if (hpFrac > Balance.POTION_HEAL_THRESHOLD) return false
    if ((adv.resources.potions ?? 0) > 0) return false   // prefer potions if available
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
  // Mages with no mana stop fleeing only if they have nothing left to do here;
  // rangers without arrows have no offensive option.
  _resourceExhaustedShouldFlee(adv) {
    if (adv.aiState === 'fleeing') return false
    if (adv.classId === 'mage') {
      const mana = adv.resources?.mana ?? 0
      // Only flee if BOTH mana is empty AND there's a hostile minion in the room
      // (so they don't flee from a peaceful build with idle mana).
      if (mana <= 0 && this._anyHostileMinionInRoom(adv)) return true
    }
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
    const room = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
    if (!room) return false
    return this._gameState.minions.some(m =>
      m.aiState !== 'dead' && m.assignedRoomId === room.instanceId
    )
  }

  // HEAL goal: when HP fraction <= POTION_HEAL_THRESHOLD and adventurer has potions,
  // sip a potion (instant) instead of fleeing immediately.
  _shouldDrinkPotion(adv) {
    if (adv.aiState === 'fleeing') return false
    const potions = adv.resources?.potions ?? 0
    if (potions <= 0) return false
    const hpFrac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
    return hpFrac <= Balance.POTION_HEAL_THRESHOLD && hpFrac > 0
  }

  _drinkPotion(adv) {
    adv.resources.potions = Math.max(0, (adv.resources.potions ?? 0) - 1)
    const before = adv.resources.hp
    adv.resources.hp = Math.min(
      adv.resources.maxHp,
      adv.resources.hp + Balance.POTION_HEAL_AMOUNT,
    )
    adv.aiState = 'healing'
    EventBus.emit('ALLY_HEALED', {
      sourceId: adv.instanceId,   // self-heal — counts as a heal action for mercy_trap
      targetId: adv.instanceId,
      amount:   adv.resources.hp - before,
      roomId:   this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId ?? null,
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

  // Mana regen while idle (standing on the same tile and not in combat).
  // Mages regen at MAGE_MANA_REGEN_PER_SEC; other classes don't.
  _regenManaIfIdle(adv, delta) {
    if (adv.classId !== 'mage') return
    if (adv.aiState === 'fighting' || adv.aiState === 'fleeing') return
    if (adv.resources.mana == null) return
    const max = adv.resources.maxMana ?? 30
    if (adv.resources.mana >= max) return
    // Standing still requirement: same tile two consecutive ticks
    if (adv._prevTileX === adv.tileX && adv._prevTileY === adv.tileY) {
      adv.resources.mana = Math.min(max,
        adv.resources.mana + (Balance.MAGE_MANA_REGEN_PER_SEC * delta) / 1000
      )
    }
  }

  // Beast tamer attempt: returns true if the attempt was made (success OR fail uses the turn).
  // Returns false when on cooldown or out of mana — in that case AI falls through to standard attack.
  _tryTame(adv, target) {
    const now = this._scene.time.now
    const last = adv._lastTameAt ?? 0
    if (now - last < Balance.TAME_COOLDOWN_MS) return false
    if ((adv.resources.mana ?? 0) < Balance.TAME_MANA_COST) return false
    if (target.faction === 'adventurer') return false  // already tamed
    const dist = Math.hypot(target.tileX - adv.tileX, target.tileY - adv.tileY)
    if (dist > Balance.TAME_RANGE_TILES + 0.01) return false

    adv._lastTameAt = now
    adv.resources.mana -= Balance.TAME_MANA_COST

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

    // Phase 7b: SEEK_LOOT — pick up the item, gain its bonuses, pick next goal
    if (adv.goal.type === 'SEEK_LOOT') {
      const itemId = adv.goal.itemId
      const lootList = this._gameState.loot.dungeon
      const lootIdx = lootList.findIndex(i => i.instanceId === itemId)
      if (lootIdx >= 0) {
        const item = lootList[lootIdx]
        lootList.splice(lootIdx, 1)
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
    adv.aiState = 'dead'
    adv.resources.hp = 0

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
    if (killerId === 'boss') return 'The Boss'
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

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
    // Phase QW (room-spawn timing fix) — minion spawns (Crypt risen bones,
    // Mimic Vault chests, Hall of Trials elite, Throne Room mini-boss) fire
    // at DAY_PHASE_STARTED so rooms placed THIS night have their inhabitants
    // ready when adventurers arrive the next morning. Previously these were
    // gated on NIGHT_PHASE_STARTED, which fires at the START of the build
    // phase — before the player can place anything — so newly-built rooms
    // sat empty until the night AFTER they were placed.
    EventBus.on('DAY_PHASE_STARTED',   this._onDayStart,   this)
    EventBus.on('ADVENTURER_ROOM_CHANGED', this._onRoomChanged, this)
    this._listeners = [
      ['NIGHT_PHASE_STARTED', this._onNightStart],
      ['DAY_PHASE_STARTED',   this._onDayStart],
      ['ADVENTURER_ROOM_CHANGED', this._onRoomChanged],
    ]
  }

  destroy() {
    for (const [evt] of this._listeners) {
      // Bound methods need explicit ref — recreate to off cleanly.
    }
    EventBus.off('NIGHT_PHASE_STARTED', this._onNightStart, this)
    EventBus.off('DAY_PHASE_STARTED',   this._onDayStart,   this)
    EventBus.off('ADVENTURER_ROOM_CHANGED', this._onRoomChanged, this)
  }

  // ── Necropolis Wing — corpse-to-minion conversion at night ───────────────

  _onNightStart() {
    // Bug fix — reset per-day flags on rooms so Colosseum waves re-arm
    // and any future per-day room state can ride this same hook.
    for (const room of (this._gameState.dungeon.rooms ?? [])) {
      room._wavesSpawned = false
    }

    // Room redesign 2026-04-30 — Treasury: pay flat daily gold stipend.
    // (Floor-loot chests retired in the loot-pickup cleanup; only the
    // stipend remains.)
    const treasuries = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.definitionId === 'treasury' && r.isActive !== false
    )
    if (treasuries.length > 0) {
      const stipend = 5 * treasuries.length
      this._gameState.player.gold = (this._gameState.player.gold ?? 0) + stipend
      EventBus.emit('TREASURY_STIPEND', { amount: stipend, treasuryCount: treasuries.length })
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
      const dungeonLv = this._gameState.boss?.level ?? 1
      const day = this._gameState.meta.dayNumber
      // Mirror the DayPhase spawn filter: gate by both boss level and
      // calendar day so the Library forecast doesn't preview a rare
      // class (Beast Master, Twitch Streamer) before its unlockDay.
      const classes = allClasses.filter(c =>
        (c.unlockLevel ?? 1) <= dungeonLv &&
        (c.unlockDay   ?? 1) <= day,
      )
      let baseCount = Balance.ADVENTURERS_PER_DAY_BASE + Math.floor((day - 1) / 2)
      // Post-day-9 wave-size escalation — matches DayPhase spawn so
      // the Library class forecast covers the bigger waves too.
      const postTenAdvs = Math.max(0, day - 9)
      if (postTenAdvs > 0) baseCount += postTenAdvs * (Balance.ADVENTURER_POST10_EXTRA_PER_DAY ?? 1)
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

    // [Moved 2026-05-22 → _onDayStart] Crypt / Mimic Vault / Hall of Trials /
    // Throne Room minion-spawning blocks USED to live here, gated on
    // NIGHT_PHASE_STARTED. That fires at the START of the build phase —
    // before the player has placed anything — so a Crypt placed THIS night
    // had to wait until the NEXT night before its risen bones appeared,
    // leaving it empty for the day's adventurers. Moved to DAY_PHASE_STARTED
    // so spawns land just before adventurers arrive, covering BOTH the
    // refill case (the existing crypts the player already had) and the
    // first-day-after-placement case for newly-built rooms.

    // Throne Room mini-boss respawn (user 2026-05-22): if a Throne Room
    // mini-boss died yesterday, refill it during the night build phase
    // so the throne is visibly occupied before dawn. Idempotent — if a
    // mini-boss is still alive in the room, this is a no-op. Newly-built
    // Throne Rooms STILL get their first mini-boss at day-start (see
    // _onDayStart) since this _onNightStart hook fires before the player
    // can place anything.
    this._spawnThroneMinibosses()

    // [Removed 2026-04-30] Necropolis Wing corpse-to-minion conversion.
    // Catacombs now fills the corpse-spawn role (see AISystem._kill).
  }

  // ── Day-start spawns (room-redesign minion factories) ────────────────────
  //
  // Fires on DAY_PHASE_STARTED, BEFORE the day's phase-transition cinematic
  // and BEFORE _spawnDailyAdventurers in DayPhase, so by the time adventurers
  // arrive every gateway room has its garrison ready. Both fresh placements
  // (built during the prior night) and refills (occupants killed yesterday)
  // are handled by the same iterate-all-rooms-and-top-up logic — caps and
  // alive-checks are room-specific.
  _onDayStart() {
    const minionTypes = this._scene.cache.json.get('minionTypes') ?? []
    const baseDef = minionTypes.find(d => d.id === 'skeleton1') ?? minionTypes[0]
    if (!baseDef) return
    const TS = 32

    // Room redesign 2026-04-30 — Crypt spawns up to 4 garrison Risen Bones,
    // refilling each day. Garrison minions are room-bound (cannot patrol or
    // chase outside the Crypt) and do NOT count toward the Barracks roster
    // cap.
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

    // Mimic Vault: spawn 2 chest-disguised mimics each day. Mimics start
    // in 'chest' state — a red-tinted Treasure Chest sprite (per-mimic
    // random tier) to the player, an ordinary chest to the adv AI.
    // Adventurers within 1 tile of a 'chest'-state mimic THEY DON'T KNOW
    // ABOUT trigger AISystem._tryTriggerMimic: the chest open animation
    // plays, the opener is instantly killed, knowledge propagates to all
    // alive advs + the shared pool, and the mimic transitions to
    // 'sprung' (visibly open) for the rest of the day. At
    // NIGHT_PHASE_STARTED, AISystem._resetSprungMimics flips them back
    // to 'chest'. Knowledge-aware advs see through the disguise and may
    // attack the mimic instead (it counter-attacks via the retaliation
    // window in MinionAISystem).
    const vaults = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.definitionId === 'mimic_vault' && r.isActive !== false
    )
    if (vaults.length > 0) {
      const mimicDef = minionTypes.find(d => d.id === 'mimic') ?? baseDef
      for (const room of vaults) {
        const aliveMimics = (this._gameState.minions ?? []).filter(m =>
          m.assignedRoomId === room.instanceId && m.isMimicVaultSpawn && m.aiState !== 'dead'
        ).length
        const mimicSlots = [
          [room.gridX + Balance.WALL_THICKNESS, room.gridY + Balance.WALL_THICKNESS],
          [room.gridX + room.width - Balance.WALL_THICKNESS - 1, room.gridY + room.height - Balance.WALL_THICKNESS - 1],
        ]
        const occupiedTiles = new Set(
          (this._gameState.minions ?? [])
            .filter(m => m.assignedRoomId === room.instanceId && m.isMimicVaultSpawn && m.aiState !== 'dead')
            .map(m => `${m.tileX},${m.tileY}`)
        )
        let mimicSpawned = 0
        for (const [x, y] of mimicSlots) {
          if (aliveMimics + mimicSpawned >= 2) break
          if (occupiedTiles.has(`${x},${y}`)) continue
          const m = this._makeGarrison(mimicDef, room, {
            tileX: x, tileY: y,
            namePrefix: 'Mimic',
            extra: {
              isMimicVaultSpawn: true,
              isMimic:    true,
              mimicState: 'chest',                              // 'chest' | 'sprung'
              chestTier:  1 + Math.floor(Math.random() * 10),   // random visual tier 1..10
            },
          })
          this._gameState.minions.push(m)
          mimicSpawned++
        }
      }
    }

    // Room redesign 2026-04-30 — Hall of Trials: at day start, if no
    // garrison alive in this Hall, spawn one random T2 evolved minion.
    const trialHalls = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.definitionId === 'hall_of_trials' && r.isActive !== false
    )
    if (trialHalls.length > 0) {
      const tier2Pool = minionTypes.filter(d =>
        /[a-z_]+2$/.test(d.id) && d.id !== 'beholder2'  // exclude super-rare or boss-tier
      )
      for (const room of trialHalls) {
        const aliveHere = (this._gameState.minions ?? []).filter(m =>
          m.assignedRoomId === room.instanceId && m.isHallOfTrialsSpawn && m.aiState !== 'dead'
        ).length
        if (aliveHere > 0) continue
        const def = tier2Pool[Math.floor(Math.random() * tier2Pool.length)]
        if (!def) continue
        const cx = room.gridX + Math.floor(room.width / 2)
        const cy = room.gridY + Math.floor(room.height / 2)
        const m = this._makeGarrison(def, room, {
          tileX: cx, tileY: cy,
          extra: { isHallOfTrialsSpawn: true },
        })
        this._gameState.minions.push(m)
        EventBus.emit('HALL_OF_TRIALS_SPAWNED', { minion: m, roomId: room.instanceId })
      }
    }

    // Throne Room — spawn at day start so a freshly-built throne room
    // has its mini-boss ready for the first wave of the day. The same
    // helper also fires from _onNightStart so a killed mini-boss can
    // respawn during the night build phase (user request 2026-05-22).
    this._spawnThroneMinibosses()
  }

  // ── False Exit + room redesign hooks — react on room change ──────────────

  _onRoomChanged({ adventurer, fromRoomId, toRoomId }) {
    if (!adventurer || !toRoomId) return
    const room = this._gameState.dungeon.rooms.find(r => r.instanceId === toRoomId)
    if (!room) return

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

    // Room redesign 2026-04-30 — Watchtower aura: minions in any room
    // door-connected to an active Watchtower get a first-strike hit when
    // an adventurer enters the room (counters Speed Runners). Bypasses
    // attack range/cooldown — pure ambush damage. Each entry triggers
    // once.
    const watchAura = this._isAdjacentToActiveWatchtower(room.instanceId)
    if (watchAura) {
      this._fireWatchtowerStrike(adventurer, room)
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

    // [Removed 2026-05-22] _rollMimicOpens + _revealMimic. The mimic
    // mechanic was rewritten to "stationary disguised chest with insta-
    // kill on loot-attempt" — see AISystem._tryTriggerMimic +
    // _springMimic for the new path. Proximity-based trigger replaces
    // the room-entry roll, knowledge propagation happens on spring, and
    // the bite-on-reveal-then-engage mechanic was retired entirely.
  }

  _teleportFromWanderingGate(adv, gateRoom) {
    // Twitch Streamers can never be sent to the boss chamber — exclude it
    // from every destination bucket below for them.
    const noBoss = adv?.classId === 'twitch_streamer'
    const rooms = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.isActive !== false && r.definitionId !== 'wandering_gate'
    )
    const boss = noBoss ? null : rooms.find(r => r.definitionId === 'boss_chamber')
    const neighbors = (this._scene?.dungeonGrid?.getNeighborRooms?.(gateRoom.instanceId) ?? [])
      .filter(r => r.definitionId !== 'wandering_gate' && r.isActive !== false &&
                   !(noBoss && r.definitionId === 'boss_chamber'))
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

  _isAdjacentToActiveWatchtower(roomId) {
    const neighbors = this._scene?.dungeonGrid?.getNeighborRooms?.(roomId) ?? []
    return neighbors.some(n =>
      n.definitionId === 'watchtower' && n.isActive !== false
    )
  }

  // Watchtower first-strike: each alive dungeon-faction minion in the
  // entered room gets one free hit on the adventurer, bypassing range and
  // cooldown. Damage runs through CombatSystem._computeDamage so existing
  // modifiers (Marked, armory adjacency, etc.) still apply.
  _fireWatchtowerStrike(adv, room) {
    const cs = this._scene?.combatSystem
    if (!cs) return
    const strikers = (this._gameState.minions ?? []).filter(m =>
      m.assignedRoomId === room.instanceId &&
      m.faction === 'dungeon' &&
      m.aiState !== 'dead' &&
      (m.resources?.hp ?? 0) > 0
    )
    if (strikers.length === 0) return
    let totalDmg = 0
    for (const m of strikers) {
      if ((adv.resources?.hp ?? 0) <= 0) break
      const dmg = cs._computeDamage(m, adv)
      adv.resources.hp = Math.max(0, (adv.resources?.hp ?? 0) - dmg)
      totalDmg += dmg
      EventBus.emit('COMBAT_HIT', {
        sourceId: m.instanceId,
        targetId: adv.instanceId,
        damage: dmg,
        damageType: m.damageType ?? 'physical',
        isCritical: false,
      })
      adv._lastHitBy = m.instanceId
      adv._lastHitType = m.damageType ?? 'physical'
    }
    EventBus.emit('WATCHTOWER_FIRST_STRIKE', {
      adventurer: adv,
      roomId: room.instanceId,
      strikerCount: strikers.length,
      totalDamage: totalDmg,
    })
  }

  // Room redesign 2026-04-30 — shared garrison-minion factory used by
  // Mimic Vault, Hall of Trials, Throne Room. Mirrors the inline Crypt
  // shape (kept inline for back-compat) but with a fixed class:'garrison'
  // and the standard book-keeping fields. opts:
  //   tileX, tileY (required) — spawn tile (also home tile)
  //   namePrefix (optional)   — overrides the def's display name
  //   extra (optional)        — extra fields merged onto the result
  //   statsOverride (optional) — replaces baseStats for stat scaling
  _makeGarrison(def, room, opts = {}) {
    const TS = 32
    const stats = opts.statsOverride ?? def.baseStats ?? { hp: 30, attack: 8, defense: 4, speed: 1 }
    const tileX = opts.tileX
    const tileY = opts.tileY
    const m = {
      instanceId:    `garr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      definitionId:  def.id,
      name:          opts.namePrefix ?? def.name ?? def.id,
      faction:       'dungeon',
      class:         'garrison',
      assignedRoomId: room.instanceId,
      behaviorType:  def.behaviorType ?? 'patrol',
      homeTileX: tileX, homeTileY: tileY,
      tileX, tileY,
      worldX: tileX * TS + TS / 2, worldY: tileY * TS + TS / 2,
      stats: { ...stats },
      resources: { hp: stats.hp ?? 30, maxHp: stats.hp ?? 30 },
      aiState: 'idle', level: 1, xp: 0,
      tags: [...(def.tags ?? [])],
      equippedGear: [], killHistory: [], evolutionHistory: [],
      timesKilledAndRespawned: 0, lastAttackAt: 0, currentTargetId: null,
      ...(opts.extra ?? {}),
    }
    this._gameState.minions ??= []
    return m
  }

  // Throne Room mini-boss spawn helper. Fires from both _onDayStart
  // (so a freshly-built Throne Room has a mini-boss ready for Day 1)
  // and _onNightStart (so a killed mini-boss respawns at the next
  // night phase, per user 2026-05-22). Idempotent: skips any Throne
  // Room that already has an alive mini-boss.
  //
  // Per user 2026-05-22:
  //   - Random Tier-3 minion (not just skeleton3)
  //   - Base stats × 2, THEN scale with boss level
  //   - Tagged with `_mbDisplayScale` so MinionRenderer draws the
  //     sprite almost as big as the actual boss
  _spawnThroneMinibosses() {
    const thrones = (this._gameState.dungeon?.rooms ?? []).filter(r =>
      r.definitionId === 'throne_room' && r.isActive !== false
    )
    if (thrones.length === 0) return
    const minionTypes = this._scene.cache.json.get('minionTypes') ?? []
    // Tier-3 pool — same id-ends-in-3 convention HoT uses for T2.
    // Excludes the boss-tier slime4 sequence and leaves elder_slime3,
    // ent3, goblin3, imp3, plant3, rat3, skeleton3, slime3, zombie3.
    const tier3Pool = minionTypes.filter(d => /[a-z_]+3$/.test(d.id))
    if (tier3Pool.length === 0) return
    const dungeonLv = this._gameState.boss?.level ?? 1
    const lvOver  = dungeonLv - 1
    const hpMult  = 1 + Balance.MINION_HP_PER_BOSS_LV  * lvOver
    const atkMult = 1 + Balance.MINION_ATK_PER_BOSS_LV * lvOver
    const MINIBOSS_DOUBLER = 2   // base stats × 2 before boss-level scaling
    for (const room of thrones) {
      const aliveHere = (this._gameState.minions ?? []).filter(m =>
        m.assignedRoomId === room.instanceId && m.isThroneMiniBoss && m.aiState !== 'dead'
      ).length
      if (aliveHere > 0) continue
      const def = tier3Pool[Math.floor(Math.random() * tier3Pool.length)]
      const cx = room.gridX + Math.floor(room.width / 2)
      const cy = room.gridY + Math.floor(room.height / 2)
      const baseStats = def.baseStats ?? { hp: 60, attack: 12, defense: 6, speed: 1 }
      const m = this._makeGarrison(def, room, {
        tileX: cx, tileY: cy,
        namePrefix: 'Mini-Boss',
        extra: {
          isThroneMiniBoss:  true,
          isMiniBoss:        true,
          bossLevel:         dungeonLv,
          // Sprite-scale flag read by MinionRenderer to draw the mini-
          // boss noticeably larger than a normal minion (closer to the
          // dungeon boss's footprint).
          _mbDisplayScale:   2.0,
        },
        statsOverride: {
          hp:      Math.floor((baseStats.hp      ?? 60) * MINIBOSS_DOUBLER * hpMult),
          attack:  Math.floor((baseStats.attack  ?? 12) * MINIBOSS_DOUBLER * atkMult),
          defense: Math.floor((baseStats.defense ??  6) * MINIBOSS_DOUBLER * hpMult),
          speed:   baseStats.speed ?? 1,
        },
      })
      this._gameState.minions.push(m)
      EventBus.emit('THRONE_MINIBOSS_SPAWNED', { minion: m, roomId: room.instanceId, dungeonLv })
    }
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

  // [Removed 2026-04-30] _lockColosseumGates — colosseum room retired.

  _teleportToNearBoss(adv) {
    // Twitch Streamers never get teleported into the boss chamber — chat
    // chaos must not shortcut them past the dungeon into the throne room.
    if (adv?.classId === 'twitch_streamer') return
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

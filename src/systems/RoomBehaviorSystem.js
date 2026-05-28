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
//     adventurer crosses through a False Exit, teleport them to a RANDOM
//     room (not boss / entry / another false exit) instead of letting
//     them escape — the fake door leads deeper into the dungeon.
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
    //
    // Phase 2026-05-27 — also fire the same per-room spawn logic on
    // ROOM_PLACED so a freshly placed Crypt / Mimic Vault / Hall of
    // Trials / Throne Room / Treasury populates IMMEDIATELY during the
    // build phase. The player sees what they bought right when they
    // drop the room instead of waiting for dawn. The spawn helpers are
    // idempotent (skip-if-already-populated checks per room id) so a
    // MOVE of a populated room — which also re-emits ROOM_PLACED — is
    // safely a no-op (the existing inhabitants ride along inside the
    // room footprint via NightPhase's move-drop logic).
    EventBus.on('DAY_PHASE_STARTED',   this._onDayStart,   this)
    EventBus.on('ROOM_PLACED',         this._onRoomPlaced, this)
    EventBus.on('ROOM_REMOVED',        this._onRoomRemoved, this)
    EventBus.on('ADVENTURER_ROOM_CHANGED', this._onRoomChanged, this)
    this._listeners = [
      ['NIGHT_PHASE_STARTED', this._onNightStart],
      ['DAY_PHASE_STARTED',   this._onDayStart],
      ['ROOM_PLACED',         this._onRoomPlaced],
      ['ROOM_REMOVED',        this._onRoomRemoved],
      ['ADVENTURER_ROOM_CHANGED', this._onRoomChanged],
    ]
  }

  destroy() {
    for (const [evt] of this._listeners) {
      // Bound methods need explicit ref — recreate to off cleanly.
    }
    EventBus.off('NIGHT_PHASE_STARTED', this._onNightStart, this)
    EventBus.off('DAY_PHASE_STARTED',   this._onDayStart,   this)
    EventBus.off('ROOM_PLACED',         this._onRoomPlaced, this)
    EventBus.off('ROOM_REMOVED',        this._onRoomRemoved, this)
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
      // Tinkerer's Workshop "Golden Vault" — +50% stipend when Treasury
      // type is upgraded. The chest-tier bonus is handled separately in
      // _refillTreasury.
      const treasuryTinkered = this._isTinkered('treasury')
      const perRoom = treasuryTinkered ? 7.5 : 5
      const stipend = Math.round(perRoom * treasuries.length)
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
      // Tinkerer's Workshop "Deeper Veil" — also wipes 2-hop neighbours
      // when the type is upgraded. Builds the wipe set as the union of
      // direct neighbours and their neighbours (still excluding boss /
      // entry rooms so chokepoints aren't unwiped).
      const deepVeil = this._isTinkered('veil_of_forgetting')
      const wipeTargets = new Set()
      for (const veil of veils) {
        const neighbors = this._scene.dungeonGrid.getNeighborRooms(veil.instanceId) ?? []
        for (const n of neighbors) {
          if (n.definitionId === 'boss_chamber' || n.definitionId === 'entry_hall') continue
          wipeTargets.add(n.instanceId)
          if (deepVeil) {
            const second = this._scene.dungeonGrid.getNeighborRooms(n.instanceId) ?? []
            for (const m of second) {
              if (m.definitionId === 'boss_chamber' || m.definitionId === 'entry_hall') continue
              if (m.definitionId === 'veil_of_forgetting') continue
              wipeTargets.add(m.instanceId)
            }
          }
        }
      }
      for (const roomId of wipeTargets) {
        delete pool.rooms?.[roomId]
        delete pool.enemiesPerRoom?.[roomId]
        if (pool.traps) {
          for (const tid of Object.keys(pool.traps)) {
            if (pool.traps[tid]?.roomId === roomId) delete pool.traps[tid]
          }
        }
        if (pool.loot) {
          for (const lid of Object.keys(pool.loot)) {
            if (pool.loot[lid]?.roomId === roomId) delete pool.loot[lid]
          }
        }
        erased.add(roomId)
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

    for (const room of (this._gameState.dungeon.rooms ?? [])) {
      if (room.isActive === false) continue
      this._spawnRoomContents(room, minionTypes, baseDef)
    }
    // Throne Room helper already iterates all thrones internally and
    // handles its idempotent skip-if-alive check.
    this._spawnThroneMinibosses()
  }

  // Fired when DungeonGrid.placeRoom finishes. For FRESH placements we
  // populate spawn-rooms immediately so the player sees what they
  // bought during the build phase. MOVE drops are skipped — the
  // original inhabitants are re-attached by NightPhase's
  // _heldRoomItems / _heldRoomMinions carry-on-drop logic AFTER this
  // event fires, so spawning now would create duplicates (the helpers'
  // skip-if-already-populated guards can't see the not-yet-restored
  // carry buffer).
  _onRoomPlaced({ room, isMove }) {
    if (!room || room.isActive === false) return
    if (isMove) return
    const minionTypes = this._scene.cache.json.get('minionTypes') ?? []
    const baseDef = minionTypes.find(d => d.id === 'skeleton1') ?? minionTypes[0]
    if (!baseDef) return
    this._spawnRoomContents(room, minionTypes, baseDef)
    if (room.definitionId === 'throne_room') this._spawnThroneMinibosses()
  }

  // Fired when DungeonGrid.removeRoom finishes. Cleans up auto-spawned
  // chests + garrison minions that were tied to this room so Ctrl+Z
  // undo of a spawn-room doesn't leave orphans drifting in gameState.
  //
  // Safe across the three remove paths:
  //   * SELL — `_finalizeRoomSell` strips contents before removeRoom,
  //     so cleanup finds nothing.
  //   * MOVE pickup — chests carried into `_heldRoomItems` are already
  //     gone from `dungeon.treasureChests`; minions are tagged
  //     `_heldByPlayer = true` so the filter excludes them.
  //   * UNDO (Ctrl+Z) — nothing is pre-cleaned, so this is the path
  //     that actually does the work.
  _onRoomRemoved({ room }) {
    if (!room) return
    const id = room.instanceId
    // Strip auto-spawn chests tied to this room.
    const chests = this._gameState.dungeon?.treasureChests
    if (Array.isArray(chests)) {
      this._gameState.dungeon.treasureChests = chests.filter(c =>
        !((c._treasurySpawn || c._mimicCursed) && c.assignedRoomId === id),
      )
    }
    // Strip garrison minions tied to this room — but NEVER touch a
    // minion the player is currently holding (move-pickup path).
    const mins = this._gameState.minions
    if (Array.isArray(mins)) {
      this._gameState.minions = mins.filter(m =>
        !(m.class === 'garrison' && m.assignedRoomId === id && !m._heldByPlayer),
      )
    }
  }

  // Dispatcher: route to the per-room-type spawn helper. Anything not
  // listed here has no auto-spawn behavior.
  _spawnRoomContents(room, minionTypes, baseDef) {
    switch (room.definitionId) {
      case 'crypt':          return this._spawnCryptUndead(room, baseDef)
      case 'mimic_vault':    return this._spawnMimicVault(room, minionTypes, baseDef)
      case 'hall_of_trials': return this._spawnHallOfTrialsElite(room, minionTypes)
      case 'treasury':       return this._refillTreasury(room)
      // throne_room is handled by _spawnThroneMinibosses() (which
      // iterates all thrones internally) — see callers.
    }
  }

  // ── Per-room spawn helpers ───────────────────────────────────────────────
  //
  // Each is idempotent: it tops up to the room's target population and
  // no-ops when the room is already full. Called from both _onDayStart
  // (daily refill) and _onRoomPlaced (immediate spawn on placement /
  // move).

  // Room redesign 2026-04-30 — Crypt spawns up to 4 garrison Risen Bones.
  // Garrison minions are room-bound (cannot patrol or chase outside the
  // Crypt) and do NOT count toward the Barracks roster cap.
  _spawnCryptUndead(room, baseDef) {
    const TS = 32
    const alreadyHere = (this._gameState.minions ?? [])
      .filter(m => m.assignedRoomId === room.instanceId && m.isCryptSpawn).length
    // Tinkerer's Workshop "Crowded Crypt" — cap +2 (6 total) when type
    // is upgraded.
    const cryptCap = this._isTinkered('crypt') ? 6 : 4
    const toSpawn = Math.max(0, cryptCap - alreadyHere)
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

  // Mimic Vault: spawn 2 chest-disguised mimics + 1 cursed chest.
  //
  // Mimics start in 'chest' state — a red-tinted Treasure Chest sprite
  // (per-mimic random tier) to the player, an ordinary chest to the adv
  // AI. Adventurers within 1 tile of a 'chest'-state mimic THEY DON'T
  // KNOW ABOUT trigger AISystem._tryTriggerMimic: the chest open
  // animation plays, the opener is instantly killed, knowledge
  // propagates to all alive advs + the shared pool, and the mimic
  // transitions to 'sprung' (visibly open) for the rest of the day.
  // At NIGHT_PHASE_STARTED, AISystem._resetSprungMimics flips them
  // back to 'chest'. Knowledge-aware advs see through the disguise
  // and may attack the mimic instead (it counter-attacks via the
  // retaliation window in MinionAISystem).
  //
  // The cursed chest looks like an ordinary treasure chest (random
  // visual tier) but carries the `_mimicCursed` flag. When an adv
  // opens it, no immediate gold debit fires; instead the adv is
  // tagged `_mimicCursedCarrier` and forced into ESCAPE_WITH_LOOT.
  // If they reach the entry hall alive, the player loses 25% of
  // current gold (Balance.MIMIC_CURSE_ESCAPE_PCT). Dying clears the
  // flag with no penalty.
  //
  // Slot allocation: build the full interior tile list, pick the two
  // fixed mimic anchors first, then drop the cursed chest on a
  // remaining tile so it can never overlap a mimic.
  _spawnMimicVault(room, minionTypes, baseDef) {
    const mimicDef = minionTypes.find(d => d.id === 'mimic') ?? baseDef
    const aliveMimics = (this._gameState.minions ?? []).filter(m =>
      m.assignedRoomId === room.instanceId && m.isMimicVaultSpawn && m.aiState !== 'dead'
    ).length
    // Tinkerer's Workshop "Hungry Vault" — +2 mimic slots when type is
    // upgraded. Extra slots placed at the remaining inner corners.
    const mimicCap = this._isTinkered('mimic_vault') ? 4 : 2
    const mimicSlots = [
      [room.gridX + Balance.WALL_THICKNESS, room.gridY + Balance.WALL_THICKNESS],
      [room.gridX + room.width - Balance.WALL_THICKNESS - 1, room.gridY + room.height - Balance.WALL_THICKNESS - 1],
    ]
    if (mimicCap > 2) {
      mimicSlots.push(
        [room.gridX + room.width - Balance.WALL_THICKNESS - 1, room.gridY + Balance.WALL_THICKNESS],
        [room.gridX + Balance.WALL_THICKNESS, room.gridY + room.height - Balance.WALL_THICKNESS - 1],
      )
    }
    const occupiedTiles = new Set(
      (this._gameState.minions ?? [])
        .filter(m => m.assignedRoomId === room.instanceId && m.isMimicVaultSpawn && m.aiState !== 'dead')
        .map(m => `${m.tileX},${m.tileY}`)
    )
    let mimicSpawned = 0
    for (const [x, y] of mimicSlots) {
      if (aliveMimics + mimicSpawned >= mimicCap) break
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

    // Cursed chest — one per vault. Looked up by the duck-typed pair
    // `_mimicCursed + assignedRoomId` (NOT instanceId-encoded room id)
    // so a MOVE of the Mimic Vault — which spawns a fresh room
    // instanceId and asks NightPhase to rebind assignedRoomId on the
    // carried chest — still resolves to the same chest. Position and
    // tier persist across days so adv knowledge entries (which
    // observe tileX/tileY/tier on room entry) stay accurate.
    // Day-start only resets `opened` to false so the bait re-arms.
    this._gameState.dungeon.treasureChests ??= []
    const existing = this._gameState.dungeon.treasureChests.find(c =>
      c._mimicCursed && c.assignedRoomId === room.instanceId,
    )
    if (existing) {
      existing.opened = false
      return
    }
    // First spawn — pick a tile that isn't already taken by a
    // mimic (or any other room-placed item). Tile + tier are
    // locked in from this point on.
    const mimicTileKeys = new Set(
      (this._gameState.minions ?? [])
        .filter(m => m.assignedRoomId === room.instanceId && m.isMimicVaultSpawn && m.aiState !== 'dead')
        .map(m => `${m.tileX},${m.tileY}`),
    )
    const interiorCandidates = []
    const ix0 = room.gridX + Balance.WALL_THICKNESS
    const iy0 = room.gridY + Balance.WALL_THICKNESS
    const ix1 = room.gridX + room.width  - Balance.WALL_THICKNESS - 1
    const iy1 = room.gridY + room.height - Balance.WALL_THICKNESS - 1
    for (let y = iy0; y <= iy1; y++) {
      for (let x = ix0; x <= ix1; x++) {
        if (mimicTileKeys.has(`${x},${y}`)) continue
        interiorCandidates.push([x, y])
      }
    }
    if (interiorCandidates.length === 0) return
    const [cx, cy] = interiorCandidates[Math.floor(Math.random() * interiorCandidates.length)]
    const tier = Balance.MIMIC_CURSED_CHEST_TIER_MIN +
                 Math.floor(Math.random() * (Balance.MIMIC_CURSED_CHEST_TIER_MAX - Balance.MIMIC_CURSED_CHEST_TIER_MIN + 1))
    this._gameState.dungeon.treasureChests.push({
      instanceId:     `mimic_cursed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tileX: cx, tileY: cy,
      tier,
      opened:         false,
      _mimicCursed:   true,
      assignedRoomId: room.instanceId,
    })
    EventBus.emit('TREASURE_CHEST_PLACED', {
      tier, tileX: cx, tileY: cy, cursed: true, mimicVaultRoomId: room.instanceId,
    })
  }

  // Room redesign 2026-05-27 — Treasury: auto-spawn TREASURY_CHEST_COUNT
  // free chests inside the room. First placement picks positions + tiers
  // once and locks them in; subsequent calls just flip `opened` back to
  // false on the existing chests and top up any missing slots.
  // Existing-set is identified by `_treasurySpawn + assignedRoomId`
  // (duck-typed, not by instanceId), so a MOVE of the room — which
  // rebinds assignedRoomId on the carried chests via NightPhase's
  // _heldRoomItems carry-restore — still resolves correctly across the
  // new room instanceId. Tagged `_treasurySpawn: true` so the sell tool
  // refuses to refund gold (they were free).
  _refillTreasury(room) {
    this._gameState.dungeon.treasureChests ??= []
    const want    = Balance.TREASURY_CHEST_COUNT
    const tierMin = Balance.TREASURY_CHEST_TIER_MIN
    const tierMax = Balance.TREASURY_CHEST_TIER_MAX
    // Reset `opened` on this room's existing batch (might be < want
    // if first-spawn lost slots to player-placed items below).
    const existing = this._gameState.dungeon.treasureChests
      .filter(c => c._treasurySpawn && c.assignedRoomId === room.instanceId)
    for (const c of existing) c.opened = false
    if (existing.length >= want) return
    // Top up: find tiles not already taken by an existing chest or
    // any other player-placed item / minion in this room.
    const taken = new Set()
    for (const c of (this._gameState.dungeon.treasureChests ?? [])) taken.add(`${c.tileX},${c.tileY}`)
    for (const b of (this._gameState.dungeon.beacons        ?? [])) taken.add(`${b.tileX},${b.tileY}`)
    for (const f of (this._gameState.dungeon.fountains      ?? [])) taken.add(`${f.tileX},${f.tileY}`)
    for (const k of (this._gameState.dungeon.keyChests      ?? [])) taken.add(`${k.tileX},${k.tileY}`)
    const phyl = this._gameState.phylactery
    if (phyl?.tileX != null) taken.add(`${phyl.tileX},${phyl.tileY}`)
    for (const m of (this._gameState.minions ?? [])) {
      if (m.aiState === 'dead') continue
      if (m.assignedRoomId === room.instanceId) taken.add(`${m.tileX},${m.tileY}`)
    }
    const candidates = []
    const ix0 = room.gridX + Balance.WALL_THICKNESS
    const iy0 = room.gridY + Balance.WALL_THICKNESS
    const ix1 = room.gridX + room.width  - Balance.WALL_THICKNESS - 1
    const iy1 = room.gridY + room.height - Balance.WALL_THICKNESS - 1
    for (let y = iy0; y <= iy1; y++) {
      for (let x = ix0; x <= ix1; x++) {
        if (taken.has(`${x},${y}`)) continue
        candidates.push([x, y])
      }
    }
    // Fisher-Yates shuffle so first-spawn positions vary per room.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
    }
    const usedSlotIdxs = new Set(existing.map(c => c._treasurySlotIdx ?? -1))
    let candIdx = 0
    let placed = 0
    // Tinkerer's Workshop "Golden Vault" — auto-spawned chests roll +1
    // tier (clamped to tierMax) when the Treasury type is upgraded.
    const tinkeredBump = this._isTinkered('treasury') ? 1 : 0
    for (let slot = 0; slot < want && candIdx < candidates.length; slot++) {
      if (usedSlotIdxs.has(slot)) continue
      const [cx, cy] = candidates[candIdx++]
      let tier = tierMin + Math.floor(Math.random() * (tierMax - tierMin + 1))
      tier = Math.min(10, tier + tinkeredBump)
      this._gameState.dungeon.treasureChests.push({
        instanceId:       `treasury_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${slot}`,
        tileX: cx, tileY: cy,
        tier,
        opened:           false,
        _treasurySpawn:   true,
        _treasurySlotIdx: slot,
        assignedRoomId:   room.instanceId,
      })
      placed++
    }
    if (placed > 0) {
      EventBus.emit('TREASURY_REFILLED', { roomId: room.instanceId, count: placed })
    }
  }

  // Room redesign 2026-04-30 — Hall of Trials: if no garrison alive in
  // this Hall, spawn one random T2 evolved minion. Killed mid-day, it
  // doesn't respawn until the next call.
  _spawnHallOfTrialsElite(room, minionTypes) {
    const aliveHere = (this._gameState.minions ?? []).filter(m =>
      m.assignedRoomId === room.instanceId && m.isHallOfTrialsSpawn && m.aiState !== 'dead'
    ).length
    if (aliveHere > 0) return
    // Tinkerer's Workshop "Champion Trials" — spawn Tier 3 instead of
    // Tier 2 when the room type is upgraded.
    const tier = this._isTinkered('hall_of_trials') ? 3 : 2
    const tierPool = this._tierPoolByChain(minionTypes, tier, new Set(['beholder2']))
    const def = tierPool[Math.floor(Math.random() * tierPool.length)]
    if (!def) return
    const cx = room.gridX + Math.floor(room.width / 2)
    const cy = room.gridY + Math.floor(room.height / 2)
    const m = this._makeGarrison(def, room, {
      tileX: cx, tileY: cy,
      extra: { isHallOfTrialsSpawn: true },
    })
    this._gameState.minions.push(m)
    EventBus.emit('HALL_OF_TRIALS_SPAWNED', { minion: m, roomId: room.instanceId })
  }

  // ── False Exit + room redesign hooks — react on room change ──────────────

  _onRoomChanged({ adventurer, fromRoomId, toRoomId }) {
    if (!adventurer || !toRoomId) return
    const room = this._gameState.dungeon.rooms.find(r => r.instanceId === toRoomId)
    if (!room) return

    if (room.definitionId === 'false_exit') {
      // Only "trigger" when the adventurer is fleeing — i.e. their goal type
      // is FLEE and they think they're heading out. Short per-adv cooldown
      // so a fleer can't bounce instantly between two false exits.
      if (adventurer.goal?.type === 'FLEE') {
        const now = this._scene?.time?.now ?? 0
        if (now - (adventurer._falseExitTpAt ?? -Infinity) > 3000) {
          this._teleportFromFalseExit(adventurer)
        }
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

    // Tinkerer's Workshop "Skewed Gate" — boss-chamber teleport chance
    // bumped from 5% to 15% when the type is upgraded. Re-slices the
    // probability buckets so neighbor / any-built / boss sum to 1.0:
    //   default: 60% neighbor / 35% any-built / 5% boss
    //   tinkered: 55% neighbor / 30% any-built / 15% boss
    const tinkeredGate = this._isTinkered('wandering_gate')
    const neighborMax = tinkeredGate ? 0.55 : 0.60
    const anyBuiltMax = tinkeredGate ? 0.85 : 0.95
    const roll = Math.random()
    let target = null
    if (roll < neighborMax && neighbors.length > 0) {
      target = neighbors[Math.floor(Math.random() * neighbors.length)]
    } else if (roll < anyBuiltMax && anyBuilt.length > 0) {
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
    // Tinkerer's Workshop "Cannonade" — Watchtower first-strike damage
    // doubled when the type is upgraded.
    const watchMul = this._isTinkered('watchtower') ? 2 : 1
    let totalDmg = 0
    for (const m of strikers) {
      if ((adv.resources?.hp ?? 0) <= 0) break
      const dmg = Math.round(cs._computeDamage(m, adv) * watchMul)
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

  // Build a tier-N pool from the evolution chains (minionEvolutions.json).
  // tier = 1 → chain[0] (starters), 2 → chain[1], 3 → chain[2], etc.
  // Skips ids in `excludeIds`. Also filters to ids ENDING IN A DIGIT —
  // a clean discriminator that drops the boss-tier final forms (named
  // entries like `gnoll_alpha`, `demon_lord`, `beholder_tyrant`,
  // `elder_slime1`, etc.) without needing an explicit allowlist.
  //
  // Used by Hall of Trials (tier 2) and Throne Room (tier 3) for the
  // garrison spawn pool. Replaces the legacy `/[a-z_]+N$/` regex which
  // wrongly classified slimes (slime3 ends in 3 but is chain[0] / T1
  // of its own chain; the real T3 slimes are slime8 / slime1 / slime6).
  _tierPoolByChain(minionTypes, tier, excludeIds = new Set()) {
    const chains = this._scene.cache.json.get('minionEvolutions') ?? {}
    const ids = new Set()
    for (const data of Object.values(chains)) {
      const chain = data?.chain
      if (Array.isArray(chain) && chain[tier - 1] && /\d$/.test(chain[tier - 1])) {
        ids.add(chain[tier - 1])
      }
    }
    for (const ex of excludeIds) ids.delete(ex)
    return minionTypes.filter(d => ids.has(d.id))
  }

  // Apex pool — the FINAL link of every evolution chain, regardless of
  // chain length. A 3-link family yields its T3 apex (beholder_tyrant,
  // goblin3, …); the 4-link slime chains yield their T4 elder
  // (elder_slime1/2/3). Used by the Throne Room so a slime throne can
  // roll the T4 elder instead of being stuck on the penultimate T3.
  //
  // Unlike _tierPoolByChain there's NO `/\d$/` digit-suffix filter —
  // that test silently excluded every NAMED final form (beholder_tyrant,
  // demon_lord, dark_wraith, gnoll_alpha, golem_warden, elder_lich,
  // serpent_captain) from any pool it built. The apex of a chain is
  // always a real minion def, so we take all of them and just intersect
  // with minionTypes. (2026-05-27 — throne T4 / apex spawning)
  _apexPoolByChain(minionTypes, excludeIds = new Set()) {
    const chains = this._scene.cache.json.get('minionEvolutions') ?? {}
    const ids = new Set()
    for (const data of Object.values(chains)) {
      const chain = data?.chain
      if (Array.isArray(chain) && chain.length > 0) {
        const apex = chain[chain.length - 1]
        if (apex) ids.add(apex)
      }
    }
    for (const ex of excludeIds) ids.delete(ex)
    return minionTypes.filter(d => ids.has(d.id))
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
    // Apex pool — each evolution chain's FINAL form. 3-link families
    // contribute their T3 apex (beholder_tyrant, goblin3, …); the
    // 4-link slime chains contribute their T4 elder (elder_slime1/2/3),
    // so a slime throne can now roll the true Tier-4. Replaces the old
    // fixed-T3 lookup (which couldn't reach slime T4 and — via its
    // `/\d$/` filter — silently excluded every named final form). The
    // mini-boss stat doubler + boss-level scaling below still apply on
    // top, so these are beefed-up apexes. (2026-05-27)
    const apexPool = this._apexPoolByChain(minionTypes)
    if (apexPool.length === 0) return
    const dungeonLv = this._gameState.boss?.level ?? 1
    const lvOver  = dungeonLv - 1
    const hpMult  = 1 + Balance.MINION_HP_PER_BOSS_LV  * lvOver
    const atkMult = 1 + Balance.MINION_ATK_PER_BOSS_LV * lvOver
    const MINIBOSS_DOUBLER = 2   // base stats × 2 before boss-level scaling
    // Tinkerer's Workshop "Tyrant Throne" — +50% HP and +50% ATK on top
    // of MINIBOSS_DOUBLER and boss-level scaling.
    const tinkeredThrone = this._isTinkered('throne_room') ? 1.5 : 1
    for (const room of thrones) {
      const aliveHere = (this._gameState.minions ?? []).filter(m =>
        m.assignedRoomId === room.instanceId && m.isThroneMiniBoss && m.aiState !== 'dead'
      ).length
      if (aliveHere > 0) continue
      const def = apexPool[Math.floor(Math.random() * apexPool.length)]
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
          hp:      Math.floor((baseStats.hp      ?? 60) * MINIBOSS_DOUBLER * hpMult * tinkeredThrone),
          attack:  Math.floor((baseStats.attack  ?? 12) * MINIBOSS_DOUBLER * atkMult * tinkeredThrone),
          defense: Math.floor((baseStats.defense ??  6) * MINIBOSS_DOUBLER * hpMult),
          speed:   baseStats.speed ?? 1,
        },
      })
      this._gameState.minions.push(m)
      EventBus.emit('THRONE_MINIBOSS_SPAWNED', { minion: m, roomId: room.instanceId, dungeonLv })
    }
  }

  _rollWishingWell(adv) {
    // Tinkerer's Workshop "Cursed Well" — coin lands on CURSE 70% of
    // the time (was 50/50) when the type is upgraded.
    const curseChance = this._isTinkered('wishing_well') ? 0.70 : 0.50
    const heads = Math.random() >= curseChance
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

  // False Exit teleport (2026-05-27 rework). Previously dumped the
  // fleeing adv at the boss chamber (AT_BOSS). Per design it now
  // scatters them to a RANDOM room — they thought the door led out, but
  // it led deeper in. Excludes the boss chamber (the old too-harsh
  // behavior), entry halls (no free escape — defeats the trap's purpose),
  // and false_exit rooms (no instant re-trigger). They keep the FLEE
  // goal, so from the new random spot they re-path to the nearest real
  // exit — the fake door just buys the dungeon a detour and exposes
  // them to whatever's between here and the way out.
  _teleportFromFalseExit(adv) {
    const rooms = (this._gameState.dungeon.rooms ?? []).filter(r =>
      r.isActive !== false &&
      r.definitionId !== 'false_exit' &&
      r.definitionId !== 'entry_hall' &&
      r.definitionId !== 'boss_chamber')
    if (rooms.length === 0) return
    const target = rooms[Math.floor(Math.random() * rooms.length)]
    const tx = target.gridX + Math.floor(target.width / 2)
    const ty = target.gridY + Math.floor(target.height / 2)
    const TS = 32
    adv.tileX = tx; adv.tileY = ty
    adv.worldX = tx * TS + TS / 2
    adv.worldY = ty * TS + TS / 2
    adv.path = null
    adv._falseExitTpAt = this._scene?.time?.now ?? 0
    // Tinkerer's Workshop "Painful Landing" — when False Exit type is
    // upgraded, the trapped fleer also takes 25% maxHp on arrival.
    if (this._isTinkered('false_exit') && adv.resources) {
      const dmg = Math.max(1, Math.round((adv.resources.maxHp ?? 0) * 0.25))
      adv.resources.hp = Math.max(0, (adv.resources.hp ?? 0) - dmg)
      EventBus.emit('COMBAT_HIT', {
        sourceId:   'false_exit',
        targetId:   adv.instanceId,
        damage:     dmg,
        damageType: 'physical',
      })
    }
    EventBus.emit('FALSE_EXIT_TELEPORTED', {
      adventurer: adv,
      destinationRoomId: target.instanceId,
      destinationDefId:  target.definitionId,
    })
  }

  // Tinkerer's Workshop helper — returns true when the given room
  // definitionId has been upgraded via the Workshop event. Defensive
  // against missing gameState fields so old saves work unchanged.
  _isTinkered(definitionId) {
    return (this._gameState._tinkeredRoomTypes ?? []).includes(definitionId)
  }
}

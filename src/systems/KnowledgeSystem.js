// Reworked knowledge system.
//
// CORE RULES
//   - Knowledge is per-adventurer, gained only through personal interaction:
//       entering a room     → room type knowledge
//       sighting a minion   → enemy type knowledge for that room
//       seeing floor loot   → loot position knowledge
//       springing a trap    → trap placement knowledge
//   - Death: personal knowledge permanently destroyed, nothing transfers.
//   - Escape: knowledge saved to survivor registry, merged into
//       gameState.knowledge.sharedPool (union of ALL survivors ever).
//   - Next day's party: every fresh adventurer starts with the full sharedPool.
//   - Veteran survivors always return the next day; their knowledge accumulates
//       run over run (personal knowledge merged on each escape).
//   - Full party wipe (zero escapes this run): sharedPool + survivor list cleared.
//
// STALENESS
//   - Dungeon mutations (ROOM_PLACED/REMOVED, TRAP_PLACED/REMOVED, MINION_PLACED/
//     DIED) mark affected entries stale=true.
//   - Stale entries are shown in UI with distinct styling but still influence
//     adventurer routing (at reduced weight).
//   - Re-interacting with a stale entry flips it back to confirmed.
//
// PATHFINDER
//   - costMultiplierForTile: confirmed trap → KNOWLEDGE_TRAP_COST_MULTIPLIER,
//     stale trap → multiplier * KNOWLEDGE_STALE_FACTOR.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

export class KnowledgeSystem {
  constructor(scene, gameState, dungeonGrid) {
    this._scene = scene
    this._gs    = gameState
    this._grid  = dungeonGrid

    _ensureState(gameState)

    EventBus.on('TRAP_TRIGGERED', this._onTrapTriggered, this)
    EventBus.on('ADVENTURER_FLED', this._onAdventurerFled, this)
    EventBus.on('ROOM_PLACED',    this._onRoomMutated,   this)
    EventBus.on('ROOM_REMOVED',   this._onRoomMutated,   this)
    EventBus.on('TRAP_PLACED',    this._onTrapMutated,   this)
    EventBus.on('TRAP_REMOVED',   this._onTrapMutated,   this)
    EventBus.on('MINION_PLACED',  this._onMinionMutated, this)
    EventBus.on('MINION_DIED',    this._onMinionMutated, this)
    // Benefit-entity removals — when the player sells a fountain / chest,
    // mark every adv's knowledge of that entity stale so the next day's
    // wave treats it as RUMOR-tier (they walk in expecting it; it's gone).
    EventBus.on('TREASURE_CHEST_REMOVED', this._onTreasureRemoved, this)
    EventBus.on('TREASURE_CHEST_OPENED',  this._onTreasureRemoved, this)
    EventBus.on('KEY_CHEST_REMOVED',      this._onKeyChestRemoved, this)
    EventBus.on('KEY_CHEST_OPENED',       this._onKeyChestRemoved, this)
  }

  destroy() {
    EventBus.off('TRAP_TRIGGERED', this._onTrapTriggered, this)
    EventBus.off('ADVENTURER_FLED', this._onAdventurerFled, this)
    EventBus.off('ROOM_PLACED',    this._onRoomMutated,   this)
    EventBus.off('ROOM_REMOVED',   this._onRoomMutated,   this)
    EventBus.off('TRAP_PLACED',    this._onTrapMutated,   this)
    EventBus.off('TRAP_REMOVED',   this._onTrapMutated,   this)
    EventBus.off('MINION_PLACED',  this._onMinionMutated, this)
    EventBus.off('MINION_DIED',    this._onMinionMutated, this)
    EventBus.off('TREASURE_CHEST_REMOVED', this._onTreasureRemoved, this)
    EventBus.off('TREASURE_CHEST_OPENED',  this._onTreasureRemoved, this)
    EventBus.off('KEY_CHEST_REMOVED',      this._onKeyChestRemoved, this)
    EventBus.off('KEY_CHEST_OPENED',       this._onKeyChestRemoved, this)
  }

  // ── Survivor access (used by DayPhase for spawning) ───────────────────────

  getSurvivors() {
    return this._gs.knowledge.survivors
  }

  // ── Observation API — called each tick / event by AISystem ───────────────

  observeCurrentRoom(adv) {
    const room = this._grid.getRoomAtTile(adv.tileX, adv.tileY)
    if (!room) return
    _ensureAdvKnowledge(adv)
    const today = this._gs.meta.dayNumber
    const entry = adv.knowledge.rooms[room.instanceId]

    if (!entry) {
      adv.knowledge.rooms[room.instanceId] = {
        roomType:        room.definitionId,
        confirmed:       true,
        stale:           false,
        visitCount:      1,
        firstVisitedDay: today,
        lastVisitedDay:  today,
      }
      // First visit picks up every benefit/utility entity in this room.
      this.observeRoomContents(adv, room)
      EventBus.emit('ROOM_OBSERVED', { adventurer: adv, roomId: room.instanceId, firstVisit: true })
    } else {
      // Phase 9 — False Maps: if this entry was scrambled and the actual
      // roomType doesn't match what intel said, the adv enrages.
      if (entry._falseMapped && entry.roomType !== room.definitionId && !adv._falseMapsRealizedAt) {
        const now = this._scene?.time?.now ?? 0
        adv._falseMapsRealizedAt = now
        adv._falseMapsRageUntil  = now + Balance.MECHANIC_FALSE_MAPS_RAGE_DURATION_MS
        EventBus.emit('FALSE_MAPS_REALIZED', { adventurer: adv, roomId: room.instanceId })
      }
      // Correct the label so they won't re-trigger on every visit.
      entry.roomType = room.definitionId
      entry._falseMapped = false
      if (entry.stale) { entry.stale = false; entry.confirmed = true }
      if (entry.lastVisitedDay !== today) {
        entry.visitCount++
        entry.lastVisitedDay = today
        EventBus.emit('ROOM_OBSERVED', { adventurer: adv, roomId: room.instanceId, firstVisit: false })
      }
    }

  }

  // Pulls every benefit/utility entity inside a room into adv.knowledge
  // the moment they enter. Adventurers shouldn't know where chests or
  // fountains are without seeing them — this is the gate for that.
  observeRoomContents(adv, room) {
    if (!adv || !room) return
    _ensureAdvKnowledge(adv)
    const today = this._gs.meta?.dayNumber ?? 0
    const inside = (e) =>
      e.tileX >= room.gridX && e.tileX < room.gridX + room.width &&
      e.tileY >= room.gridY && e.tileY < room.gridY + room.height
    for (const f of (this._gs.dungeon?.fountains ?? [])) {
      if (!inside(f)) continue
      adv.knowledge.fountains[f.instanceId] ??= {
        tileX: f.tileX, tileY: f.tileY, roomId: room.instanceId,
        confirmed: true, stale: false, dayLearned: today,
      }
    }
    for (const c of (this._gs.dungeon?.treasureChests ?? [])) {
      if (!inside(c)) continue
      adv.knowledge.treasureChests[c.instanceId] ??= {
        tileX: c.tileX, tileY: c.tileY, tier: c.tier,
        confirmed: true, stale: false, dayLearned: today,
      }
    }
    for (const c of (this._gs.dungeon?.keyChests ?? [])) {
      if (!inside(c)) continue
      adv.knowledge.keyChests[c.instanceId] ??= {
        tileX: c.tileX, tileY: c.tileY, lockId: c.lockId,
        confirmed: true, stale: false, dayLearned: today,
      }
    }
  }

  observeMinion(adv, minion) {
    if (!adv || !minion) return
    // Phase 1b.6 — Lizardman Camouflage: a camouflaged minion isn't visible
    // to advs, so they don't add to the rumour pool either.
    if (minion._camouflaged) return
    _ensureAdvKnowledge(adv)
    const today  = this._gs.meta.dayNumber
    const roomId = minion.assignedRoomId ??
      this._grid.getRoomAtTile(minion.tileX ?? 0, minion.tileY ?? 0)?.instanceId
    if (!roomId) return

    const list = adv.knowledge.enemiesPerRoom[roomId] ??= []
    const existing = list.find(e => e.minionType === minion.definitionId)
    if (!existing) {
      list.push({ minionType: minion.definitionId, confirmed: true, stale: false, dayLearned: today })
      // Phase 1b.8 — Wraith Fear Meter listens for first sightings.
      EventBus.emit('MINION_OBSERVED', { advId: adv.instanceId, minionId: minion.instanceId, roomId })
    } else if (existing.stale) {
      existing.stale = false; existing.confirmed = true
    }
  }

  // ── Trap awareness ────────────────────────────────────────────────────────

  _onTrapTriggered({ trap, roomId }) {
    if (!trap) return
    const today = this._gs.meta.dayNumber
    for (const adv of this._gs.adventurers.active) {
      if (!this._inRoom(adv, roomId)) continue
      _ensureAdvKnowledge(adv)
      adv.knowledge.traps[trap.instanceId] = {
        type:      trap.definitionId,
        tileX:     trap.tileX,
        tileY:     trap.tileY,
        confirmed: true,
        stale:     false,
        dayLearned: today,
      }
    }
    trap.isKnownToAdventurers = true
  }

  // ── Survivor handling ─────────────────────────────────────────────────────

  _onAdventurerFled({ adventurer }) {
    if (!adventurer) return
    // Pact of the Great Erasure: escapees forget the dungeon entirely —
    // no survivor record, no sharedPool contribution, no veteran return.
    if ((this._gs._mechanicFlags ?? {}).greatErasure) {
      EventBus.emit('GREAT_ERASURE_FORGOT', {
        adventurerId: adventurer.instanceId,
        name:         adventurer.name,
      })
      return
    }
    _ensureAdvKnowledge(adventurer)
    this._updateSurvivorRecord(adventurer)
    this._rebuildSharedPool()
    EventBus.emit('KNOWLEDGE_SURVIVOR_SAVED', {
      adventurerId: adventurer.instanceId,
      name:         adventurer.name,
    })
  }

  _updateSurvivorRecord(adv) {
    const survivors = this._gs.knowledge.survivors
    const idx  = survivors.findIndex(s => s.instanceId === adv.instanceId)
    const today = this._gs.meta.dayNumber

    if (idx === -1) {
      survivors.push({
        instanceId:    adv.instanceId,
        name:          adv.name,
        classId:       adv.classId,
        personalityIds: [...(adv.personalityIds ?? [])],
        sigil:         adv.sigil,
        classColor:    adv.classColor,
        runCount:      1,
        knowledge:     _deepCopy(adv.knowledge),
        pathHistory:   [...(adv.pathHistory ?? [])],
        lastSeenDay:   today,
      })
    } else {
      const rec = survivors[idx]
      rec.runCount++
      rec.lastSeenDay  = today
      rec.pathHistory  = [...(adv.pathHistory ?? [])]
      rec.knowledge    = _mergeKnowledge(rec.knowledge, adv.knowledge)
    }
  }

  _rebuildSharedPool() {
    const pool = {
      rooms: {}, traps: {}, enemiesPerRoom: {}, loot: {}, mimics: {},
      fountains: {}, treasureChests: {}, keyChests: {},
    }
    // Each pooled entry is stamped with `sharedBy` = the survivor whose
    // intel landed it in the pool. Non-stale entries win on conflict;
    // ties go to whoever was processed first. The Knowledge Map ledger
    // reads this to render "via {name}" attribution.
    for (const s of this._gs.knowledge.survivors) {
      const k    = s.knowledge
      const name = s.name ?? '???'
      for (const [id, e] of Object.entries(k.rooms ?? {})) {
        if (!pool.rooms[id] || (!e.stale && pool.rooms[id].stale)) {
          pool.rooms[id] = { ...e, sharedBy: name }
        }
      }
      for (const [id, e] of Object.entries(k.traps ?? {})) {
        if (!pool.traps[id] || (!e.stale && pool.traps[id].stale)) {
          pool.traps[id] = { ...e, sharedBy: name }
        }
      }
      for (const [roomId, list] of Object.entries(k.enemiesPerRoom ?? {})) {
        pool.enemiesPerRoom[roomId] ??= []
        for (const e of list) {
          const ex = pool.enemiesPerRoom[roomId].find(x => x.minionType === e.minionType)
          if (!ex) pool.enemiesPerRoom[roomId].push({ ...e, sharedBy: name })
          else if (!e.stale && ex.stale) {
            ex.stale = false; ex.confirmed = true; ex.sharedBy = name
          }
        }
      }
      for (const [id, e] of Object.entries(k.loot ?? {})) {
        if (!pool.loot[id] || (!e.stale && pool.loot[id].stale)) {
          pool.loot[id] = { ...e, sharedBy: name }
        }
      }
      for (const [id, e] of Object.entries(k.mimics ?? {})) {
        if (!pool.mimics[id] || (!e.stale && pool.mimics[id].stale)) {
          pool.mimics[id] = { ...e, sharedBy: name }
        }
      }
      // Benefits/utility entities — same merge rule + sharedBy stamp.
      for (const bucket of ['fountains', 'treasureChests', 'keyChests']) {
        for (const [id, e] of Object.entries(k[bucket] ?? {})) {
          if (!pool[bucket][id] || (!e.stale && pool[bucket][id].stale)) {
            pool[bucket][id] = { ...e, sharedBy: name }
          }
        }
      }
    }
    this._gs.knowledge.sharedPool = pool
  }

  // ── End-of-day (called by DayPhase._endDay before transitioning) ──────────

  processEndOfDay() {
    const today = this._gs.meta.dayNumber
    const hadSurvivors = this._gs.knowledge.survivors.some(s => s.lastSeenDay === today)
    if (!hadSurvivors) {
      this._gs.knowledge.sharedPool = { rooms: {}, traps: {}, enemiesPerRoom: {}, loot: {}, mimics: {} }
      this._gs.knowledge.survivors  = []
      EventBus.emit('KNOWLEDGE_PARTY_WIPED')
    }
  }

  // ── Knowledge initialization (called by DayPhase on spawn) ───────────────

  // Fresh adventurer inherits a fraction of the shared pool. `inheritFraction`
  // = 1.0 (default) copies the whole thing — used when a returning veteran is
  // briefing the rest of the party. < 1 rolls each entry independently so
  // a wave of strangers ends up with patchy, varied mental maps.
  initKnowledgeForSpawn(adv, inheritFraction = 1.0) {
    const pool = this._gs.knowledge?.sharedPool
    if (!pool) { _ensureAdvKnowledge(adv); return }
    if (inheritFraction >= 1) {
      adv.knowledge = _deepCopy(pool)
      _ensureAdvKnowledge(adv)
      return
    }
    const fresh = {
      rooms: {}, traps: {}, enemiesPerRoom: {}, loot: {}, mimics: {},
      fountains: {}, treasureChests: {}, keyChests: {},
    }
    // Per-entry roll. enemiesPerRoom is an array per room; roll each minion
    // type independently so a fresh adv might know a Skeleton lurks in the
    // Crypt without knowing about its Goblin roommate.
    for (const bucket of Object.keys(fresh)) {
      const src = pool[bucket] ?? {}
      if (bucket === 'enemiesPerRoom') {
        for (const [id, list] of Object.entries(src)) {
          const filtered = (list ?? []).filter(() => Math.random() < inheritFraction)
          if (filtered.length) fresh[bucket][id] = filtered.map(e => ({ ...e }))
        }
      } else {
        for (const [id, e] of Object.entries(src)) {
          if (Math.random() < inheritFraction) fresh[bucket][id] = { ...e }
        }
      }
    }
    adv.knowledge = fresh
  }

  // Returning veteran: restore accumulated knowledge + flag as veteran.
  initKnowledgeForSurvivor(adv, survivorRecord) {
    adv.knowledge        = _deepCopy(survivorRecord.knowledge)
    adv.flags           ??= {}
    adv.flags.returningVeteran = true
    adv.flags.runsCompleted    = survivorRecord.runCount
  }

  // ── Dungeon mutation → stale knowledge ────────────────────────────────────

  _onRoomMutated({ room }) {
    if (!room?.instanceId) return
    _setStaleInPool(this._gs.knowledge, 'rooms', room.instanceId)
    for (const s of this._gs.knowledge.survivors) {
      if (s.knowledge?.rooms?.[room.instanceId]) s.knowledge.rooms[room.instanceId].stale = true
    }
  }

  _onTrapMutated({ trap }) {
    if (!trap?.instanceId) return
    _setStaleInPool(this._gs.knowledge, 'traps', trap.instanceId)
    for (const s of this._gs.knowledge.survivors) {
      if (s.knowledge?.traps?.[trap.instanceId]) s.knowledge.traps[trap.instanceId].stale = true
    }
  }

  _onTreasureRemoved({ chest }) {
    const id = chest?.instanceId
    if (!id) return
    _setStaleInPool(this._gs.knowledge, 'treasureChests', id)
    for (const s of this._gs.knowledge.survivors) {
      if (s.knowledge?.treasureChests?.[id]) s.knowledge.treasureChests[id].stale = true
    }
    for (const a of this._gs.adventurers?.active ?? []) {
      if (a.knowledge?.treasureChests?.[id]) a.knowledge.treasureChests[id].stale = true
    }
  }

  _onKeyChestRemoved({ chest }) {
    const id = chest?.instanceId
    if (!id) return
    _setStaleInPool(this._gs.knowledge, 'keyChests', id)
    for (const s of this._gs.knowledge.survivors) {
      if (s.knowledge?.keyChests?.[id]) s.knowledge.keyChests[id].stale = true
    }
    for (const a of this._gs.adventurers?.active ?? []) {
      if (a.knowledge?.keyChests?.[id]) a.knowledge.keyChests[id].stale = true
    }
  }

  _onMinionMutated({ minion }) {
    const roomId = minion?.assignedRoomId
    if (!roomId) return
    for (const e of this._gs.knowledge.sharedPool?.enemiesPerRoom?.[roomId] ?? []) {
      if (!minion.definitionId || e.minionType === minion.definitionId) e.stale = true
    }
    for (const s of this._gs.knowledge.survivors) {
      for (const e of s.knowledge?.enemiesPerRoom?.[roomId] ?? []) {
        if (!minion.definitionId || e.minionType === minion.definitionId) e.stale = true
      }
    }
  }

  // ── Tier classification ───────────────────────────────────────────────────
  //
  // Maps a knowledge-pool entry to one of FULL / PARTIAL / RUMOR (or null
  // for missing). Used by both the Knowledge Map popup (visual coloring)
  // and the pathfinder cost wrapper (avoidance weight). Stale entries
  // collapse to RUMOR; non-stale entries split into FULL (≤ N days old)
  // vs PARTIAL (older). Date sources differ per entry type:
  //   rooms          → lastVisitedDay
  //   traps / enemies → dayLearned
  //   loot / mimics  → dayLearned (or lastVisitedDay if present)
  tierForEntry(entry) {
    if (!entry) return null
    if (entry.stale) return 'RUMOR'
    const today = this._gs?.meta?.dayNumber ?? 0
    const day   = entry.lastVisitedDay ?? entry.dayLearned ?? today
    const ageDays = Math.max(0, today - day)
    return (ageDays <= Balance.KNOWLEDGE_FULL_MAX_AGE_DAYS) ? 'FULL' : 'PARTIAL'
  }

  // Returns the cost-multiplier scalar for a given tier (1.0 = no change,
  // higher = more avoided). Pathfinder applies this on top of base trap
  // cost so adventurers route around FULL-tier traps the most aggressively
  // and only lightly avoid RUMOR-tier ones.
  costMultiplierForTier(tier) {
    if (tier === 'FULL')    return Balance.KNOWLEDGE_TIER_FULL_MULT
    if (tier === 'PARTIAL') return Balance.KNOWLEDGE_TIER_PARTIAL_MULT
    if (tier === 'RUMOR')   return Balance.KNOWLEDGE_TIER_RUMOR_MULT
    return 0   // UNKNOWN — no avoidance weight
  }

  // ── Pathfinder hook ───────────────────────────────────────────────────────

  costMultiplierForTile(adv, tx, ty) {
    if (!adv?.knowledge) return 1

    // Locked-door block (unchanged from old system)
    const room = this._grid.getRoomAtTile(tx, ty)
    if (room?.locked) return 9999

    // Trap weight first — if the tile has a known trap, that always wins
    // over room-level minion routing (it's the more localized hazard).
    for (const t of Object.values(adv.knowledge.traps ?? {})) {
      if (!t || t.tileX !== tx || t.tileY !== ty) continue
      const tier  = this.tierForEntry(t)
      if (!tier) return 1
      const scale = this.costMultiplierForTier(tier)
      return 1 + (Balance.KNOWLEDGE_TRAP_COST_MULTIPLIER - 1) * scale
    }
    // Minion-room weight — if this tile is in a room the adv knows
    // contains enemies, route around it (scaled by tier). The freshest
    // entry in the room's enemy list wins for tier purposes.
    if (room?.instanceId) {
      const list = adv.knowledge.enemiesPerRoom?.[room.instanceId]
      if (Array.isArray(list) && list.length > 0) {
        let bestTier = null
        const rank = { FULL: 0, PARTIAL: 1, RUMOR: 2 }
        for (const e of list) {
          const tier = this.tierForEntry(e)
          if (!tier) continue
          if (bestTier == null || (rank[tier] ?? 9) < (rank[bestTier] ?? 9)) {
            bestTier = tier
          }
        }
        if (bestTier) {
          const scale = this.costMultiplierForTier(bestTier)
          return 1 + (Balance.KNOWLEDGE_DANGER_ROOM_MULT - 1) * scale
        }
      }
    }
    return 1
  }

  // ── Stats API for KnowledgeScreen UI ─────────────────────────────────────

  // Build a UI-facing pool that's the union of the persisted
  // sharedPool (survivor-derived, only refreshed at day end) AND every
  // currently-active adventurer's in-progress per-adv knowledge.  This
  // is what lets the Knowledge overlay / Threat Assessment screen
  // reflect exploration in real time — without this union, the UI
  // would only ever show what last day's survivors learned, even
  // while today's party is actively walking through new rooms.
  //
  // Persisted state is NOT mutated here.  This method builds a fresh
  // union object each call.  The data set is small (handful of rooms /
  // traps / loot per adv × small party), so the cost is trivial.
  //
  // Merge rule for staleness: the freshest observation wins.  If any
  // adv (or the shared pool) has a non-stale entry, the union entry
  // is non-stale.  This matches the "any party member who confirmed
  // it just now overrides any stale memory" behaviour the player
  // expects from a live feed.
  _livePool() {
    const sp = this._gs.knowledge?.sharedPool ?? {}
    const pool = {
      rooms:          { ...(sp.rooms          ?? {}) },
      traps:          { ...(sp.traps          ?? {}) },
      enemiesPerRoom: {},
      loot:           { ...(sp.loot           ?? {}) },
    }
    // Deep-copy the per-room enemy lists since we mutate them below.
    for (const [roomId, list] of Object.entries(sp.enemiesPerRoom ?? {})) {
      pool.enemiesPerRoom[roomId] = list.map(e => ({ ...e }))
    }
    const advs = this._gs.adventurers?.active ?? []
    for (const adv of advs) {
      const k = adv?.knowledge
      if (!k) continue
      // Rooms — overwrite stale entries with non-stale; otherwise add.
      for (const [id, e] of Object.entries(k.rooms ?? {})) {
        const ex = pool.rooms[id]
        if (!ex || (!e.stale && ex.stale)) pool.rooms[id] = { ...e }
      }
      // Traps — same merge rule.
      for (const [id, e] of Object.entries(k.traps ?? {})) {
        const ex = pool.traps[id]
        if (!ex || (!e.stale && ex.stale)) pool.traps[id] = { ...e }
      }
      // Per-room enemy sightings — append unique types, refresh stale.
      for (const [roomId, list] of Object.entries(k.enemiesPerRoom ?? {})) {
        const dest = pool.enemiesPerRoom[roomId] ??= []
        for (const e of list) {
          const ex = dest.find(x => x.minionType === e.minionType)
          if (!ex) dest.push({ ...e })
          else if (!e.stale && ex.stale) { ex.stale = false; ex.confirmed = true }
        }
      }
      // Loot — same merge rule.
      for (const [id, e] of Object.entries(k.loot ?? {})) {
        const ex = pool.loot[id]
        if (!ex || (!e.stale && ex.stale)) pool.loot[id] = { ...e }
      }
    }
    return pool
  }

  computeKnowledgeStats() {
    const pool     = this._livePool()
    const allRooms = this._gs.dungeon.rooms ?? []
    let confirmed = 0, stale = 0, confirmedTraps = 0, staleTraps = 0
    let confirmedLoot = 0, confirmedEnemyRooms = 0

    for (const r of allRooms) {
      const e = pool.rooms?.[r.instanceId]
      if (!e) continue
      e.stale ? stale++ : confirmed++
    }
    for (const t of Object.values(pool.traps ?? {})) t.stale ? staleTraps++ : confirmedTraps++
    for (const l of Object.values(pool.loot ?? {})) { if (!l.stale) confirmedLoot++ }
    for (const list of Object.values(pool.enemiesPerRoom ?? {})) {
      if (list.some(e => !e.stale)) confirmedEnemyRooms++
    }

    const total = allRooms.length
    return {
      percentage:          total > 0 ? Math.round(100 * (confirmed + stale) / total) : 0,
      confirmedRooms:      confirmed,
      staleRooms:          stale,
      totalRooms:          total,
      confirmedTraps,      staleTraps,
      confirmedLoot,       confirmedEnemyRooms,
    }
  }

  // 'confirmed' | 'stale' | 'unknown'
  getRoomKnowledgeState(roomId) {
    const e = this._livePool().rooms?.[roomId]
    if (!e) return 'unknown'
    return e.stale ? 'stale' : 'confirmed'
  }

  getRoomKnowledgeDetails(roomId) {
    const pool = this._livePool()
    const room = this._gs.dungeon.rooms.find(r => r.instanceId === roomId)
    const traps = room
      ? Object.values(pool.traps ?? {}).filter(t =>
          t.tileX >= room.gridX && t.tileX < room.gridX + room.width &&
          t.tileY >= room.gridY && t.tileY < room.gridY + room.height)
      : []
    return {
      room:    pool.rooms?.[roomId] ?? null,
      traps,
      enemies: pool.enemiesPerRoom?.[roomId] ?? [],
      loot:    Object.values(pool.loot ?? {}).filter(l => l.roomId === roomId),
    }
  }

  // ── Legacy compat kept for KnowledgeOverlay ───────────────────────────────

  computeKnowledgeMap() {
    const heat = {}
    const pool = this._livePool()
    for (const [roomId, e] of Object.entries(pool.rooms ?? {})) {
      heat[roomId] = e.stale ? 0.5 : 1.0
    }
    return heat
  }

  hasVisitedRoom(adv, roomId) {
    return !!(adv?.knowledge?.rooms?.[roomId])
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _inRoom(adv, roomId) {
    const room = this._gs.dungeon.rooms.find(r => r.instanceId === roomId)
    if (!room) return false
    return adv.tileX >= room.gridX && adv.tileX < room.gridX + room.width &&
           adv.tileY >= room.gridY && adv.tileY < room.gridY + room.height
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function _ensureState(gs) {
  const empty = () => ({
    rooms: {}, traps: {}, enemiesPerRoom: {}, loot: {}, mimics: {},
    fountains: {}, treasureChests: {}, keyChests: {},
  })
  gs.knowledge ??= { sharedPool: empty(), survivors: [], partyWipeOccurred: false }
  gs.knowledge.sharedPool ??= empty()
  // Backfill new buckets onto an older save's pool so it doesn't choke
  // when we read fountains/chests from a save that predates this schema.
  for (const k of ['fountains', 'treasureChests', 'keyChests']) {
    gs.knowledge.sharedPool[k] ??= {}
  }
  gs.knowledge.survivors ??= []
}

function _ensureAdvKnowledge(adv) {
  adv.knowledge ??= {}
  adv.knowledge.rooms          ??= {}
  adv.knowledge.traps          ??= {}
  adv.knowledge.enemiesPerRoom ??= {}
  adv.knowledge.loot           ??= {}
  adv.knowledge.mimics         ??= {}
  // Benefit/utility entities. Adventurers gain entries on first sighting;
  // gated AI lookups in AISystem read these dicts so they only seek what
  // they know about.
  adv.knowledge.fountains      ??= {}
  adv.knowledge.treasureChests ??= {}
  adv.knowledge.keyChests      ??= {}
}

function _deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj ?? {}))
}

function _mergeKnowledge(base, incoming) {
  const merged = _deepCopy(base)
  _ensureAdvKnowledge(merged)

  for (const [id, e] of Object.entries(incoming.rooms ?? {})) {
    if (!merged.rooms[id] || (!e.stale && merged.rooms[id].stale)) {
      merged.rooms[id] = { ...e }
    } else if (merged.rooms[id]) {
      merged.rooms[id].visitCount    = (merged.rooms[id].visitCount ?? 0) + (e.visitCount ?? 0)
      merged.rooms[id].lastVisitedDay = Math.max(merged.rooms[id].lastVisitedDay ?? 0, e.lastVisitedDay ?? 0)
      if (!e.stale) merged.rooms[id].stale = false
    }
  }
  for (const [id, e] of Object.entries(incoming.traps ?? {})) {
    if (!merged.traps[id] || (!e.stale && merged.traps[id].stale)) merged.traps[id] = { ...e }
  }
  for (const [roomId, list] of Object.entries(incoming.enemiesPerRoom ?? {})) {
    merged.enemiesPerRoom[roomId] ??= []
    for (const e of list) {
      const ex = merged.enemiesPerRoom[roomId].find(x => x.minionType === e.minionType)
      if (!ex) merged.enemiesPerRoom[roomId].push({ ...e })
      else if (!e.stale && ex.stale) { ex.stale = false; ex.confirmed = true }
    }
  }
  for (const [id, e] of Object.entries(incoming.loot ?? {})) {
    if (!merged.loot[id] || (!e.stale && merged.loot[id].stale)) merged.loot[id] = { ...e }
  }
  // Benefit/utility merges — same overwrite-if-fresher pattern as above.
  for (const bucket of ['fountains', 'treasureChests', 'keyChests']) {
    for (const [id, e] of Object.entries(incoming[bucket] ?? {})) {
      if (!merged[bucket][id] || (!e.stale && merged[bucket][id].stale)) {
        merged[bucket][id] = { ...e }
      }
    }
  }
  return merged
}

function _setStaleInPool(knowledge, category, id) {
  if (knowledge?.sharedPool?.[category]?.[id]) {
    knowledge.sharedPool[category][id].stale = true
  }
}


// Reworked knowledge system.
//
// CORE RULES
//   - Knowledge is per-adventurer, gained only through personal interaction:
//       entering a room     → room type knowledge
//       entering a room     → benefit/utility + placed-item knowledge for
//                             every entity inside (fountains, chests, AND the
//                             generic `items` bucket — phylactery, beacons)
//       sighting a minion   → enemy type knowledge for that room
//       seeing floor loot   → buff-pile knowledge (live-only, not pooled)
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
    EventBus.on('ADVENTURER_DIED', this._onAdventurerDied, this)
    // Cheater wallhack — the modded client comes pre-loaded with every
    // trap location and every minion in the dungeon. Pre-populates the
    // adv's knowledge entries at FULL tier on entry so the pathfinder
    // routes them around known threats from tick 1 (no learning curve).
    EventBus.on('ADVENTURER_ENTERED_DUNGEON', this._onAdventurerEnteredForWallhack, this)
    EventBus.on('ROOM_PLACED',    this._onRoomMutated,   this)
    EventBus.on('ROOM_REMOVED',   this._onRoomMutated,   this)
    EventBus.on('TRAP_PLACED',    this._onTrapMutated,   this)
    EventBus.on('TRAP_REMOVED',   this._onTrapMutated,   this)
    EventBus.on('MINION_PLACED',  this._onMinionMutated, this)
    EventBus.on('MINION_DIED',    this._onMinionMutated, this)
    // Adaptive learning — every adv in the boss chamber faces the boss.
    EventBus.on('BOSS_FIGHT_STARTED', this._onBossFightStartedForBestiary, this)
    // Benefit-entity removals — when the player sells a fountain / chest,
    // mark every adv's knowledge of that entity stale so the next day's
    // wave treats it as RUMOR-tier (they walk in expecting it; it's gone).
    EventBus.on('TREASURE_CHEST_REMOVED', this._onTreasureRemoved, this)
    EventBus.on('TREASURE_CHEST_OPENED',  this._onTreasureRemoved, this)
    EventBus.on('KEY_CHEST_REMOVED',      this._onKeyChestRemoved, this)
    EventBus.on('KEY_CHEST_OPENED',       this._onKeyChestRemoved, this)
    // Generic placed-item removals — phylactery (sold/moved or hunted to
    // death) + soul-bound beacon (sold). Same staleness contract as the
    // chest handlers: the next wave still expects the item to be there.
    EventBus.on('PHYLACTERY_REMOVED',     this._onItemEntityRemoved, this)
    EventBus.on('PHYLACTERY_DESTROYED',   this._onItemEntityRemoved, this)
    EventBus.on('BEACON_REMOVED',         this._onItemEntityRemoved, this)
    // Floor loot — buff-piles dropped by corpses. Transient (cleared each
    // night), so loot intel is live-only; we still drop the entry the
    // moment a pile is looted so the live readout never shows a ghost.
    EventBus.on('LOOT_PILE_REMOVED',      this._onLootPileRemoved, this)
    // Knowledge Map "SCRUB INTEL" button — player spends gold to wipe a
    // room from the shared knowledge pool so the next wave walks in blind.
    EventBus.on('KNOWLEDGE_SCRUB_REQUEST', this._onScrubRequest, this)
    // Doctrine "SCRUB DOCTRINE" button — player spends gold to make the kingdom
    // FORGET a studied monster type (drops their counters until re-faced).
    EventBus.on('BESTIARY_SCRUB_REQUEST', this._onBestiaryScrubRequest, this)
    // Dungeon event: Memory Plague — wipe the entire shared pool.
    EventBus.on('KNOWLEDGE_WIPE_ALL', this._onWipeAll, this)
  }

  destroy() {
    EventBus.off('TRAP_TRIGGERED', this._onTrapTriggered, this)
    EventBus.off('ADVENTURER_FLED', this._onAdventurerFled, this)
    EventBus.off('ADVENTURER_DIED', this._onAdventurerDied, this)
    EventBus.off('ROOM_PLACED',    this._onRoomMutated,   this)
    EventBus.off('ROOM_REMOVED',   this._onRoomMutated,   this)
    EventBus.off('TRAP_PLACED',    this._onTrapMutated,   this)
    EventBus.off('TRAP_REMOVED',   this._onTrapMutated,   this)
    EventBus.off('MINION_PLACED',  this._onMinionMutated, this)
    EventBus.off('MINION_DIED',    this._onMinionMutated, this)
    EventBus.off('BOSS_FIGHT_STARTED', this._onBossFightStartedForBestiary, this)
    EventBus.off('TREASURE_CHEST_REMOVED', this._onTreasureRemoved, this)
    EventBus.off('TREASURE_CHEST_OPENED',  this._onTreasureRemoved, this)
    EventBus.off('KEY_CHEST_REMOVED',      this._onKeyChestRemoved, this)
    EventBus.off('KEY_CHEST_OPENED',       this._onKeyChestRemoved, this)
    EventBus.off('PHYLACTERY_REMOVED',     this._onItemEntityRemoved, this)
    EventBus.off('PHYLACTERY_DESTROYED',   this._onItemEntityRemoved, this)
    EventBus.off('BEACON_REMOVED',         this._onItemEntityRemoved, this)
    EventBus.off('LOOT_PILE_REMOVED',      this._onLootPileRemoved, this)
    EventBus.off('KNOWLEDGE_SCRUB_REQUEST', this._onScrubRequest, this)
    EventBus.off('BESTIARY_SCRUB_REQUEST', this._onBestiaryScrubRequest, this)
    EventBus.off('KNOWLEDGE_WIPE_ALL', this._onWipeAll, this)
  }

  // Dungeon event: Memory Plague — erase every survivor's recorded intel
  // so the shared pool empties out and the next wave walks in blind.
  _onWipeAll() {
    if (!this._gs.knowledge) return
    this._gs.knowledge.survivors = []
    this._rebuildSharedPool()
    EventBus.emit('KNOWLEDGE_POOL_WIPED', {})
  }

  // ── Survivor access (used by DayPhase for spawning) ───────────────────────

  getSurvivors() {
    return this._gs.knowledge.survivors
  }

  // Phase 8 — pick a fled survivor to personally return the next day as a
  // veteran leading the wave (carrying their accumulated knowledge, which
  // briefs the whole party). Chance-gated; only survivors who fled within
  // KNOWLEDGE_RETURN_MAX_AGE_DAYS are eligible — older intel-holders just
  // keep feeding the shared pool passively. Returns a survivor record or
  // null. DayPhase consumes the record in its returning-leader block.
  rollReturnLeader() {
    const survivors = this._gs.knowledge?.survivors ?? []
    if (survivors.length === 0) return null
    if (Math.random() >= Balance.KNOWLEDGE_RETURN_CHANCE) return null
    const today = this._gs.meta?.dayNumber ?? 0
    const eligible = survivors.filter(s =>
      // Event-specific adventurers never return as a Hero (see noReturn
      // in _updateSurvivorRecord).
      !s.noReturn &&
      (today - (s.lastSeenDay ?? today)) <= Balance.KNOWLEDGE_RETURN_MAX_AGE_DAYS)
    if (eligible.length === 0) return null
    return eligible[Math.floor(Math.random() * eligible.length)]
  }

  // ── Observation API — called each tick / event by AISystem ───────────────

  // Dungeon event: Dense Fog — while it's active every scrap of intel an
  // adventurer picks up registers only as a vague RUMOR (stale), and a
  // re-visit can't sharpen it. Exposure barely climbs through the fog.
  _fogActive() { return !!this._gs?._eventFlags?.denseFogActive }

  observeCurrentRoom(adv) {
    const room = this._grid.getRoomAtTile(adv.tileX, adv.tileY)
    if (!room) return
    _ensureAdvKnowledge(adv)
    const today = this._gs.meta.dayNumber
    const entry = adv.knowledge.rooms[room.instanceId]

    if (!entry) {
      const fog = this._fogActive()
      adv.knowledge.rooms[room.instanceId] = {
        roomType:        room.definitionId,
        confirmed:       !fog,
        stale:           fog,
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
      if (entry.stale && !this._fogActive()) { entry.stale = false; entry.confirmed = true }
      if (entry.lastVisitedDay !== today) {
        entry.visitCount++
        entry.lastVisitedDay = today
        EventBus.emit('ROOM_OBSERVED', { adventurer: adv, roomId: room.instanceId, firstVisit: false })
      }
    }
    // Floor-loot scan — runs every tick (not just first visit) so buff-piles
    // dropped after this adv entered the room are still picked up.
    this._observeRoomLoot(adv, room)
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
    // Mimics perceived as chests — every Mimic minion in 'chest' state
    // inside this room registers in the adv's treasureChests map with
    // an `_isMimic` marker. The adv treats it as an ordinary chest for
    // pathing + tempt purposes; the kill-on-open branch in AISystem
    // detects the flag and routes to the mimic-spring path. Knowledge
    // that a specific mimic IS a mimic (after surviving a kill) lives
    // separately on `knowledge.mimics[id]` and beats the disguise.
    for (const m of (this._gs.minions ?? [])) {
      if (!m.isMimic || m.mimicState !== 'chest') continue
      if (m.aiState === 'dead') continue
      if (!inside(m)) continue
      adv.knowledge.treasureChests[m.instanceId] ??= {
        tileX: m.tileX, tileY: m.tileY, tier: m.chestTier ?? 1,
        _isMimic: true, _mimicInstanceId: m.instanceId,
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
    // Generic `items` bucket — every placed item-entity that doesn't have
    // a dedicated bucket above. Currently the Lich phylactery heart (single,
    // stored on `gameState.phylactery`) and soul-bound beacons (array on
    // `gameState.dungeon.beacons`). Keyed by instanceId, the same shape the
    // chest buckets use so the merge / live-pool / stale code treats them
    // uniformly. Door locks are doorway-attached (no room interior tile),
    // so they aren't scanned here.
    for (const it of this._itemEntities()) {
      if (!inside(it)) continue
      adv.knowledge.items[it.instanceId] ??= {
        itemType: it.itemType, tileX: it.tileX, tileY: it.tileY,
        roomId:   room.instanceId,
        confirmed: true, stale: false, dayLearned: today,
      }
    }
  }

  // Flattened list of every placed item-entity tracked by the generic
  // `items` bucket. Each entry is normalised to { instanceId, itemType,
  // tileX, tileY } so observeRoomContents / staleness can treat the
  // phylactery (a singleton on gameState.phylactery) and beacons (an
  // array on gameState.dungeon.beacons) identically.
  _itemEntities() {
    const out = []
    const phyl = this._gs.phylactery
    if (phyl && phyl.instanceId != null && phyl.tileX != null) {
      out.push({
        instanceId: phyl.instanceId,
        itemType:   phyl.definitionId ?? 'phylactery_heart',
        tileX:      phyl.tileX, tileY: phyl.tileY,
      })
    }
    for (const b of (this._gs.dungeon?.beacons ?? [])) {
      if (!b || b.instanceId == null || b.tileX == null) continue
      out.push({
        instanceId: b.instanceId,
        itemType:   b.definitionId ?? 'soul_bound_beacon',
        tileX:      b.tileX, tileY: b.tileY,
      })
    }
    return out
  }

  // Floor-loot observation — records every buff-pile sitting inside `room`
  // into adv.knowledge.loot. Loot piles are dropped by fallen adventurers
  // mid-raid and cleared each night, so this intel is LIVE-ONLY: it feeds
  // _livePool (the live HUD readout) but is never merged into the persistent
  // sharedPool or carried out by returning veterans. Keyed by pile id.
  _observeRoomLoot(adv, room) {
    if (!adv || !room) return
    _ensureAdvKnowledge(adv)
    const today = this._gs.meta?.dayNumber ?? 0
    for (const pile of (this._gs.dungeon?.lootPiles ?? [])) {
      if (!pile || pile.tileX == null) continue
      if (pile.tileX < room.gridX || pile.tileX >= room.gridX + room.width ||
          pile.tileY < room.gridY || pile.tileY >= room.gridY + room.height) continue
      adv.knowledge.loot[pile.instanceId] ??= {
        label:  pile.buff?.label ?? 'Loot',
        tileX:  pile.tileX, tileY: pile.tileY,
        roomId: room.instanceId,
        confirmed: true, stale: false, dayLearned: today,
      }
    }
  }

  // A looted pile is gone for good — drop it from every active adventurer's
  // knowledge so the live loot readout doesn't show a phantom pile.
  _onLootPileRemoved({ pile } = {}) {
    const id = pile?.instanceId
    if (!id) return
    for (const a of this._gs.adventurers?.active ?? []) {
      if (a.knowledge?.loot?.[id]) delete a.knowledge.loot[id]
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
      const fog = this._fogActive()
      list.push({ minionType: minion.definitionId, confirmed: !fog, stale: fog, dayLearned: today })
      // Phase 1b.8 — Wraith Fear Meter listens for first sightings.
      EventBus.emit('MINION_OBSERVED', { advId: adv.instanceId, minionId: minion.instanceId, roomId })
    } else if (existing.stale && !this._fogActive()) {
      existing.stale = false; existing.confirmed = true
    }
    // Adaptive learning — record that this adv FACED this minion's TYPE
    // (family). Committed to the kingdom's bestiary only if the adv escapes.
    this._recordEnemyFaced(adv, this._enemyFamily(minion.definitionId),
      (minion.abilities ?? []).map(a => a?.type).filter(Boolean), today)
  }

  // ── Adaptive-learning bestiary feed ───────────────────────────────────────
  // Enemy TYPE key: a minion family (golem1/2/3 → "golem") or "boss:<archetype>".
  _enemyFamily(defId) {
    const id = String(defId ?? '')
    return id.replace(/\d+$/, '') || id
  }
  // Record (on the ADVENTURER, this run) that they faced an enemy type. Reveal
  // is binary (known=true on first facing); daysFaced increments once per new
  // day (cumulative exposure → kingdom mastery after they escape). Nothing is
  // committed to the shared pool here — that happens on escape via
  // _updateSurvivorRecord → _rebuildSharedPool.
  _recordEnemyFaced(adv, typeKey, abilities = [], today = this._gs.meta?.dayNumber ?? 0) {
    if (!adv || !typeKey) return
    _ensureAdvKnowledge(adv)
    const e = adv.knowledge.bestiary[typeKey] ??= { type: typeKey, known: true, daysFaced: 0, abilities: {}, lastFacedDay: 0 }
    e.known = true
    for (const a of abilities) if (a) e.abilities[a] = true
    if ((e.lastFacedDay ?? 0) < today) { e.daysFaced = (e.daysFaced ?? 0) + 1; e.lastFacedDay = today }
  }
  // Boss-fight start — every adv in the boss chamber is now FACING the boss;
  // if they survive and escape, the kingdom learns the boss archetype.
  _onBossFightStartedForBestiary() {
    const archetype = this._gs.player?.bossArchetypeId
    if (!archetype) return
    const today = this._gs.meta?.dayNumber ?? 0
    const bossRoom = (this._gs.dungeon?.rooms ?? []).find(r => r.definitionId === 'boss_chamber')
    for (const adv of (this._gs.adventurers?.active ?? [])) {
      if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      if (bossRoom && !this._inRoom(adv, bossRoom.instanceId)) continue
      this._recordEnemyFaced(adv, `boss:${archetype}`, [], today)
    }
  }

  // ── Trap awareness ────────────────────────────────────────────────────────

  // Cheater wallhack — runs on ADVENTURER_ENTERED_DUNGEON. For a
  // cheater, stamp the full dungeon's trap + minion-per-room intel
  // directly into their knowledge map at FULL tier. PathfinderSystem
  // then weights routes around them from tick 1 (no learning curve,
  // no chat-line "got warned" feedback). Other classes still get
  // intel the normal way via the shared-pool inheritance.
  _onAdventurerEnteredForWallhack({ adventurer }) {
    if (!adventurer || adventurer.classId !== 'cheater') return
    _ensureAdvKnowledge(adventurer)
    const today = this._gs.meta?.dayNumber ?? 1
    // Every armed trap at FULL tier.
    for (const trap of (this._gs.dungeon?.traps ?? [])) {
      if (!trap || trap._disabledThisDay) continue
      adventurer.knowledge.traps[trap.instanceId] = {
        type:      trap.definitionId,
        tileX:     trap.tileX,
        tileY:     trap.tileY,
        footprint: trap.footprint ?? { w: 1, h: 1 },
        dangerTiles: this._trapDangerTiles(trap),
        confirmed: true,
        stale:     false,
        dayLearned: today,
      }
    }
    // Every minion's home room at FULL tier (per-room enemy list).
    for (const m of (this._gs.minions ?? [])) {
      if (!m || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.faction !== 'dungeon') continue
      const roomId = m.assignedRoomId
      if (!roomId) continue
      const list = adventurer.knowledge.enemiesPerRoom[roomId] ??= []
      list.push({
        type:       m.definitionId,
        instanceId: m.instanceId,
        confirmed:  true,
        stale:      false,
        dayLearned: today,
      })
    }
  }

  _onTrapTriggered({ trap, roomId }) {
    if (!trap) return
    const today = this._gs.meta.dayNumber
    const dangerTiles = this._trapDangerTiles(trap)
    for (const adv of this._gs.adventurers.active) {
      if (!this._inRoom(adv, roomId)) continue
      _ensureAdvKnowledge(adv)
      adv.knowledge.traps[trap.instanceId] = {
        type:      trap.definitionId,
        tileX:     trap.tileX,
        tileY:     trap.tileY,
        footprint: trap.footprint ?? { w: 1, h: 1 },
        dangerTiles,
        confirmed: true,
        stale:     false,
        dayLearned: today,
      }
    }
    trap.isKnownToAdventurers = true
    // Durable — seed the shared pool so the trap's location outlives the
    // adventurer who sprang it (future waves inherit it like room intel).
    this._seedTriggeredTraps(this._gs.knowledge?.sharedPool)
  }

  // ── Survivor handling ─────────────────────────────────────────────────────

  _onAdventurerFled({ adventurer }) {
    if (!adventurer) return
    // Loot Goblins are raiders, not adventurers — they come for gold,
    // not intel. They never carry knowledge out, never seed the shared
    // pool (no INTEL_LEAKED, no exposure), and never become a survivor
    // that could return as a veteran. Skip them entirely.
    if (adventurer.classId === 'loot_goblin') return
    // The Saboteur is here to wreck traps, not study the dungeon — they
    // leave with zero intel: no survivor record, no shared-pool feed.
    if (adventurer._saboteur) return
    // Monster invaders (zombie horde, rival-dungeon enemies + boss) are
    // not Guild adventurers — they don't report to anyone. They never
    // retain knowledge, never feed the shared intel pool, never become a
    // survivor, and never fire INTEL_LEAKED (so the post-wave summary,
    // dungeon log, and toasts won't claim they "carried intel back").
    if (adventurer._monster) return
    // Pact of the Great Erasure: escapees forget the dungeon entirely —
    // no survivor record, no sharedPool contribution, no veteran return.
    if ((this._gs._mechanicFlags ?? {}).greatErasure) {
      EventBus.emit('GREAT_ERASURE_FORGOT', {
        adventurerId: adventurer.instanceId,
        name:         adventurer.name,
      })
      return
    }
    // Nerve rework (2026-06-11) — a hero who broke and RAN demoralises the GUILD:
    // the tale of the dungeon's horrors spreads as PANIC, so the next waves arrive
    // shakier (lower starting nerve). NerveSystem._seed reads `_guildPanic`; it decays
    // over nights so it's pressure, not a permanent cripple. (Player-positive: even a
    // clean escape now WEAKENS the next wave instead of only leaking intel.)
    this._gs._guildPanic = Math.min(25, (this._gs._guildPanic ?? 0) + 5)
    _ensureAdvKnowledge(adventurer)
    this._updateSurvivorRecord(adventurer)
    this._rebuildSharedPool()
    EventBus.emit('KNOWLEDGE_SURVIVOR_SAVED', {
      adventurerId: adventurer.instanceId,
      name:         adventurer.name,
    })
    // Phase 34 follow-up — leaderboard `leaks_count` plumbing. Count the
    // intel items this survivor is taking with them and broadcast the
    // event the ToastQueue / RunHistorySystem already listen for. One
    // "leak" = one piece of room / trap / fountain / chest / item intel.
    // Floor loot is excluded — it's live-only and doesn't leave the run.
    const k = adventurer.knowledge ?? {}
    const count = (Object.keys(k.rooms          ?? {}).length)
                + (Object.keys(k.traps          ?? {}).length)
                + (Object.keys(k.fountains      ?? {}).length)
                + (Object.keys(k.treasureChests ?? {}).length)
                + (Object.keys(k.keyChests      ?? {}).length)
                + (Object.keys(k.items          ?? {}).length)
                + (Object.keys(k.mimics         ?? {}).length)
    if (count > 0) {
      EventBus.emit('INTEL_LEAKED', {
        adventurer,
        adventurerId: adventurer.instanceId,
        adventurerName: adventurer.name,
        count,
      })
    }
  }

  // A survivor who personally returned (as a veteran) and then died in the
  // dungeon is gone for good — "death destroys personal knowledge". The
  // returning leader reuses the survivor's instanceId, so this matches by
  // id; fresh adventurers who were never survivors simply don't match.
  // Removing them and rebuilding the pool means killing the veteran also
  // scrubs the intel they were championing — a real reason to hunt them.
  _onAdventurerDied({ adventurer }) {
    if (!adventurer) return
    const survivors = this._gs.knowledge?.survivors
    if (!Array.isArray(survivors)) return
    const idx = survivors.findIndex(s => s.instanceId === adventurer.instanceId)
    if (idx !== -1) {
      survivors.splice(idx, 1)
      this._rebuildSharedPool()
    }
  }

  _updateSurvivorRecord(adv) {
    const survivors = this._gs.knowledge.survivors
    const idx  = survivors.findIndex(s => s.instanceId === adv.instanceId)
    const today = this._gs.meta.dayNumber

    // Event-specific adventurers (speedrunner, cartographers, saboteur,
    // zombie horde, loot goblins, bounty-hunter pack,
    // rival dungeon) still feed the shared intel pool when they flee, but
    // they must NEVER personally return as a Hero — `noReturn` excludes
    // them from rollReturnLeader's eligible set.
    const isEventAdv = !!adv.flags?.eventAdventurer

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
        noReturn:      isEventAdv,
      })
    } else {
      const rec = survivors[idx]
      rec.runCount++
      rec.lastSeenDay  = today
      rec.pathHistory  = [...(adv.pathHistory ?? [])]
      rec.knowledge    = _mergeKnowledge(rec.knowledge, adv.knowledge)
      // Sticky — once event-tagged, the record stays non-returnable.
      rec.noReturn     = rec.noReturn || isEventAdv
    }
  }

  _rebuildSharedPool() {
    const pool = {
      rooms: {}, traps: {}, enemiesPerRoom: {}, loot: {}, mimics: {},
      fountains: {}, treasureChests: {}, keyChests: {}, items: {},
      bestiary: {},
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
      // Floor loot is deliberately NOT pooled — buff-piles are transient
      // (cleared each night), so loot intel stays live-only (see _livePool).
      for (const [id, e] of Object.entries(k.mimics ?? {})) {
        if (!pool.mimics[id] || (!e.stale && pool.mimics[id].stale)) {
          pool.mimics[id] = { ...e, sharedBy: name }
        }
      }
      // Benefits/utility + generic placed items — same merge rule +
      // sharedBy stamp.
      for (const bucket of ['fountains', 'treasureChests', 'keyChests', 'items']) {
        for (const [id, e] of Object.entries(k[bucket] ?? {})) {
          if (!pool[bucket][id] || (!e.stale && pool[bucket][id].stale)) {
            pool[bucket][id] = { ...e, sharedBy: name }
          }
        }
      }
      // Bestiary — AGGREGATE across survivors: a type is known if any survivor
      // faced it; mastery SUMS each survivor's days-faced (so the kingdom gets
      // smarter the more its members have fought-and-survived the type);
      // abilities union; lastFacedDay = most recent (drives staleness).
      for (const [type, e] of Object.entries(k.bestiary ?? {})) {
        const p = pool.bestiary[type] ??= { type, known: false, mastery: 0, abilities: {}, lastFacedDay: 0, sharedBy: name }
        if (e.known) p.known = true
        p.mastery     += (e.daysFaced ?? 0)
        p.lastFacedDay = Math.max(p.lastFacedDay ?? 0, e.lastFacedDay ?? 0)
        for (const a of Object.keys(e.abilities ?? {})) p.abilities[a] = true
      }
    }
    this._seedTriggeredTraps(pool)
    this._gs.knowledge.sharedPool = pool
  }

  // ── Live party knowledge sharing (Thread 3) ─────────────────────────────────
  // Copy what `from` knows into `to` (a LIVING party-mate) so a warning / huddle
  // actually changes where they go — the pathfinder reads adv.knowledge, so a
  // freshly-shared trap or minion makes the recipient reroute. Unlike the
  // survivor pool (death/escape only), this happens in real time among the
  // living. Non-stale entries win; nothing is downgraded. `roomId` limits the
  // share to one room's threats (a "trap in here!" shout); omit it for a full
  // briefing (the confer huddle). Returns how many entries were newly learned.
  shareKnowledge(from, to, { roomId = null } = {}) {
    if (!from?.knowledge || !to || from === to) return 0
    _ensureAdvKnowledge(to)
    const src = from.knowledge, dst = to.knowledge
    let learned = 0
    const better = (e, ex) => !ex || (!e.stale && ex.stale)
    const room = roomId ? (this._gs.dungeon?.rooms ?? []).find(r => r.instanceId === roomId) : null
    const inRoom = (e) => !room || (Number.isFinite(e.tileX) &&
      e.tileX >= room.gridX && e.tileX < room.gridX + room.width &&
      e.tileY >= room.gridY && e.tileY < room.gridY + room.height)

    for (const [id, e] of Object.entries(src.rooms ?? {})) {
      if (roomId && id !== roomId) continue
      if (better(e, dst.rooms[id])) { dst.rooms[id] = { ...e }; learned++ }
    }
    dst.traps ??= {}
    for (const [id, e] of Object.entries(src.traps ?? {})) {
      if (roomId && !inRoom(e)) continue
      if (better(e, dst.traps[id])) { dst.traps[id] = { ...e }; learned++ }
    }
    dst.enemiesPerRoom ??= {}
    for (const [rid, list] of Object.entries(src.enemiesPerRoom ?? {})) {
      if (roomId && rid !== roomId) continue
      dst.enemiesPerRoom[rid] ??= []
      for (const e of (list ?? [])) {
        const ex = dst.enemiesPerRoom[rid].find(x => x.minionType === e.minionType)
        if (!ex) { dst.enemiesPerRoom[rid].push({ ...e }); learned++ }
        else if (!e.stale && ex.stale) { ex.stale = false; ex.confirmed = true; learned++ }
      }
    }
    // Full briefing only (a confer shares the whole map, a shout shares one room).
    if (!roomId) {
      for (const bucket of ['treasureChests', 'fountains', 'keyChests', 'items', 'mimics']) {
        dst[bucket] ??= {}
        for (const [id, e] of Object.entries(src[bucket] ?? {})) {
          if (better(e, dst[bucket][id])) { dst[bucket][id] = { ...e }; learned++ }
        }
      }
    }
    return learned
  }

  // Full union across a cluster of living party-mates (the confer huddle): every
  // member walks away knowing everything any of them knew. Returns total entries
  // propagated. O(n²) but clusters are tiny (≤~6).
  mergePartyKnowledge(advs) {
    let total = 0
    for (const a of advs) for (const b of advs) if (a !== b) total += this.shareKnowledge(a, b)
    return total
  }

  // Triggered traps are durably known — re-seed them into any (re)built
  // shared pool so a sprung trap's location survives the discoverer's
  // death and is inherited by future waves.
  _seedTriggeredTraps(pool) {
    if (!pool) return
    pool.traps ??= {}
    const today = this._gs.meta?.dayNumber ?? 0
    for (const t of this._gs.dungeon?.traps ?? []) {
      if (!t.isKnownToAdventurers || pool.traps[t.instanceId]) continue
      pool.traps[t.instanceId] = {
        type: t.definitionId, tileX: t.tileX, tileY: t.tileY,
        footprint: t.footprint ?? { w: 1, h: 1 },
        dangerTiles: this._trapDangerTiles(t),
        confirmed: true, stale: false, dayLearned: today, sharedBy: 'the dungeon',
      }
    }
  }

  // Tiles a line-of-sight trap (arrows / dragon / cannon) threatens — its
  // firing lane from the muzzle until a wall. Adventurers route around
  // these once they know the trap. Returns null for non-LOS traps.
  _trapDangerTiles(trap) {
    // Line-of-sight traps: wall-mounted (arrows / dragon) or the cannon.
    if (trap.placement !== 'wall' && trap.definitionId !== 'cannon') return null
    const D = { N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 }, E: { dx: 1, dy: 0 }, W: { dx: -1, dy: 0 } }
    const d = D[trap.facing]
    if (!d) return null
    const fp = trap.footprint ?? { w: 1, h: 1 }
    let x, y
    if (trap.placement === 'wall') {
      x = trap.tileX + d.dx; y = trap.tileY + d.dy
    } else if (trap.facing === 'N') { x = trap.tileX + (fp.w >> 1); y = trap.tileY - 1 }
    else if (trap.facing === 'S')   { x = trap.tileX + (fp.w >> 1); y = trap.tileY + fp.h }
    else if (trap.facing === 'E')   { x = trap.tileX + fp.w;        y = trap.tileY + (fp.h >> 1) }
    else                            { x = trap.tileX - 1;           y = trap.tileY + (fp.h >> 1) }
    const tiles = []
    for (let i = 0; i < 48; i++) {
      const t = this._grid.getTileType(x, y)
      // Lane is confined to the room — a wall, door, or void stops the shot.
      if (t !== 1 && t !== 5) break
      tiles.push({ x, y })
      x += d.dx; y += d.dy
    }
    return tiles.length ? tiles : null
  }

  // ── End-of-day (called by DayPhase._endDay before transitioning) ──────────

  processEndOfDay() {
    const today = this._gs.meta.dayNumber
    const hadSurvivors = this._gs.knowledge.survivors.some(s => s.lastSeenDay === today)
    if (!hadSurvivors) {
      this._gs.knowledge.sharedPool = {
        rooms: {}, traps: {}, enemiesPerRoom: {}, loot: {}, mimics: {},
        fountains: {}, treasureChests: {}, keyChests: {}, items: {},
        bestiary: {},
      }
      this._gs.knowledge.survivors  = []
      // Sprung traps stay known even through a total party wipe.
      this._seedTriggeredTraps(this._gs.knowledge.sharedPool)
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
      // Per-run bestiary is SCRATCH (this-run facings, committed on escape) —
      // the kingdom's accumulated doctrine lives in the shared pool, so never
      // inherit pool-shaped bestiary entries into it (would mis-flag studying +
      // mis-shape mastery). Start empty.
      adv.knowledge.bestiary = {}
      return
    }
    const fresh = {
      rooms: {}, traps: {}, enemiesPerRoom: {}, loot: {}, mimics: {},
      fountains: {}, treasureChests: {}, keyChests: {}, items: {},
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
    _ensureAdvKnowledge(adv)
    // Per-run bestiary scratch starts empty; the veteran's ACCUMULATED bestiary
    // stays in their survivor record and merges (sums days-faced) on re-escape,
    // so re-facing a type adds to — never double-counts — kingdom mastery.
    adv.knowledge.bestiary = {}
    adv.flags           ??= {}
    adv.flags.returningVeteran = true
    adv.flags.runsCompleted    = survivorRecord.runCount
  }

  // ── Dungeon mutation → stale knowledge ────────────────────────────────────

  _onRoomMutated({ room, isMove }) {
    if (!room?.instanceId) return
    // MOVE-drops preserve the room's instanceId (NightPhase passes
    // preserveInstanceId to placeRoom), so the room IS the same room
    // logically — the adv's intel about it remains accurate. Skip the
    // stale-mark so moves don't compound a one-tier intel downgrade
    // every time the player rearranges. Fresh ROOM_PLACED (a brand-new
    // build) and any ROOM_REMOVED for a non-move (sell, undo) still
    // mark stale as before.
    if (isMove) return
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

  // Generic item-entity removal staleness — fires for PHYLACTERY_REMOVED
  // (sold / moved), PHYLACTERY_DESTROYED (hunted to death), and
  // BEACON_REMOVED (sold). The payload key differs per event:
  //   PHYLACTERY_*  → { phylactery }
  //   BEACON_REMOVED → { beaconId, fountainId }
  // — so we resolve an instanceId from whichever shape arrived.
  _onItemEntityRemoved(payload = {}) {
    const id = payload.phylactery?.instanceId
            ?? payload.beaconId
            ?? payload.item?.instanceId
            ?? payload.instanceId
    if (id) this._staleInAllScopes('items', id)
    // A beacon sale also drops its paired healing fountain — there's no
    // standalone FOUNTAIN_REMOVED event, so flip the fountain entry stale
    // off the same payload (same contract as the chest handlers).
    if (payload.fountainId) this._staleInAllScopes('fountains', payload.fountainId)
  }

  // Flip a single knowledge entry stale everywhere intel persists — the
  // shared pool, every survivor record, and every active adventurer.
  _staleInAllScopes(bucket, id) {
    if (!id) return
    _setStaleInPool(this._gs.knowledge, bucket, id)
    for (const s of this._gs.knowledge.survivors) {
      if (s.knowledge?.[bucket]?.[id]) s.knowledge[bucket][id].stale = true
    }
    for (const a of this._gs.adventurers?.active ?? []) {
      if (a.knowledge?.[bucket]?.[id]) a.knowledge[bucket][id].stale = true
    }
  }

  // ── Scrub intel (Knowledge Map "SCRUB INTEL" button) ─────────────────────
  //
  // The player spends gold to make a room "unknown" again. To stick, the
  // room must be forgotten everywhere intel persists:
  //   * sharedPool        — what the overlay reads + next wave inherits
  //   * survivors[].knowledge — else _rebuildSharedPool restores it the
  //                         next time any adventurer flees
  //   * adventurers.active[].knowledge — a wave already inside forgets too
  // Room-level entry, the room's enemy sightings, and any traps sitting
  // inside the room are all wiped.
  _onScrubRequest({ roomId, cost = 0 } = {}) {
    if (!roomId) return
    const player = this._gs.player
    if (!player) return
    if ((player.gold ?? 0) < cost) {
      EventBus.emit('SHOW_TOAST', { message: 'Not enough gold to scrub intel', type: 'error' })
      return
    }

    const room = this._gs.dungeon?.rooms?.find(r => r.instanceId === roomId)
    const inRoom = room
      ? (tx, ty) => tx >= room.gridX && tx < room.gridX + room.width &&
                    ty >= room.gridY && ty < room.gridY + room.height
      : () => false
    const trapIds = new Set()
    for (const t of (this._gs.dungeon?.traps ?? [])) {
      if (t && inRoom(t.tileX, t.tileY)) trapIds.add(t.instanceId)
    }

    const scrub = (k) => {
      if (!k) return
      if (k.rooms)          delete k.rooms[roomId]
      if (k.enemiesPerRoom) delete k.enemiesPerRoom[roomId]
      if (k.traps) for (const id of trapIds) delete k.traps[id]
    }
    scrub(this._gs.knowledge?.sharedPool)
    for (const s of this._gs.knowledge?.survivors ?? []) scrub(s.knowledge)
    for (const a of this._gs.adventurers?.active ?? []) scrub(a.knowledge)

    if (cost > 0) player.gold -= cost
    EventBus.emit('KNOWLEDGE_SCRUBBED', { roomId, cost })
    EventBus.emit('SHOW_TOAST', {
      message: `Intel scrubbed · ${cost}g spent`,
      type: 'success',
    })
  }

  // Doctrine SCRUB — the player pays gold to make the kingdom FORGET a studied
  // monster TYPE (family or "boss:<arch>"): its bestiary entry is wiped from the
  // shared pool, every survivor's record, and any in-dungeon wave — so their
  // adaptive counters against it drop to zero until an adventurer re-faces it
  // and escapes again. Mirrors _onScrubRequest (room scrub).
  _onBestiaryScrubRequest({ type, cost = 0 } = {}) {
    if (!type) return
    const player = this._gs.player
    if (!player) return
    if ((player.gold ?? 0) < cost) {
      EventBus.emit('SHOW_TOAST', { message: 'Not enough gold to scrub doctrine', type: 'error' })
      return
    }
    const scrub = (k) => { if (k?.bestiary) delete k.bestiary[type] }
    scrub(this._gs.knowledge?.sharedPool)
    for (const s of this._gs.knowledge?.survivors ?? []) scrub(s.knowledge)
    for (const a of this._gs.adventurers?.active ?? []) scrub(a.knowledge)

    if (cost > 0) player.gold -= cost
    EventBus.emit('KNOWLEDGE_SCRUBBED', { type, cost })
    EventBus.emit('SHOW_TOAST', { message: `Doctrine scrubbed · ${cost}g spent`, type: 'success' })
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
    // Known traps weight their whole footprint plus a 1-tile danger ring,
    // so an adventurer with intel routes clear of 2×2 hazards and the
    // pillar / blade reach — not just the trap's anchor tile.
    for (const t of Object.values(adv.knowledge.traps ?? {})) {
      if (!t) continue
      const fp = t.footprint ?? { w: 1, h: 1 }
      const M = 1
      const inBox = tx >= t.tileX - M && tx < t.tileX + fp.w + M &&
                    ty >= t.tileY - M && ty < t.tileY + fp.h + M
      // Line-of-sight traps (arrows / dragon / cannon) — the danger is the
      // firing lane, not the trap tile, so route around the line of fire.
      const inLane = !inBox && Array.isArray(t.dangerTiles) &&
                     t.dangerTiles.some(d => d.x === tx && d.y === ty)
      if (!inBox && !inLane) continue
      const tier  = this.tierForEntry(t)
      if (!tier) return 1
      const scale = this.costMultiplierForTier(tier)
      return 1 + (Balance.KNOWLEDGE_TRAP_COST_MULTIPLIER - 1) * scale
    }
    // Minion-room weight — if this tile is in a room the adv knows
    // contains enemies, route around it (scaled by tier). The freshest
    // entry in the room's enemy list wins for tier purposes.
    //
    // Roamer-aware filter: an entry whose minion instance has moved
    // OUT of this room (zombies / imps / gnolls / slimes / orcs now
    // wander dungeon-wide via behaviorType: 'roam') or has died is
    // skipped. Without this filter, the adventurer's intel says "two
    // orcs in the Crypt!" even when both orcs have wandered into the
    // entry hall, and the pathfinder routes 6× around an empty room.
    // We resolve each entry's instanceId against live gameState and
    // only count it if the minion is still alive AND its current tile
    // sits inside this room's bounds.
    if (room?.instanceId) {
      const list = adv.knowledge.enemiesPerRoom?.[room.instanceId]
      if (Array.isArray(list) && list.length > 0) {
        let bestTier = null
        const rank = { FULL: 0, PARTIAL: 1, RUMOR: 2 }
        const liveMinions = this._gs?.minions ?? []
        const rx0 = room.gridX, ry0 = room.gridY
        const rx1 = rx0 + room.width, ry1 = ry0 + room.height
        for (const e of list) {
          // Live-presence check — skip entries whose minion has moved
          // away or died. Entries without an instanceId fall through to
          // the original behavior (legacy / synthetic intel rows).
          if (e?.instanceId) {
            const m = liveMinions.find(x => x?.instanceId === e.instanceId)
            if (!m) continue
            if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
            const mx = m.tileX, my = m.tileY
            const inRoom = Number.isFinite(mx) && Number.isFinite(my) &&
                           mx >= rx0 && mx < rx1 && my >= ry0 && my < ry1
            if (!inRoom) continue
          }
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
      items:          { ...(sp.items          ?? {}) },
      // Committed bestiary (deep copy so the studying-now pass can't mutate the
      // real pool). Mastery here is the TRUE kingdom knowledge (escaped survivors).
      bestiary:       Object.fromEntries(Object.entries(sp.bestiary ?? {}).map(([t, e]) => [t, { ...e, abilities: { ...(e.abilities ?? {}) } }])),
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
      // Placed items (phylactery / beacons) — same merge rule, so the
      // intel UI reflects items the active wave just walked past.
      for (const [id, e] of Object.entries(k.items ?? {})) {
        const ex = pool.items[id]
        if (!ex || (!e.stale && ex.stale)) pool.items[id] = { ...e }
      }
      // Bestiary — types the active wave is CURRENTLY facing (not yet escaped,
      // so not yet committed). Flag them `studyingNow` so the panel can show
      // "⟳ studying" without inflating the true (committed) mastery.
      for (const [type, e] of Object.entries(k.bestiary ?? {})) {
        const p = pool.bestiary[type] ??= { type, known: false, mastery: 0, abilities: {}, lastFacedDay: 0 }
        p.studyingNow = true
        for (const a of Object.keys(e.abilities ?? {})) p.abilities[a] = true
      }
    }
    return pool
  }

  computeKnowledgeStats() {
    const pool     = this._livePool()
    const allRooms = this._gs.dungeon.rooms ?? []
    let confirmed = 0, stale = 0, confirmedTraps = 0, staleTraps = 0
    let confirmedLoot = 0, confirmedEnemyRooms = 0
    let confirmedItems = 0, staleItems = 0

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
    // Placed-item intel (phylactery / beacons) — split confirmed vs stale
    // the same way traps are, so the Threat Assessment screen can surface
    // a "Known items" line alongside the rest.
    for (const it of Object.values(pool.items ?? {})) it.stale ? staleItems++ : confirmedItems++

    const total = allRooms.length
    return {
      percentage:          total > 0 ? Math.round(100 * (confirmed + stale) / total) : 0,
      confirmedRooms:      confirmed,
      staleRooms:          stale,
      totalRooms:          total,
      confirmedTraps,      staleTraps,
      confirmedLoot,       confirmedEnemyRooms,
      confirmedItems,      staleItems,
    }
  }

  // ── HUD intel report ─────────────────────────────────────────────────────
  //
  // Single source of truth for the knowledge HUD panels (KnowledgeMapOverlay,
  // RightPanels' Adventurer Intel). Built from the LIVE pool so it reflects
  // the currently-exploring party, not just last day's escapees. Every entry
  // is classified through tierForEntry() — the same classifier the pathfinder
  // uses — so the UI coloring and the AI avoidance weighting never disagree.
  //
  // `rooms` / `traps` / `enemiesPerRoom` are id → 'FULL'|'PARTIAL'|'RUMOR'
  // maps; an id absent from the map is UNKNOWN.
  //
  // `exposurePct` is tier-weighted: FULL intel is worth 4× a RUMOR. A dungeon
  // the adventurers only have rumours about reads low even if every room has
  // been whispered about — the number tracks how much they REALLY know.
  getIntelReport() {
    const pool   = this._livePool()
    const rooms  = this._gs.dungeon?.rooms  ?? []
    const traps  = this._gs.dungeon?.traps  ?? []
    const WEIGHT = { FULL: 1.0, PARTIAL: 0.5, RUMOR: 0.25 }
    const RANK   = { FULL: 0, PARTIAL: 1, RUMOR: 2 }

    let weightSum = 0
    const roomTiers = {}
    for (const r of rooms) {
      const tier = this.tierForEntry(pool.rooms?.[r.instanceId])
      if (!tier) continue
      roomTiers[r.instanceId] = tier
      weightSum += WEIGHT[tier] ?? 0
    }

    const trapTiers = {}
    for (const t of traps) {
      const tier = this.tierForEntry(pool.traps?.[t.instanceId])
      if (!tier) continue
      trapTiers[t.instanceId] = tier
      weightSum += WEIGHT[tier] ?? 0
    }

    // Placed-item intel (phylactery / beacons). Iterate the live item
    // entities so a sold item drops out of the report immediately; each
    // surviving entity is classified through the same tier classifier.
    const itemTiers = {}
    const itemEnts  = this._itemEntities()
    for (const it of itemEnts) {
      const tier = this.tierForEntry(pool.items?.[it.instanceId])
      if (!tier) continue
      itemTiers[it.instanceId] = tier
      weightSum += WEIGHT[tier] ?? 0
    }

    // Per-room enemy sightings collapse to the freshest (best) tier seen.
    const enemyTiers = {}
    for (const [roomId, list] of Object.entries(pool.enemiesPerRoom ?? {})) {
      let best = null
      for (const e of (list ?? [])) {
        const tier = this.tierForEntry(e)
        if (!tier) continue
        if (best == null || (RANK[tier] ?? 9) < (RANK[best] ?? 9)) best = tier
      }
      if (best) enemyTiers[roomId] = best
    }

    const denom = rooms.length + traps.length + itemEnts.length
    const exposurePct = denom > 0
      ? Math.min(100, Math.round((100 * weightSum) / denom))
      : 0

    return {
      exposurePct,
      rooms:           roomTiers,
      traps:           trapTiers,
      enemiesPerRoom:  enemyTiers,
      items:           itemTiers,
      leakedRoomCount: Object.keys(roomTiers).length,
    }
  }

  // ── Bestiary / Kingdom Doctrine report ────────────────────────────────────
  // What the kingdom has LEARNED about the player's enemy types (per minion
  // family / boss archetype), from survivors who faced-and-escaped. Single
  // source of truth for the Doctrine panel — reads the live pool so it shows
  // committed mastery PLUS types the current wave is studying right now.
  // masteryTier 0..3 = ★ count; `stale` = not faced in KNOWLEDGE_BESTIARY_STALE_DAYS.
  getBestiaryReport() {
    const pool  = this._livePool().bestiary ?? {}
    const today = this._gs.meta?.dayNumber ?? 0
    const staleDays = Balance.KNOWLEDGE_BESTIARY_STALE_DAYS ?? 3
    const T1 = Balance.KNOWLEDGE_BESTIARY_MASTERY_T1 ?? 1
    const T2 = Balance.KNOWLEDGE_BESTIARY_MASTERY_T2 ?? 3
    const T3 = Balance.KNOWLEDGE_BESTIARY_MASTERY_T3 ?? 6
    const entries = []
    for (const [type, e] of Object.entries(pool)) {
      const known   = !!e.known
      const studying = !!e.studyingNow && !known
      if (!known && !studying) continue
      const mastery = e.mastery ?? 0
      const stale   = known && (today - (e.lastFacedDay ?? 0)) > staleDays
      const masteryTier = mastery >= T3 ? 3 : mastery >= T2 ? 2 : mastery >= T1 ? 1 : 0
      entries.push({
        type, label: this._enemyTypeLabel(type), isBoss: type.startsWith('boss:'),
        known, studyingNow: studying, mastery, masteryTier, stale,
        lastFacedDay: e.lastFacedDay ?? 0, abilities: Object.keys(e.abilities ?? {}),
      })
    }
    entries.sort((a, b) => (b.masteryTier - a.masteryTier) || (b.mastery - a.mastery) || a.label.localeCompare(b.label))
    return {
      entries,
      knownCount:    entries.filter(e => e.known).length,
      studyingCount: entries.filter(e => e.studyingNow).length,
    }
  }
  // ── Bestiary COUNTER strength (Phase 4 — adaptive counters) ───────────────
  // The kingdom's counter strength (0..1) against an enemy TYPE, read by the
  // combat/AI counters (combat edge, focus-fire, defensive timing). 0 if the
  // type is UNKNOWN (reveal gate); scales with committed mastery; HALVED when
  // stale (snaps back the moment the type is re-faced). Pass a minion object,
  // a boss archetype, or a raw type key.
  _resolveEnemyType(x) {
    if (!x) return null
    if (typeof x === 'string') return x
    if (x.definitionId) return this._enemyFamily(x.definitionId)
    return null
  }
  getEnemyCounter(typeOrMinion) {
    const type = this._resolveEnemyType(typeOrMinion)
    if (!type) return { known: false, strength: 0, stale: false, type: null }
    const e = this._gs.knowledge?.sharedPool?.bestiary?.[type]
    if (!e || !e.known) return { known: false, strength: 0, stale: false, type }
    const today = this._gs.meta?.dayNumber ?? 0
    const stale = (today - (e.lastFacedDay ?? 0)) > (Balance.KNOWLEDGE_BESTIARY_STALE_DAYS ?? 4)
    const base  = Math.max(0, Math.min(1, (e.mastery ?? 0) / Math.max(1, Balance.KNOWLEDGE_BESTIARY_MASTERY_T3 ?? 9)))
    const strength = base * (stale ? (Balance.KNOWLEDGE_COUNTER_STALE_FACTOR ?? 0.4) : 1)
    return { known: true, strength, stale, type }
  }

  // Human-readable label for an enemy type key (minion family / "boss:<arch>").
  _enemyTypeLabel(type) {
    const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s
    if (String(type).startsWith('boss:')) return 'Boss · ' + cap(String(type).slice(5))
    return String(type).split('_').map(cap).join(' ')
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
      // Placed-item intel (phylactery / beacons) for this room — keyed
      // by the roomId stamped at observe time.
      items:   Object.values(pool.items ?? {}).filter(it => it.roomId === roomId),
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
    fountains: {}, treasureChests: {}, keyChests: {}, items: {},
    // Adaptive-learning bestiary: per enemy TYPE (minion family / boss
    // archetype) the kingdom has faced-and-survived. See § Bestiary learning.
    bestiary: {},
  })
  gs.knowledge ??= { sharedPool: empty(), survivors: [], partyWipeOccurred: false }
  gs.knowledge.sharedPool ??= empty()
  // Backfill new buckets onto an older save's pool so it doesn't choke
  // when we read fountains/chests/items/bestiary from a save that predates them.
  for (const k of ['fountains', 'treasureChests', 'keyChests', 'items', 'bestiary']) {
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
  // Generic placed-item intel (phylactery / beacons) keyed by instanceId.
  adv.knowledge.items          ??= {}
  // Adaptive-learning bestiary: enemy TYPES this adv has faced this run.
  // Committed to the shared pool only on ESCAPE (survive-and-learn).
  adv.knowledge.bestiary       ??= {}
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
  // Floor loot is intentionally not merged — it's live-only intel that
  // doesn't accumulate across a returning veteran's runs.
  // Benefit/utility + generic-item merges — same overwrite-if-fresher
  // pattern as above.
  for (const bucket of ['fountains', 'treasureChests', 'keyChests', 'items']) {
    for (const [id, e] of Object.entries(incoming[bucket] ?? {})) {
      if (!merged[bucket][id] || (!e.stale && merged[bucket][id].stale)) {
        merged[bucket][id] = { ...e }
      }
    }
  }
  // Bestiary — a returning veteran accumulates: days-faced SUM across their
  // runs, known OR, abilities union, lastFacedDay max.
  merged.bestiary ??= {}
  for (const [type, e] of Object.entries(incoming.bestiary ?? {})) {
    const m = merged.bestiary[type] ??= { type, known: false, daysFaced: 0, abilities: {}, lastFacedDay: 0 }
    if (e.known) m.known = true
    m.daysFaced    = (m.daysFaced ?? 0) + (e.daysFaced ?? 0)
    m.lastFacedDay = Math.max(m.lastFacedDay ?? 0, e.lastFacedDay ?? 0)
    for (const a of Object.keys(e.abilities ?? {})) m.abilities[a] = true
  }
  return merged
}

function _setStaleInPool(knowledge, category, id) {
  if (knowledge?.sharedPool?.[category]?.[id]) {
    knowledge.sharedPool[category][id].stale = true
  }
}


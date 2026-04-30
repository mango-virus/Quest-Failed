// Phase 7 — Loot drops, generation, equipping, provenance.
//
// Lifecycle:
//   1. Adventurer dies → LootSystem.dropFromAdventurer(victim, killerId) generates loot.
//   2. Each item lands on the dungeon floor at the death tile (with small scatter).
//   3. Player equips loot via NightPhase MinionInspector → LootSystem.equipToMinion().
//   4. When a minion gets gear, statModifiers stack onto its base stats.
//   5. Provenance updates on every transition (dropped, equipped, transferred).
//
// Cursed loot, vendettas, scavenger pickup land in Phase 7b/9.

import { EventBus }              from './EventBus.js'
import { Balance }               from '../config/balance.js'
import { createLootItem,
         appendProvenance }      from '../entities/LootItem.js'

export class LootSystem {
  constructor(scene, gameState, dungeonGrid) {
    this._scene = scene
    this._gameState = gameState
    this._dungeonGrid = dungeonGrid
    this._defs = {}
    this._loaded = false

    EventBus.on('ADVENTURER_DIED', this._onAdventurerDied, this)
    EventBus.on('MINION_DIED',     this._onMinionDied,    this)
  }

  destroy() {
    EventBus.off('ADVENTURER_DIED', this._onAdventurerDied, this)
    EventBus.off('MINION_DIED',     this._onMinionDied,    this)
  }

  // Phase 5c — loot drops disabled. The user removed the loot mechanic;
  // nothing is generated on minion death anymore. Listener kept as a stub
  // so the EventBus subscription remains symmetrical with destroy().
  _onMinionDied(_payload) { /* loot mechanic removed */ }

  loadDefinitions() {
    if (this._loaded) return
    const defs = this._scene.cache.json.get('lootDefinitions') ?? []
    this._defs = Object.fromEntries(defs.map(d => [d.id, d]))
    this._loaded = true
  }

  // Phase 5c — loot drops disabled. Adventurers no longer drop their gear
  // on death. The dropFromAdventurer method is preserved below for any
  // future re-enable, but is no longer wired to ADVENTURER_DIED.
  _onAdventurerDied(_payload) { /* loot mechanic removed */ }

  getDefinition(id) { return this._defs[id] ?? null }
  allDefinitions() { return Object.values(this._defs) }

  // ── Drops ─────────────────────────────────────────────────────────────────

  /**
   * Roll loot drops from a slain adventurer.
   * Returns the array of created LootItem instances (also pushed to gameState.loot.dungeon).
   */
  dropFromAdventurer(victim, killerId, killerName) {
    if (!victim) return []
    const dungeonLevel = this._gameState.meta.dungeonLevel ?? 1
    const maxTier = 1 + Math.floor((dungeonLevel - 1) / Balance.LOOT_TIER_BY_DUNGEON_LEVEL)

    // Filter the loot pool to items the victim's class can drop, gated by tier
    const pool = this.allDefinitions().filter(def => {
      if (def.tier > maxTier) return false
      if (Array.isArray(def.fromClasses) && def.fromClasses.length > 0) {
        if (!def.fromClasses.includes(victim.classId)) return false
      }
      return true
    })

    const drops = []
    const rolls = Balance.LOOT_DROP_ROLLS_PER_DEATH ?? 2
    const droppedIds = new Set()  // avoid double drop of same definition

    for (let i = 0; i < rolls; i++) {
      const candidate = pool[Math.floor(Math.random() * pool.length)]
      if (!candidate) continue
      if (droppedIds.has(candidate.id)) continue
      if (Math.random() > (candidate.dropChance ?? 0.3)) continue
      droppedIds.add(candidate.id)

      const room = this._dungeonGrid.getRoomAtTile(victim.tileX, victim.tileY)
      const provenance = {
        type:        'wielded_by',
        entityName:  victim.name,
        entityClass: victim.classId,
        roomId:      room?.instanceId ?? null,
        day:         this._gameState.meta.dayNumber,
        flavorText:  `wielded by ${victim.name} (${victim.classId})` +
                     (killerName ? `, killed by ${killerName}` : '') +
                     (room ? ` in ${room.definitionId}` : ''),
      }

      // Scatter slightly around the death tile so multiple items don't stack
      const scatter = i === 0 ? { dx: 0, dy: 0 } : _scatter(i)
      const tile = {
        tileX: victim.tileX + scatter.dx,
        tileY: victim.tileY + scatter.dy,
      }
      const item = createLootItem(candidate, provenance, tile)
      this._gameState.loot.dungeon.push(item)
      drops.push(item)

      EventBus.emit('GEAR_DROPPED', {
        item,
        roomId:       room?.instanceId ?? null,
        droppedBy:    victim.instanceId,
      })
    }

    return drops
  }

  // ── Equipping ─────────────────────────────────────────────────────────────

  /**
   * Move a floor-item to a minion's equipped gear. Returns true on success.
   * Updates provenance and refreshes the minion's effective stats.
   */
  equipToMinion(itemInstanceId, minionInstanceId) {
    const item   = this._gameState.loot.dungeon.find(i => i.instanceId === itemInstanceId)
    const minion = this._gameState.minions.find(m => m.instanceId === minionInstanceId)
    if (!item || !minion) return false
    if (minion.aiState === 'dead') return false

    // Phase 7b: keep the LootItem in loot.dungeon (tileX=null = equipped)
    // so we can still resolve its definitionId/name when rendering inspectors.
    item.tileX = null
    item.tileY = null
    item.worldX = null
    item.worldY = null
    item.dungeonRoomId = null
    item.currentEquippedBy = minion.instanceId

    minion.equippedGear ??= []
    minion.equippedGear.push(item.instanceId)

    this._gameState.loot.minionEquipment ??= {}
    const list = this._gameState.loot.minionEquipment[minion.instanceId] ??= []
    list.push(item.instanceId)

    // Apply stat modifiers
    this._applyModifiersToMinion(minion, item.statModifiers, +1)

    appendProvenance(item, {
      type:        'equipped_to',
      entityName:  minion.name ?? this._scene.cache.json.get('minionTypes')?.find(d => d.id === minion.definitionId)?.name ?? minion.definitionId,
      entityClass: minion.definitionId,
      roomId:      minion.assignedRoomId,
      day:         this._gameState.meta.dayNumber,
      flavorText:  `equipped to ${minion.name ?? minion.definitionId}`,
    })

    // Phase 7b: vendetta — random chance the gear's prior owner had family who'll come hunt
    this._maybeCreateVendetta(item, minion)

    EventBus.emit('GEAR_EQUIPPED_TO_MINION', { item, minion })
    return true
  }

  // Phase 7b: when gear with a death-provenance is equipped to a minion, roll
  // for a vendetta — a sibling adventurer who'll specifically hunt that minion.
  _maybeCreateVendetta(item, minion) {
    if (Math.random() > Balance.VENDETTA_TRIGGER_CHANCE) return
    const wieldedBy = item.provenance?.find(p => p.type === 'wielded_by')
    if (!wieldedBy?.entityName) return

    item.isVendettaTarget = true
    this._gameState.vendettas ??= []
    this._gameState.vendettas.push({
      itemInstanceId: item.instanceId,
      minionInstanceId: minion.instanceId,
      claimantClass: wieldedBy.entityClass ?? 'knight',
      avengeeName: wieldedBy.entityName,
      avengeeFlavor: wieldedBy.flavorText ?? '',
      day: this._gameState.meta.dayNumber,
    })
    EventBus.emit('VENDETTA_CREATED', {
      minionId: minion.instanceId,
      itemId: item.instanceId,
      avengeeName: wieldedBy.entityName,
    })
  }

  // Optional: unequip (Phase 7b — rename + transfer flow)
  unequipFromMinion(itemInstanceId, dropTile = null) {
    // Find the item by scanning all minions
    let owner = null
    for (const m of this._gameState.minions) {
      if (m.equippedGear?.includes(itemInstanceId)) { owner = m; break }
    }
    if (!owner) return null

    // Find the actual item — it lives only on the minion side after equip
    // (Phase 7 stores items on floor only when not equipped). Reconstitute
    // a placeholder item from the minion's equip list — Phase 7 doesn't yet
    // support detaching items so this is a stub for 7b.
    return null
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  _applyModifiersToMinion(minion, modifiers, sign) {
    if (!Array.isArray(modifiers)) return
    for (const mod of modifiers) {
      const delta = (mod.delta ?? 0) * sign
      if (mod.stat === 'attackBonus')  minion.stats.attack  = (minion.stats.attack  ?? 0) + delta
      else if (mod.stat === 'defenseBonus') minion.stats.defense = (minion.stats.defense ?? 0) + delta
      else if (mod.stat === 'hpBonus') {
        minion.resources.maxHp = (minion.resources.maxHp ?? 0) + delta
        minion.resources.hp    = Math.min(minion.resources.maxHp, minion.resources.hp + delta)
      }
      else if (mod.stat === 'speedBonus') minion.stats.speed = (minion.stats.speed ?? 1) + delta
      // spellBonus / rangedBonus / fireDamageBonus / smiteBonus: stash on minion.equipBonuses
      // for combat to read. CombatSystem can pick these up in Phase 7b. For 7 kernel we
      // record them but only apply attack/defense/hp/speed to base stats.
      else {
        minion.equipBonuses ??= {}
        minion.equipBonuses[mod.stat] = (minion.equipBonuses[mod.stat] ?? 0) + delta
      }
    }
  }
}

function _scatter(idx) {
  // Tiny offset so multi-drop tiles don't perfectly overlap
  const angle = (idx * 137) % 360
  return {
    dx: Math.round(Math.cos(angle * Math.PI / 180)),
    dy: Math.round(Math.sin(angle * Math.PI / 180)),
  }
}

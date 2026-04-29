// Trap trigger evaluation + damage application.
// Phase 6b: handles three trigger families covering 5 traps:
//   - stepped_on            → spike, arrow (proxy), pitfall, curse_brand (no dmg, just event)
//   - stood_still_3_seconds → patience
//   - moved_too_fast        → speed
// Greed / mercy / echo / memory triggers wire later phases (need loot, heal, follower tracking).
//
// Triggered traps stay marked until NIGHT_PHASE_STARTED, when `resetAll()` clears them.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

const STAND_STILL_MS_PATIENCE = 3000   // 3 seconds for patience trigger
const FAST_SPEED_THRESHOLD    = 2.0    // tiles/sec threshold for moved_too_fast

export class TrapSystem {
  constructor(scene, gameState, dungeonGrid) {
    this._scene = scene
    this._gameState = gameState
    this._dungeonGrid = dungeonGrid
    this._defs = {}        // id → trap definition
    this._loaded = false

    // Mercy trap fires reactively on heal events instead of per-tick stepping.
    EventBus.on('ALLY_HEALED', this._onAllyHealed, this)
    // Phase QW — Greed trap fires when an adventurer picks up loot in the trap's room.
    EventBus.on('LOOT_PICKED_UP', this._onLootPickedUp, this)
    // Whisper trap fires when an adventurer emits a chat bubble in its room.
    EventBus.on('CHAT_BUBBLE_EMITTED', this._onChatBubble, this)
  }

  destroy() {
    EventBus.off('ALLY_HEALED', this._onAllyHealed, this)
    EventBus.off('LOOT_PICKED_UP', this._onLootPickedUp, this)
    EventBus.off('CHAT_BUBBLE_EMITTED', this._onChatBubble, this)
  }

  loadDefinitions() {
    if (this._loaded) return
    const defs = this._scene.cache.json.get('trapTypes') ?? []
    this._defs = Object.fromEntries(defs.map(d => [d.id, d]))
    this._loaded = true
  }

  getDefinition(id) { return this._defs[id] ?? null }

  // Per-tick during day phase. delta is timeScale-adjusted ms.
  update(delta) {
    if (!this._loaded) this.loadDefinitions()
    const traps = this._gameState.dungeon.traps
    if (!traps?.length) return

    const now = this._scene.time.now
    for (const adv of this._gameState.adventurers.active) {
      this._updateAdventurerMovementState(adv, delta)
      // Phase 6d: expire curse-brand marks that have run out
      if (adv.flags?.cursedBrand &&
          adv.flags.cursedBrandUntil &&
          now >= adv.flags.cursedBrandUntil) {
        adv.flags.cursedBrand = false
        adv.flags.cursedBrandUntil = null
        EventBus.emit('CURSE_BRAND_EXPIRED', { adventurer: adv })
      }
    }

    for (const trap of traps) {
      if (trap.isTriggered) continue
      const def = this._defs[trap.definitionId]
      if (!def) continue
      // Phase 8b: vandals disarm before normal evaluation
      if (this._tryVandalDisarm(trap, def)) continue
      this._evaluateTrap(trap, def)
    }
  }

  // Phase 8b — Vandal disarm action.
  // If a vandal-tagged adventurer occupies the trap tile, the trap is neutralised
  // for the rest of the day. The vandal takes VANDAL_DISARM_DAMAGE (0 by default).
  // We mark trap.isTriggered = true so it's "consumed", set disarmedByVandalId
  // for renderer differentiation, and emit TRAP_DISARMED. resetAll() at night
  // re-arms the trap as normal.
  _tryVandalDisarm(trap, def) {
    const personality = this._scene.personalitySystem
    if (!personality) return false
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead') continue
      if (!this._adventurerOnTrap(adv, trap)) continue
      const tags = personality.getTags(adv)
      if (!tags.has('vandal') && !tags.has('trap_breaker')) continue

      // Disarm — no damage, no fire effect, but the trap is spent for the day
      trap.isTriggered = true
      trap.disarmedByVandalId = adv.instanceId
      const dmg = Balance.VANDAL_DISARM_DAMAGE ?? 0
      if (dmg > 0) {
        adv.resources.hp = Math.max(0, adv.resources.hp - dmg)
      }

      const roomId = this._dungeonGrid.getRoomAtTile(trap.tileX, trap.tileY)?.instanceId ?? null
      EventBus.emit('TRAP_DISARMED', { trap, def, adventurer: adv, roomId })
      // Surface this to KnowledgeSystem so the room marks the trap as known/sprung.
      EventBus.emit('TRAP_TRIGGERED', {
        trap, def, adventurer: adv, damage: 0, roomId, disarmed: true,
      })
      return true
    }
    return false
  }

  // Phase QW — Greed trap fires when an adventurer picks up loot in the same room.
  _onLootPickedUp({ adventurer, roomId }) {
    if (!roomId || !adventurer) return
    const traps = this._gameState.dungeon.traps ?? []
    for (const trap of traps) {
      if (trap.isTriggered) continue
      const def = this._defs[trap.definitionId]
      if (!def || def.triggerCondition !== 'loot_picked_up') continue
      const trapRoom = this._dungeonGrid.getRoomAtTile(trap.tileX, trap.tileY)
      if (!trapRoom || trapRoom.instanceId !== roomId) continue
      this._fireTrap(trap, def, adventurer)
      return
    }
  }

  // Phase QW — Whisper trap fires when a chat bubble pops in the trap's room.
  _onChatBubble({ adventurer, roomId }) {
    if (!roomId || !adventurer) return
    const traps = this._gameState.dungeon.traps ?? []
    for (const trap of traps) {
      if (trap.isTriggered) continue
      const def = this._defs[trap.definitionId]
      if (!def || def.triggerCondition !== 'chat_bubble_emitted') continue
      const trapRoom = this._dungeonGrid.getRoomAtTile(trap.tileX, trap.tileY)
      if (!trapRoom || trapRoom.instanceId !== roomId) continue
      this._fireTrap(trap, def, adventurer)
      return
    }
  }

  // Mercy trap reacts to heal actions in the same room.
  _onAllyHealed({ sourceId, roomId }) {
    if (!roomId) return
    const traps = this._gameState.dungeon.traps ?? []
    for (const trap of traps) {
      if (trap.isTriggered) continue
      const def = this._defs[trap.definitionId]
      if (!def) continue
      if (def.triggerCondition !== 'ally_healed_nearby') continue
      // Trap must be in the room where the heal happened
      const trapRoom = this._dungeonGrid.getRoomAtTile(trap.tileX, trap.tileY)
      if (!trapRoom || trapRoom.instanceId !== roomId) continue

      const healer = this._gameState.adventurers.active.find(a => a.instanceId === sourceId)
      if (!healer) continue
      this._fireTrap(trap, def, healer)
      return  // one mercy trap per heal
    }
  }

  // Reset triggered state — called on NIGHT_PHASE_STARTED so traps re-arm overnight.
  resetAll() {
    for (const trap of this._gameState.dungeon.traps ?? []) {
      trap.isTriggered = false
      trap.repairProgress = 0
      trap.state = {}
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _updateAdventurerMovementState(adv, delta) {
    if (adv._prevTileX === adv.tileX && adv._prevTileY === adv.tileY) {
      adv._stillTimeMs = (adv._stillTimeMs ?? 0) + delta
    } else {
      adv._stillTimeMs = 0
    }
    adv._prevTileX = adv.tileX
    adv._prevTileY = adv.tileY
  }

  _evaluateTrap(trap, def) {
    const trigger = def.triggerCondition
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead') continue
      if (!this._adventurerOnTrap(adv, trap)) continue

      let fires = false
      if (trigger === 'stepped_on' || trigger === 'line_of_sight_broken') {
        // First entry into the tile triggers it
        fires = true
      } else if (trigger === 'stood_still_3_seconds') {
        fires = (adv._stillTimeMs ?? 0) >= STAND_STILL_MS_PATIENCE
      } else if (trigger === 'moved_too_fast') {
        fires = (adv.stats?.speed ?? 0) >= FAST_SPEED_THRESHOLD &&
                adv.aiState === 'walking'
      } else if (trigger === 'second_footstep') {
        // Echo mine: arm on first step, fire on second step on the same tile.
        trap.state ??= {}
        trap.state.stepCount = (trap.state.stepCount ?? 0) + 1
        if (trap.state.stepCount >= Balance.ECHO_MINE_FOOTSTEP_THRESHOLD) {
          fires = true
        } else {
          continue
        }
      } else if (trigger === 'adventurer_was_here_before') {
        // Memory trap: fires only on adventurers who've visited this room before
        const roomId = this._dungeonGrid.getRoomAtTile(trap.tileX, trap.tileY)?.instanceId
        const visitCount = adv.knowledge?.rooms?.[roomId]?.visitCount ?? 0
        if (visitCount >= 2) {
          fires = true
        } else {
          continue
        }
      } else {
        // ally_healed_nearby is event-driven (see _onAllyHealed)
        // loot_picked_up — Phase 7b
        continue
      }
      if (fires) {
        this._fireTrap(trap, def, adv)
        return  // one trap fires once per tick — don't double-fire on multiple advs
      }
    }
  }

  _adventurerOnTrap(adv, trap) {
    return adv.tileX === trap.tileX && adv.tileY === trap.tileY
  }

  _fireTrap(trap, def, adv) {
    // Phase QW — requiresPowerSource: trap silently fails if no power_core room is built.
    if (def.requiresPowerSource && !this._hasPowerCore()) {
      EventBus.emit('TRAP_FAILED_NO_POWER', { trap, def, adventurer: adv })
      return
    }
    // Phase QW — requiresEternalNight: torch_trap only fires while the
    // Eternal Night dungeon mechanic is active.
    if (def.requiresEternalNight && !this._isEternalNightActive()) {
      EventBus.emit('TRAP_FAILED_NEEDS_NIGHT', { trap, def, adventurer: adv })
      return
    }
    trap.isTriggered = true
    let damage = def.baseDamage ?? 0
    // Phase 6e: Engineer minion in the same room buffs trap damage
    if (damage > 0) {
      const room = this._dungeonGrid.getRoomAtTile(trap.tileX, trap.tileY)
      if (room && this._engineerInRoom(room.instanceId)) {
        damage = Math.round(damage * Balance.ENGINEER_TRAP_DAMAGE_BUFF)
      }
    }
    if (damage > 0) {
      adv.resources.hp = Math.max(0, adv.resources.hp - damage)
      adv._lastHitBy   = trap.instanceId
      adv._lastHitType = def.damageType ?? 'physical'
    }

    const roomId = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)?.instanceId ?? null

    // Phase 6d: special non-damage trap effects routed by definitionId
    if (def.id === 'curse_brand_trap') {
      this._applyCurseBrand(adv)
    }

    EventBus.emit('TRAP_TRIGGERED', {
      trap, def, adventurer: adv, damage, roomId,
    })

    if (damage > 0) {
      EventBus.emit('COMBAT_HIT', {
        sourceId:   trap.instanceId,
        targetId:   adv.instanceId,
        damage,
        damageType: def.damageType ?? 'physical',
        isCritical: false,
      })
    }

    if (adv.resources.hp <= 0) {
      EventBus.emit('COMBAT_KILL', {
        sourceId:   trap.instanceId,
        targetId:   adv.instanceId,
        damageType: def.damageType ?? 'physical',
        method:     `trap_${def.id}`,
        roomId,
        day:        this._gameState.meta.dayNumber,
      })
    }
  }

  // Phase QW — does the dungeon have any active Power Core room?
  _hasPowerCore() {
    return (this._gameState.dungeon.rooms ?? []).some(r =>
      r.definitionId === 'power_core' && r.isActive !== false
    )
  }

  // Phase QW — Eternal Night mechanic active?
  _isEternalNightActive() {
    return !!(this._gameState.activeMechanics?.includes?.('eternal_night'))
  }

  // Curse brand: marks the adventurer so all minions prioritise them
  // (priority 3 in MinionAISystem._adventurerPriority). Mark expires after a duration.
  _engineerInRoom(roomId) {
    return (this._gameState.minions ?? []).some(
      m => m.aiState !== 'dead' && m.faction === 'dungeon' &&
           m.assignedRoomId === roomId && m.definitionId === 'engineer'
    )
  }

  _applyCurseBrand(adv) {
    adv.flags = adv.flags ?? {}
    adv.flags.cursedBrand = true
    adv.flags.cursedBrandUntil = this._scene.time.now + Balance.CURSE_BRAND_DURATION_MS
    EventBus.emit('CURSE_BRAND_APPLIED', { adventurer: adv })
  }
}

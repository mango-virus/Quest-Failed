// Trap trigger evaluation + damage application.
// Phase 6b: handles three trigger families covering 5 traps:
//   - stepped_on            → spike, arrow (proxy), pitfall, curse_brand (no dmg, just event)
//   - stood_still_3_seconds → patience
//   - moved_too_fast        → speed
// Greed / mercy / echo / memory triggers wire later phases (need loot, heal, follower tracking).
//
// Triggered traps stay marked until NIGHT_PHASE_STARTED, when `resetAll()` clears them.

import { EventBus }   from './EventBus.js'
import { Balance }    from '../config/balance.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'

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
    // Whisper trap fires when an adventurer emits a chat bubble in its room.
    EventBus.on('CHAT_BUBBLE_EMITTED', this._onChatBubble, this)
  }

  destroy() {
    EventBus.off('ALLY_HEALED', this._onAllyHealed, this)
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
      if (trap._disabledThisDay) continue   // Phase 5c — Trap Expert
      const def = this._defs[trap.definitionId]
      if (!def) continue
      this._evaluateTrap(trap, def)
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
      // Phase 5c — Trap Expert disabled-this-day flag clears at night.
      trap._disabledThisDay = false
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
    // Phase 5c — Monk Focus: 30% chance to dodge the trap entirely. Trap is
    // NOT consumed — it stays armed for the next adventurer.
    if (adv?._focusActiveUntil && this._scene.time.now < adv._focusActiveUntil && Math.random() < 0.30) {
      AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 18, 'DODGED', { color: '#eeeeff' })
      EventBus.emit('TRAP_DODGED', { trap, def, adventurer: adv })
      return
    }
    // [Removed 2026-04-30] requiresPowerSource gate — power_core room
    // retired in the Room redesign; Trap Factory is the new gateway.
    // Hasty Architect — 25% chance the trap jams; not consumed, will retry on the next eligible adventurer.
    if ((this._gameState._mechanicFlags ?? {}).hastyArchitect &&
        Math.random() < Balance.MECHANIC_HASTY_ARCHITECT_JAM_CHANCE) {
      AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 18, 'JAMMED', { color: '#ffaa55' })
      EventBus.emit('TRAP_JAMMED', { trap, def, adventurer: adv })
      return
    }
    trap.isTriggered = true
    let damage = def.baseDamage ?? 0
    const _mFlags = this._gameState._mechanicFlags ?? {}
    // Phase 9 — Open Book: traps deal 2× damage.
    if (_mFlags.openBook) {
      damage = Math.round(damage * Balance.MECHANIC_OPEN_BOOK_TRAP_DAMAGE_MULT)
    }
    // Phase 9 — Trapsmith's Guild: traps deal -25% damage.
    if (_mFlags.trapDamageMult) {
      damage = Math.max(1, Math.round(damage * _mFlags.trapDamageMult))
    }
    // Phase 9 — Pact of the Jester: +50% trap damage.
    if (_mFlags.pactOfTheJester) {
      damage = Math.round(damage * Balance.MECHANIC_JESTER_TRAP_DAMAGE_MULT)
    }
    // Phase 9 — Pact of the Brand: blessed trap deals 5× damage on its next fire.
    let brandConsumed = false
    if (_mFlags.pactOfTheBrand && trap._brandBlessed) {
      damage = Math.round(damage * Balance.MECHANIC_BRAND_BLESSED_DAMAGE_MULT)
      trap._brandBlessed = false
      brandConsumed = true
    }
    // Stash flag so post-fire cleanup can destroy the blessed trap.
    trap._brandShouldDestroy = brandConsumed
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

    // Phase 9 — Pact of the Brand: blessed trap is destroyed after it fires.
    if (trap._brandShouldDestroy) {
      const idx = this._gameState.dungeon.traps.findIndex(t => t.instanceId === trap.instanceId)
      if (idx >= 0) this._gameState.dungeon.traps.splice(idx, 1)
      EventBus.emit('TRAP_REMOVED', { trap, reason: 'brand_consumed' })
    }
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

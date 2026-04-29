// Phase 9b — InquisitorSystem.
//
// Personality interaction: when an Inquisitor-tagged adventurer enters the
// dungeon, after a short delay (simulating "investigating") they dispel one
// random active dungeon mechanic until they leave. Mechanic auto-restores
// when the inquisitor flees or dies, OR when the day ends.
//
// Tracks per-adventurer dispellings so multiple inquisitors don't double-dip.
// If no mechanics are active, no-op.

import { EventBus } from './EventBus.js'

const INVESTIGATE_DELAY_MS = 8000

export class InquisitorSystem {
  constructor(scene, gameState, dungeonMechanicSystem, personalitySystem) {
    this._scene = scene
    this._gameState = gameState
    this._mechanics = dungeonMechanicSystem
    this._personality = personalitySystem
    this._suspended = {}   // advId → { mechanicId, restoreAt? }
    this._listeners = []

    this._wire()
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    // Restore any still-suspended mechanics
    for (const advId of Object.keys(this._suspended)) this._restoreFor(advId)
  }

  _wire() {
    const onEntered = ({ adventurer }) => this._onEntered(adventurer)
    const onLeft    = ({ adventurer }) => this._restoreFor(adventurer?.instanceId)
    const onDayEnd  = () => {
      for (const advId of Object.keys(this._suspended)) this._restoreFor(advId)
    }
    EventBus.on('ADVENTURER_ENTERED_DUNGEON', onEntered)
    EventBus.on('ADVENTURER_DIED',            onLeft)
    EventBus.on('ADVENTURER_FLED',            onLeft)
    EventBus.on('DAY_PHASE_ENDED',            onDayEnd)
    this._listeners = [
      ['ADVENTURER_ENTERED_DUNGEON', onEntered],
      ['ADVENTURER_DIED',            onLeft],
      ['ADVENTURER_FLED',            onLeft],
      ['DAY_PHASE_ENDED',            onDayEnd],
    ]
  }

  _onEntered(adv) {
    if (!adv) return
    const tags = this._personality?.getTags?.(adv) ?? new Set()
    if (!tags.has('inquisitor') && !tags.has('anti_mechanic')) return

    // Wait the investigate window then dispel a random active mechanic
    this._scene.time.delayedCall(INVESTIGATE_DELAY_MS, () => {
      if (this._suspended[adv.instanceId]) return  // already dispelled
      // Confirm adventurer is still in dungeon
      const stillThere = this._gameState.adventurers.active.some(a => a.instanceId === adv.instanceId)
      if (!stillThere) return

      const active = [...(this._gameState.activeMechanics ?? [])]
      if (active.length === 0) return
      const target = active[Math.floor(Math.random() * active.length)]

      // Snapshot it as suspended (we'll re-activate later)
      this._suspended[adv.instanceId] = { mechanicId: target }
      this._mechanics.deactivate(target)
      EventBus.emit('INQUISITOR_DISPELLED', { adventurer: adv, mechanicId: target })
    })
  }

  _restoreFor(advId) {
    if (!advId) return
    const entry = this._suspended[advId]
    if (!entry) return
    // Re-activate the mechanic if it isn't already on
    if (!this._mechanics.isActive(entry.mechanicId)) {
      this._mechanics.activate(entry.mechanicId)
      EventBus.emit('INQUISITOR_RESTORED', { mechanicId: entry.mechanicId })
    }
    delete this._suspended[advId]
  }
}

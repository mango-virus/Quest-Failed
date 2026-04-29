import { EventBus } from './EventBus.js'

export class EssenceSystem {
  // Total daily upkeep cost across all active rooms + alive minions + un-triggered traps.
  // Dead minions don't draw upkeep (not active until respawn).
  // Triggered traps still draw upkeep (the upkeep funds repair/re-arming overnight).
  static calculateDailyUpkeep(gameState) {
    const roomCost = gameState.dungeon.rooms
      .reduce((sum, r) => sum + (r.upkeepCost ?? 0), 0)
    const minionCost = (gameState.minions ?? [])
      .filter(m => m.aiState !== 'dead')
      .reduce((sum, m) => sum + (m.upkeepCost ?? 0), 0)
    const trapCost = (gameState.dungeon.traps ?? [])
      .reduce((sum, t) => sum + (t.upkeepCost ?? 0), 0)
    return roomCost + minionCost + trapCost
  }

  // Called at the start of each NightPhase.
  // Deducts upkeep from Soul Essence; shuts off rooms newest-first if essence goes negative.
  // Returns { paid, shortfall, deactivated[] }
  static enforceUpkeep(gameState) {
    const upkeep = this.calculateDailyUpkeep(gameState)
    if (upkeep === 0) return { paid: 0, shortfall: 0, deactivated: [] }

    // Try to reactivate previously shut-off rooms before this cycle's deduction
    this._tryReactivate(gameState)

    gameState.player.soulEssence -= upkeep
    const deactivated = []

    if (gameState.player.soulEssence < 0) {
      EventBus.emit('ESSENCE_WARNING', {
        currentEssence: gameState.player.soulEssence,
        shortfall: -gameState.player.soulEssence,
      })

      // Shut off rooms newest-first (reverse array order) until balanced
      const shutdownable = [...gameState.dungeon.rooms]
        .filter(r => r.isActive && (r.upkeepCost ?? 0) > 0 && r.definitionId !== 'boss_chamber')
        .reverse()

      for (const room of shutdownable) {
        if (gameState.player.soulEssence >= 0) break
        room.isActive = false
        gameState.player.soulEssence += room.upkeepCost
        deactivated.push(room)
        EventBus.emit('ROOM_DEACTIVATED', { room })
      }

      // Clamp to 0 if still negative (e.g. all rooms shut off but still short)
      if (gameState.player.soulEssence < 0) {
        EventBus.emit('ESSENCE_CRITICAL')
        gameState.player.soulEssence = 0
      }
    }

    return {
      paid: upkeep,
      shortfall: Math.max(0, upkeep - (gameState.player.soulEssence + upkeep)),
      deactivated,
    }
  }

  // Before deducting, try to bring back rooms that were shut off if we now have surplus.
  // Reactivates oldest-deactivated first (front of array = placed first).
  static _tryReactivate(gameState) {
    const inactive = gameState.dungeon.rooms.filter(r => !r.isActive && (r.upkeepCost ?? 0) > 0)
    const upkeepIfAll = this.calculateDailyUpkeep(gameState) +
      inactive.reduce((s, r) => s + r.upkeepCost, 0)

    // Greedily reactivate from oldest (front) as long as essence covers it
    let projectedEssence = gameState.player.soulEssence
    for (const room of inactive) {
      const newUpkeep = this.calculateDailyUpkeep(gameState) + room.upkeepCost
      if (projectedEssence - newUpkeep >= 0) {
        room.isActive = true
        projectedEssence -= room.upkeepCost
        EventBus.emit('ROOM_PLACED', { room }) // redraws renderer
      }
    }
  }
}

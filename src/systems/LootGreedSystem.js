// Phase 9b — LootGreedSystem.
//
// Free XP for the dungeon: when 2+ greedy-tagged adventurers stand in the
// same room as unclaimed loot, they shove each other every few seconds.
// Each "shove" deals a small percentage-based HP hit to a randomly chosen
// pair member. They don't kill each other in one go — but they bleed HP,
// sometimes to the point of fleeing, and the surviving thief picks up the
// gear.
//
// Tick scan every GREED_CHECK_INTERVAL_MS. Greedy = personality tag 'greedy'
// or 'mapper' (cartographers like loot too) — we stick to 'greedy' as the
// canonical filter and let combos amplify it.
//
// Doesn't override AISystem combat goals; just lays down extra damage events
// the renderer/log will reflect via COMBAT_HIT.

import { EventBus } from './EventBus.js'

const GREED_CHECK_INTERVAL_MS = 4000
const SHOVE_DAMAGE_FRACTION   = 0.06   // 6% maxHP per shove

export class LootGreedSystem {
  constructor(scene, gameState, dungeonGrid, personalitySystem) {
    this._scene = scene
    this._gameState = gameState
    this._dungeonGrid = dungeonGrid
    this._personality = personalitySystem
    this._accum = 0
  }

  destroy() {}

  update(deltaMs) {
    this._accum += deltaMs
    if (this._accum < GREED_CHECK_INTERVAL_MS) return
    this._accum = 0
    this._scan()
  }

  _scan() {
    // Group greedy adventurers by room
    const byRoom = new Map()
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead' || adv.aiState === 'fleeing') continue
      const tags = this._personality?.getTags?.(adv) ?? new Set()
      if (!tags.has('greedy')) continue
      const room = this._dungeonGrid.getRoomAtTile(adv.tileX, adv.tileY)
      if (!room) continue
      // There must be loot in this room
      const hasLoot = (this._gameState.loot?.dungeon ?? []).some(
        i => i.dungeonRoomId === room.instanceId && i.tileX != null
      )
      if (!hasLoot) continue
      const list = byRoom.get(room.instanceId) ?? []
      list.push(adv)
      byRoom.set(room.instanceId, list)
    }

    for (const [roomId, advs] of byRoom.entries()) {
      if (advs.length < 2) continue
      // Randomly pick two distinct adventurers and have them shove
      const [a, b] = _twoOf(advs)
      const dmgA = Math.max(1, Math.round((a.resources?.maxHp ?? 0) * SHOVE_DAMAGE_FRACTION))
      const dmgB = Math.max(1, Math.round((b.resources?.maxHp ?? 0) * SHOVE_DAMAGE_FRACTION))
      a.resources.hp = Math.max(0, a.resources.hp - dmgA)
      b.resources.hp = Math.max(0, b.resources.hp - dmgB)

      EventBus.emit('LOOT_GREED_BRAWL', { roomId, attacker: a, defender: b, damageA: dmgA, damageB: dmgB })
      EventBus.emit('COMBAT_HIT', {
        sourceId:   b.instanceId,
        targetId:   a.instanceId,
        damage:     dmgA,
        damageType: 'physical',
        isCritical: false,
      })
      EventBus.emit('COMBAT_HIT', {
        sourceId:   a.instanceId,
        targetId:   b.instanceId,
        damage:     dmgB,
        damageType: 'physical',
        isCritical: false,
      })
    }
  }
}

function _twoOf(arr) {
  const a = arr[Math.floor(Math.random() * arr.length)]
  let b = a
  while (b === a) b = arr[Math.floor(Math.random() * arr.length)]
  return [a, b]
}

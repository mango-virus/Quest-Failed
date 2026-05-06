// FountainRenderer — draws every Healing Fountain as a looping
// cascading-water sprite on its tile. Sheet is 48×64 so the fountain
// rises a full extra tile above its anchor.
//
// On heal completion, the AISystem emits FOUNTAIN_HEAL_USED — we pop a
// quick "+HP" floater above the adventurer.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class FountainRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}

    EventBus.on('FOUNTAIN_HEAL_USED', this._onHealUsed, this)
  }

  destroy() {
    EventBus.off('FOUNTAIN_HEAL_USED', this._onHealUsed, this)
    for (const s of Object.values(this._sprites)) s?.destroy?.()
    this._sprites = {}
  }

  update() {
    const fountains = this._gameState.dungeon?.fountains ?? []
    const seen = new Set()
    for (const f of fountains) {
      seen.add(f.instanceId)
      const cx = f.tileX * TS + TS / 2
      const cy = f.tileY * TS + TS - 2
      let s = this._sprites[f.instanceId]
      if (!s) {
        s = this._scene.add.sprite(cx, cy, 'item-healing-fountain', 0)
          .setOrigin(0.5, 1).setDepth(2.7)
        if (this._scene.anims.exists('item-healing-fountain-flow')) {
          s.play('item-healing-fountain-flow')
        }
        this._sprites[f.instanceId] = s
      } else {
        s.setPosition(cx, cy)
      }
    }
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) {
        this._sprites[id]?.destroy?.()
        delete this._sprites[id]
      }
    }
  }

  // "+HP" floater above the healed adv, similar to the LOOT_CORPSE buff.
  _onHealUsed({ adventurer, healed }) {
    try {
      if (!adventurer) return
      const x = adventurer.worldX
      const y = adventurer.worldY - 18
      const t = this._scene.add.text(x, y, `+${healed} HP`, {
        fontSize:        '11px',
        color:           '#7fdcdc',
        fontFamily:      '"Press Start 2P", monospace',
        stroke:          '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5, 1).setDepth(40)
      this._scene.tweens.add({
        targets:    t,
        y:          y - 22,
        alpha:      { from: 1, to: 0 },
        duration:   1200,
        ease:       'Quad.easeOut',
        onComplete: () => { try { t.destroy() } catch {} },
      })
    } catch (err) {
      console.warn('[FountainRenderer] _onHealUsed failed:', err.message)
    }
  }
}

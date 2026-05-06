// BeaconRenderer — draws every Soul-Bound Beacon as a looping pulsing
// monolith on its tile. Beacon sprite (47×48) is taller than a tile, so
// we anchor at bottom-center and let the pulse art rise above the tile.
//
// Visuals only — pathfinder collision is enforced by AISystem +
// MinionAISystem reading `gameState.dungeon.beacons[].tileX/tileY`.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class BeaconRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}
  }

  destroy() {
    for (const s of Object.values(this._sprites)) s?.destroy?.()
    this._sprites = {}
  }

  update() {
    const beacons = this._gameState.dungeon?.beacons ?? []
    const seen = new Set()
    for (const b of beacons) {
      seen.add(b.instanceId)
      const cx = b.tileX * TS + TS / 2
      const cy = b.tileY * TS + TS - 2   // bottom-center of the tile
      let s = this._sprites[b.instanceId]
      if (!s) {
        s = this._scene.add.sprite(cx, cy, 'item-soul-beacon', 0)
          .setOrigin(0.5, 1).setDepth(2.7)
        if (this._scene.anims.exists('item-soul-beacon-pulse')) {
          s.play('item-soul-beacon-pulse')
        }
        this._sprites[b.instanceId] = s
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
}

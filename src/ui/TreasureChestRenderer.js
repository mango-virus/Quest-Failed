// TreasureChestRenderer — draws every Treasure Chest as a tiered pixel
// chest pinned to its tile. Each chest has a 4-frame open animation:
// frame 0 = closed (idle), frames 1–3 = opening, holds frame 3 after
// the player or an adventurer triggers the open.
//
// State lives on `gameState.dungeon.treasureChests[]` so save/load
// round-trips. AISystem flips `chest.opened = true` on theft; we react
// here by playing the matching `item-treasure-chest-<tier>-open` anim.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE
// Chest sprites are 31×32 native — too small to read at game zoom.
// 1.6× keeps them readable without dwarfing the surrounding tile.
const CHEST_SCALE = 1.6

export class TreasureChestRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // chestId → Sprite

    EventBus.on('TREASURE_CHEST_OPENED', this._onChestOpened, this)
  }

  destroy() {
    EventBus.off('TREASURE_CHEST_OPENED', this._onChestOpened, this)
    for (const s of Object.values(this._sprites)) s?.destroy?.()
    this._sprites = {}
  }

  update() {
    const chests = this._gameState.dungeon?.treasureChests ?? []
    const seen = new Set()
    for (const c of chests) {
      seen.add(c.instanceId)
      const cx = c.tileX * TS + TS / 2
      const cy = c.tileY * TS + TS - 2
      let s = this._sprites[c.instanceId]
      if (!s) {
        const texKey = `item-treasure-chest-${c.tier}`
        if (!this._scene.textures.exists(texKey)) continue
        // Anchor at bottom-center; chest sprite is taller than a tile.
        s = this._scene.add.sprite(cx, cy, texKey, c.opened ? 3 : 0)
          .setOrigin(0.5, 1).setDepth(2.6).setScale(CHEST_SCALE)
        this._sprites[c.instanceId] = s
      } else {
        s.setPosition(cx, cy)
      }
      // Snap to closed/open frame whenever state changes (e.g. night
      // reset). Mid-open animation is owned by _onChestOpened.
      if (!c.opened && s.anims?.currentAnim?.key?.endsWith('-open')) s.stop()
      if (!c.opened && s.frame?.name !== 0)        s.setFrame(0)
      else if (c.opened && !s.anims?.isPlaying && s.frame?.name !== 3) s.setFrame(3)
    }
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) {
        this._sprites[id]?.destroy?.()
        delete this._sprites[id]
      }
    }
  }

  _onChestOpened({ chest }) {
    try {
      if (!chest) return
      const s = this._sprites[chest.instanceId]
      if (!s) return
      const animKey = `item-treasure-chest-${chest.tier}-open`
      if (this._scene.anims.exists(animKey)) {
        s.play(animKey)
      } else {
        s.setFrame(3)
      }
    } catch (err) {
      console.warn('[TreasureChestRenderer] _onChestOpened failed:', err.message)
    }
  }
}

// KeyChestRenderer — draws the key chests dropped as the trade-off for
// each Door Lock. Each chest uses the 2-frame `item-key-chest` sheet:
// frame 0 = closed (idle), frame 1 = opened (after an adventurer pries
// it). On open, a key sprite floats up and fades to telegraph the
// pickup. State persists on gameState.dungeon.keyChests; per-frame
// rendering pulls fresh, so save/load is automatic.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE
// Match the treasure-chest renderer scale so both chest types read the
// same size in the dungeon view.
const CHEST_SCALE = 1.6

export class KeyChestRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // chestId → Sprite

    EventBus.on('KEY_CHEST_OPENED', this._onChestOpened, this)
    EventBus.on('NIGHT_PHASE_STARTED', this._refreshAll, this)
  }

  destroy() {
    EventBus.off('KEY_CHEST_OPENED', this._onChestOpened, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._refreshAll, this)
    for (const s of Object.values(this._sprites)) s?.destroy?.()
    this._sprites = {}
  }

  update() {
    const chests = this._gameState.dungeon?.keyChests ?? []
    const seen = new Set()
    for (const c of chests) {
      seen.add(c.instanceId)
      // Anchor bottom-center on the chest's tile — same as the treasure
      // chest renderer so both chest types sit on the tile they were
      // placed on (origin 0.5,1 means cy is the chest's ground line).
      const cx = c.tileX * TS + TS / 2
      const cy = c.tileY * TS + TS - 2
      let s = this._sprites[c.instanceId]
      if (!s) {
        s = this._scene.add.sprite(cx, cy, 'item-key-chest', 0)
          .setOrigin(0.5, 1).setDepth(2.6).setScale(CHEST_SCALE)
        this._sprites[c.instanceId] = s
      } else {
        s.setPosition(cx, cy)
      }
      s.setFrame(c.opened ? 1 : 0)
    }
    // Cull sprites whose chest is gone (sold/cleared).
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) {
        this._sprites[id]?.destroy?.()
        delete this._sprites[id]
      }
    }
  }

  // Float the key sprite upward + fade — fires once per chest-open event.
  // Wrapped: any throw in here previously killed Phaser's update loop
  // (whole game froze) because event listeners run during the tick.
  _onChestOpened({ chest }) {
    try {
      if (!chest) return
      // Bail if the key texture failed to preload — better to silently
      // skip the float than to throw and freeze the game.
      if (!this._scene.textures.exists('item-key')) return
      const cx = chest.tileX * TS + TS / 2
      const cy = chest.tileY * TS + TS / 2
      // Use add.image (not add.sprite) — `item-key` is a single-frame
      // image texture, not a spritesheet. Passing a frame index to
      // add.sprite on an image texture throws in some Phaser builds.
      const k = this._scene.add.image(cx, cy - 12, 'item-key')
        .setOrigin(0.5).setDepth(40)
      this._scene.tweens.add({
        targets:    k,
        y:          cy - 36,
        alpha:      { from: 1, to: 0 },
        duration:   1000,
        ease:       'Quad.easeOut',
        onComplete: () => { try { k.destroy() } catch {} },
      })
    } catch (err) {
      console.warn('[KeyChestRenderer] _onChestOpened failed:', err.message)
    }
  }

  // On day reset, every chest snaps back to its closed frame; the
  // gameState mutation is owned by AISystem._onNightStartedAI but the
  // sprite needs to reflect it on the next tick. This is a no-op poll
  // (update() already syncs) — exists to keep API consistent.
  _refreshAll() { /* no-op; update() reads fresh state */ }
}

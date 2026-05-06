// LockRenderer — was a padlock-icon overlay on every locked doorway.
//
// The padlock visual now lives in the locked-door tile sprite itself
// (DungeonRenderer's `_doorStateFor` picks the locked variant), so the
// overlay is redundant. We keep the renderer wired (no-op update) so
// the rest of the system continues to work and we can reintroduce a
// status overlay later without re-plumbing scene lifecycle.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class LockRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // lockId → Sprite
  }

  destroy() {
    for (const s of Object.values(this._sprites)) s?.destroy?.()
    this._sprites = {}
  }

  update() {
    // No-op — locked-door tile sprite is the source of truth now.
    // Drop any sprites that were created before this was disabled.
    for (const id of Object.keys(this._sprites)) {
      this._sprites[id]?.destroy?.()
      delete this._sprites[id]
    }
  }
}

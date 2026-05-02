// Phase 9 — Pact of the Cartographer overlay.
//
// While the pact is active, every adventurer's planned path is rendered
// as a chain of dots from their current tile to their next goal. Updates
// per-frame so the overlay reflects re-pathing.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class CartographerOverlay {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs    = gameState
    this._gfx   = scene.add.graphics().setDepth(2.4)
  }

  destroy() {
    this._gfx?.destroy?.()
    this._gfx = null
  }

  // Called every frame from Game.update. Cheap — only paints when the pact
  // is active and there are advs with paths to draw.
  tick() {
    if (!this._gfx) return
    this._gfx.clear()
    const flags = this._gs?._mechanicFlags ?? {}
    if (!flags.pactOfTheCartographer) return
    if (this._gs?.meta?.phase !== 'day') return

    const advs = this._gs.adventurers?.active ?? []
    for (const adv of advs) {
      if (adv.aiState === 'dead' || !Array.isArray(adv.path)) continue
      const startIdx = Math.max(0, adv.pathIndex ?? 0)
      const remaining = adv.path.slice(startIdx)
      if (remaining.length === 0) continue

      // Color-code by classColor so multiple parties read distinctly.
      const color = adv.classColor ?? 0xffaa44
      this._gfx.fillStyle(color, 0.55)
      for (const node of remaining) {
        const cx = node.x * TS + TS / 2
        const cy = node.y * TS + TS / 2
        this._gfx.fillCircle(cx, cy, 2)
      }
      // Last-tile pip — slightly bigger so the destination reads.
      const last = remaining[remaining.length - 1]
      this._gfx.fillStyle(color, 0.85)
      this._gfx.fillCircle(last.x * TS + TS / 2, last.y * TS + TS / 2, 3)
    }
  }
}

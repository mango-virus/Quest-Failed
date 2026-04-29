// Phase 9 — Eternal Night fog-of-war overlay.
//
// Builds on Phase 8b's KnowledgeSystem.visibleRoomIds(). When the
// `eternal_night` mechanic is active, paints all rooms outside the union
// of currently-active adventurers' visible-room sets with a dark veil.
//
// Renders as a single Graphics object at depth 2.7 (above the knowledge
// overlay, below trap/minion/adventurer sprites). Throttled to a few updates per second to
// avoid per-frame fill churn — the visibility set rarely changes faster than
// adventurers cross room thresholds.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE
const REFRESH_MS = 200

export class EternalNightOverlay {
  constructor(scene, gameState, knowledgeSystem) {
    this._scene = scene
    this._gameState = gameState
    this._knowledgeSystem = knowledgeSystem
    this._g = scene.add.graphics().setDepth(2.7)
    this._enabled = false
    this._g.setVisible(false)
    this._lastUpdate = 0
  }

  destroy() { this._g?.destroy() }

  setEnabled(on) {
    this._enabled = !!on
    this._g.setVisible(this._enabled)
    if (!this._enabled) this._g.clear()
    else this._render()
  }

  update() {
    if (!this._enabled) return
    const now = this._scene.time.now
    if (now - this._lastUpdate < REFRESH_MS) return
    this._lastUpdate = now
    this._render()
  }

  _render() {
    const g = this._g
    g.clear()

    // Compute union of visible room IDs across all active adventurers
    const visible = new Set()
    for (const adv of this._gameState.adventurers.active ?? []) {
      const ids = this._knowledgeSystem?.visibleRoomIds?.(adv) ?? []
      for (const id of ids) visible.add(id)
    }

    // Paint every NON-visible room with a dark veil
    for (const room of this._gameState.dungeon.rooms ?? []) {
      if (visible.has(room.instanceId)) continue
      g.fillStyle(0x000000, 0.55)
      g.fillRect(room.gridX * TS, room.gridY * TS, room.width * TS, room.height * TS)
    }
  }
}

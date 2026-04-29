// Phase 8 — Knowledge overlay.
// Toggleable via a button in DayPhase. When active, paints each known room
// with a red→blue gradient (red = well-known by adventurers, blue = mystery).
//
// Reads aggregate "warmth" from KnowledgeSystem.computeKnowledgeMap() each
// tick. Renders as a single Graphics object in world space so camera
// scroll/zoom applies uniformly.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class KnowledgeOverlay {
  constructor(scene, gameState, knowledgeSystem) {
    this._scene = scene
    this._gameState = gameState
    this._knowledgeSystem = knowledgeSystem
    this._g = scene.add.graphics().setDepth(2.5)   // above void/grid (depth 0), below corridors (1) and rooms (2)
    this._g.setVisible(false)
    this._enabled = false
  }

  destroy() {
    this._g?.destroy()
  }

  setEnabled(on) {
    this._enabled = !!on
    this._g.setVisible(this._enabled)
    if (this._enabled) this.update()
    else this._g.clear()
  }

  toggle() { this.setEnabled(!this._enabled) }

  isEnabled() { return this._enabled }

  update() {
    if (!this._enabled) return
    const heat = this._knowledgeSystem?.computeKnowledgeMap?.() ?? {}
    const g = this._g
    g.clear()
    for (const room of this._gameState.dungeon.rooms) {
      const warmth = heat[room.instanceId] ?? 0
      // Red (1.0) → purple (0.5) → cool blue (0.0)
      const color = _warmthColor(warmth)
      g.fillStyle(color, 0.35)
      g.fillRect(room.gridX * TS, room.gridY * TS, room.width * TS, room.height * TS)
      // Outline a slightly brighter border for known rooms
      if (warmth > 0) {
        g.lineStyle(1, color, Math.min(1, 0.4 + warmth * 0.6))
        g.strokeRect(room.gridX * TS, room.gridY * TS, room.width * TS, room.height * TS)
      }
    }
  }
}

function _warmthColor(w) {
  // Hue interpolation: cool blue (0.0) → purple (0.5) → red (1.0)
  const r = Math.round(20 + (200 * w))
  const g = Math.round(20 + (40 * (1 - w)))
  const b = Math.round(180 - (160 * w))
  return (r << 16) | (g << 8) | b
}

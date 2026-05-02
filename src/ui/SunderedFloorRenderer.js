// Phase 9 — Pact of the Sundered Floor visualizer.
//
// Listens for the pact's lifecycle events and paints overlays on the
// affected tile:
//   SUNDERED_FLOOR_TELEGRAPHED → pulsing yellow warning circle
//   SUNDERED_FLOOR_FIRED       → solid black square (the "pitch black" pit)
// All overlays clear on NIGHT_PHASE_STARTED so day N+1 starts clean.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class SunderedFloorRenderer {
  constructor(scene) {
    this._scene = scene
    this._overlays = []   // [{ tileX, tileY, gfx, tween, kind }]
    this._listeners = []
    const on = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    on('SUNDERED_FLOOR_TELEGRAPHED', this._onTelegraphed.bind(this))
    on('SUNDERED_FLOOR_FIRED',       this._onFired.bind(this))
    on('NIGHT_PHASE_STARTED',        this._clearAll.bind(this))
  }

  destroy() {
    for (const [e, fn] of this._listeners) EventBus.off(e, fn)
    this._listeners = []
    this._clearAll()
  }

  _onTelegraphed({ tileX, tileY }) {
    const cx = tileX * TS + TS / 2
    const cy = tileY * TS + TS / 2
    const gfx = this._scene.add.graphics().setDepth(2.5)
    const draw = (alpha = 0.7) => {
      gfx.clear()
      gfx.lineStyle(2, 0xffaa33, alpha)
      gfx.strokeCircle(cx, cy, TS * 0.45)
      gfx.lineStyle(1, 0xffee99, alpha * 0.6)
      gfx.strokeCircle(cx, cy, TS * 0.55)
    }
    draw()
    const tween = this._scene.tweens.add({
      targets: { a: 0.9 },
      a: 0.35,
      duration: 400,
      yoyo: true,
      repeat: -1,
      onUpdate: (t, target) => draw(target.a),
    })
    this._overlays.push({ tileX, tileY, gfx, tween, kind: 'telegraph' })
  }

  _onFired({ tileX, tileY }) {
    // Remove any telegraph overlay for this tile
    for (const o of this._overlays) {
      if (o.tileX === tileX && o.tileY === tileY && o.kind === 'telegraph') {
        o.tween?.stop?.()
        o.gfx?.destroy?.()
      }
    }
    this._overlays = this._overlays.filter(o => !(o.tileX === tileX && o.tileY === tileY && o.kind === 'telegraph'))

    // Paint the pitch-black square
    const px = tileX * TS, py = tileY * TS
    const gfx = this._scene.add.graphics().setDepth(2.6)
    gfx.fillStyle(0x000000, 1)
    gfx.fillRect(px, py, TS, TS)
    gfx.lineStyle(1, 0x222222, 1)
    gfx.strokeRect(px + 1, py + 1, TS - 2, TS - 2)
    this._overlays.push({ tileX, tileY, gfx, tween: null, kind: 'pit' })
  }

  _clearAll() {
    for (const o of this._overlays) {
      o.tween?.stop?.()
      o.gfx?.destroy?.()
    }
    this._overlays = []
  }
}

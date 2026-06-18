// VeilRenderer — a thin churning amnesiac ground-mist that clings to every
// active Veil of Forgetting. Each night, when the veil wipes the intel of its
// connected rooms, it EXHALES: a pale mist-wave rolls out through each
// connected doorway and faint glyph-scraps (the forgotten rooms) drift up and
// crumble into static. A low fog + a directional outward exhale — tied to the
// intel-wipe it represents.
//
// Decor-independent (room geometry + connected door ports). The wipe mechanic
// lives in RoomBehaviorSystem (emits VEIL_ERASED_INTEL).

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { connectedDoorPorts } from '../util/roomPorts.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_MIST = 3.6   // ground-hugging, just above floor decals

const COL_MIST  = 0xb6bcc6   // pale amnesiac grey
const COL_MIST2 = 0x8a90a0

export class VeilRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_MIST)
    this._t = 0
    EventBus.on('VEIL_ERASED_INTEL', this._onErase, this)
  }

  destroy() {
    EventBus.off('VEIL_ERASED_INTEL', this._onErase, this)
    try { this._g?.destroy() } catch {}
    this._g = null
  }

  update(delta) {
    const g = this._g
    if (!g) return
    this._t += Math.min(50, delta ?? 16) / 1000
    g.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'veil_of_forgetting' || room.isActive === false) continue
      this._drawMist(g, room, lod)
    }
  }

  _drawMist(g, room, lod) {
    const ix0 = (room.gridX + WT) * TS, iy0 = (room.gridY + WT) * TS
    const ix1 = (room.gridX + room.width - WT) * TS, iy1 = (room.gridY + room.height - WT) * TS
    const cx = (ix0 + ix1) / 2, cy = (iy0 + iy1) / 2
    const rx = (ix1 - ix0) / 2, ry = (iy1 - iy0) / 2
    const t = this._t
    // a few big soft lobed fog banks drifting + morphing
    const banks = lod ? 1 : 3
    for (let b = 0; b < banks; b++) {
      const ph = b * 2.3
      const ox = Math.sin(t * 0.3 + ph) * rx * 0.3
      const oy = Math.cos(t * 0.23 + ph) * ry * 0.25
      const col = b % 2 ? COL_MIST2 : COL_MIST
      this._fog(g, cx + ox, cy + oy, rx * 0.85, ry * 0.8, t + ph, col, 0.07)
    }
  }

  _fog(g, cx, cy, rx, ry, t, color, alpha) {
    const N = 22, pts = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const n = 0.22 * Math.sin(a * 2 + t * 0.6) + 0.14 * Math.sin(a * 4 - t * 0.45) + 0.08 * Math.sin(a * 6 + t * 0.3)
      pts.push({ x: cx + Math.cos(a) * rx * (1 + n), y: cy + Math.sin(a) * ry * (1 + n) })
    }
    g.fillStyle(color, alpha)
    g.fillPoints(pts, true)
  }

  // The nightly exhale — fired on VEIL_ERASED_INTEL.
  _onErase({ roomIds } = {}) {
    try {
      const s = this._scene
      if (!s) return
      const grid = s.dungeonGrid
      const veils = (this._gameState.dungeon?.rooms ?? []).filter(r =>
        r.definitionId === 'veil_of_forgetting' && r.isActive !== false)
      for (const veil of veils) {
        const ports = grid ? connectedDoorPorts(veil, grid, { excludeDefs: ['boss_chamber', 'entry_hall'] }) : []
        for (const p of ports) {
          this._exhalePort(s, p)
        }
      }
    } catch (err) {
      console.warn('[VeilRenderer] _onErase failed:', err.message)
    }
  }

  _exhalePort(s, port) {
    // a pale mist puff rolls out the doorway + a glyph-scrap dissolves
    const puff = s.add.graphics().setDepth(DEPTH_MIST + 0.1).setPosition(port.x, port.y)
    const drawPuff = (p) => {
      puff.clear()
      const N = 16, pts = []
      const rr = 6 + p * 26
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU
        const n = 0.3 * Math.sin(a * 3 + p * 4)
        pts.push({ x: Math.cos(a) * rr * (1 + n), y: Math.sin(a) * rr * (1 + n) })
      }
      puff.fillStyle(COL_MIST, 0.22 * (1 - p))
      puff.fillPoints(pts, true)
    }
    drawPuff(0)
    s.tweens.add({
      targets: { p: 0 }, p: 1, duration: 900, ease: 'Quad.easeOut',
      onUpdate: (tw, tg) => {
        try {
          drawPuff(tg.p)
          puff.x = port.x + port.dx * TS * 1.4 * tg.p
          puff.y = port.y + port.dy * TS * 1.4 * tg.p
        } catch {}
      },
      onComplete: () => { try { puff.destroy() } catch {} },
    })
    // glyph-scrap: a small torn page/rune mark that drifts up + crumbles
    const scrap = s.add.graphics().setDepth(DEPTH_MIST + 0.15).setPosition(port.x + port.dx * 10, port.y + port.dy * 10)
    scrap.fillStyle(0xd8d2c0, 0.85)
    scrap.fillRect(-4, -5, 8, 10)             // rect-ok: a torn page scrap (geometric by fiction)
    scrap.lineStyle(1, 0x6a6450, 0.8)
    scrap.lineBetween(-2.5, -2, 2.5, -2); scrap.lineBetween(-2.5, 1, 1.5, 1)   // "writing"
    s.tweens.add({
      targets: scrap, y: scrap.y - 24, alpha: { from: 0.9, to: 0 }, angle: (Math.random() - 0.5) * 40,
      scaleX: { from: 1, to: 0.2 }, scaleY: { from: 1, to: 0.2 },
      duration: 850, ease: 'Quad.easeIn', onComplete: () => { try { scrap.destroy() } catch {} },
    })
  }
}

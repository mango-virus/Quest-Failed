// TreasuryRenderer — a warm hoard-glow rises from the room's heart, sharp
// coin-glints twinkle on the actual treasure-chest entities, gold dust drifts,
// and a faint golden lure bleeds out the connected doorways (the "draws
// adventurers" bait). On TREASURY_STIPEND coins spill with a sparkle.
//
// Decor-independent: the glow is at room centre, glints ride the real chest
// entities (gameplay objects, not decor). Gold/calm — distinct from the
// Armory's hot, flickering, red forge. Stipend mechanic in RoomBehaviorSystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { connectedDoorPorts } from '../util/roomPorts.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_GOLD = 6.0

const COL_GOLD  = 0xffcf45
const COL_GOLD2 = 0xfff0a8
const COL_GLINT = 0xfffdf0

export class TreasuryRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_GOLD)
    try { this._g.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    EventBus.on('TREASURY_STIPEND', this._onStipend, this)
  }

  destroy() {
    EventBus.off('TREASURY_STIPEND', this._onStipend, this)
    try { this._g?.destroy() } catch {}
    this._g = null
  }

  update(delta) {
    if (!this._g) return
    this._t += Math.min(50, delta ?? 16) / 1000
    this._g.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const grid = this._scene.dungeonGrid
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'treasury' || room.isActive === false) continue
      this._draw(this._g, room, grid, lod)
    }
  }

  _inRoom(room, tx, ty) {
    return tx >= room.gridX && tx < room.gridX + room.width &&
           ty >= room.gridY && ty < room.gridY + room.height
  }

  _draw(g, room, grid, lod) {
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t
    const breathe = 0.9 + 0.1 * Math.sin(t * 1.4)

    // hoard glow at the heart
    this._blob(g, cx, cy, 16 * breathe, t, COL_GOLD, 0.12, 3)
    this._blob(g, cx, cy, 9 * breathe, t * 1.3, COL_GOLD, 0.2, 7)

    if (lod) return

    // lure-bleed at connected doorways — a soft gold wash spilling out
    if (grid) {
      for (const p of connectedDoorPorts(room, grid, { excludeDefs: ['boss_chamber'] })) {
        const lx = p.x + p.dx * TS * 0.5, ly = p.y + p.dy * TS * 0.5
        const pulse = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.6 + p.x * 0.01))
        g.fillStyle(COL_GOLD, pulse)
        g.fillCircle(lx, ly, 13)   // circle-ok: doorway lure-bleed glow
      }
    }

    // gold dust motes drifting up
    for (let i = 0; i < 6; i++) {
      const ph = i * 1.3
      const prog = (t * 0.25 + i * 0.17) % 1
      const mx = cx + Math.sin(t * 0.7 + ph) * 16 + (i - 3) * 4
      const my = cy + 10 - prog * 26
      g.fillStyle(COL_GOLD2, 0.4 * (1 - prog))
      g.fillCircle(mx, my, 0.9)   // circle-ok: gold dust mote
    }

    // sharp coin-glints on the real chest entities in this room
    const chests = this._gameState.dungeon?.treasureChests ?? []
    for (const c of chests) {
      if (!this._inRoom(room, c.tileX, c.tileY)) continue
      const gx = (c.tileX + 0.5) * TS, gy = (c.tileY + 0.5) * TS - 4
      // each chest twinkles on its own phase; only flashes briefly
      const tw = (Math.sin(t * 2.1 + (c.tileX + c.tileY) * 1.3) + 1) / 2
      if (tw < 0.78) continue
      const k = (tw - 0.78) / 0.22
      g.fillStyle(COL_GLINT, 0.9 * k)
      const r = 3 * k + 1
      g.fillCircle(gx, gy, 1.1)   // circle-ok: coin glint core
      g.lineStyle(1, COL_GLINT, 0.9 * k)
      g.lineBetween(gx - r, gy, gx + r, gy)
      g.lineBetween(gx, gy - r, gx, gy + r)   // 4-point sparkle
    }
  }

  _blob(g, cx, cy, r, t, color, alpha, seed) {
    const N = 16, pts = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const n = 0.16 * Math.sin(a * 3 + t * 1.0 + seed) + 0.09 * Math.sin(a * 5 - t * 0.7)
      pts.push({ x: cx + Math.cos(a) * r * (1 + n), y: cy + Math.sin(a) * r * (1 + n) })
    }
    g.fillStyle(color, alpha)
    g.fillPoints(pts, true)
  }

  _onStipend({ } = {}) {
    try {
      const s = this._scene
      const rooms = (this._gameState.dungeon?.rooms ?? []).filter(r =>
        r.definitionId === 'treasury' && r.isActive !== false)
      for (const room of rooms) {
        const cx = (room.gridX + room.width / 2) * TS
        const cy = (room.gridY + room.height / 2) * TS
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8
          const sp = 30 + Math.random() * 50
          const coin = s.add.graphics().setDepth(DEPTH_GOLD + 0.2).setPosition(cx, cy)
          coin.fillStyle(COL_GOLD, 1); coin.fillCircle(0, 0, 2)        // circle-ok: spilling coin
          coin.fillStyle(COL_GOLD2, 0.9); coin.fillCircle(-0.6, -0.6, 0.8)  // circle-ok: coin shine
          const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp
          s.tweens.add({ targets: coin, x: cx + vx * 0.5, y: cy + vy * 0.5 + 18,
            alpha: { from: 1, to: 0 }, angle: Math.random() * 360, duration: 620,
            ease: 'Quad.easeIn', onComplete: () => { try { coin.destroy() } catch {} } })
        }
      }
    } catch (err) {
      console.warn('[TreasuryRenderer] _onStipend failed:', err.message)
    }
  }
}

// TrapFactoryRenderer — a working machine-shop: a heavy iron GEAR turns slowly
// at the room's heart, a grindstone throws a sideways FAN of white-blue sparks
// in bursts, and grey STEAM puffs vent and rise. Cold mechanical palette +
// directional spark fan — deliberately NOT the Armory's hot, upward, orange
// forge fountain.
//
// Decor-independent (drawn at room centre; no anvil/forge prop). Trap Factory
// is a gateway room with no per-day event, so this is ambience only.

import { Balance } from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const TAU = Math.PI * 2

const DEPTH_SHOP = 5.9

const COL_IRON   = 0x4a4e57   // iron gear body
const COL_IRON_D = 0x2a2d34   // gear shadow
const COL_IRON_H = 0x717784   // gear highlight
const COL_SPARK  = 0xcfe6ff   // cold grindstone spark
const COL_SPARK_H = 0xffffff
const COL_STEAM  = 0x9aa0aa

export class TrapFactoryRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_SHOP)
    this._t = 0
    this._fx = {}   // roomId → { sparks:[], steam:[] }
  }

  destroy() {
    try { this._g?.destroy() } catch {}
    this._g = null
    this._fx = {}
  }

  update(delta) {
    if (!this._g) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._g.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'trap_factory' || room.isActive === false) continue
      live.add(room.instanceId)
      this._draw(this._g, room, dt, lod)
    }
    for (const id of Object.keys(this._fx)) if (!live.has(id)) delete this._fx[id]
  }

  _draw(g, room, dt, lod) {
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t
    let st = this._fx[room.instanceId]
    if (!st) { st = { sparks: [], steam: [] }; this._fx[room.instanceId] = st }

    // slow-turning iron gear at the heart
    this._gear(g, cx, cy, 13, t * 0.6, 10)
    // a smaller meshing gear off to the side, turning the other way
    if (!lod) this._gear(g, cx + 20, cy + 8, 7, -t * 1.1, 7)

    if (lod) return

    // grindstone spark bursts — a horizontal fan of cold sparks, periodic
    const gx = cx - 18, gy = cy + 6   // grindstone contact point (left of gear)
    const burst = (t % 1.3) / 1.3
    if (burst < 0.14) {
      for (let i = 0; i < 2; i++) {
        const a = Math.PI + (Math.random() - 0.5) * 0.9   // spray leftward
        const sp = 50 + Math.random() * 60
        st.sparks.push({ x: gx, y: gy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10, life: 0, maxLife: 0.3 + Math.random() * 0.3 })
      }
    }
    for (let i = st.sparks.length - 1; i >= 0; i--) {
      const s = st.sparks[i]
      s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 140 * dt
      if (s.life >= s.maxLife) { st.sparks.splice(i, 1); continue }
      const a = 1 - s.life / s.maxLife
      // a short streak (motion line) + bright head
      g.lineStyle(1, COL_SPARK, 0.8 * a)
      g.lineBetween(s.x, s.y, s.x - s.vx * 0.012, s.y - s.vy * 0.012)
      g.fillStyle(COL_SPARK_H, a)
      g.fillCircle(s.x, s.y, 0.8)   // circle-ok: grindstone spark head
    }

    // steam puffs venting up from the gear
    if ((t % 1.9) / 1.9 < 0.04) st.steam.push({ x: cx + (Math.random() - 0.5) * 10, y: cy - 8, life: 0, maxLife: 1.4 + Math.random() * 0.8 })
    for (let i = st.steam.length - 1; i >= 0; i--) {
      const p = st.steam[i]
      p.life += dt; p.y -= 14 * dt; p.x += Math.sin(p.life * 2) * 5 * dt
      if (p.life >= p.maxLife) { st.steam.splice(i, 1); continue }
      const k = p.life / p.maxLife
      g.fillStyle(COL_STEAM, 0.16 * (1 - k))
      g.fillCircle(p.x, p.y, 3 + k * 7)   // circle-ok: steam puff
    }
  }

  // a cog: a notched ring with a hub, shaded (shadow ring under a body ring +
  // highlight) and teeth around the rim.
  _gear(g, cx, cy, r, rot, teeth) {
    const drawRing = (rr, col, alpha) => {
      g.fillStyle(col, alpha)
      const pts = []
      const N = teeth * 2
      for (let i = 0; i < N; i++) {
        const a = rot + (i / N) * TAU
        const tooth = (i % 2 === 0) ? 1.18 : 0.92
        pts.push({ x: cx + Math.cos(a) * rr * tooth, y: cy + Math.sin(a) * rr * tooth })
      }
      g.fillPoints(pts, true)
    }
    drawRing(r + 1.2, COL_IRON_D, 0.9)   // shadow
    drawRing(r, COL_IRON, 1)             // body
    // highlight arc (top-left)
    g.lineStyle(1.2, COL_IRON_H, 0.6)
    g.beginPath()
    for (let i = 0; i <= 8; i++) { const a = rot - Math.PI * 0.9 + (i / 8) * Math.PI * 0.6; const rr = r * 1.0; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y) }
    g.strokePath()
    // hub hole
    g.fillStyle(COL_IRON_D, 1)
    g.fillCircle(cx, cy, r * 0.32)   // circle-ok: gear hub bore
    g.fillStyle(COL_IRON_H, 0.5)
    g.fillCircle(cx - r * 0.08, cy - r * 0.08, r * 0.16)   // circle-ok: hub bevel
  }
}

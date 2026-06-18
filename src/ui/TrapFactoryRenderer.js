// TrapFactoryRenderer — a working machine-shop mechanism: two shaded
// interlocking GEARS (teeth + spokes + hub) turn, a CRANK on the big gear
// drives a PISTON pumping in its cylinder, a GRINDSTONE throws a fan of cold
// sparks, and STEAM vents up. Detailed mechanical parts in a cold-iron palette
// — deliberately not the Armory's hot forge.
//
// Decor-independent (drawn at room centre). Trap Factory is a gateway room
// with no per-day event, so this is ambience only.

import { Balance } from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const TAU = Math.PI * 2

const DEPTH_SHOP = 5.9
const DEPTH_SPARK = 6.3

const C_D  = 0x24272e   // iron shadow
const C_B  = 0x444953   // iron body
const C_H  = 0x747b88   // iron highlight
const C_HUB = 0x1b1d22
const C_IRON_RIM = 0x33373f
const C_BRASS = 0x9a7b3a // brass piston accents
const C_BRASS_H = 0xcBA45a
const C_SPARK = 0xcfe6ff
const C_SPARK_H = 0xffffff
const C_STEAM = 0x9aa0aa

export class TrapFactoryRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_SHOP)
    this._gs = scene.add.graphics().setDepth(DEPTH_SPARK)
    try { this._gs.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    this._fx = {}
  }

  destroy() {
    try { this._g?.destroy(); this._gs?.destroy() } catch {}
    this._g = this._gs = null
    this._fx = {}
  }

  update(delta) {
    if (!this._g) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._g.clear(); this._gs.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'trap_factory' || room.isActive === false) continue
      live.add(room.instanceId)
      this._draw(room, dt, lod)
    }
    for (const id of Object.keys(this._fx)) if (!live.has(id)) delete this._fx[id]
  }

  _draw(room, dt, lod) {
    const g = this._g, gs = this._gs
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t
    let st = this._fx[room.instanceId]
    if (!st) { st = { sparks: [], steam: [] }; this._fx[room.instanceId] = st }

    const bigR = 15, smallR = 9
    const bigC = [cx - 4, cy + 2]
    const rot = t * 0.7
    // meshing gear sits to the upper-right, turning the opposite way; offset so
    // their pitch circles touch
    const smallC = [bigC[0] + bigR + smallR - 4, bigC[1] - 8]

    // ── piston driven by a crank pin on the big gear ──
    const crankR = bigR * 0.55
    const crank = [bigC[0] + Math.cos(rot) * crankR, bigC[1] + Math.sin(rot) * crankR]
    const cylX = bigC[0] + 2, cylTopY = bigC[1] - bigR - 26
    // cylinder
    g.fillStyle(C_D, 1); g.fillRect(cylX - 6, cylTopY, 12, 22)
    g.fillStyle(C_B, 1); g.fillRect(cylX - 5, cylTopY + 1, 10, 20)
    g.fillStyle(C_H, 0.5); g.fillRect(cylX - 5, cylTopY + 1, 2, 20)
    // piston head slides vertically driven by crank.y
    const pistonY = cylTopY + 14 + (crank[1] - bigC[1]) * 0.5
    g.fillStyle(C_BRASS, 1); g.fillRect(cylX - 5, pistonY, 10, 5)
    g.fillStyle(C_BRASS_H, 0.8); g.fillRect(cylX - 5, pistonY, 10, 1.5)
    // connecting rod crank → piston
    g.lineStyle(2.4, C_D, 1); g.lineBetween(crank[0], crank[1], cylX, pistonY + 2.5)
    g.lineStyle(1.4, C_BRASS, 1); g.lineBetween(crank[0], crank[1], cylX, pistonY + 2.5)

    // ── gears ──
    this._gear(g, bigC[0], bigC[1], bigR, rot, 12, lod)
    this._gear(g, smallC[0], smallC[1], smallR, -rot * (bigR / smallR), 8, lod)
    // crank pin on the big gear (on top of the gear)
    g.fillStyle(C_BRASS, 1); g.fillCircle(crank[0], crank[1], 2.2)   // circle-ok: crank pin
    g.fillStyle(C_BRASS_H, 0.8); g.fillCircle(crank[0] - 0.6, crank[1] - 0.6, 1)  // circle-ok: pin shine

    if (lod) return

    // ── grindstone throwing cold sparks (lower-right) ──
    const grC = [cx + 16, cy + 14], grR = 7
    this._gear(g, grC[0], grC[1], grR, t * 4, 0, false, true)  // smooth stone wheel (no teeth)
    const contact = [grC[0] - grR, grC[1]]
    if ((t % 0.7) / 0.7 < 0.18) {
      for (let i = 0; i < 2; i++) {
        const a = Math.PI - 0.4 + (Math.random() - 0.5) * 0.9
        const sp = 55 + Math.random() * 65
        st.sparks.push({ x: contact[0], y: contact[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 14, life: 0, maxLife: 0.3 + Math.random() * 0.3 })
      }
    }
    for (let i = st.sparks.length - 1; i >= 0; i--) {
      const s = st.sparks[i]
      s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 150 * dt
      if (s.life >= s.maxLife) { st.sparks.splice(i, 1); continue }
      const a = 1 - s.life / s.maxLife
      gs.lineStyle(1, C_SPARK, 0.85 * a); gs.lineBetween(s.x, s.y, s.x - s.vx * 0.012, s.y - s.vy * 0.012)
      gs.fillStyle(C_SPARK_H, a); gs.fillCircle(s.x, s.y, 0.8)   // circle-ok: grindstone spark
    }

    // ── steam venting from the cylinder top ──
    if ((t % 1.6) / 1.6 < 0.05) st.steam.push({ x: cylX + (Math.random() - 0.5) * 6, y: cylTopY, life: 0, maxLife: 1.4 + Math.random() * 0.8 })
    for (let i = st.steam.length - 1; i >= 0; i--) {
      const p = st.steam[i]
      p.life += dt; p.y -= 16 * dt; p.x += Math.sin(p.life * 2) * 5 * dt
      if (p.life >= p.maxLife) { st.steam.splice(i, 1); continue }
      const k = p.life / p.maxLife
      g.fillStyle(C_STEAM, 0.16 * (1 - k)); g.fillCircle(p.x, p.y, 3 + k * 7)   // circle-ok: steam puff
    }
  }

  // a detailed cog: toothed ring + rim + spokes + hub, shaded; or a smooth
  // grindstone wheel when `stone` is set (no teeth, a band rim).
  _gear(g, cx, cy, r, rot, teeth, lod, stone = false) {
    if (stone) {
      g.fillStyle(C_D, 1); g.fillCircle(cx, cy, r + 1)         // circle-ok: grindstone rim shadow
      g.fillStyle(0x5a5048, 1); g.fillCircle(cx, cy, r)        // circle-ok: stone wheel
      g.fillStyle(0x77695c, 0.6); g.fillCircle(cx - r * 0.3, cy - r * 0.3, r * 0.5)  // circle-ok: stone highlight
      g.lineStyle(1, C_D, 0.7)
      for (let i = 0; i < 3; i++) { const a = rot + i / 3 * TAU; g.lineBetween(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r) }  // grind streaks
      g.fillStyle(C_HUB, 1); g.fillCircle(cx, cy, r * 0.22)    // circle-ok: stone bore
      return
    }
    // toothed body (trapezoidal teeth via inner/outer alternating ring)
    const ring = (rr, col) => {
      g.fillStyle(col, 1); const pts = []; const N = teeth * 2
      for (let i = 0; i < N; i++) { const a = rot + (i / N) * TAU; const tt = (i % 2 === 0) ? 1.16 : 0.9; pts.push({ x: cx + Math.cos(a) * rr * tt, y: cy + Math.sin(a) * rr * tt }) }
      this._poly(g, pts)
    }
    ring(r + 1.4, C_D)    // tooth shadow
    ring(r, C_B)          // tooth body
    // rim ring
    g.lineStyle(Math.max(1.4, r * 0.16), C_IRON_RIM, 1); g.strokeCircle(cx, cy, r * 0.72)
    // spokes
    if (!lod) {
      g.lineStyle(Math.max(1.6, r * 0.18), C_B, 1)
      for (let i = 0; i < 4; i++) { const a = rot + i / 4 * (TAU / 2); g.lineBetween(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, cx - Math.cos(a) * r * 0.7, cy - Math.sin(a) * r * 0.7) }
      // top-left highlight arc
      g.lineStyle(1.2, C_H, 0.6); g.beginPath()
      for (let i = 0; i <= 6; i++) { const a = rot - Math.PI * 0.95 + (i / 6) * Math.PI * 0.55; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i === 0 ? g.moveTo(x, y) : g.lineTo(x, y) }
      g.strokePath()
    }
    // hub
    g.fillStyle(C_B, 1); g.fillCircle(cx, cy, r * 0.3)    // circle-ok: gear hub
    g.fillStyle(C_HUB, 1); g.fillCircle(cx, cy, r * 0.16) // circle-ok: hub bore
    g.fillStyle(C_H, 0.5); g.fillCircle(cx - r * 0.06, cy - r * 0.06, r * 0.08)  // circle-ok: bore bevel
  }

  _poly(g, pts) {
    g.beginPath(); g.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y)
    g.closePath(); g.fillPath()
  }
}

// SanctumRenderer — a restorative font of light at the room's heart that
// sheds slow feather/petal-motes which PEEL OFF and stream OUT through the
// connected doorways toward the rooms it regenerates. A rising font + outward
// mote-stream — the opposite of a pulse ring, and distinct from the Pantheon
// holy-ground aura (which sits flat on the floor).
//
// Decor-independent: the font is drawn at room centre; motes flow to real
// connected door ports. The regen mechanic lives in BossSystem / MinionAISystem.

import { Balance }  from '../config/balance.js'
import { connectedDoorPorts } from '../util/roomPorts.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_FONT = 6.1

const COL_FONT  = 0xffe9a0   // warm holy gold
const COL_FONT2 = 0xfff6d8
const COL_MOTE  = 0xfff0c4

export class SanctumRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_FONT)
    try { this._g.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    this._motesByRoom = {}
  }

  destroy() {
    try { this._g?.destroy() } catch {}
    this._g = null
    this._motesByRoom = {}
  }

  update(delta) {
    const g = this._g
    if (!g) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    g.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const grid = this._scene.dungeonGrid
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'sanctum' || room.isActive === false) continue
      live.add(room.instanceId)
      this._drawFont(g, room, grid, dt, lod)
    }
    for (const id of Object.keys(this._motesByRoom)) if (!live.has(id)) delete this._motesByRoom[id]
  }

  _drawFont(g, room, grid, dt, lod) {
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t
    const breathe = 0.9 + 0.12 * Math.sin(t * 1.6)
    const halfH = (room.height / 2 - WT) * TS

    // 1) Ascending light PILLAR — a tall pale column of holy light rising from
    //    the font, gently breathing in height. A vertical ascending silhouette
    //    (NOT a compact glow — this is what sets it apart from the forge).
    const pillarH = halfH * (1.05 + 0.12 * Math.sin(t * 0.9))
    const baseW = 9 * breathe
    for (let s = 0; s < 3; s++) {
      const w = baseW * (1 - s * 0.24)
      const h = pillarH * (1 - s * 0.12)
      g.fillStyle(s < 2 ? COL_FONT : COL_FONT2, 0.05 + s * 0.02)
      g.fillPoints([
        { x: cx - w, y: cy }, { x: cx - w * 0.4, y: cy - h },
        { x: cx + w * 0.4, y: cy - h }, { x: cx + w, y: cy },
      ], true)
    }

    // 2) Godrays — soft long rays fanning from the font, slowly rotating.
    if (!lod) {
      const rays = 8
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU + t * 0.12
        const len = 20 + 10 * Math.sin(t * 1.1 + i * 1.7)
        const wsp = 0.07
        g.fillStyle(COL_FONT, 0.045)
        g.fillPoints([
          { x: cx + Math.cos(a - wsp) * 6, y: cy + Math.sin(a - wsp) * 6 },
          { x: cx + Math.cos(a) * len,     y: cy + Math.sin(a) * len },
          { x: cx + Math.cos(a + wsp) * 6, y: cy + Math.sin(a + wsp) * 6 },
        ], true)
      }
    }

    // 3) Font pool — a soft, DIFFUSE pale radiance (paler + flatter than the
    //    forge's defined hot blob).
    this._blob(g, cx, cy, 15 * breathe, t, COL_FONT, 0.11, 4)
    g.fillStyle(COL_FONT2, 0.6)
    g.fillCircle(cx, cy, 4.5 * breathe)   // circle-ok: bright font source

    if (lod) return

    const ports = grid ? connectedDoorPorts(room, grid, { excludeDefs: ['boss_chamber', 'entry_hall'] }) : []
    this._motes(g, room, cx, cy, ports, dt)
  }

  _blob(g, cx, cy, r, t, color, alpha, seed) {
    const N = 16, pts = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const n = 0.18 * Math.sin(a * 3 + t * 1.1 + seed) + 0.1 * Math.sin(a * 5 - t * 0.8)
      const rr = r * (1 + n)
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr })
    }
    g.fillStyle(color, alpha)
    g.fillPoints(pts, true)
  }

  _motes(g, room, cx, cy, ports, dt) {
    let arr = this._motesByRoom[room.instanceId]
    if (!arr) { arr = []; this._motesByRoom[room.instanceId] = arr }
    while (arr.length < 7) arr.push(this._spawnMote(cx, cy, ports))

    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i]
      m.life += dt
      // drift toward target (a door port, or just upward if none), easing out
      m.x += (m.tx - m.x) * Math.min(1, dt * 0.9) + Math.sin(m.life * 3 + m.seed) * 6 * dt
      m.y += (m.ty - m.y) * Math.min(1, dt * 0.9) - 10 * dt   // gentle lift
      m.rot += dt * m.spin
      const dist = Math.hypot(m.tx - m.x, m.ty - m.y)
      if (dist < 6 || m.life > m.maxLife) { arr[i] = this._spawnMote(cx, cy, ports); continue }
      const a = Math.min(1, m.life / 0.4) * Math.min(1, (m.maxLife - m.life) / 0.6)
      this._petal(g, m.x, m.y, m.size, m.rot, a)
    }
  }

  // a small soft petal/feather — a tapered lens, 2-tone, not a dot
  _petal(g, x, y, s, rot, alpha) {
    const c = Math.cos(rot), sn = Math.sin(rot)
    const pts = []
    const prof = [[0, -1], [0.5, -0.2], [0.32, 0.5], [0, 1], [-0.32, 0.5], [-0.5, -0.2]]
    for (const [px, py] of prof) {
      const lx = px * s, ly = py * s * 1.7
      pts.push({ x: x + lx * c - ly * sn, y: y + lx * sn + ly * c })
    }
    g.fillStyle(COL_MOTE, 0.5 * alpha)
    g.fillPoints(pts, true)
    g.fillStyle(COL_FONT2, 0.7 * alpha)
    g.fillCircle(x, y, s * 0.32)   // circle-ok: petal bright core
  }

  _spawnMote(cx, cy, ports) {
    const port = ports.length ? ports[Math.floor(Math.random() * ports.length)] : null
    // target: a bit past the door into the neighbour, or upward if no ports
    const tx = port ? port.x + port.dx * TS * 1.2 : cx + (Math.random() - 0.5) * 30
    const ty = port ? port.y + port.dy * TS * 1.2 : cy - 30 - Math.random() * 20
    return {
      x: cx + (Math.random() - 0.5) * 8, y: cy + (Math.random() - 0.5) * 8,
      tx, ty, life: 0, maxLife: 1.6 + Math.random() * 1.2,
      size: 2.2 + Math.random() * 1.6, rot: Math.random() * TAU,
      spin: (Math.random() - 0.5) * 3, seed: Math.random() * TAU,
    }
  }
}

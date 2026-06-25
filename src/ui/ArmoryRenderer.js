// ArmoryRenderer — a forge at work: a drawn IRON ANVIL with a glowing billet
// on it, a HAMMER that rises and SLAMS down on a rhythm, throwing real flame-
// licks + a spark burst on each strike, and a molten ember conduit pulsing OUT
// through each connected doorway so the player sees the +ATK coverage.
//
// The hero is the drawn forge action (not a glow blob) — distinct from the
// Sanctum/Treasury. Decor-independent (anvil drawn at room centre, conduits
// trace real door ports). +ATK mechanic in CombatSystem.

import { Balance }  from '../config/balance.js'
import { VfxShapes } from './AbilityVfx.js'
import { connectedDoorPorts } from '../util/roomPorts.js'

const TS  = Balance.TILE_SIZE

const DEPTH_FORGE = 6.0
const DEPTH_SPARK = 6.4

const C_IRON_D = 0x23262d   // anvil shadow
const C_IRON   = 0x40444c   // anvil body
const C_IRON_H = 0x6a7079   // anvil highlight
const C_WOOD   = 0x6a4a28   // hammer haft
const C_HEAT   = 0xff5a1e   // hot billet
const C_HEAT_H = 0xffd06a   // billet core
const C_WHITE  = 0xfff4d8   // strike flash / spark
const C_SPARK  = 0xffc24a
const C_CONDUIT = 0xff6a1e
const STRIKE_MS = 1150       // one hammer cycle

export class ArmoryRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_FORGE)
    this._gSpark = scene.add.graphics().setDepth(DEPTH_SPARK)
    try { this._gSpark.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    this._sparksByRoom = {}
    this._struckCycle = {}
  }

  destroy() {
    try { this._g?.destroy(); this._gSpark?.destroy() } catch {}
    this._g = this._gSpark = null
    this._sparksByRoom = {}
  }

  update(delta) {
    if (!this._g) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._g.clear(); this._gSpark.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const grid = this._scene.dungeonGrid
    const now = this._scene.time?.now ?? 0
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'armory' || room.isActive === false) continue
      live.add(room.instanceId)
      this._drawForge(room, grid, dt, lod, now)
    }
    for (const id of Object.keys(this._sparksByRoom)) if (!live.has(id)) delete this._sparksByRoom[id]
  }

  _drawForge(room, grid, dt, lod, now) {
    const g = this._g, gs = this._gSpark
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t

    // ── conduits first (under everything) ──
    if (grid && !lod) {
      for (const p of connectedDoorPorts(room, grid, { excludeDefs: ['boss_chamber', 'entry_hall'] })) {
        const ex = p.x + p.dx * TS * 0.9, ey = p.y + p.dy * TS * 0.9
        g.lineStyle(2, C_CONDUIT, 0.4); g.lineBetween(cx, cy, ex, ey)
        const tp = (t * 0.5 + (p.x + p.y) * 0.001) % 1
        gs.fillStyle(C_HEAT_H, 0.7 * (1 - tp * 0.5))
        gs.fillCircle(cx + (ex - cx) * tp, cy + (ey - cy) * tp, 2.2)   // circle-ok: conduit pulse bead
      }
    }

    // hammer cycle phase 0..1
    const ph = (now % STRIKE_MS) / STRIKE_MS
    // strike happens at ph≈0.5 (fast down-slam); detect crossing per cycle
    const cycle = Math.floor(now / STRIKE_MS)
    const isStrike = ph >= 0.46 && ph <= 0.54
    if (isStrike && this._struckCycle[room.instanceId] !== cycle) {
      this._struckCycle[room.instanceId] = cycle
      this._onStrike(room, cx, cy)
    }

    // ── anvil ──
    const A = 11
    const P = (x, y) => [cx + x * A, cy + y * A]
    // base
    g.fillStyle(C_IRON_D, 1); this._poly(g, [P(-1.0, 1.5), P(1.0, 1.5), P(0.7, 1.0), P(-0.7, 1.0)])
    // waist
    g.fillStyle(C_IRON, 1); this._poly(g, [P(-0.32, 1.0), P(0.32, 1.0), P(0.42, 0.2), P(-0.42, 0.2)])
    // top body + horn (horn juts left)
    g.fillStyle(C_IRON, 1)
    this._poly(g, [P(-1.7, 0.05), P(-0.7, -0.25), P(0.95, -0.25), P(0.95, 0.2), P(-0.7, 0.2)])
    g.fillStyle(C_IRON_D, 0.8); this._poly(g, [P(-0.7, 0.2), P(0.95, 0.2), P(0.95, 0.34), P(-0.7, 0.34)])  // under-shadow
    g.fillStyle(C_IRON_H, 0.8); this._poly(g, [P(-0.7, -0.25), P(0.95, -0.25), P(0.95, -0.16), P(-0.7, -0.16)])  // top highlight

    // glowing billet on the anvil face (pulses; flares white on strike)
    const heat = 0.6 + 0.25 * Math.sin(t * 6) + (isStrike ? 0.5 : 0)
    g.fillStyle(C_HEAT, Math.min(1, 0.7 + heat * 0.3)); this._poly(g, [P(-0.2, -0.26), P(0.5, -0.26), P(0.5, -0.16), P(-0.2, -0.16)])
    gs.fillStyle(C_HEAT_H, Math.min(1, heat)); gs.fillCircle(...P(0.15, -0.22), A * 0.18)   // circle-ok: hot billet glow
    if (isStrike) { gs.fillStyle(C_WHITE, 0.9); gs.fillCircle(...P(0.15, -0.22), A * 0.26) }  // circle-ok: strike flash

    // flame-licks rising off the billet (real layered flames, height flicker)
    if (!lod) {
      for (let i = -1; i <= 1; i++) {
        const fx = cx + (0.15 + i * 0.28) * A
        const fy = cy - 0.26 * A
        const h = 9 + 5 * Math.abs(Math.sin(t * 7 + i * 1.7)) + (isStrike ? 6 : 0)
        gs.save?.(); gs.translateCanvas?.(fx, fy)
        VfxShapes.flame(gs, h, 3.2, Math.sin(t * 5 + i) * 1.5)
        gs.restore?.()
      }
    }

    // ── hammer (rises, slams) ──
    // angle: raised at ph<0.46 then snaps down through the strike, recoils after
    let ang
    if (ph < 0.46) ang = -1.15 + (ph / 0.46) * 0.15           // hold high, small wind-up
    else if (ph < 0.54) ang = -1.0 + ((ph - 0.46) / 0.08) * 1.0  // SLAM down to ~0
    else ang = 0.0 - ((ph - 0.54) / 0.46) * 1.0                 // recoil back up
    this._drawHammer(g, cx + 0.15 * A, cy - 0.3 * A, ang, A)

    // tick sparks
    this._tickSparks(gs, room, dt)
  }

  _drawHammer(g, pivotX, pivotY, ang, A) {
    // pivot at the haft butt; head swings about it. ang: -1.2 raised .. 0 down.
    const c = Math.cos(ang - Math.PI / 2), s = Math.sin(ang - Math.PI / 2)
    const L = 2.1 * A, headAt = 1.0
    const at = (d, perp) => [pivotX + (c * d - s * perp), pivotY + (s * d + c * perp)]
    // haft
    g.fillStyle(C_WOOD, 1)
    this._poly(g, [at(0, -1.3), at(L * headAt, -1.0), at(L * headAt, 1.0), at(0, 1.3)])
    g.fillStyle(0x4a3318, 0.7); this._poly(g, [at(0, 0.4), at(L * headAt, 0.4), at(L * headAt, 1.0), at(0, 1.3)])  // haft shadow
    // head (iron block across the haft tip)
    const hx = at(L * headAt, 0)
    const hc = Math.cos(ang), hs = Math.sin(ang)
    const hat = (u, v) => [hx[0] + hc * u - hs * v, hx[1] + hs * u + hc * v]
    g.fillStyle(C_IRON_D, 1); this._poly(g, [hat(-3.2, -4.6), hat(3.6, -4.6), hat(3.6, 4.6), hat(-3.2, 4.6)])
    g.fillStyle(C_IRON, 1);   this._poly(g, [hat(-2.4, -4.2), hat(3.0, -4.2), hat(3.0, 4.2), hat(-2.4, 4.2)])
    g.fillStyle(C_IRON_H, 0.8); this._poly(g, [hat(-2.4, -4.2), hat(3.0, -4.2), hat(3.0, -3.0), hat(-2.4, -3.0)])
  }

  _onStrike(room, cx, cy) {
    // spark burst flung up + sideways off the billet on impact
    let arr = this._sparksByRoom[room.instanceId]
    if (!arr) { arr = []; this._sparksByRoom[room.instanceId] = arr }
    const bx = cx + 0.15 * 11, by = cy - 0.26 * 11
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.0
      const sp = 60 + Math.random() * 90
      arr.push({ x: bx, y: by, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, maxLife: 0.35 + Math.random() * 0.4 })
    }
    // No screen shake: this is an AMBIENT room animation that strikes ~once a
    // second, so a per-strike camera shake (×N armouries) makes the whole view
    // jitter constantly. The spark burst + billet flash + flame flare carry the
    // impact in-world. (Camera shake stays reserved for real combat moments.)
  }

  _tickSparks(g, room, dt) {
    const arr = this._sparksByRoom[room.instanceId]
    if (!arr) return
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i]
      s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 150 * dt
      if (s.life >= s.maxLife) { arr.splice(i, 1); continue }
      const a = 1 - s.life / s.maxLife
      g.lineStyle(1, C_SPARK, 0.85 * a); g.lineBetween(s.x, s.y, s.x - s.vx * 0.012, s.y - s.vy * 0.012)
      g.fillStyle(C_WHITE, a); g.fillCircle(s.x, s.y, 0.8)   // circle-ok: forge spark head
    }
  }

  _poly(g, pts) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1])
    g.closePath(); g.fillPath()
  }
}

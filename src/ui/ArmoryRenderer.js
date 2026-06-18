// ArmoryRenderer — a forge-glow at the room's heart whose heat bleeds a
// molten-ember conduit OUT through each connected doorway into the buffed
// rooms, so the player can see exactly which rooms the +ATK aura reaches.
// A heat-source + directional door-conduit — not an aura ring.
//
// Decor-independent: the forge glow is drawn at room centre (no anvil prop),
// the conduits trace real connected door ports. The +ATK mechanic lives in
// CombatSystem.

import { Balance }  from '../config/balance.js'
import { connectedDoorPorts } from '../util/roomPorts.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_FORGE = 6.0

const COL_CORE  = 0xffe4b0   // forge core
const COL_WHITE = 0xfffdf0   // white-hot pinpoint
const COL_HEAT  = 0xff4a14   // hot orange-RED heat body (vs Sanctum's pale gold)
const COL_ASH   = 0x6a1c08   // cooling ember edge
const COL_SPARK = 0xffc24a
const COL_CONDUIT = 0xff6a1e  // molten ember line

export class ArmoryRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_FORGE)
    try { this._g.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    this._sparksByRoom = {}
  }

  destroy() {
    try { this._g?.destroy() } catch {}
    this._g = null
    this._sparksByRoom = {}
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
      if (room.definitionId !== 'armory' || room.isActive === false) continue
      live.add(room.instanceId)
      this._drawForge(g, room, grid, dt, lod)
    }
    for (const id of Object.keys(this._sparksByRoom)) if (!live.has(id)) delete this._sparksByRoom[id]
  }

  _drawForge(g, room, grid, dt, lod) {
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t

    // 1) Conduits FIRST (under the core glow) — a molten ember line from the
    //    forge out through each connected doorway, with a bright pulse that
    //    travels centre→out on a loop.
    if (grid) {
      const ports = connectedDoorPorts(room, grid, { excludeDefs: ['boss_chamber', 'entry_hall'] })
      for (const p of ports) {
        const ex = p.x + p.dx * TS * 0.9, ey = p.y + p.dy * TS * 0.9  // a bit past the door into the room
        g.lineStyle(2, COL_CONDUIT, 0.4)
        g.lineBetween(cx, cy, ex, ey)
        if (!lod) {
          // travelling pulse
          const tp = (t * 0.5 + (p.x + p.y) * 0.001) % 1
          const px = cx + (ex - cx) * tp, py = cy + (ey - cy) * tp
          g.fillStyle(COL_CORE, 0.8 * (1 - tp * 0.5))
          g.fillCircle(px, py, 2.4)   // circle-ok: molten pulse bead travelling the conduit
        }
      }
    }

    // 2) Forge glow — a COMPACT hot ember that PULSES on a bellows rhythm
    //    (a bright flare every ~1.6s, like a bellows breath / hammer strike),
    //    with a white-hot pinpoint core. Hot, active, flickering — the
    //    opposite of the Sanctum's tall, calm, pale ascending light.
    const fp = (t % 1.6) / 1.6
    const flare = fp < 0.18 ? (1 - fp / 0.18) : 0
    const breathe = 0.85 + 0.12 * Math.sin(t * 5) + flare * 0.55
    const R = 12 * breathe
    this._blob(g, cx, cy, R * 1.5, t, COL_ASH, 0.22, 9)
    this._blob(g, cx, cy, R * 1.0, t * 1.6, COL_HEAT, 0.5 + flare * 0.35, 11)
    this._blob(g, cx, cy, R * 0.5, t * 1.9, COL_CORE, 0.8, 13)
    g.fillStyle(COL_WHITE, 0.55 + flare * 0.4)
    g.fillCircle(cx, cy, 2.4 + flare * 2.5)   // circle-ok: white-hot forge pinpoint
    // bellows flare throws an extra burst of sparks
    if (flare > 0.5) this._burstSparks(room, cx, cy, 4)

    if (lod) return
    // 3) Heat shimmer — a couple of faint rising wisps.
    for (let i = 0; i < 3; i++) {
      const ph = i * 2.1
      const yy = cy - ((t * 18 + i * 14) % 30)
      const xx = cx + Math.sin(t * 2 + ph) * 6 + (i - 1) * 5
      g.fillStyle(COL_HEAT, 0.12 * (1 - ((t * 18 + i * 14) % 30) / 30))
      g.fillCircle(xx, yy, 2)   // circle-ok: rising heat wisp
    }
    // 4) Spark spit — occasional embers arcing up off the forge and dying.
    this._sparks(g, room, cx, cy, dt)
  }

  _blob(g, cx, cy, r, t, color, alpha, seed) {
    const N = 16, pts = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const n = 0.16 * Math.sin(a * 3 + t * 1.4 + seed) + 0.1 * Math.sin(a * 5 - t * 1.1)
      const rr = r * (1 + n)
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr })
    }
    g.fillStyle(color, alpha)
    g.fillPoints(pts, true)
  }

  // Push a burst of sparks (called on the bellows flare). De-duped against
  // the per-flare window so one flare doesn't spawn dozens of frames' worth.
  _burstSparks(room, cx, cy, n) {
    let arr = this._sparksByRoom[room.instanceId]
    if (!arr) { arr = []; this._sparksByRoom[room.instanceId] = arr }
    const now = this._t
    if (now - (this._lastBurstAt ?? -1) < 0.25) return   // one burst per flare
    this._lastBurstAt = now
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8
      const sp = 50 + Math.random() * 70
      arr.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, maxLife: 0.4 + Math.random() * 0.5 })
    }
  }

  _sparks(g, room, cx, cy, dt) {
    let arr = this._sparksByRoom[room.instanceId]
    if (!arr) { arr = []; this._sparksByRoom[room.instanceId] = arr }
    if (arr.length < 10 && Math.sin(this._t * 11 + room.gridX) > 0.5) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4
      const sp = 30 + Math.random() * 50
      arr.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, maxLife: 0.4 + Math.random() * 0.5 })
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i]
      s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 80 * dt
      if (s.life >= s.maxLife) { arr.splice(i, 1); continue }
      const a = 1 - s.life / s.maxLife
      g.fillStyle(COL_SPARK, a)
      g.fillCircle(s.x, s.y, 1.2 * a + 0.4)   // circle-ok: forge ember spark
    }
  }
}

// BrambleHallRenderer — the choking brambles that ring every active Bramble
// Hall room. Woody vines hug the interior wall edges, gently swaying, with
// barbed thorns jutting INWARD over the floor and the odd green leaf. Pure
// Graphics, redrawn each frame (few rooms; light per-room stroke count).
//
// The reflect itself (30% melee / 50% tinkered, + the thorn-eruption burst on
// the attacker) lives in CombatSystem — this file is the room's resting look.

import { Balance } from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS

const DEPTH_BRAMBLE = 3.45   // just above the floor decals, below entities

const COL_VINE   = 0x3a2c18   // woody vine shadow
const COL_VINE_2 = 0x5a4524   // vine body
const COL_VINE_HI = 0x7a6238  // lit top edge
const COL_THORN  = 0x6f8a3a   // barb (matches the Ent thorn green)
const COL_THORN_HI = 0x9bbf52
const COL_LEAF   = 0x5f8a32

export class BrambleHallRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_BRAMBLE)
    this._t = 0
  }

  destroy() {
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
      if (room.definitionId !== 'thorn_hall' || room.isActive === false) continue
      this._drawBrambles(g, room, lod)
    }
  }

  _drawBrambles(g, room, lod) {
    const ix0 = (room.gridX + WT) * TS
    const iy0 = (room.gridY + WT) * TS
    const ix1 = (room.gridX + room.width  - WT) * TS
    const iy1 = (room.gridY + room.height - WT) * TS
    const t = this._t
    // Each edge gets a vine running along it; `inward` is the unit normal
    // pointing toward the room centre (barbs + sway go that way).
    //   axis 'h' → horizontal vine (top/bottom); 'v' → vertical (left/right)
    const edges = [
      { x0: ix0, y0: iy0, x1: ix1, y1: iy0, nx: 0,  ny: 1,  axis: 'h', seed: 0.0 }, // top
      { x0: ix0, y0: iy1, x1: ix1, y1: iy1, nx: 0,  ny: -1, axis: 'h', seed: 1.7 }, // bottom
      { x0: ix0, y0: iy0, x1: ix0, y1: iy1, nx: 1,  ny: 0,  axis: 'v', seed: 3.1 }, // left
      { x0: ix1, y0: iy0, x1: ix1, y1: iy1, nx: -1, ny: 0,  axis: 'v', seed: 4.6 }, // right
    ]
    for (const e of edges) this._vine(g, e, t, lod)
  }

  _vine(g, e, t, lod) {
    const SEG = 16
    const len = e.axis === 'h' ? (e.x1 - e.x0) : (e.y1 - e.y0)
    const pts = []
    for (let i = 0; i <= SEG; i++) {
      const f = i / SEG
      // base point along the edge
      const bx = e.x0 + (e.axis === 'h' ? f * len : 0)
      const by = e.y0 + (e.axis === 'v' ? f * len : 0)
      // wavy bow inward + a slow sway; amplitude swells mid-edge
      const swell = Math.sin(f * Math.PI)             // 0 at ends, 1 mid
      const wob = (Math.sin(f * 9 + e.seed) * 2.4 + Math.sin(t * 1.1 + f * 5 + e.seed) * 1.8) * (0.4 + 0.6 * swell)
      const inset = 2 + 3.5 * swell + wob
      pts.push([bx + e.nx * inset, by + e.ny * inset, f, swell])
    }
    // vine body — drop shadow, body, lit edge (3 passes, slight offset)
    const stroke = (col, w, off) => {
      g.lineStyle(w, col, 1)
      g.beginPath()
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i][0] + e.nx * off, y = pts[i][1] + e.ny * off
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      g.strokePath()
    }
    stroke(COL_VINE, 3.4, 0.8)
    stroke(COL_VINE_2, 2.4, 0)
    if (!lod) stroke(COL_VINE_HI, 1, -0.7)

    if (lod) return

    // barbs jutting inward + occasional leaf, every couple of segments
    for (let i = 1; i < pts.length - 1; i += 2) {
      const [x, y, f, swell] = pts[i]
      // perpendicular-ish barb pointing inward, length scales with swell
      const blen = 3 + 5 * swell
      // tangent direction along the vine for a slight forward rake
      const px = pts[i + 1][0] - pts[i - 1][0]
      const py = pts[i + 1][1] - pts[i - 1][1]
      const pl = Math.hypot(px, py) || 1
      const rake = 0.35 * ((i % 4 < 2) ? 1 : -1)
      const dx = e.nx + (px / pl) * rake
      const dy = e.ny + (py / pl) * rake
      const dl = Math.hypot(dx, dy) || 1
      const tx = x + (dx / dl) * blen, ty = y + (dy / dl) * blen
      // barb: a short tapered spine (shadow + body + tip glint)
      g.lineStyle(2, COL_VINE, 0.6);  g.lineBetween(x, y, tx, ty)
      g.lineStyle(1.4, COL_THORN, 1); g.lineBetween(x, y, tx, ty)
      g.fillStyle(COL_THORN_HI, 0.9)
      g.fillCircle(tx, ty, 0.9)   // circle-ok: thorn tip glint
      // sparse leaves on alternating barbs
      if (i % 4 === 1) {
        const lx = x - (dx / dl) * 1.5, ly = y - (dy / dl) * 1.5
        g.fillStyle(COL_LEAF, 0.85)
        g.fillCircle(lx + e.nx * 2, ly + e.ny * 2, 1.6)   // circle-ok: leaf bud
      }
    }
  }
}

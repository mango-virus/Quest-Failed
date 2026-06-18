// WanderingGateRenderer — the spatial tear that hovers in every active
// Wandering Gate room. A ragged VERTICAL rift (not a flat portal ring):
// torn flickering lips, a dark churning vortex of displaced-room imagery
// inside, and reality-sparks spat from the edges. Tells the player "step
// here and you're flung elsewhere." Pure Graphics, redrawn each frame.
//
// On WANDERING_GATE_TELEPORTED the rift flares and yanks: the adventurer
// dissolves into streaks sucked into the tear, which then recoils.
//
// Decor-independent — anchored to room geometry (centre), so it survives the
// decor→skins migration. The teleport mechanic lives in RoomBehaviorSystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_RIFT = 6.5   // above floor/pools, around entity band

// Spatial-tear palette — void-magenta body, cyan-magenta torn lips. Kept
// distinct from the Silence Ward's structured lavender sigil: this is a
// chaotic organic rip, not a drawn seal.
const COL_HALO    = 0x6a1f5a   // outer glow
const COL_VOID    = 0x0c0512   // tear interior (near-black violet)
const COL_CHURN_A = 0x3a1450   // displaced-space smear
const COL_CHURN_B = 0x12304a   // cold counter-smear
const COL_LIP     = 0xe05ad0   // bright torn edge (magenta)
const COL_LIP_2   = 0x66e0ff   // cyan edge accent
const COL_SPARK   = 0xffb0f0

export class WanderingGateRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_RIFT)
    this._t = 0
    this._sparksByRoom = {}
    EventBus.on('WANDERING_GATE_TELEPORTED', this._onTeleport, this)
  }

  destroy() {
    EventBus.off('WANDERING_GATE_TELEPORTED', this._onTeleport, this)
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
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'wandering_gate' || room.isActive === false) continue
      live.add(room.instanceId)
      this._drawRift(g, room, dt, lod)
    }
    for (const id of Object.keys(this._sparksByRoom)) {
      if (!live.has(id)) delete this._sparksByRoom[id]
    }
  }

  _geom(room) {
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const halfH = (room.height / 2 - WT) * TS * 0.92
    return { cx, cy, halfH: Math.max(24, halfH) }
  }

  // Build one torn vertical lip (left or right) as a jagged point list from
  // top apex → down the side → bottom apex. `side` = -1 left, +1 right.
  // Width bulges in the middle (a vertical eye/lens) and jitters with noise.
  _lip(cx, cy, halfH, t, side, baseW, jitter) {
    const N = 22
    const pts = []
    for (let i = 0; i <= N; i++) {
      const f = i / N
      const y = cy - halfH + f * halfH * 2
      const bulge = Math.sin(f * Math.PI)                 // 0 at apexes, 1 mid
      const breathe = 0.85 + 0.15 * Math.sin(t * 2.1)
      const noise = jitter * (Math.sin(f * 17 + t * 6 + side) * 0.5 + Math.sin(f * 7 - t * 4) * 0.5)
      const w = (baseW * bulge * breathe) + noise * bulge
      pts.push([cx + side * w, y])
    }
    return pts
  }

  _drawRift(g, room, dt, lod) {
    const { cx, cy, halfH } = this._geom(room)
    const t = this._t
    const baseW = Math.min(halfH * 0.42, 26)

    // 1) Outer halo — a soft vertical glow bleeding off the tear.
    g.fillStyle(COL_HALO, 0.14)
    g.fillEllipse?.(cx, cy, baseW * 4.2, halfH * 2.2)  // ellipse-ok: soft glow halo, not a hero shape

    // 2) Tear body — close the two torn lips into one polygon and fill dark.
    const left  = this._lip(cx, cy, halfH, t, -1, baseW, lod ? 0 : 5)
    const right = this._lip(cx, cy, halfH, t, +1, baseW, lod ? 0 : 5)
    const poly = left.concat(right.reverse())
    g.fillStyle(COL_VOID, 0.97)
    g.fillPoints(poly.map(p => ({ x: p[0], y: p[1] })), true)

    if (!lod) {
      // 3) Inner churn — curved smears of displaced space scrolling vertically
      //    inside the tear (clipped visually by staying within the lip width).
      this._churn(g, cx, cy, halfH, baseW, t)
    }

    // 4) Torn lips — bright flickering edges down both sides (magenta with a
    //    cyan accent), the rip catching light.
    const flick = 0.7 + 0.3 * Math.sin(t * 9 + room.gridX)
    this._stroke(g, left,  COL_LIP,   1.8 * (lod ? 1 : flick), 0.9)
    this._stroke(g, right, COL_LIP,   1.8 * (lod ? 1 : flick), 0.9)
    if (!lod) {
      this._stroke(g, left,  COL_LIP_2, 0.8, 0.5)
      this._stroke(g, right, COL_LIP_2, 0.8, 0.5)
      // 5) Reality-sparks spat from the lips.
      this._sparks(g, room, cx, cy, halfH, baseW, dt)
    }
  }

  _churn(g, cx, cy, halfH, baseW, t) {
    for (let s = 0; s < 4; s++) {
      const phase = s * 1.9
      const dir = s % 2 ? 1 : -1
      const col = s % 2 ? COL_CHURN_B : COL_CHURN_A
      const yoff = ((t * (24 + s * 8) * dir) % (halfH * 2)) - halfH
      g.lineStyle(2 + s * 0.4, col, 0.5)
      g.beginPath()
      const M = 12
      for (let i = 0; i <= M; i++) {
        const f = i / M
        const y = cy - halfH + f * halfH * 2
        const bulge = Math.sin(f * Math.PI)
        const wob = Math.sin(f * 6 + phase + t * 1.5) * baseW * 0.55 * bulge
        const x = cx + wob + Math.sin(y * 0.05 + yoff * 0.04) * 4
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      g.strokePath()
    }
  }

  _stroke(g, pts, color, width, alpha) {
    g.lineStyle(width, color, alpha)
    g.beginPath()
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) g.moveTo(pts[i][0], pts[i][1]); else g.lineTo(pts[i][0], pts[i][1])
    }
    g.strokePath()
  }

  _sparks(g, room, cx, cy, halfH, baseW, dt) {
    let arr = this._sparksByRoom[room.instanceId]
    if (!arr) { arr = []; this._sparksByRoom[room.instanceId] = arr }
    if (arr.length < 6 && Math.sin(this._t * 13 + room.gridY) > 0.6) {
      const side = Math.random() < 0.5 ? -1 : 1
      const fy = (Math.random() - 0.5) * 1.6
      arr.push({
        x: cx + side * baseW * Math.sin(Math.abs(fy)),
        y: cy + fy * halfH * 0.5,
        vx: side * (20 + Math.random() * 40),
        vy: (Math.random() - 0.5) * 60,
        life: 0, maxLife: 0.3 + Math.random() * 0.4,
      })
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i]
      s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 40 * dt
      if (s.life >= s.maxLife) { arr.splice(i, 1); continue }
      const a = 1 - s.life / s.maxLife
      g.fillStyle(COL_SPARK, a)
      g.fillCircle(s.x, s.y, 1.4 * a + 0.4)   // circle-ok: reality spark speck
    }
  }

  // Teleport beat — yank streaks from the adventurer's last position into the
  // nearest active gate's centre, + a bright lip-flare.
  _onTeleport({ adventurer } = {}) {
    try {
      const s = this._scene
      if (!s || !adventurer) return
      const gates = (this._gameState.dungeon?.rooms ?? []).filter(r =>
        r.definitionId === 'wandering_gate' && r.isActive !== false)
      if (gates.length === 0) return
      // pick the closest gate to where they were yanked from
      let gate = gates[0], best = Infinity
      const ax = adventurer.worldX ?? 0, ay = adventurer.worldY ?? 0
      for (const r of gates) {
        const gx = (r.gridX + r.width / 2) * TS, gy = (r.gridY + r.height / 2) * TS
        const d = (gx - ax) ** 2 + (gy - ay) ** 2
        if (d < best) { best = d; gate = r; gx; }
      }
      const gx = (gate.gridX + gate.width / 2) * TS, gy = (gate.gridY + gate.height / 2) * TS
      // streaks converging from a small scatter around (ax,ay) into the tear
      for (let i = 0; i < 8; i++) {
        const ox = ax + (Math.random() - 0.5) * 26, oy = ay + (Math.random() - 0.5) * 26
        const ln = s.add.graphics().setDepth(DEPTH_RIFT + 0.1)
        ln.lineStyle(1.6, COL_LIP, 0.9)
        ln.lineBetween(ox, oy, ox, oy)
        s.tweens.add({
          targets: { p: 0 }, p: 1, duration: 260 + Math.random() * 160, ease: 'Quad.easeIn',
          onUpdate: (tw, tgt) => {
            try {
              ln.clear(); ln.lineStyle(1.6, i % 2 ? COL_LIP_2 : COL_LIP, 0.9 * (1 - tgt.p))
              const x = ox + (gx - ox) * tgt.p, y = oy + (gy - oy) * tgt.p
              ln.lineBetween(ox + (gx - ox) * tgt.p * 0.6, oy + (gy - oy) * tgt.p * 0.6, x, y)
            } catch {}
          },
          onComplete: () => { try { ln.destroy() } catch {} },
        })
      }
      // bright flare at the tear
      const flare = s.add.graphics().setDepth(DEPTH_RIFT + 0.12).setPosition(gx, gy)
      flare.fillStyle(COL_LIP, 0.5)
      flare.fillEllipse(0, 0, 24, 90)   // ellipse-ok: vertical tear flare
      s.tweens.add({
        targets: flare, scaleX: { from: 1.6, to: 0.2 }, alpha: { from: 0.7, to: 0 },
        duration: 360, ease: 'Quad.easeIn', onComplete: () => { try { flare.destroy() } catch {} },
      })
    } catch (err) {
      console.warn('[WanderingGateRenderer] _onTeleport failed:', err.message)
    }
  }
}

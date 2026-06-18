// HallOfMadnessRenderer — the whole room is afflicted, not a central object:
// a sickly bruised red-violet miasma churns over the floor and half-formed
// whispering FACE-wisps surface in the murk and melt away. Tells the player
// this room turns adventurers on each other.
//
// Decor-independent (fills the room interior). The friendly-fire mechanic
// lives in AISystem; a red madness-pulse fires on HALL_OF_MADNESS_TURN.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_MIASMA = 6.3

// Dark crawling murk that reads as moving SHADOW even over the room's red
// floor (the old red-on-red miasma vanished), plus a sickly-green wrongness
// and clearer pallid faces.
const COL_MURK  = 0x140a1e   // near-black violet shadow
const COL_MURK2 = 0x0c140f   // near-black green-tinge shadow
const COL_VEIN  = 0x8ab84a   // sickly green vein/wrongness
const COL_FACE  = 0xd8cfc4   // pallid bone whisper-face

export class HallOfMadnessRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_MIASMA)
    this._t = 0
    this._facesByRoom = {}
    EventBus.on('HALL_OF_MADNESS_FRENZY_BEGIN', this._onTurn, this)
  }

  destroy() {
    EventBus.off('HALL_OF_MADNESS_FRENZY_BEGIN', this._onTurn, this)
    try { this._g?.destroy() } catch {}
    this._g = null
    this._facesByRoom = {}
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
      if (room.definitionId !== 'hall_of_madness' || room.isActive === false) continue
      live.add(room.instanceId)
      this._drawMiasma(g, room, dt, lod)
    }
    for (const id of Object.keys(this._facesByRoom)) if (!live.has(id)) delete this._facesByRoom[id]
  }

  _rect(room) {
    return {
      ix0: (room.gridX + WT) * TS, iy0: (room.gridY + WT) * TS,
      ix1: (room.gridX + room.width - WT) * TS, iy1: (room.gridY + room.height - WT) * TS,
    }
  }

  _drawMiasma(g, room, dt, lod) {
    const { ix0, iy0, ix1, iy1 } = this._rect(room)
    const cx = (ix0 + ix1) / 2, cy = (iy0 + iy1) / 2
    const rx = (ix1 - ix0) / 2, ry = (iy1 - iy0) / 2
    const t = this._t

    // churning murk — overlapping dark lobed blobs crawling across the room,
    // darkening patches so the floor "breathes wrong" (clear at higher alpha).
    const banks = lod ? 2 : 5
    for (let b = 0; b < banks; b++) {
      const ph = b * 1.7
      const ox = Math.sin(t * 0.45 + ph) * rx * 0.4
      const oy = Math.cos(t * 0.37 + ph * 1.3) * ry * 0.36
      const breathe = 0.26 + 0.07 * Math.sin(t * 1.3 + ph)
      this._blob(g, cx + ox, cy + oy, rx * 0.78, ry * 0.74, t + ph, b % 2 ? COL_MURK2 : COL_MURK, breathe, b)
    }
    if (lod) return
    // sickly-green wrongness wisps weaving through the murk (contrast vs floor)
    for (let v = 0; v < 3; v++) {
      const ph = v * 2.1
      g.lineStyle(2, COL_VEIN, 0.16 + 0.1 * Math.sin(t * 2 + ph))
      g.beginPath()
      const M = 10
      for (let i = 0; i <= M; i++) {
        const f = i / M
        const x = ix0 + f * (ix1 - ix0)
        const y = cy + Math.sin(f * 6 + t * 1.2 + ph) * ry * 0.4 * Math.sin(f * Math.PI)
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      g.strokePath()
    }
    // whisper-faces surfacing
    this._faces(g, room, cx, cy, rx, ry, dt)
  }

  _blob(g, cx, cy, rx, ry, t, color, alpha, seed) {
    const N = 22, pts = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const n = 0.24 * Math.sin(a * 2 + t * 0.7 + seed) + 0.14 * Math.sin(a * 4 - t * 0.5) + 0.08 * Math.sin(a * 5 + t * 0.4)
      pts.push({ x: cx + Math.cos(a) * rx * (1 + n), y: cy + Math.sin(a) * ry * (1 + n) })
    }
    g.fillStyle(color, alpha)
    g.fillPoints(pts, true)
  }

  _faces(g, room, cx, cy, rx, ry, dt) {
    let arr = this._facesByRoom[room.instanceId]
    if (!arr) { arr = []; this._facesByRoom[room.instanceId] = arr }
    if (arr.length < 3 && Math.sin(this._t * 3.1 + room.gridX) > 0.6) {
      arr.push({
        x: cx + (Math.random() - 0.5) * rx * 1.3,
        y: cy + (Math.random() - 0.5) * ry * 1.3,
        life: 0, maxLife: 1.6 + Math.random() * 1.2,
        size: 9 + Math.random() * 6, seed: Math.random() * TAU,
      })
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const f = arr[i]
      f.life += dt
      if (f.life >= f.maxLife) { arr.splice(i, 1); continue }
      const a = Math.sin((f.life / f.maxLife) * Math.PI)   // fade in→out (full strength)
      this._drawFace(g, f.x, f.y + Math.sin(f.life * 1.5 + f.seed) * 3, f.size, a)
    }
  }

  // a pallid face surfacing in the murk — a haze head, hollow eyes, an open
  // wailing mouth. More opaque than before so it actually reads.
  _drawFace(g, x, y, s, alpha) {
    // dark socket-halo behind so the pale face pops off the floor
    g.fillStyle(COL_MURK, 0.5 * alpha)
    g.fillCircle(x, y, s * 1.15)   // circle-ok: face shadow-halo
    // pallid haze head
    g.fillStyle(COL_FACE, 0.42 * alpha)
    g.fillCircle(x, y, s)          // circle-ok: pallid face haze
    // hollow eyes
    g.fillStyle(0x0a0410, 0.85 * alpha)
    g.fillEllipse(x - s * 0.36, y - s * 0.16, s * 0.36, s * 0.5)   // ellipse-ok: hollow eye socket
    g.fillEllipse(x + s * 0.36, y - s * 0.16, s * 0.36, s * 0.5)   // ellipse-ok: hollow eye socket
    // open wailing mouth
    g.fillEllipse(x, y + s * 0.5, s * 0.32, s * 0.62)             // ellipse-ok: open mouth
  }

  // friendly-fire beat — a red madness-pulse + a brief cracked-glass flash
  // over the afflicted adventurer.
  _onTurn({ attacker } = {}) {
    try {
      const s = this._scene
      if (!s || !attacker || !Number.isFinite(attacker.worldX)) return
      const x = attacker.worldX, y = attacker.worldY
      const fx = s.add.graphics().setDepth(DEPTH_MIASMA + 0.3).setPosition(x, y)
      const draw = (p) => {
        fx.clear()
        // red pulse
        fx.fillStyle(COL_VEIN, 0.4 * (1 - p))
        fx.fillCircle(0, 0, 6 + p * 16)   // circle-ok: madness pulse
        // cracked-glass fracture lines radiating
        fx.lineStyle(1.2, COL_FACE, 0.8 * (1 - p))
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + 0.3
          const r0 = 4, r1 = 8 + p * 18
          const mx = Math.cos(a) * (r0 + r1) * 0.55, my = Math.sin(a) * (r0 + r1) * 0.55
          fx.lineBetween(Math.cos(a) * r0, Math.sin(a) * r0, mx, my)
          fx.lineBetween(mx, my, Math.cos(a + 0.18) * r1, Math.sin(a + 0.18) * r1)   // a kink = fracture
        }
      }
      draw(0)
      s.tweens.add({ targets: { p: 0 }, p: 1, duration: 420, ease: 'Quad.easeOut',
        onUpdate: (tw, tg) => { try { draw(tg.p) } catch {} },
        onComplete: () => { try { fx.destroy() } catch {} } })
    } catch (err) {
      console.warn('[HallOfMadnessRenderer] _onTurn failed:', err.message)
    }
  }
}

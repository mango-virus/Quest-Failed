// TarPitRenderer — the bubbling tar pool that fills every active Tar Pit
// room. Pure Graphics (there's no tar tileset): an organic, multi-frequency
// noise blob (not a flat ellipse) layered in 3+ tones with a slow breathing
// wobble, a drifting iridescent oil sheen, and tar bubbles that rise, swell,
// and pop with a ripple. Redrawn each frame into one Graphics layer.
//
// Drawn at floor-decal depth so it reads as standing liquid on the floor —
// above the tile detailing, below props / minions / adventurers (which are
// y-sorted from DEPTH_VERT_BASE 7.0 in DecorRenderer).
//
// The mechanic (50% slow inside; tinkered Sucking Mire root-on-entry) lives
// in AISystem / RoomBehaviorSystem — this file is purely the look.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_TAR = 3.3   // just under DEPTH_FLOOR_DECAL (3.4), above floor tiles (1)

// Oily black-brown body with a cool iridescent sheen — tar, not mud.
const COL_RIM    = 0x05030a   // near-black outer rim (volume / contact shadow)
const COL_BODY   = 0x17110f   // main tar body
const COL_INNER  = 0x241a22   // raised inner pool (offset for volume)
const COL_SHEEN_A = 0x2f4a45  // teal oil sheen
const COL_SHEEN_B = 0x3a2d4a  // violet oil sheen
const COL_BUBBLE = 0x2c2230   // raised blister body — LIGHTER than the body so it reads as a dome, not a hole
const COL_BUBBLE_TOP = 0x3e3346 // lit crown of the dome
const COL_SPEC   = 0x8fa39a   // bubble specular glint (cool, bright)

export class TarPitRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_TAR)
    this._bubblesByRoom = {}   // instanceId → [bubble]
    this._t = 0

    // Sucking Mire (tinkered) root splash — a quick sink-and-spurt where the
    // adventurer gets stuck.
    EventBus.on('TAR_PIT_MIRED', this._onMired, this)
  }

  destroy() {
    EventBus.off('TAR_PIT_MIRED', this._onMired, this)
    try { this._g?.destroy() } catch {}
    this._g = null
    this._bubblesByRoom = {}
  }

  update(delta) {
    const g = this._g
    if (!g) return
    const dt = Math.min(50, delta ?? 16) / 1000   // clamp so a tab-stall can't fling bubbles
    this._t += dt
    g.clear()

    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5   // at wide zoom, skip bubbles/sheen, keep the pool

    const rooms = this._gameState.dungeon?.rooms ?? []
    const live = new Set()
    for (const room of rooms) {
      if (room.definitionId !== 'tar_pit' || room.isActive === false) continue
      live.add(room.instanceId)
      this._drawPool(g, room, dt, lod)
    }
    // Drop bubble state for rooms that are gone (sold / undone).
    for (const id of Object.keys(this._bubblesByRoom)) {
      if (!live.has(id)) delete this._bubblesByRoom[id]
    }
  }

  // ── Pool drawing ────────────────────────────────────────────────────────

  _interior(room) {
    const ix0 = (room.gridX + WT) * TS
    const iy0 = (room.gridY + WT) * TS
    const ix1 = (room.gridX + room.width  - WT) * TS
    const iy1 = (room.gridY + room.height - WT) * TS
    return {
      cx: (ix0 + ix1) / 2,
      cy: (iy0 + iy1) / 2,
      rx: Math.max(8, (ix1 - ix0) / 2),
      ry: Math.max(8, (iy1 - iy0) / 2),
    }
  }

  // Build an organic lobed outline: a ring of points modulated by three
  // sine harmonics (different speeds) so the rim wobbles + breathes rather
  // than reading as a clean ellipse.
  _blob(cx, cy, rx, ry, t, scale, phase) {
    const N = 30
    const pts = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const n = 0.14 * Math.sin(a * 3 + t * 0.7 + phase)
              + 0.08 * Math.sin(a * 5 - t * 1.05 + phase)
              + 0.05 * Math.sin(a * 2 + t * 0.45)
      const r = scale * (1 + n)
      pts.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r })
    }
    return pts
  }

  _drawPool(g, room, dt, lod) {
    const { cx, cy, rx, ry } = this._interior(room)
    const t = this._t

    // 1) Outer rim / contact shadow — a slightly larger, darkest blob so the
    //    tar reads as sunk into the floor.
    g.fillStyle(COL_RIM, 0.92)
    g.fillPoints(this._blob(cx, cy, rx, ry, t, 1.0, 0), true)

    // 2) Main tar body.
    g.fillStyle(COL_BODY, 1)
    g.fillPoints(this._blob(cx, cy, rx, ry, t, 0.9, 1.7), true)

    // 3) Raised inner pool, offset up-left for a sense of volume / wet bulge.
    g.fillStyle(COL_INNER, 0.85)
    g.fillPoints(this._blob(cx - rx * 0.08, cy - ry * 0.10, rx, ry, t * 1.15, 0.6, 3.1), true)

    if (!lod) {
      // 4) Iridescent oil sheen — two thin drifting crescents, alternating
      //    teal/violet, low alpha. Built as a thin blob ring offset across
      //    the surface so it looks like light sliding over the tar.
      // Faint iridescent shimmer — two small low-alpha patches drifting over
      // the surface. Kept subtle so it tints, not smears.
      const driftX = Math.sin(t * 0.5) * rx * 0.18
      const driftY = Math.cos(t * 0.37) * ry * 0.15
      g.fillStyle(COL_SHEEN_A, 0.08)
      g.fillPoints(this._blob(cx + driftX, cy + driftY, rx, ry, t * 0.9, 0.30, 5.0), true)
      g.fillStyle(COL_SHEEN_B, 0.06)
      g.fillPoints(this._blob(cx - driftX * 0.7, cy - driftY * 0.7, rx, ry, t * 0.8, 0.20, 2.2), true)

      // 5) Bubbles.
      this._drawBubbles(g, room, cx, cy, rx, ry, dt)
    }
  }

  // ── Bubbles ───────────────────────────────────────────────────────────

  _drawBubbles(g, room, cx, cy, rx, ry, dt) {
    let arr = this._bubblesByRoom[room.instanceId]
    if (!arr) { arr = []; this._bubblesByRoom[room.instanceId] = arr }

    // Maintain a small population scaled to pool size.
    const target = Math.max(3, Math.round((rx * ry) / 2600))
    while (arr.length < target) arr.push(this._spawnBubble(rx, ry))

    for (let i = arr.length - 1; i >= 0; i--) {
      const b = arr[i]
      b.life += dt
      b.y    -= b.rise * dt          // drift upward
      b.x    += b.sway * Math.sin(b.life * 2 + b.seed) * dt
      const k = b.life / b.maxLife

      if (k >= 1) {
        // Pop: a short expanding ripple ring, then respawn.
        this._popRipple(g, cx + b.x, cy + b.y, b.r)
        arr[i] = this._spawnBubble(rx, ry)
        continue
      }

      // Swell in, ease out near the end.
      const grow = k < 0.8 ? (0.4 + 0.6 * (k / 0.8)) : 1
      const rr   = b.r * grow
      const bx = cx + b.x, by = cy + b.y
      const fade = 0.55 + 0.45 * Math.sin(Math.min(1, k * 1.3) * Math.PI)  // bright mid-life, soft in/out
      // Small raised dome — slightly lighter than the tar so it reads as a
      // blister, not a hole. // circle-ok: a tar bubble is a small dome
      g.fillStyle(COL_BUBBLE, 0.7)
      g.fillCircle(bx, by, rr)
      // Dim lit cap, offset up. // circle-ok: bubble crown
      g.fillStyle(COL_BUBBLE_TOP, 0.4 * fade)
      g.fillCircle(bx - rr * 0.14, by - rr * 0.2, rr * 0.42)
      // Dark wet meniscus rim. // circle-ok: bubble rim
      g.lineStyle(1, COL_RIM, 0.7)
      g.strokeCircle(bx, by, rr)
      // Tiny crisp specular glint. // circle-ok: bubble highlight
      g.fillStyle(COL_SPEC, 0.7 * fade)
      g.fillCircle(bx - rr * 0.3, by - rr * 0.34, Math.max(0.5, rr * 0.16))
    }
  }

  _spawnBubble(rx, ry) {
    // Spread across most of the pool so they don't pile near the centre.
    const a = Math.random() * TAU
    const rad = Math.sqrt(Math.random()) * 0.82
    return {
      x: Math.cos(a) * rx * rad,
      y: Math.sin(a) * ry * rad,
      r: 1.1 + Math.random() * 1.8,
      rise: 2 + Math.random() * 5,
      sway: 1.5 + Math.random() * 2.5,
      life: 0,
      maxLife: 1.1 + Math.random() * 1.8,
      seed: Math.random() * TAU,
    }
  }

  _popRipple(g, x, y, r) {
    // A single faint ring marking the burst. // circle-ok: bubble-pop ripple
    g.lineStyle(1.5, COL_SHEEN_A, 0.28)
    g.strokeCircle(x, y, r * 1.8)
  }

  // ── Sucking Mire root splash (tinkered) ─────────────────────────────────

  _onMired({ adventurer } = {}) {
    try {
      const s = this._scene
      if (!s || !adventurer) return
      const x = adventurer.worldX
      const y = adventurer.worldY
      // A quick black spurt: a few tar droplets flung up + an ink ring that
      // collapses inward (the muck closing over their boots). The ring is
      // drawn at LOCAL origin and positioned at (x,y) so the collapse-scale
      // tween shrinks it about its own centre.
      const ring = s.add.graphics().setDepth(DEPTH_TAR + 0.05).setPosition(x, y)
      ring.lineStyle(2.5, COL_RIM, 0.85)
      ring.strokeCircle(0, 0, 16)   // circle-ok: mire-grab ring telegraph
      s.tweens.add({
        targets: ring, alpha: { from: 0.9, to: 0 },
        scaleX: { from: 1, to: 0.2 }, scaleY: { from: 1, to: 0.2 },
        duration: 420, ease: 'Quad.easeIn',
        onComplete: () => { try { ring.destroy() } catch {} },
      })

      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + Math.random() * 0.4
        const d = s.add.graphics().setDepth(DEPTH_TAR + 0.06)
        d.fillStyle(COL_BUBBLE, 0.95)
        d.fillCircle(0, 0, 2 + Math.random() * 1.5)  // circle-ok: tar droplet
        d.setPosition(x, y)
        const dist = 10 + Math.random() * 12
        s.tweens.add({
          targets: d,
          x: x + Math.cos(a) * dist,
          y: y + Math.sin(a) * dist - 6,   // slight upward arc
          alpha: { from: 1, to: 0 },
          duration: 380 + Math.random() * 160,
          ease: 'Quad.easeOut',
          onComplete: () => { try { d.destroy() } catch {} },
        })
      }
    } catch (err) {
      console.warn('[TarPitRenderer] _onMired failed:', err.message)
    }
  }
}

// SilenceWardRenderer — the anti-magic apparatus that hovers over every
// active Silence Ward room. A runic void sigil: a dark "dead zone" maw with
// two counter-rotating rings of rune ticks, a slowly turning central glyph,
// and motes of stray magic being pulled INWARD and swallowed (a converging
// composition, deliberately not another outward burst/ring).
//
// The fiction is geometric (a ward / sigil), so clean radial geometry is the
// intended look here — but it's layered + animated + counter-rotating so it
// reads as a detailed apparatus, not a flat circle.
//
// The silence mechanic (suppress class abilities in the ward + door-connected
// rooms; tinkered Dead Zone +15% damage) lives in ClassAbilitySystem /
// CombatSystem — this file is purely the look. The per-cast "SILENCED"
// floater is emitted by ClassAbilitySystem (BossArchetypeUI listener).

import { Balance } from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_WARD = 6.6   // above floor + tar (3.x), below entities (ysort base 7.0)

const COL_VOID    = 0x0d0a16   // maw centre
const COL_VOID_2  = 0x1a1430   // maw mid
const COL_RING    = 0x6a5a86   // rune-ring ticks
const COL_RING_2  = 0x9a86c4   // brighter inner ring
const COL_GLYPH   = 0xb9a6e6   // central glyph
const COL_MOTE    = 0xcdbcff   // inward-pulled magic motes

export class SilenceWardRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_WARD)
    this._motesByRoom = {}
    this._t = 0
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

    const rooms = this._gameState.dungeon?.rooms ?? []
    const live = new Set()
    for (const room of rooms) {
      if (room.definitionId !== 'silence_ward' || room.isActive === false) continue
      live.add(room.instanceId)
      this._drawWard(g, room, dt, lod)
    }
    for (const id of Object.keys(this._motesByRoom)) {
      if (!live.has(id)) delete this._motesByRoom[id]
    }
  }

  _center(room) {
    const cx = (room.gridX + room.width  / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const rad = (Math.min(room.width, room.height) / 2 - WT) * TS
    return { cx, cy, R: Math.max(20, rad) }
  }

  _drawWard(g, room, dt, lod) {
    const { cx, cy, R } = this._center(room)
    const t = this._t
    const breathe = 1 + Math.sin(t * 1.2) * 0.04

    // 1) Void maw — concentric darkening discs (rim → near-black centre) so
    //    it reads as a hole the light falls into, not a flat disc.
    g.fillStyle(COL_VOID_2, 0.55)
    g.fillCircle(cx, cy, R * 0.86 * breathe)   // circle-ok: the ward maw is a sigil disc (geometric fiction)
    g.fillStyle(COL_VOID, 0.8)
    g.fillCircle(cx, cy, R * 0.6 * breathe)    // circle-ok: maw inner
    g.fillStyle(0x000000, 0.55)
    g.fillCircle(cx, cy, R * 0.32 * breathe)   // circle-ok: maw pupil

    if (lod) return

    // 2) Outer rune-ring — short radial ticks around the rim, rotating CW.
    this._runeRing(g, cx, cy, R * 0.82 * breathe, 18, t * 0.5, COL_RING, 0.7, 5)
    // 3) Inner rune-ring — finer ticks, counter-rotating CCW, brighter.
    this._runeRing(g, cx, cy, R * 0.56 * breathe, 24, -t * 0.8, COL_RING_2, 0.85, 3.5)
    // 4) Faint connecting spokes between the rings (the apparatus frame).
    g.lineStyle(1, COL_RING, 0.16)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + t * 0.2
      g.lineBetween(
        cx + Math.cos(a) * R * 0.56 * breathe, cy + Math.sin(a) * R * 0.56 * breathe,
        cx + Math.cos(a) * R * 0.82 * breathe, cy + Math.sin(a) * R * 0.82 * breathe,
      )
    }
    // 5) Central glyph — two interlocked triangles (a six-point seal) slowly
    //    counter-rotating, with a soft glow core.
    this._glyph(g, cx, cy, R * 0.26 * breathe, t)

    // 6) Inward-pulled motes — stray magic spiralling into the maw and
    //    winking out (the converging composition).
    this._motes(g, room, cx, cy, R, dt)
  }

  // A ring of short radial tick-marks (runes) — not a solid ring.
  _runeRing(g, cx, cy, r, count, rot, color, alpha, len) {
    g.lineStyle(1.4, color, alpha)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + rot
      // vary tick length slightly so it reads as runes, not a dial
      const l = len * (0.6 + 0.6 * (((i * 7) % 5) / 4))
      g.lineBetween(
        cx + Math.cos(a) * (r - l), cy + Math.sin(a) * (r - l),
        cx + Math.cos(a) * (r + l), cy + Math.sin(a) * (r + l),
      )
    }
  }

  _glyph(g, cx, cy, r, t) {
    // glow core // circle-ok: glyph glow core
    g.fillStyle(COL_GLYPH, 0.18)
    g.fillCircle(cx, cy, r * 0.9)
    const tri = (rot, alpha) => {
      g.lineStyle(1.6, COL_GLYPH, alpha)
      const p = []
      for (let i = 0; i < 3; i++) {
        const a = rot + (i / 3) * TAU
        p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
      }
      g.beginPath()
      g.moveTo(p[0][0], p[0][1])
      g.lineTo(p[1][0], p[1][1]); g.lineTo(p[2][0], p[2][1])
      g.closePath(); g.strokePath()
    }
    tri(t * 0.35, 0.9)
    tri(-t * 0.35 + Math.PI / 3, 0.6)
  }

  _motes(g, room, cx, cy, R, dt) {
    let arr = this._motesByRoom[room.instanceId]
    if (!arr) { arr = []; this._motesByRoom[room.instanceId] = arr }
    while (arr.length < 8) arr.push(this._spawnMote(R))

    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i]
      m.rad  -= m.pull * dt          // pulled toward centre
      m.ang  += m.spin * dt          // spiralling in
      if (m.rad <= R * 0.18) { arr[i] = this._spawnMote(R); continue }
      const x = cx + Math.cos(m.ang) * m.rad
      const y = cy + Math.sin(m.ang) * m.rad
      const k = 1 - (m.rad - R * 0.18) / (R * 0.82)   // 0 at rim → 1 near maw
      // a small trailing streak toward the centre
      g.lineStyle(1, COL_MOTE, 0.18 + 0.3 * k)
      g.lineBetween(x, y, cx + Math.cos(m.ang) * (m.rad - 6), cy + Math.sin(m.ang) * (m.rad - 6))
      g.fillStyle(COL_MOTE, 0.5 + 0.4 * k)
      g.fillCircle(x, y, m.size * (0.6 + 0.4 * (1 - k)))   // circle-ok: magic mote
    }
  }

  _spawnMote(R) {
    return {
      ang:  Math.random() * TAU,
      rad:  R * (0.78 + Math.random() * 0.12),
      pull: R * (0.18 + Math.random() * 0.22),
      spin: (Math.random() < 0.5 ? 1 : -1) * (0.8 + Math.random() * 1.2),
      size: 1.2 + Math.random() * 1.6,
    }
  }
}

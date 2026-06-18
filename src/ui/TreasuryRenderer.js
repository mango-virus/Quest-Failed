// TreasuryRenderer — an ornate GOLDEN IDOL hovers and slowly turns above the
// hoard, a sweeping shine crossing its face; sharp coin-glints twinkle on the
// real treasure-chest entities, gold dust drifts up, and a faint golden lure
// bleeds out the connected doorways (the "draws adventurers" bait). On
// TREASURY_STIPEND a shower of detailed coins spills.
//
// The hero is a DRAWN relic (not a glow blob) — distinct from every other
// room. Decor-independent (idol drawn at room centre; glints ride the real
// chest entities). Stipend mechanic in RoomBehaviorSystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { AbilityVfx } from './AbilityVfx.js'
import { connectedDoorPorts } from '../util/roomPorts.js'

const TS  = Balance.TILE_SIZE
const TAU = Math.PI * 2

const DEPTH_GLOW = 5.9   // ground glow + glints
const DEPTH_IDOL = 6.6   // the idol hovers above

// gold tone ramp
const C_DK   = 0x6a4a08   // deep shadow gold
const C_RIM  = 0x9a6c10   // rim
const C_BODY = 0xd9a520   // body gold
const C_LIT  = 0xffd23f   // lit gold
const C_HI   = 0xfff1a8   // highlight
const C_GEM  = 0x1a0e22   // dark gem inset
const C_GLINT = 0xfffdf0

export class TreasuryRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._gGlow = scene.add.graphics().setDepth(DEPTH_GLOW)
    try { this._gGlow.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._gIdol = scene.add.graphics().setDepth(DEPTH_IDOL)
    this._t = 0
    EventBus.on('TREASURY_STIPEND', this._onStipend, this)
  }

  destroy() {
    EventBus.off('TREASURY_STIPEND', this._onStipend, this)
    try { this._gGlow?.destroy(); this._gIdol?.destroy() } catch {}
    this._gGlow = this._gIdol = null
  }

  update(delta) {
    if (!this._gGlow) return
    this._t += Math.min(50, delta ?? 16) / 1000
    this._gGlow.clear(); this._gIdol.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const grid = this._scene.dungeonGrid
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'treasury' || room.isActive === false) continue
      this._drawGlow(this._gGlow, room, grid, lod)
      this._drawIdol(this._gIdol, room, lod)
    }
  }

  _inRoom(room, tx, ty) {
    return tx >= room.gridX && tx < room.gridX + room.width &&
           ty >= room.gridY && ty < room.gridY + room.height
  }

  _drawGlow(g, room, grid, lod) {
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t
    // soft halo under the idol
    g.fillStyle(C_LIT, 0.10 + 0.03 * Math.sin(t * 1.6))
    g.fillCircle(cx, cy - 4, 22)   // circle-ok: idol radiance halo
    if (lod) return
    // lure-bleed at connected doorways
    if (grid) {
      for (const p of connectedDoorPorts(room, grid, { excludeDefs: ['boss_chamber'] })) {
        const lx = p.x + p.dx * TS * 0.5, ly = p.y + p.dy * TS * 0.5
        g.fillStyle(C_LIT, 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(t * 1.6 + p.x * 0.01)))
        g.fillCircle(lx, ly, 12)   // circle-ok: doorway lure-bleed
      }
    }
    // gold dust motes
    for (let i = 0; i < 5; i++) {
      const prog = (t * 0.25 + i * 0.2) % 1
      const mx = cx + Math.sin(t * 0.7 + i) * 16 + (i - 2) * 5
      const my = cy + 12 - prog * 28
      g.fillStyle(C_HI, 0.35 * (1 - prog))
      g.fillCircle(mx, my, 0.9)   // circle-ok: gold dust mote
    }
    // coin-glints on the real chest entities
    for (const c of (this._gameState.dungeon?.treasureChests ?? [])) {
      if (!this._inRoom(room, c.tileX, c.tileY)) continue
      const gx = (c.tileX + 0.5) * TS, gy = (c.tileY + 0.5) * TS - 4
      const tw = (Math.sin(t * 2.1 + (c.tileX + c.tileY) * 1.3) + 1) / 2
      if (tw < 0.8) continue
      const k = (tw - 0.8) / 0.2, r = 3 * k + 1
      g.fillStyle(C_GLINT, 0.9 * k); g.fillCircle(gx, gy, 1.1)   // circle-ok: coin glint core
      g.lineStyle(1, C_GLINT, 0.9 * k)
      g.lineBetween(gx - r, gy, gx + r, gy); g.lineBetween(gx, gy - r, gx, gy + r)
    }
  }

  // The idol: an ornate golden mask-relic on a small base — headdress fan +
  // gem eyes + brow + nose ridge + mouth bar + collar. It hovers (bob), slowly
  // TURNS (faked by squashing width with cos), and a shine sweeps across.
  _drawIdol(g, room, lod) {
    const t = this._t
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS + Math.sin(t * 1.1) * 2 - 2   // hover bob
    const turn = Math.cos(t * 0.7)            // -1..1 slow turn
    const sx = 0.62 + 0.38 * Math.abs(turn)   // width squash as it turns away
    const S = 13                               // overall idol scale (px)
    const px = (x, y) => [cx + x * S * sx, cy + y * S]   // local→world, width-squashed

    // base/pedestal
    g.fillStyle(C_DK, 1)
    this._poly(g, [px(-0.7, 1.45), px(0.7, 1.45), px(0.55, 1.05), px(-0.55, 1.05)])
    g.fillStyle(C_RIM, 1)
    this._poly(g, [px(-0.6, 1.4), px(0.6, 1.4), px(0.48, 1.1), px(-0.48, 1.1)])

    // headdress fan (rays) behind the head
    if (!lod) {
      for (let i = -3; i <= 3; i++) {
        const a = -Math.PI / 2 + i * 0.34
        const r0 = 0.55, r1 = 1.15
        g.fillStyle(i % 2 ? C_RIM : C_BODY, 1)
        this._poly(g, [
          px(Math.cos(a - 0.07) * r0, Math.sin(a - 0.07) * r0 - 0.15),
          px(Math.cos(a) * r1, Math.sin(a) * r1 - 0.15),
          px(Math.cos(a + 0.07) * r0, Math.sin(a + 0.07) * r0 - 0.15),
        ])
      }
    }

    // face — shadow side, body, lit side (a rounded mask)
    const face = (col, off, ky) => {
      const N = 14, pts = []
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU
        const r = 0.62 * (1 + 0.12 * Math.sin(a * 2))
        pts.push(px(Math.cos(a) * r + off, Math.sin(a) * r * ky - 0.05))
      }
      g.fillStyle(col, 1); this._poly(g, pts)
    }
    face(C_DK, 0.06, 1.18)     // shadow side (offset for the turn)
    face(C_BODY, 0, 1.12)      // body
    // lit crescent (toward the turn)
    g.fillStyle(turn > 0 ? C_LIT : C_RIM, 0.9)
    {
      const N = 10, pts = []
      for (let i = 0; i <= N; i++) { const a = -Math.PI * 0.7 + (i / N) * Math.PI * 0.8; pts.push(px(Math.cos(a) * 0.6 * Math.sign(turn || 1) - 0.04, Math.sin(a) * 0.66 - 0.05)) }
      for (let i = N; i >= 0; i--) { const a = -Math.PI * 0.7 + (i / N) * Math.PI * 0.8; pts.push(px(Math.cos(a) * 0.42 * Math.sign(turn || 1) - 0.04, Math.sin(a) * 0.5 - 0.05)) }
      this._poly(g, pts)
    }

    // brow ridge + nose
    g.fillStyle(C_DK, 0.9)
    this._poly(g, [px(-0.34, -0.18), px(0.34, -0.18), px(0.3, -0.06), px(-0.3, -0.06)])
    g.fillStyle(C_RIM, 1)
    this._poly(g, [px(-0.06, -0.1), px(0.06, -0.1), px(0.1, 0.32), px(-0.1, 0.32)])

    // gem eyes (dark insets + a cold glint)
    for (const ex of [-0.28, 0.28]) {
      g.fillStyle(C_GEM, 1); g.fillCircle(...px(ex, 0.02), 0.16 * S * sx)   // circle-ok: gem eye inset
      if (!lod) { g.fillStyle(0x66e0ff, 0.8); g.fillCircle(...px(ex - 0.05, -0.03), 0.05 * S * sx) }  // circle-ok: gem glint
    }
    // mouth bar (teeth notches)
    g.fillStyle(C_DK, 1)
    this._poly(g, [px(-0.3, 0.5), px(0.3, 0.5), px(0.26, 0.66), px(-0.26, 0.66)])
    if (!lod) { g.lineStyle(Math.max(0.5, 0.04 * S), C_BODY, 0.9); for (let i = -2; i <= 2; i++) { const xx = i * 0.12; g.lineBetween(...px(xx, 0.5), ...px(xx, 0.66)) } }

    // sweeping shine across the face
    if (!lod) {
      const sweep = ((t * 0.5) % 1) * 1.6 - 0.8   // -0.8..0.8 local x
      g.fillStyle(C_HI, 0.5)
      this._poly(g, [px(sweep - 0.06, -0.6), px(sweep + 0.06, -0.6), px(sweep + 0.16, 0.7), px(sweep + 0.04, 0.7)])
    }
  }

  _poly(g, pts) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1])
    g.closePath(); g.fillPath()
  }

  _onStipend({ } = {}) {
    try {
      const s = this._scene
      for (const room of (this._gameState.dungeon?.rooms ?? []).filter(r => r.definitionId === 'treasury' && r.isActive !== false)) {
        const cx = (room.gridX + room.width / 2) * TS
        const cy = (room.gridY + room.height / 2) * TS
        AbilityVfx.coinRain?.(s, cx, cy - 6, { depth: DEPTH_IDOL + 0.2 })
      }
    } catch (err) {
      console.warn('[TreasuryRenderer] _onStipend failed:', err.message)
    }
  }
}

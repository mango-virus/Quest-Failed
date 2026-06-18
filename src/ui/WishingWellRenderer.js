// WishingWellRenderer — a luminous basin of fate-water at the room's heart,
// its surface rippling and shimmering between GOLD (boon) and VIOLET (curse),
// with fate-wisps curling up. On a flip: WISHING_WELL_BOON throws a gold
// up-burst that settles on the adventurer; WISHING_WELL_CURSE pulls a violet
// brand down onto them.
//
// Decor-independent: the basin is DRAWN at room centre (no well prop). A
// bright luminous pool — distinct from the Tar Pit's opaque dark one. The
// coin-flip mechanic lives in RoomBehaviorSystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { VfxShapes } from './AbilityVfx.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_WELL = 6.0

const COL_GOLD   = 0xffd24a
const COL_VIOLET = 0xb060ff
const COL_SHEEN  = 0xffffff

export class WishingWellRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    // submerged coins sit UNDER the luminous water (normal blend); the water
    // shimmer + wisps + runes go on the ADD layer on top.
    this._gCoins = scene.add.graphics().setDepth(DEPTH_WELL - 0.1)
    this._g = scene.add.graphics().setDepth(DEPTH_WELL)
    try { this._g.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    EventBus.on('WISHING_WELL_BOON',  this._onBoon, this)
    EventBus.on('WISHING_WELL_CURSE', this._onCurse, this)
  }

  destroy() {
    EventBus.off('WISHING_WELL_BOON',  this._onBoon, this)
    EventBus.off('WISHING_WELL_CURSE', this._onCurse, this)
    try { this._g?.destroy(); this._gCoins?.destroy() } catch {}
    this._g = this._gCoins = null
  }

  update(delta) {
    if (!this._g) return
    this._t += Math.min(50, delta ?? 16) / 1000
    this._g.clear(); this._gCoins.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'wishing_well' || room.isActive === false) continue
      this._draw(this._g, room, lod)
    }
  }

  _lerpCol(a, b, f) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
    return ((ar + (br - ar) * f) << 16) | ((ag + (bg - ag) * f) << 8) | (ab + (bb - ab) * f)
  }

  _draw(g, room, lod) {
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t
    const R = Math.min(room.width, room.height) / 2 - WT
    const rad = Math.max(16, R * TS * 0.7)

    // the two fates breathe in and out of dominance
    const fate = 0.5 + 0.5 * Math.sin(t * 0.6)   // 0 gold ↔ 1 violet
    const surf = this._lerpCol(COL_GOLD, COL_VIOLET, fate)

    // 0) submerged offering-coins resting at the basin bottom (detailed coins,
    //    dimmed + wobbling slightly as if seen through water).
    if (!lod) {
      const gc = this._gCoins
      const coinN = Math.max(5, Math.round(rad / 7))
      for (let i = 0; i < coinN; i++) {
        const a = (i / coinN) * TAU + i * 1.3
        const rr = rad * (0.18 + (i % 3) * 0.2)
        const ccx = cx + Math.cos(a) * rr + Math.sin(t + i) * 1.2
        const ccy = cy + Math.sin(a) * rr * 0.9 + Math.cos(t * 0.8 + i) * 1.0
        gc.save?.(); gc.translateCanvas?.(ccx, ccy)
        VfxShapes.coin(gc, 2.6 + (i % 2))
        gc.restore?.()
      }
      // a watery dim wash over the coins (cool tint)
      gc.fillStyle(0x123040, 0.35); gc.fillCircle(cx, cy, rad)   // circle-ok: water dimming over coins
    }

    // 1) basin glow — soft luminous pool
    this._blob(g, cx, cy, rad, t, surf, 0.14, 2)
    this._blob(g, cx, cy, rad * 0.7, t * 1.2, surf, 0.18, 5)

    if (lod) { return }

    // fate-runes carved around the rim, glowing in the current fate colour
    const runes = 8
    for (let i = 0; i < runes; i++) {
      const a = (i / runes) * TAU + t * 0.1
      const rx = cx + Math.cos(a) * rad * 1.04, ry = cy + Math.sin(a) * rad * 1.04
      const fl = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * 1.5 + i))
      g.lineStyle(1.2, surf, fl)
      g.lineBetween(rx - 2, ry - 2, rx + 2, ry + 1)
      g.lineBetween(rx + 1, ry - 2.5, rx - 1, ry + 2.5)
    }

    // 2) concentric surface RIPPLES expanding from the centre (water rings,
    //    fading at the rim) — reads as a still pool catching light.
    for (let i = 0; i < 3; i++) {
      const rp = ((t * 0.35 + i / 3) % 1)
      const rr = rad * (0.2 + rp * 0.9)
      g.lineStyle(1.2, COL_SHEEN, 0.22 * (1 - rp))
      g.strokeCircle(cx, cy, rr)   // circle-ok: water-surface ripple ring (the fiction is a pool)
    }
    // 3) a wavering specular highlight crescent drifting on the surface
    g.fillStyle(COL_SHEEN, 0.28)
    const hx = cx + Math.sin(t * 0.9) * rad * 0.35, hy = cy - rad * 0.3 + Math.cos(t * 0.7) * rad * 0.15
    g.fillEllipse(hx, hy, rad * 0.5, rad * 0.16)   // ellipse-ok: surface light glint on water

    // 4) fate-wisps curling up off the surface, tinted by the current fate
    for (let i = 0; i < 4; i++) {
      const ph = i * 1.6
      const prog = (t * 0.4 + i * 0.25) % 1
      const wx = cx + Math.sin(t * 1.1 + ph) * rad * 0.5
      const wy = cy - prog * (rad * 1.1)
      g.fillStyle(surf, 0.4 * (1 - prog))
      g.fillCircle(wx, wy, 1.6 * (1 - prog * 0.5))   // circle-ok: fate-wisp
    }
  }

  _blob(g, cx, cy, r, t, color, alpha, seed) {
    const N = 18, pts = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const n = 0.12 * Math.sin(a * 3 + t * 1.2 + seed) + 0.07 * Math.sin(a * 5 - t * 0.9)
      pts.push({ x: cx + Math.cos(a) * r * (1 + n), y: cy + Math.sin(a) * r * (1 + n) })
    }
    g.fillStyle(color, alpha)
    g.fillPoints(pts, true)
  }

  _onBoon({ adventurer } = {}) { this._burst(adventurer, COL_GOLD, -1) }
  _onCurse({ adventurer } = {}) { this._burst(adventurer, COL_VIOLET, 1) }

  // dir -1 = gold rises onto them (boon); +1 = violet brands down (curse)
  _burst(adv, color, dir) {
    try {
      const s = this._scene
      if (!s || !adv || !Number.isFinite(adv.worldX)) return
      const x = adv.worldX, y = adv.worldY
      const fx = s.add.graphics().setDepth(DEPTH_WELL + 0.3).setPosition(x, y)
      try { fx.setBlendMode(Phaser.BlendModes.ADD) } catch {}
      const draw = (p) => {
        fx.clear()
        fx.fillStyle(color, 0.6 * (1 - p))
        fx.fillCircle(0, 0, 5 + p * 14)   // circle-ok: flip flash
        // motes streaming up (boon) or down (curse)
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * TAU
          const sx = Math.cos(a) * (4 + p * 14)
          const sy = Math.sin(a) * (4 + p * 14) + dir * (-20 * (1 - p))
          fx.fillStyle(color, 0.8 * (1 - p))
          fx.fillCircle(sx, sy + dir * p * 14, 1.4 * (1 - p) + 0.4)   // circle-ok: fate mote
        }
      }
      draw(0)
      s.tweens.add({ targets: { p: 0 }, p: 1, duration: 520, ease: 'Quad.easeOut',
        onUpdate: (tw, tg) => { try { draw(tg.p) } catch {} },
        onComplete: () => { try { fx.destroy() } catch {} } })
    } catch (err) {
      console.warn('[WishingWellRenderer] _burst failed:', err.message)
    }
  }
}

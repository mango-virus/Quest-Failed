// LibraryRenderer — translucent whisper-PAGES drift lazily through the air of
// every active Library of Whispers, and faint glowing runic SCRIPT floats up
// and dissolves (the rumours made visible). On LIBRARY_FORECAST the pages
// swirl up and a spectral scrying-glow blooms at the room's heart.
//
// Decor-independent: everything is airborne in the room volume (no bookshelf
// prop). Aerial composition — unlike any other room. Forecast in RoomBehaviorSystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_PAGE = 6.7   // airborne, above entities

const COL_PAGE  = 0xcabd92   // parchment
const COL_PAGE2 = 0x9a8d62
const COL_SCRIPT = 0x86c6ff  // glowing whisper-script (cool knowledge-blue)

export class LibraryRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_PAGE)
    this._t = 0
    this._byRoom = {}
    EventBus.on('LIBRARY_FORECAST', this._onForecast, this)
  }

  destroy() {
    EventBus.off('LIBRARY_FORECAST', this._onForecast, this)
    try { this._g?.destroy() } catch {}
    this._g = null
    this._byRoom = {}
  }

  update(delta) {
    if (!this._g) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._g.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'library_of_whispers' || room.isActive === false) continue
      live.add(room.instanceId)
      this._draw(this._g, room, dt, lod)
    }
    for (const id of Object.keys(this._byRoom)) if (!live.has(id)) delete this._byRoom[id]
  }

  _rect(room) {
    return {
      x0: (room.gridX + WT) * TS, y0: (room.gridY + WT) * TS,
      x1: (room.gridX + room.width - WT) * TS, y1: (room.gridY + room.height - WT) * TS,
    }
  }

  _draw(g, room, dt, lod) {
    const r = this._rect(room)
    let st = this._byRoom[room.instanceId]
    if (!st) { st = { pages: [], script: [] }; this._byRoom[room.instanceId] = st }

    // maintain a small drift population
    const pageTarget = lod ? 3 : 8
    while (st.pages.length < pageTarget) st.pages.push(this._spawnPage(r))
    const scriptTarget = lod ? 0 : 6
    while (st.script.length < scriptTarget) st.script.push(this._spawnScript(r))

    // pages — slow lazy drift + tumble, semi-transparent parchment
    for (let i = st.pages.length - 1; i >= 0; i--) {
      const p = st.pages[i]
      p.life += dt
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt
      if (p.life > p.maxLife || p.x < r.x0 - 10 || p.x > r.x1 + 10 || p.y < r.y0 - 10) {
        st.pages[i] = this._spawnPage(r); continue
      }
      const a = Math.min(1, p.life / 0.6) * Math.min(1, (p.maxLife - p.life) / 0.8)
      this._page(g, p.x, p.y, p.size, p.rot, a)
    }
    if (lod) return
    // script — glowing rune marks floating up and fading
    for (let i = st.script.length - 1; i >= 0; i--) {
      const c = st.script[i]
      c.life += dt; c.y -= c.rise * dt; c.x += Math.sin(c.life * 2 + c.seed) * 4 * dt
      if (c.life > c.maxLife) { st.script[i] = this._spawnScript(r); continue }
      const a = Math.sin((c.life / c.maxLife) * Math.PI) * 0.8
      this._script(g, c.x, c.y, c.size, a, c.seed)
    }
  }

  _page(g, x, y, s, rot, alpha) {
    // a curling parchment scrap — a quad foreshortened by its tumble, with a
    // top-edge curl, a folded corner, writing lines, and edge shading so it
    // reads as paper, not a flat rect.
    const w = s * (0.42 + 0.58 * Math.abs(Math.cos(rot)))   // foreshorten as it tumbles
    const h = s
    const curl = Math.sin(rot) * w * 0.18                   // top edge leans (the curl)
    const L = x - w / 2, R = x + w / 2, Tp = y - h / 2, B = y + h / 2
    // drop shadow
    g.fillStyle(0x14110a, 0.4 * alpha)
    this._quad(g, L + 1, Tp + 1.4, R + 1, Tp + 1.4, R + 1, B + 1.4, L + 1, B + 1.4)
    // body (top edge offset by curl)
    g.fillStyle(COL_PAGE, 0.92 * alpha)
    this._quad(g, L + curl, Tp, R + curl, Tp, R, B, L, B)
    // curled top lip (lighter)
    g.fillStyle(0xe8dcb0, 0.9 * alpha)
    this._quad(g, L + curl, Tp, R + curl, Tp, R + curl * 0.5, Tp + h * 0.16, L + curl * 0.5, Tp + h * 0.16)
    // bottom shadow band
    g.fillStyle(COL_PAGE2, 0.55 * alpha)
    this._quad(g, L, B - h * 0.18, R, B - h * 0.18, R, B, L, B)
    // folded corner (bottom-right triangle)
    g.fillStyle(COL_PAGE2, 0.85 * alpha)
    g.beginPath(); g.moveTo(R, B - h * 0.32); g.lineTo(R, B); g.lineTo(R - w * 0.3, B); g.closePath(); g.fillPath()
    // writing lines
    g.lineStyle(0.6, 0x7a6e48, 0.6 * alpha)
    g.lineBetween(L + w * 0.18, Tp + h * 0.34, R - w * 0.16, Tp + h * 0.34)
    g.lineBetween(L + w * 0.18, Tp + h * 0.52, R - w * 0.22, Tp + h * 0.52)
    g.lineBetween(L + w * 0.18, Tp + h * 0.70, R - w * 0.4, Tp + h * 0.70)
  }

  _quad(g, x1, y1, x2, y2, x3, y3, x4, y4) {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.lineTo(x4, y4); g.closePath(); g.fillPath()
  }

  _script(g, x, y, s, alpha, seed) {
    // a tiny glowing rune — a couple of crossing strokes, no fixed glyph
    g.lineStyle(1.2, COL_SCRIPT, 0.7 * alpha)
    g.lineBetween(x - s, y, x + s, y - s * 0.4)
    g.lineBetween(x, y - s, x + s * 0.4, y + s)
    g.fillStyle(COL_SCRIPT, 0.5 * alpha)
    g.fillCircle(x, y, 0.8)   // circle-ok: script glow dot
  }

  _spawnPage(r) {
    return {
      x: r.x0 + Math.random() * (r.x1 - r.x0),
      y: r.y0 + Math.random() * (r.y1 - r.y0),
      vx: (Math.random() - 0.5) * 10, vy: -3 - Math.random() * 6,
      rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 1.4,
      size: 6.5 + Math.random() * 5, life: 0, maxLife: 3 + Math.random() * 3,
    }
  }

  _spawnScript(r) {
    return {
      x: r.x0 + Math.random() * (r.x1 - r.x0),
      y: r.y0 + Math.random() * (r.y1 - r.y0),
      rise: 8 + Math.random() * 8, size: 2 + Math.random() * 2,
      life: 0, maxLife: 1.6 + Math.random() * 1.2, seed: Math.random() * TAU,
    }
  }

  _onForecast({ } = {}) {
    try {
      const s = this._scene
      const rooms = (this._gameState.dungeon?.rooms ?? []).filter(r =>
        r.definitionId === 'library_of_whispers' && r.isActive !== false)
      for (const room of rooms) {
        const cx = (room.gridX + room.width / 2) * TS
        const cy = (room.gridY + room.height / 2) * TS
        // scrying glow bloom at the heart
        const glow = s.add.graphics().setDepth(DEPTH_PAGE + 0.1).setPosition(cx, cy)
        try { glow.setBlendMode(Phaser.BlendModes.ADD) } catch {}
        const draw = (p) => {
          glow.clear()
          glow.fillStyle(COL_SCRIPT, 0.4 * Math.sin(p * Math.PI))
          glow.fillCircle(0, 0, 6 + p * 26)   // circle-ok: scrying-glow bloom
        }
        draw(0)
        s.tweens.add({ targets: { p: 0 }, p: 1, duration: 1100, ease: 'Sine.easeInOut',
          onUpdate: (tw, tg) => { try { draw(tg.p) } catch {} },
          onComplete: () => { try { glow.destroy() } catch {} } })
      }
    } catch (err) {
      console.warn('[LibraryRenderer] _onForecast failed:', err.message)
    }
  }
}

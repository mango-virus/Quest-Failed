// TreasuryRenderer — a heaped HOARD MOUND of minted coins glimmers at the
// room's heart and occasionally avalanches a few coins down its slope; sharp
// coin-glints twinkle on the real treasure-chest entities, gold dust drifts
// up, and a faint golden lure bleeds out the connected doorways (the "draws
// adventurers" bait). On TREASURY_STIPEND a shower of coins spills.
//
// The hero is a DRAWN pile of detailed coins (shared `VfxShapes.coin`) — not a
// glow blob, and distinct from every other room. Decor-independent (mound
// drawn at room centre; glints ride the real chest entities). Stipend
// mechanic in RoomBehaviorSystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { AbilityVfx, VfxShapes } from './AbilityVfx.js'
import { connectedDoorPorts } from '../util/roomPorts.js'

const TS  = Balance.TILE_SIZE
const TAU = Math.PI * 2

const DEPTH_GLOW = 5.85   // under-glow (additive)
const DEPTH_COIN = 6.5    // the coin mound + falling coins

const C_LIT  = 0xffd23f   // lit gold
const C_HI   = 0xfff1a8   // highlight
const C_GLINT = 0xfffdf0

export class TreasuryRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._gGlow = scene.add.graphics().setDepth(DEPTH_GLOW)
    try { this._gGlow.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._gCoins = scene.add.graphics().setDepth(DEPTH_COIN)
    this._gShine = scene.add.graphics().setDepth(DEPTH_COIN + 0.05)
    try { this._gShine.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    this._avById = {}     // roomId → [falling coins]
    this._nextAvAt = {}
    EventBus.on('TREASURY_STIPEND', this._onStipend, this)
  }

  destroy() {
    EventBus.off('TREASURY_STIPEND', this._onStipend, this)
    try { this._gGlow?.destroy(); this._gCoins?.destroy(); this._gShine?.destroy() } catch {}
    this._gGlow = this._gCoins = this._gShine = null
    this._avById = {}
  }

  update(delta) {
    if (!this._gGlow) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._gGlow.clear(); this._gCoins.clear(); this._gShine.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const grid = this._scene.dungeonGrid
    const now = this._scene.time?.now ?? 0
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'treasury' || room.isActive === false) continue
      live.add(room.instanceId)
      this._drawGlow(this._gGlow, room, grid, lod)
      this._drawHoard(room, dt, lod, now)
    }
    for (const id of Object.keys(this._avById)) if (!live.has(id)) { delete this._avById[id]; delete this._nextAvAt[id] }
  }

  _inRoom(room, tx, ty) {
    return tx >= room.gridX && tx < room.gridX + room.width &&
           ty >= room.gridY && ty < room.gridY + room.height
  }

  _drawGlow(g, room, grid, lod) {
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t
    // warm halo under the hoard
    g.fillStyle(C_LIT, 0.10 + 0.03 * Math.sin(t * 1.6))
    g.fillCircle(cx, cy + 2, 22)   // circle-ok: hoard radiance halo
    if (lod) return
    // lure-bleed at connected doorways
    if (grid) {
      for (const p of connectedDoorPorts(room, grid, { excludeDefs: ['boss_chamber'] })) {
        const lx = p.x + p.dx * TS * 0.5, ly = p.y + p.dy * TS * 0.5
        g.fillStyle(C_LIT, 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(t * 1.6 + p.x * 0.01)))
        g.fillCircle(lx, ly, 12)   // circle-ok: doorway lure-bleed
      }
    }
    // gold dust motes drifting up
    for (let i = 0; i < 5; i++) {
      const prog = (t * 0.25 + i * 0.2) % 1
      const mx = cx + Math.sin(t * 0.7 + i) * 16 + (i - 2) * 5
      const my = cy + 8 - prog * 26
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

  // Top-down (oblique) coin hoard: coins lying FLAT on the floor, scattered
  // across an OVAL footprint (wider than tall to match the floor angle) and
  // overlapping denser toward the centre for a LOW heap — not a vertical peak.
  // Coins near the centre lift a few px to suggest a shallow pile; a couple
  // catch a travelling glint; coins occasionally SPILL outward across the floor.
  _drawHoard(room, dt, lod, now) {
    const g = this._gCoins, gs = this._gShine
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS + 4
    const t = this._t
    const RX = 34, RY = 18   // oval floor footprint

    // build coin positions (stable per index — no Math.random in persistent draw)
    const N = lod ? 14 : 30
    const coins = []
    for (let i = 0; i < N; i++) {
      const a = i * 2.399963          // golden-angle spread
      const rad = Math.sqrt((i + 0.5) / N)   // 0 (centre) .. 1 (rim), denser centre
      const x = cx + Math.cos(a) * RX * rad
      const y = cy + Math.sin(a) * RY * rad
      const lift = (1 - rad) * 7 + ((i % 3) === 0 ? 3 : 0)   // shallow centre pile + a few stacked
      const r = 3.4 + (1 - rad) * 1.4 + ((i % 5) === 0 ? 0.8 : 0)
      coins.push({ x, y: y - lift, baseY: y, r, i })
    }
    // back-to-front by floor position so front coins overlap on top
    coins.sort((p, q) => p.baseY - q.baseY)
    for (const c of coins) {
      g.save?.(); g.translateCanvas?.(c.x, c.y)
      // a few coins lie on-edge (thin) for variety
      if (c.i % 7 === 3) g.scaleCanvas?.(1, 0.4)
      VfxShapes.coin(g, c.r)
      g.restore?.()
      if (!lod) {
        const flash = Math.sin(t * 1.4 + c.i * 0.9)
        if (flash > 0.93) { gs.fillStyle(C_GLINT, (flash - 0.93) / 0.07); gs.fillCircle(c.x - c.r * 0.3, c.y - c.r * 0.3, c.r * 0.5) }   // circle-ok: coin glint
      }
    }

    if (lod) return
    // occasional spill — a couple of coins slide OUTWARD across the floor and settle
    let arr = this._avById[room.instanceId]
    if (!arr) { arr = []; this._avById[room.instanceId] = arr }
    const next = this._nextAvAt[room.instanceId]
    if (next == null) this._nextAvAt[room.instanceId] = now + 1500 + Math.random() * 2500
    else if (now >= next) {
      this._nextAvAt[room.instanceId] = now + 2500 + Math.random() * 3500
      const m = 2 + Math.floor(Math.random() * 3)
      for (let i = 0; i < m; i++) {
        const a = Math.random() * TAU
        arr.push({ x: cx, y: cy - 3, vx: Math.cos(a) * (30 + Math.random() * 30), vy: Math.sin(a) * (16 + Math.random() * 16), r: 3 + Math.random(), life: 0, maxLife: 0.7 + Math.random() * 0.5, rot: 0, spin: (Math.random() - 0.5) * 10 })
      }
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const c = arr[i]
      c.life += dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 0.9; c.vy *= 0.9; c.rot += c.spin * dt; c.spin *= 0.95
      if (c.life >= c.maxLife) { arr.splice(i, 1); continue }
      g.save?.(); g.translateCanvas?.(c.x, c.y); g.rotateCanvas?.(c.rot)
      VfxShapes.coin(g, c.r)
      g.restore?.()
    }
  }

  _onStipend({ } = {}) {
    try {
      const s = this._scene
      for (const room of (this._gameState.dungeon?.rooms ?? []).filter(r => r.definitionId === 'treasury' && r.isActive !== false)) {
        const cx = (room.gridX + room.width / 2) * TS
        const cy = (room.gridY + room.height / 2) * TS
        AbilityVfx.coinRain?.(s, cx, cy - 6, { depth: DEPTH_COIN + 0.2 })
      }
    } catch (err) {
      console.warn('[TreasuryRenderer] _onStipend failed:', err.message)
    }
  }
}

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

  // Deterministic mound: rows of overlapping coins, widest + lowest at the
  // base, tapering to a peak. Drawn back(top)→front(base) so lower coins
  // overlap on top. A couple of coins flash a bright glint each pass, and
  // every few seconds a small avalanche rolls down the front slope.
  _drawHoard(room, dt, lod, now) {
    const g = this._gCoins, gs = this._gShine
    const cx = (room.gridX + room.width / 2) * TS
    const baseY = (room.gridY + room.height / 2) * TS + 6   // pile sits a touch low
    const t = this._t

    // mound footprint glow (soft seated shadow)
    g.fillStyle(0x0a0905, 0.4); g.fillEllipse(cx, baseY + 2, 56, 16)   // ellipse-ok: hoard contact shadow

    // rows top→bottom: [coinCount, yLift(up), xHalfSpread, coinR]
    const rows = lod
      ? [[3, 16, 10, 4], [5, 6, 18, 4], [7, 0, 26, 4]]
      : [[1, 26, 0, 3.4], [2, 21, 6, 3.6], [3, 16, 12, 3.8], [4, 10, 18, 4], [6, 4, 24, 4.2], [8, 0, 30, 4.4]]
    let coinIdx = 0
    for (const [n, lift, spread, r] of rows) {
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0.5 : i / (n - 1)
        // stable jitter per coin (no Math.random in the persistent draw)
        const j = Math.sin((coinIdx + 1) * 12.9898) * 43758.5
        const jx = ((j % 1) - 0.5) * spread * 0.18
        const jy = ((Math.sin((coinIdx + 1) * 4.1) % 1) - 0.5) * 3
        const x = cx + (f - 0.5) * 2 * spread + jx
        const y = baseY - lift + jy
        g.save?.(); g.translateCanvas?.(x, y); VfxShapes.coin(g, r); g.restore?.()
        // a few coins catch a travelling glint
        if (!lod) {
          const flash = Math.sin(t * 1.4 + coinIdx * 0.9)
          if (flash > 0.93) {
            gs.fillStyle(C_GLINT, (flash - 0.93) / 0.07)
            gs.fillCircle(x - r * 0.3, y - r * 0.3, r * 0.5)   // circle-ok: coin glint
          }
        }
        coinIdx++
      }
    }

    if (lod) return
    // periodic avalanche down the front slope
    let arr = this._avById[room.instanceId]
    if (!arr) { arr = []; this._avById[room.instanceId] = arr }
    const next = this._nextAvAt[room.instanceId]
    if (next == null) this._nextAvAt[room.instanceId] = now + 1500 + Math.random() * 2500
    else if (now >= next) {
      this._nextAvAt[room.instanceId] = now + 2500 + Math.random() * 3500
      const m = 2 + Math.floor(Math.random() * 3)
      for (let i = 0; i < m; i++) {
        arr.push({ x: cx + (Math.random() - 0.5) * 16, y: baseY - 22, vx: (Math.random() - 0.5) * 18, vy: 4, r: 3 + Math.random() * 1.5, life: 0, maxLife: 0.9 + Math.random() * 0.5, spin: (Math.random() - 0.5) * 8, rot: 0 })
      }
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const c = arr[i]
      c.life += dt; c.vy += 120 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.spin * dt
      // settle when reaching the base
      if (c.y >= baseY + (Math.random() - 0.5) * 2 || c.life >= c.maxLife) { arr.splice(i, 1); continue }
      g.save?.(); g.translateCanvas?.(c.x, c.y); g.rotateCanvas?.(c.rot)
      // rolling coin reads as a thin ellipse when on-edge — approximate with a squashed coin
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

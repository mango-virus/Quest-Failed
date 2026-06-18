// ThroneRoomRenderer — a dark CORONATION aura crowns the Throne Room mini-boss:
// a ring of dark-violet flame floats above its head, majesty-embers drift up
// around it, and a faint regal nimbus pulses at its back. On
// THRONE_MINIBOSS_SPAWNED a crown-flare erupts (the coronation). Anchored to
// the mini-boss ENTITY (not a throne prop), so it survives the decor→skins
// migration and rides the boss as it moves.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const TAU = Math.PI * 2

const DEPTH_AURA  = 6.9   // above the (large) mini-boss sprite
const DEPTH_NIMBUS = 5.7  // behind it

// dark-royal violet flame ramp + gold ember accent
const V0 = 0x2a0b4a, V1 = 0x6a22c0, V2 = 0xb060ff, V3 = 0xe6c2ff
const GOLD = 0xffd76a

export class ThroneRoomRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._gN = scene.add.graphics().setDepth(DEPTH_NIMBUS)
    try { this._gN.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._g = scene.add.graphics().setDepth(DEPTH_AURA)
    try { this._g.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    this._embers = {}
    EventBus.on('THRONE_MINIBOSS_SPAWNED', this._onSpawn, this)
  }

  destroy() {
    EventBus.off('THRONE_MINIBOSS_SPAWNED', this._onSpawn, this)
    try { this._g?.destroy(); this._gN?.destroy() } catch {}
    this._g = this._gN = null
    this._embers = {}
  }

  update(delta) {
    if (!this._g) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._g.clear(); this._gN.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const live = new Set()
    for (const m of (this._gameState.minions ?? [])) {
      if (!m.isThroneMiniBoss || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (!Number.isFinite(m.worldX)) continue
      live.add(m.instanceId)
      this._drawAura(m, dt, lod)
    }
    for (const id of Object.keys(this._embers)) if (!live.has(id)) delete this._embers[id]
  }

  _drawAura(m, dt, lod) {
    const g = this._g, gN = this._gN
    const t = this._t
    const sc = (m._mbDisplayScale ?? 1.6)
    const cx = m.worldX
    const headY = m.worldY - 30 * sc      // top-of-head-ish (feet are worldY)
    const bodyY = m.worldY - 16 * sc

    // regal nimbus behind the body (slowly breathing dark-violet disc)
    gN.fillStyle(V1, 0.16 + 0.05 * Math.sin(t * 1.5))
    gN.fillCircle(cx, bodyY, 20 * sc)   // circle-ok: regal nimbus glow

    if (lod) return

    // CROWN — a ring of dark-violet flame-licks above the head, gold-tipped.
    const pts = 7
    for (let i = 0; i < pts; i++) {
      const f = (i / (pts - 1)) - 0.5            // -0.5..0.5 across the brow
      const px = cx + f * 22 * sc
      const arc = -Math.cos(f * Math.PI) * 6 * sc  // brow curvature (centre tallest)
      const py = headY + arc
      const h = (7 + 4 * Math.abs(Math.sin(t * 8 + i * 1.7))) * (1 - Math.abs(f) * 0.5)
      this._violetFlame(g, px, py, h, t + i)
    }

    // majesty-embers drifting up around the boss
    let arr = this._embers[m.instanceId]
    if (!arr) { arr = []; this._embers[m.instanceId] = arr }
    if (arr.length < 8 && Math.sin(t * 9 + cx) > 0.4) {
      arr.push({ a: Math.random() * TAU, rad: 14 * sc + Math.random() * 8, rise: 0, life: 0, maxLife: 1.1 + Math.random() * 0.8, gold: Math.random() < 0.4, sz: 1.1 + Math.random() })
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i]
      e.life += dt; e.rise += dt * 26; e.a += dt * 0.6
      if (e.life >= e.maxLife) { arr.splice(i, 1); continue }
      const k = 1 - e.life / e.maxLife
      const ex = cx + Math.cos(e.a) * e.rad, ey = bodyY - e.rise
      g.fillStyle(e.gold ? GOLD : V2, 0.7 * k)
      g.fillCircle(ex, ey, e.sz * k + 0.4)   // circle-ok: majesty ember
    }
  }

  // a small dark-violet flame teardrop (base x,y, tip up), layered + gold tip
  _violetFlame(g, x, y, h, t) {
    const tones = [[V0, 1.0], [V1, 0.72], [V2, 0.46]]
    const w = h * 0.42
    const tipDX = Math.sin(t * 5) * 1.2
    for (const [col, k] of tones) {
      const ww = w * k, hh = h * (0.78 + 0.22 * k), tx = tipDX * k
      g.fillStyle(col, 1); g.beginPath()
      g.moveTo(x - ww, y)
      g.lineTo(x - ww * 0.6, y - hh * 0.5)
      g.lineTo(x + tx, y - hh)
      g.lineTo(x + ww * 0.6, y - hh * 0.5)
      g.lineTo(x + ww, y)
      g.closePath(); g.fillPath()
    }
    g.fillStyle(GOLD, 0.7); g.fillCircle(x + tipDX, y - h, Math.max(0.6, w * 0.22))   // circle-ok: crown ember tip
  }

  _onSpawn({ minion } = {}) {
    try {
      const s = this._scene
      if (!s || !minion || !Number.isFinite(minion.worldX)) return
      const sc = (minion._mbDisplayScale ?? 1.6)
      const cx = minion.worldX, cy = minion.worldY - 26 * sc
      const fx = s.add.graphics().setDepth(DEPTH_AURA + 0.2).setPosition(cx, cy)
      try { fx.setBlendMode(Phaser.BlendModes.ADD) } catch {}
      const draw = (p) => {
        fx.clear()
        // expanding dark-violet coronation ring
        fx.lineStyle(3 * (1 - p), V2, 0.85 * (1 - p)); fx.strokeCircle(0, 0, 8 + p * 40)   // circle-ok: coronation flare ring
        fx.fillStyle(V3, 0.5 * (1 - p)); fx.fillCircle(0, 0, 5 * (1 - p) + 2)   // circle-ok: flare core
        // rays of dark majesty
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + p * 0.5
          const r0 = 6, r1 = 14 + p * 30
          fx.lineStyle(1.5, i % 2 ? GOLD : V2, 0.8 * (1 - p))
          fx.lineBetween(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1)
        }
      }
      draw(0)
      s.tweens.add({ targets: { p: 0 }, p: 1, duration: 620, ease: 'Quad.easeOut',
        onUpdate: (tw, tg) => { try { draw(tg.p) } catch {} },
        onComplete: () => { try { fx.destroy() } catch {} } })
    } catch (err) {
      console.warn('[ThroneRoomRenderer] _onSpawn failed:', err.message)
    }
  }
}

// HallOfTrialsRenderer — a BLOOD PROVING-GROUND: old dried bloodstains crust
// the floor around a charred combat-BRAND seared into the centre, its ember
// cracks pulsing, while battle-embers drift up from the gore of past trials.
// On HALL_OF_TRIALS_SPAWNED a violent red burst marks the new fighter being
// forged.
//
// The dried stains are drawn ONCE into a per-room static layer (the detailed
// blood-pool drawer re-randomises each call, so it can't be redrawn per
// frame); the brand glow + embers animate on the shared layer. Decor-
// independent. Spawn mechanic in RoomBehaviorSystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { VfxShapes } from './AbilityVfx.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_STAIN = 3.45   // on the floor
const DEPTH_GLOW  = 3.55   // brand ember glow (just above stains)
const DEPTH_EMBER = 6.0    // rising embers above

const C_BRAND  = 0x140607   // charred brand
const C_CHAR   = 0x2a0d0a
const C_EMBER  = 0xff4a1e   // glowing ember crack
const C_EMBER2 = 0xffae4a
const C_BLOOD  = 0x4a0c0a   // dried blood (matte, dark rust)

export class HallOfTrialsRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_GLOW)          // brand glow (additive)
    try { this._g.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._gE = scene.add.graphics().setDepth(DEPTH_EMBER)        // rising embers (additive)
    try { this._gE.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    this._staticByRoom = {}   // roomId → graphics (dried stains + brand char, drawn once)
    this._emberByRoom = {}
    EventBus.on('HALL_OF_TRIALS_SPAWNED', this._onSpawn, this)
  }

  destroy() {
    EventBus.off('HALL_OF_TRIALS_SPAWNED', this._onSpawn, this)
    for (const id of Object.keys(this._staticByRoom)) { try { this._staticByRoom[id].destroy() } catch {} }
    try { this._g?.destroy(); this._gE?.destroy() } catch {}
    this._g = this._gE = null
    this._staticByRoom = {}; this._emberByRoom = {}
  }

  update(delta) {
    if (!this._g) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._g.clear(); this._gE.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'hall_of_trials' || room.isActive === false) continue
      live.add(room.instanceId)
      if (!this._staticByRoom[room.instanceId]) this._buildStatic(room)
      this._drawAnim(room, dt, lod)
    }
    for (const id of Object.keys(this._staticByRoom)) {
      if (!live.has(id)) { try { this._staticByRoom[id].destroy() } catch {}; delete this._staticByRoom[id]; delete this._emberByRoom[id] }
    }
  }

  _rect(room) {
    return {
      ix0: (room.gridX + WT) * TS, iy0: (room.gridY + WT) * TS,
      ix1: (room.gridX + room.width - WT) * TS, iy1: (room.gridY + room.height - WT) * TS,
    }
  }

  // dried bloodstains (matte, drawn once) + the charred brand char — into a
  // persistent per-room graphics so they don't re-randomise each frame.
  _buildStatic(room) {
    const s = this._scene
    const sg = s.add.graphics().setDepth(DEPTH_STAIN)
    const { ix0, iy0, ix1, iy1 } = this._rect(room)
    const cx = (ix0 + ix1) / 2, cy = (iy0 + iy1) / 2

    // 4-6 dried bloodstains scattered on the floor — irregular matte lobes in
    // two rust tones (NOT the wet pool — these are old, crusted).
    const n = 4 + Math.floor(Math.random() * 3)
    for (let k = 0; k < n; k++) {
      const x = ix0 + Math.random() * (ix1 - ix0)
      const y = iy0 + Math.random() * (iy1 - iy0)
      const r = 5 + Math.random() * 7
      this._driedStain(sg, x, y, r)
    }
    // the charred BRAND seared into the centre — a scorched irregular ring +
    // two crossed-blade scars, all dark char (the ember cracks glow on the
    // animated layer above).
    sg.fillStyle(C_CHAR, 0.9)
    const RB = 16
    const lobes = []
    const N = 18
    for (let i = 0; i < N; i++) { const a = (i / N) * TAU; const rr = RB * (1 + 0.16 * Math.sin(a * 3 + k0(i))); lobes.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.6 }) }
    sg.fillPoints(lobes, true)
    sg.fillStyle(C_BRAND, 1)
    const inner = lobes.map(p => ({ x: cx + (p.x - cx) * 0.72, y: cy + (p.y - cy) * 0.72 }))
    sg.fillPoints(inner, true)
    // crossed-blade scars
    sg.lineStyle(2.4, C_BRAND, 1)
    sg.lineBetween(cx - RB * 0.7, cy - RB * 0.42, cx + RB * 0.7, cy + RB * 0.42)
    sg.lineBetween(cx - RB * 0.7, cy + RB * 0.42, cx + RB * 0.7, cy - RB * 0.42)

    this._staticByRoom[room.instanceId] = sg
    sg._brandCenter = { cx, cy, RB }
  }

  _driedStain(g, x, y, r) {
    // matte dried blood — a cluster of dark rust lobes, no wet sheen
    g.fillStyle(0x2c0705, 0.85)
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + Math.random() * 0.5; const off = r * (0.3 + Math.random() * 0.3); g.fillCircle(x + Math.cos(a) * off, y + Math.sin(a) * off * 0.6, r * (0.4 + Math.random() * 0.3)) }
    g.fillStyle(C_BLOOD, 0.9); g.fillCircle(x, y, r * 0.8)
    // a few flung droplets
    for (let i = 0; i < 4; i++) { const a = Math.random() * TAU, d = r * (1.1 + Math.random() * 0.6); g.fillStyle(0x2c0705, 0.8); g.fillCircle(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, 0.8 + Math.random()) }
  }

  _drawAnim(room, dt, lod) {
    const g = this._g, gE = this._gE
    const t = this._t
    const sg = this._staticByRoom[room.instanceId]
    const bc = sg?._brandCenter
    if (!bc) return
    const { cx, cy, RB } = bc

    // ember cracks glowing in the brand char — irregular glowing lines that
    // pulse like dying coals
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3
      const fl = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 3 + i * 1.3))
      g.lineStyle(1.4, i % 2 ? C_EMBER : C_EMBER2, 0.55 * fl)
      const r0 = RB * 0.35, r1 = RB * 0.9
      g.lineBetween(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.6, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.6)
    }
    // a low red ember-bloom over the brand
    g.fillStyle(C_EMBER, 0.07 + 0.05 * pulse)
    g.fillCircle(cx, cy, RB * 0.9)   // circle-ok: brand ember bloom

    if (lod) return

    // battle-embers drifting up from the brand + the gore
    let arr = this._emberByRoom[room.instanceId]
    if (!arr) { arr = []; this._emberByRoom[room.instanceId] = arr }
    if (arr.length < 7 && Math.sin(t * 7 + room.gridX) > 0.4) {
      arr.push({ x: cx + (Math.random() - 0.5) * RB * 1.6, y: cy + (Math.random() - 0.5) * RB * 0.8, vy: -14 - Math.random() * 16, vx: (Math.random() - 0.5) * 8, life: 0, maxLife: 1.0 + Math.random() * 0.8, gold: Math.random() < 0.4 })
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i]
      e.life += dt; e.x += e.vx * dt; e.y += e.vy * dt; e.vy += 4 * dt
      if (e.life >= e.maxLife) { arr.splice(i, 1); continue }
      const a = 1 - e.life / e.maxLife
      gE.fillStyle(e.gold ? C_EMBER2 : C_EMBER, a)
      gE.fillCircle(e.x, e.y, 1.1 * a + 0.4)   // circle-ok: battle ember
    }
  }

  _onSpawn({ roomId, minion } = {}) {
    try {
      const s = this._scene
      const room = (this._gameState.dungeon?.rooms ?? []).find(r => r.instanceId === roomId)
      const x = minion?.worldX ?? (room ? (room.gridX + room.width / 2) * TS : null)
      const y = minion?.worldY ?? (room ? (room.gridY + room.height / 2) * TS : null)
      if (x == null) return
      // violent red burst — an expanding gore-ring + a spray of blood droplets
      // + ember flash where the fighter is forged
      const fx = s.add.graphics().setDepth(DEPTH_EMBER + 0.2).setPosition(x, y)
      try { fx.setBlendMode(Phaser.BlendModes.ADD) } catch {}
      const draw = (p) => {
        fx.clear()
        fx.lineStyle(3 * (1 - p), C_EMBER, 0.85 * (1 - p)); fx.strokeCircle(0, 0, 6 + p * 34)   // circle-ok: forge burst ring
        fx.fillStyle(C_EMBER2, 0.6 * (1 - p)); fx.fillCircle(0, 0, 5 * (1 - p) + 2)   // circle-ok: burst core
      }
      draw(0)
      s.tweens.add({ targets: { p: 0 }, p: 1, duration: 520, ease: 'Quad.easeOut',
        onUpdate: (tw, tg) => { try { draw(tg.p) } catch {} },
        onComplete: () => { try { fx.destroy() } catch {} } })
      // blood-droplet spray on a normal layer
      const spray = s.add.graphics().setDepth(DEPTH_EMBER + 0.1)
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * TAU, d = 6 + Math.random() * 22
        const dx = x + Math.cos(a) * d, dy = y + Math.sin(a) * d * 0.7
        spray.save?.(); spray.translateCanvas?.(dx, dy); VfxShapes.bloodDroplet(spray, 1.4 + Math.random()); spray.restore?.()
      }
      s.tweens.add({ targets: spray, alpha: 0, duration: 700, delay: 200, onComplete: () => { try { spray.destroy() } catch {} } })
    } catch (err) {
      console.warn('[HallOfTrialsRenderer] _onSpawn failed:', err.message)
    }
  }
}

// tiny stable hash for brand-lobe variation (avoids Math.random in the shape so
// the brand outline is stable, while the stains above are deliberately random)
function k0(i) { return (Math.sin(i * 51.3) * 7.1) % TAU }

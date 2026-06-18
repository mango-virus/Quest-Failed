// GuardPostRenderer — a lit WATCH-FIRE burns at the heart of every active
// Guard Post: a real layered flame (shared VfxShapes.flame) on a small ember
// bed, a warm glow pool, rising sparks, and a faint alert-pulse that sweeps
// toward the doorways the post's minions sally through. Reads as "manned and
// ready" (there's no per-sally event to hook, so this is ambience).
//
// Decor-independent (drawn at room centre + connected door ports).

import { Balance } from '../config/balance.js'
import { VfxShapes } from './AbilityVfx.js'
import { connectedDoorPorts } from '../util/roomPorts.js'

const TS  = Balance.TILE_SIZE
const TAU = Math.PI * 2

const DEPTH_GLOW = 5.9
const DEPTH_FIRE = 6.1

const COL_GLOW  = 0xff8a2a
const COL_EMBER = 0xffb24a
const COL_SPARK = 0xffd86a

export class GuardPostRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._gGlow = scene.add.graphics().setDepth(DEPTH_GLOW)
    try { this._gGlow.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._gFire = scene.add.graphics().setDepth(DEPTH_FIRE)
    try { this._gFire.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    this._sparks = {}
  }

  destroy() {
    try { this._gGlow?.destroy(); this._gFire?.destroy() } catch {}
    this._gGlow = this._gFire = null
    this._sparks = {}
  }

  update(delta) {
    if (!this._gGlow) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._gGlow.clear(); this._gFire.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const grid = this._scene.dungeonGrid
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'starter_guard_post' || room.isActive === false) continue
      live.add(room.instanceId)
      this._draw(room, grid, dt, lod)
    }
    for (const id of Object.keys(this._sparks)) if (!live.has(id)) delete this._sparks[id]
  }

  _draw(room, grid, dt, lod) {
    const gG = this._gGlow, gF = this._gFire
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t

    // warm glow pool under the watch-fire
    gG.fillStyle(COL_GLOW, 0.14 + 0.04 * Math.sin(t * 6))
    gG.fillCircle(cx, cy + 2, 16)   // circle-ok: watch-fire glow pool

    if (!lod) {
      // faint alert-pulse sweeping toward each doorway the post watches
      for (const p of (grid ? connectedDoorPorts(room, grid, { excludeDefs: ['boss_chamber'] }) : [])) {
        const prog = (t * 0.6 + (p.x + p.y) * 0.002) % 1
        const px = cx + (p.x - cx) * prog, py = cy + (p.y - cy) * prog
        gG.fillStyle(COL_GLOW, 0.18 * (1 - prog))
        gG.fillCircle(px, py, 2 * (1 - prog) + 0.6)   // circle-ok: alert pulse bead
      }
    }

    // ember bed
    gF.fillStyle(0x7a2a08, 0.6); gF.fillEllipse(cx, cy + 2, 12, 5)   // ellipse-ok: ember bed
    gF.fillStyle(COL_EMBER, 0.5 + 0.3 * Math.sin(t * 7)); gF.fillEllipse(cx, cy + 2, 8, 3.5)   // ellipse-ok: hot embers

    // the watch-fire — a real layered flame, height flickering
    if (!lod) {
      const h = 13 + 5 * Math.abs(Math.sin(t * 8))
      gF.save?.(); gF.translateCanvas?.(cx, cy + 2)
      VfxShapes.flame(gF, h, 4.2, Math.sin(t * 5) * 1.6)
      gF.restore?.()
      // rising sparks
      let arr = this._sparks[room.instanceId]
      if (!arr) { arr = []; this._sparks[room.instanceId] = arr }
      if (arr.length < 6 && Math.sin(t * 9 + room.gridX) > 0.5) arr.push({ x: cx + (Math.random() - 0.5) * 6, y: cy, vy: -20 - Math.random() * 20, vx: (Math.random() - 0.5) * 10, life: 0, maxLife: 0.7 + Math.random() * 0.5 })
      for (let i = arr.length - 1; i >= 0; i--) {
        const s = arr[i]; s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 8 * dt
        if (s.life >= s.maxLife) { arr.splice(i, 1); continue }
        const a = 1 - s.life / s.maxLife
        gF.fillStyle(COL_SPARK, a); gF.fillCircle(s.x, s.y, 0.9 * a + 0.3)   // circle-ok: watch-fire spark
      }
    }
  }
}

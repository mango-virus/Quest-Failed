// HallOfTrialsRenderer — a glowing magma FISSURE splits the floor of every
// active Hall of Trials (the crucible), breathing heat-shimmer and faint
// embers. On HALL_OF_TRIALS_SPAWNED the fissure erupts an ember GEYSER as the
// elite rises from the crucible.
//
// Decor-independent: the fissure is drawn across the room floor. A horizontal
// glowing ground-crack — a different silhouette from the Armory's compact
// forge ball. Spawn mechanic lives in RoomBehaviorSystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS

const DEPTH_FISSURE = 3.5   // in the floor
const DEPTH_HEAT    = 6.0   // shimmer/embers above

const COL_MAGMA  = 0xff5a1e
const COL_MAGMA_H = 0xffd060   // hot core
const COL_CRACK  = 0x140805    // charred crack edge
const COL_EMBER  = 0xffae4a

export class HallOfTrialsRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._gFloor = scene.add.graphics().setDepth(DEPTH_FISSURE)
    this._gHeat  = scene.add.graphics().setDepth(DEPTH_HEAT)
    try { this._gHeat.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    this._emberByRoom = {}
    this._seeds = {}
    EventBus.on('HALL_OF_TRIALS_SPAWNED', this._onSpawn, this)
  }

  destroy() {
    EventBus.off('HALL_OF_TRIALS_SPAWNED', this._onSpawn, this)
    try { this._gFloor?.destroy(); this._gHeat?.destroy() } catch {}
    this._gFloor = this._gHeat = null
    this._emberByRoom = {}
  }

  update(delta) {
    if (!this._gFloor) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._gFloor.clear(); this._gHeat.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'hall_of_trials' || room.isActive === false) continue
      live.add(room.instanceId)
      this._draw(room, dt, lod)
    }
    for (const id of Object.keys(this._emberByRoom)) if (!live.has(id)) delete this._emberByRoom[id]
  }

  // a deterministic jagged poly-line across the room for this room's fissure
  _fissurePts(room) {
    let seed = this._seeds[room.instanceId]
    if (!seed) {
      seed = []
      const segs = 7
      const span = (room.width - 2 * WT) * TS
      const x0 = (room.gridX + WT) * TS
      const cy = (room.gridY + room.height / 2) * TS
      for (let i = 0; i <= segs; i++) {
        const f = i / segs
        // pseudo-random vertical jag, stable per room
        const jag = (Math.sin((room.gridX + i) * 12.9898 + (room.gridY + i) * 78.233) * 43758.5) % 1
        seed.push({ x: x0 + f * span, y: cy + (jag - 0.5) * 22 * Math.sin(f * Math.PI) })
      }
      this._seeds[room.instanceId] = seed
    }
    return seed
  }

  _draw(room, dt, lod) {
    const gF = this._gFloor, gH = this._gHeat
    const t = this._t
    const pts = this._fissurePts(room)
    const pulse = 0.7 + 0.3 * Math.sin(t * 2.2)

    // charred crack edge (slightly thicker, dark) then the glowing magma core
    this._stroke(gF, pts, COL_CRACK, 7, 0.9, 0)
    this._stroke(gF, pts, COL_MAGMA, 4, 0.55 * pulse, Math.sin(t * 3) * 0.6)
    this._stroke(gF, pts, COL_MAGMA_H, 1.6, 0.8 * pulse, Math.sin(t * 4) * 0.4)

    if (lod) return

    // glow + heat-shimmer rising off the fissure
    let arr = this._emberByRoom[room.instanceId]
    if (!arr) { arr = []; this._emberByRoom[room.instanceId] = arr }
    // soft additive glow along the crack
    for (const p of pts) {
      gH.fillStyle(COL_MAGMA, 0.06 * pulse)
      gH.fillCircle(p.x, p.y, 9)   // circle-ok: fissure heat-glow blob
    }
    // ambient embers drifting up
    if ((t % 0.5) < dt * 1.5) {
      const p = pts[1 + Math.floor(Math.random() * (pts.length - 2))]
      arr.push({ x: p.x + (Math.random() - 0.5) * 6, y: p.y, vy: -14 - Math.random() * 16, vx: (Math.random() - 0.5) * 8, life: 0, maxLife: 0.9 + Math.random() * 0.7 })
    }
    this._tickEmbers(gH, arr, dt)
  }

  _tickEmbers(g, arr, dt) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i]
      e.life += dt; e.x += e.vx * dt; e.y += e.vy * dt; e.vy += 6 * dt
      if (e.life >= e.maxLife) { arr.splice(i, 1); continue }
      const a = 1 - e.life / e.maxLife
      g.fillStyle(COL_EMBER, a)
      g.fillCircle(e.x, e.y, 1.1 * a + 0.4)   // circle-ok: rising ember
    }
  }

  _stroke(g, pts, col, w, alpha, jitter) {
    g.lineStyle(w, col, alpha)
    g.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i].x, y = pts[i].y + (i > 0 && i < pts.length - 1 ? jitter : 0)
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
    }
    g.strokePath()
  }

  _onSpawn({ roomId, minion } = {}) {
    try {
      const s = this._scene
      const room = (this._gameState.dungeon?.rooms ?? []).find(r => r.instanceId === roomId)
      const x = minion?.worldX ?? (room ? (room.gridX + room.width / 2) * TS : null)
      const y = minion?.worldY ?? (room ? (room.gridY + room.height / 2) * TS : null)
      if (x == null) return
      // ember geyser erupting up from the crucible
      const arr = this._emberByRoom[roomId] ?? (this._emberByRoom[roomId] = [])
      for (let i = 0; i < 18; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.7
        const sp = 60 + Math.random() * 90
        arr.push({ x: x + (Math.random() - 0.5) * 8, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, maxLife: 0.6 + Math.random() * 0.6 })
      }
      // a hot flash at the eruption point
      const flash = s.add.graphics().setDepth(DEPTH_HEAT + 0.2).setPosition(x, y)
      try { flash.setBlendMode(Phaser.BlendModes.ADD) } catch {}
      const draw = (p) => {
        flash.clear()
        flash.fillStyle(COL_MAGMA_H, 0.6 * (1 - p))
        flash.fillCircle(0, 0, 6 + p * 16)   // circle-ok: eruption flash
      }
      draw(0)
      s.tweens.add({ targets: { p: 0 }, p: 1, duration: 420, ease: 'Quad.easeOut',
        onUpdate: (tw, tg) => { try { draw(tg.p) } catch {} },
        onComplete: () => { try { flash.destroy() } catch {} } })
    } catch (err) {
      console.warn('[HallOfTrialsRenderer] _onSpawn failed:', err.message)
    }
  }
}

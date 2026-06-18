// FalseExitRenderer — a warm "daylight" escape-glow spills from the doorway of
// every active False Exit (it looks like the way out)… but the tell is that
// the light FLICKERS off-rhythm (real escape light is steady) and faint
// shadow-wisps crawl BACK INWARD against it. On FALSE_EXIT_TELEPORTED the glow
// snuffs and folds inward as the fleer is yanked back.
//
// Player-only: the adventurer AI is fooled by the mechanic regardless, so the
// tell is purely for the player to read. Decor-independent (anchored to the
// room's doorways / floor).

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { connectedDoorPorts } from '../util/roomPorts.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_GLOW = 3.7    // warm light on the floor
const DEPTH_WISP = 6.0    // shadow-wisps above

const COL_DAY  = 0xffe6b0   // false daylight
const COL_DAY2 = 0xfff2d6
const COL_WISP = 0x0a0712   // crawling shadow

export class FalseExitRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._gGlow = scene.add.graphics().setDepth(DEPTH_GLOW)
    try { this._gGlow.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._gWisp = scene.add.graphics().setDepth(DEPTH_WISP)
    this._t = 0
    this._snuff = {}    // roomId → snuff-until time
    this._wisps = {}
    EventBus.on('FALSE_EXIT_TELEPORTED', this._onTeleport, this)
  }

  destroy() {
    EventBus.off('FALSE_EXIT_TELEPORTED', this._onTeleport, this)
    try { this._gGlow?.destroy(); this._gWisp?.destroy() } catch {}
    this._gGlow = this._gWisp = null
    this._wisps = {}
  }

  // "wrong" flicker — mostly bright but stutters with occasional sharp dips,
  // unlike a steady daylight. 0..1.
  _flicker(t, seed) {
    const base = 0.7 + 0.18 * Math.sin(t * 2.3 + seed) + 0.1 * Math.sin(t * 5.1 + seed * 2)
    const dip = (Math.sin(t * 0.9 + seed) > 0.86) ? -0.5 : 0   // occasional brown-out
    return Math.max(0.1, base + dip)
  }

  update(delta) {
    if (!this._gGlow) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._gGlow.clear(); this._gWisp.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const grid = this._scene.dungeonGrid
    const now = this._scene.time?.now ?? 0
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'false_exit' || room.isActive === false) continue
      live.add(room.instanceId)
      this._draw(room, grid, dt, lod, now)
    }
    for (const id of Object.keys(this._wisps)) if (!live.has(id)) delete this._wisps[id]
  }

  _draw(room, grid, dt, lod, now) {
    const g = this._gGlow, gw = this._gWisp
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const t = this._t
    const snuffUntil = this._snuff[room.instanceId] ?? 0
    const snuffK = now < snuffUntil ? (snuffUntil - now) / 400 : 0   // 1→0 as it recovers
    const fl = this._flicker(t, room.gridX) * (1 - snuffK)

    // the "exit" direction = a connected doorway (the door the fleer aims for);
    // bias the escape-glow toward it. Fall back to the top wall.
    const ports = grid ? connectedDoorPorts(room, grid, {}) : []
    const port = ports[0]
    // anchor the escape-light at the doorway the fleer aims for; with no
    // doorway yet, sit it at room centre so it always reads.
    const ex = port ? port.x : cx, ey = port ? port.y : cy

    // warm daylight pooling from the doorway into the room (the lure)
    g.fillStyle(COL_DAY, 0.24 * fl)
    g.fillEllipse(ex, ey, 52, 36)   // ellipse-ok: daylight spilling from the exit
    g.fillStyle(COL_DAY2, 0.28 * fl)
    g.fillEllipse(ex, ey, 26, 19)   // ellipse-ok: bright doorway core
    // a soft warm wash across the room floor
    g.fillStyle(COL_DAY, 0.08 * fl)
    g.fillCircle(cx, cy, Math.min(room.width, room.height) / 2 * TS * 0.8)   // circle-ok: room escape-wash

    if (lod) return

    // shadow-wisps crawling INWARD from the doorway (the wrongness) — light
    // shouldn't drag shadows back in.
    let arr = this._wisps[room.instanceId]
    if (!arr) { arr = []; this._wisps[room.instanceId] = arr }
    if (arr.length < 5 && Math.sin(t * 4 + room.gridY) > 0.5) {
      const a = Math.atan2(cy - ey, cx - ex) + (Math.random() - 0.5) * 0.7
      arr.push({ x: ex, y: ey, vx: Math.cos(a) * (14 + Math.random() * 10), vy: Math.sin(a) * (14 + Math.random() * 10), life: 0, maxLife: 1.4 + Math.random() * 0.8, sz: 3 + Math.random() * 2 })
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const w = arr[i]
      w.life += dt; w.x += w.vx * dt; w.y += w.vy * dt
      if (w.life >= w.maxLife) { arr.splice(i, 1); continue }
      const k = Math.sin((w.life / w.maxLife) * Math.PI)
      gw.fillStyle(COL_WISP, 0.4 * k)
      // a small lobed shadow blob
      const N = 8, pts = []
      for (let j = 0; j < N; j++) { const ang = (j / N) * TAU; const r = w.sz * (1 + 0.3 * Math.sin(ang * 2 + w.life * 4)); pts.push({ x: w.x + Math.cos(ang) * r, y: w.y + Math.sin(ang) * r * 0.7 }) }
      gw.fillPoints(pts, true)
    }
  }

  _onTeleport({ adventurer } = {}) {
    try {
      // snuff every false-exit glow briefly + an inward fold where the fleer was
      for (const room of (this._gameState.dungeon?.rooms ?? []).filter(r => r.definitionId === 'false_exit')) {
        this._snuff[room.instanceId] = (this._scene.time?.now ?? 0) + 400
      }
      const s = this._scene
      if (!s || !adventurer || !Number.isFinite(adventurer.worldX)) return
      const x = adventurer.worldX, y = adventurer.worldY
      const fold = s.add.graphics().setDepth(DEPTH_WISP + 0.1).setPosition(x, y)
      const draw = (p) => {
        fold.clear()
        // a ring collapsing inward (the space folding back)
        fold.lineStyle(2.5 * (1 - p), COL_DAY2, 0.8 * (1 - p))
        fold.strokeCircle(0, 0, 26 * (1 - p) + 4)   // circle-ok: inward fold ring
      }
      draw(0)
      s.tweens.add({ targets: { p: 0 }, p: 1, duration: 380, ease: 'Quad.easeIn',
        onUpdate: (tw, tg) => { try { draw(tg.p) } catch {} },
        onComplete: () => { try { fold.destroy() } catch {} } })
    } catch (err) {
      console.warn('[FalseExitRenderer] _onTeleport failed:', err.message)
    }
  }
}

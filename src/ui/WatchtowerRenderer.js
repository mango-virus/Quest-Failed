// WatchtowerRenderer — a slow rotating SEARCHLIGHT CONE that sweeps from each
// active Watchtower across its connected doorways, telegraphing "this area is
// watched" (the first-strike aura). A soft directional sweep — feathered, not
// a hard wedge, not a ring. Dust motes catch in the beam.
//
// On WATCHTOWER_FIRST_STRIKE the beam snaps to the entering adventurer with a
// sharp "spotted!" glint, then a converging light-stab.
//
// Decor-independent (anchored to room centre + connected door ports).

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { connectedDoorPorts } from '../util/roomPorts.js'

const TS  = Balance.TILE_SIZE
const TAU = Math.PI * 2

const DEPTH_BEAM = 6.2

const COL_BEAM = 0xf2e6b0   // pale watch-light
const COL_CORE = 0xfffcea
const COL_GLINT = 0xfff0c0

export class WatchtowerRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_BEAM)
    try { this._g.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    this._snap = {}   // roomId → { ang, until } when snapped to a target
    EventBus.on('WATCHTOWER_FIRST_STRIKE', this._onStrike, this)
  }

  destroy() {
    EventBus.off('WATCHTOWER_FIRST_STRIKE', this._onStrike, this)
    try { this._g?.destroy() } catch {}
    this._g = null
  }

  update(delta) {
    const g = this._g
    if (!g) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    g.clear()
    const now = this._scene.time?.now ?? 0
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'watchtower' || room.isActive === false) continue
      this._drawBeam(g, room, now, lod)
    }
  }

  _center(room) {
    return {
      cx: (room.gridX + room.width / 2) * TS,
      cy: (room.gridY + room.height / 2) * TS,
      // half-diagonal of the FULL room (walls included) so the beam reaches
      // into the corners — it sweeps the whole room, not just the interior.
      R: Math.hypot(room.width, room.height) / 2 * TS,
    }
  }

  _drawBeam(g, room, now, lod) {
    const { cx, cy, R } = this._center(room)
    const t = this._t
    // sweep angle — steady rotation unless snapped to a strike target
    const snap = this._snap[room.instanceId]
    let ang
    if (snap && now < snap.until) {
      ang = snap.ang
    } else {
      ang = (t * 1.6) % TAU    // ~1 rev / 4s
    }
    const half = 0.34          // cone half-angle (radians)
    // feathered cone: a fan of points whose radius wobbles so the edge isn't
    // a clean wedge; alpha falls toward the rim.
    const N = 14
    const pts = [{ x: cx, y: cy }]
    for (let i = 0; i <= N; i++) {
      const a = ang - half + (i / N) * half * 2
      const wob = lod ? 1 : (0.9 + 0.12 * Math.sin(a * 9 + t * 5))
      pts.push({ x: cx + Math.cos(a) * R * wob, y: cy + Math.sin(a) * R * wob })
    }
    g.fillStyle(COL_BEAM, 0.10)
    g.fillPoints(pts, true)
    // brighter inner cone
    const N2 = 10, pts2 = [{ x: cx, y: cy }]
    for (let i = 0; i <= N2; i++) {
      const a = ang - half * 0.5 + (i / N2) * half
      pts2.push({ x: cx + Math.cos(a) * R * 0.92, y: cy + Math.sin(a) * R * 0.92 })
    }
    g.fillStyle(COL_BEAM, 0.12)
    g.fillPoints(pts2, true)
    // bright source core at the tower
    g.fillStyle(COL_CORE, 0.5)
    g.fillCircle(cx, cy, 4)   // circle-ok: the watch-light source point

    if (lod) return
    // dust motes drifting in the beam
    for (let i = 0; i < 5; i++) {
      const a = ang - half + ((i * 0.37 + t * 0.2) % 1) * half * 2
      const rr = R * (0.3 + ((i * 0.21 + t * 0.13) % 1) * 0.6)
      const mx = cx + Math.cos(a) * rr, my = cy + Math.sin(a) * rr
      g.fillStyle(COL_CORE, 0.18 + 0.12 * Math.sin(t * 3 + i))
      g.fillCircle(mx, my, 0.9)   // circle-ok: dust mote in the beam
    }
  }

  _onStrike({ adventurer, roomId } = {}) {
    try {
      const s = this._scene
      if (!s || !adventurer) return
      const room = (this._gameState.dungeon?.rooms ?? []).find(r => r.instanceId === roomId)
      // snap the nearest watchtower's beam to the target for a beat
      const towers = (this._gameState.dungeon?.rooms ?? []).filter(r =>
        r.definitionId === 'watchtower' && r.isActive !== false)
      if (towers.length === 0) return
      const ax = adventurer.worldX ?? 0, ay = adventurer.worldY ?? 0
      let tower = towers[0], best = Infinity
      for (const r of towers) {
        const cx = (r.gridX + r.width / 2) * TS, cy = (r.gridY + r.height / 2) * TS
        const d = (cx - ax) ** 2 + (cy - ay) ** 2
        if (d < best) { best = d; tower = r }
      }
      const cx = (tower.gridX + tower.width / 2) * TS, cy = (tower.gridY + tower.height / 2) * TS
      this._snap[tower.instanceId] = { ang: Math.atan2(ay - cy, ax - cx), until: (s.time?.now ?? 0) + 450 }
      // "spotted!" glint + converging light-stab on the target
      const glint = s.add.graphics().setDepth(DEPTH_BEAM + 0.2).setPosition(ax, ay)
      try { glint.setBlendMode(Phaser.BlendModes.ADD) } catch {}
      const draw = (p) => {
        glint.clear()
        glint.fillStyle(COL_GLINT, 0.9 * (1 - p))
        glint.fillCircle(0, 0, 3 + p * 5)   // circle-ok: spotted glint flash
        // four-point sparkle spikes
        glint.lineStyle(1.5, COL_CORE, 0.9 * (1 - p))
        const r = 6 + p * 10
        glint.lineBetween(-r, 0, r, 0); glint.lineBetween(0, -r, 0, r)
      }
      draw(0)
      s.tweens.add({ targets: { p: 0 }, p: 1, duration: 380, ease: 'Quad.easeOut',
        onUpdate: (tw, tg) => { try { draw(tg.p) } catch {} },
        onComplete: () => { try { glint.destroy() } catch {} } })
    } catch (err) {
      console.warn('[WatchtowerRenderer] _onStrike failed:', err.message)
    }
  }
}

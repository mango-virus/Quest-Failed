// Miner Tunnel visualizer — paints the open holes the Miner digs.
//
// Listens for MINER_DIG_HOLE { x, y } — fired once per endpoint as the Miner's
// staged tunnel opens (hole A when he finishes digging, hole B when he surfaces
// elsewhere) — and draws a dark pit with a rubble rim + a faint pulsing glow at
// that tile, so the player sees each breach the raid can now route through. All
// holes clear on NIGHT_PHASE_STARTED / DAY_PHASE_ENDED, matching the portal
// state's "collapses at night" lifetime in ClassAbilitySystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class TunnelPortalRenderer {
  constructor(scene) {
    this._scene = scene
    this._holes = []   // [{ gfx, tween }]
    this._listeners = []
    const on = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    on('MINER_DIG_HOLE',      this._onHole.bind(this))
    on('NIGHT_PHASE_STARTED', this._clearAll.bind(this))
    on('DAY_PHASE_ENDED',     this._clearAll.bind(this))
  }

  destroy() {
    for (const [e, fn] of this._listeners) EventBus.off(e, fn)
    this._listeners = []
    this._clearAll()
  }

  _onHole({ x, y }) {
    this._drawHole(x, y)
  }

  _drawHole(tx, ty) {
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return
    const cx = tx * TS + TS / 2, cy = ty * TS + TS / 2
    // Draw in LOCAL coords + position the gfx so the pop-in scale tweens about
    // the hole's centre (not the world origin).
    const gfx = this._scene.add.graphics().setDepth(2.5).setPosition(cx, cy)
    const draw = (glow = 1) => {
      gfx.clear()
      gfx.fillStyle(0x000000, 0.92); gfx.fillCircle(0, 0, TS * 0.42)   // black pit
      gfx.fillStyle(0x1a1208, 0.95); gfx.fillCircle(0, 0, TS * 0.32)   // depth
      gfx.lineStyle(3, 0x6b4f2a, 0.9);  gfx.strokeCircle(0, 0, TS * 0.44) // rubble rim
      gfx.lineStyle(1.5, 0xc79a5a, 0.55 * glow); gfx.strokeCircle(0, 0, TS * 0.52) // dust glow
    }
    draw()
    gfx.setScale(0.3)
    this._scene.tweens.add({ targets: gfx, scale: 1, duration: 240, ease: 'Back.easeOut' })
    const tween = this._scene.tweens.add({
      targets: { a: 1 }, a: 0.35, duration: 700, yoyo: true, repeat: -1,
      onUpdate: (t, target) => { if (gfx.active) draw(target.a) },
    })
    this._holes.push({ gfx, tween })
  }

  _clearAll() {
    for (const h of this._holes) {
      if (h.tween?.isPlaying?.()) h.tween.stop()
      if (h.gfx?.active) h.gfx.destroy()
    }
    this._holes = []
  }
}

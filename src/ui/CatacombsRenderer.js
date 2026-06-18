// CatacombsRenderer — pairs of cold ember-EYES smoulder in the wall niches
// around every active Catacombs, watching. When an adventurer dies here a
// Revenant rises: bone-shards spiral INWARD and assemble upward at the corpse
// tile with a violet death-bloom (a converging composition, distinct from the
// Crypt's floor-claws). Violet/cold palette vs the Crypt's sickly green.
//
// Decor-independent (eyes are drawn along the interior wall line, not niche
// props). The revenant mechanic lives in AISystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_EYE = 6.0

const COL_EYE   = 0xb070ff   // cold violet ember-eye
const COL_EYE_C = 0xe6ccff
const COL_BONE  = 0xd8d2bc
const COL_BLOOM = 0x8a3aff   // violet death-bloom

export class CatacombsRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_EYE)
    try { this._g.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    EventBus.on('CATACOMBS_REVENANT_RAISED', this._onRaise, this)
  }

  destroy() {
    EventBus.off('CATACOMBS_REVENANT_RAISED', this._onRaise, this)
    try { this._g?.destroy() } catch {}
    this._g = null
  }

  update(delta) {
    if (!this._g) return
    this._t += Math.min(50, delta ?? 16) / 1000
    this._g.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'catacombs' || room.isActive === false) continue
      this._drawEyes(this._g, room, lod)
    }
  }

  // Eye-pairs spaced along the inner edge of each wall, facing into the room.
  _drawEyes(g, room, lod) {
    const t = this._t
    const innerL = (room.gridX + WT) * TS, innerR = (room.gridX + room.width - WT) * TS
    const innerT = (room.gridY + WT) * TS, innerB = (room.gridY + room.height - WT) * TS
    const step = lod ? 4 : 2     // tiles between eye-pairs
    const eyes = []
    // top + bottom walls
    for (let tx = room.gridX + WT + 1; tx < room.gridX + room.width - WT - 1; tx += step) {
      const wx = (tx + 0.5) * TS
      eyes.push([wx, innerT + 3, 0, 1]); eyes.push([wx, innerB - 3, 0, -1])
    }
    // left + right walls
    for (let ty = room.gridY + WT + 1; ty < room.gridY + room.height - WT - 1; ty += step) {
      const wy = (ty + 0.5) * TS
      eyes.push([innerL + 3, wy, 1, 0]); eyes.push([innerR - 3, wy, -1, 0])
    }
    for (let i = 0; i < eyes.length; i++) {
      const [ex, ey, nx, ny] = eyes[i]
      // slow per-eye flicker; a few wink out entirely
      const fl = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.3 + i * 1.7))
      if (fl < 0.2) continue
      // an eye-pair (two close dots) staring inward, each with a soft outer
      // glow so they smoulder visibly from the wall.
      const gap = 2.8
      const px = -ny * gap, py = nx * gap   // perpendicular offset for the pair
      g.fillStyle(COL_EYE, 0.28 * fl)
      g.fillCircle(ex + px, ey + py, 4.2)   // circle-ok: ember-eye halo
      g.fillCircle(ex - px, ey - py, 4.2)   // circle-ok: ember-eye halo
      g.fillStyle(COL_EYE, 0.7 * fl)
      g.fillCircle(ex + px, ey + py, 2.4)   // circle-ok: ember-eye glow
      g.fillCircle(ex - px, ey - py, 2.4)   // circle-ok: ember-eye glow
      g.fillStyle(COL_EYE_C, 1.0 * fl)
      g.fillCircle(ex + px, ey + py, 1.1)   // circle-ok: ember-eye pupil
      g.fillCircle(ex - px, ey - py, 1.1)   // circle-ok: ember-eye pupil
    }
  }

  // Death → assembly: shards converge inward and stack up into a revenant
  // silhouette, capped by a violet bloom.
  _onRaise({ roomId, fromAdv } = {}) {
    try {
      const s = this._scene
      if (!s) return
      // find the freshly-raised revenant for its position; fall back to room centre
      const rev = (this._gameState.minions ?? []).find(m =>
        m.assignedRoomId === roomId && m.isCatacombsRevenant && m.aiState !== 'dead')
      const room = (this._gameState.dungeon?.rooms ?? []).find(r => r.instanceId === roomId)
      const x = rev?.worldX ?? (room ? (room.gridX + room.width / 2) * TS : null)
      const y = rev?.worldY ?? (room ? (room.gridY + room.height / 2) * TS : null)
      if (x == null) return
      // shards fly IN from a ring and assemble
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU
        const r0 = 22 + Math.random() * 10
        const sx = x + Math.cos(a) * r0, sy = y + Math.sin(a) * r0
        const d = s.add.graphics().setDepth(DEPTH_EYE + 0.1).setPosition(sx, sy)
        d.fillStyle(COL_BONE, 0.95)
        d.fillRect(-1.5, -1, 3, 5)   // rect-ok: bone shard
        s.tweens.add({ targets: d, x, y: y - 4, angle: (Math.random() - 0.5) * 120,
          alpha: { from: 0.95, to: 0.2 }, duration: 360 + Math.random() * 120, ease: 'Quad.easeIn',
          onComplete: () => { try { d.destroy() } catch {} } })
      }
      // violet death-bloom at the assembly point
      const bloom = s.add.graphics().setDepth(DEPTH_EYE + 0.2).setPosition(x, y)
      try { bloom.setBlendMode(Phaser.BlendModes.ADD) } catch {}
      const draw = (p) => {
        bloom.clear()
        bloom.fillStyle(COL_BLOOM, 0.55 * (1 - p))
        bloom.fillCircle(0, 0, 4 + p * 18)   // circle-ok: death-bloom flash
        bloom.lineStyle(1.5, COL_EYE_C, 0.7 * (1 - p))
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU
          bloom.lineBetween(0, 0, Math.cos(a) * (6 + p * 20), Math.sin(a) * (6 + p * 20))
        }
      }
      draw(0)
      s.tweens.add({ targets: { p: 0 }, p: 1, duration: 520, delay: 320, ease: 'Quad.easeOut',
        onUpdate: (tw, tg) => { try { draw(tg.p) } catch {} },
        onComplete: () => { try { bloom.destroy() } catch {} } })
    } catch (err) {
      console.warn('[CatacombsRenderer] _onRaise failed:', err.message)
    }
  }
}

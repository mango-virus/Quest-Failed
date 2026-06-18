// CatacombsRenderer — detailed spectral EYES open and smoulder in the wall
// niches around every active Catacombs, blinking and watching. Each is the
// shared `AbilityVfx` `_drawSpectralEye` (a pale almond lens with a cold
// glowing pupil), drawn once into its own additive graphics and flickered via
// alpha — ability fidelity, not flat dots. When an adventurer dies here a
// Revenant rises: bones knit together + a violet reanimation burst.
//
// Decor-independent (eyes sit on the interior wall line). Revenant mechanic in
// AISystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { AbilityVfx, VfxShapes } from './AbilityVfx.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS

const DEPTH_EYE = 6.0
const COL_EYE   = 0xb070ff   // cold violet spectral eye

export class CatacombsRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._t = 0
    this._eyesByRoom = {}   // roomId → [{ g, phase, blinkAt }]
    EventBus.on('CATACOMBS_REVENANT_RAISED', this._onRaise, this)
  }

  destroy() {
    EventBus.off('CATACOMBS_REVENANT_RAISED', this._onRaise, this)
    for (const id of Object.keys(this._eyesByRoom)) this._dropRoom(id)
    this._eyesByRoom = {}
  }

  _dropRoom(id) {
    for (const e of (this._eyesByRoom[id] ?? [])) { try { e.g.destroy() } catch {} }
    delete this._eyesByRoom[id]
  }

  update(delta) {
    this._t += Math.min(50, delta ?? 16) / 1000
    const t = this._t
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'catacombs' || room.isActive === false) continue
      live.add(room.instanceId)
      let eyes = this._eyesByRoom[room.instanceId]
      if (!eyes) eyes = this._buildEyes(room)
      // flicker / blink each eye via alpha (geometry drawn once)
      for (const e of eyes) {
        const base = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2.1 + e.phase))
        const blink = (t * 1000) % e.blinkAt < 110 ? 0.06 : 1   // occasional quick blink
        e.g.setAlpha(base * blink)
      }
    }
    for (const id of Object.keys(this._eyesByRoom)) if (!live.has(id)) this._dropRoom(id)
  }

  _buildEyes(room) {
    const eyes = []
    const innerL = (room.gridX + WT) * TS, innerR = (room.gridX + room.width - WT) * TS
    const innerT = (room.gridY + WT) * TS, innerB = (room.gridY + room.height - WT) * TS
    const ms = []
    for (let tx = room.gridX + WT + 1; tx < room.gridX + room.width - WT - 1; tx += 2) {
      const wx = (tx + 0.5) * TS
      ms.push([wx, innerT + 4, 0]); ms.push([wx, innerB - 4, Math.PI])
    }
    for (let ty = room.gridY + WT + 1; ty < room.gridY + room.height - WT - 1; ty += 2) {
      const wy = (ty + 0.5) * TS
      ms.push([innerL + 4, wy, -Math.PI / 2]); ms.push([innerR - 4, wy, Math.PI / 2])
    }
    for (const [ex, ey, rot] of ms) {
      const g = this._scene.add.graphics().setDepth(DEPTH_EYE).setPosition(ex, ey)
      try { g.setBlendMode(Phaser.BlendModes.ADD) } catch {}
      g.setRotation(rot)
      VfxShapes.spectralEye(g, 3.4, COL_EYE)
      eyes.push({ g, phase: Math.random() * Math.PI * 2, blinkAt: 2200 + Math.random() * 3000 })
    }
    this._eyesByRoom[room.instanceId] = eyes
    return eyes
  }

  // Death → a Revenant knits together from bone + a violet reanimation flash.
  _onRaise({ roomId } = {}) {
    try {
      const s = this._scene
      const rev = (this._gameState.minions ?? []).find(m =>
        m.assignedRoomId === roomId && m.isCatacombsRevenant && m.aiState !== 'dead')
      const room = (this._gameState.dungeon?.rooms ?? []).find(r => r.instanceId === roomId)
      const x = rev?.worldX ?? (room ? (room.gridX + room.width / 2) * TS : null)
      const y = rev?.worldY ?? (room ? (room.gridY + room.height / 2) * TS : null)
      if (x == null) return
      // reuse the detailed bone-knit + a reanimation burst, tinted violet
      AbilityVfx.boneKnit?.(s, x, y, { depth: DEPTH_EYE + 0.1 })
      AbilityVfx.reanimateFx?.(s, x, y, { color: 0x8a3aff, depth: DEPTH_EYE + 0.2 })
    } catch (err) {
      console.warn('[CatacombsRenderer] _onRaise failed:', err.message)
    }
  }
}

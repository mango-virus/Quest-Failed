// CryptRenderer — a sickly necrotic ground-mist pools in the floor of every
// active Crypt while skeletal CLAW-HANDS keep bursting up out of the ground
// and sinking back (the dead clawing their way up to serve). The hands reuse
// the detailed `AbilityVfx.necroSummonFx` (bony palm + phalanged fingers +
// knuckle joints + a soul-pool + grave-dirt) — the same effect the Necromancer
// fires — so the room reads at the same fidelity as the abilities.
//
// On CRYPT_SPAWNED the grave heaves at the new minion's tile (a fresh summon).
//
// Decor-independent (room floor geometry). Spawn mechanic in RoomBehaviorSystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { AbilityVfx } from './AbilityVfx.js'
import { TILE } from '../systems/DungeonGrid.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_MIST = 3.55   // ground-hugging

const COL_MIST  = 0x3f6a3a   // sickly necrotic green
const COL_MIST2 = 0x29402a
const COL_MIST3 = 0x547f3e   // brighter wisp tone

export class CryptRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._gMist = scene.add.graphics().setDepth(DEPTH_MIST)
    this._t = 0
    this._nextHandAt = {}   // roomId → next ambient-claw time
    EventBus.on('CRYPT_SPAWNED', this._onSpawn, this)
  }

  destroy() {
    EventBus.off('CRYPT_SPAWNED', this._onSpawn, this)
    try { this._gMist?.destroy() } catch {}
    this._gMist = null
  }

  update(delta) {
    if (!this._gMist) return
    this._t += Math.min(50, delta ?? 16) / 1000
    this._gMist.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const now = this._scene.time?.now ?? 0
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'crypt' || room.isActive === false) continue
      live.add(room.instanceId)
      this._drawMist(this._gMist, room, lod)
      // ambient clawing hands — fire the detailed necro-summon every few
      // seconds at a random floor tile (skip at wide zoom).
      if (!lod) {
        const next = this._nextHandAt[room.instanceId]
        if (next == null) { this._nextHandAt[room.instanceId] = now + 600 + Math.random() * 1400 }
        else if (now >= next) {
          this._clawUp(room)
          this._nextHandAt[room.instanceId] = now + 2200 + Math.random() * 2600
        }
      }
    }
    for (const id of Object.keys(this._nextHandAt)) if (!live.has(id)) delete this._nextHandAt[id]
  }

  _rect(room) {
    return {
      ix0: (room.gridX + WT) * TS, iy0: (room.gridY + WT) * TS,
      ix1: (room.gridX + room.width - WT) * TS, iy1: (room.gridY + room.height - WT) * TS,
    }
  }

  // Layered necrotic ground-mist — a few breathing lobed banks in two greens,
  // with a brighter drifting inner wisp for depth.
  _drawMist(g, room, lod) {
    const { ix0, iy0, ix1, iy1 } = this._rect(room)
    const cx = (ix0 + ix1) / 2, cy = (iy0 + iy1) / 2
    const rx = (ix1 - ix0) / 2, ry = (iy1 - iy0) / 2
    const t = this._t
    const banks = lod ? 1 : 3
    for (let b = 0; b < banks; b++) {
      const ph = b * 2.1
      const ox = Math.sin(t * 0.32 + ph) * rx * 0.28
      const oy = Math.cos(t * 0.26 + ph) * ry * 0.22
      this._fog(g, cx + ox, cy + oy, rx * 0.88, ry * 0.82, t + ph, b % 2 ? COL_MIST2 : COL_MIST, 0.15)
    }
    if (!lod) {
      const wx = cx + Math.sin(t * 0.5) * rx * 0.4, wy = cy + Math.cos(t * 0.4) * ry * 0.3
      this._fog(g, wx, wy, rx * 0.42, ry * 0.38, t * 1.3, COL_MIST3, 0.08)
    }
  }

  _fog(g, cx, cy, rx, ry, t, color, alpha) {
    const N = 24, pts = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const n = 0.22 * Math.sin(a * 2 + t * 0.55) + 0.13 * Math.sin(a * 4 - t * 0.4) + 0.07 * Math.sin(a * 6 + t * 0.3)
      pts.push({ x: cx + Math.cos(a) * rx * (1 + n), y: cy + Math.sin(a) * ry * (1 + n) })
    }
    g.fillStyle(color, alpha)
    g.fillPoints(pts, true)
  }

  // pick a random FLOOR tile-centre inside the room (falls back to room centre)
  _randomFloor(room) {
    const grid = this._scene.dungeonGrid
    for (let tries = 0; tries < 8; tries++) {
      const tx = room.gridX + WT + Math.floor(Math.random() * Math.max(1, room.width - 2 * WT))
      const ty = room.gridY + WT + Math.floor(Math.random() * Math.max(1, room.height - 2 * WT))
      const t = grid?.getTileType?.(tx, ty)
      if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR || t == null) {
        return { x: (tx + 0.5) * TS, y: (ty + 0.5) * TS }
      }
    }
    return { x: (room.gridX + room.width / 2) * TS, y: (room.gridY + room.height / 2) * TS }
  }

  _clawUp(room) {
    const p = this._randomFloor(room)
    // one hand at a time for the ambient claw-up (the Necromancer ability
    // keeps its default 2-3; the spawn beat below uses a fuller summon).
    try { AbilityVfx.necroSummonFx?.(this._scene, p.x, p.y, { depth: 6.0, hands: 1 }) } catch {}
  }

  _onSpawn({ minion, roomId } = {}) {
    try {
      const room = (this._gameState.dungeon?.rooms ?? []).find(r => r.instanceId === roomId)
      const x = minion?.worldX ?? (room ? (room.gridX + room.width / 2) * TS : null)
      const y = minion?.worldY ?? (room ? (room.gridY + room.height / 2) * TS : null)
      if (x == null) return
      // a bigger, brighter summon where the Risen Bones claws its way up
      AbilityVfx.necroSummonFx?.(this._scene, x, y, { depth: 6.2, durationMs: 950 })
    } catch (err) {
      console.warn('[CryptRenderer] _onSpawn failed:', err.message)
    }
  }
}

// CryptRenderer — a sickly necrotic GROUND-MIST pools in the floor seams of
// every active Crypt, and skeletal HANDS occasionally claw up out of the
// floor and sink back. Sells "undead birthing ground" (it spawns Risen Bones).
//
// On CRYPT_SPAWNED a grave heaves: a bone-shard burst + a green soul-wisp that
// rises where the new minion appears.
//
// Decor-independent (room floor geometry). The spawn mechanic lives in
// RoomBehaviorSystem.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const WT  = Balance.WALL_THICKNESS
const TAU = Math.PI * 2

const DEPTH_MIST = 3.55   // ground-hugging
const DEPTH_HAND = 6.0    // hands rise above the floor

const COL_MIST  = 0x3f6a3a   // sickly necrotic green
const COL_MIST2 = 0x29402a
const COL_BONE  = 0xd8d2bc   // bone
const COL_BONE_SH = 0x6a6450
const COL_SOUL  = 0x8effa0   // green soul-wisp

export class CryptRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._gMist = scene.add.graphics().setDepth(DEPTH_MIST)
    this._gHand = scene.add.graphics().setDepth(DEPTH_HAND)
    this._t = 0
    this._handsByRoom = {}
    EventBus.on('CRYPT_SPAWNED', this._onSpawn, this)
  }

  destroy() {
    EventBus.off('CRYPT_SPAWNED', this._onSpawn, this)
    try { this._gMist?.destroy(); this._gHand?.destroy() } catch {}
    this._gMist = this._gHand = null
    this._handsByRoom = {}
  }

  update(delta) {
    if (!this._gMist) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._gMist.clear(); this._gHand.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const live = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'crypt' || room.isActive === false) continue
      live.add(room.instanceId)
      this._drawMist(this._gMist, room, lod)
      if (!lod) this._drawHands(this._gHand, room, dt)
    }
    for (const id of Object.keys(this._handsByRoom)) if (!live.has(id)) delete this._handsByRoom[id]
  }

  _rect(room) {
    return {
      ix0: (room.gridX + WT) * TS, iy0: (room.gridY + WT) * TS,
      ix1: (room.gridX + room.width - WT) * TS, iy1: (room.gridY + room.height - WT) * TS,
    }
  }

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
      this._fog(g, cx + ox, cy + oy, rx * 0.88, ry * 0.82, t + ph, b % 2 ? COL_MIST2 : COL_MIST, 0.16)
    }
  }

  _fog(g, cx, cy, rx, ry, t, color, alpha) {
    const N = 22, pts = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU
      const n = 0.22 * Math.sin(a * 2 + t * 0.55) + 0.13 * Math.sin(a * 4 - t * 0.4) + 0.07 * Math.sin(a * 6 + t * 0.3)
      pts.push({ x: cx + Math.cos(a) * rx * (1 + n), y: cy + Math.sin(a) * ry * (1 + n) })
    }
    g.fillStyle(color, alpha)
    g.fillPoints(pts, true)
  }

  // skeletal hands clawing up out of the floor: each cycles emerge → claw →
  // sink. Positions are random within the room interior, refreshed per cycle.
  _drawHands(g, room, dt) {
    let arr = this._handsByRoom[room.instanceId]
    if (!arr) { arr = []; this._handsByRoom[room.instanceId] = arr }
    const { ix0, iy0, ix1, iy1 } = this._rect(room)
    const target = 3
    while (arr.length < target) {
      arr.push({
        x: ix0 + Math.random() * (ix1 - ix0),
        y: iy0 + Math.random() * (iy1 - iy0),
        life: 0, maxLife: 2.4 + Math.random() * 2.2,
        delay: Math.random() * 2, scale: 0.85 + Math.random() * 0.5,
        seed: Math.random() * TAU,
      })
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const h = arr[i]
      h.life += dt
      if (h.life < h.delay) continue
      const p = (h.life - h.delay) / h.maxLife
      if (p >= 1) { arr.splice(i, 1); continue }
      // emerge (0→0.35), hold+claw (0.35→0.7), sink (0.7→1)
      let rise
      if (p < 0.35) rise = p / 0.35
      else if (p < 0.7) rise = 1
      else rise = 1 - (p - 0.7) / 0.3
      this._hand(g, h.x, h.y, h.scale * rise, h.seed, this._t)
    }
  }

  _hand(g, x, y, grow, seed, t) {
    if (grow <= 0.02) return
    const s = 9 * grow
    const wristY = y - s * 0.2
    // wrist/palm — a small bone wedge
    g.fillStyle(COL_BONE_SH, 0.85)
    g.fillPoints([
      { x: x - s * 0.5, y: y + s * 0.2 }, { x: x + s * 0.5, y: y + s * 0.2 },
      { x: x + s * 0.36, y: wristY }, { x: x - s * 0.36, y: wristY },
    ], true)
    g.fillStyle(COL_BONE, 0.95)
    g.fillPoints([
      { x: x - s * 0.4, y: y + s * 0.15 }, { x: x + s * 0.4, y: y + s * 0.15 },
      { x: x + s * 0.28, y: wristY }, { x: x - s * 0.28, y: wristY },
    ], true)
    // four splayed clawing fingers (curl with a slow tremor)
    const curl = 0.25 * Math.sin(t * 4 + seed)
    for (let f = 0; f < 4; f++) {
      const fx = x + (f - 1.5) * s * 0.34
      const a = -Math.PI / 2 + (f - 1.5) * 0.28 + curl
      const len = s * (1.0 + (f === 1 || f === 2 ? 0.25 : 0))
      const tx = fx + Math.cos(a) * len, ty = wristY + Math.sin(a) * len
      g.lineStyle(2.1 * grow, COL_BONE_SH, 0.85)
      g.lineBetween(fx, wristY + 1, tx, ty)
      g.lineStyle(1.2 * grow, COL_BONE, 0.95)
      g.lineBetween(fx, wristY, tx, ty)
    }
  }

  _onSpawn({ roomId, minion } = {}) {
    try {
      const s = this._scene
      if (!s) return
      const room = (this._gameState.dungeon?.rooms ?? []).find(r => r.instanceId === roomId)
      const x = minion?.worldX ?? (room ? (room.gridX + room.width / 2) * TS : null)
      const y = minion?.worldY ?? (room ? (room.gridY + room.height / 2) * TS : null)
      if (x == null) return
      // green soul-wisp rising + a small bone-shard scatter (the grave heaving)
      const wisp = s.add.graphics().setDepth(DEPTH_HAND + 0.2).setPosition(x, y)
      try { wisp.setBlendMode(Phaser.BlendModes.ADD) } catch {}
      const draw = (p) => {
        wisp.clear()
        wisp.fillStyle(COL_SOUL, 0.5 * (1 - p))
        wisp.fillCircle(0, -p * 22, 5 * (1 - p * 0.5))   // circle-ok: rising soul-wisp
      }
      draw(0)
      s.tweens.add({ targets: { p: 0 }, p: 1, duration: 700, ease: 'Quad.easeOut',
        onUpdate: (tw, tg) => { try { draw(tg.p) } catch {} },
        onComplete: () => { try { wisp.destroy() } catch {} } })
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2
        const d = s.add.graphics().setDepth(DEPTH_HAND + 0.1).setPosition(x, y)
        d.fillStyle(COL_BONE, 0.9)
        d.fillRect(-1.5, -1, 3, 4)   // rect-ok: bone shard fragment
        const dist = 8 + Math.random() * 14
        s.tweens.add({ targets: d, x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist + 8,
          alpha: { from: 1, to: 0 }, angle: Math.random() * 360, duration: 420,
          ease: 'Quad.easeOut', onComplete: () => { try { d.destroy() } catch {} } })
      }
    } catch (err) {
      console.warn('[CryptRenderer] _onSpawn failed:', err.message)
    }
  }
}

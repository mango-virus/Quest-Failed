// Phase 8b — Replay Ghosts.
// When a fled adventurer returns the next day with their party, the leader's
// previously-recorded path samples (`priorPathHistory`) are rendered as a
// fading dot trail. This is purely cosmetic — no gameplay effect — but it
// telegraphs to the player that the dungeon already has scouts who know the
// way through.
//
// Subscribes to:
//   ADVENTURER_RETURNED — pulls priorPathHistory from the payload, starts a
//                         fading trail anchored to that party's leader color.
//   NIGHT_PHASE_STARTED / DAY_PHASE_STARTED — clears any active trails.
//
// The trail Graphics object lives in world space (depth 2.6, just above the
// knowledge overlay, below entities) and fades over REPLAY_GHOST_FADE_MS.

import { EventBus } from '../systems/EventBus.js'
import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class ReplayGhostRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._trails = []   // array of { g, samples, startedAt, color }

    EventBus.on('ADVENTURER_RETURNED', this._onReturn, this)
    EventBus.on('NIGHT_PHASE_STARTED', this._clearAll, this)
    EventBus.on('DAY_PHASE_STARTED',   this._clearAll, this)
  }

  destroy() {
    EventBus.off('ADVENTURER_RETURNED', this._onReturn, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._clearAll, this)
    EventBus.off('DAY_PHASE_STARTED',   this._clearAll, this)
    this._clearAll()
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  _onReturn({ adventurer, priorPathHistory }) {
    const samples = priorPathHistory ?? adventurer?.priorPathHistory ?? []
    if (samples.length === 0) return

    const g = this._scene.add.graphics().setDepth(2.6)
    const color = _hexToInt(adventurer?.classColor ?? '#9c84ff')

    this._trails.push({
      g,
      samples: samples.map(s => ({ x: s.x, y: s.y })),
      startedAt: this._scene.time.now,
      color,
    })
    this._redraw(this._trails[this._trails.length - 1], 0)
  }

  _clearAll() {
    for (const t of this._trails) t.g?.destroy()
    this._trails = []
  }

  // ── Per-frame fade ────────────────────────────────────────────────────────

  update() {
    const now = this._scene.time.now
    const FADE = Balance.REPLAY_GHOST_FADE_MS
    let i = 0
    while (i < this._trails.length) {
      const t = this._trails[i]
      const elapsed = now - t.startedAt
      if (elapsed >= FADE) {
        t.g.destroy()
        this._trails.splice(i, 1)
        continue
      }
      this._redraw(t, elapsed / FADE)
      i++
    }
  }

  _redraw(trail, fadeProgress) {
    const g = trail.g
    g.clear()
    const baseAlpha = 1 - fadeProgress
    if (baseAlpha <= 0) return

    // Connecting line — older samples lower alpha
    g.lineStyle(2, trail.color, 0.35 * baseAlpha)
    let prev = null
    for (let i = 0; i < trail.samples.length; i++) {
      const s = trail.samples[i]
      const cx = s.x * TS + TS / 2
      const cy = s.y * TS + TS / 2
      if (prev) {
        g.beginPath()
        g.moveTo(prev.cx, prev.cy)
        g.lineTo(cx, cy)
        g.strokePath()
      }
      prev = { cx, cy }
    }

    // Dots — each sample, with the most recent samples brighter
    for (let i = 0; i < trail.samples.length; i++) {
      const s = trail.samples[i]
      const cx = s.x * TS + TS / 2
      const cy = s.y * TS + TS / 2
      const ageRatio = (i + 1) / trail.samples.length   // 0..1, last dot = brightest
      const a = Math.min(1, 0.25 + 0.6 * ageRatio) * baseAlpha
      g.fillStyle(trail.color, a)
      g.fillCircle(cx, cy, 3)
    }
  }
}

function _hexToInt(hex) {
  if (typeof hex !== 'string') return 0x9c84ff
  const h = hex.startsWith('#') ? hex.slice(1) : hex
  return parseInt(h, 16) || 0x9c84ff
}

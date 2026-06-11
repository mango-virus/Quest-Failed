// HazardRenderer — persistent floor pools for minion hazard zones
// (Rust Gremlin acid trail, Broodmother web). The zones themselves live on
// `gameState.dungeon.hazards = [{ tileX, tileY, element, dmg, radius,
// expiresAt, color, sourceId }]` and are ticked / expired by
// MinionAbilities.tickHazards; this renderer just draws them.
//
// Each pool is a soft, layered disc in the zone's element colour that
// gently breathes (sine pulse) and bubbles (a few oscillating blobs), then
// fades out over its last ~800ms before expiry. There are only ever a
// handful of zones alive at once, so a single Graphics object cleared and
// redrawn each frame is cheaper and simpler than pooling per-zone sprites.
//
// Depth sits on the floor (below the entity layer at ~7) so adventurers and
// minions stand IN the pool rather than behind it — the hazard reads as
// ground they're walking through.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

// On the floor: above the dungeon floor/decor, below torches (6.5) + the
// entity layer (~7+), so creatures render in front of the pool.
const DEPTH = 3.2

const FADE_MS      = 800     // fade-out window before expiry
const PULSE_FREQ   = 360     // ms per breathe cycle
const BUBBLE_FREQ  = 520     // ms per bubble cycle
const BUBBLES      = 3

export class HazardRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs    = gameState
    this._gfx   = scene.add.graphics()
    this._gfx.setDepth(DEPTH)
  }

  destroy() {
    this._gfx?.destroy()
    this._gfx = null
  }

  update() {
    const g = this._gfx
    if (!g) return
    g.clear()
    const hazards = this._gs?.dungeon?.hazards
    if (!Array.isArray(hazards) || hazards.length === 0) return
    const now = this._scene.time?.now ?? 0

    for (const h of hazards) {
      if (!h || now >= h.expiresAt) continue
      const cx = (h.tileX + 0.5) * TS
      const cy = (h.tileY + 0.5) * TS
      const baseR = Math.max((h.radius ?? 0.7) * TS, 13) * 1.2
      const color = (typeof h.color === 'number') ? h.color : 0xff7733

      // Fade in the first 300ms, hold, fade out in the last FADE_MS.
      const remaining = h.expiresAt - now
      const fade = Math.max(0, Math.min(1, remaining / FADE_MS))
      // Per-zone phase so neighbouring pools don't breathe in lockstep.
      const phase = (h.tileX * 13 + h.tileY * 7)
      const pulse = 0.85 + 0.15 * Math.sin(now / PULSE_FREQ + phase)
      const a = fade * pulse

      // Layered soft disc — wide faint base, brighter core, bright centre.
      g.fillStyle(color, 0.16 * a)
      g.fillCircle(cx, cy, baseR)
      g.fillStyle(color, 0.26 * a)
      g.fillCircle(cx, cy, baseR * 0.66)
      g.fillStyle(color, 0.40 * a)
      g.fillCircle(cx, cy, baseR * 0.34)
      // Rim — a thin brighter outline so the pool edge reads cleanly.
      g.lineStyle(2, color, 0.5 * a)
      g.strokeCircle(cx, cy, baseR)

      // Bubbling blobs — small discs orbiting the centre, their radius
      // oscillating so the pool looks alive (acid hissing / web twitching).
      for (let i = 0; i < BUBBLES; i++) {
        const ang = phase + i * (Math.PI * 2 / BUBBLES) + now / 1400
        const orbit = baseR * 0.42
        const bx = cx + Math.cos(ang) * orbit
        const by = cy + Math.sin(ang) * orbit
        const br = (2.5 + 2.0 * Math.sin(now / BUBBLE_FREQ + i * 1.7 + phase)) * Math.max(0.4, fade)
        if (br <= 0.3) continue
        g.fillStyle(color, 0.45 * a)
        g.fillCircle(bx, by, br)
      }
    }
  }
}

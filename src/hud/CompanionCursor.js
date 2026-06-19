// CompanionCursor — DOM sparkle effects tied to a companion's flair.
// Currently only Safira mounts one (her signature chaotic-genie flair) —
// the other companions intentionally get no cursor effects, so hers stays
// distinct.
//
// Two effects, both pure DOM:
//   1. CURSOR TRAIL — on every mousemove (throttled), drop a single
//      sparkle <div> at the cursor's viewport position; CSS fades it.
//   2. PLACEMENT BURST — when any "you just placed something" event
//      (`ROOM_PLACED`, `MINION_PLACED`, `TRAP_PLACED`, …) fires, spray a
//      ring of sparkles outward from the cursor's last known position.
//      The cursor IS at the click target at placement time, so a
//      cursor-origin burst lands on the placed tile without needing
//      Phaser→DOM coordinate conversion.
//
// Both effects append to `document.body` at a max-int z-index so neither
// the Phaser canvas, the dungeon view, nor any HUD chrome can occlude
// them. Mounted by NpcCompanion when the chosen companion id matches,
// torn down when NpcCompanion does — so this lives exactly as long as
// the gameplay HUD does (never on the title screen / boss-select).

import { EventBus } from '../systems/EventBus.js'

const TRAIL_INTERVAL_MS = 70    // throttle: at most one trail sparkle per ~70ms
const TRAIL_LIFE_MS     = 700   // matches @keyframes qf-cursor-sparkle-fade
const BURST_COUNT       = 12    // particles per placement burst
const BURST_LIFE_MS     = 950   // matches @keyframes qf-cursor-burst-fade
const BURST_MIN_DIST    = 28    // px from cursor — inner radius of the ring
const BURST_MAX_DIST    = 88    // px from cursor — outer radius of the ring

// Every event that means "the player just placed something on the grid".
// All carry a payload but we only care that they fired — the burst
// origin is the cursor's last-seen position, which is the click target.
const PLACEMENT_EVENTS = [
  'ROOM_PLACED',
  'MINION_PLACED',
  'TRAP_PLACED',
  'LOCK_PLACED',
  'TREASURE_CHEST_PLACED',
  'BEACON_PLACED',
  'PHYLACTERY_PLACED',
]

export class CompanionCursor {
  constructor(opts = {}) {
    this._glyph        = opts.glyph || '✺'
    this._color        = opts.color || 'currentColor'
    this._lastSpawnAt  = 0
    this._cursorX      = -1     // sentinel: no mousemove yet — skip first burst
    this._cursorY      = -1
    this._moveHandler  = (e) => this._onMove(e)
    this._burstHandler = () => this._burstAtCursor()
    this._mounted      = false
  }

  mount() {
    if (this._mounted) return
    // pointermove on document captures every pointer move regardless of
    // which element is under the cursor — important because the dungeon
    // canvas + DOM HUD overlay every part of the viewport. (pointermove, not
    // mousemove, so a preventDefault'd drag like the volume faders — which
    // suppresses compat mouse events — doesn't freeze the trail mid-drag.)
    document.addEventListener('pointermove', this._moveHandler)
    for (const evt of PLACEMENT_EVENTS) EventBus.on(evt, this._burstHandler)
    this._mounted = true
  }

  unmount() {
    if (!this._mounted) return
    document.removeEventListener('pointermove', this._moveHandler)
    for (const evt of PLACEMENT_EVENTS) EventBus.off(evt, this._burstHandler)
    this._mounted = false
  }

  _onMove(e) {
    this._cursorX = e.clientX
    this._cursorY = e.clientY
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now()
    if (now - this._lastSpawnAt < TRAIL_INTERVAL_MS) return
    this._lastSpawnAt = now
    this._spawn(this._cursorX, this._cursorY, false)
  }

  // Ring-burst of sparkles around the cursor's last-known position. Fires
  // on every placement event while mounted. Skips silently if the cursor
  // has never moved (no mousemove yet — happens transiently at scene boot
  // before the player touches the mouse).
  _burstAtCursor() {
    if (this._cursorX < 0 || this._cursorY < 0) return
    for (let i = 0; i < BURST_COUNT; i++) {
      // Even angular spacing with a small random jitter so the ring does
      // not look mechanical, plus a per-particle radius variance.
      const angle = (Math.PI * 2 * i) / BURST_COUNT + (Math.random() - 0.5) * 0.55
      const dist  = BURST_MIN_DIST + Math.random() * (BURST_MAX_DIST - BURST_MIN_DIST)
      const dx    = Math.cos(angle) * dist
      const dy    = Math.sin(angle) * dist
      this._spawn(this._cursorX, this._cursorY, true, dx, dy)
    }
  }

  _spawn(x, y, isBurst, dx = 0, dy = 0) {
    const sp = document.createElement('div')
    sp.className = isBurst ? 'qf-cursor-sparkle qf-cursor-burst' : 'qf-cursor-sparkle'
    sp.style.left  = x + 'px'
    sp.style.top   = y + 'px'
    sp.style.color = this._color
    if (isBurst) {
      sp.style.setProperty('--burst-dx', dx + 'px')
      sp.style.setProperty('--burst-dy', dy + 'px')
    }
    sp.textContent = this._glyph
    document.body.appendChild(sp)
    setTimeout(() => { sp.remove() }, isBurst ? BURST_LIFE_MS : TRAIL_LIFE_MS)
  }
}

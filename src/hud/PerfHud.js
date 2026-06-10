// PerfHud — live per-system tick-time overlay. Toggle with Ctrl+Shift+P.
//
// Reads `window.__perfStats` (populated by Game.update's tick / rtick
// wrappers) on a 1Hz timer, then renders the top N systems by ms/sec
// plus current FPS. Tells us exactly where the frame budget is going
// during high-entity-count waves so we can stop guessing which system
// to optimise next.
//
// Mount: singleton on window.__perfHud. Survives scene transitions
// because it's attached to <body>, not #hud-stage (HudRoot tears down
// and rebuilds the stage between scenes; we want the perf HUD to
// persist across that boundary).
//
// Cost when hidden: zero — the timer is only running when visible, and
// Game's tick wrappers always accumulate (cheap two-perf.now-call cost)
// regardless of whether anyone's reading. Cost when visible: one DOM
// rebuild per second.

import { PlayerProfile } from '../systems/PlayerProfile.js'

const SAMPLE_INTERVAL_MS = 1000
const TOP_N = 12

export class PerfHud {
  constructor() {
    this._el     = null
    this._timer  = null
    this._open   = false
    this._frames = 0
    this._frameTimer = null
  }

  toggle() {
    if (this._open) this.close()
    else this.open()
  }

  open() {
    if (this._open) return
    this._open = true
    this._build()
    // FPS counter — rAF tick increments a counter, drained + reset on
    // the same 1Hz cadence as the stats panel.
    const fpsLoop = () => {
      if (!this._open) return
      this._frames++
      this._frameTimer = requestAnimationFrame(fpsLoop)
    }
    fpsLoop()
    // 1Hz sampler — read window.__perfStats, render, clear the bucket
    // so the next sample window starts fresh.
    this._timer = setInterval(() => this._sample(), SAMPLE_INTERVAL_MS)
  }

  close() {
    this._open = false
    if (this._timer) { clearInterval(this._timer); this._timer = null }
    if (this._frameTimer) { cancelAnimationFrame(this._frameTimer); this._frameTimer = null }
    this._el?.remove()
    this._el = null
  }

  _build() {
    this._el = document.createElement('div')
    this._el.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'z-index:99999',
      'background:rgba(0,0,0,0.82)', 'color:#9be39b',
      'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace',
      'padding:8px 10px', 'border:1px solid #2a5d2a',
      'border-radius:4px', 'min-width:240px',
      'pointer-events:none', 'white-space:pre',
    ].join(';')
    this._el.textContent = 'PerfHud — sampling...'
    document.body.appendChild(this._el)
  }

  _sample() {
    const stats = window.__perfStats || {}
    const counts = window.__perfCounts || {}
    const fps = this._frames
    this._frames = 0
    const entries = Object.entries(stats)
      .map(([k, ms]) => [k, ms])  // ms accumulated over the last 1s
      .filter(([, ms]) => ms > 0.05)  // hide near-zero entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
    // Clear the bucket so the next 1s window measures fresh time.
    for (const k of Object.keys(stats)) stats[k] = 0

    const aiTicks      = counts.aiTicks ?? 0
    const gameUpdates  = counts.gameUpdates ?? 0
    const tsLabel      = counts.timeScale != null ? `${counts.timeScale}x` : '?'
    const advs         = counts.advCount ?? 0
    const minions      = counts.minionCount ?? 0
    counts.aiTicks = 0
    counts.gameUpdates = 0

    const totalMs = entries.reduce((s, [, ms]) => s + ms, 0)
    // 60fps × 16.6ms/frame = ~1000ms/sec available CPU budget.
    // A system reporting >100ms/sec is eating >10% of the budget.
    const fmt = (ms) => ms.toFixed(1).padStart(6)
    const lines = [
      `PerfHud  ${fps}fps  ${totalMs.toFixed(1)}ms/s tracked`,
      `speed:${tsLabel}  advs:${advs}  minions:${minions}`,
      `AI ${aiTicks}/sec  (game ${gameUpdates}/sec)`,
      '─'.repeat(36),
      ...entries.map(([k, ms]) => `${fmt(ms)}ms  ${k}`),
    ]
    if (this._el) this._el.textContent = lines.join('\n')
  }
}

// Global key binding — Ctrl+Shift+P toggles. Installed once on import;
// idempotent (window flag check) so re-imports don't double-bind.
// Gated to the mango cheat account (debug tooling — not for real players).
if (typeof window !== 'undefined' && !window.__perfHudKeyBound) {
  window.__perfHudKeyBound = true
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      if (!PlayerProfile.isCheatName?.()) return
      e.preventDefault()
      if (!window.__perfHud) window.__perfHud = new PerfHud()
      window.__perfHud.toggle()
    }
  })
}

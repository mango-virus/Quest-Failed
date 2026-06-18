import { EventBus } from './EventBus.js'

// ScenePostFxSystem — scene-wide colour grade + vignette for the dungeon view.
// Two layers, applied to the Phaser canvas:
//   1. GRADE — a cohesive dark-fantasy look that shifts by MOOD (calm cool night
//      → warm day → hot high-contrast boss fight → desaturated death → golden
//      victory). Moods cross-fade smoothly.
//   2. VIGNETTE — gentle dark framing that tightens in boss fights / on death.
// Plus a transient brightness/contrast PULSE for big hits.
//
// ⚠ IMPLEMENTED IN CSS, NOT PHASER POSTFX (2026-06-17). This used to use the
// camera's postFX chain (ColorMatrix + Bloom + Vignette). That softened the
// dungeon: Phaser routes a postFX'd camera through an offscreen render target,
// and when the window is resized BEFORE the Game scene exists (e.g. the player
// maximises at the main menu, then starts a run) that target is the wrong size →
// the whole dungeon renders blurry, and it can't be refreshed at runtime. Bloom
// (downsampled targets) made it severe; even plain grade/vignette softened
// mildly. CSS `filter` on the <canvas> is composited by the browser at native
// display resolution — no offscreen resample — so the pixel art stays perfectly
// crisp at any size, while we keep the exact mood look. The DOM HUD sits above
// the canvas and is unaffected (it has its own crisp rendering).
//
// Bloom is dropped (Phaser's built-in blurred the base; CSS has no cheap
// bright-pass bloom). Re-introducing glow later = a custom threshold bloom shader
// rendered to a SEPARATE additive layer, never the base camera.
//
// No-ops gracefully when the `qf.gameplay.postfx` setting is 'false'. Mood reacts
// to EventBus combat/run events; listeners are torn down in destroy() (leak-safe).

function _setting(key, def) {
  try { const v = localStorage.getItem(key); return v == null ? def : v } catch { return def }
}
function _postFxEnabled() { return _setting('qf.gameplay.postfx', 'true') !== 'false' }

// Per-mood grade + vignette targets. sat/bright/contrast are deltas (0 = no
// change); hue in degrees; vig = vignette strength (0–1); vigR = vignette radius
// (smaller = tighter/darker frame). These map onto CSS:
//   saturate(1+sat) brightness(1+bright) contrast(1+contrast) hue-rotate(hue deg)
const MOODS = {
  day:     { sat: -0.10, bright: 0.05,  contrast: 0.07, hue: 0,  vig: 0.20, vigR: 0.94 },
  night:   { sat: -0.18, bright: 0.02,  contrast: 0.09, hue: -6, vig: 0.31, vigR: 0.86 },
  boss:    { sat: -0.06, bright: 0.00,  contrast: 0.19, hue: 1,  vig: 0.45, vigR: 0.77 },
  death:   { sat: -0.80, bright: -0.08, contrast: 0.05, hue: 0,  vig: 0.60, vigR: 0.70 },
  victory: { sat:  0.16, bright: 0.07,  contrast: 0.12, hue: 0,  vig: 0.20, vigR: 0.98 },
}
const KEYS = ['sat', 'bright', 'contrast', 'hue', 'vig', 'vigR']

export class ScenePostFxSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._enabled = false
    this._mood = 'day'
    this._cur = { ...MOODS.day }
    this._target = { ...MOODS.day }
    this._pulse = 0
    this._dirty = true
    this._canvas = null   // the Phaser <canvas> we grade via CSS filter
    this._vigEl = null    // the vignette overlay div (over canvas, under HUD)
    this._listeners = []

    if (_postFxEnabled()) this.enable()
    this._wireEvents()
  }

  enable() {
    if (this._enabled) return
    const canvas = this._scene.sys?.game?.canvas
    if (!canvas) return
    this._canvas = canvas
    try {
      // Vignette: a non-interactive overlay that fills the canvas's container, so
      // it sits OVER the dungeon canvas but UNDER the DOM HUD (#hud-root). Pure
      // CSS radial-gradient — no canvas resample, stays crisp.
      const host = canvas.parentNode || document.body
      const el = document.createElement('div')
      el.className = 'qf-scene-vignette'
      el.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;mix-blend-mode:normal;'
      host.appendChild(el)
      this._vigEl = el
      this._enabled = true
      this._dirty = true
      this._apply()
    } catch (e) { this._enabled = false }
  }

  disable() {
    if (!this._enabled) return
    try { if (this._canvas) this._canvas.style.filter = '' } catch (e) {}
    try { if (this._vigEl?.parentNode) this._vigEl.parentNode.removeChild(this._vigEl) } catch (e) {}
    this._vigEl = null
    this._enabled = false
  }

  // Cross-fade to a named mood. instant=true snaps (e.g. on a hard scene cut).
  setMood(mood, instant = false) {
    const m = MOODS[mood]
    if (!m) return
    this._mood = mood
    this._target = { ...m }
    if (instant) { this._cur = { ...m }; this._dirty = true }
  }

  // Transient impact punch — brief brightness/contrast flash. strength ~0.5–1.5.
  pulse(strength = 1) { this._pulse = Math.min(2, this._pulse + strength); this._dirty = true }

  update(delta) {
    if (!this._enabled) return
    const dt = delta || 16
    // Ease current grade toward target (~220ms feel).
    let moving = false
    const t = Math.min(1, dt / 220)
    for (const k of KEYS) {
      const d = this._target[k] - this._cur[k]
      if (Math.abs(d) > 1e-4) { this._cur[k] += d * t; moving = true }
      else this._cur[k] = this._target[k]
    }
    if (this._pulse > 0) { this._pulse = Math.max(0, this._pulse - dt / 200); moving = true }
    if (moving || this._dirty) this._apply()
  }

  _apply() {
    this._dirty = false
    const p = this._cur
    // GRADE → CSS filter on the canvas (composited at native res → crisp). A pulse
    // adds a brief brightness/contrast punch.
    if (this._canvas) {
      const sat      = Math.max(0, 1 + p.sat)
      const bright   = Math.max(0, 1 + p.bright + this._pulse * 0.10)
      const contrast = Math.max(0, 1 + p.contrast + this._pulse * 0.08)
      this._canvas.style.filter =
        `saturate(${sat.toFixed(3)}) brightness(${bright.toFixed(3)}) contrast(${contrast.toFixed(3)}) hue-rotate(${p.hue.toFixed(1)}deg)`
    }
    // VIGNETTE → radial-gradient overlay. vigR sets where darkening begins (as a %
    // of the radius from centre); vig sets how dark the frame gets.
    if (this._vigEl) {
      const inner = Math.round(Math.max(0, Math.min(1, p.vigR)) * 100)
      const strength = Math.max(0, Math.min(1, p.vig + this._pulse * 0.05))
      this._vigEl.style.background =
        `radial-gradient(ellipse 74% 74% at 50% 50%, rgba(0,0,0,0) ${inner}%, rgba(0,0,0,${strength.toFixed(3)}) 116%)`
    }
  }

  _on(evt, fn) { EventBus.on(evt, fn); this._listeners.push([evt, fn]) }

  _wireEvents() {
    this._on('NIGHT_PHASE_STARTED', () => this.setMood('night'))
    this._on('NIGHT_PHASE_ENDED',   () => this.setMood('day'))
    this._on('BOSS_FIGHT_STARTED',  () => this.setMood('boss'))
    this._on('BOSS_FIGHT_RESOLVED', () => { if (this._mood === 'boss') this.setMood(this._isNight() ? 'night' : 'day') })
    this._on('BOSS_DEFEATED_FINAL', () => this.setMood('death'))
    this._on('RUN_VICTORY',         () => this.setMood('victory'))
  }

  _isNight() { return this._gameState?.meta?.phase === 'night' }

  destroy() {
    for (const [evt, fn] of this._listeners) { try { EventBus.off(evt, fn) } catch (e) {} }
    this._listeners = []
    this.disable()
  }
}

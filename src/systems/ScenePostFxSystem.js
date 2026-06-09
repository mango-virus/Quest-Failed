import { EventBus } from './EventBus.js'

// ScenePostFxSystem — VFX Frontier #1: a scene-wide post-processing pipeline on
// the Game camera (the dungeon view). Three layers, composed on the main camera's
// postFX chain:
//   1. ColorMatrix GRADE — a cohesive dark-fantasy look that shifts by MOOD
//      (calm cool night → warm day → hot high-contrast boss fight → desaturated
//      death → golden victory). Moods cross-fade smoothly.
//   2. BLOOM — soft scene bloom so torches, fire, holy beams + every additive
//      VFX glow blooms naturally instead of reading flat.
//   3. VIGNETTE — gentle dark framing that tightens in boss fights / on death.
// Plus a transient BARREL+bloom PULSE for big hits (impact lens-warp).
//
// Only the Phaser canvas (dungeon) is affected — the DOM HUD sits above the
// canvas and stays crisp, which is exactly what we want (grade the world, keep
// the UI sharp).
//
// WebGL-only (postFX needs the GPU); no-ops gracefully on Canvas + when the
// `qf.gameplay.postfx` setting is 'false'. Mood reacts to EventBus combat/run
// events. EventBus listeners are torn down in destroy() (leak-safe).
//
// ⚠ TUNING (2026-06-05): the MOOD numbers below are conservative STARTING values
// chosen blind (preview screenshots were wedged). They want a visual pass —
// live-tune every param with __qfDev.postfx(...) then bake the winners here.

function _setting(key, def) {
  try { const v = localStorage.getItem(key); return v == null ? def : v } catch { return def }
}
function _postFxEnabled() { return _setting('qf.gameplay.postfx', 'true') !== 'false' }

// Per-mood grade + bloom + vignette targets. sat/bright/contrast are ColorMatrix
// deltas (0 = identity); hue in degrees; bloom strength/blur; bloomColor tints
// the glow; vig strength + radius (smaller radius = tighter dark frame).
const MOODS = {
  day:     { sat: -0.10, bright: 0.02,  contrast: 0.08, hue: 0,  bloom: 0.55, bloomBlur: 0.9, bloomColor: 0xfff0d8, vig: 0.26, vigR: 0.92 },
  night:   { sat: -0.18, bright: -0.02, contrast: 0.10, hue: -6, bloom: 0.50, bloomBlur: 1.0, bloomColor: 0xbcd0ff, vig: 0.38, vigR: 0.82 },
  boss:    { sat:  0.06, bright: 0.00,  contrast: 0.16, hue: 4,  bloom: 0.85, bloomBlur: 1.1, bloomColor: 0xffc69a, vig: 0.48, vigR: 0.76 },
  death:   { sat: -0.80, bright: -0.08, contrast: 0.05, hue: 0,  bloom: 0.30, bloomBlur: 0.8, bloomColor: 0x99a0b0, vig: 0.60, vigR: 0.70 },
  victory: { sat:  0.16, bright: 0.07,  contrast: 0.12, hue: 0,  bloom: 1.05, bloomBlur: 1.2, bloomColor: 0xffe9a8, vig: 0.20, vigR: 0.98 },
}
const KEYS = ['sat', 'bright', 'contrast', 'hue', 'bloom', 'bloomBlur', 'vig', 'vigR']

export class ScenePostFxSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._cam = scene.cameras?.main ?? null
    this._enabled = false
    this._mood = 'day'
    this._cur = { ...MOODS.day }
    this._target = { ...MOODS.day }
    this._pulse = 0
    this._dirty = true
    this._fx = { grade: null, bloom: null, vignette: null, barrel: null }
    this._listeners = []

    if (this._cam?.postFX && this._scene.sys?.game?.renderer?.type === 2 && _postFxEnabled()) {
      this.enable()
    }
    this._wireEvents()
  }

  enable() {
    if (this._enabled || !this._cam?.postFX) return
    try {
      // Order = render order. Grade first (recolour), then bloom (glow the graded
      // image), then vignette (frame), then barrel (lens — usually 0).
      this._fx.grade    = this._cam.postFX.addColorMatrix()
      this._fx.bloom    = this._cam.postFX.addBloom(0xffffff, 1, 1, this._cur.bloomBlur, this._cur.bloom, 4)
      this._fx.vignette = this._cam.postFX.addVignette(0.5, 0.5, this._cur.vigR, this._cur.vig)
      this._fx.barrel   = this._cam.postFX.addBarrel(0)
      this._enabled = true
      this._dirty = true
      this._apply()
    } catch (e) { this._enabled = false }
  }

  disable() {
    if (!this._enabled) return
    try { this._cam.postFX.clear() } catch (e) {}
    this._fx = { grade: null, bloom: null, vignette: null, barrel: null }
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

  // Transient impact punch — brief barrel lens-warp + bloom bump. strength ~0.5–1.5.
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
    const cm = this._fx.grade
    if (cm) {
      cm.reset()
      if (p.sat)      cm.saturate(p.sat, true)
      if (p.bright)   cm.brightness(1 + p.bright, true)
      if (p.contrast) cm.contrast(p.contrast, true)
      if (p.hue)      cm.hue(p.hue, true)
    }
    if (this._fx.bloom) {
      this._fx.bloom.strength     = Math.max(0, p.bloom + this._pulse * 0.5)
      this._fx.bloom.blurStrength = p.bloomBlur
      try { this._fx.bloom.color = p.bloomColor } catch (e) {}
    }
    if (this._fx.vignette) {
      this._fx.vignette.strength = p.vig
      this._fx.vignette.radius   = p.vigR
    }
    if (this._fx.barrel) {
      // subtle lens-warp only while a pulse is decaying
      this._fx.barrel.amount = 1 + this._pulse * 0.06
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

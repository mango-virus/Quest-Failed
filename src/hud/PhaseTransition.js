// PhaseTransition — ~2.4s phase-change cinematic (design port, hud-transition.jsx).
//
// Subscribes to `DAY_PHASE_BEGAN` / `NIGHT_PHASE_BEGAN`. Mounts a
// fullscreen overlay that plays the design's beat:
//   * a VEIL that wipes across to cover (clip-path sweep), day/night tinted
//   * a sweeping BAND of light/dark across the horizon
//   * expanding glow RAYS from center
//   * a PLATE: eyebrow ("⸺ The gates open ⸺" / "⸺ The dungeon stirs ⸺"),
//     a slammed-in DAY/NIGHT {n} stamp (scale + blur cleanup), and a
//     sub-line ("THE INVASION BEGINS" / "FORTIFY THE DEEP")
//   * (day only) an INCOMING ROSTER ribbon of adventurer sprite tiles
//   then the whole root fades out.
//
// Replaced the older bespoke sun/moon + speed-line + letterbox version
// (2026-06-15) so the in-game transition matches the design.
//
// Blocks input via pointer-events: auto on the full overlay so the
// player can't click through. Auto-dismisses after TRANSITION_MS.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const TRANSITION_MS = 2400

// Incoming-roster showcase classes (design's fixed five). Framed to a clean
// LPC standing pose: 64px frames on an 832×1856 sheet, row 10 col 0 — the same
// shield-forward stance the design's hud-stage AdvFrame uses. Tile is 56px, so
// scale = 56/64 = 0.875 → sheet 728×1624, row-10 offset = -(10·64·0.875) = -560px.
const ROSTER = ['knight', 'cleric', 'mage', 'rogue', 'ranger']

export class PhaseTransition {
  constructor(gameState) {
    this._gameState = gameState
    this._el = null
    this._timer = null
    this._listeners = []
    const sub = (event, fn) => { EventBus.on(event, fn); this._listeners.push([event, fn]) }
    sub('DAY_PHASE_BEGAN',   () => this.fire('day'))
    sub('NIGHT_PHASE_BEGAN', () => this.fire('night'))
  }

  fire(to) {
    // Cancel any in-flight transition before starting a new one.
    if (this._el) this._dismiss()
    const day = this._gameState.meta?.dayNumber ?? 1
    this._activePhase = to
    this._el = this._render(to, day)
    // Mount on document.body (not #hud-stage) so the cinematic covers
    // the entire viewport. #hud-stage is the 1920×1080 logical stage
    // that transform-scales to FIT the viewport — on non-16:9 windows
    // the stage doesn't cover the full screen and the cinematic would
    // letterbox along with it (black bars top/bottom or left/right).
    // The cinematic is a screen-wide visual beat — it should overlap
    // even the letterbox.
    document.body.appendChild(this._el)
    this._timer = setTimeout(() => this._dismiss(), TRANSITION_MS)
  }

  _dismiss() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null }
    const finishedPhase = this._activePhase
    this._activePhase = null
    this._el?.remove()
    this._el = null
    // Signal completion so listeners (DayPhase's adventurer spawner,
    // TutorialSystem's welcome popup gating, etc.) can run AFTER the
    // 2.8s cinematic instead of underneath it.
    if (finishedPhase) {
      EventBus.emit('PHASE_TRANSITION_FINISHED', { phase: finishedPhase })
    }
  }

  _render(to, day) {
    const isDay = to === 'day'
    return h('div', {
      className: `pt-root ${isDay ? 'to-day' : 'to-night'}`,
    }, [
      // Veil wipes across to cover; band sweeps the horizon; rays bloom.
      h('div', { className: 'pt-veil' }),
      h('div', { className: 'pt-rays' }),
      h('div', { className: 'pt-band' }),
      // Plate — eyebrow + slammed-in DAY/NIGHT stamp + sub-line.
      h('div', { className: 'pt-plate' }, [
        h('div', { className: 'sil pt-eye' },
          isDay ? '⸺  The gates open  ⸺' : '⸺  The dungeon stirs  ⸺'),
        h('div', { className: 'pix pt-stamp' }, `${isDay ? 'DAY' : 'NIGHT'} ${day}`),
        h('div', { className: 'pix pt-sub' },
          isDay ? 'THE INVASION BEGINS' : 'FORTIFY THE DEEP'),
      ]),
      // Incoming roster ribbon — day only.
      isDay && h('div', { className: 'pt-roster' },
        ROSTER.map(s => h('div', {
          className: 'pt-rtile',
          style: {
            backgroundImage: `url('assets/sprites/adventurers/${s}/v01.png')`,
            backgroundSize: '728px 1624px',
            backgroundPosition: '0 -560px',
          },
        }))
      ),
    ].filter(Boolean))
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this._dismiss()
  }
}

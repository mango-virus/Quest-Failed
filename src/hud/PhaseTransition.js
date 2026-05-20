// PhaseTransition — 2.8s cinematic that runs on phase change.
//
// Subscribes to `DAY_PHASE_BEGAN` / `NIGHT_PHASE_BEGAN`. Mounts a
// fullscreen overlay with:
//   * radial bg + vertical light shaft
//   * 18 radial speed lines streaking outward from center
//   * massive boss silhouette behind the title
//   * "◇ ◇ ◇ DAWN BREAKS ◇ ◇ ◇" eyebrow (or NIGHT FALLS)
//   * DAY {NN} title with corner brackets, blur-cleanup slam
//   * "THE INVASION" / "THE BUILD" subtitle
//   * italic flavor line
//   * letterbox bars sliding in top + bottom
//   * brief screen shake on title impact
//
// Blocks input via pointer-events: auto on the full overlay so the
// player can't click through. Auto-dismisses after 2800ms.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const TRANSITION_MS = 2800

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
    const accent = isDay ? 'var(--gold-bright)' : 'var(--rumor)'
    const titleColor = accent
    const titleShadow = isDay
      ? '5px 5px 0 #4a1810, 0 0 60px rgba(255,203,92,0.6), 0 0 100px rgba(255,128,30,0.4)'
      : '5px 5px 0 #08182a, 0 0 60px rgba(92,200,216,0.6), 0 0 100px rgba(92,200,216,0.3)'
    const subShadow = isDay
      ? '3px 3px 0 var(--blood-deep), 0 0 24px rgba(255,68,88,0.5)'
      : '3px 3px 0 #0a0a1a, 0 0 24px rgba(92,200,216,0.4)'

    return h('div', {
      className: `phase-transition ${isDay ? 'day' : 'night'}`,
    }, [
      // Vertical light shaft
      h('div', {
        className: 'pt-shaft',
        style: {
          background: isDay
            ? 'linear-gradient(90deg, transparent, rgba(255,180,80,0.18), transparent)'
            : 'linear-gradient(90deg, transparent, rgba(92,200,216,0.16), transparent)',
        },
      }),
      // Background motif — DAY gets a glowing sun disc with radial
      // rays; NIGHT gets a pale glowing moon disc with a crescent
      // shadow. Two clear celestial bodies so the day/night beats read
      // distinctly.
      isDay
        ? h('div', { className: 'pt-day-bg' }, [
            // Sun disc — the day-phase counterpart to the night moon.
            h('div', { className: 'pt-sun' }),
            // Radial streaks read as the sun's rays radiating outward.
            h('div', { className: 'pt-streaks' },
              Array.from({ length: 18 }, (_, i) => h('div', {
                className: 'pt-streak',
                style: {
                  '--a': `${i / 18 * 360}deg`,
                  transform: `translate(-50%, 0) rotate(${i / 18 * 360}deg)`,
                  background: 'linear-gradient(180deg, transparent 0%, rgba(255,180,80,0.25) 60%, transparent 100%)',
                  animationDelay: `${i * 30}ms`,
                },
              }))
            ),
          ])
        : h('div', { className: 'pt-moon' }, [
            // Inner crescent — a smaller dark disc offset to one side,
            // covers part of the main moon to give it a crescent feel.
            h('div', { className: 'pt-moon-crescent' }),
          ]),
      // Center card
      h('div', { className: 'pt-card' }, [
        h('div', { className: 'pix pt-eyebrow' },
          `◇ ◇ ◇  ${isDay ? 'DAWN BREAKS' : 'NIGHT FALLS'}  ◇ ◇ ◇`),
        h('div', { className: 'pt-title-wrap' }, [
          ...['tl','tr','bl','br'].map(c => h('div', {
            className: `pt-bracket pt-bracket-${c}`,
            style: {
              borderTopColor:    c[0] === 't' ? accent : 'transparent',
              borderBottomColor: c[0] === 'b' ? accent : 'transparent',
              borderLeftColor:   c[1] === 'l' ? accent : 'transparent',
              borderRightColor:  c[1] === 'r' ? accent : 'transparent',
              boxShadow: isDay
                ? '0 0 16px rgba(255,203,92,0.6)'
                : '0 0 16px rgba(92,200,216,0.5)',
            },
          })),
          h('div', {
            className: 'pix pt-title',
            style: { color: titleColor, textShadow: titleShadow },
          // Title reads "DAY NN" when transitioning to day, "NIGHT NN"
          // when transitioning to night. Previously was hard-coded to
          // "DAY" regardless of the cinematic's direction.
          // Day/Night number is now displayed as a plain integer (NIGHT 1,
          // DAY 12) instead of zero-padded (NIGHT 01, DAY 12). The padded
          // form read as a date stamp; the bare number feels more like
          // a chapter marker.
          }, `${isDay ? 'DAY' : 'NIGHT'} ${day}`),
        ]),
        h('div', {
          className: 'pix pt-sub',
          style: { color: isDay ? '#fff' : 'var(--text)', textShadow: subShadow },
        }, isDay ? 'THE INVASION' : 'THE BUILD'),
        h('div', { className: 'pt-flavor' },
          isDay
            ? '"Let them bring their torches. We shall return them as ash."'
            : '"The night belongs to us. Reshape the bone-halls."'
        ),
      ]),
      // Letterbox bars removed at user request — the cinematic now
      // covers the full viewport edge-to-edge instead of slamming in
      // 90px black bars at the top + bottom. (`.pt-letterbox` CSS
      // remains in styles.css per the codebase's removal-not-deletion
      // policy in case we ever want to re-enable.)
    ])
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this._dismiss()
  }
}

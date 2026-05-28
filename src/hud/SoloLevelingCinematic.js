// SoloLevelingCinematic (DOM) — the Shadow Monarch's theatrics.
//
// Two pieces, both pure presentation (gameplay lives in EventSystem /
// BossSystem / DayPhase):
//
//   1. ENTRANCE — a full-screen title card when Sung Jinwoo arrives
//      (SOLO_LEVELING_BEGAN): dim → "◆ SOLO LEVELING ◆" → "THE SHADOW
//      MONARCH" → a slamming "ARISE." Auto-dismisses (or click to skip),
//      then hands the screen back so the player can watch him march in.
//
//   2. VIGNETTE — a persistent dark-violet edge shadow that lingers the
//      whole time the Monarch is in the dungeon, lifted when he dies /
//      flees / the day ends.
//
// The VS card + extraction "ARISE" pop are Phase 3b.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

export class SoloLevelingCinematic {
  constructor() {
    this._stage = document.getElementById('hud-stage')
    this._listeners = []
    this._timers = []
    this._el = null         // entrance overlay
    this._vignette = null   // persistent edge shadow
    if (!this._stage) return
    this._wire()
  }

  _wire() {
    const sub = (evt, fn) => { EventBus.on(evt, fn); this._listeners.push([evt, fn]) }
    sub('SOLO_LEVELING_BEGAN', () => this._onBegan())
    // Lift the vignette (and tear down any lingering card) the moment the
    // Monarch is gone, or at day end as a catch-all.
    sub('ADVENTURER_DIED', (p) => { if (p?.adventurer?._shadowMonarch) this._end() })
    sub('ADVENTURER_FLED', (p) => { if (p?.adventurer?._shadowMonarch) this._end() })
    sub('DAY_PHASE_ENDED', () => this._end())
  }

  _onBegan() {
    this._startVignette()
    this._playEntrance()
  }

  // ── Persistent vignette ────────────────────────────────────────────────
  _startVignette() {
    if (this._vignette) return
    this._vignette = h('div', { className: 'qf-sl-vignette' })
    this._stage.appendChild(this._vignette)
    // Force reflow so the fade-in transition runs.
    // eslint-disable-next-line no-unused-expressions
    this._vignette.offsetHeight
    this._vignette.classList.add('show')
  }

  _end() {
    this._clearTimers()
    if (this._el) { this._el.remove(); this._el = null }
    if (this._vignette) {
      const v = this._vignette
      this._vignette = null
      v.classList.remove('show')
      setTimeout(() => v.remove(), 600)
    }
  }

  // ── Entrance title card ──────────────────────────────────────────────────
  _playEntrance() {
    if (this._el) this._el.remove()
    this._kicker = h('div', { className: 'qf-sl-kicker' }, '◆  SOLO LEVELING  ◆')
    this._title  = h('div', { className: 'qf-sl-title' }, 'THE SHADOW MONARCH')
    this._arise  = h('div', { className: 'qf-sl-arise' }, 'ARISE.')
    this._el = h('div', { className: 'qf-sl-entrance' }, [
      h('div', { className: 'qf-sl-dim' }),
      h('div', { className: 'qf-sl-tendrils' }),
      h('div', { className: 'qf-sl-stack' }, [this._kicker, this._title, this._arise]),
    ])
    // Click anywhere to skip the rest of the sequence.
    this._el.addEventListener('click', () => this._dismissEntrance())
    this._stage.appendChild(this._el)
    // eslint-disable-next-line no-unused-expressions
    this._el.offsetHeight
    this._el.classList.add('show')

    // Staged reveal — each beat adds a class that triggers its CSS anim.
    this._after(280,  () => this._kicker?.classList.add('in'))
    this._after(900,  () => this._title?.classList.add('in'))
    this._after(1700, () => { this._arise?.classList.add('in'); this._flash() })
    this._after(3600, () => this._dismissEntrance())
  }

  _flash() {
    if (!this._el) return
    this._el.classList.add('flash')
    this._after(420, () => this._el?.classList.remove('flash'))
  }

  _dismissEntrance() {
    if (!this._el) return
    const el = this._el
    this._el = null
    el.classList.add('closing')
    setTimeout(() => el.remove(), 480)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  _after(ms, fn) {
    const id = setTimeout(fn, ms)
    this._timers.push(id)
    return id
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id)
    this._timers = []
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._clearTimers()
    this._el?.remove(); this._el = null
    this._vignette?.remove(); this._vignette = null
  }
}

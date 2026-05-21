// EventFx — ambient dungeon-wide weather/atmosphere for active Dungeon
// Events. A single full-view overlay (mounted in #hud-stage at z-index 6,
// between the dungeon canvas + DungeonFx ambient and the HUD chrome).
//
// Driven by the event lifecycle:
//   DUNGEON_EVENT_BEGAN { def }  → apply the event's FX preset
//   DUNGEON_EVENT_ENDED          → clear
// A save loaded mid-day restores the preset from `_eventFlags`.
//
// Each preset is a combination of: a colour wash, an edge vignette,
// drifting blobs (storm clouds / fog), a looping particle stream, an
// optional signature element (blood moon), and — for the Arcane Storm —
// periodic lightning (screen flash + a light camera shake).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

// id → { cssClass, particle kind, particle count, lightning }
const PRESETS = {
  arcane_storm:       { css: 'fx-arcane',     particle: 'spark',   count: 11, lightning: true },
  miasma:             { css: 'fx-miasma',     particle: 'rise',    count: 16 },
  blood_moon_eclipse: { css: 'fx-bloodmoon',  particle: 'fall',    count: 11 },
  dense_fog:          { css: 'fx-fog',        particle: null,      count: 0  },
  dungeon_pestilence: { css: 'fx-pestilence', particle: 'rise',    count: 13 },
  tremors:            { css: 'fx-tremors',    particle: 'fall',    count: 13 },
  twitch_con:         { css: 'fx-twitch',     particle: 'fall',    count: 15 },
  patrons_blessing:   { css: 'fx-patron',     particle: 'shimmer', count: 11 },
}

// id → the `_eventFlags` boolean set while the event is live (used to
// restore the FX after a mid-day save/load).
const FLAG_BY_ID = {
  arcane_storm:       'arcaneStormActive',
  miasma:             'miasmaActive',
  blood_moon_eclipse: 'bloodMoonEclipseActive',
  dense_fog:          'denseFogActive',
  dungeon_pestilence: 'pestilenceActive',
  tremors:            'tremorsActive',
  twitch_con:         'twitchConActive',
  patrons_blessing:   'patronsBlessingActive',
}

export class EventFx {
  constructor(gameState) {
    this._gameState = gameState ?? null
    this._listeners = []
    this._particles = []
    this._lightningTimer = null
    this._activeId = null

    this._stage = document.getElementById('hud-stage')
    if (!this._stage) return
    this._build()
    this._wire()
    this._restore()
  }

  _build() {
    this._wash      = h('div', { className: 'qf-eventfx-wash' })
    this._vignette  = h('div', { className: 'qf-eventfx-vignette' })
    this._drift     = h('div', { className: 'qf-eventfx-drift' }, [
      h('div', { className: 'qf-eventfx-blob' }),
      h('div', { className: 'qf-eventfx-blob' }),
      h('div', { className: 'qf-eventfx-blob' }),
    ])
    this._moon      = h('div', { className: 'qf-eventfx-moon' })
    this._particleLayer = h('div', { className: 'qf-eventfx-particles' })
    this._flash     = h('div', { className: 'qf-eventfx-flash' })
    this.el = h('div', { className: 'qf-eventfx' }, [
      this._wash, this._vignette, this._drift, this._moon,
      this._particleLayer, this._flash,
    ])
    this._stage.appendChild(this.el)
  }

  _wire() {
    const sub = (evt, fn) => { EventBus.on(evt, fn); this._listeners.push([evt, fn]) }
    sub('DUNGEON_EVENT_BEGAN', (p) => this._start(p?.def?.id))
    sub('DUNGEON_EVENT_ENDED', ()  => this._stop())
  }

  // Mid-day save/load — re-apply the preset for whatever event flag is set.
  _restore() {
    const flags = this._gameState?._eventFlags ?? {}
    for (const id of Object.keys(FLAG_BY_ID)) {
      if (flags[FLAG_BY_ID[id]]) { this._start(id); return }
    }
  }

  _start(id) {
    this._stop()
    const preset = PRESETS[id]
    if (!preset || !this.el) return
    this._activeId = id
    this.el.className = `qf-eventfx active ${preset.css}`
    this._spawnParticles(preset.particle, preset.count)
    if (preset.lightning) this._scheduleLightning()
  }

  _stop() {
    this._activeId = null
    if (this.el) this.el.className = 'qf-eventfx'
    this._clearParticles()
    if (this._lightningTimer) { clearTimeout(this._lightningTimer); this._lightningTimer = null }
    this._flash?.classList.remove('striking')
  }

  _spawnParticles(kind, count) {
    if (!kind || count <= 0 || !this._particleLayer) return
    for (let i = 0; i < count; i++) {
      const p = h('div', { className: `qf-eventfx-particle qf-p-${kind}` })
      const dur = 4 + Math.random() * 5            // 4–9s loop
      p.style.left = `${Math.random() * 100}%`
      p.style.setProperty('--sz', `${3 + Math.random() * 5}px`)
      p.style.animationDuration = `${dur}s`
      // Negative delay → particles start mid-cycle, not all bunched up.
      p.style.animationDelay = `${-Math.random() * dur}s`
      if (kind === 'spark') p.style.top = `${Math.random() * 100}%`
      this._particleLayer.appendChild(p)
      this._particles.push(p)
    }
  }

  _clearParticles() {
    for (const p of this._particles) p.remove()
    this._particles = []
  }

  // ── Arcane Storm lightning ─────────────────────────────────────────────
  _scheduleLightning() {
    const delay = 4800 + Math.random() * 3400   // ~5–8s between strikes
    this._lightningTimer = setTimeout(() => {
      this._strikeLightning()
      if (this._activeId === 'arcane_storm') this._scheduleLightning()
    }, delay)
  }

  _strikeLightning() {
    if (!this._flash) return
    // Re-trigger the keyframe by removing + forcing a reflow.
    this._flash.classList.remove('striking')
    // eslint-disable-next-line no-unused-expressions
    this._flash.offsetWidth
    this._flash.classList.add('striking')
    // A light camera shake on the dungeon view sells the thunderclap.
    try {
      window.__game?.scene?.getScene?.('Game')?.cameras?.main?.shake?.(240, 0.006)
    } catch { /* camera not available — flash alone is fine */ }
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._stop()
    this.el?.remove()
    this.el = null
  }
}

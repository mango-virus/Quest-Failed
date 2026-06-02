// DevEventsButton — mango-only floating dev button for force-firing
// dungeon events. Restores the old "trigger event" dev affordance that
// shipped before the HUD rewrite.
//
// Visible only when `PlayerProfile.isCheatName()` (player name === 'mango').
// Self-mounts a small button in the bottom-left of #hud-stage. Clicking
// it opens a modal listing every event from events.json as a card grid.
// Clicking an event card fires `DEV_FORCE_EVENT { eventId }`; EventSystem
// then tears down any in-progress event and immediately schedules +
// applies the picked one (see EventSystem._onDevForceEvent).
//
// Mango-only by design — leaks to real players are unwanted (the
// button name + style flag it clearly as a developer surface).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'

export class DevEventsButton {
  constructor() {
    this._btn      = null
    this._modal    = null
    this._escFn    = null
    // Mango gate — bail before mounting anything if the player isn't on
    // the dev account. Re-construct on name change is handled by the
    // HudRoot which rebuilds on cheat-state changes (or just doesn't —
    // the button never appearing is the correct behaviour for a normal
    // run).
    if (!PlayerProfile.isCheatName?.()) return
    this._mount()
  }

  destroy() {
    this._closeModal()
    this._btn?.remove()
    this._btn = null
  }

  _mount() {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    this._btn = h('button', {
      className: 'qf-dev-events-btn',
      title: 'Mango dev — force the next dungeon event to fire',
      on: { click: () => this._openModal() },
    }, 'TEST EVENT')
    stage.appendChild(this._btn)
  }

  _openModal() {
    if (this._modal) return
    // Pull events.json from any active Phaser scene's JSON cache. The
    // dev button doesn't carry its own gameState, so look up the live
    // game instance.
    const events = (window.__game?.scene?.scenes ?? [])
      .map(s => s?.cache?.json?.get?.('events'))
      .find(Array.isArray) ?? []
    if (events.length === 0) return

    const stage = document.getElementById('hud-stage') ?? document.body
    const cards = events.map(def => h('button', {
      className: 'qf-dev-events-card',
      on: { click: () => this._pick(def.id) },
    }, [
      h('div', { className: 'qf-dev-events-card-icon' }, def.icon || '◆'),
      h('div', { className: 'qf-dev-events-card-name pix' }, def.title || def.id),
      h('div', { className: 'qf-dev-events-card-id' }, def.id),
    ]))

    // Aldric Act IV climax-duel triggers — force-spawn the crowned Hero King in
    // duel mode right now (radiant or desperate form) so the climax cinematic
    // can be watched without grinding to day 40. Routed to DayPhase via
    // DEV_FORCE_ALDRIC_DUEL; only fires meaningfully during a day phase.
    const duelCard = (form, label, icon) => h('button', {
      className: 'qf-dev-events-card',
      on: { click: () => this._pickDuel(form) },
    }, [
      h('div', { className: 'qf-dev-events-card-icon' }, icon),
      h('div', { className: 'qf-dev-events-card-name pix' }, label),
      h('div', { className: 'qf-dev-events-card-id' }, `aldric_duel · ${form}`),
    ])

    this._modal = h('div', {
      className: 'qf-dev-events-modal',
      on: {
        click: (e) => { if (e.target === e.currentTarget) this._closeModal() },
      },
    }, [
      h('div', { className: 'qf-dev-events-card-wrap' }, [
        h('div', { className: 'qf-dev-events-title pix' }, 'TEST EVENT  ·  MANGO ONLY'),
        h('div', { className: 'qf-dev-events-flavor pix' },
          'Click an event to force it as the next scheduled event ' +
          '(bypasses the 3-day cadence and eligibility filter). Clears ' +
          'any in-progress event first.'),
        h('div', { className: 'qf-dev-events-grid' }, [
          duelCard('radiant',   'ALDRIC DUEL · RADIANT',   '♔'),
          duelCard('desperate', 'ALDRIC DUEL · DESPERATE', '♛'),
        ]),
        h('div', { className: 'qf-dev-events-grid' }, cards),
        h('div', { className: 'qf-dev-events-close pix',
          on: { click: () => this._closeModal() },
        }, 'CLOSE'),
      ]),
    ])
    stage.appendChild(this._modal)

    this._escFn = (e) => { if (e.key === 'Escape') this._closeModal() }
    window.addEventListener('keydown', this._escFn)
  }

  _pick(eventId) {
    if (!eventId) return
    EventBus.emit('DEV_FORCE_EVENT', { eventId })
    this._closeModal()
  }

  _pickDuel(form) {
    EventBus.emit('DEV_FORCE_ALDRIC_DUEL', { form })
    this._closeModal()
  }

  _closeModal() {
    if (this._escFn) {
      window.removeEventListener('keydown', this._escFn)
      this._escFn = null
    }
    if (this._modal) {
      this._modal.remove()
      this._modal = null
    }
  }
}

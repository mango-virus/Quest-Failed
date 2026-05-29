// ReviveChoicePopup — shown when the player taps REVIVE but can't afford to
// bring back EVERY fallen minion. Lets them pick which way to spend what gold
// they have: the STRONGEST few, or the MOST minions. Reuses the shared
// `.qf-eventconfirm` event-slate styling (corner brackets) — it just needs a
// third button, which the generic two-button ConfirmPopup can't express
// (mapping "cancel" to an action is unsafe: backdrop-click / Esc also fire it).
//
// Subscribes to `SHOW_REVIVE_CHOICE` with payload:
//   { fallenCount, totalCost, have,
//     strongest: { count, cost }, quantity: { count, cost },
//     onPick(mode), onCancel? }
// where mode is 'strongest' | 'quantity'. Backdrop-click / Esc = cancel.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

export class ReviveChoicePopup {
  constructor() {
    this._el       = null
    this._escFn    = null
    this._payload  = null
    this._resolved = false
    this._listener = (payload) => this.showFor(payload)
    EventBus.on('SHOW_REVIVE_CHOICE', this._listener)
  }

  showFor(payload) {
    // Only one open at a time — treat a replaced prompt as cancelled.
    if (this._el) { this._resolveAs('cancel'); this._closeAll() }
    this._payload  = payload ?? {}
    this._resolved = false
    this._showCard()
  }

  _showCard() {
    const p = this._payload
    const strongest = p.strongest ?? { count: 0, cost: 0 }
    const quantity  = p.quantity  ?? { count: 0, cost: 0 }
    const back = (n) => `${n} back`
    const stage = document.getElementById('hud-stage') ?? document.body

    this._el = h('div', {
      className: 'qf-eventconfirm',
      on: { click: (e) => { if (e.target === e.currentTarget) this._click('cancel') } },
    }, [
      h('div', { className: 'qf-eventconfirm-card qf-eventconfirm-shadow' }, [
        h('span', { className: 'qf-eventconfirm-corner tl' }),
        h('span', { className: 'qf-eventconfirm-corner tr' }),
        h('span', { className: 'qf-eventconfirm-corner bl' }),
        h('span', { className: 'qf-eventconfirm-corner br' }),
        h('div', { className: 'qf-eventconfirm-head' }, [
          h('div', { className: 'qf-eventconfirm-title' }, 'NOT ENOUGH GOLD'),
        ]),
        h('div', { className: 'qf-eventconfirm-rule' }),
        h('div', { className: 'qf-eventconfirm-message' },
          `Reviving all ${p.fallenCount ?? 0} costs ${p.totalCost ?? 0}g — you have ${p.have ?? 0}g. Who comes back?`),
        h('div', { className: 'qf-eventconfirm-buttons' }, [
          h('button', {
            className: 'qf-eventconfirm-btn confirm',
            on: { click: () => this._click('strongest') },
          }, `STRONGEST · ${back(strongest.count)} (${strongest.cost}g)`),
          h('button', {
            className: 'qf-eventconfirm-btn confirm',
            on: { click: () => this._click('quantity') },
          }, `MOST MINIONS · ${back(quantity.count)} (${quantity.cost}g)`),
          h('button', {
            className: 'qf-eventconfirm-btn cancel',
            on: { click: () => this._click('cancel') },
          }, 'CANCEL'),
        ]),
      ]),
    ])
    stage.appendChild(this._el)
    // Force reflow so the .show fade/slam runs.
    // eslint-disable-next-line no-unused-expressions
    this._el.offsetHeight
    this._el.classList.add('show')

    this._escFn = (e) => { if (e.key === 'Escape') this._click('cancel') }
    window.addEventListener('keydown', this._escFn)
  }

  _click(which) {
    this._resolveAs(which)
    this._closeAll()
  }

  _resolveAs(which) {
    if (this._resolved) return
    this._resolved = true
    const p = this._payload ?? {}
    if (which === 'strongest' || which === 'quantity') p.onPick?.(which)
    else                                               p.onCancel?.()
  }

  _closeAll() {
    if (this._escFn) { window.removeEventListener('keydown', this._escFn); this._escFn = null }
    if (this._el) {
      const el = this._el
      this._el = null
      el.classList.add('closing')
      setTimeout(() => el.remove(), 220)
    }
  }

  destroy() {
    EventBus.off('SHOW_REVIVE_CHOICE', this._listener)
    this._closeAll()
  }
}

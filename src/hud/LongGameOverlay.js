// LongGameOverlay — DOM port of the Phaser LongGamePopup.
//
// Fires when the "Long Game" dark pact triggers (every 3 days). Shows
// the granted free pact, the minion sacrificed, and the permanent slot
// loss. Single CONTINUE button. Re-skin of the existing Phaser popup.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'

export class LongGameOverlay {
  constructor() {
    this._overlay = null
    this._listener = (payload) => this.showFor(payload)
    EventBus.on('LONG_GAME_TRIGGERED', this._listener)
  }

  showFor(payload = {}) {
    if (this._overlay) this._closeNow()
    const day  = payload.day  ?? '?'
    const got  = payload.grantedName ?? '— none —'
    const lost = payload.lostName    ?? '— none —'

    this._overlay = new Overlay({
      title:    'THE · LONG · GAME',
      width:    760,
      height:   400,
      accent:   'var(--info)',
      onClose:  () => { this._overlay = null },
      body: h('div', { className: 'qf-longgame-body' }, [
        h('div', { className: 'pix qf-longgame-tagline' },
          `DAY ${day} · DAWN OF THE PACT`),
        h('div', { className: 'pix qf-longgame-section', style: { color: 'var(--gold)' } },
          'THE BARGAIN BEARS FRUIT'),
        h('div', { className: 'pix qf-longgame-headline' }, `+ ${String(got).toUpperCase()}`),
        h('div', { className: 'qf-longgame-sub' },
          'A free Rare pact — sealed without cost.'),
        h('div', {
          className: 'pix qf-longgame-section qf-longgame-section-warn',
        }, '— BUT THE PRICE IS PAID —'),
        h('div', { className: 'qf-longgame-warn-line' },
          `− 1 minion lost permanently  (${lost})`),
        h('div', { className: 'qf-longgame-warn-line' },
          '− 1 maximum minion slot, forever'),
        h('button', {
          className: 'btn primary lg qf-longgame-continue',
          on: { click: () => this._closeNow() },
        }, 'CONTINUE'),
      ]),
    })
    this._overlay.open()
  }

  _closeNow() {
    const ov = this._overlay
    this._overlay = null
    ov?._opts && (ov._opts.onClose = null)
    ov?.close()
  }

  destroy() {
    EventBus.off('LONG_GAME_TRIGGERED', this._listener)
    this._closeNow()
  }
}

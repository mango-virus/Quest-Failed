// ConfirmPopup — DOM port of the generic confirm modal.
//
// Same event contract as the existing Phaser ConfirmPopup
// (`src/ui/popups/ConfirmPopup.js`): subscribes to `SHOW_CONFIRM` with
// payload `{ title?, message, confirmLabel?, cancelLabel?, onConfirm?, onCancel? }`.
// Backdrop / Esc / X dismissal counts as cancel.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'

export class ConfirmPopup {
  constructor() {
    this._overlay = null
    this._payload = null
    this._resolved = false
    this._listener = (payload) => this.showFor(payload)
    EventBus.on('SHOW_CONFIRM', this._listener)
  }

  showFor(payload) {
    // Replace any existing open confirm with the new payload (and treat
    // the previous one as cancelled so its callback fires).
    if (this._overlay) {
      this._resolveAs('cancel')
      this._closeOverlay()
    }
    this._payload  = payload ?? {}
    this._resolved = false

    const title         = this._payload.title         ?? 'CONFIRM'
    const message       = this._payload.message       ?? 'Are you sure?'
    const confirmLabel  = this._payload.confirmLabel  ?? 'YES'
    const cancelLabel   = this._payload.cancelLabel   ?? 'CANCEL'

    this._overlay = new Overlay({
      title,
      width:  520,
      height: 240,
      accent: 'var(--blood)',
      onClose: () => {
        // Backdrop / Esc / X — count as cancel if neither button fired
        if (!this._resolved) this._resolveAs('cancel')
        this._overlay = null
        this._payload = null
      },
      body: h('div', { className: 'qf-confirm-body' }, [
        h('div', { className: 'qf-confirm-message' }, message),
        h('div', { className: 'qf-confirm-buttons' }, [
          h('button', {
            className: 'btn',
            on: { click: () => this._click('cancel') },
          }, cancelLabel),
          h('button', {
            className: 'btn primary',
            on: { click: () => this._click('confirm') },
          }, confirmLabel),
        ]),
      ]),
    })
    this._overlay.open()
  }

  _click(which) {
    this._resolveAs(which)
    this._closeOverlay()
  }

  _closeOverlay() {
    if (!this._overlay) return
    const ov = this._overlay
    this._overlay = null
    // Suppress the onClose path (we've already resolved)
    ov._opts.onClose = null
    ov.close()
  }

  _resolveAs(which) {
    if (this._resolved) return
    this._resolved = true
    const p = this._payload ?? {}
    if (which === 'confirm') p.onConfirm?.()
    else                     p.onCancel?.()
  }

  destroy() {
    EventBus.off('SHOW_CONFIRM', this._listener)
    this._closeOverlay()
  }
}

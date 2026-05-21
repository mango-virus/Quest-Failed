// ConfirmPopup — DOM port of the generic confirm modal.
//
// Subscribes to `SHOW_CONFIRM` with payload
//   { title?, message, confirmLabel?, cancelLabel?, onConfirm?, onCancel?,
//     event? }
// Backdrop / Esc / X dismissal counts as cancel.
//
// When `event: { theme, icon, title }` is present (night-phase Dungeon
// Event decisions — Gambler's Coin, Negotiation Day, Black Market,
// Mercenary Contract, Cursed Relic) a themed event-slate variant is
// rendered instead of the plain Overlay, matching the event-banner look
// (per-theme palette, corner brackets, icon, kicker).

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'

export class ConfirmPopup {
  constructor() {
    this._overlay  = null     // generic-confirm Overlay instance
    this._eventEl  = null     // themed event-confirm DOM node
    this._escFn    = null
    this._payload  = null
    this._resolved = false
    this._listener = (payload) => this.showFor(payload)
    EventBus.on('SHOW_CONFIRM', this._listener)
  }

  showFor(payload) {
    // Replace any open confirm with the new payload (treat the previous
    // one as cancelled so its callback fires).
    if (this._overlay || this._eventEl) {
      this._resolveAs('cancel')
      this._closeAll()
    }
    this._payload  = payload ?? {}
    this._resolved = false

    if (this._payload.event) { this._showEventConfirm(); return }
    this._showGenericConfirm()
  }

  // ── Themed event-decision modal ────────────────────────────────────────
  _showEventConfirm() {
    const p   = this._payload
    const ev  = p.event ?? {}
    const theme        = String(ev.theme ?? 'gold')
    const message      = p.message      ?? ''
    const confirmLabel = p.confirmLabel ?? 'YES'
    const cancelLabel  = p.cancelLabel  ?? 'CANCEL'
    const stage = document.getElementById('hud-stage')
    if (!stage) { this._showGenericConfirm(); return }

    this._eventEl = h('div', {
      className: 'qf-eventconfirm',
      on: {
        click: (e) => { if (e.target === e.currentTarget) this._click('cancel') },
      },
    }, [
      h('div', { className: `qf-eventconfirm-card qf-eventconfirm-${theme}` }, [
        h('span', { className: 'qf-eventconfirm-corner tl' }),
        h('span', { className: 'qf-eventconfirm-corner tr' }),
        h('span', { className: 'qf-eventconfirm-corner bl' }),
        h('span', { className: 'qf-eventconfirm-corner br' }),
        h('div', { className: 'qf-eventconfirm-kicker' }, '◆  DUNGEON EVENT  ◆'),
        h('div', { className: 'qf-eventconfirm-head' }, [
          ev.icon ? h('span', { className: 'qf-eventconfirm-icon' }, ev.icon) : null,
          h('div', { className: 'qf-eventconfirm-title' }, ev.title ?? p.title ?? 'DUNGEON EVENT'),
        ].filter(Boolean)),
        h('div', { className: 'qf-eventconfirm-rule' }),
        h('div', { className: 'qf-eventconfirm-message' }, message),
        h('div', { className: 'qf-eventconfirm-buttons' }, [
          h('button', {
            className: 'qf-eventconfirm-btn cancel',
            on: { click: () => this._click('cancel') },
          }, cancelLabel),
          h('button', {
            className: 'qf-eventconfirm-btn confirm',
            on: { click: () => this._click('confirm') },
          }, confirmLabel),
        ]),
      ]),
    ])
    stage.appendChild(this._eventEl)
    // Force reflow so the .show fade/slam runs.
    // eslint-disable-next-line no-unused-expressions
    this._eventEl.offsetHeight
    this._eventEl.classList.add('show')

    this._escFn = (e) => { if (e.key === 'Escape') this._click('cancel') }
    window.addEventListener('keydown', this._escFn)
  }

  // ── Generic confirm (non-event callers) ────────────────────────────────
  _showGenericConfirm() {
    const p = this._payload
    const title        = p.title        ?? 'CONFIRM'
    const message      = p.message      ?? 'Are you sure?'
    const confirmLabel = p.confirmLabel ?? 'YES'
    const cancelLabel  = p.cancelLabel  ?? 'CANCEL'

    // Size the modal to the message so long text never needs a scrollbar.
    const lineCount = String(message).split('\n')
      .reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / 48)), 0)
    const height = Math.min(560, Math.max(240, 160 + lineCount * 28))

    this._overlay = new Overlay({
      title,
      width:  520,
      height,
      accent: 'var(--blood)',
      onClose: () => {
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
    this._closeAll()
  }

  _closeAll() {
    if (this._escFn) { window.removeEventListener('keydown', this._escFn); this._escFn = null }
    if (this._eventEl) {
      const el = this._eventEl
      this._eventEl = null
      el.classList.add('closing')
      setTimeout(() => el.remove(), 220)
    }
    if (this._overlay) {
      const ov = this._overlay
      this._overlay = null
      ov._opts.onClose = null   // already resolved — suppress the onClose path
      ov.close()
    }
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
    this._closeAll()
  }
}

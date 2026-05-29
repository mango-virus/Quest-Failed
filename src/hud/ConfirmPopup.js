// ConfirmPopup — DOM port of the generic confirm modal.
//
// Subscribes to `SHOW_CONFIRM` with payload
//   { title?, message, confirmLabel?, cancelLabel?, onConfirm?, onCancel?,
//     event?, theme?, icon?, kicker?, forceChoice? }
// Backdrop / Esc dismissal counts as cancel — UNLESS the prompt requires
// an explicit choice (Dungeon Event decisions): those disable backdrop
// + Esc so the player has to commit to a button.
//
// ALL confirms — sell prompts, abandon-run, dungeon-event decisions —
// share the corner-bracket event-slate frame. The `event` payload (used
// by Gambler's Coin / Negotiation Day / Black Market / Mercenary
// Contract / Cursed Relic) supplies an event-banner theme + icon + the
// "◆ DUNGEON EVENT ◆" kicker AND auto-enables forceChoice; non-event
// callers get the same chrome minus the kicker and icon (default
// 'shadow' theme) and keep the click-out-to-cancel affordance. Callers
// can override theme / kicker / icon / forceChoice individually.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

export class ConfirmPopup {
  constructor() {
    this._el       = null     // mounted card DOM node
    this._escFn    = null
    this._payload  = null
    this._resolved = false
    this._listener = (payload) => this.showFor(payload)
    EventBus.on('SHOW_CONFIRM', this._listener)
  }

  showFor(payload) {
    // Replace any open confirm with the new payload (treat the previous
    // one as cancelled so its callback fires).
    if (this._el) {
      this._resolveAs('cancel')
      this._closeAll()
    }
    this._payload  = payload ?? {}
    this._resolved = false
    this._showCard()
  }

  // ── Unified confirm slate ──────────────────────────────────────────────
  // Renders the event-style frame for every confirm. The `event` payload
  // (dungeon-event decisions) drives theme + icon + kicker defaults; for
  // ordinary callers (sell prompts, abandon-run) the kicker and icon are
  // omitted and the theme defaults to 'blue'.
  _showCard() {
    const p   = this._payload
    const ev  = p.event ?? null
    const theme        = String(p.theme ?? ev?.theme ?? (ev ? 'gold' : 'shadow'))
    const title        = ev?.title       ?? p.title        ?? 'CONFIRM'
    const icon         = p.icon          ?? ev?.icon       ?? null
    const kicker       = p.kicker        ?? (ev ? '◆  DUNGEON EVENT  ◆' : null)
    const message      = p.message       ?? 'Are you sure?'
    // Optional `messageNode` payload — when present (a DOM element or
    // array of elements built by the caller), it REPLACES the plain
    // `message` string in the body slot. Used by callers that need
    // styled / mixed-content message bodies (Sacrificial Altar's
    // PAY/REWARD typography, etc.). Plain-string callers are
    // unaffected.
    const messageNode  = p.messageNode    ?? null
    const confirmLabel = p.confirmLabel  ?? 'YES'
    const cancelLabel  = p.cancelLabel   ?? 'CANCEL'
    // `hideCancel` drops the cancel button entirely — for mandatory prompts
    // (e.g. Dark Deal) where the only path forward is the confirm action.
    // Implies forceChoice (no backdrop / Esc escape hatch either).
    const hideCancel   = !!p.hideCancel
    // Force-choice mode locks the prompt open until the player commits
    // to a button. Defaults true for Dungeon Event decisions (they have
    // run-altering consequences and shouldn't be auto-cancelled by a
    // stray click outside the card); other callers can opt in via the
    // payload. When forceChoice is on, both backdrop clicks and the Esc
    // key become no-ops.
    const forceChoice = p.forceChoice ?? (!!ev || hideCancel)
    this._forceChoice = forceChoice
    const stage = document.getElementById('hud-stage') ?? document.body

    this._el = h('div', {
      className: 'qf-eventconfirm' + (forceChoice ? ' qf-eventconfirm-locked' : ''),
      on: forceChoice ? {} : {
        click: (e) => { if (e.target === e.currentTarget) this._click('cancel') },
      },
    }, [
      h('div', { className: `qf-eventconfirm-card qf-eventconfirm-${theme}` }, [
        h('span', { className: 'qf-eventconfirm-corner tl' }),
        h('span', { className: 'qf-eventconfirm-corner tr' }),
        h('span', { className: 'qf-eventconfirm-corner bl' }),
        h('span', { className: 'qf-eventconfirm-corner br' }),
        kicker ? h('div', { className: 'qf-eventconfirm-kicker' }, kicker) : null,
        h('div', { className: 'qf-eventconfirm-head' }, [
          icon ? h('span', { className: 'qf-eventconfirm-icon' }, icon) : null,
          h('div', { className: 'qf-eventconfirm-title' }, title),
        ].filter(Boolean)),
        h('div', { className: 'qf-eventconfirm-rule' }),
        h('div', { className: 'qf-eventconfirm-message' }, messageNode ?? message),
        h('div', { className: 'qf-eventconfirm-buttons' }, [
          hideCancel ? null : h('button', {
            className: 'qf-eventconfirm-btn cancel',
            on: { click: () => this._click('cancel') },
          }, cancelLabel),
          h('button', {
            className: 'qf-eventconfirm-btn confirm',
            on: { click: () => this._click('confirm') },
          }, confirmLabel),
        ].filter(Boolean)),
      ].filter(Boolean)),
    ])
    stage.appendChild(this._el)
    // Force reflow so the .show fade/slam runs.
    // eslint-disable-next-line no-unused-expressions
    this._el.offsetHeight
    this._el.classList.add('show')

    // Esc-to-cancel is also gated by forceChoice. The handler is still
    // bound when forceChoice is on (so we can swallow Esc and prevent
    // any upstream listener from acting on it) but it explicitly does
    // NOT cancel the prompt — the player must commit to a button.
    this._escFn = (e) => {
      if (e.key !== 'Escape') return
      if (this._forceChoice) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      this._click('cancel')
    }
    window.addEventListener('keydown', this._escFn)
  }

  _click(which) {
    this._resolveAs(which)
    this._closeAll()
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

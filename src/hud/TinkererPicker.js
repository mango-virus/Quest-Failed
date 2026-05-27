// TinkererPicker — DOM modal for the Tinkerer's Workshop dungeon event.
//
// Subscribes to `SHOW_TINKERER_OFFER { offers: [{ roomId, name, description }] }`
// emitted by EventSystem._promptTinkerersWorkshop, renders a 3-card
// picker (or fewer if the player has < 3 unique buildable room types),
// and emits `TINKERER_PICK { roomId }` on click. EventSystem._onTinkererPicked
// stamps gameState._tinkeredRoomTypes and the LeftPanels build menu
// re-renders to show the "★ UPGRADED" badge.
//
// Visual treatment matches the gold-themed event-confirm chrome —
// corner brackets + golden ribbon + cog/star motif. Backdrop-click and
// Esc dismiss the picker WITHOUT a pick (player walks away). The event
// fires once per announce so dismissing without picking forfeits the
// upgrade — same forfeit semantics as Cursed Relic's BANISH.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

export class TinkererPicker {
  constructor() {
    this._el       = null
    this._escFn    = null
    this._listener = (payload) => this.show(payload ?? {})
    EventBus.on('SHOW_TINKERER_OFFER', this._listener)
  }

  destroy() {
    EventBus.off('SHOW_TINKERER_OFFER', this._listener)
    this._close()
  }

  show({ offers = [] } = {}) {
    if (this._el) this._close()
    if (!Array.isArray(offers) || offers.length === 0) return
    const stage = document.getElementById('hud-stage') ?? document.body

    // Cards laid out in a row. Title bar + flavour text + close hint
    // underneath so the player can walk away if none of the three
    // upgrades fit their build.
    this._el = h('div', {
      className: 'qf-tinkerer-modal',
      on: {
        click: (e) => { if (e.target === e.currentTarget) this._close() },
      },
    }, [
      h('div', { className: 'qf-tinkerer-card' }, [
        h('span', { className: 'qf-tinkerer-corner tl' }),
        h('span', { className: 'qf-tinkerer-corner tr' }),
        h('span', { className: 'qf-tinkerer-corner bl' }),
        h('span', { className: 'qf-tinkerer-corner br' }),
        h('div', { className: 'qf-tinkerer-kicker' }, '◆  DUNGEON EVENT  ◆'),
        h('div', { className: 'qf-tinkerer-title pix' }, '🛠️  THE TINKERER\'S WORKSHOP'),
        h('div', { className: 'qf-tinkerer-flavor pix' },
          'A goblin tinkerer offers to upgrade ONE of your current room types. ' +
          'The upgrade applies to every current AND future room of that type ' +
          'for the rest of the run.'),
        h('div', { className: 'qf-tinkerer-offers' },
          offers.map(o => this._renderOffer(o))
        ),
        h('div', { className: 'qf-tinkerer-walk-away pix',
          on: { click: () => this._close() },
        }, 'WALK AWAY'),
      ]),
    ])
    stage.appendChild(this._el)

    // Esc closes (walks away). Matches ConfirmPopup's affordance.
    this._escFn = (e) => { if (e.key === 'Escape') this._close() }
    window.addEventListener('keydown', this._escFn)
  }

  _renderOffer(offer) {
    return h('button', {
      className: 'qf-tinkerer-offer',
      on: { click: () => this._pick(offer) },
    }, [
      h('div', { className: 'qf-tinkerer-offer-name pix' }, offer.name),
      h('div', { className: 'qf-tinkerer-offer-room pix' },
        `Affects: ${this._humanizeRoomId(offer.roomId)}`),
      h('div', { className: 'qf-tinkerer-offer-desc' }, offer.description),
      h('div', { className: 'qf-tinkerer-offer-pick pix' }, '★ PICK'),
    ])
  }

  _humanizeRoomId(id) {
    return String(id ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  _pick(offer) {
    if (!offer?.roomId) return
    EventBus.emit('TINKERER_PICK', { roomId: offer.roomId })
    this._close()
  }

  _close() {
    if (this._escFn) {
      window.removeEventListener('keydown', this._escFn)
      this._escFn = null
    }
    if (this._el) {
      this._el.remove()
      this._el = null
    }
  }
}

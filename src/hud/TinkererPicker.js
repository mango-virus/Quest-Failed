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
// corner brackets + gold accents. Compact card layout (2026-05-27 v3):
// big room emoji + upgrade name + one-line effect, whole card is the
// click target (no separate "PICK" button). Backdrop-click + Esc
// dismiss without a pick (player walks away — forfeit semantics same
// as Cursed Relic's BANISH).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

// Distinct emoji per room type — gives players a visual at-a-glance
// cue beyond the name. Keep these intentionally varied so adjacent
// cards never share the same glyph. Falls back to '⚒️' (workshop
// hammer) for any room id not in this map.
const ROOM_EMOJI = {
  starter_barracks:    '🏰',
  starter_guard_post:  '🛡️',
  crypt:               '💀',
  trap_factory:        '⚙️',
  treasury:            '💰',
  armory:              '⚔️',
  library_of_whispers: '📜',
  watchtower:          '👁️',
  wandering_gate:      '🌀',
  veil_of_forgetting:  '🌫️',
  catacombs:           '🪦',
  mimic_vault:         '📦',
  hall_of_trials:      '🏛️',
  wishing_well:        '💧',
  false_exit:          '🚪',
  hall_of_madness:     '🤯',
  throne_room:         '👑',
  sanctum:             '✨',
  tar_pit:             '🛢️',
  silence_ward:        '🔇',
  thorn_hall:          '🌵',
}

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
    const emoji = ROOM_EMOJI[offer.roomId] ?? '⚒️'
    // Always surface the target room name on the card — several upgrades
    // (Skewed Gate, Tyrant Throne, Cannonade, etc.) have flavour names
    // that don't telegraph which room they actually affect, so a small
    // "UPGRADES <Room>" label sits between the emoji and the upgrade
    // name so the player can never mistake the target.
    const roomLabel = offer.roomName
      ? `UPGRADES ${String(offer.roomName).toUpperCase()}`
      : ''
    return h('button', {
      className: 'qf-tinkerer-offer',
      on: { click: () => this._pick(offer) },
    }, [
      h('div', { className: 'qf-tinkerer-offer-icon' }, emoji),
      roomLabel
        ? h('div', { className: 'qf-tinkerer-offer-room pix' }, roomLabel)
        : null,
      h('div', { className: 'qf-tinkerer-offer-name pix' }, offer.name),
      h('div', { className: 'qf-tinkerer-offer-desc pix' }, offer.description),
    ])
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

// PactDetailPopup — DOM port of the small floating pact tooltip.
//
// Subscribes to `SHOW_PACT_DETAIL { pact, x, y }` from BossOverview's
// pact rows; hides on `HIDE_PACT_DETAIL`. Positioned at the anchor
// coords, vertically centered to its target. The tooltip is anchored
// in viewport-space (it's a `position: fixed` element) so it stays
// visible even when the overlay scrolls.

import { h, mount } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

export class PactDetailPopup {
  constructor() {
    this._el = null
    this._showListener = (payload) => this.showFor(payload)
    this._hideListener = () => this.hide()
    EventBus.on('SHOW_PACT_DETAIL', this._showListener)
    EventBus.on('HIDE_PACT_DETAIL', this._hideListener)
  }

  showFor({ pact, x = 0, y = 0, anchor = 'left' } = {}) {
    if (!pact) return
    this.hide()
    const color = pact.color || 'var(--info)'
    // Anchor presets:
    //   'left'  — tooltip's right edge at x, vertical center at y (default;
    //             used by BossOverview pact rows positioned on the right
    //             side of the screen).
    //   'below' — tooltip horizontally centered on x, top edge at y
    //             (used by TopBar buff slots near the top of the screen).
    const transform = anchor === 'below'
      ? 'translate(-50%, 0)'
      : 'translate(-100%, -50%)'
    this._el = h('div', {
      className: 'tooltip qf-pact-tooltip',
      style: {
        position: 'fixed',
        left: `${x}px`,
        top:  `${y}px`,
        transform,
        '--pact-color': color,
        borderColor: color,
      },
    }, [
      h('div', { className: 'tt-head' }, [
        h('span', { className: 'tt-name' }, [
          h('span', {
            className: 'diamond sm',
            style: { background: color, boxShadow: `0 0 4px ${color}` },
          }),
          pact.name || pact.id,
        ]),
        h('span', {
          className: 'tt-tag',
          style: { color },
        }, (pact.rarity || 'COMMON').toUpperCase()),
      ]),
      h('div', { className: 'tt-body' }, [
        pact.flavorText && h('div', { className: 'qf-pact-tt-flavor' }, `"${pact.flavorText}"`),
        // What the pact does. `description` is the dungeonMechanics.json
        // field; `boon` is kept as a fallback for any other pact shape.
        (pact.description || pact.boon) && h('div', { className: 'qf-pact-tt-row' }, [
          h('span', { className: 'qf-pact-tt-arrow', style: { color: 'var(--poison)' } }, '▲'),
          h('span', { style: { color: 'var(--text)' } }, pact.description || pact.boon),
        ]),
        // The cost the boss pays for it.
        (pact.tradeoffDescription || pact.bane) && h('div', { className: 'qf-pact-tt-row' }, [
          h('span', { className: 'qf-pact-tt-arrow', style: { color: 'var(--blood)' } }, '▼'),
          h('span', { style: { color: 'var(--warn)' } }, pact.tradeoffDescription || pact.bane),
        ]),
      ]),
    ])
    document.body.appendChild(this._el)
  }

  hide() {
    this._el?.remove()
    this._el = null
  }

  destroy() {
    EventBus.off('SHOW_PACT_DETAIL', this._showListener)
    EventBus.off('HIDE_PACT_DETAIL', this._hideListener)
    this.hide()
  }
}

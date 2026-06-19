// PactDetailPopup — DOM port of the small floating pact tooltip.
//
// Subscribes to `SHOW_PACT_DETAIL { pact, x, y }` from BossOverview's
// pact rows; hides on `HIDE_PACT_DETAIL`. Positioned at the anchor
// coords, vertically centered to its target. The tooltip is anchored
// in viewport-space (it's a `position: fixed` element) so it stays
// visible even when the overlay scrolls.

import { h, mount } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { effectiveUiScale } from './stageScale.js'

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
    // The tooltip is a `position: fixed` element on document.body, so it does
    // NOT inherit #hud-stage's `zoom` — at a non-1.0 UI scale it would render
    // at the wrong size relative to the surrounding HUD. We scale it ourselves
    // to match (see _positionAnchored). Anchored via measured left/top with a
    // clean `transform-origin: 0 0` rather than percentage translate, because
    // translate-percent + scale don't compose cleanly around a non-(0,0) origin.
    this._el = h('div', {
      className: 'tooltip qf-pact-tooltip',
      style: {
        position: 'fixed',
        left: '0px',
        top:  '0px',
        transformOrigin: '0 0',
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
    this._positionAnchored(x, y, anchor)
  }

  // Place the (now-mounted) tooltip so its anchor point lands exactly at the
  // viewport coords (x, y), scaled by the HUD's UI scale. Anchor presets:
  //   'left'  — right edge at x, vertical center at y (default; BossOverview
  //             pact rows on the right side of the screen).
  //   'below' — horizontally centered on x, top edge at y (TopBar buff slots
  //             near the top of the screen).
  // We measure the unscaled box (offsetWidth/Height), multiply by the scale to
  // get the on-screen footprint, then position the top-left corner so the
  // chosen anchor coincides with (x, y). scale() is applied around origin 0 0
  // so the math is a clean affine: viewport pos = left + localPos * s.
  _positionAnchored(x, y, anchor) {
    const el = this._el
    if (!el) return
    const s  = effectiveUiScale()
    const w  = (el.offsetWidth  || 0) * s
    const ht = (el.offsetHeight || 0) * s
    let left, top
    if (anchor === 'below') {
      left = x - w / 2   // h-center at x
      top  = y           // top edge at y
    } else {             // 'left'
      left = x - w       // right edge at x
      top  = y - ht / 2  // vertical center at y
    }
    // Resting transform = scale(s). --tt-scale tells the `tooltip-in` entrance
    // keyframe to animate TO scale(s) too, so it lands on the resting transform
    // seamlessly instead of popping from scale(1) → scale(s).
    el.style.setProperty('--tt-scale', String(s))
    el.style.transform = s === 1 ? '' : `scale(${s})`
    el.style.left = `${left}px`
    el.style.top  = `${top}px`
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

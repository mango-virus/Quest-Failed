// Overlay — generic modal shell.
//
// Mirrors the design's `<Overlay>` component (overlays.jsx ~line 108):
// a fullscreen dim backdrop with a centered .modal box that hosts a
// header bar (title + optional badge + close button) and a content
// region. Owns the close-on-Esc and close-on-backdrop-click affordances
// so every screen using it inherits them.
//
// Usage:
//   const ov = new Overlay({
//     title:    'PAUSED',
//     width:    760,
//     height:   640,
//     accent:   'var(--blood)',
//     onClose:  () => { ... },
//     body:     domNode,
//   })
//   document.body.appendChild(ov.el)   // or mount into a layer
//   ov.open()
//   ov.close()
//
// The overlay parents itself to the DOM HUD's #hud-stage by default so
// it scales/positions with the rest of the new HUD.

import { h, mount } from './dom.js'

export class Overlay {
  constructor(opts = {}) {
    this._opts = {
      title:    opts.title    ?? '',
      badge:    opts.badge    ?? null,
      width:    opts.width    ?? 1200,
      height:   opts.height   ?? 780,
      accent:   opts.accent   ?? 'var(--blood)',
      onClose:  opts.onClose  ?? null,
      animation: opts.animation ?? 'panel',   // 'panel' | 'unfurl'
      scrollLock: opts.scrollLock ?? false,
      closeOnBackdrop: opts.closeOnBackdrop ?? true,
    }
    this._body = opts.body ?? null
    this._open = false
    this._refs = {}     // child ref callbacks fire before parent ref during
                        // h() construction — init upfront so they can write into it
    this._escHandler = (e) => {
      if (e.key === 'Escape') this.close()
    }
    this.el = this._build()
  }

  _build() {
    const o = this._opts
    const root = h('div', {
      className: 'overlay',
      on: o.closeOnBackdrop ? {
        click: (e) => {
          // Backdrop click only closes if the click landed on the .overlay
          // node itself (i.e., outside the .modal box). Bubbled clicks from
          // inside the modal are ignored.
          if (e.target === e.currentTarget) this.close()
        },
      } : {},
    }, [
      h('div', {
        className: `modal ${o.animation === 'unfurl' ? 'unfurl' : ''}`,
        ref: el => { this._refs.modal = el },
        style: {
          width:  `${o.width}px`,
          height: `${o.height}px`,
          background: 'var(--bg-1)',
          border: `2px solid ${o.accent}`,
          boxShadow: [
            'inset 0 0 0 6px #000',
            `inset 0 0 0 8px ${o.accent}`,
            'inset 0 0 0 12px #000',
            'inset 0 0 32px rgba(0,0,0,0.55)',
            '0 24px 60px rgba(0,0,0,0.75)',
            `0 0 80px ${o.accent}33`,
          ].join(', '),
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          padding: '12px',
        },
      }, [
        // Header
        h('div', { className: 'qf-overlay-head' }, [
          h('div', { className: 'qf-overlay-headleft' }, [
            h('div', { className: 'pix qf-overlay-title' }, o.title),
            o.badge && h('div', { className: 'qf-overlay-badge' }, o.badge),
          ]),
          h('button', {
            className: 'qf-overlay-close',
            title: 'Close',
            style: { borderColor: o.accent },
            on: { click: () => this.close() },
          }, '×'),
        ]),
        // Body
        h('div', {
          className: 'qf-overlay-body',
          ref: el => { this._refs.body = el },
          style: {
            overflow: o.scrollLock ? 'hidden' : 'auto',
          },
        }, this._body),
      ]),
    ])
    return root
  }

  setBody(node) {
    this._body = node
    if (this._refs?.body) mount(this._refs.body, node)
  }

  open() {
    if (this._open) return
    this._open = true
    window.addEventListener('keydown', this._escHandler)
    // Inject into the HUD stage if not already mounted
    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this.el)
  }

  close() {
    if (!this._open) return
    this._open = false
    window.removeEventListener('keydown', this._escHandler)
    this.el?.remove()
    this._opts.onClose?.()
  }

  isOpen() { return this._open }

  destroy() {
    this.close()
  }
}

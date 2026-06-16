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
import { EventBus } from '../systems/EventBus.js'
import { userSettings } from './userSettings.js'

export class Overlay {
  constructor(opts = {}) {
    this._opts = {
      title:    opts.title    ?? '',
      badge:    opts.badge    ?? null,
      // When set, opening/closing the overlay emits HUD_MENU_OPENED /
      // HUD_MENU_CLOSED { kind } so the companion NPC docks beside it.
      npcKind:  opts.npcKind  ?? null,
      // When false, the modal stays screen-centered even with a companion
      // docked (the companion still steps out via npcKind). Used by the
      // boss level-up screen, which should be dead-center on screen.
      dock:     opts.dock     ?? true,
      width:    opts.width    ?? 1200,
      height:   opts.height   ?? 780,
      accent:   opts.accent   ?? 'var(--blood)',
      onClose:  opts.onClose  ?? null,
      animation: opts.animation ?? 'panel',   // 'panel' | 'unfurl'
      // Frame style: 'ornate' (default) = the accent-coloured double border +
      // glow; 'plain' = a single subtle line matching the main-menu edge
      // (2px solid var(--line-2)), no accent ring/glow.
      frame:    opts.frame    ?? 'ornate',
      scrollLock: opts.scrollLock ?? false,
      closeOnBackdrop: opts.closeOnBackdrop ?? true,
      // Result screens (PostWave / Ascension / GameOver) hide the legacy ✕ —
      // they close via their own CONTINUE / RISE AGAIN buttons.
      hideClose: opts.hideClose ?? false,
      // Result screens render their own dramatic in-body header, so the legacy
      // title bar is suppressed to avoid a duplicate title at the top-left.
      hideHeader: opts.hideHeader ?? false,
      // ── "Crypt" shell (front-end redesign) — opt-in, additive ──
      // When `eyebrow` or `atmosphere` is set, the modal renders the redesign
      // shell: a centered ◆ eyebrow + title head, faint brick-wall + vignette +
      // accent-hairline atmosphere, corner rivets, and a footer slot. The
      // close-✕ moves to the top-right corner. Legacy overlays (no eyebrow /
      // atmosphere) are unaffected.
      eyebrow:  opts.eyebrow  ?? null,
      sub:      opts.sub      ?? null,
      footer:   opts.footer   ?? null,
      atmosphere: opts.atmosphere ?? false,
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
    const crypt = !!o.eyebrow || !!o.atmosphere
    if (crypt) return this._buildCrypt()
    const plain = o.frame === 'plain'
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
          // Plain frame = a single subtle line like the main-menu edge; ornate
          // frame = the accent-coloured double border + outer glow.
          border: plain ? '2px solid var(--line-2)' : `2px solid ${o.accent}`,
          boxShadow: (plain ? [
            'inset 0 0 32px rgba(0,0,0,0.55)',
            '0 24px 60px rgba(0,0,0,0.75)',
          ] : [
            'inset 0 0 0 6px #000',
            `inset 0 0 0 8px ${o.accent}`,
            'inset 0 0 0 12px #000',
            'inset 0 0 32px rgba(0,0,0,0.55)',
            '0 24px 60px rgba(0,0,0,0.75)',
            `0 0 80px ${o.accent}33`,
          ]).join(', '),
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          padding: '12px',
        },
      }, [
        // Header — suppressed for result screens that render their own
        // dramatic in-body header (avoids a duplicate title at the top-left).
        !o.hideHeader && h('div', { className: 'qf-overlay-head' }, [
          h('div', { className: 'qf-overlay-headleft' }, [
            h('div', { className: 'pix qf-overlay-title' }, o.title),
            o.badge && h('div', { className: 'qf-overlay-badge' }, o.badge),
          ]),
          // Result screens (PostWave / Ascension / GameOver) close via their
          // own CONTINUE / RISE AGAIN buttons — no ✕, matching the design.
          !o.hideClose && h('button', {
            className: 'qf-overlay-close',
            title: 'Close',
            style: { borderColor: plain ? 'var(--line-2)' : o.accent },
            on: { click: () => this.close() },
          }, '×'),
        ].filter(Boolean)),
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

  // The redesign "Crypt" shell — centered ◆ eyebrow + title, brick/vignette
  // atmosphere, corner rivets, close-✕ top-right, optional footer. The dim
  // backdrop is semi-transparent so the throne-room (menu) behind shows faintly.
  _buildCrypt() {
    const o = this._opts
    return h('div', {
      className: 'overlay qf-cov-layer',
      on: o.closeOnBackdrop ? {
        click: (e) => { if (e.target === e.currentTarget) this.close() },
      } : {},
    }, [
      h('div', {
        className: 'qf-cov',
        ref: el => { this._refs.modal = el },
        style: {
          '--cov-acc': o.accent,
          width: `${o.width}px`, height: `${o.height}px`,
          maxWidth: '94%', maxHeight: '92%',
        },
      }, [
        // subtle edge vignette only — the brick wall + torch glow are the
        // title screen's signature, deliberately NOT carried into overlays.
        h('div', { className: 'qf-cov-atmo' }, [
          h('div', { className: 'qf-cov-vig' }),
        ]),
        // No ✕ button by design — overlays close on Esc + backdrop click.
        // header
        (o.title || o.eyebrow) && h('div', { className: 'qf-cov-head' }, [
          o.eyebrow && h('div', { className: 'sil qf-cov-eyebrow' }, [
            h('span', { className: 'ln' }), o.eyebrow, h('span', { className: 'ln r' }),
          ]),
          o.title && h('div', { className: 'pix qf-cov-title' }, o.title),
          o.sub && h('div', { className: 'qf-cov-sub' }, o.sub),
        ]),
        // body
        h('div', {
          className: 'qf-cov-body',
          ref: el => { this._refs.body = el },
          style: { overflow: o.scrollLock ? 'hidden' : 'auto' },
        }, this._body),
        // footer
        o.footer && h('div', { className: 'qf-cov-foot', ref: el => { this._refs.foot = el } }, o.footer),
      ]),
    ])
  }

  // Replace the footer content of a crypt-shell overlay in place.
  setFooter(node) {
    this._opts.footer = node
    if (this._refs?.foot) mount(this._refs.foot, node)
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
    // When the companion docks beside this menu, left-pin the modal so
    // Lilith only overlaps its outer edge instead of covering content.
    // Dock-shift tracks VISIBILITY, not silence: in MUTE the companion is
    // still visible and HUD_MENU_OPENED still steps her out beside the
    // modal, so the menu must shift to make room. Only HIDDEN ('off')
    // skips the dock — there's no sprite to clear.
    const dockShift = !!this._opts.npcKind && this._opts.dock &&
                      userSettings.companionMode() !== 'off'
    this.el.classList.toggle('qf-npc-docked', dockShift)
    stage.appendChild(this.el)
    if (this._opts.npcKind) {
      EventBus.emit('HUD_MENU_OPENED', { kind: this._opts.npcKind })
    }
  }

  close() {
    if (!this._open) return
    this._open = false
    window.removeEventListener('keydown', this._escHandler)
    this.el?.remove()
    if (this._opts.npcKind) {
      EventBus.emit('HUD_MENU_CLOSED', { kind: this._opts.npcKind })
    }
    this._opts.onClose?.()
  }

  isOpen() { return this._open }

  destroy() {
    this.close()
  }
}

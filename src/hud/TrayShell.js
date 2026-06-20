// TrayShell — the shared anchored fly-out frame for the action-bar trays
// (ROSTER / MAP / INTEL …), a vanilla-DOM port of the design's `TrayShell`.
//
// A tray is a crypt-stone popout that *grows out of* its action-bar button:
// it scales .16 → 1 from the corner nearest the button, with a little pointer
// `stem` tethering it down to the bar and a one-shot summon `burst`. It closes
// only on: Esc, opening another tray (one-at-a-time via `_active`), a phase
// flip, or its own button toggling — NEVER on a click in the dungeon (you need
// to click the field to place / inspect while a tray is open).
//
// Anchoring: the action bar lives in its own `zoom:1.5` subtree, so we can't
// use offsetLeft/Top across that boundary. Instead we measure both the anchor
// button and our full-stage `.htr-layer` with getBoundingClientRect (screen
// px) and convert to the layer's logical coordinate space by dividing out the
// stage zoom (= layerRect.width / layer.offsetWidth). The tray is then pinned
// with logical-px right/left + bottom so it floats just above the button.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

// The currently-open tray (one-at-a-time). Module-scoped so any tray opening
// closes whichever other tray is showing.
let _active = null

export class TrayShell {
  // opts:
  //   anchorSel — CSS selector for the action-bar button to fly out of.
  //   align     — 'right' | 'left'  (which button edge the tray hugs).
  //   vAlign    — 'up' | 'down'     ('up' = tray rises above the bottom bar).
  //   accent    — the --tc accent colour (e.g. 'var(--poison)').
  //   width/height — CSS width / px height of the tray.
  //   onClose   — called after the tray collapses (e.g. clear a button's .on).
  constructor({ anchorSel, align = 'right', vAlign = 'up', accent = 'var(--blood)', width = 'min(52vw,820px)', height = 328, onClose = null } = {}) {
    this._anchorSel = anchorSel
    this._align = align
    this._vAlign = vAlign
    this._accent = accent
    this._width = width
    this._height = height
    this._onClose = onClose
    this._open = false
    this._el = null
    this._contentEl = null

    // Bound handlers (stable refs so add/remove pair up).
    this._onKey = (e) => { if (e.key === 'Escape' && this._open) { e.stopPropagation(); this.close() } }
    this._onResize = () => { if (this._open) this._measure() }
    this._onPhase = () => this.close()   // a day/night flip closes the tray
  }

  get isOpen() { return this._open }

  // Lazily build the layer + tray frame. Content (the caller's `.htr-chrome`)
  // mounts into the stretch `.htr-body` slot — a direct flex child of the tray,
  // matching the design (TrayShell's child IS the chrome).
  _build() {
    if (this._el) return
    this._contentEl = h('div', { className: 'htr-body' })
    const tray = h('div', {
      className: 'htr-tray closed',
      dataset: { align: this._align, valign: this._vAlign },
      style: { width: this._width, height: this._height + 'px', '--tc': this._accent },
    }, [
      h('div', { className: 'htr-fill' }),
      h('span', { className: 'htr-burst' }),
      h('span', { className: 'htr-stem' }),
      this._contentEl,
    ])
    this._trayEl = tray
    // `.hc` puts the design crypt tokens in scope for the .htr-* chrome.
    this._el = h('div', { className: 'htr-layer hc' }, [ tray ])
  }

  // Recolor the tray's accent (--tc) — used by the build tray, whose accent
  // follows the active category.
  setAccent(color) {
    this._accent = color
    this._trayEl?.style.setProperty('--tc', color)
  }

  // The live tray DOM (frame) + the full-stage layer — exposed so callers can
  // append extras (e.g. the build tray's cursor-trailing placement ghost) into
  // the same stage-coordinate space, and measure the tray rect.
  get trayEl() { return this._trayEl }
  get layerEl() { return this._el }

  // Replace the tray's content (caller owns the markup). Returns the content
  // host so callers can also append directly if they prefer.
  setContent(node) {
    this._build()
    // After the first (open-time) render, mark the tray "summoned" BEFORE
    // mounting the new content so the staggered per-row entrance animations
    // DON'T replay on every re-render (selecting a row / paging / arming) —
    // that replay was the "everything shifts down for a moment" jank.
    if (this._open) this._trayEl?.classList.add('htr-summoned')
    this._contentEl.replaceChildren()
    if (node) this._contentEl.appendChild(node)
    return this._contentEl
  }

  // Position the tray so it floats just off its anchor button, in the layer's
  // logical coordinate space (pre-zoom).
  _measure() {
    const layer = this._el
    const btn = document.querySelector(this._anchorSel)
    if (!layer || !btn) return
    const lr = layer.getBoundingClientRect()
    const br = btn.getBoundingClientRect()
    // Stage zoom: screen px per logical px (layer is a direct child of the
    // zoomed #hud-stage and carries no extra zoom of its own).
    const s = (layer.offsetWidth && lr.width) ? (lr.width / layer.offsetWidth) : 1
    const tray = this._trayEl
    // Horizontal: hug the matching button edge.
    if (this._align === 'right') {
      tray.style.right = ((lr.right - br.right) / s) + 'px'
      tray.style.left = ''
    } else {
      tray.style.left = ((br.left - lr.left) / s) + 'px'
      tray.style.right = ''
    }
    // Vertical: 'up' anchors the tray's bottom just above the button top;
    // 'down' anchors its top just below the button bottom. +12px gap for the stem.
    if (this._vAlign === 'down') {
      tray.style.top = ((br.bottom - lr.top) / s + 12) + 'px'
      tray.style.bottom = ''
    } else {
      tray.style.bottom = ((lr.bottom - br.top) / s + 12) + 'px'
      tray.style.top = ''
    }
  }

  open() {
    if (this._open) return
    // Close any other open tray first (one-at-a-time).
    if (_active && _active !== this) _active.close()
    _active = this
    this._build()
    const stage = document.getElementById('hud-stage')
    if (stage && this._el.parentNode !== stage) stage.appendChild(this._el)
    this._open = true
    this._measure()
    // Next frame: drop `.closed` so the summon transition (scale .16→1) plays
    // from the just-measured anchor origin rather than the default.
    requestAnimationFrame(() => {
      this._trayEl?.classList.remove('closed')
    })
    // A deferred re-measure catches late layout (fonts, the bar's zoom box).
    this._remeasureT = setTimeout(() => this._measure(), 60)
    window.addEventListener('keydown', this._onKey, true)
    window.addEventListener('resize', this._onResize)
    // Close on a day/night phase flip (NOT on dungeon clicks — there's no
    // click-away, so placing/inspecting on the field keeps the tray open).
    EventBus.on('NIGHT_PHASE_BEGAN', this._onPhase)
    EventBus.on('DAY_PHASE_BEGAN', this._onPhase)
  }

  close() {
    if (!this._open) return
    this._open = false
    if (_active === this) _active = null
    this._trayEl?.classList.add('closed')
    clearTimeout(this._remeasureT)
    window.removeEventListener('keydown', this._onKey, true)
    window.removeEventListener('resize', this._onResize)
    EventBus.off('NIGHT_PHASE_BEGAN', this._onPhase)
    EventBus.off('DAY_PHASE_BEGAN', this._onPhase)
    this._onClose?.()
    // Remove the (now-hidden) layer after the collapse animation so hidden
    // trays don't pile up in #hud-stage across open/close cycles.
    setTimeout(() => { if (!this._open) { this._el?.remove() } }, 450)
  }

  toggle() { this._open ? this.close() : this.open() }

  destroy() {
    this.close()
    this._el?.remove()
    this._el = null
  }
}

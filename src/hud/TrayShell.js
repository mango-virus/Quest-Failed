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

// The currently-open ANCHORED tray (one-at-a-time). Module-scoped so any tray
// opening closes whichever other anchored tray is showing. Detached (floating)
// trays leave this slot, so they coexist and survive other trays opening.
let _active = null
// The focused floating panel (gets the bright border + sits on top). Bringing a
// panel to front re-appends its layer so it stacks above the others.
let _focused = null

export class TrayShell {
  // opts:
  //   anchorSel — CSS selector for the action-bar button to fly out of.
  //   align     — 'right' | 'left'  (which button edge the tray hugs).
  //   vAlign    — 'up' | 'down'     ('up' = tray rises above the bottom bar).
  //   accent    — the --tc accent colour (e.g. 'var(--poison)').
  //   width/height — CSS width / px height of the tray.
  //   onClose   — called after the tray collapses (e.g. clear a button's .on).
  constructor({ anchorSel, align = 'right', vAlign = 'up', accent = 'var(--blood)', width = 'min(52vw,820px)', height = 328, onClose = null, detachable = false, title = '', detachedSize = null, detachedSizeSmall = null, onDetach = null } = {}) {
    this._anchorSel = anchorSel
    this._align = align
    this._vAlign = vAlign
    this._accent = accent
    this._width = width
    this._height = height
    this._onClose = onClose
    this._detachable = detachable
    this._title = title
    this._detachedSize = detachedSize       // { width, height } the floating panel snaps to (square)
    this._detachedSizeSmall = detachedSizeSmall  // optional smaller size the resize button toggles to
    this._detSmall = false
    this._onDetach = onDetach
    this._detached = false
    this._drag = null
    this._open = false
    this._el = null
    this._contentEl = null

    // Bound handlers (stable refs so add/remove pair up).
    // Esc closes anchored trays; a detached (pinned) panel ignores it — close via ✕.
    this._onKey = (e) => { if (e.key === 'Escape' && this._open && !this._detached) { e.stopPropagation(); this.close() } }
    this._onResize = () => { if (this._open) { this._measure(); this._placeDetachTab() } }
    // A day/night flip closes an anchored tray — but a detached panel stays pinned.
    this._onPhase = () => { if (!this._detached) this.close() }
    this._onDragDownB = (e) => this._dragDown(e)
    this._onDragMoveB = (e) => this._dragMove(e)
    this._onDragUpB = (e) => this._dragUp(e)
    this._onFocusDownB = () => { if (this._detached) this.focus() }
  }

  get isOpen() { return this._open }
  get isDetached() { return this._detached }

  // Lazily build the layer + tray frame. Content (the caller's `.htr-chrome`)
  // mounts into the stretch `.htr-body` slot — a direct flex child of the tray,
  // matching the design (TrayShell's child IS the chrome).
  _build() {
    if (this._el) return
    this._contentEl = h('div', { className: 'htr-body' })
    const kids = [
      h('div', { className: 'htr-fill' }),
      h('span', { className: 'htr-burst' }),
      h('span', { className: 'htr-stem' }),
      this._contentEl,
    ]
    if (this._detachable) {
      // Drag-handle title bar — hidden until detached (CSS), grip + name + ✕.
      const tbKids = [
        h('span', { className: 'htr-tb-grip' }, '⠿'),
        h('span', { className: 'htr-tb-title' }, this._title),
      ]
      if (this._detachedSizeSmall) {
        // Toggle the floating panel between its two sizes (large ⇄ small).
        this._sizeBtnEl = h('button', {
          className: 'htr-tb-size', title: 'Resize panel',
          on: { click: (e) => { e.stopPropagation(); this._toggleSize() } },
        }, '⤡')
        tbKids.push(this._sizeBtnEl)
      }
      tbKids.push(h('button', { className: 'htr-tb-x', title: 'Close — re-dock to the bar', on: { click: () => this.close() } }, '✕'))
      this._titleEl = h('div', { className: 'htr-titlebar' }, tbKids)
      this._titleEl.addEventListener('pointerdown', this._onDragDownB)
      // Right-edge pull-tab — click to detach. Hidden once detached (CSS).
      this._detachTabEl = h('button', {
        className: 'htr-detach', title: 'Detach — pin this panel on screen',
        on: { click: (e) => { e.stopPropagation(); this.detach() } },
      }, [ h('span', { className: 'htr-detach-ic' }, '⛶') ])
      kids.push(this._titleEl, this._detachTabEl)
    }
    const tray = h('div', {
      className: 'htr-tray closed',
      dataset: { align: this._align, valign: this._vAlign },
      style: { width: this._width, height: this._height + 'px', '--tc': this._accent },
    }, kids)
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
    // A deferred re-measure catches late layout (fonts, the bar's zoom box) and
    // positions the detach pull-tab now that the tray has its real size.
    this._remeasureT = setTimeout(() => { this._measure(); this._placeDetachTab() }, 60)
    // Re-place the tab once the summon scale settles (right edge is final).
    this._tabT = setTimeout(() => this._placeDetachTab(), 460)
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
    if (_focused === this) _focused = null
    // If detached, aim the collapse back toward the action-bar button so it
    // reads as "re-docking", then clear the floating state.
    if (this._detached) this._aimRedock()
    this._detached = false
    this._endDrag()
    this._trayEl?.classList.add('closed')
    this._trayEl?.classList.remove('detached', 'focused', 'htr-small')
    clearTimeout(this._remeasureT)
    clearTimeout(this._tabT)
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

  // ── Detach / float / drag ────────────────────────────────────────
  // Lift the tray off its action-bar button into a free-floating, draggable,
  // persistent panel. It freezes where it is, drops the stem + one-at-a-time
  // slot, grows a title bar, and survives other trays / phase flips.
  detach() {
    if (!this._detachable || this._detached || !this._open) return
    // Snap to the square floating size first, so the frozen position is right.
    this._detSmall = false
    this._applyDetSize()
    this._freezePosition()                 // pin current spot as left/top
    this._detached = true
    if (_active === this) _active = null    // leave the one-at-a-time slot
    this._trayEl.classList.add('detached', 'htr-detaching')
    setTimeout(() => this._trayEl?.classList.remove('htr-detaching'), 340)
    // Any click on the panel raises it to the front.
    this._trayEl.addEventListener('pointerdown', this._onFocusDownB)
    this.focus()
    // Let the owner reflow content for the new square shape (e.g. re-fit the map).
    this._onDetach?.()
  }

  // Apply the current floating size (large by default, small when toggled).
  _applyDetSize() {
    const sz = (this._detSmall && this._detachedSizeSmall) ? this._detachedSizeSmall : this._detachedSize
    if (!sz || !this._trayEl) return
    if (sz.width) this._trayEl.style.width = sz.width
    if (sz.height) this._trayEl.style.height = sz.height
    this._trayEl.classList.toggle('htr-small', this._detSmall)
  }

  // Toggle the floating panel between its two sizes (top-left stays put).
  _toggleSize() {
    if (!this._detached) return
    this._detSmall = !this._detSmall
    this._applyDetSize()
    if (this._sizeBtnEl) this._sizeBtnEl.textContent = this._detSmall ? '⤢' : '⤡'
    this._clampIntoView()
    this._onDetach?.()   // reflow + re-fit the map for the new size
  }

  // Keep the panel on screen (after a resize that grew it past the edge).
  _clampIntoView() {
    const layer = this._el, tray = this._trayEl
    if (!layer || !tray) return
    const lw = layer.offsetWidth, lh = layer.offsetHeight, tw = tray.offsetWidth, th = tray.offsetHeight
    const nl = Math.max(48 - tw, Math.min(parseFloat(tray.style.left) || 0, lw - 48))
    const nt = Math.max(0, Math.min(parseFloat(tray.style.top) || 0, lh - 30))
    tray.style.left = nl + 'px'
    tray.style.top = nt + 'px'
  }

  // Raise this floating panel above the others (re-append = top of stack) and
  // give it the focused border.
  focus() {
    const stage = document.getElementById('hud-stage')
    if (stage && this._el && stage.lastElementChild !== this._el) stage.appendChild(this._el)
    if (_focused && _focused !== this) _focused._trayEl?.classList.remove('focused')
    _focused = this
    this._trayEl?.classList.add('focused')
  }

  // Convert the current anchored (right/bottom) position into absolute left/top
  // in the layer's logical space, so dragging can move it freely.
  _freezePosition() {
    const layer = this._el, tray = this._trayEl
    if (!layer || !tray) return
    const lr = layer.getBoundingClientRect(), tr = tray.getBoundingClientRect()
    const s = (layer.offsetWidth && lr.width) ? (lr.width / layer.offsetWidth) : 1
    tray.style.left = ((tr.left - lr.left) / s) + 'px'
    tray.style.top = ((tr.top - lr.top) / s) + 'px'
    tray.style.right = ''
    tray.style.bottom = ''
  }

  // Before a detached close, point the collapse origin back at the button so it
  // reads as flying home to re-dock.
  _aimRedock() {
    const layer = this._el, tray = this._trayEl
    const btn = document.querySelector(this._anchorSel)
    if (!layer || !tray || !btn) return
    const lr = layer.getBoundingClientRect(), tr = tray.getBoundingClientRect(), br = btn.getBoundingClientRect()
    const ox = ((br.left + br.width / 2) - tr.left) / Math.max(1, tr.width) * 100
    const oy = ((br.top + br.height / 2) - tr.top) / Math.max(1, tr.height) * 100
    tray.style.transformOrigin = `${Math.max(-50, Math.min(150, ox))}% ${Math.max(-50, Math.min(150, oy))}%`
  }

  // Decide which edge the detach pull-tab hugs: default right, but flip left if
  // the tray sits too close to the layer's right edge (so it never clips).
  _placeDetachTab() {
    if (!this._detachable || !this._detachTabEl || this._detached) return
    const layer = this._el, tray = this._trayEl
    if (!layer || !tray) return
    const lr = layer.getBoundingClientRect(), tr = tray.getBoundingClientRect()
    this._detachTabEl.classList.toggle('htr-detach-left', (tr.right + 30) > lr.right)
  }

  _dragDown(e) {
    if (e.button !== 0 || !this._detached) return
    if (e.target.closest('.htr-tb-x, .htr-tb-size')) return    // buttons aren't drag grips
    e.preventDefault()
    this.focus()
    const layer = this._el, tray = this._trayEl
    const lr = layer.getBoundingClientRect()
    const s = (layer.offsetWidth && lr.width) ? (lr.width / layer.offsetWidth) : 1
    this._drag = { sx: e.clientX, sy: e.clientY, sl: parseFloat(tray.style.left) || 0, st: parseFloat(tray.style.top) || 0, s }
    this._titleEl.classList.add('dragging')
    try { this._titleEl.setPointerCapture(e.pointerId) } catch {}
    window.addEventListener('pointermove', this._onDragMoveB)
    window.addEventListener('pointerup', this._onDragUpB)
  }

  _dragMove(e) {
    if (!this._drag) return
    const { sx, sy, sl, st, s } = this._drag
    const layer = this._el, tray = this._trayEl
    const lw = layer.offsetWidth, lh = layer.offsetHeight, tw = tray.offsetWidth, th = tray.offsetHeight
    // Clamp so at least a corner of the title bar stays grabbable on screen.
    const nl = Math.max(48 - tw, Math.min(sl + (e.clientX - sx) / s, lw - 48))
    const nt = Math.max(0, Math.min(st + (e.clientY - sy) / s, lh - 30))
    tray.style.left = nl + 'px'
    tray.style.top = nt + 'px'
  }

  _dragUp() { this._endDrag() }

  _endDrag() {
    this._drag = null
    this._titleEl?.classList.remove('dragging')
    window.removeEventListener('pointermove', this._onDragMoveB)
    window.removeEventListener('pointerup', this._onDragUpB)
  }

  destroy() {
    this.close()
    this._endDrag()
    this._trayEl?.removeEventListener('pointerdown', this._onFocusDownB)
    this._el?.remove()
    this._el = null
  }
}

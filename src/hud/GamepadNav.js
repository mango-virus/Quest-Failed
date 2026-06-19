// GamepadNav — controller / gamepad navigation for the whole DOM HUD
// (UI_POLISH_PLAN P1-2). Steam-Deck "Verified" needs the UI to be fully
// driveable without a mouse; every interactive surface in this game is
// already a native DOM <button> (BottomBar, TopBar, the ~20 Overlay-base
// modals, the popups, MainMenu), so we navigate NATIVE FOCUS spatially
// rather than wiring a bespoke focus model into each surface.
//
// One global singleton, installed from main.js (like motion.js / the
// custom cursor) so it covers the title screen BEFORE HudRoot mounts and
// survives run restarts. It owns no DOM and no gameState — pure input →
// focus / activation.
//
//   D-pad / left stick  → move focus to the nearest focusable in that
//                          direction (spatial nav over getBoundingClientRect)
//   A (button 0)        → activate (click) the focused element
//   B (button 1)        → "back" === pressing Esc everywhere (see _back)
//   LB / RB (4 / 5)     → cycle tabs in tabbed overlays (Settings / Codex)
//
// Focus is SCOPED to the topmost modal layer so it can't leak to chrome
// behind an open overlay. A visible amber-gold ring (html.gamepad-active
// :focus in styles.css) appears only while gamepad input is active and is
// dropped the moment the mouse moves — mirroring :focus-visible heuristics.
//
// The rAF poll runs ONLY while a gamepad is connected (zero cost otherwise).
//
// Out of scope (a separate future input problem): driving the dungeon WORLD
// cursor (placing rooms / aiming) with the stick. This item is HUD + menu +
// overlay navigation only.

import { EventBus } from '../systems/EventBus.js'

// Stick deadzone + key-repeat cadence (ms) for held directions.
const DEADZONE = 0.5
const REPEAT_DELAY = 380
const REPEAT_RATE  = 110

// The interactive full-screen modal layers, topmost-last in DOM order.
// `.overlay` covers the shared Overlay base (incl. its crypt `.qf-cov-layer`
// variant, which also carries `.overlay`); the other two are the bespoke
// popups. Mirrors the `.overlay` suppression check HudKeybinds uses — extend
// this list if a new full-screen modal type is added.
const MODAL_LAYER_SEL = '.overlay, .qf-cf-layer, .qf-nameentry'

// What counts as focusable for nav. Excludes disabled controls and anything
// explicitly removed from the tab order (tabindex="-1").
const FOCUSABLE_SEL = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// Tab-strip buttons for LB/RB cycling. Settings = .qf-op-catbtn, Codex =
// .qf-cdx-tab; both are <button>s with `.on` marking the active tab.
const TAB_SEL = '.qf-op-catbtn, .qf-cdx-tab'

class GamepadNavImpl {
  constructor() {
    this._installed = false
    this._connected = false
    this._raf = 0
    this._gamepadActive = false
    this._everInput = false
    this._lastScope = null
    // Per-direction hold state (edge-detect + repeat) and per-button edge state.
    this._dirState = { up: {}, down: {}, left: {}, right: {} }
    this._btnDown = {}
  }

  install() {
    if (this._installed || typeof window === 'undefined') return
    this._installed = true
    this._tickBound = () => this._tick()
    window.addEventListener('gamepadconnected', () => this._onConnect())
    window.addEventListener('gamepaddisconnected', () => this._onDisconnect())
    // Drop the gamepad-active state (and its focus ring) as soon as the
    // player touches the mouse — symmetric to :focus-visible behaviour.
    const dropMouse = () => this._markMouse()
    window.addEventListener('pointermove', dropMouse, { passive: true })
    window.addEventListener('pointerdown', dropMouse, { passive: true })
    // A pad may already be present (page reload with controller attached);
    // it won't surface in getGamepads() until first input, but try anyway.
    if (this._anyPad()) this._onConnect()
  }

  _anyPad() {
    try { return Array.from(navigator.getGamepads?.() || []).some(Boolean) }
    catch { return false }
  }

  _onConnect() {
    this._connected = true
    if (!this._raf) this._raf = requestAnimationFrame(this._tickBound)
  }

  _onDisconnect() {
    // Only stop once the LAST pad is gone.
    if (!this._anyPad()) this._connected = false
  }

  _tick() {
    if (!this._connected) { this._raf = 0; return }
    this._poll()
    this._syncScope()
    this._raf = requestAnimationFrame(this._tickBound)
  }

  // ── Input read ──────────────────────────────────────────────────────────
  _poll() {
    let pad = null
    for (const p of (navigator.getGamepads?.() || [])) { if (p) { pad = p; break } }
    if (!pad) return
    const now = performance.now()
    const pressed = (i) => pad.buttons[i]?.pressed === true
    const axis    = (i) => pad.axes[i] ?? 0

    const dirs = {
      up:    pressed(12) || axis(1) < -DEADZONE,
      down:  pressed(13) || axis(1) >  DEADZONE,
      left:  pressed(14) || axis(0) < -DEADZONE,
      right: pressed(15) || axis(0) >  DEADZONE,
    }
    for (const name of Object.keys(dirs)) {
      this._dir(name, dirs[name], now, () => this._move(name))
    }
    // Edge-only action buttons.
    this._edge(0, pressed(0), () => this._activate())   // A → select
    this._edge(1, pressed(1), () => this._back())       // B → back / Esc
    this._edge(4, pressed(4), () => this._tabCycle(-1)) // LB → prev tab
    this._edge(5, pressed(5), () => this._tabCycle(1))  // RB → next tab
  }

  // Directional press with initial delay + auto-repeat while held.
  _dir(name, isDown, now, fn) {
    const st = this._dirState[name]
    if (isDown) {
      if (!st.down) { st.down = true; st.next = now + REPEAT_DELAY; this._markActive(); fn() }
      else if (now >= st.next) { st.next = now + REPEAT_RATE; fn() }
    } else {
      st.down = false
    }
  }

  // Edge-detected button: fire once per press (no auto-repeat).
  _edge(i, isDown, fn) {
    if (isDown) {
      if (!this._btnDown[i]) { this._btnDown[i] = true; this._markActive(); fn() }
    } else {
      this._btnDown[i] = false
    }
  }

  // ── Active-state (controls the focus ring + custom-cursor hide) ──────────
  _markActive() {
    this._everInput = true
    if (!this._gamepadActive) {
      this._gamepadActive = true
      document.documentElement.classList.add('gamepad-active')
    }
  }

  _markMouse() {
    if (this._gamepadActive) {
      this._gamepadActive = false
      document.documentElement.classList.remove('gamepad-active')
    }
  }

  // ── Scope (the layer focus is confined to) ───────────────────────────────
  // Topmost open modal layer → that modal; else the title menu; else the
  // in-game HUD stage (chrome). Queried document-wide so popups that mount
  // outside #hud-stage are still caught; last match = topmost (append order).
  _scopeRoot() {
    const modals = document.querySelectorAll(MODAL_LAYER_SEL)
    if (modals.length) return modals[modals.length - 1]
    const menu = document.querySelector('.qf-cm')
    if (menu) return menu
    return document.getElementById('hud-stage') || document.body
  }

  // When the scope changes (an overlay opened/closed) and we've been driving
  // by gamepad, pull focus into the new scope's default so the ring follows.
  // Never steals focus from a text field the player is typing in.
  _syncScope() {
    const scope = this._scopeRoot()
    if (scope === this._lastScope) return
    this._lastScope = scope
    if (!this._everInput) return
    const ae = document.activeElement
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)
    const inScope = ae && ae !== document.body && scope.contains(ae)
    if (typing || inScope) return
    const cands = this._candidates(scope)
    if (cands.length) this._focus(this._defaultFocus(scope, cands))
  }

  // ── Focusable discovery ──────────────────────────────────────────────────
  _candidates(scope) {
    return Array.from(scope.querySelectorAll(FOCUSABLE_SEL))
      .filter((el) => this._isVisible(el) && !el.closest('[data-nav-skip]'))
  }

  _isVisible(el) {
    if (el.disabled) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    // offsetParent is null for display:none (and position:fixed) — allow the
    // fixed case explicitly since our chrome can be fixed-positioned.
    if (el.offsetParent === null) {
      let pos = ''
      try { pos = getComputedStyle(el).position } catch {}
      if (pos !== 'fixed') return false
    }
    const r = el.getBoundingClientRect()
    return r.width >= 2 && r.height >= 2
  }

  // Preferred initial focus: a primary/auto-focus control, else the
  // top-most then left-most candidate (reading order).
  _defaultFocus(scope, cands) {
    const pri = cands.find((el) => el.matches(
      '.btn.primary, .primary, .qcm-primary, [autofocus]'
    ))
    if (pri) return pri
    return cands.slice().sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
      return (ra.top - rb.top) || (ra.left - rb.left)
    })[0]
  }

  // ── Movement (spatial navigation) ────────────────────────────────────────
  _move(dir) {
    const scope = this._scopeRoot()
    const cands = this._candidates(scope)
    if (!cands.length) return
    const cur = document.activeElement
    if (!cur || cur === document.body || !scope.contains(cur) || !cands.includes(cur)) {
      this._focus(this._defaultFocus(scope, cands))
      return
    }
    const best = this._nearest(cur, cands, dir)
    if (best) this._focus(best)
  }

  // Nearest focusable in `dir` from `cur`, scored by primary-axis distance
  // plus a cross-axis-misalignment penalty (favours aligned neighbours).
  _nearest(cur, cands, dir) {
    const cr = cur.getBoundingClientRect()
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2
    let best = null, bestScore = Infinity
    for (const el of cands) {
      if (el === cur) continue
      const r = el.getBoundingClientRect()
      const ex = r.left + r.width / 2, ey = r.top + r.height / 2
      const dx = ex - cx, dy = ey - cy
      let primary, cross
      if (dir === 'left')       { if (dx > -1) continue; primary = -dx; cross = Math.abs(dy) }
      else if (dir === 'right') { if (dx <  1) continue; primary =  dx; cross = Math.abs(dy) }
      else if (dir === 'up')    { if (dy > -1) continue; primary = -dy; cross = Math.abs(dx) }
      else                      { if (dy <  1) continue; primary =  dy; cross = Math.abs(dx) }
      const score = primary + cross * 2
      if (score < bestScore) { bestScore = score; best = el }
    }
    return best
  }

  _focus(el) {
    if (!el) return
    this._markActive()
    try { el.focus({ preventScroll: true }) } catch { el.focus() }
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch {}
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  _activate() {
    const el = document.activeElement
    if (!el || el === document.body) return
    if (this._scopeRoot().contains(el) && typeof el.click === 'function') el.click()
  }

  // B === pressing Esc, everywhere (user decision, UI_POLISH_PLAN P1-2):
  //  * Any DOM modal open → synthetic window Escape closes it (overlays +
  //    MainMenu read e.key === 'Escape').
  //  * Title screen (no modal) → synthetic Escape too (MainMenu's Esc = QUIT).
  //  * In-game (no modal) → Phaser's scene keydown-ESC ignores synthetic
  //    events (keyCode 0), so emit OPEN_PAUSE_MENU directly — exactly what a
  //    real Esc does there. Net effect: B behaves identically to Esc.
  _back() {
    const modalOpen = document.querySelector(MODAL_LAYER_SEL)
    const onMenu = !!document.querySelector('.qf-cm')
    if (modalOpen || onMenu) { this._dispatchEsc(); return }
    if (document.querySelector('.qf-bottombar')) EventBus.emit('OPEN_PAUSE_MENU')
  }

  _dispatchEsc() {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
      bubbles: true, cancelable: true,
    }))
  }

  // LB/RB cycle the tab strip of a tabbed overlay (Settings / Codex). The
  // active tab carries `.on`; click the prev/next, then (after the overlay
  // re-renders its panel) re-focus the now-active tab so repeated LB/RB feel
  // continuous and a D-pad-down drops into the panel.
  _tabCycle(delta) {
    const scope = this._scopeRoot()
    const tabs = Array.from(scope.querySelectorAll(TAB_SEL)).filter((el) => this._isVisible(el))
    if (tabs.length < 2) return
    let idx = tabs.findIndex((t) => t.classList.contains('on'))
    if (idx < 0) idx = tabs.indexOf(document.activeElement)
    if (idx < 0) idx = 0
    const next = tabs[(idx + delta + tabs.length) % tabs.length]
    next.click()
    requestAnimationFrame(() => {
      const s = this._scopeRoot()
      const active = Array.from(s.querySelectorAll(TAB_SEL)).find((t) => t.classList.contains('on'))
      if (active) this._focus(active)
    })
  }
}

export const GamepadNav = new GamepadNavImpl()

export function installGamepadNav() { GamepadNav.install() }

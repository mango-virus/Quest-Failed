// HotkeyHints — small key-binding hints strip pinned just above the
// BottomBar. Visibility gated by the GAMEPLAY > SHOW HOTKEY HINTS toggle
// in Settings (persisted to localStorage as `qf.gameplay.hotkeys`).
//
// Not in the design source — the design's Settings claims this toggle
// exists, so this row is the rendering target. Subscribes to a synthetic
// `QF_SETTING_CHANGED` event SettingsOverlay can fire on APPLY for a
// no-reload refresh; failing that, the strip rechecks the flag every
// few seconds.

import { h } from './dom.js'

const STORAGE_KEY = 'qf.gameplay.hotkeys'

const HINTS = [
  { key: 'ESC',   label: 'PAUSE' },
  { key: 'SPACE', label: 'BEGIN DAY' },
  { key: 'M',     label: 'MOVE' },
  { key: 'X',     label: 'SELL' },
  { key: '1-4',   label: 'SPEED' },
  { key: 'R',     label: 'ROSTER' },
  { key: 'K',     label: 'KNOWLEDGE' },
  { key: 'I',     label: 'INTEL' },
]

export class HotkeyHints {
  constructor() {
    this._el = this._build()
    this._refresh()
    // Re-check every 2s as a defensive fallback in case the settings
    // change isn't broadcast. Cheap (one read of localStorage).
    this._tick = setInterval(() => this._refresh(), 2000)
    window.addEventListener('storage', () => this._refresh())
  }

  get el() { return this._el }

  _build() {
    return h('div', { className: 'qf-hotkey-hints', hidden: true },
      HINTS.map(hint => h('span', { className: 'qf-hotkey-hint' }, [
        h('span', { className: 'pix qf-hotkey-key' }, hint.key),
        h('span', { className: 'qf-hotkey-label' }, hint.label),
      ]))
    )
  }

  _isEnabled() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw == null) return true   // default-on (matches DEFAULTS in SettingsOverlay)
      return raw === 'true'
    } catch { return true }
  }

  _refresh() {
    const on = this._isEnabled()
    this._el.hidden = !on
  }

  destroy() {
    clearInterval(this._tick)
    this._el?.remove()
  }
}

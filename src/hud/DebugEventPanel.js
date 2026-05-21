// DebugEventPanel — designer playtest tool.
//
// A small always-visible "⚙ EVENT" button in the bottom-left corner.
// Click it (or press the backtick key) to open a picker that
// force-triggers any dungeon event on demand — the chosen event is
// scheduled immediately (night modals fire right away) and its
// day-phase effect lands on the next day, exactly like a rolled event.
//
// Emits DEBUG_FORCE_EVENT { id }; EventSystem handles it via forceEvent.
// Purely a dev tool — safe to delete this file + its HudRoot wiring
// before shipping.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

export class DebugEventPanel {
  constructor() {
    this._panel = null
    this._onKey = (e) => {
      if (e.key === '`' || e.code === 'Backquote') { e.preventDefault(); this.toggle() }
    }
    window.addEventListener('keydown', this._onKey)

    // Always-visible toggle button.
    this._btn = h('button', {
      className: 'qf-dbg-toggle',
      on: { click: () => this.toggle() },
      title: 'Debug — trigger a dungeon event (` to toggle)',
    }, '⚙ EVENT')
    document.body.appendChild(this._btn)
  }

  // Pull the event list out of whichever scene cache has events.json.
  _events() {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.('events')
      if (Array.isArray(v) && v.length) return v
    }
    return []
  }

  toggle() { this._panel ? this._close() : this._open() }

  _open() {
    if (this._panel) return
    const events = this._events()
      .slice()
      .sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id)))
    if (events.length === 0) return
    const select = h('select', { className: 'qf-dbg-select' },
      events.map(e => h('option', { value: e.id }, e.title || e.id)))
    this._panel = h('div', { className: 'qf-dbg-panel' }, [
      h('div', { className: 'qf-dbg-panel-head' }, [
        h('span', null, 'TRIGGER EVENT'),
        h('button', { className: 'qf-dbg-x', on: { click: () => this._close() } }, '×'),
      ]),
      select,
      h('button', {
        className: 'qf-dbg-fire',
        on: {
          click: () => {
            if (select.value) EventBus.emit('DEBUG_FORCE_EVENT', { id: select.value })
            this._close()
          },
        },
      }, 'FIRE'),
      h('div', { className: 'qf-dbg-note' }, 'Effect lands next day.'),
    ])
    document.body.appendChild(this._panel)
  }

  _close() {
    this._panel?.remove()
    this._panel = null
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey)
    this._close()
    this._btn?.remove()
    this._btn = null
  }
}

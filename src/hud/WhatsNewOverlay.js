// WhatsNewOverlay — the main-menu "WHAT'S NEW" panel. Shows the game
// updates a returning player has missed (entries newer than the highest
// id they've acknowledged), so they catch up on recent features the next
// time they open the game.
//
// Data: src/data/whatsNew.js (WHATS_NEW, newest entry first, monotonic id).
// Seen-tracking: a GLOBAL localStorage key (qf.whatsNew.lastSeenId) — not
//   per-character, since "haven't played in a while" is per-device. On
//   close we bump it to the newest id so the panel won't re-pop until the
//   next update ships.
//
// Surfaces (wired in MainMenuOverlay):
//   • Auto-pops once per session on the main menu when there's unseen news.
//   • A permanent "WHAT'S NEW" menu row (NEW badge while unseen) reopens it.
//
// Styling is inline (no styles.css dependency) on top of the shared
// Overlay shell, so the panel is fully self-contained.

import { h }       from './dom.js'
import { Overlay } from './Overlay.js'
import { WHATS_NEW } from '../data/whatsNew.js'

const SEEN_KEY = 'qf.whatsNew.lastSeenId'

function _lastSeenId() {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0 } catch { return 0 }
}
function _setLastSeenId(id) {
  try { localStorage.setItem(SEEN_KEY, String(id)) } catch { /* storage full / blocked — non-fatal */ }
}

// Newest id across all entries (entries aren't required to be pre-sorted).
function _latestId() {
  let max = 0
  for (const e of WHATS_NEW) if ((e?.id ?? 0) > max) max = e.id
  return max
}

export class WhatsNewOverlay {
  // Updates the player hasn't acknowledged yet, newest first.
  static unseenEntries() {
    const seen = _lastSeenId()
    return WHATS_NEW
      .filter(e => (e?.id ?? 0) > seen)
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
  }

  // Is there anything new to show? Drives the menu NEW badge + auto-pop gate.
  static hasUnseen() { return WhatsNewOverlay.unseenEntries().length > 0 }

  constructor(opts = {}) {
    this._onClose = opts.onClose ?? null
    // `full` mode (menu button) shows the entire changelog history; the
    // default (auto-pop) shows only what the player missed since last visit.
    this._full = !!opts.full
    this._overlay = null
  }

  open() {
    if (this._overlay) return false

    // Pick the entries + intro line based on mode.
    const allNewestFirst = WHATS_NEW.slice().sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
    let entries, intro
    if (this._full) {
      // Menu button: the complete changelog, newest first.
      entries = allNewestFirst
      intro   = 'RECENT UPDATES · NEWEST FIRST'
    } else {
      // Auto-pop: only the unseen updates. If the player is already caught
      // up (nothing new), fall back to the latest entry so it's never empty.
      const unseen = WhatsNewOverlay.unseenEntries()
      entries = unseen.length ? unseen : allNewestFirst.slice(0, 1)
      intro   = unseen.length ? 'SINCE YOU WERE LAST HERE' : 'YOU’RE ALL CAUGHT UP — LATEST UPDATE'
    }

    const body = h('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '2px 2px 6px' },
    }, [
      h('div', {
        className: 'pix',
        style: {
          fontSize: '10px', letterSpacing: '2px', color: 'var(--text-mute)',
          textAlign: 'center', marginBottom: '2px',
        },
      }, intro),
      ...entries.map(e => this._renderEntry(e)),
    ])

    this._overlay = new Overlay({
      title:     '✨  WHAT’S NEW  ✨',
      width:     560,
      height:    560,
      accent:    'var(--gold-bright, #ffd964)',
      frame:     'plain',   // subtle main-menu edge instead of the gold frame
      animation: 'unfurl',
      onClose: () => {
        // Mark everything seen so it won't re-pop until the next update.
        _setLastSeenId(_latestId())
        this._overlay = null
        this._onClose?.()
      },
      body,
    })
    this._overlay.open()
    return true
  }

  close() { this._overlay?.close() }

  _renderEntry(e) {
    const accent = 'var(--gold-bright, #ffd964)'
    return h('div', {
      style: {
        border: '2px solid color-mix(in srgb, ' + accent + ' 45%, #000)',
        background: 'linear-gradient(180deg, var(--bg-1), var(--bg-0))',
        boxShadow: '0 0 0 1px #000, inset 0 0 18px color-mix(in srgb, ' + accent + ' 10%, transparent)',
        padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: '8px',
      },
    }, [
      // Header: title on the left, version · date chip on the right.
      h('div', {
        style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' },
      }, [
        h('div', {
          className: 'pix',
          style: { fontSize: '14px', letterSpacing: '2px', color: accent, textShadow: '0 0 10px ' + accent },
        }, e.title ?? 'UPDATE'),
        h('div', {
          className: 'pix',
          style: { fontSize: '8px', letterSpacing: '1px', color: 'var(--text-dim)', whiteSpace: 'nowrap' },
        }, [e.version ? 'v' + e.version : null, e.version && e.date ? '  ·  ' : null, e.date ?? null]),
      ]),
      // Feature bullets.
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px' } },
        (e.items ?? []).map(it => h('div', {
          style: { display: 'flex', gap: '9px', alignItems: 'flex-start' },
        }, [
          h('span', { style: { fontSize: '15px', lineHeight: '1.3', flex: '0 0 auto' } }, it.icon ?? '•'),
          h('span', { style: { fontSize: '12.5px', lineHeight: '1.45', color: 'var(--text)' } }, it.text ?? ''),
        ]))),
    ])
  }

  destroy() { this.close() }
}

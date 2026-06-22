// WhatsNewOverlay — the main-menu "WHAT'S NEW" patch browser (crypt redesign).
//
// Left: a sidebar list of every patch (version · title · date), newest first,
// with a LATEST badge on the top one. Right: the selected patch's decree card
// (eyebrow + version + title + feature list + date). Gold-lit crypt shell.
//
// Data: src/data/whatsNew.js (WHATS_NEW, monotonic id). Seen-tracking: a GLOBAL
//   localStorage key (qf.whatsNew.lastSeenId) — bumped to the newest id on close
//   so the panel won't re-pop until the next update ships.
//
// Surfaces (wired in MainMenuOverlay): auto-pops once per session when there's
// unseen news (default mode), and the version chip reopens the full history.

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

  static hasUnseen() { return WhatsNewOverlay.unseenEntries().length > 0 }

  // A brand-new install has NO SEEN_KEY at all (vs a returning player who has a
  // number). A first-timer has no prior version to "catch up" from, so
  // auto-popping the whole back-catalogue of patch notes is confusing noise —
  // references to systems they've never seen. Silently baseline them to the
  // latest patch so WHAT'S NEW only ever auto-shows GENUINELY new patches from
  // here on. Returns true if this was a first run. Idempotent.
  static primeIfFirstRun() {
    let raw = null
    try { raw = localStorage.getItem(SEEN_KEY) } catch {}
    if (raw != null) return false
    _setLastSeenId(_latestId())
    return true
  }

  constructor(opts = {}) {
    this._onClose = opts.onClose ?? null
    // `full` mode (version chip) defaults the selection to the latest patch;
    // the default (auto-pop) selects the newest UNSEEN patch.
    this._full = !!opts.full
    this._overlay = null
    // All patches, newest first — the sidebar always lists the full history.
    this._entries = WHATS_NEW.slice().sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
    // Default selection: newest unseen (auto-pop) else the latest entry.
    const firstUnseen = WhatsNewOverlay.unseenEntries()[0]
    this._sel = (!this._full && firstUnseen ? firstUnseen.id : this._entries[0]?.id) ?? null
  }

  open() {
    if (this._overlay) return false
    this._overlay = new Overlay({
      eyebrow:    "THE BONEMAKER'S LEDGER",
      title:      "WHAT'S NEW",
      width:      980,
      height:     716,
      accent:     'var(--gold-bright, #ffd964)',
      atmosphere: true,
      onClose: () => {
        _setLastSeenId(_latestId())   // mark all seen → won't re-pop until next update
        this._overlay = null
        this._onClose?.()
      },
      body: this._renderBody(),
    })
    this._overlay.open()
    return true
  }

  close() { this._overlay?.close() }

  _rerenderBody() { if (this._overlay) this._overlay.setBody(this._renderBody()) }
  _selectPatch(id) { this._sel = id; this._rerenderBody() }

  _renderBody() {
    return h('div', { className: 'qf-wn' }, [
      this._renderSidebar(),
      this._renderDetail(),
    ])
  }

  _renderSidebar() {
    return h('div', { className: 'qf-wn-side' }, [
      h('div', { className: 'sil qf-wn-sidehd' }, `◆ ALL PATCHES · ${this._entries.length}`),
      ...this._entries.map((e, i) => h('button', {
        className: 'qf-wn-pbtn' + (e.id === this._sel ? ' on' : ''),
        on: { click: () => this._selectPatch(e.id) },
      }, [
        h('div', { className: 'pix qf-wn-pver' }, [
          'v' + (e.version ?? '—'),
          i === 0 && h('span', { className: 'sil qf-wn-platest' }, 'LATEST'),
        ]),
        h('div', { className: 'qf-wn-ptitle' }, e.title ?? 'UPDATE'),
        e.date && h('div', { className: 'sil qf-wn-pdate' }, e.date),
      ])),
    ])
  }

  _renderDetail() {
    const cur = this._entries.find(e => e.id === this._sel) || this._entries[0]
    if (!cur) return h('div', { className: 'qf-wn-detail' }, [])
    const isLatest = cur.id === this._entries[0]?.id
    return h('div', { className: 'qf-wn-detail' }, [
      h('div', { className: 'qf-wn-decree' }, [
        h('div', { className: 'sil qf-wn-eyebrow' },
          isLatest ? '◆ THE LATEST DECREE · SINCE YOU WERE LAST HERE ◆' : '◆ FROM THE LEDGER ◆'),
        h('div', { className: 'pix qf-wn-pnum' }, 'v' + (cur.version ?? '—')),
        h('div', { className: 'qf-wn-dhead' }, [
          h('div', { className: 'pix qf-wn-dtitle' }, cur.title ?? 'UPDATE'),
        ]),
        h('div', { className: 'qf-wn-ditems' },
          (cur.items ?? []).map(it => h('div', { className: 'qf-wn-item' }, [
            h('span', { className: 'qf-wn-ic' }, it.icon ?? '•'),
            h('span', { className: 'qf-wn-tx' }, it.text ?? ''),
          ]))),
        cur.date && h('div', { className: 'sil qf-wn-date' }, 'PROCLAIMED · ' + cur.date),
      ]),
    ])
  }

  destroy() { this.close() }
}

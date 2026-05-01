// Phase 31C — Knowledge Pin (right HUD column).
//
// Always-visible compact summary of what adventurers know about the dungeon:
// up to 4 leaked facts + an EXPOSURE bar derived from how much intel the
// shared pool has accumulated. Click opens the full Knowledge Map popup
// (31E) — emits OPEN_KNOWLEDGE_MAP via EventBus.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelBar } from './UIKit.js'
import { EventBus } from '../systems/EventBus.js'

const DEFAULT_PANEL_W = 280
const HEADER_H      = 22
const ROW_H         = 20         // Press Start 2P at 8px renders ~14px tall; 20 gives safe row height
const ROW_GAP       = 3
const FACT_LIMIT    = 4
const PADDING       = 8

export class KnowledgePin {
  constructor(scene, gameState, opts = {}) {
    this._scene     = scene
    this._gameState = gameState
    this._depth     = opts.depth ?? 60
    this._w         = opts.w ?? DEFAULT_PANEL_W
    this._x         = opts.x ?? (scene.uiW ?? 1280) - this._w - 12
    this._y         = opts.y ?? 80
    this._objects   = []
    this._rowTexts  = []
    this._dirty     = true

    this._build()
  }

  _build() {
    const D = this._depth
    const x = this._x
    const y = this._y
    const h = this._panelHeight()

    const bg = this._scene.add.graphics().setDepth(D)
    pixelPanel(bg, x, y, this._w, h)
    this._objects.push(bg)

    // Header strip
    const headerG = this._scene.add.graphics().setDepth(D + 1)
    headerG.fillStyle(CRYPT.panel2, 1)
    headerG.fillRect(x + 2, y + 2, this._w - 4, HEADER_H)
    headerG.fillStyle(CRYPT.panelEdgeS, 1)
    headerG.fillRect(x + 2, y + 2 + HEADER_H, this._w - 4, 1)
    this._objects.push(headerG)

    const hdr = this._scene.add.text(x + PADDING, y + HEADER_H / 2 + 2,
      'ADVENTURER INTEL', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(D + 2)
    this._objects.push(hdr)

    this._countT = this._scene.add.text(x + this._w - PADDING, y + HEADER_H / 2 + 2,
      this._countText(), {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.soulCss, letterSpacing: 1,
    }).setOrigin(1, 0.5).setDepth(D + 2)
    this._objects.push(this._countT)

    // Row container area
    const rowsTop = y + HEADER_H + 6
    const facts = this._topFacts()
    for (let i = 0; i < FACT_LIMIT; i++) {
      const ry = rowsTop + i * (ROW_H + ROW_GAP)
      const rowG = this._scene.add.graphics().setDepth(D + 1)
      rowG.fillStyle(CRYPT.bgStone1, 1)
      rowG.fillRect(x + PADDING, ry, this._w - PADDING * 2, ROW_H)
      rowG.fillStyle(CRYPT.panelEdgeS, 1)
      rowG.fillRect(x + PADDING, ry + ROW_H - 1, this._w - PADDING * 2, 1)
      this._objects.push(rowG)

      const fact = facts[i]
      const factT = this._scene.add.text(x + PADDING + 4, ry + ROW_H / 2,
        fact ? this._truncate(fact.label, 22) : '—', {
        fontFamily: FONT_BODY, fontSize: '9px',
        color: fact ? CRYPT.ink : CRYPT.inkMute, letterSpacing: 1,
      }).setOrigin(0, 0.5).setDepth(D + 2)

      const lvlT = this._scene.add.text(x + this._w - PADDING - 4, ry + ROW_H / 2,
        fact ? fact.lvl : '', {
        fontFamily: FONT_HEAD, fontSize: '7px',
        color: fact ? this._lvlColor(fact.lvl) : CRYPT.inkMute, letterSpacing: 1,
      }).setOrigin(1, 0.5).setDepth(D + 2)

      this._objects.push(factT, lvlT)
      this._rowTexts.push({ factT, lvlT })
    }

    // Exposure bar
    const expY = rowsTop + FACT_LIMIT * (ROW_H + ROW_GAP) + 4
    const expLbl = this._scene.add.text(x + PADDING, expY,
      'EXPOSURE', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setOrigin(0, 0).setDepth(D + 2)
    this._objects.push(expLbl)

    const expVal = this._exposurePct()
    this._exposurePctT = this._scene.add.text(x + this._w - PADDING, expY,
      `${expVal}%`, {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.accent2Css, letterSpacing: 1,
    }).setOrigin(1, 0).setDepth(D + 2)
    this._objects.push(this._exposurePctT)

    this._exposureBar = pixelBar(this._scene, x + PADDING, expY + 14,
      this._w - PADDING * 2, 8, expVal, 100, {
        color: 'red', label: null, depth: D + 2,
      })
    this._objects.push(this._exposureBar.g)

    // Whole-panel hit zone — opens Knowledge Map popup
    const hit = this._scene.add.zone(x, y, this._w, h)
      .setOrigin(0).setDepth(D + 10).setInteractive({ useHandCursor: true })
    hit.on('pointerup', () => EventBus.emit('OPEN_KNOWLEDGE_MAP'))
    this._objects.push(hit)
  }

  _panelHeight() {
    return HEADER_H + 6 + FACT_LIMIT * (ROW_H + ROW_GAP) + 4 + 14 + 8 + PADDING
  }

  _topFacts() {
    // Pull a flat list of leaked facts from gameState.knowledge.sharedPool.
    // Each room/trap/minion entry's keys are facts; values track confidence.
    // For now, just produce a synthetic list from the shared pool keys —
    // KnowledgeSystem will gain a proper accessor in 31E.
    const pool = this._gameState.knowledge?.sharedPool ?? {}
    const out = []
    for (const k of Object.keys(pool.rooms ?? {})) {
      out.push({ label: `Room: ${k}`,    lvl: this._levelFor(pool.rooms[k]) })
    }
    for (const k of Object.keys(pool.traps ?? {})) {
      out.push({ label: `Trap: ${k}`,    lvl: this._levelFor(pool.traps[k]) })
    }
    for (const k of Object.keys(pool.enemiesPerRoom ?? {})) {
      out.push({ label: `Enemy: ${k}`,   lvl: this._levelFor(pool.enemiesPerRoom[k]) })
    }
    // Sort: FULL > PARTIAL > RUMOR
    const order = { FULL: 0, PARTIAL: 1, RUMOR: 2 }
    out.sort((a, b) => (order[a.lvl] ?? 9) - (order[b.lvl] ?? 9))
    return out.slice(0, FACT_LIMIT)
  }

  _levelFor(entry) {
    // Heuristic until KnowledgeSystem exposes a proper level: read .accuracy
    // / .level / boolean truthy. Anything > 0.7 -> FULL, > 0.3 -> PARTIAL,
    // else RUMOR.
    if (entry == null) return 'RUMOR'
    if (entry === true) return 'FULL'
    const acc = entry.accuracy ?? entry.level ?? entry
    if (typeof acc === 'number') {
      if (acc >= 0.7) return 'FULL'
      if (acc >= 0.3) return 'PARTIAL'
      return 'RUMOR'
    }
    return 'PARTIAL'
  }

  _lvlColor(lvl) {
    return lvl === 'FULL'    ? CRYPT.accent2Css
         : lvl === 'PARTIAL' ? CRYPT.warnCss
         : CRYPT.soulCss
  }

  _countText() {
    const facts = this._topFacts()
    const n = facts.length
    return n === 0 ? 'NO LEAKS' : `${n} LEAK${n === 1 ? '' : 'S'}`
  }

  _exposurePct() {
    // Coarse heuristic: percentage of "fact slots" that have entries.
    const pool   = this._gameState.knowledge?.sharedPool ?? {}
    const known  = (pool.rooms ? Object.keys(pool.rooms).length : 0)
                 + (pool.traps ? Object.keys(pool.traps).length : 0)
    const total  = Math.max(1, (this._gameState.dungeon?.rooms?.length ?? 0)
                            + (this._gameState.dungeon?.traps?.length ?? 0))
    return Math.min(100, Math.round((known / total) * 100))
  }

  _truncate(s, n) {
    s = String(s ?? '')
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }

  // Polled per frame; we re-read intel + exposure cheaply.
  update() {
    if (!this._gameState || !this._countT) return
    this._countT.setText(this._countText())
    const facts = this._topFacts()
    for (let i = 0; i < FACT_LIMIT; i++) {
      const r = this._rowTexts[i]
      const f = facts[i]
      if (!r) continue
      r.factT.setText(f ? this._truncate(f.label, 22) : '—')
      r.factT.setColor(f ? CRYPT.ink : CRYPT.inkMute)
      r.lvlT.setText(f ? f.lvl : '')
      if (f) r.lvlT.setColor(this._lvlColor(f.lvl))
    }
    const pct = this._exposurePct()
    this._exposurePctT.setText(`${pct}%`)
    this._exposureBar.update(pct, 100)
  }

  destroy() {
    this._objects.forEach(o => o?.destroy?.())
    this._objects = []
    this._rowTexts = []
    this._exposureBar = null
  }
}

export const KNOWLEDGE_PIN_WIDTH = DEFAULT_PANEL_W

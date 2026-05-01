// Phase 31E — Knowledge Map popup.
//
// Two-column: large dungeon map on the left with rooms color-coded by
// adventurer-knowledge accuracy (FULL / PARTIAL / RUMOR / UNKNOWN), and
// an Intel Ledger sidebar on the right listing each leaked fact with
// 'via {adventurerName}' attribution.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelDiamond } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'
import { Balance } from '../../config/balance.js'

// Color per accuracy level — matches the design.
const LVL_COLOR = {
  FULL:    CRYPT.accent,
  PARTIAL: CRYPT.warn,
  RUMOR:   CRYPT.soul,
  UNKNOWN: CRYPT.inkMuteHex,
}
const LVL_COLOR_CSS = {
  FULL:    CRYPT.accentCss,
  PARTIAL: CRYPT.warnCss,
  RUMOR:   CRYPT.soulCss,
  UNKNOWN: CRYPT.inkMute,
}

export class KnowledgeMapPopup {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._frame = makePopupFrame({
      scene,
      w:    1080,
      h:    620,
      title:'KNOWLEDGE MAP',
      depth: 200,
      render: (px, py, cx, cy, cw, ch, addChild) => this._render(cx, cy, cw, ch, addChild),
    })
  }

  open()  { this._frame.open() }
  close() { this._frame.close() }
  destroy() { this.close() }

  _render(cx, cy, cw, ch, addChild) {
    const D = 205
    const sidebarW = 340
    const gap = 14
    this._renderMap(cx, cy, cw - sidebarW - gap, ch, D, addChild)
    this._renderLedger(cx + cw - sidebarW, cy, sidebarW, ch, D, addChild)
  }

  _renderMap(x, y, w, h, D, addChild) {
    const card = this._scene.add.graphics().setDepth(D)
    pixelPanel(card, x, y, w, h, { fill: CRYPT.bgStone1 })
    addChild(card)

    // Header
    const dia = this._scene.add.graphics().setDepth(D + 2)
    pixelDiamond(dia, x + 12, y + 14, 4, CRYPT.accent2)
    addChild(dia)
    addChild(this._scene.add.text(x + 24, y + 14, 'DUNGEON', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(D + 2))
    addChild(this._scene.add.text(x + w - 12, y + 14, `EXPOSURE ${this._exposurePct()}%`, {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.accent2Css, letterSpacing: 2,
    }).setOrigin(1, 0.5).setDepth(D + 2))

    // Inner map area
    const mapTop = y + 28
    const legendH = 24
    const mapH   = h - 28 - legendH - 12
    const mapW   = w - 24
    const mapX   = x + 12
    const innerG = this._scene.add.graphics().setDepth(D + 1)
    pixelPanel(innerG, mapX, mapTop, mapW, mapH, {
      fill: CRYPT.bgDeep, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(innerG)

    // Project rooms with uniform scale
    const dungeon = this._gameState.dungeon ?? {}
    const gw = dungeon.gridWidth  ?? Balance.STARTING_GRID_WIDTH
    const gh = dungeon.gridHeight ?? Balance.STARTING_GRID_HEIGHT
    const innerW = mapW - 8
    const innerH = mapH - 8
    const scale = Math.min(innerW / gw, innerH / gh)
    const offX  = mapX + 4 + Math.round((innerW - gw * scale) / 2)
    const offY  = mapTop + 4 + Math.round((innerH - gh * scale) / 2)

    // Faint grid every 4 tiles
    const grid = this._scene.add.graphics().setDepth(D + 2).setAlpha(0.12)
    grid.lineStyle(1, 0xffffff, 1)
    for (let i = 4; i < gw; i += 4) {
      const lx = offX + Math.round(i * scale)
      grid.lineBetween(lx, offY, lx, offY + gh * scale)
    }
    for (let j = 4; j < gh; j += 4) {
      const ly = offY + Math.round(j * scale)
      grid.lineBetween(offX, ly, offX + gw * scale, ly)
    }
    addChild(grid)

    // Render rooms with knowledge color
    const pool = this._gameState.knowledge?.sharedPool ?? {}
    const rooms = dungeon.rooms ?? []
    const roomG = this._scene.add.graphics().setDepth(D + 3)
    for (const room of rooms) {
      const lvl = this._levelFor(pool.rooms?.[room.instanceId])
      const c = LVL_COLOR[lvl] ?? CRYPT.wall
      const rx = offX + Math.round(room.gridX * scale)
      const ry = offY + Math.round(room.gridY * scale)
      const rw = Math.max(4, Math.round(room.width  * scale))
      const rh = Math.max(4, Math.round(room.height * scale))
      roomG.fillStyle(c, lvl === 'UNKNOWN' ? 0.6 : 1)
      roomG.fillRect(rx, ry, rw, rh)
      roomG.lineStyle(1, 0x000000, 0.7)
      roomG.strokeRect(rx, ry, rw, rh)
    }
    addChild(roomG)

    // Legend strip
    const legendY = mapTop + mapH + 6
    const items = [
      { lvl: 'FULL',    note: 'they will route around it' },
      { lvl: 'PARTIAL', note: 'they suspect' },
      { lvl: 'RUMOR',   note: 'vague intel' },
      { lvl: 'UNKNOWN', note: 'your edge' },
    ]
    let lx = mapX
    const colW = Math.floor(mapW / items.length)
    for (const it of items) {
      const sw = this._scene.add.graphics().setDepth(D + 2)
      sw.fillStyle(LVL_COLOR[it.lvl], 1)
      sw.fillRect(lx, legendY + 6, 8, 8)
      addChild(sw)
      addChild(this._scene.add.text(lx + 12, legendY + 4, it.lvl, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: LVL_COLOR_CSS[it.lvl], letterSpacing: 1,
      }).setDepth(D + 2))
      addChild(this._scene.add.text(lx + 12, legendY + 14, it.note, {
        fontFamily: FONT_BODY, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setDepth(D + 2))
      lx += colW
    }
  }

  _renderLedger(x, y, w, h, D, addChild) {
    const card = this._scene.add.graphics().setDepth(D)
    pixelPanel(card, x, y, w, h, { fill: CRYPT.bgStone1 })
    addChild(card)

    // Header
    const dia = this._scene.add.graphics().setDepth(D + 2)
    pixelDiamond(dia, x + 12, y + 14, 4, CRYPT.accent2)
    addChild(dia)
    addChild(this._scene.add.text(x + 24, y + 14, 'INTEL LEDGER', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(D + 2))

    const facts = this._collectFacts()
    if (facts.length === 0) {
      addChild(this._scene.add.text(x + w / 2, y + h / 2, '— NO INTEL LEAKED —', {
        fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
      return
    }

    let yy = y + 36
    const rowH = 30
    const maxRows = Math.floor((h - 36 - 8) / rowH)
    for (const f of facts.slice(0, maxRows)) {
      const rowG = this._scene.add.graphics().setDepth(D + 1)
      pixelPanel(rowG, x + 8, yy, w - 16, rowH - 4, {
        fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
      })
      addChild(rowG)
      addChild(this._scene.add.text(x + 16, yy + 6, this._truncate(f.label, 28), {
        fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.ink, letterSpacing: 1,
      }).setDepth(D + 3))
      addChild(this._scene.add.text(x + w - 16, yy + 6, f.lvl, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: LVL_COLOR_CSS[f.lvl], letterSpacing: 1,
      }).setOrigin(1, 0).setDepth(D + 3))
      addChild(this._scene.add.text(x + 16, yy + 16,
        f.via ? `via ${f.via}` : 'via undiscovered observers', {
        fontFamily: FONT_BODY, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setDepth(D + 3))
      yy += rowH
    }
  }

  _collectFacts() {
    const pool   = this._gameState.knowledge?.sharedPool ?? {}
    const rooms  = this._gameState.dungeon?.rooms ?? []
    const traps  = this._gameState.dungeon?.traps ?? []
    const roomDefs  = this._scene.cache.json.get('rooms')      ?? []
    const trapDefs  = this._scene.cache.json.get('trapTypes')  ?? []

    const out = []
    const addFromPool = (poolMap, lookup, prefix = '') => {
      for (const k of Object.keys(poolMap ?? {})) {
        const entry = poolMap[k]
        out.push({
          label: prefix + lookup(k),
          via:   entry?.sharedBy ?? entry?.source ?? null,
          lvl:   this._levelFor(entry),
        })
      }
    }
    addFromPool(pool.rooms, (id) => {
      const r = rooms.find(x => x.instanceId === id)
      const d = roomDefs.find(x => x.id === r?.definitionId)
      return d?.name ?? r?.definitionId ?? id
    })
    addFromPool(pool.traps, (id) => {
      const t = traps.find(x => x.instanceId === id)
      const d = trapDefs.find(x => x.id === t?.definitionId)
      return `Trap: ${d?.name ?? t?.definitionId ?? id}`
    })
    addFromPool(pool.enemiesPerRoom, (id) => {
      const r = rooms.find(x => x.instanceId === id)
      const d = roomDefs.find(x => x.id === r?.definitionId)
      return `Enemies in ${d?.name ?? r?.definitionId ?? id}`
    })
    // De-dup labels
    const seen = new Set()
    const unique = []
    for (const f of out) {
      if (seen.has(f.label)) continue
      seen.add(f.label)
      unique.push(f)
    }
    const order = { FULL: 0, PARTIAL: 1, RUMOR: 2, UNKNOWN: 3 }
    unique.sort((a, b) => (order[a.lvl] ?? 9) - (order[b.lvl] ?? 9))
    return unique
  }

  _levelFor(entry) {
    if (entry == null) return 'UNKNOWN'
    if (entry === true) return 'FULL'
    const acc = entry.accuracy ?? entry.level ?? entry
    if (typeof acc === 'number') {
      if (acc >= 0.7) return 'FULL'
      if (acc >= 0.3) return 'PARTIAL'
      return 'RUMOR'
    }
    return 'PARTIAL'
  }

  _exposurePct() {
    const pool = this._gameState.knowledge?.sharedPool ?? {}
    const known = (pool.rooms ? Object.keys(pool.rooms).length : 0)
                + (pool.traps ? Object.keys(pool.traps).length : 0)
    const total = Math.max(1, (this._gameState.dungeon?.rooms?.length ?? 0)
                            + (this._gameState.dungeon?.traps?.length ?? 0))
    return Math.min(100, Math.round((known / total) * 100))
  }

  _truncate(s, n) {
    s = String(s ?? '')
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }
}

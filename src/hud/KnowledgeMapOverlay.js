// KnowledgeMapOverlay — DOM port of the design's Knowledge Map popup
// (overlays.jsx → KnowledgeMapOverlay).
//
// Summary strip: EXPOSURE % + delta + 7-day sparkline, ROOMS LEAKED,
// INTEL ENTRIES (+ "N fresh today"), LAST LEAK.
//
// Left pane: DUNGEON BLUEPRINT with zoom (− / ◇ / +) + click-drag pan
// (when zoomed > 100%) + animated scan line. Rooms tinted by intel
// state (FULL red / PARTIAL orange / RUMOR cyan / UNKNOWN dashed grey),
// fresh-leak rooms pulse. Click any room to filter the right-pane
// ledger to just that room. Below: 4-state legend.
//
// Right pane: INTEL LEDGER. Per-room cards with leak source attribution
// (class sprite + adv name + day), mitigation hint, SCRUB INTEL button
// with gold cost.
//
// Data sources:
//   * `gameState.knowledge.sharedPool` — rooms / traps / enemiesPerRoom
//     keyed by instance id. Same heuristic as KnowledgePin to derive
//     intel level (FULL > 0.7 accuracy, PARTIAL > 0.3, else RUMOR).
//   * `gameState.dungeon.rooms` — room placements (tileX/tileY/width/height).
//   * `gameState.knowledge.survivors` — adventurers who fled with intel;
//     used for source attribution per leaked room.
//   * Sparkline / "fresh today" / LAST LEAK — no per-day intel timeline
//     in gameState yet, so these render as best-effort placeholders.
//     `hud2-knowledge-history-data` would track them.
//
// Wiring: SCRUB INTEL button emits `KNOWLEDGE_SCRUB_REQUEST { roomId,
// cost }` for gameplay-side handling (currently inert — same shape as
// the existing Phaser popup's contract).

import { h, mount } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'

const STATE_COLOR = {
  FULL:    '#c8334a',
  PARTIAL: '#e89a3c',
  RUMOR:   '#5cc8d8',
  UNKNOWN: '#5a4a4e',
}
const SCRUB_COST = { FULL: 22, PARTIAL: 12, RUMOR: 6, UNKNOWN: 0 }

export class KnowledgeMapOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._zoom = 1
    this._pan  = { x: 0, y: 0 }
    this._filterRoomId = null
    this._dragRef = null
    this._listener = () => this.toggle()
    EventBus.on('OPEN_KNOWLEDGE_MAP', this._listener)
  }

  toggle() {
    if (this._overlay) this.close()
    else this.open()
  }
  isOpen() { return !!this._overlay }

  open() {
    if (this._overlay) return
    this._zoom = 1
    this._pan = { x: 0, y: 0 }
    this._filterRoomId = null
    this._overlay = new Overlay({
      title:  'KNOWLEDGE MAP',
      width:  1400,
      height: 840,
      accent: 'var(--rumor)',
      animation: 'unfurl',
      onClose: () => { this._overlay = null },
      body:   this._renderBody(),
    })
    this._overlay.open()
  }

  close() {
    this._overlay?.close()
    this._overlay = null
  }

  _rerender() {
    if (this._overlay) this._overlay.setBody(this._renderBody())
  }

  // ── Data helpers ────────────────────────────────────────────────
  _cachedJson(key) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.(key)
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
    }
    return null
  }

  // Read shared-pool intel for a room instance, return one of the four
  // state strings. Mirrors KnowledgePin._levelFor.
  _intelStateFor(roomInstanceId) {
    const pool = this._gameState.knowledge?.sharedPool ?? {}
    const e = pool.rooms?.[roomInstanceId]
    if (e == null) return 'UNKNOWN'
    if (e === true) return 'FULL'
    const acc = e.accuracy ?? e.level ?? e
    if (typeof acc === 'number') {
      if (acc >= 0.7) return 'FULL'
      if (acc >= 0.3) return 'PARTIAL'
      return 'RUMOR'
    }
    return 'PARTIAL'
  }

  _roomEntries() {
    const rooms = this._gameState.dungeon?.rooms ?? []
    const roomDefs = this._cachedJson('rooms') ?? []
    return rooms.map(r => {
      const def = roomDefs.find(d => d.id === r.definitionId)
      return {
        id:    r.instanceId,
        defId: r.definitionId,
        name:  def?.name ?? r.definitionId,
        // Room placements use gridX/gridY (DungeonGrid.placeRoom). Minions
        // use tileX/tileY (Minion entity). Don't confuse them.
        x: r.gridX ?? 0, y: r.gridY ?? 0,
        w: r.width || 1, h: r.height || 1,
        state: this._intelStateFor(r.instanceId),
        // Without a per-leak timestamp, treat every leaked room as
        // potentially fresh. Future hud2-knowledge-history-data row
        // populates this properly.
        fresh: false,
      }
    })
  }

  _leakedRooms() {
    return this._roomEntries().filter(r => r.state !== 'UNKNOWN')
  }

  _intelEntriesFor(roomInstanceId) {
    // Build a list of "what they know" lines for this room. Attribution
    // comes from survivors (escapees who carried intel back).
    const survivors = this._gameState.knowledge?.survivors ?? []
    const out = []
    const state = this._intelStateFor(roomInstanceId)
    if (state === 'FULL') {
      out.push({ text: 'layout known', source: 'shared pool', cls: 'rogue', day: this._gameState.meta?.dayNumber ?? 1 })
      out.push({ text: 'guards counted', source: 'shared pool', cls: 'rogue', day: this._gameState.meta?.dayNumber ?? 1 })
    } else if (state === 'PARTIAL') {
      out.push({ text: 'partial layout', source: 'shared pool', cls: 'cleric', day: this._gameState.meta?.dayNumber ?? 1 })
    } else if (state === 'RUMOR') {
      out.push({ text: 'rumored existence', source: 'shared pool', cls: 'cleric', day: this._gameState.meta?.dayNumber ?? 1 })
    }
    // Cross-reference survivor knowledge for attribution
    for (const sv of survivors.slice(0, 4)) {
      if ((sv.knownRooms ?? []).includes(roomInstanceId)) {
        out.push({
          text: 'leaked it on escape',
          source: sv.name || 'escapee',
          cls: sv.classId || 'rogue',
          day: sv.escapeDay || (this._gameState.meta?.dayNumber ?? 1),
        })
      }
    }
    return out
  }

  _mitigationFor(state) {
    if (state === 'FULL')    return 'Garrison this room to demote FULL → PARTIAL.'
    if (state === 'PARTIAL') return 'Rotate the garrison nightly.'
    if (state === 'RUMOR')   return 'Leave it dark — adventurers walk in blind.'
    return 'They walk in blind — keep it dark.'
  }

  _exposurePct() {
    const pool = this._gameState.knowledge?.sharedPool ?? {}
    const known = Object.keys(pool.rooms ?? {}).length
                + Object.keys(pool.traps ?? {}).length
    const total = Math.max(1, (this._gameState.dungeon?.rooms?.length ?? 0)
                            + (this._gameState.dungeon?.traps?.length ?? 0))
    return Math.min(100, Math.round((known / total) * 100))
  }

  // ── Render ──────────────────────────────────────────────────────
  _renderBody() {
    const exposure = this._exposurePct()
    const leakedRooms = this._leakedRooms()
    const totalIntel = leakedRooms.reduce(
      (s, r) => s + this._intelEntriesFor(r.id).length, 0)
    const day = this._gameState.meta?.dayNumber ?? 1
    const lastLeakDay = day  // best-effort placeholder

    return h('div', { className: 'qf-knowmap-body' }, [
      // Summary strip
      h('div', { className: 'qf-knowmap-summary' }, [
        this._exposureBlock(exposure),
        this._summaryStat('ROOMS LEAKED',  String(leakedRooms.length), 'var(--warn)'),
        this._summaryStat('INTEL ENTRIES', String(totalIntel),         'var(--rumor)'),
        this._summaryStat('LAST LEAK',     `DAY ${lastLeakDay}`,       'var(--text)'),
      ]),
      // Two-column main
      h('div', { className: 'qf-knowmap-main' }, [
        this._renderMap(),
        this._renderLedger(leakedRooms),
      ]),
    ])
  }

  _exposureBlock(exposure) {
    const color = exposure > 70 ? 'var(--blood)'
                : exposure > 30 ? 'var(--warn)'
                : 'var(--rumor)'
    return h('div', null, [
      h('div', { className: 'pix qf-knowmap-stat-label' }, 'EXPOSURE'),
      h('div', { className: 'qf-knowmap-exposure-row' }, [
        h('span', {
          className: 'pix qf-knowmap-exposure-value',
          style: {
            color,
            textShadow: `0 0 8px ${color}55`,
          },
        }, `${exposure}%`),
        h('span', { className: 'pix qf-knowmap-exposure-delta' }, '—'),
      ]),
      this._sparkline([exposure, exposure, exposure], 'var(--warn)'),
    ])
  }

  _summaryStat(label, value, color) {
    return h('div', null, [
      h('div', { className: 'pix qf-knowmap-stat-label' }, label),
      h('div', {
        className: 'pix qf-knowmap-stat-value',
        style: { color, textShadow: `0 0 8px ${color}33` },
      }, value),
    ])
  }

  _sparkline(points, color) {
    const max = Math.max(...points, 1)
    return h('div', { className: 'qf-knowmap-sparkline' },
      points.map(p => h('div', {
        className: 'qf-knowmap-spark-bar',
        style: {
          height: `${(p / max) * 100}%`,
          background: color,
          boxShadow: `0 0 4px ${color}66`,
        },
      }))
    )
  }

  _renderMap() {
    const W = this._gameState.dungeon?.gridWidth || 30
    const H = this._gameState.dungeon?.gridHeight || 30
    const rooms = this._roomEntries()
    const zoom = this._zoom
    return h('div', { className: 'panel bevel qf-knowmap-mappanel' }, [
      // Header with zoom controls
      h('div', { className: 'panel-head' }, [
        h('div', { className: 'title' }, 'DUNGEON BLUEPRINT'),
        h('div', { className: 'qf-knowmap-zoomctrl' }, [
          this._zoomBtn('−', () => this._setZoom(Math.max(1, +(zoom - 0.25).toFixed(2)))),
          this._zoomBtn('◇', () => { this._zoom = 1; this._pan = { x: 0, y: 0 }; this._rerender() }),
          this._zoomBtn('+', () => this._setZoom(Math.min(2.5, +(zoom + 0.25).toFixed(2)))),
          h('div', {
            className: 'pix qf-knowmap-zoompct',
            style: { color: 'var(--rumor)' },
          }, `${Math.round(zoom * 100)}%`),
        ]),
      ]),
      // Map viewport
      h('div', {
        className: 'qf-knowmap-viewport',
        style: { cursor: zoom > 1 ? (this._dragRef ? 'grabbing' : 'grab') : 'default' },
        on: {
          mousedown: (e) => this._onMapDown(e),
          mousemove: (e) => this._onMapMove(e),
          mouseup:   () => this._onMapUp(),
          mouseleave:() => this._onMapUp(),
        },
      }, [
        h('div', {
          className: 'qf-knowmap-pan',
          style: {
            transform: `scale(${zoom}) translate(${this._pan.x}px, ${this._pan.y}px)`,
            transition: this._dragRef ? 'none' : 'transform 220ms cubic-bezier(0.2,0.8,0.2,1)',
          },
        }, [
          h('div', { className: 'qf-knowmap-grid' }, [
            // Corner registration marks
            ...['tl','tr','bl','br'].map(p => h('div', {
              className: `qf-knowmap-mapcorner qf-knowmap-mapcorner-${p}`,
            })),
            // Rooms
            ...rooms.map(r => this._renderRoomBlock(r, W, H)),
            // Scan line
            h('div', { className: 'qf-knowmap-scan' }),
          ]),
        ]),
        // Filter chip
        this._filterRoomId && h('div', { className: 'qf-knowmap-filterchip' }, [
          'FILTERING · ',
          (rooms.find(r => r.id === this._filterRoomId)?.name) || 'ROOM',
          h('button', {
            className: 'qf-knowmap-clearfilter',
            on: { click: () => { this._filterRoomId = null; this._rerender() } },
          }, '×'),
        ]),
      ]),
      // Legend
      h('div', { className: 'qf-knowmap-legend' }, [
        this._legendItem('FULL',    'strongly avoided', STATE_COLOR.FULL),
        this._legendItem('PARTIAL', 'mildly avoided',   STATE_COLOR.PARTIAL),
        this._legendItem('RUMOR',   'lightly avoided',  STATE_COLOR.RUMOR),
        this._legendItem('UNKNOWN', 'walks in blind',   STATE_COLOR.UNKNOWN),
      ]),
    ])
  }

  _renderRoomBlock(r, gridW, gridH) {
    const c = STATE_COLOR[r.state]
    const isUnknown = r.state === 'UNKNOWN'
    const isFiltered = this._filterRoomId && this._filterRoomId !== r.id
    return h('button', {
      className: 'qf-knowmap-room',
      title: `${r.name} · ${r.state}`,
      style: {
        left:   `${(r.x / gridW) * 100}%`,
        top:    `${(r.y / gridH) * 100}%`,
        width:  `${(r.w / gridW) * 100}%`,
        height: `${(r.h / gridH) * 100}%`,
        background: isUnknown ? 'rgba(60,55,55,0.4)' : `${c}26`,
        border: `2px ${isUnknown ? 'dashed' : 'solid'} ${c}`,
        boxShadow: isUnknown
          ? 'none'
          : `0 0 18px ${c}44, inset 0 0 0 1px rgba(0,0,0,0.3)`,
        opacity: isFiltered ? 0.25 : 1,
        animation: r.fresh ? 'fresh-leak 1.8s ease-in-out infinite' : 'none',
      },
      on: { click: () => {
        this._filterRoomId = this._filterRoomId === r.id ? null : r.id
        this._rerender()
      } },
    }, [
      h('div', {
        className: 'pix qf-knowmap-room-label',
        style: { color: isUnknown ? 'var(--text-faint)' : c },
      }, isUnknown ? '???' : r.name),
    ])
  }

  _legendItem(label, sub, color) {
    return h('div', null, [
      h('div', { className: 'qf-knowmap-legend-row' }, [
        h('div', {
          className: 'qf-knowmap-legend-swatch',
          style: { background: color },
        }),
        h('span', {
          className: 'pix',
          style: { color, letterSpacing: '1px', fontSize: '9px' },
        }, label),
      ]),
      h('div', { className: 'qf-knowmap-legend-sub' }, sub),
    ])
  }

  _renderLedger(leakedRooms) {
    const filtered = this._filterRoomId
      ? leakedRooms.filter(r => r.id === this._filterRoomId)
      : leakedRooms
    return h('div', { className: 'panel bevel qf-knowmap-ledger' }, [
      h('div', { className: 'panel-head' }, [
        h('div', { className: 'title' }, 'INTEL LEDGER'),
        h('div', {
          className: 'meta qf-knowmap-ledger-meta',
          style: { color: this._filterRoomId ? 'var(--rumor)' : 'var(--warn)' },
        }, [
          this._filterRoomId
            ? `${filtered.length} OF ${leakedRooms.length}`
            : `${leakedRooms.length} ROOMS LEAKED`,
          this._filterRoomId && h('button', {
            className: 'qf-knowmap-ledger-clear',
            on: { click: () => { this._filterRoomId = null; this._rerender() } },
          }, 'CLEAR'),
        ]),
      ]),
      h('div', { className: 'qf-knowmap-ledger-body' }, [
        ...filtered.map(r => this._renderLedgerCard(r)),
        filtered.length === 0 && h('div', { className: 'qf-knowmap-empty' },
          this._filterRoomId
            ? '— no entries for this room —'
            : '— no leaks yet. survive a day to find out —'),
        h('div', { className: 'qf-knowmap-hint' },
          '◆ Build a LIBRARY of WHISPERS to track who learns what. ◆'),
      ]),
    ])
  }

  _renderLedgerCard(r) {
    const color = STATE_COLOR[r.state]
    const entries = this._intelEntriesFor(r.id)
    const mitigation = this._mitigationFor(r.state)
    const scrubCost = SCRUB_COST[r.state] ?? 0
    return h('div', {
      className: 'qf-knowmap-card',
      style: {
        border: `1px solid ${color}66`,
        borderLeft: `3px solid ${color}`,
      },
    }, [
      r.fresh && h('span', {
        className: 'pix qf-knowmap-card-fresh',
        style: { color, borderColor: color },
      }, '● NEW'),
      h('div', { className: 'qf-knowmap-card-head' }, [
        h('span', { className: 'pix qf-knowmap-card-name' }, r.name),
        h('span', {
          className: 'pix qf-knowmap-card-state',
          style: { color, borderColor: `${color}55` },
        }, r.state),
      ]),
      h('ul', { className: 'qf-knowmap-card-entries' },
        entries.map(it => h('li', null, [
          h('span', {
            className: 'qf-knowmap-card-entry-arrow',
            style: { color },
          }, '›'),
          h('div', null, [
            h('div', null, it.text),
            h('div', { className: 'pix qf-knowmap-card-entry-source' }, [
              h('span', { style: { color: 'var(--warn)' } }, it.source),
              h('span', { style: { color: 'var(--text-faint)' } }, ` · D${it.day}`),
            ]),
          ]),
        ]))
      ),
      h('div', { className: 'qf-knowmap-card-mitigation' }, [
        h('span', {
          className: 'qf-knowmap-card-mitigation-glyph',
          style: { color: 'var(--poison)' },
        }, '◆'),
        h('span', { className: 'qf-knowmap-card-mitigation-text' }, mitigation),
      ]),
      scrubCost > 0 && h('button', {
        className: 'btn qf-knowmap-scrub',
        on: { click: () => this._onScrub(r, scrubCost) },
      }, [
        h('span', { style: { color: 'var(--gold)' } }, '✦'),
        ' SCRUB INTEL · ',
        h('span', { style: { color: 'var(--gold-bright)' } }, `${scrubCost}g`),
      ]),
    ])
  }

  _zoomBtn(label, onClick) {
    return h('button', {
      className: 'qf-knowmap-zoombtn',
      on: { click: onClick },
    }, label)
  }

  // ── Map interactions ────────────────────────────────────────────
  _setZoom(z) {
    this._zoom = z
    this._rerender()
  }

  _onMapDown(e) {
    if (this._zoom <= 1) return
    this._dragRef = {
      startX: e.clientX, startY: e.clientY,
      panX: this._pan.x, panY: this._pan.y,
    }
  }
  _onMapMove(e) {
    if (!this._dragRef) return
    this._pan = {
      x: this._dragRef.panX + (e.clientX - this._dragRef.startX) / this._zoom,
      y: this._dragRef.panY + (e.clientY - this._dragRef.startY) / this._zoom,
    }
    this._rerender()
  }
  _onMapUp() {
    this._dragRef = null
  }

  _onScrub(room, cost) {
    EventBus.emit('SHOW_CONFIRM', {
      title:        'SCRUB INTEL',
      message:      `Spend ${cost}g to scrub ${room.name} intel from the shared pool?`,
      confirmLabel: 'SCRUB',
      cancelLabel:  'KEEP',
      onConfirm: () => {
        EventBus.emit('KNOWLEDGE_SCRUB_REQUEST', { roomId: room.id, cost })
        // Defer rerender so the gameplay side has a chance to update pool first
        setTimeout(() => this._rerender(), 60)
      },
    })
  }

  destroy() {
    EventBus.off('OPEN_KNOWLEDGE_MAP', this._listener)
    this._overlay?.close()
    this._overlay = null
  }
}

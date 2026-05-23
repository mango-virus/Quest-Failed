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
// Base scrub cost by the room's own intel tier. The full cost also
// scales with how much the room exposes — see _scrubCost().
const SCRUB_COST = { FULL: 22, PARTIAL: 12, RUMOR: 6, UNKNOWN: 0 }
// Extra scrub cost per known aspect inside the room (each leaked trap /
// minion / item) and per room unlock-tier above the first.
const SCRUB_PER_ASPECT     = 8
const SCRUB_PER_ROOM_LEVEL = 5

// ── Knowledge-category color scheme ─────────────────────────────────
// The ONE 4-category palette shared with the LeftPanels mini-map and
// the KnowledgeScreen menu (LeftPanels.CAT_COLOR / KnowledgeScreen
// .CAT_COLOR_STR). Each category answers "what kind of intel leaked":
//   ROOMS / TRAPS / MINIONS / ITEMS. Used here for the category-filter
//   toggle buttons + the per-category intel markers on the blueprint.
const CAT_COLOR = {
  ROOMS:   '#5cc8d8',
  TRAPS:   '#e89a3c',
  MINIONS: '#c8334a',
  ITEMS:   '#c879d8',
}
// The four filterable categories, in legend order. `all` true = no
// filter active (everything shows).
const CATEGORIES = ['ROOMS', 'TRAPS', 'MINIONS', 'ITEMS']

export class KnowledgeMapOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._zoom = 1
    this._pan  = { x: 0, y: 0 }
    this._filterRoomId = null
    // Category filter — a Set of the categories currently SHOWN. When
    // it holds all four (the default) no filtering happens; toggling a
    // button removes / re-adds its category. Both the DUNGEON
    // BLUEPRINT and the INTEL LEDGER honour this set.
    this._catFilter = new Set(CATEGORIES)
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
    this._catFilter = new Set(CATEGORIES)
    this._overlay = new Overlay({
      npcKind: 'knowledge',
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

  // Resolve the live KnowledgeSystem off the Game scene. It owns the
  // authoritative tier classifier + live-pool union; the HUD must never
  // re-derive intel state from raw gameState fields (that's what made
  // every room read PARTIAL).
  _knowledgeSystem() {
    const mgr = window.__game?.scene
    if (!mgr) return null
    const game = mgr.getScene?.('Game')
    if (game?.knowledgeSystem) return game.knowledgeSystem
    for (const s of (mgr.scenes ?? [])) {
      if (s?.knowledgeSystem) return s.knowledgeSystem
    }
    return null
  }

  // Pull the HUD intel snapshot from the live system. Falls back to an
  // empty report (everything UNKNOWN, 0% exposure) when there's no Game
  // scene — e.g. opened from a menu context.
  _intelReport() {
    const sys = this._knowledgeSystem()
    if (sys?.getIntelReport) return sys.getIntelReport()
    return { exposurePct: 0, rooms: {}, traps: {}, enemiesPerRoom: {}, items: {}, leakedRoomCount: 0 }
  }

  // Resolve an item-entity type id to its display name via items.json.
  _itemLabel(itemType) {
    if (!itemType) return 'placed item'
    const def = (this._cachedJson('items') ?? []).find(d => d.id === itemType)
    return def?.name ?? itemType
  }

  // Resolve a minion / trap definition id to its player-facing display
  // name (minionTypes.json / trapTypes.json) — never leak the dev id.
  _minionLabel(minionType) {
    if (!minionType) return 'enemy'
    const def = (this._cachedJson('minionTypes') ?? []).find(d => d.id === minionType)
    return def?.name ?? minionType
  }

  _trapLabel(trapType) {
    if (!trapType) return 'trap'
    const def = (this._cachedJson('trapTypes') ?? []).find(d => d.id === trapType)
    return def?.name ?? trapType
  }

  // Room intel state — one of the four state strings. Reads the cached
  // report computed once per render in _renderBody().
  _intelStateFor(roomInstanceId) {
    return this._report?.rooms?.[roomInstanceId] ?? 'UNKNOWN'
  }

  // ── Category filter ─────────────────────────────────────────────
  // True when `cat` should be shown. With all four categories in the
  // set nothing is filtered; remove one and it stops showing.
  _catVisible(cat) {
    return this._catFilter.has(cat)
  }
  // True when a filter is actually narrowing the view (i.e. at least
  // one category is hidden). Used to label the ledger meta.
  _catFilterActive() {
    return this._catFilter.size < CATEGORIES.length
  }
  // Toggle a category on / off. Never lets the player hide ALL four —
  // the last visible category can't be removed (an empty map is
  // useless), it just re-shows everything instead.
  _toggleCategory(cat) {
    if (this._catFilter.has(cat)) {
      if (this._catFilter.size <= 1) this._catFilter = new Set(CATEGORIES)
      else this._catFilter.delete(cat)
    } else {
      this._catFilter.add(cat)
    }
    this._rerender()
  }

  // Which intel categories does this room have, honouring the filter?
  // Returns the set of VISIBLE categories the room actually carries —
  // ROOMS when its layout leaked, TRAPS/MINIONS/ITEMS from the room
  // detail. Used to decide whether a room block / ledger card shows.
  _visibleCategoriesForRoom(roomInstanceId) {
    const out = []
    if (this._intelStateFor(roomInstanceId) !== 'UNKNOWN' && this._catVisible('ROOMS')) {
      out.push('ROOMS')
    }
    const sys = this._knowledgeSystem()
    const d   = sys?.getRoomKnowledgeDetails?.(roomInstanceId)
    if (d) {
      if ((d.traps?.length   ?? 0) > 0 && this._catVisible('TRAPS'))   out.push('TRAPS')
      if ((d.enemies?.length ?? 0) > 0 && this._catVisible('MINIONS')) out.push('MINIONS')
      if ((d.items?.length   ?? 0) > 0 && this._catVisible('ITEMS'))   out.push('ITEMS')
    }
    return out
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

  // Rooms that have leaked SOME intel the player is currently allowed
  // to see. A room with only trap intel drops out of the list when the
  // TRAPS filter is off — so the ledger + the "ROOMS LEAKED" counts
  // always track the active category filter.
  _leakedRooms() {
    return this._roomEntries().filter(
      r => this._visibleCategoriesForRoom(r.id).length > 0)
  }

  // Build the list of "what they know" lines for a room. Every line is
  // tagged with its intel `cat` so the category filter can drop the
  // ones the player has toggled off. Attribution comes from survivors
  // (escapees who carried intel back).
  _intelEntriesFor(roomInstanceId) {
    const survivors = this._gameState.knowledge?.survivors ?? []
    const day = this._gameState.meta?.dayNumber ?? 1
    const out = []
    // ── ROOMS category — the room layout itself.
    if (this._catVisible('ROOMS')) {
      const state = this._intelStateFor(roomInstanceId)
      if (state === 'FULL') {
        out.push({ cat: 'ROOMS', text: 'layout known', source: 'shared pool', cls: 'rogue', day })
      } else if (state === 'PARTIAL') {
        out.push({ cat: 'ROOMS', text: 'partial layout', source: 'shared pool', cls: 'cleric', day })
      } else if (state === 'RUMOR') {
        out.push({ cat: 'ROOMS', text: 'rumored existence', source: 'shared pool', cls: 'cleric', day })
      }
    }
    // Per-room intel detail — traps / minions / placed items the
    // adventurers know sit in this room. Brings the Knowledge Map in
    // line with the other intel surfaces (KnowledgeScreen / RightPanels),
    // which all surface traps + minions + items, not just room layout.
    // Each block is gated on its category being visible.
    const sys = this._knowledgeSystem()
    const details = sys?.getRoomKnowledgeDetails?.(roomInstanceId)
    if (details) {
      if (this._catVisible('MINIONS')) {
        for (const e of (details.enemies ?? [])) {
          out.push({
            cat: 'MINIONS',
            text: `minion: ${this._minionLabel(e.minionType)}${e.stale ? ' (stale)' : ''}`,
            source: 'shared pool', cls: 'cleric', day,
          })
        }
      }
      if (this._catVisible('TRAPS')) {
        for (const t of (details.traps ?? [])) {
          out.push({
            cat: 'TRAPS',
            text: `trap: ${this._trapLabel(t.type)}${t.stale ? ' (stale)' : ''}`,
            source: 'shared pool', cls: 'rogue', day,
          })
        }
      }
      if (this._catVisible('ITEMS')) {
        for (const it of (details.items ?? [])) {
          out.push({
            cat: 'ITEMS',
            text: `item: ${this._itemLabel(it.itemType)}${it.stale ? ' (stale)' : ''}`,
            source: 'shared pool', cls: 'rogue', day,
          })
        }
      }
    }
    // Cross-reference survivor knowledge for attribution — this line
    // describes the room leak itself, so it rides the ROOMS category.
    if (this._catVisible('ROOMS')) {
      for (const sv of survivors.slice(0, 4)) {
        if ((sv.knownRooms ?? []).includes(roomInstanceId)) {
          out.push({
            cat: 'ROOMS',
            text: 'leaked it on escape',
            source: sv.name || 'escapee',
            cls: sv.classId || 'rogue',
            day: sv.escapeDay || day,
          })
        }
      }
    }
    return out
  }

  // Mitigation advice — tied to mechanics that actually exist: SCRUB
  // INTEL (the button below, wipes the room from the shared pool) and
  // relocating the room (fires ROOM_REMOVED → KnowledgeSystem marks the
  // intel stale, dropping its tier). Garrisoning does NOT affect room
  // intel — don't claim it does.
  _mitigationFor(state) {
    if (state === 'FULL')    return 'They know this room cold. Scrub the intel, or relocate the room to break their map.'
    if (state === 'PARTIAL') return 'Rough map only — scrub it, or relocate the room before a revisit sharpens it back to FULL.'
    if (state === 'RUMOR')   return 'Stale rumours — barely acted on. Low priority; scrub it for a clean slate.'
    return 'They walk in blind here — keep it dark.'
  }

  _exposurePct() {
    return this._report?.exposurePct ?? 0
  }

  // ── Render ──────────────────────────────────────────────────────
  _renderBody() {
    // Compute the intel snapshot once per render — every _intelStateFor /
    // _exposurePct call below reads this cached object.
    this._report = this._intelReport()
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

  // Category-filter toolbar — one toggle button per intel category.
  // A button is "lit" when its category is showing; clicking it hides
  // that category from BOTH the blueprint and the ledger. Lives under
  // the blueprint header so it reads as a control for the map.
  _renderCategoryFilter() {
    return h('div', { className: 'qf-knowmap-catfilter' }, [
      h('span', { className: 'pix qf-knowmap-catfilter-label' }, 'SHOW'),
      ...CATEGORIES.map(cat => {
        const on = this._catVisible(cat)
        const color = CAT_COLOR[cat]
        return h('button', {
          className: 'qf-knowmap-catbtn',
          dataset: { on: on ? 'true' : 'false' },
          title: on ? `Hide ${cat} intel` : `Show ${cat} intel`,
          style: {
            '--cat-color': color,
            borderColor: on ? color : 'var(--line-2)',
            color: on ? color : 'var(--text-dim)',
            background: on ? `${color}1f` : 'transparent',
          },
          on: { click: () => this._toggleCategory(cat) },
        }, [
          h('span', {
            className: 'qf-knowmap-catbtn-dot',
            style: { background: on ? color : 'var(--text-dim)' },
          }),
          cat,
        ])
      }),
    ])
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
      // Category filter toolbar
      this._renderCategoryFilter(),
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
            // Per-entity intel markers — each known minion / trap / item
            // plotted at its actual tile so the player sees WHERE leaked
            // things sit, not just which room carries the category.
            ...this._entityMarkers().map(mk => this._renderEntityMarker(mk, W, H)),
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
      // Tier legend — how each room block is shaded (its avoidance tier).
      h('div', { className: 'qf-knowmap-legend' }, [
        this._legendItem('FULL',    'strongly avoided', STATE_COLOR.FULL),
        this._legendItem('PARTIAL', 'mildly avoided',   STATE_COLOR.PARTIAL),
        this._legendItem('RUMOR',   'lightly avoided',  STATE_COLOR.RUMOR),
        this._legendItem('UNKNOWN', 'walks in blind',   STATE_COLOR.UNKNOWN),
      ]),
      // Category legend — the four intel-category marker colours,
      // matching the filter buttons + the other two knowledge surfaces.
      h('div', { className: 'qf-knowmap-catlegend' }, [
        h('span', { className: 'pix qf-knowmap-catlegend-label' }, 'INTEL'),
        ...CATEGORIES.map(cat => h('div', { className: 'qf-knowmap-catlegend-item' }, [
          h('span', {
            className: 'qf-knowmap-catlegend-dot',
            style: { background: CAT_COLOR[cat], boxShadow: `0 0 4px ${CAT_COLOR[cat]}` },
          }),
          h('span', {
            className: 'pix qf-knowmap-catlegend-text',
            style: { color: CAT_COLOR[cat] },
          }, cat),
        ])),
      ]),
    ])
  }

  _renderRoomBlock(r, gridW, gridH) {
    const c = STATE_COLOR[r.state]
    const isUnknown = r.state === 'UNKNOWN'
    // Room-pick filter (clicking a room) dims the others.
    const isRoomFiltered = this._filterRoomId && this._filterRoomId !== r.id
    // Category filter — which intel categories this room carries that
    // the player is currently allowed to see. When the category filter
    // is active and a room has none of the visible categories, the
    // block dims right down so only relevant rooms read on the map.
    const visCats  = this._visibleCategoriesForRoom(r.id)
    const catFaded = this._catFilterActive() && visCats.length === 0
    const opacity  = isRoomFiltered ? 0.25 : (catFaded ? 0.22 : 1)
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
        opacity,
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
      // Per-category intel (traps / minions / items) now renders as
      // positional markers on the blueprint — see _renderEntityMarker —
      // rather than category dots clustered in the room corner.
    ])
  }

  // Build the positional intel-marker list for the blueprint. Traps and
  // items carry tileX/tileY in the knowledge pool directly. Minions are
  // tracked per-room-per-type only (no position), so we cross-reference
  // the live minion list to plot each known-type minion at its real
  // tile. Honours the category filter.
  _entityMarkers() {
    const sys = this._knowledgeSystem()
    if (!sys?.getRoomKnowledgeDetails) return []
    const rooms   = this._gameState.dungeon?.rooms ?? []
    const minions = this._gameState.minions ?? []
    const out = []
    for (const room of rooms) {
      const rid = room.instanceId
      const details = sys.getRoomKnowledgeDetails(rid)
      if (!details) continue
      const inRoom = (tx, ty) =>
        tx >= room.gridX && tx < room.gridX + room.width &&
        ty >= room.gridY && ty < room.gridY + room.height
      if (this._catVisible('TRAPS')) {
        for (const t of (details.traps ?? [])) {
          if (t.tileX == null || t.tileY == null) continue
          out.push({ cat: 'TRAPS', tileX: t.tileX, tileY: t.tileY,
                     roomId: rid, label: this._trapLabel(t.type) })
        }
      }
      if (this._catVisible('ITEMS')) {
        for (const it of (details.items ?? [])) {
          if (it.tileX == null || it.tileY == null) continue
          out.push({ cat: 'ITEMS', tileX: it.tileX, tileY: it.tileY,
                     roomId: rid, label: this._itemLabel(it.itemType) })
        }
      }
      if (this._catVisible('MINIONS')) {
        const knownTypes = new Set((details.enemies ?? []).map(e => e.minionType))
        if (knownTypes.size > 0) {
          for (const m of minions) {
            if (!m || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
            if (m.tileX == null || m.tileY == null) continue
            if (!knownTypes.has(m.definitionId)) continue
            if (!inRoom(m.tileX, m.tileY)) continue
            out.push({ cat: 'MINIONS', tileX: m.tileX, tileY: m.tileY,
                       roomId: rid, label: this._minionLabel(m.definitionId) })
          }
        }
      }
    }
    return out
  }

  // One positional marker on the blueprint, centred on its tile. Shape
  // is set per category via CSS (minion circle / trap diamond / item
  // square). pointer-events:none so clicks fall through to the room
  // block underneath (room-pick filter still works).
  _renderEntityMarker(mk, gridW, gridH) {
    const color  = CAT_COLOR[mk.cat]
    const dimmed = this._filterRoomId && this._filterRoomId !== mk.roomId
    return h('div', {
      className: `qf-knowmap-entity qf-knowmap-entity-${mk.cat.toLowerCase()}`,
      title: `${mk.label} · ${mk.cat}`,
      style: {
        left: `${((mk.tileX + 0.5) / gridW) * 100}%`,
        top:  `${((mk.tileY + 0.5) / gridH) * 100}%`,
        background: color,
        boxShadow: `0 0 6px ${color}`,
        opacity: dimmed ? 0.18 : 1,
      },
    })
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
    // When the category filter is narrowing the view, name the active
    // categories so the player knows the ledger is partial.
    const catFilterActive = this._catFilterActive()
    const activeCats = CATEGORIES.filter(c => this._catVisible(c))
    return h('div', { className: 'panel bevel qf-knowmap-ledger' }, [
      h('div', { className: 'panel-head' }, [
        h('div', { className: 'title' }, 'INTEL LEDGER'),
        h('div', {
          className: 'meta qf-knowmap-ledger-meta',
          style: { color: (this._filterRoomId || catFilterActive) ? 'var(--rumor)' : 'var(--warn)' },
        }, [
          this._filterRoomId
            ? `${filtered.length} OF ${leakedRooms.length}`
            : catFilterActive
              ? `${leakedRooms.length} · ${activeCats.join('/')}`
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

  // Total gold to scrub a room's intel. Scales with three things the
  // player can see on the card: the base intel tier (FULL/PARTIAL/
  // RUMOR), the number of known aspects inside it (leaked traps +
  // minions + items), and the room's own unlock tier. So a late-game
  // room with a known trap and minion costs far more to wipe than a
  // barely-glimpsed empty starter room.
  _scrubCost(r) {
    const base = SCRUB_COST[r.state] ?? 0
    if (base === 0) return 0   // UNKNOWN layout — nothing to scrub
    const d = this._knowledgeSystem()?.getRoomKnowledgeDetails?.(r.id)
    const aspects = (d?.traps?.length   ?? 0)
                  + (d?.enemies?.length ?? 0)
                  + (d?.items?.length   ?? 0)
    const roomDef  = (this._cachedJson('rooms') ?? []).find(x => x.id === r.defId)
    const unlockLv = Math.max(1, roomDef?.unlockLevel ?? 1)
    return base
         + aspects * SCRUB_PER_ASPECT
         + (unlockLv - 1) * SCRUB_PER_ROOM_LEVEL
  }

  _renderLedgerCard(r) {
    const color = STATE_COLOR[r.state]
    const entries = this._intelEntriesFor(r.id)
    const mitigation = this._mitigationFor(r.state)
    const scrubCost = this._scrubCost(r)
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
          // Entry arrow tinted by the line's intel category so the
          // ledger colour-codes consistently with the map markers.
          h('span', {
            className: 'qf-knowmap-card-entry-arrow',
            style: { color: CAT_COLOR[it.cat] ?? color },
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
      theme:        'soul',
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

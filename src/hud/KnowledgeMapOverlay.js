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
//   * Exposure TREND (delta + sparkline) needs a per-day intel timeline
//     gameState doesn't keep — those fake placeholders were removed.
//     LAST LEAK is real (newest `adventurers.known` lastEscapedDay).
//
// Wiring: SCRUB INTEL button emits `KNOWLEDGE_SCRUB_REQUEST { roomId, cost }`,
// handled by `KnowledgeSystem._onScrubRequest` (debits gold + scrubs the
// room's room/enemy/trap intel from the shared pool + every survivor).

import { h } from './dom.js'
import { TrayShell } from './TrayShell.js'
import { EventBus } from '../systems/EventBus.js'

// Design tier metadata for the bespoke MAP tray (KnowledgeTray): maps our
// FULL/PARTIAL/RUMOR/UNKNOWN intel states → the tray's id / colour / label /
// glyph. (UNKNOWN reads as "HIDDEN" — what the kingdom can't see.)
const MAP_TIER = {
  FULL:    { id: 'full',    c: 'var(--blood)', n: 'KNOWN',   g: '◉' },
  PARTIAL: { id: 'partial', c: 'var(--warn)',  n: 'PARTIAL', g: '◐' },
  RUMOR:   { id: 'rumor',   c: 'var(--rumor)', n: 'RUMOR',   g: '◌' },
  UNKNOWN: { id: 'hidden',  c: 'var(--dim)',   n: 'HIDDEN',  g: '?' },
}

// Base scrub cost by the room's own intel tier. The full cost also
// scales with how much the room exposes — see _scrubCost().
const SCRUB_COST = { FULL: 22, PARTIAL: 12, RUMOR: 6, UNKNOWN: 0 }
// Extra scrub cost per known aspect inside the room (each leaked trap /
// minion / item) and per room unlock-tier above the first.
const SCRUB_PER_ASPECT     = 8
const SCRUB_PER_ROOM_LEVEL = 5

export class KnowledgeMapOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._tray = null
    this._mapFilter = 'all'   // tier filter for the bespoke tray
    this._selRoomId = null    // selected room in the tray's schematic
    this._listener = () => this.toggle()
    this._onResize = () => this._fitMapStage()
    EventBus.on('OPEN_KNOWLEDGE_MAP', this._listener)
  }

  toggle() {
    if (this._tray) this.close()
    else this.open()
  }
  isOpen() { return !!this._tray }

  // The knowledge map now flies out of its action-bar button as a bespoke
  // map-first tray (schematic dungeon + tier filter + per-room dossier with
  // a SCRUB INTEL action) instead of the old full-screen Overlay. All the
  // intel/tier/scrub helpers below are reused.
  open() {
    if (this._tray) return
    this._mapFilter = 'all'
    this._selRoomId = null
    this._tray = new TrayShell({
      anchorSel: '[data-tray-anchor="MAP"]',
      align:  'right',
      vAlign: 'up',
      accent: 'var(--rumor)',
      width:  'min(64vw, 1040px)',
      height: 360,
      onClose: () => { this._tray = null },
    })
    this._tray.setContent(this._renderTrayContent())
    this._tray.open()
    window.addEventListener('resize', this._onResize)
    // Drive the live pip layer (minions/adventurers/items moving in real time).
    this._pipTick = requestAnimationFrame(() => this._tickPips())
  }

  close() {
    window.removeEventListener('resize', this._onResize)
    if (this._pipTick) cancelAnimationFrame(this._pipTick)
    this._pipTick = null
    this._pipEls = null
    this._tray?.close()
    this._tray = null
  }

  _rerender() {
    if (this._tray) this._tray.setContent(this._renderTrayContent())
  }

  // ── Bespoke map tray (schematic + dossier) ──────────────────────
  _renderTrayContent() {
    this._report = this._intelReport()
    const all = this._roomEntries()   // { id, defId, name, x, y, w, h, state }
    if (!all.length) {
      return h('div', { className: 'mp-main' }, [
        h('div', { className: 'mp-empty' }, [
          h('div', { className: 'mp-empty-eye' }, '◇  NO DUNGEON  ◇'),
          h('div', { className: 'mp-empty-hint' }, 'Build rooms — then watch what the kingdom learns.'),
        ]),
      ])
    }
    const isBoss = (e) => e.defId === 'boss_chamber'
    // Corridors render as rooms too (tier-coloured), so the layout reads as one
    // connected map. TRUE tile proportions: lay everything out in px (tile ×
    // BASE) inside .mp-scale, then _fitMapStage() uniformly scales the whole
    // box to fit the stage — so a 4×4 room stays square, never stretched.
    const BASE = 16
    const minX = Math.min(...all.map(e => e.x)), minY = Math.min(...all.map(e => e.y))
    const maxX = Math.max(...all.map(e => e.x + e.w)), maxY = Math.max(...all.map(e => e.y + e.h))
    const cW = Math.max(1, maxX - minX) * BASE, cH = Math.max(1, maxY - minY) * BASE
    const PX = (v, min) => ((v - min) * BASE) + 'px'
    // Layout for the per-frame pip tick; reset the (now-detached) pip pool.
    this._mapLayout = { minX, minY, BASE }
    this._pipEls = new Map()
    if (this._selRoomId == null && all.length) this._selRoomId = all[0].id
    const filter = this._mapFilter
    const tabs = [
      { id: 'all',     label: 'ALL',   glyph: '◈', count: all.length },
      { id: 'full',    label: 'KNOWN', glyph: '◉', count: all.filter(r => r.state === 'FULL').length },
      { id: 'partial', label: 'PART',  glyph: '◐', count: all.filter(r => r.state === 'PARTIAL').length },
      { id: 'rumor',   label: 'RUMOR', glyph: '◌', count: all.filter(r => r.state === 'RUMOR').length },
      { id: 'hidden',  label: 'DARK',  glyph: '?', count: all.filter(r => r.state === 'UNKNOWN').length },
    ]
    const segbar = h('div', { className: 'htr-segbar' }, tabs.map(tb => h('div', {
      className: 'htr-segtab' + (filter === tb.id ? ' on' : ''),
      on: { click: () => { this._mapFilter = tb.id; this._rerender() } },
    }, [
      h('span', { className: 'tg' }, tb.glyph),
      h('span', { className: 'lb' }, tb.label),
      h('span', { className: 'ct' }, String(tb.count)),
    ])))
    const stageInner = h('div', {
      className: 'mp-scale',
      style: { width: cW + 'px', height: cH + 'px' },
    }, [
      ...all.map((r, i) => {
        const t = MAP_TIER[r.state] || MAP_TIER.UNKNOWN
        const dim = filter !== 'all' && t.id !== filter
        const on = r.id === this._selRoomId
        return h('div', {
          className: 'mp-room' + (isBoss(r) ? ' boss' : '') + (r.state === 'FULL' ? ' known' : '') + (on ? ' on' : '') + (dim ? ' dim' : ''),
          style: { left: PX(r.x, minX), top: PX(r.y, minY), width: r.w * BASE + 'px', height: r.h * BASE + 'px', '--rc': t.c, '--i': i },
          on: { click: () => { this._selRoomId = r.id; this._rerender() } },
        }, [
          r.state === 'FULL' ? h('span', { className: 'reye' }, isBoss(r) ? '♛' : '◉') : null,
          h('span', { className: 'rn' }, r.name),
          h('span', { className: 'rt' }, t.n),
        ].filter(Boolean))
      }),
      // Live entity-pip layer — populated + moved every frame by _tickPips().
      h('div', { className: 'mp-pips' }),
    ])
    // Pip legend (floats bottom-left of the stage) so the colours are readable.
    const legend = h('div', { className: 'mp-legend' }, [
      ['BOSS', '#fff'], ['HEROES', 'var(--bloodG)'], ['MINIONS', 'var(--poison)'], ['TRAPS', 'var(--warn)'], ['ITEMS', 'var(--info)'],
    ].map(([label, color]) => h('span', { className: 'mp-leg' }, [
      h('span', { className: 'mp-leg-d', style: { background: color } }),
      label,
    ])))
    const stage = h('div', { className: 'mp-stage' }, [ stageInner, legend ])
    // Uniformly scale the schematic to fit the stage once it mounts.
    requestAnimationFrame(() => this._fitMapStage())
    const sel = all.find(r => r.id === this._selRoomId) || all[0]
    const st = MAP_TIER[sel?.state] || MAP_TIER.UNKNOWN
    const expo = this._exposurePct()
    const scrubCost = sel ? this._scrubCost(sel) : 0
    const side = h('div', { className: 'mp-side' }, [
      h('div', { className: 'mp-expo' }, [
        h('span', { className: 'mp-expo-pct', style: { color: expo >= 70 ? 'var(--blood)' : expo >= 40 ? 'var(--warn)' : 'var(--poison)' } }, `${expo}%`),
        h('span', { className: 'mp-expo-l' }, [ 'DUNGEON', h('br'), 'EXPOSURE' ]),
      ]),
      sel ? h('div', { className: 'mp-det', style: { '--dc': st.c } }, [
        h('span', { className: 'mp-det-eye' }, isBoss(sel) ? 'YOUR THRONE' : 'SCOUTED ROOM'),
        h('span', { className: 'mp-det-name' }, sel.name),
        h('span', { className: 'mp-det-tier' }, `${st.g} ${st.n}`),
        h('span', { className: 'mp-det-desc' }, sel.state === 'UNKNOWN'
          ? 'The kingdom has no knowledge of this room. Keep it buried.'
          : 'Scouting reports place this room — its full contents are still being pieced together.'),
        h('div', { className: 'mp-det-bury' }, [ h('span', { className: 'i' }, '▶'), h('span', null, this._mitigationFor(sel.state)) ]),
        // SCRUB INTEL — the room dossier's call-to-action. Prominent warn-amber
        // button with a pulsing glow so it reads as "do this" (was easy to miss).
        scrubCost > 0 ? h('button', {
          className: 'mp-scrub',
          title: 'Spend gold to wipe this room from the kingdom’s intel',
          on: { click: () => this._onScrub(sel, scrubCost) },
        }, [
          h('span', { className: 'si' }, '⌫'),
          h('span', { className: 'sl' }, 'SCRUB INTEL'),
          h('span', { className: 'sc' }, [ h('span', { className: 'mp-scrub-coin' }), `${scrubCost}g` ]),
        ]) : null,
      ].filter(Boolean)) : null,
    ])
    return h('div', { className: 'htr-chrome m-col' }, [
      segbar,
      h('div', { className: 'htr-content' }, [ h('div', { className: 'mp-main' }, [ stage, side ]) ]),
    ])
  }

  // Uniformly scale the px schematic (.mp-scale) to fit the stage box,
  // preserving the dungeon's true aspect ratio (so rooms never stretch).
  _fitMapStage() {
    const stage = this._tray?.trayEl?.querySelector('.mp-stage')
    const scale = stage?.querySelector('.mp-scale')
    if (!stage || !scale) return
    const cW = scale.offsetWidth || 1, cH = scale.offsetHeight || 1
    const pad = 16
    const s = Math.min((stage.clientWidth - pad) / cW, (stage.clientHeight - pad) / cH)
    scale.style.transform = `translate(-50%, -50%) scale(${s > 0 ? s : 1})`
  }

  // Live entities to plot as pips: boss (chamber centre), minions,
  // adventurers (day-phase invaders), traps, and items (chests / beacons /
  // fountains / locks / key-chests / phylactery). Each carries a stable `key`
  // so _tickPips() can pool the elements and just move them as things shift.
  // Tile coords; _tickPips converts to px via the stored layout.
  _entityPips() {
    const gs = this._gameState
    const d  = gs.dungeon ?? {}
    const pips = []
    // Boss pip — its LIVE position (BossSystem updates boss.tileX/tileY as it
    // roams its room + fights), falling back to the chamber centre pre-spawn.
    const b = gs.boss
    if (b && b.tileX != null && b.tileY != null) {
      pips.push({ key: 'boss', x: b.tileX + 0.5, y: b.tileY + 0.5, cls: 'boss', label: 'The Boss' })
    } else {
      const bossRoom = (d.rooms ?? []).find(r => r.definitionId === 'boss_chamber')
      if (bossRoom) pips.push({ key: 'boss', x: (bossRoom.gridX ?? 0) + (bossRoom.width || 1) / 2, y: (bossRoom.gridY ?? 0) + (bossRoom.height || 1) / 2, cls: 'boss', label: 'Boss Chamber' })
    }
    for (const m of (gs.minions ?? [])) {
      if (!m || m.aiState === 'dead' || (m.resources?.hp ?? 1) <= 0) continue
      if (m.tileX == null || m.tileY == null) continue
      pips.push({ key: 'm:' + m.instanceId, x: m.tileX + 0.5, y: m.tileY + 0.5, cls: 'minion', label: m.name || 'Minion' })
    }
    for (const a of (gs.adventurers?.active ?? [])) {
      if (!a || a.tileX == null || a.tileY == null) continue
      if ((a.resources?.hp ?? a.hp ?? 1) <= 0 || a.aiState === 'dead') continue
      pips.push({ key: 'a:' + a.instanceId, x: a.tileX + 0.5, y: a.tileY + 0.5, cls: 'adv', label: a.name || 'Adventurer' })
    }
    for (const t of (d.traps ?? [])) {
      if (t?.tileX == null) continue
      pips.push({ key: 't:' + t.tileX + ',' + t.tileY, x: t.tileX + 0.5, y: t.tileY + 0.5, cls: 'trap', label: 'Trap' })
    }
    const itemArrays = [d.treasureChests, d.beacons, d.fountains, d.locks, d.keyChests]
    for (const arr of itemArrays) {
      for (const it of (arr ?? [])) {
        if (it?.tileX == null) continue
        pips.push({ key: 'i:' + it.tileX + ',' + it.tileY, x: it.tileX + 0.5, y: it.tileY + 0.5, cls: 'item', label: 'Item' })
      }
    }
    if (gs.phylactery && gs.phylactery.tileX != null) {
      pips.push({ key: 'i:phyl', x: gs.phylactery.tileX + 0.5, y: gs.phylactery.tileY + 0.5, cls: 'item', label: 'Phylactery' })
    }
    return pips
  }

  // Per-frame pip updater (runs while the map tray is open). Pools elements by
  // entity key and only writes left/top — so minions / adventurers / moved or
  // sold items track in real time without a full re-render. Pips have no
  // re-created animation (rings live on ::after), so pooling keeps them smooth.
  _tickPips() {
    if (!this._tray) { this._pipTick = null; return }
    const layer = this._tray.trayEl?.querySelector('.mp-pips')
    const lay = this._mapLayout
    if (layer && lay) {
      if (!this._pipEls) this._pipEls = new Map()
      const BASE = lay.BASE
      const seen = new Set()
      for (const p of this._entityPips()) {
        seen.add(p.key)
        let el = this._pipEls.get(p.key)
        if (!el) {
          el = h('div', { className: 'mp-pip mp-pip-' + p.cls, title: p.label })
          const sz = Math.round(p.cls === 'boss' ? BASE * 1.35 : BASE * 0.8)
          el.style.width = sz + 'px'; el.style.height = sz + 'px'
          this._pipEls.set(p.key, el)
          layer.appendChild(el)
        }
        el.style.left = ((p.x - lay.minX) * BASE) + 'px'
        el.style.top  = ((p.y - lay.minY) * BASE) + 'px'
      }
      for (const [k, el] of this._pipEls) {
        if (!seen.has(k)) { el.remove(); this._pipEls.delete(k) }
      }
    }
    this._pipTick = requestAnimationFrame(() => this._tickPips())
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

  // Room intel state — one of the four state strings. Reads the cached
  // report computed once per render in _renderBody().
  _intelStateFor(roomInstanceId) {
    return this._report?.rooms?.[roomInstanceId] ?? 'UNKNOWN'
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

  _onScrub(room, cost) {
    EventBus.emit('SHOW_CONFIRM', {
      title:        'SCRUB INTEL',
      message:      `Spend ${cost}g to scrub ${room.name} intel from the shared pool?`,
      confirmLabel: 'SCRUB',
      cancelLabel:  'KEEP',
      theme:        'blue',
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

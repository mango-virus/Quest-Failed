// LeftPanels — DOM port of the design's left HUD column.
//
// Stacks two panels:
//   1. MiniKnowledgeMap — 1:1 blueprint of the dungeon rendered as a
//      pure KNOWLEDGE view. Each room block tints by ROOMS-category
//      intel; small category pips (TRAPS / MINIONS / ITEMS) mark which
//      other intel the adventurers hold for that room. Boss-chamber
//      marker always drawn. A 4-category legend (the shared CAT_COLOR
//      scheme) sits under the canvas — see KnowledgeScreen +
//      KnowledgeMapOverlay for the matching surfaces.
//   2. ConstructionPanel — 4 category tabs (ROOMS / MINIONS / TRAPS /
//      ITEMS), 2-col card grid, footer with selected-item detail + a
//      PLACE button. Emits BUILD_SELECT { def, kind } on card click and
//      BUILD_DESELECT on a deselect — drop-in for the Phaser BuildMenu.
//
// Visible only during night phase — hidden by HudRoot when phase flips
// to day. Re-renders the card grid on PHASE / boss-level / unlocks
// changes via cheap signature compare.

import { h, mount } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { CAT_COLOR } from './hudShared.js'

// ── Knowledge-category color scheme ─────────────────────────────────
// ONE 4-category palette shared across all three knowledge surfaces
// (this mini-map, the KnowledgeScreen menu, the big Knowledge Map
// overlay) so the player learns one legend and reads them all. Each
// category answers "what kind of intel did the adventurers leak":
//   ROOMS   — they know a room exists / its layout       (cyan)
//   TRAPS   — they know a trap's placement               (orange)
//   MINIONS — they've sighted enemies in a room          (red)
//   ITEMS   — they know a placed item (phylactery / etc.) (magenta)
// CAT_COLOR (intel category palette) is shared with KnowledgeMapOverlay — see hudShared.js.
// Dim grey for a room the adventurers have never seen — no intel of
// any category. Walked-in-blind rooms paint with this so the player
// can still see the dungeon shape behind the knowledge overlay.
const UNKNOWN_COLOR = '#5a4a4e'
// The boss-chamber marker keeps its own gold so the player can always
// locate the boss regardless of which intel categories are showing.
const BOSS_COLOR = '#ffcb5c'

// Pull the HUD intel snapshot from the live KnowledgeSystem on the Game
// scene. It owns the authoritative tier classifier + live-pool union, so
// the mini-map, the full Knowledge Map overlay, and the pathfinder all
// agree on every room's tier. Re-deriving tiers from raw gameState fields
// is what made every room read PARTIAL — never do that. Empty fallback
// (all UNKNOWN, 0% exposure) when there's no Game scene.
function _knowledgeReport() {
  const mgr = window.__game?.scene
  let sys = mgr?.getScene?.('Game')?.knowledgeSystem
  if (!sys && mgr?.scenes) {
    for (const s of mgr.scenes) { if (s?.knowledgeSystem) { sys = s.knowledgeSystem; break } }
  }
  if (sys?.getIntelReport) return sys.getIntelReport()
  return { exposurePct: 0, rooms: {}, traps: {}, enemiesPerRoom: {}, items: {}, leakedRoomCount: 0 }
}

// Resolve the live KnowledgeSystem off the Game scene so the mini-map
// can pull per-room detail (which traps / minions / items sit inside a
// room) — getIntelReport() only gives id→tier maps, not room membership
// for traps / items. The system owns getRoomKnowledgeDetails().
function _knowledgeSystem() {
  const mgr = window.__game?.scene
  let sys = mgr?.getScene?.('Game')?.knowledgeSystem
  if (!sys && mgr?.scenes) {
    for (const s of mgr.scenes) { if (s?.knowledgeSystem) { sys = s.knowledgeSystem; break } }
  }
  return sys ?? null
}

export class LeftPanels {
  constructor(gameState) {
    this._gameState = gameState
    this._listeners = []
    // Construction was extracted to BuildMenu.js — LeftPanels is the radar only.
    this.el = this._build()
    this._wireEvents()
    this._renderMap()
    this._tickHandle = requestAnimationFrame(() => this._tick())
  }

  _build() {
    this._refs = {}
    const root = h('div', {
      className: 'qf-leftpanels',
      ref: el => { this._refs.root = el },
    }, [
      // ── MiniKnowledgeMap ───────────────────────────────────────
      // `.hc` puts the design crypt token vars (--blood / --rumor / --warn …)
      // in scope so the radar chrome below reads from one palette.
      h('div', {
        className: 'panel bevel qf-minimap hc',
        ref: el => { this._refs.minimapRoot = el },
      }, [
        // Radar header — title + a FULL ▸ shortcut to the big Knowledge Map.
        h('div', { className: 'qf-minimap-head' }, [
          h('span', { className: 'sil qf-minimap-title' }, '⊞ DUNGEON MAP'),
          h('span', {
            className: 'sil qf-minimap-full',
            title: 'Open the full Knowledge Map',
            on: { click: () => EventBus.emit('OPEN_KNOWLEDGE_MAP') },
          }, 'FULL ▸'),
        ]),
        h('div', { className: 'qf-minimap-body' }, [
          h('div', {
            className: 'qf-minimap-canvas',
            ref: el => { this._refs.mapCanvas = el },
          }, [
            // Corner registration marks
            h('div', { className: 'qf-minimap-corner', style: { top: '4px', left: '4px' } }),
            h('div', { className: 'qf-minimap-corner', style: { top: '4px', right: '4px' } }),
            h('div', { className: 'qf-minimap-corner', style: { bottom: '4px', left: '4px' } }),
            h('div', { className: 'qf-minimap-corner', style: { bottom: '4px', right: '4px' } }),
            // Rotating radar sweep (decorative; sits under the rooms layer).
            h('div', { className: 'qf-minimap-sweep' }),
            // Rooms + intel markers layer (populated by _renderMap)
            h('div', {
              className: 'qf-minimap-rooms',
              ref: el => { this._refs.mapRooms = el },
            }),
            // Live blip layer — boss + day-phase adventurer pings (_renderBlips).
            // Pooled per-adventurer so the ping animation isn't reset each frame.
            h('div', {
              className: 'qf-minimap-blips',
              ref: el => { this._refs.mapBlips = el },
            }),
            h('div', { className: 'qf-minimap-scan' }),
          ]),
          // Legend — one swatch per intel category, in the same order
          // and colours as the KnowledgeScreen menu + the full Knowledge
          // Map overlay so all three surfaces read with one legend.
          h('div', { className: 'qf-minimap-legend' }, [
            h('div', { className: 'qf-minimap-legend-item' }, [
              h('span', { className: 'qf-minimap-legend-dot', style: { background: CAT_COLOR.ROOMS } }),
              h('span', { className: 'pix qf-minimap-legend-label' }, 'ROOMS'),
            ]),
            h('div', { className: 'qf-minimap-legend-item' }, [
              h('span', { className: 'qf-minimap-legend-dot', style: { background: CAT_COLOR.TRAPS } }),
              h('span', { className: 'pix qf-minimap-legend-label' }, 'TRAPS'),
            ]),
            h('div', { className: 'qf-minimap-legend-item' }, [
              h('span', { className: 'qf-minimap-legend-dot', style: { background: CAT_COLOR.MINIONS } }),
              h('span', { className: 'pix qf-minimap-legend-label' }, 'MINIONS'),
            ]),
            h('div', { className: 'qf-minimap-legend-item' }, [
              h('span', { className: 'qf-minimap-legend-dot', style: { background: CAT_COLOR.ITEMS } }),
              h('span', { className: 'pix qf-minimap-legend-label' }, 'ITEMS'),
            ]),
          ]),
        ]),
      ]),

      // Construction was extracted to its own BuildMenu.js (the PLACE-button
      // popout) — LeftPanels is now just the radar minimap.
    ])

    return root
  }

  // ── MiniKnowledgeMap ────────────────────────────────────────────
  //
  // A pure KNOWLEDGE view — it shows what the ADVENTURERS know about the
  // dungeon, not the live entity state. Each of the four intel
  // categories gets its own colour from CAT_COLOR:
  //   ROOMS   — the room block itself tints cyan once its layout leaks;
  //             rooms with no intel of any kind stay dim grey.
  //   TRAPS   — an orange pip in the room's marker strip when the
  //             adventurers know a trap sits inside it.
  //   MINIONS — a red pip when they've sighted enemies in the room.
  //   ITEMS   — a magenta pip when they know a placed item is inside.
  // The boss-chamber marker (gold) is always drawn so the player can
  // locate the boss. Minion markers are derived from KnowledgeSystem
  // intel (known sightings), NOT from live entity positions.
  _renderMap() {
    const canvas = this._refs.mapRooms
    if (!canvas) return
    const d = this._gameState.dungeon
    if (!d) return
    const W = d.gridWidth || 80
    const H = d.gridHeight || 54
    // Drive the canvas's aspect-ratio off the actual grid so tile-square
    // rooms paint as square. Without this, the canvas stays at its CSS
    // default and a 4×4 room shows as a vertical rectangle when the
    // grid isn't square (e.g. the 80×54 default).
    const parent = canvas.parentElement   // .qf-minimap-canvas
    if (parent) {
      parent.style.setProperty('--grid-w', W)
      parent.style.setProperty('--grid-h', H)
    }
    // Radar accent (sweep / scan band / adventurer pings / FULL ▸ hover)
    // follows the phase: cyan rumor while building at night, amber warn
    // during the day invasion — mirrors the design's night/day blip
    // recolour. Set on the panel root so the header inherits it too.
    if (this._refs.minimapRoot) {
      const isDay = (this._gameState.meta?.phase ?? 'night') === 'day'
      this._refs.minimapRoot.style.setProperty('--mm-blip', isDay ? 'var(--warn)' : 'var(--rumor)')
    }
    const rooms = d.rooms || []
    // Position rooms as % of the canvas. Room placement coords live on
    // `gridX` / `gridY` (see DungeonGrid.placeRoom).
    const report = _knowledgeReport()
    const sys    = _knowledgeSystem()
    const els = []
    for (const r of rooms) {
      const x = r.gridX ?? 0, y = r.gridY ?? 0
      // ROOMS category — the room block tints cyan once its layout has
      // leaked (any tier); UNKNOWN rooms stay dim grey so the dungeon
      // shape is still visible behind the knowledge overlay.
      const roomTier = report.rooms?.[r.instanceId] || null
      const roomKnown = !!roomTier
      const tint = roomKnown ? CAT_COLOR.ROOMS : UNKNOWN_COLOR
      // Per-room category intel — which of TRAPS / MINIONS / ITEMS the
      // adventurers know about inside this room. getRoomKnowledgeDetails
      // gives the room-membership the flat id→tier report can't.
      const details = sys?.getRoomKnowledgeDetails?.(r.instanceId)
      const hasTraps   = (details?.traps?.length   ?? 0) > 0
      const hasMinions = (details?.enemies?.length ?? 0) > 0
      const hasItems   = (details?.items?.length   ?? 0) > 0
      // Build a human-readable tooltip listing the known categories.
      const known = []
      if (roomKnown)  known.push('room')
      if (hasTraps)   known.push('traps')
      if (hasMinions) known.push('minions')
      if (hasItems)   known.push('items')
      els.push(h('div', {
        className: 'qf-minimap-room',
        title: known.length ? `Known: ${known.join(', ')}` : 'No intel',
        dataset: { known: roomKnown ? 'true' : 'false' },
        style: {
          left:   `${(x / W) * 100}%`,
          top:    `${(y / H) * 100}%`,
          width:  `${(r.width  / W) * 100}%`,
          height: `${(r.height / H) * 100}%`,
          background: roomKnown ? `${tint}38` : `${tint}1c`,
          borderColor: tint,
          boxShadow: roomKnown
            ? `0 0 6px ${tint}55, inset 0 0 0 1px rgba(0,0,0,0.3)`
            : `inset 0 0 0 1px rgba(0,0,0,0.3)`,
        },
      }))
      // Per-entity intel markers — each known trap / item / minion drawn
      // at its real tile so the mini-map shows WHERE leaked things sit,
      // not just which room carries the category. Traps + items carry
      // tileX/tileY in the knowledge pool directly; minions are tracked
      // per-room-per-type only, so we cross-reference the live minion
      // list to plot each known-type minion at its actual tile.
      const pushMarker = (cat, tx, ty) => {
        if (tx == null || ty == null) return
        const color = CAT_COLOR[cat]
        els.push(h('div', {
          className: `qf-minimap-emarker qf-minimap-emarker-${cat.toLowerCase()}`,
          style: {
            left: `${((tx + 0.5) / W) * 100}%`,
            top:  `${((ty + 0.5) / H) * 100}%`,
            background: color,
            boxShadow:  `0 0 3px ${color}`,
          },
        }))
      }
      if (hasTraps) {
        for (const t of (details.traps ?? [])) pushMarker('TRAPS', t.tileX, t.tileY)
      }
      if (hasItems) {
        for (const it of (details.items ?? [])) pushMarker('ITEMS', it.tileX, it.tileY)
      }
      if (hasMinions) {
        const knownTypes = new Set((details.enemies ?? []).map(e => e.minionType))
        for (const m of (this._gameState.minions ?? [])) {
          if (!m || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
          if (m.tileX == null || m.tileY == null) continue
          if (!knownTypes.has(m.definitionId)) continue
          if (m.tileX < x || m.tileX >= x + r.width ||
              m.tileY < y || m.tileY >= y + r.height) continue
          pushMarker('MINIONS', m.tileX, m.tileY)
        }
      }
    }
    // Boss-chamber marker — always drawn (gold) regardless of intel so
    // the player can locate the boss.
    const boss = rooms.find(r => r.definitionId === 'boss_chamber')
    if (boss) {
      els.push(h('div', {
        className: 'qf-minimap-boss',
        title: 'Boss Chamber',
        style: {
          left: `${((boss.gridX + boss.width / 2)  / W) * 100}%`,
          top:  `${((boss.gridY + boss.height / 2) / H) * 100}%`,
        },
      }))
    }

    mount(canvas, els)
  }

  // Live adventurer pings on the radar (day phase only). Unlike the
  // intel-driven rooms/markers (which the player learns over time), these
  // show the real-time positions of the invaders the player is watching on
  // the main canvas — so the radar reads as a live tactical display during
  // the invasion. Elements are POOLED per adventurer instanceId: recreating
  // them each frame would restart the CSS ping animation (freezing it at
  // frame 0), so we create once and only nudge left/top thereafter.
  _renderBlips() {
    const layer = this._refs.mapBlips
    if (!layer) return
    const gs = this._gameState
    const d  = gs?.dungeon
    if (!this._blipEls) this._blipEls = new Map()
    const isDay = (gs?.meta?.phase ?? 'night') === 'day'
    if (!isDay || !d) {
      if (this._blipEls.size) { this._blipEls.clear(); mount(layer, []) }
      return
    }
    const W = d.gridWidth || 80, H = d.gridHeight || 54
    const advs = gs.adventurers?.active ?? []
    const seen = new Set()
    for (const a of advs) {
      if (!a || a.tileX == null || a.tileY == null) continue
      if ((a.resources?.hp ?? a.hp ?? 1) <= 0 || a.aiState === 'dead') continue
      const id = a.instanceId
      if (id == null) continue
      seen.add(id)
      let el = this._blipEls.get(id)
      if (!el) {
        el = h('div', { className: 'qf-minimap-blip qf-minimap-blip-adv' })
        this._blipEls.set(id, el)
        layer.appendChild(el)
      }
      el.style.left = `${((a.tileX + 0.5) / W) * 100}%`
      el.style.top  = `${((a.tileY + 0.5) / H) * 100}%`
    }
    // Retire blips for adventurers that left / died this frame.
    for (const [id, el] of this._blipEls) {
      if (!seen.has(id)) { el.remove(); this._blipEls.delete(id) }
    }
  }

  // ── Events / tick ───────────────────────────────────────────────
  _wireEvents() {
    const sub = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    // Re-draw the radar when the dungeon shape or boss level changes.
    sub('BOSS_LEVELED_UP', () => this._renderMap())
    sub('ROOM_PLACED',  () => this._renderMap())
    sub('ROOM_REMOVED', () => this._renderMap())
    sub('GRID_EXPANDED', () => this._renderMap())
  }

  _tick() {
    const gs = this._gameState
    if (!gs) {
      this._tickHandle = requestAnimationFrame(() => this._tick())
      return
    }
    // Phase flip recolours the radar (night cyan → day amber) and toggles
    // the live adventurer pings, but doesn't change the intel signature —
    // so re-render the map when the phase changes.
    const phase = gs.meta?.phase ?? 'night'
    if (phase !== this._mapPhase) { this._mapPhase = phase; this._renderMap() }
    // Re-render the mini-map whenever the adventurers' knowledge shifts.
    // The active party learns rooms / traps / minions / items mid-day,
    // so the map can't be place-only — the signature covers all four
    // intel categories (cheap object-key compare each frame).
    const report = _knowledgeReport()
    const mapSig = [
      Object.keys(report.rooms          ?? {}).sort().join(','),
      Object.keys(report.traps          ?? {}).sort().join(','),
      Object.keys(report.enemiesPerRoom ?? {}).sort().join(','),
      Object.keys(report.items          ?? {}).sort().join(','),
    ].join('|')
    if (mapSig !== this._mapTierSig) {
      this._mapTierSig = mapSig
      this._renderMap()
    }
    // Live adventurer pings move every frame during the day invasion, so
    // they update each tick (cheap: pooled elements, only left/top writes).
    this._renderBlips()

    this._tickHandle = requestAnimationFrame(() => this._tick())
  }

  setVisible(v) {
    if (this._refs.root) this._refs.root.style.display = v ? '' : 'none'
  }

  destroy() {
    if (this._tickHandle) cancelAnimationFrame(this._tickHandle)
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this.el?.remove()
  }
}

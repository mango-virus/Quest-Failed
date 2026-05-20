// LeftPanels — DOM port of the design's left HUD column.
//
// Stacks two panels:
//   1. MiniKnowledgeMap — 1:1 blueprint of the dungeon. Rooms tinted by
//      definitionId (the existing MiniMapPanel's contract). Intel-state
//      coloring (FULL / PARTIAL / RUMOR / UNKNOWN) lands when Adv Intel
//      ships in the same pass.
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
import { pixelSprite, roomIcon, spriteKindForDefId } from './sprites.js'
import { snapshotMinion, snapshotItem, snapshotTrap, snapshotRoomMini } from './inGameSnapshot.js'
import { getRoomThumbnail, precacheRoomThumbnails } from './roomThumbnailCache.js'
import { minionAbilityInfo } from '../systems/MinionAbilities.js'

const CATEGORIES = [
  { id: 'ROOMS',   kind: 'room',   icon: '◰', color: 'var(--blood)',  cache: 'rooms',       unlockKey: 'rooms' },
  { id: 'MINIONS', kind: 'minion', icon: '✦', color: 'var(--poison)', cache: 'minionTypes', unlockKey: 'minionTypes' },
  { id: 'TRAPS',   kind: 'trap',   icon: '⚒', color: 'var(--warn)',   cache: 'trapTypes',   unlockKey: 'trapTypes' },
  { id: 'ITEMS',   kind: 'item',   icon: '◆', color: 'var(--info)',   cache: 'items',       unlockKey: null },
]

// Knowledge-tier colors. Matches KnowledgeMapOverlay's STATE_COLOR so
// the mini-map reads as a small version of the full intel screen.
//   FULL    — adventurers know this room cold (red, strongly avoided)
//   PARTIAL — half-remembered (orange, mildly avoided)
//   RUMOR   — stale or 2nd-hand intel (cyan, lightly avoided)
//   UNKNOWN — never seen (dim grey, walked in blind)
const TIER_COLOR = {
  FULL:    '#c8334a',
  PARTIAL: '#e89a3c',
  RUMOR:   '#5cc8d8',
  UNKNOWN: '#5a4a4e',
}

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
  return { exposurePct: 0, rooms: {}, traps: {}, enemiesPerRoom: {}, leakedRoomCount: 0 }
}

export class LeftPanels {
  constructor(gameState) {
    this._gameState = gameState
    this._listeners = []
    this._selectedKey = null
    this._selectedCategory = 'ROOMS'

    this.el = this._build()
    this._wireEvents()
    this._renderGrid()
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
      h('div', { className: 'panel bevel qf-minimap' }, [
        h('div', { className: 'panel-head' }, [
          h('div', { className: 'title' }, [
            h('span', {
              className: 'diamond',
              style: { background: 'var(--rumor)', boxShadow: '0 0 6px var(--rumor)' },
            }),
            'KNOWLEDGE MAP',
          ]),
          h('div', {
            className: 'meta',
            style: { color: 'var(--warn)' },
            ref: el => { this._refs.mapMeta = el },
          }, '0% EXPOSED'),
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
            // Scan line + rooms layer (populated by _renderMap)
            h('div', {
              className: 'qf-minimap-rooms',
              ref: el => { this._refs.mapRooms = el },
            }),
            h('div', { className: 'qf-minimap-scan' }),
          ]),
          // Legend — tier color → meaning, in the same order as the
          // full Knowledge Map overlay's legend.
          h('div', { className: 'qf-minimap-legend' }, [
            h('div', { className: 'qf-minimap-legend-item' }, [
              h('span', { className: 'qf-minimap-legend-dot', style: { background: TIER_COLOR.FULL } }),
              h('span', { className: 'pix qf-minimap-legend-label' }, 'FULL'),
            ]),
            h('div', { className: 'qf-minimap-legend-item' }, [
              h('span', { className: 'qf-minimap-legend-dot', style: { background: TIER_COLOR.PARTIAL } }),
              h('span', { className: 'pix qf-minimap-legend-label' }, 'PARTIAL'),
            ]),
            h('div', { className: 'qf-minimap-legend-item' }, [
              h('span', { className: 'qf-minimap-legend-dot', style: { background: TIER_COLOR.RUMOR } }),
              h('span', { className: 'pix qf-minimap-legend-label' }, 'RUMOR'),
            ]),
            h('div', { className: 'qf-minimap-legend-item' }, [
              h('span', { className: 'qf-minimap-legend-dot', style: { background: TIER_COLOR.UNKNOWN } }),
              h('span', { className: 'pix qf-minimap-legend-label' }, 'UNKNOWN'),
            ]),
          ]),
        ]),
      ]),

      // ── ConstructionPanel ──────────────────────────────────────
      h('div', { className: 'panel bevel qf-construction' }, [
        // Header — gold-meta removed at user request; TopBar already
        // shows the treasury total and the per-card cost chips on each
        // item make the duplicate header readout redundant.
        h('div', { className: 'panel-head' }, [
          h('div', { className: 'title' }, [
            h('span', { className: 'diamond', style: { background: 'var(--poison)', boxShadow: '0 0 6px var(--poison)' } }),
            'CONSTRUCTION',
          ]),
        ]),
        // Category tabs
        h('div', { className: 'qf-cat-tabs' },
          CATEGORIES.map(cat => h('button', {
            className: 'qf-cat-tab',
            dataset: { cat: cat.id, color: cat.color },
            ref: el => { this._refs[`tab_${cat.id}`] = el },
            style: { '--cat-color': cat.color },
            on: { click: () => this._selectCategory(cat.id) },
          }, [
            h('span', { className: 'qf-cat-icon' }, cat.icon),
            h('span', { className: 'qf-cat-label' }, cat.id),
          ]))
        ),
        // Grid (filled by _renderGrid)
        h('div', {
          className: 'qf-build-grid',
          ref: el => { this._refs.grid = el },
        }),
        // Selection footer (filled by _renderFooter)
        h('div', {
          className: 'qf-build-footer',
          ref: el => { this._refs.footer = el },
        }),
      ]),
    ])

    this._selectCategory(this._selectedCategory, /*skipRerender*/ true)
    this._renderFooter()
    return root
  }

  // ── Category switcher ───────────────────────────────────────────
  _selectCategory(catId, skipRerender = false) {
    this._selectedCategory = catId
    for (const cat of CATEGORIES) {
      const el = this._refs[`tab_${cat.id}`]
      if (el) el.classList.toggle('active', cat.id === catId)
    }
    // Clear any pending selection that doesn't belong to this category.
    if (this._selectedKey) {
      const cat = this._currentCategory()
      const def = this._defsFor(cat).find(d => d.id === this._selectedKey)
      if (!def) this._selectedKey = null
    }
    if (!skipRerender) {
      this._renderGrid()
      this._renderFooter()
    }
  }

  _currentCategory() {
    return CATEGORIES.find(c => c.id === this._selectedCategory) || CATEGORIES[0]
  }

  // ── Build grid ──────────────────────────────────────────────────
  // Pulls defs out of the Phaser JSON cache and filters by unlocks the
  // same way the existing BuildMenu does.
  _defsFor(cat) {
    const game = window.__game
    const scenes = game?.scene?.scenes || []
    let all = null
    for (const s of scenes) {
      const arr = s.cache?.json?.get?.(cat.cache)
      if (Array.isArray(arr)) { all = arr; break }
    }
    if (!Array.isArray(all)) return []
    if (cat.kind === 'room') {
      const allowed = new Set(this._gameState.unlocks?.rooms ?? [])
      return all
        .filter(r => allowed.has(r.id) && !r.placementRules?.fixed && !this._atMax(r, cat))
        .sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
    }
    if (cat.kind === 'minion') {
      const allowed = new Set(this._gameState.unlocks?.minionTypes ?? [])
      let evolutions = null
      for (const s of scenes) {
        const v = s.cache?.json?.get?.('minionEvolutions')
        if (v) { evolutions = v; break }
      }
      const starterIds = evolutions ? new Set(
        Object.values(evolutions)
          .filter(v => Array.isArray(v?.chain))
          .map(v => v.chain[0])
      ) : null
      return all
        .filter(m => allowed.has(m.id) && (!starterIds || starterIds.has(m.id)))
        .sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
    }
    if (cat.kind === 'trap') {
      const allowed = new Set(this._gameState.unlocks?.trapTypes ?? [])
      return all
        .filter(t => allowed.has(t.id))
        .sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
    }
    if (cat.kind === 'item') {
      const archId = this._gameState.player?.bossArchetypeId
      return all
        .filter(it => {
          if (it.hidden) return false
          if (it.archetypeRestriction && it.archetypeRestriction !== archId) return false
          // At its per-dungeon cap (phylactery, each treasure-chest
          // tier, etc.) — drop it from the panel until one frees up.
          if (this._atMax(it, cat)) return false
          return true
        })
        .sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
    }
    return all
  }

  // ── Per-dungeon placement caps ──────────────────────────────────
  // A def is hidden from the construction panel once the dungeon
  // already holds the maximum allowed number of it. Re-appears when
  // one is removed / sold (the _tick signature compare re-renders).

  // Resolve the cap for a def, or null for unlimited. Rooms carry the
  // cap under placementRules (with an optional per-boss-level table);
  // items carry a flat top-level maxPerDungeon.
  _maxFor(def, cat) {
    if (cat.kind === 'room') {
      const byLevel = def.placementRules?.maxPerDungeonByBossLevel
      if (byLevel != null) {
        const lvl = this._gameState.boss?.level ?? this._gameState.meta?.dungeonLevel ?? 1
        let cap = null
        for (let l = 1; l <= lvl; l++) if (byLevel[l] != null) cap = byLevel[l]
        return cap
      }
      return def.placementRules?.maxPerDungeon ?? null
    }
    return def.maxPerDungeon ?? null
  }

  // How many of `def` are already placed in the dungeon.
  _placedCount(def, cat) {
    const gs = this._gameState
    const d  = gs.dungeon ?? {}
    if (cat.kind === 'room') {
      return (d.rooms ?? []).filter(r => r.definitionId === def.id).length
    }
    if (cat.kind === 'item') {
      if (def.id === 'phylactery_heart')  return gs.phylactery ? 1 : 0
      if (def.id === 'door_lock')         return (d.locks ?? []).length
      if (def.id === 'soul_bound_beacon') return (d.beacons ?? []).length
      if (def.id === 'healing_fountain')  return (d.fountains ?? []).length
      if (def.id === 'key_chest')         return (d.keyChests ?? []).length
      if (String(def.id).startsWith('treasure_chest_')) {
        return (d.treasureChests ?? []).filter(c => c.tier === def.tier).length
      }
    }
    return 0
  }

  _atMax(def, cat) {
    const cap = this._maxFor(def, cat)
    if (cap == null) return false
    return this._placedCount(def, cat) >= cap
  }

  // Effective gold cost to place ONE MORE of `def` right now. Rooms
  // whose placementRules declare freeFirstN are free until N copies are
  // placed, then cost the base goldCost — so the panel must show 0 for
  // the early free copies and the real price afterwards. Mirrors
  // DungeonGrid.effectiveRoomCost so the displayed price matches what
  // placement actually charges.
  _costFor(def, cat) {
    const base = def.goldCost ?? def.cost ?? 0
    if (cat.kind === 'room') {
      const freeN = def.placementRules?.freeFirstN ?? 0
      if (freeN > 0 && this._placedCount(def, cat) < freeN) return 0
    }
    return base
  }

  _renderGrid() {
    const grid = this._refs.grid
    if (!grid) return
    const cat = this._currentCategory()
    const defs = this._defsFor(cat)
    const bossLevel = this._gameState.boss?.level ?? 1
    const gold = this._gameState.player?.gold ?? 0

    const cards = defs.map(def => {
      const cost = this._costFor(def, cat)
      const reqLevel = def.unlockLevel ?? 1
      const locked = reqLevel > bossLevel
      const cantAfford = !locked && gold < cost
      const active = !locked && this._selectedKey === def.id
      return h('button', {
        className: 'qf-build-card',
        dataset: {
          id: def.id,
          active: active ? 'true' : 'false',
          locked: locked ? 'true' : 'false',
          cantAfford: cantAfford ? 'true' : 'false',
        },
        style: { '--cat-color': cat.color },
        disabled: locked,
        on: { click: () => locked ? null : this._onCardClick(def, cat) },
      }, [
        h('div', { className: 'qf-build-card-icon' }, [
          this._cardArt(def, cat),
          locked && h('div', { className: 'qf-build-card-lock' }, [
            h('span', { className: 'pix' }, `🔒 LV ${reqLevel}`),
          ]),
        ]),
        h('div', { className: 'qf-build-card-name pix' }, def.name || def.id),
        h('div', { className: 'qf-build-card-cost' }, [
          h('span', { className: 'qf-build-card-coin' }),
          h('span', {
            className: 'pix',
            style: { color: locked ? 'var(--text-dim)'
                                  : cantAfford ? 'var(--hp-low)' : 'var(--gold-bright)' },
          }, String(cost)),
        ]),
        active && h('div', { className: 'qf-build-card-pip', style: { background: cat.color } }),
      ])
    })

    if (cards.length === 0) {
      mount(grid, h('div', { className: 'qf-build-grid-empty' }, [
        h('div', { className: 'pix' }, '◇ COMING SOON ◇'),
      ]))
      return
    }
    mount(grid, cards)
  }

  // Build-card thumbnail. Tries the in-game Phaser texture first (so the
  // construction menu shows the EXACT sprite the player sees in the
  // dungeon view) and falls back to the legacy pixelSprite / roomIcon
  // pipeline when the texture isn't loaded yet.
  //
  // Minions → snapshot of `minion-<defId>-idle` frame 0
  // Rooms   → schematic of def.tileLayout (mirrors original Phaser
  //           BuildMenu preview)
  // Traps   → snapshot of def.spriteKey / def.textureKey
  // Items   → snapshot of def.spriteKey
  _cardArt(def, cat) {
    const fallback = h('span', {
      className: 'qf-build-card-glyph',
      style: { color: cat.color },
    }, cat.icon)
    if (cat.kind === 'minion') {
      const snap = snapshotMinion(def.id, 76)
      if (snap) { snap.classList.add('qf-build-card-snap'); return snap }
      return pixelSprite(spriteKindForDefId(def.id), 64)
    }
    if (cat.kind === 'room') {
      // First choice: hand-authored room screenshot at
      // assets/ui/room-thumbnails/<room_id>.png. The image's
      // natural aspect ratio is preserved while it's scaled to
      // fit the icon slot (max 120×76). `onerror` swaps to the
      // procedural cache fallback when the PNG doesn't exist —
      // so rooms without a screenshot still get a thumbnail
      // (just the procedural version).
      const MAX_W = 120
      const MAX_H = 76
      const img = document.createElement('img')
      img.style.display = 'block'
      img.style.imageRendering = 'pixelated'
      img.style.maxWidth  = `${MAX_W}px`
      img.style.maxHeight = `${MAX_H}px`
      img.style.width  = 'auto'
      img.style.height = 'auto'
      img.style.objectFit = 'contain'
      img.className = 'qf-snap qf-snap-room'
      img.onerror = () => {
        // Screenshot missing — swap the <img> out for the
        // procedural cache canvas (or hide if that's also empty).
        const cached = getRoomThumbnail(def.id)
        if (!cached || !img.parentElement) { img.style.display = 'none'; return }
        const c = document.createElement('canvas')
        const aspect = cached.width / cached.height
        let dispH = MAX_H, dispW = MAX_H * aspect
        if (dispW > MAX_W) { dispW = MAX_W; dispH = MAX_W / aspect }
        dispW = Math.max(1, Math.round(dispW))
        dispH = Math.max(1, Math.round(dispH))
        c.width = dispW
        c.height = dispH
        const cctx = c.getContext('2d')
        cctx.imageSmoothingEnabled = false
        cctx.drawImage(cached, 0, 0, cached.width, cached.height, 0, 0, dispW, dispH)
        c.style.display = 'block'
        c.style.imageRendering = 'pixelated'
        c.className = 'qf-snap qf-snap-room'
        img.parentElement.replaceChild(c, img)
      }
      img.src = `assets/ui/room-thumbnails/${def.id}.png`
      return img
    }
    if (cat.kind === 'trap') {
      const snap = snapshotTrap(def.spriteKey || def.textureKey, 76)
      if (snap) { snap.classList.add('qf-build-card-snap'); return snap }
      return roomIcon('trap', 64)
    }
    if (cat.kind === 'item') {
      const snap = snapshotItem(def.spriteKey, 76)
      if (snap) { snap.classList.add('qf-build-card-snap'); return snap }
      return roomIcon('item', 64)
    }
    return fallback
  }

  _onCardClick(def, cat) {
    if (this._selectedKey === def.id) {
      // Re-click same card → deselect.
      this._selectedKey = null
      EventBus.emit('BUILD_DESELECT')
    } else {
      this._selectedKey = def.id
      EventBus.emit('BUILD_SELECT', { def, kind: cat.kind })
    }
    this._renderGrid()
    this._renderFooter()
  }

  // ── Selection footer ────────────────────────────────────────────
  _renderFooter() {
    const footer = this._refs.footer
    if (!footer) return
    const cat = this._currentCategory()
    const def = this._defsFor(cat).find(d => d.id === this._selectedKey)
    const gold = this._gameState.player?.gold ?? 0

    if (!def) {
      mount(footer, h('div', { className: 'qf-build-footer-empty' }, [
        h('div', { className: 'pix qf-build-footer-empty-eyebrow' }, '◇ NOTHING SELECTED ◇'),
        h('div', { className: 'qf-build-footer-empty-text' },
          `Pick a ${cat.id.toLowerCase().slice(0, -1)} above to begin.`),
      ]))
      footer.style.setProperty('--cat-color', 'var(--line)')
      return
    }
    footer.style.setProperty('--cat-color', cat.color)
    const cost = this._costFor(def, cat)
    const reqLevel = def.unlockLevel ?? 1
    const bossLevel = this._gameState.boss?.level ?? 1
    const locked = reqLevel > bossLevel
    const affordable = !locked && gold >= cost
    const stats = this._statsFor(def, cat)

    mount(footer, [
      h('div', { className: 'qf-build-footer-row' }, [
        h('div', { className: 'qf-build-footer-titlecol' }, [
          h('div', {
            className: 'pix qf-build-footer-name',
            style: { color: cat.color, textShadow: `0 0 6px ${cat.color}66` },
          }, def.name || def.id),
        ]),
        h('div', { className: 'qf-build-footer-cost' }, [
          h('span', { className: 'qf-build-card-coin' }),
          h('span', {
            className: 'pix',
            style: { color: affordable ? 'var(--gold-bright)' : 'var(--hp-low)' },
          }, String(cost)),
        ]),
      ]),
      stats.length > 0 && h('div', {
        className: 'qf-build-footer-stats',
        style: { gridTemplateColumns: `repeat(${stats.length}, 1fr)` },
      }, stats.map(([label, value]) => h('div', { className: 'qf-build-footer-stat' }, [
        h('div', { className: 'pix qf-build-footer-stat-label' }, label),
        h('div', { className: 'pix qf-build-footer-stat-value' }, value),
      ]))),
      // Minions keep their italic flavor line above the tagged block;
      // rooms / traps / items put their (functional) description INTO
      // the tagged EFFECT line, so every category's footer ends with a
      // consistent tagged info block.
      cat.kind === 'minion' && def.description && h('div', { className: 'qf-build-footer-desc' }, def.description),
      this._renderInfoBlock(def, cat),
      h('button', {
        className: 'btn primary qf-build-place',
        disabled: locked || !affordable,
        on: { click: () => this._onPlaceClick(def, cat) },
      }, locked ? `🔒 LOCKED · LV ${reqLevel}`
              : !affordable ? 'NOT ENOUGH GOLD'
              : '▶ PLACE'),
    ])
  }

  // Tagged info block at the bottom of the footer. Minions get ABILITY
  // + BEHAVIOR lines (from MinionAbilities.MINION_ABILITY_INFO); rooms,
  // traps, and items get a single EFFECT line carrying their functional
  // description — so every category reads with the same styled tags.
  _renderInfoBlock(def, cat) {
    const line = (tag, text) => h('div', { className: 'qf-build-footer-ability' }, [
      h('span', { className: 'pix qf-build-footer-ability-tag' }, tag),
      h('span', { className: 'qf-build-footer-ability-text' }, text),
    ])
    if (cat.kind === 'minion') {
      const info = minionAbilityInfo(def.id)
      if (!info) return null
      return h('div', { className: 'qf-build-footer-abilities' }, [
        info.ability  && line('ABILITY',  info.ability),
        info.behavior && line('BEHAVIOR', info.behavior),
      ])
    }
    if (!def.description) return null
    return h('div', { className: 'qf-build-footer-abilities' }, [
      line('EFFECT', def.description),
    ])
  }

  _statsFor(def, cat) {
    if (cat.kind === 'room') {
      const stats = []
      if (def.width && def.height) stats.push(['SIZE', `${def.width}×${def.height}`])
      if (def.tags?.includes('boss')) stats.push(['TYPE', 'BOSS'])
      return stats
    }
    if (cat.kind === 'minion') {
      const stats = []
      if (def.hp != null)     stats.push(['HP',  String(def.hp)])
      if (def.attack != null) stats.push(['ATK', String(def.attack)])
      if (def.speed != null)  stats.push(['SPD', def.speed.toFixed?.(1) ?? String(def.speed)])
      return stats
    }
    if (cat.kind === 'trap' || cat.kind === 'item') {
      const stats = []
      if (def.damage != null) stats.push(['DMG', String(def.damage)])
      if (def.uses   != null) stats.push(['USES', String(def.uses)])
      return stats
    }
    return []
  }

  // PLACE is roughly equivalent to "select this and start placement" — the
  // game already starts placement when BUILD_SELECT fires, so this button
  // just re-confirms. Useful in case the player deselected and wants to
  // re-arm; harmless otherwise. We also clear our local selection state
  // so the grid + footer redraw correctly.
  _onPlaceClick(def, cat) {
    EventBus.emit('BUILD_SELECT', { def, kind: cat.kind })
  }

  // ── MiniKnowledgeMap ────────────────────────────────────────────
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
    const rooms = d.rooms || []
    const minions = this._gameState.minions || []
    // Position rooms as % of the canvas. Room placement coords live on
    // `gridX` / `gridY` (see DungeonGrid.placeRoom); minion coords use
    // `tileX` / `tileY` (different convention, on the Minion entity).
    const report = _knowledgeReport()
    const blocks = rooms.map(r => {
      // Color by intel tier — same convention as the full Knowledge
      // Map overlay. UNKNOWN rooms stay dim grey; once an adventurer
      // leaks any intel they tint up through RUMOR → PARTIAL → FULL.
      const tier = report.rooms[r.instanceId] || 'UNKNOWN'
      const tint = TIER_COLOR[tier] || TIER_COLOR.UNKNOWN
      const x = r.gridX ?? 0, y = r.gridY ?? 0
      return h('div', {
        className: 'qf-minimap-room',
        title: `${r.definitionId || 'room'} · ${tier}`,
        dataset: { tier },
        style: {
          left:   `${(x / W) * 100}%`,
          top:    `${(y / H) * 100}%`,
          width:  `${(r.width  / W) * 100}%`,
          height: `${(r.height / H) * 100}%`,
          background: tier === 'UNKNOWN' ? `${tint}1c` : `${tint}38`,
          borderColor: tint,
          boxShadow: tier === 'UNKNOWN'
            ? `inset 0 0 0 1px rgba(0,0,0,0.3)`
            : `0 0 6px ${tint}55, inset 0 0 0 1px rgba(0,0,0,0.3)`,
        },
      })
    })
    // Boss dot — center of the boss chamber if any.
    const boss = rooms.find(r => r.definitionId === 'boss_chamber')
    const bossDot = boss ? h('div', {
      className: 'qf-minimap-boss',
      style: {
        left: `${((boss.gridX + boss.width / 2)  / W) * 100}%`,
        top:  `${((boss.gridY + boss.height / 2) / H) * 100}%`,
      },
    }) : null
    // Minion dots
    const minionDots = minions.map(m => {
      if (m.tileX == null || m.tileY == null) return null
      return h('div', {
        className: 'qf-minimap-minion',
        style: {
          left: `${(m.tileX / W) * 100}%`,
          top:  `${(m.tileY / H) * 100}%`,
        },
      })
    }).filter(Boolean)

    mount(canvas, [...blocks, bossDot, ...minionDots])
  }

  // ── Events / tick ───────────────────────────────────────────────
  _wireEvents() {
    const sub = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    sub('BUILD_DESELECT', () => {
      this._selectedKey = null
      this._renderGrid()
      this._renderFooter()
    })
    // Re-render when level unlocks new content or pacts add gating.
    sub('BOSS_LEVELED_UP', () => { this._kickRoomPrecache(); this._renderGrid(); this._renderMap() })
    // Game scene is guaranteed active by the time night begins —
    // retry precache in case LeftPanels was constructed before the
    // scene booted (or before themesprite textures finished loading).
    sub('NIGHT_PHASE_BEGAN', () => this._kickRoomPrecache())
    sub('DAY_PHASE_BEGAN',   () => this._kickRoomPrecache())
    // Dungeon shape changes — re-draw the mini-map.
    sub('ROOM_PLACED',  () => this._renderMap())
    sub('ROOM_REMOVED', () => this._renderMap())
    sub('GRID_EXPANDED', () => this._renderMap())
    // A room thumbnail finished rendering via the offscreen Phaser
    // RT pipeline — swap the iconic placeholder out for the real
    // pixel-identical render. Only re-render when the rooms tab is
    // currently visible to avoid wasted work.
    sub('ROOM_THUMBNAIL_READY', () => {
      if (this._selectedCategory === 'ROOMS') this._renderGrid()
    })
    // Kick off the initial precache pass once the Phaser game has
    // initialised. May not succeed immediately if the Game scene
    // hasn't booted yet — repeated calls are no-ops for cached /
    // pending rooms so the next BOSS_LEVELED_UP retry covers it.
    this._kickRoomPrecache()
  }

  // Walk every unlocked room def and queue a thumbnail render for
  // each one not already cached. Safe to call repeatedly.
  _kickRoomPrecache() {
    const cat = CATEGORIES.find(c => c.kind === 'room')
    if (!cat) return
    const defs = this._defsFor(cat)
    if (defs.length > 0) precacheRoomThumbnails(defs)
  }

  _tick() {
    const gs = this._gameState
    if (!gs) {
      this._tickHandle = requestAnimationFrame(() => this._tick())
      return
    }
    // Gold readout removed from the CONSTRUCTION header at user request;
    // TopBar shows the treasury total and per-card cost chips cover the
    // affordability check. No `goldMeta` to refresh anymore.
    // Mini-map header shows DUNGEON EXPOSURE — the tier-weighted % from
    // the live KnowledgeSystem report (FULL intel counts 4× a RUMOR), so
    // it matches the Knowledge Map overlay + Adventurer Intel panel
    // exactly. 0% = nobody has scouted you; 100% = every room is fully
    // mapped. Color ramps cool→hot as exposure rises.
    const report = _knowledgeReport()
    const pct = report.exposurePct
    if (pct !== this._prevExposurePct) {
      this._prevExposurePct = pct
      if (this._refs.mapMeta) {
        this._refs.mapMeta.textContent = `${pct}% EXPOSED`
        // Color ramps with exposure level: <25% safe (poison green),
        // <50% caution (gold), <75% warn (orange), 75%+ critical (red).
        this._refs.mapMeta.style.color =
          pct >= 75 ? 'var(--blood)'
          : pct >= 50 ? 'var(--warn)'
          : pct >= 25 ? 'var(--gold)'
          : 'var(--poison)'
      }
    }
    // Re-tint the mini-map rooms when any room's intel tier shifts. The
    // active party learns rooms mid-day, so the map can't be place-only —
    // re-render whenever the tier map changes (cheap signature compare).
    const tierSig = JSON.stringify(report.rooms)
    if (tierSig !== this._mapTierSig) {
      this._mapTierSig = tierSig
      this._renderMap()
    }

    // Placement-count signature — when a room / item is placed or
    // removed, a def may cross (or drop back under) its per-dungeon
    // cap, so the card grid needs a re-filter. Cheap to compute every
    // frame; only re-renders the grid on an actual change.
    const dn  = gs.dungeon ?? {}
    const gridSig = [
      dn.rooms?.length          ?? 0,
      dn.treasureChests?.length ?? 0,
      dn.beacons?.length        ?? 0,
      dn.locks?.length          ?? 0,
      dn.fountains?.length      ?? 0,
      dn.keyChests?.length      ?? 0,
      gs.phylactery ? 1 : 0,
    ].join(',')
    if (gridSig !== this._gridSig) {
      const first = this._gridSig === undefined
      this._gridSig = gridSig
      if (!first) {
        // A maxed-out def may have dropped off the grid — clear a stale
        // selection so the footer doesn't keep showing it.
        if (this._selectedKey) {
          const cat = this._currentCategory()
          if (!this._defsFor(cat).find(d => d.id === this._selectedKey)) {
            this._selectedKey = null
          }
        }
        this._renderGrid()
        // Footer too — a freeFirstN room's price flips from FREE to its
        // gold cost once the free copies are used up.
        this._renderFooter()
      }
    }

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

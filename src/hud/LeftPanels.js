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
import { DungeonGrid } from '../systems/DungeonGrid.js'
import { pixelSprite, roomIcon, spriteKindForDefId } from './sprites.js'
import { snapshotMinion, snapshotItem, snapshotTrap, snapshotRoomMini } from './inGameSnapshot.js'
import { getRoomThumbnail, precacheRoomThumbnails } from './roomThumbnailCache.js'
import { minionAbilityInfo } from '../systems/MinionAbilities.js'
import { applyMerchantPrice, merchantPriceMult, buildScaleMul } from '../util/merchantPricing.js'
import { fallenRevivable, totalReviveCost } from '../util/minionRevive.js'
import { trapCap, rosterCap } from '../util/slotCaps.js'

const CATEGORIES = [
  { id: 'ROOMS',   kind: 'room',   icon: '◰', color: 'var(--blood)',  cache: 'rooms',       unlockKey: 'rooms' },
  { id: 'MINIONS', kind: 'minion', icon: '✦', color: 'var(--poison)', cache: 'minionTypes', unlockKey: 'minionTypes' },
  { id: 'TRAPS',   kind: 'trap',   icon: '⚒', color: 'var(--warn)',   cache: 'trapTypes',   unlockKey: 'trapTypes' },
  { id: 'ITEMS',   kind: 'item',   icon: '◆', color: 'var(--info)',   cache: 'items',       unlockKey: null },
]

// Tinkerer's Workshop upgrade catalog — name + description per room type,
// used by the build-card "★ UPGRADED" badge's hover tooltip. Mirrors
// EventSystem._tinkerCatalog (source of truth) so the picker modal and
// the build menu can never disagree on what the upgrade does.
const TINKERER_BADGE_INFO = {
  starter_corridor:    { name: 'Greased Corridor',  description: '−25% damage taken in Corridors' },
  starter_barracks:    { name: 'Drill Sergeant',    description: '+5 roster slots per Barracks' },
  starter_guard_post:  { name: 'Eagle Eye',         description: '+25% Guard Post ambush damage' },
  crypt:               { name: 'Crowded Crypt',     description: '+2 Risen Bones per Crypt (6 total)' },
  trap_factory:        { name: 'Assembly Line',     description: '+1 trap slot per Trap Factory' },
  treasury:            { name: 'Golden Vault',      description: 'Treasury stipend +50% · chests +1 tier' },
  armory:              { name: 'Weaponsmith',       description: 'Armory ATK aura doubled' },
  library_of_whispers: { name: "Oracle's Tome",     description: '+1 boss XP per kill, per Library' },
  watchtower:          { name: 'Cannonade',         description: '2× Watchtower first-strike damage' },
  wandering_gate:      { name: 'Skewed Gate',       description: 'Boss-chamber teleport 5% → 15%' },
  veil_of_forgetting:  { name: 'Deeper Veil',       description: 'Also wipes 2-hop neighbour intel' },
  catacombs:           { name: 'Restless Tomb',     description: '+1 Revenant per Catacombs (3 max)' },
  mimic_vault:         { name: 'Hungry Vault',      description: '+2 mimic slots per Vault' },
  hall_of_trials:      { name: 'Champion Trials',   description: 'Tier-3 spawn instead of Tier-2' },
  wishing_well:        { name: 'Cursed Well',       description: 'Curse chance 50% → 70%' },
  false_exit:          { name: 'Painful Landing',   description: 'Teleported fleers take 25% maxHp' },
  hall_of_madness:     { name: 'Total Frenzy',      description: 'Friendly-fire 60% → 90%' },
  throne_room:         { name: 'Tyrant Throne',     description: 'Mini-boss +50% HP and +50% ATK' },
  sanctum:             { name: "Sanctum's Heart",   description: 'Boss HP regen doubled' },
}

// ── Knowledge-category color scheme ─────────────────────────────────
// ONE 4-category palette shared across all three knowledge surfaces
// (this mini-map, the KnowledgeScreen menu, the big Knowledge Map
// overlay) so the player learns one legend and reads them all. Each
// category answers "what kind of intel did the adventurers leak":
//   ROOMS   — they know a room exists / its layout       (cyan)
//   TRAPS   — they know a trap's placement               (orange)
//   MINIONS — they've sighted enemies in a room          (red)
//   ITEMS   — they know a placed item (phylactery / etc.) (magenta)
// Mirrored verbatim in KnowledgeScreen.CAT_COLOR and
// KnowledgeMapOverlay.CAT_COLOR — keep all three in sync.
const CAT_COLOR = {
  ROOMS:   '#5cc8d8',
  TRAPS:   '#e89a3c',
  MINIONS: '#c8334a',
  ITEMS:   '#c879d8',
}
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
        // Pay-to-revive bar — shown only at night when minions have fallen.
        // Filled by _renderReviveBar (refreshed on count/gold change in _tick).
        h('div', {
          ref: el => { this._refs.reviveBar = el },
          style: { display: 'none', padding: '5px 9px 0' },
        }),
        // Slot counter (traps / minions) — filled by _renderSlots
        h('div', {
          ref: el => { this._refs.slots = el },
          style: {
            display: 'none', justifyContent: 'space-between', alignItems: 'center',
            padding: '3px 9px', fontSize: '8px', letterSpacing: '0.5px',
          },
        }),
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
    this._renderSlots()
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
    this._renderSlots()
  }

  // ── Slot counter (trap / minion capacity) ───────────────────────
  // Trap slots come from Trap Factories (×3 each, +1 each if tinkered);
  // minion roster slots from Barracks (×10 each, +5 each if tinkered).
  // These MUST stay in lockstep with NightPhase._trapCap() / _rosterCap()
  // (the caps actually enforced at placement) or the display lies.
  _slotInfo(cat) {
    const gs = this._gameState
    const d  = gs.dungeon ?? {}
    // Caps come from the shared src/util/slotCaps.js so the display always
    // matches what NightPhase actually enforces at placement.
    if (cat.kind === 'trap') {
      return { label: 'TRAP SLOTS', used: (d.traps ?? []).length, cap: trapCap(gs) }
    }
    if (cat.kind === 'minion') {
      const used = (gs.minions ?? []).filter(
        m => (m.class ?? 'roster') === 'roster' && m.aiState !== 'dead').length
      return { label: 'MINION SLOTS', used, cap: rosterCap(gs) }
    }
    return null
  }

  _renderSlots() {
    const el = this._refs.slots
    if (!el) return
    const info = this._slotInfo(this._currentCategory())
    if (!info) { el.style.display = 'none'; return }
    el.style.display = 'flex'
    const full = info.used >= info.cap
    mount(el, [
      h('span', { className: 'pix', style: { color: 'var(--text-dim)' } }, info.label),
      h('span', { className: 'pix', style: {
        color: full ? 'var(--hp-low)' : 'var(--gold-bright)',
      } }, `${info.used} / ${info.cap}`),
    ])
  }

  // ── Pay-to-revive bar ───────────────────────────────────────────
  // Raw (unfiltered) minionTypes array from the JSON cache, for revive-cost
  // lookups (a fallen minion's def may not be in the buildable list).
  _allMinionDefs() {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const arr = s.cache?.json?.get?.('minionTypes')
      if (Array.isArray(arr)) return arr
    }
    return []
  }

  // Shown only during the night build phase, and only when revivable minions
  // have fallen. Reviving costs gold (50% of each minion's current build cost,
  // via the shared util) and is the ONLY way to bring them back — unrevived
  // fallen are lost at dawn. Emits REVIVE_FALLEN_REQUEST; Game.js charges + revives.
  _renderReviveBar() {
    const el = this._refs.reviveBar
    if (!el) return
    const gs = this._gameState
    const fallen = (gs?.meta?.phase === 'night') ? fallenRevivable(gs) : []
    if (fallen.length === 0) { el.style.display = 'none'; return }
    const cost   = totalReviveCost(gs, this._allMinionDefs())
    const afford = (gs.player?.gold ?? 0) >= cost
    el.style.display = 'block'
    mount(el, h('button', {
      className: 'btn',
      style: {
        width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: '8px', borderColor: 'var(--poison)',
        opacity: afford ? '1' : '0.55', cursor: afford ? 'pointer' : 'not-allowed',
      },
      // Game.js re-checks affordability and blocks if short, so the click is
      // safe either way; the guard here just avoids a pointless event.
      on: { click: () => { if (afford) EventBus.emit('REVIVE_FALLEN_REQUEST') } },
    }, [
      h('span', { className: 'pix', style: { fontSize: '9px', letterSpacing: '0.5px' } },
        `⚰ REVIVE ${fallen.length} FALLEN`),
      h('span', { className: 'pix', style: {
        fontSize: '9px', color: afford ? 'var(--gold-bright)' : 'var(--hp-low)',
      } }, `${cost}g`),
    ]))
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
        // Sparse-table baseline (2026-05-22): seed `cap` to the lowest
        // entry's value so a sparse table (e.g. throne_room's L9/L10)
        // doesn't fall through to "unlimited" when viewed below its
        // first entry — important under the mango cheat which flattens
        // unlockLevel to 1. Matches DungeonGrid.effectiveMaxPerDungeon.
        const keys = Object.keys(byLevel)
          .map(k => parseInt(k, 10))
          .filter(n => Number.isFinite(n))
          .sort((a, b) => a - b)
        if (keys.length === 0) return def.placementRules?.maxPerDungeon ?? null
        let cap = byLevel[keys[0]]
        for (const l of keys) if (l <= lvl) cap = byLevel[l]
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

  // Effective gold cost to place ONE MORE of `def` right now. For rooms
  // this defers to DungeonGrid.effectiveRoomCost — the single source of
  // truth — so the displayed price matches what placement actually
  // charges, including freeFirstN free copies and escalating costStep.
  _costFor(def, cat) {
    // Unified boss-level + day build-cost scaling (util/merchantPricing.js),
    // applied to EVERY buildable so the build-menu price always matches what
    // the placement charge sites in NightPhase actually debit.
    const scaleMul = buildScaleMul(this._gameState)
    let raw
    if (cat.kind === 'room') {
      raw = Math.round(
        DungeonGrid.effectiveRoomCost(def, this._gameState.dungeon?.rooms ?? []) * scaleMul)
    } else {
      const base = def.goldCost ?? def.cost ?? 0
      if (cat.kind === 'minion') {
        // Minions also fold in the per-night minionGoldCostMult mechanic flag
        // (mirrors NightPhase._effectiveMinionCost) before the shared scaling.
        const flagMul = (this._gameState._mechanicFlags ?? {}).minionGoldCostMult ?? 1
        raw = Math.max(0, Math.round(base * flagMul * scaleMul))
      } else {
        // Traps + items: base × shared scaling. (Trap discount flags are
        // applied at the charge site; display shows the undiscounted scaled
        // price, matching the prior behaviour.)
        raw = Math.max(0, Math.round(base * scaleMul))
      }
    }
    // Goblin Market — apply the one-night repricing multiplier LAST so the
    // displayed price exactly matches what the placement charge sites
    // (which route through the same applyMerchantPrice helper) debit.
    return applyMerchantPrice(this._gameState, def.id, raw)
  }

  _renderGrid() {
    const grid = this._refs.grid
    if (!grid) return
    const cat = this._currentCategory()
    const defs = this._defsFor(cat)
    const bossLevel = this._gameState.boss?.level ?? 1
    const gold = this._gameState.player?.gold ?? 0

    // Tinkerer's Workshop upgrades — gameState._tinkeredRoomTypes is a
    // flat list of room definitionIds that the player has chosen to
    // upgrade. The card paints a "★ UPGRADED" badge with a hover
    // tooltip describing the upgrade effect (looked up via the catalog
    // mirrored from EventSystem._tinkerCatalog).
    const tinkered = new Set(this._gameState._tinkeredRoomTypes ?? [])

    const cards = defs.map(def => {
      const cost = this._costFor(def, cat)
      const reqLevel = def.unlockLevel ?? 1
      const locked = reqLevel > bossLevel
      const cantAfford = !locked && gold < cost
      const active = !locked && this._selectedKey === def.id
      const isTinkered = cat.kind === 'room' && tinkered.has(def.id)
      const tinkerInfo = isTinkered ? TINKERER_BADGE_INFO[def.id] : null
      // Goblin Market — discount / markup badge. Only when a repricing is
      // active for this def AND the (effective) price isn't free.
      const mktMult = merchantPriceMult(this._gameState, def.id)
      const showMkt = mktMult !== 1 && cost > 0
      const mktKind = mktMult < 1 ? 'discount' : 'markup'
      const mktPct  = mktMult < 1
        ? `-${Math.round((1 - mktMult) * 100)}%`
        : `+${Math.round((mktMult - 1) * 100)}%`
      return h('button', {
        className: 'qf-build-card',
        dataset: {
          id: def.id,
          active: active ? 'true' : 'false',
          locked: locked ? 'true' : 'false',
          cantAfford: cantAfford ? 'true' : 'false',
          tinkered: isTinkered ? 'true' : 'false',
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
          // Tinkerer badge — golden "★ UPGRADED" tag pinned to the top-
          // right of the icon, native browser tooltip carries the
          // upgrade description text on hover.
          isTinkered && h('div', {
            className: 'qf-build-card-tinkered',
            title: tinkerInfo
              ? `${tinkerInfo.name} — ${tinkerInfo.description}`
              : 'Upgraded by the Tinkerer',
          }, '★ UPGRADED'),
          // Goblin Market price badge — top-left, green for a discount,
          // red for a markup. Shown only while the market is repricing.
          showMkt && h('div', {
            className: `qf-build-card-price-badge ${mktKind}`,
            title: mktKind === 'discount' ? 'Goblin Market discount' : 'Goblin Market markup',
          }, mktPct),
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
      // Arrow trap frame 0 is just the wall nub — show a launched-arrow frame.
      const frameIdx = def.id === 'shooting_arrows' ? 3 : 0
      const snap = snapshotTrap(def.spriteKey || def.textureKey, 76, frameIdx)
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
    // BOSS_LEVEL_CHANGED — fires on both up AND down (Demon's Wager
    // can demote the boss). Re-render the build menu so newly-locked
    // / newly-unlocked items reflect immediately.
    sub('BOSS_LEVEL_CHANGED', () => this._renderGrid())
    // Tinkerer's Workshop — when the player picks an upgrade, the card
    // for that room type needs to paint the "★ UPGRADED" badge.
    sub('TINKERER_UPGRADE_APPLIED', () => this._renderGrid())
    // Goblin Market — prices + discount/markup badges change when the
    // event sets (announce) or clears (day-end) its repricing map.
    sub('GOBLIN_MARKET_PRICES_SET', () => this._renderGrid())
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
    // Slot counter — refresh when trap / minion counts or caps change.
    const slotInfo = this._slotInfo(this._currentCategory())
    const slotSig  = slotInfo ? `${slotInfo.used}/${slotInfo.cap}` : 'none'
    if (slotSig !== this._prevSlotSig) {
      this._prevSlotSig = slotSig
      this._renderSlots()
    }
    // Pay-to-revive bar — refresh when the fallen count or gold changes (gold
    // is in the signature so the affordability styling updates after a spend).
    const reviveSig = (gs.meta?.phase === 'night')
      ? `${fallenRevivable(gs).length}:${gs.player?.gold ?? 0}`
      : 'off'
    if (reviveSig !== this._prevReviveSig) {
      this._prevReviveSig = reviveSig
      this._renderReviveBar()
    }
    // Re-render the mini-map whenever the adventurers' knowledge shifts.
    // The active party learns rooms / traps / minions / items mid-day,
    // so the map can't be place-only — the signature covers all four
    // intel categories (cheap object-key compare each frame).
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

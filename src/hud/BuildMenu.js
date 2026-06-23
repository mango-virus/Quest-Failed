// BuildMenu — construction as an anchored PLACE-button popout (the design's
// `BuildMenu` / `.bsh-*`). Extracted from the old LeftPanels construction dock
// so LeftPanels is now just the radar minimap.
//
// A TrayShell that erupts from the PLACE button (bottom-left): a top segmented
// category bar (ROOMS / MINIONS / TRAPS / ITEMS) over a paged row of 7
// rarity-tiered inventory slots. Hover a slot for a detail tooltip; click to
// arm it (emits BUILD_SELECT — placement itself stays in NightPhase) and spawn
// a cursor-trailing placement ghost. Part of the one-at-a-time tray group via
// TrayShell, so opening any other tray closes it. Does NOT auto-open at night
// (per design decision) — the player opens it from PLACE.

import { h } from './dom.js'
import { TrayShell } from './TrayShell.js'
import { EventBus } from '../systems/EventBus.js'
import { DungeonGrid } from '../systems/DungeonGrid.js'
import { pixelSprite, roomIcon, spriteKindForDefId } from './sprites.js'
import { liveMinion, snapshotItem, snapshotTrap } from './inGameSnapshot.js'
import { getRoomThumbnail } from './roomThumbnailCache.js'
import { applyMerchantPrice, buildScaleMul } from '../util/merchantPricing.js'
import { rosterCap, trapCap } from '../util/slotCaps.js'

// Categories — same kind/cache/unlock wiring as the old dock, with the
// design's glyphs + accent colours.
const CATEGORIES = [
  { id: 'ROOMS',   kind: 'room',   glyph: '⌂', color: 'var(--gold)',   cache: 'rooms' },
  { id: 'MINIONS', kind: 'minion', glyph: '☠', color: 'var(--poison)', cache: 'minionTypes' },
  { id: 'TRAPS',   kind: 'trap',   glyph: '⚙', color: 'var(--blood)',  cache: 'trapTypes' },
  { id: 'ITEMS',   kind: 'item',   glyph: '◈', color: 'var(--rumor)',  cache: 'items' },
]
const PER_PAGE = 7

// Rarity tier by unlock level (design's buildRarity).
function buildRarity(lv) {
  if (lv >= 13) return { key: 'legendary', c: 'var(--goldB)', name: 'LEGENDARY' }
  if (lv >= 9)  return { key: 'epic',      c: 'var(--info)',  name: 'EPIC' }
  if (lv >= 6)  return { key: 'rare',      c: 'var(--xpB)',   name: 'RARE' }
  if (lv >= 3)  return { key: 'uncommon',  c: 'var(--poison)', name: 'UNCOMMON' }
  return { key: 'common', c: 'var(--mute)', name: 'COMMON' }
}

export class BuildMenu {
  constructor(gameState) {
    this._gameState = gameState
    this._listeners = []
    this._tray = null
    this._cat = 'ROOMS'
    this._page = 0
    // Live carousel refs (set via ref callbacks in _render) — _goToPage updates
    // the track transform + pager chrome in place so a page slide isn't killed
    // by a full re-render.
    this._trackEl = null
    this._pipsEl = null
    this._arrowLEl = null
    this._arrowREl = null
    this._armedId = null
    this._ghost = null
    this._onMouseMove = (e) => this._moveGhost(e)
    this._wireEvents()
  }

  // ── open / close ────────────────────────────────────────────────
  open() {
    if (this._tray) return
    this._page = 0
    this._tray = new TrayShell({
      anchorSel: '[data-build-anchor]',
      align:  'left',
      vAlign: 'up',
      accent: this._catInfo().color,
      width:  'min(63vw, 1020px)',
      height: 248,
      detachable: true,
      title: 'BUILD',
      detachedSize:      { width: '560px', height: '470px' },
      detachedSizeSmall: { width: '440px', height: '400px' },
      onDetach: () => this._rerender(),   // re-render as a grid for the square shape
      onClose: () => { this._teardownGhost(); this._hideTip(); this._tray = null },
    })
    this._tray.setContent(this._render())
    this._tray.open()
  }

  close() { this._tray?.close(); this._tray = null; this._teardownGhost(); this._hideTip() }
  toggle() { this._tray ? this.close() : this.open() }
  isOpen() { return !!this._tray }

  _rerender() { if (this._tray) { this._hideTip(); this._tray.setAccent(this._catInfo().color); this._tray.setContent(this._render()) } }

  _wireEvents() {
    const sub = (ev, fn) => { EventBus.on(ev, fn); this._listeners.push([ev, fn]) }
    // PLACE button toggles; explicit open; day phase closes the DOCKED drawer
    // (no building by day) — but a player who popped the panel out keeps it:
    // detached menus persist across phase flips until the player closes them.
    sub('TOGGLE_BUILD_DRAWER', () => this.toggle())
    sub('OPEN_BUILD_DRAWER',   () => this.open())
    sub('DAY_PHASE_BEGAN',     () => { if (!this._tray?.isDetached) this.close() })
    // Arming a real tool (MOVE / SELL / UPGRADE) leaves build mode → close the
    // drawer. mode === null is PLACE itself (don't close). This also fires on the
    // place→move hand-off after a room is dropped.
    sub('TOOL_MODE_CHANGED',   ({ mode } = {}) => { if (mode) this.close() })
    // Something else cleared the armed build → drop our armed state + ghost.
    sub('BUILD_DESELECT', () => { if (this._armedId) { this._armedId = null; this._teardownGhost(); this._rerender() } })
    // Re-render the slots when unlocks / prices / placement counts shift.
    const reRenderIfOpen = () => { if (this._tray) this._rerender() }
    sub('BOSS_LEVELED_UP', reRenderIfOpen)
    sub('BOSS_LEVEL_CHANGED', reRenderIfOpen)
    sub('TINKERER_UPGRADE_APPLIED', reRenderIfOpen)
    sub('GOBLIN_MARKET_PRICES_SET', reRenderIfOpen)
    sub('ROOM_PLACED', reRenderIfOpen)
    sub('ROOM_REMOVED', reRenderIfOpen)
    sub('GRID_EXPANDED', reRenderIfOpen)
  }

  destroy() {
    for (const [ev, fn] of this._listeners) EventBus.off(ev, fn)
    this._listeners = []
    this.close()
  }

  // ── Render ──────────────────────────────────────────────────────
  _catInfo() { return CATEGORIES.find(c => c.id === this._cat) || CATEGORIES[0] }

  _render() {
    const cat = this._catInfo()
    const items = this._defsFor(cat)
    const detached = !!this._tray?.isDetached
    const bossLv = this._gameState.boss?.level ?? 1
    const gold = this._gameState.player?.gold ?? this._gameState.player?.soulEssence ?? 0

    // Top segmented category bar (shared .htr-segbar). On the MINIONS tab the
    // roster slot readout rides on the RIGHT of this bar — header space above
    // the cards, so it never overlaps a card the way a card-area chip did.
    const segTabs = CATEGORIES.map(c => h('div', {
      className: 'htr-segtab' + (this._cat === c.id ? ' on' : ''),
      style: { '--tc': c.color },
      on: { click: () => { if (this._cat !== c.id) { this._cat = c.id; this._page = 0; this._disarm(); this._rerender() } } },
    }, [
      h('span', { className: 'tg' }, c.glyph),
      h('span', { className: 'lb' }, c.id),
      h('span', { className: 'ct' }, String(this._defsFor(c).length)),
    ]))
    if (this._cat === 'MINIONS')   segTabs.push(this._renderSlotMeter('minion'))
    else if (this._cat === 'TRAPS') segTabs.push(this._renderSlotMeter('trap'))
    const segbar = h('div', { className: 'htr-segbar' }, segTabs)

    // ── Detached (floating square) → one scrollable grid, no pager / carousel. ──
    if (detached) {
      const cards = items.length === 0
        ? [ h('div', { className: 'bsh-empty' }, 'Nothing unlocked here yet.') ]
        : items.map((def, i) => this._renderSlot(def, cat, i, i, bossLv, gold))
      const mid = h('div', { className: 'bsh-mid' }, [
        h('div', { className: 'bsh-pager' }, [ h('div', { className: 'bsh-rowclip' }, [ h('div', { className: 'bsh-row' }, cards) ]) ]),
      ])
      return h('div', { className: 'htr-chrome m-col' }, [ segbar, h('div', { className: 'htr-content' }, [ mid ]) ])
    }

    // ── Anchored → a CAROUSEL. Every page is a full-width panel in one flex
    // track; paging just translates the track a whole page (_goToPage), so the
    // cards visibly slide the full width past before settling — no mid-slide
    // jump. The track + pager chrome are updated in place, never rebuilt mid
    // -transition (a rebuild would kill the CSS slide). ──
    const per = PER_PAGE
    const pages = Math.max(1, Math.ceil(items.length / per))
    if (this._page > pages - 1) this._page = pages - 1

    const panels = Array.from({ length: pages }, (_, p) => {
      const vis = items.slice(p * per, p * per + per)
      const cards = vis.length === 0
        ? [ h('div', { className: 'bsh-empty' }, 'Nothing unlocked here yet.') ]
        : vis.map((def, i) => this._renderSlot(def, cat, p * per + i, i, bossLv, gold))
      return h('div', { className: 'bsh-page', style: { flex: `0 0 ${100 / pages}%` } }, cards)
    })
    const track = h('div', {
      className: 'bsh-track',
      ref: el => { this._trackEl = el },
      style: { width: `${pages * 100}%`, transform: `translateX(-${(this._page * 100) / pages}%)` },
    }, panels)

    const pips = pages > 1 ? h('div', { className: 'bsh-pips', ref: el => { this._pipsEl = el } }, Array.from({ length: pages }, (_, i) => h('span', {
      className: 'dot' + (i === this._page ? ' on' : ''),
      on: { click: () => this._goToPage(i) },
    }))) : null

    const arrowL = h('div', {
      className: 'bsh-arrow left' + (this._page <= 0 ? ' off' : ''),
      ref: el => { this._arrowLEl = el },
      on: { click: () => this._goToPage(this._page - 1) },
    }, [ '◂', h('span', { className: 'lab' }, 'PREV') ])
    const arrowR = h('div', {
      className: 'bsh-arrow right' + (this._page >= pages - 1 ? ' off' : ''),
      ref: el => { this._arrowREl = el },
      on: { click: () => this._goToPage(this._page + 1) },
    }, [ '▸', h('span', { className: 'lab' }, 'NEXT') ])

    const mid = h('div', { className: 'bsh-mid' }, [
      pips,
      h('div', { className: 'bsh-pager' }, [
        arrowL,
        h('div', { className: 'bsh-rowclip' }, [ track ]),
        arrowR,
      ]),
    ].filter(Boolean))

    return h('div', {
      className: 'htr-chrome m-col',
      on: { wheel: (e) => this._onWheel(e) },
    }, [ segbar, h('div', { className: 'htr-content' }, [ mid ]) ])
  }

  // Slide the carousel to page `p` (clamped). Only the track transform changes
  // — CSS transitions it — so every card slides the full page width before it
  // lands. Pager chrome (pips + arrows) is synced in place; rebuilding would
  // destroy the track mid-transition and kill the slide.
  _goToPage(p) {
    const items = this._defsFor(this._catInfo())
    const pages = Math.max(1, Math.ceil(items.length / PER_PAGE))
    const next = Math.min(pages - 1, Math.max(0, p))
    if (next === this._page || !this._trackEl) return
    this._page = next
    this._trackEl.style.transform = `translateX(-${(next * 100) / pages}%)`
    if (this._pipsEl) {
      this._pipsEl.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('on', i === next))
    }
    this._arrowLEl?.classList.toggle('off', next <= 0)
    this._arrowREl?.classList.toggle('off', next >= pages - 1)
    this._hideTip()
  }

  // Slot meter for the MINIONS / TRAPS tabs — "used / cap" with the category
  // glyph, tinted in the category accent (turns warn when full, red when there
  // are no slots at all). Cap + used match NightPhase's enforcement exactly
  // (slotCaps.rosterCap/trapCap; roster-class non-dead minions / placed traps)
  // so it can never disagree with what placement actually allows.
  _renderSlotMeter(kind) {
    let cap, used, icon, label, source, color
    if (kind === 'trap') {
      cap    = trapCap(this._gameState)
      used   = (this._gameState.dungeon?.traps ?? []).length
      icon   = '⚙'; label = 'TRAPS'; source = 'a Trap Factory'; color = 'var(--blood)'
    } else {
      cap    = rosterCap(this._gameState)
      used   = (this._gameState.minions ?? [])
        .filter(m => (m.class ?? 'roster') === 'roster' && m.aiState !== 'dead').length
      icon   = '☠'; label = 'MINIONS'; source = 'a Barracks'; color = 'var(--poison)'
    }
    const full = cap > 0 && used >= cap
    const none = cap === 0
    return h('div', {
      className: 'bsh-slots' + (full ? ' full' : '') + (none ? ' none' : ''),
      style: { '--sic': color },
      title: none
        ? `Build ${source} to gain ${label.toLowerCase()} slots`
        : `${used} of ${cap} ${label.toLowerCase()} slots used`,
    }, [
      h('span', { className: 'bsh-slots-ic' }, icon),
      none
        ? h('span', { className: 'bsh-slots-n' }, 'NO SLOTS')
        : h('span', { className: 'bsh-slots-n' }, `${used} / ${cap}`),
      h('span', { className: 'bsh-slots-lb' }, label),
    ])
  }

  // Mouse-wheel over the menu pages through the slots (anchored pager). The
  // detached floating grid scrolls natively (overflow-y:auto), so leave it alone.
  _onWheel(e) {
    if (this._tray?.isDetached) return
    const items = this._defsFor(this._catInfo())
    const pages = Math.max(1, Math.ceil(items.length / PER_PAGE))
    if (pages <= 1) return
    e.preventDefault()
    // Throttle so one wheel notch = one page and a trackpad burst doesn't fly
    // through every page at once. Use only the delta SIGN (robust to deltaMode).
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    if (now - (this._lastWheelAt || 0) < 130) return
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (!d) return
    this._lastWheelAt = now
    this._goToPage(this._page + (d > 0 ? 1 : -1))
  }

  _renderSlot(def, cat, absIdx, i, bossLv, gold) {
    const lv = def.unlockLevel ?? 1
    const rar = buildRarity(lv)
    const locked = lv > bossLv
    const cost = this._costFor(def, cat)
    const poor = !locked && cost > 0 && cost > gold
    const armed = this._armedId === def.id
    const name = def.name || def.id
    return h('div', {
      className: 'bsh-card' + (locked ? ' locked' : '') + (poor ? ' poor' : '') + (armed ? ' armed' : ''),
      style: { '--rar': rar.c, '--i': i },
      on: {
        click: () => { if (!locked) this._onSlotClick(def, cat) },
        mouseenter: (e) => this._showTip(e, def, cat, rar, locked, cost),
        mouseleave: () => this._hideTip(),
      },
    }, [
      armed ? h('span', { className: 'bsh-armtag' }, '▸ PLACING') : null,
      h('span', { className: 'bsh-lv' }, [ h('span', { className: 'g' }), `LV ${lv}` ]),
      h('div', { className: 'bsh-vis' }, locked ? [ h('span', { className: 'lock' }, '🔒') ] : [ this._cardArt(def, cat) ]),
      h('span', { className: 'bsh-cn', title: name }, name),
      locked
        ? h('span', { className: 'bsh-need' }, `NEEDS LV ${lv}`)
        : (cost <= 0
            ? h('span', { className: 'bsh-cc', style: { color: 'var(--poison)' } }, 'FREE')
            : h('span', { className: 'bsh-cc', style: { color: poor ? 'var(--warn)' : 'var(--goldB)' } }, [ h('span', { className: 'bsh-coin' }), String(cost) ])),
    ].filter(Boolean))
  }

  // ── Arm / placement ghost ───────────────────────────────────────
  _onSlotClick(def, cat) {
    if (this._armedId === def.id) {
      this._disarm()
      EventBus.emit('BUILD_DESELECT')
    } else {
      this._armedId = def.id
      EventBus.emit('BUILD_SELECT', { def, kind: cat.kind })
      this._spawnGhost(def, cat)
    }
    this._rerender()
  }

  _disarm() { this._armedId = null; this._teardownGhost() }

  _spawnGhost(def, cat) {
    this._teardownGhost()
    const layer = this._tray?.layerEl
    if (!layer) return
    const rar = buildRarity(def.unlockLevel ?? 1)
    this._ghost = h('div', { className: 'bsh-ghost', style: { '--rar': rar.c } }, [
      h('span', { className: 'gi' }, cat.glyph),
      h('div', { className: 'gt' }, [
        h('span', { className: 'gn' }, def.name || def.id),
        h('span', { className: 'gp' }, 'CLICK TO PLACE'),
      ]),
    ])
    layer.appendChild(this._ghost)
    window.addEventListener('mousemove', this._onMouseMove)
  }

  _moveGhost(e) {
    const layer = this._tray?.layerEl
    const ghost = this._ghost
    if (!layer || !ghost) return
    const lr = layer.getBoundingClientRect()
    const s = (layer.offsetWidth && lr.width) ? (lr.width / layer.offsetWidth) : 1
    // Hide while hovering over the tray itself (you're picking, not placing).
    const tr = this._tray?.trayEl?.getBoundingClientRect()
    if (tr && e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top && e.clientY <= tr.bottom) {
      ghost.style.opacity = '0'
      return
    }
    const x = (e.clientX - lr.left) / s
    const y = (e.clientY - lr.top) / s
    ghost.style.opacity = '1'
    ghost.style.transform = `translate(${x + 16}px, ${y + 16}px)`
  }

  _teardownGhost() {
    window.removeEventListener('mousemove', this._onMouseMove)
    this._ghost?.remove()
    this._ghost = null
  }

  // ── Hover panel ─────────────────────────────────────────────────
  // Hovering a build slot shows the SAME unified inspector (InspectPopup) the
  // player gets hovering that thing in the world — fed a synthetic def-based
  // entity so a not-yet-placed minion/trap/room/item reads identically. The
  // panel floats ABOVE the bottom-anchored tray (placeAbove).
  _showTip(e, def, cat, _rar, locked) {
    // Locked slots reveal nothing — the player hasn't unlocked that thing yet,
    // so they only see the "NEEDS LV X" badge on the card, not its stats/abilities.
    if (locked) { this._hideTip(); return }
    const payload = this._inspectPayload(def, cat, e.currentTarget)
    if (payload) EventBus.emit('SHOW_INSPECT', payload)
  }

  _hideTip() { EventBus.emit('HIDE_INSPECT') }

  _inspectPayload(def, cat, cardEl) {
    const cr = cardEl?.getBoundingClientRect?.()
    if (!cr) return null
    // Centre above the card (client px — the popup is body-mounted, position:fixed).
    const base = { defId: def.id, x: cr.left + cr.width / 2, y: cr.top, placeAbove: true }
    if (cat.kind === 'minion') {
      const bs = def.baseStats ?? {}
      return { ...base, kind: 'minion', entity: {
        _buildPreview: true, id: def.id, definitionId: def.id, name: def.name,
        resources: { hp: bs.hp, maxHp: bs.hp },
        stats: { attack: bs.attack, defense: bs.defense },
      } }
    }
    if (cat.kind === 'trap') return { ...base, kind: 'trap', entity: { id: def.id, definitionId: def.id } }
    if (cat.kind === 'room') return { ...base, kind: 'room', entity: { id: def.id, definitionId: def.id, width: def.width, height: def.height, isActive: true } }
    // Build "items" are placeable construction features → the in-world `placed` kind.
    if (cat.kind === 'item') return { ...base, kind: 'placed', entity: { id: def.id, definitionId: def.id } }
    return null
  }

  // ════════════════════════════════════════════════════════════════
  // Build-data layer — moved verbatim from the old LeftPanels dock so
  // pricing / unlock-gating / caps / BUILD_SELECT behave identically.
  // ════════════════════════════════════════════════════════════════
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
          if (this._atMax(it, cat)) return false
          return true
        })
        .sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
    }
    return all
  }

  _maxFor(def, cat) {
    if (cat.kind === 'room') {
      const byLevel = def.placementRules?.maxPerDungeonByBossLevel
      if (byLevel != null) {
        const lvl = this._gameState.boss?.level ?? this._gameState.meta?.dungeonLevel ?? 1
        const keys = Object.keys(byLevel).map(k => parseInt(k, 10)).filter(n => Number.isFinite(n)).sort((a, b) => a - b)
        if (keys.length === 0) return def.placementRules?.maxPerDungeon ?? null
        let cap = byLevel[keys[0]]
        for (const l of keys) if (l <= lvl) cap = byLevel[l]
        return cap
      }
      return def.placementRules?.maxPerDungeon ?? null
    }
    return def.maxPerDungeon ?? null
  }

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
        return (d.treasureChests ?? []).filter(c =>
          c.tier === def.tier && !c._treasurySpawn && !c._mimicCursed && !c._cursed
        ).length
      }
    }
    return 0
  }

  _atMax(def, cat) {
    const cap = this._maxFor(def, cat)
    if (cap == null) return false
    return this._placedCount(def, cat) >= cap
  }

  _costFor(def, cat) {
    const scaleMul = buildScaleMul(this._gameState)
    let raw
    if (cat.kind === 'room') {
      raw = Math.round(DungeonGrid.effectiveRoomCost(def, this._gameState.dungeon?.rooms ?? []) * scaleMul)
    } else {
      const base = def.goldCost ?? def.cost ?? 0
      if (cat.kind === 'minion') {
        const flagMul = (this._gameState._mechanicFlags ?? {}).minionGoldCostMult ?? 1
        raw = Math.max(0, Math.round(base * flagMul * scaleMul))
      } else {
        raw = Math.max(0, Math.round(base * scaleMul))
      }
    }
    return applyMerchantPrice(this._gameState, def.id, raw)
  }

  _cardArt(def, cat) {
    const fallback = h('span', { className: 'qf-build-card-glyph', style: { color: cat.color } }, cat.glyph)
    if (cat.kind === 'minion') {
      const snap = liveMinion(def.id, 76)
      if (snap) { snap.classList.add('qf-build-card-snap'); return snap }
      return pixelSprite(spriteKindForDefId(def.id), 64)
    }
    if (cat.kind === 'room') {
      const MAX_W = 120, MAX_H = 64
      const img = document.createElement('img')
      img.style.display = 'block'; img.style.imageRendering = 'pixelated'
      img.style.maxWidth = `${MAX_W}px`; img.style.maxHeight = `${MAX_H}px`
      img.style.width = 'auto'; img.style.height = 'auto'; img.style.objectFit = 'contain'
      img.className = 'qf-snap qf-snap-room'
      img.onerror = () => {
        const cached = getRoomThumbnail(def.id)
        if (!cached || !img.parentElement) { img.style.display = 'none'; return }
        const c = document.createElement('canvas')
        const aspect = cached.width / cached.height
        let dispH = MAX_H, dispW = MAX_H * aspect
        if (dispW > MAX_W) { dispW = MAX_W; dispH = MAX_W / aspect }
        dispW = Math.max(1, Math.round(dispW)); dispH = Math.max(1, Math.round(dispH))
        c.width = dispW; c.height = dispH
        const cctx = c.getContext('2d'); cctx.imageSmoothingEnabled = false
        cctx.drawImage(cached, 0, 0, cached.width, cached.height, 0, 0, dispW, dispH)
        c.style.display = 'block'; c.style.imageRendering = 'pixelated'; c.className = 'qf-snap qf-snap-room'
        img.parentElement.replaceChild(c, img)
      }
      img.src = `assets/ui/room-thumbnails/${def.id}.png`
      return img
    }
    if (cat.kind === 'trap') {
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
}

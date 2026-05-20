// InspectPopup — hover inspector for dungeon entities.
//
// Replaces the old two-tab RoomTooltip and the full-screen
// MinionInspectorOverlay with one lean hover surface that covers rooms,
// minions, adventurers, and dropped loot items.
//
// A small cursor-following panel appears for whatever entity is under
// the pointer. pointer-events:none, purely informational. Its visual
// language deliberately matches the construction-panel footer: a
// category-coloured name, a row of stat boxes, an italic flavor line,
// and (for minions) tagged ABILITY / BEHAVIOR lines.
//
// Hit-detection lives in HudRoot (a canvas pointermove hit-test against
// gameState). This module only listens for the resulting SHOW_INSPECT /
// HIDE_INSPECT events and renders.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { minionAbilityInfo } from '../systems/MinionAbilities.js'

const STAT_LABEL = { attack: 'ATK', defense: 'DEF', maxHp: 'MAX HP', speed: 'SPD' }

// Per-entity accent colour — mirrors the construction panel's category
// colours (ROOMS red / MINIONS green / TRAPS orange / ITEMS blue) so the
// hover panel reads as the same family of surface.
const CAT_COLOR = {
  room:       'var(--blood)',
  minion:     'var(--poison)',
  adventurer: 'var(--warn)',
  item:       'var(--gold-bright)',
  placed:     'var(--info)',
  trap:       'var(--warn)',
}

export class InspectPopup {
  constructor(gameState) {
    this._gs   = gameState
    this._el   = null
    this._key  = null

    this._onShow = (p) => this._show(p)
    this._onHide = () => this._hide()
    EventBus.on('SHOW_INSPECT', this._onShow)
    EventBus.on('HIDE_INSPECT', this._onHide)
  }

  // ── Hover panel ───────────────────────────────────────────────────
  _show({ kind, entity, defId = null, x = 0, y = 0 } = {}) {
    if (!kind || !entity) return
    const key = this._idOf(kind, entity)
    // Same entity still hovered — just reposition, keep the DOM.
    if (key === this._key && this._el) {
      this._position(x, y)
      return
    }
    this._hide()
    this._key = key
    this._el = h('div', {
      className: 'qf-inspect',
      style: { '--cat-color': CAT_COLOR[kind] || 'var(--line-bright)' },
    }, [
      h('div', { className: 'pix qf-inspect-name' }, this._title(kind, entity, defId)),
      ...this._content(kind, entity, defId),
    ])
    document.body.appendChild(this._el)
    this._position(x, y)
  }

  _position(x, y) {
    const el = this._el
    if (!el) return
    const w  = el.offsetWidth  || 230
    const ht = el.offsetHeight || 130
    // Default down-right of the cursor; flip / clamp to stay on-screen.
    let left = x + 16
    let top  = y + 16
    if (left + w  > window.innerWidth  - 8) left = x - w - 16
    if (top  + ht > window.innerHeight - 8) top  = window.innerHeight - ht - 8
    el.style.left = `${Math.max(8, left)}px`
    el.style.top  = `${Math.max(8, top)}px`
  }

  _hide() {
    this._el?.remove()
    this._el  = null
    this._key = null
  }

  // ── Content (footer-style: stat boxes + flavor + ability lines) ────
  _content(kind, entity, defId) {
    let parts = []
    if      (kind === 'room')       parts = this._roomContent(entity)
    else if (kind === 'minion')     parts = this._minionContent(entity)
    else if (kind === 'adventurer') parts = this._advContent(entity)
    else if (kind === 'item')       parts = this._itemContent(entity)
    else if (kind === 'placed')     parts = this._placedContent(defId)
    else if (kind === 'trap')       parts = this._trapContent(entity, defId)
    return parts.filter(Boolean)
  }

  _statsGrid(boxes) {
    if (!boxes.length) return null
    return h('div', {
      className: 'qf-inspect-stats',
      style: { gridTemplateColumns: `repeat(${boxes.length}, 1fr)` },
    }, boxes.map(([label, value]) => h('div', { className: 'qf-inspect-stat' }, [
      h('div', { className: 'pix qf-inspect-stat-label' }, label),
      h('div', { className: 'pix qf-inspect-stat-value' }, String(value)),
    ])))
  }

  _descLine(text) {
    return h('div', { className: 'qf-inspect-desc' }, text)
  }

  // Tagged ABILITY / BEHAVIOR lines — same shape as the construction
  // footer's ability block.
  _abilityLines(definitionId) {
    const info = minionAbilityInfo(definitionId)
    if (!info) return null
    const line = (tag, text) => h('div', { className: 'qf-inspect-ability' }, [
      h('span', { className: 'pix qf-inspect-ability-tag' }, tag),
      h('span', { className: 'qf-inspect-ability-text' }, text),
    ])
    return h('div', { className: 'qf-inspect-abilities' }, [
      info.ability  && line('ABILITY',  info.ability),
      info.behavior && line('BEHAVIOR', info.behavior),
    ])
  }

  _roomContent(room) {
    const def = this._roomDef(room)
    const boxes = []
    if (room.width && room.height) boxes.push(['SIZE', `${room.width}×${room.height}`])
    boxes.push(['STATUS', room.isActive === false ? 'OFF' : 'ACTIVE'])
    return [
      this._statsGrid(boxes),
      def?.description ? this._descLine(def.description) : null,
    ]
  }

  _minionContent(m) {
    const hp    = m.resources?.hp ?? m.stats?.hp ?? '?'
    const maxHp = m.resources?.maxHp ?? hp
    const boxes = [
      ['HP',  `${hp}/${maxHp}`],
      ['ATK', m.stats?.attack ?? '?'],
      ['LV',  m.level ?? 1],
    ]
    const def = this._minionDef(m)
    return [
      this._statsGrid(boxes),
      def?.description ? this._descLine(def.description) : null,
      this._abilityLines(m.definitionId),
    ]
  }

  _advContent(a) {
    const def   = this._advDef(a)
    const cls   = def?.name || a.classId || 'Adventurer'
    const hp    = a.resources?.hp ?? a.stats?.hp ?? '?'
    const maxHp = a.resources?.maxHp ?? hp
    const boxes = [
      ['LV',  a.level ?? 1],
      ['HP',  `${hp}/${maxHp}`],
      ['ATK', a.stats?.attack ?? '?'],
    ]
    const flavor = def?.flavorText || def?.description || ''
    const desc = flavor
      ? `${String(cls).toUpperCase()} — ${flavor}`
      : String(cls).toUpperCase()
    return [this._statsGrid(boxes), this._descLine(desc)]
  }

  _itemContent(p) {
    const stat  = p.buff?.stat ?? 'speed'
    const label = STAT_LABEL[stat] ?? String(stat).toUpperCase()
    const amt   = p.buff?.amount
    return [
      this._statsGrid([['GRANTS', amt != null ? `+${amt} ${label}` : `+${label}`]]),
      this._descLine('Dropped loot. An adventurer who picks it up gains a permanent stat boost.'),
    ]
  }

  // Placed construction item (treasure chest / beacon / fountain / key
  // chest / phylactery / door lock) — resolved from items.json by defId.
  _placedContent(defId) {
    const def = this._itemsDef(defId)
    if (!def) return []
    const boxes = []
    if (def.treasure?.goldPerDay != null) boxes.push(['GOLD / DAY', `${def.treasure.goldPerDay}g`])
    if (def.baseStats?.hp != null)        boxes.push(['HP', def.baseStats.hp])
    const parts = []
    if (boxes.length)    parts.push(this._statsGrid(boxes))
    if (def.description) parts.push(this._descLine(def.description))
    return parts
  }

  // Placed trap — resolved from trapTypes.json (currently empty, so this
  // gracefully shows nothing until trap content ships).
  _trapContent(t, defId) {
    const def = this._trapDef(defId)
    const boxes = []
    const dmg = t.stats?.damage ?? def?.damage ?? def?.baseStats?.damage
    if (dmg != null) boxes.push(['DMG', dmg])
    const parts = []
    if (boxes.length)     parts.push(this._statsGrid(boxes))
    if (def?.description) parts.push(this._descLine(def.description))
    return parts
  }

  // ── Title ─────────────────────────────────────────────────────────
  _title(kind, entity, defId) {
    if (kind === 'room')       return (this._roomName(entity) || entity.definitionId || 'Room').toUpperCase()
    if (kind === 'minion')     return (entity.name || this._minionName(entity) || 'Minion').toUpperCase()
    if (kind === 'adventurer') return (entity.name || 'Adventurer').toUpperCase()
    if (kind === 'item')       return 'DROPPED LOOT'
    if (kind === 'placed')     return (this._itemsDef(defId)?.name || 'Item').toUpperCase()
    if (kind === 'trap')       return (this._trapDef(defId)?.name || 'Trap').toUpperCase()
    return ''
  }

  _idOf(kind, entity) {
    const id = entity.instanceId ?? entity.id ??
      (entity.tileX != null ? `${entity.tileX},${entity.tileY}` : '?')
    return `${kind}:${id}`
  }

  // ── JSON-cache lookups ────────────────────────────────────────────
  _cachedJson(key) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.(key)
      if (Array.isArray(v)) return v
    }
    return null
  }

  _roomDef(room)   { return (this._cachedJson('rooms') ?? []).find(d => d.id === room.definitionId) || null }
  _roomName(room)  { return this._roomDef(room)?.name || null }
  _minionDef(m)    { return (this._cachedJson('minionTypes') ?? []).find(x => x.id === m.definitionId) || null }
  _minionName(m)   { return this._minionDef(m)?.name || null }
  _advDef(a)       { return (this._cachedJson('adventurerClasses') ?? []).find(x => x.id === a.classId) || null }
  _itemsDef(defId) { return defId ? ((this._cachedJson('items') ?? []).find(d => d.id === defId) || null) : null }
  _trapDef(defId)  { return defId ? ((this._cachedJson('trapTypes') ?? []).find(d => d.id === defId) || null) : null }

  destroy() {
    EventBus.off('SHOW_INSPECT', this._onShow)
    EventBus.off('HIDE_INSPECT', this._onHide)
    this._hide()
  }
}

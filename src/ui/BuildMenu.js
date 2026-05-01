// Phase 31C — Build menu (left HUD column, below mini-map).
//
// Replaces NightPhase's old left palette. Tabs: ROOMS / MINIONS / TRAPS / ITEMS.
// Slot click emits BUILD_SELECT { def, kind } that NightPhase listens for and
// folds into its existing _selectItem flow. Traps + Items tabs render "COMING
// SOON" until those data files ship.
//
// Visible only during night phase — HudScene calls setVisible(false) on day.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelTabs } from './UIKit.js'
import { EventBus } from '../systems/EventBus.js'

const DEFAULT_PANEL_W = 230
const HEADER_H      = 22
const TABS_H        = 22
const FOOTER_H      = 36
const PADDING       = 6
const SLOT_GAP      = 5
const SLOT_COLS     = 2

const TABS = [
  { key: 'rooms',   label: 'ROOMS',   kind: 'room'   },
  { key: 'minions', label: 'MINIONS', kind: 'minion' },
  { key: 'traps',   label: 'TRAPS',   kind: 'trap'   },
  { key: 'items',   label: 'ITEMS',   kind: 'item'   },
]

export class BuildMenu {
  constructor(scene, gameState, opts = {}) {
    this._scene     = scene
    this._gameState = gameState
    this._depth     = opts.depth ?? 60
    this._x         = opts.x ?? 12
    this._y         = opts.y ?? 280
    this._w         = opts.w ?? DEFAULT_PANEL_W
    this._h         = opts.h ?? ((scene.uiH ?? 720) - this._y - 56 - 12)

    this._objects     = []
    this._slotObjects = []     // current rendered slot Phaser objects
    this._slots       = []     // metadata for hit-testing: { def, kind, x, y, w, h }
    this._selectedKey = null   // `${kind}:${id}` for selected highlight
    this._activeTab   = 'rooms'
    this._scrollY     = 0      // vertical scroll offset within the slot grid
    this._contentH    = 0      // total slot grid content height (for clamping)

    this._defsByKind = {
      room:   () => this._roomDefs(),
      minion: () => this._minionDefs(),
      trap:   () => this._trapDefs(),
      item:   () => [],     // items not implemented yet
    }

    this._listeners = []
    this._build()
    this._wireEvents()
  }

  _build() {
    const D = this._depth
    const x = this._x, y = this._y, w = this._w, h = this._h

    const bg = this._scene.add.graphics().setDepth(D)
    pixelPanel(bg, x, y, w, h)
    this._objects.push(bg)

    // Header
    const headerG = this._scene.add.graphics().setDepth(D + 1)
    headerG.fillStyle(CRYPT.panel2, 1)
    headerG.fillRect(x + 2, y + 2, w - 4, HEADER_H)
    headerG.fillStyle(CRYPT.panelEdgeS, 1)
    headerG.fillRect(x + 2, y + 2 + HEADER_H, w - 4, 1)
    this._objects.push(headerG)

    const dia = this._scene.add.text(x + PADDING + 4, y + HEADER_H / 2 + 2, '◆', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.accent2Css,
    }).setOrigin(0, 0.5).setDepth(D + 2)
    this._objects.push(dia)
    const hdr = this._scene.add.text(x + PADDING + 18, y + HEADER_H / 2 + 2,
      'CONSTRUCTION', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(D + 2)
    this._objects.push(hdr)

    const sub = this._scene.add.text(x + w - PADDING - 4, y + HEADER_H / 2 + 2,
      'BUILD', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 1,
    }).setOrigin(1, 0.5).setDepth(D + 2)
    this._objects.push(sub)

    // Tabs
    const tabsY = y + 2 + HEADER_H + 1
    this._tabs = pixelTabs(this._scene, x + 2, tabsY, w - 4, TABS_H,
      TABS.map(t => t.label), {
        depth: D + 2,
        fontSize: 8,
        activeIdx: TABS.findIndex(t => t.key === this._activeTab),
        onChange: (idx) => this._switchTab(TABS[idx].key),
      })

    // Footer (selected readout)
    const footerY = y + h - FOOTER_H
    const footerG = this._scene.add.graphics().setDepth(D + 1)
    footerG.fillStyle(CRYPT.panel2, 1)
    footerG.fillRect(x + 2, footerY, w - 4, FOOTER_H - 2)
    footerG.fillStyle(CRYPT.panelEdgeS, 1)
    footerG.fillRect(x + 2, footerY, w - 4, 1)
    this._objects.push(footerG)

    this._scene.add.text(x + PADDING + 4, footerY + 8, 'SELECTED', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D + 2)

    this._selectedT = this._scene.add.text(x + PADDING + 4, footerY + 20,
      '— none —', {
      fontFamily: FONT_BODY, fontSize: '10px', color: CRYPT.accent2Css, letterSpacing: 1,
    }).setDepth(D + 2)
    this._objects.push(this._selectedT)

    // Slot grid area
    this._slotsTopY  = tabsY + TABS_H + PADDING
    this._slotsBotY  = footerY - PADDING
    this._renderActive()

    // Mouse wheel scroll inside the slot grid area.
    this._scene.input.on('wheel', this._onWheel, this)
  }

  _onWheel(pointer, _objs, _dx, dy) {
    // Only respond when the pointer is within our slot grid rect.
    const px = pointer.x, py = pointer.y
    if (px < this._x || px > this._x + this._w) return
    if (py < this._slotsTopY || py > this._slotsBotY) return
    const visibleH = this._slotsBotY - this._slotsTopY
    const maxScroll = Math.max(0, this._contentH - visibleH)
    this._scrollY = Math.max(0, Math.min(maxScroll, this._scrollY + dy * 0.5))
    this._renderActive()
  }

  _wireEvents() {
    const on = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    on('ROOM_PLACED',     () => this._renderActive())
    on('ROOM_REMOVED',    () => this._renderActive())
    on('TRAP_PLACED',     () => this._renderActive())
    on('TRAP_REMOVED',    () => this._renderActive())
    on('MINION_PLACED',   () => this._renderActive())
    on('MINION_DIED',     () => this._renderActive())
    on('BUILD_DESELECT',  () => this._setSelected(null))
  }

  _switchTab(key) {
    if (key === this._activeTab) return
    this._activeTab = key
    this._renderActive()
  }

  _renderActive() {
    // Wipe current slot objects
    this._slotObjects.forEach(o => o?.destroy?.())
    this._slotObjects = []
    this._slots = []

    const tabDef = TABS.find(t => t.key === this._activeTab)
    const kind = tabDef.kind
    const allDefs = this._defsByKind[kind]() ?? []

    // Filter out items at placement cap (placed >= max). Locked items
    // stay visible — their L{N} badge is part of the design.
    const dungeonLevel = this._gameState.meta?.dungeonLevel ?? 1
    const defs = allDefs.filter(def => {
      const cap = this._capFor(def, kind, dungeonLevel)
      if (cap == null) return true
      const used = this._usedFor(def, kind)
      const isLocked = (def.unlockLevel ?? 1) > dungeonLevel
      return isLocked || used < cap
    })

    const x = this._x + PADDING
    const y = this._slotsTopY
    const w = this._w - PADDING * 2
    const slotW = Math.floor((w - SLOT_GAP) / SLOT_COLS)
    const slotH = 60

    if (defs.length === 0) {
      const t = this._scene.add.text(this._x + this._w / 2, y + 40,
        'COMING SOON', {
        fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(this._depth + 2)
      this._slotObjects.push(t)
      const t2 = this._scene.add.text(this._x + this._w / 2, y + 60,
        '— nothing to place —', {
        fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setOrigin(0.5).setDepth(this._depth + 2)
      this._slotObjects.push(t2)
      this._contentH = 0
      return
    }

    // Total content height — used for scroll clamping.
    const rowCount = Math.ceil(defs.length / SLOT_COLS)
    this._contentH = rowCount * (slotH + SLOT_GAP)

    defs.forEach((def, i) => {
      const col = i % SLOT_COLS
      const row = Math.floor(i / SLOT_COLS)
      const sx = x + col * (slotW + SLOT_GAP)
      const sy = y + row * (slotH + SLOT_GAP) - this._scrollY
      // Skip slots that fall outside the visible viewport (scroll clip).
      if (sy + slotH < this._slotsTopY) return
      if (sy > this._slotsBotY) return
      this._renderSlot(def, kind, sx, sy, slotW, slotH)
    })

    // Scrollbar hint: a small dim bar on the right edge if there's overflow.
    const visibleH = this._slotsBotY - this._slotsTopY
    if (this._contentH > visibleH) {
      const sbX = this._x + this._w - PADDING + 1
      const sbH = Math.max(20, visibleH * (visibleH / this._contentH))
      const sbY = this._slotsTopY + (this._scrollY / this._contentH) * visibleH
      const sbG = this._scene.add.graphics().setDepth(this._depth + 4)
      sbG.fillStyle(CRYPT.panelEdgeS, 1)
      sbG.fillRect(sbX, this._slotsTopY, 2, visibleH)
      sbG.fillStyle(CRYPT.accent2, 1)
      sbG.fillRect(sbX, sbY, 2, sbH)
      this._slotObjects.push(sbG)
    }
  }

  // Placement cap helpers — mirror NightPhase logic without importing it.
  _capFor(def, kind, dungeonLevel) {
    if (kind === 'room') {
      const byLevel = def.placementRules?.maxPerDungeonByBossLevel
      if (byLevel) {
        const keys = Object.keys(byLevel).map(k => parseInt(k, 10)).sort((a, b) => a - b)
        let cap = byLevel[keys[0]]
        for (const k of keys) if (dungeonLevel >= k) cap = byLevel[k]
        return cap === 0 ? null : cap     // 0 = unlimited
      }
      const m = def.placementRules?.maxPerDungeon
      return (m === 0 || m == null) ? null : m
    }
    // Minions and traps don't expose cap info on the def directly; fall
    // back to "unlimited" for now (NightPhase enforces global roster + trap
    // caps separately, which the slot-disable logic doesn't surface).
    return null
  }

  _usedFor(def, kind) {
    if (kind === 'room') {
      return (this._gameState.dungeon?.rooms ?? []).filter(r => r.definitionId === def.id).length
    }
    if (kind === 'minion') {
      return (this._gameState.minions ?? []).filter(m => m.definitionId === def.id).length
    }
    if (kind === 'trap') {
      return (this._gameState.dungeon?.traps ?? []).filter(t => t.definitionId === def.id).length
    }
    return 0
  }

  _renderSlot(def, kind, sx, sy, sw, sh) {
    const D = this._depth + 2
    const key = `${kind}:${def.id}`
    const isSelected = (this._selectedKey === key)
    const cost   = def.cost ?? def.essenceCostToPlace ?? 0
    const locked = (def.unlockLevel ?? 1) > (this._gameState.meta?.dungeonLevel ?? 1)
    const affordable = cost <= (this._gameState.player?.soulEssence ?? 0)
    const accent  = isSelected ? CRYPT.accent2 : CRYPT.panelEdgeH
    const accentS = isSelected ? CRYPT.accent  : CRYPT.panelEdgeS
    const fill    = isSelected ? CRYPT.bgStone3 : CRYPT.bgStone1

    const slot = this._scene.add.graphics().setDepth(D)
    pixelPanel(slot, sx, sy, sw, sh, {
      fill, edgeH: accent, edgeS: accentS,
    })
    if (isSelected) {
      // Outer accent ring
      slot.fillStyle(CRYPT.accent, 1)
      slot.fillRect(sx - 2, sy - 2, sw + 4, 2)
      slot.fillRect(sx - 2, sy + sh, sw + 4, 2)
      slot.fillRect(sx - 2, sy - 2, 2, sh + 4)
      slot.fillRect(sx + sw, sy - 2, 2, sh + 4)
    }
    this._slotObjects.push(slot)

    // Glyph (top half)
    const glyph = def._glyph ?? this._glyphFor(def, kind)
    const g = this._scene.add.text(sx + sw / 2, sy + 18, glyph, {
      fontFamily: FONT_HEAD, fontSize: '14px',
      color: locked ? CRYPT.inkMuteHex : (isSelected ? CRYPT.accent2Css : CRYPT.ink),
    }).setOrigin(0.5).setDepth(D + 1)
    this._slotObjects.push(g)

    // Name
    const name = (def.name ?? def.id ?? '?').toUpperCase()
    const nameT = this._scene.add.text(sx + sw / 2, sy + 36, this._truncate(name, 11), {
      fontFamily: FONT_HEAD, fontSize: '7px',
      color: locked ? CRYPT.inkMute : CRYPT.ink, letterSpacing: 1,
    }).setOrigin(0.5).setDepth(D + 1)
    this._slotObjects.push(nameT)

    // Cost (or "L{N}" if locked)
    let costStr, costColor
    if (locked) {
      costStr   = `L${def.unlockLevel}`
      costColor = CRYPT.inkMute
    } else {
      costStr   = `${cost}`
      costColor = affordable ? CRYPT.goldCss : CRYPT.accent2Css
    }
    const costT = this._scene.add.text(sx + sw / 2, sy + 50, costStr, {
      fontFamily: FONT_BODY, fontSize: '9px', color: costColor, letterSpacing: 1,
    }).setOrigin(0.5).setDepth(D + 1)
    this._slotObjects.push(costT)

    // Placement cap badge — top-right corner. Only shown when the def has
    // a finite cap. Hidden defs are filtered out earlier; this is the live
    // "X/Y" readout for the survivors.
    const dungeonLevel = this._gameState.meta?.dungeonLevel ?? 1
    const cap = this._capFor(def, kind, dungeonLevel)
    if (cap != null) {
      const used = this._usedFor(def, kind)
      const capT = this._scene.add.text(sx + sw - 4, sy + 4, `${used}/${cap}`, {
        fontFamily: FONT_HEAD, fontSize: '7px',
        color: used >= cap ? CRYPT.accent2Css : CRYPT.inkMute,
        letterSpacing: 1,
      }).setOrigin(1, 0).setDepth(D + 1)
      this._slotObjects.push(capT)
    }

    // Hit zone
    const hit = this._scene.add.zone(sx, sy, sw, sh)
      .setOrigin(0).setDepth(D + 5).setInteractive({ useHandCursor: !locked })
    hit.on('pointerover', () => { if (!locked) g.setColor(CRYPT.accent2Css) })
    hit.on('pointerout',  () => { if (!locked && !isSelected) g.setColor(CRYPT.ink) })
    hit.on('pointerup',   () => {
      if (locked) return
      this._setSelected(key)
      EventBus.emit('BUILD_SELECT', { def, kind })
    })
    this._slotObjects.push(hit)

    this._slots.push({ key, def, kind, sx, sy, sw, sh })
  }

  _setSelected(key) {
    if (key === this._selectedKey) {
      this._selectedKey = null
    } else {
      this._selectedKey = key
    }
    this._renderActive()
    // Update footer text
    if (this._selectedT) {
      const slot = this._slots.find(s => s.key === this._selectedKey)
      this._selectedT.setText(slot ? (slot.def.name ?? slot.def.id) : '— none —')
    }
  }

  _glyphFor(def, kind) {
    if (kind === 'room')   return def.glyph ?? def.id?.[0]?.toUpperCase() ?? '▦'
    if (kind === 'minion') return def.sigil ?? def.id?.[0]?.toUpperCase() ?? '☠'
    if (kind === 'trap')   return '▲'
    return '·'
  }

  _truncate(s, n) {
    s = String(s ?? '')
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }

  // Source defs filtered by unlocks (mirrors NightPhase logic, simpler version)
  _roomDefs() {
    const all = this._scene.cache.json.get('rooms') ?? []
    const allowed = new Set(this._gameState.unlocks?.rooms ?? [])
    return all.filter(r => allowed.has(r.id) && !r.placementRules?.fixed)
              .sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
  }

  _minionDefs() {
    const all = this._scene.cache.json.get('minionTypes') ?? []
    const allowed = new Set(this._gameState.unlocks?.minionTypes ?? [])
    return all.filter(m => allowed.has(m.id))
  }

  _trapDefs() {
    const all = this._scene.cache.json.get('trapTypes') ?? []
    const allowed = new Set(this._gameState.unlocks?.trapTypes ?? [])
    return all.filter(t => allowed.has(t.id))
  }

  setVisible(v) {
    this._objects.forEach(o => o?.setVisible?.(v))
    this._slotObjects.forEach(o => o?.setVisible?.(v))
    if (this._tabs) {
      this._tabs.bg?.setVisible?.(v)
      this._tabs.texts?.forEach(t => t.setVisible(v))
      this._tabs.zones?.forEach(z => z.setVisible(v))
      this._tabs.zones?.forEach(z => { z.input.enabled = v })
    }
  }

  update() {}

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._scene.input.off('wheel', this._onWheel, this)
    this._slotObjects.forEach(o => o?.destroy?.())
    this._slotObjects = []
    this._objects.forEach(o => o?.destroy?.())
    this._objects = []
    this._tabs?.destroy?.()
    this._tabs = null
  }
}

export const BUILD_MENU_WIDTH = DEFAULT_PANEL_W

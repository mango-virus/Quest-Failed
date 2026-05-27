// SUPERSEDED (Phase 34) — replaced by `src/hud/LeftPanels.js`
// construction grid under the new DOM HUD. Phaser fallback under
// `?newhud=0`. Kept per CLAUDE.md.
//
// Phase 31C — Build menu (left HUD column, below mini-map).
//
// Replaces NightPhase's old left palette. Tabs: ROOMS / MINIONS / TRAPS / ITEMS.
// Slot click emits BUILD_SELECT { def, kind } that NightPhase listens for and
// folds into its existing _selectItem flow. Traps + Items tabs render "COMING
// SOON" until those data files ship.
//
// Visible only during night phase — HudScene calls setVisible(false) on day.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelTabs, pixelDiamond, pixelLock, uiSfxHover, uiSfxClick } from './UIKit.js'
import { EventBus }          from '../systems/EventBus.js'
import { Balance }           from '../config/balance.js'
import { SfxVolume }         from '../systems/SfxVolume.js'
import { BuildMenuTooltip }  from './BuildMenuTooltip.js'
import { ThemeManager, readCellEntry, spriteCoverage } from '../systems/ThemeManager.js'
import { DungeonGrid } from '../systems/DungeonGrid.js'

const DEFAULT_PANEL_W = 230
const HEADER_H      = 22
const TABS_H        = 22
const FOOTER_H      = 36
const PADDING       = 6
const SLOT_GAP      = 5
const SLOT_COLS     = 2
const SLOT_H        = 96   // Option B card height — preview + name/cost row

// Room category tints (match DungeonRenderer + NightPhase for consistency).
// Used as the floor wash on the mini room preview so the card doubles
// as a category sort.
const CAT_COLOR = {
  special:  0x8a3aff,
  starter:  0x3088cc,
  trap:     0xcc4422,
  treasure: 0xddaa22,
  combat:   0xcc2244,
  utility:  0x22cc88,
  default:  0x6688aa,
}

const TABS = [
  { key: 'rooms',   label: 'ROOMS',   kind: 'room'   },
  { key: 'minions', label: 'MINIONS', kind: 'minion' },
  { key: 'traps',   label: 'TRAPS',   kind: 'trap'   },
  { key: 'items',   label: 'ITEMS',   kind: 'item'   },
]

// Apply a Room Editor colorAdjust ({ hue, sat, bright, contrast }) to a
// rendered Image via Phaser preFX ColorMatrix. Mirrors the shader chain
// in DungeonRenderer._applyColorAdj — uses preFX so it composites
// correctly with the build-menu's geometry mask.
function _applyColorAdjPreFX(img, adj) {
  if (!img || !adj) return
  const { hue = 0, sat = 0, bright = 0, contrast = 0 } = adj
  if (!hue && !sat && !bright && !contrast) return
  try {
    const cm = img.preFX?.addColorMatrix?.()
    if (!cm) return
    if (hue)      cm.hue(hue, true)
    if (sat)      cm.saturate(sat, true)
    if (bright)   cm.brightness(1 + bright, true)
    if (contrast) cm.contrast(contrast, true)
  } catch (_) {}
}

// Approximate a colorAdjust on a flat hex color — used for the procedural
// floor wash and the procedural wall ring (graphics fills can't take a
// shader). Maps hue / sat / bright onto HSV; ignores contrast (no
// reasonable single-color analogue). Close enough that a room with a
// purple-shifted floor reads as purple in the preview.
function _applyAdjToColor(intColor, adj) {
  if (!adj) return intColor
  const { hue = 0, sat = 0, bright = 0 } = adj
  if (!hue && !sat && !bright) return intColor
  const r = (intColor >> 16) & 0xff
  const g = (intColor >>  8) & 0xff
  const b =  intColor        & 0xff
  // Phaser exposes RGBToHSV → { h: 0..1, s: 0..1, v: 0..1 }.
  const hsv = Phaser.Display.Color.RGBToHSV(r, g, b)
  let h = hsv.h, s = hsv.s, v = hsv.v
  if (hue)    h = ((h + hue / 360) % 1 + 1) % 1
  if (sat)    s = Math.max(0, Math.min(1, s * (1 + sat)))
  if (bright) v = Math.max(0, Math.min(1, v * (1 + bright)))
  const rgb = Phaser.Display.Color.HSVToRGB(h, s, v)
  // Phaser 3.60 returns { r, g, b, color } on the result object.
  if (typeof rgb?.color === 'number') return rgb.color
  return Phaser.Display.Color.GetColor(rgb.r ?? 0, rgb.g ?? 0, rgb.b ?? 0)
}

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
    this._visible     = true   // honoured by setVisible + post-event re-renders

    this._defsByKind = {
      room:   () => this._roomDefs(),
      minion: () => this._minionDefs(),
      trap:   () => this._trapDefs(),
      item:   () => this._itemDefs(),
    }

    this._listeners = []
    // Hover-tooltip — shows name + cost + description + key stats over
    // the slot the player is currently hovering. Sits above the BuildMenu
    // chrome (depth 200), gets hidden on pointerout, tab switch, scroll,
    // visibility toggle, and shutdown.
    this._tooltip = new BuildMenuTooltip(scene, { depth: this._depth + 140 })
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

    const dia = this._scene.add.graphics().setDepth(D + 2)
    pixelDiamond(dia, x + PADDING + 6, y + HEADER_H / 2 + 2, 4, CRYPT.accent)
    this._objects.push(dia)
    const hdr = this._scene.add.text(x + PADDING + 16, y + HEADER_H / 2 + 2,
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
        fontSize: 6,
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

    // Geometry mask covering exactly the visible slot rect — applied to
    // every slot object so partially-scrolled slots get clipped at the
    // viewport edge instead of being hidden entirely.
    const maskShape = this._scene.make.graphics({ x: 0, y: 0, add: false })
    maskShape.fillStyle(0xffffff, 1)
    maskShape.fillRect(x + PADDING, this._slotsTopY,
      this._w - PADDING * 2, this._slotsBotY - this._slotsTopY)
    this._slotMask = maskShape.createGeometryMask()

    this._renderActive()

    // Mouse wheel scroll inside the slot grid area.
    this._scene.input.on('wheel', this._onWheel, this)
  }

  _onWheel(pointer, _objs, _dx, dy) {
    if (!this._pointerInScrollArea(pointer)) return
    const visibleH = this._slotsBotY - this._slotsTopY
    const maxScroll = Math.max(0, this._contentH - visibleH)
    this._scrollY = Math.max(0, Math.min(maxScroll, this._scrollY + dy * 0.5))
    this._renderActive()
  }

  // True if `pointer` is currently over the BuildMenu's scrollable area.
  // Used by Game.js to suppress the world camera's wheel-zoom while the
  // player is scrolling through build slots — without this, the wheel
  // event hits both handlers and the dungeon view zooms while the menu
  // scrolls. pointer.x/y are canvas pixels; HudScene's camera transform
  // maps them to design-space coords.
  _pointerInScrollArea(pointer) {
    if (!pointer || !this._visible) return false
    const cam = this._scene.cameras?.main
    if (!cam) return false
    const wp  = cam.getWorldPoint(pointer.x, pointer.y)
    const px = wp.x, py = wp.y
    if (px < this._x || px > this._x + this._w) return false
    if (py < this._slotsTopY || py > this._slotsBotY) return false
    return true
  }
  containsPointer(pointer) { return this._pointerInScrollArea(pointer) }

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
    // Phase 1b.4 — Lich Phylactery: re-render so the items tab refreshes
    // when the heart is placed or destroyed (phylactery removed from gameState).
    // BOSS_LEVELED_UP is still subscribed for parity with other level-gated
    // items even though the heart is now available from level 1.
    on('BOSS_LEVELED_UP',     () => this._renderActive())
    on('PHYLACTERY_PLACED',   () => this._renderActive())
    on('PHYLACTERY_DESTROYED', () => this._renderActive())
  }

  _switchTab(key) {
    if (key === this._activeTab) return
    this._activeTab = key
    this._tooltip?.hide()
    this._renderActive()
  }

  _renderActive() {
    // Wipe current slot objects
    this._tooltip?.hide()
    this._slotObjects.forEach(o => o?.destroy?.())
    this._slotObjects = []
    this._slots = []

    const tabDef = TABS.find(t => t.key === this._activeTab)
    const kind = tabDef.kind
    const allDefs = this._defsByKind[kind]() ?? []

    // Filter out items at placement cap (placed >= max). Locked items
    // stay visible — their L{N} badge is part of the design.
    const dungeonLevel = this._gameState.boss?.level ?? 1
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
    const slotH = SLOT_H

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
      // Skip only fully-offscreen slots; partial slots render and are
      // clipped by the geometry mask applied in _renderSlot.
      if (sy + slotH < this._slotsTopY) return
      if (sy > this._slotsBotY) return
      this._renderSlot(def, kind, sx, sy, slotW, slotH)
    })

    // Apply the slot-area geometry mask to every just-created object.
    // Hit zones aren't masked — clicks should still register on partially
    // visible slots, just visuals are clipped.
    if (this._slotMask) {
      for (const o of this._slotObjects) {
        if (o?.type === 'Zone') continue
        o?.setMask?.(this._slotMask)
      }
    }

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

    // If we're not currently visible (day phase), hide every slot object
    // we just created — the scrollbar hint included. Has to run AFTER the
    // scrollbar push so it catches that graphic too. Re-renders triggered
    // by ROOM_PLACED / MINION_DIED fire during day phase as well, and
    // without this guard they'd flash visible on top of the day HUD.
    if (!this._visible) {
      this._slotObjects.forEach(o => o?.setVisible?.(false))
    }
  }

  // Placement cap helpers — mirror DungeonGrid.effectiveMaxPerDungeon
  // semantics. Sparse-table baseline (2026-05-22): when the table's
  // lowest entry is above the current dungeonLevel (mango cheat path),
  // we seed `cap` to the lowest entry's value so the cap isn't
  // accidentally null/unlimited at low levels. `cap === 0 → null` is
  // kept as a legacy "0 = unlimited" carve-out for any future table
  // that wants to mean "unlimited at this level".
  _capFor(def, kind, dungeonLevel) {
    if (kind === 'room') {
      const byLevel = def.placementRules?.maxPerDungeonByBossLevel
      if (byLevel) {
        const keys = Object.keys(byLevel).map(k => parseInt(k, 10))
          .filter(n => Number.isFinite(n)).sort((a, b) => a - b)
        if (keys.length === 0) {
          const m = def.placementRules?.maxPerDungeon
          return (m === 0 || m == null) ? null : m
        }
        let cap = byLevel[keys[0]]   // baseline = lowest entry's value
        for (const k of keys) if (dungeonLevel >= k) cap = byLevel[k]
        return cap === 0 ? null : cap
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
    let cost = def.cost ?? def.goldCost ?? 0
    // Rooms: freeFirstN free copies + escalating costStep, via the
    // canonical cost fn so the slot price matches what placement charges.
    if (kind === 'room') {
      cost = DungeonGrid.effectiveRoomCost(def, this._gameState.dungeon?.rooms ?? [])
    }
    if (kind === 'trap' && (this._gameState._mechanicFlags ?? {}).hastyArchitect) {
      cost = Math.max(0, Math.round(cost * Balance.MECHANIC_HASTY_ARCHITECT_TRAP_DISCOUNT))
    }
    // Minion costs scale with boss level so prices keep pace with stats.
    // Mirrors NightPhase._effectiveMinionCost so the displayed cost matches
    // the actual debit on purchase.
    if (kind === 'minion') {
      const bossLv = this._gameState.boss?.level ?? 1
      const lvMul  = 1 + Balance.MINION_COST_PER_BOSS_LV * Math.max(0, bossLv - 1)
      cost = Math.max(0, Math.round(cost * lvMul))
    }
    const locked = (def.unlockLevel ?? 1) > (this._gameState.boss?.level ?? 1)
    const affordable = cost <= (this._gameState.player?.gold ?? 0)

    // Locked slots get a much darker fill + dimmer edges so they read as
    // "not yet" at a glance. Unlocked slots use the regular stone fill.
    let fill, accent, accentS
    if (locked) {
      fill    = 0x07090c                  // very dark — almost black
      accent  = CRYPT.panelEdgeS          // both bevels = shadow color so
      accentS = CRYPT.panelEdgeS          // the slot looks recessed/inert
    } else if (isSelected) {
      fill    = CRYPT.bgStone3
      accent  = CRYPT.accent2
      accentS = CRYPT.accent
    } else {
      fill    = CRYPT.bgStone1
      accent  = CRYPT.panelEdgeH
      accentS = CRYPT.panelEdgeS
    }

    const slot = this._scene.add.graphics().setDepth(D)
    pixelPanel(slot, sx, sy, sw, sh, { fill, edgeH: accent, edgeS: accentS })
    if (isSelected && !locked) {
      // Outer accent ring
      slot.fillStyle(CRYPT.accent, 1)
      slot.fillRect(sx - 2, sy - 2, sw + 4, 2)
      slot.fillRect(sx - 2, sy + sh, sw + 4, 2)
      slot.fillRect(sx - 2, sy - 2, 2, sh + 4)
      slot.fillRect(sx + sw, sy - 2, 2, sh + 4)
    }
    this._slotObjects.push(slot)

    if (locked) {
      // Big lock icon in the centre instead of glyph + name + cost.
      const lockG = this._scene.add.graphics().setDepth(D + 1)
      pixelLock(lockG, sx + sw / 2, sy + sh / 2 - 4, 2, CRYPT.inkMuteHex)
      this._slotObjects.push(lockG)

      // Small unlock-level caption beneath the lock so the player knows
      // *when* it unlocks. Smaller and dimmer than a normal slot's cost.
      const lvlT = this._scene.add.text(sx + sw / 2, sy + sh - 6,
        `LV ${def.unlockLevel}`, {
        fontFamily: FONT_HEAD, fontSize: '7px',
        color: CRYPT.inkMute, letterSpacing: 1,
      }).setOrigin(0.5, 1).setDepth(D + 1)
      this._slotObjects.push(lvlT)

      // Hit zone — interactive=false so the cursor doesn't even change.
      const hit = this._scene.add.zone(sx, sy, sw, sh).setOrigin(0).setDepth(D + 5)
      this._slotObjects.push(hit)
      this._slots.push({ key, def, kind, sx, sy, sw, sh })
      return
    }

    // ── Unlocked slot — Option B card layout ──
    // Top region: visual preview (mini room footprint for rooms, glyph
    // for everything else). Bottom row: name + cost. Cap badge sits in
    // the top-right corner over the preview.
    // Phase 9 — Pact of the Jester: scramble glyph + name on trap slots
    // so the player doesn't know what they're placing until it's down.
    const jesterScramble = kind === 'trap' &&
      (this._gameState._mechanicFlags ?? {}).pactOfTheJester

    // Card layout — minions and items use the bigger sprite-friendly layout;
    // rooms / traps use the original tighter layout. Sprite-preview kinds get
    // a 70 px visual region with name + cost stacked underneath.
    const isSpriteKind     = kind === 'minion' || kind === 'item'
    const isMinionKind     = kind === 'minion'
    const VIS_TOP_PAD      = isSpriteKind ?  2 :  4
    const VIS_H            = isSpriteKind ? 70 : 58
    // Centerline Y for name and cost rows (origin 0.5,0.5 / 0,0.5).
    const NAME_CENTER_Y    = isSpriteKind ? 66 : 70
    const COST_CENTER_Y    = isSpriteKind ? 81 : 83
    const COST_ICON_H      = 10
    const TARGET_CHAR_PX  = 64                   // on-screen size of the visible character
    const visTop          = sy + VIS_TOP_PAD
    const visCenterX      = sx + sw / 2
    const visCenterY      = visTop + VIS_H / 2
    const previewObjs = []
    if (kind === 'room' && def.width && def.height) {
      this._renderRoomPreview(def, sx + 4, visTop, sw - 8, VIS_H, previewObjs)
    } else if (kind === 'minion') {
      // Minion preview — use the actual sprite (idle, frame 0 = facing down)
      // so the player sees what they're placing. Falls back to the sigil
      // glyph if the spritesheet isn't loaded.
      //
      // Frame size normalisation: 64-frame sheets have the character filling
      // the whole frame; 128-frame sheets centre the character in a 64×64
      // region with transparent padding around. Scaling both by the same
      // factor (target/64) gives both the same on-screen character size —
      // 128-frame sprites overflow past the slot with transparent pixels,
      // which is invisible.
      const texKey = `minion-${def.id}-idle`
      if (this._scene.textures.exists(texKey)) {
        const sprite = this._scene.add.sprite(
          visCenterX, visCenterY, texKey, 0,
        ).setOrigin(0.5).setDepth(D + 1)
        sprite.setScale(TARGET_CHAR_PX / 64)
        // Force NEAREST filtering so pixel art stays crisp at non-1× scale.
        // Phaser's default `antialias: true` config uses LINEAR which blurs.
        sprite.texture?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
        previewObjs.push(sprite)
      } else {
        const glyph = def._glyph ?? this._glyphFor(def, kind)
        const g = this._scene.add.text(visCenterX, visCenterY, glyph, {
          fontFamily: FONT_HEAD, fontSize: '32px',
          color: isSelected ? CRYPT.accent2Css : CRYPT.ink,
        }).setOrigin(0.5).setDepth(D + 1)
        previewObjs.push(g)
      }
    } else if (kind === 'item') {
      // Item preview — render the item's spritesheet/image at frame 0,
      // scaled so its bounding box fits within the visual region. The
      // Soul-Bound Beacon shows the beacon + healing fountain side by side
      // because the two are placed as a paired trade-off.
      this._renderItemPreview(def, visCenterX, visCenterY, VIS_H, D, previewObjs, isSelected)
    } else {
      // Trap / item kinds keep the glyph at the original 24 px size.
      const glyph = jesterScramble ? '?' : (def._glyph ?? this._glyphFor(def, kind))
      const g = this._scene.add.text(visCenterX, visCenterY, glyph, {
        fontFamily: FONT_HEAD, fontSize: '24px',
        color: isSelected ? CRYPT.accent2Css : CRYPT.ink,
      }).setOrigin(0.5).setDepth(D + 1)
      previewObjs.push(g)
    }
    for (const o of previewObjs) this._slotObjects.push(o)

    // Name — centred horizontally + vertically on its anchor line.
    const baseName = (def.name ?? def.id ?? '?').toUpperCase()
    const name = jesterScramble ? '???' : baseName
    const nameT = this._scene.add.text(sx + sw / 2, sy + NAME_CENTER_Y, name, {
      fontFamily: FONT_HEAD, fontSize: '8px',
      color: isSelected ? CRYPT.accent2Css : CRYPT.ink,
      letterSpacing: 1, align: 'center',
      wordWrap: { width: sw - 6, useAdvancedWrap: true },
    }).setOrigin(0.5, 0.5).setDepth(D + 1)
    this._slotObjects.push(nameT)

    // Cost — number text + coin icon side by side, both vertically centred
    // on COST_CENTER_Y so they share a horizontal centreline. Icon swaps to
    // gold-coins for prices > 20.
    const costColor = affordable ? CRYPT.goldCss : CRYPT.accent2Css
    const coinKey   = (cost > 20) ? 'ui-gold-coins' : 'ui-coin'
    const ICON_GAP  = 2
    const numT = this._scene.add.text(0, 0, String(cost), {
      fontFamily: FONT_HEAD, fontSize: '9px', color: costColor, letterSpacing: 1,
    }).setDepth(D + 1)
    let iconObj = null
    let iconW   = 0
    if (this._scene.textures.exists(coinKey)) {
      iconObj = this._scene.add.image(0, 0, coinKey).setDepth(D + 1)
      const tex = this._scene.textures.get(coinKey).getSourceImage()
      iconW = (tex?.width ?? COST_ICON_H) * (COST_ICON_H / (tex?.height ?? COST_ICON_H))
      iconObj.setDisplaySize(iconW, COST_ICON_H)
      iconObj.texture?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
    }
    const totalW = numT.width + (iconObj ? ICON_GAP + iconW : 0)
    const groupX = sx + sw / 2 - totalW / 2
    const groupY = sy + COST_CENTER_Y
    numT.setOrigin(0, 0.5).setPosition(groupX, groupY)
    this._slotObjects.push(numT)
    if (iconObj) {
      iconObj.setOrigin(0, 0.5).setPosition(groupX + numT.width + ICON_GAP, groupY)
      this._slotObjects.push(iconObj)
    }

    // Placement cap badge intentionally omitted from the slot UI — caps
    // are still enforced (slot disables when at-cap via _capFor / used <
    // cap check around line 263) but the "used/cap" overlay was visual
    // noise. The tooltip surfaces MAX/DUNGEON for items that have one.

    // Hit zone — clipped to the visible slot area so a partially-scrolled
    // slot can't catch clicks on the tabs above or the action bar below.
    // (Visuals are clipped by the geometry mask; without this clip the
    // zone still overhangs and steals tab presses when scrolled.)
    const clipTop = Math.max(sy, this._slotsTopY)
    const clipBot = Math.min(sy + sh, this._slotsBotY)
    const clipH   = clipBot - clipTop
    if (clipH <= 0) return
    const hit = this._scene.add.zone(sx, clipTop, sw, clipH)
      .setOrigin(0).setDepth(D + 5).setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => {
      nameT.setColor(CRYPT.accent2Css); uiSfxHover(this._scene)
      this._tooltip?.show(def, kind, { x: sx, y: sy, w: sw, h: sh }, this._gameState)
    })
    hit.on('pointerout',  () => {
      if (!isSelected) nameT.setColor(CRYPT.ink)
      this._tooltip?.hide()
    })
    hit.on('pointerup',   () => {
      // Use the standard UI click chime so construction-menu presses
      // are at the same volume as every other button. The dedicated
      // build_menu_press.wav was naturally quieter than press_button.wav
      // and no multiplier could close the gap (Phaser caps at 1.0).
      uiSfxClick(this._scene)
      this._setSelected(key)
      EventBus.emit('BUILD_SELECT', { def, kind })
    })
    this._slotObjects.push(hit)

    this._slots.push({ key, def, kind, sx, sy, sw, sh })
  }

  // Mini room preview — renders the actual room (walls, pillars, decor,
  // doors) at small scale by reusing the live theme sprites the
  // DungeonRenderer would stamp at full size. Floor cells fall back to
  // a category-tinted wash so the room still reads as its archetype
  // even before sprite art lands. Coverage > 1 sprites (corners,
  // pillars) are honoured so they span the right number of cells. The
  // Item preview — fits the item's spritesheet frame 0 inside the visual
  // region. Computes the largest scale that fits within MAX_H tall (set so
  // even a 2-line name like "TREASURE CHEST T1" or "SOUL-BOUND BEACON" has
  // a 4-px gap above it) and re-anchors the sprite's bottom to that gap line
  // — so tall sprites lift up and short ones sit at the visual center.
  // Small sprites (≤32 px) snap to integer scales for crisp pixel art.
  // Soul-Bound Beacon is special-cased to render the beacon + the healing
  // fountain side by side (they're placed as a mandatory pair). Falls back
  // to a centred glyph if the texture isn't loaded.
  _renderItemPreview(def, cx, cy, visH, D, sink, isSelected) {
    const MAX_H            = 48                  // max sprite display height
    const MAX_W_SINGLE     = 64                  // max width for single items
    const MAX_W_PAIR_HALF  = 36                  // max width per side in beacon pair
    const SPRITE_BOT_LIMIT = cy + 17             // ≈ 4 px above 2-line name top

    // Position sprite so its bottom is anchored at SPRITE_BOT_LIMIT, but
    // never below the visual centre (short sprites stay at default cy).
    const computeCenter = (displayH) => Math.min(cy, SPRITE_BOT_LIMIT - displayH / 2)

    const drawSprite = (texKey, x, maxH, maxW) => {
      if (!this._scene.textures.exists(texKey)) return null
      const sprite = this._scene.add.sprite(x, cy, texKey, 0)
        .setOrigin(0.5).setDepth(D + 1)
      const fw = sprite.frame?.width  || 32
      const fh = sprite.frame?.height || 32
      const longer = Math.max(fw, fh)
      let scale = Math.min(maxH / fh, maxW / fw)
      // Tiny sprites (≤16 px native, e.g. the 16×16 padlock) snap to a 2×
      // integer scale — bigger than that looks blown up. Medium sprites
      // (17–32 px, e.g. the chests) use float scale so 1.5× is allowed and
      // they actually grow into the full visual region. Larger sprites use
      // float scale naturally.
      if (longer <= 16 && scale >= 1) scale = Math.min(2, Math.floor(scale))
      sprite.setScale(scale)
      sprite.y = computeCenter(fh * scale)
      sprite.texture?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
      sink.push(sprite)
      return sprite
    }
    if (def.id === 'soul_bound_beacon') {
      // Beacon + fountain side by side, fitting MAX_H tall. Tighter gap
      // since the user wants them closer together.
      const GAP = 2
      const halfOff = (MAX_W_PAIR_HALF + GAP) / 2
      const s1 = drawSprite('item-soul-beacon',     cx - halfOff, MAX_H, MAX_W_PAIR_HALF)
      const s2 = drawSprite('item-healing-fountain', cx + halfOff, MAX_H, MAX_W_PAIR_HALF)
      // Align both to the same bottom edge so they read as a paired set.
      if (s1 && s2) {
        const bot = SPRITE_BOT_LIMIT
        s1.y = bot - s1.displayHeight / 2
        s2.y = bot - s2.displayHeight / 2
      }
      return
    }
    const sprite = drawSprite(def.spriteKey, cx, MAX_H, MAX_W_SINGLE)
    if (!sprite) {
      const glyph = def._glyph ?? this._glyphFor(def, 'item')
      const g = this._scene.add.text(cx, cy, glyph, {
        fontFamily: FONT_HEAD, fontSize: '32px',
        color: isSelected ? CRYPT.accent2Css : CRYPT.ink,
      }).setOrigin(0.5).setDepth(D + 1)
      sink.push(g)
    }
  }

  // room's `colorAdjust` (hue / sat / bright / contrast set in the
  // Room Editor) is applied per-sprite via preFX so the preview
  // matches the live look.
  _renderRoomPreview(def, boxX, boxY, boxW, boxH, sink) {
    const Wt = def.width
    const Ht = def.height
    if (!Wt || !Ht) return
    // Use float cell size for sprite scaling — int math here would
    // either leave gaps between cells or over-shoot the box.
    const cellF = Math.min(boxW / Wt, boxH / Ht)
    const cell  = Math.max(1, cellF)
    const gridW = cell * Wt
    const gridH = cell * Ht
    const ox = Math.round(boxX + (boxW - gridW) / 2)
    const oy = Math.round(boxY + (boxH - gridH) / 2)
    const wallT = Math.max(1, Number.isInteger(Balance.WALL_THICKNESS)
      ? Balance.WALL_THICKNESS : 2)
    const cat = (def.category ?? def.tags?.[0] ?? 'default').toLowerCase()
    const floorColorBase = CAT_COLOR[cat] ?? CAT_COLOR.default
    const floorColor     = _applyAdjToColor(floorColorBase, def.colorAdjust?.floor)
    const wallColor      = 0x1c1820
    const frameColor     = 0x07090c
    const adj = def.colorAdjust ?? {}
    const isPerimeter = (rx, ry) => (
      rx < wallT || rx >= Wt - wallT || ry < wallT || ry >= Ht - wallT
    )
    const slotForCell = (rx, ry) => isPerimeter(rx, ry) ? 'walls' : 'floor'

    // Backing frame + floor wash — drawn first so sprites overlay on top.
    const bg = this._scene.add.graphics().setDepth(this._depth + 3)
    bg.fillStyle(frameColor, 1)
    bg.fillRect(ox - 1, oy - 1, gridW + 2, gridH + 2)
    bg.fillStyle(floorColor, 0.45)
    bg.fillRect(ox, oy, gridW, gridH)
    sink.push(bg)

    // Walk the tileLayout. Each cell that resolves to a real sprite gets
    // a scaled-down Image; cells without a sprite fall back to procedural
    // wall (perimeter rings) drawn after the loop. The colorAdjust slot
    // (walls / floor) is picked per-cell from grid position so the same
    // hue/sat/bright that the live renderer applies also shows here.
    const layout = Array.isArray(def.tileLayout) ? def.tileLayout : []
    const placedSpan = new Set()  // "x,y" cells already covered by a span sprite
    const sprites = []
    for (let ry = 0; ry < Ht; ry++) {
      const row = layout[ry] ?? []
      for (let rx = 0; rx < Wt; rx++) {
        if (placedSpan.has(`${rx},${ry}`)) continue
        const entry = readCellEntry(row[rx])
        if (!entry) continue
        const sprite = ThemeManager.getSprite(entry.id)
        if (!sprite) continue
        const texKey = `themesprite-${entry.id}`
        if (!this._scene.textures.exists(texKey)) continue
        const cov  = spriteCoverage(sprite)
        const size = cell * cov
        const cx = ox + rx * cell + size / 2
        const cy = oy + ry * cell + size / 2
        const img = this._scene.add.image(cx, cy, texKey)
          .setOrigin(0.5).setDisplaySize(size, size).setDepth(this._depth + 4)
        if (entry.rot)  img.setAngle(entry.rot)
        if (entry.flipH) img.flipX = true
        if (entry.flipV) img.flipY = true
        // Apply colorAdjust matching the cell's slot (perimeter → walls,
        // interior → floor). Uses preFX so it composites cleanly with
        // the build-menu mask. Same code path the live renderer uses.
        const slot = slotForCell(rx, ry)
        _applyColorAdjPreFX(img, adj[slot])
        sprites.push(img)
        // Mark covered cells so the inner loop doesn't double-render.
        if (cov > 1) {
          for (let dy = 0; dy < cov; dy++) {
            for (let dx = 0; dx < cov; dx++) {
              placedSpan.add(`${rx + dx},${ry + dy}`)
            }
          }
        }
      }
    }
    for (const s of sprites) sink.push(s)

    // Procedural wall fill — for cells in the perimeter that didn't get
    // an explicit sprite override. A simple dark rect ring matches the
    // procedural wall colour the live renderer falls back to. Tinted
    // by the room's wall colorAdjust so a "desaturated walls" room
    // still reads as desaturated even on the un-painted strips.
    const wg = this._scene.add.graphics().setDepth(this._depth + 3)
    const wallColorAdj = _applyAdjToColor(wallColor, adj.walls)
    wg.fillStyle(wallColorAdj, 1)
    const drawCell = (rx, ry) => {
      const cx = ox + rx * cell
      const cy = oy + ry * cell
      wg.fillRect(cx, cy, cell + 0.5, cell + 0.5)
    }
    for (let rx = 0; rx < Wt; rx++) {
      for (let dt = 0; dt < wallT; dt++) {
        if (!placedSpan.has(`${rx},${dt}`))            drawCell(rx, dt)
        if (!placedSpan.has(`${rx},${Ht - 1 - dt}`))    drawCell(rx, Ht - 1 - dt)
      }
    }
    for (let ry = wallT; ry < Ht - wallT; ry++) {
      for (let dt = 0; dt < wallT; dt++) {
        if (!placedSpan.has(`${dt},${ry}`))            drawCell(dt, ry)
        if (!placedSpan.has(`${Wt - 1 - dt},${ry}`))   drawCell(Wt - 1 - dt, ry)
      }
    }
    sink.push(wg)

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
    const evolutions = this._scene.cache.json.get('minionEvolutions') ?? {}
    const starterIds = new Set(
      Object.values(evolutions)
        .filter(v => Array.isArray(v?.chain))
        .map(v => v.chain[0])
    )
    return all.filter(m => allowed.has(m.id) && starterIds.has(m.id))
              .sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
  }

  _trapDefs() {
    const all = this._scene.cache.json.get('trapTypes') ?? []
    const allowed = new Set(this._gameState.unlocks?.trapTypes ?? [])
    return all.filter(t => allowed.has(t.id))
              .sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
  }

  // Phase 1b.4 — Lich Phylactery. Items respect archetype + cap rules
  // (only one phylactery per run; filter the heart out if it's already
  // placed). Items above the current boss level still render but as
  // locked slots so the player can see future unlocks; renderer reads
  // `unlockLevel` to draw the lock + caption.
  _itemDefs() {
    const all      = this._scene.cache.json.get('items') ?? []
    const archId   = this._gameState.player?.bossArchetypeId
    const phylAlreadyPlaced     = !!this._gameState.phylactery
    // Once-destroyed-per-run flag — set by BossArchetypeSystem the
    // moment hunters break the heart. Hides the chip permanently so
    // the player can't rebuild a phylactery this run.
    const phylDestroyedThisRun  = !!this._gameState.player?._phylacteryDestroyedThisRun
    return all.filter(it => {
      if (it.hidden) return false   // pseudo-items used by forced-placement only
      if (it.archetypeRestriction && it.archetypeRestriction !== archId) return false
      if (it.id === 'phylactery_heart' && (phylAlreadyPlaced || phylDestroyedThisRun)) return false
      return true
    }).sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
  }

  setVisible(v) {
    this._visible = !!v
    if (!v) this._tooltip?.hide()
    this._objects.forEach(o => o?.setVisible?.(v))
    this._slotObjects.forEach(o => {
      o?.setVisible?.(v)
      // Slot hit zones need their input flag toggled too — setVisible alone
      // doesn't disable input on a Zone. Without this, hidden day-phase
      // slot zones could capture clicks meant for other UI; with it,
      // re-showing on night phase guarantees they're click-receptive.
      if (o?.input) o.input.enabled = v
    })
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
    this._tooltip?.destroy?.()
    this._tooltip = null
    this._slotObjects.forEach(o => o?.destroy?.())
    this._slotObjects = []
    this._objects.forEach(o => o?.destroy?.())
    this._objects = []
    this._tabs?.destroy?.()
    this._tabs = null
  }
}

export const BUILD_MENU_WIDTH = DEFAULT_PANEL_W

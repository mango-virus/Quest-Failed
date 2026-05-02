import { EventBus }      from '../systems/EventBus.js'
import { SaveSystem }    from '../systems/SaveSystem.js'
import { TILE, DungeonGrid as DungeonGridClass } from '../systems/DungeonGrid.js'
import { createMinion }  from '../entities/Minion.js'
import { createTrap }    from '../entities/Trap.js'
import { Balance }       from '../config/balance.js'
import { PALETTE, glowPanel, glowRect, makeBar, drawRoomIcon, spawnEmbers, applyUiCamera, showToast } from '../ui/UIKit.js'
import { ThemeManager, spriteCoverage } from '../systems/ThemeManager.js'
import { PauseManager }   from '../systems/PauseManager.js'

const TS         = Balance.TILE_SIZE
const PANEL_W    = 230
const BOTTOM_H   = 64

// Room category accent colours (match DungeonRenderer ROOM_STYLE)
const CAT_COLOR = {
  special:  0xaa22ff,
  starter:  0x0088cc,
  trap:     0xcc4422,
  treasure: 0xddaa22,
  combat:   0xcc2244,
  utility:  0x22cc88,
  default:  0x0088cc,
}

export class NightPhase extends Phaser.Scene {
  constructor() {
    super('NightPhase')
    this._gameState    = null
    this._dungeonGrid  = null
    this._roomDefs     = []
    this._minionDefs   = []
    this._trapDefs     = []
    this._selected     = null
    this._selectedKind = null   // 'room' | 'minion' | 'trap'
    this._preview      = null
    this._previewValid = false
    this._previewTileX = -1
    this._previewTileY = -1
    this._paletteCards = []      // currently-displayed cards (per active tab)
    this._paletteObjects = []    // every game object created for the active palette (for cleanup)
    this._paletteTab   = 'rooms' // 'rooms' | 'minions' | 'traps'
    this._paletteScrollY = 0     // vertical scroll offset within palette (Bug fix — palette overflowed when 17+ rooms unlocked)
    this._paletteContentHeight = 0  // total height of all cards on this tab
    this._statsTexts   = {}
    this._destroyEmbers = null
    this._lastPlaced   = null    // { kind: 'room' | 'minion', entity, goldCost } — for Ctrl+Z undo
    this._tabButtons      = []     // { container, label, key }
    this._rotation         = 0    // 0 | 90 | 180 | 270 — room placement rotation
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(data) {
    this._gameState = data?.gameState
    // Reset transient placement state — Phaser scene constructors only run
    // once (when the Game boots), so per-instance state from the previous
    // night phase carries over and breaks placement on day 2+.
    this._selected     = null
    this._selectedKind = null
    this._preview      = null
    this._previewValid = false
    this._previewTileX = -1
    this._previewTileY = -1
    this._paletteCards = []
    this._paletteObjects = []
    this._paletteTab   = 'rooms'
    this._paletteScrollY = 0
    this._lastPlaced   = null
    this._rotation     = 0
    // Phase 31D — action-bar tool mode: 'sell' | 'move' | 'rotate' | null.
    // When armed, the next click on a placed room executes the action.
    this._toolMode     = null
  }

  create() {
    const gameScene = this.scene.get('Game')
    this._dungeonGrid = gameScene.dungeonGrid

    const allRooms = this.cache.json.get('rooms') ?? []
    // Room redesign 2026-04-30 — palette filter is now allowlist + non-fixed.
    // Locked rooms (unlockLevel > current dungeonLevel) DO appear in the
    // palette but render with a 'L{N}' badge and reject selection — see
    // _renderRoomCards. Sorted by unlockLevel so unlocked rooms float up.
    this._roomDefs = allRooms.filter(r =>
      this._gameState.unlocks.rooms.includes(r.id) &&
      !r.placementRules?.fixed
    ).sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1))
    const allMinions = this.cache.json.get('minionTypes') ?? []
    // Only the starter (chain[0]) of each evolution chain is placeable —
    // higher tiers are reached by killing 2 adventurers without dying.
    const evolutions = this.cache.json.get('minionEvolutions') ?? {}
    const starterIds = new Set(
      Object.values(evolutions)
        .filter(v => Array.isArray(v?.chain))
        .map(v => v.chain[0])
    )
    this._minionDefs = allMinions.filter(m =>
      this._gameState.unlocks.minionTypes?.includes(m.id) && starterIds.has(m.id)
    )
    const allTraps = this.cache.json.get('trapTypes') ?? []
    const blockedTraps = this._gameState.player?.archetypeModifiers?.blockedTrapTypes ?? []
    const blocksAll = blockedTraps.includes('*')
    this._trapDefs = blocksAll ? [] : allTraps.filter(t =>
      this._gameState.unlocks.trapTypes?.includes(t.id) && !blockedTraps.includes(t.id)
    )

    applyUiCamera(this)
    this._buildUI()
    this._buildPreview()
    this._setupInput()
    this._wireHudEvents()

    EventBus.emit('NIGHT_PHASE_STARTED')
    EventBus.emit('NIGHT_PHASE_BEGAN')   // Phase 31C — HudScene listens to toggle build menu
    SaveSystem.save(this._gameState)
  }

  // Phase 31C — HUD chrome moved to HudScene. We listen for the build/tool
  // events that the new ActionBar + BuildMenu emit, fold them into the
  // existing _selectItem / _beginDay flows. Tool-mode events (rotate / move /
  // sell) currently no-op here; full wiring lands in 31D.
  _wireHudEvents() {
    // Defensive: if create() ran without an intervening shutdown (Phaser
    // scene.restart() during a window resize is one path that triggers
    // this), _hudListeners may still hold prior arrow-fn references that
    // are also still in EventBus. Resetting the array would orphan them
    // and we'd end up double-firing every BUILD_SELECT / TOOL_MOVE etc.,
    // which toggle internal state and cancel themselves out.
    if (this._hudListeners?.length) {
      for (const [evt, fn] of this._hudListeners) EventBus.off(evt, fn)
    }
    this._hudListeners = []
    const on = (event, fn) => {
      EventBus.on(event, fn, this)
      this._hudListeners.push([event, fn])
    }
    on('BUILD_SELECT', ({ def, kind }) => {
      // Translate kind values used by BuildMenu (room/minion/trap/item) into
      // NightPhase's existing kinds (room/minion/trap). Items are no-op.
      if (kind === 'item') return
      // Selecting a build slot cancels any armed tool — they're mutually
      // exclusive interaction modes.
      this._setToolMode(null)
      this._selectItem(def, kind)
    })
    on('PHASE_TOGGLE_REQUEST', () => {
      if (this._gameState.meta?.phase === 'night') this._beginDay()
    })
    on('TOOL_MOVE',   () => this._setToolMode('move'))
    on('TOOL_SELL',   () => this._setToolMode('sell'))
    // Phase 31D — any other action-bar button click also disarms a sticky
    // tool. The button's own effect still fires (whichever scene listens
    // for the OPEN_* / TIME_SCALE_SET event); we just make sure MOVE / SELL
    // don't linger after the player moves on.
    const clearTool = () => this._setToolMode(null)
    on('OPEN_MINION_ROSTER', clearTool)
    on('OPEN_KNOWLEDGE_MAP', clearTool)
    on('OPEN_ADV_INTEL',     clearTool)
    on('OPEN_BOSS_OVERVIEW', clearTool)
    on('OPEN_PAUSE_MENU',    clearTool)
    on('TIME_SCALE_SET',     clearTool)
  }

  // Phase 31D — arm/cancel a build-mode tool. Clicking the action-bar tool
  // button toggles the mode; the next pointer click on a placed room
  // executes the action. Right-click / Esc / picking another build slot
  // all cancel the tool. Re-clicking the same tool also cancels.
  _setToolMode(mode) {
    const next = (this._toolMode === mode) ? null : mode
    if (next === this._toolMode) return
    this._toolMode = next
    // Selecting a tool cancels any pending placement.
    if (next) this._cancelSelection()
    EventBus.emit('TOOL_MODE_CHANGED', { mode: next })
  }

  shutdown() {
    this._destroyEmbers?.()
    this._preview?.destroy()
    this._preview = null
    this._rotLabel?.destroy()
    this._rotLabel = null
    if (this._hudListeners) {
      for (const [evt, fn] of this._hudListeners) EventBus.off(evt, fn, this)
      this._hudListeners = []
    }
  }

  // ── UI construction ───────────────────────────────────────────────────────

  _buildUI() {
    // Phase 31C — HUD chrome relocated to HudScene (BossTopBar / BuildMenu /
    // ActionBar / KnowledgePin / DungeonLog). NightPhase no longer renders
    // its own left palette, bottom bar, or hint strip. The legacy
    // _buildLeftPanel / _buildBottomBar / _buildHints / _buildPalette /
    // _refreshStats methods stay on the class as dead code (callers like
    // _confirmPlacement still hit _refreshStats and _renderActivePalette;
    // those now no-op via early returns at their tops).
    //
    // The ember atmosphere stays — it's set-dressing, not chrome.
    this._destroyEmbers = spawnEmbers(this, 8, { depth: 5, colors: [0x9b32d4, 0x0088cc] })
  }

  // ── Left palette panel ────────────────────────────────────────────────────

  _buildLeftPanel(W, H) {
    const g = this.add.graphics().setDepth(10)
    glowPanel(g, 0, 0, PANEL_W, H - BOTTOM_H, { fill: PALETTE.panelBg, border: PALETTE.panelBorder, glow: PALETTE.accent })

    // Divider line on right edge
    g.lineStyle(1, PALETTE.accent, 0.4)
    g.beginPath()
    g.moveTo(PANEL_W, 0)
    g.lineTo(PANEL_W, H - BOTTOM_H)
    g.strokePath()

    // Header
    this.add.text(PANEL_W / 2, 14, 'NIGHT PHASE', {
      fontSize: '11px', color: PALETTE.textAccent, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5, 0).setDepth(11)

    this.add.text(PANEL_W / 2, 28, '— BUILD YOUR DUNGEON —', {
      fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
    }).setOrigin(0.5, 0).setDepth(11)

    // Separator
    const gs = this.add.graphics().setDepth(10)
    gs.lineStyle(1, PALETTE.panelBorder, 0.6)
    gs.beginPath(); gs.moveTo(12, 46); gs.lineTo(PANEL_W - 12, 46); gs.strokePath()

    // Stats
    this._buildStats(gs)

    // Palette cards
    this._buildPalette()
  }

  _buildStats(g) {
    const x = 14
    let y = 54

    const row = (label, key, color = PALETTE.textDim) => {
      this.add.text(x, y, label, {
        fontSize: '9px', color, fontFamily: 'monospace',
      }).setDepth(11)
      const val = this.add.text(PANEL_W - 12, y, '—', {
        fontSize: '9px', color: PALETTE.textNormal, fontFamily: 'monospace',
      }).setOrigin(1, 0).setDepth(11)
      this._statsTexts[key] = val
      y += 14
    }

    row('Day',            'day',     PALETTE.textDim)
    row('Dungeon Level',  'dlevel',  PALETTE.textAccent)
    row('Gold',           'gold',    PALETTE.textCyan)
    row('XP',             'xp',      PALETTE.textAccent)
    row('Rooms placed',   'rooms',   PALETTE.textDim)
    row('Roster',         'roster',  PALETTE.textDim)
    row('Traps',          'traps',   PALETTE.textDim)

    // Separator
    g.lineStyle(1, PALETTE.panelBorder, 0.5)
    g.beginPath(); g.moveTo(12, y + 2); g.lineTo(PANEL_W - 12, y + 2); g.strokePath()

    // Library of Whispers forecast — title + multi-line body. Hidden when
    // no forecast (no Library room or fresh game). Updated in _refreshStats.
    this._whispersTitle = this.add.text(x, y + 8, '', {
      fontSize: '9px', color: PALETTE.textAccent, fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(11).setVisible(false)
    this._whispersBody = this.add.text(x, y + 22, '', {
      fontSize: '9px', color: PALETTE.textNormal, fontFamily: 'monospace', lineSpacing: 2,
      wordWrap: { width: PANEL_W - 24 },
    }).setDepth(11).setVisible(false)

    this._statsY = y + 8
    this._refreshStats()
  }

  _refreshStats() {
    // Phase 31C — chrome moved to HudScene; bail when the legacy stats
    // panel hasn't been built (which is now the case on every load).
    if (!this._statsTexts || !this._statsTexts.day) return
    const s = this._gameState

    this._statsTexts.day?.setText(`Day ${s.meta.dayNumber}`)
    this._statsTexts.dlevel?.setText(`LV ${s.boss?.level ?? 1}`)
    this._statsTexts.gold?.setText(`${s.player.gold}`)
    this._statsTexts.xp?.setText(`${s.meta?.xp ?? 0} / ${s.meta?.xpToNext ?? 100}`)
    this._statsTexts.rooms?.setText(`${s.dungeon.rooms.length}`)
    const rosterCap  = this._rosterCap()
    const rosterUsed = this._rosterUsed()
    const rosterFull = rosterCap > 0 && rosterUsed >= rosterCap
    const rosterEmpty = rosterCap === 0
    this._statsTexts.roster?.setText(`${rosterUsed}/${rosterCap}`)
      .setStyle({ color: rosterFull || rosterEmpty ? PALETTE.textRed : PALETTE.textDim })
    const trapCap  = this._trapCap()
    const trapUsed = this._trapUsed()
    const trapFull = trapCap > 0 && trapUsed >= trapCap
    const trapEmpty = trapCap === 0
    this._statsTexts.traps?.setText(`${trapUsed}/${trapCap}`)
      .setStyle({ color: trapFull || trapEmpty ? PALETTE.textRed : PALETTE.textDim })

    // Library forecast (Room redesign 2026-04-30)
    const forecast = s.meta.nextPartyPreview
    if (forecast && forecast.size > 0 && this._whispersTitle) {
      this._whispersTitle.setText('WHISPERS').setVisible(true)
      const breakdown = Object.entries(forecast.classCounts ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => `${n} ${id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`)
        .join(', ')
      this._whispersBody.setText(
        `Day ${forecast.day}: ${forecast.size} adventurer${forecast.size === 1 ? '' : 's'}\n${breakdown}`
      ).setVisible(true)
    } else if (this._whispersTitle) {
      this._whispersTitle.setVisible(false)
      this._whispersBody.setVisible(false)
    }
  }

  _buildPalette() {
    this._buildPaletteTabs()
    this._renderActivePalette()
    this._installPaletteMask()
  }

  // Bug fix — clip the palette content area so scrolled cards never bleed
  // into the bottom bar. Without this, the last card's description
  // overlaps the bar and looks half-rendered.
  _installPaletteMask() {
    const H = this.uiH
    const top = this._paletteContentY
    const bottom = H - BOTTOM_H - 1
    const maskShape = this.make.graphics({ x: 0, y: 0, add: false })
    maskShape.fillStyle(0xffffff)
    maskShape.fillRect(0, top, PANEL_W, Math.max(0, bottom - top))
    this._paletteMask = maskShape.createGeometryMask()
    // Apply mask to all currently-rendered palette objects
    for (const o of this._paletteObjects) {
      if (o?.setMask) o.setMask(this._paletteMask)
    }
  }

  _buildPaletteTabs() {
    const tabY = this._statsY + 6
    const tabH = 22
    const tabs = [
      { key: 'rooms',     label: `ROOMS ${this._roomDefs.length}` },
      { key: 'minions',   label: `MINIONS ${this._minionDefs.length}` },
      { key: 'traps',     label: `TRAPS ${this._trapDefs.length}` },
    ]
    const totalGap = 4
    const tabW = (PANEL_W - 20 - totalGap * (tabs.length - 1)) / tabs.length

    this._tabButtons.forEach(t => { t.container.destroy(); t.label.destroy() })
    this._tabButtons = []

    tabs.forEach(({ key, label }, i) => {
      const px = 10 + i * (tabW + totalGap)
      const py = tabY
      const cg = this.add.graphics().setDepth(11)
      const txt = this.add.text(px + tabW / 2, py + tabH / 2, label, {
        fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(12)

      const draw = (active) => {
        cg.clear()
        glowPanel(cg, px, py, tabW, tabH, {
          fill:   active ? 0x1a0a30 : 0x06060e,
          border: active ? PALETTE.accentBright : PALETTE.panelBorder,
          glow:   active ? PALETTE.accent : 0x1a0a30,
        })
      }
      draw(this._paletteTab === key)

      const hit = this.add.rectangle(px + tabW / 2, py + tabH / 2, tabW, tabH, 0, 0)
        .setDepth(13).setInteractive({ useHandCursor: true })
      hit.on('pointerdown', () => this._switchTab(key))

      this._tabButtons.push({ container: cg, label: txt, hit, draw, key })
    })
    this._paletteContentY = tabY + tabH + 8
  }

  _switchTab(key) {
    if (this._paletteTab === key) return
    this._cancelSelection()
    this._paletteTab = key
    // Reset scroll on tab switch — different tabs have different content lengths
    this._paletteScrollY = 0
    this._tabButtons.forEach(t => t.draw(t.key === key))
    this._renderActivePalette()
  }

  _renderActivePalette() {
    // Phase 31C — palette chrome moved to HudScene's BuildMenu. Bail unless
    // the legacy palette container exists (which it doesn't post-overhaul).
    if (this._paletteContentY == null) return
    // Tear down existing palette objects
    this._paletteObjects.forEach(o => o.destroy?.())
    this._paletteObjects = []
    this._paletteCards   = []

    this._renderActivePaletteInner()

    // Apply the mask to every freshly-rendered object so scroll-clipped
    // content stays within the panel viewport.
    if (this._paletteMask) {
      for (const o of this._paletteObjects) {
        if (o?.setMask) o.setMask(this._paletteMask)
      }
    }
  }

  _renderActivePaletteInner() {
    if (this._paletteTab === 'rooms') {
      this._renderRoomCards()
    } else if (this._paletteTab === 'minions') {
      this._renderMinionCards()
    } else if (this._paletteTab === 'traps') {
      this._renderTrapCards()
    }
  }

  _renderRoomCards() {
    const CARD_H = 60
    const CARD_W = PANEL_W - 20
    const startY = this._paletteContentY - this._paletteScrollY
    const gap    = 4

    // Hide cap-hit rooms; locked rooms stay visible with a 'L{N}' badge.
    // Cap honors per-boss-level scaling (Room redesign 2026-04-30).
    const dungeonLevel = this._gameState.boss?.level ?? 1
    const availableDefs = this._roomDefs.filter(def => {
      if (!DungeonGridClass.isUnlocked(def, dungeonLevel)) return true   // locked rooms shown for visibility
      const max = DungeonGridClass.effectiveMaxPerDungeon(def, dungeonLevel)
      if (max == null) return true
      return this._gameState.dungeon.rooms.filter(r => r.definitionId === def.id).length < max
    })
    this._paletteContentHeight = availableDefs.length * (CARD_H + gap)

    availableDefs.forEach((def, i) => {
      const cx = PANEL_W / 2
      const cy = startY + i * (CARD_H + gap) + CARD_H / 2
      const px = 10
      const py = startY + i * (CARD_H + gap)
      const catColor = CAT_COLOR[def.category] ?? CAT_COLOR.default
      const isLocked = !DungeonGridClass.isUnlocked(def, dungeonLevel)
      const titleAlpha = isLocked ? 0.45 : 1

      const cg = this.add.graphics().setDepth(10)
      glowPanel(cg, px, py, CARD_W, CARD_H, {
        fill: isLocked ? 0x040810 : 0x060c18,
        border: isLocked ? 0x1a1a24 : 0x0d1e30,
        glow:   isLocked ? 0x444466 : catColor,
      })
      cg.fillStyle(catColor, isLocked ? 0.18 : 0.5)
      cg.fillRect(px, py, CARD_W, 3)

      const iconG = this.add.graphics().setDepth(11)
      drawRoomIcon(iconG, px + 20, py + CARD_H / 2, def.id, isLocked ? 0x6a6a7a : catColor)
      iconG.setAlpha(titleAlpha)

      const nameTxt = this.add.text(px + 38, py + 8, def.name.toUpperCase(), {
        fontSize: '10px',
        color: isLocked ? PALETTE.textDim : PALETTE.textNormal,
        fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(11).setAlpha(titleAlpha)

      const costStr   = def.goldCost > 0 ? `${def.goldCost} gold` : 'FREE'
      const costColor = isLocked ? PALETTE.textDim
                      : def.goldCost > 0 ? PALETTE.textCyan
                      : PALETTE.textGreen
      const sizeTxt = this.add.text(px + 38, py + 22, `${def.width}×${def.height}  ·  ${costStr}`, {
        fontSize: '8px', color: costColor, fontFamily: 'monospace',
      }).setDepth(11).setAlpha(titleAlpha)

      const desc = (def.description ?? '').slice(0, 48) + ((def.description?.length ?? 0) > 48 ? '…' : '')
      const descTxt = this.add.text(px + 6, py + 38, desc, {
        fontSize: '7px', color: PALETTE.textDim, fontFamily: 'monospace',
        wordWrap: { width: CARD_W - 12 },
      }).setDepth(11).setAlpha(titleAlpha)

      // Locked badge — small "🔒 L{N}" tag in the top-right of the card.
      let lockBadge = null
      if (isLocked) {
        lockBadge = this.add.text(px + CARD_W - 6, py + 6,
          `🔒 L${def.unlockLevel ?? '?'}`, {
            fontSize: '9px', color: '#ff8866', fontFamily: 'monospace', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 2,
          }).setOrigin(1, 0).setDepth(12)
      }

      const hit = this.add.rectangle(cx, cy, CARD_W, CARD_H, 0x000000, 0)
        .setDepth(12).setInteractive({ useHandCursor: true })

      hit.on('pointerover', () => {
        if (this._selected !== def) {
          cg.clear()
          glowPanel(cg, px, py, CARD_W, CARD_H, {
            fill: isLocked ? 0x080812 : 0x0a1525,
            border: isLocked ? 0x442233 : catColor,
            glow:   isLocked ? 0x664455 : catColor,
          })
          cg.fillStyle(catColor, isLocked ? 0.18 : 0.5); cg.fillRect(px, py, CARD_W, 3)
        }
      })
      hit.on('pointerout', () => {
        if (this._selected !== def) this._resetCard(cg, px, py, CARD_W, CARD_H, catColor, false)
      })
      hit.on('pointerdown', (p) => {
        if (p.rightButtonDown()) return
        if (isLocked) {
          this._showPlacementError(`${def.name} unlocks at dungeon level ${def.unlockLevel}`)
          return
        }
        this._selectItem(def, 'room')
      })

      this._paletteCards.push({ def, kind: 'room', cg, px, py, CARD_W, CARD_H, catColor, isLocked })
      this._paletteObjects.push(cg, iconG, nameTxt, sizeTxt, descTxt, hit)
      if (lockBadge) this._paletteObjects.push(lockBadge)
    })
  }

  _renderMinionCards() {
    const CARD_H = 56
    const CARD_W = PANEL_W - 20
    const startY = this._paletteContentY - this._paletteScrollY
    const gap    = 4
    this._paletteContentHeight = this._minionDefs.length * (CARD_H + gap)

    if (this._minionDefs.length === 0) {
      const empty = this.add.text(PANEL_W / 2, startY + 20,
        'No minion types unlocked yet.', {
          fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
        }).setOrigin(0.5).setDepth(11)
      this._paletteObjects.push(empty)
      return
    }

    this._minionDefs.forEach((def, i) => {
      const cx = PANEL_W / 2
      const cy = startY + i * (CARD_H + gap) + CARD_H / 2
      const px = 10
      const py = startY + i * (CARD_H + gap)
      const catColor = CAT_COLOR[def.category] ?? 0xddccaa

      const cg = this.add.graphics().setDepth(10)
      glowPanel(cg, px, py, CARD_W, CARD_H, {
        fill: 0x060c18, border: 0x0d1e30, glow: catColor,
      })
      cg.fillStyle(catColor, 0.5); cg.fillRect(px, py, CARD_W, 3)

      // Minion sigil square (placeholder for sprite)
      const sigilG = this.add.graphics().setDepth(11)
      sigilG.fillStyle(0x0a0e16, 1)
      sigilG.fillRect(px + 8, py + 14, 22, 22)
      sigilG.lineStyle(1, catColor, 1)
      sigilG.strokeRect(px + 8, py + 14, 22, 22)
      const sigilTxt = this.add.text(px + 19, py + 25, def.id[0].toUpperCase(), {
        fontSize: '12px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(12)

      const nameTxt = this.add.text(px + 38, py + 6, def.name.toUpperCase(), {
        fontSize: '10px', color: PALETTE.textNormal, fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(11)

      const stats = def.baseStats ?? {}
      const statTxt = this.add.text(px + 38, py + 20,
        `HP ${stats.hp}  ATK ${stats.attack}  DEF ${stats.defense}`,
        { fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace' }
      ).setDepth(11)

      const costStr   = def.goldCost > 0 ? `${def.goldCost} gold` : 'FREE'
      const costColor = def.goldCost > 0 ? PALETTE.textCyan : PALETTE.textGreen
      const costTxt = this.add.text(px + 38, py + 34, costStr, {
        fontSize: '8px', color: costColor, fontFamily: 'monospace',
      }).setDepth(11)

      const hit = this.add.rectangle(cx, cy, CARD_W, CARD_H, 0x000000, 0)
        .setDepth(12).setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => {
        if (this._selected !== def) {
          cg.clear()
          glowPanel(cg, px, py, CARD_W, CARD_H, { fill: 0x0a1525, border: catColor, glow: catColor })
          cg.fillStyle(catColor, 0.5); cg.fillRect(px, py, CARD_W, 3)
        }
      })
      hit.on('pointerout', () => {
        if (this._selected !== def) this._resetCard(cg, px, py, CARD_W, CARD_H, catColor, false)
      })
      hit.on('pointerdown', (p) => { if (!p.rightButtonDown()) this._selectItem(def, 'minion') })

      this._paletteCards.push({ def, kind: 'minion', cg, px, py, CARD_W, CARD_H, catColor })
      this._paletteObjects.push(cg, sigilG, sigilTxt, nameTxt, statTxt, costTxt, hit)
    })
  }

  _renderTrapCards() {
    const CARD_H = 52
    const CARD_W = PANEL_W - 20
    const startY = this._paletteContentY - this._paletteScrollY
    const gap    = 4
    this._paletteContentHeight = this._trapDefs.length * (CARD_H + gap)

    if (this._trapDefs.length === 0) {
      const empty = this.add.text(PANEL_W / 2, startY + 20,
        'No traps unlocked yet.', {
          fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
        }).setOrigin(0.5).setDepth(11)
      this._paletteObjects.push(empty)
      return
    }

    // Per-trap-id palette card colour. Add an entry per new trap or it
    // falls back to `default`. Kept tiny on purpose — we'll grow it as
    // new traps land.
    const TRAP_COLOR = { default: 0x888888 }

    this._trapDefs.forEach((def, i) => {
      const cx = PANEL_W / 2
      const cy = startY + i * (CARD_H + gap) + CARD_H / 2
      const px = 10
      const py = startY + i * (CARD_H + gap)
      const catColor = TRAP_COLOR[def.id] ?? TRAP_COLOR.default

      const cg = this.add.graphics().setDepth(10)
      glowPanel(cg, px, py, CARD_W, CARD_H, {
        fill: 0x060c18, border: 0x0d1e30, glow: catColor,
      })
      cg.fillStyle(catColor, 0.5); cg.fillRect(px, py, CARD_W, 3)

      const nameTxt = this.add.text(px + 10, py + 6, def.name.toUpperCase(), {
        fontSize: '10px', color: PALETTE.textNormal, fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(11)

      const trigTxt = this.add.text(px + 10, py + 20, _formatTrigger(def.triggerCondition), {
        fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setDepth(11)

      const costStr = `${this._effectiveTrapCost(def)} gold  ·  ${def.baseDamage} dmg`
      const costTxt = this.add.text(px + 10, py + 34, costStr, {
        fontSize: '8px', color: PALETTE.textCyan, fontFamily: 'monospace',
      }).setDepth(11)

      const hit = this.add.rectangle(cx, cy, CARD_W, CARD_H, 0x000000, 0)
        .setDepth(12).setInteractive({ useHandCursor: true })
      hit.on('pointerover', () => {
        if (this._selected !== def) {
          cg.clear()
          glowPanel(cg, px, py, CARD_W, CARD_H, { fill: 0x0a1525, border: catColor, glow: catColor })
          cg.fillStyle(catColor, 0.5); cg.fillRect(px, py, CARD_W, 3)
        }
      })
      hit.on('pointerout', () => {
        if (this._selected !== def) this._resetCard(cg, px, py, CARD_W, CARD_H, catColor, false)
      })
      hit.on('pointerdown', (p) => { if (!p.rightButtonDown()) this._selectItem(def, 'trap') })

      this._paletteCards.push({ def, kind: 'trap', cg, px, py, CARD_W, CARD_H, catColor })
      this._paletteObjects.push(cg, nameTxt, trigTxt, costTxt, hit)
    })
  }

  _resetCard(cg, px, py, cw, ch, catColor, selected) {
    cg.clear()
    glowPanel(cg, px, py, cw, ch, {
      fill:   selected ? 0x0d1e30 : 0x060c18,
      border: selected ? catColor : 0x0d1e30,
      glow:   catColor,
    })
    cg.fillStyle(catColor, selected ? 0.8 : 0.5)
    cg.fillRect(px, py, cw, 3)
  }

  // ── Bottom bar ────────────────────────────────────────────────────────────

  _buildBottomBar(W, H) {
    const by = H - BOTTOM_H
    const g  = this.add.graphics().setDepth(10)

    glowPanel(g, 0, by, W, BOTTOM_H, {
      fill: PALETTE.panelBg, border: PALETTE.panelBorder, glow: PALETTE.accent,
    })

    // Top border highlight
    g.lineStyle(1, PALETTE.accent, 0.5)
    g.beginPath(); g.moveTo(0, by); g.lineTo(W, by); g.strokePath()

    // Knowledge overlay toggle (left of BEGIN DAY)
    this._buildKnowledgeButton(W, H, by)

    // Begin Day button
    this._buildBeginDayButton(W, H, by)
  }

  _buildKnowledgeButton(W, H, by) {
    const bw = 110, bh = 32
    // BEGIN DAY button has center bx = W - 140 with bw = 220, so its left
    // edge sits at W - 250.  Place this 14 px to its left.
    const bx  = W - 250 - 14 - bw
    const bcy = by + BOTTOM_H / 2

    const bg = this.add.graphics().setDepth(11)
    glowPanel(bg, bx, bcy - bh / 2, bw, bh, {
      fill: 0x06060e, border: 0x440000, glow: 0x1a0000,
    })

    this.add.text(bx + bw / 2, bcy, 'INTEL', {
      fontSize: '10px', color: '#aa3333', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12)

    const hit = this.add.rectangle(bx + bw / 2, bcy, bw, bh, 0, 0)
      .setDepth(13).setInteractive({ useHandCursor: true })
    hit.on('pointerdown', () => {
      const game = this.scene.get('Game')
      this.scene.launch('KnowledgeScreen', {
        gameState:       this._gameState,
        knowledgeSystem: game?.knowledgeSystem,
      })
    })
  }

  _buildBeginDayButton(W, H, by) {
    const bx = W - 140
    const bcy = by + BOTTOM_H / 2
    const bw  = 220
    const bh  = 40

    const bg = this.add.graphics().setDepth(11)
    const draw = (hover) => {
      bg.clear()
      glowPanel(bg, bx - bw / 2, bcy - bh / 2, bw, bh, {
        fill:   hover ? 0x1a0a30 : 0x0d0620,
        border: hover ? PALETTE.accentBright : PALETTE.accent,
        glow:   PALETTE.accent,
      })
    }
    draw(false)

    const label = this.add.text(bx, bcy, 'BEGIN DAY  ▶', {
      fontSize: '13px', color: PALETTE.textAccent, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(12)

    const hit = this.add.rectangle(bx, bcy, bw, bh, 0x000000, 0)
      .setDepth(13).setInteractive({ useHandCursor: true })

    hit.on('pointerover',  () => { draw(true);  label.setStyle({ color: PALETTE.textBright }) })
    hit.on('pointerout',   () => { draw(false); label.setStyle({ color: PALETTE.textAccent }) })
    hit.on('pointerdown',  () => this._beginDay())
  }

  _buildHints(W, H) {
    this.add.text(W - 8, H - BOTTOM_H - 6,
      'WASD / drag to scroll  ·  scroll to zoom  ·  R = rotate room / right-click to cancel pick  ·  left-click room to pick up  ·  use SELL tool to remove rooms/minions  ·  Ctrl+Z to undo  ·  ESC = pause  ·  HALLS tab: left=draw  right=erase',
      { fontSize: '8px', color: PALETTE.textDim, fontFamily: 'monospace' }
    ).setOrigin(1, 1).setDepth(11)
  }

  // ── Placement preview ──────────────────────────────────────────────────────

  _buildPreview() {
    const gameScene = this.scene.get('Game')
    this._preview  = gameScene.add.graphics().setDepth(20)
    this._rotLabel = gameScene.add.text(0, 0, '', {
      fontSize: '10px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
      backgroundColor: '#00000099', padding: { x: 4, y: 2 },
    }).setDepth(21).setVisible(false)
  }

  _selectItem(def, kind) {
    const was = this._selected
    this._paletteCards.forEach(c => this._resetCard(c.cg, c.px, c.py, c.CARD_W, c.CARD_H, c.catColor, false))

    if (was === def) {
      this._selected = null
      this._selectedKind = null
      this._clearPreview()
      this._updateGridVisibility()
      return
    }

    this._selected = def
    this._selectedKind = kind
    const card = this._paletteCards.find(c => c.def === def)
    if (card) this._resetCard(card.cg, card.px, card.py, card.CARD_W, card.CARD_H, card.catColor, true)
    this._updateGridVisibility()
  }

  // Show the dungeon grid lines while a placement is active so the player
  // can gauge alignment; hide them otherwise so the bedrock reads cleanly.
  _updateGridVisibility() {
    const gameScene = this.scene.get('Game')
    gameScene?._dungeonRenderer?.setGridVisible?.(this._selected != null)
  }

  _clearPreview() {
    this._preview?.clear()
    this._rotLabel?.setVisible(false)
    this._previewTileX = -1
    this._previewTileY = -1
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  _setupInput() {
    const gameScene = this.scene.get('Game')
    const cam = gameScene.cameras.main

    // (Browser context menu suppressed game-wide in main.js.)
    this.input.on('pointermove', (p) => {
      if (!this._selected) {
        this._showRoomHover(p, cam)
        return
      }
      const wp = cam.getWorldPoint(p.x, p.y)
      let tx, ty
      if (this._selectedKind === 'room') {
        // Use fractional tile position so the room center tracks the cursor
        // precisely rather than snapping to the nearest tile edge.
        const rotDef = this._getRotatedDef(this._selected)
        tx = Math.round(wp.x / TS - rotDef.width  / 2)
        ty = Math.round(wp.y / TS - rotDef.height / 2)
        // Free placement — no snap. Doors auto-create at adjacency time.
      } else {
        tx = Math.floor(wp.x / TS)
        ty = Math.floor(wp.y / TS)
      }
      if (tx !== this._previewTileX || ty !== this._previewTileY) {
        this._previewTileX = tx
        this._previewTileY = ty
        this._drawPreview(tx, ty, cam)
      }
    })

    this.input.on('pointerdown', (p, gameObjects) => {
      if (p.middleButtonDown()) return

      // Skip room-pickup when the click is over a minion. The minion sprite
      // lives in Game scene, but NightPhase's input plugin actually runs
      // before Game's (it was launched on top), so cross-scene flags arrive
      // too late. Easier to check `gameState.minions` directly: if any
      // alive minion is within ~half a tile of the cursor's world point,
      // assume the click is for the minion and let MinionRenderer handle it.
      const wp = cam.getWorldPoint(p.x, p.y)
      const minionHitR = TS * 0.55
      const overMinion = (this._gameState.minions ?? []).some(m => {
        if (m.aiState === 'dead' || m.resources?.hp <= 0) return false
        return Math.hypot(wp.x - m.worldX, wp.y - m.worldY) <= minionHitR
      })
      if (overMinion) return

      if (p.rightButtonDown()) {
        // Phase 9 — Pact of the Brand: right-click on a placed trap selects
        // it as the blessed trap (only valid when no tool/placement armed).
        if (!this._toolMode && !this._selected &&
            (this._gameState._mechanicFlags ?? {}).pactOfTheBrand) {
          const tx = Math.floor(wp.x / TS)
          const ty = Math.floor(wp.y / TS)
          const trap = (this._gameState.dungeon.traps ?? []).find(
            t => t.tileX === tx && t.tileY === ty && !t.isTriggered
          )
          if (trap) {
            EventBus.emit('BRAND_TRAP_SELECTED', { trapId: trap.instanceId })
            return
          }
        }
        // Right-click cancels: armed tool → release; placement candidate → drop.
        // Removal is sell-only — right-click never deletes placed content.
        if (this._toolMode) { this._setToolMode(null); return }
        if (this._selected) { this._cancelSelection(); return }
        return
      }

      // Left-clicks inside the HUD panel should not trigger dungeon actions.
      // Guard here (not in pointermove) so the preview always tracks the
      // cursor — a pointermove guard was causing the preview tile to never
      // be set on day 2+ if uiSf differed between scene launches.
      if (p.x < PANEL_W * (this.uiSf ?? 1)) return

      // Phase 9 — Crucible sacrifice mode: two clicks on minions in same room.
      if (this._crucibleMode) {
        const tx = Math.floor(wp.x / TS)
        const ty = Math.floor(wp.y / TS)
        const minion = (this._gameState.minions ?? []).find(m =>
          m.faction === 'dungeon' && m.aiState !== 'dead' &&
          m.tileX === tx && m.tileY === ty
        )
        if (!minion) {
          this._showPlacementError('Click on a minion (or ESC to cancel)')
          return
        }
        if (!this._crucibleVictimId) {
          this._crucibleVictimId = minion.instanceId
          this._showPlacementError(`Victim: ${minion.definitionId} — click target in same room`)
          return
        }
        const game = this.scene.get('Game')
        const result = game?.dungeonMechanicSystem?.crucibleSacrifice?.(this._crucibleVictimId, minion.instanceId)
        if (result?.ok) {
          this._showPlacementError('Crucible: sacrifice complete')
        } else {
          this._showPlacementError(`Crucible failed: ${result?.error ?? 'unknown'}`)
        }
        this._crucibleMode = false
        this._crucibleVictimId = null
        return
      }
      // Phase 31D — action-bar tool intercepts left-click on placed rooms.
      if (this._toolMode) {
        const tx = Math.floor(wp.x / TS)
        const ty = Math.floor(wp.y / TS)
        if (this._toolMode === 'sell') {
          this._executeSellAt(tx, ty)
          return
        }
        if (this._toolMode === 'move') {
          // Move is sticky — stays armed until the player clicks the MOVE
          // button again or BEGIN DAY fires. While holding a room, the
          // next click drops it; otherwise the click picks up the room
          // under the cursor (if any).
          if (this._selected) {
            if (this._previewTileX >= 0) {
              this._confirmPlacement(this._previewTileX, this._previewTileY)
            }
          } else {
            this._executeMoveAt(tx, ty)
          }
          return
        }
        return
      }

      // Without a tool armed and no build slot selected, left-click in the
      // dungeon is a no-op. Pickup of placed rooms requires the MOVE tool.
      if (!this._selected) return
      if (this._previewTileX < 0) return
      this._confirmPlacement(this._previewTileX, this._previewTileY)
    })

    this.input.keyboard.on('keydown-R', () => {
      if (this._selectedKind === 'room') {
        this._rotation = (this._rotation + 90) % 360
        if (this._previewTileX >= 0) this._drawPreview(this._previewTileX, this._previewTileY)
      } else {
        this._cancelSelection()
      }
    })
    this.input.keyboard.on('keydown-ESC', () => {
      // Esc cancels an armed tool first; only opens pause if no tool armed.
      if (this._crucibleMode) {
        this._crucibleMode = false
        this._crucibleVictimId = null
        this._showPlacementError('Crucible cancelled')
        return
      }
      if (this._toolMode) { this._setToolMode(null); return }
      PauseManager.toggle(this)
    })
    this.input.keyboard.on('keydown-Z',   (e) => {
      if (e.ctrlKey || e.metaKey) this._undoLastPlacement()
    })
    // Phase 9 — Pact of the Crucible: 'C' enters sacrifice mode (pact must
    // be active + unused this run). Two clicks on minions in the same
    // room confirm; ESC cancels.
    this.input.keyboard.on('keydown-C', () => {
      const f = this._gameState._mechanicFlags ?? {}
      if (!f.pactOfTheCrucible || f.crucibleUsed) return
      this._crucibleMode = true
      this._crucibleVictimId = null
      this._showPlacementError('CRUCIBLE — click victim minion')
    })

    // Bug fix — scroll the palette when wheel happens over the left panel.
    // Without this, the unlocked-rooms list (now 17+) overflows the panel
    // and the bottom cards get cut off below the screen edge.
    this.input.on('wheel', (p, _o, _dx, dy) => {
      if (this.cameras.main.getWorldPoint(p.x, p.y).x > PANEL_W) return
      const visibleH = this.uiH - this._paletteContentY - BOTTOM_H - 12
      const maxScroll = Math.max(0, this._paletteContentHeight - visibleH)
      this._paletteScrollY = Phaser.Math.Clamp(
        this._paletteScrollY + dy * 0.5, 0, maxScroll
      )
      this._renderActivePalette()
    })
  }

  _drawPreview(tx, ty, _cam) {
    if (!this._selected) return
    const def    = this._selected
    const rotDef = this._selectedKind === 'room' ? this._getRotatedDef(def) : def

    // For rooms tx/ty is already the top-left corner (computed in pointermove).
    // For minions/traps tx/ty is the cursor tile used directly.
    const placeTx = tx
    const placeTy = ty

    const check =
      this._selectedKind === 'minion' ? this._validateMinionPlacement(def, tx, ty)
      : this._selectedKind === 'trap'   ? this._validateTrapPlacement(def, tx, ty)
      : this._dungeonGrid.validatePlacement(rotDef, placeTx, placeTy, { dungeonLevel: this._gameState.boss?.level ?? 1 })
    this._previewValid = check.valid

    const color = check.valid ? 0x00cc66 : 0xcc2222
    const fillA = 0.18

    this._preview.clear()

    if (this._selectedKind === 'minion' || this._selectedKind === 'trap') {
      // Single-tile preview for minions and traps
      const wx = tx * TS
      const wy = ty * TS
      this._preview.fillStyle(color, fillA)
      this._preview.fillRect(wx, wy, TS, TS)
      this._preview.lineStyle(2, color, 0.7)
      this._preview.strokeRect(wx, wy, TS, TS)
      this._rotLabel?.setVisible(false)
    } else {
      // Room rectangle preview — top-left derived from centered cursor position
      const wx = placeTx * TS
      const wy = placeTy * TS
      const ww = rotDef.width  * TS
      const wh = rotDef.height * TS
      this._preview.fillStyle(color, fillA)
      this._preview.fillRect(wx, wy, ww, wh)
      this._preview.lineStyle(4, color, 0.25)
      this._preview.strokeRect(wx - 2, wy - 2, ww + 4, wh + 4)
      this._preview.lineStyle(2, color, 0.55)
      this._preview.strokeRect(wx - 1, wy - 1, ww + 2, wh + 2)
      this._preview.lineStyle(1, color, 0.9)
      this._preview.strokeRect(wx, wy, ww, wh)

      // Door markers — every doorway is 2 tiles wide along the wall axis
      // (DungeonGrid widens toward whichever side has more wall) AND under
      // Option-B separation extends 1 tile outward into the inter-room
      // gap stub. Show the full L of tiles each connection point occupies
      // so the player sees the actual doorway footprint pre-placement.
      const rw = rotDef.width, rh = rotDef.height
      this._preview.fillStyle(color, 0.9)
      for (const cp of rotDef.connectionPoints ?? []) {
        this._stampDoorFootprint(this._preview, cp, placeTx, placeTy, rw, rh)
      }

      // Predicted auto-connect doors — runs the dry-run pairing against
      // existing rooms and highlights every cp that would be auto-created
      // (one on the new room, one on the existing neighbour). Drawn in a
      // distinct gold so the player can tell at a glance "yes, placing
      // here will give me a door" vs "no door, just a doorless adjacency."
      // Skipped on invalid placements (already-red preview).
      if (check.valid) {
        const candidate = {
          gridX: placeTx, gridY: placeTy,
          width: rw, height: rh,
          definitionId: def.id,
          connectionPoints: rotDef.connectionPoints ?? [],
        }
        const pairs = this._dungeonGrid.computeAutoConnectPairs?.(candidate) ?? []
        if (pairs.length > 0) {
          this._preview.fillStyle(0xffd870, 0.95)
          this._preview.lineStyle(2, 0xffd870, 0.95)
          for (const { newCp, otherRoom, otherCp } of pairs) {
            // New-room door footprint (in candidate-local coords).
            this._stampDoorFootprint(this._preview, newCp, placeTx, placeTy, rw, rh)
            // Existing neighbour's door footprint (in dungeon coords).
            this._stampDoorFootprint(this._preview, otherCp,
              otherRoom.gridX, otherRoom.gridY, otherRoom.width, otherRoom.height)
          }
        }
      }

      // Rotation angle label — top-left corner of the preview rect, world space
      if (this._rotLabel) {
        this._rotLabel.setText(`↻ ${this._rotation}°`)
        this._rotLabel.setPosition(wx + 2, wy + 2)
        this._rotLabel.setVisible(true)
      }
    }
  }

  // Highlight the tiles a single cp's door occupies — 2 cells along the
  // wall axis × WT cells through the wall. Respects an explicit
  // alongDx/Dy if present (auto-connect cps) and falls back to the
  // widen-toward-larger-half heuristic for hand-authored cps. With no
  // inter-room gap, the cp's footprint stops at the room's wall ring;
  // the matching cp on the neighbour paints its own cells on the far
  // side of the seam.
  _stampDoorFootprint(g, cp, gridX, gridY, width, height) {
    const WT = Balance.WALL_THICKNESS
    const onTop = cp.y === 0
    const onBot = cp.y === height - 1
    const onLft = cp.x === 0
    const onRgt = cp.x === width  - 1
    const onTopOrBot = onTop || onBot
    const onLftOrRgt = onLft || onRgt
    if ((onTopOrBot && onLftOrRgt) || (!onTopOrBot && !onLftOrRgt)) return

    let alongDx = 0, alongDy = 0
    if (onTopOrBot) {
      alongDx = (cp.alongDx === 1 || cp.alongDx === -1)
        ? cp.alongDx
        : (((width - 1) - cp.x) >= cp.x ? 1 : -1)
    } else {
      alongDy = (cp.alongDy === 1 || cp.alongDy === -1)
        ? cp.alongDy
        : (((height - 1) - cp.y) >= cp.y ? 1 : -1)
    }

    const cells = []
    if (onTopOrBot) {
      const yStart = onTop ? 0 : height - WT
      const yEnd   = onTop ? WT - 1 : height - 1
      for (let iy = yStart; iy <= yEnd; iy++) {
        cells.push([cp.x,           iy])
        cells.push([cp.x + alongDx, iy])
      }
    } else {
      const xStart = onLft ? 0 : width - WT
      const xEnd   = onLft ? WT - 1 : width - 1
      for (let ix = xStart; ix <= xEnd; ix++) {
        cells.push([ix, cp.y])
        cells.push([ix, cp.y + alongDy])
      }
    }
    for (const [lx, ly] of cells) {
      const px = (gridX + lx) * TS
      const py = (gridY + ly) * TS
      g.fillRect(px + 4, py + 4, TS - 8, TS - 8)
    }
  }

  _validateMinionPlacement(def, tx, ty) {
    const violations = []
    const tile = this._dungeonGrid.getTileType(tx, ty)
    if (tile !== TILE.FLOOR && tile !== TILE.BOSS_FLOOR) {
      violations.push('Must place on a room floor')
    }
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room) {
      if (violations.length === 0) violations.push('Not inside any room')
    } else if (room.definitionId === 'boss_chamber' || room.definitionId === 'entry_hall') {
      violations.push("Can't place minions here")
    } else if (room.definitionId === 'throne_room') {
      // Room redesign 2026-04-30 — Throne Room hosts only its mini-boss.
      violations.push("Throne Room only houses its mini-boss")
    } else {
      // Room redesign 2026-04-30 — Barracks is the only roster source.
      // Crypt is no longer a barracks-equivalent for placement proximity.
      const isBarracksRoom = room.definitionId === 'starter_barracks'
      if (!isBarracksRoom &&
          !this._dungeonGrid.hasBarracksWithinDistance(room.instanceId, Balance.MINION_BARRACKS_DISTANCE)) {
        violations.push(`Need barracks within ${Balance.MINION_BARRACKS_DISTANCE} rooms`)
      }
    }
    // Room redesign 2026-04-30 — roster cap: each Barracks adds +5 slots.
    // Garrison minions (Crypt et al.) do not count toward this cap.
    const cap = this._rosterCap()
    const used = this._rosterUsed()
    if (used >= cap) {
      violations.push(`Roster full (${used}/${cap}) — build another Barracks for +5 slots`)
    }
    if (this._effectiveMinionCost(def) > this._gameState.player.gold) {
      violations.push('Insufficient gold')
    }
    return { valid: violations.length === 0, violations }
  }

  _effectiveMinionCost(def) {
    const base = def?.goldCost ?? 0
    const m = (this._gameState._mechanicFlags ?? {}).minionGoldCostMult ?? 1
    return Math.max(0, Math.round(base * m))
  }

  _rosterCap() {
    const barracksCount = (this._gameState.dungeon.rooms ?? [])
      .filter(r => r.definitionId === 'starter_barracks' && r.isActive !== false).length
    const f = this._gameState._mechanicFlags ?? {}
    const perBarracks = f.minionSlotsPerBarracks ?? 5
    const bonus   = f.maxMinionSlotBonus ?? 0
    const penalty = f.longGameMinionSlotPenalty ?? 0
    return Math.max(0, barracksCount * perBarracks + bonus - penalty)
  }

  _rosterUsed() {
    return (this._gameState.minions ?? [])
      .filter(m => (m.class ?? 'roster') === 'roster' && m.aiState !== 'dead')
      .length
  }

  _validateTrapPlacement(def, tx, ty) {
    const violations = []
    const tile = this._dungeonGrid.getTileType(tx, ty)
    // Traps go on FLOOR — not boss floor (sacred), not walls/void.
    if (tile !== TILE.FLOOR) {
      violations.push('Place on room floor')
    }
    // No two traps on the same tile
    if ((this._gameState.dungeon.traps ?? []).some(t => t.tileX === tx && t.tileY === ty)) {
      violations.push('Already a trap here')
    }
    // No minion on this tile (would be silly)
    if (this._gameState.minions.some(m => m.tileX === tx && m.tileY === ty)) {
      violations.push('Tile occupied by a minion')
    }
    // Room redesign 2026-04-30 — Trap Factory is the gateway: each Factory
    // adds +5 trap slots. Without a Factory, no traps at all.
    const cap = this._trapCap()
    const used = this._trapUsed()
    if (cap === 0) {
      violations.push('Build a Trap Factory to unlock traps')
    } else if (used >= cap) {
      violations.push(`Trap pool full (${used}/${cap}) — build another Trap Factory for +5 slots`)
    }
    if (this._effectiveTrapCost(def) > this._gameState.player.gold) {
      violations.push('Insufficient gold')
    }
    return { valid: violations.length === 0, violations }
  }

  _effectiveTrapCost(def) {
    const base = def?.goldCost ?? 0
    const f = this._gameState._mechanicFlags ?? {}
    let cost = base
    if (f.hastyArchitect) cost *= Balance.MECHANIC_HASTY_ARCHITECT_TRAP_DISCOUNT
    if (f.pactOfTheJester) cost *= Balance.MECHANIC_JESTER_TRAP_DISCOUNT
    if (f.trapGoldCostMult) cost *= f.trapGoldCostMult
    return Math.max(0, Math.round(cost))
  }
  _trapCap() {
    const factoryCount = (this._gameState.dungeon.rooms ?? [])
      .filter(r => r.definitionId === 'trap_factory' && r.isActive !== false).length
    const f = this._gameState._mechanicFlags ?? {}
    const perFactory = f.trapSlotsPerFactory ?? 5
    const bonus = f.maxTrapSlotBonus ?? 0
    return Math.max(0, factoryCount * perFactory + bonus)
  }

  _trapUsed() {
    return (this._gameState.dungeon.traps ?? []).length
  }

  _confirmPlacement(tx, ty) {
    if (!this._selected) return

    if (this._selectedKind === 'minion') {
      this._confirmMinionPlacement(tx, ty)
      return
    }
    if (this._selectedKind === 'trap') {
      this._confirmTrapPlacement(tx, ty)
      return
    }

    const def     = this._selected
    const rotDef  = this._getRotatedDef(def)
    // tx/ty already the top-left corner (set in pointermove via Math.round centering)
    const placeTx = tx
    const placeTy = ty
    const result  = this._dungeonGrid.validatePlacement(rotDef, placeTx, placeTy, { dungeonLevel: this._gameState.boss?.level ?? 1 })
    if (!result.valid) {
      this._showPlacementError(result.violations[0] ?? 'Invalid placement')
      return
    }

    // Phase 6e: archetype roomCostMultiplier (Tyrant 2×, Architect 0.75×)
    const arch = this._gameState.player?.archetypeModifiers
    const roomMul = arch?.roomCostMultiplier ?? 1
    const cost = Math.round((def.goldCost ?? 0) * roomMul)
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD) {
      if (this._gameState.player.gold < cost) {
        this._showPlacementError(`Need ${cost} gold (you have ${this._gameState.player.gold})`)
        return
      }
      this._gameState.player.gold -= cost
    }

    const room = this._dungeonGrid.placeRoom(rotDef, placeTx, placeTy)
    if (room) {
      this._playBuildSfx()
      // Re-anchor any minions that were inside this room before pickup so
      // they ride along to the new position. Offsets are pre-rotation; if
      // the player rotated the room the layout may not match — orphaned
      // minions on void tiles will be cleaned up by AI on next tick.
      if (this._heldRoomMinions?.length) {
        for (const { minion, offX, offY } of this._heldRoomMinions) {
          const nx = room.gridX + offX
          const ny = room.gridY + offY
          minion.tileX  = nx
          minion.tileY  = ny
          minion.worldX = nx * TS + TS / 2
          minion.worldY = ny * TS + TS / 2
          minion.homeTileX = nx
          minion.homeTileY = ny
          minion.assignedRoomId = room.instanceId
          minion._heldByPlayer = false
          minion._patrolTarget = null
          minion._patrolAccum  = 0
          minion._chasePath    = null
        }
        this._heldRoomMinions = null
      }
      this._lastPlaced = { kind: 'room', entity: room, goldCost: cost }
      const max = DungeonGridClass.effectiveMaxPerDungeon(def, this._gameState.boss?.level ?? 1)
      const atCap = max != null && this._gameState.dungeon.rooms.filter(r => r.definitionId === def.id).length >= max
      this._cancelSelection()
      if (atCap) this._renderActivePalette()
    }
    this._refreshStats()
  }

  _confirmMinionPlacement(tx, ty) {
    const def = this._selected
    const result = this._validateMinionPlacement(def, tx, ty)
    if (!result.valid) {
      this._showPlacementError(result.violations[0] ?? 'Cannot place minion here')
      return
    }

    const cost = this._effectiveMinionCost(def)
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD) this._gameState.player.gold -= cost

    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    const bossLevel = this._gameState.boss?.level ?? 1
    const minion = createMinion(def, { x: tx, y: ty }, room?.instanceId ?? null, { bossLevel })

    // Phase 6e: apply archetype-gated stat multiplier (e.g. Tyrant 2×, Architect 0.85×)
    const arch = this._gameState.player?.archetypeModifiers
    const mul  = arch?.minionStatMultiplier ?? 1
    if (mul !== 1) {
      minion.stats.attack    = Math.round(minion.stats.attack * mul)
      minion.stats.defense   = Math.round(minion.stats.defense * mul)
      minion.resources.maxHp = Math.round(minion.resources.maxHp * mul)
      minion.resources.hp    = minion.resources.maxHp
    }

    // [Removed 2026-04-30] treasure_room mini-boss auto-promotion. The
    // Throne Room handler in RoomBehaviorSystem now owns mini-boss spawns.

    this._gameState.minions.push(minion)
    this._lastPlaced = { kind: 'minion', entity: minion, goldCost: cost }

    this._playMinionPlaceSfx()
    EventBus.emit('MINION_PLACED', { minion })
    this._refreshStats()
  }

  _playMinionPlaceSfx() {
    if (!this.cache?.audio?.exists?.('sfx-minion-place')) return
    try { this.sound.play('sfx-minion-place', { volume: 0.7 }) } catch {}
  }

  _confirmTrapPlacement(tx, ty) {
    const def = this._selected
    const result = this._validateTrapPlacement(def, tx, ty)
    if (!result.valid) {
      this._showPlacementError(result.violations[0] ?? 'Cannot place trap here')
      return
    }

    const cost = this._effectiveTrapCost(def)
    if (cost > 0 && !Balance.DEV_INFINITE_GOLD) this._gameState.player.gold -= cost

    const trap = createTrap(def, { x: tx, y: ty })
    this._gameState.dungeon.traps.push(trap)
    this._lastPlaced = { kind: 'trap', entity: trap, goldCost: cost }

    EventBus.emit('TRAP_PLACED', { trap })
    this._refreshStats()
  }

  // Phase 31D — Sell tool. Removes a placed room AND every minion inside
  // it, refunding 50% of the gold spent on the room + each minion's
  // gold cost. Boss chamber + fixed rooms are immune.
  _executeSellAt(tx, ty) {
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room) return
    if (room.definitionId === 'boss_chamber') {
      this._showPlacementError('Cannot sell the boss chamber')
      return
    }
    const allRooms   = this.cache.json.get('rooms')       ?? []
    const allMinions = this.cache.json.get('minionTypes') ?? []
    const def = allRooms.find(d => d.id === room.definitionId)
    if (def?.placementRules?.fixed) {
      this._showPlacementError('Cannot sell a fixed room')
      return
    }

    // Find all minions whose tiles fall inside the room footprint.
    const minionsInside = (this._gameState.minions ?? []).filter(m => {
      if (m.aiState === 'dead') return false
      return m.tileX >= room.gridX && m.tileX < room.gridX + room.width
          && m.tileY >= room.gridY && m.tileY < room.gridY + room.height
    })

    let refund = Math.floor((def?.goldCost ?? 0) * 0.5)
    for (const m of minionsInside) {
      const mDef = allMinions.find(d => d.id === m.definitionId)
      refund += Math.floor((mDef?.goldCost ?? 0) * 0.5)
    }
    if (refund > 0) this._gameState.player.gold += refund

    // Remove the minions first so MINION_REMOVED fires before ROOM_REMOVED.
    for (const m of minionsInside) {
      const idx = this._gameState.minions.findIndex(x => x.instanceId === m.instanceId)
      if (idx >= 0) this._gameState.minions.splice(idx, 1)
      EventBus.emit('MINION_REMOVED', { minion: m })
    }

    if (this._lastPlaced?.entity?.instanceId === room.instanceId) {
      this._lastPlaced = null
    }
    this._dungeonGrid.removeRoom(room.instanceId)
    this._renderActivePalette()
    this._refreshStats()
    this._setToolMode(null)
  }

  // Phase 31D — Move tool. Reuses the existing pickup logic so minions
  // inside come along with the room. Player drops the room with a
  // second click (handled by the regular placement flow).
  _executeMoveAt(tx, ty) {
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room) return
    if (room.definitionId === 'boss_chamber') {
      this._showPlacementError('Cannot move the boss chamber')
      return
    }
    const allRooms = this.cache.json.get('rooms') ?? []
    const def = allRooms.find(d => d.id === room.definitionId)
    if (def?.placementRules?.fixed) {
      this._showPlacementError('Cannot move a fixed room')
      return
    }
    // Move tool stays armed (sticky mode) — the pointerdown handler
    // detects the held-room state and routes the next click to drop +
    // re-pickup transparently. Tool clears on MOVE re-click or
    // BEGIN DAY.
    // Inline pickup body (rather than calling _tryPickupRoom which expects
    // a pointer): we already have the room + def + tile coords.
    const cost  = Math.round((def?.goldCost ?? 0) * 1)
    if (cost > 0) this._gameState.player.gold += cost  // full refund — re-charged on drop

    const heldMinions = []
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead') continue
      if (m.tileX < room.gridX || m.tileX >= room.gridX + room.width)  continue
      if (m.tileY < room.gridY || m.tileY >= room.gridY + room.height) continue
      heldMinions.push({ minion: m, offX: m.tileX - room.gridX, offY: m.tileY - room.gridY })
      m._heldByPlayer = true
    }
    this._heldRoomMinions = heldMinions
    this._dungeonGrid.removeRoom(room.instanceId)
    this._rotation = 0
    this._selectItem(def, 'room')
    this._refreshStats()
  }

  _undoLastPlacement() {
    if (!this._lastPlaced) return
    const { kind, entity, goldCost } = this._lastPlaced
    if (kind === 'minion') {
      const idx = this._gameState.minions.findIndex(m => m.instanceId === entity.instanceId)
      if (idx >= 0) this._gameState.minions.splice(idx, 1)
      EventBus.emit('MINION_REMOVED', { minion: entity })
    } else if (kind === 'trap') {
      const idx = this._gameState.dungeon.traps.findIndex(t => t.instanceId === entity.instanceId)
      if (idx >= 0) this._gameState.dungeon.traps.splice(idx, 1)
      EventBus.emit('TRAP_REMOVED', { trap: entity })
    } else {
      this._dungeonGrid.removeRoom(entity.instanceId)
      // Re-render so any max-1 rooms filtered out while at-cap reappear.
      this._renderActivePalette()
    }
    this._gameState.player.gold += goldCost
    this._lastPlaced = null
    this._refreshStats()
  }

  _getRotatedDef(def) {
    const steps = this._rotation / 90
    if (steps === 0) return def
    const w = steps % 2 === 0 ? def.width  : def.height
    const h = steps % 2 === 0 ? def.height : def.width
    const connectionPoints = (def.connectionPoints ?? []).map(cp =>
      _rotateCP(cp, def.width, def.height, steps)
    )
    let layout = Array.isArray(def.tileLayout) ? def.tileLayout : []
    let lw = def.width, lh = def.height
    for (let i = 0; i < steps; i++) {
      layout = _rotateTileLayoutCW(layout, lw, lh)
      const tmp = lw; lw = lh; lh = tmp
    }
    return { ...def, width: w, height: h, connectionPoints, tileLayout: layout }
  }

  _tryPickupRoom(p, cam) {
    if (p.x <= PANEL_W) return
    const wp = cam.getWorldPoint(p.x, p.y)
    const tx = Math.floor(wp.x / TS)
    const ty = Math.floor(wp.y / TS)
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room || room.definitionId === 'boss_chamber') return

    const allRooms = this.cache.json.get('rooms') ?? []
    const def = allRooms.find(d => d.id === room.definitionId)
    if (!def || def.placementRules?.fixed) return

    // Full cost refund on pick-up (player is repositioning, not removing permanently)
    const arch = this._gameState.player?.archetypeModifiers
    const roomMul = arch?.roomCostMultiplier ?? 1
    const cost = Math.round((def.goldCost ?? 0) * roomMul)
    if (cost > 0) this._gameState.player.gold += cost

    if (this._lastPlaced?.entity?.instanceId === room.instanceId) this._lastPlaced = null

    // Capture minions inside the room so they travel with it on placement.
    // Offsets are room-relative tile coords; we re-anchor them after placeRoom
    // succeeds. AI is paused via `_heldByPlayer` until then.
    const heldMinions = []
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead') continue
      if (m.tileX < room.gridX || m.tileX >= room.gridX + room.width)  continue
      if (m.tileY < room.gridY || m.tileY >= room.gridY + room.height) continue
      heldMinions.push({ minion: m, offX: m.tileX - room.gridX, offY: m.tileY - room.gridY })
      m._heldByPlayer = true
    }
    this._heldRoomMinions = heldMinions

    this._dungeonGrid.removeRoom(room.instanceId)
    this._rotation = 0

    // Switch to rooms tab so the card and placement preview are visible
    if (this._paletteTab !== 'rooms') {
      this._paletteTab = 'rooms'
      this._paletteScrollY = 0
      this._tabButtons.forEach(t => t.draw(t.key === 'rooms'))
    }
    this._renderActivePalette()   // ensure card is visible (may have been filtered as maxed)
    this._selectItem(def, 'room')
    this._refreshStats()
  }

  _showRoomHover(p, cam) {
    if (p.x <= PANEL_W) { this._preview?.clear(); return }
    const wp = cam.getWorldPoint(p.x, p.y)
    const tx = Math.floor(wp.x / TS)
    const ty = Math.floor(wp.y / TS)
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room || room.definitionId === 'boss_chamber') {
      this._preview?.clear()
      return
    }
    const wx = room.gridX * TS
    const wy = room.gridY * TS
    const ww = room.width  * TS
    const wh = room.height * TS
    this._preview.clear()
    this._preview.fillStyle(0x4499ff, 0.07)
    this._preview.fillRect(wx, wy, ww, wh)
    this._preview.lineStyle(1, 0x4499ff, 0.55)
    this._preview.strokeRect(wx, wy, ww, wh)
  }

  _cancelSelection() {
    // If we'd grabbed minions during a room pickup, release the AI lock so
    // they're not frozen forever. Their tiles are now VOID (the room is
    // gone) — AISystem.stuck-in-wall guard will snap them to a walkable
    // neighbour on next tick.
    if (this._heldRoomMinions?.length) {
      for (const { minion } of this._heldRoomMinions) minion._heldByPlayer = false
      this._heldRoomMinions = null
    }
    this._selected = null
    this._selectedKind = null
    this._rotation = 0
    this._paletteCards.forEach(c => this._resetCard(c.cg, c.px, c.py, c.CARD_W, c.CARD_H, c.catColor, false))
    this._clearPreview()
    this._updateGridVisibility()
    EventBus.emit('BUILD_DESELECT')
  }

  // ── Begin Day ─────────────────────────────────────────────────────────────

  _beginDay() {
    // Clear any sticky tool mode so the action bar's armed ring + the
    // next-night reset stay clean.
    this._setToolMode(null)
    this._cancelSelection()

    const dungeon = this._gameState.dungeon
    const entry = dungeon.rooms.find(r => r.definitionId === 'entry_hall')
    if (!entry) {
      this._showPlacementError('You must place an Entry Hall before starting the day')
      return
    }

    // Free placement allows islands, so verify connectivity at day-start.
    // Every placed room — including the boss — must be reachable from the
    // entry_hall via the doorway graph.
    const disconnected = this._dungeonGrid.getDisconnectedRooms()
    if (disconnected.length > 0) {
      // Use the room's display name from the def cache when available so
      // 'mimic_vault' surfaces as 'Mimic Vault' (and reads as a ROOM, not
      // the placeable Mimic minion that shares the prefix).
      const allRooms = this.cache.json.get('rooms') ?? []
      const labelFor = r => allRooms.find(d => d.id === r.definitionId)?.name
        ?? r.definitionId.replace(/_/g, ' ')
      const names = disconnected.slice(0, 2).map(labelFor).join(', ')
      const extra = disconnected.length > 2 ? ` +${disconnected.length - 2} more` : ''
      const noun = disconnected.length === 1 ? 'room' : 'rooms'
      this._showPlacementError(`Disconnected ${noun}: ${names}${extra} — place adjacent to existing rooms`)
      return
    }

    this._gameState.meta.phase = 'day'
    SaveSystem.save(this._gameState)
    EventBus.emit('NIGHT_PHASE_ENDED')
    this.scene.start('DayPhase', { gameState: this._gameState })
  }

  // Show a transient banner when a placement attempt fails, with the
  // specific reason ("Out of bounds", "Need 25 gold", "Must be 3 rooms
  // from boss", etc.) so the player knows why their click did nothing.
  _playBuildSfx() {
    const keys = ['sfx-build-1', 'sfx-build-2', 'sfx-build-3']
    const key = keys[Math.floor(Math.random() * keys.length)]
    if (!this.cache?.audio?.exists?.(key)) return
    try { this.sound.play(key, { volume: 0.7 }) } catch {}
  }

  _showPlacementError(message) {
    // HudScene sits above NightPhase in the scene stack (see main.js registration
    // order), so a toast added to NightPhase's display list is painted over by
    // HudScene's chrome.  Use HudScene as the host so the toast renders on top.
    const hud = this.scene.get('HudScene')
    const target = (hud && this.scene.isActive('HudScene')) ? hud : this
    showToast(target, message, { type: 'error' })
  }
}

// Rotate a tileLayout 2D array 90° clockwise. layout is indexed [ry][rx]
// for a room of (oldW × oldH); the result is indexed for (oldH × oldW).
// Cell entries (string or {id, rot, flipH, flipV}) get their per-cell rot
// incremented by 90° so the painted sprite turns with the room.
//
// Sprites with coverage > 1 anchor at the top-left of a cov×cov block; the
// other cov*cov - 1 cells are null. CW rotation moves the block such that
// the original (ox, oy) anchor's new TL is at (newX = oldH - cov - oy,
// newY = ox). We walk the source layout and place each anchor at its new
// TL — non-anchor null cells in the source need no work since the result
// grid starts fully null.
function _rotateTileLayoutCW(layout, oldW, oldH) {
  const newW = oldH
  const newH = oldW
  const out = Array.from({ length: newH }, () => new Array(newW).fill(null))
  for (let oy = 0; oy < oldH; oy++) {
    const row = Array.isArray(layout?.[oy]) ? layout[oy] : null
    if (!row) continue
    for (let ox = 0; ox < oldW; ox++) {
      const cell = row[ox]
      if (cell == null) continue
      const id  = (typeof cell === 'string') ? cell : cell.id
      const cov = Math.max(1, spriteCoverage(ThemeManager.getSprite(id)) || 1)
      const newX = oldH - cov - oy
      const newY = ox
      if (newY < 0 || newY >= newH || newX < 0 || newX >= newW) continue
      out[newY][newX] = _rotateCellEntryCW(cell)
    }
  }
  return out
}

function _rotateCellEntryCW(cell) {
  if (cell == null) return null
  if (typeof cell === 'string') return { id: cell, rot: 90 }
  if (typeof cell === 'object' && typeof cell.id === 'string') {
    const rot = (((cell.rot ?? 0) + 90) % 360 + 360) % 360
    const out = { id: cell.id, rot }
    if (cell.flipH) out.flipH = true
    if (cell.flipV) out.flipV = true
    return out
  }
  return null
}

// Rotate connection point (cx,cy,direction) by `steps` × 90° clockwise
// within a room originally (w × h). w and h swap each step.
function _rotateCP(cp, w, h, steps) {
  const DIR_CW = { N: 'E', E: 'S', S: 'W', W: 'N' }
  let { x, y, direction } = cp
  for (let i = 0; i < steps; i++) {
    const nx = h - 1 - y
    const ny = x
    x = nx; y = ny
    direction = DIR_CW[direction] ?? direction
    const tmp = w; w = h; h = tmp
  }
  return { ...cp, x, y, direction }
}

function _formatTrigger(trig) {
  switch (trig) {
    case 'stepped_on':            return 'Triggers on step'
    case 'line_of_sight_broken':  return 'Triggers on entry'
    case 'stood_still_3_seconds': return 'Triggers if standing still 3s'
    case 'moved_too_fast':        return 'Triggers if moving fast'
    case 'ally_healed_nearby':    return 'Triggers on ally heal'
    case 'second_footstep':       return 'Triggers on follower'
    case 'adventurer_was_here_before': return 'Triggers on revisit'
    default: return trig
  }
}

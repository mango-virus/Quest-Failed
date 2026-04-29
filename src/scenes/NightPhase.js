import { EventBus }      from '../systems/EventBus.js'
import { SaveSystem }    from '../systems/SaveSystem.js'
import { EssenceSystem } from '../systems/EssenceSystem.js'
import { TILE }          from '../systems/DungeonGrid.js'
import { createMinion }  from '../entities/Minion.js'
import { createTrap }    from '../entities/Trap.js'
import { Balance }       from '../config/balance.js'
import { PALETTE, glowPanel, glowRect, makeBar, drawRoomIcon, spawnEmbers, applyUiCamera } from '../ui/UIKit.js'

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
    this._upkeepBar    = null
    this._destroyEmbers = null
    this._lastPlaced   = null    // { kind: 'room' | 'minion', entity, essenceCost } — for Ctrl+Z undo
    this._deactivationNotice = null
    this._tabButtons      = []     // { container, label, key }
    this._rotation         = 0    // 0 | 90 | 180 | 270 — room placement rotation
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(data) {
    this._gameState = data?.gameState
  }

  create() {
    const gameScene = this.scene.get('Game')
    this._dungeonGrid = gameScene.dungeonGrid

    const allRooms = this.cache.json.get('rooms') ?? []
    this._roomDefs = allRooms.filter(r =>
      this._gameState.unlocks.rooms.includes(r.id) && !r.placementRules?.fixed
    )
    const allMinions = this.cache.json.get('minionTypes') ?? []
    this._minionDefs = allMinions.filter(m =>
      this._gameState.unlocks.minionTypes?.includes(m.id)
    )
    const allTraps = this.cache.json.get('trapTypes') ?? []
    const blockedTraps = this._gameState.player?.archetypeModifiers?.blockedTrapTypes ?? []
    const blocksAll = blockedTraps.includes('*')
    this._trapDefs = blocksAll ? [] : allTraps.filter(t =>
      this._gameState.unlocks.trapTypes?.includes(t.id) && !blockedTraps.includes(t.id)
    )

    // Enforce upkeep at night start — may deactivate rooms
    const result = EssenceSystem.enforceUpkeep(this._gameState)

    applyUiCamera(this)
    this._buildUI()
    this._buildPreview()
    this._setupInput()

    // Show deactivation notice if rooms were shut off
    if (result.deactivated.length > 0) {
      this._showDeactivationNotice(result.deactivated)
    }

    EventBus.emit('NIGHT_PHASE_STARTED')
    SaveSystem.save(this._gameState)
  }

  shutdown() {
    this._destroyEmbers?.()
    this._preview?.destroy()
    this._preview = null
    this._rotLabel?.destroy()
    this._rotLabel = null
  }

  // ── UI construction ───────────────────────────────────────────────────────

  _buildUI() {
    const W = this.uiW
    const H = this.uiH

    // Subtle ember atmosphere (very sparse — not distracting in build mode)
    this._destroyEmbers = spawnEmbers(this, 8, { depth: 5, colors: [0x9b32d4, 0x0088cc] })

    this._buildLeftPanel(W, H)
    this._buildBottomBar(W, H)
    this._buildHints(W, H)
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

    row('Day',           'day',     PALETTE.textDim)
    row('Soul Essence',  'essence', PALETTE.textCyan)
    row('Dark Power',    'power',   PALETTE.textAccent)
    row('Rooms placed',  'rooms',   PALETTE.textDim)
    row('Upkeep/day',    'upkeep',  PALETTE.textDim)

    // Separator
    g.lineStyle(1, PALETTE.panelBorder, 0.5)
    g.beginPath(); g.moveTo(12, y + 2); g.lineTo(PANEL_W - 12, y + 2); g.strokePath()

    this._statsY = y + 8
    this._refreshStats()
  }

  _refreshStats() {
    const s = this._gameState
    const totalUpkeep = EssenceSystem.calculateDailyUpkeep(s)
    const canAfford   = s.player.soulEssence >= totalUpkeep

    this._statsTexts.day?.setText(`Day ${s.meta.dayNumber}`)
    this._statsTexts.essence?.setText(`${s.player.soulEssence}`)
    this._statsTexts.power?.setText(`${s.player.darkPower}`)
    this._statsTexts.rooms?.setText(`${s.dungeon.rooms.length}`)
    this._statsTexts.upkeep?.setText(`${totalUpkeep}`)
      .setStyle({ color: canAfford ? PALETTE.textDim : PALETTE.textRed })

    if (this._upkeepBar) {
      const fraction = s.player.soulEssence > 0
        ? Math.min(1, totalUpkeep / s.player.soulEssence)
        : 1
      this._upkeepBar.update(fraction)
    }
  }

  _buildPalette() {
    this._buildPaletteTabs()
    this._renderActivePalette()
    this._installPaletteMask()
  }

  // Bug fix — clip the palette content area so scrolled cards never bleed
  // into the bottom upkeep bar. Without this, the last card's description
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

    // Filter out room types that have hit their placement cap
    const availableDefs = this._roomDefs.filter(def => {
      const max = def.placementRules?.maxPerDungeon
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

      const cg = this.add.graphics().setDepth(10)
      glowPanel(cg, px, py, CARD_W, CARD_H, {
        fill: 0x060c18, border: 0x0d1e30, glow: catColor,
      })
      cg.fillStyle(catColor, 0.5)
      cg.fillRect(px, py, CARD_W, 3)

      const iconG = this.add.graphics().setDepth(11)
      drawRoomIcon(iconG, px + 20, py + CARD_H / 2, def.id, catColor)

      const nameTxt = this.add.text(px + 38, py + 8, def.name.toUpperCase(), {
        fontSize: '10px', color: PALETTE.textNormal, fontFamily: 'monospace', fontStyle: 'bold',
      }).setDepth(11)

      const costStr   = def.essenceCostToPlace > 0 ? `${def.essenceCostToPlace} essence` : 'FREE'
      const costColor = def.essenceCostToPlace > 0 ? PALETTE.textCyan : PALETTE.textGreen
      const sizeTxt = this.add.text(px + 38, py + 22, `${def.width}×${def.height}  ·  ${costStr}`, {
        fontSize: '8px', color: costColor, fontFamily: 'monospace',
      }).setDepth(11)

      const desc = (def.description ?? '').slice(0, 48) + ((def.description?.length ?? 0) > 48 ? '…' : '')
      const descTxt = this.add.text(px + 6, py + 38, desc, {
        fontSize: '7px', color: PALETTE.textDim, fontFamily: 'monospace',
        wordWrap: { width: CARD_W - 12 },
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
      hit.on('pointerdown', (p) => { if (!p.rightButtonDown()) this._selectItem(def, 'room') })

      this._paletteCards.push({ def, kind: 'room', cg, px, py, CARD_W, CARD_H, catColor })
      this._paletteObjects.push(cg, iconG, nameTxt, sizeTxt, descTxt, hit)
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

      const costStr   = def.essenceCostToPlace > 0 ? `${def.essenceCostToPlace} ess  ·  ${def.upkeepCost ?? 0}/day` : 'FREE'
      const costColor = def.essenceCostToPlace > 0 ? PALETTE.textCyan : PALETTE.textGreen
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

    const TRAP_COLOR = {
      spike_trap: 0xcc4422, pitfall_trap: 0x885533,
      arrow_trap: 0xddaa44, patience_trap: 0xaa66cc,
      speed_trap: 0x44ccaa, default: 0x888888,
    }

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

      const costStr = `${def.essenceCostToPlace ?? 0} ess  ·  ${def.upkeepCost ?? 0}/day  ·  ${def.baseDamage} dmg`
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

  // ── Bottom upkeep bar ─────────────────────────────────────────────────────

  _buildBottomBar(W, H) {
    const by = H - BOTTOM_H
    const g  = this.add.graphics().setDepth(10)

    glowPanel(g, 0, by, W, BOTTOM_H, {
      fill: PALETTE.panelBg, border: PALETTE.panelBorder, glow: PALETTE.accent,
    })

    // Top border highlight
    g.lineStyle(1, PALETTE.accent, 0.5)
    g.beginPath(); g.moveTo(0, by); g.lineTo(W, by); g.strokePath()

    // Upkeep label — far left, sitting under the rooms palette.
    this.add.text(16, by + 10, 'NECROTIC UPKEEP', {
      fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
    }).setDepth(11)

    // Upkeep bar — far left, width capped to fit under the palette.
    const barX = 16
    const barY = by + 24
    const barW = PANEL_W - 32
    const barH = 12

    this._upkeepBar = makeBar(this, barX, barY, barW, barH, {
      fillColor: PALETTE.essenceFill,
      bgColor:   PALETTE.essenceBg,
      depth:     11,
    })

    // Bolt icon after bar
    this.add.text(barX + barW + 8, barY, '⚡', {
      fontSize: '12px', color: PALETTE.textAccent, fontFamily: 'monospace',
    }).setOrigin(0, 0.5).setDepth(11)

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
      'WASD / drag to scroll  ·  scroll to zoom  ·  R = rotate room / ESC to cancel  ·  left-click room to pick up  ·  right-click to remove  ·  Ctrl+Z to undo  ·  HALLS tab: left=draw  right=erase',
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
      return
    }

    this._selected = def
    this._selectedKind = kind
    const card = this._paletteCards.find(c => c.def === def)
    if (card) this._resetCard(card.cg, card.px, card.py, card.CARD_W, card.CARD_H, card.catColor, true)
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
        // Auto-snap: if a doorway on this room aligns with an existing
        // room's facing doorway, the preview jumps to the snapped slot.
        const snap = this._dungeonGrid.findSnap(rotDef, tx, ty)
        if (snap) { tx = snap.gridX; ty = snap.gridY }
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

    this.input.on('pointerdown', (p) => {
      if (p.middleButtonDown()) return

      if (p.rightButtonDown()) {
        if (!this._selected) this._tryRemoveRoom(p, cam)
        return
      }

      if (!this._selected) {
        this._tryPickupRoom(p, cam)
        return
      }
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
    this.input.keyboard.on('keydown-ESC', () => this._cancelSelection())
    this.input.keyboard.on('keydown-Z',   (e) => {
      if (e.ctrlKey || e.metaKey) this._undoLastPlacement()
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
      : this._dungeonGrid.validatePlacement(rotDef, placeTx, placeTy)
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

      // Door markers — every doorway is widened to 2 tiles in DungeonGrid
      // (extra door slid toward whichever side has more wall space). Mirror
      // that rule here so the preview shows the actual 2-tile extent rather
      // than a single dot.
      this._preview.fillStyle(color, 0.9)
      const rw = rotDef.width, rh = rotDef.height
      for (const cp of rotDef.connectionPoints ?? []) {
        const onTopOrBot = (cp.y === 0 || cp.y === rh - 1)
        const onLftOrRgt = (cp.x === 0 || cp.x === rw - 1)
        let ddx = 0, ddy = 0
        if (onTopOrBot && !onLftOrRgt) {
          ddx = (((rw - 1) - cp.x) >= cp.x) ? 1 : -1
        } else if (onLftOrRgt && !onTopOrBot) {
          ddy = (((rh - 1) - cp.y) >= cp.y) ? 1 : -1
        }
        const cx0 = (placeTx + cp.x) * TS + TS / 2
        const cy0 = (placeTy + cp.y) * TS + TS / 2
        if (ddx !== 0) {
          const minX = Math.min(cx0, cx0 + ddx * TS)
          this._preview.fillRect(minX - 3, cy0 - 3, TS + 6, 6)
        } else if (ddy !== 0) {
          const minY = Math.min(cy0, cy0 + ddy * TS)
          this._preview.fillRect(cx0 - 3, minY - 3, 6, TS + 6)
        } else {
          // Corner cp (skipped by widener) — fall back to a single dot.
          this._preview.fillRect(cx0 - 3, cy0 - 3, 6, 6)
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

  _validateMinionPlacement(def, tx, ty) {
    const violations = []
    const tile = this._dungeonGrid.getTileType(tx, ty)
    if (tile !== TILE.FLOOR && tile !== TILE.BOSS_FLOOR) {
      violations.push('Must place on a room floor')
    }
    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room) {
      if (violations.length === 0) violations.push('Not inside any room')
    } else {
      const isBarracksRoom = room.definitionId === 'starter_barracks' || room.definitionId === 'crypt'
      if (!isBarracksRoom &&
          !this._dungeonGrid.hasBarracksWithinDistance(room.instanceId, Balance.MINION_BARRACKS_DISTANCE)) {
        violations.push(`Need barracks within ${Balance.MINION_BARRACKS_DISTANCE} rooms`)
      }
    }
    if ((def.essenceCostToPlace ?? 0) > this._gameState.player.soulEssence) {
      violations.push('Insufficient essence')
    }
    return { valid: violations.length === 0, violations }
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
    if ((def.essenceCostToPlace ?? 0) > this._gameState.player.soulEssence) {
      violations.push('Insufficient essence')
    }
    return { valid: violations.length === 0, violations }
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
    const result  = this._dungeonGrid.validatePlacement(rotDef, placeTx, placeTy)
    if (!result.valid) {
      this._showPlacementError(result.violations[0] ?? 'Invalid placement')
      return
    }

    // Phase 6e: archetype roomCostMultiplier (Tyrant 2×, Architect 0.75×)
    const arch = this._gameState.player?.archetypeModifiers
    const roomMul = arch?.roomCostMultiplier ?? 1
    const cost = Math.round((def.essenceCostToPlace ?? 0) * roomMul)
    if (cost > 0) {
      if (this._gameState.player.soulEssence < cost) {
        this._showPlacementError(`Need ${cost} essence (you have ${this._gameState.player.soulEssence})`)
        return
      }
      this._gameState.player.soulEssence -= cost
    }

    const room = this._dungeonGrid.placeRoom(rotDef, placeTx, placeTy)
    if (room) {
      this._lastPlaced = { kind: 'room', entity: room, essenceCost: cost }
      const max = def.placementRules?.maxPerDungeon
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

    const cost = def.essenceCostToPlace ?? 0
    if (cost > 0) this._gameState.player.soulEssence -= cost

    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    const minion = createMinion(def, { x: tx, y: ty }, room?.instanceId ?? null)

    // Phase 6e: apply archetype-gated stat multiplier (e.g. Tyrant 2×, Architect 0.85×)
    const arch = this._gameState.player?.archetypeModifiers
    const mul  = arch?.minionStatMultiplier ?? 1
    if (mul !== 1) {
      minion.stats.attack    = Math.round(minion.stats.attack * mul)
      minion.stats.defense   = Math.round(minion.stats.defense * mul)
      minion.resources.maxHp = Math.round(minion.resources.maxHp * mul)
      minion.resources.hp    = minion.resources.maxHp
    }

    // Phase 7b: auto-promote to mini-boss when placed in a treasure room
    if (room?.definitionId === 'treasure_room') {
      minion.isMiniBoss = true
      minion.stats.attack    = Math.round(minion.stats.attack * Balance.MINIBOSS_ATTACK_MULT)
      minion.resources.maxHp = Math.round(minion.resources.maxHp * Balance.MINIBOSS_HP_MULT)
      minion.resources.hp    = minion.resources.maxHp
      EventBus.emit('MINIBOSS_PROMOTED', { minion, room })
    }

    this._gameState.minions.push(minion)
    this._lastPlaced = { kind: 'minion', entity: minion, essenceCost: cost }

    EventBus.emit('MINION_PLACED', { minion })
    this._refreshStats()
  }

  _confirmTrapPlacement(tx, ty) {
    const def = this._selected
    const result = this._validateTrapPlacement(def, tx, ty)
    if (!result.valid) {
      this._showPlacementError(result.violations[0] ?? 'Cannot place trap here')
      return
    }

    const cost = def.essenceCostToPlace ?? 0
    if (cost > 0) this._gameState.player.soulEssence -= cost

    const trap = createTrap(def, { x: tx, y: ty })
    this._gameState.dungeon.traps.push(trap)
    this._lastPlaced = { kind: 'trap', entity: trap, essenceCost: cost }

    EventBus.emit('TRAP_PLACED', { trap })
    this._refreshStats()
  }

  _tryRemoveRoom(p, cam) {
    // Use Phaser's getWorldPoint — accounts for camera-centre-anchored zoom.
    const wp = cam.getWorldPoint(p.x, p.y)
    const tx = Math.floor(wp.x / TS)
    const ty = Math.floor(wp.y / TS)

    // Trap first (single-tile, most specific)
    const trapAtTile = (this._gameState.dungeon.traps ?? []).find(
      t => t.tileX === tx && t.tileY === ty
    )
    if (trapAtTile) {
      this._removeTrap(trapAtTile)
      return
    }

    // Then minion (single-tile)
    const minionAtTile = this._gameState.minions.find(
      m => m.tileX === tx && m.tileY === ty && m.aiState !== 'dead'
    )
    if (minionAtTile) {
      this._removeMinion(minionAtTile)
      return
    }

    const room = this._dungeonGrid.getRoomAtTile(tx, ty)
    if (!room || room.definitionId === 'boss_chamber') return

    // 50% essence refund on removal
    const allRooms = this.cache.json.get('rooms') ?? []
    const def = allRooms.find(d => d.id === room.definitionId)
    const refund = Math.floor((def?.essenceCostToPlace ?? 0) * 0.5)
    if (refund > 0) this._gameState.player.soulEssence += refund

    if (this._lastPlaced?.entity?.instanceId === room.instanceId) {
      this._lastPlaced = null
    }

    this._dungeonGrid.removeRoom(room.instanceId)
    this._refreshStats()
  }

  _removeTrap(trap) {
    const allTraps = this.cache.json.get('trapTypes') ?? []
    const def    = allTraps.find(d => d.id === trap.definitionId)
    const refund = Math.floor((def?.essenceCostToPlace ?? 0) * 0.5)
    if (refund > 0) this._gameState.player.soulEssence += refund

    if (this._lastPlaced?.entity?.instanceId === trap.instanceId) {
      this._lastPlaced = null
    }
    const idx = this._gameState.dungeon.traps.findIndex(t => t.instanceId === trap.instanceId)
    if (idx >= 0) this._gameState.dungeon.traps.splice(idx, 1)
    EventBus.emit('TRAP_REMOVED', { trap })
    this._refreshStats()
  }

  _removeMinion(minion) {
    const allMinions = this.cache.json.get('minionTypes') ?? []
    const def    = allMinions.find(d => d.id === minion.definitionId)
    // Full 100% essence refund — minions are still in the planning phase, so
    // there's no penalty for swapping them out before the day starts.
    const refund = def?.essenceCostToPlace ?? 0
    if (refund > 0) this._gameState.player.soulEssence += refund

    if (this._lastPlaced?.entity?.instanceId === minion.instanceId) {
      this._lastPlaced = null
    }
    const idx = this._gameState.minions.findIndex(m => m.instanceId === minion.instanceId)
    if (idx >= 0) this._gameState.minions.splice(idx, 1)
    EventBus.emit('MINION_REMOVED', { minion })
    this._refreshStats()
  }

  _undoLastPlacement() {
    if (!this._lastPlaced) return
    const { kind, entity, essenceCost } = this._lastPlaced
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
    }
    this._gameState.player.soulEssence += essenceCost
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
    return { ...def, width: w, height: h, connectionPoints }
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
    const cost = Math.round((def.essenceCostToPlace ?? 0) * roomMul)
    if (cost > 0) this._gameState.player.soulEssence += cost

    if (this._lastPlaced?.entity?.instanceId === room.instanceId) this._lastPlaced = null

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
    this._selected = null
    this._selectedKind = null
    this._rotation = 0
    this._paletteCards.forEach(c => this._resetCard(c.cg, c.px, c.py, c.CARD_W, c.CARD_H, c.catColor, false))
    this._clearPreview()
  }

  // ── Begin Day ─────────────────────────────────────────────────────────────

  _beginDay() {
    this._cancelSelection()

    const dungeon = this._gameState.dungeon
    const entry = dungeon.rooms.find(r => r.definitionId === 'entry_hall')
    if (!entry) {
      this._showPlacementError('You must place an Entry Hall before starting the day')
      return
    }

    // Doorway-snap placement enforces room↔room links at drop time, so by
    // the time we reach Begin Day every placed room is reachable from the
    // boss via the doorway graph. Defensively re-check anyway in case of
    // a future code path that bypasses validatePlacement.
    const disconnected = dungeon.rooms.filter(r => {
      if (r.definitionId === 'boss_chamber') return false
      return !Number.isFinite(this._dungeonGrid.getDepthFromBoss(r.instanceId))
    })
    if (disconnected.length > 0) {
      const names = disconnected.slice(0, 2).map(r => r.definitionId.replace(/_/g, ' ')).join(', ')
      const extra = disconnected.length > 2 ? ` +${disconnected.length - 2} more` : ''
      this._showPlacementError(`Disconnected: ${names}${extra} — re-place via doorway alignment`)
      return
    }

    this._gameState.meta.phase = 'day'
    SaveSystem.save(this._gameState)
    EventBus.emit('NIGHT_PHASE_ENDED')
    this.scene.start('DayPhase', { gameState: this._gameState })
  }

  // ── Deactivation notice ────────────────────────────────────────────────────

  _showDeactivationNotice(deactivated) {
    const { width: W } = this.scale
    const names = deactivated.map(r => r.definitionId.replace(/_/g, ' ')).join(', ')
    const msg   = `⚠   Essence shortage — shut off: ${names}`

    const bg = this.add.graphics().setDepth(30)
    const tw = Math.min(W - PANEL_W - 32, 640)
    const th = 36
    const tx = PANEL_W + 16
    const ty = 8
    bg.fillStyle(0x220a06, 0.92)
    bg.fillRect(tx, ty, tw, th)
    bg.lineStyle(1, 0xcc3322, 0.8)
    bg.strokeRect(tx, ty, tw, th)

    const txt = this.add.text(tx + tw / 2, ty + th / 2, msg, {
      fontSize: '10px', color: PALETTE.textRed, fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(31)

    // Fade out after 4 seconds
    this.time.delayedCall(4000, () => {
      this.tweens.add({
        targets: [bg, txt], alpha: 0, duration: 600,
        onComplete: () => { bg.destroy(); txt.destroy() },
      })
    })
  }

  // Show a transient banner when a placement attempt fails, with the
  // specific reason ("Out of bounds", "Need 25 essence", "Must be 3 rooms
  // from boss", etc.) so the player knows why their click did nothing.
  _showPlacementError(message) {
    // If a previous error banner is still on screen, clear it first
    if (this._placementErrorObjs?.length) {
      for (const o of this._placementErrorObjs) o?.destroy?.()
    }
    this._placementErrorTimer?.remove(false)

    const W = this.uiW
    const tw = Math.min(W - PANEL_W - 32, 480)
    const th = 32
    const tx = PANEL_W + (W - PANEL_W - tw) / 2
    const ty = 12

    const bg = this.add.graphics().setDepth(30)
    glowPanel(bg, tx, ty, tw, th, {
      fill: 0x2a1004, border: 0xffaa44, glow: 0xcc6600,
    })
    const txt = this.add.text(tx + tw / 2, ty + th / 2, `⚠   ${message}`, {
      fontSize: '11px', color: '#ffd99a', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(31)
    this._placementErrorObjs = [bg, txt]

    this._placementErrorTimer = this.time.delayedCall(2200, () => {
      this.tweens.add({
        targets: this._placementErrorObjs, alpha: 0, duration: 400,
        onComplete: () => {
          for (const o of this._placementErrorObjs ?? []) o?.destroy?.()
          this._placementErrorObjs = []
        },
      })
    })
  }
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
    case 'loot_picked_up':        return 'Triggers on loot pickup'
    case 'ally_healed_nearby':    return 'Triggers on ally heal'
    case 'second_footstep':       return 'Triggers on follower'
    case 'adventurer_was_here_before': return 'Triggers on revisit'
    default: return trig
  }
}

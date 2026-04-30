// TilesetEditor — sprite library + theme builder.
//
// Three panels:
//
//   LEFT   (Sprite Library)  — drop PNGs (32 / 64 / 128 px), each tile gets a
//                              scale-vs-span toggle and src-size selector.
//                              Click a sprite to make it the "active" pick.
//   MIDDLE (Slot Grid)       — every theme slot (1 floor + 10 wall + 24 door
//                              = 35 slots) listed in collapsible groups.
//                              Click "+" on a slot to append the active
//                              sprite as a variant. Click a variant chip to
//                              remove it.
//   RIGHT  (Live Preview)    — fixed sample room with one of every slot kind
//                              rendered using the active theme. "Reroll"
//                              re-randomizes variants.
//
// Persistence:
//   Sprites live at         assets/themes/sprites/<id>.png
//   Theme + sprite metadata assets/themes/manifest.json
//
// On SAVE: writes new PNGs and the manifest via FsHandle. The first save in
// a session prompts the user to pick the Quest-Failed/ project folder; we
// cache the handle in IndexedDB across reloads (browser still requires a
// click-grant for write permission per session).

import { applyUiCamera } from '../ui/UIKit.js'
import { FsHandle }      from '../systems/FsHandle.js'
import {
  ThemeManager, ALL_SLOTS, FLOOR_SLOT, WALL_SLOTS, DOOR_SLOTS,
  slotLabel, slotGroups, makeSpriteId, spritePath, spriteCoverage,
  VALID_SRC_SIZES, VALID_COVERAGES,
} from '../systems/ThemeManager.js'

// ── Design space ───────────────────────────────────────────────────────────
const DESIGN_W = 1280
const DESIGN_H = 800

// ── Palette (same blue/purple language as the rest of the game) ────────────
const COL_BG          = 0x0a0514
const COL_PANEL       = 0x140a26
const COL_PANEL_HI    = 0x1d0e36
const COL_BORDER      = 0x3a1f5a
const COL_BORDER_HI   = 0x9b32d4
const COL_TEXT        = '#d8c8e8'
const COL_TEXT_DIM    = '#7a6e8e'
const COL_TEXT_HI     = '#ffd0a0'
const COL_TEXT_WARN   = '#ff8870'
const COL_ACCENT      = 0x9b32d4
const COL_BTN         = 0x2a1450
const COL_BTN_HOVER   = 0x4a2a80
const COL_DROP_ACTIVE = 0x4f2090

// ── Layout zones ───────────────────────────────────────────────────────────
const TOP_BAR_H    = 50
const BOT_BAR_H    = 50
const PANEL_Y      = TOP_BAR_H + 8
const PANEL_H      = DESIGN_H - TOP_BAR_H - BOT_BAR_H - 16

const LIB_X        = 10
const LIB_W        = 350
const SLOTS_X      = LIB_X + LIB_W + 10
const SLOTS_W      = 410
const PREVIEW_X    = SLOTS_X + SLOTS_W + 10
const PREVIEW_W    = DESIGN_W - PREVIEW_X - 10

// Sprite card geometry
const CARD_W = LIB_W - 16
const CARD_H = 70
const CARD_GAP = 8
const THUMB_SIZE = 52

// Slot row geometry
const ROW_H = 42
const SLOT_LABEL_W = 130
const CHIP_SIZE = 32
const CHIP_GAP = 4

// Preview geometry (centered inside the preview panel)
const PREV_TILE = 32
const PREV_COLS = 12
const PREV_ROWS = 9
const PREV_PX_W = PREV_COLS * PREV_TILE
const PREV_PX_H = PREV_ROWS * PREV_TILE

// Module-level draft state — preserves uploaded-but-unsaved PNG bytes
// across scene transitions. Without this, dropping a sprite + clicking
// ROOM EDITOR + coming back would lose the bytes (the metadata in
// ThemeManager would survive but the PNG payload — needed by SAVE TO
// DISK — would be gone). Cleared on successful save and on page reload.
const _pendingPngs = new Map()

// Tracks whether _initialLoad's disk re-read has run already this page
// session. Once true, re-entering the editor SKIPS the manifest re-read
// so any unsaved drops the user made aren't clobbered by the on-disk
// state. Reload the page to discard drafts and re-pull from disk.
let _diskLoaded = false

// Sample room layout for the preview (PREV_COLS × PREV_ROWS).
// 'F' = floor, 'W' = wall (autotile resolves variant from neighbours),
// 'C' = wall cap row, '.' = void (skipped), 'D' = door cell (uses 2x2 group).
// We hand-craft this so every slot appears at least once.
const PREVIEW_LAYOUT = [
  '............',
  '.CCCCCCCCCC.',
  '.WFFFFFFFFW.',
  '.WFFFFFFFFW.',
  '.WFFDDFFFFW.',
  '.WFFDDFFFFW.',
  '.WFFFFFFFFW.',
  '.WWWWWWWWWW.',
  '............',
]

// Map a (col, row) in the sample room to a slot key. Returns null for void.
function previewSlotAt(col, row) {
  const ch = PREVIEW_LAYOUT[row]?.[col]
  if (!ch || ch === '.') return null
  if (ch === 'F') return FLOOR_SLOT
  if (ch === 'C') {
    // Cap row sits above the top wall row (which is row+1). Pick corner caps
    // at the ends and regular cap in the middle.
    if (col === 1)               return 'wall_corner_tl'
    if (col === PREV_COLS - 2)   return 'wall_corner_tr'
    return 'wall_cap'
  }
  if (ch === 'W') {
    // Top wall row (just below cap)
    if (row === 2 && col >= 1 && col <= PREV_COLS - 2) return 'wall'
    // Bottom wall row
    if (row === PREV_ROWS - 2) {
      if (col === 1)              return 'wall_corner_bl'
      if (col === PREV_COLS - 2)  return 'wall_corner_br'
      return 'wall_bottom'
    }
    // Side walls
    if (col === 1)              return 'wall_left'
    if (col === PREV_COLS - 2)  return 'wall_right'
    return 'wall'
  }
  if (ch === 'D') {
    // 2×2 door block in the floor; vertical orientation.  Anchor (top-left)
    // cell renders the door art; we identify the four cells by (col, row)
    // offset within the block (cols 4-5, rows 4-5).
    const dx = col - 4
    const dy = row - 4
    const sub = ['tl', 'tr', 'bl', 'br'][dy * 2 + dx]
    return `door_closed_v_${sub}`
  }
  return null
}

// Pick the cap row's column for door overlay above the door. We don't bother
// rendering a door overlay inside the preview's wall ring — door cells in
// PREVIEW_LAYOUT are already where the door would visually sit on the floor.

export class TilesetEditor extends Phaser.Scene {
  constructor() { super('TilesetEditor') }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  create() {
    // Defensive camera setup: apply once now, again on the next tick, and
    // on every scale resize. Phaser sometimes settles canvas size a tick
    // after create() (font load, scrollbar appearance, post-scene-start
    // layout shifts). A single applyUiCamera call at the wrong moment
    // computes a tiny zoom and the editor renders effectively invisible.
    applyUiCamera(this, DESIGN_W, DESIGN_H)
    this.time.delayedCall(0, () => this._reapplyCamera())
    this.scale.on('resize', this._reapplyCamera, this)
    this.events.once('shutdown', () => {
      this.scale.off('resize', this._reapplyCamera, this)
      this._teardownDom()
    })

    // Active state
    this._activeSpriteId = null
    this._activeThemeName = ThemeManager.activeTheme()
    // Reuse the module-level pendingPngs map so dropped-but-unsaved bytes
    // survive scene transitions. Cleared on successful save (in _save).
    this._pendingPngs = _pendingPngs
    // Set of sprites that have been registered as Phaser textures this
    // session (so we can safely create Image() refs to them in preview).
    this._loadedTextureKeys = new Set()

    this._gBg = this.add.graphics().setDepth(0)
    this._gPanels = this.add.graphics().setDepth(1)
    this._cTop      = this.add.container(0, 0).setDepth(2)
    this._cLibrary  = this.add.container(0, 0).setDepth(3)
    this._cSlots    = this.add.container(0, 0).setDepth(3)
    this._cPreview  = this.add.container(0, 0).setDepth(3)
    this._cBottom   = this.add.container(0, 0).setDepth(4)
    this._cToast    = this.add.container(0, 0).setDepth(20)

    this._libScroll = 0
    this._slotScroll = 0
    this._libCardsBuilt = false

    this._drawBackground()
    this._buildTopBar()
    this._buildLibraryPanel()
    this._buildSlotsPanel()
    this._buildPreviewPanel()
    this._buildBottomBar()

    // Drag-drop file upload — listen at document level so users can drop
    // anywhere on the editor.
    this._setupDomDropTarget()

    // Scene-level wheel routing — replaces per-panel scrollHit rectangles
    // which would otherwise block pointer-down events from reaching
    // underlying buttons.
    this.input.on('wheel', this._onWheel, this)
    this.events.once('shutdown', () => this.input.off('wheel', this._onWheel, this))

    // Try to silently restore project root (no prompt) so reload sessions
    // can save without re-picking. If denied, save will prompt later.
    FsHandle.tryRestoreRoot().catch(() => {})

    // Initial async load of manifest from disk if available, then redraw.
    this._initialLoad()
  }

  _onWheel(pointer, _gameObjects, _dx, dy) {
    const x = pointer.worldX, y = pointer.worldY
    const dyy = dy || 0
    if (this._libCardsArea && _inAreaTE(x, y, this._libCardsArea)) {
      this._libScroll = Math.max(0, this._libScroll + dyy)
      this._applyLibraryScroll()
    } else if (this._slotsArea && _inAreaTE(x, y, this._slotsArea)) {
      this._slotScroll = Math.max(0, this._slotScroll + dyy)
      this._populateSlotRows()
    }
  }

  _reapplyCamera() {
    applyUiCamera(this, DESIGN_W, DESIGN_H)
  }

  // ── Initial load ─────────────────────────────────────────────────────────
  async _initialLoad() {
    // Re-read manifest from disk only on the FIRST editor entry per page
    // session. Subsequent entries (e.g. after navigating to ROOM EDITOR
    // and coming back) keep the in-memory ThemeManager state so any
    // unsaved drops the user made aren't clobbered. Reload the page to
    // discard drafts and resync from disk.
    if (!_diskLoaded && FsHandle.hasRoot()) {
      _diskLoaded = true
      const m = await FsHandle.readJson('assets/themes/manifest.json')
      if (m) {
        ThemeManager.load(m)
        this._activeThemeName = ThemeManager.activeTheme()
        // For each sprite already on disk, attempt to load it as a texture
        // so the preview can render. We use Phaser's image loader.
        await this._registerExistingSpriteTextures()
      }
    }
    this._refreshAll()
  }

  async _registerExistingSpriteTextures() {
    const sprites = ThemeManager.listSprites()
    const promises = sprites.map(s => this._loadSpriteTextureFromDisk(s.id, s.file))
    await Promise.all(promises)
  }

  async _loadSpriteTextureFromDisk(id, file) {
    const key = _textureKey(id)
    // Skip if already in cache (Preload registered it on game boot, or a
    // previous editor visit loaded it). Re-loading via remove + addBase64
    // destroys the existing WebGLTexture mid-render, which causes the
    // "Cannot read properties of null (reading 'isGLTexture')" crash and
    // leaves panels visually empty after cross-nav.
    if (this.textures.exists(key)) return
    try {
      const blob = await FsHandle.readFile(file)
      if (!blob) return
      const dataUrl = await _blobToDataUrl(blob)
      await this._addTextureFromDataUrl(key, dataUrl)
    } catch (_) { /* ignore — preview will fall back to placeholder */ }
  }

  // ── Background + panels ──────────────────────────────────────────────────
  _drawBackground() {
    this._gBg.clear()
    this._gBg.fillStyle(COL_BG, 1).fillRect(0, 0, DESIGN_W, DESIGN_H)

    this._gPanels.clear()
    // Top bar
    _panel(this._gPanels, 0, 0, DESIGN_W, TOP_BAR_H)
    // Three main panels
    _panel(this._gPanels, LIB_X,     PANEL_Y, LIB_W,     PANEL_H)
    _panel(this._gPanels, SLOTS_X,   PANEL_Y, SLOTS_W,   PANEL_H)
    _panel(this._gPanels, PREVIEW_X, PANEL_Y, PREVIEW_W, PANEL_H)
    // Bottom bar
    _panel(this._gPanels, 0, DESIGN_H - BOT_BAR_H, DESIGN_W, BOT_BAR_H)
  }

  // ── Top bar: title, theme switcher, theme actions ────────────────────────
  _buildTopBar() {
    this._cTop.removeAll(true)
    this._cTop.add(_text(this, 12, TOP_BAR_H / 2, 'TILESET EDITOR', {
      fontSize: '20px', color: COL_TEXT_HI, fontStyle: 'bold',
    }).setOrigin(0, 0.5))

    // Theme switcher: text label + dropdown
    const themeNames = ThemeManager.listThemes()
    const labelX = 240
    this._cTop.add(_text(this, labelX, TOP_BAR_H / 2, 'Theme:', {
      fontSize: '14px', color: COL_TEXT_DIM,
    }).setOrigin(0, 0.5))

    const ddX = labelX + 60
    const ddW = 220
    const ddH = 30
    const ddY = (TOP_BAR_H - ddH) / 2
    const ddLabel = this._activeThemeName || '(none)'

    const ddBg = this.add.rectangle(ddX, ddY, ddW, ddH, COL_BTN, 1).setOrigin(0, 0)
      .setStrokeStyle(1, COL_BORDER, 1).setInteractive({ useHandCursor: true })
    const ddText = _text(this, ddX + 8, ddY + ddH / 2, ddLabel + '  ▾', {
      fontSize: '14px', color: themeNames.length ? COL_TEXT : COL_TEXT_DIM,
    }).setOrigin(0, 0.5)
    ddBg.on('pointerover', () => ddBg.setFillStyle(COL_BTN_HOVER, 1))
    ddBg.on('pointerout',  () => ddBg.setFillStyle(COL_BTN, 1))
    ddBg.on('pointerdown', () => this._openThemeDropdown(ddX, ddY + ddH))
    this._cTop.add([ddBg, ddText])

    // Theme action buttons
    let bx = ddX + ddW + 10
    const mkBtn = (label, w, onClick) => {
      const b = this._mkButton(bx, ddY, w, ddH, label, onClick)
      this._cTop.add(b.parts)
      bx += w + 6
    }
    mkBtn('+ NEW',   80,  () => this._promptNewTheme())
    mkBtn('RENAME',  80,  () => this._promptRenameTheme())
    mkBtn('DELETE',  80,  () => this._promptDeleteTheme())

    // Project root status indicator + reset button (right side)
    const rootName = FsHandle.rootName()
    if (rootName) {
      const resetW = 70, resetH = 22
      const resetX = DESIGN_W - 12 - resetW
      const resetY = (TOP_BAR_H - resetH) / 2
      const resetBtn = this._mkButton(resetX, resetY, resetW, resetH, 'RESET', async () => {
        if (!window.confirm(`Forget the saved folder "${rootName}"? You'll be prompted to pick a new one on the next save.`)) return
        await FsHandle.clear()
        this._buildTopBar()
        this._toast('Folder cleared. Click SAVE to pick a new one.')
      }, 0x6a0008, 0x9a1010)
      this._cTop.add(resetBtn.parts)
      this._cTop.add(_text(this, resetX - 8, TOP_BAR_H / 2, `Project: ${rootName}`, {
        fontSize: '12px', color: COL_TEXT_DIM,
      }).setOrigin(1, 0.5))
    } else {
      const text = FsHandle.isSupported() ? 'No folder selected (will prompt on save)' : 'FS Access API unavailable'
      this._cTop.add(_text(this, DESIGN_W - 12, TOP_BAR_H / 2, text, {
        fontSize: '12px', color: COL_TEXT_WARN,
      }).setOrigin(1, 0.5))
    }
  }

  _openThemeDropdown(x, y) {
    if (this._ddOverlay) this._ddOverlay.destroy()
    const themes = ThemeManager.listThemes()
    const itemH  = 26
    const w      = 220
    const h      = Math.max(itemH, themes.length * itemH)
    this._ddOverlay = this.add.container(0, 0).setDepth(50)
    const blocker = this.add.rectangle(0, 0, DESIGN_W, DESIGN_H, 0x000000, 0.001)
      .setOrigin(0, 0).setInteractive()
    blocker.on('pointerdown', () => { this._ddOverlay?.destroy(); this._ddOverlay = null })
    this._ddOverlay.add(blocker)
    const bg = this.add.rectangle(x, y, w, h, COL_PANEL, 0.98).setOrigin(0, 0)
      .setStrokeStyle(1, COL_BORDER_HI, 1)
    this._ddOverlay.add(bg)
    if (themes.length === 0) {
      this._ddOverlay.add(_text(this, x + 8, y + itemH / 2, '(no themes — click +NEW)', {
        fontSize: '12px', color: COL_TEXT_DIM,
      }).setOrigin(0, 0.5))
    }
    themes.forEach((name, i) => {
      const ry = y + i * itemH
      const row = this.add.rectangle(x, ry, w, itemH, COL_PANEL, 0).setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
      row.on('pointerover', () => row.setFillStyle(COL_BTN_HOVER, 1))
      row.on('pointerout',  () => row.setFillStyle(COL_PANEL, 0))
      row.on('pointerdown', () => {
        this._activeThemeName = name
        ThemeManager.setActive(name)
        this._ddOverlay?.destroy(); this._ddOverlay = null
        this._refreshAll()
      })
      const lbl = _text(this, x + 10, ry + itemH / 2, name, { fontSize: '13px', color: COL_TEXT }).setOrigin(0, 0.5)
      this._ddOverlay.add([row, lbl])
    })
  }

  // ── Library panel (left) ─────────────────────────────────────────────────
  _buildLibraryPanel() {
    this._cLibrary.removeAll(true)
    let y = PANEL_Y + 8

    // Drop zone
    const dzH = 60
    const dz = this.add.rectangle(LIB_X + 8, y, LIB_W - 16, dzH, COL_PANEL_HI, 1).setOrigin(0, 0)
      .setStrokeStyle(2, COL_BORDER, 1).setInteractive({ useHandCursor: true })
    dz.on('pointerdown', () => this._openFilePicker())
    const dzText = _text(this, LIB_X + LIB_W / 2, y + dzH / 2,
      'Drop PNGs here or click to browse\n(32 / 64 / 128 px tiles)', {
        fontSize: '12px', color: COL_TEXT_DIM, align: 'center',
      }).setOrigin(0.5)
    this._cLibrary.add([dz, dzText])
    this._libDropZone = dz
    y += dzH + 8

    // Active sprite indicator
    const activeId = this._activeSpriteId
    const activeLabel = activeId
      ? `Active: ${activeId}  (click slot's [+] to add)`
      : 'Active: none  (click a sprite to pick)'
    this._cLibrary.add(_text(this, LIB_X + 12, y + 8, activeLabel, {
      fontSize: '11px', color: activeId ? COL_TEXT_HI : COL_TEXT_DIM,
    }).setOrigin(0, 0.5))
    y += 18

    // Sprite cards (scrollable)
    const cardsTop = y
    const cardsBottom = PANEL_Y + PANEL_H - 8
    const cardsAreaH = cardsBottom - cardsTop

    // Mask the cards area so scroll clips correctly
    const maskRect = this.add.graphics().setVisible(false)
      .fillStyle(0xffffff, 1).fillRect(LIB_X, cardsTop, LIB_W, cardsAreaH)
    const mask = maskRect.createGeometryMask()

    const cardsContainer = this.add.container(0, 0)
    this._cLibrary.add(cardsContainer)
    cardsContainer.setMask(mask)
    this._libCardsContainer = cardsContainer
    this._libCardsArea = { x: LIB_X, y: cardsTop, w: LIB_W, h: cardsAreaH }

    this._populateLibraryCards()
    // Scroll wheel handled by the scene-level _onWheel — see create().
  }

  _populateLibraryCards() {
    if (!this._libCardsContainer) return
    this._libCardsContainer.removeAll(true)
    const sprites = ThemeManager.listSprites()
    sprites.forEach((s, i) => {
      const cy = this._libCardsArea.y + i * (CARD_H + CARD_GAP) - this._libScroll
      const cx = this._libCardsArea.x + 8
      this._libCardsContainer.add(this._buildSpriteCard(s, cx, cy))
    })
  }

  _applyLibraryScroll() {
    this._populateLibraryCards()
  }

  _buildSpriteCard(sprite, x, y) {
    const isActive = sprite.id === this._activeSpriteId
    const items = []

    const bg = this.add.rectangle(x, y, CARD_W, CARD_H, isActive ? COL_PANEL_HI : COL_PANEL, 1)
      .setOrigin(0, 0).setStrokeStyle(2, isActive ? COL_BORDER_HI : COL_BORDER, 1)
      .setInteractive({ useHandCursor: true })
    bg.on('pointerdown', () => {
      this._activeSpriteId = (this._activeSpriteId === sprite.id) ? null : sprite.id
      this._buildLibraryPanel()
    })
    items.push(bg)

    // Thumbnail
    const tx = x + 8
    const ty = y + (CARD_H - THUMB_SIZE) / 2
    const thumbBg = this.add.rectangle(tx, ty, THUMB_SIZE, THUMB_SIZE, 0x000000, 0.5)
      .setOrigin(0, 0).setStrokeStyle(1, COL_BORDER, 1)
    items.push(thumbBg)
    const texKey = _textureKey(sprite.id)
    if (this.textures.exists(texKey)) {
      const img = this.add.image(tx + THUMB_SIZE / 2, ty + THUMB_SIZE / 2, texKey).setOrigin(0.5)
      const s = this.textures.get(texKey).source[0]
      const scale = (THUMB_SIZE - 4) / Math.max(s.width || 32, s.height || 32)
      img.setScale(scale)
      items.push(img)
    } else {
      items.push(_text(this, tx + THUMB_SIZE / 2, ty + THUMB_SIZE / 2, '?', {
        fontSize: '20px', color: COL_TEXT_DIM,
      }).setOrigin(0.5))
    }

    // Name + size info
    const txx = tx + THUMB_SIZE + 8
    items.push(_text(this, txx, y + 10, sprite.id, {
      fontSize: '13px', color: COL_TEXT, fontStyle: 'bold',
    }).setOrigin(0, 0))

    // Src size selector
    items.push(_text(this, txx, y + 28, 'src:', { fontSize: '11px', color: COL_TEXT_DIM }).setOrigin(0, 0))
    let bx = txx + 28
    for (const sz of VALID_SRC_SIZES) {
      const active = sprite.srcSize === sz
      const btn = this.add.rectangle(bx, y + 27, 28, 16, active ? COL_BORDER_HI : COL_BTN, 1).setOrigin(0, 0)
        .setStrokeStyle(1, COL_BORDER, 1).setInteractive({ useHandCursor: true })
      btn.on('pointerdown', () => {
        ThemeManager.updateSprite(sprite.id, { srcSize: sz })
        this._buildLibraryPanel(); this._refreshPreview()
      })
      items.push(btn)
      items.push(_text(this, bx + 14, y + 35, String(sz), {
        fontSize: '10px', color: active ? '#000' : COL_TEXT,
      }).setOrigin(0.5))
      bx += 31
    }

    // Coverage (cells the sprite occupies when placed): 1×1 / 2×2 / 4×4.
    // Independent of the source PNG resolution. Defaults derived from the
    // legacy mode/srcSize pair when not explicitly set, via spriteCoverage().
    items.push(_text(this, txx, y + 47, 'size:', { fontSize: '11px', color: COL_TEXT_DIM }).setOrigin(0, 0))
    let bx2 = txx + 32
    const currentCov = spriteCoverage(sprite)
    for (const cov of VALID_COVERAGES) {
      const active = currentCov === cov
      const btnW = 30
      const btn = this.add.rectangle(bx2, y + 46, btnW, 16, active ? COL_BORDER_HI : COL_BTN, 1).setOrigin(0, 0)
        .setStrokeStyle(1, COL_BORDER, 1).setInteractive({ useHandCursor: true })
      btn.on('pointerdown', () => {
        // When the user picks coverage explicitly, we also align the legacy
        // mode field so saving keeps backward-compat. (Coverage 1 → scale;
        // 2 / 4 → span.)
        ThemeManager.updateSprite(sprite.id, {
          coverage: cov,
          mode: cov === 1 ? 'scale' : 'span',
        })
        this._buildLibraryPanel(); this._refreshPreview()
      })
      items.push(btn)
      items.push(_text(this, bx2 + btnW / 2, y + 54, `${cov}×${cov}`, {
        fontSize: '10px', color: active ? '#000' : COL_TEXT,
      }).setOrigin(0.5))
      bx2 += btnW + 4
    }

    // Delete button
    const delX = x + CARD_W - 24
    const del = this.add.rectangle(delX, y + 8, 18, 18, 0x6a0008, 1).setOrigin(0, 0)
      .setStrokeStyle(1, COL_BORDER, 1).setInteractive({ useHandCursor: true })
    del.on('pointerdown', (p, lx, ly, ev) => {
      ev?.stopPropagation?.()
      ThemeManager.removeSprite(sprite.id)
      this._pendingPngs.delete(sprite.id)
      if (this._activeSpriteId === sprite.id) this._activeSpriteId = null
      this._refreshAll()
    })
    items.push(del)
    items.push(_text(this, delX + 9, y + 17, '✕', {
      fontSize: '12px', color: '#fff', fontStyle: 'bold',
    }).setOrigin(0.5))

    return items
  }

  // ── Slots panel (middle) ─────────────────────────────────────────────────
  _buildSlotsPanel() {
    this._cSlots.removeAll(true)
    const headerY = PANEL_Y + 8
    this._cSlots.add(_text(this, SLOTS_X + 12, headerY, 'SLOTS', {
      fontSize: '14px', color: COL_TEXT_HI, fontStyle: 'bold',
    }).setOrigin(0, 0))
    this._cSlots.add(_text(this, SLOTS_X + SLOTS_W - 12, headerY,
      'Click a sprite at left, then click [+]', {
        fontSize: '11px', color: COL_TEXT_DIM,
      }).setOrigin(1, 0))

    const top = headerY + 22
    const bottom = PANEL_Y + PANEL_H - 8
    const areaH = bottom - top

    // Mask
    const maskGfx = this.add.graphics().setVisible(false)
      .fillStyle(0xffffff, 1).fillRect(SLOTS_X, top, SLOTS_W, areaH)
    const mask = maskGfx.createGeometryMask()

    const container = this.add.container(0, 0)
    this._cSlots.add(container)
    container.setMask(mask)
    this._slotsContainer = container
    this._slotsArea = { x: SLOTS_X, y: top, w: SLOTS_W, h: areaH }

    this._populateSlotRows()

    // Scroll wheel handled by the scene-level _onWheel — see create().
  }

  _populateSlotRows() {
    if (!this._slotsContainer) return
    this._slotsContainer.removeAll(true)
    const groups = slotGroups()
    let y = this._slotsArea.y - this._slotScroll
    const x = this._slotsArea.x + 8

    for (const [, group] of Object.entries(groups)) {
      // Group header
      this._slotsContainer.add(_text(this, x, y, group.label, {
        fontSize: '12px', color: COL_TEXT_HI, fontStyle: 'bold',
      }).setOrigin(0, 0))
      y += 18

      for (const slot of group.slots) {
        this._slotsContainer.add(this._buildSlotRow(slot, x, y))
        y += ROW_H
      }
      y += 6
    }
  }

  _buildSlotRow(slot, x, y) {
    const items = []
    const theme = this._activeThemeName ? ThemeManager.getTheme(this._activeThemeName) : null
    const variants = theme?.slots[slot] || []

    // Row bg
    const bg = this.add.rectangle(x, y, this._slotsArea.w - 16, ROW_H - 4, COL_PANEL_HI, 0.4)
      .setOrigin(0, 0).setStrokeStyle(1, COL_BORDER, 0.5)
    items.push(bg)

    // Label
    items.push(_text(this, x + 6, y + (ROW_H - 4) / 2, slotLabel(slot), {
      fontSize: '11px', color: COL_TEXT,
    }).setOrigin(0, 0.5))

    // Variant chips
    let cx = x + SLOT_LABEL_W
    for (const id of variants) {
      const chip = this._buildVariantChip(id, cx, y + 3, slot)
      items.push(...chip)
      cx += CHIP_SIZE + CHIP_GAP
    }

    // [+] button — always clickable; if nothing is selected to add, the
    // click surfaces a toast explaining what to do instead of silently
    // doing nothing. (Earlier version only attached the listener when
    // canAdd was true, which made the button look disabled but also gave
    // no feedback on real clicks → looked like the button was broken.)
    const canAdd = !!this._activeSpriteId && !!this._activeThemeName
    const plusBg = this.add.rectangle(cx, y + 3, CHIP_SIZE, CHIP_SIZE, canAdd ? COL_BTN : COL_PANEL, 1)
      .setOrigin(0, 0).setStrokeStyle(1, canAdd ? COL_BORDER_HI : COL_BORDER, 1)
      .setInteractive({ useHandCursor: true })
    plusBg.on('pointerover', () => plusBg.setFillStyle(canAdd ? COL_BTN_HOVER : COL_PANEL_HI, 1))
    plusBg.on('pointerout',  () => plusBg.setFillStyle(canAdd ? COL_BTN : COL_PANEL, 1))
    plusBg.on('pointerdown', () => {
      if (!this._activeThemeName) {
        this._toast('Create or pick a theme first (top bar)', true); return
      }
      if (!this._activeSpriteId) {
        this._toast('Click a sprite in the Library first', true); return
      }
      ThemeManager.addSlotVariant(this._activeThemeName, slot, this._activeSpriteId)
      this._populateSlotRows(); this._refreshPreview()
    })
    items.push(plusBg)
    items.push(_text(this, cx + CHIP_SIZE / 2, y + 3 + CHIP_SIZE / 2, '+', {
      fontSize: '18px', color: canAdd ? COL_TEXT_HI : COL_TEXT_DIM, fontStyle: 'bold',
    }).setOrigin(0.5))

    return items
  }

  _buildVariantChip(spriteId, x, y, slot) {
    const items = []
    const bg = this.add.rectangle(x, y, CHIP_SIZE, CHIP_SIZE, COL_PANEL, 1)
      .setOrigin(0, 0).setStrokeStyle(1, COL_BORDER_HI, 1)
      .setInteractive({ useHandCursor: true })
    bg.on('pointerdown', () => {
      ThemeManager.removeSlotVariant(this._activeThemeName, slot, spriteId)
      this._populateSlotRows(); this._refreshPreview()
    })
    items.push(bg)

    const tex = _textureKey(spriteId)
    if (this.textures.exists(tex)) {
      const img = this.add.image(x + CHIP_SIZE / 2, y + CHIP_SIZE / 2, tex).setOrigin(0.5)
      const s = this.textures.get(tex).source[0]
      const scale = (CHIP_SIZE - 4) / Math.max(s.width || 32, s.height || 32)
      img.setScale(scale)
      items.push(img)
    } else {
      items.push(_text(this, x + CHIP_SIZE / 2, y + CHIP_SIZE / 2, '?', {
        fontSize: '14px', color: COL_TEXT_DIM,
      }).setOrigin(0.5))
    }
    return items
  }

  // ── Preview panel (right) ────────────────────────────────────────────────
  _buildPreviewPanel() {
    this._cPreview.removeAll(true)
    const headerY = PANEL_Y + 8
    this._cPreview.add(_text(this, PREVIEW_X + 12, headerY, 'PREVIEW', {
      fontSize: '14px', color: COL_TEXT_HI, fontStyle: 'bold',
    }).setOrigin(0, 0))

    // Reroll variants button
    const btnX = PREVIEW_X + PREVIEW_W - 96
    const btn = this._mkButton(btnX, headerY - 4, 88, 24, 'REROLL', () => {
      ThemeManager.resetRolls()
      this._refreshPreview()
    })
    this._cPreview.add(btn.parts)

    // Center the preview canvas
    const canvasX = PREVIEW_X + (PREVIEW_W - PREV_PX_W) / 2
    const canvasY = headerY + 30
    const bg = this.add.rectangle(canvasX, canvasY, PREV_PX_W, PREV_PX_H, 0x000000, 1).setOrigin(0, 0)
      .setStrokeStyle(1, COL_BORDER, 1)
    this._cPreview.add(bg)
    this._previewArea = { x: canvasX, y: canvasY, w: PREV_PX_W, h: PREV_PX_H }

    // Container for the rendered cells (cleared and rebuilt each refresh)
    this._previewCells = this.add.container(0, 0)
    this._cPreview.add(this._previewCells)

    // Caption
    const capY = canvasY + PREV_PX_H + 12
    this._cPreview.add(_text(this, PREVIEW_X + PREVIEW_W / 2, capY,
      'Sample room — every slot kind shown once.\nVariants are rolled once per cell. Click REROLL to re-pick.', {
        fontSize: '11px', color: COL_TEXT_DIM, align: 'center',
      }).setOrigin(0.5, 0))

    this._refreshPreview()
  }

  _refreshPreview() {
    if (!this._previewCells) return
    this._previewCells.removeAll(true)
    if (!this._activeThemeName) {
      this._previewCells.add(_text(this,
        this._previewArea.x + this._previewArea.w / 2,
        this._previewArea.y + this._previewArea.h / 2,
        '(no active theme)', { fontSize: '14px', color: COL_TEXT_DIM }).setOrigin(0.5))
      return
    }

    const ox = this._previewArea.x
    const oy = this._previewArea.y

    for (let r = 0; r < PREV_ROWS; r++) {
      for (let c = 0; c < PREV_COLS; c++) {
        const slot = previewSlotAt(c, r)
        if (!slot) continue
        const id = ThemeManager.pickVariant(slot, c, r, this._activeThemeName)
        if (!id) {
          // No variant — draw a faint placeholder
          const placeholder = this.add.rectangle(ox + c * PREV_TILE, oy + r * PREV_TILE,
            PREV_TILE, PREV_TILE, slot.startsWith('door') ? 0x2a1828 : (slot === 'floor' ? 0x101820 : 0x1a1024), 1)
            .setOrigin(0, 0).setStrokeStyle(1, COL_BORDER, 0.3)
          this._previewCells.add(placeholder)
          continue
        }
        const sprite = ThemeManager.getSprite(id)
        const tex = _textureKey(id)
        if (!this.textures.exists(tex)) {
          this._previewCells.add(this.add.rectangle(ox + c * PREV_TILE, oy + r * PREV_TILE,
            PREV_TILE, PREV_TILE, 0x331428, 1).setOrigin(0, 0))
          continue
        }
        // Render sprite. Scale-mode: shrink to a single cell. Span-mode: render
        // at native size covering coverage×coverage cells, anchored at this
        // cell's top-left. Span sprites are only drawn when (c, r) is the
        // anchor cell — skip non-anchor cells for span.
        if (sprite.mode === 'span') {
          const cov = spriteCoverage(sprite)
          const ax = c - (c % cov)
          const ay = r - (r % cov)
          if (ax !== c || ay !== r) continue
          const img = this.add.image(ox + c * PREV_TILE, oy + r * PREV_TILE, tex).setOrigin(0, 0)
          // Force display at cov × cov tiles
          img.setDisplaySize(cov * PREV_TILE, cov * PREV_TILE)
          this._previewCells.add(img)
        } else {
          const img = this.add.image(ox + c * PREV_TILE, oy + r * PREV_TILE, tex).setOrigin(0, 0)
          img.setDisplaySize(PREV_TILE, PREV_TILE)
          this._previewCells.add(img)
        }
      }
    }
  }

  // ── Bottom bar ───────────────────────────────────────────────────────────
  _buildBottomBar() {
    this._cBottom.removeAll(true)
    const y = DESIGN_H - BOT_BAR_H + 10
    const h = 30
    const back = this._mkButton(12, y, 100, h, '← BACK', () => {
      this.scene.start('MainMenu')
    })
    this._cBottom.add(back.parts)

    const save = this._mkButton(DESIGN_W - 130, y, 118, h, 'SAVE TO DISK', () => this._save(), 0x2a8050, 0x4ab070)
    this._cBottom.add(save.parts)

    // Help / hint
    this._cBottom.add(_text(this, DESIGN_W / 2, y + h / 2,
      'Drop PNGs into the Library. Pick a theme. Click a sprite, then click a slot’s [+]. SAVE writes to assets/themes/.', {
        fontSize: '11px', color: COL_TEXT_DIM,
      }).setOrigin(0.5))
  }

  // ── Theme actions ────────────────────────────────────────────────────────
  _promptNewTheme() {
    const name = window.prompt('New theme name:', 'theme_' + (ThemeManager.listThemes().length + 1))
    if (!name) return
    if (ThemeManager.hasTheme(name)) {
      this._toast(`Theme "${name}" already exists`, true); return
    }
    if (ThemeManager.createTheme(name)) {
      this._activeThemeName = name
      ThemeManager.setActive(name)
      this._refreshAll()
      this._toast(`Created "${name}"`)
    }
  }

  _promptRenameTheme() {
    if (!this._activeThemeName) return
    const next = window.prompt('Rename theme:', this._activeThemeName)
    if (!next || next === this._activeThemeName) return
    if (ThemeManager.renameTheme(this._activeThemeName, next)) {
      this._activeThemeName = next
      this._refreshAll()
    } else {
      this._toast(`Couldn't rename to "${next}"`, true)
    }
  }

  _promptDeleteTheme() {
    if (!this._activeThemeName) return
    if (!window.confirm(`Delete theme "${this._activeThemeName}"? Sprites stay in the library.`)) return
    ThemeManager.deleteTheme(this._activeThemeName)
    this._activeThemeName = ThemeManager.activeTheme()
    this._refreshAll()
  }

  // ── File upload (drop + click) ───────────────────────────────────────────
  _setupDomDropTarget() {
    this._domDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
    this._domDrop     = async (e) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files || [])
      await this._ingestFiles(files.filter(f => /\.png$/i.test(f.name)))
    }
    document.addEventListener('dragover', this._domDragOver)
    document.addEventListener('drop',     this._domDrop)
  }

  _teardownDom() {
    if (this._domDragOver) document.removeEventListener('dragover', this._domDragOver)
    if (this._domDrop)     document.removeEventListener('drop',     this._domDrop)
  }

  _openFilePicker() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png'
    input.multiple = true
    input.onchange = async () => {
      const files = Array.from(input.files || [])
      await this._ingestFiles(files)
    }
    input.click()
  }

  async _ingestFiles(files) {
    if (!files.length) return
    let added = 0, skipped = 0
    for (const file of files) {
      const id = makeSpriteId(file.name)
      // Read bytes
      const arrayBuf = await file.arrayBuffer()
      const bytes    = new Uint8Array(arrayBuf)
      // Detect dimension via Image element
      const dataUrl  = await _bytesToDataUrl(bytes)
      const dim      = await _imgDim(dataUrl)
      const srcSize  = VALID_SRC_SIZES.includes(dim) ? dim
        : (dim <= 32 ? 32 : dim <= 64 ? 64 : 128)

      if (ThemeManager.hasSprite(id)) {
        // Overwrite by default (treat re-drop as update)
        ThemeManager.updateSprite(id, { srcSize })
      } else {
        ThemeManager.addSprite(id, { srcSize, mode: 'scale', file: spritePath(id) })
      }
      this._pendingPngs.set(id, bytes)
      // Register Phaser texture for preview
      try { await this._addTextureFromDataUrl(_textureKey(id), dataUrl) }
      catch (_) { /* ignore */ }
      added++
    }
    this._toast(`Added ${added} sprite${added === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped)` : ''}`)
    this._refreshAll()
  }

  // Phaser's textures.addBase64 fires asynchronously — wrap in a promise so
  // ingest can await and the next refresh actually finds the texture.
  // Never replace an existing texture: doing so destroys the WebGLTexture
  // mid-render and crashes any Image already referencing the key
  // ("Cannot read properties of null (reading 'isGLTexture')"). To update
  // a sprite's bytes, the user must first DELETE the sprite (which clears
  // its references) and then re-drop the PNG with a fresh id.
  _addTextureFromDataUrl(key, dataUrl) {
    return new Promise((resolve) => {
      if (this.textures.exists(key)) { resolve(); return }
      const onAdd = (addedKey) => {
        if (addedKey !== key) return
        this.textures.off('addtexture', onAdd)
        this._loadedTextureKeys.add(key)
        resolve()
      }
      this.textures.on('addtexture', onAdd)
      this.textures.addBase64(key, dataUrl)
    })
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async _save() {
    if (!FsHandle.isSupported()) {
      // Fallback: download manifest only. PNGs would need manual placement.
      const manifest = ThemeManager.serialize()
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
      FsHandle.downloadFallback('manifest.json', blob)
      this._toast('FS Access API unavailable — manifest downloaded. Place sprites manually.', true)
      return
    }
    if (!FsHandle.hasRoot()) {
      this._toast('Pick the Quest-Failed/ folder…')
      const root = await FsHandle.acquireRoot()
      if (!root) { this._toast('Folder not granted — save cancelled', true); return }
    }
    try {
      // Write each pending PNG
      for (const [id, bytes] of this._pendingPngs) {
        await FsHandle.writeFile(spritePath(id), new Blob([bytes], { type: 'image/png' }))
      }
      this._pendingPngs.clear()
      // Write manifest
      await FsHandle.writeJson('assets/themes/manifest.json', ThemeManager.serialize())
      this._toast('Saved.')
      this._buildTopBar()  // refresh "project: …" indicator
    } catch (err) {
      console.error('[TilesetEditor] save failed:', err)
      this._toast('Save failed: ' + (err?.message || err), true)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  _refreshAll() {
    this._buildTopBar()
    this._buildLibraryPanel()
    this._buildSlotsPanel()
    this._refreshPreview()
    this._buildBottomBar()
  }

  _mkButton(x, y, w, h, label, onClick, fillCol = COL_BTN, hoverCol = COL_BTN_HOVER) {
    const bg = this.add.rectangle(x, y, w, h, fillCol, 1).setOrigin(0, 0)
      .setStrokeStyle(1, COL_BORDER_HI, 1).setInteractive({ useHandCursor: true })
    bg.on('pointerover', () => bg.setFillStyle(hoverCol, 1))
    bg.on('pointerout',  () => bg.setFillStyle(fillCol, 1))
    bg.on('pointerdown', onClick)
    const txt = _text(this, x + w / 2, y + h / 2, label, {
      fontSize: '12px', color: COL_TEXT_HI, fontStyle: 'bold',
    }).setOrigin(0.5)
    return { parts: [bg, txt], bg, txt }
  }

  _toast(msg, isError = false) {
    this._cToast.removeAll(true)
    const tx = DESIGN_W / 2
    const ty = DESIGN_H - BOT_BAR_H - 30
    const padding = 10
    const t = _text(this, tx, ty, msg, {
      fontSize: '13px', color: isError ? COL_TEXT_WARN : COL_TEXT_HI,
      backgroundColor: '#0a0514', padding: { x: padding, y: 6 },
    }).setOrigin(0.5)
    this._cToast.add(t)
    this.tweens.add({
      targets: t, alpha: { from: 1, to: 0 }, duration: 2400, delay: 800,
      onComplete: () => t.destroy(),
    })
  }
}

// ── Module helpers ─────────────────────────────────────────────────────────
function _panel(g, x, y, w, h) {
  g.fillStyle(COL_PANEL, 1).fillRect(x, y, w, h)
  g.lineStyle(1, COL_BORDER, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
}

function _text(scene, x, y, str, style) {
  const merged = Object.assign({ fontFamily: 'monospace' }, style || {})
  return scene.add.text(x, y, str, merged)
}

function _textureKey(id) { return `themesprite-${id}` }

function _inAreaTE(x, y, a) {
  return a && x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h
}

async function _blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

async function _bytesToDataUrl(bytes) {
  return _blobToDataUrl(new Blob([bytes], { type: 'image/png' }))
}

async function _imgDim(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(Math.max(img.naturalWidth, img.naturalHeight))
    img.onerror = () => resolve(32)
    img.src = dataUrl
  })
}

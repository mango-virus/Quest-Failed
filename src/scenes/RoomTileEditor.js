// RoomTileEditor — paint individual 32×32 cells of a room template with
// sprites from the library.
//
// Three columns:
//   LEFT   (Rooms list)   — every room from rooms.json. Click to load.
//   CENTER (Paint canvas) — selected room rendered cell-by-cell. Click a
//                           cell to override it with the active sprite;
//                           right-click / shift-click to clear back to the
//                           computed default.
//   RIGHT  (Sprites)      — compact sprite-library picker. Click to make
//                           a sprite the active brush.
//
// Top bar: theme dropdown for the current room (per-room theme assignment)
// + zoom controls + eraser toggle + clear-all.
//
// Save: writes mutated rooms.json back to src/data/rooms.json via FsHandle.
// The cache is also updated in place so the rest of the running game sees
// the new theme + tileLayout immediately (next dungeon stamp picks it up
// once the renderer integration lands in Phase C).
//
// Default rendering (no override on a cell):
//   corner cells  → wall_corner_<tl|tr|bl|br>
//   edge top      → wall
//   edge bottom   → wall_bottom
//   edge left/r   → wall_left / wall_right
//   interior      → floor
// All defaults source variants from the room's currently-assigned theme.

import { applyUiCamera } from '../ui/UIKit.js'
import { FsHandle }      from '../systems/FsHandle.js'
import {
  ThemeManager, FLOOR_SLOT, spriteCoverage,
  readCellEntry, writeCellEntry, VALID_ROTATIONS,
} from '../systems/ThemeManager.js'

// ── Layout ────────────────────────────────────────────────────────────────
const DESIGN_W = 1280
const DESIGN_H = 800
const TOP_H    = 50
const BOT_H    = 50
const PANEL_Y  = TOP_H + 8
const PANEL_H  = DESIGN_H - TOP_H - BOT_H - 16

const ROOMS_X = 10
const ROOMS_W = 200
const PAINT_X = ROOMS_X + ROOMS_W + 10
const PAINT_W = 740
const SPRITES_X = PAINT_X + PAINT_W + 10
const SPRITES_W = DESIGN_W - SPRITES_X - 10

// ── Palette ───────────────────────────────────────────────────────────────
const COL_BG          = 0x0a0514
const COL_PANEL       = 0x140a26
const COL_PANEL_HI    = 0x1d0e36
const COL_BORDER      = 0x3a1f5a
const COL_BORDER_HI   = 0x9b32d4
const COL_TEXT        = '#d8c8e8'
const COL_TEXT_DIM    = '#7a6e8e'
const COL_TEXT_HI     = '#ffd0a0'
const COL_TEXT_WARN   = '#ff8870'
const COL_BTN         = 0x2a1450
const COL_BTN_HOVER   = 0x4a2a80
const COL_PAINT_HOVER = 0x9b32d4
const COL_OVERRIDE_BG = 0x2a4818  // greenish tint behind cells with overrides
const COL_DEFAULT_BG  = 0x101820  // dark fill behind cells with no override

const TILE_PX = 32
const ROOM_ROW_H = 26
const SPRITE_TILE = 44
const SPRITE_GAP  = 6

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2]

// Module-level draft session — preserves the editor's mutable state across
// MainMenu round-trips so in-progress paints aren't lost when the user
// navigates away without saving. Cleared on page reload (which is fine —
// then we re-read from the freshly-loaded rooms.json cache, picking up any
// disk-saved edits). Written back to disk by Save-to-disk; mirrored into
// the live cache there so the running game sees the same state.
//
// Re-use rule: if the cached rooms array's length and id-list match the
// session's, we keep the session. If they diverge (e.g. rooms.json was
// re-loaded externally with a different room set), we discard and start
// fresh.
let _session = null

function _matchesCache(session, cacheRooms) {
  if (!session || !Array.isArray(cacheRooms)) return false
  if (session.rooms.length !== cacheRooms.length) return false
  for (let i = 0; i < cacheRooms.length; i++) {
    if (session.rooms[i].id !== cacheRooms[i].id) return false
  }
  return true
}

// Returns a property descriptor whose getter/setter proxies a single field
// on the session object. Used so this._activeRoomId etc. read/write the
// shared session state instead of a transient instance field.
// View ↔ room coordinate transforms for the editor's rotated view.
// `viewRot` is the user's chosen view rotation in degrees (0/90/180/270),
// applied as a clockwise rotation of the displayed canvas. The room data
// itself stays in canonical orientation; we only translate at the
// presentation/input boundary so paints store correctly.
//
// Conventions:
//   view_rot=0   → view cell (x, y) is the same as room cell (x, y)
//   view_rot=90  → view cell (vx, vy) is room cell (vy, h-1-vx)  (CW rot)
//   view_rot=180 → view cell (vx, vy) is room cell (w-1-vx, h-1-vy)
//   view_rot=270 → view cell (vx, vy) is room cell (w-1-vy, vx)
//
// View-space dimensions swap when viewRot is odd (90 / 270).
function viewDims(roomW, roomH, viewRot) {
  return (viewRot === 90 || viewRot === 270)
    ? { w: roomH, h: roomW }
    : { w: roomW, h: roomH }
}

function viewToRoom(vx, vy, roomW, roomH, viewRot) {
  switch (viewRot) {
    case 90:  return { rx: vy,             ry: roomH - 1 - vx }
    case 180: return { rx: roomW - 1 - vx, ry: roomH - 1 - vy }
    case 270: return { rx: roomW - 1 - vy, ry: vx }
    default:  return { rx: vx,             ry: vy }
  }
}

function roomToView(rx, ry, roomW, roomH, viewRot) {
  switch (viewRot) {
    case 90:  return { vx: roomH - 1 - ry, vy: rx }
    case 180: return { vx: roomW - 1 - rx, vy: roomH - 1 - ry }
    case 270: return { vx: ry,             vy: roomW - 1 - rx }
    default:  return { vx: rx,             vy: ry }
  }
}

// View-space top-left of a cov×cov room block anchored at (rx, ry). Used
// to position the rendered span-sprite Image when the view is rotated —
// the anchor in room space may not correspond to the top-left of the
// rotated view block.
function viewBlockTopLeft(rx, ry, cov, roomW, roomH, viewRot) {
  let minVx = Infinity, minVy = Infinity
  for (let dy = 0; dy < cov; dy++) {
    for (let dx = 0; dx < cov; dx++) {
      const v = roomToView(rx + dx, ry + dy, roomW, roomH, viewRot)
      if (v.vx < minVx) minVx = v.vx
      if (v.vy < minVy) minVy = v.vy
    }
  }
  return { vx: minVx, vy: minVy }
}

function _propAccessor(target, key) {
  return {
    configurable: true,
    enumerable:   true,
    get() { return target[key] },
    set(v) { target[key] = v },
  }
}

export class RoomTileEditor extends Phaser.Scene {
  constructor() { super('RoomTileEditor') }

  create() {
    // Defensive camera setup: apply once now, again on the next tick, and
    // on every scale resize. Phaser sometimes settles canvas size a tick
    // after create() (font load, scrollbar appearance, post-scene-start
    // layout shifts). A single applyUiCamera call at the wrong moment
    // computes a tiny zoom and the editor renders effectively invisible.
    // Same pattern MainMenu uses for the same reason.
    applyUiCamera(this, DESIGN_W, DESIGN_H)
    this.time.delayedCall(0, () => this._reapplyCamera())
    this.scale.on('resize', this._reapplyCamera, this)
    this.events.once('shutdown', () => this.scale.off('resize', this._reapplyCamera, this))

    const roomsFromCache = this.cache.json.get('rooms')
    if (!roomsFromCache) {
      this._renderEmpty('rooms.json not loaded')
      return
    }

    // Re-use the prior draft session if it still matches the cache shape.
    // Otherwise initialize a fresh session from the cache.
    let freshSession = false
    // Migrate older sessions that predate viewRot / flipH / flipV — they
    // otherwise read as `undefined` through property accessors, which would
    // default-match the rotation switch but break the cycle button's
    // modulus and the boolean toggles.
    if (_session && _session.viewRot == null) _session.viewRot = 0
    if (_session && _session.flipH   == null) _session.flipH   = false
    if (_session && _session.flipV   == null) _session.flipV   = false
    if (!_matchesCache(_session, roomsFromCache)) {
      const rooms = structuredClone(roomsFromCache)
      rooms.forEach(r => this._ensureRoomShape(r))
      _session = {
        rooms,
        activeRoomId:   rooms[0]?.id || null,
        activeSpriteId: null,
        activeRot:      0,
        viewRot:        0,   // 0/90/180/270 — rotates the canvas only
        flipH:          false, // brush horizontal mirror
        flipV:          false, // brush vertical mirror
        eraserMode:     false,
        zoomIdx:        2,   // 1×
      }
      freshSession = true
    }
    this._sessionFresh = freshSession

    // Bind editor instance fields to the session. Mutating these via the
    // setters (defined below the instance fields) writes through to
    // `_session` so the next entry sees the latest state.
    this._rooms = _session.rooms
    Object.defineProperty(this, '_activeRoomId',   _propAccessor(_session, 'activeRoomId'))
    Object.defineProperty(this, '_activeSpriteId', _propAccessor(_session, 'activeSpriteId'))
    Object.defineProperty(this, '_activeRot',      _propAccessor(_session, 'activeRot'))
    Object.defineProperty(this, '_viewRot',        _propAccessor(_session, 'viewRot'))
    Object.defineProperty(this, '_flipH',          _propAccessor(_session, 'flipH'))
    Object.defineProperty(this, '_flipV',          _propAccessor(_session, 'flipV'))
    Object.defineProperty(this, '_eraserMode',     _propAccessor(_session, 'eraserMode'))
    Object.defineProperty(this, '_zoomIdx',        _propAccessor(_session, 'zoomIdx'))

    this._gBg     = this.add.graphics().setDepth(0)
    this._gPanels = this.add.graphics().setDepth(1)
    this._cTop      = this.add.container(0, 0).setDepth(2)
    this._cRooms    = this.add.container(0, 0).setDepth(3)
    this._cPaint    = this.add.container(0, 0).setDepth(3)
    this._cSprites  = this.add.container(0, 0).setDepth(3)
    this._cBottom   = this.add.container(0, 0).setDepth(4)
    this._cToast    = this.add.container(0, 0).setDepth(20)

    this._roomsScroll = 0
    this._spritesScroll = 0

    this._drawBackground()
    this._buildTopBar()
    this._buildRoomsPanel()
    this._buildPaintPanel()
    this._buildSpritesPanel()
    this._buildBottomBar()

    // Scene-level wheel routing. We previously layered an invisible
    // scrollHit rectangle over each scrollable panel to capture wheel
    // events, but those rectangles also intercepted pointer-down events
    // from the row buttons underneath (Phaser doesn't propagate consumed
    // input). Listening at the scene level + dispatching by pointer
    // position lets the underlying row clicks fire normally.
    this.input.on('wheel', this._onWheel, this)
    this.events.once('shutdown', () => this.input.off('wheel', this._onWheel, this))

    // R cycles brush rotation 0 → 90 → 180 → 270 → 0. Useful for reusing
    // one sprite at multiple orientations across cells of the same room.
    this.input.keyboard?.on('keydown-R', () => this._cycleRotation(+1))
    // V cycles the canvas view rotation (room data unchanged; paints made
    // while rotated bake the view rotation into the stored tile rotation).
    this.input.keyboard?.on('keydown-V', () => this._cycleViewRotation(+1))

    FsHandle.tryRestoreRoot().catch(() => {})
    this._initialLoad()
  }

  _onWheel(pointer, _gameObjects, _dx, dy) {
    const x = pointer.worldX, y = pointer.worldY
    const dyy = dy || 0
    if (this._inArea(x, y, this._roomsArea)) {
      this._roomsScroll = Math.max(0, this._roomsScroll + dyy)
      this._populateRoomsList()
    } else if (this._inArea(x, y, this._spritesArea)) {
      this._spritesScroll = Math.max(0, this._spritesScroll + dyy)
      this._populateSpritesGrid()
    }
  }

  _inArea(x, y, a) {
    return a && x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h
  }

  _reapplyCamera() { applyUiCamera(this, DESIGN_W, DESIGN_H) }

  // ── Room shape normalization ─────────────────────────────────────────────
  _ensureRoomShape(room) {
    if (typeof room.theme !== 'string') room.theme = null
    const w = room.width  | 0
    const h = room.height | 0
    if (!Array.isArray(room.tileLayout) || !Array.isArray(room.tileLayout[0])
        || room.tileLayout.length !== h || room.tileLayout[0].length !== w) {
      // Re-shape: preserve any matching cells, fill the rest with null
      const old = Array.isArray(room.tileLayout) ? room.tileLayout : []
      const grid = []
      for (let y = 0; y < h; y++) {
        const row = []
        for (let x = 0; x < w; x++) {
          const v = Array.isArray(old[y]) ? old[y][x] : null
          row.push(typeof v === 'string' ? v : null)
        }
        grid.push(row)
      }
      room.tileLayout = grid
    }
  }

  // ── Initial load ─────────────────────────────────────────────────────────
  async _initialLoad() {
    if (FsHandle.hasRoot()) {
      // Pick up theme manifest if it's already on disk so sprites are
      // available without first visiting TilesetEditor.
      const m = await FsHandle.readJson('assets/themes/manifest.json')
      if (m) {
        ThemeManager.load(m)
        await this._registerExistingSpriteTextures()
      }
      // Re-read rooms.json from disk ONLY on a fresh session — i.e. the
      // first time this editor opens since page load. Re-entries with a
      // live session keep the in-progress drafts (the whole point of the
      // session). The user can hard-reload the page to discard drafts.
      if (this._sessionFresh) {
        const r = await FsHandle.readJson('src/data/rooms.json')
        if (Array.isArray(r)) {
          r.forEach(rr => this._ensureRoomShape(rr))
          // Replace the session's rooms in place so the property accessors
          // continue to work (they read from _session.rooms by reference).
          _session.rooms = r
          this._rooms = r
          if (!this._rooms.find(rr => rr.id === this._activeRoomId)) {
            this._activeRoomId = this._rooms[0]?.id || null
          }
        }
      }
    }
    this._refreshAll()
  }

  async _registerExistingSpriteTextures() {
    const sprites = ThemeManager.listSprites()
    await Promise.all(sprites.map(s => this._loadSpriteTextureFromDisk(s.id, s.file)))
  }

  async _loadSpriteTextureFromDisk(id, file) {
    const key = _textureKey(id)
    // Skip if Preload (or a previous editor visit) already registered this
    // texture. Re-loading via remove() + addBase64() destroys the existing
    // WebGLTexture mid-render, which causes "Cannot read properties of null
    // (reading 'isGLTexture')" the next time any Image referencing the key
    // tries to draw — exactly the cross-nav crash that was leaving panels
    // empty.
    if (this.textures.exists(key)) return
    try {
      const blob = await FsHandle.readFile(file)
      if (!blob) return
      const dataUrl = await _blobToDataUrl(blob)
      await this._addTextureFromDataUrl(key, dataUrl)
    } catch (_) { /* ignore */ }
  }

  _addTextureFromDataUrl(key, dataUrl) {
    return new Promise((resolve) => {
      // Same race-prevention reason as above — never replace an existing
      // texture; just resolve. Callers that want to UPDATE a sprite's bytes
      // (e.g. user re-drops a PNG with the same id) should remove the
      // texture only when they're sure no Image references it.
      if (this.textures.exists(key)) { resolve(); return }
      const onAdd = (addedKey) => {
        if (addedKey !== key) return
        this.textures.off('addtexture', onAdd)
        resolve()
      }
      this.textures.on('addtexture', onAdd)
      this.textures.addBase64(key, dataUrl)
    })
  }

  // ── Background ───────────────────────────────────────────────────────────
  _drawBackground() {
    this._gBg.clear()
    this._gBg.fillStyle(COL_BG, 1).fillRect(0, 0, DESIGN_W, DESIGN_H)

    this._gPanels.clear()
    _panel(this._gPanels, 0, 0, DESIGN_W, TOP_H)
    _panel(this._gPanels, ROOMS_X,   PANEL_Y, ROOMS_W,   PANEL_H)
    _panel(this._gPanels, PAINT_X,   PANEL_Y, PAINT_W,   PANEL_H)
    _panel(this._gPanels, SPRITES_X, PANEL_Y, SPRITES_W, PANEL_H)
    _panel(this._gPanels, 0, DESIGN_H - BOT_H, DESIGN_W, BOT_H)
  }

  // ── Top bar ──────────────────────────────────────────────────────────────
  _buildTopBar() {
    this._cTop.removeAll(true)
    this._cTop.add(_text(this, 12, TOP_H / 2, 'ROOM EDITOR', {
      fontSize: '20px', color: COL_TEXT_HI, fontStyle: 'bold',
    }).setOrigin(0, 0.5))

    const room = this._activeRoom()
    const roomLabel = room ? `${room.name}  (${room.width}×${room.height})` : '(no room)'
    this._cTop.add(_text(this, 200, TOP_H / 2, roomLabel, {
      fontSize: '14px', color: COL_TEXT,
    }).setOrigin(0, 0.5))

    // Theme picker for current room
    const themeLblX = 460
    this._cTop.add(_text(this, themeLblX, TOP_H / 2, 'Theme:', {
      fontSize: '13px', color: COL_TEXT_DIM,
    }).setOrigin(0, 0.5))
    const ddX = themeLblX + 46
    const ddW = 150
    const ddH = 28
    const ddY = (TOP_H - ddH) / 2
    const themeName = room?.theme || '(none)'
    const dd = this.add.rectangle(ddX, ddY, ddW, ddH, COL_BTN, 1).setOrigin(0, 0)
      .setStrokeStyle(1, COL_BORDER, 1).setInteractive({ useHandCursor: true })
    dd.on('pointerover', () => dd.setFillStyle(COL_BTN_HOVER, 1))
    dd.on('pointerout',  () => dd.setFillStyle(COL_BTN, 1))
    dd.on('pointerdown', () => this._openThemeDropdown(ddX, ddY + ddH))
    this._cTop.add(dd)
    this._cTop.add(_text(this, ddX + 8, ddY + ddH / 2, themeName + '  ▾', {
      fontSize: '13px', color: room?.theme ? COL_TEXT : COL_TEXT_DIM,
    }).setOrigin(0, 0.5))

    // Zoom controls
    const zX = ddX + ddW + 16
    let bx = zX
    const mkBtn = (label, w, onClick, opts = {}) => {
      const b = this._mkButton(bx, ddY, w, ddH, label, onClick, opts.fill, opts.hover)
      this._cTop.add(b.parts)
      bx += w + 6
    }
    mkBtn('-', 26, () => this._setZoom(this._zoomIdx - 1))
    this._cTop.add(_text(this, bx + 22, ddY + ddH / 2, ZOOM_LEVELS[this._zoomIdx] + '×', {
      fontSize: '12px', color: COL_TEXT,
    }).setOrigin(0.5))
    bx += 44
    mkBtn('+', 26, () => this._setZoom(this._zoomIdx + 1))

    // Brush rotation cycle (0 → 90 → 180 → 270 → 0). Also bound to the R key.
    bx += 6
    mkBtn(`TILE ${this._activeRot}°`, 70, () => this._cycleRotation(+1),
      this._activeRot ? { fill: 0x4a2a80, hover: 0x6a4ab0 } : {})

    // View rotation (rotates the displayed canvas; paint coords + brush
    // rotation are auto-translated). Bound to V key as well.
    mkBtn(`VIEW ${this._viewRot}°`, 70, () => this._cycleViewRotation(+1),
      this._viewRot ? { fill: 0x2a5078, hover: 0x4a78a0 } : {})

    // Mirror toggles. ⇆/⇅ glyphs show direction of the flip; checkmark
    // when active.
    mkBtn(this._flipH ? 'FLIP-H ✓' : 'FLIP-H', 70, () => { this._flipH = !this._flipH; this._buildTopBar() },
      this._flipH ? { fill: 0x4a2a80, hover: 0x6a4ab0 } : {})
    mkBtn(this._flipV ? 'FLIP-V ✓' : 'FLIP-V', 70, () => { this._flipV = !this._flipV; this._buildTopBar() },
      this._flipV ? { fill: 0x4a2a80, hover: 0x6a4ab0 } : {})

    // Eraser toggle
    mkBtn(this._eraserMode ? 'ERASE✓' : 'ERASE',
      60, () => { this._eraserMode = !this._eraserMode; this._buildTopBar() },
      this._eraserMode ? { fill: 0x6a0008, hover: 0x9a1010 } : {})

    // Clear all
    mkBtn('CLEAR', 50, () => this._clearAllOverrides())

    // Project root indicator + reset button (right). Truncate long folder
    // names so the right-side cluster stays bounded; RESET button anchored
    // at the right edge.
    const rootName = FsHandle.rootName()
    if (rootName) {
      const resetW = 52, resetH = 22
      const resetX = DESIGN_W - 10 - resetW
      const resetY = (TOP_H - resetH) / 2
      const resetBtn = this._mkButton(resetX, resetY, resetW, resetH, 'RESET', async () => {
        if (!window.confirm(`Forget the saved folder "${rootName}"? You'll be prompted to pick a new one on the next save.`)) return
        await FsHandle.clear()
        this._buildTopBar()
        this._toast('Folder cleared. Click SAVE to pick a new one.')
      }, 0x6a0008, 0x9a1010)
      this._cTop.add(resetBtn.parts)
      const shortName = rootName.length > 14 ? rootName.slice(0, 13) + '…' : rootName
      this._cTop.add(_text(this, resetX - 6, TOP_H / 2, shortName, {
        fontSize: '10px', color: COL_TEXT_DIM,
      }).setOrigin(1, 0.5))
    } else {
      const text = FsHandle.isSupported() ? 'no folder' : 'no FS API'
      this._cTop.add(_text(this, DESIGN_W - 12, TOP_H / 2, text, {
        fontSize: '10px', color: COL_TEXT_WARN,
      }).setOrigin(1, 0.5))
    }
  }

  _openThemeDropdown(x, y) {
    if (this._ddOverlay) this._ddOverlay.destroy()
    const themes = ['(none)', ...ThemeManager.listThemes()]
    const itemH = 26
    const w = 200
    const h = Math.max(itemH, themes.length * itemH)
    this._ddOverlay = this.add.container(0, 0).setDepth(50)
    const blocker = this.add.rectangle(0, 0, DESIGN_W, DESIGN_H, 0x000000, 0.001)
      .setOrigin(0, 0).setInteractive()
    blocker.on('pointerdown', () => { this._ddOverlay?.destroy(); this._ddOverlay = null })
    this._ddOverlay.add(blocker)
    const bg = this.add.rectangle(x, y, w, h, COL_PANEL, 0.98).setOrigin(0, 0)
      .setStrokeStyle(1, COL_BORDER_HI, 1)
    this._ddOverlay.add(bg)
    themes.forEach((name, i) => {
      const ry = y + i * itemH
      const row = this.add.rectangle(x, ry, w, itemH, COL_PANEL, 0).setOrigin(0, 0)
        .setInteractive({ useHandCursor: true })
      row.on('pointerover', () => row.setFillStyle(COL_BTN_HOVER, 1))
      row.on('pointerout',  () => row.setFillStyle(COL_PANEL, 0))
      row.on('pointerdown', () => {
        const room = this._activeRoom()
        if (room) room.theme = (name === '(none)' ? null : name)
        this._ddOverlay?.destroy(); this._ddOverlay = null
        ThemeManager.resetRolls()
        this._refreshAll()
      })
      const lbl = _text(this, x + 10, ry + itemH / 2, name, {
        fontSize: '13px', color: name === '(none)' ? COL_TEXT_DIM : COL_TEXT,
      }).setOrigin(0, 0.5)
      this._ddOverlay.add([row, lbl])
    })
  }

  // ── Rooms list panel ─────────────────────────────────────────────────────
  _buildRoomsPanel() {
    this._cRooms.removeAll(true)
    this._cRooms.add(_text(this, ROOMS_X + 10, PANEL_Y + 8, 'ROOMS', {
      fontSize: '13px', color: COL_TEXT_HI, fontStyle: 'bold',
    }).setOrigin(0, 0))

    const top    = PANEL_Y + 28
    const bottom = PANEL_Y + PANEL_H - 8
    const areaH  = bottom - top

    const maskGfx = this.add.graphics().setVisible(false)
      .fillStyle(0xffffff, 1).fillRect(ROOMS_X, top, ROOMS_W, areaH)
    const mask = maskGfx.createGeometryMask()
    const container = this.add.container(0, 0)
    this._cRooms.add(container)
    container.setMask(mask)
    this._roomsListContainer = container
    this._roomsArea = { x: ROOMS_X, y: top, w: ROOMS_W, h: areaH }

    this._populateRoomsList()
    // Scroll wheel handled by the scene-level _onWheel — see create().
  }

  _populateRoomsList() {
    if (!this._roomsListContainer) return
    this._roomsListContainer.removeAll(true)
    this._rooms.forEach((r, i) => {
      const ry = this._roomsArea.y + i * (ROOM_ROW_H + 2) - this._roomsScroll
      const isActive = r.id === this._activeRoomId
      const rx = this._roomsArea.x + 6
      const rw = this._roomsArea.w - 12
      const bg = this.add.rectangle(rx, ry, rw, ROOM_ROW_H, isActive ? COL_PANEL_HI : COL_PANEL, 1)
        .setOrigin(0, 0).setStrokeStyle(1, isActive ? COL_BORDER_HI : COL_BORDER, 1)
        .setInteractive({ useHandCursor: true })
      bg.on('pointerdown', () => {
        this._activeRoomId = r.id
        this._refreshAll()
      })
      bg.on('pointerover', () => { if (!isActive) bg.setFillStyle(COL_PANEL_HI, 1) })
      bg.on('pointerout',  () => { if (!isActive) bg.setFillStyle(COL_PANEL, 1) })
      this._roomsListContainer.add(bg)
      // Marker for rooms with overrides or theme
      const overrideCount = _countOverrides(r)
      const tagLabel = (r.theme ? '◆ ' : '') + (overrideCount ? `${overrideCount}` : '')
      this._roomsListContainer.add(_text(this, rx + 8, ry + ROOM_ROW_H / 2, r.name, {
        fontSize: '12px', color: isActive ? COL_TEXT_HI : COL_TEXT,
      }).setOrigin(0, 0.5))
      if (tagLabel) {
        this._roomsListContainer.add(_text(this, rx + rw - 8, ry + ROOM_ROW_H / 2, tagLabel, {
          fontSize: '11px', color: COL_BORDER_HI,
        }).setOrigin(1, 0.5))
      }
    })
  }

  // ── Paint canvas ─────────────────────────────────────────────────────────
  _buildPaintPanel() {
    this._cPaint.removeAll(true)
    this._cPaint.add(_text(this, PAINT_X + 12, PANEL_Y + 8, 'PAINT', {
      fontSize: '13px', color: COL_TEXT_HI, fontStyle: 'bold',
    }).setOrigin(0, 0))

    // Inner canvas area starts below the panel header
    const top    = PANEL_Y + 28
    const bottom = PANEL_Y + PANEL_H - 30
    const areaH  = bottom - top
    const maskGfx = this.add.graphics().setVisible(false)
      .fillStyle(0xffffff, 1).fillRect(PAINT_X + 4, top, PAINT_W - 8, areaH)
    const mask = maskGfx.createGeometryMask()
    const container = this.add.container(0, 0)
    this._cPaint.add(container)
    container.setMask(mask)
    this._paintContainer = container
    this._paintArea = { x: PAINT_X + 4, y: top, w: PAINT_W - 8, h: areaH }

    // Bottom hint
    this._cPaint.add(_text(this, PAINT_X + PAINT_W / 2, PANEL_Y + PANEL_H - 14,
      'Click cell = paint with active sprite. Right-click / Shift-click = clear override.', {
        fontSize: '11px', color: COL_TEXT_DIM,
      }).setOrigin(0.5))

    this._populatePaintCanvas()
  }

  _populatePaintCanvas() {
    if (!this._paintContainer) return
    this._paintContainer.removeAll(true)
    const room = this._activeRoom()
    if (!room) {
      this._paintContainer.add(_text(this,
        this._paintArea.x + this._paintArea.w / 2,
        this._paintArea.y + this._paintArea.h / 2,
        '(no room selected)', { fontSize: '14px', color: COL_TEXT_DIM }).setOrigin(0.5))
      return
    }

    const zoom = ZOOM_LEVELS[this._zoomIdx]
    const cell = TILE_PX * zoom
    const w = room.width
    const h = room.height
    const viewRot = this._viewRot || 0
    const vd = viewDims(w, h, viewRot)
    const vw = vd.w, vh = vd.h
    const totalW = vw * cell
    const totalH = vh * cell

    // Center inside paint area
    const ox = this._paintArea.x + Math.max(8, (this._paintArea.w - totalW) / 2)
    const oy = this._paintArea.y + Math.max(8, (this._paintArea.h - totalH) / 2)

    // Backdrop (dark) + bounding stroke
    const backdrop = this.add.rectangle(ox - 1, oy - 1, totalW + 2, totalH + 2, 0x000000, 1)
      .setOrigin(0, 0).setStrokeStyle(1, COL_BORDER, 1)
    this._paintContainer.add(backdrop)

    // Pre-pass: span-anchored covered set, in ROOM space.  The anchor at
    // (rx, ry) covers cov×cov room cells.  We don't care about the
    // view-space cover here — we only use this to skip rendering at
    // non-anchor room cells when iterating by view cell.
    const coveredRoom = new Set()
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const entry = readCellEntry(room.tileLayout[yy]?.[xx])
        if (!entry) continue
        const sp = ThemeManager.getSprite(entry.id)
        const cov = spriteCoverage(sp)
        if (cov <= 1) continue
        for (let dy = 0; dy < cov; dy++) {
          for (let dx = 0; dx < cov; dx++) {
            if (dx === 0 && dy === 0) continue
            coveredRoom.add(`${xx + dx},${yy + dy}`)
          }
        }
      }
    }

    // First pass: render in view space. For each view cell, look up its
    // owning room cell; skip if covered by a span anchor at another cell;
    // anchor cells render at their view-space top-left bounding box of
    // the cov×cov room block.
    for (let vy = 0; vy < vh; vy++) {
      for (let vx = 0; vx < vw; vx++) {
        const { rx, ry } = viewToRoom(vx, vy, w, h, viewRot)
        if (coveredRoom.has(`${rx},${ry}`)) continue
        this._renderViewCell(room, rx, ry, ox, oy, cell, viewRot)
      }
    }

    // Cell click-targets sit on top of the rendered art (one per view cell).
    for (let vy = 0; vy < vh; vy++) {
      for (let vx = 0; vx < vw; vx++) {
        const px = ox + vx * cell
        const py = oy + vy * cell
        const hit = this.add.rectangle(px, py, cell, cell, 0xffffff, 0).setOrigin(0, 0)
          .setStrokeStyle(1, COL_BORDER, 0.25)
          .setInteractive({ useHandCursor: true })
        const hover = (over) => hit.setStrokeStyle(over ? 2 : 1, over ? COL_PAINT_HOVER : COL_BORDER, over ? 0.85 : 0.25)
        hit.on('pointerover', () => hover(true))
        hit.on('pointerout',  () => hover(false))
        // Capture vx/vy/viewRot for the closure.
        const cvx = vx, cvy = vy, cViewRot = viewRot
        hit.on('pointerdown', (pointer, lx, ly, ev) => {
          ev?.stopPropagation?.()
          const isClear = pointer.rightButtonDown() || pointer.event?.shiftKey || this._eraserMode
          const { rx, ry } = viewToRoom(cvx, cvy, w, h, cViewRot)
          if (isClear) {
            this._eraseAt(room, rx, ry)
          } else if (this._activeSpriteId) {
            this._paintAtView(room, cvx, cvy, cViewRot)
          } else {
            this._toast('Pick a sprite at right first', true); return
          }
          this._populatePaintCanvas()
          this._populateRoomsList()
        })
        this._paintContainer.add(hit)
      }
    }
  }

  // Render the art at (x, y). Default-source resolves to a slot; override
  // wins. Span sprites occupy multiple cells anchored at top-left of their
  // coverage area; non-anchor cells skip the image draw.
  // Render the sprite at room cell (rx, ry) into the rotated view canvas.
  // Position is computed from the room→view mapping; rendered angle adds
  // the viewRot to the stored sprite rotation so the sprite's intrinsic
  // orientation in the room is preserved when viewed from any angle.
  _renderViewCell(room, rx, ry, ox, oy, cell, viewRot) {
    const w = room.width, h = room.height
    const overrideRaw = room.tileLayout[ry]?.[rx] || null
    const override = readCellEntry(overrideRaw)
    const spriteId = override?.id || this._defaultSpriteFor(room, rx, ry)
    const sprite = spriteId ? ThemeManager.getSprite(spriteId) : null
    const cov = spriteCoverage(sprite)
    const storedRot = override?.rot || 0
    const flipH = !!override?.flipH
    const flipV = !!override?.flipV

    // View-space top-left for the cov×cov block (in room space starting at
    // (rx, ry)). For cov=1 this is just roomToView(rx, ry).
    const tl = viewBlockTopLeft(rx, ry, cov, w, h, viewRot)
    const px = ox + tl.vx * cell
    const py = oy + tl.vy * cell
    const size = cov * cell

    // Tinted background per VIEW cell. For span sprites (cov>1) we paint
    // the tint across the whole cov×cov view block. Original behaviour:
    // override = greenish, default = dark.
    const tint = override ? COL_OVERRIDE_BG : COL_DEFAULT_BG
    const bg = this.add.rectangle(px, py, size, size, tint, 0.55).setOrigin(0, 0)
    this._paintContainer.add(bg)

    if (!spriteId || !sprite) return
    const tex = _textureKey(spriteId)
    if (!this.textures.exists(tex)) return

    const img = this.add.image(px + size / 2, py + size / 2, tex).setOrigin(0.5)
    img.setDisplaySize(size, size)
    const angle = (storedRot + viewRot) % 360
    if (angle) img.setAngle(angle)
    if (flipH) img.flipX = true
    if (flipV) img.flipY = true
    this._paintContainer.add(img)
  }

  // Compute the slot-based default sprite for (x, y) by rolling the room's
  // theme. Returns a sprite id or null.
  _defaultSpriteFor(room, x, y) {
    const slot = _defaultSlotAt(room, x, y)
    if (!slot) return null
    if (!room.theme) return null
    return ThemeManager.pickVariant(slot, x, y, room.theme)
  }

  // Paint at view cell (vx, vy) under the current viewRot. Bounds-check is
  // in view space; the painted block is found in room space (the cov×cov
  // square containing all 4 corner mappings of the view block); the anchor
  // is stored at the top-left of that room block; stored rotation
  // = active brush rotation + viewRot (so the sprite's display angle
  // remains constant relative to the user's view, regardless of view
  // orientation).
  _paintAtView(room, vx, vy, viewRot) {
    const sprite = ThemeManager.getSprite(this._activeSpriteId)
    const cov = spriteCoverage(sprite)
    const w = room.width, h = room.height
    const vd = viewDims(w, h, viewRot)

    // Bounds in view space
    if (vx + cov > vd.w || vy + cov > vd.h) {
      if (cov > 1) this._toast(`Sprite is ${cov}×${cov} — too close to edge to fit`, true)
      return
    }

    // Compute the room-space top-left of the cov×cov view block by
    // scanning all 4 corner mappings.
    let minRx = Infinity, minRy = Infinity
    for (let dy = 0; dy < cov; dy++) {
      for (let dx = 0; dx < cov; dx++) {
        const r = viewToRoom(vx + dx, vy + dy, w, h, viewRot)
        if (r.rx < minRx) minRx = r.rx
        if (r.ry < minRy) minRy = r.ry
      }
    }

    // Clear all cov×cov room cells starting at (minRx, minRy) so a
    // previously-anchored sprite doesn't conflict, then stamp the anchor
    // at (minRx, minRy).
    if (cov > 1) {
      for (let dy = 0; dy < cov; dy++) {
        for (let dx = 0; dx < cov; dx++) {
          if (room.tileLayout[minRy + dy]) room.tileLayout[minRy + dy][minRx + dx] = null
        }
      }
    }
    // Stored rotation is what the sprite carries in the room's canonical
    // orientation. The user's brush rotation (`activeRot`) is the angle
    // they see while painting — applied in the rotated view's frame. The
    // render formula in _renderViewCell is `displayed = stored + viewRot`,
    // so for displayed = activeRot we need stored = activeRot - viewRot.
    const stored = ((this._activeRot - viewRot) % 360 + 360) % 360
    // Mirrors are stored in canonical room frame (no view-rotation
    // transform). With view rotation in play, the user's "horizontal"
    // axis may correspond to the room's vertical axis, so flips and view
    // rotation interact at display time. For v1 we keep this simple —
    // power users can experiment with combinations.
    room.tileLayout[minRy][minRx] = writeCellEntry(
      this._activeSpriteId, stored, this._flipH, this._flipV)
  }

  // Legacy entry point — paint at room cell (x, y) at active brush
  // rotation, no view-rotation translation. Kept for callers that already
  // operate in room space (e.g. external scripting / tests).
  _paintAt(room, x, y) {
    const sprite = ThemeManager.getSprite(this._activeSpriteId)
    const cov = spriteCoverage(sprite)
    if (cov > 1) {
      if (x + cov > room.width || y + cov > room.height) {
        this._toast(`Sprite is ${cov}×${cov} — too close to edge to fit`, true)
        return
      }
      // Clear the cov×cov area so any prior overrides don't conflict, then
      // stamp the anchor. Other covered cells stay null — the renderer
      // computes the covered-set from anchor + sprite coverage.
      for (let dy = 0; dy < cov; dy++) {
        for (let dx = 0; dx < cov; dx++) {
          room.tileLayout[y + dy][x + dx] = null
        }
      }
    }
    room.tileLayout[y][x] = writeCellEntry(this._activeSpriteId, this._activeRot)
  }

  // Erase whatever override touches cell (x, y). For non-anchor covered
  // cells of a span sprite, walk back up-left up to (cov_max - 1) steps to
  // find the anchor; clearing the anchor uncovers the whole block.
  _eraseAt(room, x, y) {
    if (room.tileLayout[y]?.[x]) {
      room.tileLayout[y][x] = null
      return
    }
    // Search for an anchor whose span covers (x, y). Max search distance is
    // the largest valid coverage (4) - 1 in each direction.
    const MAX_BACK = 3
    for (let dy = 0; dy <= MAX_BACK && y - dy >= 0; dy++) {
      for (let dx = 0; dx <= MAX_BACK && x - dx >= 0; dx++) {
        if (dx === 0 && dy === 0) continue
        const ax = x - dx, ay = y - dy
        const entry = readCellEntry(room.tileLayout[ay]?.[ax])
        if (!entry) continue
        const sp = ThemeManager.getSprite(entry.id)
        const cov = spriteCoverage(sp)
        if (cov > Math.max(dx, dy)) {
          // Anchor (ax, ay) with coverage cov reaches our cell.
          room.tileLayout[ay][ax] = null
          return
        }
      }
    }
  }

  // ── Sprites panel ────────────────────────────────────────────────────────
  _buildSpritesPanel() {
    this._cSprites.removeAll(true)
    this._cSprites.add(_text(this, SPRITES_X + 12, PANEL_Y + 8, 'SPRITES', {
      fontSize: '13px', color: COL_TEXT_HI, fontStyle: 'bold',
    }).setOrigin(0, 0))
    const rotSuffix = this._activeRot ? `  (${this._activeRot}°)` : ''
    const activeLabel = this._activeSpriteId
      ? `Brush: ${this._activeSpriteId}${rotSuffix}`
      : 'Brush: none (pick one) — R rotates'
    this._cSprites.add(_text(this, SPRITES_X + SPRITES_W - 12, PANEL_Y + 8, activeLabel, {
      fontSize: '11px', color: this._activeSpriteId ? COL_TEXT_HI : COL_TEXT_DIM,
    }).setOrigin(1, 0))

    const top    = PANEL_Y + 30
    const bottom = PANEL_Y + PANEL_H - 8
    const areaH  = bottom - top

    const maskGfx = this.add.graphics().setVisible(false)
      .fillStyle(0xffffff, 1).fillRect(SPRITES_X, top, SPRITES_W, areaH)
    const mask = maskGfx.createGeometryMask()
    const container = this.add.container(0, 0)
    this._cSprites.add(container)
    container.setMask(mask)
    this._spritesGrid = container
    this._spritesArea = { x: SPRITES_X, y: top, w: SPRITES_W, h: areaH }

    this._populateSpritesGrid()
    // Scroll wheel handled by the scene-level _onWheel — see create().
  }

  _populateSpritesGrid() {
    if (!this._spritesGrid) return
    this._spritesGrid.removeAll(true)
    const sprites = ThemeManager.listSprites()
    if (sprites.length === 0) {
      this._spritesGrid.add(_text(this, this._spritesArea.x + 12, this._spritesArea.y + 8,
        '(no sprites yet — drop PNGs in TILESET EDITOR first)', {
          fontSize: '11px', color: COL_TEXT_DIM, wordWrap: { width: this._spritesArea.w - 24 },
        }))
      return
    }
    const perRow = Math.max(1, Math.floor((this._spritesArea.w - 12) / (SPRITE_TILE + SPRITE_GAP)))
    sprites.forEach((s, i) => {
      const col = i % perRow
      const row = Math.floor(i / perRow)
      const tx = this._spritesArea.x + 6 + col * (SPRITE_TILE + SPRITE_GAP)
      const ty = this._spritesArea.y + 6 + row * (SPRITE_TILE + SPRITE_GAP) - this._spritesScroll
      const isActive = s.id === this._activeSpriteId
      const bg = this.add.rectangle(tx, ty, SPRITE_TILE, SPRITE_TILE,
          isActive ? COL_PANEL_HI : COL_PANEL, 1)
        .setOrigin(0, 0).setStrokeStyle(2, isActive ? COL_BORDER_HI : COL_BORDER, 1)
        .setInteractive({ useHandCursor: true })
      bg.on('pointerdown', () => {
        this._activeSpriteId = (this._activeSpriteId === s.id) ? null : s.id
        this._buildSpritesPanel()
      })
      this._spritesGrid.add(bg)

      const tex = _textureKey(s.id)
      if (this.textures.exists(tex)) {
        const img = this.add.image(tx + SPRITE_TILE / 2, ty + SPRITE_TILE / 2, tex).setOrigin(0.5)
        const src = this.textures.get(tex).source[0]
        const scale = (SPRITE_TILE - 4) / Math.max(src.width || 32, src.height || 32)
        img.setScale(scale)
        this._spritesGrid.add(img)
      } else {
        this._spritesGrid.add(_text(this, tx + SPRITE_TILE / 2, ty + SPRITE_TILE / 2, '?', {
          fontSize: '18px', color: COL_TEXT_DIM,
        }).setOrigin(0.5))
      }
    })
  }

  // ── Bottom bar ───────────────────────────────────────────────────────────
  _buildBottomBar() {
    this._cBottom.removeAll(true)
    const y = DESIGN_H - BOT_H + 10
    const h = 30
    const back = this._mkButton(12, y, 100, h, '← BACK', () => this.scene.start('MainMenu'))
    this._cBottom.add(back.parts)

    const save = this._mkButton(DESIGN_W - 130, y, 118, h, 'SAVE TO DISK',
      () => this._save(), 0x2a8050, 0x4ab070)
    this._cBottom.add(save.parts)

    this._cBottom.add(_text(this, DESIGN_W / 2, y + h / 2,
      'Pick a room, assign its theme, then paint. SAVE writes to src/data/rooms.json.', {
        fontSize: '11px', color: COL_TEXT_DIM,
      }).setOrigin(0.5))
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  _activeRoom() {
    return this._rooms.find(r => r.id === this._activeRoomId) || null
  }

  _setZoom(idx) {
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx))
    if (next === this._zoomIdx) return
    this._zoomIdx = next
    this._buildTopBar()
    this._populatePaintCanvas()
  }

  // Step through 0 → 90 → 180 → 270 → 0 (or backwards with dir = -1).
  // Updates the top-bar button label + sprites panel header + redraws so a
  // hover preview (if any) reflects the new angle.
  _cycleRotation(dir) {
    const i = VALID_ROTATIONS.indexOf(this._activeRot)
    const next = (i + (dir > 0 ? 1 : -1) + VALID_ROTATIONS.length) % VALID_ROTATIONS.length
    this._activeRot = VALID_ROTATIONS[next]
    this._buildTopBar()
    this._buildSpritesPanel()
  }

  // Cycle the view rotation. Repaints the paint canvas with the new
  // orientation; existing room data is untouched.
  _cycleViewRotation(dir) {
    const i = VALID_ROTATIONS.indexOf(this._viewRot ?? 0)
    const safeI = i < 0 ? 0 : i
    const next = (safeI + (dir > 0 ? 1 : -1) + VALID_ROTATIONS.length) % VALID_ROTATIONS.length
    this._viewRot = VALID_ROTATIONS[next]
    this._buildTopBar()
    this._populatePaintCanvas()
  }

  _clearAllOverrides() {
    const room = this._activeRoom()
    if (!room) return
    if (!window.confirm(`Clear all per-cell overrides on "${room.name}"? Theme defaults will show through.`)) return
    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) room.tileLayout[y][x] = null
    }
    this._populatePaintCanvas()
    this._populateRoomsList()
  }

  async _save() {
    if (!FsHandle.isSupported()) {
      const blob = new Blob([JSON.stringify(this._rooms, null, 2)], { type: 'application/json' })
      FsHandle.downloadFallback('rooms.json', blob)
      this._toast('FS API unavailable — rooms.json downloaded instead.', true)
      return
    }
    if (!FsHandle.hasRoot()) {
      this._toast('Pick the Quest-Failed/ folder…')
      const root = await FsHandle.acquireRoot()
      if (!root) { this._toast('Folder not granted — save cancelled', true); return }
    }
    try {
      // Strip empty tileLayouts back to []  for rooms with zero overrides,
      // matching the original schema.
      const out = this._rooms.map(r => {
        const cleaned = { ...r }
        if (!_hasAnyOverride(r)) cleaned.tileLayout = []
        return cleaned
      })
      await FsHandle.writeJson('src/data/rooms.json', out)
      // Mirror change into the live cache so other systems see updated
      // theme + tileLayout fields without a reload.
      const live = this.cache.json.get('rooms')
      if (Array.isArray(live)) {
        live.length = 0
        for (const r of out) live.push(structuredClone(r))
      }
      this._toast('Saved.')
      this._buildTopBar()
    } catch (err) {
      console.error('[RoomTileEditor] save failed:', err)
      this._toast('Save failed: ' + (err?.message || err), true)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  _refreshAll() {
    this._buildTopBar()
    this._populateRoomsList()
    this._populatePaintCanvas()
    this._populateSpritesGrid()
    this._buildBottomBar()
  }

  _renderEmpty(msg) {
    this._gBg = this.add.graphics().fillStyle(COL_BG, 1).fillRect(0, 0, DESIGN_W, DESIGN_H)
    this.add.text(DESIGN_W / 2, DESIGN_H / 2, msg, {
      fontSize: '18px', color: COL_TEXT_WARN, fontFamily: 'monospace',
    }).setOrigin(0.5)
    this.add.text(DESIGN_W / 2, DESIGN_H / 2 + 30, '(BACK to menu)', {
      fontSize: '14px', color: COL_TEXT, fontFamily: 'monospace',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('MainMenu'))
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
    const ty = DESIGN_H - BOT_H - 30
    const t = _text(this, tx, ty, msg, {
      fontSize: '13px', color: isError ? COL_TEXT_WARN : COL_TEXT_HI,
      backgroundColor: '#0a0514', padding: { x: 10, y: 6 },
    }).setOrigin(0.5)
    this._cToast.add(t)
    this.tweens.add({
      targets: t, alpha: { from: 1, to: 0 }, duration: 2400, delay: 800,
      onComplete: () => t.destroy(),
    })
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────

// Resolve the default slot for a cell of a rectangular room. Returns slot
// name or null (shouldn't happen for in-bounds cells).
function _defaultSlotAt(room, x, y) {
  const w = room.width  | 0
  const h = room.height | 0
  if (x < 0 || x >= w || y < 0 || y >= h) return null
  const isLeft   = x === 0
  const isRight  = x === w - 1
  const isTop    = y === 0
  const isBottom = y === h - 1
  if (isTop && isLeft)     return 'wall_corner_tl'
  if (isTop && isRight)    return 'wall_corner_tr'
  if (isBottom && isLeft)  return 'wall_corner_bl'
  if (isBottom && isRight) return 'wall_corner_br'
  if (isTop)               return 'wall'
  if (isBottom)            return 'wall_bottom'
  if (isLeft)              return 'wall_left'
  if (isRight)             return 'wall_right'
  return FLOOR_SLOT
}

function _countOverrides(room) {
  let n = 0
  if (!Array.isArray(room.tileLayout)) return 0
  for (const row of room.tileLayout) {
    if (!Array.isArray(row)) continue
    for (const v of row) if (v) n++
  }
  return n
}

function _hasAnyOverride(room) { return _countOverrides(room) > 0 }

function _panel(g, x, y, w, h) {
  g.fillStyle(COL_PANEL, 1).fillRect(x, y, w, h)
  g.lineStyle(1, COL_BORDER, 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
}

function _text(scene, x, y, str, style) {
  return scene.add.text(x, y, str, Object.assign({ fontFamily: 'monospace' }, style || {}))
}

function _textureKey(id) { return `themesprite-${id}` }

async function _blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

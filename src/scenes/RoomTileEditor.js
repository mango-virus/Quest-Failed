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

import { RoomEditorOverlay, EDITOR_LAYOUT } from '../hud/RoomEditorOverlay.js'
import { FsHandle }      from '../systems/FsHandle.js'
import { EventBus }      from '../systems/EventBus.js'
import { Balance }       from '../config/balance.js'
import {
  ThemeManager, FLOOR_SLOT, spriteCoverage, spriteCoverageHW,
  readCellEntry, writeCellEntry, VALID_ROTATIONS,
  makeSpriteId, spritePath, autoSlotForId, slotGroups, slotLabel, ALL_SLOTS,
  roomSkinPath, roomSkinTextureKey,
} from '../systems/ThemeManager.js'
import { DecorManager, DECOR_TEXTURE_KEY, DECOR_MANIFEST_PATH } from '../systems/DecorManager.js'

// ── Palette (paint-canvas cell rendering) ───────────────────────────────────
const COL_BG          = 0x0a0514
const COL_PANEL       = 0x140a26
const COL_BORDER      = 0x3a1f5a
const COL_BORDER_HI   = 0x9b32d4
const COL_TEXT        = '#d8c8e8'
const COL_TEXT_DIM    = '#7a6e8e'
const COL_TEXT_HI     = '#ffd0a0'
const COL_TEXT_WARN   = '#ff8870'
const COL_PAINT_HOVER = 0x9b32d4
const COL_OVERRIDE_BG = 0x2a4818  // greenish tint behind cells with overrides
const COL_DEFAULT_BG  = 0x101820  // dark fill behind cells with no override

const TILE_PX = 32

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

// View-space bounding rect (in cells) of a covW×covH ROOM block anchored at
// (rx, ry), under viewRot. Generalizes viewBlockTopLeft for non-square tiles:
// for a 1×2 tile the view dims swap to 2×1 when viewRot is 90/270, so we
// return both the top-left and the rotated view dimensions (vw × vh).
function viewBlockRect(rx, ry, covW, covH, roomW, roomH, viewRot) {
  let minVx = Infinity, minVy = Infinity, maxVx = -Infinity, maxVy = -Infinity
  for (let dy = 0; dy < covH; dy++) {
    for (let dx = 0; dx < covW; dx++) {
      const v = roomToView(rx + dx, ry + dy, roomW, roomH, viewRot)
      if (v.vx < minVx) minVx = v.vx
      if (v.vx > maxVx) maxVx = v.vx
      if (v.vy < minVy) minVy = v.vy
      if (v.vy > maxVy) maxVy = v.vy
    }
  }
  return { vx: minVx, vy: minVy, vw: maxVx - minVx + 1, vh: maxVy - minVy + 1 }
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
    // layout shifts). A single _applyEditorCamera call at the wrong moment
    // computes a tiny zoom and the editor renders effectively invisible.
    // Same pattern MainMenu uses for the same reason.
    this._applyEditorCamera()
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
    if (_session && _session.viewRot == null)          _session.viewRot          = 0
    if (_session && _session.flipH   == null)          _session.flipH            = false
    if (_session && _session.flipV   == null)          _session.flipV            = false
    if (_session && _session.paintMode == null)        _session.paintMode        = 'room'
    if (_session && _session.activeDecorSpriteId == null) _session.activeDecorSpriteId = null
    if (_session && _session.decorSolid == null)      _session.decorSolid       = false
    if (_session && _session.decorLayer == null)      _session.decorLayer       = 'floor'
    if (_session && _session.decorSize == null)       _session.decorSize        = 1
    if (_session && _session.showGrid == null)        _session.showGrid         = true
    if (!_matchesCache(_session, roomsFromCache)) {
      const rooms = structuredClone(roomsFromCache)
      rooms.forEach(r => this._ensureRoomShape(r))
      _session = {
        rooms,
        activeRoomId:        rooms[0]?.id || null,
        activeSpriteId:      null,
        activeDecorSpriteId: null,   // separate brush for decor mode
        decorSolid:          false,  // does the decor block movement?
        decorLayer:          'floor', // 'floor' | 'object'
        decorSize:           1,      // 1 = 1×1, 2 = 2×2
        activeRot:           0,
        viewRot:             0,
        flipH:               false,
        flipV:               false,
        eraserMode:          false,
        zoomIdx:             2,
        paintMode:           'room',  // 'room' | 'door-*' | 'decor'
        showGrid:            true,    // draw per-cell grid lines on the canvas
      }
      freshSession = true
    }
    this._sessionFresh = freshSession

    // Bind editor instance fields to the session. Mutating these via the
    // setters (defined below the instance fields) writes through to
    // `_session` so the next entry sees the latest state.
    this._rooms = _session.rooms
    Object.defineProperty(this, '_activeRoomId',        _propAccessor(_session, 'activeRoomId'))
    Object.defineProperty(this, '_activeSpriteId',      _propAccessor(_session, 'activeSpriteId'))
    Object.defineProperty(this, '_activeDecorSpriteId', _propAccessor(_session, 'activeDecorSpriteId'))
    Object.defineProperty(this, '_decorSolid',          _propAccessor(_session, 'decorSolid'))
    Object.defineProperty(this, '_decorLayer',          _propAccessor(_session, 'decorLayer'))
    Object.defineProperty(this, '_decorSize',           _propAccessor(_session, 'decorSize'))
    Object.defineProperty(this, '_activeRot',           _propAccessor(_session, 'activeRot'))
    Object.defineProperty(this, '_viewRot',             _propAccessor(_session, 'viewRot'))
    Object.defineProperty(this, '_flipH',               _propAccessor(_session, 'flipH'))
    Object.defineProperty(this, '_flipV',               _propAccessor(_session, 'flipV'))
    Object.defineProperty(this, '_eraserMode',          _propAccessor(_session, 'eraserMode'))
    Object.defineProperty(this, '_zoomIdx',             _propAccessor(_session, 'zoomIdx'))
    Object.defineProperty(this, '_paintMode',           _propAccessor(_session, 'paintMode'))
    Object.defineProperty(this, '_showGrid',            _propAccessor(_session, 'showGrid'))

    // The Phaser scene renders ONLY the paint canvas + transient toasts. All
    // chrome (header / rooms list / mode tabs / view controls / context panel
    // / hint bar) is the RoomEditorOverlay DOM layer, which shares this scene's
    // 1920×1080 logical space (see _applyEditorCamera) so the panels frame the
    // grid exactly. The DOM drives the scene through the ui* methods.
    this._cPaint = this.add.container(0, 0).setDepth(3)
    this._cToast = this.add.container(0, 0).setDepth(20)

    this._paintAreaRect = { ...EDITOR_LAYOUT.canvas }
    this._buildPaintPanel()
    this._overlay = new RoomEditorOverlay(this)
    this._overlay.open()
    this.events.once('shutdown', () => { this._overlay?.close(); this._overlay = null })

    // R cycles brush rotation 0 → 90 → 180 → 270 → 0. Useful for reusing
    // one sprite at multiple orientations across cells of the same room.
    this.input.keyboard?.on('keydown-R', () => { this._cycleRotation(+1); this._notifyDom() })
    // V cycles the canvas view rotation (room data unchanged; paints made
    // while rotated bake the view rotation into the stored tile rotation).
    this.input.keyboard?.on('keydown-V', () => { this._cycleViewRotation(+1); this._notifyDom() })

    // Ctrl/⌘+Z = undo. A window listener (not Phaser) so the modifier combo
    // is caught reliably; ignored while typing in a field / the theme & skin
    // modals' inputs so it doesn't hijack text editing.
    this._onUndoKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return
      const tag = (e.target?.tagName || '').toUpperCase()
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      e.preventDefault()
      this.uiUndo()
    }
    window.addEventListener('keydown', this._onUndoKey)
    this.events.once('shutdown', () => window.removeEventListener('keydown', this._onUndoKey))

    FsHandle.tryRestoreRoot().catch(() => {})
    this._initialLoad()
  }

  _reapplyCamera() { this._applyEditorCamera(); this._overlay?.onResize?.() }

  // Camera that matches the DOM stageScale transform exactly: a fixed
  // 1920×1080 logical space, fit-scaled to the window and centred. Pairing
  // setZoom(s) with centerOn(960,540) reproduces stageScale's
  // `translate(-50%,-50%) scale(s)` so a logical point in the overlay maps to
  // the same screen pixel the camera paints — that shared space is what lets
  // the DOM chrome frame the Phaser paint canvas pixel-for-pixel.
  _applyEditorCamera() {
    const cam = this.cameras.main
    const sw = this.scale.width, sh = this.scale.height
    if (sw < 32 || sh < 32) { this.uiW = 1920; this.uiH = 1080; this.uiSf = 1; return }
    const s = Math.min(sw / 1920, sh / 1080)
    cam.setBackgroundColor(COL_BG)
    cam.setZoom(s)
    cam.centerOn(1920 / 2, 1080 / 2)
    this.uiW = 1920; this.uiH = 1080; this.uiSf = s
  }

  // Push current editor state to the DOM overlay so its chrome re-syncs.
  _notifyDom() { this._overlay?.refresh() }

  // ── DOM overlay API (ui*) ──────────────────────────────────────────────────
  // The RoomEditorOverlay calls these; each mutates the shared session and
  // re-renders the paint canvas, then the overlay reads back via uiGetState.

  // Which mode tab is active. Colors rides paintMode 'room' (it tints the
  // same room view) so it's tracked with a separate flag.
  _activeTab() {
    if (this._colorsTab) return 'colors'
    if (this._paintMode === 'decor') return 'decor'
    if (this._paintMode.startsWith('door-')) return 'doors'
    return 'tiles'
  }

  uiGetState() {
    const active = this._activeRoom()
    const rooms = (this._rooms || []).map(r => ({
      id: r.id, name: r.name, width: r.width, height: r.height,
      hasOverrides:
        (Array.isArray(r.tileLayout) && r.tileLayout.some(row => Array.isArray(row) && row.some(c => c))) ||
        (Array.isArray(r.decorations) && r.decorations.length > 0),
    }))
    return {
      rooms,
      activeRoomId: this._activeRoomId,
      activeRoom: active ? { id: active.id, name: active.name, width: active.width, height: active.height } : null,
      tab: this._activeTab(),
      zoomLabel: `${Math.round(ZOOM_LEVELS[this._zoomIdx] * 100)}%`,
      viewRot: this._viewRot || 0,
      activeRot: this._activeRot || 0,
      flipH: !!this._flipH,
      flipV: !!this._flipV,
      eraser: !!this._eraserMode,
      moveMode: !!this._moveMode,
      holding: !!this._heldTile,
      heldId: this._heldTile?.id || null,
      canUndo: this.uiCanUndo(),
      showGrid: this._showGrid !== false,
      folderName: FsHandle.hasRoot() ? FsHandle.rootName() : null,
    }
  }

  uiSelectRoom(id) {
    if (id === this._activeRoomId) return
    this._clearHeld()
    this._skinTarget = 'default'
    this._activeRoomId = id
    this._refreshAll()
  }

  uiSetTab(tab) {
    this._clearHeld()
    this._colorsTab = (tab === 'colors')
    if (tab === 'tiles' || tab === 'colors') this._paintMode = 'room'
    else if (tab === 'decor') this._paintMode = 'decor'
    else if (tab === 'doors' && !this._paintMode.startsWith('door-')) this._paintMode = 'door-closed'
    if (this._paintMode !== 'room') this._moveMode = false  // Move tool is tiles-only
    this._populatePaintCanvas()
    this._notifyDom()
  }

  uiZoom(dir)        { this._setZoom(this._zoomIdx + (dir > 0 ? 1 : -1)); this._notifyDom() }
  uiRotateView()     { this._cycleViewRotation(+1); this._notifyDom() }
  uiRotateTile()     { this._cycleRotation(+1); this._notifyDom() }
  uiToggleFlipH()    { this._flipH = !this._flipH; this._notifyDom() }
  uiToggleFlipV()    { this._flipV = !this._flipV; this._notifyDom() }
  uiToggleEraser()   { this._eraserMode = !this._eraserMode; if (this._eraserMode) this._clearHeld(); this._notifyDom() }
  uiToggleGrid()     { this._showGrid = this._showGrid === false; this._populatePaintCanvas(); this._notifyDom() }
  uiToggleMove() {
    this._moveMode = !this._moveMode
    if (this._moveMode) this._eraserMode = false
    this._clearHeld()
    this._populatePaintCanvas()
    this._notifyDom()
  }
  _clearHeld() { this._heldTile = null; this._heldFrom = null }
  uiSave()           { this._save() }
  uiBack()           { this.scene.start('MainMenu') }

  uiResizeRoom() {
    const room = this._activeRoom()
    if (!room) return
    this._pushUndo()
    this._promptResize(room)
    this._refreshAll()
  }

  // ── Undo (snapshot of the active room's editable state) ─────────────────────
  _snapshotRoom(room) {
    return {
      roomId:          room.id,
      tileLayout:      structuredClone(room.tileLayout ?? []),
      decorations:     structuredClone(room.decorations ?? []),
      doorTiles:       room.doorTiles ? structuredClone(room.doorTiles) : null,
      doorApron:       room.doorApron ? structuredClone(room.doorApron) : null,
      doorTilesByBoss: room.doorTilesByBoss ? structuredClone(room.doorTilesByBoss) : null,
      doorApronByBoss: room.doorApronByBoss ? structuredClone(room.doorApronByBoss) : null,
      colorAdjust:     room.colorAdjust ? structuredClone(room.colorAdjust) : null,
      connectionPoints: structuredClone(room.connectionPoints ?? []),
      theme:           room.theme ?? null,
      doorTheme:       room.doorTheme ?? null,
      backgroundImage: room.backgroundImage ?? null,
      backgroundImageByBoss: room.backgroundImageByBoss ? structuredClone(room.backgroundImageByBoss) : null,
      width:           room.width,
      height:          room.height,
    }
  }
  // Capture the active room's state BEFORE a mutation so uiUndo can restore it.
  _pushUndo() {
    const room = this._activeRoom()
    if (!room) return
    this._undoStack ||= []
    this._undoStack.push(this._snapshotRoom(room))
    if (this._undoStack.length > 80) this._undoStack.shift()
    this._notifyDom()
  }
  uiCanUndo() { return !!(this._undoStack && this._undoStack.length) }
  uiUndo() {
    const stack = this._undoStack
    if (!stack || !stack.length) { this._toast('Nothing to undo'); return }
    this._clearHeld()
    const snap = stack.pop()
    if (snap.roomId !== this._activeRoomId) this._activeRoomId = snap.roomId
    const room = this._rooms.find(r => r.id === snap.roomId)
    if (room) {
      room.tileLayout      = snap.tileLayout
      room.decorations     = snap.decorations
      room.doorTiles       = snap.doorTiles
      room.doorApron       = snap.doorApron
      room.doorTilesByBoss = snap.doorTilesByBoss
      room.doorApronByBoss = snap.doorApronByBoss
      room.colorAdjust     = snap.colorAdjust
      room.connectionPoints = snap.connectionPoints
      room.theme           = snap.theme
      room.doorTheme       = snap.doorTheme
      room.backgroundImage = snap.backgroundImage
      room.backgroundImageByBoss = snap.backgroundImageByBoss
      room.width           = snap.width
      room.height          = snap.height
    }
    this._refreshAll()
    this._toast('Undo')
  }
  // One undo entry per colour-slider drag (the DOM slider's pointerdown).
  uiBeginColorEdit() { this._pushUndo() }

  // ── Phase 4: full-room skins ────────────────────────────────────────────────
  _pendingSkinBytes() { return (this._pendingSkinPngs ||= new Map()) }

  uiListRoomSkins() {
    return ThemeManager.listRoomSkins().map(s => ({ id: s.id, thumb: this._texThumb(roomSkinTextureKey(s.id)) }))
  }
  // ── Skin targets ────────────────────────────────────────────────────────────
  // The boss chamber can hold a unique skin per boss. The active "skin target"
  // is 'default' (room.backgroundImage) or a boss archetype id (a key in
  // room.backgroundImageByBoss). Other rooms only have 'default'.
  _isBossChamber() { return (this._activeRoom()?.id || this._activeRoom()?.definitionId) === 'boss_chamber' }
  uiSkinTargets() {
    if (!this._isBossChamber()) return null
    const bosses = this.cache.json.get('bossArchetypes') || []
    return [
      { key: 'default', label: 'Default (any boss)' },
      ...bosses.map(b => ({ key: b.id, label: b.name || b.id })),
    ]
  }
  uiSkinTarget() { return this._skinTarget || 'default' }
  uiSetSkinTarget(target) { this._skinTarget = target || 'default'; this._refreshAll() }

  // Skin id assigned to the active room for a given target.
  _skinIdForTarget(room, target) {
    if (room?.id === 'boss_chamber' && target && target !== 'default') {
      return room.backgroundImageByBoss?.[target] || null
    }
    return room?.backgroundImage || null
  }
  // Skin id the editor canvas should preview (boss chamber → selected boss's
  // skin, falling back to the default; other rooms → backgroundImage).
  _editorSkinId(room) {
    if (room?.id === 'boss_chamber' && this._skinTarget && this._skinTarget !== 'default') {
      return room.backgroundImageByBoss?.[this._skinTarget] || room.backgroundImage || null
    }
    return room?.backgroundImage || null
  }
  uiCurrentRoomSkin() { return this._skinIdForTarget(this._activeRoom(), this.uiSkinTarget()) }

  // ── Per-boss door swatches ────────────────────────────────────────────────────
  // The boss chamber can carry a unique door swatch per boss, keyed in
  // room.doorTilesByBoss[boss][state] + room.doorApronByBoss[boss][state]
  // (mirrors backgroundImageByBoss). The active target is the shared
  // `_skinTarget`; every other room / 'default' uses room.doorTiles[state].
  _doorTargetActive(room) {
    return room?.id === 'boss_chamber' && this._skinTarget && this._skinTarget !== 'default'
  }
  // Token folded into door-skin sprite ids so each boss's slices are distinct.
  _doorTargetTag(room) { return this._doorTargetActive(room) ? this._skinTarget : 'default' }
  // Ensure + return the door-tiles grid ([row0,row1]) for the active target+state.
  _ensureDoorTiles(room, state) {
    if (this._doorTargetActive(room)) {
      const t = this._skinTarget
      room.doorTilesByBoss = room.doorTilesByBoss || {}
      room.doorTilesByBoss[t] = room.doorTilesByBoss[t] || {}
      if (!Array.isArray(room.doorTilesByBoss[t][state]))
        room.doorTilesByBoss[t][state] = [[null, null, null, null], [null, null, null, null]]
      return room.doorTilesByBoss[t][state]
    }
    room.doorTiles = room.doorTiles || {}
    if (!Array.isArray(room.doorTiles[state]))
      room.doorTiles[state] = [[null, null, null, null], [null, null, null, null]]
    return room.doorTiles[state]
  }
  // Ensure + return the apron row ([4]) for the active target+state.
  _ensureDoorApron(room, state) {
    if (this._doorTargetActive(room)) {
      const t = this._skinTarget
      room.doorApronByBoss = room.doorApronByBoss || {}
      room.doorApronByBoss[t] = room.doorApronByBoss[t] || {}
      if (!Array.isArray(room.doorApronByBoss[t][state]))
        room.doorApronByBoss[t][state] = [null, null, null, null]
      return room.doorApronByBoss[t][state]
    }
    room.doorApron = room.doorApron || {}
    if (!Array.isArray(room.doorApron[state]))
      room.doorApron[state] = [null, null, null, null]
    return room.doorApron[state]
  }
  // Assign a freshly-built grid / row into the active target+state.
  _setDoorTiles(room, state, grid) {
    if (this._doorTargetActive(room)) {
      const t = this._skinTarget
      room.doorTilesByBoss = room.doorTilesByBoss || {}
      room.doorTilesByBoss[t] = room.doorTilesByBoss[t] || {}
      room.doorTilesByBoss[t][state] = grid
    } else {
      room.doorTiles = room.doorTiles || {}
      room.doorTiles[state] = grid
    }
  }
  _setDoorApron(room, state, row) {
    if (this._doorTargetActive(room)) {
      const t = this._skinTarget
      room.doorApronByBoss = room.doorApronByBoss || {}
      room.doorApronByBoss[t] = room.doorApronByBoss[t] || {}
      room.doorApronByBoss[t][state] = row
    } else {
      room.doorApron = room.doorApron || {}
      room.doorApron[state] = row
    }
  }

  // Ingest edited PNG(s) as full-room skins (library items): register the
  // texture, add to the skin registry, stage bytes for save. Returns {added, ids}.
  async uiUploadRoomSkin(droppedFiles = null) {
    let files = droppedFiles
    if (!files) {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = 'image/png,image/webp'; input.multiple = true
      input.style.display = 'none'; document.body.appendChild(input)
      files = await new Promise(res => {
        input.onchange = () => res(Array.from(input.files || []))
        input.oncancel = () => res([])
        input.click()
      })
      input.remove()
    }
    files = (files || []).filter(f => /image\/(png|webp)/.test(f.type) || /\.(png|webp)$/i.test(f.name))
    const ids = []
    for (const file of files) {
      const id = makeSpriteId(file.name)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const dataUrl = await _blobToDataUrl(file)
      ThemeManager.addRoomSkin(id, roomSkinPath(id))
      this._pendingSkinBytes().set(id, bytes)
      try { await this._addTextureFromDataUrl(roomSkinTextureKey(id), dataUrl) } catch (_) { /* ignore */ }
      if (this._thumbCache) delete this._thumbCache[roomSkinTextureKey(id)]
      ids.push(id)
    }
    this._notifyDom()
    return { added: ids.length, ids }
  }

  uiApplyRoomSkin(id) {
    const room = this._activeRoom()
    if (!room || !ThemeManager.hasRoomSkin(id)) return
    this._pushUndo()
    const target = this.uiSkinTarget()
    if (room.id === 'boss_chamber' && target !== 'default') {
      room.backgroundImageByBoss = room.backgroundImageByBoss || {}
      room.backgroundImageByBoss[target] = id
    } else {
      room.backgroundImage = id
    }
    this._refreshAll()
  }
  uiClearRoomSkin() {
    const room = this._activeRoom()
    if (!room) return
    this._pushUndo()
    const target = this.uiSkinTarget()
    if (room.id === 'boss_chamber' && target !== 'default') {
      if (room.backgroundImageByBoss) delete room.backgroundImageByBoss[target]
    } else {
      room.backgroundImage = null
    }
    this._refreshAll()
  }
  uiDeleteRoomSkin(id) {
    ThemeManager.removeRoomSkin(id)
    for (const r of this._rooms) {
      if (r.backgroundImage === id) r.backgroundImage = null
      if (r.backgroundImageByBoss) {
        for (const k of Object.keys(r.backgroundImageByBoss)) {
          if (r.backgroundImageByBoss[k] === id) delete r.backgroundImageByBoss[k]
        }
      }
    }
    this._pendingSkinBytes().delete(id)
    this._refreshAll()
  }

  // Persist skins end-to-end: skin PNGs + manifest (the registry) + rooms.json
  // (the per-room backgroundImage assignments) in one click.
  async uiSaveSkins() {
    if (!FsHandle.isSupported()) { this._toast('File System API unavailable', true); return { ok: false } }
    if (!FsHandle.hasRoot()) {
      this._toast('Pick the Quest-Failed/ folder…')
      const root = await FsHandle.acquireRoot()
      if (!root) { this._toast('Folder not granted — save cancelled', true); return { ok: false } }
    }
    try {
      for (const [id, bytes] of this._pendingSkinBytes()) {
        await FsHandle.writeFile(roomSkinPath(id), new Blob([bytes], { type: 'image/png' }))
      }
      this._pendingSkinBytes().clear()
      await FsHandle.writeJson('assets/themes/manifest.json', ThemeManager.serialize())
      await this._save()   // writes rooms.json (backgroundImage) + emits ROOMS_ALL_RESET
      this._toast('Skins + room assignments saved.')
      this._notifyDom()
      return { ok: true }
    } catch (err) {
      console.error('[RoomTileEditor] skin save failed:', err)
      this._toast('Save failed: ' + (err?.message || err), true)
      return { ok: false }
    }
  }

  // ── Phase 3: export the exact built room as a PNG ───────────────────────────
  // Renders the room in CANONICAL orientation at native 32px/tile to an
  // offscreen canvas — theme/override tiles (with span coverage, per-cell
  // rotation/flip + per-target colour adjust baked via ctx.filter) then the
  // decoration layer on top — and downloads it. Un-painted cells stay
  // transparent so the PNG is an editable starting point for a full-room skin.
  uiExportRoomPng() {
    const room = this._activeRoom()
    if (!room) return { ok: false }
    const TS = 32, W = room.width, H = room.height
    const WT = Balance.WALL_THICKNESS ?? 1
    const canvas = document.createElement('canvas')
    canvas.width = W * TS; canvas.height = H * TS
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false

    const filterFor = (adj) => {
      if (!adj) return 'none'
      const p = []
      if (adj.hue)      p.push(`hue-rotate(${adj.hue}deg)`)
      if (adj.sat)      p.push(`saturate(${Math.max(0, 1 + adj.sat)})`)
      if (adj.bright)   p.push(`brightness(${Math.max(0, 1 + adj.bright)})`)
      if (adj.contrast) p.push(`contrast(${Math.max(0, 1 + adj.contrast)})`)
      return p.length ? p.join(' ') : 'none'
    }
    const drawImg = (key, cx, cy, sizeW, rot, flipH, flipV, filter, sizeH = sizeW) => {
      if (!this.textures.exists(key)) return
      const src = this.textures.get(key).getSourceImage()
      if (!src) return
      ctx.save()
      ctx.filter = filter || 'none'
      ctx.translate(cx + sizeW / 2, cy + sizeH / 2)
      if (rot) ctx.rotate(rot * Math.PI / 180)
      if (flipH || flipV) ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
      try { ctx.drawImage(src, -sizeW / 2, -sizeH / 2, sizeW, sizeH) } catch (_) { /* tainted */ }
      ctx.restore()
    }

    // Span pre-pass: cells covered by a >1 coverage anchor are skipped.
    const covered = new Set()
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const e = readCellEntry(room.tileLayout[y]?.[x]); if (!e) continue
      const { w: covW, h: covH } = spriteCoverageHW(ThemeManager.getSprite(e.id))
      if (covW <= 1 && covH <= 1) continue
      for (let dy = 0; dy < covH; dy++) for (let dx = 0; dx < covW; dx++) {
        if (dx || dy) covered.add(`${x + dx},${y + dy}`)
      }
    }
    // Tile pass.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (covered.has(`${x},${y}`)) continue
      const override = readCellEntry(room.tileLayout[y]?.[x])
      const spriteId = override?.id || this._defaultSpriteFor(room, x, y)
      if (!spriteId) continue
      const { w: covW, h: covH } = spriteCoverageHW(ThemeManager.getSprite(spriteId))
      const isFloor = x >= WT && x < W - WT && y >= WT && y < H - WT
      const filter = filterFor(room.colorAdjust?.[isFloor ? 'floor' : 'walls'])
      drawImg(_textureKey(spriteId), x * TS, y * TS, covW * TS,
        override?.rot || 0, !!override?.flipH, !!override?.flipV, filter, covH * TS)
    }
    // Decor pass (on top).
    for (const decor of (room.decorations || [])) {
      const sz = (decor.size ?? 1) * TS
      drawImg(DECOR_TEXTURE_KEY(decor.spriteId), decor.x * TS, decor.y * TS, sz,
        decor.rot || 0, !!decor.flipH, !!decor.flipV, 'none')
    }

    let url
    try { url = canvas.toDataURL('image/png') }
    catch (err) { this._toast('Export failed (texture security): ' + (err?.message || err), true); return { ok: false } }
    const a = document.createElement('a')
    a.href = url
    a.download = `room_${room.id}_${W}x${H}.png`
    document.body.appendChild(a); a.click(); a.remove()
    this._toast(`Exported ${room.name} (${W}×${H}) PNG`)
    return { ok: true, w: W, h: H }
  }

  // CSS filter approximating Phaser's per-target ColorMatrix (used when baking
  // colour into exported PNGs).
  _cssColorFilter(adj) {
    if (!adj) return 'none'
    const p = []
    if (adj.hue)      p.push(`hue-rotate(${adj.hue}deg)`)
    if (adj.sat)      p.push(`saturate(${Math.max(0, 1 + adj.sat)})`)
    if (adj.bright)   p.push(`brightness(${Math.max(0, 1 + adj.bright)})`)
    if (adj.contrast) p.push(`contrast(${Math.max(0, 1 + adj.contrast)})`)
    return p.length ? p.join(' ') : 'none'
  }
  _drawTexToCtx(ctx, key, cx, cy, sizeW, rot, flipH, flipV, filter, sizeH = sizeW) {
    if (!this.textures.exists(key)) return
    const src = this.textures.get(key).getSourceImage()
    if (!src) return
    ctx.save()
    ctx.filter = filter || 'none'
    ctx.translate(cx + sizeW / 2, cy + sizeH / 2)
    if (rot) ctx.rotate(rot * Math.PI / 180)
    if (flipH || flipV) ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    try { ctx.drawImage(src, -sizeW / 2, -sizeH / 2, sizeW, sizeH) } catch (_) { /* tainted */ }
    ctx.restore()
  }
  _curDoorState() { return this._paintMode.startsWith('door-') ? this._paintMode.slice(5) : 'closed' }

  // ── Door export + skins (per state, full 4×2 swatch incl. jambs) ────────────
  // Export the current door state's painted swatch as a PNG (4 cols × 2 rows at
  // 64px/cell = 256×128) for external editing.
  uiExportDoorPng() {
    const room = this._activeRoom()
    if (!room) return { ok: false }
    const state = this._curDoorState()
    const dt = this._ensureDoorTiles(room, state)
    const apron = this._ensureDoorApron(room, state)
    const grid = [dt[0], dt[1], apron]   // rows: Outer, Inner, Below(apron)
    const CELL = 64, COLS = 4, ROWS = 3
    const canvas = document.createElement('canvas')
    canvas.width = COLS * CELL; canvas.height = ROWS * CELL
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false
    const filter = this._cssColorFilter(room.colorAdjust?.walls)
    const covered = new Set()
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const e = readCellEntry(grid[r]?.[c]); if (!e) continue
      const { w: covW, h: covH } = spriteCoverageHW(ThemeManager.getSprite(e.id))
      if (covW <= 1 && covH <= 1) continue
      for (let dy = 0; dy < covH; dy++) for (let dx = 0; dx < covW; dx++) if (dx || dy) covered.add(`${c + dx},${r + dy}`)
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (covered.has(`${c},${r}`)) continue
      const e = readCellEntry(grid[r]?.[c]); if (!e) continue
      const { w: covW, h: covH } = spriteCoverageHW(ThemeManager.getSprite(e.id))
      this._drawTexToCtx(ctx, _textureKey(e.id), c * CELL, r * CELL, covW * CELL, e.rot || 0, !!e.flipH, !!e.flipV, filter, covH * CELL)
    }
    let url
    try { url = canvas.toDataURL('image/png') }
    catch (err) { this._toast('Export failed: ' + (err?.message || err), true); return { ok: false } }
    const a = document.createElement('a')
    a.href = url; a.download = `door_${room.id}_${state}.png`
    document.body.appendChild(a); a.click(); a.remove()
    this._toast(`Exported ${room.name} door (${state}) PNG`)
    return { ok: true }
  }

  // Re-import an edited door PNG: scale to the canonical 256×128 (4×2 @ 64px),
  // slice into cells, register each non-empty slice as a sprite, and paint them
  // into doorTiles[state]. Reuses the existing per-cell door rendering.
  async uiUploadDoorSkin(droppedFiles = null) {
    const room = this._activeRoom()
    if (!room) return { ok: false }
    const state = this._curDoorState()
    let files = droppedFiles
    if (!files) {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = 'image/png,image/webp'; input.multiple = false
      input.style.display = 'none'; document.body.appendChild(input)
      files = await new Promise(res => {
        input.onchange = () => res(Array.from(input.files || []))
        input.oncancel = () => res([])
        input.click()
      })
      input.remove()
    }
    files = (files || []).filter(f => /image\/(png|webp)/.test(f.type) || /\.(png|webp)$/i.test(f.name))
    if (!files.length) return { ok: false }
    const dataUrl = await _blobToDataUrl(files[0])
    const img = await _loadImage(dataUrl)
    const COLS = 4, ROWS = 3, CELL = 64, W = COLS * CELL, H = ROWS * CELL   // 256×192 (3 rows)
    const base = document.createElement('canvas'); base.width = W; base.height = H
    const bctx = base.getContext('2d'); bctx.imageSmoothingEnabled = false
    if (this._doorSkinStretch) {
      // Stretch: distort the image to fill the full 4×3 grid.
      bctx.drawImage(img, 0, 0, W, H)
    } else {
      // Fit (default): preserve aspect ratio, anchored at the TOP so the door's
      // top seam lines up with the Outer row. Unfilled area (typically the
      // apron row, when the source is a door-only image) stays transparent.
      const scale = Math.min(W / img.width, H / img.height)
      const dw = Math.round(img.width * scale), dh = Math.round(img.height * scale)
      bctx.drawImage(img, Math.round((W - dw) / 2), 0, dw, dh)
    }

    this._pushUndo()
    const tag = this._doorTargetTag(room)   // 'default' or a boss id — keeps per-boss slices distinct
    const dtGrid = [[null, null, null, null], [null, null, null, null]]   // door (rows 0-1)
    const apronRow = [null, null, null, null]                            // apron (row 2)
    let made = 0
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const slice = document.createElement('canvas'); slice.width = CELL; slice.height = CELL
      const sctx = slice.getContext('2d')
      sctx.drawImage(base, c * CELL, r * CELL, CELL, CELL, 0, 0, CELL, CELL)
      const data = sctx.getImageData(0, 0, CELL, CELL).data
      let opaque = false
      for (let i = 3; i < data.length; i += 4) { if (data[i] > 8) { opaque = true; break } }
      if (!opaque) continue   // skip fully-transparent cells
      const id = `dskin_${room.id}_${tag}_${state}_${c}${r}`
      const url = slice.toDataURL('image/png')
      ThemeManager.addSprite(id, { srcSize: 64, mode: 'scale', theme: null, file: spritePath(id) })
      this._pendingThemeBytes().set(id, _dataUrlToBytes(url))
      try { await this._addTextureFromDataUrl(_textureKey(id), url) } catch (_) { /* ignore */ }
      if (this._thumbCache) delete this._thumbCache[_textureKey(id)]
      if (r < 2) dtGrid[r][c] = id; else apronRow[c] = id
      made++
    }
    this._setDoorTiles(room, state, dtGrid)
    this._setDoorApron(room, state, apronRow)
    this._populatePaintCanvas()
    this._notifyDom()
    const who = tag === 'default' ? state : `${state} · ${tag}`
    this._toast(`Door skin applied to ${who} (${made} cells)`)
    return { ok: true, cells: made }
  }

  // Stretch (distort to fill) vs fit (keep aspect, transparent unfilled) for
  // door-skin uploads. Default fit — a door-only PNG no longer droops into the
  // apron row.
  uiDoorStretch() { return !!this._doorSkinStretch }
  uiSetDoorStretch(on) { this._doorSkinStretch = !!on; this._notifyDom() }

  uiClearDoorSkin() {
    const room = this._activeRoom()
    if (!room) return
    const state = this._curDoorState()
    this._pushUndo()
    this._setDoorTiles(room, state, [[null, null, null, null], [null, null, null, null]])
    this._setDoorApron(room, state, [null, null, null, null])
    this._populatePaintCanvas()
    this._notifyDom()
  }

  // ── Stage 2: per-mode panel API ─────────────────────────────────────────────

  // Phaser texture → data-URL thumbnail for DOM <img> previews. Cached by key.
  // Always re-encode to a self-contained data URL (never reuse the source
  // image's own `.src`): theme sprites are loaded from blob: URLs that get
  // revoked after Phaser decodes them, so reusing that URL in a fresh <img>
  // renders as a broken image. Drawing the already-decoded bitmap to a canvas
  // and exporting toDataURL() sidesteps the blob lifetime entirely.
  _texThumb(key) {
    if (!key) return null
    this._thumbCache ||= {}
    if (key in this._thumbCache) return this._thumbCache[key]
    let url = null
    try {
      if (this.textures.exists(key)) {
        const src = this.textures.get(key).getSourceImage()
        if (src instanceof HTMLCanvasElement) {
          url = src.toDataURL()
        } else if (src) {
          const w = src.naturalWidth || src.width || 32
          const h = src.naturalHeight || src.height || 32
          const c = document.createElement('canvas')
          c.width = w; c.height = h
          c.getContext('2d').drawImage(src, 0, 0, w, h)
          url = c.toDataURL()
        }
      }
    } catch (_) { url = null }
    this._thumbCache[key] = url
    return url
  }

  // Themes
  uiListThemes() { return ThemeManager.listThemes() }
  uiGetTheme(field) { return this._activeRoom()?.[field] || null }
  // What a door created on this room will actually look like: the room's
  // doorTheme override if set, else its room theme (DungeonRenderer reads
  // `room.doorTheme || room.theme`). null = procedural fallback.
  uiEffectiveDoorTheme() {
    const room = this._activeRoom()
    const eff = room?.doorTheme || room?.theme || null
    return { override: room?.doorTheme || null, effective: eff, fromRoomTheme: !room?.doorTheme && !!room?.theme }
  }
  uiSetTheme(field, name) {
    const room = this._activeRoom()
    if (!room) return
    this._pushUndo()
    room[field] = name || null
    ThemeManager.resetRolls()
    this._refreshAll()
  }

  // Tile sprite palette — filtered to the room's theme (sprites the theme
  // owns OR references in any slot), unless "show all" is on or the room has
  // no theme. The "show all" escape hatch reveals every sprite (cross-theme +
  // legacy/untagged).
  uiListTileSprites() {
    const theme = this._activeRoom()?.theme
    let list
    if (!theme || this._paletteShowAll) {
      list = ThemeManager.listSprites()
    } else {
      const ids = new Set(ThemeManager.spritesForTheme(theme).map(s => s.id))
      const t = ThemeManager.getTheme(theme)
      if (t) for (const slot of Object.keys(t.slots)) for (const id of t.slots[slot]) ids.add(id)
      list = [...ids].filter(id => ThemeManager.hasSprite(id))
        .map(id => ({ id, ...ThemeManager.getSprite(id) }))
    }
    return list.map(s => ({ id: s.id, thumb: this._texThumb(_textureKey(s.id)) }))
  }
  uiPaletteInfo() {
    const theme = this._activeRoom()?.theme
    return { theme: theme || null, showAll: !!this._paletteShowAll, themed: !!theme }
  }
  uiTogglePaletteAll() { this._paletteShowAll = !this._paletteShowAll; this._notifyDom() }
  uiActiveSpriteId() { return this._activeSpriteId }
  uiPickSprite(id) {
    this._activeSpriteId = (this._activeSpriteId === id) ? null : id
    this._notifyDom()
  }
  uiClearOverrides() { this._clearAllOverrides(); this._notifyDom() }

  // Door state (closed / open / locked)
  uiDoorState() { return this._paintMode.startsWith('door-') ? this._paintMode.slice(5) : 'closed' }
  uiSetDoorState(state) {
    this._colorsTab = false
    this._paintMode = `door-${state}`
    this._populatePaintCanvas()
    this._notifyDom()
  }

  // Decor browser + options
  uiListDecorSprites() {
    return DecorManager.listSprites().map(s => ({ id: s.id, thumb: this._texThumb(DECOR_TEXTURE_KEY(s.id)) }))
  }
  uiActiveDecorId() { return this._activeDecorSpriteId }
  uiPickDecor(id) {
    this._activeDecorSpriteId = (this._activeDecorSpriteId === id) ? null : id
    this._notifyDom()
  }
  uiDecorOpts() { return { size: this._decorSize, solid: !!this._decorSolid, layer: this._decorLayer } }
  uiSetDecorSize(n)  { this._decorSize = n; this._notifyDom() }
  uiSetDecorSolid(b) { this._decorSolid = !!b; this._notifyDom() }
  uiSetDecorLayer(l) { this._decorLayer = l; this._notifyDom() }
  uiUploadDecor() { this._uploadDecorSprite() }
  uiClearDecors() { this._clearAllDecors(); this._notifyDom() }
  // Delete a decor sprite from the library + drop any placed instances of it.
  uiDeleteDecorSprite(id) {
    DecorManager.removeSprite(id)
    for (const r of this._rooms) {
      if (Array.isArray(r.decorations)) r.decorations = r.decorations.filter(d => d.spriteId !== id)
    }
    if (this._activeDecorSpriteId === id) this._activeDecorSpriteId = null
    this._populatePaintCanvas()
    this._notifyDom()
  }

  // Color adjust (walls / floor / doors × hue / sat / bright / contrast)
  uiColorParams() {
    const ca = this._activeRoom()?.colorAdjust || {}
    const read = (t) => {
      const o = ca[t] || {}
      return { hue: o.hue || 0, sat: o.sat || 0, bright: o.bright || 0, contrast: o.contrast || 0 }
    }
    return { walls: read('walls'), floor: read('floor'), doors: read('doors') }
  }
  uiHasColor(target) {
    return Object.values(this._activeRoom()?.colorAdjust?.[target] || {}).some(v => v !== 0)
  }
  // Live slider write — updates data + canvas only (no DOM rebuild, so the
  // slider keeps focus mid-drag).
  uiSetColor(target, field, value, min, max) {
    const room = this._activeRoom()
    if (!room) return
    room.colorAdjust ||= {}
    room.colorAdjust[target] ||= {}
    room.colorAdjust[target][field] = Math.max(min, Math.min(max, +(+value).toFixed(4)))
    this._populatePaintCanvas()
  }
  uiResetColor(target) {
    const room = this._activeRoom()
    if (!room?.colorAdjust?.[target]) return
    this._pushUndo()
    room.colorAdjust[target] = {}
    this._populatePaintCanvas()
    this._notifyDom()
  }

  // ── Theme authoring (Phase 1) — drives the Themes manager modal ─────────────
  _pendingThemeBytes() { return (this._pendingThemePngs ||= new Map()) }

  // Snapshot for the modal: theme list, the edited theme's slot coverage +
  // an "unassigned" tray (sprites owned by the theme but in no slot), all
  // with thumbnails.
  uiThemeAuthorData(themeName) {
    const themes = ThemeManager.listThemes()
    const roomTheme = this._activeRoom()?.theme
    const editing =
      (themeName && ThemeManager.hasTheme(themeName)) ? themeName :
      (roomTheme && ThemeManager.hasTheme(roomTheme)) ? roomTheme :
      (ThemeManager.activeTheme() || themes[0] || null)
    const groups = slotGroups()
    const slotLabels = {}
    for (const g of Object.values(groups)) for (const s of g.slots) slotLabels[s] = slotLabel(s)
    // Pass the RAW coverage (number 1/2/4 OR a '1x2'/'2x1' string) so the
    // coverage dropdown can reflect non-square selections — spriteCoverage()
    // would collapse '1x2' to its bounding number (2) and mis-show it as 2×2.
    const thumb = (id) => {
      const sp = ThemeManager.getSprite(id)
      return { id, thumb: this._texThumb(_textureKey(id)), coverage: sp?.coverage ?? spriteCoverage(sp) }
    }
    const slots = {}
    let unassigned = []
    if (editing) {
      const t = ThemeManager.getTheme(editing)
      const inSlot = new Set()
      for (const s of ALL_SLOTS) {
        const ids = t?.slots?.[s] || []
        slots[s] = ids.map(thumb)
        ids.forEach(id => inSlot.add(id))
      }
      unassigned = ThemeManager.spritesForTheme(editing)
        .filter(s => !inSlot.has(s.id)).map(s => thumb(s.id))
    }
    return {
      themes, editing,
      groups: Object.entries(groups).map(([id, g]) => ({ id, label: g.label, slots: g.slots })),
      slotLabels, slots, unassigned,
      hasFolder: FsHandle.hasRoot(),
      folderName: FsHandle.hasRoot() ? FsHandle.rootName() : null,
      dirty: this._pendingThemeBytes().size > 0,
    }
  }

  uiCreateTheme(name) {
    name = String(name || '').trim()
    if (!name) return { ok: false, msg: 'Enter a theme name' }
    if (!ThemeManager.createTheme(name)) return { ok: false, msg: 'That theme already exists' }
    this._notifyDom()
    return { ok: true, name }
  }
  uiRenameTheme(oldName, newName) {
    newName = String(newName || '').trim()
    const ok = ThemeManager.renameTheme(oldName, newName)
    if (ok) {  // sprites tagged with the old theme follow the rename
      for (const s of ThemeManager.listSprites()) {
        if (s.theme === oldName) ThemeManager.updateSprite(s.id, { theme: newName })
      }
    }
    this._notifyDom()
    return { ok, name: ok ? newName : oldName }
  }
  uiDeleteTheme(name) { const ok = ThemeManager.deleteTheme(name); this._notifyDom(); return { ok } }
  uiSetActiveTheme(name) { ThemeManager.setActive(name); this._refreshAll() }

  // Open the OS picker, ingest PNG(s) into a theme: register the texture, tag
  // the sprite with the theme, auto-slot it by filename, and stage the bytes
  // for the next theme save. Returns a {added, assigned, unassigned} summary.
  async uiUploadThemeSprites(themeName, droppedFiles = null) {
    if (!themeName) return { added: 0, assigned: 0, unassigned: 0, msg: 'Pick or create a theme first' }
    let files = droppedFiles
    if (!files) {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = 'image/png,image/webp'; input.multiple = true
      input.style.display = 'none'; document.body.appendChild(input)
      files = await new Promise(res => {
        input.onchange = () => res(Array.from(input.files || []))
        input.oncancel = () => res([])
        input.click()
      })
      input.remove()
    }
    files = (files || []).filter(f => /image\/(png|webp)/.test(f.type) || /\.(png|webp)$/i.test(f.name))
    let added = 0, assigned = 0
    for (const file of files) {
      const id = makeSpriteId(file.name)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const dataUrl = await _blobToDataUrl(file)
      const dim = await _imgDim(dataUrl)
      const srcSize = [32, 64, 128].includes(dim) ? dim : (dim <= 32 ? 32 : dim <= 64 ? 64 : 128)
      const mode = srcSize > 32 ? 'span' : 'scale'   // big art spans multiple cells
      if (ThemeManager.hasSprite(id)) ThemeManager.updateSprite(id, { srcSize, theme: themeName })
      else ThemeManager.addSprite(id, { srcSize, mode, theme: themeName, file: spritePath(id) })
      this._pendingThemeBytes().set(id, bytes)
      try { await this._addTextureFromDataUrl(_textureKey(id), dataUrl) } catch (_) { /* ignore */ }
      if (this._thumbCache) delete this._thumbCache[_textureKey(id)]
      const slot = autoSlotForId(id)
      if (slot) { ThemeManager.addSlotVariant(themeName, slot, id); assigned++ }
      added++
    }
    this._notifyDom()
    return { added, assigned, unassigned: added - assigned }
  }

  // Compose a small sample-room preview of a theme to a data URL (ported from
  // the old Tileset Editor's live preview). Draws each slot's rolled variant
  // into a 12×9 sample room; empty slots show a faint placeholder so the
  // structure still reads.
  uiThemePreviewDataUrl(themeName) {
    if (!themeName) return null
    const LAYOUT = [
      '............', '.CCCCCCCCCC.', '.WFFFFFFFFW.', '.WFFFFFFFFW.',
      '.WFFDDFFFFW.', '.WFFDDFFFFW.', '.WFFFFFFFFW.', '.WWWWWWWWWW.', '............',
    ]
    const COLS = 12, ROWS = 9, CELL = 18
    const slotAt = (c, r) => {
      const ch = LAYOUT[r]?.[c]
      if (!ch || ch === '.') return null
      if (ch === 'F') return FLOOR_SLOT
      if (ch === 'C') { if (c === 1) return 'wall_corner_tl'; if (c === COLS - 2) return 'wall_corner_tr'; return 'wall_cap' }
      if (ch === 'W') {
        if (r === ROWS - 2) { if (c === 1) return 'wall_corner_bl'; if (c === COLS - 2) return 'wall_corner_br'; return 'wall_bottom' }
        if (c === 1) return 'wall_left'; if (c === COLS - 2) return 'wall_right'; return 'wall'
      }
      if (ch === 'D') { const sub = ['tl', 'tr', 'bl', 'br'][(r - 4) * 2 + (c - 4)]; return `door_closed_v_${sub}` }
      return null
    }
    const canvas = document.createElement('canvas')
    canvas.width = COLS * CELL; canvas.height = ROWS * CELL
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#0a0514'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const slot = slotAt(c, r)
      if (!slot) continue
      const id = ThemeManager.pickVariant(slot, c, r, themeName)
      const src = id && this.textures.exists(_textureKey(id)) ? this.textures.get(_textureKey(id)).getSourceImage() : null
      if (src) {
        try { ctx.drawImage(src, c * CELL, r * CELL, CELL, CELL) } catch (_) { /* tainted/none */ }
      } else {
        ctx.fillStyle = /^(wall|door)/.test(slot) ? 'rgba(90,70,110,0.22)' : 'rgba(40,60,80,0.22)'
        ctx.fillRect(c * CELL + 0.5, r * CELL + 0.5, CELL - 1, CELL - 1)
      }
    }
    return canvas.toDataURL()
  }
  uiRerollPreview() { ThemeManager.resetRolls(); this._notifyDom() }

  uiSetSpriteCoverage(id, cov) {
    // cov is a square number (1/2/4) or a non-square 'WxH' string ('1x2'/'2x1').
    const isStr = typeof cov === 'string' && /^\d+x\d+$/.test(cov)
    const value = isStr ? cov : Number(cov)
    const span  = isStr || value > 1
    ThemeManager.updateSprite(id, { coverage: value, mode: span ? 'span' : 'scale' })
    if (this._thumbCache) delete this._thumbCache[_textureKey(id)]
    this._notifyDom()
  }
  uiAssignSlot(themeName, slot, id)   { ThemeManager.addSlotVariant(themeName, slot, id); this._notifyDom() }
  uiUnassignSlot(themeName, slot, id) { ThemeManager.removeSlotVariant(themeName, slot, id); this._notifyDom() }
  uiDeleteThemeSprite(id) {
    ThemeManager.removeSprite(id)
    if (this._activeSpriteId === id) this._activeSpriteId = null
    this._populatePaintCanvas()
    this._notifyDom()
  }

  async uiSaveThemes() {
    if (!FsHandle.isSupported()) { this._toast('File System API unavailable in this browser', true); return { ok: false } }
    if (!FsHandle.hasRoot()) {
      this._toast('Pick the Quest-Failed/ folder…')
      const root = await FsHandle.acquireRoot()
      if (!root) { this._toast('Folder not granted — save cancelled', true); return { ok: false } }
    }
    try {
      for (const [id, bytes] of this._pendingThemeBytes()) {
        await FsHandle.writeFile(spritePath(id), new Blob([bytes], { type: 'image/png' }))
      }
      this._pendingThemeBytes().clear()
      await FsHandle.writeJson('assets/themes/manifest.json', ThemeManager.serialize())
      this._toast('Themes saved to disk.')
      this._notifyDom()
      return { ok: true }
    } catch (err) {
      console.error('[RoomTileEditor] theme save failed:', err)
      this._toast('Save failed: ' + (err?.message || err), true)
      return { ok: false }
    }
  }

  // ── Room shape normalization ─────────────────────────────────────────────
  _ensureRoomShape(room) {
    if (typeof room.theme !== 'string') room.theme = null
    if (typeof room.doorTheme !== 'string') room.doorTheme = null
    if (typeof room.backgroundImage !== 'string') room.backgroundImage = null
    if (!Array.isArray(room.decorations)) room.decorations = []
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
    // Door tile painting — three states (closed/open/locked), each a
    // 2-row × 4-col grid of cell entries (sprite-id string or
    // {id, rot?, flipH?, flipV?} or null).
    //
    // Layout (canonical = door on this room's South wall, viewed from above):
    //   col 0 = LEFT JAMB (wall cell adjacent to the door pair)
    //   col 1 = DOOR (left half of the 2-wide door)
    //   col 2 = DOOR (right half)
    //   col 3 = RIGHT JAMB
    //   row 0 = INNER (closer to this room's interior)
    //   row 1 = OUTER (closer to the wall's outer face / neighbour)
    // The whole 4×2 painting auto-rotates per cp direction at render time.
    if (!room.doorTiles || typeof room.doorTiles !== 'object') room.doorTiles = {}
    for (const state of ['closed', 'open', 'locked']) {
      const cur = room.doorTiles[state]
      if (!Array.isArray(cur) || cur.length !== 2 ||
          !cur.every(r => Array.isArray(r) && r.length === 4)) {
        room.doorTiles[state] = [[null, null, null, null], [null, null, null, null]]
      }
    }
  }

  // ── Initial load ─────────────────────────────────────────────────────────
  async _initialLoad() {
    if (FsHandle.hasRoot()) {
      // Pick up theme manifest so sprites are available without visiting TilesetEditor.
      const m = await FsHandle.readJson('assets/themes/manifest.json')
      if (m) {
        ThemeManager.load(m)
        await this._registerExistingSpriteTextures()
        await this._registerExistingRoomSkins()
      }
      // Pick up decor manifest if it exists.
      const dm = await FsHandle.readJson(DECOR_MANIFEST_PATH)
      if (dm) {
        DecorManager.load(dm)
        await this._registerExistingDecorTextures()
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

  async _registerExistingDecorTextures() {
    const sprites = DecorManager.listSprites()
    await Promise.all(sprites.map(s => this._loadDecorTextureFromDisk(s.id, s.file)))
  }

  async _registerExistingRoomSkins() {
    const skins = ThemeManager.listRoomSkins()
    await Promise.all(skins.map(s => this._loadRoomSkinFromDisk(s.id, s.file)))
  }
  async _loadRoomSkinFromDisk(id, file) {
    const key = roomSkinTextureKey(id)
    if (this.textures.exists(key)) return
    try {
      const blob = await FsHandle.readFile(file)
      if (!blob) return
      const dataUrl = await _blobToDataUrl(blob)
      await this._addTextureFromDataUrl(key, dataUrl)
    } catch (_) { /* ignore */ }
  }

  async _loadDecorTextureFromDisk(id, file) {
    const key = DECOR_TEXTURE_KEY(id)
    if (this.textures.exists(key)) return
    try {
      const blob = await FsHandle.readFile(file)
      if (!blob) return
      const dataUrl = await _blobToDataUrl(blob)
      await this._addTextureFromDataUrl(key, dataUrl)
    } catch (_) { /* ignore */ }
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

  // ── Paint canvas ─────────────────────────────────────────────────────────
  _buildPaintPanel() {
    this._cPaint.removeAll(true)

    // The paint area is the transparent centre rect of the DOM overlay,
    // shared via EDITOR_LAYOUT.canvas (1920×1080 logical coords). The grid is
    // centred within it by _populatePaintCanvas. No Phaser title/hint here —
    // the DOM header + hint bar own those.
    const a = this._paintAreaRect || EDITOR_LAYOUT.canvas
    this._paintArea = { x: a.x, y: a.y, w: a.w, h: a.h }

    const maskGfx = this.add.graphics().setVisible(false)
      .fillStyle(0xffffff, 1).fillRect(a.x, a.y, a.w, a.h)
    const mask = maskGfx.createGeometryMask()
    const container = this.add.container(0, 0)
    this._cPaint.add(container)
    container.setMask(mask)
    this._paintContainer = container

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
    if (this._paintMode !== 'room') {
      if (this._paintMode === 'decor') { this._populateDecorCanvas(room); return }
      this._populateDoorCanvas(room)
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

    // Full-room skin (Phase 4): if assigned + loaded, draw it stretched over
    // the whole room and skip per-cell tiles (matches the in-game render).
    // For the boss chamber this previews the currently-selected boss's skin.
    // Clear the skin from the Skins panel to edit tiles again.
    const editorSkinId = this._editorSkinId(room)
    const skinKey = editorSkinId ? roomSkinTextureKey(editorSkinId) : null
    if (skinKey && this.textures.exists(skinKey)) {
      const skin = this.add.image(ox + totalW / 2, oy + totalH / 2, skinKey).setOrigin(0.5)
      skin.setDisplaySize(totalW, totalH)
      this._paintContainer.add(skin)
      this._paintContainer.add(_text(this, ox + totalW / 2, oy + totalH + 12,
        '⬛ Skinned room — clear the skin (Skins panel) to edit tiles', {
          fontSize: '11px', color: COL_TEXT_HI,
        }).setOrigin(0.5, 0))
      return
    }

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
        const { w: covW, h: covH } = spriteCoverageHW(sp)
        if (covW <= 1 && covH <= 1) continue
        for (let dy = 0; dy < covH; dy++) {
          for (let dx = 0; dx < covW; dx++) {
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
        const gridA = this._showGrid ? 0.25 : 0
        // Held-tile source highlight (move tool): gold ring on the cell a
        // tile was picked up from until it's placed.
        const hc = viewToRoom(vx, vy, w, h, viewRot)
        const isHeld = this._moveMode && this._heldFrom && this._heldFrom.rx === hc.rx && this._heldFrom.ry === hc.ry
        const baseW = isHeld ? 3 : 1
        const baseCol = isHeld ? 0xffd24a : COL_BORDER
        const baseA = isHeld ? 1 : gridA
        const hit = this.add.rectangle(px, py, cell, cell, 0xffffff, 0).setOrigin(0, 0)
          .setStrokeStyle(baseW, baseCol, baseA)
          .setInteractive({ useHandCursor: true })
        const hover = (over) => hit.setStrokeStyle(over ? 2 : baseW, over ? COL_PAINT_HOVER : baseCol, over ? 0.85 : baseA)
        hit.on('pointerover', () => hover(true))
        hit.on('pointerout',  () => hover(false))
        // Capture vx/vy/viewRot for the closure.
        const cvx = vx, cvy = vy, cViewRot = viewRot
        hit.on('pointerdown', (pointer, lx, ly, ev) => {
          ev?.stopPropagation?.()
          const { rx, ry } = viewToRoom(cvx, cvy, w, h, cViewRot)
          // Move tool takes precedence: 1st click picks up a painted tile,
          // 2nd click drops it (preserving rotation / flip / span).
          if (this._moveMode) {
            this._handleMoveClick(room, cvx, cvy, cViewRot, rx, ry)
            this._populatePaintCanvas()
            this._notifyDom()
            return
          }
          const isClear = pointer.rightButtonDown() || pointer.event?.shiftKey || this._eraserMode
          if (isClear) {
            this._pushUndo()
            this._eraseAt(room, rx, ry)
          } else if (this._activeSpriteId) {
            this._pushUndo()
            this._paintAtView(room, cvx, cvy, cViewRot)
          } else {
            this._toast('Pick a sprite at right first', true); return
          }
          this._populatePaintCanvas()
          this._notifyDom()
        })
        this._paintContainer.add(hit)
      }
    }
  }

  // ── Decor canvas ─────────────────────────────────────────────────────────
  // Renders actual room tile art as background (same as ROOM mode), then
  // overlays placed decorations. Click = place; right-click/shift/eraser = remove.
  // Supports 1×1 and 2×2 decor sizes (controlled by _decorSize).
  _populateDecorCanvas(room) {
    const zoom    = ZOOM_LEVELS[this._zoomIdx]
    const cell    = TILE_PX * zoom
    const w       = room.width, h = room.height
    const viewRot = this._viewRot || 0
    const vd      = viewDims(w, h, viewRot)
    const vw = vd.w, vh = vd.h
    const totalW  = vw * cell, totalH = vh * cell
    const ox = this._paintArea.x + Math.max(8, (this._paintArea.w - totalW) / 2)
    const oy = this._paintArea.y + Math.max(8, (this._paintArea.h - totalH) / 2)

    // Backdrop
    const backdrop = this.add.rectangle(ox - 1, oy - 1, totalW + 2, totalH + 2, 0x000000, 1)
      .setOrigin(0, 0).setStrokeStyle(1, COL_BORDER, 1)
    this._paintContainer.add(backdrop)

    // ── Background pass: real room tile sprites ───────────────────────────
    // Build coveredRoom to skip non-anchor cells for span sprites (same logic
    // as _populatePaintCanvas), then call _renderViewCell per visible cell.
    const coveredRoom = new Set()
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const overrideRaw = room.tileLayout[yy]?.[xx] || null
        const override = readCellEntry(overrideRaw)
        const spriteId = override?.id || this._defaultSpriteFor(room, xx, yy)
        const sprite = spriteId ? ThemeManager.getSprite(spriteId) : null
        const { w: covW, h: covH } = spriteCoverageHW(sprite)
        if (covW > 1 || covH > 1) {
          for (let dy = 0; dy < covH; dy++) {
            for (let dx = 0; dx < covW; dx++) {
              if (dx === 0 && dy === 0) continue
              coveredRoom.add(`${xx + dx},${yy + dy}`)
            }
          }
        }
      }
    }
    for (let vy = 0; vy < vh; vy++) {
      for (let vx = 0; vx < vw; vx++) {
        const { rx, ry } = viewToRoom(vx, vy, w, h, viewRot)
        if (coveredRoom.has(`${rx},${ry}`)) continue
        this._renderViewCell(room, rx, ry, ox, oy, cell, viewRot)
      }
    }

    // ── Decor overlay pass ────────────────────────────────────────────────
    // For each placed decor, draw a colored border overlay + sprite image +
    // layer badge. 2×2 decors span a 2-cell block in view space.
    const decorations = room.decorations ?? []
    for (const decor of decorations) {
      const decorSz = decor.size ?? 1
      const tl = viewBlockTopLeft(decor.x, decor.y, decorSz, w, h, viewRot)
      const px = ox + tl.vx * cell
      const py = oy + tl.vy * cell
      const size = decorSz * cell

      // Colored overlay (semi-transparent) + border indicating solid/passable.
      const overlayCol = decor.solid ? 0x3a0a0a : 0x0a1a3a
      const borderCol  = decor.solid ? 0xcc3333 : 0x3388cc
      const overlay = this.add.rectangle(px, py, size, size, overlayCol, 0.5)
        .setOrigin(0, 0).setStrokeStyle(2, borderCol, 0.9)
      this._paintContainer.add(overlay)

      // Decor sprite (or '?' placeholder).
      const key = DECOR_TEXTURE_KEY(decor.spriteId)
      if (this.textures.exists(key)) {
        const img = this.add.image(px + size / 2, py + size / 2, key)
          .setOrigin(0.5).setDisplaySize(size - 4, size - 4)
        if (decor.rot)   img.setAngle(decor.rot)
        if (decor.flipH) img.flipX = true
        if (decor.flipV) img.flipY = true
        this._paintContainer.add(img)
      } else {
        this._paintContainer.add(_text(this, px + size / 2, py + size / 2,
          '?', { fontSize: '14px', color: '#8888cc' }).setOrigin(0.5))
      }

      // Size badge for 2×2.
      if (decorSz > 1) {
        this._paintContainer.add(_text(this, px + 2, py + 2,
          `${decorSz}×${decorSz}`, { fontSize: '9px', color: '#aaffaa' }).setOrigin(0, 0))
      }

      // Layer badge.
      const badge = decor.layer === 'object' ? '▲' : '▼'
      this._paintContainer.add(_text(this, px + size - 2, py + 2,
        badge, { fontSize: '9px', color: decor.solid ? '#ff8888' : '#88aaff' })
        .setOrigin(1, 0))
    }

    // ── Click targets — one per view cell ────────────────────────────────
    for (let vy = 0; vy < vh; vy++) {
      for (let vx = 0; vx < vw; vx++) {
        const px = ox + vx * cell, py = oy + vy * cell
        const gridA = this._showGrid ? 0.15 : 0
        const hit = this.add.rectangle(px, py, cell, cell, 0xffffff, 0).setOrigin(0, 0)
          .setStrokeStyle(1, COL_BORDER, gridA)
          .setInteractive({ useHandCursor: true })
        hit.on('pointerover', () => hit.setStrokeStyle(2, COL_PAINT_HOVER, 0.85))
        hit.on('pointerout',  () => hit.setStrokeStyle(1, COL_BORDER, gridA))
        const cvx = vx, cvy = vy, cViewRot = viewRot
        hit.on('pointerdown', (pointer, lx, ly, ev) => {
          ev?.stopPropagation?.()
          const { rx, ry } = viewToRoom(cvx, cvy, w, h, cViewRot)
          const isClear = pointer.rightButtonDown() || pointer.event?.shiftKey || this._eraserMode
          if (!room.decorations) room.decorations = []
          if (isClear) {
            // Remove any decor whose footprint covers this cell (handles 2×2).
            this._pushUndo()
            room.decorations = room.decorations.filter(d => {
              const sz = d.size ?? 1
              return !(rx >= d.x && rx < d.x + sz && ry >= d.y && ry < d.y + sz)
            })
          } else if (this._activeDecorSpriteId) {
            const sz = this._decorSize ?? 1
            // Bounds-check in view space for 2×2.
            if (sz > 1 && (cvx + sz > vw || cvy + sz > vh)) {
              this._toast(`${sz}×${sz} decor won't fit here — too close to edge`, true)
              return
            }
            this._pushUndo()
            // Find room-space top-left of the sz×sz view block.
            let minRx = Infinity, minRy = Infinity
            for (let dy = 0; dy < sz; dy++) {
              for (let dx = 0; dx < sz; dx++) {
                const r = viewToRoom(cvx + dx, cvy + dy, w, h, cViewRot)
                if (r.rx < minRx) minRx = r.rx
                if (r.ry < minRy) minRy = r.ry
              }
            }
            // Clear any existing decors overlapping the target block.
            room.decorations = room.decorations.filter(d => {
              const ds = d.size ?? 1
              const overlapX = d.x < minRx + sz && d.x + ds > minRx
              const overlapY = d.y < minRy + sz && d.y + ds > minRy
              return !(overlapX && overlapY)
            })
            const stored = ((this._activeRot - cViewRot) % 360 + 360) % 360
            const entry = {
              x: minRx, y: minRy,
              spriteId: this._activeDecorSpriteId,
              rot:   stored,
              flipH: this._flipH,
              flipV: this._flipV,
              solid: this._decorSolid,
              layer: this._decorLayer,
            }
            if (sz > 1) entry.size = sz
            room.decorations.push(entry)
          } else {
            this._toast('Pick a decor sprite at right first', true); return
          }
          this._populatePaintCanvas()
          this._notifyDom()
        })
        this._paintContainer.add(hit)
      }
    }

    // Hint
    this._paintContainer.add(_text(this,
      this._paintArea.x + this._paintArea.w / 2, this._paintArea.y + this._paintArea.h - 14,
      'Click = place decor · Right-click/Shift = remove · ▼ floor  ▲ object · red border = solid',
      { fontSize: '11px', color: COL_TEXT_DIM }).setOrigin(0.5))
  }

  // ── Door swatch canvas (door paint modes) ────────────────────────────────
  // Renders the 2-row × 4-col door swatch for the active state. Canonical
  // orientation = door on this room's South wall, viewed from above:
  //   col 0 = LEFT JAMB   (wall cell adjacent to door, gets a sprite override)
  //   col 1 = DOOR (left)
  //   col 2 = DOOR (right)
  //   col 3 = RIGHT JAMB
  //   row 0 = INNER (closer to room interior)
  //   row 1 = OUTER (closer to wall's outer face)
  // All 8 cells live inside THIS room's wall ring (no neighbour cells).
  // The whole swatch auto-rotates per cp direction at render time so the
  // same painting works on every wall the door can land on.
  _populateDoorCanvas(room) {
    const state = this._paintMode.replace('door-', '')   // 'closed' | 'open' | 'locked'
    // Door swatch is now 4 cols × 3 rows: rows 0-1 are the door itself
    // (room.doorTiles[state] — Outer/Inner, unchanged in-game function), row 2
    // is the decorative "apron" (room.doorApron[state]) that renders one tile
    // into the room below the door. Build a combined grid from refs so paints
    // mutate the right source in place.
    const dtGrid = this._ensureDoorTiles(room, state)   // target-aware (default or per-boss)
    const apron  = this._ensureDoorApron(room, state)
    const grid = [dtGrid[0], dtGrid[1], apron]
    const zoom  = ZOOM_LEVELS[this._zoomIdx]
    const cell  = TILE_PX * Math.max(2, zoom * 3)   // door swatch always renders large
    const cols = 4, rows = 3
    const totalW = cols * cell
    const totalH = rows * cell

    // Centred in the paint area, leaving room for the row labels on the left.
    const labelW = 110
    const ox = this._paintArea.x + Math.max(8 + labelW, (this._paintArea.w - totalW + labelW) / 2)
    const oy = this._paintArea.y + Math.max(36, (this._paintArea.h - totalH) / 2)

    // Title — current state.
    this._paintContainer.add(_text(this,
      this._paintArea.x + this._paintArea.w / 2,
      this._paintArea.y + 6,
      `DOOR · ${state.toUpperCase()}  (${room.name || room.id})`, {
        fontSize: '14px', color: COL_TEXT_HI, fontStyle: 'bold',
      }).setOrigin(0.5, 0))

    // Backdrop
    const backdrop = this.add.rectangle(ox - 1, oy - 1, totalW + 2, totalH + 2, 0x000000, 1)
      .setOrigin(0, 0).setStrokeStyle(1, COL_BORDER, 1)
    this._paintContainer.add(backdrop)

    // Row labels — OUTER (seam) / INNER (door) / BELOW (apron into the room).
    const rowLabels = ['Outer (seam)', 'Inner (door)', 'Below (into room)']
    for (let r = 0; r < rows; r++) {
      const ly = oy + r * cell + cell / 2
      this._paintContainer.add(_text(this, ox - 8, ly, rowLabels[r], {
        fontSize: '11px', color: COL_TEXT,
      }).setOrigin(1, 0.5))
    }

    // Column labels above the swatch.
    const colLabels = ['L Jamb', 'Door', 'Door', 'R Jamb']
    const colColors = [COL_TEXT_DIM, COL_TEXT_HI, COL_TEXT_HI, COL_TEXT_DIM]
    for (let c = 0; c < cols; c++) {
      this._paintContainer.add(_text(this, ox + c * cell + cell / 2, oy - 16,
        colLabels[c], { fontSize: '11px', color: colColors[c] }).setOrigin(0.5, 1))
    }

    // Vertical dividers separating the door cols from the jambs.
    const divG = this.add.graphics()
    divG.lineStyle(2, COL_BORDER_HI, 0.85)
    divG.lineBetween(ox + 1 * cell, oy - 4, ox + 1 * cell, oy + totalH + 4)
    divG.lineBetween(ox + 3 * cell, oy - 4, ox + 3 * cell, oy + totalH + 4)
    // Horizontal divider between the door (rows 0-1) and the decorative apron
    // (row 2) so it's clear the bottom row renders into the room, not the door.
    divG.lineStyle(2, 0x6ba03a, 0.7)
    divG.lineBetween(ox - 4, oy + 2 * cell, ox + totalW + 4, oy + 2 * cell)
    this._paintContainer.add(divG)

    // Pre-pass: gather cells covered by span (cov>1) anchors so we don't
    // render redundant per-cell art over them. The anchor itself renders
    // at cov×cov size; the other cells in its block stay blank.
    const covered = new Set()
    for (let rr = 0; rr < rows; rr++) {
      for (let cc = 0; cc < cols; cc++) {
        const e = readCellEntry(grid[rr]?.[cc])
        if (!e) continue
        const { w: covW, h: covH } = spriteCoverageHW(ThemeManager.getSprite(e.id))
        if (covW <= 1 && covH <= 1) continue
        for (let dy = 0; dy < covH; dy++) {
          for (let dx = 0; dx < covW; dx++) {
            if (dx === 0 && dy === 0) continue
            covered.add(`${cc + dx},${rr + dy}`)
          }
        }
      }
    }

    // Render painted cells + click targets.
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = ox + c * cell
        const py = oy + r * cell
        const entry = covered.has(`${c},${r}`) ? null : readCellEntry(grid[r]?.[c])
        const isJamb = (c === 0 || c === 3)

        // Distinguish jamb tiles visually with a slightly darker default tint.
        const tint = entry ? COL_OVERRIDE_BG : (isJamb ? 0x080612 : COL_DEFAULT_BG)
        const bg = this.add.rectangle(px, py, cell, cell, tint, 0.55).setOrigin(0, 0)
        this._paintContainer.add(bg)

        if (entry?.id) {
          const sprite = ThemeManager.getSprite(entry.id)
          const tex = _textureKey(entry.id)
          const { w: covW, h: covH } = spriteCoverageHW(sprite)
          if (sprite && this.textures.exists(tex)) {
            const sw = cell * covW, sh = cell * covH
            const img = this.add.image(px + sw / 2, py + sh / 2, tex).setOrigin(0.5)
            img.setDisplaySize(sw, sh)
            if (entry.rot)   img.setAngle(entry.rot)
            if (entry.flipH) img.flipX = true
            if (entry.flipV) img.flipY = true
            _applyColorAdj(img, room.colorAdjust?.walls)   // doors share the walls colour
            this._paintContainer.add(img)
          }
        }

        const gridA = this._showGrid ? 0.35 : 0
        const hit = this.add.rectangle(px, py, cell, cell, 0xffffff, 0).setOrigin(0, 0)
          .setStrokeStyle(1, COL_BORDER, gridA)
          .setInteractive({ useHandCursor: true })
        hit.on('pointerover', () => hit.setStrokeStyle(2, COL_PAINT_HOVER, 0.9))
        hit.on('pointerout',  () => hit.setStrokeStyle(1, COL_BORDER, gridA))
        const cr = r, cc = c
        hit.on('pointerdown', (pointer, lx, ly, ev) => {
          ev?.stopPropagation?.()
          const isClear = pointer.rightButtonDown() || pointer.event?.shiftKey || this._eraserMode
          if (isClear) {
            this._pushUndo()
            this._eraseDoorCell(grid, cc, cr)
          } else if (this._activeSpriteId) {
            const sp  = ThemeManager.getSprite(this._activeSpriteId)
            const { w: covW, h: covH } = spriteCoverageHW(sp)
            if (cc + covW > cols || cr + covH > rows) {
              this._toast(`Sprite is ${covW}×${covH} — too close to edge to fit`, true); return
            }
            this._pushUndo()
            // Clear the covW×covH area so prior overrides don't conflict,
            // then stamp the anchor at (cc, cr).
            for (let dy = 0; dy < covH; dy++) {
              for (let dx = 0; dx < covW; dx++) {
                if (grid[cr + dy]) grid[cr + dy][cc + dx] = null
              }
            }
            // Non-square tiles aren't rotatable (pick 1×2 vs 2×1) — store rot 0.
            const dRot = (covW === covH) ? this._activeRot : 0
            grid[cr][cc] = writeCellEntry(this._activeSpriteId, dRot, this._flipH, this._flipV)
          } else {
            this._toast('Pick a sprite at right first', true); return
          }
          // grid rows alias room.doorTiles[state][0/1] + room.doorApron[state],
          // so the mutations above already persisted to the right source.
          this._populatePaintCanvas()
          this._notifyDom()
        })
        this._paintContainer.add(hit)
      }
    }

    // Hint at bottom of the panel.
    const hintY = this._paintArea.y + this._paintArea.h - 14
    const hint  = _text(this, this._paintArea.x + this._paintArea.w / 2, hintY,
      'Cols 1–2 are the door; cols 0/3 are jamb tiles overlaid on the wall next to the door.', {
        fontSize: '11px', color: COL_TEXT_DIM,
      }).setOrigin(0.5)
    this._paintContainer.add(hint)
  }

  // Erase the door swatch cell at (col, row). If the cell itself has an
  // anchor, clear it. Otherwise walk up-left within the swatch to find an
  // anchor whose cov×cov span covers (col, row) and clear THAT anchor —
  // mirrors the room-canvas _eraseAt behaviour.
  _eraseDoorCell(grid, col, row) {
    if (grid[row]?.[col]) { grid[row][col] = null; return }
    const MAX_BACK = 3
    for (let dy = 0; dy <= MAX_BACK && row - dy >= 0; dy++) {
      for (let dx = 0; dx <= MAX_BACK && col - dx >= 0; dx++) {
        if (dx === 0 && dy === 0) continue
        const ax = col - dx, ay = row - dy
        const entry = readCellEntry(grid[ay]?.[ax])
        if (!entry) continue
        const { w: covW, h: covH } = spriteCoverageHW(ThemeManager.getSprite(entry.id))
        if (dx < covW && dy < covH) { grid[ay][ax] = null; return }
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
    const { w: covW, h: covH } = spriteCoverageHW(sprite)
    const storedRot = override?.rot || 0
    const flipH = !!override?.flipH
    const flipV = !!override?.flipV

    // View-space rect for the covW×covH room block anchored at (rx, ry). The
    // VIEW footprint (vpw×vph) may differ from the natural (unrotated) sprite
    // size when the view is rotated and the tile is non-square — e.g. a 1×2
    // tile occupies a 2×1 view block at viewRot 90/270.
    const rect = viewBlockRect(rx, ry, covW, covH, w, h, viewRot)
    const px = ox + rect.vx * cell
    const py = oy + rect.vy * cell
    const vpw = rect.vw * cell, vph = rect.vh * cell   // rotated view footprint
    const dispW = covW * cell, dispH = covH * cell     // natural sprite size

    // Tinted background across the whole view block (greenish = override,
    // dark = default).
    const tint = override ? COL_OVERRIDE_BG : COL_DEFAULT_BG
    const bg = this.add.rectangle(px, py, vpw, vph, tint, 0.55).setOrigin(0, 0)
    this._paintContainer.add(bg)

    if (!spriteId || !sprite) return
    const tex = _textureKey(spriteId)
    if (!this.textures.exists(tex)) return

    // Draw at natural size, centered in the view block, then rotate by
    // storedRot+viewRot. Rotation about center makes the rotated natural-size
    // image exactly fill the (possibly transposed) view footprint.
    const img = this.add.image(px + vpw / 2, py + vph / 2, tex).setOrigin(0.5)
    img.setDisplaySize(dispW, dispH)
    // Non-square tiles ignore their own stored rotation (you pick 1×2 vs 2×1
    // explicitly rather than rotating a tile); only the view rotation orients
    // them, so the natural footprint always lines up with the rendered art.
    const effRot = (covW === covH) ? storedRot : 0
    const angle = (effRot + viewRot) % 360
    if (angle) img.setAngle(angle)
    if (flipH) img.flipX = true
    if (flipV) img.flipY = true
    // Apply per-room color adjustment (hue/sat/bright/contrast).
    // Use WT-aware bounds (same logic as DungeonGrid._writeTiles) so the
    // inner wall ring of thick walls (WALL_THICKNESS > 1) gets wall color,
    // not floor color.
    const WT = Balance.WALL_THICKNESS ?? 1
    const isFloor = rx >= WT && rx < w - WT && ry >= WT && ry < h - WT
    _applyColorAdj(img, room.colorAdjust?.[isFloor ? 'floor' : 'walls'])
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
    const { w: covW, h: covH } = spriteCoverageHW(sprite)
    const w = room.width, h = room.height
    const vd = viewDims(w, h, viewRot)

    // The tile's footprint is covW×covH in ROOM space. Seen through a rotated
    // view, the footprint transposes for viewRot 90/270.
    const vcovW = (viewRot % 180 === 0) ? covW : covH
    const vcovH = (viewRot % 180 === 0) ? covH : covW

    // Bounds in view space
    if (vx + vcovW > vd.w || vy + vcovH > vd.h) {
      if (covW > 1 || covH > 1) this._toast(`Sprite is ${covW}×${covH} — too close to edge to fit`, true)
      return false
    }

    // Compute the room-space top-left of the view footprint by scanning all
    // its corner mappings.
    let minRx = Infinity, minRy = Infinity
    for (let dy = 0; dy < vcovH; dy++) {
      for (let dx = 0; dx < vcovW; dx++) {
        const r = viewToRoom(vx + dx, vy + dy, w, h, viewRot)
        if (r.rx < minRx) minRx = r.rx
        if (r.ry < minRy) minRy = r.ry
      }
    }

    // Clear all covW×covH room cells starting at (minRx, minRy) so a
    // previously-anchored sprite doesn't conflict, then stamp the anchor
    // at (minRx, minRy).
    if (covW > 1 || covH > 1) {
      for (let dy = 0; dy < covH; dy++) {
        for (let dx = 0; dx < covW; dx++) {
          if (room.tileLayout[minRy + dy]) room.tileLayout[minRy + dy][minRx + dx] = null
        }
      }
    }
    // Stored rotation is what the sprite carries in the room's canonical
    // orientation. The user's brush rotation (`activeRot`) is the angle
    // they see while painting — applied in the rotated view's frame. The
    // render formula in _renderViewCell is `displayed = stored + viewRot`,
    // so for displayed = activeRot we need stored = activeRot - viewRot.
    // Non-square tiles can't be rotated (pick 1×2 vs 2×1 instead) — store 0 so
    // the footprint (always covW×covH) and the rendered art stay aligned.
    const square = covW === covH
    const stored = square ? ((this._activeRot - viewRot) % 360 + 360) % 360 : 0
    // Mirrors are stored in canonical room frame (no view-rotation
    // transform). With view rotation in play, the user's "horizontal"
    // axis may correspond to the room's vertical axis, so flips and view
    // rotation interact at display time. For v1 we keep this simple —
    // power users can experiment with combinations.
    room.tileLayout[minRy][minRx] = writeCellEntry(
      this._activeSpriteId, stored, this._flipH, this._flipV)
    return true
  }

  // Move tool — two-click relocate of a painted tile. 1st click picks up the
  // override at the clicked cell (source kept until placed); 2nd click drops
  // it, preserving the tile's rotation / flip / span, then clears the source.
  // Cancelling (toggle off / room or mode switch) just drops the hold; the
  // source is never modified until a successful place, so nothing is lost.
  _handleMoveClick(room, vx, vy, viewRot, rx, ry) {
    if (!this._heldTile) {
      const held = readCellEntry(room.tileLayout[ry]?.[rx])
      if (!held) { this._toast('No painted tile here to move', true); return }
      this._heldTile = held
      this._heldFrom = { rx, ry }
      this._toast(`Holding “${held.id}” — click where to place it`)
      return
    }
    const held = this._heldTile
    const w = room.width, h = room.height
    const { w: covW, h: covH } = spriteCoverageHW(ThemeManager.getSprite(held.id))
    const vcovW = (viewRot % 180 === 0) ? covW : covH
    const vcovH = (viewRot % 180 === 0) ? covH : covW
    const vd = viewDims(w, h, viewRot)
    if (vx + vcovW > vd.w || vy + vcovH > vd.h) {
      this._toast(`${covW}×${covH} tile won’t fit here — too close to the edge`, true)
      return  // keep holding
    }
    this._pushUndo()   // about to mutate (clear source + place)
    // Clear the source anchor (its covered cells are already null), then place
    // via the paint path so span coverage + bounds are handled. The brush is
    // briefly set to the held values; activeRot offsets the viewRot baking in
    // _paintAtView so the stored rotation comes out exactly as held.rot.
    const f = this._heldFrom
    if (room.tileLayout[f.ry]) room.tileLayout[f.ry][f.rx] = null
    const sv = { id: this._activeSpriteId, rot: this._activeRot, fh: this._flipH, fv: this._flipV }
    this._activeSpriteId = held.id
    this._activeRot = ((held.rot + viewRot) % 360 + 360) % 360
    this._flipH = held.flipH; this._flipV = held.flipV
    this._paintAtView(room, vx, vy, viewRot)
    this._activeSpriteId = sv.id; this._activeRot = sv.rot; this._flipH = sv.fh; this._flipV = sv.fv
    this._heldTile = null; this._heldFrom = null
    this._toast(`Moved “${held.id}”`)
  }

  // Legacy entry point — paint at room cell (x, y) at active brush
  // rotation, no view-rotation translation. Kept for callers that already
  // operate in room space (e.g. external scripting / tests).
  _paintAt(room, x, y) {
    const sprite = ThemeManager.getSprite(this._activeSpriteId)
    const { w: covW, h: covH } = spriteCoverageHW(sprite)
    if (covW > 1 || covH > 1) {
      if (x + covW > room.width || y + covH > room.height) {
        this._toast(`Sprite is ${covW}×${covH} — too close to edge to fit`, true)
        return
      }
      // Clear the covW×covH area so any prior overrides don't conflict, then
      // stamp the anchor. Other covered cells stay null — the renderer
      // computes the covered-set from anchor + sprite coverage.
      for (let dy = 0; dy < covH; dy++) {
        for (let dx = 0; dx < covW; dx++) {
          room.tileLayout[y + dy][x + dx] = null
        }
      }
    }
    // Non-square tiles store rot 0 (they aren't rotatable — pick 1×2 vs 2×1).
    const rot = (covW === covH) ? this._activeRot : 0
    room.tileLayout[y][x] = writeCellEntry(this._activeSpriteId, rot)
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
        const { w: covW, h: covH } = spriteCoverageHW(sp)
        if (dx < covW && dy < covH) {
          // Anchor (ax, ay) with covW×covH footprint reaches our cell.
          room.tileLayout[ay][ax] = null
          return
        }
      }
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  _activeRoom() {
    return this._rooms.find(r => r.id === this._activeRoomId) || null
  }

  // Prompt for a new W×H and resize the active room. Min is 2·WALL_THICKNESS+1
  // (walls + one interior tile); max is grid-fittable.
  _promptResize(room) {
    if (!room) return
    const MIN = 2 * (Balance.WALL_THICKNESS ?? 2) + 1
    const MAX = 30
    const inp = window.prompt(
      `Resize "${room.name}" — width × height in tiles.\n` +
      `Grows / shrinks from the TOP-LEFT (existing layout is preserved).\n` +
      `Min ${MIN}, max ${MAX}. Saved to rooms.json on the next Save-to-disk.`,
      `${room.width}x${room.height}`)
    if (inp == null) return
    const m = String(inp).trim().match(/^(\d+)\s*[x×*, ]\s*(\d+)$/i)
    if (!m) { this._toast('Bad format — use e.g. "13x9".', true); return }
    const w = Math.max(MIN, Math.min(MAX, parseInt(m[1], 10)))
    const h = Math.max(MIN, Math.min(MAX, parseInt(m[2], 10)))
    if (this._resizeRoom(room, w, h)) {
      this._populatePaintCanvas()
      this._notifyDom()
      this._toast(`${room.name} → ${room.width}×${room.height} · Save to keep`)
    } else {
      this._toast('No change.')
    }
  }

  // Lossless resize: reshape tileLayout to newW×newH anchored TOP-LEFT (grow =
  // prepend null rows/cols on top/left; shrink = drop from top/left), keeping
  // BOTH string and object cells (unlike _ensureRoomShape, which drops objects).
  // Connection points re-anchor to their wall + shift with the prepend. Returns
  // true if anything changed.
  _resizeRoom(room, newW, newH) {
    const oldW = room.width | 0, oldH = room.height | 0
    newW |= 0; newH |= 0
    if (newW === oldW && newH === oldH) return false
    const dW = newW - oldW, dH = newH - oldH

    let layout = Array.isArray(room.tileLayout) ? room.tileLayout.map(r => Array.isArray(r) ? r.slice() : []) : []
    // Normalize existing rows to oldW so prepend/trim math is exact.
    layout = layout.map(r => { const rr = r.slice(0, oldW); while (rr.length < oldW) rr.push(null); return rr })
    while (layout.length < oldH) layout.push(new Array(oldW).fill(null))
    layout.length = oldH

    // Height (rows) on the TOP edge.
    if (dH > 0) for (let i = 0; i < dH; i++) layout.unshift(new Array(oldW).fill(null))
    else if (dH < 0) layout.splice(0, -dH)
    // Width (cols) on the LEFT edge.
    layout = layout.map(row => {
      const r = row.slice()
      if (dW > 0) for (let i = 0; i < dW; i++) r.unshift(null)
      else if (dW < 0) r.splice(0, -dW)
      return r
    })
    room.tileLayout = layout

    for (const cp of (room.connectionPoints || [])) {
      const d = cp.direction
      if (d === 'N' || d === 'S') cp.x = Math.max(0, Math.min(newW - 1, (cp.x | 0) + dW))
      if (d === 'W' || d === 'E') cp.y = Math.max(0, Math.min(newH - 1, (cp.y | 0) + dH))
      if (d === 'S') cp.y = newH - 1
      if (d === 'E') cp.x = newW - 1
    }
    room.width = newW
    room.height = newH
    return true
  }

  _setZoom(idx) {
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx))
    if (next === this._zoomIdx) return
    this._zoomIdx = next
    this._populatePaintCanvas()
  }

  // Step through 0 → 90 → 180 → 270 → 0 (or backwards with dir = -1). The
  // brush rotation affects how the next paint is stored; the DOM view-control
  // readout reflects it (callers fire _notifyDom).
  _cycleRotation(dir) {
    const i = VALID_ROTATIONS.indexOf(this._activeRot)
    const next = (i + (dir > 0 ? 1 : -1) + VALID_ROTATIONS.length) % VALID_ROTATIONS.length
    this._activeRot = VALID_ROTATIONS[next]
  }

  // Cycle the view rotation. Repaints the paint canvas with the new
  // orientation; existing room data is untouched.
  _cycleViewRotation(dir) {
    const i = VALID_ROTATIONS.indexOf(this._viewRot ?? 0)
    const safeI = i < 0 ? 0 : i
    const next = (safeI + (dir > 0 ? 1 : -1) + VALID_ROTATIONS.length) % VALID_ROTATIONS.length
    this._viewRot = VALID_ROTATIONS[next]
    this._populatePaintCanvas()
  }

  _clearAllOverrides() {
    const room = this._activeRoom()
    if (!room) return
    if (!window.confirm(`Clear all per-cell overrides on "${room.name}"? Theme defaults will show through.`)) return
    this._pushUndo()
    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) room.tileLayout[y][x] = null
    }
    this._populatePaintCanvas()
    this._notifyDom()
  }

  _clearAllDecors() {
    const room = this._activeRoom()
    if (!room) return
    if (!window.confirm(`Remove all decorations from "${room.name}"?`)) return
    this._pushUndo()
    room.decorations = []
    this._populatePaintCanvas()
    this._notifyDom()
  }

  // Upload a PNG and register it as a global decor sprite.
  // Saves the file to assets/sprites/decor/<id>.png and updates the manifest.
  async _uploadDecorSprite() {
    if (!FsHandle.isSupported()) {
      this._toast('File System API not available in this browser', true); return
    }
    // Use a hidden <input> to let the user pick a PNG.
    const input = document.createElement('input')
    input.type   = 'file'
    input.accept = 'image/png,image/webp,image/jpeg'
    input.style.display = 'none'
    document.body.appendChild(input)

    const file = await new Promise(resolve => {
      input.onchange = () => resolve(input.files?.[0] ?? null)
      input.oncancel = () => resolve(null)
      input.click()
    })
    document.body.removeChild(input)
    if (!file) return

    // Derive a clean ID from the filename (strip extension, lowercase, slug).
    const rawId  = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    const baseId = rawId || 'decor'
    let id = baseId
    // If the ID already exists, ask for confirmation to overwrite.
    if (DecorManager.hasSprite(id)) {
      if (!window.confirm(`A decor sprite named "${id}" already exists. Replace it?`)) return
    }

    if (!FsHandle.hasRoot()) {
      this._toast('Pick the Quest-Failed/ folder first…')
      const root = await FsHandle.acquireRoot()
      if (!root) { this._toast('Folder not granted — upload cancelled', true); return }
    }

    try {
      const filePath = `assets/sprites/decor/${id}.png`
      await FsHandle.writeFile(filePath, file)

      // Register in DecorManager.
      DecorManager.addSprite(id, filePath)

      // Save updated manifest to disk.
      await FsHandle.writeJson(DECOR_MANIFEST_PATH, DecorManager.toManifest())

      // Register texture in Phaser so it's immediately usable.
      const dataUrl = await _blobToDataUrl(file)
      const key = DECOR_TEXTURE_KEY(id)
      if (this.textures.exists(key)) this.textures.remove(key)
      await this._addTextureFromDataUrl(key, dataUrl)

      // Auto-select the newly uploaded sprite + rebuild the decor browser.
      this._activeDecorSpriteId = id
      this._overlay?._forceContextRebuild?.()
      this._toast(`Uploaded "${id}"`)
    } catch (err) {
      console.error('[RoomTileEditor] decor upload failed:', err)
      this._toast('Upload failed: ' + (err?.message || err), true)
    }
  }

  async _save() {
    if (!FsHandle.isSupported()) {
      const blob = new Blob([JSON.stringify(this._rooms, null, 4)], { type: 'application/json' })
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
      // Strip empty tileLayouts and decorations arrays to keep JSON clean.
      const out = this._rooms.map(r => {
        const cleaned = { ...r }
        if (!_hasAnyOverride(r)) cleaned.tileLayout = []
        if (!Array.isArray(r.decorations) || r.decorations.length === 0) delete cleaned.decorations
        if (!_hasColorAdjust(r)) {
          delete cleaned.colorAdjust
        } else if (cleaned.colorAdjust && cleaned.colorAdjust.doors) {
          // Doors share the walls colour — drop the legacy per-door target.
          cleaned.colorAdjust = { ...cleaned.colorAdjust }
          delete cleaned.colorAdjust.doors
        }
        if (!r.backgroundImage) delete cleaned.backgroundImage
        if (!r.backgroundImageByBoss || Object.keys(r.backgroundImageByBoss).length === 0) delete cleaned.backgroundImageByBoss
        // Strip all-null door swatches / aprons (e.g. created just by viewing a
        // door state). _flatNull recurses both shapes (doorTiles 3-D, apron 2-D).
        if (_flatNull(r.doorTiles)) delete cleaned.doorTiles
        if (_flatNull(r.doorApron)) delete cleaned.doorApron
        // Per-boss door swatches: drop boss keys that are all-null, then the
        // whole map if it ends up empty.
        const pruneByBoss = (map) => {
          if (!map || typeof map !== 'object') return null
          const out = {}
          for (const [boss, byState] of Object.entries(map)) {
            if (!_flatNull(byState)) out[boss] = byState
          }
          return Object.keys(out).length ? out : null
        }
        const dtb = pruneByBoss(r.doorTilesByBoss)
        if (dtb) cleaned.doorTilesByBoss = dtb; else delete cleaned.doorTilesByBoss
        const dab = pruneByBoss(r.doorApronByBoss)
        if (dab) cleaned.doorApronByBoss = dab; else delete cleaned.doorApronByBoss
        return cleaned
      })
      // 4-space to match the committed rooms.json format (writeJson would emit
      // 2-space and reformat the whole file on every save).
      await FsHandle.writeText('src/data/rooms.json', JSON.stringify(out, null, 4))
      // Also persist the decor manifest so new uploads survive a page reload.
      if (DecorManager.listSprites().length > 0) {
        await FsHandle.writeJson(DECOR_MANIFEST_PATH, DecorManager.toManifest())
      }
      // Flush any staged sprite / skin PNG bytes (theme tiles, door-skin
      // slices, room skins) so they exist on disk before the manifest that
      // references them — the main Save persists everything in one click.
      for (const [id, bytes] of this._pendingThemeBytes()) {
        await FsHandle.writeFile(spritePath(id), new Blob([bytes], { type: 'image/png' }))
      }
      this._pendingThemeBytes().clear()
      for (const [id, bytes] of this._pendingSkinBytes()) {
        await FsHandle.writeFile(roomSkinPath(id), new Blob([bytes], { type: 'image/png' }))
      }
      this._pendingSkinBytes().clear()
      // Persist the theme manifest too, so tile uploads / deletions / slot
      // edits / door skins made from the palettes survive without a separate
      // Themes save.
      await FsHandle.writeJson('assets/themes/manifest.json', ThemeManager.serialize())
      // Mirror change into the live cache so other systems see updated
      // theme + tileLayout + doorTiles fields without a reload.
      const live = this.cache.json.get('rooms')
      if (Array.isArray(live)) {
        live.length = 0
        for (const r of out) live.push(structuredClone(r))
      }
      // Tell the running Game scene to re-apply every room's def so the
      // edits show up in the dungeon view without restarting. ROOMS_ALL_RESET
      // covers theme/doorTheme/tileLayout/doorTiles in one event.
      EventBus.emit('ROOMS_ALL_RESET')
      this._toast(`✓ Saved ${out.length} rooms to disk`, false, 'success')
      this._notifyDom()
    } catch (err) {
      console.error('[RoomTileEditor] save failed:', err)
      this._toast('Save failed: ' + (err?.message || err), true)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  _refreshAll() {
    this._populatePaintCanvas()
    this._notifyDom()
  }

  _renderEmpty(msg) {
    this.add.graphics().fillStyle(COL_BG, 1).fillRect(0, 0, 1920, 1080)
    this.add.text(1920 / 2, 1080 / 2, msg, {
      fontSize: '18px', color: COL_TEXT_WARN, fontFamily: 'monospace',
    }).setOrigin(0.5)
    this.add.text(1920 / 2, 1080 / 2 + 30, '(BACK to menu)', {
      fontSize: '14px', color: COL_TEXT, fontFamily: 'monospace',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('MainMenu'))
  }

  _toast(msg, isError = false, kind = null) {
    this._cToast.removeAll(true)
    // Centre the toast over the paint canvas near its TOP edge (1920×1080
    // logical coords — same space the camera renders). Top, not bottom, so
    // it isn't hidden behind the floating view-controls pill / hint bar.
    const a = this._paintAreaRect || EDITOR_LAYOUT.canvas
    const tx = a.x + a.w / 2
    const ty = a.y + 26
    const success = kind === 'success'
    const color = isError ? COL_TEXT_WARN : (success ? '#bff5c0' : COL_TEXT_HI)
    const bg     = isError ? '#2a0a0a'    : (success ? '#0d3018' : '#0a0514')
    const t = _text(this, tx, ty, msg, {
      fontSize: success ? '16px' : '13px', color, fontStyle: success ? 'bold' : 'normal',
      backgroundColor: bg, padding: { x: 14, y: 9 },
    }).setOrigin(0.5)
    this._cToast.add(t)
    // Pop-in so it reads as a clear confirmation (esp. for save success).
    t.setScale(0.92)
    this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' })
    this.tweens.add({
      targets: t, alpha: { from: 1, to: 0 }, duration: 2400, delay: success ? 1700 : 800,
      onComplete: () => t.destroy(),
    })
  }
}

// ── Color adjustment helpers ─────────────────────────────────────────────

// Returns true if the room has any non-zero color adjustment.
// True if a value (recursively) contains no non-null primitive — used to strip
// empty door swatches / aprons (nested arrays / per-state objects) on save.
function _flatNull(v) {
  if (v == null) return true
  if (Array.isArray(v)) return v.every(_flatNull)
  if (typeof v === 'object') return Object.values(v).every(_flatNull)
  return false
}

function _hasColorAdjust(room) {
  const ca = room?.colorAdjust
  if (!ca) return false
  // Doors share the walls colour now — only walls + floor are real targets.
  for (const t of ['walls', 'floor']) {
    const s = ca[t]
    if (s && (s.hue || s.sat || s.bright || s.contrast)) return true
  }
  return false
}

// Applies hue/sat/bright/contrast via Phaser 3.60 postFX ColorMatrix.
// adj = { hue:0, sat:0, bright:0, contrast:0 } — all default to 0 (no change).
// bright is a delta from 1: stored 0 → passes brightness(1) to Phaser.
//
// FX.ColorMatrix extends Display.ColorMatrix, whose hue/saturate/brightness/
// contrast methods take (value, multiply). Default multiply=false REPLACES
// the matrix, which makes chained calls clobber each other (the original
// bug — only the last transform showed up). Pass multiply=true so each
// transform composes onto the previous.
function _applyColorAdj(img, adj) {
  if (!adj) return
  const { hue = 0, sat = 0, bright = 0, contrast = 0 } = adj
  if (!hue && !sat && !bright && !contrast) return
  try {
    const cm = img.postFX?.addColorMatrix?.()
    if (!cm) return
    if (hue)      cm.hue(hue, true)
    if (sat)      cm.saturate(sat, true)
    if (bright)   cm.brightness(1 + bright, true)
    if (contrast) cm.contrast(contrast, true)
  } catch (_) {}
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

// Load an <img> from a data/blob URL, resolving once decoded.
function _loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Decode a `data:...;base64,` URL to raw bytes (for staging PNGs to FsHandle).
function _dataUrlToBytes(dataUrl) {
  const bin = atob(String(dataUrl).split(',')[1] || '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// Largest native dimension of an image data URL (used to bucket uploaded
// sprites into a 32/64/128 source size). Resolves to 32 on any load error.
function _imgDim(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload  = () => resolve(Math.max(img.naturalWidth || 32, img.naturalHeight || 32))
    img.onerror = () => resolve(32)
    img.src = dataUrl
  })
}

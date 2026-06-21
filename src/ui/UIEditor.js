// In-game layout tuner.
//
// Press F2 to toggle edit mode in any scene that wires it up. The editor
// adds drag handles to registered objects, an HTML side panel with the
// item list + property editor, an alignment-guide system during drag, and
// auto-save to localStorage so accidental tab closes don't lose work.
//
// Selection
//   Click handle               — single select
//   Shift+click handle         — toggle in/out of selection
//   Ctrl+A                     — select all visible
//   Drag empty canvas          — marquee box-select (intersect)
//   Click empty canvas         — clear selection
//
// Move + scale + layer + rotation
//   Drag selected              — move ALL selected together (snaps to grid)
//   Arrow keys                 — nudge 1 px (Shift = 10 px)
//   [ / ]                      — scale 0.9× / 1.1× (Shift = 0.99× / 1.01×)
//   Q / E                      — rotate -1° / +1° (Shift = -15° / +15°)
//   ,  .                       — back / forward 1 depth step
//   Shift+, / Shift+.          — to back / to front (extreme)
//
// Content editing
//   T                          — edit text on the selected text item
//   N                          — new text box (centred)
//   U                          — upload image (centred)
//   Ctrl+D                     — duplicate selected at +10/+10 offset
//
// Layout helpers
//   Align + distribute         — buttons in panel (need 2+ selected)
//   Alignment guides           — appear automatically while dragging
//
// House-keeping
//   Delete / Backspace         — hide selected (toggle from panel to unhide)
//   R                          — reset selected to code defaults
//   G                          — cycle grid 4→8→16→32
//   Shift+G                    — toggle snap on/off
//   Ctrl+Z                     — undo (50 deep, covers everything)
//   Ctrl+S                     — save & download <sceneKey>.json
//   F2                         — exit edit mode
//
// Auto-save: every change writes the current layout to
//   localStorage[uieditor:<sceneKey>]
// on a 500 ms debounce. On enter to edit mode, the editor offers to
// restore the autosave if it differs from the loaded JSON.
//
// Wiring a scene:
//
//   // preload()
//   this.load.json(`layout-${this.scene.key}`,
//     `assets/layouts/${this.scene.key}.json`)
//
//   // create() — register objects, then load dynamic items:
//   this.editor = new UIEditor(this)
//   this.editor.register(myImg, 'compendium-header')
//   await this.editor.loadDynamicItems()

const NUDGE = 1
const NUDGE_BIG = 10
const GRID_SIZES = [4, 8, 16, 32]
const GUIDE_THRESHOLD = 4                 // px — guide snap distance

const DEFAULT_TEXT_STYLE = {
  fontSize: '16px',
  color: '#ffd0a0',
  fontFamily: 'serif',
  fontStyle: 'bold',
  stroke: '#000000',
  strokeThickness: 3,
}

// In-app text prompt — window.prompt() is unsupported in Electron (returns null).
import { domPrompt } from '../hud/domPrompt.js'

export class UIEditor {
  constructor(scene) {
    this.scene = scene
    this.sceneKey = scene.scene.key
    this.layoutData = scene.cache.json.get(`layout-${this.sceneKey}`) ?? {}
    this.items = []                          // [{ name, obj, dynamic?, locked, initial }]
    this.mode = false
    this.selection = new Set()
    this._handles = []
    this._outlines = new Map()
    this._undoStack = []
    this.snap = true
    this.gridSize = 8
    this._gridGfx = null
    this._guideGfx = null
    this._marqueeGfx = null
    this._marqueeStart = null
    this._dynamicCounter = 0
    this._panel = null                       // DOM element
    this._autoSaveTimer = null
    this.bossList = null                     // [{ id, label }] when scene configures bosses
    this.activeBossId = null
    this._onBossSelect = null
    this._setupKeys()
    this._setupCanvasInput()
  }

  /** Configure the panel's boss switcher. Pass an array of {id, label} and
   *  a callback that the scene runs to select that boss. The editor draws
   *  buttons in the panel; clicking one fires onSelect(id). The scene must
   *  also call setActiveBoss(id) when its own selection changes (e.g., from
   *  number-key shortcuts) so the panel highlights match. */
  configureBosses(bossList, onSelect) {
    this.bossList = bossList
    this._onBossSelect = onSelect
    if (this.mode) this._refreshPanel()
  }

  /** Notify the editor that the scene's "active boss" has changed. The
   *  editor uses this to highlight the matching switcher button and to
   *  hide items that are pinned to a different boss. */
  setActiveBoss(id) {
    if (this.activeBossId === id) return
    this.activeBossId = id
    this._applyBossPinVisibility()
    this._refreshAllSelectionVisuals()
    this._refreshPanel()
  }

  /** Pin selected items so they only show when the given boss is active.
   *  Pass null to unpin. */
  pinSelectedToBoss(bossId) {
    if (this.selection.size === 0) return
    this._pushUndo()
    for (const it of this.selection) it.boundBoss = bossId ?? null
    this._applyBossPinVisibility()
    this._refreshAllSelectionVisuals()
    this._refreshPanel()
    this._scheduleAutoSave()
    this._flashStatus(bossId ? `Pinned to ${bossId}` : 'Unpinned')
  }

  /** Apply visibility rules: items with boundBoss set are visible only when
   *  that boss is the active one. Items with boundBoss == null are always
   *  available (visibility controlled by the user via Delete/eye toggle). */
  _applyBossPinVisibility() {
    for (const it of this.items) {
      if (!it.boundBoss) continue
      const shouldShow = it.boundBoss === this.activeBossId
      // Use a separate flag so the user's manual hide (visible:false) is
      // preserved across boss switches. We only change visibility when the
      // pin state demands it.
      const wasHidden = it.obj.visible === false
      const wantHidden = !shouldShow || it._userHidden === true
      if (wasHidden !== wantHidden) {
        it.obj.setVisible?.(!wantHidden)
        if (wantHidden) {
          this._destroyHandleFor(it)
          this.selection.delete(it)
          this._destroyOutlineFor(it)
        } else if (this.mode) {
          this._addHandleFor(it)
        }
      }
    }
  }

  /** Register an editable game object. Captures initial state for reset.
   *  opts.fallbackName: a legacy key to fall back on when `name` isn't in
   *  the saved layout — useful when migrating to per-boss-prefixed keys. */
  register(obj, name, opts = {}) {
    let ovr = this.layoutData[name]
    if (!ovr && opts.fallbackName) ovr = this.layoutData[opts.fallbackName]
    const boundBoss = ovr?.bossId ?? null
    const userHidden = ovr?.visible === false
    if (ovr) {
      if (typeof ovr.x === 'number') obj.x = ovr.x
      if (typeof ovr.y === 'number') obj.y = ovr.y
      if (typeof ovr.scaleX === 'number' && obj.setScale) {
        obj.setScale(ovr.scaleX, typeof ovr.scaleY === 'number' ? ovr.scaleY : ovr.scaleX)
      }
      if (typeof ovr.depth === 'number') {
        // A saved non-zero depth was set via the editor's layer buttons,
        // which means the item was lifted from its container. Lift it again
        // here so the global depth ordering survives reloads.
        if (ovr.depth !== 0) this._liftFromContainer(obj)
        obj.setDepth?.(ovr.depth)
      }
      if (typeof ovr.angle === 'number') obj.setAngle?.(ovr.angle)
      if (typeof ovr.alpha === 'number') obj.setAlpha?.(ovr.alpha)
      if (typeof ovr.tint === 'number' && obj.setTint) obj.setTint(ovr.tint)
      if (typeof ovr.text === 'string' && obj.setText) obj.setText(ovr.text)
      if (ovr.style && obj.setStyle) obj.setStyle(ovr.style)
      if (ovr.visible === false) obj.setVisible?.(false)
    }
    const initial = this._snapshotObj(obj, ovr ? this._codeDefaultFor(name, obj) : obj)
    const existingIdx = this.items.findIndex(it => it.name === name)
    let item
    if (existingIdx >= 0) {
      const old = this.items[existingIdx]
      if (this.mode) this._destroyHandleFor(old)
      this.selection.delete(old)
      this._destroyOutlineFor(old)
      item = {
        name, obj,
        dynamic: opts.dynamic ?? old.dynamic ?? null,
        locked:  old.locked ?? false,
        initial: old.initial ?? initial,    // preserve across re-registers
        boundBoss: ovr ? boundBoss : (old.boundBoss ?? null),
        _userHidden: ovr ? userHidden : (old._userHidden ?? false),
      }
      this.items[existingIdx] = item
    } else {
      item = {
        name, obj,
        dynamic: opts.dynamic ?? null,
        locked: false,
        initial,
        boundBoss,
        _userHidden: userHidden,
      }
      this.items.push(item)
    }
    // Apply pin visibility: items pinned to a different boss become hidden.
    if (item.boundBoss && item.boundBoss !== this.activeBossId) {
      obj.setVisible?.(false)
    }
    if (this.mode) {
      this._addHandleFor(item)
      this._refreshPanel()
    }
    return obj
  }

  /** Snapshot the relevant editable fields off an object. */
  _snapshotObj(obj, source = obj) {
    const snap = {
      x: source.x, y: source.y,
      depth: source.depth ?? 0,
      visible: source.visible !== false,
      angle: source.angle ?? 0,
      alpha: source.alpha ?? 1,
    }
    if (typeof source.scaleX === 'number') {
      snap.scaleX = source.scaleX
      snap.scaleY = source.scaleY
    }
    if (typeof source.text === 'string') snap.text = source.text
    if (source.style) {
      snap.style = {
        color:           source.style.color,
        fontSize:        source.style.fontSize,
        fontFamily:      source.style.fontFamily,
        fontStyle:       source.style.fontStyle,
        stroke:          source.style.stroke,
        strokeThickness: source.style.strokeThickness,
      }
    }
    if (typeof source.tintTopLeft === 'number') snap.tint = source.tintTopLeft
    return snap
  }

  /** What the scene code would have set, ignoring layout JSON overrides.
   *  We don't have that info directly — fall back to the object's current
   *  state at register time as a best approximation. */
  _codeDefaultFor(_name, obj) {
    return obj
  }

  /** Remove a previously registered item. Used when the scene rebuilds a
   *  dynamic block (e.g. per-boss dossier) and wants to forget its old
   *  registrations before adding new ones. Does NOT destroy the game object
   *  — the caller already does that. */
  unregister(name) {
    const idx = this.items.findIndex(it => it.name === name)
    if (idx < 0) return
    const it = this.items[idx]
    this.selection.delete(it)
    this._destroyOutlineFor(it)
    if (this.mode) this._destroyHandleFor(it)
    this.items.splice(idx, 1)
    if (this.mode) this._refreshPanel()
  }

  /** Spawn user-uploaded images and user-created text boxes saved in the
   *  layout. Call after the scene has registered its own objects. */
  async loadDynamicItems() {
    const dynamicArr = this.layoutData.__dynamic__
    if (!Array.isArray(dynamicArr)) return
    for (const spec of dynamicArr) {
      try {
        if (spec.type === 'text') this._spawnText(spec)
        else if (spec.type === 'image') await this._spawnImage(spec)
      } catch (err) {
        console.warn('UIEditor: failed to spawn dynamic item', spec, err)
      }
    }
  }

  toggle() { this.mode ? this.disable() : this.enable() }

  enable() {
    if (this.mode) return
    this.mode = true
    this.scene.input.setTopOnly(true)
    this._buildOverlay()
    this._buildPanel()
    this._maybeOfferAutosaveRestore()
  }

  disable() {
    if (!this.mode) return
    this.mode = false
    this._tearOverlay()
    this._destroyPanel()
  }

  // ─── Persistence ──────────────────────────────────────────────────────

  _serialize() {
    const out = {}
    const dynamic = []
    for (const it of this.items) {
      const { name, obj } = it
      const entry = { x: Math.round(obj.x), y: Math.round(obj.y) }
      if (typeof obj.scaleX === 'number' && (obj.scaleX !== 1 || obj.scaleY !== 1)) {
        entry.scaleX = +obj.scaleX.toFixed(3)
        entry.scaleY = +obj.scaleY.toFixed(3)
      }
      if (typeof obj.depth === 'number' && obj.depth !== 0) entry.depth = obj.depth
      if (typeof obj.angle === 'number' && obj.angle !== 0) entry.angle = +obj.angle.toFixed(2)
      if (typeof obj.alpha === 'number' && obj.alpha !== 1) entry.alpha = +obj.alpha.toFixed(3)
      if (typeof obj.tintTopLeft === 'number' && obj.tintFill === false && obj.tintTopLeft !== 0xffffff) {
        entry.tint = obj.tintTopLeft
      }
      // Visibility: only mark as `visible:false` for user-hidden items, not
      // for items that are temporarily hidden because they're pinned to a
      // different boss. _userHidden carries that distinction.
      if (it._userHidden) entry.visible = false
      if (it.locked) entry.locked = true
      if (it.boundBoss) entry.bossId = it.boundBoss
      // Text content + style overrides — only saved when they differ from
      // the initial (code-set) value, so JSON stays clean for untouched text.
      if (typeof obj.text === 'string' && it.initial) {
        if (obj.text !== it.initial.text) entry.text = obj.text
        if (obj.style && it.initial.style) {
          const styleDiff = {}
          for (const k of ['color', 'fontSize', 'fontFamily', 'fontStyle', 'stroke', 'strokeThickness']) {
            if (obj.style[k] !== it.initial.style[k]) styleDiff[k] = obj.style[k]
          }
          if (Object.keys(styleDiff).length > 0) entry.style = styleDiff
        }
      }
      out[name] = entry
      if (it.dynamic) {
        const spec = { name, type: it.dynamic.type, ...entry }
        if (it.dynamic.type === 'text') {
          spec.text = obj.text ?? it.dynamic.text
          spec.style = it.dynamic.style ?? {}
        } else if (it.dynamic.type === 'image') {
          spec.src = it.dynamic.src
        }
        dynamic.push(spec)
      }
    }
    if (dynamic.length > 0) out.__dynamic__ = dynamic
    return out
  }

  save() {
    // Merge first so layoutData reflects the active boss's edits, then
    // serialize. layoutData includes entries for other bosses' dossiers
    // that aren't currently registered.
    this._syncLayoutData()
    const json = JSON.stringify(this.layoutData, null, 2)
    if (navigator.clipboard) navigator.clipboard.writeText(json).catch(() => {})
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${this.sceneKey}.json`
    document.body.appendChild(a); a.click()
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 100)
    this._flashStatus(`Saved ${this.sceneKey}.json (also on clipboard)`)
    // Clear the autosave marker — saved is the new baseline.
    try { localStorage.removeItem(this._autosaveKey()) } catch {}
  }

  _autosaveKey() { return `uieditor:${this.sceneKey}` }

  _scheduleAutoSave() {
    if (!this.mode) return
    // Sync in-memory layoutData immediately so re-registers (e.g. switching
    // bosses, which destroys + recreates the dossier items) pick up the
    // latest user edits instead of the stale at-load values. The localStorage
    // write itself stays debounced.
    this._syncLayoutData()
    clearTimeout(this._autoSaveTimer)
    this._autoSaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(this._autosaveKey(), JSON.stringify(this.layoutData))
      } catch (err) {
        // Quota or disabled storage — skip silently.
      }
    }, 500)
  }

  /** Merge the current state of all registered items into this.layoutData.
   *  Items NOT currently registered (other bosses' dossier items, items
   *  destroyed by a boss switch) keep their existing layoutData entry, so
   *  they survive the round-trip. */
  _syncLayoutData() {
    const current = this._serialize()
    for (const k of Object.keys(current)) {
      this.layoutData[k] = current[k]
    }
  }

  _maybeOfferAutosaveRestore() {
    let raw
    try { raw = localStorage.getItem(this._autosaveKey()) } catch { return }
    if (!raw) return
    if (raw === JSON.stringify(this._serialize())) return     // no diff
    if (window.confirm('UIEditor found an unsaved autosave for this scene. Restore it?')) {
      try {
        this.layoutData = JSON.parse(raw)
        this._applyLayoutToAllItems()
        this._refreshPanel()
        this._flashStatus('Autosave restored')
      } catch (err) {
        console.warn('UIEditor: bad autosave JSON', err)
      }
    } else {
      try { localStorage.removeItem(this._autosaveKey()) } catch {}
    }
  }

  _applyLayoutToAllItems() {
    for (const it of this.items) {
      const ovr = this.layoutData[it.name]
      if (!ovr) continue
      const obj = it.obj
      if (typeof ovr.x === 'number') obj.x = ovr.x
      if (typeof ovr.y === 'number') obj.y = ovr.y
      if (typeof ovr.scaleX === 'number' && obj.setScale) {
        obj.setScale(ovr.scaleX, typeof ovr.scaleY === 'number' ? ovr.scaleY : ovr.scaleX)
      }
      if (typeof ovr.depth === 'number') {
        // A saved non-zero depth was set via the editor's layer buttons,
        // which means the item was lifted from its container. Lift it again
        // here so the global depth ordering survives reloads.
        if (ovr.depth !== 0) this._liftFromContainer(obj)
        obj.setDepth?.(ovr.depth)
      }
      if (typeof ovr.angle === 'number') obj.setAngle?.(ovr.angle)
      if (typeof ovr.alpha === 'number') obj.setAlpha?.(ovr.alpha)
      if (typeof ovr.tint === 'number' && obj.setTint) obj.setTint(ovr.tint)
      it.locked = !!ovr.locked
      obj.setVisible?.(ovr.visible !== false)
    }
    this._refreshAllSelectionVisuals()
  }

  // ─── Input wiring ─────────────────────────────────────────────────────

  _setupKeys() {
    const kb = this.scene.input.keyboard
    kb.on('keydown-F2', () => this.toggle())
    kb.on('keydown-S', (e) => {
      if (this.mode && (e.ctrlKey || e.metaKey)) { e.preventDefault?.(); this.save() }
    })
    kb.on('keydown-Z', (e) => {
      if (this.mode && (e.ctrlKey || e.metaKey)) { e.preventDefault?.(); this.undo() }
    })
    kb.on('keydown-A', (e) => {
      if (this.mode && (e.ctrlKey || e.metaKey)) { e.preventDefault?.(); this.selectAll() }
    })
    kb.on('keydown-D', (e) => {
      if (this.mode && (e.ctrlKey || e.metaKey)) { e.preventDefault?.(); this.duplicateSelected() }
    })
    kb.on('keydown-DELETE',    () => { if (this.mode) this.deleteSelected() })
    kb.on('keydown-BACKSPACE', () => { if (this.mode) this.deleteSelected() })
    kb.on('keydown-OPEN_BRACKET',   (e) => this._scaleSelected(e.shiftKey ? 0.99 : 0.9))
    kb.on('keydown-CLOSED_BRACKET', (e) => this._scaleSelected(e.shiftKey ? 1.01 : 1.1))
    kb.on('keydown-COMMA',  (e) => this._adjustDepth(-1, e.shiftKey))
    kb.on('keydown-PERIOD', (e) => this._adjustDepth(+1, e.shiftKey))
    kb.on('keydown-Q', (e) => { if (this.mode && !e.ctrlKey && !e.metaKey) this._rotateSelected(e.shiftKey ? -15 : -1) })
    kb.on('keydown-E', (e) => { if (this.mode && !e.ctrlKey && !e.metaKey) this._rotateSelected(e.shiftKey ? +15 : +1) })
    kb.on('keydown-R', (e) => { if (this.mode && !e.ctrlKey && !e.metaKey) this.resetSelected() })
    kb.on('keydown-T', (e) => { if (this.mode && !e.ctrlKey && !e.metaKey) this.editSelectedText() })
    kb.on('keydown-N', (e) => { if (this.mode && !e.ctrlKey && !e.metaKey) this.createTextBox() })
    kb.on('keydown-U', (e) => { if (this.mode && !e.ctrlKey && !e.metaKey) this.uploadImage() })
    kb.on('keydown-G', (e) => {
      if (!this.mode || e.ctrlKey || e.metaKey) return
      if (e.shiftKey) {
        this.snap = !this.snap
        this._flashStatus(`Snap ${this.snap ? 'ON' : 'OFF'} (${this.gridSize}px)`)
      } else {
        const idx = GRID_SIZES.indexOf(this.gridSize)
        this.gridSize = GRID_SIZES[(idx + 1) % GRID_SIZES.length]
        this.snap = true
        this._flashStatus(`Grid ${this.gridSize}px`)
      }
      this._refreshGrid()
    })
    for (const k of ['LEFT', 'RIGHT', 'UP', 'DOWN']) {
      kb.on(`keydown-${k}`, (e) => {
        if (!this.mode || this.selection.size === 0) return
        this._pushUndo()
        const step = e.shiftKey ? NUDGE_BIG : NUDGE
        const dx = k === 'LEFT' ? -step : k === 'RIGHT' ? step : 0
        const dy = k === 'UP'   ? -step : k === 'DOWN'  ? step : 0
        for (const it of this.selection) {
          if (it.locked) continue
          it.obj.x += dx
          it.obj.y += dy
        }
        this._refreshAllSelectionVisuals()
        this._scheduleAutoSave()
      })
    }
  }

  _setupCanvasInput() {
    this.scene.input.on('pointerdown', (p) => {
      if (!this.mode) return
      if (this._suppressEmptyClick) {
        this._suppressEmptyClick = false
        return
      }
      // Empty-canvas down — start marquee unless user just clicked a handle.
      this._marqueeStart = { x: p.worldX, y: p.worldY }
    })
    this.scene.input.on('pointermove', (p) => {
      if (!this.mode || !this._marqueeStart) return
      this._drawMarquee(this._marqueeStart, { x: p.worldX, y: p.worldY })
    })
    this.scene.input.on('pointerup', (p) => {
      if (!this.mode) return
      const start = this._marqueeStart
      this._marqueeStart = null
      this._marqueeGfx?.destroy(); this._marqueeGfx = null
      if (!start) return
      const dx = p.worldX - start.x, dy = p.worldY - start.y
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
        // Click without drag — treat as clear.
        this.clearSelection()
        return
      }
      const rect = this._normRect(start, { x: p.worldX, y: p.worldY })
      this.selection.clear()
      for (const it of this.items) {
        if (it.obj.visible === false || it.locked) continue
        const b = it.obj.getBounds?.()
        if (!b) continue
        if (this._rectsIntersect(rect, b)) this.selection.add(it)
      }
      this._refreshAllSelectionVisuals()
    })
  }

  _normRect(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
    return { x, y, width: w, height: h, right: x + w, bottom: y + h, centerX: x + w/2, centerY: y + h/2 }
  }

  _rectsIntersect(a, b) {
    return !(a.right < b.left || a.x > b.right || a.bottom < b.top || a.y > b.bottom)
  }

  _drawMarquee(start, current) {
    if (!this._marqueeGfx) {
      this._marqueeGfx = this.scene.add.graphics().setDepth(9990)
    }
    const r = this._normRect(start, current)
    this._marqueeGfx.clear()
    this._marqueeGfx.lineStyle(1, 0x00ff88, 1)
    this._marqueeGfx.strokeRect(r.x, r.y, r.width, r.height)
    this._marqueeGfx.fillStyle(0x00ff88, 0.08)
    this._marqueeGfx.fillRect(r.x, r.y, r.width, r.height)
  }

  // ─── Selection ────────────────────────────────────────────────────────

  selectAll() {
    this.selection.clear()
    for (const it of this.items) {
      if (it.obj.visible !== false && !it.locked) this.selection.add(it)
    }
    this._refreshAllSelectionVisuals()
  }

  clearSelection() {
    this.selection.clear()
    this._refreshAllSelectionVisuals()
  }

  _setSingleSelection(it) {
    this.selection.clear()
    this.selection.add(it)
    this._refreshAllSelectionVisuals()
  }

  _toggleSelection(it) {
    if (this.selection.has(it)) this.selection.delete(it)
    else                        this.selection.add(it)
    this._refreshAllSelectionVisuals()
  }

  // ─── Lock / Visibility ───────────────────────────────────────────────

  toggleLock(it) {
    this._pushUndo()
    it.locked = !it.locked
    if (it.locked) this.selection.delete(it)
    this._refreshAllSelectionVisuals()
    this._refreshPanel()
    this._scheduleAutoSave()
  }

  toggleVisible(it) {
    this._pushUndo()
    const next = it.obj.visible === false
    it._userHidden = !next
    it.obj.setVisible?.(next)
    if (next) {
      if (this.mode) this._addHandleFor(it)
    } else {
      this._destroyHandleFor(it)
      this.selection.delete(it)
      this._destroyOutlineFor(it)
    }
    this._refreshAllSelectionVisuals()
    this._refreshPanel()
    this._scheduleAutoSave()
  }

  // ─── Delete (hide) ────────────────────────────────────────────────────

  deleteSelected() {
    if (this.selection.size === 0) return
    this._pushUndo()
    for (const it of this.selection) {
      it._userHidden = true
      it.obj.setVisible?.(false)
      this._destroyHandleFor(it)
      this._destroyOutlineFor(it)
    }
    this.selection.clear()
    this._refreshAllSelectionVisuals()
    this._refreshPanel()
    this._scheduleAutoSave()
  }

  // ─── Scale / Rotate / Depth ───────────────────────────────────────────

  _scaleSelected(factor) {
    if (!this.mode || this.selection.size === 0) return
    this._pushUndo()
    for (const it of this.selection) {
      if (it.locked) continue
      if (typeof it.obj.scaleX !== 'number' || !it.obj.setScale) continue
      it.obj.setScale(it.obj.scaleX * factor, it.obj.scaleY * factor)
    }
    this._refreshAllSelectionVisuals()
    this._scheduleAutoSave()
  }

  _rotateSelected(deg) {
    if (!this.mode || this.selection.size === 0) return
    this._pushUndo()
    for (const it of this.selection) {
      if (it.locked) continue
      if (!it.obj.setAngle) continue
      it.obj.setAngle((it.obj.angle ?? 0) + deg)
    }
    this._refreshAllSelectionVisuals()
    this._scheduleAutoSave()
  }

  _adjustDepth(direction, extreme) {
    if (!this.mode || this.selection.size === 0) return
    this._pushUndo()
    for (const it of this.selection) {
      if (it.locked || !it.obj.setDepth) continue
      this._liftFromContainer(it.obj)
      if (extreme) {
        it.obj.setDepth(direction < 0 ? -1000 : 1000)
      } else {
        it.obj.setDepth((it.obj.depth ?? 0) + direction)
      }
    }
    this._refreshAllSelectionVisuals()
    this._scheduleAutoSave()
  }

  /** Move a game object out of its parent container into the scene root so
   *  its depth value is interpreted globally. Container offset is assumed
   *  (0, 0) — true for our usage in ArchetypeSelect. */
  _liftFromContainer(obj) {
    if (!obj.parentContainer) return
    const c = obj.parentContainer
    c.remove(obj, false)
    this.scene.add.existing(obj)
  }

  // ─── Tint / Alpha (called from panel) ─────────────────────────────────

  setSelectedTint(hex) {
    if (this.selection.size === 0) return
    this._pushUndo()
    for (const it of this.selection) {
      if (it.locked || !it.obj.setTint) continue
      it.obj.setTint(hex)
    }
    this._scheduleAutoSave()
    // No panel rebuild — would tear down the open color picker dialog.
  }

  clearSelectedTint() {
    if (this.selection.size === 0) return
    this._pushUndo()
    for (const it of this.selection) {
      if (it.locked || !it.obj.clearTint) continue
      it.obj.clearTint()
    }
    this._scheduleAutoSave()
    this._refreshPanel()
  }

  setSelectedAlpha(alpha) {
    if (this.selection.size === 0) return
    this._pushUndo()
    for (const it of this.selection) {
      if (it.locked || !it.obj.setAlpha) continue
      it.obj.setAlpha(alpha)
    }
    this._scheduleAutoSave()
  }

  // ─── Text editing ─────────────────────────────────────────────────────

  async editSelectedText() {
    if (this.selection.size !== 1) {
      this._flashStatus('Select a single text item to edit')
      return
    }
    const it = [...this.selection][0]
    if (typeof it.obj.text !== 'string' || !it.obj.setText) {
      this._flashStatus('Selected item is not text')
      return
    }
    const next = await domPrompt({ title: 'EDIT TEXT', value: it.obj.text })
    if (next === null) return
    this._pushUndo()
    it.obj.setText(next)
    if (it.dynamic && it.dynamic.type === 'text') it.dynamic.text = next
    this._refreshAllSelectionVisuals()
    this._scheduleAutoSave()
  }

  setSelectedTextStyle(partial) {
    if (this.selection.size === 0) return
    this._pushUndo()
    for (const it of this.selection) {
      if (it.locked || !it.obj.setStyle || typeof it.obj.text !== 'string') continue
      it.obj.setStyle(partial)
      if (it.dynamic && it.dynamic.type === 'text') {
        it.dynamic.style = { ...(it.dynamic.style ?? {}), ...partial }
      }
    }
    // Skip the full panel rebuild so an open color picker / focused input
    // stays alive while the user adjusts values.
    this._refreshOutlinesOnly()
    this._scheduleAutoSave()
  }

  async createTextBox() {
    const text = await domPrompt({ title: 'NEW TEXT BOX', message: 'Content:', value: 'NEW TEXT' })
    if (text === null) return
    const cam = this.scene.cameras.main
    const cx = (cam.width / cam.zoom) / 2
    const cy = (cam.height / cam.zoom) / 2
    const style = { ...DEFAULT_TEXT_STYLE }
    const t = this.scene.add.text(cx, cy, text, style).setOrigin(0.5).setDepth(50)
    const name = this._uniqueName('text')
    this.register(t, name, { dynamic: { type: 'text', text, style } })
    this._setSingleSelection(this.items.find(it => it.name === name))
    this._flashStatus(`Added text "${name}"`)
    this._scheduleAutoSave()
  }

  // ─── Image upload ─────────────────────────────────────────────────────

  uploadImage() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      const file = input.files?.[0]
      document.body.removeChild(input)
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target.result
        this._spawnImage({
          name: this._uniqueName('upload'),
          type: 'image',
          src: dataUrl,
        }).catch(err => console.warn('UIEditor: upload failed', err))
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  _spawnImage(spec) {
    return new Promise((resolve) => {
      const finalize = () => {
        const cam = this.scene.cameras.main
        const x = spec.x ?? (cam.width / cam.zoom) / 2
        const y = spec.y ?? (cam.height / cam.zoom) / 2
        const img = this.scene.add.image(x, y, spec.name).setOrigin(0.5).setDepth(spec.depth ?? 50)
        if (typeof spec.scaleX === 'number') img.setScale(spec.scaleX, spec.scaleY ?? spec.scaleX)
        if (typeof spec.angle === 'number') img.setAngle(spec.angle)
        if (typeof spec.alpha === 'number') img.setAlpha(spec.alpha)
        if (typeof spec.tint === 'number' && img.setTint) img.setTint(spec.tint)
        if (img.texture && img.texture.setFilter) {
          img.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
        }
        this.register(img, spec.name, { dynamic: { type: 'image', src: spec.src } })
        if (this.mode) this._setSingleSelection(this.items.find(it => it.name === spec.name))
        this._flashStatus(`Added image "${spec.name}"`)
        this._scheduleAutoSave()
        resolve(img)
      }
      if (this.scene.textures.exists(spec.name)) { finalize(); return }
      this.scene.textures.once(`addtexture-${spec.name}`, finalize)
      this.scene.textures.addBase64(spec.name, spec.src)
    })
  }

  _spawnText(spec) {
    const style = { ...DEFAULT_TEXT_STYLE, ...(spec.style ?? {}) }
    const t = this.scene.add.text(spec.x ?? 0, spec.y ?? 0, spec.text ?? '', style)
      .setOrigin(0.5)
      .setDepth(spec.depth ?? 50)
    if (typeof spec.scaleX === 'number') t.setScale(spec.scaleX, spec.scaleY ?? spec.scaleX)
    if (typeof spec.angle === 'number') t.setAngle(spec.angle)
    if (typeof spec.alpha === 'number') t.setAlpha(spec.alpha)
    this.register(t, spec.name, { dynamic: { type: 'text', text: spec.text, style } })
    return t
  }

  _uniqueName(prefix) {
    let n
    do { n = `${prefix}-${this._dynamicCounter++}` }
    while (this.items.some(it => it.name === n))
    return n
  }

  // ─── Duplicate ────────────────────────────────────────────────────────

  duplicateSelected() {
    if (this.selection.size === 0) return
    const sources = [...this.selection]
    this.selection.clear()
    for (const src of sources) {
      const clone = this._cloneItem(src)
      if (clone) this.selection.add(clone)
    }
    this._refreshAllSelectionVisuals()
    this._refreshPanel()
    this._scheduleAutoSave()
    this._flashStatus(`Duplicated ${sources.length} item${sources.length > 1 ? 's' : ''}`)
  }

  _cloneItem(src) {
    const obj = src.obj
    const x = obj.x + 10, y = obj.y + 10
    if (typeof obj.text === 'string') {
      const style = src.dynamic?.style ?? this._extractTextStyle(obj)
      const name = this._uniqueName(src.name)
      const t = this.scene.add.text(x, y, obj.text, style).setOrigin(obj.originX, obj.originY).setDepth(obj.depth)
      if (typeof obj.scaleX === 'number') t.setScale(obj.scaleX, obj.scaleY)
      if (typeof obj.angle === 'number') t.setAngle(obj.angle)
      this.register(t, name, { dynamic: { type: 'text', text: obj.text, style } })
      return this.items.find(it => it.name === name)
    }
    if (obj.texture && obj.texture.key) {
      const name = this._uniqueName(src.name)
      const img = this.scene.add.image(x, y, obj.texture.key).setOrigin(obj.originX, obj.originY).setDepth(obj.depth)
      if (typeof obj.scaleX === 'number') img.setScale(obj.scaleX, obj.scaleY)
      if (typeof obj.angle === 'number') img.setAngle(obj.angle)
      if (typeof obj.alpha === 'number') img.setAlpha(obj.alpha)
      if (img.texture?.setFilter) img.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
      const dynamic = src.dynamic
        ? { type: 'image', src: src.dynamic.src }
        : { type: 'image', src: null, srcKey: obj.texture.key }
      this.register(img, name, { dynamic })
      return this.items.find(it => it.name === name)
    }
    return null
  }

  _extractTextStyle(textObj) {
    const s = textObj.style
    const out = {}
    if (s) {
      if (s.fontSize)        out.fontSize = s.fontSize
      if (s.color)           out.color = s.color
      if (s.fontFamily)      out.fontFamily = s.fontFamily
      if (s.fontStyle)       out.fontStyle = s.fontStyle
      if (s.stroke)          out.stroke = s.stroke
      if (s.strokeThickness) out.strokeThickness = s.strokeThickness
    }
    return out
  }

  // ─── Reset to defaults ────────────────────────────────────────────────

  resetSelected() {
    if (this.selection.size === 0) return
    this._pushUndo()
    for (const it of this.selection) {
      if (!it.initial) continue
      const o = it.obj, s = it.initial
      o.x = s.x; o.y = s.y
      if (typeof s.scaleX === 'number' && o.setScale) o.setScale(s.scaleX, s.scaleY)
      if (typeof s.depth === 'number' && o.setDepth) o.setDepth(s.depth)
      if (typeof s.angle === 'number' && o.setAngle) o.setAngle(s.angle)
      if (typeof s.alpha === 'number' && o.setAlpha) o.setAlpha(s.alpha)
      if (typeof s.tint === 'number' && o.setTint) o.setTint(s.tint)
      else if (o.clearTint) o.clearTint()
      if (typeof s.text === 'string' && o.setText) {
        o.setText(s.text)
        if (it.dynamic && it.dynamic.type === 'text') it.dynamic.text = s.text
      }
      o.setVisible?.(s.visible)
    }
    this._refreshAllSelectionVisuals()
    this._refreshPanel()
    this._scheduleAutoSave()
    this._flashStatus('Reset to code defaults')
  }

  // ─── Align + distribute ───────────────────────────────────────────────

  align(mode) {
    if (this.selection.size < 2) {
      this._flashStatus('Select 2+ items to align')
      return
    }
    this._pushUndo()
    const items = [...this.selection].filter(it => !it.locked)
    if (items.length < 2) return
    const bounds = items.map(it => ({ it, b: it.obj.getBounds() }))
    let target
    if (mode === 'left')         target = Math.min(...bounds.map(x => x.b.left))
    else if (mode === 'right')   target = Math.max(...bounds.map(x => x.b.right))
    else if (mode === 'centerX') target = bounds.reduce((s, x) => s + x.b.centerX, 0) / bounds.length
    else if (mode === 'top')     target = Math.min(...bounds.map(x => x.b.top))
    else if (mode === 'bottom')  target = Math.max(...bounds.map(x => x.b.bottom))
    else if (mode === 'centerY') target = bounds.reduce((s, x) => s + x.b.centerY, 0) / bounds.length
    for (const { it, b } of bounds) {
      if (mode === 'left')         it.obj.x += target - b.left
      else if (mode === 'right')   it.obj.x += target - b.right
      else if (mode === 'centerX') it.obj.x += target - b.centerX
      else if (mode === 'top')     it.obj.y += target - b.top
      else if (mode === 'bottom')  it.obj.y += target - b.bottom
      else if (mode === 'centerY') it.obj.y += target - b.centerY
    }
    this._refreshAllSelectionVisuals()
    this._scheduleAutoSave()
  }

  distribute(axis) {
    if (this.selection.size < 3) {
      this._flashStatus('Select 3+ items to distribute')
      return
    }
    this._pushUndo()
    const items = [...this.selection].filter(it => !it.locked).map(it => ({ it, b: it.obj.getBounds() }))
    if (axis === 'h') {
      items.sort((a, b) => a.b.centerX - b.b.centerX)
      const first = items[0].b.centerX, last = items[items.length - 1].b.centerX
      const step = (last - first) / (items.length - 1)
      items.forEach(({ it, b }, i) => { it.obj.x += first + i * step - b.centerX })
    } else {
      items.sort((a, b) => a.b.centerY - b.b.centerY)
      const first = items[0].b.centerY, last = items[items.length - 1].b.centerY
      const step = (last - first) / (items.length - 1)
      items.forEach(({ it, b }, i) => { it.obj.y += first + i * step - b.centerY })
    }
    this._refreshAllSelectionVisuals()
    this._scheduleAutoSave()
  }

  // ─── Undo ─────────────────────────────────────────────────────────────

  _pushUndo() {
    const snap = {}
    for (const it of this.items) {
      const s = this._snapshotObj(it.obj)
      s.locked = it.locked
      snap[it.name] = s
    }
    this._undoStack.push(snap)
    if (this._undoStack.length > 50) this._undoStack.shift()
  }

  undo() {
    const snap = this._undoStack.pop()
    if (!snap) { this._flashStatus('Nothing to undo'); return }
    for (const it of this.items) {
      const s = snap[it.name]
      if (!s) continue
      const o = it.obj
      o.x = s.x; o.y = s.y
      if (typeof s.scaleX === 'number' && o.setScale) o.setScale(s.scaleX, s.scaleY)
      if (typeof s.depth === 'number' && o.setDepth) o.setDepth(s.depth)
      if (typeof s.angle === 'number' && o.setAngle) o.setAngle(s.angle)
      if (typeof s.alpha === 'number' && o.setAlpha) o.setAlpha(s.alpha)
      if (typeof s.tint === 'number' && o.setTint) o.setTint(s.tint)
      if (typeof s.text === 'string' && o.setText) {
        o.setText(s.text)
        if (it.dynamic && it.dynamic.type === 'text') it.dynamic.text = s.text
      }
      it.locked = !!s.locked
      const wasHidden = o.visible === false
      const shouldHide = !s.visible
      if (wasHidden !== shouldHide) {
        o.setVisible?.(s.visible)
        if (s.visible) {
          if (this.mode) this._addHandleFor(it)
        } else {
          this._destroyHandleFor(it)
          this.selection.delete(it)
          this._destroyOutlineFor(it)
        }
      }
    }
    this._refreshAllSelectionVisuals()
    this._refreshPanel()
    this._scheduleAutoSave()
  }

  // ─── Overlay (handles + outlines + chrome) ────────────────────────────

  _buildOverlay() {
    this._banner = this.scene.add.text(10, 10,
      'EDIT  •  drag/arrows move  •  [/] scale  •  Q/E rotate  •  ,/. layer  •  T/N text  •  U upload  •  Ctrl+D dup  •  R reset  •  Del hide  •  G grid  •  Ctrl+S save  •  F2 exit', {
        fontSize: '11px', color: '#ffd0a0', fontFamily: 'monospace',
        backgroundColor: 'rgba(0,0,0,0.85)', padding: { x: 6, y: 4 }
      }).setDepth(10000).setScrollFactor(0)
    this._gridGfx = this.scene.add.graphics().setDepth(9997)
    this._guideGfx = this.scene.add.graphics().setDepth(9991)
    this._refreshGrid()
    for (const it of this.items) {
      if (it.obj.visible !== false) this._addHandleFor(it)
    }
    this._refreshAllSelectionVisuals()
  }

  _tearOverlay() {
    this._banner?.destroy(); this._banner = null
    this._selLabel?.destroy(); this._selLabel = null
    this._gridGfx?.destroy(); this._gridGfx = null
    this._guideGfx?.destroy(); this._guideGfx = null
    this._marqueeGfx?.destroy(); this._marqueeGfx = null
    for (const outline of this._outlines.values()) outline.destroy()
    this._outlines.clear()
    for (const { handle } of this._handles) handle.destroy()
    this._handles = []
    this.scene.input.setTopOnly(false)
  }

  _snapValue(v) { return Math.round(v / this.gridSize) * this.gridSize }

  _refreshGrid() {
    if (!this._gridGfx) return
    this._gridGfx.clear()
    if (!this.snap) return
    const cam = this.scene.cameras.main
    const W = cam.width / cam.zoom
    const H = cam.height / cam.zoom
    this._gridGfx.lineStyle(1, 0xffffff, 0.06)
    for (let x = 0; x <= W; x += this.gridSize) {
      if ((x % (this.gridSize * 4)) === 0) continue
      this._gridGfx.beginPath(); this._gridGfx.moveTo(x, 0); this._gridGfx.lineTo(x, H); this._gridGfx.strokePath()
    }
    for (let y = 0; y <= H; y += this.gridSize) {
      if ((y % (this.gridSize * 4)) === 0) continue
      this._gridGfx.beginPath(); this._gridGfx.moveTo(0, y); this._gridGfx.lineTo(W, y); this._gridGfx.strokePath()
    }
    this._gridGfx.lineStyle(1, 0xffffff, 0.18)
    for (let x = 0; x <= W; x += this.gridSize * 4) {
      this._gridGfx.beginPath(); this._gridGfx.moveTo(x, 0); this._gridGfx.lineTo(x, H); this._gridGfx.strokePath()
    }
    for (let y = 0; y <= H; y += this.gridSize * 4) {
      this._gridGfx.beginPath(); this._gridGfx.moveTo(0, y); this._gridGfx.lineTo(W, y); this._gridGfx.strokePath()
    }
  }

  _addHandleFor(it) {
    const obj = it.obj
    if (obj.visible === false) return
    const b = obj.getBounds ? obj.getBounds() : null
    if (!b || b.width === 0 || b.height === 0) return
    const handle = this.scene.add.rectangle(b.centerX, b.centerY, b.width + 6, b.height + 6, 0x00ff88, 0.0001)
      .setStrokeStyle(1, it.locked ? 0xff8888 : 0x00ff88, it.locked ? 0.3 : 0.5)
      .setDepth(9998)
      .setInteractive({ draggable: !it.locked, useHandCursor: !it.locked })
    handle._dx = obj.x - b.centerX
    handle._dy = obj.y - b.centerY
    handle.on('pointerdown', (p) => {
      this._suppressEmptyClick = true
      if (it.locked) return       // locked = view-only; selection skipped
      const shift = p.event?.shiftKey
      if (shift)                          this._toggleSelection(it)
      else if (!this.selection.has(it))   this._setSingleSelection(it)
    })
    handle.on('dragstart', () => {
      this._pushUndo()
      this._dragOrigin = new Map([...this.selection].map(s => [s, { x: s.obj.x, y: s.obj.y }]))
    })
    handle.on('drag', (_p, dragX, dragY) => {
      if (it.locked) return
      let newX = dragX + handle._dx
      let newY = dragY + handle._dy
      if (this.snap) {
        newX = this._snapValue(newX)
        newY = this._snapValue(newY)
      }
      // Alignment guides — adjust newX/newY to nearest other-item edge/center
      const snapped = this._applyGuides(it, newX, newY)
      newX = snapped.x; newY = snapped.y
      const dx = newX - obj.x
      const dy = newY - obj.y
      if (dx === 0 && dy === 0) return
      obj.x = newX
      obj.y = newY
      if (this.selection.has(it)) {
        for (const sel of this.selection) {
          if (sel === it || sel.locked) continue
          sel.obj.x += dx
          sel.obj.y += dy
        }
      }
      this._refreshAllSelectionVisuals()
    })
    handle.on('dragend', () => {
      this._guideGfx?.clear()
      this._scheduleAutoSave()
    })
    this._handles.push({ item: it, handle })
  }

  _applyGuides(draggedIt, newX, newY) {
    if (!this._guideGfx) return { x: newX, y: newY }
    this._guideGfx.clear()
    const obj = draggedIt.obj
    const oldX = obj.x, oldY = obj.y
    obj.x = newX; obj.y = newY
    const b = obj.getBounds()
    obj.x = oldX; obj.y = oldY
    let bestX = null, bestY = null
    let dxAdjust = 0, dyAdjust = 0
    const others = []
    for (const it of this.items) {
      if (it === draggedIt || it.obj.visible === false) continue
      const ob = it.obj.getBounds?.()
      if (!ob) continue
      others.push(ob)
    }
    const draggedXs = [b.left, b.centerX, b.right]
    const draggedYs = [b.top, b.centerY, b.bottom]
    for (const ob of others) {
      const oXs = [ob.left, ob.centerX, ob.right]
      const oYs = [ob.top, ob.centerY, ob.bottom]
      for (const dx of draggedXs) for (const ox of oXs) {
        const diff = ox - dx
        if (Math.abs(diff) <= GUIDE_THRESHOLD && (bestX === null || Math.abs(diff) < Math.abs(bestX))) {
          bestX = diff; dxAdjust = diff
        }
      }
      for (const dy of draggedYs) for (const oy of oYs) {
        const diff = oy - dy
        if (Math.abs(diff) <= GUIDE_THRESHOLD && (bestY === null || Math.abs(diff) < Math.abs(bestY))) {
          bestY = diff; dyAdjust = diff
        }
      }
    }
    const finalX = newX + dxAdjust
    const finalY = newY + dyAdjust
    // Draw guides
    if (bestX !== null || bestY !== null) {
      this._guideGfx.lineStyle(1, 0xff00ff, 0.8)
      const cam = this.scene.cameras.main
      const camH = cam.height / cam.zoom
      const camW = cam.width / cam.zoom
      if (bestX !== null) {
        const x = b.centerX + dxAdjust
        this._guideGfx.beginPath(); this._guideGfx.moveTo(x, 0); this._guideGfx.lineTo(x, camH); this._guideGfx.strokePath()
      }
      if (bestY !== null) {
        const y = b.centerY + dyAdjust
        this._guideGfx.beginPath(); this._guideGfx.moveTo(0, y); this._guideGfx.lineTo(camW, y); this._guideGfx.strokePath()
      }
    }
    return { x: finalX, y: finalY }
  }

  _destroyHandleFor(it) {
    const idx = this._handles.findIndex(h => h.item === it)
    if (idx < 0) return
    this._handles[idx].handle.destroy()
    this._handles.splice(idx, 1)
  }

  _destroyOutlineFor(it) {
    const o = this._outlines.get(it)
    if (o) { o.destroy(); this._outlines.delete(it) }
  }

  _refreshAllSelectionVisuals() {
    this._refreshOutlinesAndHandles()
    this._refreshLabel()
    this._refreshPanel()
  }

  /** Visual-only refresh: redraws outlines + repositions handles + updates
   *  the floating label. Does NOT rebuild the side panel HTML — useful for
   *  inline edits (color picker, sliders) where rebuilding would destroy
   *  the input the user is interacting with. */
  _refreshOutlinesOnly() {
    this._refreshOutlinesAndHandles()
    this._refreshLabel()
  }

  _refreshOutlinesAndHandles() {
    for (const [it, outline] of [...this._outlines.entries()]) {
      if (!this.selection.has(it)) {
        outline.destroy()
        this._outlines.delete(it)
      }
    }
    for (const it of this.selection) {
      const b = it.obj.getBounds?.()
      if (!b) continue
      let outline = this._outlines.get(it)
      if (!outline) {
        outline = this.scene.add.rectangle(b.centerX, b.centerY, b.width + 4, b.height + 4)
          .setStrokeStyle(2, 0xff8830, 1).setFillStyle(0, 0).setDepth(9999)
        this._outlines.set(it, outline)
      } else {
        outline.setPosition(b.centerX, b.centerY)
        outline.setSize(b.width + 4, b.height + 4)
      }
    }
    for (const { item, handle } of this._handles) {
      const b = item.obj.getBounds?.()
      if (!b) continue
      handle.setPosition(b.centerX, b.centerY)
      handle.setSize(b.width + 6, b.height + 6)
    }
  }

  _refreshLabel() {
    this._selLabel?.destroy()
    if (this.selection.size === 0) { this._selLabel = null; return }
    let txt
    if (this.selection.size === 1) {
      const it = [...this.selection][0]
      const o = it.obj
      const showScale = typeof o.scaleX === 'number' && (o.scaleX !== 1 || o.scaleY !== 1)
      const scaleStr = showScale ? `  ×${o.scaleX.toFixed(2)}` : ''
      const depthStr = typeof o.depth === 'number' && o.depth !== 0 ? `  z${o.depth}` : ''
      const angleStr = typeof o.angle === 'number' && o.angle !== 0 ? `  ${o.angle.toFixed(0)}°` : ''
      txt = `${it.name}  (x:${Math.round(o.x)}, y:${Math.round(o.y)})${scaleStr}${depthStr}${angleStr}`
    } else {
      txt = `${this.selection.size} items selected`
    }
    this._selLabel = this.scene.add.text(10, 32, txt, {
      fontSize: '11px', color: '#ffd0a0', fontFamily: 'monospace',
      backgroundColor: 'rgba(0,0,0,0.85)', padding: { x: 6, y: 4 }
    }).setDepth(10000).setScrollFactor(0)
  }

  _flashStatus(text) {
    const cam = this.scene.cameras.main
    const t = this.scene.add.text(cam.width / cam.zoom / 2, 32, text, {
      fontSize: '13px', color: '#ffffff', fontFamily: 'monospace',
      backgroundColor: 'rgba(0,128,0,0.85)', padding: { x: 10, y: 6 }
    }).setOrigin(0.5, 0).setDepth(10100).setScrollFactor(0)
    this.scene.tweens.add({
      targets: t, alpha: 0, delay: 1500, duration: 600,
      onComplete: () => t.destroy()
    })
  }

  // ─── HTML side panel ──────────────────────────────────────────────────

  _buildPanel() {
    if (this._panel) return
    const p = document.createElement('div')
    p.id = `uieditor-panel-${this.sceneKey}`
    p.style.cssText = `
      position: fixed; top: 60px; right: 12px; z-index: 999;
      width: 280px; max-height: calc(100vh - 80px);
      background: rgba(15,10,25,0.92); color: #ffd0a0;
      border: 1px solid #3a3045; border-radius: 6px;
      font-family: monospace; font-size: 11px;
      display: flex; flex-direction: column;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    `
    document.body.appendChild(p)
    this._panel = p
    this._refreshPanel()
  }

  _destroyPanel() {
    this._panel?.remove()
    this._panel = null
  }

  _refreshPanel() {
    if (!this._panel) return
    const sel = this.selection
    const onlyOne = sel.size === 1 ? [...sel][0] : null
    const isText  = onlyOne && typeof onlyOne.obj.text === 'string'
    const isImage = onlyOne && onlyOne.obj.texture && onlyOne.obj.texture.key && !isText
    let html = ``
    if (Array.isArray(this.bossList) && this.bossList.length) {
      html += `<div style="padding:8px 10px; border-bottom:1px solid #3a3045;">
        <div style="font-size:10px; opacity:0.6; margin-bottom:4px;">Active boss</div>
        <div style="display:flex; flex-wrap:wrap; gap:4px;">`
      for (const b of this.bossList) {
        const isActive = b.id === this.activeBossId
        html += `<button data-act="select-boss" data-id="${this._escape(b.id)}"
          style="padding:2px 6px; font-size:10px;
                 background:${isActive ? '#ff8830' : '#2a2030'};
                 color:${isActive ? '#000' : '#ffd0a0'};
                 border:1px solid #3a3045; cursor:pointer;">${this._escape(b.label)}</button>`
      }
      html += `</div></div>`
    }
    html += `
      <div style="padding: 8px 10px; border-bottom: 1px solid #3a3045; display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
        <button data-act="align-left"     title="Align left edges">⇤</button>
        <button data-act="align-centerX"  title="Align horizontal centres">↔</button>
        <button data-act="align-right"    title="Align right edges">⇥</button>
        <button data-act="distribute-h"   title="Distribute horizontally (3+ items)">⇿</button>
        <span style="opacity:0.4;">|</span>
        <button data-act="align-top"      title="Align top edges">⇡</button>
        <button data-act="align-centerY"  title="Align vertical centres">↕</button>
        <button data-act="align-bottom"   title="Align bottom edges">⇣</button>
        <button data-act="distribute-v"   title="Distribute vertically (3+ items)">↥</button>
      </div>
      <div style="padding: 8px 10px; border-bottom: 1px solid #3a3045; display: flex; gap: 6px; align-items: center;">
        <button data-act="layer-back"      title="Send to back (Shift+,)">⇊</button>
        <button data-act="layer-backward"  title="Send backward 1 (,)">↓</button>
        <button data-act="layer-forward"   title="Bring forward 1 (.)">↑</button>
        <button data-act="layer-front"     title="Bring to front (Shift+.)">⇈</button>
      </div>
      <div style="padding: 8px 10px; border-bottom: 1px solid #3a3045; display: flex; gap: 6px; flex-wrap: wrap;">
        <button data-act="new-text"   title="Create a new text box (N)">+ Text</button>
        <button data-act="upload"     title="Upload an image (U)">+ Image</button>
        <button data-act="duplicate"  title="Duplicate selected (Ctrl+D)">Duplicate</button>
        <button data-act="reset"      title="Reset selected to code defaults (R)">Reset</button>
        ${this.activeBossId ? `<button data-act="pin-boss"   title="Show selected only when ${this._escape(this.activeBossId)} is active">📌 Pin to ${this._escape(this.activeBossId)}</button>` : ''}
        <button data-act="pin-clear"  title="Unpin (show on all bosses)">Unpin</button>
      </div>
    `
    // Property pane (selected items)
    if (onlyOne) {
      const o = onlyOne.obj
      const alphaPct = Math.round((o.alpha ?? 1) * 100)
      let propsHtml = `
        <div style="padding: 8px 10px; border-bottom: 1px solid #3a3045;">
          <div style="font-weight:bold; margin-bottom:4px; color:#ff8830;">${this._escape(onlyOne.name)}</div>
          <div style="display:grid; grid-template-columns: 80px 1fr; gap:4px; align-items:center;">
            <label>Alpha</label>
            <input type="range" min="0" max="100" value="${alphaPct}" data-act="alpha">
      `
      if (isImage) {
        const tint = (typeof o.tintTopLeft === 'number' && o.tintFill !== false) ? `#${o.tintTopLeft.toString(16).padStart(6,'0')}` : '#ffffff'
        propsHtml += `
            <label>Tint</label>
            <span><input type="color" value="${tint}" data-act="tint">
                  <button data-act="tint-clear">clear</button></span>
        `
      }
      if (isText) {
        const s = o.style ?? {}
        propsHtml += `
            <label>Text</label>
            <input type="text" value="${this._escape(o.text)}" data-act="text-content" style="width:100%;">
            <label>Color</label>
            <input type="color" value="${this._normalizeColor(s.color)}" data-act="text-color">
            <label>Size px</label>
            <input type="number" min="6" max="120" value="${parseInt(s.fontSize ?? '16')}" data-act="text-size" style="width:60px;">
            <label>Font</label>
            <input type="text" value="${this._escape(s.fontFamily ?? 'serif')}" data-act="text-font">
            <label>Stroke</label>
            <span><input type="color" value="${this._normalizeColor(s.stroke)}" data-act="text-stroke">
                  <input type="number" min="0" max="20" value="${s.strokeThickness ?? 0}" data-act="text-stroke-w" style="width:50px;"></span>
        `
      }
      propsHtml += `</div></div>`
      html += propsHtml
    } else if (sel.size > 1) {
      html += `<div style="padding:8px 10px; border-bottom:1px solid #3a3045; opacity:0.7;">${sel.size} items selected</div>`
    }
    // Items list
    html += `<div style="overflow-y: auto; flex: 1;">`
    for (const it of this.items) {
      const isSel = this.selection.has(it)
      const isVis = it.obj.visible !== false
      const eye = isVis ? '👁' : '⊘'
      const lock = it.locked ? '🔒' : '🔓'
      html += `
        <div data-act="select" data-name="${this._escape(it.name)}"
             style="display:flex; align-items:center; gap:6px; padding:4px 10px; cursor:pointer;
                    background:${isSel ? 'rgba(255,136,48,0.3)' : 'transparent'};
                    opacity:${isVis ? 1 : 0.4};
                    border-bottom:1px solid rgba(255,255,255,0.05);">
          <span data-act="vis" data-name="${this._escape(it.name)}" title="visible">${eye}</span>
          <span data-act="lock" data-name="${this._escape(it.name)}" title="lock">${lock}</span>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this._escape(it.name)}</span>
        </div>
      `
    }
    html += `</div>`
    this._panel.innerHTML = html
    // Wire up buttons. Use a single delegated handler.
    this._panel.onclick     = (e) => this._handlePanelClick(e)
    this._panel.oninput     = (e) => this._handlePanelInput(e)
    this._panel.onchange    = (e) => this._handlePanelInput(e)
    // Prevent panel clicks from bleeding through to canvas (which would clear selection).
    this._panel.onmousedown = (e) => e.stopPropagation()
  }

  _escape(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])) }

  _normalizeColor(c) {
    if (!c) return '#000000'
    if (typeof c === 'string' && c.startsWith('#')) return c.length === 7 ? c : '#' + c.replace('#','').padStart(6,'0')
    if (typeof c === 'number') return '#' + c.toString(16).padStart(6, '0')
    return '#000000'
  }

  _handlePanelClick(e) {
    const t = e.target
    const act = t.getAttribute('data-act') ?? t.parentElement?.getAttribute('data-act')
    const name = t.getAttribute('data-name') ?? t.parentElement?.getAttribute('data-name')
    if (!act) return
    const it = name ? this.items.find(i => i.name === name) : null
    if (act === 'select' && it) {
      if (e.shiftKey) this._toggleSelection(it)
      else            this._setSingleSelection(it)
      e.stopPropagation()
    } else if (act === 'vis' && it) {
      this.toggleVisible(it)
      e.stopPropagation()
    } else if (act === 'lock' && it) {
      this.toggleLock(it)
      e.stopPropagation()
    } else if (act === 'duplicate') {
      this.duplicateSelected()
    } else if (act === 'reset') {
      this.resetSelected()
    } else if (act === 'new-text') {
      this.createTextBox()
    } else if (act === 'upload') {
      this.uploadImage()
    } else if (act === 'tint-clear') {
      this.clearSelectedTint()
    } else if (act?.startsWith('align-')) {
      this.align(act.slice('align-'.length))
    } else if (act === 'distribute-h') {
      this.distribute('h')
    } else if (act === 'distribute-v') {
      this.distribute('v')
    } else if (act === 'layer-back') {
      this._adjustDepth(-1, true)
    } else if (act === 'layer-front') {
      this._adjustDepth(+1, true)
    } else if (act === 'layer-backward') {
      this._adjustDepth(-1, false)
    } else if (act === 'layer-forward') {
      this._adjustDepth(+1, false)
    } else if (act === 'select-boss') {
      const id = t.getAttribute('data-id') ?? t.parentElement?.getAttribute('data-id')
      if (id && this._onBossSelect) this._onBossSelect(id)
    } else if (act === 'pin-boss') {
      this.pinSelectedToBoss(this.activeBossId)
    } else if (act === 'pin-clear') {
      this.pinSelectedToBoss(null)
    }
  }

  _handlePanelInput(e) {
    const t = e.target
    const act = t.getAttribute?.('data-act')
    if (!act) return
    if (act === 'alpha') this.setSelectedAlpha(+t.value / 100)
    else if (act === 'tint') {
      const hex = parseInt(t.value.replace('#',''), 16)
      this.setSelectedTint(hex)
    } else if (act === 'text-content') {
      if (this.selection.size === 1) {
        const it = [...this.selection][0]
        if (it.obj.setText) {
          this._pushUndo()
          it.obj.setText(t.value)
          if (it.dynamic && it.dynamic.type === 'text') it.dynamic.text = t.value
          this._refreshOutlinesOnly()           // keep the input focused
          this._scheduleAutoSave()
        }
      }
    } else if (act === 'text-color') {
      this.setSelectedTextStyle({ color: t.value })
    } else if (act === 'text-size') {
      this.setSelectedTextStyle({ fontSize: `${t.value}px` })
    } else if (act === 'text-font') {
      this.setSelectedTextStyle({ fontFamily: t.value })
    } else if (act === 'text-stroke') {
      this.setSelectedTextStyle({ stroke: t.value })
    } else if (act === 'text-stroke-w') {
      this.setSelectedTextStyle({ strokeThickness: +t.value })
    }
  }
}

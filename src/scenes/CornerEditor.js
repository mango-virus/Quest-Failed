// Pixel-level editor for the dungeon corner-tile pattern. The user paints
// a single 32×32 pattern; DungeonRenderer mirrors it across the four corner
// kinds (cTL as drawn, cTR flipped X, cBL flipped Y, cBR flipped both).
//
// Tools:
//   PAINT       click/drag to set pixels to the active palette colour
//   EYEDROPPER  click any pixel to copy its colour into the palette
//   FILL        flood-fill a contiguous region of the same colour
// Brush size 1/2/3 (paint mode), diagonal symmetry mode (mirror across the
// TL→BR diagonal of the cTL tile), grid-overlay toggle, undo/redo (with
// keyboard Ctrl+Z / Ctrl+Y), four save slots with one active at a time.
//
// Storage:
//   questFailed.cornerPattern.slot${1..4}  — saved pattern per slot
//   questFailed.cornerPattern.activeSlot   — which slot the renderer reads
//   questFailed.cornerPattern              — legacy single-pattern key
//                                            (auto-migrated to slot 1 on first launch)

import { PALETTE, applyUiCamera } from '../ui/UIKit.js'
import { paintProceduralCorner }   from '../ui/DungeonRenderer.js'
import { DEFAULT_PATTERN }          from '../data/cornerPattern.js'

// ── Storage keys ─────────────────────────────────────────────────────────
const LEGACY_KEY      = 'questFailed.cornerPattern'
const SLOT_KEY_PREFIX = 'questFailed.cornerPattern.slot'
const ACTIVE_KEY      = 'questFailed.cornerPattern.activeSlot'
const NUM_SLOTS       = 4

// Design space — applyUiCamera scales+centers this into the actual window
// so the editor stays a usable size on big monitors AND laptops without
// needing per-element scale math. All layout coords below are in design
// pixels within this DESIGN_W × DESIGN_H box.
const DESIGN_W = 1280
const DESIGN_H = 800

// ── Editor canvas geometry ──────────────────────────────────────────────
const GRID_SIZE  = 32
const CELL       = 14
const GRID_W     = GRID_SIZE * CELL    // 448
const GRID_Y     = 90

// Width of the editor's content block: grid + gap + right panel (~280 wide).
// Used to centre the whole editor horizontally within the design space.
const BLOCK_W    = GRID_W + 30 + 280   // 758
const TOP_BAR_Y  = GRID_Y
const SWATCH_W   = 56
const SWATCH_H   = 24

// Palette — every colour the procedural renderer uses, plus a CUSTOM slot
// (mutable; updated by the browser's native colour picker — see
// _openColorPicker) and ERASE (null = fall through to procedural).
const PALETTE_COLOURS = [
  { name: 'mortar',     hex: 0x0a1420 },
  { name: 'baseboard',  hex: 0x101824 },
  { name: 'wallShadow', hex: 0x121f30 },
  { name: 'wallBase',   hex: 0x1e3248 },
  { name: 'capSeam',    hex: 0x344050 },
  { name: 'wallHi',     hex: 0x32485e },
  { name: 'capShadow',  hex: 0x4a5868 },
  { name: 'cornerBase', hex: 0x5a6878 },
  { name: 'capBase',    hex: 0x6a7888 },
  { name: 'capHi',      hex: 0x8a98a8 },
  { name: 'pillarHi',   hex: 0x8aa0c0 },
  { name: 'door',       hex: 0x004466 },
  { name: 'custom',     hex: 0xff8844, isCustom: true },
  { name: 'erase',      hex: null      },
]
const CUSTOM_COLOR_KEY = 'questFailed.cornerPattern.customColor'

const TOOLS = ['paint', 'eyedropper', 'fill']

export class CornerEditor extends Phaser.Scene {
  constructor() { super('CornerEditor') }

  create() {
    this.cameras.main.setBackgroundColor(0x05080f)
    // Scale the design space into whatever the window is, centered. After
    // this call, world coords 0..DESIGN_W and 0..DESIGN_H map onto the full
    // visible canvas; small windows shrink the editor proportionally,
    // larger windows blow it up. uiW/uiH are the design dimensions for
    // text-centering math.
    applyUiCamera(this, DESIGN_W, DESIGN_H)
    // Centre the editor's content block horizontally within the visible
    // design space (uiW). On wide windows the block sits in the middle
    // with margins on either side; on narrow windows the block hugs the
    // left edge instead of going negative.
    const cx = Math.max(0, ((this.uiW ?? this.scale.width) - BLOCK_W) / 2)
    this._GX = Math.max(20, Math.floor(cx))
    this._PX = this._GX + GRID_W + 30

    // Restore the previously picked custom colour (mutates the shared
    // PALETTE_COLOURS entry). Loaded before _buildUI so the swatch renders
    // with the saved colour rather than the default orange.
    try {
      const saved = localStorage.getItem(CUSTOM_COLOR_KEY)
      if (saved != null) {
        const customEntry = PALETTE_COLOURS.find(p => p.isCustom)
        if (customEntry) customEntry.hex = parseInt(saved, 10) | 0
      }
    } catch (e) {}
    this._migrateLegacy()

    // Active slot is whichever the renderer should read from. Defaults to 1.
    this._currentSlot = this._loadActiveSlot()
    this._pixels      = this._loadSlot(this._currentSlot) || this._makeEmpty()

    this._currentColour = PALETTE_COLOURS[0]
    this._tool          = 'paint'
    this._brushSize     = 1
    this._symmetry      = false
    this._gridVisible   = true

    this._history    = [this._cloneGrid(this._pixels)]
    this._historyIdx = 0

    this._buildUI()
    this._redrawGrid()

    // Paint stroke = one undo step. We push history at pointer-up so the
    // saved snapshot reflects the POST-stroke state (history[idx] = current
    // state convention, so redo restores correctly).
    this._isPainting = false
    this._strokeDirty = false
    this.input.on('pointerdown', (p) => this._onPointer(p, true))
    this.input.on('pointerup',   ()  => {
      if (this._isPainting && this._strokeDirty) this._pushHistory()
      this._isPainting  = false
      this._strokeDirty = false
    })
    this.input.on('pointermove', (p) => { if (this._isPainting) this._onPointer(p, false) })

    // Keyboard: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo, P/E/F = tool, [ ] = brush size,
    // S = toggle symmetry, G = toggle grid lines.
    this.input.keyboard.on('keydown-Z', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      if (e.shiftKey) this._redo(); else this._undo()
    })
    this.input.keyboard.on('keydown-Y', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault(); this._redo()
    })
    this.input.keyboard.on('keydown-P', () => this._setTool('paint'))
    this.input.keyboard.on('keydown-E', () => this._setTool('eyedropper'))
    this.input.keyboard.on('keydown-F', () => this._setTool('fill'))
    this.input.keyboard.on('keydown-G', () => this._toggleGrid())
    this.input.keyboard.on('keydown-S', () => this._toggleSymmetry())
    this.input.keyboard.on('keydown-OPEN_BRACKET',  () => this._setBrushSize(Math.max(1, this._brushSize - 1)))
    this.input.keyboard.on('keydown-CLOSED_BRACKET',() => this._setBrushSize(Math.min(3, this._brushSize + 1)))
  }

  // ── History ──────────────────────────────────────────────────────────────

  _cloneGrid(grid) {
    const out = new Array(GRID_SIZE)
    for (let y = 0; y < GRID_SIZE; y++) out[y] = grid[y].slice()
    return out
  }

  _pushHistory() {
    this._history = this._history.slice(0, this._historyIdx + 1)
    this._history.push(this._cloneGrid(this._pixels))
    this._historyIdx = this._history.length - 1
    if (this._history.length > 50) { this._history.shift(); this._historyIdx-- }
  }

  _undo() {
    if (this._historyIdx <= 0) return this._flashStatus('NOTHING TO UNDO')
    this._historyIdx--
    this._pixels = this._cloneGrid(this._history[this._historyIdx])
    this._redrawGrid(); this._flashStatus('UNDO')
  }

  _redo() {
    if (this._historyIdx >= this._history.length - 1) return this._flashStatus('NOTHING TO REDO')
    this._historyIdx++
    this._pixels = this._cloneGrid(this._history[this._historyIdx])
    this._redrawGrid(); this._flashStatus('REDO')
  }

  // ── Storage ──────────────────────────────────────────────────────────────

  _migrateLegacy() {
    // First-run migration: if there's a legacy single-pattern key but no
    // slots saved yet, copy it into slot 1 and remove the legacy key.
    try {
      const legacy = localStorage.getItem(LEGACY_KEY)
      if (!legacy) return
      const slot1 = localStorage.getItem(SLOT_KEY_PREFIX + '1')
      if (!slot1) {
        localStorage.setItem(SLOT_KEY_PREFIX + '1', legacy)
        localStorage.setItem(ACTIVE_KEY, '1')
      }
      localStorage.removeItem(LEGACY_KEY)
    } catch (e) {}
  }

  _makeEmpty() {
    return Array.from({ length: GRID_SIZE }, () =>
      Array.from({ length: GRID_SIZE }, () => null))
  }

  _loadActiveSlot() {
    try {
      const v = localStorage.getItem(ACTIVE_KEY)
      const n = parseInt(v, 10)
      if (n >= 1 && n <= NUM_SLOTS) return n
    } catch (e) {}
    return 1
  }

  _setActiveSlot(n) {
    try { localStorage.setItem(ACTIVE_KEY, String(n)) } catch (e) {}
  }

  _loadSlot(slot) {
    try {
      const raw = localStorage.getItem(SLOT_KEY_PREFIX + slot)
      if (!raw) return null
      const data = JSON.parse(raw)
      if (!Array.isArray(data) || data.length !== GRID_SIZE) return null
      return data
    } catch (e) { return null }
  }

  _saveSlot(slot) {
    try {
      localStorage.setItem(SLOT_KEY_PREFIX + slot, JSON.stringify(this._pixels))
      this._flashStatus(`SAVED TO SLOT ${slot}`)
      this._refreshSlotsHighlight()
    } catch (e) { this._flashStatus('SAVE FAILED') }
  }

  _switchSlot(slot) {
    if (slot === this._currentSlot) return
    this._saveSlot(this._currentSlot)             // auto-save current slot first
    this._currentSlot = slot
    this._pixels      = this._loadSlot(slot) || this._makeEmpty()
    this._history     = [this._cloneGrid(this._pixels)]
    this._historyIdx  = 0
    this._redrawGrid()
    this._refreshSlotsHighlight()
    this._flashStatus(`SLOT ${slot}`)
  }

  _activateSlot() {
    this._setActiveSlot(this._currentSlot)
    this._refreshSlotsHighlight()
    this._flashStatus(`SLOT ${this._currentSlot} IS ACTIVE`)
  }

  _clearPattern() {
    this._pixels = this._makeEmpty()
    this._redrawGrid()
    this._pushHistory()
    this._flashStatus('CLEARED')
  }

  _loadProcedural() {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = GRID_SIZE
    const ctx = canvas.getContext('2d')
    const fakeG = {
      fillStyle: (c, a = 1) => {
        const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`
      },
      fillRect: (x, y, w, h) => ctx.fillRect(x, y, w, h),
    }
    paintProceduralCorner(fakeG, 'cTL')
    const data = ctx.getImageData(0, 0, GRID_SIZE, GRID_SIZE).data
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const i = (y * GRID_SIZE + x) * 4
        this._pixels[y][x] = data[i + 3] < 5
          ? null
          : (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
      }
    }
    this._redrawGrid()
    this._pushHistory()
    this._flashStatus('LOADED CURRENT')
  }

  _deleteSavedPattern() {
    try {
      localStorage.removeItem(SLOT_KEY_PREFIX + this._currentSlot)
      this._flashStatus(`SLOT ${this._currentSlot} CLEARED FROM DISK`)
      this._refreshSlotsHighlight()
    } catch (e) {}
  }

  // ── Tool actions ─────────────────────────────────────────────────────────

  _setTool(t) {
    if (!TOOLS.includes(t)) return
    this._tool = t
    this._refreshToolHighlight()
  }

  _setBrushSize(n) {
    this._brushSize = Math.max(1, Math.min(3, n))
    this._refreshBrushHighlight()
    this._flashStatus(`BRUSH ${this._brushSize}`)
  }

  _toggleSymmetry() {
    this._symmetry = !this._symmetry
    this._refreshToggleHighlights()
    this._flashStatus(this._symmetry ? 'SYMMETRY ON' : 'SYMMETRY OFF')
  }

  _toggleGrid() {
    this._gridVisible = !this._gridVisible
    if (this._gridLinesG) this._gridLinesG.setVisible(this._gridVisible)
    this._refreshToggleHighlights()
  }

  // Dump the current pattern to the clipboard (and console, as backup) in
  // a form ready to paste into src/data/cornerPattern.js. Doing it this
  // way keeps the build artefact in source control — once pasted, every
  // player gets the bundled pattern as the default, with localStorage
  // overriding only on machines that have edited via this scene.
  _exportForShipping() {
    const json = JSON.stringify(this._pixels)
    const snippet = `export const DEFAULT_PATTERN = ${json}`
    console.log('[CornerEditor] EXPORT — paste this into src/data/cornerPattern.js:')
    console.log(snippet)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(snippet)
        .then(()  => this._flashStatus('COPIED — paste into src/data/cornerPattern.js'))
        .catch(() => this._flashStatus('SEE CONSOLE'))
    } else {
      this._flashStatus('SEE CONSOLE')
    }
  }

  // Open the browser's native colour picker for the CUSTOM palette slot.
  // The chosen colour is written into the slot's hex, the swatch fill is
  // updated live, and the slot is auto-selected so the user can start
  // painting immediately. Persisted to localStorage so the same custom
  // colour comes back next session.
  _openColorPicker() {
    const customEntry = PALETTE_COLOURS.find(p => p.isCustom)
    if (!customEntry) return
    const input = document.createElement('input')
    input.type = 'color'
    input.value = '#' + ((customEntry.hex >>> 0) & 0xffffff).toString(16).padStart(6, '0')
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.top  = '-9999px'
    document.body.appendChild(input)

    const apply = () => {
      const v = input.value
      if (typeof v !== 'string' || !v.startsWith('#')) return
      const hex = parseInt(v.slice(1), 16)
      if (Number.isNaN(hex)) return
      customEntry.hex = hex
      const customUI = this._paletteUI.find(pp => pp.c === customEntry)
      if (customUI) customUI.swatch.fillColor = hex
      this._selectColour(customEntry)
      try { localStorage.setItem(CUSTOM_COLOR_KEY, String(hex)) } catch (e) {}
    }
    input.addEventListener('input',  apply)
    input.addEventListener('change', () => {
      apply()
      setTimeout(() => input.parentNode && input.remove(), 100)
    })
    // Some browsers don't fire 'change' on cancel — auto-cleanup after 30s.
    setTimeout(() => { if (input.parentNode) input.remove() }, 30000)
    input.click()
  }

  _paintCell(gx, gy, colour) {
    // Brush expands the click into a square of side this._brushSize centred
    // on the click. Symmetry mirrors each painted cell across the cTL→cBR
    // diagonal of the cTL tile.
    const half = (this._brushSize - 1) / 2
    for (let dy = -Math.floor(half); dy <= Math.ceil(half); dy++) {
      for (let dx = -Math.floor(half); dx <= Math.ceil(half); dx++) {
        const nx = gx + dx, ny = gy + dy
        if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue
        if (this._pixels[ny][nx] !== colour) {
          this._pixels[ny][nx] = colour
        }
        if (this._symmetry && nx !== ny) {
          // Mirror across TL→BR diagonal: (x, y) → (y, x).
          this._pixels[nx][ny] = colour
        }
      }
    }
  }

  // Flood-fill: replace every contiguous (4-neighbour) cell of the click
  // target's colour with the active palette colour.
  _floodFill(gx, gy, replacement) {
    const target = this._pixels[gy][gx]
    if (target === replacement) return
    const stack = [[gx, gy]]
    while (stack.length) {
      const [x, y] = stack.pop()
      if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) continue
      if (this._pixels[y][x] !== target) continue
      this._pixels[y][x] = replacement
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
    }
  }

  // ── Pointer ──────────────────────────────────────────────────────────────

  _onPointer(p, isDown) {
    // Use Phaser's own world coords on the pointer — it computes them via
    // the same camera transform that drives button hit-testing, so they
    // match what the user sees pixel-for-pixel under any zoom/scroll. (My
    // earlier hand-rolled inverse worked in test scenarios because both
    // sides used the same wrong formula, but it didn't match what Phaser
    // renders to the actual canvas.)
    const wx = p.worldX
    const wy = p.worldY
    const gx = Math.floor((wx - this._GX) / CELL)
    const gy = Math.floor((wy - GRID_Y) / CELL)
    if (gx < 0 || gy < 0 || gx >= GRID_SIZE || gy >= GRID_SIZE) return

    if (this._tool === 'eyedropper' && isDown) {
      const c = this._pixels[gy][gx]
      if (c == null) {
        // Empty cell → select erase.
        this._selectColour(PALETTE_COLOURS.find(p => p.hex == null))
      } else {
        // Prefer a named palette match for clarity ("you picked wallBase").
        // Fall back to stuffing the sampled hex into the CUSTOM slot so the
        // user can immediately paint with any colour they sampled, even if
        // it isn't one of the named palette entries (which is what happens
        // after LOAD CURRENT — those pixels are blended/tinted procedural
        // colours, not exact palette matches).
        const found = PALETTE_COLOURS.find(p => !p.isCustom && p.hex === c)
        if (found) {
          this._selectColour(found)
        } else {
          const customEntry = PALETTE_COLOURS.find(p => p.isCustom)
          if (customEntry) {
            customEntry.hex = c
            const customUI = this._paletteUI.find(pp => pp.c === customEntry)
            if (customUI) customUI.swatch.fillColor = c
            this._selectColour(customEntry)
            try { localStorage.setItem(CUSTOM_COLOR_KEY, String(c)) } catch (e) {}
          }
        }
      }
      this._setTool('paint')
      return
    }

    if (this._tool === 'fill' && isDown) {
      this._floodFill(gx, gy, this._currentColour.hex)
      this._redrawGrid()
      this._pushHistory()        // atomic action — checkpoint the post-state
      return
    }

    // Paint tool — paint cells through the whole stroke; the post-stroke
    // checkpoint is pushed in the pointerup handler.
    if (isDown) this._isPainting = true
    this._paintCell(gx, gy, this._currentColour.hex)
    this._strokeDirty = true
    this._redrawGrid()
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  _buildUI() {
    // Use the design-space width for centering (uiW after applyUiCamera).
    const W = this.uiW ?? this.scale.width

    this.add.text(W / 2, 30, 'CORNER EDITOR', {
      fontSize: '24px', color: '#aabbcc', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5)

    this.add.text(W / 2, 56, 'paint cTL — mirrored to all 4 corners in-game · keys: P/E/F  [ ]  S  G  Ctrl+Z/Y', {
      fontSize: '10px', color: '#778899', fontFamily: 'monospace',
    }).setOrigin(0.5)

    // Pixel grid backdrop
    this.add.rectangle(this._GX - 4, GRID_Y - 4, GRID_W + 8, GRID_W + 8, 0x000000, 1).setOrigin(0)
    this.add.rectangle(this._GX, GRID_Y, GRID_W, GRID_W, 0x05080f, 1).setOrigin(0)
    this._gridG      = this.add.graphics()
    this._gridLinesG = this.add.graphics()
    this._drawGridLines()

    // Status text under the grid (above the preview).
    this._status = this.add.text(this._GX, GRID_Y + GRID_W + 4, '', {
      fontSize: '12px', color: '#ddaa44', fontFamily: 'monospace',
    })

    // ── Right panel: tools, palette, slots, actions ──
    let y = TOP_BAR_Y

    // Tools row
    this.add.text(this._PX, y - 14, 'TOOLS', {
      fontSize: '10px', color: '#778899', fontFamily: 'monospace',
    })
    this._toolUI = []
    const toolLabels = { paint: 'PAINT [P]', eyedropper: 'EYE [E]', fill: 'FILL [F]' }
    let tx = this._PX
    for (const t of TOOLS) {
      const btn = this._addButton(tx, y, 80, 24, toolLabels[t], () => this._setTool(t))
      this._toolUI.push({ tool: t, btn })
      tx += 84
    }
    y += 32

    // Brush size row
    this.add.text(this._PX, y - 14, 'BRUSH', {
      fontSize: '10px', color: '#778899', fontFamily: 'monospace',
    })
    this._brushUI = []
    for (let n = 1; n <= 3; n++) {
      const btn = this._addButton(this._PX + (n - 1) * 44, y, 40, 24, `${n}×${n}`, () => this._setBrushSize(n))
      this._brushUI.push({ size: n, btn })
    }
    y += 32

    // Toggles row
    this.add.text(this._PX, y - 14, 'TOGGLES', {
      fontSize: '10px', color: '#778899', fontFamily: 'monospace',
    })
    this._symBtn  = this._addButton(this._PX,        y, 100, 24, 'SYMMETRY [S]', () => this._toggleSymmetry())
    this._gridBtn = this._addButton(this._PX + 104,  y, 80,  24, 'GRID [G]',     () => this._toggleGrid())
    y += 32

    // Undo / Redo
    this.add.text(this._PX, y - 14, 'HISTORY', {
      fontSize: '10px', color: '#778899', fontFamily: 'monospace',
    })
    this._addButton(this._PX,        y, 80, 24, 'UNDO [Ctrl+Z]', () => this._undo())
    this._addButton(this._PX + 84,   y, 80, 24, 'REDO [Ctrl+Y]', () => this._redo())
    y += 32

    // Palette
    this.add.text(this._PX, y - 14, 'PALETTE', {
      fontSize: '10px', color: '#778899', fontFamily: 'monospace',
    })
    this._paletteUI = []
    for (let i = 0; i < PALETTE_COLOURS.length; i++) {
      const c   = PALETTE_COLOURS[i]
      const sx  = this._PX + (i % 2) * (SWATCH_W + 4)
      const sy  = y + Math.floor(i / 2) * (SWATCH_H + 4)
      const swatch = c.hex == null
        ? this.add.rectangle(sx, sy, SWATCH_W, SWATCH_H, 0x222222, 1).setOrigin(0)
        : this.add.rectangle(sx, sy, SWATCH_W, SWATCH_H, c.hex, 1).setOrigin(0)
      swatch.setStrokeStyle(1, 0x556677, 1)
      const label = this.add.text(sx + SWATCH_W / 2, sy + SWATCH_H / 2, c.name, {
        fontSize: '9px', color: '#aabbcc', fontFamily: 'monospace',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5)
      const hit = this.add.rectangle(sx, sy, SWATCH_W, SWATCH_H, 0xffffff, 0).setOrigin(0)
        .setInteractive({ useHandCursor: true })
      hit.on('pointerdown', () => this._selectColour(c))
      this._paletteUI.push({ c, swatch, label, hit })
    }
    y += Math.ceil(PALETTE_COLOURS.length / 2) * (SWATCH_H + 4) + 6

    // Custom colour picker — opens the browser's native colour picker and
    // writes the chosen colour into the CUSTOM palette slot.
    this._addButton(this._PX, y, 130, 24, 'PICK CUSTOM ✎', () => this._openColorPicker())
    y += 32

    // Slots
    this.add.text(this._PX, y - 4, 'SLOTS  (★ = active in game)', {
      fontSize: '10px', color: '#778899', fontFamily: 'monospace',
    })
    y += 12
    this._slotUI = []
    for (let n = 1; n <= NUM_SLOTS; n++) {
      const btn = this._addButton(this._PX + (n - 1) * 32, y, 28, 24, `${n}`, () => this._switchSlot(n))
      this._slotUI.push({ slot: n, btn })
    }
    this._addButton(this._PX + NUM_SLOTS * 32 + 8, y, 110, 24, 'ACTIVATE THIS', () => this._activateSlot())
    y += 32

    // Actions
    this._addButton(this._PX,        y,      120, 26, 'LOAD CURRENT',     () => this._loadProcedural())
    this._addButton(this._PX + 124,  y,      80,  26, 'SAVE',             () => this._saveSlot(this._currentSlot))
    this._addButton(this._PX,        y + 30, 80,  26, 'CLEAR',            () => this._clearPattern())
    this._addButton(this._PX + 84,   y + 30, 160, 26, 'DELETE SAVED SLOT', () => this._deleteSavedPattern())
    this._addButton(this._PX,        y + 60, 80,  26, 'BACK',             () => this.scene.start('MainMenu'))
    this._addButton(this._PX + 84,   y + 60, 160, 26, 'EXPORT FOR SHIP',  () => this._exportForShipping())

    this._refreshPaletteHighlight()
    this._refreshToolHighlight()
    this._refreshBrushHighlight()
    this._refreshToggleHighlights()
    this._refreshSlotsHighlight()

    this._buildPreview()
  }

  _addButton(x, y, w, h, label, onClick) {
    const r = this.add.rectangle(x, y, w, h, 0x102030, 1).setOrigin(0)
    r.setStrokeStyle(1, 0x3a4a5e, 1)
    const t = this.add.text(x + w / 2, y + h / 2, label, {
      fontSize: '10px', color: '#aabbcc', fontFamily: 'monospace',
    }).setOrigin(0.5)
    const hit = this.add.rectangle(x, y, w, h, 0xffffff, 0).setOrigin(0)
      .setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => { r.fillColor = 0x1a2c44; t.setColor('#ddeeff') })
    hit.on('pointerout',  () => { r.fillColor = 0x102030; t.setColor('#aabbcc') })
    hit.on('pointerdown', onClick)
    return { r, t, hit, x, y, w, h }
  }

  _setBtnActive(btn, active) {
    btn.r.setStrokeStyle(active ? 2 : 1, active ? 0xffcc44 : 0x3a4a5e, 1)
  }

  _selectColour(c) {
    this._currentColour = c
    this._refreshPaletteHighlight()
  }

  _refreshPaletteHighlight() {
    for (const p of this._paletteUI) {
      p.swatch.setStrokeStyle(p.c === this._currentColour ? 2 : 1,
                              p.c === this._currentColour ? 0xffcc44 : 0x556677, 1)
    }
  }

  _refreshToolHighlight() {
    for (const t of this._toolUI) this._setBtnActive(t.btn, t.tool === this._tool)
  }

  _refreshBrushHighlight() {
    for (const b of this._brushUI) this._setBtnActive(b.btn, b.size === this._brushSize)
  }

  _refreshToggleHighlights() {
    if (this._symBtn)  this._setBtnActive(this._symBtn,  this._symmetry)
    if (this._gridBtn) this._setBtnActive(this._gridBtn, this._gridVisible)
  }

  _refreshSlotsHighlight() {
    if (!this._slotUI) return
    const active = this._loadActiveSlot()
    for (const s of this._slotUI) {
      this._setBtnActive(s.btn, s.slot === this._currentSlot)
      // Mark the in-game-active slot with a star prefix in the label.
      s.btn.t.setText(s.slot === active ? `★${s.slot}` : `${s.slot}`)
    }
  }

  _flashStatus(msg) {
    if (!this._status) return
    this._status.setText(msg)
    this.time.delayedCall(1500, () => { if (this._status.text === msg) this._status.setText('') })
  }

  // ── Grid drawing ─────────────────────────────────────────────────────────

  _drawGridLines() {
    const g = this._gridLinesG
    g.clear()
    g.lineStyle(1, 0x1a2030, 0.4)
    for (let i = 1; i < GRID_SIZE; i++) {
      g.beginPath(); g.moveTo(this._GX + i * CELL, GRID_Y); g.lineTo(this._GX + i * CELL, GRID_Y + GRID_W); g.strokePath()
      g.beginPath(); g.moveTo(this._GX, GRID_Y + i * CELL); g.lineTo(this._GX + GRID_W, GRID_Y + i * CELL); g.strokePath()
    }
    g.lineStyle(1, 0x2a3040, 0.8)
    for (let i = 0; i <= GRID_SIZE; i += 8) {
      g.beginPath(); g.moveTo(this._GX + i * CELL, GRID_Y); g.lineTo(this._GX + i * CELL, GRID_Y + GRID_W); g.strokePath()
      g.beginPath(); g.moveTo(this._GX, GRID_Y + i * CELL); g.lineTo(this._GX + GRID_W, GRID_Y + i * CELL); g.strokePath()
    }
    g.setVisible(this._gridVisible)
  }

  _redrawGrid() {
    this._gridG.clear()
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const c = this._pixels[y][x]
        if (c == null) continue
        this._gridG.fillStyle(c, 1)
        this._gridG.fillRect(this._GX + x * CELL, GRID_Y + y * CELL, CELL, CELL)
      }
    }
    this._refreshPreview()
  }

  // ── Preview ──────────────────────────────────────────────────────────────

  _buildPreview() {
    // Sit the preview under the grid in the centered design space — uses the
    // design height (uiH) so it lands consistently regardless of the actual
    // window size.
    const PV_SCALE = 2
    const PV_TILE  = GRID_SIZE * PV_SCALE     // 64
    const PV_X     = this._GX
    const PV_Y     = GRID_Y + GRID_W + 44
    if (PV_Y + PV_TILE * 2 > (this.uiH ?? this.scale.height)) return
    this.add.text(PV_X, PV_Y - 14, 'PREVIEW (4 corners, mirrored)', {
      fontSize: '10px', color: '#778899', fontFamily: 'monospace',
    })
    this._previewG = this.add.graphics()
    this._previewMeta = { x: PV_X, y: PV_Y, scale: PV_SCALE, tileW: PV_TILE }
    const f = this.add.graphics()
    f.lineStyle(1, 0x3a4a5e, 1)
    f.strokeRect(PV_X,           PV_Y,           PV_TILE, PV_TILE)
    f.strokeRect(PV_X + PV_TILE, PV_Y,           PV_TILE, PV_TILE)
    f.strokeRect(PV_X,           PV_Y + PV_TILE, PV_TILE, PV_TILE)
    f.strokeRect(PV_X + PV_TILE, PV_Y + PV_TILE, PV_TILE, PV_TILE)
  }

  _refreshPreview() {
    if (!this._previewG) return
    const { x: PX, y: PY, scale: S, tileW: TW } = this._previewMeta
    const g = this._previewG
    g.clear()
    g.fillStyle(PALETTE.void ?? 0x050a12, 1)
    g.fillRect(PX, PY, TW * 2, TW * 2)
    const draw = (ox, oy, kind) => {
      for (let py = 0; py < GRID_SIZE; py++) {
        for (let px = 0; px < GRID_SIZE; px++) {
          let sx = px, sy = py
          if (kind === 'cTR' || kind === 'cBR') sx = GRID_SIZE - 1 - px
          if (kind === 'cBL' || kind === 'cBR') sy = GRID_SIZE - 1 - py
          const c = this._pixels[sy][sx]
          if (c == null) continue
          g.fillStyle(c, 1); g.fillRect(ox + px * S, oy + py * S, S, S)
        }
      }
    }
    draw(PX,           PY,           'cTL')
    draw(PX + TW,      PY,           'cTR')
    draw(PX,           PY + TW,      'cBL')
    draw(PX + TW,      PY + TW,      'cBR')
  }
}

// Helper used by DungeonRenderer to load the active slot's pattern. Falls
// back to the legacy single-pattern key for installs that pre-date the
// slot system (the editor's _migrateLegacy would also have handled this on
// first launch, but if the renderer runs before the editor ever opens, we
// honour the legacy key directly).
export function loadCornerPattern() {
  try {
    const v = localStorage.getItem(ACTIVE_KEY)
    const n = parseInt(v, 10)
    const slot = (n >= 1 && n <= NUM_SLOTS) ? n : 1
    const raw = localStorage.getItem(SLOT_KEY_PREFIX + slot)
    if (raw) {
      const data = JSON.parse(raw)
      if (Array.isArray(data) && data.length === GRID_SIZE) return data
    }
    // Legacy fallback
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const data = JSON.parse(legacy)
      if (Array.isArray(data) && data.length === GRID_SIZE) return data
    }
  } catch (e) {}
  // Bundled default — what ships with the build. The CornerEditor's
  // EXPORT FOR SHIP button writes to src/data/cornerPattern.js.
  if (Array.isArray(DEFAULT_PATTERN) && DEFAULT_PATTERN.length === GRID_SIZE) {
    return DEFAULT_PATTERN
  }
  return null
}

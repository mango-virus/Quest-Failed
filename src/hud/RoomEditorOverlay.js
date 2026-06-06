// RoomEditorOverlay — clean DOM chrome for the Room Tile Editor.
//
// The editor is a hybrid surface: the Phaser `RoomTileEditor` scene renders
// ONLY the paint canvas (the tile grid) into a centre rectangle, while this
// DOM overlay draws everything around it — header, rooms list, mode tabs,
// view controls, the per-mode context panel and the hint bar. Both layers
// share one 1920×1080 logical coordinate space: this overlay rides the
// shared `stageScale` transform (#hud-stage), and the scene's camera is set
// to `centerOn(960,540)` at the same fit-scale, so a logical rect here maps
// to the exact same screen pixels the scene paints into. `EDITOR_LAYOUT.canvas`
// is that shared rect — the scene reads it to size `_paintArea`.
//
// The overlay never touches room data directly; it calls a small `ui*` API
// on the scene (uiSelectRoom / uiSetTab / uiZoom / …) and the scene calls
// `overlay.refresh()` back whenever state changes so the chrome re-syncs.

import { h, mount } from './dom.js'
import { ensureStageScaled } from './stageScale.js'

// ── Shared layout (1920×1080 logical) ───────────────────────────────────────
// Panel band sizes. The derived `canvas` rect is the transparent centre the
// Phaser paint grid renders into — exported so the scene can mirror it into
// `_paintArea`. Keep the two in lockstep: this object is the single source.
const HEADER_H = 78
const LEFT_W   = 288
const RIGHT_W  = 400
const BOTTOM_H = 52
const TABS_H   = 58
const PAD      = 22

export const EDITOR_LAYOUT = {
  headerH: HEADER_H, leftW: LEFT_W, rightW: RIGHT_W, bottomH: BOTTOM_H,
  tabsH: TABS_H, pad: PAD,
  // Transparent paint-canvas rect, in 1920×1080 logical coords.
  canvas: {
    x: LEFT_W + PAD,
    y: HEADER_H + TABS_H + PAD,
    w: 1920 - LEFT_W - RIGHT_W - PAD * 2,
    h: 1080 - HEADER_H - TABS_H - BOTTOM_H - PAD * 2,
  },
}

const TABS = [
  { id: 'tiles', label: 'Tiles', icon: '▦', hint: 'Paint floor & wall tiles' },
  { id: 'doors', label: 'Doors', icon: '⊟', hint: 'Stamp door slots on walls' },
  { id: 'decor', label: 'Decor', icon: '✦', hint: 'Place decorations & props' },
  { id: 'colors', label: 'Colors', icon: '◐', hint: 'Tint walls, floor & doors' },
]

// Colour-adjust definitions — mirror the Phaser editor's PARAMS (range + step)
// and the three targets. Used to build the DOM range sliders.
const COLOR_FIELDS = [
  { field: 'hue',      label: 'Hue',      min: -180, max: 180, step: 15,   fmt: v => (v >= 0 ? '+' : '') + Math.round(v) + '°' },
  { field: 'sat',      label: 'Sat',      min: -1,   max: 2,   step: 0.1,  fmt: v => (v >= 0 ? '+' : '') + (+v).toFixed(1) },
  { field: 'bright',   label: 'Bright',   min: -0.5, max: 0.5, step: 0.05, fmt: v => (v >= 0 ? '+' : '') + (+v).toFixed(2) },
  { field: 'contrast', label: 'Contrast', min: -1,   max: 1,   step: 0.1,  fmt: v => (v >= 0 ? '+' : '') + (+v).toFixed(1) },
]
// Doors share the walls colour, so the colour changer is just Walls + Floor.
const COLOR_TARGETS = [
  { key: 'walls', label: 'Walls & doors', accent: '#e8c880' },
  { key: 'floor', label: 'Floor', accent: '#80c8e8' },
]
const DOOR_STATES = [
  { key: 'closed', label: 'Closed' },
  { key: 'open',   label: 'Open' },
  { key: 'locked', label: 'Locked' },
]

export class RoomEditorOverlay {
  constructor(scene) {
    this.scene   = scene
    this._el     = null
    this._closed = false
    this._refs   = {}
  }

  open() {
    if (this._el) return
    ensureStageScaled()
    const stage = document.getElementById('hud-stage')
    if (!stage) { console.warn('[RoomEditorOverlay] #hud-stage missing'); return }
    const root = document.getElementById('hud-root')
    if (root) root.hidden = false
    this._render()
    stage.appendChild(this._el)
    this.refresh()
  }

  close() {
    if (this._closed) return
    this._closed = true
    this._el?.remove()
    this._el = null
  }

  // ── Render the static shell once; dynamic bits update in refresh() ─────────
  _render() {
    const L = EDITOR_LAYOUT
    this._el = h('div', { className: 'qf-redit', dataset: { stage: 'room-editor' } }, [
      this._header(L),
      this._roomsPanel(L),
      this._tabStrip(L),
      this._viewControls(L),
      this._contextPanel(L),
      this._hintBar(L),
    ])
  }

  // Header: title · room name + resize + theme pickers · folder + save/back
  _header(L) {
    return h('div', {
      className: 'qf-redit__header',
      style: { height: `${L.headerH}px` },
    }, [
      h('div', { className: 'qf-redit__brand' }, [
        h('span', { className: 'qf-redit__brand-mark' }, '◆'),
        h('span', { className: 'qf-redit__brand-text' }, 'ROOM EDITOR'),
      ]),
      h('div', { className: 'qf-redit__room', ref: (e) => (this._refs.roomBox = e) }),
      h('div', { className: 'qf-redit__header-actions' }, [
        h('span', { className: 'qf-redit__folder', ref: (e) => (this._refs.folder = e) }),
        h('button', {
          className: 'btn sm', title: 'Undo last change (Ctrl+Z)',
          ref: (e) => (this._refs.undo = e),
          on: { click: () => this.scene.uiUndo?.() },
        }, '↶ Undo'),
        h('button', {
          className: 'btn sm',
          title: 'Manage themes: upload tiles, assign slots, switch themes',
          on: { click: () => this.openThemes() },
        }, '⚙ Themes'),
        h('button', {
          className: 'btn sm',
          title: 'Download a PNG of this exact room (edit the pixels, then re-import as a skin)',
          on: { click: () => this.scene.uiExportRoomPng?.() },
        }, '🖼 Export PNG'),
        h('button', {
          className: 'btn sm',
          title: 'Room skins: re-import an edited PNG as a full-room look',
          on: { click: () => this.openSkins() },
        }, '🎨 Skins'),
        h('button', {
          className: 'btn sm',
          on: { click: () => this.scene.uiSave?.() },
        }, '⤓ Save to disk'),
        h('button', {
          className: 'btn sm ghost',
          on: { click: () => this.scene.uiBack?.() },
        }, '← Back'),
      ]),
    ])
  }

  // Left: scrollable rooms list
  _roomsPanel(L) {
    return h('div', {
      className: 'qf-redit__rooms',
      style: { top: `${L.headerH}px`, width: `${L.leftW}px`, bottom: `${L.bottomH}px` },
    }, [
      h('div', { className: 'qf-redit__panel-head' }, 'ROOMS'),
      h('div', { className: 'qf-redit__rooms-list', ref: (e) => (this._refs.roomsList = e) }),
    ])
  }

  // Centre top: mode tabs
  _tabStrip(L) {
    const tabs = TABS.map((t) =>
      h('button', {
        className: 'qf-redit__tab',
        dataset: { tab: t.id },
        title: t.hint,
        on: { click: () => this.scene.uiSetTab?.(t.id) },
        ref: (e) => ((this._refs.tabs ||= {}), (this._refs.tabs[t.id] = e)),
      }, [
        h('span', { className: 'qf-redit__tab-icon' }, t.icon),
        h('span', null, t.label),
      ]),
    )
    return h('div', {
      className: 'qf-redit__tabs',
      style: {
        left: `${L.leftW}px`, right: `${L.rightW}px`,
        top: `${L.headerH}px`, height: `${L.tabsH}px`,
      },
    }, tabs)
  }

  // Centre bottom: floating view-controls bar (zoom / rotate / flip / eraser)
  _viewControls(L) {
    const seg = (children) => h('div', { className: 'qf-redit__vc-seg' }, children)
    const btn = (label, title, on, ref) =>
      h('button', { className: 'qf-redit__vc-btn', title, on: { click: on }, ref }, label)

    return h('div', {
      className: 'qf-redit__viewctl',
      style: { left: `${L.leftW}px`, right: `${L.rightW}px`, bottom: `${L.bottomH}px` },
    }, [
      h('div', { className: 'qf-redit__vc-pill' }, [
        seg([
          btn('−', 'Zoom out', () => this.scene.uiZoom?.(-1)),
          h('span', { className: 'qf-redit__vc-readout', ref: (e) => (this._refs.zoom = e) }, '100%'),
          btn('+', 'Zoom in', () => this.scene.uiZoom?.(+1)),
        ]),
        seg([
          btn('⟳ View', 'Rotate the whole view (V)', () => this.scene.uiRotateView?.(),
            (e) => (this._refs.viewRot = e)),
          btn('⟲ Tile', 'Rotate the active brush (R)', () => this.scene.uiRotateTile?.(),
            (e) => (this._refs.tileRot = e)),
        ]),
        seg([
          btn('⇄', 'Flip horizontal', () => this.scene.uiToggleFlipH?.(),
            (e) => (this._refs.flipH = e)),
          btn('⇅', 'Flip vertical', () => this.scene.uiToggleFlipV?.(),
            (e) => (this._refs.flipV = e)),
        ]),
        seg([
          btn('✥ Move', 'Move tool: click a painted tile, then click where to put it',
            () => this.scene.uiToggleMove?.(), (e) => (this._refs.move = e)),
          btn('⌗ Grid', 'Show / hide the cell grid lines',
            () => this.scene.uiToggleGrid?.(), (e) => (this._refs.grid = e)),
          btn('⌫ Eraser', 'Toggle eraser (or right-click / Shift-click)',
            () => this.scene.uiToggleEraser?.(), (e) => (this._refs.eraser = e)),
        ]),
      ]),
    ])
  }

  // Right: per-tab context panel (filled by refresh / Stage 2 palettes)
  _contextPanel(L) {
    return h('div', {
      className: 'qf-redit__context',
      style: { top: `${L.headerH}px`, width: `${L.rightW}px`, bottom: `${L.bottomH}px` },
      ref: (e) => (this._refs.context = e),
    })
  }

  _hintBar(L) {
    return h('div', {
      className: 'qf-redit__hints',
      style: { height: `${L.bottomH}px` },
      ref: (e) => (this._refs.hints = e),
    })
  }

  // ── Dynamic sync ───────────────────────────────────────────────────────────
  refresh() {
    if (!this._el) return
    const s = this.scene.uiGetState?.()
    if (!s) return
    this._syncRoomBox(s)
    this._syncFolder(s)
    this._syncRoomsList(s)
    this._syncTabs(s)
    this._syncViewControls(s)
    this._syncContext(s)
    this._syncHints(s)
    if (this._refs.undo) this._refs.undo.disabled = !s.canUndo
  }

  _syncRoomBox(s) {
    const box = this._refs.roomBox
    if (!box) return
    const r = s.activeRoom
    mount(box, r ? [
      h('span', { className: 'qf-redit__room-name' }, r.name),
      h('button', {
        className: 'qf-redit__room-size',
        title: 'Resize this room (lossless reshape)',
        on: { click: () => this.scene.uiResizeRoom?.() },
      }, [`${r.width}×${r.height}`, h('span', { className: 'qf-redit__room-edit' }, ' ✎')]),
    ] : [h('span', { className: 'qf-redit__room-name dim' }, '(no room)')])
  }

  _syncFolder(s) {
    const f = this._refs.folder
    if (!f) return
    if (s.folderName) {
      f.className = 'qf-redit__folder ok'
      f.textContent = `📁 ${s.folderName}`
    } else {
      f.className = 'qf-redit__folder warn'
      f.textContent = '📁 no folder — Save will download'
    }
  }

  _syncRoomsList(s) {
    const list = this._refs.roomsList
    if (!list) return
    mount(list, s.rooms.map((r) =>
      h('button', {
        className: ['qf-redit__room-row', r.id === s.activeRoomId && 'is-active'],
        on: { click: () => this.scene.uiSelectRoom?.(r.id) },
      }, [
        h('span', { className: ['qf-redit__room-dot', r.hasOverrides && 'on'] }),
        h('span', { className: 'qf-redit__room-row-name' }, r.name),
        h('span', { className: 'qf-redit__room-row-size' }, `${r.width}×${r.height}`),
      ]),
    ))
  }

  _syncTabs(s) {
    const tabs = this._refs.tabs || {}
    for (const id of Object.keys(tabs)) {
      tabs[id].classList.toggle('is-active', id === s.tab)
    }
  }

  _syncViewControls(s) {
    const r = this._refs
    if (r.zoom) r.zoom.textContent = s.zoomLabel
    if (r.viewRot) r.viewRot.textContent = `⟳ View ${s.viewRot}°`
    if (r.tileRot) r.tileRot.textContent = `⟲ Tile ${s.activeRot}°`
    r.flipH?.classList.toggle('is-on', !!s.flipH)
    r.flipV?.classList.toggle('is-on', !!s.flipV)
    r.eraser?.classList.toggle('is-on', !!s.eraser)
    r.grid?.classList.toggle('is-on', s.showGrid !== false)
    if (r.move) {
      r.move.classList.toggle('is-on', !!s.moveMode)
      r.move.textContent = s.holding ? `✥ Placing ${s.heldId || ''}…` : '✥ Move'
    }
  }

  // The right panel is rebuilt when the tab or room changes. The Colors tab is
  // special: rebuilding it mid-drag would yank focus off a slider, so once
  // built for a room it is NOT rebuilt on routine refreshes (zoom, flip, …) —
  // only on a room switch or an explicit force (the Reset buttons).
  _syncContext(s) {
    const host = this._refs.context
    if (!host) return
    const tabRoomChanged = this._ctxTab !== s.tab || this._ctxRoom !== s.activeRoomId
    // Rebuild the panel on every refresh so EVERY control + label reflects the
    // current state (dropdowns, segments, notes, highlights). Scroll position
    // is preserved across the rebuild. Exception: the Colors tab is NOT rebuilt
    // mid-interaction (it would yank focus off a slider being dragged) — it
    // rebuilds only on a tab/room change or an explicit force (Reset).
    if (s.tab === 'colors' && !tabRoomChanged) return
    this._ctxTab = s.tab
    this._ctxRoom = s.activeRoomId
    const prevScroll = host.querySelector('.qf-redit__ctx-scroll')?.scrollTop || 0
    this._buildContext(s)
    const nextScroll = host.querySelector('.qf-redit__ctx-scroll')
    if (nextScroll) nextScroll.scrollTop = prevScroll
  }

  _forceContextRebuild() { this._ctxRoom = null; this.refresh() }

  _buildContext(s) {
    const host = this._refs.context
    const tab = TABS.find((t) => t.id === s.tab) || TABS[0]
    const body =
      s.tab === 'tiles'  ? this._tilesPanel(s) :
      s.tab === 'doors'  ? this._doorsPanel(s) :
      s.tab === 'decor'  ? this._decorPanel(s) :
                           this._colorsPanel(s)
    mount(host, [
      h('div', { className: 'qf-redit__panel-head' }, tab.label.toUpperCase()),
      h('div', { className: 'qf-redit__ctx-scroll' }, body),
    ])
  }

  // ── Shared building blocks ──────────────────────────────────────────────────
  _themeSelect(label, field, noneLabel) {
    const themes = this.scene.uiListThemes?.() || []
    const value = this.scene.uiGetTheme?.(field) || ''
    return h('label', { className: 'qf-redit__field' }, [
      h('span', { className: 'qf-redit__field-label' }, label),
      // Mark the matching <option selected> rather than setting select.value via
      // a ref — the ref runs before the options exist, so .value wouldn't stick.
      h('select', {
        className: 'qf-redit__select',
        on: { change: (e) => this.scene.uiSetTheme?.(field, e.target.value || null) },
      }, [
        h('option', { value: '', selected: value === '' }, noneLabel),
        ...themes.map((t) => h('option', { value: t, selected: value === t }, t)),
      ]),
    ])
  }

  _spriteGrid(items, activeId, onPick, emptyMsg, onDelete = null) {
    if (!items.length) return h('div', { className: 'qf-redit__ctx-empty' }, emptyMsg)
    return h('div', { className: 'qf-redit__sprite-grid' }, items.map((it) =>
      h('div', {
        className: ['qf-redit__sprite', it.id === activeId && 'is-active'],
        title: it.id,
        on: {
          click: (e) => {
            // Optimistic toggle (the pick is a toggle: clicking the active
            // one deselects). Keeps the highlight correct without a rebuild.
            const btn = e.currentTarget
            const wasActive = btn.classList.contains('is-active')
            btn.parentElement.querySelectorAll('.qf-redit__sprite.is-active')
              .forEach((b) => b.classList.remove('is-active'))
            if (!wasActive) btn.classList.add('is-active')
            onPick(it.id)
          },
        },
      }, [
        onDelete ? h('span', {
          className: 'qf-redit__sprite-del', title: `Delete “${it.id}” from the library`,
          on: { click: (e) => { e.stopPropagation(); if (window.confirm(`Delete “${it.id}”? This removes it everywhere it's used.`)) onDelete(it.id) } },
        }, '×') : null,
        it.thumb
          ? h('img', { className: 'qf-redit__sprite-img', src: it.thumb, draggable: 'false' })
          : h('span', { className: 'qf-redit__sprite-q' }, '?'),
        h('span', { className: 'qf-redit__sprite-label' },
          it.id.length > 9 ? it.id.slice(0, 8) + '…' : it.id),
      ]),
    ))
  }

  // Segmented button group where exactly one is active (set, not toggle).
  _segment(options, current, onPick) {
    return h('div', { className: 'qf-redit__segment' }, options.map((o) =>
      h('button', {
        className: ['qf-redit__seg-btn', o.val === current && 'is-active'],
        on: {
          click: (e) => {
            const btn = e.currentTarget
            btn.parentElement.querySelectorAll('.qf-redit__seg-btn.is-active')
              .forEach((b) => b.classList.remove('is-active'))
            btn.classList.add('is-active')
            onPick(o.val)
          },
        },
      }, o.label),
    ))
  }

  // Palette scope toggle: "<theme> tiles" ↔ "All tiles" (escape hatch).
  _paletteScopeToggle() {
    const p = this.scene.uiPaletteInfo?.() || {}
    if (!p.themed) return h('span', { className: 'qf-redit__palette-note' }, 'theme: none')
    return h('button', {
      className: ['qf-redit__link-btn', p.showAll && 'is-on'],
      title: p.showAll ? 'Showing every tile — click to show only this room’s theme'
                       : `Showing “${p.theme}” tiles — click to show all`,
      on: { click: () => { this.scene.uiTogglePaletteAll?.(); this._forceContextRebuild() } },
    }, p.showAll ? 'All tiles' : `${p.theme} tiles`)
  }

  // ── Tiles ───────────────────────────────────────────────────────────────────
  _tilesPanel(s) {
    const sprites = this.scene.uiListTileSprites?.() || []
    const active = this.scene.uiActiveSpriteId?.()
    return [
      h('div', { className: 'qf-redit__section' }, [
        this._themeSelect('Room theme', 'theme', '(none)'),
        this._themeSelect('Door theme', 'doorTheme', '(default)'),
      ]),
      h('div', { className: 'qf-redit__subhead' }, [
        h('span', null, 'TILE BRUSH'),
        h('div', { className: 'qf-redit__subhead-actions' }, [
          this._paletteScopeToggle(),
          h('button', {
            className: 'qf-redit__link-btn',
            title: 'Clear every per-cell override on this room',
            on: { click: () => this.scene.uiClearOverrides?.() },
          }, 'Clear all'),
        ]),
      ]),
      this._spriteGrid(sprites, active, (id) => this.scene.uiPickSprite?.(id),
        'No tiles for this theme yet — open ⚙ Themes to upload some.',
        (id) => { this.scene.uiDeleteThemeSprite?.(id); this._forceContextRebuild() }),
    ]
  }

  // Clarifies what doors created on this room will actually look like.
  _doorThemeNote() {
    const e = this.scene.uiEffectiveDoorTheme?.() || {}
    const text = e.effective
      ? (e.fromRoomTheme ? `Doors use the room theme: ${e.effective}` : `Doors use: ${e.effective}`)
      : 'No theme set — doors render procedurally.'
    return h('div', { className: 'qf-redit__door-note' }, text)
  }

  // ── Doors ───────────────────────────────────────────────────────────────────
  _doorsPanel(s) {
    const cur = this.scene.uiDoorState?.() || 'closed'
    const sprites = this.scene.uiListTileSprites?.() || []
    const active = this.scene.uiActiveSpriteId?.()
    return [
      h('div', { className: 'qf-redit__section' }, [
        h('span', { className: 'qf-redit__field-label' }, 'Door state'),
        this._segment(DOOR_STATES.map((d) => ({ val: d.key, label: d.label })), cur,
          (v) => this.scene.uiSetDoorState?.(v)),
        this._themeSelect('Door theme', 'doorTheme', '(use room theme)'),
        this._doorThemeNote(),
        h('span', { className: 'qf-redit__field-label' }, `Door image — ${cur} state`),
        h('div', { className: 'qf-redit__btn-row' }, [
          h('button', {
            className: 'btn sm', title: `Download the ${cur} door as a PNG to edit`,
            on: { click: () => this.scene.uiExportDoorPng?.() },
          }, '🖼 Export door'),
          h('button', {
            className: 'btn sm', title: `Upload an edited PNG as the ${cur} door`,
            on: { click: () => this.scene.uiUploadDoorSkin?.() },
          }, '🎨 Door skin'),
          h('button', {
            className: 'btn sm ghost', title: 'Clear the painted door (back to theme)',
            on: { click: () => this.scene.uiClearDoorSkin?.() },
          }, 'Clear'),
        ]),
        h('div', { className: 'qf-redit__door-note' },
          'Tip: Export → edit the 256×192 PNG → Door skin. 4×3: rows 1-2 are the door (frame + panels), row 3 (“Below”) is decorative art that renders one tile into the room — door function is unchanged.'),
      ]),
      h('div', { className: 'qf-redit__subhead' }, [
        h('span', null, 'DOOR BRUSH'),
        h('div', { className: 'qf-redit__subhead-actions' }, [this._paletteScopeToggle()]),
      ]),
      this._spriteGrid(sprites, active, (id) => this.scene.uiPickSprite?.(id),
        'No tiles for this theme yet — open ⚙ Themes to upload some.',
        (id) => { this.scene.uiDeleteThemeSprite?.(id); this._forceContextRebuild() }),
    ]
  }

  // ── Decor ───────────────────────────────────────────────────────────────────
  _decorPanel(s) {
    const opts = this.scene.uiDecorOpts?.() || { size: 1, solid: false, layer: 'floor' }
    const sprites = this.scene.uiListDecorSprites?.() || []
    const active = this.scene.uiActiveDecorId?.()
    const seg = (label, options, current, onPick) =>
      h('div', { className: 'qf-redit__opt-row' }, [
        h('span', { className: 'qf-redit__field-label' }, label),
        this._segment(options, current, onPick),
      ])
    return [
      h('div', { className: 'qf-redit__section' }, [
        seg('Size', [{ val: 1, label: '1×1' }, { val: 2, label: '2×2' }], opts.size,
          (v) => this.scene.uiSetDecorSize?.(v)),
        seg('Layer', [{ val: 'floor', label: 'Floor' }, { val: 'object', label: 'Object' }], opts.layer,
          (v) => this.scene.uiSetDecorLayer?.(v)),
        h('label', { className: 'qf-redit__check' }, [
          h('input', {
            type: 'checkbox', checked: !!opts.solid,
            on: { change: (e) => this.scene.uiSetDecorSolid?.(e.target.checked) },
          }),
          h('span', null, 'Solid (blocks movement)'),
        ]),
        h('div', { className: 'qf-redit__btn-row' }, [
          h('button', { className: 'btn sm', on: { click: () => this.scene.uiUploadDecor?.() } }, '▲ Upload PNG'),
          h('button', { className: 'btn sm ghost', on: { click: () => this.scene.uiClearDecors?.() } }, 'Clear decor'),
        ]),
      ]),
      h('div', { className: 'qf-redit__subhead' }, [h('span', null, 'DECOR BRUSH')]),
      this._spriteGrid(sprites, active, (id) => this.scene.uiPickDecor?.(id),
        'No decor sprites yet — upload a PNG to begin.',
        (id) => { this.scene.uiDeleteDecorSprite?.(id); this._forceContextRebuild() }),
    ]
  }

  // ── Colors ──────────────────────────────────────────────────────────────────
  _colorsPanel(s) {
    const params = this.scene.uiColorParams?.() || { walls: {}, floor: {}, doors: {} }
    return COLOR_TARGETS.map((t) => {
      const vals = params[t.key] || {}
      const has = this.scene.uiHasColor?.(t.key)
      return h('div', { className: 'qf-redit__color-group' }, [
        h('div', { className: 'qf-redit__color-head' }, [
          h('span', { className: 'qf-redit__color-name', style: { color: t.accent } }, t.label),
          h('button', {
            className: ['qf-redit__link-btn', !has && 'is-disabled'],
            on: { click: () => { this.scene.uiResetColor?.(t.key); this._forceContextRebuild() } },
          }, 'Reset'),
        ]),
        ...COLOR_FIELDS.map((f) => {
          const v = vals[f.field] || 0
          let valEl
          return h('div', { className: 'qf-redit__slider-row' }, [
            h('span', { className: 'qf-redit__slider-label' }, f.label),
            h('input', {
              className: 'qf-redit__slider', type: 'range',
              min: f.min, max: f.max, step: f.step, value: v,
              style: { '--accent': t.accent },
              on: {
                // One undo entry per drag (snapshot the pre-drag colour).
                pointerdown: () => this.scene.uiBeginColorEdit?.(),
                input: (e) => {
                  const nv = +e.target.value
                  this.scene.uiSetColor?.(t.key, f.field, nv, f.min, f.max)
                  if (valEl) valEl.textContent = f.fmt(nv)
                  valEl?.classList.toggle('nonzero', nv !== 0)
                },
              },
            }),
            h('span', {
              className: ['qf-redit__slider-val', v !== 0 && 'nonzero'],
              ref: (e) => (valEl = e),
            }, f.fmt(v)),
          ])
        }),
      ])
    })
  }

  _syncHints(s) {
    const host = this._refs.hints
    if (!host) return
    const hint = (k, v) =>
      h('span', { className: 'qf-redit__hint' }, [
        h('kbd', { className: 'qf-redit__kbd' }, k), v,
      ])
    mount(host, [
      hint('Click', 'paint'),
      hint('Right-click', 'clear'),
      hint('R', 'rotate brush'),
      hint('V', 'rotate view'),
    ])
  }

  // ── Themes manager modal (Phase 1: themed-tile authoring) ───────────────────
  openThemes() {
    if (this._themesEl || !this._el) return
    const d = this.scene.uiThemeAuthorData?.()
    this._editingTheme = d?.editing || null
    this._themeMsg = ''
    this._themesEl = h('div', {
      className: 'qf-themes',
      on: { click: (e) => { if (e.target === this._themesEl) this.closeThemes() } },
    }, [h('div', { className: 'qf-themes__panel', ref: (e) => (this._refs.themesPanel = e) })])
    this._el.appendChild(this._themesEl)
    this._renderThemes()
  }

  closeThemes() {
    this._themesEl?.remove()
    this._themesEl = null
    this.refresh()   // tiles/doors palettes may have gained sprites/themes
  }

  _renderThemes() {
    const panel = this._refs.themesPanel
    if (!panel) return
    const d = this.scene.uiThemeAuthorData?.(this._editingTheme) ||
      { themes: [], groups: [], slots: {}, unassigned: [], slotLabels: {} }
    this._editingTheme = d.editing
    mount(panel, [this._themesHeader(d), this._themesBody(d), this._themesFooter(d)])
  }

  _themesHeader(d) {
    return h('div', { className: 'qf-themes__head' }, [
      h('div', { className: 'qf-themes__title' }, '⚙ THEME LIBRARY'),
      h('div', { className: 'qf-themes__theme-ctl' }, [
        h('select', {
          className: 'qf-themes__theme-sel',
          on: { change: (e) => { this._editingTheme = e.target.value || null; this._renderThemes() } },
        }, d.themes.length ? d.themes.map((t) => h('option', { value: t, selected: t === d.editing }, t))
                           : [h('option', { value: '' }, '(no themes yet)')]),
        h('button', { className: 'btn sm', on: { click: () => this._newTheme() } }, '+ New'),
        h('button', { className: 'btn sm ghost', on: { click: () => this._renameTheme() } }, 'Rename'),
        h('button', { className: 'btn sm ghost', on: { click: () => this._deleteTheme() } }, 'Delete'),
      ]),
      h('div', { className: 'qf-themes__head-right' }, [
        h('button', {
          className: 'btn sm', disabled: !d.editing,
          title: 'Apply this theme to the room you are editing',
          on: { click: () => { if (d.editing) this.scene.uiSetTheme?.('theme', d.editing) } },
        }, 'Use in room'),
        h('button', { className: 'qf-themes__close', title: 'Close', on: { click: () => this.closeThemes() } }, '✕'),
      ]),
    ])
  }

  _themesBody(d) {
    return h('div', { className: 'qf-themes__body' }, [
      h('div', { className: 'qf-themes__left' }, [
        this._uploadZone(d),
        this._unassignedTray(d),
      ]),
      h('div', { className: 'qf-themes__right' }, [
        this._themePreview(d),
        h('div', { className: 'qf-themes__subhead' }, 'SLOT COVERAGE'),
        h('div', { className: 'qf-themes__slots' },
          d.editing ? this._slotGrid(d)
                    : [h('div', { className: 'qf-themes__empty' }, 'Create or pick a theme to begin.')]),
      ]),
    ])
  }

  _uploadZone(d) {
    const zone = h('div', {
      className: 'qf-themes__drop',
      on: {
        click: () => this._upload(),
        dragover: (e) => { e.preventDefault(); zone.classList.add('drag') },
        dragleave: () => zone.classList.remove('drag'),
        drop: (e) => { e.preventDefault(); zone.classList.remove('drag'); this._upload([...(e.dataTransfer?.files || [])]) },
      },
    }, [
      h('div', { className: 'qf-themes__drop-icon' }, '⬆'),
      h('div', { className: 'qf-themes__drop-title' },
        d.editing ? `Drop PNG tiles for “${d.editing}”` : 'Pick or create a theme first'),
      h('div', { className: 'qf-themes__drop-sub' },
        'or click to browse — files named floor3 · wall_corner_tl · door_closed_v_tl auto-slot'),
      this._themeMsg ? h('div', { className: 'qf-themes__msg' }, this._themeMsg) : null,
    ])
    return zone
  }

  async _upload(files = null) {
    if (!this._editingTheme) { this._themeMsg = 'Pick or create a theme first.'; this._renderThemes(); return }
    const r = await this.scene.uiUploadThemeSprites?.(this._editingTheme, files)
    this._themeMsg = r?.added
      ? `Added ${r.added} tile${r.added === 1 ? '' : 's'} — ${r.assigned} auto-slotted, ${r.unassigned} to assign below.`
      : 'No PNG tiles added.'
    this._renderThemes()
  }

  _unassignedTray(d) {
    return h('div', { className: 'qf-themes__tray' }, [
      h('div', { className: 'qf-themes__subhead' }, ['UNASSIGNED', h('span', { className: 'qf-themes__count' }, String(d.unassigned.length))]),
      d.unassigned.length === 0
        ? h('div', { className: 'qf-themes__empty' }, d.editing ? 'Every uploaded tile is slotted.' : '—')
        : h('div', { className: 'qf-themes__tray-list' }, d.unassigned.map((s) => this._unassignedItem(d, s))),
    ])
  }

  _unassignedItem(d, s) {
    return h('div', { className: 'qf-themes__tray-item' }, [
      s.thumb ? h('img', { className: 'qf-themes__thumb', src: s.thumb })
              : h('span', { className: 'qf-themes__thumb q' }, '?'),
      h('span', { className: 'qf-themes__tray-id', title: s.id }, s.id),
      h('select', {
        className: 'qf-themes__covsel', title: 'Tile coverage — how many cells this sprite fills (W×H). 1×2 = tall/narrow, 2×1 = wide/short.',
        on: { change: (e) => { this.scene.uiSetSpriteCoverage?.(s.id, e.target.value); this._renderThemes() } },
      }, [
        h('option', { value: '1',   selected: (s.coverage || 1) === 1 },     '1×1'),
        h('option', { value: '1x2', selected: s.coverage === '1x2' },        '1×2'),
        h('option', { value: '2x1', selected: s.coverage === '2x1' },        '2×1'),
        h('option', { value: '2',   selected: (s.coverage || 1) === 2 },     '2×2'),
        h('option', { value: '4',   selected: (s.coverage || 1) === 4 },     '4×4'),
      ]),
      h('select', {
        className: 'qf-themes__slotsel',
        on: { change: (e) => { if (e.target.value) { this.scene.uiAssignSlot?.(d.editing, e.target.value, s.id); this._renderThemes() } } },
      }, [
        h('option', { value: '' }, '— assign to slot —'),
        ...d.groups.map((g) => h('optgroup', { label: g.label }, g.slots.map((slot) => h('option', { value: slot }, d.slotLabels[slot])))),
      ]),
      h('button', {
        className: 'qf-themes__del', title: 'Delete this sprite from the library',
        on: { click: () => { if (window.confirm(`Delete sprite “${s.id}” from the library?`)) { this.scene.uiDeleteThemeSprite?.(s.id); this._renderThemes() } } },
      }, '🗑'),
    ])
  }

  _themePreview(d) {
    if (!d.editing) return null
    const url = this.scene.uiThemePreviewDataUrl?.(d.editing)
    return h('div', { className: 'qf-themes__preview' }, [
      h('div', { className: 'qf-themes__subhead' }, [
        'PREVIEW',
        h('button', {
          className: 'qf-redit__link-btn', title: 'Re-roll which variant each cell shows',
          on: { click: () => { this.scene.uiRerollPreview?.(); this._renderThemes() } },
        }, 'Reroll'),
      ]),
      h('div', { className: 'qf-themes__preview-wrap' },
        url ? h('img', { className: 'qf-themes__preview-img', src: url })
            : h('div', { className: 'qf-themes__empty' }, '—')),
    ])
  }

  _slotGrid(d) {
    return d.groups.map((g) => h('div', { className: 'qf-themes__group' }, [
      h('div', { className: 'qf-themes__group-label' }, g.label),
      ...g.slots.map((slot) => {
        const variants = d.slots[slot] || []
        return h('div', { className: ['qf-themes__slot-row', variants.length === 0 && 'is-empty'] }, [
          h('span', { className: 'qf-themes__slot-label' }, d.slotLabels[slot]),
          h('div', { className: 'qf-themes__slot-variants' },
            variants.length
              ? variants.map((v) => h('button', {
                  className: 'qf-themes__variant', title: `${v.id} — click to remove`,
                  on: { click: () => { this.scene.uiUnassignSlot?.(d.editing, slot, v.id); this._renderThemes() } },
                }, v.thumb ? h('img', { className: 'qf-themes__thumb sm', src: v.thumb })
                           : h('span', { className: 'qf-themes__thumb q sm' }, '?')))
              : h('span', { className: 'qf-themes__slot-empty' }, 'empty')),
        ])
      }),
    ]))
  }

  _themesFooter(d) {
    return h('div', { className: 'qf-themes__foot' }, [
      h('span', { className: ['qf-themes__folder', d.hasFolder ? 'ok' : 'warn'] },
        d.hasFolder ? `📁 ${d.folderName}` : '📁 no folder — Save will prompt for it'),
      h('span', { className: 'qf-themes__dirty' }, d.dirty ? '● unsaved tiles' : ''),
      h('button', { className: 'btn', on: { click: () => this._saveThemes() } }, '⤓ Save themes to disk'),
    ])
  }

  async _saveThemes() { await this.scene.uiSaveThemes?.(); this._renderThemes() }

  _newTheme() {
    const name = window.prompt('New theme name (e.g. Jungle, Spooky):')
    if (!name) return
    const r = this.scene.uiCreateTheme?.(name)
    if (r?.ok) this._editingTheme = r.name
    else if (r?.msg) this._themeMsg = r.msg
    this._renderThemes()
  }
  _renameTheme() {
    if (!this._editingTheme) return
    const name = window.prompt('Rename theme:', this._editingTheme)
    if (!name) return
    const r = this.scene.uiRenameTheme?.(this._editingTheme, name)
    if (r?.ok) this._editingTheme = r.name
    this._renderThemes()
  }
  _deleteTheme() {
    if (!this._editingTheme) return
    if (!window.confirm(`Delete theme “${this._editingTheme}”? Its tiles stay in the library (just un-grouped).`)) return
    this.scene.uiDeleteTheme?.(this._editingTheme)
    this._editingTheme = null
    this._renderThemes()
  }

  // ── Room Skins modal (Phase 4: full-room PNG skins) ─────────────────────────
  openSkins() {
    if (this._skinsEl || !this._el) return
    this._skinsEl = h('div', {
      className: 'qf-themes',
      on: { click: (e) => { if (e.target === this._skinsEl) this.closeSkins() } },
    }, [h('div', { className: 'qf-themes__panel qf-skins__panel', ref: (e) => (this._refs.skinsPanel = e) })])
    this._el.appendChild(this._skinsEl)
    this._renderSkins()
  }
  closeSkins() {
    this._skinsEl?.remove()
    this._skinsEl = null
    this.refresh()
  }

  _renderSkins() {
    const panel = this._refs.skinsPanel
    if (!panel) return
    const skins = this.scene.uiListRoomSkins?.() || []
    const current = this.scene.uiCurrentRoomSkin?.()
    const st = this.scene.uiGetState?.() || {}
    const roomName = st.activeRoom?.name || '(no room)'
    const curThumb = current ? (skins.find((s) => s.id === current)?.thumb) : null
    // Boss chamber: per-boss skin targets (Default + the 12 bosses).
    const targets = this.scene.uiSkinTargets?.()
    const curTarget = this.scene.uiSkinTarget?.() || 'default'
    const curTargetLabel = targets?.find((t) => t.key === curTarget)?.label || ''

    const dropzone = (() => {
      const zone = h('div', {
        className: 'qf-themes__drop',
        on: {
          click: () => this._uploadSkin(),
          dragover: (e) => { e.preventDefault(); zone.classList.add('drag') },
          dragleave: () => zone.classList.remove('drag'),
          drop: (e) => { e.preventDefault(); zone.classList.remove('drag'); this._uploadSkin([...(e.dataTransfer?.files || [])]) },
        },
      }, [
        h('div', { className: 'qf-themes__drop-icon' }, '⬆'),
        h('div', { className: 'qf-themes__drop-title' }, 'Drop an edited room PNG'),
        h('div', { className: 'qf-themes__drop-sub' }, 'or click to browse — adds it to the skin library below'),
        this._skinMsg ? h('div', { className: 'qf-themes__msg' }, this._skinMsg) : null,
      ])
      return zone
    })()

    mount(panel, [
      h('div', { className: 'qf-themes__head' }, [
        h('div', { className: 'qf-themes__title' }, '🎨 ROOM SKINS'),
        h('div', { className: 'qf-themes__theme-ctl' }, [
          h('span', { className: 'qf-skins__roomnote' }, `Editing room: ${roomName}`),
          targets ? h('span', { className: 'qf-skins__roomnote' }, '·  Boss:') : null,
          targets ? h('select', {
            className: 'qf-themes__theme-sel',
            on: { change: (e) => { this.scene.uiSetSkinTarget?.(e.target.value); this._renderSkins() } },
          }, targets.map((t) => h('option', { value: t.key, selected: t.key === curTarget }, t.label))) : null,
        ]),
        h('div', { className: 'qf-themes__head-right' }, [
          h('button', { className: 'qf-themes__close', title: 'Close', on: { click: () => this.closeSkins() } }, '✕'),
        ]),
      ]),
      h('div', { className: 'qf-themes__body' }, [
        h('div', { className: 'qf-themes__left' }, [
          dropzone,
          h('div', { className: 'qf-skins__current' }, [
            h('div', { className: 'qf-themes__subhead' }, targets ? `SKIN FOR: ${curTargetLabel}` : 'THIS ROOM'),
            h('div', { className: 'qf-skins__current-body' }, [
              curThumb ? h('img', { className: 'qf-skins__thumb', src: curThumb })
                       : h('div', { className: 'qf-skins__thumb q' }, current ? '?' : '—'),
              h('div', { className: 'qf-skins__current-info' }, [
                h('div', null, current ? `Skin: ${current}` : 'No skin (renders tiles)'),
                h('div', { className: 'qf-skins__btn-row' }, [
                  h('button', { className: 'btn sm', on: { click: () => this.scene.uiExportRoomPng?.() } }, '🖼 Export PNG'),
                  current ? h('button', { className: 'btn sm ghost', on: { click: () => { this.scene.uiClearRoomSkin?.(); this._renderSkins() } } }, 'Clear skin') : null,
                ]),
              ]),
            ]),
            h('div', { className: 'qf-skins__hint' },
              'Flow: Export PNG → edit the pixels in any image editor → drop it above → Apply. Doors & decor still draw on top, so leave their areas transparent.'),
          ]),
        ]),
        h('div', { className: 'qf-themes__right' }, [
          h('div', { className: 'qf-themes__subhead' }, ['SKIN LIBRARY', h('span', { className: 'qf-themes__count' }, String(skins.length))]),
          skins.length === 0
            ? h('div', { className: 'qf-themes__empty' }, 'No skins yet — drop an edited room PNG to add one.')
            : h('div', { className: 'qf-skins__grid' }, skins.map((s) => this._skinItem(s, current))),
        ]),
      ]),
      h('div', { className: 'qf-themes__foot' }, [
        h('span', { className: ['qf-themes__folder', st.folderName ? 'ok' : 'warn'] },
          st.folderName ? `📁 ${st.folderName}` : '📁 no folder — Save will prompt for it'),
        h('span', { className: 'qf-themes__dirty' }, ''),
        h('button', { className: 'btn', on: { click: () => this._saveSkins() } }, '⤓ Save skins + assignments'),
      ]),
    ])
  }

  _skinItem(s, current) {
    const active = s.id === current
    return h('div', { className: ['qf-skins__item', active && 'is-active'] }, [
      s.thumb ? h('img', { className: 'qf-skins__thumb', src: s.thumb })
              : h('div', { className: 'qf-skins__thumb q' }, '?'),
      h('div', { className: 'qf-skins__item-id', title: s.id }, s.id),
      h('div', { className: 'qf-skins__item-actions' }, [
        h('button', {
          className: 'btn sm', disabled: active,
          on: { click: () => { this.scene.uiApplyRoomSkin?.(s.id); this._renderSkins() } },
        }, active ? 'Applied' : 'Apply'),
        h('button', {
          className: 'qf-themes__del', title: 'Delete this skin from the library',
          on: { click: () => { if (window.confirm(`Delete skin “${s.id}”?`)) { this.scene.uiDeleteRoomSkin?.(s.id); this._renderSkins() } } },
        }, '🗑'),
      ]),
    ])
  }

  async _uploadSkin(files = null) {
    const r = await this.scene.uiUploadRoomSkin?.(files)
    this._skinMsg = r?.added ? `Added ${r.added} skin${r.added === 1 ? '' : 's'} — click Apply to use one.` : 'No PNG added.'
    this._renderSkins()
  }
  async _saveSkins() { await this.scene.uiSaveSkins?.(); this._renderSkins() }

  // Re-applied on Phaser scale resize (the scene calls this). The stage
  // transform is owned by stageScale; nothing per-overlay to recompute, but
  // the seam exists for future responsive tweaks.
  onResize() {}
}

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
const COLOR_TARGETS = [
  { key: 'walls', label: 'Walls', accent: '#e8c880' },
  { key: 'floor', label: 'Floor', accent: '#80c8e8' },
  { key: 'doors', label: 'Doors', accent: '#e8a0c0' },
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
  }

  // The right panel is rebuilt when the tab or room changes. The Colors tab is
  // special: rebuilding it mid-drag would yank focus off a slider, so once
  // built for a room it is NOT rebuilt on routine refreshes (zoom, flip, …) —
  // only on a room switch or an explicit force (the Reset buttons).
  _syncContext(s) {
    const host = this._refs.context
    if (!host) return
    // Rebuild only when the tab or room changes — routine refreshes (zoom,
    // flip, rotate, …) must NOT rebuild, or they'd reset the sprite-grid
    // scroll / yank slider focus. Interactive controls inside the panel
    // self-update their active state on click instead.
    if (this._ctxTab === s.tab && this._ctxRoom === s.activeRoomId) return
    this._ctxTab = s.tab
    this._ctxRoom = s.activeRoomId
    this._buildContext(s)
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
      h('select', {
        className: 'qf-redit__select',
        ref: (el) => { el.value = value },
        on: { change: (e) => this.scene.uiSetTheme?.(field, e.target.value || null) },
      }, [
        h('option', { value: '' }, noneLabel),
        ...themes.map((t) => h('option', { value: t }, t)),
      ]),
    ])
  }

  _spriteGrid(items, activeId, onPick, emptyMsg) {
    if (!items.length) return h('div', { className: 'qf-redit__ctx-empty' }, emptyMsg)
    return h('div', { className: 'qf-redit__sprite-grid' }, items.map((it) =>
      h('button', {
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
        h('button', {
          className: 'qf-redit__link-btn',
          title: 'Clear every per-cell override on this room',
          on: { click: () => this.scene.uiClearOverrides?.() },
        }, 'Clear all'),
      ]),
      this._spriteGrid(sprites, active, (id) => this.scene.uiPickSprite?.(id),
        '(no sprites yet — add PNGs in the Tileset Editor)'),
    ]
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
        this._themeSelect('Door theme', 'doorTheme', '(default)'),
      ]),
      h('div', { className: 'qf-redit__subhead' }, [h('span', null, 'DOOR BRUSH')]),
      this._spriteGrid(sprites, active, (id) => this.scene.uiPickSprite?.(id),
        '(no sprites yet — add PNGs in the Tileset Editor)'),
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
        'No decor sprites yet — upload a PNG to begin.'),
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

  // Re-applied on Phaser scale resize (the scene calls this). The stage
  // transform is owned by stageScale; nothing per-overlay to recompute, but
  // the seam exists for future responsive tweaks.
  onResize() {}
}

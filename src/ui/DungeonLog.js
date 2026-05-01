// Phase 31C — Dungeon Log (renamed from Combat Log).
//
// Panel-style scrolling event log for the HUD right column. Always visible.
// Event-coded rows: kill (green), dmg (red), warn (orange), know (cyan),
// info (default ink). Each row is `[HH:MM]  {text}` with a 2px coloured
// left bar.
//
// Subscribes to the same event-bus as the old transient CombatLog, but
// renders into a fixed panel rather than a fading stack.

import { EventBus }                 from '../systems/EventBus.js'
import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel } from './UIKit.js'

const HEADER_H        = 22
// Press Start 2P at 7px renders ~11-12px tall (font metrics include extra
// line space). 16 px row + 2 px gap clears it and matches the design's
// dense-log feel.
const ROW_H           = 16
const ROW_PAD_X       = 8
const ROW_GAP         = 2
const PADDING         = 8
const MAX_ROWS        = 64        // ring-buffer cap; UI shows the visible slice
const ROW_BORDER_W    = 2

const COLOR_FOR = {
  kill: CRYPT.greenCss,
  dmg:  CRYPT.accent2Css,
  warn: CRYPT.warnCss,
  know: CRYPT.soulCss,
  info: CRYPT.ink,
}

export class DungeonLog {
  constructor(scene, gameState, opts = {}) {
    this._scene     = scene
    this._gameState = gameState
    this._depth     = opts.depth ?? 60
    this._x         = opts.x ?? (scene.uiW ?? 1280) - 250 - 12
    this._y         = opts.y ?? 240
    this._w         = opts.w ?? 250
    this._h         = opts.h ?? ((scene.uiH ?? 720) - this._y - 56 - 12)
    this._objects   = []
    this._rows      = []        // ring buffer: { text, type, t }
    this._rowObjects = []       // current rendered row Phaser objects
    this._listeners = []

    this._build()
    this._wire()
  }

  _build() {
    const D = this._depth
    const x = this._x
    const y = this._y
    const w = this._w
    const h = this._h

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

    const dia = this._scene.add.text(x + PADDING, y + HEADER_H / 2 + 2, '◆', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.accent2Css,
    }).setOrigin(0, 0.5).setDepth(D + 2)
    this._objects.push(dia)
    const hdr = this._scene.add.text(x + PADDING + 14, y + HEADER_H / 2 + 2,
      'DUNGEON LOG', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(D + 2)
    this._objects.push(hdr)

    const live = this._scene.add.text(x + w - PADDING, y + HEADER_H / 2 + 2,
      'LIVE', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setOrigin(1, 0.5).setDepth(D + 2)
    this._objects.push(live)

    // Compute visible row count
    const innerH = h - HEADER_H - PADDING * 2
    this._maxVisible = Math.max(1, Math.floor(innerH / (ROW_H + ROW_GAP)))
  }

  _wire() {
    const on = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }

    on('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
      this._add(`${adventurer.name} (${adventurer.classId}) enters.`, 'info')
    })
    on('TRAP_TRIGGERED', ({ def, adventurer, damage }) => {
      this._add(`${this._short(adventurer)} sprung ${def?.name ?? 'trap'} (${damage ?? 0} dmg).`, 'dmg')
    })
    on('ADVENTURER_DIED', ({ adventurer, killerName }) => {
      this._add(`${killerName ?? 'Something'} killed ${adventurer.name}.`, 'kill')
    })
    on('ADVENTURER_FLED', ({ adventurer, reason }) => {
      this._add(`${adventurer.name} fled (${reason ?? 'unknown'}).`, 'warn')
    })
    on('MINION_DIED', ({ minion }) => {
      this._add(`${this._minionName(minion)} fell.`, 'dmg')
    })
    on('ABILITY_TRIGGERED', ({ message }) => {
      if (message) this._add(`✦ ${message}`, 'know')
    })
    on('PACT_SEALED', ({ mechanicId, rarity }) => {
      this._add(`Pact sealed: ${mechanicId} (${rarity}).`, 'know')
    })
    on('DAY_PHASE_BEGAN', () => this._add('Day phase begins.', 'info'))
    on('DAY_PHASE_ENDED', () => this._add('Day phase ends.', 'info'))
    on('NIGHT_PHASE_BEGAN', () => this._add('Night phase begins — build undisturbed.', 'info'))
  }

  _short(adv) {
    return adv?.name?.split(' ')[0] ?? adv?.classId ?? 'someone'
  }

  _minionName(m) {
    if (!m) return 'minion'
    if (m.name) return m.name
    const def = this._scene.cache.json.get('minionTypes')?.find(d => d.id === m.definitionId)
    return def?.name ?? m.definitionId ?? 'minion'
  }

  _add(text, type = 'info') {
    const now = this._scene.time?.now ?? Date.now()
    const day = this._gameState.meta?.dayNumber ?? 1
    // Game-time clock isn't a thing yet — encode the day instead so old rows
    // show "D7" prefix. Once a 24h in-game clock lands the prefix can swap.
    this._rows.push({ text, type, t: `D${day}`, addedAt: now })
    if (this._rows.length > MAX_ROWS) this._rows.shift()
    this._render()
  }

  _render() {
    // Clear current row objects
    this._rowObjects.forEach(o => o?.destroy?.())
    this._rowObjects = []

    const D = this._depth
    const startX = this._x + PADDING
    const startY = this._y + HEADER_H + PADDING
    const innerW = this._w - PADDING * 2

    // Body fills the full inside width (no day prefix) and wraps onto
    // additional lines when the text is too long instead of getting cut
    // off with an ellipsis. Each row's height grows with its line count
    // and rows below it shift down accordingly.
    const bodyX     = startX + ROW_BORDER_W + 6
    const bodyMaxPx = (this._x + this._w - PADDING - 4) - bodyX
    const lineH     = 11    // per-line height for 7px Press Start 2P + 2px lineSpacing

    // Walk newest -> oldest, stopping once we run out of vertical space.
    const allRows = [...this._rows].reverse()
    let cursorY = (this._y + this._h - PADDING)
    const minY  = startY
    for (const r of allRows) {
      // Probe text height by creating it with wordWrap, then position it
      // bottom-aligned. Skip rows that no longer fit above the panel top.
      const body = this._scene.add.text(bodyX, 0, r.text, {
        fontFamily: FONT_BODY, fontSize: '7px',
        color: COLOR_FOR[r.type] ?? COLOR_FOR.info,
        letterSpacing: 1,
        lineSpacing: 2,
        wordWrap: { width: bodyMaxPx, useAdvancedWrap: true },
      }).setOrigin(0, 1).setDepth(D + 3)
      const blockH = Math.max(lineH, body.height)
      const ry     = cursorY - blockH
      if (ry < minY) {
        body.destroy()
        break
      }
      body.setY(cursorY)
      this._rowObjects.push(body)

      // Type-coded left border
      const border = this._scene.add.graphics().setDepth(D + 2)
      border.fillStyle(this._colorHex(r.type), 1)
      border.fillRect(startX, ry, ROW_BORDER_W, blockH - 2)
      this._rowObjects.push(border)

      cursorY -= blockH + ROW_GAP
    }
  }

  _colorHex(type) {
    const css = COLOR_FOR[type] ?? COLOR_FOR.info
    if (css === CRYPT.ink) return CRYPT.inkHex
    return parseInt(css.slice(1), 16)
  }

  _truncate(s, n) {
    s = String(s ?? '')
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }

  // No per-frame work — rendering is event-driven.
  update() {}

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._rowObjects.forEach(o => o?.destroy?.())
    this._rowObjects = []
    this._objects.forEach(o => o?.destroy?.())
    this._objects = []
  }
}

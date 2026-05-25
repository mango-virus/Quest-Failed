// SUPERSEDED (Phase 34) — replaced by the dungeon-log strip inside
// `src/hud/RightPanels.js`. Phaser fallback under `?newhud=0`.
//
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
import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelDiamond } from './UIKit.js'
import { classLabel, pactLabel }    from '../util/displayNames.js'
import { fleeReasonFlavor }         from '../util/fleeFlavor.js'

const HEADER_H        = 22
// Press Start 2P at 7px renders ~11-12px tall (font metrics include extra
// line space). Bumped row gap so consecutive entries breathe — the dense
// version was visually smashed.
const ROW_H           = 16
const ROW_PAD_X       = 8
const ROW_GAP         = 6
const PADDING         = 8
const MAX_ROWS        = 50        // ring-buffer cap; UI shows the visible slice
const ROW_BORDER_W    = 2

// Per-event colour scheme. Goal: a glance at the log tells the player
// whether a row is good (green tones), bad (reds), neutral (cyans), or
// worth ignoring (muted ink). Categories are split so similar-meaning
// events don't all bleed into the same colour.
const COLOR_FOR = {
  kill:        CRYPT.greenCss,    // adventurer killed by you — good
  flee:        CRYPT.goldCss,     // adventurer fled — partial win
  trap:        CRYPT.warnCss,     // trap fired — orange action beat
  'minion-down': CRYPT.accent2Css, // minion died — bad
  arrival:     CRYPT.soulCss,     // adventurer enters dungeon
  ability:     '#a8e8e8',         // class ability triggered (lighter cyan)
  pact:        '#c64bff',         // pact sealed — bright purple
  phase:       CRYPT.inkMute,     // day/night transitions, dimmed
  info:        CRYPT.ink,         // generic fallback
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

    const dia = this._scene.add.graphics().setDepth(D + 2)
    pixelDiamond(dia, x + PADDING + 4, y + HEADER_H / 2 + 2, 4, CRYPT.accent)
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
      this._add(`${adventurer.name} (${classLabel(adventurer.classId)}) enters.`, 'arrival')
    })
    on('TRAP_TRIGGERED', ({ def, adventurer, damage }) => {
      this._add(`${this._short(adventurer)} sprung ${def?.name ?? 'trap'} (${damage ?? 0} dmg).`, 'trap')
    })
    on('ADVENTURER_DIED', ({ adventurer, killerName }) => {
      // Event-spawned monster waves (zombie horde, rival dungeon) carry
      // `_monster` — skip their deaths so a bulk wipe doesn't flood the log.
      if (adventurer?._monster) return
      this._add(`${killerName ?? 'Something'} killed ${adventurer.name}.`, 'kill')
    })
    // Flee flavor fires at the decision moment, not at dungeon exit.
    // ADVENTURER_FLED still emits for cleanup pipelines (knowledge
    // survivors, intel leaks), but the player-facing log line belongs
    // on the moment the AI commits to running — otherwise the message
    // shows up long after the player saw the adv start their flee.
    on('ADVENTURER_FLEE_DECIDED', ({ adventurer, reason, context }) => {
      this._add(fleeReasonFlavor(reason, adventurer.name, context), 'flee')
    })
    on('MINION_DIED', ({ minion }) => {
      this._add(`${this._minionName(minion)} fell.`, 'minion-down')
    })
    on('ABILITY_TRIGGERED', ({ message }) => {
      if (message) this._add(`✦ ${message}`, 'ability')
    })
    on('PACT_SEALED', ({ mechanicId, rarity }) => {
      this._add(`Pact sealed: ${pactLabel(mechanicId)} (${rarity}).`, 'pact')
    })
    on('DAY_PHASE_BEGAN', () => this._add('Day phase begins.', 'phase'))
    on('DAY_PHASE_ENDED', () => this._add('Day phase ends.', 'phase'))
    on('NIGHT_PHASE_BEGAN', () => this._add('Night phase begins — build undisturbed.', 'phase'))
  }

  _short(adv) {
    return adv?.name?.split(' ')[0] ?? (adv?.classId ? classLabel(adv.classId) : 'someone')
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

    // Top-down render: newest at the top, older below, oldest fall off
    // the bottom. Word-wraps multi-line — each row's height grows with
    // its line count.
    const bodyX     = startX + ROW_BORDER_W + 6
    const bodyMaxPx = (this._x + this._w - PADDING - 4) - bodyX
    const lineH     = 11

    const newest = [...this._rows].reverse()   // newest first
    let cursorY  = startY
    const maxY   = this._y + this._h - PADDING
    for (const r of newest) {
      const body = this._scene.add.text(bodyX, cursorY, r.text, {
        fontFamily: FONT_BODY, fontSize: '7px',
        color: COLOR_FOR[r.type] ?? COLOR_FOR.info,
        letterSpacing: 1,
        lineSpacing: 2,
        wordWrap: { width: bodyMaxPx, useAdvancedWrap: true },
      }).setOrigin(0, 0).setDepth(D + 3)
      const blockH = Math.max(lineH, body.height)
      if (cursorY + blockH > maxY) {
        body.destroy()
        break
      }
      this._rowObjects.push(body)

      // Type-coded left border, full row height
      const border = this._scene.add.graphics().setDepth(D + 2)
      border.fillStyle(this._colorHex(r.type), 1)
      border.fillRect(startX, cursorY, ROW_BORDER_W, blockH - 2)
      this._rowObjects.push(border)

      cursorY += blockH + ROW_GAP
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

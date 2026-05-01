// Phase 31C — bottom action bar.
//
// Composition (left to right):
//   [Rotate] [Move] [Sell]   — build-mode tools (wired in 31D)
//   [Roster]                 — opens Minion Roster popup (31E)
//   <flexible spacer with phase indicator label centered>
//   [Begin Day / End Wave]   — phase toggle (primary)
//   [Knowledge]              — opens Knowledge Map popup (31E)
//   [Adventurer Intel]       — opens Adventurer Intel popup (31E)
//   [Menu]                   — opens redesigned Pause Menu (31G)
//
// Buttons emit events via EventBus rather than calling handlers directly so
// HudScene stays a thin shell — NightPhase listens for build-tool events,
// DayPhase listens for end-wave, etc.

import { CRYPT, FONT_HEAD, pixelPanel, pixelButton } from './UIKit.js'
import { EventBus } from '../systems/EventBus.js'

const BAR_H        = 56
const BTN_H        = 36
const BTN_PAD      = 6
const TEXT_DEPTH   = 12

export class ActionBar {
  constructor(scene, gameState, opts = {}) {
    this._scene     = scene
    this._gameState = gameState
    this._depth     = opts.depth ?? 60
    this._objects   = []
    this._buttons   = {}

    this._W = scene.uiW ?? 1280
    this._H = scene.uiH ?? 720

    this._build()
  }

  _build() {
    const W = this._W
    const H = this._H
    const D = this._depth
    const y = H - BAR_H

    // Background panel running full width
    const bg = this._scene.add.graphics().setDepth(D)
    pixelPanel(bg, 0, y, W, BAR_H)
    this._objects.push(bg)

    // Left cluster — build tools
    let x = 12
    const btnY = y + (BAR_H - BTN_H) / 2

    this._buttons.rotate = this._addButton('rotate', x, btnY, 88, 'ROTATE', {
      glyph: '↻', event: 'TOOL_ROTATE',
    })
    x += 88 + BTN_PAD

    this._buttons.move = this._addButton('move', x, btnY, 78, 'MOVE', {
      glyph: '◇', event: 'TOOL_MOVE',
    })
    x += 78 + BTN_PAD

    this._buttons.sell = this._addButton('sell', x, btnY, 78, 'SELL', {
      glyph: '✕', event: 'TOOL_SELL', danger: true,
    })
    x += 78 + BTN_PAD

    this._buttons.roster = this._addButton('roster', x, btnY, 88, 'ROSTER', {
      glyph: '☰', event: 'OPEN_MINION_ROSTER',
    })
    x += 88 + BTN_PAD

    // Right cluster — phase + popups, anchored from right
    let rx = W - 12
    rx -= 80
    this._buttons.menu = this._addButton('menu', rx, btnY, 80, 'MENU', {
      glyph: '≡', event: 'OPEN_PAUSE_MENU',
    })
    rx -= BTN_PAD + 138
    this._buttons.advIntel = this._addButton('advIntel', rx, btnY, 138, 'ADV INTEL', {
      glyph: '👁', event: 'OPEN_ADV_INTEL',
    })
    rx -= BTN_PAD + 110
    this._buttons.knowledge = this._addButton('knowledge', rx, btnY, 110, 'KNOWLEDGE', {
      glyph: '❖', event: 'OPEN_KNOWLEDGE_MAP',
    })
    rx -= BTN_PAD + 130
    this._buttons.phaseToggle = this._addButton('phaseToggle', rx, btnY, 130, this._phaseLabel(), {
      glyph: '⏵', event: 'PHASE_TOGGLE_REQUEST', primary: true,
    })

    // Center phase indicator (between left tools and right cluster)
    const cxLeft  = (12 + 88 + BTN_PAD + 78 + BTN_PAD + 78 + BTN_PAD + 88 + BTN_PAD)
    const cxRight = rx - BTN_PAD
    const cx = (cxLeft + cxRight) / 2
    this._phaseCaption = this._scene.add.text(cx, y + 18, 'PHASE', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setOrigin(0.5).setDepth(D + TEXT_DEPTH)
    this._objects.push(this._phaseCaption)

    this._phaseStatus = this._scene.add.text(cx, y + 32, this._phaseStatusText(), {
      fontFamily: FONT_HEAD, fontSize: '12px',
      color: this._gameState.meta?.phase === 'day' ? CRYPT.accent2Css : CRYPT.soulCss,
      letterSpacing: 1,
    }).setOrigin(0.5).setDepth(D + TEXT_DEPTH)
    this._objects.push(this._phaseStatus)
  }

  _addButton(key, x, y, w, label, opts = {}) {
    const D = this._depth + 5
    const btn = pixelButton(this._scene, x, y, w, BTN_H, label, {
      depth:    D,
      fontSize: 9,
      primary:  !!opts.primary,
      danger:   !!opts.danger,
      onClick:  () => EventBus.emit(opts.event ?? `ACTION_${key.toUpperCase()}`),
    })
    btn.label.setText('') // we draw glyph + label separately for tighter spacing

    const glyphT = this._scene.add.text(x + 12, y + BTN_H / 2, opts.glyph ?? '·', {
      fontFamily: FONT_HEAD, fontSize: '12px',
      color: opts.primary ? '#ffffff' : opts.danger ? CRYPT.accent2Css : CRYPT.accent2Css,
    }).setOrigin(0, 0.5).setDepth(D + 1)

    const labelT = this._scene.add.text(x + w / 2 + 8, y + BTN_H / 2, label, {
      fontFamily: FONT_HEAD, fontSize: '9px',
      color: opts.primary ? '#ffffff' : opts.danger ? CRYPT.accent2Css : CRYPT.ink,
      letterSpacing: 1,
    }).setOrigin(0.5).setDepth(D + 1)

    this._objects.push(btn.bg, btn.hit, glyphT, labelT)
    btn._extras = [glyphT, labelT]
    return btn
  }

  _phaseLabel() {
    const ph = this._gameState.meta?.phase ?? 'night'
    return ph === 'night' ? 'BEGIN DAY' : 'END WAVE'
  }

  _phaseStatusText() {
    const ph = this._gameState.meta?.phase ?? 'night'
    return ph === 'night' ? '◐ NIGHT — BUILD' : '☀ DAY — INVASION'
  }

  // Called every frame from HudScene.update (~60fps). Cheap reads.
  update() {
    if (!this._gameState) return
    if (this._phaseStatus) {
      this._phaseStatus.setText(this._phaseStatusText())
      const isDay = this._gameState.meta?.phase === 'day'
      this._phaseStatus.setColor(isDay ? CRYPT.accent2Css : CRYPT.soulCss)
    }
    if (this._buttons.phaseToggle) {
      const newLabel = this._phaseLabel()
      const extras   = this._buttons.phaseToggle._extras
      // Rewrite the action-label text (extras[1] is the label text)
      if (extras && extras[1] && extras[1].text !== newLabel) {
        extras[1].setText(newLabel)
      }
    }
  }

  destroy() {
    this._objects.forEach(o => o?.destroy?.())
    Object.values(this._buttons).forEach(b => b?.destroy?.())
    this._objects = []
    this._buttons = {}
  }
}

export const ACTION_BAR_HEIGHT = BAR_H

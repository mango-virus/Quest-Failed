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

    const btnY = y + (BAR_H - BTN_H) / 2
    const cx   = W / 2     // true screen center; phase indicator + clusters anchor here

    // Layout strategy (matches design): symmetric clusters around the center.
    // Left cluster grows leftward from `cx - centerGap`; right cluster grows
    // rightward from `cx + centerGap`. The phase indicator floats over the
    // gap.
    const centerGap = 110

    // ── Left cluster (build tools), right-anchored toward the center ──
    const leftDefs = [
      { key: 'rotate',  w: 86, label: 'ROTATE', glyph: '↻', event: 'TOOL_ROTATE' },
      { key: 'move',    w: 76, label: 'MOVE',   glyph: '◇', event: 'TOOL_MOVE'   },
      { key: 'sell',    w: 76, label: 'SELL',   glyph: '✕', event: 'TOOL_SELL', danger: true },
      { key: 'roster',  w: 86, label: 'ROSTER', glyph: '☰', event: 'OPEN_MINION_ROSTER' },
    ]
    const leftTotal = leftDefs.reduce((s, d) => s + d.w, 0) + BTN_PAD * (leftDefs.length - 1)
    let lx = cx - centerGap - leftTotal
    for (const d of leftDefs) {
      this._buttons[d.key] = this._addButton(d.key, lx, btnY, d.w, d.label, d)
      lx += d.w + BTN_PAD
    }

    // ── Right cluster, left-anchored from the center ──
    const rightDefs = [
      { key: 'phaseToggle', w: 130, label: this._phaseLabel(), glyph: '⏵', event: 'PHASE_TOGGLE_REQUEST', primary: true },
      { key: 'knowledge',   w: 100, label: 'KNOWLEDGE',        glyph: '❖', event: 'OPEN_KNOWLEDGE_MAP' },
      { key: 'advIntel',    w: 116, label: 'ADV INTEL',        glyph: '👁', event: 'OPEN_ADV_INTEL' },
      { key: 'menu',        w:  80, label: 'MENU',             glyph: '≡', event: 'OPEN_PAUSE_MENU' },
    ]
    let rx = cx + centerGap
    for (const d of rightDefs) {
      this._buttons[d.key] = this._addButton(d.key, rx, btnY, d.w, d.label, d)
      rx += d.w + BTN_PAD
    }

    // ── Center phase indicator ──
    this._phaseCaption = this._scene.add.text(cx, y + 18, 'PHASE', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setOrigin(0.5).setDepth(D + TEXT_DEPTH)
    this._objects.push(this._phaseCaption)

    this._phaseStatus = this._scene.add.text(cx, y + 36, this._phaseStatusText(), {
      fontFamily: FONT_HEAD, fontSize: '11px',
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

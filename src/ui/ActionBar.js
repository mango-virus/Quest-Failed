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

const BAR_H        = 76
const BTN_H        = 36
const BTN_PAD      = 4
const TEXT_DEPTH   = 12

// Day-phase speed cycle steps. Tap the primary action button while in
// day phase to cycle through these values; index 0 = 1x is the default.
const SPEED_STEPS = [1, 2, 4]

export class ActionBar {
  constructor(scene, gameState, opts = {}) {
    this._scene     = scene
    this._gameState = gameState
    this._depth     = opts.depth ?? 60
    this._objects   = []
    this._buttons   = {}

    this._W = scene.uiW ?? 1280
    this._H = scene.uiH ?? 720
    this._speedIdx = 0   // index into SPEED_STEPS, only used in day phase

    this._build()
  }

  _build() {
    const W = this._W
    const H = this._H
    const D = this._depth
    const y = H - BAR_H - 6     // 6 px bottom margin so the panel feels seated

    // Centered panel — full width was too sparse with 8 buttons + a phase
    // pill. The design's bar is condensed: a single wide pixel panel
    // hugging the cluster.
    const panelW = Math.min(W - 24, 1020)
    const panelX = (W - panelW) / 2
    this._panelX = panelX
    this._panelW = panelW
    const bg = this._scene.add.graphics().setDepth(D)
    pixelPanel(bg, panelX, y, panelW, BAR_H)
    this._objects.push(bg)

    const btnY = y + (BAR_H - BTN_H) / 2
    const cx   = W / 2     // true screen center; phase indicator + clusters anchor here

    // Layout strategy (matches design): symmetric clusters around the center.
    // Left cluster grows leftward from `cx - centerGap`; right cluster grows
    // rightward from `cx + centerGap`. The phase indicator floats over the
    // gap.
    const centerGap = 90

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
    // The primary slot is adaptive: night phase => BEGIN DAY (advances
    // to day), day phase => SPEED cycle (1x → 2x → 4x → 1x). END WAVE
    // is gone — day ends automatically when no adventurers remain.
    const rightDefs = [
      // Primary button — onPrimary delegates to a method that branches on
      // phase, so the same button does BEGIN DAY at night and time-scale
      // cycle during day.
      { key: 'phaseToggle', w: 124, label: this._primaryLabel(), glyph: this._primaryGlyph(), onPrimary: true, primary: true },
      { key: 'knowledge',   w:  98, label: 'KNOWLEDGE', glyph: '❖', event: 'OPEN_KNOWLEDGE_MAP' },
      { key: 'advIntel',    w: 110, label: 'ADV INTEL', glyph: '👁', event: 'OPEN_ADV_INTEL' },
      { key: 'menu',        w:  74, label: 'MENU',      glyph: '≡', event: 'OPEN_PAUSE_MENU' },
    ]
    let rx = cx + centerGap
    for (const d of rightDefs) {
      this._buttons[d.key] = this._addButton(d.key, rx, btnY, d.w, d.label, d)
      rx += d.w + BTN_PAD
    }

    // ── Center phase indicator (vertical stack matching the design) ──
    // Caption "PHASE" up top, then a 4-line stacked body with the moon /
    // phase name / em-dash / build-or-invasion mode.
    this._phaseCaption = this._scene.add.text(cx, y + 8, 'PHASE', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setOrigin(0.5, 0).setDepth(D + TEXT_DEPTH)
    this._objects.push(this._phaseCaption)

    this._phaseStatus = this._scene.add.text(cx, y + 22, this._phaseStatusText(), {
      fontFamily: FONT_HEAD, fontSize: '9px',
      color: this._gameState.meta?.phase === 'day' ? CRYPT.accent2Css : CRYPT.soulCss,
      letterSpacing: 1,
      align: 'center',
      lineSpacing: 4,
    }).setOrigin(0.5, 0).setDepth(D + TEXT_DEPTH)
    this._objects.push(this._phaseStatus)
  }

  _addButton(key, x, y, w, label, opts = {}) {
    const D = this._depth + 5
    const onClick = opts.onPrimary
      ? () => this._onPrimaryClick()
      : () => EventBus.emit(opts.event ?? `ACTION_${key.toUpperCase()}`)
    const btn = pixelButton(this._scene, x, y, w, BTN_H, label, {
      depth:    D,
      fontSize: 9,
      primary:  !!opts.primary,
      danger:   !!opts.danger,
      onClick,
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

  _speedLabel() {
    return `${SPEED_STEPS[this._speedIdx]}× SPEED`
  }

  _primaryLabel() {
    const ph = this._gameState.meta?.phase ?? 'night'
    return ph === 'night' ? 'BEGIN DAY' : this._speedLabel()
  }

  _primaryGlyph() {
    const ph = this._gameState.meta?.phase ?? 'night'
    return ph === 'night' ? '⏵' : '»'
  }

  _onPrimaryClick() {
    const ph = this._gameState.meta?.phase ?? 'night'
    if (ph === 'night') {
      // Night → day transition. NightPhase listens.
      EventBus.emit('PHASE_TOGGLE_REQUEST')
    } else {
      // Day phase: cycle through 1× / 2× / 4× speed. DayPhase listens for
      // TIME_SCALE_SET and applies. End-of-day is auto-triggered when no
      // adventurers remain — there is no manual end-wave button.
      this._speedIdx = (this._speedIdx + 1) % SPEED_STEPS.length
      EventBus.emit('TIME_SCALE_SET', { scale: SPEED_STEPS[this._speedIdx] })
    }
  }

  _phaseStatusText() {
    const ph = this._gameState.meta?.phase ?? 'night'
    if (ph === 'night') return '◐\nNIGHT\n—\nBUILD'
    return '☀\nDAY\n—\nINVASION'
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
      const extras   = this._buttons.phaseToggle._extras
      const newLabel = this._primaryLabel()
      const newGlyph = this._primaryGlyph()
      // extras[0] = glyph, extras[1] = label (per _addButton ordering)
      if (extras && extras[0] && extras[0].text !== newGlyph) extras[0].setText(newGlyph)
      if (extras && extras[1] && extras[1].text !== newLabel) extras[1].setText(newLabel)
    }
  }

  destroy() {
    this._objects.forEach(o => o?.destroy?.())
    Object.values(this._buttons).forEach(b => b?.destroy?.())
    this._objects = []
    this._buttons = {}
  }
}

// Includes the 6-px bottom margin so HudScene reserves the right space.
export const ACTION_BAR_HEIGHT = BAR_H + 6

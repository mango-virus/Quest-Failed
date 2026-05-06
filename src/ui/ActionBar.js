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
const SPEED_STEPS = [1, 2, 4, 8]

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
    this._wireResetEvents()
  }

  // Reset to 1× speed whenever a day ends so the next day starts normal.
  _wireResetEvents() {
    this._listeners = []
    const on = (event, fn) => {
      EventBus.on(event, fn, this)
      this._listeners.push([event, fn])
    }
    on('DAY_PHASE_ENDED',   () => { this._speedIdx = 0 })
    // Clear the armed tool when transitioning to day phase so the ring
    // doesn't persist across phases (NightPhase._beginDay also clears
    // its toolMode; this just keeps the visual in sync).
    on('DAY_PHASE_BEGAN',   () => this._setArmedTool(null))
    on('NIGHT_PHASE_BEGAN', () => { this._speedIdx = 0; this._setArmedTool(null) })
    on('TOOL_MODE_CHANGED', ({ mode }) => this._setArmedTool(mode))
  }

  // Phase 31D — visual feedback for the armed action-bar tool. Adds a
  // bright accent border to the active tool button so the player can see
  // which mode they're in. Only one tool is armed at a time.
  _setArmedTool(mode) {
    this._armedTool = mode
    // Only MOVE / SELL are arm-able tools; the rest are one-shot actions.
    const accentH = ['move', 'sell'].reduce((acc, k) => {
      const btn = this._buttons[k]
      if (!btn) return acc
      const isArmed = (k === mode)
      // Toggle visibility of the armed accent ring (drawn on top of the
      // button's own bevel).
      if (isArmed && !btn._armedRing) {
        const ring = this._scene.add.graphics().setDepth(this._depth + 8)
        ring.lineStyle(2, CRYPT.accent2, 1)
        ring.strokeRect(btn.hit.x - 1, btn.hit.y - 1, btn.hit.width + 2, btn.hit.height + 2)
        ring.lineStyle(1, CRYPT.accent, 1)
        ring.strokeRect(btn.hit.x - 3, btn.hit.y - 3, btn.hit.width + 6, btn.hit.height + 6)
        btn._armedRing = ring
        this._objects.push(ring)
      } else if (!isArmed && btn._armedRing) {
        btn._armedRing.destroy()
        btn._armedRing = null
      }
      return acc
    }, null)
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

    // Layout strategy: equal padding from the panel edges so the cluster
    // looks balanced inside the bar. Left cluster anchored to panel-left
    // + sideMargin; right cluster anchored to panel-right - sideMargin.
    // The phase indicator floats in whatever gap remains.
    const sideMargin = 24

    // Phase 31D — Rotate dropped from the action bar; rotation now happens
    // via the R key while a room is held in MOVE mode (or during initial
    // placement from the build menu).
    const leftDefs = [
      { key: 'move',    w: 86, label: 'MOVE',   event: 'TOOL_MOVE'   },
      { key: 'sell',    w: 86, label: 'SELL',   event: 'TOOL_SELL', danger: true },
      { key: 'roster',  w: 96, label: 'ROSTER', event: 'OPEN_MINION_ROSTER' },
    ]
    const rightDefs = [
      // Primary button — onPrimary delegates to a method that branches on
      // phase: BEGIN DAY at night, speed cycle during day.
      { key: 'phaseToggle', w: 124, label: this._primaryLabel(), onPrimary: true, primary: true },
      { key: 'knowledge',   w:  98, label: 'KNOWLEDGE', event: 'OPEN_KNOWLEDGE_MAP' },
      { key: 'advIntel',    w: 110, label: 'ADV INTEL', event: 'OPEN_ADV_INTEL' },
      { key: 'menu',        w:  74, label: 'MENU',      event: 'OPEN_PAUSE_MENU' },
    ]
    const leftTotal  = leftDefs.reduce((s, d) => s + d.w, 0)  + BTN_PAD * (leftDefs.length - 1)
    const rightTotal = rightDefs.reduce((s, d) => s + d.w, 0) + BTN_PAD * (rightDefs.length - 1)

    // Left cluster — placed at panel-left + sideMargin
    let lx = this._panelX + sideMargin
    for (const d of leftDefs) {
      this._buttons[d.key] = this._addButton(d.key, lx, btnY, d.w, d.label, d)
      lx += d.w + BTN_PAD
    }
    const leftClusterEnd = this._panelX + sideMargin + leftTotal

    // Right cluster — anchored at panel-right - sideMargin
    const rightClusterStart = this._panelX + this._panelW - sideMargin - rightTotal
    let rx = rightClusterStart
    for (const d of rightDefs) {
      this._buttons[d.key] = this._addButton(d.key, rx, btnY, d.w, d.label, d)
      rx += d.w + BTN_PAD
    }

    // Phase indicator floats in the middle of the gap between the clusters.
    const phaseX = Math.round((leftClusterEnd + rightClusterStart) / 2)

    this._phaseCaption = this._scene.add.text(phaseX, y + 8, 'PHASE', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setOrigin(0.5, 0).setDepth(D + TEXT_DEPTH)
    this._objects.push(this._phaseCaption)

    this._phaseStatus = this._scene.add.text(phaseX, y + 22, this._phaseStatusText(), {
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
    btn.label.setText('') // we draw the label ourselves so it stays in sync
                          // with phase/speed updates without recreating the
                          // whole button.

    // No glyph — Press Start 2P doesn't carry the unicode arrows / eyes /
    // crystals the design used, so they were rendering in a fallback font
    // at the wrong baseline. Just a centered label keeps it clean.
    const labelT = this._scene.add.text(x + w / 2, y + BTN_H / 2, label, {
      fontFamily: FONT_HEAD, fontSize: '9px',
      color: opts.primary ? '#ffffff' : opts.danger ? CRYPT.accent2Css : CRYPT.ink,
      letterSpacing: 1,
    }).setOrigin(0.5).setDepth(D + 1)

    this._objects.push(btn.bg, btn.hit, labelT)
    // Keep the array shape compatible with update() — extras[1] is the
    // label that gets text-swapped when the phase or speed changes.
    btn._extras = [null, labelT]
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
      // extras[1] = label text (extras[0] reserved for glyph, no longer used)
      if (extras && extras[1] && extras[1].text !== newLabel) extras[1].setText(newLabel)
    }
  }

  destroy() {
    if (this._listeners) {
      for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
      this._listeners = []
    }
    this._objects.forEach(o => o?.destroy?.())
    Object.values(this._buttons).forEach(b => b?.destroy?.())
    this._objects = []
    this._buttons = {}
  }
}

// Includes the 6-px bottom margin so HudScene reserves the right space.
export const ACTION_BAR_HEIGHT = BAR_H + 6

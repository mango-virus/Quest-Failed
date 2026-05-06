// Phase 31G — Pause Menu, redesigned in the Crypt visual system.
//
// Same screen state machine as before (root | settings | howto). PauseManager
// pauses every gameplay scene when this opens, so timers / animations / AI
// freeze behind the panel. ESC steps back: sub-screen → root → close.

import {
  CRYPT, FONT_HEAD, FONT_BODY,
  pixelPanel, pixelButton, pixelDiamond, applyUiCamera,
} from '../ui/UIKit.js'
import { AudioControls, AUDIO_CONTROLS_HEIGHT } from '../ui/AudioControls.js'
import { PauseManager }                      from '../systems/PauseManager.js'

const PANEL_W   = 380
const PANEL_H   = 360
const TITLE_H   = 30
const PADDING   = 16
const BTN_W     = 320
const BTN_H     = 38
const BTN_GAP   = 8

export class PauseMenu extends Phaser.Scene {
  constructor() {
    super('PauseMenu')
    this._gameState = null
    this._screen    = 'root'
    this._objects   = []
    this._buttons   = []
    this._audio     = null
  }

  init(data) {
    this._gameState = data?.gameState ?? null
    this._screen    = 'root'
  }

  create() {
    applyUiCamera(this)
    const W = this.uiW
    const H = this.uiH

    // Dim backdrop — non-interactive so the AudioControls slider still
    // receives clicks (PauseManager already pauses the gameplay scenes,
    // so clicks can't fall through to anything below).
    this._dim = this.add.rectangle(0, 0, W, H, 0x000000, 0.78)
      .setOrigin(0).setDepth(0)

    // Centered pixel panel
    const px = Math.round((W - PANEL_W) / 2)
    const py = Math.round((H - PANEL_H) / 2)
    this._panelX = px
    this._panelY = py

    const frameG = this.add.graphics().setDepth(1)
    pixelPanel(frameG, px, py, PANEL_W, PANEL_H)

    // Title bar strip with diamond + label
    const titleG = this.add.graphics().setDepth(2)
    titleG.fillStyle(CRYPT.panel2, 1)
    titleG.fillRect(px + 2, py + 2, PANEL_W - 4, TITLE_H)
    titleG.fillStyle(CRYPT.panelEdgeS, 1)
    titleG.fillRect(px + 2, py + 2 + TITLE_H, PANEL_W - 4, 1)

    const dia = this.add.graphics().setDepth(3)
    pixelDiamond(dia, px + PADDING, py + 2 + TITLE_H / 2, 4, CRYPT.accent)

    this._titleT = this.add.text(px + PADDING + 14, py + 2 + TITLE_H / 2, '', {
      fontFamily: FONT_HEAD, fontSize: '12px', color: CRYPT.ink, letterSpacing: 3,
    }).setOrigin(0, 0.5).setDepth(3)

    this._objects.push(this._dim, frameG, titleG, dia, this._titleT)

    this._renderScreen()

    // ESC steps back: sub-screen → root → close pause.
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._screen !== 'root') this._setScreen('root')
      else                          PauseManager.close()
    })

    this.scale.on('resize', this._onResize, this)
    this.events.once('shutdown', () => {
      this.scale.off('resize', this._onResize, this)
      this._clearScreen()
      this._objects.forEach(o => o?.destroy?.())
      this._objects = []
    })
  }

  _onResize() {
    if (!this._dim) return
    applyUiCamera(this)
    const W = this.uiW, H = this.uiH
    this._dim.setSize(W, H)
    // Recompute panel anchor + redraw everything for the new viewport.
    this._panelX = Math.round((W - PANEL_W) / 2)
    this._panelY = Math.round((H - PANEL_H) / 2)
    // Lazy: shutdown + reboot the panel chrome.
    this._objects.forEach(o => o?.destroy?.())
    this._objects = []
    this.create()
  }

  _setScreen(name) {
    this._screen = name
    this._renderScreen()
  }

  _clearScreen() {
    if (this._audio) { this._audio.destroy(); this._audio = null }
    this._buttons.forEach(b => b?.destroy?.())
    this._buttons = []
    if (this._screenObjects) {
      this._screenObjects.forEach(o => o?.destroy?.())
    }
    this._screenObjects = []
  }

  _renderScreen() {
    this._clearScreen()
    if      (this._screen === 'root')     this._renderRoot()
    else if (this._screen === 'settings') this._renderSettings()
    else if (this._screen === 'howto')    this._renderHowTo()
  }

  // ── Root menu ─────────────────────────────────────────────────────────────
  _renderRoot() {
    this._titleT.setText('PAUSED')

    const items = [
      { label: 'RESUME',              onClick: () => PauseManager.close(), primary: true },
      { label: 'SETTINGS',            onClick: () => this._setScreen('settings') },
      { label: 'HOW TO PLAY',         onClick: () => this._setScreen('howto') },
      { label: 'SAVE & EXIT TO MENU', onClick: () => PauseManager.saveAndExitToMenu(this._gameState), danger: true },
    ]

    const totalH = items.length * BTN_H + (items.length - 1) * BTN_GAP
    const px = this._panelX
    const py = this._panelY
    let y = py + TITLE_H + 60 + 0    // start below title with breathing room
    // Actually center vertically within the remaining panel space.
    const innerTop = py + TITLE_H + PADDING
    const innerH   = PANEL_H - TITLE_H - PADDING * 2
    y = innerTop + Math.round((innerH - totalH) / 2)

    for (const item of items) {
      const x = px + (PANEL_W - BTN_W) / 2
      const btn = pixelButton(this, x, y, BTN_W, BTN_H, item.label, {
        depth: 4, fontSize: 11,
        primary: !!item.primary,
        danger:  !!item.danger,
        onClick: item.onClick,
      })
      this._buttons.push(btn)
      y += BTN_H + BTN_GAP
    }
  }

  // ── Settings sub-screen ───────────────────────────────────────────────────
  _renderSettings() {
    this._titleT.setText('SETTINGS')

    const px = this._panelX
    const py = this._panelY
    const innerX = px + PADDING
    const innerW = PANEL_W - PADDING * 2

    // Volume label
    let yy = py + TITLE_H + 28
    this._screenObjects.push(this.add.text(innerX, yy, 'VOLUME', {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.inkMute, letterSpacing: 3,
    }).setDepth(4))
    yy += 18

    // Audio controls — two-row music + SFX widget.
    this._audio = new AudioControls(this, innerX, yy, { depth: 5, w: innerW })
    yy += AUDIO_CONTROLS_HEIGHT + 8

    // Fullscreen toggle row
    yy += 16
    this._screenObjects.push(this.add.text(innerX, yy, 'FULLSCREEN', {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.inkMute, letterSpacing: 3,
    }).setDepth(4))
    yy += 18
    const isFs = this.scale.isFullscreen
    const fsBtn = pixelButton(this, innerX, yy, 140, 32, isFs ? 'ON' : 'OFF', {
      depth: 5, fontSize: 10,
      primary: isFs,
      onClick: () => {
        if (this.scale.isFullscreen) this.scale.stopFullscreen()
        else                          this.scale.startFullscreen()
        // Re-render so the button label updates after the async transition.
        setTimeout(() => this._setScreen('settings'), 0)
      },
    })
    this._buttons.push(fsBtn)

    // Tutorials toggle row — flips meta.tutorialEnabled. Off-by-default
    // is fine; flipping ON re-arms hints for unseen events going forward.
    // (Already-seen flags persist, so re-enabling won't replay old hints.)
    yy += 50
    this._screenObjects.push(this.add.text(innerX, yy, 'TUTORIAL HINTS', {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.inkMute, letterSpacing: 3,
    }).setDepth(4))
    yy += 18
    const tutOn = !!this._gameState?.meta?.tutorialEnabled
    const tutBtn = pixelButton(this, innerX, yy, 140, 32, tutOn ? 'ON' : 'OFF', {
      depth: 5, fontSize: 10,
      primary: tutOn,
      onClick: () => {
        if (!this._gameState) return
        this._gameState.meta ??= {}
        this._gameState.meta.tutorialEnabled = !this._gameState.meta.tutorialEnabled
        this._setScreen('settings')
      },
    })
    this._buttons.push(tutBtn)
    // Tiny help line on the right side of the row explaining what this does
    this._screenObjects.push(this.add.text(innerX + 150, yy + 9,
      'One-shot how-to popups\nas you encounter mechanics.', {
      fontFamily: FONT_BODY, fontSize: '7px', color: CRYPT.inkDim, letterSpacing: 0,
      lineSpacing: 2,
    }).setDepth(4))

    // Back button at the bottom
    const backY = py + PANEL_H - PADDING - BTN_H
    const backX = px + (PANEL_W - 200) / 2
    this._buttons.push(pixelButton(this, backX, backY, 200, BTN_H, 'BACK', {
      depth: 5, fontSize: 11,
      onClick: () => this._setScreen('root'),
    }))
  }

  // ── How to Play sub-screen ────────────────────────────────────────────────
  _renderHowTo() {
    this._titleT.setText('HOW TO PLAY')

    const px = this._panelX
    const py = this._panelY
    const innerX = px + PADDING
    const innerW = PANEL_W - PADDING * 2

    // Compact reference card — the long version lived elsewhere; here we
    // just want a cheat-sheet that fits in the tightened panel.
    const body =
      'OBJECTIVE  Build a deadly dungeon. Survive the raids.\n\n' +
      'CURRENCIES\n' +
      '  Gold       Spent at night on rooms / traps / minions.\n' +
      '  Dark Power Long-term resource for unlocks.\n\n' +
      'CYCLE\n' +
      '  Night  Build undisturbed. Click BEGIN DAY when ready.\n' +
      '  Day    Adventurers raid; watch and adapt.\n\n' +
      'BOSS FIGHT  Survivors who reach you trigger a duel.\n' +
      'KNOWLEDGE   Open the Knowledge Map to see what they know.'

    const txt = this.add.text(innerX, py + TITLE_H + 14, body, {
      fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
      lineSpacing: 3, wordWrap: { width: innerW, useAdvancedWrap: true },
    }).setDepth(4)
    this._screenObjects.push(txt)

    const backY = py + PANEL_H - PADDING - BTN_H
    const backX = px + (PANEL_W - 200) / 2
    this._buttons.push(pixelButton(this, backX, backY, 200, BTN_H, 'BACK', {
      depth: 5, fontSize: 11,
      onClick: () => this._setScreen('root'),
    }))
  }
}

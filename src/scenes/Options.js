// Phase 31G — Options scene.
//
// Reachable from the MainMenu's OPTIONS button. Title-screen-style
// letterboxed layout with a centered pixel panel. Audio (master /
// music / sfx) via the existing AudioControls widget; Fullscreen
// toggle; placeholder Graphics + Keyboard reference sections.
// Returns to MainMenu via Back / Esc.

import {
  CRYPT, FONT_HEAD, FONT_BODY,
  pixelPanel, pixelButton, pixelDiamond,
} from '../ui/UIKit.js'
import { AudioControls, AUDIO_CONTROLS_HEIGHT } from '../ui/AudioControls.js'
import { TitleMusic }    from '../systems/TitleMusic.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { NameEntryPanel } from '../ui/NameEntryPanel.js'

// Same logical design size as MainMenu so the two screens letterbox the
// same way and the Crypt chrome stays consistent across navigation.
const W = 1280
const H = 720

const PANEL_W = 560
const PANEL_H = 380
const TITLE_H = 30
const PADDING = 18

export class Options extends Phaser.Scene {
  constructor() {
    super('Options')
    this._objects   = []
    this._buttons   = []
    this._audio     = null
    this._namePanel = null
  }

  create() {
    TitleMusic.ensurePlaying(this)
    this._setupCamera()
    this.time.delayedCall(0, () => this._setupCamera())
    this.scale.on('resize', this._setupCamera, this)
    this.events.once('shutdown', () => this.scale.off('resize', this._setupCamera, this))

    this._drawBackground()
    this._drawPanel()

    // Esc returns to title menu — ignored when name entry is open (panel handles it)
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._namePanel?.isOpen) return
      this._goBack()
    })
  }

  shutdown() {
    this._namePanel?.destroy(); this._namePanel = null
    this._audio?.destroy();     this._audio     = null
    this._buttons.forEach(b => b?.destroy?.())
    this._buttons = []
    this._objects.forEach(o => o?.destroy?.())
    this._objects = []
  }

  _setupCamera() {
    const sw = this.scale.width
    const sh = this.scale.height
    if (sw < 32 || sh < 32) return
    const sf = Math.min(sw / W, sh / H)
    const cam = this.cameras.main
    cam.setZoom(sf)
    const vw = W * sf
    const vh = H * sf
    cam.setViewport(Math.round((sw - vw) / 2), Math.round((sh - vh) / 2), vw, vh)
    cam.setScroll(0, 0)
    cam.setOrigin(0, 0)
    this.uiW = sw / sf
    this.uiH = sh / sf
  }

  _drawBackground() {
    // Solid void fill across whole design rect (and overscan for letterbox).
    const overscan = 2000
    const g = this.add.graphics().setDepth(0)
    g.fillStyle(CRYPT.bgDeep, 1)
    g.fillRect(-overscan, -overscan, W + overscan * 2, H + overscan * 2)
    this._objects.push(g)
  }

  _drawPanel() {
    const px = Math.round((W - PANEL_W) / 2)
    const py = Math.round((H - PANEL_H) / 2)

    // Frame
    const frameG = this.add.graphics().setDepth(1)
    pixelPanel(frameG, px, py, PANEL_W, PANEL_H)
    this._objects.push(frameG)

    // Title bar
    const titleG = this.add.graphics().setDepth(2)
    titleG.fillStyle(CRYPT.panel2, 1)
    titleG.fillRect(px + 2, py + 2, PANEL_W - 4, TITLE_H)
    titleG.fillStyle(CRYPT.panelEdgeS, 1)
    titleG.fillRect(px + 2, py + 2 + TITLE_H, PANEL_W - 4, 1)
    this._objects.push(titleG)

    const dia = this.add.graphics().setDepth(3)
    pixelDiamond(dia, px + PADDING, py + 2 + TITLE_H / 2, 4, CRYPT.accent)
    this._objects.push(dia)
    this._objects.push(this.add.text(px + PADDING + 14, py + 2 + TITLE_H / 2, 'OPTIONS', {
      fontFamily: FONT_HEAD, fontSize: '12px', color: CRYPT.ink, letterSpacing: 3,
    }).setOrigin(0, 0.5).setDepth(3))

    // Body sections
    const innerX = px + PADDING
    const innerW = PANEL_W - PADDING * 2
    let yy = py + TITLE_H + 20

    yy = this._sectionAudio(innerX, innerW, yy)
    yy += 14
    yy = this._sectionDisplay(innerX, innerW, yy)
    yy += 14
    yy = this._sectionName(innerX, innerW, yy)

    // Back button — anchored to bottom of the panel
    const backW = 220
    const backH = 44
    const backY = py + PANEL_H - PADDING - backH
    const backX = px + (PANEL_W - backW) / 2
    this._buttons.push(pixelButton(this, backX, backY, backW, backH, 'BACK', {
      depth: 4, fontSize: 11, primary: true,
      onClick: () => this._goBack(),
    }))
  }

  _sectionAudio(x, w, y) {
    this._objects.push(this.add.text(x, y, 'AUDIO', {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.accent2Css, letterSpacing: 3,
    }).setDepth(3))
    y += 20
    this._audio = new AudioControls(this, x, y, { depth: 5, w })
    y += AUDIO_CONTROLS_HEIGHT + 8
    return y
  }

  _sectionDisplay(x, w, y) {
    this._objects.push(this.add.text(x, y, 'DISPLAY', {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.accent2Css, letterSpacing: 3,
    }).setDepth(3))
    y += 20

    const rowH = 32
    const isFs = this.scale.isFullscreen
    // Center label vertically against the button.
    this._objects.push(this.add.text(x, y + rowH / 2, 'Fullscreen', {
      fontFamily: FONT_BODY, fontSize: '11px', color: CRYPT.ink, letterSpacing: 1,
    }).setOrigin(0, 0.5).setDepth(3))
    const btnW = 100
    const fsBtn = pixelButton(this, x + w - btnW, y, btnW, rowH, isFs ? 'ON' : 'OFF', {
      depth: 5, fontSize: 10,
      primary: isFs,
      onClick: () => {
        if (this.scale.isFullscreen) this.scale.stopFullscreen()
        else                          this.scale.startFullscreen()
        // Re-render to update the toggle label after the async transition.
        setTimeout(() => this._refresh(), 30)
      },
    })
    this._buttons.push(fsBtn)
    y += rowH + 4
    return y
  }

  _sectionName(x, w, y) {
    this._objects.push(this.add.text(x, y, 'PLAYER NAME', {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.accent2Css, letterSpacing: 3,
    }).setDepth(3))
    y += 20

    const rowH = 32
    const current = PlayerProfile.hasName() ? PlayerProfile.getName() : '—'
    this._nameDisplayT = this.add.text(x, y + rowH / 2, current, {
      fontFamily: FONT_HEAD, fontSize: '11px', color: CRYPT.ink, letterSpacing: 1,
    }).setOrigin(0, 0.5).setDepth(3)
    this._objects.push(this._nameDisplayT)

    const btnW = 140
    const editBtn = pixelButton(this, x + w - btnW, y, btnW, rowH, 'CHANGE NAME', {
      depth: 5, fontSize: 9,
      onClick: () => {
        this._namePanel = new NameEntryPanel(this, {
          depth:     10,
          initial:   PlayerProfile.getName(),
          onConfirm: (name) => {
            PlayerProfile.setName(name)
            this._nameDisplayT.setText(name)
            this._namePanel = null
          },
          onCancel: () => { this._namePanel = null },
        })
      },
    })
    this._buttons.push(editBtn)
    y += rowH + 4
    return y
  }

  _refresh() {
    // Tear down + rebuild — straightforward and cheap given the panel size.
    this._namePanel?.destroy(); this._namePanel = null
    this._audio?.destroy(); this._audio = null
    this._buttons.forEach(b => b?.destroy?.())
    this._buttons = []
    this._objects.forEach(o => o?.destroy?.())
    this._objects = []
    this._drawBackground()
    this._drawPanel()
  }

  _goBack() {
    this.scene.start('MainMenu')
  }
}

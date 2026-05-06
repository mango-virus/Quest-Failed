import {
  CRYPT, FONT_HEAD, FONT_BODY,
  pixelPanel, pixelButton,
} from './UIKit.js'

const PW      = 440
const PH      = 180
const TITLE_H = 28
const PAD     = 18
const MAX_LEN = 16

export class NameEntryPanel {
  constructor(scene, opts = {}) {
    this._scene     = scene
    this._onConfirm = opts.onConfirm ?? (() => {})
    this._onCancel  = opts.onCancel  ?? (() => {})
    this._text      = opts.initial   ?? ''
    this._destroyed = false

    // Use the camera's visible design-space dimensions, not uiW/uiH.
    // uiW on letterboxed scenes can exceed the design width on ultra-wide
    // monitors, which would push the panel off-centre.
    const cam   = scene.cameras.main
    const W     = cam.width  / cam.zoom
    const H     = cam.height / cam.zoom
    const depth = opts.depth ?? 90
    const px    = Math.round((W - PW) / 2)
    const py    = Math.round((H - PH) / 2)

    // Dim wash
    this._wash = scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.78)
      .setOrigin(0.5).setDepth(depth).setInteractive()

    // Panel chrome
    this._frameG = scene.add.graphics().setDepth(depth + 1)
    pixelPanel(this._frameG, px, py, PW, PH)

    // Title bar
    this._barG = scene.add.graphics().setDepth(depth + 2)
    this._barG.fillStyle(CRYPT.panel2, 1)
    this._barG.fillRect(px + 2, py + 2, PW - 4, TITLE_H)
    this._barG.fillStyle(CRYPT.panelEdgeS, 1)
    this._barG.fillRect(px + 2, py + 2 + TITLE_H, PW - 4, 1)

    this._titleT = scene.add.text(
      px + PW / 2, py + 2 + TITLE_H / 2,
      'YOUR NAME, MY LORD', {
        fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.ink, letterSpacing: 3,
      }
    ).setOrigin(0.5, 0.5).setDepth(depth + 3)

    // Instruction
    this._instrT = scene.add.text(
      px + PW / 2, py + TITLE_H + 16,
      'Enter your title — the dungeon will remember it.', {
        fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.inkDim, letterSpacing: 1,
        wordWrap: { width: PW - PAD * 2 },
        align: 'center',
      }
    ).setOrigin(0.5, 0).setDepth(depth + 3)

    // Text input box
    const boxX = px + PAD
    const boxY = py + TITLE_H + 38
    const boxW = PW - PAD * 2
    const boxH = 26
    this._boxX = boxX
    this._boxY = boxY
    this._boxW = boxW
    this._boxH = boxH

    this._boxG = scene.add.graphics().setDepth(depth + 2)
    this._drawBox()

    this._inputT = scene.add.text(boxX + 8, boxY + boxH / 2, '', {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.ink,
    }).setOrigin(0, 0.5).setDepth(depth + 3)

    this._cursorT = scene.add.text(0, boxY + boxH / 2, '|', {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.accentCss,
    }).setOrigin(0, 0.5).setDepth(depth + 3)

    this._updateDisplay()

    // Blinking cursor
    this._cursorOn = true
    this._blinkTimer = scene.time.addEvent({
      delay: 520, loop: true,
      callback: () => {
        if (this._destroyed) return
        this._cursorOn = !this._cursorOn
        this._cursorT.setVisible(this._cursorOn)
      },
    })

    // Buttons
    const btnY = py + PH - PAD - 30
    this._btnConfirm = pixelButton(scene, px + PAD, btnY, 180, 30, 'BEGIN REIGN', {
      depth: depth + 3, fontSize: 9, primary: true,
      onClick: () => this._submit(),
    })
    this._btnCancel = pixelButton(scene, px + PW - PAD - 130, btnY, 130, 30, 'CANCEL', {
      depth: depth + 3, fontSize: 9,
      onClick: () => this._cancel(),
    })

    // Keyboard capture
    this._keyHandler = (e) => {
      if (this._destroyed) return
      if (e.key === 'Enter')     { this._submit(); return }
      if (e.key === 'Escape')    { this._cancel(); return }
      if (e.key === 'Backspace') { this._text = this._text.slice(0, -1); this._updateDisplay(); return }
      if (e.key.length === 1 && this._text.length < MAX_LEN) {
        this._text += e.key
        this._updateDisplay()
      }
    }
    scene.input.keyboard.on('keydown', this._keyHandler)

    this._objs = [
      this._wash, this._frameG, this._barG, this._titleT,
      this._instrT, this._boxG, this._inputT, this._cursorT,
    ]
  }

  get isOpen() { return !this._destroyed }

  _drawBox() {
    this._boxG.clear()
    this._boxG.fillStyle(0x08050f, 1)
    this._boxG.fillRect(this._boxX, this._boxY, this._boxW, this._boxH)
    this._boxG.lineStyle(1, CRYPT.accent, 0.6)
    this._boxG.strokeRect(this._boxX, this._boxY, this._boxW, this._boxH)
  }

  _updateDisplay() {
    this._inputT.setText(this._text)
    this._cursorT.setX(this._boxX + 8 + this._inputT.width + 1)
  }

  _submit() {
    const name = this._text.trim()
    if (!name) return
    this.destroy()
    this._onConfirm(name)
  }

  _cancel() {
    this.destroy()
    this._onCancel()
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    this._blinkTimer?.remove()
    this._scene?.input?.keyboard?.off?.('keydown', this._keyHandler)
    this._objs?.forEach(o => o?.destroy?.())
    this._btnConfirm?.destroy?.()
    this._btnCancel?.destroy?.()
  }
}

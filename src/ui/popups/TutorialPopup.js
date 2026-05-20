// SUPERSEDED (Phase 34) — replaced by `src/hud/TutorialOverlay.js`.
//
// Small modal popup used by TutorialSystem to surface one-shot how-to
// hints (phase intros, mechanic intros, boss-archetype hooks). Modal so
// the player can read at their own pace; body text is short by design.
//
// Use via showFor({ title, body, onClose }) — single instance lives in
// HudScene like the other popups, opened by the TutorialSystem.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelButton } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'

const W = 460
const H = 150

export class TutorialPopup {
  constructor(scene) {
    this._scene  = scene
    this._title  = ''
    this._body   = ''
    this._onCloseCb = null

    this._frame = makePopupFrame({
      scene,
      w: W,
      h: H,
      title: 'HINT',
      depth: 220,         // above gameplay popups; below the welcome intro
      // Mandatory dismiss — player must acknowledge so they don't miss the
      // hint. They can disable future hints from the pause menu.
      dismissable: false,
      onClose: () => {
        const cb = this._onCloseCb
        this._onCloseCb = null
        cb?.()
      },
      render: (px, py, cx, cy, cw, ch, addChild) =>
        this._render(cx, cy, cw, ch, addChild),
    })
  }

  // Open with content. `onClose` fires AFTER the player clicks Got It and
  // the popup chrome tears down — TutorialSystem uses it to pop the next
  // tutorial off the queue.
  showFor({ title, body, onClose }) {
    this._title = title ?? 'HINT'
    this._body  = body  ?? ''
    this._onCloseCb = onClose ?? null
    this._frame.open()
  }

  isOpen() { return this._frame.isOpen() }
  close()  { this._frame.close() }
  destroy(){ this.close() }

  _render(cx, cy, cw, ch, addChild) {
    const D = 225

    // Title — accent color, centered
    addChild(this._scene.add.text(cx + cw / 2, cy + 4, this._title.toUpperCase(), {
      fontFamily: FONT_HEAD, fontSize: '11px', color: CRYPT.accent2Css, letterSpacing: 2,
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(D + 2))

    // Body — wrapped, plain ink color
    addChild(this._scene.add.text(cx + 12, cy + 28, this._body, {
      fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
      wordWrap: { width: cw - 24, useAdvancedWrap: true }, lineSpacing: 3,
    }).setDepth(D + 2))

    // Got It button — centered at the bottom
    const btnW = 140, btnH = 28
    const btnX = cx + (cw - btnW) / 2
    const btnY = cy + ch - btnH - 4
    const btn = pixelButton(this._scene, btnX, btnY, btnW, btnH, 'GOT IT',
      { primary: true, depth: D + 4, fontSize: 10,
        onClick: () => this.close(),
      })
    addChild(btn.bg, btn.label, btn.hit)
  }
}

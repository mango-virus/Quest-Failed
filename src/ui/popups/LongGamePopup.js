// SUPERSEDED (Phase 34) — replaced by `src/hud/LongGameOverlay.js`.
//
// Phase 9 — Pact of "The Long Game" notification popup.
//
// Shown each time the pact triggers (every 3 days). Displays the free
// pact granted, the minion lost, and the slot penalty. Single OK button
// to dismiss.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelButton } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'

export class LongGamePopup {
  constructor(scene) {
    this._scene = scene
    this._payload = null     // last LONG_GAME_TRIGGERED event details
    this._frame = makePopupFrame({
      scene,
      w:    760,
      h:    340,
      title:'THE · LONG · GAME',
      depth: 220,
      render: (px, py, cx, cy, cw, ch, addChild) => this._render(cx, cy, cw, ch, addChild),
    })
  }

  showFor(payload) {
    this._payload = payload
    this._frame.open()
  }
  close()   { this._frame.close() }
  destroy() { this.close() }

  _render(cx, cy, cw, ch, addChild) {
    const D = 225
    const p = this._payload ?? {}
    const day  = p.day ?? '?'
    const got  = p.grantedName ?? '— none —'
    const lost = p.lostName ?? '— none —'

    // Header tagline
    addChild(this._scene.add.text(cx + cw / 2, cy + 6,
      `DAY ${day} · DAWN OF THE PACT`, {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 4,
    }).setOrigin(0.5, 0).setDepth(D + 2))

    // Granted pact (the gift)
    addChild(this._scene.add.text(cx + cw / 2, cy + 36, 'THE BARGAIN BEARS FRUIT', {
      fontFamily: FONT_HEAD, fontSize: '11px', color: CRYPT.goldCss, letterSpacing: 2,
    }).setOrigin(0.5, 0).setDepth(D + 2))
    addChild(this._scene.add.text(cx + cw / 2, cy + 56, `+ ${got.toUpperCase()}`, {
      fontFamily: FONT_HEAD, fontSize: '14px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0.5, 0).setDepth(D + 2))
    addChild(this._scene.add.text(cx + cw / 2, cy + 80,
      'A free Rare pact — sealed without cost.', {
      fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.inkDim, letterSpacing: 1,
    }).setOrigin(0.5, 0).setDepth(D + 2))

    // Penalty (the toll)
    addChild(this._scene.add.text(cx + cw / 2, cy + 130, '— BUT THE PRICE IS PAID —', {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.warnCss, letterSpacing: 3,
    }).setOrigin(0.5, 0).setDepth(D + 2))
    addChild(this._scene.add.text(cx + cw / 2, cy + 154,
      `− 1 minion lost permanently  (${lost})`, {
      fontFamily: FONT_BODY, fontSize: '10px', color: CRYPT.warnCss, letterSpacing: 1,
    }).setOrigin(0.5, 0).setDepth(D + 2))
    addChild(this._scene.add.text(cx + cw / 2, cy + 174,
      '− 1 maximum minion slot, forever', {
      fontFamily: FONT_BODY, fontSize: '10px', color: CRYPT.warnCss, letterSpacing: 1,
    }).setOrigin(0.5, 0).setDepth(D + 2))

    // OK button
    const btn = pixelButton(this._scene,
      cx + cw / 2 - 110, cy + ch - 54, 220, 36,
      'CONTINUE',
      { primary: true, depth: D + 2, fontSize: 10,
        onClick: () => this.close(),
      })
    addChild(btn.bg, btn.label, btn.hit)
  }
}

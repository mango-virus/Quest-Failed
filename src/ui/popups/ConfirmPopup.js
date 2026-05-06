// Generic yes / cancel confirmation popup. Triggered via the SHOW_CONFIRM
// EventBus event with a payload of { title, message, confirmLabel, cancelLabel,
// onConfirm, onCancel }. Both callbacks are optional; only one runs per
// dismissal. Closing via Esc / X / clicking the backdrop counts as cancel.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelButton } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'

export class ConfirmPopup {
  constructor(scene) {
    this._scene = scene
    this._payload = null
    this._resolved = false
    this._frame = makePopupFrame({
      scene,
      w:    520,
      h:    220,
      title:'CONFIRM',
      depth: 230,
      onClose: () => this._handleClose(),
      render: (px, py, cx, cy, cw, ch, addChild) => this._render(cx, cy, cw, ch, addChild),
    })
  }

  showFor(payload) {
    // If a previous confirm is still open, treat that one as cancelled
    // before swapping in the new payload — otherwise its callbacks would
    // never fire.
    if (this._frame.isOpen()) {
      this._resolveAs('cancel')
      this._frame.close()
    }
    this._payload  = payload ?? {}
    this._resolved = false
    this._frame.open()
  }

  close()   { this._frame.close() }
  destroy() { this.close() }

  _handleClose() {
    // Backdrop / Esc / X dismissal counts as cancel if neither button ran.
    if (!this._resolved) this._resolveAs('cancel')
    this._payload = null
  }

  _resolveAs(which) {
    if (this._resolved) return
    this._resolved = true
    const p = this._payload ?? {}
    if (which === 'confirm') p.onConfirm?.()
    else                     p.onCancel?.()
  }

  _render(cx, cy, cw, ch, addChild) {
    const D = 235
    const p = this._payload ?? {}
    const message = p.message ?? 'Are you sure?'
    const confirmLabel = p.confirmLabel ?? 'YES'
    const cancelLabel  = p.cancelLabel  ?? 'CANCEL'

    addChild(this._scene.add.text(cx + cw / 2, cy + ch / 2 - 38, message, {
      fontFamily: FONT_BODY, fontSize: '12px', color: CRYPT.ink,
      align: 'center', wordWrap: { width: cw - 20 },
    }).setOrigin(0.5).setDepth(D + 2))

    const btnW = 160, btnH = 36, gap = 20
    const totalW = btnW * 2 + gap
    const baseX = cx + (cw - totalW) / 2
    const btnY  = cy + ch - btnH - 10

    const cancelBtn = pixelButton(this._scene, baseX, btnY, btnW, btnH, cancelLabel, {
      depth: D + 2, fontSize: 10,
      onClick: () => { this._resolveAs('cancel');  this.close() },
    })
    addChild(cancelBtn.bg, cancelBtn.label, cancelBtn.hit)

    const confirmBtn = pixelButton(this._scene, baseX + btnW + gap, btnY, btnW, btnH, confirmLabel, {
      primary: true, depth: D + 2, fontSize: 10,
      onClick: () => { this._resolveAs('confirm'); this.close() },
    })
    addChild(confirmBtn.bg, confirmBtn.label, confirmBtn.hit)
  }
}

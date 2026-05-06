// Detail popup for a single dark pact, opened from clicking a card in
// BossOverviewPopup's "Active Pacts" grid. Displays the pact name,
// description, and trade-off description from `dungeonMechanics.json`.
// Triggered via the SHOW_PACT_DETAIL event with payload { mechanicId, day }.
// Renders at a higher depth than BossOverviewPopup so it overlays cleanly
// without disturbing the underlying view — closing this popup returns
// the player to the Boss Overview.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelButton } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'

const RARITY_COLORS = {
  legendary: CRYPT.accentCss,
  epic:      CRYPT.soulCss,
  rare:      CRYPT.goldCss,
  common:    CRYPT.ink,
}

export class PactDetailPopup {
  constructor(scene) {
    this._scene = scene
    this._payload = null   // { mechanicId, day }
    this._frame = makePopupFrame({
      scene,
      w:    640,
      h:    380,
      title:'PACT',
      depth: 240,
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
    const D = 245
    const p = this._payload ?? {}
    const all = this._scene.cache.json.get('dungeonMechanics') ?? []
    const mech = all.find(m => m.id === p.mechanicId)

    if (!mech) {
      addChild(this._scene.add.text(cx + cw / 2, cy + ch / 2,
        '— PACT DATA UNAVAILABLE —', {
        fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
      this._addCloseButton(cx, cy, cw, ch, D, addChild)
      return
    }

    const rarityColor = RARITY_COLORS[mech.rarity] ?? CRYPT.ink

    // Day stamp + rarity tag
    addChild(this._scene.add.text(cx + cw / 2, cy + 4,
      `SEALED ON DAY ${p.day ?? '?'}  ·  ${(mech.rarity ?? 'common').toUpperCase()}`, {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 3,
    }).setOrigin(0.5, 0).setDepth(D + 2))

    // Pact name
    addChild(this._scene.add.text(cx + cw / 2, cy + 28, (mech.name ?? mech.id).toUpperCase(), {
      fontFamily: FONT_HEAD, fontSize: '16px', color: rarityColor, letterSpacing: 2,
    }).setOrigin(0.5, 0).setDepth(D + 2))

    // Effect heading + description
    addChild(this._scene.add.text(cx, cy + 78, 'EFFECT', {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.goldCss, letterSpacing: 3,
    }).setOrigin(0, 0).setDepth(D + 2))
    addChild(this._scene.add.text(cx, cy + 96, mech.description ?? '—', {
      fontFamily: FONT_BODY, fontSize: '11px', color: CRYPT.ink, letterSpacing: 0,
      wordWrap: { width: cw },
    }).setOrigin(0, 0).setDepth(D + 2))

    // Tradeoff heading + description
    const tradeY = cy + 170
    addChild(this._scene.add.text(cx, tradeY, 'COST', {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.accent2Css, letterSpacing: 3,
    }).setOrigin(0, 0).setDepth(D + 2))
    addChild(this._scene.add.text(cx, tradeY + 18,
      mech.tradeoffDescription ?? '— No declared cost. The price will reveal itself. —', {
      fontFamily: FONT_BODY, fontSize: '11px', color: CRYPT.inkDim, letterSpacing: 0,
      wordWrap: { width: cw },
    }).setOrigin(0, 0).setDepth(D + 2))

    this._addCloseButton(cx, cy, cw, ch, D, addChild)
  }

  _addCloseButton(cx, cy, cw, ch, D, addChild) {
    const btnW = 180, btnH = 34
    const btn = pixelButton(this._scene,
      cx + cw / 2 - btnW / 2, cy + ch - btnH - 4, btnW, btnH,
      'CLOSE',
      { depth: D + 2, fontSize: 10, onClick: () => this.close() },
    )
    addChild(btn.bg, btn.label, btn.hit)
  }
}

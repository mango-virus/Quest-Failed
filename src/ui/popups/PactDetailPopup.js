// SUPERSEDED (Phase 34) — replaced by `src/hud/PactDetailPopup.js` (DOM).
//
// Detail popup for a single dark pact, opened from clicking a card in
// BossOverviewPopup's "Active Pacts" grid. Displays the pact using the
// SAME card chrome as the Dark Pact menu (sigil + rarity ribbon + flavor
// + benefit/tradeoff), via the shared PactCard renderer. Adds a "SEALED
// ON DAY N" header and a CLOSE button.
//
// Triggered via the SHOW_PACT_DETAIL event with payload { mechanicId, day }.
// Renders at a higher depth than BossOverviewPopup so it overlays cleanly
// without disturbing the underlying view.

import { CRYPT, FONT_HEAD, pixelButton } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'
import { renderPactCard, RARITIES } from './PactCard.js'

// Card dimensions match the Dark Pact menu (cardW × cardsH from
// DarkPactPopup at popup w=1040, h=560), so the visual is pixel-identical.
const CARD_W = 326
const CARD_H = 336

export class PactDetailPopup {
  constructor(scene) {
    this._scene  = scene
    this._payload = null   // { mechanicId, day }
    this._tweens  = []     // looping tweens from renderPactCard

    this._frame = makePopupFrame({
      scene,
      // Tight wrapper around the card: title bar (32) + padding (14) +
      // header (28) + gap (10) + card (336) + gap (12) + close (38)
      // + bottom pad (14) ≈ 484. Width = card + padding * 2 + breathing.
      w:    CARD_W + 60,
      h:    CARD_H + 152,
      title:'PACT',
      depth: 240,
      onClose: () => {
        for (const t of this._tweens) t?.stop?.()
        this._tweens = []
      },
      render: (px, py, cx, cy, cw, ch, addChild) =>
        this._render(cx, cy, cw, ch, addChild),
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

    const rarKey = mech.rarity ?? 'common'
    const rar    = RARITIES[rarKey] ?? RARITIES.common

    // Header strip: SEALED ON DAY N + rarity label
    addChild(this._scene.add.text(cx + cw / 2, cy + 4,
      `SEALED ON DAY ${p.day ?? '?'}`, {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 3,
    }).setOrigin(0.5, 0).setDepth(D + 2))

    // Card — centred horizontally, sits just below the header
    const cardX = cx + Math.floor((cw - CARD_W) / 2)
    const cardY = cy + 28
    const { container, tweens } = renderPactCard(
      this._scene, mech, cardX, cardY, CARD_W, CARD_H, { depth: D + 1 },
    )
    addChild(container)
    this._tweens.push(...tweens)

    this._addCloseButton(cx, cy, cw, ch, D, addChild)
  }

  _addCloseButton(cx, cy, cw, ch, D, addChild) {
    const btnW = 180, btnH = 36
    const btn = pixelButton(this._scene,
      cx + cw / 2 - btnW / 2, cy + ch - btnH - 4, btnW, btnH,
      'CLOSE',
      { depth: D + 2, fontSize: 10, onClick: () => this.close() },
    )
    addChild(btn.bg, btn.label, btn.hit)
  }
}

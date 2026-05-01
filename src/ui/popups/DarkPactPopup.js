// Phase 31F — Dark Pact popup.
//
// Shown after Post-Wave Summary on days the boss leveled up. Three
// mechanic offering cards (DungeonMechanicSystem.getOfferings(3, ...))
// with rarity tags. Reroll All button replaces the three offerings once
// per night, then disables. Seal the Pact activates the selected
// mechanic and emits DARK_PACT_SEALED for the EndOfDay orchestrator to
// continue to NightPhase. No skip option.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelButton, pixelDiamond } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'
import { EventBus } from '../../systems/EventBus.js'

const RARITIES = {
  common:    { color: CRYPT.inkMute,   label: 'COMMON' },
  rare:      { color: CRYPT.goldCss,   label: 'RARE' },
  epic:      { color: CRYPT.soulCss,   label: 'EPIC' },
  legendary: { color: CRYPT.accentCss, label: 'LEGENDARY' },
}

export class DarkPactPopup {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._offers    = []
    this._selectedIdx = 0
    this._rerollUsed  = false
    this._frame = makePopupFrame({
      scene,
      w:    1100,
      h:    540,
      title:'DARK · PACT',
      depth: 200,
      onClose: () => { /* reset transient ui state */ },
      render: (px, py, cx, cy, cw, ch, addChild) => this._render(cx, cy, cw, ch, addChild),
    })
  }

  // The orchestrator calls this once before open() to refresh the three
  // offerings. Stored on the instance so rerolls can replace cleanly.
  refreshOffers() {
    const game = this._scene.scene.get('Game')
    const sys  = game?.dungeonMechanicSystem
    if (!sys) { this._offers = []; return }
    const archId = this._gameState.player?.bossArchetypeId
    const dLv    = this._gameState.meta?.dungeonLevel ?? 1
    this._offers = sys.getOfferings(3, archId, dLv) ?? []
    this._selectedIdx = 0
  }

  open() {
    if (!this._offers.length) this.refreshOffers()
    this._rerollUsed = false
    this._frame.open()
  }
  close() { this._frame.close() }
  destroy() { this.close() }

  _render(cx, cy, cw, ch, addChild) {
    const D = 205

    // Header tagline
    addChild(this._scene.add.text(cx + cw / 2, cy + 4, 'NIGHTFALL · CHOOSE ONE', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 4,
    }).setOrigin(0.5, 0).setDepth(D + 2))
    addChild(this._scene.add.text(cx + cw / 2, cy + 22,
      'The boss draws power from the night.', {
      fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.inkDim, letterSpacing: 1,
    }).setOrigin(0.5, 0).setDepth(D + 2))

    // Three cards
    const cardsY = cy + 56
    const cardsH = ch - 56 - 64       // leave 64 px for footer
    const gap    = 14
    const cardW  = Math.floor((cw - gap * 2) / 3)
    if (this._offers.length === 0) {
      addChild(this._scene.add.text(cx + cw / 2, cardsY + cardsH / 2,
        '— NO MECHANICS AVAILABLE AT THIS LEVEL —', {
        fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
    } else {
      this._offers.slice(0, 3).forEach((def, i) => {
        const x = cx + i * (cardW + gap)
        this._renderCard(def, i, x, cardsY, cardW, cardsH, D, addChild)
      })
    }

    // Footer: Reroll All + Seal the Pact
    const footerY = cy + ch - 44
    const rerollEnabled = !this._rerollUsed && this._offers.length > 0
    const rerollLabel = this._rerollUsed ? 'REROLL USED' : 'REROLL ALL (1×)'
    const rerollBtn = pixelButton(this._scene,
      cx, footerY, 200, 36, rerollLabel,
      { depth: D + 2, fontSize: 9,
        onClick: rerollEnabled ? () => this._reroll() : null,
      })
    if (!rerollEnabled) rerollBtn.setEnabled(false)
    addChild(rerollBtn.bg, rerollBtn.label, rerollBtn.hit)

    const sealBtn = pixelButton(this._scene,
      cx + cw - 220, footerY, 220, 36, 'SEAL THE PACT',
      { primary: true, depth: D + 2, fontSize: 10,
        onClick: () => this._seal(),
      })
    if (this._offers.length === 0) sealBtn.setEnabled(false)
    addChild(sealBtn.bg, sealBtn.label, sealBtn.hit)
  }

  _renderCard(def, idx, x, y, w, h, D, addChild) {
    const isSelected = (idx === this._selectedIdx)
    const rarKey = def.rarity ?? 'common'
    const rar    = RARITIES[rarKey] ?? RARITIES.common

    const card = this._scene.add.graphics().setDepth(D + 1)
    pixelPanel(card, x, y, w, h, {
      fill:  isSelected ? CRYPT.bgStone3 : CRYPT.bgStone1,
      edgeH: isSelected ? CRYPT.accent2  : CRYPT.panelEdgeH,
      edgeS: isSelected ? CRYPT.accent   : CRYPT.panelEdgeS,
    })
    if (isSelected) {
      card.fillStyle(CRYPT.accent, 1)
      card.fillRect(x - 2, y - 2, w + 4, 2)
      card.fillRect(x - 2, y + h, w + 4, 2)
      card.fillRect(x - 2, y - 2, 2, h + 4)
      card.fillRect(x + w, y - 2, 2, h + 4)
    }
    addChild(card)

    // Glyph box (top-left)
    const gBox = 56
    const glyphG = this._scene.add.graphics().setDepth(D + 2)
    pixelPanel(glyphG, x + 14, y + 14, gBox, gBox, {
      fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(glyphG)
    addChild(this._scene.add.text(x + 14 + gBox / 2, y + 14 + gBox / 2,
      (def.glyph ?? def.id?.[0]?.toUpperCase() ?? '?'), {
      fontFamily: FONT_HEAD, fontSize: '24px', color: CRYPT.ink, letterSpacing: 1,
    }).setOrigin(0.5).setDepth(D + 3))

    // Rarity tag (top-right)
    const tagW = rar.label.length * 7 + 12
    const tagG = this._scene.add.graphics().setDepth(D + 2)
    tagG.fillStyle(0x000000, 1)
    tagG.fillRect(x + w - tagW - 14, y + 14, tagW, 14)
    tagG.lineStyle(1, this._cssToHex(rar.color), 1)
    tagG.strokeRect(x + w - tagW - 14, y + 14, tagW, 14)
    addChild(tagG)
    addChild(this._scene.add.text(x + w - tagW / 2 - 14, y + 14 + 7, rar.label, {
      fontFamily: FONT_HEAD, fontSize: '7px', color: rar.color, letterSpacing: 1,
    }).setOrigin(0.5).setDepth(D + 3))

    // Name
    const nameY = y + 14 + gBox + 14
    addChild(this._scene.add.text(x + 14, nameY, (def.name ?? '?').toUpperCase(), {
      fontFamily: FONT_HEAD, fontSize: '11px', color: CRYPT.ink, letterSpacing: 1,
      wordWrap: { width: w - 28, useAdvancedWrap: true },
    }).setDepth(D + 3))

    // Description
    addChild(this._scene.add.text(x + 14, nameY + 28,
      def.description ?? '— no description —', {
      fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
      wordWrap: { width: w - 28, useAdvancedWrap: true }, lineSpacing: 4,
    }).setDepth(D + 3))

    // Tradeoff (italic-ish via dim color)
    const tradeY = y + h - 60
    addChild(this._scene.add.text(x + 14, tradeY, 'TRADEOFF', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D + 3))
    addChild(this._scene.add.text(x + 14, tradeY + 12,
      def.tradeoffDescription ?? '—', {
      fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.warnCss, letterSpacing: 1,
      wordWrap: { width: w - 28, useAdvancedWrap: true }, lineSpacing: 3,
    }).setDepth(D + 3))

    // Hit zone
    const hit = this._scene.add.zone(x, y, w, h)
      .setOrigin(0).setDepth(D + 5).setInteractive({ useHandCursor: true })
    hit.on('pointerup', () => {
      this._selectedIdx = idx
      // Cheap re-render: close and re-open the popup so the selection
      // ring follows. Alternative was a full incremental redraw but the
      // popup is small enough that this stays imperceptible.
      this._frame.close()
      this._frame.open()
    })
    addChild(hit)
  }

  _reroll() {
    if (this._rerollUsed) return
    this._rerollUsed = true
    this.refreshOffers()
    this._frame.close()
    this._frame.open()
  }

  _seal() {
    const def = this._offers[this._selectedIdx]
    if (!def) {
      // Nothing to seal — still continue to night to avoid soft-locking.
      EventBus.emit('DARK_PACT_SEALED', { mechanicId: null })
      this.close()
      return
    }
    const game = this._scene.scene.get('Game')
    const sys  = game?.dungeonMechanicSystem
    sys?.activate?.(def.id)
    // Phase 31I plumbing — appends to gameState.history.pacts via
    // RunHistorySystem so the Game Over timeline + Boss Overview
    // 'Active Pacts' list pick this up.
    EventBus.emit('PACT_SEALED', {
      mechanicId: def.id,
      rarity:     def.rarity ?? 'common',
    })
    EventBus.emit('DARK_PACT_SEALED', { mechanicId: def.id })
    this.close()
  }

  _cssToHex(css) {
    if (typeof css !== 'string') return CRYPT.inkDimHex
    const s = css.startsWith('#') ? css.slice(1) : css
    return parseInt(s, 16)
  }
}

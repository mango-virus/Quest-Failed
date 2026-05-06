// Welcome / "you're the boss" intro popup. Fires once per run on Game
// scene boot when meta.introSeen is false. Modal — the player must click
// Continue to begin the night phase. The checkbox controls whether the
// inline how-to-play hint popups will fire at their event gates throughout
// the run.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelButton, uiSfxClick } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'
import { EventBus } from '../../systems/EventBus.js'

const W = 580
const H = 370

export class WelcomeIntroPopup {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    // Local UI state for the tutorial-checkbox toggle. Persisted to
    // gameState.meta.tutorialEnabled when the player clicks Continue.
    this._tutorialChecked = true

    this._frame = makePopupFrame({
      scene,
      w: W,
      h: H,
      title: 'WELCOME, BOSS',
      depth: 200,
      // Mandatory — no Esc / X / wash dismiss. Player must click Continue.
      dismissable: false,
      onClose: () => {
        // Mark seen + persist tutorial preference. Save flushes both so
        // a refresh between days doesn't show this again.
        this._gameState.meta ??= {}
        this._gameState.meta.introSeen      = true
        this._gameState.meta.tutorialEnabled = this._tutorialChecked
        EventBus.emit('INTRO_DISMISSED', { tutorialEnabled: this._tutorialChecked })
      },
      render: (px, py, cx, cy, cw, ch, addChild) =>
        this._render(cx, cy, cw, ch, addChild),
    })
  }

  open()    { this._frame.open() }
  close()   { this._frame.close() }
  destroy() { this.close() }

  _render(cx, cy, cw, ch, addChild) {
    const D = 205

    // Tagline strip — tight against the top
    addChild(this._scene.add.text(cx + cw / 2, cy + 4, 'YOU ARE THE DUNGEON', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 4,
    }).setOrigin(0.5, 0).setDepth(D + 2))

    // Big heading
    const headT = this._scene.add.text(cx + cw / 2, cy + 18, 'A REVERSE ROGUELIKE', {
      fontFamily: FONT_HEAD, fontSize: '14px', color: CRYPT.accent2Css, letterSpacing: 3,
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(D + 2)
    addChild(headT)

    // Body — three short paragraphs explaining the loop. Plain language.
    const bodyY = cy + 48
    const bodyW = cw - 32
    const lineGap = 8

    const paragraphs = [
      {
        head: 'NIGHT — BUILD',
        body: 'Place rooms, traps, and minions. Earn gold by surviving days; spend it to grow your dungeon.',
      },
      {
        head: 'DAY — DEFEND',
        body: 'Adventurers invade through the entry hall. Stop them before they reach your boss chamber.',
      },
      {
        head: 'GROW — REPEAT',
        body: 'Every adventurer killed earns gold and boss XP. Level up to unlock new rooms, minions, traps, and Dark Pacts.',
      },
    ]

    let yy = bodyY
    for (const p of paragraphs) {
      // Heading line — accent color
      const h = this._scene.add.text(cx + 16, yy, p.head, {
        fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.goldCss, letterSpacing: 2,
      }).setDepth(D + 2)
      addChild(h)
      yy += 14
      // Body paragraph — wrapped
      const b = this._scene.add.text(cx + 16, yy, p.body, {
        fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
        wordWrap: { width: bodyW, useAdvancedWrap: true }, lineSpacing: 3,
      }).setDepth(D + 2)
      addChild(b)
      yy += b.height + lineGap
    }

    // Tutorial checkbox row — sits above the Continue button.
    // Click anywhere on the row toggles. Visual: 14×14 box + label.
    const cbY = cy + ch - 64
    const cbX = cx + 16
    const cbSize = 14
    const checkBg = this._scene.add.graphics().setDepth(D + 2)
    const checkLabel = this._scene.add.text(cbX + cbSize + 10, cbY,
      'Show how-to-play hints as I play', {
      fontFamily: FONT_BODY, fontSize: '10px', color: CRYPT.ink, letterSpacing: 1,
    }).setDepth(D + 2)
    addChild(checkBg, checkLabel)

    const drawCheck = () => {
      checkBg.clear()
      // Box outline
      checkBg.lineStyle(1, CRYPT.panelEdgeH, 1)
      checkBg.strokeRect(cbX, cbY, cbSize, cbSize)
      checkBg.fillStyle(CRYPT.bgStone3, 1)
      checkBg.fillRect(cbX + 1, cbY + 1, cbSize - 2, cbSize - 2)
      // Inner check mark — short L-stroke, drawn only when checked
      if (this._tutorialChecked) {
        checkBg.lineStyle(2, CRYPT.green, 1)
        checkBg.beginPath()
        checkBg.moveTo(cbX + 3, cbY + 7)
        checkBg.lineTo(cbX + 6, cbY + 10)
        checkBg.lineTo(cbX + 11, cbY + 4)
        checkBg.strokePath()
      }
    }
    drawCheck()

    // Hit zone covering the whole row so labels are also clickable
    const hit = this._scene.add.zone(cbX, cbY - 2, cbSize + 280, cbSize + 6)
      .setOrigin(0).setDepth(D + 4).setInteractive({ useHandCursor: true })
    hit.on('pointerup', () => {
      this._tutorialChecked = !this._tutorialChecked
      drawCheck()
      try { uiSfxClick(this._scene) } catch {}
    })
    addChild(hit)

    // Continue button — primary CTA, bottom-center
    const btnW = 200, btnH = 32
    const btnX = cx + (cw - btnW) / 2
    const btnY = cy + ch - btnH - 6
    const btn = pixelButton(this._scene, btnX, btnY, btnW, btnH, 'CONTINUE',
      { primary: true, depth: D + 4, fontSize: 12,
        onClick: () => this.close(),
      })
    addChild(btn.bg, btn.label, btn.hit)
  }
}

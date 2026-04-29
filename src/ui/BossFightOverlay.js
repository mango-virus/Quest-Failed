// Phase 10 — BossFight cinematic overlay.
//
// Mid-screen banner shown for the duration of a boss fight. Subscribes to:
//   BOSS_FIGHT_INCOMING  → show "INTRUDER AT THE GATE" pulse + boss HP bar
//   BOSS_FIGHT_RESOLVED  → flash result ("DEFENDED" / "BOSS SLAIN") then fade
//
// Renders in screen-space at depth 90 (above all gameplay UI).

import { EventBus } from '../systems/EventBus.js'
import { PALETTE, glowPanel } from './UIKit.js'

export class BossFightOverlay {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._objects = []
    EventBus.on('BOSS_FIGHT_INCOMING', this._onIncoming, this)
    EventBus.on('BOSS_FIGHT_RESOLVED', this._onResolved, this)
  }

  destroy() {
    EventBus.off('BOSS_FIGHT_INCOMING', this._onIncoming, this)
    EventBus.off('BOSS_FIGHT_RESOLVED', this._onResolved, this)
    this._clear()
  }

  _onIncoming() {
    this._clear()
    const W = this._scene.uiW

    // Light veil only — the boss room must remain clearly visible so the
    // player can watch the orbiting combat that BossSystem drives during
    // FIGHT_DELAY_MS.
    const veil = this._scene.add.rectangle(0, 0, W, this._scene.uiH, 0x000000, 0.12)
      .setOrigin(0).setDepth(89)
    this._objects.push(veil)

    // Banner sits at the top of the screen so it can't obscure the action.
    const bannerY = 18
    const bannerH = 60
    const banner = this._scene.add.graphics().setDepth(90)
    glowPanel(banner, W / 2 - 220, bannerY, 440, bannerH, {
      fill: 0x140618, border: 0xcc3322, glow: 0x661111,
    })
    this._objects.push(banner)

    const title = this._scene.add.text(W / 2, bannerY + 18, 'INTRUDER AT THE GATE', {
      fontSize: '14px', color: '#ff8888', fontFamily: 'monospace', fontStyle: 'bold',
      shadow: { color: '#660000', blur: 12, fill: true },
    }).setOrigin(0.5).setDepth(91)
    this._objects.push(title)

    const sub = this._scene.add.text(W / 2, bannerY + 40,
      `Lives remaining: ${this._gameState.boss?.deathsRemaining ?? '?'}`, {
        fontSize: '10px', color: '#ffcccc', fontFamily: 'monospace',
      }).setOrigin(0.5).setDepth(91)
    this._objects.push(sub)

    // Pulsing alpha
    this._scene.tweens.add({
      targets: title, alpha: { from: 1, to: 0.4 }, duration: 600, yoyo: true, repeat: -1,
    })
  }

  _onResolved({ winner, deathsRemaining }) {
    // Replace the contents with the result; keep showing 1.5s then fade
    this._clear()
    const W = this._scene.uiW
    const H = this._scene.uiH

    const veil = this._scene.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0).setDepth(89)
    this._objects.push(veil)

    const banner = this._scene.add.graphics().setDepth(90)
    const isPartyWin = winner === 'party'
    glowPanel(banner, W / 2 - 240, H / 2 - 60, 480, 120, {
      fill: isPartyWin ? 0x1a0606 : 0x06140a,
      border: isPartyWin ? 0xff5544 : 0x33dd66,
      glow:   isPartyWin ? 0x661111 : 0x115533,
    })
    this._objects.push(banner)

    const title = this._scene.add.text(W / 2, H / 2 - 22,
      isPartyWin ? 'YOU LOST A LIFE' : 'INTRUDER REPELLED', {
        fontSize: '18px',
        color: isPartyWin ? '#ff7777' : '#88ffaa',
        fontFamily: 'monospace', fontStyle: 'bold',
        shadow: { color: isPartyWin ? '#440000' : '#003311', blur: 16, fill: true },
      }).setOrigin(0.5).setDepth(91)
    this._objects.push(title)

    const sub = this._scene.add.text(W / 2, H / 2 + 12,
      isPartyWin
        ? `Lives remaining: ${deathsRemaining}`
        : `The dungeon endures.`, {
        fontSize: '11px',
        color: isPartyWin ? '#ffcccc' : '#cceedd',
        fontFamily: 'monospace',
      }).setOrigin(0.5).setDepth(91)
    this._objects.push(sub)

    this._scene.time.delayedCall(2000, () => {
      this._scene.tweens.add({
        targets: this._objects, alpha: 0, duration: 700,
        onComplete: () => this._clear(),
      })
    })
  }

  _clear() {
    for (const o of this._objects) o.destroy?.()
    this._objects = []
  }
}

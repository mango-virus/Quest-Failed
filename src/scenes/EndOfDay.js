// Phase 9 — EndOfDay scene.
//
// Lifecycle:
//   DayPhase ends → DayPhase.scene.start('EndOfDay', { gameState }) →
//   shows newspaper (left) + 3 mechanic offer cards (right) →
//   on card click OR "skip" button → start NightPhase
//
// Reads:
//   - scene.get('Game').newspaperSystem.compose()
//   - scene.get('Game').dungeonMechanicSystem.getOfferings(3, archetypeId, dungeonLevel)
//
// Effects:
//   - Activates the chosen mechanic via DungeonMechanicSystem.activate
//   - Increments dayNumber (already done by DayPhase before transition)

import { PALETTE, glowPanel } from '../ui/UIKit.js'
import { Balance }            from '../config/balance.js'
import { SaveSystem }          from '../systems/SaveSystem.js'

export class EndOfDay extends Phaser.Scene {
  constructor() {
    super('EndOfDay')
    this._gameState = null
    this._objects = []
  }

  init(data) {
    this._gameState = data?.gameState ?? this.scene.get('Game')?.gameState
  }

  create() {
    const { width: W, height: H } = this.scale

    // Backdrop
    const back = this.add.rectangle(0, 0, W, H, 0x040810, 0.95).setOrigin(0).setDepth(0)
    this._objects.push(back)

    // Title bar
    const titleG = this.add.graphics().setDepth(1)
    glowPanel(titleG, 24, 16, W - 48, 40, {
      fill: PALETTE.panelBg, border: 0x886600, glow: 0x443300,
    })
    this._objects.push(titleG)
    this.add.text(W / 2, 36, `END OF DAY ${this._gameState.meta.dayNumber - 1}`, {
      fontSize: '14px', color: PALETTE.textGold, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(2)

    this._renderNewspaper(W, H)
    this._renderOfferings(W, H)
    this._renderSkip(W, H)
  }

  shutdown() {
    for (const o of this._objects) o.destroy?.()
    this._objects = []
  }

  // ── Newspaper panel ───────────────────────────────────────────────────────

  _renderNewspaper(W, H) {
    const x = 32, y = 72
    const w = Math.floor(W * 0.55) - 24
    const h = H - y - 48

    const g = this.add.graphics().setDepth(1)
    glowPanel(g, x, y, w, h, {
      fill: 0x0a0e16, border: 0xaaaaff, glow: 0x223366,
    })
    this._objects.push(g)

    const game = this.scene.get('Game')
    const newspaper = game?.newspaperSystem?.compose?.() ?? {
      day: this._gameState.meta.dayNumber - 1,
      headline: `BOSS DAILY · DAY ${this._gameState.meta.dayNumber - 1}`,
      body: ['(no events recorded today)'],
      casualties: 0, fled: 0, mechanics: [],
    }

    const headline = this.add.text(x + 16, y + 14, newspaper.headline, {
      fontSize: '12px', color: PALETTE.textBright, fontFamily: 'monospace',
      fontStyle: 'bold', wordWrap: { width: w - 32 },
    }).setDepth(2)
    this._objects.push(headline)

    // Divider
    const div = this.add.graphics().setDepth(2)
    div.lineStyle(1, 0x445577, 0.6)
    div.beginPath()
    div.moveTo(x + 16, y + 50)
    div.lineTo(x + w - 16, y + 50)
    div.strokePath()
    this._objects.push(div)

    // Body
    const bodyText = newspaper.body.join('\n')
    const body = this.add.text(x + 16, y + 60, bodyText, {
      fontSize: '10px', color: PALETTE.textNormal, fontFamily: 'monospace',
      wordWrap: { width: w - 32 }, lineSpacing: 4,
    }).setDepth(2)
    this._objects.push(body)

    // Footer summary
    const footerY = y + h - 36
    const footerText = `Casualties: ${newspaper.casualties}    Fled: ${newspaper.fled}` +
      (newspaper.mechanics.length ? `    Active mechanics: ${newspaper.mechanics.join(', ')}` : '')
    const footer = this.add.text(x + 16, footerY, footerText, {
      fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
    }).setDepth(2)
    this._objects.push(footer)
  }

  // ── Mechanic offering panel ──────────────────────────────────────────────

  _renderOfferings(W, H) {
    const x = Math.floor(W * 0.55) + 16
    const y = 72
    const w = W - x - 32
    const h = H - y - 48

    const g = this.add.graphics().setDepth(1)
    glowPanel(g, x, y, w, h, {
      fill: 0x0a0814, border: PALETTE.accentBright, glow: PALETTE.accent,
    })
    this._objects.push(g)

    const heading = this.add.text(x + 16, y + 14, 'NEW DUNGEON MECHANIC?', {
      fontSize: '12px', color: PALETTE.textAccent, fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(2)
    this._objects.push(heading)

    const sub = this.add.text(x + 16, y + 30, 'Pick one to activate, or skip. Once active, mechanics persist into next day.', {
      fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
      wordWrap: { width: w - 32 },
    }).setDepth(2)
    this._objects.push(sub)

    const game = this.scene.get('Game')
    const sys  = game?.dungeonMechanicSystem
    if (!sys) {
      const empty = this.add.text(x + 16, y + 60, '(mechanic system not loaded)', {
        fontSize: '10px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setDepth(2)
      this._objects.push(empty)
      return
    }

    const archId = this._gameState.player?.bossArchetypeId
    const dLv    = this._gameState.meta?.dungeonLevel ?? 1
    const offers = sys.getOfferings(Balance.MECHANIC_OFFER_COUNT, archId, dLv)

    if (offers.length === 0) {
      const empty = this.add.text(x + 16, y + 60, 'No new mechanics available right now. Reach a higher dungeon level to unlock more.', {
        fontSize: '10px', color: PALETTE.textDim, fontFamily: 'monospace',
        wordWrap: { width: w - 32 },
      }).setDepth(2)
      this._objects.push(empty)
      return
    }

    const cardH = Math.floor((h - 80) / Math.max(1, offers.length)) - 12
    let cy = y + 60
    for (const def of offers) {
      this._renderOfferCard(x + 16, cy, w - 32, cardH, def, sys)
      cy += cardH + 12
    }
  }

  _renderOfferCard(x, y, w, h, def, sys) {
    const g = this.add.graphics().setDepth(2)
    glowPanel(g, x, y, w, h, {
      fill: 0x110a1f, border: PALETTE.accent, glow: PALETTE.accentDim,
    })
    this._objects.push(g)

    const name = this.add.text(x + 12, y + 10, def.name.toUpperCase(), {
      fontSize: '11px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
    }).setDepth(3)
    this._objects.push(name)

    const desc = this.add.text(x + 12, y + 28, def.description, {
      fontSize: '9px', color: PALETTE.textNormal, fontFamily: 'monospace',
      wordWrap: { width: w - 24 }, lineSpacing: 2,
    }).setDepth(3)
    this._objects.push(desc)

    const tradeY = y + 28 + desc.height + 6
    const trade = this.add.text(x + 12, tradeY,
      `Tradeoff: ${def.tradeoffDescription ?? '—'}`, {
        fontSize: '9px', color: PALETTE.textGold, fontFamily: 'monospace',
        wordWrap: { width: w - 24 }, lineSpacing: 2, fontStyle: 'italic',
      }).setDepth(3)
    this._objects.push(trade)

    // Click hit-rect
    const hit = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0xffffff, 0)
      .setDepth(4).setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => g.clear() | glowPanel(g, x, y, w, h, {
      fill: 0x1a1130, border: PALETTE.accentBright, glow: PALETTE.accent,
    }))
    hit.on('pointerout', () => g.clear() | glowPanel(g, x, y, w, h, {
      fill: 0x110a1f, border: PALETTE.accent, glow: PALETTE.accentDim,
    }))
    hit.on('pointerdown', () => this._chooseMechanic(def, sys))
    this._objects.push(hit)
  }

  // ── Skip ─────────────────────────────────────────────────────────────────

  _renderSkip(W, H) {
    const w = 140, h = 28
    const x = W - w - 32
    const y = H - h - 14

    const g = this.add.graphics().setDepth(2)
    glowPanel(g, x, y, w, h, {
      fill: 0x0a1422, border: 0x6677aa, glow: 0x223344,
    })
    this._objects.push(g)

    const t = this.add.text(x + w / 2, y + h / 2, 'SKIP — START NIGHT', {
      fontSize: '10px', color: PALETTE.textNormal, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(3)
    this._objects.push(t)

    const hit = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0xffffff, 0)
      .setDepth(4).setInteractive({ useHandCursor: true })
    hit.on('pointerdown', () => this._proceed())
    this._objects.push(hit)
  }

  _chooseMechanic(def, sys) {
    sys.activate(def.id)
    this._proceed()
  }

  _proceed() {
    SaveSystem.save(this._gameState)
    this.scene.start('NightPhase', { gameState: this._gameState })
  }
}

// Phase 10 — Graveyard scene.
//
// Persistent record of every dead adventurer (and lost minion under the
// bloodbound mechanic). Sortable + filterable in spirit; the kernel just
// renders a scrollable list with the basic facts.
//
// Reachable from:
//   - GameOver scene ("GRAVEYARD" button) → returnTo='GameOver'
//   - NightPhase debug shortcut (Phase 10b)
//
// Click an entry to show inline details; ESC or "BACK" returns.

import { PALETTE, glowPanel } from '../ui/UIKit.js'
import { PauseManager }       from '../systems/PauseManager.js'
import { classLabel }         from '../util/displayNames.js'

export class Graveyard extends Phaser.Scene {
  constructor() {
    super('Graveyard')
    this._gameState = null
    this._returnTo = 'MainMenu'
    this._scrollY = 0
    this._listY = 0
    this._maxScroll = 0
    this._listObjects = []
  }

  init(data) {
    this._gameState = data?.gameState ?? null
    this._returnTo  = data?.returnTo  ?? 'MainMenu'
  }

  create() {
    const { width: W, height: H } = this.scale
    this.add.rectangle(0, 0, W, H, 0x040409, 1).setOrigin(0).setDepth(0)

    // Title
    const tg = this.add.graphics().setDepth(1)
    glowPanel(tg, 32, 24, W - 64, 44, {
      fill: 0x0a1018, border: 0xaaaaaa, glow: 0x444466,
    })
    this.add.text(W / 2, 46, 'THE GRAVEYARD', {
      fontSize: '14px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(2)

    this._renderList(32, 84, W - 64, H - 84 - 80)

    // Back button
    const bw = 160, bh = 36
    const bx = W / 2 - bw / 2, by = H - 60
    const g = this.add.graphics().setDepth(2)
    glowPanel(g, bx, by, bw, bh, {
      fill: 0x101820, border: 0x6677aa, glow: 0x223344,
    })
    this.add.text(bx + bw / 2, by + bh / 2, 'BACK', {
      fontSize: '12px', color: PALETTE.textBright, fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(3)
    const hit = this.add.rectangle(bx + bw / 2, by + bh / 2, bw, bh, 0xffffff, 0)
      .setDepth(4).setInteractive({ useHandCursor: true })
    hit.on('pointerdown', () => this._back())

    // Mouse-wheel scroll
    this.input.on('wheel', (_p, _o, _dx, dy) => {
      this._scrollY = Phaser.Math.Clamp(this._scrollY + dy * 0.5, 0, this._maxScroll)
      this._refreshScroll()
    })

    this.input.keyboard?.on('keydown-ESC', () => PauseManager.toggle(this))
  }

  _renderList(x, y, w, h) {
    const listBg = this.add.graphics().setDepth(1)
    glowPanel(listBg, x, y, w, h, {
      fill: 0x080a14, border: PALETTE.panelBorder, glow: 0x1a1a2a,
    })

    const grave = this._gameState?.adventurers?.graveyard ?? []
    if (grave.length === 0) {
      this.add.text(x + 16, y + 16, '(no graves yet — your dungeon is suspiciously safe)', {
        fontSize: '11px', color: PALETTE.textDim, fontFamily: 'monospace',
      }).setDepth(2)
      return
    }

    // Mask container so scrolled entries clip
    const inner = this.add.container(x + 16, y + 16)
    inner.setDepth(2)
    const mask = this.make.graphics({ x: 0, y: 0, add: false })
    mask.fillRect(x + 16, y + 16, w - 32, h - 32)
    inner.setMask(mask.createGeometryMask())

    let cy = 0
    const ROW_H = 38
    for (const g of grave.slice().reverse()) {
      const lineColor = g.classId === 'mage' ? PALETTE.textCyan
                      : g.classId === 'cleric' ? '#ffeebb'
                      : g.classId === 'rogue'  ? '#aaffaa'
                      : g.classId === 'knight' ? '#ddccaa'
                      : g.classId === 'necromancer' ? '#cc99ff'
                      : g.classId === 'ranger' ? '#aaffcc'
                      : PALETTE.textNormal
      const main = this.add.text(0, cy,
        `${g.name ?? '???'}  ·  ${classLabel(g.classId, '?')}  ·  Day ${g.diedOnDay ?? '?'}`, {
          fontSize: '11px', color: lineColor, fontFamily: 'monospace', fontStyle: 'bold',
        })
      const sub = this.add.text(0, cy + 16,
        `   killed by ${g.killerName ?? 'unknown'} (${g.damageType ?? '?'}) ` +
        ((g.personalityIds ?? []).length > 0 ? `· ${g.personalityIds.join(', ')}` : ''), {
          fontSize: '9px', color: PALETTE.textDim, fontFamily: 'monospace',
        })
      inner.add([main, sub])
      this._listObjects.push(main, sub)
      cy += ROW_H
    }

    this._listY = y + 16
    this._listInner = inner
    this._listHeight = cy
    this._listViewport = h - 32
    this._maxScroll = Math.max(0, cy - this._listViewport)
  }

  _refreshScroll() {
    if (!this._listInner) return
    this._listInner.y = this._listY - this._scrollY
  }

  _back() {
    if (this._gameState) this.scene.start(this._returnTo, { gameState: this._gameState })
    else this.scene.start(this._returnTo)
  }
}

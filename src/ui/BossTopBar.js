// Phase 31C — top HUD bar.
// Replaces the bottom-center BossHpPanel with the design's top-bar layout:
// 3-column strip across the top of the screen showing the boss avatar +
// HP, the current day, and the player's two resources.
//
// Lives in HudScene, runs across both NightPhase and DayPhase. Reads
// gameState directly each update() — no event subscriptions needed.
//
// Avatar click emits 'OPEN_BOSS_OVERVIEW' for the popup that lands in
// Phase 31E (until then, the click is a harmless no-op except for the
// event emission).

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelBar } from './UIKit.js'
import { EventBus } from '../systems/EventBus.js'

const BAR_H        = 64
const PADDING_X    = 14
const SEP_DEPTH    = 11
const TEXT_DEPTH   = 12

export class BossTopBar {
  constructor(scene, gameState, opts = {}) {
    this._scene     = scene
    this._gameState = gameState
    this._depth     = opts.depth ?? 60
    this._objects   = []

    const W = scene.uiW ?? 1280
    this._W = W

    // Resolve archetype display name
    const archs  = scene.cache.json.get('bossArchetypes') ?? []
    const arch   = archs.find(a => a.id === gameState.player?.bossArchetypeId)
    this._bossClass = (arch?.name ?? 'Boss').toUpperCase()
    this._bossName  = (arch?.name ?? 'Unnamed') // bosses don't have unique names yet

    this._build()
  }

  _build() {
    const W = this._W
    const D = this._depth

    // Background pixel panel running full width
    const bg = this._scene.add.graphics().setDepth(D)
    pixelPanel(bg, 0, 0, W, BAR_H)
    this._objects.push(bg)

    // Two vertical separators at column splits
    const colLeftW    = 320
    const colRightW   = 360
    this._colLeftW  = colLeftW
    this._colRightW = colRightW
    const sepLX = colLeftW
    const sepRX = W - colRightW

    const sep = this._scene.add.graphics().setDepth(D + SEP_DEPTH)
    sep.fillStyle(CRYPT.panelEdgeS, 1)
    sep.fillRect(sepLX,     2, 2, BAR_H - 4)
    sep.fillRect(sepLX + 2, 2, 1, BAR_H - 4)
    sep.fillStyle(CRYPT.panelEdgeS, 1)
    sep.fillRect(sepRX,     2, 2, BAR_H - 4)
    sep.fillRect(sepRX + 2, 2, 1, BAR_H - 4)
    this._objects.push(sep)

    this._buildLeftCol(0, colLeftW)
    this._buildCenterCol(sepLX, sepRX - sepLX)
    this._buildRightCol(sepRX, colRightW)
  }

  _buildLeftCol(x, w) {
    const D = this._depth + TEXT_DEPTH
    const cx = x + PADDING_X
    const cy = 10
    const avatarSize = 44

    // Avatar box (interactive — opens Boss Overview popup in 31E)
    const avG = this._scene.add.graphics().setDepth(this._depth + 1)
    pixelPanel(avG, cx, cy, avatarSize, avatarSize, {
      fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeH, edgeS: CRYPT.panelEdgeS,
    })
    this._objects.push(avG)

    // Boss portrait — 22×22 pixel-art bust loaded as 'bestiary-portrait-{id}'.
    // Falls back to a crown glyph if the boss doesn't have a portrait asset.
    const portraitKey = `bestiary-portrait-${this._gameState.player?.bossArchetypeId}`
    let avSym
    if (this._scene.textures.exists(portraitKey)) {
      avSym = this._scene.add.image(cx + avatarSize / 2, cy + avatarSize / 2, portraitKey)
        .setDisplaySize(avatarSize - 6, avatarSize - 6)
        .setDepth(D + 1)
    } else {
      avSym = this._scene.add.text(cx + avatarSize / 2, cy + avatarSize / 2, '♛', {
        fontFamily: FONT_HEAD, fontSize: '22px', color: CRYPT.accent2Css,
      }).setOrigin(0.5).setDepth(D + 1)
    }
    this._objects.push(avSym)
    this._avSym = avSym

    // Click zone
    const hit = this._scene.add.zone(cx, cy, avatarSize, avatarSize)
      .setOrigin(0).setDepth(D + 2).setInteractive({ useHandCursor: true })
    hit.on('pointerover', () => {
      if (avSym.setColor) avSym.setColor('#ffffff')
      else avSym.setTint?.(0xffffff)
    })
    hit.on('pointerout',  () => {
      if (avSym.setColor) avSym.setColor(CRYPT.accent2Css)
      else avSym.clearTint?.()
    })
    hit.on('pointerup',   () => EventBus.emit('OPEN_BOSS_OVERVIEW'))
    this._objects.push(hit)

    // Caption: "{CLASS} · DAY {N}"
    this._captionT = this._scene.add.text(cx + avatarSize + 10, cy + 4,
      this._captionText(), {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setDepth(D)
    this._objects.push(this._captionT)

    // Boss name
    this._nameT = this._scene.add.text(cx + avatarSize + 10, cy + 16,
      this._bossName, {
        fontFamily: FONT_HEAD, fontSize: '11px', color: CRYPT.ink, letterSpacing: 1,
      }).setDepth(D)
    this._objects.push(this._nameT)

    // HP bar
    const barX = cx + avatarSize + 10
    const barY = cy + 32
    const barW = w - (barX - x) - PADDING_X
    const boss = this._gameState.boss
    const hp   = boss?.hp ?? 100
    const max  = boss?.maxHp ?? 100
    this._hpBar = pixelBar(this._scene, barX, barY, barW, 12, hp, max, {
      color: 'red', label: `${hp} / ${max}`, depth: D, fontSize: 8,
    })
    this._objects.push(this._hpBar.g, this._hpBar.txt)
  }

  _buildCenterCol(x, w) {
    const D = this._depth + TEXT_DEPTH
    const cx = x + w / 2

    // "DAY N" big number
    this._dayT = this._scene.add.text(cx, 14, this._dayText(), {
      fontFamily: FONT_HEAD, fontSize: '11px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setOrigin(0.5).setDepth(D)
    this._objects.push(this._dayT)

    this._dayBigT = this._scene.add.text(cx, 30, this._dayBigText(), {
      fontFamily: FONT_HEAD, fontSize: '18px', color: CRYPT.accent2Css, letterSpacing: 1,
    }).setOrigin(0.5).setDepth(D)
    this._objects.push(this._dayBigT)

    // Subline: kills + active adventurers
    this._subT = this._scene.add.text(cx, 50, this._sublineText(), {
      fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.inkDim, letterSpacing: 1,
    }).setOrigin(0.5).setDepth(D)
    this._objects.push(this._subT)
  }

  _buildRightCol(x, w) {
    const D = this._depth + TEXT_DEPTH
    const cx = x + PADDING_X

    // Header
    const hdr = this._scene.add.text(cx, 8, 'TREASURY', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D)
    this._objects.push(hdr)

    // Resource rows: Gold + Dark Power
    const rowY = 24
    const rows = [
      { lbl: 'GOLD',       color: CRYPT.goldCss,   icon: '◆', getter: () => this._gameState.player?.soulEssence ?? 0 },
      { lbl: 'DARK POWER', color: CRYPT.accent2Css, icon: '✦', getter: () => this._gameState.player?.darkPower ?? 0 },
    ]
    this._resTexts = []
    let rx = cx
    for (const r of rows) {
      const ico = this._scene.add.text(rx, rowY + 6, r.icon, {
        fontFamily: FONT_HEAD, fontSize: '12px', color: r.color,
      }).setOrigin(0, 0.5).setDepth(D)
      this._objects.push(ico)

      const val = this._scene.add.text(rx + 18, rowY, this._formatNumber(r.getter()), {
        fontFamily: FONT_BODY, fontSize: '14px', color: r.color, letterSpacing: 1,
      }).setOrigin(0, 0.5).setDepth(D)
      this._objects.push(val)

      const lbl = this._scene.add.text(rx + 18, rowY + 14, r.lbl, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setOrigin(0, 0).setDepth(D)
      this._objects.push(lbl)

      this._resTexts.push({ value: val, getter: r.getter })
      rx += (w - PADDING_X * 2) / rows.length
    }
  }

  _captionText() {
    const day = this._gameState.meta?.dayNumber ?? 1
    return `${this._bossClass} · DAY ${day}`
  }

  _dayText()    { return 'CURRENT DAY' }
  _dayBigText() { return `DAY ${this._gameState.meta?.dayNumber ?? 1}` }

  _sublineText() {
    const kills  = this._gameState.player?.totalKills ?? 0
    const active = this._gameState.adventurers?.active?.length ?? 0
    const phase  = this._gameState.meta?.phase ?? 'night'
    if (phase === 'day' && active > 0) return `${active} ACTIVE · ${kills} KILLS`
    return `${kills} KILLS THIS RUN`
  }

  _formatNumber(n) {
    return Number(n).toLocaleString('en-US')
  }

  // Called by HudScene's update loop. Cheap polling — boss HP / day / resources
  // refresh every frame. We could subscribe to events instead, but polling 5
  // numeric reads per frame is cheaper than wiring up half a dozen listeners.
  update() {
    if (!this._gameState) return
    const boss = this._gameState.boss
    if (boss && this._hpBar) {
      this._hpBar.update(boss.hp ?? 0, boss.maxHp ?? 100, `${boss.hp ?? 0} / ${boss.maxHp ?? 0}`)
    }
    if (this._captionT) this._captionT.setText(this._captionText())
    if (this._dayBigT) this._dayBigT.setText(this._dayBigText())
    if (this._subT)    this._subT.setText(this._sublineText())
    for (const r of (this._resTexts ?? [])) {
      r.value.setText(this._formatNumber(r.getter()))
    }
  }

  destroy() {
    this._objects.forEach(o => o?.destroy?.())
    this._objects = []
    this._hpBar = null
  }
}

export const BOSS_TOP_BAR_HEIGHT = BAR_H

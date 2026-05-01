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

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelBar, pixelDiamond } from './UIKit.js'
import { EventBus } from '../systems/EventBus.js'

const BAR_H        = 56
const PADDING_X    = 12
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

    // Per-day spawn / kill / escape counters for the center "X of N
    // survived" bar. Reset on NIGHT_PHASE_BEGAN. Updated by event listeners
    // wired in _wireEvents below.
    this._daySpawned = 0
    this._dayKilled  = 0
    this._dayEscaped = 0

    // Background pixel panel running full width
    const bg = this._scene.add.graphics().setDepth(D)
    pixelPanel(bg, 0, 0, W, BAR_H)
    this._objects.push(bg)

    // Two vertical separators at column splits — narrower columns to give
    // the center wave/survival display more room.
    const colLeftW    = 290
    const colRightW   = 290
    this._colLeftW  = colLeftW
    this._colRightW = colRightW
    const sepLX = colLeftW
    const sepRX = W - colRightW

    const sep = this._scene.add.graphics().setDepth(D + SEP_DEPTH)
    sep.fillStyle(CRYPT.panelEdgeS, 1)
    sep.fillRect(sepLX,     2, 2, BAR_H - 4)
    sep.fillRect(sepRX,     2, 2, BAR_H - 4)
    this._objects.push(sep)

    this._buildLeftCol(0, colLeftW)
    this._buildCenterCol(sepLX, sepRX - sepLX)
    this._buildRightCol(sepRX, colRightW)
    this._wireEvents()
  }

  _wireEvents() {
    this._listeners = []
    const on = (event, fn) => {
      EventBus.on(event, fn, this)
      this._listeners.push([event, fn])
    }
    // Reset day counters when night begins (so the bar returns to empty
    // at the start of every fresh build phase).
    on('NIGHT_PHASE_BEGAN', () => {
      this._daySpawned = 0
      this._dayKilled  = 0
      this._dayEscaped = 0
    })
    on('ADVENTURER_ENTERED_DUNGEON', () => { this._daySpawned++ })
    on('ADVENTURER_DIED',            () => { this._dayKilled++  })
    on('ADVENTURER_FLED',            () => { this._dayEscaped++ })
  }

  _buildLeftCol(x, w) {
    const D = this._depth + TEXT_DEPTH
    const cx = x + PADDING_X
    const cy = 6
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

    // Click zone — same press-down feedback as the action-bar buttons:
    // panel + sprite shift 1 px on pointerdown, snap back on pointerup.
    const hit = this._scene.add.zone(cx, cy, avatarSize, avatarSize)
      .setOrigin(0).setDepth(D + 2).setInteractive({ useHandCursor: true })
    let pressed = false
    const repaintAvatar = (offset) => {
      avG.clear()
      pixelPanel(avG, cx + offset, cy + offset, avatarSize, avatarSize, {
        fill: CRYPT.bgStone2,
        edgeH: pressed ? CRYPT.panelEdgeS : CRYPT.panelEdgeH,
        edgeS: pressed ? CRYPT.panelEdgeH : CRYPT.panelEdgeS,
        inset: pressed,
      })
      if (avSym.setOrigin && typeof avSym.x === 'number') {
        avSym.setPosition(cx + avatarSize / 2 + offset, cy + avatarSize / 2 + offset)
      }
    }
    hit.on('pointerover', () => {
      if (avSym.setColor) avSym.setColor('#ffffff')
      else avSym.setTint?.(0xffffff)
    })
    hit.on('pointerout',  () => {
      pressed = false
      repaintAvatar(0)
      if (avSym.setColor) avSym.setColor(CRYPT.accent2Css)
      else avSym.clearTint?.()
    })
    hit.on('pointerdown', () => { pressed = true;  repaintAvatar(1) })
    hit.on('pointerup',   () => {
      const wasPressed = pressed
      pressed = false
      repaintAvatar(0)
      if (wasPressed) EventBus.emit('OPEN_BOSS_OVERVIEW')
    })
    this._objects.push(hit)

    // Caption row: "{CLASS} · DAY {N}" on the left, "LV {dungeonLevel}"
    // tag pinned to the right of the boss name. Provides the boss-level
    // readout the user wants without taking another full row.
    this._captionT = this._scene.add.text(cx + avatarSize + 10, cy + 2,
      this._captionText(), {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setDepth(D)
    this._objects.push(this._captionT)

    // Boss name
    this._nameT = this._scene.add.text(cx + avatarSize + 10, cy + 14,
      this._bossName, {
        fontFamily: FONT_HEAD, fontSize: '11px', color: CRYPT.ink, letterSpacing: 1,
      }).setDepth(D)
    this._objects.push(this._nameT)

    // LV badge — anchored at the right edge of the left column
    this._levelT = this._scene.add.text(x + w - PADDING_X, cy + 2,
      this._levelText(), {
        fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.goldCss, letterSpacing: 1,
      }).setOrigin(1, 0).setDepth(D)
    this._objects.push(this._levelT)

    // HP bar
    const barX = cx + avatarSize + 10
    const barY = cy + 30
    const barW = w - (barX - x) - PADDING_X
    const boss = this._gameState.boss
    const hp   = boss?.hp ?? 100
    const max  = boss?.maxHp ?? 100
    this._hpBar = pixelBar(this._scene, barX, barY, barW, 11, hp, max, {
      color: 'red', label: `${hp} / ${max}`, depth: D, fontSize: 8,
    })
    this._objects.push(this._hpBar.g, this._hpBar.txt)
  }

  _levelText() {
    return `LV ${this._gameState.meta?.dungeonLevel ?? 1}`
  }

  _buildCenterCol(x, w) {
    const D = this._depth + TEXT_DEPTH
    const cx = x + w / 2

    // "DAY N" caption
    this._dayT = this._scene.add.text(cx, 8, this._dayText(), {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setOrigin(0.5).setDepth(D)
    this._objects.push(this._dayT)

    this._dayBigT = this._scene.add.text(cx, 22, this._dayBigText(), {
      fontFamily: FONT_HEAD, fontSize: '14px', color: CRYPT.accent2Css, letterSpacing: 1,
    }).setOrigin(0.5).setDepth(D)
    this._objects.push(this._dayBigT)

    // Survival bar — fills cyan as adventurers leave the dungeon alive
    // (escaped). Cap of max(spawned, 1) to avoid empty-divide; while
    // spawnedToday=0 the bar reads 0/0 and renders empty. 50% wider per
    // user request so the day-progress is more visually present.
    const barW = Math.min(w - 32, 300)
    const barX = cx - barW / 2
    const barY = 36
    // Bar height bumped to 14 so the white label inside reads cleanly.
    this._survivalBar = pixelBar(this._scene, barX, barY, barW, 14,
      this._dayEscaped, Math.max(1, this._daySpawned),
      { color: 'cyan', label: this._survivalText(), depth: D, fontSize: 7 })
    this._objects.push(this._survivalBar.g)
    if (this._survivalBar.txt) this._objects.push(this._survivalBar.txt)
  }

  _buildRightCol(x, w) {
    const D = this._depth + TEXT_DEPTH
    const startX = x + PADDING_X

    // Header — diamond + label, matches the other panels' ornament style
    const dia = this._scene.add.graphics().setDepth(D)
    pixelDiamond(dia, startX + 4, 12, 4, CRYPT.accent)
    this._objects.push(dia)
    const hdr = this._scene.add.text(startX + 14, 8, 'TREASURY', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D)
    this._objects.push(hdr)

    // Resource rows: Gold + Dark Power. Icon + value share a single
    // baseline so they never drift; the small label sits underneath.
    const yMid = 26    // shared icon+value vertical center
    const yLbl = 38    // small caption baseline
    const rows = [
      { lbl: 'GOLD',       color: CRYPT.goldCss,    icon: '◆', getter: () => this._gameState.player?.soulEssence ?? 0 },
      { lbl: 'DARK POWER', color: CRYPT.accent2Css, icon: '✦', getter: () => this._gameState.player?.darkPower ?? 0 },
    ]
    this._resTexts = []
    const colW = (w - PADDING_X * 2) / rows.length
    rows.forEach((r, i) => {
      const rx = startX + i * colW

      const ico = this._scene.add.text(rx, yMid, r.icon, {
        fontFamily: FONT_HEAD, fontSize: '11px', color: r.color,
      }).setOrigin(0, 0.5).setDepth(D)
      this._objects.push(ico)

      const val = this._scene.add.text(rx + 16, yMid, this._formatNumber(r.getter()), {
        fontFamily: FONT_HEAD, fontSize: '12px', color: r.color, letterSpacing: 1,
      }).setOrigin(0, 0.5).setDepth(D)
      this._objects.push(val)

      const lbl = this._scene.add.text(rx + 16, yLbl, r.lbl, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setOrigin(0, 0).setDepth(D)
      this._objects.push(lbl)

      this._resTexts.push({ value: val, getter: r.getter })
    })
  }

  _captionText() {
    const day = this._gameState.meta?.dayNumber ?? 1
    return `${this._bossClass} · DAY ${day}`
  }

  _dayText()    { return 'CURRENT DAY' }
  _dayBigText() { return `DAY ${this._gameState.meta?.dayNumber ?? 1}` }

  _survivalText() {
    if (this._daySpawned === 0) return 'NO ADVENTURERS YET'
    return `${this._dayEscaped} OF ${this._daySpawned} SURVIVED`
  }

  _formatNumber(n) {
    return Number(n).toLocaleString('en-US')
  }

  // Called by HudScene's update loop. Cheap polling — boss HP / day /
  // resources refresh every frame. We could subscribe to events instead,
  // but polling a handful of numeric reads per frame is cheaper than
  // wiring up half a dozen listeners.
  update() {
    if (!this._gameState) return
    const boss = this._gameState.boss
    if (boss && this._hpBar) {
      this._hpBar.update(boss.hp ?? 0, boss.maxHp ?? 100, `${boss.hp ?? 0} / ${boss.maxHp ?? 0}`)
    }
    if (this._captionT) this._captionT.setText(this._captionText())
    if (this._levelT)   this._levelT.setText(this._levelText())
    if (this._dayBigT)  this._dayBigT.setText(this._dayBigText())
    if (this._survivalBar) {
      this._survivalBar.update(
        this._dayEscaped,
        Math.max(1, this._daySpawned),
        this._survivalText(),
      )
    }
    for (const r of (this._resTexts ?? [])) {
      r.value.setText(this._formatNumber(r.getter()))
    }
  }

  destroy() {
    if (this._listeners) {
      for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
      this._listeners = []
    }
    this._objects.forEach(o => o?.destroy?.())
    this._objects = []
    this._hpBar = null
    this._survivalBar = null
  }
}

export const BOSS_TOP_BAR_HEIGHT = BAR_H

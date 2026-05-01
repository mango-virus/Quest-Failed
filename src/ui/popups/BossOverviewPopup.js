// Phase 31E — Boss Overview popup.
//
// Two-column layout: boss card on the left (portrait + name + HP / Dark
// Power bars + run stats), Active Pacts grid + Dungeon Census tiles on
// the right. Boss unique ability surfaces from bossArchetypes.json's
// `headline` field. Active pacts come from gameState.history.pacts
// (Phase 31I plumbing).

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelBar, pixelDiamond } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'

export class BossOverviewPopup {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._frame = makePopupFrame({
      scene,
      w:    900,
      h:    560,
      title:'BOSS OVERVIEW',
      depth: 200,
      render: (px, py, cx, cy, cw, ch, addChild) => this._render(cx, cy, cw, ch, addChild),
    })
  }

  open()  { this._frame.open() }
  close() { this._frame.close() }
  destroy() { this.close() }

  _render(cx, cy, cw, ch, addChild) {
    const D = 205
    const leftW = 340
    const gap   = 16

    this._renderBossCard(cx, cy, leftW, ch, D, addChild)
    this._renderRightColumn(cx + leftW + gap, cy, cw - leftW - gap, ch, D, addChild)
  }

  _renderBossCard(x, y, w, h, D, addChild) {
    const arch = this._archetypeDef()
    const boss = this._gameState.boss
    const totals = this._gameState.run?.totals ?? {}

    // Card panel
    const card = this._scene.add.graphics().setDepth(D)
    pixelPanel(card, x, y, w, h, { fill: CRYPT.bgStone1 })
    addChild(card)

    // Portrait box
    const portraitH = 180
    const portraitG = this._scene.add.graphics().setDepth(D + 1)
    pixelPanel(portraitG, x + 14, y + 14, w - 28, portraitH, {
      fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(portraitG)

    const portraitKey = `bestiary-portrait-${arch?.id ?? this._gameState.player?.bossArchetypeId}`
    if (this._scene.textures.exists(portraitKey)) {
      const img = this._scene.add.image(x + w / 2, y + 14 + portraitH / 2, portraitKey)
        .setDisplaySize(portraitH - 32, portraitH - 32)
        .setDepth(D + 2)
      addChild(img)
    } else {
      addChild(this._scene.add.text(x + w / 2, y + 14 + portraitH / 2, '♛', {
        fontFamily: FONT_HEAD, fontSize: '64px', color: CRYPT.accent2Css,
      }).setOrigin(0.5).setDepth(D + 2))
    }

    // Class caption + boss name
    let yy = y + 14 + portraitH + 14
    addChild(this._scene.add.text(x + 14, yy,
      (arch?.name ?? this._gameState.player?.bossArchetypeId ?? 'Boss').toUpperCase(), {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D + 2))
    yy += 12
    addChild(this._scene.add.text(x + 14, yy, arch?.tagline ?? 'Unnamed reign', {
      fontFamily: FONT_HEAD, fontSize: '12px', color: CRYPT.ink, letterSpacing: 1,
    }).setDepth(D + 2))
    yy += 22

    // HP bar
    addChild(this._scene.add.text(x + 14, yy, 'HEALTH', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D + 2))
    yy += 12
    const hpBar = pixelBar(this._scene, x + 14, yy, w - 28, 14,
      boss?.hp ?? 0, boss?.maxHp ?? 100,
      { color: 'red', label: `${boss?.hp ?? 0} / ${boss?.maxHp ?? 0}`, depth: D + 2, fontSize: 8 })
    addChild(hpBar.g, hpBar.txt)
    yy += 22

    // Dark Power bar (capped at 100)
    addChild(this._scene.add.text(x + 14, yy, 'DARK POWER', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D + 2))
    yy += 12
    const dp = this._gameState.player?.darkPower ?? 0
    const dpBar = pixelBar(this._scene, x + 14, yy, w - 28, 14, Math.min(dp, 100), 100,
      { color: 'cyan', label: `${dp}`, depth: D + 2, fontSize: 8 })
    addChild(dpBar.g, dpBar.txt)
    yy += 24

    // Stats list
    const stats = [
      ['KILLS',          this._gameState.player?.totalKills ?? 0],
      ['DAMAGE DEALT',   totals.dmgDealt   ?? 0],
      ['DAMAGE TAKEN',   totals.dmgTaken   ?? 0],
      ['ADVS ESCAPED',   totals.advsEscaped ?? 0],
      ['DAY',            this._gameState.meta?.dayNumber ?? 1],
    ]
    for (const [k, v] of stats) {
      addChild(this._scene.add.text(x + 14, yy, k, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setDepth(D + 2))
      addChild(this._scene.add.text(x + w - 14, yy,
        typeof v === 'number' ? v.toLocaleString('en-US') : String(v), {
        fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
      }).setOrigin(1, 0).setDepth(D + 2))
      yy += 14
    }
  }

  _renderRightColumn(x, y, w, h, D, addChild) {
    // Top section: boss unique ability
    const abilityH = 90
    const abilityG = this._scene.add.graphics().setDepth(D)
    pixelPanel(abilityG, x, y, w, abilityH, { fill: CRYPT.bgStone1 })
    addChild(abilityG)

    const abilityHeader = this._sectionHeader(x, y, w, 'UNIQUE ABILITY', D, addChild)
    const headline = this._archetypeDef()?.headline
    const abilityName = headline?.name ?? '— pending implementation —'
    const abilitySummary = headline?.summary ?? 'This boss class does not yet have a unique ability defined.'

    addChild(this._scene.add.text(x + 14, y + 30, abilityName.toUpperCase(), {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.accent2Css, letterSpacing: 1,
    }).setDepth(D + 2))
    addChild(this._scene.add.text(x + 14, y + 46, abilitySummary, {
      fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.ink, letterSpacing: 1,
      wordWrap: { width: w - 28, useAdvancedWrap: true }, lineSpacing: 4,
    }).setDepth(D + 2))

    // Middle section: Active Pacts
    const pactsY = y + abilityH + 12
    const pactsH = 200
    const pactsG = this._scene.add.graphics().setDepth(D)
    pixelPanel(pactsG, x, pactsY, w, pactsH, { fill: CRYPT.bgStone1 })
    addChild(pactsG)
    const pacts = this._gameState.history?.pacts ?? []
    this._sectionHeader(x, pactsY, w, `ACTIVE PACTS · ${pacts.length}`, D, addChild)
    this._renderPacts(x + 12, pactsY + 30, w - 24, pactsH - 36, pacts, D, addChild)

    // Bottom section: Dungeon Census
    const censusY = pactsY + pactsH + 12
    const censusH = h - (censusY - y)
    const censusG = this._scene.add.graphics().setDepth(D)
    pixelPanel(censusG, x, censusY, w, censusH, { fill: CRYPT.bgStone1 })
    addChild(censusG)
    this._sectionHeader(x, censusY, w, 'DUNGEON CENSUS', D, addChild)
    this._renderCensus(x + 12, censusY + 30, w - 24, censusH - 36, D, addChild)
  }

  _sectionHeader(x, y, w, text, D, addChild) {
    const dia = this._scene.add.graphics().setDepth(D + 2)
    pixelDiamond(dia, x + 10, y + 14, 3, CRYPT.accent2)
    addChild(dia)
    const t = this._scene.add.text(x + 22, y + 14, text, {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(D + 2)
    addChild(t)
    return t
  }

  _renderPacts(x, y, w, h, pacts, D, addChild) {
    if (pacts.length === 0) {
      addChild(this._scene.add.text(x + w / 2, y + h / 2, '— NO PACTS YET —', {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
      return
    }
    const cols = 2
    const rowH = 36
    const colW = Math.floor(w / cols)
    pacts.slice(-6).forEach((p, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const px = x + col * colW
      const py = y + row * rowH
      const cardG = this._scene.add.graphics().setDepth(D + 2)
      pixelPanel(cardG, px, py, colW - 6, rowH - 4, {
        fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
      })
      addChild(cardG)
      addChild(this._scene.add.text(px + 8, py + 4, `D${p.day}`, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setDepth(D + 3))
      addChild(this._scene.add.text(px + 8, py + 16, this._mechName(p.mechanicId).toUpperCase(), {
        fontFamily: FONT_HEAD, fontSize: '9px', color: this._rarityColor(p.rarity), letterSpacing: 1,
      }).setDepth(D + 3))
    })
  }

  _renderCensus(x, y, w, h, D, addChild) {
    const dungeon = this._gameState.dungeon ?? {}
    const counts = [
      { label: 'ROOMS',   value: (dungeon.rooms ?? []).length,    color: CRYPT.goldCss   },
      { label: 'MINIONS', value: (this._gameState.minions ?? []).filter(m => m.aiState !== 'dead').length, color: CRYPT.greenCss },
      { label: 'TRAPS',   value: (dungeon.traps ?? []).length,    color: CRYPT.accent2Css },
      { label: 'DOORS',   value: (dungeon.corridors ?? []).length, color: CRYPT.inkDim   },
    ]
    const cols = 4
    const colW = Math.floor(w / cols)
    counts.forEach((c, i) => {
      const px = x + i * colW
      const tileG = this._scene.add.graphics().setDepth(D + 2)
      pixelPanel(tileG, px, y, colW - 6, h, {
        fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
      })
      addChild(tileG)
      addChild(this._scene.add.text(px + (colW - 6) / 2, y + h / 2 - 6, String(c.value), {
        fontFamily: FONT_HEAD, fontSize: '18px', color: c.color, letterSpacing: 1,
      }).setOrigin(0.5).setDepth(D + 3))
      addChild(this._scene.add.text(px + (colW - 6) / 2, y + h - 8, c.label, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5, 1).setDepth(D + 3))
    })
  }

  _archetypeDef() {
    const archs = this._scene.cache.json.get('bossArchetypes') ?? []
    return archs.find(a => a.id === this._gameState.player?.bossArchetypeId)
  }

  _mechName(id) {
    const all = this._scene.cache.json.get('dungeonMechanics') ?? []
    return all.find(m => m.id === id)?.name ?? id
  }

  _rarityColor(r) {
    return r === 'legendary' ? CRYPT.accentCss
         : r === 'epic'      ? CRYPT.soulCss
         : r === 'rare'      ? CRYPT.goldCss
         : CRYPT.ink
  }
}

// SUPERSEDED (Phase 34) — replaced by `src/hud/BossOverviewOverlay.js`.
//
// Phase 31E — Boss Overview popup.
//
// Two-column layout: boss card on the left (portrait + name + HP / XP
// bars + run stats), Active Pacts grid + Dungeon Census tiles on the
// right. Boss unique ability surfaces from bossArchetypes.json's
// `headline` field. Active pacts come from gameState.history.pacts
// (Phase 31I plumbing).

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelBar, pixelDiamond } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'
import { EventBus } from '../../systems/EventBus.js'

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

    // Portrait box — tall enough that the boss sprite renders at a
    // satisfying ~244 px (vs the old 148 px when this was 180 tall).
    // Card height (h) easily fits this + the name/HP/XP/stats stack
    // (≈180 px) within the popup's 560 px frame.
    const portraitH = 260
    const portraitG = this._scene.add.graphics().setDepth(D + 1)
    pixelPanel(portraitG, x + 14, y + 14, w - 28, portraitH, {
      fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(portraitG)

    // Use the boss's idle-down sprite (the sheet's first row is 'down'
    // per Preload's DEFAULT_ROW_DIRS). Switched from `add.image` to
    // `add.sprite` so we can play the looping idle-down animation
    // registered by Preload._registerBossAnimations. Scale uses
    // setScale (preserves aspect, unlike setDisplaySize) and aims to
    // fill the portrait box with a small breathing margin.
    const bossId    = arch?.id ?? this._gameState.player?.bossArchetypeId
    const idleKey   = `${bossId}-idle`
    const portKey   = `bestiary-portrait-${bossId}`
    const cxImg     = x + w / 2
    const cyImg     = y + 14 + portraitH / 2
    if (this._scene.textures.exists(idleKey)) {
      // Probe the frame size first so we can pick a sensible vertical bias
      // before instantiating the sprite. 128-frame boss sheets centre the
      // character in the upper portion of their frame (transparent padding
      // around it), so we shove the sprite down ~30 px to put feet near
      // the box bottom. 64-frame sheets have the character filling the
      // frame, so a tiny bias is enough.
      const probeTex = this._scene.textures.get(idleKey)
      const probeFw  = probeTex?.frames?.['__BASE']?.width
                    ?? probeTex?.source?.[0]?.width
                    ?? 64
      // Succubus's idle sheet is feet-anchored (sliced with `anchor: 'feet'`),
      // so a positive bias drops her feet below the portrait box. Pull her
      // UP so she sits inside the panel without bottom clipping.
      let VERT_BIAS = probeFw >= 128 ? 30 : 6
      if (bossId === 'succubus') VERT_BIAS = -14
      const cyImg2 = y + 14 + portraitH / 2 + VERT_BIAS
      const sprite = this._scene.add.sprite(cxImg, cyImg2, idleKey, 0).setDepth(D + 2)
      const fw = sprite.frame?.width  || 64
      // Boss sheets ship two frame sizes: 64 (most bosses) and 128 (demon,
      // golem). 128-frame sheets centre a ~64-px character with transparent
      // padding around it, which made earlier "fit the frame" math under-
      // size them. Treat both as 64-px content and let any padding
      // overflow the portrait box — a geometry mask below clips it cleanly.
      const effectiveChar = fw >= 128 ? 64 : fw
      const PADDING       = 4
      const maxH          = portraitH - PADDING * 2
      const scale         = maxH / effectiveChar
      sprite.setScale(scale)
      sprite.texture?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
      // Clip the sprite to the portrait box so a 128-frame sheet's
      // transparent / sprite-edge pixels don't poke past the popup chrome.
      const maskG = this._scene.make.graphics({ x: 0, y: 0, add: false })
      maskG.fillStyle(0xffffff)
      maskG.fillRect(x + 14, y + 14, w - 28, portraitH)
      sprite.setMask(maskG.createGeometryMask())
      const animKey = `${idleKey}-down`
      if (this._scene.anims.exists(animKey)) sprite.play(animKey)
      addChild(sprite)
    } else if (this._scene.textures.exists(portKey)) {
      const img = this._scene.add.image(cxImg, cyImg, portKey)
        .setDisplaySize(portraitH - 32, portraitH - 32)
        .setDepth(D + 2)
      addChild(img)
    } else {
      addChild(this._scene.add.text(cxImg, cyImg, '♛', {
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

    // XP bar — progress toward next dungeon level
    addChild(this._scene.add.text(x + 14, yy, 'EXPERIENCE', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D + 2))
    yy += 12
    const xp    = this._gameState.meta?.xp ?? 0
    const xpMax = Math.max(1, this._gameState.meta?.xpToNext ?? 100)
    const xpBar = pixelBar(this._scene, x + 14, yy, w - 28, 14, xp, xpMax,
      { color: 'green', label: `${xp} / ${xpMax}`, depth: D + 2, fontSize: 8 })
    addChild(xpBar.g, xpBar.txt)
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
    // Top section: archetype ability card. Each archetype ships a
    // `headline` and one or more `mechanics`; we collect them into a
    // single list and let the player flip through with a ▶ arrow on the
    // right side of the panel.
    const arch = this._archetypeDef()
    const abilities = []
    if (arch?.headline) {
      abilities.push({ name: arch.headline.name, summary: arch.headline.summary })
    }
    for (const m of arch?.mechanics ?? []) {
      // mechanics entries are usually a single descriptive `text` line;
      // split off the leading "Name —" so it can be shown as the title.
      const t = m.text ?? ''
      const dashIdx = t.indexOf(' — ')
      if (dashIdx > 0) {
        abilities.push({ name: t.slice(0, dashIdx), summary: t.slice(dashIdx + 3) })
      } else {
        abilities.push({ name: 'Mechanic', summary: t })
      }
    }
    if (abilities.length === 0) {
      abilities.push({ name: '— pending implementation —', summary: 'This boss class does not yet have a unique ability defined.' })
    }

    const abilityH = 90
    const abilityG = this._scene.add.graphics().setDepth(D)
    pixelPanel(abilityG, x, y, w, abilityH, { fill: CRYPT.bgStone1 })
    addChild(abilityG)

    // Persist the current page across re-opens of the popup so the player
    // doesn't lose their place when other UI re-renders trigger a rebuild.
    if (this._abilityIdx == null || this._abilityIdx >= abilities.length) this._abilityIdx = 0
    const pageLabel = (idx) => abilities.length > 1 ? ` · ${idx + 1} / ${abilities.length}` : ''
    const headerT = this._sectionHeader(x, y, w, `ABILITY${pageLabel(this._abilityIdx)}`, D, addChild)

    const cur = abilities[this._abilityIdx]
    // Reserve room on the right for the page-turn arrow when more than one ability exists.
    const arrowReserve = abilities.length > 1 ? 28 : 0
    const nameT = this._scene.add.text(x + 14, y + 30, cur.name.toUpperCase(), {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.accent2Css, letterSpacing: 1,
      wordWrap: { width: w - 28 - arrowReserve, useAdvancedWrap: true },
    }).setDepth(D + 2)
    const sumT = this._scene.add.text(x + 14, y + 46, cur.summary ?? '', {
      fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.ink, letterSpacing: 1,
      wordWrap: { width: w - 28 - arrowReserve, useAdvancedWrap: true }, lineSpacing: 4,
    }).setDepth(D + 2)
    addChild(nameT)
    addChild(sumT)

    // Page-turn arrow (right edge, vertically centred in the card). Only
    // shown when there's something to flip to. Click cycles through the
    // ability list and re-renders the name + summary in place.
    if (abilities.length > 1) {
      const arrowX = x + w - 22
      const arrowY = y + abilityH / 2 + 4
      const arrow = this._scene.add.text(arrowX, arrowY, '▶', {
        fontFamily: FONT_HEAD, fontSize: '14px', color: CRYPT.accent2Css,
      }).setOrigin(0.5).setDepth(D + 3)
      const hit = this._scene.add.zone(arrowX - 14, arrowY - 14, 28, 28).setOrigin(0)
        .setDepth(D + 4).setInteractive({ useHandCursor: true })
      let pressed = false
      hit.on('pointerover', () => arrow.setColor(CRYPT.goldCss))
      hit.on('pointerout',  () => { arrow.setColor(CRYPT.accent2Css); pressed = false })
      hit.on('pointerdown', () => { pressed = true })
      hit.on('pointerup', () => {
        if (!pressed) return
        pressed = false
        this._abilityIdx = (this._abilityIdx + 1) % abilities.length
        const next = abilities[this._abilityIdx]
        nameT.setText(next.name.toUpperCase())
        sumT.setText(next.summary ?? '')
        headerT.setText(`ABILITY${pageLabel(this._abilityIdx)}`)
      })
      addChild(arrow, hit)
    }

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
      const cardW = colW - 6
      const cardH = rowH - 4
      const cardG = this._scene.add.graphics().setDepth(D + 2)
      pixelPanel(cardG, px, py, cardW, cardH, {
        fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
      })
      addChild(cardG)
      addChild(this._scene.add.text(px + 8, py + 4, `D${p.day}`, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setDepth(D + 3))
      addChild(this._scene.add.text(px + 8, py + 16, this._mechName(p.mechanicId).toUpperCase(), {
        fontFamily: FONT_HEAD, fontSize: '9px', color: this._rarityColor(p.rarity), letterSpacing: 1,
      }).setDepth(D + 3))
      // Make the card clickable — opens PactDetailPopup with this pact's
      // info so players can read what the pact actually does. Both
      // pointerdown and pointerup must land on the zone (matching the
      // popup-frame wash convention) so the click-that-opened-the-boss-
      // overview can't immediately fire one of these.
      const hit = this._scene.add.zone(px, py, cardW, cardH).setOrigin(0)
        .setDepth(D + 4).setInteractive({ useHandCursor: true })
      let pressed = false
      hit.on('pointerdown', () => { pressed = true })
      hit.on('pointerout',  () => { pressed = false })
      hit.on('pointerup',   () => {
        if (!pressed) return
        pressed = false
        EventBus.emit('SHOW_PACT_DETAIL', { mechanicId: p.mechanicId, day: p.day })
      })
      addChild(hit)
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

  // Boss ability names are coloured by tier so the unlock progression
  // reads at a glance. Tier 1 = ink, 2 = gold, 3 = accent2 (red).
  _tierColor(t) {
    return t >= 3 ? CRYPT.accent2Css
         : t >= 2 ? CRYPT.goldCss
         : CRYPT.ink
  }
}

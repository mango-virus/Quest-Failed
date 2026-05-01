// Phase 31E — Adventurer Intel popup.
//
// Opens any phase via the action-bar 'ADV INTEL' button. Day phase shows
// the currently-active adventurers (full info). Night phase shows the
// next day's incoming party — but every detail is masked '???' unless
// the player has built a Library room, which reveals names / classes /
// HP / knowledge tags.
//
// Replaces the design's 'Pre-Wave Prep' screen. Per user direction
// 2026-05-01, this is a popup not a full-screen scene; the predicted
// route from the design is replaced by the adventurers' knowledge map
// (deferred for now — the popup currently lists party + intel only).

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelBar, pixelDiamond } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'

export class AdventurerIntelPopup {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._frame = makePopupFrame({
      scene,
      w:    900,
      h:    560,
      title:'ADVENTURER INTEL',
      depth: 200,
      render: (px, py, cx, cy, cw, ch, addChild) => this._render(cx, cy, cw, ch, addChild),
    })
  }

  open()  { this._frame.open() }
  close() { this._frame.close() }
  destroy() { this.close() }

  _render(cx, cy, cw, ch, addChild) {
    const D = 205
    const phase = this._gameState.meta?.phase ?? 'night'
    const hasLibrary = this._hasLibrary()

    // Status banner
    const bannerH = 44
    const bannerG = this._scene.add.graphics().setDepth(D)
    pixelPanel(bannerG, cx, cy, cw, bannerH, { fill: CRYPT.bgStone2 })
    addChild(bannerG)
    const dia = this._scene.add.graphics().setDepth(D + 2)
    pixelDiamond(dia, cx + 14, cy + bannerH / 2, 4, CRYPT.accent2)
    addChild(dia)
    addChild(this._scene.add.text(cx + 26, cy + bannerH / 2,
      phase === 'day' ? 'CURRENT WAVE' : 'NEXT DAY · INCOMING', {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(D + 2))
    if (phase === 'night') {
      addChild(this._scene.add.text(cx + cw - 14, cy + bannerH / 2,
        hasLibrary ? 'LIBRARY ACTIVE — INTEL REVEALED' : 'BUILD A LIBRARY TO REVEAL INTEL', {
        fontFamily: FONT_HEAD, fontSize: '7px',
        color: hasLibrary ? CRYPT.soulCss : CRYPT.warnCss, letterSpacing: 2,
      }).setOrigin(1, 0.5).setDepth(D + 2))
    }

    // Party list
    const partyY = cy + bannerH + 12
    const partyH = ch - bannerH - 12
    const partyG = this._scene.add.graphics().setDepth(D)
    pixelPanel(partyG, cx, partyY, cw, partyH, { fill: CRYPT.bgStone1 })
    addChild(partyG)

    const advs = this._partyToShow(phase)
    if (advs.length === 0) {
      addChild(this._scene.add.text(cx + cw / 2, partyY + partyH / 2,
        phase === 'day' ? '— DUNGEON IS QUIET —' : '— NO ADVENTURERS SCHEDULED —', {
        fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
      return
    }

    const showFull = (phase === 'day') || hasLibrary
    const rowH = 90
    const padX = 14
    const visibleH = partyH - 24
    const maxRows = Math.floor(visibleH / (rowH + 8))
    advs.slice(0, maxRows).forEach((adv, i) => {
      this._renderAdvRow(adv, cx + padX, partyY + 12 + i * (rowH + 8),
        cw - padX * 2, rowH, showFull, D, addChild)
    })
  }

  _renderAdvRow(adv, x, y, w, h, showFull, D, addChild) {
    const rowG = this._scene.add.graphics().setDepth(D + 1)
    pixelPanel(rowG, x, y, w, h, {
      fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(rowG)

    // Sigil box on the left
    const sigilSize = h - 16
    const sigilG = this._scene.add.graphics().setDepth(D + 2)
    pixelPanel(sigilG, x + 8, y + 8, sigilSize, sigilSize, {
      fill: CRYPT.bgDeep, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(sigilG)
    addChild(this._scene.add.text(x + 8 + sigilSize / 2, y + 8 + sigilSize / 2,
      showFull ? (adv.sigil ?? '@') : '?', {
      fontFamily: FONT_HEAD, fontSize: '32px',
      color: showFull ? this._classColor(adv) : CRYPT.inkMute,
    }).setOrigin(0.5).setDepth(D + 3))

    // Right side: name / class+lvl+hp / tags / threat bar
    const tx = x + 8 + sigilSize + 14
    const tw = w - (tx - x) - 14

    addChild(this._scene.add.text(tx, y + 10, showFull ? (adv.name ?? '?') : '???', {
      fontFamily: FONT_HEAD, fontSize: '11px', color: CRYPT.ink, letterSpacing: 1,
    }).setDepth(D + 2))

    const classDef = this._classDef(adv.classId)
    const subline = showFull
      ? `${(classDef?.name ?? adv.classId ?? '?').toUpperCase()} · LVL ${adv.level ?? 1} · ${adv.resources?.maxHp ?? 0} HP`
      : '??? · LVL ??? · ??? HP'
    addChild(this._scene.add.text(tx, y + 26, subline, {
      fontFamily: FONT_BODY, fontSize: '9px',
      color: showFull ? CRYPT.accent2Css : CRYPT.inkMute, letterSpacing: 1,
    }).setDepth(D + 2))

    // HP bar (current value if alive, else max)
    const hp = adv.resources?.hp ?? 0
    const max = adv.resources?.maxHp ?? Math.max(1, hp)
    const bar = pixelBar(this._scene, tx, y + 42, Math.min(tw, 220), 10, hp, max,
      { color: 'cyan', label: showFull ? `${hp}/${max}` : '???', depth: D + 2, fontSize: 7 })
    addChild(bar.g, bar.txt)

    // Knowledge tags
    const tags = this._knowledgeTags(adv, showFull)
    let tagX = tx
    const tagY = y + 60
    for (const tag of tags.slice(0, 4)) {
      const tagW = tag.text.length * 6 + 12
      const tagG = this._scene.add.graphics().setDepth(D + 2)
      pixelPanel(tagG, tagX, tagY, tagW, 14, {
        fill: CRYPT.bgDeep, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeS,
      })
      addChild(tagG)
      addChild(this._scene.add.text(tagX + tagW / 2, tagY + 7, tag.text, {
        fontFamily: FONT_HEAD, fontSize: '6px', color: tag.color, letterSpacing: 1,
      }).setOrigin(0.5).setDepth(D + 3))
      tagX += tagW + 4
    }
  }

  _hasLibrary() {
    return (this._gameState.dungeon?.rooms ?? []).some(r => r.definitionId === 'library_of_whispers')
  }

  _partyToShow(phase) {
    if (phase === 'day') {
      return (this._gameState.adventurers?.active ?? []).slice()
    }
    // Night phase: try to read the next-day queue if the spawn system
    // exposes one. Otherwise, fall back to whatever's in active (rare in
    // night but harmless) or known adventurers.
    const next = this._gameState.adventurers?.nextDay
              ?? this._gameState.adventurers?.queued
              ?? []
    if (Array.isArray(next) && next.length) return next
    return []
  }

  _classDef(id) {
    return (this._scene.cache.json.get('adventurerClasses') ?? []).find(c => c.id === id)
  }

  _classColor(adv) {
    const def = this._classDef(adv.classId)
    if (def?.color) {
      if (typeof def.color === 'string') {
        return def.color.startsWith('0x') ? `#${def.color.slice(2)}` : def.color
      }
      return `#${def.color.toString(16).padStart(6, '0')}`
    }
    return CRYPT.soulCss
  }

  _knowledgeTags(adv, showFull) {
    if (!showFull) return [{ text: '???', color: CRYPT.inkMute }]
    const tags = []
    const k = adv.knowledge ?? {}
    const roomCount = Object.keys(k.rooms  ?? {}).length
    const trapCount = Object.keys(k.traps  ?? {}).length
    const minCount  = Object.keys(k.minions ?? {}).length
    if (roomCount === 0 && trapCount === 0 && minCount === 0) {
      tags.push({ text: 'BLIND ENTRY', color: CRYPT.inkMute })
    }
    if (roomCount > 0) tags.push({ text: `KNOWS ${roomCount} ROOMS`, color: CRYPT.soulCss })
    if (trapCount > 0) tags.push({ text: `KNOWS ${trapCount} TRAPS`, color: CRYPT.warnCss })
    if (minCount  > 0) tags.push({ text: `KNOWS ${minCount} MINIONS`, color: CRYPT.accent2Css })
    for (const pid of (adv.personalityIds ?? []).slice(0, 2)) {
      tags.push({ text: pid.toUpperCase(), color: CRYPT.ink })
    }
    return tags
  }
}

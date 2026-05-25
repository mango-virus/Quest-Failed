// SUPERSEDED (Phase 34) — replaced by `src/hud/AdvIntelOverlay.js`.
//
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

    if (phase === 'night') {
      this._renderNightPreview(cx, partyY, cw, partyH, hasLibrary, D, addChild)
      return
    }

    const advs = (this._gameState.adventurers?.active ?? []).slice()
    if (advs.length === 0) {
      addChild(this._scene.add.text(cx + cw / 2, partyY + partyH / 2,
        '— DUNGEON IS QUIET —', {
        fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
      return
    }

    const rowH = 90
    const padX = 14
    const visibleH = partyH - 24
    const maxRows = Math.floor(visibleH / (rowH + 8))
    advs.slice(0, maxRows).forEach((adv, i) => {
      this._renderAdvRow(adv, cx + padX, partyY + 12 + i * (rowH + 8),
        cw - padX * 2, rowH, true, D, addChild)
    })
  }

  // ── Night-phase preview ─────────────────────────────────────────────────
  //
  // We can't show the EXACT incoming party — DayPhase rolls them with RNG
  // when its create() runs, and pre-rolling would break determinism with
  // event-driven spawn flags. Instead show a deterministic forecast built
  // from the same gates DayPhase uses: projected wave size, eligible class
  // pool, returning veterans (from KnowledgeSystem), and the shared-pool
  // knowledge every fresh adv inherits at spawn.
  _renderNightPreview(cx, py, cw, ph, hasLibrary, D, addChild) {
    const day      = this._gameState.meta?.dayNumber ?? 1
    const bossLv   = this._gameState.boss?.level ?? 1
    const flags    = this._gameState._mechanicFlags ?? {}
    const events   = this._gameState._eventFlags ?? {}
    // Wave size — mirrors DayPhase's baseCount calc closely.
    let baseCount  = (this.cache?.json?.get?.('balance')?.ADVENTURERS_PER_DAY_BASE)
                  ?? 1
    baseCount = 1 + Math.floor((day - 1) / 2)
    if (flags.gildedDemiseExtraAdvs) baseCount += flags.gildedDemiseExtraAdvs ?? 0
    if (flags.extraAdvsPerDay)       baseCount += flags.extraAdvsPerDay ?? 0
    if (flags.doomsdayRaidToday)     baseCount = Math.round(baseCount * 2)
    if (events.guildRaidActive)      baseCount *= 2
    // Eligible class pool — same gate DayPhase uses
    const allClasses = this._scene.cache.json.get('adventurerClasses') ?? []
    const eligible = allClasses.filter(c =>
      (c.unlockLevel ?? 1) <= bossLv && (c.unlockDay ?? 1) <= day,
    )
    // Returning veterans — survivors whose lastSeenDay was the just-finished day
    const survivors = this._gameState.knowledge?.survivors ?? []
    const vets = survivors.filter(s => s.lastSeenDay === (day - 1) || s.lastSeenDay === day)
    // Shared-pool baseline knowledge advs will spawn with
    const pool = this._gameState.knowledge?.sharedPool ?? {}
    const poolRooms = Object.keys(pool.rooms ?? {}).length
    const poolTraps = Object.keys(pool.traps ?? {}).length
    const poolItems = Object.keys(pool.items ?? {}).length
    const enemySeen = new Set()
    for (const list of Object.values(pool.enemiesPerRoom ?? {})) {
      for (const e of (list ?? [])) enemySeen.add(e.minionType)
    }
    const poolMins  = enemySeen.size

    const padX = 16
    let yy = py + 14
    const colW = cw - padX * 2

    // ── Wave size + class pool ─────────────────────────────────────────
    addChild(this._scene.add.text(cx + padX, yy, 'WAVE FORECAST', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.goldCss, letterSpacing: 3,
    }).setDepth(D + 2))
    yy += 16
    addChild(this._scene.add.text(cx + padX, yy,
      `Day ${day} · ~${baseCount} adventurer${baseCount === 1 ? '' : 's'} expected`, {
      fontFamily: FONT_BODY, fontSize: '10px', color: CRYPT.ink, letterSpacing: 1,
    }).setDepth(D + 2))
    yy += 18
    if (events.legendarySpeedrunnerActive)  this._addPreviewLine(cx + padX, yy, 'EVENT: Legendary Speed Runner — solo buffed adv', CRYPT.accent2Css, addChild, D), yy += 14
    if (events.lootGoblinHeistActive)        this._addPreviewLine(cx + padX, yy, 'EVENT: Loot Goblin Heist — goblins steal then flee', CRYPT.accent2Css, addChild, D), yy += 14
    if (events.cartographersConventionActive)this._addPreviewLine(cx + padX, yy, 'EVENT: Cartographers — 3 scholars touring rooms', CRYPT.accent2Css, addChild, D), yy += 14
    if (events.tournamentActive)             this._addPreviewLine(cx + padX, yy, 'EVENT: The Tournament — 3 named rivals', CRYPT.accent2Css, addChild, D), yy += 14
    if (events.rivalDungeonActive)           this._addPreviewLine(cx + padX, yy, 'EVENT: Rival Dungeon — monsters + boss invade', CRYPT.accent2Css, addChild, D), yy += 14
    yy += 4

    // ── Eligible classes grid ──────────────────────────────────────────
    addChild(this._scene.add.text(cx + padX, yy, 'ELIGIBLE CLASSES', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.goldCss, letterSpacing: 3,
    }).setDepth(D + 2))
    yy += 16
    const list = hasLibrary
      ? eligible.map(c => c.name?.toUpperCase() ?? c.id?.toUpperCase()).join(' · ')
      : `${eligible.length} class${eligible.length === 1 ? '' : 'es'} unlocked — ??? (build a Library to reveal)`
    addChild(this._scene.add.text(cx + padX, yy, list, {
      fontFamily: FONT_BODY, fontSize: '9px', color: hasLibrary ? CRYPT.ink : CRYPT.inkDim,
      letterSpacing: 1, wordWrap: { width: colW, useAdvancedWrap: true }, lineSpacing: 3,
    }).setDepth(D + 2))
    yy += 36

    // ── Returning veterans ─────────────────────────────────────────────
    addChild(this._scene.add.text(cx + padX, yy, 'RETURNING HEROES', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.goldCss, letterSpacing: 3,
    }).setDepth(D + 2))
    yy += 16
    if (vets.length === 0) {
      addChild(this._scene.add.text(cx + padX, yy, '— no escaped survivors carrying intel —', {
        fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.inkDim, letterSpacing: 1,
      }).setDepth(D + 2))
      yy += 16
    } else {
      const visible = hasLibrary ? vets.slice(0, 4) : []
      if (!hasLibrary) {
        addChild(this._scene.add.text(cx + padX, yy,
          `${vets.length} survivor${vets.length === 1 ? '' : 's'} returning — ??? (build a Library to reveal)`, {
          fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.inkDim, letterSpacing: 1,
        }).setDepth(D + 2))
        yy += 16
      } else {
        for (const v of visible) {
          const k = v.knowledge ?? {}
          const r = Object.keys(k.rooms ?? {}).length
          const t = Object.keys(k.traps ?? {}).length
          const it = Object.keys(k.items ?? {}).length
          const seenSet = new Set()
          for (const lst of Object.values(k.enemiesPerRoom ?? {})) {
            for (const e of (lst ?? [])) seenSet.add(e.minionType)
          }
          addChild(this._scene.add.text(cx + padX, yy,
            `${(v.name ?? '???').toUpperCase()} (${(v.classId ?? '?').toUpperCase()}) · run #${v.runCount ?? 1} · knows ${r}R / ${t}T / ${seenSet.size}M / ${it}I`, {
            fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.soulCss, letterSpacing: 1,
          }).setDepth(D + 2))
          yy += 14
        }
        if (vets.length > visible.length) {
          addChild(this._scene.add.text(cx + padX, yy,
            `+${vets.length - visible.length} more`, {
            fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 1,
          }).setDepth(D + 2))
          yy += 14
        }
      }
    }
    yy += 8

    // ── Shared knowledge pool ──────────────────────────────────────────
    addChild(this._scene.add.text(cx + padX, yy, 'WHAT THEY KNOW (BASELINE)', {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.goldCss, letterSpacing: 3,
    }).setDepth(D + 2))
    yy += 16
    if (poolRooms === 0 && poolTraps === 0 && poolMins === 0 && poolItems === 0) {
      addChild(this._scene.add.text(cx + padX, yy, '— blind: no leaked intel from prior survivors —', {
        fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.inkDim, letterSpacing: 1,
      }).setDepth(D + 2))
    } else {
      addChild(this._scene.add.text(cx + padX, yy,
        `${poolRooms} ROOMS · ${poolTraps} TRAPS · ${poolMins} MINION TYPES · ${poolItems} ITEMS leaked`, {
        fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
      }).setDepth(D + 2))
    }
  }

  _addPreviewLine(x, y, text, color, addChild, D) {
    addChild(this._scene.add.text(x, y, text, {
      fontFamily: FONT_BODY, fontSize: '9px', color, letterSpacing: 1,
    }).setDepth(D + 2))
  }

  _renderAdvRow(adv, x, y, w, h, showFull, D, addChild) {
    const rowG = this._scene.add.graphics().setDepth(D + 1)
    pixelPanel(rowG, x, y, w, h, {
      fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(rowG)

    // Portrait box on the left — when intel is "full" (Library built),
    // show the adventurer's looping idle-down sprite inside the panel.
    // Falls back to the sigil glyph when intel is masked ('?') or when
    // the spriteVariant texture isn't loaded.
    const sigilSize = h - 16
    const boxX = x + 8
    const boxY = y + 8
    const sigilG = this._scene.add.graphics().setDepth(D + 2)
    pixelPanel(sigilG, boxX, boxY, sigilSize, sigilSize, {
      fill: CRYPT.bgDeep, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(sigilG)

    const variant    = showFull ? adv.spriteVariant : null
    const [cls, vId] = (variant ?? '/').split('/')
    const textureKey = (cls && vId) ? `adv-${cls}-${vId}` : null
    const hasTexture = textureKey && this._scene.textures.exists(textureKey)

    if (hasTexture) {
      const cx = boxX + sigilSize / 2
      const cy = boxY + sigilSize / 2
      const sprite = this._scene.add.sprite(cx, cy, textureKey, 0).setDepth(D + 3)
      sprite.texture?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
      // LPC adventurer frames are 64×64 but the character only fills
      // the lower-middle ~40 px. A naive `boxSize / 64` scale makes
      // the character look tiny and floating in the panel — divide by
      // ~50 instead so the character fills ~85 % of the box height.
      // Mask clips the ~30 % excess on top/sides.
      const scale = sigilSize / 50
      sprite.setScale(scale)
      // LPC character centre sits ~4 px below the frame centre (feet
      // anchor). Nudge sprite down a touch so the character lands
      // visually centred in the box.
      sprite.y += 4 * scale
      const maskG = this._scene.make.graphics({ x: 0, y: 0, add: false })
      maskG.fillStyle(0xffffff)
      maskG.fillRect(boxX, boxY, sigilSize, sigilSize)
      sprite.setMask(maskG.createGeometryMask())
      const animKey = `${textureKey}-idle-down`
      if (this._scene.anims.exists(animKey)) sprite.play(animKey)
      addChild(sprite)
    } else {
      addChild(this._scene.add.text(boxX + sigilSize / 2, boxY + sigilSize / 2,
        showFull ? (adv.sigil ?? '@') : '?', {
        fontFamily: FONT_HEAD, fontSize: '32px',
        color: showFull ? this._classColor(adv) : CRYPT.inkMute,
      }).setOrigin(0.5).setDepth(D + 3))
    }

    // Right side: name / class+lvl+hp / tags / threat bar
    const tx = x + 8 + sigilSize + 14
    const tw = w - (tx - x) - 14

    addChild(this._scene.add.text(tx, y + 10, showFull ? (adv.name ?? '?') : '???', {
      fontFamily: FONT_HEAD, fontSize: '11px', color: CRYPT.ink, letterSpacing: 1,
    }).setDepth(D + 2))

    const classDef = this._classDef(adv.classId)
    const subline = showFull
      ? `${(classDef?.name ?? adv.classId ?? '?').toUpperCase()} · LVL ${adv.displayLevel ?? adv.level ?? 1} · ${adv.resources?.maxHp ?? 0} HP`
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
    // Placed-item intel (phylactery / beacons) lives in the generic
    // `items` bucket keyed by instanceId.
    const itemCount = Object.keys(k.items  ?? {}).length
    // KnowledgeSystem stores enemy intel as `enemiesPerRoom: { roomId: [{minionType,...}] }`,
    // not a flat `minions` dict. Sum distinct minion types across rooms so
    // the count actually reflects what the adv knows.
    const enemyRooms = k.enemiesPerRoom ?? {}
    const seen = new Set()
    for (const list of Object.values(enemyRooms)) {
      for (const e of (list ?? [])) seen.add(e.minionType)
    }
    const minCount = seen.size
    if (roomCount === 0 && trapCount === 0 && minCount === 0 && itemCount === 0) {
      tags.push({ text: 'BLIND ENTRY', color: CRYPT.inkMute })
    }
    if (roomCount > 0) tags.push({ text: `KNOWS ${roomCount} ROOMS`, color: CRYPT.soulCss })
    if (trapCount > 0) tags.push({ text: `KNOWS ${trapCount} TRAPS`, color: CRYPT.warnCss })
    if (minCount  > 0) tags.push({ text: `KNOWS ${minCount} MINIONS`, color: CRYPT.accent2Css })
    if (itemCount > 0) tags.push({ text: `KNOWS ${itemCount} ITEMS`, color: CRYPT.goldCss })
    for (const pid of (adv.personalityIds ?? []).slice(0, 2)) {
      tags.push({ text: pid.toUpperCase(), color: CRYPT.ink })
    }
    return tags
  }
}

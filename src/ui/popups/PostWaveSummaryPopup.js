// Phase 31F — Post-Wave Summary popup.
//
// Replaces the EndOfDay newspaper. Three columns:
//   1. Casualties — per-adventurer slain-by + soul reward
//   2. Resources Earned — gold earned + XP earned this wave
//   3. Dungeon Performance — most lethal minion, minions lost, etc.
//
// Footer: 'View Dungeon Log' (no-op stub) and 'Continue' (primary).
// Continue closes the popup and emits POST_WAVE_CONTINUE — EndOfDay
// orchestrator picks up from there to route to Dark Pact (level-up) or
// straight back to NightPhase.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelButton, pixelDiamond } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'
import { EventBus } from '../../systems/EventBus.js'
import { Balance } from '../../config/balance.js'

export class PostWaveSummaryPopup {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._snapshot  = null            // set by setSnapshot before open()
    this._frame = makePopupFrame({
      scene,
      w:    1080,
      h:    600,
      title:'POST-WAVE SUMMARY',
      depth: 200,
      render: (px, py, cx, cy, cw, ch, addChild) => this._render(cx, cy, cw, ch, addChild),
    })
  }

  // Called by the EndOfDay orchestrator before open() to seed per-day
  // delta math. snapshot has the same shape as DayPhase._daySnapshot.
  setSnapshot(s) { this._snapshot = s }

  open()  { this._frame.open() }
  close() { this._frame.close() }
  destroy() { this.close() }

  _render(cx, cy, cw, ch, addChild) {
    const D = 205

    // Banner across the top — big red 'DAY N CONCLUDED' headline.
    const bannerH = 56
    const bannerG = this._scene.add.graphics().setDepth(D)
    pixelPanel(bannerG, cx, cy, cw, bannerH, { fill: CRYPT.bgStone2 })
    addChild(bannerG)

    const dayJustEnded = (this._gameState.meta?.dayNumber ?? 1) - 1
    addChild(this._scene.add.text(cx + cw / 2, cy + bannerH / 2,
      `DAY ${dayJustEnded} CONCLUDED`, {
      fontFamily: FONT_HEAD, fontSize: '18px', color: CRYPT.accent2Css, letterSpacing: 4,
    }).setOrigin(0.5).setDepth(D + 2))

    // Three columns
    const colY  = cy + bannerH + 14
    const colH  = ch - bannerH - 14 - 56            // leave 56 for footer buttons
    const gap   = 12
    const colW  = Math.floor((cw - gap * 2) / 3)

    this._renderCasualties(cx,                     colY, colW, colH, D, addChild)
    this._renderResources (cx + colW + gap,        colY, colW, colH, D, addChild)
    this._renderPerformance(cx + (colW + gap) * 2, colY, colW, colH, D, addChild)

    // Footer row
    const footerY = cy + ch - 44
    const continueBtn = pixelButton(this._scene,
      cx + cw - 180, footerY, 168, 36, 'CONTINUE',
      { primary: true, depth: D + 2, fontSize: 10,
        onClick: () => {
          EventBus.emit('POST_WAVE_CONTINUE')
          this.close()
        },
      })
    addChild(continueBtn.bg, continueBtn.label, continueBtn.hit)
  }

  _renderCasualties(x, y, w, h, D, addChild) {
    const card = this._scene.add.graphics().setDepth(D)
    pixelPanel(card, x, y, w, h, { fill: CRYPT.bgStone1 })
    addChild(card)

    const day = (this._gameState.meta?.dayNumber ?? 1) - 1
    const grave    = this._gameState.adventurers?.graveyard ?? []
    const sliceFrom = this._snapshot?.graveyardLen ?? 0
    const killedToday = grave.slice(sliceFrom).filter(a => (a.diedOnDay ?? day) === day)
    // Adventurers who fled alive today: gameState.adventurers.known is
    // updated by RunHistorySystem on ADVENTURER_FLED with lastEscapedDay.
    const known = this._gameState.adventurers?.known ?? []
    const escapedToday = known.filter(k => (k.lastEscapedDay ?? -1) === day)

    this._sectionHeader(x, y, w,
      `ADVENTURERS · ${killedToday.length} SLAIN · ${escapedToday.length} ESCAPED`,
      D, addChild)

    if (killedToday.length === 0 && escapedToday.length === 0) {
      addChild(this._scene.add.text(x + w / 2, y + h / 2, '— NO ARRIVALS TODAY —', {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
      return
    }

    let yy = y + 36
    const rowH = 56
    const visibleH = h - 36 - 8
    const maxRows  = Math.max(1, Math.floor(visibleH / rowH))
    let rendered = 0

    // Slain rows first (red accent border).
    for (const adv of killedToday) {
      if (rendered >= maxRows) break
      this._renderAdvRow(adv, x, yy, w, rowH - 4, /* escaped */ false, D, addChild)
      yy += rowH
      rendered++
    }
    // Then escaped rows (warn-colored border).
    for (const k of escapedToday) {
      if (rendered >= maxRows) break
      this._renderAdvRow(k, x, yy, w, rowH - 4, /* escaped */ true, D, addChild)
      yy += rowH
      rendered++
    }
  }

  _renderAdvRow(adv, x, yy, w, h, escaped, D, addChild) {
    const rowG = this._scene.add.graphics().setDepth(D + 1)
    pixelPanel(rowG, x + 8, yy, w - 16, h, {
      fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(rowG)

    // Coloured left bar — red for slain, warn-orange for escaped — gives a
    // quick visual sort even when the column is dense.
    const bar = this._scene.add.graphics().setDepth(D + 2)
    bar.fillStyle(escaped ? CRYPT.warn : CRYPT.accent, 1)
    bar.fillRect(x + 8, yy, 3, h)
    addChild(bar)

    const headColor   = escaped ? CRYPT.warnCss   : CRYPT.ink
    const headText    = (adv.name ?? '?')
    const detailColor = escaped ? CRYPT.warnCss   : CRYPT.inkDim
    const detailText  = escaped
      ? `${(adv.classId ?? '?').toUpperCase()} · ESCAPED ALIVE`
      : `${(adv.classId ?? '?').toUpperCase()} · slain by ${adv.killerName ?? '???'}`
    const tagColor    = escaped ? CRYPT.soulCss   : CRYPT.goldCss
    const tagText     = escaped ? '+ KNOWLEDGE LEAK' : '+ GOLD'

    addChild(this._scene.add.text(x + 18, yy + 6, headText, {
      fontFamily: FONT_HEAD, fontSize: '10px', color: headColor, letterSpacing: 1,
    }).setDepth(D + 3))
    addChild(this._scene.add.text(x + 18, yy + 22, detailText, {
      fontFamily: FONT_BODY, fontSize: '8px', color: detailColor, letterSpacing: 1,
      wordWrap: { width: w - 32, useAdvancedWrap: true },
    }).setDepth(D + 3))
    addChild(this._scene.add.text(x + 18, yy + 38, tagText, {
      fontFamily: FONT_HEAD, fontSize: '7px', color: tagColor, letterSpacing: 1,
    }).setDepth(D + 3))
  }

  _renderResources(x, y, w, h, D, addChild) {
    const card = this._scene.add.graphics().setDepth(D)
    pixelPanel(card, x, y, w, h, { fill: CRYPT.bgStone1 })
    addChild(card)
    this._sectionHeader(x, y, w, 'RESOURCES EARNED', D, addChild)

    const snap = this._snapshot ?? {}
    const totals = this._gameState.run?.totals ?? {}
    const goldDelta   = (totals.gold  ?? 0) - (snap.totals?.gold  ?? 0)
    const advsKilled  = (totals.advsKilled  ?? 0) - (snap.totals?.advsKilled  ?? 0)
    const advsEscaped = (totals.advsEscaped ?? 0) - (snap.totals?.advsEscaped ?? 0)
    const xpEarned    = advsKilled * (Balance.BOSS_XP_PER_KILL ?? 10)

    const rows = [
      { l: 'GOLD LOOTED',    v: `+${goldDelta.toLocaleString('en-US')}`, c: CRYPT.goldCss },
      { l: 'XP EARNED',      v: `+${xpEarned}`,                          c: CRYPT.greenCss },
      { l: 'ADVS KILLED',    v: `${advsKilled}`,                         c: CRYPT.greenCss },
      { l: 'ADVS ESCAPED',   v: `${advsEscaped}`,                        c: CRYPT.warnCss },
    ]
    let yy = y + 40
    for (const r of rows) {
      const rowG = this._scene.add.graphics().setDepth(D + 1)
      pixelPanel(rowG, x + 8, yy, w - 16, 26, {
        fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
      })
      addChild(rowG)
      addChild(this._scene.add.text(x + 16, yy + 13, r.l, {
        fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0, 0.5).setDepth(D + 3))
      addChild(this._scene.add.text(x + w - 16, yy + 13, r.v, {
        fontFamily: FONT_HEAD, fontSize: '12px', color: r.c, letterSpacing: 1,
      }).setOrigin(1, 0.5).setDepth(D + 3))
      yy += 32
    }

    // Net gold
    const ruleY = yy + 4
    const rule = this._scene.add.graphics().setDepth(D + 1)
    rule.fillStyle(CRYPT.panelEdgeS, 1); rule.fillRect(x + 16, ruleY, w - 32, 1)
    rule.fillStyle(CRYPT.panelEdgeH, 1); rule.fillRect(x + 16, ruleY + 1, w - 32, 1)
    addChild(rule)
    yy = ruleY + 14
    addChild(this._scene.add.text(x + 16, yy, 'NET GOLD', {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.ink, letterSpacing: 2,
    }).setDepth(D + 3))
    addChild(this._scene.add.text(x + w - 16, yy, `+${goldDelta.toLocaleString('en-US')}`, {
      fontFamily: FONT_HEAD, fontSize: '14px', color: CRYPT.goldCss, letterSpacing: 1,
    }).setOrigin(1, 0).setDepth(D + 3))
  }

  _renderPerformance(x, y, w, h, D, addChild) {
    const card = this._scene.add.graphics().setDepth(D)
    pixelPanel(card, x, y, w, h, { fill: CRYPT.bgStone1 })
    addChild(card)
    this._sectionHeader(x, y, w, 'DUNGEON PERFORMANCE', D, addChild)

    const snap = this._snapshot ?? {}
    const totals = this._gameState.run?.totals ?? {}
    const lostToday = (totals.minionsLost ?? 0) - (snap.totals?.minionsLost ?? 0)
    const dmgTakenToday = (totals.dmgTaken ?? 0) - (snap.totals?.dmgTaken ?? 0)
    const dmgDealtToday = (totals.dmgDealt ?? 0) - (snap.totals?.dmgDealt ?? 0)

    // Most lethal minion: highest lifetime.kills among living minions.
    const minions = (this._gameState.minions ?? []).filter(m => m.aiState !== 'dead')
    let topMinion = null
    let topKills  = 0
    for (const m of minions) {
      const k = m.lifetime?.kills ?? 0
      if (k > topKills) { topMinion = m; topKills = k }
    }
    const mostLethal = topMinion
      ? `${topMinion.name ?? this._minionName(topMinion)} · ${topKills} kills`
      : '— none —'

    const stats = [
      { l: 'Most lethal minion', v: mostLethal,                       c: CRYPT.greenCss },
      { l: 'Damage dealt',       v: dmgDealtToday.toLocaleString('en-US'),  c: CRYPT.ink },
      { l: 'Damage taken',       v: dmgTakenToday.toLocaleString('en-US'),  c: CRYPT.accent2Css },
      { l: 'Minions lost',       v: String(lostToday),                c: CRYPT.accentCss },
      { l: 'Boss level',         v: `LV ${this._gameState.boss?.level ?? 1}`, c: CRYPT.goldCss },
    ]
    let yy = y + 40
    for (const s of stats) {
      addChild(this._scene.add.text(x + 14, yy, s.l, {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setOrigin(0, 0).setDepth(D + 3))
      addChild(this._scene.add.text(x + w - 14, yy, s.v, {
        fontFamily: FONT_BODY, fontSize: '9px', color: s.c, letterSpacing: 1,
        wordWrap: { width: Math.floor(w / 2), useAdvancedWrap: true },
        align: 'right',
      }).setOrigin(1, 0).setDepth(D + 3))
      yy += 24
    }
  }

  _minionName(m) {
    const def = (this._scene.cache.json.get('minionTypes') ?? []).find(d => d.id === m.definitionId)
    return def?.name ?? m.definitionId ?? 'minion'
  }

  _sectionHeader(x, y, w, label, D, addChild) {
    const dia = this._scene.add.graphics().setDepth(D + 2)
    pixelDiamond(dia, x + 12, y + 16, 4, CRYPT.accent2)
    addChild(dia)
    addChild(this._scene.add.text(x + 24, y + 16, label, {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.ink, letterSpacing: 2,
    }).setOrigin(0, 0.5).setDepth(D + 2))
  }
}

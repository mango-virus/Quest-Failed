// Phase 31F — Post-Wave Summary popup.
//
// Replaces the EndOfDay newspaper. Three columns:
//   1. Casualties — per-adventurer slain-by + soul reward
//   2. Resources Earned — gold/souls/dark-power deltas + net
//   3. Dungeon Performance — most lethal minion, minions lost, etc.
//
// Footer: 'View Dungeon Log' (no-op stub) and 'Continue' (primary).
// Continue closes the popup and emits POST_WAVE_CONTINUE — EndOfDay
// orchestrator picks up from there to route to Dark Pact (level-up) or
// straight back to NightPhase.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelButton, pixelDiamond } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'
import { EventBus } from '../../systems/EventBus.js'

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
    this._sectionHeader(x, y, w, 'CASUALTIES', D, addChild)

    const day = (this._gameState.meta?.dayNumber ?? 1) - 1
    const grave   = this._gameState.adventurers?.graveyard ?? []
    const sliceFrom = this._snapshot?.graveyardLen ?? 0
    const today  = grave.slice(sliceFrom).filter(a => (a.diedOnDay ?? day) === day)

    if (today.length === 0) {
      addChild(this._scene.add.text(x + w / 2, y + h / 2, '— NO KILLS TODAY —', {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(D + 2))
      return
    }

    let yy = y + 36
    const rowH = 60
    const visibleH = h - 36 - 8
    const maxRows  = Math.max(1, Math.floor(visibleH / rowH))
    today.slice(0, maxRows).forEach(adv => {
      const rowG = this._scene.add.graphics().setDepth(D + 1)
      pixelPanel(rowG, x + 8, yy, w - 16, rowH - 4, {
        fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
      })
      addChild(rowG)
      addChild(this._scene.add.text(x + 16, yy + 6, adv.name ?? '?', {
        fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.ink, letterSpacing: 1,
      }).setDepth(D + 3))
      addChild(this._scene.add.text(x + 16, yy + 22,
        `${(adv.classId ?? '?').toUpperCase()} · slain by ${adv.killerName ?? '???'}`, {
        fontFamily: FONT_BODY, fontSize: '8px', color: CRYPT.inkDim, letterSpacing: 1,
        wordWrap: { width: w - 32, useAdvancedWrap: true },
      }).setDepth(D + 3))
      addChild(this._scene.add.text(x + 16, yy + 40, '+ GOLD', {
        fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.goldCss, letterSpacing: 1,
      }).setDepth(D + 3))
      yy += rowH
    })
  }

  _renderResources(x, y, w, h, D, addChild) {
    const card = this._scene.add.graphics().setDepth(D)
    pixelPanel(card, x, y, w, h, { fill: CRYPT.bgStone1 })
    addChild(card)
    this._sectionHeader(x, y, w, 'RESOURCES EARNED', D, addChild)

    const snap = this._snapshot ?? {}
    const totals = this._gameState.run?.totals ?? {}
    const goldDelta = (totals.gold  ?? 0) - (snap.totals?.gold  ?? 0)
    const soulDelta = (totals.souls ?? 0) - (snap.totals?.souls ?? 0)
    const dpDelta   = (this._gameState.player?.darkPower ?? 0) - (snap.darkPower ?? 0)
    const advsKilled  = (totals.advsKilled  ?? 0) - (snap.totals?.advsKilled  ?? 0)
    const advsEscaped = (totals.advsEscaped ?? 0) - (snap.totals?.advsEscaped ?? 0)

    const rows = [
      { l: 'GOLD LOOTED',    v: `+${goldDelta.toLocaleString('en-US')}`, c: CRYPT.goldCss },
      { l: 'DARK POWER',     v: `${dpDelta >= 0 ? '+' : ''}${dpDelta}`,  c: CRYPT.accent2Css },
      { l: 'ADVS KILLED',    v: `${advsKilled}`,    c: CRYPT.greenCss },
      { l: 'ADVS ESCAPED',   v: `${advsEscaped}`,   c: CRYPT.warnCss },
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

    // Net (gold+souls roughly)
    const ruleY = yy + 4
    const rule = this._scene.add.graphics().setDepth(D + 1)
    rule.fillStyle(CRYPT.panelEdgeS, 1); rule.fillRect(x + 16, ruleY, w - 32, 1)
    rule.fillStyle(CRYPT.panelEdgeH, 1); rule.fillRect(x + 16, ruleY + 1, w - 32, 1)
    addChild(rule)
    yy = ruleY + 14
    addChild(this._scene.add.text(x + 16, yy, 'NET', {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.ink, letterSpacing: 2,
    }).setDepth(D + 3))
    addChild(this._scene.add.text(x + w - 16, yy, `+${(goldDelta + soulDelta).toLocaleString('en-US')}`, {
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
      { l: 'Boss level',         v: `LV ${this._gameState.meta?.dungeonLevel ?? 1}`, c: CRYPT.goldCss },
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

// Phase 31F — Post-Wave Summary popup.
//
// Three columns:
//   1. Casualties — per-adventurer slain-by + soul reward
//   2. Resources Earned — gold earned + XP earned this wave  (count-up)
//   3. Dungeon Performance — damage dealt/taken, minions lost (count-up)
//
// Numeric values in columns 2 & 3 animate from 0 → final via count-up,
// mirroring the GameOver scene.  sfx-score-countup loops for the
// duration and stops when all numbers finish.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelButton, pixelDiamond } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'
import { EventBus }  from '../../systems/EventBus.js'
import { Balance }   from '../../config/balance.js'
import { SfxVolume } from '../../systems/SfxVolume.js'

const COUNT_UP_MS  = 700
const TICK_MS      = 30

export class PostWaveSummaryPopup {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._snapshot  = null
    this._countTargets  = []   // { textObj, target, prefix }
    this._countTimers   = []
    this._countupSound  = null
    this._continued     = false
    this._frame = makePopupFrame({
      scene,
      w:    1080,
      h:    600,
      title:'POST-WAVE SUMMARY',
      depth: 200,
      // POST_WAVE_CONTINUE drives the day → night handoff in EndOfDay.
      // Closing the popup via the wash / Esc / X used to skip that
      // emit, which left EndOfDay listening on a popup that never
      // resolved → game stuck on an empty scene. Emitting on every
      // close path (button OR dismiss) makes the handoff ironclad.
      onClose: () => this._fireContinueIfNeeded(),
      render: (px, py, cx, cy, cw, ch, addChild) => this._render(cx, cy, cw, ch, addChild),
    })
  }

  setSnapshot(s) { this._snapshot = s }

  open() {
    this._countTargets = []
    this._continued = false
    this._frame.open()
    // Defer count-up one tick so the popup frame has finished laying out.
    this._scene.time.delayedCall(80, () => this._startCountUp())
  }

  close() {
    this._stopCountUp()
    this._frame.close()
  }

  // Idempotent — fires POST_WAVE_CONTINUE at most once per popup-open cycle
  // regardless of whether the Continue button or a dismiss path triggered
  // the close. The button sets _continued before calling close() so this
  // handler is a no-op on the explicit path.
  _fireContinueIfNeeded() {
    if (this._continued) return
    this._continued = true
    EventBus.emit('POST_WAVE_CONTINUE')
  }

  destroy() { this.close() }

  // ── Render ────────────────────────────────────────────────────────────────

  _render(cx, cy, cw, ch, addChild) {
    const D = 205

    const bannerH = 56
    const bannerG = this._scene.add.graphics().setDepth(D)
    pixelPanel(bannerG, cx, cy, cw, bannerH, { fill: CRYPT.bgStone2 })
    addChild(bannerG)

    const dayJustEnded = (this._gameState.meta?.dayNumber ?? 1) - 1
    addChild(this._scene.add.text(cx + cw / 2, cy + bannerH / 2,
      `DAY ${dayJustEnded} CONCLUDED`, {
      fontFamily: FONT_HEAD, fontSize: '18px', color: CRYPT.accent2Css, letterSpacing: 4,
    }).setOrigin(0.5).setDepth(D + 2))

    const colY  = cy + bannerH + 14
    const colH  = ch - bannerH - 14 - 56
    const gap   = 12
    const colW  = Math.floor((cw - gap * 2) / 3)

    this._renderCasualties(cx,                     colY, colW, colH, D, addChild)
    this._renderResources (cx + colW + gap,        colY, colW, colH, D, addChild)
    this._renderPerformance(cx + (colW + gap) * 2, colY, colW, colH, D, addChild)

    const footerY = cy + ch - 44
    const continueBtn = pixelButton(this._scene,
      cx + cw - 180, footerY, 168, 36, 'CONTINUE',
      { primary: true, depth: D + 2, fontSize: 10,
        onClick: () => {
          // Mark continued + emit BEFORE close() so the onClose handler
          // sees the flag set and skips the duplicate emit.
          this._continued = true
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

    for (const adv of killedToday) {
      if (rendered >= maxRows) break
      this._renderAdvRow(adv, x, yy, w, rowH - 4, false, D, addChild)
      yy += rowH; rendered++
    }
    for (const k of escapedToday) {
      if (rendered >= maxRows) break
      this._renderAdvRow(k, x, yy, w, rowH - 4, true, D, addChild)
      yy += rowH; rendered++
    }
  }

  _renderAdvRow(adv, x, yy, w, h, escaped, D, addChild) {
    const rowG = this._scene.add.graphics().setDepth(D + 1)
    pixelPanel(rowG, x + 8, yy, w - 16, h, {
      fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
    })
    addChild(rowG)

    const bar = this._scene.add.graphics().setDepth(D + 2)
    bar.fillStyle(escaped ? CRYPT.warn : CRYPT.accent, 1)
    bar.fillRect(x + 8, yy, 3, h)
    addChild(bar)

    const headColor  = escaped ? CRYPT.warnCss  : CRYPT.ink
    const detailText = escaped
      ? `${(adv.classId ?? '?').toUpperCase()} · ESCAPED ALIVE`
      : `${(adv.classId ?? '?').toUpperCase()} · slain by ${adv.killerName ?? '???'}`
    const tagColor   = escaped ? CRYPT.soulCss  : CRYPT.goldCss
    const tagText    = escaped ? '+ KNOWLEDGE LEAK' : '+ GOLD'

    addChild(this._scene.add.text(x + 18, yy + 6,  adv.name ?? '?', {
      fontFamily: FONT_HEAD, fontSize: '10px', color: headColor, letterSpacing: 1,
    }).setDepth(D + 3))
    addChild(this._scene.add.text(x + 18, yy + 22, detailText, {
      fontFamily: FONT_BODY, fontSize: '8px', color: escaped ? CRYPT.warnCss : CRYPT.inkDim,
      letterSpacing: 1, wordWrap: { width: w - 32, useAdvancedWrap: true },
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
    const goldDelta   = (totals.gold        ?? 0) - (snap.totals?.gold        ?? 0)
    const advsKilled  = (totals.advsKilled  ?? 0) - (snap.totals?.advsKilled  ?? 0)
    const advsEscaped = (totals.advsEscaped ?? 0) - (snap.totals?.advsEscaped ?? 0)
    const xpEarned    = advsKilled * (Balance.BOSS_XP_PER_KILL ?? 10)

    const rows = [
      { l: 'GOLD LOOTED', target: goldDelta,   prefix: '+', c: CRYPT.goldCss  },
      { l: 'XP EARNED',   target: xpEarned,    prefix: '+', c: CRYPT.greenCss },
      { l: 'ADVS KILLED', target: advsKilled,  prefix: '',  c: CRYPT.greenCss },
      { l: 'ADVS ESCAPED',target: advsEscaped, prefix: '',  c: CRYPT.warnCss  },
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
      // Value starts at prefix+0; count-up fills it in.
      const valT = this._scene.add.text(x + w - 16, yy + 13, `${r.prefix}0`, {
        fontFamily: FONT_HEAD, fontSize: '12px', color: r.c, letterSpacing: 1,
      }).setOrigin(1, 0.5).setDepth(D + 3)
      addChild(valT)
      this._countTargets.push({ textObj: valT, target: r.target, prefix: r.prefix })
      yy += 32
    }

    const ruleY = yy + 4
    const rule = this._scene.add.graphics().setDepth(D + 1)
    rule.fillStyle(CRYPT.panelEdgeS, 1); rule.fillRect(x + 16, ruleY, w - 32, 1)
    rule.fillStyle(CRYPT.panelEdgeH, 1); rule.fillRect(x + 16, ruleY + 1, w - 32, 1)
    addChild(rule)
    yy = ruleY + 14
    addChild(this._scene.add.text(x + 16, yy, 'NET GOLD', {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.ink, letterSpacing: 2,
    }).setDepth(D + 3))
    // Net gold count-up too
    const netT = this._scene.add.text(x + w - 16, yy, `+0`, {
      fontFamily: FONT_HEAD, fontSize: '14px', color: CRYPT.goldCss, letterSpacing: 1,
    }).setOrigin(1, 0).setDepth(D + 3)
    addChild(netT)
    this._countTargets.push({ textObj: netT, target: goldDelta, prefix: '+' })
  }

  _renderPerformance(x, y, w, h, D, addChild) {
    const card = this._scene.add.graphics().setDepth(D)
    pixelPanel(card, x, y, w, h, { fill: CRYPT.bgStone1 })
    addChild(card)
    this._sectionHeader(x, y, w, 'DUNGEON PERFORMANCE', D, addChild)

    const snap = this._snapshot ?? {}
    const totals = this._gameState.run?.totals ?? {}
    const lostToday      = (totals.minionsLost ?? 0) - (snap.totals?.minionsLost ?? 0)
    const dmgTakenToday  = (totals.dmgTaken    ?? 0) - (snap.totals?.dmgTaken    ?? 0)
    const dmgDealtToday  = (totals.dmgDealt    ?? 0) - (snap.totals?.dmgDealt    ?? 0)

    const minions = (this._gameState.minions ?? []).filter(m => m.aiState !== 'dead')
    let topMinion = null, topKills = 0
    for (const m of minions) {
      const k = m.lifetime?.kills ?? 0
      if (k > topKills) { topMinion = m; topKills = k }
    }
    const mostLethal = topMinion
      ? `${topMinion.name ?? this._minionName(topMinion)} · ${topKills} kills`
      : '— none —'

    // String-only row (no count-up).
    let yy = y + 40
    const _staticRow = (label, value, color) => {
      addChild(this._scene.add.text(x + 14, yy, label, {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setOrigin(0, 0).setDepth(D + 3))
      addChild(this._scene.add.text(x + w - 14, yy, value, {
        fontFamily: FONT_BODY, fontSize: '9px', color, letterSpacing: 1,
        wordWrap: { width: Math.floor(w / 2), useAdvancedWrap: true }, align: 'right',
      }).setOrigin(1, 0).setDepth(D + 3))
      yy += 24
    }
    const _countRow = (label, target, color) => {
      addChild(this._scene.add.text(x + 14, yy, label, {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setOrigin(0, 0).setDepth(D + 3))
      const valT = this._scene.add.text(x + w - 14, yy, '0', {
        fontFamily: FONT_BODY, fontSize: '9px', color, letterSpacing: 1,
        align: 'right',
      }).setOrigin(1, 0).setDepth(D + 3)
      addChild(valT)
      this._countTargets.push({ textObj: valT, target, prefix: '' })
      yy += 24
    }

    _staticRow('Most lethal minion', mostLethal,                          CRYPT.greenCss)
    _countRow ('Damage dealt',       dmgDealtToday,                       CRYPT.ink)
    _countRow ('Damage taken',       dmgTakenToday,                       CRYPT.accent2Css)
    _countRow ('Minions lost',       lostToday,                           CRYPT.accentCss)
    _staticRow('Boss level',         `LV ${this._gameState.boss?.level ?? 1}`, CRYPT.goldCss)
  }

  // ── Count-up ──────────────────────────────────────────────────────────────

  _startCountUp() {
    if (!this._countTargets.length) return

    // Start looping sound.
    this._startCountupSound()

    let pending = this._countTargets.length
    const oneDone = () => {
      pending--
      if (pending <= 0) this._stopCountupSound()
    }

    for (const ct of this._countTargets) {
      if (ct.target === 0) {
        ct.textObj.setText(`${ct.prefix}0`)
        oneDone()
        continue
      }
      const startMs = this._scene.time.now
      const tick = this._scene.time.addEvent({
        delay: TICK_MS,
        repeat: Math.ceil(COUNT_UP_MS / TICK_MS),
        callback: () => {
          const elapsed = this._scene.time.now - startMs
          const t = Math.min(1, elapsed / COUNT_UP_MS)
          const eased = 1 - Math.pow(1 - t, 3)
          const v = Math.round(ct.target * eased)
          ct.textObj.setText(`${ct.prefix}${v.toLocaleString('en-US')}`)
          if (t >= 1) {
            tick.remove(false)
            oneDone()
          }
        },
      })
      this._countTimers.push(tick)
    }
  }

  _stopCountUp() {
    for (const t of this._countTimers) t?.remove?.(false)
    this._countTimers = []
    // Snap all targets to final value.
    for (const ct of this._countTargets) {
      ct.textObj.setText(`${ct.prefix}${ct.target.toLocaleString('en-US')}`)
    }
    this._stopCountupSound()
  }

  _startCountupSound() {
    const scene = this._scene
    if (!scene?.cache?.audio?.exists?.('sfx-score-countup')) return
    if (SfxVolume.isMuted()) return
    const vol = Math.min(1, 0.55 * SfxVolume.getVolume())
    if (vol <= 0) return
    try {
      this._countupSound = scene.sound.add('sfx-score-countup', { loop: true, volume: vol })
      this._countupSound.play()
    } catch {}
  }

  _stopCountupSound() {
    if (this._countupSound) {
      try { this._countupSound.stop(); this._countupSound.destroy() } catch {}
      this._countupSound = null
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

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

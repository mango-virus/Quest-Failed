// Phase 31H — Game Over scene, redesigned in the Crypt visual system.
//
// Triggered by BOSS_DEFEATED_FINAL. Header reads 'DUNGEON FALLEN' (boss
// perspective per the user). Three panels: Final Tally / Pacts Sealed /
// Built · Lost. Footer: Leaderboard, New Evil, Main Menu.
//
// Animation: header fades in -> Final Tally rows reveal with per-row
// number count-up -> Pacts Sealed timeline -> Built/Lost rows -> footer
// buttons. Total ~6 s. Pressing any key (or clicking) jumps to the
// fully-populated state.

import {
  CRYPT, FONT_HEAD, FONT_BODY,
  pixelPanel, pixelButton, pixelDiamond, applyUiCamera,
} from '../ui/UIKit.js'
import { SaveSystem }    from '../systems/SaveSystem.js'
import { TitleMusic }    from '../systems/TitleMusic.js'
import { GameplayMusic } from '../systems/GameplayMusic.js'
import { SfxVolume }     from '../systems/SfxVolume.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { Leaderboard }   from '../systems/Leaderboard.js'

const W = 1280
const H = 720

// Animation timings — tuned so the whole reveal lands in ~6 s but each
// row is visible long enough that the count-up doesn't blur into noise.
const HEADER_FADE_MS  = 800
const ROW_FADE_MS     = 220
const ROW_STAGGER_MS  = 110
const COUNT_UP_MS     = 600
const PACTS_STAGGER_MS = 160
const PHASE_GAP_MS    = 280     // pause between sections
const FOOTER_FADE_MS  = 400

export class GameOver extends Phaser.Scene {
  constructor() {
    super('GameOver')
    this._gameState = null
    this._objects   = []
    this._buttons   = []
    this._tweens    = []
    this._countTimers = []
    this._completed = false   // true once skip-to-end has fired
    this._countTargets = []   // [{textObj, target}] so skip can finish them
    this._countupSound    = null
    this._pendingCountUps = 0
  }

  init(data) {
    this._gameState = data?.gameState ?? null
  }

  create() {
    // Silence all background music the moment the run ends — the dungeon
    // playlist or a boss-fight loop is still running when BOSS_DEFEATED_FINAL
    // transitions us in. Only the count-up SFX should be audible here.
    GameplayMusic.stop?.()
    TitleMusic.stop?.()

    this._setupCamera()
    this.scale.on('resize', this._setupCamera, this)
    this.events.once('shutdown', () => {
      this.scale.off('resize', this._setupCamera, this)
      this._tweens.forEach(t => t?.stop?.())
      this._countTimers.forEach(t => t?.remove?.(false))
      this._buttons.forEach(b => b?.destroy?.())
      this._objects.forEach(o => o?.destroy?.())
      this._stopCountupSound()
    })

    // Backdrop
    const bg = this.add.graphics().setDepth(0)
    bg.fillStyle(CRYPT.bgDeep, 1)
    bg.fillRect(0, 0, W, H)
    this._objects.push(bg)

    // Skip-on-any-input — handled in update() via flag, set here.
    this.input.keyboard.on('keydown', () => this._skip())
    this.input.on('pointerdown', () => this._skip())

    this._buildHeader()
    this._buildPanels()
    this._buildFooter()
    this._submitLeaderboard()
    // Count real count-ups (numeric, non-zero) so we know when sound should stop.
    this._pendingCountUps = this._countTargets.filter(ct => !ct.finalText && ct.target > 0).length
    this._kickoffSequence()
  }

  _setupCamera() {
    const sw = this.scale.width
    const sh = this.scale.height
    if (sw < 32 || sh < 32) return
    const sf = Math.min(sw / W, sh / H)
    const cam = this.cameras.main
    cam.setZoom(sf)
    cam.setViewport(Math.round((sw - W * sf) / 2), Math.round((sh - H * sf) / 2),
                    W * sf, H * sf)
    cam.setScroll(0, 0)
    cam.setOrigin(0, 0)
    this.uiW = sw / sf
    this.uiH = sh / sf
  }

  // ─── Header ───────────────────────────────────────────────────────────
  _buildHeader() {
    const headerH = 120
    const grad = this.add.graphics().setDepth(1)
    for (let i = 0; i < 8; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(CRYPT.bgStone1),
        Phaser.Display.Color.IntegerToColor(CRYPT.bgDeep),
        7, i,
      )
      grad.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1)
      grad.fillRect(0, Math.round((headerH * i) / 8), W, Math.ceil(headerH / 8) + 1)
    }
    const rule = this.add.graphics().setDepth(1)
    rule.fillStyle(CRYPT.outline, 1); rule.fillRect(0, headerH,     W, 2)
    rule.fillStyle(CRYPT.panelEdgeH, 1); rule.fillRect(0, headerH + 2, W, 1)
    this._objects.push(grad, rule)

    const day = this._gameState?.player?.totalDaysElapsed ?? this._gameState?.meta?.dayNumber ?? 0
    this._headerCaption = this.add.text(W / 2, 30,
      `YOUR REIGN ENDED ON DAY ${day}`, {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.inkMute, letterSpacing: 4,
    }).setOrigin(0.5).setDepth(2).setAlpha(0)

    this._headerTitle = this.add.text(W / 2, 64,
      'DUNGEON · FALLEN', {
      fontFamily: FONT_HEAD, fontSize: '40px', color: CRYPT.accentCss, letterSpacing: 6,
    }).setOrigin(0.5).setDepth(2).setAlpha(0)
    this._headerTitle.setShadow(4, 4, '#000000', 0, false, true)

    this._headerSub = this.add.text(W / 2, 98, this._fatalBlowText(), {
      fontFamily: FONT_BODY, fontSize: '11px', color: CRYPT.inkDim, letterSpacing: 1,
    }).setOrigin(0.5).setDepth(2).setAlpha(0)

    this._objects.push(this._headerCaption, this._headerTitle, this._headerSub)
  }

  _fatalBlowText() {
    const grave = this._gameState?.adventurers?.graveyard ?? []
    // No 'fatal blow' tracker yet; surface a simple flavor line.
    const escaped = this._gameState?.run?.totals?.advsEscaped ?? 0
    if (escaped > 0) return `${escaped} adventurer${escaped === 1 ? '' : 's'} escaped to tell the tale.`
    return 'The dungeon is silent. No witnesses survived.'
  }

  // ─── Body — three panels ──────────────────────────────────────────────
  _buildPanels() {
    const px0 = 32
    const py  = 142
    const pw  = Math.floor((W - 64 - 24) / 3)        // 24 = 2 gaps
    const ph  = H - py - 110

    this._tallyPanel = { x: px0,                 y: py, w: pw, h: ph, rows: [] }
    this._pactsPanel = { x: px0 + pw + 12,        y: py, w: pw, h: ph, rows: [] }
    this._builtPanel = { x: px0 + (pw + 12) * 2,  y: py, w: pw, h: ph, rows: [] }

    this._buildTallyPanel(this._tallyPanel)
    this._buildPactsPanel(this._pactsPanel)
    this._buildBuiltPanel(this._builtPanel)
  }

  _drawPanelChrome(p, title) {
    const g = this.add.graphics().setDepth(1)
    pixelPanel(g, p.x, p.y, p.w, p.h, { fill: CRYPT.bgStone1 })
    this._objects.push(g)

    // Title strip
    const titleH = 28
    const tg = this.add.graphics().setDepth(2)
    tg.fillStyle(CRYPT.panel2, 1)
    tg.fillRect(p.x + 2, p.y + 2, p.w - 4, titleH)
    tg.fillStyle(CRYPT.panelEdgeS, 1)
    tg.fillRect(p.x + 2, p.y + 2 + titleH, p.w - 4, 1)
    this._objects.push(tg)

    const dia = this.add.graphics().setDepth(3)
    pixelDiamond(dia, p.x + 14, p.y + 2 + titleH / 2, 4, CRYPT.accent)
    this._objects.push(dia)

    this._objects.push(this.add.text(p.x + 26, p.y + 2 + titleH / 2, title, {
      fontFamily: FONT_HEAD, fontSize: '10px', color: CRYPT.ink, letterSpacing: 3,
    }).setOrigin(0, 0.5).setDepth(3))

    return p.y + 2 + titleH + 14   // first content y
  }

  _buildTallyPanel(p) {
    const yStart = this._drawPanelChrome(p, 'FINAL TALLY')
    const tot   = this._gameState?.run?.totals ?? {}
    const player = this._gameState?.player ?? {}
    const tally = [
      { l: 'DAYS SURVIVED',  v: player.totalDaysElapsed ?? 0 },
      { l: 'WAVES REPELLED', v: this._gameState?.history?.days?.length ?? 0 },
      { l: 'ADVS SLAIN',     v: tot.advsKilled  ?? 0 },
      { l: 'ADVS ESCAPED',   v: tot.advsEscaped ?? 0 },
      { l: 'GOLD EARNED',    v: tot.gold        ?? 0 },
      { l: 'DAMAGE DEALT',   v: tot.dmgDealt    ?? 0 },
      { l: 'DAMAGE TAKEN',   v: tot.dmgTaken    ?? 0 },
    ]
    let y = yStart
    for (const r of tally) {
      const rowObjs = this._buildKVRow(p.x + 16, y, p.w - 32, r.l, r.v)
      p.rows.push(rowObjs)
      y += 26
    }
  }

  _buildPactsPanel(p) {
    const yStart = this._drawPanelChrome(p, 'PACTS SEALED')
    const pacts  = this._gameState?.history?.pacts ?? []
    const dMechs = this.cache.json.get('dungeonMechanics') ?? []
    const lookup = (id) => dMechs.find(d => d.id === id)?.name ?? id
    const rarColor = (r) => r === 'legendary' ? CRYPT.accentCss
                          : r === 'epic'      ? CRYPT.soulCss
                          : r === 'rare'      ? CRYPT.goldCss
                          :                     CRYPT.inkMute

    if (pacts.length === 0) {
      const t = this.add.text(p.x + p.w / 2, yStart + 80, '— NO PACTS THIS RUN —', {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5).setDepth(3).setAlpha(0)
      this._objects.push(t)
      p.rows.push([t])
      return
    }

    let y = yStart
    const rowH = 28
    const visibleH = p.h - (yStart - p.y) - 12
    const maxRows = Math.max(1, Math.floor(visibleH / rowH))
    pacts.slice(-maxRows).forEach((pact) => {
      const rowG = this.add.graphics().setDepth(2)
      pixelPanel(rowG, p.x + 16, y, p.w - 32, rowH - 4, {
        fill: CRYPT.bgStone2, edgeH: CRYPT.panelEdgeS, edgeS: CRYPT.panelEdgeH, inset: true,
      })
      rowG.setAlpha(0)
      const dayT = this.add.text(p.x + 24, y + (rowH - 4) / 2, `D${pact.day}`, {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 1,
      }).setOrigin(0, 0.5).setDepth(3).setAlpha(0)
      const nameT = this.add.text(p.x + 56, y + (rowH - 4) / 2,
        lookup(pact.mechanicId).toUpperCase(), {
        fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
      }).setOrigin(0, 0.5).setDepth(3).setAlpha(0)
      const rarT = this.add.text(p.x + p.w - 24, y + (rowH - 4) / 2,
        (pact.rarity ?? 'common').toUpperCase(), {
        fontFamily: FONT_HEAD, fontSize: '7px', color: rarColor(pact.rarity), letterSpacing: 1,
      }).setOrigin(1, 0.5).setDepth(3).setAlpha(0)
      this._objects.push(rowG, dayT, nameT, rarT)
      p.rows.push([rowG, dayT, nameT, rarT])
      y += rowH
    })
  }

  _buildBuiltPanel(p) {
    const yStart = this._drawPanelChrome(p, 'BUILT · LOST')
    const tot    = this._gameState?.run?.totals ?? {}
    const stats = [
      { l: 'ROOMS BUILT',     v: tot.roomsBuilt      ?? 0, c: CRYPT.goldCss   },
      { l: 'ROOMS DESTROYED', v: tot.roomsDestroyed  ?? 0, c: CRYPT.accent2Css },
      { l: 'MINIONS SUMMONED',v: tot.minionsSummoned ?? 0, c: CRYPT.greenCss  },
      { l: 'MINIONS LOST',    v: tot.minionsLost     ?? 0, c: CRYPT.accentCss },
      { l: 'TRAPS PLACED',    v: tot.trapsPlaced     ?? 0, c: CRYPT.warnCss   },
      { l: 'TRAPS DISARMED',  v: tot.trapsDisarmed   ?? 0, c: CRYPT.inkDim    },
    ]
    let y = yStart
    for (const r of stats) {
      const rowObjs = this._buildKVRow(p.x + 16, y, p.w - 32, r.l, r.v, r.c)
      p.rows.push(rowObjs)
      y += 26
    }

    // Two flavor lines at the bottom
    y += 8
    const grave = this._gameState?.adventurers?.graveyard ?? []
    const minions = this._gameState?.minions ?? []
    let topMinion = null, topKills = -1
    for (const m of minions) {
      const k = m.lifetime?.kills ?? 0
      if (k > topKills) { topMinion = m; topKills = k }
    }
    const mostLethal = topMinion
      ? `${topMinion.name ?? this._minionName(topMinion)} — ${topKills} kills`
      : '— none —'

    const lethalLabel = this.add.text(p.x + 16, y, 'MOST LETHAL', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(3).setAlpha(0)
    const lethalVal = this.add.text(p.x + 16, y + 12, mostLethal, {
      fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
      wordWrap: { width: p.w - 32, useAdvancedWrap: true },
    }).setDepth(3).setAlpha(0)
    p.rows.push([lethalLabel, lethalVal])
    y += 32

    // Biggest leak: highest-escapeCount entry in adventurers.known
    const known = this._gameState?.adventurers?.known ?? []
    let topLeak = null
    for (const k of known) if (!topLeak || (k.escapeCount ?? 0) > (topLeak.escapeCount ?? 0)) topLeak = k
    const leakStr = topLeak
      ? `${topLeak.name} escaped ${topLeak.escapeCount}×`
      : '— no escapees —'

    const leakLabel = this.add.text(p.x + 16, y, 'BIGGEST LEAK', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(3).setAlpha(0)
    const leakVal = this.add.text(p.x + 16, y + 12, leakStr, {
      fontFamily: FONT_BODY, fontSize: '9px', color: CRYPT.ink, letterSpacing: 1,
      wordWrap: { width: p.w - 32, useAdvancedWrap: true },
    }).setDepth(3).setAlpha(0)
    p.rows.push([leakLabel, leakVal])

    void grave  // grave reserved for future "fatal blow" attribution
  }

  _buildKVRow(x, y, w, label, value, valueColor = CRYPT.ink) {
    const labelT = this.add.text(x, y, label, {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(3).setAlpha(0)
    // The numeric text starts at 0 and gets count-up'd by the row reveal.
    const valueT = this.add.text(x + w, y, '0', {
      fontFamily: FONT_HEAD, fontSize: '12px', color: valueColor, letterSpacing: 1,
    }).setOrigin(1, 0).setDepth(3).setAlpha(0)
    this._objects.push(labelT, valueT)
    // Track count-up target so animator + skip can drive the number.
    if (typeof value === 'number') {
      this._countTargets.push({ textObj: valueT, target: value })
    } else {
      // Non-numeric value (e.g. boss-class string) — just store the
      // final text so skip / reveal sets it without count-up math.
      this._countTargets.push({ textObj: valueT, target: 0, finalText: String(value) })
    }
    return [labelT, valueT]
  }

  _minionName(m) {
    const def = (this.cache.json.get('minionTypes') ?? []).find(d => d.id === m.definitionId)
    return def?.name ?? m.definitionId ?? 'minion'
  }

  // ─── Footer ───────────────────────────────────────────────────────────
  _buildFooter() {
    const fy = H - 70
    const fbg = this.add.graphics().setDepth(1)
    fbg.fillStyle(CRYPT.panelEdgeS, 1); fbg.fillRect(0, fy - 4, W, 2)
    fbg.fillStyle(CRYPT.panelEdgeH, 1); fbg.fillRect(0, fy - 2, W, 1)
    this._objects.push(fbg)

    const btnY = fy + 8
    const totalW = 200 + 12 + 220 + 12 + 200
    let bx = (W - totalW) / 2
    const btn1 = pixelButton(this, bx, btnY, 200, 44, 'LEADERBOARD', {
      depth: 5, fontSize: 10,
      onClick: () => this.scene.start('Leaderboard'),
    })
    bx += 212
    const btn2 = pixelButton(this, bx, btnY, 220, 44, 'NEW EVIL', {
      depth: 5, fontSize: 11, primary: true,
      onClick: () => this._newRun(),
    })
    bx += 232
    const btn3 = pixelButton(this, bx, btnY, 200, 44, 'MAIN MENU', {
      depth: 5, fontSize: 10,
      onClick: () => this._mainMenu(),
    })
    this._buttons.push(btn1, btn2, btn3)
    // Buttons start hidden — appear at the end of the animation.
    for (const b of this._buttons) {
      b.bg.setAlpha(0); b.label.setAlpha(0); b.hit.input.enabled = false
      if (b._customLabels) b._customLabels.forEach(l => l.setAlpha(0))
    }
  }

  // ─── Animation orchestration ──────────────────────────────────────────
  _kickoffSequence() {
    let t = 0

    // Phase 0: header fade
    this._fadeIn([this._headerCaption, this._headerTitle, this._headerSub], t, HEADER_FADE_MS)
    t += HEADER_FADE_MS + PHASE_GAP_MS

    // Start count-up sound when the first tally row appears.
    if (this._pendingCountUps > 0) {
      this._tweens.push(this.time.delayedCall(t, () => this._startCountupSound()))
    }

    // Phase 1: tally rows
    t = this._revealRowsWithCountUp(this._tallyPanel.rows, t)
    t += PHASE_GAP_MS

    // Phase 2: pacts
    t = this._revealRowsStaggered(this._pactsPanel.rows, t, PACTS_STAGGER_MS, ROW_FADE_MS)
    t += PHASE_GAP_MS

    // Phase 3: built/lost rows (with count-up)
    t = this._revealRowsWithCountUp(this._builtPanel.rows, t)
    t += PHASE_GAP_MS

    // Phase 4: footer buttons
    this._revealFooter(t)
  }

  _revealRowsWithCountUp(rows, startT) {
    let t = startT
    let cIdx = 0
    // Find the count target index range that aligns with these rows.
    // The count targets were pushed in build-order alongside the rows;
    // assume one target per row pair (label + value).
    const targetsForRow = []
    for (const row of rows) {
      // Try to match a target whose textObj is row[1]
      const match = this._countTargets.find(ct => row.includes(ct.textObj))
      targetsForRow.push(match ?? null)
    }
    rows.forEach((row, i) => {
      this._fadeIn(row, t, ROW_FADE_MS)
      const ct = targetsForRow[i]
      if (ct) this._scheduleCountUp(ct, t)
      t += ROW_STAGGER_MS
      cIdx++
    })
    return t + ROW_FADE_MS
  }

  _revealRowsStaggered(rows, startT, stagger, fadeMs) {
    let t = startT
    rows.forEach(row => {
      this._fadeIn(row, t, fadeMs)
      t += stagger
    })
    return t + fadeMs
  }

  _revealFooter(startT) {
    const objs = []
    for (const b of this._buttons) {
      objs.push(b.bg, b.label)
      if (b._customLabels) objs.push(...b._customLabels)
    }
    this._fadeIn(objs, startT, FOOTER_FADE_MS)
    // Re-enable hit zones after the fade completes.
    this._tweens.push(this.time.delayedCall(startT + FOOTER_FADE_MS, () => {
      for (const b of this._buttons) b.hit.input.enabled = true
    }))
  }

  _fadeIn(targets, delay, duration) {
    if (!targets || !targets.length) return
    const tw = this.tweens.add({
      targets, alpha: 1, duration, delay, ease: 'Quad.easeOut',
    })
    this._tweens.push(tw)
  }

  _scheduleCountUp(ct, delay) {
    // Count-up runs after the row's fade-in starts. Uses a per-frame timer
    // so we can write integer values to the text object.
    const start = 0
    const target = ct.target
    if (ct.finalText) {
      // Non-numeric — just set the text after a delay.
      this._tweens.push(this.time.delayedCall(delay, () => {
        ct.textObj.setText(ct.finalText)
      }))
      return
    }
    if (target === 0) {
      this._tweens.push(this.time.delayedCall(delay, () => {
        ct.textObj.setText('0')
      }))
      return
    }
    // Schedule the count-up start
    this._tweens.push(this.time.delayedCall(delay, () => {
      const startMs = this.time.now
      const tick = this.time.addEvent({
        delay: 30,
        repeat: Math.ceil(COUNT_UP_MS / 30),
        callback: () => {
          const elapsed = this.time.now - startMs
          const t = Math.min(1, elapsed / COUNT_UP_MS)
          // easeOutCubic
          const eased = 1 - Math.pow(1 - t, 3)
          const v = Math.round(start + (target - start) * eased)
          ct.textObj.setText(v.toLocaleString('en-US'))
          if (t >= 1) {
            tick.remove(false)
            this._pendingCountUps--
            if (this._pendingCountUps <= 0) this._stopCountupSound()
          }
        },
      })
      this._countTimers.push(tick)
    }))
  }

  _skip() {
    if (this._completed) return
    this._completed = true
    this._stopCountupSound()
    // Stop every running tween + count-up timer.
    for (const t of this._tweens) t?.remove?.(false) ?? t?.stop?.()
    this._tweens = []
    for (const t of this._countTimers) t?.remove?.(false)
    this._countTimers = []
    // Snap every animated object to alpha 1 + final value.
    for (const o of this._objects) o?.setAlpha?.(1)
    for (const ct of this._countTargets) {
      if (ct.finalText) ct.textObj.setText(ct.finalText)
      else              ct.textObj.setText((ct.target ?? 0).toLocaleString('en-US'))
    }
    for (const b of this._buttons) {
      b.bg.setAlpha(1); b.label.setAlpha(1)
      if (b._customLabels) b._customLabels.forEach(l => l.setAlpha(1))
      b.hit.input.enabled = true
    }
  }

  // ─── Count-up sound ───────────────────────────────────────────────────
  _startCountupSound() {
    if (this._countupSound || !this.cache.audio.exists('sfx-score-countup')) return
    this._countupSound = this.sound.add('sfx-score-countup', {
      loop: true,
      volume: this._sfxVolume(),
    })
    this._countupSound.play()
  }

  _stopCountupSound() {
    if (!this._countupSound) return
    this._countupSound.stop()
    this._countupSound.destroy()
    this._countupSound = null
  }

  _sfxVolume() {
    if (SfxVolume.isMuted()) return 0
    return Math.min(1, 0.55 * SfxVolume.getVolume())
  }

  // ─── Leaderboard submission ───────────────────────────────────────────
  // Fire-and-forget POST to Supabase. A failed submission (offline,
  // network blip, RLS error) is silently logged — it must not block the
  // post-run flow. Submits exactly once per scene activation: GameOver is
  // re-entered when the player picks NEW EVIL, but at that point a fresh
  // gameState will populate.
  _submitLeaderboard() {
    if (this._submitted) return
    this._submitted = true

    const gs    = this._gameState ?? {}
    const tot   = gs.run?.totals ?? {}
    const player = gs.player ?? {}
    const name   = (PlayerProfile.getName?.() || '').trim() || 'ANON'
    const days   = Number(player.totalDaysElapsed ?? gs.meta?.dayNumber ?? 0)
    const kills  = Number(tot.advsKilled ?? player.totalKills ?? 0)

    // Skip submissions that look like noise (player quit before any kills
    // on day 1, or no boss picked).
    if (!player.bossArchetypeId || (days <= 1 && kills === 0)) return

    const run = {
      player_name:   name.slice(0, 32),
      boss_id:       String(player.bossArchetypeId),
      boss_level:    Number(gs.boss?.level ?? 1),
      days_survived: days,
      total_kills:   kills,
      gold:          Number(tot.gold ?? player.soulEssence ?? 0),
      dark_power:    Number(player.darkPower ?? 0),
      end_cause:     'death',
      meta: {
        roomsBuilt:     Number(tot.roomsBuilt ?? 0),
        minionsSummoned: Number(tot.minionsSummoned ?? 0),
        minionsLost:    Number(tot.minionsLost ?? 0),
        advsEscaped:    Number(tot.advsEscaped ?? 0),
        dmgDealt:       Number(tot.dmgDealt ?? 0),
        dmgTaken:       Number(tot.dmgTaken ?? 0),
      },
    }

    Leaderboard.submitRun(run).catch(err => {
      console.warn('[Leaderboard] submit failed:', err.message)
    })
  }

  // ─── Footer actions ───────────────────────────────────────────────────
  _newRun() {
    SaveSystem.deleteSave?.()
    SaveSystem.clear?.()
    // Tear down BOTH music modules before scene transition. ArchetypeSelect
    // calls TitleMusic.ensurePlaying on entry — without stopping the
    // dungeon playlist first, the gameplay tracks layer on top of title
    // music (and again on top of any prior title-music instance that
    // _newRun's stop() didn't catch).
    GameplayMusic.stop?.()
    TitleMusic.stop?.()
    this.scene.start('ArchetypeSelect')
  }

  _mainMenu() {
    SaveSystem.deleteSave?.()
    this.scene.start('MainMenu')
  }
}

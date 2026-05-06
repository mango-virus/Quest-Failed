// Boss Level-Up celebratory popup. Pops over EndOfDay after the
// PostWaveSummary closes, BEFORE the level-gate handoff to the night
// phase. Banner + count-up + grid of newly unlocked content (rooms,
// minions, traps, items) for the level the boss just reached.
//
// Listens for SHOW_BOSS_LEVEL_UP { fromLevel, toLevel } emitted by
// EndOfDay (or whoever drains the queue). Multiple level-ups in one day
// chain — caller fires the event N times, popup re-opens after each
// CONTINUE click. Emits BOSS_LEVEL_UP_DISMISSED on close.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelButton } from '../UIKit.js'
import { makePopupFrame } from './PopupFrame.js'
import { EventBus } from '../../systems/EventBus.js'
import { Balance }  from '../../config/balance.js'

const D_BASE = 205

export class BossLevelUpPopup {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._fromLevel = 1
    this._toLevel   = 2

    this._frame = makePopupFrame({
      scene,
      w:    900,
      h:    560,
      title:'BOSS LEVEL UP',
      depth: 200,
      onClose: () => EventBus.emit('BOSS_LEVEL_UP_DISMISSED'),
      render: (px, py, cx, cy, cw, ch, addChild) => this._render(cx, cy, cw, ch, addChild),
    })
  }

  setLevels(fromLevel, toLevel) {
    this._fromLevel = fromLevel
    this._toLevel   = toLevel
  }
  open()    { this._frame.open() }
  close()   { this._frame.close() }
  destroy() { this.close() }

  _render(cx, cy, cw, ch, addChild) {
    const D = D_BASE
    const newLevel = this._toLevel
    const oldLevel = this._fromLevel

    // ── Banner row: big "LEVEL X" badge + stat-delta tags ────────────
    const bannerH = 110
    const bannerG = this._scene.add.graphics().setDepth(D)
    pixelPanel(bannerG, cx, cy, cw, bannerH, { fill: CRYPT.bgStone1 })
    addChild(bannerG)

    // Pulsing accent ring under the banner — reads as "this is special"
    const ring = this._scene.add.graphics().setDepth(D + 1)
    addChild(ring)
    this._scene.tweens.add({
      targets: ring,
      alpha:   { from: 0.25, to: 0.85 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      onUpdate: () => {
        ring.clear()
        ring.lineStyle(2, CRYPT.accent, 1)
        ring.strokeRect(cx + 2, cy + 2, cw - 4, bannerH - 4)
      },
    })

    // BOSS LEVEL UP heading
    const headT = this._scene.add.text(cx + cw / 2, cy + 14, 'BOSS LEVEL UP', {
      fontFamily: FONT_HEAD, fontSize: '20px', color: CRYPT.accentCss, letterSpacing: 5,
    }).setOrigin(0.5, 0).setDepth(D + 2)
    headT.setShadow(3, 3, '#000000', 0, false, true)
    addChild(headT)
    // Pop-in: scale up from 0.6 → 1.0 with bounce
    headT.setScale(0.6).setAlpha(0)
    this._scene.tweens.add({
      targets: headT, scale: 1, alpha: 1,
      duration: 380, ease: 'Back.easeOut',
    })

    // Level X → Y display, big and centered. Count up the new value.
    const levelLineY = cy + 50
    const arrowT = this._scene.add.text(cx + cw / 2, levelLineY, `LEVEL ${oldLevel}  →  LEVEL ${oldLevel}`, {
      fontFamily: FONT_HEAD, fontSize: '32px', color: CRYPT.goldCss, letterSpacing: 3,
      stroke: '#1a0a05', strokeThickness: 4,
    }).setOrigin(0.5, 0).setDepth(D + 2)
    addChild(arrowT)
    // After ~500ms, count the second number up to newLevel
    this._scene.time.delayedCall(500, () => {
      if (!arrowT.scene) return
      this._scene.tweens.addCounter({
        from: oldLevel, to: newLevel,
        duration: 500, ease: 'Quad.easeOut',
        onUpdate: (tw) => {
          const v = Math.round(tw.getValue())
          arrowT.setText(`LEVEL ${oldLevel}  →  LEVEL ${v}`)
        },
      })
      // Celebration chime — amplified past 1.0 because the source file
      // is mastered low. Phaser's WebAudio path supports gain > 1.0.
      try {
        if (this._scene.cache?.audio?.exists?.('sfx-collect-gold')) {
          this._scene.sound.play('sfx-collect-gold', { volume: 2.5 })
        }
      } catch {}
    })

    // ── Stat-delta banner ────────────────────────────────────────────
    const statsY = cy + bannerH + 12
    const statsH = 48
    const statsG = this._scene.add.graphics().setDepth(D)
    pixelPanel(statsG, cx, statsY, cw, statsH, { fill: CRYPT.bgStone2 })
    addChild(statsG)

    const hpPct  = Math.round((Balance.MINION_HP_PER_BOSS_LV  ?? 0.10) * 100)
    const atkPct = Math.round((Balance.MINION_ATK_PER_BOSS_LV ?? 0.07) * 100)
    const tags = [
      { lbl: 'MINION HP',  val: `+${hpPct}%`,  color: CRYPT.greenCss ?? '#33cc77' },
      { lbl: 'MINION ATK', val: `+${atkPct}%`, color: CRYPT.accent2Css },
      { lbl: 'GRID',       val: '+5 / +5',     color: CRYPT.soulCss   },
    ]
    const tagW = (cw - 32) / tags.length
    tags.forEach((t, i) => {
      const tx = cx + 16 + tagW * i + tagW / 2
      addChild(this._scene.add.text(tx, statsY + 10, t.lbl, {
        fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 2,
      }).setOrigin(0.5, 0).setDepth(D + 2))
      addChild(this._scene.add.text(tx, statsY + 26, t.val, {
        fontFamily: FONT_HEAD, fontSize: '14px', color: t.color, letterSpacing: 1,
      }).setOrigin(0.5, 0).setDepth(D + 2))
    })

    // ── Unlocks grid ─────────────────────────────────────────────────
    const unlocksY = statsY + statsH + 14
    const unlocksH = ch - (unlocksY - cy) - 60   // leave room for CONTINUE
    this._renderUnlocks(cx, unlocksY, cw, unlocksH, D, addChild, newLevel)

    // ── CONTINUE button ──────────────────────────────────────────────
    const btnW = 200, btnH = 40
    const btnX = cx + (cw - btnW) / 2
    const btnY = cy + ch - btnH - 4
    const btn = pixelButton(this._scene, btnX, btnY, btnW, btnH, 'CONTINUE', {
      depth: D + 5, fontSize: 11, primary: true,
      onClick: () => this.close(),
    })
    addChild(btn.bg, btn.label, btn.hit)
    if (btn._customLabels) for (const l of btn._customLabels) addChild(l)
  }

  // Filter every catalog by the just-reached unlockLevel and render a
  // 4-column grid (rooms / minions / traps / items). Empty columns just
  // show a "— none —" placeholder so the layout stays balanced.
  _renderUnlocks(cx, cy, cw, ch, D, addChild, level) {
    const cats = [
      { title: 'NEW ROOMS',   data: this._unlockedAtLevel('rooms',       level) },
      { title: 'NEW MINIONS', data: this._unlockedAtLevel('minionTypes', level) },
      { title: 'NEW TRAPS',   data: this._unlockedAtLevel('trapTypes',   level) },
      { title: 'NEW ITEMS',   data: this._unlockedAtLevel('items',       level) },
    ]
    const colW = (cw - 24) / cats.length
    cats.forEach((cat, i) => {
      const x = cx + 12 + colW * i
      // Column header
      addChild(this._scene.add.text(x + colW / 2, cy + 4, cat.title, {
        fontFamily: FONT_HEAD, fontSize: '9px',
        color: CRYPT.accent2Css, letterSpacing: 2,
      }).setOrigin(0.5, 0).setDepth(D + 2))
      // Underline
      const ul = this._scene.add.graphics().setDepth(D + 2)
      ul.fillStyle(CRYPT.panelEdgeH, 1)
      ul.fillRect(x + 8, cy + 22, colW - 16, 1)
      addChild(ul)
      // List
      if (cat.data.length === 0) {
        addChild(this._scene.add.text(x + colW / 2, cy + 50, '— none —', {
          fontFamily: FONT_BODY, fontSize: '9px',
          color: CRYPT.inkMute, letterSpacing: 1,
        }).setOrigin(0.5, 0).setDepth(D + 2))
        return
      }
      const rowH = 22
      cat.data.slice(0, 8).forEach((it, j) => {
        const ry = cy + 30 + j * rowH
        // Subtle row stripe for legibility
        if (j % 2 === 1) {
          const stripe = this._scene.add.graphics().setDepth(D + 1)
          stripe.fillStyle(CRYPT.bgStone2, 0.6)
          stripe.fillRect(x + 4, ry - 2, colW - 8, rowH - 4)
          addChild(stripe)
        }
        const name = String(it.name ?? it.id ?? '?').toUpperCase()
        addChild(this._scene.add.text(x + 10, ry + 4, name, {
          fontFamily: FONT_HEAD, fontSize: '8px',
          color: CRYPT.ink, letterSpacing: 1,
        }).setOrigin(0, 0).setDepth(D + 3))
      })
      if (cat.data.length > 8) {
        addChild(this._scene.add.text(x + colW / 2, cy + 30 + 8 * rowH + 4,
          `+${cat.data.length - 8} more`, {
          fontFamily: FONT_HEAD, fontSize: '7px',
          color: CRYPT.inkMute, letterSpacing: 1,
        }).setOrigin(0.5, 0).setDepth(D + 3))
      }
    })
  }

  _unlockedAtLevel(cacheKey, level) {
    const all = this._scene.cache.json.get(cacheKey) ?? []
    return all.filter(d => (d?.unlockLevel ?? 1) === level && !d?.hidden)
  }
}

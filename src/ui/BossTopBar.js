// SUPERSEDED (Phase 34) — replaced by `src/hud/TopBar.js` under the
// new DOM HUD. Phaser fallback under `?newhud=0`. Kept per CLAUDE.md.
//
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

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelBar, pixelDiamond, uiSfxHover, uiSfxClick } from './UIKit.js'
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
      uiSfxHover(this._scene)
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
      if (wasPressed) {
        uiSfxClick(this._scene)
        EventBus.emit('OPEN_BOSS_OVERVIEW')
      }
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

    // LV badge — anchored at the right edge of the left column
    this._levelT = this._scene.add.text(x + w - PADDING_X, cy + 2,
      this._levelText(), {
        fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.goldCss, letterSpacing: 1,
      }).setOrigin(1, 0).setDepth(D)
    this._objects.push(this._levelT)

    // HP bar — narrowed to leave room for the lives hearts on the same row
    const barX = cx + avatarSize + 10
    const barY = cy + 16
    const HEART_SIZE  = 14   // display px (native sprites are 17×16)
    const HEART_GAP   = 3
    const LIVES_TOTAL = 3
    const livesW = LIVES_TOTAL * HEART_SIZE + (LIVES_TOTAL - 1) * HEART_GAP
    const barW = w - (barX - x) - PADDING_X - livesW - 8
    const boss = this._gameState.boss
    const hp   = boss?.hp ?? 100
    const max  = boss?.maxHp ?? 100
    this._hpBar = pixelBar(this._scene, barX, barY, barW, 11, hp, max, {
      color: 'red', label: `${Math.round(hp)} / ${Math.round(max)}`, depth: D, fontSize: 8,
    })
    this._objects.push(this._hpBar.g, this._hpBar.txt)

    // Lives hearts — sprite per life; drain animation plays when a life is lost
    const heartsX   = barX + barW + 8
    const heartsY   = barY + 5   // vertically centred in the 11px bar
    const remaining = boss?.deathsRemaining ?? LIVES_TOTAL
    this._hearts    = []
    this._prevLives = remaining
    for (let i = 0; i < LIVES_TOTAL; i++) {
      const key = i < remaining ? 'heart-full' : 'heart-empty'
      const spr = this._scene.add.sprite(heartsX + i * (HEART_SIZE + HEART_GAP), heartsY, key)
        .setOrigin(0, 0.5).setDisplaySize(HEART_SIZE, HEART_SIZE).setDepth(D)
      this._objects.push(spr)
      this._hearts.push(spr)
    }

    // XP bar — sits below HP bar; tracks boss XP toward next dungeon level
    const xpBarY = barY + 13
    const xp    = this._gameState.boss?.xp ?? 0
    const xpMax = this._gameState.boss?.xpToNext ?? 100
    this._xpBar = pixelBar(this._scene, barX, xpBarY, barW, 9, xp, Math.max(1, xpMax), {
      color: 'green', label: `${xp} / ${xpMax} XP`, depth: D, fontSize: 7,
    })
    this._objects.push(this._xpBar.g)
    if (this._xpBar.txt) this._objects.push(this._xpBar.txt)
  }

  _levelText() {
    return `LV ${this._gameState.boss?.level ?? 1}`
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
    this._goldDepth = D

    // Tiny TREASURY tag — header sits above the big number.
    const dia = this._scene.add.graphics().setDepth(D)
    pixelDiamond(dia, startX + 4, 8, 3, CRYPT.accent)
    this._objects.push(dia)
    const hdr = this._scene.add.text(startX + 12, 4, 'TREASURY', {
      fontFamily: FONT_HEAD, fontSize: '7px', color: CRYPT.inkMute, letterSpacing: 2,
    }).setDepth(D)
    this._objects.push(hdr)

    // Pile sprite — center-anchored on the same vertical line as the
    // number so they read as a single block. Swaps + scales by wealth
    // tier so the visual itself communicates "small / modest / vast."
    const initialGold = this._gameState.player?.gold ?? 0
    this._goldTier = this._goldTierFor(initialGold)
    const numAnchorY = 32
    const pileX = startX + 8
    this._goldPile = this._scene.add.image(pileX, numAnchorY, this._goldTexFor(this._goldTier))
      .setOrigin(0, 0.5).setDepth(D).setScale(this._goldPileScaleFor(this._goldTier))
    this._objects.push(this._goldPile)

    // Glow halo behind the big number — pulses at high wealth tiers.
    const numAnchorX = startX + 44
    this._goldGlow = this._scene.add.graphics().setDepth(D - 1)
    this._objects.push(this._goldGlow)
    this._goldGlowAt = { x: numAnchorX + 24, y: numAnchorY }

    // BIG GOLD NUMBER — dominates the panel. 22px, gold, stroked.
    this._goldDisplayed = initialGold   // animated value (lerped)
    this._goldNumber = this._scene.add.text(numAnchorX, numAnchorY,
      this._formatNumber(initialGold), {
        fontFamily: FONT_HEAD, fontSize: '22px',
        color: CRYPT.goldCss, letterSpacing: 1,
        stroke: '#1a0a05', strokeThickness: 3,
      }).setOrigin(0, 0.5).setDepth(D)
    this._objects.push(this._goldNumber)

    // Old _resTexts list intentionally cleared — the gold readout is
    // now driven by _updateGold() below, not the generic resource loop.
    this._resTexts = []
    this._lastGold = initialGold
  }

  // ── Gold visual tiers ───────────────────────────────────────────────
  // Three sprites in escalating "wealth weight":
  //   0: a single coin     — the "couple of pennies" look
  //   1: a pile of coins   — modest stash
  //   2: a fat coin bag    — proper hoard
  _goldTierFor(gold) {
    if (gold < 100)  return 0   // single coin
    if (gold < 1000) return 1   // gold coins pile
    return 2                     // coin bag
  }
  _goldTexFor(tier) {
    return tier === 0 ? 'ui-coin'
         : tier === 1 ? 'item-gold-coins'
         :              'ui-coin-bag'
  }
  _goldPileScaleFor(tier) {
    return [1.1, 1.2, 1.3][tier] ?? 1.0
  }

  // ── Per-tick gold update + animations ───────────────────────────────
  _updateGold() {
    const cur = this._gameState.player?.gold ?? 0
    if (cur !== this._lastGold) {
      const delta = cur - this._lastGold
      this._popGoldFloater(delta)
      this._tweenGoldTo(cur)
      this._pulseGoldNumber(delta)
      // Pile tier swap + scale
      const newTier = this._goldTierFor(cur)
      if (newTier !== this._goldTier) {
        this._goldTier = newTier
        this._goldPile?.setTexture(this._goldTexFor(newTier))
        this._goldPile?.setScale(this._goldPileScaleFor(newTier))
      }
      // Soft ka-ching for meaningful gains; silent for tiny ticks and losses.
      if (delta >= 25 && this.cache?.audio?.exists?.('sfx-collect-gold')) {
        try { this._scene.sound.play('sfx-collect-gold', { volume: 0.4 }) } catch {}
      }
      this._lastGold = cur
    }

    // Pulsing glow at high wealth — sin-wave alpha, dormant below the
    // threshold so casual play doesn't shimmer constantly.
    if (this._goldGlow) {
      this._goldGlow.clear()
      if (cur >= 1000) {
        const t = this._scene.time.now / 700
        const a = 0.18 + 0.18 * Math.abs(Math.sin(t))
        this._goldGlow.fillStyle(0xffe066, a)
        this._goldGlow.fillCircle(this._goldGlowAt.x, this._goldGlowAt.y, 22)
      }
    }
  }

  // 400ms count-up/down lerp on the displayed value. Cancels any
  // in-flight tween so rapid changes don't stack.
  _tweenGoldTo(target) {
    if (this._goldTickTween) this._goldTickTween.stop()
    const from = this._goldDisplayed
    this._goldTickTween = this._scene.tweens.addCounter({
      from, to: target,
      duration: 400,
      ease: 'Quad.easeOut',
      onUpdate: (tw) => {
        const v = Math.round(tw.getValue())
        this._goldDisplayed = v
        this._goldNumber?.setText(this._formatNumber(v))
      },
      onComplete: () => {
        this._goldDisplayed = target
        this._goldNumber?.setText(this._formatNumber(target))
        this._goldTickTween = null
      },
    })
  }

  // Brief scale-bump + colour flash on the big gold number itself when the
  // value changes. Gains tint a slightly brighter gold and bump bigger;
  // losses tint red. The text origin is (0, 0.5) so we shift x to keep the
  // number visually centered on its left anchor while scaling.
  _pulseGoldNumber(delta) {
    if (!delta || !this._goldNumber) return
    const isGain = delta > 0
    const targetScale = isGain ? 1.18 : 1.08
    const flashColor  = isGain ? '#fff2a0' : '#ff8a6a'
    // Stop any in-flight pulse so rapid changes don't fight each other.
    if (this._goldPulseTween) this._goldPulseTween.stop()
    this._goldNumber.setScale(1)
    this._goldNumber.setColor(flashColor)
    this._goldPulseTween = this._scene.tweens.add({
      targets:  this._goldNumber,
      scale:    { from: targetScale, to: 1 },
      duration: 280,
      ease:     'Back.easeOut',
      onComplete: () => {
        this._goldNumber?.setColor(CRYPT.goldCss)
        this._goldNumber?.setScale(1)
        this._goldPulseTween = null
      },
    })
  }

  // Brief +N (green) or -N (red) floater next to the number. Fades up.
  _popGoldFloater(delta) {
    if (!delta || !this._goldNumber) return
    const isGain = delta > 0
    const x = this._goldNumber.x + this._goldNumber.width + 6
    const y = this._goldNumber.y
    const t = this._scene.add.text(x, y, (isGain ? '+' : '') + delta, {
      fontFamily: FONT_HEAD, fontSize: '10px',
      color: isGain ? '#33cc77' : '#cc4422',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0, 0.5).setDepth((this._goldDepth ?? 0) + 5)
    this._scene.tweens.add({
      targets: t,
      y: y - 16,
      alpha: { from: 1, to: 0 },
      duration: 1100,
      ease: 'Quad.easeOut',
      onComplete: () => { try { t.destroy() } catch {} },
    })
  }

  // Convenience accessor — `this.cache` doesn't exist on UI components,
  // we have to reach through the scene.
  get cache() { return this._scene?.cache }

  _captionText() {
    return this._bossClass
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
      this._hpBar.update(boss.hp ?? 0, boss.maxHp ?? 100, `${Math.round(boss.hp ?? 0)} / ${Math.round(boss.maxHp ?? 0)}`)
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
    // Treasury redesign — gold has its own animated readout (tier pile,
    // tick-up, ±floaters, wealth glow). Cheap to call every tick because
    // it short-circuits when gold is unchanged.
    this._updateGold()
    const deathsLeft = this._gameState.boss?.deathsRemaining ?? 3
    if (this._hearts) {
      if (this._prevLives !== undefined && deathsLeft < this._prevLives) {
        const spr = this._hearts[deathsLeft]
        if (spr && !spr._animating) {
          spr._animating = true
          spr.play('heart-lose')
          spr.once('animationcomplete', () => {
            spr.setTexture('heart-empty')
            spr._animating = false
          })
        }
      }
      this._prevLives = deathsLeft
    }
    if (this._xpBar) {
      const xp    = this._gameState.boss?.xp ?? 0
      const xpMax = this._gameState.boss?.xpToNext ?? 100
      this._xpBar.update(xp, Math.max(1, xpMax), `${xp} / ${xpMax} XP`)
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
    this._xpBar = null
  }
}

export const BOSS_TOP_BAR_HEIGHT = BAR_H

// SUPERSEDED (Phase 34) — replaced by `src/hud/BossFightOverlay.js`
// (DOM) under the new HUD. Phaser fallback under `?newhud=0`. Kept
// per CLAUDE.md.
//
// Boss-fight cinematic overlay, lives on HudScene so it can use the
// scene's uiW / uiH (set by applyUiCamera). Renders three pieces:
//
//   1. Intro slate — full-screen card on BOSS_FIGHT_INCOMING. Boss
//      portrait, name (serif), tagline, red diamond ornament. Fades
//      in over 0.4 s, holds 1.0 s, fades out 0.4 s. The boss-room
//      action stays visible behind the slate's translucent backdrop.
//
//   2. Bottom HP bar — wide, glowing bar across the lower play area
//      with the boss name and a tier ornament. Persists for the
//      duration of the fight, ticks each frame against gameState.boss
//      hp, shakes when HP drops, flashes white on a heavy hit.
//
//   3. Result slate — small banner on BOSS_FIGHT_RESOLVED ("Intruder
//      Repelled" / "You Lost a Life"), ~2 s, then everything fades.

import { EventBus }           from '../systems/EventBus.js'
import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel, pixelDiamond } from './UIKit.js'

const SLATE_DEPTH       = 95
const BAR_DEPTH         = 92
const RESULT_DEPTH      = 96
const VIGNETTE_DEPTH    = 88                 // below the slate / bar / result, above the world
const SLATE_FADE_IN_MS  = 400
const SLATE_HOLD_MS     = 1000
const SLATE_FADE_OUT_MS = 400
const BAR_HEIGHT        = 32
const BAR_WIDTH         = 460    // fixed width, centered horizontally in the play area
const BAR_BOTTOM_Y      = 110    // distance above bottom of canvas (above ActionBar)

export class BossFightOverlay {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._slateObjs   = []
    this._barObjs     = []
    this._resultObjs  = []
    this._barActive   = false
    this._barShakeUntil  = 0
    this._barFlashUntil  = 0
    this._lastBossHp     = null

    this._onIncoming = this._onIncoming.bind(this)
    this._onResolved = this._onResolved.bind(this)
    EventBus.on('BOSS_FIGHT_INCOMING', this._onIncoming)
    EventBus.on('BOSS_FIGHT_RESOLVED', this._onResolved)
  }

  destroy() {
    EventBus.off('BOSS_FIGHT_INCOMING', this._onIncoming)
    EventBus.off('BOSS_FIGHT_RESOLVED', this._onResolved)
    this._destroySlate()
    this._destroyBar()
    this._destroyResult()
    this._destroyVignette()
  }

  // Per-frame from HudScene.update(). Cheap reads.
  update() {
    if (!this._barActive) return
    const boss = this._gameState.boss
    if (!boss) return

    // HP bar fill
    const cur = Math.max(0, boss.hp ?? 0)
    const max = Math.max(1, boss.maxHp ?? 1)
    const frac = cur / max
    if (this._barFill) {
      const innerW = this._barInnerW * frac
      this._barFill.clear()
      const fillColor = frac <= 0.25 ? 0xff5544 : frac <= 0.5 ? CRYPT.accent2 : CRYPT.accent
      this._barFill.fillStyle(fillColor, 1)
      this._barFill.fillRect(this._barFillX, this._barFillY, Math.max(0, innerW), this._barFillH)
    }
    if (this._barText) {
      this._barText.setText(`${cur}  /  ${max}`)
    }

    // Detect HP drops since last tick and flash + shake the bar.
    if (this._lastBossHp != null && cur < this._lastBossHp) {
      const damage = this._lastBossHp - cur
      const big = damage >= Math.max(8, max * 0.08)
      this._barShakeUntil = this._scene.time.now + (big ? 240 : 140)
      if (big) this._barFlashUntil = this._scene.time.now + 180
    }
    this._lastBossHp = cur

    // Apply shake / flash to the bar container.
    const now = this._scene.time.now
    if (this._barContainer) {
      const shaking = now < this._barShakeUntil
      const dx = shaking ? (Math.random() - 0.5) * 6 : 0
      const dy = shaking ? (Math.random() - 0.5) * 4 : 0
      this._barContainer.x = this._barAnchorX + dx
      this._barContainer.y = this._barAnchorY + dy
    }
    if (this._barFlashOverlay) {
      const flashing = now < this._barFlashUntil
      this._barFlashOverlay.setAlpha(flashing
        ? 0.55 * (1 - (this._barFlashUntil - now) / 180)
        : 0)
    }
  }

  // ── Intro slate ─────────────────────────────────────────────────────────

  _onIncoming() {
    this._destroyResult()
    this._buildVignette()
    this._buildIntroSlate()
    this._buildBar()
    this._lastBossHp = this._gameState.boss?.hp ?? null
    this._barActive = true
  }

  // Vignette wash — a four-strip darkening frame around the play area
  // that persists for the whole fight and fades in/out cleanly. Reads
  // as "the world dims around the boss room", focusing attention on
  // the action without obscuring the centre. Fades out on resolved.
  _buildVignette() {
    this._destroyVignette()
    const W = this._scene.uiW ?? 1280
    const H = this._scene.uiH ?? 720
    // Four trapezoid-ish edge strips. Edges at ~35 % alpha, fading to
    // 0 toward the centre via a stacked-rect approximation. Cheaper
    // than a true radial gradient (which Phaser doesn't have built in)
    // and reads as a vignette at a glance.
    const layers = [
      { alpha: 0.30, inset: 0   },
      { alpha: 0.22, inset: 60  },
      { alpha: 0.14, inset: 120 },
      { alpha: 0.07, inset: 200 },
    ]
    this._vignetteObjs = []
    for (const L of layers) {
      const top    = this._scene.add.rectangle(0, 0, W, L.inset || 1, 0x000000, L.alpha)
        .setOrigin(0).setDepth(VIGNETTE_DEPTH).setAlpha(0)
      const bottom = this._scene.add.rectangle(0, H - (L.inset || 1), W, L.inset || 1, 0x000000, L.alpha)
        .setOrigin(0).setDepth(VIGNETTE_DEPTH).setAlpha(0)
      const left   = this._scene.add.rectangle(0, 0, L.inset || 1, H, 0x000000, L.alpha)
        .setOrigin(0).setDepth(VIGNETTE_DEPTH).setAlpha(0)
      const right  = this._scene.add.rectangle(W - (L.inset || 1), 0, L.inset || 1, H, 0x000000, L.alpha)
        .setOrigin(0).setDepth(VIGNETTE_DEPTH).setAlpha(0)
      this._vignetteObjs.push(top, bottom, left, right)
    }
    this._scene.tweens.add({
      targets: this._vignetteObjs, alpha: 1, duration: 350, ease: 'Sine.easeOut',
    })
  }

  _destroyVignette() {
    for (const o of this._vignetteObjs ?? []) o.destroy?.()
    this._vignetteObjs = []
  }

  _buildIntroSlate() {
    this._destroySlate()
    const W = this._scene.uiW ?? 1280
    const H = this._scene.uiH ?? 720
    const arch = this._archetypeDef()
    const name    = arch?.name ?? 'BOSS'
    const tagline = arch?.tagline ?? arch?.description ?? '— ancient threat —'

    // Translucent backdrop — keeps the action visible behind.
    const wash = this._scene.add.rectangle(0, 0, W, H, 0x000000, 0.55)
      .setOrigin(0).setDepth(SLATE_DEPTH).setAlpha(0)
    this._slateObjs.push(wash)

    // Centred card frame — wider than tier-2 sizing so long names like
    // "VAMPIRE SOVEREIGN" / "BEHOLDER TYRANT" fit on a single line.
    const cardW = 520, cardH = 168
    const cardX = Math.round((W - cardW) / 2)
    const cardY = Math.round((H - cardH) / 2 - 40)
    const frame = this._scene.add.graphics().setDepth(SLATE_DEPTH + 1).setAlpha(0)
    pixelPanel(frame, cardX, cardY, cardW, cardH, {
      fill: 0x0c0712, edgeH: CRYPT.accent2, edgeS: 0x4a0c14,
    })
    this._slateObjs.push(frame)

    // Diamond ornament + "BOSS FIGHT" tag
    const tag = this._scene.add.text(cardX + cardW / 2, cardY + 18,
      '◆  B O S S   F I G H T  ◆', {
      fontFamily: FONT_HEAD, fontSize: '9px', color: CRYPT.accent2Css, letterSpacing: 4,
    }).setOrigin(0.5).setDepth(SLATE_DEPTH + 2).setAlpha(0)
    this._slateObjs.push(tag)

    // Boss portrait — first frame of the idle sheet. Sits in the left
    // gutter; text is then centered to the FULL card width below, so
    // the title/tagline reads as the primary element rather than being
    // shoved off-centre by the portrait. Scale dropped slightly (1.9 →
    // 1.6) to widen the safe text zone.
    const skin = this._gameState.player?.bossArchetypeId
    const portraitKey = skin && this._scene.textures.exists(`${skin}-idle`) ? `${skin}-idle` : null
    const PORTRAIT_SCALE   = 1.6
    const PORTRAIT_FRAME   = 64
    const PORTRAIT_W       = portraitKey ? PORTRAIT_FRAME * PORTRAIT_SCALE : 0
    const PORTRAIT_PAD     = 14   // left/right inset
    if (portraitKey) {
      const portrait = this._scene.add.sprite(
        cardX + PORTRAIT_PAD + PORTRAIT_W / 2,
        cardY + cardH / 2 + 6,
        portraitKey, 0,
      ).setOrigin(0.5).setScale(PORTRAIT_SCALE).setDepth(SLATE_DEPTH + 2).setAlpha(0)
      this._slateObjs.push(portrait)
    }

    // Name + tagline — centered to the card box (origin 0.5). Auto-
    // shrink keeps long names from running into the portrait on the
    // left or the right edge: textW = the *symmetric* gap from card-
    // centre to whichever side has less room (the portrait side, since
    // the right side is just a small padding).
    const cardCx        = cardX + cardW / 2
    const portraitRight = portraitKey ? (cardX + PORTRAIT_PAD + PORTRAIT_W) : (cardX + 8)
    const safeHalfW     = Math.min(cardCx - portraitRight - 8, cardW / 2 - 8)
    const textW         = safeHalfW * 2

    const titleT = this._scene.add.text(cardCx, cardY + cardH / 2 - 6, name.toUpperCase(), {
      fontFamily: FONT_HEAD, fontSize: '18px', color: '#fff5cc', letterSpacing: 2,
      stroke: '#3a0810', strokeThickness: 3,
    }).setOrigin(0.5, 0.5).setDepth(SLATE_DEPTH + 2).setAlpha(0)
    if (titleT.width > textW) {
      const scale = Math.max(0.65, textW / titleT.width)
      titleT.setFontSize(Math.floor(18 * scale))
    }
    this._slateObjs.push(titleT)

    const tagT = this._scene.add.text(cardCx, cardY + cardH / 2 + 22, tagline, {
      fontFamily: FONT_BODY, fontSize: '10px', color: CRYPT.inkDim, letterSpacing: 1,
      fontStyle: 'italic', align: 'center', wordWrap: { width: textW },
    }).setOrigin(0.5, 0.5).setDepth(SLATE_DEPTH + 2).setAlpha(0)
    this._slateObjs.push(tagT)

    // Lives remaining (small, below)
    const lives = this._gameState.boss?.deathsRemaining ?? '?'
    const livesT = this._scene.add.text(cardX + cardW / 2, cardY + cardH - 16,
      `LIVES REMAINING — ${lives}`, {
      fontFamily: FONT_HEAD, fontSize: '8px', color: CRYPT.inkMute, letterSpacing: 3,
    }).setOrigin(0.5).setDepth(SLATE_DEPTH + 2).setAlpha(0)
    this._slateObjs.push(livesT)

    // Fade-in → hold → fade-out timeline
    const fadeIn = this._scene.tweens.add({
      targets: this._slateObjs, alpha: 1, duration: SLATE_FADE_IN_MS,
    })
    this._slateFadeOut = this._scene.time.delayedCall(SLATE_FADE_IN_MS + SLATE_HOLD_MS, () => {
      this._scene.tweens.add({
        targets: this._slateObjs, alpha: 0, duration: SLATE_FADE_OUT_MS,
        onComplete: () => this._destroySlate(),
      })
    })
  }

  _destroySlate() {
    if (this._slateFadeOut) { this._slateFadeOut.remove?.(false); this._slateFadeOut = null }
    for (const o of this._slateObjs) o.destroy?.()
    this._slateObjs = []
  }

  // ── Bottom HP bar ───────────────────────────────────────────────────────

  _buildBar() {
    this._destroyBar()
    const W = this._scene.uiW ?? 1280
    const H = this._scene.uiH ?? 720
    const arch = this._archetypeDef()
    const name = arch?.name ?? 'BOSS'

    const barW = BAR_WIDTH
    const barX = Math.round((W - barW) / 2)
    const barY = H - BAR_BOTTOM_Y - BAR_HEIGHT

    // We anchor the whole bar on a container so the per-frame shake math
    // stays simple — move the container's x/y by a small jitter.
    this._barAnchorX = 0
    this._barAnchorY = 0
    const container = this._scene.add.container(0, 0).setDepth(BAR_DEPTH)
    this._barContainer = container
    this._barObjs.push(container)

    // Frame
    const frame = this._scene.add.graphics()
    pixelPanel(frame, barX, barY, barW, BAR_HEIGHT, {
      fill: 0x0c0712, edgeH: CRYPT.accent2, edgeS: 0x4a0c14,
    })
    container.add(frame)

    // Boss name floats centered ABOVE the bar so longer names (Serpent
    // Captain, Beholder Tyrant, etc.) aren't squeezed into the side gutter.
    // Diamond ornaments flank the name on either side.
    const nameY = barY - 10
    const nameT = this._scene.add.text(barX + barW / 2, nameY,
      name.toUpperCase(), {
      fontFamily: FONT_HEAD, fontSize: '11px', color: '#fff5cc', letterSpacing: 3,
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5, 1)
    container.add(nameT)

    const dia = this._scene.add.graphics()
    const halfTextW = nameT.width / 2
    pixelDiamond(dia, barX + barW / 2 - halfTextW - 12, nameY - 6, 3, CRYPT.accent2)
    pixelDiamond(dia, barX + barW / 2 + halfTextW + 12, nameY - 6, 3, CRYPT.accent2)
    container.add(dia)

    // HP bar takes the full bar width now (less a small inset).
    const trackX = barX + 8
    const trackY = barY + 8
    const trackW = barW - 16
    const trackH = BAR_HEIGHT - 16
    this._barFillX = trackX + 2
    this._barFillY = trackY + 2
    this._barInnerW = trackW - 4
    this._barFillH = trackH - 4

    const track = this._scene.add.graphics()
    track.fillStyle(0x1a0e14, 1)
    track.fillRect(trackX, trackY, trackW, trackH)
    track.lineStyle(1, 0x4a0c14, 1)
    track.strokeRect(trackX, trackY, trackW, trackH)
    container.add(track)

    this._barFill = this._scene.add.graphics()
    container.add(this._barFill)

    // HP numeric — white, centered over the bar
    this._barText = this._scene.add.text(trackX + trackW / 2, trackY + trackH / 2,
      `${this._gameState.boss?.hp ?? 0}  /  ${this._gameState.boss?.maxHp ?? 0}`, {
      fontFamily: FONT_HEAD, fontSize: '9px', color: '#ffffff', letterSpacing: 1,
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5)
    container.add(this._barText)

    // White flash overlay — alpha tweened to 0 normally, briefly pulsed up
    // by update() when the boss takes a heavy hit.
    this._barFlashOverlay = this._scene.add.rectangle(barX, barY, barW, BAR_HEIGHT, 0xffffff, 0)
      .setOrigin(0)
    container.add(this._barFlashOverlay)

    // Bar fades in over 250 ms.
    container.alpha = 0
    this._scene.tweens.add({ targets: container, alpha: 1, duration: 250 })
  }

  _destroyBar() {
    this._barActive = false
    this._barFill = null
    this._barText = null
    this._barFlashOverlay = null
    this._barContainer = null
    for (const o of this._barObjs) o.destroy?.()
    this._barObjs = []
  }

  // ── Result slate ────────────────────────────────────────────────────────

  _onResolved({ winner, deathsRemaining }) {
    // Fade the bar + vignette out alongside the result slate.
    if (this._barContainer) {
      const c = this._barContainer
      this._scene.tweens.add({
        targets: c, alpha: 0, duration: 350, onComplete: () => this._destroyBar(),
      })
    }
    if (this._vignetteObjs?.length) {
      this._scene.tweens.add({
        targets: this._vignetteObjs, alpha: 0, duration: 500,
        onComplete: () => this._destroyVignette(),
      })
    }
    this._buildResultSlate(winner, deathsRemaining)
  }

  _buildResultSlate(winner, deathsRemaining) {
    this._destroyResult()
    const W = this._scene.uiW ?? 1280
    const H = this._scene.uiH ?? 720
    const isPartyWin = winner === 'party'

    const wash = this._scene.add.rectangle(0, 0, W, H, 0x000000, 0.45)
      .setOrigin(0).setDepth(RESULT_DEPTH).setAlpha(0)
    this._resultObjs.push(wash)

    const cardW = 360, cardH = 96
    const cardX = Math.round((W - cardW) / 2)
    const cardY = Math.round((H - cardH) / 2)
    const frame = this._scene.add.graphics().setDepth(RESULT_DEPTH + 1).setAlpha(0)
    pixelPanel(frame, cardX, cardY, cardW, cardH, {
      fill: isPartyWin ? 0x1a0606 : 0x06140a,
      edgeH: isPartyWin ? CRYPT.accent2 : 0x33dd66,
      edgeS: isPartyWin ? 0x4a0c14 : 0x114422,
    })
    this._resultObjs.push(frame)

    const titleT = this._scene.add.text(cardX + cardW / 2, cardY + cardH / 2 - 10,
      isPartyWin ? 'YOU LOST A LIFE' : 'INTRUDER REPELLED', {
      fontFamily: FONT_HEAD, fontSize: '15px',
      color: isPartyWin ? '#ff7777' : '#88ffaa',
      letterSpacing: 2,
      stroke: isPartyWin ? '#440000' : '#003311', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(RESULT_DEPTH + 2).setAlpha(0)
    this._resultObjs.push(titleT)

    const subText = isPartyWin
      ? `Lives remaining: ${deathsRemaining ?? '?'}`
      : `The dungeon endures.`
    const subT = this._scene.add.text(cardX + cardW / 2, cardY + cardH / 2 + 14, subText, {
      fontFamily: FONT_BODY, fontSize: '10px',
      color: isPartyWin ? '#ffcccc' : '#cceedd', letterSpacing: 1,
    }).setOrigin(0.5).setDepth(RESULT_DEPTH + 2).setAlpha(0)
    this._resultObjs.push(subT)

    this._scene.tweens.add({ targets: this._resultObjs, alpha: 1, duration: 250 })
    this._resultFadeOut = this._scene.time.delayedCall(1800, () => {
      this._scene.tweens.add({
        targets: this._resultObjs, alpha: 0, duration: 600,
        onComplete: () => this._destroyResult(),
      })
    })
  }

  _destroyResult() {
    if (this._resultFadeOut) { this._resultFadeOut.remove?.(false); this._resultFadeOut = null }
    for (const o of this._resultObjs) o.destroy?.()
    this._resultObjs = []
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  _archetypeDef() {
    const archs = this._scene.cache.json.get('bossArchetypes') ?? []
    return archs.find(a => a.id === this._gameState.player?.bossArchetypeId)
  }
}

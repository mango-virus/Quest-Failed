// SUPERSEDED (Phase 34) — replaced by `src/hud/EventBanner.js` (DOM)
// under the new HUD. Phaser fallback under `?newhud=0`. Kept per
// CLAUDE.md.
//
// EventBanner — top-of-screen themed slate that announces a Dungeon Event
// during the night phase. Mirrors BossFightOverlay's intro/result-slate
// styling (pixelPanel frame + stroked title + subtitle, fade in/out) but
// anchored to the top of the play area instead of the centre, since the
// event is a "heads up — prepare" moment, not a cinematic interrupt.
//
// Per-event color theme is keyed off `def.colorTheme` in events.json:
//   warn   — orange/amber (defensive heads-up)
//   accent — red          (hostile / boss-fight-tier event)
//   soul   — cyan         (knowledge / neutral oddity)
//   gold   — yellow       (positive / loot / decision)
//   green  — green        (disease / nature / sickness)
//
// Lives in HudScene so it shares uiW/uiH and renders above the world but
// below modal popups.

import { CRYPT, FONT_HEAD, FONT_BODY, pixelPanel } from './UIKit.js'
import { EventBus } from '../systems/EventBus.js'

const BANNER_DEPTH    = 95
const FADE_IN_MS      = 350
const HOLD_MS         = 7500   // banner stays fully visible for this long before fading
const FADE_OUT_MS     = 600
const CARD_W          = 540
const CARD_H          = 96
const TOP_OFFSET      = 64    // sit just below BossTopBar (BOSS_TOP_BAR_HEIGHT ≈ 56 + 6 pad)

// Per-theme palette: { fill, edgeH, edgeS, titleColor, titleStroke, subColor }.
// Edge colors are drawn by pixelPanel — top/left = highlight (edgeH),
// bottom/right = shadow (edgeS).
const THEMES = {
  warn: {
    fill:        0x2a1a06,
    edgeH:       0xd8893a,
    edgeS:       0x3a2008,
    titleColor:  '#ffcc66',
    titleStroke: '#3a2008',
    subColor:    '#e8d8a8',
  },
  accent: {
    fill:        0x1a0606,
    edgeH:       0xd24858,
    edgeS:       0x4a0c14,
    titleColor:  '#ff7777',
    titleStroke: '#440000',
    subColor:    '#ffcccc',
  },
  soul: {
    fill:        0x06141a,
    edgeH:       0x6fd8d8,
    edgeS:       0x0a2a32,
    titleColor:  '#9beaea',
    titleStroke: '#062a32',
    subColor:    '#cfeeee',
  },
  gold: {
    fill:        0x261a06,
    edgeH:       0xe8c34a,
    edgeS:       0x3a2c08,
    titleColor:  '#ffe488',
    titleStroke: '#3a2c08',
    subColor:    '#f0e0b0',
  },
  green: {
    fill:        0x06140a,
    edgeH:       0x33dd66,
    edgeS:       0x114422,
    titleColor:  '#88ffaa',
    titleStroke: '#003311',
    subColor:    '#cceedd',
  },
}

export class EventBanner {
  constructor(scene) {
    this._scene = scene
    this._objs  = []
    this._fadeOutTimer = null

    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('DUNGEON_EVENT_ANNOUNCED', this._onAnnounced)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    this._teardown()
  }

  _onAnnounced({ def }) {
    if (!def) return
    this._teardown()  // an active banner gets bumped by a fresh announcement

    const theme = THEMES[def.colorTheme] ?? THEMES.warn
    const W     = this._scene.uiW ?? 1280
    const cardX = Math.round((W - CARD_W) / 2)
    const cardY = TOP_OFFSET

    const frame = this._scene.add.graphics().setDepth(BANNER_DEPTH).setAlpha(0)
    pixelPanel(frame, cardX, cardY, CARD_W, CARD_H, {
      fill:  theme.fill,
      edgeH: theme.edgeH,
      edgeS: theme.edgeS,
    })
    this._objs.push(frame)

    const titleT = this._scene.add.text(cardX + CARD_W / 2, cardY + 26, def.title ?? '', {
      fontFamily: FONT_HEAD, fontSize: '15px',
      color: theme.titleColor, letterSpacing: 2,
      stroke: theme.titleStroke, strokeThickness: 3,
    }).setOrigin(0.5).setDepth(BANNER_DEPTH + 1).setAlpha(0)
    this._objs.push(titleT)

    const subT = this._scene.add.text(cardX + CARD_W / 2, cardY + 60, def.notif ?? '', {
      fontFamily: FONT_BODY, fontSize: '10px',
      color: theme.subColor, letterSpacing: 1,
      align: 'center',
      wordWrap: { width: CARD_W - 32, useAdvancedWrap: true },
    }).setOrigin(0.5).setDepth(BANNER_DEPTH + 1).setAlpha(0)
    this._objs.push(subT)

    this._scene.tweens.add({ targets: this._objs, alpha: 1, duration: FADE_IN_MS })
    this._fadeOutTimer = this._scene.time.delayedCall(FADE_IN_MS + HOLD_MS, () => {
      this._scene.tweens.add({
        targets: this._objs, alpha: 0, duration: FADE_OUT_MS,
        onComplete: () => this._teardown(),
      })
    })
  }

  _teardown() {
    if (this._fadeOutTimer) { this._fadeOutTimer.remove?.(false); this._fadeOutTimer = null }
    for (const o of this._objs) o.destroy?.()
    this._objs = []
  }
}

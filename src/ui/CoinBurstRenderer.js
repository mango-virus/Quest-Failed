// Spawns a small coin-burst + floating "+Xg" label whenever a kill (or
// other in-world payout) emits RESOURCES_AWARDED with a worldX/worldY
// position. Each burst:
//   - 5–8 mini coin sprites flick outward in random directions, fall
//     under fake gravity, fade out
//   - A "+Xg" gold-color text label rises and fades from the same point
//
// Listens on EventBus, owns its own particles. Updated/cleaned per-tween.

import { EventBus } from '../systems/EventBus.js'
import { CRYPT, FONT_HEAD } from './UIKit.js'
import { AbilityVfx } from './AbilityVfx.js'

const COIN_COUNT_MIN = 5
const COIN_COUNT_MAX = 9
const COIN_LIFE_MS   = 700
const COIN_RADIUS    = 2

// Zul'Gath companion bonus — her hoarder gremlin flair amplifies every
// gold pickup. Coin count scales, label gets a touch larger, and a
// brief gold ring pulses out from the pickup point.
const ZULGATH_COIN_MULT      = 1.8
const ZULGATH_LABEL_SIZE     = '13px'   // default label is 11px
const ZULGATH_RING_COLOR_HEX = 0xffc83a

// Phase 34C.5 — particles quality. Coin burst count scales by this;
// label stays so the player always sees the +Ng readout.
function _particlesMult() {
  try {
    const lvl = localStorage.getItem('qf.video.particles') ?? 'high'
    if (lvl === 'off')  return 0
    if (lvl === 'low')  return 0.4
    if (lvl === 'med')  return 0.7
    return 1.0
  } catch { return 1.0 }
}

export class CoinBurstRenderer {
  constructor(scene, gameState = null) {
    this._scene     = scene
    this._gameState = gameState   // optional — used only for companion flavour
    this._items     = []          // graphics objects pending destroy

    this._onAward = this._onAward.bind(this)
    EventBus.on('RESOURCES_AWARDED', this._onAward)
    // Plunderers (KR) — a thief pockets your gold: a steal burst + "−Xg" at it.
    this._onPlunderDrain = this._onPlunderDrain.bind(this)
    EventBus.on('PLUNDER_DRAIN_VFX', this._onPlunderDrain)
  }

  _isZulgath() {
    return this._gameState?.meta?.companionId === 'zulgath'
  }

  destroy() {
    EventBus.off('RESOURCES_AWARDED', this._onAward)
    EventBus.off('PLUNDER_DRAIN_VFX', this._onPlunderDrain)
    for (const o of this._items) o?.destroy?.()
    this._items = []
  }

  // A Plunderer pockets some of your gold — a few coins flit up off the thief +
  // a red-gold "−Xg" label (the inverse of the +Xg award burst).
  _onPlunderDrain({ x, y, gold } = {}) {
    if (x == null || y == null || !(gold > 0)) return
    const t = this._scene.add.text(x, y - 18, `−${gold}g`, {
      fontFamily: FONT_HEAD, fontSize: '11px', color: '#ffae4a',
      letterSpacing: 1, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(60)
    this._items.push(t)
    this._scene.tweens.add({
      targets: t, y: y - 46, alpha: { from: 1, to: 0 }, duration: 850, ease: 'Sine.easeOut',
      onComplete: () => { const i = this._items.indexOf(t); if (i >= 0) this._items.splice(i, 1); t.destroy() },
    })
    const mult = _particlesMult()
    if (mult <= 0) return
    const count = Math.max(1, Math.round(3 * mult))
    for (let i = 0; i < count; i++) this._spawnCoin(x, y, i, count)
  }

  _onAward(payload) {
    const gold = payload?.gold ?? 0
    if (gold <= 0) return
    // Only spawn the world burst when we have a position. Off-screen
    // payouts (Blood Money passive, etc.) just skip the VFX silently.
    const wx = payload.worldX, wy = payload.worldY
    if (wx == null || wy == null) return

    this._spawnLabel(wx, wy, gold)
    // Random base count [MIN..MAX], then scale by particles setting.
    // Label always fires above; only the coin sprites scale down.
    let rawCount = COIN_COUNT_MIN + Math.floor(Math.random() * (COIN_COUNT_MAX - COIN_COUNT_MIN + 1))
    if (this._isZulgath()) rawCount = Math.round(rawCount * ZULGATH_COIN_MULT)
    const mult = _particlesMult()
    const count = mult <= 0 ? 0 : Math.max(1, Math.round(rawCount * mult))
    for (let i = 0; i < count; i++) this._spawnCoin(wx, wy, i, count)
    // Zul'Gath only: gold pulse ring at the pickup point so her hoard
    // pings really pop. Skipped at particles=off (pulseRing internally
    // ignores quality but we don't want to add even one draw at off).
    if (this._isZulgath() && mult > 0) {
      AbilityVfx.pulseRing(this._scene, wx, wy, {
        color:      ZULGATH_RING_COLOR_HEX,
        fromR:      6,
        toR:        28,
        alpha:      0.85,
        durationMs: 360,
        depth:      59,
      })
    }
  }

  // Floating "+Xg" label — gold color, drifts up and fades
  _spawnLabel(wx, wy, gold) {
    const fontSize = this._isZulgath() ? ZULGATH_LABEL_SIZE : '11px'
    const t = this._scene.add.text(wx, wy - 16, `+${gold}g`, {
      fontFamily: FONT_HEAD, fontSize, color: CRYPT.goldCss,
      letterSpacing: 1, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(60)
    this._items.push(t)
    this._scene.tweens.add({
      targets:  t,
      y:        wy - 44,
      alpha:    { from: 1, to: 0 },
      duration: 900,
      ease:     'Sine.easeOut',
      onComplete: () => {
        const i = this._items.indexOf(t); if (i >= 0) this._items.splice(i, 1)
        t.destroy()
      },
    })
  }

  // One coin: small gold disc that flies outward + falls + fades. Uses the
  // existing item-coin texture if loaded; otherwise falls back to a graphics
  // primitive so the burst still renders even if the asset's missing.
  _spawnCoin(wx, wy, idx, total) {
    const ang  = (idx / total) * Math.PI * 2 + Math.random() * 0.4
    const dist = 22 + Math.random() * 18
    const tx   = wx + Math.cos(ang) * dist
    const ty   = wy + Math.sin(ang) * dist + 8 // bias slightly downward — fake gravity
    let obj
    // Reuse the loaded single-coin sprite (ui-coin); fall back to the legacy
    // item-coin key, then a drawn disc if neither asset is present.
    const coinKey = this._scene.textures.exists('ui-coin') ? 'ui-coin'
      : (this._scene.textures.exists('item-coin') ? 'item-coin' : null)
    if (coinKey) {
      obj = this._scene.add.image(wx, wy, coinKey).setDepth(58)
      obj.setScale(0.5)
      obj.texture?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
    } else {
      obj = this._scene.add.graphics().setDepth(58)
      obj.fillStyle(CRYPT.gold, 1)
      obj.fillCircle(0, 0, COIN_RADIUS)
      obj.fillStyle(0x000000, 1)
      obj.fillRect(-1, -COIN_RADIUS + 1, 2, 1) // tiny edge highlight
      obj.x = wx; obj.y = wy
    }
    this._items.push(obj)
    this._scene.tweens.add({
      targets:  obj,
      x:        tx,
      y:        ty + 24,    // drop after the lateral fling
      alpha:    { from: 1, to: 0 },
      scaleX:   0.35,
      scaleY:   0.35,
      angle:    (Math.random() - 0.5) * 360,
      duration: COIN_LIFE_MS + Math.random() * 200,
      ease:     'Quad.easeIn',
      onComplete: () => {
        const i = this._items.indexOf(obj); if (i >= 0) this._items.splice(i, 1)
        obj.destroy()
      },
    })
  }
}

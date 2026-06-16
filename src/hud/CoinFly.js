// CoinFly — coins fly from a kill/payout up to the treasury counter, which
// counts up + "ka-chings" in sync as each coin lands.
//
// On RESOURCES_AWARDED with a WORLD position, project the point into #hud-stage
// logical coords (same space the floating combat numbers use), spawn a few
// symbolic DOM coins there, POP them outward, then HOME them to the treasury
// coin icon. The in-world kill-point pop stays on the canvas (CoinBurstRenderer);
// these DOM coins are the ones that travel and drive the count.
//
// Coordination with TopBar:
//   - at burst start → emit TREASURY_COINS_INCOMING { amount } so TopBar holds
//     that gold (delivered by coins, not auto-counted)
//   - per coin landing → emit TREASURY_COIN_ARRIVED { amount } so TopBar bumps
//     the shown total + plays a coin tick
// Non-positional awards (passives, bribes — no worldX/Y) are skipped here; TopBar
// just counts them up normally.

import { EventBus } from '../systems/EventBus.js'

const MAX_COINS_PER_BURST = 10
const GOLD_PER_COIN       = 6      // ~1 coin per 6g, capped — coins are symbolic
const MAX_ACTIVE          = 48     // hard cap on concurrent flyers (perf)
const POOL_CAP            = 64
const POP_MS              = 170    // outward scatter before homing
const HOME_MS_MIN         = 360
const HOME_MS_MAX         = 560
const STAGGER_MS          = 38     // gap between successive coins in a burst

export class CoinFly {
  constructor(gameState) {
    this._gameState = gameState
    this._stage = document.getElementById('hud-stage')
    this._layer = null
    this._pool  = []
    this._active = 0
    if (this._stage) {
      this._layer = document.createElement('div')
      this._layer.className = 'qf-coinfly-layer'
      Object.assign(this._layer.style, {
        position: 'absolute', inset: '0',
        pointerEvents: 'none', overflow: 'visible',
        zIndex: '40',   // above the dungeon + most chrome so coins reach the counter
      })
      this._stage.appendChild(this._layer)
    }
    this._onAward = this._onAward.bind(this)
    EventBus.on('RESOURCES_AWARDED', this._onAward)
  }

  destroy() {
    EventBus.off('RESOURCES_AWARDED', this._onAward)
    this._layer?.remove()
    this._layer = null
    this._pool = []
    this._active = 0
  }

  _onAward(p) {
    const gold = p?.gold ?? 0
    if (gold <= 0 || !this._layer) return
    const wx = p.worldX, wy = p.worldY
    if (wx == null || wy == null) return            // non-positional → TopBar counts it
    const origin = this._worldToStage(wx, wy)
    const target = this._treasuryTarget()
    if (!origin || !target) return

    // This gold is delivered by coins — tell TopBar to hold it (no auto-count).
    EventBus.emit('TREASURY_COINS_INCOMING', { amount: gold })

    let n = Math.max(1, Math.min(MAX_COINS_PER_BURST, Math.round(gold / GOLD_PER_COIN)))
    if (this._active + n > MAX_ACTIVE) n = Math.max(1, MAX_ACTIVE - this._active)
    const shares = this._splitShares(gold, n)
    for (let i = 0; i < n; i++) this._spawnCoin(origin, target, shares[i], i)
  }

  // Split `total` gold into `n` integer shares that sum exactly to total.
  _splitShares(total, n) {
    const base = Math.floor(total / n)
    let rem = total - base * n
    const out = []
    for (let i = 0; i < n; i++) { out.push(base + (rem > 0 ? 1 : 0)); if (rem > 0) rem-- }
    return out
  }

  _spawnCoin(origin, target, share, i) {
    const el = this._pool.pop() || this._makeCoinEl()
    if (!el) { EventBus.emit('TREASURY_COIN_ARRIVED', { amount: share }); return }
    this._active++
    el.style.left = `${origin.x}px`
    el.style.top  = `${origin.y}px`
    el.style.display = ''
    el.style.opacity = '1'

    const ang = Math.random() * Math.PI * 2
    const popDist = 16 + Math.random() * 22
    const px = Math.cos(ang) * popDist
    const py = Math.sin(ang) * popDist - 6           // slight upward bias on the pop
    const dx = target.x - origin.x
    const dy = target.y - origin.y
    const homeMs = HOME_MS_MIN + Math.random() * (HOME_MS_MAX - HOME_MS_MIN)
    const total = POP_MS + homeMs
    const popOff = POP_MS / total

    let anim = null
    try {
      anim = el.animate([
        { transform: 'translate(-50%,-50%) translate(0px,0px) scale(1)',                 opacity: 1,   offset: 0 },
        { transform: `translate(-50%,-50%) translate(${px}px,${py}px) scale(1.18)`,        opacity: 1,   offset: popOff },
        { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(0.42)`,        opacity: 0.9, offset: 1 },
      ], { duration: total, delay: i * STAGGER_MS, easing: 'cubic-bezier(0.42,0,0.45,1)' })
    } catch (e) { anim = null }

    const land = () => {
      this._active = Math.max(0, this._active - 1)
      el.style.display = 'none'
      if (this._pool.length < POOL_CAP) this._pool.push(el)
      else el.remove()
      EventBus.emit('TREASURY_COIN_ARRIVED', { amount: share })
    }
    if (anim) { anim.onfinish = land; anim.oncancel = land }
    else { land() }   // WAAPI unavailable → credit immediately so the count never stalls
  }

  _makeCoinEl() {
    if (!this._layer) return null
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'absolute', width: '20px', height: '20px',
      backgroundImage: "url('assets/ui/coin.png')",
      backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
      imageRendering: 'pixelated', willChange: 'transform, opacity',
      filter: 'drop-shadow(0 0 5px rgba(255,203,92,0.6))',
      transform: 'translate(-50%,-50%)',
    })
    this._layer.appendChild(el)
    return el
  }

  // Treasury coin-icon center, in #hud-stage logical coords. Derives the stage
  // scale from rendered-vs-logical width so it stays correct at any zoom/resize.
  _treasuryTarget() {
    const coin = document.querySelector('.qf-treasury-amount .qf-coin') || document.querySelector('.qf-coin')
    if (!coin || !this._stage || !this._stage.offsetWidth) return null
    const cr = coin.getBoundingClientRect()
    const sr = this._stage.getBoundingClientRect()
    const scale = sr.width / this._stage.offsetWidth
    if (!(scale > 0)) return null
    return {
      x: (cr.left + cr.width / 2 - sr.left) / scale,
      y: (cr.top + cr.height / 2 - sr.top) / scale,
    }
  }

  // Phaser world coords → #hud-stage logical coords (mirrors DungeonFx; uses
  // cam.worldView so it's correct under the camera's mid-point zoom pivot).
  _worldToStage(worldX, worldY) {
    const gs = window.__game?.scene?.getScene?.('Game')
    const cam = gs?.cameras?.main
    if (!cam || !gs.scene.isActive()) return null
    const wv = cam.worldView
    if (!wv || !wv.width || !wv.height) return null
    return {
      x: (worldX - wv.x) / wv.width  * cam.width  + (cam.x ?? 0),
      y: (worldY - wv.y) / wv.height * cam.height + (cam.y ?? 0),
    }
  }
}

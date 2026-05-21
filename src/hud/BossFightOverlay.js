// BossFightOverlay (DOM) — Phase 34E port of the Phaser
// `src/ui/BossFightOverlay.js` cinematic. Three pieces:
//
//   1. Intro slate — full-screen translucent backdrop + centered card on
//      BOSS_FIGHT_INCOMING. Boss portrait (Phaser texture → <canvas>
//      snapshot), name, tagline, diamond ornament, lives remaining.
//      Fade in 400ms / hold 1000ms / fade out 400ms.
//
//   2. Bottom HP bar — persistent bar across the lower play area while
//      the fight is active. requestAnimationFrame loop polls
//      `gameState.boss.hp` each frame, fills accordingly, shakes 140ms
//      on small hits + 240ms + white flash on heavy hits (≥8 dmg or
//      ≥8% max). Shake honors the `qf.video.shake` user setting.
//
//   3. Result slate — small banner on BOSS_FIGHT_RESOLVED ("INTRUDER
//      REPELLED" green / "YOU LOST A LIFE" red), ~1.8s hold + 600ms
//      fade-out. HP bar and vignette fade away alongside.
//
// Vignette: 4-layer black edge strips for the "dim around the fight"
// look. Persists for the duration of the fight; fades on resolve.
//
// Mounts directly into #hud-stage (1920×1080 logical) so the new HUD's
// transform-scale applies uniformly.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { userSettings } from './userSettings.js'

const SLATE_FADE_IN_MS  = 400
const SLATE_HOLD_MS     = 1000
const SLATE_FADE_OUT_MS = 400
const RESULT_HOLD_MS    = 1800
const RESULT_FADE_MS    = 600

export class BossFightOverlay {
  constructor(gameState) {
    this._gs        = gameState
    this._listeners = []
    this._slateTimer  = null
    this._resultTimer = null
    this._raf         = 0
    this._lastHp      = null
    this._shakeUntil  = 0
    this._flashUntil  = 0
    this._barActive   = false

    this._stage = document.getElementById('hud-stage')
    if (!this._stage) return
    this._build()
    this._wireEvents()
  }

  _build() {
    // One root element; sub-pieces toggle .open class to show.
    this.el = h('div', { className: 'qf-bossfight', id: 'qf-bossfight' }, [
      h('div', { className: 'qf-bossfight-vignette',
                 ref: el => { this._vignette = el } }),
      h('div', { className: 'qf-bossfight-slate',
                 ref: el => { this._slate = el } }),
      h('div', { className: 'qf-bossfight-bar',
                 ref: el => { this._bar = el } }),
      h('div', { className: 'qf-bossfight-result',
                 ref: el => { this._result = el } }),
    ])
    this._stage.appendChild(this.el)
  }

  _wireEvents() {
    const sub = (event, fn) => { EventBus.on(event, fn); this._listeners.push([event, fn]) }
    sub('BOSS_FIGHT_INCOMING', () => this._onIncoming())
    sub('BOSS_FIGHT_RESOLVED', (p) => this._onResolved(p))
  }

  // ─── Intro slate + bar build ───────────────────────────────────
  _onIncoming() {
    this._buildVignette()
    this._buildIntroSlate()
    this._buildBar()
    this._lastHp = this._gs.boss?.hp ?? null
    this._barActive = true
    if (!this._raf) this._raf = requestAnimationFrame(() => this._tick())
  }

  _buildVignette() {
    if (!this._vignette) return
    this._vignette.classList.add('open')
  }

  _buildIntroSlate() {
    if (!this._slate) return
    const arch = this._archetypeDef()
    const name    = (arch?.name ?? 'BOSS').toUpperCase()
    const tagline = arch?.tagline ?? arch?.description ?? '— ancient threat —'
    const lives   = this._gs.boss?.deathsRemaining ?? '?'

    // Portrait snapshot from the live Phaser texture so it matches the
    // in-game sprite, not the bestiary bust.
    const portraitCanvas = this._snapshotBossSprite()

    this._slate.replaceChildren()
    this._slate.appendChild(h('div', { className: 'qf-bossfight-slate-wash' }))
    this._slate.appendChild(h('div', { className: 'qf-bossfight-slate-card' }, [
      h('div', { className: 'qf-bossfight-slate-tag' }, '◆  B O S S   F I G H T  ◆'),
      h('div', { className: 'qf-bossfight-slate-row' }, [
        portraitCanvas
          ? h('div', { className: 'qf-bossfight-slate-portrait' }, portraitCanvas)
          : null,
        h('div', { className: 'qf-bossfight-slate-textcol' }, [
          h('div', { className: 'qf-bossfight-slate-name' }, name),
          h('div', { className: 'qf-bossfight-slate-tagline' }, tagline),
        ]),
      ]),
      h('div', { className: 'qf-bossfight-slate-lives' }, `LIVES REMAINING — ${lives}`),
    ]))
    this._slate.classList.add('open')

    if (this._slateTimer) clearTimeout(this._slateTimer)
    this._slateTimer = setTimeout(() => {
      this._slate.classList.add('fading')
      this._slateTimer = setTimeout(() => {
        this._slate.classList.remove('open', 'fading')
        this._slateTimer = null
      }, SLATE_FADE_OUT_MS)
    }, SLATE_FADE_IN_MS + SLATE_HOLD_MS)
  }

  _buildBar() {
    if (!this._bar) return
    const arch = this._archetypeDef()
    const name = (arch?.name ?? 'BOSS').toUpperCase()
    const boss = this._gs.boss ?? {}
    const cur  = Math.max(0, boss.hp ?? 0)
    const max  = Math.max(1, boss.maxHp ?? 1)

    this._bar.replaceChildren()
    this._bar.appendChild(h('div', { className: 'qf-bossfight-bar-name' }, [
      h('span', { className: 'qf-bossfight-bar-dia' }, '◆'),
      h('span', null, name),
      h('span', { className: 'qf-bossfight-bar-dia' }, '◆'),
    ]))
    this._bar.appendChild(h('div', {
      className: 'qf-bossfight-bar-track',
      ref: el => { this._barTrack = el },
    }, [
      // White chip-damage ghost — sits behind the fill (first in DOM).
      h('div', {
        className: 'qf-bossfight-bar-ghost',
        ref: el => { this._barGhost = el },
      }),
      h('div', {
        className: 'qf-bossfight-bar-fill',
        ref: el => { this._barFill = el },
      }),
      h('div', {
        className: 'qf-bossfight-bar-flash',
        ref: el => { this._barFlash = el },
      }),
      h('div', {
        className: 'qf-bossfight-bar-text',
        ref: el => { this._barText = el },
      }, `${cur}  /  ${max}`),
    ]))
    this._bar.classList.add('open')
    this._applyBarFill(cur, max)
  }

  // ─── Per-frame HP / shake / flash ──────────────────────────────
  _tick() {
    this._raf = 0
    if (!this._barActive || !this.el) return
    const boss = this._gs.boss
    if (!boss) {
      this._raf = requestAnimationFrame(() => this._tick())
      return
    }
    const cur = Math.max(0, boss.hp ?? 0)
    const max = Math.max(1, boss.maxHp ?? 1)
    this._applyBarFill(cur, max)
    if (this._barText) this._barText.textContent = `${cur}  /  ${max}`

    if (this._lastHp != null && cur < this._lastHp) {
      const dmg = this._lastHp - cur
      const big = dmg >= Math.max(8, max * 0.08)
      const now = performance.now()
      this._shakeUntil = now + (big ? 240 : 140)
      if (big) this._flashUntil = now + 180
    }
    this._lastHp = cur

    const now = performance.now()
    if (this._bar) {
      const shaking = userSettings.isShakeEnabled() && now < this._shakeUntil
      const dx = shaking ? (Math.random() - 0.5) * 8 : 0
      const dy = shaking ? (Math.random() - 0.5) * 5 : 0
      this._bar.style.transform = `translate(-50%, ${dy.toFixed(2)}px) translateX(${dx.toFixed(2)}px)`
    }
    if (this._barFlash) {
      const flashing = now < this._flashUntil
      this._barFlash.style.opacity = flashing
        ? (0.55 * (1 - (this._flashUntil - now) / 180)).toFixed(3)
        : '0'
    }

    this._raf = requestAnimationFrame(() => this._tick())
  }

  _applyBarFill(cur, max) {
    if (!this._barFill) return
    const frac = Math.max(0, Math.min(1, cur / max))
    // Thresholded color tint mirrors the Phaser version.
    let color = 'var(--blood)'
    if (frac > 0.5)        color = 'var(--poison)'
    else if (frac > 0.25)  color = 'var(--gold)'
    else                   color = 'var(--hp-low, #ff5544)'
    const pct = `${(frac * 100).toFixed(2)}%`
    this._barFill.style.width      = pct
    this._barFill.style.background = color
    // White chip-damage ghost — lags behind the fill so HP just lost
    // flashes white then drains away (mirrors the top-bar HP chip bar).
    if (this._barGhost) this._barGhost.style.width = pct
  }

  // ─── Resolve ───────────────────────────────────────────────────
  _onResolved({ winner, deathsRemaining } = {}) {
    // Tear down bar + vignette in parallel with showing the result.
    this._barActive = false
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0 }
    if (this._bar)      this._bar.classList.add('fading')
    if (this._vignette) this._vignette.classList.add('fading')
    setTimeout(() => {
      this._bar?.classList.remove('open', 'fading')
      this._vignette?.classList.remove('open', 'fading')
    }, 600)
    this._buildResultSlate(winner, deathsRemaining)
  }

  _buildResultSlate(winner, deathsRemaining) {
    if (!this._result) return
    const partyWon = winner === 'party'
    this._result.replaceChildren()
    this._result.classList.toggle('party-won', partyWon)
    this._result.classList.toggle('boss-won',  !partyWon)
    this._result.appendChild(h('div', { className: 'qf-bossfight-result-wash' }))
    this._result.appendChild(h('div', { className: 'qf-bossfight-result-card' }, [
      h('div', { className: 'qf-bossfight-result-title' },
        partyWon ? 'YOU LOST A LIFE' : 'INTRUDER REPELLED'),
      h('div', { className: 'qf-bossfight-result-sub' },
        partyWon
          ? `Lives remaining: ${deathsRemaining ?? '?'}`
          : 'The dungeon endures.'),
    ]))
    this._result.classList.add('open')

    if (this._resultTimer) clearTimeout(this._resultTimer)
    this._resultTimer = setTimeout(() => {
      this._result.classList.add('fading')
      this._resultTimer = setTimeout(() => {
        this._result.classList.remove('open', 'fading', 'party-won', 'boss-won')
        this._resultTimer = null
      }, RESULT_FADE_MS)
    }, RESULT_HOLD_MS)
  }

  // ─── Helpers ───────────────────────────────────────────────────
  // Pull the first idle frame of the active boss spritesheet from the
  // Phaser texture cache and paint it onto a canvas. Returns null if
  // the texture isn't loaded yet (in which case the slate just omits
  // the portrait).
  _snapshotBossSprite() {
    const skin = this._gs.player?.bossArchetypeId
    if (!skin) return null
    const game = window.__game
    const tex  = game?.textures?.get?.(`${skin}-idle`)
    if (!tex || !tex.frameTotal) return null
    const frame = tex.get(0)
    if (!frame) return null
    const src = frame.source?.image
    if (!src) return null
    try {
      const fw = frame.cutWidth || frame.width
      const fh = frame.cutHeight || frame.height
      const canvas = document.createElement('canvas')
      canvas.width  = fw
      canvas.height = fh
      canvas.className = 'qf-bossfight-portrait-canvas'
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(src,
        frame.cutX || 0, frame.cutY || 0, fw, fh,
        0, 0, fw, fh)
      return canvas
    } catch {
      return null
    }
  }

  _archetypeDef() {
    const game = window.__game
    const scenes = game?.scene?.scenes ?? []
    for (const s of scenes) {
      const archs = s.cache?.json?.get?.('bossArchetypes')
      if (Array.isArray(archs)) {
        const id = this._gs.player?.bossArchetypeId
        return archs.find(a => a.id === id) ?? null
      }
    }
    return null
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0 }
    if (this._slateTimer)  { clearTimeout(this._slateTimer);  this._slateTimer  = null }
    if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = null }
    this.el?.remove()
  }
}

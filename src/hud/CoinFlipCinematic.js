// CoinFlipCinematic (DOM) — The Gambler's Coin full-screen sequence.
//
// Listens for `GAMBLER_COIN_FLIP { won, goldBefore, goldAfter, canDouble }`
// (emitted by EventSystem when the player takes the wager) and plays a
// cinematic: dim the screen → a 3D coin tosses + spins → it lands on
// HEADS (win) or TAILS (lose) with a flash → the verdict + payout count up.
//
// If `canDouble`, the reveal offers a DOUBLE OR NOTHING choice instead of
// dismissing: picking it emits `GAMBLER_DOUBLE_REQUEST`; EventSystem rolls
// the second flip and replies `GAMBLER_DOUBLE_RESULT`, which re-runs the
// flip in the SAME overlay (win → gold doubled, lose → gold wiped out).
//
// The gold mutation itself is done by EventSystem; this overlay only
// dramatises the reveal.

import { h, tween } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { HudSfx } from './HudSfx.js'
import { domShake } from './screenShake.js'
import { CinematicBase } from './CinematicKit.js'

const FLIP_DELAY_MS  = 550    // idle beat before the toss begins
const FLIP_DUR_MS    = 2400   // toss + spin duration (matches CSS qf-cf-toss)
const AUTO_CLOSE_MS  = 3800   // after the (final) reveal, before auto-dismiss
// Soft-lock guard (P2-5): EventSystem normally answers GAMBLER_DOUBLE_REQUEST
// synchronously with GAMBLER_DOUBLE_RESULT. If that reply never arrives
// (handler missing / threw), this is how long we wait before resolving the
// stranded overlay ourselves so it can't lock the screen.
const DOUBLE_RESULT_TIMEOUT_MS = 1500

// Self-injected styles (P4-1) — the cinematic owns its CSS like the other
// cinematics (ensureDuelCss etc.) rather than living in the global styles.css.
// The bespoke gold/crimson palette is expressed as local custom properties
// (--cf-* gambler, --cfd-* demon) so it retints by scope and stays off the
// raw-hex lint. Idempotent: guarded by the style element id.
export function ensureCoinflipCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-coinflip-css')) return
  const style = document.createElement('style')
  style.id = 'qf-coinflip-css'
  style.textContent = `
.qf-coinflip {
  --cf-gold: #f0c93c;  --cf-gold-br: #ffe27a;  --cf-ink: #1a1206;  --cf-rim: #6e520e;
  --cf-h1: #ffe9a0;  --cf-h2: #f0c43c;  --cf-h3: #b8841c;
  --cf-t1: #e8d49a;  --cf-t2: #c9a63a;  --cf-t3: #8f6716;
  --cf-facelabel: #4a3408;
  --cf-win: #7bf0a0;  --cf-win-sh: #062b13;  --cf-lose: #ff7a7a;  --cf-lose-sh: #2b0606;
  --cf-muted: #b9a98a;  --cf-win2: #8ff0aa;  --cf-lose2: #ff9a9a;  --cf-hint: #8a7c58;
  --cf-risky-tx: #ffd2d2;  --cf-risky-bd: #d23847;  --cf-risky-bg: #240608;  --cf-risky-bg2: #380a0e;
  --cf-safe-tx: #9bf0b4;   --cf-safe-bd: #3ad86a;   --cf-safe-bg: #06180c;   --cf-safe-bg2: #0a2614;
  position: absolute; inset: 0; z-index: 9000;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  opacity: 0; pointer-events: none; transition: opacity 280ms ease;
}
.qf-coinflip.show    { opacity: 1; pointer-events: auto; }
.qf-coinflip.closing { opacity: 0; transition: opacity 340ms ease; }
.qf-coinflip-dim { position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, rgba(60,44,8,0.55) 0%, rgba(4,3,1,0.92) 70%); }
.qf-coinflip-stage { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.qf-coinflip-kicker { font-family: var(--pix); font-size: 11px; letter-spacing: 6px;
  color: var(--cf-gold); text-shadow: 0 0 10px rgba(240,201,60,0.7); opacity: 0; }
.qf-coinflip.show .qf-coinflip-kicker { animation: qf-cf-fadedown 420ms ease-out 120ms both, qf-cf-kicker 1.4s ease-in-out 540ms infinite; }
.qf-coinflip-title { font-family: var(--pix); font-size: 26px; letter-spacing: 3px;
  color: var(--cf-gold-br); text-shadow: 2px 2px 0 var(--cf-ink), 0 0 20px rgba(240,201,60,0.6); margin-bottom: 26px; opacity: 0; }
.qf-coinflip.show .qf-coinflip-title { animation: qf-cf-fadedown 460ms ease-out 60ms both; }
.qf-coinflip-coinwrap { position: relative; width: 150px; height: 150px; perspective: 760px; }
.qf-coinflip.flipping .qf-coinflip-coinwrap { animation: qf-cf-toss 2400ms 1 both; }
.qf-coinflip-coin { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateY(0deg); }
.qf-coinflip-face { position: absolute; inset: 0; border-radius: 50%; backface-visibility: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  border: 5px solid var(--cf-rim);
  box-shadow: inset 0 0 0 4px rgba(255,244,200,0.35), inset 0 -10px 22px rgba(80,56,4,0.8), 0 0 34px rgba(240,201,60,0.55); }
.qf-coinflip-face.heads { background: radial-gradient(circle at 38% 32%, var(--cf-h1) 0%, var(--cf-h2) 46%, var(--cf-h3) 100%); transform: rotateY(0deg); }
.qf-coinflip-face.tails { background: radial-gradient(circle at 38% 32%, var(--cf-t1) 0%, var(--cf-t2) 46%, var(--cf-t3) 100%); transform: rotateY(180deg); }
.qf-coinflip-glyph { font-size: 56px; line-height: 1; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5)); }
.qf-coinflip-facelabel { font-family: var(--pix); font-size: 11px; letter-spacing: 2px; color: var(--cf-facelabel); }
.qf-coinflip-result { margin-top: 30px; text-align: center; opacity: 0; }
.qf-coinflip.revealed .qf-coinflip-result { animation: qf-cf-pop 460ms cubic-bezier(0.2,1.4,0.4,1) both; }
.qf-coinflip-verdict { font-family: var(--pix); font-size: 34px; letter-spacing: 4px; }
.qf-coinflip-result.win  .qf-coinflip-verdict { color: var(--cf-win);  text-shadow: 3px 3px 0 var(--cf-win-sh),  0 0 24px rgba(123,240,160,0.7); }
.qf-coinflip-result.lose .qf-coinflip-verdict { color: var(--cf-lose); text-shadow: 3px 3px 0 var(--cf-lose-sh), 0 0 24px rgba(255,122,122,0.7); }
.qf-coinflip-payout { margin-top: 12px; font-family: var(--pix); font-size: 17px; letter-spacing: 2px; color: var(--cf-gold-br); display: flex; align-items: center; justify-content: center; gap: 12px; }
.qf-coinflip-payout .arrow { color: var(--cf-gold); }
.qf-coinflip-old { color: var(--cf-muted); }
.qf-coinflip-new { font-size: 22px; }
.qf-coinflip-result.win  .qf-coinflip-new { color: var(--cf-win2); }
.qf-coinflip-result.lose .qf-coinflip-new { color: var(--cf-lose2); }
.qf-coinflip-hint { margin-top: 26px; font-family: var(--mono); font-size: 11px; letter-spacing: 2px; color: var(--cf-hint); opacity: 0; }
.qf-coinflip.revealed .qf-coinflip-hint { animation: qf-cf-fadein 500ms ease 700ms both, qf-cf-kicker 1.6s ease-in-out 1200ms infinite; }
.qf-coinflip-stake { margin-top: 22px; font-family: var(--mono); font-size: 11px; letter-spacing: 2px; color: var(--cf-muted); opacity: 0; }
.qf-coinflip.revealed .qf-coinflip-stake { animation: qf-cf-fadein 400ms ease 620ms both; }
.qf-coinflip-choices { display: flex; gap: 16px; justify-content: center; margin-top: 14px; opacity: 0; }
.qf-coinflip.revealed .qf-coinflip-choices { animation: qf-cf-fadein 420ms ease 760ms both; }
.qf-coinflip-btn { font-family: var(--pix); font-size: 12px; letter-spacing: 2px; padding: 12px 22px; cursor: pointer;
  background: var(--cf-ink); color: var(--cf-gold-br); border: 2px solid var(--cf-rim); box-shadow: 3px 3px 0 #000;
  transition: transform 90ms ease, box-shadow 90ms ease, background 90ms ease; }
.qf-coinflip-btn:hover { transform: translate(-1px,-1px); box-shadow: 4px 4px 0 #000; }
.qf-coinflip-btn:active { transform: translate(1px,1px); box-shadow: 1px 1px 0 #000; }
.qf-coinflip-btn.risky { color: var(--cf-risky-tx); border-color: var(--cf-risky-bd); background: var(--cf-risky-bg); text-shadow: 0 0 8px rgba(210,56,71,0.7); }
.qf-coinflip-btn.risky:hover { background: var(--cf-risky-bg2); }
.qf-coinflip-btn.safe { color: var(--cf-safe-tx); border-color: var(--cf-safe-bd); background: var(--cf-safe-bg); }
.qf-coinflip-btn.safe:hover { background: var(--cf-safe-bg2); }
.qf-coinflip-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
.qf-coinflip.landed .qf-coinflip-flash { animation: qf-cf-flash 460ms ease-out both; }
@keyframes qf-cf-fadedown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes qf-cf-fadein   { from { opacity: 0; } to { opacity: 1; } }
@keyframes qf-cf-kicker   { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
@keyframes qf-cf-pop      { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: scale(1); } }
@keyframes qf-cf-flash    { 0% { opacity: 0.8; } 100% { opacity: 0; } }
@keyframes qf-cf-toss {
  0%   { transform: translateY(0);      animation-timing-function: cubic-bezier(0.18,0.62,0.34,1); }
  50%  { transform: translateY(-172px); animation-timing-function: cubic-bezier(0.64,0,0.78,0.42); }
  100% { transform: translateY(0); }
}
/* The Demon's Wager — sinister crimson/black theme. Defines its own --cfd-* vars
   and explicitly re-colours the demon-scoped surfaces below (dim/kicker/title/
   face/payout-arrow/verdict/new). The DOUBLE-OR-NOTHING buttons intentionally
   keep the gambler styling (matches the original, pre-refactor behaviour). */
.qf-coinflip-demon {
  --cfd-red: #ff5560;  --cfd-red-br: #ff8a8a;  --cfd-ink: #1a0303;  --cfd-rim: #5a0c12;
  --cfd-h1: #ffb0b0;  --cfd-h2: #c83040;  --cfd-h3: #6a0c14;
  --cfd-t1: #d0a0a0;  --cfd-t2: #8a2030;  --cfd-t3: #3a0408;
}
.qf-coinflip-demon .qf-coinflip-dim { background: radial-gradient(ellipse at center, rgba(80,8,12,0.65) 0%, rgba(4,1,1,0.96) 70%); }
.qf-coinflip-demon .qf-coinflip-kicker { color: var(--cfd-red); text-shadow: 0 0 10px rgba(255,90,96,0.65); }
.qf-coinflip-demon .qf-coinflip-title { color: var(--cfd-red-br); text-shadow: 2px 2px 0 var(--cfd-ink), 0 0 22px rgba(220,40,50,0.7); }
.qf-coinflip-demon .qf-coinflip-face { border-color: var(--cfd-rim);
  box-shadow: inset 0 0 0 4px rgba(255,180,180,0.28), inset 0 -10px 22px rgba(60,6,10,0.85), 0 0 36px rgba(220,40,50,0.55); }
.qf-coinflip-demon .qf-coinflip-face.heads { background: radial-gradient(circle at 38% 32%, var(--cfd-h1) 0%, var(--cfd-h2) 46%, var(--cfd-h3) 100%); }
.qf-coinflip-demon .qf-coinflip-face.tails { background: radial-gradient(circle at 38% 32%, var(--cfd-t1) 0%, var(--cfd-t2) 46%, var(--cfd-t3) 100%); }
.qf-coinflip-demon .qf-coinflip-payout .arrow { color: var(--cfd-red); }
.qf-coinflip-demon .qf-coinflip-result.win  .qf-coinflip-verdict { color: var(--cfd-red-br); }
.qf-coinflip-demon .qf-coinflip-result.lose .qf-coinflip-verdict { color: var(--cfd-red); }
.qf-coinflip-demon .qf-coinflip-result.win  .qf-coinflip-new { color: var(--cfd-h1); }
.qf-coinflip-demon .qf-coinflip-result.lose .qf-coinflip-new { color: var(--cfd-h2); }
`
  document.head.appendChild(style)
}

export class CoinFlipCinematic extends CinematicBase {
  constructor() {
    super()   // _timers / _detached + the tracked-timer helpers
    ensureCoinflipCss()
    this._stage = document.getElementById('hud-stage')
    this._listeners = []
    this._cancelTween = null
    this._el = null
    this._active = false
    this._revealed = false
    if (!this._stage) return
    this._wire()
  }

  _wire() {
    const sub = (evt, fn) => { EventBus.on(evt, fn); this._listeners.push([evt, fn]) }
    sub('GAMBLER_COIN_FLIP',     (p) => this._play(p))
    sub('GAMBLER_DOUBLE_RESULT', (p) => this._onDoubleResult(p))
    // Demon's Wager — boss-level coin flip with sinister theming. Reuses
    // the same flip cinematic; renders crimson/black palette + boss-
    // level verdict text via the `theme:'demon'` payload.
    sub('DEMON_WAGER_FLIP',      (p) => this._playDemon(p))
  }

  // First flip — builds the overlay shell, then runs the flip sequence.
  _play(payload = {}) {
    if (this._active) this._teardown()   // a fresh wager supersedes any stale one
    this._active = true

    this._stageEl = h('div', { className: 'qf-coinflip-stage' })
    this._el = h('div', { className: 'qf-coinflip' }, [
      h('div', { className: 'qf-coinflip-dim' }),
      h('div', { className: 'qf-coinflip-flash' }),
      this._stageEl,
    ])
    // Click to dismiss — only once the FINAL reveal is on screen (a
    // double-or-nothing reveal shows buttons and ignores stray clicks).
    this._el.addEventListener('click', () => {
      if (this._revealed && !this._canDouble && !this._awaitingDouble) this._dismiss()
    })
    this._stage.appendChild(this._el)
    // Force reflow so the .show transition runs.
    // eslint-disable-next-line no-unused-expressions
    this._el.offsetHeight
    this._el.classList.add('show')

    this._runFlip(payload, 1)
  }

  // Demon's Wager variant — same flip cinematic, sinister palette +
  // boss-level verdict text. Reuses the existing flip-and-reveal
  // mechanics; just swaps strings and applies the `qf-coinflip-demon`
  // CSS class so the palette flips to crimson/black.
  _playDemon(payload = {}) {
    if (this._active) this._teardown()
    this._active = true
    this._isDemon = true
    this._stageEl = h('div', { className: 'qf-coinflip-stage' })
    this._el = h('div', { className: 'qf-coinflip qf-coinflip-demon' }, [
      h('div', { className: 'qf-coinflip-dim' }),
      h('div', { className: 'qf-coinflip-flash' }),
      this._stageEl,
    ])
    this._el.addEventListener('click', () => {
      if (this._revealed) this._dismiss()
    })
    this._stage.appendChild(this._el)
    // eslint-disable-next-line no-unused-expressions
    this._el.offsetHeight
    this._el.classList.add('show')
    this._runDemonFlip(payload)
  }

  _runDemonFlip({ won = false, oldLevel = 1, newLevel = 1 } = {}) {
    this._clearTimers()
    if (this._cancelTween) { this._cancelTween(); this._cancelTween = null }
    this._won        = won
    this._canDouble  = false
    this._revealed   = false
    this._el.classList.remove('flipping', 'landed', 'revealed')

    const coin = h('div', { className: 'qf-coinflip-coin' }, [
      h('div', { className: 'qf-coinflip-face heads' }, [
        h('span', { className: 'qf-coinflip-glyph' }, '👁️'),
        h('span', { className: 'qf-coinflip-facelabel' }, 'EYE'),
      ]),
      h('div', { className: 'qf-coinflip-face tails' }, [
        h('span', { className: 'qf-coinflip-glyph' }, '☠'),
        h('span', { className: 'qf-coinflip-facelabel' }, 'SKULL'),
      ]),
    ])
    this._coin = coin

    const verdict = won ? 'BOSS RISES' : 'BOSS DIMINISHED'
    this._result = h('div', { className: 'qf-coinflip-result' }, [
      h('div', { className: 'qf-coinflip-verdict' }, verdict),
      h('div', { className: 'qf-coinflip-payout' }, [
        h('span', { className: 'qf-coinflip-old' }, `LV ${oldLevel}`),
        h('span', { className: 'arrow' }, '➜'),
        h('span', { className: 'qf-coinflip-new' }, `LV ${newLevel}`),
      ]),
    ])
    this._footerEl = h('div', { className: 'qf-coinflip-footer' })

    this._stageEl.replaceChildren(
      h('div', { className: 'qf-coinflip-kicker' }, '◆  THE DEMON\'S WAGER  ◆'),
      h('div', { className: 'qf-coinflip-title' }, "THE DEMON'S WAGER"),
      h('div', { className: 'qf-coinflip-coinwrap' }, [coin]),
      this._result,
      this._footerEl,
    )

    this._after(FLIP_DELAY_MS, () => this._startFlip())
    this._after(FLIP_DELAY_MS + FLIP_DUR_MS, () => this._revealDemon())
  }

  _revealDemon() {
    if (!this._el) return
    this._revealed = true
    this._el.classList.remove('flipping')
    this._el.classList.add('landed', 'revealed')
    this._result.classList.add(this._won ? 'win' : 'lose')
    EventBus.emit('DEMON_WAGER_REVEALED', { won: this._won })
    HudSfx.playUi('cin_coin_land')                          // P2-1 (dormant until file added)
    if (this._won) HudSfx.playUi('cin_coin_win')
    domShake(this._el, { intensity: this._won ? 11 : 6, durationMs: this._won ? 420 : 260 })   // P2-2
    this._footerEl.replaceChildren(
      h('div', { className: 'qf-coinflip-hint' }, 'click to continue'),
    )
    this._after(AUTO_CLOSE_MS, () => this._dismiss())
  }

  // Second flip (double or nothing) — re-runs on the existing overlay.
  _onDoubleResult(payload = {}) {
    if (!this._el || !this._awaitingDouble) return
    this._awaitingDouble = false
    this._runFlip({ ...payload, canDouble: false }, 2)
  }

  // (Re)build the stage content for one flip and run the toss → reveal.
  _runFlip({ won = false, goldBefore = 0, goldAfter = 0, canDouble = false } = {}, round) {
    this._clearTimers()
    if (this._cancelTween) { this._cancelTween(); this._cancelTween = null }
    this._round      = round
    this._won        = won
    this._goldBefore = goldBefore
    this._goldAfter  = goldAfter
    this._canDouble  = !!canDouble
    this._revealed   = false
    this._el.classList.remove('flipping', 'landed', 'revealed')

    const coin = h('div', { className: 'qf-coinflip-coin' }, [
      h('div', { className: 'qf-coinflip-face heads' }, [
        h('span', { className: 'qf-coinflip-glyph' }, '👑'),
        h('span', { className: 'qf-coinflip-facelabel' }, 'HEADS'),
      ]),
      h('div', { className: 'qf-coinflip-face tails' }, [
        h('span', { className: 'qf-coinflip-glyph' }, '💀'),
        h('span', { className: 'qf-coinflip-facelabel' }, 'TAILS'),
      ]),
    ])
    this._coin = coin

    const verdict = won ? 'JACKPOT!' : (goldAfter <= 0 ? 'WIPED OUT!' : 'BUSTED!')
    const newCountEl = h('span', { className: 'qf-coinflip-new' }, String(goldBefore))
    this._newCountEl = newCountEl
    this._result = h('div', { className: 'qf-coinflip-result' }, [
      h('div', { className: 'qf-coinflip-verdict' }, verdict),
      h('div', { className: 'qf-coinflip-payout' }, [
        h('span', { className: 'qf-coinflip-old' }, `${goldBefore} G`),
        h('span', { className: 'arrow' }, '➜'),
        newCountEl,
        h('span', null, 'G'),
      ]),
    ])
    this._footerEl = h('div', { className: 'qf-coinflip-footer' })

    this._stageEl.replaceChildren(
      h('div', { className: 'qf-coinflip-kicker' },
        round === 2 ? '◆  DOUBLE OR NOTHING  ◆' : '◆  A WAGER IS STRUCK  ◆'),
      h('div', { className: 'qf-coinflip-title' }, "THE GAMBLER'S COIN"),
      h('div', { className: 'qf-coinflip-coinwrap' }, [coin]),
      this._result,
      this._footerEl,
    )

    this._after(FLIP_DELAY_MS, () => this._startFlip())
    this._after(FLIP_DELAY_MS + FLIP_DUR_MS, () => this._reveal())
  }

  _startFlip() {
    if (!this._el) return
    this._el.classList.add('flipping')
    // The coin spins 5 full turns; +180° extra lands it on TAILS (lose).
    // rotateY 0 ≡ HEADS front, 180 ≡ TAILS front.
    const finalDeg = 5 * 360 + (this._won ? 0 : 180)
    this._coin.style.transition = `transform ${FLIP_DUR_MS}ms cubic-bezier(0.15, 0.72, 0.2, 1)`
    // eslint-disable-next-line no-unused-expressions
    this._coin.offsetHeight
    this._coin.style.transform = `rotateY(${finalDeg}deg)`
  }

  _reveal() {
    if (!this._el) return
    this._revealed = true
    this._el.classList.remove('flipping')
    this._el.classList.add('landed', 'revealed')
    this._result.classList.add(this._won ? 'win' : 'lose')
    EventBus.emit('GAMBLER_COIN_REVEALED', { won: this._won })
    // Cinematic stingers (P2-1; dormant until files added): the coin's landing
    // thunk, plus a celebratory sting on a win. Layered over the existing
    // GAMBLER_COIN_REVEALED gameplay SFX.
    HudSfx.playUi('cin_coin_land')
    if (this._won) HudSfx.playUi('cin_coin_win')
    // P2-2 — jolt the coin overlay as it lands; a bigger jolt on a jackpot.
    domShake(this._el, { intensity: this._won ? 11 : 6, durationMs: this._won ? 420 : 260 })
    // Count the treasury up/down to its new value.
    this._after(180, () => {
      if (!this._newCountEl) return
      this._cancelTween = tween(this._goldBefore, this._goldAfter, 900, (v) => {
        if (this._newCountEl) this._newCountEl.textContent = String(v)
      })
    })

    if (this._canDouble) {
      // Offer the second wager instead of closing. No auto-dismiss — the
      // player must choose.
      this._footerEl.replaceChildren(
        h('div', { className: 'qf-coinflip-stake' }, 'press your luck — or walk away'),
        h('div', { className: 'qf-coinflip-choices' }, [
          h('button', {
            className: 'qf-coinflip-btn risky',
            on: { click: (e) => { e.stopPropagation(); this._chooseDouble() } },
          }, 'DOUBLE OR NOTHING'),
          h('button', {
            className: 'qf-coinflip-btn safe',
            on: { click: (e) => { e.stopPropagation(); this._dismiss() } },
          }, `CASH OUT · ${this._goldAfter} G`),
        ]),
      )
    } else {
      this._footerEl.replaceChildren(
        h('div', { className: 'qf-coinflip-hint' }, 'click to continue'),
      )
      this._after(AUTO_CLOSE_MS, () => this._dismiss())
    }
  }

  _chooseDouble() {
    if (!this._el || this._awaitingDouble) return
    this._canDouble     = false
    this._awaitingDouble = true
    // Swap the choices for a tense "rolling again" line; EventSystem
    // answers synchronously with GAMBLER_DOUBLE_RESULT → _onDoubleResult.
    this._footerEl.replaceChildren(
      h('div', { className: 'qf-coinflip-hint' }, 'the imp grins…'),
    )
    // Arm the soft-lock guard BEFORE emitting: a synchronous (or any) reply
    // runs _onDoubleResult → _runFlip → _clearTimers, which cancels this; only
    // a missing reply lets it fire and close the otherwise-stranded overlay.
    this._after(DOUBLE_RESULT_TIMEOUT_MS, () => {
      if (!this._el || !this._awaitingDouble) return
      this._awaitingDouble = false
      if (this._footerEl) {
        this._footerEl.replaceChildren(
          h('div', { className: 'qf-coinflip-hint' }, 'the imp vanishes with the wager…'),
        )
      }
      this._after(900, () => this._dismiss())
    })
    EventBus.emit('GAMBLER_DOUBLE_REQUEST')
  }

  _dismiss() {
    if (!this._el) return
    this._el.classList.add('closing')
    this._after(360, () => this._teardown())
  }

  // (_after / _clearTimers inherited from CinematicBase.)

  _teardown() {
    // Capture the demon-flavour flag BEFORE reset so we can emit the
    // post-cinematic chain event for the Demon's Wager path. The
    // EventSystem listens for DEMON_WAGER_CINEMATIC_DONE on a WIN to
    // chain into the SHOW_BOSS_LEVEL_UP → SHOW_DARK_PACT celebration
    // sequence (matches the end-of-day level-up flow). Fires whether
    // the player clicked CONTINUE or the auto-close timer hit, and
    // for both win + lose paths (the listener inside the wager only
    // wires on win, so a lose teardown is a harmless no-op).
    const wasDemon = this._isDemon
    this._clearTimers()
    if (this._cancelTween) { this._cancelTween(); this._cancelTween = null }
    this._el?.remove()
    this._el = null
    this._stageEl = null
    this._coin = null
    this._result = null
    this._footerEl = null
    this._newCountEl = null
    this._active = false
    this._revealed = false
    this._awaitingDouble = false
    this._canDouble = false
    this._isDemon = false
    if (wasDemon) EventBus.emit('DEMON_WAGER_CINEMATIC_DONE')
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._teardown()
  }
}

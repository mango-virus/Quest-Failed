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

const FLIP_DELAY_MS  = 550    // idle beat before the toss begins
const FLIP_DUR_MS    = 2400   // toss + spin duration (matches CSS qf-cf-toss)
const AUTO_CLOSE_MS  = 3800   // after the (final) reveal, before auto-dismiss

export class CoinFlipCinematic {
  constructor() {
    this._stage = document.getElementById('hud-stage')
    this._listeners = []
    this._timers = []
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
    EventBus.emit('GAMBLER_DOUBLE_REQUEST')
  }

  _dismiss() {
    if (!this._el) return
    this._el.classList.add('closing')
    this._after(360, () => this._teardown())
  }

  _after(ms, fn) {
    const id = setTimeout(fn, ms)
    this._timers.push(id)
    return id
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id)
    this._timers = []
  }

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

// AltarRewardSlot — Sacrificial Altar reward reveal cinematic.
//
// Subscribes to SACRIFICIAL_ALTAR_SPIN { rewardKind, rewardLabel } and
// plays a slot-machine-style reveal: a vertical reel cycling through
// all 6 reward emojis spins fast, decelerates, and lands on the
// winning emoji. After landing the reward name + flavour text fade
// in with a CONTINUE button.
//
// Emits SACRIFICIAL_ALTAR_SPIN_DONE on dismiss (button click, Esc, or
// auto-timeout fallback). EventSystem._onAltarSpinDone applies the
// reward effect at that point — the cinematic is purely cosmetic and
// the reward still lands if the player dismisses early.
//
// Reel works by listing the 6 winning emojis 8 times in a vertical
// strip (48 rows), then animating translateY through 7 full
// revolutions before landing on the 8th repeat at the winning row.
// The deceleration easing in the CSS keyframe sells the slot-stop.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const ROW_H = 96        // px per reel row — match CSS .qf-altar-slot-row height
const REVOLUTIONS = 7   // how many full passes before landing
const SPIN_MS = 3200    // total spin duration
const REVEAL_DELAY = 250 // beat after landing before the "YOU RECEIVED" panel fades in
const AUTO_CLOSE = 8000 // fallback dismiss if the player walks away

// Each reward has a distinct emoji + display name. Ordered so reel
// indexing is stable — never reorder without re-checking the visual.
const REWARDS = [
  { kind: 'minion_3',   emoji: '🩸', name: '+3% Minion Stats' },
  { kind: 'minion_10',  emoji: '⚔️', name: '+10% Minion Stats' },
  { kind: 'boss_3',     emoji: '🛡️', name: '+3% Boss Stats' },
  { kind: 'boss_10',    emoji: '👑', name: '+10% Boss Stats' },
  { kind: 'boss_level', emoji: '⬆️', name: '+1 Boss Level' },
  { kind: 'free_pact',  emoji: '📕', name: 'Free Dark Pact' },
]

export class AltarRewardSlot {
  constructor() {
    this._el        = null
    this._escFn     = null
    this._timers    = []
    this._listener  = (payload) => this.show(payload ?? {})
    EventBus.on('SACRIFICIAL_ALTAR_SPIN', this._listener)
  }

  destroy() {
    EventBus.off('SACRIFICIAL_ALTAR_SPIN', this._listener)
    this._close(false)
  }

  show({ rewardKind, rewardLabel } = {}) {
    if (this._el) this._close(false)
    const idx = REWARDS.findIndex(r => r.kind === rewardKind)
    if (idx < 0) {
      // Unknown reward kind — drop the cinematic and resolve right
      // away so the EventSystem reward-apply still fires.
      EventBus.emit('SACRIFICIAL_ALTAR_SPIN_DONE')
      return
    }
    const winning = REWARDS[idx]

    const stage = document.getElementById('hud-stage') ?? document.body

    // Build a tall reel strip — REWARDS repeated 8 times — so the
    // CSS translate animation can sweep through 7 full revolutions
    // before landing on the winning row in the 8th repeat.
    const strip = h('div', { className: 'qf-altar-slot-strip' })
    for (let rep = 0; rep < 8; rep++) {
      for (const r of REWARDS) {
        strip.appendChild(h('div', { className: 'qf-altar-slot-row' }, [
          h('span', { className: 'qf-altar-slot-emoji' }, r.emoji),
        ]))
      }
    }

    // The winning row index in the FULL strip (0-indexed). Land it on
    // the last repeat so the reel passes through 7 full cycles first.
    const winRow = 7 * REWARDS.length + idx
    const finalY = -winRow * ROW_H
    // Start position — top of the strip. Sweep down to finalY.
    strip.style.setProperty('--final-y', `${finalY}px`)
    strip.style.transform = `translateY(0)`

    this._reveal = h('div', { className: 'qf-altar-slot-reveal' }, [
      h('div', { className: 'qf-altar-slot-reveal-kicker' }, '◆  THE ALTAR HAS SPOKEN  ◆'),
      h('div', { className: 'qf-altar-slot-reveal-name' }, winning.name),
      h('div', { className: 'qf-altar-slot-reveal-detail' }, rewardLabel || ''),
      h('button', {
        className: 'qf-altar-slot-continue',
        on: { click: () => this._close(true) },
      }, 'CONTINUE'),
    ])

    this._el = h('div', {
      className: 'qf-altar-slot-modal',
      on: {
        // Backdrop click after the reel has landed = dismiss; during
        // the spin = no-op (so an errant click can't skip the suspense).
        click: (e) => {
          if (e.target !== e.currentTarget) return
          if (this._landed) this._close(true)
        },
      },
    }, [
      h('div', { className: 'qf-altar-slot-card' }, [
        h('div', { className: 'qf-altar-slot-title pix' }, 'SACRIFICIAL ALTAR'),
        h('div', { className: 'qf-altar-slot-reel-wrap' }, [
          h('div', { className: 'qf-altar-slot-window' }, [
            strip,
          ]),
          // Top + bottom edge gradients to fake the slot-machine glass
          // — visually hides where the reel cuts off in the window.
          h('div', { className: 'qf-altar-slot-fade top' }),
          h('div', { className: 'qf-altar-slot-fade bottom' }),
        ]),
        this._reveal,
      ]),
    ])
    stage.appendChild(this._el)

    // Kick the spin. Forced reflow so the transition starts from the
    // initial transform (rather than batching with the assignment).
    // eslint-disable-next-line no-unused-expressions
    strip.offsetHeight
    strip.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.18, 0.62, 0.34, 1)`
    strip.style.transform  = `translateY(${finalY}px)`

    this._timers.push(setTimeout(() => {
      this._landed = true
      this._el?.classList.add('landed')
      setTimeout(() => this._el?.classList.add('revealed'), REVEAL_DELAY)
      EventBus.emit('ALTAR_SLOT_LANDED', { rewardKind })
    }, SPIN_MS))

    // Esc / fallback dismiss.
    this._escFn = (e) => { if (e.key === 'Escape' && this._landed) this._close(true) }
    window.addEventListener('keydown', this._escFn)
    this._timers.push(setTimeout(() => {
      if (this._el) this._close(true)
    }, SPIN_MS + AUTO_CLOSE))
  }

  _close(applyReward) {
    if (this._escFn) {
      window.removeEventListener('keydown', this._escFn)
      this._escFn = null
    }
    for (const t of this._timers) clearTimeout(t)
    this._timers = []
    if (this._el) {
      this._el.classList.add('closing')
      const el = this._el
      setTimeout(() => { el.remove() }, 280)
      this._el = null
      this._reveal = null
      this._landed = false
    }
    if (applyReward) {
      EventBus.emit('SACRIFICIAL_ALTAR_SPIN_DONE')
    }
  }
}

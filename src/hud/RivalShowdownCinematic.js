// RivalShowdownCinematic (DOM) — the boss-vs-boss SHOWDOWN presentation (KR Rival
// response). Vorzak, the rival dungeon lord, marches to your throne and you fight
// boss-to-boss. Pure presentation — the kinetic choreography + HP feed live in
// BossSystem's generic duel engine (_startDuel / _tickNemesisDuel, evt='RIVAL_DUEL').
//
// REUSES the Aldric duel's qf-ald-* styling (VS slam-in, two-bar HP header, beat
// flashes, screen pulses, finale) via ensureDuelCss(), but WITHOUT the reacting
// portrait — Vorzak is a randomised T4 boss SKIN, not a character with portrait
// art, so the in-world duel + the boss-vs-boss header carry it. Themed purple (the
// Rival accent). Driven by RIVAL_DUEL_BEGAN / _HP / _BEAT / _END.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { ensureDuelCss } from './AldricCinematic.js'

const ACC = '#a24bd9', ACC2 = '#d49cff'   // the Rival accent (purple)

// Remap the engine's (Aldric-named) challenger beats to RIVAL-themed labels. The
// boss-side beats (boss_ult/knockback) keep their per-archetype label from the
// engine; only the challenger's signature beats are renamed for Vorzak.
const RIVAL_BEAT = {
  clash:          { label: null,              cls: 'clash' },
  dawnblade:      { label: "USURPER'S STRIKE", cls: 'aldric' },
  heroic_resolve: { label: 'NO RETREAT',      cls: 'aldric' },
  hero_king:      { label: 'THRONE-BREAKER',  cls: 'apex'  },
  bladelock:      { label: 'BLADE-LOCK',      cls: 'lock'  },
  boss_ult:       { label: null,              cls: 'boss'  },   // your boss's archetype ult
  knockback:      { label: null,              cls: 'boss'  },
  surge:          { label: 'THE TIDE TURNS',  cls: 'turn'  },
  finalblow:      { label: 'THE FINAL BLOW',  cls: 'apex'  },   // decisive — apex flash + label
}

export class RivalShowdownCinematic {
  constructor() {
    this._stage = document.getElementById('hud-stage')
    this._listeners = []
    this._timers = []
    this._root = null
    if (!this._stage) return
    ensureDuelCss()
    const sub = (evt, fn) => { EventBus.on(evt, fn); this._listeners.push([evt, fn]) }
    sub('RIVAL_DUEL_BEGAN', (p) => this._onBegan(p ?? {}))
    sub('RIVAL_DUEL_HP',    (p) => this._onHp(p ?? {}))
    sub('RIVAL_DUEL_BEAT',  (p) => this._onBeat(p ?? {}))
    sub('RIVAL_DUEL_END',   (p) => this._onEnd(p ?? {}))
    sub('DAY_PHASE_ENDED',  () => this._teardown())
  }

  _onBegan({ name = 'THE USURPER', bossName = 'THE BOSS' } = {}) {
    this._teardown()
    this._rivalName = String(name).toUpperCase()
    this._bossName  = String(bossName).toUpperCase()
    this._root = h('div', { className: 'qf-ald-root', style: { '--acc': ACC, '--acc2': ACC2 } })
    this._stage.appendChild(this._root)
    this._buildPresence()
    this._buildHud()
    this._playEntrance()
  }

  _buildPresence() {
    this._presence = h('div', { className: 'qf-ald-presence motes' })
    this._root.appendChild(this._presence)
    requestAnimationFrame(() => this._presence?.classList.add('show'))
  }

  _buildHud() {
    this._advFill   = h('div', { className: 'qf-ald-fill' })
    this._advGhost  = h('div', { className: 'qf-ald-ghost' })
    this._bossFill  = h('div', { className: 'qf-ald-fill' })
    this._bossGhost = h('div', { className: 'qf-ald-ghost' })
    // LEFT = Vorzak (the challenger, purple via --acc); RIGHT = your boss (red).
    this._hud = h('div', { className: 'qf-ald-hud' }, [
      h('div', { className: 'qf-ald-side left' }, [
        h('div', { className: 'qf-ald-name' }, this._rivalName),
        h('div', { className: 'qf-ald-track' }, [this._advGhost, this._advFill]),
      ]),
      h('div', { className: 'qf-ald-vs' }, 'VS'),
      h('div', { className: 'qf-ald-side right' }, [
        h('div', { className: 'qf-ald-name' }, this._bossName),
        h('div', { className: 'qf-ald-track' }, [this._bossGhost, this._bossFill]),
      ]),
    ])
    this._root.appendChild(this._hud)
    this._after(2200, () => this._hud?.classList.add('show'))
  }

  _playEntrance() {
    const card = h('div', { className: 'qf-ald-card' }, [
      h('div', { className: 'qf-ald-card-kicker' }, 'THE USURPER BELOW'),
      h('div', { className: 'qf-ald-card-row' }, [
        h('div', { className: 'qf-ald-card-side left' }, this._rivalName),
        h('div', { className: 'qf-ald-card-vs' }, 'VS'),
        h('div', { className: 'qf-ald-card-side right' }, this._bossName),
      ]),
    ])
    this._root.appendChild(card)
    requestAnimationFrame(() => card.classList.add('show'))
    this._after(2300, () => { card.classList.remove('show'); this._after(450, () => card.remove()) })
  }

  _onHp({ advFrac = 1, bossFrac = 1 } = {}) {
    const a = `${Math.round(Math.max(0, Math.min(1, advFrac)) * 100)}%`
    const b = `${Math.round(Math.max(0, Math.min(1, bossFrac)) * 100)}%`
    if (this._advFill)  this._advFill.style.width  = a
    if (this._advGhost) this._advGhost.style.width = a
    if (this._bossFill) this._bossFill.style.width = b
    if (this._bossGhost) this._bossGhost.style.width = b
  }

  _onBeat({ kind, label } = {}) {
    const def = RIVAL_BEAT[kind]
    if (!def || !this._root) return
    const pulse = h('div', { className: `qf-ald-pulse ${def.cls}` })
    this._root.appendChild(pulse)
    this._after(820, () => pulse.remove())
    if (def.cls === 'apex' || kind === 'finalblow') {
      const flash = h('div', { className: 'qf-ald-flash' })
      this._root.appendChild(flash)
      this._after(450, () => flash.remove())
    }
    // Prefer the rival-remapped label; fall back to the engine's (e.g. boss_ult's
    // per-archetype name) when this beat has none of its own.
    const text = def.label || label
    if (text) {
      const lbl = h('div', { className: `qf-ald-beat ${def.cls}` }, String(text).toUpperCase())
      this._root.appendChild(lbl)
      requestAnimationFrame(() => lbl.classList.add('show'))
      this._after(1650, () => lbl.remove())
    }
  }

  _onEnd({ result, bossName } = {}) {
    // result='win'  → the BOSS won → Vorzak falls (you win the showdown).
    // result='loss' → Vorzak won → your boss loses a life (the throne is breached).
    const bossWon = result === 'win'
    const card = h('div', { className: 'qf-ald-card' }, [
      h('div', { className: 'qf-ald-card-kicker' }, bossWon ? 'THE THRONE HOLDS' : 'THE THRONE IS BREACHED'),
      h('div', { className: 'qf-ald-card-title' }, bossWon ? 'THE USURPER FALLS' : 'VORZAK PREVAILS'),
      h('div', { className: 'qf-ald-card-sub' },
        bossWon ? `${this._rivalName} lies broken before your throne.` : `${String(bossName || this._bossName).toUpperCase()} IS DRIVEN BACK`),
    ])
    this._root?.appendChild(card)
    requestAnimationFrame(() => card.classList.add('show'))
    setTimeout(() => { card.classList.remove('show'); setTimeout(() => card.remove(), 450) }, 3000)
  }

  _after(ms, fn) { const id = setTimeout(fn, ms); this._timers.push(id); return id }

  _teardown() {
    for (const id of this._timers) clearTimeout(id)
    this._timers = []
    this._presence?.classList.remove('show')
    const root = this._root; this._root = null
    this._hud = this._advFill = this._advGhost = this._bossFill = this._bossGhost = this._presence = null
    if (root) setTimeout(() => root.remove(), 700)
  }

  destroy() {
    for (const [e, fn] of this._listeners) EventBus.off(e, fn)
    this._listeners = []
    for (const id of this._timers) clearTimeout(id)
    this._timers = []
    this._root?.remove(); this._root = null
  }
}

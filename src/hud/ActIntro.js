// ActIntro (DOM) — KR P1. The chapter card shown at the start of each act.
//
// Listens for ACT_STARTED { act, def } and slams a centered "ACT N — <name>"
// card with the act's tagline, holds, then fades out. Self-mounts into
// #hud-stage and injects its own CSS once (mirrors EventBanner's self-contained
// pattern). Only constructed when the `acts` feature flag is on (see HudRoot).
//
// The visual is intentionally simple for P1 — a readable chapter title card in
// the Crypt palette. Richer per-act theming / cinematics land with the Champion
// + draft phases (KR P3/P4).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI']

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-actintro-css')) return
  const style = document.createElement('style')
  style.id = 'qf-actintro-css'
  style.textContent = `
.qf-actintro { position:absolute; inset:0; z-index:33; pointer-events:none;
  display:flex; align-items:center; justify-content:center;
  opacity:0; transition:opacity .5s ease; }
.qf-actintro.show { opacity:1; }
.qf-actintro::before { content:''; position:absolute; inset:0;
  background:radial-gradient(circle at 50% 50%, rgba(8,6,16,0) 32%, rgba(4,2,8,.82) 100%); }
.qf-actintro-card { position:relative; text-align:center;
  font-family:'Press Start 2P','Courier New',monospace; padding:28px 40px; }
.qf-actintro-kicker { font-size:clamp(10px,1.3vw,15px); letter-spacing:8px;
  color:#b03a48; text-shadow:0 0 12px rgba(176,58,72,.7); margin-bottom:16px; }
.qf-actintro-title { font-size:clamp(22px,3.4vw,46px); letter-spacing:3px;
  color:#ece2d2; text-shadow:0 0 26px rgba(176,58,72,.5), 0 3px 0 #0a0610;
  animation:qf-actintro-pop .6s cubic-bezier(.18,.9,.25,1) both; }
.qf-actintro-rule { width:0; height:2px; margin:18px auto 16px;
  background:linear-gradient(90deg, transparent, #b03a48, transparent);
  animation:qf-actintro-rule .8s ease-out .3s forwards; }
.qf-actintro-tag { font-family:'VT323',monospace; font-size:clamp(14px,1.6vw,20px);
  letter-spacing:1px; color:#9aa7b4; max-width:640px; margin:0 auto; line-height:1.5;
  opacity:0; animation:qf-actintro-fade .6s ease .5s forwards; }
@keyframes qf-actintro-pop { 0%{opacity:0; transform:scale(.7); filter:blur(6px)}
  60%{opacity:1; transform:scale(1.04); filter:blur(0)} 100%{opacity:1; transform:scale(1)} }
@keyframes qf-actintro-rule { from{width:0} to{width:min(60vw,420px)} }
@keyframes qf-actintro-fade { from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:translateY(0)} }`
  document.head.appendChild(style)
}

export class ActIntro {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._timers = []
    _ensureCss()
    EventBus.on('ACT_STARTED', this._onActStarted, this)
  }

  destroy() {
    EventBus.off('ACT_STARTED', this._onActStarted, this)
    this._clearTimers()
    this._root?.remove(); this._root = null
  }

  _clearTimers() {
    for (const t of this._timers) clearTimeout(t)
    this._timers = []
  }

  _onActStarted({ act, def } = {}) {
    const stage = document.getElementById('hud-stage')
    if (!stage || !def) return
    // Drafted acts (II & III) get the richer "THE KINGDOM RESPONDS" reveal from
    // KingdomResponseIntro instead — defer so there's one set-piece, not two
    // stacked cards. The fixed bookends (Acts I & IV) keep this chapter card.
    if (def.kind === 'drafted') return
    this._clearTimers()
    this._root?.remove()

    this._root = h('div', { className: 'qf-actintro' }, [
      h('div', { className: 'qf-actintro-card' }, [
        h('div', { className: 'qf-actintro-kicker' }, `ACT ${ROMAN[act] || act}`),
        h('div', { className: 'qf-actintro-title' }, def.name || `Act ${act}`),
        h('div', { className: 'qf-actintro-rule' }),
        def.tagline ? h('div', { className: 'qf-actintro-tag' }, def.tagline) : null,
      ]),
    ])
    stage.appendChild(this._root)

    // fade in → hold ~4s → fade out → remove
    this._timers.push(setTimeout(() => this._root?.classList.add('show'), 30))
    this._timers.push(setTimeout(() => this._root?.classList.remove('show'), 4200))
    this._timers.push(setTimeout(() => { this._root?.remove(); this._root = null }, 4900))
  }
}

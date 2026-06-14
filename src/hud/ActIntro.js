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
.qf-actintro { position:absolute; inset:0; z-index:48; pointer-events:auto;
  display:flex; align-items:center; justify-content:center;
  opacity:0; transition:opacity .35s ease; }
.qf-actintro.show { opacity:1; }
.qf-actintro-actions { margin-top:26px; opacity:0;
  animation:qf-actintro-fade .6s ease .8s forwards; }
.qf-actintro-actions .btn { font-size:13px; }
.qf-actintro-hint { margin-top:12px; font-size:9px; letter-spacing:3px; color:#6f6757; }
.qf-actintro::before { content:''; position:absolute; inset:0;
  background:radial-gradient(circle at 50% 46%, rgba(5,3,10,.80) 26%, rgba(2,1,5,.96) 100%); }
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
@keyframes qf-actintro-fade { from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:translateY(0)} }
/* KR P3 overtime flash — Champion survived; the act isn't won. */
.qf-act-overtime { position:absolute; inset:0; z-index:47; pointer-events:none;
  display:flex; align-items:flex-start; justify-content:center; padding-top:14vh;
  opacity:0; transition:opacity .4s ease; }
.qf-act-overtime.show { opacity:1; }
.qf-act-overtime-card { text-align:center; font-family:'Press Start 2P',monospace;
  padding:18px 30px; background:rgba(10,4,6,.72); border:1px solid #b03a48;
  box-shadow:0 0 30px rgba(176,58,72,.5); border-radius:8px; }
.qf-act-overtime-kicker { font-size:clamp(10px,1.2vw,14px); letter-spacing:6px; color:#ff6a78;
  text-shadow:0 0 12px rgba(255,90,100,.7); margin-bottom:12px;
  animation:qf-actintro-pop .5s cubic-bezier(.18,.9,.25,1) both; }
.qf-act-overtime-title { font-size:clamp(16px,2.4vw,30px); letter-spacing:2px; color:#ffe2e4;
  text-shadow:0 0 20px rgba(176,58,72,.6), 0 2px 0 #0a0610; }
.qf-act-overtime-sub { font-family:'VT323',monospace; font-size:clamp(13px,1.5vw,18px);
  color:#d9a7ad; margin-top:10px; }`
  document.head.appendChild(style)
}

export class ActIntro {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._timers = []
    _ensureCss()
    EventBus.on('ACT_STARTED', this._onActStarted, this)
    EventBus.on('ACT_OVERTIME', this._onOvertime, this)
  }

  destroy() {
    EventBus.off('ACT_STARTED', this._onActStarted, this)
    EventBus.off('ACT_OVERTIME', this._onOvertime, this)
    this._clearTimers()
    this._cleanupKey()
    this._root?.remove(); this._root = null
    this._otRoot?.remove(); this._otRoot = null
  }

  // KR P3 — the act's Champion survived its climax day. A brief urgent flash
  // (auto-fades; pointer-events none so it never blocks the end-of-day flow).
  // Act IV variant (2026-06-09): if Aldric wins the duel but the boss has lives
  // left, the same overtime fires for the Hero-King rematch — re-themed copy.
  _onOvertime({ act, days } = {}) {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    this._otRoot?.remove()
    const isAct4 = act === 4
    const kicker = isAct4
      ? (days > 1 ? `REMATCH ×${days}` : 'REMATCH')
      : (days > 1 ? `OVERTIME ×${days}` : 'OVERTIME')
    const title = isAct4 ? 'THE HERO KING RETURNS' : 'THE CHAMPION STILL STANDS'
    const sub = isAct4
      ? 'Aldric rises again — break him, or the crown breaks you.'
      : 'The act is not won. Break them, or the realm breaks you.'
    const root = h('div', { className: 'qf-act-overtime' }, [
      h('div', { className: 'qf-act-overtime-card' }, [
        h('div', { className: 'qf-act-overtime-kicker' }, kicker),
        h('div', { className: 'qf-act-overtime-title' }, title),
        h('div', { className: 'qf-act-overtime-sub' }, sub),
      ]),
    ])
    this._otRoot = root
    stage.appendChild(root)
    this._timers.push(setTimeout(() => root.classList.add('show'), 30))
    this._timers.push(setTimeout(() => root.classList.remove('show'), 3500))
    this._timers.push(setTimeout(() => { root.remove(); if (this._otRoot === root) this._otRoot = null }, 4000))
  }

  _clearTimers() {
    for (const t of this._timers) clearTimeout(t)
    this._timers = []
  }

  _onActStarted({ act, def } = {}) {
    // Dev TEST STAGE — skip the act chapter card (it soft-pauses the scene and
    // slows testing). Still emit ACT_INTRO_DISMISSED so anything waiting on it
    // (e.g. the welcome intro's gate) doesn't hang.
    if (globalThis.__qfDevTestStage) { EventBus.emit('ACT_INTRO_DISMISSED'); return }
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
        h('div', { className: 'qf-actintro-actions' }, [
          h('button', { className: 'btn primary', on: { click: () => this._dismiss() } }, 'CONTINUE'),
          h('div', { className: 'qf-actintro-hint' }, 'PRESS ANY KEY'),
        ]),
      ]),
    ])
    this._root.addEventListener('click', (e) => {
      if (e.target === this._root || e.target.classList?.contains('qf-actintro-card')) this._dismiss()
    })
    stage.appendChild(this._root)

    // Fade in and HOLD until the player continues (CONTINUE / any key / backdrop).
    this._timers.push(setTimeout(() => this._root?.classList.add('show'), 30))
    this._keyFn = (e) => { e.preventDefault(); e.stopPropagation(); this._dismiss() }
    window.addEventListener('keydown', this._keyFn, { capture: true, once: true })
  }

  _dismiss() {
    if (!this._root) return
    this._clearTimers()
    this._cleanupKey()
    // Let the companion's intro (WelcomeIntroOverlay) wait until the player has
    // read + dismissed the act card, so she doesn't talk over it.
    EventBus.emit('ACT_INTRO_DISMISSED')
    this._root.classList.remove('show')
    const el = this._root; this._root = null
    setTimeout(() => el?.remove(), 350)
  }

  _cleanupKey() {
    if (this._keyFn) { window.removeEventListener('keydown', this._keyFn, { capture: true }); this._keyFn = null }
  }
}

// NemesisPortrait (DOM) — KR P2. Aldric's right-side rival portrait: the foil to
// the companion on the left. Slides in from the RIGHT to taunt you while he
// prowls your dungeon, and evolves per act. Listens to NEMESIS_ARRIVED /
// NEMESIS_TAUNT / NEMESIS_ESCALATED. Gated in HudRoot behind the `acts` flag.
//
// PLACEHOLDER ART (per the agreed plan): a styled heroic gold frame with his
// title + act badge + a sword/crown emblem — no baked portrait yet. The real
// detailed evolving portrait (cocky academy kid → scarred → crowned Hero King)
// is a later art task. See DESIGN.md → "Aldric — the Nemesis".

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const ROMAN = ['', 'I', 'II', 'III', 'IV']

// His look shifts across the acts. Placeholder: emblem + accent tint + a mood
// label standing in for the evolving art (cocky → vengeful → obsessed → crowned).
const ACT_LOOK = {
  1: { emblem: '⚔', tint: '#ffd24a', mood: 'THE UPSTART' },
  2: { emblem: '⚔', tint: '#ff9a3a', mood: 'THE AVENGER' },
  3: { emblem: '⚔', tint: '#e0633a', mood: 'THE OBSESSED' },
  4: { emblem: '♛', tint: '#fff0a0', mood: 'THE HERO KING' },
}

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-nemesis-css')) return
  const style = document.createElement('style')
  style.id = 'qf-nemesis-css'
  style.textContent = `
/* Docked just LEFT of the right-side panels and ABOVE the bottom bar so the
   portrait never paints over the action bar or the Dungeon Log (it used to sit
   flush at right:0/bottom:0, z-41, over both). Mirrors the companion's bottom-
   corner placement on the left. */
.qf-nemesis { position:absolute; right:calc(var(--hud-side, 320px) + var(--space-2, 8px));
  bottom:calc(var(--hud-bottom, 116px) + var(--space-2, 8px)); z-index:41; pointer-events:none;
  display:flex; align-items:flex-end; gap:10px; padding:0;
  transform:translateX(118%); transition:transform .5s cubic-bezier(.16,.84,.3,1);
  font-family:'Press Start 2P','Courier New',monospace; }
.qf-nemesis.show { transform:translateX(0); }
/* Speech bubble — sits to the LEFT of the portrait, tail pointing right at him. */
.qf-nemesis-bubble { position:relative; max-width:330px; margin-bottom:64px;
  background:linear-gradient(180deg,#fffdf4,#efe6cf); color:#241a08;
  border:2px solid var(--nem-tint,#ffd24a); border-radius:7px; padding:10px 13px;
  font-family:'VT323',monospace; font-size:19px; line-height:1.32; letter-spacing:.3px;
  box-shadow:0 0 16px rgba(255,200,80,.28), 0 4px 0 rgba(0,0,0,.45);
  opacity:0; transform:translateY(6px) scale(.96); transition:opacity .18s ease, transform .18s ease; }
.qf-nemesis-bubble.on { opacity:1; transform:translateY(0) scale(1); }
.qf-nemesis-bubble::after { content:''; position:absolute; right:-9px; bottom:18px;
  border:8px solid transparent; border-left-color:#efe6cf; border-right:0; }
.qf-nemesis-bubble-name { display:block; font-family:'Press Start 2P',monospace;
  font-size:9px; letter-spacing:1px; color:#7a1f1f; margin-bottom:6px; }
/* Portrait frame — placeholder heroic gold plate. */
.qf-nemesis-portrait { width:150px; height:188px; position:relative;
  background:radial-gradient(120% 90% at 50% 18%, #2a2440 0%, #120e22 70%, #0a0712 100%);
  border:3px solid var(--nem-tint,#ffd24a); border-radius:6px;
  box-shadow:0 0 22px rgba(255,200,80,.35), inset 0 0 26px rgba(255,210,90,.12), 0 6px 0 rgba(0,0,0,.5);
  display:flex; flex-direction:column; align-items:center; justify-content:flex-end;
  overflow:hidden; }
.qf-nemesis-emblem { position:absolute; top:30px; left:50%; transform:translateX(-50%);
  font-size:62px; color:var(--nem-tint,#ffd24a);
  filter:drop-shadow(0 0 12px var(--nem-tint,#ffd24a)); }
.qf-nemesis-plate { width:100%; text-align:center; padding:7px 4px 8px;
  background:linear-gradient(180deg, rgba(8,5,14,0), rgba(8,5,14,.92)); }
.qf-nemesis-actbadge { font-size:7px; letter-spacing:2px; color:var(--nem-tint,#ffd24a);
  text-shadow:0 0 8px var(--nem-tint,#ffd24a); }
.qf-nemesis-name { font-size:9px; letter-spacing:.5px; color:#ece2d2; margin-top:5px;
  line-height:1.4; text-shadow:0 1px 0 #000; }
.qf-nemesis-mood { font-size:8px; letter-spacing:1.5px; color:#9aa7b4; margin-top:5px; }
.qf-nemesis-ph { position:absolute; bottom:46px; left:50%; transform:translateX(-50%);
  font-family:'VT323',monospace; font-size:11px; color:#5a5470; letter-spacing:1px; }`
  document.head.appendChild(style)
}

export class NemesisPortrait {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._bubbleEl = null
    this._bubbleTimer = null
    this._hideTimer = null
    this._listeners = []
    _ensureCss()
    this._build()
    this._on('NEMESIS_ARRIVED',     p => this._onArrive(p))
    this._on('NEMESIS_TAUNT',       p => this._onTaunt(p))
    this._on('NEMESIS_ESCALATED',   p => this._render(p.act))
    // Hide the card the instant he leaves the dungeon (fled/withdrew) — it used
    // to linger until day-end even after he was gone.
    this._on('NEMESIS_DEPARTED',    () => this._slideOut())
    this._on('DAY_PHASE_ENDED',     () => this._slideOut())
    this._on('NIGHT_PHASE_STARTED', () => this._slideOut())
    // The Act IV duel cinematic (AldricCinematic) takes over the screen and IS
    // Aldric — slide the rival card out so it doesn't compete/overlap with it.
    this._on('ALDRIC_DUEL_BEGAN',   () => this._slideOut())
  }

  _on(evt, fn) { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._clearTimers()
    this._root?.remove(); this._root = null
  }

  _clearTimers() {
    clearTimeout(this._bubbleTimer); this._bubbleTimer = null
    clearTimeout(this._hideTimer);   this._hideTimer = null
  }

  _build() {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    this._root = h('div', { className: 'qf-nemesis' }, [
      this._bubbleEl = h('div', { className: 'qf-nemesis-bubble' }),
      h('div', { className: 'qf-nemesis-portrait', ref: el => (this._portraitEl = el) }, [
        h('div', { className: 'qf-nemesis-emblem', ref: el => (this._emblemEl = el) }, '⚔'),
        h('div', { className: 'qf-nemesis-ph' }, '[ portrait ]'),
        h('div', { className: 'qf-nemesis-plate' }, [
          h('div', { className: 'qf-nemesis-actbadge', ref: el => (this._badgeEl = el) }, 'ACT I'),
          h('div', { className: 'qf-nemesis-name',     ref: el => (this._nameEl  = el) }, 'Aldric'),
          h('div', { className: 'qf-nemesis-mood',     ref: el => (this._moodEl  = el) }, 'THE UPSTART'),
        ]),
      ]),
    ])
    stage.appendChild(this._root)
    this._render(this._gs?.meta?.nemesis?.act ?? 1)
  }

  // Repaint his evolving look for the given act.
  _render(act) {
    const a = Math.max(1, Math.min(4, act | 0 || 1))
    const look = ACT_LOOK[a] || ACT_LOOK[1]
    const n = this._gs?.meta?.nemesis
    if (this._root) this._root.style.setProperty('--nem-tint', look.tint)
    if (this._emblemEl) this._emblemEl.textContent = look.emblem
    if (this._badgeEl)  this._badgeEl.textContent  = `ACT ${ROMAN[a] || a}`
    if (this._nameEl)   this._nameEl.textContent   = n?.name ?? 'Aldric'
    if (this._moodEl)   this._moodEl.textContent   = look.mood
  }

  _slideIn()  { this._root?.classList.add('show') }
  _slideOut() { this._clearTimers(); this._bubbleEl?.classList.remove('on'); this._root?.classList.remove('show') }

  _onArrive({ act } = {}) {
    if (act) this._render(act)
    this._clearTimers()
    this._slideIn()
  }

  _onTaunt({ line, act, source } = {}) {
    if (!line) return
    if (act) this._render(act)
    this._slideIn()
    // show the bubble
    if (this._bubbleEl) {
      this._bubbleEl.replaceChildren(
        h('span', { className: 'qf-nemesis-bubble-name' }, (this._gs?.meta?.nemesis?.name ?? 'Aldric').toUpperCase()),
        document.createTextNode(line),
      )
      this._bubbleEl.classList.add('on')
    }
    clearTimeout(this._bubbleTimer)
    this._bubbleTimer = setTimeout(() => this._bubbleEl?.classList.remove('on'), 4200)
    // A withdrawal / between-act taunt means he's leaving — slide back out after.
    if (source === 'withdraw' || source === 'act_cleared') {
      clearTimeout(this._hideTimer)
      this._hideTimer = setTimeout(() => this._slideOut(), 4600)
    }
  }
}

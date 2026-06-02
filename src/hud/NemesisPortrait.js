// NemesisPortrait (DOM) — Aldric's rival corner portrait (KR P2). The foil to
// the companion on the LEFT: Aldric peeks into the lower-RIGHT of the dungeon
// view and CROSS-FADES expressions as he taunts (mirrors NpcCompanion). His look
// evolves per act; per-act portrait art lives in assets/npc-aldric/act<N>/ (baked
// by tools/bake-aldric-portraits.mjs). Acts without art yet fall back to a styled
// placeholder frame. Slides in from the RIGHT on arrival, out on the duel /
// withdrawal / phase change. Gated in HudRoot behind the `acts` flag.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const ROMAN   = ['', 'I', 'II', 'III', 'IV']
const FADE_MS  = 380
const BUBBLE_MS = 4200

// Per-act look — tint + emblem + mood label (drives the placeholder frame for
// acts without art yet, plus the bubble accent / name plate everywhere).
const ACT_LOOK = {
  1: { emblem: '⚔', tint: '#ffd24a', mood: 'THE UPSTART' },
  2: { emblem: '⚔', tint: '#ff9a3a', mood: 'THE AVENGER' },
  3: { emblem: '⚔', tint: '#e0633a', mood: 'THE OBSESSED' },
  4: { emblem: '♛', tint: '#fff0a0', mood: 'THE HERO KING' },
}

// Per-act portrait art. Only acts present here render the cross-fading portrait;
// the rest show the placeholder frame. `rest` is his resting/idle expression.
const ALDRIC_ART = {
  1: {
    dir: 'assets/npc-aldric/act1/',
    expressions: ['idle', 'cocky', 'confident', 'cocky-vow', 'sneering', 'contempt', 'rattled', 'annoyed', 'enraged'],
    rest: 'cocky',
  },
}

// Taunt `source` → the expression that fits that beat. Resolved against the act's
// vocab; an act whose art lacks the expression falls back to its rest face.
const SOURCE_EXPR = {
  arrive:      'cocky',
  taunt:       'confident',
  recoil:      'cocky-vow',
  withdraw:    'cocky-vow',
  act_cleared: 'confident',
  banter:      'contempt',
  hurt:        'rattled',
  minionKill:  'cocky',
}

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-nemesis-css')) return
  const style = document.createElement('style')
  style.id = 'qf-nemesis-css'
  style.textContent = `
/* Lower-RIGHT corner presence — the mirror of the companion on the left. The
   whole rig slides in from off the right edge; the portrait sits just left of the
   320px right panel. pointer-events:none so only the bubble is interactive. */
.qf-nemesis { position:absolute; right:0; bottom:0; width:560px; height:560px; z-index:8;
  pointer-events:none; --nem-tint:#ffd24a;
  transform:translateX(112%); transition:transform .5s cubic-bezier(.16,.84,.3,1);
  font-family:'Press Start 2P','Courier New',monospace; }
.qf-nemesis.show { transform:translateX(0); }

/* Portrait box — two stacked <img> layers cross-fade between expressions. Sits
   just left of the right panel (mirror of the companion's left:326). */
.qf-nemesis-portrait { position:absolute; right:326px; bottom:0; width:236px; height:350px;
  filter:drop-shadow(0 5px 12px rgba(0,0,0,.65));
  animation:qf-nemesis-bob 4.6s ease-in-out infinite; transform-origin:50% 100%; }
.qf-nemesis-img { position:absolute; inset:0; width:100%; height:100%;
  object-fit:contain; object-position:bottom center; opacity:0; transition:opacity .42s ease;
  user-select:none; -webkit-user-drag:none; pointer-events:none; }
.qf-nemesis-img.front { opacity:1; }
/* Art mode hides the placeholder; no-art mode hides the imgs. */
.qf-nemesis .qf-nemesis-img       { display:none; }
.qf-nemesis.has-art .qf-nemesis-img { display:block; }
.qf-nemesis.has-art .qf-nemesis-ph  { display:none; }

/* Placeholder frame (acts without art yet) — the old heroic plate. */
.qf-nemesis-ph { position:absolute; right:0; bottom:0; width:150px; height:188px;
  background:radial-gradient(120% 90% at 50% 18%, #2a2440 0%, #120e22 70%, #0a0712 100%);
  border:3px solid var(--nem-tint,#ffd24a); border-radius:6px;
  box-shadow:0 0 22px rgba(255,200,80,.35), inset 0 0 26px rgba(255,210,90,.12), 0 6px 0 rgba(0,0,0,.5);
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; }
.qf-nemesis-ph-emblem { font-size:54px; color:var(--nem-tint,#ffd24a);
  filter:drop-shadow(0 0 12px var(--nem-tint,#ffd24a)); }
.qf-nemesis-ph-text { font-family:'VT323',monospace; font-size:12px; color:#5a5470; letter-spacing:1px; }

/* Speech bubble — sits to the LEFT of the portrait, tail pointing right at him. */
.qf-nemesis-bubble { position:absolute; right:560px; bottom:236px; max-width:320px;
  pointer-events:auto;
  background:linear-gradient(180deg,#fffdf4,#efe6cf); color:#241a08;
  border:2px solid var(--nem-tint,#ffd24a); border-radius:7px; padding:11px 14px;
  font-family:'VT323',monospace; font-size:19px; line-height:1.32; letter-spacing:.3px;
  box-shadow:0 0 16px rgba(255,200,80,.28), 0 4px 0 rgba(0,0,0,.45);
  opacity:0; transform:translateY(6px) scale(.96); transition:opacity .18s ease, transform .18s ease; }
.qf-nemesis-bubble.on { opacity:1; transform:translateY(0) scale(1); }
.qf-nemesis-bubble::after { content:''; position:absolute; right:-9px; bottom:22px;
  border:8px solid transparent; border-left-color:#efe6cf; border-right:0; }
.qf-nemesis-bubble-name { display:block; font-family:'Press Start 2P',monospace;
  font-size:9px; letter-spacing:1px; color:#7a1f1f; margin-bottom:7px; }

@keyframes qf-nemesis-bob { 0%,100%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-5px) rotate(.6deg)} }`
  document.head.appendChild(style)
}

export class NemesisPortrait {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._bubbleEl = null
    this._bubbleTimer = null
    this._hideTimer = null
    this._fadeTimer = null
    this._listeners = []
    // cross-fade state
    this._dir = null
    this._expressions = []
    this._rest = 'idle'
    this._curExpr = null
    this._frontIsA = true
    this._exprToken = 0
    _ensureCss()
    this._build()
    this._on('NEMESIS_ARRIVED',     p => this._onArrive(p))
    this._on('NEMESIS_TAUNT',       p => this._onTaunt(p))
    this._on('NEMESIS_ESCALATED',   p => this._render(p.act))
    this._on('NEMESIS_DEPARTED',    () => this._slideOut())
    this._on('DAY_PHASE_ENDED',     () => this._slideOut())
    this._on('NIGHT_PHASE_STARTED', () => this._slideOut())
    // The Act IV duel cinematic (AldricCinematic) IS Aldric — slide the rival
    // card out so it doesn't compete with it.
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
    clearTimeout(this._fadeTimer);   this._fadeTimer = null
  }

  _build() {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    this._imgA = h('img', { className: 'qf-nemesis-img', alt: '', draggable: 'false' })
    this._imgB = h('img', { className: 'qf-nemesis-img', alt: '', draggable: 'false' })
    this._ph = h('div', { className: 'qf-nemesis-ph' }, [
      h('div', { className: 'qf-nemesis-ph-emblem', ref: el => (this._phEmblem = el) }, '⚔'),
      h('div', { className: 'qf-nemesis-ph-text' }, '[ portrait ]'),
    ])
    this._portraitEl = h('div', { className: 'qf-nemesis-portrait' }, [this._imgA, this._imgB, this._ph])
    this._bubbleEl   = h('div', { className: 'qf-nemesis-bubble' })
    this._root = h('div', { className: 'qf-nemesis' }, [this._bubbleEl, this._portraitEl])
    stage.appendChild(this._root)
    this._render(this._gs?.meta?.nemesis?.act ?? 1)
  }

  // Repaint his evolving look (tint + art set) for the given act.
  _render(act) {
    const a = Math.max(1, Math.min(4, act | 0 || 1))
    const look = ACT_LOOK[a] || ACT_LOOK[1]
    if (this._root) this._root.style.setProperty('--nem-tint', look.tint)
    const art = ALDRIC_ART[a]
    if (art) {
      this._dir = art.dir
      this._expressions = art.expressions
      this._rest = art.rest
      this._root?.classList.add('has-art')
      this._preload()
      this._curExpr = null
      this._setExpression(this._rest)
    } else {
      this._dir = null
      this._root?.classList.remove('has-art')
      if (this._phEmblem) this._phEmblem.textContent = look.emblem
    }
  }

  _preload() {
    if (!this._dir) return
    for (const id of this._expressions) { const im = new Image(); im.src = this._dir + id + '.webp' }
  }

  // Cross-fade to `expr` (mirrors NpcCompanion). Falls back to the rest face if
  // the current act's art lacks the requested expression.
  _setExpression(expr) {
    if (!this._dir || !expr) return
    if (!this._expressions.includes(expr)) expr = this._rest
    if (expr === this._curExpr) return
    this._curExpr = expr
    const token = ++this._exprToken
    const back  = this._frontIsA ? this._imgB : this._imgA
    const front = this._frontIsA ? this._imgA : this._imgB
    const swap = () => {
      if (token !== this._exprToken) return
      back.classList.add('front')
      front.classList.remove('front')
      this._frontIsA = !this._frontIsA
    }
    back.onload = swap
    back.src = this._dir + expr + '.webp'
    if (back.complete && back.naturalWidth) swap()
  }

  _exprFor(source) { return SOURCE_EXPR[source] ?? this._rest }

  _slideIn()  { this._root?.classList.add('show') }
  _slideOut() {
    this._clearTimers()
    this._bubbleEl?.classList.remove('on')
    this._root?.classList.remove('show')
  }

  _onArrive({ act } = {}) {
    if (act) this._render(act)
    this._clearTimers()
    this._setExpression(this._exprFor('arrive'))
    this._slideIn()
  }

  _onTaunt({ line, act, source } = {}) {
    if (!line) return
    if (act) this._render(act)
    this._slideIn()
    this._setExpression(this._exprFor(source))
    if (this._bubbleEl) {
      this._bubbleEl.replaceChildren(
        h('span', { className: 'qf-nemesis-bubble-name' }, (this._gs?.meta?.nemesis?.name ?? 'Aldric').toUpperCase()),
        document.createTextNode(line),
      )
      this._bubbleEl.classList.add('on')
    }
    clearTimeout(this._bubbleTimer)
    this._bubbleTimer = setTimeout(() => {
      this._bubbleEl?.classList.remove('on')
      // settle back to his resting face a beat after the bubble closes
      clearTimeout(this._fadeTimer)
      this._fadeTimer = setTimeout(() => this._setExpression(this._rest), FADE_MS)
    }, BUBBLE_MS)
    // A withdrawal / between-act taunt means he's leaving — slide back out after.
    if (source === 'withdraw' || source === 'act_cleared') {
      clearTimeout(this._hideTimer)
      this._hideTimer = setTimeout(() => this._slideOut(), 4600)
    }
  }
}

// AldricCinematic (DOM) — KR P2-polish. The presentation layer of the Act IV
// climax: the boss vs Aldric, the crowned Hero King.
//
// Pure presentation (the kinetic choreography + HP feed live in BossSystem's
// _runNemesisDuel / _tickNemesisDuel). This owns: the VS slam-in, a two-bar
// duel HP header (HERO KING ALDRIC vs THE BOSS), named beat flashes (his
// abilities + clashes + the signature moments), a form-themed "presence"
// backdrop (the slain watching for a brutal run, motes of light for a merciful
// one), and the win/loss finale. THEMED by his adaptive form — a brutal run
// forges a crimson "Vengeful Crown", a merciful one a gold "Radiant Hope".
//
// Driven by events: ALDRIC_DUEL_BEGAN / _HP / _BEAT / _END. No INFINITE CSS
// animations (those hang preview_screenshot — see VISUAL_STANDARDS §4).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { HudSfx } from './HudSfx.js'

// Per-form theming. `--acc` is the side/glow colour; `--acc2` the highlight.
const FORM_THEME = {
  desperate: { acc: '#ff3b46', acc2: '#ff8a78', kicker: 'THE VENGEFUL CROWN', presence: 'ghosts' },
  radiant:   { acc: '#ffd76a', acc2: '#fff3cf', kicker: 'THE RADIANT HOPE',   presence: 'motes'  },
}
const DEFAULT_THEME = { acc: '#e8c860', acc2: '#fff3cf', kicker: 'THE HERO KING', presence: 'motes' };

// Beat → label + flavour class. The choreography fires these by `kind`.
const BEAT = {
  clash:          { label: null,             cls: 'clash' },
  bladelock:      { label: 'BLADE-LOCK',     cls: 'lock'  },
  dawnblade:      { label: 'DAWNBLADE',      cls: 'aldric' },
  heroic_resolve: { label: 'HEROIC RESOLVE', cls: 'aldric' },
  hero_king:      { label: 'HERO KING',      cls: 'apex'  },
  boss_ult:       { label: null,             cls: 'boss'  },   // label supplied per archetype
  knockback:      { label: null,             cls: 'boss'  },
  surge:          { label: 'THE TIDE TURNS', cls: 'turn'  },
}

// Aldric's reacting duel portrait (lower-LEFT, his side of the VS). The fight
// carries its text via the beat labels, so the portrait has NO bubble — instead
// his FACE tells the story: a base mood set by his HP band, with a transient
// combat face punched in on every beat. His Act-4 emotion set, baked to
// assets/npc-aldric/act4/ by tools/bake-aldric-portraits.mjs.
const ALD_FACE_DIR = 'assets/npc-aldric/act4/'
const ALD_FACES = ['idle', 'obsessive-taunt', 'battle-joy', 'obsessed-attack', 'wrath',
  'obsessed-desperate', 'unhinged-grin', 'unhinged-dying', 'hurt']
const ALD_FACE_HOLD_MS = 1400   // how long a beat face holds before settling to his HP-band mood
// Duel beat → the face it punches in. (finalblow has no entry — the END card
// sets the decisive face: dying if he falls, battle-joy if he stands.)
const ALD_BEAT_FACE = {
  clash:          'battle-joy',
  dawnblade:      'obsessed-attack',
  boss_ult:       'wrath',
  bladelock:      'wrath',
  knockback:      'hurt',
  heroic_resolve: 'obsessed-desperate',
  surge:          'unhinged-grin',
  hero_king:      'obsessed-attack',
}

// Exported so the RivalShowdownCinematic can reuse the same qf-ald-* duel styling.
export function ensureDuelCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-aldric-duel-css')) return
  const style = document.createElement('style')
  style.id = 'qf-aldric-duel-css'
  style.textContent = `
.qf-ald-root { --acc:#e8c860; --acc2:#fff3cf; position:absolute; inset:0; pointer-events:none;
  z-index:35; font-family:'Press Start 2P','Courier New',monospace; }
/* Presence backdrop — a faint, form-themed vignette of watchers at the edges. */
.qf-ald-presence { position:absolute; inset:0; z-index:32; pointer-events:none; opacity:0;
  transition:opacity 1s ease; }
.qf-ald-presence.show { opacity:1; }
.qf-ald-presence.ghosts {
  background:
    radial-gradient(60% 40% at 8% 60%, rgba(120,30,40,.20), transparent 70%),
    radial-gradient(60% 40% at 92% 60%, rgba(120,30,40,.20), transparent 70%),
    radial-gradient(3px 3px at 12% 40%, rgba(255,120,120,.5), transparent 60%),
    radial-gradient(2px 2px at 88% 46%, rgba(255,120,120,.5), transparent 60%),
    radial-gradient(2px 2px at 6% 70%, rgba(255,120,120,.4), transparent 60%),
    radial-gradient(2px 2px at 94% 72%, rgba(255,120,120,.4), transparent 60%); }
.qf-ald-presence.motes {
  background:
    radial-gradient(55% 40% at 8% 55%, rgba(255,215,120,.16), transparent 70%),
    radial-gradient(55% 40% at 92% 55%, rgba(255,215,120,.16), transparent 70%),
    radial-gradient(2px 2px at 14% 36%, rgba(255,240,190,.6), transparent 60%),
    radial-gradient(2px 2px at 86% 42%, rgba(255,240,190,.6), transparent 60%),
    radial-gradient(2px 2px at 10% 66%, rgba(255,240,190,.5), transparent 60%),
    radial-gradient(2px 2px at 90% 70%, rgba(255,240,190,.5), transparent 60%); }
/* Two-bar duel header. */
.qf-ald-hud { position:absolute; top:calc(var(--hud-top,96px) + 10px); left:50%; transform:translateX(-50%);
  z-index:35; display:flex; align-items:center; gap:18px; opacity:0; transition:opacity .5s ease; }
.qf-ald-hud.show { opacity:1; }
.qf-ald-side { display:flex; flex-direction:column; gap:7px; width:min(40vw,470px); }
.qf-ald-side.right { align-items:flex-end; }
.qf-ald-name { font-size:clamp(10px,1.4vw,16px); letter-spacing:2px; white-space:nowrap; }
.qf-ald-side.left  .qf-ald-name { color:var(--acc2); text-shadow:0 0 10px var(--acc); }
.qf-ald-side.right .qf-ald-name { color:#ffc2b8; text-shadow:0 0 10px rgba(255,80,60,.8); }
.qf-ald-track { width:100%; height:26px; background:rgba(6,4,10,.85); position:relative; overflow:hidden;
  border:3px solid rgba(180,150,90,.5); border-radius:3px; box-shadow:0 0 16px rgba(180,140,70,.35); }
.qf-ald-fill { position:absolute; top:0; bottom:0; width:100%; transition:width .16s linear; }
.qf-ald-side.left  .qf-ald-fill { left:0;  background:linear-gradient(90deg, color-mix(in srgb,var(--acc) 55%, #000), var(--acc)); }
.qf-ald-side.right .qf-ald-fill { right:0; background:linear-gradient(270deg,#5a0a0a,#ff5544); }
/* the "ghost" trail that lags behind the fill, so a big hit reads as a chunk lost */
.qf-ald-ghost { position:absolute; top:0; bottom:0; width:100%; opacity:.4; transition:width .5s ease .12s; }
.qf-ald-side.left  .qf-ald-ghost { left:0;  background:var(--acc2); }
.qf-ald-side.right .qf-ald-ghost { right:0; background:#ffb0a4; }
.qf-ald-vs { font-size:clamp(16px,2.2vw,30px); color:#f3e8cf; text-shadow:0 0 12px var(--acc); }
/* Screen pulse + centered beat label. */
.qf-ald-pulse { position:absolute; inset:0; z-index:33; pointer-events:none; opacity:0;
  animation:qf-ald-pulse .75s ease-out forwards; }
.qf-ald-pulse.aldric { background:radial-gradient(circle at 50% 55%, transparent 40%, color-mix(in srgb,var(--acc) 34%, transparent) 100%);
  box-shadow:inset 0 0 130px 44px color-mix(in srgb,var(--acc) 42%, transparent); }
.qf-ald-pulse.boss   { background:radial-gradient(circle at 50% 55%, rgba(255,42,30,0) 40%, rgba(255,42,30,.32) 100%);
  box-shadow:inset 0 0 130px 44px rgba(255,42,30,.46); }
.qf-ald-pulse.apex   { background:radial-gradient(circle at 50% 50%, color-mix(in srgb,var(--acc2) 30%, transparent) 0%, color-mix(in srgb,var(--acc) 40%, transparent) 100%);
  box-shadow:inset 0 0 180px 70px color-mix(in srgb,var(--acc) 55%, transparent); }
.qf-ald-pulse.turn   { background:radial-gradient(circle at 50% 55%, transparent 38%, rgba(255,255,255,.3) 100%); }
.qf-ald-pulse.lock   { background:radial-gradient(circle at 50% 52%, color-mix(in srgb,var(--acc) 22%, transparent) 0%, transparent 60%); }
@keyframes qf-ald-pulse { 0%{opacity:0} 20%{opacity:1} 100%{opacity:0} }
.qf-ald-flash { position:absolute; inset:0; z-index:37; pointer-events:none; background:#fff; opacity:0;
  animation:qf-ald-flash .42s ease-out forwards; }
@keyframes qf-ald-flash { 0%{opacity:0} 8%{opacity:.85} 100%{opacity:0} }
.qf-ald-beat { position:absolute; left:0; right:0; top:26%; text-align:center; z-index:36; pointer-events:none;
  font-size:clamp(16px,2.7vw,38px); letter-spacing:4px; opacity:0; }
.qf-ald-beat.aldric { color:var(--acc2); text-shadow:0 0 20px var(--acc), 0 2px 0 #1a1004; }
.qf-ald-beat.boss   { color:#ffd2ca; text-shadow:0 0 20px rgba(255,64,40,.95), 0 2px 0 #1a0202; }
.qf-ald-beat.apex   { color:#ffffff; font-size:clamp(22px,3.6vw,52px); text-shadow:0 0 28px var(--acc), 0 0 60px var(--acc2), 0 3px 0 #1a1004; }
.qf-ald-beat.lock   { color:var(--acc2); text-shadow:0 0 16px var(--acc); }
.qf-ald-beat.turn   { color:#fff; text-shadow:0 0 22px rgba(255,255,255,.9); }
.qf-ald-beat.show { animation:qf-ald-beat 1.6s cubic-bezier(.2,.9,.2,1) forwards; }
@keyframes qf-ald-beat { 0%{opacity:0; transform:scale(.7)} 15%{opacity:1; transform:scale(1.08)}
  74%{opacity:1; transform:scale(1)} 100%{opacity:0; transform:scale(1)} }
/* Entrance VS slam + finale (reuse one stack). */
.qf-ald-card { position:absolute; inset:0; z-index:38; pointer-events:none; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:12px; opacity:0; transition:opacity .4s ease; }
.qf-ald-card.show { opacity:1; }
.qf-ald-card::before { content:''; position:absolute; inset:0;
  background:radial-gradient(circle at 50% 50%, transparent 26%, rgba(2,2,6,.78) 100%); }
.qf-ald-card-kicker { position:relative; font-size:clamp(9px,1.1vw,13px); letter-spacing:6px; color:var(--acc);
  text-shadow:0 0 14px var(--acc); }
.qf-ald-card-row { position:relative; display:flex; align-items:center; gap:22px; }
.qf-ald-card-side { font-size:clamp(14px,2.2vw,30px); letter-spacing:2px;
  animation:qf-ald-card-pop .6s cubic-bezier(.18,.9,.25,1) both; }
.qf-ald-card-side.left  { color:var(--acc2); text-shadow:0 0 22px var(--acc), 0 3px 0 #1a1004; }
.qf-ald-card-side.right { color:#ffc2b8; text-shadow:0 0 22px rgba(255,80,60,.9), 0 3px 0 #1a0202; }
.qf-ald-card-vs { position:relative; font-size:clamp(20px,3vw,40px); color:#fff; text-shadow:0 0 18px var(--acc); }
.qf-ald-card-title { position:relative; font-size:clamp(22px,3.6vw,52px); letter-spacing:3px; color:#fff3cf;
  text-shadow:0 0 30px var(--acc), 0 3px 0 #1a1004; animation:qf-ald-card-pop .7s cubic-bezier(.18,.9,.25,1) both; }
.qf-ald-card-sub { position:relative; font-size:clamp(9px,1.2vw,15px); letter-spacing:3px; color:#d9cdb6; }
@keyframes qf-ald-card-pop { 0%{opacity:0; transform:scale(.6); filter:blur(7px)}
  60%{opacity:1; transform:scale(1.05); filter:blur(0)} 100%{opacity:1; transform:scale(1)} }
/* Aldric's reacting portrait — lower-LEFT (his side of the VS). Two stacked
   <img> layers cross-fade between his Act-4 combat faces; slides in from the left
   under the HUD header. pointer-events:none — purely presentational. */
.qf-ald-figure { position:absolute; left:0; bottom:0; z-index:34; pointer-events:none;
  width:clamp(180px,21vw,300px); height:clamp(300px,50vh,470px);
  transform:translateX(-118%); transition:transform .7s cubic-bezier(.16,.84,.3,1);
  filter:drop-shadow(0 6px 16px rgba(0,0,0,.7)); }
.qf-ald-figure.show { transform:translateX(0); }
.qf-ald-figure-img { position:absolute; inset:0; width:100%; height:100%;
  object-fit:contain; object-position:bottom left; opacity:0; transition:opacity .34s ease;
  user-select:none; -webkit-user-drag:none; }
.qf-ald-figure-img.front { opacity:1; }
/* a soft form-tinted glow rising from his feet, behind the figure */
.qf-ald-figure::before { content:''; position:absolute; left:0; bottom:0; width:82%; height:48%; z-index:-1;
  background:radial-gradient(58% 80% at 32% 100%, color-mix(in srgb,var(--acc) 42%, transparent), transparent 72%);
  filter:blur(7px); }`
  document.head.appendChild(style)
}

export class AldricCinematic {
  constructor() {
    this._stage = document.getElementById('hud-stage')
    this._listeners = []
    this._timers = []
    this._root = null
    this._hud = null; this._advFill = null; this._advGhost = null; this._bossFill = null; this._bossGhost = null
    this._presence = null
    this._theme = DEFAULT_THEME
    // Reacting-portrait state.
    this._figure = null; this._figA = null; this._figB = null
    this._figFrontA = true; this._figExpr = null; this._figToken = 0
    this._figHolding = false; this._figHoldToken = 0; this._advFrac = 1
    if (!this._stage) return
    ensureDuelCss()
    this._wire()
  }

  _wire() {
    const sub = (e, fn) => { EventBus.on(e, fn); this._listeners.push([e, fn]) }
    sub('ALDRIC_DUEL_BEGAN', (p) => this._onBegan(p ?? {}))
    sub('ALDRIC_DUEL_HP',    (p) => this._onHp(p ?? {}))
    sub('ALDRIC_DUEL_BEAT',  (p) => this._onBeat(p ?? {}))
    sub('ALDRIC_DUEL_END',   (p) => this._onEnd(p ?? {}))
    sub('DAY_PHASE_ENDED',   () => this._teardown())
  }

  _onBegan({ name = 'ALDRIC', bossName = 'THE BOSS', form } = {}) {
    this._teardown()
    this._theme = FORM_THEME[form] ?? DEFAULT_THEME
    this._aldricName = String(name).toUpperCase()
    this._bossName = String(bossName).toUpperCase()
    this._root = h('div', { className: 'qf-ald-root', style: { '--acc': this._theme.acc, '--acc2': this._theme.acc2 } })
    this._stage.appendChild(this._root)
    this._buildPresence()
    this._buildFigure()
    this._buildHud()
    this._playEntrance()
    // He strides in sneering — the obsessive opener face holds, then settles to
    // his (full-HP) ready stance before the first clash.
    this._advFrac = 1
    this._beatFace('obsessive-taunt')
  }

  // His reacting portrait: two cross-fading <img> layers on his side of the VS.
  _buildFigure() {
    this._figA = h('img', { className: 'qf-ald-figure-img', alt: '', draggable: 'false' })
    this._figB = h('img', { className: 'qf-ald-figure-img', alt: '', draggable: 'false' })
    this._figure = h('div', { className: 'qf-ald-figure' }, [this._figA, this._figB])
    this._root.appendChild(this._figure)
    this._figFrontA = true; this._figExpr = null; this._figToken = 0; this._figHolding = false
    this._preloadFaces()
    this._setFace('obsessive-taunt')   // entrance face (no idle flash)
    requestAnimationFrame(() => this._figure?.classList.add('show'))
  }

  _preloadFaces() { for (const id of ALD_FACES) { const im = new Image(); im.src = ALD_FACE_DIR + id + '.webp' } }

  // Cross-fade to `expr` (mirrors the corner portrait / companion swap).
  _setFace(expr) {
    if (!this._figure || !expr) return
    if (!ALD_FACES.includes(expr)) expr = 'idle'
    if (expr === this._figExpr) return
    this._figExpr = expr
    const token = ++this._figToken
    const back  = this._figFrontA ? this._figB : this._figA
    const front = this._figFrontA ? this._figA : this._figB
    const swap = () => {
      if (token !== this._figToken) return
      back.classList.add('front'); front.classList.remove('front'); this._figFrontA = !this._figFrontA
    }
    back.onload = swap
    back.src = ALD_FACE_DIR + expr + '.webp'
    if (back.complete && back.naturalWidth) swap()
  }

  // His resting mood between beats, escalating as his HP falls: ready → desperate
  // → dying. (Drives the face whenever a beat face isn't actively held.)
  _baseFace() {
    const f = this._advFrac ?? 1
    return f >= 0.6 ? 'idle' : f >= 0.35 ? 'obsessed-desperate' : 'unhinged-dying'
  }

  // Punch in a transient combat face for a beat, then settle back to his HP-band
  // mood. A later beat (or the END) supersedes via the hold token.
  _beatFace(expr) {
    this._setFace(expr)
    this._figHolding = true
    const tok = ++this._figHoldToken
    this._after(ALD_FACE_HOLD_MS, () => {
      if (tok !== this._figHoldToken) return
      this._figHolding = false
      this._setFace(this._baseFace())
    })
  }

  _buildPresence() {
    this._presence = h('div', { className: `qf-ald-presence ${this._theme.presence}` })
    this._root.appendChild(this._presence)
    requestAnimationFrame(() => this._presence?.classList.add('show'))
  }

  _buildHud() {
    this._advFill  = h('div', { className: 'qf-ald-fill' })
    this._advGhost = h('div', { className: 'qf-ald-ghost' })
    this._bossFill = h('div', { className: 'qf-ald-fill' })
    this._bossGhost= h('div', { className: 'qf-ald-ghost' })
    this._hud = h('div', { className: 'qf-ald-hud' }, [
      h('div', { className: 'qf-ald-side left' }, [
        h('div', { className: 'qf-ald-name' }, this._aldricName),
        h('div', { className: 'qf-ald-track' }, [this._advGhost, this._advFill]),
      ]),
      h('div', { className: 'qf-ald-vs' }, 'VS'),
      h('div', { className: 'qf-ald-side right' }, [
        h('div', { className: 'qf-ald-name' }, this._bossName),
        h('div', { className: 'qf-ald-track' }, [this._bossGhost, this._bossFill]),
      ]),
    ])
    this._root.appendChild(this._hud)
    this._after(2200, () => this._hud?.classList.add('show'))   // header rises after the VS card
  }

  _playEntrance() {
    const card = h('div', { className: 'qf-ald-card' }, [
      h('div', { className: 'qf-ald-card-kicker' }, `THE RECKONING · ${this._theme.kicker}`),
      h('div', { className: 'qf-ald-card-row' }, [
        h('div', { className: 'qf-ald-card-side left' }, this._aldricName),
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
    if (this._bossGhost)this._bossGhost.style.width= b
    // His face tracks his own HP — but only when a beat face isn't being held.
    this._advFrac = advFrac
    if (!this._figHolding) this._setFace(this._baseFace())
  }

  _onBeat({ kind, label } = {}) {
    // Cinematic apex stingers (P2-1) — fired BEFORE the `def` guard below so
    // the final blow (which has no BEAT entry) still cues. Layered over the
    // SfxSystem combat hit; dormant until the audio files are added.
    if (kind === 'bladelock')      HudSfx.playUi('cin_bladelock')
    else if (kind === 'finalblow') HudSfx.playUi('cin_finalblow')
    const face = ALD_BEAT_FACE[kind]
    if (face) this._beatFace(face)
    const def = BEAT[kind]
    if (!def || !this._root) return
    // screen pulse
    const pulse = h('div', { className: `qf-ald-pulse ${def.cls}` })
    this._root.appendChild(pulse)
    this._after(820, () => pulse.remove())
    // a white flash on the heaviest beats (apex / the final blow)
    if (def.cls === 'apex' || kind === 'finalblow') {
      const flash = h('div', { className: 'qf-ald-flash' })
      this._root.appendChild(flash)
      this._after(450, () => flash.remove())
    }
    // centered label
    const text = label || def.label
    if (text) {
      const lbl = h('div', { className: `qf-ald-beat ${def.cls}` }, String(text).toUpperCase())
      this._root.appendChild(lbl)
      requestAnimationFrame(() => lbl.classList.add('show'))
      this._after(1650, () => lbl.remove())
    }
  }

  _onEnd({ result, bossName } = {}) {
    const win = result === 'win'   // boss won → the realm broke
    // Lock his final face past any pending beat revert: he falls broken, or
    // stands in grim triumph. Hold it through the finale card, then bow out.
    this._figHoldToken++
    this._figHolding = true
    this._setFace(win ? 'unhinged-dying' : 'battle-joy')
    setTimeout(() => { this._figure?.classList.remove('show') }, 2600)
    const card = h('div', { className: 'qf-ald-card' }, [
      h('div', { className: 'qf-ald-card-kicker' }, win ? 'THE RECKONING IS ENDED' : 'THE REALM ENDURES'),
      h('div', { className: 'qf-ald-card-title' }, win ? 'THE HERO KING FALLS' : 'THE HERO KING STANDS'),
      h('div', { className: 'qf-ald-card-sub' },
        win ? 'Aldric lies broken before your throne.' : `${String(bossName || this._bossName).toUpperCase()} IS NO MORE`),
    ])
    this._root?.appendChild(card)
    requestAnimationFrame(() => card.classList.add('show'))
    // raw setTimeout so it survives _teardown (fires moments later on his death)
    setTimeout(() => { card.classList.remove('show'); setTimeout(() => card.remove(), 450) }, 3000)
  }

  _after(ms, fn) { const id = setTimeout(fn, ms); this._timers.push(id); return id }

  _teardown() {
    for (const id of this._timers) clearTimeout(id)
    this._timers = []
    if (this._presence) { this._presence.classList.remove('show') }
    const root = this._root; this._root = null
    this._hud = this._advFill = this._advGhost = this._bossFill = this._bossGhost = this._presence = null
    this._figure = this._figA = this._figB = null
    this._figHolding = false; this._figExpr = null
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

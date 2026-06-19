// RivalShowdownCinematic (DOM) — "CLASH OF DOMINIONS", the KR Rival set-piece.
// Two dungeon LORDS hold opposite ends of the throne room and channel colliding
// beams; a central NEXUS slides toward whoever is losing. This is NOT the Aldric
// melee duel — it has its OWN fight (BossSystem._buildDominionPlan / _dominionMove)
// and its OWN presentation: a single tug-of-war DOMINANCE bar (not two HP bars), a
// sliding nexus marker, two swelling auras, surge/counter/feedback beats, and a
// beam-collapse finale.
//
// Driven by: RIVAL_DUEL_BEGAN { name, bossName } · RIVAL_DUEL_DOMINION { dom } ·
// RIVAL_DUEL_BEAT { kind, label } · RIVAL_DUEL_END { result, bossName }.
// `dom` ∈ [0,1]: 0 = your boss fully dominant (nexus pinned on Vorzak/left),
// 1 = Vorzak fully dominant (nexus pinned on your boss/right). Bespoke `qf-riv-*`
// styling — deliberately NOT the Aldric `qf-ald-*` set. No infinite CSS animations
// (they hang preview_screenshot — VISUAL_STANDARDS §4).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { HudSfx } from './HudSfx.js'

const PUR = '#a24bd9', PUR2 = '#d49cff'   // Vorzak (the usurper) — purple
const CRIM = '#ff5544', CRIM2 = '#ff9a88' // your boss — crimson

// Beat kind → flavour class. Labels come from the engine; class drives the styling
// (which side the pulse fires from, how big the moment reads).
const RIV_BEAT = {
  ignite:    'ignite',
  lock:      'lock',
  v_surge:   'surge-v',   // Vorzak overpowers — purple pulse from the left
  b_counter: 'surge-b',   // your boss claws back — crimson pulse from the right
  strain:    'strain',
  feedback:  'feedback',  // the turn — white slam
  overload:  'overload',
  collapse:  'collapse',  // apex finish
}

export function ensureRivalCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-riv-css')) return
  const style = document.createElement('style')
  style.id = 'qf-riv-css'
  style.textContent = `
.qf-riv-root { --pur:${PUR}; --pur2:${PUR2}; --crim:${CRIM}; --crim2:${CRIM2};
  position:absolute; inset:0; pointer-events:none; z-index:35;
  font-family:'Press Start 2P','Courier New',monospace; }

/* Two lord-auras bleeding in from the left (Vorzak) + right (your boss) edges. Their
   strength is set live from the dominance value — the winning side's aura swells. */
.qf-riv-aura { position:absolute; top:0; bottom:0; width:42%; z-index:32; opacity:0;
  transition:opacity .9s ease, filter .2s linear; }
.qf-riv-aura.show { opacity:1; }
.qf-riv-aura.left  { left:0;  background:radial-gradient(70% 60% at 0% 50%, color-mix(in srgb,var(--pur) 38%, transparent), transparent 72%); }
.qf-riv-aura.right { right:0; background:radial-gradient(70% 60% at 100% 50%, color-mix(in srgb,var(--crim) 38%, transparent), transparent 72%); }
/* faint corruption haze along the floor */
.qf-riv-floor { position:absolute; left:0; right:0; bottom:0; height:26%; z-index:32; opacity:0;
  transition:opacity 1s ease;
  background:linear-gradient(0deg, color-mix(in srgb,var(--pur) 14%, transparent), transparent),
             linear-gradient(0deg, color-mix(in srgb,var(--crim) 12%, transparent), transparent); }
.qf-riv-floor.show { opacity:1; }

/* ── The DOMINANCE tug-of-war bar (the centrepiece) ────────────────────────── */
.qf-riv-hud { position:absolute; top:calc(var(--hud-top,96px) + 12px); left:50%; transform:translateX(-50%);
  z-index:35; width:min(74vw,820px); opacity:0; transition:opacity .5s ease; }
.qf-riv-hud.show { opacity:1; }
.qf-riv-names { display:flex; justify-content:space-between; margin-bottom:7px;
  font-size:clamp(9px,1.25vw,14px); letter-spacing:2px; white-space:nowrap; }
.qf-riv-names .v { color:var(--pur2);  text-shadow:0 0 10px var(--pur); }
.qf-riv-names .b { color:var(--crim2); text-shadow:0 0 10px var(--crim); }
.qf-riv-track { position:relative; height:30px; background:rgba(6,4,12,.85);
  border:3px solid rgba(150,110,200,.4); border-radius:4px; overflow:hidden;
  box-shadow:0 0 18px rgba(120,70,180,.35), inset 0 0 22px rgba(0,0,0,.6); }
/* purple fill grows from the LEFT (Vorzak), crimson from the RIGHT (your boss);
   they meet at the nexus. Widths set live from the dominance value. */
.qf-riv-fill { position:absolute; top:0; bottom:0; transition:width .12s linear; }
.qf-riv-fill.v { left:0;  width:50%; background:linear-gradient(90deg, color-mix(in srgb,var(--pur) 45%, #120016), var(--pur)); box-shadow:0 0 14px var(--pur); }
.qf-riv-fill.b { right:0; width:50%; background:linear-gradient(270deg, color-mix(in srgb,var(--crim) 45%, #1a0202), var(--crim)); box-shadow:0 0 14px var(--crim); }
/* the collision NEXUS — a hot orb riding the seam between the two fills */
.qf-riv-nexus { position:absolute; top:50%; left:50%; width:26px; height:26px;
  transform:translate(-50%,-50%); transition:left .12s linear; z-index:3; }
.qf-riv-nexus::before { content:''; position:absolute; inset:-7px; border-radius:50%;
  background:radial-gradient(circle, #fff 0%, color-mix(in srgb,var(--pur2) 60%, #fff) 38%, transparent 72%);
  filter:blur(1px); }
.qf-riv-nexus::after { content:''; position:absolute; inset:6px; border-radius:50%;
  background:#fff; box-shadow:0 0 14px 5px rgba(255,255,255,.9); }
/* a thin centre seam tick so the start-of-fight even lock reads */
.qf-riv-seam { position:absolute; top:-4px; bottom:-4px; left:50%; width:2px;
  background:rgba(255,255,255,.25); z-index:2; }

/* ── Screen pulses + beat labels ───────────────────────────────────────────── */
.qf-riv-pulse { position:absolute; inset:0; z-index:33; pointer-events:none; opacity:0;
  animation:qf-riv-pulse .8s ease-out forwards; }
.qf-riv-pulse.surge-v { background:radial-gradient(60% 90% at 4% 50%, color-mix(in srgb,var(--pur) 42%, transparent), transparent 70%); }
.qf-riv-pulse.surge-b { background:radial-gradient(60% 90% at 96% 50%, color-mix(in srgb,var(--crim) 42%, transparent), transparent 70%); }
.qf-riv-pulse.lock     { background:radial-gradient(circle at 50% 46%, transparent 36%, rgba(255,255,255,.26) 100%); }
.qf-riv-pulse.strain   { background:radial-gradient(circle at 50% 48%, color-mix(in srgb,var(--pur) 16%, transparent), transparent 60%); }
.qf-riv-pulse.feedback { background:radial-gradient(circle at 50% 48%, rgba(255,255,255,.34) 0%, color-mix(in srgb,var(--pur) 30%, transparent) 60%, transparent 100%);
  box-shadow:inset 0 0 180px 70px rgba(255,255,255,.3); }
.qf-riv-pulse.overload { background:radial-gradient(circle at 50% 50%, color-mix(in srgb,var(--pur2) 26%, transparent) 0%, color-mix(in srgb,var(--crim) 24%, transparent) 100%); }
.qf-riv-pulse.collapse { background:radial-gradient(circle at 50% 50%, rgba(255,255,255,.5) 0%, color-mix(in srgb,var(--pur) 36%, transparent) 100%);
  box-shadow:inset 0 0 200px 90px rgba(255,255,255,.4); }
@keyframes qf-riv-pulse { 0%{opacity:0} 18%{opacity:1} 100%{opacity:0} }

.qf-riv-flash { position:absolute; inset:0; z-index:37; pointer-events:none; background:#fff; opacity:0;
  animation:qf-riv-flash .42s ease-out forwards; }
@keyframes qf-riv-flash { 0%{opacity:0} 8%{opacity:.85} 100%{opacity:0} }

.qf-riv-beat { position:absolute; left:0; right:0; top:30%; text-align:center; z-index:36; pointer-events:none;
  font-size:clamp(16px,2.7vw,38px); letter-spacing:4px; opacity:0; }
.qf-riv-beat.surge-v { color:var(--pur2);  text-shadow:0 0 20px var(--pur),  0 2px 0 #12001a; }
.qf-riv-beat.surge-b { color:var(--crim2); text-shadow:0 0 20px var(--crim), 0 2px 0 #1a0202; }
.qf-riv-beat.lock,
.qf-riv-beat.strain  { color:#e9ddff; text-shadow:0 0 16px var(--pur2); }
.qf-riv-beat.ignite  { color:#fff; text-shadow:0 0 18px var(--pur2), 0 0 30px var(--crim2); }
.qf-riv-beat.feedback{ color:#fff; font-size:clamp(20px,3.2vw,46px); text-shadow:0 0 26px #fff, 0 0 50px var(--pur2); }
.qf-riv-beat.overload{ color:#fff; text-shadow:0 0 22px var(--pur2), 0 0 40px var(--crim2); }
.qf-riv-beat.collapse{ color:#fff; font-size:clamp(22px,3.6vw,52px); text-shadow:0 0 28px var(--pur), 0 0 60px #fff, 0 3px 0 #12001a; }
.qf-riv-beat.show { animation:qf-riv-beat 1.6s cubic-bezier(.2,.9,.2,1) forwards; }
@keyframes qf-riv-beat { 0%{opacity:0; transform:scale(.7)} 15%{opacity:1; transform:scale(1.08)}
  74%{opacity:1; transform:scale(1)} 100%{opacity:0; transform:scale(1)} }

/* ── Entrance + finale cards ───────────────────────────────────────────────── */
.qf-riv-card { position:absolute; inset:0; z-index:38; pointer-events:none; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:14px; opacity:0; transition:opacity .4s ease; }
.qf-riv-card.show { opacity:1; }
.qf-riv-card::before { content:''; position:absolute; inset:0;
  background:radial-gradient(circle at 50% 50%, transparent 24%, rgba(2,1,8,.8) 100%); }
.qf-riv-card-kicker { position:relative; font-size:clamp(9px,1.1vw,13px); letter-spacing:6px; color:var(--pur2);
  text-shadow:0 0 14px var(--pur); }
.qf-riv-card-row { position:relative; display:flex; align-items:center; gap:20px; }
.qf-riv-card-side { font-size:clamp(14px,2.2vw,30px); letter-spacing:2px;
  animation:qf-riv-pop .6s cubic-bezier(.18,.9,.25,1) both; }
.qf-riv-card-side.v { color:var(--pur2);  text-shadow:0 0 22px var(--pur),  0 3px 0 #12001a; animation-delay:0s; }
.qf-riv-card-side.b { color:var(--crim2); text-shadow:0 0 22px var(--crim), 0 3px 0 #1a0202; animation-delay:.12s; }
.qf-riv-card-clash { position:relative; width:30px; height:30px; }
.qf-riv-card-clash::after { content:''; position:absolute; inset:0; border-radius:50%;
  background:radial-gradient(circle,#fff 0%, var(--pur2) 45%, transparent 72%);
  box-shadow:0 0 24px 6px rgba(212,156,255,.7); animation:qf-riv-pop .5s ease-out .24s both; }
.qf-riv-card-title { position:relative; font-size:clamp(22px,3.6vw,52px); letter-spacing:3px; color:#fff;
  text-shadow:0 0 30px var(--pur2), 0 3px 0 #12001a; animation:qf-riv-pop .7s cubic-bezier(.18,.9,.25,1) both; }
.qf-riv-card-title.held { text-shadow:0 0 30px var(--crim), 0 0 54px var(--crim2), 0 3px 0 #1a0202; }
.qf-riv-card-sub { position:relative; font-size:clamp(9px,1.2vw,15px); letter-spacing:3px; color:#cdbfe6; }
@keyframes qf-riv-pop { 0%{opacity:0; transform:scale(.6); filter:blur(7px)}
  60%{opacity:1; transform:scale(1.05); filter:blur(0)} 100%{opacity:1; transform:scale(1)} }`
  document.head.appendChild(style)
}

export class RivalShowdownCinematic {
  constructor() {
    this._stage = document.getElementById('hud-stage')
    this._listeners = []
    this._timers = []
    this._root = null
    if (!this._stage) return
    ensureRivalCss()
    const sub = (evt, fn) => { EventBus.on(evt, fn); this._listeners.push([evt, fn]) }
    sub('RIVAL_DUEL_BEGAN',    (p) => this._onBegan(p ?? {}))
    sub('RIVAL_DUEL_DOMINION', (p) => this._onDominion(p ?? {}))
    sub('RIVAL_DUEL_BEAT',     (p) => this._onBeat(p ?? {}))
    sub('RIVAL_DUEL_END',      (p) => this._onEnd(p ?? {}))
    sub('DAY_PHASE_ENDED',     () => this._teardown())
  }

  _onBegan({ name = 'THE USURPER', bossName = 'THE BOSS' } = {}) {
    this._teardown()
    this._rivalName = String(name).toUpperCase()
    this._bossName  = String(bossName).toUpperCase()
    this._root = h('div', { className: 'qf-riv-root' })
    this._stage.appendChild(this._root)
    this._buildAtmos()
    this._buildHud()
    this._playEntrance()
  }

  _buildAtmos() {
    this._auraL = h('div', { className: 'qf-riv-aura left' })
    this._auraR = h('div', { className: 'qf-riv-aura right' })
    this._floor = h('div', { className: 'qf-riv-floor' })
    this._root.append(this._auraL, this._auraR, this._floor)
    requestAnimationFrame(() => { this._auraL?.classList.add('show'); this._auraR?.classList.add('show'); this._floor?.classList.add('show') })
  }

  _buildHud() {
    this._fillV  = h('div', { className: 'qf-riv-fill v' })
    this._fillB  = h('div', { className: 'qf-riv-fill b' })
    this._nexus  = h('div', { className: 'qf-riv-nexus' })
    this._hud = h('div', { className: 'qf-riv-hud' }, [
      h('div', { className: 'qf-riv-names' }, [
        h('div', { className: 'v' }, this._rivalName),
        h('div', { className: 'b' }, this._bossName),
      ]),
      h('div', { className: 'qf-riv-track' }, [
        this._fillV, this._fillB, h('div', { className: 'qf-riv-seam' }), this._nexus,
      ]),
    ])
    this._root.appendChild(this._hud)
    this._after(2200, () => this._hud?.classList.add('show'))
  }

  _playEntrance() {
    const card = h('div', { className: 'qf-riv-card' }, [
      h('div', { className: 'qf-riv-card-kicker' }, 'TWO LORDS · ONE THRONE'),
      h('div', { className: 'qf-riv-card-row' }, [
        h('div', { className: 'qf-riv-card-side v' }, this._rivalName),
        h('div', { className: 'qf-riv-card-clash' }),
        h('div', { className: 'qf-riv-card-side b' }, this._bossName),
      ]),
    ])
    this._root.appendChild(card)
    requestAnimationFrame(() => card.classList.add('show'))
    this._after(2300, () => { card.classList.remove('show'); this._after(450, () => card.remove()) })
  }

  // The dominance feed — drive the two fills, the nexus position, and the aura
  // strengths. dom 0→1 = your boss → Vorzak dominant.
  _onDominion({ dom = 0.5 } = {}) {
    const d = Math.max(0, Math.min(1, dom))
    const pct = `${(d * 100).toFixed(1)}%`
    if (this._fillV) this._fillV.style.width = pct                       // purple from left
    if (this._fillB) this._fillB.style.width = `${((1 - d) * 100).toFixed(1)}%` // crimson from right
    if (this._nexus) this._nexus.style.left  = pct                       // nexus rides the seam
    // Auras swell with their lord's dominance.
    if (this._auraL) this._auraL.style.filter = `brightness(${(0.7 + d * 0.9).toFixed(2)})`
    if (this._auraR) this._auraR.style.filter = `brightness(${(0.7 + (1 - d) * 0.9).toFixed(2)})`
  }

  _onBeat({ kind, label } = {}) {
    if (kind === 'collapse') HudSfx.playUi('cin_collapse')   // apex finish sting (P2-1; dormant until file added)
    const cls = RIV_BEAT[kind]
    if (!cls || !this._root) return
    const pulse = h('div', { className: `qf-riv-pulse ${cls}` })
    this._root.appendChild(pulse)
    this._after(840, () => pulse.remove())
    if (cls === 'feedback' || cls === 'collapse') {
      const flash = h('div', { className: 'qf-riv-flash' })
      this._root.appendChild(flash)
      this._after(450, () => flash.remove())
    }
    if (label) {
      const lbl = h('div', { className: `qf-riv-beat ${cls}` }, String(label).toUpperCase())
      this._root.appendChild(lbl)
      requestAnimationFrame(() => lbl.classList.add('show'))
      this._after(1650, () => lbl.remove())
    }
  }

  _onEnd({ result, bossName } = {}) {
    HudSfx.playUi('cin_verdict')   // throne-holds/usurped verdict sting (P2-1; dormant until file added)
    // result='win'  → the BOSS won → Vorzak's beam collapses (you hold the throne).
    // result='loss' → Vorzak won → your boss is usurped.
    const bossWon = result === 'win'
    const card = h('div', { className: 'qf-riv-card' }, [
      h('div', { className: 'qf-riv-card-kicker' }, bossWon ? 'THE THRONE HOLDS' : 'THE THRONE IS USURPED'),
      h('div', { className: `qf-riv-card-title ${bossWon ? 'held' : ''}` }, bossWon ? 'THE USURPER FALLS' : 'VORZAK CLAIMS THE THRONE'),
      h('div', { className: 'qf-riv-card-sub' },
        bossWon ? `${this._rivalName}'S BEAM COLLAPSES — HIS DOMINION SHATTERS`
                : `${String(bossName || this._bossName).toUpperCase()} IS DRIVEN FROM THE THRONE`),
    ])
    this._root?.appendChild(card)
    requestAnimationFrame(() => card.classList.add('show'))
    setTimeout(() => { card.classList.remove('show'); setTimeout(() => card.remove(), 450) }, 3000)
  }

  _after(ms, fn) { const id = setTimeout(fn, ms); this._timers.push(id); return id }

  _teardown() {
    for (const id of this._timers) clearTimeout(id)
    this._timers = []
    this._auraL?.classList.remove('show'); this._auraR?.classList.remove('show'); this._floor?.classList.remove('show')
    const root = this._root; this._root = null
    this._hud = this._fillV = this._fillB = this._nexus = this._auraL = this._auraR = this._floor = null
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

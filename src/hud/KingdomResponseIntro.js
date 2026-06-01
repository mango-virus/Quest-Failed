// KingdomResponseIntro (DOM) — KR P4. The signature "THE KINGDOM RESPONDS"
// reveal that opens each drafted act (II & III). When KingdomResponseSystem
// drafts a response it fires KINGDOM_RESPONSE_DRAWN; this slams a cinematic,
// per-response-themed card — emblem, name, threat — that gives the act its
// identity. ActIntro defers on these acts (kind 'kingdom_responds') so this is
// the single, richer set-piece rather than a double card.
//
// Built to VISUAL_STANDARDS.md: per-response accent identity, motion tokens
// (--ease-spring / --dur-*), a staggered choreographed reveal (kicker → emblem
// shockwave-pop → name → rule → threat), transform/opacity-only animation, and a
// reduced-motion fallback. Self-mounts into #hud-stage, injects CSS once
// (VictoryScreen / ActIntro pattern). Gated in HudRoot behind the `acts` flag.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI']

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-kr-intro-css')) return
  const style = document.createElement('style')
  style.id = 'qf-kr-intro-css'
  style.textContent = `
.qf-kri { position:absolute; inset:0; z-index:34; pointer-events:none;
  display:flex; align-items:center; justify-content:center; opacity:0;
  transition:opacity var(--dur-base,240ms) var(--ease-out,ease);
  font-family:'Press Start 2P','Courier New',monospace;
  --kri-accent:#d4a648; }
.qf-kri.show { opacity:1; }
/* backdrop: dark vignette warmed by the response's accent */
.qf-kri::before { content:''; position:absolute; inset:0;
  background:
    radial-gradient(circle at 50% 44%, color-mix(in srgb, var(--kri-accent) 16%, transparent) 0%, transparent 46%),
    radial-gradient(circle at 50% 50%, rgba(6,4,12,.55) 30%, rgba(3,2,7,.93) 100%); }

.qf-kri-card { position:relative; text-align:center; padding:24px 40px; max-width:760px; }

.qf-kri-kicker { font-size:clamp(9px,1.15vw,13px); letter-spacing:6px;
  color:var(--kri-accent); text-shadow:0 0 12px color-mix(in srgb, var(--kri-accent) 70%, transparent);
  margin-bottom:var(--space-5,24px);
  opacity:0; transform:translateY(-6px);
  animation:qf-kri-drop var(--dur-slow,400ms) var(--ease-out,ease) .1s forwards; }

/* emblem — the hero beat: a shockwave ring + a spring-pop glyph */
.qf-kri-emblem { position:relative; width:124px; height:124px; margin:0 auto var(--space-4,16px);
  display:flex; align-items:center; justify-content:center; }
.qf-kri-emblem-ring { position:absolute; inset:0; border-radius:50%;
  border:2px solid var(--kri-accent); opacity:0; transform:scale(.3);
  animation:qf-kri-shock 900ms var(--ease-out,ease) .22s forwards; }
.qf-kri-emblem-glyph { font-size:74px; line-height:1; color:var(--kri-accent);
  filter:drop-shadow(0 0 18px var(--kri-accent));
  opacity:0; transform:scale(.4);
  animation:qf-kri-pop var(--dur-slow,400ms) var(--ease-spring,ease) .25s forwards,
            qf-kri-float 3.6s ease-in-out 1s infinite; }

.qf-kri-name { font-size:clamp(24px,3.8vw,52px); letter-spacing:2px; color:#f3ecdd;
  text-shadow:0 0 26px color-mix(in srgb, var(--kri-accent) 55%, transparent), 0 3px 0 #0a0610;
  opacity:0; transform:translateY(12px);
  animation:qf-kri-rise var(--dur-slow,400ms) var(--ease-out,ease) .45s forwards; }

.qf-kri-rule { width:0; height:2px; margin:var(--space-4,16px) auto var(--space-3,12px);
  background:linear-gradient(90deg, transparent, var(--kri-accent), transparent);
  animation:qf-kri-rule var(--dur-hero,800ms) var(--ease-out,ease) .7s forwards; }

.qf-kri-eyebrow { font-size:clamp(9px,1.05vw,12px); letter-spacing:4px;
  color:var(--kri-accent); margin-bottom:var(--space-2,8px);
  opacity:0; animation:qf-kri-fade var(--dur-slow,400ms) ease .85s forwards; }

.qf-kri-threat { font-family:'VT323',monospace; font-size:clamp(15px,1.85vw,21px);
  letter-spacing:.3px; color:#b9c2cc; max-width:560px; margin:0 auto; line-height:1.45;
  opacity:0; transform:translateY(6px);
  animation:qf-kri-rise var(--dur-slow,400ms) var(--ease-out,ease) 1s forwards; }

@keyframes qf-kri-drop { to { opacity:1; transform:translateY(0); } }
@keyframes qf-kri-rise { to { opacity:1; transform:translateY(0); } }
@keyframes qf-kri-fade { to { opacity:1; } }
@keyframes qf-kri-pop  { 0%{opacity:0; transform:scale(.4)} 100%{opacity:1; transform:scale(1)} }
@keyframes qf-kri-shock { 0%{opacity:.9; transform:scale(.3)} 100%{opacity:0; transform:scale(1.5)} }
@keyframes qf-kri-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
@keyframes qf-kri-rule { from { width:0 } to { width:min(56vw, 440px) } }

/* reduced motion: keep the reveal, drop the movement/overshoot/float */
@media (prefers-reduced-motion: reduce) {
  .qf-kri-kicker, .qf-kri-name, .qf-kri-eyebrow, .qf-kri-threat,
  .qf-kri-emblem-glyph { animation:qf-kri-fade var(--dur-base,240ms) ease both; transform:none; }
  .qf-kri-emblem-ring { display:none; }
  .qf-kri-rule { animation:qf-kri-rule var(--dur-base,240ms) ease forwards; }
}`
  document.head.appendChild(style)
}

export class KingdomResponseIntro {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._timers = []
    _ensureCss()
    EventBus.on('KINGDOM_RESPONSE_DRAWN', this._onDrawn, this)
  }

  destroy() {
    EventBus.off('KINGDOM_RESPONSE_DRAWN', this._onDrawn, this)
    this._clearTimers()
    this._root?.remove(); this._root = null
  }

  _clearTimers() { for (const t of this._timers) clearTimeout(t); this._timers = [] }

  _onDrawn({ act, response } = {}) {
    const stage = document.getElementById('hud-stage')
    if (!stage || !response) return
    this._clearTimers()
    this._root?.remove()

    this._root = h('div', { className: 'qf-kri', style: { '--kri-accent': response.accent || '#d4a648' } }, [
      h('div', { className: 'qf-kri-card' }, [
        h('div', { className: 'qf-kri-kicker' }, `ACT ${ROMAN[act] || act} · THE KINGDOM RESPONDS`),
        h('div', { className: 'qf-kri-emblem' }, [
          h('div', { className: 'qf-kri-emblem-ring' }),
          h('div', { className: 'qf-kri-emblem-glyph' }, response.emblem || '✦'),
        ]),
        h('div', { className: 'qf-kri-name' }, response.name || 'The Kingdom Responds'),
        h('div', { className: 'qf-kri-rule' }),
        response.eyebrow ? h('div', { className: 'qf-kri-eyebrow' }, response.eyebrow) : null,
        response.threat ? h('div', { className: 'qf-kri-threat' }, response.threat) : null,
      ]),
    ])
    stage.appendChild(this._root)

    // fade in → hold (~5.2s, longer than ActIntro since there's more to read) → out
    this._timers.push(setTimeout(() => this._root?.classList.add('show'), 30))
    this._timers.push(setTimeout(() => this._root?.classList.remove('show'), 5200))
    this._timers.push(setTimeout(() => { this._root?.remove(); this._root = null }, 5900))
  }
}

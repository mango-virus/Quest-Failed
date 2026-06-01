// KingdomResponseIntro (DOM) — KR P4. The signature "THE KINGDOM RESPONDS"
// reveal that opens each drafted act (II & III). When KingdomResponseSystem
// drafts a response it fires KINGDOM_RESPONSE_DRAWN; this slams a cinematic,
// per-response-themed card — sunburst, big glowing emblem, the response name,
// its threat, and what its modifier MEANS — and HOLDS until the player hits
// CONTINUE (or any key / clicks), so they can actually read it. ActIntro defers
// on these acts (kind 'drafted') so this is the single, richer set-piece.
//
// Built to VISUAL_STANDARDS.md: per-response accent identity, motion tokens,
// a choreographed entrance, transform/opacity-only animation, reduced-motion
// fallback, and NO infinite animation (so it holds on a stable frame). Self-
// mounts into #hud-stage, injects CSS once. Gated in HudRoot behind `acts`.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI']

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-kr-intro-css')) return
  const style = document.createElement('style')
  style.id = 'qf-kr-intro-css'
  style.textContent = `
.qf-kri { position:absolute; inset:0; z-index:48; pointer-events:auto; opacity:0;
  display:flex; align-items:center; justify-content:center; overflow:hidden;
  transition:opacity var(--dur-base,240ms) var(--ease-out,ease);
  font-family:'Press Start 2P','Courier New',monospace; --kri-accent:#d4a648; }
.qf-kri.show { opacity:1; }
/* backdrop: deep vignette warmed by the response accent */
.qf-kri-bg { position:absolute; inset:0;
  background:
    radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--kri-accent) 20%, transparent) 0%, transparent 48%),
    radial-gradient(circle at 50% 50%, rgba(5,3,10,.72) 26%, rgba(2,1,5,.96) 100%); }
/* sunburst rays behind the emblem — a static conic burst, radially faded */
.qf-kri-rays { position:absolute; left:50%; top:40%; width:150vmax; height:150vmax;
  transform:translate(-50%,-50%) scale(.2); opacity:0;
  background:repeating-conic-gradient(from 0deg,
    color-mix(in srgb, var(--kri-accent) 34%, transparent) 0deg 1.4deg, transparent 1.4deg 11deg);
  -webkit-mask:radial-gradient(circle at center, #000 0%, rgba(0,0,0,.35) 22%, transparent 42%);
          mask:radial-gradient(circle at center, #000 0%, rgba(0,0,0,.35) 22%, transparent 42%);
  animation:qf-kri-rays var(--dur-hero,800ms) var(--ease-out,ease) .15s forwards; }

.qf-kri-card { position:relative; text-align:center; padding:20px 40px; max-width:780px; }

.qf-kri-kicker { font-size:clamp(10px,1.25vw,14px); letter-spacing:7px;
  color:var(--kri-accent); text-shadow:0 0 14px color-mix(in srgb, var(--kri-accent) 75%, transparent);
  margin-bottom:var(--space-4,16px); opacity:0; transform:translateY(-8px);
  animation:qf-kri-drop var(--dur-slow,400ms) var(--ease-out,ease) .15s forwards; }

/* emblem — the hero beat: shockwave ring + a big spring-pop glyph */
.qf-kri-emblem { position:relative; width:150px; height:150px; margin:0 auto var(--space-3,12px);
  display:flex; align-items:center; justify-content:center; }
.qf-kri-emblem-ring { position:absolute; inset:0; border-radius:50%;
  border:2px solid var(--kri-accent); opacity:0; transform:scale(.3);
  animation:qf-kri-shock 1000ms var(--ease-out,ease) .3s forwards; }
.qf-kri-emblem-ring.r2 { animation-delay:.45s; animation-duration:1200ms; }
.qf-kri-emblem-glyph { font-size:96px; line-height:1; color:var(--kri-accent);
  text-shadow:0 0 30px var(--kri-accent), 0 0 8px #fff;
  opacity:0; transform:scale(.3);
  animation:qf-kri-pop 520ms var(--ease-spring,ease) .32s forwards; }

.qf-kri-name { font-size:clamp(30px,5.2vw,68px); letter-spacing:2px; color:#fff6e6;
  text-shadow:0 0 34px color-mix(in srgb, var(--kri-accent) 70%, transparent), 0 4px 0 #0a0610;
  opacity:0; transform:translateY(16px) scale(.96); filter:blur(6px);
  animation:qf-kri-slam var(--dur-slow,400ms) var(--ease-out,ease) .5s forwards; }

.qf-kri-rule { width:0; height:2px; margin:var(--space-4,16px) auto var(--space-3,12px);
  background:linear-gradient(90deg, transparent, var(--kri-accent), transparent);
  box-shadow:0 0 10px color-mix(in srgb, var(--kri-accent) 60%, transparent);
  animation:qf-kri-rule var(--dur-hero,800ms) var(--ease-out,ease) .72s forwards; }

.qf-kri-eyebrow { font-size:clamp(10px,1.15vw,13px); letter-spacing:5px;
  color:var(--kri-accent); margin-bottom:var(--space-3,12px);
  opacity:0; animation:qf-kri-fade var(--dur-slow,400ms) ease .86s forwards; }

.qf-kri-threat { font-family:'VT323',monospace; font-size:clamp(17px,2vw,23px);
  letter-spacing:.3px; color:#d9cdb6; max-width:600px; margin:0 auto var(--space-4,16px);
  line-height:1.45; opacity:0; transform:translateY(8px);
  animation:qf-kri-rise var(--dur-slow,400ms) var(--ease-out,ease) .98s forwards; }

/* the modifier — what this act DOES, boxed so it reads as "the rules this act" */
.qf-kri-mod { display:inline-flex; align-items:flex-start; gap:10px; text-align:left;
  max-width:600px; margin:0 auto var(--space-5,24px); padding:11px 16px;
  border:1px solid color-mix(in srgb, var(--kri-accent) 55%, transparent);
  border-left:3px solid var(--kri-accent); border-radius:var(--radius-md,7px);
  background:color-mix(in srgb, var(--kri-accent) 9%, rgba(6,4,12,.6));
  opacity:0; transform:translateY(8px);
  animation:qf-kri-rise var(--dur-slow,400ms) var(--ease-out,ease) 1.12s forwards; }
.qf-kri-mod-ico { font-size:15px; color:var(--kri-accent); line-height:1.5; flex:0 0 auto; }
.qf-kri-mod-txt { font-family:'VT323',monospace; font-size:clamp(15px,1.7vw,19px);
  line-height:1.4; color:#cdd8c6; }
.qf-kri-mod-txt b { color:var(--kri-accent); font-weight:normal; letter-spacing:.5px; }

.qf-kri-actions { opacity:0; animation:qf-kri-fade var(--dur-slow,400ms) ease 1.3s forwards; }
.qf-kri-actions .btn { font-size:13px; }
.qf-kri-hint { margin-top:var(--space-3,12px); font-size:9px; letter-spacing:3px;
  color:#6f6757; }

@keyframes qf-kri-rays { to { opacity:.85; transform:translate(-50%,-50%) scale(1); } }
@keyframes qf-kri-drop { to { opacity:1; transform:translateY(0); } }
@keyframes qf-kri-rise { to { opacity:1; transform:translateY(0); } }
@keyframes qf-kri-fade { to { opacity:1; } }
@keyframes qf-kri-pop  { 0%{opacity:0; transform:scale(.3)} 70%{opacity:1; transform:scale(1.12)} 100%{opacity:1; transform:scale(1)} }
@keyframes qf-kri-slam { 0%{opacity:0; transform:translateY(16px) scale(.96); filter:blur(6px)}
  100%{opacity:1; transform:translateY(0) scale(1); filter:blur(0)} }
@keyframes qf-kri-shock { 0%{opacity:.85; transform:scale(.3)} 100%{opacity:0; transform:scale(1.7)} }
@keyframes qf-kri-rule { from { width:0 } to { width:min(58vw, 460px) } }

/* reduced motion: keep the reveal, drop the movement/blur/overshoot */
@media (prefers-reduced-motion: reduce) {
  .qf-kri-kicker,.qf-kri-name,.qf-kri-eyebrow,.qf-kri-threat,.qf-kri-mod,
  .qf-kri-emblem-glyph,.qf-kri-actions { animation:qf-kri-fade var(--dur-base,240ms) ease both; transform:none; filter:none; }
  .qf-kri-emblem-ring { display:none; }
  .qf-kri-rays { animation:qf-kri-fade var(--dur-base,240ms) ease forwards; transform:translate(-50%,-50%); }
  .qf-kri-rule { animation:qf-kri-rule var(--dur-base,240ms) ease forwards; }
}`
  document.head.appendChild(style)
}

export class KingdomResponseIntro {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._keyFn = null
    _ensureCss()
    EventBus.on('KINGDOM_RESPONSE_DRAWN', this._onDrawn, this)
  }

  destroy() {
    EventBus.off('KINGDOM_RESPONSE_DRAWN', this._onDrawn, this)
    this._teardown()
  }

  _onDrawn({ act, response } = {}) {
    const stage = document.getElementById('hud-stage')
    if (!stage || !response) return
    this._teardown()   // replace any showing card

    const acc = response.accent || '#d4a648'
    this._root = h('div', { className: 'qf-kri', style: { '--kri-accent': acc } }, [
      h('div', { className: 'qf-kri-bg' }),
      h('div', { className: 'qf-kri-rays' }),
      h('div', { className: 'qf-kri-card' }, [
        h('div', { className: 'qf-kri-kicker' }, `ACT ${ROMAN[act] || act} · THE KINGDOM RESPONDS`),
        h('div', { className: 'qf-kri-emblem' }, [
          h('div', { className: 'qf-kri-emblem-ring' }),
          h('div', { className: 'qf-kri-emblem-ring r2' }),
          h('div', { className: 'qf-kri-emblem-glyph' }, response.emblem || '✦'),
        ]),
        h('div', { className: 'qf-kri-name' }, response.name || 'The Kingdom Responds'),
        h('div', { className: 'qf-kri-rule' }),
        response.eyebrow ? h('div', { className: 'qf-kri-eyebrow' }, response.eyebrow) : null,
        response.threat ? h('div', { className: 'qf-kri-threat' }, `"${response.threat}"`) : null,
        response.gimmick ? h('div', { className: 'qf-kri-mod' }, [
          h('div', { className: 'qf-kri-mod-ico' }, '⚠'),
          h('div', { className: 'qf-kri-mod-txt' }, [
            h('b', {}, 'THIS ACT: '), document.createTextNode(response.gimmick),
          ]),
        ]) : null,
        h('div', { className: 'qf-kri-actions' }, [
          h('button', { className: 'btn primary', on: { click: () => this._dismiss() } }, 'CONTINUE'),
          h('div', { className: 'qf-kri-hint' }, 'PRESS ANY KEY'),
        ]),
      ]),
    ])
    // Click anywhere on the backdrop (not the card text) also continues.
    this._root.addEventListener('click', (e) => {
      if (e.target === this._root || e.target.classList?.contains('qf-kri-bg')) this._dismiss()
    })
    stage.appendChild(this._root)
    requestAnimationFrame(() => this._root?.classList.add('show'))

    // Any key continues. Captured so it doesn't leak to game hotkeys.
    this._keyFn = (e) => { e.preventDefault(); e.stopPropagation(); this._dismiss() }
    window.addEventListener('keydown', this._keyFn, { capture: true, once: true })
  }

  _dismiss() {
    if (!this._root) return
    EventBus.emit('KINGDOM_RESPONSE_INTRO_DISMISSED')
    this._root.classList.remove('show')
    const el = this._root
    this._cleanupKey()
    this._root = null
    setTimeout(() => el?.remove(), 320)
  }

  _cleanupKey() {
    if (this._keyFn) { window.removeEventListener('keydown', this._keyFn, { capture: true }); this._keyFn = null }
  }

  _teardown() {
    this._cleanupKey()
    this._root?.remove(); this._root = null
  }
}

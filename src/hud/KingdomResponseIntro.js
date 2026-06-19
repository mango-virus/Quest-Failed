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
import { HudSfx } from './HudSfx.js'

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
/* per-response backdrop effect (bgFx) — each Kingdom Response gets its own
   motif instead of the same rays. Static (faded in), accent-tinted. */
.qf-kri-fx { position:absolute; inset:0; opacity:0; pointer-events:none;
  animation:qf-kri-fxin var(--dur-hero,800ms) var(--ease-out,ease) .15s forwards; }
/* Pantheon — divine sunburst rays */
.qf-kri-fx.fx-rays {
  background:repeating-conic-gradient(from 0deg at 50% 42%,
    color-mix(in srgb, var(--kri-accent) 32%, transparent) 0deg 1.4deg, transparent 1.4deg 11deg);
  -webkit-mask:radial-gradient(circle at 50% 42%, #000 0%, rgba(0,0,0,.4) 20%, transparent 44%);
          mask:radial-gradient(circle at 50% 42%, #000 0%, rgba(0,0,0,.4) 20%, transparent 44%); }
/* Inquisition — a single judgment beam descending from on high */
.qf-kri-fx.fx-beam {
  background:linear-gradient(180deg, color-mix(in srgb, var(--kri-accent) 34%, transparent) 0%, transparent 62%);
  -webkit-mask:linear-gradient(90deg, transparent 36%, #000 45%, #000 55%, transparent 64%);
          mask:linear-gradient(90deg, transparent 36%, #000 45%, #000 55%, transparent 64%); }
/* Rival — an ominous dark dominion pressing down from above */
.qf-kri-fx.fx-descent {
  background:
    radial-gradient(120% 75% at 50% -12%, color-mix(in srgb, var(--kri-accent) 28%, transparent) 0%, transparent 58%),
    linear-gradient(180deg, rgba(0,0,0,.45) 0%, transparent 42%); }
/* Betrayer — fractured shards radiating, a dungeon turned on itself */
.qf-kri-fx.fx-cracks {
  background:repeating-conic-gradient(from 9deg at 50% 48%,
    transparent 0deg 6.5deg, color-mix(in srgb, var(--kri-accent) 26%, transparent) 6.5deg 7.4deg,
    transparent 7.4deg 21deg, color-mix(in srgb, var(--kri-accent) 13%, transparent) 21deg 22deg);
  -webkit-mask:radial-gradient(circle at 50% 48%, transparent 13%, #000 32%, transparent 72%);
          mask:radial-gradient(circle at 50% 48%, transparent 13%, #000 32%, transparent 72%); }
/* Reckoning — a creeping necrotic fog rising from below */
.qf-kri-fx.fx-souls {
  background:
    radial-gradient(150% 80% at 50% 116%, color-mix(in srgb, var(--kri-accent) 30%, transparent) 0%, transparent 56%),
    radial-gradient(90% 50% at 25% 108%, color-mix(in srgb, var(--kri-accent) 16%, transparent) 0%, transparent 50%); }
/* Forlorn Hope — embers + sparks of a funeral pyre */
.qf-kri-fx.fx-embers {
  background:
    radial-gradient(2.5px 2.5px at 18% 78%, var(--kri-accent), transparent 60%),
    radial-gradient(2px 2px at 34% 88%, var(--kri-accent), transparent 60%),
    radial-gradient(2.5px 2.5px at 52% 80%, var(--kri-accent), transparent 60%),
    radial-gradient(2px 2px at 68% 90%, var(--kri-accent), transparent 60%),
    radial-gradient(3px 3px at 82% 83%, var(--kri-accent), transparent 60%),
    radial-gradient(2px 2px at 44% 70%, var(--kri-accent), transparent 60%),
    radial-gradient(130% 55% at 50% 118%, color-mix(in srgb, var(--kri-accent) 24%, transparent) 0%, transparent 52%); }
/* Mage Tower — an arcane geometric grid, reality drawn as a mesh */
.qf-kri-fx.fx-runes {
  background:
    repeating-linear-gradient(0deg, transparent 0 39px, color-mix(in srgb, var(--kri-accent) 13%, transparent) 39px 40px),
    repeating-linear-gradient(90deg, transparent 0 39px, color-mix(in srgb, var(--kri-accent) 13%, transparent) 39px 40px);
  -webkit-mask:radial-gradient(circle at 50% 46%, #000 0%, transparent 66%);
          mask:radial-gradient(circle at 50% 46%, #000 0%, transparent 66%); }
/* All-Stars — a triumphant starfield */
.qf-kri-fx.fx-stars {
  background:
    radial-gradient(1.6px 1.6px at 14% 24%, #fff, transparent 60%),
    radial-gradient(1.4px 1.4px at 72% 16%, var(--kri-accent), transparent 60%),
    radial-gradient(2px 2px at 40% 32%, var(--kri-accent), transparent 60%),
    radial-gradient(1.4px 1.4px at 86% 40%, #fff, transparent 60%),
    radial-gradient(1.6px 1.6px at 26% 60%, var(--kri-accent), transparent 60%),
    radial-gradient(1.4px 1.4px at 60% 68%, #fff, transparent 60%),
    radial-gradient(2px 2px at 90% 70%, var(--kri-accent), transparent 60%),
    radial-gradient(1.4px 1.4px at 8% 80%, var(--kri-accent), transparent 60%); }
/* Plunderers — a glinting scatter of coins raining from a gilded haze */
.qf-kri-fx.fx-coins {
  background:
    radial-gradient(2.6px 2.6px at 16% 22%, var(--kri-accent), transparent 62%),
    radial-gradient(3px 3px at 78% 28%, var(--kri-accent), transparent 62%),
    radial-gradient(2px 2px at 40% 16%, #fff, transparent 62%),
    radial-gradient(2.6px 2.6px at 62% 60%, var(--kri-accent), transparent 62%),
    radial-gradient(3px 3px at 24% 70%, var(--kri-accent), transparent 62%),
    radial-gradient(2px 2px at 86% 74%, #fff, transparent 62%),
    radial-gradient(2.6px 2.6px at 50% 42%, var(--kri-accent), transparent 62%),
    radial-gradient(2px 2px at 70% 86%, var(--kri-accent), transparent 62%),
    linear-gradient(116deg, transparent 0 48%, color-mix(in srgb, var(--kri-accent) 15%, transparent) 49% 50%, transparent 51%),
    radial-gradient(130% 52% at 50% -12%, color-mix(in srgb, var(--kri-accent) 22%, transparent) 0%, transparent 50%); }

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

.qf-kri-reason { font-family:'VT323',monospace; font-size:clamp(14px,1.5vw,18px);
  letter-spacing:.3px; color:#c9b6a0; margin-bottom:var(--space-3,12px);
  opacity:0; animation:qf-kri-fade var(--dur-slow,400ms) ease .92s forwards; }
.qf-kri-reason-ico { color:var(--kri-accent); text-shadow:0 0 8px var(--kri-accent); }

.qf-kri-threat { font-family:'VT323',monospace; font-size:clamp(17px,2vw,23px);
  letter-spacing:.3px; color:#d9cdb6; max-width:600px; margin:0 auto var(--space-4,16px);
  line-height:1.45; opacity:0; transform:translateY(8px);
  animation:qf-kri-rise var(--dur-slow,400ms) var(--ease-out,ease) .98s forwards; }

/* YOUR TARGET — names the champion boss you must defeat to clear the act. */
.qf-kri-target { display:inline-flex; align-items:center; gap:11px; margin:0 auto 6px;
  padding:7px 16px; border-radius:var(--radius-md,7px);
  border:1px solid color-mix(in srgb, var(--kri-accent) 60%, transparent);
  background:color-mix(in srgb, var(--kri-accent) 12%, transparent);
  opacity:0; transform:translateY(8px);
  animation:qf-kri-rise var(--dur-slow,400ms) var(--ease-out,ease) 1.1s forwards; }
.qf-kri-target-label { font-family:'Press Start 2P',monospace; font-size:8px; letter-spacing:3px;
  color:var(--kri-accent); text-shadow:0 0 8px var(--kri-accent); }
.qf-kri-target-name { font-family:'Press Start 2P',monospace; font-size:clamp(10px,1.2vw,13px);
  letter-spacing:1px; color:#fff3df; text-shadow:0 0 10px var(--kri-accent), 0 2px 0 #1a1004; }
.qf-kri-clear { font-family:'VT323',monospace; font-size:clamp(13px,1.5vw,16px); color:#cdbfa6;
  letter-spacing:.4px; margin:0 auto var(--space-4,16px); opacity:0; transform:translateY(8px);
  animation:qf-kri-rise var(--dur-slow,400ms) var(--ease-out,ease) 1.18s forwards; }

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

@keyframes qf-kri-fxin { to { opacity:.9; } }
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
  .qf-kri-fx { animation:qf-kri-fade var(--dur-base,240ms) ease forwards; }
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

  _onDrawn({ act, response, reason } = {}) {
    const stage = document.getElementById('hud-stage')
    if (!stage || !response) return
    this._teardown()   // replace any showing card

    const acc = response.accent || '#d4a648'
    this._root = h('div', { className: 'qf-kri', style: { '--kri-accent': acc } }, [
      h('div', { className: 'qf-kri-bg' }),
      h('div', { className: `qf-kri-fx fx-${response.bgFx || 'rays'}` }),
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
        // KR P5 — call out WHY this response was drawn (the playstyle it answers).
        reason ? h('div', { className: 'qf-kri-reason' }, [
          h('span', { className: 'qf-kri-reason-ico' }, '✦'),
          document.createTextNode(` Drawn by ${reason}.`),
        ]) : null,
        response.threat ? h('div', { className: 'qf-kri-threat' }, `"${response.threat}"`) : null,
        // Name the champion you must defeat to clear the act — the boss the
        // ChampionBar + in-world crown/aura point at when the raid lands.
        response.champion ? h('div', { className: 'qf-kri-target' }, [
          h('span', { className: 'qf-kri-target-label' }, 'YOUR TARGET'),
          h('span', { className: 'qf-kri-target-name' }, `♛ ${response.champion}`),
        ]) : null,
        response.clearCondition ? h('div', { className: 'qf-kri-clear' }, response.clearCondition) : null,
        // The act's mechanical effect ("THIS ACT: …") now lives in the act-number
        // hover popover (TopBar qf-day-act-pop), keeping this reveal to the story beat.
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
    HudSfx.playUi('cin_kingdom')   // "THE KINGDOM RESPONDS" apex sting (P2-1; dormant until file added)

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

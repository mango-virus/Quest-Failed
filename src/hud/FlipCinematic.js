// FlipCinematic — Beat 0 of the onboarding overhaul (the "premise-setter").
// Replaces the old text WelcomeIntroOverlay with a short, skippable, sprite-
// animated CINEMATIC that installs the inversion ("you ARE the dungeon") in the
// first ~20s. See DESIGN.md "Onboarding overhaul — LOCKED".
//
// Art direction (v2 — fill the frame, not generic): letterbox bars, a big
// central throne + spotlight, LARGE sprites, light shafts + dense embers + heavy
// vignette, a camera push-in, and a dramatic flip (white+blood flash, screen
// shake, ember burst, the boss erupting off the throne to dominate the frame
// while the heroes are flung small).
//
// Shots: heroes march toward the throne → the monster falls (old hero fantasy)
// → THE FLIP (it reanimates, rises huge) → "YOU ARE THE DUNGEON" → ENTER.
// Real run boss sprite + real adventurer sprites (on-demand load + glyph swap).
// Same lifecycle/handoff as the old intro (maybeOpen on meta.introSeen; _finish
// sets introSeen + tutorials pref + emits INTRO_DISMISSED). Skippable (SKIP/Esc).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { buildCryptBackdrop } from './menuBackdrop.js'
import { animatedBossSprite, animatedAdventurer } from './inGameSnapshot.js'
import { ensureAdventurerBaseSheet } from '../scenes/AdventurerBaseLoader.js'

const PARTY = [
  { cls: 'knight', glyph: '⚔' },
  { cls: 'mage',   glyph: '✦' },
  { cls: 'cleric', glyph: '✚' },
  { cls: 'ranger', glyph: '➶' },
]

let _cssInjected = false
function _injectCss() {
  if (_cssInjected) return
  _cssInjected = true
  const css = `
  .qf-fc { position:absolute; inset:0; z-index:3500; overflow:hidden; pointer-events:auto;
    font-family:'Press Start 2P',monospace; background:rgba(3,2,7,1); }
  /* the "camera" — the whole scene, push-in on the flip */
  .qf-fc-world { position:absolute; inset:0; z-index:1; transform-origin:50% 52%;
    transition: transform 1.1s cubic-bezier(.3,.7,.25,1); }
  .qf-fc.flipped .qf-fc-world { transform: scale(1.14); }
  /* atmosphere */
  .qf-fc-spot { position:absolute; left:50%; top:50%; width:120vh; height:120vh; transform:translate(-50%,-46%);
    pointer-events:none; opacity:.5; transition:opacity .8s ease, background .8s ease;
    background: radial-gradient(circle, rgba(212,166,72,.16) 0%, rgba(212,166,72,.05) 30%, transparent 60%); }
  .qf-fc.flipped .qf-fc-spot { opacity:1;
    background: radial-gradient(circle, rgba(200,51,74,.26) 0%, rgba(212,166,72,.12) 32%, transparent 62%); }
  .qf-fc-shaft { position:absolute; top:-12%; width:24vh; height:130%; pointer-events:none; opacity:.18; mix-blend-mode:screen;
    background: linear-gradient(180deg, rgba(255,210,130,.5), transparent 70%); filter:blur(6px); }
  .qf-fc-shaft.l { left:16%; transform:rotate(9deg); } .qf-fc-shaft.r { right:16%; transform:rotate(-9deg); }
  .qf-fc-ground { position:absolute; left:0; right:0; bottom:30%; height:42%; pointer-events:none; z-index:1;
    background: linear-gradient(180deg, transparent, rgba(0,0,0,.55)); }
  .qf-fc-ground::after { content:''; position:absolute; left:0; right:0; top:0; height:2px;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--gold) 55%, transparent), transparent); opacity:.55; }
  /* throne — a dark dais + high back behind the boss */
  .qf-fc-throne { position:absolute; left:50%; bottom:30%; transform:translateX(-50%); z-index:1; pointer-events:none;
    width:340px; height:300px; }
  .qf-fc-throne .back { position:absolute; left:50%; bottom:0; transform:translateX(-50%); width:150px; height:280px;
    background: linear-gradient(180deg, rgba(28,20,34,.95), rgba(10,7,15,.95)); border-radius:80px 80px 8px 8px;
    box-shadow: inset 0 0 26px rgba(0,0,0,.7), 0 0 30px rgba(0,0,0,.6); }
  .qf-fc-throne .dais { position:absolute; left:50%; bottom:-6px; transform:translateX(-50%); width:330px; height:46px;
    background: linear-gradient(180deg, rgba(34,24,40,.95), rgba(8,5,12,.98)); clip-path: polygon(12% 0, 88% 0, 100% 100%, 0 100%);
    box-shadow: 0 0 24px rgba(0,0,0,.7); }
  /* sprites */
  .qf-fc-party { position:absolute; bottom:31%; left:9%; display:flex; gap:18px; align-items:flex-end; z-index:3;
    transform:translateX(-62vw); opacity:0; transition: transform 2.8s cubic-bezier(.2,.7,.3,1), opacity 1.1s ease; }
  .qf-fc.marched .qf-fc-party { transform:translateX(0); opacity:1; }
  .qf-fc.flipped .qf-fc-party { transform: translateX(-3vw) translateY(10px) scale(.72); opacity:.5; filter:brightness(.5) saturate(.7); transition: transform .8s cubic-bezier(.3,.6,.2,1), opacity .7s, filter .7s; }
  .qf-fc-hero { width:150px; height:150px; display:flex; align-items:flex-end; justify-content:center;
    color: color-mix(in srgb, var(--gold) 60%, white); font-size:58px;
    filter: drop-shadow(0 5px 6px rgba(0,0,0,.7)); animation: qf-fc-bob 1.6s ease-in-out infinite; }
  .qf-fc-hero:nth-child(2){animation-delay:.2s} .qf-fc-hero:nth-child(3){animation-delay:.4s} .qf-fc-hero:nth-child(4){animation-delay:.6s}
  @keyframes qf-fc-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
  .qf-fc-hero canvas, .qf-fc-hero img { image-rendering:pixelated; width:100%; height:100%; object-fit:contain; }
  .qf-fc-boss { position:absolute; left:50%; bottom:31%; transform:translateX(-50%) translateY(26px) scale(.94); z-index:4;
    width:300px; height:300px; display:flex; align-items:flex-end; justify-content:center;
    opacity:0; transition: opacity .6s ease, transform .7s ease, filter .7s ease; }
  .qf-fc-boss canvas, .qf-fc-boss img { image-rendering:pixelated; width:100%; height:100%; object-fit:contain; }
  .qf-fc.bossShown .qf-fc-boss { opacity:1; transform:translateX(-50%) translateY(0) scale(1); filter: drop-shadow(0 8px 10px rgba(0,0,0,.6)); }
  .qf-fc.bossFell .qf-fc-boss { opacity:.5; transform:translateX(-50%) translateY(40px) scale(.86) rotate(-10deg);
    filter: grayscale(.7) brightness(.45); transition: all .55s ease .12s; }
  .qf-fc.flipped .qf-fc-boss { opacity:1; bottom:33%; width:300px; height:300px;
    transform:translateX(-50%) translateY(0) scale(1.5);
    filter: drop-shadow(0 0 34px rgba(212,166,72,.8)) drop-shadow(0 0 60px rgba(200,51,74,.45)) brightness(1.12);
    transition: opacity .5s, transform .9s cubic-bezier(.2,.85,.2,1), filter .9s; }
  /* flashes + shake */
  .qf-fc-flash { position:absolute; inset:0; z-index:7; background:rgba(255,255,255,1); opacity:0; pointer-events:none; }
  .qf-fc-flash.go { animation: qf-fc-flash .6s ease-out; }
  @keyframes qf-fc-flash { 0%{opacity:0} 12%{opacity:.95} 100%{opacity:0} }
  .qf-fc-red { position:absolute; inset:0; z-index:6; pointer-events:none; opacity:0;
    background: radial-gradient(circle at 50% 48%, rgba(200,51,74,.5), transparent 60%); }
  .qf-fc-red.go { animation: qf-fc-red 1.1s ease-out; }
  @keyframes qf-fc-red { 0%{opacity:0} 18%{opacity:1} 100%{opacity:0} }
  .qf-fc.shake .qf-fc-world { animation: qf-fc-shake .55s ease-out; }
  @keyframes qf-fc-shake { 0%,100%{transform:scale(1.14) translate(0,0)} 20%{transform:scale(1.14) translate(-10px,6px)} 40%{transform:scale(1.14) translate(9px,-7px)} 60%{transform:scale(1.14) translate(-7px,4px)} 80%{transform:scale(1.14) translate(5px,-3px)} }
  /* ember burst on the flip */
  .qf-fc-burst { position:absolute; left:50%; bottom:40%; z-index:5; pointer-events:none; }
  .qf-fc-burst i { position:absolute; width:6px; height:6px; border-radius:50%; background: var(--gold);
    box-shadow:0 0 8px var(--gold); opacity:0; }
  .qf-fc-burst.go i { animation: qf-fc-spark 1.1s ease-out forwards; }
  @keyframes qf-fc-spark { 0%{opacity:1; transform:translate(0,0) scale(1)} 100%{opacity:0; transform:translate(var(--dx),var(--dy)) scale(.3)} }
  /* drifting embers (ambient) */
  .qf-fc-emb { position:absolute; bottom:-10px; width:4px; height:4px; border-radius:50%; z-index:2;
    background: color-mix(in srgb, var(--gold) 80%, white); box-shadow:0 0 6px var(--gold); opacity:0;
    animation: qf-fc-rise linear infinite; }
  @keyframes qf-fc-rise { 0%{opacity:0; transform:translateY(0)} 12%{opacity:.8} 90%{opacity:.5} 100%{opacity:0; transform:translateY(-94vh)} }
  .qf-fc-vig { position:absolute; inset:0; z-index:8; pointer-events:none;
    background: radial-gradient(130% 100% at 50% 48%, transparent 38%, rgba(2,1,5,.9) 100%); }
  /* letterbox cinematic bars */
  .qf-fc-bar { position:absolute; left:0; right:0; height:11%; z-index:9; background:rgba(0,0,0,1); transition: transform .7s cubic-bezier(.3,.7,.2,1); }
  .qf-fc-bar.t { top:0; transform:translateY(-100%); } .qf-fc-bar.b { bottom:0; transform:translateY(100%); }
  .qf-fc.framed .qf-fc-bar.t, .qf-fc.framed .qf-fc-bar.b { transform:translateY(0); }
  /* captions + reveal */
  .qf-fc-cap { position:absolute; left:0; right:0; bottom:17%; z-index:10; text-align:center; pointer-events:none; }
  .qf-fc-eyebrow { font-family:'Silkscreen',monospace; font-size:15px; letter-spacing:.3em; text-transform:uppercase;
    color: color-mix(in srgb, var(--gold) 72%, white); opacity:0; transition:opacity .8s ease; text-shadow:0 2px 6px rgba(0,0,0,.9); }
  .qf-fc-eyebrow.on { opacity:.92; }
  .qf-fc-line { margin-top:14px; font-size:18px; letter-spacing:.05em; color: var(--bone);
    text-shadow:0 2px 0 rgba(0,0,0,.8); opacity:0; transform:translateY(8px); transition: opacity .6s ease, transform .6s ease; }
  .qf-fc-line.on { opacity:1; transform:none; }
  .qf-fc-reveal { position:absolute; left:0; right:0; top:13%; z-index:10; text-align:center; pointer-events:none;
    opacity:0; transform: scale(.82); transition: opacity .7s ease, transform .9s cubic-bezier(.2,.9,.25,1); }
  .qf-fc-reveal.on { opacity:1; transform:none; }
  .qf-fc-title { font-size:62px; letter-spacing:.07em; line-height:1.15;
    color: var(--gold); text-shadow: 0 0 26px rgba(212,166,72,.65), 0 5px 0 rgba(0,0,0,.85); }
  .qf-fc-title b { color: var(--blood); text-shadow: 0 0 28px rgba(200,51,74,.7), 0 5px 0 rgba(0,0,0,.85); }
  .qf-fc-sub { margin-top:20px; font-family:'Silkscreen',monospace; font-size:16px; letter-spacing:.16em;
    color: color-mix(in srgb, var(--bone) 80%, var(--gold)); text-transform:uppercase; text-shadow:0 2px 6px rgba(0,0,0,.9); }
  .qf-fc-foot { position:absolute; left:0; right:0; bottom:13.5%; z-index:11; display:flex; flex-direction:column; align-items:center; gap:18px;
    opacity:0; transform:translateY(12px); transition: opacity .6s ease, transform .6s ease; }
  .qf-fc-foot.on { opacity:1; transform:none; }
  .qf-fc-enter { position:relative; overflow:hidden; cursor:pointer; font-family:'Press Start 2P',monospace;
    font-size:15px; letter-spacing:.07em; text-transform:uppercase; color: rgba(20,8,2,1);
    background: linear-gradient(180deg, color-mix(in srgb, var(--gold) 72%, white), var(--gold));
    border:1px solid rgba(0,0,0,.5); border-radius:3px; padding:17px 30px;
    box-shadow: inset 1px 1px 0 rgba(255,255,255,.3), inset -1px -1px 0 rgba(0,0,0,.4), 0 5px 0 rgba(0,0,0,.6); }
  .qf-fc-enter::before { content:''; position:absolute; top:0; bottom:0; left:-60%; width:38%; transform:skewX(-20deg);
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent); animation: qf-fc-sheen 2.4s ease-in-out infinite; }
  @keyframes qf-fc-sheen { 0%,60%{left:-60%} 100%{left:140%} }
  .qf-fc-enter:active { transform:translateY(2px); }
  .qf-fc-tut { display:flex; align-items:center; gap:9px; cursor:pointer;
    font-family:'Silkscreen',monospace; font-size:12px; letter-spacing:.08em; color: color-mix(in srgb, var(--bone) 70%, transparent); }
  .qf-fc-tut .box { width:16px; height:16px; border:1px solid color-mix(in srgb, var(--gold) 50%, var(--bone)); border-radius:2px;
    display:flex; align-items:center; justify-content:center; color: var(--gold); font-size:12px; background:rgba(0,0,0,.3); }
  .qf-fc-skip { position:absolute; right:26px; top:3%; z-index:12; pointer-events:auto; cursor:pointer;
    font-family:'Silkscreen',monospace; font-size:12px; letter-spacing:.16em; text-transform:uppercase;
    color: rgba(240,230,212,.5); background:none; border:none; }
  .qf-fc-skip:hover { color: var(--bone); }
  `
  const tag = document.createElement('style'); tag.id = 'qf-fc-style'; tag.textContent = css
  document.head.appendChild(tag)
}

export class FlipCinematic {
  constructor(gameState) {
    this._gameState = gameState
    this._el = null
    this._timers = []
    this._stopFns = []
    this._tutChecked = true
    this._esc = (e) => { if (e.key === 'Escape') this._finish(true) }
  }

  maybeOpen() { if (!this._gameState?.meta?.introSeen) this.open() }

  open() {
    if (this._el || this._gameState?.meta?.introSeen) return
    _injectCss()
    const archId = this._gameState?.player?.bossArchetypeId

    const partyEl = h('div', { className: 'qf-fc-party' },
      PARTY.map(p => h('div', { className: 'qf-fc-hero', dataset: { cls: p.cls } }, p.glyph)))
    const bossSlot = h('div', { className: 'qf-fc-boss' })
    const throne = h('div', { className: 'qf-fc-throne' }, [h('div', { className: 'back' }), h('div', { className: 'dais' })])
    const burst = h('div', { className: 'qf-fc-burst' },
      Array.from({ length: 16 }, (_, i) => {
        const ang = (i / 16) * Math.PI * 2, d = 120 + (i % 4) * 40
        return h('i', { style: { '--dx': `${Math.cos(ang) * d}px`, '--dy': `${Math.sin(ang) * d - 40}px`, left: '0', bottom: '0', animationDelay: `${(i % 5) * 30}ms` } })
      }))
    const embers = h('div', { className: 'qf-fc-embers' },
      Array.from({ length: 22 }, () => {
        const left = Math.round(Math.random() * 100), dur = 6 + Math.random() * 7, delay = Math.random() * 8
        const sz = 3 + Math.round(Math.random() * 3)
        return h('div', { className: 'qf-fc-emb', style: { left: left + '%', width: sz + 'px', height: sz + 'px', animationDuration: dur + 's', animationDelay: delay + 's' } })
      }))

    const flash = h('div', { className: 'qf-fc-flash' })
    const red   = h('div', { className: 'qf-fc-red' })
    const eyebrow = h('div', { className: 'qf-fc-eyebrow' }, 'For ages, heroes plundered the dark…')
    const capLine = h('div', { className: 'qf-fc-line' }, '')
    const reveal = h('div', { className: 'qf-fc-reveal' }, [
      h('div', { className: 'pix qf-fc-title', html: 'YOU ARE THE <b>DUNGEON</b>' }),
      h('div', { className: 'qf-fc-sub' }, 'They come to kill you. Make them fail.'),
    ])
    const tutBox = h('span', { className: 'box' }, '✓')
    const foot = h('div', { className: 'qf-fc-foot' }, [
      h('button', { className: 'qf-fc-enter', on: { click: () => this._finish(false) } }, 'Enter the Dungeon ▸'),
      h('div', { className: 'qf-fc-tut', on: { click: () => { this._tutChecked = !this._tutChecked; tutBox.textContent = this._tutChecked ? '✓' : '' } } },
        [tutBox, 'Show me how to play']),
    ])

    const world = h('div', { className: 'qf-fc-world' }, [
      ...buildCryptBackdrop(),
      h('div', { className: 'qf-fc-shaft l' }), h('div', { className: 'qf-fc-shaft r' }),
      h('div', { className: 'qf-fc-spot' }),
      h('div', { className: 'qf-fc-ground' }),
      throne, embers, partyEl, bossSlot, burst,
    ])
    this._el = h('div', { className: 'qf-fc' }, [
      world, red, flash,
      h('div', { className: 'qf-fc-vig' }),
      h('div', { className: 'qf-fc-bar t' }), h('div', { className: 'qf-fc-bar b' }),
      h('div', { className: 'qf-fc-cap' }, [eyebrow, capLine]),
      reveal, foot,
      h('button', { className: 'qf-fc-skip', on: { click: () => this._finish(true) } }, 'Skip ▸▸'),
    ])
    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this._el)
    window.addEventListener('keydown', this._esc)

    this._fillBoss(bossSlot, archId)
    partyEl.querySelectorAll('.qf-fc-hero').forEach(slot => this._fillHero(slot, slot.dataset.cls))

    const at = (ms, fn) => this._timers.push(setTimeout(fn, ms))
    const setLine = (t) => { capLine.textContent = t; capLine.classList.remove('on'); void capLine.offsetWidth; capLine.classList.add('on') }

    at(60,  () => this._el.classList.add('framed'))                                                          // letterbox in
    at(260, () => { this._el.classList.add('marched', 'bossShown'); eyebrow.classList.add('on') })           // A: march in, monster on throne
    at(4800, () => { flash.classList.add('go'); this._el.classList.add('bossFell'); eyebrow.classList.remove('on'); setLine('…and the monster always fell.') }) // B
    at(9000, () => {                                                                                          // C: THE FLIP
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go')
      red.classList.add('go'); burst.classList.add('go')
      this._el.classList.remove('bossFell'); this._el.classList.add('flipped', 'shake')
      setTimeout(() => this._el && this._el.classList.remove('shake'), 650)
      setLine('Not this time.')
    })
    at(13400, () => { capLine.classList.remove('on'); reveal.classList.add('on') })                          // D: reveal
    at(15800, () => foot.classList.add('on'))                                                                // E: hand off
  }

  _fillBoss(slot, archId) {
    if (!archId) return
    const a = animatedBossSprite(archId, 300)
    if (a?.el) { slot.replaceChildren(a.el); if (a.stop) this._stopFns.push(a.stop) }
  }

  _fillHero(slot, cls, vId = 'v01') {
    const put = () => {
      if (!this._el || slot.dataset.filled) return true
      const a = animatedAdventurer(cls, 150, vId)
      if (a?.el) { slot.dataset.filled = '1'; slot.replaceChildren(a.el); if (a.stop) this._stopFns.push(a.stop); return true }
      return false
    }
    if (put()) return
    const scene = window.__game?.scene?.getScene?.('Game')
    if (!scene) return
    if (ensureAdventurerBaseSheet(scene, cls, vId)) { put(); return }
    scene.load.once(`filecomplete-spritesheet-adv-${cls}-${vId}`, () => setTimeout(put, 50))
    let tries = 0
    const poll = () => { if (!this._el || put() || tries++ > 20) return; setTimeout(poll, 220) }
    setTimeout(poll, 300)
  }

  _finish(skipped) {
    if (!this._el) return
    if (this._gameState?.meta) {
      this._gameState.meta.introSeen = true
      this._gameState.meta.tutorialEnabled = this._tutChecked
    }
    try { localStorage.setItem('qf.gameplay.tutorials', this._tutChecked ? 'true' : 'false') } catch {}
    EventBus.emit('INTRO_DISMISSED', { tutorialEnabled: this._tutChecked, skipped: !!skipped })
    this.destroy()
  }

  destroy() {
    for (const t of this._timers) clearTimeout(t); this._timers = []
    for (const s of this._stopFns) { try { s() } catch {} } this._stopFns = []
    window.removeEventListener('keydown', this._esc)
    try { this._el?.remove() } catch {}
    this._el = null
  }
}

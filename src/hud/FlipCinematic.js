// FlipCinematic — Beat 0 of the onboarding overhaul (the "premise-setter").
// A short, skippable, sprite-animated CINEMATIC that installs the inversion
// ("you ARE the dungeon"). See DESIGN.md "Onboarding overhaul — LOCKED".
//
// v3 detail pass: heroes WALK in → ATTACK the throned monster → it falls → THE
// FLIP (it reanimates, erupts huge, gold/blood glow + ember burst + screen-
// shake + camera push-in) → YOUR MINIONS pour out + the heroes FLEE →
// "YOU ARE THE DUNGEON" → ENTER. Uses real per-action adventurer anims
// (walk/slash/spellcast/shoot/run), the run's boss sprite, and real imp minions.
// Richer set: framing pillars, skeleton-wall decor, tiled floor, light shafts,
// dust + embers, heavy vignette, letterbox bars.
//
// Same lifecycle/handoff as the old intro (maybeOpen on meta.introSeen; _finish
// sets introSeen + tutorials pref + emits INTRO_DISMISSED). Skippable (SKIP/Esc).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { buildCryptBackdrop } from './menuBackdrop.js'
import { animatedBossSprite, animatedAdventurer, animatedAdventurerAnim, animatedMinion } from './inGameSnapshot.js'
import { ensureAdventurerBaseSheet } from '../scenes/AdventurerBaseLoader.js'

// party member → its attack animation (all share the LPC base rows)
const PARTY = [
  { cls: 'knight', glyph: '⚔', atk: 'slash' },
  { cls: 'mage',   glyph: '✦', atk: 'spellcast' },
  { cls: 'cleric', glyph: '✚', atk: 'thrust' },
  { cls: 'ranger', glyph: '➶', atk: 'shoot' },
]
const HORDE = ['imp1', 'imp1', 'imp1', 'goblin1']   // pour out on the flip

let _cssInjected = false
function _injectCss() {
  if (_cssInjected) return
  _cssInjected = true
  const css = `
  .qf-fc { position:absolute; inset:0; z-index:3500; overflow:hidden; pointer-events:auto;
    font-family:'Press Start 2P',monospace; background:rgba(3,2,7,1); }
  .qf-fc-world { position:absolute; inset:0; z-index:1; transform-origin:50% 54%;
    transition: transform 1.1s cubic-bezier(.3,.7,.25,1); }
  .qf-fc.flipped .qf-fc-world { transform: scale(1.14); }
  /* atmosphere */
  .qf-fc-spot { position:absolute; left:50%; top:50%; width:130vh; height:130vh; transform:translate(-50%,-44%);
    pointer-events:none; opacity:.45; transition:opacity .8s ease, background .8s ease;
    background: radial-gradient(circle, rgba(212,166,72,.15) 0%, rgba(212,166,72,.045) 32%, transparent 60%); }
  .qf-fc.flipped .qf-fc-spot { opacity:1;
    background: radial-gradient(circle, rgba(200,51,74,.28) 0%, rgba(212,166,72,.12) 34%, transparent 64%); }
  .qf-fc-shaft { position:absolute; top:-14%; width:22vh; height:135%; pointer-events:none; opacity:.16; mix-blend-mode:screen;
    background: linear-gradient(180deg, rgba(255,210,130,.5), transparent 72%); filter:blur(7px); }
  .qf-fc-shaft.a{ left:10%; transform:rotate(11deg) } .qf-fc-shaft.b{ left:34%; transform:rotate(6deg); opacity:.1 }
  .qf-fc-shaft.c{ right:34%; transform:rotate(-6deg); opacity:.1 } .qf-fc-shaft.d{ right:10%; transform:rotate(-11deg) }
  /* framing foreground pillars (depth) */
  .qf-fc-pillar { position:absolute; top:0; bottom:0; width:13%; z-index:5; pointer-events:none;
    background: linear-gradient(90deg, rgba(2,1,6,.96), rgba(6,4,12,.5) 60%, transparent); }
  .qf-fc-pillar.r { right:0; transform:scaleX(-1); }
  .qf-fc-pillar::before { content:''; position:absolute; top:0; bottom:0; left:34%; width:46%;
    background: linear-gradient(90deg, rgba(20,14,26,.9), rgba(8,5,14,.95)); box-shadow: 2px 0 0 rgba(0,0,0,.6), inset -3px 0 8px rgba(0,0,0,.6); }
  /* skeleton-wall decor */
  .qf-fc-skel { position:absolute; image-rendering:pixelated; opacity:.4; filter:brightness(.6) drop-shadow(0 0 6px rgba(0,0,0,.6)); z-index:1; pointer-events:none; }
  /* floor */
  .qf-fc-ground { position:absolute; left:0; right:0; bottom:0; height:34%; z-index:1; pointer-events:none;
    background:
      repeating-linear-gradient(90deg, transparent 0, transparent 62px, rgba(0,0,0,.35) 62px, rgba(0,0,0,.35) 64px),
      linear-gradient(180deg, rgba(18,12,22,.5), rgba(2,1,6,.92)); }
  .qf-fc-ground::after { content:''; position:absolute; left:0; right:0; top:0; height:2px;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--gold) 60%, transparent), transparent); opacity:.6; }
  /* throne */
  .qf-fc-throne { position:absolute; left:50%; bottom:30%; transform:translateX(-50%); z-index:1; pointer-events:none; width:360px; height:320px; }
  .qf-fc-throne .back { position:absolute; left:50%; bottom:0; transform:translateX(-50%); width:160px; height:300px;
    background: linear-gradient(180deg, rgba(30,21,36,.96), rgba(9,6,14,.96)); border-radius:90px 90px 8px 8px;
    box-shadow: inset 0 0 30px rgba(0,0,0,.75), 0 0 36px rgba(0,0,0,.6); }
  .qf-fc-throne .back::before, .qf-fc-throne .back::after { content:''; position:absolute; bottom:30%; width:18px; height:62%;
    background: linear-gradient(180deg, rgba(40,28,48,.95), rgba(14,9,20,.95)); border-radius:10px; }
  .qf-fc-throne .back::before { left:-12px } .qf-fc-throne .back::after { right:-12px }
  .qf-fc-throne .dais { position:absolute; left:50%; bottom:-8px; transform:translateX(-50%); width:340px; height:50px;
    background: linear-gradient(180deg, rgba(36,25,42,.96), rgba(7,4,11,.98)); clip-path: polygon(11% 0, 89% 0, 100% 100%, 0 100%);
    box-shadow: 0 0 26px rgba(0,0,0,.7); }
  /* sprites */
  .qf-fc-party { position:absolute; bottom:30%; left:8%; display:flex; gap:14px; align-items:flex-end; z-index:3;
    transform:translateX(-64vw); transition: transform 2.9s linear; }
  .qf-fc.marched .qf-fc-party { transform:translateX(0); }
  .qf-fc.flipped .qf-fc-party { transform: translateX(-9vw) translateY(8px) scale(.7); opacity:.55; filter:brightness(.5) saturate(.7);
    transition: transform .9s cubic-bezier(.3,.6,.2,1), opacity .8s, filter .8s; }
  .qf-fc-hero { width:152px; height:152px; display:flex; align-items:flex-end; justify-content:center;
    color: color-mix(in srgb, var(--gold) 60%, white); font-size:58px; filter: drop-shadow(0 6px 7px rgba(0,0,0,.7)); }
  .qf-fc-hero canvas, .qf-fc-hero img { image-rendering:pixelated; width:100%; height:100%; object-fit:contain; }
  .qf-fc-boss { position:absolute; left:50%; bottom:31%; transform:translateX(-50%) translateY(26px) scale(.94); z-index:4;
    width:300px; height:300px; display:flex; align-items:flex-end; justify-content:center;
    opacity:0; transition: opacity .6s ease, transform .7s ease, filter .7s ease; }
  .qf-fc-boss canvas, .qf-fc-boss img { image-rendering:pixelated; width:100%; height:100%; object-fit:contain; }
  .qf-fc.bossShown .qf-fc-boss { opacity:1; transform:translateX(-50%) translateY(0) scale(1); filter: drop-shadow(0 8px 10px rgba(0,0,0,.6)); }
  .qf-fc.bossFell .qf-fc-boss { opacity:.5; transform:translateX(-50%) translateY(42px) scale(.86) rotate(-10deg);
    filter: grayscale(.7) brightness(.45); transition: all .55s ease .12s; }
  .qf-fc.flipped .qf-fc-boss { opacity:1; bottom:33%; transform:translateX(-50%) translateY(0) scale(1.55);
    filter: drop-shadow(0 0 36px rgba(212,166,72,.85)) drop-shadow(0 0 64px rgba(200,51,74,.5)) brightness(1.14);
    transition: opacity .5s, transform .9s cubic-bezier(.2,.85,.2,1), filter .9s; }
  /* the horde that pours out on the flip */
  .qf-fc-horde { position:absolute; left:50%; bottom:30%; transform:translateX(-50%); width:560px; height:120px; z-index:3; pointer-events:none; }
  .qf-fc-horde .m { position:absolute; bottom:0; width:84px; height:84px; opacity:0; transform:translateY(14px) scale(.4); }
  .qf-fc-horde .m canvas, .qf-fc-horde .m img { image-rendering:pixelated; width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 4px 5px rgba(0,0,0,.7)); }
  .qf-fc-horde.go .m { animation: qf-fc-pop .5s cubic-bezier(.2,1.3,.4,1) forwards; }
  @keyframes qf-fc-pop { to { opacity:1; transform:translateY(0) scale(1); } }
  /* flashes + shake + burst */
  .qf-fc-flash { position:absolute; inset:0; z-index:7; background:rgba(255,255,255,1); opacity:0; pointer-events:none; }
  .qf-fc-flash.go { animation: qf-fc-flash .6s ease-out; }
  @keyframes qf-fc-flash { 0%{opacity:0} 12%{opacity:.95} 100%{opacity:0} }
  .qf-fc-red { position:absolute; inset:0; z-index:6; pointer-events:none; opacity:0;
    background: radial-gradient(circle at 50% 48%, rgba(200,51,74,.5), transparent 60%); }
  .qf-fc-red.go { animation: qf-fc-red 1.2s ease-out; }
  @keyframes qf-fc-red { 0%{opacity:0} 18%{opacity:1} 100%{opacity:0} }
  .qf-fc.shake .qf-fc-world { animation: qf-fc-shake .55s ease-out; }
  @keyframes qf-fc-shake { 0%,100%{transform:scale(1.14) translate(0,0)} 20%{transform:scale(1.14) translate(-11px,7px)} 40%{transform:scale(1.14) translate(10px,-8px)} 60%{transform:scale(1.14) translate(-8px,5px)} 80%{transform:scale(1.14) translate(6px,-3px)} }
  .qf-fc-burst { position:absolute; left:50%; bottom:42%; z-index:5; pointer-events:none; }
  .qf-fc-burst i { position:absolute; width:7px; height:7px; border-radius:50%; background: var(--gold); box-shadow:0 0 9px var(--gold); opacity:0; }
  .qf-fc-burst.go i { animation: qf-fc-spark 1.1s ease-out forwards; }
  @keyframes qf-fc-spark { 0%{opacity:1; transform:translate(0,0) scale(1)} 100%{opacity:0; transform:translate(var(--dx),var(--dy)) scale(.3)} }
  /* drifting embers + dust */
  .qf-fc-emb { position:absolute; bottom:-10px; border-radius:50%; z-index:2;
    background: color-mix(in srgb, var(--gold) 80%, white); box-shadow:0 0 6px var(--gold); opacity:0; animation: qf-fc-rise linear infinite; }
  @keyframes qf-fc-rise { 0%{opacity:0; transform:translateY(0)} 12%{opacity:.8} 90%{opacity:.45} 100%{opacity:0; transform:translateY(-96vh)} }
  .qf-fc-dust { position:absolute; border-radius:50%; z-index:2; background:rgba(180,160,140,.5); opacity:0; animation: qf-fc-drift linear infinite; }
  @keyframes qf-fc-drift { 0%{opacity:0} 20%{opacity:.4} 80%{opacity:.25} 100%{opacity:0; transform:translate(var(--dx), -40vh)} }
  .qf-fc-vig { position:absolute; inset:0; z-index:8; pointer-events:none;
    background: radial-gradient(135% 105% at 50% 46%, transparent 36%, rgba(2,1,5,.92) 100%); }
  /* letterbox */
  .qf-fc-bar { position:absolute; left:0; right:0; height:10.5%; z-index:9; background:rgba(0,0,0,1); transition: transform .7s cubic-bezier(.3,.7,.2,1); }
  .qf-fc-bar.t { top:0; transform:translateY(-100%); } .qf-fc-bar.b { bottom:0; transform:translateY(100%); }
  .qf-fc.framed .qf-fc-bar.t, .qf-fc.framed .qf-fc-bar.b { transform:translateY(0); }
  /* captions + reveal */
  .qf-fc-cap { position:absolute; left:0; right:0; bottom:16%; z-index:10; text-align:center; pointer-events:none; }
  .qf-fc-eyebrow { font-family:'Silkscreen',monospace; font-size:15px; letter-spacing:.3em; text-transform:uppercase;
    color: color-mix(in srgb, var(--gold) 72%, white); opacity:0; transition:opacity .8s ease; text-shadow:0 2px 6px rgba(0,0,0,.9); }
  .qf-fc-eyebrow.on { opacity:.92; }
  .qf-fc-line { margin-top:14px; font-size:18px; letter-spacing:.05em; color: var(--bone); text-shadow:0 2px 0 rgba(0,0,0,.8);
    opacity:0; transform:translateY(8px); transition: opacity .6s ease, transform .6s ease; }
  .qf-fc-line.on { opacity:1; transform:none; }
  .qf-fc-reveal { position:absolute; left:0; right:0; top:13%; z-index:10; text-align:center; pointer-events:none;
    opacity:0; transform: scale(.82); transition: opacity .7s ease, transform .9s cubic-bezier(.2,.9,.25,1); }
  .qf-fc-reveal.on { opacity:1; transform:none; }
  .qf-fc-title { font-size:62px; letter-spacing:.07em; line-height:1.15; color: var(--gold);
    text-shadow: 0 0 26px rgba(212,166,72,.65), 0 5px 0 rgba(0,0,0,.85); }
  .qf-fc-title b { color: var(--blood); text-shadow: 0 0 28px rgba(200,51,74,.7), 0 5px 0 rgba(0,0,0,.85); }
  .qf-fc-sub { margin-top:20px; font-family:'Silkscreen',monospace; font-size:16px; letter-spacing:.16em;
    color: color-mix(in srgb, var(--bone) 80%, var(--gold)); text-transform:uppercase; text-shadow:0 2px 6px rgba(0,0,0,.9); }
  .qf-fc-foot { position:absolute; left:0; right:0; bottom:13%; z-index:11; display:flex; flex-direction:column; align-items:center; gap:18px;
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
    this._heroSlots = []
    this._tutChecked = true
    this._esc = (e) => { if (e.key === 'Escape') this._finish(true) }
  }

  maybeOpen() { if (!this._gameState?.meta?.introSeen) this.open() }

  open() {
    if (this._el || this._gameState?.meta?.introSeen) return
    _injectCss()
    const archId = this._gameState?.player?.bossArchetypeId

    const partyEl = h('div', { className: 'qf-fc-party' },
      PARTY.map(p => h('div', { className: 'qf-fc-hero', dataset: { cls: p.cls, atk: p.atk } }, p.glyph)))
    this._heroSlots = [...partyEl.querySelectorAll('.qf-fc-hero')]
    const bossSlot = h('div', { className: 'qf-fc-boss' })
    const throne = h('div', { className: 'qf-fc-throne' }, [h('div', { className: 'back' }), h('div', { className: 'dais' })])
    const horde = h('div', { className: 'qf-fc-horde' })

    const burst = h('div', { className: 'qf-fc-burst' },
      Array.from({ length: 18 }, (_, i) => {
        const ang = (i / 18) * Math.PI * 2, d = 130 + (i % 4) * 44
        return h('i', { style: { '--dx': `${Math.cos(ang) * d}px`, '--dy': `${Math.sin(ang) * d - 50}px`, left: '0', bottom: '0', animationDelay: `${(i % 5) * 28}ms` } })
      }))
    const embers = h('div', {}, Array.from({ length: 24 }, () => {
      const sz = 3 + Math.round(Math.random() * 3)
      return h('div', { className: 'qf-fc-emb', style: { left: Math.round(Math.random() * 100) + '%', width: sz + 'px', height: sz + 'px', animationDuration: (6 + Math.random() * 7) + 's', animationDelay: (Math.random() * 8) + 's' } })
    }))
    const dust = h('div', {}, Array.from({ length: 16 }, () => {
      const sz = 2 + Math.round(Math.random() * 2)
      return h('div', { className: 'qf-fc-dust', style: { left: Math.round(Math.random() * 100) + '%', top: Math.round(20 + Math.random() * 50) + '%', width: sz + 'px', height: sz + 'px', '--dx': (Math.round(Math.random() * 60 - 30)) + 'px', animationDuration: (10 + Math.random() * 8) + 's', animationDelay: (Math.random() * 10) + 's' } })
    }))
    const skels = h('div', {}, [
      h('img', { className: 'qf-fc-skel', src: 'assets/sprites/decor-skel-wall-1.png', style: { left: '20%', top: '24%', width: '70px' }, on: { error: e => e.currentTarget.remove() } }),
      h('img', { className: 'qf-fc-skel', src: 'assets/sprites/decor-skel-wall-2.png', style: { right: '21%', top: '22%', width: '70px' }, on: { error: e => e.currentTarget.remove() } }),
    ])

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
      ...buildCryptBackdrop(), skels,
      h('div', { className: 'qf-fc-shaft a' }), h('div', { className: 'qf-fc-shaft b' }),
      h('div', { className: 'qf-fc-shaft c' }), h('div', { className: 'qf-fc-shaft d' }),
      h('div', { className: 'qf-fc-spot' }), h('div', { className: 'qf-fc-ground' }),
      throne, embers, dust, partyEl, horde, bossSlot, burst,
      h('div', { className: 'qf-fc-pillar l' }), h('div', { className: 'qf-fc-pillar r' }),
    ])
    this._el = h('div', { className: 'qf-fc' }, [
      world, red, flash, h('div', { className: 'qf-fc-vig' }),
      h('div', { className: 'qf-fc-bar t' }), h('div', { className: 'qf-fc-bar b' }),
      h('div', { className: 'qf-fc-cap' }, [eyebrow, capLine]), reveal, foot,
      h('button', { className: 'qf-fc-skip', on: { click: () => this._finish(true) } }, 'Skip ▸▸'),
    ])
    ;(document.getElementById('hud-stage') || document.body).appendChild(this._el)
    window.addEventListener('keydown', this._esc)

    this._fillBoss(bossSlot, archId)
    this._heroSlots.forEach(s => this._setHero(s, 'walk', 'right'))   // marching in

    const at = (ms, fn) => this._timers.push(setTimeout(fn, ms))
    const setLine = (t) => { capLine.textContent = t; capLine.classList.remove('on'); void capLine.offsetWidth; capLine.classList.add('on') }

    at(60,   () => this._el.classList.add('framed'))
    at(260,  () => { this._el.classList.add('marched', 'bossShown'); eyebrow.classList.add('on') })          // A: walk in
    at(3300, () => this._heroSlots.forEach(s => this._setHero(s, s.dataset.atk, 'right')))                   // arrive → attack
    at(4900, () => { flash.classList.add('go'); this._el.classList.add('bossFell'); eyebrow.classList.remove('on'); setLine('…and the monster always fell.') }) // B
    at(9000, () => {                                                                                          // C: THE FLIP
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go')
      red.classList.add('go'); burst.classList.add('go')
      this._el.classList.remove('bossFell'); this._el.classList.add('flipped', 'shake')
      setTimeout(() => this._el && this._el.classList.remove('shake'), 650)
      this._heroSlots.forEach(s => this._setHero(s, 'walk', 'left'))     // flee (walk-left always present; run may not be)
      this._spawnHorde(horde)
      setLine('Not this time.')
    })
    at(13400, () => { capLine.classList.remove('on'); reveal.classList.add('on') })                          // D
    at(15800, () => foot.classList.add('on'))                                                                // E
  }

  _fillBoss(slot, archId) {
    if (!archId) return
    const a = animatedBossSprite(archId, 300)
    if (a?.el) { slot.replaceChildren(a.el); if (a.stop) this._stopFns.push(a.stop) }
  }

  // Fill / re-fill a hero slot with a specific action anim (walk/atk/run). Stores
  // the target on the slot so a late on-demand sheet load fills the CURRENT beat.
  _setHero(slot, anim, dir) {
    const cls = slot.dataset.cls
    slot.dataset.anim = anim; slot.dataset.dir = dir
    const put = () => {
      if (!this._el) return true
      const a = animatedAdventurerAnim(cls, slot.dataset.anim, slot.dataset.dir, 152) || animatedAdventurer(cls, 152)
      if (a?.el) {
        if (slot._stop) { try { slot._stop() } catch {} }
        slot._stop = a.stop || null; if (a.stop) this._stopFns.push(a.stop)
        slot.replaceChildren(a.el); slot.dataset.filled = '1'; return true
      }
      return false
    }
    if (put()) return
    const scene = window.__game?.scene?.getScene?.('Game')
    if (!scene) return
    if (ensureAdventurerBaseSheet(scene, cls, 'v01')) { put(); return }
    scene.load.once(`filecomplete-spritesheet-adv-${cls}-v01`, () => setTimeout(put, 50))
    let tries = 0
    const poll = () => { if (!this._el || put() || tries++ > 25) return; setTimeout(poll, 200) }
    setTimeout(poll, 300)
  }

  _spawnHorde(horde) {
    const n = HORDE.length
    HORDE.forEach((id, i) => {
      const a = animatedMinion(id, 84)
      const m = h('div', { className: 'm', style: { left: `${(i + 0.5) / n * 100}%`, marginLeft: '-42px', animationDelay: `${i * 90}ms` } },
        a?.el ? [a.el] : [])
      if (a?.stop) this._stopFns.push(a.stop)
      horde.appendChild(m)
    })
    void horde.offsetWidth
    horde.classList.add('go')
  }

  _finish(skipped) {
    if (!this._el) return
    if (this._gameState?.meta) { this._gameState.meta.introSeen = true; this._gameState.meta.tutorialEnabled = this._tutChecked }
    try { localStorage.setItem('qf.gameplay.tutorials', this._tutChecked ? 'true' : 'false') } catch {}
    EventBus.emit('INTRO_DISMISSED', { tutorialEnabled: this._tutChecked, skipped: !!skipped })
    this.destroy()
  }

  destroy() {
    for (const t of this._timers) clearTimeout(t); this._timers = []
    for (const s of this._stopFns) { try { s() } catch {} } this._stopFns = []
    window.removeEventListener('keydown', this._esc)
    try { this._el?.remove() } catch {}
    this._el = null; this._heroSlots = []
  }
}

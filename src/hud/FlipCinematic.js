// FlipCinematic — Beat 0 of the onboarding overhaul (the "premise-setter").
// A short, skippable, sprite-animated CINEMATIC that installs the inversion
// ("you ARE the dungeon"). See DESIGN.md "Onboarding overhaul — LOCKED".
//
// v4 detail pass: heroes WALK in → melee LUNGE + ranged fire on the throned
// monster (with slash-arc / arrow / bolt VFX + impacts) → it falls → THE FLIP
// (it erupts huge; gold/blood glow + ember burst + shake + camera push-in) →
// a RANDOM, spread-out minion HORDE pours out + the heroes RUN OFF-SCREEN →
// "YOU ARE THE DUNGEON" → ENTER.
// Rich throne room: detailed throne + flanking banners + ritual pentacle + a
// carpet runner, tiled floor + floor bones, lots of wall decor (skeletons,
// chains, skulls, statues), pillars, light shafts, embers + dust, vignette,
// letterbox bars.
//
// Same lifecycle/handoff as the old intro. Skippable (SKIP/Esc).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { buildCryptBackdrop } from './menuBackdrop.js'
import { animatedBossSprite, animatedAdventurer, animatedAdventurerAnim, animatedAdventurerAtk } from './inGameSnapshot.js'
import { ensureAdventurerBaseSheet } from '../scenes/AdventurerBaseLoader.js'
import { requestAdvAtkSheet } from '../scenes/AdventurerAtkLoader.js'

// party: class, attack anim, and whether it's melee (lunges in) or ranged (fires)
const PARTY = [
  { cls: 'knight', glyph: '⚔', atk: 'slash',     melee: true },                    // ONLY melee — charges + swings
  { cls: 'cleric', glyph: '✚', atk: 'spellcast', melee: false, bolt: 'holy' },     // holds back, CASTS
  { cls: 'mage',   glyph: '✦', atk: 'thrust',    melee: false, bolt: 'arcane', weapon: true },   // holds back, staff THRUST (weapon via _atk)
  { cls: 'ranger', glyph: '➶', atk: 'shoot',     melee: false, bolt: 'arrow' },    // holds back, shoots
]
const DEC = (f) => `assets/sprites/${f}`

let _cssInjected = false
function _injectCss() {
  if (_cssInjected) return
  _cssInjected = true
  const css = `
  .qf-fc { position:absolute; inset:0; z-index:3500; overflow:hidden; pointer-events:auto;
    font-family:'Press Start 2P',monospace; background:rgba(3,2,7,1); }
  .qf-fc-world { position:absolute; left:50%; top:50%; width:1920px; height:1080px; z-index:1;
    transform: translate(-50%,-50%) scale(var(--fc-scale,1)); transform-origin:50% 50%; }
  .qf-fc-scene { position:absolute; inset:0; transform-origin:50% 56%; transition: transform 1.1s cubic-bezier(.3,.7,.25,1); }
  .qf-fc.flipped .qf-fc-scene { transform: scale(1.13); }
  .qf-fc-spot { position:absolute; left:50%; top:50%; width:1460px; height:1460px; transform:translate(-50%,-42%); pointer-events:none;
    opacity:.45; transition:opacity .8s ease, background .8s ease;
    background: radial-gradient(circle, rgba(212,166,72,.16) 0%, rgba(212,166,72,.05) 32%, transparent 60%); }
  .qf-fc.flipped .qf-fc-spot { opacity:1; background: radial-gradient(circle, rgba(200,51,74,.3) 0%, rgba(212,166,72,.13) 34%, transparent 64%); }
  .qf-fc-shaft { position:absolute; top:-14%; width:238px; height:138%; pointer-events:none; opacity:.15; mix-blend-mode:screen;
    background: linear-gradient(180deg, rgba(255,210,130,.5), transparent 72%); filter:blur(7px); }
  .qf-fc-shaft.a{left:9%;transform:rotate(11deg)} .qf-fc-shaft.b{left:33%;transform:rotate(6deg);opacity:.09}
  .qf-fc-shaft.c{right:33%;transform:rotate(-6deg);opacity:.09} .qf-fc-shaft.d{right:9%;transform:rotate(-11deg)}
  .qf-fc-pillar { position:absolute; top:0; bottom:0; width:13%; z-index:6; pointer-events:none;
    background: linear-gradient(90deg, rgba(2,1,6,.97), rgba(6,4,12,.5) 60%, transparent); }
  .qf-fc-pillar.r { right:0; transform:scaleX(-1); }
  .qf-fc-pillar::before { content:''; position:absolute; top:0; bottom:0; left:32%; width:48%;
    background: linear-gradient(90deg, rgba(22,15,28,.92), rgba(8,5,14,.96)); box-shadow: 2px 0 0 rgba(0,0,0,.6), inset -3px 0 9px rgba(0,0,0,.6); }
  .qf-fc-dec { position:absolute; image-rendering:pixelated; pointer-events:none; }
  /* real torch sprite + a warm glow halo behind it */
  /* real torch.png — SAME as the main menu: 172×192 frame (6-frame vertical strip)
     + 432 glow halo, reusing the global qcm-torchburn / qcm-flicker keyframes. */
  .qf-fc-torch { position:absolute; width:172px; height:192px; z-index:2; }
  .qf-fc-torchsprite { width:172px; height:192px; image-rendering:pixelated;
    background: url('assets/sprites/torch.png') 0 0 / 172px 1152px no-repeat;
    animation: qcm-torchburn .75s steps(6) infinite; filter: drop-shadow(0 0 20px rgba(255,150,60,.6)); }
  .qf-fc-torch.r .qf-fc-torchsprite { animation-delay: -.37s; }
  .qf-fc-torch::after { content:''; position:absolute; left:50%; top:96px; width:432px; height:432px; transform:translate(-50%,-50%); z-index:-1; pointer-events:none;
    background: radial-gradient(circle at 50% 50%, rgba(255,160,70,.42), rgba(255,120,45,.16) 42%, transparent 70%);
    mix-blend-mode:screen; animation: qcm-flicker 2.6s ease-in-out infinite; }
  /* floor */
  .qf-fc-ground { position:absolute; left:0; right:0; bottom:0; height:33%; z-index:1; pointer-events:none;
    background: repeating-linear-gradient(90deg, transparent 0, transparent 60px, rgba(0,0,0,.4) 60px, rgba(0,0,0,.4) 62px),
      linear-gradient(180deg, rgba(20,13,24,.5), rgba(2,1,6,.94)); }
  .qf-fc-ground::after { content:''; position:absolute; left:0; right:0; top:0; height:2px;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--gold) 60%, transparent), transparent); opacity:.6; }
  /* carpet runner to the throne */
  .qf-fc-carpet { position:absolute; left:50%; bottom:0; transform:translateX(-50%); width:120px; height:31%; z-index:1; pointer-events:none;
    background: linear-gradient(180deg, rgba(96,18,30,.5), rgba(58,10,20,.35)); clip-path: polygon(36% 0, 64% 0, 100% 100%, 0% 100%);
    box-shadow: 0 0 30px rgba(120,20,34,.3); }
  .qf-fc-carpet::before { content:''; position:absolute; inset:0; clip-path: polygon(40% 0, 60% 0, 92% 100%, 8% 100%);
    border-left:2px solid rgba(212,166,72,.25); border-right:2px solid rgba(212,166,72,.25); }
  /* ritual pentacle under the throne */
  /* throne */
  .qf-fc-throne { position:absolute; left:50%; bottom:27%; transform:translateX(-50%); z-index:1; pointer-events:none; width:300px; height:370px; }
  /* gothic pointed-arch back (clip-path silhouette) + gold inlay */
  .qf-fc-throne .back { position:absolute; left:50%; bottom:40px; transform:translateX(-50%); width:176px; height:330px;
    background: linear-gradient(180deg, rgba(46,33,54,.98), rgba(15,10,21,.98));
    clip-path: polygon(50% 0, 66% 11%, 66% 27%, 86% 36%, 80% 100%, 20% 100%, 14% 36%, 34% 27%, 34% 11%);
    box-shadow: inset 0 0 34px rgba(0,0,0,.82); }
  .qf-fc-throne .back::before { content:''; position:absolute; inset:13px; clip-path:inherit; border:2px solid rgba(212,166,72,.3); }
  .qf-fc-throne .recess { position:absolute; left:50%; bottom:66px; transform:translateX(-50%); width:100px; height:180px; z-index:1;
    background: radial-gradient(ellipse at 50% 32%, rgba(0,0,0,.9), rgba(22,13,28,.35) 75%, transparent); border-radius:50px 50px 8px 8px; }
  .qf-fc-throne .crest { position:absolute; left:50%; top:-4px; transform:translateX(-50%); width:50px; image-rendering:pixelated;
    filter: drop-shadow(0 0 9px rgba(212,166,72,.55)); z-index:2; }
  .qf-fc-throne .arm { position:absolute; bottom:66px; width:30px; height:118px; background: linear-gradient(180deg, rgba(50,35,58,.98), rgba(16,10,22,.98));
    border-radius:14px 14px 4px 4px; box-shadow: inset 0 0 9px rgba(0,0,0,.7), 0 0 0 1px rgba(212,166,72,.16); }
  .qf-fc-throne .arm.l { left:24px } .qf-fc-throne .arm.r { right:24px }
  .qf-fc-throne .arm::after { content:''; position:absolute; top:-13px; left:50%; transform:translateX(-50%); width:20px; height:20px; border-radius:50%;
    background: radial-gradient(circle at 40% 35%, rgba(255,215,130,.95), rgba(150,95,35,.4)); box-shadow:0 0 12px rgba(212,166,72,.6); }
  .qf-fc-throne .seat { position:absolute; left:50%; bottom:52px; transform:translateX(-50%); width:122px; height:34px;
    background: linear-gradient(180deg, rgba(122,22,34,.92), rgba(58,10,18,.94)); border-radius:6px; box-shadow: inset 0 -7px 11px rgba(0,0,0,.55), inset 0 2px 0 rgba(212,166,72,.18); }
  .qf-fc-throne .dais { position:absolute; left:50%; bottom:0; transform:translateX(-50%); width:284px; height:48px;
    background: linear-gradient(180deg, rgba(42,29,48,.97), rgba(8,5,12,.98)); clip-path: polygon(9% 0, 91% 0, 100% 100%, 0 100%);
    box-shadow: 0 0 28px rgba(0,0,0,.7); }
  .qf-fc-throne .dais::before { content:''; position:absolute; left:13%; right:13%; top:42%; bottom:0;
    background: linear-gradient(180deg, rgba(56,40,62,.92), rgba(18,11,24,.94)); clip-path: polygon(8% 0, 92% 0, 100% 100%, 0 100%); }
  /* sprites */
  .qf-fc-party { position:absolute; bottom:29%; left:7%; display:flex; gap:18px; align-items:flex-end; z-index:3; transform:translateX(-1280px); transition: transform 2.9s linear; }
  .qf-fc.marched .qf-fc-party { transform:translateX(0); }
  .qf-fc.fled .qf-fc-party { transform: translateX(-2200px); transition: transform 2.6s cubic-bezier(.45,.05,.6,.6); }
  .qf-fc-hero { width:150px; height:150px; display:flex; align-items:flex-end; justify-content:center;
    color: color-mix(in srgb, var(--gold) 60%, white); font-size:56px; filter: drop-shadow(0 6px 7px rgba(0,0,0,.7));
    transition: transform .35s cubic-bezier(.3,1.4,.5,1); }
  .qf-fc-hero.lunge { transform: translateX(60px) translateY(-6px); }
  .qf-fc-hero canvas, .qf-fc-hero img { image-rendering:pixelated; width:100%; height:100%; object-fit:contain; }
  /* weapon-attack mode: the 192px _atk sprite (456 box) overflows the slot; the
     translateY lands its foot (origin 0.617) on the same ground line as the
     152px walk body. */
  .qf-fc-hero.atk-mode { overflow: visible; }
  .qf-fc-hero.atk-mode canvas { width:456px; height:456px; transform: translateY(152px); image-rendering:pixelated; }
  .qf-fc-boss { position:absolute; left:50%; bottom:26%; transform:translateX(-50%) translateY(26px) scale(.94); z-index:4;
    width:300px; height:300px; display:flex; align-items:flex-end; justify-content:center; opacity:0;
    transition: opacity .6s ease, transform .7s ease, filter .7s ease; }
  .qf-fc-boss canvas, .qf-fc-boss img { image-rendering:pixelated; width:100%; height:100%; object-fit:contain; }
  .qf-fc.bossShown .qf-fc-boss { opacity:1; transform:translateX(-50%) translateY(0) scale(1); filter: drop-shadow(0 8px 10px rgba(0,0,0,.6)); }
  .qf-fc.bossFell .qf-fc-boss { opacity:.5; transform:translateX(-50%) translateY(40px) scale(.86) rotate(-10deg); filter: grayscale(.7) brightness(.45); transition: all .55s ease .12s; }
  .qf-fc.flipped .qf-fc-boss { opacity:1; bottom:30%; transform:translateX(-50%) translateY(0) scale(1.55);
    filter: drop-shadow(0 0 36px rgba(212,166,72,.85)) drop-shadow(0 0 64px rgba(200,51,74,.5)) brightness(1.14);
    transition: opacity .5s, transform .9s cubic-bezier(.2,.85,.2,1), filter .9s; }
  /* combat VFX */
  .qf-fc-proj { position:absolute; z-index:4; pointer-events:none; }
  .qf-fc-proj.arrow { width:26px; height:3px; background: linear-gradient(90deg, transparent, rgba(230,210,170,1)); box-shadow:0 0 5px rgba(230,210,170,.8); }
  .qf-fc-proj.arcane { width:14px; height:14px; border-radius:50%; background: radial-gradient(circle, rgba(190,140,255,1), rgba(120,60,220,.3)); box-shadow:0 0 12px rgba(170,110,255,.9); }
  .qf-fc-proj.holy { width:15px; height:15px; border-radius:50%; background: radial-gradient(circle, rgba(255,244,200,1), rgba(235,190,90,.35)); box-shadow:0 0 14px rgba(255,210,120,.95); }
  .qf-fc-slash { position:absolute; z-index:5; width:90px; height:90px; pointer-events:none; opacity:0;
    border-top:5px solid rgba(255,255,255,.9); border-right:5px solid rgba(255,255,255,.5); border-radius:50%; transform:rotate(35deg) scale(.5); }
  .qf-fc-slash.go { animation: qf-fc-slash .32s ease-out forwards; }
  @keyframes qf-fc-slash { 0%{opacity:0; transform:rotate(-10deg) scale(.4)} 40%{opacity:1} 100%{opacity:0; transform:rotate(60deg) scale(1.1)} }
  .qf-fc-hit { position:absolute; z-index:5; width:30px; height:30px; border-radius:50%; pointer-events:none; opacity:0;
    background: radial-gradient(circle, rgba(255,240,210,1), transparent 70%); }
  .qf-fc-hit.go { animation: qf-fc-hit .35s ease-out forwards; }
  @keyframes qf-fc-hit { 0%{opacity:1; transform:scale(.4)} 100%{opacity:0; transform:scale(1.6)} }
  /* flashes + shake + burst */
  .qf-fc-flash { position:absolute; inset:0; z-index:7; background:rgba(255,255,255,1); opacity:0; pointer-events:none; }
  .qf-fc-flash.go { animation: qf-fc-flash .6s ease-out; }
  @keyframes qf-fc-flash { 0%{opacity:0} 12%{opacity:.95} 100%{opacity:0} }
  .qf-fc-redo { position:absolute; inset:0; z-index:6; pointer-events:none; opacity:0; background: radial-gradient(circle at 50% 46%, rgba(200,51,74,.5), transparent 60%); }
  .qf-fc-redo.go { animation: qf-fc-redo 1.2s ease-out; }
  @keyframes qf-fc-redo { 0%{opacity:0} 18%{opacity:1} 100%{opacity:0} }
  .qf-fc.shake .qf-fc-scene { animation: qf-fc-shake .55s ease-out; }
  @keyframes qf-fc-shake { 0%,100%{transform:scale(1.13) translate(0,0)} 20%{transform:scale(1.13) translate(-11px,7px)} 40%{transform:scale(1.13) translate(10px,-8px)} 60%{transform:scale(1.13) translate(-8px,5px)} 80%{transform:scale(1.13) translate(6px,-3px)} }
  .qf-fc-burst { position:absolute; left:50%; bottom:42%; z-index:5; pointer-events:none; }
  .qf-fc-burst i { position:absolute; width:7px; height:7px; border-radius:50%; background: var(--gold); box-shadow:0 0 9px var(--gold); opacity:0; }
  .qf-fc-burst.go i { animation: qf-fc-spark 1.1s ease-out forwards; }
  @keyframes qf-fc-spark { 0%{opacity:1; transform:translate(0,0) scale(1)} 100%{opacity:0; transform:translate(var(--dx),var(--dy)) scale(.3)} }
  .qf-fc-emb { position:absolute; bottom:-10px; border-radius:50%; z-index:2; background: color-mix(in srgb, var(--gold) 80%, white); box-shadow:0 0 6px var(--gold); opacity:0; animation: qf-fc-rise linear infinite; }
  @keyframes qf-fc-rise { 0%{opacity:0; transform:translateY(0)} 12%{opacity:.8} 90%{opacity:.45} 100%{opacity:0; transform:translateY(-1040px)} }
  .qf-fc-dust { position:absolute; border-radius:50%; z-index:2; background:rgba(180,160,140,.5); opacity:0; animation: qf-fc-drift linear infinite; }
  @keyframes qf-fc-drift { 0%{opacity:0} 20%{opacity:.4} 80%{opacity:.22} 100%{opacity:0; transform:translate(var(--dx), -432px)} }
  .qf-fc-vig { position:absolute; inset:0; z-index:8; pointer-events:none; background: radial-gradient(135% 105% at 50% 46%, transparent 36%, rgba(2,1,5,.92) 100%); }
  .qf-fc-bar { position:absolute; left:0; right:0; height:10.5%; z-index:9; background:rgba(0,0,0,1); transition: transform .7s cubic-bezier(.3,.7,.2,1); }
  .qf-fc-bar.t { top:0; transform:translateY(-100%); } .qf-fc-bar.b { bottom:0; transform:translateY(100%); }
  .qf-fc.framed .qf-fc-bar.t, .qf-fc.framed .qf-fc-bar.b { transform:translateY(0); }
  .qf-fc-cap { position:absolute; left:0; right:0; bottom:16%; z-index:10; text-align:center; pointer-events:none; }
  .qf-fc-eyebrow { font-family:'Silkscreen',monospace; font-size:15px; letter-spacing:.3em; text-transform:uppercase; color: color-mix(in srgb, var(--gold) 72%, white); opacity:0; transition:opacity .8s ease; text-shadow:0 2px 6px rgba(0,0,0,.9); }
  .qf-fc-eyebrow.on { opacity:.92; }
  .qf-fc-line { margin-top:14px; font-size:18px; letter-spacing:.05em; color: var(--bone); text-shadow:0 2px 0 rgba(0,0,0,.8); opacity:0; transform:translateY(8px); transition: opacity .6s ease, transform .6s ease; }
  .qf-fc-line.on { opacity:1; transform:none; }
  .qf-fc-reveal { position:absolute; left:0; right:0; top:30%; z-index:10; text-align:center; pointer-events:none; opacity:0; transform: scale(.82); transition: opacity .7s ease, transform .9s cubic-bezier(.2,.9,.25,1); }
  .qf-fc-reveal.on { opacity:1; transform:none; }
  .qf-fc-title { font-size:62px; letter-spacing:.07em; line-height:1.15; color: var(--gold); text-shadow: 0 0 26px rgba(212,166,72,.65), 0 5px 0 rgba(0,0,0,.85); }
  .qf-fc-title b { color: var(--blood); text-shadow: 0 0 28px rgba(200,51,74,.7), 0 5px 0 rgba(0,0,0,.85); }
  .qf-fc-sub { margin-top:20px; font-family:'Silkscreen',monospace; font-size:16px; letter-spacing:.16em; color: color-mix(in srgb, var(--bone) 80%, var(--gold)); text-transform:uppercase; text-shadow:0 2px 6px rgba(0,0,0,.9); }
  .qf-fc-foot { position:absolute; left:0; right:0; bottom:13%; z-index:11; display:flex; flex-direction:column; align-items:center; gap:18px; opacity:0; transform:translateY(12px); transition: opacity .6s ease, transform .6s ease; }
  .qf-fc-foot.on { opacity:1; transform:none; }
  .qf-fc-enter { position:relative; overflow:hidden; cursor:pointer; font-family:'Press Start 2P',monospace; font-size:15px; letter-spacing:.07em; text-transform:uppercase; color: rgba(20,8,2,1);
    background: linear-gradient(180deg, color-mix(in srgb, var(--gold) 72%, white), var(--gold)); border:1px solid rgba(0,0,0,.5); border-radius:3px; padding:17px 30px;
    box-shadow: inset 1px 1px 0 rgba(255,255,255,.3), inset -1px -1px 0 rgba(0,0,0,.4), 0 5px 0 rgba(0,0,0,.6); }
  .qf-fc-enter::before { content:''; position:absolute; top:0; bottom:0; left:-60%; width:38%; transform:skewX(-20deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent); animation: qf-fc-sheen 2.4s ease-in-out infinite; }
  @keyframes qf-fc-sheen { 0%,60%{left:-60%} 100%{left:140%} }
  .qf-fc-enter:active { transform:translateY(2px); }
  .qf-fc-tut { display:flex; align-items:center; gap:9px; cursor:pointer; font-family:'Silkscreen',monospace; font-size:12px; letter-spacing:.08em; color: color-mix(in srgb, var(--bone) 70%, transparent); }
  .qf-fc-tut .box { width:16px; height:16px; border:1px solid color-mix(in srgb, var(--gold) 50%, var(--bone)); border-radius:2px; display:flex; align-items:center; justify-content:center; color: var(--gold); font-size:12px; background:rgba(0,0,0,.3); }
  .qf-fc-skip { position:absolute; right:26px; top:3%; z-index:12; pointer-events:auto; cursor:pointer; font-family:'Silkscreen',monospace; font-size:12px; letter-spacing:.16em; text-transform:uppercase; color: rgba(240,230,212,.5); background:none; border:none; }
  .qf-fc-skip:hover { color: var(--bone); }
  `
  const tag = document.createElement('style'); tag.id = 'qf-fc-style'; tag.textContent = css
  document.head.appendChild(tag)
}

export class FlipCinematic {
  constructor(gameState) {
    this._gameState = gameState
    this._el = null; this._timers = []; this._stopFns = []; this._heroSlots = []
    this._tutChecked = true
    this._esc = (e) => { if (e.key === 'Escape') this._finish(true) }
    this._onResize = () => this._fit()
  }

  // Scale the fixed 1920×1080 scene to fit the (variable-size) stage so the whole
  // composition scales as one unit — nothing overlaps on smaller windows.
  _fit() {
    if (!this._el) return
    const w = this._el.clientWidth || window.innerWidth
    const hgt = this._el.clientHeight || window.innerHeight
    this._el.style.setProperty('--fc-scale', Math.min(w / 1920, hgt / 1080))
  }

  maybeOpen() { if (!this._gameState?.meta?.introSeen) this.open() }

  open() {
    if (this._el || this._gameState?.meta?.introSeen) return
    _injectCss()
    const archId = this._gameState?.player?.bossArchetypeId

    const partyEl = h('div', { className: 'qf-fc-party' },
      PARTY.map(p => h('div', { className: 'qf-fc-hero', dataset: { cls: p.cls, atk: p.atk, melee: p.melee ? '1' : '', weapon: p.weapon ? '1' : '', bolt: p.bolt || '' } }, p.glyph)))
    this._heroSlots = [...partyEl.querySelectorAll('.qf-fc-hero')]
    const bossSlot = h('div', { className: 'qf-fc-boss' })
    const fxLayer = h('div', { className: 'qf-fc-fx' })

    // throne (detailed) + flanking banners/statues + pentacle + carpet
    const throne = h('div', { className: 'qf-fc-throne' }, [
      h('div', { className: 'dais' }),
      h('div', { className: 'back' }),
      h('div', { className: 'recess' }),
      h('div', { className: 'arm l' }), h('div', { className: 'arm r' }),
      h('div', { className: 'seat' }),
    ])
    const dec = (file, st, extra) => h('img', { className: 'qf-fc-dec' + (extra ? ' ' + extra : ''), src: DEC(file), style: st, on: { error: e => e.currentTarget.remove() } })
    const setDressing = h('div', {}, [
      // statues framing
      dec('decor-statue-l.png', { left: '22%', bottom: '33%', width: '94px', opacity: .62, zIndex: 3 }),
      dec('decor-statue-l.png', { right: '22%', bottom: '33%', width: '94px', opacity: .62, zIndex: 3, transform: 'scaleX(-1)' }),
      // CHAINED WALL SKELETONS (varied) — the macabre throne-room read
      dec('decor-skel-wall-1.png', { left: '12%', top: '17%', width: '74px', opacity: .45 }),
      dec('decor-skel-wall-2.png', { right: '13%', top: '16%', width: '74px', opacity: .45 }),
      dec('decor-skel-wall-2.png', { left: '29%', top: '23%', width: '60px', opacity: .36 }),
      dec('decor-skel-wall-1.png', { right: '30%', top: '24%', width: '60px', opacity: .36 }),
      // torches flanking the throne — the REAL torch.png sprite-strip at the SAME
      // size as the main menu (172×192 frame, 6-frame burn) + the matching glow.
      h('div', { className: 'qf-fc-torch l', style: { left: '24%', top: '26%' } }, [h('div', { className: 'qf-fc-torchsprite' })]),
      h('div', { className: 'qf-fc-torch r', style: { right: '24%', top: '26%' } }, [h('div', { className: 'qf-fc-torchsprite' })]),
      // floor bones
      dec('decor-skel-floor-1.png', { left: '18%', bottom: '24%', width: '60px', opacity: .4, zIndex: 1 }),
      dec('decor-skull-pile.png', { right: '20%', bottom: '24%', width: '56px', opacity: .45, zIndex: 1 }),
    ])

    const burst = h('div', { className: 'qf-fc-burst' },
      Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * Math.PI * 2, d = 130 + (i % 4) * 44; return h('i', { style: { '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 50}px`, left: '0', bottom: '0', animationDelay: `${(i % 5) * 28}ms` } }) }))
    const embers = h('div', {}, Array.from({ length: 26 }, () => { const sz = 3 + Math.round(Math.random() * 3); return h('div', { className: 'qf-fc-emb', style: { left: Math.round(Math.random() * 100) + '%', width: sz + 'px', height: sz + 'px', animationDuration: (6 + Math.random() * 7) + 's', animationDelay: (Math.random() * 8) + 's' } }) }))
    const dust = h('div', {}, Array.from({ length: 18 }, () => { const sz = 2 + Math.round(Math.random() * 2); return h('div', { className: 'qf-fc-dust', style: { left: Math.round(Math.random() * 100) + '%', top: Math.round(18 + Math.random() * 54) + '%', width: sz + 'px', height: sz + 'px', '--dx': (Math.round(Math.random() * 60 - 30)) + 'px', animationDuration: (10 + Math.random() * 8) + 's', animationDelay: (Math.random() * 10) + 's' } }) }))

    const flash = h('div', { className: 'qf-fc-flash' })
    const red   = h('div', { className: 'qf-fc-redo' })
    const eyebrow = h('div', { className: 'qf-fc-eyebrow' }, 'For ages, heroes plundered the dark…')
    const capLine = h('div', { className: 'qf-fc-line' }, '')
    const reveal = h('div', { className: 'qf-fc-reveal' }, [
      h('div', { className: 'pix qf-fc-title', html: 'YOU ARE THE <b>DUNGEON</b>' }),
      h('div', { className: 'qf-fc-sub' }, 'They come to kill you. Make them fail.'),
    ])
    const tutBox = h('span', { className: 'box' }, '✓')
    const foot = h('div', { className: 'qf-fc-foot' }, [
      h('button', { className: 'qf-fc-enter', on: { click: () => this._finish(false) } }, 'Enter the Dungeon ▸'),
      h('div', { className: 'qf-fc-tut', on: { click: () => { this._tutChecked = !this._tutChecked; tutBox.textContent = this._tutChecked ? '✓' : '' } } }, [tutBox, 'Show me how to play']),
    ])

    // The SCENE is authored at a fixed 1920×1080 and the WORLD scales it to fit the
    // stage (which has a variable logical size) — so every element scales together
    // and nothing overlaps on smaller windows. Full-screen UI (bars, vignette,
    // captions, button) stays a sibling overlay at .qf-fc level (viewport-relative).
    const scene = h('div', { className: 'qf-fc-scene' }, [
      ...buildCryptBackdrop(), setDressing,
      h('div', { className: 'qf-fc-shaft a' }), h('div', { className: 'qf-fc-shaft b' }), h('div', { className: 'qf-fc-shaft c' }), h('div', { className: 'qf-fc-shaft d' }),
      h('div', { className: 'qf-fc-spot' }), h('div', { className: 'qf-fc-ground' }), h('div', { className: 'qf-fc-carpet' }),
      throne, embers, dust, partyEl, bossSlot, fxLayer, burst,
      h('div', { className: 'qf-fc-pillar l' }), h('div', { className: 'qf-fc-pillar r' }),
    ])
    const world = h('div', { className: 'qf-fc-world' }, [scene])
    this._el = h('div', { className: 'qf-fc' }, [
      world, red, flash, h('div', { className: 'qf-fc-vig' }),
      h('div', { className: 'qf-fc-bar t' }), h('div', { className: 'qf-fc-bar b' }),
      h('div', { className: 'qf-fc-cap' }, [eyebrow, capLine]), reveal, foot,
      h('button', { className: 'qf-fc-skip', on: { click: () => this._finish(true) } }, 'Skip ▸▸'),
    ])
    ;(document.getElementById('hud-stage') || document.body).appendChild(this._el)
    this._fit(); window.addEventListener('resize', this._onResize)
    window.addEventListener('keydown', this._esc)
    this._fxLayer = fxLayer

    this._fillBoss(bossSlot, archId)
    this._heroSlots.forEach(s => this._setHero(s, 'walk', 'right'))
    // Pre-load the 192px weapon (_atk) sheets for any class that swings/thrusts a
    // weapon (knight melee + mage staff) so the blade shows by the assault beat.
    const atkScene = window.__game?.scene?.getScenes?.(true)?.[0] || window.__game?.scene?.getScene?.('Game')
    if (atkScene) this._heroSlots.forEach(s => { if (s.dataset.melee === '1' || s.dataset.weapon === '1') { try { requestAdvAtkSheet(atkScene, `adv-${s.dataset.cls}-v01`) } catch {} } })

    const at = (ms, fn) => this._timers.push(setTimeout(fn, ms))
    const setLine = (t) => { capLine.textContent = t; capLine.classList.remove('on'); void capLine.offsetWidth; capLine.classList.add('on') }

    at(60,   () => this._el.classList.add('framed'))
    at(260,  () => { this._el.classList.add('marched', 'bossShown'); eyebrow.classList.add('on') })
    at(3300, () => this._assault())                                                                          // arrive → measured assault
    at(5600, () => { flash.classList.add('go'); this._el.classList.add('bossFell'); eyebrow.classList.remove('on'); setLine('…and the monster always fell.'); this._ceaseAssault() })  // boss falls → everyone STOPS + stands at ease
    at(9000, () => {                                                                                          // THE FLIP
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go'); red.classList.add('go'); burst.classList.add('go')
      this._el.classList.remove('bossFell'); this._el.classList.add('flipped', 'shake')
      setTimeout(() => this._el && this._el.classList.remove('shake'), 650)
      this._heroSlots.forEach(s => this._setHero(s, 'walk', 'left'))
      setTimeout(() => this._el && this._el.classList.add('fled'), 220)   // run off-screen
      setLine('Not this time.')
    })
    at(13400, () => { capLine.classList.remove('on'); reveal.classList.add('on') })
    at(15800, () => foot.classList.add('on'))
  }

  // Cinematic assault: melee lunge in + slash arcs; ranged fire projectiles;
  // impacts on the boss. Repeats a couple of beats over ~1.5s.
  // Measured assault (no spam): the KNIGHT charges in SLOWLY then swings on a
  // beat — swing → idle → swing. Ranged hold the line and fire spaced bolts (mage
  // shows its staff via the _atk thrust sheet). All timers are tracked so the boss
  // fall can cancel them mid-assault.
  _assault() {
    if (!this._el) return
    this._assaultTimers = []
    const T = (t, fn) => { const id = setTimeout(() => { if (this._el) fn() }, t); this._assaultTimers.push(id) }
    const knight = this._heroSlots.find(s => s.dataset.melee === '1')
    if (knight) {
      knight.style.transition = 'transform 1s ease-out'   // weighty charge, not a zoom
      knight.style.transform = 'translateX(634px)'
      ;[1000, 2000].forEach(t => {                          // two measured swings, idle between (full arc then rest)
        T(t,       () => { this._setHeroAtk(knight, 'slash', 'right'); this._slashAt(knight) })
        T(t + 620, () => this._setHero(knight, 'idle', 'right'))
      })
    }
    // ranged hold the line; mage shows its staff (weapon via _atk), all fire spaced bolts
    this._heroSlots.filter(s => s.dataset.melee !== '1').forEach((s, i) => {
      if (s.dataset.weapon === '1') this._setHeroAtk(s, s.dataset.atk, 'right')
      else this._setHero(s, s.dataset.atk, 'right')
      ;[700 + i * 150, 1700 + i * 150].forEach(t => T(t, () => this._fire(s, s.dataset.bolt)))
    })
  }

  // Boss is down — cancel any pending swings/shots and everyone stands at ease
  // (idle), facing the fallen boss, until the flip.
  _ceaseAssault() {
    ;(this._assaultTimers || []).forEach(clearTimeout); this._assaultTimers = []
    this._heroSlots.forEach(s => this._setHero(s, 'idle', 'right'))
  }

  _bossCenter() {
    const b = this._el?.querySelector('.qf-fc-boss'); const w = this._el?.querySelector('.qf-fc-world')
    if (!b || !w) return null
    const br = b.getBoundingClientRect(), wr = w.getBoundingClientRect()
    return { x: br.left - wr.left + br.width / 2, y: br.top - wr.top + br.height * 0.42 }
  }
  _heroCenter(s) {
    const w = this._el?.querySelector('.qf-fc-world'); if (!s || !w) return null
    const sr = s.getBoundingClientRect(), wr = w.getBoundingClientRect()
    return { x: sr.left - wr.left + sr.width * 0.7, y: sr.top - wr.top + sr.height * 0.45 }
  }
  _slashAt() {
    const c = this._bossCenter(); if (!c || !this._fxLayer) return
    const el = h('div', { className: 'qf-fc-slash', style: { left: (c.x - 45 + (Math.random() * 40 - 20)) + 'px', top: (c.y - 45) + 'px' } })
    this._fxLayer.appendChild(el); void el.offsetWidth; el.classList.add('go')
    this._hit(c.x, c.y); setTimeout(() => el.remove(), 400)
  }
  _fire(s, kind) {
    const from = this._heroCenter(s), to = this._bossCenter(); if (!from || !to || !this._fxLayer) return
    const el = h('div', { className: 'qf-fc-proj ' + (['arrow', 'arcane', 'holy'].includes(kind) ? kind : 'arcane'), style: { left: from.x + 'px', top: from.y + 'px' } })
    this._fxLayer.appendChild(el)
    requestAnimationFrame(() => { el.style.transition = 'left .26s linear, top .26s linear'; el.style.left = to.x + 'px'; el.style.top = to.y + 'px' })
    setTimeout(() => { this._hit(to.x, to.y); el.remove() }, 270)
  }
  _hit(x, y) {
    if (!this._fxLayer) return
    const el = h('div', { className: 'qf-fc-hit', style: { left: (x - 15) + 'px', top: (y - 15) + 'px' } })
    this._fxLayer.appendChild(el); void el.offsetWidth; el.classList.add('go'); setTimeout(() => el.remove(), 380)
  }

  _fillBoss(slot, archId) {
    if (!archId) return
    const a = animatedBossSprite(archId, 300)
    if (a?.el) { slot.replaceChildren(a.el); if (a.stop) this._stopFns.push(a.stop) }
  }

  _setHero(slot, anim, dir) {
    const cls = slot.dataset.cls; slot.dataset.anim = anim; slot.dataset.dir = dir
    slot.classList.remove('atk-mode')   // drop the 456px weapon sizing (else the flee/walk sprite goes giant)
    const put = () => {
      if (!this._el) return true
      const a = animatedAdventurerAnim(cls, slot.dataset.anim, slot.dataset.dir, 152) || animatedAdventurer(cls, 152)
      if (a?.el) { if (slot._stop) { try { slot._stop() } catch {} } slot._stop = a.stop || null; if (a.stop) this._stopFns.push(a.stop); slot.replaceChildren(a.el); slot.dataset.filled = '1'; return true }
      return false
    }
    if (put()) return
    const scene = window.__game?.scene?.getScene?.('Game'); if (!scene) return
    if (ensureAdventurerBaseSheet(scene, cls, 'v01')) { put(); return }
    scene.load.once(`filecomplete-spritesheet-adv-${cls}-v01`, () => setTimeout(put, 50))
    let tries = 0; const poll = () => { if (!this._el || put() || tries++ > 25) return; setTimeout(poll, 200) }; setTimeout(poll, 300)
  }

  // Swap a melee hero to the WEAPON-bearing 192px _atk attack sprite (blade
  // visible). atk-mode CSS sizes (456) + foot-aligns it. Falls back to the base
  // attack anim if the atk sheet isn't ready / this variant has no oversize weapon.
  _setHeroAtk(slot, anim, dir) {
    const cls = slot.dataset.cls
    const a = animatedAdventurerAtk(cls, anim, dir, 456)
    if (a?.el) {
      if (slot._stop) { try { slot._stop() } catch {} }
      slot._stop = a.stop || null; if (a.stop) this._stopFns.push(a.stop)
      slot.classList.add('atk-mode')
      slot.replaceChildren(a.el)
      return true
    }
    this._setHero(slot, anim, dir)
    return false
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
    ;(this._assaultTimers || []).forEach(clearTimeout); this._assaultTimers = []
    window.removeEventListener('keydown', this._esc)
    window.removeEventListener('resize', this._onResize)
    try { this._el?.remove() } catch {}
    this._el = null; this._heroSlots = []; this._fxLayer = null
  }
}

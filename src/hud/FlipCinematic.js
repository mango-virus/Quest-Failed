// FlipCinematic — Beat 0 of the onboarding overhaul (the "premise-setter").
// Replaces the old text WelcomeIntroOverlay with a short, skippable, sprite-
// animated cinematic that installs the inversion ("you ARE the dungeon") in the
// first ~20s. See DESIGN.md "Onboarding overhaul — LOCKED".
//
// Shot list: heroes march in → the monster falls (the old hero fantasy) → THE
// FLIP (flash; the fallen boss reanimates + rises, the heroes are cowed) →
// "YOU ARE THE DUNGEON" reveal → ENTER. Uses the run's REAL boss sprite + real
// adventurer sprites (on-demand load + swap, glyph placeholder until ready).
//
// Same lifecycle/handoff as the old intro so HudRoot can swap it in: maybeOpen()
// gated on meta.introSeen; _finish() sets introSeen + the tutorials pref + emits
// INTRO_DISMISSED. Fully skippable (SKIP / Esc).

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
    font-family:'Press Start 2P',monospace; background:rgba(5,3,10,1); }
  .qf-fc-vig { position:absolute; inset:0; pointer-events:none; z-index:3;
    background: radial-gradient(120% 90% at 50% 46%, transparent 42%, rgba(3,1,7,.92) 100%); }
  .qf-fc-stage { position:absolute; left:0; right:0; top:0; bottom:0; z-index:2; }
  .qf-fc-floor { position:absolute; left:0; right:0; bottom:23%; height:2px; z-index:2;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--gold) 50%, transparent), transparent); opacity:.5; }
  .qf-fc-party { position:absolute; bottom:24%; left:14%; display:flex; gap:22px; align-items:flex-end; z-index:2;
    transform:translateX(-58vw); opacity:0; transition: transform 2.6s cubic-bezier(.22,.7,.3,1), opacity 1.2s ease; }
  .qf-fc.marched .qf-fc-party { transform:translateX(0); opacity:1; }
  .qf-fc.flipped .qf-fc-party { transform: translateX(-7vw) scale(.62); opacity:.45; filter:brightness(.55) saturate(.7); transition: transform .7s ease, opacity .7s ease, filter .7s ease; }
  .qf-fc-hero { width:96px; height:96px; display:flex; align-items:flex-end; justify-content:center;
    color: color-mix(in srgb, var(--gold) 60%, white); font-size:40px;
    filter: drop-shadow(0 3px 4px rgba(0,0,0,.6)); animation: qf-fc-bob 1.5s ease-in-out infinite; }
  .qf-fc-hero:nth-child(2){ animation-delay:.2s } .qf-fc-hero:nth-child(3){ animation-delay:.4s } .qf-fc-hero:nth-child(4){ animation-delay:.6s }
  @keyframes qf-fc-bob { 0%,100%{ transform:translateY(0) } 50%{ transform:translateY(-5px) } }
  .qf-fc-hero canvas, .qf-fc-hero img { image-rendering:pixelated; width:100%; height:100%; object-fit:contain; }
  .qf-fc-boss { position:absolute; bottom:25%; right:17%; width:170px; height:170px; z-index:2;
    display:flex; align-items:flex-end; justify-content:center;
    opacity:0; transform: translateY(20px) scale(.9); transition: opacity .5s ease, transform .6s ease, filter .6s ease; }
  .qf-fc-boss canvas, .qf-fc-boss img { image-rendering:pixelated; width:100%; height:100%; object-fit:contain; }
  .qf-fc.bossShown .qf-fc-boss { opacity:1; transform: translateY(0) scale(1); }
  .qf-fc.bossFell .qf-fc-boss { opacity:.42; transform: translateY(34px) scale(.82) rotate(-12deg);
    filter: grayscale(.7) brightness(.5); transition: opacity .5s ease .15s, transform .6s ease .15s, filter .5s ease .15s; }
  .qf-fc.flipped .qf-fc-boss { opacity:1; left:0; right:0; margin:0 auto; bottom:27%; width:230px; height:230px;
    transform: translateY(0) scale(1.12); filter: drop-shadow(0 0 22px rgba(212,166,72,.7)) brightness(1.08);
    transition: opacity .5s ease, transform .8s cubic-bezier(.2,.8,.25,1), filter .8s ease, width .8s ease, height .8s ease; }
  .qf-fc-flash { position:absolute; inset:0; z-index:6; background:rgba(255,255,255,1); opacity:0; pointer-events:none; }
  .qf-fc-flash.go { animation: qf-fc-flash .55s ease-out; }
  @keyframes qf-fc-flash { 0%{ opacity:0 } 14%{ opacity:.92 } 100%{ opacity:0 } }
  .qf-fc.shake .qf-fc-stage { animation: qf-fc-shake .5s ease-out; }
  @keyframes qf-fc-shake { 0%,100%{ transform:translate(0,0) } 20%{ transform:translate(-7px,4px) } 40%{ transform:translate(6px,-5px) } 60%{ transform:translate(-5px,3px) } 80%{ transform:translate(4px,-2px) } }
  .qf-fc-cap { position:absolute; left:0; right:0; bottom:13%; z-index:7; text-align:center; pointer-events:none; }
  .qf-fc-eyebrow { font-family:'Silkscreen',monospace; font-size:12px; letter-spacing:.28em; text-transform:uppercase;
    color: color-mix(in srgb, var(--gold) 72%, white); opacity:0; transition:opacity .8s ease; }
  .qf-fc-eyebrow.on { opacity:.92; }
  .qf-fc-line { margin-top:14px; font-size:15px; letter-spacing:.04em; color: var(--bone);
    text-shadow:0 2px 0 rgba(0,0,0,.7); opacity:0; transform:translateY(8px); transition: opacity .6s ease, transform .6s ease; }
  .qf-fc-line.on { opacity:1; transform:none; }
  .qf-fc-reveal { position:absolute; left:0; right:0; top:30%; z-index:7; text-align:center; pointer-events:none;
    opacity:0; transform: scale(.84); transition: opacity .7s ease, transform .9s cubic-bezier(.2,.9,.25,1); }
  .qf-fc-reveal.on { opacity:1; transform:none; }
  .qf-fc-title { font-size:38px; letter-spacing:.06em; line-height:1.2;
    color: var(--gold); text-shadow: 0 0 18px rgba(212,166,72,.6), 0 4px 0 rgba(0,0,0,.8); }
  .qf-fc-title b { color: var(--bloodG, var(--blood)); }
  .qf-fc-sub { margin-top:18px; font-family:'Silkscreen',monospace; font-size:13px; letter-spacing:.12em;
    color: color-mix(in srgb, var(--bone) 80%, var(--gold)); text-transform:uppercase; }
  .qf-fc-foot { position:absolute; left:0; right:0; bottom:8%; z-index:8; display:flex; flex-direction:column; align-items:center; gap:16px;
    opacity:0; transform:translateY(10px); transition: opacity .6s ease, transform .6s ease; }
  .qf-fc-foot.on { opacity:1; transform:none; }
  .qf-fc-enter { position:relative; overflow:hidden; cursor:pointer; font-family:'Press Start 2P',monospace;
    font-size:13px; letter-spacing:.06em; text-transform:uppercase; color: rgba(20,8,2,1);
    background: linear-gradient(180deg, color-mix(in srgb, var(--gold) 72%, white), var(--gold));
    border:1px solid rgba(0,0,0,.5); border-radius:3px; padding:15px 26px;
    box-shadow: inset 1px 1px 0 rgba(255,255,255,.3), inset -1px -1px 0 rgba(0,0,0,.4), 0 4px 0 rgba(0,0,0,.6); }
  .qf-fc-enter::before { content:''; position:absolute; top:0; bottom:0; left:-60%; width:38%; transform:skewX(-20deg);
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent); animation: qf-fc-sheen 2.4s ease-in-out infinite; }
  @keyframes qf-fc-sheen { 0%,60%{ left:-60% } 100%{ left:140% } }
  .qf-fc-enter:active { transform:translateY(2px); }
  .qf-fc-tut { display:flex; align-items:center; gap:9px; cursor:pointer;
    font-family:'Silkscreen',monospace; font-size:11px; letter-spacing:.08em; color: color-mix(in srgb, var(--bone) 70%, transparent); }
  .qf-fc-tut .box { width:15px; height:15px; border:1px solid color-mix(in srgb, var(--gold) 50%, var(--bone)); border-radius:2px;
    display:flex; align-items:center; justify-content:center; color: var(--gold); font-size:11px; background:rgba(0,0,0,.3); }
  .qf-fc-skip { position:absolute; right:24px; top:20px; z-index:9; pointer-events:auto; cursor:pointer;
    font-family:'Silkscreen',monospace; font-size:11px; letter-spacing:.16em; text-transform:uppercase;
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
    const flash  = h('div', { className: 'qf-fc-flash' })
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

    this._el = h('div', { className: 'qf-fc' }, [
      ...buildCryptBackdrop(),
      h('div', { className: 'qf-fc-stage' }, [h('div', { className: 'qf-fc-floor' }), partyEl, bossSlot]),
      h('div', { className: 'qf-fc-vig' }),
      flash,
      h('div', { className: 'qf-fc-cap' }, [eyebrow, capLine]),
      reveal,
      foot,
      h('button', { className: 'qf-fc-skip', on: { click: () => this._finish(true) } }, 'Skip ▸▸'),
    ])
    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this._el)
    window.addEventListener('keydown', this._esc)

    // Real sprites: boss now (its sheet is loaded with the run); heroes on demand.
    this._fillBoss(bossSlot, archId)
    partyEl.querySelectorAll('.qf-fc-hero').forEach(slot => this._fillHero(slot, slot.dataset.cls))

    // ── Choreography (skippable; timers cleared on finish) ──
    const at = (ms, fn) => this._timers.push(setTimeout(fn, ms))
    const setLine = (t) => { capLine.textContent = t; capLine.classList.remove('on'); void capLine.offsetWidth; capLine.classList.add('on') }

    at(120, () => { this._el.classList.add('marched', 'bossShown'); eyebrow.classList.add('on') })           // A: march in, monster present
    at(4600, () => { flash.classList.add('go'); this._el.classList.add('bossFell'); eyebrow.classList.remove('on'); setLine('…and the monster always fell.') }) // B: it falls
    at(8800, () => { // C: THE FLIP
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go')
      this._el.classList.remove('bossFell'); this._el.classList.add('flipped', 'shake')
      setTimeout(() => this._el && this._el.classList.remove('shake'), 600)
      setLine('Not this time.')
    })
    at(13200, () => { capLine.classList.remove('on'); reveal.classList.add('on') })                          // D: reveal
    at(15600, () => { foot.classList.add('on') })                                                            // E: hand off
  }

  _fillBoss(slot, archId) {
    if (!archId) return
    const a = animatedBossSprite(archId, 170)
    if (a?.el) { slot.replaceChildren(a.el); if (a.stop) this._stopFns.push(a.stop) }
  }

  // Load the adventurer base sheet on demand; swap the real looping sprite into
  // the slot when ready. Glyph placeholder stays until then. (Mirrors the old
  // intro's _fillAdventurer.) No-ops if the cinematic closed mid-load.
  _fillHero(slot, cls, vId = 'v01') {
    const put = () => {
      if (!this._el || slot.dataset.filled) return true
      const a = animatedAdventurer(cls, 96, vId)
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

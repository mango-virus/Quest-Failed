// AscensionCinematic — KR P6 "dark ascension" hero moment.
//
// When the act advances, KingdomModifierSystem fires BOSS_ASCENSION with the
// boss's before/after stats and the form it grew out of → into. This slams a
// dramatic full-screen reveal: the boss's new evolved form, glowing, with the
// power-surge readout and an archetype-flavoured line.
//
// SEQUENCING: the act opens with the Kingdom Response reveal (drafted acts) or
// the Act card (fixed acts). The ascension is the player's answer to that, so it
// WAITS for that reveal to be dismissed before slamming in — giving the beat
// "the kingdom responds … and your boss ascends in defiance." A DOM/timer
// fallback covers the rare case neither reveal fires.
//
// VISUAL-STANDARDS: holds until the player dismisses it (CONTINUE / any key /
// backdrop), mirrors the KingdomResponseIntro set-piece, and uses NO infinite
// CSS animations (those hang preview_screenshot — see VISUAL_STANDARDS §4). The
// "alive" feel comes from the JS-driven animated boss canvas + a finite entrance.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { animatedBossSprite } from './inGameSnapshot.js'
import { runCountUp } from './countUp.js'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI']

// Per-archetype dark-ascension flavour. Title is "<NAME> ASCENDS" (name pulled
// from bossArchetypes.json at runtime); the line is the one-breath flavour.
const ASCEND_LINE = {
  lich:      'The phylactery blackens. Death bows deeper.',
  demon:     'Hellfire floods its veins.',
  gnoll:     'The pack-beast swells with stolen ferocity.',
  golem:     'Ancient stone drinks the realm to ruin.',
  beholder:  'A thousand eyes open onto darker sight.',
  lizardman: 'Primordial blood boils anew.',
  myconid:   'The bloom spreads through the kingdom’s corpse.',
  orc:       'A war-spirit gorged on a fallen realm.',
  slime:     'It engulfs the kingdom’s power whole.',
  vampire:   'The bloodline drinks a kingdom dry.',
  wraith:    'The shroud thickens with the vengeful dead.',
  succubus:  'Beauty sharpens into something far crueler.',
}
const ASCEND_LINE_FALLBACK = 'It absorbs the fallen kingdom’s power.'

// Resolve a boss FORM tier (1..4) to its texture-key base, mirroring
// BossRenderer._resolveSpriteKey: a tier with an explicit `${id}-t${n}` sheet
// uses it (incl. the T4 dark-ascension recolor); any tier without one falls to
// the bare canonical sheet.
function _formKey(id, tier) {
  const tex = window.__game?.textures
  if (!id || !tex) return id
  if (tex.exists?.(`${id}-t${tier}-idle`)) return `${id}-t${tier}`
  return id
}

function _archName(id) {
  const arr = window.__game?.cache?.json?.get?.('bossArchetypes')
  const def = Array.isArray(arr) ? arr.find(a => a.id === id) : null
  return (def?.name || id || 'THE BOSS').toString()
}

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-asc-css')) return
  const style = document.createElement('style')
  style.id = 'qf-asc-css'
  style.textContent = `
.qf-asc { position:absolute; inset:0; z-index:49; pointer-events:auto;
  display:flex; align-items:center; justify-content:center;
  opacity:0; transition:opacity .4s ease; }
.qf-asc.show { opacity:1; }
.qf-asc-bg { position:absolute; inset:0;
  background:
    radial-gradient(circle at 50% 42%, rgba(78,28,120,.42) 0%, rgba(20,8,34,.92) 46%, rgba(4,2,9,.98) 100%); }
/* unique dark-ascension fx: rising violet shafts behind the card */
.qf-asc-bg::after { content:''; position:absolute; inset:0; opacity:.5;
  background:
    repeating-conic-gradient(from 0deg at 50% 58%,
      rgba(176,120,255,.10) 0deg, rgba(176,120,255,0) 7deg, rgba(176,120,255,0) 16deg);
  -webkit-mask-image:radial-gradient(circle at 50% 50%, #000 18%, transparent 64%);
          mask-image:radial-gradient(circle at 50% 50%, #000 18%, transparent 64%);
  animation:qf-asc-rise 1.4s ease-out both; }
@keyframes qf-asc-rise { from{opacity:0; transform:scale(.6) rotate(-4deg)}
  to{opacity:.5; transform:scale(1) rotate(0)} }
.qf-asc-card { position:relative; text-align:center; max-width:640px; padding:18px 30px;
  font-family:'Press Start 2P','Courier New',monospace; }
.qf-asc-eyebrow { font-size:clamp(9px,1.1vw,12px); letter-spacing:6px; color:#c98bff;
  text-shadow:0 0 12px rgba(201,139,255,.6); margin-bottom:18px;
  opacity:0; animation:qf-asc-fade .5s ease .1s forwards; }
.qf-asc-stage { position:relative; height:264px; display:flex; align-items:center; justify-content:center; }
.qf-asc-ring { position:absolute; left:50%; top:50%; width:230px; height:230px; margin:-115px 0 0 -115px;
  border-radius:50%; border:2px solid rgba(201,139,255,.55);
  box-shadow:0 0 36px rgba(140,70,230,.55), inset 0 0 36px rgba(140,70,230,.35); }
.qf-asc-ring.s1 { animation:qf-asc-shock 1.1s cubic-bezier(.2,.7,.3,1) .15s both; }
.qf-asc-ring.s2 { animation:qf-asc-shock 1.1s cubic-bezier(.2,.7,.3,1) .42s both; }
@keyframes qf-asc-shock { 0%{opacity:0; transform:scale(.35)} 35%{opacity:.85} 100%{opacity:0; transform:scale(1.7)} }
.qf-asc-halo { position:absolute; left:50%; top:50%; width:200px; height:200px; margin:-104px 0 0 -100px;
  border-radius:50%; pointer-events:none;
  background:radial-gradient(circle, rgba(150,86,240,.42) 0%, rgba(90,40,160,.16) 46%, transparent 70%); }
.qf-asc-new { position:relative; filter:drop-shadow(0 0 18px rgba(170,110,255,.75)) drop-shadow(0 6px 10px rgba(0,0,0,.6));
  animation:qf-asc-pop .7s cubic-bezier(.16,.9,.24,1) .35s both; }
@keyframes qf-asc-pop { 0%{opacity:0; transform:scale(.55) translateY(8px); filter:brightness(2.4) blur(3px)}
  55%{opacity:1; transform:scale(1.06)} 100%{opacity:1; transform:scale(1); filter:brightness(1) blur(0)} }
/* The shed FORMER SHELL — paired just LEFT of the new form (bottoms aligned) so
   it reads as a clear "before → after", not a tiny thing lost in the corner. */
.qf-asc-prev { position:absolute; left:50%; bottom:14px; margin-left:-252px; text-align:center;
  opacity:0; animation:qf-asc-fade .5s ease .9s forwards; }
.qf-asc-prev canvas { filter:grayscale(.5) brightness(.66); opacity:.86; }
.qf-asc-prev-label { font-size:9px; letter-spacing:1.5px; color:#8a7fa0; margin-top:4px; }
.qf-asc-title { font-size:clamp(20px,3vw,38px); letter-spacing:2px; color:#f3e9ff; margin-top:6px;
  text-shadow:0 0 24px rgba(176,120,255,.6), 0 3px 0 #1a0e2a;
  opacity:0; animation:qf-asc-pop2 .6s cubic-bezier(.18,.9,.25,1) .5s both; }
@keyframes qf-asc-pop2 { 0%{opacity:0; transform:scale(.8); filter:blur(4px)}
  100%{opacity:1; transform:scale(1); filter:blur(0)} }
.qf-asc-line { font-family:'VT323',monospace; font-size:clamp(14px,1.6vw,19px); color:#b9a7d4;
  letter-spacing:.5px; margin:12px auto 0; max-width:520px; line-height:1.4;
  opacity:0; animation:qf-asc-fade .6s ease .7s forwards; }
/* POWER SURGE + DARK KIN — level-up-screen tile/count-up structure, kept in the
   dark-ascension violet palette (sibling, not clone of the gold level-up). */
.qf-asc-sec-label { font-family:'Press Start 2P',monospace; font-size:9px; letter-spacing:3px;
  color:#b78bd9; margin:17px 0 9px; text-shadow:0 0 10px rgba(183,139,217,.45);
  opacity:0; animation:qf-asc-fade .5s ease forwards; }
.qf-asc-kin-count { color:#9be86a; margin-left:5px; text-shadow:0 0 8px rgba(155,232,106,.5); }
.qf-asc-gain-tiles { display:inline-flex; gap:14px; justify-content:center; flex-wrap:wrap; }
.qf-asc-gain { min-width:132px; padding:9px 16px 11px; border:1px solid rgba(201,139,255,.30);
  border-radius:8px; background:rgba(40,20,70,.42);
  opacity:0; animation:qf-asc-fade .5s ease forwards; }
.qf-asc-gain-label { font-family:'Press Start 2P',monospace; font-size:8px; letter-spacing:2px;
  color:#9a8fb4; margin-bottom:8px; }
.qf-asc-gain-row { display:flex; align-items:baseline; justify-content:center; gap:8px;
  font-family:'VT323',monospace; }
.qf-asc-gain-from { font-size:18px; color:#897ea4; }
.qf-asc-gain-arrow { font-size:11px; color:#c98bff; }
.qf-asc-gain-to { font-size:25px; font-weight:bold; text-shadow:0 0 11px currentColor; }
.qf-asc-gain-delta { font-family:'Press Start 2P',monospace; font-size:9px; letter-spacing:1px; margin-top:7px; }
.qf-asc-kin-chips { display:inline-flex; gap:8px; justify-content:center; flex-wrap:wrap;
  opacity:0; animation:qf-asc-fade .5s ease forwards; }
.qf-asc-kin-chip { font-family:'VT323',monospace; font-size:15px; letter-spacing:.5px;
  color:#c7e8a0; padding:4px 11px; border:1px solid rgba(143,209,79,.32);
  border-radius:6px; background:rgba(34,52,20,.42); }
.qf-asc-kin-chip.elite { color:#ffe49a; border-color:rgba(255,210,90,.48);
  background:rgba(64,48,14,.44); box-shadow:0 0 10px rgba(255,210,90,.16); }
.qf-asc-kin-star { color:#ffd24a; margin-right:4px; }
.qf-asc-actions { margin-top:22px; opacity:0; animation:qf-asc-fade .6s ease 1.5s forwards; }
.qf-asc-actions .btn { font-size:13px; }
.qf-asc-hint { margin-top:11px; font-size:9px; letter-spacing:3px; color:#6a5f80; }
@keyframes qf-asc-fade { from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:translateY(0)} }`
  document.head.appendChild(style)
}

export class AscensionCinematic {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._stopFns = []
    this._timers = []
    this._pending = null
    this._reinforce = null
    this._cuCancel = null
    _ensureCss()
    EventBus.on('BOSS_ASCENSION', this._onAscension, this)
    EventBus.on('BOSS_REINFORCEMENTS', this._onReinforcements, this)
  }

  destroy() {
    EventBus.off('BOSS_ASCENSION', this._onAscension, this)
    EventBus.off('BOSS_REINFORCEMENTS', this._onReinforcements, this)
    this._cuCancel?.(); this._cuCancel = null
    this._clearWaiters()
    this._teardown()
  }

  // The elite kin rally fires on the same act-start tick, right after
  // BOSS_ASCENSION — fold its roster into the pending reveal so the screen can
  // show "what rallied". (Defensive: stash it even if ordering ever flips.)
  _onReinforcements(payload = {}) {
    if (this._pending) this._pending.reinforcements = payload
    else this._reinforce = payload
  }

  _onAscension(payload = {}) {
    if (!payload || !payload.archetype) return
    // Don't stack on an in-flight ascension reveal.
    if (this._root || this._pending) return
    this._pending = payload
    if (this._reinforce) { payload.reinforcements = this._reinforce; this._reinforce = null }

    // Dev test (immediate) — no opening reveal to wait on; slam in right now.
    if (payload.immediate) { this._begin(); return }

    // Wait for the act's opening reveal (Kingdom Response / Act card) to clear,
    // then slam in. Guard each path through _begin (once).
    const begin = () => this._begin()
    this._onRespDismissed = begin
    this._onActDismissed  = begin
    EventBus.on('KINGDOM_RESPONSE_INTRO_DISMISSED', this._onRespDismissed, this)
    EventBus.on('ACT_INTRO_DISMISSED', this._onActDismissed, this)

    // Fallback: if no reveal is on screen after a beat, show anyway. If one IS
    // up (player still reading), reschedule so we never stack over it.
    const tick = () => {
      if (!this._pending) return
      const revealUp = document.querySelector('.qf-kri, .qf-actintro')
      if (revealUp) { this._timers.push(setTimeout(tick, 1500)); return }
      this._begin()
    }
    this._timers.push(setTimeout(tick, 6000))
  }

  _clearWaiters() {
    if (this._onRespDismissed) EventBus.off('KINGDOM_RESPONSE_INTRO_DISMISSED', this._onRespDismissed, this)
    if (this._onActDismissed)  EventBus.off('ACT_INTRO_DISMISSED', this._onActDismissed, this)
    this._onRespDismissed = this._onActDismissed = null
    for (const t of this._timers) clearTimeout(t)
    this._timers = []
  }

  _begin() {
    const payload = this._pending
    if (!payload) return
    this._pending = null
    this._clearWaiters()
    // Tiny settle so the dismissed reveal's fade-out finishes first.
    this._timers.push(setTimeout(() => this._show(payload), 160))
  }

  _show(payload) {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    const { act, fromForm, toForm, archetype, before = {}, after = {}, reinforcements = null } = payload
    const newKey  = _formKey(archetype, toForm ?? act)
    const prevKey = _formKey(archetype, fromForm ?? Math.max(1, (act ?? 2) - 1))

    const newSprite  = animatedBossSprite(newKey, 220)
    const prevSprite = (prevKey !== newKey) ? animatedBossSprite(prevKey, 140) : null
    if (newSprite?.stop)  this._stopFns.push(newSprite.stop)
    if (prevSprite?.stop) this._stopFns.push(prevSprite.stop)

    const name = _archName(archetype).toUpperCase()
    const line = ASCEND_LINE[archetype] || ASCEND_LINE_FALLBACK

    this._root = h('div', { className: 'qf-asc' }, [
      h('div', { className: 'qf-asc-bg' }),
      h('div', { className: 'qf-asc-card' }, [
        h('div', { className: 'qf-asc-eyebrow' }, `DARK ASCENSION · ACT ${ROMAN[act] || act}`),
        h('div', { className: 'qf-asc-stage' }, [
          h('div', { className: 'qf-asc-halo' }),
          h('div', { className: 'qf-asc-ring s1' }),
          h('div', { className: 'qf-asc-ring s2' }),
          newSprite ? h('div', { className: 'qf-asc-new' }, [newSprite.el]) : null,
          prevSprite ? h('div', { className: 'qf-asc-prev' }, [
            prevSprite.el,
            h('div', { className: 'qf-asc-prev-label' }, 'FORMER SHELL'),
          ]) : null,
        ]),
        h('div', { className: 'qf-asc-title' }, `${name} ASCENDS`),
        h('div', { className: 'qf-asc-line' }, line),
        this._gainsSection(before, after),
        this._kinSection(reinforcements),
        h('div', { className: 'qf-asc-actions' }, [
          h('button', { className: 'btn primary', on: { click: () => this._dismiss() } }, 'CONTINUE'),
          h('div', { className: 'qf-asc-hint' }, 'PRESS ANY KEY'),
        ]),
      ]),
    ])

    this._root.addEventListener('click', (e) => {
      if (e.target === this._root || e.target.classList?.contains('qf-asc-bg')) this._dismiss()
    })
    stage.appendChild(this._root)
    this._timers.push(setTimeout(() => this._root?.classList.add('show'), 30))
    // Cascade the new power numbers (+ kin tally) up from 0, like the level-up.
    this._cuCancel = runCountUp(this._root)
    this._keyFn = (e) => { e.preventDefault(); e.stopPropagation(); this._dismiss() }
    window.addEventListener('keydown', this._keyFn, { capture: true, once: true })
  }

  // POWER SURGE — the boss's own HP/ATK growth, in the level-up screen's tile +
  // count-up language but kept in the dark-ascension violet palette (sibling, not
  // clone). The "to" value carries `cu` so runCountUp tallies it from 0.
  _gainsSection(before, after) {
    const pct = (b, a) => (b > 0 ? Math.round((a / b - 1) * 100) : 0)
    const tile = (label, b, a, color, delay) => {
      const up = pct(b, a)
      return h('div', { className: 'qf-asc-gain', style: { animationDelay: `${delay}s` } }, [
        h('div', { className: 'qf-asc-gain-label' }, label),
        h('div', { className: 'qf-asc-gain-row' }, [
          h('span', { className: 'qf-asc-gain-from' }, String(b ?? 0)),
          h('span', { className: 'qf-asc-gain-arrow' }, '▶'),
          h('span', { className: 'qf-asc-gain-to cu', style: { color } }, String(a ?? 0)),
        ]),
        up > 0 ? h('div', { className: 'qf-asc-gain-delta', style: { color } }, `+${up}%`) : null,
      ])
    }
    return h('div', { className: 'qf-asc-gains' }, [
      h('div', { className: 'qf-asc-sec-label', style: { animationDelay: '.85s' } }, '◇ POWER SURGE'),
      h('div', { className: 'qf-asc-gain-tiles' }, [
        tile('MAX HP', before.hp ?? 0, after.hp ?? 0, '#ff6f8a', 0.95),
        tile('ATTACK', before.attack ?? 0, after.attack ?? 0, '#ffb15c', 1.05),
      ]),
    ])
  }

  // THRONE GUARD — the fixed pair of boss kin that garrison the chamber and
  // EVOLVE with the boss: "RALLIED +2" on the first ascension, "EVOLVED → T2/T3"
  // thereafter. Aggregates duplicates into "NAME ×N" chips; the T3 form is starred.
  _kinSection(reinforcements) {
    const n = (reinforcements?.count | 0)
    if (n <= 0) return null
    const evolved = !!reinforcements?.evolved
    const tier    = reinforcements?.tier
    const members = Array.isArray(reinforcements?.members) ? reinforcements.members : []
    const agg = new Map()
    for (const m of members) {
      const key = `${m.name}|${m.elite ? 1 : 0}`
      const e = agg.get(key) || { name: m.name, elite: !!m.elite, n: 0 }
      e.n++; agg.set(key, e)
    }
    const chips = [...agg.values()].map(m => h('div', { className: 'qf-asc-kin-chip' + (m.elite ? ' elite' : '') }, [
      m.elite ? h('span', { className: 'qf-asc-kin-star' }, '✦') : null,
      `${String(m.name).toUpperCase()}${m.n > 1 ? ` ×${m.n}` : ''}`,
    ]))
    const label = evolved
      ? ['◇ THRONE GUARD EVOLVED ', h('span', { className: 'qf-asc-kin-count' }, `→ T${tier}`)]
      : ['◇ THRONE GUARD RALLIED ', h('span', { className: 'qf-asc-kin-count cu' }, `+${n}`)]
    return h('div', { className: 'qf-asc-kin' }, [
      h('div', { className: 'qf-asc-sec-label', style: { animationDelay: '1.2s' } }, label),
      chips.length ? h('div', { className: 'qf-asc-kin-chips', style: { animationDelay: '1.3s' } }, chips) : null,
    ])
  }

  _dismiss() {
    if (!this._root) return
    this._cuCancel?.(); this._cuCancel = null
    if (this._keyFn) { window.removeEventListener('keydown', this._keyFn, { capture: true }); this._keyFn = null }
    EventBus.emit('BOSS_ASCENSION_DISMISSED')
    this._root.classList.remove('show')
    const el = this._root; this._root = null
    this._timers.push(setTimeout(() => { el?.remove(); this._teardown() }, 400))
  }

  _teardown() {
    this._cuCancel?.(); this._cuCancel = null
    for (const s of this._stopFns) { try { s() } catch {} }
    this._stopFns = []
    if (this._keyFn) { window.removeEventListener('keydown', this._keyFn, { capture: true }); this._keyFn = null }
    this._root?.remove(); this._root = null
  }
}

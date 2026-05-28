// SoloLevelingCinematic (DOM) — the Shadow Monarch's theatrics.
//
// Two pieces, both pure presentation (gameplay lives in EventSystem /
// BossSystem / DayPhase):
//
//   1. ENTRANCE — a full-screen title card when Sung Jinwoo arrives
//      (SOLO_LEVELING_BEGAN): dim → "◆ SOLO LEVELING ◆" → "THE SHADOW
//      MONARCH" → a slamming "ARISE." Auto-dismisses (or click to skip),
//      then hands the screen back so the player can watch him march in.
//
//   2. VIGNETTE — a persistent dark-violet edge shadow that lingers the
//      whole time the Monarch is in the dungeon, lifted when he dies /
//      flees / the day ends.
//
// The VS card + extraction "ARISE" pop are Phase 3b.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

export class SoloLevelingCinematic {
  constructor() {
    this._stage = document.getElementById('hud-stage')
    this._listeners = []
    this._timers = []
    this._el = null         // entrance overlay
    this._vs = null         // duel VS card
    this._vignette = null   // persistent edge shadow
    this._letterbox = null  // duel cinematic bars
    if (!this._stage) return
    this._ensureDuelCss()
    this._wire()
  }

  // Self-inject the duel cinematic CSS (letterbox bars + future duel HUD)
  // rather than editing the shared styles.css — keeps this feature's styling
  // self-contained. Same pattern EventBanner uses for its theme CSS.
  _ensureDuelCss() {
    if (document.getElementById('qf-sl-duel-css')) return
    const css = `
.qf-sl-letterbox { position:absolute; inset:0; pointer-events:none; z-index:34; }
.qf-sl-letterbox .qf-sl-bar { position:absolute; left:0; right:0; height:9vh;
  background:linear-gradient(180deg,#02040a 0%, #03050e 70%, rgba(3,5,14,0) 100%);
  transform:scaleY(0); transition:transform .55s cubic-bezier(.16,.84,.3,1); }
.qf-sl-letterbox .qf-sl-bar.top    { top:0;    transform-origin:top;
  box-shadow:0 1px 0 rgba(74,160,255,.5), 0 6px 18px -6px rgba(58,139,255,.6); }
.qf-sl-letterbox .qf-sl-bar.bottom { bottom:0; transform-origin:bottom;
  background:linear-gradient(0deg,#02040a 0%, #03050e 70%, rgba(3,5,14,0) 100%);
  box-shadow:0 -1px 0 rgba(74,160,255,.5), 0 -6px 18px -6px rgba(58,139,255,.6); }
.qf-sl-letterbox.show .qf-sl-bar { transform:scaleY(1); }
.qf-sl-pulse { position:absolute; inset:0; pointer-events:none; z-index:33; opacity:0;
  animation:qf-sl-pulse-anim .75s ease-out forwards; }
.qf-sl-pulse.surge  { background:radial-gradient(circle at 50% 55%, rgba(74,160,255,0) 42%, rgba(74,160,255,.34) 100%);
  box-shadow:inset 0 0 120px 40px rgba(58,139,255,.5); }
.qf-sl-pulse.enrage { background:radial-gradient(circle at 50% 55%, rgba(255,42,30,0) 42%, rgba(255,42,30,.3) 100%);
  box-shadow:inset 0 0 120px 40px rgba(255,42,30,.46); }
@keyframes qf-sl-pulse-anim { 0%{opacity:0} 22%{opacity:1} 100%{opacity:0} }
.qf-sl-beatlabel { position:absolute; left:0; right:0; top:28%; text-align:center; z-index:35;
  pointer-events:none; font-family:'Press Start 2P','Courier New',monospace;
  font-size:clamp(15px,2.5vw,32px); letter-spacing:4px; opacity:0; }
.qf-sl-beatlabel.surge  { color:#cfe9ff; text-shadow:0 0 18px rgba(74,160,255,.95), 0 2px 0 #02040a; }
.qf-sl-beatlabel.enrage { color:#ffd2ca; text-shadow:0 0 18px rgba(255,64,40,.95), 0 2px 0 #1a0202; }
.qf-sl-beatlabel.show { animation:qf-sl-beat-anim 1.5s cubic-bezier(.2,.9,.2,1) forwards; }
@keyframes qf-sl-beat-anim { 0%{opacity:0; transform:scale(.7)} 16%{opacity:1; transform:scale(1.06)}
  72%{opacity:1; transform:scale(1)} 100%{opacity:0; transform:scale(1)} }`
    const el = document.createElement('style')
    el.id = 'qf-sl-duel-css'
    el.textContent = css
    document.head.appendChild(el)
  }

  _wire() {
    const sub = (evt, fn) => { EventBus.on(evt, fn); this._listeners.push([evt, fn]) }
    sub('SOLO_LEVELING_BEGAN', () => this._onBegan())
    // Duel VS card when the Monarch reaches the throne.
    sub('SHADOW_MONARCH_DUEL', (p) => this._onDuel(p ?? {}))
    // Rising-arc phase beats — boss enrage / Monarch power surge.
    sub('SHADOW_MONARCH_DUEL_BEAT', (p) => this._onDuelBeat(p ?? {}))
    // Lift the vignette (and tear down any lingering card) the moment the
    // Monarch is gone, or at day end as a catch-all.
    sub('ADVENTURER_DIED', (p) => { if (p?.adventurer?._shadowMonarch) this._end() })
    sub('ADVENTURER_FLED', (p) => { if (p?.adventurer?._shadowMonarch) this._end() })
    sub('DAY_PHASE_ENDED', () => this._end())
  }

  _onBegan() {
    this._startVignette()
    this._playEntrance()
  }

  // ── Persistent vignette ────────────────────────────────────────────────
  _startVignette() {
    if (this._vignette) return
    this._vignette = h('div', { className: 'qf-sl-vignette' })
    this._stage.appendChild(this._vignette)
    // Force reflow so the fade-in transition runs.
    // eslint-disable-next-line no-unused-expressions
    this._vignette.offsetHeight
    this._vignette.classList.add('show')
  }

  _end() {
    this._clearTimers()
    this._hideLetterbox()
    if (this._el) { this._el.remove(); this._el = null }
    if (this._vs) { this._vs.remove(); this._vs = null }
    if (this._vignette) {
      const v = this._vignette
      this._vignette = null
      v.classList.remove('show')
      setTimeout(() => v.remove(), 600)
    }
  }

  // ── Entrance title card ──────────────────────────────────────────────────
  _playEntrance() {
    if (this._el) this._el.remove()
    this._kicker = h('div', { className: 'qf-sl-kicker' }, '◆  SOLO LEVELING  ◆')
    this._title  = h('div', { className: 'qf-sl-title' }, 'THE SHADOW MONARCH')
    this._arise  = h('div', { className: 'qf-sl-arise' }, 'ARISE.')
    this._el = h('div', { className: 'qf-sl-entrance' }, [
      h('div', { className: 'qf-sl-dim' }),
      h('div', { className: 'qf-sl-tendrils' }),
      h('div', { className: 'qf-sl-stack' }, [this._kicker, this._title, this._arise]),
    ])
    // Click anywhere to skip the rest of the sequence.
    this._el.addEventListener('click', () => this._dismissEntrance())
    this._stage.appendChild(this._el)
    // eslint-disable-next-line no-unused-expressions
    this._el.offsetHeight
    this._el.classList.add('show')

    // Staged reveal — each beat adds a class that triggers its CSS anim.
    this._after(280,  () => this._kicker?.classList.add('in'))
    this._after(900,  () => this._title?.classList.add('in'))
    this._after(1700, () => { this._arise?.classList.add('in'); this._flash() })
    this._after(3600, () => this._dismissEntrance())
  }

  _flash() {
    if (!this._el) return
    this._el.classList.add('flash')
    this._after(420, () => this._el?.classList.remove('flash'))
  }

  // ── Duel cinematic letterbox ──────────────────────────────────────────────
  // Slide black bars in from top + bottom for the duration of the duel, framing
  // the throne-room fight like a cutscene. Lifted in _end() (duel over / Monarch
  // gone / day end).
  _showLetterbox() {
    if (this._letterbox) return
    this._letterbox = h('div', { className: 'qf-sl-letterbox' }, [
      h('div', { className: 'qf-sl-bar top' }),
      h('div', { className: 'qf-sl-bar bottom' }),
    ])
    this._stage.appendChild(this._letterbox)
    // eslint-disable-next-line no-unused-expressions
    this._letterbox.offsetHeight
    this._letterbox.classList.add('show')
  }

  _hideLetterbox() {
    if (!this._letterbox) return
    const lb = this._letterbox
    this._letterbox = null
    lb.classList.remove('show')
    setTimeout(() => lb.remove(), 600)
  }

  // ── Phase beats — screen pulse + a punched-in label ───────────────────────
  _onDuelBeat({ kind } = {}) {
    if (kind !== 'surge' && kind !== 'enrage') return
    const pulse = h('div', { className: `qf-sl-pulse ${kind}` })
    this._stage.appendChild(pulse)
    this._after(820, () => pulse.remove())
    const text = kind === 'enrage' ? 'ENRAGED' : 'POWER SURGE'
    const lbl  = h('div', { className: `qf-sl-beatlabel ${kind}` }, text)
    this._stage.appendChild(lbl)
    // eslint-disable-next-line no-unused-expressions
    lbl.offsetHeight
    lbl.classList.add('show')
    this._after(1550, () => lbl.remove())
  }

  // ── Duel VS card ─────────────────────────────────────────────────────────
  _onDuel({ bossName = 'YOUR BOSS', shadows = 0, buff = 1 } = {}) {
    this._showLetterbox()
    if (this._vs) this._vs.remove()
    const pct = Math.round((buff - 1) * 100)
    const sub = shadows > 0
      ? `STATS MATCHED  ·  +${pct}%  ·  ${shadows} SHADOW${shadows === 1 ? '' : 'S'}`
      : 'STATS MATCHED  ·  EVEN TERMS'
    this._vs = h('div', { className: 'qf-sl-vs' }, [
      h('div', { className: 'qf-sl-vs-dim' }),
      h('div', { className: 'qf-sl-vs-row' }, [
        h('div', { className: 'qf-sl-vs-side left' }, 'THE SHADOW MONARCH'),
        h('div', { className: 'qf-sl-vs-mark' }, 'VS'),
        h('div', { className: 'qf-sl-vs-side right' }, String(bossName).toUpperCase()),
      ]),
      h('div', { className: 'qf-sl-vs-sub' }, sub),
    ])
    this._vs.addEventListener('click', () => this._dismissVs())
    this._stage.appendChild(this._vs)
    // eslint-disable-next-line no-unused-expressions
    this._vs.offsetHeight
    this._vs.classList.add('show')
    this._after(2600, () => this._dismissVs())
  }

  _dismissVs() {
    if (!this._vs) return
    const el = this._vs
    this._vs = null
    el.classList.add('closing')
    setTimeout(() => el.remove(), 420)
  }

  _dismissEntrance() {
    if (!this._el) return
    const el = this._el
    this._el = null
    el.classList.add('closing')
    setTimeout(() => el.remove(), 480)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  _after(ms, fn) {
    const id = setTimeout(fn, ms)
    this._timers.push(id)
    return id
  }

  _clearTimers() {
    for (const id of this._timers) clearTimeout(id)
    this._timers = []
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._clearTimers()
    this._el?.remove(); this._el = null
    this._vs?.remove(); this._vs = null
    this._vignette?.remove(); this._vignette = null
    this._letterbox?.remove(); this._letterbox = null
  }
}

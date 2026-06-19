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
import { HudSfx } from './HudSfx.js'
import { domShake } from './screenShake.js'

export class SoloLevelingCinematic {
  constructor() {
    this._stage = document.getElementById('hud-stage')
    this._listeners = []
    this._timers = []
    this._el = null         // entrance overlay
    this._vs = null         // duel VS card
    this._vignette = null   // persistent edge shadow
    this._letterbox = null  // duel cinematic bars
    this._finale = null     // duel win/loss climax card
    this._duelHud = null    // live two-bar HP header (during the duel)
    this._advFill = null
    this._bossFill = null
    this._cornerHp = null   // persistent upper-left HP bar (before the duel)
    this._cornerFill = null
    this._cornerNum = null
    this._cornerAdvId = null  // Jinwoo's instanceId, for click-to-refollow
    this._duelStarted = false
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
  background:#02040a;
  transform:scaleY(0); transition:transform .55s cubic-bezier(.16,.84,.3,1); }
.qf-sl-letterbox .qf-sl-bar.top    { top:0;    transform-origin:top;
  box-shadow:0 2px 0 rgba(74,160,255,.55), 0 12px 26px -10px rgba(58,139,255,.55); }
.qf-sl-letterbox .qf-sl-bar.bottom { bottom:0; transform-origin:bottom;
  box-shadow:0 -2px 0 rgba(74,160,255,.55), 0 -12px 26px -10px rgba(58,139,255,.55); }
.qf-sl-letterbox.show .qf-sl-bar { transform:scaleY(1); }
/* Anchored to the top-left of the DUNGEON VIEW (inside the left HUD column +
   below the top HUD zone), not the screen corner — otherwise it lands on top
   of the boss-status panel. Uses the shared HUD layout vars so it tracks the
   panel sizes. */
.qf-sl-corner { position:absolute; top:calc(var(--hud-top, 96px) + 14px);
  left:calc(var(--hud-side, 320px) + 14px); z-index:42; pointer-events:auto; cursor:pointer;
  font-family:'Press Start 2P','Courier New',monospace; opacity:0;
  transition:opacity .4s ease, filter .15s ease, transform .15s ease; }
.qf-sl-corner.show { opacity:1; }
.qf-sl-corner:hover { filter:brightness(1.18) drop-shadow(0 0 8px rgba(74,160,255,.7)); transform:scale(1.03); }
.qf-sl-corner-name { font-size:11px; letter-spacing:2px; color:#bfe3ff;
  text-shadow:0 0 10px rgba(74,160,255,.85), 0 2px 0 #02040a; margin-bottom:5px; }
.qf-sl-corner-track { position:relative; width:230px; height:15px; background:rgba(4,8,16,.85);
  border:2px solid rgba(120,150,200,.5); border-radius:2px; overflow:hidden;
  box-shadow:0 0 12px rgba(58,139,255,.4); }
.qf-sl-corner-fill { position:absolute; left:0; top:0; bottom:0; width:100%;
  background:linear-gradient(90deg,#0a2a6b,#4aa0ff); transition:width .18s linear; }
.qf-sl-corner-num { position:absolute; right:6px; top:50%; transform:translateY(-50%);
  font-size:8px; color:#dff0ff; text-shadow:0 1px 2px #000; }
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
  72%{opacity:1; transform:scale(1)} 100%{opacity:0; transform:scale(1)} }
.qf-sl-finale { position:absolute; inset:0; z-index:36; pointer-events:none;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:10px; opacity:0; transition:opacity .4s ease; }
.qf-sl-finale.show { opacity:1; }
.qf-sl-finale.closing { opacity:0; }
.qf-sl-finale::before { content:''; position:absolute; inset:0;
  background:radial-gradient(circle at 50% 50%, rgba(3,8,20,.0) 30%, rgba(2,4,10,.72) 100%); }
.qf-sl-finale-kicker { position:relative; font-family:'Press Start 2P','Courier New',monospace;
  font-size:clamp(9px,1.1vw,13px); letter-spacing:5px; color:#7fb4ff;
  text-shadow:0 0 12px rgba(74,160,255,.8); }
.qf-sl-finale-title { position:relative; font-family:'Press Start 2P','Courier New',monospace;
  font-size:clamp(20px,3.4vw,44px); letter-spacing:3px;
  animation:qf-sl-finale-pop .6s cubic-bezier(.18,.9,.25,1) both; }
.qf-sl-finale.win  .qf-sl-finale-title { color:#dff0ff; text-shadow:0 0 26px rgba(74,160,255,.95), 0 3px 0 #02040a; }
.qf-sl-finale.loss .qf-sl-finale-title { color:#ffd6cf; text-shadow:0 0 26px rgba(255,70,46,.9), 0 3px 0 #1a0202; }
.qf-sl-finale-sub { position:relative; font-family:'Press Start 2P','Courier New',monospace;
  font-size:clamp(9px,1.2vw,15px); letter-spacing:3px; color:#a9c6e8; }
@keyframes qf-sl-finale-pop { 0%{opacity:0; transform:scale(.6); filter:blur(6px)}
  60%{opacity:1; transform:scale(1.05); filter:blur(0)} 100%{opacity:1; transform:scale(1)} }
.qf-sl-duelhud { position:absolute; top:calc(9vh + 14px); left:50%; transform:translateX(-50%);
  z-index:35; pointer-events:none; display:flex; align-items:center; gap:20px;
  font-family:'Press Start 2P','Courier New',monospace; opacity:0; transition:opacity .5s ease; }
.qf-sl-duelhud.show { opacity:1; }
.qf-sl-duelhud .qf-sl-side { display:flex; flex-direction:column; gap:8px; width:min(42vw,500px); }
.qf-sl-duelhud .qf-sl-side.right { align-items:flex-end; }
.qf-sl-duelhud .qf-sl-name { font-size:clamp(11px,1.5vw,18px); letter-spacing:2px; white-space:nowrap; }
.qf-sl-duelhud .qf-sl-side.left  .qf-sl-name { color:#bfe3ff; text-shadow:0 0 10px rgba(74,160,255,.8); }
.qf-sl-duelhud .qf-sl-side.right .qf-sl-name { color:#ffc2b8; text-shadow:0 0 10px rgba(255,80,60,.8); }
.qf-sl-duelhud .qf-sl-track { width:100%; height:26px; background:rgba(4,8,16,.85);
  border:3px solid rgba(120,150,200,.5); border-radius:3px; overflow:hidden; position:relative;
  box-shadow:0 0 14px rgba(58,139,255,.35); }
.qf-sl-duelhud .qf-sl-fill { position:absolute; top:0; bottom:0; width:100%; transition:width .16s linear; }
.qf-sl-duelhud .qf-sl-side.left  .qf-sl-fill { left:0;  background:linear-gradient(90deg,#0a2a6b,#4aa0ff); }
.qf-sl-duelhud .qf-sl-side.right .qf-sl-fill { right:0; background:linear-gradient(270deg,#5a0a0a,#ff5544); }
.qf-sl-duelhud .qf-sl-vs { font-size:clamp(18px,2.4vw,34px); color:#e8eefc; text-shadow:0 0 12px rgba(120,150,220,.85); }`
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
    // Duel climax — shadow execution (win) / last stand (loss).
    sub('SHADOW_MONARCH_DUEL_END', (p) => this._onDuelEnd(p ?? {}))
    // Live duel HUD HP feed.
    sub('SHADOW_MONARCH_DUEL_HP', (p) => this._onDuelHp(p ?? {}))
    // Persistent corner HP bar feed (while Jinwoo roams, before the duel).
    sub('SHADOW_MONARCH_HP', (p) => this._onCornerHp(p ?? {}))
    // Lift the vignette (and tear down any lingering card) the moment the
    // Monarch is gone, or at day end as a catch-all.
    sub('ADVENTURER_DIED', (p) => { if (p?.adventurer?._shadowMonarch) this._end() })
    sub('ADVENTURER_FLED', (p) => { if (p?.adventurer?._shadowMonarch) this._end() })
    sub('DAY_PHASE_ENDED', () => this._end())
  }

  _onBegan() {
    this._duelStarted = false   // corner HP bar is allowed again this event
    this._startVignette()
    this._playEntrance()
  }

  // ── Persistent corner HP bar (upper-left, before the duel) ────────────────
  // Built lazily on the first HP feed (i.e. once Jinwoo has actually spawned),
  // updated live, and suppressed once the duel begins (the two-bar duel header
  // takes over there).
  _onCornerHp({ frac = 1, hp, maxHp, name, instanceId } = {}) {
    if (this._duelStarted) return
    if (instanceId != null) this._cornerAdvId = instanceId
    if (!this._cornerHp) this._buildCornerHp(name)
    if (this._cornerFill) this._cornerFill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`
    if (this._cornerNum && hp != null && maxHp != null) this._cornerNum.textContent = `${Math.round(hp)} / ${Math.round(maxHp)}`
  }

  _buildCornerHp(name) {
    if (this._cornerHp) return
    const fill = h('div', { className: 'qf-sl-corner-fill' })
    const num  = h('div', { className: 'qf-sl-corner-num' }, '')
    this._cornerFill = fill
    this._cornerNum  = num
    this._cornerHp = h('div', { className: 'qf-sl-corner', title: 'Click to follow the Shadow Monarch' }, [
      h('div', { className: 'qf-sl-corner-name' }, String(name || 'THE SHADOW MONARCH').toUpperCase()),
      h('div', { className: 'qf-sl-corner-track' }, [fill, num]),
    ])
    // Click the bar to re-lock the camera onto Jinwoo (same follow used when
    // he enters). Game scene handles SHADOW_MONARCH_FOLLOW → _setFollow.
    this._cornerHp.addEventListener('click', () => {
      if (this._cornerAdvId != null) EventBus.emit('SHADOW_MONARCH_FOLLOW', { id: this._cornerAdvId })
    })
    this._stage.appendChild(this._cornerHp)
    // eslint-disable-next-line no-unused-expressions
    this._cornerHp.offsetHeight
    this._cornerHp.classList.add('show')
  }

  _hideCornerHp() {
    if (!this._cornerHp) return
    const el = this._cornerHp
    this._cornerHp = null; this._cornerFill = null; this._cornerNum = null
    el.classList.remove('show')
    setTimeout(() => el.remove(), 400)
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
    this._duelStarted = false
    this._hideCornerHp()
    this._hideLetterbox()
    this._hideDuelHud()
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
    this._after(1700, () => { this._arise?.classList.add('in'); this._flash(); HudSfx.playUi('cin_arise'); domShake(this._el, { intensity: 9, durationMs: 360 }) })
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
    const botBar = h('div', { className: 'qf-sl-bar bottom' })
    this._letterbox = h('div', { className: 'qf-sl-letterbox' }, [
      h('div', { className: 'qf-sl-bar top' }),
      botBar,
    ])
    this._stage.appendChild(this._letterbox)
    // Keep the action/bottom bar fully visible during the duel — anchor the
    // bottom letterbox bar just ABOVE it (rather than over it) so HUD controls
    // stay usable. Use offsetHeight (local layout px) NOT getBoundingClientRect
    // (screen px): #hud-stage is transform-scaled, and the CSS `bottom` offset
    // lives in the same pre-scale local space as offsetHeight. Falls back to
    // the screen edge if the bottom bar isn't present (e.g. night phase).
    const chrome = document.querySelector('.qf-bottombar')
    const offset = chrome ? chrome.offsetHeight : 0
    if (offset > 0) botBar.style.bottom = `${offset}px`
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

  // ── Duel climax — shadow execution (win) / last stand (loss) ──────────────
  // Uses raw setTimeout (NOT _after) so the card outlives _end() — which fires
  // moments later on the Monarch's death/flee and would otherwise clear the
  // removal timer, stranding the card on screen.
  _onDuelEnd({ result, bossName = 'THE BOSS' } = {}) {
    if (this._finale) this._finale.remove()
    const win = result === 'win'
    const card = h('div', { className: `qf-sl-finale ${win ? 'win' : 'loss'}` }, [
      h('div', { className: 'qf-sl-finale-kicker' }, win ? '◆  SOLO LEVELING  ◆' : '◆  THE LIGHT DIMS  ◆'),
      h('div', { className: 'qf-sl-finale-title' }, win ? 'THE MONARCH PREVAILS' : 'THE MONARCH FALLS'),
      h('div', { className: 'qf-sl-finale-sub' },
        win ? `${String(bossName).toUpperCase()} IS NO MORE` : `${String(bossName).toUpperCase()} STANDS UNBROKEN`),
    ])
    this._finale = card
    this._stage.appendChild(card)
    // eslint-disable-next-line no-unused-expressions
    card.offsetHeight
    card.classList.add('show')
    setTimeout(() => {
      card.classList.add('closing')
      setTimeout(() => { card.remove(); if (this._finale === card) this._finale = null }, 520)
    }, 2800)
  }

  // ── Live two-bar duel HUD ─────────────────────────────────────────────────
  // A persistent header framing the fight: THE SHADOW MONARCH (blue, left) vs
  // the boss (red, right), each bar depleting toward the centre VS. Fed by
  // SHADOW_MONARCH_DUEL_HP; CSS width transitions smooth the round-step jumps.
  _showDuelHud(bossName) {
    if (this._duelHud) this._duelHud.remove()
    const advFill  = h('div', { className: 'qf-sl-fill' })
    const bossFill = h('div', { className: 'qf-sl-fill' })
    this._advFill = advFill
    this._bossFill = bossFill
    this._duelHud = h('div', { className: 'qf-sl-duelhud' }, [
      h('div', { className: 'qf-sl-side left' }, [
        h('div', { className: 'qf-sl-name' }, 'SUNG JINWOO'),
        h('div', { className: 'qf-sl-track' }, [advFill]),
      ]),
      h('div', { className: 'qf-sl-vs' }, 'VS'),
      h('div', { className: 'qf-sl-side right' }, [
        h('div', { className: 'qf-sl-name' }, String(bossName).toUpperCase()),
        h('div', { className: 'qf-sl-track' }, [bossFill]),
      ]),
    ])
    this._stage.appendChild(this._duelHud)
    // eslint-disable-next-line no-unused-expressions
    this._duelHud.offsetHeight
    this._duelHud.classList.add('show')
  }

  _onDuelHp({ advFrac = 1, bossFrac = 1 } = {}) {
    if (this._advFill)  this._advFill.style.width  = `${Math.round(advFrac  * 100)}%`
    if (this._bossFill) this._bossFill.style.width = `${Math.round(bossFrac * 100)}%`
  }

  _hideDuelHud() {
    if (!this._duelHud) return
    const hud = this._duelHud
    this._duelHud = null; this._advFill = null; this._bossFill = null
    hud.classList.remove('show')
    setTimeout(() => hud.remove(), 500)
  }

  // ── Duel VS card ─────────────────────────────────────────────────────────
  _onDuel({ bossName = 'YOUR BOSS', shadows = 0, buff = 1 } = {}) {
    // Hand off from the persistent corner bar to the cinematic two-bar header.
    this._duelStarted = true
    this._hideCornerHp()
    // Letterbox bars removed at user request (both this duel and the Light
    // Party one) — the fight reads clean against the dungeon view.
    this._showDuelHud(bossName)
    if (this._vs) this._vs.remove()
    this._vs = h('div', { className: 'qf-sl-vs' }, [
      h('div', { className: 'qf-sl-vs-dim' }),
      h('div', { className: 'qf-sl-vs-row' }, [
        h('div', { className: 'qf-sl-vs-side left' }, 'SUNG JINWOO'),
        h('div', { className: 'qf-sl-vs-mark' }, 'VS'),
        h('div', { className: 'qf-sl-vs-side right' }, String(bossName).toUpperCase()),
      ]),
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
    this._finale?.remove(); this._finale = null
    this._duelHud?.remove(); this._duelHud = null
    this._advFill = null; this._bossFill = null
    this._cornerHp?.remove(); this._cornerHp = null
    this._cornerFill = null; this._cornerNum = null
  }
}

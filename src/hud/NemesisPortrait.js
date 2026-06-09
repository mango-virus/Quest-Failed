// NemesisPortrait (DOM) — Aldric's rival corner portrait (KR P2). The foil to
// the companion on the LEFT: Aldric peeks into the lower-RIGHT of the dungeon
// view and CROSS-FADES expressions as he taunts (mirrors NpcCompanion). His look
// evolves per act; per-act portrait art lives in assets/npc-aldric/act<N>/ (baked
// by tools/bake-aldric-portraits.mjs). Acts without art yet fall back to a styled
// placeholder frame. Slides in from the RIGHT on arrival, out on the duel /
// withdrawal / phase change. Gated in HudRoot behind the `acts` flag.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { userSettings } from './userSettings.js'
import { SfxVolume } from '../systems/SfxVolume.js'

const ROMAN   = ['', 'I', 'II', 'III', 'IV']
const FADE_MS  = 380
// RPG typewriter for his speech bubble — mirrors the companion (NpcCompanion):
// reveal the line letter-by-letter with the same `sfx-speech` blip, then hold a
// generous beat so the line is readable and never flashes by.
const TYPE_SPEED_MS  = 26     // per-letter cadence (~the companion's 24ms)
const BLIP_GAP_MS    = 55     // throttle the speech blip to a chirp, not a buzz
const BLIP_VOL       = 0.32   // quiet — it fires a lot
const BUBBLE_HOLD_MS = 3400   // how long the fully-typed line lingers before closing

// Per-act look — tint + emblem + mood label (drives the placeholder frame for
// acts without art yet, plus the bubble accent / name plate everywhere).
const ACT_LOOK = {
  1: { emblem: '⚔', tint: '#ffd24a', mood: 'THE UPSTART' },
  2: { emblem: '⚔', tint: '#ff9a3a', mood: 'THE AVENGER' },
  3: { emblem: '⚔', tint: '#e0633a', mood: 'THE OBSESSED' },
  4: { emblem: '♛', tint: '#fff0a0', mood: 'THE HERO KING' },
}

// Per-act portrait art + the emotion each taunt beat shows in that act. Only acts
// present here render the cross-fading portrait; the rest show the placeholder
// frame. Each act has its OWN expression set (the upstart, the avenger, the
// obsessed each emote differently), so `beats` maps a taunt `source` → the
// expression(s) for that beat (an array picks at random for variety), and
// `hurtTiers` is the escalating face by HP band (light → his floor), index-matched
// to that act's `hurt.N` lines. `rest` is his idle face. Every listed expression
// is reachable by some beat (see the coverage note in the commit / report).
const ALDRIC_ART = {
  1: {
    dir: 'assets/npc-aldric/act1/',
    expressions: ['idle', 'cocky', 'confident', 'contempt', 'sneering', 'rattled', 'annoyed', 'enraged', 'hurt', 'cocky-vow'],
    rest: 'idle',
    beats: {
      arrive:      ['cocky', 'confident'],
      taunt:       ['confident'],
      banter:      ['contempt', 'sneering'],
      recoil:      ['cocky-vow'],
      withdraw:    ['cocky-vow'],
      act_cleared: ['confident'],
      room:        ['contempt', 'sneering'],   // scoffs at the dungeon
      trap:        ['annoyed', 'contempt'],    // a trap is beneath him
      minion:      ['cocky', 'confident'],     // gleeful dismissal
      throne:      ['confident', 'cocky'],     // sizes up the boss, unimpressed
    },
    hurtTiers: ['hurt', 'rattled', 'annoyed', 'enraged'],
  },
  2: {
    dir: 'assets/npc-aldric/act2/',
    expressions: ['idle', 'heroic-resolve', 'fierce-grin', 'battle-joy', 'triumphant', 'hurt', 'desperate', 'unhinged', 'badly-hurt-and-dying'],
    rest: 'idle',
    beats: {
      arrive:      ['heroic-resolve'],
      taunt:       ['fierce-grin', 'battle-joy', 'triumphant'],
      banter:      ['fierce-grin'],
      recoil:      ['heroic-resolve'],
      withdraw:    ['heroic-resolve'],
      act_cleared: ['heroic-resolve'],
      room:        ['heroic-resolve'],                    // grim resolve at the horror you built
      trap:        ['heroic-resolve', 'fierce-grin'],     // steels himself
      minion:      ['battle-joy', 'triumphant', 'fierce-grin'],  // counts the fallen with grim joy
      throne:      ['heroic-resolve'],                    // faces the boss at last, grimly
    },
    hurtTiers: ['hurt', 'desperate', 'unhinged', 'badly-hurt-and-dying'],
  },
  3: {
    dir: 'assets/npc-aldric/act3/',
    expressions: ['idle', 'obsessed', 'maniac', 'obsessive-rage', 'bitter-vow', 'sneering', 'rattled', 'enraged', 'hurt'],
    rest: 'idle',
    beats: {
      arrive:      ['obsessed'],
      taunt:       ['maniac'],
      banter:      ['sneering'],
      recoil:      ['bitter-vow'],
      withdraw:    ['bitter-vow'],
      act_cleared: ['bitter-vow'],
      room:        ['obsessed'],                  // stares, recognizing every stone
      trap:        ['maniac', 'obsessive-rage'],  // manic — "I knew it was there"
      minion:      ['sneering', 'enraged'],
      throne:      ['obsessed', 'maniac'],        // the fixation made flesh, at last
    },
    hurtTiers: ['hurt', 'rattled', 'enraged', 'obsessive-rage'],
  },
  // Act IV — the crowned Hero King. The corner only covers his PRE-DUEL march on
  // the throne (the obsessive opener) and his final, broken words at death; the
  // duel itself is owned by AldricCinematic's reacting portrait (which uses the
  // full Act-4 emotion set). So the corner here just needs the entrance taunt +
  // the duel_defeat face.
  4: {
    dir: 'assets/npc-aldric/act4/',
    expressions: ['idle', 'obsessive-taunt', 'battle-joy', 'obsessed-attack', 'wrath', 'obsessed-desperate', 'unhinged-grin', 'unhinged-dying', 'hurt'],
    rest: 'idle',
    beats: {
      arrive:      ['obsessive-taunt'],
      taunt:       ['obsessive-taunt', 'battle-joy'],
      banter:      ['wrath'],
      recoil:      ['wrath'],
      withdraw:    ['wrath'],
      act_cleared: ['obsessive-taunt'],
      duel_defeat: ['unhinged-dying'],
      room:        ['obsessive-taunt', 'wrath'],   // regal disdain for the pit
      trap:        ['wrath'],                       // a trap, for a king?
      minion:      ['battle-joy', 'obsessed-attack'],
    },
    hurtTiers: ['hurt', 'wrath', 'obsessed-desperate', 'unhinged-dying'],
  },
}

function _ensureCss() {
  if (typeof document === 'undefined') return
  if (document.getElementById('qf-nemesis-css')) return
  const style = document.createElement('style')
  style.id = 'qf-nemesis-css'
  style.textContent = `
/* Lower-RIGHT corner presence — the mirror of the companion on the left. The
   whole rig slides in from off the right edge; the portrait sits just left of the
   320px right panel. pointer-events:none so only the bubble is interactive. */
.qf-nemesis { position:absolute; right:0; bottom:0; width:560px; height:560px; z-index:8;
  pointer-events:none; --nem-tint:#ffd24a;
  /* Parked OFF the right edge AND visibility:hidden so the rig can never peek
     into the right letterbox bar when Aldric isn't active — #hud-stage /
     #hud-root don't clip overflow, so a translate alone leaves a sliver
     showing past the 1920px stage edge. visibility flips to visible instantly
     on .show, and back to hidden only AFTER the .5s slide-out completes (the
     delayed visibility transition), so both the slide-in and slide-out still play. */
  transform:translateX(112%); visibility:hidden;
  transition:transform .5s cubic-bezier(.16,.84,.3,1), visibility 0s linear .5s;
  font-family:'Press Start 2P','Courier New',monospace; }
.qf-nemesis.show { transform:translateX(0); visibility:visible;
  transition:transform .5s cubic-bezier(.16,.84,.3,1), visibility 0s; }

/* Portrait box — two stacked <img> layers cross-fade between expressions. Sits
   just left of the right panel (mirror of the companion's left:326). */
.qf-nemesis-portrait { position:absolute; right:326px; bottom:0; width:236px; height:350px;
  filter:drop-shadow(0 5px 12px rgba(0,0,0,.65));
  animation:qf-nemesis-bob 4.6s ease-in-out infinite; transform-origin:50% 100%; }
.qf-nemesis-img { position:absolute; inset:0; width:100%; height:100%;
  object-fit:contain; object-position:bottom center; opacity:0; transition:opacity .42s ease;
  user-select:none; -webkit-user-drag:none; pointer-events:none;
  /* Match the companions' 1.15 hudScale so Aldric reads the same size; grows
     from the feet so the body scales in place (head spills above the box). */
  transform:scale(1.15); transform-origin:50% 100%; }
.qf-nemesis-img.front { opacity:1; }
/* Art mode hides the placeholder; no-art mode hides the imgs. */
.qf-nemesis .qf-nemesis-img       { display:none; }
.qf-nemesis.has-art .qf-nemesis-img { display:block; }
.qf-nemesis.has-art .qf-nemesis-ph  { display:none; }

/* Placeholder frame (acts without art yet) — the old heroic plate. */
.qf-nemesis-ph { position:absolute; right:0; bottom:0; width:150px; height:188px;
  background:radial-gradient(120% 90% at 50% 18%, #2a2440 0%, #120e22 70%, #0a0712 100%);
  border:3px solid var(--nem-tint,#ffd24a); border-radius:6px;
  box-shadow:0 0 22px rgba(255,200,80,.35), inset 0 0 26px rgba(255,210,90,.12), 0 6px 0 rgba(0,0,0,.5);
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; }
.qf-nemesis-ph-emblem { font-size:54px; color:var(--nem-tint,#ffd24a);
  filter:drop-shadow(0 0 12px var(--nem-tint,#ffd24a)); }
.qf-nemesis-ph-text { font-family:'VT323',monospace; font-size:12px; color:#5a5470; letter-spacing:1px; }

/* Speech bubble — opens ABOVE the portrait with a fixed width (mirrors the
   companion's left:332/width:250). MUST set an explicit width: positioned via a
   right offset inside the 560px rig, an auto width collapses to one word/line. */
.qf-nemesis-bubble { position:absolute; z-index:2; right:332px; bottom:404px; width:250px;
  pointer-events:auto;
  background:linear-gradient(180deg,#fffdf4,#efe6cf); color:#241a08;
  border:2px solid var(--nem-tint,#ffd24a); border-radius:7px; padding:8px 13px 10px;
  font-family:'VT323',monospace; font-size:18px; line-height:1.3; letter-spacing:.3px;
  box-shadow:0 0 16px rgba(255,200,80,.28), 0 4px 0 rgba(0,0,0,.45);
  opacity:0; transform:translateY(6px) scale(.96); transition:opacity .18s ease, transform .18s ease; }
.qf-nemesis-bubble.on { opacity:1; transform:translateY(0) scale(1); }
/* downward tail toward his head (the portrait's top-centre, just below-right). */
.qf-nemesis-bubble::after { content:''; position:absolute; bottom:-9px; right:104px;
  border:8px solid transparent; border-top-color:#efe6cf; border-bottom:0; }
.qf-nemesis-bubble-name { display:block; font-family:'Press Start 2P',monospace;
  font-size:9px; letter-spacing:1px; color:#7a1f1f; margin-bottom:7px; }
/* min-height holds the bubble's size steady while the line types in (no reflow jump) */
.qf-nemesis-bubble-text { display:block; min-height:1.3em; }

@keyframes qf-nemesis-bob { 0%,100%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-5px) rotate(.6deg)} }`
  document.head.appendChild(style)
}

export class NemesisPortrait {
  constructor(gameState) {
    this._gs = gameState
    this._root = null
    this._bubbleEl = null
    this._bubbleTextEl = null
    this._bubbleTimer = null
    this._hideTimer = null
    this._fadeTimer = null
    this._typeTimer = null
    this._lastBlipAt = 0
    this._lastSource = null
    this._listeners = []
    // cross-fade state
    this._dir = null
    this._expressions = []
    this._rest = 'idle'
    this._curExpr = null
    this._frontIsA = true
    this._exprToken = 0
    _ensureCss()
    this._build()
    this._on('NEMESIS_ARRIVED',     p => this._onArrive(p))
    this._on('NEMESIS_TAUNT',       p => this._onTaunt(p))
    this._on('NEMESIS_ESCALATED',   p => this._render(p.act))
    this._on('NEMESIS_DEPARTED',    () => this._slideOut())
    this._on('DAY_PHASE_ENDED',     () => this._slideOut())
    this._on('NIGHT_PHASE_STARTED', () => this._slideOut())
    // The Act IV duel cinematic (AldricCinematic) IS Aldric — slide the rival
    // card out so it doesn't compete with it.
    this._on('ALDRIC_DUEL_BEGAN',   () => this._slideOut())
  }

  _on(evt, fn) { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._clearTimers()
    this._root?.remove(); this._root = null
  }

  _clearTimers() {
    clearTimeout(this._bubbleTimer); this._bubbleTimer = null
    clearTimeout(this._hideTimer);   this._hideTimer = null
    clearTimeout(this._fadeTimer);   this._fadeTimer = null
    this._stopType()
  }

  _stopType() { if (this._typeTimer) { clearInterval(this._typeTimer); this._typeTimer = null } }

  _build() {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    this._imgA = h('img', { className: 'qf-nemesis-img', alt: '', draggable: 'false' })
    this._imgB = h('img', { className: 'qf-nemesis-img', alt: '', draggable: 'false' })
    this._ph = h('div', { className: 'qf-nemesis-ph' }, [
      h('div', { className: 'qf-nemesis-ph-emblem', ref: el => (this._phEmblem = el) }, '⚔'),
      h('div', { className: 'qf-nemesis-ph-text' }, '[ portrait ]'),
    ])
    this._portraitEl = h('div', { className: 'qf-nemesis-portrait' }, [this._imgA, this._imgB, this._ph])
    this._bubbleEl   = h('div', { className: 'qf-nemesis-bubble' })
    this._root = h('div', { className: 'qf-nemesis' }, [this._bubbleEl, this._portraitEl])
    stage.appendChild(this._root)
    this._render(this._gs?.meta?.nemesis?.act ?? 1)
  }

  // Repaint his evolving look (tint + art set) for the given act.
  _render(act) {
    const a = Math.max(1, Math.min(4, act | 0 || 1))
    const look = ACT_LOOK[a] || ACT_LOOK[1]
    if (this._root) this._root.style.setProperty('--nem-tint', look.tint)
    const art = ALDRIC_ART[a]
    if (art) {
      this._dir = art.dir
      this._expressions = art.expressions
      this._rest = art.rest
      this._beats = art.beats ?? {}
      this._hurtTiers = art.hurtTiers ?? []
      this._root?.classList.add('has-art')
      this._preload()
      this._curExpr = null
      this._setExpression(this._rest)
    } else {
      this._dir = null
      this._beats = {}
      this._hurtTiers = []
      this._root?.classList.remove('has-art')
      if (this._phEmblem) this._phEmblem.textContent = look.emblem
    }
  }

  _preload() {
    if (!this._dir) return
    for (const id of this._expressions) { const im = new Image(); im.src = this._dir + id + '.webp' }
  }

  // Cross-fade to `expr` (mirrors NpcCompanion). Falls back to the rest face if
  // the current act's art lacks the requested expression.
  _setExpression(expr) {
    if (!this._dir || !expr) return
    if (!this._expressions.includes(expr)) expr = this._rest
    if (expr === this._curExpr) return
    this._curExpr = expr
    const token = ++this._exprToken
    const back  = this._frontIsA ? this._imgB : this._imgA
    const front = this._frontIsA ? this._imgA : this._imgB
    const swap = () => {
      if (token !== this._exprToken) return
      back.classList.add('front')
      front.classList.remove('front')
      this._frontIsA = !this._frontIsA
    }
    back.onload = swap
    back.src = this._dir + expr + '.webp'
    if (back.complete && back.naturalWidth) swap()
  }

  // The expression for a taunt beat in the CURRENT act. Hurt resolves by tier
  // (HP band, index-matched to the hurt lines); every other beat reads the act's
  // `beats` map (an array picks at random for variety).
  _exprFor(source, tier) {
    if (source === 'hurt' && this._hurtTiers?.length) {
      const i = Math.max(0, Math.min(this._hurtTiers.length - 1, tier | 0))
      return this._hurtTiers[i] || this._rest
    }
    const e = this._beats?.[source]
    if (Array.isArray(e) && e.length) return e[Math.floor(Math.random() * e.length)] || this._rest
    return this._rest
  }

  _slideIn()  { this._root?.classList.add('show') }
  _slideOut() {
    this._clearTimers()
    this._bubbleEl?.classList.remove('on')
    this._root?.classList.remove('show')
  }

  _onArrive({ act } = {}) {
    if (act) this._render(act)
    this._clearTimers()
    this._setExpression(this._exprFor('arrive'))
    this._slideIn()
  }

  _onTaunt({ line, act, source, tier, x } = {}) {
    if (!line) return
    this._clearTimers()                 // cancel any in-flight type/hide from a prior line
    if (act) this._render(act)
    this._lastSource = source
    this._slideIn()
    this._setExpression(x || this._exprFor(source, tier))
    if (this._bubbleEl) {
      const nameEl = h('span', { className: 'qf-nemesis-bubble-name' },
        (this._gs?.meta?.nemesis?.name ?? 'Aldric').toUpperCase())
      this._bubbleTextEl = h('span', { className: 'qf-nemesis-bubble-text' })
      this._bubbleEl.replaceChildren(nameEl, this._bubbleTextEl)
      this._bubbleEl.classList.add('on')
      this._typeBubble(String(line))
    }
  }

  // RPG typewriter — reveal the line letter-by-letter with the speech blip, the
  // same cadence/sound as the companion, then hold a beat (so it never flashes by)
  // before closing.
  _typeBubble(text) {
    this._stopType()
    const el = this._bubbleTextEl
    if (!el) { this._scheduleBubbleHide(); return }
    el.textContent = ''
    this._lastBlipAt = 0
    let i = 0
    this._typeTimer = setInterval(() => {
      const step = text.length > 140 ? 2 : 1     // long lines reveal a touch faster
      i = Math.min(text.length, i + step)
      el.textContent = text.slice(0, i)
      const ch = text[i - 1]
      if (ch && ch.trim()) this._blip()           // chirp on non-whitespace only
      if (i >= text.length) { this._stopType(); this._scheduleBubbleHide() }
    }, TYPE_SPEED_MS)
  }

  // Per-letter speech blip — reuses the companion's loaded `sfx-speech` cue, the
  // same throttle + quiet volume, and honours the NPC-speech + SFX-mute settings.
  _blip() {
    try {
      if (!userSettings.isNpcSpeechEnabled?.()) return
      if (SfxVolume.isMuted?.()) return
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now()
      if (now - (this._lastBlipAt ?? 0) < BLIP_GAP_MS) return
      this._lastBlipAt = now
      const snd = window.__game?.sound
      if (snd) snd.play('sfx-speech', { volume: SfxVolume.getVolume() * BLIP_VOL })
    } catch {}
  }

  // Hold the fully-typed line a readable beat, then close the bubble + settle his
  // face; a withdrawal / between-act line then slides the whole card out.
  _scheduleBubbleHide() {
    clearTimeout(this._bubbleTimer)
    this._bubbleTimer = setTimeout(() => {
      this._bubbleEl?.classList.remove('on')
      clearTimeout(this._fadeTimer)
      this._fadeTimer = setTimeout(() => this._setExpression(this._rest), FADE_MS)
      if (this._lastSource === 'withdraw' || this._lastSource === 'act_cleared') {
        clearTimeout(this._hideTimer)
        this._hideTimer = setTimeout(() => this._slideOut(), 500)
      }
    }, BUBBLE_HOLD_MS)
  }
}

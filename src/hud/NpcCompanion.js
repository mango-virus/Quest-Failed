// NpcCompanion — the DOM HUD presence for the chosen companion NPC.
//
// The game ships two companions (Lilith / Malakor); the player picks one
// per run on the CompanionSelect screen. This component is companion-
// agnostic — it reads sprite folder, expression vocabulary, rest face
// and display name from the companion registry (src/systems/companions.js)
// based on `gameState.meta.companionId`.
//
// Two modes:
//   • CORNER — a waist-up portrait peeking into the lower-left of the
//     dungeon view, with an RPG chat bubble.
//   • MENU   — when a HUD menu opens (HUD_MENU_OPENED) the companion
//     steps out in full body to the far left, beside the modal.
//
// Pure renderer: it listens for `NPC_SAY` (from NpcDirector) and shows
// whatever it is handed. It emits back `NPC_POKE` (clicked them),
// `NPC_TUTORIAL_DONE` (paged past the last tutorial panel), and
// `NPC_CHOICE` (picked an option on a choice page — e.g. the intro's
// tutorial-hints question).
//
// Two stacked <img> layers cross-fade between expressions.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { PauseManager } from '../systems/PauseManager.js'
import { userSettings } from './userSettings.js'
import { SfxVolume } from '../systems/SfxVolume.js'
import { getCompanion } from '../systems/companions.js'
import { CompanionCursor } from './CompanionCursor.js'

const FADE_MS   = 380
// RPG-style per-letter speech blip. The typewriter ticks far faster than
// this (16–24ms); the gap throttles blips to a readable chirp instead of
// a buzz. Volume rides the SFX channel but stays quiet — it fires a lot.
const BLIP_GAP_MS = 55
const BLIP_VOL    = 0.32

export class NpcCompanion {
  constructor(gameState) {
    // Resolve the chosen companion — sprite dir, expression list, rest
    // face and name all come from the registry. Falls back to the
    // default companion for a missing / legacy companionId.
    this._companion = getCompanion(gameState?.meta?.companionId)
    this._dir         = this._companion.spriteDir
    this._rest        = this._companion.restExpr
    this._expressions = this._companion.expressions
    this._name        = this._companion.name
    // Per-companion HUD sprite scale (see companions.js `hudScale`).
    this._hudScale    = this._companion.hudScale ?? 1
    // Bubble-lift scale + sprite scale anchor — default to mirroring the
    // sprite scale / bottom-centre, but a wide-sprite companion (Zul'Gath)
    // overrides them so its big scale does not fling the bubble off the top
    // and so its bulk spills off-screen left rather than over the view.
    this._bubbleScale = this._companion.hudBubbleScale ?? this._hudScale
    this._imgOrigin   = this._companion.hudImgOrigin ?? '50% 100%'
    this._imgOriginDocked = this._companion.hudImgOriginDocked ?? this._imgOrigin
    // Corner-mode fine-placement nudge (px), default none — see companions.js.
    this._imgTx = this._companion.hudOffsetX ?? 0
    this._imgTy = this._companion.hudOffsetY ?? 0
    this._bubbleLift = this._companion.hudBubbleLift ?? 0
    // Docked-mode (menu open) nudge — separate from the corner nudge.
    this._imgTxDocked = this._companion.hudOffsetXDocked ?? 0
    this._imgTyDocked = this._companion.hudOffsetYDocked ?? 0
    this._mode      = userSettings.companionMode()
    // Variant rotation (Spectra and any future companion with multiple
    // sprite poses per emotion). `variantGroups` maps a SEMANTIC id (the
    // value dialogue banks use in `x:`) to a list of variant file
    // basenames in `spriteDir`. When set, _setExpression picks a random
    // variant from the group each time the semantic id fires. Companions
    // without variantGroups behave exactly as before — the file name is
    // the semantic id.
    this._variantGroups = this._companion.variantGroups ?? null
    // Ghost-flicker overlay (Spectra). On each expression change, roll a
    // dice — with probability `ghostFlickerRate` the sprite renders at
    // `ghostFlickerAlpha` opacity instead of full alpha. Solid-only
    // expressions (the spooky "she means it" set) are exempt — they
    // always render full alpha for impact. Off by default for every
    // other companion (rate stays 0 → no roll, full opacity always).
    this._flickerRate  = this._companion.ghostFlickerRate  ?? 0
    this._flickerAlpha = this._companion.ghostFlickerAlpha ?? 0.7
    this._solidOnly    = new Set(this._companion.solidOnlyExpressions ?? [])
    this._curExpr   = null
    this._frontIsA  = true
    this._exprToken = 0
    this._typeTimer = null
    this._holdTimer = null
    this._fadeTimer = null
    this._msg       = null      // { pages, idx, sticky, holdMs, id, title, kind }
    this._softHeld  = false
    this._lastBlipAt = 0
    this._menuDepth = 0         // open HUD menus → docked when > 0
    this._listeners = []

    this._build()
    this._setExpression(this._rest)
    this._preloadAll()

    // Safira only — a sparkle trail follows the cursor while she is the
    // chosen keeper, her signature chaotic-genie flair. Other companions
    // intentionally get no trail so hers stays distinct. Lives as long
    // as the NpcCompanion does (i.e. only during gameplay).
    if (this._companion.id === 'safira') {
      this._cursorFx = new CompanionCursor({ glyph: '✺', color: '#2caee8' })
      this._cursorFx.mount()
    }

    this._on('NPC_SAY', (p) => this._onSay(p))
    this._on('SETTINGS_CHANGED', () => this._syncMode())
    this._on('HUD_MENU_OPENED', () => { this._menuDepth++; this._applyDock() })
    this._on('HUD_MENU_CLOSED', () => {
      this._menuDepth = Math.max(0, this._menuDepth - 1); this._applyDock()
    })
    // While the player is placing a room / minion / trap / item, the
    // companion must not intercept clicks meant for the placement — drop
    // its pointer-events so the click falls through to the dungeon.
    this._on('PLACEMENT_MODE_CHANGED', (p) => this._applyPlacing(!!p?.active))
    // Safety net: the build phase ending always clears placement mode.
    this._on('NIGHT_PHASE_ENDED', () => this._applyPlacing(false))
    this._applyMode()
  }

  // Toggle the companion's interactivity off during placement so the
  // portrait + bubble let placement clicks pass straight through.
  _applyPlacing(active) {
    this.el.dataset.placing = active ? 'true' : 'false'
  }

  // ── DOM ───────────────────────────────────────────────────────────────────
  _build() {
    this._imgA = h('img', { className: 'qf-npc-img', alt: '', draggable: 'false' })
    this._imgB = h('img', { className: 'qf-npc-img', alt: '', draggable: 'false' })
    this._portrait = h('div', {
      className: 'qf-npc-portrait',
      on: { click: () => this._onPoke() },
      title: this._name,
    }, [this._imgA, this._imgB])

    this._eyebrow  = h('div', { className: 'qf-npc-eyebrow' }, this._name.toUpperCase())
    this._textEl   = h('div', { className: 'qf-npc-text' })
    this._contEl   = h('div', { className: 'qf-npc-cont' }, '▶')
    this._choicesEl = h('div', { className: 'qf-npc-choices' })
    this._optoutEl = h('div', {
      className: 'qf-npc-optout',
      on: { click: (e) => { e.stopPropagation(); this._disableHints() } },
    }, '✕ turn off hints')
    // "skip intro" — shown only on the intro, and only once she has
    // delivered it at least once before (a first-timer still reads it).
    this._skipEl = h('div', {
      className: 'qf-npc-optout qf-npc-skip',
      on: { click: (e) => { e.stopPropagation(); this._skipIntro() } },
    }, '▶▶  skip intro')
    this._bubble = h('div', {
      className: 'qf-npc-bubble',
      on: { click: () => this._onBubbleClick() },
    }, [this._eyebrow, this._textEl, this._contEl, this._choicesEl, this._optoutEl, this._skipEl])

    // Full-stage input shield — shown only while the companion delivers its
    // run-intro. It swallows every click so the player can interact ONLY
    // with the intro bubble (which rides above it). See `data-intro`.
    this._shield = h('div', { className: 'qf-npc-shield' })

    // Ambient accent flair — a soft pulsing halo behind the portrait plus
    // a thin column of rising accent-coloured particles. Same shape per
    // companion, tinted by `--npc-accent`, with the pulse + drift speed
    // varied per `[data-companion-id]` so each companion's rhythm feels
    // distinct. Pure CSS animation, hidden in docked mode (menu open).
    this._aura = h('div', { className: 'qf-npc-aura' })
    this._particles = h('div', { className: 'qf-npc-particles' }, [
      h('span'), h('span'), h('span'),
      h('span'), h('span'), h('span'),
    ])

    this.el = h('div', {
      className: 'qf-npc',
      // `companionId` drives the per-companion `--npc-accent` CSS rules in
      // styles.css (parallel to the recruit screen's `[data-id]` accent
      // overrides), so the portrait hover-glow matches the companion.
      dataset: {
        speaking:    'false',
        tutorial:    'false',
        dock:        'corner',
        placing:     'false',
        intro:       'false',
        companionId: this._companion.id,
      },
      // Per-companion sprite scale + bubble-lift scale + sprite scale anchor.
      style: {
        '--npc-img-scale':         String(this._hudScale),
        '--npc-bubble-scale':      String(this._bubbleScale),
        '--npc-img-origin':        this._imgOrigin,
        '--npc-img-origin-docked': this._imgOriginDocked,
        '--npc-img-tx':            this._imgTx + 'px',
        '--npc-img-ty':            this._imgTy + 'px',
        '--npc-img-tx-docked':     this._imgTxDocked + 'px',
        '--npc-img-ty-docked':     this._imgTyDocked + 'px',
        '--npc-bubble-lift':       this._bubbleLift + 'px',
      },
    }, [this._shield, this._aura, this._particles, this._bubble, this._portrait])
  }

  _on(evt, fn) { EventBus.on(evt, fn); this._listeners.push([evt, fn]) }

  _preloadAll() {
    const seen = new Set()
    for (const id of this._expressions) {
      // Resolve to all variant files for this semantic id; companions
      // without variantGroups have one file per id (the id itself).
      const variants = this._variantGroups?.[id] ?? [id]
      for (const v of variants) {
        if (seen.has(v)) continue
        seen.add(v)
        const im = new Image(); im.src = this._dir + v + '.webp'
      }
    }
  }

  _applyDock() {
    this.el.dataset.dock = this._menuDepth > 0 ? 'menu' : 'corner'
  }

  // ── expression cross-fade ─────────────────────────────────────────────────
  _setExpression(expr) {
    if (!expr) return
    // Guard — an expression this companion's sprite set lacks (e.g. broker
    // or tutorial dialogue authored against a different companion) would
    // 404 to a broken-image box. Fall back to the rest face instead.
    if (!this._expressions.includes(expr)) expr = this._rest
    if (expr === this._curExpr) return
    this._curExpr = expr
    // Resolve the SEMANTIC id to a concrete variant file. For companions
    // with no `variantGroups`, the file basename is just the id itself.
    // For Spectra and similar, a random pick from the group rotates poses
    // across deliveries so 100+ source sprites all see screen-time.
    const variants = this._variantGroups?.[expr]
    const file = (Array.isArray(variants) && variants.length > 0)
      ? variants[Math.floor(Math.random() * variants.length)]
      : expr
    // Ghost-flicker overlay (Spectra). Dice-roll once per delivery; the
    // chosen opacity stays for this expression's full on-screen duration
    // (don't strobe mid-line). Solid-only expressions skip the roll
    // entirely and always render full alpha.
    const flickerExempt = this._solidOnly.has(expr)
    const flicker = !flickerExempt && this._flickerRate > 0 &&
                    Math.random() < this._flickerRate
    const targetAlpha = flicker ? this._flickerAlpha : 1
    const token = ++this._exprToken
    const back  = this._frontIsA ? this._imgB : this._imgA
    const front = this._frontIsA ? this._imgA : this._imgB
    const swap = () => {
      if (token !== this._exprToken) return
      // Drive front-image alpha via the `--npc-front-alpha` CSS variable
      // (see `.qf-npc-img.front` rule in styles.css). Setting opacity as a
      // RAW inline style here previously leaked into the next swap — when
      // the image lost the `.front` class it kept its inline opacity and
      // stayed visible behind the new front, producing the "stacked
      // sprites" bug. Driving alpha through the CSS variable means the
      // base `.qf-npc-img { opacity: 0 }` rule re-applies cleanly once
      // `.front` is removed, regardless of any leftover --npc-front-alpha.
      back.style.setProperty('--npc-front-alpha', String(targetAlpha))
      back.classList.add('front')
      front.classList.remove('front')
      this._frontIsA = !this._frontIsA
    }
    back.onload = swap
    back.src = this._dir + file + '.webp'
    if (back.complete && back.naturalWidth) swap()
  }

  // ── incoming message ──────────────────────────────────────────────────────
  _onSay(payload) {
    if (!payload || this._mode === 'off' || this._mode === 'mute') return
    // Defensive bail — a previous-run NpcCompanion can survive briefly
    // if HudRoot.destroy() is racing the next run's HudRoot construction.
    // If our DOM element is no longer attached, swallow the say silently
    // so a stale instance can't paint into the freshly-mounted bubble
    // (the symptom was "Malakor saying Safira's idle lines" right after
    // picking a new companion).
    if (!this.el || !this.el.isConnected) return
    const special = payload.kind === 'tutorial' || payload.kind === 'intro'
    // A sticky tutorial/intro owns the bubble — ordinary lines can't cut in.
    if (this._msg?.sticky && !special) return

    this._clearTimers()
    if (special) {
      this._msg = {
        pages: payload.pages ?? [], idx: 0, sticky: true,
        id: payload.id, title: payload.title, kind: payload.kind,
      }
      if (!this._softHeld) { PauseManager.softPause(); this._softHeld = true }
    } else {
      this._msg = {
        pages: [{ text: payload.text ?? '', expr: payload.expr ?? this._rest }],
        idx: 0, sticky: false, holdMs: payload.holdMs ?? 2800, kind: 'line',
      }
    }
    this.el.dataset.tutorial = this._msg.sticky ? 'true' : 'false'
    // The run-intro is fully modal — raise the input shield for it (only).
    this.el.dataset.intro = (this._msg.kind === 'intro') ? 'true' : 'false'
    this.el.dataset.speaking = 'true'
    this._renderPage()
  }

  _renderPage() {
    const m = this._msg
    if (!m) return
    const page = m.pages[m.idx] ?? { text: '', expr: this._rest }
    this._setExpression(page.expr || this._rest)
    const nameUpper = this._name.toUpperCase()
    this._eyebrow.textContent = m.sticky ? (m.title || nameUpper) : nameUpper
    this._contEl.classList.remove('show')
    this._optoutEl.classList.remove('show')
    this._skipEl.classList.remove('show')
    this._choicesEl.classList.remove('show')
    this._choicesEl.replaceChildren()
    this._bubble.classList.add('open')
    this._portrait.classList.add('talking')
    this._typewrite(String(page.text || ''))
  }

  _typewrite(text) {
    const speed = this._msg?.sticky ? 16 : 24
    this._textEl.textContent = ''
    this._fullText = text
    let i = 0
    this._typeTimer = setInterval(() => {
      const step = text.length > 140 ? 2 : 1
      i = Math.min(text.length, i + step)
      this._textEl.textContent = text.slice(0, i)
      if (i >= text.length) { this._onTypeDone(); return }
      // Chirp on the freshly-revealed character — skip whitespace so
      // word gaps land as natural beats.
      const ch = text[i - 1]
      if (ch && ch.trim()) this._blip()
    }, speed)
  }

  // Per-letter speech blip (RPG dialogue style). Throttled so the fast
  // typewriter cadence doesn't smear into a buzz; honours the Companion
  // Speech setting and the global SFX mute / volume.
  _blip() {
    if (!userSettings.isNpcSpeechEnabled()) return
    if (SfxVolume.isMuted()) return
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now()
    if (now - this._lastBlipAt < BLIP_GAP_MS) return
    this._lastBlipAt = now
    try {
      const snd = window.__game?.sound
      if (!snd) return
      snd.play('sfx-speech', { volume: userSettings.masterVolume() * BLIP_VOL * userSettings.voiceVolume() })
    } catch {}
  }

  _onTypeDone() {
    if (this._typeTimer) { clearInterval(this._typeTimer); this._typeTimer = null }
    this._textEl.textContent = this._fullText
    this._portrait.classList.remove('talking')
    const m = this._msg
    if (!m) return
    const page = m.pages[m.idx]
    if (page && Array.isArray(page.choices) && page.choices.length) {
      // Decision page — render the option buttons.
      for (const ch of page.choices) {
        this._choicesEl.appendChild(h('button', {
          className: 'qf-npc-choice',
          on: { click: (e) => { e.stopPropagation(); this._onChoice(ch.value) } },
        }, ch.label))
      }
      this._choicesEl.classList.add('show')
    } else if (m.sticky) {
      this._contEl.textContent = (m.idx >= m.pages.length - 1) ? '✔' : '▶'
      this._contEl.classList.add('show')
      if (m.kind === 'tutorial') this._optoutEl.classList.add('show')
      else if (m.kind === 'intro' && m.idx < m.pages.length - 1 && this._introSeenBefore()) {
        this._skipEl.classList.add('show')
      }
    } else {
      this._holdTimer = setTimeout(() => this._dismiss(), m.holdMs ?? 2800)
    }
  }

  // ── interaction ───────────────────────────────────────────────────────────
  _onBubbleClick() {
    const m = this._msg
    if (!m) return
    if (this._typeTimer) {
      clearInterval(this._typeTimer); this._typeTimer = null
      this._textEl.textContent = this._fullText
      this._onTypeDone()
      return
    }
    const page = m.pages[m.idx]
    // A choice page ignores background clicks — the player must pick a button.
    if (page && Array.isArray(page.choices) && page.choices.length) return
    if (m.sticky) {
      if (m.idx >= m.pages.length - 1) {
        if (m.kind === 'intro') this._onChoice(true)   // defensive fallback
        else this._finishTutorial()
      } else {
        m.idx++
        this._renderPage()
      }
    } else {
      this._dismiss()
    }
  }

  _onPoke() {
    if (this._msg?.sticky) return        // no poking mid-lesson / mid-intro
    EventBus.emit('NPC_POKE')
  }

  _onChoice(value) {
    const m = this._msg
    const id = m?.id, kind = m?.kind
    this._releaseSoftPause()
    this._msg = null
    this._dismissBubble()
    EventBus.emit('NPC_CHOICE', { id, kind, value })
  }

  _disableHints() {
    try { localStorage.setItem('qf.gameplay.tutorials', 'false') } catch {}
    this._finishTutorial()
  }

  // "skip intro" — jump past the explanation straight to her final page,
  // the tutorial-hints question, so a returning player still chooses.
  _skipIntro() {
    const m = this._msg
    if (!m || m.kind !== 'intro') return
    this._clearTimers()
    m.idx = m.pages.length - 1
    this._renderPage()
  }

  // True once a companion intro has been delivered at least once before
  // (global across both companions) — gates the "skip intro" link so a
  // genuine first-timer still reads it.
  _introSeenBefore() {
    try { return localStorage.getItem('qf.introSeenEver') === 'true' } catch { return false }
  }

  _finishTutorial() {
    const id = this._msg?.id
    this._releaseSoftPause()
    this._msg = null
    this._dismissBubble()
    if (id) EventBus.emit('NPC_TUTORIAL_DONE', { id })
  }

  _dismiss() {
    this._msg = null
    this._dismissBubble()
  }

  _dismissBubble() {
    this._clearTimers()
    this._bubble.classList.remove('open')
    this.el.dataset.speaking = 'false'
    this.el.dataset.tutorial = 'false'
    // Bubble closed → the intro is over → drop the modal input shield.
    this.el.dataset.intro = 'false'
    this._portrait.classList.remove('talking')
    this._fadeTimer = setTimeout(() => this._setExpression(this._rest), FADE_MS + 120)
  }

  _clearTimers() {
    if (this._typeTimer) { clearInterval(this._typeTimer); this._typeTimer = null }
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null }
    if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null }
  }

  _releaseSoftPause() {
    if (this._softHeld) { this._softHeld = false; PauseManager.softResume() }
  }

  // ── settings ──────────────────────────────────────────────────────────────
  _syncMode() {
    const next = userSettings.companionMode()
    if (next === this._mode) return
    this._mode = next
    this._applyMode()
  }

  _applyMode() {
    // Silent mid-sticky-message — resolve it so nothing downstream stalls
    // (TutorialSystem's queue, or the intro → INTRO_DISMISSED handoff).
    // Applies to both 'off' (hidden) and 'mute' (visible but silent).
    if (this._mode === 'off' || this._mode === 'mute') {
      if (this._msg?.sticky) {
        if (this._msg.kind === 'intro') this._onChoice(true)
        else this._finishTutorial()
      } else {
        this._dismiss()
      }
    }
    // Only 'off' hides the sprite. 'mute' keeps her visible (idle only).
    this.el.style.display = (this._mode === 'off') ? 'none' : ''
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    this._clearTimers()
    this._releaseSoftPause()
    // Tear down Safira's cursor sparkle trail if it was mounted. Removing
    // the mousemove listener prevents new sparkles from spawning; any
    // already-spawned sparkle <div>s clean themselves up via their own
    // setTimeout. Safe to call on companions that never mounted one.
    this._cursorFx?.unmount()
    this._cursorFx = null
    this.el?.remove()
  }
}

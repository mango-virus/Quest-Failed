// CompanionSelectOverlay — the DOM screen for picking a dungeon keeper.
//
// Shown by the CompanionSelect scene, between MainMenu's NEW EVIL and the
// ArchetypeSelect boss picker. Both companions stand full-body side by
// side and BICKER — a turn-based conversation: one speaks, then the
// other, never both at once. Their `recruit.banter` lines reference each
// other by name, so it reads as the two of them squabbling over the
// player. Hovering a companion hands them the next turn; clicking selects
// them; CONFIRM locks the choice and moves on to the boss picker. The
// pick is persisted to localStorage `qf.companion`.

import { h } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { HudSfx, installHudSfxDelegates } from './HudSfx.js'
import { COMPANION_ORDER, COMPANIONS, DEFAULT_COMPANION, getCompanion } from '../systems/companions.js'
import { userSettings } from './userSettings.js'
import { SfxVolume } from '../systems/SfxVolume.js'

const STORE_KEY = 'qf.companion'
// Typewriter + per-letter speech blip — mirrors the in-game NpcCompanion
// so the recruitment bubbles read and sound the same as the live HUD.
const TYPE_MS     = 24
const BLIP_GAP_MS = 55
const BLIP_VOL    = 0.32
// Pause after a line finishes typing before the OTHER companion replies —
// long enough to comfortably read what was just said.
const HOLD_MS     = 3600

export class CompanionSelectOverlay {
  constructor(scene) {
    this._scene    = scene
    this._el       = null
    this._refs     = {}      // id → { card, img, bubble, text }
    this._banter   = {}      // id → [ { t, x }, ... ]
    // Per-companion shuffle-bag of un-said banter line indices — refilled
    // when empty so each speaker cycles through ALL their lines before any
    // repeats, but in random order each cycle.
    this._lineBag    = {}    // id → array of remaining shuffled line indices
    this._typeTimers = {}    // id → typewriter setInterval handle
    this._fullText = {}      // id → full text of the line currently typing
    this._convoTimer = null  // hold-then-pass-the-turn setTimeout handle
    this._speaker  = DEFAULT_COMPANION  // whose turn it is to speak
    // Random-fair rotation: the set of companions yet to speak in the
    // current cycle. Refilled (minus the just-spoke companion, to avoid
    // back-to-back at the cycle boundary) when it empties. Guarantees
    // every companion speaks once before any of them speaks again.
    this._unspoken = new Set()
    this._lastBlipAt = 0
    this._confirmBtn = null
    this._selected = DEFAULT_COMPANION
    this._keyHandler = (e) => this._onKey(e)
  }

  open() {
    if (this._el) return
    installHudSfxDelegates()
    ensureStageScaled()

    // Remembered last choice — default-selects the previous companion.
    try {
      const stored = localStorage.getItem(STORE_KEY)
      if (stored && COMPANIONS[stored]) this._selected = stored
    } catch {}

    // Pull each companion's banter pool out of the JSON cache.
    for (const id of COMPANION_ORDER) {
      const bank = this._scene?.cache?.json?.get(getCompanion(id).linesKey)
      const rec  = bank?.recruit ?? {}
      this._banter[id]  = Array.isArray(rec.banter) ? rec.banter : []
      this._lineBag[id] = []
    }

    this._render()
    this._preloadSprites()
    this._applySelected()
    this._startConversation()

    window.addEventListener('keydown', this._keyHandler)
  }

  close() {
    for (const id of Object.keys(this._typeTimers)) {
      if (this._typeTimers[id]) clearInterval(this._typeTimers[id])
    }
    this._typeTimers = {}
    if (this._convoTimer) { clearTimeout(this._convoTimer); this._convoTimer = null }
    this._el?.remove()
    this._el = null
    window.removeEventListener('keydown', this._keyHandler)
  }

  // ── render ────────────────────────────────────────────────────────────────
  _render() {
    this._el = h('div', { className: 'qf-cmpsel' }, [
      h('div', { className: 'qf-cmpsel-head' }, [
        h('div', { className: 'pix qf-cmpsel-eyebrow' }, '◆  THE THRONE NEEDS A KEEPER  ◆'),
        h('div', { className: 'pix qf-cmpsel-title' }, 'CHOOSE YOUR COMPANION'),
        h('div', { className: 'qf-cmpsel-sub' },
          'They will run your dungeon, whisper in your ear, and watch you reign. Pick the voice you can stand for a lifetime of nights.'),
      ]),
      h('div', { className: 'qf-cmpsel-stage' },
        COMPANION_ORDER.map(id => this._card(id))),
      h('div', { className: 'qf-cmpsel-footer' }, [
        h('button', {
          className: 'btn qf-cmpsel-back',
          on: { click: () => this._back() },
        }, '◀  BACK'),
        h('button', {
          className: 'btn primary lg qf-cmpsel-confirm',
          ref: el => { this._confirmBtn = el },
          on: { click: () => this._confirm() },
        }, 'CONFIRM  ▶'),
      ]),
    ])
    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this._el)
  }

  _card(id) {
    const c = COMPANIONS[id]
    const img = h('img', {
      className: 'qf-cmpsel-portrait-img',
      alt: c.name, draggable: 'false',
    })
    img.src = c.spriteDir + c.restExpr + '.webp'
    // Even out the companions' on-screen size + (optionally) mirror the
    // sprite so they face each other. `portraitOrigin` lets a wide sprite
    // (Zul'Gath) scale up from its bottom edge — growing UP, not down over
    // the name plate — instead of the default centre.
    const flip  = c.portraitFlipX ? -1 : 1
    const scale = c.portraitScale ?? 1
    img.style.transform = `scaleX(${flip}) scale(${scale})`
    if (c.portraitOrigin) img.style.transformOrigin = c.portraitOrigin
    // A wide companion (Zul'Gath) fades his tail/backside out so the big
    // sprite reads as a tall dragon rather than an overflowing rectangle.
    if (c.fadeMask) {
      img.style.maskImage = c.fadeMask
      img.style.webkitMaskImage = c.fadeMask
    }

    const text   = h('div', { className: 'qf-cmpsel-bubble-text' }, '')
    const bubble = h('div', { className: 'qf-cmpsel-bubble' }, [
      h('div', { className: 'pix qf-cmpsel-bubble-name' }, c.name.toUpperCase()),
      text,
    ])

    const card = h('div', {
      className: 'qf-cmpsel-card',
      dataset: { id, selected: 'false' },
      on: {
        mouseenter: () => this._hover(),
        click:      () => this._select(id),
      },
    }, [
      bubble,
      h('div', { className: 'qf-cmpsel-portrait' }, [img]),
      h('div', { className: 'qf-cmpsel-plate' }, [
        h('div', { className: 'pix qf-cmpsel-name' }, c.name),
        h('div', { className: 'qf-cmpsel-tag' }, c.tagline),
        h('div', { className: 'pix qf-cmpsel-traits' },
          (c.traits || []).join('  ·  ')),
        h('div', { className: 'pix qf-cmpsel-chosen' }, '✦  CHOSEN  ✦'),
      ]),
    ])

    this._refs[id] = { card, img, bubble, text }
    return card
  }

  _preloadSprites() {
    for (const id of COMPANION_ORDER) {
      const c = COMPANIONS[id]
      const ids = new Set([c.restExpr])
      for (const ln of (this._banter[id] ?? [])) {
        if (ln.x) ids.add(ln.x)
      }
      for (const expr of ids) {
        const im = new Image(); im.src = c.spriteDir + expr + '.webp'
      }
    }
  }

  // ── conversation ────────────────────────────────────────────────────────────
  // Seed every bubble with a random banter line — shown INSTANTLY, not
  // typed, so it doesn't read as four messages firing at once — then
  // begin the random-fair typed bicker after a read-hold. The seed picks
  // from each speaker's shuffle bag, so the visible opening lines vary
  // between visits instead of always being the same line[0].
  _startConversation() {
    for (const id of COMPANION_ORDER) {
      const lines = this._banter[id]
      const r = this._refs[id]
      if (!r || !lines?.length) continue
      const idx = this._popLineIndex(id)
      const line = lines[idx]
      r.text.textContent = line.t || ''
      this._fullText[id] = line.t || ''
      if (line.x) r.img.src = COMPANIONS[id].spriteDir + line.x + '.webp'
    }
    this._speaker = this._selected
    // Seed the speaker rotation with everyone EXCEPT the initial speaker
    // — the next N-1 turns must each be a different companion before the
    // initial speaker may take a second turn, per the random-fair rule.
    this._unspoken = new Set(COMPANION_ORDER.filter(id => id !== this._selected))
    this._convoTimer = setTimeout(() => {
      this._convoTimer = null
      this._advance()
    }, HOLD_MS)
  }

  // The current speaker says their next banter line; when it finishes
  // typing it holds, then passes the turn to the next companion.
  _advance() {
    if (!this._el) return
    const id = this._speaker
    const lines = this._banter[id]
    const r = this._refs[id]
    if (!r || !lines?.length) return
    const n = this._popLineIndex(id)
    const line = lines[n]
    // Bubble pop + expression swap.
    r.bubble.classList.remove('qf-cmpsel-bubble--in')
    void r.bubble.offsetWidth
    r.bubble.classList.add('qf-cmpsel-bubble--in')
    if (line.x) r.img.src = COMPANIONS[id].spriteDir + line.x + '.webp'
    this._typewrite(id, line.t || '', () => {
      this._convoTimer = setTimeout(() => {
        this._convoTimer = null
        this._speaker = this._next(this._speaker)
        this._advance()
      }, HOLD_MS)
    })
  }

  // Random-fair rotation: each companion speaks exactly once per cycle in
  // randomized order. _unspoken tracks who has yet to speak this cycle;
  // when it empties we refill it with every companion and (defensively)
  // bias the first pick away from the just-spoke one so two cycles don't
  // produce the same speaker back-to-back across the cycle boundary.
  _next(prevId) {
    if (this._unspoken.size === 0) {
      for (const id of COMPANION_ORDER) this._unspoken.add(id)
    }
    let candidates = Array.from(this._unspoken)
    if (candidates.length > 1 && candidates.includes(prevId)) {
      candidates = candidates.filter(id => id !== prevId)
    }
    const next = candidates[Math.floor(Math.random() * candidates.length)]
    this._unspoken.delete(next)
    return next
  }

  // Pop the next banter line index for `id` from the shuffle bag,
  // refilling + reshuffling when the bag empties so each companion cycles
  // through ALL their lines before any repeats, but in random order.
  _popLineIndex(id) {
    const lines = this._banter[id]
    if (!lines?.length) return 0
    let bag = this._lineBag[id]
    if (!bag || bag.length === 0) {
      bag = []
      for (let i = 0; i < lines.length; i++) bag.push(i)
      // Fisher-Yates shuffle.
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[bag[i], bag[j]] = [bag[j], bag[i]]
      }
      this._lineBag[id] = bag
    }
    return bag.shift()
  }

  // Hand the next turn to `id` immediately — used by hover / select. Any
  // line currently mid-type is snapped to its full text first. We also
  // mark this id as having taken their turn so the random-fair rotation
  // does NOT pick them again later in the same cycle (otherwise a player-
  // initiated jump could give one companion two turns in a single cycle).
  _focus(id) {
    if (this._convoTimer) { clearTimeout(this._convoTimer); this._convoTimer = null }
    for (const cid of COMPANION_ORDER) {
      if (this._typeTimers[cid]) {
        clearInterval(this._typeTimers[cid])
        this._typeTimers[cid] = null
        const r = this._refs[cid]
        if (r && this._fullText[cid] != null) r.text.textContent = this._fullText[cid]
      }
    }
    this._speaker = id
    this._unspoken.delete(id)
    this._advance()
  }

  // Type a line into a companion's bubble letter-by-letter, with the same
  // cadence + per-letter speech blip as the in-game NpcCompanion.
  _typewrite(id, text, onDone) {
    const r = this._refs[id]
    if (!r) return
    if (this._typeTimers[id]) { clearInterval(this._typeTimers[id]); this._typeTimers[id] = null }
    this._fullText[id] = text
    r.text.textContent = ''
    let i = 0
    const step = text.length > 140 ? 2 : 1
    this._typeTimers[id] = setInterval(() => {
      i = Math.min(text.length, i + step)
      r.text.textContent = text.slice(0, i)
      if (i >= text.length) {
        clearInterval(this._typeTimers[id])
        this._typeTimers[id] = null
        if (onDone) onDone()
        return
      }
      const ch = text[i - 1]
      if (ch && ch.trim()) this._blip()
    }, TYPE_MS)
  }

  // Per-letter speech chirp — reuses the loaded `sfx-speech` cue, honours
  // the COMPANION SPEECH setting and the global SFX mute / volume.
  _blip() {
    if (!userSettings.isNpcSpeechEnabled()) return
    if (SfxVolume.isMuted()) return
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now()
    if (now - this._lastBlipAt < BLIP_GAP_MS) return
    this._lastBlipAt = now
    try {
      const snd = window.__game?.sound
      if (snd) snd.play('sfx-speech', { volume: SfxVolume.getVolume() * BLIP_VOL })
    } catch {}
  }

  // ── interaction ─────────────────────────────────────────────────────────────
  // Hover is purely a visual highlight (the CSS glow). It does NOT
  // interrupt the bicker or change a companion's line / expression — the
  // conversation runs on its own; clicking a card is what hands the turn.
  _hover() {
    HudSfx.playUi('hover')
  }

  _select(id) {
    if (!COMPANIONS[id]) return
    // Clicking the already-selected companion is a no-op — it must NOT
    // restart their line. Only an actual change of selection hands the
    // newly-picked companion the turn.
    if (id === this._selected) return
    this._selected = id
    this._applySelected()
    this._focus(id)
  }

  _applySelected() {
    for (const id of COMPANION_ORDER) {
      const r = this._refs[id]
      if (r) r.card.dataset.selected = (id === this._selected) ? 'true' : 'false'
    }
    if (this._confirmBtn) {
      this._confirmBtn.textContent =
        `CONFIRM ${COMPANIONS[this._selected].name.toUpperCase()}  ▶`
    }
  }

  // ── navigation ─────────────────────────────────────────────────────────────
  _confirm() {
    try { localStorage.setItem(STORE_KEY, this._selected) } catch {}
    this.close()
    this._scene?.scene?.start('ArchetypeSelect')
  }

  _back() {
    this.close()
    this._scene?.scene?.start('MainMenu')
  }

  _onKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); this._confirm(); return }
    if (e.key === 'Escape') { e.preventDefault(); this._back();    return }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const i = COMPANION_ORDER.indexOf(this._selected)
      const next = COMPANION_ORDER[(i + (e.key === 'ArrowRight' ? 1 : -1) + COMPANION_ORDER.length) % COMPANION_ORDER.length]
      this._select(next)
    }
  }
}

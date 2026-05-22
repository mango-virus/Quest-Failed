// ArchetypeDecorOverlay — the DOM dressing for the boss-select screen.
//
// The boss picker (`ArchetypeSelect`) renders its bestiary book + picker
// grid in Phaser. This overlay adds the surrounding chrome as DOM so it
// shares the EXACT fonts and chat-bubble styling of the CompanionSelect
// screen / the in-game companion HUD:
//   • a header  (eyebrow + "PICK YOUR DUNGEON BOSS")
//   • a footer  (instruction line + a BACK button)
//   • the run's chosen companion (Lilith / Malakor) standing at the RIGHT,
//     reacting to whichever boss the player inspects with a line from
//     their own `specifics.boss` dialogue bank — typed out, with the same
//     per-letter speech blip as the live HUD.
//
// The root is `pointer-events: none` (inherited from #hud-stage) so the
// Phaser book + picker keep receiving every click; only the BACK button
// re-enables pointer events.

import { h } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { installHudSfxDelegates } from './HudSfx.js'
import { getCompanion, COMPANIONS, DEFAULT_COMPANION } from '../systems/companions.js'
import { userSettings } from './userSettings.js'
import { SfxVolume } from '../systems/SfxVolume.js'

// Typewriter cadence + per-letter blip — mirrors NpcCompanion so the
// reaction bubble reads and sounds identical to the in-game HUD.
const TYPE_MS     = 24
const BLIP_GAP_MS = 55
const BLIP_VOL    = 0.32
// How long a finished line lingers before the bubble fades out — long
// enough to read, and usually the player has hovered the next boss first.
const HOLD_MS     = 6500

export class ArchetypeDecorOverlay {
  constructor(scene) {
    this._scene      = scene
    this._el         = null
    this._companion  = null
    this._bossLines  = null
    this._curExpr    = null
    this._typeTimer  = null
    this._holdTimer  = null
    this._greetTimer = null
    this._fullText   = ''
    this._lastBlipAt = 0
    this._lastReactId = null
    this._revealed   = false
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────
  open() {
    if (this._el) return
    installHudSfxDelegates()
    ensureStageScaled()

    // Resolve the run's chosen companion (persisted by CompanionSelect).
    let id = DEFAULT_COMPANION
    try {
      const stored = localStorage.getItem('qf.companion')
      if (stored && COMPANIONS[stored]) id = stored
    } catch {}
    this._companion = getCompanion(id)

    // Their dialogue bank — `specifics.boss` is keyed by archetype id.
    const bank = this._scene?.cache?.json?.get(this._companion.linesKey)
    this._bossLines = bank?.specifics?.boss ?? null

    this._render()
    this._preloadSprites()
  }

  close() {
    if (this._typeTimer)  { clearInterval(this._typeTimer);  this._typeTimer  = null }
    if (this._holdTimer)  { clearTimeout(this._holdTimer);   this._holdTimer  = null }
    if (this._greetTimer) { clearTimeout(this._greetTimer);  this._greetTimer = null }
    this._el?.remove()
    this._el = null
  }

  // ── render ──────────────────────────────────────────────────────────────────
  _render() {
    const c = this._companion

    this._imgEl = h('img', {
      className: 'qf-archdec-img', alt: c.name, draggable: 'false',
    })
    this._imgEl.src = c.spriteDir + c.restExpr + '.webp'
    this._curExpr = c.restExpr

    this._nameEl = h('div', { className: 'pix qf-cmpsel-bubble-name' }, c.name.toUpperCase())
    this._textEl = h('div', { className: 'qf-cmpsel-bubble-text' }, '')
    this._bubbleEl = h('div', { className: 'qf-cmpsel-bubble qf-archdec-bubble' },
      [this._nameEl, this._textEl])

    this._companionEl = h('div', { className: 'qf-archdec-companion' }, [
      this._bubbleEl,
      h('div', { className: 'qf-archdec-portrait' }, [this._imgEl]),
    ])

    this._backBtn = h('button', {
      className: 'btn qf-archdec-back',
      on: { click: () => this._back() },
    }, '◀  BACK')

    this._el = h('div', { className: 'qf-archdec' }, [
      h('div', { className: 'qf-archdec-head' }, [
        h('div', { className: 'pix qf-archdec-eyebrow' }, '◆  THE DUNGEON NEEDS A MASTER  ◆'),
        h('div', { className: 'pix qf-archdec-title' }, 'PICK YOUR DUNGEON BOSS'),
      ]),
      this._companionEl,
      this._backBtn,
      h('div', { className: 'pix qf-archdec-hint' },
        'HOVER A PORTRAIT TO STUDY IT      CLICK TO CLAIM YOUR BOSS      BEGIN RUN TO DESCEND'),
    ])

    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this._el)
  }

  _preloadSprites() {
    const c = this._companion
    const ids = new Set([c.restExpr])
    if (this._bossLines) {
      for (const k of Object.keys(this._bossLines)) {
        for (const ln of (this._bossLines[k] || [])) {
          if (ln && ln.x) ids.add(ln.x)
        }
      }
    }
    for (const expr of ids) {
      const im = new Image(); im.src = c.spriteDir + expr + '.webp'
    }
  }

  // ── public hooks (called by the ArchetypeSelect scene) ──────────────────────
  // Tints the header eyebrow / footer accents to the focused boss colour.
  setAccent(cssColor) {
    if (this._el && cssColor) this._el.style.setProperty('--arch-accent', cssColor)
  }

  // Slides the companion in once the book-open intro has finished.
  reveal() {
    if (!this._el || this._revealed) return
    this._revealed = true
    this._companionEl.dataset.in = 'true'
    this._greetTimer = setTimeout(() => this._greet(), 540)
  }

  // Reacts to whichever boss the player just focused. Skips a repeat of the
  // same boss so re-hovering one card doesn't re-fire the line.
  reactToBoss(archId) {
    if (!this._el || !this._revealed || !archId) return
    if (archId === this._lastReactId) return
    this._lastReactId = archId
    const lines = this._bossLines?.[archId]
    if (!Array.isArray(lines) || !lines.length) return
    const pick = lines[(Math.random() * lines.length) | 0]
    if (pick && pick.t) this._say(pick.t, pick.x || this._companion.restExpr)
  }

  // ── speech ──────────────────────────────────────────────────────────────────
  _greet() {
    const c = this._companion
    const greet = c.id === 'malakor'
      ? 'Pick your monster, then. The adventurers are already marching — and they will not gut themselves.'
      : 'Choose well, my liege. Whichever beast you crown, I will make the whole realm adore them.'
    this._say(greet, c.restExpr)
  }

  _say(text, expr) {
    if (!this._el) return
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null }
    this._setExpr(expr)
    this._bubbleEl.classList.add('open')
    this._typewrite(String(text || ''), () => {
      this._holdTimer = setTimeout(() => this._dismiss(), HOLD_MS)
    })
  }

  _dismiss() {
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null }
    this._bubbleEl?.classList.remove('open')
  }

  _setExpr(expr) {
    const c = this._companion
    const valid = c.expressions.includes(expr) ? expr : c.restExpr
    if (valid === this._curExpr) return
    this._curExpr = valid
    this._imgEl.src = c.spriteDir + valid + '.webp'
  }

  // Type a line letter-by-letter, with the same cadence + per-letter speech
  // blip as the in-game NpcCompanion.
  _typewrite(text, onDone) {
    if (this._typeTimer) { clearInterval(this._typeTimer); this._typeTimer = null }
    this._fullText = text
    this._textEl.textContent = ''
    let i = 0
    const step = text.length > 140 ? 2 : 1
    this._typeTimer = setInterval(() => {
      i = Math.min(text.length, i + step)
      this._textEl.textContent = text.slice(0, i)
      if (i >= text.length) {
        clearInterval(this._typeTimer)
        this._typeTimer = null
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

  // ── navigation ──────────────────────────────────────────────────────────────
  // Back returns to CompanionSelect — the screen before the boss picker.
  _back() {
    this.close()
    this._scene?.scene?.start('CompanionSelect')
  }
}

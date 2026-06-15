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
    // Mirror to face the book; `archScale` (default 1, a no-op for the tall
    // humanoids) sizes up a wide companion (Zul'Gath) on the boss screen.
    // `archOrigin` anchors that scale-up so his head sits past the book edge
    // and the faded tail overflows off-screen; `fadeMask` dissolves the tail.
    this._imgEl.style.transform = `scaleX(-1) scale(${c.archScale ?? 1})`
    if (c.archOrigin) this._imgEl.style.transformOrigin = c.archOrigin
    if (c.fadeMask) {
      this._imgEl.style.maskImage = c.fadeMask
      this._imgEl.style.webkitMaskImage = c.fadeMask
    }

    this._nameEl = h('div', { className: 'pix qf-cmpsel-bubble-name' }, c.name.toUpperCase())
    this._textEl = h('div', { className: 'qf-cmpsel-bubble-text' }, '')
    this._bubbleEl = h('div', { className: 'qf-cmpsel-bubble qf-archdec-bubble' },
      [this._nameEl, this._textEl])

    // `data-id` cascades the per-companion `--cmp-accent` CSS var
    // down to the .qf-archdec-bubble below (it inherits from
    // .qf-cmpsel-bubble, which paints its border using
    // `var(--cmp-accent)`). Without this attribute the variable is
    // undefined and the border has no colour at all — adding it gives
    // Lilith / Malakor / Zulgath / Safira the same coloured bubble
    // border here that they get on the recruit screen and in-game.
    // (See the matching `.qf-archdec-companion[data-id=...]` block in
    // styles.css that maps each id to its accent value.)
    this._companionEl = h('div', {
      className: 'qf-archdec-companion',
      dataset:   { id: c.id },
    }, [
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
    // Expand semantic ids to their variant files (Spectra etc.) so every
    // variant is preloaded, not just the semantic name itself.
    const groups = c.variantGroups || null
    const files = new Set()
    for (const id of ids) {
      const variants = groups?.[id]
      if (Array.isArray(variants) && variants.length) {
        for (const v of variants) files.add(v)
      } else {
        files.add(id)
      }
    }
    for (const f of files) {
      const im = new Image(); im.src = c.spriteDir + f + '.webp'
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
    // Per-companion greeting — each keeper addresses the player their own
    // way (Lilith "my liege", Malakor blunt, Zul'Gath "small one", Safira
    // "Master"). Falls back to Lilith's line for any unknown companion.
    const greets = {
      lilith:  'Choose well, my liege. Whichever beast you crown, I will make the whole realm adore them.',
      malakor: 'Pick your monster, then. The adventurers are already marching — and they will not gut themselves.',
      zulgath: 'Mm. Choose your monster, small one. I have watched every shape of dungeon-master rise and fall — whichever you crown, I have seen its ending before.',
      safira:  'Ooh, a CHOICE, Master! Pick the boss you wish to be and — *poof* — I grant it. Choose well; I get dreadfully attached to whatever you pick.',
      rattlebones: 'Pick your monster, skull-pal! The skeleton has watched every flavour of doom climb that throne — surprise me. Or don\'t! Either way is funny.',
      spectra: 'OMG OMG senpai you get to PICK YOUR BOSS?! Like a character select?! Wait wait — read the kit first, this is BIG, plot twist incoming!',
      necroknight: 'Choose the form you will wear into the dark, my Monarch. Whichever beast you crown, I will swear the same oath to it — and the dead will hold the line for it all the same.',
    }
    this._say(greets[c.id] ?? greets.lilith, c.restExpr)
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
    // Variant rotation (Spectra). Resolve the semantic id to a random
    // variant file when a group exists; otherwise the file is the id.
    const variants = c.variantGroups?.[valid]
    const file = (Array.isArray(variants) && variants.length > 0)
      ? variants[Math.floor(Math.random() * variants.length)]
      : valid
    // Ghost-flicker (Spectra). Same per-pick alpha roll as NpcCompanion's
    // in-game render path. Solid-only set is exempt for "she means it"
    // moments to land at full intensity.
    const flickerRate  = c.ghostFlickerRate  ?? 0
    const flickerAlpha = c.ghostFlickerAlpha ?? 0.7
    const solidOnly    = c.solidOnlyExpressions
    const exempt = Array.isArray(solidOnly) && solidOnly.includes(valid)
    const flicker = !exempt && flickerRate > 0 && Math.random() < flickerRate
    this._imgEl.style.opacity = String(flicker ? flickerAlpha : 1)
    this._imgEl.src = c.spriteDir + file + '.webp'
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
      if (snd) snd.play('sfx-speech', { volume: SfxVolume.getVolume() * BLIP_VOL * userSettings.voiceVolume() })
    } catch {}
  }

  // ── navigation ──────────────────────────────────────────────────────────────
  // Back returns to CompanionSelect — the screen before the boss picker.
  _back() {
    this.close()
    this._scene?.scene?.start('CompanionSelect')
  }
}

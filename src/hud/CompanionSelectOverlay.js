// CompanionSelectOverlay — the DOM screen for picking a dungeon keeper
// (crypt redesign, 2026-06-15).
//
// Shown by the CompanionSelect scene, between MainMenu's NEW EVIL and the
// ArchetypeSelect boss picker. A SUMMONING STAGE: one large hero portrait
// (left) + a lore panel (right: role / name / tagline / traits, or a lock
// message), with a roster RAIL of small busts along the bottom. Selecting a
// bust swaps the stage. Locked keepers render shrouded (greyed portrait +
// lock) and show their unlock hint instead of CONFIRM. The rail ends with
// two `?` mystery busts teasing "more keepers coming".
//
// "Keep the plumbing, replace the surface": all selection/persistence/unlock
// logic is preserved from the old 3-up pager —
//   • roster filtered so a player named "Lilith" can't pick Lilith
//     (`_computeVisibleOrder`)
//   • unlock state via `PlayerProfile.isCompanionUnlocked`
//   • the pick persists to localStorage `qf.companion`; CONFIRM → ArchetypeSelect
//   • NEW tags via `PlayerProfile.getKnownCompanionIds`/`markCompanionKnown`
//   • the unlock hint is derived from the achievement that grants the keeper
//
// Performance note (inherited from the old surface): the Phaser canvas
// repaints under this overlay every frame, so the backdrop is a FLAT fill
// (no full-screen gradient / blur / backdrop-filter — those got re-rastered
// 60×/sec and froze weak GPUs). The ember field animates transform/opacity
// only (GPU-composited, cheap); the locked state greys the portrait with a
// `filter`, never a backdrop-filter.

import { h } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { buildCryptBackdrop } from './menuBackdrop.js'
import { HudSfx, installHudSfxDelegates } from './HudSfx.js'
import {
  COMPANION_ORDER, COMPANIONS, DEFAULT_COMPANION,
} from '../systems/companions.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { AchievementSystem } from '../systems/AchievementSystem.js'

const STORE_KEY = 'qf.companion'
// Number of `?` mystery busts appended to the rail — a constant tease that
// "more keepers are coming" independent of the real roster size.
const MYSTERY_BUSTS = 2

// Per-companion accent colour — mirrors the canonical palette already used by
// `.qf-cmpsel-card[data-id]` / `.qf-archdec-companion[data-id]` / `.qf-npc
// [data-companion-id]` in styles.css, so the select screen tints to each
// keeper's own colour instead of a flat crypt-red.
const CMP_ACCENT = {
  lilith:      '#ff3782',
  malakor:     '#a070dc',
  zulgath:     '#ff8c2a',
  safira:      '#2caee8',
  nocturna:    '#7c6cff',
  rattlebones: '#ffe34d',
  luna:        '#cdd6f0',
  necroknight: '#4dff7a',
  spectra:     '#9b4dff',
}

// How long each picked-expression frame holds before the selected keeper
// cross-fades to the next — gives the hero portrait a little life instead of
// a frozen PNG.
const EXPR_CYCLE_MS = 2200

export class CompanionSelectOverlay {
  constructor(scene) {
    this._scene    = scene
    this._el       = null
    this._stageEl  = null   // .qf-csl-stage — hero + lore (rebuilt per selection)
    this._railEl   = null   // .qf-csl-rail  — bust strip (built once)
    this._bustRefs = {}     // id → bust element (for .on toggling)
    this._order    = COMPANION_ORDER.slice()
    this._selected = DEFAULT_COMPANION
    this._keyHandler = (e) => this._onKey(e)
    // Set of companion ids the player has been introduced to. Snapshot in
    // open(); select-dismiss mutates it in place.
    this._known = new Set()
  }

  open() {
    if (this._el) return
    installHudSfxDelegates()
    ensureStageScaled()

    // Recompute the roster each open() so renaming + unlock changes between
    // visits take effect. Hide any companion whose id/name matches the player.
    this._order = this._computeVisibleOrder()
    if (!this._order.length) this._order = COMPANION_ORDER.slice()

    // Default selection: the remembered pick if still visible + unlocked,
    // else the first unlocked companion, else the first in the roster.
    const unlocked = this._order.filter(id => this._isUnlocked(id))
    this._selected = unlocked[0] || this._order[0] || DEFAULT_COMPANION
    try {
      const stored = localStorage.getItem(STORE_KEY)
      if (stored && COMPANIONS[stored] && unlocked.includes(stored)) {
        this._selected = stored
      }
    } catch {}

    this._known = PlayerProfile.getKnownCompanionIds()

    this._render()
    this._preloadSprites()

    window.addEventListener('keydown', this._keyHandler)
  }

  close() {
    this._stopExprCycle()
    this._heroImg = null
    this._el?.remove()
    this._el = null
    window.removeEventListener('keydown', this._keyHandler)
  }

  // Tint the whole screen to the selected keeper's accent (falls back to the
  // crypt-red CSS default for any id without a mapped colour).
  _applyAccent(id) {
    const c = CMP_ACCENT[id]
    if (!this._el || !c) return
    this._el.style.setProperty('--acc', c)
    this._el.style.setProperty('--accDk', `color-mix(in srgb, ${c} 48%, #000)`)
  }

  // Cross-fade the selected (unlocked) keeper's portrait through its rest +
  // picked expressions on a timer, so the hero reads as alive. No-op for
  // keepers with a single frame (Luna / Nocturna) or a locked (shrouded) pick.
  _startExprCycle(c) {
    this._stopExprCycle()
    const img = this._heroImg
    if (!img || !c) return
    const frames = [...new Set([c.restExpr, ...(c.pickedExprs || [])].filter(Boolean))]
    if (frames.length <= 1) return
    // Warm every frame so swaps don't flash a blank while the webp loads.
    frames.forEach(f => { const im = new Image(); im.src = c.spriteDir + f + '.webp' })
    let i = 0
    this._exprTimer = setInterval(() => {
      if (this._heroImg !== img) { this._stopExprCycle(); return }
      i = (i + 1) % frames.length
      img.classList.add('swapping')
      setTimeout(() => {
        if (this._heroImg !== img) return
        img.src = c.spriteDir + frames[i] + '.webp'
        img.classList.remove('swapping')
      }, 200)
    }, EXPR_CYCLE_MS)
  }

  _stopExprCycle() {
    if (this._exprTimer) { clearInterval(this._exprTimer); this._exprTimer = null }
  }

  // ── data helpers (preserved plumbing) ───────────────────────────────────
  _isUnlocked(id) {
    if (!COMPANIONS[id]) return false
    return PlayerProfile.isCompanionUnlocked(id)
  }

  // Hide any companion whose id or display name matches the player's current
  // name (a player named "Lilith" cannot pick Lilith-the-companion).
  _computeVisibleOrder() {
    const name = PlayerProfile.getName().trim().toLowerCase()
    if (!name) return COMPANION_ORDER.slice()
    return COMPANION_ORDER.filter(id => {
      const c = COMPANIONS[id]
      if (!c) return false
      return id.toLowerCase() !== name && (c.name || '').toLowerCase() !== name
    })
  }

  // Achievement that grants this companion, if any — drives the lock hint.
  _findUnlockAchievement(companionId) {
    try {
      const defs = AchievementSystem.getDefinitions?.() || []
      for (const def of defs) {
        if (def?.reward?.type === 'companion' && def.reward.id === companionId) return def
      }
    } catch {}
    return null
  }

  // One-line unlock hint for a locked keeper. Companions store no `unlockHint`
  // field, so derive it from the granting achievement; fall back to a generic
  // tease for keepers with no wired unlock yet.
  _unlockHintFor(id) {
    const def = this._findUnlockAchievement(id)
    return def?.name ? `Earn the “${def.name}” trophy` : 'Hidden behind a trial to come'
  }

  _preloadSprites() {
    for (const id of this._order) {
      const c = COMPANIONS[id]
      if (!c) continue
      const im = new Image(); im.src = c.spriteDir + c.restExpr + '.webp'
    }
  }

  // Build the resting-face portrait <img> for a companion, applying the same
  // even-out transforms the old surface used (mirror / scale / origin / fade).
  _portraitImg(c, extraClass) {
    const img = h('img', {
      className: 'qf-csl-portimg' + (extraClass ? ' ' + extraClass : ''),
      alt: c.name, draggable: 'false',
    })
    img.src = c.spriteDir + c.restExpr + '.webp'
    const flip  = c.portraitFlipX ? -1 : 1
    const scale = c.portraitScale ?? 1
    img.style.transform = `scaleX(${flip}) scale(${scale})`
    if (c.portraitOrigin) img.style.transformOrigin = c.portraitOrigin
    if (c.fadeMask) { img.style.maskImage = c.fadeMask; img.style.webkitMaskImage = c.fadeMask }
    return img
  }

  // ── render ──────────────────────────────────────────────────────────────
  _render() {
    this._stageEl = h('div', { className: 'qf-csl-stage' })
    this._railEl  = h('div', { className: 'qf-csl-rail' })

    this._el = h('div', { className: 'qf-csl' }, [
      // Crypt backdrop — brick wall + flanking torches + fog (title-screen look).
      ...buildCryptBackdrop(),
      // Cheap ember field — transform/opacity only (GPU composited).
      h('div', { className: 'qf-csl-embers' }, this._emberPieces()),
      // Header — BACK + centered title block.
      h('div', { className: 'qf-csl-head' }, [
        h('button', { className: 'pix qf-csl-back', on: { click: () => this._back() } }, '◀  BACK'),
        h('div', { className: 'qf-csl-htext' }, [
          h('div', { className: 'sil qf-csl-eyebrow' }, [
            h('span', { className: 'ln' }), '◆ THE THRONE NEEDS A KEEPER ◆', h('span', { className: 'ln r' }),
          ]),
          h('div', { className: 'pix qf-csl-title' }, 'CHOOSE YOUR COMPANION'),
        ]),
        h('div', { className: 'qf-csl-spacer' }),
      ]),
      this._stageEl,
      this._railEl,
    ])

    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this._el)

    this._renderStage()
    this._renderRail()
  }

  // Hero portrait (left) + lore panel (right) for the current selection.
  // Rebuilt wholesale on each selection so the entrance pop re-triggers.
  _renderStage() {
    const id     = this._selected
    const c      = COMPANIONS[id]
    const locked = !this._isUnlocked(id)
    if (!c) { this._stageEl.replaceChildren(); return }

    // Hero frame.
    const heroKids = []
    if (!locked) heroKids.push(h('span', { className: 'sil qf-csl-chosen' }, '✦ YOUR KEEPER ✦'))
    const heroImg = this._portraitImg(c, locked ? 'is-locked' : null)
    this._heroImg = locked ? null : heroImg
    heroKids.push(heroImg)
    if (locked) heroKids.push(h('div', { className: 'qf-csl-shroud' }, [h('span', { className: 'lk' }, '🔒')]))
    const hero = h('div', { className: 'qf-csl-hero' + (locked ? ' locked' : '') }, heroKids)

    // Lore panel.
    const loreKids = [
      h('div', { className: 'sil qf-csl-role' }, 'THE KEEPER'),
      h('div', { className: 'pix qf-csl-name' }, c.name),
      h('div', { className: 'qf-csl-tag' }, c.tagline || ''),
      h('div', { className: 'qf-csl-traits' },
        (c.traits || []).map(t => h('span', { className: 'sil qf-csl-trait' }, t))),
    ]
    if (locked) {
      loreKids.push(h('div', { className: 'qf-csl-lockmsg' }, [
        h('span', { className: 'lk' }, '🔒'),
        h('span', { className: 'sil tx' }, ['SEALED TO YOU FOR NOW', h('b', null, 'Unlock · ' + this._unlockHintFor(id))]),
      ]))
    } else {
      loreKids.push(h('button', {
        className: 'pix qf-csl-confirm',
        on: { click: () => this._confirm() },
      }, `BIND ${(c.name || '').toUpperCase()}  ▶`))
    }
    const lore = h('div', { className: 'qf-csl-lore' }, loreKids)

    this._stageEl.replaceChildren(hero, lore)
    this._applyAccent(id)
    if (locked) this._stopExprCycle()
    else        this._startExprCycle(c)
  }

  // Roster rail — one bust per real companion + MYSTERY_BUSTS `?` teasers.
  // Built once; selection just toggles `.on` and dismisses NEW dots.
  _renderRail() {
    this._bustRefs = {}
    const busts = this._order.map(id => this._bust(id))
    for (let i = 0; i < MYSTERY_BUSTS; i++) busts.push(this._mysteryBust(i))
    this._railEl.replaceChildren(...busts)
    this._syncRail()
  }

  // Small rail bust — uniform `object-fit: contain` thumbnail (the big-card
  // tuned transforms would balloon a 116px cell), bottom-anchored so every
  // keeper stands on its name plate.
  _bustImg(c, locked) {
    const img = h('img', {
      className: 'qf-csl-bustimg' + (locked ? ' is-locked' : ''),
      src: c.spriteDir + c.restExpr + '.webp', alt: c.name, draggable: 'false',
    })
    if (c.portraitFlipX) img.style.transform = 'scaleX(-1)'
    return img
  }

  _bust(id) {
    const c      = COMPANIONS[id]
    const locked = !this._isUnlocked(id)
    const isNew  = !locked && !this._known.has(id)
    const portKids = [this._bustImg(c, locked)]
    if (locked) portKids.push(h('div', { className: 'qf-csl-bustshroud' }, '🔒'))
    if (isNew)  portKids.push(h('span', { className: 'sil qf-csl-newdot' }, 'NEW'))
    const bust = h('div', {
      className: 'qf-csl-bust' + (locked ? ' locked' : ''),
      dataset: { id },
      on: {
        mouseenter: () => this._hover(),
        click: () => this._selectBust(id),
      },
    }, [
      h('div', { className: 'qf-csl-bustport' }, portKids),
      h('div', { className: 'pix qf-csl-bustname' }, c.name),
    ])
    this._bustRefs[id] = bust
    return bust
  }

  _mysteryBust(i) {
    return h('div', { className: 'qf-csl-bust ph', dataset: { ph: String(i) }, 'aria-hidden': 'true' }, [
      h('div', { className: 'qf-csl-bustport' }, [h('div', { className: 'pix qf-csl-mystery' }, '?')]),
      h('div', { className: 'pix qf-csl-bustname' }, '???'),
    ])
  }

  // Toggle the selected bust's highlight across the rail.
  _syncRail() {
    for (const id of Object.keys(this._bustRefs)) {
      this._bustRefs[id]?.classList.toggle('on', id === this._selected)
    }
  }

  _emberPieces() {
    const out = []
    for (let k = 0; k < 18; k++) {
      const left  = (k * 5.7 + (k % 5) * 4.1) % 100
      const delay = (k % 9) * 0.6
      const dur   = 6 + (k % 5) * 1.4
      const size  = 2 + (k % 3)
      out.push(h('span', {
        className: 'qf-csl-ember',
        style: {
          left: left + '%', width: size + 'px', height: size + 'px',
          animationDelay: delay + 's', animationDuration: dur + 's',
        },
      }))
    }
    return out
  }

  // ── interaction ─────────────────────────────────────────────────────────
  _hover() { HudSfx.playUi('hover') }

  // Select a bust (locked or unlocked). Locked keepers ARE selectable so the
  // player can read their lock message + unlock hint; only CONFIRM is gated.
  _selectBust(id) {
    if (!COMPANIONS[id] || id === this._selected) return
    HudSfx.playUi(this._isUnlocked(id) ? 'click' : 'hover')
    this._selected = id
    // Dismiss the NEW dot when an unlocked keeper is first selected — remove it
    // from the rail immediately (the rail isn't rebuilt on select, so without
    // this the tag would linger until the screen is reopened).
    if (this._isUnlocked(id) && !this._known.has(id)) {
      PlayerProfile.markCompanionKnown(id)
      this._known.add(id)
      this._bustRefs[id]?.querySelector('.qf-csl-newdot')?.remove()
    }
    this._renderStage()
    this._syncRail()
  }

  // ── navigation (preserved plumbing) ─────────────────────────────────────
  _confirm() {
    // Never persist a locked / unknown id even if some keyboard flow routes
    // here without a valid selection.
    if (!this._isUnlocked(this._selected)) { HudSfx.playUi('denied'); return }
    HudSfx.playUi('click')
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
      // Cycle through the whole real roster (locked included, so the player
      // can browse silhouettes) — wraps around.
      if (!this._order.length) return
      const i   = this._order.indexOf(this._selected)
      const dir = e.key === 'ArrowRight' ? 1 : -1
      const next = this._order[(i + dir + this._order.length) % this._order.length]
      this._selectBust(next)
    }
  }
}

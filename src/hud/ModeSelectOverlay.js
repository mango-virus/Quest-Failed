// ModeSelectOverlay — the DOM screen for choosing a run's MODE.
//
// Shown by the ModeSelect scene, between MainMenu's NEW EVIL and the
// CompanionSelect keeper picker. Two cards — CAMPAIGN (The Kingdom's Reckoning,
// the 4-act win-condition run) and ENDLESS (survive forever, full content, no act
// structure). Select a card (click / arrows), then CONFIRM persists the pick to
// localStorage `qf.runMode` and moves on to CompanionSelect. ArchetypeSelect._beginRun
// reads that value into gameState.meta.mode, which isActsEnabled(gameState) keys on.
//
// Visual language mirrors CompanionSelectOverlay (crypt backdrop + ember field +
// BACK/title header) so the new-run flow reads as one continuous set of screens.
// Performance note (same as the companion screen): the Phaser canvas repaints
// under this overlay every frame, so the backdrop is a flat fill and the embers
// animate transform/opacity only.

import { h } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { buildCryptBackdrop } from './menuBackdrop.js'
import { HudSfx, installHudSfxDelegates } from './HudSfx.js'

const STORE_KEY = 'qf.runMode'

// The two modes. `accent` tints the whole screen to the selected card (mirrors
// the companion screen's per-keeper accent). `bullets` are the at-a-glance
// "what this mode is" lines a brand-new player reads before committing.
const MODES = [
  {
    id: 'campaign',
    accent: '#ff4d4d',   // hex-ok: fixed per-mode identity colour (not a retinting HUD token)
    kicker: 'THE KINGDOM’S RECKONING',
    title: 'CAMPAIGN',
    tagline: 'Four acts. Escalating champions. A final duel — win, or fall trying.',
    bullets: [
      'A run with a beginning and an end',
      'Your boss ascends a form each act',
      'Beat the Reckoning to unlock New Game+',
    ],
    sigil: '⚔',
    confirm: 'BEGIN THE RECKONING',
  },
  {
    id: 'endless',
    accent: '#46b8ff',   // hex-ok: fixed per-mode identity colour (not a retinting HUD token)
    kicker: 'THE ETERNAL SIEGE',
    title: 'ENDLESS',
    tagline: 'No acts, no ending. Hold your dungeon as long as you can.',
    bullets: [
      'Survive forever — it never stops',
      'The full bestiary, pure survival',
      'Climb the leaderboard by days held',
    ],
    sigil: '∞',
    confirm: 'BEGIN THE SIEGE',
  },
]

export class ModeSelectOverlay {
  constructor(scene) {
    this._scene = scene
    this._el = null
    this._cardRefs = {}
    this._selected = MODES[0].id
    this._keyHandler = (e) => this._onKey(e)
  }

  open() {
    if (this._el) return
    installHudSfxDelegates()
    ensureStageScaled()

    // Default to the remembered pick when it's a valid mode, else campaign.
    try {
      const stored = localStorage.getItem(STORE_KEY)
      if (stored && MODES.some(m => m.id === stored)) this._selected = stored
    } catch {}

    this._render()
    window.addEventListener('keydown', this._keyHandler)
  }

  close() {
    this._el?.remove()
    this._el = null
    window.removeEventListener('keydown', this._keyHandler)
  }

  _modeDef(id) { return MODES.find(m => m.id === id) || MODES[0] }

  _applyAccent(id) {
    const c = this._modeDef(id).accent
    if (!this._el || !c) return
    this._el.style.setProperty('--acc', c)
    this._el.style.setProperty('--accDk', `color-mix(in srgb, ${c} 48%, #000)`)
  }

  // ── render ──────────────────────────────────────────────────────────────
  _render() {
    this._el = h('div', { className: 'qf-msel' }, [
      ...buildCryptBackdrop(),
      h('div', { className: 'qf-msel-embers' }, this._emberPieces()),
      h('div', { className: 'qf-msel-head' }, [
        h('button', { className: 'pix qf-msel-back', on: { click: () => this._back() } }, '◀  BACK'),
        h('div', { className: 'qf-msel-htext' }, [
          h('div', { className: 'sil qf-msel-eyebrow' }, [
            h('span', { className: 'ln' }), '◆ HOW WILL YOU REIGN? ◆', h('span', { className: 'ln r' }),
          ]),
          h('div', { className: 'pix qf-msel-title' }, 'CHOOSE YOUR PATH'),
        ]),
        h('div', { className: 'qf-msel-spacer' }),
      ]),
      h('div', { className: 'qf-msel-cards' }, MODES.map(m => this._card(m))),
      h('div', { className: 'qf-msel-foot' }, [
        h('button', {
          className: 'pix qf-msel-confirm',
          on: { click: () => this._confirm() },
        }, this._modeDef(this._selected).confirm + '  ▶'),
      ]),
    ])

    const stage = document.getElementById('hud-stage') || document.body
    stage.appendChild(this._el)
    this._applyAccent(this._selected)
    this._syncCards()
  }

  _card(m) {
    const card = h('div', {
      className: 'qf-msel-card', dataset: { id: m.id },
      on: {
        mouseenter: () => this._hover(),
        click: () => this._select(m.id),
        dblclick: () => { this._select(m.id); this._confirm() },
      },
    }, [
      h('div', { className: 'qf-msel-sigil' }, m.sigil),
      h('div', { className: 'sil qf-msel-kicker' }, m.kicker),
      h('div', { className: 'pix qf-msel-cardtitle' }, m.title),
      h('div', { className: 'qf-msel-tag' }, m.tagline),
      h('ul', { className: 'qf-msel-bullets' },
        m.bullets.map(b => h('li', null, [h('span', { className: 'qf-msel-tick' }, '◆'), b]))),
      h('div', { className: 'sil qf-msel-chosen' }, '✦ CHOSEN'),
    ])
    this._cardRefs[m.id] = card
    return card
  }

  // Toggle the selected card's highlight + refresh the confirm label/accent.
  _syncCards() {
    for (const id of Object.keys(this._cardRefs)) {
      this._cardRefs[id]?.classList.toggle('on', id === this._selected)
    }
    const btn = this._el?.querySelector('.qf-msel-confirm')
    if (btn) btn.textContent = this._modeDef(this._selected).confirm + '  ▶'
  }

  _emberPieces() {
    const out = []
    for (let k = 0; k < 18; k++) {
      const left  = (k * 5.7 + (k % 5) * 4.1) % 100
      const delay = (k % 9) * 0.6
      const dur   = 6 + (k % 5) * 1.4
      const size  = 2 + (k % 3)
      out.push(h('span', {
        className: 'qf-msel-ember',
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

  _select(id) {
    if (!this._modeDef(id) || id === this._selected) return
    HudSfx.playUi('click')
    this._selected = id
    this._applyAccent(id)
    this._syncCards()
  }

  _confirm() {
    HudSfx.playUi('click')
    try { localStorage.setItem(STORE_KEY, this._selected) } catch {}
    this.close()
    this._scene?.scene?.start('CompanionSelect')
  }

  _back() {
    HudSfx.playUi('click')
    this.close()
    this._scene?.scene?.start('MainMenu')
  }

  _onKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); this._confirm(); return }
    if (e.key === 'Escape') { e.preventDefault(); this._back();    return }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const i = MODES.findIndex(m => m.id === this._selected)
      const dir = e.key === 'ArrowRight' ? 1 : -1
      this._select(MODES[(i + dir + MODES.length) % MODES.length].id)
    }
  }
}

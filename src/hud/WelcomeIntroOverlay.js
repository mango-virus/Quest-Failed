// WelcomeIntroOverlay — DOM port of the Phaser WelcomeIntroPopup.
//
// Fires once per run on Game-scene boot when `gameState.meta.introSeen`
// is false. Non-dismissable — the player must click CONTINUE. The
// "show how-to-play hints" checkbox persists to `meta.tutorialEnabled`
// (the TutorialSystem reads it before firing each hint).
//
// Not in the design source; UX matches the existing Phaser popup but
// re-skinned with the new tokens.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'
import { userSettings } from './userSettings.js'

const PARAGRAPHS = [
  {
    head: 'NIGHT — BUILD',
    body: 'Place rooms, traps, and minions. Earn gold by surviving days; spend it to grow your dungeon.',
  },
  {
    head: 'DAY — DEFEND',
    body: 'Adventurers invade through the entry hall. Stop them before they reach your boss chamber.',
  },
  {
    head: 'GROW — REPEAT',
    body: 'Every adventurer killed earns gold and boss XP. Level up to unlock new rooms, minions, traps, and Dark Pacts.',
  },
]

export class WelcomeIntroOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._tutorialChecked = true
  }

  // Open automatically if intro hasn't been seen. Caller (HudRoot) calls
  // this on construction. The intro now waits for the first NIGHT
  // PHASE cinematic to finish — without this gate, the welcome popup
  // opened immediately and overlapped the "NIGHT FALLS · THE BUILD"
  // cinematic that fires on Game-scene boot.
  maybeOpen() {
    if (this._gameState?.meta?.introSeen) return
    let _opened = false
    const tryOpen = () => {
      if (_opened) return
      _opened = true
      EventBus.off('PHASE_TRANSITION_FINISHED', onFinish)
      // Tiny extra delay so the cinematic's letterboxes fully clear
      // before the welcome modal animates in over them.
      setTimeout(() => this.open(), 120)
    }
    const onFinish = ({ phase } = {}) => {
      if (phase !== 'night') return
      tryOpen()
    }
    EventBus.on('PHASE_TRANSITION_FINISHED', onFinish)
    // Defensive fallback — if the cinematic never plays (e.g. the new
    // HUD is disabled and no PhaseTransition exists), still open the
    // intro after a beat so a returning player isn't stuck behind a
    // never-arriving event.
    setTimeout(tryOpen, 3200)
  }

  open() {
    if (this._overlay) return
    if (this._gameState?.meta?.introSeen) return
    // When the companion is enabled, Lilith delivers the intro herself
    // (NpcDirector handles NPC_DELIVER_INTRO and emits INTRO_DISMISSED on
    // the player's hint choice). This modal is only the fallback for a
    // player who has hidden her.
    if (!userSettings.isCompanionSilent()) {
      EventBus.emit('NPC_DELIVER_INTRO')
      return
    }
    this._overlay = new Overlay({
      title:    'WELCOME, BOSS',
      width:    600,
      height:   560,
      accent:   'var(--blood)',
      frame:    'plain',   // subtle main-menu edge instead of the accent frame
      closeOnBackdrop: false,
      onClose: () => { this._overlay = null },
      body:    this._renderBody(),
    })
    // Patch out the ESC handler so the player can't skip the intro.
    if (this._overlay) {
      window.removeEventListener('keydown', this._overlay._escHandler)
      this._overlay._escHandler = () => {}
    }
    this._overlay.open()
    // Also hide the X close button — UX is "press CONTINUE or nothing".
    const closeBtn = this._overlay.el?.querySelector('.qf-overlay-close')
    if (closeBtn) closeBtn.style.visibility = 'hidden'
  }

  _renderBody() {
    return h('div', { className: 'qf-welcome-body' }, [
      h('div', { className: 'pix qf-welcome-tagline' }, 'YOU ARE THE DUNGEON'),
      h('div', {
        className: 'pix qf-welcome-heading',
        style: { color: 'var(--blood)' },
      }, 'A REVERSE ROGUELIKE'),
      h('div', { className: 'qf-welcome-paragraphs' },
        PARAGRAPHS.map(p => h('div', { className: 'qf-welcome-paragraph' }, [
          h('div', {
            className: 'pix qf-welcome-paragraph-head',
            style: { color: 'var(--gold)' },
          }, p.head),
          h('div', { className: 'qf-welcome-paragraph-body' }, p.body),
        ]))
      ),
      // Tutorial checkbox row
      h('button', {
        className: 'qf-welcome-checkrow',
        ref: el => { this._refs = { ...(this._refs || {}), checkRow: el } },
        on: { click: () => this._toggleCheck() },
      }, [
        h('div', {
          className: 'qf-welcome-checkbox',
          ref: el => { this._refs = { ...(this._refs || {}), checkBox: el } },
          dataset: { on: 'true' },
        }, [
          h('span', { className: 'qf-welcome-check' }, '✓'),
        ]),
        h('span', { className: 'qf-welcome-checklabel' },
          'Show how-to-play hints as I play'),
      ]),
      // Continue button
      h('button', {
        className: 'btn primary lg qf-welcome-continue',
        on: { click: () => this._continue() },
      }, 'CONTINUE'),
    ])
  }

  _toggleCheck() {
    this._tutorialChecked = !this._tutorialChecked
    if (this._refs?.checkBox) {
      this._refs.checkBox.dataset.on = this._tutorialChecked ? 'true' : 'false'
    }
  }

  _continue() {
    if (this._gameState?.meta) {
      this._gameState.meta.introSeen = true
      this._gameState.meta.tutorialEnabled = this._tutorialChecked
    }
    // Also sync the SettingsOverlay master toggle. TutorialSystem
    // ANDs gameState.meta.tutorialEnabled with the localStorage
    // key — without this write, a player who previously disabled
    // hints in Settings (or had it disabled by an earlier build /
    // a clean install with a stale localStorage) would check the
    // box here and STILL see no hints because the master flag
    // overrode them. The welcome screen is the player's primary
    // first-touch opt-in/out, so we treat its choice as canonical
    // and propagate it down to the persistent setting.
    try {
      localStorage.setItem('qf.gameplay.tutorials', this._tutorialChecked ? 'true' : 'false')
    } catch {}
    EventBus.emit('INTRO_DISMISSED', { tutorialEnabled: this._tutorialChecked })
    const ov = this._overlay
    this._overlay = null
    ov?._opts && (ov._opts.onClose = null)
    ov?.close()
  }

  destroy() {
    this._overlay?.close()
    this._overlay = null
  }
}

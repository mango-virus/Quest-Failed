// TutorialOverlay — DOM port of the Phaser TutorialPopup.
//
// Small sticky modal driven by `SHOW_TUTORIAL { title, body, onClose }`
// fired from TutorialSystem. Player must click GOT IT — no Esc / backdrop
// dismiss. After dismissal, `onClose` fires so TutorialSystem can advance
// its queue.
//
// Not in the design source; matches the existing Phaser popup's UX
// re-skinned with the new tokens.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'
import { PauseManager } from '../systems/PauseManager.js'
import { userSettings } from './userSettings.js'

export class TutorialOverlay {
  constructor() {
    this._overlay = null
    this._onCloseCb = null
    this._listener = (payload) => this.showFor(payload)
    EventBus.on('SHOW_TUTORIAL', this._listener)
  }

  showFor({ title = 'HINT', body = '', lead = null, tips = null, onClose } = {}) {
    // When the companion NPC is enabled she delivers tutorials herself
    // (NpcDirector intercepts SHOW_TUTORIAL and fires onClose when the
    // player pages past the last panel). This standalone popup is only
    // the fallback for players who have hidden her.
    if (!userSettings.isCompanionSilent()) return
    // If a previous tutorial is still open, fire its onClose then swap.
    if (this._overlay) this._dismiss(/* fireCb */ true)
    this._onCloseCb = onClose ?? null
    // Auto-size height by content. The body card is the dominant
    // chunk — at 13px font + line-height 1.55 in a 540px-wide card,
    // a 4-sentence paragraph wraps to ~5 lines (~100px). Estimate
    // body lines from char count (≈70 chars/line) and budget
    // accordingly. Keeps short hints compact while letting the
    // longer archetype copy + 3 tips expand without scrolling.
    const tipCount = Array.isArray(tips) ? tips.length : 0
    const bodyLines = Math.max(1, Math.ceil((body?.length ?? 0) / 70))
    const baseChrome = 240     // title bar + GOT IT + opt-out button + outer padding
    const bodyBlock  = 40 + bodyLines * 22  // card padding + wrapped lines
    const leadBlock  = lead ? 36 : 0
    const tipsBlock  = tipCount > 0 ? (tipCount * 36 + 6) : 0
    const height = baseChrome + leadBlock + bodyBlock + tipsBlock
    this._overlay = new Overlay({
      title:           String(title).toUpperCase(),
      width:           600,
      height,
      accent:          'var(--gold)',
      frame:           'plain',   // subtle main-menu edge instead of the accent frame
      closeOnBackdrop: false,
      onClose:         () => { this._overlay = null },
      body: h('div', { className: 'qf-tutorial-body' }, [
        // Optional one-line "lead" — flavor sentence to set tone before
        // the explanatory body. Same role as the WelcomeIntro tagline.
        lead && h('div', { className: 'pix qf-tutorial-lead' }, lead),
        // Body paragraph card — gold-left-border treatment matching
        // the welcome-paragraph block style.
        h('div', { className: 'qf-tutorial-paragraph' }, [
          h('div', { className: 'qf-tutorial-text' }, body || '—'),
        ]),
        // Optional bullet tips — short, actionable, one per line.
        Array.isArray(tips) && tips.length > 0 && h('ul', { className: 'qf-tutorial-tips' },
          tips.map(t => h('li', { className: 'qf-tutorial-tip' }, t))
        ),
        // GOT IT dismisses just this hint. "Turn off hints" opts out of
        // every future hint — for players who no longer want them.
        h('div', {
          className: 'qf-tutorial-actions',
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' },
        }, [
          h('button', {
            className: 'btn primary lg qf-tutorial-got',
            on: { click: () => this._dismiss(true) },
          }, 'GOT IT'),
          h('button', {
            className: 'btn qf-tutorial-optout',
            style: { fontSize: '11px', padding: '5px 14px', opacity: 0.7 },
            on: { click: () => this._disableHints() },
          }, '✕ Turn off hints'),
        ]),
      ]),
    })
    // Defang Esc; hide X close button.
    if (this._overlay) {
      window.removeEventListener('keydown', this._overlay._escHandler)
      this._overlay._escHandler = () => {}
      const closeBtn = this._overlay.el?.querySelector('.qf-overlay-close')
      if (closeBtn) closeBtn.style.visibility = 'hidden'
    }
    this._overlay.open()
    // Freeze gameplay scenes while the hint is up so the player isn't
    // taking damage / losing rooms / progressing the day clock while
    // they read. softPause is counted, so successive tutorials in the
    // same queue resume cleanly once the last one is dismissed.
    PauseManager.softPause()
    this._softPauseHeld = true
  }

  isOpen() { return !!this._overlay }

  _dismiss(fireCb) {
    const cb = this._onCloseCb
    this._onCloseCb = null
    const ov = this._overlay
    this._overlay = null
    ov?._opts && (ov._opts.onClose = null)
    ov?.close()
    // Release the soft pause we took in showFor(). Guarded by
    // _softPauseHeld so a stray double-dismiss can't decrement the
    // global lock count below zero.
    if (this._softPauseHeld) {
      this._softPauseHeld = false
      PauseManager.softResume()
    }
    if (fireCb) cb?.()
  }

  // Player opted out from the hint popup itself. Flips the global
  // GAMEPLAY > GAMEPLAY HINTS setting off — the same localStorage key the
  // Settings panel and TutorialSystem both read — so no further hints fire
  // and the choice persists across runs. TutorialSystem._popNext re-checks
  // this key when this popup's onClose advances the queue, so any queued
  // backlog is dropped too. Re-enable any time from Settings › Gameplay.
  _disableHints() {
    try { localStorage.setItem('qf.gameplay.tutorials', 'false') } catch {}
    this._dismiss(true)
  }

  destroy() {
    EventBus.off('SHOW_TUTORIAL', this._listener)
    this._dismiss(false)
  }
}

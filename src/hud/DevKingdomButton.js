// DevKingdomButton — mango-only floating dev button for force-firing a Kingdom
// Response (KR P4) so we can QA any drafted-act modifier instantly without
// grinding 20 days to reach one. Sibling of DevEventsButton.
//
// Visible only when PlayerProfile.isCheatName() AND the `acts` feature is on.
// Self-mounts a small button bottom-left of #hud-stage (offset from TEST EVENT).
// Clicking opens a grid of the 8 Kingdom Responses; clicking one fires
// DEV_FORCE_KINGDOM_RESPONSE { responseId }. The modal also carries a "TEST BOSS
// ASCENSION" button that fires DEV_TEST_ASCENSION — KingdomModifierSystem builds
// a faithful, non-destructive ascension preview from the live boss + archetype.
// KingdomResponseSystem handles the force-response:
// sets the current act to a drafted act + that response (activating the act-wide
// modifier + the pill/eyebrow), announces it, and — if a day is in progress —
// spawns that response's Champion raid so the combat modifier is live too.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { isActsEnabled } from '../config/acts.js'
import { PauseManager } from '../systems/PauseManager.js'

export class DevKingdomButton {
  constructor() {
    this._btn = null
    this._modal = null
    this._escFn = null
    if (!PlayerProfile.isCheatName?.() || !isActsEnabled()) return
    this._mount()
  }

  destroy() {
    this._closeModal()
    this._btn?.remove()
    this._btn = null
  }

  _mount() {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    this._btn = h('button', {
      className: 'qf-dev-events-btn qf-dev-kr-btn',
      title: 'Mango dev — force a Kingdom Response (drafted-act modifier) to fire now',
      on: { click: () => this._openModal() },
    }, 'TEST KR')
    stage.appendChild(this._btn)
  }

  _responses() {
    return (window.__game?.scene?.scenes ?? [])
      .map(s => s?.cache?.json?.get?.('kingdomResponses'))
      .find(Array.isArray) ?? []
  }

  _openModal() {
    if (this._modal) return
    const responses = this._responses()
    if (responses.length === 0) return
    const stage = document.getElementById('hud-stage') ?? document.body

    const cards = responses.map(def => h('button', {
      className: 'qf-dev-events-card',
      style: { borderColor: def.accent || 'var(--gold)' },
      on: { click: () => this._pick(def.id) },
    }, [
      h('div', { className: 'qf-dev-events-card-icon', style: { color: def.accent || 'var(--gold)' } }, def.emblem || '◆'),
      h('div', { className: 'qf-dev-events-card-name pix' }, def.name || def.id),
      h('div', { className: 'qf-dev-events-card-id' }, def.id),
    ]))

    this._modal = h('div', {
      className: 'qf-dev-events-modal',
      on: { click: (e) => { if (e.target === e.currentTarget) this._closeModal() } },
    }, [
      h('div', { className: 'qf-dev-events-card-wrap' }, [
        h('div', { className: 'qf-dev-events-title pix' }, 'TEST KINGDOM RESPONSE  ·  MANGO ONLY'),
        h('div', { className: 'qf-dev-events-flavor pix' },
          'Click a response to make it the current drafted act: activates its ' +
          'act-wide modifier + the HUD eyebrow, and (if a day is running) spawns ' +
          'its Champion raid so the combat modifier is live.'),
        h('button', {
          className: 'btn primary qf-dev-asc-btn',
          title: 'Preview the boss-ascension screen now — uses real boss/archetype data, deploys nothing',
          style: { display: 'block', margin: '2px auto 12px' },
          on: { click: () => this._fireAscension() },
        }, '▲  TEST BOSS ASCENSION  ▲'),
        h('div', { className: 'qf-dev-events-grid' }, cards),
        h('div', { className: 'qf-dev-events-close pix', on: { click: () => this._closeModal() } }, 'CLOSE'),
      ]),
    ])
    PauseManager.softPause()   // freeze the world while the dev picker is open
    stage.appendChild(this._modal)
    this._escFn = (e) => { if (e.key === 'Escape') this._closeModal() }
    window.addEventListener('keydown', this._escFn)
  }

  _pick(responseId) {
    if (!responseId) return
    EventBus.emit('DEV_FORCE_KINGDOM_RESPONSE', { responseId })
    this._closeModal()
  }

  _fireAscension() {
    EventBus.emit('DEV_TEST_ASCENSION', {})
    this._closeModal()
  }

  _closeModal() {
    if (this._escFn) { window.removeEventListener('keydown', this._escFn); this._escFn = null }
    if (this._modal) { this._modal.remove(); this._modal = null; PauseManager.softResume() }
  }
}

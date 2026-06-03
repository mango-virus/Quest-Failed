// DevSpawnClassButton — mango-only floating dev button for spawning a single
// adventurer of ANY class into the current day, so its sprite, walk/attack
// animations, and ability VFX can be watched on demand (no grinding to a
// class's unlockLevel or waiting on a lucky wave roll).
//
// Visible only when `PlayerProfile.isCheatName()` (player name === 'mango').
// Self-mounts a small button bottom-left of #hud-stage (stacked above TEST KR).
// Clicking opens a modal grid of every adventurer class from
// adventurerClasses.json. Clicking a class fires `DEV_SPAWN_CLASS { classId }`;
// DayPhase spawns it as a solo raider via the canonical wave-spawn path.
//
// Day-phase only by design (raiders only act in the day) — clicking during the
// build/night phase is a no-op (no DayPhase listener mounted). The modal says so.
//
// Mango-only by design — the button name + style flag it as a developer surface.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { PauseManager } from '../systems/PauseManager.js'

export class DevSpawnClassButton {
  constructor() {
    this._btn   = null
    this._modal = null
    this._escFn = null
    if (!PlayerProfile.isCheatName?.()) return
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
      className: 'qf-dev-events-btn qf-dev-spawn-btn',
      title: 'Mango dev — spawn one adventurer of any class into the current day',
      on: { click: () => this._openModal() },
    }, 'TEST ADV')
    stage.appendChild(this._btn)
  }

  _classes() {
    return (window.__game?.scene?.scenes ?? [])
      .map(s => s?.cache?.json?.get?.('adventurerClasses'))
      .find(Array.isArray) ?? []
  }

  _openModal() {
    if (this._modal) return
    const classes = this._classes()
    if (classes.length === 0) return
    const stage = document.getElementById('hud-stage') ?? document.body

    const cards = classes.map(def => h('button', {
      className: 'qf-dev-events-card',
      on: { click: () => this._pick(def.id) },
    }, [
      h('div', { className: 'qf-dev-events-card-icon', style: { color: '#' + String(def.color || '0xaabbcc').replace(/^0x/, '') } }, '◆'),
      h('div', { className: 'qf-dev-events-card-name pix' }, def.name || def.id),
      h('div', { className: 'qf-dev-events-card-id' }, def.id),
    ]))

    this._modal = h('div', {
      className: 'qf-dev-events-modal',
      on: { click: (e) => { if (e.target === e.currentTarget) this._closeModal() } },
    }, [
      h('div', { className: 'qf-dev-events-card-wrap' }, [
        h('div', { className: 'qf-dev-events-title pix' }, 'TEST ADV  ·  MANGO ONLY'),
        h('div', { className: 'qf-dev-events-flavor pix' },
          'Click a class to spawn one solo raider into the current DAY (it enters ' +
          'at an entry hall and acts immediately — fight your minions to watch its ' +
          'abilities + VFX). During the build/night phase this is a no-op — start a ' +
          'day first.'),
        h('div', { className: 'qf-dev-events-grid' }, cards),
        h('div', { className: 'qf-dev-events-close pix',
          on: { click: () => this._closeModal() },
        }, 'CLOSE'),
      ]),
    ])
    // Freeze the world while the picker is open (soft pause — no pause UI) so a
    // class can be chosen + spawned into a still scene, then watched on resume.
    PauseManager.softPause()
    stage.appendChild(this._modal)

    this._escFn = (e) => { if (e.key === 'Escape') this._closeModal() }
    window.addEventListener('keydown', this._escFn)
  }

  _pick(classId) {
    if (!classId) return
    EventBus.emit('DEV_SPAWN_CLASS', { classId })
    this._closeModal()
  }

  _closeModal() {
    if (this._escFn) {
      window.removeEventListener('keydown', this._escFn)
      this._escFn = null
    }
    if (this._modal) {
      this._modal.remove()
      this._modal = null
      PauseManager.softResume()   // pairs with the softPause in _openModal
    }
  }
}

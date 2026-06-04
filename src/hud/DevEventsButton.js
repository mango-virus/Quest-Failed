// DevEventsButton — mango-only floating dev button for force-firing
// dungeon events. Restores the old "trigger event" dev affordance that
// shipped before the HUD rewrite.
//
// Visible only when `PlayerProfile.isCheatName()` (player name === 'mango').
// Self-mounts a small button in the bottom-left of #hud-stage. Clicking
// it opens a modal listing every event from events.json as a card grid.
// Clicking an event card fires `DEV_FORCE_EVENT { eventId }`; EventSystem
// then tears down any in-progress event and immediately schedules +
// applies the picked one (see EventSystem._onDevForceEvent).
//
// Mango-only by design — leaks to real players are unwanted (the
// button name + style flag it clearly as a developer surface).

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { PauseManager } from '../systems/PauseManager.js'

export class DevEventsButton {
  constructor() {
    this._btn      = null
    this._modal    = null
    this._escFn    = null
    // Mango gate — bail before mounting anything if the player isn't on
    // the dev account. Re-construct on name change is handled by the
    // HudRoot which rebuilds on cheat-state changes (or just doesn't —
    // the button never appearing is the correct behaviour for a normal
    // run).
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
      className: 'qf-dev-events-btn',
      title: 'Mango dev — force the next dungeon event to fire',
      on: { click: () => this._openModal() },
    }, 'TEST EVENT')
    stage.appendChild(this._btn)
  }

  _openModal() {
    if (this._modal) return
    // Pull events.json from any active Phaser scene's JSON cache. The
    // dev button doesn't carry its own gameState, so look up the live
    // game instance.
    const events = (window.__game?.scene?.scenes ?? [])
      .map(s => s?.cache?.json?.get?.('events'))
      .find(Array.isArray) ?? []
    if (events.length === 0) return

    const stage = document.getElementById('hud-stage') ?? document.body
    const cards = events.map(def => h('button', {
      className: 'qf-dev-events-card',
      on: { click: () => this._pick(def.id) },
    }, [
      h('div', { className: 'qf-dev-events-card-icon' }, def.icon || '◆'),
      h('div', { className: 'qf-dev-events-card-name pix' }, def.title || def.id),
      h('div', { className: 'qf-dev-events-card-id' }, def.id),
    ]))

    // Aldric Act IV climax-duel triggers — force-spawn the crowned Hero King in
    // duel mode right now (radiant or desperate form) so the climax cinematic
    // can be watched without grinding to day 40. Routed to DayPhase via
    // DEV_FORCE_ALDRIC_DUEL; only fires meaningfully during a day phase.
    const duelCard = (form, label, icon) => h('button', {
      className: 'qf-dev-events-card',
      on: { click: () => this._pickDuel(form) },
    }, [
      h('div', { className: 'qf-dev-events-card-icon' }, icon),
      h('div', { className: 'qf-dev-events-card-name pix' }, label),
      h('div', { className: 'qf-dev-events-card-id' }, `aldric_duel · ${form}`),
    ])

    // Aldric Acts I–III SCOUT triggers — force-spawn the scouting nemesis at a
    // chosen act (with a few decoy adventurers) so his stalk → throne stand →
    // flow + per-act sprite/lines/glow/sword can be watched without grinding to
    // an act-final day. Routed to DayPhase via DEV_FORCE_ALDRIC_SCOUT.
    const scoutCard = (act, label, icon) => h('button', {
      className: 'qf-dev-events-card',
      on: { click: () => this._pickScout(act) },
    }, [
      h('div', { className: 'qf-dev-events-card-icon' }, icon),
      h('div', { className: 'qf-dev-events-card-name pix' }, label),
      h('div', { className: 'qf-dev-events-card-id' }, `aldric_scout · act ${act}`),
    ])

    // Kingdom-Response CHAMPION RAID triggers — force any of the 9 act bosses (+
    // its retinue) right now, so each can be fought and balance-checked without
    // waiting for a drafted act's climax day. Routed via DEV_FORCE_CHAMPION_RAID;
    // the ChampionBar shows the spawned boss's HP. One at a time — kill the live
    // champion before spawning the next.
    const championCard = (id, label, icon) => h('button', {
      className: 'qf-dev-events-card',
      on: { click: () => this._pickChampion(id) },
    }, [
      h('div', { className: 'qf-dev-events-card-icon' }, icon),
      h('div', { className: 'qf-dev-events-card-name pix' }, label),
      h('div', { className: 'qf-dev-events-card-id' }, `champion · ${id}`),
    ])

    // ── VFX SANDBOX (window.__qfDev) ──
    // Set up a clean test stage for the champion raids above: toggle fast ability
    // casts, spawn mixed-tier minions + traps for the signatures to hit, start the
    // day, or clear it all. `keepOpen` actions don't dismiss the modal so you can
    // chain them; populate/start-day close so you can watch the result.
    const sandboxCard = (label, sub, icon, onClick, keepOpen = false) => h('button', {
      className: 'qf-dev-events-card sandbox',
      on: { click: (e) => {
        if (keepOpen) {
          // Stay in the menu (toggles / spawns) — just run it + update the label.
          const r = onClick()
          if (typeof r === 'string') e.currentTarget.querySelector('.qf-dev-events-card-name').textContent = r
        } else {
          // Day-start actions: CLOSE first so PauseManager.softResume runs and the
          // scene is live — _beginDay bails on a soft-paused NightPhase. Then act.
          this._closeModal()
          onClick()
        }
      } },
    }, [
      h('div', { className: 'qf-dev-events-card-icon' }, icon),
      h('div', { className: 'qf-dev-events-card-name pix' }, label),
      h('div', { className: 'qf-dev-events-card-id' }, sub),
    ])

    this._modal = h('div', {
      className: 'qf-dev-events-modal',
      on: {
        click: (e) => { if (e.target === e.currentTarget) this._closeModal() },
      },
    }, [
      h('div', { className: 'qf-dev-events-card-wrap' }, [
        h('div', { className: 'qf-dev-events-title pix' }, 'TEST EVENT  ·  MANGO ONLY'),
        h('div', { className: 'qf-dev-events-flavor pix' },
          'Force a set-piece or a scheduled event right now (bypasses cadence + ' +
          'eligibility). Set-pieces need an active day phase with a built dungeon.'),

        // ── Kingdom's Reckoning set-pieces (Aldric) ──
        h('div', { className: 'qf-dev-events-section kr pix' }, 'ALDRIC · THE NEMESIS'),
        h('div', { className: 'qf-dev-events-grid' }, [
          scoutCard(1, 'SCOUT ALDRIC · ACT I',   '⚔'),
          scoutCard(2, 'SCOUT ALDRIC · ACT II',  '⚔'),
          scoutCard(3, 'SCOUT ALDRIC · ACT III', '⚔'),
          duelCard('radiant',   'ALDRIC DUEL · RADIANT',   '♔'),
          duelCard('desperate', 'ALDRIC DUEL · DESPERATE', '♛'),
        ]),

        // ── VFX sandbox — set up targets so the champion signatures have things to hit ──
        h('div', { className: 'qf-dev-events-section sandbox pix' }, 'VFX SANDBOX  ·  window.__qfDev'),
        h('div', { className: 'qf-dev-events-grid' }, [
          sandboxCard('BUILD ARENA', 'wire an entry hall to the boss', '🏗',
            () => this._qfDev()?.arena(), true),
          sandboxCard('QUIET DAY', 'start a day · NO normal wave', '🔇',
            () => this._qfDev()?.quietDay(true)),
          sandboxCard('START DAY', 'start a NORMAL wave day', '▶',
            () => this._qfDev()?.startDay()),
          sandboxCard(this._fastLabel(), 'cast in ~0.6s, not 4.5s', '⚡',
            () => { const on = this._qfDev()?.fastAbilities(!globalThis.__qfDevFastAbilities); return on ? 'FAST ABILITIES: ON' : 'FAST ABILITIES: OFF' }, true),
          sandboxCard('POPULATE TARGETS', '8 minions (+undead) + 3 traps', '☠',
            () => this._qfDev()?.populate({ minions: 8, traps: 3 }), true),
          sandboxCard('CLEAR SANDBOX', 'remove test minions/traps/raids', '✖',
            () => this._qfDev()?.clear(), true),
        ]),

        // ── The 9 act-boss champion raids (balance testing) ──
        h('div', { className: 'qf-dev-events-section champ pix' }, 'CHAMPION RAIDS · THE 9 ACT BOSSES'),
        h('div', { className: 'qf-dev-events-grid' }, [
          championCard('rival',          'RIVAL · VORZAK',        '⚑'),
          championCard('inquisition',    'INQUISITION · MORDRAKE', '⚖'),
          championCard('pantheon',       'PANTHEON · AURELIA',    '☼'),
          championCard('betrayer',       'BETRAYER · TURNCOAT',   '⇄'),
          championCard('reckoning_dead', 'DEAD · NECRARCH',       '☠'),
          championCard('forlorn_hope',   'FORLORN · HALRIC',      '♟'),
          championCard('mage_tower',     'MAGE TOWER · VELLORAN', '✶'),
          championCard('all_stars',      'ALL-STARS · GARRETH',   '★'),
          championCard('plunderers',     'PLUNDERERS · VANE',     '⚿'),
        ]),

        // ── Normal scheduled events ──
        h('div', { className: 'qf-dev-events-section evt pix' }, 'SCHEDULED EVENTS'),
        h('div', { className: 'qf-dev-events-grid' }, cards),

        h('div', { className: 'qf-dev-events-close pix',
          on: { click: () => this._closeModal() },
        }, 'CLOSE'),
      ]),
    ])
    PauseManager.softPause()   // freeze the world while the dev picker is open
    stage.appendChild(this._modal)

    this._escFn = (e) => { if (e.key === 'Escape') this._closeModal() }
    window.addEventListener('keydown', this._escFn)
  }

  _pick(eventId) {
    if (!eventId) return
    EventBus.emit('DEV_FORCE_EVENT', { eventId })
    this._closeModal()
  }

  _pickDuel(form) {
    EventBus.emit('DEV_FORCE_ALDRIC_DUEL', { form })
    this._closeModal()
  }

  _pickScout(act) {
    EventBus.emit('DEV_FORCE_ALDRIC_SCOUT', { act })
    this._closeModal()
  }

  _pickChampion(responseId) {
    EventBus.emit('DEV_FORCE_CHAMPION_RAID', { responseId })
    this._closeModal()
  }

  // The VFX sandbox API (installed on the Game scene under the mango account).
  _qfDev() {
    const api = window.__qfDev
    if (!api) console.warn('[dev] __qfDev not installed — start a run first')
    return api
  }
  _fastLabel() { return globalThis.__qfDevFastAbilities ? 'FAST ABILITIES: ON' : 'FAST ABILITIES: OFF' }

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

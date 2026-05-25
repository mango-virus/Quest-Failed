// BottomBar — DOM port of the design's bottom action console.
//
// Layout (one centered pixel-bevel console):
//   [PLACE] [MOVE] [SELL]  |  PHASE label · BEGIN DAY (night)   |  [ROSTER] [KNOWLEDGE] [ADV INTEL] [MENU]
//                          |  PHASE label · 1× 2× 4× 8× (day)   |
//
// Event contract is drop-in compatible with the Phaser ActionBar so the
// rest of the game (NightPhase / DayPhase / HudScene popups) needs zero
// changes:
//
//   PLACE     — disarms any active tool (emits the armed tool's toggle event)
//   MOVE      — emits TOOL_MOVE (NightPhase toggles 'move' mode)
//   SELL      — emits TOOL_SELL (NightPhase toggles 'sell' mode)
//   BEGIN DAY — emits PHASE_TOGGLE_REQUEST
//   1×/2×/4×/8× — emits TIME_SCALE_SET { scale: N }, matching ActionBar's
//                 SPEED_STEPS = [1, 2, 4, 8]
//   ROSTER / KNOWLEDGE / ADV INTEL / MENU — emit the corresponding OPEN_*
//
// Subscribes to TOOL_MODE_CHANGED to keep the armed-tool highlight in sync
// regardless of which surface armed the tool. Phase + speed state is
// polled from gameState each frame; one-shot animation re-triggers (the
// BEGIN DAY pulse) live on phase events.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

const SPEED_STEPS = [1, 2, 4, 8]

export class BottomBar {
  constructor(gameState) {
    this._gameState = gameState
    this._listeners = []
    this._armedTool = null
    this._currentSpeed = 1
    this._prev = { phase: null }

    this.el = this._build()
    this._wireEvents()
    this._tickHandle = requestAnimationFrame(() => this._tick())
  }

  _build() {
    this._refs = {}
    const modes = [
      { id: 'place', label: 'PLACE', icon: '➕' /* + */ },
      { id: 'move',  label: 'MOVE',  icon: '⤷' /* ⤷ */ },
      { id: 'sell',  label: 'SELL',  icon: '␡' /* ⌫ */ },
    ]

    const root = h('div', { className: 'qf-bottombar' }, [
      h('div', { className: 'qf-bottombar-console' }, [
        // BUILD MODES
        h('div', { className: 'qf-bb-group qf-bb-modes' }, [
          modes.map(m => h('button', {
            className: 'btn qf-bb-mode',
            dataset: { mode: m.id },
            ref: el => { this._refs[`mode_${m.id}`] = el },
            on: { click: () => this._onModeClick(m.id) },
          }, [
            h('span', { className: 'qf-bb-mode-icon' }, m.icon),
            m.label,
          ])),
        ]),

        h('div', { className: 'qf-bb-divider' }),

        // PHASE STATUS + PRIMARY ACTION (BEGIN DAY or speed control)
        h('div', { className: 'qf-bb-group qf-bb-phase' }, [
          h('div', { className: 'qf-bb-phase-col' }, [
            h('span', { className: 'pix qf-bb-phase-label' }, 'PHASE'),
            h('span', {
              className: 'pix qf-bb-phase-status',
              ref: el => { this._refs.phaseStatus = el },
            }, 'NIGHT · BUILD'),
          ]),
          h('button', {
            className: 'btn primary qf-bb-begin',
            ref: el => { this._refs.beginBtn = el },
            on: { click: () => EventBus.emit('PHASE_TOGGLE_REQUEST') },
          }, '▶  BEGIN DAY'),
          h('div', {
            className: 'qf-bb-speed',
            ref: el => { this._refs.speedBox = el },
            style: { display: 'none' },
          }, [
            h('span', { className: 'pix qf-bb-speed-label' }, '⏵ SPEED'),
            h('div', { className: 'qf-bb-speed-btns' },
              SPEED_STEPS.map(s => h('button', {
                className: 'qf-bb-speed-btn',
                dataset: { speed: s },
                ref: el => { this._refs[`speed_${s}`] = el },
                on: { click: () => this._onSpeedClick(s) },
              }, `${s}×`))
            ),
          ]),
          // Archetype action slot — BossArchetypeStrip mounts EARTHQUAKE
          // / SACRIFICE buttons here during day phase so they don't float
          // above the bar and cover the dungeon view. Empty by default;
          // gets `.has-buttons` toggled by BossArchetypeStrip when one
          // is active so the surrounding gap can collapse cleanly.
          h('div', {
            className: 'qf-bb-archetype-slot',
            ref: el => { this._refs.archetypeSlot = el; this.archetypeSlot = el },
          }),
        ]),

        h('div', { className: 'qf-bb-divider' }),

        // MENUS
        h('div', { className: 'qf-bb-group qf-bb-menus' }, [
          h('button', {
            className: 'btn qf-bb-menu',
            on: { click: () => EventBus.emit('OPEN_MINION_ROSTER') },
          }, [h('span', { className: 'qf-bb-menu-icon poison' }, '▤'), ' ROSTER']),
          h('button', {
            className: 'btn qf-bb-menu',
            on: { click: () => EventBus.emit('OPEN_KNOWLEDGE_MAP') },
          }, [h('span', { className: 'qf-bb-menu-icon muted' }, '◈'), ' KNOWLEDGE']),
          h('button', {
            className: 'btn qf-bb-menu',
            on: { click: () => EventBus.emit('OPEN_ADV_INTEL') },
          }, [h('span', { className: 'qf-bb-menu-icon warn' }, '◈'), ' ADV INTEL']),
          h('button', {
            className: 'btn qf-bb-menu',
            on: { click: () => EventBus.emit('OPEN_PAUSE_MENU') },
          }, [h('span', { className: 'qf-bb-menu-icon blood' }, '≡'), ' MENU']),
        ]),
      ]),
    ])

    // Initial: PLACE active, 1× speed active (will sync on first tick).
    this._setArmedMode('place')
    this._setActiveSpeed(1)
    return root
  }

  _onModeClick(mode) {
    if (mode === 'place') {
      // PLACE is a state indicator for "no tool armed", not an action.
      // Clicking it used to auto-disarm an active MOVE/SELL by re-emitting
      // the tool's toggle event, but that surprised players who hit PLACE
      // expecting it to confirm placement / interact with the dungeon —
      // they'd silently lose MOVE mode and think clicking on rooms had
      // stopped working. Disarm paths now: re-click MOVE / SELL, ESC,
      // right-click, BEGIN DAY.
      return
    }
    if (mode === 'move') EventBus.emit('TOOL_MOVE')
    if (mode === 'sell') EventBus.emit('TOOL_SELL')
  }

  _onSpeedClick(scale) {
    this._setActiveSpeed(scale)
    EventBus.emit('TIME_SCALE_SET', { scale })
  }

  _setArmedMode(mode) {
    // mode is one of 'place' | 'move' | 'sell'. 'place' means no Phaser
    // tool armed (default state).
    const active = mode || 'place'
    for (const k of ['place', 'move', 'sell']) {
      const el = this._refs[`mode_${k}`]
      if (!el) continue
      el.classList.toggle('active', k === active)
    }
  }

  _setActiveSpeed(scale) {
    this._currentSpeed = scale
    for (const s of SPEED_STEPS) {
      const el = this._refs[`speed_${s}`]
      if (!el) continue
      el.classList.toggle('active', s === scale)
    }
  }

  _wireEvents() {
    const sub = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    // NightPhase owns the armed-tool state — listen for its broadcast.
    sub('TOOL_MODE_CHANGED', ({ mode }) => {
      this._armedTool = mode || null
      this._setArmedMode(mode)
    })
    sub('TIME_SCALE_SET', ({ scale }) => {
      // Echo back to ourselves so speed-button highlight stays in sync if
      // some other surface (e.g. a keybind) changes the scale.
      if (scale != null) this._setActiveSpeed(scale)
    })
    // Reset speed to 1× whenever a day ends (mirrors ActionBar).
    sub('DAY_PHASE_ENDED',   () => this._setActiveSpeed(1))
    sub('NIGHT_PHASE_BEGAN', () => this._setActiveSpeed(1))
  }

  _tick() {
    const gs = this._gameState
    if (!gs) {
      this._tickHandle = requestAnimationFrame(() => this._tick())
      return
    }
    const phase = gs.meta?.phase ?? 'night'
    if (phase !== this._prev.phase) {
      const isNight = phase === 'night'
      this._refs.phaseStatus.textContent = isNight ? 'NIGHT · BUILD' : 'DAY · INVASION'
      this._refs.phaseStatus.classList.toggle('phase-night', isNight)
      this._refs.phaseStatus.classList.toggle('phase-day',   !isNight)
      this._refs.beginBtn.style.display = isNight ? '' : 'none'
      this._refs.speedBox.style.display = isNight ? 'none' : ''
      this._prev.phase = phase
    }
    this._tickHandle = requestAnimationFrame(() => this._tick())
  }

  destroy() {
    if (this._tickHandle) cancelAnimationFrame(this._tickHandle)
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this.el?.remove()
  }
}

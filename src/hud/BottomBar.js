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
//                 SPEED_STEPS = [1, 2, 4, 8]. From day HYPER_UNLOCK_DAY (30)
//                 onward the bar swaps to [1, 4, 8, 16] — 2× is dropped and
//                 16× takes its place in the rightmost slot. Buttons rebuild
//                 on DAY_PHASE_STARTED so the swap happens at the day-30
//                 transition without a reload.
//   ROSTER / KNOWLEDGE / ADV INTEL / MENU — emit the corresponding OPEN_*
//
// Subscribes to TOOL_MODE_CHANGED to keep the armed-tool highlight in sync
// regardless of which surface armed the tool. Phase + speed state is
// polled from gameState each frame; one-shot animation re-triggers (the
// BEGIN DAY pulse) live on phase events.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { Balance } from '../config/balance.js'
import { fallenRevivable, totalReviveCost } from '../util/minionRevive.js'
import { brokenTraps, totalTrapRebuildCost } from '../util/trapRebuild.js'

const SPEED_STEPS_EARLY = [1, 2, 4, 8]
const SPEED_STEPS_HYPER = [1, 4, 8, 16]

function _stepsForDay(day) {
  return day >= (Balance.HYPER_UNLOCK_DAY ?? 30) ? SPEED_STEPS_HYPER : SPEED_STEPS_EARLY
}

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
      { id: 'place',   label: 'PLACE',   icon: '➕' /* + */ },
      { id: 'move',    label: 'MOVE',    icon: '⤷' /* ⤷ */ },
      { id: 'upgrade', label: 'UPGRADE', icon: '⬆' /* tier up */ },
      { id: 'sell',    label: 'SELL',    icon: '␡' /* ⌫ */ },
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
            h('div', {
              className: 'qf-bb-speed-btns',
              ref: el => { this._refs.speedBtnsBox = el },
            }, this._renderSpeedBtns(_stepsForDay(this._gameState?.meta?.dayNumber ?? 1))),
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
          // Pay-to-revive — compact green action, grouped with roster/minion
          // controls. Shown only at night when revivable minions have fallen.
          h('button', {
            className: 'btn qf-bb-menu qf-bb-revive',
            ref: el => { this._refs.reviveBtn = el },
            style: { display: 'none' },
            on: { click: () => this._onReviveClick() },
          }, [
            h('span', { ref: el => { this._refs.reviveLabel = el } }, 'REVIVE'),
            h('span', { className: 'qf-bb-revive-cost' }, [
              h('span', { className: 'qf-bb-revive-coin' }),
              h('span', { className: 'qf-bb-revive-cost-num', ref: el => { this._refs.reviveCost = el } }, ''),
            ]),
          ]),
          // Rebuild broken traps — blue sibling of REVIVE. Shown only at night
          // when traps have broken (the 5% wear-and-tear). Reuses the revive
          // button's cost/coin/cant-afford styling via the shared classes.
          h('button', {
            className: 'btn qf-bb-menu qf-bb-revive qf-bb-rebuild',
            ref: el => { this._refs.rebuildBtn = el },
            style: { display: 'none' },
            on: { click: () => this._onRebuildClick() },
          }, [
            h('span', { ref: el => { this._refs.rebuildLabel = el } }, 'REBUILD'),
            h('span', { className: 'qf-bb-revive-cost' }, [
              h('span', { className: 'qf-bb-revive-coin' }),
              h('span', { className: 'qf-bb-revive-cost-num', ref: el => { this._refs.rebuildCost = el } }, ''),
            ]),
          ]),
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

    // Cache the step-set we mounted with so _rebuildSpeedBtns can detect
    // an actual change vs. a redundant day-start rebuild.
    this._renderedSteps = _stepsForDay(this._gameState?.meta?.dayNumber ?? 1)

    // Initial: PLACE active, 1× speed active (will sync on first tick).
    this._setArmedMode('place')
    this._setActiveSpeed(1)
    return root
  }

  _onModeClick(mode) {
    if (mode === 'place') {
      // Disarm whichever tool is armed by emitting its toggle event again.
      // NightPhase's _setToolMode treats same-mode click as cancel.
      if (this._armedTool === 'move')         EventBus.emit('TOOL_MOVE')
      else if (this._armedTool === 'sell')    EventBus.emit('TOOL_SELL')
      else if (this._armedTool === 'upgrade') EventBus.emit('TOOL_UPGRADE')
      // If nothing armed, PLACE is already the resting state — no-op.
      return
    }
    if (mode === 'move')    EventBus.emit('TOOL_MOVE')
    if (mode === 'sell')    EventBus.emit('TOOL_SELL')
    if (mode === 'upgrade') EventBus.emit('TOOL_UPGRADE')
  }

  _onSpeedClick(scale) {
    this._setActiveSpeed(scale)
    EventBus.emit('TIME_SCALE_SET', { scale })
  }

  // ── Pay-to-revive button ─────────────────────────────────────────
  _onReviveClick() {
    // Game.js re-checks affordability (and blocks with feedback if short),
    // so just fire the request — keeps gold logic in one place.
    EventBus.emit('REVIVE_FALLEN_REQUEST')
  }

  // Raw minionTypes array from the JSON cache, for revive-cost lookups.
  _allMinionDefs() {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const arr = s.cache?.json?.get?.('minionTypes')
      if (Array.isArray(arr)) return arr
    }
    return []
  }

  // Raw minionEvolutions chains from the JSON cache — lets totalReviveCost
  // price evolved/named forms (goldCost 0) off their chain root × tier mult
  // instead of treating them as free.
  _allEvolutionChains() {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const obj = s.cache?.json?.get?.('minionEvolutions')
      if (obj && typeof obj === 'object') return obj
    }
    return null
  }

  // Show the REVIVE button only at night when revivable minions have fallen;
  // update its count + cost, and dim it when the player can't afford it.
  _renderReviveBtn(gs) {
    const btn = this._refs.reviveBtn
    if (!btn) return
    const fallen = (gs?.meta?.phase === 'night') ? fallenRevivable(gs) : []
    if (fallen.length === 0) { btn.style.display = 'none'; return }
    const cost   = totalReviveCost(gs, this._allMinionDefs(), this._allEvolutionChains())
    const afford = (gs.player?.gold ?? 0) >= cost
    btn.style.display = ''
    btn.classList.toggle('cant-afford', !afford)
    if (this._refs.reviveLabel) this._refs.reviveLabel.textContent = `REVIVE ${fallen.length}`
    if (this._refs.reviveCost)  this._refs.reviveCost.textContent  = `${cost}`
  }

  // ── Rebuild-broken-traps button ──────────────────────────────────
  _onRebuildClick() {
    // Game.js re-checks affordability + locked-night before charging.
    EventBus.emit('REBUILD_TRAPS_REQUEST')
  }

  // Raw trapTypes array from the JSON cache, for rebuild-cost lookups.
  _allTrapDefs() {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const arr = s.cache?.json?.get?.('trapTypes')
      if (Array.isArray(arr)) return arr
    }
    return []
  }

  // Show the REBUILD button only at night when traps have broken; update its
  // count + total cost (half each trap's build cost), dim when unaffordable.
  _renderRebuildBtn(gs) {
    const btn = this._refs.rebuildBtn
    if (!btn) return
    const broken = (gs?.meta?.phase === 'night') ? brokenTraps(gs) : []
    if (broken.length === 0) { btn.style.display = 'none'; return }
    const cost   = totalTrapRebuildCost(gs, this._allTrapDefs())
    const afford = (gs.player?.gold ?? 0) >= cost
    btn.style.display = ''
    btn.classList.toggle('cant-afford', !afford)
    if (this._refs.rebuildLabel) this._refs.rebuildLabel.textContent = `REBUILD ${broken.length}`
    if (this._refs.rebuildCost)  this._refs.rebuildCost.textContent  = `${cost}`
  }

  // Build (or rebuild) the speed-button row to match the current day's
  // unlock tier. Returns the array of <button> elements; caller mounts.
  _renderSpeedBtns(steps) {
    // Drop stale refs for buttons that will no longer exist, so
    // _setActiveSpeed's `if (!el) continue` filter cleans up after a swap.
    for (const k of Object.keys(this._refs ?? {})) {
      if (k.startsWith('speed_')) this._refs[k] = null
    }
    return steps.map(s => h('button', {
      className: 'qf-bb-speed-btn',
      dataset: { speed: s },
      ref: el => { this._refs[`speed_${s}`] = el },
      on: { click: () => this._onSpeedClick(s) },
    }, `${s}×`))
  }

  // Rebuild speed buttons in-place when the day crosses HYPER_UNLOCK_DAY.
  // Idempotent — bails when the step set hasn't changed so we don't
  // thrash the DOM every day transition. Restores the active highlight
  // after the swap; if the previously-active scale is no longer a valid
  // step (e.g. was on 2× when 30 hit), drops it onto the nearest tier.
  _rebuildSpeedBtns() {
    const day = this._gameState?.meta?.dayNumber ?? 1
    const steps = _stepsForDay(day)
    const prevSteps = this._renderedSteps ?? []
    if (prevSteps.length === steps.length && prevSteps.every((s, i) => s === steps[i])) return
    const box = this._refs?.speedBtnsBox
    if (!box) return
    box.replaceChildren(...this._renderSpeedBtns(steps))
    this._renderedSteps = steps
    // Reapply highlight against the new set. If the prior scale is gone
    // (e.g. 2× post-unlock), snap to the nearest valid tier and notify so
    // DayPhase's _timeScale follows the UI.
    let active = this._currentSpeed
    if (!steps.includes(active)) {
      active = steps.reduce((best, s) => Math.abs(s - this._currentSpeed) < Math.abs(best - this._currentSpeed) ? s : best, steps[0])
      EventBus.emit('TIME_SCALE_SET', { scale: active })
    }
    this._setActiveSpeed(active)
  }

  _setArmedMode(mode) {
    // mode is one of 'place' | 'move' | 'upgrade' | 'sell'. 'place' means no
    // Phaser tool armed (default state).
    const active = mode || 'place'
    for (const k of ['place', 'move', 'upgrade', 'sell']) {
      const el = this._refs[`mode_${k}`]
      if (!el) continue
      el.classList.toggle('active', k === active)
    }
  }

  _setActiveSpeed(scale) {
    this._currentSpeed = scale
    // Iterate the union of both step sets so buttons that are CURRENTLY
    // mounted (and ones that aren't) all get correctly toggled — the
    // `if (!el)` guard handles members of the set that aren't rendered
    // right now.
    const allSteps = [...new Set([...SPEED_STEPS_EARLY, ...SPEED_STEPS_HYPER])]
    for (const s of allSteps) {
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
    // Rebuild the speed buttons at the start of each day so the day-30
    // 2× → 16× swap actually takes effect when the player crosses the
    // unlock day. _rebuildSpeedBtns is a no-op when the set hasn't
    // changed, so this is cheap to fire every day.
    sub('DAY_PHASE_STARTED', () => this._rebuildSpeedBtns())
    // Also catch the load path — when continuing a save into day 30+,
    // the initial _build ran before SaveSystem rehydrated the day count.
    // Re-check on Game.js's load-completed broadcast.
    sub('GAME_STATE_LOADED', () => this._rebuildSpeedBtns())
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
    // Pay-to-revive button — refresh on fallen-count / gold / phase change.
    const reviveSig = (phase === 'night')
      ? `${fallenRevivable(gs).length}:${gs.player?.gold ?? 0}`
      : 'off'
    if (reviveSig !== this._prevReviveSig) {
      this._prevReviveSig = reviveSig
      this._renderReviveBtn(gs)
    }
    // Rebuild-broken-traps button — refresh on broken-count / gold / phase.
    const rebuildSig = (phase === 'night')
      ? `${brokenTraps(gs).length}:${gs.player?.gold ?? 0}`
      : 'off'
    if (rebuildSig !== this._prevRebuildSig) {
      this._prevRebuildSig = rebuildSig
      this._renderRebuildBtn(gs)
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

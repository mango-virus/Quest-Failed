// BottomBar — DOM port of the design's bottom action console.
//
// Layout (one centered pixel-bevel console):
//   [PLACE] [MOVE] [UPGRADE] [SELL]  |  PHASE · BEGIN DAY (night) |  [ROSTER] [KNOWLEDGE] [ADV INTEL] [MENU]
//                          |  PHASE label · 1× 2× 4× 8× (day)   |
//
// Event contract is drop-in compatible with the Phaser ActionBar so the
// rest of the game (NightPhase / DayPhase / HudScene popups) needs zero
// changes:
//
//   PLACE     — disarms any active tool (emits the armed tool's toggle event)
//   MOVE      — emits TOOL_MOVE (NightPhase toggles 'move' mode)
//   UPGRADE   — emits TOOL_UPGRADE (NightPhase toggles 'upgrade' mode)
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
import { getBind, keyLabel, KEYBINDS_CHANGED } from './HudKeybinds.js'
import { fallenRevivable, totalReviveCost } from '../util/minionRevive.js'
import { brokenTraps, totalTrapRebuildCost } from '../util/trapRebuild.js'
import { hasActiveLibrary } from './wavePreview.js'

const SPEED_STEPS_EARLY = [1, 2, 4, 8]
const SPEED_STEPS_HYPER = [1, 4, 8, 16]

// Armed-tool accent — tints the console's top border + the armed button.
// place=blood, move=rumor, upgrade=info, sell=warn. Mirrors the design's ARMC
// map (hud-console.jsx); tokens resolve within the bar's `.hc` scope.
const ARMC = {
  place:   'var(--blood)',
  move:    'var(--rumor)',
  upgrade: 'var(--info)',
  sell:    'var(--warn)',
}

// Inline-SVG button icons, transcribed verbatim from the design's HC_ICONS
// (hud-console.jsx). Each uses currentColor so the `.hc-bi` colour drives it;
// the dark cut-out detail uses the design's ink, hoisted to one const so the
// icon art stays palette-lint clean.
const INK = '#0a0710' // hex-ok: design ink cut-out baked into the icon glyphs
const ICONS = {
  place:   '<svg class="hc-svg" viewBox="0 0 16 16"><path fill="currentColor" d="M7 2h2v5h5v2H9v5H7V9H2V7h5z"/></svg>',
  move:    '<svg class="hc-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l2.5 3h-5z"/><path d="M8 15l2.5-3h-5z"/><path d="M1 8l3-2.5v5z"/><path d="M15 8l-3-2.5v5z"/><rect x="6.6" y="6.6" width="2.8" height="2.8"/></svg>',
  upgrade: `<svg class="hc-svg" viewBox="0 0 16 16"><path fill="currentColor" d="M8 1.5l5.5 2v4c0 3.5-2.5 5.6-5.5 6.5-3-.9-5.5-3-5.5-6.5v-4z"/><path fill="${INK}" d="M8 5l3 3H9.2v3H6.8V8H5z"/></svg>`,
  sell:    `<svg class="hc-svg" viewBox="0 0 16 16"><path fill="currentColor" d="M5.5 2h5l-1 2.2C11.5 5.3 13 7.4 13 9.5A3.5 3.5 0 0 1 9.5 13h-3A3.5 3.5 0 0 1 3 9.5c0-2.1 1.5-4.2 3.5-5.3z"/><path stroke="${INK}" stroke-width="1.5" fill="none" d="M6.4 7.6l3.2 3.2M9.6 7.6l-3.2 3.2"/></svg>`,
  inspect: `<svg class="hc-svg" viewBox="0 0 16 16"><path fill="currentColor" d="M8 3.5c4 0 6.5 4.5 6.5 4.5S12 12.5 8 12.5 1.5 8 1.5 8 4 3.5 8 3.5z"/><circle cx="8" cy="8" r="2" fill="${INK}"/></svg>`,
  rally:   '<svg class="hc-svg" viewBox="0 0 16 16" fill="currentColor"><rect x="3.4" y="2" width="1.7" height="12"/><path d="M5.1 2.5h7l-1.6 2.2 1.6 2.2h-7z"/></svg>',
  begin:   '<svg class="hc-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5l9 5.5-9 5.5z"/></svg>',
  blocker: `<svg class="hc-svg" viewBox="0 0 16 16"><path fill="currentColor" d="M8 1.5l6.5 12h-13z"/><rect x="7.2" y="6" width="1.6" height="4" fill="${INK}"/><rect x="7.2" y="11" width="1.6" height="1.6" fill="${INK}"/></svg>`,
  quake:   '<svg class="hc-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 13l4-7 2.5 3.5L10.5 6l4 7z"/></svg>',
  revive:  '<svg class="hc-svg" viewBox="0 0 16 16" fill="currentColor"><path d="M8 14.5S1.5 10.5 1.5 5.8A3.3 3.3 0 0 1 8 4.5 3.3 3.3 0 0 1 14.5 5.8C14.5 10.5 8 14.5 8 14.5z"/></svg>',
  rebuild: '<svg class="hc-svg" viewBox="0 0 16 16"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5.6 5.6L12 12"/><path d="M10.4 5.6L4 12"/></g><circle cx="4.6" cy="4.6" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9.6" y="2.4" width="4" height="2.6" rx="0.5" fill="currentColor" transform="rotate(45 11.6 3.7)"/></svg>',
  roster:  `<svg class="hc-svg" viewBox="0 0 16 16"><path fill="currentColor" d="M3 2h10v12H3z"/><g fill="${INK}"><rect x="5" y="4.5" width="6" height="1.3"/><rect x="5" y="7.3" width="6" height="1.3"/><rect x="5" y="10.1" width="6" height="1.3"/></g></svg>`,
  map:     '<svg class="hc-svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="currentColor" d="M8 4l1.6 4L8 12 6.4 8z"/></svg>',
  intel:   `<svg class="hc-svg" viewBox="0 0 16 16"><path fill="currentColor" d="M8 3.5C6.2 2.3 3.8 2.3 2 3v9.5c1.8-.7 4.2-.7 6 .5 1.8-1.2 4.2-1.2 6-.5V3c-1.8-.7-4.2-.7-6 .5z"/><path stroke="${INK}" stroke-width="1" d="M8 3.8v9.7"/></svg>`,
  menu:    '<svg class="hc-svg" viewBox="0 0 16 16" fill="currentColor"><rect x="2.5" y="4" width="11" height="1.9"/><rect x="2.5" y="7.05" width="11" height="1.9"/><rect x="2.5" y="10.1" width="11" height="1.9"/></svg>',
}

// `.hc-bi` icon span — the SVG inherits the span's colour via currentColor.
function biSpan(name, colorClass) {
  const span = h('span', { className: 'hc-bi' + (colorClass ? ' ' + colorClass : '') })
  span.innerHTML = ICONS[name] || ''
  return span
}

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
    // Dungeon readiness for the BEGIN DAY blocker. Defaults ready; NightPhase
    // broadcasts DUNGEON_READINESS with a blocker label (e.g. 'PATH OPEN')
    // when a disconnected room island would stop the day from starting.
    this._ready   = true
    this._blocker = null
    // "New since you last looked" dot on the KNOWLEDGE + INTEL launchers.
    // _badgeBtns is filled by the launcher refs in _build(); _seen snapshots the
    // signal value when the panel is opened (null = init on first evaluation).
    this._badgeBtns = {}
    this._seen = { intel: null, knowledge: null }

    this.el = this._build()
    this._wireEvents()
    this._tickHandle = requestAnimationFrame(() => this._tick())
  }

  _build() {
    this._refs = {}
    // Build tools (armed radio group). PLACE carries data-build-anchor — the
    // Build tray will grow from it (design's fly-out pattern); for now it
    // toggles the construction drawer (see _onModeClick).
    const modes = [
      { id: 'place',   label: 'BUILD',   tip: 'Open the build menu — place rooms, minions & traps' },
      { id: 'move',    label: 'MOVE',    tip: 'Pick up & relocate a placed room or minion' },
      { id: 'upgrade', label: 'UPGRADE', tip: 'Upgrade a minion or room to its next tier' },
      { id: 'sell',    label: 'SELL',    tip: 'Sell a placed room, minion or trap back for gold' },
    ]
    // Launchers. ROSTER/MAP/INTEL carry data-tray-anchor for the future trays.
    const launchers = [
      { id: 'roster', label: 'ROSTER', color: 'poison', anchor: 'ROSTER', event: 'OPEN_MINION_ROSTER', tip: 'Review & manage your minion roster' },
      { id: 'map',    label: 'KNOWLEDGE', color: 'muted',  anchor: 'MAP',    event: 'OPEN_KNOWLEDGE_MAP', badge: 'knowledge', tip: 'Knowledge — the kingdom’s map intel + what they’ve learned about your minions' },
      { id: 'intel',  label: 'INTEL',  color: 'warn',   anchor: 'INTEL',  event: 'OPEN_ADV_INTEL', badge: 'intel', tip: 'Adventurer Intel — who’s coming & their weaknesses' },
      { id: 'menu',   label: 'MENU',   color: 'blood',  event: 'OPEN_PAUSE_MENU', tip: 'Pause — options, codex & quit' },
    ]

    const bar = h('div', { className: 'hc-bar hc', ref: el => { this._refs.console = el } }, [
      // 1. BUILD TOOLS
      h('div', { className: 'hc-sec' }, modes.map(m => h('button', {
        className: 'hc-btn hc-t-' + m.id,
        dataset: m.id === 'place' ? { buildAnchor: '' } : {},
        ref: el => { this._refs[`mode_${m.id}`] = el; this._registerTip(el, m.tip, m.id); if (m.id === 'upgrade') this._badgeBtns.upgrade = el },
        on: { click: () => this._onModeClick(m.id) },
      }, [ m.id === 'upgrade' ? h('span', { className: 'nu' }) : null, biSpan(m.id), m.label ].filter(Boolean)))),

      h('div', { className: 'hc-sep' }),

      // 2. BEGIN DAY (night) / SPEED (day) + boss day-active slot.
      h('div', { className: 'hc-sec' }, [
        h('button', {
          className: 'hc-btn hc-begin',
          ref: el => { this._refs.beginBtn = el },
          // Blocked (disconnected dungeon) → click is a no-op; the button itself
          // shows WHY (e.g. "⚠ PATH OPEN"). Readiness drives the label.
          on: { click: () => { if (this._ready) EventBus.emit('PHASE_TOGGLE_REQUEST') } },
        }, [ biSpan('begin'), 'BEGIN DAY' ]),
        h('div', {
          className: 'hc-spd',
          ref: el => { this._refs.speedBox = el },
          style: { display: 'none' },
        }, [
          h('span', { className: 'hc-spd-lbl' }, '⏵ SPEED'),
          h('div', {
            className: 'hc-spd-btns',
            ref: el => { this._refs.speedBtnsBox = el },
          }, this._renderSpeedBtns(_stepsForDay(this._gameState?.meta?.dayNumber ?? 1))),
        ]),
        // Boss day-active slot — BossArchetypeStrip mounts EARTHQUAKE / SACRIFICE
        // buttons here during day phase (kept as `.qf-bb-archetype-slot` so its
        // queries still resolve). Empty + collapsed by default.
        h('div', {
          className: 'qf-bb-archetype-slot',
          ref: el => { this._refs.archetypeSlot = el; this.archetypeSlot = el },
        }),
      ]),

      h('div', { className: 'hc-sep' }),

      // 3. GOLD ACTIONS — revive / rebuild (night-only; shown when needed).
      h('div', { className: 'hc-sec' }, [
        h('button', {
          className: 'hc-btn act-go',
          ref: el => { this._refs.reviveBtn = el },
          style: { display: 'none' },
          on: { click: () => this._onReviveClick() },
        }, [
          biSpan('revive'),
          h('span', { ref: el => { this._refs.reviveLabel = el } }, 'REVIVE'),
          h('span', { className: 'hc-cost' }, [ h('i'), h('span', { ref: el => { this._refs.reviveCost = el } }, '') ]),
        ]),
        h('button', {
          className: 'hc-btn act-blu',
          ref: el => { this._refs.rebuildBtn = el },
          style: { display: 'none' },
          on: { click: () => this._onRebuildClick() },
        }, [
          biSpan('rebuild'),
          h('span', { ref: el => { this._refs.rebuildLabel = el } }, 'REBUILD'),
          h('span', { className: 'hc-cost' }, [ h('i'), h('span', { ref: el => { this._refs.rebuildCost = el } }, '') ]),
        ]),
      ]),

      h('div', { className: 'hc-sep' }),

      // 4. LAUNCHERS — roster / map / intel / menu.
      h('div', { className: 'hc-sec' }, launchers.map(m => h('button', {
        className: 'hc-btn',
        dataset: m.anchor ? { trayAnchor: m.anchor } : {},
        ref: el => { this._registerTip(el, m.tip, m.id); if (m.badge) this._badgeBtns[m.badge] = el },
        on: { click: () => EventBus.emit(m.event) },
      }, [ m.badge ? h('span', { className: 'nu' }) : null, biSpan(m.id, m.color), m.label ].filter(Boolean)))),
    ])

    const root = h('div', { className: 'qf-bottombar' }, [ bar ])

    // Cache the step-set we mounted with so _rebuildSpeedBtns can detect
    // an actual change vs. a redundant day-start rebuild.
    this._renderedSteps = _stepsForDay(this._gameState?.meta?.dayNumber ?? 1)

    // Initial: PLACE armed, 1× speed active (will sync on first tick).
    this._setArmedMode('place')
    this._setActiveSpeed(1)
    return root
  }

  // ── Action-bar tooltips (P3-1) ────────────────────────────────────────
  // Each control gets a `data-tip` (CSS tooltip in styles.css) = a short
  // semantic description + its live keybind, so the bar is self-documenting
  // (discoverability) and doubles as a controls reference. The key is read
  // live from the rebindable store and refreshed on KEYBINDS_CHANGED.
  _registerTip(el, desc, bindId) {
    if (!el) return
    this._tipButtons = this._tipButtons || []
    this._tipButtons.push({ el, desc, bindId })
    this._applyTip(el, desc, bindId)
  }

  _applyTip(el, desc, bindId) {
    const key = bindId ? keyLabel(getBind(bindId)) : null
    el.dataset.tip = key ? `${desc}  ·  ${key}` : desc
  }

  _refreshTips() {
    for (const t of (this._tipButtons || [])) this._applyTip(t.el, t.desc, t.bindId)
  }

  _onModeClick(mode) {
    if (mode === 'place') {
      // Disarm whichever tool is armed by emitting its toggle event again.
      // NightPhase's _setToolMode treats same-mode click as cancel.
      if (this._armedTool === 'move')         EventBus.emit('TOOL_MOVE')
      else if (this._armedTool === 'sell')    EventBus.emit('TOOL_SELL')
      else if (this._armedTool === 'upgrade') EventBus.emit('TOOL_UPGRADE')
      // PLACE also toggles the construction drawer (crypt-console design) —
      // it IS the build affordance now that construction is a sliding drawer.
      EventBus.emit('TOGGLE_BUILD_DRAWER')
      return
    }
    if (mode === 'move')    EventBus.emit('TOOL_MOVE')
    if (mode === 'sell')    EventBus.emit('TOOL_SELL')
    if (mode === 'upgrade') { this._clearBadge('upgrade'); EventBus.emit('TOOL_UPGRADE') }
  }

  _onSpeedClick(scale) {
    this._setActiveSpeed(scale)
    EventBus.emit('TIME_SCALE_SET', { scale })
    this._flashSpeedCue(scale)
  }

  // Floating "{n}× SPEED" cue that rises above the speed selector on change.
  _flashSpeedCue(scale) {
    const box = this._refs.speedBox
    if (!box) return
    box.querySelector('.hc-spdcue')?.remove()
    const cue = h('span', { className: 'hc-spdcue' }, `${scale}× SPEED`)
    box.appendChild(cue)
    setTimeout(() => cue.remove(), 700)
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
    btn.classList.toggle('cant', !afford)
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
    btn.classList.toggle('cant', !afford)
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
      className: 'hc-spdb',
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
      el.classList.toggle('on', k === active)
    }
    // Tint the console's top border + the armed button in the armed tool's
    // accent (place=blood, move=rumor, upgrade=info, sell=warn).
    this._refs.console?.style.setProperty('--armc', ARMC[active] ?? ARMC.place)
  }

  // Repaint the BEGIN DAY button per current readiness. Blocked → warn-tinted
  // "⚠ <reason>" that doesn't act on click; ready → the pulsing primary.
  _applyReadiness() {
    const btn = this._refs.beginBtn
    if (!btn) return
    const blocked = !this._ready
    btn.classList.toggle('hc-blocked', blocked)
    btn.classList.toggle('hc-begin', !blocked)
    btn.setAttribute('aria-disabled', blocked ? 'true' : 'false')
    btn.title = blocked ? 'Resolve this before the day can begin' : ''
    btn.replaceChildren(
      biSpan(blocked ? 'blocker' : 'begin'),
      blocked ? (this._blocker || 'NOT READY') : 'BEGIN DAY',
    )
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
      el.classList.toggle('on', s === scale)
    }
  }

  // ── Launcher "new" badges (INTEL / KNOWLEDGE) ─────────────────────
  // INTEL signal = how many adventurer CLASSES the player currently has dossier
  // intel on (a Library + a kill of that class) — grows when a new class is
  // killed, or when a Library is built and reveals prior kills.
  _intelSignal() {
    const gs = this._gameState
    return hasActiveLibrary(gs) ? (gs?.run?.classesKilled?.length ?? 0) : 0
  }

  // KNOWLEDGE signal = total distinct things the kingdom has learned about the
  // dungeon (leaked rooms / traps / treasure / items + studied minion types) —
  // grows whenever an adventurer escapes with new intel.
  _knowledgeSignal() {
    const k = this._gameState?.knowledge?.sharedPool ?? {}
    let n = 0
    for (const key of ['rooms', 'traps', 'treasureChests', 'keyChests', 'items', 'mimics', 'enemiesPerRoom', 'bestiary']) {
      n += Object.keys(k[key] ?? {}).length
    }
    return n
  }

  // Show a dot when the current signal exceeds what the player last saw. First
  // evaluation snapshots the baseline (so existing intel doesn't flag as new).
  _updateBadges() {
    if (this._seen.intel == null)     this._seen.intel = this._intelSignal()
    if (this._seen.knowledge == null) this._seen.knowledge = this._knowledgeSignal()
    this._setBadge('intel',     this._intelSignal()     > this._seen.intel)
    this._setBadge('knowledge', this._knowledgeSignal() > this._seen.knowledge)
  }

  _setBadge(key, on) { this._badgeBtns?.[key]?.classList.toggle('has-nu', !!on) }

  // Opening a panel = the player has now seen its current state → clear the dot.
  _clearBadge(key) {
    this._seen[key] = key === 'intel' ? this._intelSignal() : this._knowledgeSignal()
    this._setBadge(key, false)
  }

  // Coalesce many same-frame gains (a wave kills several adventurers) into one
  // re-evaluation, run AFTER the systems that mutate the signal state this frame.
  _scheduleBadgeUpdate() {
    if (this._badgeScheduled) return
    this._badgeScheduled = true
    requestAnimationFrame(() => { this._badgeScheduled = false; this._updateBadges() })
  }

  _wireEvents() {
    const sub = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    // Launcher "new" dots: re-evaluate when intel/knowledge could have grown,
    // and clear when the player opens the matching panel.
    sub('ADVENTURER_DIED', () => this._scheduleBadgeUpdate())   // class intel
    sub('INTEL_LEAKED',    () => this._scheduleBadgeUpdate())   // dungeon knowledge
    sub('ROOM_PLACED',     () => this._scheduleBadgeUpdate())   // a Library reveals prior kills
    sub('ROOM_REMOVED',    () => this._scheduleBadgeUpdate())
    sub('OPEN_ADV_INTEL',     () => this._clearBadge('intel'))
    sub('OPEN_KNOWLEDGE_MAP', () => this._clearBadge('knowledge'))
    // Minion tier-unlock dot on the UPGRADE tool — lights when a family's next
    // tier comes due, clears once the player arms the upgrade tool.
    sub('MINION_TIER_UNLOCKED', () => this._setBadge('upgrade', true))
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
    // Dungeon readiness → BEGIN DAY blocker. NightPhase recomputes on every
    // room add/remove + at night entry.
    sub('DUNGEON_READINESS', ({ ready, blocker }) => {
      this._ready   = ready !== false
      this._blocker = this._ready ? null : (blocker || 'NOT READY')
      this._applyReadiness()
    })
    // Also catch the load path — when continuing a save into day 30+,
    // the initial _build ran before SaveSystem rehydrated the day count.
    // Re-check on Game.js's load-completed broadcast.
    sub('GAME_STATE_LOADED', () => {
      this._rebuildSpeedBtns()
      // Re-baseline the badges to the loaded state (don't flag pre-existing intel).
      this._seen.intel = null; this._seen.knowledge = null
      this._updateBadges()
    })
    // Keep the tooltips' keybind hints in sync when the player rebinds (P1-3).
    sub(KEYBINDS_CHANGED, () => this._refreshTips())
    // Snapshot the badge baseline now (so the next gain reads as "new").
    this._updateBadges()
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
      this._refs.beginBtn.style.display = isNight ? '' : 'none'
      this._refs.speedBox.style.display = isNight ? 'none' : ''
      if (isNight) this._applyReadiness()   // reflect current blocker on the begin button
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

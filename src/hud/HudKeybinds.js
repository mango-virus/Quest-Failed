// HudKeybinds — central keyboard shortcuts for the DOM HUD action bar +
// the rebindable-controls store (UI_POLISH_PLAN P1-1 / P1-3).
//
// Two parts:
//   1. A small bind STORE (KEYBIND_DEFAULTS + getBind/setBind/resetBinds over
//      localStorage) shared by the Settings CONTROLS panel and the input
//      handlers. SettingsOverlay edits it; HudKeybinds + NightPhase read it.
//   2. The HudKeybinds class — a window-level keydown router that emits the
//      EXACT EventBus events the BottomBar buttons fire (no gameplay logic).
//
// Phase-guarding avoids double-firing against the Phaser scenes that still
// own a key: build tools + begin-day are night-only, speed slots day-only,
// map/intel both. The contextual roster/rotate key is owned by NightPhase at
// night (rotate a held piece, else open the roster); HudKeybinds opens the
// roster on that key in day. Esc stays a permanent universal close/cancel/
// pause key (wired into every overlay + the scenes) — it is never routed
// here; the PAUSE row only rebinds an ADDITIONAL pause key.
//
// Suppressed while a text input is focused, a modifier is held, on key
// repeat, when not in the night/day HUD, or when any .overlay modal is open.

import { EventBus } from '../systems/EventBus.js'
import { Balance } from '../config/balance.js'

const SPEED_STEPS_EARLY = [1, 2, 4, 8]
const SPEED_STEPS_HYPER = [1, 4, 8, 16]

const STORE_KEY = 'qf.controls.binds'
// Emitted whenever the bound keys change so live input handlers re-read.
export const KEYBINDS_CHANGED = 'KEYBINDS_CHANGED'

// Canonical default keymap + the single source for the Settings CONTROLS
// panel. `defaultKey` is the normalized match form (lowercased letter, digit
// char, ' ' for space, 'escape'). GAME SPEED is four slot ids (each maps to
// the Nth on-screen speed button). ROSTER + ROTATE are one contextual id.
export const KEYBIND_DEFAULTS = [
  { id: 'place',   action: 'PLACE / BUILD',        defaultKey: 'b',      phase: 'night' },
  { id: 'move',    action: 'MOVE',                 defaultKey: 'm',      phase: 'night' },
  { id: 'upgrade', action: 'UPGRADE',              defaultKey: 'u',      phase: 'night' },
  { id: 'sell',    action: 'SELL',                 defaultKey: 'x',      phase: 'night' },
  { id: 'begin',   action: 'BEGIN DAY',            defaultKey: ' ',      phase: 'night' },
  { id: 'speed1',  action: 'GAME SPEED 1',         defaultKey: '1',      phase: 'day'   },
  { id: 'speed2',  action: 'GAME SPEED 2',         defaultKey: '2',      phase: 'day'   },
  { id: 'speed3',  action: 'GAME SPEED 3',         defaultKey: '3',      phase: 'day'   },
  { id: 'speed4',  action: 'GAME SPEED 4',         defaultKey: '4',      phase: 'day'   },
  { id: 'map',     action: 'KNOWLEDGE MAP',        defaultKey: 'k',      phase: 'both'  },
  { id: 'intel',   action: 'ADVENTURER INTEL',     defaultKey: 'i',      phase: 'both'  },
  { id: 'roster',  action: 'MINION ROSTER / ROTATE', defaultKey: 'r',    phase: 'both'  },
  { id: 'pause',   action: 'PAUSE',                defaultKey: 'escape', phase: 'both'  },
]

// Keys that can never be bound: camera pan (WASD) + Esc (the universal
// close/cancel/pause). The capture UI also rejects modifiers / Tab / Enter /
// arrows separately.
export const RESERVED_KEYS = new Set(['w', 'a', 's', 'd'])

const _defaultMap = () => {
  const m = {}
  for (const d of KEYBIND_DEFAULTS) m[d.id] = d.defaultKey
  return m
}

function _overrides() {
  try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : {} }
  catch { return {} }
}

function _writeOverrides(o) {
  try {
    if (o && Object.keys(o).length) localStorage.setItem(STORE_KEY, JSON.stringify(o))
    else localStorage.removeItem(STORE_KEY)
  } catch {}
  EventBus.emit(KEYBINDS_CHANGED)
}

/** The live merged map of every binding: { id: key }. */
export function getAllBinds() { return { ..._defaultMap(), ..._overrides() } }

/** The current key bound to an action id. */
export function getBind(id) {
  const o = _overrides()
  return (id in o) ? o[id] : _defaultMap()[id]
}

/** Override one binding and persist. */
export function setBind(id, key) {
  const o = _overrides()
  o[id] = key
  _writeOverrides(o)
}

/** Clear one override back to its default. */
export function resetBind(id) {
  const o = _overrides()
  delete o[id]
  _writeOverrides(o)
}

/** Clear all overrides — every binding back to default. */
export function resetBinds() { _writeOverrides({}) }

/** True if `key` may not be assigned to any action. */
export function isReserved(key) { return RESERVED_KEYS.has(key) || key === 'escape' }

/** The action id already using `key` (other than `exceptId`), or null. */
export function findConflict(key, exceptId) {
  const all = getAllBinds()
  for (const [id, k] of Object.entries(all)) {
    if (id !== exceptId && k === key) return id
  }
  return null
}

/** Human label for a normalized key. */
export function keyLabel(key) {
  if (!key) return '—'
  if (key === ' ') return 'SPACE'
  if (key === 'escape') return 'ESC'
  return key.toUpperCase()
}

export class HudKeybinds {
  constructor(gameState) {
    this._gameState = gameState
    // Track the armed build tool so PLACE can disarm it (mirrors BottomBar).
    this._armedTool = null
    this._onToolMode = ({ mode }) => { this._armedTool = mode || null }
    EventBus.on('TOOL_MODE_CHANGED', this._onToolMode)
    // Rebuild the key→action map whenever the bindings change.
    this._onBindsChanged = () => this._rebuild()
    EventBus.on(KEYBINDS_CHANGED, this._onBindsChanged)
    this._rebuild()
    this._onKey = (e) => this._handle(e)
    window.addEventListener('keydown', this._onKey)
  }

  // key (lowercased) → action id, from the live binds. Esc is never routed
  // here (it's the universal cancel/close/pause), so any binding sitting on
  // 'escape' (the PAUSE default) is skipped — the scenes/overlays own it.
  _rebuild() {
    this._keyToAction = {}
    for (const def of KEYBIND_DEFAULTS) {
      const key = getBind(def.id)
      if (!key || key === 'escape') continue
      this._keyToAction[key] = def.id
    }
  }

  _phase() { return this._gameState?.meta?.phase ?? null }

  // The 4 speed slots for the current day (mirrors BottomBar / Balance).
  _speedSteps() {
    const day = this._gameState?.meta?.dayNumber ?? 1
    return day >= (Balance.HYPER_UNLOCK_DAY ?? 30) ? SPEED_STEPS_HYPER : SPEED_STEPS_EARLY
  }

  _handle(e) {
    // Don't hijack typing (rename / name-entry fields) or browser/OS chords.
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.repeat) return
    const phase = this._phase()
    if (phase !== 'night' && phase !== 'day') return
    // A modal overlay is open → the player is in a menu; leave the keys to it.
    if (document.querySelector('#hud-stage .overlay')) return

    const k = (e.key || '').toLowerCase()
    const action = this._keyToAction[k]
    if (!action) return
    const pd = () => e.preventDefault()

    switch (action) {
      // ── Night-only: build tools + begin day ──
      case 'place':   if (phase === 'night') { this._place();                       pd() } return
      case 'move':    if (phase === 'night') { EventBus.emit('TOOL_MOVE');           pd() } return
      case 'upgrade': if (phase === 'night') { EventBus.emit('TOOL_UPGRADE');        pd() } return
      case 'sell':    if (phase === 'night') { EventBus.emit('TOOL_SELL');           pd() } return
      case 'begin':   if (phase === 'night') { EventBus.emit('PHASE_TOGGLE_REQUEST'); pd() } return
      // ── Day-only: the four on-screen speed buttons ──
      case 'speed1': case 'speed2': case 'speed3': case 'speed4': {
        if (phase !== 'day') return
        const scale = this._speedSteps()[Number(action.slice(5)) - 1]
        if (scale != null) { EventBus.emit('TIME_SCALE_SET', { scale }); pd() }
        return
      }
      // ── Both phases: info panels ──
      case 'map':   EventBus.emit('OPEN_KNOWLEDGE_MAP'); pd(); return
      case 'intel': EventBus.emit('OPEN_ADV_INTEL');     pd(); return
      // Roster: at night NightPhase owns the key (rotate a held piece, else
      // open the roster — contextual). In day, just open the roster.
      case 'roster': if (phase === 'day') { EventBus.emit('OPEN_MINION_ROSTER'); pd() } return
      // Pause: only reached when rebound to a NON-Esc key (Esc is excluded
      // from the map). Opens the pause menu; Esc still works via the scenes.
      case 'pause': EventBus.emit('OPEN_PAUSE_MENU'); pd(); return
    }
  }

  // Mirror BottomBar._onModeClick('place'): disarm whatever tool is armed
  // (NightPhase treats a repeat of the armed tool's event as cancel), then
  // toggle the construction drawer.
  _place() {
    if (this._armedTool === 'move')         EventBus.emit('TOOL_MOVE')
    else if (this._armedTool === 'sell')    EventBus.emit('TOOL_SELL')
    else if (this._armedTool === 'upgrade') EventBus.emit('TOOL_UPGRADE')
    EventBus.emit('TOGGLE_BUILD_DRAWER')
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey)
    EventBus.off('TOOL_MODE_CHANGED', this._onToolMode)
    EventBus.off(KEYBINDS_CHANGED, this._onBindsChanged)
  }
}

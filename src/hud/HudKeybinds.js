// HudKeybinds — central keyboard shortcuts for the DOM HUD action bar.
//
// Owned by HudRoot (one per game lifetime). Attaches a single window-level
// keydown listener and emits the EXACT EventBus events the BottomBar buttons
// already fire — no gameplay logic lives here, it's a thin key→event router
// so the action bar isn't mouse-only (UI_POLISH_PLAN P1-1).
//
// Phase-guarding avoids double-firing against the Phaser scenes that still
// own a few keys:
//   • Night build tools (B/M/U/X) + BEGIN DAY (Space) — night only.
//   • Game speed (1-4) — day only; DayPhase's own digit keys were removed
//     with P1-1, so these are the sole speed bindings. Space stays = pause
//     in day (DayPhase owns keydown-SPACE there).
//   • R (roster) — day only here; at NIGHT, NightPhase owns R and makes it
//     contextual (rotate a held room/trap, else open the roster).
//   • K / I (map / intel) — both phases.
//
// Suppressed while a text input is focused, a modifier is held, on key
// repeat, when not in the night/day HUD, or when any .overlay modal is open
// (the player is in a menu — let it keep the keys).

import { EventBus } from '../systems/EventBus.js'
import { Balance } from '../config/balance.js'

const SPEED_STEPS_EARLY = [1, 2, 4, 8]
const SPEED_STEPS_HYPER = [1, 4, 8, 16]

// Canonical default keymap — also drives the Settings CONTROLS panel (single
// source of truth; feeds the future rebinding UI, P1-3). `keys` are display
// labels; the handler matches on the lowercased `event.key` / digit.
export const KEYBIND_DEFAULTS = [
  { id: 'place',   action: 'PLACE / BUILD',    keys: ['B'],            phase: 'night' },
  { id: 'move',    action: 'MOVE',             keys: ['M'],            phase: 'night' },
  { id: 'upgrade', action: 'UPGRADE',          keys: ['U'],            phase: 'night' },
  { id: 'sell',    action: 'SELL',             keys: ['X'],            phase: 'night' },
  { id: 'begin',   action: 'BEGIN DAY',        keys: ['SPACE'],        phase: 'night' },
  { id: 'speed',   action: 'GAME SPEED',       keys: ['1', '2', '3', '4'], phase: 'day' },
  { id: 'map',     action: 'KNOWLEDGE MAP',    keys: ['K'],            phase: 'both' },
  { id: 'intel',   action: 'ADVENTURER INTEL', keys: ['I'],            phase: 'both' },
  { id: 'roster',  action: 'MINION ROSTER',    keys: ['R'],            phase: 'both' },
  { id: 'rotate',  action: 'ROTATE PIECE',     keys: ['R'],            phase: 'night' },
  { id: 'pause',   action: 'PAUSE',            keys: ['ESC'],          phase: 'both' },
]

export class HudKeybinds {
  constructor(gameState) {
    this._gameState = gameState
    // Track the armed build tool so PLACE can disarm it (mirrors BottomBar).
    this._armedTool = null
    this._onToolMode = ({ mode }) => { this._armedTool = mode || null }
    EventBus.on('TOOL_MODE_CHANGED', this._onToolMode)
    this._onKey = (e) => this._handle(e)
    window.addEventListener('keydown', this._onKey)
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

    // ── Game speed (day): digits 1-4 → the four on-screen speed buttons ──
    if (phase === 'day' && k.length === 1 && k >= '1' && k <= '4') {
      const scale = this._speedSteps()[Number(k) - 1]
      if (scale != null) { EventBus.emit('TIME_SCALE_SET', { scale }); e.preventDefault() }
      return
    }

    // ── Menus / panels (both phases) ──
    if (k === 'k') { EventBus.emit('OPEN_KNOWLEDGE_MAP'); e.preventDefault(); return }
    if (k === 'i') { EventBus.emit('OPEN_ADV_INTEL');     e.preventDefault(); return }
    // R → roster, but only in DAY here. At night NightPhase owns R (rotate a
    // held piece, else open the roster) so it stays contextual without a
    // double-fire.
    if (k === 'r' && phase === 'day') { EventBus.emit('OPEN_MINION_ROSTER'); e.preventDefault(); return }

    // ── Night-only: build tools + begin day ──
    if (phase !== 'night') return
    if (k === 'm') { EventBus.emit('TOOL_MOVE');    e.preventDefault(); return }
    if (k === 'u') { EventBus.emit('TOOL_UPGRADE'); e.preventDefault(); return }
    if (k === 'x') { EventBus.emit('TOOL_SELL');    e.preventDefault(); return }
    if (k === 'b') { this._place();                 e.preventDefault(); return }
    if (k === ' ' || e.code === 'Space') {
      // _beginDay() is the authoritative readiness gate (refuses + toasts when
      // the dungeon is blocked), so emit unconditionally and let it decide.
      EventBus.emit('PHASE_TOGGLE_REQUEST'); e.preventDefault(); return
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
  }
}

// Debug overlay state — small persisted toggle store for designer-facing
// visualisations that the player can hide.
//
//   showCollision  — paint blocking/walkable tinting over the dungeon grid
//   showDoors      — connection-point dots on each room's wall
//
// Stored in localStorage under qf.debugOverlay so toggles survive reloads.
// Listeners (DungeonRenderer + HUD) call subscribe() to redraw when state
// changes; keypress handlers in Game / NightPhase call toggle().

import { EventBus } from './EventBus.js'

const LS_KEY = 'qf.debugOverlay'
const DEFAULTS = { showCollision: false, showDoors: true }

let _state = { ...DEFAULTS }

try {
  const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_KEY) : null
  if (raw) {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') _state = { ..._state, ...parsed }
  }
} catch { /* fall back to defaults */ }

function _persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_state)) } catch {}
}

export const DebugOverlay = {
  get showCollision() { return _state.showCollision },
  get showDoors()     { return _state.showDoors },

  set(key, value) {
    if (!(key in DEFAULTS)) return
    _state[key] = !!value
    _persist()
    EventBus.emit('DEBUG_OVERLAY_CHANGED', { ..._state })
  },

  toggle(key) {
    if (!(key in DEFAULTS)) return
    _state[key] = !_state[key]
    _persist()
    EventBus.emit('DEBUG_OVERLAY_CHANGED', { ..._state })
    return _state[key]
  },

  snapshot() { return { ..._state } },
}

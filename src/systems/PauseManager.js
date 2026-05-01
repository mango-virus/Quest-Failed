// Central pause coordination. Tracks the global isPaused flag, suspends all
// gameplay scenes when the pause menu opens, and resumes them on close.
//
// Other systems can read PauseManager.isPaused if they need to know whether
// the world is frozen — but most don't need to: Phaser's scene.pause()
// already halts update / tweens / timers / input on every scene we pause.

import { SaveSystem } from './SaveSystem.js'

// Scenes that should freeze when the pause menu opens. Only the ones that
// are actually active at the moment of pause are suspended; we remember
// which we paused so resume() touches only those (won't accidentally wake
// scenes that were already inactive).
const GAMEPLAY_SCENES = [
  'Game', 'NightPhase', 'DayPhase', 'EndOfDay',
  'Graveyard', 'KnowledgeScreen', 'HudScene',
]

let _isPaused   = false
let _pausedKeys = []
let _lastToggle = 0
const TOGGLE_DEBOUNCE_MS = 150

function _sm() {
  return window.__game?.scene ?? null
}

export const PauseManager = {
  get isPaused() { return _isPaused },

  // Toggle the pause menu. Wired to ESC in every gameplay scene.
  // Debounced because multiple scenes (e.g. Game + NightPhase + HudScene)
  // run in parallel and would otherwise each fire ESC, double-toggling.
  toggle(callerScene) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    if (now - _lastToggle < TOGGLE_DEBOUNCE_MS) return
    _lastToggle = now
    if (_isPaused) this.close()
    else           this.open(callerScene)
  },

  open(/* callerScene */) {
    if (_isPaused) return
    const sm = _sm()
    if (!sm) return
    _pausedKeys = []
    for (const key of GAMEPLAY_SCENES) {
      if (sm.isActive(key)) {
        sm.pause(key)
        _pausedKeys.push(key)
      }
    }
    _isPaused = true
    const gameState = sm.getScene('Game')?.gameState ?? null
    sm.run('PauseMenu', { gameState })
  },

  close() {
    if (!_isPaused) return
    const sm = _sm()
    if (!sm) return
    sm.stop('PauseMenu')
    for (const key of _pausedKeys) {
      if (sm.isPaused(key)) sm.resume(key)
    }
    _pausedKeys = []
    _isPaused = false
    // Refresh the debounce timestamp so a key that's still held down
    // when we resume doesn't immediately re-open the menu via the now-
    // active gameplay scene's ESC listener.
    _lastToggle = (typeof performance !== 'undefined' ? performance.now() : Date.now())
  },

  // "Save & Exit" — write to localStorage and tear down all gameplay scenes
  // before booting back to the main menu. Skips the resume step since
  // we're stopping the scenes outright.
  saveAndExitToMenu(gameState) {
    const sm = _sm()
    if (!sm) return
    if (gameState) SaveSystem.save(gameState)
    sm.stop('PauseMenu')
    for (const key of GAMEPLAY_SCENES) {
      if (sm.isActive(key) || sm.isPaused(key)) sm.stop(key)
    }
    _pausedKeys = []
    _isPaused   = false
    sm.start('MainMenu')
  },
}

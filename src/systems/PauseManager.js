// Central pause coordination. Tracks the global isPaused flag, suspends all
// gameplay scenes when the pause menu opens, and resumes them on close.
//
// Other systems can read PauseManager.isPaused if they need to know whether
// the world is frozen — but most don't need to: Phaser's scene.pause()
// already halts update / tweens / timers / input on every scene we pause.

import { SaveSystem } from './SaveSystem.js'
import { EventBus } from './EventBus.js'
import { Leaderboard } from './Leaderboard.js'
import { PlayerProfile } from './PlayerProfile.js'

// Scenes that should freeze when the pause menu opens. Only the ones that
// are actually active at the moment of pause are suspended; we remember
// which we paused so resume() touches only those (won't accidentally wake
// scenes that were already inactive).
const GAMEPLAY_SCENES = [
  'Game', 'NightPhase', 'DayPhase', 'EndOfDay', 'HudScene',
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
    // The DOM HUD owns the pause UI (src/hud/PauseOverlay.js), which
    // subscribes to PAUSE_STATE_CHANGED to mount/unmount itself.
    EventBus.emit('PAUSE_STATE_CHANGED', { isPaused: true })
  },

  close() {
    if (!_isPaused) return
    const sm = _sm()
    if (!sm) return
    for (const key of _pausedKeys) {
      if (sm.isPaused(key)) sm.resume(key)
    }
    _pausedKeys = []
    _isPaused = false
    // Refresh the debounce timestamp so a key that's still held down
    // when we resume doesn't immediately re-open the menu via the now-
    // active gameplay scene's ESC listener.
    _lastToggle = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    EventBus.emit('PAUSE_STATE_CHANGED', { isPaused: false })
  },

  // ── Soft pause: freeze gameplay scenes without showing pause UI ───
  // Used by transient modal popups (tutorial hints, etc.) that need
  // the world to stop while the player reads. Independent from the
  // full pause menu — `isPaused` stays false so PauseOverlay doesn't
  // mount, no PAUSE_STATE_CHANGED is emitted, and ESC still routes
  // to the actual pause menu rather than dismissing the modal.
  // Counted so multiple modals stack cleanly: 2 opens + 2 closes
  // resumes the game; opening and closing within the same lock leaves
  // the world running normally.
  _softLocks: 0,
  _softPausedKeys: [],

  softPause() {
    this._softLocks += 1
    if (this._softLocks > 1) return  // already frozen by an outer modal
    const sm = _sm()
    if (!sm) return
    this._softPausedKeys = []
    for (const key of GAMEPLAY_SCENES) {
      // EndOfDay is the transition scene that drives the day→night
      // hand-off (PostWaveSummary → DarkPact → BOSS_LEVEL_UP → NightPhase
      // scene.start). Pausing it via softPause caused stuck "dark window"
      // states when a tutorial fired during the transition: EndOfDay's
      // delayedCalls froze, the night phase never booted, and the Game
      // scene's camera stayed faded out from _onPhaseFadeOut. Tutorials
      // that gate on SHOW_POST_WAVE_SUMMARY (e.g. firstEndOfDay) still
      // pause the Game world correctly via the other scenes — EndOfDay
      // is the lone exception that must keep ticking.
      if (key === 'EndOfDay') continue
      if (sm.isActive(key)) {
        sm.pause(key)
        this._softPausedKeys.push(key)
      }
    }
  },

  softResume() {
    if (this._softLocks <= 0) return
    this._softLocks -= 1
    if (this._softLocks > 0) return  // an outer modal still holds the lock
    const sm = _sm()
    if (!sm) { this._softPausedKeys = []; return }
    for (const key of this._softPausedKeys) {
      if (sm.isPaused(key)) sm.resume(key)
    }
    this._softPausedKeys = []
  },

  // "Save & Exit" — write to localStorage and tear down all gameplay scenes
  // before booting back to the main menu. Skips the resume step since
  // we're stopping the scenes outright. Used by the new QUIT TO MAIN MENU
  // option (saves so the player can CONTINUE on next launch).
  //
  // CRITICAL: if the save fails (quota / storage error), we BLOCK the
  // teardown with a confirmation modal. The player gets to decide
  // whether to lose progress and quit anyway, or stay so they can
  // free space / abandon / play to a death. Previously a failed save
  // would silently roll back to whatever older save was on disk —
  // the day-38 "rewind from day 42" bug.
  saveAndExitToMenu(gameState) {
    const sm = _sm()
    if (!sm) return
    const proceed = () => {
      for (const key of GAMEPLAY_SCENES) {
        if (sm.isActive(key) || sm.isPaused(key)) sm.stop(key)
      }
      _pausedKeys = []
      _isPaused   = false
      sm.start('MainMenu')
    }
    if (!gameState) { proceed(); return }
    const ok = SaveSystem.save(gameState)
    if (ok) { proceed(); return }
    // Save failed — show a blocking confirm so the player can't quit
    // unknowingly. Using SHOW_CONFIRM (the same EventBus channel
    // PauseOverlay's ABANDON dialog uses) so it lands in the existing
    // DOM ConfirmPopup with consistent styling.
    EventBus.emit('SHOW_CONFIRM', {
      title:        'SAVE FAILED',
      message:      'If you quit now, the most recent saved state will load on Continue — you will rewind to whichever day last saved successfully. Quit anyway?',
      confirmLabel: 'QUIT ANYWAY',
      cancelLabel:  'STAY',
      theme:        'crimson',
      onConfirm: () => proceed(),
    })
  },

  // "Abandon Run" — POST the run to the leaderboard (so the player's
  // effort is recorded), then DELETE the save and tear down all gameplay
  // scenes. The player is committing to starting over; CONTINUE shouldn't
  // bring them back to this run. Mirrors saveAndExitToMenu's
  // scene-teardown sequence but calls deleteSave() instead of save() and
  // submits to the leaderboard first.
  abandonAndExitToMenu(gameState) {
    const sm = _sm()
    if (!sm) return
    if (gameState) this._submitAbandonedRun(gameState)
    try { SaveSystem.deleteSave?.() } catch {}
    try { SaveSystem.clear?.()      } catch {}
    for (const key of GAMEPLAY_SCENES) {
      if (sm.isActive(key) || sm.isPaused(key)) sm.stop(key)
    }
    _pausedKeys = []
    _isPaused   = false
    sm.start('MainMenu')
  },

  // POST the player's current run as `end_cause: 'abandoned'`. Shared
  // helper on Leaderboard handles the payload build, noise gate, and
  // pact-name resolution — kept centralised so MainMenu's
  // "ABANDON CURRENT RUN" confirm uses the exact same submission path.
  _submitAbandonedRun(gameState) {
    // Cache the runId for MainMenuOverlay's top-3 check — even an
    // abandoned run still gets celebrated if it placed in the top 3.
    const runId = gameState?.meta?.runId
    const playerName = PlayerProfile.getName?.()
    if (runId && playerName) {
      PlayerProfile.setLastFinishedRunId?.(playerName, runId)
    }
    Leaderboard.submitAbandonedRun(gameState).catch(() => null)
  },
}

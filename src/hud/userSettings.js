// userSettings — small read-side helper for the new SettingsOverlay's
// localStorage-backed flags. Gameplay code that wants to honor a
// setting reads from here instead of localStorage directly so the keys
// stay in one place.
//
// The Settings UI lives in src/hud/SettingsOverlay.js and writes the
// same keys; defaults match its DEFAULTS object.

const KEY = {
  scanlines:       'qf.video.scanlines',
  vignette:        'qf.video.vignette',
  dungeonVignette: 'qf.video.dungeonVignette',
  shake:           'qf.video.shake',
  particles:       'qf.video.particles',
  hotkeys:         'qf.gameplay.hotkeys',
  confirmRun:      'qf.gameplay.confirmRun',
  autosave:        'qf.gameplay.autosave',
  tutorials:       'qf.gameplay.tutorials',
}

const DEFAULT_BOOL = {
  scanlines:       true,
  vignette:        true,
  dungeonVignette: true,
  shake:           true,
  hotkeys:         true,
  confirmRun:      true,
  autosave:        true,
  tutorials:       true,
}

function _readBool(key) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return null
    return raw === 'true'
  } catch { return null }
}

export const userSettings = {
  isShakeEnabled() {
    return _readBool(KEY.shake) ?? DEFAULT_BOOL.shake
  },
  isScanlinesEnabled() {
    return _readBool(KEY.scanlines) ?? DEFAULT_BOOL.scanlines
  },
  isVignetteEnabled() {
    return _readBool(KEY.vignette) ?? DEFAULT_BOOL.vignette
  },
  // Dungeon-viewport vignette — darkens the corners of the gameplay
  // play area only (not the HUD chrome). Independent from the
  // window-edge vignette above so the player can have one without
  // the other.
  isDungeonVignetteEnabled() {
    return _readBool(KEY.dungeonVignette) ?? DEFAULT_BOOL.dungeonVignette
  },
  isHotkeysEnabled() {
    return _readBool(KEY.hotkeys) ?? DEFAULT_BOOL.hotkeys
  },
  isConfirmAbandonEnabled() {
    return _readBool(KEY.confirmRun) ?? DEFAULT_BOOL.confirmRun
  },
  isAutosaveEnabled() {
    return _readBool(KEY.autosave) ?? DEFAULT_BOOL.autosave
  },
  // Master toggle for tutorial / gameplay-hint popups. ANDs with the
  // per-run `gameState.meta.tutorialEnabled` so either off disables.
  isTutorialsEnabled() {
    return _readBool(KEY.tutorials) ?? DEFAULT_BOOL.tutorials
  },
  // 'off' | 'low' | 'med' | 'high'. Numeric multiplier for emitters.
  particlesLevel() {
    try {
      const raw = localStorage.getItem(KEY.particles)
      if (raw == null) return 'high'
      return raw
    } catch { return 'high' }
  },
  particlesMultiplier() {
    switch (this.particlesLevel()) {
      case 'off':  return 0
      case 'low':  return 0.4
      case 'med':  return 0.7
      default:     return 1.0
    }
  },
}

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
  companion:       'qf.gameplay.companion',
  speechSfx:       'qf.audio.speechSfx',
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
  speechSfx:       true,
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
  // Per-letter speech blip while the companion NPC types out a line
  // (RPG-style). Now driven by the VOICE fader (OPTIONS) — enabled when the
  // voice volume is above ~zero. Falls back to the legacy speechSfx boolean.
  isNpcSpeechEnabled() {
    return this.voiceVolume() > 0.02
  },
  // Master volume, 0..1 (MASTER fader / qf.audio.master, default 0.7). SFX +
  // music fold it in via SfxVolume / TitleMusic; VOICE reads it here directly so
  // companion speech scales with master WITHOUT also being gated by the SFX fader.
  masterVolume() {
    try {
      const raw = localStorage.getItem('qf.audio.master')
      if (raw == null) return 0.7
      return Math.max(0, Math.min(1, Number(raw) / 100))
    } catch { return 0.7 }
  },
  // Companion speech-blip volume, 0..1 (VOICE fader / qf.audio.voice, default
  // 0.65). Blip play sites multiply master × this (independent of the SFX fader).
  voiceVolume() {
    try {
      const raw = localStorage.getItem('qf.audio.voice')
      if (raw == null) {
        // Legacy: honour an old speechSfx=false (muted) before the VOICE fader.
        return (_readBool(KEY.speechSfx) === false) ? 0 : 0.65
      }
      return Math.max(0, Math.min(1, Number(raw) / 100))
    } catch { return 0.65 }
  },
  // Mute all audio when the tab/window loses focus (qf.audio.muteUnfocused,
  // default on). Honoured by the focusMute installer.
  muteUnfocused() {
    return _readBool('qf.audio.muteUnfocused') ?? true
  },

  // Companion NPC visibility + chattiness.
  //   'off'    — HIDDEN. Sprite removed; tutorials + intro fall back to
  //              the standalone TutorialOverlay / WelcomeIntroOverlay.
  //              Picking this also flips `tutorials` off (SettingsOverlay).
  //   'mute'   — MUTE. Sprite visible (idle animation only), but never
  //              speaks. Tutorials + intro fall back to the standalone
  //              popups, same as 'off'.
  //   'quiet'  — SAY LESS. Shown, only notable events + tutorials (no
  //              idle chatter, no minor build-action reactions).
  //   'normal' — full reactivity (default).
  companionMode() {
    try {
      const raw = localStorage.getItem(KEY.companion)
      if (raw === 'off' || raw === 'mute' || raw === 'quiet' || raw === 'normal') return raw
    } catch {}
    return 'normal'
  },
  // True when the companion should produce no dialogue at all (either
  // hidden or muted). Tutorial/intro routing falls back to the standalone
  // popups in both cases.
  isCompanionSilent() {
    const m = this.companionMode()
    return m === 'off' || m === 'mute'
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

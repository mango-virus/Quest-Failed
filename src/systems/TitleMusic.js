// Title-music singleton.
//
// Plays the title-screen / boss-picker loop across MainMenu,
// ArchetypeSelect, AND through into the dungeon run itself — the
// soundtrack carries seamlessly from the menu into gameplay, just
// ducked to a quieter background-music level once the player commits
// to a run.  Phaser sounds added via scene.sound.add() are owned by
// the global SoundManager and persist across scene transitions; this
// module just keeps a handle so different scenes can talk to the
// same instance.
//
// Lifecycle:
//   ensurePlaying(scene)  — start the loop (or no-op if already
//                           playing); also clears any active duck so
//                           the title screens always play at full
//                           volume.
//   duckForGameplay(scene) — fade the volume down to the gameplay
//                            background level (DUCK_MUL × user vol).
//   stop()                — tear down completely; used by full-screen
//                           editor scenes and by NIGHT_PHASE_STARTED-
//                           era teardowns.

const STORAGE_KEY      = 'qf.audio.musicVolume'
const STORAGE_MUTE_KEY = 'qf.audio.musicMuted'
const DEFAULT_VOLUME = 0.15
// Multiplier applied to the user's preferred volume while ducked for
// gameplay.  0.35 = roughly a 9 dB cut, audible-but-background, easily
// drowned by any future SFX layer.
const DUCK_MUL = 0.35
const FADE_MS  = 700

let _instance     = null
let _volume       = _readStoredVolume()
let _muted        = _readStoredMuted()
let _duckMul      = 1            // 1 = full volume, DUCK_MUL = ducked
let _activeFade   = null         // handle to the in-flight volume tween
const _listeners  = new Set()    // change subscribers (UI controls)

function _readStoredVolume() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) return DEFAULT_VOLUME
    const v = parseFloat(raw)
    if (!Number.isFinite(v)) return DEFAULT_VOLUME
    return Math.max(0, Math.min(1, v))
  } catch {
    return DEFAULT_VOLUME
  }
}

function _readStoredMuted() {
  try { return localStorage.getItem(STORAGE_MUTE_KEY) === '1' } catch { return false }
}

function _effectiveVolume() {
  if (_muted) return 0
  return _volume * _duckMul
}

function _emitChange() {
  for (const fn of _listeners) {
    try { fn({ volume: _volume, muted: _muted }) } catch {}
  }
}

// Smoothly tween the live instance's volume to the target.  Falls back
// to a snap-set if no scene is available to host the tween.
function _fadeTo(scene, target) {
  if (!_instance) return
  if (_activeFade) { _activeFade.stop(); _activeFade = null }
  if (!scene?.tweens) {
    _instance.setVolume(target)
    return
  }
  _activeFade = scene.tweens.addCounter({
    from: _instance.volume,
    to:   target,
    duration: FADE_MS,
    ease: 'Sine.easeInOut',
    onUpdate: (tw) => {
      if (_instance) _instance.setVolume(tw.getValue())
    },
    onComplete: () => {
      if (_instance) _instance.setVolume(target)
      _activeFade = null
    },
  })
}

export const TitleMusic = {
  // Idempotent — safe to call from MainMenu.create() and
  // ArchetypeSelect.create().  Starts the loop on first call, no-op
  // after that.  Always restores full (unducked) volume so returning
  // to the menu/picker pair from gameplay swells the music back up.
  ensurePlaying(scene) {
    const wantFull = _duckMul !== 1
    if (_instance && _instance.isPlaying) {
      if (wantFull) {
        _duckMul = 1
        _fadeTo(scene, _effectiveVolume())
      }
      return _instance
    }
    if (!scene?.cache?.audio?.exists?.('title_music')) return null
    if (_instance && !_instance.isPlaying) {
      _instance.destroy()
      _instance = null
    }
    _duckMul = 1
    _instance = scene.sound.add('title_music', { loop: true, volume: _effectiveVolume() })
    _instance.play()
    return _instance
  },

  // Smoothly drop the volume to the gameplay-background level while
  // keeping the loop running.  Called from Game.create() so the title
  // track carries into the dungeon at a quieter level instead of
  // cutting out.  No-op if the music isn't currently playing (e.g.
  // the player resumed a save without ever passing through MainMenu
  // — there'd be no music to duck in that session).
  duckForGameplay(scene) {
    if (!_instance || !_instance.isPlaying) return
    if (_duckMul === DUCK_MUL) return
    _duckMul = DUCK_MUL
    _fadeTo(scene, _effectiveVolume())
  },

  // Hard restart — tears the loop down and starts a fresh instance
  // from the beginning.  Used by MainMenu so every return to the
  // title screen re-plays the song from frame 0 (player's request:
  // "if you go back to the main menu it stops playing and then
  // restarts from the beginning").  ArchetypeSelect / Game continue
  // to use ensurePlaying / duckForGameplay so the menu→picker→game
  // forward flow stays seamless.
  restart(scene) {
    this.stop()
    return this.ensurePlaying(scene)
  },

  // Stop and tear down the music instance.  Called on transitions to
  // any non-music scene (editors, Graveyard).
  stop() {
    if (_activeFade) { _activeFade.stop(); _activeFade = null }
    if (!_instance) return
    _instance.stop()
    _instance.destroy()
    _instance = null
    _duckMul = 1
  },

  // Persisted master volume (0..1).  Used by the in-game audio
  // controls; saved to localStorage so the preference survives reloads.
  // Snap-applies (no fade) — the slider already gives smooth manual
  // feedback.
  setVolume(v) {
    _volume = Math.max(0, Math.min(1, v))
    if (_instance) _instance.setVolume(_effectiveVolume())
    try { localStorage.setItem(STORAGE_KEY, String(_volume)) } catch {}
    _emitChange()
  },

  getVolume() { return _volume },

  // Persisted mute toggle.  Mute drops effective volume to 0 without
  // touching the user's preferred volume, so unmuting restores the
  // previous level.  Survives reloads via localStorage.
  setMuted(b) {
    _muted = !!b
    if (_instance) _instance.setVolume(_effectiveVolume())
    try { localStorage.setItem(STORAGE_MUTE_KEY, _muted ? '1' : '0') } catch {}
    _emitChange()
  },

  isMuted() { return _muted },
  toggleMuted() { this.setMuted(!_muted) },

  // Subscribe to volume / mute changes.  Returns an unsubscribe fn.
  // The audio-controls widget uses this to keep its slider + icon in
  // sync if the state changes elsewhere (e.g. from another control
  // instance in a different scene).
  onChange(fn) {
    _listeners.add(fn)
    return () => _listeners.delete(fn)
  },
}

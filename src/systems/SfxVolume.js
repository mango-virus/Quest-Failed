// SFX-volume singleton.
//
// Stores the player's preferred SFX master volume (0..1) and mute state,
// persisted to localStorage so the preference survives page reloads.
// SfxSystem multiplies each per-sound gain by SfxVolume.getVolume() and
// skips playback entirely when isMuted() is true.
// AudioControls subscribes via onChange() to keep its SFX slider in sync.

const STORAGE_KEY      = 'qf.audio.sfxVolume'
const STORAGE_MUTE_KEY = 'qf.audio.sfxMuted'
const DEFAULT_VOLUME   = 0.8

let _volume = _readStored()
let _muted  = _readStoredMuted()
const _listeners = new Set()

function _readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) return DEFAULT_VOLUME
    const v = parseFloat(raw)
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_VOLUME
  } catch { return DEFAULT_VOLUME }
}

function _readStoredMuted() {
  try { return localStorage.getItem(STORAGE_MUTE_KEY) === '1' } catch { return false }
}

function _emit() { _listeners.forEach(fn => fn()) }

export const SfxVolume = {
  getVolume()   { return _volume },
  setVolume(v)  {
    _volume = Math.max(0, Math.min(1, v))
    try { localStorage.setItem(STORAGE_KEY, String(_volume)) } catch {}
    _emit()
  },
  isMuted()     { return _muted },
  setMuted(b)   {
    _muted = !!b
    try { localStorage.setItem(STORAGE_MUTE_KEY, _muted ? '1' : '0') } catch {}
    _emit()
  },
  toggleMuted() { SfxVolume.setMuted(!_muted) },
  onChange(fn)  { _listeners.add(fn); return () => _listeners.delete(fn) },
}

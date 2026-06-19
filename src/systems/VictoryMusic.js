// Victory music singleton — the triumphant counterpart to GameOverMusic.
//
// Loops `victory-music` while the VictoryScreen is up, ducking every other
// music layer (gameplay playlist / boss track, title loop) the moment it
// starts. Mirrors the player's music volume + mute via TitleMusic.
//
// DORMANT until an audio file is registered under the `victory-music` key:
// start() guards on `cache.audio.exists`, so with no file it cleanly silences
// the other layers and plays nothing (matching GameOverMusic's own guard).
// This adds NO audio asset — the track is dropped in later (UI_POLISH_PLAN P2-3,
// per the "audio files come later" constraint).
//
// Lifecycle mirrors GameOverMusic:
//   start(host) — duck other music, begin the loop (host exposes .sound + .cache)
//   stop()      — tear the loop down when leaving the victory screen.

import { TitleMusic }    from './TitleMusic.js'
import { GameplayMusic } from './GameplayMusic.js'

// Full music presence — the victory screen is a marquee beat, like the
// boss-fight / game-over tracks rather than the ducked gameplay playlist.
const VOLUME_MUL = 1.0

let _instance  = null
let _unsubPref = null

function _effectiveVolume() {
  return TitleMusic.isMuted() ? 0 : TitleMusic.getVolume() * VOLUME_MUL
}

export const VictoryMusic = {
  // Idempotent — no-op if the loop is already playing.
  start(host) {
    if (_instance && _instance.isPlaying) return _instance
    // Silence the other music layers first (so the screen is quiet even while
    // the track itself is still dormant — no stale gameplay loop under it).
    GameplayMusic.stop?.()
    TitleMusic.stop?.()
    if (!host?.cache?.audio?.exists?.('victory-music')) return null
    if (_instance) { try { _instance.destroy() } catch {} ; _instance = null }
    _instance = host.sound.add('victory-music', { loop: true, volume: _effectiveVolume() })
    _instance.play()
    if (!_unsubPref) {
      _unsubPref = TitleMusic.onChange(() => {
        if (_instance) _instance.setVolume(_effectiveVolume())
      })
    }
    return _instance
  },

  stop() {
    if (_unsubPref) { _unsubPref(); _unsubPref = null }
    if (!_instance) return
    try { _instance.stop() } catch {}
    try { _instance.destroy() } catch {}
    _instance = null
  },

  isActive() { return !!(_instance && _instance.isPlaying) },
}

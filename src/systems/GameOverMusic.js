// Game-over music singleton.
//
// Loops `game-over-music` while the run-end screen is up, and silences
// every other music layer (gameplay playlist, any boss-fight track it
// owns, and the title loop) the moment it starts. Mirrors the player's
// music volume + mute via TitleMusic — the shared source of truth for
// the music slider.
//
// Lifecycle:
//   start(host) — stop other music, begin the loop. `host` is any object
//                 exposing `.sound` + `.cache` (a Phaser scene OR the
//                 game instance — both expose the global managers).
//   stop()      — tear the loop down; call when the player leaves the
//                 game-over screen so the title loop can take over again.

import { TitleMusic }    from './TitleMusic.js'
import { GameplayMusic } from './GameplayMusic.js'

// Played at full music presence — the run-end screen is a dramatic beat,
// matching the boss-fight tracks rather than the ducked gameplay playlist.
const VOLUME_MUL = 1.0

let _instance  = null
let _unsubPref = null

function _effectiveVolume() {
  return TitleMusic.isMuted() ? 0 : TitleMusic.getVolume() * VOLUME_MUL
}

export const GameOverMusic = {
  // Idempotent — no-op if the loop is already playing.
  start(host) {
    if (_instance && _instance.isPlaying) return _instance
    // Silence every other music layer first: the gameplay playlist (and
    // any boss-fight track it owns), then the title loop.
    GameplayMusic.stop?.()
    TitleMusic.stop?.()
    if (!host?.cache?.audio?.exists?.('game-over-music')) return null
    if (_instance) { try { _instance.destroy() } catch {} ; _instance = null }
    _instance = host.sound.add('game-over-music', { loop: true, volume: _effectiveVolume() })
    _instance.play()
    // Keep volume in sync with the music slider while the screen is up.
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

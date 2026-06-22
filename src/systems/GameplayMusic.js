// Gameplay-music playlist singleton.
//
// Plays a shuffled queue of in-dungeon tracks during the actual run
// (Game scene + its sub-scenes).  Each track plays to completion, then
// the next is pulled from the bag; when the bag empties it reshuffles,
// avoiding an immediate repeat of the just-played track.
//
// Volume + mute are shared with TitleMusic so the single slider in
// AudioControls drives both modules — TitleMusic remains the source of
// truth, and this module mirrors its state via TitleMusic.onChange.
//
// Lifecycle (mirrors the TitleMusic pattern):
//   start(scene)    — begin (or resume) the playlist.
//   stop()          — tear down completely; used when returning to the
//                     title screen so the title-music loop can take over.
//   next(scene)     — advance to the next track.
//   previous(scene) — go back to the previously-played track (or
//                     restart the current track if none).

import { TitleMusic } from './TitleMusic.js'
import { ensureAudioLoaded } from '../scenes/DeferredAudioLoader.js'
import { EventBus } from './EventBus.js'

// Multiplier applied on top of the user's master music volume (which
// is shared with TitleMusic via the slider).  The in-dungeon tracks
// are mixed louder than the title-screen loop, so we scale them down
// a bit so they don't drown out SFX.
const VOLUME_MUL      = 0.6
const BOSS_VOLUME_MUL = 1.0    // boss fight tracks play at full volume

// Track manifest — keys must match Preload.js.  Order is irrelevant
// because we shuffle on first start.
const TRACKS = [
  'gpm-chupasangre',
  'gpm-clockwork-castle',
  'gpm-catacombs',
  'gpm-wallachian-waltz',
  'gpm-midnight-masquerade',
  'gpm-endless-accent',
  'gpm-suck-em-dry',
]

// Boss fight tracks — one is chosen at random when BOSS_FIGHT_INCOMING fires.
// Regular playlist is paused, boss track loops until BOSS_FIGHT_RESOLVED fades
// it out and resumes the playlist.
const BOSS_TRACKS = [
  'boss-fight-1',
  'boss-fight-2',
  'boss-fight-3',
  'boss-fight-4',
  'boss-fight-5',
]

const BOSS_FADE_MS = 3000   // fade-out duration when boss fight ends

let _scene        = null   // last scene used to host new sound instances
let _instance     = null   // currently-playing Phaser sound
let _currentKey   = null   // key of the currently-playing (or last-played) track
let _bag          = []     // upcoming tracks; popped from the end
let _history      = []     // played tracks, most-recent last (used by previous())
let _unsubPref    = null   // unsubscribe handle for TitleMusic.onChange
const _listeners  = new Set()

// Ducking — the music dips under high-tension moments (the boss at low HP) so
// the combat / boss-ability cues cut through. `_duckMul` (0..1) folds into both
// _effectiveVolume helpers, tweened by duck() so the dip glides instead of
// snapping. Driven by BOSS_DAMAGED (wired in start()).
let _duckMul    = 1
let _duckTarget = 1
let _duckTween  = null
let _unsubDuck  = null
const DUCK_LOW_HP_FRAC = 0.30   // boss HP fraction that triggers the dip
const DUCK_LEVEL       = 0.45   // music drops to 45% while ducked

// Boss fight state
let _bossInstance = null   // currently-playing boss track sound instance
let _inBossFight  = false  // true while a boss fight is active
// In-flight fade-outs. Each entry is { sound, tween }: the boss sound
// mid-fade plus the volume tween animating it. bossFightEnd() detaches
// the boss sound from _bossInstance the moment the fade begins so the
// volume slider stops targeting it; without this list, a subsequent
// stop() can't find the still-audible sound (it lives in the global
// SoundManager) and the boss track plays on forever.
//
// The `tween` is tracked so _stopBoss() can KILL it before destroying
// the sound. A volume tween left running against a destroyed sound
// throws "Cannot set properties of null (setting 'volume')" from inside
// Phaser's tween step — uncaught, it kills the entire game loop. That
// is the second-boss-fight freeze: at 8× speed the next fight reliably
// begins inside the 3s fade window, so _stopBoss() destroys a sound
// whose fade tween is still live.
const _fadingBosses = []

function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function _refillBag() {
  const next = _shuffle(TRACKS.slice())
  // Avoid an immediate repeat when transitioning bag→bag.  The bag is
  // popped from the end, so the tail-most entry plays first; if it
  // matches the just-finished track, swap it with the head.
  if (_currentKey && next.length > 1 && next[next.length - 1] === _currentKey) {
    ;[next[0], next[next.length - 1]] = [next[next.length - 1], next[0]]
  }
  _bag = next
}

function _effectiveVolume()     { return TitleMusic.isMuted() ? 0 : TitleMusic.getVolume() * VOLUME_MUL * _duckMul }
function _effectiveBossVolume() { return TitleMusic.isMuted() ? 0 : TitleMusic.getVolume() * BOSS_VOLUME_MUL * _duckMul }

function _emitChange() {
  for (const fn of _listeners) {
    try { fn({ currentKey: _currentKey }) } catch {}
  }
}

function _stopCurrent() {
  if (!_instance) return
  try { _instance.removeAllListeners() } catch {}
  try { _instance.stop() } catch {}
  try { _instance.destroy() } catch {}
  _instance = null
}

function _stopBoss() {
  // Kill any boss sound still mid-fade — bossFightEnd() detaches them
  // from _bossInstance the moment the fade starts, so they wouldn't be
  // caught by the _bossInstance check below. The fade tween is owned by
  // the Game scene; if that scene shut down before the fade completed
  // (e.g. BOSS_DEFEATED_FINAL → GameOver), the tween is gone but the
  // sound itself lives in the global SoundManager and keeps playing.
  while (_fadingBosses.length) {
    const { sound, tween } = _fadingBosses.pop()
    // CRITICAL ORDER: kill the volume-fade tween BEFORE destroying the
    // sound. The tween animates `sound.volume`; if the sound is
    // destroyed first, the tween's next update sets `volume` on a
    // now-null internal object and throws inside Phaser's tween step,
    // which is uncaught and hard-freezes the game.
    try { tween?.stop() } catch {}
    try { tween?.remove() } catch {}
    try { sound?.removeAllListeners() } catch {}
    try { sound?.stop() } catch {}
    try { sound?.destroy() } catch {}
  }
  if (_bossInstance) {
    try { _bossInstance.removeAllListeners() } catch {}
    try { _bossInstance.stop() } catch {}
    try { _bossInstance.destroy() } catch {}
    _bossInstance = null
  }
  _inBossFight = false
}

function _playKey(scene, key) {
  _stopCurrent()
  _scene = scene || _scene
  _currentKey = key
  if (!_scene?.cache?.audio?.exists?.(key)) {
    // Deferred run audio hasn't streamed in yet — load just this track, then
    // play it IF it's still the current track and nothing else has started
    // (the player may have skipped onward while it loaded). The cache.exists
    // re-check guards against a non-deferred key looping forever.
    ensureAudioLoaded(_scene, key, () => {
      if (_currentKey === key && _scene?.cache?.audio?.exists?.(key)
          && (!_instance || !_instance.isPlaying)) {
        _playKey(_scene, key)
      }
    })
    _emitChange()
    return null
  }
  const sound = _scene.sound.add(key, { volume: _effectiveVolume() })
  _instance = sound
  // Capture the sound in the closure so a stale 'complete' from a
  // track we've already manually skipped past can't double-fire the
  // advance.
  sound.once('complete', () => {
    if (sound !== _instance) return
    _history.push(_currentKey)
    _advance()
  })
  sound.play()
  _emitChange()
  return sound
}

function _advance() {
  if (_bag.length === 0) _refillBag()
  const next = _bag.pop()
  _playKey(_scene, next)
}

export const GameplayMusic = {
  // Idempotent.  Begins the shuffled playlist on first call; resumes
  // (or no-ops) on subsequent calls.  Always re-binds the volume/mute
  // mirror to the supplied scene.
  start(scene) {
    _scene = scene
    if (!_unsubPref) {
      _unsubPref = TitleMusic.onChange(() => {
        if (_instance) _instance.setVolume(_effectiveVolume())
        if (_bossInstance) _bossInstance.setVolume(_effectiveBossVolume())
      })
    }
    // Tension ducking — dip the music while the boss is at low HP, restore when
    // the fight ends or night falls. BOSS_DAMAGED carries no fraction, so read
    // the boss straight off gameState.
    if (!_unsubDuck) {
      const onDmg = () => {
        const b = _scene?.gameState?.boss
        if (!b || !(b.maxHp > 0)) return
        GameplayMusic.duck((b.hp / b.maxHp) <= DUCK_LOW_HP_FRAC ? DUCK_LEVEL : 1)
      }
      const restore = () => GameplayMusic.duck(1)
      EventBus.on('BOSS_DAMAGED', onDmg)
      EventBus.on('BOSS_FIGHT_RESOLVED', restore)
      EventBus.on('NIGHT_PHASE_BEGAN', restore)
      _unsubDuck = () => {
        EventBus.off('BOSS_DAMAGED', onDmg)
        EventBus.off('BOSS_FIGHT_RESOLVED', restore)
        EventBus.off('NIGHT_PHASE_BEGAN', restore)
      }
    }
    if (_instance && _instance.isPlaying) return _instance
    if (_currentKey) {
      // Restart the same track from frame 0 — happens when the player
      // came back from a scene that destroyed the sound instance.
      return _playKey(scene, _currentKey)
    }
    _refillBag()
    _advance()
    return _instance
  },

  // Tear down the playlist completely.  Called when the player
  // returns to the title screen so TitleMusic can take over again.
  stop() {
    _stopCurrent()
    // Also kill any boss-fight track that's still active or mid-fade —
    // without this, returning to MainMenu / ArchetypeSelect during a
    // boss-fight tween would leave the boss music looping on top of the
    // title music.
    _stopBoss()
    _currentKey = null
    _bag = []
    _history = []
    if (_unsubPref) { _unsubPref(); _unsubPref = null }
    if (_unsubDuck) { _unsubDuck(); _unsubDuck = null }
    if (_duckTween) { try { _duckTween.stop() } catch {} _duckTween = null }
    _duckMul = 1; _duckTarget = 1
    _emitChange()
  },

  // Duck the music toward `target` (0..1) over `fadeMs`, gliding via a tween so
  // the dip/rise is smooth. Idempotent when already heading to that target.
  // Folds through _effectiveVolume so the user's slider + mute still win.
  duck(target, fadeMs = 600) {
    target = Math.max(0, Math.min(1, target))
    if (Math.abs(target - _duckTarget) < 0.01) return
    _duckTarget = target
    const apply = () => {
      if (_instance) _instance.setVolume(_effectiveVolume())
      if (_bossInstance) _bossInstance.setVolume(_effectiveBossVolume())
    }
    if (_duckTween) { try { _duckTween.stop() } catch {} _duckTween = null }
    if (!_scene?.tweens) { _duckMul = target; apply(); return }
    _duckTween = _scene.tweens.add({
      targets: { v: _duckMul }, v: target, duration: fadeMs, ease: 'Sine.easeInOut',
      onUpdate: (_tw, t) => { _duckMul = t.v; apply() },
      onComplete: () => { _duckMul = target; apply(); _duckTween = null },
    })
  },

  // True while a track is actually playing.  Used by AudioControls
  // to grey out the skip/back buttons when there's nothing to skip.
  isActive() {
    return !!(_instance && _instance.isPlaying)
  },

  next(scene) {
    if (!_currentKey) return
    _history.push(_currentKey)
    if (_bag.length === 0) _refillBag()
    const nx = _bag.pop()
    _playKey(scene || _scene, nx)
  },

  previous(scene) {
    if (_history.length === 0) {
      // Nothing to go back to — restart the current track.
      if (_currentKey) _playKey(scene || _scene, _currentKey)
      return
    }
    const prev = _history.pop()
    // Push the just-interrupted current track to the front of the bag
    // so it's still scheduled to play later in this rotation.
    if (_currentKey) _bag.push(_currentKey)
    _playKey(scene || _scene, prev)
  },

  getCurrentKey() { return _currentKey },

  // ── Boss fight music ───────────────────────────────────────────────────────

  // Call on BOSS_FIGHT_INCOMING: pauses the regular playlist and starts
  // a randomly-chosen boss track (looping) at full gameplay volume.
  bossFightStart(scene) {
    if (_inBossFight) return   // already in a fight (guard against double-fire)
    _scene = scene || _scene

    // Pause the regular track so it resumes from the same position later.
    if (_instance && _instance.isPlaying) _instance.pause()

    // Pick a random boss track.
    const key = BOSS_TRACKS[Math.floor(Math.random() * BOSS_TRACKS.length)]
    if (!_scene?.cache?.audio?.exists?.(key)) {
      // Asset missing — fall back to letting the regular music continue.
      if (_instance && !_instance.isPlaying) _instance.resume()
      return
    }

    _stopBoss()   // clean up any leftover from a prior fight
    const boss = _scene.sound.add(key, { volume: _effectiveBossVolume(), loop: true })
    _bossInstance = boss
    boss.play()
    // Set the flag LAST. _stopBoss() above clears _inBossFight, so
    // setting it earlier would just get wiped — leaving the re-entry
    // guard at the top permanently disabled. With BOSS_FIGHT_INCOMING
    // able to fire repeatedly (chained adventurers, the orphan
    // watchdog), a disabled guard meant every re-fire tore down and
    // rebuilt the boss track.
    _inBossFight = true
  },

  // Call on BOSS_FIGHT_RESOLVED: fades out the boss track over BOSS_FADE_MS,
  // then resumes the regular playlist.  Pass immediate=true to skip the fade
  // (used on scene shutdown / night start).
  bossFightEnd(immediate = false) {
    _inBossFight = false

    if (!_bossInstance) {
      // No boss track was playing — just make sure the regular track resumes.
      if (_instance && !_instance.isPlaying) _instance.resume()
      return
    }

    const boss  = _bossInstance
    const scene = _scene
    _bossInstance = null   // detach immediately so volume slider stops targeting it

    const resume = () => {
      if (_instance && !_instance.isPlaying) {
        _instance.resume()
      } else if (!_instance) {
        _advance()
      }
    }

    if (immediate || !scene?.tweens) {
      try { boss.stop(); boss.destroy() } catch {}
      resume()
      return
    }

    // Track the sound + its fade tween together so _stopBoss() can kill
    // the tween before destroying the sound (see _fadingBosses comment).
    const fadeEntry = { sound: boss, tween: null }
    _fadingBosses.push(fadeEntry)
    fadeEntry.tween = scene.tweens.add({
      targets:  boss,
      volume:   0,
      duration: BOSS_FADE_MS,
      onComplete: () => {
        const idx = _fadingBosses.indexOf(fadeEntry)
        if (idx >= 0) _fadingBosses.splice(idx, 1)
        try { boss.stop(); boss.destroy() } catch {}
        resume()
      },
    })
  },

  // Subscribe to track-change events.  Returns an unsubscribe fn.
  onChange(fn) {
    _listeners.add(fn)
    return () => _listeners.delete(fn)
  },
}

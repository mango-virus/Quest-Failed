// Deferred audio loader.
//
// Music (~34MB of boss/stage tracks) and gameplay SFX are only needed INSIDE a
// run, which is many seconds after the player first sees the title menu. Loading
// them in Preload blocked the cold-start boot on ~38MB / ~45 requests. Instead we
// stream them AFTER the menu appears (kickOffDeferredAudioLoad, called from
// MainMenu.create — mirrors the AdventurerAtkLoader streamer), and re-kick from
// the Game scene so anything the menu pass didn't reach still lands early in the
// run. Phaser's audio cache is game-global, so a key loaded on either scene's
// loader is available everywhere.
//
// Safety: both `SfxSystem._play` and `GameplayMusic._playKey` guard on
// `cache.audio.exists`, so any key not yet streamed is silently skipped rather
// than erroring; GameplayMusic additionally lazy-loads the current track via
// `ensureAudioLoaded` so the very first run-music plays even on a fast dive-in.
//
// KEEP IN SYNC: title_music + the menu/UI SFX stay in Preload (they fire on the
// title screen). Everything else lives here. Music keys must match TRACKS /
// BOSS_TRACKS in GameplayMusic.js and 'game-over-music' in GameOverMusic.js.

export const DEFERRED_AUDIO = {
  // ── Build / placement SFX (Night phase) ──
  'sfx-build-1':          'assets/audio/build1.wav',
  'sfx-build-2':          'assets/audio/build2.wav',
  'sfx-build-3':          'assets/audio/build3.wav',
  'sfx-minion-place':     'assets/audio/pickup and drop.wav',
  // ── Gameplay SFX (combat / world) ──
  'sfx-death':            'assets/audio/adventurer and minion death.wav',
  'sfx-archer-shoot':     'assets/audio/archer long range shoot.mp3',
  'sfx-beholder-beam':    'assets/audio/beholder eye beam.mp3',
  'sfx-boss-attack':      'assets/audio/boss attack1.mp3',
  'sfx-boss-death':       'assets/audio/boss death.wav',
  'sfx-break-door':       'assets/audio/break door.wav',
  'sfx-chest-open':       'assets/audio/chest open.mp3',
  'sfx-cleric-heal':      'assets/audio/cleric heal.wav',
  'sfx-close-door':       'assets/audio/close door.wav',
  'sfx-collect-gold':     'assets/audio/collect gold.wav',
  'sfx-dark-pact':        'assets/audio/dark pact menu open.wav',
  'sfx-day-end':          'assets/audio/day phase end.wav',
  'sfx-day-start':        'assets/audio/day phase start.wav',
  'sfx-door-open':        'assets/audio/door open.mp3',
  'sfx-door-unlock':      'assets/audio/Door Unlock.wav',
  'sfx-mage-attack':      'assets/audio/long range mage attack.wav',
  'sfx-melee-1':          'assets/audio/melee weapon attack1.wav',
  'sfx-melee-2':          'assets/audio/melee weapon attack2.wav',
  'sfx-monk-1':           'assets/audio/monk attack1.wav',
  'sfx-monk-2':           'assets/audio/monk attack2.wav',
  'sfx-necro-summon':     'assets/audio/necromancer summon.mp3',
  'sfx-remove-room':      'assets/audio/remove room.wav',
  'sfx-revive':           'assets/audio/revive.wav',
  'sfx-revive-minions':   'assets/audio/revive minions.mp3',
  'sfx-score-countup':    'assets/audio/score or number count up.mp3',
  'sfx-take-damage':      'assets/audio/take damge.wav',
  'sfx-teleport':         'assets/audio/teleport.wav',
  'sfx-build-menu-press': 'assets/audio/build menu press.wav',
  'sfx-book-open':        'assets/audio/book-open.mp3',
  'sfx-speech':           'assets/audio/speech-2.wav',
  'sfx-human-die-1':      'assets/audio/Human_Die01.wav',
  'sfx-human-die-2':      'assets/audio/Human_Die02.wav',
  'sfx-human-hit-1':      'assets/audio/Human_Hit01.wav',
  'sfx-human-hit-2':      'assets/audio/Human_Hit02.wav',
  'sfx-human-hit-3':      'assets/audio/Human_Hit03.wav',
  'sfx-boss-levelup':     'assets/audio/boss level up.wav',
  'sfx-event-notif':      'assets/audio/event notification.mp3',
  'sfx-event-boss':       'assets/audio/boss event.mp3',
  'sfx-scrub-intel':      'assets/audio/scrub intel.wav',
  'sfx-minion-levelup':   'assets/audio/minion level up or evolve.wav',
  // ── Music (~34MB) — only needed inside a run ──
  'game-over-music':         'assets/audio/game over.wav',
  'boss-fight-1':            'assets/audio/Boss Fight 1.mp3',
  'boss-fight-2':            'assets/audio/Boss Fight 2.mp3',
  'boss-fight-3':            'assets/audio/Boss Fight 3.mp3',
  'boss-fight-4':            'assets/audio/Boss Fight 4.mp3',
  'boss-fight-5':            'assets/audio/Boss Fight 5.mp3',
  'gpm-chupasangre':         'assets/audio/chupasangre_music.mp3',
  'gpm-clockwork-castle':    'assets/audio/clockwork castle.mp3',
  'gpm-catacombs':           'assets/audio/catacombs.mp3',
  'gpm-wallachian-waltz':    'assets/audio/Wallachian Waltz.mp3',
  'gpm-midnight-masquerade': 'assets/audio/midnight masquerade.mp3',
  'gpm-endless-accent':      'assets/audio/endless accent.mp3',
  'gpm-suck-em-dry':         'assets/audio/suck em dry.mp3',
}

// Stream every not-yet-cached deferred audio file on `scene`'s loader.
// Idempotent per scene (the flag) and per file (cache.exists guard).
export function kickOffDeferredAudioLoad(scene) {
  if (!scene || scene._deferredAudioStarted) return
  scene._deferredAudioStarted = true
  let queued = 0
  for (const [key, path] of Object.entries(DEFERRED_AUDIO)) {
    if (scene.cache?.audio?.exists?.(key)) continue
    scene.load.audio(key, path)
    queued++
  }
  if (queued) scene.load.start()
}

// Ensure ONE deferred key is loaded, then invoke `cb`. Used by GameplayMusic so
// the current track still plays if the player dives into a run before the batch
// reached it. No-ops (calls cb immediately) for already-loaded or non-deferred
// keys, so callers can't infinite-loop.
export function ensureAudioLoaded(scene, key, cb) {
  if (!scene) { cb?.(); return }
  if (scene.cache?.audio?.exists?.(key)) { cb?.(); return }
  const path = DEFERRED_AUDIO[key]
  if (!path) { cb?.(); return }
  scene.load.audio(key, path)
  scene.load.once(`filecomplete-audio-${key}`, () => cb?.())
  scene.load.start()
}

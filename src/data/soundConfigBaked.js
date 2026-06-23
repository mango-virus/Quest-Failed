// soundConfigBaked.js — BAKED sound-trigger overrides that SHIP with the game.
//
// This is the committed "tuned defaults" layer. The Sound Studio writes per-machine
// tweaks to localStorage; `npm run audio:apply-config <export.json>` bakes a chosen
// export into THIS file so the tuning ships for everyone. SoundConfig merges:
//   user localStorage override  >  BAKED_SOUND_CONFIG  >  code default
// Edit via the bake tool, not by hand. Keys are trigger ids (see soundTriggers.js);
// values may set { key, keys, vol, pitch, mute }. (Custom uploaded files are NOT
// baked here — ship the audio file + add a loader entry instead.)

export const BAKED_SOUND_CONFIG = {}

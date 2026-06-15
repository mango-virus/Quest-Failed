// focusMute — mutes all game audio while the window/tab is unfocused, when the
// "MUTE WHEN UNFOCUSED" option (qf.audio.muteUnfocused, default on) is enabled.
//
// Installed once at app start (src/main.js). Uses Phaser's global sound mute so
// it covers music + every SFX channel. Only un-mutes on focus if WE muted on
// blur, so it never clobbers a user/system mute set elsewhere.

import { userSettings } from './userSettings.js'

let installed = false

export function installFocusMute() {
  if (installed || typeof window === 'undefined') return
  installed = true
  let mutedByBlur = false

  const onBlur = () => {
    if (!userSettings.muteUnfocused?.()) return
    const snd = window.__game?.sound
    if (snd && !snd.mute) { snd.mute = true; mutedByBlur = true }
  }
  const onFocus = () => {
    if (!mutedByBlur) return
    const snd = window.__game?.sound
    if (snd) snd.mute = false
    mutedByBlur = false
  }

  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
}

// JamPortalCorner — SUPERSEDED 2026-06-09. The Venture jam portal was
// removed from both the title screen AND the in-game HUD; this module is
// orphan (no imports). Kept on disk per the repo's removal-not-deletion
// policy; restore by re-importing in HudRoot.js if the portal needs to
// come back. The CSS (.qf-jamportal-corner*) was deleted alongside the
// title-screen menu rebuild — restore alongside the import.
//
// Original docs:
// Small spinning game-jam portal sitting at the right end of the gameplay
// HUD's bottom bar. Same sprite sheet and lobby target as the main-menu
// jam portal, scaled down to a bar-sized badge. Clicking it asks for
// confirmation before leaving the current run for the jam lobby.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

// Game-jam lobby — identical target to the main-menu portal.
const LOBBY_URL = 'https://callumhyoung.github.io/gamejam1-lobby/'

export class JamPortalCorner {
  constructor() {
    this.el = h('button', {
      className: 'qf-jamportal-corner',
      title: 'Jam Portal — enter the game-jam lobby',
      on: { click: () => this._confirmLeave() },
    }, [
      // Tiny "VENTURE" label above the sprite so first-time players
      // know clicking the portal sends them out of the run to the
      // jam hub. CSS positions it absolute, top-anchored so the
      // sprite's footprint isn't shifted.
      h('div', { className: 'pix qf-jamportal-corner-label' }, 'VENTURE'),
      h('div', { className: 'qf-jamportal-corner-sprite' }),
    ])
  }

  // Clicking the portal abandons the current run — ask first via the
  // shared ConfirmPopup (SHOW_CONFIRM). Only navigate on confirm.
  _confirmLeave() {
    EventBus.emit('SHOW_CONFIRM', {
      title: 'LEAVE THE DUNGEON?',
      message: 'This takes you to the game-jam lobby and leaves your '
             + 'current run behind. Are you sure you want to leave?',
      confirmLabel: 'LEAVE',
      cancelLabel:  'STAY',
      theme:        'shadow',
      onConfirm: () => this._goToLobby(),
    })
  }

  // Uses the shared window.Portal helper when available so the lobby gets
  // this game's referrer; falls back to a direct navigate otherwise.
  // Mirrors MainMenuOverlay._openJamPortal exactly.
  _goToLobby() {
    try {
      if (window.Portal?.sendPlayerThroughPortal) {
        window.Portal.sendPlayerThroughPortal(LOBBY_URL)
        return
      }
    } catch {}
    window.location.href = LOBBY_URL
  }

  destroy() {
    this.el?.remove()
    this.el = null
  }
}

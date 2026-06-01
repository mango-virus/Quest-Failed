// MainMenu — DOM-hosted title screen.
//
// The title screen UI is the DOM `MainMenuOverlay` (src/hud/MainMenuOverlay.js).
// This Phaser scene is a thin shell that mounts the overlay and owns the couple
// of cross-cutting concerns that must live in a Phaser scene:
//   - title-screen music (TitleMusic loop; stop GameplayMusic)
//   - background-streaming the oversize adventurer attack spritesheets
//     (kickOffAdventurerAtkLoad) while the player sits on the title screen
//   - a letterboxed camera so canvas-level right-click suppression etc. work
//
// The old Phaser-rendered split-screen menu (and the Options / Leaderboard /
// GameOver Phaser scenes it reached) was removed 2026-05-31 — the game runs on
// the DOM HUD exclusively now, so the legacy `newhud=0` menu path is gone.

import { TitleMusic }    from '../systems/TitleMusic.js'
import { GameplayMusic } from '../systems/GameplayMusic.js'
import { kickOffAdventurerAtkLoad } from './AdventurerAtkLoader.js'

// Logical design size — letterboxed inside the actual canvas.
const W = 1280
const H = 720

export class MainMenu extends Phaser.Scene {
  constructor() {
    super('MainMenu')
  }

  create() {
    // Title-screen music — keep the loop running continuously across
    // MainMenu / ArchetypeSelect transitions.
    GameplayMusic.stop()
    TitleMusic.ensurePlaying(this)

    // Mount the DOM title screen. Singleton on window.__game so re-entering
    // MainMenu (e.g. after a game-over) doesn't double-mount.
    import('../hud/MainMenuOverlay.js').then(({ MainMenuOverlay }) => {
      if (!this.scene.isActive()) return
      const game = window.__game
      if (game._mainMenuOverlay) game._mainMenuOverlay.close()
      game._mainMenuOverlay = new MainMenuOverlay()
      game._mainMenuOverlay.open()
    })

    // Camera so canvas-level right-click suppression etc. still work.
    this._setupCamera()

    this.events.once('shutdown', () => {
      const game = window.__game
      game?._mainMenuOverlay?.close()
      if (game) game._mainMenuOverlay = null
    })

    // Background-load the oversize attack sheets here. THIS Phaser scene still
    // owns the loader even though the visible title screen is the DOM overlay —
    // without it the `_atk` sheets never stream in and every adventurer's
    // slash/thrust silently falls back to the shrunk 64px row (most glaring on
    // Jinwoo, whose Scimitar swing is oversize-only). 3s delay + 4-parallel
    // throttle so the load doesn't compete with title-screen video decoding.
    this.time.delayedCall(3000, () => {
      if (!this.scene.isActive()) return
      this.load.maxParallelDownloads = 4
      kickOffAdventurerAtkLoad(this)
    })
  }

  // ─── Camera (letterboxed design rect) ──────────────────────────────────
  _setupCamera() {
    const sw = this.scale.width
    const sh = this.scale.height
    if (sw < 32 || sh < 32) return
    const sf = Math.min(sw / W, sh / H)
    const cam = this.cameras.main
    cam.setZoom(sf)
    const vw = W * sf
    const vh = H * sf
    cam.setViewport(Math.round((sw - vw) / 2), Math.round((sh - vh) / 2), vw, vh)
    cam.setScroll(0, 0)
    cam.setOrigin(0, 0)
    this.uiW = sw / sf
    this.uiH = sh / sf
  }
}

// MainMenu — thin Phaser host for the DOM-hosted title screen.
//
// The entire title-screen visual is the DOM `MainMenuOverlay`
// (src/hud/MainMenuOverlay.js) — an opaque full-screen backdrop (brick wall +
// torches + walkers) plus the menu tablet. This scene no longer draws any
// in-engine throne-room backdrop (it used to render a centered boss + flanking
// torches; those were hidden under the opaque DOM on the menu but bled through
// behind the dungeon if the scene lingered into gameplay — removed 2026-06-15).
//
// What this scene still owns:
//   - mounting / unmounting the DOM overlay
//   - title-screen music (TitleMusic loop; stop GameplayMusic)
//   - background-streaming the run audio (kickOffDeferredAudioLoad). The
//     oversize adventurer attack spritesheets are NO LONGER bulk-loaded here
//     (that ~650-file decode/upload was the source of title-screen lag) — they
//     now load on-demand per variant from AdventurerRenderer (requestAdvAtkSheet)
//   - a letterboxed camera so canvas-level right-click suppression etc. work
//
// The legacy `?newhud=0` Phaser menu path was removed 2026-05-31.

import { TitleMusic }    from '../systems/TitleMusic.js'
import { GameplayMusic } from '../systems/GameplayMusic.js'
import { kickOffDeferredAudioLoad } from './DeferredAudioLoader.js'

// Logical design size — letterboxed inside the actual canvas. Matches the
// 16:9 aspect of the DOM stage (1920×1080), so DOM and canvas line up.
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

    // Camera only — keeps canvas-level right-click suppression + the letterbox
    // working. The title screen's visuals are ALL owned by the DOM overlay now
    // (MainMenuOverlay: full opaque backdrop + brick wall + torches + walkers),
    // so this scene no longer renders a throne-room backdrop. It used to draw a
    // centered boss + flanking torches; with the opaque DOM on top those were
    // invisible on the menu but bled through under the dungeon if the scene
    // lingered into gameplay — hence removed.
    this._setupCamera()

    this.events.once('shutdown', () => {
      const game = window.__game
      game?._mainMenuOverlay?.close()
      if (game) game._mainMenuOverlay = null
    })

    // Background-stream the run audio (boss/stage music + gameplay SFX, ~38MB)
    // while the player sits on the title screen, so the cold boot didn't have to
    // block on it. Game.create() re-kicks it in case the player dove into a run
    // before this pass finished. The oversize adventurer attack sheets are NOT
    // streamed here anymore — bulk-decoding ~650 of them was what lagged the
    // menu; they now load on-demand per variant (AdventurerRenderer →
    // requestAdvAtkSheet), so only the few variants actually in a run get loaded.
    this.time.delayedCall(3000, () => {
      if (!this.scene.isActive()) return
      this.load.maxParallelDownloads = 4
      kickOffDeferredAudioLoad(this)
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

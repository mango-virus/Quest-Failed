import { Boot }            from './scenes/Boot.js'
import { Preload }         from './scenes/Preload.js'
import { MainMenu }        from './scenes/MainMenu.js'
import { ArchetypeSelect } from './scenes/ArchetypeSelect.js'
import { Game }            from './scenes/Game.js'
import { NightPhase }      from './scenes/NightPhase.js'
import { DayPhase }        from './scenes/DayPhase.js'
import { EndOfDay }        from './scenes/EndOfDay.js'
import { GameOver }        from './scenes/GameOver.js'
import { Graveyard }       from './scenes/Graveyard.js'
import { HudScene }        from './scenes/HudScene.js'
import { KnowledgeScreen } from './scenes/KnowledgeScreen.js'
import { TilesetEditor }   from './scenes/TilesetEditor.js'
import { RoomTileEditor }  from './scenes/RoomTileEditor.js'
import { PauseMenu }       from './scenes/PauseMenu.js'
import { Options }         from './scenes/Options.js'
import { Leaderboard }     from './scenes/Leaderboard.js'

// Future scenes registered here as they are built in later phases:
// import { BossFight }     from './scenes/BossFight.js'

// Phaser handles canvas + camera + input mapping natively in Scale.RESIZE
// mode. We let it own those concerns and layer two enhancements on top:
//   1. Text resolution bump — small fonts stay crisp on any display.
//   2. Window-resize listener — restarts UI scenes so their create() can
//      re-run applyUiCamera and rebuild layouts for the new viewport.
const config = {
  type: Phaser.AUTO,
  // Do NOT set width/height here — Scale.RESIZE reads the parent container's
  // live size directly, and snapshot values taken at script-parse time become
  // a fixed "design resolution" that Phaser refuses to resize below, which
  // causes the canvas to stay oversized when the window is made smaller.
  parent: 'game-container',
  backgroundColor: '#0a0514',
  scene: [
    Boot,
    Preload,
    MainMenu,
    ArchetypeSelect,
    Game,
    NightPhase,
    DayPhase,
    HudScene,   // above gameplay scenes, below result/menu screens
    EndOfDay,
    GameOver,
    Graveyard,
    KnowledgeScreen,
    TilesetEditor,
    RoomTileEditor,
    PauseMenu,   // overlay above any active gameplay scene when paused
    Options,     // settings scene reachable from MainMenu's OPTIONS
    Leaderboard, // global hall-of-evil scene reachable from MainMenu
  ],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  render: {
    antialias:   true,
    roundPixels: true,
  },
}

// Bump the default Text resolution. Phaser renders each Text to an off-screen
// glyph texture sized in fontSize × resolution pixels. When the camera zoom is
// < 1 (which happens any time logical design space is wider than the canvas),
// that texture gets downsampled; if it started at resolution=1, fonts soften.
// resolution=3 gives the GPU enough source detail to stay crisp through the
// camera-zoom + browser-downscale + DPR pipeline.
const TEXT_RESOLUTION = 3
const _origText = Phaser.GameObjects.GameObjectFactory.prototype.text
Phaser.GameObjects.GameObjectFactory.prototype.text = function (x, y, text, style) {
  const merged = style ? Object.assign({}, style) : {}
  if (merged.resolution == null) merged.resolution = TEXT_RESOLUTION
  return _origText.call(this, x, y, text, merged)
}

window.__game = new Phaser.Game(config)

// On window resize, debounce a layout pass — UI scenes get restarted so their
// create() can re-run applyUiCamera and rebuild element positions for the new
// dimensions. Scenes that hold unsaved user edits are skipped so a resize
// doesn't blow away in-progress work; their layouts may look slightly off
// until the user navigates away and back, which is the right trade for not
// losing paint strokes. Game scene is also skipped (it owns runtime state);
// Phaser's own RESIZE handling already resized its camera.
// DayPhase + NightPhase own active-run state (live adventurer list, placed
// rooms, build-menu selection). Restarting their create() on a resize
// re-runs _spawnDailyAdventurers / re-wires NightPhase from scratch, which
// surfaced as "pressing F12 spawns adventurers" — opening DevTools fires a
// resize, and DayPhase.restart() spawns a fresh wave on top of the live one.
const NON_LAYOUT_SCENES = new Set(['Boot', 'Preload', 'Game', 'TilesetEditor', 'RoomTileEditor', 'PauseMenu', 'Options', 'DayPhase', 'NightPhase'])
let _resizeTimer = null
window.__game.scale.on('resize', () => {
  clearTimeout(_resizeTimer)
  _resizeTimer = setTimeout(() => {
    const game = window.__game
    if (!game) return
    for (const s of game.scene.scenes) {
      if (!s.scene.isActive()) continue
      if (NON_LAYOUT_SCENES.has(s.scene.key)) continue
      s.scene.restart()
    }
  }, 200)
})

// Belt-and-suspenders resize: Phaser's RESIZE mode already listens internally,
// but un-maximizing a browser window on Windows can race its ResizeObserver.
// We fire refresh() inside requestAnimationFrame so the browser has completed
// CSS layout before Phaser reads offsetWidth/offsetHeight on the container.
// (A direct call on 'resize' can still see the stale pre-reflow dimensions.)
window.addEventListener('resize', () => {
  requestAnimationFrame(() => window.__game?.scale?.refresh())
})

// Suppress the browser right-click context menu game-wide. Right-click is
// used for drag-pan in Game and to cancel selections in NightPhase, and
// having the menu pop up over the canvas is just noise everywhere else
// (MainMenu, ArchetypeSelect, EndOfDay, GameOver, Graveyard). One canvas-
// level listener catches every scene without per-scene plumbing.
window.__game.canvas?.addEventListener('contextmenu', (e) => e.preventDefault())

// Dev preview visibility shim. The Claude Code preview pane (and some
// other embedded-browser hosts) ship the page in a context that reports
// `document.hidden: true` / `document.visibilityState: 'hidden'`, which
// the browser uses as the trigger for background-throttling setTimeout,
// rAF, and paint. That breaks any code in the preview that polls on a
// timer, and it lets the game's WebGL render loop stall — leading to
// "preview stuck on Boot" symptoms even after Boot's own setTimeout
// gate was removed.
//
// Override the Page Visibility API to always report visible, gated to
// localhost so this never ships to real users. If `document.hidden`
// is already false (a real, focused browser tab), the override is a
// no-op — it just keeps reporting false. The override is installed
// here at the top of main.js so it lands before ANY downstream code
// reads visibility (Phaser, the canvas recovery handler below, etc.).
;(() => {
  try {
    const h = location.hostname
    if (h !== 'localhost' && h !== '127.0.0.1') return
    Object.defineProperty(document, 'hidden',          { get: () => false,    configurable: true })
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true })
    // Fire one synthetic visibilitychange so any code that snapshotted
    // the value during module init can resync.
    document.dispatchEvent(new Event('visibilitychange'))
  } catch { /* defineProperty unavailable / page in a weird sandbox — drop silently */ }
})()

import { Boot }            from './scenes/Boot.js'
import { Preload }         from './scenes/Preload.js'
import { MainMenu }        from './scenes/MainMenu.js'
import { CompanionSelect } from './scenes/CompanionSelect.js'
import { ArchetypeSelect } from './scenes/ArchetypeSelect.js'
import { Game }            from './scenes/Game.js'
import { NightPhase }      from './scenes/NightPhase.js'
import { DayPhase }        from './scenes/DayPhase.js'
import { EndOfDay }        from './scenes/EndOfDay.js'
import { HudScene }        from './scenes/HudScene.js'
import { RoomTileEditor }  from './scenes/RoomTileEditor.js'
import { installCustomCursor } from './hud/CustomCursor.js'
import { installFocusMute } from './hud/focusMute.js'
import { installGamepadNav } from './hud/GamepadNav.js'
// PerfHud — Ctrl+Shift+P toggles a per-system tick-time overlay.
// Importing here just installs the key listener (idempotent); the
// overlay itself only mounts when toggled on. Zero-cost when hidden.
import './hud/PerfHud.js'
// Reduced-motion: apply the html.reduce-motion class at boot (before the menu
// + its entrance animations render) from the setting folded with the OS pref.
import './hud/motion.js'

// Future scenes registered here as they are built in later phases:
// import { BossFight }     from './scenes/BossFight.js'

// Phaser handles canvas + camera + input mapping natively in Scale.RESIZE
// mode. We let it own those concerns and layer two enhancements on top:
//   1. Text resolution bump — small fonts stay crisp on any display.
//   2. Window-resize listener — restarts UI scenes so their create() can
//      re-run applyUiCamera and rebuild layouts for the new viewport.
const config = {
  type: Phaser.AUTO,
  // The DOM HUD (src/hud/*) lives in a 1920×1080 logical stage that scales
  // to fit the viewport. Lock Phaser to the same design size with FIT so
  // its canvas and the DOM stage share one coordinate space — that's what
  // prevents the dungeon view from extending past the HUD panel edges and
  // makes mouse coords line up between the two layers.
  width:  1920,
  height: 1080,
  parent: 'game-container',
  // Pure black behind everything. Phaser fills its canvas with this colour
  // wherever the active scene does not paint — most visibly in the letterbox
  // bars when the viewport aspect differs from the 1920×1080 design size.
  // Was '#0a0514' (dark purplish-black), which read as a faint violet tint
  // on the bars outside the menus / game.
  backgroundColor: '#000000',
  scene: [
    Boot,
    Preload,
    MainMenu,
    CompanionSelect,
    ArchetypeSelect,
    Game,
    NightPhase,
    DayPhase,
    HudScene,   // above gameplay scenes, below result/menu screens
    EndOfDay,
    RoomTileEditor,
  ],
  scale: {
    // RESIZE: the drawing buffer matches the physical window size, so the canvas
    // renders 1:1 with the display — crisp at ANY window size / aspect, with no
    // CSS resampling (the soft, blurry-when-not-1920×1080 problem FIT had). The UI
    // cameras (UIKit.applyUiCamera) and the gameplay camera clamp (Game.js) are
    // built for this: they derive their zoom from the live canvas size, so a fixed
    // logical unit (designH=720) maps to the canvas height and layouts stay put.
    // On non-16:9 windows the playfield simply shows more space instead of
    // letterboxing. The DOM HUD scales independently to a 1920×1080 stage
    // (hud/stageScale.js) and overlays the canvas.
    mode: Phaser.Scale.RESIZE,
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

// Pixel-art cursor overlay. Hides the native browser cursor (via the
// `cursor: none` reset in styles.css) and paints a fixed-position
// DOM sprite that follows the mouse + plays a 3-frame click anim on
// mousedown. Top-level install so it's active across every scene and
// the DOM HUD without per-scene wiring.
installCustomCursor()

// Mute all audio while the window is unfocused, when the OPTIONS toggle
// "MUTE WHEN UNFOCUSED" is on (default). Idempotent; reads the live setting.
installFocusMute()

// Controller / gamepad navigation across the whole DOM HUD (menus + chrome
// + overlays). Top-level install so it's active on the title screen before
// HudRoot mounts. Polls only while a pad is connected — zero cost otherwise.
installGamepadNav()

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
const NON_LAYOUT_SCENES = new Set([
  'Boot', 'Preload',
  'Game', 'DayPhase', 'NightPhase',
  'RoomTileEditor',
  'PauseMenu', 'Options',
  // MainMenu / HudScene / transition scenes — restarting these on a
  // window resize (fullscreen toggle) caused MainMenuOverlay to remount
  // over an active run, and HudScene restart tore down the DOM HUD's
  // event wiring + cached state mid-gameplay.
  'MainMenu', 'HudScene',
  'CompanionSelect', 'ArchetypeSelect', 'EndOfDay', 'GameOver',
])
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
window.addEventListener('resize', () => {
  requestAnimationFrame(() => window.__game?.scale?.refresh())
})

// Refocusing the window/tab can leave the FIT-scaled Phaser canvas
// mis-sized: Phaser's ResizeObserver can fire while the game container is
// briefly 0-sized mid-relayout, collapsing the canvas so the dungeon view
// goes dark (the DOM HUD scales on its own and stays fine). Re-run the
// scale fit once — and again after layout has settled — to recover.
function _recoverCanvasScale() {
  const refresh = () => window.__game?.scale?.refresh()
  requestAnimationFrame(refresh)
  setTimeout(refresh, 150)
}
window.addEventListener('focus', _recoverCanvasScale)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _recoverCanvasScale()
})

// Suppress the browser right-click context menu game-wide. Right-click is
// used for drag-pan in Game and to cancel selections in NightPhase, and
// having the menu pop up over the canvas is just noise everywhere else
// (MainMenu, ArchetypeSelect, EndOfDay, GameOver, Graveyard). One canvas-
// level listener catches every scene without per-scene plumbing.
window.__game.canvas?.addEventListener('contextmenu', (e) => e.preventDefault())

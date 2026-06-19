// HUD scene — composes the persistent DOM HUD (HudRoot) on top of the
// gameplay scenes (NightPhase / DayPhase) and owns the Phaser-side
// boss-archetype wiring (BossArchetypeUI: in-world VFX + room/minion
// targeting). Stays active across phase transitions so chrome never flashes.
//
// The legacy Phaser HUD chrome (BossTopBar / ActionBar / MiniMapPanel /
// BuildMenu / KnowledgePin / DungeonLog + the whole Phaser popup suite) and
// its `?newhud=0` fallback were retired 2026-06-18 (UI_POLISH_PLAN P0-6) —
// the DOM HUD (src/hud/) is the only path now.

import { applyUiCamera } from '../ui/UIKit.js'
import { HudRoot } from '../hud/HudRoot.js'
import { BossArchetypeUI } from '../ui/BossArchetypeUI.js'
import { EventBus } from '../systems/EventBus.js'

export class HudScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HudScene', active: false })
    this._archetypeUI = null
    this._listeners   = []
  }

  init(data) {
    this._gameScene = data?.gameScene ?? null
    this._gameState = data?.gameState ?? null
  }

  create() {
    if (!this._gameScene || !this._gameState) return
    // Defensive: if create() ran without an intervening shutdown (e.g.,
    // Phaser scene.restart() racing with a window resize during a scene
    // transition), prior components and EventBus listeners survive. Tear
    // them down first so we don't end up with duplicates.
    if (this._listeners?.length || this._archetypeUI) {
      this.shutdown()
    }
    // Phaser does NOT auto-invoke a `shutdown()` method on the user scene
    // class when scene.stop() runs — it only fires the SHUTDOWN event on the
    // scene's event emitter. Without this binding, HudScene.shutdown() is
    // unreachable from the normal stop path, so the DOM HudRoot keeps
    // bleeding through MainMenu / ArchetypeSelect / RoomTileEditor /
    // TilesetEditor after ABANDON RUN, RISE AGAIN, or anything else that
    // stops HudScene. `once` so a single stop fires shutdown once and
    // detaches; create() runs again on the next start.
    this.events.once('shutdown', this.shutdown, this)
    applyUiCamera(this)

    // ── DOM HUD ──
    // HudRoot (TopBar / BottomBar / LeftPanels / RightPanels / ToastQueue +
    // the overlay set) is a singleton on the Phaser game instance, not the
    // scene, so it survives phase transitions and is torn down explicitly in
    // shutdown().
    const game = window.__game
    // Rebuild HudRoot if gameState identity changed (new run, save load).
    if (game?._hudRoot && game._hudRoot._gameState !== this._gameState) {
      game._hudRoot.destroy()
      game._hudRoot = null
    }
    if (game && !game._hudRoot) {
      game._hudRoot = new HudRoot(this._gameState)
    }

    // ── Boss-archetype Phaser wiring ──
    // Sits over the world: in-world VFX + room/minion pick listeners for the
    // archetype day-actions. The player-facing buttons live in the DOM
    // (src/hud/BossArchetypeStrip.js) to match the chrome theme.
    this._archetypeUI = new BossArchetypeUI(this, this._gameState, { depth: 65 })

    // Clear any lingering build selection on phase change so day-2+ placement
    // works cleanly — NightPhase re-init starts with no selected def.
    const onPhaseChange = () => EventBus.emit('BUILD_DESELECT')
    EventBus.on('NIGHT_PHASE_BEGAN', onPhaseChange)
    EventBus.on('DAY_PHASE_BEGAN',   onPhaseChange)
    this._listeners.push(['NIGHT_PHASE_BEGAN', onPhaseChange])
    this._listeners.push(['DAY_PHASE_BEGAN',   onPhaseChange])
  }

  update() {
    this._archetypeUI?.update()
  }

  shutdown() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
    // Tear down the DOM HUD when HudScene shuts down. HudRoot lives on
    // `window.__game._hudRoot` (singleton-on-game), not on the scene, so
    // without this it would persist across scene transitions and bleed
    // through MainMenu / ArchetypeSelect / RoomTileEditor / TilesetEditor
    // when the player navigates after a game-over or via PauseMenu ABANDON.
    // HudScene.create() rebuilds HudRoot on next start.
    const game = window.__game
    if (game?._hudRoot) {
      game._hudRoot.destroy()
      game._hudRoot = null
    }
    this._archetypeUI?.destroy?.()
    this._archetypeUI = null
  }
}

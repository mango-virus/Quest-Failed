// ModeSelect — the "how will you reign?" scene.
//
// Sits between MainMenu's NEW EVIL and the CompanionSelect keeper picker. The
// player chooses the run's MODE — CAMPAIGN (The Kingdom's Reckoning, the 4-act
// win-condition run) or ENDLESS (survive forever, full content, no act structure).
// Like the other select screens, this scene is a thin Phaser shell — all the
// visuals + interaction live in the DOM overlay `src/hud/ModeSelectOverlay.js`.
// The choice persists to localStorage `qf.runMode`, which ArchetypeSelect._beginRun
// reads when it builds the run (→ gameState.meta.mode → isActsEnabled).

import { TitleMusic } from '../systems/TitleMusic.js'

export class ModeSelect extends Phaser.Scene {
  constructor() {
    super('ModeSelect')
  }

  create() {
    // Title music carries continuously across MainMenu → ModeSelect →
    // CompanionSelect → ArchetypeSelect; ensurePlaying is idempotent.
    TitleMusic.ensurePlaying(this)

    // ModeSelect replaces the title screen in the nav flow — MainMenu was
    // started-over (not stopped) by `game.scene.start`, so stop it now.
    if (this.scene.isActive('MainMenu')) this.scene.stop('MainMenu')

    // Stop any in-flight gameplay scenes from a previous run (scene.start only
    // swaps the calling scene; parallel scenes stay alive otherwise — mirrors
    // CompanionSelect's guard so an abandoned run doesn't leak into the picker).
    for (const key of ['Game', 'NightPhase', 'DayPhase', 'EndOfDay',
                       'Graveyard', 'KnowledgeScreen', 'HudScene']) {
      if (this.scene.isActive(key) || this.scene.isPaused(key)) this.scene.stop(key)
    }

    import('../hud/ModeSelectOverlay.js').then(({ ModeSelectOverlay }) => {
      if (!this.scene.isActive()) return
      const game = window.__game
      if (game._modeSelectOverlay) game._modeSelectOverlay.close()
      game._modeSelectOverlay = new ModeSelectOverlay(this)
      game._modeSelectOverlay.open()
    })

    this.events.once('shutdown', () => {
      const game = window.__game
      game?._modeSelectOverlay?.close()
      if (game) game._modeSelectOverlay = null
    })
  }
}

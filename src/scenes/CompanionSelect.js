// CompanionSelect — the "choose your dungeon keeper" scene.
//
// Sits between MainMenu's NEW EVIL and the ArchetypeSelect boss picker.
// The player picks which companion (Lilith or Malakor) will run their
// dungeon for the upcoming run. Like MainMenu under the DOM HUD, this
// scene is a thin Phaser shell — all the visuals + interaction live in
// the DOM overlay `src/hud/CompanionSelectOverlay.js`. The Phaser scene
// just keeps the title music going and owns the overlay's lifecycle.

import { TitleMusic } from '../systems/TitleMusic.js'

export class CompanionSelect extends Phaser.Scene {
  constructor() {
    super('CompanionSelect')
  }

  create() {
    // Title music carries continuously across MainMenu → CompanionSelect
    // → ArchetypeSelect; ensurePlaying is idempotent.
    TitleMusic.ensurePlaying(this)

    // CompanionSelect replaces the title screen in the nav flow — the
    // MainMenu scene was started-over (not stopped) by `game.scene.start`,
    // so stop it now. Leaving it active runs a redundant empty scene
    // underneath this one. Its shutdown handler tears down the (already
    // closed) MainMenuOverlay cleanly.
    if (this.scene.isActive('MainMenu')) this.scene.stop('MainMenu')

    import('../hud/CompanionSelectOverlay.js').then(({ CompanionSelectOverlay }) => {
      if (!this.scene.isActive()) return
      const game = window.__game
      if (game._companionSelectOverlay) game._companionSelectOverlay.close()
      game._companionSelectOverlay = new CompanionSelectOverlay(this)
      game._companionSelectOverlay.open()
    })

    this.events.once('shutdown', () => {
      const game = window.__game
      game?._companionSelectOverlay?.close()
      if (game) game._companionSelectOverlay = null
    })
  }
}

// Phase 31F — EndOfDay orchestrator.
//
// Was a full-screen newspaper + mechanic-offer scene; now a thin pass-
// through controller that drives the Post-Wave Summary -> Dark Pact ->
// NightPhase chain. The popups themselves live in HudScene.
//
// Lifecycle:
//   DayPhase ends -> scene.start('EndOfDay', { gameState, daySnapshot })
//   EndOfDay emits SHOW_POST_WAVE_SUMMARY { snapshot } so HudScene
//     opens the Post-Wave Summary popup.
//   On POST_WAVE_CONTINUE: if the boss leveled up during the day,
//     emit SHOW_DARK_PACT to open the Dark Pact popup. Otherwise go
//     straight to NightPhase.
//   On DARK_PACT_SEALED: save and start NightPhase.

import { SaveSystem }   from '../systems/SaveSystem.js'
import { EventBus }     from '../systems/EventBus.js'
import { PauseManager } from '../systems/PauseManager.js'

export class EndOfDay extends Phaser.Scene {
  constructor() {
    super('EndOfDay')
    this._gameState   = null
    this._daySnapshot = null
    this._listeners   = []
  }

  init(data) {
    this._gameState   = data?.gameState   ?? this.scene.get('Game')?.gameState
    this._daySnapshot = data?.daySnapshot ?? null
  }

  create() {
    // Esc opens pause menu — keeps existing behavior.
    this.input.keyboard?.on('keydown-ESC', () => PauseManager.toggle(this))

    const onContinue = () => {
      const startLv = this._daySnapshot?.bossLevel ?? this._gameState.boss?.level ?? 1
      const nowLv   = this._gameState.boss?.level ?? 1
      // Boss leveled up during the day → offer Dark Pact.
      if (nowLv > startLv) {
        EventBus.emit('SHOW_DARK_PACT')
        return
      }
      this._goToNight()
    }
    const onPactSealed = () => this._goToNight()

    EventBus.on('POST_WAVE_CONTINUE', onContinue)
    EventBus.on('DARK_PACT_SEALED',   onPactSealed)
    this._listeners.push(['POST_WAVE_CONTINUE', onContinue])
    this._listeners.push(['DARK_PACT_SEALED',   onPactSealed])

    // Kick off the chain — HudScene listens and opens the popup.
    EventBus.emit('SHOW_POST_WAVE_SUMMARY', { snapshot: this._daySnapshot })
  }

  shutdown() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
  }

  _goToNight() {
    SaveSystem.save(this._gameState)
    this.scene.start('NightPhase', { gameState: this._gameState })
  }
}

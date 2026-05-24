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
    // Phaser doesn't auto-invoke shutdown() on the user scene class —
    // it only fires a SHUTDOWN event. Bind it once so our cleanup
    // runs on scene.stop(). See Game.create() for the longer
    // explanation. The defensive listener strip below is still useful
    // because Phaser CAN re-run create() without firing shutdown when
    // scene.restart is used, but the binding closes the main leak.
    this.events.once('shutdown', this.shutdown, this)
    // Defensive cleanup — Phaser scene.start / scene.restart can re-run
    // create() without firing shutdown first, leaving stale EventBus
    // listeners from a previous EndOfDay session. Strip any existing
    // tracked listeners before wiring fresh ones so we never end up with
    // two onContinue / onLevelUpDismissed / onPactSealed handlers running
    // for the same event (which manifests as the chain firing the SHOW_*
    // events twice and skipping past the popups).
    if (this._listeners?.length) {
      for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    }
    this._listeners = []

    // Esc opens pause menu — keeps existing behavior.
    this.input.keyboard?.on('keydown-ESC', () => PauseManager.toggle(this))

    // Build the level-up queue up front so we drain one popup per level
    // when the boss climbed multiple levels in a single day. Each entry:
    //   { fromLevel, toLevel }
    const startLv = this._daySnapshot?.bossLevel ?? this._gameState.boss?.level ?? 1
    const nowLv   = this._gameState.boss?.level ?? 1
    this._levelUpQueue = []
    for (let lv = startLv; lv < nowLv; lv++) {
      this._levelUpQueue.push({ fromLevel: lv, toLevel: lv + 1 })
    }

    const onContinue = () => {
      // Drain level-up popups first; only after all are dismissed do we
      // proceed to the Dark Pact gate (or straight to night).
      if (this._levelUpQueue.length > 0) {
        const next = this._levelUpQueue.shift()
        EventBus.emit('SHOW_BOSS_LEVEL_UP', next)
        return
      }
      this._afterLevelUps()
    }
    const onLevelUpDismissed = () => {
      // Either show the next queued level-up or finish.
      if (this._levelUpQueue.length > 0) {
        const next = this._levelUpQueue.shift()
        EventBus.emit('SHOW_BOSS_LEVEL_UP', next)
        return
      }
      this._afterLevelUps()
    }
    const onPactSealed = () => {
      // The boss gets one Dark Pact pick per level gained — if more are
      // still owed, open the next pact book. Deferred a beat so it opens
      // AFTER the sealed picker has finished its close animation and torn
      // itself down (DARK_PACT_SEALED fires just before that teardown).
      if ((this._pactPicksRemaining ?? 0) > 0) {
        this._pactPicksRemaining--
        this.time.delayedCall(600, () => EventBus.emit('SHOW_DARK_PACT'))
        return
      }
      this._goToNight()
    }

    EventBus.on('POST_WAVE_CONTINUE',       onContinue)
    EventBus.on('BOSS_LEVEL_UP_DISMISSED',  onLevelUpDismissed)
    EventBus.on('DARK_PACT_SEALED',         onPactSealed)
    this._listeners.push(['POST_WAVE_CONTINUE',      onContinue])
    this._listeners.push(['BOSS_LEVEL_UP_DISMISSED', onLevelUpDismissed])
    this._listeners.push(['DARK_PACT_SEALED',        onPactSealed])

    // Kick off the chain — HudScene listens and opens the popup.
    EventBus.emit('SHOW_POST_WAVE_SUMMARY', { snapshot: this._daySnapshot })
  }

  // After every queued level-up has been dismissed, open the Dark Pact
  // gate — one pact pick per level the boss gained today. A multi-level
  // day picks multiple pacts, one book after another (see onPactSealed).
  _afterLevelUps() {
    const startLv = this._daySnapshot?.bossLevel ?? this._gameState.boss?.level ?? 1
    const nowLv   = this._gameState.boss?.level ?? 1
    this._pactPicksRemaining = Math.max(0, nowLv - startLv)
    if (this._pactPicksRemaining > 0) {
      this._pactPicksRemaining--
      EventBus.emit('SHOW_DARK_PACT')
      return
    }
    this._goToNight()
  }

  shutdown() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
  }

  _goToNight() {
    // Auto-save gated by SettingsOverlay GAMEPLAY > AUTOSAVE toggle.
    let _autosaveOn = true
    try { _autosaveOn = localStorage.getItem('qf.gameplay.autosave') !== 'false' } catch {}
    if (_autosaveOn) SaveSystem.save(this._gameState)
    this.scene.start('NightPhase', { gameState: this._gameState })
  }
}

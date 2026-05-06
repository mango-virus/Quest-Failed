// DarkDealDemonRenderer — paints + animates the Dark Deal demon NPC in
// the boss room during a Dark Deal night. EventSystem decides *when*
// the demon should be present; this renderer owns the sprite, the
// click-to-trade flow, and the appear/idle/leave animation states.
//
// Lifecycle:
//   NIGHT_PHASE_BEGAN with dark_deal scheduled  → spawn (appear → idle)
//   click on demon                              → emit SHOW_DARK_PACT
//   PACT_SEALED while present                   → flag accepted, play leave
//   DARK_PACT_SEALED with no mechanic           → play leave (no penalty)
//   DAY_PHASE_BEGAN with demon still on screen  → play leave (no penalty)
//
// Boss-HP halving for the next day (the cost of accepting) is owned by
// EventSystem._applyEffect/clearEffect — this renderer only signals
// acceptance via `_eventFlags.darkDealAccepted`.

import { EventBus } from '../systems/EventBus.js'

const TILE = 32

export class DarkDealDemonRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprite    = null

    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('NIGHT_PHASE_BEGAN', this._onNightPhaseBegan)
    on('DAY_PHASE_BEGAN',   this._onDayPhaseBegan)
    on('PACT_SEALED',       this._onPactSealed)
    on('DARK_PACT_SEALED',  this._onDarkPactSealed)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    this._teardown()
  }

  _onNightPhaseBegan() {
    const ev = this._gameState.events ?? {}
    if (ev.scheduledId !== 'dark_deal') return
    this._spawnDemon()
  }

  _onDayPhaseBegan() {
    // Day starts. If the demon is still here, the player let the offer
    // expire — play the leave animation and clean up. No HP penalty
    // (handled by EventSystem reading _eventFlags.darkDealAccepted).
    if (this._sprite && !this._leaving) this._playLeaveAndDestroy()
  }

  _onPactSealed({ mechanicId }) {
    // Player picked a pact while the demon was present → accept the deal.
    if (!this._sprite || this._leaving) return
    if (!mechanicId) return
    this._gameState._eventFlags ??= {}
    this._gameState._eventFlags.darkDealAccepted = true
    this._playLeaveAndDestroy()
  }

  _onDarkPactSealed({ mechanicId } = {}) {
    // Fired even when the player closes the popup without picking
    // (mechanicId === null). Treat that as a polite refusal — demon
    // leaves with no penalty. PACT_SEALED handles the accepted case
    // first; this branch is the abandon path.
    if (!this._sprite || this._leaving) return
    if (mechanicId) return  // PACT_SEALED already handled
    this._playLeaveAndDestroy()
  }

  _spawnDemon() {
    if (this._sprite) return
    const boss = this._gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!boss) return
    const cx = (boss.gridX + boss.width  / 2) * TILE
    const cy = (boss.gridY + boss.height / 2) * TILE
    const sprite = this._scene.add.sprite(cx, cy, 'event-dark-deal-demon')
      .setDepth(40)
      .setOrigin(0.5, 0.85)         // anchor near feet so the body sits above the floor
      .setInteractive({ useHandCursor: true })
    sprite.on('pointerdown', () => EventBus.emit('SHOW_DARK_PACT'))
    sprite.play('event-dark-deal-demon-appear')
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + 'event-dark-deal-demon-appear',
      () => sprite.play('event-dark-deal-demon-idle'),
    )
    this._sprite = sprite
    this._leaving = false
  }

  _playLeaveAndDestroy() {
    const s = this._sprite
    if (!s) return
    this._leaving = true
    s.disableInteractive()
    s.play('event-dark-deal-demon-leave')
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + 'event-dark-deal-demon-leave',
      () => this._teardown(),
    )
  }

  _teardown() {
    this._sprite?.destroy()
    this._sprite  = null
    this._leaving = false
  }
}

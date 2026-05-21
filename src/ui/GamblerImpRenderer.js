// GamblerImpRenderer — paints the Gambler's Coin imp NPC in the boss
// room during a Gambler's Coin night. Mirrors DarkDealDemonRenderer:
// EventSystem decides *when* the imp should be present; this renderer
// owns the sprite and the click-to-wager flow.
//
// Lifecycle:
//   NIGHT_PHASE_BEGAN / DUNGEON_EVENT_ANNOUNCED (gamblers_coin)
//                                       → spawn (T3 imp, idle)
//   click on imp                        → emit GAMBLER_IMP_CLICKED
//                                         (EventSystem shows the wager modal)
//   GAMBLER_IMP_DISMISS                 → play leave + destroy
//   DAY_PHASE_BEGAN with imp on screen  → play leave (offer expired)
//
// The wager itself (gold double/halve, coin-flip cinematic) is owned by
// EventSystem — this renderer only surfaces the imp and relays the click.

import { EventBus } from '../systems/EventBus.js'

const TILE = 32
// Rendered noticeably larger than a regular dungeon imp so the NPC reads
// as a special visitor, not a stray minion.
const IMP_SCALE = 1.7

export class GamblerImpRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprite    = null
    this._leaving   = false

    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('NIGHT_PHASE_BEGAN',       this._onNightPhaseBegan)
    on('DAY_PHASE_BEGAN',         this._onDayPhaseBegan)
    on('GAMBLER_IMP_DISMISS',     this._onDismiss)
    // Also spawn on announce — covers a Gambler's Coin forced mid-night
    // via the debug panel (fires after NIGHT_PHASE_BEGAN). _spawnImp is
    // idempotent so the normal flow never double-spawns.
    on('DUNGEON_EVENT_ANNOUNCED', this._onEventAnnounced)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    this._teardown()
  }

  _onEventAnnounced({ def } = {}) {
    if (def?.id === 'gamblers_coin') this._spawnImp()
  }

  _onNightPhaseBegan() {
    if (this._gameState.events?.scheduledId === 'gamblers_coin') this._spawnImp()
  }

  _onDayPhaseBegan() {
    // Day starts with the imp still here — the player ignored the offer.
    // It leaves with no wager (EventSystem clears `gamblerDecided` at
    // day end regardless).
    if (this._sprite && !this._leaving) this._playLeaveAndDestroy()
  }

  _onDismiss() {
    // The wager modal resolved (WAGER or DECLINE) — the imp's business
    // is done, send it off.
    if (this._sprite && !this._leaving) this._playLeaveAndDestroy()
  }

  _spawnImp() {
    if (this._sprite) return
    // Already wagered (e.g. a save reloaded after the decision) — no imp.
    if (this._gameState._eventFlags?.gamblerDecided) return
    const boss = this._gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!boss) return
    const idleTex = 'minion-imp3-idle'
    if (!this._scene.textures.exists(idleTex)) return
    const cx = (boss.gridX + boss.width  / 2) * TILE
    const cy = (boss.gridY + boss.height / 2) * TILE
    const sprite = this._scene.add.sprite(cx, cy, idleTex, 0)
      .setDepth(40)
      .setOrigin(0.5, 0.5)
      .setScale(IMP_SCALE)
      .setInteractive({ useHandCursor: true })
    const idleAnim = 'minion-imp3-idle-down'
    if (this._scene.anims.exists(idleAnim)) sprite.play(idleAnim)
    sprite.on('pointerdown', () => {
      if (this._leaving) return
      // One click only — disable so the modal can't be re-triggered.
      sprite.disableInteractive()
      EventBus.emit('GAMBLER_IMP_CLICKED')
    })
    this._sprite  = sprite
    this._leaving = false
  }

  _playLeaveAndDestroy() {
    const s = this._sprite
    if (!s) return
    this._leaving = true
    s.disableInteractive()
    // Shrink + rise + fade — the imp vanishes back out of the dungeon.
    this._scene.tweens.add({
      targets:  s,
      alpha:    0,
      y:        s.y - 20,
      scale:    IMP_SCALE * 0.55,
      duration: 460,
      ease:     'Quad.easeIn',
      onComplete: () => this._teardown(),
    })
  }

  _teardown() {
    if (this._sprite) {
      this._scene.tweens?.killTweensOf?.(this._sprite)
      this._sprite.destroy()
    }
    this._sprite  = null
    this._leaving = false
  }
}

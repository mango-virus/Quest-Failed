// DemonWagerRenderer — paints the Demon's Wager NPC in the boss room
// during a Demon's Wager night. Direct clone of GamblerImpRenderer with
// these differences:
//   • Reuses the same imp3-idle sprite (per user direction) but tints it
//     crimson so the visitor reads as "dark demon" instead of "rascal
//     gambling imp."
//   • Routes clicks through DEMON_WAGER_NPC_CLICKED → EventSystem opens
//     the wager modal (boss-level coin flip).
//
// Lifecycle mirrors the gambler imp:
//   NIGHT_PHASE_BEGAN / DUNGEON_EVENT_ANNOUNCED (demons_wager) → spawn
//   click on demon                                              → emit DEMON_WAGER_NPC_CLICKED
//   DEMON_WAGER_NPC_DISMISS                                     → leave + destroy
//   DAY_PHASE_BEGAN with demon still here                       → leave (offer expired)

import { EventBus } from '../systems/EventBus.js'

const TILE = 32
// Match the gambler imp's display scale so the two events feel
// visually parallel — same NPC, different mood.
const SCALE = 1.7
// Sinister red tint applied to the imp3 sprite so the demon reads
// distinctly from the gambler. Sprite art stays identical otherwise.
const DEMON_TINT = 0xb02838

export class DemonWagerRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprite    = null
    this._leaving   = false

    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('NIGHT_PHASE_BEGAN',       this._onNightPhaseBegan)
    on('DAY_PHASE_BEGAN',         this._onDayPhaseBegan)
    on('DEMON_WAGER_NPC_DISMISS', this._onDismiss)
    on('DUNGEON_EVENT_ANNOUNCED', this._onEventAnnounced)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    this._teardown()
  }

  _onEventAnnounced({ def } = {}) {
    if (def?.id === 'demons_wager') this._spawnDemon()
  }

  _onNightPhaseBegan() {
    if (this._gameState.events?.scheduledId === 'demons_wager') this._spawnDemon()
  }

  _onDayPhaseBegan() {
    if (this._sprite && !this._leaving) this._playLeaveAndDestroy()
  }

  _onDismiss() {
    if (this._sprite && !this._leaving) this._playLeaveAndDestroy()
  }

  _spawnDemon() {
    if (this._sprite) return
    if (this._gameState._eventFlags?.demonsWagerDecided) return
    // Refuse to materialise at boss lv 1 — EventSystem._promptDemonsWager
    // also short-circuits there, but skipping the sprite keeps the room
    // clean of a dead-click NPC.
    if ((this._gameState.boss?.level ?? 1) <= 1) return
    const boss = this._gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!boss) return
    const idleTex = 'minion-imp3-idle'
    if (!this._scene.textures.exists(idleTex)) return
    const cx = (boss.gridX + boss.width  / 2) * TILE
    const cy = (boss.gridY + boss.height / 2) * TILE
    const sprite = this._scene.add.sprite(cx, cy, idleTex, 0)
      .setDepth(40)
      .setOrigin(0.5, 0.5)
      .setScale(SCALE)
      .setTint(DEMON_TINT)
      .setInteractive({ useHandCursor: true })
    const idleAnim = 'minion-imp3-idle-down'
    if (this._scene.anims.exists(idleAnim)) sprite.play(idleAnim)
    sprite.on('pointerdown', () => {
      if (this._leaving) return
      sprite.disableInteractive()
      EventBus.emit('DEMON_WAGER_NPC_CLICKED')
    })
    this._sprite  = sprite
    this._leaving = false
  }

  _playLeaveAndDestroy() {
    const s = this._sprite
    if (!s) return
    this._leaving = true
    s.disableInteractive()
    this._scene.tweens.add({
      targets:  s,
      alpha:    0,
      y:        s.y - 20,
      scale:    SCALE * 0.55,
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

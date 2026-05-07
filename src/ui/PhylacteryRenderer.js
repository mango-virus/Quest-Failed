// PhylacteryRenderer — Phase 1b.4. Draws the Lich's heart item at its
// gameState-tracked tile with an HP bar. Listens for placement and
// destruction events so it cleans up automatically.
//
// The heart is a single floating sprite + HP bar — it does not move.

import { Balance } from '../config/balance.js'
import { EventBus } from '../systems/EventBus.js'

const TS = Balance.TILE_SIZE

export class PhylacteryRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._container = null   // Phaser container holding sprite + bar
    this._sprite    = null
    this._hpBg      = null
    this._hpFill    = null
    this._hpBarW    = 28
    this._hurtUntil = 0

    EventBus.on('PHYLACTERY_PLACED',    this._onPlaced,    this)
    EventBus.on('PHYLACTERY_DESTROYED', this._onDestroyed, this)

    // Restore on scene boot if the save already has a phylactery.
    if (gameState?.phylactery) this._spawn()
  }

  destroy() {
    EventBus.off('PHYLACTERY_PLACED',    this._onPlaced,    this)
    EventBus.off('PHYLACTERY_DESTROYED', this._onDestroyed, this)
    this._teardown()
  }

  _onPlaced() { this._spawn() }
  _onDestroyed() { this._teardown() }

  _spawn() {
    const phyl = this._gameState?.phylactery
    if (!phyl) return
    this._teardown()

    const s = this._scene
    const c = s.add.container(phyl.worldX, phyl.worldY).setDepth(7)

    // Saved phyls from before the spriteKey rename point at 'phylactery-heart'
    // which Preload never loaded; try the legacy key first, then 'heart-full'
    // (the boss-life sprite — same image used in BossTopBar), then a plain
    // rectangle if both are missing for any reason.
    const candidates = [phyl.spriteKey, 'heart-full'].filter(Boolean)
    const spriteKey  = candidates.find(k => s.textures?.exists?.(k))
    let sprite = null
    if (spriteKey) {
      sprite = s.add.sprite(0, 0, spriteKey).setOrigin(0.5).setScale(1.2)
      sprite.texture?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
    } else {
      // Fallback diamond if no heart texture is loaded.
      sprite = s.add.rectangle(0, 0, 18, 18, 0xee2255, 1).setStrokeStyle(2, 0xffaaaa, 1)
    }

    const hpY = -16
    const hpBg   = s.add.rectangle(0,                   hpY, this._hpBarW, 3, 0x220a06, 0.95).setOrigin(0.5)
    const hpFill = s.add.rectangle(-this._hpBarW / 2,   hpY, this._hpBarW, 3, 0xee5555, 1).setOrigin(0, 0.5)

    c.add([sprite, hpBg, hpFill])
    this._container = c
    this._sprite    = sprite
    this._hpBg      = hpBg
    this._hpFill    = hpFill
  }

  _teardown() {
    this._container?.destroy?.(true)
    this._container = null
    this._sprite    = null
    this._hpBg      = null
    this._hpFill    = null
  }

  // Called from the Game scene's update loop. Cheap reads.
  update() {
    const phyl = this._gameState?.phylactery
    if (!phyl) {
      if (this._container) this._teardown()
      return
    }
    if (!this._container) this._spawn()
    if (!this._container) return

    // Move container in case the room got moved (heart's room can be picked
    // up + dropped). The placement system is responsible for updating
    // phyl.tileX/tileY/worldX/worldY in that case.
    this._container.x = phyl.worldX
    this._container.y = phyl.worldY

    const max = phyl.resources?.maxHp ?? 1
    const cur = phyl.resources?.hp    ?? 0
    const frac = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0
    if (this._hpFill) this._hpFill.width = this._hpBarW * frac

    // Brief hurt flash on HP drop.
    const now = this._scene?.time?.now ?? 0
    if (this._lastHp == null) this._lastHp = cur
    if (cur < this._lastHp) {
      this._hurtUntil = now + 220
    }
    this._lastHp = cur
    if (this._sprite?.setTint) {
      if (now < this._hurtUntil) this._sprite.setTint(0xffaaaa)
      else                        this._sprite.clearTint()
    }
  }
}

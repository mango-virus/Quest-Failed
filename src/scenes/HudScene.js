import { MiniMap }       from '../ui/MiniMap.js'
import { BossHpPanel }   from '../ui/BossHpPanel.js'
import { applyUiCamera }  from '../ui/UIKit.js'

export class HudScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HudScene', active: false })
    this._miniMap     = null
    this._bossHpPanel = null
  }

  init(data) {
    this._gameScene = data?.gameScene ?? null
    this._gameState = data?.gameState ?? null
  }

  create() {
    if (!this._gameScene || !this._gameState) return
    applyUiCamera(this)
    this._miniMap     = new MiniMap(this, this._gameState, this._gameScene)
    this._bossHpPanel = new BossHpPanel(this, this._gameState)
  }

  update() {
    this._miniMap?.update()
    this._bossHpPanel?.update()
  }

  shutdown() {
    this._miniMap?.destroy();     this._miniMap     = null
    this._bossHpPanel?.destroy(); this._bossHpPanel = null
  }
}

import { MiniMap }        from '../ui/MiniMap.js'
import { BossHpPanel }    from '../ui/BossHpPanel.js'
import { AudioControls }  from '../ui/AudioControls.js'
import { applyUiCamera }  from '../ui/UIKit.js'

export class HudScene extends Phaser.Scene {
  constructor() {
    super({ key: 'HudScene', active: false })
    this._miniMap      = null
    this._bossHpPanel  = null
    this._audioControls = null
  }

  init(data) {
    this._gameScene = data?.gameScene ?? null
    this._gameState = data?.gameState ?? null
  }

  create() {
    if (!this._gameScene || !this._gameState) return
    const { width: W } = applyUiCamera(this)
    this._miniMap     = new MiniMap(this, this._gameState, this._gameScene)
    this._bossHpPanel = new BossHpPanel(this, this._gameState)
    // Audio controls — top-right corner, clear of the boss HP panel
    // (top-centre) and the mini-map (top-left).  130 wide × 24 tall.
    this._audioControls = new AudioControls(this, W - 130 - 12, 12, { depth: 60 })
  }

  update() {
    this._miniMap?.update()
    this._bossHpPanel?.update()
  }

  shutdown() {
    this._miniMap?.destroy();      this._miniMap      = null
    this._bossHpPanel?.destroy();  this._bossHpPanel  = null
    this._audioControls?.destroy(); this._audioControls = null
  }
}

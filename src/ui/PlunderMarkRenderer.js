// PlunderMarkRenderer — the floating coin-brand over heroes marked by a
// Goblin's "Mark for Plunder". While an adventurer carries `_plunderUntil`
// (set by MinionAbilities._applyPlunderMark), a gold coin bobs above their
// head so the player can see who the whole room is currently robbing. It
// also dims out in the brand's final ~600ms so the mark expiring reads.
//
// Reuses the loaded single-coin sprite (`ui-coin`); falls back to a small
// gold disc if the asset is missing. Sprites are pooled per-adventurer and
// dropped when the mark lapses or the hero dies.

import { Balance } from '../config/balance.js'
import { CRYPT }   from './UIKit.js'

const TS = Balance.TILE_SIZE
const DEPTH = 8.5          // above the entity layer so the brand is always visible
const FADE_MS = 600
const BOB_AMP = 4
const BOB_FREQ = 360       // ms per bob cycle

export class PlunderMarkRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs    = gameState
    this._marks = new Map()   // advId → { coin }
  }

  destroy() {
    for (const id of this._marks.keys()) this._drop(id)
    this._marks.clear()
  }

  _drop(id) {
    const rec = this._marks.get(id)
    if (rec) { rec.coin?.destroy?.(); this._marks.delete(id) }
  }

  _makeCoin(x, y) {
    const s = this._scene
    let coin
    if (s.textures.exists('ui-coin')) {
      coin = s.add.image(x, y, 'ui-coin').setDepth(DEPTH).setScale(0.55)
      coin.texture?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
    } else {
      coin = s.add.graphics().setDepth(DEPTH)
      coin.fillStyle(CRYPT.gold, 1); coin.fillCircle(0, 0, 4)
      coin.x = x; coin.y = y
    }
    return coin
  }

  update() {
    const advs = this._gs?.adventurers?.active ?? []
    const now  = this._scene.time?.now ?? 0
    const seen = new Set()

    for (const a of advs) {
      const live = a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0
      if (!live || !(a._plunderUntil > now)) continue
      seen.add(a.instanceId)
      const bx = a.worldX ?? 0
      const by = (a.worldY ?? 0) - TS * 0.7 + Math.sin(now / BOB_FREQ + (a.tileX + a.tileY)) * BOB_AMP
      let rec = this._marks.get(a.instanceId)
      if (!rec) { rec = { coin: this._makeCoin(bx, by) }; this._marks.set(a.instanceId, rec) }
      rec.coin?.setPosition?.(bx, by)
      // Fade out over the brand's last FADE_MS.
      const remaining = a._plunderUntil - now
      rec.coin?.setAlpha?.(remaining < FADE_MS ? Math.max(0.15, remaining / FADE_MS) : 1)
    }

    // Drop brands that lapsed / heroes that left or died.
    for (const id of [...this._marks.keys()]) if (!seen.has(id)) this._drop(id)
  }
}

// LootPileRenderer — draws the loot piles dropped by dead adventurers.
// Each pile shows a glyph matching its buff type:
//   attack  → upright sword
//   defense → kite shield
//   maxHp   → red potion bottle
//   speed   → gold-coin pyramid
// All variants share a shadow blob and a slow opacity pulse so they
// catch the player's eye without stealing focus from combat.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE
const PULSE_PERIOD_MS = 1400

// Per-buff palette
const COLORS = {
  attack:  { body: 0xc8d0e0, edge: 0x4a5266, hilt:   0x6b3a1a },   // steel sword
  defense: { body: 0x7090c8, edge: 0x2a3a5a, accent: 0xe8c34a },   // blue+gold shield
  maxHp:   { body: 0xc83a3a, edge: 0x4a1010, accent: 0xffe0e0 },   // red potion + cork
  speed:   { body: 0xe8c34a, edge: 0x6b3a1a, accent: 0xffe066 },   // gold pile
}
const SHADOW = 0x000000

export class LootPileRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._g         = scene.add.graphics().setDepth(2.5)   // below adventurers, above floor
  }

  destroy() {
    this._g?.destroy()
    this._g = null
  }

  update() {
    const piles = this._gameState.dungeon?.lootPiles ?? []
    const t     = this._scene.time.now
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin((t / PULSE_PERIOD_MS) * Math.PI))

    this._g.clear()
    for (const p of piles) {
      const cx = p.tileX * TS + TS / 2
      const cy = p.tileY * TS + TS / 2
      // Shared shadow blob
      this._g.fillStyle(SHADOW, 0.55)
      this._g.fillEllipse(cx, cy + 6, 14, 5)

      const stat   = p.buff?.stat ?? 'speed'
      const colors = COLORS[stat] ?? COLORS.speed
      switch (stat) {
        case 'attack':  this._drawSword(cx, cy, pulse, colors);  break
        case 'defense': this._drawShield(cx, cy, pulse, colors); break
        case 'maxHp':   this._drawPotion(cx, cy, pulse, colors); break
        case 'speed':   // fall through
        default:        this._drawCoinPile(cx, cy, pulse, colors)
      }
    }
  }

  // Vertical sword: blade up, hilt at the bottom, small crossguard.
  _drawSword(cx, cy, alpha, c) {
    // Blade
    this._g.fillStyle(c.body, alpha)
    this._g.fillRect(cx - 1, cy - 7, 2, 9)
    this._g.lineStyle(1, c.edge, 1)
    this._g.strokeRect(cx - 1, cy - 7, 2, 9)
    // Crossguard
    this._g.fillStyle(c.hilt ?? c.edge, 1)
    this._g.fillRect(cx - 4, cy + 2, 8, 1)
    // Grip
    this._g.fillRect(cx - 1, cy + 3, 2, 3)
    // Pommel
    this._g.fillStyle(c.edge, 1)
    this._g.fillRect(cx - 1, cy + 6, 2, 1)
  }

  // Kite shield with a vertical stripe accent.
  _drawShield(cx, cy, alpha, c) {
    this._g.fillStyle(c.body, alpha)
    this._g.fillRect(cx - 5, cy - 6, 10, 8)   // body
    this._g.fillRect(cx - 4, cy + 2, 8, 2)
    this._g.fillRect(cx - 3, cy + 4, 6, 1)
    // Outline
    this._g.lineStyle(1, c.edge, 1)
    this._g.strokeRect(cx - 5, cy - 6, 10, 8)
    this._g.strokeRect(cx - 4, cy + 2, 8, 2)
    // Gold center stripe
    this._g.fillStyle(c.accent ?? 0xe8c34a, 1)
    this._g.fillRect(cx - 1, cy - 6, 2, 9)
  }

  // Stout potion: round base, narrow neck, cork on top.
  _drawPotion(cx, cy, alpha, c) {
    // Cork
    this._g.fillStyle(c.hilt ?? 0x6b3a1a, 1)
    this._g.fillRect(cx - 2, cy - 7, 4, 2)
    // Neck
    this._g.fillStyle(c.body, alpha)
    this._g.fillRect(cx - 1, cy - 5, 2, 2)
    // Bottle body
    this._g.fillRect(cx - 4, cy - 3, 8, 7)
    this._g.lineStyle(1, c.edge, 1)
    this._g.strokeRect(cx - 4, cy - 3, 8, 7)
    this._g.strokeRect(cx - 1, cy - 5, 2, 2)
    // Highlight glint on the body
    this._g.fillStyle(c.accent ?? 0xffffff, 0.5)
    this._g.fillRect(cx - 3, cy - 2, 1, 3)
  }

  // Three-tier pyramid of coins, current default.
  _drawCoinPile(cx, cy, alpha, c) {
    this._g.fillStyle(c.body, alpha)
    this._g.fillRect(cx - 6, cy + 1, 12, 3)
    this._g.fillRect(cx - 5, cy - 2, 10, 3)
    this._g.fillRect(cx - 3, cy - 5, 6,  3)
    this._g.lineStyle(1, c.edge, 1)
    this._g.strokeRect(cx - 6, cy + 1, 12, 3)
    this._g.strokeRect(cx - 5, cy - 2, 10, 3)
    this._g.strokeRect(cx - 3, cy - 5, 6,  3)
  }
}

// TreasuryRenderer — the Treasury room sparkles with a field of golden SHINE
// twinkles scattered across its floor (the same glint the chests wear, via the
// shared `drawTwinkle`), and on TREASURY_STIPEND a shower of coins spills.
//
// (2026-06-20) The old heaped coin-hoard mound + central glow/dust/doorway-bleed
// were removed by request — the room now reads through the scattered twinkles
// alone, and per-chest shine moved to TreasureChestRenderer/KeyChestRenderer so
// EVERY chest in the dungeon glints, not just treasury ones.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { AbilityVfx } from './AbilityVfx.js'
import { drawTwinkle } from './treasureShine.js'

const TS  = Balance.TILE_SIZE

const DEPTH_COIN = 6.5    // the floor twinkles + stipend coins

export class TreasuryRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._gShine = scene.add.graphics().setDepth(DEPTH_COIN + 0.05)
    try { this._gShine.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
    EventBus.on('TREASURY_STIPEND', this._onStipend, this)
  }

  destroy() {
    EventBus.off('TREASURY_STIPEND', this._onStipend, this)
    try { this._gShine?.destroy() } catch {}
    this._gShine = null
  }

  update(delta) {
    if (!this._gShine) return
    const dt = Math.min(50, delta ?? 16) / 1000
    this._t += dt
    this._gShine.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (room.definitionId !== 'treasury' || room.isActive === false) continue
      this._drawScatteredShine(room, lod)
    }
  }

  // A field of golden twinkles scattered evenly across the room's interior
  // floor (golden-angle spread = deterministic, no per-frame RNG). Each point
  // flashes on its own stagger so the field sparkles asynchronously.
  _drawScatteredShine(room, lod) {
    const g = this._gShine
    const cx = (room.gridX + room.width / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const rx = Math.max(TS, (room.width  / 2 - 1) * TS)   // stay off the walls
    const ry = Math.max(TS, (room.height / 2 - 1) * TS)
    const count = lod ? 4 : 7
    const phaseBase = room.gridX * 0.3 + room.gridY * 0.3   // desync rooms
    for (let i = 0; i < count; i++) {
      const a   = i * 2.399963                 // golden angle → even scatter
      const rad = Math.sqrt((i + 0.5) / count) // 0 (centre) .. 1 (rim)
      const x = cx + Math.cos(a) * rx * rad
      const y = cy + Math.sin(a) * ry * rad
      drawTwinkle(g, x, y, this._t, phaseBase + i * 1.7)
    }
  }

  _onStipend({ } = {}) {
    try {
      const s = this._scene
      for (const room of (this._gameState.dungeon?.rooms ?? []).filter(r => r.definitionId === 'treasury' && r.isActive !== false)) {
        const cx = (room.gridX + room.width / 2) * TS
        const cy = (room.gridY + room.height / 2) * TS
        AbilityVfx.coinRain?.(s, cx, cy - 6, { depth: DEPTH_COIN + 0.2 })
      }
    } catch (err) {
      console.warn('[TreasuryRenderer] _onStipend failed:', err.message)
    }
  }
}

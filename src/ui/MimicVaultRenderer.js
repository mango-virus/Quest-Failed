// MimicVaultRenderer — a faint PREDATORY tell on every chest-disguised mimic
// so the PLAYER can pick it out from a real Treasury chest: a slow hungry
// dark-red underglow that breathes, and an occasional thin white TEETH-gleam
// that flashes across the lid seam (a grin). Subtle on purpose.
//
// Player-only — the adventurer AI still reads these as ordinary chests (the
// disguise is mechanical). Anchored to the mimic ENTITIES (works for the
// Mimic Vault's spawns and any placed Mimic minion). Decor-independent.

import { Balance } from '../config/balance.js'

const TS  = Balance.TILE_SIZE
const TAU = Math.PI * 2

const DEPTH_TELL = 6.2

const COL_HUNGER = 0x8a0e1a   // hungry dark red
const COL_TEETH  = 0xfff4e0   // bone-white grin gleam

export class MimicVaultRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._g = scene.add.graphics().setDepth(DEPTH_TELL)
    try { this._g.setBlendMode(Phaser.BlendModes.ADD) } catch {}
    this._t = 0
  }

  destroy() {
    try { this._g?.destroy() } catch {}
    this._g = null
  }

  update(delta) {
    if (!this._g) return
    this._t += Math.min(50, delta ?? 16) / 1000
    this._g.clear()
    const cam = this._scene.cameras?.main
    const lod = cam && cam.zoom < 0.5
    const t = this._t
    for (const m of (this._gameState.minions ?? [])) {
      if (!m.isMimic || m.mimicState !== 'chest' || m.aiState === 'dead') continue
      if (!Number.isFinite(m.worldX)) continue
      const x = m.worldX, y = m.worldY
      // hungry underglow breathing beneath the chest
      const breath = 0.5 + 0.5 * Math.sin(t * 2.0 + (m.tileX + m.tileY))
      this._g.fillStyle(COL_HUNGER, (0.10 + 0.10 * breath))
      this._g.fillEllipse(x, y + 4, 22, 12)   // ellipse-ok: hungry mimic underglow
      if (lod) continue
      // a thin teeth-gleam flashes across the lid seam now and then
      const grin = Math.sin(t * 1.3 + (m.tileX * 1.7 + m.tileY))
      if (grin > 0.9) {
        const k = (grin - 0.9) / 0.1
        const w = 8
        this._g.lineStyle(1.2, COL_TEETH, 0.85 * k)
        // a slightly bowed grin line at the lid seam
        this._g.beginPath()
        this._g.moveTo(x - w, y - 1)
        this._g.lineTo(x, y + 1.5)
        this._g.lineTo(x + w, y - 1)
        this._g.strokePath()
        // a couple of fang glints
        this._g.fillStyle(COL_TEETH, 0.9 * k)
        this._g.fillCircle(x - 3, y + 0.5, 0.7)   // circle-ok: fang glint
        this._g.fillCircle(x + 3, y + 0.5, 0.7)   // circle-ok: fang glint
      }
    }
  }
}

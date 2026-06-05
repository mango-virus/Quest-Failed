// TrapBlessRenderer — Pact of the Brand (2026-06-05).
//
// While the Brand pact is active, during the build NIGHT each placed trap shows a
// golden "BLESS" beacon (right-click a trap to bless it — its next firing deals
// 5× damage, then it breaks). The currently-blessed trap upgrades to a brighter
// "5× BLESSED" marker. Deliberately mirrors PersistentCorpseRenderer (the Undying
// Court "RAISE" beacon) so the game's interactive-pact cues read as a family.
//
// Pure visualisation — the bless pick is hit-tested in NightPhase (it emits
// BRAND_TRAP_SELECTED). Hand-rolled sin animation, no Phaser tweens (constant
// per-frame cost, zero leak surface).

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class TrapBlessRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}
  }

  destroy() {
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }

  update() {
    const gs = this._gameState
    // Only during the build NIGHT, and only while the pact is sealed.
    const active   = (gs?._mechanicFlags?.pactOfTheBrand === true) && (gs?.meta?.phase === 'night')
    const allTraps = active ? (gs?.dungeon?.traps ?? []) : []
    // One blessing per night: the moment a trap is blessed, drop the "BLESS"
    // cues on every other trap — only the chosen one keeps its marker.
    const anyBlessed = allTraps.some(t => t._brandBlessed)
    const traps  = anyBlessed ? allTraps.filter(t => t._brandBlessed) : allTraps
    const now    = this._scene?.time?.now ?? 0

    const seen = new Set()
    for (const t of traps) {
      if (!t?.instanceId || t.isTriggered) continue
      seen.add(t.instanceId)
      const blessed = !!t._brandBlessed
      let s = this._sprites[t.instanceId]
      // The blessed marker looks different from the blessable cue — rebuild on flip.
      if (s && s.blessed !== blessed) { this._destroySprite(t.instanceId); s = null }
      if (!s) s = this._createSprite(t, blessed)
      if (!s) continue
      this._animate(s, now)
    }
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  _createSprite(trap, blessed) {
    const s = this._scene
    if (!s?.add) return null
    const fp = trap.footprint ?? { w: 1, h: 1 }
    const x = (trap.tileX + fp.w / 2) * TS
    const y = (trap.tileY + fp.h / 2) * TS
    // Float above live minions so the cue reads clearly on a busy build board.
    const c = s.add.container(x, y).setDepth(8)

    // Golden ground ring around the trap (brighter/bigger for the blessed one).
    const ring = s.add.circle(0, 2, TS * (blessed ? 0.6 : 0.48), 0x000000, 0).setOrigin(0.5)
      .setStrokeStyle(blessed ? 3 : 2, 0xffcf4d, 0.9)

    // Floating beacon: a bobbing gold diamond + label (same shape language as the
    // Undying Court RAISE beacon, recoloured to "blessing" gold).
    const MY = -30
    const glow    = s.add.circle(0, MY, blessed ? 15 : 12, 0xffcf4d, blessed ? 0.34 : 0.24).setOrigin(0.5)
    const dSize   = blessed ? 13 : 11
    const diamond = s.add.rectangle(0, MY, dSize, dSize, blessed ? 0xfff0b0 : 0xffe08a)
      .setRotation(Math.PI / 4).setStrokeStyle(2, 0xb8860b, 1)
    const label = s.add.text(0, MY + 16, blessed ? '5× BLESSED' : 'BLESS', {
      fontFamily: 'monospace', fontSize: '9px',
      color: blessed ? '#fff0b0' : '#ffe08a', stroke: '#2a1e04', strokeThickness: 3,
    }).setOrigin(0.5)

    c.add([ring, glow, diamond, label])
    const rec = {
      container: c, ring, glow, diamond, label, markerY: MY, blessed,
      // Per-trap phase offset so neighbours don't pulse/bob in lockstep.
      phase: ((trap.tileX ?? 0) * 0.7 + (trap.tileY ?? 0) * 1.3) % (Math.PI * 2),
    }
    this._sprites[trap.instanceId] = rec
    return rec
  }

  // Per-frame: breathe the ground ring + bob the floating beacon so a blessable
  // trap reads as a clear, animated "right-click to bless" prompt.
  _animate(rec, now) {
    const p   = 0.5 + 0.5 * Math.sin(now * 0.004 + rec.phase)   // 0..1 breathe
    const bob = Math.sin(now * 0.005 + rec.phase) * 3           // ±3px bob
    rec.ring.setAlpha(0.5 + 0.45 * p)
    rec.ring.setScale(0.96 + 0.12 * p)
    rec.glow.y = rec.markerY + bob
    rec.glow.setScale(1.0 + 0.24 * p)
    rec.glow.setAlpha((rec.blessed ? 0.24 : 0.16) + 0.18 * p)
    rec.diamond.y = rec.markerY + bob
    rec.diamond.setScale(1.0 + 0.12 * p)
    rec.label.y = rec.markerY + 16 + bob * 0.5
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    s.container?.destroy?.(true)
    delete this._sprites[id]
  }
}

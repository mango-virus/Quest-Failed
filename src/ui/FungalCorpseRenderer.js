// FungalCorpseRenderer — Phase 1b.7 (Myconid Corpse Bloom).
//
// Reads gameState.fungalCorpses each frame and paints a green-tinted corpse
// glyph + a faint spore cloud at each corpse tile. Lifecycle (placement,
// expiry, sprout, room-removal cleanup) is owned entirely by
// BossArchetypeSystem — this renderer is pure visualisation.
//
// Animation is hand-rolled in update() — earlier versions used Phaser tweens
// with `repeat:-1, yoyo:true` plus a looping TimerEvent per corpse, which
// accumulated as corpses piled up across days and contributed to mid-game
// stalls when a vinekin sprout coincided with a spore-network day. Manual
// sin-curve animation has constant per-frame cost and zero leak surface.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

// Outward "spore release" ring spawn cadence (per corpse).
const RADIATE_INTERVAL_MS = 1600
// How long each ring takes to expand + fade out.
const RADIATE_DURATION_MS = 1200
const RADIATE_R_FROM = TS * 0.30
const RADIATE_R_TO   = TS * 0.95

export class FungalCorpseRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}
    this._lastNow   = 0
  }

  destroy() {
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }

  update() {
    const now = this._scene?.time?.now ?? 0
    const dt  = Math.max(0, Math.min(64, now - this._lastNow))
    this._lastNow = now

    const list = this._gameState?.fungalCorpses ?? []
    const seen = new Set()
    for (const c of list) {
      if (!c?.instanceId) continue
      seen.add(c.instanceId)
      let s = this._sprites[c.instanceId]
      if (!s) s = this._createSprite(c, now)
      if (!s) continue
      s.container.setPosition(
        c.tileX * TS + TS / 2,
        c.tileY * TS + TS / 2,
      )
      this._animate(s, now)
    }
    // Cull sprites whose corpse left gameState (sprout / expiry / room-remove).
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  _createSprite(corpse, now) {
    const s = this._scene
    if (!s?.add) return null
    const c = s.add.container(
      corpse.tileX * TS + TS / 2,
      corpse.tileY * TS + TS / 2,
    ).setDepth(6.5)

    // Three stacked discs — wide soft halo, mid wash, bright inner core.
    // Animated via sin curves in _animate() rather than Phaser tweens.
    const glow1 = s.add.circle(0, 0, TS * 0.85, 0x55aa44, 0.18).setOrigin(0.5)
    const glow2 = s.add.circle(0, 0, TS * 0.60, 0x88dd66, 0.32).setOrigin(0.5)
    const glow3 = s.add.circle(0, 0, TS * 0.32, 0xccff88, 0.55).setOrigin(0.5)

    // Paint the LAST frame of the dead adventurer's hurt animation tinted
    // green. Falls back to the skull glyph if the LPC texture isn't loaded.
    let glyph = null
    let sprite = null
    if (corpse.textureKey && corpse.lastHurtFrame != null
        && s.textures?.exists?.(corpse.textureKey)) {
      sprite = s.add.sprite(0, 4, corpse.textureKey, corpse.lastHurtFrame)
        .setOrigin(0.5)
        .setScale(0.55)
        .setTint(0x66ee66)
    } else {
      glyph = s.add.text(0, 0, '☠', {
        fontFamily: 'monospace', fontSize: '18px',
        color: '#88ee66', stroke: '#0a3a18', strokeThickness: 2,
      }).setOrigin(0.5)
    }

    const children = [glow1, glow2, glow3]
    if (sprite) children.push(sprite)
    if (glyph)  children.push(glyph)
    c.add(children)

    const rec = {
      container: c,
      glow1, glow2, glow3, glyph, sprite,
      // Per-corpse phase offsets so neighbours don't pulse in lockstep.
      phase1: Math.random() * Math.PI * 2,
      phase2: Math.random() * Math.PI * 2,
      phase3: Math.random() * Math.PI * 2,
      // Per-frame radiate-ring scheduling.
      nextRadiateAt: now,    // fire one immediately
      rings:         [],     // active expanding rings: { sprite, t0 }
    }
    this._sprites[corpse.instanceId] = rec
    return rec
  }

  // Per-frame animation: breathe the three glow layers via sin curves and
  // emit + tick the outward radiate rings. No Phaser tweens or timers.
  _animate(rec, now) {
    // Breathe the glow layers — each layer has its own frequency and
    // staggered phase so the corpse pulses without strobing.
    const f1 = 0.0011, f2 = 0.0017, f3 = 0.0028
    const a1 = Math.sin(now * f1 + rec.phase1)
    const a2 = Math.sin(now * f2 + rec.phase2)
    const a3 = Math.sin(now * f3 + rec.phase3)
    rec.glow1.setAlpha(0.115 + 0.065 * a1)
    rec.glow1.setScale(1.10 + 0.10 * a1)
    rec.glow2.setAlpha(0.230 + 0.090 * a2)
    rec.glow2.setScale(1.025 + 0.075 * a2)
    rec.glow3.setAlpha(0.450 + 0.150 * a3)
    rec.glow3.setScale(0.975 + 0.075 * a3)

    // Spawn a new radiate ring when the cadence elapses.
    if (now >= rec.nextRadiateAt) {
      rec.nextRadiateAt = now + RADIATE_INTERVAL_MS
      const s = this._scene
      if (s?.add && rec.container?.scene) {
        const ring = s.add.circle(0, 0, RADIATE_R_FROM, 0, 0)
        ring.setStrokeStyle(2, 0x9eee66, 0.75)
        rec.container.add(ring)
        rec.rings.push({ sprite: ring, t0: now })
      }
    }

    // Animate any active rings — expand radius + fade alpha; destroy when
    // the duration expires. Tracks via a kept-rings array rebuilt in place.
    if (rec.rings.length > 0) {
      const kept = []
      for (const r of rec.rings) {
        const t = (now - r.t0) / RADIATE_DURATION_MS
        if (t >= 1 || !r.sprite?.scene) {
          r.sprite?.destroy?.()
          continue
        }
        // Cubic ease-out for the radius growth feels like a soft puff.
        const eased = 1 - Math.pow(1 - t, 3)
        r.sprite.setRadius?.(RADIATE_R_FROM + (RADIATE_R_TO - RADIATE_R_FROM) * eased)
        r.sprite.setAlpha(0.75 * (1 - t))
        kept.push(r)
      }
      rec.rings = kept
    }
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    // Rings are children of the container — destroy(true) tears them down.
    s.container?.destroy?.(true)
    delete this._sprites[id]
  }
}

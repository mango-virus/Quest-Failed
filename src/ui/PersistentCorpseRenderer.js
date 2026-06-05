// PersistentCorpseRenderer — LEGENDARY · The Undying Court (2026-06-04).
//
// While the Undying Court pact is active, adventurers that fall during the day
// linger into the build NIGHT as revivable corpses. This renderer paints each
// corpse in `gameState.undyingCourtCorpses` as its EXACT class sprite (the same
// `adv-<class>-<variant>` LPC texture the living adventurer used), frozen on its
// death pose, dimmed, with a pulsing RED glow that signals "click me to revive".
//
// Pure visualisation — the corpse list lifecycle (capture on death, clear each
// new day, removal on revive) is owned by the pact handler + NightPhase. The
// click→revive interaction is hit-tested in NightPhase.pointerdown (consistent
// with how minions are clicked), not here.
//
// Animation is hand-rolled in update() via sin curves — constant per-frame cost
// and zero leak surface, matching FungalCorpseRenderer (the established pattern).

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

// LPC adventurer sprites render at this scale / foot-anchored origin elsewhere
// (AdventurerRenderer LPC_SCALE 0.75, origin 0.5/0.85) — match it so the night
// corpse is pixel-identical to the body that lay there during the day.
const LPC_SCALE = 0.75
const LPC_ORIGIN_Y = 0.85
// Dim, desaturated body tint so the red revival glow reads as the active cue.
const CORPSE_TINT = 0x6f6a6a

export class PersistentCorpseRenderer {
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
    const gs = this._gameState
    // Only show during the build NIGHT, and only while the pact is active.
    // During the DAY the AdventurerRenderer already shows the fresh corpse, so
    // rendering here too would double it up.
    const active = (gs?._mechanicFlags?.theUndyingCourt === true)
      && (gs?.meta?.phase === 'night')
    const list = active ? (gs?.undyingCourtCorpses ?? []) : []

    const now = this._scene?.time?.now ?? 0
    this._lastNow = now

    const seen = new Set()
    for (const c of list) {
      if (!c?.instanceId) continue
      seen.add(c.instanceId)
      let s = this._sprites[c.instanceId]
      if (!s) s = this._createSprite(c)
      if (!s) continue
      this._animate(s, now)
    }
    // Cull sprites whose corpse left the list (revived, cleared at new day,
    // or pact removed / day phase).
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  _createSprite(corpse) {
    const s = this._scene
    if (!s?.add) return null
    const x = Number.isFinite(corpse.worldX) ? corpse.worldX : corpse.tileX * TS + TS / 2
    const y = Number.isFinite(corpse.worldY) ? corpse.worldY : corpse.tileY * TS + TS / 2
    // Sit just below live minions (depth 7) — a body on the floor.
    const c = s.add.container(x, y).setDepth(6.8)

    // Ground beacon under the body — a soft violet halo + a bright pulsing ring.
    // Violet reads as necrotic and pops against the dungeon far better than the
    // old faint red wash, which the player could barely see.
    const halo = s.add.circle(0, 4, TS * 0.55, 0x8a1fd0, 0.26).setOrigin(0.5)
    const ring = s.add.circle(0, 4, TS * 0.66, 0x000000, 0).setOrigin(0.5).setStrokeStyle(2.5, 0xc24bff, 0.9)

    // Paint the class sprite, frozen on its death (hurt) pose, dimmed. Falls
    // back to a skull glyph if the LPC texture isn't registered (defensive —
    // every class is baked, so this is a should-never-happen guard).
    const texKey  = corpse.spriteVariant ? `adv-${corpse.spriteVariant.replace('/', '-')}` : null
    let sprite = null, glyph = null
    if (texKey && s.textures?.exists?.(texKey)) {
      sprite = s.add.sprite(0, 0, texKey, 0)
        .setOrigin(0.5, LPC_ORIGIN_Y)
        .setScale(LPC_SCALE)
        .setTint(CORPSE_TINT)
      // Freeze on the LAST frame of the down-facing hurt strip so the night
      // corpse matches the death pose the AdventurerRenderer left during the day.
      const hurtKey = `${texKey}-hurt-down`
      const anim = s.anims?.exists?.(hurtKey) ? s.anims.get(hurtKey) : null
      const frames = anim?.frames
      if (frames && frames.length) {
        try { sprite.setFrame(frames[frames.length - 1].frame.name) } catch { /* keep frame 0 */ }
      }
    } else {
      glyph = s.add.text(0, -6, '☠', {
        fontFamily: 'monospace', fontSize: '18px',
        color: '#e0a0ff', stroke: '#2a0a3a', strokeThickness: 2,
      }).setOrigin(0.5)
    }

    // Floating "RAISE" beacon above the head — a bobbing glowing diamond + label.
    // THE clear interact cue: a ground glow alone read as too subtle, so we add a
    // quest-marker-style prompt at eye level that bobs to draw the eye.
    const MY = -46
    const beaconGlow = s.add.circle(0, MY, 14, 0xc24bff, 0.32).setOrigin(0.5)
    const diamond    = s.add.rectangle(0, MY, 12, 12, 0xeac6ff).setRotation(Math.PI / 4).setStrokeStyle(2, 0x8a2be2, 1)
    const label      = s.add.text(0, MY + 16, 'RAISE', {
      fontFamily: 'monospace', fontSize: '9px', color: '#eac6ff', stroke: '#2a0a3a', strokeThickness: 3,
    }).setOrigin(0.5)

    const children = [halo, ring]
    if (sprite) children.push(sprite)
    if (glyph)  children.push(glyph)
    children.push(beaconGlow, diamond, label)
    c.add(children)

    const rec = {
      container: c, halo, ring, sprite, glyph, beaconGlow, diamond, label, markerY: MY,
      // Per-corpse phase offset so neighbours don't pulse/bob in lockstep.
      phase: ((corpse.tileX ?? 0) * 0.7 + (corpse.tileY ?? 0) * 1.3) % (Math.PI * 2),
    }
    this._sprites[corpse.instanceId] = rec
    return rec
  }

  // Per-frame: breathe the ground beacon + bob the floating "RAISE" marker so a
  // revivable body reads as a clear, animated "click me" prompt. Sin-curve only
  // (constant per-frame cost, no Phaser tweens).
  _animate(rec, now) {
    const p   = 0.5 + 0.5 * Math.sin(now * 0.004 + rec.phase)   // 0..1, ~1.6s breathe
    const bob = Math.sin(now * 0.005 + rec.phase) * 4           // ±4px vertical bob
    rec.halo.setAlpha(0.16 + 0.18 * p)
    rec.halo.setScale(1.0 + 0.10 * p)
    rec.ring.setAlpha(0.55 + 0.45 * p)
    rec.ring.setScale(0.96 + 0.16 * p)
    rec.beaconGlow.y = rec.markerY + bob
    rec.beaconGlow.setScale(1.0 + 0.28 * p)
    rec.beaconGlow.setAlpha(0.22 + 0.20 * p)
    rec.diamond.y = rec.markerY + bob
    rec.diamond.setScale(1.0 + 0.14 * p)
    rec.label.y = rec.markerY + 16 + bob * 0.5
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    s.container?.destroy?.(true)
    delete this._sprites[id]
  }
}

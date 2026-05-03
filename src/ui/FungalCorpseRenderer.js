// FungalCorpseRenderer — Phase 1b.7 (Myconid Corpse Bloom).
//
// Reads gameState.fungalCorpses each frame and paints a green-tinted corpse
// glyph + a faint spore cloud at each corpse tile. Lifecycle (placement,
// expiry, sprout, room-removal cleanup) is owned entirely by
// BossArchetypeSystem — this renderer is pure visualisation.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

export class FungalCorpseRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // corpseId → { container, body, glyph }
  }

  destroy() {
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }

  update() {
    const list = this._gameState?.fungalCorpses ?? []
    const seen = new Set()
    for (const c of list) {
      if (!c?.instanceId) continue
      seen.add(c.instanceId)
      let s = this._sprites[c.instanceId]
      if (!s) s = this._createSprite(c)
      if (!s) continue
      // Reposition (room move — though Myconid drops corpses on
      // ROOM_REMOVED; this just keeps the renderer honest if anyone
      // updates corpse coords directly).
      s.container.setPosition(
        c.tileX * TS + TS / 2,
        c.tileY * TS + TS / 2,
      )
    }
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  _createSprite(corpse) {
    const s = this._scene
    if (!s?.add) return null
    const c = s.add.container(
      corpse.tileX * TS + TS / 2,
      corpse.tileY * TS + TS / 2,
    ).setDepth(6.5)

    // Soft green wash beneath the corpse — read regardless of which corpse
    // glyph layer (sprite vs skull fallback) renders on top.
    const wash = s.add.circle(0, 0, TS * 0.55, 0x55aa44, 0.30).setOrigin(0.5)
    // Outer mossy ring.
    const ring = s.add.circle(0, 0, TS * 0.42, 0, 0)
    ring.setStrokeStyle(2, 0x88dd66, 0.65)

    // Phase 1b polish — paint the LAST frame of the dead adventurer's hurt
    // animation, tinted green. BossArchetypeSystem captures `textureKey` +
    // `lastHurtFrame` at corpse-creation time. If either is missing (eg. an
    // adv without an LPC sprite, or the texture failed to load), fall back
    // to the original skull-glyph stand-in.
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

    const children = [wash, ring]
    if (sprite) children.push(sprite)
    if (glyph)  children.push(glyph)
    c.add(children)
    const rec = { container: c, wash, ring, glyph, sprite }
    this._sprites[corpse.instanceId] = rec
    return rec
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    s.container.destroy(true)
    delete this._sprites[id]
  }
}

// TreasureChestRenderer — draws every Treasure Chest as a tiered pixel
// chest pinned to its tile. Each chest has a 4-frame open animation:
// frame 0 = closed (idle), frames 1–3 = opening, holds frame 3 after
// the player or an adventurer triggers the open.
//
// State lives on `gameState.dungeon.treasureChests[]` so save/load
// round-trips. AISystem flips `chest.opened = true` on theft; we react
// here by playing the matching `item-treasure-chest-<tier>-open` anim.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { drawTwinkle } from './treasureShine.js'

const TS = Balance.TILE_SIZE
// Chest sprites are 31×32 native — too small to read at game zoom.
// 1.6× keeps them readable without dwarfing the surrounding tile.
const CHEST_SCALE = 1.6

export class TreasureChestRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // chestId → Sprite
    this._glows     = {}    // chestId → Ellipse (cursed-relic aura only)
    // Shared golden SHINE twinkle, drawn each frame on every UNOPENED chest
    // (excluding mimic-disguised bait — a mimic shouldn't sparkle like real
    // loot). Additive so it reads as light on the dark dungeon.
    this._gShine = scene.add.graphics().setDepth(2.7)
    try { this._gShine.setBlendMode(Phaser.BlendModes.ADD) } catch {}

    EventBus.on('TREASURE_CHEST_OPENED', this._onChestOpened, this)
  }

  destroy() {
    EventBus.off('TREASURE_CHEST_OPENED', this._onChestOpened, this)
    for (const s of Object.values(this._sprites)) s?.destroy?.()
    for (const g of Object.values(this._glows))   g?.destroy?.()
    try { this._gShine?.destroy() } catch {}
    this._gShine = null
    this._sprites = {}
    this._glows   = {}
  }

  update() {
    const chests = this._gameState.dungeon?.treasureChests ?? []
    const seen = new Set()
    this._gShine?.clear()
    const t = (this._scene.time?.now ?? 0) / 1000
    for (const c of chests) {
      seen.add(c.instanceId)
      const cx = c.tileX * TS + TS / 2
      const cy = c.tileY * TS + TS - 2
      let s = this._sprites[c.instanceId]
      if (!s) {
        const texKey = `item-treasure-chest-${c.tier}`
        if (!this._scene.textures.exists(texKey)) continue
        // Anchor at bottom-center; chest sprite is taller than a tile.
        s = this._scene.add.sprite(cx, cy, texKey, c.opened ? 3 : 0)
          .setOrigin(0.5, 1).setDepth(2.6).setScale(CHEST_SCALE)
        this._sprites[c.instanceId] = s
      } else {
        s.setPosition(cx, cy)
      }
      // Snap to closed/open frame whenever state changes (e.g. night
      // reset). Mid-open animation is owned by _onChestOpened.
      if (!c.opened && s.anims?.currentAnim?.key?.endsWith('-open')) s.stop()
      if (!c.opened && s.frame?.name !== 0)        s.setFrame(0)
      else if (c.opened && !s.anims?.isPlaying && s.frame?.name !== 3) s.setFrame(3)

      // Golden shine on every UNOPENED chest (an emptied chest goes dark). All
      // chest ENTITIES shine — including Cursed Relic (`_cursed`) and Mimic
      // Vault bait (`_mimicCursed`); only actual mimic-MINION disguises (drawn
      // in MinionRenderer) stay un-shined. Same glint as the Treasury floor + key chests.
      if (this._gShine && !c.opened) {
        drawTwinkle(this._gShine, cx, cy - TS * 0.7, t, (c.tileX + c.tileY) * 1.3)
      }

      // Cursed Relic (event chest) + Mimic Vault cursed chest — blacken
      // the chest and pulse a purple aura under it so the curse reads
      // at a glance. The Mimic Vault chest uses the same visual but a
      // different gameplay flag (`_mimicCursed`) so the DayPhase wave-
      // doubling check stays scoped to the event chest only.
      if (c._cursed || c._mimicCursed) {
        s.setTint(0x4a2660)
        let g = this._glows[c.instanceId]
        if (!g) {
          g = this._scene.add.ellipse(cx, cy - 8, TS * 1.7, TS * 1.0, 0x9b2fe0, 0.5)
            .setDepth(2.5)
          this._glows[c.instanceId] = g
        }
        g.setPosition(cx, cy - 8)
        const now = this._scene.time?.now ?? 0
        g.setAlpha(0.28 + 0.26 * Math.sin(now / 280))
      }
    }
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) {
        this._sprites[id]?.destroy?.()
        delete this._sprites[id]
        this._glows[id]?.destroy?.()
        delete this._glows[id]
      }
    }
  }

  _onChestOpened({ chest }) {
    try {
      if (!chest) return
      const s = this._sprites[chest.instanceId]
      if (!s) return
      const animKey = `item-treasure-chest-${chest.tier}-open`
      if (this._scene.anims.exists(animKey)) {
        s.play(animKey)
      } else {
        s.setFrame(3)
      }
    } catch (err) {
      console.warn('[TreasureChestRenderer] _onChestOpened failed:', err.message)
    }
  }
}

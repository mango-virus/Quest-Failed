// Owns all visual state for `isMimic` minions. Renders the static chest
// image when disguised and animates through the state machine when active.
// Coexists with MinionRenderer — that one skips mimics in its tick so they
// don't double-render.
//
// The state machine on the minion (see MinionAISystem._tickMimic):
//   chest          – default disguise; static image; targetable as loot
//   revealing      – one-shot reveal; invulnerable; cannot move/attack
//   idle           – default active state; loops idle_<facing>
//   walking        – moving toward target; loops walk_<facing>
//   attacking      – one-shot attack1_<facing> (range >= 2) or attack2_<facing>
//   hurt           – one-shot hurt_<facing>; returns to idle
//   redisguising   – one-shot turn_into_chest; back to chest at end
//   dying          – one-shot death; last frame lingers DEATH_LINGER_MS
//                    before MinionAISystem despawns the minion
//
// Texture / anim keys:
//   `mimic-chest`              – static image
//   `mimic-<state>` (anim)     – e.g. `mimic-reveal`, `mimic-walk_left`

import { EventBus } from '../systems/EventBus.js'

const TS              = 32
const DISPLAY_SIZE    = 128   // ~4 tiles tall; sprite frames are 102x102 native
const CHEST_SIZE      = 96    // ~3 tiles wide; chest static is 99x102 native
const HURT_FLASH_MS   = 200
const PLACEHOLDER_COL = 0xb88844

export class MimicRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // instanceId → { container, image, sprite, _state, _facing, _hurtFlashUntil }

    EventBus.on('NIGHT_PHASE_STARTED', this._refreshAll, this)
    EventBus.on('MINION_DIED',         this._onMinionDied, this)
  }

  destroy() {
    EventBus.off('NIGHT_PHASE_STARTED', this._refreshAll, this)
    EventBus.off('MINION_DIED',         this._onMinionDied, this)
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }

  update() {
    const minions = this._gameState.minions ?? []
    const seen = new Set()

    for (const m of minions) {
      if (!m.isMimic) continue
      seen.add(m.instanceId)
      let s = this._sprites[m.instanceId]
      if (!s) s = this._create(m)
      this._tick(m, s)
    }

    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  _create(m) {
    const c = this._scene.add.container(m.worldX, m.worldY).setDepth(5)

    // Static chest image (only visible while state === 'chest').
    // The artist puts the chest at the BOTTOM of the 99x102 canvas
    // (opaque bbox is roughly y=83..101). With a center origin the
    // canvas center sits on the tile, but the visible chest is ~41
    // source-pixels below that — looks off-center. Shift the image up
    // by (visible-center − canvas-center) * scale so the actual chest
    // centers on the tile point.
    const image = this._scene.add.image(0, 0, 'mimic-chest').setOrigin(0.5)
    const chestScale = CHEST_SIZE / 99
    image.setScale(chestScale)
    image.y = -(92 - 51) * chestScale   // -41 source-px → upward in display-px

    // Animated sprite (only visible while state !== 'chest'). Same
    // convention — every active frame is drawn with the creature low
    // in the 102x102 canvas. Use the same vertical offset proportion as
    // the chest so the body centers on the tile too.
    const sprite = this._scene.add.sprite(0, 0, 'mimic-idle_right', 0).setOrigin(0.5)
    const spriteScale = DISPLAY_SIZE / 102
    sprite.setScale(spriteScale)
    sprite.y = -(92 - 51) * spriteScale
    sprite.setVisible(false)

    c.add([image, sprite])

    const rec = {
      container: c, image, sprite,
      _animKey: null, _hurtFlashUntil: 0, _deathLingerUntil: 0,
    }
    this._sprites[m.instanceId] = rec
    return rec
  }

  _tick(m, s) {
    s.container.setPosition(m.worldX, m.worldY)
    const state   = m.mimicState  ?? 'chest'
    const facing  = m.mimicFacing ?? 'right'

    // Chest disguise — static image only.
    if (state === 'chest') {
      s.image.setVisible(true)
      s.sprite.setVisible(false)
      s.sprite.stop()
      s._animKey = null
      s.container.setAlpha(1)
      return
    }

    // Active states — animate. Pick the anim key for the current state +
    // facing. One-shot anims are driven by MinionAISystem flipping the
    // mimicState field; the renderer just plays whichever anim matches.
    s.image.setVisible(false)
    s.sprite.setVisible(true)

    let key = null
    switch (state) {
      case 'revealing':       key = 'mimic-reveal'; break
      case 'redisguising':    key = 'mimic-turn_into_chest'; break
      case 'dying':           key = 'mimic-death'; break
      case 'idle':            key = `mimic-idle_${facing}`; break
      case 'walking':         key = `mimic-walk_${facing}`; break
      case 'hurt':            key = `mimic-hurt_${facing}`; break
      case 'attacking': {
        const variant = m.mimicAttackVariant ?? 'attack2'
        key = `mimic-${variant}_${facing}`
        break
      }
      default:
        key = `mimic-idle_${facing}`
    }

    if (key && key !== s._animKey) {
      // Validate the anim exists before playing — guards against typos
      // or unloaded sheets.
      if (this._scene.anims.exists(key)) {
        s.sprite.play(key, true)
        s._animKey = key
      } else {
        // Fallback: snap to first frame of the texture
        if (this._scene.textures.exists(key)) {
          s.sprite.setTexture(key, 0)
          s._animKey = key
        }
      }
    }

    // Hurt flash tint (red briefly, then back to white)
    const now = this._scene.time?.now ?? 0
    if (m._mimicHurtFlashAt && now - m._mimicHurtFlashAt < HURT_FLASH_MS) {
      s.sprite.setTint(0xff8866)
    } else {
      s.sprite.clearTint()
    }

    // Dying linger handled by MinionAISystem — when state stays 'dying'
    // past the death anim end, it reads m.mimicStateUntil and despawns.
    s.container.setAlpha(state === 'dying' && now > (m.mimicDeathFadeAt ?? Infinity) ? 0.4 : 1)
  }

  _onMinionDied({ minion }) {
    if (!minion?.isMimic) return
    // Death is owned by the state machine — renderer just keeps drawing
    // until the minion is spliced from gameState. No-op here.
  }

  _refreshAll() {
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    s.container.destroy(true)
    delete this._sprites[id]
  }
}

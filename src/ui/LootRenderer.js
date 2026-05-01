// Renders dropped loot items on the dungeon floor.
// Phase 7: small color-coded glyph per item rarity. Picked-up / equipped items
// hide automatically (they have no tile coords).

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE

const RARITY_COLOR = {
  common:    0xaaaaaa,
  uncommon:  0x44cc77,
  rare:      0x44aaff,
  epic:      0xcc44ee,
  legendary: 0xeeaa44,
}

const TYPE_GLYPH = {
  weapon:    '/',
  armor:     '#',
  accessory: '*',
  default:   '?',
}

export class LootRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._sprites = {}    // itemId → { container, body, label }

    EventBus.on('GEAR_DROPPED',           this._refreshOnEvent, this)
    EventBus.on('GEAR_EQUIPPED_TO_MINION', this._refreshOnEvent, this)
    EventBus.on('NIGHT_PHASE_STARTED',    this._refreshOnEvent, this)
  }

  update() {
    const items = this._gameState.loot?.dungeon ?? []
    const seen = new Set()

    for (const item of items) {
      if (item.tileX == null || item.tileY == null) continue
      seen.add(item.instanceId)
      let s = this._sprites[item.instanceId]
      if (!s) s = this._createSprite(item)
      s.container.setPosition(item.worldX, item.worldY)
    }

    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  destroy() {
    EventBus.off('GEAR_DROPPED',           this._refreshOnEvent, this)
    EventBus.off('GEAR_EQUIPPED_TO_MINION', this._refreshOnEvent, this)
    EventBus.off('NIGHT_PHASE_STARTED',    this._refreshOnEvent, this)
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _createSprite(item) {
    const def = this._scene.cache.json.get('lootDefinitions')?.find(d => d.id === item.definitionId)
    // Room redesign 2026-04-30 — Treasury chests aren't loot defs; render
    // as gold $ in a slightly larger ring to read as 'pick this up to steal'.
    const isChest = !!item._treasuryChest
    const color = isChest ? 0xeeaa44 : (RARITY_COLOR[def?.rarity] ?? RARITY_COLOR.common)
    const glyph = isChest ? '$' : (TYPE_GLYPH[def?.type] ?? TYPE_GLYPH.default)

    const c = this._scene.add.container(item.worldX, item.worldY).setDepth(5)

    // Soft glow ring (hint at rarity)
    const ring = this._scene.add.circle(0, 0, isChest ? 11 : 9, color, isChest ? 0.30 : 0.20)
    const body = this._scene.add.rectangle(0, 0, 12, 12, 0x0a0e16, 0.85)
    body.setStrokeStyle(1, color, 1)

    const label = this._scene.add.text(0, 0, glyph, {
      fontSize: '11px',
      color: `#${color.toString(16).padStart(6, '0')}`,
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5)

    c.add([ring, body, label])

    // Phase QW — Mimic disguise tell (only the boss/player sees the difference).
    // A tiny red fang glyph in the corner. To adventurers in-fiction this is just
    // the chest, but the player knows.
    if (item.isMimicSpawn) {
      const fang = this._scene.add.text(7, -7, 'M', {
        fontSize: '7px', color: '#ff6644', fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5)
      c.add(fang)
    }
    // Phase QW — cursed loot tell: faint purple halo
    if (item.cursed) {
      const curseRing = this._scene.add.circle(0, 0, 11, 0xaa44cc, 0.25)
      c.addAt(curseRing, 0)
    }

    body.setInteractive({ useHandCursor: true })
    body.on('pointerdown', (_p, _x, _y, event) => {
      event?.stopPropagation?.()
      EventBus.emit('LOOT_CLICKED', { item })
    })

    const sprite = { container: c, body, label, ring }
    this._sprites[item.instanceId] = sprite
    return sprite
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    s.container.destroy()
    delete this._sprites[id]
  }

  _refreshOnEvent() {
    // Lazy: just let the next update tick reconcile. No-op intentionally.
  }
}

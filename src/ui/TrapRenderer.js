// Renders all traps as small world-space icons at their tile.
// Phase 6b: visible to the boss/player at all times (adventurer-side visibility
// for `isKnownToAdventurers` is a Phase 8 concern).
// Triggered traps render dimmed with a "spent" mark.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE

// Per-trap-id visual style. Add an entry per new trap, or it falls back
// to `default`. Kept tiny on purpose — we'll grow it as new traps land.
const TRAP_STYLES = {
  default: { color: 0x888888, glyph: '?' },
}

export class TrapRenderer {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._sprites = {}  // id → { container, body, label, mark }

    EventBus.on('TRAP_TRIGGERED',      this._onTrapTriggered, this)
    EventBus.on('NIGHT_PHASE_STARTED', this._refreshAll,       this)
  }

  update() {
    const traps = this._gameState.dungeon.traps ?? []
    const seen = new Set()

    for (const trap of traps) {
      seen.add(trap.instanceId)
      let s = this._sprites[trap.instanceId]
      if (!s) s = this._createSprite(trap)
      s.container.setPosition(trap.worldX, trap.worldY)
      s.container.setAlpha(trap.isTriggered ? 0.35 : 1)
      s.mark.setVisible(trap.isTriggered)
      // Phase 9b: known badge — visible eye icon if any active adventurer
      // (or the shared pool) knows about this trap. Helps the boss anticipate
      // which traps will be avoided.
      const known = this._isKnown(trap)
      s.knownBadge.setVisible(known && !trap.isTriggered)
      // Phase 9 — Pact of the Brand: blessed trap gets a pulsing gold halo.
      if (trap._brandBlessed && !trap.isTriggered) {
        if (!s.brandHalo) {
          s.brandHalo = this._scene.add.graphics().setDepth(5)
          s.container.add(s.brandHalo)
          s.brandHalo.lineStyle(2, 0xffd166, 1)
          s.brandHalo.strokeCircle(0, 0, 11)
          s.brandHalo.lineStyle(1, 0xfff4a8, 0.8)
          s.brandHalo.strokeCircle(0, 0, 14)
        }
        s.brandHalo.setVisible(true)
      } else if (s.brandHalo) {
        s.brandHalo.setVisible(false)
      }
    }

    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  _isKnown(trap) {
    if (trap.isKnownToAdventurers) return true
    const sharedKnown = this._gameState.sharedKnowledge?.traps?.[trap.instanceId]
    if (sharedKnown) return true
    for (const adv of this._gameState.adventurers?.active ?? []) {
      if (adv.knowledge?.traps?.[trap.instanceId]?.accurate) return true
    }
    return false
  }

  destroy() {
    EventBus.off('TRAP_TRIGGERED',      this._onTrapTriggered, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._refreshAll,       this)
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }

  _createSprite(trap) {
    const style = TRAP_STYLES[trap.definitionId] ?? TRAP_STYLES.default
    const c = this._scene.add.container(trap.worldX, trap.worldY).setDepth(4)

    const body = this._scene.add.rectangle(0, 0, 12, 12, 0x000000, 0.45)
    body.setStrokeStyle(1, style.color, 1)

    const label = this._scene.add.text(0, 0, style.glyph, {
      fontSize: '11px',
      color: `#${style.color.toString(16).padStart(6, '0')}`,
      fontFamily: 'monospace',
      fontStyle: 'bold',
    }).setOrigin(0.5)

    // "Spent" diagonal slash for triggered traps
    const mark = this._scene.add.graphics()
    mark.lineStyle(1, 0xffffff, 0.6)
    mark.beginPath(); mark.moveTo(-7, -7); mark.lineTo(7, 7); mark.strokePath()
    mark.setVisible(false)

    // Phase 9b: known-badge (small eye-glyph) shown when an active adventurer
    // has this trap in their knowledge map. The boss can plan around it.
    const knownBadge = this._scene.add.text(8, -8, '👁', {
      fontSize: '8px', color: '#ffaa44', fontFamily: 'monospace',
    }).setOrigin(0.5).setVisible(false)

    c.add([body, label, mark, knownBadge])

    const sprite = { container: c, body, label, mark, knownBadge }
    this._sprites[trap.instanceId] = sprite
    return sprite
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    s.container.destroy()
    delete this._sprites[id]
  }

  _onTrapTriggered({ trap }) {
    const s = this._sprites[trap?.instanceId]
    if (!s) return
    s.mark.setVisible(true)
    s.container.setAlpha(0.35)
  }

  _refreshAll() {
    for (const id of Object.keys(this._sprites)) {
      const s = this._sprites[id]
      const trap = this._gameState.dungeon.traps.find(t => t.instanceId === id)
      if (!trap) continue
      s.container.setAlpha(trap.isTriggered ? 0.35 : 1)
      s.mark.setVisible(trap.isTriggered)
    }
  }
}

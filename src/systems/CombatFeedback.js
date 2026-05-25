// CombatFeedback — visual feedback for every combat hit:
//   1. Floating damage number above the target's head (drifts up + fades)
//   2. Brief white tint flash on the target's sprite
//
// Listens to COMBAT_HIT (emitted by CombatSystem). Resolves the target
// by instanceId across the three target pools (adventurers / minions /
// boss) and pulls worldX/worldY for the floating text anchor + the
// matching sprite from the renderers for the tint flash.
//
// Colour coding:
//   • adv hit by minion (player damaging adv) → white text, "good hit"
//   • minion hit by adv  (player taking damage) → red text, "bad hit"
//   • boss  hit by adv  (player taking damage) → red text
//   • crits get larger gold text in either direction

import { EventBus }     from './EventBus.js'
import { AbilityVfx }   from '../ui/AbilityVfx.js'

const HEAD_OFFSET = 18   // px above target.worldY for the floating text
const FLASH_MS    = 90
// Per-target throttle window. At peak day-N combat a single target can
// eat 5-10 hits/sec from multiple attackers; the early hits already gave
// the player the kinetic feedback, and stacking text + tweens past that
// just burns frame time. 150ms keeps a steady cadence on a heavily-hit
// target without flooding Phaser's tween/text pool. Crits BYPASS the
// throttle so they always read.
const TARGET_VFX_THROTTLE_MS = 150

export class CombatFeedback {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('COMBAT_HIT', this._onCombatHit)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
  }

  _onCombatHit({ sourceId, targetId, damage, isCritical }) {
    if (!targetId) return
    if (typeof damage !== 'number' || damage <= 0) return  // misses / dodges silent

    const target = this._findEntity(targetId)
    if (!target) return
    // Per-target throttle. Skip ordinary hits arriving inside the
    // window; crits always show. Stamp lives on the entity itself (one
    // primitive field, save-safe — SaveSystem.strip ignores `_fbAt`).
    const now = this._scene.time?.now ?? 0
    if (!isCritical && now - (target._fbAt ?? -Infinity) < TARGET_VFX_THROTTLE_MS) return
    target._fbAt = now
    const source = sourceId ? this._findEntity(sourceId) : null

    // White flash on the target's sprite. setTintFill REPLACES the
    // pixels with the colour (vs setTint which multiplies — passing
    // white to setTint is a no-op since tint is multiplicative).
    const sprite = this._findSprite(targetId)
    if (sprite && sprite.setTintFill) {
      sprite.setTintFill(0xffffff)
      this._scene.time.delayedCall(FLASH_MS, () => {
        if (sprite.active && sprite.clearTint) sprite.clearTint()
      })
    }

    // Floating damage number above the target's head. Colour is keyed
    // by who got hit (player-side targets bleed red; adventurers take
    // white; crits override to gold either way).
    const wx = target.worldX
    const wy = target.worldY
    if (typeof wx !== 'number' || typeof wy !== 'number') return
    const playerSideHit = this._isPlayerSide(target)
    const color = isCritical ? '#ffd966'
                : playerSideHit ? '#ff7777'
                : '#ffffff'
    const fontSize = isCritical ? '14px' : '12px'
    AbilityVfx.floatingText(this._scene, wx, wy - HEAD_OFFSET, String(damage), {
      color, fontSize,
      durationMs: 700,
      driftY: -32,
      depth: 90,
    })
  }

  // ── helpers ─────────────────────────────────────────────────────────

  _findEntity(id) {
    const advs = this._gameState.adventurers?.active ?? []
    const a = advs.find(x => x.instanceId === id)
    if (a) return a
    const mins = this._gameState.minions ?? []
    const m = mins.find(x => x.instanceId === id)
    if (m) return m
    const boss = this._gameState.boss
    if (boss && boss.instanceId === id) return boss
    return null
  }

  _findSprite(id) {
    const game = this._scene
    const rec = game.adventurerRenderer?._sprites?.[id]
        ?? game.minionRenderer?._sprites?.[id]
    if (rec?.image) return rec.image
    // Boss sprite — BossRenderer keeps its own field shape, fall back
    // to whatever it exposes. Optional chain so a missing renderer
    // gracefully no-ops the flash.
    const boss = game.bossRenderer
    if (boss && id && this._gameState.boss?.instanceId === id) {
      return boss._sprite ?? boss.sprite ?? null
    }
    return null
  }

  // Player-side = something the player owns (minion or boss). Used to
  // pick the red/white text colour.
  _isPlayerSide(entity) {
    if (!entity) return false
    if (entity === this._gameState.boss) return true
    return entity.faction === 'dungeon'
  }
}

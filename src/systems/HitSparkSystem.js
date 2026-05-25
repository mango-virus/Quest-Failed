// HitSparkSystem — spawns a one-shot 64×64 spark sprite at the target's
// world position on every COMBAT_HIT, color-coded by damageType.
//
// Sheet `vfx-hit-spark` is a 14-col × 9-row spritesheet; each row is one
// color variant (registered as `vfx-hit-spark-<row>` in Preload). Rows are
// laid out in the source PNG as:
//   0 orange/red, 1 pink/magenta, 2 cyan, 3 green, 4 brown/yellow,
//   5 white/silver, 6 tan, 7 crimson, 8 dark blue/purple
//
// Damage type → row mapping (DAMAGE_ROW) keeps the spark's color tied to
// the *kind* of damage rather than who's hitting whom. Anything not in
// the map (or no damageType) falls back to row 7 (crimson) which reads
// as a generic blood-tone melee impact.
//
// Master toggle: Balance.VFX_HIT_SPARKS_ENABLED (flip to false to fully
// disable the system). Misses / dodges (damage <= 0) are silent.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

// Row index per damage type. Keep in sync with the source spritesheet.
const DAMAGE_ROW = {
  physical:  7,   // crimson — blood-tone melee hit
  blood:     7,
  fire:      0,   // orange/red
  arcane:    2,   // cyan
  magic:     2,
  ice:       2,   // cyan reads as frost too
  lightning: 5,   // white/silver
  poison:    3,   // green
  nature:    3,
  holy:      5,   // white/silver
  divine:    5,
  fear:      8,   // dark blue/purple
  shadow:    8,
  dark:      8,
}

const DEFAULT_ROW = 7

// Per-target throttle window. Matches CombatFeedback's value so a
// single target doesn't accumulate two separate VFX stacks. Skipped
// hits don't visibly disappear — the spark from the most recent hit
// is still playing when the next one arrives.
const TARGET_VFX_THROTTLE_MS = 150

export class HitSparkSystem {
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

  _onCombatHit({ targetId, damage, damageType, isCritical }) {
    if (!Balance.VFX_HIT_SPARKS_ENABLED) return
    if (!targetId) return
    if (typeof damage !== 'number' || damage <= 0) return  // skip misses / dodges
    if (!this._scene.textures?.exists?.('vfx-hit-spark')) return
    // Phase 34C.5 — honor the particles=off setting by skipping the
    // spark entirely. Hit sparks are per-hit single sprites (not density-
    // scaled particles), so low/med/high all behave the same here.
    try {
      if (localStorage.getItem('qf.video.particles') === 'off') return
    } catch {}

    const target = this._findEntity(targetId)
    if (!target) return
    // Per-target throttle — skip ordinary hits inside the window; the
    // previous spark is still mid-animation and re-spawning at the same
    // tile produces no extra visual information. Crits bypass.
    const now = this._scene.time?.now ?? 0
    if (!isCritical && now - (target._sparkAt ?? -Infinity) < TARGET_VFX_THROTTLE_MS) return
    target._sparkAt = now
    const wx = target.worldX
    const wy = target.worldY
    if (typeof wx !== 'number' || typeof wy !== 'number') return

    const row = DAMAGE_ROW[damageType] ?? DEFAULT_ROW
    const animKey = `vfx-hit-spark-${row}`
    if (!this._scene.anims?.exists?.(animKey)) return

    const scale = Balance.VFX_HIT_SPARK_SCALE ?? 0.6
    // Anchor slightly above the target's foot-anchored worldY so the
    // spark lands roughly center-mass on the sprite, matching where the
    // floating damage number sits.
    const sprite = this._scene.add.sprite(wx, wy - 16, 'vfx-hit-spark')
      .setScale(scale)
      .setDepth(95)         // above units (~depth 50-80) and HP bars
    sprite.play(animKey)
    sprite.once('animationcomplete', () => {
      if (sprite.active) sprite.destroy()
    })
  }

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
}

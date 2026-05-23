// CompanionWorldFx — per-companion Phaser-side visual effects.
//
// These are subtle world-space VFX layered ON TOP of the gameplay
// rhythm so each companion leaves their own visual fingerprint on the
// dungeon. None of them affect mechanics — they're pure flavour, gated
// on `gameState.meta.companionId` so swapping companion between runs
// swaps the look without code changes elsewhere.
//
// Per companion, in this file:
//   • Lilith  — pink hearts pop above adventurers when they die. Pairs
//               with her giddy "another notch" personality.
//   • Malakor — extra purple combat-spark burst on every COMBAT_HIT, on
//               top of CombatFeedback's existing damage number. Reads
//               as "the war-priest's wrath is in the air."
//   • Zul'Gath — handled in CoinBurstRenderer (beefier coin burst) and
//               DungeonRenderer (treasury gold-haze overlay) — NOT here.
//   • Safira  — DOM-only cursor sparkles, handled in CompanionCursor —
//               also NOT here.
//
// All draws use AbilityVfx so they respect the user's particle quality
// setting (off / low / med / high) and skip cleanly if the target's
// worldX/Y aren't valid.

import { EventBus }   from './EventBus.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'

const HEART_GLYPH       = '♥'   // ♥
const HEART_COLOR_CSS   = '#ff4f9d'
const HEART_COLOR_HEX   = 0xff4f9d
const HEART_HEAD_OFFSET = 22        // px above the dead adv's body

const MALAKOR_SPARK_HEX = 0xa86bff  // matches Malakor's --npc-accent
const MALAKOR_SPARK_COUNT = 4
const MALAKOR_HIT_COOLDOWN_MS = 50  // simple throttle against attack flurries

export class CompanionWorldFx {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._listeners = []
    this._lastMalakorSpark = 0
    const on = (evt, fn) => {
      const bound = fn.bind(this)
      EventBus.on(evt, bound)
      this._listeners.push([evt, bound])
    }
    on('ADVENTURER_DIED', this._onAdventurerDied)
    on('COMBAT_HIT',      this._onCombatHit)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
  }

  _companionId() {
    return this._gameState?.meta?.companionId ?? null
  }

  // ── Lilith — hearts on adventurer death ────────────────────────────
  // Floating ♥ above the dead adv + a small pink particle burst at the
  // same spot. The adv object on the payload still has its last
  // worldX/Y (AISystem fills it pre-emit), so the heart lands on the
  // corpse and not at world (0,0).
  _onAdventurerDied(payload) {
    if (this._companionId() !== 'lilith') return
    const adv = payload?.adventurer
    if (!adv) return
    const wx = adv.worldX, wy = adv.worldY
    if (typeof wx !== 'number' || typeof wy !== 'number') return
    AbilityVfx.floatingText(this._scene, wx, wy - HEART_HEAD_OFFSET, HEART_GLYPH, {
      color:      HEART_COLOR_CSS,
      fontSize:   '16px',
      driftY:     -38,
      durationMs: 900,
      depth:      92,
    })
    AbilityVfx.particleBurst(this._scene, wx, wy - 6, {
      color:      HEART_COLOR_HEX,
      count:      6,
      speed:      40,
      durationMs: 600,
      depth:      91,
    })
  }

  // ── Malakor — extra purple sparks on every combat hit ──────────────
  // Sits next to CombatFeedback's flash+number; this just adds a small
  // purple particle puff so the air around fights glows in Malakor's
  // accent colour. Throttled so a flurry of fast attacks doesn't pile
  // up dozens of bursts on the same frame.
  _onCombatHit({ targetId, damage }) {
    if (this._companionId() !== 'malakor') return
    if (!targetId || typeof damage !== 'number' || damage <= 0) return
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now()
    if (now - this._lastMalakorSpark < MALAKOR_HIT_COOLDOWN_MS) return
    this._lastMalakorSpark = now
    const target = this._findEntity(targetId)
    if (!target) return
    const wx = target.worldX, wy = target.worldY
    if (typeof wx !== 'number' || typeof wy !== 'number') return
    AbilityVfx.particleBurst(this._scene, wx, wy - 8, {
      color:      MALAKOR_SPARK_HEX,
      count:      MALAKOR_SPARK_COUNT,
      speed:      55,
      durationMs: 420,
      depth:      89,
    })
  }

  // Same resolution pattern as CombatFeedback — adventurer, minion,
  // then boss. Combat targets all three pools so we have to as well.
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

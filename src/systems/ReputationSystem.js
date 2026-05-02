// Phase 10 — ReputationSystem.
//
// Tracks the dungeon's notoriety with the adventurers' guild. Reputation
// rises with kills, bounty postings, dungeon-level-ups, and survived days;
// it falls (slightly) on flee events (because escapees water down stories).
//
// Reputation drives:
//   - Legendary hero spawn chance in DayPhase (Phase 10): high rep ⇒ chance
//     to upgrade one daily spawn slot to "legendary" tier.
//   - Guild raid teams (Phase 10b): once rep ≥ threshold, daily spawn rolls
//     a chance to send a coordinated raid party.
//   - Low rep attracts solo scrubs (handled by spawning Phase 6+ baseline,
//     just expressed verbally in newspaper).
//
// State: `gameState.player.reputation` (number, starts 0). Persisted via
// SaveSystem because the boss object is already in gameState.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

const TIER_THRESHOLDS = [
  { tier: 'unknown',  min: 0,   label: 'Unknown' },
  { tier: 'whispered', min: 25,  label: 'Whispered About' },
  { tier: 'feared',   min: 75,  label: 'Feared' },
  { tier: 'legendary', min: 150, label: 'Legendary' },
  { tier: 'mythic',   min: 300, label: 'Mythic' },
]

export class ReputationSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._gameState.player.reputation ??= 0
    this._listeners = []

    this._wire()
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
  }

  // ── Public API ───────────────────────────────────────────────────────────

  getReputation() { return this._gameState.player.reputation }

  getTier() {
    const rep = this.getReputation()
    let cur = TIER_THRESHOLDS[0]
    for (const t of TIER_THRESHOLDS) {
      if (rep >= t.min) cur = t
    }
    return cur
  }

  // Used by DayPhase to decide whether to upgrade a spawn slot to legendary.
  legendarySpawnChance() {
    const rep = this.getReputation()
    if (rep < 75)  return 0
    if (rep < 150) return 0.10
    if (rep < 300) return 0.20
    return 0.30
  }

  // ── Internals ────────────────────────────────────────────────────────────

  _wire() {
    const onKill = () => this._add(Balance.REPUTATION_PER_KILL ?? 1, 'kill')
    const onBounty = () => this._add(5, 'bounty')
    const onDungeonLv = ({ newLevel }) => this._add(10, `dungeon_lv_${newLevel}`)
    const onDayEnded = () => this._add(Balance.REPUTATION_PER_DAY_SURVIVED ?? 5, 'day_survived')
    const onFlee = () => this._add(-1, 'flee')

    EventBus.on('COMBAT_KILL',           onKill)
    EventBus.on('MINION_BOUNTY_POSTED',  onBounty)
    EventBus.on('BOSS_LEVELED_UP',    onDungeonLv)
    EventBus.on('DAY_PHASE_ENDED',       onDayEnded)
    EventBus.on('ADVENTURER_FLED',       onFlee)
    this._listeners = [
      ['COMBAT_KILL',          onKill],
      ['MINION_BOUNTY_POSTED', onBounty],
      ['BOSS_LEVELED_UP',   onDungeonLv],
      ['DAY_PHASE_ENDED',      onDayEnded],
      ['ADVENTURER_FLED',      onFlee],
    ]
  }

  _add(delta, source) {
    const before = this.getTier().tier
    this._gameState.player.reputation = Math.max(0, this._gameState.player.reputation + delta)
    const after = this.getTier().tier
    EventBus.emit('REPUTATION_CHANGED', {
      total: this._gameState.player.reputation,
      delta,
      source,
    })
    if (before !== after) {
      EventBus.emit('REPUTATION_TIER_CHANGED', { tier: after, label: this.getTier().label })
    }
  }
}

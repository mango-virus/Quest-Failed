// Phase 7 — minion progression system.
//   • Awards XP on COMBAT_KILL (when killer is a minion)
//   • Levels minions up at curve thresholds (small stat bumps)
//   • Checks evolutionPaths from minionTypes.json against killHistory
//     and applies stat deltas + new abilities + name change on trigger
//   • Generates first-level-up names from the minion's most-frequent kill type
//   • Marks minions with `hasBounty=true` once their kill count crosses the bounty threshold
//
// Underdog 2× XP for adventurer kills lands in Phase 7b alongside adventurer
// XP/leveling — minions are the focus here.

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'

const NAME_PREFIXES = [
  'Grumbolt', 'Skarn', 'Vex', 'Mortis', 'Drath', 'Karth',
  'Ossifer', 'Bonewright', 'Crag', 'Hoarfang', 'Yoth', 'Velkar',
  'Nyx', 'Rust', 'Brackish', 'Sallow', 'Kael', 'Thorn',
]

const SUFFIX_BY_CLASS = {
  knight:          'the Knight-Slayer',
  mage:            'the Mage-Eater',
  cleric:          'the Faithbreaker',
  rogue:           'the Shadow-Snuffer',
  necromancer:     'the Soul-Crusher',
  ranger:          'the Arrow-Catcher',
  twitch_streamer: 'the Clip-Maker',
}

const SUFFIX_GENERIC = [
  'the Unyielding', 'the Patient', 'the Wretched', 'the Stalwart',
  'the Hollow', 'the Ever-Standing', 'the Bone-Whittler', 'the Marrowless',
]

export class EvolutionSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._defs = {}
    this._loaded = false

    EventBus.on('COMBAT_KILL',     this._onCombatKill,     this)
    EventBus.on('MINION_RESPAWNED', this._onMinionRespawn, this)
  }

  destroy() {
    EventBus.off('COMBAT_KILL',     this._onCombatKill,     this)
    EventBus.off('MINION_RESPAWNED', this._onMinionRespawn, this)
  }

  // Phase 7b: respawn-driven evolutions (vengeful_wraith) check after each return from death
  _onMinionRespawn({ minion }) {
    if (!this._loaded) this.loadDefinitions()
    if (!minion) return
    this._checkEvolutions(minion, {})
  }

  loadDefinitions() {
    if (this._loaded) return
    const defs = this._scene.cache.json.get('minionTypes') ?? []
    this._defs = Object.fromEntries(defs.map(d => [d.id, d]))
    this._loaded = true
  }

  // XP needed to reach a given level (lv 1 = 0, lv 2 = base, lv 3 = base * scale, ...)
  xpForLevel(level) {
    if (level <= 1) return 0
    return Math.floor(
      Balance.MINION_XP_LEVEL_BASE * Math.pow(Balance.MINION_XP_LEVEL_SCALE, level - 2)
    )
  }

  // ── Event handler ─────────────────────────────────────────────────────────

  _onCombatKill({ sourceId, targetId, damageType, method }) {
    if (!this._loaded) this.loadDefinitions()

    // Phase 7b: adventurer kills minion → adventurer XP (underdog 2×)
    const advSrc = this._gameState.adventurers.active.find(a => a.instanceId === sourceId)
    if (advSrc) {
      const ps = this._scene.personalitySystem
      const tags = ps?.getTags?.(advSrc) ?? new Set()
      const isUnderdog = tags.has('underdog')
      const baseXp = 8
      let xpMul = isUnderdog ? Balance.UNDERDOG_XP_MULT : 1

      // Phase QW — underdog_cleric_fan combo ("Believer's Boost"): if any
      // alive party-mate has the `fan` tag, the underdog's XP multiplier
      // gains an extra 50% on top of UNDERDOG_XP_MULT (2× → 3×).
      if (isUnderdog && advSrc.partyId && ps) {
        const hasFanInParty = this._gameState.adventurers.active.some(a =>
          a.partyId === advSrc.partyId &&
          a.instanceId !== advSrc.instanceId &&
          a.aiState !== 'dead' &&
          ps.getTags(a).has('fan')
        )
        if (hasFanInParty) {
          xpMul *= 1.5
          EventBus.emit('BELIEVERS_BOOST', { underdog: advSrc, finalXpMul: xpMul })
        }
      }
      this._awardAdventurerXp(advSrc, Math.round(baseXp * xpMul))
      return
    }

    // Minion kills of adventurers grant minion XP
    const minion = this._gameState.minions.find(m => m.instanceId === sourceId)
    if (!minion) return
    if (minion.faction === 'adventurer') return
    const victim = this._gameState.adventurers.graveyard.find(a => a.instanceId === targetId) ??
                   this._gameState.adventurers.active.find(a => a.instanceId === targetId)
    if (!victim) return

    const arch  = this._gameState.player?.archetypeModifiers
    const xpMul = arch?.minionXpMultiplier ?? 1
    const xp    = Math.round(Balance.MINION_XP_PER_KILL * xpMul)
    this._awardXp(minion, xp, victim)
    this._checkEvolutions(minion, { damageType, method })
    this._checkBounty(minion)
  }

  // Phase 7b: very simple adventurer XP curve (lv2 at 30, +30/lv).
  // Each level: +3 attack, +5 maxHp.
  _awardAdventurerXp(adv, amount) {
    adv.xp = (adv.xp ?? 0) + amount
    while (adv.xp >= 30 * (adv.level ?? 1)) {
      adv.level = (adv.level ?? 1) + 1
      adv.stats.attack    = (adv.stats.attack    ?? 0) + 3
      adv.resources.maxHp = (adv.resources.maxHp ?? 0) + 5
      adv.resources.hp    = Math.min(adv.resources.maxHp, adv.resources.hp + 5)
      EventBus.emit('ADVENTURER_LEVELED_UP', { adventurer: adv, newLevel: adv.level })
    }
  }

  // ── XP / Level-ups ────────────────────────────────────────────────────────

  _awardXp(minion, amount, victim) {
    minion.xp = (minion.xp ?? 0) + amount
    let levelsGained = 0

    // Loop in case multiple level-ups happen (high XP spike)
    while (minion.xp >= this.xpForLevel((minion.level ?? 1) + 1)) {
      minion.level = (minion.level ?? 1) + 1
      this._applyLevelStats(minion)
      levelsGained++
      EventBus.emit('MINION_LEVELED_UP', { minion })

      // First level-up auto-generates a name based on kill history
      if (minion.level === 2 && !minion.name) {
        minion.name = this._generateName(minion)
        EventBus.emit('MINION_NAMED', { minion })
      }
    }
    return levelsGained
  }

  _applyLevelStats(minion) {
    minion.stats.attack  = (minion.stats.attack  ?? 0) + Balance.MINION_LEVEL_ATTACK_BONUS
    minion.resources.maxHp = (minion.resources.maxHp ?? 0) + Balance.MINION_LEVEL_HP_BONUS
    minion.resources.hp    = Math.min(minion.resources.maxHp, minion.resources.hp + Balance.MINION_LEVEL_HP_BONUS)
    if (minion.level % 2 === 0) {
      minion.stats.defense = (minion.stats.defense ?? 0) + Balance.MINION_LEVEL_DEFENSE_BONUS
    }
  }

  // ── Evolution check ───────────────────────────────────────────────────────

  _checkEvolutions(minion) {
    const def = this._defs[minion.definitionId]
    if (!def?.evolutionPaths?.length) return

    const history = minion.killHistory ?? []
    const alreadyEvolved = new Set((minion.evolutionHistory ?? []).map(e => e.id))

    for (const path of def.evolutionPaths) {
      if (alreadyEvolved.has(path.id)) continue
      if (!this._evolutionConditionMet(history, minion, path.condition)) continue
      this._applyEvolution(minion, path)
      EventBus.emit('MINION_EVOLVED', { minion, evolutionId: path.id, evolution: path })
      // Allow chained evolutions in the same kill (rare but possible)
    }
  }

  _evolutionConditionMet(history, minion, cond) {
    if (!cond) return false

    if (cond.killMethod && cond.killCount) {
      const matches = history.filter(k => k.method === cond.killMethod || k.damageType === cond.killMethod)
      return matches.length >= cond.killCount
    }
    if (cond.killedClassType && cond.killCount) {
      const matches = history.filter(k => k.targetClass === cond.killedClassType)
      return matches.length >= cond.killCount
    }
    if (cond.daysAliveWithoutKill != null) {
      const lastKillDay = history.length ? history[history.length - 1].day : null
      const days = (this._gameState.meta.dayNumber - (lastKillDay ?? 0))
      return history.length === 0 && days >= cond.daysAliveWithoutKill
    }
    if (cond.timesKilledAndRespawned != null) {
      // Phase 7b: counter is incremented in MinionAISystem.respawnAll
      return (minion.timesKilledAndRespawned ?? 0) >= cond.timesKilledAndRespawned
    }
    return false
  }

  _applyEvolution(minion, path) {
    const deltas = path.statDeltas ?? {}
    if (deltas.attack)  minion.stats.attack  = (minion.stats.attack  ?? 0) + deltas.attack
    if (deltas.defense) minion.stats.defense = (minion.stats.defense ?? 0) + deltas.defense
    if (deltas.hp) {
      minion.resources.maxHp = (minion.resources.maxHp ?? 0) + deltas.hp
      minion.resources.hp    = Math.min(minion.resources.maxHp, minion.resources.hp + deltas.hp)
    }
    if (deltas.speed) minion.stats.speed = (minion.stats.speed ?? 1) + deltas.speed

    if (path.newAbility) {
      minion.stats.abilities ??= []
      if (!minion.stats.abilities.includes(path.newAbility)) {
        minion.stats.abilities.push(path.newAbility)
      }
    }

    minion.evolutionHistory ??= []
    minion.evolutionHistory.push({
      id:         path.id,
      name:       path.name,
      day:        this._gameState.meta.dayNumber,
      flavorText: path.flavorText ?? null,
    })

    // Evolved minions take on the evolution's name as their new title
    minion.name = path.name + (minion.name ? ` (was ${minion.name})` : '')
  }

  // ── Bounty ────────────────────────────────────────────────────────────────

  _checkBounty(minion) {
    minion.bountyKillCount = (minion.bountyKillCount ?? 0) + 1
    if (!minion.hasBounty && minion.bountyKillCount >= 3) {
      minion.hasBounty = true
      EventBus.emit('MINION_BOUNTY_POSTED', { minion })
    }
  }

  // ── Name generation ───────────────────────────────────────────────────────

  _generateName(minion) {
    const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)]
    // Find the most-killed adventurer class
    const counts = {}
    for (const k of minion.killHistory ?? []) {
      counts[k.targetClass] = (counts[k.targetClass] ?? 0) + 1
    }
    let topClass = null, topCount = 0
    for (const [cls, count] of Object.entries(counts)) {
      if (count > topCount) { topClass = cls; topCount = count }
    }
    const suffix = (topClass && SUFFIX_BY_CLASS[topClass]) ??
                   SUFFIX_GENERIC[Math.floor(Math.random() * SUFFIX_GENERIC.length)]
    return `${prefix} ${suffix}`
  }
}

// Centralised minion-ability effects.
//
// Pass-1 abilities are mostly passive on-hit/on-death/on-tick effects. To keep
// the change surface small, each callsite (CombatSystem, MinionAISystem) calls
// into one of three entrypoints here:
//
//   onHit(scene, attacker, target, damage, gameState)
//     Hook from CombatSystem.tryAttack right after damage is applied.
//     Routes by attacker.definitionId to apply DoTs, lifesteal, root, etc.
//
//   onMinionDeath(scene, minion, gameState)
//     Hook from MinionAISystem._die. Currently used to credit pickpocketed
//     gold to the dungeon when the minion would have otherwise carried it
//     home.
//
//   tickEntity(entity, scene, delta)
//     Per-frame DoT / status-expiry processor. Called from AISystem (advs)
//     and MinionAISystem (minions). Applies poison/burn ticks, clears expired
//     root/stagger flags.
//
//   isRooted(entity, now), isStaggered(entity, now)
//     Quick predicates for AISystem to gate movement/combat actions.

import { AbilityVfx } from '../ui/AbilityVfx.js'
import { EventBus }   from './EventBus.js'

// ── Data-driven ability layer (Thread E) ────────────────────────────────────
// Combat abilities now live in minionTypes.json under a top-level `abilities`
// array on each type: [{ type, trigger, ...params }]. Triggers: 'onHit',
// 'onDeath', 'onTick'. Resolved by definitionId so an evolved form (zombie2,
// elder_lich, elder_slime1…) automatically runs ITS tier's abilities — which
// is how Thread D gives mid/final forms signatures the old tier-1-only family
// Sets couldn't. Movement behaviors (hide/teleport/scavenge/march) stay in
// code (tickBehavior); only buff/debuff/heal/summon/DoT effects are data.
//
// Data comes from the Phaser/sim JSON cache (scene.cache.json.get) — the same
// pattern every other system uses — lazily indexed into a definitionId→abilities
// Map on first access so we don't rebuild it per hit.
let _abilityMap = null
function _abilityMapFrom(scene) {
  if (_abilityMap) return _abilityMap
  const defs = scene?.cache?.json?.get?.('minionTypes')
  if (!Array.isArray(defs)) return null   // cache not ready yet — try again next call
  _abilityMap = new Map()
  for (const def of defs) {
    if (def?.id && Array.isArray(def.abilities) && def.abilities.length) {
      _abilityMap.set(def.id, def.abilities)
    }
  }
  return _abilityMap
}
function _abilitiesFor(entity, scene, trigger) {
  if (!entity?.definitionId) return null
  const map = _abilityMapFrom(scene)
  if (!map) return null
  const all = map.get(entity.definitionId)
  if (!all) return null
  return trigger ? all.filter(a => a.trigger === trigger) : all
}

// Family helpers — keep ability application keyed off definitionId so we can
// add new evolutions without rewiring this file. Boss-archetype mini-boss
// final forms are included so they retain their family abilities when
// summoned by BossArchetypeSystem (otherwise the evolution silently drops
// Petrify Gaze, Hellfire Brand, etc).
const RAT_IDS         = new Set(['rat1', 'rat2', 'rat3'])
const DEMON_IDS       = new Set(['demon1', 'demon2', 'demon_lord'])
const VAMPIRE_IDS     = new Set(['vampire_minion1', 'vampire_minion2', 'vampire_sovereign'])
const BEHOLDER_IDS    = new Set(['beholder1', 'beholder2', 'beholder_tyrant'])
const GOLEM_IDS       = new Set(['golem1', 'golem2', 'golem_warden'])
const GOBLIN_IDS      = new Set(['goblin1', 'goblin2', 'goblin3'])
const LIZARDMAN_IDS   = new Set(['lizardman1', 'lizardman2', 'serpent_captain'])
const SLIME_IDS       = new Set(['slime1', 'slime2', 'slime3', 'slime4'])
const GNOLL_IDS       = new Set(['gnoll1', 'gnoll2', 'gnoll_alpha'])
const ORC_IDS         = new Set(['orc1', 'orc2', 'orc_veteran'])
const GHOST_IDS       = new Set(['ghost1', 'ghost2', 'dark_wraith'])
const LICH_IDS        = new Set(['lich1', 'lich2', 'elder_lich'])
const MUSHROOM_IDS    = new Set(['mushroom1', 'mushroom2', 'myconid_stalker'])

// ── Player-facing ability/behavior text ─────────────────────────────────────
// One entry per buildable minion (Tier-1s + Mimic). BuildMenuTooltip pulls
// these straight into the hover panel so the player knows what they're
// buying without reading the source. Keep both lines short — they're side-
// scrolling text in a 270px panel with 9px font.
export const MINION_ABILITY_INFO = {
  // WIPED for the ground-up ability redesign. Repopulated per family as each
  // family's kit is locked — one entry PER TIER (not just tier-1) so the
  // BuildMenu / UPGRADE info / hover UI always show the correct current ability
  // and the next tier's ability. Mimic keeps its identity (re-added with the
  // first family pass).
  mimic: { ability: 'Devour — instantly kills any adventurer who tries to loot it.', behavior: 'Stationary Trap — disguised as a treasure chest; sits still until sprung.' },

  // ── GOBLIN — mechanic: PLUNDER (steal gold) ──────────────────────────────
  goblin1: { ability: 'Pilfer — every hit instantly banks +2g to your treasury.', behavior: 'Greed: a cheap, fragile gold faucet during invasions.' },
  goblin2: { ability: 'Pilfer (+2g/hit) + Mark for Plunder — brands a hero so EVERY minion that hits them also steals gold, plus a slow gold-bleed.', behavior: 'Greed: turns one hero into payday for the whole room.' },
  goblin3: { ability: "Pilfer + Mark + Warband's Cut (DOUBLES goblin plunder in its room) + Grand Heist — periodically brands every hero in the room at once.", behavior: 'Greed: the capstone of a goblin gold-rush dungeon.' },
}

// Family-wide resolver — maps ANY minion definitionId (including evolved
// tier-2/3 forms and boss-archetype mini-boss finals) to its family's
// player-facing ability/behavior text. Tier-1 ids hit MINION_ABILITY_INFO
// directly; evolved ids fall through the family ID sets above, since the
// on-hit / tick effects key off those same sets. Zombie / skeleton /
// plant / imp / ent / mushroom abilities are tier-1-only by design, so
// their evolutions correctly resolve to no ability text.
const _FAMILY_ABILITY_KEY = [
  [RAT_IDS, 'rat1'], [DEMON_IDS, 'demon1'], [VAMPIRE_IDS, 'vampire_minion1'],
  [BEHOLDER_IDS, 'beholder1'], [GOLEM_IDS, 'golem1'], [GOBLIN_IDS, 'goblin1'],
  [LIZARDMAN_IDS, 'lizardman1'], [SLIME_IDS, 'slime2'], [GNOLL_IDS, 'gnoll1'],
  [ORC_IDS, 'orc1'], [GHOST_IDS, 'ghost1'], [LICH_IDS, 'lich1'],
]
export function minionAbilityInfo(definitionId) {
  if (!definitionId) return null
  if (MINION_ABILITY_INFO[definitionId]) return MINION_ABILITY_INFO[definitionId]
  for (const [set, key] of _FAMILY_ABILITY_KEY) {
    if (set.has(definitionId)) return MINION_ABILITY_INFO[key] ?? null
  }
  return null
}

// Pass-2 death-trigger constants. Tuned conservatively so passive death effects
// don't dominate combat — tweak if these feel weak/strong in playtests.
const ZOMBIE_OMT_CHANCE       = 0.5     // 50% chance to rise once per fight
const ZOMBIE_OMT_REVIVE_FRAC  = 0.25    // back at 25% HP
const SKELETON_REASSEMBLE_CHANCE = 0.30 // 30% chance if another skel is in room
const SKELETON_REVIVE_FRAC    = 0.5     // back at 50% HP
const IMP_BLAST_DAMAGE        = 8       // fire AoE damage on Self-Combust
const IMP_BLAST_RADIUS_TILES  = 1.5
const SPORE_RADIUS_TILES      = 2.0
const SPORE_STAGGER_MS        = 3000

// Pass-3 behavior constants
const TS                      = 32     // tile size (matches Balance.TILE_SIZE)
const BEHOLDER_TELEPORT_MS    = 8000   // teleport interval
const ENT_PATROL_SPEED_MULT   = 0.4    // Ent's already-slow patrol gets halved

export const MinionAbilities = {

  // ── On-hit (CombatSystem.tryAttack hook) ─────────────────────────────────

  onHit(scene, attacker, target, damageDealt, gameState) {
    if (!attacker || !target || !scene) return
    const id = attacker.definitionId
    if (!id) return   // adventurer attacker — nothing to do here

    // Mimic — Greedy Bite: 5g per hit (the mimic is intentionally left as-is;
    // its Devour instakill lives in AISystem). Credited on death below.
    if (id === 'mimic') {
      attacker._stolenGold = (attacker._stolenGold ?? 0) + 5
      AbilityVfx.floatingText(scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 22, '+5g', { color: '#ffdd44' })
    }

    // Data-driven onHit abilities — runs the minion's JSON `abilities`. This is
    // now the ONLY ability path (the old family-Set blocks were wiped for the
    // ground-up redesign); each family's kit is authored per-tier in JSON.
    this.runHitAbilities(scene, attacker, target, damageDealt, gameState)

    // Goblin Mark for Plunder — GLOBAL rule: any dungeon minion that hits a
    // branded hero also steals gold for the dungeon (the whole room profits).
    this._tryMarkedSteal(scene, attacker, target, gameState)
  },

  // ── On minion dying (MinionAISystem._die pre-hook) ───────────────────────
  // Returns true if the death should be aborted (minion was revived). The
  // caller must skip the rest of its death routine when true is returned.

  onMinionDying(_scene, _minion, _gameState) {
    // Death-abort revives (zombie/skeleton) were wiped for the redesign. A
    // family that wants an on-death revive will re-introduce it as a data
    // ability with an explicit handler. For now nothing aborts a death.
    return false
  },

  // ── On minion death (MinionAISystem._die hook) ───────────────────────────

  onMinionDeath(scene, minion, gameState) {
    // Credit any pickpocketed gold to the dungeon — surviving the day banks
    // the loot, dying en route hands it back.
    if (minion?._stolenGold > 0) {
      const owed = minion._stolenGold
      minion._stolenGold = 0
      if (gameState?.player) gameState.player.gold = (gameState.player.gold ?? 0) + owed
      if (scene) AbilityVfx.floatingText(scene, minion.worldX ?? 0, (minion.worldY ?? 0) - 14, `+${owed}g`, { color: '#ffdd44' })
    }

    if (!minion) return
    const id = minion.definitionId

    // Slime Split on Death is now data-driven (split onDeath in minionTypes.json
    // on every split-capable slime tier — including the elders, which the old
    // tier-1-4-only SLIME_IDS set never covered). Handled by runDeathAbilities
    // below; the hardcoded block lived here.

    // Imp Self-Combust + Mushroom Confusion Spores are now data-driven
    // (aoeOnDeath / staggerCloud onDeath in minionTypes.json) — handled by
    // runDeathAbilities below alongside the slime/elder Split.

    // Data-driven onDeath abilities (Thread E) — split / aoe / stagger-cloud
    // authored in JSON.
    this.runDeathAbilities(scene, minion, gameState)
  },

  // ── Per-tick (AISystem + MinionAISystem hooks) ───────────────────────────

  tickEntity(entity, scene, delta) {
    if (!entity || entity.aiState === 'dead' || (entity.resources?.hp ?? 0) <= 0) return
    const now = scene?.time?.now ?? 0

    // DoT processing
    if (entity._dot && entity._dot.length > 0) {
      const remaining = []
      for (const d of entity._dot) {
        const last = d._lastTickAt ?? now
        if (now - last >= d.intervalMs) {
          d._lastTickAt = now
          d.ticksLeft -= 1
          entity.resources.hp = Math.max(0, entity.resources.hp - d.dmgPerTick)
          // Death attribution — stamp the DoT's source minion + element so
          // a poison/burn that lands the killing blow (often on a standing-
          // still adv) is credited to that minion in the graveyard. Without
          // this, _kill falls back to the 'dot' hint, which _lookupKillerName
          // can't resolve → "Unknown (physical)".
          if (d.source) entity._lastHitBy = d.source
          if (d.type)   entity._lastHitType = d.type
          if (scene) {
            const color = d.type === 'burn' ? '#ff7733' : '#88dd44'
            AbilityVfx.floatingText(scene, entity.worldX ?? 0, (entity.worldY ?? 0) - 14, `-${d.dmgPerTick}`, { color })
          }
        }
        if (d.ticksLeft > 0) remaining.push(d)
      }
      entity._dot = remaining
    }

    // Status expiry — clear flags whose deadline has passed so isRooted /
    // isStaggered cleanup happens even if the entity isn't actively queried.
    if (entity._rootedUntil && now >= entity._rootedUntil) entity._rootedUntil = 0
    if (entity._staggeredUntil && now >= entity._staggeredUntil) entity._staggeredUntil = 0
    if (entity._slowUntil && now >= entity._slowUntil) { entity._slowUntil = 0; entity._slowMult = 1 }
    if (entity._armorShredUntil && now >= entity._armorShredUntil) { entity._armorShredUntil = 0; entity._armorShred = 0 }
  },

  // ── Data-driven ability runner (Thread E) ────────────────────────────────
  // Public trigger entrypoints. Each iterates the minion's JSON `abilities`
  // (filtered by trigger) and dispatches to a handler. Designed to run
  // ALONGSIDE the legacy family-Set blocks while we migrate, then those
  // blocks get deleted and only data remains.

  // onHit data abilities — ctx carries the struck target + damage dealt.
  runHitAbilities(scene, attacker, target, damageDealt, gameState) {
    const abilities = _abilitiesFor(attacker, scene, 'onHit')
    if (!abilities) return
    for (const ab of abilities) {
      if (ab.chance != null && Math.random() >= ab.chance) continue
      if (ab.oncePerFight) {
        const key = `_abOnce_${ab.type}`
        if (attacker[key]) continue
        attacker[key] = true
      }
      this._applyHitAbility(scene, attacker, target, damageDealt, gameState, ab)
    }
  },

  // onDeath data abilities — split / aoe / stagger-cloud, etc.
  runDeathAbilities(scene, minion, gameState) {
    const abilities = _abilitiesFor(minion, scene, 'onDeath')
    if (!abilities) return
    for (const ab of abilities) {
      if (ab.chance != null && Math.random() >= ab.chance) continue
      this._applyDeathAbility(scene, minion, gameState, ab)
    }
  },

  // onTick data abilities — heal/revive/buff/contagion/summon/hazard auras.
  // Called from MinionAISystem._tickMinion (minions only). Per-ability accums
  // live in minion._abAccum keyed by ability type so intervals are independent.
  tickAbilities(minion, scene, gameState, dungeonGrid, delta) {
    if (!minion || minion.aiState === 'dead' || (minion.resources?.hp ?? 0) <= 0) return
    if (minion.faction !== 'dungeon') return
    const abilities = _abilitiesFor(minion, scene, 'onTick')
    if (!abilities) return
    minion._abAccum = minion._abAccum ?? {}
    for (const ab of abilities) {
      const iv = ab.intervalMs ?? 1000
      const k = ab.type
      minion._abAccum[k] = (minion._abAccum[k] ?? 0) + delta
      if (minion._abAccum[k] < iv) continue
      minion._abAccum[k] = 0
      this._applyTickAbility(minion, scene, gameState, dungeonGrid, ab)
    }
  },

  // Passive damage-taken multiplier queried by CombatSystem._computeDamage.
  // Sums 'damageReduction' abilities on the TARGET minion (Ent Gnarled Hide,
  // Skeleton Shieldwall). damageType-gated; shieldwall can require a same-room
  // family ally to be present.
  damageTakenMul(target, attacker, gameState, scene) {
    const abilities = _abilitiesFor(target, scene, 'passive')
    if (!abilities) return 1
    const dmgType = attacker?.damageType ?? attacker?.stats?.damageType ?? 'physical'
    let mul = 1
    for (const ab of abilities) {
      if (ab.type !== 'damageReduction') continue
      if (ab.damageType && ab.damageType !== dmgType) continue
      if (ab.requireFamilyAllyTag && gameState) {
        const has = (gameState.minions ?? []).some(m =>
          m !== target && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 &&
          m.assignedRoomId === target.assignedRoomId &&
          Array.isArray(m.tags) && m.tags.includes(ab.requireFamilyAllyTag))
        if (!has) continue
      }
      mul *= (ab.mult ?? 1)
    }
    return mul
  },

  // Effective bonus damage from buff auras the attacker is currently standing
  // in (set as a flag by the aura's onTick). Read in CombatSystem.
  // (Stored on the minion as _rallyAtkMul / _rallyDefMul.)

  // Status predicates / queries.
  isSlowed(entity, now)  { return !!(entity?._slowUntil && entity._slowUntil > (now ?? 0)) },
  slowMult(entity, now)  { return (entity?._slowUntil && entity._slowUntil > (now ?? 0)) ? (entity._slowMult ?? 1) : 1 },
  armorShredOf(entity, now) { return (entity?._armorShredUntil && entity._armorShredUntil > (now ?? 0)) ? (entity._armorShred ?? 0) : 0 },

  // ── Ability handlers ──────────────────────────────────────────────────────

  _applyHitAbility(scene, attacker, target, damageDealt, gameState, ab) {
    const now = scene?.time?.now ?? 0
    switch (ab.type) {
      case 'dot':
        this._applyDot(target, scene, {
          type: ab.element ?? 'poison', dmgPerTick: ab.dmgPerTick ?? 1,
          intervalMs: ab.intervalMs ?? 1000, ticksLeft: ab.ticks ?? 3,
          source: attacker.instanceId,
        })
        if (ab.popup !== false) AbilityVfx.floatingText(scene, target.worldX ?? 0, (target.worldY ?? 0) - 22, ab.label ?? (ab.element === 'burn' ? 'BURN' : 'POISON'), { color: ab.element === 'burn' ? '#ff7733' : '#88dd44' })
        break
      case 'slow': {
        const next = now + (ab.durationMs ?? 1500)
        // Keep the strongest (lowest) slow + the latest expiry.
        if (!target._slowUntil || target._slowUntil < next) target._slowUntil = next
        target._slowMult = Math.min(target._slowMult ?? 1, ab.mult ?? 0.6)
        AbilityVfx.floatingText(scene, target.worldX ?? 0, (target.worldY ?? 0) - 22, ab.label ?? 'SLOWED', { color: '#66ccee' })
        if (Number.isFinite(target.worldX)) AbilityVfx.pulseRing(scene, target.worldX, target.worldY, { color: 0x66ccee, fromR: 6, toR: 16, alpha: 0.7, durationMs: 400 })
        break
      }
      case 'root':
        this._applyRoot(target, scene, ab.durationMs ?? 2000)
        AbilityVfx.floatingText(scene, target.worldX ?? 0, (target.worldY ?? 0) - 22, ab.label ?? 'ROOTED', { color: '#559944' })
        if (Number.isFinite(target.worldX)) AbilityVfx.pulseRing(scene, target.worldX, target.worldY, { color: 0x559944, fromR: 6, toR: 18, alpha: 0.8, durationMs: 500 })
        break
      case 'stagger':
        this._applyStagger(target, scene, ab.durationMs ?? 1000)
        AbilityVfx.floatingText(scene, target.worldX ?? 0, (target.worldY ?? 0) - 22, ab.label ?? 'STAGGERED', { color: '#aa9988' })
        break
      case 'lifesteal': {
        if (damageDealt <= 0) break
        const heal = Math.max(1, Math.floor(damageDealt * (ab.frac ?? 0.5)))
        const before = attacker.resources.hp
        attacker.resources.hp = Math.min(attacker.resources.maxHp ?? 0, attacker.resources.hp + heal)
        const restored = attacker.resources.hp - before
        if (restored > 0) AbilityVfx.floatingText(scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 22, `+${restored}`, { color: '#ff77aa' })
        break
      }
      case 'armorShred': {
        const next = now + (ab.durationMs ?? 4000)
        target._armorShred = Math.min((target._armorShred ?? 0) + (ab.amount ?? 2), ab.max ?? 8)
        target._armorShredUntil = Math.max(target._armorShredUntil ?? 0, next)
        AbilityVfx.floatingText(scene, target.worldX ?? 0, (target.worldY ?? 0) - 22, ab.label ?? 'ARMOR SHRED', { color: '#cc8844' })
        break
      }
      case 'nerveDrain': {
        // Sorrow Wisp — "drains hope before it drains blood." Ties into the
        // adventurer NerveSystem: knock the struck adv's nerve down a step.
        if (typeof target.nerve === 'number') {
          target.nerve = Math.max(0, target.nerve - (ab.amount ?? 14))
          AbilityVfx.floatingText(scene, target.worldX ?? 0, (target.worldY ?? 0) - 22, ab.label ?? 'DESPAIR', { color: '#6688cc' })
        }
        break
      }
      // Goblin PLUNDER — Pilfer: steal gold for the treasury on every hit.
      // Doubled if a Plunder King (plunderAura) shares the attacker's room.
      case 'stealGold':
        this._grantPlunder(scene, attacker, target, gameState, ab.amount ?? 2, 'goblin_plunder')
        break
      // Goblin Mark for Plunder — brand the hero so EVERY dungeon minion that
      // hits them also steals (handled in onHit via _tryMarkedSteal) plus a
      // slow gold-bleed off the brand (ticked in tickPlunderMarks).
      case 'markForPlunder':
        this._applyPlunderMark(scene, attacker, target, ab)
        break
      default: break
    }
  },

  _applyDeathAbility(scene, minion, gameState, ab) {
    switch (ab.type) {
      case 'split':
        if (!minion._isMiniSlime && gameState?.minions) this._spawnSplitChildren(scene, minion, gameState, ab)
        break
      case 'aoeOnDeath':
        this._aoeOnDeath(scene, minion, gameState, ab)
        break
      case 'staggerCloud':
        this._staggerCloud(scene, minion, gameState, ab)
        break
      default: break
    }
  },

  _applyTickAbility(minion, scene, gameState, dungeonGrid, ab) {
    switch (ab.type) {
      case 'healAura':      this._healAura(minion, scene, gameState, ab); break
      case 'reviveAlly':    this._reviveAlly(minion, scene, gameState, ab); break
      case 'buffAura':      this._buffAura(minion, scene, gameState, ab); break
      case 'contagionAura': this._contagionAura(minion, scene, gameState, ab); break
      case 'summon':        this._summonAdd(minion, scene, gameState, ab); break
      case 'hazardTrail':   this._hazardTrail(minion, scene, gameState, ab); break
      case 'novaBurst':     this._novaBurst(minion, scene, gameState, ab); break
      case 'massMark':      this._massMark(minion, scene, gameState, ab); break
      default: break
    }
  },

  isRooted(entity, now) {
    return !!(entity?._rootedUntil && entity._rootedUntil > (now ?? 0))
  },

  isStaggered(entity, now) {
    return !!(entity?._staggeredUntil && entity._staggeredUntil > (now ?? 0))
  },

  // Pass-3 Ghost Possession — if `attacker` is currently possessed and a
  // same-party ally is within attack range, return that ally as the redirect
  // target. Otherwise returns the original `target` unchanged. Called from
  // CombatSystem.tryAttack at the start of each swing.
  maybeRedirectPossessedAttack(attacker, target, gameState, scene) {
    if (!attacker?._possessedUntil) return target
    const now = scene?.time?.now ?? 0
    if (attacker._possessedUntil <= now) return target
    if (attacker.classId === undefined) return target   // only applies to advs
    const allies = (gameState?.adventurers?.active ?? []).filter(a =>
      a !== attacker &&
      a.partyId && a.partyId === attacker.partyId &&
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0
    )
    if (!allies.length) return target
    const reach = attacker.attackRange ?? 1
    let best = null
    let bestDist = Infinity
    for (const ally of allies) {
      const d = Math.hypot(ally.tileX - attacker.tileX, ally.tileY - attacker.tileY)
      if (d > reach + 0.01) continue
      if (d < bestDist) { best = ally; bestDist = d }
    }
    return best ?? target
  },

  // Called by MinionAISystem.respawnAll to clear any per-fight one-shot flags.
  resetOneShotsForNight(minion) {
    if (!minion) return
    // Engine-state resets only (DoTs, statuses, onTick accumulators, Thread-C
    // flags, oncePerFight re-arm). Legacy per-family flags were wiped.
    minion._dot = null
    minion._rootedUntil = 0
    minion._staggeredUntil = 0
    minion._slowUntil = 0; minion._slowMult = 1
    minion._armorShredUntil = 0; minion._armorShred = 0
    minion._enraged = false              // Thread C: clear wounded-state flags
    minion._fallingBack = false
    minion._abAccum = {}                 // reset onTick ability accumulators
    // re-arm oncePerFight ability gates (keys are `_abOnce_<type>`)
    for (const k of Object.keys(minion)) { if (k.startsWith('_abOnce_')) minion[k] = false }
  },

  // Initial flag setup at spawn time. Called from createMinion (entities/Minion.js).
  // (No per-family init flags after the wipe — kept as a hook for future kits.)
  initFlags(_minion, _typeDef) {},

  // ── Internals ────────────────────────────────────────────────────────────

  _applyDot(target, scene, dot) {
    target._dot = target._dot ?? []
    target._dot.push({ ...dot, _lastTickAt: scene?.time?.now ?? 0 })
  },

  _applyRoot(target, scene, durationMs) {
    const now = scene?.time?.now ?? 0
    const next = now + durationMs
    if ((target._rootedUntil ?? 0) < next) target._rootedUntil = next
  },

  _applyStagger(target, scene, durationMs) {
    const now = scene?.time?.now ?? 0
    const next = now + durationMs
    if ((target._staggeredUntil ?? 0) < next) target._staggeredUntil = next
  },

  // ── Pass-2 spawn helpers ────────────────────────────────────────────────

  // Spawn 2 mini-slimes inheriting half the parent's stats. Mini-slimes are
  // tagged `_isMiniSlime = true` so they don't split recursively, and so
  // MinionAISystem.respawnAll can wipe them at dawn (they're temporary).
  _spawnMiniSlimes(scene, parent, gameState) {
    const px = parent.tileX
    const py = parent.tileY
    const offsets = [
      { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
      { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
      { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
      { dx: -1, dy:  1 }, { dx: 1, dy:  1 },
    ]
    let spawned = 0
    for (const off of offsets) {
      if (spawned >= 2) break
      const child = this._cloneAsMiniSlime(parent, px + off.dx, py + off.dy)
      gameState.minions.push(child)
      spawned += 1
    }
    if (scene && spawned > 0) {
      AbilityVfx.particleBurst(scene, parent.worldX ?? 0, parent.worldY ?? 0, {
        color: parent.color ?? 0x44aaff, count: 8, durationMs: 500, speed: 70,
      })
    }
  },

  _cloneAsMiniSlime(parent, tx, ty) {
    const TS = 32
    const halfHp  = Math.max(4, Math.floor((parent.resources?.maxHp ?? 12) * 0.5))
    const halfAtk = Math.max(1, Math.floor((parent.stats?.attack ?? 4) * 0.5))
    return {
      instanceId:    `min_split_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      definitionId:  parent.definitionId,
      name:          null,
      color:         parent.color,
      sigil:         parent.sigil,
      tileX:   tx,
      tileY:   ty,
      worldX:  tx * TS + TS / 2,
      worldY:  ty * TS + TS / 2,
      homeTileX: tx,
      homeTileY: ty,
      assignedRoomId: parent.assignedRoomId,
      class:          'garrison',          // room-bound, not counted toward roster cap
      behaviorType:   parent.behaviorType,
      tags:           [...(parent.tags ?? [])],
      damageType:     parent.damageType,
      attackRange:    parent.attackRange ?? 1,
      faction:        'dungeon',
      factionExpiresOn: null,
      raisedByAdvId:  null,
      tamedByAdvId:   null,
      isMiniBoss:     false,
      stats: {
        hp:      halfHp,
        attack:  halfAtk,
        defense: parent.stats?.defense ?? 0,
        speed:   parent.stats?.speed ?? 1.0,
        abilities: [],
      },
      resources: { hp: halfHp, maxHp: halfHp },
      level: 1, xp: 0,
      evolutionHistory: [], killHistory: [],
      lifetime: { kills: 0, damageDealt: 0 },
      equippedGear: [], hasBounty: false, bountyKillCount: 0,
      aiState: 'idle',
      currentTargetId: null,
      lastAttackAt: 0,
      deathDay: null,
      path: null, pathIndex: 0,
      bossLevel: parent.bossLevel ?? 1,
      _baseMaxHp: halfHp,
      _baseAtk:   halfAtk,
      _isMiniSlime: true,
    }
  },

  // Imp Self-Combust — fire AoE on death.
  _impSelfCombust(scene, imp, gameState) {
    if (!gameState?.adventurers?.active) return
    let hits = 0
    for (const adv of gameState.adventurers.active) {
      if (adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const d = Math.hypot(adv.tileX - imp.tileX, adv.tileY - imp.tileY)
      if (d > IMP_BLAST_RADIUS_TILES + 0.01) continue
      // Light Party / Shadow Monarch floor — defense-in-depth so an imp blast
      // can't drop them to 0 before the boss room (AISystem._kill catches it
      // anyway since we never stamp 'boss' here, but flooring keeps the bar honest).
      const _impFl = (adv._lightParty || adv._shadowMonarch)
        ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
      adv.resources.hp = Math.max(_impFl, adv.resources.hp - IMP_BLAST_DAMAGE)
      hits += 1
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${IMP_BLAST_DAMAGE}`, { color: '#ff6633' })
    }
    if (scene) {
      AbilityVfx.pulseRing(scene, imp.worldX ?? 0, imp.worldY ?? 0, {
        color: 0xff6633, fromR: 8, toR: IMP_BLAST_RADIUS_TILES * 32, durationMs: 350, alpha: 0.85,
      })
      AbilityVfx.particleBurst(scene, imp.worldX ?? 0, imp.worldY ?? 0, {
        color: 0xff6633, count: 14, durationMs: 600, speed: 110,
      })
      if (hits > 0) AbilityVfx.floatingText(scene, imp.worldX ?? 0, (imp.worldY ?? 0) - 22, 'BOOM', { color: '#ff8844' })
    }
  },

  // ── Pass-3 behavior dispatcher (per-tick) ───────────────────────────────
  // Called from MinionAISystem._tickMinion before the idle wander block so
  // we can override _patrolTarget, set visibility flags, fire teleports, etc.

  // Per-minion BASE-BEHAVIOR quirks (camouflage / ceiling-sleep / teleport /
  // march / demon-sense / loot-scavenger) were WIPED for the redesign — they
  // made minions "too complicated" (user). Minions now use only the engine's
  // standard movement (behaviorType guard/patrol/roam/ambush) + their data
  // abilities. Kept as a no-op hook so MinionAISystem's per-tick call is intact.
  tickBehavior(_minion, _scene, _gameState, _dungeonGrid, _delta) {},

  // Visibility filter for _pickTarget. Nothing hides post-wipe, so always
  // visible — kept so the MinionAISystem callsite needs no change.
  isMinionHidden(minion) {
    return !!minion?._hidden
  },

  // Wire global EventBus listeners. Called from Game.create after gameState/
  // dungeonGrid exist. (Previously hosted Mimic Migrate; that handler was
  // removed 2026-05-22 when mimics became stationary chest traps — see
  // AISystem._springMimic for the new mechanic. attach/detach are kept as
  // stubs so future per-system hooks can land here without re-wiring
  // MinionAISystem's create/destroy.)
  attach(_scene, _gameState, _dungeonGrid) {
    if (this._attached) return
    this._attached = true
  },

  detach() {
    if (!this._attached) return
    this._attached = false
  },

  // ── Pass-3 behavior helpers ────────────────────────────────────────────

  _tickVampireHidden(vampire, gameState) {
    // Converted thralls (charmed adventurers turned by the Vampire boss)
    // share the vampire_minion1 definition but ROAM the dungeon — they are
    // not ceiling ambushers. Keep them permanently visible; without this
    // they inherit Sleep on Ceiling and vanish whenever their room is
    // empty (e.g. all night), which reads as "the thrall never appeared".
    if (vampire._isVampireThrall) { vampire._hidden = false; return }
    // Hide while no adv is in vampire's home room (sleeping on the ceiling).
    // Reveal once any adv steps inside.
    const home = gameState?.dungeon?.rooms?.find(r => r.instanceId === vampire.assignedRoomId)
    if (!home) { vampire._hidden = false; return }
    const advInRoom = (gameState.adventurers?.active ?? []).some(a =>
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 &&
      a.tileX >= home.gridX && a.tileX < home.gridX + home.width &&
      a.tileY >= home.gridY && a.tileY < home.gridY + home.height
    )
    vampire._hidden = !advInRoom
  },

  _tickGolemHidden(golem, gameState) {
    // Hide as a "wall pillar" until any adv is within 1 tile (cardinal or diag).
    const advs = gameState?.adventurers?.active ?? []
    let close = false
    for (const a of advs) {
      if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      if (Math.abs(a.tileX - golem.tileX) <= 1 && Math.abs(a.tileY - golem.tileY) <= 1) {
        close = true
        break
      }
    }
    golem._hidden = !close
  },

  // Generic ambush handler. Used by minions whose JSON sets
  // `behaviorType: 'ambush'` (plant2, imp2). Mirrors the vampire pattern:
  // hidden while no adv is in the home room, reveals on entry. The first
  // attack after a reveal carries `_ambushBuffActive` so CombatSystem can
  // multiply damage; the flag clears on consume.
  _tickAmbushHidden(minion, gameState) {
    const home = gameState?.dungeon?.rooms?.find(r => r.instanceId === minion.assignedRoomId)
    if (!home) { minion._hidden = false; return }
    const advInRoom = (gameState.adventurers?.active ?? []).some(a =>
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 &&
      a.tileX >= home.gridX && a.tileX < home.gridX + home.width &&
      a.tileY >= home.gridY && a.tileY < home.gridY + home.height
    )
    const wasHidden = minion._hidden === true
    minion._hidden = !advInRoom
    // Edge: hidden -> revealed transition queues a one-shot 1.5× damage
    // bonus on the next attack. Stays armed until consumed.
    if (wasHidden && !minion._hidden) {
      minion._ambushBuffActive = true
    }
  },

  _tickBeholderTeleport(beholder, scene, gameState, dungeonGrid, delta) {
    beholder._teleAccum = (beholder._teleAccum ?? 0) + delta
    if (beholder._teleAccum < BEHOLDER_TELEPORT_MS) return
    beholder._teleAccum = 0

    // Throne Room mini-bosses (garrison) are bound to their throne room — the
    // teleport must NOT carry them out of it. They still blink, but only to a
    // spot WITHIN their own room (and assignedRoomId is left untouched below).
    const confined = beholder.isThroneMiniBoss || beholder.class === 'garrison'
    let dest
    if (confined) {
      dest = (gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === beholder.assignedRoomId)
      if (!dest) return
    } else {
      const rooms = (gameState?.dungeon?.rooms ?? []).filter(r =>
        r.definitionId !== 'boss_chamber' && r.instanceId !== beholder.assignedRoomId
      )
      if (!rooms.length) return
      dest = rooms[Math.floor(Math.random() * rooms.length)]
    }
    // Confined blink insets 2 tiles off the wall ring so the big mini-boss
    // sprite lands on interior floor, not embedded in the room wall.
    const tx = confined
      ? dest.gridX + 2 + Math.floor(Math.random() * Math.max(1, dest.width  - 4))
      : dest.gridX + Math.floor(Math.random() * dest.width)
    const ty = confined
      ? dest.gridY + 2 + Math.floor(Math.random() * Math.max(1, dest.height - 4))
      : dest.gridY + Math.floor(Math.random() * dest.height)

    if (scene) {
      AbilityVfx.particleBurst(scene, beholder.worldX ?? 0, beholder.worldY ?? 0, {
        color: 0xaa44ee, count: 10, durationMs: 400, speed: 80,
      })
    }
    beholder.tileX  = tx
    beholder.tileY  = ty
    beholder.worldX = tx * TS + TS / 2
    beholder.worldY = ty * TS + TS / 2
    beholder.assignedRoomId = dest.instanceId
    beholder._chasePath = null
    beholder._patrolTarget = null
    if (scene) {
      AbilityVfx.particleBurst(scene, beholder.worldX, beholder.worldY, {
        color: 0xaa44ee, count: 10, durationMs: 400, speed: 80,
      })
    }
  },

  _tickSkeletonMarch(skel, gameState) {
    // If another skeleton in the same room already has a patrol target,
    // copy it. Otherwise pick one normally and let the others follow.
    const room = skel.assignedRoomId
    const peers = (gameState?.minions ?? []).filter(m =>
      m !== skel && m.definitionId === 'skeleton1' &&
      m.assignedRoomId === room &&
      m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0
    )
    if (!peers.length) return
    const leader = peers.find(p => p._patrolTarget)
    if (leader && !skel._patrolTarget) {
      skel._patrolTarget = { x: leader._patrolTarget.x, y: leader._patrolTarget.y }
      skel._patrolAccum  = 0
    }
  },

  // _tickOrcPatrol removed — orcs now use `behaviorType: 'roam'` in
  // minionTypes.json, which dispatches to the unified cross-room wander
  // in MinionAISystem. The old bespoke handler set neighbor-room patrol
  // targets that were immediately overridden by the "not at home →
  // return home" pathway, so orcs never actually reached the neighbor.
  // The roam dispatch suppresses that override too.

  _tickDemonSense(demon, gameState, dungeonGrid) {
    // Look for an adv in any neighbor room. If found, set patrol target to
    // that adv's tile. _pickTarget will then pick them up normally if the
    // demon walks within aggro range.
    const neighbors = dungeonGrid?.getNeighborRooms?.(demon.assignedRoomId) ?? []
    if (!neighbors.length) return
    const advs = gameState?.adventurers?.active ?? []
    for (const room of neighbors) {
      for (const a of advs) {
        if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
        if (a.tileX >= room.gridX && a.tileX < room.gridX + room.width &&
            a.tileY >= room.gridY && a.tileY < room.gridY + room.height) {
          demon._patrolTarget = { x: a.tileX, y: a.tileY }
          demon._patrolAccum  = 0
          demon._demonSensing = true
          return
        }
      }
    }
    // No adv in any neighbor — drop the override flag so wander resumes home.
    if (demon._demonSensing) {
      demon._demonSensing = false
      demon._patrolTarget = null
    }
  },

  _tickGoblinScavenger(goblin, scene, gameState, dungeonGrid) {
    if (goblin._patrolTarget) {
      // Reached a loot-pile target? Loot it.
      const pt = goblin._patrolTarget
      if (goblin.tileX === pt.x && goblin.tileY === pt.y && pt._isLootPile) {
        const piles = gameState?.dungeon?.lootPiles ?? []
        const idx = piles.findIndex(p => p.tileX === pt.x && p.tileY === pt.y)
        if (idx >= 0) {
          const looted = piles[idx]
          piles.splice(idx, 1)
          EventBus.emit('LOOT_PILE_REMOVED', { pile: looted, looterId: goblin.instanceId })
          if (gameState.player) gameState.player.gold = (gameState.player.gold ?? 0) + 5
          if (scene) AbilityVfx.floatingText(scene, goblin.worldX ?? 0, (goblin.worldY ?? 0) - 22, '+5g', { color: '#ffdd44' })
        }
        goblin._patrolTarget = null
        goblin._patrolAccum  = 0
      }
      return
    }
    // No current target — scout the home + neighbor rooms for loot.
    const piles = gameState?.dungeon?.lootPiles ?? []
    if (!piles.length) return
    const homeId      = goblin.assignedRoomId
    const neighborIds = new Set((dungeonGrid?.getNeighborRooms?.(homeId) ?? []).map(r => r.instanceId))
    let best = null
    let bestDist = Infinity
    for (const p of piles) {
      const room = dungeonGrid?.getRoomAtTile?.(p.tileX, p.tileY)
      if (!room) continue
      if (room.instanceId !== homeId && !neighborIds.has(room.instanceId)) continue
      const d = Math.hypot(p.tileX - goblin.tileX, p.tileY - goblin.tileY)
      if (d < bestDist) { best = p; bestDist = d }
    }
    if (best) {
      goblin._patrolTarget = { x: best.tileX, y: best.tileY, _isLootPile: true }
      goblin._patrolAccum  = 0
    }
  },

  // [Removed 2026-05-22] _migrateMimics. Old design hopped every mimic to
  // a random different room each night, which contradicted the new
  // "stationary chest trap" mechanic — mimics now stay where the player
  // placed them (or where the Mimic Vault spawned them). See
  // AISystem._springMimic for the rework.

  // Lizardman Lurk — set the home tile to a corner of its room on respawn.
  _placeLizardmanInCorner(minion, gameState) {
    const home = gameState?.dungeon?.rooms?.find(r => r.instanceId === minion.assignedRoomId)
    if (!home) return
    const corners = [
      { x: home.gridX,                  y: home.gridY                  },
      { x: home.gridX + home.width - 1, y: home.gridY                  },
      { x: home.gridX,                  y: home.gridY + home.height - 1 },
      { x: home.gridX + home.width - 1, y: home.gridY + home.height - 1 },
    ]
    const c = corners[Math.floor(Math.random() * corners.length)]
    minion.homeTileX = c.x
    minion.homeTileY = c.y
    minion.tileX  = c.x
    minion.tileY  = c.y
    minion.worldX = c.x * TS + TS / 2
    minion.worldY = c.y * TS + TS / 2
  },

  // Mushroom Confusion Spores — staggers nearby advs for 3s.
  _mushroomConfusion(scene, mushroom, gameState) {
    if (!gameState?.adventurers?.active) return
    let hits = 0
    for (const adv of gameState.adventurers.active) {
      if (adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const d = Math.hypot(adv.tileX - mushroom.tileX, adv.tileY - mushroom.tileY)
      if (d > SPORE_RADIUS_TILES + 0.01) continue
      this._applyStagger(adv, scene, SPORE_STAGGER_MS)
      hits += 1
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 22, 'CONFUSED', { color: '#cc88ff' })
    }
    if (scene) {
      AbilityVfx.pulseRing(scene, mushroom.worldX ?? 0, mushroom.worldY ?? 0, {
        color: 0x9966cc, fromR: 8, toR: SPORE_RADIUS_TILES * 32, durationMs: 600, alpha: 0.7,
      })
      AbilityVfx.particleBurst(scene, mushroom.worldX ?? 0, mushroom.worldY ?? 0, {
        color: 0x9966cc, count: 12, durationMs: 800, speed: 50,
      })
    }
  },

  // ── Data-ability handler internals (Thread E/D/B/Widen) ──────────────────

  _roomOf(gameState, id) {
    return (gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === id) ?? null
  },
  _inRoom(x, y, room) {
    return room && x >= room.gridX && x < room.gridX + room.width &&
           y >= room.gridY && y < room.gridY + room.height
  },
  _liveAdvs(gameState) {
    return (gameState?.adventurers?.active ?? []).filter(a =>
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)
  },

  // Generalised Split on Death — spawns `count` half-stat children of the same
  // type. Drives both legacy slimes and the elders' "splits when struck" (D).
  _spawnSplitChildren(scene, parent, gameState, ab) {
    const count = ab.count ?? 2
    const offsets = [
      { dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
      { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
    ]
    let spawned = 0
    for (const off of offsets) {
      if (spawned >= count) break
      gameState.minions.push(this._cloneAsMiniSlime(parent, parent.tileX + off.dx, parent.tileY + off.dy, ab.statMul ?? 0.5))
      spawned += 1
    }
    if (scene && spawned > 0) {
      AbilityVfx.particleBurst(scene, parent.worldX ?? 0, parent.worldY ?? 0, {
        color: parent.color ?? 0x44aaff, count: 8, durationMs: 500, speed: 70,
      })
    }
  },

  // Generalised death AoE (imp Self-Combust + any future on-death blast).
  _aoeOnDeath(scene, minion, gameState, ab) {
    const radius = ab.radiusTiles ?? 1.5
    const dmg    = ab.dmg ?? 8
    const color  = ab.color ?? 0xff6633
    let hits = 0
    for (const adv of this._liveAdvs(gameState)) {
      if (Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY) > radius + 0.01) continue
      const fl = (adv._lightParty || adv._shadowMonarch) ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
      adv.resources.hp = Math.max(fl, adv.resources.hp - dmg)
      hits += 1
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${dmg}`, { color: '#ff6633' })
    }
    if (scene) {
      AbilityVfx.pulseRing(scene, minion.worldX ?? 0, minion.worldY ?? 0, { color, fromR: 8, toR: radius * 32, durationMs: 350, alpha: 0.85 })
      AbilityVfx.particleBurst(scene, minion.worldX ?? 0, minion.worldY ?? 0, { color, count: 14, durationMs: 600, speed: 110 })
      if (hits > 0) AbilityVfx.floatingText(scene, minion.worldX ?? 0, (minion.worldY ?? 0) - 22, ab.label ?? 'BOOM', { color: '#ff8844' })
    }
  },

  // Generalised death stagger cloud (mushroom Confusion Spores).
  _staggerCloud(scene, minion, gameState, ab) {
    const radius = ab.radiusTiles ?? SPORE_RADIUS_TILES
    for (const adv of this._liveAdvs(gameState)) {
      if (Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY) > radius + 0.01) continue
      this._applyStagger(adv, scene, ab.durationMs ?? SPORE_STAGGER_MS)
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 22, ab.label ?? 'CONFUSED', { color: '#cc88ff' })
    }
    if (scene) {
      AbilityVfx.pulseRing(scene, minion.worldX ?? 0, minion.worldY ?? 0, { color: 0x9966cc, fromR: 8, toR: radius * 32, durationMs: 600, alpha: 0.7 })
      AbilityVfx.particleBurst(scene, minion.worldX ?? 0, minion.worldY ?? 0, { color: 0x9966cc, count: 12, durationMs: 800, speed: 50 })
    }
  },

  // Heal Undead aura — generalised from the lich1-only version so ALL lich
  // tiers (and any future support minion) heal the most-wounded same-room ally
  // carrying `tag`. Interval gating is handled by tickAbilities.
  _healAura(lich, scene, gameState, ab) {
    const home = this._roomOf(gameState, lich.assignedRoomId)
    if (!home) return
    const tag = ab.tag ?? 'undead'
    let best = null, bestMissing = 0
    for (const m of (gameState.minions ?? [])) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.faction !== 'dungeon') continue
      if (!Array.isArray(m.tags) || !m.tags.includes(tag)) continue
      if (!this._inRoom(m.tileX, m.tileY, home)) continue
      const missing = (m.resources?.maxHp ?? 0) - (m.resources?.hp ?? 0)
      if (missing > bestMissing) { best = m; bestMissing = missing }
    }
    if (!best) return
    const before = best.resources.hp
    best.resources.hp = Math.min(best.resources.maxHp ?? 0, best.resources.hp + (ab.amount ?? 6))
    const restored = best.resources.hp - before
    if (restored > 0) {
      EventBus.emit('ALLY_HEALED', { sourceId: lich.instanceId, targetId: best.instanceId, amount: restored, roomId: lich.assignedRoomId })
      if (scene && Number.isFinite(best.worldX)) {
        AbilityVfx.floatingText(scene, best.worldX, best.worldY - 22, `+${restored}`, { color: '#ffe27a' })
        AbilityVfx.pulseRing(scene, best.worldX, best.worldY, { color: 0xffe27a, fromR: 6, toR: 16, alpha: 0.7, durationMs: 420 })
      }
    }
  },

  // Raise Dead — Elder Lich periodically reanimates ONE fallen same-room ally
  // (tagged) back to a fraction of HP. Capped by interval; the revived minion
  // is flagged _raisedAdd so it's swept at dawn (no permanent army growth).
  _reviveAlly(lich, scene, gameState, ab) {
    const home = this._roomOf(gameState, lich.assignedRoomId)
    if (!home) return
    const tag = ab.tag ?? 'undead'
    const fallen = (gameState.minions ?? []).find(m =>
      m !== lich && m.aiState === 'dead' &&
      m.faction === 'dungeon' && m.assignedRoomId === lich.assignedRoomId &&
      Array.isArray(m.tags) && m.tags.includes(tag) && !m._raisedAdd)
    if (!fallen) return
    const max = fallen.resources?.maxHp ?? 1
    fallen.resources.hp = Math.max(1, Math.floor(max * (ab.frac ?? 0.5)))
    fallen.aiState = 'idle'
    fallen.deathDay = null
    fallen._raisedAdd = true
    fallen.tileX = lich.tileX; fallen.tileY = lich.tileY
    fallen.worldX = lich.worldX; fallen.worldY = lich.worldY
    EventBus.emit('MINION_RESPAWNED', { minionId: fallen.instanceId, sourceId: lich.instanceId })
    if (scene && Number.isFinite(fallen.worldX)) {
      AbilityVfx.floatingText(scene, fallen.worldX, fallen.worldY - 22, ab.label ?? 'RISE', { color: '#bb99ff' })
      AbilityVfx.pulseRing(scene, fallen.worldX, fallen.worldY, { color: 0xbb99ff, fromR: 6, toR: 24, alpha: 0.8, durationMs: 600 })
    }
  },

  // Rally Aura — Commander buffs nearby dungeon minions' ATK/DEF. Stamps a
  // short-lived flag (expiry slightly past the interval) so the buff persists
  // between ticks but DROPS shortly after the commander dies/leaves the room.
  _buffAura(commander, scene, gameState, ab) {
    const home = this._roomOf(gameState, commander.assignedRoomId)
    if (!home) return
    const now = scene?.time?.now ?? 0
    const until = now + (ab.intervalMs ?? 1000) * 1.6
    let buffed = 0
    for (const m of (gameState.minions ?? [])) {
      if (m === commander) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.faction !== 'dungeon') continue
      if (!this._inRoom(m.tileX, m.tileY, home)) continue
      m._rallyUntil  = until
      m._rallyAtkMul = ab.atkMul ?? 1.2
      m._rallyDefMul = ab.defMul ?? 1.0
      buffed += 1
    }
    if (scene && buffed > 0 && Number.isFinite(commander.worldX)) {
      AbilityVfx.pulseRing(scene, commander.worldX, commander.worldY, { color: 0xffcc44, fromR: 8, toR: 40, alpha: 0.45, durationMs: 620 })
    }
  },

  // Contagion Aura — Crypt Lord: same-room adventurers take periodic poison.
  _contagionAura(minion, scene, gameState, ab) {
    const home = this._roomOf(gameState, minion.assignedRoomId)
    if (!home) return
    const radius = ab.radiusTiles ?? 99   // default = whole room
    let hit = false
    for (const adv of this._liveAdvs(gameState)) {
      if (!this._inRoom(adv.tileX, adv.tileY, home)) continue
      if (radius < 99 && Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY) > radius + 0.01) continue
      const dmg = ab.dmgPerTick ?? 2
      const fl = (adv._lightParty || adv._shadowMonarch) ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
      adv.resources.hp = Math.max(fl, adv.resources.hp - dmg)
      adv._lastHitBy = minion.instanceId
      adv._lastHitType = ab.element ?? 'poison'
      hit = true
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${dmg}`, { color: '#88dd44' })
    }
    if (scene && hit && Number.isFinite(minion.worldX)) {
      AbilityVfx.pulseRing(scene, minion.worldX, minion.worldY, { color: 0x77aa33, fromR: 8, toR: 30, alpha: 0.35, durationMs: 700 })
    }
  },

  // Nova Burst — the generic miniboss "ult": a periodic, telegraphed AoE that
  // hits every adventurer in range (whole room by default) for `dmg`, applies an
  // optional `status` (burn/poison/stagger/root/slow/nerve), and can drain a
  // fraction of the total damage back to the caster (`lifestealFrac`). Used to
  // give final/miniboss forms a dramatic signature beat on top of their
  // inherited family passive. Fires nothing (no VFX) when no one's in range.
  _novaBurst(minion, scene, gameState, ab) {
    const home = this._roomOf(gameState, minion.assignedRoomId)
    const radius = ab.radiusTiles   // undefined → whole room
    const targets = []
    for (const adv of this._liveAdvs(gameState)) {
      const inRange = (radius != null)
        ? Math.hypot(adv.tileX - minion.tileX, adv.tileY - minion.tileY) <= radius + 0.01
        : (home && this._inRoom(adv.tileX, adv.tileY, home))
      if (inRange) targets.push(adv)
    }
    if (!targets.length) return
    const now = scene?.time?.now ?? 0
    const dmg = ab.dmg ?? 8
    let total = 0
    for (const adv of targets) {
      const fl = (adv._lightParty || adv._shadowMonarch) ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
      const before = adv.resources.hp
      adv.resources.hp = Math.max(fl, adv.resources.hp - dmg)
      total += before - adv.resources.hp
      adv._lastHitBy = minion.instanceId
      adv._lastHitType = ab.element ?? 'physical'
      switch (ab.status) {
        case 'burn':    this._applyDot(adv, scene, { type: 'burn',   dmgPerTick: 2, intervalMs: 1000, ticksLeft: 3, source: minion.instanceId }); break
        case 'poison':  this._applyDot(adv, scene, { type: 'poison', dmgPerTick: 2, intervalMs: 1000, ticksLeft: 4, source: minion.instanceId }); break
        case 'stagger': this._applyStagger(adv, scene, ab.statusMs ?? 1200); break
        case 'root':    this._applyRoot(adv, scene, ab.statusMs ?? 1500); break
        case 'slow': {
          const next = now + (ab.statusMs ?? 1800)
          if (!adv._slowUntil || adv._slowUntil < next) adv._slowUntil = next
          adv._slowMult = Math.min(adv._slowMult ?? 1, ab.slowMult ?? 0.6)
          break
        }
        case 'nerve':   if (typeof adv.nerve === 'number') adv.nerve = Math.max(0, adv.nerve - (ab.nerveAmt ?? 14)); break
        default: break
      }
      if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${dmg}`, { color: '#ffffff' })
    }
    if (ab.lifestealFrac && total > 0) {
      const heal = Math.max(1, Math.floor(total * ab.lifestealFrac))
      const before = minion.resources.hp
      minion.resources.hp = Math.min(minion.resources.maxHp ?? 0, minion.resources.hp + heal)
      const restored = minion.resources.hp - before
      if (restored > 0 && scene) AbilityVfx.floatingText(scene, minion.worldX ?? 0, (minion.worldY ?? 0) - 24, `+${restored}`, { color: '#ff77aa' })
    }
    if (scene && Number.isFinite(minion.worldX)) {
      const col = (typeof ab.color === 'number') ? ab.color : 0xffffff
      AbilityVfx.shockwaveFx(scene, minion.worldX, minion.worldY, { color: col, fromR: 10, toR: (radius ? radius * 32 : 130), durationMs: 620, rings: 2 })
      if (ab.label) AbilityVfx.floatingText(scene, minion.worldX, minion.worldY - 28, ab.label, { color: '#' + col.toString(16).padStart(6, '0') })
    }
  },

  // Summon — Bone Totem / Hive Node spawns a weak, capped add. Adds carry
  // `_summonedBy` + `_isSummonedAdd` so the cap can count them and the dawn
  // respawn sweep can wipe them (no permanent growth).
  _summonAdd(minion, scene, gameState, ab) {
    const cap = ab.cap ?? 3
    const alive = (gameState.minions ?? []).filter(m =>
      m._summonedBy === minion.instanceId && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0).length
    if (alive >= cap) return
    const defs = scene?.cache?.json?.get?.('minionTypes') ?? []
    const addDef = defs.find(d => d.id === (ab.addId ?? 'swarmling'))
    if (!addDef) return
    const tile = { x: minion.tileX, y: minion.tileY }
    const add = this._makeAdd(addDef, tile, minion.assignedRoomId, minion)
    gameState.minions.push(add)
    if (scene && Number.isFinite(minion.worldX)) {
      AbilityVfx.particleBurst(scene, minion.worldX, minion.worldY, { color: add.color ?? 0xccccaa, count: 8, durationMs: 450, speed: 60 })
      AbilityVfx.floatingText(scene, minion.worldX, minion.worldY - 22, ab.label ?? 'SUMMON', { color: '#ddccaa' })
    }
  },

  _makeAdd(typeDef, tile, roomId, summoner) {
    const TS = 32
    const bs = typeDef.baseStats ?? {}
    const hp = bs.hp ?? 10
    let color = typeDef.color
    if (typeof color === 'string') color = parseInt(color.replace(/^0x/i, ''), 16) || 0xccccaa
    return {
      instanceId: `min_add_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      definitionId: typeDef.id, name: null, color, sigil: (typeDef.id[0] ?? 'S').toUpperCase(),
      tileX: tile.x, tileY: tile.y, worldX: tile.x * TS + TS / 2, worldY: tile.y * TS + TS / 2,
      homeTileX: tile.x, homeTileY: tile.y, assignedRoomId: roomId,
      class: 'garrison', behaviorType: typeDef.behaviorType ?? 'guard',
      tags: [...(typeDef.tags ?? [])], damageType: bs.damageType ?? 'physical', attackRange: bs.attackRange ?? 1,
      faction: 'dungeon', factionExpiresOn: null, raisedByAdvId: null, tamedByAdvId: null, isMiniBoss: false,
      stats: { hp, attack: bs.attack ?? 3, defense: bs.defense ?? 0, speed: bs.speed ?? 1.0, abilities: [] },
      resources: { hp, maxHp: hp }, level: 1, xp: 0, evolutionHistory: [], killHistory: [],
      lifetime: { kills: 0, damageDealt: 0 }, equippedGear: [], hasBounty: false, bountyKillCount: 0,
      aiState: 'idle', currentTargetId: null, lastAttackAt: 0, deathDay: null, path: null, pathIndex: 0,
      bossLevel: summoner.bossLevel ?? 1, _baseMaxHp: hp, _baseAtk: bs.attack ?? 3,
      _summonedBy: summoner.instanceId, _isSummonedAdd: true,
    }
  },

  // Hazard Trail — Rust Gremlin drops a lingering damage zone behind it as it
  // moves. Zones live on gameState.dungeon.hazards and are ticked/expired by
  // tickHazards (called once per frame from MinionAISystem.update).
  _hazardTrail(minion, scene, gameState, ab) {
    if (!gameState.dungeon) return
    // Only drop when the minion has actually moved to a new tile.
    if (minion._lastHazardTile && minion._lastHazardTile.x === minion.tileX && minion._lastHazardTile.y === minion.tileY) return
    minion._lastHazardTile = { x: minion.tileX, y: minion.tileY }
    const now = scene?.time?.now ?? 0
    gameState.dungeon.hazards = gameState.dungeon.hazards ?? []
    gameState.dungeon.hazards.push({
      tileX: minion.tileX, tileY: minion.tileY, element: ab.element ?? 'fire',
      dmg: ab.dmg ?? 2, radius: ab.radiusTiles ?? 0.7, expiresAt: now + (ab.zoneMs ?? 4000),
      color: ab.color ?? 0xff7733, sourceId: minion.instanceId,
    })
  },

  // Per-frame hazard-zone processor (called once from MinionAISystem.update).
  tickHazards(scene, gameState, delta) {
    const hazards = gameState?.dungeon?.hazards
    if (!Array.isArray(hazards) || !hazards.length) return
    const now = scene?.time?.now ?? 0
    const advs = this._liveAdvs(gameState)
    const remaining = []
    for (const h of hazards) {
      if (now >= h.expiresAt) continue
      // Tick damage ~1×/sec per standing adv.
      h._lastTick = h._lastTick ?? 0
      if (now - h._lastTick >= 1000) {
        h._lastTick = now
        for (const adv of advs) {
          if (Math.hypot(adv.tileX - h.tileX, adv.tileY - h.tileY) > (h.radius ?? 0.7) + 0.01) continue
          const fl = (adv._lightParty || adv._shadowMonarch) ? Math.max(1, Math.ceil((adv.resources.maxHp ?? 1) * 0.10)) : 0
          adv.resources.hp = Math.max(fl, adv.resources.hp - (h.dmg ?? 2))
          adv._lastHitBy = h.sourceId; adv._lastHitType = h.element ?? 'fire'
          if (scene) AbilityVfx.floatingText(scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 14, `-${h.dmg ?? 2}`, { color: '#ff7733' })
        }
      }
      remaining.push(h)
    }
    gameState.dungeon.hazards = remaining
  },

  // ── Goblin PLUNDER (gold-steal) helpers ───────────────────────────────────

  // Warband's Cut — if a living Plunder King (a minion carrying a `plunderAura`
  // ability) shares `roomId`, goblin plunder in that room is multiplied.
  _plunderMult(scene, gameState, roomId) {
    if (!roomId) return 1
    for (const m of (gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.assignedRoomId !== roomId) continue
      const abs = _abilitiesFor(m, scene)
      const aura = abs && abs.find(a => a.type === 'plunderAura')
      if (aura) return aura.mult ?? 2
    }
    return 1
  },

  // Bank gold to the treasury + fire the coin-burst VFX at the hero (reuses
  // CoinBurstRenderer via RESOURCES_AWARDED). Returns the gold granted.
  _grantPlunder(scene, attacker, target, gameState, baseAmount, reason) {
    if (!gameState?.player) return 0
    const mult = this._plunderMult(scene, gameState, attacker?.assignedRoomId)
    const g = Math.max(1, Math.round(baseAmount * mult))
    gameState.player.gold = (gameState.player.gold ?? 0) + g
    EventBus.emit('RESOURCES_AWARDED', { gold: g, reason, worldX: target?.worldX, worldY: target?.worldY })
    return g
  },

  // Mark for Plunder — brand the hero so every dungeon hit on them steals, plus
  // a slow gold-bleed. Stores the marking room so Warband's Cut can double it.
  _applyPlunderMark(scene, attacker, target, ab) {
    if (!target) return
    const now = scene?.time?.now ?? 0
    target._plunderUntil     = now + (ab.durationMs ?? 6000)
    target._plunderMarkSteal = ab.markSteal ?? 1
    target._plunderBleedGold = ab.bleedGold ?? 1
    target._plunderBleedMs   = ab.bleedMs ?? 1500
    target._plunderSrcRoom   = attacker?.assignedRoomId ?? null
    if (scene && Number.isFinite(target.worldX)) {
      AbilityVfx.pulseRing(scene, target.worldX, target.worldY, { color: 0xffd23f, fromR: 6, toR: 22, alpha: 0.85, durationMs: 420 })
      AbilityVfx.floatingText(scene, target.worldX, target.worldY - 24, ab.label ?? 'MARKED', { color: '#ffd23f' })
    }
  },

  // GLOBAL marked-steal — called from onHit for EVERY minion hit. If the struck
  // hero is branded, the dungeon pockets a little gold (doubled by Warband's Cut
  // when a Plunder King is in the attacker's room).
  _tryMarkedSteal(scene, attacker, target, gameState) {
    if (!attacker || attacker.faction !== 'dungeon') return
    const now = scene?.time?.now ?? 0
    if (!(target?._plunderUntil > now)) return
    this._grantPlunder(scene, attacker, target, gameState, target._plunderMarkSteal ?? 1, 'plunder_mark')
  },

  // Grand Heist (Plunder King ult) — brand EVERY hero in the King's room at once
  // with a warhorn shock-ring greed-cry.
  _massMark(king, scene, gameState, ab) {
    const home = this._roomOf(gameState, king.assignedRoomId)
    if (!home) return
    let branded = 0
    for (const adv of this._liveAdvs(gameState)) {
      if (!this._inRoom(adv.tileX, adv.tileY, home)) continue
      this._applyPlunderMark(scene, king, adv, ab)
      branded++
    }
    if (scene && Number.isFinite(king.worldX)) {
      AbilityVfx.shockwaveFx(scene, king.worldX, king.worldY, { color: 0xffd23f, fromR: 10, toR: 130, durationMs: 640, rings: 2 })
      if (branded > 0) AbilityVfx.floatingText(scene, king.worldX, king.worldY - 28, ab.label ?? 'GRAND HEIST', { color: '#ffd23f' })
    }
  },

  // Per-frame plunder-mark processor (called once from MinionAISystem.update):
  // bleeds gold off active brands and expires them.
  tickPlunderMarks(scene, gameState, delta) {
    const now = scene?.time?.now ?? 0
    for (const adv of this._liveAdvs(gameState)) {
      if (!(adv._plunderUntil > now)) { if (adv._plunderUntil) adv._plunderUntil = 0; continue }
      adv._plunderBleedAccum = (adv._plunderBleedAccum ?? 0) + delta
      if (adv._plunderBleedAccum < (adv._plunderBleedMs ?? 1500)) continue
      adv._plunderBleedAccum = 0
      const mult = this._plunderMult(scene, gameState, adv._plunderSrcRoom)
      const g = Math.max(1, Math.round((adv._plunderBleedGold ?? 1) * mult))
      if (gameState?.player) {
        gameState.player.gold = (gameState.player.gold ?? 0) + g
        EventBus.emit('RESOURCES_AWARDED', { gold: g, reason: 'plunder_bleed', worldX: adv.worldX, worldY: adv.worldY })
      }
    }
  },
}

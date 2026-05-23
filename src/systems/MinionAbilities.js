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
  rat1:            { ability: 'Plague Bite — every hit stacks a 5-tick poison DoT.',           behavior: 'Wall Squeeze — straight-lines through walls when chasing.' },
  zombie1:         { ability: 'One More Time — 50% chance to revive once per fight at 25% HP.', behavior: 'Idle Stand — never patrols; holds its tile until aggro.' },
  slime2:          { ability: 'Split on Death — spawns 2 mini-slimes (half stats).',           behavior: 'Bouncy Path — re-picks a new direction the moment it arrives.' },
  slime3:          { ability: 'Split on Death — spawns 2 mini-slimes (half stats).',           behavior: 'Bouncy Path — re-picks a new direction the moment it arrives.' },
  slime4:          { ability: 'Split on Death — spawns 2 mini-slimes (half stats).',           behavior: 'Bouncy Path — re-picks a new direction the moment it arrives.' },
  plant1:          { ability: 'Root Snare — first hit per fight roots the target 2.5s.',      behavior: 'Permanently Rooted — never moves once placed.' },
  goblin1:         { ability: 'Pickpocket — banks +1g per hit; lost if killed mid-day.',       behavior: 'Loot Scavenger — paths to nearby loot piles, banks +5g on contact.' },
  mushroom1:       { ability: 'Confusion Spores — death cloud staggers nearby advs 3s.',       behavior: 'Permanently Rooted — never moves once placed.' },
  skeleton1:       { ability: 'Reassemble — 30% revive at 50% HP if a skel buddy is alive in-room.', behavior: 'March in Formation — same-room skeletons sync patrol targets.' },
  lizardman1:      { ability: 'Camouflage — invisible until first attack (3× damage on reveal).', behavior: 'Lurk — anchors to a random corner each dawn; never patrols.' },
  orc1:            { ability: 'Berserker Rage — +30% attack speed below 50% HP.',              behavior: 'Patrol Nearby Rooms — wanders into adjacent rooms (40% of trips).' },
  gnoll1:          { ability: 'Howl — first hit alerts every other gnoll to converge.',        behavior: 'Hunter — chases adventurers across the entire dungeon.' },
  imp1:            { ability: 'Self-Combust — explodes on death for 8 fire AoE damage.',       behavior: 'Flying — straight-lines through walls when chasing.' },
  ghost1:          { ability: 'Possession — 25% per hit; possessed adv attacks an ally for 2s.', behavior: 'Haunts a Tile — never moves; reaches across the room (range 5).' },
  vampire_minion1: { ability: 'Bloodthirst — heals for 50% of damage dealt.',                  behavior: 'Sleep on Ceiling — invisible until an adv enters the room.' },
  beholder1:       { ability: 'Petrify Gaze — 15% per hit to root the target 2s.',             behavior: 'Teleport — relocates to a random non-boss room every 8s.' },
  lich1:           { ability: 'Heal Undead — heals the most-wounded undead in-room every 3s.', behavior: 'Stays Back — ranged caster (range 3); never enters melee.' },
  ent1:            { ability: 'Gnarled Hide — takes 50% less physical damage.',                behavior: 'Slow Guard — patrols home room at 0.4× speed.' },
  demon1:          { ability: 'Hellfire Brand — every hit applies a 3-tick burn DoT.',         behavior: 'Demon Sense — runs to adjacent rooms to attack intruders.' },
  golem1:          { ability: 'Earthshake — 20% per hit to stagger the target 1s.',            behavior: 'Camouflaged Pillar — invisible until an adv steps adjacent.' },
  mimic:           { ability: 'Greedy Bite — banks +5g per hit; lost if killed mid-day.',      behavior: 'Migrate — relocates to a random treasure room each dawn.' },
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
const ORC_NEIGHBOR_PATROL_PCT = 0.4    // chance Orc patrols a neighbor room instead of home
const BEHOLDER_TELEPORT_MS    = 8000   // teleport interval
const ENT_PATROL_SPEED_MULT   = 0.4    // Ent's already-slow patrol gets halved

export const MinionAbilities = {

  // ── On-hit (CombatSystem.tryAttack hook) ─────────────────────────────────

  onHit(scene, attacker, target, damageDealt, gameState) {
    if (!attacker || !target || !scene) return
    const id = attacker.definitionId
    if (!id) return   // adventurer attacker — nothing to do here

    // Rat — Plague Bite: stack a poison DoT every hit.
    if (RAT_IDS.has(id)) {
      this._applyDot(target, scene, { type: 'poison', dmgPerTick: 1, intervalMs: 1000, ticksLeft: 5 })
    }

    // Demon — Hellfire Brand: 3-tick burn DoT on every hit.
    if (DEMON_IDS.has(id)) {
      this._applyDot(target, scene, { type: 'burn', dmgPerTick: 2, intervalMs: 1000, ticksLeft: 3 })
    }

    // Vampire — Bloodthirst: heal attacker for 50% of damage dealt.
    // Generic `lifesteal` tag also triggers (used by Blood Briar) so any
    // future "drains blood" minion can opt in via JSON without changing
    // this file.
    const hasLifestealTag = Array.isArray(attacker.tags) && attacker.tags.includes('lifesteal')
    if ((VAMPIRE_IDS.has(id) || hasLifestealTag) && damageDealt > 0) {
      const heal = Math.max(1, Math.floor(damageDealt * 0.5))
      const before = attacker.resources.hp
      attacker.resources.hp = Math.min(attacker.resources.maxHp ?? 0, attacker.resources.hp + heal)
      const restored = attacker.resources.hp - before
      if (restored > 0) {
        AbilityVfx.floatingText(scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 22, `+${restored}`, { color: '#ff77aa' })
      }
    }

    // Beholder — Petrify Gaze: 15% chance to root for 2s.
    if (BEHOLDER_IDS.has(id) && Math.random() < 0.15) {
      this._applyRoot(target, scene, 2000)
      AbilityVfx.floatingText(scene, target.worldX ?? 0, (target.worldY ?? 0) - 22, 'PETRIFIED', { color: '#cc88ff' })
    }

    // Golem — Earthshake: 20% chance to stagger for 1s.
    if (GOLEM_IDS.has(id) && Math.random() < 0.20) {
      this._applyStagger(target, scene, 1000)
      AbilityVfx.floatingText(scene, target.worldX ?? 0, (target.worldY ?? 0) - 22, 'STAGGERED', { color: '#aa9988' })
    }

    // Goblin — Pickpocket: bank 1g/hit on attacker; credited to dungeon
    // on minion death so killing the goblin first denies the loot.
    if (GOBLIN_IDS.has(id)) {
      attacker._stolenGold = (attacker._stolenGold ?? 0) + 1
      AbilityVfx.floatingText(scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 22, '+1g', { color: '#ffdd44' })
    }

    // Mimic — Greedy Bite: 5g per hit (chunkier version of Pickpocket).
    if (id === 'mimic') {
      attacker._stolenGold = (attacker._stolenGold ?? 0) + 5
      AbilityVfx.floatingText(scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 22, '+5g', { color: '#ffdd44' })
    }

    // Vinekin — Root Snare: roots the target on the first hit per fight.
    // _snareUsed is reset when the minion respawns each night.
    if (id === 'plant1' && !attacker._snareUsed) {
      attacker._snareUsed = true
      this._applyRoot(target, scene, 2500)
      AbilityVfx.floatingText(scene, target.worldX ?? 0, (target.worldY ?? 0) - 22, 'SNARED', { color: '#559944' })
      // Green vine ring around the rooted target — visible cue that
      // they're locked in place for the snare duration.
      if (Number.isFinite(target.worldX)) {
        AbilityVfx.pulseRing(scene, target.worldX, target.worldY,
          { color: 0x559944, fromR: 6, toR: 18, alpha: 0.8, durationMs: 500 })
      }
    }

    // Ghost — Possession: 25% per hit; possessed adv attacks a same-party
    // ally on their next swing (redirect handled by maybeRedirectPossessed
    // hook in CombatSystem).
    if (GHOST_IDS.has(id) && Math.random() < 0.25 && target.classId !== undefined) {
      target._possessedUntil = (scene?.time?.now ?? 0) + 2000
      AbilityVfx.floatingText(scene, target.worldX ?? 0, (target.worldY ?? 0) - 22, 'POSSESSED', { color: '#aaccee' })
    }

    // Gnoll — Howl: first hit per fight alerts every other gnoll to converge
    // on the attacker's tile. Rate-limited via _howlBroadcast on the source
    // (re-armed at dawn) so a long fight doesn't constantly re-target the pack.
    if (GNOLL_IDS.has(id) && !attacker._howlBroadcast && gameState?.minions) {
      attacker._howlBroadcast = true
      const tx = attacker.tileX, ty = attacker.tileY
      for (const m of gameState.minions) {
        if (m === attacker) continue
        if (!GNOLL_IDS.has(m.definitionId)) continue
        if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        m._patrolTarget = { x: tx, y: ty }
        m._patrolAccum  = 0
      }
      AbilityVfx.floatingText(scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 22, 'HOWL!', { color: '#ddaa55' })
      // Howl propagation ring — expanding tan ring radiating from the
      // gnoll so the rally signal reads visually. Tuned wider than a
      // standard hit ring since the howl is room-scope, not point-scope.
      if (Number.isFinite(attacker.worldX)) {
        AbilityVfx.pulseRing(scene, attacker.worldX, attacker.worldY,
          { color: 0xddaa55, fromR: 6, toR: 64, alpha: 0.55, durationMs: 600 })
      }
    }

    // Lizardman — Camouflage reveal already handled in CombatSystem
    // (clears _camouflaged + emits LIZARDMAN_CAMO_REVEAL). Damage bonus is
    // applied in CombatSystem._computeDamage.
  },

  // ── On minion dying (MinionAISystem._die pre-hook) ───────────────────────
  // Returns true if the death should be aborted (minion was revived). The
  // caller must skip the rest of its death routine when true is returned.

  onMinionDying(scene, minion, gameState) {
    if (!minion) return false
    const id = minion.definitionId

    // Zombie One More Time — Shamblers get a single 50% revive at 25% HP.
    if (id === 'zombie1' && !minion._oneMoreTimeUsed) {
      minion._oneMoreTimeUsed = true
      if (Math.random() < ZOMBIE_OMT_CHANCE) {
        const max = minion.resources?.maxHp ?? 1
        minion.resources.hp = Math.max(1, Math.floor(max * ZOMBIE_OMT_REVIVE_FRAC))
        if (scene) AbilityVfx.floatingText(scene, minion.worldX ?? 0, (minion.worldY ?? 0) - 22, 'RISES AGAIN', { color: '#aadd99' })
        return true
      }
    }

    // Skeleton Reassemble — Risen Bones revive at 50% HP if another skeleton
    // (any tier) is still standing in the same room. 30% per attempt.
    if (id === 'skeleton1') {
      const room = minion.assignedRoomId
      const buddy = (gameState?.minions ?? []).some(m =>
        m !== minion &&
        m.aiState !== 'dead' &&
        (m.resources?.hp ?? 0) > 0 &&
        m.assignedRoomId === room &&
        (m.definitionId === 'skeleton1' || m.definitionId === 'skeleton2' || m.definitionId === 'skeleton3')
      )
      if (buddy && Math.random() < SKELETON_REASSEMBLE_CHANCE) {
        const max = minion.resources?.maxHp ?? 1
        minion.resources.hp = Math.max(1, Math.floor(max * SKELETON_REVIVE_FRAC))
        if (scene) AbilityVfx.floatingText(scene, minion.worldX ?? 0, (minion.worldY ?? 0) - 22, 'REASSEMBLED', { color: '#ddccaa' })
        return true
      }
    }

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

    // Slime Split on Death — every slime tier spawns 2 mini-slimes nearby.
    // Mini slimes don't split again (_isMiniSlime guard) and are wiped at
    // dawn via the respawn filter so they can't accumulate forever.
    if (SLIME_IDS.has(id) && !minion._isMiniSlime && gameState?.minions) {
      this._spawnMiniSlimes(scene, minion, gameState)
    }

    // Imp Self-Combust — Ember Imps explode on death dealing fire AoE damage
    // to nearby adventurers.
    if (id === 'imp1') {
      this._impSelfCombust(scene, minion, gameState)
    }

    // Mushroom Confusion Spores — Spore Sprites release a confusion cloud
    // that staggers nearby adventurers (skip movement + combat for 3s).
    if (id === 'mushroom1') {
      this._mushroomConfusion(scene, minion, gameState)
    }
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
    minion._snareUsed = false
    minion._oneMoreTimeUsed = false      // Pass-2: re-arm Zombie OMT
    minion._howlBroadcast = false        // Pass-3: re-arm Gnoll Howl
    minion._dot = null
    minion._rootedUntil = 0
    minion._staggeredUntil = 0
    // Re-arm Lizardman camouflage each night (set by createMinion at first spawn).
    if (LIZARDMAN_IDS.has(minion.definitionId)) {
      minion._camouflaged = true
    }
  },

  // Initial flag setup at spawn time. Called from createMinion (entities/Minion.js).
  initFlags(minion, typeDef) {
    if (!minion || !typeDef) return
    if (LIZARDMAN_IDS.has(typeDef.id)) {
      minion._camouflaged = true
    }
  },

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
      adv.resources.hp = Math.max(0, adv.resources.hp - IMP_BLAST_DAMAGE)
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

  tickBehavior(minion, scene, gameState, dungeonGrid, delta) {
    if (!minion || minion.aiState === 'dead' || (minion.resources?.hp ?? 0) <= 0) return
    if (minion.faction !== 'dungeon') return
    const id = minion.definitionId

    // Visibility-flip behaviors run regardless of aiState.
    if (VAMPIRE_IDS.has(id))   this._tickVampireHidden(minion, gameState)
    if (GOLEM_IDS.has(id))     this._tickGolemHidden(minion, gameState)
    // Goblins are visible Loot Scavengers — despite their JSON
    // behaviorType 'ambush' they must NEVER be ambush-hidden, or they
    // vanish at dawn and only reappear when an adventurer engages them
    // (the reported bug). Force-clear _hidden so a save made before
    // this fix also recovers on the next tick.
    if (GOBLIN_IDS.has(id)) {
      minion._hidden = false
    // Generic ambush — any other minion declaring behaviorType
    // 'ambush' that isn't covered by a family-specific hidden handler.
    } else if (minion.behaviorType === 'ambush' &&
               !VAMPIRE_IDS.has(id) && !GOLEM_IDS.has(id)) {
      this._tickAmbushHidden(minion, gameState)
    }

    // Beholder Teleport — periodic random non-boss-room teleport. Skips
    // while engaged so we don't yank a fighting beholder off its target.
    if (BEHOLDER_IDS.has(id) && minion.aiState !== 'engaging') {
      this._tickBeholderTeleport(minion, scene, gameState, dungeonGrid, delta)
    }

    // Patrol-target overrides only matter when minion has nothing to fight.
    if (minion.aiState !== 'idle' || minion.currentTargetId) return

    // Skeleton March in Formation — sync patrol target with same-room peers.
    if (id === 'skeleton1') this._tickSkeletonMarch(minion, gameState)

    // Orc Patrol Nearby Rooms — occasionally pick a tile in a neighbor room.
    if (ORC_IDS.has(id)) this._tickOrcPatrol(minion, gameState, dungeonGrid)

    // Demon Sense — react to advs in adjacent rooms by setting an override
    // patrol target. Combat re-acquisition then engages naturally.
    if (DEMON_IDS.has(id)) this._tickDemonSense(minion, gameState, dungeonGrid)

    // Goblin Loot Scavenger — when nothing to fight, path to nearest loot
    // pile in the same/adjacent room and bank the gold on contact.
    if (GOBLIN_IDS.has(id)) this._tickGoblinScavenger(minion, scene, gameState, dungeonGrid)
  },

  // Adventurer-targeting visibility filter. Used by MinionAISystem._pickTarget
  // so adventurers can't be "seen" by sleeping/camo'd minions, BUT visible
  // minions still target advs normally. Returns true if `minion` should be
  // ignored as a hostile by the AI logic.
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

    const rooms = (gameState?.dungeon?.rooms ?? []).filter(r =>
      r.definitionId !== 'boss_chamber' && r.instanceId !== beholder.assignedRoomId
    )
    if (!rooms.length) return
    const dest = rooms[Math.floor(Math.random() * rooms.length)]
    const tx = dest.gridX + Math.floor(Math.random() * dest.width)
    const ty = dest.gridY + Math.floor(Math.random() * dest.height)

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

  _tickOrcPatrol(orc, gameState, dungeonGrid) {
    // 40% of the time when picking the next patrol target, pick a tile in
    // a connected neighbor room instead of the home room. The base wander
    // loop in _tickMinion handles the rest.
    if (orc._patrolTarget) return
    if ((orc._patrolAccum ?? 0) < 3000) return
    if (Math.random() >= ORC_NEIGHBOR_PATROL_PCT) return
    const neighbors = dungeonGrid?.getNeighborRooms?.(orc.assignedRoomId) ?? []
    if (!neighbors.length) return
    const dest = neighbors[Math.floor(Math.random() * neighbors.length)]
    if (!dest) return
    const rx = dest.gridX + Math.floor(Math.random() * dest.width)
    const ry = dest.gridY + Math.floor(Math.random() * dest.height)
    orc._patrolTarget = { x: rx, y: ry }
    orc._patrolAccum  = 0
  },

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
}

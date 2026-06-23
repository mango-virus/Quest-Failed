// Real-time combat resolution.
// Phase 6 kernel: typed damage, attack cooldowns, COMBAT_HIT / COMBAT_KILL events.
// Combat doesn't drive its own loop — the AI systems (adventurer + minion) call
// `tryAttack(attacker, target)` when they want to swing. CombatSystem enforces
// cooldown timing and damage math.
//
// Death cleanup (splice from active, push to graveyard, award gold) is the
// AI system's responsibility — CombatSystem only mutates HP and emits events.

import { EventBus }        from './EventBus.js'
import { AbilityVfx }      from '../ui/AbilityVfx.js'
import { rgbFloatingText } from '../util/cheaterVfx.js'
import { MinionAbilities } from './MinionAbilities.js'
import { Balance }         from '../config/balance.js'
import { TILE }            from './DungeonGrid.js'
import { PathfinderSystem } from './PathfinderSystem.js'
import { applyKnockback, knockbackSpeedFor } from '../util/knockback.js'

// ── Mage Elemental Arcana tuning ───────────────────────────────────────────
// The rolled element (fire/ice/lightning/wind) gives the mage's hits an
// intrinsic effect — modest per swing, amplified by Arcane Burst (strong=true).
const MAGE_BURN_PCT          = 0.25   // burn dmg/tick = this × the hit
const MAGE_BURN_TICKS        = 3
const MAGE_BURN_TICKS_STRONG = 4
const MAGE_BURN_INTERVAL_MS  = 1000
const MAGE_CHILL_MULT        = 0.60   // ice slow (move-speed ×)
const MAGE_CHILL_MS          = 1800
const MAGE_CHILL_MULT_STRONG = 0.45
const MAGE_CHILL_MS_STRONG   = 2600
const MAGE_ARC_PCT           = 0.45   // lightning chain damage fraction
const MAGE_ARC_PCT_STRONG    = 0.60
const MAGE_ARC_RANGE         = 3      // tiles a bolt can jump
const MAGE_ARC_CD_MS         = 1200   // per-mage gate on the normal-hit chain
const MAGE_ARC_CHAINS_STRONG = 3      // burst bolt hops
const MAGE_GUST_CD_MS        = 2500   // per-mage gate on the normal-hit shove
const MAGE_BURST_AOE_TILES   = 1.4
const MAGE_BURST_DMG_PCT     = 0.6

// Monk Riposte — a dodged hit counters for this fraction of the monk's attack.
const MONK_RIPOSTE_FRAC      = 0.8

// Beast Master Pack Tactics — flanking bonus when the BM and its tamed companion
// are BOTH adjacent to the same target.
const PACK_TACTICS_PCT       = 0.25

// Knight Bulwark — a directional shield-wall: allies sheltered behind/beside the
// Knight (toward the threat) take this much less damage, within this range.
const KNIGHT_BULWARK_REDUCTION = 0.35
const KNIGHT_BULWARK_RANGE     = 2.5

// Ranger Piercing Shot — every Nth arrow becomes a line shot that pierces every
// minion along the ranger→target ray (rewards the player for not lining them up).
const RANGER_PIERCE_EVERY    = 5
const RANGER_PIERCE_RANGE    = 6     // tiles the arrow travels
const RANGER_PIERCE_PERP     = 0.7   // half-width of the line
const RANGER_PIERCE_DMG_PCT  = 1.0   // damage to each pierced minion (vs the primary's hit)

const TS = Balance.TILE_SIZE

// Phase 6 — Gladiator Crowd Roar tuning. Each hostile minion the Gladiator
// fells adds an ATK stack; stacks cap and clear on death/flee. Both the
// increment (kill block) and the damage scaling (_computeDamage) live in this
// file, so the constants live here too (the ClassAbilitySystem ABILITY_DEFS
// entry is just a registry label, like ranger_piercing).
const CROWD_ROAR_PER_STACK  = 0.12   // +12% ATK per stack
const CROWD_ROAR_MAX_STACKS = 6      // → +72% ATK at full crowd
const UNDERDOG_PER_STACK    = 0.05   // +5% ATK per kill (the underdog aggression snowball)
const UNDERDOG_MAX_STACKS   = 10     // → +50% ATK cap

// Phase 6 — Peasant "Strength in Numbers": each OTHER living peasant within
// PEASANT_MOB_RADIUS tiles grants +PEASANT_MOB_PER_ALLY to BOTH the peasant's
// ATK (when attacking) and its damage-reduction (when attacked), capped at
// PEASANT_MOB_MAX_ALLIES. Per the locked spec: +8% atk/def per nearby peasant,
// max +32%. A lone peasant gets nothing. Legibility lives in ClassAbilitySystem.
const PEASANT_MOB_PER_ALLY   = 0.08  // +8% atk/def per nearby fellow peasant
const PEASANT_MOB_RADIUS     = 4     // tiles
const PEASANT_MOB_MAX_ALLIES = 4     // → +32% cap (4 × 8%)

// Phase 6 — Gambler "Roll the Dice". A d6 rolls on a gambler's swing, but only
// after the previous roll's ~1.1s tumble animation has settled, so it fires
// periodically (not literally every swing). Faces: 1=whiff, 2=normal, 3=house
// pays out (+gold to player), 4=double strike, 5=self-heal, 6=jackpot crit.
const GAMBLER_DICE_CD = 1100

export class CombatSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    // Knockback (Hit-reaction #2) — apply on any BIG hit (a tagged ability or a
    // %-maxHP threshold), to whoever got hit (adventurer OR dungeon minion). The
    // SLIDE itself runs in the AI ticks (tickKnockback); this just sets the impulse.
    EventBus.on('COMBAT_HIT', this._onHitKnockback, this)
  }

  destroy() {
    EventBus.off('COMBAT_HIT', this._onHitKnockback, this)
  }

  // Look up a combat entity by id across adventurers / minions / the boss.
  _kbLookup(id) {
    if (id == null) return null
    const gs = this._gameState
    if (gs.boss && (id === 'boss' || gs.boss.instanceId === id)) return gs.boss
    return (gs.adventurers?.active ?? []).find(a => a.instanceId === id)
        ?? (gs.minions ?? []).find(m => m.instanceId === id)
        ?? null
  }

  _onHitKnockback({ sourceId, targetId, damage, knockback } = {}) {
    if (!targetId || !(damage > 0)) return
    const gs = this._gameState, boss = gs.boss
    const target = this._kbLookup(targetId)
    if (!target || target === boss) return
    if (target.aiState === 'dead' || (target.resources?.hp ?? 0) <= 0) return
    // Boss-fight participants have their OWN knockback (BossSystem fs.vx) — don't
    // double-drive them.
    if (target.goal?.type === 'AT_BOSS') return
    // Only living adventurers + dungeon minions get dungeon knockback.
    const isAdv = !!target.classId && target.faction !== 'dungeon'
    const isMin = target.faction === 'dungeon' && !!target.definitionId
    if (!isAdv && !isMin) return
    const speed = knockbackSpeedFor(target, damage, knockback)
    if (speed <= 0) return
    // Push directly away from the attacker; skip if there's no positioned source
    // (e.g. an ambient DoT) so we never fling in a meaningless direction.
    const src = this._kbLookup(sourceId)
    if (!src || !Number.isFinite(src.worldX)) return
    applyKnockback(target, src.worldX, src.worldY, speed, this._scene?.time?.now ?? 0)
  }

  // attacker / target are entities (adventurer or minion) — both have stats.attack,
  // stats.defense, resources.hp, instanceId, classId or definitionId.
  // Returns: { hit: boolean, damage: number, killed: boolean } | null when on cooldown.
  tryAttack(attacker, target, opts = {}) {
    if (!attacker || !target) return null
    if (target.resources.hp <= 0) return null
    // Pacifist gate — an adv tagged _neverAttacks (e.g. a coward) stays a pure
    // support / non-combatant: anywhere the AI calls tryAttack(it, …) it
    // short-circuits here. Generic flag for any "never-attacks" adventurer / minion.
    if (attacker._neverAttacks) return null
    // Mage Tower POLYMORPH — a minion turned into a harmless critter can't swing
    // until the transmute expires (KingdomModifierSystem clears the flag).
    if (attacker._polymorphed) return null
    // Invulnerability — a target._invuln window fully suppresses damage: no hit
    // registered, no hurt animation, nothing. The flag is cleared by the system
    // that set it. Generic enough for any "invuln window" mechanic.
    if (target._invuln) return null

    // Doorway gate — combat only resolves when BOTH attacker and target
    // are fully in a room. An entity standing on a TILE.DOOR tile is
    // mid-passage and untouchable; the swinger has to wait for them to
    // step onto floor.
    const grid = this._scene?.dungeonGrid
    if (grid?.getTileType) {
      if (grid.getTileType(attacker.tileX, attacker.tileY) === TILE.DOOR) return null
      if (grid.getTileType(target.tileX,   target.tileY)   === TILE.DOOR) return null
    }

    // Same-room gate (2026-06-02, by user). NOTHING attacks across a doorway:
    // the attacker and target must be in the SAME room for any swing — melee
    // OR ranged — to land. Two entities on floor tiles either side of a shared
    // door are within raw attack range but in different rooms, so they can't
    // trade blows; a ranged class (mage / black mage, reach 4) likewise only
    // hits across its OWN room, never into the next one. getRoomAtTile is null
    // on a door/void tile so a null room never matches (belt-and-braces with
    // the doorway gate above). Corridors are rooms, so two entities in the same
    // corridor still fight. The AI engage paths mirror this (advs only target
    // same-room minions; minions path through the door before swinging) so
    // attackers close in rather than pacing at the threshold. Boss fight
    // (separate scene), traps (own LOS/room logic) and poison DoT don't route
    // through tryAttack, so they're unaffected.
    if (grid?.getRoomAtTile) {
      const aRoom = grid.getRoomAtTile(attacker.tileX, attacker.tileY)
      const tRoom = grid.getRoomAtTile(target.tileX, target.tileY)
      if (!aRoom || !tRoom || aRoom.instanceId !== tRoom.instanceId) return null
    }

    const now = this._scene.time.now
    // PANIC (nerve rework) — a terror-stricken hero cowers and CANNOT fight back; a
    // genuinely FLEEING hero is likewise too busy running to swing. Either way their
    // attacks are suppressed so your minions cut them down for free.
    if (attacker._panickedUntil != null && now < attacker._panickedUntil) return null
    if (attacker._despairUntil != null && now < attacker._despairUntil) return null   // DESPAIR affliction — given up, won't raise a weapon
    if (attacker._petrifiedUntil != null && now < attacker._petrifiedUntil) return null   // Beholder petrify — a statue can't swing
    if (attacker.faction !== 'dungeon' && attacker.aiState === 'fleeing') return null
    // Lizardman CAMOUFLAGE — heroes literally can't hit what they can't see. A
    // hard-guard backing the AISystem target-skip so no stray/AoE swing lands.
    if (target._camouflaged && attacker.faction !== 'dungeon') return null
    const cooldown = this._cooldownFor(attacker)
    if (now - (attacker.lastAttackAt ?? 0) < cooldown) return null

    // Phase 6 — Gladiator Block: while braced behind the Spartan hoplon he is
    // damage-IMMUNE (negated target-side below) but CANNOT swing. Skip his attack.
    if (attacker._blockActiveUntil && now < attacker._blockActiveUntil) return null

    // Pass-3 Ghost Possession — possessed adventurers redirect their swing
    // to a same-party ally for the duration of the possession buff.
    target = MinionAbilities.maybeRedirectPossessedAttack(attacker, target, this._gameState, this._scene)
    if (!target || target.resources.hp <= 0) return null

    // Range check. Must match the reach the AI engagement blocks use
    // (AISystem: `Math.max(attackRange ?? 1, MELEE_RANGE_TILES)`) — a
    // melee entity has `attackRange === 1`, so a bare `?? MELEE_RANGE`
    // never widens to 1.5 and the AI could engage a diagonally-adjacent
    // foe (dist ≈ 1.41) that this check then rejected forever, freezing
    // the attacker or making it pace at a doorway.
    const dx = target.tileX - attacker.tileX
    const dy = target.tileY - attacker.tileY
    const dist = Math.hypot(dx, dy)
    const reach = Math.max(attacker.attackRange ?? 1, Balance.MELEE_RANGE_TILES)
    if (dist > reach + 0.01) return null

    attacker.lastAttackAt = now
    // Phase QW — track target id for _inferMethod backstab detection.
    // Stored as id (not the object) so SaveSystem.JSON.stringify doesn't
    // hit a circular reference once adv-vs-adv combat (Hall of Madness)
    // leaves both parties alive in gameState across a save.
    attacker._lastAttackTargetId = target.instanceId

    // Phase 6 — Gambler Roll the Dice: tumble a d6 above the head when the prior
    // roll has settled. Whiff (1) misses outright; the other faces modify this
    // swing (damage faces below, payout/heal after the hit lands).
    let _diceFace = 0
    if ((attacker.classId ?? attacker._raisedClassId) === 'gambler' && (attacker._diceRollReadyAt ?? 0) <= now) {
      _diceFace = 1 + Math.floor(Math.random() * 6)
      attacker._diceRollReadyAt = now + GAMBLER_DICE_CD
      AbilityVfx.diceRoll?.(this._scene, attacker.worldX, (attacker.worldY ?? 0) - 36, _diceFace)
      EventBus.emit('ABILITY_TRIGGERED', { adventurer: attacker, abilityId: 'roll_the_dice', message: `${attacker.name} rolled a ${_diceFace}.` })
      if (_diceFace === 1) {  // whiff — the swing misses entirely
        AbilityVfx.floatingText(this._scene, attacker.worldX, (attacker.worldY ?? 0) - 20, 'WHIFF', { color: '#cc8866' })
        EventBus.emit('COMBAT_HIT', { sourceId: attacker.instanceId, targetId: target.instanceId, damage: 0, damageType: attacker.damageType ?? 'physical', isCritical: false })
        return { hit: false, whiffed: true }
      }
    }

    // Mushroom HALLUCINATION — a DAZED hero swings at phantoms: a chance to whiff
    // the swing entirely (reuses the whiff path). Only adventurers are dazed.
    if (attacker.faction !== 'dungeon') {
      const _dazeMiss = MinionAbilities.dazeMissChance(attacker, now)
      if (_dazeMiss > 0 && Math.random() < _dazeMiss) {
        AbilityVfx.floatingText(this._scene, attacker.worldX, (attacker.worldY ?? 0) - 20, 'MISS', { color: '#b98fd0', throttleKey: `${attacker.instanceId}:MISS`, throttleMs: 1500 })
        EventBus.emit('COMBAT_HIT', { sourceId: attacker.instanceId, targetId: target.instanceId, damage: 0, damageType: attacker.damageType ?? 'physical', isCritical: false })
        return { hit: false, whiffed: true }
      }
    }

    const damage     = this._computeDamage(attacker, target)
    // Phase 5c — Rogue Invisibility: if attacker is an invisible Rogue,
    // their attack is a guaranteed crit AND immediately reveals them.
    const rogueInvisCrit = (attacker.classId ?? attacker._raisedClassId) === 'rogue' && attacker._invisible
    const isCritical = rogueInvisCrit ? true : Math.random() < 0.10
    let   finalDmg   = isCritical ? Math.floor(damage * 1.5) : damage

    // PANIC / FLEE vulnerability (nerve rework) — a hero who has dropped their guard
    // takes +50% damage: terror-panicked (frozen, cowering) or genuinely fleeing
    // (running exposed, back turned). Makes "broke their nerve" cash out as a faster
    // kill for the player instead of a lost one.
    {
      const tNow = this._scene?.time?.now ?? 0
      const exposed = (target._panickedUntil != null && tNow < target._panickedUntil) ||
                      (target._despairUntil != null && tNow < target._despairUntil) ||
                      (target.faction !== 'dungeon' && target.aiState === 'fleeing')
      if (exposed && finalDmg > 0) finalDmg = Math.max(1, Math.round(finalDmg * 1.5))
      // Beholder GAZE hex — a hexed hero takes amplified damage for the window.
      const hex = MinionAbilities.gazeHexMul(target, tNow)
      if (hex > 1 && finalDmg > 0) finalDmg = Math.max(1, Math.round(finalDmg * hex))
    }

    // Gambler dice damage face 6 = jackpot crit (×2.5). Face 4 (double strike)
    // lands a SECOND separate hit after this one — handled post-hit below.
    if (_diceFace === 6) {
      finalDmg = Math.floor(finalDmg * 2.5)
      AbilityVfx.floatingText(this._scene, attacker.worldX, (attacker.worldY ?? 0) - 20, 'JACKPOT!', { color: '#ffe066', fontSize: '13px' })
    }

    if (rogueInvisCrit) {
      // Reveal the rogue.
      attacker._invisible = false
      attacker._invisibilityUntil = null
      this._scene.classAbilitySystem?._endInvisibility?.(attacker)
    }

    // Monk Riposte stance: while up, a 30% chance to DODGE the incoming hit and
    // instantly counter-strike the attacker. Read on the DEFENDER (target) via
    // `_focusActiveUntil` (only the monk sets it).
    if (target._focusActiveUntil && now < target._focusActiveUntil && Math.random() < 0.30) {
      AbilityVfx.floatingText(this._scene, target.worldX ?? 0, (target.worldY ?? 0) - 18, 'MISS', { color: '#eeeeff', throttleKey: `${target.instanceId}:MISS`, throttleMs: 1500 })
      EventBus.emit('COMBAT_HIT', {
        sourceId: attacker.instanceId, targetId: target.instanceId,
        damage: 0, damageType: attacker.damageType ?? 'physical', isCritical: false,
      })
      // Riposte counter — the dodge isn't just evasion, it's an opening. Strike
      // the attacker back for a fraction of the monk's attack (less their defense).
      if (attacker && (attacker.resources?.hp ?? 0) > 0) {
        const counter = Math.max(1, Math.floor((target.stats?.attack ?? 0) * MONK_RIPOSTE_FRAC) - (attacker.stats?.defense ?? 0))
        attacker.resources.hp = Math.max(0, attacker.resources.hp - counter)
        const rdir = ((attacker.tileX ?? 0) - (target.tileX ?? 0)) >= 0 ? 1 : -1
        AbilityVfx.riposteFx?.(this._scene, target.worldX, target.worldY, { dir: rdir })
        AbilityVfx.floatingText(this._scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 18, `RIPOSTE -${counter}`, { color: '#cfe9ff', fontSize: '11px' })
        EventBus.emit('COMBAT_HIT', { sourceId: target.instanceId, targetId: attacker.instanceId, damage: counter, damageType: 'physical', isCritical: false })
      }
      return { hit: false, dodged: true }
    }

    // Phase 6 — Gladiator Block: while braced behind the shield, the incoming
    // hit is fully negated (no damage, no kill). He cannot attack during the
    // window (gated at the top of tryAttack).
    if (target._blockActiveUntil && now < target._blockActiveUntil) {
      AbilityVfx.floatingText(this._scene, target.worldX ?? 0, (target.worldY ?? 0) - 18, 'BLOCK', { color: '#ffe08a', throttleKey: `${target.instanceId}:BLOCK`, throttleMs: 1500 })
      EventBus.emit('COMBAT_HIT', {
        sourceId: attacker.instanceId, targetId: target.instanceId,
        damage: 0, damageType: attacker.damageType ?? 'physical', isCritical: false,
      })
      return { hit: false, blocked: true }
    }

    // Knight Bulwark: a directional shield-wall — allies sheltered behind/beside
    // an aura-active Knight (toward the threat) take reduced damage.
    finalDmg = this._applyBulwark(attacker, target, finalDmg)

    // Dungeon event: Blood Moon Eclipse — minions deal 2× damage AND take
    // 2× damage. Symmetric so the day is a sharp risk/reward, not pure
    // upside. Boss treated as a minion for this scaling (he's on the
    // dungeon faction).
    if (this._gameState._eventFlags?.bloodMoonEclipseActive) {
      const attackerIsDungeon = attacker.faction === 'dungeon' || attacker === this._gameState.boss
      const targetIsDungeon   = target.faction   === 'dungeon' || target   === this._gameState.boss
      if (attackerIsDungeon || targetIsDungeon) finalDmg = Math.max(1, finalDmg * 2)
    }

    // LEGENDARY pact damage multipliers.
    const _lpf = this._gameState._mechanicFlags
    if (_lpf) {
      // The Iron Price — your minions (dungeon faction / boss) deal 2x damage.
      if (_lpf.theIronPrice && (attacker.faction === 'dungeon' || attacker === this._gameState.boss)) {
        finalDmg = Math.max(1, Math.round(finalDmg * (Balance.MECHANIC_IRON_PRICE_DMG_MULT ?? 2)))
      }
      // Sudden Death — EVERYONE deals 5x (yours and the adventurers alike).
      if (_lpf.suddenDeath) {
        finalDmg = Math.max(1, Math.round(finalDmg * (Balance.MECHANIC_SUDDEN_DEATH_DMG_MULT ?? 5)))
      }
    }

    // Bestiary COUNTER + VETERAN edge (AI Intelligence, Phase 4/5). Once the
    // kingdom has STUDIED an enemy type (a survivor faced it and escaped),
    // adventurers fight that minion type HARDER and take LESS from it (mastery-
    // scaled, stale → weaker). Returning VETERANS add a small always-on edge of
    // their own (battle-hardened, per prior run) — killing them removes it AND
    // drops the kingdom's mastery. Both push the player to keep varying forces.
    if (finalDmg > 0) {
      const _boss = this._gameState.boss
      const isAdv = (e) => !!e?.classId && e?.faction !== 'dungeon'
      const isMin = (e) => e?.faction === 'dungeon' && e !== _boss && !!e?.definitionId
      const _ks = this._scene?.knowledgeSystem
      const vetEdge = (e) => (isAdv(e) && e?.flags?.returningVeteran)
        ? Math.min(Balance.KNOWLEDGE_VETERAN_EDGE_CAP ?? 0.20, (e.flags.runsCompleted ?? 1) * (Balance.KNOWLEDGE_VETERAN_EDGE_PER_RUN ?? 0.04))
        : 0
      if (isAdv(attacker) && isMin(target)) {
        const c = _ks?.getEnemyCounter?.(target)
        const studied = c?.known ? (Balance.KNOWLEDGE_COUNTER_DMG_BONUS_MAX ?? 0.25) * c.strength : 0
        const mult = 1 + studied + vetEdge(attacker)
        if (mult !== 1) finalDmg = Math.max(1, Math.round(finalDmg * mult))
      } else if (isMin(attacker) && isAdv(target)) {
        const c = _ks?.getEnemyCounter?.(attacker)
        const studied = c?.known ? (Balance.KNOWLEDGE_COUNTER_DR_MAX ?? 0.20) * c.strength : 0
        const mult = Math.max(0.1, 1 - studied - vetEdge(target))
        if (mult !== 1) finalDmg = Math.max(1, Math.round(finalDmg * mult))
      }
    }

    // Lizardman CAMOUFLAGE — a strike FROM concealment is a devastating ambush
    // (×ambushMul); landing it REVEALS the lizardman (clears _camouflaged) so the
    // party gets a window to punish before it can slink back into hiding.
    if (attacker._camouflaged && attacker.faction === 'dungeon' && finalDmg > 0) {
      finalDmg = Math.max(1, Math.round(finalDmg * MinionAbilities.ambushStrikeMul(attacker, this._scene)))
      MinionAbilities.revealCamouflage(attacker, this._scene)
    }

    // Silence Ward "Dead Zone" (tinkered) — a silenced adventurer (in the
    // ward's coverage) takes +15% damage. Reads the per-tick coverage set
    // stamped by ClassAbilitySystem so there's no per-hit neighbour walk.
    if (finalDmg > 0 && target?.faction !== 'dungeon' && target?.classId &&
        (this._gameState._tinkeredRoomTypes ?? []).includes('silence_ward') &&
        this._inSilenceWard(target)) {
      finalDmg = Math.max(1, Math.round(finalDmg * 1.15))
    }

    // Dungeon event: Dungeon Pestilence — when an adventurer melees a
    // dungeon-faction minion, they get infected with Blight. AISystem
    // ticks the DoT until the adv dies or escapes.
    if (
      this._gameState._eventFlags?.pestilenceActive &&
      attacker.faction !== 'dungeon' &&
      target.faction   === 'dungeon' &&
      (attacker.stats?.attackRange ?? 1) <= 1
    ) {
      attacker._blighted = true
    }

    // Dungeon event: Cosplay Contest — passive cosplayers were ignoring
    // minions; the moment one lands a hit, that adv "snaps out of it"
    // and engages from then on. Flag flip is one-way for the day.
    if (
      this._gameState._eventFlags?.cosplayContestActive &&
      attacker.faction === 'dungeon' &&
      target._cosplay
    ) {
      target._provoked = true
    }

    // ── Cheater offense hooks (attacker side) ─────────────────────────
    // Skipped when the cheater has been "reported and banned" — the
    // modded client is locked out at that point and they fight like
    // a normal adv until they escape (or die).
    if (attacker.classId === 'cheater' && !attacker._banned) {
      // First-shot aimbot — first attack in each new room is auto-crit
      // (2× the post-mitigation damage). Stored as an Array (not a Set)
      // so SaveSystem's JSON.stringify round-trips it cleanly — Sets
      // serialize to {} and the cheater would re-fire HEADSHOT in every
      // room they'd already cleared on load.
      const advRoom = this._scene.dungeonGrid?.getRoomAtTile?.(attacker.tileX, attacker.tileY)
      if (advRoom?.instanceId) {
        attacker._firstShotRooms ??= []
        if (!attacker._firstShotRooms.includes(advRoom.instanceId)) {
          attacker._firstShotRooms.push(advRoom.instanceId)
          finalDmg = Math.max(1, finalDmg * 2)
          rgbFloatingText(this._scene, target.worldX ?? 0,
            (target.worldY ?? 0) - 22, 'HEADSHOT')
        }
      }
      // Lag spike — 5% per attack: double damage but the cheater
      // freezes for ~1 s after (AISystem reads _lagStunUntil to
      // suppress movement, giving the player a counter-window).
      if (Math.random() < (Balance.CHEATER_LAG_SPIKE_CHANCE ?? 0.05)) {
        finalDmg = Math.max(1, finalDmg * 2)
        attacker._lagStunUntil = now + (Balance.CHEATER_LAG_STUN_MS ?? 1000)
        rgbFloatingText(this._scene, attacker.worldX ?? 0,
          (attacker.worldY ?? 0) - 32, 'LAG SPIKE')
      }
      // Aimhack instakill — during the 2 s window every 8 s, % chance
      // per swing to set damage = target's full HP. Minions only —
      // bosses and other advs are off-limits (would feel awful).
      // PATCH 0.0.0 event bumps the chance from 0.15 to 0.25.
      const aimhackActive = (attacker._aimhackUntil ?? 0) > now
      const patchZero = !!(this._gameState._eventFlags?.patchZeroActive)
      const instakillChance = patchZero
        ? (Balance.PATCH_ZERO_INSTAKILL_CHANCE ?? 0.25)
        : (Balance.CHEATER_INSTAKILL_CHANCE ?? 0.15)
      const targetIsMinion = target.faction === 'dungeon' && target !== this._gameState.boss
      if (aimhackActive && targetIsMinion && Math.random() < instakillChance) {
        finalDmg = Math.max(target.resources?.hp ?? 0, finalDmg)
        rgbFloatingText(this._scene, target.worldX ?? 0,
          (target.worldY ?? 0) - 40, 'AIMBOT', { fontSize: '14px' })
      }
    }

    // ── Cheater defense hook (target side) ────────────────────────────
    // Each minion / boss hit on a cheater increments their "reports"
    // counter. At threshold the modded client is auto-banned — they
    // lose all cheats and the next AI tick triggers a forced flee.
    // ClassAbilitySystem._considerCheater consumes the threshold and
    // emits the BANNED floater + flee handoff.
    //
    // The REPORTED floater is throttled to once every 2 s per cheater.
    // During PATCH 0.0.0 the ban threshold is disabled (anti-cheat OFF)
    // and the counter never trips, so without the throttle a cheater
    // taking many hits per fight would spawn a floater on every swing
    // and pile dozens of REPORTED labels above their head.
    if (target.classId === 'cheater' && !target._banned && attacker.faction === 'dungeon') {
      target._reportCount = (target._reportCount ?? 0) + 1
      const REPORT_FLOATER_COOLDOWN_MS = 2000
      if (now - (target._lastReportFloaterAt ?? -Infinity) >= REPORT_FLOATER_COOLDOWN_MS) {
        target._lastReportFloaterAt = now
        rgbFloatingText(this._scene, target.worldX ?? 0,
          (target.worldY ?? 0) - 30, 'REPORTED')
      }
    }

    // The Nemesis (Aldric) can't be dropped below 10% max HP by minions (only
    // the boss duel can finish him). Floor the hit here so his HP bar visibly
    // bottoms out at 10% instead of flashing to 0 before AISystem._kill bounces
    // him back.
    const _smFloor = target._nemesis
      ? Math.max(1, Math.ceil((target.resources.maxHp ?? 1) * 0.10)) : 0

    // Forlorn Hope — Captain Halric's "Last Vow": the FIRST lethal hit can't kill
    // him. It clamps him to 1 HP and triggers a fury roar (KingdomModifierSystem
    // listens for FORLORN_LAST_VOW). Once spent, the next lethal hit lands for real.
    // Same reactive-trigger mould as Lay on Hands / Grog Rage below.
    let _lastVowFloor = 0
    if (target._lastVow && !target._lastVowUsed && finalDmg > 0 &&
        target.resources.hp > 0 && (target.resources.hp - finalDmg) <= 0) {
      _lastVowFloor = 1
      target._lastVowUsed = true
      EventBus.emit('FORLORN_LAST_VOW', { adventurer: target })
    }

    // Vampire Bloodgorge — a banked blood-shield (overheal) soaks damage before HP.
    if (finalDmg > 0 && target._bloodShield > 0) finalDmg = MinionAbilities.absorbBloodShield(target, finalDmg, this._scene)

    target.resources.hp = Math.max(Math.max(_smFloor, _lastVowFloor), target.resources.hp - finalDmg)

    // Ent THORNS — a MELEE hero that just struck a thorned ent takes reflect damage
    // straight back (the tree punishes everything that touches it). No-op for non-ents.
    if (finalDmg > 0 && target.faction === 'dungeon' && attacker.faction !== 'dungeon') {
      MinionAbilities.thornsReflect(target, attacker, finalDmg, this._scene)
    }

    // Bramble Hall (room 2026-06-17) — an adventurer who attacks while standing
    // inside an active Bramble Hall takes a share of the damage they dealt back
    // as thorns (room-based, independent of what they hit).
    if (finalDmg > 0 && attacker.faction !== 'dungeon' && attacker.classId) {
      this._brambleHallReflect(attacker, finalDmg)
    }

    // Lizardman CAMOUFLAGE — a T2+ stalker that lands the KILLING blow vanishes
    // instantly (a clean getaway), re-cloaking before the body even drops.
    if (attacker.faction === 'dungeon' && target.faction !== 'dungeon' && target.resources.hp <= 0) {
      MinionAbilities.maybeKillRecamo(attacker, this._scene)
    }

    // Rat SWARM — every rat bite gets a gnashing chomp on the hero; a whole pack
    // biting reads as being swarmed and gnawed (small, fast VFX-only flourish).
    if (finalDmg > 0 && attacker.faction === 'dungeon' && target.faction !== 'dungeon' &&
        Array.isArray(attacker.tags) && attacker.tags.includes('rat') && Number.isFinite(target.worldX)) {
      AbilityVfx.gnashFx?.(this._scene, target.worldX, target.worldY, { dir: (attacker.tileX ?? 0) <= (target.tileX ?? 0) ? 1 : -1 })
    }

    // Templar "Lay on Hands" — reactive holy self-heal the first time a Templar
    // is chipped below the threshold (once per delve). Fires AFTER the hit lands.
    if (finalDmg > 0) this._maybeLayOnHands(target)
    // Pirate "Grog Rage" — reactive berserk the first time a Pirate is chipped
    // below the threshold (once per delve). Also fires AFTER the hit lands.
    if (finalDmg > 0) this._maybeGrogRage(target)

    // The Nemesis (Aldric) reacts to being chipped — a hurt grunt + an escalating
    // rattled→annoyed→enraged face. Fired raw per hit; NemesisSystem throttles.
    if (target._nemesis && finalDmg > 0) {
      EventBus.emit('NEMESIS_HURT', {
        adventurer: target,
        hpFrac: (target.resources.hp ?? 0) / (target.resources.maxHp ?? 1),
      })
    }

    // DAMNED · Brittle Bones — a dungeon minion that drops below half HP from
    // a hit shatters outright (the existing `killed` check below handles the
    // death + MINION_DIED emit once hp is 0).
    if (target.faction === 'dungeon' && target.resources.hp > 0) {
      const _bb = this._gameState._mechanicFlags ?? {}
      if (_bb.brittleBones &&
          target.resources.hp < (target.resources.maxHp ?? 1) * (Balance.MECHANIC_BRITTLE_BONES_SHATTER_FRAC ?? 0.5)) {
        target.resources.hp = 0
        EventBus.emit('BRITTLE_BONES_SHATTERED', { minionId: target.instanceId })
      }
    }

    const damageType = attacker.damageType
      ?? attacker.stats?.damageType
      ?? 'physical'
    const method = opts.method ?? this._inferMethod(attacker, damageType)

    // (Lizardman Camouflage reveal was wiped with the per-minion quirks.)

    // Ranged-attack projectile VFX. Fires whenever the attacker's
    // attackRange exceeds melee (1) so ranged minions (lich heal beam,
    // ghost spook, mimic snap, ranger arrow, etc.) read visually instead
    // of damage appearing at the target with no travel cue. Color is
    // keyed by damageType so the projectile reads thematically.
    if ((attacker.attackRange ?? 1) > 1 &&
        Number.isFinite(attacker.worldX) && Number.isFinite(target.worldX)) {
      const projColor =
        damageType === 'fire'      ? 0xff8844 :
        damageType === 'frost' || damageType === 'ice' ? 0x88ddff :
        damageType === 'arcane' || damageType === 'magic' ? 0xaaccff :
        damageType === 'poison'    ? 0x88dd66 :
        damageType === 'psychic'   ? 0xcc88ff :
        damageType === 'shadow' || damageType === 'necrotic' ? 0x6644aa :
        damageType === 'acid'      ? 0xccff66 :
        0xfff0aa
      AbilityVfx.projectile(this._scene,
        attacker.worldX, attacker.worldY - 8,
        target.worldX,   target.worldY - 8,
        { color: projColor, durationMs: 200, radius: 3 })
    }

    EventBus.emit('COMBAT_HIT', {
      sourceId: attacker.instanceId,
      targetId: target.instanceId,
      damage:   finalDmg,
      damageType,
      isCritical,
    })

    // Gambler dice post-hit faces: 3 = house pays out (+gold to the PLAYER),
    // 4 = double strike (a SECOND identical blow lands this swing), 5 = self-heal.
    if (_diceFace === 3) {
      const payout = Balance.GOLD_PER_KILL ?? 10
      this._gameState.player ??= {}
      this._gameState.player.gold = (this._gameState.player.gold ?? 0) + payout
      EventBus.emit('RESOURCES_AWARDED', { gold: payout, source: 'gambler_dice' })
      AbilityVfx.floatingText(this._scene, attacker.worldX, (attacker.worldY ?? 0) - 20, `HOUSE PAYS +${payout}g`, { color: '#ffd34d', fontSize: '12px' })
    } else if (_diceFace === 4 && target.resources.hp > 0) {
      // Double strike — land a second hit of the same damage (two distinct blows,
      // per spec), honouring the same Nemesis 10% HP floor.
      const fl = target._nemesis
        ? Math.max(1, Math.ceil((target.resources.maxHp ?? 1) * 0.10)) : 0
      target.resources.hp = Math.max(fl, target.resources.hp - finalDmg)
      EventBus.emit('COMBAT_HIT', { sourceId: attacker.instanceId, targetId: target.instanceId, damage: finalDmg, damageType, isCritical: false })
      AbilityVfx.floatingText(this._scene, attacker.worldX, (attacker.worldY ?? 0) - 20, 'DOUBLE!', { color: '#ffd34d', fontSize: '12px' })
    } else if (_diceFace === 5) {
      const heal = Math.max(1, Math.floor((attacker.resources?.maxHp ?? 0) * 0.15))
      const before = attacker.resources.hp
      attacker.resources.hp = Math.min(attacker.resources.maxHp ?? before, before + heal)
      const restored = attacker.resources.hp - before
      if (restored > 0) AbilityVfx.floatingText(this._scene, attacker.worldX, (attacker.worldY ?? 0) - 20, `+${restored}`, { color: '#a4ffb0', fontSize: '12px' })
    }

    // Pass-1 minion abilities — on-hit hooks (Plague Bite, Hellfire Brand,
    // Bloodthirst, Petrify Gaze, Earthshake, Pickpocket, Greedy Bite, Snare).
    MinionAbilities.onHit(this._scene, attacker, target, finalDmg, this._gameState)

    // Mage Elemental Arcana — the rolled element flavors EVERY mage hit (modest;
    // lightning/wind gated so they don't oppress), then Arcane Burst amplifies it.
    if ((attacker.classId === 'mage' || attacker._raisedClassId === 'mage') &&
        target.faction !== 'adventurer' && target.resources?.hp > 0) {
      this._applyMageElement(attacker, target, finalDmg, false)
    }

    // Mage Arcane Burst — element-DEFINED amplifier (consumes the queued flag).
    // fire/ice/wind = radial AoE; lightning = a branching bolt (distinct shape).
    if (attacker.classId === 'mage' && attacker._arcaneBurstQueued) {
      attacker._arcaneBurstQueued = false
      this._fireArcaneBurst(attacker, target, finalDmg, damageType)
    }

    // Ranger Piercing Shot: every Nth arrow becomes a LINE shot that pierces
    // every minion in a row along the ranger→target ray (through the primary and
    // beyond), each for full damage. Rewards the player for NOT lining minions up.
    if (attacker.classId === 'ranger') {
      attacker._shotCount = (attacker._shotCount ?? 0) + 1
      if (attacker._shotCount % RANGER_PIERCE_EVERY === 0) {
        const ax = attacker.tileX, ay = attacker.tileY
        const len = Math.hypot(target.tileX - ax, target.tileY - ay) || 1
        const ux = (target.tileX - ax) / len, uy = (target.tileY - ay) / len
        let pierced = 0
        for (const m of this._gameState.minions ?? []) {
          if (m === target) continue   // primary already took the normal hit
          if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
          if (m.faction === 'adventurer') continue
          const relx = m.tileX - ax, rely = m.tileY - ay
          const along = relx * ux + rely * uy
          if (along < 0.5 || along > RANGER_PIERCE_RANGE + 0.01) continue
          if (Math.abs(relx * uy - rely * ux) > RANGER_PIERCE_PERP) continue
          const pd = Math.max(1, Math.floor(finalDmg * RANGER_PIERCE_DMG_PCT))
          m.resources.hp = Math.max(0, m.resources.hp - pd)
          EventBus.emit('COMBAT_HIT', { sourceId: attacker.instanceId, targetId: m.instanceId, damage: pd, damageType, isCritical: false })
          pierced++
        }
        const TS = Balance.TILE_SIZE
        AbilityVfx.piercingArrowFx?.(this._scene, attacker.worldX, attacker.worldY, (ax + ux * RANGER_PIERCE_RANGE) * TS + TS / 2, (ay + uy * RANGER_PIERCE_RANGE) * TS + TS / 2)
        AbilityVfx.floatingText(this._scene, attacker.worldX, attacker.worldY - 22, pierced > 0 ? `PIERCE ×${pierced}` : 'PIERCE', { color: '#aaffaa' })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: attacker, abilityId: 'piercing_shot', message: `${attacker.name} loosed a piercing shot.` })
      }
    }

    // The Undying Court — a fatally-struck DUNGEON minion gets a last-chance
    // save (a revived gambler's Double-or-Nothing, or a nearby revived cleric /
    // valkyrie revive) BEFORE the kill is finalized. A save restores HP > 0, so
    // `killed` below reads false and the death is averted.
    if (target.resources.hp <= 0 && target.faction === 'dungeon' &&
        (this._gameState._mechanicFlags ?? {}).theUndyingCourt) {
      this._scene.classAbilitySystem?.attemptCourtMinionDeathSave?.(target)
    }

    const killed = target.resources.hp <= 0
    if (killed) {
      // Record kill on attacker's history BEFORE emitting the event so
      // subscribers (EvolutionSystem) see the up-to-date list.
      if (Array.isArray(attacker.killHistory)) {
        attacker.killHistory.push({
          targetId:    target.instanceId,
          targetClass: target.classId ?? target.definitionId ?? 'unknown',
          damageType,
          method,
          day:         this._gameState.meta.dayNumber,
        })
      }
      EventBus.emit('COMBAT_KILL', {
        sourceId:   attacker.instanceId,
        targetId:   target.instanceId,
        damageType,
        method,
        roomId:     opts.roomId ?? null,
        day:        this._gameState.meta.dayNumber,
      })

      // Phase 6 — Gladiator Crowd Roar: felling a hostile minion stokes the
      // crowd (+1 ATK stack, capped). Only dungeon-faction minion kills count
      // (the boss kill ends the run, so it's moot there).
      // A revived gladiator MINION stokes the crowd by felling living
      // ADVENTURERS (it defends, so it never kills dungeon minions); a living
      // gladiator stokes it by felling dungeon minions (unchanged).
      const _roarCls  = attacker.classId ?? attacker._raisedClassId
      const _roarKill = attacker._revivedAdv ? (target.classId !== undefined) : (target.faction === 'dungeon')
      if (_roarCls === 'gladiator' && _roarKill && target !== this._gameState.boss) {
        const prev = attacker._crowdRoarStacks ?? 0
        if (prev < CROWD_ROAR_MAX_STACKS) {
          const s = attacker._crowdRoarStacks = prev + 1
          AbilityVfx.crowdRoarFx?.(this._scene, attacker.worldX, attacker.worldY, { stacks: s })
          AbilityVfx.floatingText(this._scene, attacker.worldX, attacker.worldY - 30, s >= CROWD_ROAR_MAX_STACKS ? 'ROAR! MAX' : `ROAR! x${s}`, { color: '#ffcf6b', fontSize: '13px' })
          EventBus.emit('ABILITY_TRIGGERED', { adventurer: attacker, abilityId: 'crowd_roar', message: `${attacker.name} feeds on the crowd (Roar x${s}).` })
        }
      }
    }

    return { hit: true, damage: finalDmg, killed, damageType, method }
  }

  // Cleric heal action: targets an ally adventurer instead of an enemy.
  // Heals for `amount` HP (default 12). Cooldown gating now lives in the new
  // AbilitySystem (Phase 5b); this method is invoked by the Cleric Heal
  // ability handler, which has already verified its cooldown is ready.
  // Emits ALLY_HEALED so traps (mercy_trap) and other systems can react.
  tryHeal(healer, target, opts = {}) {
    if (!healer || !target) return null
    if (target.resources.hp >= target.resources.maxHp) return null
    if (target.aiState === 'dead' || target.resources.hp <= 0) return null
    if (target._noHealUntil && (this._scene?.time?.now ?? 0) < target._noHealUntil) return null   // Gnoll Blood Frenzy

    const now = this._scene.time.now
    const cooldown = this._cooldownFor(healer)
    if (now - (healer.lastAttackAt ?? 0) < cooldown) return null

    // Range check (heal needs to be next to or near target)
    const dist = Math.hypot(target.tileX - healer.tileX, target.tileY - healer.tileY)
    if (dist > Balance.HEAL_RANGE_TILES + 0.01) return null

    healer.lastAttackAt = now

    const amount = opts.amount ?? Balance.CLERIC_HEAL_AMOUNT
    const before = target.resources.hp
    target.resources.hp = Math.min(target.resources.maxHp, target.resources.hp + amount)
    const restored = target.resources.hp - before

    EventBus.emit('ALLY_HEALED', {
      sourceId: healer.instanceId,
      targetId: target.instanceId,
      amount: restored,
      roomId: opts.roomId ?? null,
    })
    return { healed: restored }
  }

  // Templar "Lay on Hands" — a reactive holy self-heal. The first time a Templar
  // is chipped below TEMPLAR_LAY_ON_HANDS_THRESHOLD of max HP, it heals
  // TEMPLAR_LAY_ON_HANDS_FRAC of max HP, once per delve (layOnHandsUsedToday is
  // reset nightly in AISystem). Plays a holy column-of-light + god-rays + a
  // golden floater and emits ALLY_HEALED so the heal SFX + HP bar jump read
  // clearly to the player. Called from tryAttack right after damage lands.
  _maybeLayOnHands(adv) {
    if (!adv || adv.classId !== 'templar') return
    if ((adv.resources?.hp ?? 0) <= 0) return
    if (adv._noHealUntil && (this._scene?.time?.now ?? 0) < adv._noHealUntil) return   // Gnoll Blood Frenzy
    if ((adv.layOnHandsUsedToday ?? 0) >= 1) return
    const maxHp = adv.resources?.maxHp ?? 0
    if (maxHp <= 0) return
    const threshold = Balance.TEMPLAR_LAY_ON_HANDS_THRESHOLD ?? 0.35
    if (adv.resources.hp >= maxHp * threshold) return

    adv.layOnHandsUsedToday = 1
    const heal    = Math.ceil(maxHp * (Balance.TEMPLAR_LAY_ON_HANDS_FRAC ?? 0.5))
    const before  = adv.resources.hp
    adv.resources.hp = Math.min(maxHp, before + heal)
    const restored = adv.resources.hp - before

    const x = adv.worldX ?? 0
    const y = adv.worldY ?? 0
    AbilityVfx.beamPillar?.(this._scene, x, y, { color: 0xfff2c0 })
    AbilityVfx.godRays?.(this._scene, x, y - 8, { color: 0xffe9a0, durationMs: 700 })
    AbilityVfx.floatingText?.(this._scene, x, y - 34, '✝ LAY ON HANDS', { color: '#ffe9a0' })

    EventBus.emit('ALLY_HEALED', { sourceId: adv.instanceId, targetId: adv.instanceId, amount: restored })
    EventBus.emit('TEMPLAR_LAY_ON_HANDS', { adventurer: adv, amount: restored })
  }

  // Pirate "Grog Rage" — when a Pirate is first chipped below
  // PIRATE_GROG_THRESHOLD it swigs grog and goes berserk for the rest of the
  // delve: its attack + swing/move speed surge (read off `grogRagedToday` in
  // _computeDamage + _cooldownFor) and it stops fleeing (AISystem checks the
  // same flag). Once per delve (reset nightly in AISystem). Called from
  // tryAttack right after damage lands.
  _maybeGrogRage(adv) {
    if (!adv || adv.classId !== 'pirate') return
    if ((adv.resources?.hp ?? 0) <= 0) return
    if (adv.grogRagedToday) return
    const maxHp = adv.resources?.maxHp ?? 0
    if (maxHp <= 0) return
    if (adv.resources.hp >= maxHp * (Balance.PIRATE_GROG_THRESHOLD ?? 0.4)) return

    adv.grogRagedToday = 1
    const x = adv.worldX ?? 0
    const y = adv.worldY ?? 0
    AbilityVfx.particleBurst?.(this._scene, x, y - 8, { color: 0xff7a2a, count: 14 })
    AbilityVfx.pulseRing?.(this._scene, x, y, { color: 0xff7a2a })
    AbilityVfx.floatingText?.(this._scene, x, y - 34, '🍺 GROG!', { color: '#ff9a3a' })
    EventBus.emit('PIRATE_GROG_RAGE', { adventurer: adv })
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _cooldownFor(entity) {
    let speed = entity.stats?.speed ?? 1.0

    // (Orc Berserker Rage was wiped with the ground-up redesign.)

    // Pirate Grog Rage — berserk swing speed (set by _maybeGrogRage).
    if (entity.grogRagedToday) speed *= (Balance.PIRATE_GROG_SPD_MULT ?? 1.3)

    return Balance.ATTACK_INTERVAL_MS / Math.max(0.5, speed)
  }

  // Phase 6 — count OTHER living peasants within PEASANT_MOB_RADIUS of `peasant`
  // (capped at PEASANT_MOB_MAX_ALLIES). Drives both halves of Strength in Numbers.
  _peasantMobCount(peasant) {
    let n = 0
    // Side-aware (The Undying Court): a revived peasant MINION mobs with other
    // revived peasant minions; a living peasant mobs with living peasants. For
    // living peasants this is byte-identical to the original scan.
    const revived = peasant._revivedAdv === true
    const pool = revived ? (this._gameState.minions ?? []) : (this._gameState.adventurers?.active ?? [])
    for (const a of pool) {
      if (a === peasant) continue
      if ((a.classId ?? a._raisedClassId) !== 'peasant') continue
      if (revived && a._revivedAdv !== true) continue
      if (a.aiState === 'dead' || a.resources?.hp <= 0) continue
      const d = Math.hypot((a.tileX ?? 0) - (peasant.tileX ?? 0), (a.tileY ?? 0) - (peasant.tileY ?? 0))
      if (d <= PEASANT_MOB_RADIUS + 0.01 && ++n >= PEASANT_MOB_MAX_ALLIES) break
    }
    return n
  }

  _computeDamage(attacker, target) {
    let raw = attacker.stats?.attack ?? 1

    // Pirate Grog Rage — berserk attack boost (set by _maybeGrogRage).
    if (attacker.grogRagedToday) raw = Math.round(raw * (Balance.PIRATE_GROG_ATK_MULT ?? 1.5))

    // Phase: items — Soul-Bound Beacon damage buff. The flag + multiplier
    // are set/cleared by MinionAISystem._tickBeaconBuffs as the minion
    // enters/leaves a beacon room.
    if (attacker._beaconBuffed && attacker._beaconBuffMul) {
      raw = Math.floor(raw * attacker._beaconBuffMul)
    }

    // Phase 5c — Bard Inspire Party: same-party advs within 2 tiles of an
    // inspire-active Bard get +15% attack damage.
    raw = this._applyInspireBuff(attacker, raw)

    // Phase QW — Echo minion mimics the last-seen adventurer's class. We
    // route damage flavor through that class for free.
    // The Undying Court — a revived adventurer minion carries no `classId`
    // (it's a dungeon minion), so fall back to `_raisedClassId` to fire its
    // class's combat passives. Inert for living advs (they always have classId).
    const cls = attacker.mimickedClassId ?? attacker.classId ?? attacker._raisedClassId

    // Mage — Arcane Mastery: free-casting (mana removed in Phase 5b cooldown
    // rework) with a flat +30% spell-power passive. Replaces the old Elemental
    // Affinity (+50% vs a target's elemental weakness), which retired with the
    // vulnerability system (2026-06-10). Arcane Burst (cooldown ability) flags
    // the next spell as AoE — the AoE pass is handled below in tryAttack.
    if (cls === 'mage') {
      raw = Math.floor(raw * 1.3)
    }

    // Phase 5c — Barbarian Rage Scaling: damage = base × (1 + (1 − hpFrac))
    // up to 2× at 1 HP. Always-on passive.
    if (cls === 'barbarian') {
      const frac = attacker.resources?.maxHp > 0
        ? attacker.resources.hp / attacker.resources.maxHp : 1
      raw = Math.floor(raw * (1 + (1 - frac)))
    }

    // Phase 6 — Gladiator Crowd Roar: kill-stacking ATK (stacks incremented in
    // the kill block below, cleared on death/flee by ClassAbilitySystem).
    if (cls === 'gladiator' && attacker._crowdRoarStacks > 0) {
      const stacks = Math.min(attacker._crowdRoarStacks, CROWD_ROAR_MAX_STACKS)
      raw = Math.floor(raw * (1 + stacks * CROWD_ROAR_PER_STACK))
    }

    // Underdog (AI overhaul) — aggression snowball: a small stacking ATK buff per
    // kill (only underdogs carry _underdogStacks, set in EvolutionSystem), pairing
    // the personality's nerve-emboldenment + 2× XP with a tangible damage climb.
    if (attacker._underdogStacks > 0) {
      const stacks = Math.min(attacker._underdogStacks, UNDERDOG_MAX_STACKS)
      raw = Math.floor(raw * (1 + stacks * UNDERDOG_PER_STACK))
    }

    // Phase 6 — Peasant Strength in Numbers (offensive half): a mobbed peasant
    // hits harder. +8% ATK per nearby fellow peasant, capped at +32%.
    if (cls === 'peasant') {
      const allies = this._peasantMobCount(attacker)
      if (allies > 0) raw = Math.floor(raw * (1 + allies * PEASANT_MOB_PER_ALLY))
    }
    // Defensive half: a mobbed peasant TARGET takes less damage — same +8%/ally,
    // cap +32%, applied as a damage reduction (the "+def" side of the buff).
    if ((target.classId ?? target._raisedClassId) === 'peasant') {
      const dAllies = this._peasantMobCount(target)
      if (dAllies > 0) raw = Math.max(1, Math.floor(raw * (1 - dAllies * PEASANT_MOB_PER_ALLY)))
    }

    // Phase 5c — Necromancer Bone Armor: +N ATK while active (N = current
    // raised undead count at activation time, captured on the entity).
    if (cls === 'necromancer' && attacker._boneArmorUntil && this._scene.time.now < attacker._boneArmorUntil) {
      raw += attacker._boneArmorAtk ?? 0
    }

    // Cleric: smite_undead — +50% damage versus undead-tagged targets (passive
    // class trait; not an ability slot anymore).
    if (cls === 'cleric' && _isUndead(target)) {
      raw = Math.floor(raw * 1.5)
    }

    // Beast Master Pack Tactics — the BM and its tamed companion get a flanking
    // bonus when BOTH are adjacent to the same target. Applies to the BM's hits
    // (find the companion) and the companion's hits (find the BM). Counterplay:
    // kill the beast to defang the pair.
    if (cls === 'beast_master') {
      const comp = (this._gameState.minions ?? []).find(m =>
        m.tamedByAdvId === attacker.instanceId && m.faction === 'adventurer' &&
        m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0)
      if (comp && Math.hypot((comp.tileX ?? 0) - target.tileX, (comp.tileY ?? 0) - target.tileY) <= 1.5) {
        raw = Math.floor(raw * (1 + PACK_TACTICS_PCT))
        const _now = this._scene?.time?.now ?? 0
        if (_now - (attacker._packFlankAt ?? 0) > 900) { attacker._packFlankAt = _now; AbilityVfx.packFlankFx?.(this._scene, target.worldX, target.worldY) }
      }
    } else if (attacker.tamedByAdvId) {
      const bm = (this._gameState.adventurers?.active ?? []).find(a => a.instanceId === attacker.tamedByAdvId)
      if (bm && Math.hypot((bm.tileX ?? 0) - target.tileX, (bm.tileY ?? 0) - target.tileY) <= 1.5) {
        raw = Math.floor(raw * (1 + PACK_TACTICS_PCT))
        const _now = this._scene?.time?.now ?? 0
        if (_now - (bm._packFlankAt ?? 0) > 900) { bm._packFlankAt = _now; AbilityVfx.packFlankFx?.(this._scene, target.worldX, target.worldY) }
      }
    }

    // Ranger: arrows removed in 5c rework. Free-shooting now; Volley proc
    // and Trap Expert ability replace the resource gating. Each 5th shot
    // becomes a Volley — see tryAttack for the multi-target dispatch.
    // Below stub kept for compatibility but no longer applies arrow logic.
    if (false && cls === 'ranger') {
      const arrows = attacker.resources?.arrows ?? 0
      if (arrows > 0) {
        attacker.resources.arrows = arrows - 1
      } else {
        raw = Math.max(1, Math.floor(raw * 0.4))   // tired-ranger close-quarters poke
      }
    }

    // Phase QW — Obelisk CHARGE state: +50% on the next attack, then consumed
    if (attacker.flags?.obeliskChargedNextAttack) {
      raw = Math.floor(raw * 1.5)
      attacker.flags.obeliskChargedNextAttack = false
    }

    // Phase QW — Armory adjacency buff: dungeon minions in (or adjacent to) an
    // active Armory room hit +15% harder per swing. %-based (was a flat +2)
    // so it keeps pace with minion ATK as the boss levels — a flat bonus
    // fell off to nothing once minions scaled. Cheap room-existence check
    // since attacker.faction tells us if this is a minion swing.
    // Tinkerer's Workshop "Weaponsmith" — buff raised to +30% when the
    // Armory type is upgraded.
    const tinkered = this._gameState._tinkeredRoomTypes ?? []
    if (attacker.faction === 'dungeon' && attacker.assignedRoomId) {
      if (this._isAdjacentToActiveArmory(attacker.assignedRoomId)) {
        const armoryMul = tinkered.includes('armory') ? 1.30 : 1.15
        raw = Math.floor(raw * armoryMul)
      }
    }

    // Widen — Commander Rally Aura: a dungeon minion standing in its
    // commander's aura (flag stamped by MinionAbilities._buffAura) hits
    // harder. The buff lapses shortly after the commander dies/leaves.
    if (attacker._rallyUntil && (this._scene?.time?.now ?? 0) < attacker._rallyUntil && attacker._rallyAtkMul > 1) {
      raw = Math.floor(raw * attacker._rallyAtkMul)
    }

    // Orc BLOODLUST (+ Rampage) — stacking attack from hits landed, decaying out
    // of combat. The live (lazily-decayed) multiplier is computed in
    // MinionAbilities; folds in the Veteran's Warpath surge while active.
    const _blMul = MinionAbilities.bloodlustAtkMul(attacker, this._scene)
    if (_blMul > 1) raw = Math.floor(raw * _blMul)

    // Rat SWARM — strength in numbers: +damage per swarm-rat sharing the room.
    const _swMul = MinionAbilities.swarmAtkMul(attacker, this._scene, this._gameState)
    if (_swMul > 1) raw = Math.floor(raw * _swMul)

    // Lich SOUL HARVEST — banked souls scale the Lich's necrotic blasts, and its
    // Soul Conduit shares that power to nearby undead (flag windows on each).
    const _soulMul = MinionAbilities.soulAtkMul(attacker, this._scene)
    if (_soulMul > 1) raw = Math.floor(raw * _soulMul)

    // Plant DEVOUR — the carnivore bites harder into prey it's already rooted.
    const _devourMul = MinionAbilities.devourMul(attacker, target, this._scene)
    if (_devourMul > 1) raw = Math.floor(raw * _devourMul)

    // Thread C — wounded bruiser ENRAGE: a cornered melee minion fights harder
    // (+30% damage) once below the enrage threshold (flag set by MinionAISystem).
    if (attacker._enraged) {
      raw = Math.floor(raw * 1.3)
    }

    // Ghost FEAR — a HAUNTED hero who is already Spooked/Breaking fights worse:
    // their dread makes them falter (attack-fumble). Read from the ghost kit.
    const _fearMul = MinionAbilities.fearAtkMul(attacker, this._scene?.time?.now ?? 0)
    if (_fearMul < 1) raw = Math.max(1, Math.floor(raw * _fearMul))

    // Tinkerer's Workshop "Eagle Eye" — guard-post-assigned minions
    // deal +25% damage when ambushing into a connected room (their
    // assignedRoomId is the guard post, and they're hitting an adv in
    // a room reachable via the guard-post's neighbours).
    if (tinkered.includes('starter_guard_post') &&
        attacker.faction === 'dungeon' && attacker.assignedRoomId) {
      const grid = this._scene?.dungeonGrid
      const home = (this._gameState.dungeon?.rooms ?? [])
        .find(r => r.instanceId === attacker.assignedRoomId)
      if (home?.definitionId === 'starter_guard_post' && grid?.getRoomAtTile) {
        // Attacker is hitting a target inside or near the guard post —
        // the buff is meaningful when the target is in an ADJACENT
        // room (true ambush) rather than already inside the post.
        const targetRoom = grid.getRoomAtTile(target.tileX, target.tileY)
        if (targetRoom && targetRoom.instanceId !== home.instanceId) {
          raw = Math.round(raw * 1.25)
        }
      }
    }

    // Tinkerer's Workshop "Greased Corridor" — minions defending inside
    // a corridor take 25% less damage (slippery to pin down). Inverse
    // sense: applied as a damage REDUCTION when the TARGET is a minion
    // standing inside a corridor.
    if (tinkered.includes('starter_corridor') &&
        target.faction === 'dungeon' &&
        Number.isFinite(target.tileX) && Number.isFinite(target.tileY)) {
      const grid = this._scene?.dungeonGrid
      const here = grid?.getRoomAtTile?.(target.tileX, target.tileY)
      if (here?.definitionId === 'starter_corridor') {
        raw = Math.round(raw * 0.75)
      }
    }

    // Room redesign 2026-04-30 — Wishing Well "Marked" debuff: dungeon
    // minions deal +50% damage to a Marked adventurer for the rest of
    // that day.
    const today = this._gameState?.meta?.dayNumber
    if (attacker.faction === 'dungeon' &&
        target.flags?.marked &&
        target.flags.markedExpiresOnDay === today) {
      raw = Math.floor(raw * 1.5)
    }

    // (Lizardman Camouflage 3× and Orc Berserker Rage were wiped for the redesign.)

    // Armor-shred debuff: a shredded target's effective
    // defense is reduced for the debuff's duration so every hit lands harder.
    const _nowDmg = this._scene?.time?.now ?? 0
    const _shred  = MinionAbilities.armorShredOf(target, _nowDmg)
    const def = Math.max(0, (target.stats?.defense ?? 0) - _shred)
    let mit = Math.max(1, raw - def)

    // (Ent Gnarled Hide was wiped — damage reduction is now data-driven below.)

    // Data-driven damage reduction (a family that wants a damage-reduction
    // passive re-introduces it as a JSON ability). Sums `damageReduction`
    // abilities on the TARGET minion.
    const _drMul = MinionAbilities.damageTakenMul(target, attacker, this._gameState, this._scene)
    if (_drMul !== 1) mit = Math.max(1, Math.floor(mit * _drMul))
    // Golem Bulwark — stone chips fly when a construct soaks a reduced hit.
    if (_drMul < 1 && Array.isArray(target.tags) && target.tags.includes('construct') && Number.isFinite(target.worldX)) {
      AbilityVfx.bulwarkFx?.(this._scene, target.worldX, target.worldY)
    }

    // Phase 9 mechanic damage modifiers.
    // `sup` = Inquisition pact-BENEFIT suppression (KR): while an inquisitor is in
    // the dungeon, every dungeon-favouring pact benefit below is gated off. Only
    // the clear minion BUFFS are gated — adventurer-side buffs (Glory Hounds,
    // Famine Decree, Sworn Rivals, Summon Adds II), nerfs (minionDamageMult), and
    // MIXED defensive trades (Mage Hunt, Ironhide Rite, the Frenzy DEFENSE loss)
    // are CURSES/neutral and stay fully active.
    const flags = this._gameState._mechanicFlags ?? {}
    const sup = !!flags._inqSuppress
    if (flags.bloodbound && !sup && _isMinionAttacker(attacker)) {
      mit *= Balance.MECHANIC_BLOODBOUND_DAMAGE_MULT
    }
    // Phase 9: Pack Synergy — minions deal bonus damage per ally in same room
    if (flags.packSynergy && !sup && _isMinionAttacker(attacker) && attacker.assignedRoomId) {
      const alliesInRoom = (this._gameState.minions ?? []).filter(m =>
        m.instanceId !== attacker.instanceId &&
        m.aiState !== 'dead' &&
        m.assignedRoomId === attacker.assignedRoomId
      ).length
      if (alliesInRoom > 0) {
        const bonus = Math.min(
          alliesInRoom * Balance.MECHANIC_PACK_SYNERGY_BONUS,
          Balance.MECHANIC_PACK_SYNERGY_MAX_BONUS
        )
        mit = Math.floor(mit * (1 + bonus))
      }
    }
    // Phase 9: Sealed Paths — cornered fleeing adventurers fight with desperate fury
    if (flags.sealedPaths && attacker.faction === 'adventurer' && attacker.aiState === 'fleeing') {
      const fleeThresh = attacker.fleeThreshold ?? Balance.LOW_HP_THRESHOLD
      const hpFrac = attacker.resources?.maxHp > 0
        ? attacker.resources.hp / attacker.resources.maxHp : 1
      if (hpFrac < fleeThresh) {
        mit = Math.floor(mit * Balance.MECHANIC_SEALED_PATHS_CORNERED_MULT)
      }
    }
    // Phase 9 — adventurer-only HP-scaling pacts: Glory Hounds, Famine Decree, Sworn Rivals.
    if (attacker.faction === 'adventurer') {
      const advFrac = attacker.resources?.maxHp > 0
        ? attacker.resources.hp / attacker.resources.maxHp : 1
      if (flags.gloryHounds && advFrac <= Balance.MECHANIC_GLORY_HOUNDS_HP_THRESHOLD) {
        mit = Math.floor(mit * Balance.MECHANIC_GLORY_HOUNDS_DAMAGE_MULT)
      }
      if (flags.famineDecree) {
        if (advFrac >= 1.0) {
          mit = Math.floor(mit * Balance.MECHANIC_FAMINE_FULL_HP_MULT)
        } else if (advFrac < Balance.MECHANIC_FAMINE_LOW_HP_THRESHOLD) {
          mit = Math.max(1, Math.floor(mit * Balance.MECHANIC_FAMINE_LOW_HP_MULT))
        }
      }
      if (flags.swornRivals && attacker.flags?.swornRivalOf && advFrac >= 1.0) {
        mit = Math.floor(mit * (1 + Balance.MECHANIC_SWORN_RIVALS_FULL_HP_BONUS))
      }
      // Phase 9 — Tower Tax: a ranged adv's first attack of the day
      // misses entirely; every subsequent attack does +30% damage.
      if (flags.towerTax && (attacker.attackRange ?? 1) > 1) {
        if (!attacker._towerTaxFirstShotConsumed) {
          attacker._towerTaxFirstShotConsumed = true
          AbilityVfx.floatingText(this._scene, attacker.worldX ?? 0, (attacker.worldY ?? 0) - 18, 'MISS', { color: '#ffaa55' })
          return 0    // bypass variance/floor — true zero damage
        }
        mit = Math.floor(mit * Balance.MECHANIC_TOWER_TAX_FOLLOWUP_MULT)
      }
      // Phase 9 — Mage Hunt: minion damage scales by adv class type.
      // (This is adv-as-defender, but flag is on attacker.faction === 'adventurer'?
      // No — Mage Hunt buffs MINIONS hitting advs, so the check belongs
      // in the minion-attacker block below.)
    }
    // Phase 9 — Summon Adds II: advs deal +25% damage in the boss chamber.
    if (flags.summonAddsII && attacker.faction === 'adventurer' && target.faction === 'dungeon') {
      const bossRoom = this._gameState.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
      if (bossRoom && this._scene?.dungeonGrid) {
        const advRoom = this._scene.dungeonGrid.getRoomAtTile(attacker.tileX, attacker.tileY)
        if (advRoom?.instanceId === bossRoom.instanceId) {
          mit = Math.floor(mit * Balance.MECHANIC_SUMMON_ADDS_II_BOSS_DMG_MULT)
        }
      }
    }
    // Phase 9 — minion-attacker scaling: Ironhide Rite (defender), Mage Hunt (target class), Frenzy stacks, Last Stand.
    if (_isMinionAttacker(attacker)) {
      // Endless Garrison — -15% minion damage globally.
      if (flags.minionDamageMult) {
        mit = Math.max(1, Math.floor(mit * flags.minionDamageMult))
      }
      // Mage Hunt — read attacker side (minion vs adv class)
      if (flags.mageHunt && target.faction === 'adventurer') {
        const r = target.attackRange ?? 1
        mit = Math.floor(mit * (r > 1 ? Balance.MECHANIC_MAGE_HUNT_RANGED_MULT : Balance.MECHANIC_MAGE_HUNT_MELEE_MULT))
      }
      // Frenzy Pact — per-room stack of dead allies (the ATTACK buff; the
      // matching DEFENSE loss below is the curse and stays active under suppression)
      if (flags.frenzyPact && !sup && attacker.assignedRoomId) {
        const stacks = (flags.frenzyStacks ?? {})[attacker.assignedRoomId] ?? 0
        if (stacks > 0) {
          const atkBonus = stacks * Balance.MECHANIC_FRENZY_DAMAGE_PER_STACK
          mit = Math.floor(mit * (1 + atkBonus))
        }
      }
      // Last Stand Doctrine — +100% if attacker is the only alive minion in their room
      if (flags.lastStandDoctrine && !sup && attacker.assignedRoomId) {
        const allies = (this._gameState.minions ?? []).filter(m =>
          m.instanceId !== attacker.instanceId &&
          m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 &&
          m.assignedRoomId === attacker.assignedRoomId
        )
        if (allies.length === 0) {
          mit = Math.floor(mit * Balance.MECHANIC_LAST_STAND_DAMAGE_MULT)
          attacker._lastStandUsed = true
        }
      }
    }
    // Phase 9 — Ironhide Rite: minions take 0.5× from melee, 2× from ranged.
    if (flags.ironhideRite && target.faction === 'dungeon' && attacker.faction === 'adventurer') {
      const r = attacker.attackRange ?? 1
      mit = Math.floor(mit * (r > 1 ? Balance.MECHANIC_IRONHIDE_RANGED_DAMAGE_MULT : Balance.MECHANIC_IRONHIDE_MELEE_DAMAGE_MULT))
    }
    // Phase 9 — Open Book: minions take 50% less damage from advs.
    if (flags.openBook && !sup && target.faction === 'dungeon' && attacker.faction === 'adventurer') {
      mit = Math.max(1, Math.floor(mit * Balance.MECHANIC_OPEN_BOOK_MINION_TAKEN_MULT))
    }
    // Phase 9 — Frenzy Pact tradeoff: a frenzied minion loses 25% defense
    // per per-room stack — it takes that much more damage (no cap).
    if (flags.frenzyPact && target.faction === 'dungeon' && target.assignedRoomId) {
      const fStacks = (flags.frenzyStacks ?? {})[target.assignedRoomId] ?? 0
      if (fStacks > 0) {
        mit = Math.floor(mit * (1 + fStacks * Balance.MECHANIC_FRENZY_DEFENSE_PER_STACK))
      }
    }
    // Phase 9 — False Maps: enraged advs deal +50% damage during rage window.
    if (flags.falseMaps && attacker.faction === 'adventurer' && attacker._falseMapsRageUntil) {
      const now = this._scene?.time?.now ?? 0
      if (now < attacker._falseMapsRageUntil) {
        mit = Math.floor(mit * Balance.MECHANIC_FALSE_MAPS_RAGE_MULT)
      }
    }
    // Phase 9 — Pact of the Whisperer: marked adv's party deals +50% damage.
    if (flags.pactOfTheWhisperer && attacker.faction === 'adventurer' &&
        flags.whispererPartyId && attacker.partyId === flags.whispererPartyId &&
        !attacker.flags?.panicFlee) {
      mit = Math.floor(mit * Balance.MECHANIC_WHISPERER_PARTY_DAMAGE_MULT)
    }

    const variance = 1 + (Math.random() - 0.5) * 0.3
    return Math.max(1, Math.floor(mit * variance))
  }

  // Is the given room ID an Armory itself, or door-connected to one?
  // Used for the Armory's minion-attack buff. Matches the description
  // ("directly door-connected rooms") and mirrors Watchtower / Sanctum's
  // door-connected pattern via DungeonGrid.getNeighborRooms — earlier
  // geometric proximity check (any room within ~2 tiles) was a stale
  // pre-doorway-snap heuristic.
  _isAdjacentToActiveArmory(roomId) {
    const rooms = this._gameState.dungeon.rooms ?? []
    const homeRoom = rooms.find(r => r.instanceId === roomId)
    if (!homeRoom) return false
    if (homeRoom.definitionId === 'armory' && homeRoom.isActive !== false) return true
    const grid = this._scene?.dungeonGrid
    if (!grid?.getNeighborRooms) return false
    const neighbors = grid.getNeighborRooms(roomId) ?? []
    return neighbors.some(n => n.definitionId === 'armory' && n.isActive !== false)
  }

  // Bramble Hall reflect — if `attacker` (an adventurer) is standing in an
  // active Bramble Hall, deal a share of the damage they just dealt back to
  // them as thorns. 30% melee-only by default; tinkered "Iron Thorns" = 50%
  // and also catches ranged attackers. VFX (woody thorns erupting around the
  // attacker + a reflect number) is throttled per-adv so rapid swings don't
  // spam the screen, but the damage applies on every hit.
  _brambleHallReflect(attacker, dmgDealt) {
    if (!attacker?.resources) return 0
    const grid = this._scene?.dungeonGrid
    const room = grid?.getRoomAtTile?.(attacker.tileX, attacker.tileY)
    if (!room || room.definitionId !== 'thorn_hall' || room.isActive === false) return 0
    const tinkered = (this._gameState._tinkeredRoomTypes ?? []).includes('thorn_hall')
    const isRanged = (attacker.attackRange ?? 1) > 1.5
    if (isRanged && !tinkered) return 0   // melee only unless Iron Thorns
    const frac = tinkered ? 0.50 : 0.30
    const reflect = Math.max(1, Math.round(dmgDealt * frac))
    // Don't let thorns kill a scripted/protected adventurer (mirror the
    // Nemesis 10% floor used for direct hits).
    const floor = attacker._nemesis
      ? Math.max(1, Math.ceil((attacker.resources.maxHp ?? 1) * 0.10)) : 0
    attacker.resources.hp = Math.max(floor, (attacker.resources.hp ?? 0) - reflect)
    attacker._lastHitBy = 'thorn_hall'
    attacker._lastHitType = 'thorns'
    const s = this._scene
    const now = s?.time?.now ?? 0
    if (s && Number.isFinite(attacker.worldX) && now - (attacker._brambleVfxAt ?? -1e9) > 350) {
      attacker._brambleVfxAt = now
      AbilityVfx.thornGuardFx?.(s, attacker.worldX, attacker.worldY, { amped: tinkered })
      AbilityVfx.floatingText?.(s, attacker.worldX, (attacker.worldY ?? 0) - 18, `-${reflect}`, { color: '#7bbf4a', fontSize: '11px' })
    }
    EventBus.emit('BRAMBLE_HALL_REFLECT', { adventurer: attacker, roomId: room.instanceId, amount: reflect })
    return reflect
  }

  // Is this entity standing in Silence Ward coverage? Reads the per-tick set
  // (`_silenceWardRoomIds`, room instanceIds) stamped by ClassAbilitySystem
  // so combat doesn't re-walk the room graph on every hit. Used by the
  // tinkered "Dead Zone" damage amp.
  _inSilenceWard(ent) {
    const ids = this._gameState._silenceWardRoomIds
    if (!Array.isArray(ids) || ids.length === 0) return false
    const tx = ent?.tileX, ty = ent?.tileY
    if (typeof tx !== 'number' || typeof ty !== 'number') return false
    for (const r of (this._gameState.dungeon?.rooms ?? [])) {
      if (!ids.includes(r.instanceId)) continue
      if (tx >= r.gridX && tx < r.gridX + r.width &&
          ty >= r.gridY && ty < r.gridY + r.height) return true
    }
    return false
  }

  // Knight Bulwark — a DIRECTIONAL shield-wall. While a Knight's stance is up,
  // an ally (or the Knight himself) within KNIGHT_BULWARK_RANGE takes reduced
  // damage ONLY when sheltered behind/beside the Knight: the Knight stands toward
  // the threat from the ally AND is at least as forward (close to the attacker) as
  // the ally. Attacking from a side the Knight isn't covering bypasses it.
  _applyBulwark(attacker, target, dmg) {
    if (!target || dmg <= 0) return dmg
    if (target.aiState === undefined) return dmg              // non-combatant target — skip
    const reduced = () => Math.max(1, Math.floor(dmg * (1 - KNIGHT_BULWARK_REDUCTION)))
    // Is `target` sheltered by `knight` relative to `attacker`?
    const sheltered = (knight) => {
      if (knight === target) return true                      // the Knight IS the wall
      const atx = (attacker?.tileX ?? target.tileX) - target.tileX
      const aty = (attacker?.tileY ?? target.tileY) - target.tileY
      const ktx = knight.tileX - target.tileX
      const kty = knight.tileY - target.tileY
      if (atx * ktx + aty * kty <= 0) return false            // Knight not on the threat side of the ally
      if (attacker) {
        const dKA = Math.hypot(knight.tileX - attacker.tileX, knight.tileY - attacker.tileY)
        const dTA = Math.hypot(target.tileX - attacker.tileX, target.tileY - attacker.tileY)
        if (dKA > dTA + 0.01) return false                    // Knight isn't taking the front
      }
      return true
    }
    const now = this._scene.time.now
    if (target.classId === undefined) {
      // The Undying Court — a revived KNIGHT minion's bulwark shields nearby
      // DUNGEON minions (the classId-less defenders).
      if (!(this._gameState._mechanicFlags ?? {}).theUndyingCourt) return dmg
      if (target.faction !== 'dungeon') return dmg
      for (const m of this._gameState.minions ?? []) {
        if (m._raisedClassId !== 'knight') continue
        if (!m._auraActiveUntil || now >= m._auraActiveUntil) continue
        if (Math.hypot((target.tileX ?? 0) - (m.tileX ?? 0), (target.tileY ?? 0) - (m.tileY ?? 0)) > KNIGHT_BULWARK_RANGE) continue
        if (sheltered(m)) return reduced()
      }
      return dmg
    }
    const advs = this._gameState.adventurers?.active ?? []
    for (const knight of advs) {
      if (knight.classId !== 'knight') continue
      if (!knight._auraActiveUntil || now >= knight._auraActiveUntil) continue
      if (knight !== target && (!knight.partyId || knight.partyId !== target.partyId)) continue   // solo Knight shields only himself
      if (Math.hypot(target.tileX - knight.tileX, target.tileY - knight.tileY) > KNIGHT_BULWARK_RANGE) continue
      if (sheltered(knight)) return reduced()
    }
    return dmg
  }

  // Bard Crescendo (attack half): if a same-party Bard within 3 tiles has an
  // active hymn, multiply damage by the bard's live crescendo atk mult
  // (1 + stacks×5%, up to 1.20). The bard buffs themselves too.
  _applyInspireBuff(attacker, raw) {
    if (!attacker || raw <= 0) return raw
    if (attacker.classId === undefined) {
      // The Undying Court — a revived BARD minion inspires nearby DUNGEON
      // minions (the only place a classId-less attacker gets this buff).
      if (!(this._gameState._mechanicFlags ?? {}).theUndyingCourt) return raw
      if (attacker.faction !== 'dungeon') return raw
      const now = this._scene.time.now
      for (const m of this._gameState.minions ?? []) {
        if (m._raisedClassId !== 'bard') continue
        if (!m._inspireActiveUntil || now >= m._inspireActiveUntil) continue
        const d = Math.hypot((attacker.tileX ?? 0) - (m.tileX ?? 0), (attacker.tileY ?? 0) - (m.tileY ?? 0))
        if (d > 3.01) continue
        return Math.max(1, Math.floor(raw * (m._crescendoAtkMul || 1.15)))
      }
      return raw
    }
    const advs = this._gameState.adventurers?.active ?? []
    const now  = this._scene.time.now
    for (const bard of advs) {
      if (bard.classId !== 'bard') continue
      if (!bard._inspireActiveUntil || now >= bard._inspireActiveUntil) continue
      if (bard !== attacker) {
        if (!bard.partyId || bard.partyId !== attacker.partyId) continue
      }
      const d = Math.hypot(attacker.tileX - bard.tileX, attacker.tileY - bard.tileY)
      if (d > 3.01) continue
      return Math.max(1, Math.floor(raw * (bard._crescendoAtkMul || 1.15)))
    }
    return raw
  }

  // ── Mage Elemental Arcana ───────────────────────────────────────────────
  _mageElement(mage) { return mage._element || 'fire' }
  _mageElementColor(el) {
    return el === 'fire' ? 0xff6633 : el === 'ice' ? 0x66ddff : el === 'lightning' ? 0xffff66 : 0xaaffff
  }

  // Apply the mage's element to one target. strong=true is the Arcane Burst
  // version (bigger/longer); strong=false is the per-swing version, gated for the
  // power-adding elements (lightning/wind) so they don't oppress.
  _applyMageElement(mage, target, dmg, strong) {
    const now = this._scene?.time?.now ?? 0
    const el = this._mageElement(mage)
    if (el === 'fire') {
      target._dot = target._dot ?? []
      const dpt = Math.max(2, Math.floor(dmg * MAGE_BURN_PCT))
      const ticks = strong ? MAGE_BURN_TICKS_STRONG : MAGE_BURN_TICKS
      const ex = target._dot.find(d => d.type === 'burn' && d.source === mage.instanceId)
      if (ex) { ex.ticksLeft = Math.max(ex.ticksLeft, ticks); ex.dmgPerTick = Math.max(ex.dmgPerTick, dpt); ex._lastTickAt = now }
      else target._dot.push({ dmgPerTick: dpt, intervalMs: MAGE_BURN_INTERVAL_MS, ticksLeft: ticks, type: 'burn', source: mage.instanceId, _lastTickAt: now })
      AbilityVfx.emberBurnFx?.(this._scene, target.worldX, target.worldY)
    } else if (el === 'ice') {
      const next = now + (strong ? MAGE_CHILL_MS_STRONG : MAGE_CHILL_MS)
      if (!target._slowUntil || target._slowUntil < next) target._slowUntil = next
      target._slowMult = Math.min(target._slowMult ?? 1, strong ? MAGE_CHILL_MULT_STRONG : MAGE_CHILL_MULT)
      AbilityVfx.frostChillFx?.(this._scene, target.worldX, target.worldY)
    } else if (el === 'lightning') {
      if (strong) return                       // the burst chains via targeting, not here
      if (now - (mage._arcLastAt ?? 0) < MAGE_ARC_CD_MS) return
      mage._arcLastAt = now
      const t2 = this._nearestMinionsTo(target, MAGE_ARC_RANGE, 1, new Set([target.instanceId]))[0]
      if (t2) {
        this._dealSplash(mage, t2, Math.max(1, Math.floor(dmg * MAGE_ARC_PCT)), 'lightning')
        AbilityVfx.arcBoltFx?.(this._scene, target.worldX, target.worldY, t2.worldX, t2.worldY)
      }
    } else {                                   // wind
      if (!strong && now - (mage._gustLastAt ?? 0) < MAGE_GUST_CD_MS) return
      if (!strong) mage._gustLastAt = now
      this._knockbackMinion(target, mage.worldX, mage.worldY)
      AbilityVfx.gustFx?.(this._scene, target.worldX, target.worldY, { dir: ((target.tileX ?? 0) - (mage.tileX ?? 0)) >= 0 ? 1 : -1 })
    }
  }

  // Arcane Burst — element-defined amplifier. fire/ice/wind = radial AoE that
  // also applies the STRONG element; lightning = a branching bolt that hops
  // through several minions (a distinct shape, not a ring).
  _fireArcaneBurst(mage, target, dmg, damageType) {
    const el = this._mageElement(mage)
    const color = this._mageElementColor(el)
    if (el === 'lightning') {
      const seen = new Set([target.instanceId])
      let from = target
      for (let i = 0; i < MAGE_ARC_CHAINS_STRONG; i++) {
        const nxt = this._nearestMinionsTo(from, MAGE_ARC_RANGE, 1, seen)[0]
        if (!nxt) break
        seen.add(nxt.instanceId)
        AbilityVfx.arcBoltFx?.(this._scene, from.worldX, from.worldY, nxt.worldX, nxt.worldY, { color })
        this._dealSplash(mage, nxt, Math.max(1, Math.floor(dmg * MAGE_ARC_PCT_STRONG)), 'lightning')
        from = nxt
      }
      AbilityVfx.floatingText(this._scene, target.worldX, target.worldY - 26, 'ARC', { color: '#ffff66', fontSize: '12px' })
      return
    }
    AbilityVfx.arcaneBurstFx?.(this._scene, target.worldX, target.worldY, { color })
    const splash = Math.max(1, Math.floor(dmg * MAGE_BURST_DMG_PCT))
    for (const m of this._nearestMinionsTo(target, MAGE_BURST_AOE_TILES, 99, new Set([target.instanceId]))) {
      this._dealSplash(mage, m, splash, damageType)
      this._applyMageElement(mage, m, dmg, true)
    }
    this._applyMageElement(mage, target, dmg, true)   // the primary takes the strong element too
  }

  _nearestMinionsTo(origin, range, limit, exclude) {
    const out = []
    for (const m of this._gameState.minions ?? []) {
      if (exclude?.has(m.instanceId)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.faction === 'adventurer') continue
      const d = Math.hypot((m.tileX ?? 0) - (origin.tileX ?? 0), (m.tileY ?? 0) - (origin.tileY ?? 0))
      if (d > range + 0.01) continue
      out.push({ m, d })
    }
    out.sort((a, b) => a.d - b.d)
    return out.slice(0, limit).map(o => o.m)
  }

  _dealSplash(mage, m, dmg, damageType) {
    if (!m || (m.resources?.hp ?? 0) <= 0) return
    m.resources.hp = Math.max(0, m.resources.hp - dmg)
    EventBus.emit('COMBAT_HIT', { sourceId: mage.instanceId, targetId: m.instanceId, damage: dmg, damageType, isCritical: false })
  }

  // Shove a minion 1 tile directly away from (fromX,fromY) if that tile is open.
  _knockbackMinion(m, fromX, fromY) {
    const grid = this._scene?.dungeonGrid
    if (!grid) return
    const dx = m.worldX - fromX, dy = m.worldY - fromY
    let kx = m.tileX, ky = m.tileY
    if (Math.abs(dx) >= Math.abs(dy)) kx += (dx === 0 ? 1 : Math.sign(dx))
    else ky += (dy === 0 ? 1 : Math.sign(dy))
    const t = grid.getTileType?.(kx, ky)
    if (t == null || !PathfinderSystem.isWalkable(t) || t === TILE.DOOR) return
    const TS = Balance.TILE_SIZE
    m.tileX = kx; m.tileY = ky
    m.worldX = kx * TS + TS / 2; m.worldY = ky * TS + TS / 2
    m._patrolTarget = null; m._chasePath = null
  }

  _inferMethod(attacker, damageType) {
    if (damageType === 'physical') {
      if (attacker.classId === 'mage') return 'spell_arcane'
      if (attacker.classId === 'ranger') {
        const arrows = attacker.resources?.arrows ?? 0
        return arrows > 0 ? 'ranged' : 'melee'
      }
      // Phase QW — Rogues striking a target that hasn't engaged them yet count as backstab.
      // Drives the Shadow Stalker minion-evolution path which requires killMethod=backstab.
      if (attacker.classId === 'rogue') {
        const tid = attacker._lastAttackTargetId
        const target = tid && (
          this._gameState.minions?.find(m => m.instanceId === tid) ||
          this._gameState.adventurers?.active?.find(a => a.instanceId === tid)
        )
        if (target && target.aiState !== 'engaging' && target.aiState !== 'fighting') {
          return 'backstab'
        }
        return 'melee'
      }
      return (attacker.attackRange ?? 1) > 1 ? 'ranged' : 'melee'
    }
    if (damageType === 'poison') return 'poison'
    if (damageType === 'fire')   return 'spell_fire'
    if (damageType === 'frost')  return 'spell_frost'
    return damageType
  }
}

function _isUndead(entity) {
  const tags = entity?.tags ?? entity?.stats?.tags ?? []
  return Array.isArray(tags) && tags.includes('undead')
}

// Phase 9: bloodbound buff applies to dungeon-faction minions only.
function _isMinionAttacker(entity) {
  return !!(entity && entity.definitionId !== undefined && entity.faction !== undefined)
}

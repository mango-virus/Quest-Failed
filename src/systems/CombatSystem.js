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

const TS = Balance.TILE_SIZE

// Phase 6 — Gladiator Crowd Roar tuning. Each hostile minion the Gladiator
// fells adds an ATK stack; stacks cap and clear on death/flee. Both the
// increment (kill block) and the damage scaling (_computeDamage) live in this
// file, so the constants live here too (the ClassAbilitySystem ABILITY_DEFS
// entry is just a registry label, like ranger_volley).
const CROWD_ROAR_PER_STACK  = 0.12   // +12% ATK per stack
const CROWD_ROAR_MAX_STACKS = 6      // → +72% ATK at full crowd

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
  }

  // attacker / target are entities (adventurer or minion) — both have stats.attack,
  // stats.defense, resources.hp, instanceId, classId or definitionId.
  // Returns: { hit: boolean, damage: number, killed: boolean } | null when on cooldown.
  tryAttack(attacker, target, opts = {}) {
    if (!attacker || !target) return null
    if (target.resources.hp <= 0) return null
    // Pacifist gate — Light Party's healer (white_mage) is tagged
    // _neverAttacks at spawn and stays a pure support unit (heals + revives,
    // no swings). The flag lives on the adv instance, so anywhere the AI
    // calls tryAttack(healer, …) it short-circuits here. Generic enough for
    // any future "never-attacks" adventurer / minion to use the same flag.
    if (attacker._neverAttacks) return null
    // Invulnerability — Light Party's Hallowed Ground (tank self-cast at
    // <30% HP) and Stronghold (Tank LB party-wide) both set target._invuln
    // for a short window. Damage is fully suppressed: no hit registered,
    // no hurt animation, nothing. The flag is cleared by the system that
    // set it (LightPartyAi via a Phaser delayedCall). Generic enough for
    // any future "invuln window" mechanic (mechanic cards, dark pacts, …).
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
    // the attacker (tournament rivals) or making it pace at a doorway.
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
    if (attacker.classId === 'gambler' && (attacker._diceRollReadyAt ?? 0) <= now) {
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

    const damage     = this._computeDamage(attacker, target)
    // Phase 5c — Rogue Invisibility: if attacker is an invisible Rogue,
    // their attack is a guaranteed crit AND immediately reveals them.
    const rogueInvisCrit = attacker.classId === 'rogue' && attacker._invisible
    const isCritical = rogueInvisCrit ? true : Math.random() < 0.10
    let   finalDmg   = isCritical ? Math.floor(damage * 1.5) : damage

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

    // Phase 5c — Monk Focus: 30% chance to dodge incoming damage entirely.
    // Only applies when target is the focused adventurer (this is the
    // defender, not the attacker — so we read target._focusActiveUntil).
    if (target._focusActiveUntil && now < target._focusActiveUntil && Math.random() < 0.30) {
      // Dodge VFX
      AbilityVfx.floatingText(this._scene, target.worldX ?? 0, (target.worldY ?? 0) - 18, 'MISS', { color: '#eeeeff' })
      // No damage applied, no kill.
      EventBus.emit('COMBAT_HIT', {
        sourceId: attacker.instanceId, targetId: target.instanceId,
        damage: 0, damageType: attacker.damageType ?? 'physical', isCritical: false,
      })
      return { hit: false, dodged: true }
    }

    // Phase 6 — Gladiator Block: while braced behind the shield, the incoming
    // hit is fully negated (no damage, no kill). He cannot attack during the
    // window (gated at the top of tryAttack).
    if (target._blockActiveUntil && now < target._blockActiveUntil) {
      AbilityVfx.floatingText(this._scene, target.worldX ?? 0, (target.worldY ?? 0) - 18, 'BLOCK', { color: '#ffe08a' })
      EventBus.emit('COMBAT_HIT', {
        sourceId: attacker.instanceId, targetId: target.instanceId,
        damage: 0, damageType: attacker.damageType ?? 'physical', isCritical: false,
      })
      return { hit: false, blocked: true }
    }

    // Phase 5c — Knight Protective Aura: party allies (and the Knight himself)
    // within auraRangeTiles of an aura-active Knight take 25% less damage.
    finalDmg = this._applyProtectiveAura(target, finalDmg)

    // Phase 5c — Twitch DEF buff: target's _twitchDefBonus subtracts from damage.
    if (target._twitchDefBonus && target._twitchEffectUntil && now < target._twitchEffectUntil) {
      finalDmg = Math.max(1, finalDmg - target._twitchDefBonus)
    }

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

    // Ambush bonus: minions with behaviorType 'ambush' (plant2, imp2, etc.)
    // that just revealed get a one-shot 1.5× damage on their next attack.
    // Flag is set by MinionAbilities._tickAmbushHidden on the hidden→visible
    // edge and consumed here.
    if (attacker._ambushBuffActive) {
      finalDmg = Math.max(1, Math.round(finalDmg * 1.5))
      attacker._ambushBuffActive = false
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

    // Solo Leveling — Sung Jinwoo can't be dropped below 10% max HP by
    // minions (only the boss duel can finish him). Floor the hit here so his
    // HP bar visibly bottoms out at 10% instead of flashing to 0 before
    // AISystem._kill bounces him back.
    // Light Party shares the Shadow Monarch's 10% floor: party members may ONLY
    // die in the scripted boss duel (which drives HP directly, not through this
    // path), so normal combat can never chip them below 10% maxHp.
    const _smFloor = (target._shadowMonarch || target._lightParty || target._nemesis)
      ? Math.max(1, Math.ceil((target.resources.maxHp ?? 1) * 0.10)) : 0
    target.resources.hp = Math.max(_smFloor, target.resources.hp - finalDmg)

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

    // Phase 1b.6 — Lizardman Camouflage: each minion reveals on its FIRST
    // attack. Subsequent attacks no-op the unset.
    if (attacker?._camouflaged) {
      attacker._camouflaged = false
      EventBus.emit('LIZARDMAN_CAMO_REVEAL', { minionId: attacker.instanceId })
    }

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
      // per spec), honouring the same shadow-monarch/light-party HP floor.
      const fl = (target._shadowMonarch || target._lightParty || target._nemesis)
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

    // Phase 5c — Mage Arcane Burst: if queued, deal AoE damage to all enemies
    // within 1 tile of the primary target, then consume the flag.
    if (attacker.classId === 'mage' && attacker._arcaneBurstQueued) {
      attacker._arcaneBurstQueued = false
      const aoeColor = (attacker._element === 'fire' ? 0xff6633 : attacker._element === 'ice' ? 0x66ddff : attacker._element === 'lightning' ? 0xffff66 : 0xaaffff)
      AbilityVfx.pulseRing(this._scene, target.worldX, target.worldY, { color: aoeColor, fromR: 12, toR: 64, durationMs: 500, alpha: 0.85 })
      AbilityVfx.particleBurst(this._scene, target.worldX, target.worldY, { color: aoeColor, count: 14, durationMs: 600, speed: 100 })
      const aoeDamage = Math.max(1, Math.floor(finalDmg * 0.6))
      for (const m of this._gameState.minions ?? []) {
        if (m === target) continue
        if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
        if (m.faction === 'adventurer') continue
        const d = Math.hypot(m.tileX - target.tileX, m.tileY - target.tileY)
        if (d > 1.01) continue
        m.resources.hp = Math.max(0, m.resources.hp - aoeDamage)
        EventBus.emit('COMBAT_HIT', { sourceId: attacker.instanceId, targetId: m.instanceId, damage: aoeDamage, damageType, isCritical: false })
      }
    }

    // Phase 5c — Ranger Volley: every 5th attack fires at 2 extra targets in
    // a cone toward the primary target (within 2 tiles of the primary).
    if (attacker.classId === 'ranger') {
      attacker._shotCount = (attacker._shotCount ?? 0) + 1
      if (attacker._shotCount % 5 === 0) {
        AbilityVfx.pulseRing(this._scene, attacker.worldX, attacker.worldY, { color: 0xaaffaa, fromR: 6, toR: 24, durationMs: 350, alpha: 0.7 })
        AbilityVfx.floatingText(this._scene, attacker.worldX, attacker.worldY - 22, 'VOLLEY', { color: '#aaffaa' })
        let extraHits = 0
        for (const m of this._gameState.minions ?? []) {
          if (m === target) continue
          if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
          if (m.faction === 'adventurer') continue
          const d = Math.hypot(m.tileX - target.tileX, m.tileY - target.tileY)
          if (d > 2.01) continue
          m.resources.hp = Math.max(0, m.resources.hp - finalDmg)
          EventBus.emit('COMBAT_HIT', { sourceId: attacker.instanceId, targetId: m.instanceId, damage: finalDmg, damageType, isCritical: false })
          if (++extraHits >= 2) break
        }
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: attacker, abilityId: 'volley', message: `${attacker.name} loosed a volley.` })
      }
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
      if (attacker.classId === 'gladiator' && target.faction === 'dungeon' && target !== this._gameState.boss) {
        const prev = attacker._crowdRoarStacks ?? 0
        if (prev < CROWD_ROAR_MAX_STACKS) {
          const s = attacker._crowdRoarStacks = prev + 1
          AbilityVfx.shockwave(this._scene, attacker.worldX, attacker.worldY, { color: 0xffb347, fromR: 8, toR: 64 + s * 6, thickness: 5, durationMs: 420 })
          AbilityVfx.burstRays(this._scene, attacker.worldX, attacker.worldY - 8, { color: 0xffd27a, count: 8, length: 56 + s * 6, durationMs: 380 })
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

    // Pass-1: Orc Berserker Rage — Marauders/Warlords swing 30% faster
    // once they drop below half HP.
    if (entity.definitionId === 'orc1' || entity.definitionId === 'orc2') {
      const maxHp = entity.resources?.maxHp ?? 1
      const hp    = entity.resources?.hp    ?? maxHp
      if (hp / maxHp < 0.5) speed *= 1.3
    }

    // Pirate Grog Rage — berserk swing speed (set by _maybeGrogRage).
    if (entity.grogRagedToday) speed *= (Balance.PIRATE_GROG_SPD_MULT ?? 1.3)

    return Balance.ATTACK_INTERVAL_MS / Math.max(0.5, speed)
  }

  // Phase 6 — count OTHER living peasants within PEASANT_MOB_RADIUS of `peasant`
  // (capped at PEASANT_MOB_MAX_ALLIES). Drives both halves of Strength in Numbers.
  _peasantMobCount(peasant) {
    let n = 0
    for (const a of (this._gameState.adventurers?.active ?? [])) {
      if (a === peasant || a.classId !== 'peasant') continue
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
    const cls = attacker.mimickedClassId ?? attacker.classId

    // Mage: free-casting now (mana removed in Phase 5b cooldown rework). Spells
    // get a 10% damage bump over mundane attacks. Elemental Affinity (passive)
    // adds a further 50% if the target's vulnerableToElements list includes
    // the mage's rolled element. Arcane Burst (cooldown ability) flags the
    // next spell as AoE — the AoE pass is handled below in tryAttack.
    if (cls === 'mage') {
      raw = Math.floor(raw * 1.1)
      const el = attacker._element
      const vulns = target.tags ?? target.stats?.tags ?? target.def?.vulnerableToElements ?? []
      const minionDef = this._minionDefFor(target)
      const targetVulns = minionDef?.vulnerableToElements ?? []
      if (el && targetVulns.includes(el)) {
        raw = Math.floor(raw * 1.5)
      }
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

    // Phase 6 — Peasant Strength in Numbers (offensive half): a mobbed peasant
    // hits harder. +8% ATK per nearby fellow peasant, capped at +32%.
    if (cls === 'peasant') {
      const allies = this._peasantMobCount(attacker)
      if (allies > 0) raw = Math.floor(raw * (1 + allies * PEASANT_MOB_PER_ALLY))
    }
    // Defensive half: a mobbed peasant TARGET takes less damage — same +8%/ally,
    // cap +32%, applied as a damage reduction (the "+def" side of the buff).
    if (target.classId === 'peasant') {
      const dAllies = this._peasantMobCount(target)
      if (dAllies > 0) raw = Math.max(1, Math.floor(raw * (1 - dAllies * PEASANT_MOB_PER_ALLY)))
    }

    // Phase 5c — Twitch ATK buff/debuff window from Viewers Choice.
    if (attacker._twitchAtkMul && attacker._twitchEffectUntil && this._scene.time.now < attacker._twitchEffectUntil) {
      raw = Math.max(1, Math.floor(raw * attacker._twitchAtkMul))
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
    // active Armory room get +2 attack per swing. Cheap room-existence check
    // since attacker.faction tells us if this is a minion swing.
    // Tinkerer's Workshop "Weaponsmith" — buff doubled (+4) when the
    // Armory type is upgraded.
    const tinkered = this._gameState._tinkeredRoomTypes ?? []
    if (attacker.faction === 'dungeon' && attacker.assignedRoomId) {
      if (this._isAdjacentToActiveArmory(attacker.assignedRoomId)) {
        const armoryBonus = tinkered.includes('armory') ? 4 : 2
        raw += armoryBonus
      }
    }

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

    // Pass-1: Lizardman Camouflage — first attack while still hidden hits 3×.
    if (attacker?._camouflaged && (attacker.definitionId === 'lizardman1' || attacker.definitionId === 'lizardman2')) {
      raw = Math.floor(raw * 3)
    }
    // Pass-1: Orc Berserker Rage — already-applied via reduced cooldown
    // (see _cooldownFor); no damage multiplier needed here.

    const def = target.stats?.defense ?? 0
    let mit = Math.max(1, raw - def)

    // Pass-1: Ent Gnarled Hide — Sapling Sentinels and treants take half
    // damage from physical hits.
    const damageType = attacker.damageType ?? attacker.stats?.damageType ?? 'physical'
    if (damageType === 'physical' && target.definitionId &&
        (target.definitionId === 'ent1' || target.definitionId === 'ent2' || target.definitionId === 'ent3')) {
      mit = Math.max(1, Math.floor(mit * 0.5))
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

    // Solo Leveling — the Shadow Monarch (Sung Jinwoo) shrugs off your
    // defenders and butchers them: he takes 50% less damage from minions
    // and deals 50% more damage to them. (Trap reduction lives in
    // TrapSystem; the boss duel is stat-matched separately in BossSystem.)
    if (target._shadowMonarch && _isMinionAttacker(attacker)) {
      mit = Math.max(1, Math.floor(mit * 0.5))
    }
    if (attacker._shadowMonarch && target.faction === 'dungeon') {
      mit = Math.floor(mit * 1.5)
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

  // Phase 5c — apply Knight Protective Aura damage reduction.
  // If `target` is an adventurer AND there's a same-party Knight with an
  // active aura within `auraRangeTiles` (default 1), reduce damage by 25%.
  // The Knight himself is also covered (he stands in his own aura).
  _applyProtectiveAura(target, dmg) {
    if (!target || dmg <= 0) return dmg
    if (target.aiState === undefined) return dmg              // minion target — skip
    if (target.classId === undefined) return dmg              // not an adventurer
    const advs = this._gameState.adventurers?.active ?? []
    const now  = this._scene.time.now
    for (const knight of advs) {
      if (knight.classId !== 'knight') continue
      if (!knight._auraActiveUntil || now >= knight._auraActiveUntil) continue
      // Same-party check: solo Knights only protect themselves.
      if (knight !== target) {
        if (!knight.partyId || knight.partyId !== target.partyId) continue
      }
      const d = Math.hypot(target.tileX - knight.tileX, target.tileY - knight.tileY)
      if (d > 1.01) continue
      return Math.max(1, Math.floor(dmg * 0.75))
    }
    return dmg
  }

  // Phase 5c — Bard Inspire: if attacker is an adventurer and a same-party
  // Bard within 2 tiles has _inspireActiveUntil > now, multiply damage by 1.15.
  _applyInspireBuff(attacker, raw) {
    if (!attacker || raw <= 0) return raw
    if (attacker.classId === undefined) return raw  // minion attacker
    const advs = this._gameState.adventurers?.active ?? []
    const now  = this._scene.time.now
    for (const bard of advs) {
      if (bard.classId !== 'bard') continue
      if (!bard._inspireActiveUntil || now >= bard._inspireActiveUntil) continue
      if (bard !== attacker) {
        if (!bard.partyId || bard.partyId !== attacker.partyId) continue
      }
      const d = Math.hypot(attacker.tileX - bard.tileX, attacker.tileY - bard.tileY)
      if (d > 2.01) continue
      return Math.max(1, Math.floor(raw * 1.15))
    }
    return raw
  }

  // Phase 5c — minion definition lookup (for vulnerableToElements checks).
  _minionDefFor(target) {
    if (!target?.definitionId) return null
    const defs = this._minionDefsCache ?? (this._minionDefsCache = (() => {
      const arr = this._scene?.cache?.json?.get('minionTypes') ?? []
      const map = {}
      for (const m of arr) map[m.id] = m
      return map
    })())
    return defs[target.definitionId]
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

// Real-time combat resolution.
// Phase 6 kernel: typed damage, attack cooldowns, COMBAT_HIT / COMBAT_KILL events.
// Combat doesn't drive its own loop — the AI systems (adventurer + minion) call
// `tryAttack(attacker, target)` when they want to swing. CombatSystem enforces
// cooldown timing and damage math.
//
// Death cleanup (splice from active, push to graveyard, award essence) is the
// AI system's responsibility — CombatSystem only mutates HP and emits events.

import { EventBus }   from './EventBus.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE

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

    const now = this._scene.time.now
    const cooldown = this._cooldownFor(attacker)
    if (now - (attacker.lastAttackAt ?? 0) < cooldown) return null

    // Range check
    const dx = target.tileX - attacker.tileX
    const dy = target.tileY - attacker.tileY
    const dist = Math.hypot(dx, dy)
    const reach = (attacker.attackRange ?? Balance.MELEE_RANGE_TILES)
    if (dist > reach + 0.01) return null

    attacker.lastAttackAt = now
    // Phase QW — track target for _inferMethod backstab detection
    attacker._lastAttackTarget = target

    const damage     = this._computeDamage(attacker, target)
    // Phase 5c — Rogue Invisibility: if attacker is an invisible Rogue,
    // their attack is a guaranteed crit AND immediately reveals them.
    const rogueInvisCrit = attacker.classId === 'rogue' && attacker._invisible
    const isCritical = rogueInvisCrit ? true : Math.random() < 0.10
    let   finalDmg   = isCritical ? Math.floor(damage * 1.5) : damage

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

    // Phase 5c — Knight Protective Aura: party allies (and the Knight himself)
    // within auraRangeTiles of an aura-active Knight take 25% less damage.
    finalDmg = this._applyProtectiveAura(target, finalDmg)

    // Phase 5c — Twitch DEF buff: target's _twitchDefBonus subtracts from damage.
    if (target._twitchDefBonus && target._twitchEffectUntil && now < target._twitchEffectUntil) {
      finalDmg = Math.max(1, finalDmg - target._twitchDefBonus)
    }

    target.resources.hp = Math.max(0, target.resources.hp - finalDmg)

    const damageType = attacker.damageType
      ?? attacker.stats?.damageType
      ?? 'physical'
    const method = opts.method ?? this._inferMethod(attacker, damageType)

    EventBus.emit('COMBAT_HIT', {
      sourceId: attacker.instanceId,
      targetId: target.instanceId,
      damage:   finalDmg,
      damageType,
      isCritical,
    })

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

  // ── Internals ──────────────────────────────────────────────────────────────

  _cooldownFor(entity) {
    const speed = entity.stats?.speed ?? 1.0
    return Balance.ATTACK_INTERVAL_MS / Math.max(0.5, speed)
  }

  _computeDamage(attacker, target) {
    let raw = attacker.stats?.attack ?? 1

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
    if (attacker.faction === 'dungeon' && attacker.assignedRoomId) {
      if (this._isAdjacentToActiveArmory(attacker.assignedRoomId)) {
        raw += 2
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

    const def = target.stats?.defense ?? 0
    let mit = Math.max(1, raw - def)

    // Phase 9 mechanic damage modifiers
    const flags = this._gameState._mechanicFlags ?? {}
    if (flags.bloodbound && _isMinionAttacker(attacker)) {
      mit *= Balance.MECHANIC_BLOODBOUND_DAMAGE_MULT
    }
    if (flags.gravAnomaly) {
      const isMelee = (attacker.attackRange ?? 1) <= 1
      mit *= isMelee
        ? Balance.MECHANIC_GRAV_MELEE_DAMAGE_MULT
        : Balance.MECHANIC_GRAV_PROJECTILE_MULT
    }

    const variance = 1 + (Math.random() - 0.5) * 0.3
    return Math.max(1, Math.floor(mit * variance))
  }

  // Phase QW — Is the given room ID inside or adjacent (within 2 tile gap)
  // to an active Armory room? Used for the armory minion-attack buff.
  _isAdjacentToActiveArmory(roomId) {
    const rooms = this._gameState.dungeon.rooms ?? []
    const homeRoom = rooms.find(r => r.instanceId === roomId)
    if (!homeRoom) return false
    if (homeRoom.definitionId === 'armory' && homeRoom.isActive !== false) return true
    for (const r of rooms) {
      if (r.definitionId !== 'armory' || r.isActive === false) continue
      const ax2 = homeRoom.gridX + homeRoom.width  - 1
      const ay2 = homeRoom.gridY + homeRoom.height - 1
      const bx2 = r.gridX + r.width  - 1
      const by2 = r.gridY + r.height - 1
      const dx = Math.max(0, Math.max(homeRoom.gridX - bx2, r.gridX - ax2))
      const dy = Math.max(0, Math.max(homeRoom.gridY - by2, r.gridY - ay2))
      if (Math.max(dx, dy) <= 2) return true
    }
    return false
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
        const target = attacker._lastAttackTarget
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

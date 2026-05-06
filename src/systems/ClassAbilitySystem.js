// Phase 5c — class ability runtime.
//
// Per-tick brain for class-specific abilities. Decides when each adventurer
// should fire their abilities, applies effects, schedules expirations, and
// kicks off VFX. CombatSystem and MinionAISystem read `_auraActiveUntil` /
// `_tauntActiveUntil` to apply damage-reduction / aggro-override effects.
//
// Per-class consideration logic is added one class at a time. This file
// currently ships with Knight; Bard / Monk / Cleric / Mage / etc. will hang
// off the dispatch switch as their passes land.
//
// Buff fields written on the adventurer entity (transient, prefixed `_`):
//   _auraActiveUntil      (Knight Protective Aura)
//   _tauntActiveUntil     (Knight Taunt — read by MinionAISystem priority)
//   _inspireActiveUntil   (Bard Inspire Party — read by CombatSystem)
//   _songSpeedActiveUntil (Bard Song of Speed — read by AISystem movement)
//
// Cooldowns + per-day budgets live on adv.cooldowns / adv.usesLeftToday
// per the AbilitySystem contract.

import { EventBus }         from './EventBus.js'
import { AbilitySystem }    from './AbilitySystem.js'
import { AbilityVfx }       from '../ui/AbilityVfx.js'
import { Balance }          from '../config/balance.js'
import { PathfinderSystem } from './PathfinderSystem.js'
import { TILE }             from './DungeonGrid.js'

// Ability defs. Cooldown buckets are: small 5–8s, medium 12–18s, large 30–60s.
export const ABILITY_DEFS = {
  // Knight
  knight_aura:  { id: 'protective_aura', cooldownMs: 30000, durationMs: 6000, label: 'Protective Aura', auraRangeTiles: 1, dmgReduction: 0.25 },
  knight_taunt: { id: 'taunt',           cooldownMs: 12000, durationMs: 4000, label: 'Taunt' },
  // Bard
  bard_inspire: { id: 'inspire_party',   cooldownMs: 14000, durationMs: 6000, label: 'Inspire Party', auraRangeTiles: 2, atkMul: 1.15 },
  bard_speed:   { id: 'song_of_speed',   cooldownMs: 16000, durationMs: 6000, label: 'Song of Speed', auraRangeTiles: 2, spdMul: 1.20 },
  // Bard's Encore is a passive — fires on death, no cooldown.
  // Monk
  monk_focus:        { id: 'focus',        cooldownMs: 14000, durationMs: 5000, label: 'Focus', dodgeChance: 0.3 },
  monk_inner_peace:  { id: 'inner_peace',  cooldownMs: 40000, durationMs: 8000, label: 'Inner Peace', regenPerSec: 1 },
  // Cleric
  cleric_heal:           { id: 'cleric_heal',     cooldownMs: 10000,                   label: 'Heal' },
  cleric_resurrection:   { id: 'resurrection',   usesPerDay: 1,                        label: 'Resurrection' }, // 1 per day per cleric
  // Mage
  mage_arcane_burst:     { id: 'arcane_burst',   cooldownMs: 20000,                    label: 'Arcane Burst', aoeRangeTiles: 1 },
  // Mage Elemental Affinity is a passive (rolled at spawn; CombatSystem reads adv._element).
  // Necromancer
  necro_summon:          { id: 'summon_undead',  cooldownMs: 35000,                    label: 'Summon Undead', summonCount: 2 },
  necro_bone_armor:      { id: 'bone_armor',     cooldownMs: 30000, durationMs: 8000,  label: 'Bone Armor', perUndeadAtk: 1, perUndeadDef: 1 },
  // Ranger
  ranger_volley:         { id: 'volley',         label: 'Volley' }, // proc-based, every 5th shot
  ranger_trap_expert:    { id: 'trap_expert',    usesPerDayPerLevel: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, label: 'Trap Expert', failChance: 0.20 },
  // Beast Master
  bm_tame_beast:         { id: 'tame_beast',     cooldownMs: 8000,                     label: 'Tame Beast', successRate: 0.5, rangeTiles: 1.5 },
  bm_scout_ahead:        { id: 'scout_ahead',    usesPerDay: 1,                        label: 'Scout Ahead' },
  // Barbarian
  barb_break_door:       { id: 'break_door',     cooldownMs: 6000,                     label: 'Break Door' }, // dormant — needs locked doors to land
  // Barbarian Unstoppable + Rage Scaling are passives (no cooldown).
  // Rogue
  rogue_invisibility:    { id: 'invisibility',   cooldownMs: 30000, durationMs: 5000,  label: 'Invisibility' },
  rogue_lockpick:        { id: 'lockpick',       usesPerDayPerLevel: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, label: 'Lockpick', failChance: 0.20 },
  // Twitch Streamer
  twitch_viewers_choice: { id: 'viewers_choice', cooldownMs: 8000,                     label: 'Viewers Choice' }, // random auto-trigger
  twitch_chat_decides:   { id: 'chat_decides',   cooldownMs: 15000,                    label: 'Chat Decides' },
  // Twitch Subscriber Revenge is a passive — fires on death.
}

export class ClassAbilitySystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState

    // Sustained VFX refs keyed by adv.instanceId. Cleared on buff expiry.
    this._sustainedFx = new Map()

    // At day start, refresh per-day budgets for every active adventurer.
    EventBus.on('NEW_DAY_STARTED', this._onNewDay, this)
    // Phase 5c — when any adventurer ENTERS the dungeon (initial spawn,
    // returning leader, vendetta hunter, guild raid, etc.) explicitly clear
    // their per-instance ability state so all abilities are ready to fire
    // immediately. Cooldowns only begin counting after each ability is used
    // for the first time. This belt-and-suspenders the createAdventurer
    // initialization (which already sets cooldowns: {} / usesLeftToday: {})
    // — guarantees a fresh slate even for any code path that mutates an adv
    // entity's cooldown map before they reach the dungeon.
    this._onAdvEntered = (payload) => this._resetAbilitiesOnEntry(payload?.adventurer)
    EventBus.on('ADVENTURER_ENTERED_DUNGEON', this._onAdvEntered, this)
    // When an adventurer dies or flees, immediately end their buffs and
    // tear down any sustained VFX so we don't leave rings on the ground.
    // Death and flee are split so we can fire Bard's Encore on death only.
    this._onDied  = (payload) => this._onAdventurerRemoved({ ...payload, _isDeath: true })
    this._onFled  = (payload) => this._onAdventurerRemoved({ ...payload, _isDeath: false })
    EventBus.on('ADVENTURER_DIED', this._onDied, this)
    EventBus.on('ADVENTURER_FLED', this._onFled, this)
    EventBus.on('NIGHT_PHASE_STARTED', this._clearAllSustained, this)
    EventBus.on('DAY_PHASE_ENDED', this._clearAllSustained, this)
  }

  destroy() {
    EventBus.off('NEW_DAY_STARTED', this._onNewDay, this)
    EventBus.off('ADVENTURER_ENTERED_DUNGEON', this._onAdvEntered, this)
    EventBus.off('ADVENTURER_DIED', this._onDied, this)
    EventBus.off('ADVENTURER_FLED', this._onFled, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._clearAllSustained, this)
    EventBus.off('DAY_PHASE_ENDED', this._clearAllSustained, this)
    this._clearAllSustained()
  }

  // Reset the cooldown registry for an adventurer the moment they enter the
  // dungeon. usesLeftToday is also pre-filled to the full per-day budget per
  // ability def so canUse returns ready instead of relying on undefined-as-
  // unused (which works but is implicit and easy to misread).
  _resetAbilitiesOnEntry(adv) {
    if (!adv) return
    adv.cooldowns = {}
    adv.usesLeftToday = {}
    AbilitySystem.resetForNewDay(adv, Object.values(ABILITY_DEFS))
    // Necromancer can't cast Summon Undead for 3 s after entering the
    // dungeon — gives the player a brief window to react before the
    // necro pops a meat-shield wall the moment they appear.
    if (adv.classId === 'necromancer') {
      const now = this._scene?.time?.now ?? 0
      adv._summonGateUntil = now + 3000
    }
  }

  _onAdventurerRemoved(payload) {
    const adventurer = payload?.adventurer
    if (!adventurer) return

    // Bard passive — Encore: fires before any cleanup so the heal lands while
    // party members are still listed as active. Only fires on actual death,
    // not on flee. Heals every same-party adventurer (including ranged ones,
    // not just nearby) for 25% of their maxHp.
    if (
      adventurer.classId === 'bard' &&
      payload._isDeath === true &&
      adventurer.partyId &&
      !((this._gameState._mechanicFlags ?? {}).crusadersCurse)  // Phase 9 — Crusader's Curse silences bard encore.
    ) {
      this._fireEncore(adventurer)
    }

    // Twitch passive — Subscriber Revenge: 50% chance on death to add +3 to
    // tomorrow's spawn count. Stored on gameState.player and consumed by DayPhase.
    // Suppressed during Twitch Con event — chaos day, no escalation penalty.
    if (
      adventurer.classId === 'twitch_streamer' &&
      payload._isDeath === true &&
      !this._gameState._eventFlags?.twitchConActive &&
      Math.random() < 0.5
    ) {
      this._gameState.player ??= {}
      this._gameState.player.subscriberRevengeBonus =
        (this._gameState.player.subscriberRevengeBonus ?? 0) + 3
      EventBus.emit('SUBSCRIBER_REVENGE_TRIGGERED', { adventurer, bonus: 3 })
      EventBus.emit('ABILITY_TRIGGERED', {
        adventurer,
        abilityId: 'subscriber_revenge',
        message: `${adventurer.name}'s death clip went viral. +3 adventurers tomorrow.`,
      })
    }

    // Cancel any active buffs.
    adventurer._auraActiveUntil       = null
    adventurer._tauntActiveUntil      = null
    adventurer._inspireActiveUntil    = null
    adventurer._songSpeedActiveUntil  = null
    adventurer._focusActiveUntil      = null
    adventurer._innerPeaceUntil       = null
    adventurer._boneArmorUntil        = null
    adventurer._invisibilityUntil     = null
    adventurer._twitchEffectUntil     = null
    if (adventurer._invisible) this._endInvisibility(adventurer)
    // Clean up any sustained VFX (e.g. the Knight's aura ring or Bard rings).
    const map = this._sustainedFx.get(adventurer.instanceId)
    if (map) {
      for (const slot of Object.keys(map)) this._endSustainedFx(adventurer.instanceId, slot)
      this._sustainedFx.delete(adventurer.instanceId)
    }
  }

  _fireEncore(bard) {
    let healedCount = 0
    for (const adv of this._gameState.adventurers.active ?? []) {
      if (adv === bard) continue
      if (adv.partyId !== bard.partyId) continue
      if (adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      const before = adv.resources.hp
      const heal = Math.floor((adv.resources.maxHp ?? 0) * 0.25)
      adv.resources.hp = Math.min(adv.resources.maxHp ?? heal, adv.resources.hp + heal)
      const restored = adv.resources.hp - before
      if (restored > 0) {
        healedCount++
        AbilityVfx.pulseRing(this._scene, adv.worldX, adv.worldY, { color: 0xff66bb, fromR: 8, toR: 22, durationMs: 450, alpha: 0.75 })
        AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 24, `+${restored}`, { color: '#ff99cc', fontSize: '12px' })
        EventBus.emit('ALLY_HEALED', { sourceId: bard.instanceId, targetId: adv.instanceId, amount: restored })
      }
    }
    if (healedCount > 0) {
      AbilityVfx.pulseRing(this._scene, bard.worldX, bard.worldY, { color: 0xff66bb, fromR: 8, toR: 64, durationMs: 700, alpha: 0.85 })
      AbilityVfx.floatingText(this._scene, bard.worldX, bard.worldY - 28, 'ENCORE', { color: '#ff99cc', fontSize: '14px' })
    }
    EventBus.emit('ABILITY_TRIGGERED', {
      adventurer: bard,
      abilityId: 'encore',
      message: `${bard.name}'s final note healed ${healedCount} ally${healedCount === 1 ? '' : 'ies'}.`,
    })
  }

  update(_delta) {
    const now = this._scene.time.now
    const antiMagicRoomIds = this._gameState._antiMagicRoomIds ?? null
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      this._tickActiveBuffs(adv, now)
      // Phase 1b.3 — Beholder Anti-Magic Aura. While the active boss is the
      // beholder, advs standing in a marked room can't fire ANY class
      // abilities. Existing buff timers still tick out via _tickActiveBuffs.
      const silenced = antiMagicRoomIds && antiMagicRoomIds.length > 0 &&
        _advInAntiMagicRoom(adv, this._gameState, antiMagicRoomIds)
      if (!silenced) {
        switch (adv.classId) {
          case 'knight':          this._considerKnight(adv, now); break
          case 'bard':            this._considerBard(adv, now);   break
          case 'monk':            this._considerMonk(adv, now);   break
          case 'cleric':          this._considerCleric(adv, now); break
          case 'mage':            this._considerMage(adv, now);   break
          case 'necromancer':     this._considerNecromancer(adv, now); break
          case 'ranger':          this._considerRanger(adv, now); break
          case 'beast_master':    this._considerBeastMaster(adv, now); break
          case 'barbarian':       this._considerBarbarian(adv, now); break
          case 'rogue':           this._considerRogue(adv, now);  break
          case 'twitch_streamer': this._considerTwitch(adv, now); break
        }
      }
      // Inner Peace tick — Monk regen while active (any class can be regen-target
      // but only Monk's Inner Peace ability sets _innerPeaceUntil).
      this._tickInnerPeace(adv, now)
    }
  }

  // ── Buff lifecycle ─────────────────────────────────────────────────────────

  _tickActiveBuffs(adv, now) {
    if (adv._auraActiveUntil && now >= adv._auraActiveUntil) {
      adv._auraActiveUntil = null
      this._endSustainedFx(adv.instanceId, 'aura')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'protective_aura' })
    }
    if (adv._tauntActiveUntil && now >= adv._tauntActiveUntil) {
      adv._tauntActiveUntil = null
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'taunt' })
    }
    if (adv._inspireActiveUntil && now >= adv._inspireActiveUntil) {
      adv._inspireActiveUntil = null
      this._endSustainedFx(adv.instanceId, 'inspire')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'inspire_party' })
    }
    if (adv._songSpeedActiveUntil && now >= adv._songSpeedActiveUntil) {
      adv._songSpeedActiveUntil = null
      this._endSustainedFx(adv.instanceId, 'song_speed')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'song_of_speed' })
    }
    // Monk
    if (adv._focusActiveUntil && now >= adv._focusActiveUntil) {
      adv._focusActiveUntil = null
      this._endSustainedFx(adv.instanceId, 'focus')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'focus' })
    }
    if (adv._innerPeaceUntil && now >= adv._innerPeaceUntil) {
      adv._innerPeaceUntil = null
      this._endSustainedFx(adv.instanceId, 'inner_peace')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'inner_peace' })
    }
    // Necromancer
    if (adv._boneArmorUntil && now >= adv._boneArmorUntil) {
      adv._boneArmorUntil = null
      this._endSustainedFx(adv.instanceId, 'bone_armor')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'bone_armor' })
    }
    // Rogue
    if (adv._invisibilityUntil && now >= adv._invisibilityUntil) {
      adv._invisibilityUntil = null
      this._endInvisibility(adv)
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'invisibility' })
    }
    // Twitch — temporary effect timers (heal/atk/def buffs/poison/etc from Viewers Choice)
    if (adv._twitchEffectUntil && now >= adv._twitchEffectUntil) {
      adv._twitchEffectUntil = null
      adv._twitchAtkMul = null
      adv._twitchDefBonus = null
      adv._twitchPoisonUntil = null
      this._endSustainedFx(adv.instanceId, 'twitch_buff')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'viewers_choice' })
    }
  }

  _tickInnerPeace(adv, now) {
    if (!adv._innerPeaceUntil) return
    if (now >= adv._innerPeaceUntil) return
    if (adv.resources.hp >= adv.resources.maxHp) return
    // 1 HP/sec while active. Tick once per second using a stamp.
    const last = adv._innerPeaceLastTick ?? 0
    if (now - last < 1000) return
    adv._innerPeaceLastTick = now
    adv.resources.hp = Math.min(adv.resources.maxHp, adv.resources.hp + 2)
    AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 10, '+2', { color: '#a4ffb0', fontSize: '10px', durationMs: 500, driftY: -16 })
  }

  _endSustainedFx(instanceId, slot) {
    const map = this._sustainedFx.get(instanceId)
    if (!map) return
    const obj = map[slot]
    if (!obj) return
    if (obj.tween && obj.tween.isPlaying()) obj.tween.stop()
    if (obj.fadeTween && obj.fadeTween.isPlaying?.()) obj.fadeTween.stop()
    if (typeof obj.cleanup === 'function') obj.cleanup()
    if (obj.gfx && obj.gfx.active && obj.gfx.destroy) obj.gfx.destroy()
    delete map[slot]
  }

  _setSustainedFx(instanceId, slot, value) {
    if (!this._sustainedFx.has(instanceId)) this._sustainedFx.set(instanceId, {})
    this._sustainedFx.get(instanceId)[slot] = value
  }

  _clearAllSustained() {
    for (const id of [...this._sustainedFx.keys()]) {
      const map = this._sustainedFx.get(id)
      for (const slot of Object.keys(map)) this._endSustainedFx(id, slot)
    }
    this._sustainedFx.clear()
  }

  // Phase 5c — sustained "ground halo" helper. Renders a thin, low-opacity
  // ellipse at the adventurer's feet (depth 5, below the character at depth 8)
  // so it reads as a ground glow without covering the sprite. Auto-fades over
  // the last 400ms of duration and follows the adv around. Self-destructs if
  // the adv leaves the active list (covers death/flee/scene-end).
  _createGroundHalo(adv, slot, color, durationMs, opts = {}) {
    const x = adv.worldX, y = (adv.worldY ?? 0) + (opts.yOffset ?? 18)
    const w = opts.width  ?? 28
    const h = opts.height ?? 9
    const alpha = opts.alpha ?? 0.22
    const ellipse = this._scene.add.ellipse(x, y, w, h, color, alpha)
    ellipse.setDepth(5)
    const followUpdate = () => {
      if (!ellipse.active) return
      if (!this._gameState.adventurers.active.includes(adv)) {
        this._scene.events.off('update', followUpdate)
        if (ellipse.active) ellipse.destroy()
        return
      }
      // Skip the position update if worldX/Y aren't valid — the next
      // active-list check or buff-end will tear this down. Avoids briefly
      // flashing the halo at world (0, 0) in the upper-left corner.
      if (Number.isFinite(adv.worldX) && Number.isFinite(adv.worldY)) {
        ellipse.setPosition(adv.worldX, adv.worldY + (opts.yOffset ?? 18))
      }
    }
    this._scene.events.on('update', followUpdate)
    const fadeTween = this._scene.tweens.add({
      targets: ellipse, alpha: 0, duration: 400,
      delay: Math.max(0, durationMs - 400),
      onComplete: () => {
        this._scene.events.off('update', followUpdate)
        if (ellipse.active) ellipse.destroy()
      },
    })
    this._setSustainedFx(adv.instanceId, slot, {
      gfx: ellipse,
      fadeTween,
      cleanup: () => this._scene.events.off('update', followUpdate),
    })
    return ellipse
  }

  // ── Knight ────────────────────────────────────────────────────────────────

  _considerKnight(adv, now) {
    // Protective Aura — fire when self or any party ally within 1 tile
    // is below 70% HP. Aura buff lasts 6s and reduces damage by 25% on
    // the Knight + nearby same-party allies (CombatSystem reads it).
    const auraDef = ABILITY_DEFS.knight_aura
    if (this._allyInDangerNearby(adv, auraDef.auraRangeTiles)) {
      const ready = AbilitySystem.canUse(adv, auraDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, auraDef, now)
        adv._auraActiveUntil = now + auraDef.durationMs
        this._fireAuraVfx(adv, auraDef.durationMs)
        EventBus.emit('ABILITY_TRIGGERED', {
          adventurer: adv,
          abilityId: 'protective_aura',
          message: `${adv.name} raised a Protective Aura.`,
        })
      }
    }

    // Taunt — fire when there's a hostile minion close enough to threaten
    // the party, OR when a wounded party ally (<50% HP) is fighting within
    // 5 tiles (priority taunt to save them). MinionAISystem bumps the Knight
    // to top target for the duration so allies get breathing room.
    const tauntDef = ABILITY_DEFS.knight_taunt
    if (this._hostileMinionWithin(adv, 4) || this._woundedAllyEngagedNearby(adv, 5)) {
      const ready = AbilitySystem.canUse(adv, tauntDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, tauntDef, now)
        adv._tauntActiveUntil = now + tauntDef.durationMs
        this._fireTauntVfx(adv)
        EventBus.emit('ABILITY_TRIGGERED', {
          adventurer: adv,
          abilityId: 'taunt',
          message: `${adv.name} taunted enemies!`,
        })
      }
    }
  }

  _woundedAllyEngagedNearby(knight, rangeTiles) {
    if (!knight.partyId) return false
    for (const adv of this._gameState.adventurers.active) {
      if (adv === knight || adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      if (adv.partyId !== knight.partyId) continue
      if (adv.aiState !== 'fighting') continue
      const frac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
      if (frac > 0.5) continue
      const d = Math.hypot(adv.tileX - knight.tileX, adv.tileY - knight.tileY)
      if (d <= rangeTiles + 0.01) return true
    }
    return false
  }

  _allyInDangerNearby(knight, rangeTiles) {
    // Knight himself counts as an "ally" — protects himself when wounded.
    const selfFrac = knight.resources.maxHp > 0
      ? knight.resources.hp / knight.resources.maxHp : 1
    if (selfFrac < 0.7) return true
    if (!knight.partyId) return false
    for (const adv of this._gameState.adventurers.active) {
      if (adv === knight || adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      if (adv.partyId !== knight.partyId) continue
      const d = Math.hypot(adv.tileX - knight.tileX, adv.tileY - knight.tileY)
      if (d > rangeTiles + 0.01) continue
      const frac = adv.resources.maxHp > 0
        ? adv.resources.hp / adv.resources.maxHp : 1
      if (frac < 0.7) return true
    }
    return false
  }

  // ── Bard ──────────────────────────────────────────────────────────────────

  _considerBard(adv, now) {
    // Inspire Party — fire when a same-party ally within 2 tiles is fighting.
    // Boosts attack damage during combat.
    const inspireDef = ABILITY_DEFS.bard_inspire
    if (this._partyAllyEngagedWithin(adv, inspireDef.auraRangeTiles)) {
      const ready = AbilitySystem.canUse(adv, inspireDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, inspireDef, now)
        adv._inspireActiveUntil = now + inspireDef.durationMs
        this._fireInspireVfx(adv, inspireDef.durationMs)
        EventBus.emit('ABILITY_TRIGGERED', {
          adventurer: adv,
          abilityId: 'inspire_party',
          message: `${adv.name} struck up an inspiring tune.`,
        })
      }
    }

    // Song of Speed — fire when a same-party ally within 2 tiles is fleeing
    // (or the bard is). Helps escape and chase.
    const speedDef = ABILITY_DEFS.bard_speed
    if (this._partyAllyFleeingWithin(adv, speedDef.auraRangeTiles)) {
      const ready = AbilitySystem.canUse(adv, speedDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, speedDef, now)
        adv._songSpeedActiveUntil = now + speedDef.durationMs
        this._fireSpeedSongVfx(adv, speedDef.durationMs)
        EventBus.emit('ABILITY_TRIGGERED', {
          adventurer: adv,
          abilityId: 'song_of_speed',
          message: `${adv.name} began a Song of Speed.`,
        })
      }
    }
  }

  _partyAllyEngagedWithin(bard, rangeTiles) {
    if (bard.aiState === 'fighting') return true
    if (!bard.partyId) return false
    for (const adv of this._gameState.adventurers.active) {
      if (adv === bard || adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      if (adv.partyId !== bard.partyId) continue
      if (adv.aiState !== 'fighting') continue
      const d = Math.hypot(adv.tileX - bard.tileX, adv.tileY - bard.tileY)
      if (d <= rangeTiles + 0.01) return true
    }
    return false
  }

  _partyAllyFleeingWithin(bard, rangeTiles) {
    if (bard.aiState === 'fleeing') return true
    if (!bard.partyId) return false
    for (const adv of this._gameState.adventurers.active) {
      if (adv === bard || adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      if (adv.partyId !== bard.partyId) continue
      if (adv.aiState !== 'fleeing' && adv.goal?.type !== 'FLEE') continue
      const d = Math.hypot(adv.tileX - bard.tileX, adv.tileY - bard.tileY)
      if (d <= rangeTiles + 0.01) return true
    }
    return false
  }

  _fireInspireVfx(adv, durationMs) {
    this._createGroundHalo(adv, 'inspire', 0xff5577, durationMs)
  }

  _fireSpeedSongVfx(adv, durationMs) {
    this._createGroundHalo(adv, 'song_speed', 0x66ccff, durationMs)
  }

  _hostileMinionWithin(adv, rangeTiles) {
    const minions = this._gameState.minions ?? []
    for (const m of minions) {
      if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
      if (m.faction === 'adventurer') continue // tamed/raised allies don't count
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d <= rangeTiles + 0.01) return true
    }
    return false
  }

  _nearestHostileMinion(adv, rangeTiles) {
    const minions = this._gameState.minions ?? []
    let best = null, bestD = Infinity
    for (const m of minions) {
      if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
      if (m.faction === 'adventurer') continue
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d > rangeTiles + 0.01) continue
      if (d < bestD) { best = m; bestD = d }
    }
    return best
  }

  // ── Monk ──────────────────────────────────────────────────────────────────

  _considerMonk(adv, now) {
    // Focus — fire when in combat or hostile minion is close (also when
    // about to step on a trap, but trap-look-ahead is overkill; combat works).
    const focusDef = ABILITY_DEFS.monk_focus
    if (this._hostileMinionWithin(adv, 4)) {
      const ready = AbilitySystem.canUse(adv, focusDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, focusDef, now)
        adv._focusActiveUntil = now + focusDef.durationMs
        this._fireFocusVfx(adv, focusDef.durationMs)
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'focus', message: `${adv.name} entered Focus.` })
      }
    }
    // Inner Peace — fire when below 70% HP and not currently regenerating.
    const ipDef = ABILITY_DEFS.monk_inner_peace
    const frac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
    if (frac < 0.7 && !adv._innerPeaceUntil) {
      const ready = AbilitySystem.canUse(adv, ipDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, ipDef, now)
        adv._innerPeaceUntil = now + ipDef.durationMs
        adv._innerPeaceLastTick = now
        // No ground-halo VFX — only the +2 floating text on each tick.
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'inner_peace', message: `${adv.name} found Inner Peace.` })
      }
    }
  }

  _fireFocusVfx(adv, durationMs) {
    this._createGroundHalo(adv, 'focus', 0xeeeeff, durationMs)
  }

  // ── Cleric ────────────────────────────────────────────────────────────────

  _considerCleric(adv, now) {
    // Phase 9 — Crusader's Curse: clerics cannot heal in this dungeon.
    if ((this._gameState._mechanicFlags ?? {}).crusadersCurse) return
    // Heal — find lowest-HP same-party ally below 70% HP within range.
    const healDef = ABILITY_DEFS.cleric_heal
    const target = this._findHealTarget(adv)
    if (target) {
      const ready = AbilitySystem.canUse(adv, healDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, healDef, now)
        // Apply heal directly (we already verified target/range).
        const before = target.resources.hp
        const heal = Balance.CLERIC_HEAL_AMOUNT ?? 12
        target.resources.hp = Math.min(target.resources.maxHp, target.resources.hp + heal)
        const restored = target.resources.hp - before
        AbilityVfx.pulseRing(this._scene, target.worldX, target.worldY, { color: 0xfff4a8, fromR: 8, toR: 22, durationMs: 400, alpha: 0.85 })
        AbilityVfx.floatingText(this._scene, target.worldX, target.worldY - 22, `+${restored}`, { color: '#fff4a8' })
        EventBus.emit('ALLY_HEALED', { sourceId: adv.instanceId, targetId: target.instanceId, amount: restored })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'cleric_heal', message: `${adv.name} healed ${this._shortName(target)}.` })
      }
    }
  }

  _findHealTarget(cleric) {
    let best = null, bestFrac = Balance.CLERIC_HEAL_TARGET_THRESHOLD ?? 0.7
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      if (adv === cleric) continue
      if (cleric.partyId && adv.partyId !== cleric.partyId) continue
      const frac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
      if (frac >= bestFrac) continue
      const d = Math.hypot(adv.tileX - cleric.tileX, adv.tileY - cleric.tileY)
      if (d > (Balance.HEAL_RANGE_TILES ?? 2) + 0.01) continue
      if (frac < bestFrac) { best = adv; bestFrac = frac }
    }
    return best
  }

  // Cleric Resurrection — invoked from AISystem._kill BEFORE death processing.
  // Returns true if a same-party Cleric (with Resurrection still available)
  // revives the falling adventurer at 30% HP.
  attemptClericResurrect(falling) {
    if (!falling || falling.classId === undefined) return false
    if (falling.aiState === 'dead') return false
    const advs = this._gameState.adventurers?.active ?? []
    for (const cleric of advs) {
      if (cleric.classId !== 'cleric') continue
      if (cleric === falling) continue
      if (cleric.aiState === 'dead' || cleric.resources?.hp <= 0) continue
      if (cleric.partyId && cleric.partyId !== falling.partyId) continue
      const ready = AbilitySystem.canUse(cleric, ABILITY_DEFS.cleric_resurrection, this._scene.time.now)
      if (!ready.ready) continue
      // Spend the use.
      AbilitySystem.markUsed(cleric, ABILITY_DEFS.cleric_resurrection, this._scene.time.now)
      // Revive at 30% HP and FULLY reset transient AI state so the adv
      // doesn't freeze on stale path/goal/target left over from the moment
      // they died. Without this, the resurrected adv often stood still.
      falling.resources.hp   = Math.max(1, Math.floor(falling.resources.maxHp * 0.30))
      falling.aiState        = 'walking'
      falling.path           = null
      falling.pathIndex      = 0
      falling.pathTarget     = null
      falling.currentTargetId = null
      falling.lastAttackAt   = 0
      falling._lastHitBy     = null
      falling._lastHitType   = null
      // Clear damage-window flags that might still gate behavior.
      falling._stuckInEntryMs = 0
      // Drop any BossSystem fight state — if they died in the boss room,
      // BossSystem flagged fs.action='dying' before this revive ran.
      // Without clearing it, the next BossSystem tick keeps them frozen
      // in the dying pose (no motion + _killAdv re-fire after actionDur).
      // Deleting the entry lets _syncFightParty re-conscript them with a
      // fresh `approach` action when they next land on an interior tile.
      this._scene.bossSystem?._fightStates?.delete(falling.instanceId)
      // Pick a fresh goal so they walk again instead of sitting on the old
      // (probably-dead-target) goal.
      this._scene.aiSystem?.pickInitialGoal?.(falling)
      AbilityVfx.pulseRing(this._scene, falling.worldX, falling.worldY, { color: 0xffffaa, fromR: 4, toR: 22, durationMs: 400, alpha: 0.7 })
      AbilityVfx.floatingText(this._scene, falling.worldX, falling.worldY - 30, 'REVIVED', { color: '#ffffaa', fontSize: '14px' })
      EventBus.emit('ABILITY_TRIGGERED', { adventurer: cleric, abilityId: 'resurrection', message: `${cleric.name} revived ${this._shortName(falling)}.` })
      return true
    }
    return false
  }

  // ── Mage ──────────────────────────────────────────────────────────────────

  _considerMage(adv, now) {
    // Make sure Elemental Affinity is rolled (passive trait set on first sight).
    // Phase 5c — no above-head icon or combat-log emit; the element only
    // surfaces through bonus damage on vulnerable minions.
    if (!adv._element) {
      const ELEMENTS = ['fire', 'ice', 'lightning', 'wind']
      adv._element = ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)]
    }
    // Arcane Burst — fire when in combat or hostile minion is within 3 tiles
    // (mage will then make their next attack AoE).
    const burstDef = ABILITY_DEFS.mage_arcane_burst
    if (this._hostileMinionWithin(adv, 4) && !adv._arcaneBurstQueued) {
      const ready = AbilitySystem.canUse(adv, burstDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, burstDef, now)
        adv._arcaneBurstQueued = true   // CombatSystem consumes this on next hit
        const x = adv.worldX, y = adv.worldY
        AbilityVfx.pulseRing(this._scene, x, y, { color: this._elementColor(adv._element), fromR: 8, toR: 30, durationMs: 400, alpha: 0.85 })
        AbilityVfx.particleBurst(this._scene, x, y, { color: this._elementColor(adv._element), count: 12, durationMs: 600, speed: 70 })
        AbilityVfx.floatingText(this._scene, x, y - 28, 'ARCANE BURST', { color: '#cc99ff', fontSize: '12px' })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'arcane_burst', message: `${adv.name} charges an Arcane Burst.` })
      }
    }
  }

  _elementColor(el) {
    return el === 'fire' ? 0xff6633 : el === 'ice' ? 0x66ddff : el === 'lightning' ? 0xffff66 : 0xaaffff
  }

  // ── Necromancer ──────────────────────────────────────────────────────────

  _considerNecromancer(adv, now) {
    const undeadCount = this._countOwnUndead(adv)

    // Summon Undead — fire whenever the necro has no undead (priority: necro
    // should always have a meatshield up), or when count is below the per-cast
    // amount AND a hostile minion is close (replenish mid-combat).
    const summonDef    = ABILITY_DEFS.necro_summon
    const summonTarget = summonDef.summonCount ?? 2
    // 3 s entry delay before the first Summon Undead can fire — see
    // _resetAbilitiesOnEntry where _summonGateUntil is stamped.
    const gated = adv._summonGateUntil != null && now < adv._summonGateUntil
    const shouldSummon = !gated && (
                         undeadCount === 0
                      || (undeadCount < summonTarget && this._hostileMinionWithin(adv, 5)))
    if (shouldSummon) {
      const ready = AbilitySystem.canUse(adv, summonDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, summonDef, now)
        const summoned = this._summonUndead(adv, summonDef.summonCount)
        const x = adv.worldX, y = adv.worldY
        AbilityVfx.pulseRing(this._scene, x, y, { color: 0xaa66cc, fromR: 8, toR: 36, durationMs: 500, alpha: 0.85 })
        AbilityVfx.particleBurst(this._scene, x, y, { color: 0x884499, count: 16, durationMs: 700, speed: 100 })
        AbilityVfx.floatingText(this._scene, x, y - 30, 'SUMMON', { color: '#cc99ff' })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'summon_undead', message: `${adv.name} summoned ${summoned} undead.` })
      }
    }
    // Bone Armor — fire when at least 1 player-faction undead exists nearby
    // (necro currently has summons up). Buff scales with current count.
    const armorDef = ABILITY_DEFS.necro_bone_armor
    if (undeadCount > 0 && !adv._boneArmorUntil) {
      const ready = AbilitySystem.canUse(adv, armorDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, armorDef, now)
        adv._boneArmorUntil = now + armorDef.durationMs
        adv._boneArmorAtk = undeadCount * armorDef.perUndeadAtk
        adv._boneArmorDef = undeadCount * armorDef.perUndeadDef
        this._createGroundHalo(adv, 'bone_armor', 0xddccaa, armorDef.durationMs)
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'bone_armor', message: `${adv.name} clad in Bone Armor (+${adv._boneArmorAtk} ATK / +${adv._boneArmorDef} DEF).` })
      }
    }
  }

  _summonUndead(necro, count) {
    const types = this._scene.cache.json.get('minionTypes') ?? []
    // Only skeletons + zombies — they're the visually-canonical Necromancer
    // summons AND the only undead types with full sprite coverage in the
    // existing minion sheets (ghosts/liches/vampires would look weird).
    const undeadTypes = types.filter((t) => /^(skeleton|zombie)/.test(t.id))
    if (undeadTypes.length === 0) return 0
    let summoned = 0
    const grid = this._scene.dungeonGrid
    const room = grid?.getRoomAtTile(necro.tileX, necro.tileY)
    const today = this._gameState.meta?.dayNumber ?? 1
    // Pre-compute walkable adjacent tiles so summons spawn ON the floor
    // (not inside a wall or void).  Without this, a necro near a wall
    // would drop summons that immediately get stuck because A* can't
    // path from a non-walkable tile.  Falls back to the necro's tile
    // (always walkable since they're standing on it) when no neighbour
    // is free.
    const candidates = this._walkableAdjacentTiles(necro.tileX, necro.tileY, grid)
    for (let i = 0; i < count; i++) {
      const type = undeadTypes[Math.floor(Math.random() * undeadTypes.length)]
      const slot = candidates[i % Math.max(1, candidates.length)]
        ?? { x: necro.tileX, y: necro.tileY }
      const minion = this._createSummonedUndead(type, slot.x, slot.y, room?.instanceId, necro)
      if (!minion) continue
      // Full HP, 70% ATK — tanky-ish summons that survive a few hits.
      // (User feedback: half-HP undead were dying too fast.)
      minion.resources.hp    = minion.resources.maxHp
      minion.stats.attack    = Math.max(1, Math.floor(minion.stats.attack * 0.7))
      // Match the necro's speed so summons keep up while following.
      minion.stats.speed     = necro.stats?.speed ?? minion.stats.speed
      minion.faction = 'adventurer'
      minion.factionExpiresOn = today + 1   // despawn at next day-end
      minion.raisedByAdvId = necro.instanceId
      this._gameState.minions.push(minion)
      EventBus.emit('MINION_SUMMONED', { minion, summoner: necro })
      summoned++
    }
    return summoned
  }

  _createSummonedUndead(typeDef, tileX, tileY, assignedRoomId, summoner) {
    // Inline minimal create — avoids importing createMinion to dodge cyclic deps.
    const TS = Balance.TILE_SIZE
    const baseStats = typeDef.baseStats || {}
    return {
      instanceId: `summon_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      definitionId: typeDef.id,
      name: null, color: 0xaaaa66, sigil: 'S',
      tileX, tileY, worldX: tileX * TS + TS / 2, worldY: tileY * TS + TS / 2,
      homeTileX: tileX, homeTileY: tileY,
      assignedRoomId: assignedRoomId ?? null,
      behaviorType: 'guard',
      tags: [...(typeDef.tags || [])],
      damageType: baseStats.damageType ?? 'physical',
      attackRange: baseStats.attackRange ?? 1,
      faction: 'adventurer', factionExpiresOn: null,
      raisedByAdvId: summoner.instanceId, tamedByAdvId: null,
      isMiniBoss: false,
      stats: { hp: baseStats.hp ?? 8, attack: baseStats.attack ?? 3, defense: baseStats.defense ?? 0, speed: baseStats.speed ?? 1.0, abilities: [...(baseStats.abilities ?? [])] },
      resources: { hp: baseStats.hp ?? 8, maxHp: baseStats.hp ?? 8 },
      level: 1, xp: 0,
      aiState: 'idle', currentTargetId: null, deathDay: null, killHistory: [],
    }
  }

  // Return up to 8 walkable tiles adjacent (including diagonals) to
  // (cx, cy), ordered cardinals-first then diagonals so the closest
  // orthogonal floor wins.  Used to land Necromancer summons on real
  // floor tiles instead of inside walls.
  _walkableAdjacentTiles(cx, cy, grid) {
    if (!grid) return []
    const offsets = [
      [ 1,  0], [-1,  0], [ 0,  1], [ 0, -1],
      [ 1,  1], [ 1, -1], [-1,  1], [-1, -1],
    ]
    const out = []
    for (const [dx, dy] of offsets) {
      const tx = cx + dx, ty = cy + dy
      const t = grid.getTileType?.(tx, ty)
      if (t == null) continue
      if (!PathfinderSystem.isWalkable(t)) continue
      // Skip doorway tiles entirely so summons don't park inside the
      // single-file lane (they'd block other entities and look like
      // they spawned in the wall).
      if (t === TILE.DOOR) continue
      out.push({ x: tx, y: ty })
    }
    return out
  }

  _countOwnUndead(necro) {
    let n = 0
    for (const m of this._gameState.minions ?? []) {
      if (m.faction !== 'adventurer') continue
      if (m.raisedByAdvId !== necro.instanceId) continue
      if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
      n++
    }
    return n
  }

  // ── Ranger ────────────────────────────────────────────────────────────────

  _considerRanger(adv, now) {
    // Volley is a proc handled in CombatSystem (every 5th shot). Nothing
    // to consider here per-tick.

    // Trap Expert — auto-disarm a trap in the same tile or adjacent (1-tile).
    // Limited per-day uses; 20% failure → trap fires on the Ranger.
    const teDef = ABILITY_DEFS.ranger_trap_expert
    const traps = this._gameState.dungeon?.traps ?? []
    for (const trap of traps) {
      if (trap.isTriggered || trap._disabledThisDay) continue
      const d = Math.hypot(trap.tileX - adv.tileX, trap.tileY - adv.tileY)
      if (d > 1.5) continue
      const ready = AbilitySystem.canUse(adv, teDef, now)
      if (!ready.ready) break
      AbilitySystem.markUsed(adv, teDef, now)
      if (Math.random() < (teDef.failChance ?? 0.2)) {
        // Failure — trigger the trap on the ranger.
        AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'FUMBLE!', { color: '#ff6644' })
        EventBus.emit('TRAP_DISARM_FAILED', { trap, adventurer: adv })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'trap_expert', message: `${adv.name} fumbled a trap.` })
        // Manually fire the trap effect via TrapSystem if possible.
        this._scene.trapSystem?._fireTrap?.(trap, this._scene.trapSystem._defs?.[trap.definitionId], adv)
      } else {
        trap._disabledThisDay = true
        AbilityVfx.pulseRing(this._scene, trap.tileX * Balance.TILE_SIZE + Balance.TILE_SIZE/2, trap.tileY * Balance.TILE_SIZE + Balance.TILE_SIZE/2, { color: 0xaaffaa, fromR: 8, toR: 22, durationMs: 400, alpha: 0.85 })
        AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'DISARMED', { color: '#aaffaa' })
        EventBus.emit('TRAP_DISARMED', { trap, adventurer: adv })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'trap_expert', message: `${adv.name} disarmed a trap.` })
      }
      break
    }
  }

  // ── Beast Master ─────────────────────────────────────────────────────────

  _considerBeastMaster(adv, now) {
    // Tame Beast — find a hostile minion within range, attempt 50% tame if we
    // don't already have a companion alive.
    const tameDef = ABILITY_DEFS.bm_tame_beast
    const hasCompanion = this._beastMasterCompanion(adv) != null
    if (!hasCompanion) {
      const target = this._nearestHostileMinion(adv, tameDef.rangeTiles)
      if (target) {
        const ready = AbilitySystem.canUse(adv, tameDef, now)
        if (ready.ready) {
          AbilitySystem.markUsed(adv, tameDef, now)
          if (Math.random() < tameDef.successRate) {
            target.faction = 'adventurer'
            target.factionExpiresOn = (this._gameState.meta?.dayNumber ?? 1) + 99
            target.tamedByAdvId = adv.instanceId
            target.currentTargetId = null
            adv.companionId = target.instanceId
            AbilityVfx.pulseRing(this._scene, target.worldX, target.worldY, { color: 0xff99cc, fromR: 8, toR: 28, durationMs: 500, alpha: 0.85 })
            AbilityVfx.floatingText(this._scene, target.worldX, target.worldY - 22, 'TAMED', { color: '#ff99cc' })
            EventBus.emit('MINION_TAMED', { minion: target, tamer: adv })
            EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'tame_beast', message: `${adv.name} tamed a beast.` })
          } else {
            AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'TAME FAILED', { color: '#999999', fontSize: '10px' })
            EventBus.emit('TAME_FAILED', { minion: target, tamer: adv })
          }
        }
      }
    }
    // Scout Ahead — fires once per day, when companion is alive AND the
    // BM "decides" to scout (40% chance, rolled once per day so the choice
    // is sticky — they either send the beast scouting that day, or keep it
    // by their side).
    const scoutDef = ABILITY_DEFS.bm_scout_ahead
    const companion = this._beastMasterCompanion(adv)
    const dayNum = this._gameState.meta?.dayNumber ?? 1
    if (companion) {
      const ready = AbilitySystem.canUse(adv, scoutDef, now)
      if (ready.ready) {
        if (adv._scoutDecisionDay !== dayNum) {
          adv._scoutDecisionDay = dayNum
          adv._scoutWillFire    = Math.random() < 0.4
        }
        if (!adv._scoutWillFire) return
        AbilitySystem.markUsed(adv, scoutDef, now)
        // Transfer knowledge of all rooms — simplest possible "scout" sim.
        const ks = this._scene.knowledgeSystem
        if (ks?._grantRoomVisited) {
          for (const room of this._gameState.dungeon?.rooms ?? []) {
            ks._grantRoomVisited?.(adv, room.instanceId)
          }
        }
        // Companion vanishes during scouting (briefly): it goes to dead state for 0.3s.
        // To keep it simple, we just tag a flag and bring it back in 1s.
        companion._scoutingUntil = now + 1000
        AbilityVfx.pulseRing(this._scene, adv.worldX, adv.worldY, { color: 0x88ccff, fromR: 6, toR: 30, durationMs: 500, alpha: 0.85 })
        AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 24, 'SCOUT', { color: '#88ccff' })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'scout_ahead', message: `${adv.name} sent a beast scouting.` })
      }
    }
  }

  _beastMasterCompanion(adv) {
    if (!adv.companionId) return null
    const m = (this._gameState.minions ?? []).find((x) => x.instanceId === adv.companionId)
    if (!m || m.aiState === 'dead' || m.resources?.hp <= 0 || m.faction !== 'adventurer') {
      adv.companionId = null
      return null
    }
    return m
  }

  // ── Barbarian ────────────────────────────────────────────────────────────

  _considerBarbarian(adv, now) {
    // Break Door — dormant until locked doors land. Until then, no trigger.
    // (Code path will live here when we wire up locked_door tile types.)

    // Rage Scaling VFX — when below 50% HP, kick on a faint red ground halo
    // so the player can read "this barbarian is enraged." The halo is
    // permanent (no auto-fade) — it sticks until HP recovers above 50%.
    const frac = adv.resources.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
    if (frac < 0.5 && !this._sustainedFx.get(adv.instanceId)?.rage) {
      // 99-second-ish duration so the auto-fade doesn't kick in during play;
      // we explicitly remove the halo when HP recovers below.
      this._createGroundHalo(adv, 'rage', 0xff3333, 99000, { width: 30, alpha: 0.28 })
    } else if (frac >= 0.5 && this._sustainedFx.get(adv.instanceId)?.rage) {
      this._endSustainedFx(adv.instanceId, 'rage')
    }
  }

  // ── Rogue ────────────────────────────────────────────────────────────────

  _considerRogue(adv, now) {
    // Lockpick — dormant until locked doors land.

    // Invisibility — fire when a hostile minion is within 6 tiles AND the
    // rogue isn't already invisible. Wider radius lets the rogue cloak
    // proactively to scout/sneak past enemies, not just at point-blank
    // combat range. Buffs sprite alpha + dodges target lock.
    const invisDef = ABILITY_DEFS.rogue_invisibility
    if (this._hostileMinionWithin(adv, 6) && !adv._invisibilityUntil) {
      const ready = AbilitySystem.canUse(adv, invisDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, invisDef, now)
        adv._invisibilityUntil = now + invisDef.durationMs
        adv._invisible = true
        // Apply alpha to the LPC sprite via AdventurerRenderer.
        const ar = this._scene.adventurerRenderer
        const s = ar?._sprites?.[adv.instanceId]
        if (s?.lpc?.image) AbilityVfx.alphaSet(s.lpc.image, 0.15)
        if (s?.body)        AbilityVfx.alphaSet(s.body, 0.15)
        if (s?.label)       AbilityVfx.alphaSet(s.label, 0.15)
        AbilityVfx.particleBurst(this._scene, adv.worldX, adv.worldY, { color: 0xaaaaaa, count: 12, durationMs: 600, speed: 80 })
        AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 24, 'VANISH', { color: '#cccccc' })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'invisibility', message: `${adv.name} vanished from sight.` })
      }
    }
  }

  _endInvisibility(adv) {
    adv._invisible = false
    const ar = this._scene.adventurerRenderer
    const s = ar?._sprites?.[adv.instanceId]
    if (s?.lpc?.image) AbilityVfx.alphaSet(s.lpc.image, 1.0)
    if (s?.body)        AbilityVfx.alphaSet(s.body, 1.0)
    if (s?.label)       AbilityVfx.alphaSet(s.label, 1.0)
    AbilityVfx.particleBurst(this._scene, adv.worldX, adv.worldY, { color: 0xaaaaaa, count: 8, durationMs: 400, speed: 60 })
  }

  // ── Twitch Streamer ──────────────────────────────────────────────────────

  _considerTwitch(adv, now) {
    // Viewers Choice — random RNG buff/debuff every ~8s on cooldown.
    const vcDef = ABILITY_DEFS.twitch_viewers_choice
    const ready = AbilitySystem.canUse(adv, vcDef, now)
    if (ready.ready) {
      AbilitySystem.markUsed(adv, vcDef, now)
      this._fireViewersChoice(adv, now)
    }

    // Chat Decides — every 15s, chat picks a behavior change. We pick from a
    // small list of "decisions" and apply the corresponding goal flip.
    const cdDef = ABILITY_DEFS.twitch_chat_decides
    const ready2 = AbilitySystem.canUse(adv, cdDef, now)
    if (ready2.ready) {
      AbilitySystem.markUsed(adv, cdDef, now)
      this._fireChatDecides(adv)
    }
  }

  _fireViewersChoice(adv, now) {
    const EFFECTS = [
      { id: 'heal',     apply: () => { const h = Math.floor((adv.resources.maxHp || 0) * 0.25); adv.resources.hp = Math.min(adv.resources.maxHp, adv.resources.hp + h); AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, `+${h} HEAL`, { color: '#88ff88' }) }, label: 'HEAL' },
      { id: 'atk_up',   apply: () => { adv._twitchAtkMul = 1.20; adv._twitchEffectUntil = now + 10000; AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'ATK +20%', { color: '#ff7777' }) }, label: 'ATK UP' },
      { id: 'atk_down', apply: () => { adv._twitchAtkMul = 0.80; adv._twitchEffectUntil = now + 10000; AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'ATK −20%', { color: '#888888' }) }, label: 'ATK DOWN' },
      { id: 'def_up',   apply: () => { adv._twitchDefBonus = 2;  adv._twitchEffectUntil = now + 10000; AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'DEF +2', { color: '#88aaff' }) }, label: 'DEF UP' },
      { id: 'def_down', apply: () => { adv._twitchDefBonus = -2; adv._twitchEffectUntil = now + 10000; AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'DEF −2', { color: '#cc8866' }) }, label: 'DEF DOWN' },
      { id: 'teleport', apply: () => { const rooms = this._gameState.dungeon?.rooms ?? []; if (rooms.length) { const r = rooms[Math.floor(Math.random() * rooms.length)]; adv.tileX = r.gridX + Math.floor(r.width/2); adv.tileY = r.gridY + Math.floor(r.height/2); adv.worldX = adv.tileX * Balance.TILE_SIZE + Balance.TILE_SIZE/2; adv.worldY = adv.tileY * Balance.TILE_SIZE + Balance.TILE_SIZE/2; AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'TELEPORTED', { color: '#cc99ff' }) } }, label: 'TELEPORT' },
      { id: 'poison',   apply: () => { adv._twitchPoisonUntil = now + 6000; adv._twitchEffectUntil = now + 6000; AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'POISONED', { color: '#88cc44' }) }, label: 'POISON' },
      { id: 'invis',    apply: () => { adv._invisibilityUntil = now + 10000; adv._invisible = true; const s = this._scene.adventurerRenderer?._sprites?.[adv.instanceId]; if (s?.lpc?.image) AbilityVfx.alphaSet(s.lpc.image, 0.15); AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'INVIS 10s', { color: '#cccccc' }) }, label: 'INVIS' },
    ]
    const pick = EFFECTS[Math.floor(Math.random() * EFFECTS.length)]
    // Slot animation — quick cycle of labels above the streamer's head.
    this._fireSlotAnimation(adv, EFFECTS, pick)
    pick.apply()
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'viewers_choice', message: `Chat rolled ${pick.label} for ${adv.name}.` })
  }

  _fireSlotAnimation(adv, effects, finalPick) {
    const x = adv.worldX, y = adv.worldY - 38
    const txt = this._scene.add.text(x, y, '???', {
      fontSize: '12px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3, backgroundColor: '#222266',
    }).setOrigin(0.5).setPadding(3, 2, 3, 2).setDepth(20)
    let cycles = 0
    const total = 8
    const interval = 70
    const followUpdate = () => {
      if (!txt.active) return
      // Self-destruct if the streamer leaves the active list — prevents
      // the slot text snapping to world (0, 0) (upper-left corner).
      if (!this._gameState.adventurers.active.includes(adv)) {
        this._scene.events.off('update', followUpdate)
        if (txt.active) txt.destroy()
        return
      }
      if (Number.isFinite(adv.worldX) && Number.isFinite(adv.worldY)) {
        txt.setPosition(adv.worldX, adv.worldY - 38)
      }
    }
    this._scene.events.on('update', followUpdate)
    const tick = () => {
      if (!txt.active) { this._scene.events.off('update', followUpdate); return }
      cycles++
      if (cycles >= total) {
        txt.setText(finalPick.label)
        this._scene.tweens.add({ targets: txt, alpha: 0, duration: 700, delay: 600, onComplete: () => { this._scene.events.off('update', followUpdate); txt.destroy() } })
        return
      }
      const opt = effects[Math.floor(Math.random() * effects.length)]
      txt.setText(opt.label)
      this._scene.time.delayedCall(interval, tick)
    }
    tick()
  }

  _fireChatDecides(adv) {
    const DECISIONS = [
      { id: 'investigate_trap', label: 'INVESTIGATE TRAP' },
      { id: 'fight_enemy',      label: 'FIGHT!' },
      { id: 'abandon_goal',     label: 'CHANGE PLANS' },
      { id: 'charge_boss',      label: 'CHARGE BOSS' },
    ]
    const pick = DECISIONS[Math.floor(Math.random() * DECISIONS.length)]
    if (pick.id === 'abandon_goal') {
      // Pick a random unvisited room as new goal.
      const rooms = this._gameState.dungeon?.rooms ?? []
      const target = rooms[Math.floor(Math.random() * rooms.length)]
      if (target) adv.goal = { type: 'EXPLORE_ROOM', roomId: target.instanceId }
    } else if (pick.id === 'charge_boss') {
      adv.goal = { type: 'SEEK_BOSS' }
    } else if (pick.id === 'fight_enemy') {
      // Push aggression: pick the nearest hostile minion as target.
      const target = this._nearestHostileMinion(adv, 6)
      if (target) adv.currentTargetId = target.instanceId
    }
    // Phase 5c — Chat Decides label removed; the goal change is observable
    // (the streamer changes direction) and the combat log shows the call.
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'chat_decides', message: `Chat told ${adv.name}: ${pick.label}` })
  }

  // ── Common helpers ───────────────────────────────────────────────────────

  _shortName(adv) { return adv?.name?.split(' ')[0] ?? adv?.classId ?? 'someone' }

  // ── VFX ───────────────────────────────────────────────────────────────────

  _fireAuraVfx(adv, durationMs) {
    this._createGroundHalo(adv, 'aura', 0xffe066, durationMs)
    AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 28, 'AURA', { color: '#ffe066' })
  }

  _fireTauntVfx(adv) {
    const x = adv.worldX, y = adv.worldY
    AbilityVfx.pulseRing(this._scene, x, y, { color: 0xff4444, fromR: 10, toR: 70, durationMs: 600, alpha: 0.95 })
    AbilityVfx.pulseRing(this._scene, x, y, { color: 0xffaa66, fromR: 8, toR: 50, durationMs: 800, alpha: 0.7 })
    AbilityVfx.floatingText(this._scene, x, y - 28, 'TAUNT!', { color: '#ff8866', fontSize: '14px' })
  }

  // ── Day-start hook ────────────────────────────────────────────────────────

  _onNewDay() {
    const defs = Object.values(ABILITY_DEFS)
    for (const adv of this._gameState.adventurers.active ?? []) {
      AbilitySystem.resetForNewDay(adv, defs)
    }
  }
}

// Phase 1b.3 — Beholder Anti-Magic Aura helper. Adventurers track tileX/tileY
// per AISystem tick; a room is "anti-magic" when its instanceId is in the
// daily set on gameState.
function _advInAntiMagicRoom(adv, gameState, antiMagicRoomIds) {
  if (!Array.isArray(antiMagicRoomIds) || antiMagicRoomIds.length === 0) return false
  const tx = adv?.tileX, ty = adv?.tileY
  if (typeof tx !== 'number' || typeof ty !== 'number') return false
  const rooms = gameState?.dungeon?.rooms ?? []
  for (const r of rooms) {
    if (!antiMagicRoomIds.includes(r.instanceId)) continue
    if (tx >= r.gridX && tx < r.gridX + r.width &&
        ty >= r.gridY && ty < r.gridY + r.height) return true
  }
  return false
}

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
import { createBubble }     from '../ui/Bubble.js'
import { Balance }          from '../config/balance.js'
import { PathfinderSystem } from './PathfinderSystem.js'
import { TILE }             from './DungeonGrid.js'
import { rgbFloatingText, rgbParticleBurst } from '../util/cheaterVfx.js'

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

  // ── Cheater ──────────────────────────────────────────────────────────
  // Teleport hack — every 15s, snap to a random non-boss room. 20% of
  // the time the cheat "desyncs" and they teleport to a random in-bounds
  // tile instead (sometimes a wall, sometimes a trap-heavy room) — a
  // window for the player to catch the no-clipping skid out of position.
  cheater_teleport:      { id: 'teleport_hack', cooldownMs: 15000,                    label: 'Teleport', glitchChance: 0.20 },
  // Aimhack — windowed instakill chance. Active for 2s out of every
  // 8s. During the window, a % chance per attack to set damage =
  // target HP (minions only; the boss and other advs are safe).
  cheater_aimhack:       { id: 'aimhack',       cooldownMs:  8000, durationMs: 2000, label: 'Aimhack', instakillChance: 0.15 },
  // Speed hack — random sprint bursts. Every ~12 s the modded client
  // toggles a movement multiplier to 2× for ~3 s. AISystem reads
  // _speedhackUntil and folds it into the step-distance calculation
  // alongside the regular flee / song / scout multipliers.
  cheater_speedhack:     { id: 'speedhack',     cooldownMs: 12000, durationMs: 3000, label: 'Speed Hack', spdMul: 2.0 },

  // ── Gladiator ──────────────────────────────────────────────────────────
  // Block — plant the Spartan hoplon for a brief DAMAGE-IMMUNE stance. While
  // braced he cannot swing (CombatSystem gates both the immunity and the
  // attack via _blockActiveUntil). Fires reactively when pressed.
  glad_block:      { id: 'block',      cooldownMs: 9000, durationMs: 1500, label: 'Block' },
  // Crowd Roar — kill-stacking ATK buff (passive). Increment + damage scaling
  // both live in CombatSystem (CROWD_ROAR_* consts); this entry is just the
  // registry label (no cooldown / per-day budget), like ranger_volley.
  glad_crowd_roar: { id: 'crowd_roar', label: 'Crowd Roar' },

  // ── Peasant ────────────────────────────────────────────────────────────
  // Strength in Numbers — passive ATK scale by nearby fellow peasants (the
  // damage math lives in CombatSystem, PEASANT_MOB_* consts). This entry is the
  // registry label; the consider-tick below fires the legibility pulse.
  peasant_strength: { id: 'strength_in_numbers', label: 'Strength in Numbers' },

  // ── Valkyrie ───────────────────────────────────────────────────────────
  // Winged Flight — passive: soars over traps (immunity lives in TrapSystem;
  // this entry is just the registry label).
  valkyrie_flight: { id: 'winged_flight', label: 'Winged Flight' },
  // Rally the Fallen — a 3s INTERRUPTIBLE channel (cast bar) that revives the
  // most-recently-fallen ally nearby at HALF HP. Once per valkyrie. Mirrors
  // White Mage's Raise. NO buff component.
  valkyrie_rally: { id: 'rally_the_fallen', usesPerDay: 1, castMs: 3000, reviveFrac: 0.5, rangeTiles: 6, label: 'Rally the Fallen' },

  // ── Gambler ────────────────────────────────────────────────────────────
  // Roll the Dice — per-swing d6 proc (resolved entirely in CombatSystem,
  // GAMBLER_DICE_CD). Registry label only.
  gambler_roll: { id: 'roll_the_dice', label: 'Roll the Dice' },
  // Double or Nothing — on death, a once-per-day 50/50: WIN → revive at half HP;
  // LOSE → the house pays the PLAYER out. Invoked from AISystem._kill via
  // attemptGamblerDoubleOrNothing.
  gambler_double_or_nothing: { id: 'double_or_nothing', usesPerDay: 1, label: 'Double or Nothing' },

  // ── Miner ──────────────────────────────────────────────────────────────
  // Tunnel — ONCE per day the miner picks a random dig tile, WALKS to it, digs
  // it open over a few seconds, drops in, and surfaces a couple seconds later
  // through a SECOND hole in a random different room. The hole pair stays open
  // as a two-way pathfinding shortcut the whole raid routes through (only when
  // it actually shortens a path); it collapses at night. A hole that surfaces
  // in the boss room starts the boss fight the instant anyone climbs out of it
  // — the miner included. A 5s startup gate stops an instant dig on spawn.
  miner_tunnel: { id: 'tunnel', usesPerDay: 1, label: 'Tunnel' },
}

// Tunnel sequence timing (the "few seconds" from the spec).
const TUNNEL_DIG_MS        = 2600   // time spent attacking the tile to open it
const TUNNEL_UNDERGROUND_MS = 1800  // time spent below before surfacing elsewhere
const TUNNEL_APPROACH_TIMEOUT_MS = 22000  // safety: abort if he can't reach the dig tile

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
    // Miner can't Tunnel for 5 s after entering — stops an instant boss-skip the
    // moment they spawn, and gives the player a beat to see them start the dig.
    if (adv.classId === 'miner') {
      const now = this._scene?.time?.now ?? 0
      adv._tunnelGateUntil = now + 5000
      // Clear any stale sequence state from a previous life/day.
      adv._tunnelPhase = null
      adv._tunnelDig = null
      adv._underground = false
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
    // Gladiator — drop the Block brace + reset the Crowd Roar stack count so a
    // re-entering/raised Gladiator starts fresh (CombatSystem reads both).
    adventurer._blockActiveUntil      = null
    adventurer._crowdRoarStacks       = 0
    adventurer._mobActive             = false
    // Valkyrie — a dying/fleeing valkyrie's Rally channel is interrupted (fizzles),
    // and the cast bar is torn down. _cancelRallyCast clears the channel fields.
    this._cancelRallyCast(adventurer, true)
    // Miner — a dying/fleeing miner mid-dig drops the tunnel (the day's use is
    // already spent). Clears _underground so the renderer doesn't keep him hidden.
    if (adventurer._tunnelPhase) this._abortTunnel(adventurer)
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
      if (silenced) {
        // Throttle a "SILENCED" pulse to ~once per 2 s per adv so the
        // player sees feedback when their cast was suppressed without
        // spamming a floater every frame.
        adv._antiMagicNextPulseAt ??= 0
        if (now >= adv._antiMagicNextPulseAt) {
          adv._antiMagicNextPulseAt = now + 2000
          EventBus.emit('BEHOLDER_ANTI_MAGIC_SILENCED', { advId: adv.instanceId })
        }
      } else {
        adv._antiMagicNextPulseAt = 0
      }
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
          case 'cheater':         this._considerCheater(adv, now); break
          case 'gladiator':       this._considerGladiator(adv, now); break
          case 'peasant':         this._considerPeasant(adv, now); break
          case 'valkyrie':        this._considerValkyrie(adv, now); break
          case 'miner':           this._considerMiner(adv, now); break
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
    // Gladiator Block — brace window over; clear the flag so he can swing again.
    if (adv._blockActiveUntil && now >= adv._blockActiveUntil) {
      adv._blockActiveUntil = null
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'block' })
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
    // Tear down any lingering Valkyrie cast bars.
    if (this._castBars) {
      for (const cb of this._castBars.values()) { if (cb.bg?.active) cb.bg.destroy(); if (cb.fill?.active) cb.fill.destroy() }
      this._castBars.clear()
    }
    // Miner Tunnel holes collapse at night/day-end — drop the portal state so the
    // pathfinder stops routing through them (TunnelPortalRenderer clears the art
    // on the same NIGHT_PHASE_STARTED / DAY_PHASE_ENDED events).
    if (this._gameState?.dungeon) this._gameState.dungeon.portals = []
    // Surface any miner caught mid-tunnel so he isn't left hidden/frozen.
    for (const adv of this._gameState.adventurers?.active ?? []) {
      if (adv.classId !== 'miner') continue
      if (adv._tunnelPhase || adv._underground) {
        adv._tunnelPhase = null; adv._tunnelDig = null
        adv._underground = false; adv._castingUntil = 0
      }
    }
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

  // ── Gladiator ───────────────────────────────────────────────────────────
  // Crowd Roar is a passive (kill-stacking ATK) handled in CombatSystem. Here
  // we only drive Block: a reactive damage-immune brace.

  _considerGladiator(adv, now) {
    // Block — brace the shield when pressed: swarmed by 2+ hostiles in melee,
    // OR wounded (<55% HP) with a hostile adjacent. Damage-immune for the
    // window; he can't swing while braced (CombatSystem enforces both).
    if (adv._blockActiveUntil && now < adv._blockActiveUntil) return
    const blockDef = ABILITY_DEFS.glad_block
    const swarmed  = this._hostileMinionCountWithin(adv, 1.5) >= 2
    const frac     = adv.resources?.maxHp > 0 ? adv.resources.hp / adv.resources.maxHp : 1
    const wounded  = frac < 0.55 && this._hostileMinionWithin(adv, 1.2)
    // Boss fight — there are no hostile MINIONS to read off, so Block would
    // never fire from the swarmed/wounded checks above. Trigger reactively off
    // being engaged with the boss while wounded (≤60% HP). The immunity + the
    // no-attack rule for the brace window are enforced in BossSystem
    // (_advBlocking gates every boss→adv damage site + the adv→boss pool).
    const inBossFight = adv.goal?.type === 'AT_BOSS' || adv.aiState === 'fighting'
    const bossPressed = inBossFight && frac < 0.60
    if (!swarmed && !wounded && !bossPressed) return
    const ready = AbilitySystem.canUse(adv, blockDef, now)
    if (!ready.ready) return
    AbilitySystem.markUsed(adv, blockDef, now)
    adv._blockActiveUntil = now + blockDef.durationMs
    this._fireBlockVfx(adv, blockDef.durationMs)
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'block', message: `${adv.name} braced behind the shield!` })
  }

  _hostileMinionCountWithin(adv, rangeTiles) {
    let n = 0
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
      if (m.faction === 'adventurer') continue
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d <= rangeTiles + 0.01) n++
    }
    return n
  }

  _fireBlockVfx(adv, durationMs) {
    // A golden hoplon dome that pops up, holds the brace window, then fades.
    AbilityVfx.domeShield(this._scene, adv.worldX, (adv.worldY ?? 0) - 6, { color: 0xffd66b, radius: 30, holdMs: durationMs })
    AbilityVfx.floatingText(this._scene, adv.worldX, (adv.worldY ?? 0) - 30, 'BLOCK', { color: '#ffe08a', fontSize: '13px' })
  }

  // ── Peasant ─────────────────────────────────────────────────────────────
  // Strength in Numbers is a passive ATK/DEF scale (CombatSystem reads the
  // nearby-peasant count). Here we make the mob LEGIBLE:
  //   • a one-shot rally pulse + "EMBOLDENED" floater the instant a peasant
  //     joins a mob (≥2 other peasants within 4 tiles), re-arming on dispersal;
  //   • a SUSTAINED dusty-brown ground aura once 3+ are clustered, whose size +
  //     opacity scale with the local count (denser dust = bigger mob);
  //   • periodic angry-shout emotes (raised fist / "!") while clustered.

  _considerPeasant(adv, now) {
    let allies = 0
    for (const a of this._gameState.adventurers.active) {
      if (a === adv || a.classId !== 'peasant') continue
      if (a.aiState === 'dead' || a.resources?.hp <= 0) continue
      const d = Math.hypot((a.tileX ?? 0) - (adv.tileX ?? 0), (a.tileY ?? 0) - (adv.tileY ?? 0))
      if (d <= 4.01) allies++
    }
    const inMob     = allies >= 2          // self + 2 others = a 3-strong mob
    const clustered = allies + 1 >= 3

    // Join pulse — the moment the mob forms.
    if (inMob && !adv._mobActive) {
      adv._mobActive = true
      AbilityVfx.pulseRing(this._scene, adv.worldX, adv.worldY, { color: 0xe8a24a, fromR: 6, toR: 26, durationMs: 450, alpha: 0.8 })
      AbilityVfx.floatingText(this._scene, adv.worldX, (adv.worldY ?? 0) - 26, 'EMBOLDENED', { color: '#ffcf6b', fontSize: '11px' })
      EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'strength_in_numbers', message: `${adv.name} is emboldened by the mob (+${allies}).` })
    } else if (!inMob && adv._mobActive) {
      adv._mobActive = false
    }

    // Sustained dusty aura + angry shouts while clustered; tear down otherwise.
    if (clustered) {
      // allies caps at +32% (4 peasants) on the buff side — mirror that ramp
      // here so the dust visually maxes at the same point the buff does.
      const intensity = Math.min(1, allies / 4)
      this._ensurePeasantDust(adv, intensity, now)
      if (now >= (adv._peasantShoutAt ?? 0)) {
        adv._peasantShoutAt = now + 2600 + Math.random() * 2800
        const mark = Math.random() < 0.5 ? '✊' : '!'
        AbilityVfx.floatingText(this._scene, adv.worldX, (adv.worldY ?? 0) - 30, mark, { color: '#e8b06a', fontSize: '15px' })
      }
    } else {
      if (this._sustainedFx.get(adv.instanceId)?.peasant_dust) this._endSustainedFx(adv.instanceId, 'peasant_dust')
      adv._peasantShoutAt = 0
    }
  }

  // A persistent dusty-brown ground patch under a clustered peasant. Created
  // once (slot 'peasant_dust'), then re-positioned + re-scaled every tick from
  // _considerPeasant so it follows the peasant and swells with the mob. Layered
  // brown dust puffs (throttled) add motion so it reads as kicked-up dirt, not
  // a flat decal. Torn down by _endSustainedFx on dispersal / death / night.
  _ensurePeasantDust(adv, intensity, now) {
    const Y_OFF = 16
    let map = this._sustainedFx.get(adv.instanceId)
    let obj = map?.peasant_dust
    if (!obj) {
      const e = this._scene.add.ellipse(adv.worldX, (adv.worldY ?? 0) + Y_OFF, 32, 13, 0x8a6a3a, 0.16).setDepth(5)
      this._setSustainedFx(adv.instanceId, 'peasant_dust', { gfx: e })
      obj = this._sustainedFx.get(adv.instanceId).peasant_dust
    }
    const e = obj.gfx
    if (!e?.active) return
    if (Number.isFinite(adv.worldX) && Number.isFinite(adv.worldY)) e.setPosition(adv.worldX, adv.worldY + Y_OFF)
    const sc = 0.85 + intensity * 0.9
    e.setScale(sc, sc)
    e.setAlpha(0.12 + intensity * 0.16)
    // Occasional kicked-up dust puff for motion.
    if (now >= (adv._peasantDustAt ?? 0)) {
      adv._peasantDustAt = now + 620 + Math.random() * 500
      AbilityVfx.particleBurst(this._scene, adv.worldX, (adv.worldY ?? 0) + Y_OFF, {
        count: 3 + Math.round(intensity * 3), color: 0x9a7a48, speed: 40 + intensity * 30, durationMs: 520, depth: 5,
      })
    }
  }

  // ── Valkyrie ────────────────────────────────────────────────────────────
  // Winged Flight is a passive (trap immunity in TrapSystem). Here we drive Rally
  // the Fallen: she WALKS to a tile ADJACENT to the most-recently-fallen ally
  // (never onto the corpse), then runs a 3s INTERRUPTIBLE channel (cast bar) that
  // revives them at HALF HP, once per valkyrie. Interrupt = she dies/flees/enters
  // combat mid-cast, or the target is otherwise revived/culled.

  _considerValkyrie(adv, now) {
    // Channeling? progress the cast bar / complete / cancel.
    if (adv._rallyChannelUntil) { this._tickRallyCast(adv, now); return }
    // Walking to a fallen ally? keep steering her there until she's adjacent.
    if (adv._rallyApproachId != null) { this._tickRallyApproach(adv, now); return }
    // Idle wrt Rally — only consider it while travelling (not mid-combat/flee).
    if (adv.aiState !== 'walking') return
    const def = ABILITY_DEFS.valkyrie_rally
    if (!AbilitySystem.canUse(adv, def, now).ready) return
    const target = this._findFallenToRevive(adv, def.rangeTiles)
    if (!target) return
    if (this._adjacentToTile(adv, target.tileX, target.tileY)) {
      this._beginRallyCast(adv, target, now)   // already beside the body
      return
    }
    const slot = this._approachTileFor(adv, target)
    if (!slot) return                          // no reachable adjacent tile
    adv._rallyApproachId   = target.instanceId
    adv._rallyApproachTile = slot
    adv.goal = { type: 'RALLY_APPROACH', tileX: slot.x, tileY: slot.y }
    adv.path = null; adv.pathIndex = 0; adv.pathTarget = null   // force a repath to the body
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'rally_the_fallen', message: `${adv.name} moves to rally a fallen ally.` })
  }

  // Walk-to-corpse phase: steer her to the adjacent tile, start the cast on arrival.
  _tickRallyApproach(adv, now) {
    const grave = this._gameState.adventurers?.graveyard ?? []
    const target = grave.find(g => g.instanceId === adv._rallyApproachId)
    // Bail if the target's gone (revived/culled) or she got pulled into combat/flee.
    if (!target || adv.aiState !== 'walking') { this._endRallyApproach(adv); return }
    if (this._adjacentToTile(adv, target.tileX, target.tileY)) {
      this._endRallyApproach(adv)
      this._beginRallyCast(adv, target, now)
      return
    }
    // Re-assert the approach goal if something else overrode it (combat scuffle, etc.).
    if (adv.goal?.type !== 'RALLY_APPROACH' && adv._rallyApproachTile) {
      adv.goal = { type: 'RALLY_APPROACH', tileX: adv._rallyApproachTile.x, tileY: adv._rallyApproachTile.y }
    }
  }

  _endRallyApproach(adv) {
    const wasApproaching = adv.goal?.type === 'RALLY_APPROACH'
    adv._rallyApproachId = null
    adv._rallyApproachTile = null
    if (wasApproaching && adv.aiState !== 'dead') {
      adv.path = null; adv.pathIndex = 0; adv.pathTarget = null
      this._scene.aiSystem?.pickInitialGoal?.(adv)   // restore a normal goal
    }
  }

  _beginRallyCast(adv, target, now) {
    const def = ABILITY_DEFS.valkyrie_rally
    AbilitySystem.markUsed(adv, def, now)            // spend the once/day use only when the cast starts
    adv._rallyChannelUntil = now + def.castMs
    adv._rallyTargetId     = target.instanceId
    adv._castingUntil      = adv._rallyChannelUntil   // AISystem holds her still while this is set
    this._startRallyCastBar(adv, def.castMs)
    AbilityVfx.pulseRing?.(this._scene, adv.worldX, adv.worldY, { color: 0xffe9a8, fromR: 6, toR: 30, durationMs: 400, alpha: 0.7 })
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'rally_the_fallen', message: `${adv.name} kneels beside the fallen and channels Rally.` })
  }

  // Adjacent (incl. diagonal) to a tile, but NOT standing on it.
  _adjacentToTile(adv, tx, ty) {
    const d = Math.hypot((adv.tileX ?? 0) - tx, (adv.tileY ?? 0) - ty)
    return d > 0.5 && d <= 1.6
  }

  // The walkable tile adjacent to the corpse that's closest to the valkyrie.
  _approachTileFor(adv, corpse) {
    const slots = this._walkableAdjacentTiles(corpse.tileX, corpse.tileY, this._scene.dungeonGrid)
    let best = null, bestD = Infinity
    for (const s of slots) {
      const d = Math.hypot(s.x - (adv.tileX ?? 0), s.y - (adv.tileY ?? 0))
      if (d < bestD) { bestD = d; best = s }
    }
    return best
  }

  // Most-recently-fallen ally that died THIS DAY within rangeTiles of the valkyrie
  // (graveyard entries are full adv clones with their death tile). Newest first.
  _findFallenToRevive(valk, rangeTiles) {
    const grave = this._gameState.adventurers?.graveyard ?? []
    const today = this._gameState.meta?.dayNumber ?? 0
    for (let i = grave.length - 1; i >= 0; i--) {
      const g = grave[i]
      if (g.diedOnDay !== today || g.classId === undefined) continue
      const d = Math.hypot((g.tileX ?? 0) - (valk.tileX ?? 0), (g.tileY ?? 0) - (valk.tileY ?? 0))
      if (d <= rangeTiles + 0.01) return g
    }
    return null
  }

  _tickRallyCast(adv, now) {
    const grave = this._gameState.adventurers?.graveyard ?? []
    const tIdx = grave.findIndex(g => g.instanceId === adv._rallyTargetId)
    if (tIdx < 0) { this._cancelRallyCast(adv, true); return }   // target gone → interrupt
    adv._castingUntil = adv._rallyChannelUntil
    this._updateRallyCastBar(adv, now)
    if (now < adv._rallyChannelUntil) return
    // ── Channel complete — raise the fallen ally at HALF HP ──
    const def = ABILITY_DEFS.valkyrie_rally
    const dead = grave.splice(tIdx, 1)[0]
    const TS = Balance.TILE_SIZE
    dead.resources.hp    = Math.max(1, Math.floor((dead.resources.maxHp ?? 0) * (def.reviveFrac ?? 0.5)))
    dead.aiState         = 'walking'
    dead.path = null; dead.pathIndex = 0; dead.pathTarget = null
    dead.currentTargetId = null; dead.lastAttackAt = 0
    dead._lastHitBy = null; dead._lastHitType = null
    dead.cooldowns = {}; dead.usesLeftToday = {}
    dead.worldX = (dead.tileX ?? 0) * TS + TS / 2
    dead.worldY = (dead.tileY ?? 0) * TS + TS / 2
    this._scene.bossSystem?._fightStates?.delete(dead.instanceId)
    this._gameState.adventurers.active.push(dead)
    this._scene.aiSystem?.pickInitialGoal?.(dead)
    AbilityVfx.resurrectBeam?.(this._scene, dead.worldX, dead.worldY, { color: 0xffe9a8, durationMs: 750 })
    AbilityVfx.floatingText(this._scene, dead.worldX, (dead.worldY ?? 0) - 30, 'RALLIED', { color: '#ffe9a8', fontSize: '14px' })
    this._endRallyCastBar(adv)
    adv._rallyChannelUntil = null; adv._rallyTargetId = null; adv._castingUntil = null
    EventBus.emit('ADVENTURER_RESURRECTED', { adventurer: dead })
    EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: dead })   // re-init abilities + renderer sprite
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'rally_the_fallen', message: `${adv.name} rallied ${this._shortName(dead)} back to their feet at half HP.` })
  }

  _cancelRallyCast(adv, silentTarget = false) {
    this._endRallyCastBar(adv)
    if (adv._rallyChannelUntil && !silentTarget) {
      AbilityVfx.floatingText?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 30, 'INTERRUPTED', { color: '#cc8a8a', fontSize: '12px' })
      EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'rally_the_fallen', message: `${adv.name}'s Rally was interrupted.` })
    }
    adv._rallyChannelUntil = null; adv._rallyTargetId = null; adv._castingUntil = null
    adv._rallyApproachId = null; adv._rallyApproachTile = null
  }

  // A small fill-bar above the valkyrie's head while she channels.
  _startRallyCastBar(adv, durationMs) {
    this._castBars ??= new Map()
    this._endRallyCastBar(adv)
    const w = 30, h = 4, y = (adv.worldY ?? 0) - 34
    const bg   = this._scene.add.rectangle(adv.worldX, y, w, h, 0x1a140c, 0.7).setDepth(20)
    const fill = this._scene.add.rectangle(adv.worldX - w / 2, y, 1, h, 0xffe9a8, 0.95).setOrigin(0, 0.5).setDepth(21)
    this._castBars.set(adv.instanceId, { bg, fill, w, start: this._scene.time.now, durationMs })
  }

  _updateRallyCastBar(adv, now) {
    const cb = this._castBars?.get(adv.instanceId); if (!cb) return
    const y = (adv.worldY ?? 0) - 34
    const p = Math.min(1, (now - cb.start) / cb.durationMs)
    cb.bg.setPosition(adv.worldX, y)
    cb.fill.setPosition(adv.worldX - cb.w / 2, y)
    cb.fill.width = Math.max(1, cb.w * p)
  }

  _endRallyCastBar(adv) {
    const cb = this._castBars?.get(adv.instanceId); if (!cb) return
    if (cb.bg?.active) cb.bg.destroy()
    if (cb.fill?.active) cb.fill.destroy()
    this._castBars.delete(adv.instanceId)
  }

  // ── Gambler ───────────────────────────────────────────────────────────
  // Double or Nothing — invoked from AISystem._kill BEFORE death processing.
  // A once-per-day 50/50 on the gambler's own death: WIN → revive at 50% HP
  // (returns true → death skipped); LOSE → the house pays the PLAYER out in gold
  // and the gambler still dies (returns false). The flip is spent either way.
  attemptGamblerDoubleOrNothing(falling) {
    if (!falling || falling.classId !== 'gambler' || falling.aiState === 'dead') return false
    const now = this._scene.time.now
    const def = ABILITY_DEFS.gambler_double_or_nothing
    const ready = AbilitySystem.canUse(falling, def, now)
    if (!ready.ready) return false
    AbilitySystem.markUsed(falling, def, now)
    const win = Math.random() < 0.5
    AbilityVfx.coinFlip?.(this._scene, falling.worldX, (falling.worldY ?? 0) - 34, win)
    if (win) {
      // Revive at 50% HP + full transient-state reset (cloned from the cleric/
      // valkyrie revive path) so the gambler walks again instead of freezing.
      falling.resources.hp   = Math.max(1, Math.floor((falling.resources.maxHp ?? 0) * 0.50))
      falling.aiState        = 'walking'
      falling.path           = null
      falling.pathIndex      = 0
      falling.pathTarget     = null
      falling.currentTargetId = null
      falling.lastAttackAt   = 0
      falling._lastHitBy     = null
      falling._lastHitType   = null
      this._scene.bossSystem?._fightStates?.delete(falling.instanceId)
      this._scene.aiSystem?.pickInitialGoal?.(falling)
      AbilityVfx.floatingText(this._scene, falling.worldX, (falling.worldY ?? 0) - 52, 'DOUBLE!', { color: '#ffe066', fontSize: '15px' })
      EventBus.emit('ABILITY_TRIGGERED', { adventurer: falling, abilityId: 'double_or_nothing', message: `${falling.name} won the toss — back in the game!` })
      return true
    }
    // Lose — the house pays out to the dungeon owner (the player), scaled to the
    // gambler's level (the dungeon/boss level the adv was scaled to).
    const lv = this._gameState.boss?.level ?? falling.level ?? 1
    const payout = (Balance.GOLD_PER_KILL ?? 10) * 3 * lv
    this._gameState.player ??= {}
    this._gameState.player.gold = (this._gameState.player.gold ?? 0) + payout
    EventBus.emit('RESOURCES_AWARDED', { gold: payout, source: 'gambler_double_or_nothing' })
    AbilityVfx.floatingText(this._scene, falling.worldX, (falling.worldY ?? 0) - 52, `NOTHING · +${payout}g`, { color: '#ffd34d', fontSize: '13px' })
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: falling, abilityId: 'double_or_nothing', message: `${falling.name} lost the toss — the house pays out ${payout}g.` })
    return false
  }

  // ── Miner ─────────────────────────────────────────────────────────────
  // Tunnel — ONCE per day, while travelling, dig a hole at his feet linked to a
  // random room. The hole is stored in gameState.dungeon.portals and added as a
  // 2-way edge in PathfinderSystem.findPath (AISystem passes the portals in), so
  // the whole raid routes THROUGH it to reach rooms faster. TunnelPortalRenderer
  // draws the holes; they + the portal state clear at night.

  _considerMiner(adv, now) {
    // A tunnel sequence in progress drives itself through its phases.
    if (adv._tunnelPhase) { this._tickTunnel(adv, now); return }
    if (adv.aiState !== 'walking') return            // only kick off mid-travel, not in a fight
    if ((adv._tunnelGateUntil ?? 0) > now) return    // 5 s startup gate
    const def = ABILITY_DEFS.miner_tunnel
    if (!AbilitySystem.canUse(adv, def, now).ready) return
    this._beginTunnel(adv, now, def)
  }

  // PHASE 0 — pick a random dig tile (NOT the boss room: that's reserved for the
  // surprise exit) and send the miner walking to it. Spends the once/day use up
  // front so an interruption can't let him re-roll a fresh tunnel the same day.
  _beginTunnel(miner, now, def) {
    const grid = this._scene.dungeonGrid
    if (!grid) return
    const dig = this._pickTunnelTile(grid, { excludeBossRoom: true })
    if (!dig) return
    AbilitySystem.markUsed(miner, def, now)
    miner._tunnelPhase   = 'approach'
    miner._tunnelDig     = { x: dig.x, y: dig.y }
    miner._tunnelDeadline = now + TUNNEL_APPROACH_TIMEOUT_MS
    miner.goal      = { type: 'TUNNEL_DIG', tileX: dig.x, tileY: dig.y }
    miner.path      = null
    miner.pathIndex = 0
    miner.pathTarget = null
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: miner, abilityId: 'tunnel', message: `${miner.name} spotted a soft seam and headed off to dig.` })
  }

  // The per-tick state machine: approach → dig → underground → surface.
  _tickTunnel(miner, now) {
    // Abandon the dig if combat catches him before he's committed to digging.
    if (miner._tunnelPhase === 'approach' &&
        (miner.aiState === 'fighting' || miner.aiState === 'fleeing' || now > (miner._tunnelDeadline ?? Infinity))) {
      this._abortTunnel(miner)
      return
    }
    switch (miner._tunnelPhase) {
      case 'approach': {
        const dig = miner._tunnelDig
        const d = Math.hypot((miner.tileX ?? 0) - dig.x, (miner.tileY ?? 0) - dig.y)
        if (d > 0.75) return                       // still walking — AISystem steers him
        // Arrived — plant him on the tile and start digging.
        miner._tunnelPhase = 'digging'
        miner._tunnelDigUntil = now + TUNNEL_DIG_MS
        miner._castingUntil   = now + TUNNEL_DIG_MS   // AISystem freezes him while he digs
        miner._tunnelNextFx   = 0
        this._fireDigVfx(miner, now)
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: miner, abilityId: 'tunnel', message: `${miner.name} started hacking a hole in the floor.` })
        return
      }
      case 'digging': {
        // Re-spit dirt/rocks every ~400ms for the whole dig so it reads as work.
        if (now >= (miner._tunnelNextFx ?? 0)) { miner._tunnelNextFx = now + 420; this._fireDigVfx(miner, now) }
        if (now < (miner._tunnelDigUntil ?? 0)) { miner._castingUntil = miner._tunnelDigUntil; return }
        // Hole A is open — draw it, then drop in.
        const a = miner._tunnelDig
        EventBus.emit('MINER_DIG_HOLE', { x: a.x, y: a.y })
        AbilityVfx.particleBurst(this._scene, miner.worldX, miner.worldY, { count: 14, color: 0x6b4f2a, speed: 120, durationMs: 520, depth: 9 })
        miner._tunnelPhase    = 'underground'
        miner._underground    = true                 // AdventurerRenderer hides him
        miner._tunnelEmergeAt = now + TUNNEL_UNDERGROUND_MS
        miner._castingUntil   = now + TUNNEL_UNDERGROUND_MS + 200
        return
      }
      case 'underground': {
        if (now < (miner._tunnelEmergeAt ?? 0)) return
        this._surfaceTunnel(miner, now)
        return
      }
    }
  }

  // PHASE final — open hole B in a random DIFFERENT room (boss room eligible),
  // teleport the miner there, link the pair as a permanent (for-the-day)
  // pathfinding edge, and climb him out. Surfacing in the boss room starts the
  // fight immediately (the miner himself counts).
  _surfaceTunnel(miner, now) {
    const grid = this._scene.dungeonGrid
    const a = miner._tunnelDig
    const digRoom = grid?.getRoomAtTile?.(a.x, a.y)
    const exit = this._pickTunnelTile(grid, { excludeRoomId: digRoom?.instanceId ?? null })
            ?? this._pickTunnelTile(grid, {})   // fall back to ANY room if only one exists
    if (!exit) { this._abortTunnel(miner); return }

    // Link the hole pair for the pathfinder (PathfinderSystem reads ax/ay/bx/by).
    const portal = {
      id: `tunnel_${miner.instanceId}_${this._gameState.meta?.dayNumber ?? 0}`,
      ax: a.x, ay: a.y, bx: exit.x, by: exit.y,
    }
    this._gameState.dungeon.portals ??= []
    this._gameState.dungeon.portals.push(portal)

    // Surface the miner at hole B.
    const TS = Balance.TILE_SIZE
    miner.tileX = exit.x; miner.tileY = exit.y
    miner.worldX = exit.x * TS + TS / 2
    miner.worldY = exit.y * TS + TS / 2
    miner._underground   = false
    miner._tunnelPhase   = null
    miner._castingUntil   = 0
    miner.path = null; miner.pathIndex = 0; miner.pathTarget = null

    // Draw hole B + climb-out dirt spray.
    EventBus.emit('MINER_DIG_HOLE', { x: exit.x, y: exit.y })
    AbilityVfx.particleBurst(this._scene, miner.worldX, miner.worldY, { count: 18, color: 0x7a5a30, speed: 150, durationMs: 620, depth: 9 })
    AbilityVfx.floatingText(this._scene, miner.worldX, (miner.worldY ?? 0) - 26, 'TUNNEL', { color: '#caa15a', fontSize: '12px' })
    EventBus.emit('MINER_TUNNEL_DUG', { id: portal.id, ax: portal.ax, ay: portal.ay, bx: portal.bx, by: portal.by })

    // Boss room? He's burst in through the floor — kick off the fight.
    const exitRoom = grid?.getRoomAtTile?.(exit.x, exit.y)
    if (exitRoom?.definitionId === 'boss_chamber') {
      miner.goal = { type: 'AT_BOSS' }
      miner.aiState = 'fighting'
      EventBus.emit('MINER_SURFACED_IN_BOSS_ROOM', { adventurerId: miner.instanceId })
      EventBus.emit('ABILITY_TRIGGERED', { adventurer: miner, abilityId: 'tunnel', message: `${miner.name} burst up through the throne-room floor!` })
    } else {
      this._scene.aiSystem?.pickInitialGoal?.(miner)
      EventBus.emit('ABILITY_TRIGGERED', { adventurer: miner, abilityId: 'tunnel', message: `${miner.name} clawed out of a fresh hole across the dungeon.` })
    }
  }

  // Dirt + rock eruption at the miner's tile while he digs (reuses quake/rubble
  // language — a crater rim, an outward dirt burst, and a small shockwave).
  _fireDigVfx(miner, _now) {
    const x = miner.worldX, y = miner.worldY
    AbilityVfx.particleBurst(this._scene, x, y, { count: 9, color: 0x6b4f2a, speed: 90, durationMs: 460, depth: 9 })
    AbilityVfx.shockwave(this._scene, x, y, { color: 0x8a6a3a, radius: 22, durationMs: 360 })
  }

  // Tear down an in-flight tunnel (death / flee / can't reach the tile). The
  // use is already spent for the day; just clear the transient state.
  _abortTunnel(miner) {
    const wasUnderground = miner._underground
    miner._tunnelPhase = null
    miner._tunnelDig = null
    miner._underground = false
    miner._castingUntil = 0
    if (miner.goal?.type === 'TUNNEL_DIG') {
      miner.path = null; miner.pathIndex = 0; miner.pathTarget = null
      // If he was already underground when interrupted, surface him in place so
      // he isn't stranded invisible.
      this._scene.aiSystem?.pickInitialGoal?.(miner)
    }
    if (wasUnderground) EventBus.emit('ABILITY_TRIGGERED', { adventurer: miner, abilityId: 'tunnel', message: `${miner.name} scrambled back out of his tunnel.` })
  }

  // Pick a random walkable interior tile from a random active room, honoring an
  // optional room exclusion / boss-room exclusion.
  _pickTunnelTile(grid, { excludeRoomId = null, excludeBossRoom = false } = {}) {
    if (!grid) return null
    const rooms = (this._gameState.dungeon?.rooms ?? []).filter(r =>
      r.isActive !== false && r.gridX != null &&
      (excludeRoomId == null || r.instanceId !== excludeRoomId) &&
      (!excludeBossRoom || r.definitionId !== 'boss_chamber'))
    if (!rooms.length) return null
    for (let i = rooms.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rooms[i], rooms[j]] = [rooms[j], rooms[i]] }
    for (const r of rooms) {
      const tiles = this._walkableTilesInRoom(r, grid)
      if (tiles.length) return tiles[Math.floor(Math.random() * tiles.length)]
    }
    return null
  }

  _walkableTilesInRoom(room, grid) {
    const out = []
    for (let y = room.gridY + 1; y < room.gridY + room.height - 1; y++) {
      for (let x = room.gridX + 1; x < room.gridX + room.width - 1; x++) {
        const t = grid.getTileType?.(x, y)
        if (t != null && PathfinderSystem.isWalkable(t) && t !== TILE.DOOR) out.push({ x, y })
      }
    }
    return out
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
    // Party gating REMOVED 2026-05-27 — clerics now heal any wounded adv
    // in range, regardless of party. Previously the heal was gated to
    // `cleric.partyId === adv.partyId`, which silently disabled
    // healing during events that spawn party-less waves (Saboteur,
    // Speedrunner lone, etc.) and broke any cross-party support play.
    // Range + HP-fraction gates still apply.
    let best = null, bestFrac = Balance.CLERIC_HEAL_TARGET_THRESHOLD ?? 0.7
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      if (adv === cleric) continue
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
      // Party gating REMOVED 2026-05-27 — see _findHealTarget for the
      // same rationale. Clerics now resurrect any falling adv they can
      // reach, regardless of party. Ability still gated by per-day
      // use count (1) so each cleric brings exactly one revive.
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
        // Mark the minion as this Beast Master's tame target so the rest
        // of the party leaves it alone while the tame is attempted —
        // AISystem._findEngageableMinion skips tame-protected minions.
        // Refreshed every tick the minion stays in range; the stamp
        // lapses on its own once the BM moves off, dies, or succeeds.
        target._tameTargetedBy = adv.instanceId
        target._tameTargetedAt = now
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
    // Boss-down handling — once the boss falls in a fight, AISystem.
    // _onBossFightResolved sweeps every alive adv into FLEE. Streamers
    // need the same lock applied to BOTH chat abilities: Chat Decides
    // can flip the goal back to SEEK_BOSS / EXPLORE_ROOM (undoing the
    // flee), and Viewers Choice keeps the slot animation popping over
    // the streamer's head while they should be sprinting for the exit.
    // Mirrors the same `boss.hp > 0` gate AISystem uses on chat_poll
    // (Phase 10b). HP refreshes to maxHp at the START of the next
    // fight (see BossSystem._init / pre-fight setup), so this window
    // is exactly "boss is currently down" — once the next fight kicks
    // off the streamer's chat rolls re-enable.
    //
    // We also push the FLEE goal here in case the streamer wasn't
    // alive when `_onBossFightResolved` ran (late-spawn waves arriving
    // after the boss has been downed the same day). Skipped while
    // the streamer is mid-combat or already fleeing.
    if ((this._gameState.boss?.hp ?? 1) <= 0) {
      const isCombatLocked = adv.aiState === 'fighting' || adv.aiState === 'fleeing' ||
                             adv.aiState === 'fled' || adv.aiState === 'leaving' ||
                             adv.aiState === 'dead'
      if (!isCombatLocked && adv.goal?.type !== 'FLEE') {
        adv.goal    = { type: 'FLEE', reason: 'boss_defeated' }
        adv.aiState = 'fleeing'
        adv.path    = null
      }
      return
    }

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
      { id: 'teleport', apply: () => { const rooms = (this._gameState.dungeon?.rooms ?? []).filter(r => r.definitionId !== 'boss_chamber'); if (rooms.length) { const r = rooms[Math.floor(Math.random() * rooms.length)]; adv.tileX = r.gridX + Math.floor(r.width/2); adv.tileY = r.gridY + Math.floor(r.height/2); adv.worldX = adv.tileX * Balance.TILE_SIZE + Balance.TILE_SIZE/2; adv.worldY = adv.tileY * Balance.TILE_SIZE + Balance.TILE_SIZE/2; AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'TELEPORTED', { color: '#cc99ff' }) } }, label: 'TELEPORT' },
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
    // Streamer slot animation — same pixel-art bubble shape as
    // ambient chat and death floats, but with the twitch-purple
    // border + a "CHAT ROLLED" eyebrow above the rolling label.
    // Cycles 8 random labels at 70ms each, then settles on the final
    // pick. No auto lifeMs — the cycle tick orchestrates its own
    // settle + fade-out via container.fadeOut().
    const bubble = createBubble(this._scene, {
      x:       adv.worldX,
      y:       adv.worldY - 38,
      text:    '???',
      kind:    'streamer',
      eyebrow: 'Chat Rolled',
      depth:   20,
    })

    let cycles = 0
    const total = 8
    const interval = 70

    const followUpdate = () => {
      if (!bubble.active) return
      // Self-destruct if the streamer leaves the active list —
      // prevents the bubble snapping to world (0, 0).
      if (!this._gameState.adventurers.active.includes(adv)) {
        this._scene.events.off('update', followUpdate)
        if (bubble.active) bubble.killNow()
        return
      }
      if (Number.isFinite(adv.worldX) && Number.isFinite(adv.worldY)) {
        bubble.setPosition(adv.worldX, adv.worldY - 38)
      }
    }
    this._scene.events.on('update', followUpdate)

    const tick = () => {
      if (!bubble.active) { this._scene.events.off('update', followUpdate); return }
      cycles++
      if (cycles >= total) {
        bubble.setBubbleText(finalPick.label)
        // Linger briefly so the player can read the final pick, then
        // graceful fade-out via the factory.
        this._scene.time.delayedCall(600, () => {
          if (!bubble.active) return
          this._scene.events.off('update', followUpdate)
          bubble.fadeOut(500)
        })
        return
      }
      const opt = effects[Math.floor(Math.random() * effects.length)]
      bubble.setBubbleText(opt.label)
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

  // ── Cheater ──────────────────────────────────────────────────────────
  // Two abilities on auto-fire:
  //   • Teleport — pick a random non-boss / non-entry-hall room, snap
  //     there. 20% chance the teleport "desyncs" to a random in-bounds
  //     tile (counterbalance — sometimes lands in a wall or trap room).
  //   • Aimhack — opens a 2 s instakill window every 8 s. CombatSystem
  //     reads adv._aimhackUntil to gate the per-attack instakill roll.
  // Banned cheaters skip both — once "reported" enough times the modded
  // client is locked out and they have to flee like a regular adv.
  _considerCheater(adv, now) {
    // Reported & Banned — once the report counter (incremented by
    // CombatSystem on each incoming hit from a dungeon-faction unit)
    // crosses the threshold, the modded client is "locked out". Flip
    // _banned on, push a FLEE goal with a dedicated reason, and emit
    // the BANNED floater. After this point the no-clip pathfinder and
    // aimhack hooks all gate themselves off via the same flag.
    //
    // PATCH 0.0.0 event — anti-cheat is OFF for the day. Skip the ban
    // check entirely so cheaters can take unlimited hits without losing
    // their cheats. Their only exit is death or a normal flee.
    const patchZeroActive = !!(this._gameState._eventFlags?.patchZeroActive)
    const reportThreshold = Balance.CHEATER_REPORT_BAN_THRESHOLD ?? 4
    if (!patchZeroActive && !adv._banned && (adv._reportCount ?? 0) >= reportThreshold) {
      adv._banned = true
      adv.goal = { type: 'FLEE', reason: 'cheater_banned', context: null }
      adv.aiState = 'fleeing'
      adv.path = null
      rgbFloatingText(this._scene, adv.worldX ?? 0, (adv.worldY ?? 0) - 36,
        'BANNED', { fontSize: '14px' })
      EventBus.emit('CHEATER_BANNED', { adventurer: adv })
    }
    if (adv._banned) return

    // Teleport — base 15 s cooldown, halved to 8 s during PATCH 0.0.0.
    // Shallow-cloned def so AbilitySystem.canUse / markUsed read the
    // event-buffed cooldown without mutating the baseline ABILITY_DEFS.
    const tpDef = patchZeroActive
      ? { ...ABILITY_DEFS.cheater_teleport, cooldownMs: Balance.PATCH_ZERO_TELEPORT_CD_MS ?? 8000 }
      : ABILITY_DEFS.cheater_teleport
    const tpReady = AbilitySystem.canUse(adv, tpDef, now)
    if (tpReady.ready) {
      AbilitySystem.markUsed(adv, tpDef, now)
      this._fireCheaterTeleport(adv, tpDef)
    }

    // Aimhack (window 2 s every 8 s). Just opens the window; CombatSystem
    // does the per-attack instakill roll while adv._aimhackUntil > now.
    const ahDef = ABILITY_DEFS.cheater_aimhack
    const ahReady = AbilitySystem.canUse(adv, ahDef, now)
    if (ahReady.ready) {
      AbilitySystem.markUsed(adv, ahDef, now)
      adv._aimhackUntil = now + ahDef.durationMs
      rgbFloatingText(this._scene, adv.worldX, adv.worldY - 28, 'AIMBOT')
      EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'aimhack', message: `${this._shortName(adv)} loaded an aimbot.` })
    }

    // Speed hack — 3 s sprint at 2× movement every 12 s. AISystem reads
    // _speedhackUntil during the per-tick step calculation and folds in
    // the multiplier, so the burst stacks cleanly on top of flee / scout
    // / song-of-speed buffs (a fleeing banned cheater still runs fast
    // through the regular flee multiplier; this just adds chaos when
    // they're not on the run). PATCH 0.0.0 halves the cooldown (12→6s).
    const shDef = patchZeroActive
      ? { ...ABILITY_DEFS.cheater_speedhack, cooldownMs: Balance.PATCH_ZERO_SPEEDHACK_CD_MS ?? 6000 }
      : ABILITY_DEFS.cheater_speedhack
    const shReady = AbilitySystem.canUse(adv, shDef, now)
    if (shReady.ready) {
      AbilitySystem.markUsed(adv, shDef, now)
      adv._speedhackUntil = now + shDef.durationMs
      rgbFloatingText(this._scene, adv.worldX, adv.worldY - 32, 'SPEED HACK')
      rgbParticleBurst(this._scene, adv.worldX, adv.worldY,
        { count: 10, durationMs: 420, speed: 90 })
      EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'speedhack', message: `${this._shortName(adv)} kicked in a speed hack.` })
    }
  }

  // Pick a destination room, snap the adv there, and emit the event so
  // the renderer can fire glitch VFX at both ends. Glitch chance picks a
  // raw in-bounds tile instead of a room — sometimes that's a wall (with
  // no-clip movement they walk out next tick) or a deathtrap room.
  _fireCheaterTeleport(adv, def) {
    const dungeon = this._gameState?.dungeon
    const rooms = dungeon?.rooms ?? []
    const grid = this._scene?.dungeonGrid
    if (!grid || rooms.length === 0) return

    const fromX = adv.tileX, fromY = adv.tileY
    let destTile = null
    const glitch = Math.random() < (def?.glitchChance ?? 0)
    if (glitch) {
      // Desync — random in-bounds tile, no filtering. Lands wherever.
      const w = grid.getWidth?.()  ?? 50
      const h = grid.getHeight?.() ?? 50
      destTile = { x: Math.floor(Math.random() * w), y: Math.floor(Math.random() * h) }
    } else {
      // Pick a non-boss, non-entry-hall room. Boss room is explicitly
      // off-limits per the design (the cheater can't skip the gauntlet
      // straight to the throne).
      const candidates = rooms.filter(r =>
        r.isActive !== false &&
        r.definitionId !== 'boss_chamber' &&
        r.definitionId !== 'entry_hall'
      )
      if (candidates.length === 0) return
      const room = candidates[Math.floor(Math.random() * candidates.length)]
      // Interior tile pick, similar to the wander picker — skips walls
      // so the cheater actually lands on a floor.
      const WT = Balance.WALL_THICKNESS
      destTile = {
        x: room.gridX + WT + Math.floor(Math.random() * Math.max(1, room.width  - 2 * WT)),
        y: room.gridY + WT + Math.floor(Math.random() * Math.max(1, room.height - 2 * WT)),
      }
    }
    if (!destTile) return
    const TS = Balance.TILE_SIZE
    adv.tileX  = destTile.x
    adv.tileY  = destTile.y
    adv.worldX = destTile.x * TS + TS / 2
    adv.worldY = destTile.y * TS + TS / 2
    adv.path = null
    adv.pathIndex = 0
    adv.pathTarget = null
    rgbParticleBurst(this._scene, fromX * TS + TS / 2, fromY * TS + TS / 2,
      { count: 14, durationMs: 500, speed: 110 })
    rgbParticleBurst(this._scene, adv.worldX, adv.worldY,
      { count: 14, durationMs: 500, speed: 110 })
    rgbFloatingText(this._scene, adv.worldX, adv.worldY - 24,
      glitch ? 'DESYNC' : 'TELEPORT')
    EventBus.emit('CHEATER_TELEPORTED', {
      adventurer: adv,
      from: { x: fromX, y: fromY },
      to:   { x: destTile.x, y: destTile.y },
      glitched: glitch,
    })
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

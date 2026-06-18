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
//   _auraActiveUntil      (Knight Bulwark — directional shield-wall stance window)
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
  // Bulwark — a directional shield-wall (replaces the flat Protective Aura): while
  // up, allies sheltered BEHIND/BESIDE the Knight (toward the threat) take reduced
  // damage. Positional → rewards front-lining. (CombatSystem._applyBulwark reads
  // the stance window `_auraActiveUntil` + the reduction/range consts there.)
  knight_bulwark: { id: 'bulwark', cooldownMs: 20000, durationMs: 6000, label: 'Bulwark', bulwarkRange: 2.5 },
  knight_taunt: { id: 'taunt',           cooldownMs: 12000, durationMs: 4000, label: 'Taunt' },
  // Bard — Crescendo: ONE escalating battle hymn (replaces the old flat Inspire +
  // Song of Speed auras). Builds a stack every few seconds while combat is near,
  // buffing nearby party atk+spd per stack; a solid hit or CC shatters it to 0.
  bard_crescendo: { id: 'crescendo', label: 'Crescendo', auraRangeTiles: 3 },
  // Bard's Encore is a passive — fires on death, no cooldown.
  // Monk
  // Monk — Riposte (a guard STANCE: while up, a chance to DODGE an incoming hit
  // and instantly counter-strike the attacker) + Stunning Palm (a periodic melee
  // strike that stuns one minion). Inner Peace (passive self-regen) was cut.
  // Internal stance-window field stays `_focusActiveUntil` (read in CombatSystem).
  monk_riposte:      { id: 'riposte', cooldownMs: 14000, durationMs: 5000, label: 'Riposte', dodgeChance: 0.3, counterFrac: 0.8 },
  monk_palm:         { id: 'stunning_palm', cooldownMs: 9000, rangeTiles: 1.5, stunMs: 2000, label: 'Stunning Palm' },
  // Cleric
  cleric_heal:           { id: 'cleric_heal',     cooldownMs: 10000,                   label: 'Heal' },
  // Channeled like the Valkyrie's Rally (2026-06-09): the cleric walks to a
  // tile ADJACENT to a fallen ally, then runs a 3s interruptible cast bar that
  // raises them at 30% HP. Once per cleric. (Shares the channel machinery.)
  cleric_resurrection:   { id: 'resurrection',   usesPerDay: 1, castMs: 3000, reviveFrac: 0.30, rangeTiles: 6, label: 'Resurrection' }, // 1 per day per cleric
  // Mage
  mage_arcane_burst:     { id: 'arcane_burst',   cooldownMs: 20000,                    label: 'Arcane Burst', aoeRangeTiles: 1 },
  // Mage Arcane Mastery is a flat spell-power passive (CombatSystem); adv._element is cosmetic VFX only.
  // Necromancer
  necro_summon:          { id: 'summon_undead',  cooldownMs: 35000,                    label: 'Summon Undead', summonCount: 2 },
  necro_bone_armor:      { id: 'bone_armor',     cooldownMs: 30000, durationMs: 8000,  label: 'Bone Armor', perUndeadAtk: 1, perUndeadDef: 1 },
  // Ranger
  // Piercing Shot — every 5th arrow becomes a LINE shot that pierces every minion
  // in a row from the ranger through the target (proc in CombatSystem). Rewards
  // the player for NOT lining minions up. (Replaced the every-5th-shot Volley.)
  ranger_piercing:       { id: 'piercing_shot',  label: 'Piercing Shot' },
  ranger_trap_expert:    { id: 'trap_expert',    usesPerDayPerLevel: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, label: 'Trap Expert', failChance: 0.20 },
  // Beast Master
  bm_tame_beast:         { id: 'tame_beast',     cooldownMs: 8000,                     label: 'Tame Beast', successRate: 0.5, rangeTiles: 1.5 },
  // Sic 'Em — command the tamed companion to pounce a nearby hostile (a maul for
  // a multiple of the beast's attack). Pack Tactics (flanking bonus when BM +
  // beast share a target) is a passive in CombatSystem. (Replaced Scout Ahead.)
  bm_sic_em:             { id: 'sic_em',         cooldownMs: 7000, rangeTiles: 5, mult: 1.6, label: "Sic 'Em" },
  // Barbarian
  // Reckless Charge — barrel in a straight line into the densest nearby minion
  // cluster, knocking back + staggering everything in the path (no path damage),
  // ending with a full swing on the target. Telegraphed wind-up = counterplay.
  barb_charge:           { id: 'reckless_charge', cooldownMs: 12000, label: 'Reckless Charge', scanTiles: 6, clusterMin: 2 },
  // Barbarian Unstoppable + Rage Scaling are passives (no cooldown).
  // Rogue
  rogue_invisibility:    { id: 'invisibility',   cooldownMs: 30000, durationMs: 5000,  label: 'Invisibility' },
  rogue_lockpick:        { id: 'lockpick',       usesPerDayPerLevel: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, label: 'Lockpick', failChance: 0.20 },

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
  // registry label (no cooldown / per-day budget), like ranger_piercing.
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

// classId → its ABILITY_DEFS registry keys, derived from the key prefix. Used
// by the VFX Lab to list + force-fire a class's abilities for review.
const _ABILITY_PREFIX_CLASS = {
  knight: 'knight', bard: 'bard', monk: 'monk', cleric: 'cleric', mage: 'mage',
  necro: 'necromancer', ranger: 'ranger', bm: 'beast_master', barb: 'barbarian',
  rogue: 'rogue', cheater: 'cheater', glad: 'gladiator', peasant: 'peasant',
  valkyrie: 'valkyrie', gambler: 'gambler', miner: 'miner',
}
export const CLASS_ABILITIES = {}
for (const key of Object.keys(ABILITY_DEFS)) {
  const cls = _ABILITY_PREFIX_CLASS[key.split('_')[0]]
  if (cls) (CLASS_ABILITIES[cls] ??= []).push(key)
}

// Per-ability cosmetics for the shared channeled-revive machinery (Valkyrie
// Rally + Cleric Resurrection). Keyed by the ability's `id`. Keeps colour/text
// flavour out of the gameplay defs above.
const REVIVE_COSMETIC = {
  rally_the_fallen: { color: 0xffe9a8, hex: '#ffe9a8', done: 'RALLIED', verb: 'rallied', fx: 'valkyrieRaiseFx',
    move: 'moves to rally a fallen ally', kneel: 'kneels beside the fallen and channels Rally',
    interrupt: 'Rally was interrupted' },
  resurrection:     { color: 0xfff4a8, hex: '#fff4a8', done: 'RESURRECTED', verb: 'revived', fx: 'resurrectionFx',
    move: 'moves to reach a fallen ally', kneel: 'kneels and channels a Resurrection',
    interrupt: 'Resurrection was interrupted' },
}

// Bard Crescendo tuning. The anthem swells one stack at a time while combat is
// near, capping at CRESCENDO_MAX; each stack adds atk+spd to nearby party. A
// solid hit (≥ SOLID_HIT_FRAC of max HP) or CC shatters it to 0 + a brief silence.
const CRESCENDO_MAX        = 4
const CRESCENDO_ATK_PER    = 0.05   // +5% atk per stack → +20% at full
const CRESCENDO_SPD_PER    = 0.04   // +4% spd per stack → +16% at full
const CRESCENDO_STACK_MS   = 3000   // time to gain one stack while in combat
const CRESCENDO_DECAY_MS   = 2000   // time to lose one stack out of combat
const CRESCENDO_SILENCE_MS = 2000   // can't rebuild for this long after a shatter
const CRESCENDO_HIT_FRAC   = 0.10   // a single hit ≥ this fraction of max HP shatters the song
const CRESCENDO_REFRESH_MS = 1200   // how long the buff-active window is kept alive between ticks

// Barbarian Reckless Charge timing/tuning.
const CHARGE_WINDUP_MS   = 400    // telegraphed crouch before the dash — the counterplay window
const CHARGE_STAGGER_MS  = 1000   // how long path minions are stunned (skip their AI turn)
const CHARGE_PATH_RADIUS = 0.9    // tile distance from the charge line that counts as "in the path"
const CHARGE_IMPACT_RADIUS = 1.5  // minions this close to the target cluster centre are caught too
const CHARGE_MS_PER_TILE = 70     // dash pace (~3× a normal walk); total dash time = dist × this, clamped
const CHARGE_DASH_MIN_MS = 200
const CHARGE_DASH_MAX_MS = 700

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
    // Bard Crescendo — a solid hit to the bard shatters the song.
    EventBus.on('COMBAT_HIT', this._onCombatHit, this)
  }

  destroy() {
    EventBus.off('NEW_DAY_STARTED', this._onNewDay, this)
    EventBus.off('ADVENTURER_ENTERED_DUNGEON', this._onAdvEntered, this)
    EventBus.off('ADVENTURER_DIED', this._onDied, this)
    EventBus.off('ADVENTURER_FLED', this._onFled, this)
    EventBus.off('NIGHT_PHASE_STARTED', this._clearAllSustained, this)
    EventBus.off('DAY_PHASE_ENDED', this._clearAllSustained, this)
    EventBus.off('COMBAT_HIT', this._onCombatHit, this)
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

    // Cancel any active buffs.
    adventurer._auraActiveUntil       = null
    adventurer._tauntActiveUntil      = null
    adventurer._inspireActiveUntil    = null
    adventurer._songSpeedActiveUntil  = null
    // Bard Crescendo — reset the swell so a re-entering/raised bard starts silent.
    adventurer._crescendoStacks       = 0
    adventurer._crescendoAtkMul       = 1
    adventurer._crescendoSpdMul       = 1
    adventurer._crescendoSilencedUntil = 0
    adventurer._focusActiveUntil      = null
    adventurer._boneArmorUntil        = null
    adventurer._invisibilityUntil     = null
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
    // Barbarian — a dying/fleeing barbarian mid-charge drops the dash + frees the
    // AISystem freeze so he isn't left stuck mid-lerp.
    if (adventurer._chargePhase) this._endCharge(adventurer, this._scene?.time?.now ?? 0)
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
        AbilityVfx.crescendoFx?.(this._scene, adv.worldX, adv.worldY, { stacks: 1 })
        AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 24, `+${Math.round(restored)}`, { color: '#ff99cc', fontSize: '12px' })
        EventBus.emit('ALLY_HEALED', { sourceId: bard.instanceId, targetId: adv.instanceId, amount: restored })
      }
    }
    if (healedCount > 0) {
      AbilityVfx.encoreFx?.(this._scene, bard.worldX, bard.worldY)
      AbilityVfx.floatingText(this._scene, bard.worldX, bard.worldY - 28, 'ENCORE', { color: '#ff99cc', fontSize: '14px' })
    }
    EventBus.emit('ABILITY_TRIGGERED', {
      adventurer: bard,
      abilityId: 'encore',
      message: `${bard.name}'s final note healed ${healedCount} ally${healedCount === 1 ? '' : 'ies'}.`,
    })
  }

  // ── Dev / VFX Lab ─────────────────────────────────────────────────────────
  // Force-fire ONE class ability so its VFX can be reviewed in isolation. The
  // caller (VfxLab) sets up a fake arena (a hostile minion + a wounded ally + a
  // fallen ally) near `adv` so the ability's combat conditions pass. We ready
  // ONLY the target ability (parking the class's others on cooldown) so the
  // class's _consider tick fires just that one, with its real inline VFX.
  devFireAbility(adv, key, now = this._scene.time.now) {
    const def = ABILITY_DEFS[key]
    if (!def || !adv) return false
    const classId = adv.classId
    adv.cooldowns ??= {}; adv.usesLeftToday ??= {}
    for (const k of (CLASS_ABILITIES[classId] ?? [])) {
      const d = ABILITY_DEFS[k]; if (!d?.id) continue
      if (k === key) {
        delete adv.cooldowns[d.id]
        if (d.usesPerDay != null || d.usesPerDayPerLevel) adv.usesLeftToday[d.id] = 99
      } else if (d.cooldownMs) {
        adv.cooldowns[d.id] = now + 9_999_999   // park the others so only the target fires
      }
    }
    // Clear common one-shot block flags so the target re-fires each press.
    adv._arcaneBurstQueued = false
    adv._summonGateUntil = 0
    adv._invisibilityUntil = 0
    adv._boneArmorUntil = 0
    adv._focusActiveUntil = 0
    adv.aiState = 'fighting'
    const suffix = String(classId).split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
    const fn = this['_consider' + suffix]
    if (typeof fn === 'function') { try { fn.call(this, adv, now) } catch (e) { /* dev-only */ } return true }
    return false
  }

  // VFX LAB — deterministic per-ability VFX demo. Fires the ability's REAL bespoke
  // effect(s) directly on the lab entity + a resolved target, bypassing cooldowns /
  // conditions so every ability button shows its full visual on EVERY press —
  // including the combat-proc effects (mage elements, ranger pierce, monk riposte,
  // gladiator roar) that the _consider tick can't trigger. Visual only, no mechanics.
  devDemoVfx(adv, key) {
    const V = AbilityVfx, sc = this._scene
    if (!adv || !sc) return false
    const id = ABILITY_DEFS[key]?.id ?? key
    const ax = adv.worldX ?? 0, ay = adv.worldY ?? 0
    const foe = this._nearestHostileMinion(adv, 8)
    const tx = foe?.worldX ?? (ax + 72), ty = foe?.worldY ?? ay
    const dead = (this._gameState.adventurers?.active ?? []).find(a => a !== adv && (a.aiState === 'dead' || (a.resources?.hp ?? 1) <= 0))
    const fxp = dead?.worldX ?? (ax + 56), fyp = dead?.worldY ?? ay
    const dir = tx >= ax ? 1 : -1
    const D = (ms, f) => sc.time?.delayedCall?.(ms, f)
    switch (id) {
      case 'bulwark':       V.bulwarkWallFx?.(sc, ax, ay, { dir }); break
      case 'taunt':         V.tauntFx?.(sc, ax, ay); break
      case 'crescendo':     V.crescendoFx?.(sc, ax, ay, { stacks: 4 }); break
      case 'riposte':       V.focusStanceFx?.(sc, ax, ay, { dir }); D(280, () => V.riposteFx?.(sc, ax, ay, { dir })); break
      case 'stunning_palm': V.stunningPalmFx?.(sc, tx, ty); break
      case 'cleric_heal':   V.healLightFx?.(sc, foe ? ax : fxp, foe ? ay : fyp); break
      case 'resurrection':  V.resurrectionFx?.(sc, fxp, fyp); break
      case 'arcane_burst': {
        // cycle the element each press so all four are testable from one button
        const ELS = ['fire', 'ice', 'lightning', 'wind']
        adv._demoElIdx = ((adv._demoElIdx ?? -1) + 1) % 4
        adv._element = ELS[adv._demoElIdx]
        V.arcaneChargeFx?.(sc, ax, ay, { color: this._elementColor(adv._element) })
        D(380, () => {
          const el = adv._element
          if (el === 'fire') V.emberBurnFx?.(sc, tx, ty)
          else if (el === 'ice') V.frostChillFx?.(sc, tx, ty)
          else if (el === 'lightning') V.arcBoltFx?.(sc, ax, ay - 8, tx, ty - 8)
          else V.gustFx?.(sc, tx, ty, { dir })
          V.arcaneBurstFx?.(sc, tx, ty, { color: this._elementColor(el) })
          V.floatingText?.(sc, tx, ty - 30, el.toUpperCase(), { color: '#cc99ff', fontSize: '10px' })
        })
        break
      }
      case 'summon_undead': V.necroSummonFx?.(sc, ax, ay); break
      case 'bone_armor':    V.boneArmorFx?.(sc, ax, ay); break
      case 'piercing_shot': V.piercingArrowFx?.(sc, ax, ay - 8, ax + dir * 150, ay - 8); break
      case 'trap_expert':   V.disarmFx?.(sc, tx, ty, { fail: Math.random() < 0.4 }); break
      case 'tame_beast':    V.tameFx?.(sc, tx, ty); break
      case 'sic_em':        V.pounceFx?.(sc, ax, ay, tx, ty); break
      case 'reckless_charge': V.chargeWindupFx?.(sc, ax, ay, { dir }); D(420, () => { V.recklessChargeFx?.(sc, ax, ay, tx, ty); V.staggerHitFx?.(sc, tx, ty) }); break
      case 'invisibility':  V.vanishSmokeFx?.(sc, ax, ay); D(900, () => V.vanishSmokeFx?.(sc, ax, ay, { reveal: true })); break
      case 'block':         V.gladiatorBlockFx?.(sc, ax, ay); break
      case 'crowd_roar':    V.crowdRoarFx?.(sc, ax, ay, { stacks: 4 }); break
      case 'strength_in_numbers': V.mobFervorFx?.(sc, ax, ay, { count: 4 }); break
      case 'winged_flight': V.wingedFlightFx?.(sc, ax, ay); break
      case 'rally_the_fallen': V.valkyrieRaiseFx?.(sc, fxp, fyp); break
      case 'tunnel':        V.digBurstFx?.(sc, ax, ay, { depth: 13 }); break
      case 'roll_the_dice': V.diceRoll?.(sc, ax, ay - 32, 1 + Math.floor(Math.random() * 6)); break
      case 'double_or_nothing': V.coinFlip?.(sc, ax, ay - 24, Math.random() < 0.5); break
      case 'lockpick':
        V.floatingText?.(sc, ax, ay - 24, '(needs a locked door)', { color: '#999999', fontSize: '10px' }); break
      default:
        // Cheater hacks + anything unmapped: fall back to the real consider tick.
        return this.devFireAbility(adv, key)
    }
    return true
  }

  // Silence Ward coverage — the Set of room instanceIds where casting is
  // suppressed: each active Silence Ward plus every room directly door-
  // connected to it (excluding boss chamber / entry halls, which are never
  // silenced so the boss fight + escape routes aren't affected). Returns null
  // when no ward is built. Recomputed each tick — cheap (few wards).
  _silenceWardCoverage() {
    const rooms = this._gameState.dungeon?.rooms ?? []
    const wards = rooms.filter(r => r.definitionId === 'silence_ward' && r.isActive !== false)
    if (wards.length === 0) return null
    const grid = this._scene?.dungeonGrid
    const ids = new Set()
    for (const w of wards) {
      ids.add(w.instanceId)
      const neighbors = grid?.getNeighborRooms?.(w.instanceId) ?? []
      for (const n of neighbors) {
        if (n.isActive === false) continue
        if (n.definitionId === 'boss_chamber' || n.definitionId === 'entry_hall') continue
        ids.add(n.instanceId)
      }
    }
    return ids
  }

  update(_delta) {
    const now = this._scene.time.now
    const antiMagicRoomIds = this._gameState._antiMagicRoomIds ?? null
    // Silence Ward (room 2026-06-17) — recompute the set of room instanceIds
    // where casting is suppressed (each active ward + its door-connected
    // neighbours) once per tick, and stamp it on gameState so CombatSystem
    // (Dead Zone +damage) and the renderer can read the same set.
    const wardRoomIds = this._silenceWardCoverage()
    this._gameState._silenceWardRoomIds = wardRoomIds ? [...wardRoomIds] : null
    for (const adv of this._gameState.adventurers.active) {
      if (adv.aiState === 'dead' || adv.resources?.hp <= 0) continue
      this._tickActiveBuffs(adv, now)
      // Phase 1b.3 — Beholder Anti-Magic Aura. While the active boss is the
      // beholder, advs standing in a marked room can't fire ANY class
      // abilities. Existing buff timers still tick out via _tickActiveBuffs.
      const silenced = (
        antiMagicRoomIds && antiMagicRoomIds.length > 0 &&
        _advInAntiMagicRoom(adv, this._gameState, antiMagicRoomIds)
      ) || (
        // Silence Ward room — same suppression, sourced from a player-built
        // room aura rather than the beholder boss.
        wardRoomIds && wardRoomIds.size > 0 &&
        _advInRoomSet(adv, this._gameState, wardRoomIds)
      ) || (
        // Beholder TYRANT'S GAZE — per-adv silence ray (day active). Blocks all
        // class-ability casts for the window; buff timers still tick out.
        (adv._silencedUntil ?? 0) > now
      )
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
          case 'cheater':         this._considerCheater(adv, now); break
          case 'gladiator':       this._considerGladiator(adv, now); break
          case 'peasant':         this._considerPeasant(adv, now); break
          case 'valkyrie':        this._considerValkyrie(adv, now); break
          case 'miner':           this._considerMiner(adv, now); break
        }
      }
    }

    // ── The Undying Court ──────────────────────────────────────────────────
    // Tick revived adventurer MINIONS through the SAME class-ability brain. The
    // targeting helpers are side-aware (allies = your minions, foes = the living
    // adventurers). Combat PASSIVES already fire via the _raisedClassId bridge in
    // CombatSystem; this drives the ACTIVE abilities.
    for (const m of this._gameState.minions ?? []) {
      if (m._revivedAdv !== true) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      m.cooldowns ??= {}
      m.usesLeftToday ??= {}
      this._tickActiveBuffs(m, now)
      switch (m._raisedClassId) {
        case 'knight':      this._considerKnight(m, now);      break
        case 'bard':        this._considerBard(m, now);        break
        case 'monk':        this._considerMonk(m, now);        break
        case 'cleric':      this._considerCleric(m, now);      break
        case 'mage':        this._considerMage(m, now);        break
        case 'necromancer': this._considerNecromancer(m, now); break
        case 'gladiator':   this._considerGladiator(m, now);   break
        case 'peasant':     this._considerPeasant(m, now);     break
        case 'rogue':       this._considerRogue(m, now);       break
        // ranger Volley / barbarian Rage / gambler dice are COMBAT passives
        // (fire in CombatSystem via the bridge) — no active tick needed.
        // valkyrie Rally + cleric Resurrection + gambler Double-or-Nothing need
        // a minion-death hook — wired in the follow-up (3c) pass.
      }
    }
  }

  // ── Buff lifecycle ─────────────────────────────────────────────────────────

  _tickActiveBuffs(adv, now) {
    if (adv._auraActiveUntil && now >= adv._auraActiveUntil) {
      adv._auraActiveUntil = null
      this._endSustainedFx(adv.instanceId, 'aura')
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'bulwark' })
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
    // Surface any miner caught mid-tunnel so he isn't left hidden/frozen, and
    // fizzle any valkyrie caught mid-Rally so her movement-freeze (_castingUntil)
    // + approach/channel state don't carry over past the phase flip.
    for (const adv of this._gameState.adventurers?.active ?? []) {
      if (adv.classId === 'miner' && (adv._tunnelPhase || adv._underground)) {
        adv._tunnelPhase = null; adv._tunnelDig = null
        adv._underground = false; adv._castingUntil = 0
      }
      // Barbarian caught mid-charge at the phase flip — drop the dash state.
      if (adv._chargePhase) this._endCharge(adv, this._scene?.time?.now ?? 0)
      // Any channeled-revive caster (Valkyrie Rally OR Cleric Resurrection)
      // caught mid-approach/channel at the phase flip — tear it down.
      if (adv._rallyChannelUntil || adv._rallyApproachId != null) {
        this._cancelRallyCast(adv, true)
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
    // Bulwark — raise the shield-wall when a nearby ally is in danger OR a hostile
    // is close (so the wall is up before the blows land). While active, allies
    // sheltered behind/beside the Knight (toward the threat) take reduced damage —
    // see CombatSystem._applyBulwark. `_auraActiveUntil` is the stance window.
    const bulwarkDef = ABILITY_DEFS.knight_bulwark
    // Defensive timing: also raise the wall pre-emptively when a STUDIED threat
    // is in range (the kingdom has learned this type's blow — brace early).
    if (this._allyInDangerNearby(adv, bulwarkDef.bulwarkRange) || this._hostileMinionWithin(adv, 4) || this._studiedThreatNear(adv, bulwarkDef.bulwarkRange)) {
      const ready = AbilitySystem.canUse(adv, bulwarkDef, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, bulwarkDef, now)
        adv._auraActiveUntil = now + bulwarkDef.durationMs
        this._fireAuraVfx(adv, bulwarkDef.durationMs)
        EventBus.emit('ABILITY_TRIGGERED', {
          adventurer: adv,
          abilityId: 'bulwark',
          message: `${adv.name} raised a Bulwark.`,
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
    if (knight._revivedAdv) {
      for (const m of this._gameState.minions ?? []) {
        if (m === knight || m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        if (m.aiState !== 'engaging') continue
        const frac = m.resources.maxHp > 0 ? m.resources.hp / m.resources.maxHp : 1
        if (frac > 0.5) continue
        const d = Math.hypot(m.tileX - knight.tileX, m.tileY - knight.tileY)
        if (d <= rangeTiles + 0.01) return true
      }
      return false
    }
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
    if (knight._revivedAdv) {
      // Revived knight minion — protect nearby DUNGEON minions (no party).
      for (const m of this._gameState.minions ?? []) {
        if (m === knight || m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        const d = Math.hypot(m.tileX - knight.tileX, m.tileY - knight.tileY)
        if (d > rangeTiles + 0.01) continue
        const frac = m.resources.maxHp > 0 ? m.resources.hp / m.resources.maxHp : 1
        if (frac < 0.7) return true
      }
      return false
    }
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
    // Defensive timing: pre-block a STUDIED dangerous minion that's right on top
    // of him (about to swing) even when not swarmed/wounded — the kingdom knows
    // this type's hit is coming. Block has a cooldown, so it isn't permanent.
    const studiedThreat = this._studiedThreatNear(adv, 1.3)
    if (!swarmed && !wounded && !bossPressed && !studiedThreat) return
    const ready = AbilitySystem.canUse(adv, blockDef, now)
    if (!ready.ready) return
    AbilitySystem.markUsed(adv, blockDef, now)
    adv._blockActiveUntil = now + blockDef.durationMs
    this._fireBlockVfx(adv, blockDef.durationMs)
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'block', message: `${adv.name} braced behind the shield!` })
  }

  // Same-room + on-floor (not a doorway) gate for an adventurer ability
  // perceiving / targeting a hostile across the grid. Mirrors CombatSystem's
  // swing gate so class abilities only engage foes in the SAME room — never
  // across a wall, and never one mid-transit through a doorway. Degrades to
  // permissive when there's no real grid (headless makeScene proxy stub).
  _realGrid() {
    const g = this._scene?.dungeonGrid
    if (!g || typeof g.getTileType !== 'function' || typeof g.getRoomAtTile !== 'function') return null
    // Reject the headless proxy's chainable stub (a real grid returns a number).
    try { if (typeof g.getTileType(-1, -1) !== 'number') return null } catch (e) { return null }
    return g
  }
  _abilityCanReach(caster, target) {
    const g = this._realGrid()
    if (!g) return true
    const tx = Math.floor(target.tileX), ty = Math.floor(target.tileY)
    const cr = g.getRoomAtTile(Math.floor(caster.tileX), Math.floor(caster.tileY))
    const tr = g.getRoomAtTile(tx, ty)
    if (!cr || !tr || cr.instanceId !== tr.instanceId) return false
    return g.getTileType(tx, ty) !== TILE.DOOR   // not a foe mid-doorway
  }

  _hostileMinionCountWithin(adv, rangeTiles) {
    let n = 0
    if (adv._revivedAdv) {
      for (const e of this._gameState.adventurers?.active ?? []) {
        if (e.aiState === 'dead' || (e.resources?.hp ?? 0) <= 0) continue
        if (!this._abilityCanReach(adv, e)) continue
        const d = Math.hypot((e.tileX ?? 0) - adv.tileX, (e.tileY ?? 0) - adv.tileY)
        if (d <= rangeTiles + 0.01) n++
      }
      return n
    }
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
      if (m.faction === 'adventurer') continue
      if (!this._abilityCanReach(adv, m)) continue
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d <= rangeTiles + 0.01) n++
    }
    return n
  }

  _fireBlockVfx(adv, durationMs) {
    // A raised bronze hoplon + deflection sheen — the brace stance.
    AbilityVfx.gladiatorBlockFx?.(this._scene, adv.worldX, adv.worldY, { durationMs: Math.min(durationMs, 900) })
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
      AbilityVfx.mobFervorFx?.(this._scene, adv.worldX, adv.worldY, { count: allies + 1 })
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
    this._considerChanneledRevive(adv, ABILITY_DEFS.valkyrie_rally, now)
  }

  // Which channeled-revive ability (if any) this adv channels — drives the
  // shared begin/tick/cancel/cast-bar so they don't need the def threaded in.
  _reviveDefFor(adv) {
    const cls = adv?.classId
    if (cls === 'valkyrie') return ABILITY_DEFS.valkyrie_rally
    if (cls === 'cleric')   return ABILITY_DEFS.cleric_resurrection
    return null
  }

  // SHARED channeled-revive state machine (Valkyrie Rally + Cleric Resurrection):
  // walk to a tile ADJACENT to the most-recently-fallen ally (never onto the
  // corpse), then run a `def.castMs` INTERRUPTIBLE channel (cast bar) that raises
  // them at def.reviveFrac HP, once per caster. Interrupt = caster dies/flees/
  // enters combat mid-cast, or the target is otherwise revived/culled.
  _considerChanneledRevive(adv, def, now) {
    // Channeling? progress the cast bar / complete / cancel.
    if (adv._rallyChannelUntil) { this._tickRallyCast(adv, now); return }
    // Walking to a fallen ally? keep steering them there until adjacent.
    if (adv._rallyApproachId != null) { this._tickRallyApproach(adv, now); return }
    // Idle wrt revive — only consider it while travelling (not mid-combat/flee).
    if (adv.aiState !== 'walking') return
    if (!AbilitySystem.canUse(adv, def, now).ready) return
    const target = this._findFallenToRevive(adv, def.rangeTiles)
    if (!target) return
    const cos = REVIVE_COSMETIC[def.id] ?? REVIVE_COSMETIC.rally_the_fallen
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
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: def.id, message: `${adv.name} ${cos.move}.` })
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
    const def = this._reviveDefFor(adv) ?? ABILITY_DEFS.valkyrie_rally
    const cos = REVIVE_COSMETIC[def.id] ?? REVIVE_COSMETIC.rally_the_fallen
    AbilitySystem.markUsed(adv, def, now)            // spend the once/day use only when the cast starts
    adv._rallyChannelUntil = now + def.castMs
    adv._rallyTargetId     = target.instanceId
    adv._castingUntil      = adv._rallyChannelUntil   // AISystem holds them still while this is set
    this._startRallyCastBar(adv, def.castMs)
    AbilityVfx.pulseRing?.(this._scene, adv.worldX, adv.worldY, { color: cos.color, fromR: 6, toR: 30, durationMs: 400, alpha: 0.7 })
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: def.id, message: `${adv.name} ${cos.kneel}.` })
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
    // ── Channel complete — raise the fallen ally at def.reviveFrac HP ──
    const def = this._reviveDefFor(adv) ?? ABILITY_DEFS.valkyrie_rally
    const cos = REVIVE_COSMETIC[def.id] ?? REVIVE_COSMETIC.rally_the_fallen
    const frac = def.reviveFrac ?? 0.5
    const dead = grave.splice(tIdx, 1)[0]
    const TS = Balance.TILE_SIZE
    dead.resources.hp    = Math.max(1, Math.floor((dead.resources.maxHp ?? 0) * frac))
    dead.aiState         = 'walking'
    dead.path = null; dead.pathIndex = 0; dead.pathTarget = null
    dead.currentTargetId = null; dead.lastAttackAt = 0
    dead._lastHitBy = null; dead._lastHitType = null
    dead.cooldowns = {}; dead.usesLeftToday = {}
    dead.worldX = (dead.tileX ?? 0) * TS + TS / 2
    dead.worldY = (dead.tileY ?? 0) * TS + TS / 2
    // A revived adv rises from where they fell, NOT the entry hall — the
    // ADVENTURER_ENTERED_DUNGEON re-init emit below would otherwise trip
    // AdventurerRenderer._onAdvEntered's door snap (mirrors the Loot Goblin
    // Heist's in-place spawn). `_spawnFadeStart/End` still get set, so the
    // renderer fades the revived sprite in at the corpse tile and AISystem
    // holds them still for that beat — they LOOK like they get up.
    dead._spawnedInPlace = true
    this._scene.bossSystem?._fightStates?.delete(dead.instanceId)
    this._gameState.adventurers.active.push(dead)
    this._scene.aiSystem?.pickInitialGoal?.(dead)
    ;(AbilityVfx[cos.fx] ?? AbilityVfx.resurrectBeam)?.(this._scene, dead.worldX, dead.worldY, { color: cos.color, durationMs: 750 })
    AbilityVfx.floatingText(this._scene, dead.worldX, (dead.worldY ?? 0) - 30, cos.done, { color: cos.hex, fontSize: '14px' })
    this._endRallyCastBar(adv)
    adv._rallyChannelUntil = null; adv._rallyTargetId = null; adv._castingUntil = null
    EventBus.emit('ADVENTURER_RESURRECTED', { adventurer: dead })
    EventBus.emit('ADVENTURER_ENTERED_DUNGEON', { adventurer: dead })   // re-init abilities + renderer sprite
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: def.id, message: `${adv.name} ${cos.verb} ${this._shortName(dead)} back to their feet at ${Math.round(frac * 100)}% HP.` })
  }

  _cancelRallyCast(adv, silentTarget = false) {
    this._endRallyCastBar(adv)
    if (adv._rallyChannelUntil && !silentTarget) {
      const cos = REVIVE_COSMETIC[this._reviveDefFor(adv)?.id] ?? REVIVE_COSMETIC.rally_the_fallen
      AbilityVfx.floatingText?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 30, 'INTERRUPTED', { color: '#cc8a8a', fontSize: '12px' })
      EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: this._reviveDefFor(adv)?.id, message: `${adv.name}'s ${cos.interrupt}.` })
    }
    adv._rallyChannelUntil = null; adv._rallyTargetId = null; adv._castingUntil = null
    adv._rallyApproachId = null; adv._rallyApproachTile = null
  }

  // A small fill-bar above the caster's head while they channel a revive.
  _startRallyCastBar(adv, durationMs) {
    this._castBars ??= new Map()
    this._endRallyCastBar(adv)
    const cos = REVIVE_COSMETIC[this._reviveDefFor(adv)?.id] ?? REVIVE_COSMETIC.rally_the_fallen
    const w = 30, h = 4, y = (adv.worldY ?? 0) - 34
    const bg   = this._scene.add.rectangle(adv.worldX, y, w, h, 0x1a140c, 0.7).setDepth(20)
    const fill = this._scene.add.rectangle(adv.worldX - w / 2, y, 1, h, cos.color, 0.95).setOrigin(0, 0.5).setDepth(21)
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

  // ── The Undying Court — minion death-saves ─────────────────────────────
  // A fatally-struck DUNGEON minion's last-chance interventions, invoked from
  // CombatSystem BEFORE the kill is finalized. Returns true if the minion was
  // saved (its HP is restored > 0 → the caller sees no death).
  attemptCourtMinionDeathSave(falling) {
    if (!falling || falling.aiState === 'dead') return false
    const now = this._scene.time.now

    // 1) Gambler Double-or-Nothing — the falling minion is a revived gambler.
    if (falling._revivedAdv && falling._raisedClassId === 'gambler') {
      const def = ABILITY_DEFS.gambler_double_or_nothing
      if (AbilitySystem.canUse(falling, def, now).ready) {
        AbilitySystem.markUsed(falling, def, now)
        const win = Math.random() < 0.5
        AbilityVfx.coinFlip?.(this._scene, falling.worldX, (falling.worldY ?? 0) - 34, win)
        if (win) {
          this._reviveMinionInPlace(falling, 0.5)
          AbilityVfx.floatingText(this._scene, falling.worldX, (falling.worldY ?? 0) - 52, 'DOUBLE!', { color: '#ffe066', fontSize: '15px' })
          EventBus.emit('ABILITY_TRIGGERED', { adventurer: falling, abilityId: 'double_or_nothing', message: `${falling.displayName ?? 'The gambler'} won the toss — back in the fight!` })
          return true
        }
        // Lose — the house pays the dungeon owner out, scaled to the run.
        const lv = this._gameState.boss?.level ?? falling.level ?? 1
        const payout = (Balance.GOLD_PER_KILL ?? 10) * 3 * lv
        this._gameState.player ??= {}
        this._gameState.player.gold = (this._gameState.player.gold ?? 0) + payout
        EventBus.emit('RESOURCES_AWARDED', { gold: payout, source: 'gambler_double_or_nothing' })
        AbilityVfx.floatingText(this._scene, falling.worldX, (falling.worldY ?? 0) - 52, `NOTHING · +${payout}g`, { color: '#ffd34d', fontSize: '13px' })
        // fall through — the gambler still dies, but the house paid out.
      }
    }

    // 2/3) A nearby revived CLERIC (Resurrection) or VALKYRIE (Rally) saves the
    // dying dungeon minion. Each is once-per-day per saver.
    const trySaver = (cls, abilityKey, reviveFrac, range, label, color, hex) => {
      for (const m of this._gameState.minions ?? []) {
        if (m === falling || m._revivedAdv !== true || m._raisedClassId !== cls) continue
        if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        const def = ABILITY_DEFS[abilityKey]
        if (!AbilitySystem.canUse(m, def, now).ready) continue
        const d = Math.hypot((m.tileX ?? 0) - (falling.tileX ?? 0), (m.tileY ?? 0) - (falling.tileY ?? 0))
        if (d > range + 0.01) continue
        AbilitySystem.markUsed(m, def, now)
        this._reviveMinionInPlace(falling, reviveFrac)
        AbilityVfx.resurrectBeam?.(this._scene, falling.worldX, falling.worldY, { color, durationMs: 720 })
        AbilityVfx.floatingText(this._scene, falling.worldX, (falling.worldY ?? 0) - 40, label, { color: hex, fontSize: '13px' })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: m, abilityId: def.id, message: `${m.displayName ?? 'A revived hero'} ${label.toLowerCase()} a fallen ally.` })
        return true
      }
      return false
    }
    if (trySaver('cleric',   'cleric_resurrection', 0.30, (Balance.HEAL_RANGE_TILES ?? 2) + 2, 'RESURRECTED', 0xfff4a8, '#fff4a8')) return true
    if (trySaver('valkyrie', 'valkyrie_rally',      0.50, ABILITY_DEFS.valkyrie_rally.rangeTiles ?? 6, 'RALLIED', 0xffe9a8, '#ffe9a8')) return true

    return false
  }

  _reviveMinionInPlace(m, frac) {
    m.resources.hp    = Math.max(1, Math.floor((m.resources.maxHp ?? 0) * frac))
    m.aiState         = 'idle'
    m.currentTargetId = null
    m.lastAttackAt    = 0
    m._lastHitBy      = null
    m._lastHitType    = null
    m.path = null; m.pathIndex = 0; m.pathTarget = null
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
        AbilityVfx.digBurstFx?.(this._scene, miner.worldX, miner.worldY, { depth: 13 })
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
    AbilityVfx.digBurstFx?.(this._scene, miner.worldX, miner.worldY, { depth: 13 })
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
    AbilityVfx.digBurstFx?.(this._scene, miner.worldX, miner.worldY, { depth: 13 })
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
    this._tickCrescendo(adv, now)
  }

  // Crescendo — one escalating battle hymn. While combat is near, the bard gains
  // a stack every CRESCENDO_STACK_MS (cap CRESCENDO_MAX); each stack buffs nearby
  // party attack + speed (read at the _inspireActiveUntil / _songSpeedActiveUntil
  // sites via the live mults below). Out of combat the swell decays. A solid hit
  // or CC shatters it to 0 + a brief silence (see _onCombatHit / the CC check).
  _tickCrescendo(adv, now) {
    const def = ABILITY_DEFS.bard_crescendo
    // CC shatter — stunned/staggered/rooted/feared/petrified breaks the song.
    if ((adv._staggeredUntil ?? 0) > now || (adv._rootedUntil ?? 0) > now ||
        (adv._panickedUntil ?? 0) > now || (adv._petrifiedUntil ?? 0) > now) {
      this._shatterCrescendo(adv, now)
      return
    }
    const silenced = (adv._crescendoSilencedUntil ?? 0) > now
    const inCombat = !silenced && this._partyAllyEngagedWithin(adv, def.auraRangeTiles + 1)
    let stacks = adv._crescendoStacks ?? 0

    if (inCombat) {
      if (now >= (adv._crescendoNextStackAt ?? 0) && stacks < CRESCENDO_MAX) {
        stacks++
        adv._crescendoNextStackAt = now + CRESCENDO_STACK_MS
        if (stacks === 1) {
          EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'crescendo', message: `${adv.name} struck up a battle hymn.` })
        } else {
          EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'crescendo', message: `${adv.name}'s hymn swells (×${stacks}).` })
        }
        AbilityVfx.crescendoFx?.(this._scene, adv.worldX, adv.worldY, { stacks })
        AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 26, stacks >= CRESCENDO_MAX ? '♪ CRESCENDO!' : `♪ ×${stacks}`, { color: '#ff8ad6', fontSize: stacks >= CRESCENDO_MAX ? '13px' : '11px' })
      }
      adv._crescendoDecayAt = now + CRESCENDO_DECAY_MS
    } else if (stacks > 0 && now >= (adv._crescendoDecayAt ?? 0)) {
      stacks--
      adv._crescendoDecayAt = now + CRESCENDO_DECAY_MS
      if (stacks === 0) EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'crescendo' })
    }

    adv._crescendoStacks = stacks
    if (stacks > 0) {
      adv._crescendoAtkMul = 1 + stacks * CRESCENDO_ATK_PER
      adv._crescendoSpdMul = 1 + stacks * CRESCENDO_SPD_PER
      // Keep the existing buff-active gates alive (read by CombatSystem / AISystem).
      adv._inspireActiveUntil   = now + CRESCENDO_REFRESH_MS
      adv._songSpeedActiveUntil = now + CRESCENDO_REFRESH_MS
    } else {
      adv._crescendoAtkMul = 1; adv._crescendoSpdMul = 1
      adv._inspireActiveUntil = null; adv._songSpeedActiveUntil = null
    }
  }

  // Shatter the song: stacks → 0, brief silence so it can't immediately rebuild.
  _shatterCrescendo(adv, now) {
    if ((adv._crescendoStacks ?? 0) > 0) {
      AbilityVfx.discordShatterFx?.(this._scene, adv.worldX, adv.worldY)
      AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 24, 'SILENCED', { color: '#9aa7b4', fontSize: '11px' })
      EventBus.emit('ABILITY_BUFF_ENDED', { adventurer: adv, abilityId: 'crescendo' })
    }
    adv._crescendoStacks = 0
    adv._crescendoAtkMul = 1; adv._crescendoSpdMul = 1
    adv._crescendoNextStackAt = now + CRESCENDO_STACK_MS
    adv._crescendoSilencedUntil = now + CRESCENDO_SILENCE_MS
    adv._inspireActiveUntil = null; adv._songSpeedActiveUntil = null
  }

  // COMBAT_HIT listener — a solid blow (≥ CRESCENDO_HIT_FRAC of max HP) to a bard
  // shatters the crescendo. Chip damage doesn't (the reward for committing a burst).
  _onCombatHit(payload) {
    const id = payload?.targetId
    if (!id || !(payload.damage > 0)) return
    const adv = (this._gameState.adventurers?.active ?? []).find(a => a.instanceId === id)
      ?? (this._gameState.minions ?? []).find(m => m.instanceId === id && m._raisedClassId === 'bard')
    if (!adv) return
    if (adv.classId !== 'bard' && adv._raisedClassId !== 'bard') return
    const maxHp = adv.resources?.maxHp ?? 0
    if (maxHp <= 0 || (adv._crescendoStacks ?? 0) <= 0) return
    if (payload.damage >= maxHp * CRESCENDO_HIT_FRAC) {
      this._shatterCrescendo(adv, this._scene?.time?.now ?? 0)
    }
  }

  _partyAllyEngagedWithin(bard, rangeTiles) {
    if (bard._revivedAdv) {
      if (bard.aiState === 'engaging') return true
      for (const m of this._gameState.minions ?? []) {
        if (m === bard || m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        if (m.aiState !== 'engaging') continue
        const d = Math.hypot(m.tileX - bard.tileX, m.tileY - bard.tileY)
        if (d <= rangeTiles + 0.01) return true
      }
      return false
    }
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

  _hostileMinionWithin(adv, rangeTiles) {
    if (adv._revivedAdv) {
      // Side-aware (The Undying Court) — for a revived minion the "hostiles"
      // it scans for are the living adventurers.
      for (const e of this._gameState.adventurers?.active ?? []) {
        if (e.aiState === 'dead' || (e.resources?.hp ?? 0) <= 0) continue
        if (!this._abilityCanReach(adv, e)) continue
        const d = Math.hypot((e.tileX ?? 0) - adv.tileX, (e.tileY ?? 0) - adv.tileY)
        if (d <= rangeTiles + 0.01) return true
      }
      return false
    }
    const minions = this._gameState.minions ?? []
    for (const m of minions) {
      if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
      if (m.faction === 'adventurer') continue // tamed/raised allies don't count
      if (!this._abilityCanReach(adv, m)) continue
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
      if (!this._abilityCanReach(adv, m)) continue
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d > rangeTiles + 0.01) continue
      if (d < bestD) { best = m; bestD = d }
    }
    return best
  }

  // Competence (Layer A) — danger score for picking the BEST target of a
  // single-target ability: the scariest reachable foe, not merely the nearest.
  // Heavier attack + bulk + actively-engaging weight it up. (Also the seed for
  // the Phase-4 bestiary counters' focus-fire.)
  _minionThreat(m) {
    return (m?.stats?.attack ?? 0)
         + (m?.resources?.maxHp ?? 0) * 0.04
         + ((m?.aiState === 'engaging' || m?.aiState === 'fighting') ? 8 : 0)
  }
  // Highest-threat reachable hostile minion in range (ties break to the nearer).
  // Same filter as _nearestHostileMinion — a drop-in for "use this on the
  // most dangerous foe, not whoever happens to be closest."
  _strongestHostileMinion(adv, rangeTiles) {
    let best = null, bestScore = -Infinity, bestD = Infinity
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
      if (m.faction === 'adventurer') continue
      if (!this._abilityCanReach(adv, m)) continue
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d > rangeTiles + 0.01) continue
      const s = this._minionThreat(m)
      if (s > bestScore || (s === bestScore && d < bestD)) { best = m; bestScore = s; bestD = d }
    }
    return best
  }

  // Defensive-timing counter (Layer B) — is a STUDIED enemy type (the kingdom
  // knows it at strength ≥ DEFENSE_TIER) within `range` of this adv? Lets the
  // shield classes pre-pop their guard before a known threat's blow lands.
  // Reveal-gated + mastery-scaled + stale-weakened via getEnemyCounter.
  _studiedThreatNear(adv, range) {
    const ks = this._scene?.knowledgeSystem
    if (!ks?.getEnemyCounter) return false
    const minStr = Balance.KNOWLEDGE_COUNTER_DEFENSE_TIER ?? 0.34
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.faction === 'adventurer') continue
      if (!this._abilityCanReach(adv, m)) continue
      const d = Math.hypot((m.tileX ?? 0) - adv.tileX, (m.tileY ?? 0) - adv.tileY)
      if (d > range + 0.01) continue
      const c = ks.getEnemyCounter(m)
      if (c.known && c.strength >= minStr) return true
    }
    return false
  }

  // ── Monk ──────────────────────────────────────────────────────────────────

  _considerMonk(adv, now) {
    // Riposte stance — raise it when a hostile is near. While up, CombatSystem
    // gives the monk a dodge chance AND a successful dodge counter-strikes the
    // attacker (see the dodge block there). `_focusActiveUntil` is the stance window.
    const rip = ABILITY_DEFS.monk_riposte
    if (this._hostileMinionWithin(adv, 4)) {
      const ready = AbilitySystem.canUse(adv, rip, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, rip, now)
        adv._focusActiveUntil = now + rip.durationMs
        this._fireFocusVfx(adv, rip.durationMs)
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'riposte', message: `${adv.name} settled into a riposte stance.` })
      }
    }

    // Stunning Palm — a periodic melee strike that STUNS one nearby minion
    // (reuses the `_staggeredUntil` skip in MinionAISystem) + a light palm hit.
    const palm = ABILITY_DEFS.monk_palm
    // Competence: STUN the most dangerous foe in reach, not whoever's nearest.
    const target = this._strongestHostileMinion(adv, palm.rangeTiles)
    if (target) {
      const ready = AbilitySystem.canUse(adv, palm, now)
      if (ready.ready) {
        AbilitySystem.markUsed(adv, palm, now)
        target._staggeredUntil = Math.max(target._staggeredUntil ?? 0, now + palm.stunMs)
        const dmg = Math.max(1, Math.floor(adv.stats?.attack ?? 0) - (target.stats?.defense ?? 0))
        target.resources.hp = Math.max(0, (target.resources?.hp ?? 0) - dmg)
        EventBus.emit('COMBAT_HIT', { sourceId: adv.instanceId, targetId: target.instanceId, damage: dmg, damageType: 'physical', isCritical: false })
        AbilityVfx.stunningPalmFx?.(this._scene, target.worldX, target.worldY)
        AbilityVfx.floatingText(this._scene, target.worldX, (target.worldY ?? 0) - 22, 'STUNNED', { color: '#ffe9a8', fontSize: '11px' })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'stunning_palm', message: `${adv.name} landed a Stunning Palm.` })
      }
    }
  }

  _fireFocusVfx(adv, durationMs) {
    // Face the nearest hostile so the guard-sweep reads toward the threat.
    const foe = this._nearestHostileMinion(adv, 6)
    const dir = foe ? ((foe.tileX - adv.tileX) >= 0 ? 1 : -1) : 1
    AbilityVfx.focusStanceFx?.(this._scene, adv.worldX, adv.worldY, { dir })
  }

  // ── Cleric ────────────────────────────────────────────────────────────────

  _considerCleric(adv, now) {
    // Phase 9 — Crusader's Curse: clerics cannot heal in this dungeon.
    if ((this._gameState._mechanicFlags ?? {}).crusadersCurse) return
    // Channeled Resurrection (2026-06-09) — LIVE cleric adventurers walk to a
    // fallen ally + run the 3s cast bar, same machinery as the Valkyrie's Rally
    // (raise at 30% HP). A revived cleric MINION (Undying Court) is excluded —
    // it keeps its instant in-place save of dungeon minions. While she's
    // approaching/channelling a revive, that owns her turn — skip the heal so
    // she doesn't multitask out of the cast.
    if (!adv._revivedAdv) {
      this._considerChanneledRevive(adv, ABILITY_DEFS.cleric_resurrection, now)
      if (adv._rallyChannelUntil || adv._rallyApproachId != null) return
    }
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
        AbilityVfx.healLightFx?.(this._scene, target.worldX, target.worldY)
        AbilityVfx.floatingText(this._scene, target.worldX, target.worldY - 22, `+${Math.round(restored)}`, { color: '#fff4a8' })
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
    if (cleric._revivedAdv) {
      // Revived cleric minion — heal the lowest-HP nearby DUNGEON minion.
      for (const m of this._gameState.minions ?? []) {
        if (m === cleric || m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        const frac = m.resources.maxHp > 0 ? m.resources.hp / m.resources.maxHp : 1
        if (frac >= bestFrac) continue
        const d = Math.hypot(m.tileX - cleric.tileX, m.tileY - cleric.tileY)
        if (d > (Balance.HEAL_RANGE_TILES ?? 2) + 0.01) continue
        best = m; bestFrac = frac
      }
      return best
    }
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

  // (Cleric Resurrection's old instant death-save was removed 2026-06-09 — the
  // cleric now revives proactively via a 3s channel in _considerCleric, exactly
  // like the Valkyrie's Rally. The revived-cleric-MINION instant minion save
  // still lives in the saver path above.)

  // ── Mage ──────────────────────────────────────────────────────────────────

  _considerMage(adv, now) {
    // Roll a cosmetic spell element on first sight — purely tints the Arcane
    // Burst VFX (fire/ice/lightning/wind). The old Elemental Affinity damage
    // bonus retired with the vulnerability system (2026-06-10); the mage's
    // damage now comes from the flat Arcane Mastery passive in CombatSystem.
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
        AbilityVfx.arcaneChargeFx?.(this._scene, x, y, { color: this._elementColor(adv._element) })
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
        AbilityVfx.necroSummonFx?.(this._scene, x, y)
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
        AbilityVfx.boneArmorFx?.(this._scene, adv.worldX, adv.worldY)
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
      if (necro._revivedAdv) {
        // The Undying Court — a revived necro's summons fight for the DUNGEON
        // and are cleaned up at DAY_PHASE_ENDED (see the pact handler).
        minion.faction = 'dungeon'
        minion._courtSummon = true
        minion.factionExpiresOn = null
      } else {
        minion.faction = 'adventurer'
        minion.factionExpiresOn = today + 1   // despawn at next day-end
      }
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
    // Revived necro minion — its summons fight for the DUNGEON faction.
    const wantFaction = necro._revivedAdv ? 'dungeon' : 'adventurer'
    for (const m of this._gameState.minions ?? []) {
      if (m.faction !== wantFaction) continue
      if (m.raisedByAdvId !== necro.instanceId) continue
      if (m.aiState === 'dead' || m.resources?.hp <= 0) continue
      n++
    }
    return n
  }

  // ── Ranger ────────────────────────────────────────────────────────────────

  _considerRanger(adv, now) {
    // Piercing Shot is a proc handled in CombatSystem (every 5th shot). Nothing
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
      const trapWX = trap.tileX * Balance.TILE_SIZE + Balance.TILE_SIZE / 2, trapWY = trap.tileY * Balance.TILE_SIZE + Balance.TILE_SIZE / 2
      if (Math.random() < (teDef.failChance ?? 0.2)) {
        // Failure — trigger the trap on the ranger.
        AbilityVfx.disarmFx?.(this._scene, trapWX, trapWY, { fail: true })
        AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'FUMBLE!', { color: '#ff6644' })
        EventBus.emit('TRAP_DISARM_FAILED', { trap, adventurer: adv })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'trap_expert', message: `${adv.name} fumbled a trap.` })
        // Manually fire the trap effect via TrapSystem if possible.
        this._scene.trapSystem?._fireTrap?.(trap, this._scene.trapSystem._defs?.[trap.definitionId], adv)
      } else {
        trap._disabledThisDay = true
        AbilityVfx.disarmFx?.(this._scene, trapWX, trapWY)
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
      // Competence: tame the STRONGEST beast in reach — convert the biggest
      // threat into an ally rather than whichever wanders closest.
      const target = this._strongestHostileMinion(adv, tameDef.rangeTiles)
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
            AbilityVfx.tameFx?.(this._scene, target.worldX, target.worldY)
            AbilityVfx.floatingText(this._scene, target.worldX, target.worldY - 22, 'TAMED', { color: '#ff99cc' })
            EventBus.emit('MINION_TAMED', { minion: target, tamer: adv })
            EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'tame_beast', message: `${adv.name} tamed a beast.` })
          } else {
            AbilityVfx.tameFx?.(this._scene, target.worldX, target.worldY, { fail: true })
            AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 22, 'TAME FAILED', { color: '#999999', fontSize: '10px' })
            EventBus.emit('TAME_FAILED', { minion: target, tamer: adv })
          }
        }
      }
    }
    // Sic 'Em — command the companion to POUNCE a nearby hostile: a directed
    // maul for a multiple of the beast's attack, then the beast engages it.
    // (Pack Tactics — the flanking bonus when both attack the same target — is
    // a passive handled in CombatSystem._computeDamage.)
    const companion = this._beastMasterCompanion(adv)
    if (companion) {
      const sicDef = ABILITY_DEFS.bm_sic_em
      // Competence: maul the most dangerous foe near the beast, not the nearest.
      const prey = this._strongestHostileMinion(companion, sicDef.rangeTiles)
      if (prey && AbilitySystem.canUse(adv, sicDef, now).ready) {
        AbilitySystem.markUsed(adv, sicDef, now)
        const dmg = Math.max(1, Math.floor((companion.stats?.attack ?? 0) * sicDef.mult) - (prey.stats?.defense ?? 0))
        prey.resources.hp = Math.max(0, (prey.resources?.hp ?? 0) - dmg)
        companion.currentTargetId = prey.instanceId
        EventBus.emit('COMBAT_HIT', { sourceId: companion.instanceId, targetId: prey.instanceId, damage: dmg, damageType: 'physical', isCritical: false })
        AbilityVfx.pounceFx?.(this._scene, companion.worldX, companion.worldY, prey.worldX, prey.worldY)
        AbilityVfx.floatingText(this._scene, prey.worldX, (prey.worldY ?? 0) - 22, 'MAULED', { color: '#ff9944', fontSize: '11px' })
        EventBus.emit('ABILITY_TRIGGERED', { adventurer: adv, abilityId: 'sic_em', message: `${adv.name} sicced the beast on a foe.` })
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
    // A charge in progress drives itself through its wind-up → dash phases.
    if (adv._chargePhase) { this._tickCharge(adv, now); return }

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

    // Reckless Charge — barrel into the densest nearby minion cluster. Skip while
    // already mid-cast (some other freeze owns him) or fighting the boss directly.
    if ((adv._castingUntil ?? 0) > now) return
    if (adv.goal?.type === 'AT_BOSS') return
    const def = ABILITY_DEFS.barb_charge
    if (!AbilitySystem.canUse(adv, def, now).ready) return
    const cluster = this._pickChargeCluster(adv, def.scanTiles ?? 6, def.clusterMin ?? 2)
    if (!cluster) return
    AbilitySystem.markUsed(adv, def, now)
    this._beginCharge(adv, now, cluster)
  }

  // Find the densest reachable hostile-minion cluster within `scanTiles`. Each
  // candidate minion is scored by how many other hostiles sit within 1 tile of
  // it; the best center wins if it gathers at least `minCount` minions. Returns
  // the center's tile/world position + count (the charge aims here).
  _pickChargeCluster(adv, scanTiles, minCount) {
    const hostiles = []
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.faction === 'adventurer') continue          // tamed/raised allies don't count
      if (!this._abilityCanReach(adv, m)) continue        // same room/floor — keeps the line sane
      const d = Math.hypot((m.tileX ?? 0) - adv.tileX, (m.tileY ?? 0) - adv.tileY)
      if (d > scanTiles + 0.01) continue
      hostiles.push(m)
    }
    if (hostiles.length < minCount) return null
    let best = null, bestCount = 0
    for (const c of hostiles) {
      let count = 0
      for (const o of hostiles) {
        if (Math.hypot(o.tileX - c.tileX, o.tileY - c.tileY) <= 1.01) count++
      }
      if (count > bestCount) { bestCount = count; best = c }
    }
    if (!best || bestCount < minCount) return null
    const TS = Balance.TILE_SIZE
    return { tileX: best.tileX, tileY: best.tileY, worldX: best.tileX * TS + TS / 2, worldY: best.tileY * TS + TS / 2, count: bestCount }
  }

  // PHASE 0 — telegraphed wind-up. He plants his feet (AISystem yields on
  // `_castingUntil`) for a beat so the player can read the charge coming, then
  // the dash kicks off in _tickCharge.
  _beginCharge(barb, now, cluster) {
    barb._chargePhase       = 'windup'
    barb._chargeTarget      = { x: cluster.tileX, y: cluster.tileY }
    barb._chargeFrom        = { x: barb.tileX, y: barb.tileY }
    barb._chargeWindupUntil = now + CHARGE_WINDUP_MS
    barb._castingUntil      = now + CHARGE_WINDUP_MS
    barb.path = null; barb.pathIndex = 0; barb.pathTarget = null
    // Telegraph: braced-feet grit + swelling rage ember + forward dust skid.
    const cdir = (cluster.tileX - barb.tileX) >= 0 ? 1 : -1
    AbilityVfx.chargeWindupFx?.(this._scene, barb.worldX, barb.worldY, { dir: cdir, depth: 13 })
    AbilityVfx.floatingText(this._scene, barb.worldX, barb.worldY - 28, 'CHARGE!', { color: '#ff7a3a', fontSize: '13px' })
    EventBus.emit('ABILITY_TRIGGERED', { adventurer: barb, abilityId: 'reckless_charge', message: `${barb.name} lowered a shoulder and charged.` })
  }

  // Per-tick charge state machine: windup → dashing → (done). Position is driven
  // directly here (AISystem is frozen via `_castingUntil`), mirroring the Miner's
  // custom mover.
  _tickCharge(barb, now) {
    const TS = Balance.TILE_SIZE
    switch (barb._chargePhase) {
      case 'windup': {
        if (now < (barb._chargeWindupUntil ?? 0)) { barb._castingUntil = barb._chargeWindupUntil; return }
        // Resolve the actual landing tile: one step short of the target along the
        // charge direction (so he ends ADJACENT, swinging — not on top of it),
        // falling back to the target tile if that step isn't walkable.
        const from = barb._chargeFrom, tgt = barb._chargeTarget
        const dx = tgt.x - from.x, dy = tgt.y - from.y
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len, uy = dy / len
        const grid = this._scene.dungeonGrid
        const landX = Math.round(tgt.x - ux), landY = Math.round(tgt.y - uy)
        let endX = tgt.x, endY = tgt.y
        if (grid && this._tileWalkable(grid, landX, landY)) { endX = landX; endY = landY }
        // Apply the path knockback + stagger ONCE, up front (no per-frame collision).
        // Sweep to the TARGET tile (the cluster centre), not the shortened landing —
        // else the cluster he's charging INTO sits just past the segment end.
        this._applyChargePathEffects(barb, from, tgt, ux, uy, now)
        // Set up the dash lerp.
        const distTiles = Math.hypot(endX - from.x, endY - from.y)
        const dashMs = Math.max(CHARGE_DASH_MIN_MS, Math.min(CHARGE_DASH_MAX_MS, distTiles * CHARGE_MS_PER_TILE))
        barb._chargePhase     = 'dashing'
        barb._chargeDashStart = now
        barb._chargeDashUntil = now + dashMs
        barb._chargeDashFrom  = { x: barb.worldX, y: barb.worldY }
        barb._chargeDashTo    = { x: endX * TS + TS / 2, y: endY * TS + TS / 2 }
        barb._chargeEndTile   = { x: endX, y: endY }
        barb._castingUntil    = now + dashMs + 120
        // The dash+impact VFX fires on LANDING (below) so the cracked-earth fan
        // syncs to arrival; the grit streaks retroactively rake the path.
        return
      }
      case 'dashing': {
        const start = barb._chargeDashStart ?? now
        const total = Math.max(1, (barb._chargeDashUntil ?? now) - start)
        let t = (now - start) / total
        if (t >= 1) {
          // Land.
          const e = barb._chargeEndTile
          barb.tileX = e.x; barb.tileY = e.y
          barb.worldX = barb._chargeDashTo.x; barb.worldY = barb._chargeDashTo.y
          this._endCharge(barb, now)
          // Bull-rush dash streaks rake the path + a forward cracked-earth fan,
          // flung rock shards, and a low dust pall detonate on arrival.
          AbilityVfx.recklessChargeFx?.(this._scene, barb._chargeDashFrom.x, barb._chargeDashFrom.y, barb.worldX, barb.worldY, { depth: 13 })
          return
        }
        t = t < 0 ? 0 : t
        const e = 1 - (1 - t) * (1 - t)   // Quadratic ease-out — fast off the mark, settles on landing
        const f = barb._chargeDashFrom, d = barb._chargeDashTo
        barb.worldX = f.x + (d.x - f.x) * e
        barb.worldY = f.y + (d.y - f.y) * e
        barb.tileX = Math.floor(barb.worldX / TS)
        barb.tileY = Math.floor(barb.worldY / TS)
        barb._castingUntil = Math.max(barb._castingUntil ?? 0, barb._chargeDashUntil ?? now)
        return
      }
      default:
        this._endCharge(barb, now)
    }
  }

  _endCharge(barb, now) {
    barb._chargePhase = null
    barb._chargeTarget = null; barb._chargeFrom = null
    barb._chargeWindupUntil = 0; barb._chargeDashStart = 0; barb._chargeDashUntil = 0
    barb._chargeDashFrom = null; barb._chargeDashTo = null; barb._chargeEndTile = null
    barb._castingUntil = now            // release AISystem control immediately
    barb.path = null; barb.pathIndex = 0; barb.pathTarget = null
  }

  // Knock back + stagger every hostile minion the charge line sweeps through.
  // LOCKED design: no path damage — pure disruption. Knockback is one tile along
  // the charge direction (clamped to walkable); stagger skips the minion's turn.
  _applyChargePathEffects(barb, from, to, ux, uy, now) {
    const grid = this._scene.dungeonGrid
    const segLen = Math.hypot(to.x - from.x, to.y - from.y) || 1
    for (const m of this._gameState.minions ?? []) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      if (m.faction === 'adventurer') continue
      // A minion is "in the path" if it's near the charge LINE (a straggler the
      // dash clips) OR within the impact radius of the target cluster centre
      // (so the whole cluster he's barrelling into gets bowled, not just the
      // one dead-on the centre line).
      const relx = m.tileX - from.x, rely = m.tileY - from.y
      const along = relx * ux + rely * uy
      const perp = Math.abs(relx * uy - rely * ux)
      const onLine = along >= -0.5 && along <= segLen + 0.5 && perp <= CHARGE_PATH_RADIUS
      const inCluster = Math.hypot(m.tileX - to.x, m.tileY - to.y) <= CHARGE_IMPACT_RADIUS
      if (!onLine && !inCluster) continue
      // Stagger (skip its AI turn for the duration).
      const next = now + CHARGE_STAGGER_MS
      if ((m._staggeredUntil ?? 0) < next) m._staggeredUntil = next
      // Knockback one tile along the charge direction, if the destination is open.
      const kx = Math.round(m.tileX + ux), ky = Math.round(m.tileY + uy)
      if (grid && (kx !== m.tileX || ky !== m.tileY) && this._tileWalkable(grid, kx, ky)) {
        const TS = Balance.TILE_SIZE
        m.tileX = kx; m.tileY = ky
        m.worldX = kx * TS + TS / 2; m.worldY = ky * TS + TS / 2
        m._patrolTarget = null; m._chasePath = null
      }
      // WHUMP — impact star + dirt puff + spinning grit chips on the bowled minion.
      AbilityVfx.staggerHitFx?.(this._scene, m.worldX, m.worldY, { depth: 14 })
    }
  }

  _tileWalkable(grid, x, y) {
    const t = grid.getTileType?.(x, y)
    return t != null && PathfinderSystem.isWalkable(t) && t !== TILE.DOOR
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
        AbilityVfx.vanishSmokeFx?.(this._scene, adv.worldX, adv.worldY)
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
    AbilityVfx.vanishSmokeFx?.(this._scene, adv.worldX, adv.worldY, { reveal: true })
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
    // Bulwark — face the nearest hostile so the shield-wall raises toward the threat.
    const foe = this._nearestHostileMinion(adv, 6)
    const dir = foe ? ((foe.tileX - adv.tileX) >= 0 ? 1 : -1) : 1
    AbilityVfx.bulwarkWallFx?.(this._scene, adv.worldX, adv.worldY, { dir })
    AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 28, 'BULWARK', { color: '#9fc8ff' })
  }

  _fireTauntVfx(adv) {
    AbilityVfx.tauntFx?.(this._scene, adv.worldX, adv.worldY)
    AbilityVfx.floatingText(this._scene, adv.worldX, adv.worldY - 28, 'TAUNT!', { color: '#ff8866', fontSize: '14px' })
  }

  // ── Day-start hook ────────────────────────────────────────────────────────

  _onNewDay() {
    const defs = Object.values(ABILITY_DEFS)
    for (const adv of this._gameState.adventurers.active ?? []) {
      AbilitySystem.resetForNewDay(adv, defs)
    }
    // The Undying Court — refresh per-day ability budgets for revived minions
    // too (so 1/day abilities like cleric Resurrection recharge each day).
    for (const m of this._gameState.minions ?? []) {
      if (m._revivedAdv === true) AbilitySystem.resetForNewDay(m, defs)
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

// Silence Ward — like _advInAntiMagicRoom but membership is a Set (the ward
// coverage recomputed each tick). Exported for CombatSystem (Dead Zone) reuse.
export function advInSilenceWard(adv, gameState) {
  const ids = gameState?._silenceWardRoomIds
  if (!Array.isArray(ids) || ids.length === 0) return false
  const tx = adv?.tileX, ty = adv?.tileY
  if (typeof tx !== 'number' || typeof ty !== 'number') return false
  for (const r of (gameState?.dungeon?.rooms ?? [])) {
    if (!ids.includes(r.instanceId)) continue
    if (tx >= r.gridX && tx < r.gridX + r.width &&
        ty >= r.gridY && ty < r.gridY + r.height) return true
  }
  return false
}

function _advInRoomSet(adv, gameState, idSet) {
  const tx = adv?.tileX, ty = adv?.tileY
  if (typeof tx !== 'number' || typeof ty !== 'number') return false
  for (const r of (gameState?.dungeon?.rooms ?? [])) {
    if (!idSet.has(r.instanceId)) continue
    if (tx >= r.gridX && tx < r.gridX + r.width &&
        ty >= r.gridY && ty < r.gridY + r.height) return true
  }
  return false
}

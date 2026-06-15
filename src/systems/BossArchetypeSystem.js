// BossArchetypeSystem — owns the per-archetype headline mechanics for the
// 10 monster bosses (Phase 1b). All hooks check `gameState.player.bossArchetypeId`
// before reacting, so a single system can host every archetype rule.
//
// Phase 1b.1 — ORC: Loot the Fallen + Warband (Phase 1b.12 followup)
//   Loot the Fallen: each orc minion keeps +1 ATK per adventurer it
//     personally kills (tracked on `_lootAtkBonus`). No cap, lost on death.
//   Warband: every orc-tagged minion gets +5% ATK and +5% DEF per OTHER
//     orc-tagged minion currently in the same room (live recompute each
//     frame from `_orcBaseAttack` / `_orcBaseDefense` baselines). Stacks
//     with Loot the Fallen multiplicatively.
//
// Phase 1b.2 — GOLEM: Living Architecture + Earthquake
//   Living Architecture: each placed room (incl. boss + corridor) gives the
//     boss +5 max HP and +1 DEF, permanently. Tracked via gameState.boss._golem
//     so save/load and dynamic placement/removal stay consistent.
//   Earthquake: 1×/day during day phase. Player clicks the Earthquake button
//     in the boss-archetype UI, then clicks a target room — every adv inside
//     takes (rooms placed × 2) damage. Camera shake VFX.
//
// Phase 1b.3 — BEHOLDER: Petrify Gaze + Anti-Magic Aura
//   Petrify Gaze: while the boss fight is active, every 6 s the boss freezes
//     every active fighter for 2 s. Eye-beam + stone-crackle VFX.
//   Anti-Magic Aura: at the start of each day, mark N random rooms (excluding
//     boss chamber) as anti-magic. N = 2 + (boss level - 1). Adventurers
//     inside those rooms cannot fire any class abilities for the day. Each
//     marked room gets a faint purple glow.
//
// Phase 1b.4 — LICH: Phylactery
//   Phylactery: at boss level 3 the Heart item unlocks (free, one per run).
//     Place it in any non-boss room. While the heart lives, it acts as a
//     4th boss life. Each spawned adv has a 15% chance to hunt the heart on
//     entry; when boss has 0 normal lives left, every adv auto-hunts it.
//     Reaching the heart's tile freezes the adv there and BossArchetypeSystem
//     ticks damage = adv.stats.attack every LICH_PHYLACTERY_DMG_INTERVAL_MS.
//
// Phase 1b.5 — LICH: Necromancy
//   Every adventurer killed in the dungeon raises as a free Skeleton minion
//   at the next dawn. Skeleton lasts one full day, then despawns. Tagged
//   with the dead adv's class — Cleric raises heal nearby minions, Mage
//   raises gain ranged attack, etc. Skeletons don't count toward minion cap.
//
// Phase 1b.6 — LIZARDMAN: Camouflage + Venom Stack
//   Camouflage: every lizardman-tagged minion spawns invisible to advs
//   (AISystem skip + KnowledgeSystem skip). Each minion individually
//   reveals on its first attack (CombatSystem hook clears _camouflaged).
//   Re-camouflage applies on NIGHT_PHASE_STARTED so each new day = fresh
//   ambush. Player still sees the minions, rendered at 0.5 alpha.
//   Venom Stack: every lizardman-minion hit on an adv adds 1 venom stack;
//   per-tick DoT (every 1 s) ticks -1 HP per stack until adv dies or flees.
//
// Phase 1b.7 — MYCONID: Spore Network + Corpse Bloom
//   Spore Network: every MYCONID_SPORE_INTERVAL_DAYS, all corridor-room
//   instances emit a poison cloud for the entire day. Advs inside take
//   `0.5 × bossLevel` HP/tick. Faint green cloud + spore-particle VFX.
//   Corpse Bloom: every adventurer that dies leaves a green-tinted fungal
//   corpse on its tile. Corpses last MYCONID_CORPSE_LIFESPAN_DAYS days.
//   Touching a fresh corpse adds MYCONID_CORPSE_VENOM_STACKS_ADDED stacks
//   to the adv (reuses the lizardman venom-tick pipeline). When the corpse
//   times out, it sprouts a free `plant1` (Vinekin) minion. Corpses
//   despawn early if the room they live in is removed.
//
// Phase 1b.11 — GNOLL: Hunters Pack + Bloodlust
//   Hunters Pack: a free `gnoll1` lives in the boss room. +1 free gnoll per
//     boss level above 1, capped at GNOLL_HUNTERS_PACK_MAX (5). They use
//     class:'garrison' (no minion-cap), evolve normally on kills, and are
//     re-spawned to fill missing slots at every NIGHT_PHASE_STARTED so the
//     pack rebuilds itself overnight.
//   Bloodlust: every adventurer killed by a minion or the boss adds
//     GNOLL_BLOODLUST_PCT_PER_KILL (3%) ATK to every gnoll for the rest of
//     the day, no cap. Each gnoll's daily baseline ATK is captured at dawn
//     so the buff can be cleanly reset. Red-flash VFX + "+3% ATK" floater
//     per stack.
//
// Phase 1b.10 — VAMPIRE: Charm + Blood Tax
//   Charm: at the start of each day the system marks one random adv from
//     the spawning party with `_charmed: true` + a CHARM_WALK goal (route
//     to the boss room). When they reach a boss-chamber tile, they're
//     converted into a thrall: a free `vampire_minion1` minion (no cap)
//     with `_isVampireThrall: true` + `_charmedClassId` retained for flavor.
//     Thralls roam the entire dungeon hunting advs (assignedRoomId rotates
//     every VAMPIRE_THRALL_ROAM_SWAP_MS — same pattern as Demon imps), and
//     do not respawn after death.
//   Blood Tax: every dungeon-faction minion's hit on an adv heals the boss
//     for the same damage amount (capped at boss.maxHp). Adv still loses
//     HP normally; adv still dies on lethal hits. Boss attacks unaffected.
//     Red-streak VFX from the adv to the boss for each tax tick.
//
// Phase 1b.9 — DEMON: Sacrifice Pact + Hellgate
//   Sacrifice Pact: 1×/day, player clicks the SACRIFICE button — it fires
//     immediately, auto-choosing the minion to burn (no pick step). 50%
//     chance to burn an expendable Hellgate Imp when any exist, else a
//     random dungeon minion. The burned minion permadies (no respawn) and
//     one randomly-chosen alive adv in the dungeon is instakilled.
//   Hellgate: a permanent infernal portal sits in a corner of the boss
//     chamber. Each dawn N free Imps spawn (N = boss level), stat-scaled
//     to 10% of imp1 base × (1 + bossLevel × 10%). Imps roam the whole
//     dungeon (assignedRoomId rotates each minute), persist forever, and
//     do not count toward the minion cap.
//
// Phase 1b.8 — WRAITH: Fear Meter + Haunting
//   Fear Meter: every adv carries `_fear` (0..100). +5 per corpse newly
//   seen, +10 per trap they trigger, +5 per minion newly observed,
//   +15 when an ally dies in front of them. At 50% fear they panic-flee
//   to a random non-exit room. At 75% they enter a 5 s friendly-fire window.
//   At 100% they die instantly — drop gold but no boss XP.
//   Haunting: every adv that dies (regardless of how) spawns a free
//   `ghost2` minion at the death tile. Ghost is permanent (no minion-cap),
//   patrols its spawn room, and wall-phases to adjacent connected rooms
//   to engage advs there, returning home if alive afterward.
//
// Future phases extend this file (Lizardman, Wraith, etc).

import { EventBus } from './EventBus.js'
import { Balance }  from '../config/balance.js'
import { createMinion, applyMinionScaling, applyBossLevelToMinion } from '../entities/Minion.js'
import { TILE }     from './DungeonGrid.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'
import { classifyTrophy, TROPHY_BY_ID, TROPHY_TYPES } from '../config/orcTrophies.js'
import { currentAct } from '../config/acts.js'

// Slime King Absorb & Excrete — Goopling roll pool, level-gated.
//
// Tier mapping comes from src/data/minionEvolutions.json — each of the
// three slime chains is laid out as [T1, T2, T3, T4-elder]:
//   Toxic   : slime3 → slime7 → slime8 → elder_slime1
//   Acid    : slime2 → slime9 → slime1 → elder_slime2
//   Frost   : slime4 → slime5 → slime6 → elder_slime3
//
// Per-tier pool = one entry from each chain at that tier so every spawn
// has visual variety (random palette + ability mix).
const GOOPLING_POOL_T1 = ['slime2', 'slime3', 'slime4']
const GOOPLING_POOL_T2 = ['slime5', 'slime7', 'slime9']
const GOOPLING_POOL_T3 = ['slime1', 'slime6', 'slime8']

function _gooplingPoolForBossLevel(bossLv) {
  if ((bossLv ?? 1) <= 4) return GOOPLING_POOL_T1
  if ((bossLv ?? 1) <= 8) return GOOPLING_POOL_T2
  return GOOPLING_POOL_T3
}

const MINION_TAG_ORC       = 'orc'
const MINION_TAG_LIZARDMAN = 'lizardman'

export class BossArchetypeSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState

    // Earthquake transient state — armed = waiting for room click.
    this._earthquakeArmed     = false
    // Sacrifice Pact transient state — armed = waiting for minion click.
    this._sacrificeArmed      = false

    // Beholder Petrify Gaze — active timer reference + per-fight VFX layer.
    this._petrifyTimer       = null
    this._bloomFightTimer    = null
    this._brimstoneFightTimer = null
    this._hellfireZones      = []   // [{ roomId, until }] — Pact burning ground
    this._fortressFightTimer = null
    this._fissureZones       = []   // [{ roomId, until }] — Seismic fissures
    this._plagueFightTimer   = null
    this._plagueSpreadAt     = 0    // contagion-spread cadence stamp
    this._petrifyFxGraphics  = null
    // Beholder Anti-Magic Aura — graphics layer for the daily purple glow.
    this._antiMagicFx        = null

    EventBus.on('ADVENTURER_DIED',    this._onAdvDied,        this)
    EventBus.on('MINION_DIED',        this._onMinionDied,     this)
    EventBus.on('ROOM_PLACED',        this._onRoomPlaced,     this)
    EventBus.on('ROOM_REMOVED',       this._onRoomRemoved,    this)
    EventBus.on('NIGHT_PHASE_STARTED', this._onNightStart,    this)
    EventBus.on('GOLEM_EARTHQUAKE_ARM',     this._armEarthquake,    this)
    EventBus.on('GOLEM_EARTHQUAKE_DISARM',  this._disarmEarthquake, this)
    EventBus.on('GOLEM_EARTHQUAKE_TARGET',  this._fireEarthquake,   this)
    // Beholder hooks
    EventBus.on('BOSS_FIGHT_STARTED',  this._onBossFightStarted, this)
    EventBus.on('BOSS_FIGHT_RESOLVED', this._onBossFightResolved, this)
    EventBus.on('DAY_PHASE_BEGAN',     this._onDayBegan,         this)
    // Lich hooks
    EventBus.on('ADVENTURERS_SPAWNED', this._onAdvsSpawned, this)
    EventBus.on('BOSS_LEVELED_UP',     this._onBossLeveledUp, this)
    // Lizardman hooks
    EventBus.on('MINION_PLACED',  this._onMinionPlaced, this)
    EventBus.on('COMBAT_HIT',     this._onCombatHit,    this)
    EventBus.on('ADVENTURER_FLED', this._onAdvFledOrDied, this)
    // Myconid hooks (corpse cleanup when a room gets sold/moved)
    EventBus.on('ROOM_REMOVED',   this._onRoomRemovedMyconid, this)
    // Wraith hooks
    EventBus.on('TRAP_TRIGGERED',           this._onTrapTriggered, this)
    EventBus.on('ADVENTURER_ROOM_CHANGED',  this._onAdvRoomChanged, this)
    EventBus.on('MINION_OBSERVED',          this._onMinionObserved, this)
    // Demon hooks
    EventBus.on('DEMON_SACRIFICE_ARM',     this._armSacrifice,    this)
    EventBus.on('DEMON_SACRIFICE_DISARM',  this._disarmSacrifice, this)
    EventBus.on('DEMON_SACRIFICE_TARGET',  this._fireSacrifice,   this)
    // Lich THE WITHERING — Channel Souls (active day ability)
    this._soulChannelArmed = false
    EventBus.on('LICH_CHANNEL_ARM',    this._armSoulChannel,    this)
    EventBus.on('LICH_CHANNEL_DISARM', this._disarmSoulChannel, this)
    EventBus.on('LICH_CHANNEL_TARGET', this._fireSoulChannel,   this)
    // Slime MITOSIS SURGE (active day ability)
    this._surgeArmed = false
    EventBus.on('SLIME_SURGE_ARM',    this._armSurge,    this)
    EventBus.on('SLIME_SURGE_DISARM', this._disarmSurge, this)
    EventBus.on('SLIME_SURGE_TARGET', this._fireSurge,   this)
    if (this._archId() === 'slime') {
      const bLv = this._gameState?.boss?.level ?? 1
      const uses = (Balance.SLIME_SURGE_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.SLIME_SURGE_USES_PER_BOSS_LV ?? 0.25))
      if (this._gameState?.boss) this._gameState.boss._slimeSurge ??= { usesLeft: uses }
    }
    // Beholder TYRANT'S GAZE (active day ability)
    this._gazeArmed = false
    EventBus.on('BEHOLDER_GAZE_ARM',    this._armGaze,    this)
    EventBus.on('BEHOLDER_GAZE_DISARM', this._disarmGaze, this)
    EventBus.on('BEHOLDER_GAZE_TARGET', this._fireGaze,   this)
    if (this._archId() === 'beholder') {
      const bLv = this._gameState?.boss?.level ?? 1
      const uses = (Balance.BEHOLDER_GAZE_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.BEHOLDER_GAZE_USES_PER_BOSS_LV ?? 0.25))
      if (this._gameState?.boss) this._gameState.boss._beholderGaze ??= { usesLeft: uses }
    }
    // Orc TROPHY THROW (active day ability)
    this._throwArmed = false
    EventBus.on('ORC_TROPHY_THROW_ARM',    this._armThrow,    this)
    EventBus.on('ORC_TROPHY_THROW_DISARM', this._disarmThrow, this)
    EventBus.on('ORC_TROPHY_THROW_TARGET', this._fireThrow,   this)
    if (this._archId() === 'orc') {
      const bLv = this._gameState?.boss?.level ?? 1
      const uses = (Balance.ORC_THROW_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.ORC_THROW_USES_PER_BOSS_LV ?? 0.25))
      if (this._gameState?.boss) this._gameState.boss._orcThrow ??= { usesLeft: uses }
    }
    // Myconid THE BLOOM — Biomass economy + SEED THE BLOOM (active day ability)
    this._seedArmed = false
    EventBus.on('MYCONID_SEED_ARM',    this._armSeed,    this)
    EventBus.on('MYCONID_SEED_DISARM', this._disarmSeed, this)
    EventBus.on('MYCONID_SEED_TARGET', this._fireSeed,   this)
    // Lizardman THE PLAGUE-BEARER — Virulence economy + PLAGUE SPIT (day active)
    this._spitArmed = false
    EventBus.on('LIZARD_SPIT_ARM',    this._armSpit,    this)
    EventBus.on('LIZARD_SPIT_DISARM', this._disarmSpit, this)
    EventBus.on('LIZARD_SPIT_TARGET', this._fireSpit,   this)
    if (this._archId() === 'lizardman' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.LIZARD_SPIT_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.LIZARD_SPIT_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss.virulence  ??= 0
      this._gameState.boss._lizSpit   ??= { usesLeft: uses }
    }
    // Vampire THE BLOOD SOVEREIGN — banked BLOOD economy + BLOOD RITE (day active)
    this._riteArmed   = false
    this._vampFightTimer = null
    this._riteZones   = []          // [{ roomId, until, lastTickAt, tier }] — Sanguine Pools
    this._bondChainToday = 0        // T4 Blood Bond chain-charm counter (anti-snowball)
    EventBus.on('VAMPIRE_RITE_ARM',    this._armRite,    this)
    EventBus.on('VAMPIRE_RITE_DISARM', this._disarmRite, this)
    EventBus.on('VAMPIRE_RITE_TARGET', this._fireRite,   this)
    if (this._archId() === 'vampire' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.VAMPIRE_RITE_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.VAMPIRE_RITE_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss.blood   ??= 0
      this._gameState.boss._vampRite ??= { usesLeft: uses }
    }
    // Wraith THE DREAD HARVEST — banked DREAD economy + NIGHT TERROR (day active)
    this._terrorArmed    = false
    this._dreadFightTimer = null
    this._terrorZones    = []        // [{ roomId, until, lastTickAt, tier }] — haunted dread zones
    this._dreadAmbientAt = 0         // ambient-fear cadence stamp
    EventBus.on('WRAITH_TERROR_ARM',    this._armTerror,    this)
    EventBus.on('WRAITH_TERROR_DISARM', this._disarmTerror, this)
    EventBus.on('WRAITH_TERROR_TARGET', this._fireTerror,   this)
    if (this._archId() === 'wraith' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.WRAITH_TERROR_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.WRAITH_TERROR_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss.dread     ??= 0
      this._gameState.boss._wraithTerror ??= { usesLeft: uses }
    }
    // Gnoll THE BLOOD HUNT — banked FEROCITY economy + SOUND THE HUNT (day active)
    this._huntArmed     = false
    this._huntFightTimer = null
    this._huntMark      = null     // { roomId, until } — active hunt the pack swarms/pursues
    this._gnollFrenzyAt = 0        // frenzy-recompute cadence stamp
    EventBus.on('GNOLL_HUNT_ARM',    this._armHunt,    this)
    EventBus.on('GNOLL_HUNT_DISARM', this._disarmHunt, this)
    EventBus.on('GNOLL_HUNT_TARGET', this._fireHunt,   this)
    if (this._archId() === 'gnoll' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.GNOLL_HUNT_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.GNOLL_HUNT_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss.ferocity   ??= 0
      this._gameState.boss._gnollHunt ??= { usesLeft: uses }
    }
    // Succubus THE RAPTURE — banked ALLURE economy + KISS OF RAPTURE (day active)
    this._kissArmed      = false
    this._raptureFightTimer = null
    this._allureTrickleAt = 0      // passive-allure cadence stamp
    this._entranceAt     = 0       // Entrancing Aura (T2) cadence stamp
    this._rapturePulseAt = 0       // The Rapture (T4) dungeon-wide pulse stamp
    EventBus.on('SUCCUBUS_KISS_ARM',    this._armKiss,    this)
    EventBus.on('SUCCUBUS_KISS_DISARM', this._disarmKiss, this)
    EventBus.on('SUCCUBUS_KISS_TARGET', this._fireKiss,   this)
    if (this._archId() === 'succubus' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.SUCCUBUS_KISS_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.SUCCUBUS_KISS_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss.allure    ??= 0
      this._gameState.boss._succubusKiss ??= { usesLeft: uses }
    }
    if (this._archId() === 'myconid' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.MYCONID_SEED_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.MYCONID_SEED_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss.biomass      ??= 0
      this._gameState.boss.bloomedRooms ??= []
      this._gameState.boss._myconidSeed ??= { usesLeft: uses }
    }

    // Backfill Living Architecture for the rooms already placed at scene
    // boot (boss chamber, plus any rooms restored from a save).
    this._initLivingArchitecture()
    // Restore the daily anti-magic aura overlay if the day started before
    // this scene mounted (e.g. save loaded mid-day).
    this._renderAntiMagicAura()
    // Lich: re-fire the phylactery unlock toast on save load if the player
    // hit lvl 3 in a previous session and never saw the notice.
    this._maybeShowPhylacteryUnlockToast()
    // Demon: re-render the Hellgate portal in the boss room corner if a
    // save was loaded mid-run.
    this._renderHellgatePortal()
    // Demon: ensure daily-uses counter + Brimstone bank exist.
    if (this._archId() === 'demon') {
      const bossLv = this._gameState?.boss?.level ?? 1
      const dailyUses = (Balance.DEMON_PACT_USES_PER_DAY ?? 1)
        + Math.floor(bossLv * (Balance.DEMON_PACT_USES_PER_BOSS_LV ?? 0.25))
      this._gameState._demon ??= { sacrificeUsesLeft: dailyUses }
      if (this._gameState?.boss) this._gameState.boss.brimstone ??= 0
    }
    // Orc: capture pristine baselines for every existing orc on save-load /
    // scene boot. Without this, _tickOrc would treat the post-buff stats as
    // the baseline and Warband would compound. Skipped if a baseline is
    // already stamped (so reload mid-day keeps the pristine value).
    if (this._archId() === 'orc') {
      for (const m of (this._gameState?.minions ?? [])) {
        if (!this._isOrcMinion(m)) continue
        if (m._orcBaseAttack != null) continue
        this._captureOrcBaseline(m)
      }
    }
  }

  destroy() {
    EventBus.off('ADVENTURER_DIED',    this._onAdvDied,        this)
    EventBus.off('MINION_DIED',        this._onMinionDied,     this)
    EventBus.off('ROOM_PLACED',        this._onRoomPlaced,     this)
    EventBus.off('ROOM_REMOVED',       this._onRoomRemoved,    this)
    EventBus.off('NIGHT_PHASE_STARTED', this._onNightStart,    this)
    EventBus.off('GOLEM_EARTHQUAKE_ARM',     this._armEarthquake,    this)
    EventBus.off('GOLEM_EARTHQUAKE_DISARM',  this._disarmEarthquake, this)
    EventBus.off('GOLEM_EARTHQUAKE_TARGET',  this._fireEarthquake,   this)
    EventBus.off('BOSS_FIGHT_STARTED',  this._onBossFightStarted, this)
    EventBus.off('BOSS_FIGHT_RESOLVED', this._onBossFightResolved, this)
    EventBus.off('DAY_PHASE_BEGAN',     this._onDayBegan,         this)
    EventBus.off('ADVENTURERS_SPAWNED', this._onAdvsSpawned,    this)
    EventBus.off('BOSS_LEVELED_UP',     this._onBossLeveledUp,  this)
    EventBus.off('MINION_PLACED',       this._onMinionPlaced,   this)
    EventBus.off('COMBAT_HIT',          this._onCombatHit,      this)
    EventBus.off('ADVENTURER_FLED',     this._onAdvFledOrDied,  this)
    EventBus.off('ROOM_REMOVED',        this._onRoomRemovedMyconid, this)
    EventBus.off('TRAP_TRIGGERED',           this._onTrapTriggered,  this)
    EventBus.off('ADVENTURER_ROOM_CHANGED',  this._onAdvRoomChanged, this)
    EventBus.off('MINION_OBSERVED',          this._onMinionObserved, this)
    EventBus.off('DEMON_SACRIFICE_ARM',     this._armSacrifice,    this)
    EventBus.off('DEMON_SACRIFICE_DISARM',  this._disarmSacrifice, this)
    EventBus.off('DEMON_SACRIFICE_TARGET',  this._fireSacrifice,   this)
    EventBus.off('LICH_CHANNEL_ARM',    this._armSoulChannel,    this)
    EventBus.off('LICH_CHANNEL_DISARM', this._disarmSoulChannel, this)
    EventBus.off('LICH_CHANNEL_TARGET', this._fireSoulChannel,   this)
    EventBus.off('SLIME_SURGE_ARM',    this._armSurge,    this)
    EventBus.off('SLIME_SURGE_DISARM', this._disarmSurge, this)
    EventBus.off('SLIME_SURGE_TARGET', this._fireSurge,   this)
    EventBus.off('BEHOLDER_GAZE_ARM',    this._armGaze,    this)
    EventBus.off('BEHOLDER_GAZE_DISARM', this._disarmGaze, this)
    EventBus.off('BEHOLDER_GAZE_TARGET', this._fireGaze,   this)
    EventBus.off('ORC_TROPHY_THROW_ARM',    this._armThrow,    this)
    EventBus.off('ORC_TROPHY_THROW_DISARM', this._disarmThrow, this)
    EventBus.off('ORC_TROPHY_THROW_TARGET', this._fireThrow,   this)
    EventBus.off('MYCONID_SEED_ARM',    this._armSeed,    this)
    EventBus.off('MYCONID_SEED_DISARM', this._disarmSeed, this)
    EventBus.off('MYCONID_SEED_TARGET', this._fireSeed,   this)
    EventBus.off('LIZARD_SPIT_ARM',    this._armSpit,    this)
    EventBus.off('LIZARD_SPIT_DISARM', this._disarmSpit, this)
    EventBus.off('LIZARD_SPIT_TARGET', this._fireSpit,   this)
    EventBus.off('VAMPIRE_RITE_ARM',    this._armRite,    this)
    EventBus.off('VAMPIRE_RITE_DISARM', this._disarmRite, this)
    EventBus.off('VAMPIRE_RITE_TARGET', this._fireRite,   this)
    EventBus.off('WRAITH_TERROR_ARM',    this._armTerror,    this)
    EventBus.off('WRAITH_TERROR_DISARM', this._disarmTerror, this)
    EventBus.off('WRAITH_TERROR_TARGET', this._fireTerror,   this)
    EventBus.off('GNOLL_HUNT_ARM',    this._armHunt,    this)
    EventBus.off('GNOLL_HUNT_DISARM', this._disarmHunt, this)
    EventBus.off('GNOLL_HUNT_TARGET', this._fireHunt,   this)
    EventBus.off('SUCCUBUS_KISS_ARM',    this._armKiss,    this)
    EventBus.off('SUCCUBUS_KISS_DISARM', this._disarmKiss, this)
    EventBus.off('SUCCUBUS_KISS_TARGET', this._fireKiss,   this)
    this._hellgateFx?.destroy?.()
    this._hellgateFx = null
    this._clearSporeFx()
    this._clearSoulOrbit()
    this._stopPetrifyTimer()
    this._stopBloomFightTimer()
    this._stopBrimstoneFightTimer()
    this._stopFortressFightTimer()
    this._stopPlagueFightTimer()
    this._stopBloodFightTimer()
    this._stopDreadFightTimer()
    this._stopHuntFightTimer()
    this._stopRaptureFightTimer()
    this._petrifyFxGraphics?.destroy?.()
    this._petrifyFxGraphics = null
    this._antiMagicFx?.destroy?.()
    this._antiMagicFx = null
  }

  _archId() {
    return this._gameState?.player?.bossArchetypeId ?? null
  }

  _findMinion(instanceId) {
    if (!instanceId || instanceId === 'boss' || instanceId === 'unknown') return null
    return this._gameState?.minions?.find(m => m.instanceId === instanceId) ?? null
  }

  // ── ORC: Loot the Fallen ────────────────────────────────────────────────

  _onAdvDied(payload) {
    // ORC: Loot the Fallen (per-orc kill counter). Just bumps the bonus
    // counter — the live `stats.attack` value is recomputed each frame in
    // `_tickOrc` from `_orcBaseAttack + lootAtkBonus`, then multiplied by
    // the Warband cluster bonus.
    if (this._archId() === 'orc') {
      const killer = this._findMinion(payload?.killerId)
      if (killer && Array.isArray(killer.tags) && killer.tags.includes(MINION_TAG_ORC)) {
        killer.lootAtkBonus = (killer.lootAtkBonus ?? 0) + 1
        EventBus.emit('LOOT_THE_FALLEN_TICK', {
          minionId: killer.instanceId,
          newBonus: killer.lootAtkBonus,
        })
      }
      // TROPHY HUNTER — claim/empower a trophy from the slain hero's class.
      this._claimTrophy(payload?.adventurer)
    }
    // LICH: THE WITHERING — Soul Harvest. Every death anywhere in the dungeon
    // banks Soul Essence on the boss (the run-long resource). Necromancy is CUT
    // (no raises). The banked essence is the Lich's lifeline (regen), the ammo
    // for the day-phase CHANNEL SOULS ability, and its throne-fight reserve.
    if (this._archId() === 'lich') {
      this._harvestSoul(payload?.adventurer)
    }
    // DEMON: THE BRIMSTONE PACT — every adventurer death anywhere banks Infernal
    // Power (the engine). T3 Soul Harvest doubles the take (the snowball).
    if (this._archId() === 'demon') {
      this._bankBrimstoneFromDeath(payload?.adventurer)
    }
    // LIZARDMAN: THE PLAGUE-BEARER — an INFECTED adventurer's death banks Virulence
    // (the strain proves itself) + (T4 Pandemic) bursts to infect nearby heroes.
    if (this._archId() === 'lizardman') {
      this._onPlaguedDeath(payload?.adventurer)
    }
    // VAMPIRE: THE BLOOD SOVEREIGN — every hero death anywhere feeds the BLOOD pool
    // (level-scaled). Charm-conversions emit ADVENTURER_DIED too, so turning a hero
    // into a thrall also feeds the bank.
    if (this._archId() === 'vampire') {
      const dead = payload?.adventurer
      if (dead) this._bankBlood((Balance.VAMPIRE_BLOOD_PER_KILL ?? 8)
        + (dead.level ?? 1) * (Balance.VAMPIRE_BLOOD_PER_KILL_PER_LV ?? 0.6), dead.worldX, dead.worldY)
    }
    // WRAITH: Fear bump for any adv who watched a same-party member die,
    // plus Haunting ghost spawn at the death tile.
    if (this._archId() === 'wraith') {
      const dead = payload?.adventurer
      if (dead) {
        this._spawnHauntGhost(dead, payload?.roomId ?? null)
        const advs = this._gameState?.adventurers?.active ?? []
        for (const a of advs) {
          if (!a || a === dead) continue
          if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
          if (a.partyId && a.partyId !== dead.partyId) continue
          // "In front of them" — same room as the death OR within 5 tiles.
          const sameRoom = !!payload?.roomId &&
            this._scene?.dungeonGrid?.getRoomAtTile?.(a.tileX, a.tileY)?.instanceId === payload.roomId
          const close = (Math.abs(a.tileX - dead.tileX) + Math.abs(a.tileY - dead.tileY)) <= 5
          if (sameRoom || close) {
            this._addFear(a, Balance.WRAITH_FEAR_PER_ALLY_DIED_NEAR)
          }
        }
      }
    }
    // GNOLL: Bloodlust — every minion or boss kill on an adv stacks +3%
    // ATK on every alive gnoll-tagged minion for the rest of the day.
    if (this._archId() === 'gnoll') {
      const killerId = payload?.killerId
      const isMinionOrBoss =
        killerId && killerId !== 'unknown' && killerId !== 'venom' &&
        killerId !== 'spores' && killerId !== 'fear' &&
        (killerId === 'boss' || !!this._findMinion(killerId))
      if (isMinionOrBoss) {
        this._applyBloodlustStack()
      }
      // THE BLOOD HUNT — every hero death feeds FEROCITY (level-scaled); T4 The
      // Great Hunt amplifies the take (the pack is whipped into a killing frenzy).
      const dead = payload?.adventurer
      if (dead) {
        const t4 = currentAct(this._gameState) >= 4 ? (Balance.GNOLL_GREAT_HUNT_FEROCITY_MULT ?? 1.5) : 1
        this._bankFerocity(((Balance.GNOLL_FEROCITY_PER_KILL ?? 7) + (dead.level ?? 1) * (Balance.GNOLL_FEROCITY_PER_KILL_PER_LV ?? 0.6)) * t4)
      }
    }
    // SUCCUBUS: THE RAPTURE — every hero death feeds ALLURE (level-scaled).
    if (this._archId() === 'succubus') {
      const dead = payload?.adventurer
      if (dead) this._bankAllure((Balance.SUCCUBUS_ALLURE_PER_KILL ?? 6) + (dead.level ?? 1) * (Balance.SUCCUBUS_ALLURE_PER_KILL_PER_LV ?? 0.5))
    }
    // MYCONID: Corpse Bloom — drop a 3-day fungal corpse at the death tile.
    if (this._archId() === 'myconid') {
      const adv = payload?.adventurer
      if (adv && typeof adv.tileX === 'number' && typeof adv.tileY === 'number') {
        const room = this._scene?.dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)
        // THE BLOOM — every death feeds Biomass (level-scaled) and a corpse
        // AUTO-BLOOMS its room (the colony reclaims the fallen). Done before the
        // corpse-cap gate so the colony grows even when corpses are capped.
        const boss = this._gameState?.boss
        if (boss) {
          boss.biomass = (boss.biomass ?? 0)
            + (Balance.MYCONID_BIOMASS_PER_DEATH ?? 6)
            + (adv.level ?? 1) * (Balance.MYCONID_BIOMASS_PER_DEATH_PER_LV ?? 0.5)
          if (room) this._bloomRoom(room.instanceId)
        }
        this._gameState.fungalCorpses ??= []
        // Hard cap on simultaneous corpses — without it Myconid snowballs:
        // every adv kill is both gold AND a permanent venom tile AND a free
        // future minion. Skip new corpses once the cap is full; a slot opens
        // up when an existing corpse expires/sprouts or its room is moved.
        if (this._gameState.fungalCorpses.length >= Balance.MYCONID_CORPSE_MAX_ACTIVE) {
          EventBus.emit('MYCONID_CORPSE_CAPPED', {
            advId: adv.instanceId ?? null,
            cap:   Balance.MYCONID_CORPSE_MAX_ACTIVE,
          })
          return
        }
        // Capture the LPC sprite-sheet info so FungalCorpseRenderer can paint
        // the actual last frame of the adv's hurt animation tinted green
        // instead of the generic skull stand-in. spriteVariant is "<class>/<vNN>".
        const variantKey = adv.spriteVariant
          ? `adv-${adv.spriteVariant.replace('/', '-')}`
          : null
        let lastHurtFrame = null
        if (variantKey) {
          const animKey = `${variantKey}-hurt-down`
          const anim    = this._scene?.anims?.get?.(animKey)
          const frames  = anim?.frames
          if (Array.isArray(frames) && frames.length > 0) {
            const f = frames[frames.length - 1]
            // Phaser stores the spritesheet index on `frame.name`.
            lastHurtFrame = f?.frame?.name ?? null
          }
        }
        this._gameState.fungalCorpses.push({
          instanceId:    `fcor_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          // Track the source adv so the sprout can despawn the dead body
          // sprite that AdventurerRenderer leaves frozen on the death tile.
          advId:         adv.instanceId ?? null,
          tileX:         adv.tileX,
          tileY:         adv.tileY,
          roomId:        room?.instanceId ?? null,
          daysRemaining: Balance.MYCONID_CORPSE_LIFESPAN_DAYS,
          classId:       adv.classId ?? 'unknown',
          name:          adv.name    ?? 'Corpse',
          // Sprite-capture for the green-tinted corpse glyph.
          textureKey:    variantKey,
          lastHurtFrame,
        })
      }
    }
  }

  _onMinionDied(payload) {
    const m = payload?.minion
    if (!m) return

    // Slime King — Absorb & Excrete. Runs BEFORE the orc handler bails on
    // non-orc minions so it can fire for any of the player's dungeon
    // minions (which are obviously not orc-tagged).
    if (this._archId() === 'slime') {
      this._onSlimeMinionDied(m)
      // T4 — THE TIDE: a slain goopling near a high-Mass King respawns (the horde
      // self-heals). Capped by the goopling cap so it can't runaway.
      if (m._isGoopling && currentAct(this._gameState) >= 4 &&
          (this._gameState.boss?.slimeMass ?? 0) >= 20 &&
          this._countGooplings() < this._slimeBudCap() &&
          Math.random() < (Balance.SLIME_FIGHT_TIDE_CHANCE ?? 0.5)) {
        const boss = this._gameState.boss
        const bx = Number.isFinite(boss?.tileX) ? boss.tileX : m.tileX
        const by = Number.isFinite(boss?.tileY) ? boss.tileY : m.tileY
        if (Number.isFinite(bx)) { const [tx, ty] = this._walkableNear(bx, by); this._spawnGoopling(tx, ty, m.assignedRoomId ?? null) }
      }
      // No early-return — we still let downstream orc/etc. handlers run
      // in case a future archetype layer wants to react to the same death.
    }

    // DEMON: Volatile Legion (T2) — a Hellgate imp killed by a hero EXPLODES
    // in hellfire on its slayer. (Sacrifice-burned imps don't explode.)
    if (this._archId() === 'demon') {
      this._onDemonMinionDied(m, payload?.killerId)
    }

    // VAMPIRE: Blood Bond (T4) — a slain thrall ERUPTS in a blood nova (%maxHP
    // to nearby heroes, banked) and charms one of them into a new thrall, so the
    // Court replenishes itself. Capped per day to stop a runaway chain.
    if (this._archId() === 'vampire' && m._isVampireThrall) {
      this._onThrallDied(m)
    }

    if (!Array.isArray(m.tags) || !m.tags.includes(MINION_TAG_ORC)) return
    // Loot the Fallen now writes only `lootAtkBonus` (Warband owns the
    // live stats.attack recompute). Just zero the counter on death; the
    // next `_tickOrc` will see the missing orc and rebalance the cluster.
    m.lootAtkBonus = 0
  }

  // ── SLIME KING: Absorb & Excrete ──────────────────────────────────────
  //
  // Every player-side minion that dies in the dungeon gets swallowed by
  // the King — it disappears from the minion roster entirely (no respawn
  // at next dawn) and the King excretes a Goopling in his boss room. The
  // Goopling is a runtime CLONE of a random existing slime minion type
  // (slime1..slime9 + elder_slime1..3) — same sprite, same stats, same
  // abilities — tagged `_isGoopling = true` so it stays a one-shot life
  // (MinionAISystem.respawnAll skips it just like Hellgate imps).
  //
  // Spawn anchor is the boss room; we set the Goopling's `assignedRoomId`
  // to the original minion's home room so the patrol AI naturally
  // pathfinds it back toward where it came from. Adventurers it meets en
  // route trigger the standard chase/attack behaviour (no special-casing
  // needed — MinionAISystem already handles that).
  //
  // Exclusions match the user spec:
  //   • Mini-slime (Slime Split mini-spawns)        — would feedback-loop
  //   • Gooplings themselves                         — would feedback-loop
  //   • Other one-shot specials (Imp / Vinekin /
  //     Haunt Ghost / HoT spawn / Throne mini-boss
  //     / Mercenary)                                  — own death rules
  //   • Sacrificed / burnt minions                  — player chose this
  //   • Adventurer-faction minions (raises / tames) — not "yours"
  _onSlimeMinionDied(deadMinion) {
    if (this._shouldSkipSlimeAbsorb(deadMinion)) return
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    const minionDefs = this._scene.cache.json.get('minionTypes') ?? []

    // Level-gated tier pool — T1 (boss lv 1-4), T2 (5-8), T3 (9+).
    const bossLv = this._gameState?.boss?.level ?? 1
    const tieredPool = _gooplingPoolForBossLevel(bossLv)
    const pool = tieredPool.filter(id => minionDefs.some(d => d.id === id))
    if (pool.length === 0) return
    const pickId = pool[Math.floor(Math.random() * pool.length)]
    const def    = minionDefs.find(d => d.id === pickId)
    if (!def) return

    // Goopling literally pops OUT OF the boss — anchor the spawn at the
    // boss's live tile and search outward for the first walkable tile.
    // Boss world coords come from BossSystem (boss.tileX/tileY); falls
    // back to boss room centre if the boss hasn't been tile-stamped yet
    // (e.g. very early in a brand-new run before the first night tick).
    const grid = this._scene?.dungeonGrid
    const boss = this._gameState?.boss
    const anchorX = (Number.isFinite(boss?.tileX) ? boss.tileX
      : bossRoom.gridX + Math.floor(bossRoom.width / 2))
    const anchorY = (Number.isFinite(boss?.tileY) ? boss.tileY
      : bossRoom.gridY + Math.floor(bossRoom.height / 2))
    let sx = anchorX, sy = anchorY
    // 8-direction adjacent search from the boss's tile. Boss's own tile
    // is checked LAST — gooplings prefer to step out so the boss sprite
    // isn't obscured.
    const offsets = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [0, 0],
    ]
    for (const [ox, oy] of offsets) {
      const tx = anchorX + ox, ty = anchorY + oy
      const t = grid?.getTileType?.(tx, ty)
      if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) {
        const occupied = (this._gameState.minions ?? []).some(mm =>
          mm.aiState !== 'dead' && (mm.resources?.hp ?? 0) > 0 &&
          mm.tileX === tx && mm.tileY === ty)
        if (!occupied) { sx = tx; sy = ty; break }
      }
    }

    // The Goopling's "home" is the room the absorbed minion was assigned
    // to. The patrol AI uses assignedRoomId to pick wander targets and
    // pathfind; dropping the goopling in the boss room with assignedRoomId
    // pointing elsewhere makes it walk there on its own.
    const homeRoomId = deadMinion.assignedRoomId ?? null

    // Apply the boss's current scaling like any night-placed minion would
    // get. The 4th option is the standard 'garrison' class — matches how
    // Demon Hellgate imps are constructed. `bossLv` already captured for
    // tier-pool selection above; reuse it.
    const goopling = createMinion(def, { x: sx, y: sy }, homeRoomId, { class: 'garrison' })
    applyBossLevelToMinion(goopling, bossLv)
    goopling._isGoopling      = true
    goopling._gooplingHomeId  = homeRoomId
    goopling._gooplingOrigin  = deadMinion.id
    // Mirror Hellgate-imp style stamping for the patrol picker's home tile.
    const homeRoom = homeRoomId
      ? (this._gameState.dungeon.rooms ?? []).find(r => r.instanceId === homeRoomId)
      : null
    goopling.homeTileX = homeRoom
      ? homeRoom.gridX + Math.floor(homeRoom.width  / 2)
      : sx
    goopling.homeTileY = homeRoom
      ? homeRoom.gridY + Math.floor(homeRoom.height / 2)
      : sy

    this._gameState.minions.push(goopling)
    EventBus.emit('MINION_PLACED', { minion: goopling })

    // Splice the absorbed minion out of the roster entirely so it can't
    // respawn at dawn. (MinionAISystem.respawnAll's filters are all "this
    // dead minion stays dead but stays in the array" — for Absorb the
    // entity LITERALLY isn't there anymore.)
    const minions = this._gameState.minions
    const idx = minions.indexOf(deadMinion)
    if (idx >= 0) minions.splice(idx, 1)

    // +2 to the boss's max HP per absorption. Current HP also bumps so
    // the boss isn't sitting at a lower fraction post-absorb (purely a
    // small permanent buff, not a heal-and-cap interaction). `boss`
    // already captured above for tile-anchor calculation — reuse it.
    if (boss) {
      boss.maxHp = (boss.maxHp ?? 0) + 2
      boss.hp    = Math.min(boss.maxHp, (boss.hp ?? 0) + 2)
      // MITOSIS overhaul — absorbing swells the King's Mass (drives body size,
      // aura intensity, and how big a horde it splits into in the throne fight).
      boss.slimeMass = (boss.slimeMass ?? 0) + (Balance.SLIME_MASS_PER_ABSORB ?? 2)
    }

    EventBus.emit('SLIME_ABSORBED', {
      victimId:    deadMinion.instanceId,
      gooplingId:  goopling.instanceId,
      gooplingDef: pickId,
      homeRoomId,
    })

    // ── VFX: absorb + excrete ────────────────────────────────────────
    // Three-part animation reads as "minion dissolves → boss squeezes →
    // goopling lands":
    //   1. At the death tile: green particle burst + ring + "ABSORBED".
    //   2. At the boss: one-shot "Slime excretion" overlay sprite —
    //      9-frame Craftpix animation that visually shows the boss
    //      birthing a goop blob. Played as a temporary sprite on top
    //      of the boss; destroyed on animation complete so it doesn't
    //      interfere with the boss's own state machine.
    //   3. After a beat: lighter-green burst + ring + "+ GOOPLING" at
    //      the Goopling's tile.
    const deathX = (deadMinion.worldX ?? deadMinion.tileX * 32 + 16)
    const deathY = (deadMinion.worldY ?? deadMinion.tileY * 32 + 16)
    const goopX  = goopling.worldX
    const goopY  = goopling.worldY
    const GREEN  = 0x55cc77
    const LIGHT_GREEN = 0x88ee99
    AbilityVfx.particleBurst(this._scene, deathX, deathY, {
      color: GREEN, count: 14, durationMs: 600, speed: 70, depth: 60,
    })
    AbilityVfx.pulseRing(this._scene, deathX, deathY, {
      color: GREEN, fromR: 4, toR: 38, alpha: 0.85, durationMs: 500, depth: 59,
    })
    AbilityVfx.floatingText(this._scene, deathX, deathY - 14, 'ABSORBED', {
      color: '#aaffbb', fontSize: '11px', durationMs: 900, driftY: -28, depth: 70,
    })
    // Boss spawn animation overlay — only fires if the texture loaded
    // (Preload registers `slime-spawn-sheet`). Centred on the boss's
    // live world position; runs once at the same scale as the boss
    // sprite, then destroys itself.
    this._playSlimeSpawnAnim()
    // Excretion burst comes ~250ms later so the eye can register the
    // distinct moments (death → spawn) instead of one flash.
    this._scene.time?.delayedCall?.(250, () => {
      if (!Number.isFinite(goopX) || !Number.isFinite(goopY)) return
      AbilityVfx.particleBurst(this._scene, goopX, goopY, {
        color: LIGHT_GREEN, count: 16, durationMs: 600, speed: 75, depth: 60,
      })
      AbilityVfx.pulseRing(this._scene, goopX, goopY, {
        color: LIGHT_GREEN, fromR: 4, toR: 30, alpha: 0.85, durationMs: 480, depth: 59,
      })
      AbilityVfx.floatingText(this._scene, goopX, goopY - 14, '+ GOOPLING', {
        color: '#bbffcc', fontSize: '11px', durationMs: 900, driftY: -28, depth: 70,
      })
    })
  }

  // Plays the slime-spawn overlay sprite on the boss. Lazy-creates the
  // animation on first call (avoids touching Phaser anim cache in
  // ctor before Preload has finished). Destroys itself on complete so
  // a rapid sequence of absorptions can stack overlays without leaking.
  _playSlimeSpawnAnim() {
    const scene = this._scene
    const boss  = this._gameState?.boss
    if (!scene || !boss) return
    if (!Number.isFinite(boss.worldX) || !Number.isFinite(boss.worldY)) return
    if (!scene.textures?.exists?.('slime-spawn-sheet')) return

    // Lazy anim registration. Frames 0..8 = first row of the 4-row sheet.
    // 18fps gives ~500ms total duration — long enough to read, short
    // enough that rapid absorptions don't overlap awkwardly.
    if (!scene.anims.exists('slime-spawn-anim')) {
      scene.anims.create({
        key: 'slime-spawn-anim',
        frames: scene.anims.generateFrameNumbers('slime-spawn-sheet', { start: 0, end: 8 }),
        frameRate: 18,
        repeat: 0,
      })
    }
    // Match the boss sprite scale so the overlay sits proportionally
    // over it. Boss sprite scale lives on the renderer; sample
    // conservatively (BossRenderer applies BOSS_SPRITE_SCALE = ~2.0 to
    // 128px sheets — same default here).
    const overlay = scene.add.sprite(boss.worldX, boss.worldY, 'slime-spawn-sheet', 0)
      .setOrigin(0.5, 0.55)        // slightly biased down so feet land near boss feet
      .setScale(2.0)
      .setDepth(65)                 // above particle burst (60), below floaters (70)
    if (overlay.texture?.setFilter) {
      overlay.texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    overlay.play('slime-spawn-anim')
    overlay.once('animationcomplete', () => overlay.destroy())
    // Safety: if the anim somehow never completes (scene torn down, etc.)
    // GC the sprite after ~1.5s anyway.
    scene.time?.delayedCall?.(1500, () => {
      if (overlay.active) overlay.destroy()
    })
  }

  _shouldSkipSlimeAbsorb(m) {
    if (!m) return true
    if (m.faction !== 'dungeon') return true              // only player minions
    if (m._isGoopling)    return true                     // anti-feedback-loop
    if (m._isMiniSlime)   return true                     // Slime Split babies
    if (m._isSummonedAdd) return true                     // Bone Totem adds — anti-feedback
    if (m._isMitosisAdd)  return true                     // boss-spawned adds — would feed boss its own splits
    if (m.isBossAdd)      return true                     // generic boss-fight adds
    if (m._isDemonImp)    return true
    if (m._myconidSprout) return true
    if (m._isHauntGhost)  return true
    if (m.isHallOfTrialsSpawn) return true
    if (m.isThroneMiniBoss)    return true
    if (m._mercenary)     return true
    if (m._sacrificed || m._burnt) return true            // deliberate destruction
    return false
  }

  // ══ SLIME KING — MITOSIS / THE UNKILLABLE HORDE (day-phase) ══════════════
  // Mass swells from absorbing + time-budding → drives body size, aura, and the
  // throne-fight horde. Dungeon kit: Bud(T1)/Coalesce(T2)/Acidic Trail(T3)/Tide(T4).

  _slimeMassCap() {
    const lvl = this._gameState?.boss?.level ?? 1
    return (Balance.SLIME_MASS_CAP_BASE ?? 40)
      + currentAct(this._gameState) * (Balance.SLIME_MASS_CAP_PER_ACT ?? 40)
      + lvl * (Balance.SLIME_MASS_CAP_PER_LEVEL ?? 6)
  }

  _slimeBudCap() {
    return (Balance.SLIME_BUD_MAX_ACTIVE ?? 4) + currentAct(this._gameState) * (Balance.SLIME_BUD_MAX_PER_ACT ?? 2)
  }

  _countGooplings() {
    return (this._gameState?.minions ?? []).filter(m => m._isGoopling && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0).length
  }

  _gooplingDefForLevel() {
    const defs = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const pool = _gooplingPoolForBossLevel(this._gameState?.boss?.level ?? 1).filter(id => defs.some(d => d.id === id))
    return pool.length ? defs.find(d => d.id === pool[Math.floor(Math.random() * pool.length)]) : null
  }

  // First walkable tile at/around (ax,ay) not already occupied by a live minion.
  _walkableNear(ax, ay) {
    const grid = this._scene?.dungeonGrid
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 0]]) {
      const tx = ax + ox, ty = ay + oy, t = grid?.getTileType?.(tx, ty)
      if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) {
        const occ = (this._gameState.minions ?? []).some(m => m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 && m.tileX === tx && m.tileY === ty)
        if (!occ) return [tx, ty]
      }
    }
    return [ax, ay]
  }

  _spawnGoopling(tileX, tileY, homeRoomId) {
    const def = this._gooplingDefForLevel()
    if (!def) return null
    const bossLv = this._gameState?.boss?.level ?? 1
    const g = createMinion(def, { x: tileX, y: tileY }, homeRoomId, { class: 'garrison' })
    applyBossLevelToMinion(g, bossLv)
    g._isGoopling = true
    g._gooplingHomeId = homeRoomId
    this._gameState.minions.push(g)
    EventBus.emit('MINION_PLACED', { minion: g })
    if (Number.isFinite(g.worldX)) AbilityVfx?.slimeSplitFx?.(this._scene, g.worldX, g.worldY, { small: true })
    return g
  }

  _tickSlimeDay(delta) {
    if (this._archId() !== 'slime') return
    const boss = this._gameState?.boss
    if (!boss || this._bossFightActive) return
    if ((this._gameState?.meta?.phase ?? '') !== 'day') return
    const now = this._scene?.time?.now ?? 0
    const tier = currentAct(this._gameState)
    // T1 — Budding: a free goopling + Mass on cadence, capped.
    if (now - (this._slimeBudAt ?? 0) >= (Balance.SLIME_BUD_INTERVAL_MS ?? 9000)) {
      this._slimeBudAt = now
      if (this._countGooplings() < this._slimeBudCap() && Number.isFinite(boss.tileX)) {
        const rooms = (this._gameState.dungeon?.rooms ?? []).filter(r => r.definitionId !== 'boss_chamber')
        const home = rooms.length ? rooms[Math.floor(Math.random() * rooms.length)].instanceId : null
        const [tx, ty] = this._walkableNear(boss.tileX, boss.tileY)
        if (this._spawnGoopling(tx, ty, home)) boss.slimeMass = (boss.slimeMass ?? 0) + (Balance.SLIME_MASS_PER_BUD ?? 1)
      }
    }
    if (tier >= 2) this._tickCoalesce(now)
    if (tier >= 3) this._tickAcidTrail(now)
  }

  // T2 — Coalesce: two adjacent gooplings merge into one bigger blob (gradual,
  // one merge per cadence). The survivor gains the other's HP/ATK + a merge tier.
  _tickCoalesce(now) {
    if (now - (this._coalesceAt ?? 0) < (Balance.SLIME_COALESCE_MS ?? 5000)) return
    this._coalesceAt = now
    const gs = this._gameState
    const blobs = (gs.minions ?? []).filter(m => m._isGoopling && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0)
    for (let i = 0; i < blobs.length; i++) {
      for (let j = i + 1; j < blobs.length; j++) {
        const a = blobs[i], b = blobs[j]
        if (Math.abs(a.tileX - b.tileX) <= 1 && Math.abs(a.tileY - b.tileY) <= 1) {
          a.stats ??= {}; a.resources ??= {}
          a.resources.maxHp = (a.resources.maxHp ?? 10) + (b.resources?.maxHp ?? 10)
          a.resources.hp    = (a.resources.hp ?? 10) + (b.resources?.hp ?? 10)
          a.stats.attack    = (a.stats?.attack ?? 1) + Math.ceil((b.stats?.attack ?? 1) * 0.5)
          a._mergeTier      = (a._mergeTier ?? 0) + 1
          if (Number.isFinite(a.worldX)) AbilityVfx?.slimeMergeFx?.(this._scene, a.worldX, a.worldY)
          b.resources.hp = 0; b.aiState = 'dead'
          EventBus.emit('MINION_REMOVED', { minion: b })
          const idx = gs.minions.indexOf(b); if (idx >= 0) gs.minions.splice(idx, 1)
          return
        }
      }
    }
  }

  // T3 — Acidic Trail: roaming slimes corrode the tiles they sit on; adventurers
  // crossing a fresh trail tile take acid damage. Trail is transient (rebuilt each
  // tick), so no save handling needed.
  _tickAcidTrail(now) {
    const gs = this._gameState
    this._acidTrail ??= new Map()
    for (const m of (gs.minions ?? [])) {
      if (!m._isGoopling || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      this._acidTrail.set(m.tileX + ',' + m.tileY, now + (Balance.SLIME_TRAIL_LIFESPAN_MS ?? 2600))
    }
    for (const [k, until] of this._acidTrail) if (now > until) this._acidTrail.delete(k)
    if (now - (this._acidDmgAt ?? 0) < (Balance.SLIME_TRAIL_INTERVAL_MS ?? 900)) return
    this._acidDmgAt = now
    const atk = gs.boss?.attack ?? 0
    for (const adv of (gs.adventurers?.active ?? [])) {
      if (!adv || (adv.resources?.hp ?? 0) <= 0) continue
      if (this._acidTrail.has(adv.tileX + ',' + adv.tileY)) {
        const dmg = Math.max(1, Math.floor(atk * (Balance.SLIME_TRAIL_DMG_FRAC ?? 0.2)))
        adv.resources.hp = Math.max(this._shadowFloor(adv), adv.resources.hp - dmg)
        EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: adv.instanceId, damage: dmg, damageType: 'acid' })
        if (Number.isFinite(adv.worldX)) AbilityVfx?.acidPuddleFx?.(this._scene, adv.worldX, adv.worldY, { hit: true })
        if (adv.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: adv, killerId: 'boss', killerName: 'Acidic Trail', roomId: null, damageType: 'acid' })
      }
    }
  }

  // ── MITOSIS SURGE (active day ability) — arm → click a room → flood it ──
  _surgeUsesLeft() { return this._gameState?.boss?._slimeSurge?.usesLeft ?? 0 }
  _surgeAvailable() {
    return this._archId() === 'slime' && (this._gameState?.meta?.phase ?? '') === 'day' && this._surgeUsesLeft() > 0
  }
  _armSurge() { if (!this._surgeAvailable()) return; this._surgeArmed = true; EventBus.emit('SLIME_SURGE_ARMED', {}) }
  _disarmSurge() { this._surgeArmed = false; EventBus.emit('SLIME_SURGE_DISARMED', {}) }

  _fireSurge(payload) {
    if (!this._surgeArmed) return
    if (!this._surgeAvailable()) { this._disarmSurge(); return }
    const boss = this._gameState?.boss
    const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const advsIn = (this._gameState.adventurers?.active ?? []).filter(a => (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, room))
    const mass = boss.slimeMass ?? 0
    let count = Math.round((Balance.SLIME_SURGE_BASE_COUNT ?? 3)
      + advsIn.length * (Balance.SLIME_SURGE_PER_VICTIM ?? 1)
      + mass * (Balance.SLIME_SURGE_PER_MASS ?? 0.08))
    count = Math.max(1, Math.min(Balance.SLIME_SURGE_MAX ?? 12, count))
    const cx = room.gridX + Math.floor(room.width / 2), cy = room.gridY + Math.floor(room.height / 2)
    let spawned = 0
    for (let i = 0; i < count; i++) {
      const rx = room.gridX + 1 + Math.floor(Math.random() * Math.max(1, room.width - 2))
      const ry = room.gridY + 1 + Math.floor(Math.random() * Math.max(1, room.height - 2))
      const [tx, ty] = this._walkableNear(rx, ry)
      if (this._spawnGoopling(tx, ty, room.instanceId)) spawned++
    }
    AbilityVfx?.slimeSurgeFx?.(this._scene, cx * 32 + 16, cy * 32 + 16, { count: spawned })
    // goo wraps the adventurers caught in the surge
    for (const a of advsIn) if (Number.isFinite(a.worldX)) AbilityVfx?.slimeEngulfFx?.(this._scene, a.worldX, a.worldY - 16, { tier: currentAct(this._gameState) })
    if (boss._slimeSurge) boss._slimeSurge.usesLeft = Math.max(0, (boss._slimeSurge.usesLeft ?? 0) - 1)
    this._surgeArmed = false
    EventBus.emit('SLIME_SURGE_FIRED', { roomId: room.instanceId, count: spawned, room })
  }

  // ── TYRANT'S GAZE (active day ability) — arm → click a room → lock it down ──
  // Fixes a great eye on a room and curses every occupant (per-adv, at fire),
  // tier-gated: Silence (T1) → +Slow (T2) → +Petrify (T3) → +Disintegrate
  // damage (T4). Room-wide, so it scales with however many heroes are inside.
  _gazeUsesLeft() { return this._gameState?.boss?._beholderGaze?.usesLeft ?? 0 }
  _gazeAvailable() {
    return this._archId() === 'beholder' && (this._gameState?.meta?.phase ?? '') === 'day' && this._gazeUsesLeft() > 0
  }
  _armGaze() { if (!this._gazeAvailable()) return; this._gazeArmed = true; EventBus.emit('BEHOLDER_GAZE_ARMED', {}) }
  _disarmGaze() { this._gazeArmed = false; EventBus.emit('BEHOLDER_GAZE_DISARMED', {}) }

  _fireGaze(payload) {
    if (!this._gazeArmed) return
    if (!this._gazeAvailable()) { this._disarmGaze(); return }
    const boss = this._gameState?.boss
    const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const tier = currentAct(this._gameState)
    const now  = this._scene?.time?.now ?? 0
    const atk  = boss.attack ?? 0
    const TS   = Balance.TILE_SIZE

    const advsIn = (this._gameState.adventurers?.active ?? [])
      .filter(a => (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, room))

    let victims = 0
    for (const a of advsIn) {
      // T1 — Silence: ability casts blocked (ClassAbilitySystem reads _silencedUntil).
      a._silencedUntil = Math.max(a._silencedUntil ?? 0, now + Balance.BEHOLDER_GAZE_SILENCE_MS)
      EventBus.emit('STATUS_APPLIED', { targetId: a.instanceId, label: 'SILENCED' })
      // T2 — Slow.
      if (tier >= 2) {
        const next = now + Balance.BEHOLDER_GAZE_SLOW_MS
        if (!a._slowUntil || a._slowUntil < next) a._slowUntil = next
        a._slowMult = Math.min(a._slowMult ?? 1, Balance.BEHOLDER_GAZE_SLOW_MULT)
      }
      // T3 — Petrify.
      if (tier >= 3) {
        a._petrifiedUntil = Math.max(a._petrifiedUntil ?? 0, now + Balance.BEHOLDER_GAZE_PETRIFY_MS)
      }
      // T4 — Disintegrate damage.
      if (tier >= 4) {
        const dmg = Math.max(1, Math.floor(atk * Balance.BEHOLDER_GAZE_DMG_FRAC))
        const before = a.resources.hp
        a.resources.hp = Math.max(0, before - dmg)
        const dealt = before - a.resources.hp
        EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dealt, damageType: 'arcane' })
        if (a.resources.hp <= 0) {
          EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'The Eye Tyrant', roomId: room.instanceId, damageType: 'arcane' })
        }
      }
      // Per-adv ray VFX — the dominant ray for this tier hits each occupant.
      const kind = tier >= 4 ? 'disintegrate' : tier >= 3 ? 'petrify' : tier >= 2 ? 'slow' : 'silence'
      if (this._scene && Number.isFinite(a.worldX)) {
        AbilityVfx?.beholderRayFx?.(this._scene, boss.worldX ?? a.worldX, (boss.worldY ?? a.worldY) - 8, {
          toX: a.worldX, toY: (a.worldY ?? 0) - 16, kind, tier,
        })
      }
      victims++
    }

    // Room-sweep eye VFX over the targeted room.
    const cx = (room.gridX + room.width  / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    AbilityVfx?.tyrantGazeSweepFx?.(this._scene, cx, cy, {
      tier, rectW: room.width * TS, rectH: room.height * TS,
    })

    if (boss._beholderGaze) boss._beholderGaze.usesLeft = Math.max(0, (boss._beholderGaze.usesLeft ?? 0) - 1)
    this._gazeArmed = false
    EventBus.emit('BEHOLDER_GAZE_FIRED', { roomId: room.instanceId, room, tier, victims })
  }

  // ── TROPHY THROW (active day ability) — arm → click a room → hurl arsenal ──
  // Hurls one claimed trophy-weapon per type (capped by tier) into a room; each
  // deals its type's effect to every hero inside. Scales with claimed types,
  // empower stacks, room crowd, and act tier.
  _throwUsesLeft() { return this._gameState?.boss?._orcThrow?.usesLeft ?? 0 }
  _throwAvailable() {
    return this._archId() === 'orc' && (this._gameState?.meta?.phase ?? '') === 'day' && this._throwUsesLeft() > 0
  }
  _armThrow() { if (!this._throwAvailable()) return; this._throwArmed = true; EventBus.emit('ORC_TROPHY_THROW_ARMED', {}) }
  _disarmThrow() { this._throwArmed = false; EventBus.emit('ORC_TROPHY_THROW_DISARMED', {}) }

  // Claimed trophy types, strongest (most stacks) first.
  _claimedTrophiesByStacks() {
    const tro = this._gameState?.boss?.trophies ?? {}
    return TROPHY_TYPES
      .filter(t => tro[t.id])
      .map(t => ({ ...t, stacks: tro[t.id].stacks ?? 1 }))
      .sort((a, b) => b.stacks - a.stacks)
  }

  _fireThrow(payload) {
    if (!this._throwArmed) return
    if (!this._throwAvailable()) { this._disarmThrow(); return }
    const boss = this._gameState?.boss
    const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const tier = currentAct(this._gameState)
    const now  = this._scene?.time?.now ?? 0
    const atk  = boss.attack ?? 0
    const TS   = Balance.TILE_SIZE

    const claimed = this._claimedTrophiesByStacks()
    if (claimed.length === 0) {
      // Nothing claimed yet — still consume nothing, just disarm with a nudge.
      this._disarmThrow()
      EventBus.emit('ORC_TROPHY_THROW_FIRED', { roomId: room.instanceId, room, tier, weapons: 0, empty: true })
      return
    }
    const cap = tier >= 4
      ? claimed.length
      : (Balance.ORC_THROW_WEAPONS_T1 ?? 2) + (tier - 1) * (Balance.ORC_THROW_WEAPONS_PER_TIER ?? 1)
    const weapons = claimed.slice(0, Math.max(1, cap))

    const advsIn = (this._gameState.adventurers?.active ?? [])
      .filter(a => (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, room))

    let totalDmg = 0
    for (const wpn of weapons) {
      const stackBonus = 1 + Math.min((wpn.stacks ?? 1) - 1, Balance.ORC_TROPHY_DMG_STACK_CAP ?? 8) * (Balance.ORC_TROPHY_DMG_PER_STACK ?? 0.06)
      const t4amp = tier >= 4 ? (Balance.ORC_THROW_T4_AMP ?? 1.3) : 1
      const bladeAmp = wpn.id === 'blade' ? (Balance.ORC_THROW_BLADE_BONUS ?? 1.4) : 1
      const dmg = Math.max(1, Math.floor(atk * (Balance.ORC_THROW_DMG_FRAC ?? 0.55) * stackBonus * bladeAmp * t4amp))
      for (const a of advsIn) {
        const before = a.resources.hp
        a.resources.hp = Math.max(0, before - dmg)
        totalDmg += before - a.resources.hp
        // Per-type rider (AI-respected adv fields).
        if (wpn.id === 'heavy') {
          a._rootedUntil = Math.max(a._rootedUntil ?? 0, now + (Balance.ORC_THROW_ROOT_MS ?? 1400))
        } else if (wpn.id === 'hunter') {
          const next = now + (Balance.ORC_THROW_SLOW_MS ?? 3500)
          if (!a._slowUntil || a._slowUntil < next) a._slowUntil = next
          a._slowMult = Math.min(a._slowMult ?? 1, Balance.ORC_THROW_SLOW_MULT ?? 0.55)
        } else if (wpn.id === 'arcane') {
          a._hexUntil   = Math.max(a._hexUntil ?? 0, now + (Balance.ORC_THROW_HEX_MS ?? 5000))
          a._hexVulnMul = Math.max(a._hexVulnMul ?? 1, Balance.ORC_THROW_HEX_MULT ?? 1.3)
        }
        EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'physical' })
        if (a.resources.hp <= 0) {
          EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'The Trophy Hunter', roomId: room.instanceId, damageType: 'physical' })
        }
      }
    }
    // Faith trophy in the volley → the boss drinks a share of the carnage.
    if (weapons.some(w => w.id === 'faith') && totalDmg > 0) {
      const heal = Math.floor(totalDmg * (Balance.ORC_THROW_FAITH_HEAL_FRAC ?? 0.5))
      boss.hp = Math.min(boss.maxHp ?? boss.hp ?? 0, (boss.hp ?? 0) + heal)
    }

    // VFX — the claimed weapons arc from the throne into the room.
    const cx = (room.gridX + room.width  / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    AbilityVfx?.trophyThrowFx?.(this._scene, boss.worldX ?? cx, (boss.worldY ?? cy) - 8, {
      tier,
      toX: cx, toY: cy,
      weapons: weapons.map(w => ({ id: w.id, color: w.color })),
      victims: advsIn.map(a => ({ x: a.worldX, y: (a.worldY ?? 0) - 16 })),
    })

    if (boss._orcThrow) boss._orcThrow.usesLeft = Math.max(0, (boss._orcThrow.usesLeft ?? 0) - 1)
    this._throwArmed = false
    EventBus.emit('ORC_TROPHY_THROW_FIRED', { roomId: room.instanceId, room, tier, weapons: weapons.length, totalDmg })
  }

  // ── ORC: Warband (live cluster recompute) ──────────────────────────────

  // Manhattan room-membership lookup for every alive orc, tallied per
  // assigned-room id. Returns { [roomId]: count }.
  _orcCountsByRoom() {
    const counts = {}
    const grid = this._scene?.dungeonGrid
    for (const m of (this._gameState?.minions ?? [])) {
      if (!this._isOrcMinion(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const room = grid?.getRoomAtTile?.(m.tileX, m.tileY)
      const id = room?.instanceId
      if (!id) continue
      counts[id] = (counts[id] ?? 0) + 1
    }
    return counts
  }

  _countOrcAlliesInRoom(self, roomId) {
    if (!roomId) return 0
    const grid = this._scene?.dungeonGrid
    let n = 0
    for (const m of (this._gameState?.minions ?? [])) {
      if (m === self) continue
      if (!this._isOrcMinion(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const r = grid?.getRoomAtTile?.(m.tileX, m.tileY)
      if (r?.instanceId === roomId) n++
    }
    return n
  }

  // Per-frame: recompute every orc's stats.attack + stats.defense from
  //   stats.attack  = round((_orcBaseAttack + lootAtkBonus) × (1 + 5%·allies))
  //   stats.defense = round( _orcBaseDefense                × (1 + 5%·allies))
  // Cheap — there are only a handful of orcs in a dungeon and the room
  // lookup is a single tile-grid hit per orc.
  _tickOrc() {
    if (this._archId() !== 'orc') return
    const grid = this._scene?.dungeonGrid
    const minions = this._gameState?.minions ?? []
    if (minions.length === 0) return
    const counts = this._orcCountsByRoom()
    for (const m of minions) {
      if (!this._isOrcMinion(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      // Capture baseline if missing (e.g. a minion that pre-existed before
      // the system tagged it — defensive).
      if (m._orcBaseAttack == null || m._orcBaseDefense == null) {
        this._captureOrcBaseline(m)
      }
      const room = grid?.getRoomAtTile?.(m.tileX, m.tileY)
      const roomCount = room ? (counts[room.instanceId] ?? 0) : 0
      const allies = Math.max(0, roomCount - 1)   // count is *including* self
      const atkMult = 1 + allies * Balance.ORC_WARBAND_ATK_PCT_PER_ALLY
      const defMult = 1 + allies * Balance.ORC_WARBAND_DEF_PCT_PER_ALLY
      const base    = m._orcBaseAttack  ?? 0
      const baseDef = m._orcBaseDefense ?? 0
      const loot    = m.lootAtkBonus    ?? 0
      m.stats         ??= {}
      m.stats.attack   = Math.max(1, Math.round((base + loot) * atkMult))
      m.stats.defense  = Math.max(0, Math.round(baseDef * defMult))
    }
  }

  // ── ORC: Trophy Hunter ──────────────────────────────────────────────────
  // The Veteran claims a trophy from every hero class the dungeon kills. First
  // kill of a class CLAIMS its trophy type; repeat kills EMPOWER it (stacks).
  // Stored JSON-serializable on boss.trophies = { <type>: { stacks } }.

  _classDefById(classId) {
    const list = this._scene?.cache?.json?.get?.('adventurerClasses') ?? []
    return list.find(c => c.id === classId) ?? null
  }

  _claimTrophy(adv) {
    if (!adv) return
    const boss = this._gameState?.boss
    if (!boss) return
    const type = classifyTrophy(this._classDefById(adv.classId))
    if (!type) return   // event / non-combatant class — not a trophy

    boss.trophies ??= {}
    const had = !!boss.trophies[type]
    const entry = (boss.trophies[type] ??= { stacks: 0 })
    entry.stacks = (entry.stacks ?? 0) + 1

    EventBus.emit('ORC_TROPHY_CLAIMED', {
      type,
      stacks:    entry.stacks,
      firstTime: !had,
      classId:   adv.classId ?? null,
      x:         adv.worldX,
      y:         adv.worldY,
      color:     TROPHY_BY_ID[type]?.color ?? 0xffffff,
    })

    // VFX — the fallen hero's emblem streaks to the throne rack. The renderer
    // (BossArchetypeRenderer / AbilityVfx) draws it at the death tile.
    if (Number.isFinite(adv.worldX) && Number.isFinite(adv.worldY)) {
      const boss2 = this._gameState?.boss
      AbilityVfx?.trophyClaimFx?.(this._scene, adv.worldX, adv.worldY, {
        color:  TROPHY_BY_ID[type]?.color ?? 0xffffff,
        icon:   TROPHY_BY_ID[type]?.icon ?? '✦',
        toX:    boss2?.worldX,
        toY:    boss2?.worldY,
        isNew:  !had,
      })
    }
  }

  // The most-claimed trophy type (ties broken by TROPHY_TYPES order). Null if
  // nothing claimed.
  _trophyTopType() {
    const t = this._gameState?.boss?.trophies
    if (!t) return null
    let best = null, bestStacks = 0
    for (const def of TROPHY_TYPES) {
      const s = t[def.id]?.stacks ?? 0
      if (s > bestStacks) { bestStacks = s; best = def.id }
    }
    return best
  }

  // ── ORC: Mastery aura (T3+) ─────────────────────────────────────────────
  // The most-claimed trophy type radiates a dungeon-wide passive. Recomputed
  // each tick from baselines (so it's reversible and save-safe), mirroring the
  // Warband / Bloodlust pattern. Skips orc-family minions for the ATK/DEF auras
  // (Warband already owns their stat recompute).
  _tickMastery(delta) {
    if (this._archId() !== 'orc') return
    const boss = this._gameState?.boss
    if (!boss) return
    const tierOn = currentAct(this._gameState) >= 3
    const top    = tierOn ? this._trophyTopType() : null

    // Publish the active aura for cross-system readers (TrapSystem recharge,
    // CombatSystem range). Cleared to null when no aura is active.
    boss._orcMastery = top ? { type: top } : null
    // When the active type CHANGES (e.g. Hunter→Blade as stacks shift, or drops
    // below T3), wipe the previous type's minion buffs before applying the new one
    // so a stale range/ATK/DEF bonus can't linger.
    if ((boss._orcMasteryActive ?? null) !== top) {
      this._clearMasteryMinionBuffs()
      boss._orcMasteryActive = top
    }
    if (!top) return

    const stacks = boss.trophies?.[top]?.stacks ?? 1
    const minions = this._gameState?.minions ?? []

    if (top === 'blade' || top === 'heavy') {
      const isAtk = top === 'blade'
      const pct = Math.min(
        Balance.ORC_MASTERY_PCT_CAP,
        (isAtk ? Balance.ORC_MASTERY_ATK_PCT_PER_STACK : Balance.ORC_MASTERY_DEF_PCT_PER_STACK) * stacks,
      )
      for (const m of minions) {
        if (this._isOrcMinion(m)) continue   // Warband owns orc-family stats
        if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        m.stats ??= {}
        if (isAtk) {
          m._masteryBaseAtk ??= m.stats.attack ?? 1
          m.stats.attack = Math.max(1, Math.round(m._masteryBaseAtk * (1 + pct)))
        } else {
          m._masteryBaseDef ??= m.stats.defense ?? 0
          m.stats.defense = Math.max(0, Math.round(m._masteryBaseDef * (1 + pct)))
        }
      }
    } else if (top === 'hunter') {
      // Ranged minions gain reach (melee minions stay melee).
      for (const m of minions) {
        if (this._isOrcMinion(m)) continue
        const base = (m._masteryBaseRange ??= m.attackRange ?? 1)
        if (base > 1) m.attackRange = base + Balance.ORC_MASTERY_RANGE_BONUS
      }
    } else if (top === 'faith') {
      // Boss slowly regenerates while not in a fight.
      if (!this._bossFightActive && (boss.hp ?? 0) > 0 && (boss.hp ?? 0) < (boss.maxHp ?? 0)) {
        const perSec = (boss.maxHp ?? 0) * (Balance.ORC_MASTERY_REGEN_HP_PER_SEC / 100) * stacks
        boss.hp = Math.min(boss.maxHp ?? 0, (boss.hp ?? 0) + perSec * ((delta ?? 0) / 1000))
      }
    }
    // Arcane → trap recharge is read passively by TrapSystem off boss._orcMastery.
  }

  // Restore any minion stats the Mastery aura temporarily raised (aura type
  // changed away from blade/heavy/hunter, or dropped below T3).
  _clearMasteryMinionBuffs() {
    for (const m of (this._gameState?.minions ?? [])) {
      if (m._masteryBaseAtk != null)   { m.stats ??= {}; m.stats.attack  = m._masteryBaseAtk;  m._masteryBaseAtk  = null }
      if (m._masteryBaseDef != null)   { m.stats ??= {}; m.stats.defense = m._masteryBaseDef;  m._masteryBaseDef  = null }
      if (m._masteryBaseRange != null) { m.attackRange = m._masteryBaseRange; m._masteryBaseRange = null }
    }
  }

  // ══ ELDER LICH — THE WITHERING ══════════════════════════════════════════
  // Soul Essence economy: every dungeon death banks essence on the boss; it's
  // the Lich's lifeline (day regen), the ammo for the active CHANNEL SOULS
  // ability, and its throne-fight reserve. (Necromancy cut; Phylactery folded.)

  _lichTier() { return currentAct(this._gameState) }

  _harvestSoul(adv) {
    const boss = this._gameState?.boss
    if (!boss) return
    const lvl  = adv?.level ?? 1
    const gain = Balance.LICH_SOUL_PER_KILL + Math.floor(lvl * Balance.LICH_SOUL_PER_ADV_LEVEL)
    boss.soulEssence = (boss.soulEssence ?? 0) + gain
    EventBus.emit('LICH_SOUL_HARVEST', { gain, total: boss.soulEssence })
    if (Number.isFinite(adv?.worldX) && Number.isFinite(adv?.worldY)) {
      // Foot-anchored advs → lift to the chest so the soul peels off the body.
      AbilityVfx?.soulHarvestWispFx?.(this._scene, adv.worldX, adv.worldY - 16, {
        toX: boss.worldX, toY: boss.worldY,
      })
    }
  }

  // Day-phase lifeline: the Lich slowly regenerates while it holds essence.
  _lichRegenTick(delta) {
    if (this._archId() !== 'lich') return
    const boss = this._gameState?.boss
    if (!boss || this._bossFightActive) return
    if ((this._gameState?.meta?.phase ?? '') !== 'day') return
    if ((boss.soulEssence ?? 0) < Balance.LICH_SOUL_REGEN_MIN_ESSENCE) return
    if ((boss.hp ?? 0) <= 0 || (boss.hp ?? 0) >= (boss.maxHp ?? 0)) return
    const perSec = (boss.maxHp ?? 0) * (Balance.LICH_SOUL_REGEN_PCT_PER_SEC / 100)
    boss.hp = Math.min(boss.maxHp, (boss.hp ?? 0) + perSec * ((delta ?? 0) / 1000))
  }

  // ── CHANNEL SOULS (active day ability) — arm → click room → fire ──
  _soulChannelAvailable() {
    if (this._archId() !== 'lich') return false
    if ((this._gameState?.meta?.phase ?? '') !== 'day') return false
    return (this._gameState?.boss?.soulEssence ?? 0) >= Balance.LICH_CHANNEL_COST
  }

  _armSoulChannel() {
    if (!this._soulChannelAvailable()) return
    this._soulChannelArmed = true
    EventBus.emit('LICH_CHANNEL_ARMED', {})
  }

  _disarmSoulChannel() {
    this._soulChannelArmed = false
    EventBus.emit('LICH_CHANNEL_DISARMED', {})
  }

  // payload: { roomId } — fired by the UI after the player clicks a room while
  // CHANNEL SOULS is armed. The effect ESCALATES by act-tier and is room-wide
  // (scales with the crowd) + scales with banked essence.
  _fireSoulChannel(payload) {
    if (!this._soulChannelArmed) return
    if (!this._soulChannelAvailable()) { this._disarmSoulChannel(); return }
    const boss = this._gameState?.boss
    const room = this._gameState?.dungeon?.rooms?.find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const tier = this._lichTier()
    const now  = this._scene?.time?.now ?? 0

    // Spend essence; bigger reserve = bigger blast (essence-fuelled).
    const reserve = boss.soulEssence ?? 0
    boss.soulEssence = Math.max(0, reserve - Balance.LICH_CHANNEL_COST)
    const essBonus  = Math.min(Balance.LICH_CHANNEL_ESSENCE_SCALE_CAP, reserve * Balance.LICH_CHANNEL_ESSENCE_SCALE)
    const atk       = boss.attack ?? 0
    const perTarget = Math.max(1, Math.floor(atk * (Balance.LICH_CHANNEL_DMG_FRAC + essBonus)))

    const advs = this._gameState?.adventurers?.active ?? []
    let totalDmg = 0, victims = 0
    const victimPts = []
    for (const adv of advs) {
      if (!adv || (adv.resources?.hp ?? 0) <= 0) continue
      if (!_advInsideRoom(adv, room)) continue
      const before = adv.resources.hp
      adv.resources.hp = Math.max(this._shadowFloor(adv), before - perTarget)
      const dealt = before - adv.resources.hp
      totalDmg += dealt; victims++
      victimPts.push({ x: adv.worldX, y: adv.worldY - 16 })   // chest, not feet
      // T3+ Wither — no-heal + soul-rot DoT (ticked in _tickSoulRot).
      if (tier >= 3) {
        adv._noHealUntil = now + Balance.LICH_WITHER_DURATION_MS
        adv._witherUntil = now + Balance.LICH_WITHER_DURATION_MS
        adv._witherTickAt = now
      }
      // T4 Soul Cage — freeze in place (reuse _petrifiedUntil) + cage-drain DoT.
      if (tier >= 4) {
        adv._petrifiedUntil = now + Balance.LICH_CAGE_DURATION_MS
        adv._soulCagedUntil = now + Balance.LICH_CAGE_DURATION_MS
        adv._soulCageTickAt = now
      }
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: adv.instanceId, damage: dealt, damageType: 'soul' })
      if (adv.resources.hp <= 0) {
        EventBus.emit('ADVENTURER_DIED', { adventurer: adv, killerId: 'boss', killerName: 'The Withering', roomId: room.instanceId, damageType: 'soul' })
      }
    }
    // T2+ Soul Siphon — heal the boss + bank bonus essence per victim.
    if (tier >= 2 && victims > 0) {
      const heal = Math.round(totalDmg * Balance.LICH_CHANNEL_SIPHON_HEAL_FRAC)
      boss.hp = Math.min(boss.maxHp ?? boss.hp ?? 0, (boss.hp ?? 0) + heal)
      boss.soulEssence = (boss.soulEssence ?? 0) + victims * Balance.LICH_CHANNEL_SIPHON_ESSENCE
    }

    // VFX — soul channel over the room (tier-escalating) + drain threads home.
    const TS = Balance.TILE_SIZE
    const cx = (room.gridX + room.width  / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    AbilityVfx?.soulChannelFx?.(this._scene, cx, cy, {
      tier, fromX: boss.worldX, fromY: boss.worldY, victims: victimPts,
    })

    this._soulChannelArmed = false
    EventBus.emit('LICH_CHANNEL_FIRED', {
      roomId: room.instanceId, room, tier, victims, totalDmg,
      essenceLeft: boss.soulEssence,
    })
  }

  // Tick the Wither soul-rot + Soul Cage drain DoTs (day phase).
  _tickSoulRot(now) {
    if (this._archId() !== 'lich') return
    const boss = this._gameState?.boss
    const atk  = boss?.attack ?? 0
    for (const adv of (this._gameState?.adventurers?.active ?? [])) {
      if (!adv || (adv.resources?.hp ?? 0) <= 0) continue
      if (adv._witherUntil && now < adv._witherUntil &&
          now - (adv._witherTickAt ?? 0) >= Balance.LICH_WITHER_DOT_INTERVAL_MS) {
        adv._witherTickAt = now
        const dmg = Math.max(1, Math.floor(atk * Balance.LICH_WITHER_DOT_FRAC))
        adv.resources.hp = Math.max(this._shadowFloor(adv), adv.resources.hp - dmg)
        EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: adv.instanceId, damage: dmg, damageType: 'soul' })
        if (adv.resources.hp <= 0) { EventBus.emit('ADVENTURER_DIED', { adventurer: adv, killerId: 'boss', killerName: 'Wither', roomId: null, damageType: 'soul' }); continue }
      }
      if (adv._soulCagedUntil && now < adv._soulCagedUntil &&
          now - (adv._soulCageTickAt ?? 0) >= Balance.LICH_WITHER_DOT_INTERVAL_MS) {
        adv._soulCageTickAt = now
        const before = adv.resources.hp
        const dmg = Math.max(1, Math.floor(atk * Balance.LICH_CAGE_DRAIN_FRAC))
        adv.resources.hp = Math.max(this._shadowFloor(adv), before - dmg)
        const dealt = before - adv.resources.hp
        if (boss) boss.hp = Math.min(boss.maxHp ?? boss.hp ?? 0, (boss.hp ?? 0) + dealt)
        EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: adv.instanceId, damage: dealt, damageType: 'soul' })
        if (adv.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: adv, killerId: 'boss', killerName: 'Soul Cage', roomId: null, damageType: 'soul' })
      }
    }
  }

  // VISIBLE SOUL-COUNT TELL — ghostly souls orbit the Lich during the day; the
  // more Soul Essence banked, the more spirits swirl around him (1 per 20, cap 8).
  // They use the recolored animated ghost sprite, so they read as living souls.
  _tickSoulOrbit() {
    if (typeof this._scene?.add?.sprite !== 'function') return   // headless sim — no renderer
    const boss = this._gameState?.boss
    const day  = (this._gameState?.meta?.phase ?? '') === 'day'
    if (this._archId() !== 'lich' || !day || this._bossFightActive || !boss || !Number.isFinite(boss.worldX)) {
      this._clearSoulOrbit(); return
    }
    const PER = 20, MAX = 8
    const desired = Math.max(0, Math.min(MAX, Math.floor((boss.soulEssence ?? 0) / PER)))
    this._soulOrbit ??= []
    while (this._soulOrbit.length > desired) { const s = this._soulOrbit.pop(); try { s.destroy() } catch (e) {} }
    while (this._soulOrbit.length < desired) {
      const idx = this._soulOrbit.length
      const sp = AbilityVfx?.makeSoulSprite?.(this._scene, boss.worldX, boss.worldY, { color: idx % 2 ? 0xc0a0ff : 0x9affc0, scale: 0.32, depth: 9, alpha: 0.8, dir: 'down' })
      if (!sp) break
      this._soulOrbit.push(sp)
    }
    const now = this._scene?.time?.now ?? 0
    const n = this._soulOrbit.length, R = 40
    const baseDepth = 7 + boss.worldY * 0.0005   // the boss container's depth
    for (let i = 0; i < n; i++) {
      const sp = this._soulOrbit[i]
      if (!sp || sp.active === false) continue
      const ang = now * 0.0013 + (Math.PI * 2 * i) / Math.max(1, n)
      // True 3D orbit: behind the boss at the top of the ring, in front at the
      // bottom, smaller+dimmer at the back (shared orbit cue).
      const c = AbilityVfx.orbitCue(ang, baseDepth, 0.32, 0.9)
      sp.setPosition(boss.worldX + Math.cos(ang) * R, boss.worldY - 18 + Math.sin(ang) * R * 0.45 + Math.sin(now * 0.004 + i) * 4)
      sp.setDepth(c.depth); sp.setScale(c.scale); sp.setAlpha(c.alpha)
    }
  }

  _clearSoulOrbit() {
    if (!this._soulOrbit?.length) return
    for (const s of this._soulOrbit) { try { s.destroy() } catch (e) {} }
    this._soulOrbit = []
  }

  // ── GOLEM: Living Architecture ──────────────────────────────────────────
  // Tracks (rooms-counted-so-far, hp-applied, def-applied) on
  // `gameState.boss._golem` so saves rehydrate consistently and dynamic
  // place/remove stays balanced.

  _initLivingArchitecture() {
    if (this._archId() !== 'golem') return
    const boss = this._gameState?.boss
    if (!boss) return
    boss._golem ??= { roomsCounted: 0, hpApplied: 0, defApplied: 0, firstUseToastShown: false, earthquakeUsesLeft: Balance.GOLEM_EARTHQUAKE_USES_PER_DAY }

    const currentRoomCount = this._gameState?.dungeon?.rooms?.length ?? 0
    const delta = currentRoomCount - (boss._golem.roomsCounted ?? 0)
    if (delta > 0) this._applyLivingArchDelta(delta)
  }

  _applyLivingArchDelta(delta) {
    const boss = this._gameState?.boss
    if (!boss) return
    boss._golem ??= { roomsCounted: 0, hpApplied: 0, defApplied: 0, earthquakeUsesLeft: Balance.GOLEM_EARTHQUAKE_USES_PER_DAY }
    const dHp  = delta * Balance.GOLEM_HP_PER_ROOM
    const dDef = delta * Balance.GOLEM_DEF_PER_ROOM
    boss.maxHp   = Math.max(0, (boss.maxHp ?? 0) + dHp)
    boss.hp      = Math.max(0, Math.min(boss.maxHp, (boss.hp ?? 0) + dHp))
    boss.defense = Math.max(0, (boss.defense ?? 0) + dDef)
    boss._golem.roomsCounted = (boss._golem.roomsCounted ?? 0) + delta
    boss._golem.hpApplied    = (boss._golem.hpApplied    ?? 0) + dHp
    boss._golem.defApplied   = (boss._golem.defApplied   ?? 0) + dDef
    EventBus.emit('GOLEM_LIVING_ARCH_TICK', {
      roomsCounted: boss._golem.roomsCounted,
      hpApplied:    boss._golem.hpApplied,
      defApplied:   boss._golem.defApplied,
    })
  }

  _onRoomPlaced() {
    if (this._archId() !== 'golem') return
    this._applyLivingArchDelta(+1)
  }

  _onRoomRemoved() {
    if (this._archId() !== 'golem') return
    this._applyLivingArchDelta(-1)
  }

  // ── GOLEM: Earthquake ───────────────────────────────────────────────────
  // Resets daily uses at the start of each night (i.e. before the next day).

  _onNightStart() {
    if (this._archId() === 'golem') {
      const boss = this._gameState?.boss
      if (boss?._golem) {
        const bLv = boss.level ?? 1
        boss._golem.earthquakeUsesLeft = (Balance.GOLEM_EARTHQUAKE_USES_PER_DAY ?? 1)
          + Math.floor(bLv * (Balance.GOLEM_EQ_USES_PER_BOSS_LV ?? 0.25))
      }
      this._fissureZones = []   // cracks don't persist overnight
    }
    // Disarm via the proper API so the UI hears GOLEM_EARTHQUAKE_DISARMED
    // and resets its button label / room-pick listener. Without this, a
    // player who armed earthquake but didn't fire it ends up with the
    // button stuck on "PICK A ROOM" the next day.
    this._disarmEarthquake()
    // Lich: disarm Channel Souls so the button resets for the next day.
    this._disarmSoulChannel()
    // Slime: refill Mitosis Surge uses + disarm so the button resets.
    if (this._archId() === 'slime') {
      const bLv = this._gameState?.boss?.level ?? 1
      const uses = (Balance.SLIME_SURGE_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.SLIME_SURGE_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss ??= {}
      this._gameState.boss._slimeSurge = { usesLeft: uses }
    }
    this._disarmSurge()
    // Beholder: refill Tyrant's Gaze uses + disarm so the button resets.
    if (this._archId() === 'beholder') {
      const bLv = this._gameState?.boss?.level ?? 1
      const uses = (Balance.BEHOLDER_GAZE_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.BEHOLDER_GAZE_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss ??= {}
      this._gameState.boss._beholderGaze = { usesLeft: uses }
    }
    this._disarmGaze()
    // Orc: refill Trophy Throw uses + disarm so the button resets.
    if (this._archId() === 'orc') {
      const bLv = this._gameState?.boss?.level ?? 1
      const uses = (Balance.ORC_THROW_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.ORC_THROW_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss ??= {}
      this._gameState.boss._orcThrow = { usesLeft: uses }
    }
    this._disarmThrow()
    // Beholder: clear yesterday's anti-magic markings the moment night begins
    // (the new selection happens on DAY_PHASE_BEGAN).
    this._clearAntiMagicMarks()
    // Lizardman: re-camouflage all surviving lizardman minions for the new
    // day so each new wave gets the free first ambush hit.
    if (this._archId() === 'lizardman') {
      for (const m of this._gameState?.minions ?? []) {
        if (this._isLizardmanMinion(m)) m._camouflaged = true
      }
    }
    // Myconid: refill Seed the Bloom uses + disarm; bloomed rooms persist.
    if (this._archId() === 'myconid' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.MYCONID_SEED_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.MYCONID_SEED_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss._myconidSeed = { usesLeft: uses }
    }
    this._disarmSeed()
    this._clearSporeFx()
    // Lizardman: refill Plague Spit uses + disarm. Virulence + plague stacks persist.
    if (this._archId() === 'lizardman' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.LIZARD_SPIT_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.LIZARD_SPIT_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss._lizSpit = { usesLeft: uses }
    }
    this._disarmSpit()
    // Vampire: refill Blood Rite uses + disarm; reset the daily Blood Bond chain
    // counter; clear Sanguine Pools. BLOOD persists overnight (the run-long bank).
    if (this._archId() === 'vampire' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.VAMPIRE_RITE_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.VAMPIRE_RITE_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss._vampRite = { usesLeft: uses }
      this._bondChainToday = 0
      this._riteZones = []
    }
    this._disarmRite()
    // Wraith: refill Night Terror uses + disarm; clear haunted zones. DREAD persists.
    if (this._archId() === 'wraith' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.WRAITH_TERROR_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.WRAITH_TERROR_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss._wraithTerror = { usesLeft: uses }
      this._terrorZones = []
    }
    this._disarmTerror()
    // Demon: reset daily Sacrifice uses; top the Hellgate roster up to
    // N=bossLevel imps. Killed or sacrificed imps from prior days do NOT
    // revive (enforced by the dead-imp filter in MinionAISystem.respawnAll);
    // each dawn fills the open slots with brand-new imp instances. Surviving
    // imps from yesterday are kept — we just spawn enough fresh ones to
    // reach the N-slot ceiling, so total count never grows past N.
    if (this._archId() === 'demon') {
      this._gameState._demon ??= { sacrificeUsesLeft: 0 }
      const _demonBossLv = this._gameState?.boss?.level ?? 1
      this._gameState._demon.sacrificeUsesLeft = (Balance.DEMON_PACT_USES_PER_DAY ?? 1)
        + Math.floor(_demonBossLv * (Balance.DEMON_PACT_USES_PER_BOSS_LV ?? 0.25))
      this._hellfireZones = []   // burning ground doesn't persist overnight
      // Disarm via the proper API so the UI hears DEMON_SACRIFICE_DISARMED
      // and snaps the button back to SACRIFICE — silent state mutation here
      // was the source of the "stuck on PICK A MINION" bug.
      this._disarmSacrifice()
      const bossLv = this._gameState?.boss?.level ?? 1
      const N = Math.max(1, bossLv)
      const aliveImps = (this._gameState?.minions ?? [])
        .filter(m => m._isDemonImp && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0)
        .length
      const need = Math.max(0, N - aliveImps)
      if (need > 0) this._spawnHellgateImps(need)
    }
    // Gnoll: refresh Hunters Pack to its boss-level cap and reset Bloodlust.
    // Refill the SOUND THE HUNT uses + drop any active hunt-mark. FEROCITY persists.
    if (this._archId() === 'gnoll') {
      this._resetBloodlust()
      this._refillHuntersPack()
      this._captureBloodlustBaselines()
      if (this._gameState?.boss) {
        const bLv = this._gameState.boss.level ?? 1
        const uses = (Balance.GNOLL_HUNT_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.GNOLL_HUNT_USES_PER_BOSS_LV ?? 0.25))
        this._gameState.boss._gnollHunt = { usesLeft: uses }
      }
      this._huntMark = null
    }
    this._disarmHunt()
    // Succubus: refill Kiss of Rapture uses + disarm. ALLURE persists.
    if (this._archId() === 'succubus' && this._gameState?.boss) {
      const bLv = this._gameState.boss.level ?? 1
      const uses = (Balance.SUCCUBUS_KISS_USES_PER_DAY ?? 1) + Math.floor(bLv * (Balance.SUCCUBUS_KISS_USES_PER_BOSS_LV ?? 0.25))
      this._gameState.boss._succubusKiss = { usesLeft: uses }
    }
    this._disarmKiss()
  }

  _isLizardmanMinion(m) {
    return !!(m && Array.isArray(m.tags) && m.tags.includes(MINION_TAG_LIZARDMAN))
  }

  // ── LIZARDMAN: THE PLAGUE-BEARER ───────────────────────────────────────────
  _virulenceCap() { return (Balance.LIZARD_VIRULENCE_CAP_BASE ?? 50) + currentAct(this._gameState) * (Balance.LIZARD_VIRULENCE_CAP_PER_ACT ?? 40) }
  _virulenceSat() { return Math.max(0, Math.min(1, (this._gameState?.boss?.virulence ?? 0) / Math.max(1, this._virulenceCap()))) }
  _plagueStackCap() { return currentAct(this._gameState) >= 4 ? 999 : (Balance.LIZARD_PLAGUE_STACK_CAP_BASE ?? 6) }
  _plagueDotFactor() { return 1 + Math.min(Balance.LIZARD_PLAGUE_VIRULENCE_DOT_CAP ?? 1.2, (this._gameState?.boss?.virulence ?? 0) * (Balance.LIZARD_PLAGUE_VIRULENCE_SCALE ?? 0.01)) }

  // Seed/raise plague on one adventurer.
  _infect(adv, stacks) {
    if (!adv || (adv.resources?.hp ?? 0) <= 0) return
    const was = adv._plagueStacks ?? 0
    adv._plagueStacks = Math.min(this._plagueStackCap(), was + stacks)
    if (was <= 0) EventBus.emit('STATUS_APPLIED', { targetId: adv.instanceId, label: 'INFECTED' })
  }

  // An infected adv's death banks Virulence (+ T4 Pandemic corpse-burst).
  _onPlaguedDeath(adv) {
    if (!adv) return
    const stacks = adv._plagueStacks ?? 0
    if (stacks <= 0) return
    const boss = this._gameState?.boss
    if (boss) boss.virulence = Math.min(this._virulenceCap(), (boss.virulence ?? 0)
      + (Balance.LIZARD_VIRULENCE_PER_INFECTED_KILL ?? 5) + (adv.level ?? 1) * (Balance.LIZARD_VIRULENCE_KILL_PER_LV ?? 0.5))
    if (currentAct(this._gameState) >= 4 && Number.isFinite(adv.worldX)) {
      const TS = Balance.TILE_SIZE, R = (Balance.LIZARD_OUTBREAK_RADIUS_TS ?? 2.2) * TS
      for (const a of (this._gameState?.adventurers?.active ?? [])) {
        if (a === adv || (a.resources?.hp ?? 0) <= 0) continue
        if (Math.hypot((a.worldX ?? 0) - adv.worldX, (a.worldY ?? 0) - adv.worldY) > R) continue
        const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * (Balance.LIZARD_OUTBREAK_DMG_PCT_PER_STACK ?? 0.03) * stacks))
        a.resources.hp = Math.max(this._shadowFloor(a), a.resources.hp - dmg)
        this._infect(a, 2)
        EventBus.emit('COMBAT_HIT', { sourceId: 'venom', targetId: a.instanceId, damage: dmg, damageType: 'poison' })
        if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'venom', killerName: 'Outbreak', roomId: null, damageType: 'poison' })
      }
      AbilityVfx?.outbreakFx?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 16, { tier: currentAct(this._gameState) })
    }
  }

  // Plague DoT on every carrier + the contagion spread (T2+ / T4 cross-room).
  _tickPlague(now) {
    if (this._archId() !== 'lizardman') return
    const advs = this._gameState?.adventurers?.active ?? []
    const tier = currentAct(this._gameState)
    const factor = this._plagueDotFactor()
    for (const adv of advs) {
      if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const stacks = adv._plagueStacks ?? 0
      if (stacks <= 0) continue
      if (tier >= 3) {   // feverish slow
        const next = now + 1200
        if (!adv._slowUntil || adv._slowUntil < next) adv._slowUntil = next
        adv._slowMult = Math.min(adv._slowMult ?? 1, Balance.LIZARD_PLAGUE_FEVER_SLOW_MULT ?? 0.7)
      }
      adv._plagueTickAt ??= 0
      if (now - adv._plagueTickAt < (Balance.LIZARD_PLAGUE_TICK_MS ?? 1000)) continue
      adv._plagueTickAt = now
      const dmg = Math.max(1, Math.floor((adv.resources?.maxHp ?? 0) * (Balance.LIZARD_PLAGUE_DOT_PCT_PER_STACK ?? 0.006) * stacks * factor))
      adv.resources.hp = Math.max(this._shadowFloor(adv), adv.resources.hp - dmg)
      EventBus.emit('COMBAT_HIT', { sourceId: 'venom', targetId: adv.instanceId, damage: dmg, damageType: 'poison' })
      if (adv.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: adv, killerId: 'venom', killerName: 'Plague', roomId: null, damageType: 'poison' })
    }
    if (tier < 2) return
    if (now - this._plagueSpreadAt < (Balance.LIZARD_SPREAD_INTERVAL_MS ?? 1400)) return
    this._plagueSpreadAt = now
    const carriers = advs.filter(a => (a.resources?.hp ?? 0) > 0 && (a._plagueStacks ?? 0) > 0)
    const uninfected = advs.filter(a => (a.resources?.hp ?? 0) > 0 && (a._plagueStacks ?? 0) <= 0)
    if (carriers.length === 0 || uninfected.length === 0) return
    const TS = Balance.TILE_SIZE, R = (Balance.LIZARD_SPREAD_RADIUS_TS ?? 3) * TS
    const perCarrier = Math.min(Balance.LIZARD_SPREAD_TARGETS_CAP ?? 4,
      (Balance.LIZARD_SPREAD_TARGETS_BASE ?? 1) + Math.round((this._gameState?.boss?.virulence ?? 0) * (Balance.LIZARD_SPREAD_TARGETS_PER_VIRULENCE ?? 0.02)))
    const seed = Balance.LIZARD_SPREAD_SEED_STACKS ?? 1
    const crossRoom = tier >= 4
    const claimed = new Set()
    for (const c of carriers) {
      let n = 0
      for (const u of uninfected) {
        if (n >= perCarrier) break
        if (claimed.has(u.instanceId)) continue
        if (!crossRoom && Math.hypot((u.worldX ?? 0) - (c.worldX ?? 0), (u.worldY ?? 0) - (c.worldY ?? 0)) > R) continue
        claimed.add(u.instanceId); n++
        this._infect(u, seed)
        if (this._scene && Number.isFinite(c.worldX) && Number.isFinite(u.worldX)) AbilityVfx?.contagionFx?.(this._scene, c.worldX, (c.worldY ?? 0) - 16, { toX: u.worldX, toY: (u.worldY ?? 0) - 16, tier })
      }
    }
  }

  // ── PLAGUE SPIT (day active) — arm → click a room → infect everyone inside ──
  _spitUsesLeft() { return this._gameState?.boss?._lizSpit?.usesLeft ?? 0 }
  _spitAvailable() { return this._archId() === 'lizardman' && (this._gameState?.meta?.phase ?? '') === 'day' && this._spitUsesLeft() > 0 }
  _armSpit() { if (!this._spitAvailable()) return; this._spitArmed = true; EventBus.emit('LIZARD_SPIT_ARMED', {}) }
  _disarmSpit() { this._spitArmed = false; EventBus.emit('LIZARD_SPIT_DISARMED', {}) }
  _fireSpit(payload) {
    if (!this._spitArmed) return
    if (!this._spitAvailable()) { this._disarmSpit(); return }
    const boss = this._gameState?.boss
    const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const tier = currentAct(this._gameState), TS = Balance.TILE_SIZE
    const dose = (Balance.LIZARD_SPIT_STACKS ?? 3) + (tier - 1) * (Balance.LIZARD_SPIT_STACKS_PER_ACT ?? 1)
    const advsIn = (this._gameState.adventurers?.active ?? []).filter(a => (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, room))
    for (const a of advsIn) this._infect(a, dose)
    const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
    AbilityVfx?.plagueSpitFx?.(this._scene, boss.worldX ?? cx, (boss.worldY ?? cy) - 8, { toX: cx, toY: cy, tier, rectW: room.width * TS, rectH: room.height * TS })
    if (boss._lizSpit) boss._lizSpit.usesLeft = Math.max(0, (boss._lizSpit.usesLeft ?? 0) - 1)
    this._spitArmed = false
    EventBus.emit('LIZARD_SPIT_FIRED', { roomId: room.instanceId, room, tier, victims: advsIn.length })
  }

  _stopPlagueFightTimer() { this._plagueFightTimer?.remove?.(false); this._plagueFightTimer = null }

  // Throne fight — Infected Bite → Contagion → Miasma Spew → Outbreak finale.
  // (Plague DoT itself ticks via _tickPlague every frame, fighters included.)
  _tickPlagueFight() {
    const boss = this._gameState?.boss; if (!boss) return
    const tier = currentAct(this._gameState)
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber'); if (!bossRoom) return
    const TS = Balance.TILE_SIZE
    const fighters = (this._gameState?.adventurers?.active ?? []).filter(a => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, bossRoom))
    if (fighters.length === 0) return
    const cx = (bossRoom.gridX + bossRoom.width / 2) * TS, cy = (bossRoom.gridY + bossRoom.height / 2) * TS

    if (tier >= 4 && !this._outbreakFinaleDone && (boss.hp ?? 0) > 0 && (boss.hp ?? 0) < (boss.maxHp ?? 1) * 0.3) {
      this._outbreakFinaleDone = true
      AbilityVfx?.miasmaSpewFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS, big: true })
      for (const a of fighters) {
        const st = a._plagueStacks ?? 0
        if (st > 0) {
          const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * (Balance.LIZARD_FIGHT_OUTBREAK_DMG_PCT_PER_STACK ?? 0.04) * st))
          a.resources.hp = Math.max(0, a.resources.hp - dmg)
          if (this._scene && Number.isFinite(a.worldX)) AbilityVfx?.outbreakFx?.(this._scene, a.worldX, (a.worldY ?? 0) - 16, { tier })
          EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'poison' })
          if (a.resources.hp <= 0) { EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Outbreak', roomId: bossRoom.instanceId, damageType: 'poison' }); continue }
        }
        this._infect(a, 3)
      }
      return
    }

    if (tier >= 3) {
      AbilityVfx?.miasmaSpewFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS })
      for (const a of fighters) this._infect(a, Balance.LIZARD_FIGHT_SPEW_STACKS ?? 3)
    } else if (tier >= 2) {
      const carriers = fighters.filter(a => (a._plagueStacks ?? 0) > 0)
      const clean = fighters.filter(a => (a._plagueStacks ?? 0) <= 0)
      if (carriers.length === 0) this._infect(fighters[0], Balance.LIZARD_FIGHT_BITE_STACKS ?? 2)
      else {
        let k = 0
        for (const u of clean) { if (k >= carriers.length + 1) break; this._infect(u, 2); k++; if (this._scene && Number.isFinite(u.worldX)) AbilityVfx?.contagionFx?.(this._scene, carriers[0].worldX, (carriers[0].worldY ?? 0) - 16, { toX: u.worldX, toY: (u.worldY ?? 0) - 16, tier }) }
      }
      for (const a of fighters) if ((a._plagueStacks ?? 0) > 0) this._infect(a, 1)
    } else {
      const t = fighters[Math.floor(Math.random() * fighters.length)]
      this._infect(t, Balance.LIZARD_FIGHT_BITE_STACKS ?? 2)
      if (this._scene && Number.isFinite(t.worldX)) AbilityVfx?.ambushStrikeFx?.(this._scene, t.worldX, (t.worldY ?? 0) - 16, { tier })
    }
  }

  _earthquakeUsesLeft() {
    return this._gameState?.boss?._golem?.earthquakeUsesLeft ?? 0
  }

  _earthquakeAvailable() {
    if (this._archId() !== 'golem') return false
    if (this._gameState?.meta?.phase !== 'day')  return false
    return this._earthquakeUsesLeft() > 0
  }

  _armEarthquake() {
    if (!this._earthquakeAvailable()) return
    this._earthquakeArmed = true
    EventBus.emit('GOLEM_EARTHQUAKE_ARMED', {})
  }

  // Always emits GOLEM_EARTHQUAKE_DISARMED, even if our internal flag is
  // already false. Necessary because phase-change resets clear the system
  // flag silently — without an emit the BossArchetypeUI would stay armed
  // in its own state and the button would get stuck on "PICK A ROOM"
  // forever (clicking it would emit DISARM but the early-return here
  // would suppress the DISARMED event, leaving the UI mid-flight).
  _disarmEarthquake() {
    this._earthquakeArmed = false
    EventBus.emit('GOLEM_EARTHQUAKE_DISARMED', {})
  }

  // Bedrock helpers — the dungeon's room count drives the Golem's might.
  _bedrock() { return this._gameState?.dungeon?.rooms?.length ?? 0 }
  _bedrockSat() { return Math.max(0, Math.min(1, this._bedrock() / Math.max(1, Balance.GOLEM_BEDROCK_CAP_ROOMS ?? 20))) }

  // Apply the Seismic Slam to one room — damage everyone inside + tier riders
  // (T2 fissure zone, T3 burial). `mult` scales the damage (T4 adjacency < 1).
  _seismicHitRoom(room, tier, now, mult = 1) {
    const rooms = this._bedrock()
    const dmg = Math.max(1, Math.round(rooms * (Balance.GOLEM_EARTHQUAKE_DMG_PER_ROOM ?? 2) * mult))
    const hits = []
    for (const adv of (this._gameState?.adventurers?.active ?? [])) {
      if (!adv || (adv.resources?.hp ?? 0) <= 0 || !_advInsideRoom(adv, room)) continue
      const before = adv.resources.hp
      adv.resources.hp = Math.max(this._shadowFloor(adv), before - dmg)
      hits.push({ advId: adv.instanceId, dmg })
      // T3 Collapse — buried (brief can't-act); T4 longer.
      if (tier >= 3) {
        const buryMs = (Balance.GOLEM_COLLAPSE_BURY_MS ?? 1600) + Math.max(0, tier - 3) * (Balance.GOLEM_COLLAPSE_BURY_PER_ACT ?? 400)
        adv._petrifiedUntil = Math.max(adv._petrifiedUntil ?? 0, now + buryMs)
        EventBus.emit('STATUS_APPLIED', { targetId: adv.instanceId, label: 'BURIED' })
      }
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: adv.instanceId, damage: dmg, damageType: 'earthquake' })
      if (adv.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: adv, killerId: 'boss', killerName: 'Seismic Slam', roomId: room.instanceId, damageType: 'earthquake' })
    }
    // T2 Fissure — a lingering crack: aftershock DoT + slow for a few seconds.
    if (tier >= 2) {
      this._fissureZones = (this._fissureZones ?? []).filter(z => z.roomId !== room.instanceId)
      this._fissureZones.push({ roomId: room.instanceId, until: now + (Balance.GOLEM_FISSURE_DURATION_MS ?? 4000), _tickAt: now })
    }
    return { dmg, hits }
  }

  // payload: { roomId } — fired by the UI after the player clicks a room.
  _fireEarthquake(payload) {
    if (!this._earthquakeArmed) return
    if (!this._earthquakeAvailable()) { this._disarmEarthquake(); return }
    const room = this._gameState?.dungeon?.rooms?.find(r => r.instanceId === payload?.roomId)
    if (!room) return
    const tier = currentAct(this._gameState)
    const now  = this._scene?.time?.now ?? 0
    const TS   = Balance.TILE_SIZE

    const main = this._seismicHitRoom(room, tier, now, 1)
    // T4 Cataclysm — adjacent rooms convulse too (reduced).
    if (tier >= 4) {
      for (const adj of this._adjacentRooms(room)) {
        this._seismicHitRoom(adj, tier, now, Balance.GOLEM_CATACLYSM_ADJ_FRAC ?? 0.6)
        const acx = (adj.gridX + adj.width / 2) * TS, acy = (adj.gridY + adj.height / 2) * TS
        AbilityVfx?.seismicSlamFx?.(this._scene, acx, acy, { tier: tier - 1, rectW: adj.width * TS, rectH: adj.height * TS })
      }
    }

    const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
    AbilityVfx?.seismicSlamFx?.(this._scene, cx, cy, { tier, rectW: room.width * TS, rectH: room.height * TS })
    if (tier >= 2) AbilityVfx?.fissureFx?.(this._scene, cx, cy, { tier, rectW: room.width * TS })

    const boss = this._gameState?.boss
    if (boss?._golem) boss._golem.earthquakeUsesLeft = Math.max(0, (boss._golem.earthquakeUsesLeft ?? 0) - 1)
    this._earthquakeArmed = false
    EventBus.emit('GOLEM_EARTHQUAKE_FIRED', { roomId: room.instanceId, room, damage: main.dmg, hits: main.hits, tier })
  }

  // Dungeon-kit Aftershock (T2+) + lingering Fissure-zone ticks. Driven from
  // the per-frame tick(). Transient zones live on the system (not saved).
  _tickGolem(now) {
    if (this._archId() !== 'golem') return
    const tier = currentAct(this._gameState)
    const rooms = this._gameState?.dungeon?.rooms ?? []

    // ── Fissure zones — aftershock DoT + slow on heroes inside ──
    const zones = this._fissureZones ?? []
    if (zones.length > 0) {
      this._fissureZones = zones.filter(z => z.until > now)
      const dot = Math.max(1, Math.round(this._bedrock() * (Balance.GOLEM_FISSURE_DOT_PER_ROOM ?? 0.6)))
      for (const z of this._fissureZones) {
        const room = rooms.find(r => r.instanceId === z.roomId)
        if (!room) continue
        if (now - (z._tickAt ?? 0) >= (Balance.GOLEM_FISSURE_TICK_MS ?? 1000)) {
          z._tickAt = now
          for (const a of (this._gameState?.adventurers?.active ?? [])) {
            if ((a.resources?.hp ?? 0) <= 0 || !_advInsideRoom(a, room)) continue
            a.resources.hp = Math.max(this._shadowFloor(a), a.resources.hp - dot)
            const next = now + (Balance.GOLEM_FISSURE_SLOW_MS ?? 1400)
            if (!a._slowUntil || a._slowUntil < next) a._slowUntil = next
            a._slowMult = Math.min(a._slowMult ?? 1, Balance.GOLEM_FISSURE_SLOW_MULT ?? 0.6)
            EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dot, damageType: 'earthquake' })
            if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Fissure', roomId: room.instanceId, damageType: 'earthquake' })
          }
        }
      }
    }

    // ── Aftershock (T2+) — periodic tremor; T3 hits all occupied rooms, T4 roots ──
    if (tier < 2 || (this._gameState?.meta?.phase ?? '') !== 'day') return
    this._aftershockAt ??= 0
    if (now - this._aftershockAt < (Balance.GOLEM_AFTERSHOCK_INTERVAL_MS ?? 4500)) return
    this._aftershockAt = now
    const advs = (this._gameState?.adventurers?.active ?? []).filter(a => (a.resources?.hp ?? 0) > 0)
    if (advs.length === 0) return
    // occupied rooms (by adv presence)
    const occupied = rooms.filter(r => advs.some(a => _advInsideRoom(a, r)))
    if (occupied.length === 0) return
    let targets
    if (tier >= 3) targets = occupied                                   // Tremor Network — all
    else { // most-occupied single room
      let best = occupied[0], bestN = -1
      for (const r of occupied) { const n = advs.filter(a => _advInsideRoom(a, r)).length; if (n > bestN) { bestN = n; best = r } }
      targets = [best]
    }
    const chip = Math.max(1, Math.round(this._bedrock() * (Balance.GOLEM_AFTERSHOCK_DMG_PER_ROOM ?? 0.18)))
    const TS = Balance.TILE_SIZE
    for (const room of targets) {
      for (const a of advs) {
        if (!_advInsideRoom(a, room)) continue
        a.resources.hp = Math.max(this._shadowFloor(a), a.resources.hp - chip)
        if (tier >= 4) a._rootedUntil = Math.max(a._rootedUntil ?? 0, now + (Balance.GOLEM_AFTERSHOCK_ROOT_MS ?? 700))
        EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: chip, damageType: 'earthquake' })
        if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Aftershock', roomId: room.instanceId, damageType: 'earthquake' })
      }
      const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
      AbilityVfx?.seismicSlamFx?.(this._scene, cx, cy, { tier: 1, rectW: room.width * TS, rectH: room.height * TS, small: true })
    }
  }

  // ── BEHOLDER: Petrify Gaze ──────────────────────────────────────────────

  _onBossFightStarted() {
    // Track the active fight so per-archetype ticks (e.g. succubus charm)
    // can suspend during it. Boss fight runs in an overlay scene; spawning
    // dungeon-scene VFX mid-fight tangles the renderer pipeline and was
    // dropping every sprite to invisible until the next reload.
    this._bossFightActive = true
    // Abort any in-progress succubus flight so the boss isn't left hidden
    // (BossRenderer hides her during 'going'/'return' phases).
    if (this._archId() === 'succubus' && this._gameState?._succubus?.flight) {
      this._gameState._succubus.flight = null
      EventBus.emit('SUCCUBUS_FLIGHT_ENDED', {})
    }

    if (this._archId() === 'beholder') {
      this._stopPetrifyTimer()
      // Schedule the gaze every BEHOLDER_PETRIFY_INTERVAL_MS while the fight runs.
      this._petrifyTimer = this._scene?.time?.addEvent?.({
        delay:    Balance.BEHOLDER_PETRIFY_INTERVAL_MS,
        loop:     true,
        callback: () => this._fireEyeBarrage(),
      })
    }
    if (this._archId() === 'myconid') {
      this._stopBloomFightTimer()
      this._bloomFinaleDone = false
      this._bloomChannelUntil = 0
      // Tier-gated arena hazards pulse every ~2.6s through the throne fight.
      this._bloomFightTimer = this._scene?.time?.addEvent?.({
        delay:    2600,
        loop:     true,
        callback: () => this._tickBloomFight(),
      })
    }
    if (this._archId() === 'demon') {
      this._stopBrimstoneFightTimer()
      this._pactFinaleDone = false
      this._brimstoneFightTimer = this._scene?.time?.addEvent?.({
        delay:    2600,
        loop:     true,
        callback: () => this._tickBrimstoneFight(),
      })
    }
    if (this._archId() === 'golem') {
      this._stopFortressFightTimer()
      this._collapseFinaleDone = false
      this._fortressFightTimer = this._scene?.time?.addEvent?.({
        delay:    2600,
        loop:     true,
        callback: () => this._tickFortressFight(),
      })
    }
    if (this._archId() === 'lizardman') {
      this._stopPlagueFightTimer()
      this._outbreakFinaleDone = false
      this._plagueFightTimer = this._scene?.time?.addEvent?.({
        delay:    2600,
        loop:     true,
        callback: () => this._tickPlagueFight(),
      })
    }
    if (this._archId() === 'vampire') {
      this._stopBloodFightTimer()
      this._bloodMoonFinaleDone = false
      this._vampFightTimer = this._scene?.time?.addEvent?.({
        delay:    2600,
        loop:     true,
        callback: () => this._tickBloodFight(),
      })
    }
    if (this._archId() === 'wraith') {
      this._stopDreadFightTimer()
      this._nightTerrorFinaleDone = false
      this._dreadFightTimer = this._scene?.time?.addEvent?.({
        delay:    2600,
        loop:     true,
        callback: () => this._tickDreadFight(),
      })
    }
    if (this._archId() === 'gnoll') {
      this._stopHuntFightTimer()
      this._bloodHuntFinaleDone = false
      this._huntFightTimer = this._scene?.time?.addEvent?.({
        delay:    2600,
        loop:     true,
        callback: () => this._tickHuntFight(),
      })
    }
    if (this._archId() === 'succubus') {
      this._stopRaptureFightTimer()
      this._raptureFinaleDone = false
      this._raptureFightTimer = this._scene?.time?.addEvent?.({
        delay:    2600,
        loop:     true,
        callback: () => this._tickRaptureFight(),
      })
    }
  }

  _onBossFightResolved() {
    this._bossFightActive = false
    if (this._archId() === 'beholder') {
      this._stopPetrifyTimer()
      // Clear any lingering petrify timestamps so an adv that survived doesn't
      // stay frozen after the fight ends (defensive — most fight-resolved paths
      // already drop the fight state, but corpses still keep the field).
      for (const a of this._gameState?.adventurers?.active ?? []) {
        if (a._petrifiedUntil) a._petrifiedUntil = 0
      }
    }
    if (this._archId() === 'myconid') this._stopBloomFightTimer()
    if (this._archId() === 'demon') this._stopBrimstoneFightTimer()
    if (this._archId() === 'golem') this._stopFortressFightTimer()
    if (this._archId() === 'lizardman') this._stopPlagueFightTimer()
    if (this._archId() === 'vampire') this._stopBloodFightTimer()
    if (this._archId() === 'wraith') this._stopDreadFightTimer()
    if (this._archId() === 'gnoll') this._stopHuntFightTimer()
    if (this._archId() === 'succubus') this._stopRaptureFightTimer()
  }

  _stopFortressFightTimer() {
    this._fortressFightTimer?.remove?.(false)
    this._fortressFightTimer = null
  }

  // Golem throne fight — THE FORTRESS (timer hazards over the baseline melee).
  // T1 Slam → T2 Raise Pillars → T3 Bulwark (DR window) → T4 Collapse finale.
  _tickFortressFight() {
    const boss = this._gameState?.boss
    if (!boss) return
    const tier = currentAct(this._gameState)
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    const now = this._scene?.time?.now ?? 0
    const TS  = Balance.TILE_SIZE
    const atk = boss.attack ?? 0
    const fighters = (this._gameState?.adventurers?.active ?? [])
      .filter(a => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, bossRoom))
    if (fighters.length === 0) return
    const hurt = (a, frac, label) => {
      const dmg = Math.max(1, Math.floor(atk * frac))
      a.resources.hp = Math.max(0, (a.resources.hp ?? 0) - dmg)
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'earthquake' })
      if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: label, roomId: bossRoom.instanceId, damageType: 'earthquake' })
    }
    const cx = (bossRoom.gridX + bossRoom.width / 2) * TS, cy = (bossRoom.gridY + bossRoom.height / 2) * TS

    // T4 finale — once below 30% HP, the arena collapses (Bedrock-scaled).
    if (tier >= 4 && !this._collapseFinaleDone && (boss.hp ?? 0) > 0 && (boss.hp ?? 0) < (boss.maxHp ?? 1) * 0.3) {
      this._collapseFinaleDone = true
      AbilityVfx?.collapseFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS })
      const dmg = Math.max(1, Math.round(this._bedrock() * (Balance.GOLEM_FIGHT_COLLAPSE_DMG_PER_ROOM ?? 1.4)))
      for (const a of fighters) {
        a.resources.hp = Math.max(0, (a.resources.hp ?? 0) - dmg)
        a._petrifiedUntil = Math.max(a._petrifiedUntil ?? 0, now + 1800)
        EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'earthquake' })
        if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'The Collapse', roomId: bossRoom.instanceId, damageType: 'earthquake' })
      }
      return
    }

    if (tier >= 3) {
      // Bulwark — encase in stone (a damage-reduction window) + a slam.
      boss._bulwarkUntil = now + (Balance.GOLEM_FIGHT_BULWARK_MS ?? 2600)
      AbilityVfx?.golemBulwarkFx?.(this._scene, boss.worldX, boss.worldY, { tier })
      for (const a of fighters) hurt(a, Balance.GOLEM_FIGHT_SLAM_FRAC ?? 0.5, 'The Living Fortress')
    } else if (tier >= 2) {
      // Raise Pillars — stone pillars erupt under the fighters (telegraphed dmg + knockback feel).
      for (const a of fighters) {
        if (this._scene && Number.isFinite(a.worldX)) AbilityVfx?.risePillarFx?.(this._scene, a.worldX, (a.worldY ?? 0) + 2, { tier })
        hurt(a, Balance.GOLEM_FIGHT_PILLAR_FRAC ?? 0.75, 'Stone Pillars')
      }
    } else {
      // T1 Slam — AoE ground-slam.
      AbilityVfx?.seismicSlamFx?.(this._scene, cx, cy, { tier: 2, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS })
      for (const a of fighters) hurt(a, Balance.GOLEM_FIGHT_SLAM_FRAC ?? 0.5, 'Ground Slam')
    }
  }

  _stopBrimstoneFightTimer() {
    this._brimstoneFightTimer?.remove?.(false)
    this._brimstoneFightTimer = null
  }

  // Demon throne fight — Brimstone-fueled hellfire caster (timer hazards over the
  // baseline melee, like the Beholder/Myconid). T1 Hellbolt → T2 Immolation
  // (sacrifice an imp in the chamber for a bigger nova + bank) → T3 Brimstone
  // Rain (meteors scale w/ Brimstone) → T4 Pact-Fulfilled finale at low HP.
  _tickBrimstoneFight() {
    const boss = this._gameState?.boss
    if (!boss) return
    const tier = currentAct(this._gameState)
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    const TS  = Balance.TILE_SIZE
    const atk = boss.attack ?? 0
    const fighters = (this._gameState?.adventurers?.active ?? [])
      .filter(a => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, bossRoom))
    if (fighters.length === 0) return
    const hurt = (a, frac) => {
      const dmg = Math.max(1, Math.floor(atk * frac))
      a.resources.hp = Math.max(0, (a.resources.hp ?? 0) - dmg)
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'fire' })
      if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'The Demon Lord', roomId: bossRoom.instanceId, damageType: 'fire' })
    }

    // T4 finale — once below 30% HP, dump ALL Brimstone in one cataclysm + heal.
    if (tier >= 4 && !this._pactFinaleDone && (boss.hp ?? 0) > 0 && (boss.hp ?? 0) < (boss.maxHp ?? 1) * 0.3) {
      this._pactFinaleDone = true
      const spend = boss.brimstone ?? 0
      boss.brimstone = 0
      const cx = (bossRoom.gridX + bossRoom.width / 2) * TS, cy = (bossRoom.gridY + bossRoom.height / 2) * TS
      AbilityVfx?.pactFinaleFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS })
      for (const a of fighters) {
        const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * Math.min(0.9, (Balance.DEMON_PACT_BASE_DMG_PCT ?? 0.1) + spend * (Balance.DEMON_FIGHT_FINALE_DMG_PER_BRIMSTONE ?? 0.002))))
        a.resources.hp = Math.max(0, (a.resources.hp ?? 0) - dmg)
        EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'fire' })
        if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'The Pact Fulfilled', roomId: bossRoom.instanceId, damageType: 'fire' })
      }
      const heal = Math.floor((boss.maxHp ?? 0) * (Balance.DEMON_FIGHT_FINALE_HEAL_FRAC ?? 0.0008) * spend)
      if (heal > 0) boss.hp = Math.min(boss.maxHp ?? boss.hp, (boss.hp ?? 0) + heal)
      return
    }

    if (tier >= 3) {
      // Brimstone Rain — meteors across the arena (count + dmg scale w/ Brimstone).
      const sat = this._brimstoneSat()
      const meteors = 1 + Math.round(sat * (1 + tier))
      for (let i = 0; i < meteors; i++) {
        const rx = bossRoom.gridX + 1 + Math.floor(Math.random() * Math.max(1, bossRoom.width - 2))
        const ry = bossRoom.gridY + 1 + Math.floor(Math.random() * Math.max(1, bossRoom.height - 2))
        const px = rx * TS + TS / 2, py = ry * TS + TS / 2
        AbilityVfx?.brimstoneMeteorFx?.(this._scene, px, py, { tier })
        for (const a of fighters) {
          if (Math.hypot((a.worldX ?? 0) - px, (a.worldY ?? 0) - py) <= TS * 1.6) hurt(a, Balance.DEMON_FIGHT_METEOR_FRAC ?? 0.55)
        }
      }
    } else if (tier >= 2) {
      // Immolation — consume an imp in the chamber for a bigger nova + bank.
      const imp = (this._gameState?.minions ?? []).find(m => m._isDemonImp && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 && _advInsideRoom(m, bossRoom))
      if (imp) {
        imp.resources.hp = 0; imp.aiState = 'dead'
        EventBus.emit('MINION_DIED', { minion: imp, killerId: 'sacrifice_pact' })
        this._gameState.minions = (this._gameState.minions ?? []).filter(x => x.instanceId !== imp.instanceId)
        boss.brimstone = Math.min(this._brimstoneCap(), (boss.brimstone ?? 0) + (Balance.DEMON_BRIMSTONE_PER_SACRIFICE ?? 18))
        if (this._scene && Number.isFinite(imp.worldX)) AbilityVfx?.combustFx?.(this._scene, imp.worldX, imp.worldY)
      }
      for (const a of fighters) hurt(a, Balance.DEMON_FIGHT_IMMOLATION_FRAC ?? 0.8)
      AbilityVfx?.hellfireAuraFx?.(this._scene, boss.worldX, boss.worldY)
    } else {
      // T1 Hellbolt — AoE hellfire on the party.
      for (const a of fighters) { hurt(a, Balance.DEMON_FIGHT_HELLBOLT_FRAC ?? 0.45); if (this._scene && Number.isFinite(a.worldX)) AbilityVfx?.combustFx?.(this._scene, a.worldX, (a.worldY ?? 0) - 16) }
    }
  }

  _stopPetrifyTimer() {
    this._petrifyTimer?.remove?.(false)
    this._petrifyTimer = null
  }

  _stopBloomFightTimer() {
    this._bloomFightTimer?.remove?.(false)
    this._bloomFightTimer = null
  }

  // Myconid throne fight — tier-gated arena hazards (rooted fungal caster):
  // T1 Spore Vent → T2 +Creeping Rot → T3 +Bursting Pods → T4 Bloom finale
  // (channel: the dungeon-wide colony heals the boss) at low HP. Effects mutate
  // the shared adv/boss objects; the BossSystem fight loop reads them.
  _tickBloomFight() {
    const boss = this._gameState?.boss
    if (!boss) return
    const tier = currentAct(this._gameState)
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    const now = this._scene?.time?.now ?? 0
    const TS  = Balance.TILE_SIZE
    const atk = boss.attack ?? 0
    const fighters = (this._gameState?.adventurers?.active ?? [])
      .filter(a => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, bossRoom))

    const hurt = (a, frac, healBlock) => {
      const dmg = Math.max(1, Math.floor(atk * frac))
      a.resources.hp = Math.max(0, (a.resources.hp ?? 0) - dmg)
      if (healBlock) a._noHealUntil = Math.max(a._noHealUntil ?? 0, now + (Balance.MYCONID_BLOOM_HEALBLOCK_MS ?? 1500))
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'poison' })
      if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'The Bloom', roomId: bossRoom.instanceId, damageType: 'poison' })
    }

    // T4 finale — once boss drops below 30% HP, erupt + start a heal channel
    // fed by the dungeon-wide colony.
    if (tier >= 4 && !this._bloomFinaleDone && (boss.hp ?? 0) > 0 && (boss.hp ?? 0) < (boss.maxHp ?? 1) * 0.3) {
      this._bloomFinaleDone = true
      this._bloomChannelUntil = now + 4000
      AbilityVfx?.bloomFinaleFx?.(this._scene, boss.worldX, boss.worldY, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS })
    }
    if (this._bloomChannelUntil && now < this._bloomChannelUntil) {
      const blooms = (boss.bloomedRooms ?? []).length
      const heal = Math.floor((boss.maxHp ?? 0) * (Balance.MYCONID_FIGHT_FINALE_HEAL_PER_BLOOM ?? 0.04) * blooms)
      if (heal > 0) boss.hp = Math.min(boss.maxHp ?? boss.hp, (boss.hp ?? 0) + heal)
      for (const a of fighters) hurt(a, (Balance.MYCONID_FIGHT_VENT_DMG_FRAC ?? 0.45) * 0.6, true)
      return
    }

    // T1 Spore Vent — gas the fighters (AoE DoT + vent puff on each).
    for (const a of fighters) {
      hurt(a, Balance.MYCONID_FIGHT_VENT_DMG_FRAC ?? 0.45, tier >= 2)
      if (this._scene && Number.isFinite(a.worldX)) AbilityVfx?.sporeVentFx?.(this._scene, a.worldX, (a.worldY ?? 0) - 16, { tier })
    }
    // T3 Bursting Pods — pods erupt around the arena (count scales with biomass).
    if (tier >= 3) {
      const sat = this._biomassSat()
      const pods = 1 + Math.round(sat * (1 + tier))
      for (let i = 0; i < pods; i++) {
        const rx = bossRoom.gridX + 1 + Math.floor(Math.random() * Math.max(1, bossRoom.width - 2))
        const ry = bossRoom.gridY + 1 + Math.floor(Math.random() * Math.max(1, bossRoom.height - 2))
        const px = rx * TS + TS / 2, py = ry * TS + TS / 2
        AbilityVfx?.sporeBurstFx?.(this._scene, px, py, { tier })
        for (const a of fighters) {
          if (Math.hypot((a.worldX ?? 0) - px, (a.worldY ?? 0) - py) <= TS * 1.6) hurt(a, Balance.MYCONID_FIGHT_POD_DMG_FRAC ?? 0.7, false)
        }
      }
    } else if (tier >= 2) {
      // T2 Creeping Rot — a rot zone crawls in; fighters near it take rot dmg.
      const rx = bossRoom.gridX + 1 + Math.floor(Math.random() * Math.max(1, bossRoom.width - 2))
      const ry = bossRoom.gridY + 1 + Math.floor(Math.random() * Math.max(1, bossRoom.height - 2))
      const px = rx * TS + TS / 2, py = ry * TS + TS / 2
      AbilityVfx?.creepingRotFx?.(this._scene, px, py, { tier })
      for (const a of fighters) {
        if (Math.hypot((a.worldX ?? 0) - px, (a.worldY ?? 0) - py) <= TS * 2) hurt(a, Balance.MYCONID_FIGHT_ROT_DMG_FRAC ?? 0.3, true)
      }
    }
  }

  // The throne-fight Eye Barrage. Fired by the fight timer every
  // BEHOLDER_PETRIFY_INTERVAL_MS. A tier-gated rotation of curse-rays — each
  // eye-stalk fires a different ray. Effects mutate the SHARED adv/boss
  // objects (fightStates hold references to the same adventurers), so the
  // BossSystem fight loop reads the changes naturally: petrify gates a target
  // out of the attacker pool, drain heals the boss, hex amplifies the boss's
  // melee (BossSystem reads gazeHexMul), disintegrate's HP cut is picked up by
  // the round's defender death-scan. VFX are graphics-based (safe mid-fight
  // from the dungeon scene; particle VFX here drops sprites to invisible).
  //   T1  Petrify + Drain (1 beam)
  //   T2  + Hex available in the rotation
  //   T3  2 beams per beat
  //   T4  + a guaranteed Disintegrate death-ray on the highest-aggro hero
  _fireEyeBarrage() {
    const boss = this._gameState?.boss
    if (!boss) return
    const now = this._scene?.time?.now ?? 0
    const advs = this._gameState?.adventurers?.active ?? []
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return

    const tier   = currentAct(this._gameState)
    const bossLv = boss.level ?? 1
    const atk    = boss.attack ?? 0
    const petrifyMs = Balance.BEHOLDER_PETRIFY_DURATION_MS
      + Math.max(0, bossLv - 1) * Balance.BEHOLDER_PETRIFY_DURATION_PER_BOSS_LV_MS

    // Eligible advs: alive and currently inside the boss chamber.
    const eligible = advs.filter(a =>
      a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, bossRoom))
    if (eligible.length === 0) return

    // Ray pool by tier. Drain + Petrify from the start; Hex joins at T2.
    const pool = ['petrify', 'drain']
    if (tier >= 2) pool.push('hex')
    const beams = tier >= 3 ? 2 : 1            // 2 beams/beat from T3

    // Shuffle the eligible advs so distinct beams hit distinct heroes.
    const shuffled = eligible.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp
    }

    const fired = []   // { target, kind } for VFX
    let ti = 0
    const nextTarget = () => shuffled[(ti++) % shuffled.length]

    for (let b = 0; b < beams; b++) {
      const kind = pool[Math.floor(Math.random() * pool.length)]
      const a = nextTarget()
      if (!a) break
      this._applyEyeRay(boss, a, kind, { now, petrifyMs, atk })
      fired.push({ target: a, kind })
    }

    // T4 — guaranteed Disintegrate death-ray on the highest-aggro hero
    // (highest attack = biggest threat). Layered on top of the beams above.
    if (tier >= 4) {
      let prime = eligible[0]
      for (const a of eligible) {
        if ((a.stats?.attack ?? 0) > (prime.stats?.attack ?? 0)) prime = a
      }
      this._applyEyeRay(boss, prime, 'disintegrate', { now, petrifyMs, atk })
      fired.push({ target: prime, kind: 'disintegrate' })
    }

    EventBus.emit('BEHOLDER_PETRIFY_FIRED', {
      targetIds:  fired.map(f => f.target.instanceId),
      durationMs: petrifyMs,
    })
    this._renderBarrageVfx(boss, fired, petrifyMs)
  }

  // Apply a single eye-ray's effect to one adventurer. Mutations land on the
  // shared adv/boss objects; the BossSystem fight loop honours them.
  _applyEyeRay(boss, a, kind, { now, petrifyMs, atk }) {
    const s = this._scene
    switch (kind) {
      case 'petrify':
        a._petrifiedUntil = Math.max(a._petrifiedUntil ?? 0, now + petrifyMs)
        EventBus.emit('STATUS_APPLIED', { targetId: a.instanceId, label: 'PETRIFIED' })
        break
      case 'hex':
        a._hexUntil   = Math.max(a._hexUntil ?? 0, now + Balance.BEHOLDER_HEX_MS)
        a._hexVulnMul = Math.max(a._hexVulnMul ?? 1, Balance.BEHOLDER_HEX_MULT)
        EventBus.emit('STATUS_APPLIED', { targetId: a.instanceId, label: 'HEXED' })
        break
      case 'drain': {
        const dmg = Math.max(1, Math.floor(atk * Balance.BEHOLDER_DRAIN_DMG_FRAC))
        a.resources.hp = Math.max(0, (a.resources.hp ?? 0) - dmg)
        const heal = Math.floor(dmg * Balance.BEHOLDER_DRAIN_HEAL_FRAC)
        if (heal > 0) boss.hp = Math.min(boss.maxHp ?? boss.hp, (boss.hp ?? 0) + heal)
        if (s) AbilityVfx?.floatingText?.(s, a.worldX, (a.worldY ?? 0) - 16, `-${dmg}`, { color: '#ff5577', fontSize: '12px' })
        break
      }
      case 'disintegrate': {
        const dmg = Math.max(1, Math.floor(atk * Balance.BEHOLDER_DISINTEGRATE_DMG_FRAC))
        a.resources.hp = Math.max(0, (a.resources.hp ?? 0) - dmg)
        EventBus.emit('STATUS_APPLIED', { targetId: a.instanceId, label: 'DISINTEGRATE' })
        if (s) AbilityVfx?.floatingText?.(s, a.worldX, (a.worldY ?? 0) - 16, `-${dmg}`, { color: '#ffffff', fontSize: '13px' })
        break
      }
    }
  }

  // Draw each fired ray as a bespoke geometric eye-beam (graphics-based, safe
  // to spawn mid-fight from the dungeon scene). Per-ray colour + on-hit motif.
  _renderBarrageVfx(boss, fired, durationMs) {
    const s = this._scene
    if (!s?.add?.graphics) return
    for (const { target, kind } of fired) {
      AbilityVfx?.beholderRayFx?.(s, boss.worldX ?? 0, (boss.worldY ?? 0) - 8, {
        toX: target.worldX, toY: (target.worldY ?? 0) - 16, kind,
        tier: currentAct(this._gameState), holdMs: kind === 'petrify' ? durationMs : 0,
      })
    }
  }

  // ── BEHOLDER: Anti-Magic Aura ───────────────────────────────────────────

  _onDayBegan() {
    if (this._archId() === 'beholder') {
      this._clearAntiMagicMarks()
      this._rollAntiMagicRooms()
      this._renderAntiMagicAura()
    }
    // Lich: cull expired raised skeletons, then raise yesterday's kills.
    if (this._archId() === 'lich') {
      this._cullExpiredRaised()
      this._raiseQueuedDead()
    }
    // Myconid: tick fungal corpse lifespans (sprout if expired) + roll spore
    // network if today is a multiple of MYCONID_SPORE_INTERVAL_DAYS.
    if (this._archId() === 'myconid') {
      this._tickFungalCorpseDay()
      this._bloomDayBegan()
      this._renderBloomOverlay()
    }
    // Succubus: refresh daily charm uses. One use per boss level (L1=1,
    // L2=2, L3=3, ... L10=10). Stamp a random delay before the FIRST
    // charm attempt so it doesn't fire the instant adventurers arrive —
    // feels more organic when she lurks briefly.
    if (this._archId() === 'succubus') {
      const lv  = this._gameState?.boss?.level ?? 1
      const now = this._scene?.time?.now ?? 0
      this._gameState._succubus ??= {}
      this._gameState._succubus.usesLeft = Math.max(1, lv)
      // First use: a longer lurk (≈10–18s) before the day's first charm.
      this._gameState._succubus.cooldownUntil = now + 10000 + Math.floor(Math.random() * 8000)
      this._gameState._succubus.flight = null
    }
  }

  _clearAntiMagicMarks() {
    const rooms = this._gameState?.dungeon?.rooms ?? []
    for (const r of rooms) {
      if (r._antiMagic) r._antiMagic = false
    }
    this._gameState._antiMagicRoomIds = []
    this._antiMagicFx?.clear?.()
  }

  _rollAntiMagicRooms() {
    const rooms = this._gameState?.dungeon?.rooms ?? []
    // Eligible: any non-boss room.
    const pool = rooms.filter(r => r.definitionId !== 'boss_chamber')
    if (pool.length === 0) return
    const bossLv = this._gameState?.boss?.level ?? 1
    const count = Math.min(
      pool.length,
      Balance.BEHOLDER_ANTIMAGIC_BASE_ROOMS
        + Math.max(0, bossLv - 1) * Balance.BEHOLDER_ANTIMAGIC_PER_BOSS_LV,
    )
    // Fisher-Yates partial shuffle for a uniform random pick of `count`.
    const picks = pool.slice()
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(Math.random() * (picks.length - i))
      const tmp = picks[i]; picks[i] = picks[j]; picks[j] = tmp
    }
    const chosen = picks.slice(0, count)
    for (const r of chosen) r._antiMagic = true
    this._gameState._antiMagicRoomIds = chosen.map(r => r.instanceId)
    EventBus.emit('BEHOLDER_ANTIMAGIC_ROOMS_SET', {
      roomIds: this._gameState._antiMagicRoomIds,
    })
  }

  _renderAntiMagicAura() {
    if (this._archId() !== 'beholder') return
    const s  = this._scene
    if (!s?.add?.graphics) return
    if (!this._antiMagicFx) {
      this._antiMagicFx = s.add.graphics().setDepth(2.6)
    }
    const g = this._antiMagicFx
    g.clear()
    const TS = Balance.TILE_SIZE
    const rooms = this._gameState?.dungeon?.rooms ?? []
    for (const r of rooms) {
      if (!r._antiMagic) continue
      const x = r.gridX * TS
      const y = r.gridY * TS
      const w = r.width  * TS
      const h = r.height * TS
      g.fillStyle(0x9b32d4, 0.10)
      g.fillRect(x, y, w, h)
      g.lineStyle(3, 0xc64bff, 0.55)
      g.strokeRect(x + 1, y + 1, w - 2, h - 2)
      g.lineStyle(1, 0xffe6ff, 0.45)
      g.strokeRect(x + 4, y + 4, w - 8, h - 8)
    }
  }

  // ── LICH: Phylactery ────────────────────────────────────────────────────
  // 1) Show a unlock toast the first time the player hits boss level 3 with
  //    the lich archetype. Persisted on gameState so it doesn't re-fire.
  // 2) On adv spawn, roll 15% per adv (or 100% when the boss has 0 normal
  //    lives) to set _huntPhylactery + initial HUNT_PHYLACTERY goal.
  // 3) Per-frame damage tick — handled in `tick(delta)` from Game.update.

  _onBossLeveledUp(payload) {
    if (this._archId() === 'lich') {
      this._maybeShowPhylacteryUnlockToast()
    }
    if (this._archId() === 'orc') {
      // applyBossLevelToMinion on BOSS_LEVELED_UP rescales every minion's
      // stats.attack — re-capture orc baselines so the post-scale value
      // becomes the new pristine number for Warband math.
      for (const m of (this._gameState?.minions ?? [])) {
        if (!this._isOrcMinion(m)) continue
        if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        // Subtract any active buff before re-baselining. stats.attack at this
        // point is `(oldBase + loot) × oldWarband × scaleRatio`, but Game.js
        // applies `newAtkM/oldAtkM` multiplicatively to the LIVE value, so a
        // clean baseline = current_after_scale ÷ warband_mult − loot.
        const room = this._scene?.dungeonGrid?.getRoomAtTile?.(m.tileX, m.tileY)
        const allies = this._countOrcAlliesInRoom(m, room?.instanceId ?? null)
        const warbandMult = 1 + allies * Balance.ORC_WARBAND_ATK_PCT_PER_ALLY
        const loot = m.lootAtkBonus ?? 0
        const inferredBase = Math.max(1,
          Math.round(((m.stats?.attack ?? 0) / Math.max(0.0001, warbandMult)) - loot))
        m._orcBaseAttack  = inferredBase
        m._orcBaseDefense = m.stats?.defense ?? 0
      }
    }
    if (this._archId() === 'gnoll') {
      // Top up the Hunters Pack to the new cap on level-up. Capture
      // baselines for the new pack members ONLY (don't wipe the active
      // bloodlust stack), then re-apply the current stacks to everyone so
      // the new arrivals immediately match the existing pack's ATK.
      this._refillHuntersPack()
      const stacks = this._gameState?._gnoll?.bloodlustStacks ?? 0
      for (const m of (this._gameState?.minions ?? [])) {
        if (!this._isGnollMinion(m)) continue
        if (m._baselineAttack == null) m._baselineAttack = m.stats?.attack ?? 1
      }
      if (stacks > 0) {
        const mult = 1 + Balance.GNOLL_BLOODLUST_PCT_PER_KILL * stacks
        for (const m of (this._gameState?.minions ?? [])) {
          if (!this._isGnollMinion(m)) continue
          if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
          const base = m._baselineAttack ?? (m.stats?.attack ?? 1)
          m.stats ??= {}
          m.stats.attack = Math.max(1, Math.round(base * mult))
        }
      }
    }
  }

  _maybeShowPhylacteryUnlockToast() {
    if (this._archId() !== 'lich') return
    const boss  = this._gameState?.boss
    if (!boss) return
    if ((boss.level ?? 1) < Balance.LICH_PHYLACTERY_UNLOCK_LEVEL) return
    boss._lich ??= {}
    if (boss._lich.unlockToastShown) return
    boss._lich.unlockToastShown = true
    EventBus.emit('PHYLACTERY_UNLOCKED', {})
  }

  _onAdvsSpawned(payload) {
    const advs = payload?.adventurers ?? []
    if (advs.length === 0) return

    // LICH: Phylactery hunt rolls.
    //
    // Knowledge gate (2026-05-27): hunts require the adv to actually
    // KNOW about the heart — via personal observation last run or via
    // inherited shared-pool intel. An adv with no knowledge of the heart
    // will never auto-target it from spawn (matches every other beelining
    // goal in the system: SEEK_TREASURE, SEEK_HEAL, SEEK_KEY_CHEST are
    // all knowledge-gated the same way). Room-find rolls in
    // `_lichOnAdvRoomChanged` are NOT gated because the adv is standing
    // in the heart's room — observation is automatic at that point.
    //
    // Heart-life gate (2026-05-27): when the boss is currently kept alive
    // by the heart (`boss._onHeartLife`), every adv WHO KNOWS about the
    // heart auto-hunts. Without knowledge they fall through to normal
    // wave behaviour — they'll head to the throne, get bounced by the
    // _diedThisDay handoff, and flee. The previous `noNormalLivesLeft`
    // gate never fired in practice because the revive at fight-resolution
    // bumps deathsRemaining back to 1 immediately.
    if (this._archId() === 'lich') {
      const phyl = this._gameState?.phylactery
      const boss = this._gameState?.boss
      const onHeartLife = !!boss?._onHeartLife
      // Heart-life gate (2026-05-27, design refresh): the heart is
      // invisible-as-target until it has saved the boss once. Before
      // the first revive, NO adventurer auto-hunts the heart at spawn
      // — the player is free to hide the heart and have it sit
      // unmolested while the normal-life economy plays out. The moment
      // the heart revives the boss (`boss._onHeartLife` flips true in
      // BossSystem._resolveFight), every knowledgeable adv in every
      // subsequent wave commits to the heart instead of the throne.
      // Replaces the prior 15%-baseline spawn-roll
      // (LICH_PHYLACTERY_HUNT_CHANCE) which leaked pre-revive hunters
      // and conflicted with the "only after revive" intent.
      //
      // Same-day rest gate: also pause on `_diedThisDay`. The day the
      // boss falls (revive or not), no new hunters spawn — the heart
      // gets a guaranteed safe day before the dungeon resumes hunting.
      if (onHeartLife && !boss?._diedThisDay && phyl && (phyl.resources?.hp ?? 0) > 0) {
        for (const adv of advs) {
          if (!adv) continue
          // Knowledge gate — adv must have heart in their personal
          // knowledge bucket (KnowledgeSystem copies from shared pool on
          // spawn so inherited intel counts).
          const knowsHeart = !!adv.knowledge?.items?.[phyl.instanceId]
          if (!knowsHeart) continue
          adv._huntPhylactery = true
          adv.goal = { type: 'HUNT_PHYLACTERY', roomId: phyl.roomId }
          adv.path = null
        }
      }
    }

    // VAMPIRE: charm N random advs per spawning batch (one per day baseline,
    // +0.25 per boss-lv → 1 extra every 4 lv; lv10 = 1 + floor(10*0.25) = 3).
    // THE BLOOD SOVEREIGN — the Court grows with the acts: +CHARM_PER_ACT per act,
    // so by the late game whole parties get pulled into the Court each dawn.
    if (this._archId() === 'vampire') {
      const bossLv = this._gameState?.boss?.level ?? 1
      const charmCount = Balance.VAMPIRE_CHARM_USES_PER_DAY_BASE
        + Math.floor(bossLv * Balance.VAMPIRE_CHARM_USES_PER_BOSS_LV)
        + (currentAct(this._gameState) - 1) * (Balance.VAMPIRE_COURT_CHARM_PER_ACT ?? 1)
      // Sung Jinwoo can't be charmed — the vampire can't turn the Shadow
      // Monarch into a thrall (that would "kill"/remove him; only the boss
      // duel can take him down).
      const eligible = advs.filter(a => a && (a.resources?.hp ?? 0) > 0 && !a._shadowMonarch && !a._lightParty)
      if (eligible.length > 0) {
        const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
        if (bossRoom) {
          // Fisher-Yates partial shuffle to pick distinct advs uniformly.
          const pool = eligible.slice()
          const pickN = Math.min(charmCount, pool.length)
          for (let i = 0; i < pickN; i++) {
            const j = i + Math.floor(Math.random() * (pool.length - i))
            const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp
          }
          for (let i = 0; i < pickN; i++) {
            const pick = pool[i]
            pick._charmed = true
            EventBus.emit('STATUS_APPLIED', { targetId: pick.instanceId, label: 'CHARMED' })
            // Detach from party for the walk so allies don't drag them back via
            // FOLLOW_LEADER goals later.
            pick._charmedFormerPartyId = pick.partyId ?? null
            pick.partyId = null
            pick.goal = { type: 'CHARM_WALK', roomId: bossRoom.instanceId }
            pick.path = null
            EventBus.emit('VAMPIRE_CHARM_MARKED', { advId: pick.instanceId })
          }
        }
      }
    }
  }

  // Called from Game.update once per frame. Dispatches per-archetype tick
  // logic (Lich phylactery damage, Lizardman venom DoT, Myconid spores +
  // corpse contact, etc). Per-archetype gates are inside each helper.
  tick(delta) {
    // Venom stack DoT — runs whenever ANY adv has stacks (Lizardman applies
    // them on hit, Myconid applies them on corpse contact, etc).
    this._tickVenom()
    // Myconid spore-cloud damage + corpse-touch venom-stack application.
    this._tickMyconid(delta)
    // Wraith fear-threshold reactions + haunt-ghost wall-phasing.
    this._tickWraith()
    // Demon imp roaming (rotates assignedRoomId every ~6 s).
    this._tickDemonImps(this._scene?.time?.now ?? 0)
    // Vampire charm-conversion + thrall roaming.
    this._tickVampire(this._scene?.time?.now ?? 0)
    // Gnoll THE BLOOD HUNT — frenzy recompute (pack atk+speed) + hunt pursuit.
    this._tickGnoll(delta)
    // Succubus shapeshifter+seductress: trigger + bat flight + charm.
    this._tickSuccubus(delta, this._scene?.time?.now ?? 0)
    // Succubus THE RAPTURE — ALLURE trickle + Entrancing Aura / Rapture pulses.
    this._tickRapture(this._scene?.time?.now ?? 0)
    // Orc Loot+Warband live recompute.
    this._tickOrc()
    // Orc Trophy Hunter — Mastery aura (T3+) dungeon-wide passive recompute.
    this._tickMastery(delta)
    // Lich THE WITHERING — soul-essence regen + active-ability DoTs (wither/cage)
    // + the orbiting soul-count tell.
    this._lichRegenTick(delta)
    this._tickSoulRot(this._scene?.time?.now ?? 0)
    this._tickSoulOrbit()
    // Slime MITOSIS — day-phase budding / coalesce / acidic trail.
    this._tickSlimeDay(delta)
    // Demon THE BRIMSTONE PACT — passive regen lifeline + Ascendance + the
    // lingering burning-ground zones left by Infernal Pact.
    this._tickDemonBrimstone(delta)
    this._tickDemonHellfire(this._scene?.time?.now ?? 0)
    // Golem THE LIVING FORTRESS — Aftershock + lingering fissure zones.
    this._tickGolem(this._scene?.time?.now ?? 0)
    // Lizardman THE PLAGUE-BEARER — plague DoT + contagion spread.
    this._tickPlague(this._scene?.time?.now ?? 0)
    if (this._archId() !== 'lich') return
    const phyl = this._gameState?.phylactery
    if (!phyl) return
    if ((phyl.resources?.hp ?? 0) <= 0) {
      // First-time-zero — emit the destroyed event, route survivors into FLEE.
      if (!phyl._destroyedEmitted) {
        phyl._destroyedEmitted = true
        EventBus.emit('PHYLACTERY_DESTROYED', { phylactery: phyl })
        // Drop the entity from gameState now that VFX/UI has had its event.
        this._gameState.phylactery = null
        // One heart per run (2026-05-27): destruction is permanent. The
        // player can't place a new phylactery for the rest of this run.
        // Latches on the player state so it survives save/load and the
        // night build phase. ONLY destruction (this path) sets the flag —
        // selling or moving the heart emits PHYLACTERY_REMOVED instead
        // and leaves the flag clear, so the player can freely reposition
        // a still-alive heart without losing the option to re-place it.
        this._gameState.player ??= {}
        this._gameState.player._phylacteryDestroyedThisRun = true
        // Heart destruction = end-of-day (2026-05-27). Mirror the "boss
        // killed" path: every active adv flees as if the boss had just
        // fallen, and `_diedThisDay` latches on the boss so any later-
        // arriving wave is bounced by `_onIncoming`'s existing handoff.
        // The boss itself is still alive (revive bumped deathsRemaining
        // to 1 earlier); they just can't be fought again until tomorrow.
        //
        // AT_BOSS advs are skipped — they're inside an active fight
        // BossSystem owns; the fight runs to its natural resolution and
        // BossSystem dispatches its own flee on survivors. Already-
        // fleeing advs are also skipped so we don't reset their reason.
        const boss = this._gameState?.boss
        if (boss) boss._diedThisDay = true
        for (const a of this._gameState?.adventurers?.active ?? []) {
          if (!a) continue
          if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
          if (a.goal?.type === 'AT_BOSS') continue
          a._huntPhylactery = false
          if (a.goal?.type !== 'FLEE') {
            a.goal = { type: 'FLEE', reason: 'phylactery_destroyed' }
            a.aiState = 'fleeing'
            a.path = null
          }
        }
      }
      return
    }
    const boss = this._gameState?.boss
    // Same-day rest period (2026-05-27): once the boss has fallen this
    // day (whether or not the fall triggered a heart-revive), no more
    // damage lands on the heart for the rest of the day. The flag is
    // `_diedThisDay`, set in BossSystem._resolveFight and cleared in
    // _onNightStartedAI overnight. Combined with the gates on
    // _onAdvsSpawned / _lichOnAdvRoomChanged / SEEK_BOSS-redirect,
    // this makes the day OF a death/revive a guaranteed "wounds are
    // licked" pause — the dungeon-wide heart hunt resumes next day.
    // We bail BEFORE _lastTickAt advances so subsequent fresh days
    // resume on a clean 800ms cadence rather than firing a backlog.
    if (boss?._diedThisDay) {
      // One-shot cleanup of in-flight hunters when _diedThisDay flips.
      // Runs every tick during the rest period but no-ops after the
      // first pass when no HUNT_PHYLACTERY advs remain. Sends them home
      // with the same `boss_defeated` reason any post-fight flee uses
      // — to them, the boss is "gone" and there's nothing more to do.
      for (const a of this._gameState?.adventurers?.active ?? []) {
        if (a?.goal?.type !== 'HUNT_PHYLACTERY') continue
        if (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
        a._huntPhylactery = false
        a.goal = { type: 'FLEE', reason: 'boss_defeated' }
        a.aiState = 'fleeing'
        a.path = null
      }
      return
    }
    const now = this._scene?.time?.now ?? 0
    phyl._lastTickAt ??= 0
    if (now - phyl._lastTickAt < Balance.LICH_PHYLACTERY_DMG_INTERVAL_MS) return
    phyl._lastTickAt = now

    const advs = this._gameState?.adventurers?.active ?? []
    let totalDmg = 0
    let totalBossBleed = 0
    let attackerName = null
    for (const a of advs) {
      if (!a || a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
      if (a.goal?.type !== 'HUNT_PHYLACTERY') continue
      if (Math.abs(a.tileX - phyl.tileX) + Math.abs(a.tileY - phyl.tileY) > 1) continue
      const dmg = Math.max(1, a.stats?.attack ?? 1)
      phyl.resources.hp = Math.max(0, (phyl.resources.hp ?? 0) - dmg)
      totalDmg += dmg
      attackerName = attackerName ?? a.name
      EventBus.emit('COMBAT_HIT', {
        sourceId:   a.instanceId,
        targetId:   phyl.instanceId,
        damage:     dmg,
        damageType: 'phylactery_attack',
      })
      // Heart→boss damage mirror (2026-05-27, balance nerf). The heart
      // is bound to the boss's life force, so every blow that lands on
      // the heart bleeds the boss for the same amount. 1:1 magnitude.
      //
      // Notes on the wipe-windows: between fights with boss.hp==0,
      // `_onIncoming` refills hp to maxHp on the next BOSS_FIGHT_INCOMING,
      // so chip damage in death-pose is wasted. Damage during an active
      // fight, between fights with hp>0 (boss survived last fight), and
      // pre-first-fight chip damage all carry into the next fight.
      //
      // No COMBAT_HIT emit for this — that event triggers VFX (damage
      // numbers floating above the target) and aggro/retaliation, both
      // of which would misfire on the boss sitting in its chamber out-
      // of-fight. The dedicated BOSS_HEART_BLEED event below lets any
      // future HP-bar or VFX layer subscribe deliberately.
      if (boss) {
        boss.hp = Math.max(0, (boss.hp ?? 0) - dmg)
        totalBossBleed += dmg
      }
      if (phyl.resources.hp <= 0) break
    }
    if (totalDmg > 0) {
      EventBus.emit('PHYLACTERY_DAMAGED', {
        phylactery:  phyl,
        damage:      totalDmg,
        attackerName,
        hp:          phyl.resources.hp,
      })
    }
    if (totalBossBleed > 0 && boss) {
      EventBus.emit('BOSS_HEART_BLEED', {
        damage:       totalBossBleed,
        attackerName,
        hp:           boss.hp,
        maxHp:        boss.maxHp,
      })
    }
    // Lich Necromancy: per-tick ability ticks for raised dead.
    this._tickRaisedClerics()
    this._tickRaisedBards()
  }

  // ── LICH: Necromancy ────────────────────────────────────────────────────
  // Adv kills queue onto gameState._lich.pendingRaises in _onAdvDied. At the
  // next dawn (DAY_PHASE_BEGAN) we cull expired skeletons and raise the
  // queue. Skeletons live for one full day, then despawn at the following
  // dawn.

  _cullExpiredRaised() {
    if (!Array.isArray(this._gameState?.minions)) return
    const today = this._gameState.meta?.dayNumber ?? 1
    const before = this._gameState.minions.length
    this._gameState.minions = this._gameState.minions.filter(m => {
      if (!m._raisedFromAdvDeath) return true
      // Spawned at dawn N, expires at end of dawn N+LIFESPAN — we cull the
      // morning of dawn N+LIFESPAN+1. With LIFESPAN=1, that's dawn N+2.
      return today < (m._expireAtDay ?? 0)
    })
    const removed = before - this._gameState.minions.length
    if (removed > 0) {
      EventBus.emit('NECROMANCY_RAISED_EXPIRED', { count: removed })
    }
  }

  _raiseQueuedDead() {
    const queue = this._gameState?._lich?.pendingRaises
    if (!Array.isArray(queue) || queue.length === 0) return
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const skeletonDef = minionTypes.find(m => m.id === 'skeleton1')
    if (!skeletonDef) return
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) { queue.length = 0; return }

    const today    = this._gameState.meta?.dayNumber ?? 1
    const bossLv   = this._gameState.boss?.level ?? 1
    // Spawn at dawn N, expire at dawn (N + LIFESPAN). With LIFESPAN=1 the
    // skeleton lives exactly through one day and is culled at the very next
    // dawn (cull rule: today < _expireAtDay).
    const expireOn = today + Balance.NECROMANCY_LIFESPAN_DAYS

    const TS = Balance.TILE_SIZE
    const cx = bossRoom.gridX + Math.floor(bossRoom.width  / 2)
    const cy = bossRoom.gridY + Math.floor(bossRoom.height / 2)

    // Cap the Lich's standing undead army. Count skeletons still alive
    // from earlier days, then raise only enough to reach the cap — a big
    // kill day can't flood the dungeon. Excess queued dead are dropped
    // (the queue is drained below regardless).
    const aliveRaised = (this._gameState.minions ?? []).filter(
      m => m._raisedFromAdvDeath && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0,
    ).length
    // +0.5 cap per boss-lv (lv10 = +5 → 10 raised). bossLv already captured above.
    const raisedCap = Balance.NECROMANCY_MAX_RAISED
      + Math.floor(bossLv * Balance.NECROMANCY_MAX_RAISED_PER_BOSS_LV)
    const raiseCount = Math.max(0, Math.min(
      queue.length,
      raisedCap - aliveRaised,
    ))

    const raised = []
    for (let i = 0; i < raiseCount; i++) {
      const entry = queue[i]
      // Spread spawn tiles in a small ring around boss-chamber center so they
      // don't all stack on the same tile.
      const angle = (i / Math.max(1, raiseCount)) * Math.PI * 2
      const r = 2 + (i % 2)
      const tx = cx + Math.round(Math.cos(angle) * r)
      const ty = cy + Math.round(Math.sin(angle) * r)

      const minion = createMinion(
        skeletonDef,
        { x: tx, y: ty },
        bossRoom.instanceId,
        { class: 'garrison', bossLevel: bossLv },
      )
      minion.isUndead             = true
      minion._raisedFromAdvDeath  = true
      minion._raisedClassId       = entry.classId
      minion._raisedAdvName       = entry.name
      minion._raisedSpriteVariant = entry.spriteVariant ?? null
      minion._expireAtDay         = expireOn

      // Lightweight class retention — boost the skeleton based on the
      // adventurer's old class. Cleric heal is handled in _tickRaisedClerics.
      this._applyClassRetentionBuffs(minion, entry.classId)
      // Re-apply boss+day scaling on top of any base-stat tweaks above.
      applyMinionScaling(minion, bossLv, this._gameState?.meta?.dayNumber ?? 1)

      this._gameState.minions.push(minion)
      raised.push(minion)
      EventBus.emit('MINION_PLACED', { minion })
    }
    // Drain the queue.
    queue.length = 0
    if (raised.length > 0) {
      EventBus.emit('NECROMANCY_RAISED', { count: raised.length, minionIds: raised.map(m => m.instanceId) })
    }
  }

  _applyClassRetentionBuffs(minion, classId) {
    if (!classId) return
    minion.stats ??= {}
    switch (classId) {
      case 'cleric': {
        // Cleric raises heal nearby allied minions every couple seconds —
        // their attack stat reads "wisdom" for mood; combat is handled
        // by the heal tick. Mark range so MinionAISystem treats them like a
        // standoff caster. Defense bumped so they're not first-pick targets.
        minion.stats.defense = (minion.stats.defense ?? 0) + 2
        minion.attackRange   = 2
        minion.tags          = [...(minion.tags ?? []), 'caster', 'support']
        break
      }
      case 'mage': {
        // Mage raise: ranged attacker with a small ATK bump.
        minion.stats.attack  = (minion.stats.attack ?? 0) + 2
        minion.attackRange   = 3
        minion.damageType    = 'arcane'
        minion.tags          = [...(minion.tags ?? []), 'caster']
        break
      }
      case 'ranger': {
        minion.stats.attack  = (minion.stats.attack ?? 0) + 1
        minion.attackRange   = 3
        break
      }
      case 'knight': {
        minion.resources.maxHp = (minion.resources.maxHp ?? 16) + 8
        minion.resources.hp    = minion.resources.maxHp
        minion.stats.defense   = (minion.stats.defense ?? 0) + 2
        break
      }
      case 'barbarian': {
        minion.stats.attack    = (minion.stats.attack ?? 0) + 3
        minion.stats.defense   = Math.max(0, (minion.stats.defense ?? 0) - 1)
        break
      }
      case 'monk': {
        minion.stats.attack    = (minion.stats.attack ?? 0) + 1
        minion.stats.speed     = (minion.stats.speed   ?? 1) * 1.15
        break
      }
      case 'rogue': {
        minion.stats.attack    = (minion.stats.attack ?? 0) + 2
        minion.stats.speed     = (minion.stats.speed   ?? 1) * 1.10
        break
      }
      case 'bard':
      case 'beast_master':
      case 'necromancer':
      default: {
        minion.stats.attack    = (minion.stats.attack ?? 0) + 1
        break
      }
    }
  }

  // ── LIZARDMAN: Camouflage + Venom Stack ────────────────────────────────

  _onMinionPlaced(payload) {
    const m = payload?.minion
    if (!m) return
    // LIZARDMAN: stamp camouflage on freshly placed lizardman-tagged minions.
    if (this._archId() === 'lizardman' && this._isLizardmanMinion(m)) {
      m._camouflaged = true
    }
    // ORC: capture this minion's pristine baseline (for Loot+Warband recompute).
    if (this._archId() === 'orc' && this._isOrcMinion(m)) {
      this._captureOrcBaseline(m)
    }
  }

  _isOrcMinion(m) {
    return !!(m && Array.isArray(m.tags) && m.tags.includes(MINION_TAG_ORC))
  }

  _captureOrcBaseline(m) {
    if (!m) return
    // Strip any active Loot/Warband contribution so the captured value is
    // truly the un-buffed baseline. lootAtkBonus is additive; Warband is
    // multiplicative; we only ever read from the canonical baseline forward.
    m._orcBaseAttack  = Math.max(0, (m.stats?.attack  ?? 0) - (m.lootAtkBonus ?? 0))
    m._orcBaseDefense = m.stats?.defense ?? 0
  }

  _onCombatHit(payload) {
    const dmg = payload?.damage ?? 0
    if (dmg <= 0) return

    // LIZARDMAN — Venom Stack accrual on minion hit.
    if (this._archId() === 'lizardman') {
      const m = this._findMinion(payload?.sourceId)
      if (this._isLizardmanMinion(m)) {
        const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.targetId)
        if (adv) {
          const wasClean = !adv._venomStacks
          adv._venomStacks = (adv._venomStacks ?? 0) + 1
          // First-stack-only float so a venom-storm doesn't spam POISONED.
          if (wasClean) {
            EventBus.emit('STATUS_APPLIED', { targetId: adv.instanceId, label: 'POISONED' })
          }
          EventBus.emit('LIZARDMAN_VENOM_APPLIED', {
            advId:  adv.instanceId,
            stacks: adv._venomStacks,
          })
        }
      }
    }

    // VAMPIRE — THE BLOOD SOVEREIGN. Every point of damage the dungeon deals to a
    // hero feeds the banked BLOOD pool (the economy). Minion damage also heals the
    // boss outright (canon Blood Tax); T3 Sanguine Vigor extends that lifesteal to
    // the boss's own (non-minion) damage while BLOOD is high.
    if (this._archId() === 'vampire') {
      const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.targetId)
      if (adv) {
        const boss = this._gameState?.boss
        // Bank a cut of ALL dungeon damage dealt to heroes.
        this._bankBlood(dmg * (Balance.VAMPIRE_BLOOD_PER_DMG_FRAC ?? 0.3), adv.worldX, adv.worldY)
        const m = this._findMinion(payload?.sourceId)
        const fromMinion = !!(m && m.faction !== 'adventurer')
        let healFrac = 0
        if (fromMinion) healFrac = 1                                   // canon Blood Tax
        else if (currentAct(this._gameState) >= 3 && this._bloodSat() >= (Balance.VAMPIRE_BLOOD_VIGOR_SAT ?? 0.5))
          healFrac = (Balance.VAMPIRE_BLOOD_VIGOR_LIFESTEAL ?? 0.25)   // T3 Sanguine Vigor
        if (boss && healFrac > 0) {
          const before = boss.hp ?? 0
          boss.hp = Math.min(boss.maxHp ?? before, before + dmg * healFrac)
          const healed = boss.hp - before
          if (healed >= (Balance.VAMPIRE_BLOOD_TAX_VFX_MIN_DMG ?? 1)) {
            EventBus.emit('VAMPIRE_BLOOD_TAX_TICK', {
              fromX: adv.worldX, fromY: adv.worldY,
              toX:   boss.worldX, toY: boss.worldY,
              amount: healed,
            })
          }
        }
      }
    }

    // GNOLL — THE BLOOD HUNT. A cut of all damage the pack/Alpha deal to heroes
    // feeds FEROCITY (the carnage that fuels the frenzy + the hunts).
    if (this._archId() === 'gnoll') {
      const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.targetId)
      if (adv) {
        const m = this._findMinion(payload?.sourceId)
        if (payload?.sourceId === 'boss' || this._isGnollMinion(m)) {
          this._bankFerocity(dmg * (Balance.GNOLL_FEROCITY_PER_DMG_FRAC ?? 0.25))
        }
      }
    }
  }

  _onAdvFledOrDied(payload) {
    const adv = payload?.adventurer
    if (!adv) return
    if (adv._venomStacks) adv._venomStacks = 0
  }

  _tickVenom() {
    // Generic venom-stack DoT — runs whenever an adv has stacks, regardless
    // of which archetype put them there (Lizardman attacks, Myconid corpse
    // contact, future hooks). Cheap when nobody is poisoned.
    const advs = this._gameState?.adventurers?.active ?? []
    const now = this._scene?.time?.now ?? 0
    for (const adv of advs) {
      if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const stacks = adv._venomStacks ?? 0
      if (stacks <= 0) continue
      adv._venomLastTickAt ??= 0
      if (now - adv._venomLastTickAt < Balance.LIZARDMAN_VENOM_TICK_INTERVAL_MS) continue
      adv._venomLastTickAt = now
      // +0.5 dmg/stack per boss-lv (floor): lv10 = +5 → 6 dmg/stack/tick.
      const bossLv = this._gameState?.boss?.level ?? 1
      const dmgPerStack = Balance.LIZARDMAN_VENOM_DMG_PER_STACK
        + Math.floor(bossLv * Balance.LIZARDMAN_VENOM_DMG_PER_BOSS_LV)
      const tickDmg = stacks * dmgPerStack
      const before = adv.resources.hp
      adv.resources.hp = Math.max(this._shadowFloor(adv), before - tickDmg)
      EventBus.emit('COMBAT_HIT', {
        sourceId:   'venom',
        targetId:   adv.instanceId,
        damage:     tickDmg,
        damageType: 'poison',
      })
      if (adv.resources.hp <= 0) {
        EventBus.emit('ADVENTURER_DIED', {
          adventurer: adv,
          killerId:   'venom',
          killerName: 'Venom',
          roomId:     null,
          damageType: 'poison',
        })
      }
    }
  }

  _tickRaisedClerics() {
    if (this._archId() !== 'lich') return
    const minions = this._gameState?.minions ?? []
    const now = this._scene?.time?.now ?? 0
    for (const m of minions) {
      if (!m._raisedFromAdvDeath || m._raisedClassId !== 'cleric') continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      m._lastClericHealAt ??= 0
      if (now - m._lastClericHealAt < Balance.NECROMANCY_CLERIC_HEAL_INTERVAL_MS) continue
      m._lastClericHealAt = now
      // Heal the most-wounded ally minion within Manhattan dist 3.
      let target = null
      let bestDeficit = 0
      for (const ally of minions) {
        if (ally === m) continue
        if (ally.aiState === 'dead' || (ally.resources?.hp ?? 0) <= 0) continue
        if (ally.faction && ally.faction !== 'dungeon') continue
        const max = ally.resources?.maxHp ?? 0
        const cur = ally.resources?.hp    ?? 0
        const def = max - cur
        if (def <= 0) continue
        if (Math.abs(ally.tileX - m.tileX) + Math.abs(ally.tileY - m.tileY) > 3) continue
        if (def > bestDeficit) { bestDeficit = def; target = ally }
      }
      if (!target) continue
      // +1 heal-per-tick per boss-lv beyond 1 (lv10 = +9 → 13/tick).
      const bossLv = this._gameState?.boss?.level ?? 1
      const healAmount = Balance.NECROMANCY_CLERIC_HEAL_AMOUNT
        + (bossLv - 1) * Balance.NECROMANCY_CLERIC_HEAL_PER_BOSS_LV
      const heal = Math.min(bestDeficit, healAmount)
      target.resources.hp += heal
      EventBus.emit('NECROMANCY_CLERIC_HEAL', {
        sourceId: m.instanceId,
        targetId: target.instanceId,
        amount:   heal,
      })
    }
  }

  // Raised Bard aura — every tick, every dungeon minion within
  // NECROMANCY_BARD_AURA_RANGE_TILES of a raised bard gets a +15% ATK
  // baseline-aware buff for the next ~250 ms (re-stamped each frame the
  // minion is in range, so the buff persists while inside and decays
  // naturally when leaving). Does not stack between bards.
  _tickRaisedBards() {
    if (this._archId() !== 'lich') return
    const minions = this._gameState?.minions ?? []
    if (minions.length === 0) return
    const now    = this._scene?.time?.now ?? 0
    const range  = Balance.NECROMANCY_BARD_AURA_RANGE_TILES ?? 4
    const buffMs = 250                  // refreshed every tick, decays if out of range
    const mul    = 1 + (Balance.NECROMANCY_BARD_AURA_ATK_PCT ?? 0.15)
    for (const bard of minions) {
      if (!bard._raisedFromAdvDeath || bard._raisedClassId !== 'bard') continue
      if (bard.aiState === 'dead' || (bard.resources?.hp ?? 0) <= 0) continue
      for (const ally of minions) {
        if (ally === bard) continue
        if (ally.aiState === 'dead' || (ally.resources?.hp ?? 0) <= 0) continue
        if (ally.faction && ally.faction !== 'dungeon') continue
        const d = Math.abs(ally.tileX - bard.tileX) + Math.abs(ally.tileY - bard.tileY)
        if (d > range) continue
        // Stamp baseline once so the buff is reversible without losing
        // intermediate adjustments (orc warband, evolution, etc).
        if (ally._raisedBardBaselineAtk == null) {
          ally._raisedBardBaselineAtk = ally.stats?.attack ?? 0
        }
        ally.stats.attack = Math.round(ally._raisedBardBaselineAtk * mul)
        ally._raisedBardBuffUntil = now + buffMs
      }
    }
    // Decay pass — any minion whose buff has expired reverts to baseline
    // and the baseline tag is cleared so future bards can re-stamp.
    for (const m of minions) {
      if (m._raisedBardBuffUntil == null) continue
      if (now < m._raisedBardBuffUntil) continue
      if (m._raisedBardBaselineAtk != null) {
        m.stats.attack = m._raisedBardBaselineAtk
        m._raisedBardBaselineAtk = null
      }
      m._raisedBardBuffUntil = null
    }
  }

  // ── MYCONID: Spore Network + Corpse Bloom ──────────────────────────────

  _onRoomRemovedMyconid(payload) {
    if (this._archId() !== 'myconid') return
    const room = payload?.room
    if (!room) return
    const list = this._gameState?.fungalCorpses ?? []
    if (list.length === 0) return
    this._gameState.fungalCorpses = list.filter(c => c.roomId !== room.instanceId)
  }

  _isCorridorRoom(room) {
    if (!room) return false
    if (room.definitionId === 'starter_corridor') return true
    if (Array.isArray(room.tags) && room.tags.includes('corridor')) return true
    return false
  }

  // THE BLOOM — colony bookkeeping.
  _bloomRoom(roomId) {
    const boss = this._gameState?.boss
    if (!boss || !roomId) return false
    boss.bloomedRooms ??= []
    if (boss.bloomedRooms.includes(roomId)) return false
    boss.bloomedRooms.push(roomId)
    EventBus.emit('MYCONID_ROOM_BLOOMED', { roomId, total: boss.bloomedRooms.length })
    return true
  }
  _isBloomed(room) {
    return !!room && (this._gameState?.boss?.bloomedRooms ?? []).includes(room.instanceId)
  }
  _bloomedRoomObjs() {
    const ids = this._gameState?.boss?.bloomedRooms ?? []
    if (ids.length === 0) return []
    const rooms = this._gameState?.dungeon?.rooms ?? []
    return rooms.filter(r => ids.includes(r.instanceId))
  }
  _biomassCap() {
    return (Balance.MYCONID_BIOMASS_CAP_BASE ?? 60) + currentAct(this._gameState) * (Balance.MYCONID_BIOMASS_CAP_PER_ACT ?? 40)
  }
  _biomassSat() {
    return Math.max(0, Math.min(1, (this._gameState?.boss?.biomass ?? 0) / Math.max(1, this._biomassCap())))
  }
  // Rooms within 1 tile of `room` (bounding-box adjacency) — where the Bloom creeps.
  _adjacentRooms(room) {
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const ax0 = room.gridX - 1, ay0 = room.gridY - 1
    const ax1 = room.gridX + room.width, ay1 = room.gridY + room.height
    return rooms.filter(r => {
      if (r === room || r.instanceId === room.instanceId) return false
      const bx1 = r.gridX + r.width - 1, by1 = r.gridY + r.height - 1
      return ax0 <= bx1 && ax1 >= r.gridX && ay0 <= by1 && ay1 >= r.gridY
    })
  }

  _bloomDayBegan() {
    if (this._archId() !== 'myconid') return
    const boss = this._gameState?.boss
    if (!boss) return
    boss.bloomedRooms ??= []
    boss.biomass = (boss.biomass ?? 0) + boss.bloomedRooms.length * (Balance.MYCONID_BIOMASS_PER_BLOOM_PER_DAY ?? 3)
    // T3 Spread — each bloomed room may creep into an adjacent room overnight.
    if (currentAct(this._gameState) >= 3) {
      const chance = Math.min(Balance.MYCONID_SPREAD_CHANCE_CAP ?? 0.75,
        (Balance.MYCONID_SPREAD_CHANCE_BASE ?? 0.25) + (boss.biomass ?? 0) * (Balance.MYCONID_SPREAD_CHANCE_PER_BIOMASS ?? 0.004))
      for (const id of boss.bloomedRooms.slice()) {
        if (Math.random() >= chance) continue
        const room = (this._gameState.dungeon?.rooms ?? []).find(r => r.instanceId === id)
        if (!room) continue
        const open = this._adjacentRooms(room).filter(r => !boss.bloomedRooms.includes(r.instanceId))
        if (open.length === 0) continue
        this._bloomRoom(open[Math.floor(Math.random() * open.length)].instanceId)
      }
    }
    EventBus.emit('MYCONID_BLOOM_DAY', { bloomed: boss.bloomedRooms.length, biomass: Math.floor(boss.biomass ?? 0) })
  }

  // ── SEED THE BLOOM (active day ability) — arm → click a room → colonize it ──
  _seedUsesLeft() { return this._gameState?.boss?._myconidSeed?.usesLeft ?? 0 }
  _seedAvailable() {
    return this._archId() === 'myconid' && (this._gameState?.meta?.phase ?? '') === 'day' && this._seedUsesLeft() > 0
  }
  _armSeed() { if (!this._seedAvailable()) return; this._seedArmed = true; EventBus.emit('MYCONID_SEED_ARMED', {}) }
  _disarmSeed() { this._seedArmed = false; EventBus.emit('MYCONID_SEED_DISARMED', {}) }

  _fireSeed(payload) {
    if (!this._seedArmed) return
    if (!this._seedAvailable()) { this._disarmSeed(); return }
    const boss = this._gameState?.boss
    const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const tier = currentAct(this._gameState)
    const now  = this._scene?.time?.now ?? 0
    const TS   = Balance.TILE_SIZE

    this._bloomRoom(room.instanceId)
    // T2+ — an immediate spore-burst on whoever's caught in the new bloom.
    const advsIn = (this._gameState.adventurers?.active ?? []).filter(a => (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, room))
    if (tier >= 2) {
      for (const a of advsIn) {
        const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * (Balance.MYCONID_SEED_BURST_DMG_PCT ?? 0.08)))
        a.resources.hp = Math.max(this._shadowFloor(a), a.resources.hp - dmg)
        a._noHealUntil = Math.max(a._noHealUntil ?? 0, now + (Balance.MYCONID_BLOOM_HEALBLOCK_MS ?? 1500))
        EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'poison' })
        if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'The Bloom', roomId: room.instanceId, damageType: 'poison' })
      }
    }
    const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
    AbilityVfx?.bloomFx?.(this._scene, cx, cy, { tier, rectW: room.width * TS, rectH: room.height * TS })
    if (tier >= 2) AbilityVfx?.sporeBurstFx?.(this._scene, cx, cy, { tier })
    this._renderBloomOverlay()   // include the newly-bloomed room

    if (boss._myconidSeed) boss._myconidSeed.usesLeft = Math.max(0, (boss._myconidSeed.usesLeft ?? 0) - 1)
    this._seedArmed = false
    EventBus.emit('MYCONID_SEED_FIRED', { roomId: room.instanceId, room, tier })
  }

  _clearSporeFx() {
    const fx = this._sporeFx
    if (!fx) return
    fx.container?.destroy?.(true)
    this._sporeFx = null
  }

  _renderBloomOverlay() {
    if (this._archId() !== 'myconid') return
    const s = this._scene
    if (!s?.add?.container) return

    // Tear down any previous overlay so we never leak particles when the
    // bloom set changes.
    this._clearSporeFx()

    const ids = this._gameState?.boss?.bloomedRooms ?? []
    if (ids.length === 0) return

    const TS    = Balance.TILE_SIZE
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const container = s.add.container(0, 0).setDepth(2.5)
    const roomFx = []

    for (const r of rooms) {
      if (!ids.includes(r.instanceId)) continue
      const px = r.gridX * TS
      const py = r.gridY * TS
      const pw = r.width  * TS
      const ph = r.height * TS

      // Deterministic seed → cloud shapes don't rearrange across saves.
      let seed = ((r.gridX + 1) * 73856093 ^ (r.gridY + 1) * 19349663) >>> 0
      const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
      }

      // Layered cloud puffs — overlapping translucent green discs with a
      // bright inner core, scattered across the room interior. Animated
      // alpha+scale via the per-frame _tickSporeVfx loop (NOT Phaser
      // tweens) — using infinite-yoyo tweens for every puff stalled the
      // main loop on days with many spore corridors.
      const inset  = TS * 0.45
      const minX   = px + inset
      const maxX   = px + pw - inset
      const minY   = py + inset
      const maxY   = py + ph - inset
      const area = r.width * r.height
      const puffCount = Math.min(6, Math.max(3, Math.floor(area / 10)))
      const puffs = []
      for (let i = 0; i < puffCount; i++) {
        const cx = minX + rand() * Math.max(1, (maxX - minX))
        const cy = minY + rand() * Math.max(1, (maxY - minY))
        const radius = TS * (0.75 + rand() * 0.55)
        const halo = s.add.circle(cx, cy, radius,        0x6abf3d, 0.10)
        const core = s.add.circle(cx, cy, radius * 0.55, 0x9ee870, 0.20)
        container.add([halo, core])
        puffs.push({
          halo, core,
          phase: rand() * Math.PI * 2,   // staggered breathing per puff
          freq:  0.0010 + rand() * 0.0008, // rad/ms
        })
      }

      // Drifting pixel spores — tiny green specks with random velocity
      // that wander across the room and fade in/out over their lifetime.
      // Animated per-frame in `_tickSporeVfx`.
      const particles = []
      const partCount = Math.min(18, Math.max(8, Math.floor(area / 5)))
      const bounds = {
        minX: px + 2, maxX: px + pw - 2,
        minY: py + 2, maxY: py + ph - 2,
      }
      for (let i = 0; i < partCount; i++) {
        const sprite = s.add.rectangle(
          bounds.minX + rand() * (bounds.maxX - bounds.minX),
          bounds.minY + rand() * (bounds.maxY - bounds.minY),
          2, 2,
          rand() < 0.25 ? 0xffffaa : 0xccff88,
          0.0,
        )
        container.add(sprite)
        const maxLife = 1800 + rand() * 1800
        particles.push({
          sprite,
          // px/ms — slow drift with a faint upward bias.
          vx:      (rand() - 0.5) * 0.030,
          vy:      (rand() - 0.5) * 0.030 - 0.012,
          life:    rand() * maxLife,
          maxLife,
          bounds,
        })
      }

      roomFx.push({ roomId: r.instanceId, particles, puffs })
    }

    this._sporeFx = { container, rooms: roomFx, elapsed: 0 }
  }

  // Per-frame spore drift + cloud-puff breathing. Manual animation
  // avoids the per-puff infinite-yoyo Phaser tweens that piled up on
  // big spore-network days and froze the main loop.
  _tickSporeVfx(deltaMs) {
    const fx = this._sporeFx
    if (!fx?.rooms?.length) return
    const dt = Math.max(1, Math.min(64, deltaMs))
    fx.elapsed = (fx.elapsed ?? 0) + dt
    const t = fx.elapsed
    for (const r of fx.rooms) {
      // Cloud puff breath — sin-curve alpha + slight core scale. Cheaper
      // than tweens because we only touch alpha/scale on a handful of
      // already-allocated Arc objects per room.
      for (const puff of (r.puffs ?? [])) {
        const ph = Math.sin(t * puff.freq + puff.phase)
        // halo breathes 0.18 ↔ 0.32 — the wide soft outer green wash
        puff.halo.setAlpha(0.25 + 0.07 * ph)
        // core breathes 0.40 ↔ 0.60 with scale 1.00 ↔ 1.18 — the bright
        // inner billow that reads as the cloud's mass
        puff.core.setAlpha(0.50 + 0.10 * ph)
        const sc = 1.09 + 0.09 * ph
        puff.core.setScale(sc, sc)
      }
      for (const p of r.particles) {
        p.life -= dt
        if (p.life <= 0) {
          const b = p.bounds
          p.sprite.x  = b.minX + Math.random() * (b.maxX - b.minX)
          p.sprite.y  = b.minY + Math.random() * (b.maxY - b.minY)
          p.vx        = (Math.random() - 0.5) * 0.030
          p.vy        = (Math.random() - 0.5) * 0.030 - 0.012
          p.maxLife   = 1800 + Math.random() * 1800
          p.life      = p.maxLife
          continue
        }
        p.sprite.x += p.vx * dt
        p.sprite.y += p.vy * dt
        const b = p.bounds
        if (p.sprite.x < b.minX)      { p.sprite.x = b.minX; p.vx = -p.vx }
        else if (p.sprite.x > b.maxX) { p.sprite.x = b.maxX; p.vx = -p.vx }
        if (p.sprite.y < b.minY)      { p.sprite.y = b.minY; p.vy = -p.vy }
        else if (p.sprite.y > b.maxY) { p.sprite.y = b.maxY; p.vy = -p.vy }
        // Sin-curve alpha — fade in then back out over the particle's life.
        const lt = 1 - (p.life / p.maxLife)
        p.sprite.setAlpha(0.15 + 0.75 * Math.sin(Math.PI * lt))
      }
    }
  }

  _tickFungalCorpseDay() {
    const list = this._gameState?.fungalCorpses ?? []
    if (list.length === 0) return
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const plantDef    = minionTypes.find(m => m.id === 'plant1')
    const bossLv      = this._gameState?.boss?.level ?? 1

    const remaining = []
    for (const c of list) {
      c.daysRemaining = (c.daysRemaining ?? 0) - 1
      if (c.daysRemaining > 0) {
        remaining.push(c)
        continue
      }
      // Sprout a free Vinekin in the corpse tile (if the room still exists).
      const room = this._gameState?.dungeon?.rooms?.find(r => r.instanceId === c.roomId)
      if (plantDef && room) {
        try {
          // bossLevel option already triggers applyBossLevelToMinion inside
          // createMinion — DO NOT call it a second time or stats double-scale.
          const minion = createMinion(
            plantDef,
            { x: c.tileX, y: c.tileY },
            c.roomId,
            { class: 'garrison', bossLevel: bossLv },
          )
          minion._myconidSprout = true
          this._gameState.minions.push(minion)
          EventBus.emit('MINION_PLACED', { minion })
          EventBus.emit('MYCONID_CORPSE_SPROUTED', {
            corpseId: c.instanceId,
            minionId: minion.instanceId,
            advId:    c.advId ?? null,
            tileX:    c.tileX,
            tileY:    c.tileY,
          })
        } catch (err) {
          // Don't let a sprout throw drag the entire DAY_PHASE_BEGAN tick
          // (and every other archetype/system listener after it) into a
          // halt. Log so we can see what failed and continue.
          console.error('[Myconid] Vinekin sprout failed:', err, { corpse: c })
          EventBus.emit('MYCONID_CORPSE_EXPIRED', { corpseId: c.instanceId })
        }
      } else {
        EventBus.emit('MYCONID_CORPSE_EXPIRED', { corpseId: c.instanceId })
      }
    }
    this._gameState.fungalCorpses = remaining
  }

  // ── GNOLL: Hunters Pack + Bloodlust ────────────────────────────────────

  _isHuntersPackGnoll(m) {
    return !!(m && m._isHuntersPackGnoll)
  }

  _expectedHuntersPackCount() {
    const lv = this._gameState?.boss?.level ?? 1
    // +0.5 pack-max per boss-lv (floor): lv10 = +5 → cap 10. Pack size still
    // scales with boss level (1-for-1) and is clamped by the new effective cap.
    const cap = Balance.GNOLL_HUNTERS_PACK_MAX
      + Math.floor(lv * Balance.GNOLL_HUNTERS_PACK_MAX_PER_BOSS_LV)
    return Math.min(cap, Math.max(1, lv))
  }

  // Spawn enough free gnoll1 minions in the boss chamber to bring the pack
  // back up to its expected count. Existing pack members (alive or culled
  // by night-respawn) keep their evolution / kill history.
  _refillHuntersPack() {
    if (this._archId() !== 'gnoll') return
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const gnollDef = minionTypes.find(m => m.id === 'gnoll1')
    if (!gnollDef) return
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    const minions = this._gameState?.minions ?? []
    // Count ALL pack gnolls (alive + dead) — dead ones will be revived by
    // respawnAll moments after this runs. Using alive-only would spawn a
    // replacement for every gnoll that died during the day, then respawnAll
    // would also revive the original, producing one extra gnoll per death.
    const totalCount = minions.filter(m => this._isHuntersPackGnoll(m)).length
    const need = this._expectedHuntersPackCount() - totalCount
    if (need <= 0) return

    const bossLv = this._gameState?.boss?.level ?? 1
    const cx = bossRoom.gridX + Math.floor(bossRoom.width  / 2)
    const cy = bossRoom.gridY + Math.floor(bossRoom.height / 2)

    // Use the effective (lv-scaled) cap for ring distribution so spawns spread
    // evenly across the larger pack at high boss-lv.
    const effectiveCap = Balance.GNOLL_HUNTERS_PACK_MAX
      + Math.floor(bossLv * Balance.GNOLL_HUNTERS_PACK_MAX_PER_BOSS_LV)
    for (let i = 0; i < need; i++) {
      const idx   = totalCount + i
      const angle = (idx / Math.max(1, effectiveCap)) * Math.PI * 2
      const r = 2 + (idx % 2)
      const tx = cx + Math.round(Math.cos(angle) * r)
      const ty = cy + Math.round(Math.sin(angle) * r)
      const minion = createMinion(
        gnollDef,
        { x: tx, y: ty },
        bossRoom.instanceId,
        { class: 'garrison', bossLevel: bossLv },
      )
      minion._isHuntersPackGnoll = true
      // bossLevel option already triggers applyBossLevelToMinion inside
      // createMinion — DO NOT call it a second time or stats double-scale.
      this._gameState.minions.push(minion)
      EventBus.emit('MINION_PLACED', { minion })
    }
    EventBus.emit('GNOLL_HUNTERS_PACK_REFILLED', { spawned: need, total: totalCount + need })
  }

  // Capture each gnoll-tagged minion's current ATK as the day's baseline so
  // Bloodlust can be cleanly recomputed and reset.
  _captureBloodlustBaselines() {
    const gs = this._gameState
    if (!gs) return
    gs._gnoll ??= { bloodlustStacks: 0 }
    gs._gnoll.bloodlustStacks = 0
    for (const m of (gs.minions ?? [])) {
      if (!this._isGnollMinion(m)) continue
      m._baselineAttack = m.stats?.attack ?? 1
      m._baselineSpeed  = m.stats?.speed ?? 1
    }
  }

  _isGnollMinion(m) {
    if (!m) return false
    if (this._isHuntersPackGnoll(m)) return true
    return Array.isArray(m.tags) && m.tags.includes('gnoll')
  }

  _applyBloodlustStack() {
    const gs = this._gameState
    if (!gs) return
    gs._gnoll ??= { bloodlustStacks: 0 }
    gs._gnoll.bloodlustStacks = (gs._gnoll.bloodlustStacks ?? 0) + 1
    const stacks = gs._gnoll.bloodlustStacks
    const mult = 1 + Balance.GNOLL_BLOODLUST_PCT_PER_KILL * stacks
    let touched = 0
    for (const m of (gs.minions ?? [])) {
      if (!this._isGnollMinion(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const base = m._baselineAttack ?? (m.stats?.attack ?? 1)
      m._baselineAttack = base
      m.stats ??= {}
      m.stats.attack = Math.max(1, Math.round(base * mult))
      touched++
    }
    EventBus.emit('GNOLL_BLOODLUST_STACK', {
      stacks,
      bonusPct: Balance.GNOLL_BLOODLUST_PCT_PER_KILL * stacks,
      gnollsBuffed: touched,
    })
  }

  _resetBloodlust() {
    const gs = this._gameState
    if (!gs) return
    gs._gnoll ??= { bloodlustStacks: 0 }
    gs._gnoll.bloodlustStacks = 0
    for (const m of (gs.minions ?? [])) {
      if (!this._isGnollMinion(m)) continue
      if (m._baselineAttack != null) {
        m.stats ??= {}
        m.stats.attack = m._baselineAttack
      }
    }
  }

  // ── GNOLL: THE BLOOD HUNT — banked FEROCITY economy ────────────────────────
  _ferocityCap() { return (Balance.GNOLL_FEROCITY_CAP_BASE ?? 60) + currentAct(this._gameState) * (Balance.GNOLL_FEROCITY_CAP_PER_ACT ?? 50) }
  _ferocitySat() { return Math.max(0, Math.min(1, (this._gameState?.boss?.ferocity ?? 0) / Math.max(1, this._ferocityCap()))) }
  _isFrenzied() { return this._ferocitySat() >= (Balance.GNOLL_FRENZY_THRESHOLD ?? 0.5) }

  _bankFerocity(amount) {
    const boss = this._gameState?.boss
    if (!boss || !(amount > 0)) return
    const before = boss.ferocity ?? 0
    boss.ferocity = Math.min(this._ferocityCap(), before + amount)
    const gained = boss.ferocity - before
    if (gained > 0) EventBus.emit('GNOLL_FEROCITY_BANKED', { amount: gained, total: boss.ferocity })
  }

  // Per-frame: FRENZY recompute (pack ATK + move SPEED scale with FEROCITY, atop
  // the daily Bloodlust ramp) + hunt pursuit (keep the pack swarming the mark).
  _tickGnoll(delta) {
    if (this._archId() !== 'gnoll') return
    const now = this._scene?.time?.now ?? 0
    if (now - (this._gnollFrenzyAt ?? 0) < 250) return
    this._gnollFrenzyAt = now
    const gs = this._gameState
    const sat = this._ferocitySat()
    const stacks = gs?._gnoll?.bloodlustStacks ?? 0
    const atkFrenzy = 1 + sat * (Balance.GNOLL_FRENZY_ATK_MAX ?? 0.6)
    const spdFrenzy = 1 + sat * (Balance.GNOLL_FRENZY_SPEED_MAX ?? 0.5)
    const bloodMult = 1 + (Balance.GNOLL_BLOODLUST_PCT_PER_KILL ?? 0.03) * stacks
    for (const m of (gs?.minions ?? [])) {
      if (!this._isGnollMinion(m)) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      m.stats ??= {}
      if (m._baselineAttack == null) m._baselineAttack = m.stats.attack ?? 1
      if (m._baselineSpeed  == null) m._baselineSpeed  = m.stats.speed ?? 1
      m.stats.attack = Math.max(1, Math.round(m._baselineAttack * bloodMult * atkFrenzy))
      m.stats.speed  = m._baselineSpeed * spdFrenzy
      m._frenzied    = sat >= (Balance.GNOLL_FRENZY_THRESHOLD ?? 0.5)   // MinionRenderer rage-glow tell
    }
    // Frenzy edge — howl once when FEROCITY first crosses the frenzy threshold.
    const frenziedNow = this._isFrenzied()
    if (frenziedNow && !this._wasFrenzied) {
      const boss = gs?.boss
      if (this._scene && Number.isFinite(boss?.worldX)) AbilityVfx?.frenzyHowlFx?.(this._scene, boss.worldX, (boss.worldY ?? 0) - 8, {})
      EventBus.emit('GNOLL_FRENZY_BEGAN', {})
    }
    this._wasFrenzied = frenziedNow
    // Pursuit — while a hunt-mark is live, keep the pack homed on the quarry room.
    if (this._huntMark && now < this._huntMark.until) {
      const room = (gs?.dungeon?.rooms ?? []).find(r => r.instanceId === this._huntMark.roomId)
      if (room) {
        const cx = room.gridX + Math.floor(room.width / 2), cy = room.gridY + Math.floor(room.height / 2)
        for (const m of (gs?.minions ?? [])) {
          if (!this._isHuntersPackGnoll(m) || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
          m.assignedRoomId = room.instanceId; m.homeTileX = cx; m.homeTileY = cy
        }
      } else { this._huntMark = null }
    } else if (this._huntMark) { this._huntMark = null }
  }

  // ── SOUND THE HUNT (day active) ────────────────────────────────────────────
  _huntUsesLeft() { return this._gameState?.boss?._gnollHunt?.usesLeft ?? 0 }
  _huntAvailable() { return this._archId() === 'gnoll' && (this._gameState?.meta?.phase ?? '') === 'day' && this._huntUsesLeft() > 0 }
  _armHunt() { if (!this._huntAvailable()) return; this._huntArmed = true; EventBus.emit('GNOLL_HUNT_ARMED', {}) }
  _disarmHunt() { this._huntArmed = false; EventBus.emit('GNOLL_HUNT_DISARMED', {}) }
  _fireHunt(payload) {
    if (!this._huntArmed) return
    if (!this._huntAvailable()) { this._disarmHunt(); return }
    const boss = this._gameState?.boss
    const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const tier = currentAct(this._gameState), TS = Balance.TILE_SIZE
    const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
    const gcx = room.gridX + Math.floor(room.width / 2), gcy = room.gridY + Math.floor(room.height / 2)
    // the pack converges — re-home every Hunters Pack gnoll onto the room
    for (const m of (this._gameState?.minions ?? [])) {
      if (!this._isHuntersPackGnoll(m) || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      m.assignedRoomId = room.instanceId; m.homeTileX = gcx; m.homeTileY = gcy
    }
    // crowd-wide %maxHP rend on everyone in the room
    const pct = (Balance.GNOLL_HUNT_REND_PCT ?? 0.07) + (tier - 1) * (Balance.GNOLL_HUNT_REND_PCT_PER_ACT ?? 0.02)
    const advsIn = (this._gameState.adventurers?.active ?? []).filter(a => (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, room))
    let lowest = null
    for (const a of advsIn) {
      const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * pct))
      a.resources.hp = Math.max(0, a.resources.hp - dmg)
      this._bankFerocity(dmg * (Balance.GNOLL_FEROCITY_PER_DMG_FRAC ?? 0.25))
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'physical' })
      if (this._scene && Number.isFinite(a.worldX)) AbilityVfx?.packRendFx?.(this._scene, a.worldX, (a.worldY ?? 0) - 16, { tier })
      if (a.resources.hp <= 0) { EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'The Hunt', roomId: room.instanceId, damageType: 'physical' }); continue }
      if (!lowest || (a.resources.hp / (a.resources.maxHp ?? 1)) < (lowest.resources.hp / (lowest.resources.maxHp ?? 1))) lowest = a
    }
    // T3 — the Alpha leaps in for a heavy rend on the most-wounded hero
    if (tier >= 3 && lowest) {
      const big = Math.max(1, Math.floor((lowest.resources?.maxHp ?? 0) * (Balance.GNOLL_HUNT_LEAP_PCT ?? 0.1)))
      lowest.resources.hp = Math.max(0, lowest.resources.hp - big)
      this._bankFerocity(big * (Balance.GNOLL_FEROCITY_PER_DMG_FRAC ?? 0.25))
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: lowest.instanceId, damage: big, damageType: 'physical' })
      if (this._scene && Number.isFinite(lowest.worldX)) AbilityVfx?.alphaLeapFx?.(this._scene, lowest.worldX, (lowest.worldY ?? 0) - 16, { tier })
      if (lowest.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: lowest, killerId: 'boss', killerName: 'The Alpha', roomId: room.instanceId, damageType: 'physical' })
    }
    // T2 sustained swarm / T4 relentless pursuit — keep the pack on the quarry room
    if (tier >= 2) {
      const ms = (tier >= 4 ? (Balance.GNOLL_HUNT_PURSUIT_MS ?? 8000) : (Balance.GNOLL_HUNT_SUSTAIN_MS ?? 4000))
      this._huntMark = { roomId: room.instanceId, until: (this._scene?.time?.now ?? 0) + ms }
    }
    AbilityVfx?.soundHuntFx?.(this._scene, cx, cy, { tier, rectW: room.width * TS, rectH: room.height * TS, fromX: boss.worldX, fromY: boss.worldY })
    if (boss._gnollHunt) boss._gnollHunt.usesLeft = Math.max(0, (boss._gnollHunt.usesLeft ?? 0) - 1)
    this._huntArmed = false
    EventBus.emit('GNOLL_HUNT_FIRED', { roomId: room.instanceId, room, tier, victims: advsIn.length })
  }

  _stopHuntFightTimer() { this._huntFightTimer?.remove?.(false); this._huntFightTimer = null }

  // Throne fight — Rend → Pack Tactics → Frenzy → Blood Hunt finale. The Alpha
  // leads; every special is a %maxHP physical rend (no bleed-DoT — burst carnage).
  _tickHuntFight() {
    const boss = this._gameState?.boss; if (!boss) return
    const tier = currentAct(this._gameState)
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber'); if (!bossRoom) return
    const TS = Balance.TILE_SIZE
    const fighters = (this._gameState?.adventurers?.active ?? []).filter(a => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, bossRoom))
    if (fighters.length === 0) return
    const cx = (bossRoom.gridX + bossRoom.width / 2) * TS, cy = (bossRoom.gridY + bossRoom.height / 2) * TS
    const rend = (a, pct) => {
      const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * pct))
      a.resources.hp = Math.max(0, a.resources.hp - dmg)
      this._bankFerocity(dmg * (Balance.GNOLL_FEROCITY_PER_DMG_FRAC ?? 0.25))
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'physical' })
      if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Gnoll Alpha', roomId: bossRoom.instanceId, damageType: 'physical' })
    }
    const woundedFirst = (arr) => arr.slice().sort((a, b) => (a.resources.hp / (a.resources.maxHp ?? 1)) - (b.resources.hp / (b.resources.maxHp ?? 1)))

    // T4 Blood Hunt finale (<30% HP) — a leaping rend flurry across ALL fighters.
    if (tier >= 4 && !this._bloodHuntFinaleDone && (boss.hp ?? 0) > 0 && (boss.hp ?? 0) < (boss.maxHp ?? 1) * 0.3) {
      this._bloodHuntFinaleDone = true
      AbilityVfx?.bloodHuntFinaleFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS, victims: fighters.map(a => ({ x: a.worldX, y: (a.worldY ?? 0) - 16 })) })
      const pct = (Balance.GNOLL_FIGHT_FINALE_PCT ?? 0.1) + this._ferocitySat() * (Balance.GNOLL_FIGHT_FINALE_FEROCITY ?? 0.1)
      for (const a of fighters) rend(a, pct)
      return
    }
    if (tier >= 3) {
      // Frenzy — rend everyone, harder on the wounded
      for (const a of fighters) { const w = (a.resources.hp / (a.resources.maxHp ?? 1)) < 0.5 ? 1.6 : 1; rend(a, (Balance.GNOLL_FIGHT_FRENZY_PCT ?? 0.05) * w); if (this._scene && Number.isFinite(a.worldX)) AbilityVfx?.packRendFx?.(this._scene, a.worldX, (a.worldY ?? 0) - 16, { tier }) }
    } else if (tier >= 2) {
      // Pack Tactics — the pack piles on the most-wounded hero (multi-strike)
      const t = woundedFirst(fighters)[0]
      AbilityVfx?.packRendFx?.(this._scene, t.worldX, (t.worldY ?? 0) - 16, { tier, big: true })
      rend(t, Balance.GNOLL_FIGHT_PACK_PCT ?? 0.1)
    } else {
      // Rend — savage the top-aggro hero
      const t = fighters[0]
      if (this._scene && Number.isFinite(t.worldX)) AbilityVfx?.packRendFx?.(this._scene, t.worldX, (t.worldY ?? 0) - 16, { tier })
      rend(t, Balance.GNOLL_FIGHT_REND_PCT ?? 0.06)
    }
  }

  // ── SUCCUBUS: THE RAPTURE — banked ALLURE economy ──────────────────────────
  _allureCap() { return (Balance.SUCCUBUS_ALLURE_CAP_BASE ?? 60) + currentAct(this._gameState) * (Balance.SUCCUBUS_ALLURE_CAP_PER_ACT ?? 50) }
  _allureSat() { return Math.max(0, Math.min(1, (this._gameState?.boss?.allure ?? 0) / Math.max(1, this._allureCap()))) }
  _mesmerDur() { return (Balance.SUCCUBUS_MESMER_MS_BASE ?? 2500) + this._allureSat() * (Balance.SUCCUBUS_MESMER_MS_PER_ALLURE ?? 3000) }
  _bankAllure(amount) {
    const boss = this._gameState?.boss
    if (!boss || !(amount > 0)) return
    const before = boss.allure ?? 0
    boss.allure = Math.min(this._allureCap(), before + amount)
    const gained = boss.allure - before
    if (gained > 0) EventBus.emit('SUCCUBUS_ALLURE_BANKED', { amount: gained, total: boss.allure })
  }

  // Infatuated — turns on their own party (canon charm AI). Player-positive: the
  // party knifes itself.
  _infatuate(adv, now) {
    if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) return
    if (adv._shadowMonarch || adv._lightParty || adv.aiState === 'charmed') return
    adv.aiState = 'charmed'; adv._charmedAt = now; adv._charmedKills = 0; adv._charmedAloneTimer = 0
    adv._charmerId = 'succubus'; adv._charmedFormerPartyId = adv.partyId ?? null; adv.partyId = null
    adv.path = null; adv.pathIndex = 0; adv.goal = { type: 'CHARMED' }; adv.goalStack = []
    adv._charmedAtkAcc = 0; adv._charmedPathAt = 0
    this._bankAllure(Balance.SUCCUBUS_ALLURE_PER_MESMER ?? 8)
    EventBus.emit('SUCCUBUS_CHARM_APPLIED', { targetId: adv.instanceId })
    if (this._scene && Number.isFinite(adv.worldX)) AbilityVfx?.raptureBindFx?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 16, { mode: 'infatuate' })
  }

  // Enraptured — frozen defenseless AND takes bonus damage (reuses _petrifiedUntil
  // freeze + _hexUntil/_hexVulnMul vuln, which CombatSystem + the fight already read
  // via gazeHexMul). `_raptureUntil` drives the PINK bliss tint (not grey petrify).
  _enrapture(adv, now) {
    if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) return
    if (adv._shadowMonarch || adv._lightParty) return
    const dur = this._mesmerDur()
    adv._petrifiedUntil = Math.max(adv._petrifiedUntil ?? 0, now + dur)
    adv._raptureUntil   = Math.max(adv._raptureUntil ?? 0, now + dur)
    adv._hexUntil       = Math.max(adv._hexUntil ?? 0, now + dur)
    adv._hexVulnMul     = Math.max(adv._hexVulnMul ?? 1, Balance.SUCCUBUS_RAPTURE_VULN_MULT ?? 1.5)
    this._bankAllure(Balance.SUCCUBUS_ALLURE_PER_MESMER ?? 8)
    EventBus.emit('STATUS_APPLIED', { targetId: adv.instanceId, label: 'ENRAPTURED' })
    if (this._scene && Number.isFinite(adv.worldX)) AbilityVfx?.raptureBindFx?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 16, { mode: 'enrapture' })
  }

  // Lured — walks helplessly toward a chosen room (into your traps/minions).
  _lure(adv, now, roomId) {
    if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) return
    if (adv._shadowMonarch || adv._lightParty || adv.aiState === 'charmed') return
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const dest = rooms.find(r => r.instanceId === roomId) ||
      rooms.filter(r => r.definitionId !== 'entry_hall' && r.definitionId !== 'boss_chamber')[0]
    if (!dest) return
    adv._luredUntil = now + this._mesmerDur()
    adv.goal = { type: 'EXPLORE_ROOM', roomId: dest.instanceId }; adv.path = null
    this._bankAllure(Balance.SUCCUBUS_ALLURE_PER_MESMER ?? 8)
    if (this._scene && Number.isFinite(adv.worldX)) AbilityVfx?.lureFx?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 16, { toX: (dest.gridX + dest.width / 2) * Balance.TILE_SIZE, toY: (dest.gridY + dest.height / 2) * Balance.TILE_SIZE })
  }

  // Per-frame (gated): ALLURE trickle while heroes live + Entrancing Aura (T2) +
  // The Rapture (T4) dungeon-wide pulses.
  _tickRapture(now) {
    if (this._archId() !== 'succubus') return
    if ((this._gameState?.meta?.phase ?? '') !== 'day') return
    const advs = (this._gameState?.adventurers?.active ?? []).filter(a => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)
    if (advs.length === 0) return
    const tier = currentAct(this._gameState)
    // passive ALLURE trickle (her presence is intoxicating)
    if (now - (this._allureTrickleAt ?? 0) >= 1000) { this._allureTrickleAt = now; this._bankAllure(Balance.SUCCUBUS_ALLURE_TRICKLE ?? 1.5) }
    // T2 Entrancing Aura — periodically Enrapture a non-mesmerized explorer
    if (tier >= 2 && !this._bossFightActive && now - (this._entranceAt ?? 0) >= (Balance.SUCCUBUS_ENTRANCE_INTERVAL_MS ?? 5000)) {
      this._entranceAt = now
      const free = advs.filter(a => a.aiState !== 'charmed' && (a._petrifiedUntil ?? 0) <= now)
      if (free.length) this._enrapture(free[Math.floor(Math.random() * free.length)], now)
    }
    // T4 The Rapture — dungeon-wide pulse Enraptures a swathe of the party
    if (tier >= 4 && !this._bossFightActive && now - (this._rapturePulseAt ?? 0) >= (Balance.SUCCUBUS_RAPTURE_PULSE_MS ?? 7000)) {
      this._rapturePulseAt = now
      const n = Math.max(1, Math.round(advs.length * (Balance.SUCCUBUS_RAPTURE_PULSE_FRAC ?? 0.4)))
      for (let i = 0; i < Math.min(n, advs.length); i++) this._enrapture(advs[i], now)
    }
  }

  // ── KISS OF RAPTURE (day active) ───────────────────────────────────────────
  _kissUsesLeft() { return this._gameState?.boss?._succubusKiss?.usesLeft ?? 0 }
  _kissAvailable() { return this._archId() === 'succubus' && (this._gameState?.meta?.phase ?? '') === 'day' && this._kissUsesLeft() > 0 }
  _armKiss() { if (!this._kissAvailable()) return; this._kissArmed = true; EventBus.emit('SUCCUBUS_KISS_ARMED', {}) }
  _disarmKiss() { this._kissArmed = false; EventBus.emit('SUCCUBUS_KISS_DISARMED', {}) }
  _fireKiss(payload) {
    if (!this._kissArmed) return
    if (!this._kissAvailable()) { this._disarmKiss(); return }
    const boss = this._gameState?.boss
    const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const tier = currentAct(this._gameState), TS = Balance.TILE_SIZE, now = this._scene?.time?.now ?? 0
    const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
    const advsIn = (this._gameState.adventurers?.active ?? []).filter(a => (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, room))
    if (tier >= 4) {
      for (const a of advsIn) this._enrapture(a, now)                       // T4 — mass enrapture (kill window)
    } else {
      for (const a of advsIn) this._infatuate(a, now)                       // T1 — beguile all into infatuation
      if (tier >= 2 && advsIn.length) {                                     // T2 — enrapture the most-wounded
        const low = advsIn.slice().sort((a, b) => (a.resources.hp / (a.resources.maxHp ?? 1)) - (b.resources.hp / (b.resources.maxHp ?? 1)))[0]
        this._enrapture(low, now)
      }
      if (tier >= 3) {                                                      // T3 — lure survivors toward the dungeon
        const dest = (this._gameState?.dungeon?.rooms ?? []).filter(r => r.definitionId !== 'entry_hall' && r.definitionId !== 'boss_chamber')
        const pick = dest.length ? dest[Math.floor(Math.random() * dest.length)] : null
        for (const a of advsIn) if (a.aiState !== 'charmed') this._lure(a, now, pick?.instanceId)
      }
    }
    AbilityVfx?.kissOfRaptureFx?.(this._scene, cx, cy, { tier, rectW: room.width * TS, rectH: room.height * TS, fromX: boss.worldX, fromY: boss.worldY })
    if (boss._succubusKiss) boss._succubusKiss.usesLeft = Math.max(0, (boss._succubusKiss.usesLeft ?? 0) - 1)
    this._kissArmed = false
    EventBus.emit('SUCCUBUS_KISS_FIRED', { roomId: room.instanceId, room, tier, victims: advsIn.length })
  }

  _stopRaptureFightTimer() { this._raptureFightTimer?.remove?.(false); this._raptureFightTimer = null }

  // Throne fight — Heartpiercer → Doppelgänger → Maelstrom of Desire → Rapture's End.
  // The Doppelgänger split itself is the existing BossSystem decoy mechanic; this layers
  // the mesmerize hazards + the finale on top.
  _tickRaptureFight() {
    const boss = this._gameState?.boss; if (!boss) return
    const tier = currentAct(this._gameState)
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber'); if (!bossRoom) return
    const TS = Balance.TILE_SIZE, now = this._scene?.time?.now ?? 0
    const fighters = (this._gameState?.adventurers?.active ?? []).filter(a => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, bossRoom))
    if (fighters.length === 0) return
    const cx = (bossRoom.gridX + bossRoom.width / 2) * TS, cy = (bossRoom.gridY + bossRoom.height / 2) * TS
    const hit = (a, pct) => {
      const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * pct * (a._hexUntil > now ? (a._hexVulnMul ?? 1) : 1)))
      a.resources.hp = Math.max(0, a.resources.hp - dmg)
      this._bankAllure(dmg * (Balance.SUCCUBUS_ALLURE_PER_DMG_FRAC ?? 0.1))
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'unholy' })
      if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Succubus Queen', roomId: bossRoom.instanceId, damageType: 'unholy' })
    }
    // T4 Rapture's End finale (<30% HP) — the whole party enraptured + drained.
    if (tier >= 4 && !this._raptureFinaleDone && (boss.hp ?? 0) > 0 && (boss.hp ?? 0) < (boss.maxHp ?? 1) * 0.3) {
      this._raptureFinaleDone = true
      AbilityVfx?.raptureFinaleFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS, victims: fighters.map(a => ({ x: a.worldX, y: (a.worldY ?? 0) - 16 })) })
      const pct = (Balance.SUCCUBUS_FIGHT_FINALE_PCT ?? 0.08) + this._allureSat() * (Balance.SUCCUBUS_FIGHT_FINALE_ALLURE ?? 0.1)
      for (const a of fighters) { this._enrapture(a, now); hit(a, pct) }
      return
    }
    if (tier >= 3) {
      // Maelstrom of Desire — room-wide allure pulse: mesmerize + %maxHP
      AbilityVfx?.maelstromFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS })
      for (const a of fighters) { hit(a, Balance.SUCCUBUS_FIGHT_MAELSTROM_PCT ?? 0.05); if ((a._petrifiedUntil ?? 0) <= now && Math.random() < 0.5) this._enrapture(a, now); else this._infatuate(a, now) }
    } else if (tier >= 2) {
      // Doppelgänger — peel off decoys (visual; the BossSystem decoy mechanic owns
      // the targeting); entrancing strike on the top hero.
      AbilityVfx?.doppelgangerSplitFx?.(this._scene, boss.worldX ?? cx, (boss.worldY ?? cy), { tier, sprite: null })
      const t = fighters[0]; hit(t, Balance.SUCCUBUS_FIGHT_HEARTPIERCE_PCT ?? 0.06); this._enrapture(t, now)
    } else {
      // Heartpiercer — entrancing strike on the top-aggro hero
      const t = fighters[0]
      if (this._scene && Number.isFinite(t.worldX)) AbilityVfx?.raptureBindFx?.(this._scene, t.worldX, (t.worldY ?? 0) - 16, { mode: 'enrapture' })
      hit(t, Balance.SUCCUBUS_FIGHT_HEARTPIERCE_PCT ?? 0.06); this._enrapture(t, now)
    }
  }

  // ── VAMPIRE: Charm + Blood Tax ─────────────────────────────────────────

  _tickVampire(now) {
    if (this._archId() !== 'vampire') return
    this._tickCharmConversion(now)
    this._tickThrallRoaming(now)
    this._tickBloodRegen(now)
    this._tickRiteZones(now)
  }

  // ── VAMPIRE: THE BLOOD SOVEREIGN — banked BLOOD economy ────────────────────
  _bloodCap() { return (Balance.VAMPIRE_BLOOD_CAP_BASE ?? 60) + currentAct(this._gameState) * (Balance.VAMPIRE_BLOOD_CAP_PER_ACT ?? 50) }
  _bloodSat() { return Math.max(0, Math.min(1, (this._gameState?.boss?.blood ?? 0) / Math.max(1, this._bloodCap()))) }

  // Bank BLOOD (capped) + optionally emit a feed-streak from the bleeding hero.
  _bankBlood(amount, fromX, fromY) {
    const boss = this._gameState?.boss
    if (!boss || !(amount > 0)) return
    const before = boss.blood ?? 0
    boss.blood = Math.min(this._bloodCap(), before + amount)
    const gained = boss.blood - before
    if (gained > 0) EventBus.emit('VAMPIRE_BLOOD_BANKED', { amount: gained, total: boss.blood, fromX, fromY })
  }

  // Passive self-regen while BLOOD is held (the run-long lifeline). Scaled to the
  // current pool so a fat bank visibly keeps the Sovereign topped up.
  _tickBloodRegen(now) {
    const boss = this._gameState?.boss
    if (!boss || (boss.hp ?? 0) <= 0) return
    this._bloodRegenAt ??= 0
    if (now - this._bloodRegenAt < 1000) return
    this._bloodRegenAt = now
    const heal = (boss.blood ?? 0) * (Balance.VAMPIRE_BLOOD_REGEN_FRAC ?? 0.012)
    if (heal > 0) boss.hp = Math.min(boss.maxHp ?? boss.hp, (boss.hp ?? 0) + heal)
  }

  // T3 Sanguine Pool — drain heroes standing in a lingering blood pool each tick.
  _tickRiteZones(now) {
    if (!this._riteZones || this._riteZones.length === 0) return
    const TS = Balance.TILE_SIZE
    for (let i = this._riteZones.length - 1; i >= 0; i--) {
      const z = this._riteZones[i]
      if (now >= z.until) { this._riteZones.splice(i, 1); continue }
      if (now - (z.lastTickAt ?? 0) < (Balance.VAMPIRE_RITE_POOL_TICK_MS ?? 1000)) continue
      z.lastTickAt = now
      const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === z.roomId)
      if (!room) { this._riteZones.splice(i, 1); continue }
      const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
      let drained = 0
      for (const a of (this._gameState?.adventurers?.active ?? [])) {
        if (!a || (a.resources?.hp ?? 0) <= 0 || !_advInsideRoom(a, room)) continue
        const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * (Balance.VAMPIRE_RITE_POOL_PCT ?? 0.02)))
        a.resources.hp = Math.max(0, a.resources.hp - dmg)
        this._bankBlood(dmg * (Balance.VAMPIRE_BLOOD_PER_DMG_FRAC ?? 0.3), a.worldX, a.worldY)
        drained += dmg
        EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'unholy' })
        if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Sanguine Pool', roomId: room.instanceId, damageType: 'unholy' })
      }
      if (drained > 0) {
        const boss = this._gameState?.boss
        if (boss) boss.hp = Math.min(boss.maxHp ?? boss.hp, (boss.hp ?? 0) + drained * (Balance.VAMPIRE_FIGHT_LIFESTEAL ?? 0.6))
        AbilityVfx?.sanguinePoolFx?.(this._scene, cx, cy, { tier: z.tier ?? 3, rectW: room.width * TS, rectH: room.height * TS, refresh: true })
      }
    }
  }

  // ── BLOOD RITE (day active) ────────────────────────────────────────────────
  _riteUsesLeft() { return this._gameState?.boss?._vampRite?.usesLeft ?? 0 }
  _riteAvailable() { return this._archId() === 'vampire' && (this._gameState?.meta?.phase ?? '') === 'day' && this._riteUsesLeft() > 0 }
  _armRite() { if (!this._riteAvailable()) return; this._riteArmed = true; EventBus.emit('VAMPIRE_RITE_ARMED', {}) }
  _disarmRite() { this._riteArmed = false; EventBus.emit('VAMPIRE_RITE_DISARMED', {}) }
  _fireRite(payload) {
    if (!this._riteArmed) return
    if (!this._riteAvailable()) { this._disarmRite(); return }
    const boss = this._gameState?.boss
    const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const tier = currentAct(this._gameState), TS = Balance.TILE_SIZE
    const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
    const pct = (Balance.VAMPIRE_RITE_DRAIN_PCT ?? 0.06) + (tier - 1) * (Balance.VAMPIRE_RITE_DRAIN_PCT_PER_ACT ?? 0.025)
    const advsIn = (this._gameState.adventurers?.active ?? []).filter(a => (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, room))
    let drained = 0
    let lowest = null
    for (const a of advsIn) {
      const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * pct))
      a.resources.hp = Math.max(0, a.resources.hp - dmg)
      drained += dmg
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'unholy' })
      this._bankBlood(dmg * (Balance.VAMPIRE_BLOOD_PER_DMG_FRAC ?? 0.3), a.worldX, a.worldY)
      if (a.resources.hp <= 0) { EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Blood Rite', roomId: room.instanceId, damageType: 'unholy' }); continue }
      if (!lowest || (a.resources.hp / (a.resources.maxHp ?? 1)) < (lowest.resources.hp / (lowest.resources.maxHp ?? 1))) lowest = a
      // T4 Crimson Rite — any hero left below the conversion threshold is charmed.
      if (tier >= 4 && (a.resources.hp / (a.resources.maxHp ?? 1)) <= (Balance.VAMPIRE_RITE_CONVERT_PCT ?? 0.25)) this._charmHero(a)
    }
    // T2 Court Levy — drag the lowest-HP survivor into the Court.
    if (tier >= 2 && tier < 4 && lowest) this._charmHero(lowest)
    // Heal the Sovereign off the rite + bank already handled per-hit.
    if (drained > 0) boss.hp = Math.min(boss.maxHp ?? boss.hp, (boss.hp ?? 0) + drained * (Balance.VAMPIRE_FIGHT_LIFESTEAL ?? 0.6))
    // T3 Sanguine Pool — lingering tax zone on the room floor.
    if (tier >= 3) {
      this._riteZones = (this._riteZones ?? []).filter(z => z.roomId !== room.instanceId)
      const poolMs = Balance.VAMPIRE_RITE_POOL_MS ?? 5000
      this._riteZones.push({ roomId: room.instanceId, until: (this._scene?.time?.now ?? 0) + poolMs, lastTickAt: 0, tier })
      AbilityVfx?.sanguinePoolFx?.(this._scene, cx, cy, { tier, rectW: room.width * TS, rectH: room.height * TS, lifeMs: poolMs })
    }
    AbilityVfx?.bloodRiteFx?.(this._scene, boss.worldX ?? cx, (boss.worldY ?? cy), { toX: cx, toY: cy, tier, rectW: room.width * TS, rectH: room.height * TS, victims: advsIn.map(a => ({ x: a.worldX, y: (a.worldY ?? 0) - 16 })) })
    if (boss._vampRite) boss._vampRite.usesLeft = Math.max(0, (boss._vampRite.usesLeft ?? 0) - 1)
    this._riteArmed = false
    EventBus.emit('VAMPIRE_RITE_FIRED', { roomId: room.instanceId, room, tier, victims: advsIn.length, drained })
  }

  // Mark a hero as charmed (joins the Court → walks to the boss → converts in
  // _tickCharmConversion). No-op for the duel-bound / Light Party specials.
  _charmHero(adv) {
    if (!adv || adv._charmed || adv._shadowMonarch || adv._lightParty) return
    if ((adv.resources?.hp ?? 0) <= 0) return
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    adv._charmed = true
    adv._charmedFormerPartyId = adv.partyId ?? null
    adv.partyId = null
    adv.goal = { type: 'CHARM_WALK', roomId: bossRoom.instanceId }
    adv.path = null
    EventBus.emit('STATUS_APPLIED', { targetId: adv.instanceId, label: 'CHARMED' })
    EventBus.emit('VAMPIRE_CHARM_MARKED', { advId: adv.instanceId })
    if (this._scene && Number.isFinite(adv.worldX)) AbilityVfx?.charmBindFx?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 16, {})
  }

  // T4 Blood Bond — a slain thrall erupts (blood AoE → BLOOD) + chain-charms a
  // nearby hero (capped per day).
  _onThrallDied(thrall) {
    if (currentAct(this._gameState) < 4) return
    if (!Number.isFinite(thrall?.worldX)) return
    const TS = Balance.TILE_SIZE, R = (Balance.VAMPIRE_BOND_RADIUS_TS ?? 2.5) * TS
    AbilityVfx?.bloodEruptFx?.(this._scene, thrall.worldX, (thrall.worldY ?? 0) - 8, { tier: 4 })
    let nearest = null, nd = Infinity
    for (const a of (this._gameState?.adventurers?.active ?? [])) {
      if (!a || (a.resources?.hp ?? 0) <= 0 || a._charmed) continue
      const d = Math.hypot((a.worldX ?? 0) - thrall.worldX, (a.worldY ?? 0) - thrall.worldY)
      if (d > R) continue
      const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * (Balance.VAMPIRE_BOND_ERUPT_PCT ?? 0.05)))
      a.resources.hp = Math.max(0, a.resources.hp - dmg)
      this._bankBlood(dmg * (Balance.VAMPIRE_BLOOD_PER_DMG_FRAC ?? 0.3), a.worldX, a.worldY)
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'unholy' })
      if (a.resources.hp <= 0) { EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Blood Bond', roomId: null, damageType: 'unholy' }); continue }
      if (d < nd) { nd = d; nearest = a }
    }
    // Chain-charm the nearest survivor (anti-snowball: capped per day).
    if (nearest && (this._bondChainToday ?? 0) < (Balance.VAMPIRE_BOND_CHAIN_PER_DAY ?? 3)) {
      this._bondChainToday = (this._bondChainToday ?? 0) + 1
      this._charmHero(nearest)
    }
  }

  _stopBloodFightTimer() { this._vampFightTimer?.remove?.(false); this._vampFightTimer = null }

  // Throne fight — Crimson Lance → Sanguine Embrace → Blood Tempest → Blood Moon
  // finale. A lifedrain duelist: every special heals the Sovereign.
  _tickBloodFight() {
    const boss = this._gameState?.boss; if (!boss) return
    const tier = currentAct(this._gameState)
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber'); if (!bossRoom) return
    const TS = Balance.TILE_SIZE
    const fighters = (this._gameState?.adventurers?.active ?? []).filter(a => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, bossRoom))
    if (fighters.length === 0) return
    const heal = (amt) => { boss.hp = Math.min(boss.maxHp ?? boss.hp, (boss.hp ?? 0) + amt * (Balance.VAMPIRE_FIGHT_LIFESTEAL ?? 0.6)) }
    const hit = (a, pct, type) => {
      const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * pct))
      a.resources.hp = Math.max(0, a.resources.hp - dmg)
      this._bankBlood(dmg * (Balance.VAMPIRE_BLOOD_PER_DMG_FRAC ?? 0.3), a.worldX, a.worldY)
      heal(dmg)
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: type })
      if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Vampire', roomId: bossRoom.instanceId, damageType: type })
      return dmg
    }
    const cx = (bossRoom.gridX + bossRoom.width / 2) * TS, cy = (bossRoom.gridY + bossRoom.height / 2) * TS

    // T4 Blood Moon finale (<30% HP) — repeated mass exsanguinate, Blood-scaled.
    if (tier >= 4 && !this._bloodMoonFinaleDone && (boss.hp ?? 0) > 0 && (boss.hp ?? 0) < (boss.maxHp ?? 1) * 0.3) {
      this._bloodMoonFinaleDone = true
      AbilityVfx?.bloodMoonFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS })
      const pct = (Balance.VAMPIRE_FIGHT_MOON_PCT ?? 0.07) + (boss.blood ?? 0) * (Balance.VAMPIRE_FIGHT_MOON_BLOOD_SCALE ?? 0.0008)
      for (const a of fighters) hit(a, pct, 'unholy')
      return
    }
    if (tier >= 3) {
      AbilityVfx?.bloodTempestFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS })
      for (const a of fighters) hit(a, Balance.VAMPIRE_FIGHT_TEMPEST_PCT ?? 0.05, 'unholy')
    } else if (tier >= 2) {
      // Sanguine Embrace — seize the top-HP hero, big drain.
      const t = fighters.slice().sort((a, b) => (b.resources?.hp ?? 0) - (a.resources?.hp ?? 0))[0]
      if (this._scene && Number.isFinite(t.worldX)) AbilityVfx?.sanguineEmbraceFx?.(this._scene, boss.worldX ?? cx, (boss.worldY ?? cy) - 8, { toX: t.worldX, toY: (t.worldY ?? 0) - 16, tier })
      hit(t, Balance.VAMPIRE_FIGHT_EMBRACE_PCT ?? 0.10, 'unholy')
    } else {
      // Crimson Lance — blood-bolt at the top-aggro (first) hero.
      const t = fighters[0]
      if (this._scene && Number.isFinite(t.worldX)) AbilityVfx?.crimsonLanceFx?.(this._scene, boss.worldX ?? cx, (boss.worldY ?? cy) - 8, { toX: t.worldX, toY: (t.worldY ?? 0) - 16, tier })
      hit(t, Balance.VAMPIRE_FIGHT_LANCE_PCT ?? 0.05, 'unholy')
    }
  }

  // ── SUCCUBUS: Shapeshifter + Seductress ─────────────────────────────────
  //
  // Day-phase loop. While uses-left > 0 and the cooldown has elapsed and
  // there is at least one targetable adv, kick off a flight. Phases:
  //   'transform_out' (300ms) — boss visible, transform+smoke VFX on her
  //   'going'         (1.5s)  — boss hidden, bat sprite flies → target
  //   'return'        (1.5s)  — boss hidden, bat sprite flies back
  //   'transform_in'  (300ms) — boss visible again, transform+smoke VFX
  //   null                    — idle; cooldown counts down to next charm
  //
  // Phase transitions emit events (SUCCUBUS_TRANSFORM_OUT/IN, SUCCUBUS_BAT_
  // FLYING_OUT/BACK, SUCCUBUS_CHARM_APPLIED, SUCCUBUS_FLIGHT_ENDED) so the
  // renderers can react. Boss visibility is driven off `flight.phase` —
  // BossRenderer hides the boss whenever phase is 'going' or 'return'.
  _tickSuccubus(delta, now) {
    if (this._archId() !== 'succubus') return
    // Day phase only — skip during night/build phase.
    if ((this._gameState?.meta?.phase ?? '') !== 'day') return
    // Boss fight runs in an overlay scene that doesn't compose well with
    // mid-flight VFX (sprites can disappear). Suspend during the fight.
    if (this._bossFightActive) return
    const s = (this._gameState._succubus ??= { usesLeft: 1, cooldownUntil: 0, flight: null })

    // Active flight in progress — advance its phase
    if (s.flight) {
      const f = s.flight
      if (now < f.until) return

      if (f.phase === 'transform_out') {
        // Transform finished — bat takes off
        f.phase     = 'going'
        f.startedAt = now
        f.until     = now + 1500
        EventBus.emit('SUCCUBUS_BAT_FLYING_OUT', {
          fromX: f.fromX, fromY: f.fromY, toX: f.toX, toY: f.toY,
        })
        return
      }

      if (f.phase === 'going') {
        // Apply charm at the bat's arrival. Tear down any AT_BOSS / FLEE /
        // pathing state so the charmed adv enters _tickCharmedAdv with a
        // clean slate — otherwise leftover goals can immediately re-trigger
        // and the adv just stands still.
        const target = this._gameState.adventurers?.active?.find(a => a.instanceId === f.targetId)
        if (target && target.aiState !== 'dead' && (target.resources?.hp ?? 0) > 0) {
          target.aiState     = 'charmed'
          target._charmedAt  = now
          target._charmedKills = 0
          target._charmedAloneTimer = 0
          target._charmerId  = 'succubus'
          target._charmedFormerPartyId = target.partyId ?? null
          target.partyId       = null
          target.path          = null
          target.pathIndex     = 0
          target.goal          = { type: 'CHARMED' }
          target.goalStack     = []
          target._charmedAtkAcc  = 0
          target._charmedPathAt  = 0
          this._bankAllure(Balance.SUCCUBUS_ALLURE_PER_MESMER ?? 8)
          EventBus.emit('SUCCUBUS_CHARM_APPLIED', { targetId: target.instanceId })
        }
        // Return flight — swap from/to so the bat heads back to boss room
        const newFromX = f.toX, newFromY = f.toY
        f.phase     = 'return'
        f.startedAt = now
        f.until     = now + 1500
        f.fromX     = newFromX
        f.fromY     = newFromY
        f.toX       = f.bossX
        f.toY       = f.bossY
        EventBus.emit('SUCCUBUS_BAT_FLYING_BACK', {
          fromX: f.fromX, fromY: f.fromY, toX: f.toX, toY: f.toY,
        })
        return
      }

      if (f.phase === 'return') {
        // Bat landed — boss-side reverse-transform begins
        f.phase     = 'transform_in'
        f.startedAt = now
        f.until     = now + 300
        EventBus.emit('SUCCUBUS_TRANSFORM_IN', { bossX: f.bossX, bossY: f.bossY })
        return
      }

      if (f.phase === 'transform_in') {
        // Reverse transform finished — boss is back, end the flight cycle.
        // Randomize cooldown so subsequent charms don't clump.
        EventBus.emit('SUCCUBUS_FLIGHT_ENDED', {})
        s.flight = null
        // -1s base + rand per boss-lv beyond 1; floored at 5000ms/4000ms so
        // it doesn't collapse to zero (lv10 lands at 11000/7000 ms).
        const _succBossLv = this._gameState?.boss?.level ?? 1
        const _reduction = Math.max(0, _succBossLv - 1) * Balance.SUCCUBUS_CHARM_COOLDOWN_REDUCTION_PER_LV_MS
        const _cdBase = Math.max(5000,
          (Balance.SUCCUBUS_CHARM_COOLDOWN_BASE_MS ?? 20000) - _reduction)
        const _cdRand = Math.max(4000,
          (Balance.SUCCUBUS_CHARM_COOLDOWN_RAND_MS ?? 16000) - _reduction)
        s.cooldownUntil = now + _cdBase + Math.floor(Math.random() * _cdRand)
        return
      }
      return
    }

    // No active flight — try to start one if uses + cooldown allow it
    if ((s.usesLeft ?? 0) <= 0) return
    if ((s.cooldownUntil ?? 0) > now) return

    const advs = this._gameState?.adventurers?.active ?? []
    const eligible = advs.filter(a =>
      a && a.aiState !== 'dead' && a.aiState !== 'charmed' &&
      a.aiState !== 'fleeing' && a.aiState !== 'fled' &&
      (a.resources?.hp ?? 0) > 0
    )
    if (eligible.length === 0) return

    const target = eligible[Math.floor(Math.random() * eligible.length)]
    // Boss origin: prefer the boss's live worldX/Y (she may be wandering
    // her chamber); fall back to room center if the field is missing.
    const TS = Balance.TILE_SIZE
    const boss = this._gameState?.boss
    let bossX = boss?.worldX, bossY = boss?.worldY
    if (bossX == null || bossY == null) {
      const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
      if (!bossRoom) return
      bossX = (bossRoom.gridX + bossRoom.width  / 2) * TS
      bossY = (bossRoom.gridY + bossRoom.height / 2) * TS
    }
    const toX = target.worldX ?? (target.tileX * TS + TS / 2)
    const toY = target.worldY ?? (target.tileY * TS + TS / 2)

    s.flight = {
      phase:     'transform_out',
      targetId:  target.instanceId,
      startedAt: now,
      until:     now + 300,
      fromX:     bossX,
      fromY:     bossY,
      toX, toY,
      bossX, bossY,           // pinned for the return-flight target
    }
    s.usesLeft -= 1
    EventBus.emit('SUCCUBUS_FLIGHT_STARTED', { targetId: target.instanceId, fromX: bossX, fromY: bossY, toX, toY })
    EventBus.emit('SUCCUBUS_TRANSFORM_OUT',  { bossX, bossY, dx: toX - bossX })
  }

  _tickCharmConversion(now = 0) {
    const advs = this._gameState?.adventurers?.active ?? []
    if (advs.length === 0) return
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const bossRoom = rooms.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    // Non-boss rooms the thrall can be planted in. A converted thrall must
    // NOT be left standing on the adventurer's old tile — that tile sits
    // inside/next to the boss chamber, and a thrall only relocates via
    // MinionAI (day phase only) or respawnAll's home-snap (night-start
    // only). A conversion that lands late in the day or during the build
    // phase would otherwise strand the thrall, invisible, on the boss
    // floor until the next day's AI walks it out. Planting it directly in
    // a real room makes it appear immediately in any phase.
    const roamPool = rooms.filter(r => r.definitionId !== 'boss_chamber')
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const thrallDef = minionTypes.find(m => m.id === 'vampire_minion1')
    if (!thrallDef) return
    const bossLv = this._gameState?.boss?.level ?? 1

    let converted = 0
    for (let i = advs.length - 1; i >= 0; i--) {
      const adv = advs[i]
      if (!adv?._charmed) continue
      // Never convert Jinwoo OR a Light Party member. This path splices the adv
      // from active directly (bypassing AISystem._kill), so the duel-bound death
      // guard never runs — they must be skipped explicitly here.
      if (adv._shadowMonarch || adv._lightParty) continue
      if (adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const boss = this._gameState.boss
      if (!boss) continue
      const dist = Math.hypot(
        (adv.worldX ?? adv.tileX * 32) - (boss.worldX ?? boss.tileX * 32),
        (adv.worldY ?? adv.tileY * 32) - (boss.worldY ?? boss.tileY * 32),
      )
      if (dist > 48) continue  // ~1.5 tiles — must physically touch the boss

      // Convert: spawn a vampire_minion1 thrall, then remove the adv from
      // the active list. The thrall is planted directly in a random
      // non-boss room (full live + home position) so it's standing
      // somewhere visible the instant it converts — see roamPool comment
      // above. Falls back to the adv's tile only if the dungeon somehow
      // has no rooms outside the boss chamber.
      let spawnTileX  = adv.tileX
      let spawnTileY  = adv.tileY
      let spawnRoomId = bossRoom.instanceId
      if (roamPool.length > 0) {
        const room = roamPool[Math.floor(Math.random() * roamPool.length)]
        spawnTileX  = room.gridX + Math.floor(room.width  / 2)
        spawnTileY  = room.gridY + Math.floor(room.height / 2)
        spawnRoomId = room.instanceId
      }
      const minion = createMinion(
        thrallDef,
        { x: spawnTileX, y: spawnTileY },
        spawnRoomId,
        { class: 'garrison', bossLevel: bossLv },
      )
      minion._isVampireThrall   = true
      minion._charmedClassId    = adv.classId ?? 'unknown'
      minion._charmedAdvName    = adv.name    ?? 'Thrall'
      // A thrall roams in the open — it must never inherit vampire_minion1's
      // Sleep on Ceiling hide flag. Clear it explicitly so the thrall is
      // visible the instant it converts, even before its first AI tick or
      // when converted during the build phase (AI doesn't tick at night).
      minion._hidden            = false
      // Stamp the roam clock to "now" so the thrall settles in its spawn
      // room for a full swap interval before it starts wandering.
      minion._thrallRoamLastSwapAt = now
      minion.isUndead           = true   // permadeath: respawnAll strips dead undead
      // Light class retention to mirror Lich Necromancy.
      this._applyClassRetentionBuffs(minion, adv.classId)
      applyMinionScaling(minion, bossLv, this._gameState?.meta?.dayNumber ?? 1)
      this._gameState.minions.push(minion)
      EventBus.emit('MINION_PLACED', { minion })
      EventBus.emit('VAMPIRE_THRALL_CONVERTED', {
        advId:    adv.instanceId,
        minionId: minion.instanceId,
        classId:  adv.classId,
      })

      // Remove from active and push to graveyard so ADVENTURER_DIED
      // triggers DayPhase's "all out" check and the day progresses.
      advs.splice(i, 1)
      this._gameState.adventurers.graveyard.push({
        ...adv,
        diedOnDay:  this._gameState.meta?.dayNumber ?? 0,
        killedBy:   'vampire_charm',
        killerName: 'Vampire',
        damageType: 'unholy',
      })
      EventBus.emit('ADVENTURER_DIED', {
        adventurer: adv,
        killerId:   'vampire_charm',
        killerName: 'Vampire',
        roomId:     this._scene?.dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)?.instanceId ?? null,
        damageType: 'unholy',
      })
      // Turning an adventurer into a thrall counts as a kill for the boss —
      // award XP just like a normal defeat (conversion bypasses _killAdv).
      this._scene?.aiSystem?._awardBossXp?.()
      converted++
    }
    if (converted > 0) {
      EventBus.emit('VAMPIRE_THRALL_BATCH_CONVERTED', { count: converted })
    }
  }

  _tickThrallRoaming(now) {
    const minions = this._gameState?.minions ?? []
    const rooms   = this._gameState?.dungeon?.rooms ?? []
    if (minions.length === 0 || rooms.length === 0) return
    const roamPool = rooms.filter(r => r.definitionId !== 'boss_chamber')
    if (roamPool.length === 0) return
    const SWAP = Balance.VAMPIRE_THRALL_ROAM_SWAP_MS
    for (const m of minions) {
      if (!m._isVampireThrall) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      m._thrallRoamLastSwapAt ??= 0
      if (now - m._thrallRoamLastSwapAt < SWAP) continue
      m._thrallRoamLastSwapAt = now
      const pick = roamPool[Math.floor(Math.random() * roamPool.length)]
      const cx = pick.gridX + Math.floor(pick.width  / 2)
      const cy = pick.gridY + Math.floor(pick.height / 2)
      m.assignedRoomId = pick.instanceId
      m.homeTileX = cx
      m.homeTileY = cy
    }
  }

  // ── DEMON: Sacrifice Pact + Hellgate ───────────────────────────────────

  _sacrificeUsesLeft() {
    return this._gameState?._demon?.sacrificeUsesLeft ?? 0
  }

  _sacrificeAvailable() {
    // The Pact spends Brimstone + auto-burns an imp if one exists; it does NOT
    // require a minion (works on banked Brimstone alone).
    return this._archId() === 'demon'
      && (this._gameState?.meta?.phase ?? '') === 'day'
      && this._sacrificeUsesLeft() > 0
  }

  // INFERNAL PACT (day active) — arm, then the UI picks a ROOM.
  _armSacrifice() { if (!this._sacrificeAvailable()) return; this._sacrificeArmed = true; EventBus.emit('DEMON_SACRIFICE_ARMED', {}) }
  _disarmSacrifice() { this._sacrificeArmed = false; EventBus.emit('DEMON_SACRIFICE_DISARMED', {}) }

  // Auto-pick the expendable minion the Pact burns as fuel. Prefers a free
  // Hellgate Imp; falls back to any dungeon minion; null if none.
  _pickSacrificeMinion() {
    const alive = (this._gameState?.minions ?? []).filter(m =>
      m && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0 && m.faction === 'dungeon')
    if (alive.length === 0) return null
    const imps = alive.filter(m => m._isDemonImp)
    return (imps.length ? imps : alive)[Math.floor(Math.random() * (imps.length ? imps.length : alive.length))]
  }

  // Solo Leveling — Sung Jinwoo can't be killed by boss ABILITIES (only the
  // boss duel itself). Returns the minimum HP a damage tick may leave him at
  // (10% of max); 0 for everyone else.
  _shadowFloor(adv) {
    return (adv?._shadowMonarch || adv?._lightParty)
      ? Math.max(1, Math.ceil((adv.resources?.maxHp ?? 1) * 0.10))
      : 0
  }

  // ── Brimstone economy helpers ──────────────────────────────────────────
  _brimstoneCap() {
    return (Balance.DEMON_BRIMSTONE_CAP_BASE ?? 80) + currentAct(this._gameState) * (Balance.DEMON_BRIMSTONE_CAP_PER_ACT ?? 60)
  }
  _brimstoneSat() {
    return Math.max(0, Math.min(1, (this._gameState?.boss?.brimstone ?? 0) / Math.max(1, this._brimstoneCap())))
  }
  // Every adventurer death banks Infernal Power (T3 Soul Harvest doubles it).
  _bankBrimstoneFromDeath(adv) {
    const boss = this._gameState?.boss
    if (!boss) return
    let gain = (Balance.DEMON_BRIMSTONE_PER_KILL ?? 4) + (adv?.level ?? 1) * (Balance.DEMON_BRIMSTONE_KILL_PER_LV ?? 0.4)
    if (currentAct(this._gameState) >= 3) gain *= 2
    boss.brimstone = Math.min(this._brimstoneCap(), (boss.brimstone ?? 0) + gain)
  }

  // INFERNAL PACT — payload { roomId }. Burns an expendable imp as fuel, spends
  // banked Brimstone, and rains hellfire on the room (dmg scales with spend).
  _fireSacrifice(payload) {
    if (!this._sacrificeArmed) return
    if (!this._sacrificeAvailable()) { this._disarmSacrifice(); return }
    const boss = this._gameState?.boss
    const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const tier = currentAct(this._gameState)
    const now  = this._scene?.time?.now ?? 0
    const TS   = Balance.TILE_SIZE

    // Auto-burn one expendable minion as ritual fuel → banks a big Brimstone chunk.
    const fuel = this._pickSacrificeMinion()
    let burnX = boss.worldX, burnY = boss.worldY
    if (fuel) {
      burnX = fuel.worldX; burnY = fuel.worldY
      fuel.resources.hp = 0; fuel.aiState = 'dead'
      EventBus.emit('MINION_DIED', { minion: fuel, killerId: 'sacrifice_pact' })
      EventBus.emit('DEMON_SACRIFICE_BURN_VFX', { x: burnX, y: burnY })
      this._gameState.minions = (this._gameState.minions ?? []).filter(x => x.instanceId !== fuel.instanceId)
      const mt = (fuel.tier ?? 1)
      boss.brimstone = Math.min(this._brimstoneCap(), (boss.brimstone ?? 0)
        + (Balance.DEMON_BRIMSTONE_PER_SACRIFICE ?? 18) * (1 + (mt - 1) * (Balance.DEMON_BRIMSTONE_SAC_PER_TIER ?? 0.5)))
    }

    // Spend a fraction of the bank → bigger the reserve, bigger the hellfire.
    const spend = Math.floor((boss.brimstone ?? 0) * (Balance.DEMON_PACT_SPEND_FRAC ?? 0.6))
    boss.brimstone = Math.max(0, (boss.brimstone ?? 0) - spend)

    const advsIn = (this._gameState.adventurers?.active ?? [])
      .filter(a => (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, room) && !a._shadowMonarch && !a._lightParty)
    let refund = 0
    for (const a of advsIn) {
      const frac = (Balance.DEMON_PACT_BASE_DMG_PCT ?? 0.10) + spend * (Balance.DEMON_PACT_DMG_PER_BRIMSTONE ?? 0.0015)
      const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * frac))
      a.resources.hp = Math.max(this._shadowFloor(a), a.resources.hp - dmg)
      if (tier >= 3) a._noHealUntil = Math.max(a._noHealUntil ?? 0, now + (Balance.DEMON_PACT_HEALBLOCK_MS ?? 2000))
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'fire' })
      // T4 Soulfire Execute — heroes dragged below the threshold are consumed + refund Brimstone.
      if (a.resources.hp > 0 && tier >= 4
          && a.resources.hp <= (a.resources.maxHp ?? 0) * (Balance.DEMON_PACT_EXECUTE_PCT ?? 0.18)) {
        a.resources.hp = 0
        refund += (Balance.DEMON_PACT_EXECUTE_REFUND ?? 10)
      }
      if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'sacrifice_pact', killerName: 'Infernal Pact', roomId: room.instanceId, damageType: 'fire' })
    }
    if (refund > 0) boss.brimstone = Math.min(this._brimstoneCap(), (boss.brimstone ?? 0) + refund)

    // T2+ — the room keeps burning (lingering hellfire ground).
    if (tier >= 2) {
      this._hellfireZones = (this._hellfireZones ?? []).filter(z => z.roomId !== room.instanceId)
      this._hellfireZones.push({ roomId: room.instanceId, until: now + (Balance.DEMON_PACT_BURN_DURATION_MS ?? 5000), _tickAt: now })
    }

    const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
    AbilityVfx?.infernalPactFx?.(this._scene, cx, cy, {
      tier, rectW: room.width * TS, rectH: room.height * TS,
      fromX: burnX, fromY: burnY, demonX: boss.worldX, demonY: boss.worldY,
    })

    this._gameState._demon ??= { sacrificeUsesLeft: 0 }
    this._gameState._demon.sacrificeUsesLeft = Math.max(0, this._gameState._demon.sacrificeUsesLeft - 1)
    this._sacrificeArmed = false
    EventBus.emit('DEMON_SACRIFICE_FIRED', { roomId: room.instanceId, room, tier, spend, victims: advsIn.length })
  }

  // Volatile Legion (T2) — a Hellgate imp killed by a hero erupts in hellfire.
  _onDemonMinionDied(m, killerId) {
    if (currentAct(this._gameState) < 2 || !m?._isDemonImp) return
    if (!killerId || killerId === 'sacrifice_pact') return
    const killer = (this._gameState?.adventurers?.active ?? []).find(a => a.instanceId === killerId)
    if (!killer) return
    const TS = Balance.TILE_SIZE, R = (Balance.DEMON_IMP_EXPLODE_RADIUS_TS ?? 1.6) * TS
    const ex = m.worldX ?? killer.worldX, ey = m.worldY ?? killer.worldY
    for (const a of (this._gameState?.adventurers?.active ?? [])) {
      if ((a.resources?.hp ?? 0) <= 0 || a._shadowMonarch || a._lightParty) continue
      if (Math.hypot((a.worldX ?? 0) - ex, (a.worldY ?? 0) - ey) > R) continue
      const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * (Balance.DEMON_IMP_EXPLODE_DMG_PCT ?? 0.10)))
      a.resources.hp = Math.max(this._shadowFloor(a), a.resources.hp - dmg)
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'fire' })
      if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Volatile Imp', roomId: null, damageType: 'fire' })
    }
    if (this._scene && Number.isFinite(ex)) AbilityVfx?.combustFx?.(this._scene, ex, ey)
  }

  // Passive Brimstone HP regen (lifeline) + T4 Infernal Ascendance minion buff.
  _tickDemonBrimstone(dt) {
    if (this._archId() !== 'demon') return
    const boss = this._gameState?.boss
    if (!boss) return
    const bs = boss.brimstone ?? 0
    if (bs > 0 && (boss.hp ?? 0) > 0 && (boss.hp ?? 0) < (boss.maxHp ?? 0)) {
      const nearCap = currentAct(this._gameState) >= 4 && bs >= this._brimstoneCap() * (Balance.DEMON_ASCEND_NEAR_CAP_FRAC ?? 0.75)
      const surge = nearCap ? (Balance.DEMON_BRIMSTONE_REGEN_SURGE ?? 3) : 1
      boss.hp = Math.min(boss.maxHp, boss.hp + (boss.maxHp ?? 0) * (Balance.DEMON_BRIMSTONE_REGEN_PCT ?? 0.003) * surge * (dt / 1000))
    }
    this._tickInfernalAscendance()
  }

  // T4 Infernal Ascendance — while Brimstone is near cap, every dungeon minion's
  // attacks sear (modeled as an ATK surge, captured-baseline, restored when it
  // lapses / on save). `_ascendBaseAtk`/`_ascendApplied` stripped on save.
  _tickInfernalAscendance() {
    const boss = this._gameState?.boss
    if (!boss) return
    const on = currentAct(this._gameState) >= 4
      && (boss.brimstone ?? 0) >= this._brimstoneCap() * (Balance.DEMON_ASCEND_NEAR_CAP_FRAC ?? 0.75)
    for (const m of (this._gameState?.minions ?? [])) {
      if (m.faction !== 'dungeon' || m.aiState === 'dead') continue
      if (on && !m._ascendApplied && m.stats) {
        m._ascendBaseAtk = m.stats.attack ?? 0
        m.stats.attack = Math.round((m.stats.attack ?? 0) * (1 + (Balance.DEMON_ASCEND_BURN_PCT ?? 0.2)))
        m._ascendApplied = true
      } else if (!on && m._ascendApplied) {
        if (m.stats && m._ascendBaseAtk != null) m.stats.attack = m._ascendBaseAtk
        m._ascendApplied = false; delete m._ascendBaseAtk
      }
    }
  }

  // Lingering Pact burning-ground zones (transient, scene-time; not saved).
  _tickDemonHellfire(now) {
    if (this._archId() !== 'demon') return
    const zones = this._hellfireZones ?? []
    if (zones.length === 0) return
    const tier = currentAct(this._gameState)
    this._hellfireZones = zones.filter(z => z.until > now)
    for (const z of this._hellfireZones) {
      const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === z.roomId)
      if (!room) continue
      if (now - (z._tickAt ?? 0) >= (Balance.DEMON_PACT_BURN_TICK_MS ?? 1000)) {
        z._tickAt = now
        for (const a of (this._gameState?.adventurers?.active ?? [])) {
          if ((a.resources?.hp ?? 0) <= 0 || a._shadowMonarch || a._lightParty || !_advInsideRoom(a, room)) continue
          const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * (Balance.DEMON_PACT_BURN_PCT_PER_TICK ?? 0.02)))
          a.resources.hp = Math.max(this._shadowFloor(a), a.resources.hp - dmg)
          if (tier >= 3) a._noHealUntil = Math.max(a._noHealUntil ?? 0, now + (Balance.DEMON_PACT_HEALBLOCK_MS ?? 2000))
          EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: 'fire' })
          if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'sacrifice_pact', killerName: 'Hellfire', roomId: room.instanceId, damageType: 'fire' })
        }
      }
      if (this._scene?.add && Math.random() < 0.5) {
        const TS = Balance.TILE_SIZE
        const fx = (room.gridX + 0.5 + Math.random() * (room.width - 1)) * TS
        const fy = (room.gridY + 0.5 + Math.random() * (room.height - 1)) * TS
        AbilityVfx?.flameLickFx?.(this._scene, fx, fy, { h: 18 + Math.random() * 8, w: 5 + Math.random() * 2, embers: true })
      }
    }
  }

  // Permanent infernal portal placed in the top-left corner of the boss
  // chamber. Visual-only; spawn logic is in _spawnHellgateImps.
  _renderHellgatePortal() {
    if (this._archId() !== 'demon') return
    const s = this._scene
    if (!s?.add?.sprite) return
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return
    if (this._hellgateFx) return  // already placed; animation loops itself
    if (!s.textures.exists('demon-portal')) return
    const TS = Balance.TILE_SIZE
    const cx = (bossRoom.gridX + 3) * TS
    const cy = (bossRoom.gridY + 3) * TS
    this._hellgateFx = s.add.sprite(cx, cy, 'demon-portal')
      .setDepth(2.7)
      .setScale(2)
    if (s.anims.exists('demon-portal-spin')) {
      this._hellgateFx.play('demon-portal-spin')
    }
  }

  _impStatScaleForLevel(bossLv) {
    const base = Balance.DEMON_HELLGATE_BASE_STAT_FRAC
    const bonus = Math.max(0, bossLv) * Balance.DEMON_HELLGATE_STAT_PER_LV
    return base * (1 + bonus)
  }

  // Spawn `count` imps in a ring around the boss-room corner. Returns the
  // number actually placed (may be 0 if the boss room or imp def is missing).
  _spawnHellgateImps(count) {
    if (this._archId() !== 'demon') return 0
    if (count <= 0) return 0
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const impDef = minionTypes.find(m => m.id === 'imp1')
    if (!impDef) return 0
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!bossRoom) return 0
    const bossLv = this._gameState?.boss?.level ?? 1
    const scale = this._impStatScaleForLevel(bossLv)

    const cx = bossRoom.gridX + 3
    const cy = bossRoom.gridY + 3

    for (let i = 0; i < count; i++) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2
      const r = 1
      const tx = cx + Math.round(Math.cos(angle) * r)
      const ty = cy + Math.round(Math.sin(angle) * r)
      const minion = createMinion(
        impDef,
        { x: tx, y: ty },
        bossRoom.instanceId,
        { class: 'garrison' },   // note: NOT applying boss-level scaling here;
                                 // we want the explicit scale fraction below.
      )
      const base = impDef.baseStats ?? {}
      minion.resources.maxHp = Math.max(1, Math.round((base.hp     ?? 14) * scale))
      minion.resources.hp    = minion.resources.maxHp
      minion.stats.attack    = Math.max(1, Math.round((base.attack ?? 5)  * scale))
      minion.stats.defense   = Math.max(0, Math.round((base.defense ?? 1) * scale))
      minion._isDemonImp        = true
      minion._impRoamLastSwapAt = 0
      this._gameState.minions.push(minion)
      EventBus.emit('MINION_PLACED', { minion })
    }
    EventBus.emit('DEMON_HELLGATE_SPAWNED', { count, statScale: scale })
    return count
  }

  // Per-frame: rotate every demon imp's assignedRoomId every ~6 seconds so
  // they roam the dungeon instead of orbiting the boss room. The base
  // patrol AI handles intra-room movement; we just retarget where "home" is.
  _tickDemonImps(now) {
    if (this._archId() !== 'demon') return
    const minions = this._gameState?.minions ?? []
    const rooms   = this._gameState?.dungeon?.rooms ?? []
    if (minions.length === 0 || rooms.length === 0) return
    const ROAM_SWAP_MS = 6000
    const roamPool = rooms.filter(r => r.definitionId !== 'boss_chamber')
    if (roamPool.length === 0) return
    for (const m of minions) {
      if (!m._isDemonImp) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      m._impRoamLastSwapAt ??= 0
      if (now - m._impRoamLastSwapAt < ROAM_SWAP_MS) continue
      m._impRoamLastSwapAt = now
      const pick = roamPool[Math.floor(Math.random() * roamPool.length)]
      const cx = pick.gridX + Math.floor(pick.width  / 2)
      const cy = pick.gridY + Math.floor(pick.height / 2)
      m.assignedRoomId = pick.instanceId
      m.homeTileX = cx
      m.homeTileY = cy
      // The base patrol AI will path the imp toward this new home; no
      // direct teleport needed.
    }
  }

  // ── WRAITH: Fear Meter + Haunting ──────────────────────────────────────

  _addFear(adv, amount) {
    if (this._archId() !== 'wraith') return
    if (!adv) return
    if (adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) return
    if (amount <= 0) return
    // THE DREAD HARVEST — banked DREAD amplifies every fright, and a cut of the
    // fear actually inflicted banks back into the pool (the terror feeds it).
    amount *= this._dreadFearMult()
    const cap = Balance.WRAITH_FEAR_MAX
    const before = adv._fear ?? 0
    adv._fear = Math.min(cap, before + amount)
    const delta = adv._fear - before
    if (delta > 0) {
      this._bankDread(delta * (Balance.WRAITH_DREAD_PER_FEAR ?? 0.25))
      EventBus.emit('WRAITH_FEAR_CHANGED', {
        advId:  adv.instanceId,
        fear:   adv._fear,
        delta,
      })
    }
  }

  // ── WRAITH: THE DREAD HARVEST — banked DREAD economy ───────────────────────
  _dreadCap() { return (Balance.WRAITH_DREAD_CAP_BASE ?? 60) + currentAct(this._gameState) * (Balance.WRAITH_DREAD_CAP_PER_ACT ?? 50) }
  _dreadSat() { return Math.max(0, Math.min(1, (this._gameState?.boss?.dread ?? 0) / Math.max(1, this._dreadCap()))) }
  _dreadFearMult() { return 1 + this._dreadSat() * (Balance.WRAITH_DREAD_FEAR_MULT_MAX ?? 1.0) }

  _bankDread(amount) {
    const boss = this._gameState?.boss
    if (!boss || !(amount > 0)) return
    const before = boss.dread ?? 0
    boss.dread = Math.min(this._dreadCap(), before + amount)
    const gained = boss.dread - before
    if (gained > 0) EventBus.emit('WRAITH_DREAD_BANKED', { amount: gained, total: boss.dread })
  }

  // Contagious Panic (T3) — when a hero breaks, nearby allies catch the terror.
  _spreadPanic(adv, amount) {
    if (currentAct(this._gameState) < 3 || !adv || !Number.isFinite(adv.worldX)) return
    const TS = Balance.TILE_SIZE, R = (Balance.WRAITH_PANIC_SPREAD_RADIUS_TS ?? 3) * TS
    for (const a of (this._gameState?.adventurers?.active ?? [])) {
      if (!a || a === adv || (a.resources?.hp ?? 0) <= 0) continue
      if (Math.hypot((a.worldX ?? 0) - adv.worldX, (a.worldY ?? 0) - adv.worldY) > R) continue
      this._addFear(a, amount)
    }
  }

  _onTrapTriggered(payload) {
    if (this._archId() !== 'wraith') return
    const adv = payload?.adventurer
    if (!adv) return
    this._addFear(adv, Balance.WRAITH_FEAR_PER_TRAP_TRIGGERED)
  }

  _onMinionObserved(payload) {
    if (this._archId() !== 'wraith') return
    const adv = this._gameState?.adventurers?.active?.find(a => a.instanceId === payload?.advId)
    this._addFear(adv, Balance.WRAITH_FEAR_PER_MINION_SIGHTED)
  }

  // Corpse-seen fear bump fires when an adv enters a room that contains an
  // adventurer's body. AdventurerRenderer keeps dead adv sprites parked
  // until NIGHT_PHASE_STARTED, so room-change is the cleanest trigger.
  _onAdvRoomChanged(payload) {
    const archId = this._archId()
    if (archId === 'lich') this._lichOnAdvRoomChanged(payload)
    if (archId !== 'wraith') return
    const adv = payload?.adventurer
    const roomId = payload?.toRoomId
    if (!adv || !roomId) return
    const grid = this._scene?.dungeonGrid
    if (!grid) return
    const room = this._gameState?.dungeon?.rooms?.find(r => r.instanceId === roomId)
    if (!room) return
    const corpseHere = (this._gameState?.adventurers?.active ?? []).some(a => {
      if (!a || a === adv) return false
      if (a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0) return false
      const r = grid.getRoomAtTile?.(a.tileX, a.tileY)
      return r?.instanceId === roomId
    })
    if (corpseHere) this._addFear(adv, Balance.WRAITH_FEAR_PER_CORPSE_SEEN)
  }

  // LICH: when an adventurer walks into the phylactery's room, roll once
  // (LICH_PHYLACTERY_ROOM_FIND_CHANCE) to convert them into a hunter. Once
  // rolled (pass or fail) the adv is sticky — they won't keep rolling on
  // re-entry, so the chance stays meaningful instead of "eventually 100%
  // if they pace through enough." Spawn-time rolls remain independent.
  _lichOnAdvRoomChanged(payload) {
    const adv = payload?.adventurer
    const roomId = payload?.toRoomId
    if (!adv || !roomId) return
    const phyl = this._gameState?.phylactery
    if (!phyl || (phyl.resources?.hp ?? 0) <= 0) return
    if (phyl.roomId !== roomId) return
    if (adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) return
    if (adv._huntPhylactery) return
    if (adv._phylRoomRolled) return
    const t = adv.goal?.type
    if (t === 'HUNT_PHYLACTERY' || t === 'AT_BOSS' || t === 'CHARM_WALK' ||
        t === 'FLEE' || adv.aiState === 'fleeing' || adv.aiState === 'charmed') {
      return
    }
    adv._phylRoomRolled = true
    // Heart-life gate (2026-05-27, design refresh): the heart is
    // invisible-as-target until it has saved the boss once. Pre-revive,
    // an adventurer can walk through the heart's room without forming
    // any intent to attack it — they just take note (observation still
    // records it in adv.knowledge.items, so they'll act on it later if
    // the boss ever heart-revives during their lifetime). Post-revive,
    // every adv crossing the room commits, no roll. Replaces the prior
    // 20%-baseline LICH_PHYLACTERY_ROOM_FIND_CHANCE that leaked
    // pre-revive conversions.
    //
    // Same-day rest gate: also pause on `_diedThisDay` so the day of a
    // boss death/revive doesn't auto-convert anyone — the heart gets
    // its safe day before hunters mobilise again next morning.
    const boss = this._gameState?.boss
    const onHeartLife = !!boss?._onHeartLife
    if (!onHeartLife || boss?._diedThisDay) return
    adv._huntPhylactery = true
    adv.goalStack ??= []
    if (adv.goal) adv.goalStack.push(adv.goal)
    adv.goal = { type: 'HUNT_PHYLACTERY', roomId: phyl.roomId }
    adv.path = null
  }

  // Per-frame: react to fear thresholds + tick the friendly-fire window.
  _tickWraith() {
    if (this._archId() !== 'wraith') return
    const advs = this._gameState?.adventurers?.active ?? []
    const now = this._scene?.time?.now ?? 0
    const rooms = this._gameState?.dungeon?.rooms ?? []
    // -2 from each threshold per boss-lv beyond 1, clamped to floors so even
    // lv10 leaves panic-death at 80, friendly-fire at 55, flee at 30.
    const bossLv = this._gameState?.boss?.level ?? 1
    // DREAD lowers the break thresholds further as it banks (the dungeon is more
    // terrifying the more terror it has fed on).
    const dreadDrop = this._dreadSat() * (Balance.WRAITH_DREAD_THRESHOLD_REDUCTION ?? 15)
    const reduction = Math.max(0, bossLv - 1) * Balance.WRAITH_FEAR_THRESHOLD_REDUCTION_PER_LV + dreadDrop
    const fleeThresh = Math.max(25, Balance.WRAITH_FEAR_FLEE_THRESHOLD            - reduction)
    const ffThresh   = Math.max(45, Balance.WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD   - reduction)
    const pdThresh   = Math.max(70, Balance.WRAITH_FEAR_PANIC_DEATH_THRESHOLD     - reduction)
    const tier = currentAct(this._gameState)
    // Creeping Dread (T2+) — a passive ambient terror tick to everyone in
    // non-entry rooms, scaled by DREAD saturation. The Pall (T4) raises a fear
    // FLOOR across the whole party so nobody stays calm.
    if (tier >= 2 && now - (this._dreadAmbientAt ?? 0) >= (Balance.WRAITH_AMBIENT_INTERVAL_MS ?? 1000)) {
      this._dreadAmbientAt = now
      const grid = this._scene?.dungeonGrid
      const amb = (Balance.WRAITH_AMBIENT_FEAR ?? 1.2) * (0.5 + this._dreadSat())
      const pallFloor = tier >= 4 ? (Balance.WRAITH_PALL_FEAR_FLOOR ?? 40) : 0
      for (const a of advs) {
        if (!a || a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0) continue
        const r = grid?.getRoomAtTile?.(a.tileX, a.tileY)
        const def = r?.definitionId
        if (def === 'entry_hall') continue
        this._addFear(a, amb)
        if (pallFloor > 0 && (a._fear ?? 0) < pallFloor) this._addFear(a, pallFloor - (a._fear ?? 0))
      }
    }
    for (const adv of advs) {
      if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
      const fear = adv._fear ?? 0
      // 50% (lv-scaled) — panic flee to a random non-entry room (one-shot).
      if (fear >= fleeThresh && !adv._fearFleeTriggered) {
        adv._fearFleeTriggered = true
        const candidates = rooms.filter(r =>
          r.definitionId !== 'entry_hall' && r.definitionId !== 'boss_chamber',
        )
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)]
          adv.goal = { type: 'EXPLORE_ROOM', roomId: pick.instanceId }
          adv.path = null
          EventBus.emit('WRAITH_FEAR_FLEE', { advId: adv.instanceId, roomId: pick.instanceId })
        }
        // Player-positive: a panicked hero drops gold as they bolt, the terror
        // banks DREAD, and (T3+) it spreads to nearby allies — never a clean escape.
        this._gameState.player ??= {}
        const dropped = Math.round((Balance.GOLD_PER_KILL ?? 10) * (Balance.WRAITH_FLEE_GOLD_FRAC ?? 0.4))
        if (dropped > 0) {
          this._gameState.player.gold = (this._gameState.player.gold ?? 0) + dropped
          EventBus.emit('RESOURCES_AWARDED', { gold: dropped, source: 'wraith_panic_flee' })
        }
        this._bankDread(Balance.WRAITH_DREAD_PER_BREAK ?? 6)
        this._spreadPanic(adv, Balance.WRAITH_PANIC_SPREAD_FEAR ?? 12)
        if (this._scene && Number.isFinite(adv.worldX)) AbilityVfx?.panicBreakFx?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 16, { gold: true })
      }
      // 75% — friendly-fire window. Single-shot per threshold crossing:
      // armed once when fear first hits 75, runs for FRIENDLY_FIRE_WINDOW_MS,
      // then clears so the adv resumes normal AI until they either hit 100%
      // panic-die or the run ends. _fearAttackArmed prevents re-arm.
      if (fear >= ffThresh) {
        if (!adv._fearAttackArmed) {
          adv._fearAttackArmed = true
          adv._fearAttackUntil = now + Balance.WRAITH_FEAR_FRIENDLY_FIRE_WINDOW_MS
          const party = adv.partyId
            ? advs.filter(a => a !== adv && a.partyId === adv.partyId && (a.resources?.hp ?? 0) > 0)
            : advs.filter(a => a !== adv && (a.resources?.hp ?? 0) > 0)
          if (party.length > 0) {
            const target = party[Math.floor(Math.random() * party.length)]
            adv.goal = { type: 'ATTACK_ALLY', allyId: target.instanceId, source: 'wraith_fear' }
            adv.path = null
            EventBus.emit('WRAITH_FRIENDLY_FIRE', { advId: adv.instanceId, targetId: target.instanceId })
            this._bankDread(Balance.WRAITH_DREAD_PER_BREAK ?? 6)
            this._spreadPanic(adv, Balance.WRAITH_PANIC_SPREAD_FEAR ?? 12)
            if (this._scene && Number.isFinite(adv.worldX)) AbilityVfx?.panicBreakFx?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 16, {})
          }
        } else if (adv._fearAttackUntil && now >= adv._fearAttackUntil &&
                   adv.goal?.type === 'ATTACK_ALLY' && adv.goal?.source === 'wraith_fear') {
          // Window expired — route back to a random non-entry, non-boss
          // room so the adv resumes wandering. AISystem._goalToTile reads
          // .type unguarded, so we hand it a valid goal rather than null.
          const rooms = this._gameState?.dungeon?.rooms ?? []
          const candidates = rooms.filter(r =>
            r.definitionId !== 'entry_hall' && r.definitionId !== 'boss_chamber',
          )
          if (candidates.length > 0) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)]
            adv.goal = { type: 'EXPLORE_ROOM', roomId: pick.instanceId }
          } else {
            adv.goal = { type: 'FLEE', reason: 'wraith_fear_window_ended' }
          }
          adv.path = null
        }
      }
      // 100% — instant panic death. Drop gold like a normal kill, no XP.
      // Sung Jinwoo is immune — fear (a boss ability) can't kill the Shadow
      // Monarch; only the boss duel can.
      if (fear >= pdThresh && !adv._fearPanicDeathTriggered && !adv._shadowMonarch && !adv._lightParty) {
        adv._fearPanicDeathTriggered = true
        adv.resources.hp = 0
        this._gameState.player ??= {}
        this._gameState.player.gold = (this._gameState.player.gold ?? 0) + Balance.GOLD_PER_KILL
        EventBus.emit('RESOURCES_AWARDED', { gold: Balance.GOLD_PER_KILL, source: 'wraith_panic' })
        if (this._scene && Number.isFinite(adv.worldX)) AbilityVfx?.frightDeathFx?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 16, {})
        this._bankDread(Balance.WRAITH_DREAD_PER_BREAK ?? 6)
        this._spreadPanic(adv, Balance.WRAITH_PANIC_SPREAD_FEAR ?? 12)
        EventBus.emit('ADVENTURER_DIED', {
          adventurer: adv,
          killerId:   'fear',
          killerName: 'Fear',
          roomId:     this._scene?.dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY)?.instanceId ?? null,
          damageType: 'fear',
          _noBossXp:  true,
        })
      }
    }
    // Move haunt ghosts (wall-phase) — runs every tick so they hunt smoothly.
    this._tickHauntGhosts(now)
    // Tick haunted dread zones (Night Terror T2).
    this._tickTerrorZones(now)
  }

  // Haunted dread zones (Night Terror T2) — keep adding fear to anyone inside.
  _tickTerrorZones(now) {
    if (!this._terrorZones || this._terrorZones.length === 0) return
    const TS = Balance.TILE_SIZE
    for (let i = this._terrorZones.length - 1; i >= 0; i--) {
      const z = this._terrorZones[i]
      if (now >= z.until) { this._terrorZones.splice(i, 1); continue }
      if (now - (z.lastTickAt ?? 0) < (Balance.WRAITH_TERROR_ZONE_TICK_MS ?? 1000)) continue
      z.lastTickAt = now
      const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === z.roomId)
      if (!room) { this._terrorZones.splice(i, 1); continue }
      const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
      let any = false
      for (const a of (this._gameState?.adventurers?.active ?? [])) {
        if (!a || (a.resources?.hp ?? 0) <= 0 || !_advInsideRoom(a, room)) continue
        this._addFear(a, Balance.WRAITH_TERROR_ZONE_FEAR ?? 8); any = true
      }
      if (any) AbilityVfx?.dreadZoneFx?.(this._scene, cx, cy, { tier: z.tier ?? 2, rectW: room.width * TS, rectH: room.height * TS, refresh: true })
    }
  }

  // ── NIGHT TERROR (day active) ──────────────────────────────────────────────
  _terrorUsesLeft() { return this._gameState?.boss?._wraithTerror?.usesLeft ?? 0 }
  _terrorAvailable() { return this._archId() === 'wraith' && (this._gameState?.meta?.phase ?? '') === 'day' && this._terrorUsesLeft() > 0 }
  _armTerror() { if (!this._terrorAvailable()) return; this._terrorArmed = true; EventBus.emit('WRAITH_TERROR_ARMED', {}) }
  _disarmTerror() { this._terrorArmed = false; EventBus.emit('WRAITH_TERROR_DISARMED', {}) }
  _fireTerror(payload) {
    if (!this._terrorArmed) return
    if (!this._terrorAvailable()) { this._disarmTerror(); return }
    const boss = this._gameState?.boss
    const room = (this._gameState?.dungeon?.rooms ?? []).find(r => r.instanceId === payload?.roomId)
    if (!boss || !room) return
    const tier = currentAct(this._gameState), TS = Balance.TILE_SIZE
    const cx = (room.gridX + room.width / 2) * TS, cy = (room.gridY + room.height / 2) * TS
    const spike = (Balance.WRAITH_TERROR_FEAR ?? 35) * (0.7 + this._dreadSat())
    const advsIn = (this._gameState.adventurers?.active ?? []).filter(a => (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, room))
    for (const a of advsIn) this._addFear(a, spike)
    // T3 — instantly break the most-afraid hero (force the friendly-fire window).
    if (tier >= 3 && advsIn.length > 0) {
      const top = advsIn.slice().sort((a, b) => (b._fear ?? 0) - (a._fear ?? 0))[0]
      if (top) this._addFear(top, Balance.WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD ?? 75)
    }
    // T4 — any hero already past the panic threshold is frightened to death now.
    if (tier >= 4) {
      const pd = Balance.WRAITH_FEAR_PANIC_DEATH_THRESHOLD ?? 100
      for (const a of advsIn) {
        if ((a._fear ?? 0) >= pd - 1 && !a._shadowMonarch && !a._lightParty && !a._fearPanicDeathTriggered) {
          this._addFear(a, pd)   // _tickWraith will resolve the heart-stop next frame
        }
      }
    }
    // T2 — lingering haunted dread zone.
    if (tier >= 2) {
      this._terrorZones = (this._terrorZones ?? []).filter(z => z.roomId !== room.instanceId)
      this._terrorZones.push({ roomId: room.instanceId, until: (this._scene?.time?.now ?? 0) + (Balance.WRAITH_TERROR_ZONE_MS ?? 5000), lastTickAt: 0, tier })
    }
    this._bankDread((Balance.WRAITH_DREAD_PER_BREAK ?? 6) * advsIn.length)
    AbilityVfx?.nightTerrorFx?.(this._scene, cx, cy, { tier, rectW: room.width * TS, rectH: room.height * TS, victims: advsIn.map(a => ({ x: a.worldX, y: (a.worldY ?? 0) - 16 })) })
    if (boss._wraithTerror) boss._wraithTerror.usesLeft = Math.max(0, (boss._wraithTerror.usesLeft ?? 0) - 1)
    this._terrorArmed = false
    EventBus.emit('WRAITH_TERROR_FIRED', { roomId: room.instanceId, room, tier, victims: advsIn.length })
  }

  _stopDreadFightTimer() { this._dreadFightTimer?.remove?.(false); this._dreadFightTimer = null }

  // Throne fight — Dread Pulse -> Phantom Assault -> Mass Hysteria -> Night Terror
  // finale. Fear matters in the throne room too: terror weakens + turns fighters.
  _tickDreadFight() {
    const boss = this._gameState?.boss; if (!boss) return
    const tier = currentAct(this._gameState)
    const bossRoom = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber'); if (!bossRoom) return
    const TS = Balance.TILE_SIZE
    const fighters = (this._gameState?.adventurers?.active ?? []).filter(a => a && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 && _advInsideRoom(a, bossRoom))
    if (fighters.length === 0) return
    const cx = (bossRoom.gridX + bossRoom.width / 2) * TS, cy = (bossRoom.gridY + bossRoom.height / 2) * TS
    const dreadDmg = (a, pct, type = 'fear') => {
      const dmg = Math.max(1, Math.floor((a.resources?.maxHp ?? 0) * pct))
      a.resources.hp = Math.max(0, a.resources.hp - dmg)
      EventBus.emit('COMBAT_HIT', { sourceId: 'boss', targetId: a.instanceId, damage: dmg, damageType: type })
      if (a.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: a, killerId: 'boss', killerName: 'Wraith', roomId: bossRoom.instanceId, damageType: type })
    }

    // T4 Night Terror finale (<30% HP) — black out the room, mass fright-death.
    if (tier >= 4 && !this._nightTerrorFinaleDone && (boss.hp ?? 0) > 0 && (boss.hp ?? 0) < (boss.maxHp ?? 1) * 0.3) {
      this._nightTerrorFinaleDone = true
      AbilityVfx?.nightTerrorFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS, big: true, victims: fighters.map(a => ({ x: a.worldX, y: (a.worldY ?? 0) - 16 })) })
      const pd = Balance.WRAITH_FEAR_PANIC_DEATH_THRESHOLD ?? 100
      for (const a of fighters) {
        this._addFear(a, Balance.WRAITH_TERROR_FEAR ?? 35)
        if ((a._fear ?? 0) >= pd - 1 && !a._shadowMonarch && !a._lightParty) {
          if (this._scene && Number.isFinite(a.worldX)) AbilityVfx?.frightDeathFx?.(this._scene, a.worldX, (a.worldY ?? 0) - 16, {})
          dreadDmg(a, 9.99, 'fear')   // overkill → instant heart-stop for the truly terrified
        } else {
          dreadDmg(a, (Balance.WRAITH_FIGHT_FINALE_PCT ?? 0.12) + this._dreadSat() * 0.08, 'fear')
        }
      }
      return
    }
    if (tier >= 3) {
      // Mass Hysteria — fighters past the ff-threshold turn on each other.
      AbilityVfx?.massHysteriaFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS })
      const ff = Balance.WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD ?? 75
      for (const a of fighters) this._addFear(a, Balance.WRAITH_FIGHT_FEAR_TICK ?? 14)
      for (const a of fighters) { if ((a._fear ?? 0) >= ff) dreadDmg(a, Balance.WRAITH_FIGHT_HYSTERIA_PCT ?? 0.06, 'physical') }
    } else if (tier >= 2) {
      // Phantom Assault — haunt-ghosts manifest and strike all fighters.
      AbilityVfx?.phantomAssaultFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS, victims: fighters.map(a => ({ x: a.worldX, y: (a.worldY ?? 0) - 16 })) })
      for (const a of fighters) { this._addFear(a, Balance.WRAITH_FIGHT_FEAR_TICK ?? 14); dreadDmg(a, Balance.WRAITH_FIGHT_PHANTOM_PCT ?? 0.05, 'fear') }
    } else {
      // Dread Pulse — a wave of terror + chip damage.
      AbilityVfx?.dreadPulseFx?.(this._scene, cx, cy, { tier, rectW: bossRoom.width * TS, rectH: bossRoom.height * TS })
      for (const a of fighters) { this._addFear(a, Balance.WRAITH_FIGHT_FEAR_TICK ?? 14); dreadDmg(a, Balance.WRAITH_FIGHT_PULSE_PCT ?? 0.04, 'fear') }
    }
  }

  // Spawn a free ghost2 at the death tile when the wraith is the active boss.
  _spawnHauntGhost(deadAdv, roomId) {
    if (this._archId() !== 'wraith') return
    if (!deadAdv) return
    // Hard cap on simultaneous haunts. Without it Wraith snowballs: every
    // adv kill stacks another permanent wall-phasing predator. New kills
    // past the cap simply don't spawn a ghost; a slot opens up when an
    // existing haunt dies (one-shot — see respawnAll filter).
    const liveHauntCount = (this._gameState?.minions ?? []).filter(m =>
      m._isHauntGhost && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0
    ).length
    // +0.5 max per boss-lv (lv10 = +5 → cap 10 ghosts).
    const _hauntBossLv = this._gameState?.boss?.level ?? 1
    const hauntCap = Balance.WRAITH_HAUNT_MAX_ACTIVE
      + Math.floor(_hauntBossLv * Balance.WRAITH_HAUNT_MAX_PER_BOSS_LV)
    if (liveHauntCount >= hauntCap) {
      EventBus.emit('WRAITH_HAUNT_CAPPED', {
        cap: hauntCap,
        advId: deadAdv.instanceId ?? null,
      })
      return
    }
    const minionTypes = this._scene?.cache?.json?.get?.('minionTypes') ?? []
    const ghostDef = minionTypes.find(m => m.id === 'ghost2')
    if (!ghostDef) return
    const bossLv = this._gameState?.boss?.level ?? 1
    // Resolve the haunt's home room — prefer the room of death; otherwise
    // grid-lookup at the death tile.
    const grid = this._scene?.dungeonGrid
    const homeRoomId = roomId
      ?? grid?.getRoomAtTile?.(deadAdv.tileX, deadAdv.tileY)?.instanceId
      ?? null
    const tx = deadAdv.tileX ?? 0
    const ty = deadAdv.tileY ?? 0
    const minion = createMinion(
      ghostDef,
      { x: tx, y: ty },
      homeRoomId,
      { class: 'garrison', bossLevel: bossLv },
    )
    minion._isHauntGhost   = true
    minion._hauntHomeRoomId = homeRoomId
    minion._hauntHomeTileX  = tx
    minion._hauntHomeTileY  = ty
    minion._hauntPhase      = 'home'   // 'home' | 'hunt' | 'return'
    minion.isSpectral       = true
    // bossLevel option already triggers applyBossLevelToMinion inside
    // createMinion — DO NOT call it a second time or stats double-scale.
    this._gameState.minions.push(minion)
    EventBus.emit('MINION_PLACED', { minion })
    EventBus.emit('WRAITH_HAUNT_SPAWNED', { minionId: minion.instanceId, roomId: homeRoomId })
  }

  // Haunt ghosts ignore pathfinding and walk directly through walls toward
  // the nearest detected adventurer in their spawn room or any directly-
  // connected adjacent room. When alone, they drift back to home tile.
  _tickHauntGhosts(now) {
    const minions = this._gameState?.minions ?? []
    if (minions.length === 0) return
    const advs = this._gameState?.adventurers?.active ?? []
    const rooms = this._gameState?.dungeon?.rooms ?? []
    const lastTick = this._lastHauntTickAt ?? now
    const dt = Math.min(0.25, (now - lastTick) / 1000)   // clamp huge gaps
    this._lastHauntTickAt = now
    if (dt <= 0) return
    const speed = Balance.WRAITH_HAUNT_PHASE_SPEED_TILES_PER_SEC

    const TS = Balance.TILE_SIZE
    for (const m of minions) {
      if (!m._isHauntGhost) continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const homeRoom = rooms.find(r => r.instanceId === m._hauntHomeRoomId)
      // Pick a target adv: any adv in spawn room or any adj-connected room.
      let target = null
      let bestD = Infinity
      for (const a of advs) {
        if (!a || (a.resources?.hp ?? 0) <= 0) continue
        const d = Math.hypot(a.tileX - m.tileX, a.tileY - m.tileY)
        if (d > Balance.WRAITH_HAUNT_DETECT_RANGE_TILES) continue
        if (d < bestD) { bestD = d; target = a }
      }
      let goal
      if (target) {
        goal = { x: target.tileX, y: target.tileY }
        m._hauntPhase = 'hunt'
        m.aiState = 'engaging'
      } else if (homeRoom) {
        goal = { x: m._hauntHomeTileX, y: m._hauntHomeTileY }
        const dHome = Math.hypot(m._hauntHomeTileX - m.tileX, m._hauntHomeTileY - m.tileY)
        m._hauntPhase = dHome > 0.5 ? 'return' : 'home'
        m.aiState = m._hauntPhase === 'home' ? 'idle' : 'walking'
      } else {
        continue
      }
      // Direct linear interpolation through walls.
      const dx = goal.x - m.tileX
      const dy = goal.y - m.tileY
      const dist = Math.hypot(dx, dy)
      if (dist <= 0.05) {
        m.tileX = goal.x; m.tileY = goal.y
      } else {
        const step = Math.min(dist, speed * dt)
        m.tileX += (dx / dist) * step
        m.tileY += (dy / dist) * step
      }
      m.worldX = m.tileX * TS + TS / 2
      m.worldY = m.tileY * TS + TS / 2
      // Engage if adjacent — let the existing combat system swing.
      if (target) {
        const inMelee = Math.hypot(target.tileX - m.tileX, target.tileY - m.tileY) <= 1.0
        if (inMelee) {
          this._scene?.combatSystem?.tryAttack?.(m, target)
        }
      }
    }
  }

  // Per-frame: damage advs in active spore rooms; apply corpse-touch venom.
  _tickMyconid(deltaMs) {
    if (this._archId() !== 'myconid') return
    // Animate the drifting spore particles + cloud puffs every frame.
    this._tickSporeVfx(deltaMs)
    const now = this._scene?.time?.now ?? 0
    const tier = currentAct(this._gameState)
    const advs = this._gameState?.adventurers?.active ?? []
    const bloomed = this._bloomedRoomObjs()
    const tickMs = Balance.MYCONID_BLOOM_TICK_MS ?? 1000

    if (bloomed.length > 0) {
      // ── Heroes in a bloomed room — spore DoT (+T2 heal-block + slow) ──
      for (const adv of advs) {
        if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
        let inside = false
        for (const r of bloomed) { if (_advInsideRoom(adv, r)) { inside = true; break } }
        if (!inside) continue
        if (tier >= 2) {
          adv._noHealUntil = Math.max(adv._noHealUntil ?? 0, now + (Balance.MYCONID_BLOOM_HEALBLOCK_MS ?? 1500))
          const next = now + 1200
          if (!adv._slowUntil || adv._slowUntil < next) adv._slowUntil = next
          adv._slowMult = Math.min(adv._slowMult ?? 1, Balance.MYCONID_BLOOM_SLOW_MULT ?? 0.6)
        }
        adv._bloomLastTickAt ??= 0
        if (now - adv._bloomLastTickAt < tickMs) continue
        adv._bloomLastTickAt = now
        const dmg = Math.max(1, Math.floor((adv.resources?.maxHp ?? 0) * (Balance.MYCONID_BLOOM_DOT_PCT_PER_TICK ?? 0.018)))
        const before = adv.resources.hp
        adv.resources.hp = Math.max(this._shadowFloor(adv), before - dmg)
        EventBus.emit('COMBAT_HIT', { sourceId: 'spores', targetId: adv.instanceId, damage: dmg, damageType: 'poison' })
        if (adv.resources.hp <= 0) {
          EventBus.emit('ADVENTURER_DIED', { adventurer: adv, killerId: 'spores', killerName: 'The Bloom', roomId: null, damageType: 'poison' })
        }
      }

      // ── Minions in a bloomed room — symbiosis: regen (+T2 ATK boost) ──
      // ATK uses a captured-baseline that's restored the instant they leave
      // (Warband pattern); `_bloomBaseAtk`/`_bloomApplied` stripped on save.
      for (const m of (this._gameState?.minions ?? [])) {
        if (m.faction !== 'dungeon' || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        let inside = false
        for (const r of bloomed) { if (_advInsideRoom(m, r)) { inside = true; break } }
        if (inside) {
          m._bloomTickAt ??= 0
          if (now - m._bloomTickAt >= tickMs) {
            m._bloomTickAt = now
            const regen = Math.ceil((m.resources?.maxHp ?? 0) * (Balance.MYCONID_BLOOM_MINION_REGEN_PCT ?? 0.02))
            if (regen > 0) m.resources.hp = Math.min(m.resources.maxHp ?? m.resources.hp, (m.resources.hp ?? 0) + regen)
          }
          if (tier >= 2 && !m._bloomApplied && m.stats) {
            m._bloomBaseAtk = m.stats.attack ?? 0
            m.stats.attack = Math.round((m.stats.attack ?? 0) * (1 + (Balance.MYCONID_BLOOM_MINION_ATK_PCT ?? 0.15)))
            m._bloomApplied = true
          }
        } else if (m._bloomApplied) {
          if (m.stats && m._bloomBaseAtk != null) m.stats.attack = m._bloomBaseAtk
          m._bloomApplied = false; delete m._bloomBaseAtk
        }
      }

      // ── T4 Sporestorm — bloomed rooms periodically erupt a spore-pod that
      // pulses an AoE on heroes inside ──
      if (tier >= 4) {
        this._sporestormAt ??= 0
        if (now - this._sporestormAt >= (Balance.MYCONID_SPORESTORM_INTERVAL_MS ?? 5000)) {
          this._sporestormAt = now
          const TS = Balance.TILE_SIZE
          for (const r of bloomed) {
            const cx = (r.gridX + r.width / 2) * TS, cy = (r.gridY + r.height / 2) * TS
            AbilityVfx?.sporeBurstFx?.(this._scene, cx, cy, { tier })
            for (const adv of advs) {
              if (!adv || (adv.resources?.hp ?? 0) <= 0 || !_advInsideRoom(adv, r)) continue
              const dmg = Math.max(1, Math.floor((adv.resources?.maxHp ?? 0) * (Balance.MYCONID_BLOOM_DOT_PCT_PER_TICK ?? 0.018) * 2))
              adv.resources.hp = Math.max(this._shadowFloor(adv), adv.resources.hp - dmg)
              EventBus.emit('COMBAT_HIT', { sourceId: 'spores', targetId: adv.instanceId, damage: dmg, damageType: 'poison' })
              if (adv.resources.hp <= 0) EventBus.emit('ADVENTURER_DIED', { adventurer: adv, killerId: 'spores', killerName: 'The Bloom', roomId: null, damageType: 'poison' })
            }
          }
        }
      }
    }

    // Corpse Bloom contact: each corpse that an adv hasn't already touched
    // adds MYCONID_CORPSE_VENOM_STACKS_ADDED to that adv's venom stack count
    // (which the existing _tickVenom pipeline ticks down per second).
    const corpses = this._gameState?.fungalCorpses ?? []
    if (corpses.length > 0) {
      for (const adv of advs) {
        if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) continue
        adv._fungalCorpsesStung ??= []
        for (const c of corpses) {
          if (adv.tileX !== c.tileX || adv.tileY !== c.tileY) continue
          if (adv._fungalCorpsesStung.includes(c.instanceId)) continue
          adv._fungalCorpsesStung.push(c.instanceId)
          const wasClean = !adv._venomStacks
          adv._venomStacks = (adv._venomStacks ?? 0) + Balance.MYCONID_CORPSE_VENOM_STACKS_ADDED
          if (wasClean) {
            EventBus.emit('STATUS_APPLIED', { targetId: adv.instanceId, label: 'POISONED' })
          }
          EventBus.emit('MYCONID_CORPSE_TOUCHED', {
            advId:    adv.instanceId,
            corpseId: c.instanceId,
            stacks:   adv._venomStacks,
          })
        }
      }
    }
  }
}

// Adv-inside-room check. Adventurers carry tileX/tileY (per-tick AISystem
// updates). Rooms have gridX/gridY/width/height.
function _advInsideRoom(adv, room) {
  if (!adv || !room) return false
  const tx = adv.tileX, ty = adv.tileY
  if (typeof tx !== 'number' || typeof ty !== 'number') return false
  return tx >= room.gridX && tx <  room.gridX + room.width
      && ty >= room.gridY && ty <  room.gridY + room.height
}

// All tunable game numbers live here.
// Change these to balance the game without touching logic.

export const Balance = {
  // --- Grid ---
  TILE_SIZE: 32,
  // Thickness (in tiles) of the wall ring around every procedurally-painted
  // room. Doors paint as a WALL_THICKNESS × 2 block (2 along the wall axis,
  // WALL_THICKNESS through the wall) so adventurers can pass through both
  // wall layers. Room outer width/height in rooms.json is sized to include
  // both wall layers; floor area = outer − 2*WALL_THICKNESS in each dim.
  WALL_THICKNESS: 2,
  STARTING_GRID_WIDTH: 40,
  STARTING_GRID_HEIGHT: 40,
  GRID_EXPANSION_PER_UNLOCK: 10,
  MAX_GRID_SIZE: 100,

  // --- Starting currencies (new run) ---
  STARTING_SOUL_ESSENCE: 999999,

  // DEV: when true, spending essence (placing rooms / minions / traps,
  // and daily upkeep) is a no-op so the player can freely test all
  // content. Toggle back to `false` to restore normal economy.
  DEV_INFINITE_ESSENCE: true,

  // --- Earn rates per adventurer kill ---
  SOUL_ESSENCE_PER_KILL: 10,

  // --- Camera ---
  CAMERA_ZOOM_MIN: 0.25,
  CAMERA_ZOOM_MAX: 2.0,
  CAMERA_ZOOM_DEFAULT: 1.0,
  CAMERA_SCROLL_SPEED: 8,

  // --- Boss progression ---
  BOSS_XP_BASE:     100,   // XP needed to reach lv 2
  BOSS_XP_SCALE:    1.5,   // XP curve: xpForLv(n) = BASE * SCALE^(n-1)
  BOSS_XP_PER_KILL:  10,   // boss XP awarded per adventurer kill

  // --- Boss ---
  BOSS_DEFEATS_TO_GAME_OVER: 3,

  // --- Minions ---
  MINION_RESPAWN_COST_SOUL_ESSENCE: 5,

  // --- Upkeep enforcement ---
  // When essence runs out, rooms shut off newest-first until the bill is met.
  UPKEEP_SHUTDOWN_ORDER: 'newest_first',

  // --- Day phase time controls ---
  TIME_SCALE_PAUSED: 0,
  TIME_SCALE_NORMAL: 1,
  TIME_SCALE_FAST: 2,
  TIME_SCALE_FASTEST: 4,

  // --- Adventurers ---
  ADVENTURERS_PER_DAY_BASE: 1,        // adds +1 every 2 days
  ADVENTURER_BASE_TILES_PER_SEC: 1.5, // multiplied by class.speed

  // --- Combat (Phase 6 kernel) ---
  ATTACK_INTERVAL_MS:        900,     // base time between attacks (scales by 1/speed)
  MELEE_RANGE_TILES:         1.5,     // adventurer or minion in melee range
  AGGRO_RANGE_TILES:         5,       // minion engages within this many tiles in same room
  ENGAGE_REQUIRES_SAME_ROOM: true,    // Phase 6 kernel: minions don't chase outside home room
  MINION_BARRACKS_DISTANCE:  3,       // architectural rule: barracks within N rooms

  // --- Adventurer flee ---
  FLEE_BUFFER:               0.05,    // hysteresis on fleeThreshold so adventurers don't oscillate

  // --- Class abilities (Phase 6c) ---
  // Note: mana system removed in Phase 5b cooldown rework. Abilities are now
  // gated by per-instance cooldowns (see AbilitySystem) and per-day budgets.
  CLERIC_HEAL_AMOUNT:        12,
  CLERIC_HEAL_TARGET_THRESHOLD: 0.8,  // heal an ally below this HP fraction
  HEAL_RANGE_TILES:          2,       // cleric heal-ally range
  LOW_HP_THRESHOLD:          0.4,     // adventurer triggers sleep / low-hp behavior below this fraction
  MARTYR_TAUNT_HP_FRACTION:  0.3,     // martyr triggers taunt at this HP%
  PARANOID_SPEED_MULTIPLIER: 0.55,    // paranoid moves this much slower in unfamiliar rooms

  // --- Defection mechanics (Phase 6d, partly superseded by ability rework) ---
  NECROMANCER_RAISES_PER_DAY:    2,
  NECROMANCER_RAISE_RANGE:       3,    // tiles
  NECROMANCER_RAISE_HP_FRACTION: 0.4,  // raised minion comes back at this HP fraction
  TAME_SUCCESS_RATE:             0.40,
  TAME_RANGE_TILES:              1.5,  // melee attempt
  TAME_COOLDOWN_MS:              1500,
  ECHO_MINE_FOOTSTEP_THRESHOLD:  2,    // step count at which it fires (2 = follower)
  CURSE_BRAND_DURATION_MS:       30000, // mark lasts 30s of game time

  // --- Minion XP / leveling / evolution (Phase 7) ---
  MINION_XP_PER_KILL:            10,    // base XP awarded per adventurer kill
  MINION_XP_LEVEL_BASE:          25,    // XP to reach lv2
  MINION_XP_LEVEL_SCALE:         1.5,   // XP_for_lv_n = BASE * SCALE^(n-1)
  MINION_LEVEL_HP_BONUS:         5,     // hp added per level
  MINION_LEVEL_ATTACK_BONUS:     1,     // attack added per level
  MINION_LEVEL_DEFENSE_BONUS:    1,     // defense added per level (every other level)

  // --- Loot (Phase 7) ---
  LOOT_DROP_ROLLS_PER_DEATH:     2,     // try to drop up to N pieces from victim
  LOOT_TIER_BY_DUNGEON_LEVEL:    3,     // every N dungeon levels, max tier ++
  LOOT_AUTOPICKUP_BY_VULTURE:    true,  // (vulture loot-stealing — Phase 7b)

  // --- Bounty (Phase 7) ---
  BOUNTY_KILL_THRESHOLD:         3,     // minion's kill count that triggers bounty

  // --- Knowledge system (Phase 8) ---
  KNOWLEDGE_STALE_FACTOR:          0.5,    // stale trap cost = KNOWLEDGE_TRAP_COST_MULTIPLIER * this
  KNOWLEDGE_TRAP_COST_MULTIPLIER:  6.0,    // path cost multiplier for tiles with known triggered/known traps
  KNOWLEDGE_DANGER_ROOM_MULT:      1.8,    // path cost mult for rooms known dangerous (deaths happened)
  KNOWLEDGE_INHERIT_FRACTION:      0.5,    // fraction of shared pool a new adventurer inherits
  KNOWLEDGE_INHERIT_ACCURACY:      0.7,    // accuracy of inherited intel (rumour vs witnessed)
  KNOWLEDGE_RETURN_CHANCE:         0.35,   // chance a fled adventurer returns next day with their party
  KNOWLEDGE_RETURN_PARTY_SIZE_MIN: 2,
  KNOWLEDGE_RETURN_PARTY_SIZE_MAX: 4,
  KNOWLEDGE_CARTOGRAPHER_BOOST:    1.0,    // cartographers share at full accuracy (multiplier on accuracy)
  KNOWLEDGE_COWARD_PARTIAL:        0.85,   // cowards share with mild degradation
  KNOWLEDGE_TRAUMATIZED_PARTIAL:   1.0,    // traumatized share full intel

  // --- Room behaviors (Phase 6e) ---
  // [Removed 2026-04-30] HEALING_FOUNTAIN_HP_PER_SEC + ECHOES_ALERT_DURATION_MS
  // (healing_fountain and hall_of_echoes rooms retired in the Room redesign).
  HERALD_ALERT_DURATION_MS:        5000,
  MOURNER_DAMAGE_BUFF_PER_DEATH:   2,      // attack stat gain per nearby ally death
  ENGINEER_TRAP_DAMAGE_BUFF:       1.25,
  SLEEP_HP_PER_SEC:                3,
  SLEEP_REQUIRES_NO_HOSTILES:      true,

  // --- Scaling by boss level (Phase 7b) ---
  ADVENTURER_HP_PER_BOSS_LV:   0.10,   // +10% maxHp per boss level above 1
  ADVENTURER_ATK_PER_BOSS_LV:  0.07,   // +7% attack per boss level above 1
  MINION_HP_PER_BOSS_LV:       0.10,   // +10% maxHp per boss level above 1
  MINION_ATK_PER_BOSS_LV:      0.07,   // +7% attack per boss level above 1
  UNDERDOG_XP_MULT:            2.0,    // adventurer XP multiplier for underdog tag

  // --- Mini-boss / vendetta / vulture / wraith ---
  MINIBOSS_HP_MULT:                3.0,
  MINIBOSS_ATTACK_MULT:            1.6,
  MINIBOSS_GUARANTEED_DROP:        true,
  VENDETTA_TRIGGER_CHANCE:         0.4,    // chance dropped gear creates a vendetta on kill
  VULTURE_LOOT_STEAL_RANGE:        2,      // tiles from corpse vulture can grab loot from
  WRAITH_RESPAWN_THRESHOLD:        3,      // times killed before vengeful_wraith fires

  // --- Knowledge polish (Phase 8b) ---
  REPLAY_PATH_SAMPLE_MS:           500,    // ms between path samples per adventurer
  REPLAY_PATH_MAX_SAMPLES:         60,     // cap on stored samples per run
  REPLAY_GHOST_FADE_MS:            8000,   // ghost trail fade duration after return spawn
  // [Removed 2026-04-30] MIRROR_MAZE_KNOWLEDGE_ACCURACY (room retired).
  VANDAL_DISARM_DAMAGE:            0,      // vandals take 0 damage when disarming
  RETURNING_GEAR_BONUS_HP:         8,      // bonus HP from "between-run shopping"
  RETURNING_GEAR_BONUS_ATK:        2,
  ETERNAL_NIGHT_VISION_ROOMS:      1,      // vision range when Eternal Night mechanic active

  // --- Knowledge ---
  // Fraction of knowledge degraded by Memory Fog mechanic
  MEMORY_FOG_FORGET_FRACTION: 0.5,

  // --- Reputation ---
  REPUTATION_PER_KILL: 1,
  REPUTATION_PER_DAY_SURVIVED: 5,

  // --- Dungeon mechanics (Phase 9) ---
  MECHANIC_OFFER_COUNT:                   3,      // cards shown at end-of-day
  MECHANIC_HUNGER_TICK_INTERVAL_MS:       30000,  // 30s of game time per HP drain tick
  MECHANIC_HUNGER_DAMAGE_PER_TICK:        1,
  MECHANIC_TAXATION_HP_FRACTION:          0.05,   // 5% maxHP loss per new room
  MECHANIC_TAXATION_ESSENCE_PENALTY:      0.7,    // soul essence multiplier (less per kill)
  // [Removed 2026-04-30] MECHANIC_CURSED_FOUNTAIN_DAMAGE_PER_SEC (healing_fountain retired).
  MECHANIC_BLOODBOUND_DAMAGE_MULT:        1.5,
  MECHANIC_KNOWLEDGE_PAIN_BONUS:          0.10,   // +10% damage in already-cleared rooms
  MECHANIC_MIMICRY_CHEST_RATE:            0.2,    // 20% of chests become mimics
  MECHANIC_GRAV_PROJECTILE_MULT:          0.5,    // ranged speed/dmg modifier
  MECHANIC_GRAV_MELEE_DAMAGE_MULT:        1.2,
  MECHANIC_LOOT_CURSE_DEBUFF_PER_DAY:     1,      // hidden -1 attack per day held
  MECHANIC_MEMORY_FOG_FORGET_FRACTION:    0.5,

  // --- New Phase 9 dark pacts ---
  MECHANIC_GOLD_RUSH_GOLD_MULT:           2.0,    // 2× gold per kill
  MECHANIC_UNDYING_HORDE_REVIVE_CHANCE:   0.40,   // 40% chance dead minion rises as undead
  MECHANIC_UNDYING_HORDE_HP_FRACTION:     0.50,   // undead revive at this fraction of maxHp
  MECHANIC_SEALED_PATHS_BLOCK_CHANCE:     0.50,   // chance to reroute a fleeing adventurer
  MECHANIC_SEALED_PATHS_CORNERED_MULT:    1.25,   // cornered fleeing adventurer damage mult
  MECHANIC_PACK_SYNERGY_BONUS:            0.15,   // +15% damage per ally in room
  MECHANIC_PACK_SYNERGY_MAX_BONUS:        0.60,   // cap at +60%
  MECHANIC_BLOOD_MONEY_HP_PER_FIVE_KILLS: 0.02,   // +2% adventurer maxHp per 5 lifetime kills
}

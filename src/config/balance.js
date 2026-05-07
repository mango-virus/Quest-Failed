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
  STARTING_GRID_WIDTH: 80,
  STARTING_GRID_HEIGHT: 54,
  GRID_EXPANSION_PER_UNLOCK: 10,
  MAX_GRID_SIZE: 100,

  // --- Starting currencies (new run) ---
  STARTING_GOLD: 30,

  // DEV: when true, spending gold (placing rooms / minions / traps) is a
  // no-op so the player can freely test all content. Toggle back to `false`
  // to restore normal economy.
  DEV_INFINITE_GOLD: false,

  // --- Earn rates per adventurer kill ---
  GOLD_PER_KILL: 10,

  // --- Camera ---
  CAMERA_ZOOM_MIN: 0.25,
  CAMERA_ZOOM_MAX: 2.0,
  CAMERA_ZOOM_DEFAULT: 1.0,
  CAMERA_SCROLL_SPEED: 8,

  // --- Boss progression ---
  BOSS_XP_BASE:      50,   // XP needed to reach lv 2
  BOSS_XP_SCALE:    1.5,   // XP curve: xpForLv(n) = BASE * SCALE^(n-1)
  BOSS_XP_PER_KILL:  10,   // boss XP awarded per adventurer kill

  // --- Boss ---
  BOSS_DEFEATS_TO_GAME_OVER: 3,

  // --- Phase 1b.2: Earth Golem ---
  GOLEM_HP_PER_ROOM:          5,   // +5 max HP per placed room (Living Architecture)
  GOLEM_DEF_PER_ROOM:         1,   // +1 defense per placed room
  GOLEM_EARTHQUAKE_DMG_PER_ROOM: 2, // adv damage = (rooms placed × 2)
  GOLEM_EARTHQUAKE_USES_PER_DAY: 1,

  // --- Phase 1b.3: Beholder Tyrant ---
  BEHOLDER_PETRIFY_INTERVAL_MS:    6000,  // gaze fires every 6 s during boss fight
  BEHOLDER_PETRIFY_DURATION_MS:    2000,  // each fire freezes for 2 s
  BEHOLDER_ANTIMAGIC_BASE_ROOMS:   2,     // 2 random rooms/day at boss lvl 1
  BEHOLDER_ANTIMAGIC_PER_BOSS_LV:  1,     // +1 marked room per boss level above 1

  // --- Phase 1b.4: Elder Lich ---
  LICH_PHYLACTERY_UNLOCK_LEVEL:    3,    // boss level required for the heart to appear in items
  LICH_PHYLACTERY_HUNT_CHANCE:     0.15, // per-adv roll on dungeon entry
  LICH_PHYLACTERY_DMG_INTERVAL_MS: 800,  // adv damage tick rate while attacking the heart

  // --- Phase 1b.5: Lich Necromancy ---
  // Skeleton lifespan: spawn at dawn N+1 (after the kill on day N), expire
  // at the end of day N+1 — i.e. one full day of life. Tracked via
  // m._expireAtDay = dayNumber+1 and culled in respawnAll/dawn.
  NECROMANCY_LIFESPAN_DAYS:       1,
  // Cleric retention: raised cleric heals adjacent minions per tick.
  NECROMANCY_CLERIC_HEAL_AMOUNT:  4,
  NECROMANCY_CLERIC_HEAL_INTERVAL_MS: 2200,
  // Bard retention: raised bards aura nearby dungeon minions for +15% ATK
  // while in range. Buff is re-stamped every tick the minion is within
  // NECROMANCY_BARD_AURA_RANGE_TILES (Manhattan dist) and decays naturally
  // when they leave the radius.
  NECROMANCY_BARD_AURA_RANGE_TILES: 4,
  NECROMANCY_BARD_AURA_ATK_PCT:    0.15,

  // --- Phase 1b.6: Serpent Captain ---
  // Venom Stack: each minion attack adds a stack; per-stack DoT ticks every
  // 1 s for -1 HP per stack. Persists until adv dies / leaves dungeon.
  // (Reused by Myconid Corpse Bloom — corpse touch adds 2 stacks per corpse.)
  LIZARDMAN_VENOM_TICK_INTERVAL_MS: 1000,
  LIZARDMAN_VENOM_DMG_PER_STACK:    1,

  // --- Phase 1b.7: Predator Myconid ---
  MYCONID_SPORE_INTERVAL_DAYS:        3,    // every Nth day, corridor rooms gas advs all day
  MYCONID_SPORE_DMG_PER_BOSS_LV:      0.5,  // per-tick HP damage = bossLevel × this
  MYCONID_SPORE_TICK_INTERVAL_MS:     1000, // adv damage tick rate inside spore clouds
  MYCONID_CORPSE_LIFESPAN_DAYS:       3,    // fungal corpse lingers 3 days then sprouts
  MYCONID_CORPSE_VENOM_STACKS_ADDED:  2,    // stacks added per corpse on first touch
  MYCONID_CORPSE_MAX_ACTIVE:          3,    // hard cap on simultaneous fungal corpses (Myconid was over-tuned otherwise)

  // --- Phase 1b.9: Demon Lord ---
  DEMON_SACRIFICE_USES_PER_DAY:    1,    // Faustian sacrifice — once per day, burn a minion → kill a random adv
  DEMON_HELLGATE_BASE_STAT_FRAC:   0.10, // imps spawn at 10% of imp1 base stats at lvl 1
  DEMON_HELLGATE_STAT_PER_LV:      0.10, // +10% per boss level (no cap)

  // --- Phase 1b.10: Vampire Sovereign ---
  VAMPIRE_THRALL_ROAM_SWAP_MS:    6000,  // thrall reassigns to a random non-boss room every N ms
  VAMPIRE_BLOOD_TAX_VFX_MIN_DMG:    1,   // minimum damage to fire the red-streak VFX (saves performance)

  // --- Phase 1b.11: Gnoll Alpha ---
  GNOLL_HUNTERS_PACK_MAX:           5,    // max free gnolls in boss room (lvl 5+ caps here)
  GNOLL_BLOODLUST_PCT_PER_KILL:    0.03,  // +3% ATK per kill, no cap, resets at dawn

  // --- Phase 1b.12 (post-spec): Orc Veteran second ability — Warband ---
  // Orcs in the same room buff every other orc in that room. Stacks per ally.
  ORC_WARBAND_ATK_PCT_PER_ALLY:    0.05,  // +5% ATK per other orc in same room
  ORC_WARBAND_DEF_PCT_PER_ALLY:    0.05,  // +5% DEF per other orc in same room

  // --- Phase 1b.8: Dark Wraith ---
  WRAITH_FEAR_MAX:                       100,
  WRAITH_FEAR_PER_CORPSE_SEEN:             5,
  WRAITH_FEAR_PER_TRAP_TRIGGERED:         10,
  WRAITH_FEAR_PER_MINION_SIGHTED:          5,
  WRAITH_FEAR_PER_ALLY_DIED_NEAR:         15,
  WRAITH_FEAR_FLEE_THRESHOLD:             50,
  WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD:    75,
  WRAITH_FEAR_PANIC_DEATH_THRESHOLD:      100,
  WRAITH_FEAR_FRIENDLY_FIRE_WINDOW_MS:  10000,
  WRAITH_HAUNT_DETECT_RANGE_TILES:         8, // detection sight range from spawn-room center
  WRAITH_HAUNT_PHASE_SPEED_TILES_PER_SEC:  1.6, // wall-phase travel speed
  WRAITH_HAUNT_MAX_ACTIVE:                 5,   // hard cap on simultaneous Haunt ghosts (Wraith was over-tuned otherwise)

  // --- Minions ---
  MINION_RESPAWN_COST_GOLD: 5,

  // --- Day phase time controls ---
  TIME_SCALE_PAUSED: 0,
  TIME_SCALE_NORMAL: 1,
  TIME_SCALE_FAST: 2,
  TIME_SCALE_FASTEST: 4,
  TIME_SCALE_ULTRA: 8,

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
  LOW_HP_THRESHOLD:          0.4,     // adventurer triggers low-hp behavior (HEAL / FLEE) below this fraction
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

  // --- Knowledge system (Phase 8) ---
  KNOWLEDGE_STALE_FACTOR:          0.5,    // stale trap cost = KNOWLEDGE_TRAP_COST_MULTIPLIER * this
  KNOWLEDGE_TRAP_COST_MULTIPLIER:  6.0,    // path cost multiplier for tiles with known triggered/known traps
  // 4-tier knowledge: FULL = recent confirmed, PARTIAL = confirmed but aging,
  // RUMOR = dungeon mutated since intel was gathered. Each multiplier scales
  // KNOWLEDGE_TRAP_COST_MULTIPLIER so adventurers weigh known traps by tier.
  KNOWLEDGE_TIER_FULL_MULT:        1.0,
  KNOWLEDGE_TIER_PARTIAL_MULT:     0.6,
  KNOWLEDGE_TIER_RUMOR_MULT:       0.25,
  // Max age in days before a confirmed (non-stale) entry drops from FULL to
  // PARTIAL. Anything observed today or yesterday counts as FULL.
  KNOWLEDGE_FULL_MAX_AGE_DAYS:     1,
  // Per-entry chance a fresh first-time adventurer inherits a piece of
  // shared-pool intel at spawn. Parties WITH a returning veteran get the
  // full pool (the veteran briefs them). Solo / no-veteran parties roll
  // each entry at this rate, so different advs in the same wave end up
  // with different mental maps.
  KNOWLEDGE_FRESH_INHERIT_CHANCE:  0.5,
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

  // --- Scaling by boss level + day (Phase 7b) ---
  // Adventurers scale only by boss level; minions scale by both (faster HP/ATK
  // growth so they keep pace as runs go deep).
  ADVENTURER_HP_PER_BOSS_LV:   0.10,   // +10% maxHp per boss level above 1
  ADVENTURER_ATK_PER_BOSS_LV:  0.07,   // +7%  attack per boss level above 1
  ADVENTURER_HP_PER_DAY:        0.04,   // +4%  maxHp per day above 1
  ADVENTURER_ATK_PER_DAY:       0.02,   // +2%  attack per day above 1
  MINION_HP_PER_BOSS_LV:        0.20,   // +20% maxHp per boss level (bigger boss-level boost)
  MINION_ATK_PER_BOSS_LV:       0.12,   // +12% attack per boss level
  MINION_HP_PER_DAY:             0.06,   // +6%  maxHp per day (small day boost)
  MINION_ATK_PER_DAY:            0.04,   // +4%  attack per day
  // Minion gold-cost scales with boss level so prices keep pace with stats.
  // Slightly under the avg (HP+ATK)/2 stat-rate so minions feel a touch
  // more affordable at higher levels — small reward for progression.
  MINION_COST_PER_BOSS_LV:      0.20,   // +20% gold cost per boss level above 1
  UNDERDOG_XP_MULT:            2.0,    // adventurer XP multiplier for underdog tag

  // --- Mini-boss / vendetta / vulture / wraith ---
  MINIBOSS_HP_MULT:                3.0,
  MINIBOSS_ATTACK_MULT:            1.6,
  MINIBOSS_GUARANTEED_DROP:        true,
  WRAITH_RESPAWN_THRESHOLD:        3,      // times killed before vengeful_wraith fires

  // --- Knowledge polish (Phase 8b) ---
  REPLAY_PATH_SAMPLE_MS:           500,    // ms between path samples per adventurer
  REPLAY_PATH_MAX_SAMPLES:         60,     // cap on stored samples per run
  REPLAY_GHOST_FADE_MS:            8000,   // ghost trail fade duration after return spawn
  // [Removed 2026-04-30] MIRROR_MAZE_KNOWLEDGE_ACCURACY (room retired).
  VANDAL_DISARM_DAMAGE:            0,      // vandals take 0 damage when disarming
  RETURNING_GEAR_BONUS_HP:         8,      // bonus HP from "between-run shopping"
  RETURNING_GEAR_BONUS_ATK:        2,

  // --- Dungeon mechanics (Phase 9) ---
  MECHANIC_OFFER_COUNT:                   3,      // cards shown at end-of-day
  MECHANIC_TAXATION_HP_FRACTION:          0.05,   // 5% maxHP loss per new room
  MECHANIC_TAXATION_GOLD_PENALTY:         0.7,    // gold multiplier (less per kill)
  MECHANIC_BLOODBOUND_DAMAGE_MULT:        1.5,

  // --- New Phase 9 dark pacts ---
  MECHANIC_GOLD_RUSH_GOLD_MULT:           2.0,    // 2× gold per kill
  MECHANIC_UNDYING_HORDE_REVIVE_CHANCE:   0.40,   // 40% chance dead minion rises as undead
  MECHANIC_UNDYING_HORDE_HP_FRACTION:     0.50,   // undead revive at this fraction of maxHp
  MECHANIC_SEALED_PATHS_BLOCK_CHANCE:     0.50,   // chance to reroute a fleeing adventurer
  MECHANIC_SEALED_PATHS_CORNERED_MULT:    1.25,   // cornered fleeing adventurer damage mult
  MECHANIC_PACK_SYNERGY_BONUS:            0.15,   // +15% damage per ally in room
  MECHANIC_PACK_SYNERGY_MAX_BONUS:        0.60,   // cap at +60%
  MECHANIC_BLOOD_MONEY_HP_PER_FIVE_KILLS: 0.02,   // +2% adventurer maxHp per 5 lifetime kills
  MECHANIC_HASTY_ARCHITECT_TRAP_DISCOUNT: 0.5,    // trap placement cost multiplier (50% off)
  MECHANIC_HASTY_ARCHITECT_JAM_CHANCE:    0.25,   // chance a trap fails to fire when triggered
  MECHANIC_GREAT_ERASURE_STAT_MULT:       2.0,    // adventurer hp/attack/speed multiplier
  MECHANIC_GLORY_HOUNDS_HP_THRESHOLD:     0.30,   // hpFrac at/below which the buff applies
  MECHANIC_GLORY_HOUNDS_DAMAGE_MULT:      1.5,    // adv damage multiplier in low-hp state
  MECHANIC_FAMINE_FULL_HP_MULT:           1.5,    // adv damage at >=100% hp
  MECHANIC_FAMINE_LOW_HP_MULT:            0.5,    // adv damage below FAMINE_LOW_HP_THRESHOLD
  MECHANIC_FAMINE_LOW_HP_THRESHOLD:       0.5,    // hpFrac threshold for the debuff
  MECHANIC_SWORN_RIVALS_HP_THRESHOLD:     0.5,    // both rivals must be <= this hpFrac to attack each other
  MECHANIC_SWORN_RIVALS_FULL_HP_BONUS:    0.25,   // +25% damage when at full hp

  // --- Batch A: economy + adv-behavior ---
  MECHANIC_GILDED_DEMISE_GOLD_MULT:       1.5,    // +50% gold per kill
  MECHANIC_GILDED_DEMISE_GOLD_PER_ADV:    50,     // every 50g earned today = +1 adv tomorrow
  MECHANIC_PYRAMID_FIRST_KILL_MULT:       5.0,    // first kill of day
  MECHANIC_PYRAMID_REST_KILL_MULT:        0.5,    // every kill after the first
  MECHANIC_RANSOM_GOLD_PER_ESCAPE:        5,      // gold paid per escape
  MECHANIC_RANSOM_SPEED_MULT:             1.25,   // +25% adv speed
  MECHANIC_TAX_LIVING_GOLD_PER_ENTRY:     3,      // gold per adv entering
  MECHANIC_TAX_LIVING_HP_MULT:            1.20,   // +20% adv HP
  MECHANIC_TOWER_TAX_FOLLOWUP_MULT:       1.30,   // +30% damage on subsequent ranged hits
  MECHANIC_CRUSADERS_HP_MULT:             1.50,   // +50% adv HP for healer classes

  // --- Batch B: minion + combat ---
  MECHANIC_KENNEL_SPEED_MULT:             1.50,   // +50% minion speed
  MECHANIC_IRONHIDE_MELEE_DAMAGE_MULT:    0.50,   // melee dmg vs minions
  MECHANIC_IRONHIDE_RANGED_DAMAGE_MULT:   2.00,   // ranged dmg vs minions
  MECHANIC_FRENZY_DAMAGE_PER_STACK:       0.25,   // per-room +25% atk per ally death
  MECHANIC_FRENZY_DEFENSE_PER_STACK:      0.25,   // per-room -25% def per ally death
  MECHANIC_LAST_STAND_DAMAGE_MULT:        2.00,   // last-alive minion in room
  MECHANIC_LAST_STAND_RESPAWN_HP_FRAC:    0.50,   // they respawn at 50% next day
  MECHANIC_MAGE_HUNT_RANGED_MULT:         1.50,   // minion dmg vs ranged adv
  MECHANIC_MAGE_HUNT_MELEE_MULT:          0.75,   // minion dmg vs melee adv
  MECHANIC_VAMPIRE_KILL_HEAL_FRAC:        0.05,   // boss heal per kill
  MECHANIC_VAMPIRE_ESCAPE_DAMAGE_FRAC:    0.05,   // boss damage per escape

  // --- Batch C: boss-personal ---
  MECHANIC_TYRANT_ATK_PER_HIT:            1,      // minion atk gained per boss-hit landed
  MECHANIC_TYRANT_HP_LOSS_PER_TAKEN:      1,      // minion hp loss per boss-hit taken
  MECHANIC_SOUL_TETHER_HEAL_FRAC:         0.10,   // boss heal frac when minion dies in boss room
  MECHANIC_SOUL_TETHER_DAMAGE_FRAC:       0.05,   // boss damage frac when minion dies far from boss
  MECHANIC_AVENGER_BUFF_DURATION_MS:      10000,  // boss +25% dmg for 10s on minion death
  MECHANIC_AVENGER_BUFF_MULT:             1.25,
  MECHANIC_AVENGER_DAZE_DURATION_MS:      5000,   // boss dazed 5s when adv enters boss room
  MECHANIC_FINAL_BREATH_REVIVE_HP_FRAC:   0.50,   // boss revives at 50% maxHp

  // --- Batch D: knowledge ---
  MECHANIC_FALSE_MAPS_RAGE_DURATION_MS:   30000,
  MECHANIC_FALSE_MAPS_RAGE_MULT:          1.5,
  MECHANIC_WHISPERED_LIES_FAKE_RATIO:     0.5,    // 50% extra fake trap markers
  MECHANIC_OPEN_BOOK_TRAP_DAMAGE_MULT:    2.0,
  MECHANIC_OPEN_BOOK_MINION_TAKEN_MULT:   0.5,

  // --- Batch E: timed/scheduled ---
  MECHANIC_DOOMSDAY_GOLD_BONUS:           500,    // gold gained on activate
  MECHANIC_DOOMSDAY_DAYS_UNTIL_RAID:      7,
  MECHANIC_DOOMSDAY_RAID_SIZE:            4,
  MECHANIC_DOOMSDAY_RAID_STAT_MULT:       2.0,    // 2× hp + atk + speed
  MECHANIC_LONG_GAME_INTERVAL_DAYS:       3,
  MECHANIC_INQUISITORS_GOLD_MULT:         5,
  MECHANIC_INQUISITORS_HP_MULT:           2.0,
  MECHANIC_INQUISITORS_ATK_MULT:          1.5,

  // --- Batch F: summon adds + max-slot pacts ---
  MECHANIC_SUMMON_ADDS_I_COUNT:           2,      // 2 random T1 minions
  MECHANIC_SUMMON_ADDS_II_COUNT:          2,      // 2 random T2 minions
  MECHANIC_SUMMON_ADDS_III_COUNT:         1,      // 1 random T3 minion
  MECHANIC_SUMMON_ADDS_I_BOSS_HP_LOSS_FRAC: 0.05, // boss loses 5% maxHp per killed add
  MECHANIC_SUMMON_ADDS_II_BOSS_DMG_MULT:    1.25, // adv +25% damage in boss room
  MECHANIC_SUMMON_ADDS_III_EXTRA_ADVS:      1,    // permanent +1 adv per day
  MECHANIC_DRILL_SERGEANT_SLOTS:          5,
  MECHANIC_DRILL_SERGEANT_GOLD_MULT:       1.5,
  MECHANIC_ENDLESS_GARRISON_PER_BARRACKS:   10,
  MECHANIC_ENDLESS_GARRISON_DAMAGE_MULT:    0.85,
  MECHANIC_CULL_SLOTS:                    10,
  MECHANIC_TRAP_MASON_SLOTS:              5,
  MECHANIC_TRAP_MASON_GOLD_MULT:          1.5,
  MECHANIC_TRAPSMITH_PER_FACTORY:         10,
  MECHANIC_TRAPSMITH_DAMAGE_MULT:         0.75,
  MECHANIC_FORBIDDEN_WORKSHOP_SLOTS:       10,
  MECHANIC_FORBIDDEN_WORKSHOP_DISABLE_FRAC: 0.25,
  MECHANIC_ARCHITECTS_VISION_MIN_SLOTS:    3,
  MECHANIC_ARCHITECTS_VISION_TRAP_SLOTS:   3,
  MECHANIC_ARCHITECTS_VISION_EXTRA_ADVS:   1,

  // --- Batch G: boss-attack pacts ---
  MECHANIC_HELLFIRE_COOLDOWN_MS:          8000,
  MECHANIC_HELLFIRE_WINDUP_MS:            3000,
  MECHANIC_HELLFIRE_DMG_MULT:             0.8,
  MECHANIC_HELLFIRE_TARGETS:              3,
  MECHANIC_LIGHTNING_COOLDOWN_MS:         6000,
  MECHANIC_LIGHTNING_DMG_MULT:            1.5,
  MECHANIC_LIGHTNING_BOSS_HP_COST_FRAC:   0.03,
  MECHANIC_SHOCKWAVE_COOLDOWN_MS:        10000,
  MECHANIC_SHOCKWAVE_DMG_MULT:            0.6,
  MECHANIC_SHOCKWAVE_STUN_MS:             2000,
  MECHANIC_SPECTRAL_REACH_COOLDOWN_MS:    5000,
  MECHANIC_SPECTRAL_REACH_DMG_MULT:       0.9,
  MECHANIC_SPECTRAL_REACH_SPEED_PENALTY:  0.75,   // boss attack interval ×1.33 (1/0.75)
  MECHANIC_DARK_VORTEX_COOLDOWN_MS:      12000,
  MECHANIC_DARK_VORTEX_PULL_TILES:        2,
  MECHANIC_SOUL_DRAIN_COOLDOWN_MS:       12000,
  MECHANIC_SOUL_DRAIN_CHANNEL_MS:         3000,
  MECHANIC_SOUL_DRAIN_DMG_MULT:           1.2,
  MECHANIC_DOPPELGANGERS_COOLDOWN_MS:     5000,
  MECHANIC_DOPPELGANGERS_DURATION_MS:     4000,
  MECHANIC_DOPPELGANGERS_BOSS_DMG_MULT:   0.5,
  MECHANIC_PETRIFY_COOLDOWN_MS:          15000,
  MECHANIC_PETRIFY_DURATION_MS:           5000,
  MECHANIC_PETRIFY_BACKFIRE_CHANCE:       0.25,
  MECHANIC_PETRIFY_BACKFIRE_STUN_MS:      3000,

  // --- Batch H: unique-mechanic pacts ---
  MECHANIC_CURSED_SOIL_DPS:               1,
  MECHANIC_CURSED_SOIL_GOLD_MULT:         1.5,
  MECHANIC_SUNDERED_FLOOR_TELEGRAPH_MS:   5000,
  MECHANIC_SUNDERED_FLOOR_DAMAGE_FRAC:    0.25,
  MECHANIC_SUNDERED_FLOOR_STUN_MS:        1500,
  MECHANIC_SUNDERED_FLOOR_BACKFIRE_CHANCE:0.05,   // 5% opens under one of your minions
  MECHANIC_JESTER_TRAP_DISCOUNT:          0.25,   // -75% cost
  MECHANIC_JESTER_TRAP_DAMAGE_MULT:       1.5,
  MECHANIC_BRAND_BLESSED_DAMAGE_MULT:     5.0,
  MECHANIC_REAPER_HP_DEBUFF_MULT:         0.75,
  MECHANIC_REAPER_DMG_DEBUFF_MULT:        0.75,
  MECHANIC_WHISPERER_PARTY_DAMAGE_MULT:   1.5,
  MECHANIC_CARTOGRAPHER_SPEED_MULT:       1.25,

  // --- Pact of the Marionette ---
  MECHANIC_MARIONETTE_MOVE_INTERVAL_MS:   180,    // min ms between possessed-minion tile steps

  // --- Mimic Vault (chest-disguised mimics) ---
  MIMIC_OPEN_CHANCE_UNKNOWN: 0.40,   // % per room-entry an unaware adv tries to open it
  MIMIC_OPEN_CHANCE_KNOWN:   0.05,   // % when the adv already knows the mimic is hostile
  MIMIC_REVEAL_BITE_FRAC:    0.30,   // % of opener's maxHp on the reveal bite

  // --- Rarity-driven offering weights (Phase 9) ---
  // Each Dark Pact card draw first picks a rarity TIER using these weights,
  // then picks a random pact within that tier. The numbers below are the
  // exact aggregate per-card draw rates (they sum to 100) regardless of how
  // many pacts exist at each tier. If a tier has no available pacts left
  // its weight collapses to 0 for that draw, so commons "show up the most
  // when available" without crowding out rarer tiers.
  MECHANIC_RARITY_WEIGHT_COMMON:    33,
  MECHANIC_RARITY_WEIGHT_UNCOMMON:  28,
  MECHANIC_RARITY_WEIGHT_RARE:      20,
  MECHANIC_RARITY_WEIGHT_EPIC:      12,
  MECHANIC_RARITY_WEIGHT_LEGENDARY:  7,

  // --- AI failsafes ---
  // If an adventurer has not changed tile for this long (in ms) and is
  // not in a freeze-by-design state (petrified, AT_BOSS, spawn/leave
  // fade, dead, fighting), kill them. Prevents day-end hangs from genuine
  // pins (collision bug, unreachable goal, etc.). The soft stuck detector
  // at 1500 ms triggers a path replan first; the hard kill only fires if
  // that didn't free them.
  STUCK_FAILSAFE_MS:               10000,

  // --- VFX feature flags ---
  // Master toggle for the per-hit damage-type spark animation. Flip to
  // false to fully disable the HitSparkSystem (hit-spark sprites stop
  // spawning; nothing else changes).
  VFX_HIT_SPARKS_ENABLED:           true,
  // Hit sparks render at this scale (sprite is 64×64 native, the dungeon
  // uses 32×32 tiles, so 0.5 makes the spark fill exactly one tile).
  VFX_HIT_SPARK_SCALE:              0.6,
  // Frame rate for the 14-frame hit-spark animation. ~28 fps = ~500 ms.
  VFX_HIT_SPARK_FPS:                28,
}

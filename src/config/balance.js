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
  GOLD_PER_KILL: 5,   // 2026-06-02: halved 10→5 (kill income was too rich)

  // --- Camera ---
  CAMERA_ZOOM_MIN: 0.25,
  CAMERA_ZOOM_MAX: 2.0,
  CAMERA_ZOOM_DEFAULT: 1.0,
  CAMERA_SCROLL_SPEED: 8,

  // --- Boss progression ---
  BOSS_XP_BASE:      50,   // XP needed to reach lv 2
  BOSS_XP_SCALE:    1.4,   // XP curve: xpForLv(n) = BASE * SCALE^(n-1)
                           // Tuned 2026-05-27 from 1.5 → 1.4 so the
                           // 20-step progression (achievements ladder
                           // tops out at lv 20) is actually reachable
                           // by a committed player. Old 1.5 put lv 20
                           // around day 178 (effectively unreachable);
                           // 1.4 lands it near day 105 at 100% kills,
                           // ~day 130 at realistic kill rates. Early
                           // levels (1–10) feel near-identical; the
                           // change compresses the late-game tail.
  BOSS_XP_PER_KILL:  7,    // boss XP awarded per adventurer kill. 2026-06-02:
                           // 10→7 (uniform ~30% slower leveling — players were
                           // leveling too fast past lv2). Lowering the RATE (not
                           // the 1.4 curve scale) keeps the curve shape, so lv20
                           // stays reachable, just ~30% later.
  // Boss fight-stat growth per level. Applied additively on every
  // BOSS_LEVELED_UP so it stacks cleanly with ability/event modifiers.
  // Halved from the previous 30/2/1 curve — the old pace doubled raw
  // power over ten levels and made late-game boss fights run too hot.
  // From the 200/12/10 base, level 10 now lands at ~335 HP / 21 ATK /
  // 19 DEF (HP +68%, ATK +75% over ten levels, DEF unchanged).
  BOSS_HP_PER_LEVEL:  15,
  BOSS_ATK_PER_LEVEL:  1,
  BOSS_DEF_PER_LEVEL:  1,

  // --- Boss level-based multiplicative scaling (added 2026-05-27) ---
  // The boss's late-game power growth is tied to BOSS LEVEL, not day
  // count. Killing adventurers feeds boss XP → boss levels → boss
  // scales up. Player engagement (high kill rate) drives boss strength;
  // a passive run keeps the boss weaker.
  //
  // Math: stat = (baseFightStat + BOSS_*_PER_LEVEL × lvOver)
  //               × BOSS_*_PER_LEVEL_MUL ^ lvOver
  //   where lvOver = boss.level - 1.
  //
  // Tuning targets (after 2026-05-27 second dial-down):
  //   Lv 1 : 200 HP /  12 ATK /  10 DEF  (DEF reduction 17%)
  //   Lv 5 : 539 HP /  25 ATK /  22 DEF  (DEF reduction 30%)
  //   Lv 8 : 1,141 HP /  37 ATK /  32 DEF (DEF reduction 39%)
  //   Lv 10: 1,776 HP /  49 ATK /  43 DEF (DEF reduction 46%)
  //   Lv 12: 2,712 HP /  66 ATK /  60 DEF (DEF reduction 55%)
  //   Lv 15: 5,623 HP / 110 ATK /  92 DEF (DEF reduction 65%)
  //
  // Lineage: 1.40/1.23/1.23 (initial) → 1.30/1.18/1.18 (first
  // dial-down) → 1.20/1.10/1.10 (current, after playtest showed
  // even the dialed-down curve was still too heavy mid/late game).
  // Boss is now beatable in well under the 60s wall-clock cap at
  // all levels by a coordinated late-day party, while still scaling
  // up enough to be threatening (lv 15 boss takes ~50 rounds for a
  // day-50 party to chew through).
  // Tune up if late-game feels trivial; tune down further if early
  // levels still feel sluggish.
  BOSS_HP_PER_LEVEL_MUL:     1.20,   // was 1.30
  BOSS_ATK_PER_LEVEL_MUL:    1.10,   // was 1.18
  BOSS_DEF_PER_LEVEL_MUL:    1.10,   // was 1.18

  // Boss Ascension (KR P6) — compounding surge per act in the Kingdom's
  // Reckoning campaign. Tier = act-1, so Act II ×1.28 HP, Act III ×1.64,
  // Act IV ×2.10 (atk: ×1.20 / ×1.44 / ×1.73). Acts-off games never apply it.
  BOSS_ASCENSION_HP_MUL:     1.28,
  BOSS_ASCENSION_ATK_MUL:    1.20,
  // Dark-ascension chamber aura — escalating sear on adventurers near the
  // ascended boss. Per-second damage = (base + lv×perLv) × tier, every tick.
  BOSS_ASCENSION_AURA_RADIUS_PX: 132,   // ~4 tiles around the boss
  BOSS_ASCENSION_AURA_INTERVAL:  1200,  // ms between sear pulses
  BOSS_ASCENSION_AURA_BASE:      5,
  BOSS_ASCENSION_AURA_PER_LEVEL: 1.5,

  // Plunderers (KR P5 response) — thieves rob your treasury. Drains are a
  // PERCENTAGE of current gold (so the rich are robbed proportionally) with a
  // flat floor. Pickpocket = per-thief per-pulse while alive; escape = the big
  // heist when a thief absconds. Tunable.
  PLUNDER_PICKPOCKET_PCT:      0.004,   // 0.4% of treasury, per thief, per pulse
  PLUNDER_PICKPOCKET_MIN:      2,
  PLUNDER_PICKPOCKET_INTERVAL: 2000,    // ms between pickpocket pulses
  PLUNDER_ESCAPE_PCT:          0.03,    // 3% of treasury when a thief escapes
  PLUNDER_ESCAPE_MIN:          20,

  // Reckoning NG+ (KR P7) — every invader (adventurers, Champions, Aldric) hits
  // this much harder PER NG+ tier the run is played at. NG+1 ×1.18, NG+2 ×1.39…
  NG_PLUS_ENEMY_SCALE:         1.18,

  // Percentage-based defense for damage TO the boss.
  // Old formula: dmgToBoss = max(1, atkPool − boss.defense)
  // New formula: dmgToBoss = max(1, atkPool × (1 − boss.defense / (boss.defense + K)))
  //
  // At K=50: def=10 → 17% reduction, def=50 → 50%, def=200 → 80%,
  // def=500 → 91%. Asymptotes to 1.0 — boss is NEVER invulnerable
  // but high day-scaled defense always meaningfully cuts damage.
  // Old flat-subtraction formula became useless past day 20 because
  // adv ATK scaled into the hundreds while boss DEF stayed under 30.
  BOSS_DEF_PERCENT_K:        50,

  // --- Boss ---
  BOSS_DEFEATS_TO_GAME_OVER: 3,

  // --- Phase 1b.2: Earth Golem ---
  GOLEM_HP_PER_ROOM:          5,   // +5 max HP per placed room (Living Architecture)
  GOLEM_DEF_PER_ROOM:         1,   // +1 defense per placed room
  GOLEM_EARTHQUAKE_DMG_PER_ROOM: 2, // adv damage = (rooms placed × 2)
  GOLEM_EARTHQUAKE_USES_PER_DAY: 1,

  // --- Phase 1b.3: Beholder Tyrant ---
  BEHOLDER_PETRIFY_INTERVAL_MS:    6000,  // gaze fires every 6 s during boss fight
  BEHOLDER_PETRIFY_DURATION_MS:    2000,  // each fire freezes for 2 s (lv-1 baseline)
  BEHOLDER_PETRIFY_DURATION_PER_BOSS_LV_MS: 300,  // +300ms freeze per boss-lv beyond 1
  // Original behaviour: petrify ALL advs in the boss room. Cap set
  // high enough to be effectively unlimited at any realistic boss-room
  // headcount — duration scaling is the actual late-game buff, not a
  // target-count nerf. Lowering this hard-caps the crowd control.
  BEHOLDER_PETRIFY_TARGETS_BASE:            99,
  BEHOLDER_PETRIFY_LEVELS_PER_TARGET:        3,   // (kept for tunability; +1 target per 3 boss-lv on top of base)
  BEHOLDER_ANTIMAGIC_BASE_ROOMS:   2,     // 2 random rooms/day at boss lvl 1
  BEHOLDER_ANTIMAGIC_PER_BOSS_LV:  1,     // +1 marked room per boss level above 1

  // --- Beholder EYE TYRANT (2026-06-14 overhaul) — barrage of rays ---
  // Throne-fight Eye Barrage (per-ray dmg = bossAtkScaled × frac; hex multiplies it)
  BEHOLDER_BEAM_TARGETS_BASE:      99,    // beams hit all in-room (kept high like petrify)
  BEHOLDER_DRAIN_DMG_FRAC:         0.55,  // Drain ray dmg
  BEHOLDER_DRAIN_HEAL_FRAC:        0.7,   // heals boss this × drain dmg
  BEHOLDER_HEX_MULT:               1.35,  // Hex: hexed targets take ×this from rays
  BEHOLDER_HEX_MS:                 5000,
  BEHOLDER_DISINTEGRATE_DMG_FRAC:  1.8,   // T4 death-ray (single target, telegraphed)
  // Day active — TYRANT'S GAZE (arm → room → fire)
  BEHOLDER_GAZE_USES_PER_DAY:      1,
  BEHOLDER_GAZE_USES_PER_BOSS_LV:  0.25,  // +1 use per 4 boss levels
  BEHOLDER_GAZE_SILENCE_MS:        6000,  // T1 silence window on room occupants
  BEHOLDER_GAZE_SLOW_MS:           5000,  // T2 slow window
  BEHOLDER_GAZE_SLOW_MULT:         0.5,   // movement ×this while slowed
  BEHOLDER_GAZE_PETRIFY_MS:        2200,  // T3 petrify window
  BEHOLDER_GAZE_DMG_FRAC:          0.6,   // T4 disintegrate damage to room occupants

  // --- Phase 1b.4: Elder Lich ---
  LICH_PHYLACTERY_UNLOCK_LEVEL:    1,    // available from day 1; toast fires once on first save load
  LICH_PHYLACTERY_HUNT_CHANCE:     0.15, // per-adv roll on dungeon entry
  LICH_PHYLACTERY_ROOM_FIND_CHANCE: 0.20, // per-adv one-shot roll on first entry into the phyl's room
  LICH_PHYLACTERY_DMG_INTERVAL_MS: 800,  // adv damage tick rate while attacking the heart

  // --- Elder Lich THE WITHERING (2026-06-14 overhaul) — Soul Essence economy ---
  LICH_SOUL_PER_KILL:            2,     // base essence banked per dungeon death
  LICH_SOUL_PER_ADV_LEVEL:       0.5,   // + this × adv level (floored)
  LICH_SOUL_REGEN_PCT_PER_SEC:   0.30,  // boss heals this %maxHp/sec (day only) while holding essence
  LICH_SOUL_REGEN_MIN_ESSENCE:   1,     // need at least this much banked to regen
  // Day ability — CHANNEL SOULS (arm → click room → fire; spends essence)
  LICH_CHANNEL_COST:             12,    // essence spent per cast
  LICH_CHANNEL_DMG_FRAC:         0.60,  // base per-target dmg = bossAtkScaled × this
  LICH_CHANNEL_ESSENCE_SCALE:    0.02,  // +this dmg-frac per essence in reserve (capped)
  LICH_CHANNEL_ESSENCE_SCALE_CAP: 1.20, // cap on the essence damage bonus
  LICH_CHANNEL_SIPHON_HEAL_FRAC: 0.50,  // T2: heal boss this × total dmg dealt
  LICH_CHANNEL_SIPHON_ESSENCE:   1,     // T2: bank this much bonus essence per victim hit
  LICH_WITHER_DURATION_MS:       6000,  // T3: wither (no-heal) window
  LICH_WITHER_DOT_FRAC:          0.10,  // T3: soul-rot dmg/tick = bossAtkScaled × this
  LICH_WITHER_DOT_INTERVAL_MS:   1000,  // soul-rot tick cadence
  LICH_CAGE_DURATION_MS:         3000,  // T4: soul-cage freeze duration (day)
  LICH_CAGE_DRAIN_FRAC:          0.18,  // T4: cage drain dmg/tick = bossAtkScaled × this (heals boss)
  // Throne-fight death magic (per-target dmg = bossAtkScaled × frac; lifesteal heals boss)
  LICH_FIGHT_COIL_DMG_FRAC:      0.85,  // Death Coil
  LICH_FIGHT_COIL_HEAL_FRAC:     0.60,  // heals boss for this × coil dmg
  LICH_FIGHT_SIPHON_DMG_FRAC:    0.35,  // Soul Siphon per-tick per-target
  LICH_FIGHT_SIPHON_HEAL_FRAC:   0.80,  // heals boss for this × siphon dmg
  LICH_FIGHT_NOVA_DMG_FRAC:      0.55,  // Soul Nova AoE (all targets)
  LICH_FIGHT_NOVA_HEAL_FRAC:     0.40,
  LICH_FIGHT_CAGE_DMG_FRAC:      0.50,  // Soul Cage ult per-tick
  LICH_FIGHT_CAGE_HEAL_FRAC:     1.0,
  // Soul AURA (the in-world tell): saturation = essence ÷ capacity. Capacity
  // GROWS with act + boss level so the aura stays a meaningful 0–100% read all
  // run (late-game floods just push it into the dramatic "Oversouled" overflow).
  LICH_AURA_CAP_BASE:            60,
  LICH_AURA_CAP_PER_ACT:         55,
  LICH_AURA_CAP_PER_LEVEL:       7,

  // --- Slime King MITOSIS / THE UNKILLABLE HORDE (2026-06-14 overhaul) ---
  SLIME_MASS_PER_ABSORB:         2,     // +Mass per minion absorbed
  SLIME_MASS_PER_BUD:           1,      // +Mass per time-bud
  SLIME_BUD_INTERVAL_MS:        9000,   // day-phase budding cadence (free goopling + Mass)
  SLIME_BUD_MAX_ACTIVE:         4,      // cap on free gooplings alive at once (per act bonus below)
  SLIME_BUD_MAX_PER_ACT:        3,      // + this × act to the goopling cap
  SLIME_MASS_CAP_BASE:          40,     // aura/size saturation capacity (grows w/ act+level)
  SLIME_MASS_CAP_PER_ACT:       40,
  SLIME_MASS_CAP_PER_LEVEL:     6,
  SLIME_MASS_SIZE_BONUS:        0.45,   // day-boss body scale: ×(1 + saturation × this)
  SLIME_COALESCE_MS:            5000,   // T2: gooplings idle-touching this long merge
  SLIME_TRAIL_DMG_FRAC:         0.20,   // T3: acid-trail dmg/tick = bossAtk × this
  SLIME_TRAIL_INTERVAL_MS:      900,
  SLIME_TRAIL_LIFESPAN_MS:      2600,   // a trail tile stays corrosive this long
  // Day active — MITOSIS SURGE (arm → room → flood gooplings)
  SLIME_SURGE_USES_PER_DAY:     1,
  SLIME_SURGE_USES_PER_BOSS_LV: 0.25,   // +1 use per 4 boss levels
  SLIME_SURGE_BASE_COUNT:       3,      // gooplings spawned; + crowd + Mass scaling
  SLIME_SURGE_PER_VICTIM:       1,      // + this per adventurer in the room
  SLIME_SURGE_PER_MASS:         0.08,   // + this × Mass
  SLIME_SURGE_MAX:              12,     // hard cap on a single surge
  // Throne fight
  SLIME_FIGHT_GENCAP_BASE:      2,      // split generation cap (T1); + per tier below
  SLIME_FIGHT_GENCAP_PER_TIER:  0.5,    // floor → T1 2, T2 2, T3 3, T4 4 (act-1)*0.5+2
  SLIME_FIGHT_RECOMBINE_MS:     2600,   // T2: undamaged small blobs this close+long merge
  SLIME_FIGHT_RECOMBINE_DIST:   34,     // px proximity to merge
  SLIME_FIGHT_ACID_DMG_FRAC:    0.30,   // T3: split-puddle dmg/round = bossAtk × this
  SLIME_FIGHT_ACID_RADIUS:      40,     // px
  SLIME_FIGHT_ACID_MS:          3000,
  SLIME_FIGHT_TIDE_CHANCE:      0.5,    // T4: chance a slain blob respawns near a big one

  // --- Phase 1b.5: Lich Necromancy ---
  // Skeleton lifespan: spawn at dawn N+1 (after the kill on day N), expire
  // at the end of day N+1 — i.e. one full day of life. Tracked via
  // m._expireAtDay = dayNumber+1 and culled in respawnAll/dawn.
  NECROMANCY_LIFESPAN_DAYS:       1,
  // Hard cap on how many raised skeletons the Lich can have alive at
  // once. Dawn raises are clamped to (cap − currently-alive raised) so
  // a big kill day can't flood the dungeon with undead.
  NECROMANCY_MAX_RAISED:          5,
  NECROMANCY_MAX_RAISED_PER_BOSS_LV: 0.5,  // +0.5 cap per boss-lv (floor) → cap = base + floor(bossLv/2)
  // Cleric retention: raised cleric heals adjacent minions per tick.
  NECROMANCY_CLERIC_HEAL_AMOUNT:  4,
  NECROMANCY_CLERIC_HEAL_PER_BOSS_LV: 1,  // +1 heal-per-tick per boss-lv beyond 1
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
  LIZARDMAN_VENOM_DMG_PER_BOSS_LV:  0.5,  // +0.5 dmg/stack per boss-lv (floor)

  // --- Phase 1b.7: Predator Myconid ---
  MYCONID_SPORE_INTERVAL_DAYS:        3,    // every Nth day, corridor rooms gas advs all day
  MYCONID_SPORE_DMG_PER_BOSS_LV:      0.5,  // [superseded by MYCONID_SPORE_DMG_PCT_PER_TICK — kept for save-compat / lookups]
  MYCONID_SPORE_DMG_PCT_PER_TICK:     0.015,// 1.5% adv maxHP per tick (auto-scales with adv HP curve)
  MYCONID_SPORE_TICK_INTERVAL_MS:     1000, // adv damage tick rate inside spore clouds
  MYCONID_CORPSE_LIFESPAN_DAYS:       3,    // fungal corpse lingers 3 days then sprouts
  MYCONID_CORPSE_VENOM_STACKS_ADDED:  2,    // stacks added per corpse on first touch
  MYCONID_CORPSE_MAX_ACTIVE:          3,    // hard cap on simultaneous fungal corpses (Myconid was over-tuned otherwise)

  // --- Phase 1b.9: Demon Lord ---
  DEMON_SACRIFICE_USES_PER_DAY:    1,    // Faustian sacrifice — once per day, burn a minion → kill a random adv
  DEMON_SACRIFICE_USES_PER_BOSS_LV: 0.333, // +0.333 uses per boss-lv → floor adds ~1 every 3 lv
  DEMON_HELLGATE_BASE_STAT_FRAC:   0.10, // imps spawn at 10% of imp1 base stats at lvl 1
  DEMON_HELLGATE_STAT_PER_LV:      0.10, // +10% per boss level (no cap)

  // --- Phase 1b.10: Vampire Sovereign ---
  VAMPIRE_THRALL_ROAM_SWAP_MS:    6000,  // thrall reassigns to a random non-boss room every N ms
  VAMPIRE_BLOOD_TAX_VFX_MIN_DMG:    1,   // minimum damage to fire the red-streak VFX (saves performance)
  VAMPIRE_CHARM_USES_PER_DAY_BASE: 1,
  VAMPIRE_CHARM_USES_PER_BOSS_LV:  0.25, // +0.25 uses per boss-lv (1 extra every 4 lv)

  // --- Phase 1b.11: Gnoll Alpha ---
  GNOLL_HUNTERS_PACK_MAX:           5,    // max free gnolls in boss room (lvl 5+ caps here) — base
  GNOLL_HUNTERS_PACK_MAX_PER_BOSS_LV: 0.5, // +0.5 pack-max per boss-lv (floor)
  GNOLL_BLOODLUST_PCT_PER_KILL:    0.03,  // +3% ATK per kill, no cap, resets at dawn

  // --- Phase 1b.12 (post-spec): Orc Veteran second ability — Warband ---
  // Orcs in the same room buff every other orc in that room. Stacks per ally.
  ORC_WARBAND_ATK_PCT_PER_ALLY:    0.05,  // +5% ATK per other orc in same room
  ORC_WARBAND_DEF_PCT_PER_ALLY:    0.05,  // +5% DEF per other orc in same room

  // --- Orc Veteran TROPHY HUNTER (2026-06-14 overhaul) ---
  // Throne-fight attacks: per trophy STACK beyond the first, each attack's
  // damage scales up (T2+). Base damage is a fraction of scaled boss ATK.
  ORC_TROPHY_DMG_PER_STACK:        0.06,  // +6% attack damage per stack over 1
  ORC_TROPHY_DMG_STACK_CAP:        8,     // stacks counted toward the bonus
  ORC_TROPHY_CLEAVE_DMG_FRAC:      0.75,  // Cleave: frontal arc damage
  ORC_TROPHY_SHIELDBASH_DMG_FRAC:  0.65,  // Shield Bash: single-target charge
  ORC_TROPHY_HEXBOLT_DMG_FRAC:     0.80,  // Hexbolt: ranged orb (primary)
  ORC_TROPHY_VOLLEY_DMG_FRAC:      0.40,  // Volley: per-projectile, hits many
  ORC_TROPHY_SMITE_DMG_FRAC:       0.90,  // Reaver's Smite: heavy single hit
  ORC_TROPHY_SMITE_LIFESTEAL:      0.60,  // heals boss for 60% of smite damage
  // Mastery aura (T3+): the most-claimed trophy type grants a dungeon-wide
  // passive. Magnitudes scale gently with that type's stack count.
  ORC_MASTERY_ATK_PCT_PER_STACK:   0.04,  // Blade  → minions +ATK
  ORC_MASTERY_DEF_PCT_PER_STACK:   0.05,  // Heavy  → minions +DEF
  ORC_MASTERY_TRAP_RECHARGE_MULT:  0.75,  // Arcane → trap cooldownMs ×0.75
  ORC_MASTERY_RANGE_BONUS:         1,     // Hunter → ranged minions +1 reach
  ORC_MASTERY_REGEN_HP_PER_SEC:    0.4,   // Faith  → boss heals %maxHp/sec ×stack
  ORC_MASTERY_PCT_CAP:             0.60,  // cap on the ATK/DEF aura bonus

  // --- Succubus Queen second ability — Doppelgänger (boss-fight only) ---
  // The Queen hides among illusory duplicates during the boss fight. Each
  // combat round the party's pooled damage may land on a decoy (round
  // negated, decoy shatters) instead of the real Queen. She re-conjures a
  // fresh set of decoys each time her HP crosses a phase threshold.
  SUCCUBUS_DOPPEL_ENABLED:           true,
  SUCCUBUS_DOPPEL_BASE_DECOYS:          2,   // decoys conjured at boss level 1
  SUCCUBUS_DOPPEL_LEVELS_PER_DECOY:     3,   // +1 decoy per N boss levels
  SUCCUBUS_DOPPEL_MAX_DECOYS:           4,   // hard cap on decoys per split
  SUCCUBUS_DOPPEL_SPLIT_THRESHOLDS: [0.75, 0.5, 0.25],  // boss-HP fracs that re-split

  // Bat-Form Seduction charm cadence — delay between one charm flight
  // ending and the next being eligible, in ms (+ a random 0..RAND on top).
  // Bumped 2026-05-22 so she charms noticeably less often (was 7000/8000).
  SUCCUBUS_CHARM_COOLDOWN_BASE_MS:  20000,
  SUCCUBUS_CHARM_COOLDOWN_RAND_MS:  16000,
  SUCCUBUS_CHARM_COOLDOWN_REDUCTION_PER_LV_MS: 1000,  // -1s base + rand cooldown per boss-lv beyond 1

  // --- Phase 1b.8: Dark Wraith ---
  WRAITH_FEAR_MAX:                       100,
  WRAITH_FEAR_PER_CORPSE_SEEN:             5,
  WRAITH_FEAR_PER_TRAP_TRIGGERED:         10,
  WRAITH_FEAR_PER_MINION_SIGHTED:          5,
  WRAITH_FEAR_PER_ALLY_DIED_NEAR:         15,
  WRAITH_FEAR_FLEE_THRESHOLD:             50,
  WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD:    75,
  WRAITH_FEAR_PANIC_DEATH_THRESHOLD:      100,
  WRAITH_FEAR_THRESHOLD_REDUCTION_PER_LV:  2, // -2 from each threshold per boss-lv beyond 1
  WRAITH_FEAR_FRIENDLY_FIRE_WINDOW_MS:  10000,
  WRAITH_HAUNT_DETECT_RANGE_TILES:         8, // detection sight range from spawn-room center
  WRAITH_HAUNT_PHASE_SPEED_TILES_PER_SEC:  1.6, // wall-phase travel speed
  WRAITH_HAUNT_MAX_ACTIVE:                 5,   // hard cap on simultaneous Haunt ghosts (Wraith was over-tuned otherwise)
  WRAITH_HAUNT_MAX_PER_BOSS_LV:           0.5,  // +0.5 max per boss-lv (floor) → cap = base + floor(bossLv/2)

  // --- Minions ---
  MINION_RESPAWN_COST_GOLD: 5,

  // --- Day phase time controls ---
  TIME_SCALE_PAUSED: 0,
  TIME_SCALE_NORMAL: 1,
  TIME_SCALE_FAST: 2,
  TIME_SCALE_FASTEST: 4,
  TIME_SCALE_ULTRA: 8,
  // Endgame speed — only available from day HYPER_UNLOCK_DAY onwards. When
  // unlocked the speed bar swaps 2× out for 16× (see BottomBar.js); the
  // 50ms STEP_BUDGET_MS frame-breaker in Game.update keeps it safe under
  // heavy late-game waves even if the CPU can't deliver true 16×.
  TIME_SCALE_HYPER: 16,
  HYPER_UNLOCK_DAY: 30,

  // --- Adventurers ---
  ADVENTURERS_PER_DAY_BASE: 1,        // adds +1 every 2 days
  ADVENTURER_BASE_TILES_PER_SEC: 1.5, // multiplied by class.speed

  // --- Bounty hunters ---
  // Two separate spawn paths share the kill-payout multiplier but otherwise
  // have their own knobs:
  //   PACK    — the "Bounty Hunters" dungeon event (replaces the whole wave
  //             with a 5-pack via _spawnBountyHunterWave).
  //   TRACKER — the per-day solo hunter that joins the normal wave when one
  //             of the player's minions has a bounty (3+ kills) AND has
  //             EVOLVED. Suppressed during any active dungeon event so it
  //             doesn't dilute event theming. Bumped above the pack mults
  //             so the rarer appearance is a meaningful threat to whatever
  //             evolved minion drew them in.
  BOUNTY_HUNTER_SPAWN_CHANCE:  0.5,  // (pack event — unused, reserved)
  BOUNTY_HUNTER_HP_MULT:       1.6,  // event-pack hunters
  BOUNTY_HUNTER_ATK_MULT:      1.4,  // event-pack hunters
  BOUNTY_TRACKER_SPAWN_CHANCE: 0.25, // per-day, gated on evolved-wanted minion
  BOUNTY_TRACKER_HP_MULT:      2.2,  // per-day tracker — stronger than pack
  BOUNTY_TRACKER_ATK_MULT:     1.7,  // per-day tracker — stronger than pack
  BOUNTY_HUNTER_GOLD_MULT:     3,    // shared: kill payout for both paths

  // --- Combat (Phase 6 kernel) ---
  ATTACK_INTERVAL_MS:        900,     // base time between attacks (scales by 1/speed)
  MELEE_RANGE_TILES:         1.5,     // adventurer or minion in melee range
  AGGRO_RANGE_TILES:         5,       // minion engages within this many tiles in same room
  ENGAGE_REQUIRES_SAME_ROOM: true,    // Phase 6 kernel: minions don't chase outside home room
  MINIONS_PER_ROOM_CAP:      5,       // max player-placed roster minions in one room (system-spawned garrison ignored)

  // --- Adventurer flee ---
  FLEE_BUFFER:               0.05,    // hysteresis on fleeThreshold so adventurers don't oscillate

  // --- Class abilities (Phase 6c) ---
  // Note: mana system removed in Phase 5b cooldown rework. Abilities are now
  // gated by per-instance cooldowns (see AbilitySystem) and per-day budgets.
  CLERIC_HEAL_AMOUNT:        12,
  CLERIC_HEAL_TARGET_THRESHOLD: 0.8,  // heal an ally below this HP fraction
  HEAL_RANGE_TILES:          2,       // cleric heal-ally range
  // Templar "Lay on Hands" — a reactive self-heal that fires the first time a
  // Templar is chipped below the threshold, once per delve (layOnHandsUsedToday).
  TEMPLAR_LAY_ON_HANDS_THRESHOLD: 0.35, // HP fraction below which it triggers
  TEMPLAR_LAY_ON_HANDS_FRAC:      0.5,  // heals this fraction of max HP
  // Pirate "Grog Rage" — swigs grog when chipped below the threshold (once per
  // delve, grogRagedToday) and goes berserk: attack + speed surge, won't flee.
  PIRATE_GROG_THRESHOLD: 0.40,  // HP fraction below which the rage triggers
  PIRATE_GROG_ATK_MULT:  1.5,   // attack multiplier while raging
  PIRATE_GROG_SPD_MULT:  1.3,   // speed (move + swing) multiplier while raging
  // Pirate "Plunder" — steals this multiple of the normal chest-gold haul.
  PIRATE_PLUNDER_MULT:   1.5,
  LOW_HP_THRESHOLD:          0.4,     // adventurer triggers low-hp behavior (HEAL / FLEE) below this fraction
  // Healing Fountain blessing (2026-05-27 rework). Touching a fountain
  // grants a heal-over-time that PERSISTS INTO THE BOSS FIGHT — the
  // fountain's whole purpose is to make the boss fight harder, not just
  // top advs off beforehand. Regenerates FOUNTAIN_BLESS_REGEN_PCT of the
  // adv's max HP per second for FOUNTAIN_BLESS_DURATION_MS. Re-touching a
  // fountain refreshes it; FOUNTAIN_REHEAL_COOLDOWN_MS gates the instant
  // top-up so standing on the fountain doesn't re-fire every frame.
  // The once-per-day cap is removed — advs heal whenever they're low.
  FOUNTAIN_BLESS_REGEN_PCT:    0.04,   // 4% max HP / sec while blessed
  FOUNTAIN_BLESS_DURATION_MS:  15000,  // 15s of regen per fountain touch
  FOUNTAIN_REHEAL_COOLDOWN_MS: 6000,   // min gap between instant full-heals
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

  // --- Minion XP / leveling (Phase 7) — RETIRED 2026-05-29 ---
  // The kill-XP / per-minion-level system was removed; minion power now comes
  // from boss-level scaling + gold-paid tier upgrades. No system reads these
  // anymore (kept so old saves/configs don't choke on a missing key). Safe to
  // delete once nothing references them.
  MINION_XP_PER_KILL:            10,    // retired
  MINION_XP_LEVEL_BASE:          25,    // retired
  MINION_XP_LEVEL_SCALE:         1.5,   // retired
  MINION_LEVEL_HP_BONUS:         5,     // retired
  MINION_LEVEL_ATTACK_BONUS:     1,     // retired
  MINION_LEVEL_DEFENSE_BONUS:    1,     // retired

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
  KNOWLEDGE_RETURN_PARTY_SIZE_MIN: 2,      // floor for veteran-led waves (only matters when natural baseCount < 2, i.e. very early days)
  // KNOWLEDGE_RETURN_PARTY_SIZE_MAX retired 2026-05-27 — was clamping wave
  // size to 4 on every veteran-return day, silently shrinking late-game
  // waves from ~70 to 4 (see DayPhase.js "returningRecord" comment).
  KNOWLEDGE_RETURN_MAX_AGE_DAYS:   3,      // a survivor is only eligible to personally return if they fled within this many days
  KNOWLEDGE_VETERAN_HP_MULT:       1.2,    // returning veterans are tougher than a fresh adventurer
  KNOWLEDGE_VETERAN_ATK_MULT:      1.15,   // ...and hit a little harder
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
  // Post-day-9 compounding scaler — applies EVERY DAY past day 9, so the
  // curve smoothly accelerates from day 10 onward instead of stepping at
  // decade boundaries. postTen = max(0, day - 9); HP and ATK each
  // multiplied by their per-tier base ^ postTen. Layered on top of the
  // linear ADVENTURER_*_PER_DAY scaling above.
  //
  // Math: at 1.08 HP / 1.05 ATK per day past 9 →
  //   day 10 (postTen 1):  ×1.08 HP, ×1.05 ATK
  //   day 15 (postTen 6):  ×1.59 HP, ×1.34 ATK
  //   day 20 (postTen 11): ×2.33 HP, ×1.71 ATK
  //   day 30 (postTen 21): ×5.03 HP, ×2.79 ATK
  //   day 50 (postTen 41): ×23.46 HP, ×7.39 ATK
  //
  // Same mirror applied in adventurerDisplayLevel so the cosmetic LV
  // chip tracks the actual stat escalation.
  ADVENTURER_POST10_HP_PER_DAY:  1.08,
  ADVENTURER_POST10_ATK_PER_DAY: 1.05,
  // Wave-size escalation past day 9 — every day adds an extra
  // adventurer on top of the standard `1 + floor((day-1)/2)` curve.
  // Applies to all 5 wave-count sites (DayPhase spawn + normalWaveSize,
  // NightPhase rollNextWavePreview, RightPanels forecast, RoomBehavior
  // Library preview). Treasury / Gold Rush / event modifiers stack on
  // top of this bonus, same as before.
  ADVENTURER_POST10_EXTRA_PER_DAY: 1,
  MINION_HP_PER_BOSS_LV:        0.20,   // +20% maxHp per boss level (sole power axis now)
  MINION_ATK_PER_BOSS_LV:       0.12,   // +12% attack per boss level
  // Day scaling removed 2026-05-29 — minions now scale with BOSS LEVEL only
  // (plus gold-paid tier upgrades). Adventurers still scale with day, so a boss
  // that lags the calendar gets outpaced — intended pressure to keep leveling.
  MINION_HP_PER_DAY:             0,
  MINION_ATK_PER_DAY:            0,
  // Gold-gated tier upgrade cost (2026-05-29): paying to upgrade a minion to a
  // chain tier costs the chain ROOT's build cost × this[targetTierIdx] ×
  // buildScaleMul (escalates per tier, pricier than buying fresh; scales with
  // the run). Index = chain position being REACHED (0/1 = root, buildable).
  MINION_UPGRADE_TIER_MULT:     [0, 2.5, 5, 8],
  // Trap damage scales with boss level so traps keep pace with the
  // toughening adventurer waves — mirrors minion attack scaling.
  // Halved from 0.12 → 0.06 on 2026-05-24 (lv10 lands at ~1.54× base
  // instead of 2.08×; traps still stack with pact/Engineer/Brand mults
  // so the effective curve at high level is plenty without doubling
  // the base too).
  TRAP_DAMAGE_PER_BOSS_LV:       0.06,   // +6% trap damage per boss level above 1
  // Bomb-only blast falloff. Damage at the centre tile = full scaled
  // damage; damage at the edge of the splash radius = floor (30%).
  // Linear gradient between. Rewards baiting advs onto the bomb tile
  // itself, while a brush past the ring still hurts.
  BOMB_FALLOFF_FLOOR:            0.30,
  // Per-hit trap damage cap as a fraction of the victim's maxHp. A
  // single trap hit on an adventurer can deal at most this share, so
  // a Mage (25 HP) caps at ~18 even from a centre-tile Bomb — they
  // walk away near-death instead of instantly dying. Wounded advs
  // can still be finished by a follow-up hit. Spike Pit's
  // instakillChance bypasses this cap (the only legit one-shot).
  // Minions and the boss are unaffected — full raw damage applies.
  //
  // Three-zone curve (2026-05-27): trap damage on adventurers is clamped
  // between a per-trap FLOOR and this CAP, both as a fraction of the
  // victim's max HP. Cap (lowered 0.75 → 0.30) tames the near-lethal
  // early game; the floor keeps traps meaningful late (flat scaling
  // falls to ~1% of max HP by day 50 otherwise). Between the two, the
  // flat boss-level-scaled damage applies, preserving per-trap identity.
  TRAP_MAX_ADV_DMG_FRAC:         0.30,
  // Late-game floor: each trap deals AT LEAST (baseDamage × this) of the
  // victim's max HP. Spike pit base 40 → 5%; bomb 50 → 6.25%; cannon/saw
  // 30 → 3.75%; dragon 35 → 4.4%; arrow 6 → 0.75%. Auto-scales with
  // adventurer HP so traps never become cosmetic, while preserving the
  // relative danger of each trap.
  // Halved 2026-05-28 (0.0025 → 0.00125): the original floor made late-game
  // traps too lethal against high-HP adventurers; this keeps them a
  // meaningful toll without being a real killer.
  TRAP_MIN_ADV_DMG_PER_BASE:     0.00125,
  // Minion gold-cost scales with boss level so prices keep pace with stats.
  // Slightly under the avg (HP+ATK)/2 stat-rate so minions feel a touch
  // more affordable at higher levels — small reward for progression.
  // (Legacy names; the live scaling now flows through buildScaleMul in
  // util/merchantPricing.js, which reads BUILD_COST_PER_BOSS_LV below.)
  MINION_COST_PER_BOSS_LV:      0.20,   // +20% gold cost per boss level above 1
  TRAP_COST_PER_BOSS_LV:        0.20,   // +20% trap gold cost per boss level (mirrors minions)
  // --- Unified build-cost scaling (minions / traps / rooms / items) ---
  // The single source of truth for how EVERY buildable's gold price climbs
  // over a run, applied via buildScaleMul (util/merchantPricing.js) at both
  // the build-menu display and the placement-charge sites.
  //   costMul = 1 + BUILD_COST_PER_BOSS_LV·(bossLv−1)
  //               + BUILD_COST_PER_DAY·max(0, day−9)
  // WHY a DAY term (added 2026-05-28): income scales hard with the calendar
  // (wave size balloons ~1.5×/day, flat 10g/kill → 1,260g/day by day 90)
  // while the old boss-level-only cost curve plateaus (~lv10-15). Result was
  // a late-game gold flood where nothing cost a meaningful share of income.
  // The day term ramps only post-day-9 (mirrors the wave-size escalation),
  // so early game — where gold is correctly tight — is untouched. Tuned as a
  // "hard sink": late costs outpace income so gold stays genuinely scarce.
  BUILD_COST_PER_BOSS_LV:       0.20,   // +20% per boss level above 1 (all buildables)
  BUILD_COST_PER_DAY:           0.12,   // +12% per day past day 9 (all buildables)
  // Pay-to-revive (2026-05-28): fallen roster minions no longer auto-revive
  // free at dawn. A night-phase REVIVE button brings them back for this
  // fraction of each minion's CURRENT (day-scaled) build cost — cheaper than
  // re-buying, and it keeps their dungeon position. Unrevived fallen are lost
  // at day start. See util/minionRevive.js + MinionAISystem.reviveFallen.
  BUILD_REVIVE_COST_FRAC:       0.5,    // revive = 50% of current build cost, per minion
  // Evolved / named minion forms (beholder2, demon_lord, elder_slime…) carry
  // no build cost — they evolve up from a buildable root rather than being
  // bought — so a naive "50% of build cost" makes reviving them FREE. Instead
  // their revive value derives from the chain ROOT's build cost × this
  // per-tier multiplier, indexed by position in the evolution chain
  // (0 = root/T1, 1 = T2, 2 = T3/apex, 3 = T4 slime cap). Resolved in
  // util/minionRevive.js against src/data/minionEvolutions.json chains.
  REVIVE_EVOLVED_TIER_MULT:    [1, 2.2, 4, 6],
  UNDERDOG_XP_MULT:            2.0,    // adventurer XP multiplier for underdog tag

  // --- Dungeon event: Miasma (% maxHp chip damage) ---
  // Pre-2026-05-27 this was a flat 2 dmg per 2s tick. Late-game advs
  // sit around 2,500-5,500 HP, so the flat value was ~1-3% of an adv's
  // HP over their entire 60-90s run — completely cosmetic. Now ticks
  // scale with each target's maxHp so the chip-damage feel survives
  // the late-game HP curve. 0.4%/tick × ~30 ticks per adv lifespan
  // ≈ 12% maxHP lost per adv from miasma alone.
  // Same pattern as MYCONID_SPORE_DMG_PCT_PER_TICK (1.5%).
  MIASMA_TICK_PCT_PER_TICK:       0.004,

  // --- Dungeon event: Tremors (% maxHp per quake) ---
  // Pre-2026-05-27 was flat 14 / +6 per quake. Same problem — capped
  // around ~80 dmg per quake, vs 5k late-game adv HP = ~1.5%. Now
  // each quake hits for a % of the target's maxHp, escalating per
  // quake within the day, capped per-hit so a late-day quake can't
  // instakill. Code comment in _tremorTick says "Invaders can be
  // killed by the collapse" — under flat scaling that was no longer
  // true late game; under % scaling it's true again at any era.
  TREMOR_PCT_BASE:                0.03,    // first quake: 3% maxHP
  TREMOR_PCT_STEP:                0.015,   // +1.5% per subsequent quake
  TREMOR_PCT_CAP:                 0.15,    // single-hit max 15% maxHP

  // --- Dungeon event: Loot Goblin Heist (compounding-loss cap) ---
  // Each goblin that escapes steals 10% of CURRENT gold (multiplicative
  // compounding). Pack size scales with day: 5 + (day-9). At day 50
  // the pack is 46 goblins; without a cap, 10 escapees = 65% gold lost
  // and a full-pack escape = 99% gold lost (run-ending). Cap below
  // limits the total daily loss to a fixed fraction of the gold the
  // player held when the day started — see EventSystem._onAdventurerFled.
  LOOT_GOBLIN_DAILY_LOSS_CAP_PCT: 0.50,    // hard floor: never lose >50% of day-start gold

  // --- Dungeon event: Cursed Relic (chest tier scales with boss level) ---
  // Pre-2026-05-27 the cursed relic was always a tier-5 chest (80g/day).
  // Cost (wave doubling) scales hard — at day 50, +66 advs/day = ~660g
  // extra kill income, dwarfing the 80g chest. Now the chest tier
  // scales with boss level so the reward stays proportional to the era:
  //   bossLv 1  → tier 5  (80g/day)  — same as the old hardcoded value (no regression)
  //   bossLv 5  → tier 7  (145g/day)
  //   bossLv 9  → tier 9  (230g/day)
  //   bossLv 11+ → tier 10 (300g/day, capped)
  EVENT_CURSED_RELIC_TIER_BASE:        5,    // bossLv 1: tier 5 (matches the old flat value)
  EVENT_CURSED_RELIC_TIER_PER_2_LV:    1,    // +1 tier per 2 boss levels (lv 9 → tier 9, lv 11+ → cap)
  EVENT_CURSED_RELIC_TIER_MAX:        10,    // hard cap at the highest existing chest tier

  // --- Dungeon event purchase costs (Black Market + Mercenary) ---
  // Both events let the player pay gold for a guaranteed reward. Pre-
  // 2026-05-27 they were flat 50g / 120g — fine at day 1 but trivially
  // worth it by day ~15 once the player's treasury was 1k+. Now both
  // scale linearly by (day - 1) and (bossLv - 1) so the gold cost
  // tracks the player's expected wealth. Anchor points (assuming a
  // ~20k treasury at day 50 from playtest):
  //   Black Market day 50 / lv 10 ≈ 2,000g  (≈10% of treasury)
  //   Mercenary    day 50 / lv 10 ≈ 5,000g  (≈25% of treasury)
  // Per-bossLv is weighted ~3× per-day so power (boss level) drives
  // cost more than calendar time — mirrors how content gates by
  // boss level elsewhere (T2/T3 minions, dungeon mechanics, etc.).
  // Mercenary scales steeper than Black Market because its reward is
  // a much bigger combat asset (Tier 3 elite, doubled stats, 3 days).
  EVENT_BLACK_MARKET_BASE_COST:    50,
  EVENT_BLACK_MARKET_PER_DAY:      25,
  EVENT_BLACK_MARKET_PER_BOSS_LV:  80,
  EVENT_MERCENARY_BASE_COST:      120,
  EVENT_MERCENARY_PER_DAY:         60,
  EVENT_MERCENARY_PER_BOSS_LV:    220,

  // --- Zombie Horde dungeon event ---
  // Horde size scales hard with boss level — a late-game horde should
  // read as an overwhelming swarm, not a slightly bigger wave.
  ZOMBIE_HORDE_BASE:            16,    // shamblers at boss level 1
  ZOMBIE_HORDE_PER_BOSS_LV:      8,    // +8 shamblers per boss level above 1

  // --- Boss Royale dungeon event ---
  // Instead of the normal wave, one of EVERY OTHER boss archetype (11,
  // excluding the player's own) storms the dungeon for a single day, all
  // beelining the throne together. Designed as a *very hard* gauntlet.
  //
  // Each invader uses the rival_boss_invader stat line (150/13/6 base)
  // scaled by the adventurer curve (boss-level + day + post-day-9 tail),
  // THEN multiplied by the HP / ATK mults below. All 11 spawn AT ONCE
  // (no stagger — a trickle let the boss pick them off one at a time) and
  // beeline the throne together, so the threat is concentration: a wall
  // of boss-tier HP rushing the boss simultaneously.
  //
  // Tuning lineage: ×2.0 flat + 3s stagger (trivial) → dropped stagger,
  // split HP/ATK, HP ×5 / ATK ×3 (still "did very little damage"). The
  // damage problem is the boss's PERCENTAGE defense: dmg = pool × (1 −
  // def/(def+50)). A pact-stacked late-game boss can sit at high DEF and
  // mitigate 80%+ of any pool, so ATK has to be cranked HARD to land real
  // damage — it's a linear lever fighting an asymptotic wall. 2026-05-27
  // round 3: ATK ×3 → ×8. At day 50 the base invader is ~251 ATK → ×8 =
  // ~2,010 ATK each (~22k pooled across 11 on the throne); even an 80%-
  // mitigating boss then eats ~4.4k/round. HP held at ×5 (~71k each) —
  // survival wasn't the complaint, damage was. Knobs; dial freely.
  BOSS_ROYALE_HP_MULT:          5.0,
  BOSS_ROYALE_ATK_MULT:         8.0,
  BOSS_ROYALE_KILL_GOLD:        200,   // flat gold per invader killed (no other bonus)

  // --- Rival Dungeon challenge buffs (2026-05-27, re-tuned) ---
  // The base Rival Dungeon spawned a same-size wave of monster_invaders
  // (base 35 HP — *below* the adventurer average) that WANDERED room-to-
  // room like a normal wave, so the only real boss-threat was the lone
  // champion. The whole pack now BEELINES the boss (see AISystem
  // _pickNextGoal _monsterInvader branch) and is 2.5× a normal wave, so
  // it reads as a genuine overrun: a horde of tougher-than-yours monsters
  // all converging on the throne behind a tank champion. ATK cranked
  // (1.5 → 3.0, round 3) for the same percentage-defense reason as Boss
  // Royale + so they punch through your minions faster en route. The
  // champion also gets PACK_ATK_MULT now (was HP-only). All knobs.
  //   PACK_HP_MULT  2.0 → day-50 monster 3,170 → ~6,340 HP
  //   PACK_ATK_MULT 3.0 → day-50 monster 154   → ~462 ATK
  //   BOSS_HP_MULT  3.0 → day-50 rival boss 13,584 → ~40,750 HP
  //   PACK_SIZE_MULT 2.5 → ~66 → ~165 monsters (a true horde)
  RIVAL_DUNGEON_PACK_HP_MULT:   2.0,
  RIVAL_DUNGEON_PACK_ATK_MULT:  3.0,
  RIVAL_DUNGEON_BOSS_HP_MULT:   3.0,
  RIVAL_DUNGEON_PACK_SIZE_MULT: 2.5,

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

  // --- Dungeon mechanics (Phase 9) ---
  MECHANIC_OFFER_COUNT:                   3,      // cards shown at end-of-day
  MECHANIC_TAXATION_HP_FRACTION:          0.05,   // 5% of CURRENT HP loss per new room (compounds down)
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
  // Doomsday raid no longer hard-sets the wave to a fixed size; it
  // multiplies the day's normal baseCount instead so the "guaranteed
  // legendary raid" actually scales with how deep the run is. Was a
  // flat 4 (irrelevant past day ~25); now ×2 the natural wave size.
  MECHANIC_DOOMSDAY_WAVE_MULT:            2,
  MECHANIC_LONG_GAME_INTERVAL_DAYS:       3,
  MECHANIC_INQUISITORS_GOLD_MULT:         5,

  // --- Damned pacts (solid-black tier) ---
  // The Leech — drains a slice of your treasury at the start of every day,
  // forever. Bribe is a one-time gold lump paid the moment you seal it.
  MECHANIC_LEECH_GOLD_DRAIN_FRACTION:     0.08,   // lose 8% of current gold each dawn
  MECHANIC_LEECH_BRIBE_GOLD:              800,    // one-time gold paid on sealing
  // Pact of the Last Heart — caps the boss at a single life and grants a
  // free Legendary pact as the bribe (set in handler, no constant needed).
  MECHANIC_LAST_HEART_LIVES:              1,      // boss reduced to this many hearts
  // Famished Dark — kills pay half gold; bribe is a big gold lump.
  MECHANIC_FAMISHED_DARK_GOLD_MULT:       0.5,
  MECHANIC_FAMISHED_DARK_BRIBE_GOLD:      1500,
  // The Open Gate — +10 adventurers every day, forever; bribe gold lump.
  MECHANIC_OPEN_GATE_EXTRA_ADVS:          10,
  MECHANIC_OPEN_GATE_BRIBE_GOLD:          1500,
  // Hollow Crown — boss max HP halved permanently; bribe = free Legendary.
  MECHANIC_HOLLOW_CROWN_HP_MULT:          0.5,
  // The Bleeding Crown — boss loses 2% max HP per day (compounding); bribe gold.
  MECHANIC_BLEEDING_CROWN_HP_LOSS_PER_DAY: 0.02,
  MECHANIC_BLEEDING_CROWN_BRIBE_GOLD:     1200,
  // Sleepless Throne — boss starts each fight at 50% HP; bribe +10 minion slots.
  MECHANIC_SLEEPLESS_THRONE_START_HP_FRAC: 0.5,
  MECHANIC_SLEEPLESS_THRONE_SLOT_BRIBE:   10,
  // Tribute of Flesh — each escaped adventurer loots gold from your treasury.
  MECHANIC_TRIBUTE_GOLD_PER_ESCAPE:       20,
  MECHANIC_TRIBUTE_BRIBE_GOLD:            700,
  // Cursed Blood — every minion death damages the boss for 3% max HP; bribe gold.
  MECHANIC_CURSED_BLOOD_BOSS_DMG_FRAC:    0.03,
  MECHANIC_CURSED_BLOOD_BRIBE_GOLD:       1000,
  // Pact of Glass — minion max HP halved (read in applyMinionScaling).
  MECHANIC_GLASS_HP_MULT:                 0.5,
  // The Hollow Horde — minion slots halved; bribe = current minions +20% stats.
  MECHANIC_HOLLOW_HORDE_STAT_BUFF:        0.20,
  // Brittle Bones — a minion struck below 50% HP shatters; bribe +25% minion dmg.
  MECHANIC_BRITTLE_BONES_SHATTER_FRAC:    0.5,
  MECHANIC_BRITTLE_BONES_DMG_BUFF:        0.25,
  // The Wasting — surviving minions lose 5% max HP each day (compounding);
  // bribe evolves all current minions one tier.
  MECHANIC_WASTING_HP_LOSS_PER_DAY:       0.05,
  // The Hunger — 20% of your minions die permanently each dawn; bribe gold.
  MECHANIC_HUNGER_DEATH_FRAC:             0.20,
  MECHANIC_HUNGER_BRIBE_GOLD:             1000,
  // The Unteachable — minions can't gain XP / evolve; bribe gold.
  MECHANIC_UNTEACHABLE_BRIBE_GOLD:        1000,
  // The Martyr's Curse — minion death heals nearby adventurers 25% max HP; bribe gold.
  MECHANIC_MARTYR_HEAL_FRAC:              0.25,
  MECHANIC_MARTYR_RADIUS_TILES:           4,
  MECHANIC_MARTYR_BRIBE_GOLD:             800,
  // Mounting Debt — build costs rise 5%/day (compounding); bribe gold.
  MECHANIC_MOUNTING_DEBT_PER_DAY:         0.05,
  MECHANIC_MOUNTING_DEBT_BRIBE_GOLD:      1000,
  // The Sealed Vault — selling is forbidden for the rest of the run; bribe gold.
  MECHANIC_SEALED_VAULT_BRIBE_GOLD:       1500,
  // Brittle Engines — traps break after one firing; bribe traps +100% dmg.
  MECHANIC_BRITTLE_ENGINES_DMG_MULT:      2.0,
  // Trapless Halls — no new traps; bribe existing traps +50% dmg + gold.
  MECHANIC_TRAPLESS_HALLS_DMG_MULT:       1.5,
  MECHANIC_TRAPLESS_HALLS_BRIBE_GOLD:     600,
  // Famine's Grip — treasure-room payouts halved; bribe gold.
  MECHANIC_FAMINES_GRIP_PAYOUT_MULT:      0.5,
  MECHANIC_FAMINES_GRIP_BRIBE_GOLD:       800,
  // Pact of Glass bribe — minions are free to place for the sealing night.
  // (Curse multiplier MECHANIC_GLASS_HP_MULT is defined above.)
  // The Insomniac — every Nth night gives no build phase; bribe gold.
  MECHANIC_INSOMNIAC_INTERVAL_NIGHTS:     3,
  MECHANIC_INSOMNIAC_BRIBE_GOLD:          600,
  // Crumbling Halls — destroy a random room each night (never boss/entry);
  // bribe gold + trap slots.
  MECHANIC_CRUMBLING_BRIBE_GOLD:          600,
  MECHANIC_CRUMBLING_TRAP_SLOTS:          3,
  // Blind Architect — minimap + intel disabled; bribe gold (stand-in for the
  // "perfect-day preview" idea, which needs forecast wiring — see notes).
  MECHANIC_BLIND_ARCHITECT_BRIBE_GOLD:    400,

  // --- LEGENDARY pacts (2026-05-28 — massive upside / massive downside) ---
  // Colossus Heart — boss max HP doubled; attacks 50% slower (atk halved).
  MECHANIC_COLOSSUS_HP_MULT:              2.0,
  MECHANIC_COLOSSUS_ATK_MULT:             0.5,
  // The Apex Tyrant — boss +100% HP, +50% atk & def; all waves doubled (run).
  MECHANIC_APEX_HP_MULT:                  2.0,
  MECHANIC_APEX_ATK_MULT:                 1.5,
  MECHANIC_APEX_DEF_MULT:                 1.5,
  MECHANIC_APEX_WAVE_MULT:                2,
  // Avatar of Ruin — boss invincible the first 10s of each fight; max HP -50%.
  MECHANIC_AVATAR_HP_MULT:                0.5,
  MECHANIC_AVATAR_INVULN_MS:              5000,
  // Wrath Unbound — up to +100% boss attack as HP drops; boss takes +50% dmg.
  MECHANIC_WRATH_MAX_ATK_BONUS:           1.0,   // +100% at 0 HP, scales with missing HP
  MECHANIC_WRATH_DMG_TAKEN_MULT:          1.5,
  // Crown of Avarice — all gold income doubled; guaranteed hero raid every 5 days.
  MECHANIC_AVARICE_GOLD_MULT:             2.0,
  MECHANIC_AVARICE_RAID_INTERVAL_DAYS:    5,
  MECHANIC_AVARICE_RAID_WAVE_MULT:        2,
  MECHANIC_AVARICE_RAID_HERO_BUFF:        0.5,   // +50% stats to that day's adventurers
  // The Iron Price — minions + traps deal 2x damage; you can never earn gold.
  MECHANIC_IRON_PRICE_DMG_MULT:           2.0,
  // Sudden Death — everyone (yours + adventurers) deals 5x damage.
  MECHANIC_SUDDEN_DEATH_DMG_MULT:         5.0,
  // The Undying Court — dead adventurers rise as undead minions of their class.
  MECHANIC_UNDYING_COURT_COST_MULT:       2,     // reworked 2026-06-04: CURSE doubles all build costs (run-long)
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
  MECHANIC_ENDLESS_GARRISON_PER_BARRACKS:   15,
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
  MECHANIC_DARK_VORTEX_COOLDOWN_MS:      12000,
  MECHANIC_DARK_VORTEX_PULL_TILES:        2,
  MECHANIC_SOUL_DRAIN_COOLDOWN_MS:       12000,
  MECHANIC_SOUL_DRAIN_CHANNEL_MS:         3000,
  MECHANIC_SOUL_DRAIN_DMG_MULT:           1.2,
  // Soul Drain ticks once per this interval during the channel (the DMG
  // mult above is already scaled for ~3 ticks). Without an interval the
  // damage/heal applied EVERY frame — ~60× the intended power.
  MECHANIC_SOUL_DRAIN_TICK_MS:            1000,
  // Boss heals for this fraction of the damage each tick deals (the pact
  // used to heal 1:1, which made the boss near-unkillable mid-channel).
  MECHANIC_SOUL_DRAIN_HEAL_FRAC:          0.5,
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
  MECHANIC_WHISPERER_PARTY_DAMAGE_MULT:   1.5,
  MECHANIC_CARTOGRAPHER_SPEED_MULT:       1.25,


  // --- Mimic (chest-disguised stationary trap minion) ---
  // [Removed 2026-05-22] MIMIC_OPEN_CHANCE_UNKNOWN / MIMIC_OPEN_CHANCE_KNOWN
  // / MIMIC_REVEAL_BITE_FRAC. The mimic mechanic was rewritten — open
  // probability is now driven by the standard chest temptPct (per the
  // mimic's pre-rolled chestTier) and the trigger insta-kills the opener
  // instead of biting + engaging. See AISystem._tryTriggerMimic /
  // _springMimic for the new path.

  // --- Mimic Vault cursed chest (one per active Mimic Vault) ---
  // Visual tier picked randomly in [MIN, MAX]. On open: no immediate gold
  // debit. If the opener reaches the entry hall alive, the player loses
  // MIMIC_CURSE_ESCAPE_PCT% of CURRENT gold (compounds across multiple
  // cursed-chest escapes in the same day). Dying clears the curse with
  // no penalty. See AISystem._tryOpenTreasureChest + _kill cleanup +
  // _onAdvFled.
  MIMIC_CURSED_CHEST_TIER_MIN:    1,
  MIMIC_CURSED_CHEST_TIER_MAX:   10,
  MIMIC_CURSE_ESCAPE_PCT:        25,   // % of current player gold debited on escape

  // --- Treasury auto-spawn chests (one set per active Treasury) ---
  // Each Treasury auto-spawns TREASURY_CHEST_COUNT free chests at day-
  // start, random tier in [MIN, MAX]. These are flagged `_treasurySpawn:
  // true` so the sell tool refuses to refund gold on them (they were
  // free). See RoomBehaviorSystem._onDayStart.
  //
  // Tier cap is intentionally low. 2026-06-02 rebalance: cut from 4 chests @
  // tier 1–3 (~85g/day) to 3 chests @ tier 1–2 (avg ~15g/day per chest →
  // ~45g/day) — the chests were paying out too much passive gold per day. A
  // Treasury room costs 40 gold, so it still pays itself back in ~1 day, but no
  // longer obsoletes hand-placed chests. Widening the range to 1–5 was tested
  // but obsoleted hand-placed chests entirely AND opened a sell-and-rebuild
  // reroll exploit. T4–T10 stay as the only path to high-tier chests.
  TREASURY_CHEST_COUNT:           3,
  TREASURY_CHEST_TIER_MIN:        1,
  TREASURY_CHEST_TIER_MAX:        2,
  // Passive-income scaling (2026-05-28): treasure-chest payouts and the
  // Treasury stipend scale up over a run so they don't go stale once build
  // costs climb (those scale with boss level AND day). Applied via
  // passiveIncomeMul() — chest payout in AISystem, stipend in
  // RoomBehaviorSystem, and the GOLD/DAY readout in InspectPopup.
  //   passiveMul = 1 + PASSIVE_INCOME_PER_BOSS_LV·(bossLv−1)
  //                  + PASSIVE_INCOME_PER_DAY·max(0, day−9)
  // Tuned boss-level-only for now (matches minion stat scaling, plateaus with
  // dungeon power, no day snowball). PER_DAY is wired but 0 — bump it later
  // if passive income should also track the calendar.
  PASSIVE_INCOME_PER_BOSS_LV:     0.20,   // +20% chest/stipend payout per boss level above 1
  PASSIVE_INCOME_PER_DAY:         0,      // +X% per day past day 9 (0 = boss-level only)

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
  // Damned (solid-black) pacts mix into the normal purple-grimoire pool at
  // the same draw weight as Epic — "the tier just before legendary".
  MECHANIC_RARITY_WEIGHT_DAMNED:    12,
  // Chance the nightly Dark Pact grimoire opens BLACK instead of purple —
  // a black grimoire offers an all-Damned hand (every card is a curse).
  MECHANIC_BLACK_GRIMOIRE_CHANCE:   0.10,

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

  // Cheater attack VFX — wild glitch-burst layered on every cheater
  // melee hit. Two sheets registered (burst + glitch), random sheet +
  // random colour row per swing so each hit looks different. Banned
  // cheaters skip the effect (they've lost the modded client).
  VFX_CHEATER_ATTACK_ENABLED:       true,
  // Sprite scale. Cheater swings are loud — bigger than hit-spark so
  // the "wild" intent reads at a glance.
  VFX_CHEATER_ATTACK_SCALE:         1.1,
  // Frame rate for the cheater attack burst animations.
  VFX_CHEATER_ATTACK_FPS:           30,
  // Probability of layering a second sheet on top of the primary burst
  // (0..1). With 8 sheets in the pool the layer-count escalation is the
  // dominant chaos signal: 1 layer = normal swing, 2 = juicy, 3 = full
  // glitch. 0.55 ≈ "most hits get a double-stack".
  VFX_CHEATER_ATTACK_DOUBLE_CHANCE: 0.55,
  // Probability of also layering a THIRD distinct sheet — only rolls
  // when the double already triggered, so single-layer swings always
  // stay clean. 0.18 ≈ ~10% of all swings become triple-stack chaos.
  VFX_CHEATER_ATTACK_TRIPLE_CHANCE: 0.18,

  // Boss attack VFX — sheet pool for pact attacks (Hellfire / Lightning
  // / etc.) and per-archetype basic attacks. Single layer per fire,
  // alt-sheet picked on roll. Colour row chosen by damage type for
  // pacts, archetype identity for basics.
  VFX_BOSS_ATTACK_ENABLED:     true,
  VFX_BOSS_ATTACK_SCALE:       1.2,
  VFX_BOSS_ATTACK_FPS:         28,
  // Probability of picking the alt sheet instead of the primary. 0.4
  // ≈ ~60% primary / 40% alt so the ability has a recognizable
  // identity while still varying.
  VFX_BOSS_ATTACK_ALT_CHANCE:  0.4,

  // Master toggle for kinetic camera shake on impactful events
  // (crits, big hits, Golem Earthquake, Beholder Petrify, etc.).
  // Flip to false to disable all screen shake without code changes.
  VFX_SCREEN_SHAKE_ENABLED:         true,

  // --- Cheater class ---
  CHEATER_INSTAKILL_CHANCE:    0.15,   // per-attack chance during aimhack window to one-shot a minion
  CHEATER_LAG_SPIKE_CHANCE:    0.05,   // per-attack chance for a 2× damage swing that self-stuns afterward
  CHEATER_LAG_STUN_MS:         1000,   // self-stun duration (ms) on lag-spike hits — counter-window for the player
  CHEATER_REPORT_BAN_THRESHOLD:  4,     // hit count that flips the cheater to "BANNED" → forced flee

  // --- PATCH 0.0.0 event (dungeon event 'patch_zero') ---
  // Cheater-only wave with anti-cheat disabled, buffed cheats, double
  // kill gold, glitch tile spam, and a roulette of "admin console
  // commands" that fire random server-side effects. All flagged off
  // _eventFlags.patchZeroActive — set in EventSystem._applyEffect,
  // cleared in _clearEffect.
  PATCH_ZERO_INSTAKILL_CHANCE:   0.25,  // up from 0.15 baseline
  PATCH_ZERO_TELEPORT_CD_MS:     8000,  // halved from 15000
  PATCH_ZERO_SPEEDHACK_CD_MS:    6000,  // halved from 12000
  PATCH_ZERO_KILL_GOLD_MULT:     2.0,   // ban bounty — 2× normal cheater kill payout
  PATCH_ZERO_GLITCH_TILE_MS:     1200,  // cadence of random RGB tile-flash visual
  PATCH_ZERO_CONSOLE_CMD_MS:     8000,  // cadence of /command roulette
}

// ── Derived helpers ──────────────────────────────────────────────────
// Display level for a wave of adventurers, derived from how far boss
// level + day progression scales their HP & ATK above the class
// baseline. Level 1 is an unscaled day-1 wave; it climbs in lockstep
// with the stat scaling so players see incoming waves visibly getting
// stronger. PURELY COSMETIC — it changes no stats, it just mirrors the
// multipliers DayPhase._scaleAdventurerByBossLevel applies.
// SINGLE SOURCE OF TRUTH for adventurer HP/ATK stat scaling — boss-level
// + day + post-day-9 compounding + blood-money HP bonus. Used by:
//   • DayPhase._scaleAdventurerByBossLevel — the REAL stat scaling at spawn
//   • adventurerDisplayLevel (below) — the cosmetic LV chip
//   • AdvIntelOverlay wave preview — so the "(incoming)" HP/ATK match what
//     the adventurers will actually spawn with (not the class base)
// NOTE: speed is intentionally NOT scaled — only HP and ATK.

// Reckoning NG+ (KR P7) — the per-run enemy HP/ATK multiplier for an NG+ tier.
// Applied ON TOP of adventurerScaleMultipliers by BOTH the real spawn scaling
// (DayPhase) and the wave preview (AdvIntelOverlay) so they stay in lockstep.
export function ngPlusEnemyMul(ngTier = 0) {
  return Math.pow(Balance.NG_PLUS_ENEMY_SCALE ?? 1.18, Math.max(0, ngTier | 0))
}

export function adventurerScaleMultipliers(bossLv = 1, day = 1, bloodMoneyBonus = 0) {
  const lvOver  = Math.max(0, Math.floor(bossLv || 1) - 1)
  const dayOver = Math.max(0, Math.floor(day   || 1) - 1)
  // Post-day-9 compounding multiplier (smooth curve, no decade cliffs).
  const postTen   = Math.max(0, Math.floor(day || 1) - 9)
  const post10Hp  = Math.pow(Balance.ADVENTURER_POST10_HP_PER_DAY  ?? 1, postTen)
  const post10Atk = Math.pow(Balance.ADVENTURER_POST10_ATK_PER_DAY ?? 1, postTen)
  const hpMul  = (1 + Balance.ADVENTURER_HP_PER_BOSS_LV  * lvOver
                     + Balance.ADVENTURER_HP_PER_DAY       * dayOver
                     + (bloodMoneyBonus || 0)) * post10Hp
  const atkMul = (1 + Balance.ADVENTURER_ATK_PER_BOSS_LV * lvOver
                     + Balance.ADVENTURER_ATK_PER_DAY      * dayOver) * post10Atk
  return { hpMul, atkMul }
}

export function adventurerDisplayLevel(bossLv = 1, day = 1, bloodMoneyBonus = 0) {
  // Derives the cosmetic LV chip from the same multipliers the real stat
  // scaling uses, so the displayed LV climbs in lockstep with the actual
  // escalation. By day 30 the chip reads ~50+ for a level-1 boss run —
  // the player's visible warning that each wave is sharper than the last.
  const { hpMul, atkMul } = adventurerScaleMultipliers(bossLv, day, bloodMoneyBonus)
  // One level ≈ one boss-level's worth of average HP/ATK buff.
  const step = (Balance.ADVENTURER_HP_PER_BOSS_LV +
                Balance.ADVENTURER_ATK_PER_BOSS_LV) / 2 || 0.085
  const avgMul = (hpMul + atkMul) / 2
  return Math.max(1, 1 + Math.round((avgMul - 1) / step))
}

// Passive-income multiplier for treasure-chest payouts + the Treasury stipend,
// so they don't go stale once build costs climb over a run. Boss-level-only by
// default (PASSIVE_INCOME_PER_DAY = 0); the day term is wired for future use.
// Single source of truth — used by AISystem (chest payout), RoomBehaviorSystem
// (stipend) and InspectPopup (the GOLD/DAY readout) so all three agree.
export function passiveIncomeMul(bossLv = 1, day = 1) {
  const lvTerm  = (Balance.PASSIVE_INCOME_PER_BOSS_LV ?? 0.20) * Math.max(0, Math.floor(bossLv || 1) - 1)
  const dayTerm = (Balance.PASSIVE_INCOME_PER_DAY     ?? 0)    * Math.max(0, Math.floor(day   || 1) - 9)
  return 1 + lvTerm + dayTerm
}

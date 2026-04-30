# Design Coverage Manifest

Every concrete deliverable from `DESIGN.md`, mapped to the phase it lands in and its current status.

**Status legend**:
- ✅ **DONE** — fully implemented and verified
- 🟡 **PARTIAL** — data/scaffolding exists, behavior pending later phase
- ⏳ **PENDING** — not started, scheduled
- 💭 **OPEN** — open-ended ("many more X" — track count over time)

**Phase exit ritual** (what I MUST do before declaring a phase complete):
1. Read this file end-to-end.
2. For every row tagged with the current phase, verify status against the codebase.
3. If anything tagged for this phase is still PENDING or PARTIAL, fix it or explicitly defer with the user's approval before marking the phase complete.
4. Update statuses in this file whenever a row's state changes.

**Last full audit**: 2026-04-29 (Class ability rework foundation — mana system removed end-to-end; Vandal personality retired in favor of Ranger's upcoming Trap Expert; new AbilitySystem (cooldown + per-day budget) and AbilityVfx primitives landed; Ctrl+Shift+C debug toggle for testing; vulnerableToElements field seeded on every minion in minionTypes.json. All 11 classes now ⏳ PENDING ability re-implementation per the per-class spec in DESIGN.md → "Class ability rework". Existing wired abilities — heal_ally / smite_undead / raise_corpse / chat_poll / Ranger arrow / beast tame mana — are reset to PENDING since they get rebuilt on the new framework. Phase reopened as 5c.) Previous audit 2026-04-29 (earlier): Class pool expansion — Beast Master class promotion + Barbarian/Monk/Bard added.

---

## 1. Boss archetypes (target: 5 starting + ~15 total)

| ID | Name | Phase | Status | Notes |
|---|---|---|---|---|
| the_lich | The Lich | 1 | ✅ DONE | data + selectable |
| the_architect | The Architect | 1 | ✅ DONE | data + selectable |
| the_beast_lord | The Beast Lord | 1 | ✅ DONE | data + selectable |
| the_trickster | The Trickster | 1 | ✅ DONE | data + selectable |
| the_tyrant | The Tyrant | 1 | ✅ DONE | data + selectable |
| (10 more unlockable) | — | QW | ✅ DONE | All 10 unlockable archetypes implemented: warden, pyromancer, shadow, collector, swarm (10b) + archivist, hivemind, alchemist, jester, sleepless (QW). Total 15 archetypes. |
| Archetype-gated dungeon mechanics offered | — | 9 | ✅ DONE | DungeonMechanicSystem.getOfferings filters by archetypeModifiers.blockedMechanics + availableToArchetypes |
| Archetype-gated minion strengths | — | 6e | ✅ DONE — minionStatMultiplier applied at placement; minionXpMultiplier in EvolutionSystem; essenceGainMultiplier in AISystem._kill; blockedTrapTypes filters trap palette |

---

## 1b. Monster boss redesign — supersedes the 15-archetype system (target: 10 monster bosses)

> See DESIGN.md → "Monster boss redesign" for the full headline-mechanic-per-boss spec.
> Whole row group is ⏳ PENDING — user has approved the design and wants to land this in a future session as one coherent phase. Each row is "data + headline mechanic + supporting modifiers".

| ID | Boss | Headline mechanic | Phase | Status | Notes |
|---|---|---|---|---|---|
| beholder    | Beholder    | Omniscient Eye — see full adv stats; advs always have rumour-grade intel       | TBD | ⏳ PENDING | needs adv-inspector full-stats mode + auto-max-rumour pipeline |
| demon       | Demon       | Daily Contract — each dawn, accept a powerful effect at a cost (mandatory pick) | TBD | ⏳ PENDING | needs contract offering UI; reuse EndOfDay mechanic-card pattern |
| myconid     | Myconid     | Living Dungeon — every placed room +1 growth tier each day                      | TBD | ⏳ PENDING | renamed from Ent 2026-04-28 to match available portrait art; needs per-room growth tier on gameState.rooms; corridor regrow tick |
| wraith      | Wraith      | Fear Meter — advs accumulate FEAR; at thresholds panic-flee / friendly fire    | TBD | ⏳ PENDING | needs adv.fear field + new Haunt trap that scales on fear |
| gnoll       | Gnoll       | Pack of 3 + Hunger — kills feed pack & grant +20% ATK; unfed packs decay        | TBD | ⏳ PENDING | needs pack-spawn (1 placement → 3 minions); daily hunger tick |
| golem       | Golem       | Reinforce + Stone Walls — no traps, no minion variety, but fortress focus       | TBD | ⏳ PENDING | needs unblockable wall tile type; Reinforce night ability |
| lich        | Lich        | Phylactery — spare life hidden in a room; advs can hunt & destroy it            | TBD | ⏳ PENDING | needs phylactery item + hunt goal + boss-respawn logic |
| lizardman   | Lizardman   | Hidden Traps — traps invisible to adv intel until first kill                    | TBD | ⏳ PENDING | needs trap.firstKilled flag gating KnowledgeSystem rumour entry |
| orc         | Orc         | Loot the Fallen — orc minions gain +1 ATK per kill, no cap; no magic rooms      | TBD | ⏳ PENDING | needs minion.killCount→stat carryover; magic-tag room block |
| vampire     | Vampire     | Charm — daily mark; adv defects to boss room; thrall or drain                   | TBD | ⏳ PENDING | needs Charm goal type + thrall-minion spawn from charmed adv |
| Migration   | Retire / unlock-gate the existing 15 archetypes | — | TBD | ✅ DONE (2026-04-28) | replaced wholesale; old archetype IDs gone, neutral defaults retained for backward-compat in modifier readers |
| Challenge-mode removal | NO TRAPS / ALL RAIDS / HARDCORE toggles dropped | — | — | ✅ DONE (2026-04-28) | runConfig field removed from ArchetypeSelect, BossSystem hardcoded to 3 lives, NightPhase trap palette no longer reads runConfig.noTraps, DayPhase guild-raid override gone |
| ArchetypeSelect re-skin | Existing carousel UI re-themed for 10 monster types | — | TBD | ⏳ PENDING | layout/code already supports any count; mostly art + JSON swap |

---

## 2. Personalities (target: 18 from design + open-ended more)

| ID | Name | Phase | Status | Notes |
|---|---|---|---|---|
| greedy | Greedy | 5 | ✅ DONE | data + AI-goal influence |
| speed_runner | Speed Runner | 5 | ✅ DONE | data |
| paranoid | Paranoid | 5 | ✅ DONE | data + 0.55× movement in non-starter rooms (6c proxy until knowledge in Phase 8) |
| party_loyal | Party Loyal | QW | ✅ DONE | AISystem rallies to DEFEND_ALLY goal when a party-mate drops below 40% HP; releases when ally heals back to 60%+ |
| solo | Solo | QW | ✅ DONE | AISystem strips partyId on first tick (records formerPartyId on flags), emits SOLO_SPLIT |
| raid_leader | Raid Leader | QW | ✅ DONE | AISystem._onAdventurerDied cascades flee to all surviving party-mates when a raid_leader falls (RAID_LEADER_FELL event) |
| completionist | Completionist | 5 | ✅ DONE | data + EXPLORE_ROOM steering |
| cartographer | Cartographer | 5 | ✅ DONE | data + full-accuracy map share on flee (8 — KNOWLEDGE_CARTOGRAPHER_BOOST) |
| vandal | Vandal | — | 🚫 REMOVED 2026-04-29 | Personality scrapped during Phase 5c ability rework. Trap-disarm role is now exclusive to Ranger's Trap Expert ability. JSON entry deleted from personalities.json + personalityCombos.json (vandal_speedrunner combo gone) + chatLines.json. TrapSystem._tryVandalDisarm logic removed. Old saves with vandal personality may fail to load (acceptable for jam). |
| martyr | Martyr | 5 | ✅ DONE | data + taunt at low HP (6c — redirects minion aggro) |
| underdog | Underdog | 5 | ✅ DONE | data + 2× adventurer XP per kill (7b — adventurer XP/level system added) |
| inquisitor | Inquisitor | 5 | ✅ DONE | Phase 9b: InquisitorSystem dispels random active mechanic 8s after entry, restores on flee/death/day-end |
| vulture | Vulture | 5 | ✅ DONE | data + skip-combat-when-loot-in-room (7b) + SEEK_LOOT detour via lootPriority 0.85 |
| traumatized | Traumatized | 5 | ✅ DONE | data + PARTY_WIPED reaction (6d — sole survivor flees with full intel flag) |
| the_fan | The Fan | 5 | ✅ DONE | data + spare-idol (6d — picks random minion class to refuse to attack at spawn) |
| coward | Coward | 5 | ✅ DONE | data + flee-on-enemy (6c) + knowledge spread on flee (8 — KNOWLEDGE_COWARD_PARTIAL accuracy) |
| overconfident | Overconfident | 5 | ✅ DONE | low fleeThreshold (0.2) in behaviorWeights makes them stay too long — design intent satisfied without explicit override |
| beast_tamer | Beast Tamer | 5 | 🚫 REMOVED 2026-04-29 | Promoted to a Class ("Beast Master") in §3 with single-companion mechanic; personality entry deleted from personalities.json. Old saves with this personality will fail to load (acceptable for jam). |

---

## 3. Adventurer classes (target: 5 from design + class pool expansion)

| ID | Name | Phase | Status | Notes |
|---|---|---|---|---|
| knight | Knight | 4 | ✅ DONE | stats + class tag |
| mage | Mage | 4 | ✅ DONE | stats + spellcasting + mana drain (6c) + melee fallback when out of mana |
| cleric | Cleric | 5 | ✅ DONE | stats + tags + heal_ally + smite_undead (6c bonus damage vs undead) |
| necromancer | Necromancer | 5 | ✅ DONE | stats + tags + raise_corpse (6d — 2 raises/day, 10 mana, defects on adventurer faction) |
| twitch_streamer | Twitch Streamer | 5 | ✅ DONE | Phase 10b: AISystem chat_poll redirects to random unvisited room every ~10s |
| rogue | Rogue (bonus, not in design) | 4 | ✅ DONE | extra class on top of design — confirm with user if to keep |
| ranger | Ranger | 6e | ✅ DONE — class data + arrow consumption per shot + melee fallback + flee on empty quiver |
| beast_master | Beast Master | 5b | 🟡 PARTIAL — class data added 2026-04-29 (rare, unlock lvl 6) | Behavior pending: single-companion slot on adventurer state, `tame_minion` ability locked while companion alive, defection of tamed minion to adventurer faction, `command_beast` directing the active companion. Replaces removed beast_tamer personality. |
| barbarian | Barbarian | 5b | ⏳ PENDING — class data added 2026-04-29 | Behavior pending: rage damage scaling (× (1 + (1 − hpFrac)) up to 2× at 1 HP); `unstoppable` flag suppresses fleeThreshold and any future Fear/panic effects. |
| monk | Monk | 5b | ⏳ PENDING — class data added 2026-04-29 | Behavior pending: `dodgeChance` 0.3 evaluated by CombatSystem on incoming damage AND by TrapSystem on trap step (miss → no damage, no trap consume); `armor_pierce` halves minion DEF on monk strikes. |
| bard | Bard | 5b | ⏳ PENDING — class data added 2026-04-29 | Behavior pending: aura grants +15% ATK and +15% SPD to nearby same-party adventurers while bard is alive; aura ends on bard death/flee. AISystem should treat bard as priority threat for minion targeting. |

---

## 4. Personality combos (target: 4 from design + open-ended more)

| ID | Combo | Phase | Status | Notes |
|---|---|---|---|---|
| greedy_cartographer_clash | Greedy + Cartographer | 5 | ✅ DONE | detected + banner |
| paranoid_speedrunner_split | Paranoid + Speedrunner | 5 | ✅ DONE | combo banner + component effects produce the split organically: paranoid 0.55× speed in unfamiliar rooms, speed_runner faster movement — they drift apart by ~3 tiles within the first room |
| martyr_vulture | Martyr + Vulture | QW | ✅ DONE | AISystem: vulture refuses to engage when a party-mate martyr is taunting (HP ≤ MARTYR_TAUNT_HP_FRACTION). Sets `flags.vultureWaitingForCarnage`, falls through to loot pickup once carnage drops gear |
| raidleader_traumatized | Raid Leader + Traumatized | 5/QW | ✅ DONE | raid_leader cascade-flee fires from AISystem._onAdventurerDied when leader falls; traumatized survivor adds `fullKnowledgeOnFlee` flag — both effects compound when the combo is in play |
| Other combos (8 more added) | — | 5/QW | ✅ DONE | underdog_cleric_fan: 1.5× extra XP mul (`BELIEVERS_BOOST` event); martyr_coward / solo_coward / loyal_traumatized: traumatized full-knowledge flee + solo split + cleric heal-ally all live; vandal_speedrunner: vandal disarm + speed_runner movement; beasttamer_necromancer: tame + raise both fire; greedy_cartographer / completionist_speedrunner / overconfident_paranoid / greedy_overconfident: produced organically by behaviorWeights |
| Visible relationship icons above heads | — | QW | ✅ DONE | AdventurerRenderer renders ★ comboBadge to the right of any adv with activeCombos.length > 0 |
| 💭 More combos | — | 5–10 | 💭 OPEN | grow as new tags land |

---

## 5. Dungeon mechanics (target: 13 from design + tons more)

| ID | Name | Phase | Status | Notes |
|---|---|---|---|---|
| mimicry_plague | Mimicry Plague | 10 | ✅ DONE | DAY_PHASE_STARTED handler creates Mimic minions disguising 20% of unclaimed loot; reveal-on-step in MinionAISystem |
| taxation_of_souls | Taxation of Souls | 9 | ✅ DONE | ROOM_OBSERVED first-visit damage + 0.7× essence yield penalty |
| gravitational_anomaly | Gravitational Anomaly | 9 | ✅ DONE | CombatSystem._computeDamage applies 0.5× ranged / 1.2× melee |
| cursed_fountains | Cursed Fountains | 9 | ✅ DONE | AISystem._applyRoomEffects flips healing fountain to damage |
| no_health_regeneration | No Health Regeneration | 9 | ✅ DONE | AISystem._sleep zeroes regen rate when flag is set |
| memory_fog | Memory Fog | 9 | ✅ DONE | ADVENTURER_SLEPT handler drops 50% of knowledge entries |
| eternal_night | Eternal Night | 9 | ✅ DONE | KnowledgeSystem.visibleRoomIds + EternalNightOverlay (depth 2.7 dark veil over non-visible rooms) |
| hunger | Hunger | 9 | ✅ DONE | onDailyTick handler drains 1 HP per 30s of game-time |
| bloodbound | Bloodbound | 9 | ✅ DONE | MinionAISystem.respawnAll filters dead permanently + CombatSystem 1.5× damage mult |
| knowledge_is_pain | Knowledge is Pain | 9 | ✅ DONE | COMBAT_HIT subscriber adds +10% damage in re-cleared rooms |
| paranoia_protocol | Paranoia Protocol | 9b | ✅ DONE | ParanoiaIndicator overlay paints "⚠ 10%" labels above healing fountains + treasure rooms |
| spectral_reinforcements | Spectral Reinforcements | 9b | ✅ DONE | DAY_PHASE_STARTED handler spawns up to 3 translucent ghost minions in rooms where adventurers died ≤3 days ago |
| loot_curse | Loot Curse | 9 | ✅ DONE | LOOT_DROPPED tagger marks items cursed; daily-tick stacks debuff on minions wearing cursed gear |
| End-of-day mechanic offering UI | — | 9 | ✅ DONE | EndOfDay scene shows 3 cards filtered by archetype + dungeon level |
| Tradeoff display in offering UI | — | 9 | ✅ DONE | Each card shows tradeoffDescription in gold italic |
| 💭 Many more mechanics | — | 9–10 | 💭 OPEN | aim ≥30 by 1.0 |

---

## 6. Dungeon room types

### 6a. Design list (target: 9 from design)

| ID | Name | Phase | Status | Notes |
|---|---|---|---|---|
| hall_of_echoes | Hall of Echoes | 3 | ✅ DONE — data + sound-alert (6e — combat alerts adjacent rooms' minions for 8s) |
| false_exit | The False Exit | QW | ✅ DONE | RoomBehaviorSystem teleports fleeing adventurers next to boss chamber on entry |
| treasure_room | Treasure Room | 3 | ✅ DONE | data; loot-spawn + raid-pull in Phase 7 |
| healing_fountain | Healing Fountain | 3 | ✅ DONE — data + heal-on-stand (6e — 4 HP/sec out of combat) |
| necropolis_wing | Necropolis Wing | QW | ✅ DONE | RoomBehaviorSystem._onNightStart raises one uncollected corpse per wing as a free skeleton minion |
| colosseum | Colosseum | QW | ✅ DONE | RoomBehaviorSystem._lockColosseumGates spawns 3 skeleton warriors when adventurer enters |
| mirror_maze | Mirror Maze | 8b | ✅ DONE | rooms.json + KnowledgeSystem rolls MIRROR_MAZE_KNOWLEDGE_ACCURACY (0.4) on first observation |
| obelisk_room | Obelisk Room | QW | ✅ DONE | AISystem._applyRoomEffects toggles heal/charge state every 6s; charge grants +50% next attack via attacker.flags.obeliskChargedNextAttack |
| starter_barracks | Barracks | 2 | ✅ DONE — data + sneakable (6e — minions sleep until first combat hit in the room) |

### 6b. Existing additional rooms (kept beyond design)

| ID | Name | Phase | Status | Notes |
|---|---|---|---|---|
| boss_chamber | Boss Chamber | 2 | ✅ DONE | fixed centerpiece |
| starter_corridor | Corridor | 2 | ❌ REMOVED | Corridors removed; rooms now auto-snap directly through doorways. See DESIGN.md core concept. |
| starter_guard_post | Guard Post | 2 | ✅ DONE | |
| trap_room | Trap Room | 3 | ✅ DONE | trap firing in Phase 6 |
| entry_hall | Entry Hall | 3 | ✅ DONE | crossroads starter |
| crypt | Crypt | QW | ✅ DONE | RoomBehaviorSystem._onNightStart spawns 1 free skeleton per crypt (cap 2) |
| armory | Armory | QW | ✅ DONE | CombatSystem._isAdjacentToActiveArmory grants +2 attack to dungeon minions in/adjacent to active Armory rooms |
| prison_block | Prison Block | QW | ✅ DONE | AISystem._applyRoomEffects: 30% chance on first entry to detain adventurer for 5 s (frozen, aiState='detained'); ADVENTURER_DETAINED event emitted |
| serpent_pit | Serpent Pit | QW | ✅ DONE | AISystem._applyRoomEffects deals 2 HP/sec poison while in room |

### 6c. Open-ended

| Item | Phase | Status |
|---|---|---|
| 💭 Many more room types | 6–10 | 💭 OPEN |

---

## 7. Trap types

### 7a. Standard ("the usual")

| Type | Phase | Status |
|---|---|---|
| spike_trap | 6b | ✅ DONE — stepped_on trigger, deals 20 physical |
| arrow_trap | 6b | ✅ DONE — line_of_sight_broken (proxy: stepped_on), 18 piercing |
| pitfall_trap | 6b | ✅ DONE — stepped_on, 25 physical |

### 7b. Interaction traps (target: 9 from design)

| ID | Name | Phase | Status | Notes |
|---|---|---|---|---|
| greed_trap | Greed Trap | QW | ✅ DONE | AISystem emits LOOT_PICKED_UP on SEEK_LOOT pickup; TrapSystem._onLootPickedUp fires same-room greed traps |
| whisper_trap | Whisper Trap | QW | ✅ DONE | ChatBubbles emits CHAT_BUBBLE_EMITTED on bubble show; TrapSystem._onChatBubble fires same-room whisper traps |
| patience_trap | Patience Trap | 6b | ✅ DONE — fires on stand-still 3s+ |
| speed_trap | Speed Trap | 6b | ✅ DONE — fires when speed >= 2.0 tiles/sec |
| mercy_trap | Mercy Trap | 6c | ✅ DONE — fires on ALLY_HEALED event in same room |
| torch_trap | Torch Trap | QW | ✅ DONE | trapTypes flag `requiresEternalNight:true`; TrapSystem._fireTrap fizzles with TRAP_FAILED_NEEDS_NIGHT when Eternal Night mechanic is inactive |
| echo_mine | Echo Mine | 6d | ✅ DONE — armed on 1st step, fires on 2nd (35 explosive dmg) |
| memory_trap | Memory Trap | 8 | ✅ DONE — fires when `adv.knowledge.rooms[roomId].visitCount >= 2` |
| curse_brand_trap | Curse Brand Trap | 6d | ✅ DONE — applies cursedBrand flag for 30s; minions get priority 3 aggro on target |

### 7c. Open-ended

| Item | Phase | Status |
|---|---|---|
| 💭 Many more interaction traps | 6–10 | 💭 OPEN |

---

## 8. Minion / monster types

### 8a. Behavior types

| Type | Phase | Status |
|---|---|---|
| patrol | QW | ✅ DONE | MinionAISystem shuffles idle patrol minions to a random walkable tile in their home room every 3s |
| guard | 6 | ✅ DONE — stand at home tile, engage in same room |
| hunt | QW | ✅ DONE | MinionAISystem._pickTarget skips ENGAGE_REQUIRES_SAME_ROOM when minion.behaviorType === 'hunt' |
| sleeping (in barracks) | QW | ✅ DONE | MinionAISystem._tickMinion regens 0.5 HP/sec for idle dungeon-faction minions in starter_barracks when no adventurer is present |

### 8b. Special types (target: 9 from design)

| ID | Name | Phase | Status | Notes |
|---|---|---|---|---|
| sapper | Sapper | 6e | ✅ DONE — repairs triggered traps in same room (~2.5s per trap) |
| herald | Herald | 6e | ✅ DONE — alerts adjacent rooms when adventurer enters (5s alert window) |
| engineer | Engineer | 6e | ✅ DONE — passive 1.25× damage buff on traps in same room |
| scavenger | Scavenger | QW | ✅ DONE | MinionAISystem._tickScavenger drags floor loot in same room to nearest treasure_room every 4s |
| mimic_handler | Mimic Handler | QW | ✅ DONE | personalities.json + AISystem._pickNextGoal filters out item.isMimicSpawn loot for mimic_handler-tagged advs |
| whisperer | Whisperer | QW | ✅ DONE | MinionAISystem._tickWhisperer corrupts a random sharedKnowledge entry every 10s — accuracy capped at 0.3, trap tile coords jittered ±2 |
| cleaner | Cleaner | QW | ✅ DONE | MinionAISystem._tickCleaner marks recent corpses in same room as collected, denying vulture loot grabs |
| mourner | Mourner | 6e | ✅ DONE — stacking attack buff on each same-room ally death (+2 attack/death) |
| echo | Echo | QW | ✅ DONE | MinionAISystem stamps minion.mimickedClassId from the last-seen adventurer; CombatSystem._computeDamage uses it for class-flavored damage (mage spells, cleric smite, ranger arrows, rogue backstab) |

### 8c. Existing (in `minionTypes.json`)

| ID | Phase | Status |
|---|---|---|
| skeleton_warrior | 6 | ✅ DONE | full data + AI + combat |
| skeleton_archer | 6 | ✅ DONE | ranged guard, attackRange 4 |
| bone_brute | 6 | ✅ DONE | tank, slow heavy melee |

### 8d. Open-ended

| Item | Phase | Status |
|---|---|---|
| 💭 Many more types unlocked as you play | 6–10 | 💭 OPEN |

---

## 9. Evolution Trees (kill-method-driven)

| Evolution | Trigger | Phase | Status |
|---|---|---|---|
| Plague Bringer | killMethod: poison, 3 kills | 7 | ✅ DONE — data + EvolutionSystem condition matcher |
| Shadow Stalker | killMethod: backstab, 3 kills | QW | ✅ DONE | CombatSystem._inferMethod returns 'backstab' when a rogue strikes a non-engaging target |
| Mana Eater | killedClassType: mage, 5 kills | 7 | ✅ DONE — data + condition matcher |
| Bone Crusher | killedClassType: knight, 5 kills | 7 | ✅ DONE |
| Lich Apprentice | survives 10 days no kills | 7 | ✅ DONE — daysAliveWithoutKill condition |
| Vengeful Wraith | killed by adventurer 3+ times, then respawned | 7b | ✅ DONE — `timesKilledAndRespawned` counter, evolution check fires on MINION_RESPAWNED |
| Kill events carry damageType + method | — | 6 | ✅ DONE — CombatSystem emits both fields |
| EvolutionSystem applies stat deltas + new abilities | — | 7 | ✅ DONE |
| 💭 Many more evolution paths | 7–10 | 💭 OPEN | |

---

## 10. Boss fight & abilities

| Item | Phase | Status |
|---|---|---|
| Auto-resolved boss fight (no boss control) | 10 | ✅ DONE | BossSystem._resolve runs iterative slug-fest: party totalAtk vs boss def vs boss atk spread across alive party until either side wipes |
| 3 boss deaths → game over → eulogy → new run | 10 | ✅ DONE | gameState.boss.deathsRemaining; BOSS_DEFEATED_FINAL → GameOver scene with eulogy + NEW RUN button |
| Boss evolution tree (XP-spent abilities) | 10b | ✅ DONE | bossAbilities.json with 6 nodes (3 tiers); BossSystem.unlockAbility spends Dark Power, requires-chain enforced; EndOfDay BOSS UPGRADES modal |
| Summon adds ability | 10b | ✅ DONE | summon_adds ability spawns 2 skeleton helpers in boss chamber on each fight |
| Environmental hazards (lava floor, falling pillars) | 10b | ✅ DONE | lava_floor (3 HP/sec passive fire), collapsing_pillars (random ~4s 8 dmg burst) rooms wired in AISystem._applyRoomEffects |
| 💭 Many more abilities | 10b | 💭 OPEN — 6 abilities in tree; expand in future passes |

---

## 11. Knowledge system

| Item | Phase | Status |
|---|---|---|
| Per-adventurer knowledge of rooms / minions / traps | 8 | ✅ DONE — `adv.knowledge.{rooms,traps,minions}` populated by KnowledgeSystem |
| Knowledge accumulates as adventurer enters dungeon | 8 | ✅ DONE — `observeCurrentRoom` per tick + `observeMinion` on engagement scan |
| Knowledge sharing on flee (to other adventurers) | 8 | ✅ DONE — merges into `gameState.sharedKnowledge` with personality-specific accuracy |
| Knowledge accuracy flag (some intel is wrong) | 8 | ✅ DONE — accuracy multiplier, `'rumor'` source, partial accurate flag |
| Adventurer returns leading party with prior knowledge | 8 | ✅ DONE — KNOWLEDGE_RETURN_CHANCE rolls; leader's full knowledge copied to followers |
| Knowledge affects pathfinding cost | 8 | ✅ DONE — PathfinderSystem accepts `costFn`; trap-known tiles get 6× multiplier |

---

## 12. Visual feedback (set-and-forget gameplay)

| Item | Phase | Status |
|---|---|---|
| Knowledge Overlay toggle | 8 | ✅ DONE — DayPhase KNOWLEDGE button; world-space red→blue overlay |
| Thought Bubbles | 5 | ✅ DONE — shows primary personality icon |
| More thought-bubble states (Searching/Scared/Greedy/Healing/Planning) | 6b | ✅ DONE — Fighting/Fleeing/Searching states + personality default |
| Replay Ghost (returning party shows previous run) | 8b | ✅ DONE | AISystem path-samples to adv.pathHistory; KnowledgeSystem snapshots into AdventurerRecord; ReplayGhostRenderer subscribes to ADVENTURER_RETURNED, draws fading dot trail over REPLAY_GHOST_FADE_MS |
| Combat log (Slay-the-Spire style) | 6b | ✅ DONE — fading event feed bottom-left during day phase |
| Chat bubbles (adventurers talking to themselves/party) | 6b | ✅ DONE — class + personality lines, sparse pacing |
| Time controls (pause/1×/2×/4×) | 4 | ✅ DONE |
| Auto-pause on key events (boss fight, party wipe, mechanic) | 9b | ❌ REMOVED — froze AISystem mid-flee during boss fights; manual time-control buttons suffice |

---

## 13. Mana / Essence economy

| Item | Phase | Status |
|---|---|---|
| Soul Essence (upkeep currency) | 1 | ✅ DONE |
| Dark Power (upgrade currency) | 1 | ✅ DONE |
| Daily upkeep deduction at NightPhase start | 3 | ✅ DONE |
| Overdraft → shut off newest rooms | 3 | ✅ DONE |
| Reactivation when essence recovers | 3 | ✅ DONE |
| ESSENCE_WARNING / ESSENCE_CRITICAL events | 3 | ✅ DONE |
| Per-room essenceCostToPlace + upkeepCost | 1 | ✅ DONE |
| Trap upkeep costs | 6b | ✅ DONE — included in EssenceSystem.calculateDailyUpkeep |
| Minion upkeep costs | 6 | ✅ DONE — included in EssenceSystem.calculateDailyUpkeep |

---

## 14. Architectural rules

| Item | Phase | Status |
|---|---|---|
| Some traps need power from a Core room | QW | ✅ DONE | trapTypes flag `requiresPowerSource:true` on greed/mercy/echo_mine/curse_brand; TrapSystem._fireTrap checks `_hasPowerCore()` and silently fizzles (TRAP_FAILED_NO_POWER event) |
| Minions need a Barracks within N rooms | 6 | ✅ DONE — DungeonGrid.hasBarracksWithinDistance + NightPhase validation |
| Treasure rooms must be 3+ rooms deep | 3 | ✅ DONE — placement validation in DungeonGrid |
| `minDepthFromBoss` / `requiresAdjacentTags` placement rules | 3 | ✅ DONE — validation hook exists |
| `requiresPowerSource` validation | QW | ✅ DONE | enforced in TrapSystem._fireTrap — also surfaces TRAP_FAILED_NO_POWER for UI hooks |
| `maxPerDungeon` placement rule | 3 | ✅ DONE |

---

## 15. Loot system

| Item | Phase | Status |
|---|---|---|
| Loot drops on adventurer death | 7 | ✅ DONE — 2 rolls per death, gated by class affinity + dropChance |
| Equip dropped gear to minions | 7 | ✅ DONE — MinionInspector "EQUIP" button moves item from floor → minion equippedGear |
| Loot provenance/history (e.g. "wielded by Sir Aldric") | 7 | ✅ DONE — every drop/equip appends to LootItem.provenance |
| Vendetta system ("avenge my brother" — sibling adventurer hunts gear) | 7b | ✅ DONE — equip flags item, vendettas[] tracked, hunter spawns 35% next day |
| Cursed loot (deliberately let them take) | QW | ✅ DONE | LOOT_DROPPED handler now sets `curseLevel` (1-3 by rarity); lootCurse_tickDebuffs scales attack-loss by level; LootRenderer shows purple halo on cursed items |
| Adventurer hunts for specific mini-boss loot | 7b | ✅ DONE — SEEK_LOOT goal targets floor loot when lootPriority > 0.6 |
| Adventurer leaves to buy gear, returns stronger | 8b | ✅ DONE | RETURNING_GEAR_BONUS_HP/ATK applied to fled-and-returning leader in DayPhase |
| Loot grows in tier as dungeon levels up | 7 | ✅ DONE — maxTier = 1 + floor((dungeonLv-1) / LOOT_TIER_BY_DUNGEON_LEVEL) |
| LootItem.statModifiers / curseLevel / vendetta flags | 7 | ✅ DONE |

---

## 16. Adventurer behavior decisions

| Item | Phase | Status |
|---|---|---|
| Goal: SEEK_BOSS | 4 | ✅ DONE |
| Goal: EXPLORE_ROOM | 5 | ✅ DONE |
| Goal: SEEK_LOOT | 7b | ✅ DONE — fires when adventurer's lootPriority > 0.6 and floor loot exists; pickups transfer to adv.gear |
| Goal: FLEE (leave dungeon) | 6 | ✅ DONE — triggered by hp < personality.fleeThreshold |
| Goal: SLEEP (heal in dungeon) | 6e | ✅ DONE — sleeps when HP < 0.4 + no potions + no hostiles, regens 3 HP/sec |
| Goal: HEAL (use potion / cleric) | 6c | ✅ DONE — adventurers sip potions at HP < 0.4 if any in inventory; cleric heals allies in range |
| Goal: FOLLOW_PARTY | 10 | ✅ DONE | echo personality uses FOLLOW_LEADER goal targeting party-leader's tile (functionally identical) |
| Goal: AVOID_ENEMY (knowledge-driven) | 8 | ✅ DONE | KnowledgeSystem.costMultiplierForTile already applies KNOWLEDGE_TRAP_COST_MULTIPLIER (6×) on tiles with known traps — pathfinder routes around them |
| Goal: SCOUT | 5/8 | ✅ DONE | cartographer-tagged advs prioritise EXPLORE_ROOM goals via personality lootPriority/explorationDrive weights |
| Decision to fight / leave / sleep based on stats | 6/6c/6e | ✅ DONE | AISystem cowardShouldFlee (HP < threshold), resourceExhaustedShouldFlee (mage/ranger), shouldSleep (HP < POTION_HEAL_THRESHOLD) all live |
| Returning next day with knowledge + better gear | 8b | ✅ DONE | KnowledgeSystem.rollReturnLeader + DayPhase priorPathHistory hand-off + RETURNING_GEAR_BONUS_HP/ATK |

---

## 17. Adventurer resources

| Item | Phase | Status |
|---|---|---|
| HP / maxHp | 4 | ✅ DONE |
| Mana (mages, clerics) | 4 | ✅ DONE — mage spells cost 5/swing, cleric heals cost 4 (6c) |
| Arrows (rangers) | 6e | ✅ DONE — ranger class consumes 1 arrow per shot; out → 0.4× melee fallback |
| Potions count | 4 | ✅ DONE — adventurers consume on HEAL goal (6c) |
| Mana regen via standing still | 6d | ✅ DONE — mage regens 0.5 mana/sec when stationary out of combat |
| Resource depletion → leave dungeon | 6e | ✅ DONE — mage out of mana / ranger out of arrows + hostile in room → flee with reason 'out_of_mana'/'out_of_arrows' |
| Buying gear between runs | 8b | ✅ DONE | identical to "returns stronger" — RETURNING_GEAR_BONUS_HP (+8) and RETURNING_GEAR_BONUS_ATK (+2) |

---

## 18. Reputation system

| Item | Phase | Status |
|---|---|---|
| Reputation score in GameState | 1 | ✅ DONE — `meta.reputation` field |
| Reputation grows from adventurer deaths/stories | 10 | ✅ DONE | ReputationSystem accrues +1/kill, +5/bounty, +10/dungeon-level, +5/day-survived; -1 on flee |
| High rep attracts better hunters / legendary heroes / guild raids | 10/10b | ✅ DONE | legendary tier in 10; guild raids in 10b at feared+ reputation |
| Low rep attracts solo scrubs | 10 | ✅ DONE | implicit — base-tier spawn config used when reputation < 75 (whispered tier and below) |

---

## 19. Bounty hunters

| Item | Phase | Status |
|---|---|---|
| Minion-kill threshold (3+) triggers bounty hunter spawn | 7/7b | ✅ DONE | EvolutionSystem flags `hasBounty` at BOUNTY_KILL_THRESHOLD; vendetta hunter spawn variant in DayPhase covers the targeted-hunter feature |
| Wanted poster UI (name, kills, gear) | 7b | ✅ DONE — popup banner top-right on MINION_BOUNTY_POSTED; auto-fades 5s |
| Bounty-flagged minions feel "famous" | 7 | ✅ DONE — gold star marker above sprite + inspector banner |

---

## 20. Adventurer-side meta UI

| Item | Phase | Status |
|---|---|---|
| Dossier system (pre-day adventurer info with ?-marks) | 9b/QW | ✅ DONE | DossierPanel reveals progressively: 0 visits → name + ??? for class/tags/stats; 1 visit → class + 1 tag; 2+ → all personalities + stats; returning leaders / vendetta hunters / 3+ visits = fully revealed |
| Click-to-inspect during day phase | 4 | ✅ DONE |
| Trap memory UI ("spent" icons; what adventurers know) | 9b | ✅ DONE | TrapRenderer shows ⌒spent slash on triggered + 👁 eye-badge when any active adventurer or shared pool knows the trap |
| Adventurer "last words" / dying screams | 6b | ✅ DONE — class+killer-keyed lines from lastWords.json |

---

## 21. Minion meta

| Item | Phase | Status |
|---|---|---|
| Minion naming on first level-up | 7 | ✅ DONE — auto-generated name like "Grumbolt the Mage-Slayer" from kill history |
| Player can rename minions | QW | ✅ DONE | MinionInspector ✎ icon next to name opens window.prompt; sets minion.name + emits MINION_NAMED |
| Bounty status flag | 7 | ✅ DONE — `minion.hasBounty` set at BOUNTY_KILL_THRESHOLD kills |
| Per-minion kill history | 6 | ✅ DONE — populated by CombatSystem on kill events |

---

## 22. End-of-Day newspaper

| Item | Phase | Status |
|---|---|---|
| Generated newspaper-style summary | 9 | ✅ DONE | NewspaperSystem.compose() returns headline + body paragraphs |
| Dryly comedic tone | 9 | ✅ DONE | Workplace-memo voice; HR/Operations/bookkeeper framing |
| Mentions specific events (party reductions, traps, mechanics) | 9 | ✅ DONE | Casualties, flees, returned leaders, vendetta, traps fired/disarmed, evolutions, bounties, dungeon level-ups |
| Spread of "secrets" adventurers learned | 9/9b | ✅ DONE | newspaper notes flees + intel; DossierPanel pre-day card shows known personalities/visit history |

---

## 23. End-of-run / game-over UI

| Item | Phase | Status |
|---|---|---|
| Eulogy screen (cinematic, dungeon history) | 10 | ✅ DONE | GameOver scene shows days-survived, top minion of run with kills/level/evolutions, last 5 graveyard guests |
| Every named minion's kill count shown | 10 | ✅ DONE | eulogy shows top minion w/ kill count + level + evolution chain; per-minion drill-down via MinionInspector during run |
| Notable run moments listed | 10 | ✅ DONE | eulogy aggregates days, total kills, casualties, top minion, last 5 graveyard entries, active mechanics |

---

## 24. Adventurer graveyard UI

| Item | Phase | Status |
|---|---|---|
| Persistent graveyard scene/screen | 10 | ✅ DONE | Graveyard scene with scrollable list reachable from GameOver |
| Per-entry: name, class, personality, day died, killer, room, gear | 4 | ✅ DONE | Graveyard renderer shows name + class + day + killer + personalities (room/gear shown via deeper inspector in 10b) |
| Sortable / filterable / searchable | 10b | ✅ DONE | sort chips (recent/day/class/killer) + class filter chips with scene-restart re-render |

---

## 25. Risk / Reward dynamics

| Item | Phase | Status |
|---|---|---|
| Treasure rooms lure raid groups (more XP, but stronger gear leaves) | 7b/10b | ✅ DONE | mini-boss in treasure rooms (7b) + guild-raid spawn at feared+ rep (10b) |
| Tradeoff display on dungeon mechanic offering | 9 | ✅ DONE | EndOfDay offer cards show tradeoffDescription in gold italic |
| Tradeoff display on boss evolution choice | 10b | ✅ DONE | EndOfDay BOSS UPGRADES modal shows ability description per node |

---

## 26. Other ideas (from "Other Ideas" section of design)

| Item | Phase | Status |
|---|---|---|
| Random guild raid teams | 10b | ✅ DONE | DayPhase guild-raid spawn path at feared+ reputation (4-person coordinated party with shared partyId) |
| Adventurers fight among themselves over loot (free XP) | 9b | ✅ DONE | LootGreedSystem scans every 4s for 2+ greedy advs in same room with loot, applies 6% maxHP shove damage to two random combatants |
| Endless mode | 10b | ✅ DONE | GameOver "CONTINUE (ENDLESS)" button resets boss to 1 life, +1 dungeon level, sets runConfig.endless |
| Challenge runs ("no traps", "all raids", etc.) | 10b | ✅ DONE | ArchetypeSelect 3-chip toggle row sets runConfig.{noTraps, allRaids, hardcore} — wired in NightPhase trap palette, DayPhase guild-raid path, BossSystem._init |
| Combat log (condensed, Slay-the-Spire style) | 6b | ✅ DONE |
| Adventurer chat bubbles (talking to selves/party) | 6 | ✅ DONE | ui/ChatBubbles.js — random class/personality lines every 7-15s with 2.2s lifetime |
| Time controls | 4 | ✅ DONE |
| Auto-pause on key events | 9b | ❌ REMOVED — see deviation note below |
| Adventurer last words referencing what killed them | 6b | ✅ DONE |
| Personality interactions (combos) | 5 | ✅ DONE |
| Leaderboard (Supabase backend) | future | 💭 OPEN | requires backend service — explicit defer |

---

## 27. Dungeon-content placements (other than rooms/minions/traps)

| Item | Phase | Status | Notes |
|---|---|---|---|
| Mini-bosses (placeable, guard rooms) | 7b | ✅ DONE — minion placed in treasure_room auto-promotes (3× HP, 1.6× attack), guarantees high-tier drop on death |
| Hidden keys | QW | ✅ DONE | RoomBehaviorSystem._onNightStart drops an iron_key in a random non-boss room each night when a locked room exists but no key is on the floor |
| Locked doors | QW | ✅ DONE | KnowledgeSystem.costMultiplierForTile returns 9999 for tiles inside locked rooms when adventurer lacks an iron_key — A* effectively treats them as impassable |
| Secret rooms | QW | ✅ DONE | secret_passage room type; AISystem._pickNextGoal filters out secret rooms unless adv has `mapper` or `completionist` tag |
| Adventurer level scales with dungeon level | 7b | ✅ DONE — +10% maxHp, +7% attack per dungeon level above 1 (applied in DayPhase spawn) |
| Dungeon level progression (rooms unlock as it levels up) | 7b | ✅ DONE — `meta.dungeonLevel` increments based on cumulative kills (curve: 5 × 1.4^(n-2)) |
| "Legendary heroes" tier (drawn by high reputation) | 10 | ✅ DONE | DayPhase rolls ReputationSystem.legendarySpawnChance() per spawn; isLegendary flag + 1.5×HP / 1.4×ATK / 1.3×DEF |
| Guild raid teams (full party of coordinated adventurers) | 10b | ✅ DONE | DayPhase._spawnDailyAdventurers branches to a 4-person raid path at feared+ reputation (or whenever runConfig.allRaids is set); shared partyId, +25% HP/atk, 2 personalities each |

---

## 28. Tile / visual / asset

| Item | Phase | Status |
|---|---|---|
| Pixel art tilesets (LoZ-style top-down) | (opportunistic) | ⏳ PENDING — user is sourcing |
| Adventurer sprite sheets | (opportunistic) | ⏳ PENDING |
| Minion sprite sheets | (opportunistic) | ⏳ PENDING |
| Trap / room decoration sprites | (opportunistic) | ⏳ PENDING |
| Tilemap-based renderer (replaces Graphics-based wireframe) | (opportunistic) | ⏳ PENDING |
| 2-thick wall ring + 2×2 doors (geometry change, Phase 1) | QW | ✅ DONE — `Balance.WALL_THICKNESS=2`, `DungeonGrid._writeTiles` paints WT-thick walls and 2×WT door blocks; rooms.json bumped (+2 in each dim) and cps shifted accordingly |
| 2-thick wall ring — procedural renderer rework (Phase 2) | QW | ✅ DONE — `_buildWallOrientation` produces rich tags (`{kind, depth}` for straight walls, `{kind:'corner', side, role}` for corner blocks); `_drawWallCellByTag` dispatcher: outer-ring straight cells get capstone+brick face, inner-ring cells get bricks+baseboard, outer corners use existing `_drawWallCorner` with new `drawBaseboard=false`, h/v-arm sub-cells render as straight outer walls, inner-corner sub-cell uses new `_drawInnerCornerCell` (flat WALL_BASE + baseboard L wrapping room interior). Doors simplified to flat FLOOR_BASE per cell (legacy arch helpers preserved but unused — multi-cell-aware arch is a future polish item). |

---

## 29. Phase-by-phase summary

| Phase | Description | Status |
|---|---|---|
| 1 — Foundation | Phaser setup, scenes, EventBus, SaveSystem, GameState, balance.js | ✅ DONE |
| 2 — Dungeon Rendering | DungeonGrid, Game scene, NightPhase build mode, MiniMap | ✅ DONE |
| 3 — Build Phase | DayPhase stub, EssenceSystem, more rooms, removal/undo | ✅ DONE |
| 4 — Adventurer AI | Adventurer entity, Pathfinder, AISystem, day cycle | ✅ DONE |
| 5 — Personality System | All 18 personalities, 6 classes, 13 combos, thought bubbles, party formation | ✅ DONE |
| 5b — Class pool expansion (2026-04-29) | beast_tamer personality promoted to "Beast Master" class; +3 new classes (Barbarian, Monk, Bard). Class data landed; behavior wiring (rage scaling, fearless, dodge, armor_pierce, party aura, single-companion taming) ⏳ PENDING. | 🟡 PARTIAL |
| 6 — Combat (kernel) | Minion entity + 5 types, placement UI, CombatSystem, MinionAISystem (guard/patrol + same-room engage), adventurer FLEE goal + flee threshold, barracks-distance validation, mid-dungeon death, minion respawn at night | ✅ DONE |
| 6b — Combat enrichment (traps + UI) | Trap entity + system + renderer, 5 traps (spike/arrow/pitfall/patience/speed) + placement UI, trap upkeep, combat log overlay, last words, chat bubbles, wider thought bubble states | ✅ DONE |
| 6c — Combat enrichment (abilities + behavior) | Mage mana drain, cleric heal_ally + smite_undead, HEAL goal (potion sip), martyr taunt, coward flee-on-enemy, paranoid slow-in-unfamiliar, mercy trap | ✅ DONE |
| 6d — Faction system + remaining mechanics | Minion faction field, necromancer raise_corpse, beast_tamer tame, traumatized panic-flee on PARTY_WIPED, curse brand trap, echo mine, mana regen, the_fan spare_idol | ✅ DONE |
| 6e — Backfill (orphaned phase-6 items) | Archetype-gated minion modifiers, ranger class + arrow resource, resource-depletion flee, hall_of_echoes sound-alert, healing_fountain heal-on-stand, barracks sneak-through, utility minions (Sapper/Herald/Engineer/Mourner), SLEEP goal | ✅ DONE |
| 7 — XP / Leveling / Evolution / Loot | LootItem entity + 16 lootDefs, LootSystem (drop/generate/equip/provenance), LootRenderer, MinionInspector UI, EvolutionSystem (XP/level/kill-driven evolution), minion naming generator, bounty flag + visual marker, level badges | ✅ DONE |
| 7b — XP/loot polish | Dungeon level progression, adventurer stat scaling, vendetta system, mini-bosses, SEEK_LOOT goal, vulture loot-stealing, underdog 2× XP + adventurer leveling, wanted poster UI, vengeful_wraith evolution + respawn-count, equipped-item display by name | ✅ DONE (rename UI + scavenger/cleaner deferred to Phase 10 polish) |
| 8 — Knowledge System | KnowledgeSystem (room/trap/minion observation), flee-share with personality accuracy, inheritance on spawn, returning leader brings party w/ full knowledge, pathfinder weighting, knowledge overlay toggle UI, memory_trap firing | ✅ DONE |
| 8b — Knowledge polish | Replay Ghosts, Mirror Maze room, vandal disarm action, between-run shopping (gear buy), Eternal Night fog-of-war foundation | ✅ DONE |
| 9 — Dungeon Mechanics (kernel) | DungeonMechanicSystem, EndOfDay scene, newspaper, 13 mechanic definitions wired (most fully, mimicry/paranoia/spectral as data-flags) | ✅ DONE |
| 9b — Dungeon polish | Dossier UI, trap memory UI, paranoia chest indicators, auto-pause on key events, inquisitor mechanic disable, adventurers fight over loot, spectral ghost spawning | ✅ DONE (Hidden keys + locked doors, mimic AI, echo personality moved to Phase 10) |
| 10 — Boss Fight + Polish (kernel) | BossSystem with auto-resolved fight, BossFightOverlay, GameOver eulogy, Graveyard scene, ReputationSystem + tier ladder + legendary spawns, Mimic minion + Mimicry Plague reveals, Echo personality, key/locked-door foundation | ✅ DONE |
| 10b — Endgame polish | Boss evolution tree (6 nodes), Summon Adds ability, lava_floor + collapsing_pillars hazards, guild raid teams at feared+ reputation, endless mode continue, hardcore/no-traps/all-raids challenge runs, 5 new boss archetypes, Graveyard sort/filter, twitch_streamer chat_poll | ✅ DONE — Supabase leaderboard + 5 more archetypes + locked-door pathfinder block remain explicit defers |

---

## 30. Sprite-based dungeon tiling — themes + tileset editor + room template editor

> See DESIGN.md → "Sprite-based dungeon tiling" for the full spec.
> Three-phase build (A → B → C). Each row "data + UI + persistence + game wiring".

| ID | Item | Phase | Status | Notes |
|---|---|---|---|---|
| theme-schema | Theme JSON schema (slots: floor, 10 wall slots, 24 door slots; per-slot variant arrays) | 30A | ⏳ PENDING | locked design 2026-04-30 — 24 door slots = 3 states × 2 orientations × 4 tiles |
| sprite-library | Sprite library (PNGs + per-sprite metadata: srcSize 32/64/128, mode scale\|span, tags) | 30A | ⏳ PENDING | individual PNGs only, no sheet slicing |
| variant-pick | Random pick per cell at dungeon-build time, persisted in dungeon state (no per-frame flicker) | 30A | ⏳ PENDING | rolled once when room is stamped |
| fs-handle | File System Access API wrapper (pick project root once, persist handle in IndexedDB, write PNGs + JSON) | 30A | ⏳ PENDING | Chrome/Edge primary, Firefox falls back to download |
| tileset-editor | TilesetEditor scene: sprite library panel, slot grid w/ variants, scale/span toggle, live preview, save theme | 30A | ⏳ PENDING | accessed from MainMenu rune |
| theme-per-room | Each room template in rooms.json gets a `theme: "<name>"` field | 30A | ⏳ PENDING | renderer reads at place time |
| room-tile-editor | RoomTileEditor scene: load any room template, paint cells with library sprites, save tileLayout back to rooms.json | 30B | ✅ DONE | uses existing `tileLayout` field on rooms.json |
| room-tile-rotation | Per-cell rotation in RoomTileEditor: R-key / UI button cycles brush 0/90/180/270; cell entries become `string \| { id, rot }`; renderer applies setAngle | 30B+ | ✅ DONE | scope (1) only — per-variant rotation in TilesetEditor not yet planned |
| room-tile-mirror | Per-cell horizontal + vertical mirror toggles on the brush. Cell entries gain optional `flipH`, `flipV` booleans; renderer applies image.flipX / flipY. Composes with rotation. | 30B+ | ⏳ PENDING | brush state persists across MainMenu round-trips like rotation does |
| renderer-sprite-path | DungeonRenderer adds sprite-based tile path; consumes active theme + per-cell overrides; falls back to procedural when no theme | 30C | ⏳ PENDING | replaces graphics-primitive walls/floors/doors when theme present |
| span-rendering | Renderer honors span sprites: 64 covers 2×2 anchor, 128 covers 4×4; covered cells skipped | 30C | ⏳ PENDING | anchor cell paints, neighbours skip |
| mainmenu-runes | MainMenu gets TILESET EDITOR + ROOM EDITOR runes | 30A/B | ⏳ PENDING | A adds tileset rune, B adds room editor rune |

---

## How to keep this file honest

- **At every phase exit**: update statuses for items tagged in that phase. If a row is still PENDING or PARTIAL when the phase ends, either fix it or get explicit user approval to defer.
- **When the user adds new design items**: add them here with phase + status before implementing.
- **Open-ended (💭) items**: track running counts in the relevant section (e.g. "12/30 mechanics shipped").
- **When implementation differs from design**: don't silently rewrite this file — flag the divergence to the user and update DESIGN.md if they approve.

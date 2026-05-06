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

**Last full audit**: 2026-05-02 (Phase 1b cleanup — Orc Warband (replaces scrapped WAAAGH!) + generic patrolling-minion door re-lock both shipped. (a) Warband: `_tickOrc` runs every frame for the orc archetype; per-orc room lookup → tally other orcs in same room → recompute `stats.attack = round((_orcBaseAttack + lootAtkBonus) × (1 + 5%·allies))` and `stats.defense = round(_orcBaseDefense × (1 + 5%·allies))`. Loot the Fallen refactored to write only `lootAtkBonus`; baselines stamped on `MINION_PLACED` / `BOSS_LEVELED_UP` / save-load. New balance constants `ORC_WARBAND_ATK_PCT_PER_ALLY` (0.05), `ORC_WARBAND_DEF_PCT_PER_ALLY` (0.05). DESIGN.md / bossArchetypes.json bestiary copy updated. (b) Patroller door re-lock: new `MinionAISystem._tickPatrollerDoors` (runs at end of every minion-AI tick); `_isPatrollerMinion(m) = _isVampireThrall || _isDemonImp || _isHauntGhost`. Tracks each patroller's current cp via `dungeonGrid.getCpForDoorTile`; on door-tile entry stores the cp + lock snapshot + calls `openDoor` (door visibly swings open during traversal); on door-tile exit calls `closeDoor` and restores `cp.locked = true` if the snapshot recorded it. Extended `DungeonRenderer.closeDoor` to mirror to the paired cp (matching `openDoor`'s symmetry), so a single close-call closes both sides of the doorway. The Vampire row was the last entry blocking Phase 1b from being fully ✅; that's now closed too. Phase 1b is now functionally complete. (c) Myconid corpse-glyph polish landed too: BossArchetypeSystem captures the dying adv's `spriteVariant` + the last-frame index of its `hurt-down` anim; FungalCorpseRenderer paints that frame at 0.55× scale tinted `0x66ee66` so the corpse looks like the actual collapsed adventurer gone fungal (skull glyph kept as fallback for advs without LPC sprites). Phases shipped this pass (in order): 1b.1 Orc Loot the Fallen, 1b.2 Golem Living Architecture + Earthquake, 1b.3 Beholder Petrify Gaze + Anti-Magic Aura, 1b.4 Lich Phylactery, 1b.5 Lich Necromancy, 1b.6 Lizardman Camouflage + Venom Stack, 1b.7 Myconid Spore Network + Corpse Bloom, 1b.8 Wraith Fear Meter + Haunting, 1b.9 Demon Sacrifice Pact + Hellgate, 1b.10 Vampire Charm + Blood Tax, 1b.11 Gnoll Hunters Pack + Bloodlust, 1b.12 Orc Warband, 1b.13 patrolling-minion door re-lock. Ten new behaviors share one system (`BossArchetypeSystem`) and one UI panel (`BossArchetypeUI`); two purely-visual renderers were added (`PhylacteryRenderer`, `FungalCorpseRenderer`); two existing systems gained event hooks (`KnowledgeSystem.observeMinion` emits `MINION_OBSERVED`, `CombatSystem.tryAttack` clears camouflage on first hit). New gameplay state slots on `gameState`: `_lich`, `phylactery`, `_myconid`, `fungalCorpses`, `_demon`, `_gnoll`, `_antiMagicRoomIds`. ~25 new balance constants added. Previous audit 2026-05-02 (Monster boss redesign — spec lock & doc pass. User finalized 1-2 unique playstyle-defining abilities per boss for all 10 monsters; replaces the older "headline mechanic + supporting modifiers" structure that was approved 2026-04-28 but never implemented. (a) DESIGN.md § "Monster boss redesign" rewritten end-to-end with the locked specs, niche-coverage table updated, implementation order numbered 1-11 (Orc → Gnoll). Doc cleanup also landed: room-connection paragraph clarified to note Corridor is now a placeable room type (no auto-routed segments); "Adventurer resources" mana-pool reference replaced with cooldowns / per-day-budget per the Class ability rework. (b) bossArchetypes.json rewritten: each boss carries one or two new mechanics with brief bestiary copy, old mechanic-text rows wiped. Status legend on each ability set to `implemented: false` since none have shipped yet. (c) DESIGN_COVERAGE.md § 1b table rebuilt with the new headline-mechanic descriptions, phase column locked to 1b.1 → 1b.11, ArchetypeSelect re-skin row marked ✅ DONE since the bestiary is data-driven. Note: Orc boss only has one ability locked (Loot the Fallen); the WAAAGH! second ability was scrapped and a replacement is pending a follow-up design pass — row noted as 🟡 PARTIAL design until the second ability lands. Previous audit 2026-05-02 (Gold-economy + sell + mimic pass — (a) `STARTING_GOLD: 999999 → 30` (DEV_INFINITE_GOLD still on for testing). (b) All 21 T1 minions retuned: unlock-level spread 1→10 (~2 unlocks per boss level), gold cost 6→35 by power, three outliers stat-reduced (golem1 60/10/8 → 42/8/6, demon1 35/9/4 → 28/8/3, orc1 32/9/3 → 28/8/3) and a few under-tuned T1s buffed (vinekin/plant1 atk 2 → 4, mushroom1 atk 3 → 4, beholder1 atk 4 → 5, vampire_minion1 hp 14 → 16, lich1 atk 4 → 5, ent1 hp 30 → 28). (c) Sell rules unified — `_removeMinion` flipped 100% → 50% refund (matches rooms+traps). MinionRenderer right-click handlers (sprite + placeholder) early-return on right-click — minions are now sell-button-only just like rooms+traps. (d) Mimic chest-disguise mechanic rebuilt: spawn extras add `isMimic + mimicState: 'chest'`; MinionAISystem skips chest-state ticks; AISystem._findEngageableMinion skips chest-state targeting; new RoomBehaviorSystem._rollMimicOpens fires on ADVENTURER_ROOM_CHANGED (40% open chance unknown / 5% known); _revealMimic flips state, applies 30% maxHp bite, marks knowledge across the live party; KnowledgeSystem.sharedPool gained a `mimics` bucket + propagation in _rebuildSharedPool / _ensureAdvKnowledge / initKnowledgeForSpawn; MinionRenderer paints a wooden chest with gold trim until reveal. Constants: MIMIC_OPEN_CHANCE_UNKNOWN, MIMIC_OPEN_CHANCE_KNOWN, MIMIC_REVEAL_BITE_FRAC. DESIGN.md Mimic Vault row + ARCHITECTURE.md mimic section + Phase-9 summary line bumped from "9 active pacts" to 64.) Previous audit 2026-05-02 (Mechanics-cleanup landed — code-side deletion of all four systems the user cut. (1) Soul Essence renamed to gold across all gameplay code, JSON data fields (`essenceCostToPlace` → `goldCost`), balance constants (`STARTING_GOLD`, `GOLD_PER_KILL`, `DEV_INFINITE_GOLD`, `MINION_RESPAWN_COST_GOLD`, `MECHANIC_TAXATION_GOLD_PENALTY`), the archetype modifier (`goldGainMultiplier`), and UI labels. SaveSystem version bumped 1.0.0 → 1.1.0. (2) `EssenceSystem.js` deleted; `upkeepCost` stripped from JSON data and entity factories; `UPKEEP_SHUTDOWN_ORDER` removed; upkeep stat row + bar + deactivation notice deleted from NightPhase; per-card "/day" strings dropped. (3) `ReputationSystem.js` deleted; `REPUTATION_*` constants removed; guild-raid block removed from DayPhase; legendary heroes downgraded to flat 5% per spawn. (4) `LootSystem.js`, `LootRenderer.js`, `LootGreedSystem.js`, `LootItem.js`, `MimicRenderer.js`, `lootDefinitions.json` deleted; `gameState.loot` removed from initial state; `LOOT_PICKED_UP`/`LOOT_SCAVENGED` listeners purged; vulture loot-grab logic and treasury chest carry/escape removed (Treasury keeps flat stipend); mimic chest-disguise mechanic stripped (mimics in Mimic Vault now spawn as plain hostile garrison minions, MimicRenderer/`_tickMimic`/`_tickScavenger` deleted); SEEK_LOOT goal type and `openingChest`/`carriedChest` flags removed from AISystem; mimic sprite preload + animation registration deleted; Greed Trap trigger handler removed (data file was already empty). DESIGN.md "Mana / Essence economy" and "Reputation system" strikethroughs simplified; ARCHITECTURE.md stale-sections banner replaced with a "Removed systems" reference block at the top. Active pact pool unchanged at 13.) Previous audit 2026-05-02 (Mechanics-cleanup intent recorded — user cut four game systems: Soul Essence rename, daily upkeep, reputation, loot pickup. Active pact pool unchanged at 13.) Previous audit 2026-05-02 (Section 5 — Residual-code cleanup pass for the 11 cut mechanics: deleted `EternalNightOverlay.js`, `ParanoiaIndicator.js`; removed dead branches from `CombatSystem._computeDamage` (gravAnomaly), `AISystem._sleep` (noHealthRegen + ADVENTURER_SLEPT emit), `KnowledgeSystem` (isEternalNightActive / visibleRoomIds / _bboxGap), `TrapSystem` (requiresEternalNight gate + _isEternalNightActive), `NewspaperSystem` (HUNGER_BITE listener + huntCount paragraph); dropped orphaned balance constants (HUNGER, KNOWLEDGE_PAIN, MIMICRY, GRAV, LOOT_CURSE, MEMORY_FOG, ETERNAL_NIGHT_VISION_ROOMS); removed the EternalNight/Paranoia overlay constructions, isActive-checks, destroys, and per-frame updates from `Game.js`. Earlier the same day — User cut 11 mechanics from the pact pool: mimicry_plague, gravitational_anomaly, cursed_fountains, no_health_regeneration, memory_fog, eternal_night, hunger, knowledge_is_pain, paranoia_protocol, spectral_reinforcements, loot_curse. All marked 🚫 REMOVED; DESIGN.md numbered list strikethrough'd with `(REMOVED 2026-05-02 — cut from pact pool)` parentheticals per CLAUDE.md "removal-not-deletion" policy. Active pact pool now 9: taxation_of_souls, bloodbound, gold_rush, undying_horde, sealed_paths, pack_synergy, blood_money, hasty_architect, great_erasure. Previous Section-5 row also: two new dark pacts added earlier today: `hasty_architect` (rare, 50% trap discount + 25% jam chance) and `great_erasure` (legendary, escapees forget the dungeon + 2× adventurer base stats). Hooked into NightPhase trap-cost path, BuildMenu cost display, TrapSystem._fireTrap jam roll, KnowledgeSystem._onAdventurerFled erasure, and DungeonMechanicSystem ADVENTURER_ENTERED_DUNGEON stat doubler.) Previous audit 2026-05-01 (Section 31 — UI/HUD overhaul shipped end-to-end. Phases 31A→31I all marked ✅ DONE: Crypt theme + Press Start 2P primitives, title screen rewrite, run-history plumbing, full HUD chrome (top bar / mini-map / build menu / dungeon log / knowledge pin / action bar), Sell+Move tools, four info popups (Adventurer Intel / Boss Overview / Minion Roster / Knowledge Map), Post-Wave Summary + Dark Pact split, Pause Menu redesign + Options scene, Game Over rewrite with animated count-up. Deprecated chrome (BossHpPanel, MiniMap purple variant, transient CombatLog) deleted. Original 'build-action-rotate' row scope-changed mid-phase: ROTATE button dropped from action bar at user request; rotation now happens via R key while a room is held in MOVE mode.) Previous audit 2026-04-30 (Section 6 only — Room redesign 2026-04-30 spec landed: 21-room roster locked, gateway/cap/scaling rules added, 14 existing rooms marked 🚫 REMOVED with handler-cleanup deferred.) Previous audit 2026-04-29 (Class ability rework foundation — mana system removed end-to-end; Vandal personality retired in favor of Ranger's upcoming Trap Expert; new AbilitySystem; vulnerableToElements field seeded; classes reset to PENDING per the per-class spec in DESIGN.md → "Class ability rework". Phase reopened as 5c.) Previous audit 2026-04-29 (earlier): Class pool expansion — Beast Master class promotion + Barbarian/Monk/Bard added.

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

> See DESIGN.md → "Monster boss redesign" for the locked spec per boss (one-or-two playstyle-defining abilities; no padding modifiers).
> Spec finalized 2026-05-02. Implementation in progress — order is `1b.1` (Orc) → `1b.11` (Gnoll), ascending complexity / shared-infra dependencies.

| ID | Boss | Locked abilities (headline summary) | Phase | Status | Notes |
|---|---|---|---|---|---|
| orc         | Orc Veteran      | **Loot the Fallen** — each orc keeps +1 ATK per kill (per-orc, lost on death). **Warband** — orcs in the same room give every other orc in that room +5% ATK and +5% DEF, stacks per ally, no cap. | 1b.1 / 1b.12 | ✅ DONE (2026-05-02 — both abilities) | **Loot the Fallen (1b.1):** `BossArchetypeSystem` listens for `ADVENTURER_DIED`/`MINION_DIED` while archetype = orc + killer is an orc-tagged minion; bumps `lootAtkBonus` (no longer writes `stats.attack` directly — Warband's recompute owns the live value). On death, `lootAtkBonus` is zeroed; the next `_tickOrc` pass auto-rebalances the cluster. `MinionRenderer` paints a small "+N" badge in orc-red at the bottom-left of the orc sprite (gated by archetype + tag + bonus>0). **Warband (1b.12):** `_tickOrc` runs every frame from `tick(delta)` for the orc archetype. Per orc, looks up its current room via `dungeonGrid.getRoomAtTile`, counts other live orc-tagged minions in the same room, derives `atkMult = 1 + allies × ORC_WARBAND_ATK_PCT_PER_ALLY` (0.05) and `defMult = 1 + allies × ORC_WARBAND_DEF_PCT_PER_ALLY` (0.05), then writes `stats.attack = round((_orcBaseAttack + lootAtkBonus) × atkMult)` and `stats.defense = round(_orcBaseDefense × defMult)`. Pristine baselines stamped on `MINION_PLACED`, `BOSS_LEVELED_UP` (rebaselined post-scale by inferring base from current value ÷ live warband multiplier), and at scene boot for save-load via `_captureOrcBaseline` (subtracts active loot bonus before stamping). New balance constants: `ORC_WARBAND_ATK_PCT_PER_ALLY`, `ORC_WARBAND_DEF_PCT_PER_ALLY`. No SaveSystem changes — all new fields (`_orcBaseAttack`, `_orcBaseDefense`, `lootAtkBonus`) are plain numbers that JSON-serialize naturally. |
| golem       | Earth Golem      | **Living Architecture** — every placed room (incl. boss + corridor) → +5 boss HP / +1 DEF permanent. **Earthquake** — 1×/day day-phase button; pick a room, advs inside take (rooms placed × 2) damage. | 1b.2 | ✅ DONE (2026-05-02) | `BossArchetypeSystem` listens for `ROOM_PLACED`/`ROOM_REMOVED` while archetype is golem; tracks `gameState.boss._golem` (`roomsCounted` / `hpApplied` / `defApplied` / `earthquakeUsesLeft` / `firstUseToastShown`) so a save/load and dynamic place/remove stay balanced and don't double-count. On scene init, backfills any rooms not yet counted (handles old saves cleanly). Earthquake: new `BossArchetypeUI` panel above the action bar shows the EARTHQUAKE button only when archetype = golem and phase = day; click → arms; next click on a dungeon tile → resolves the room → emits `GOLEM_EARTHQUAKE_TARGET` → system applies `(rooms × 2)` damage to every adv inside (uses `gameState.dungeon.rooms.length`, no cap). Damage routes through `COMBAT_HIT` and triggers `ADVENTURER_DIED` if HP drops to 0 (so RunHistorySystem / boss XP still fire). UI consumes `GOLEM_EARTHQUAKE_FIRED` and plays a Game-camera shake (450 ms) + a floating `EARTHQUAKE -N` text over the room center. Daily uses reset on `NIGHT_PHASE_STARTED`. First-use toast fires on construction (UI-side gate via `firstUseToastShown` flag, immune to scene-startup ordering). New balance constants: `GOLEM_HP_PER_ROOM`, `GOLEM_DEF_PER_ROOM`, `GOLEM_EARTHQUAKE_DMG_PER_ROOM`, `GOLEM_EARTHQUAKE_USES_PER_DAY`. Click-on-button gate prevents the room-pick handler from resolving a phantom room when the player clicks the button itself to disarm. |
| beholder    | Beholder Tyrant  | **Petrify Gaze** — BossFightScene only; freezes advs 2s every 6s with eye-beam VFX. **Anti-Magic Aura** — 2 random rooms/day disable class abilities for the day (+1 per boss level); purple glow VFX | 1b.3 | ✅ DONE (2026-05-02) | Petrify Gaze: `BossArchetypeSystem` listens to `BOSS_FIGHT_STARTED` and starts a Phaser timer that fires every `BEHOLDER_PETRIFY_INTERVAL_MS` (6000) for the duration of the fight. Each fire stamps `adv._petrifiedUntil = now + BEHOLDER_PETRIFY_DURATION_MS` (2000) on every adv inside the boss chamber. `BossSystem._tickFightAdv` early-returns while petrified (freeze in place); `BossSystem._runOneRound`'s attackers filter excludes petrified advs (no boss damage that round). VFX: dedicated `_petrifyFxGraphics` layer draws eye-beams from boss to each target + stone-crackle rings on targets, fading over the 2 s freeze window (prior tweens killed before re-fire). Timer torn down on `BOSS_FIGHT_RESOLVED`; lingering `_petrifiedUntil` cleared so survivors aren't stuck. Anti-Magic Aura: `DAY_PHASE_BEGAN` triggers `_rollAntiMagicRooms` — Fisher-Yates picks `BEHOLDER_ANTIMAGIC_BASE_ROOMS` (2) + `(bossLevel-1) × BEHOLDER_ANTIMAGIC_PER_BOSS_LV` (1) random non-boss rooms, stamps `room._antiMagic=true` and `gameState._antiMagicRoomIds=[…]`. `ClassAbilitySystem.update` reads the daily set and skips the `consider*(adv)` switch when an adv stands inside a marked room (existing buffs still tick out via `_tickActiveBuffs`). VFX: `_antiMagicFx` graphics layer paints a soft purple wash + bright outline on each marked room. `NIGHT_PHASE_STARTED` clears marks + the overlay. Save/load safe — both per-room flags and the gameState id list serialize naturally; constructor calls `_renderAntiMagicAura` so a mid-day reload still shows the glow. New balance constants: `BEHOLDER_PETRIFY_INTERVAL_MS`, `BEHOLDER_PETRIFY_DURATION_MS`, `BEHOLDER_ANTIMAGIC_BASE_ROOMS`, `BEHOLDER_ANTIMAGIC_PER_BOSS_LV`. |
| lich        | Elder Lich       | **Phylactery** — unlocks at boss lvl 3; free Heart item (200 HP, heart-full sprite), 4th life. 15% per-adv hunt roll on entry. Only one heart, no replacement if destroyed; with no normal lives, every party hunts the heart. **Necromancy** — kills raise as free Skeletons next dawn (last 1 full day, retain class abilities, dead Clerics heal your minions, no minion-cap). | 1b.4 / 1b.5 | ✅ DONE (2026-05-02) — Phylactery (1b.4) + Necromancy (1b.5) both shipped this pass | **Phylactery (1b.4):** new `src/data/items.json` registered in Preload; `BuildMenu` `_itemDefs()` filters by archetype + `unlockLevel` + one-per-run, hidden once placed. Items tab now also re-renders on `BOSS_LEVELED_UP` / `PHYLACTERY_PLACED` / `PHYLACTERY_DESTROYED` so the heart appears/disappears live. `NightPhase._confirmItemPlacement` validates non-boss room + floor tile, stamps `gameState.phylactery = { instanceId, roomId, tileX, tileY, worldX, worldY, resources: { hp, maxHp }, spriteKey, placedDay }`. New `PhylacteryRenderer` paints `heart-full` sprite + 28px HP bar with hurt-flash; instantiated in `Game.js` and ticked each frame. `BossSystem._endFight` was extended: when `winner='party'` drains `deathsRemaining` to 0 AND `phylactery.resources.hp > 0`, the system bumps `deathsRemaining` back to 1 and refills boss HP, swallowing the final-death event and emitting `PHYLACTERY_REVIVED_BOSS` instead. AISystem: new `HUNT_PHYLACTERY` goal type wired into `_goalToTile` (path target = phyl tile; falls back to FLEE if heart gone) and `_onGoalReached` (freeze adv on arrival; only re-pick when heart destroyed). `BossArchetypeSystem._onAdvsSpawned` rolls `LICH_PHYLACTERY_HUNT_CHANCE` (0.15) per adv on dungeon entry — or forces 100% when `boss.deathsRemaining ≤ 0`. New `tick(delta)` runs from `Game.update()` real-time: every `LICH_PHYLACTERY_DMG_INTERVAL_MS` (800 ms), advs adjacent to the heart's tile with `HUNT_PHYLACTERY` deal `stats.attack` damage; when HP hits 0 the system fires `PHYLACTERY_DESTROYED` once, drops `gameState.phylactery`, and routes surviving hunters to FLEE. Unlock toast (`PHYLACTERY_UNLOCKED`) fires on `BOSS_LEVELED_UP` (and on scene boot for save-load) the first time `boss.level ≥ 3`; gated by `boss._lich.unlockToastShown`. `BossArchetypeUI` consumes that event + `PHYLACTERY_REVIVED_BOSS` + `PHYLACTERY_DESTROYED` and shows toasts. New balance constants: `LICH_PHYLACTERY_UNLOCK_LEVEL`, `LICH_PHYLACTERY_HUNT_CHANCE`, `LICH_PHYLACTERY_DMG_INTERVAL_MS`. **Necromancy (1b.5):** `_onAdvDied` queues `{ classId, name, level, tileX, tileY }` onto `gameState._lich.pendingRaises` whenever the active boss is the lich. `_onDayBegan` (DAY_PHASE_BEGAN listener) culls expired raised first via `_cullExpiredRaised` (cull rule: `today < m._expireAtDay`), then drains the pending queue via `_raiseQueuedDead`: spawns `skeleton1` via `createMinion` at the boss-chamber center (offset around a small ring so they don't stack), with `class: 'garrison'` (so they don't count toward the roster cap), `isUndead: true` (so MinionAISystem.respawnAll permanently removes them on death), `_raisedFromAdvDeath: true`, `_raisedClassId`, `_raisedAdvName`, `_expireAtDay = today + NECROMANCY_LIFESPAN_DAYS` (1, so they vanish at the very next dawn). `_applyClassRetentionBuffs` adjusts base stats per the dead adv's class (cleric: +DEF, range 2, support tag; mage: +ATK, range 3, arcane damage; ranger: +ATK, range 3; knight: +HP +DEF; barbarian: +ATK -DEF; monk: +SPD; rogue: +ATK +SPD; others: +1 ATK). Boss-level scaling re-applied on top via `applyBossLevelToMinion`. Raised cleric heal: `_tickRaisedClerics` runs each frame from `tick(delta)`, every `NECROMANCY_CLERIC_HEAL_INTERVAL_MS` (2200) heals the most-wounded ally minion within Manhattan dist 3 for `NECROMANCY_CLERIC_HEAL_AMOUNT` (4). Events: `NECROMANCY_RAISED { count, minionIds }`, `NECROMANCY_RAISED_EXPIRED { count }`, `NECROMANCY_CLERIC_HEAL { sourceId, targetId, amount }`. New balance constants: `NECROMANCY_LIFESPAN_DAYS`, `NECROMANCY_CLERIC_HEAL_AMOUNT`, `NECROMANCY_CLERIC_HEAL_INTERVAL_MS`. |
| lizardman   | Serpent Captain  | **Camouflage** — minions/traps invisible to advs until first attack (per-entity individual reveal); player sees them slightly transparent. **Venom Stack** — every minion attack adds a -1 HP/sec poison stack; persists until adv dies or leaves dungeon; green tint + stack count VFX | 1b.6 | ✅ DONE (2026-05-02) | **Camouflage:** added `lizardman` tag to lizardman1/lizardman2 in minionTypes.json. `BossArchetypeSystem._onMinionPlaced` stamps `_camouflaged = true` on freshly placed lizardman-tagged minions while archetype is lizardman. `CombatSystem.tryAttack` clears the flag on the attacker's first hit and emits `LIZARDMAN_CAMO_REVEAL`. AISystem's `_findEngageableMinion` skips camouflaged minions (advs literally can't see them); `KnowledgeSystem.observeMinion` skips them too (no rumour-pool entry). MinionRenderer now multiplies container alpha by 0.5 when `_camouflaged` so the player sees a translucent ambusher. NIGHT_PHASE_STARTED listener re-camouflages every surviving lizardman minion so each new day = fresh ambush hit. Traps already invisible to advs by default (KnowledgeSystem only adds entries on `TRAP_TRIGGERED`), so no extra trap-side gate was needed. **Venom Stack:** new `_onCombatHit` listener — when the source is a lizardman-tagged minion + the target is an active adv + damage > 0, increments `adv._venomStacks`. New `_tickVenom` runs from `tick(delta)` (always-on while archetype is lizardman); every `LIZARDMAN_VENOM_TICK_INTERVAL_MS` (1000) deals `stacks × LIZARDMAN_VENOM_DMG_PER_STACK` (1) to each poisoned adv via a synthetic `COMBAT_HIT` (sourceId='venom', damageType='poison'); fires `ADVENTURER_DIED` (killerId='venom') when the tick drops them. Stacks cleared on `ADVENTURER_FLED`. AdventurerRenderer paints a `Nx` green badge above the HP bar and tints the LPC sprite green while stacks > 0; clears tint + badge on stack drop. New balance constants: `LIZARDMAN_VENOM_TICK_INTERVAL_MS`, `LIZARDMAN_VENOM_DMG_PER_STACK`. |
| myconid     | Predator Myconid | **Spore Network** — every 3 days all Corridor rooms emit a green spore cloud all day; 0.5×bossLevel HP/tick to advs inside. **Corpse Bloom** — adv corpses become green-tinted fungal terrain hazards for 3 days (-2 HP/sec on touch, stacks across corpses); after 3 days the corpse turns into a free Vinekin (`plant1`), no minion-cap. Despawn on room-move | 1b.7 | ✅ DONE (2026-05-02) | **Spore Network:** `_rollSporeNetwork` runs each `DAY_PHASE_BEGAN`; on days where `dayNumber % MYCONID_SPORE_INTERVAL_DAYS === 0` it stamps every corridor-room id (`starter_corridor` or any room tagged `corridor`) onto `gameState._myconid.activeSporeRoomIds`. `_renderSporeOverlay` paints a faint green wash + dotted edge + deterministic spore-speck dots on each room (depth 2.5 so the boss/minions still draw on top). `_tickMyconid` runs every frame from `tick(delta)`: every `MYCONID_SPORE_TICK_INTERVAL_MS` (1000), advs inside spore rooms take `Math.round(bossLevel × MYCONID_SPORE_DMG_PER_BOSS_LV)` damage, routed through COMBAT_HIT (sourceId='spores', damageType='poison'), with ADVENTURER_DIED on kill (killerId='spores'). Cleared on `NIGHT_PHASE_STARTED`. **Corpse Bloom:** `_onAdvDied` (myconid branch) appends `{ instanceId, tileX, tileY, roomId, daysRemaining: MYCONID_CORPSE_LIFESPAN_DAYS, classId, name }` to `gameState.fungalCorpses`. New `FungalCorpseRenderer` paints each corpse: green wash + mossy ring + green-tinted skull glyph at the corpse tile, ticked from Game.update in both phases. `_tickMyconid` per frame: any adv standing on a corpse tile that hasn't already been listed in `adv._fungalCorpsesStung` adds the corpse id and bumps `adv._venomStacks` by `MYCONID_CORPSE_VENOM_STACKS_ADDED` (2) — reusing the lizardman venom-tick pipeline (`_tickVenom` ungated so any archetype's stacks are processed). `_tickFungalCorpseDay` runs at every `DAY_PHASE_BEGAN`: decrements `daysRemaining` on each corpse and, when it hits zero, sprouts a free `plant1` (Vinekin) at the corpse tile via `createMinion` with `class: 'garrison'` (no minion-cap) + `_myconidSprout: true`, then removes the corpse from the list. `_onRoomRemovedMyconid` (subscribed to `ROOM_REMOVED`) drops every fungal corpse whose `roomId` matches the removed room. New balance constants: `MYCONID_SPORE_INTERVAL_DAYS`, `MYCONID_SPORE_DMG_PER_BOSS_LV`, `MYCONID_SPORE_TICK_INTERVAL_MS`, `MYCONID_CORPSE_LIFESPAN_DAYS`, `MYCONID_CORPSE_VENOM_STACKS_ADDED`. Corpse glyph **(updated 2026-05-02 polish pass):** `_onAdvDied` now captures the dead adv's `spriteVariant` (e.g. `knight/v01`) and the last-frame index of the `<key>-hurt-down` Phaser anim by walking `scene.anims.get(animKey).frames`. `FungalCorpseRenderer._createSprite` paints that exact frame from the LPC sheet at `0.55` scale, tinted `0x66ee66` — so the corpse looks like the actual collapsed adv, just gone fungal. Falls back to the original green-tinted ☠ glyph if the texture or frame isn't available (e.g. an adv without an LPC sprite). The wash + mossy ring underlay still renders in either case. |
| wraith      | Dark Wraith      | **Fear Meter** — adv tracks fear (+5 corpse, +10 trap, +5 minion sighted, +15 ally died); 50%→flee any random room, 75%→attack other advs 5s, 100%→die (gold but no boss XP); floating bar VFX above adv (no overlap with HP bar). **Haunting** — adv deaths spawn a free Ghost (`ghost2`) in that room (permanent, no minion-cap); patrols spawn room, sees advs in adjacent connected rooms, moves through walls to engage, returns home if alive | 1b.8 | ✅ DONE (2026-05-02) | **Fear Meter:** adv carries `_fear` (0..`WRAITH_FEAR_MAX`=100). `BossArchetypeSystem._addFear` clamps + emits `WRAITH_FEAR_CHANGED`. Sources: `_onTrapTriggered` (+10), `_onMinionObserved` (+5; new `MINION_OBSERVED` event emitted from `KnowledgeSystem.observeMinion` only when a minion is observed *for the first time*), `_onAdvRoomChanged` checks the destination room for any adv corpse → +5 per entry, and `_onAdvDied` (wraith branch) bumps every same-party adv within 5 Manhattan tiles (or in the death room) by +15. `_tickWraith` runs each frame: at ≥50 fear, flag `_fearFleeTriggered` and reroute the adv to a random non-entry/non-boss `EXPLORE_ROOM` (one-shot per run-up); at ≥75, set `_fearAttackUntil = now + WRAITH_FEAR_FRIENDLY_FIRE_WINDOW_MS` (5000) and switch goal to `ATTACK_ALLY` against a random same-party member; at ≥100, panic-die — sets `hp=0`, awards `Balance.GOLD_PER_KILL` via `RESOURCES_AWARDED`, fires `ADVENTURER_DIED` with `_noBossXp: true` and `damageType: 'fear'`. AdventurerRenderer paints a 2 px purple→red gradient fear bar **just below the HP bar** (no overlap); hidden at 0, alpha re-renders only when the rounded fear value changes. **Haunting:** `_spawnHauntGhost` runs from the wraith branch of `_onAdvDied`. Creates a `ghost2` minion at the death tile via `createMinion` with `class: 'garrison'` (no minion-cap) + `_isHauntGhost: true` + `_hauntHomeRoomId` + `_hauntHomeTileX/Y` + `isSpectral: true` (renderer translucency) + boss-level scaling. `_tickHauntGhosts` runs every frame from `_tickWraith`: each haunt picks the nearest adv within `WRAITH_HAUNT_DETECT_RANGE_TILES` (8) regardless of walls; lerps `tileX/tileY` directly toward the target at `WRAITH_HAUNT_PHASE_SPEED_TILES_PER_SEC` (1.6 t/s) — no pathfinder, walls are ignored. When in melee (dist ≤ 1) it calls `combatSystem.tryAttack(m, target)`. With no target it lerps back to its home tile (`_hauntPhase: 'home' / 'hunt' / 'return'`). Emits `WRAITH_HAUNT_SPAWNED` for any future UI hookups. `MINION_OBSERVED` event added to KnowledgeSystem — fired only on first sighting per (adv, minion-type, room) tuple. New balance constants: `WRAITH_FEAR_MAX`, `WRAITH_FEAR_PER_CORPSE_SEEN`, `WRAITH_FEAR_PER_TRAP_TRIGGERED`, `WRAITH_FEAR_PER_MINION_SIGHTED`, `WRAITH_FEAR_PER_ALLY_DIED_NEAR`, `WRAITH_FEAR_FLEE_THRESHOLD`, `WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD`, `WRAITH_FEAR_PANIC_DEATH_THRESHOLD`, `WRAITH_FEAR_FRIENDLY_FIRE_WINDOW_MS`, `WRAITH_HAUNT_DETECT_RANGE_TILES`, `WRAITH_HAUNT_PHASE_SPEED_TILES_PER_SEC`. |
| demon       | Demon Lord       | **Sacrifice Pact** — fire UI button; click → pick a minion → minion permanently burns (fire VFX) and a random adv in the dungeon instakills. 1×/day, greys out at zero minions. **Hellgate** — permanent corner portal in boss room; daily N free Imps (`imp1`) where N=boss level, 10% imp1 stats × (1+0.1 × bossLevel), no cap. Imps roam the dungeon, persist forever (no minion-cap) | 1b.9 | ✅ DONE (2026-05-02) | **Sacrifice Pact:** new SACRIFICE button in `BossArchetypeUI` (danger style, sits in the same slot as EARTHQUAKE — only one shows per archetype). Visible only when archetype = demon + phase = day. Click → emits `DEMON_SACRIFICE_ARM` → BossArchetypeSystem flips `_sacrificeArmed` and emits `DEMON_SACRIFICE_ARMED` → UI swaps label to "PICK A MINION" + installs a Game-scene pointerdown handler that resolves the closest live dungeon-faction minion within 0.7 × tile. Click on minion → `DEMON_SACRIFICE_TARGET { minionId }` → `_fireSacrifice` zeroes the minion's HP, fires `MINION_DIED + DEMON_SACRIFICE_BURN_VFX` (orange-red expanding ring + scale tween at the minion's last position), strips the minion from `gameState.minions` so the night respawn pass can't revive it, picks a uniform random alive adv, fires `COMBAT_HIT` (sourceId='sacrifice_pact', damageType='fire') + `ADVENTURER_DIED` (killerId='sacrifice_pact'). Daily uses tracked on `gameState._demon.sacrificeUsesLeft` (1) and refilled at every NIGHT_PHASE_STARTED. Button greys out via `_refreshVisibility` when uses=0 OR no live minions exist. Right-click on the dungeon disarms; clicking the button itself toggles arm/disarm. **Hellgate:** `_renderHellgatePortal` paints a permanent infernal disc (dark fire halo + orange ring + yellow inner ring + dark core + flame specks) at the inside corner of the boss chamber on construction. `_spawnHellgateImps` runs at every NIGHT_PHASE_STARTED for the demon archetype: spawns N=boss-level imps via `createMinion` from `imp1`, with `class: 'garrison'` (no minion-cap) and explicitly-scaled stats `Math.round(base × (DEMON_HELLGATE_BASE_STAT_FRAC × (1 + bossLv × DEMON_HELLGATE_STAT_PER_LV)))` (0.10 × (1 + 0.10×lv) — so lvl 1 = 10%, lvl 5 = 15%, lvl 10 = 20% of imp1 base for HP/ATK/DEF). Each imp is stamped `_isDemonImp: true` + `_impRoamLastSwapAt: 0`. Permadeath is intrinsic — they keep `class:'garrison'` so the regular respawn pass can't revive them. **Imp roaming:** `_tickDemonImps` runs every frame from `tick(delta)`. Every 6 s per imp, picks a random non-boss room and reassigns `assignedRoomId` + `homeTileX/Y` to that room's center; the base `MinionAISystem` patrol behaviour then paths the imp toward the new home, so imps drift across the dungeon instead of orbiting the boss room. Imps still engage advs in melee/range like any patrol minion. New balance constants: `DEMON_SACRIFICE_USES_PER_DAY`, `DEMON_HELLGATE_BASE_STAT_FRAC`, `DEMON_HELLGATE_STAT_PER_LV`. |
| vampire     | Vampire Sovereign| **Charm** — at dawn the system marks a random adv with a charm VFX; they leave party, walk to boss room, become a Thrall (same class/abilities, `vampire_minion1` sprite). Thralls patrol the whole dungeon hunting advs; survive across days; do not respawn if killed; close (and re-lock) doors behind them — **door re-lock applies to all patrolling minions in the game**. **Blood Tax** — minion damage on advs is rerouted to boss HP (advs still die, boss heals); boss damage works normally; faint red streak VFX from adv to boss | 1b.10 | ✅ DONE (2026-05-02) — Charm + Blood Tax + thrall patrol + generic patrolling-minion door re-lock all shipped | **Charm:** vampire branch in `BossArchetypeSystem._onAdvsSpawned` picks one random alive adv from the spawning batch, sets `_charmed: true`, stashes original `partyId` in `_charmedFormerPartyId`, nulls partyId, and assigns `goal = { type: 'CHARM_WALK', roomId: bossRoomId }`. Emits `VAMPIRE_CHARM_MARKED`. New `CHARM_WALK` goal type wired into `AISystem._goalToTile` (path target = boss-room center) and `_onGoalReached` (path=null + idle). `_tickCharmConversion` (in `_tickVampire`) iterates the active adv list every frame; when a charmed adv is standing inside the boss chamber, spawns a `vampire_minion1` via `createMinion` at the adv's tile with `class: 'garrison'` (no minion-cap) + `_isVampireThrall: true` + `_charmedClassId` + `isUndead: true` (so MinionAISystem.respawnAll permanently strips them on death). Class retention reuses `_applyClassRetentionBuffs` (same lookup table as Lich Necromancy raises), boss-level scaling applied. Adv is spliced from `gameState.adventurers.active` (no FLED/DIED — they defected). Emits `MINION_PLACED` + `VAMPIRE_THRALL_CONVERTED`. **Thrall patrol:** `_tickThrallRoaming` rotates each thrall's `assignedRoomId` to a random non-boss room every `VAMPIRE_THRALL_ROAM_SWAP_MS` (6000), reusing the Demon-imp roaming pattern; the existing `MinionAISystem` patrol behavior paths the thrall toward the new home, so they drift across the dungeon hunting advs. Thralls don't count toward minion cap and don't respawn on death (`isUndead` strip in `respawnAll`). **Blood Tax:** `_onCombatHit` vampire branch — when source is a dungeon-faction minion + target is an adv + damage > 0, the boss gains `dmg` HP (clamped to maxHp) and emits `VAMPIRE_BLOOD_TAX_TICK { fromX/Y, toX/Y, amount }`. Adv still loses HP as normal; lethal hits still kill them. Boss attacks unaffected. **VFX:** `BossArchetypeUI` listens for `VAMPIRE_CHARM_MARKED` (paints a pulsing dark-red ring around the charmed adv until conversion), `VAMPIRE_THRALL_CONVERTED` (cleans up the ring + toasts "A thrall joins your dungeon"), `VAMPIRE_BLOOD_TAX_TICK` (draws a red core + pink halo line from the adv to the boss for 450 ms). New balance constants: `VAMPIRE_THRALL_ROAM_SWAP_MS`, `VAMPIRE_BLOOD_TAX_VFX_MIN_DMG`. **Patrolling-minion door re-lock (shipped 2026-05-02):** new `MinionAISystem._tickPatrollerDoors` runs at the end of every minion-AI tick. For each alive minion flagged as a patroller (`_isVampireThrall || _isDemonImp || _isHauntGhost`), it checks `dungeonGrid.getCpForDoorTile(tileX, tileY)`. On entering a fresh door tile it stores the cp on `m._doorPatLastCp` and snapshots `m._doorPatLockedSnapshot = !!cp.locked`, then calls `DungeonRenderer.openDoor(cp)` so the door visibly swings open during traversal. On stepping off the door tile it calls `DungeonRenderer.closeDoor(cp)` (which now mirrors to the paired cp on its own — matching `openDoor`'s behavior) and restores `cp.locked = true` if the snapshot recorded it. Behavior is generic — automatically benefits Vampire Thralls, Demon Imps, and Wraith Haunt Ghosts. Tracking state self-cleans on death/no-tag. |
| gnoll       | Gnoll Alpha      | **Hunters Pack** — boss room hosts a free `gnoll1` that respawns each day; +1 free gnoll per boss level up to a cap of 5; not counted toward minion cap; can still evolve normally. **Bloodlust** — every minion or boss kill adds +3% ATK to all gnolls for the rest of the day, no cap; resets at dawn; per-stack red flash + "+3% ATK" floater VFX | 1b.11 | ✅ DONE (2026-05-02) | **Hunters Pack:** added `gnoll` tag to gnoll1 + gnoll2 in minionTypes.json so the bloodlust check is robust. `BossArchetypeSystem._refillHuntersPack` runs at every NIGHT_PHASE_STARTED for the gnoll archetype: counts alive `_isHuntersPackGnoll` minions and spawns `min(GNOLL_HUNTERS_PACK_MAX=5, max(1, bossLevel)) - alive` extra gnoll1's via `createMinion` with `class: 'garrison'` (no minion-cap), arranged in a small ring around the boss-chamber center. Each pack member is stamped `_isHuntersPackGnoll: true`. Boss-level scaling applied. The same refill runs on `BOSS_LEVELED_UP` so a level-up immediately tops up the cap, and any active Bloodlust stack is re-applied to the new arrivals so they ATK-match the rest of the pack. Pack members evolve normally (gnoll1 → gnoll2 etc) since they're regular minions. **Bloodlust:** `_onAdvDied` gnoll branch detects when the `killerId` is `'boss'` or any live minion (excludes synthetic killers `unknown / venom / spores / fear`) and calls `_applyBloodlustStack`. That increments `gameState._gnoll.bloodlustStacks` (no cap) and re-derives every gnoll-tagged alive minion's `stats.attack = round(_baselineAttack × (1 + 0.03 × stacks))`. `_captureBloodlustBaselines` runs at NIGHT_PHASE_STARTED to stamp each gnoll's daily baseline; `_resetBloodlust` (also at NIGHT_PHASE_STARTED) wipes the stack count and restores each gnoll's ATK from `_baselineAttack`. `BossArchetypeUI` consumes `GNOLL_BLOODLUST_STACK` and paints, on every alive gnoll-tagged minion, a red ring flash + "+3% ATK" floater that drifts up and fades. New balance constants: `GNOLL_HUNTERS_PACK_MAX`, `GNOLL_BLOODLUST_PCT_PER_KILL`. |
| Migration   | Retire / unlock-gate the existing 15 archetypes | — | TBD | ✅ DONE (2026-04-28) | replaced wholesale; old archetype IDs gone, neutral defaults retained for backward-compat in modifier readers |
| Challenge-mode removal | NO TRAPS / ALL RAIDS / HARDCORE toggles dropped | — | — | ✅ DONE (2026-04-28) | runConfig field removed from ArchetypeSelect, BossSystem hardcoded to 3 lives, NightPhase trap palette no longer reads runConfig.noTraps, DayPhase guild-raid override gone |
| ArchetypeSelect re-skin | Existing carousel UI re-themed for 10 monster types | — | — | ✅ DONE (2026-04-28) | bestiary-book scene reads `bossArchetypes.json` directly; auto-updates whenever the JSON changes |

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

**Active pact pool (2026-05-02):** **64 pacts** (added pact_of_the_marionette + completed all UI polish from prior batches: LongGamePopup wired into HudScene, SunderedFloorRenderer for telegraph/pit visuals, CartographerOverlay for adv-path dots, Jester name-scramble in BuildMenu trap tab, right-click-trap Brand selection + gold halo in TrapRenderer, 'C' hotkey + two-click Crucible sacrifice flow in NightPhase. Marionette possession: click-to-possess + WASD + auto-attack + camera follow + MinionAISystem suppression of other dungeon minions while possessed; releases on minion death / NIGHT_PHASE_STARTED / DAY_PHASE_STARTED.) **63 pacts** — Phase 9 Batches A–H all shipped today. Original 13 (taxation_of_souls, bloodbound, gold_rush, undying_horde, sealed_paths, pack_synergy, blood_money, hasty_architect, great_erasure, schism, glory_hounds, sworn_rivals, famine_decree) + 50 new (Batch A: gilded_demise, pyramid_scheme, ransom_note, tax_the_living, tower_tax, crusaders_curse; Batch B: kennel_discipline, ironhide_rite, frenzy_pact, last_stand_doctrine, mage_hunt, vampires_toll; Batch C: tyrants_gaze, soul_tether, avengers_rite, final_breath; Batch D: false_maps, whispered_lies, open_book, whisperers_tongue; Batch E: doomsday_clock, the_long_game, inquisitors_mark; Batch F: summon_adds_i/ii/iii, drill_sergeant, endless_garrison, the_cull, trap_masons_touch, trapsmiths_guild, forbidden_workshop, architects_vision; Batch G: hellfire_breath, lightning_strike, shockwave_slam, spectral_reach, dark_vortex, soul_drain, doppelgangers, petrifying_stare; Batch H: cursed_soil, sundered_floor, pact_of_the_mirror, pact_of_the_cartographer, pact_of_the_jester, pact_of_the_whisperer, pact_of_the_brand, pact_of_the_reaper, pact_of_the_crucible). All entries have JSON defs, balance constants, handlers in DungeonMechanicSystem, and integration across AISystem/CombatSystem/MinionAISystem/BossSystem/TrapSystem/KnowledgeSystem/NightPhase/DayPhase. Each batch live-verified via `preview_eval`. **Deferred:** pact_of_the_marionette (possession system — own focused task). **Polish remaining:** Long Game popup (currently fade-banner), Cartographer path overlay, Jester BuildMenu name-scramble, Brand night-phase trap-selection UI, Crucible sacrifice UI, Sundered Floor pitch-black tile renderer. The 11 entries below marked 🚫 REMOVED were cut from the pact offering pool on 2026-05-02 at user request.

| ID | Name | Phase | Status | Notes |
|---|---|---|---|---|
| mimicry_plague | Mimicry Plague | 10 | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| taxation_of_souls | Taxation of Souls | 9 | ✅ DONE | ROOM_OBSERVED first-visit damage + 0.7× essence yield penalty |
| gravitational_anomaly | Gravitational Anomaly | 9 | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| cursed_fountains | Cursed Fountains | 9 | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| no_health_regeneration | No Health Regeneration | 9 | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| memory_fog | Memory Fog | 9 | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| eternal_night | Eternal Night | 9 | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| hunger | Hunger | 9 | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| bloodbound | Bloodbound | 9 | ✅ DONE | MinionAISystem.respawnAll filters dead permanently + CombatSystem 1.5× damage mult |
| gold_rush | Gold Rush | 9 | ✅ DONE | flag-only; AISystem essence yield 2× via MECHANIC_GOLD_RUSH_GOLD_MULT; +1 adv/day spawn modifier |
| undying_horde | Undying Horde | 9 | ✅ DONE | MINION_DIED 40% revive at half HP; flag prevents evolve, dies permanently next time |
| sealed_paths | Sealed Paths | 9 | ✅ DONE | AISystem flee path: 50% reroute back into dungeon; cornered-flee +25% damage |
| pack_synergy | Pack Synergy | 9 | ✅ DONE | flag-only; CombatSystem reads flag, +15%/ally-in-room cap +60% |
| blood_money | Blood Money | 9 | ✅ DONE | RESOURCES_AWARDED kill subscriber; +1 gold/night per lifetime kill; +2% adv HP per 5 kills |
| knowledge_is_pain | Knowledge is Pain | 9 | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| paranoia_protocol | Paranoia Protocol | 9b | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| spectral_reinforcements | Spectral Reinforcements | 9b | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| loot_curse | Loot Curse | 9 | 🚫 REMOVED 2026-05-02 | Cut from pact pool. |
| hasty_architect | The Hasty Architect | 9 | ✅ DONE | rare; flag-only activate; NightPhase._effectiveTrapCost applies 50% discount at validate/place + palette display; TrapSystem._fireTrap rolls 25% jam; BuildMenu shows discounted cost on trap slots |
| great_erasure | Pact of the Great Erasure | 9 | ✅ DONE | legendary; ADVENTURER_ENTERED_DUNGEON handler doubles hp/attack/speed; KnowledgeSystem._onAdventurerFled bails before survivor-record save when flag is set |
| schism | Schism | 9 | ✅ DONE | epic; ADVENTURER_ENTERED_DUNGEON nulls partyId + sets noFlee flag; AISystem._setFleeGoal returns on noFlee |
| glory_hounds | Glory Hounds | 9 | ✅ DONE | rare; ADVENTURER_ENTERED_DUNGEON sets noFlee; CombatSystem +50% adv damage when hpFrac <= 0.30 |
| sworn_rivals | Sworn Rivals | 9 | ✅ DONE | epic; ADVENTURER_ENTERED_DUNGEON pairs first two same-party arrivals via flags.swornRivalOf; AISystem combat fork attacks rival in melee when both <= 50% HP; CombatSystem +25% adv damage at full HP |
| famine_decree | Famine Decree | 9 | ✅ DONE | rare; flag-only; CombatSystem scales adv damage by hpFrac (1.5× at 100%, 0.5× below 50%) |
| End-of-day mechanic offering UI | — | 9 | ✅ DONE | EndOfDay scene shows 3 cards filtered by archetype + dungeon level |
| Tradeoff display in offering UI | — | 9 | ✅ DONE | Each card shows tradeoffDescription in gold italic |
| 💭 Many more mechanics | — | 9–10 | 💭 OPEN | aim ≥30 by 1.0; current pool: 13 |

---

## 6. Dungeon room types

**Note (2026-04-30):** The original 9-room design list and the Phase-2/QW additions were **superseded by the Room redesign 2026-04-30** in DESIGN.md. The new spec defines 21 rooms organized around gateway/cap/scaling rules. Existing handler code for removed rooms remains in place as orphaned no-ops; cleanup is a follow-up phase.

### 6a. Required / Fixed

| ID | Name | Cap | Unlock | Phase | Status | Notes |
|---|---|---|---|---|---|---|
| boss_chamber | Boss Chamber | 1 (fixed) | Start | 2 | ✅ DONE | fixed centerpiece, kept |
| entry_hall | Entry Hall | 1 | Start | 3 | ✅ DONE | required entrance, kept |

### 6b. Starter (free, L1)

| ID | Name | Cap | Unlock | Phase | Status | Notes |
|---|---|---|---|---|---|---|
| starter_corridor | Corridor | scales 2→20 (+2/level) | L1, free | 2 | 🟡 PARTIAL | Data restored 2026-04-30; cap-scaling-by-level pending implementation |
| starter_barracks | Barracks | scales 1→5 | L1, free | 2 | 🟡 PARTIAL | Data exists with sneakable behavior; cap=1 currently, scaling 1→5 + roster minion slot system pending |
| starter_guard_post | Guard Post | unlimited | L1 | TBD | ⏳ PENDING | Currently no behavior; needs door-connected hunt-and-return logic |

### 6c. New rooms — Room redesign 2026-04-30

| ID | Name | Cap | Unlock | Phase | Status | Notes |
|---|---|---|---|---|---|---|
| crypt | Crypt | 3 | L2 | TBD | 🟡 PARTIAL | Data exists; needs rework to spawn 4 garrison Risen Bones (room-bound, refill nightly) |
| trap_factory | Trap Factory | scales 1→5 | L3 | TBD | ⏳ PENDING | Gateway: each Factory adds +5 trap slots to global pool; no upgrade tree |
| treasury | Treasury | scales 1→5 | L3 | TBD | ⏳ PENDING | Daily essence stipend + 4 chests (alive-exit-required theft); raises adventurer arrival rate |
| armory | Armory | scales 1→3 | L3 | 🟡 PARTIAL | Data + adjacent-buff exists; needs cap-scaling |
| library_of_whispers | Library of Whispers | 1 | L4 | TBD | ⏳ PENDING | Tier scales: L4 size+classes, L6 +personalities, L8 +stats/equipment, L10 +planned route |
| watchtower | Watchtower | 2 | L5 | TBD | ⏳ PENDING | Adjacent rooms get first-strike on adventurer entry |
| wandering_gate | Wandering Gate | 1 | L6 | TBD | ⏳ PENDING | Teleport on entry: 60% nearby room / 35% any built room / 5% Boss Chamber |
| veil_of_forgetting | Veil of Forgetting | 1 | L6 | TBD | ⏳ PENDING | Each Night Phase erases adventurer intel of door-connected rooms |
| catacombs | Catacombs | 2 | L7 | TBD | ⏳ PENDING | Reactive: adventurer death-here spawns Tier-2 Revenant (garrison); cap 2 alive in room |
| mimic_vault | Mimic Vault | 1 | L7 | TBD | ✅ DONE | Disguised as Treasury; 2 chest-disguised mimics (`isMimic: true, mimicState: 'chest'`) per night. RoomBehaviorSystem._rollMimicOpens fires on ADVENTURER_ROOM_CHANGED — 40% open chance unknown / 5% known. _revealMimic flips state, applies 30% max-HP bite, marks knowledge for the whole live party. KnowledgeSystem.sharedPool.mimics propagates next-day. MinionRenderer paints chest sprite while in chest state. |
| hall_of_trials | Hall of Trials | scales 1→3 | L7 | TBD | ⏳ PENDING | Random T2 evolved minion (garrison) spawns nightly if none alive |
| wishing_well | Wishing Well | 1 | L8 | TBD | ⏳ PENDING | Coin flip on entry: heads buff adv / tails Marked debuff (+50% dmg from minions, skull icon) |
| false_exit | False Exit | 1 | L8 | QW | 🟡 PARTIAL | Data exists with teleport behavior; needs rework: own entry door + flee-target bias + teleport-on-leave to random built room |
| hall_of_madness | Hall of Madness | 1 | L9 | TBD | ⏳ PENDING | % chance for adventurers to attack each other; needs new AI state (heavy lift) |
| throne_room | Throne Room | scales 1→2 | L9 | TBD | ⏳ PENDING | 1 Mini-Boss (garrison, room-bound) per room; scales T1→T2→T3; no other minions allowed |
| sanctum | Sanctum | 1 | L10 (capstone) | TBD | ⏳ PENDING | Boss HP regen between fights; aura regens minions in door-connected rooms |

### 6d. Top-level rules (Room redesign 2026-04-30)

| Rule | Phase | Status | Notes |
|---|---|---|---|
| Roster vs Garrison minion split | TBD | ⏳ PENDING | Barracks → roster (count to cap, mobile). Every other spawner → garrison (room-bound, no cap). Needs minion-class flag + AI gating |
| "Adjacent / connected" = direct shared door | TBD | ⏳ PENDING | Not transitive through corridors; many room effects depend on this |
| Alive-exit-required for chest/loot theft | TBD | ⏳ PENDING | Treasury + Mimic Vault: adventurer must escape with the chest or it returns |
| Cap scaling by boss level | TBD | ⏳ PENDING | Per the cap-scaling table in DESIGN.md → Room redesign |
| Boss level cap = 10 | TBD | ⏳ PENDING | Existing system caps differently; needs realignment |

### 6e. Removed (data deletion 2026-04-30, handler cleanup deferred)

| ID | Name | Phase | Status | Notes |
|---|---|---|---|---|
| hall_of_echoes | Hall of Echoes | 3 | 🚫 REMOVED 2026-04-30 | data deleted; AISystem sound-alert handler orphaned, cleanup later |
| treasure_room | Treasure Room | 3 | 🚫 REMOVED 2026-04-30 | superseded by Treasury; loot/raid logic orphaned |
| healing_fountain | Healing Fountain | 3 | 🚫 REMOVED 2026-04-30 | data deleted; heal-on-stand handler orphaned |
| necropolis_wing | Necropolis Wing | QW | 🚫 REMOVED 2026-04-30 | user explicitly removed from spec; RoomBehaviorSystem._onNightStart corpse-raise orphaned |
| colosseum | Colosseum | QW | 🚫 REMOVED 2026-04-30 | gate-lock + wave-spawn handler orphaned |
| mirror_maze | Mirror Maze | 8b | 🚫 REMOVED 2026-04-30 | KnowledgeSystem MIRROR_MAZE_KNOWLEDGE_ACCURACY orphaned |
| obelisk_room | Obelisk Room | QW | 🚫 REMOVED 2026-04-30 | heal/charge dual-state handler orphaned |
| trap_room | Trap Room | 3 | 🚫 REMOVED 2026-04-30 | superseded by Trap Factory + slot model |
| prison_block | Prison Block | QW | 🚫 REMOVED 2026-04-30 | detain handler orphaned |
| serpent_pit | Serpent Pit | QW | 🚫 REMOVED 2026-04-30 | poison-tick handler orphaned; may return as a trap |
| lava_floor | Lava Floor | 6+ | 🚫 REMOVED 2026-04-30 | hazard rooms dropped; revisit as trap later |
| collapsing_pillars | Collapsing Pillars | 6+ | 🚫 REMOVED 2026-04-30 | hazard rooms dropped; revisit as trap later |
| secret_passage | Secret Passage | 6+ | 🚫 REMOVED 2026-04-30 | not in new spec |
| power_core | Power Core | 6+ | 🚫 REMOVED 2026-04-30 | superseded by per-Trap-Factory slot model |

### 6f. Open-ended

| Item | Phase | Status |
|---|---|---|
| 💭 More room types beyond the 21 | 6–10+ | 💭 OPEN |

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
| torch_trap | Torch Trap | QW | ⏳ PENDING | `requiresEternalNight` gate removed 2026-05-02 when eternal_night pact was cut; trap definition not yet added to trapTypes.json — needs a new gate condition or redesign |
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
| Boss evolution tree (XP-spent abilities) | 10b | ✅ DONE | bossAbilities.json with 6 nodes (3 tiers); BossSystem.unlockAbility ~~spends Dark Power~~ (Dark Power retired 2026-05-05 — currency layer needs a follow-up pass to switch to Gold or remove the cost), requires-chain enforced; EndOfDay BOSS UPGRADES modal |
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
| Soul Essence (upkeep currency) | 1 | ✅ DONE | renamed to Gold display-side; field still `gameState.player.soulEssence` |
| Dark Power (upgrade currency) | 1 | 🚫 REMOVED 2026-05-05 | currency retired; only Gold remains. `gameState.player.darkPower` may still appear in stale code paths (GameOver.js leaderboard submit, run.totals.souls) — those default to 0 / harmless |
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
| Adventurer level scales with boss level | 7b | ✅ DONE — +10% maxHp, +7% attack per boss level above 1 (applied in DayPhase spawn via ADVENTURER_HP_PER_BOSS_LV / ADVENTURER_ATK_PER_BOSS_LV) |
| Boss level progression (rooms unlock, minions scale) | 7b | ✅ DONE — Boss owns level/xp/xpToNext (moved from meta). Each kill awards BOSS_XP_PER_KILL (10) XP; levels up at curve 100×1.5^(lv-1). Cap 10. BOSS_LEVELED_UP event expands grid + retroactively scales all live minions (+10% HP / +7% ATK per level). Replaces dungeon-level system (2026-05-01). |
| Minions scale with boss level | — | ✅ DONE — applyBossLevelToMinion() applied at spawn, on evolution reset, and retroactively on BOSS_LEVELED_UP. Same +10% HP / +7% ATK curve as adventurers. |
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
| 9 — Dungeon Mechanics (kernel) | DungeonMechanicSystem, EndOfDay scene, newspaper, **64 active pact definitions** across 5 rarity tiers (common/uncommon/rare/epic/legendary). Tier-first weighted draw via TIER_WEIGHTS in _weightedSample (45/25/15/10/5). DarkPactPopup shows rarity tags with shine animations on rare/epic/legendary. | ✅ DONE |
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

## 31. UI / HUD overhaul (2026-05-01)

> See DESIGN.md → "UI / HUD overhaul (2026-05-01)" for the full spec.
> Net new visual system + scene rework + data plumbing for run history. Bestiary boss picker (ArchetypeSelect) is intentionally untouched. All popups land as in-scene UI groups on HudScene, not separate Phaser scenes.

| ID | Item | Phase | Status | Notes |
|---|---|---|---|---|
| ui-fonts | Press Start 2P + VT323 fonts loaded (Google Fonts) | 31A | ✅ DONE | Boot.js / index.html link tag |
| ui-theme | Crypt theme palette constants in UIKit (cool stone gray + blood red `#b03a48` + soul cyan `#6fd8d8`) | 31A | ✅ DONE | distinct from reverted Dark Codex parchment/gold |
| ui-pixel-panel | Pixel-bevel panel primitive (2px hl/sh + 2px black outer outline, hard pixels) | 31A | ✅ DONE | extends UIKit alongside existing glowPanel; added not replaced during overhaul |
| ui-pixel-button | Pixel button primitive incl. primary variant + hover/active states | 31A | ✅ DONE | UIKit |
| ui-build-slot | BuildSlot card component (icon + name + cost, selected ring) | 31A | ✅ DONE | UIKit |
| ui-bar | Themed pixel HP/progress bar w/ inset highlights + label overlay | 31A | ✅ DONE | UIKit |
| ui-tabs | 4-tab strip primitive (active accent fill) | 31A | ✅ DONE | UIKit |
| ui-log-row | Type-coded log row (kill/dmg/warn/know border + color) | 31A | ✅ DONE | extends CombatLog |
| title-screen | MainMenu rewrite — split-screen Variant A: cinematic dungeon left, run-readout menu panel right, 6-button menu | 31B | ✅ DONE | replaces ~911 lines |
| title-continue | CONTINUE menu action — resume active run | 31B | ✅ DONE | wires existing save load |
| title-new-evil | NEW EVIL menu action — opens existing ArchetypeSelect (bestiary) | 31B | ✅ DONE | preserves ArchetypeSelect untouched |
| title-archive | DUNGEON ARCHIVE — leaderboard stub button, no-op | 31B | ✅ DONE | future leaderboard hook |
| title-options | OPTIONS — opens new Options scene | 31B | ✅ DONE | depends on options-scene |
| title-quit | QUIT — closes the game | 31B | ✅ DONE | |
| hud-topbar | HUD top bar: boss avatar + class/day + HP bar (left), wave counter + bar (center), Gold ~~+ Dark Power~~ (right) | 31C | ✅ DONE | replaces BossHpPanel; clicking avatar opens Boss Overview. *(2026-05-05: Dark Power readout removed — Treasury panel now shows Gold only. See `BossTopBar._buildRightCol`.)* |
| hud-resources | "Gold" rename of Soul Essence (display only) ~~+ Dark Power readout~~ | 31C | 🟡 PARTIAL | Gold rename live; Dark Power readout was removed when the currency was retired 2026-05-05. |
| hud-minimap | Mini-map panel — restyled with pixel chrome (data layer unchanged) | 31C | ✅ DONE | reuses MiniMap |
| hud-build-menu | Build menu (left column, locked): tabs Rooms/Minions/Traps/Items, 2-col grid | 31C | ✅ DONE | replaces existing NightPhase palette |
| hud-build-items-stub | ITEMS tab renders empty grid + "Coming soon" caption | 31C | ✅ DONE | placeholder |
| hud-knowledge-pin | Knowledge Pin panel (right column, always visible): top 3–4 leaks + EXPOSURE bar | 31C | ✅ DONE | summary view of existing KnowledgeSystem data |
| hud-dungeon-log | Dungeon Log (renamed from Combat Log, right column, always visible) — type-coded entries | 31C | ✅ DONE | rename + type tags on existing CombatLog |
| hud-action-bar | Bottom action bar: Rotate / Move / Sell / Roster / phase indicator / Begin Day / Knowledge / Adventurer Intel / Menu | 31C | ✅ DONE | replaces design "Repair" with "Roster" |
| hud-overlay-strip | Dungeon scene overlay top-left: LEVEL / ROOMS / MINIONS counts | 31C | ✅ DONE | |
| hud-placing-caption | Bottom-left "PLACING …" caption when build slot selected | 31C | ✅ DONE | |
| build-action-rotate | Rotate action via R key while a room is held in MOVE mode (button dropped from action bar mid-phase per user). 90° CW, minions follow. | 31D | ✅ DONE | scope-changed during 31D — was an action-bar button, now an R-key affordance during MOVE pickup; existing R-on-placement behaviour covers it |
| build-action-move | Move action: button → click room → cursor-follow → click drop, minions stay, free | 31D | ✅ DONE | new gameplay action |
| build-action-sell | Sell action: button → click room → 50% gold refund (room cost + minion costs in room), removes room + minions | 31D | ✅ DONE | new gameplay action |
| build-action-sell-minion | Sell action also accepts a single minion: 50% gold refund of that minion's cost, room stays | 31D | ⏳ PENDING | extension of build-action-sell |
| popup-adv-intel | Adventurer Intel popup — opened from HUD button any phase, shows current/incoming party | 31E | ✅ DONE | renamed from "Pre-Wave Prep" |
| popup-adv-intel-library | Library room masks `???` fields on incoming party UNLESS Library room exists in dungeon | 31E | ✅ DONE | new Library role; gates intel reveal |
| popup-adv-intel-knowmap | Adventurer Intel shows the adventurers' knowledge map (replaces design's predicted route) | 31E | ✅ DONE | reuses KnowledgeSystem |
| popup-boss-overview | Boss Overview popup — opened by clicking boss avatar in top bar | 31E | ✅ DONE | new |
| popup-boss-ability | Boss Overview displays the boss's unique ability (per `bossAbilities.json`) | 31E | ✅ DONE | UI slot only — full ability impl deferred per archetype |
| popup-boss-pacts | Active Pacts grid in Boss Overview | 31E | ✅ DONE | depends on pact-history field |
| popup-boss-census | Dungeon Census tile in Boss Overview (rooms/minions/traps/items/doors/paths) | 31E | ✅ DONE | counts derived live from gameState |
| popup-minion-roster | Minion Roster popup — opened from action-bar Roster button, info-only (no summon/heal/reassign) | 31E | ✅ DONE | new |
| popup-minion-detail | Roster detail pane — selected minion sprite + class + name + assignment + HP + kills/dmg/armor/speed + traits | 31E | ✅ DONE | |
| popup-knowledge-map | Knowledge Map popup — opened from action-bar Knowledge button, replaces full-screen KnowledgeScreen | 31E | ✅ DONE | UI rewrite, data layer reused |
| popup-knowledge-leaker | Intel Ledger shows `via {adventurerName} (esc Day N)` per fact | 31E | ✅ DONE | requires KnowledgeSystem to surface leaker per fact |
| popup-postwave | Post-Wave Summary popup: Casualties + Resources Earned + Dungeon Performance, Continue button | 31F | ✅ DONE | splits existing EndOfDay |
| popup-darkpact | Dark Pact popup — 3 cards, Reroll All (1×) + Seal the Pact, no skip | 31F | ✅ DONE | level-gated |
| popup-darkpact-gating | Dark Pact only shown when boss leveled up that day; otherwise skip to night | 31F | ✅ DONE | new gating rule |
| popup-darkpact-reroll | Reroll All button replaces all 3 offerings once, then disables | 31F | ✅ DONE | extends DungeonMechanicSystem |
| pause-menu-redesign | PauseMenu redesigned in pixel-bevel style; entry point moved to action-bar Menu (ESC still works) | 31G | ✅ DONE | restyled, same options |
| options-scene | New Options scene — audio volumes (master/music/SFX), graphics toggles, keyboard ref. Skeleton ships even with stubs. | 31G | ✅ DONE | reachable from title menu OPTIONS |
| gameover-rewrite | Game Over rewrite: header "DUNGEON FALLEN" + Final Tally + Pacts Sealed + Built · Lost panels | 31H | ✅ DONE | replaces existing GameOver.js |
| gameover-anim | Game Over animation: staggered fade-in + integer count-up per row, ~6–8s total, any key skips | 31H | ✅ DONE | sound hook reserved |
| history-pacts | `gameState.history.pacts: [{day, mechanicId, rarity}]` — appended on Dark Pact seal | 31I | ✅ DONE | new gamestate field |
| history-minion-lifetime | Per-minion `lifetime: { kills, damageDealt }` | 31I | ✅ DONE | grep first; add only if missing |
| history-adv-escapecount | Per-adventurer `escapeCount` to derive "biggest leak" | 31I | ✅ DONE | grep first; add only if missing |
| history-run-totals | Per-day `gameState.run.totals` rolling counters: kills, dmgDealt, dmgTaken, advsKilled, advsEscaped, gold, souls, roomsBuilt, roomsDestroyed, minionsSummoned, minionsLost, trapsPlaced, trapsDisarmed | 31I | ✅ DONE | SaveSystem serializes |
| save-compat | SaveSystem rehydrates the new history fields cleanly on old saves (defaults to empty arrays / 0s) | 31I | ✅ DONE | back-compat |
| design-handoff-bundle | Local copy of design bundle preserved in `qf_design_temp/` for reference during build | — | ✅ DONE | unzipped from Claude Design handoff |

---

## 32. Adventurer emote bubbles (2026-05-01)

| ID | Item | Phase | Status | Notes |
|---|---|---|---|---|
| emote-assets | Copy 60 emote PNGs from staging into `assets/sprites/emotes/`; each is 96×32 with three 32×32 frames | 32 | ✅ DONE | filenames map to triggers |
| emote-preload | Register emote spritesheets in Preload.js; build a manifest mapping triggerId → variant texture keys | 32 | ✅ DONE | catalog lives in EmoteSystem.js, Preload imports `allEmoteVariants` |
| emote-system | `EmoteSystem.js` — subscribes to trigger events, rolls 20% chance, attaches sprite to adv container at y≈-52, plays once, destroys | 32 | ✅ DONE | per-adv cooldown 1500ms; priority replaces lower/equal |
| emote-trigger-random | Ambient `random_exploring` roll while walking (~6–10s window, 20% chance) | 32 | ✅ DONE | low priority — never overrides state emote |
| emote-trigger-rooms | Hook `ROOM_OBSERVED` — `firstVisit:true` → discovered/unknown pool; `firstVisit:false` → known-room pool | 32 | ✅ DONE | KnowledgeSystem already emits both flavors |
| emote-trigger-combat | Hook fighting state transition → `fighting + found minion + class-specific` pool, filtered by classId | 32 | ✅ DONE | tracked via aiState change in update tick |
| emote-trigger-flee | Hook fleeing state / `ADVENTURER_FLED` → fleeing pool | 32 | ✅ DONE | aiState/`goal.type === FLEE` edge-trigger |
| emote-trigger-low-hp | Hook HP fraction crossing below 30% → low_health pool | 32 | ✅ DONE | edge-trigger only |
| emote-trigger-loot | Hook `MIMIC_REVEAL_TRIGGERED` and `TREASURY_CHEST_GRAB_STARTED` → found_loot pool | 32 | ✅ DONE | gear pickup deprecated |
| emote-trigger-trap | Hook `TRAP_TRIGGERED` → found_something pool | 32 | ✅ DONE | |
| emote-trigger-boss | Hook `BOSS_FIGHT_INCOMING` → entered_boss_room | 32 | ✅ DONE | |
| emote-trigger-tame | Hook `MINION_TAMED` → tame_success | 32 | ✅ DONE | |
| emote-trigger-resurrect | Hook `ADVENTURER_RESURRECTED` → resurrected | 32 | ✅ DONE | |
| emote-trigger-doors | `breaking down door*` and `finding a locked door` triggers | — | ⏳ PENDING | DEFERRED — no locked-door event in code yet |

---

## 33. Dungeon events (2026-05-05)

> See DESIGN.md → "Dungeon events" for full per-event spec. All events are pre-announced during the night phase before the day they fire (Dark Deal + Loot Goblin Heist resolve during the night phase itself).

| ID | Item | Phase | Status | Notes |
|---|---|---|---|---|
| event-system | `EventSystem` — schedule + roll engine, event registry, night-phase notification banner, JSON-driven event definitions in `src/data/events.json` | EV | ⏳ PENDING | **Cadence: 1 event every 6–8 days. Same event cannot fire back-to-back. Speed Runner / Tournament / Rival Dungeon gated to boss level ≥ 3.** |
| event-guild-raid | Guild Raid! — next day spawns 2× adventurers as steady pressure (longer wave, not one-shot surge) | EV | ⏳ PENDING | |
| event-legendary-speedrunner | Legendary Speed Runner — single 2× stats / 2× speed adventurer, ignores non-essential rooms + minions, beelines to boss; killing them grants massive boss XP | EV | ⏳ PENDING | Boss level ≥ 3. Name intentionally fourth-wall-breaking. Pathfind: shortest path to boss room, only engages chokepoint-required minions. |
| event-pestilence | Dungeon Pestilence — minions start day at 50% HP; melee with adventurer applies "Blighted" DoT until they die or leave; affects existing + newly-placed minions; Blight does NOT persist after adv leaves | EV | ⏳ PENDING | Adds new status: `blighted` on adventurer entity. |
| event-cartographers | Cartographer's Convention — 3 scholar adventurers visit every non-boss room then leave; each room they map raises that room's "infamy" so future advs spawn with that knowledge | EV | ⏳ PENDING | New per-room `infamy` field; KnowledgeSystem reads on adv spawn. AI: visit-all goal type. |
| event-cartographer-sprites | 3 LPC scholar adventurers (with glasses) for the Cartographer event | EV | ⏳ PENDING | Content task — uses existing LPC pipeline. |
| event-blood-moon | Blood Moon Eclipse — minions deal 2× damage AND take 2× damage; no gold from killed adventurers | EV | ⏳ PENDING | |
| event-negotiation | Negotiation Day — non-combat. Modal at start of day: pay 25% treasury (free day) OR refuse (next day +50% wave size) | EV | ⏳ PENDING | New popup component. Decision persists into following days' adv counts. |
| event-tournament | The Tournament — 3 named rivals enter, hostile to each other AND the dungeon; sabotage each other's loot, body-block, attack each other when in same room | EV | ⏳ PENDING | Boss level ≥ 3. New AI sub-state: `rival_competitive`. Damage between adventurers is new infrastructure. |
| event-rival-dungeon | Rival Dungeon — instead of adventurers, a group of random monsters enters; final entrant is a random boss from the boss pool that fights the player's boss; killing it grants big XP + gold | EV | ⏳ PENDING | Boss level ≥ 3. Reuses boss roster as enemy spawns. **Rival boss uses simple AI — basic chase + attack, NOT full BossArchetypeSystem behaviors.** |
| event-twitch-con | Twitch Con — entire next wave is `twitch_streamer` class adventurers; killing them does NOT trigger the usual escalation/+adventurers-next-day penalty | EV | ⏳ PENDING | Class already exists in `adventurerClasses.json`. |
| event-dark-deal | Dark Deal — demon appears in boss room during NIGHT phase, offers a free dark pact; if accepted, boss max HP halved for next day; if ignored, demon leaves with no penalty. Click demon to engage. | EV | ⏳ PENDING | Asset: `assets/!To do/Demon.png` — 4-row sheet (rows 1-2 appearing, rows 3-4 leaving). Spawns sprite into boss room scene + click handler + pact picker reuse. |
| event-cosplay-contest | Cosplay Contest — adventurers in monster outfits; do not attack minions unless attacked first; 75% chance to walk past minions ignoring them | EV | ⏳ PENDING | Adv AI variant: passive-pass behavior, retaliation flag. |
| event-cosplay-sprites | New LPC adventurer variants wearing animal/monster parts (zombie, skeleton, tails, wings, fantasy, beastman, farm animal, furry, undead, reptilian) — colored correctly per part theme | EV | ⏳ PENDING | Content task. Reptilian = green, etc. |
| event-loot-goblin-heist | Loot Goblin Heist — goblins spawn in BOSS ROOM (reverse direction) and run for the dungeon exit; each kill drops large gold; goblins never stop to fight, only flee. **Each goblin that escapes steals 10% of current gold total** (per goblin, applied at exit) | EV | ⏳ PENDING | New spawn-point: boss room. New AI: pure-flee-to-exit goal (no engagement). Gold-drain stacks per escapee. |

---

## How to keep this file honest

- **At every phase exit**: update statuses for items tagged in that phase. If a row is still PENDING or PARTIAL when the phase ends, either fix it or get explicit user approval to defer.
- **When the user adds new design items**: add them here with phase + status before implementing.
- **Open-ended (💭) items**: track running counts in the relevant section (e.g. "12/30 mechanics shipped").
- **When implementation differs from design**: don't silently rewrite this file — flag the divergence to the user and update DESIGN.md if they approve.

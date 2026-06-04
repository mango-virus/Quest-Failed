# Quest Failed — Game Design Sheet

> **This is FROZEN DESIGN INTENT / history — not a current-state reference.** It is the
> player/designer's original brief, preserved verbatim (including ~~struck-through~~ entries
> that record what was cut and why). It is the source of truth for **what the game is meant to
> include and why**; on questions of *design intent*, this file wins — update the others.
>
> It is **NOT** the place to learn what's currently built. For "what actually exists right now"
> (live counts, what's done vs. stubbed), read **`STATUS.md`** — and ultimately the code, which
> is the real source of truth for current state. Every deliverable here is tracked in
> `DESIGN_COVERAGE.md` with a phase + status (reconciled against code 2026-05-31).

---

## Core concept

As the boss I want to be able to place traps, monsters, minions, mini bosses, hidden keys, locked doors, loot, and other stuff to try and prevent the adventurer from reaching the boss room. The dungeon grid should be fixed tile size placement where every room snaps to a slot.

Rooms connect to each other directly through their doorways — when you place a room near another, it auto-aligns so a doorway on one room sits next to a facing doorway on the other. There are no auto-routed corridor segments drawn between rooms. **Corridors are a placeable room type** (see room roster) used to extend reach between rooms; adventurers walk through them like any other room. (deviation noted: original prototype had auto-routed drawable corridor segments — replaced with doorway-snap placement plus a placeable Corridor room so every cell of the dungeon is meaningful gameplay space.)

The game should work in days and be endless. Meaning that each day during the day phase, adventures should enter the dungeon solo, with a small party, large party, or a full on raid group. I want adventurers to have different personalities that change how they tackle the dungeon. They also can choose to either fight through the dungeon if they think they can beat it, leave the dungeon for the day to return another day, or sleep in the dungeon to heal up so they can continue to fight through it the next day. During the night phase, I can build out the dungeon, add traps rooms, minions, mini bosses, loot to lure adventurers and more. When I am satisfied I can choose to move to the next day phase.

---

## Knowledge system

I want adventurers to be able to learn the dungeon, the enemies, traps, rooms, and so on and use this knowledge to their advantage. An adventurer without knowledge will enter it "blind" and learn as they go. If an adventurer leaves the dungeon, he can share knowledge of the dungeon for specific rooms or minions or traps or treasure he saw. He shares that with other adventurers that can enter the dungeon and adapt to the knowledge they gained. Avoiding traps, certain minions or mini bosses, taking specific paths to avoid dangers. Sometimes the knowledge is accurate, and sometimes its completely wrong. Sometimes that adventurer should return leading a party the next time he returns, with all of their party knowing what he knows from his last visit to the dungeon.

### Returning veterans — labelled "Heroes" in-game (2026-05-20)

When a fled adventurer personally returns leading a party, it should be a noticeable moment, not a silent re-spawn. The player-facing label for these returnees is **"Hero"** (the underlying mechanic is still the returning-survivor system; the in-game wording was changed to "Hero" on 2026-05-20 — internal identifiers like `returningVeteran` are unchanged).

- **Notification** — the player is alerted that a Hero is incoming.
- **A little stronger** — Heroes are tougher and hit a bit harder than a normal adventurer of the same wave (they survived the dungeon once already).
- **Worth double gold** — killing a Hero pays out twice the normal kill gold.
- **Visually distinct** — Heroes look obviously different (a gold aura ring + "★ HERO" badge) so the player can pick them out of a party at a glance.

---

## Dungeon mechanics (end-of-day choice)

If all the adventures have been killed, or decided to leave the dungeon because they don't think they will survive. I want me (the boss) to get a choice at the end of each day provided to me to change the mechanics, and other stuff about the dungeon so that the dungeon can change in certain ways, making the adventurers have to come up with new strategies to beat my dungeon. These choices should be called "Dungeon Mechanics" and should sometimes come with a strategic trade-off. Here are some examples:

1. ~~**Mimicry Plague** = 20% of all loot chests have a chance to be a Mimic when opened by an adventurer. Trade-off: mimics count as minions, so adventurers killing them gain XP from them~~ *(REMOVED 2026-05-02 — cut from pact pool)*
2. **Taxation of Souls** = Adventurers lose 5% HP when entering a new room. Trade-Off: You gain less XP from killing them because they were already weakened.
3. ~~**Gravitational Anomaly** = Projectiles move 50% slower; melee deals 20% more damage. Trade-Off: Great against Rangers/Mages, but makes your melee Minions vulnerable.~~ *(REMOVED 2026-05-02 — cut from pact pool)*
4. ~~**Cursed Fountains** = turns the water in healing fountain rooms into acid to damage adventurers instead of heal them.~~ *(REMOVED 2026-05-02 — cut from pact pool)*
5. ~~**No Health Regeneration** = Adventurers cannot heal while sleeping~~ *(REMOVED 2026-05-02 — cut from pact pool)*
6. ~~**Memory Fog** = adventurers who sleep in the dungeon forget 50% of what they learned. Trade-off: they heal faster.~~ *(REMOVED 2026-05-02 — cut from pact pool)*
7. ~~**Eternal Night** = adventurers can't see past 1 room. Trade-off: your minions also have reduced patrol range~~ *(REMOVED 2026-05-02 — cut from pact pool)*
8. ~~**Hunger** = adventurers lose 1 HP per minute in the dungeon. Trade-off: ?~~ *(REMOVED 2026-05-02 — cut from pact pool)*
9. **Bloodbound** = your minions deal +50% damage but die permanently (no respawn) instead of regenerating overnight
10. ~~**Knowledge is Pain** = Adventurers take +10% damage in rooms they've already cleared. The more they know, the more the dungeon resists them. Directly punishes returning experienced adventurers. Trade-off: First-timers are completely unaffected. Guilds start sending fresh rookies first to scout instead of their veterans.~~ *(REMOVED 2026-05-02 — cut from pact pool)*
11. ~~**Paranoia Protocol** = All chests, doors, and fountains have a visible 10% chance indicator — whether or not they're actually trapped. Adventurers see "10%" on everything, even safe objects. The uncertainty is the trap. Trade off: ?~~ *(REMOVED 2026-05-02 — cut from pact pool)*
12. ~~**Spectral Reinforcements** = Ghosts of previously killed adventurers appear as hostile phantoms in the rooms where they died. They fight with the abilities they had when they died. Rooms with high kill counts become haunted gauntlets. Trade-off: Spectral adventurers deal spirit damage that also affects your living minions. Rooms with many ghosts become chaotic for everyone.~~ *(REMOVED 2026-05-02 — cut from pact pool)*
13. ~~**Loot Curse** = All loot dropped in the dungeon is cursed. Adventurers who pick it up gain the stat bonus but also a hidden debuff that worsens over time. They don't know until it's too late. Trade-off: The curse can be cleansed by a cleric. If there's a cleric in the party, this mechanic is neutralized entirely. Also, Greedy adventurers hoard cursed loot faster.~~ *(REMOVED 2026-05-02 — cut from pact pool)*
14. **The Hasty Architect** = During the Night Phase, you receive a 50% discount on traps. Trade-off: All traps have a 25% chance to fail or jam when triggered/engaged.
15. **Pact of the Great Erasure** = Adventurers retain zero knowledge of the dungeon upon escaping. Trade-off: Adventurers have 2× Base Stats (Health, Damage, Speed).
16. **Schism** = Adventurer parties splinter on entry — every adventurer paths solo, with no party loyalty, no healing, no shared buffs. Trade-off: Solo adventurers never flee. They fight to the death.
17. **Glory Hounds** = Adventurers refuse to retreat — they fight on no matter how wounded they are. Trade-off: Adventurers below 30% HP deal +50% damage.
18. **Sworn Rivals** = Two adventurers in each party are bound as sworn rivals. When both fall below half HP, they break formation and attack each other on sight. Trade-off: While both rivals are at full HP, each one deals +25% damage.
19. **Famine Decree** = Adventurers at less than half HP deal −50% damage. Wound them and they wither. Trade-off: Adventurers at full HP deal +50% damage. Fresh-faced parties hit like trucks.

**Active pact pool (after 2026-05-02 additions):** Taxation of Souls (#2), Bloodbound (#9), The Hasty Architect (#14), Pact of the Great Erasure (#15), Schism (#16), Glory Hounds (#17), Sworn Rivals (#18), Famine Decree (#19). Also in the offering JSON but not on this numbered list: Gold Rush, Undying Horde, Sealed Paths, Pack Synergy, Blood Money. The 11 struck-through entries above were cut from the pact pool — their handlers may still have residual code that needs cleanup.

### 2026-05-02 expansion — 50 new pacts added (Batches A–H)

**Batch A — economy / adventurer behavior:** Gilded Demise, Pyramid Scheme, Ransom Note, Tax the Living, Tower Tax, Crusader's Curse.

**Batch B — minion + combat:** Kennel Discipline, Ironhide Rite, Frenzy Pact, Last Stand Doctrine, Mage Hunt, Vampire's Toll.

**Batch C — boss-personal:** Tyrant's Gaze, Soul Tether, Avenger's Rite, Final Breath.

**Batch D — knowledge:** False Maps, Whispered Lies, Open Book, Whisperer's Tongue.

**Batch E — timed/scheduled:** Doomsday Clock, The Long Game, Inquisitor's Mark.

**Batch F — summon adds + max-slot pacts:** Summon Adds I/II/III, Drill Sergeant, Endless Garrison, The Cull, Trap Mason's Touch, Trapsmith's Guild, Forbidden Workshop, Architect's Vision.

**Batch G — boss-attack pacts (auto-cast in boss fight, with VFX events):** Hellfire Breath, Lightning Strike, Shockwave Slam, Spectral Reach, Dark Vortex, Soul Drain, Doppelgangers, Petrifying Stare.

**Batch H — unique mechanics:** Cursed Soil, Sundered Floor, Pact of the Mirror, Pact of the Cartographer, Pact of the Jester, Pact of the Whisperer, Pact of the Brand, Pact of the Reaper, Pact of the Crucible.

**Pact of the Marionette (added 2026-05-02):** Once per day during day phase, left-click any of your minions to possess it. WASD moves the puppet (camera follows automatically); the puppet auto-attacks any adventurer in melee range. While possessed, every other minion in the dungeon stands idle. Possession ends if the puppet is killed, the day ends, or the player loads into the next day. Implemented in `Game._tryMarionettePossess` + `Game._tickMarionette`; MinionAISystem suppresses other dungeon minions while `possessedMinionId` is set.

**UI polish landed (2026-05-02):**
- **Long Game popup** — now a proper modal popup (`LongGamePopup.js`) wired into HudScene's popup system. Replaces the fade-banner.
- **Cartographer path overlay** — new `CartographerOverlay.js` ticked from `Game.update` paints color-coded dots along every adventurer's planned path while the pact is active.
- **Jester name scramble** — `BuildMenu._renderSlot` now renders `?` glyph and `???` name when the trap tab is active and the Jester pact is sealed.
- **Brand selection UI** — replaced random-pick with right-click-trap during night phase. `TrapRenderer` paints a pulsing gold halo around the blessed trap so the player can see which trap is primed.
- **Crucible sacrifice UI** — keyboard hotkey `C` during night phase enters sacrifice mode (when pact is active and unused). Two clicks on minions in the same room confirm; ESC cancels. Calls `dungeonMechanicSystem.crucibleSacrifice(victimId, targetId)`.
- **Sundered Floor renderer** — new `SunderedFloorRenderer.js` listens for the pact's lifecycle events. Pulsing yellow warning ring during the 5s telegraph, then a pitch-black square once the pit fires. Cleared at night.

**Active pact pool total:** 64.

### Damned Pacts — solid-black tier (added 2026-05-28, spec'd — not yet implemented)

A new **variant** of dark pact: pacts that are overwhelmingly *negative* — a permanent curse with a huge downside — paired with only a tiny one-time benefit. They are the structural inverse of a normal pact: where a normal pact's headline is the perk and the trade-off is the cost, a Damned pact's headline **is the curse**, and the "trade-off" is a small **bribe paid once the moment you seal it** (a "devil's bargain"). The bribe is "very little benefit" precisely because it's a single up-front payout against a cost you carry the rest of the run.

**Tier identity.** Each existing rarity has a colour (common = bone-grey, uncommon = green, rare = gold, epic = purple, legendary = blood-red). Damned pacts are a **6th tier rendered solid black** — proposed rarity id `damned`, stamp **"DAMNED"**, glyph proposed ☠ (exact black fill + hairline edge + glyph finalised in implementation, since pure `#000` would vanish against the dark crypt UI).

**How the player encounters them (devil's-bargain delivery):**
- When a Dark Pact pick fires, there is a **10% chance the grimoire is black instead of the usual purple**. A black grimoire offers an entire hand of **all-Damned** pacts.
- The other 90% (purple grimoire): Damned pacts may still appear mixed into the normal pool, drawn at the **same weight as Epic** pacts — the tier just before Legendary (epic weight 10 vs legendary 5, so slightly more common than a legendary).
- Damned pacts are **permanent** and **stack with no limit**, exactly like normal pacts — they simply carry far bigger downsides.

**Schema reuse (no new fields):** the existing pact card paints `description` as the green **"The Deal"** (boon) and `tradeoffDescription` as the red **"The Price"** (cost). That framing already fits a devil's bargain perfectly, so the schema is **not inverted**: `description` = the small one-time **bribe** (`"On sealing: …"`, the tiny Deal), `tradeoffDescription` = the huge permanent **curse** (the ruinous Price). The bribe is paid once in `onActivate`; the curse installs alongside it. Renders correctly in every existing surface (picker Deal/Price, detail popup boon▲/bane▼) with no UI changes. Gold-lump bribes are **flat numbers** (per user) — provisional values below, tweakable.

**The 24 Damned pacts (locked 2026-05-28):**

1. **The Leech** — Curse: lose 8% of your current gold every dawn. / Bribe: +800g on sealing.
2. **Famished Dark** — Curse: adventurer kills grant 50% less gold for the rest of the run. / Bribe: +1500g.
3. **The Open Gate** — Curse: +10 adventurers enter the dungeon every day, permanently. / Bribe: +1500g.
4. **Hollow Crown** — Curse: boss max HP permanently −50%. / Bribe: a free Legendary pact.
5. **Pact of Glass** — Curse: all minion max HP halved for the rest of the run. / Bribe: all minions cost 0 gold for that night phase only (minions placed that night give 0 sell value, to block resale abuse).
6. **Sleepless Throne** — Curse: the boss begins every boss fight at 50% HP. / Bribe: +10 max minion slots.
7. **Blind Architect** — Curse: minimap and adventurer-intel panel disabled for the rest of the run. / Bribe: a one-time perfect-day preview (full enemy preview next day). *(deviation noted 2026-05-28: shipped with a +400g gold bribe as a stand-in — the "perfect-day preview" bribe needs the forecast/intel-reveal system wired, deferred as a follow-up.)*
8. **Brittle Bones** — Curse: any minion struck while below 50% HP shatters instantly (dies). / Bribe: all current minions +25% damage (permanent).
9. **Crumbling Halls** — Curse: at the start of every night phase for the rest of the run, a random placed room is destroyed along with everything in it. **Never destroys the Boss Chamber or any Entry Hall** (those are exempt from the roll). / Bribe: +600g + trap slots.
10. **The Bleeding Crown** — Curse: the boss loses 2% of its max HP permanently every day. / Bribe: +1200g.
11. **The Sealed Vault** — Curse: you can never sell anything (rooms/minions/traps) again. / Bribe: +1500g.
12. **Mounting Debt** — Curse: each day, the gold cost of all rooms/minions/traps rises +5% (compounding). / Bribe: +1000g.
13. **Tribute of Flesh** — Curse: every adventurer who escapes alive loots 20g straight from your treasury. / Bribe: +700g.
14. **The Hollow Horde** — Curse: your maximum minion slots are halved for the rest of the run. / Bribe: every current minion +20% to all stats.
15. **The Wasting** — Curse: at the end of each day, every surviving minion permanently loses 5% of its max HP. / Bribe: all current minions evolve by 1 tier (where possible).
16. **The Hunger** — Curse: each dawn, 20% of your minions die permanently (no revives for these). / Bribe: +1000g.
17. **Brittle Engines** — Curse: every trap breaks permanently after firing once (gone for good, not per-day). / Bribe: traps deal +100% damage.
18. **The Insomniac** — Curse: every 3rd night you get no build phase (skipped straight to day). / Bribe: +600g.
19. **Famine's Grip** — Curse: treasure rooms and items pay 50% less gold. / Bribe: +800g.
20. **Pact of the Last Heart** — Curse: the boss is permanently reduced to **1 heart** (lives = 1, cannot regain) — the next lost boss fight ends the run. / Bribe: a free Legendary pact.
21. **The Unteachable** — Curse: your minions can no longer gain XP or evolve for the rest of the run. / Bribe: +1000g.
22. **Cursed Blood** — Curse: every minion death anywhere damages the boss for 3% of max HP. / Bribe: +1000g.
23. **The Martyr's Curse** — Curse: when a minion dies, adventurers in that room heal 25% of their max HP. / Bribe: +800g.
24. **Trapless Halls** — Curse: you can no longer place new traps for the rest of the run (existing traps remain). / Bribe: existing traps +50% damage + 600g.

### Legendary pacts expansion (added 2026-05-28 — 8 new, pool 8→16)

Normal-schema legendaries (perk = "The Deal", cost = "The Price") tuned for **massive upside / massive downside**. Several boost boss stats (⚔️), wired through `BossSystem._recomputeBossFightStats` (per-stat multipliers, same place the altar buff + damned curses live).

1. ⚔️ **Colossus Heart** — Up: boss max HP doubled. / Down: boss attacks 50% slower (attack ×0.5).
2. ⚔️ **The Apex Tyrant** — Up: boss +100% max HP, +50% attack & defense. / Down: every adventurer wave is doubled for the rest of the run.
3. ⚔️ **Avatar of Ruin** — Up: boss is invincible for the first 5 seconds of every boss fight. / Down: boss max HP cut by 50%.
4. ⚔️ **Wrath Unbound** — Up: boss gains up to +100% attack as its HP falls. / Down: boss takes +50% more damage.
5. **Crown of Avarice** — Up: all gold income doubled. / Down: every 5th day a guaranteed hero-grade raid (wave doubled, +50% adventurer stats).
6. **The Iron Price** — Up: your minions and traps deal double damage. / Down: you can never earn gold again (no kills, no treasure).
7. **Sudden Death** — Up: your minions, traps and boss deal 5× damage. / Down: so do the adventurers — everyone is glass, every hit lethal.
8. **The Undying Court** — Up: every adventurer who dies rises the next night as an undead minion of its class (stats carried over). / Down: each occupies 2 minion slots and buffs living adventurers; with no free slots, 2 of your minions are sacrificed to make room.

The trade-off should really make you think before choosing them. **I want tons and tons of different mechanics and trade offs to be added.**

---

## Adventurer goals

I want different adventures to enter the dungeon with different goals, for example some can be hunting for certain loot from mini bosses or secret rooms in the dungeon. Or they can just be there to farm and level up.

---

## Loot equipping & minion XP

Whenever an adventurer dies in a dungeon I want to be able to equip their gear they dropped to minions and monsters in my dungeon. Minions and monsters that kill an adventurer should gain experience and level up so that they become stronger and harder to kill.

(deviation noted 2026-05-29: the kill-XP / auto-level system was replaced — minions no longer gain XP or level from kills. Power now comes from **boss-level scaling** (their level always equals the boss's) plus a **player-paid, gold-gated tier upgrade** (night-phase UPGRADE tool). Upgrades persist through death/revive. Higher tiers are strictly stronger. This makes powering up a deliberate gold sink the player chooses, instead of automatic.)

---

## Dungeon expansion

As the game goes on I want the ability to place new dungeon rooms to expand my dungeon. Rooms like trap rooms, treasure rooms guarded by a mini boss, secret rooms that adventures can stumble into, rooms with tons of enemies, and so much more.

My dungeon should start out as a level 1 dungeon, but as I kill more adventurers and expand it levels up. Adventures that enter the dungeon should start at level 1. As the dungeon grows and levels up, so should the adventures. As I kill adventures I should get experience that I can use to level up monsters/minions in the dungeon so they are stronger and get new abilities.

(deviation noted: dungeon-level system replaced with boss-level system. The boss character itself now owns level/xp/xpToNext. All scaling — adventurers, minions, room unlocks, loot tiers — uses boss.level. Minions are scaled +10% HP / +7% ATK per boss level above 1. Cap is 10 per DESIGN.md §3.)

---

## Personalities and class types

I want adventures to have different personalitys and class types that sway how they decided to attempt the dungeon. They can have multiple personality types as the game gets harder as the dungeon levels up. For example I have these Ideas but **we need so many more**:

1. **greedy** — usually tried to go for the loot first and shiny objects
2. **speed runner** — runs past weaker enemies
3. **paranoid** — assumes every door is trapped and every chest is a mimic. Extremely slow, never opens chests voluntarily. Near impossible to kill with traps — but takes forever to reach the boss room and may convince other party members to leave.
4. **party** — four adventures that usually work together and move together *(deviation noted 2026-05-31: implemented as the **party_loyal** personality, now **REMOVED**. Its only wired behavior was the `DEFEND_ALLY` interpose goal, which was cut along with the other party-coordination/scout AI goals — `RESCUE_ALLY`, `REGROUP_AT_PARTY`, `SCOUT_AHEAD` — because they caused erratic cross-map goal-flips and trap-pacing. Adventurers still spawn and travel in parties via `partyId`; there is no longer a dedicated "loyal" personality. See DESIGN_COVERAGE.md §2.)*
5. **solo** — they split up from the other adventurers to go on their own or run ahead
6. **raid leader** — if they die, the rest of the party or raid team scatter, or lose their teamwork
7. **completionist** — tried to find secret rooms
8. **cartographer** — tries to explore every area to map the entire floor. if they escape the dungeon, they share this information with other adventures, making hidden traps less effective.
9. **vandal** — they focus on breaking traps without triggering them, so other adventures do not spring them that day
10. **martyr** — at low health they will try to taunt all enemies to focus on them so the rest of the party can reach the next room
11. **underdog** — starts extremely weak but gains double experience as he kills enemies. which makes him get stronger, faster
12. **inquisitor** — can disable a dungeon mechanics
13. **vulture** — this solo adventurer follows larger parties from a distance away. They wait for the party to trigger traps or weaken a mini-boss, then swoop in to steal the loot and leave
14. **traumatized** — if this adventurer is the sole survivor of a party wipe, they immediately try to escape the dungeon and give their knowledge to other adventurers
15. **the fan** — Idolizes a specific class of minion (e.g., "dragon stans"). Will attempt to spare or even befriend that minion type instead of fighting.
16. **coward** — Runs from every fight. If they escape, they carrying knowledge of every room they entered in the dungeon without killing anything. Maddeningly effective scout who never threatens you — but the intel they provide is priceless.
17. **overconfident** — Ignores all party warnings and runs ahead alone. Usually dies first in spectacularly stupid ways. But on rare occasions survives long enough to accidentally reveal a path, making their sacrifice unintentionally useful.
18. **Beast tamer** — will try to tame monsters in the dungeon to have them fight by their side  *(deviation noted 2026-04-29: promoted to its own Class as "Beast Master" with single-companion mechanic; removed from the personality pool. See "Class additions" section below.)*
19. **mage** — long rage fighter that uses spells
20. **cleric** — can heal other adventures and deal extra damage to undead monsters/minions
21. **knight** — close combat fighter that tries to protect other adventures
22. **necromancer** — Tries to raise defeated minions to fight for the party. If they succeed, i temporarily lose a minion. but if i have undead minions and a Lich boss type, there's a chance the raised minion turns on the party instead.
23. **twitch streamer** — a rare late game adventurer type with extra features. they enters the dungeon live, with thousands of viewers watching. Their behavior is constantly influenced by chat, making them wildly unpredictable and socially contagious. Their chat votes on decisions in real time as they explore the dungeon. A fork in the path, a suspicious chest, a tough enemy — a poll appears over their head and they follow the majority vote, even if it's obviously suicidal. "PogChamp the chest! PogChamp the chest!" and suddenly a paranoid/streamer type opens a mimic because 60% of chat said so. When they die, chat goes absolutely feral — and their death clip spreads. The next day, a larger party shows up specifically because they saw the stream and want to attempt the dungeon themselves. If they survive, they share a full recorded run — more detailed than even the Cartographer's map, since viewers also spotted things the adventurer missed. These adventurers also have special streamer-like names.

**I want a large amount of different personalitys and class types like these.**

---

## Class additions (2026-04-29)

Added during development as the class pool was expanded beyond the original sheet. Personalities (greedy, paranoid, etc.) layer on top of any of these classes.

1. **Beast Master** *(rare, unlock lvl 6 — like Twitch Streamer)* — Trained handler. Tames a single hostile minion mid-fight; the tamed beast follows and fights for them. Only one companion at a time — if the companion dies, they can tame a new one to replace it. Mono-type minion strategies become dangerous; variety is a defense. *(replaces the "Beast tamer" personality entry above.)*

2. **Barbarian** — Rage-fueled brawler. Damage output scales as HP drops (up to 2× at near-death). Immune to fear and flee triggers — never retreats. Counters fear-based plans (e.g. Wraith's Fear Meter) and any "soft-lock with weak minions to stall" tactic, since softening them sharpens them.

3. **Monk** — Unarmored, lightning-fast. ~30% chance to dodge incoming hits including traps. Strikes ignore half of minion defense. Counters trap-heavy and Golem-style fortress builds; forces the boss toward wide-AOE answers.

4. **Bard** — Travelling performer. While alive, grants nearby party members +15% attack and +15% speed. The aura ends the moment they fall — making them a priority kill target during combat planning.

---

## Class ability rework (2026-04-29)

Approved overhaul of every adventurer class. Mana system removed entirely — abilities are now gated by a uniform per-instance cooldown system plus per-day usage budgets where appropriate. Each class gets exactly two active abilities (or three for Twitch Streamer's chaos design); some classes also keep a passive trait. Each ability ships with a small, non-overwhelming visual effect so the player can read what's happening.

**Vandal personality is removed** — the trap-disarm role is now exclusive to the Ranger's Trap Expert ability.

**Removed abilities** (replaced or scrapped): `heal_ally`, `smite_undead` (becomes passive), `raise_corpse` (replaced by Summon Undead), `chat_poll` (replaced by Chat Decides), Ranger arrow consumption, `soul_bolt`, `command_beast`, `volley` (rebuilt), `track`, `viewer_drop`, `dodge_chance` (rebuilt as Focus), `armor_pierce`, `inspire_party` (rebuilt), `song_of_speed` (rebuilt), `rage_scaling` (kept as passive), `unstoppable` (kept as passive).

**Per-class ability spec:**

1. **Knight** — *Protective Aura* (set duration, large CD; party allies within 1 tile take 25% less damage). *Taunt* (medium CD; forces minion/boss aggro onto Knight).
2. **Rogue** — *Lockpick* (1–5/day by level, 20% fail; opens locked doors silently — dormant until locked-doors land). *Invisibility* (set duration, large CD; sprite α=0.4; minions ignore Rogue but boss does not; attack while invis = guaranteed crit + immediate reveal).
3. **Mage** — *Elemental Affinity* (passive trait; rolled element on spawn from {fire, ice, lightning, wind}; 1.5× damage vs minions vulnerable to that element). *Arcane Burst* (cooldown ~20s; activate → next spell hits 1-tile AoE).
4. **Cleric** — *Resurrection* (1/run; revive a fallen party member at 30% HP). *Heal* (medium CD ~10s; targets lowest-HP ally <70% in range). Passive: 1.5× damage vs undead minions.
5. **Necromancer** — *Summon Undead* (large CD; spawns 2 fresh low-HP/low-ATK skeletons or zombies on adventurer faction). *Bone Armor* (active, large CD; +ATK/+DEF buff for set duration, scales with currently-living summons).
6. **Ranger** — *Volley* (every-5th-shot proc; fires a 3-arrow cone). *Trap Expert* (1–5/day by level, 20% fail-then-trigger; disabled traps stay disabled until day end). Arrow consumption removed.
7. **Twitch Streamer** — *Viewers Choice* (random auto-trigger; slot-machine UI; RNG buff/debuff: heal, ATK ±20% 10s, DEF ±2 10s, random teleport, slow poison, invis 10s, etc). *Chat Decides* (random ~15s interval; chat picks one of: investigate-trap / fight-engaged-enemy / abandon-current-goal / charge-boss-room). Passive: *Subscriber Revenge* — on death, 50% chance next day's spawn count gets +3, with arrival notifier.
8. **Beast Master** — *Tame Beast* (50% success; single companion enforced). *Scout Ahead* (1/day; companion leaves to scout, knowledge transfers back to BM, BM is companion-less while scouting).
9. **Barbarian** — *Break Door* (active; opens locked doors but alerts neighbor rooms — dormant until doors land). *Unstoppable* (passive; immune to all flee triggers). Passive: *Rage Scaling* (damage = base × (1 + (1−hpFrac)) up to 2× at 1 HP; VFX kicks in at high rage).
10. **Monk** — *Focus* (medium CD; 30% dodge vs damage AND traps for set duration). *Inner Peace* (large CD; +1 HP/sec for set duration).
11. **Bard** — *Inspire Party* (medium CD; 2-tile, +15% ATK during set duration). *Song of Speed* (medium CD; 2-tile, +20% SPD during set duration). Passive: *Encore* — when Bard dies, all party members heal 25% as a final flourish.

Cooldown buckets: short = 5–8s, medium = 12–18s, large = 30–60s. Per-day budgets refilled at day start. Debug toggle (Ctrl+Shift+C) clamps every cooldown to 1 second so all abilities can be visually verified within a single dungeon run.

**Element vulnerabilities** added to `minionTypes.json` as `vulnerableToElements: [...]`. Distribution is uneven (rough first pass; will retune as Mage feels off).

---

## New adventurer classes (2026-06-03) — 5 added

Five new spawnable adventurer classes (sprites baked + locked first, then abilities).
**LOCKED SPECS (verbatim — implement from THIS, not a paraphrase).** Source: the
design conversation 2026-06-03 (user reply + agent recommendations, both confirmed).

### ⛏️ Miner — Tunnel (once per day per miner)
> "lets make him instead randomly choose a tile in the dungeon one time per day where his goal is to walk to the tile, attack it for a few seconds to create a hole. then he goes into the hole and a few seconds later a new hole appears in a random different room and he climbs out of it. this connecting hole is now permanent for the day and allows any adventurers to walk to the hole and enter it to come out on the other side. holes can even appear in the boss room and if an adventurer enters the boss room this way, a boss fight immediately starts. vfx of dirt and rocks coming up from the tile he is digging at and the hole he makes."
- Locked add-ons (agent recs, confirmed): other adventurers route through a hole only when it genuinely shortens their path (hole pair = a pathfinder traversal edge); the miner himself triggers the boss fight if he surfaces in the boss room (with a boss cut-in line); hole lifetime = **rest of the day, collapses at night** (user choice 2026-06-03); VFX reuse boss rubble/quake assets for the dig + a brown particleBurst on climb-out + a dirt-rimmed pit sprite as a matched pair.

### 🕊️ Valkyrie — Winged Flight + Rally the Fallen
> "Winged Flight. This should ignore all traps. Maybe give them an animation to make them look like they are floating/flying as they move around the dungeon. Also include Rally the Fallen with a 3 second cast time and cast bar to revive a dead adventurer. Each valkyrie can only use this once. After casted the dead adventurer can get back up and has half its HP."
- Locked add-ons: flying look = lift sprite a few px + slow vertical bob + keep shadow on the ground (the ground-gap sells it); Rally mirrors White Mage's Raise — **interruptible** (killed/stunned/combat mid-cast → fizzles), targets the most-recently-fallen ally nearby; she **walks to a tile ADJACENT to the corpse (never onto it) before channelling** (user, 2026-06-03); VFX = holy beamPillar + godRays, corpse rising in the light, reuse the cast-bar UI. (Valkyrie is strong → gate later / rarer.) NOTE: Rally has **NO buff component** — it is purely the cast-time revive.

### 🌾 Peasant — Strength in Numbers
> "Strength in Numbers. Should spawn in clusters that prefer to stick together as they explore."
- Locked add-ons: spawn as a squad sharing one goal, moving as a loose blob (not true flocking); buff = **+8% atk/def per nearby peasant, max +32%** (needs a cap); VFX = when 3+ clustered, a shared dusty-brown ground aura that intensifies with the count + occasional angry-shout emote bubbles (raised fist / "!") + a small pulseRing when a new peasant joins.

### ⚔️ Gladiator — Crowd Roar + Block
> "crowd roar + a block ability. Blocking allows the gladiator to stop all damage delt to him for a short period, however he cannot attack or do damage while blocking (also should work for boss fights). needs a vfx for entering block mode."
- Locked add-ons: Crowd Roar = every minion it kills grants a **stacking attack + speed** buff (snowball); Block AI = block reactively when low HP + a cooldown; Block VFX = AbilityVfx.domeShield bubble + steel/gold shimmer + a guard tint, bubble drops when block ends. **Block must work in boss fights too** (immunity + the no-attack rule).

### 🎲 Gambler — Roll the Dice + Double or Nothing
> "Roll the Dice + Double or Nothing. For double or nothing if they lose the flip, the player should get a benefit. for Roll the Dice it shouldn't happen on every attack, with first attack they should have a dice roll animation above their head with the result of the roll and what they get for it. after the animation completes it can be triggered again on the next attack."
- Locked 6-face table: ⚀1 miss/whiff · ⚁2 normal hit · ⚂3 +gold to the player (small payout) · ⚃4 **double strike (hits twice)** · ⚄5 self-heal · ⚅6 crit (big hit). Double-or-Nothing LOSE payout = bonus gold to the player, **scaled to the gambler's level**. VFX = tumbling die above the head settling on the face + a floatingText effect label; spinning coin flip on death.

### Acceptance checklist (tick against CODE before "done")
_(Code-verified 2026-06-03: every box below ticked against the actual implementation. Live in-preview runtime verification still recommended before final sign-off.)_
- **Miner:** ✅ once/day ✅ pick random tile + walk to it (TUNNEL_DIG goal) ✅ dig (attack tile) over a few seconds (TUNNEL_DIG_MS) ✅ enter hole / disappear (`_underground`, renderer hides) ✅ delay → 2nd hole in a random different room (TUNNEL_UNDERGROUND_MS) ✅ climb out there ✅ hole pair permanent for the day (portals collapse at night) ✅ other advs route through (pathfinder edge, only if shorter) ✅ boss-room hole → instant boss fight incl. the miner (surface→AT_BOSS→watchdog) ✅ collapses at night ✅ dig dirt/rock eruption VFX (`_fireDigVfx`) ✅ climb-out VFX (brown particleBurst) ✅ dirt-rimmed pit pair (TunnelPortalRenderer, MINER_DIG_HOLE per endpoint)
- **Valkyrie:** ✅ Winged Flight = ignore ALL traps ✅ floating/flying animation (lift+bob+grounded shadow, `_tickValkyrieFlight`) ✅ Rally = 3s cast ✅ cast bar ✅ interruptible ✅ once per valkyrie ✅ revives a DEAD ally ✅ at HALF (50%) HP ✅ targets most-recently-fallen ✅ resurrectBeam VFX (used in place of beamPillar+godRays) ✅ NO buff component
- **Peasant:** ✅ +8% atk per nearby peasant ✅ +8% def per nearby peasant ✅ cap +32% ✅ cluster spawn (guaranteed 2-3 pack when any peasant rolls — user choice 2026-06-03) ✅ stick-together squad movement (leash to squad leader) ✅ sustained dusty ground aura scaling with count (`_ensurePeasantDust`) ✅ angry-shout emotes (✊ / !) ✅ join pulseRing (EMBOLDENED)
- **Gladiator:** ✅ Crowd Roar stacking ATK ✅ Crowd Roar stacking SPEED (AISystem roarSpdMul) ✅ Block = full immunity ✅ can't attack while blocking ✅ Block works in boss fights — immunity at every boss→adv site + excluded from attacker pool + AI triggers when boss-pressed (`_advBlocking`) ✅ domeShield VFX
- **Gambler:** ✅ dice not-every-attack (anim then re-roll) ✅ 6-face table ✅ face 4 = two hits (not ×2) ✅ DoN win revive 50% ✅ DoN lose payout scaled to level ✅ die VFX (procedural) ✅ coin VFX (procedural)

### Sprite refinements — round 2 (2026-06-03, VERBATIM)

> **Going-forward rule (ALL LPC sprites):** "going forward always use LPC revised color types for LPC sprites instead of LPC universal."

> **Miner:** "Did you verify that their attack sprites are also correct?"

> **Gladiator:** "fix saber, as you mentioned" (the Saber rendered one fixed steel tint; vary it with the armour metal).

> **Peasant:** "fix spear, as you mentioned" (the Spear/pitchfork rendered one fixed brass tint; vary the tine metal).

> **Valkyrie:**
> - "50% should have shields."
> - "spear or sword users can use shields."
> - "shields should be colored either gold, yellow, or silver."
> - "all Valkyries should have bracers."
> - "Valkyries should only have colored hair that is from the lpc revived list that is blonde, platinum, white, pink, ivory, porcelain, peach, Amethyst, Beige, Apricot, Cerise, ice, lavender, linen, pink, sky, or yellow."
> - "armour should be LPC revised silver, gold, white, brass, ice, or lavender."
> - "All Valkyries should be lighter skin types."
> - "armored Valkyries should have armor on arms and legs and feet. only 30% should be armoured"
> - "make sure all dress colors are available for those with dresses"

> **Gambler:** "I'm not seeing any females. females should also not use hats"

#### Round-3 tweaks (2026-06-03, VERBATIM)
> **Gladiator:** "their sword metal color should not match their amour color."
> **Gambler:** "give some female gamblers dresses to wear instead."
> **Valkyrie:** "make 50% armoured instead of 30%"

#### Round-2 acceptance checklist (verified against the bake/manifest 2026-06-03)
- **Global:** ✅ baker now merges the LPC-revised palettes (all_lpcr → hair, body_lpcr → body) so revised color names are valid; valkyrie uses revised names. CLAUDE.md rule added for future pools.
- **Miner:** ✅ attack (_atk) sprites re-baked — the basket/cargo is present in every pickaxe-swing frame.
- **Gladiator:** ✅ Saber dropped (un-tintable single PNG); now Arming Sword → blade follows armour metal.
- **Peasant:** ✅ Spear weaponColor='metal' → tines vary with iron/steel/bronze/copper.
- **Valkyrie:** ✅ 57% carry a shield (sometimesShield 0.5) ✅ shield on spear OR sword (no shieldWeapons gate) ✅ shield ∈ {gold, yellow, silver} ✅ Bracers on ALL ✅ hair = the 16-color revised list (0 outside it) ✅ armour ∈ {rev_silver, rev_gold, white, brass, ice, lavender} ✅ all light skin (light/ivory/porcelain/peach) ✅ armored = Plate + Armour legs + Plated-Toe feet + Bracers ✅ exactly 30% armored (modesEven) ✅ all 24 dress colors available. (LPC note: metal legs/feet are variant-PNG with only ulpc metals, so they use the closest pale variant — the prominent Plate/Bracers carry the exact revised finish.)
- **Gambler:** ✅ females wear NO hat (body-gated headwear) ✅ NightPhase variant picker fixed (was capped at v50 → female variants in v51-100 never spawned; now reads the full manifest list). [live spawn pending preview reopen — proxy wedge]

---

## Personality combos

Also there should be combos with different adventures when they come as a party that cause new things to happen with them. For example:

1. **Greedy + Cartographer** = the cartographer maps efficiently but the greedy one keeps diverting them.
2. **Paranoid + Speedrunner** = constant friction in the party, party splits up
3. **Martyr + Vulture** = the vulture waits for the martyr to taunt, then loots the corpses afterward.
4. **Raid Leader + Traumatized** = if the leader dies, the traumatized one's escape triggers cascade

**I want to lots of these combos to get added.** And I want to make these visible to the player as little relationship icons. Watching parties self-destruct from personality clashes.

---

## Loot growth & hunts

As my dungeon grows, I want the loot that is stored in it to get better as well. I want adventures to sometimes specifically hunt for this loot in the dungeon and if they get it, they can use it. For example a mini boss could be guarding a powerful weapon or item or armor, and if the adventurer kills that boss and takes the weapon or item or armor, they can now equip and use it in the dungeon.

I want adventures to also be able to obtain other loot and gold in the dungeon. They can decided to leave the dungeon to go an buy better gear, weapons, or items and then come back another day with knowledge of the dungeon and better gear, making them harder to kill of course.

---

## Risk vs Reward

The game should have a lot of Risk vs. Reward elements. For example: I can choose create a Treasure Room in my dungeon. This would lure in higher-level "Raid" groups (more XP for me and my monsters), but if they win, they now have legendary loot that can be used against me.

---

## Evolution Trees

When a Minion levels up, I don't want to only just give them stats. I want them to evolve based on how they killed the adventurer.

(deviation noted 2026-05-29: kill-themed evolutions are **kept as flavour only** — they grant the themed rename + ability shown below, but their raw stat deltas were stripped so they no longer add power. Power comes from boss-level scaling + the gold-gated TIER upgrade instead. The chain-tier advance (e.g. goblin1→goblin2→goblin3) is no longer automatic-on-kills; it's the player-paid UPGRADE. The kill-themed specializations below still trigger and rename/buff-with-ability.)

- Killed by Poison? Evolution: **Plague Bringer** (Aura damage).
- Killed by Backstab? Evolution: **Shadow Stalker** (Invisibility).

Other Ideas for example:
- A Skeleton that kills 5 mages gets **Mana Eater** (drains spells)
- A Skeleton that kills 5 knights gets **Bone Crusher** (armor pierce)
- A Skeleton that survives 10 days without killing anything gets **Lich Apprentice** (gains spells)
- A Skeleton that's killed by an adventurer 3 times and respawned gets **Vengeful Wraith** (deals bonus damage to that specific adventurer's class)

**And many many more variety.**

---

## Dungeon room types

> **Status:** This original 9-room list is preserved as design history.
> The actual shipping roster lives in **"Room redesign 2026-04-30"** below.
> Per-entry status notes track which legacy rooms made it into the new
> roster vs. which were dropped.

Different types of dungeon room ideas for example:

1. **The Hall of Echoes** — Any sound made in this room alerts minions in the adjacent rooms. Perfect for setting up an ambush for Speed Runners. *(🚫 REMOVED — sound-alert mechanic dropped; the "adjacent-room alert" idea folded into the Whisperer's Tongue dark pact instead.)*
2. **The False Exit** — A room that looks like a way out but send the player to a random location in the dungeon instead. It's a "Stamina Drainer" for parties trying to escape. *(✅ SHIPPED as `false_exit`.)*
3. **The Treasure Room** — lures more adventurers to the dungeon so I can gain more xp but hold valuable items that can make the adventures stronger if they get to it. *(✅ SHIPPED as `treasury` + the Treasure Chest item line T1–T10.)*
4. **The Healing Fountain Room** — A room that looks like a safe haven. Adventurers will stop to "Sleep" or "Heal" here leaving them vulnerable to being attacked by patroling minions/monsters while they sleep. *(🚫 REMOVED as a room; survives as the **Healing Fountain item** in `items.json`. No room version ships.)*
5. **The Necropolis Wing** — A special late-game room that turns every adventurer corpse that dies in it into a weak skeleton minion permanently. Not respawnable, no XP — but they were once adventurers, so they "remember" the dungeon layout and patrol the dungeon suspiciously well. *(✅ SHIPPED as `catacombs` — adv deaths in the room raise Revenants up to a 2-alive cap.)*
6. **The Colosseum** — A large arena room. When adventurers enter, doors lock and waves of minions spawn. The trick: there's a lever mid-room the party has to reach to open the exit. Greedy types ignore the lever to loot the mini boss first. *(🚫 REMOVED — wave-spawn-while-locked never shipped.)*
7. **The Mirror Maze** — A room full of reflective pillars. Adventurers can lose track of each other. Minions with stealth thrive here. Cartographers are less effective — the map geometry is intentionally disorienting. *(🚫 REMOVED — fake-marker idea folded into the Whispered Lies dark pact instead.)*
8. **The Obelisk Room** — A dark room with a glowing obelisk. Standing near it heals adventurers — but slowly charges a trap that summons a wave of minions when fully charged. Do they heal or rush through? They decide based on their personality/type. *(🚫 REMOVED — wave-charge mechanic never shipped.)*
9. **Barracks** — Minions actively sleep here between patrols. Parties can sneak through silently — but any combat wakes everyone. The Speedrunner wants to dash through. The Paranoid refuses to move until every minion is dead. *(✅ SHIPPED as `starter_barracks` — sneak-through mechanic kept; "sleep wakes on combat" simplified.)*

**I want many many different rooms that can be added to the dungeon.**

---

## Room redesign 2026-04-30 (replaces the room set above)

A full reset of the room roster, organized around three principles:

1. **Gateway rooms (max 1, or scaling-1)** — each gateway is the ONLY way to access a content category (Barracks → roster minions, Trap Factory → traps, Library → intel, Treasury → economy, etc.). Players can only afford a few, so every dungeon specializes.
2. **Roster vs Garrison minions** — Barracks produces *roster* minions (count toward cap, can patrol/follow/be assigned). Every other minion-spawning room produces *garrison* minions (room-bound, cannot leave, do not count toward cap).
3. **Per-level cap scaling** — multi-instance rooms (Barracks, Trap Factory, Treasury, Armory, Hall of Trials, Throne Room, Corridor) start at a low cap and scale with boss level, capping at 10.

Top-level rules:

- **"Adjacent / connected"** = directly through a shared door. Not transitive through corridors.
- ~~**All chest/loot theft requires alive exit** to the dungeon entrance; deaths return the loot.~~ *(SCOPE_CHANGED 2026-05-22: the loot-pickup system was retired 2026-05-02. Treasury became a flat daily gold stipend; Mimic Vault became a chest-disguise-and-bite reveal. The alive-exit-theft rule no longer applies to any room.)*
- **Boss level cap is 10.** Rooms unlock progressively across all 10 levels.
- **Hazard rooms** (Lava Floor, Serpent Pit, Collapsing Pillars) are removed — to be revisited as traps in a later pass.

### Final room roster (21 rooms)

#### Required / Fixed

| Room | Cap | Unlock | Effect |
|---|---|---|---|
| **Boss Chamber** | 1 (fixed) | Start | The boss's lair. Game ends here. |
| **Entry Hall** | 1 / 2 / 3 (forced) | Start; 2nd @ L5, 3rd @ L10 | Adventurers enter the dungeon through these. Each day every adventurer randomly picks which Entry Hall to emerge from; fleeing adventurers run to the nearest one. The kingdom forces a 2nd Entry Hall at boss level 5 and a 3rd at level 10 — more entrances mean more fronts to defend. Required to play. |

#### Starter — free, available L1

| Room | Cap | Unlock | Effect |
|---|---|---|---|
| **Corridor** | scales 2 → 20 (+2/level) | L1, first 2 free / 8g+ after (escalating) | No effect. Connects rooms. |
| **Barracks** | scales 1 → 9 (one extra per boss level from L3) | L1, first 1 free / 45g+ after (escalating) | Each Barracks adds **+10 roster minion slots**. Roster minions are the only ones that can patrol, follow, or be assigned. Gateway: without one, no roster minions. |
| **Guard Post** | scales 1 → 3 (extras at L4 and L7) | L1, first 1 free / 24g+ after (escalating) | Minions placed here leave to hunt adventurers in any **directly door-connected** room. They return after the kill. |

#### L2 unlocks

| Room | Cap | Effect |
|---|---|---|
| **Crypt** | 3 | Spawns up to **4 Risen Bones (garrison, room-bound)**. Refills to 4 each Night Phase. Does not count toward Barracks cap. |
| **Library of Whispers** | 1 | Reveals next party intel the night before. Tier scales with boss level: **L2** size + classes; **L6** + personalities; **L8** + stats & equipment; **L10** + planned dungeon route. (Moved from L4 → L2 on 2026-05-19.) |

#### L3 unlocks

| Room | Cap | Effect |
|---|---|---|
| **Trap Factory** | scales 1 → 5 | Each Factory adds **+5 trap slots** to your global trap pool. Gateway: without one, no traps. No upgrade tree. |
| **Treasury** | scales 1 → 5 | Generates a flat **+5 gold daily stipend** per active Treasury at Night Phase start (`RoomBehaviorSystem._onNightStart` → emits `TREASURY_STIPEND`). Each active Treasury also **adds +1 adventurer to the next day's wave** — riches attract invaders, so stacking Treasuries is a real risk-vs-reward trade. *(deviation noted 2026-05-22: the original "4 chests + alive-exit-required theft" model was retired in the 2026-05-02 loot-pickup cleanup. Only the stipend + arrival-rate increase ship; chest theft is gone from the design.)* |
| **Armory** | scales 1 → 3 | Minions in **directly door-connected** rooms get +ATK while this is active. |

#### L4 unlocks

_(no new rooms — see Library of Whispers moved to L2)_

#### L5 unlocks

| Room | Cap | Effect |
|---|---|---|
| **Watchtower** | 2 | Minions in directly door-connected rooms get a **first-strike** hit when adventurers enter. Counters Speed Runners. |

#### L6 unlocks

| Room | Cap | Effect |
|---|---|---|
| **Wandering Gate** | 1 | On entry, % chance to teleport adventurer: **60%** nearby room, **35%** any built room, **5%** Boss Chamber. |
| **Veil of Forgetting** | 1 | Each Night Phase, erases adventurer intel of all rooms **directly door-connected** to this one. |

#### L7 unlocks

| Room | Cap | Effect |
|---|---|---|
| **Catacombs** | 2 | Reactive: when an adventurer dies in this room, a **Tier-2 Revenant (garrison, room-bound)** rises in their place. Max 2 Revenants alive in the room at once; do not respawn if killed. |
| **Mimic Vault** | 1 | Looks identical to a Treasury on the map. Spawns **2 stationary Mimics (garrison, room-bound)** each day, each disguised as a random Treasure Chest tier — red-tinted to the player so they can read the layout, an ordinary chest to the adventurer AI. The placeable Mimic minion (Barracks roster) shares the exact same mechanic. **Adventurers within 1 tile of a disguised mimic trigger it like a normal chest** (knowledge-gated tempt + path-and-open). On open the chest-open animation plays and the opener is **instantly killed** — every surviving alive adventurer + the next-day shared knowledge pool learn THIS specific mimic is a trap, so they won't open it again (and may attack it instead, since they now see through the disguise). The mimic stays visibly open ('sprung') for the rest of the day; at next NIGHT_PHASE_STARTED it re-disguises and is dangerous again. Mimics killed via direct combat (knowledge-aware adv attacks them) stay dead until Mimic Vault auto-respawns them, or the player rebuilds the placeable version. *(deviation noted 2026-05-22: replaced the original 40%/5% per-room-entry open-roll + 30% max-HP bite + reveal-and-engage mechanic with the cleaner stationary-instant-kill-trap design.)* |
| **Hall of Trials** | scales 1 → 3 | Spawns a **random Tier-2 evolved minion (garrison, room-bound)** at Night Phase if none are alive in the room. If killed, does not respawn that night. |

#### L8 unlocks

| Room | Cap | Effect |
|---|---|---|
| **Wishing Well** | 1 | On entry, coin flip. **Heads:** adventurer gains +ATK and +HP buff. **Tails:** adventurer gains "Marked" (skull icon, takes +50% damage from minions for the rest of the day). |
| **False Exit** | 1 | Has its own entry door. Adventurers fleeing the dungeon have a chance to flee here instead of the Entry Hall. Trying to leave teleports them to a random built room. |

#### L9 unlocks

| Room | Cap | Effect |
|---|---|---|
| **Hall of Madness** | 1 | Adventurers in this room have a % chance to attack each other instead of moving on. (Heavy implementation lift — needs new AI state.) |
| **Throne Room** | scales 1 → 2 | Spawns 1 **Mini-Boss (garrison, room-bound)** that scales with boss level. No other minions may be placed in this room. Respawns nightly. *(deviation noted 2026-05-22: the original "T1→T2→T3 family progression" spec was simplified to a skeleton3 baseline whose HP/ATK/DEF scale via `MINION_HP_PER_BOSS_LV` / `MINION_ATK_PER_BOSS_LV`. Stat scaling already creates the difficulty curve; family-tier visual swap is deferred polish.)* |

#### L10 unlocks (capstone)

| Room | Cap | Effect |
|---|---|---|
| **Sanctum** | 1 | Passive: boss regenerates HP between fights. Aura: minions in directly door-connected rooms also regen. |

### Cap scaling table

| Level | Corridor | Barracks | Library | Trap Factory | Treasury | Armory | Hall of Trials | Throne Room |
|---|---|---|---|---|---|---|---|---|
| L1 | 2 | 1 | — | — | — | — | — | — |
| L2 | 4 | 1 | 1 | — | — | — | — | — |
| L3 | 6 | 2 | 1 | 1 | 1 | 1 | — | — |
| L4 | 8 | 3 | 2 | 1 | 1 | 1 | — | — |
| L5 | 10 | 4 | 2 | 2 | 2 | 1 | — | — |
| L6 | 12 | 5 | 3 | 2 | 2 | 2 | — | — |
| L7 | 14 | 6 | 3 | 3 | 3 | 2 | 1 | — |
| L8 | 16 | 7 | 4 | 3 | 3 | 2 | 1 | — |
| L9 | 18 | 8 | 4 | 4 | 4 | 3 | 2 | 1 |
| L10 | 20 | 9 | 4 | 5 | 5 | 3 | 3 | 2 |

*(table updated 2026-05-22 to match `src/data/rooms.json`. **Library** row added — each additional Library beyond the 1st unlocks a deeper tier of intel in the Adventurer Intel panel: L2 size+classes (1 Lib), L4 + personalities (2 Libs), L6 + scaled stats (3 Libs), L8 + planned route (4 Libs). **Barracks** ships at 1→9 instead of the original 1→5 spec — kept at the higher cap as a quality-of-life decision per user 2026-05-22; design row retained for historical reference.)*

### Room cost rework — power-based pricing (2026-05-20)

Room `goldCost` values were retuned so price reflects **how powerful the room's effect is**, not just how late it unlocks. Gateway rooms (Barracks, Trap Factory) and free-recurring-unit rooms (Crypt, Throne Room, Hall of Trials, Catacombs) cost more; the pure-information room (Library of Whispers) costs less; capstones (Sanctum) sting.

**Escalating cost** — every multi-instance ("scaling") room now costs more for each additional copy. The first paid copy costs the base `goldCost`; each copy after adds a `costStep` (a top-level room field in `rooms.json`). So a 4th Barracks costs far more than the 1st — spamming a strong room snowballs its price. Single-instance rooms keep a flat cost. Sell-refund is 50% of what that specific copy actually cost (escalation-aware).

### Removed from the original room list

The original 9-room list above (Hall of Echoes, Healing Fountain, Necropolis Wing, Colosseum, Mirror Maze, Obelisk Room, Treasure Room, plus the existing additions Trap Room, Prison Block, Serpent Pit, Power Core, Secret Passage, Lava Floor, Collapsing Pillars) is **superseded by this redesign**. Their behavior either (a) maps onto a new room, (b) becomes a trap in a future Trap Factory pass, or (c) is dropped. The existing handler code remains in place as orphaned no-ops until a follow-up cleanup phase removes it.

The False Exit, Crypt, Armory, Barracks, Guard Post, Entry Hall, Boss Chamber, and Corridor are kept (with reworked behavior where noted).

---

## Minion types

Different types of minions/monsters should be placeable in my dungeon. minions/monsters that patrol certain areas, guard rooms, or hunt for adventurers themselves.

Beyond patrol/guard/hunt, here are some other ones to include:

1. **Sapper** — repairs traps and rooms between day (so adventurers can't just disable everything)
2. **Herald** — alerts other minions when it sees adventurers; weak in combat but force-multiplies
3. **Engineer** — buffs nearby traps and locked doors
4. **Scavenger** — collects dropped loot and drags it to a vault room (denies adventurers post-fight loot)
5. **Mimic Handler** — places fake loot piles that aren't mimics, just to mess with cartographers
6. **Whisperer** — spreads false rumors among adventurers (counters knowledge sharing)
7. **Cleaner** — removes corpses so adventurers can't loot/identify what killed their friends
8. **Mourner** — when allied minions die nearby, gains stacking damage buff (rewards letting the front line die)
9. **Echo** — Mimics the abilities of whatever it last saw an adventurer use. Killed a mage recently? It casts spells. Watched a knight block? It starts blocking. Changes behavior mid-fight based on what the party does first.

**And many more types that you unlock as you play.**

---

## Set-and-forget gameplay & visual feedback

This game is a set and forget type of game. Meaning that I set the rooms, traps, enemies during the night phase, then I watch the adventurers explore the dungeon during the day phase. To make watching the AI adventurers fun, we need clear visual feedback:

- **Knowledge Overlay**: A toggle that shows you which parts of the dungeon the "adventurers" currently know about. Rooms in "Red" are well-known (traps will be dodged), while "Blue" rooms are total mysteries.
- **Adventurer "Thought Bubbles"**: Small icons over their heads showing their current state: Searching, Scared, Greedy, Healing, Planning, and more.
- **"Replay" Ghost**: When a party returns to the dungeon, you see "ghosts" of their previous run, showing you exactly how they are using their new knowledge to avoid your old traps.

---

## Boss fight

If the adventurers make it to the final room (the boss room) they attempt to fight the boss. Depending on their health, status, and gear they may or may not win. If they kill the boss 3 times, the game ends and you start over at a level 1 dungeon. I dont control the boss during the fight and it should be an automatic fight. The abilities and mechanics I've chosen can help make this fight interesting. I (the boss) should have an evolution tree where I can choose to level up myself with the xp taken from fallen adventurers with new abilities or to changed boss room throughout the game. Abilities and changes for example:

1. **Summon adds** — boss can randomly spawn specific add during the fight
2. **Environmental hazards** — boss room gains unique mechanics (lava floor, falling pillars, and more)

**And more.**

---

## Mana / Essence economy ~~(REMOVED)~~

~~Mana/Essence economy where every room, trap, and minion has an upkeep cost paid daily from XP harvested. Overbuild and your dungeon starts shutting off rooms.~~

---

## Architectural rules

Some traps need power from a Core room; ~~minions need a Barracks within N rooms~~ (deviation noted 2026-05-25: minion placement proximity to a Barracks is no longer required — owning a Barracks still gates roster-slot capacity, but minions may be placed in any non-special room as long as a roster slot is free and the per-room cap isn't full); treasure rooms must be 3+ rooms deep. Layout of the dungeon should be a puzzle.

**Same-room combat rule (2026-06-02).** Combat is strictly **room-bound**: a minion, adventurer, or the boss can only attack a target that is in the **same room** — nothing trades blows across a doorway or wall, melee or ranged. Ranged classes (Mage, Black Mage, etc.) still fire across their *own* room, but never into the next one; a hunter must enter the target's room before it can swing. (Corridors are rooms, so two entities sharing a corridor still fight.) Enforced at the single combat chokepoint `CombatSystem.tryAttack` (a same-room gate alongside the existing on-a-doorway-tile gate); the AI engage paths mirror it — adventurers only target same-room minions, and minions path through the door before swinging rather than pacing at the threshold. Traps (own LOS/room logic — projectile traps already stop at doors) and the boss-fight scene are unaffected.

---

## Boss archetypes

> **(deviation noted: superseded by "Monster boss redesign" below — keeping the original 15-archetype list as historical reference. New direction is 10 specific monster-type bosses, each with one strong headline mechanic that changes how the game feels to play.)**

At the game start I should be able to pick a boss archetype type that I play as. Picking a boss type can change which dungeon mechanics im offered and what my minions are good at. For example:

1. **The Lich** — undead synergies, soul economy, weak to clerics (interesting!)
2. **The Architect** — bonus rooms, cheaper traps, weaker minions
3. **The Beast Lord** — minions level faster, no traps available at all
4. **The Trickster** — every room can have a "lie" version, illusion-based
5. **The Tyrant** — fewer room slots but minions are 2x stronger

**And more, maybe about 15 total.** This gives runs identity and creates strong build paths. The game can start with 5 different ones, and then unlock more as you do better in the game.

---

## Monster boss redesign (replaces the 15-archetype system)

Replaces the 15 archetypes with **10 specific monster-type bosses**. Each has one or two *playstyle-defining* abilities — no padding modifiers. The goal: every pick should change which rooms you build, which minions you favour, and what the win condition feels like.

**Spec locked 2026-05-02.** Implementation in progress as one coherent phase.

### 1. Beholder Tyrant — Geometry / sightlines
- **Petrify Gaze.** During the BossFightScene only, the boss freezes adventurers for 2 seconds every 6 seconds. VFX: an eye-beam from the boss to each target with a stone-crackle overlay on the frozen adv.
- **Anti-Magic Aura.** Each day, 2 random rooms are marked anti-magic — classes inside them lose all abilities for the day. The count goes up by +1 each boss level. VFX: a faint purple glowing aura around the marked rooms.

### 2. Demon Lord — Faustian sacrifice
- **Sacrifice Pact.** A "Sacrifice" fire button on the boss UI. Clicking it fires immediately — no minion-pick step: the game auto-chooses the minion to burn, with a **50% chance it burns a free Hellgate Imp** (when any exist) and otherwise a random dungeon minion. The burned minion permanently dies (no respawn) and a system-chosen random adventurer in the dungeon is instakilled. 1×/day, resets at dawn. If zero minions exist, the button greys out. The burned minion plays a fire-burn death VFX. *(deviation noted 2026-05-20: was a click-then-pick-a-minion flow; changed to auto-sacrifice with the 50% imp bias so the Demon's two abilities synergise — Hellgate feeds Sacrifice cheap fuel.)*
- **Hellgate.** A permanent infernal portal appears in a corner of the boss room. Each dawn, N free Imps spawn from it, where N = boss level. Imps have 10% of `imp1` base stats at boss level 1, gaining +10% per boss level (no cap). Imps persist forever (until killed), do NOT count toward the minion cap, and roam the dungeon — they don't sit in the boss room. Use the `imp1` sprite.

### 3. Predator Myconid — Slow squeeze
- **Spore Network.** Every 3 days, all Corridor rooms release a poison cloud for the entire day. Any adv inside takes `0.5 × bossLevel` HP damage per tick. VFX: a faint green cloud with floating spores filling the corridor room.
- **Corpse Bloom.** Every adventurer corpse becomes a green-tinted fungal corpse (the last frame of their death animation, tinted green) that lingers for 3 days. Advs that touch the corpse take -2 HP/sec poison until they die or leave the dungeon (poison ticks stack across multiple corpses). After 3 days the corpse turns into a free Vinekin sprout minion (uses `plant1`, doesn't count toward minion cap). The corpse despawns immediately if its room is moved. **Hard cap of 3 simultaneous fungal corpses** — new adv kills past the cap simply don't drop a corpse (Myconid was over-tuned otherwise). **Sprouted Vinekins are one-shot** — if killed, they don't respawn at the next night phase; you only get a new one when another corpse blooms.

### 4. Dark Wraith — Psychological warfare
- **Fear Meter.** Every adv tracks a fear value. +5 per adv corpse seen, +10 per trap triggered, +5 per minion sighted, +15 when an ally dies in front of them. VFX: a small floating fear bar above the adv's head, positioned just above or below the HP bar (no overlap).
  - **At 50% fear:** flee to any random room (could even path away from the exit).
  - **At 75% fear:** attack other adventurers, persistent for 5 seconds.
  - **At 100% fear:** die instantly. Drops gold equal to a normal kill, but boss gets no XP.
- **Haunting.** When an adventurer dies in a room, a free Ghost minion spawns there (uses `ghost2`, doesn't count toward minion cap). Ghosts patrol their spawn room. They can detect adventurers in adjacent connected rooms and move directly through walls into that adjacent room to fight, then return to the spawn room if alive. **Hard cap of 5 simultaneous Haunt ghosts** — adv kills past the cap don't spawn one. **Killed Haunt ghosts are one-shot** — they don't respawn at night; the boss must claim a fresh adventurer to fill an empty slot. **Haunt ghosts cannot evolve** — they're locked to `ghost2` regardless of kills (no condition-based or kill-count evolution).

### 5. Gnoll Alpha — Snowball aggression
- **Hunters Pack.** The boss room has a free Tier-1 Gnoll minion (`gnoll1`) that respawns each day if killed. A new free gnoll is added at each boss level up to a maximum of 5 (Lvl 5+ = 5 gnolls). They do NOT count toward your max minion limit. They can still evolve normally if they rack up enough kills without dying.
- **Bloodlust.** Every minion or boss kill in the dungeon adds +3% ATK to ALL gnolls for the rest of the day, no cap. Resets at dawn. VFX: a red flash on each gnoll sprite + a small "+3% ATK" floater each time it stacks.

### 6. Earth Golem — Build-wide turtle
- **Living Architecture.** Each placed room (boss room + corridor rooms count) gives the boss +5 max HP and +1 DEF, permanently. Want a tank? Build a palace.
- **Earthquake.** A new "Earthquake" button in the boss UI, available 1×/day during the day phase. Click the button, then click a target room — every adventurer inside takes damage equal to (total rooms placed × 2). No cap. A first-time-use notification surfaces when the player gains the ability so they know how to use it. VFX: the targeted room visibly shakes when triggered.

### 7. Elder Lich — Death economy
- **Phylactery.** Unlocks at boss level 3. A "Heart" item appears in the items menu (free to place, no gold cost) — placing it in any room gives the boss a 4th life. A pop-up notifies the player when this unlocks. The heart has 200 HP, doesn't heal back to full each day, and uses the heart-full sprite. Adventurers always have knowledge of the phylactery; on dungeon entry there's a 15% per-adventurer roll to make hunting it their goal — entering its room they attack it like a minion. **Only one heart can exist at a time, and it cannot be replaced if destroyed.** Moving it costs a full day. The boss's 3 normal lives still apply: when the boss has zero normal lives left, every party from then on enters specifically searching for the heart instead of the boss. The game ends only when both the normal lives and the heart are gone.
- **Necromancy.** Every adventurer killed in your dungeon raises as a free Skeleton minion at the following dawn (so a kill on day N spawns the skeleton at the start of day N+1). The skeleton lasts until the end of the day after that (i.e. it gets one full day of life). It retains its class abilities — dead Mages still cast spells (now via cooldowns, not mana), dead Clerics heal *your* minions, and so on. Skeletons do not count toward the minion cap.

### 8. Serpent Captain — Ambush + bleed
- **Camouflage.** All Lizardman minions and traps are completely invisible to adventurers until they attack once (each minion / trap loses camouflage individually on its first attack). The player still sees them, rendered slightly transparent to indicate camo state. Advs cannot path-plan around what they cannot see.
- **Venom Stack.** Every Lizardman minion attack applies a poison stack on hit. Each stack ticks -1 HP/second; stacks add (3 stacks → -3 HP/sec). Stacks persist until the adventurer dies or leaves the dungeon. VFX: a green tint on the poisoned adv sprite plus a stack-count number above their head.

### 9. Orc Veteran — Veteran scaling + Warband
- **Loot the Fallen.** Every orc minion permanently keeps +1 ATK per adventurer it kills, no cap. Stays on that individual orc; lost when the orc dies (does not transfer to a respawn). Carries through the entire run otherwise. VFX: a small badge on the orc sprite showing its current loot-ATK count.
- **Warband.** Orcs in the same room give every other orc in that room +5% ATK and +5% DEF. Stacks per ally, no cap (5 orcs in one room → +20% / +20% on each). Encourages dense orc rooms instead of spread garrisons. (Locked 2026-05-02 to replace the scrapped "WAAAGH!" idea.)

### 10. Vampire Sovereign — Charm + boss-centric
- **Charm.** At the start of each day, the system marks one random adventurer in the day's incoming party with a charm VFX. They leave their party, walk to the boss room, and are converted into a Thrall — same class and abilities as the original adventurer, using the `vampire_minion1` sprite. Thralls patrol the entire dungeon hunting other adventurers. **They close any door behind them after passing through; if it was a locked door, it relocks.** This door-locking behavior applies to all patrolling minions in the game (Thralls, Imps, Ghosts, etc.). Thralls survive across days, do not respawn if killed, and persist until killed.
- **Blood Tax.** Your minions still hit advs for damage normally, but instead of just subtracting HP from the adv, the damage is routed to the boss to restore HP. Advs still die from minion hits; the boss heals from each hit. The boss's own attacks work normally. VFX: a faint red streak from each adv being hit, flowing back to the boss sprite.

### 11. Succubus Queen — Shapeshifter + seductress
*(deviation noted: added after the 2026-05-02 ten-boss spec lock — the roster is now 12 (Succubus Queen + the locked-until-L99 Slime). Doppelgänger replaces the original placeholder second ability "Bat Form" — a fly-through-walls footnote of Bat-Form Seduction, not a distinct ability. The bat-form flight gameplay is kept as-is; only the second-ability slot's design changed. Locked 2026-05-22.)*
- **Bat-Form Seduction.** Once per boss level per day, the Queen shapeshifts into a bat-swarm and flies to an adventurer — through walls and door locks — to charm them. The charmed adventurer turns on their own party until they kill an ally.
- **Doppelgänger.** Boss-fight only. The Queen hides among illusory seductive duplicates. Each combat round the party's pooled damage may land on a decoy instead of the real Queen — the decoy shatters and the boss takes no damage that round. Odds scale with decoy count (with D decoys, D/(D+1) chance the round is wasted on an illusion). Once every decoy is gone the Queen is exposed and takes full damage — until she re-splits, conjuring a fresh set of decoys each time her HP crosses a phase threshold (75% / 50% / 25%). Decoy count is 2 at boss level 1, +1 every 3 boss levels, capped at 4. VFX: translucent pink duplicate sprites flank the Queen and mirror her animation; each shatters with a fade + puff and an "ILLUSION" floater, and a re-split fans out a fresh set with a puff burst + "SHE SPLITS" floater.

### Niche coverage

| Boss | Playstyle |
|---|---|
| Beholder | Geometry / fight-scene control |
| Demon | Sacrificial trades + free fodder |
| Myconid | Slow squeeze, terrain hazards |
| Wraith | Fear-driven attrition + ghost economy |
| Gnoll | Boss-room pack + day-long snowball |
| Golem | Build wide, boss = dungeon size |
| Lich | Hidden 4th life + recruit from kills |
| Lizardman | Ambush + bleed-out DoT |
| Orc | Veteran orcs scale forever |
| Vampire | Boss is the fighter, minions feed it |
| Succubus | Charm flips a hero; illusions stall the boss fight |

### Implementation notes
- All locked specs above are JSON-loaded by `src/data/bossArchetypes.json` (read into the bestiary by `ArchetypeSelect.js`).
- Implementation order (locked 2026-05-02, ascending complexity / shared infra):
  1. Orc — Loot the Fallen (smallest, no new AI)
  2. Golem — Living Architecture + Earthquake (UI button + room-targeted damage)
  3. Beholder — Petrify Gaze (BossFightScene only) + Anti-Magic Aura room flag
  4. Lich — Phylactery (heart item + 4th life routing + adv hunt goal)
  5. Lich — Necromancy (raise-as-skeleton + class retention)
  6. Lizardman — Camouflage + Venom Stack DoT
  7. Myconid — Spore Network + Corpse Bloom (reuses DoT)
  8. Wraith — Fear Meter + Haunting (new AI overrides + ghost wall-phase)
  9. Demon — Sacrifice Pact + Hellgate (introduces patrol AI infra)
  10. Vampire — Charm + Blood Tax (patrol thralls reuse Demon's patrol infra; door re-lock applies to all patrollers)
  11. Gnoll — Hunters Pack + Bloodlust (depends on free-minion infra from Hellgate; Bloodlust simple)
- Door re-lock behavior must be a generic patrolling-minion property, not a vampire-thrall-specific hack.

---

## Loot stories

Every piece of gear in the dungeon should have a story. For example: When a Knight dies dropping his Flameblade weapon and i re-equip that Flameblade onto a Skeleton minion, the knights brother could only want to enter the dungeon to specifically hunt down that skeleton to reclaim his brothers weapon.

- So gear should remember its history (for example: small text: "wielded by Sir Aldric, killed in Room 7")
- Adventurers having vendettas against specific minions ("avenge my brother" quests)
- Cursed loot you can deliberately let them take, that hurts them

---

## Trap types

**SCRAPPED 2026-05-20 — the original 9 interaction traps below never shipped (`trapTypes.json` was always empty). They are fully superseded by the "Trap types (current roster)" section that follows.** History preserved:

1. ~~Greed Trap~~ · 2. ~~Whisper Trap~~ · 3. ~~Patience Trap~~ · 4. ~~Speed Trap~~ · 5. ~~Mercy Trap~~ · 6. ~~Torch Trap~~ · 7. ~~Echo Mine~~ · 8. ~~Memory Trap~~ · 9. ~~Curse Brand Trap~~ — *(all REMOVED 2026-05-20)*

---

## Trap types (current roster — 2026-05-20 redesign)

8 traps. Each takes 1 Trap-Factory slot. None may be placed in the boss room or the entry hall. The Trap Factory (gateway room) unlocks at **boss level 3**; the traps then unlock progressively from level 3 to 8. Gold costs run **20–55** at base and scale **+20% per boss level** (mirroring minion cost). **Trap damage scales +12% per boss level** so traps keep pace with the toughening adventurer waves — the same idea as minion attack scaling.

| Trap | Unlocks (boss lvl) | Gold |
|---|---|---|
| Spike Pillar | 3 | 20 |
| Shooting Arrows | 4 | 30 |
| Rotating Blades | 4 | 25 |
| Bomb | 5 | 35 |
| Saw Blade | 6 | 35 |
| Spike Pit | 6 | 40 |
| Cannon | 7 | 45 |
| Dragon Trap | 8 | 55 |

1. **Shooting Arrows** — Wall-mounted; cannot sit on a doorway. Shoots an arrow when an adventurer enters its line-of-sight lane. Small impact damage + a poison damage-over-time effect lasting 10 seconds. Infinite use, never breaks. While placed, the wall segment cannot become a doorway (rooms can't connect there) until the trap is moved.
2. **Bomb** — Placed on a single floor tile. When an adventurer comes within 2 tiles, a ~3-second fuse starts, then it explodes — major damage to all minions AND adventurers within a 5-tile radius. Breaks after exploding (does not respawn). Has collision; minions and adventurers path around it.
3. **Cannon** — Placed on a 2×2 floor area. Shoots a cannonball when an adventurer enters its line of sight. Rotatable with R (4 facings). Has collision. Infinite use, never breaks.
4. **Spike Pillar** — Placed on a 2×2 floor area. Shoots spikes outward, damaging anything within 1 tile of the body. Has collision.
5. **Dragon Trap** — Wall-mounted; cannot sit on a doorway. Shoots fire when an adventurer enters its line of sight; heavy fire damage. Infinite use, never breaks. Blocks doorway connection at its segment until moved. North/south variant (faces down — flip vertically for south walls) and left/right variant (faces right — flip horizontally for right walls).
6. **Spike Pit** — Placed on a 2×2 floor area; must be fully interior (no tile of the footprint adjacent to any wall or door). Disguised until stepped on, then the spikes reveal. Heavy damage with a chance to instantly kill. Once triggered it stays revealed for the rest of the day; adventurers who know about it route around. Re-hides at the start of the next night phase.
7. **Rotating Blades** — Placed on a 2×2 floor area. Constantly spinning. Has collision; damages any adventurer in a tile adjacent to the body.
8. **Saw Blade** — A saw that constantly travels back and forth along a straight track. Heavy damage to any adventurer the blade overlaps. No collision (the track stays walkable).

**Trap knowledge.** Adventurers only learn a trap's location once it has been triggered, or once an adventurer takes damage from it and survives. Until then they path normally and may walk straight into it. Once a trap is known, adventurers carrying that intel route around its danger zone.

**Friendly fire.** Area/contact hazards (Bomb, Spike Pillar, Rotating Blades, Saw Blade, Spike Pit) damage both adventurers and the boss's own minions. Line-of-sight projectile traps (Shooting Arrows, Cannon, Dragon Trap) only hit adventurers — their projectiles fly over minions.

---

## Progressive unlocks

As you play the game you should not have access to all rooms, minion types, and so on. As the dungeon levels up, so should your options of rooms and minions and traps and more that you can place.

---

## Reputation system ~~(REMOVED)~~

~~The game gets harder over time through a reputation system. The dungeon gets a Reputation Score — a public legend that grows as adventurers tell stories of their failures to other adventurers. High rep attracts better loot hunters, legendary heroes, and guild raids. Low rep makes solo scrubs feel confident enough to attempt it.~~

---

## Bounty hunters

After a minion kills 3+ adventurers, bounty hunters specifically enter the dungeon to slay it. The minion or monster can get a wanted poster and the poster includes the minion's name, kills, and current gear — making that minion feel famous.

### Bounty hunter spec (2026-05-20, gating tightened 2026-05-25)

- A minion earns a **bounty** at 3+ kills (`hasBounty` flag). The bounty persists until the minion dies.
- A bounty hunter only enters when a wanted minion has **evolved** (its `evolutionHistory` is non-empty) — the kingdom only pays for trackers when the target is dangerous enough to warrant one.
- When eligible, each day rolls `BOUNTY_TRACKER_SPAWN_CHANCE` (≈1 in 4) to spawn a **bounty hunter** as an extra arrival on top of the normal wave, targeting that minion specifically (it hunts the minion, then the boss if the minion is already dead).
- **Suppressed during any active dungeon event** (Tournament, Saboteur, Twitch Con, Cosplay Contest, PATCH 0.0.0, Guild Raid, Infamy Spike, Negotiation REFUSE). Replacement events (Loot Goblin, Speedrunner, Cartographer, Rival Dungeon, Zombie Horde, Bounty Hunters event pack) replace the wave entirely so the tracker doesn't even check.
- On entry, a **top-of-screen event banner** announces the hunter and names the targeted minion.
- The per-day tracker is **stronger than the event pack** — scaled by boss level, then buffed by `BOUNTY_TRACKER_HP_MULT` / `BOUNTY_TRACKER_ATK_MULT` (above the event-pack `BOUNTY_HUNTER_HP_MULT` / `BOUNTY_HUNTER_ATK_MULT`) so the rarer appearance still bites.
- Killing a bounty hunter (either path) pays out **extra gold** (`BOUNTY_HUNTER_GOLD_MULT`).
- The HUD marks bountied minions: a gold ★ in the Minion Roster (and the ★ + level badge above the minion in the dungeon view).
- Bounty hunters wear **dedicated LPC sprites** — a dark, leather-armoured, hooded, crossbow-carrying look, with sunglasses + a scarf on every variant (24 variants baked from the `bounty_hunter` recipe in `tools/lpc-pools.mjs`). Gameplay class stays `ranger`; only the spritesheet differs (assigned via `spriteVariant` at spawn).

---

## Adventurer resources

Adventurers should also enter the dungeon with limited resources. For example, a ranger has a limited number of arrows before they decide to leave the dungeon and come back another day. Casters (Mage, Cleric, etc.) ration their abilities through per-instance cooldowns + per-day usage budgets — heavy spells only fire a few times per dungeon run. Adventurers can bring in health potions to heal themselves, but may run out and become more vulnerable to death. And more like this. (deviation noted: original "mana pool" mechanic was removed — replaced with the cooldown / usage-budget system in the Class ability rework. See § Class abilities.)

---

## Dossier system

Before each day, I see a "Dossier" on incoming adventurers — class, personality, known history, gear. Not everything is shown: question marks appear for unknown attributes.

---

## Minion naming

When a minion levels up for the first time, the game generates a name for it based on its kill history ("Grumbolt the Mage-Slayer"). Players can rename them. Named minions feel like pets — their death hits harder, and bounty hunters targeting them feel personal.

---

## End-of-Day newspaper

After each day, a generated newspaper-style summary: "Party of five reduced to sole survivor" / "Local dungeon traps adventurer in false exit for 3 hours." Tone is dryly comedic. Shares secrets adventurers are now spreading about your dungeon.

---

## Trap memory UI

Traps that have been triggered show a small "spent" icon. Traps adventurers know about (via cartographers or survivors) show a different icon from your boss view. You can see exactly what they know, enabling counter-placement.

---

## Post-run eulogy screen

When the boss is finally slain and the run ends, show a cinematic eulogy — the dungeon's history, every named minion's kill count, every notable moment. And more. Makes starting a new run feel earned rather than like a loss screen.

---

## Adventurer graveyard UI ~~(REMOVED 2026-05-31)~~

> **REMOVED 2026-05-31.** The standalone graveyard browser (the Phaser `Graveyard` scene) was deleted in the DOM-HUD cleanup. It had been unreachable for a while — its only entry points were the old GameOver scene's "GRAVEYARD" button and a NightPhase debug shortcut, both since retired, and the DOM HUD never added a replacement. The dead-adventurer **data** (`gameState.adventurers.graveyard`) lives on and still surfaces in the Game Over eulogy, the Full Log, and the Post-Wave summary. The original spec is preserved below; re-introducing the screen as a DOM overlay is a possible future feature.

A persistent screen outside of the main dungeon view that shows every adventurer who has ever died in your dungeon. Their name, class, personality, how they died, what killed them, and how far they got. This costs almost nothing to build but adds enormous emotional weight to the game. Players will start recognizing names, feeling bad about killing certain adventurers, and celebrating when a recurring nemesis finally falls. It also makes the gear history system you already planned feel much more meaningful when you can look up exactly who Sir Aldric was before his Flameblade ended up on your skeleton.

---

## Sprite-based dungeon tiling

I want to be able to upload sprite tiles and place them over the current dungeon walls, doors, and floors. This means a tileset editor where I can drop in PNG sprite tiles I've already made (no slicing — they're individual files), build named **themes** out of them, and apply different themes per room.

**Sprite library — what I can upload:**
- 32×32, 64×64, and 128×128 PNG tiles. Each tile gets a per-sprite **scale-down vs span** toggle: scale-down means the sprite shrinks to fit one 32×32 cell; span means a 64×64 covers a 2×2 block, a 128×128 covers a 4×4 block (useful for doorframes, statues, oversized features).
- Multiple variants per slot. The renderer rolls a random pick per cell at dungeon-build time so floors and walls don't all look identical.

**Theme — slot vocabulary:**
- Floor (variants)
- Wall variants per autotile slot: top, bottom, left, right, four outer corners, wall cap (10 wall slots, each with variants)
- **Doors — 24 slots per theme**: 3 states (closed / open / locked) × 2 orientations (vertical / horizontal) × 4 tiles per door (since doors are a 2×2 block in this game)

**Per-room editing:**
- Edit room **templates** in `rooms.json` — each Foyer everywhere gets the same tile arrangement, baked in.
- Theme is assigned per-room (every room template can pick its own theme).
- Per-cell overrides on top of the theme — paint individual 32×32 cells in a room template with a specific sprite from the library.
- **Per-cell rotation** — when painting a cell, the user can rotate the brush in 90° steps (0 / 90 / 180 / 270). The same sprite can be painted at any of the four rotations across different cells of the same room. Cell entries in `tileLayout` are either a plain sprite-id string (= 0°) or an object `{ id, rot }`.
- **Per-cell mirroring** — independent horizontal and vertical flip toggles on the brush. The painted tile reflects across the chosen axis (or both). Combines freely with rotation. Stored on the cell entry as `flipH` / `flipV` booleans (omitted from the entry when false).

**Persistence:**
- Themes and sprites ship with the game. Editor writes PNGs and JSON manifests directly to the project folder via the browser's File System Access API (one-time folder pick per session). Per-room overrides save back to `src/data/rooms.json`.

**Theme presets:**
- Multiple named themes co-exist (e.g. stone-crypt, mossy-cave, hellfire). Switching a room's theme swaps its sprites without touching layout.

---

## Other ideas

1. Random guilds can attempt the dungeon with full raid teams.
2. Adventurers can sometimes fight among themselves and kill each other or fight over loot, giving me free xp if they die.
3. Different modes for the game: **Endless mode** = survive as many days as possible, leaderboard. ~~**Challenge runs** = "no traps allowed," "only undead minions," "all adventurers are raid groups," etc.~~ *(deviation noted 2026-04-28: challenge-run modes removed — no traps / all raids / hardcore toggles dropped from boss-select. Future bosses' built-in mechanics already cover that design space.)*
4. Combat log that's readable, not a spam wall — Slay the Spire-style condensed events.
5. Chat bubbles for adventures talking to themselves or to other party members.
6. Time controls during the day phase — pause, 1x, 2x, 4x speed, plus auto-pause on key events (boss fight, party wipe, mechanic triggered).
7. Adventurer last words / dying screams that reference what killed them ("I should've listened to Marcus...").
8. Lots of personality interactions between adventurers.
9. A leaderboard that keeps track of all players gameplay progress with information like: what level did the dungeon get to, how many adventurers killed, what archetype were you playing, and more.

---

## UI / HUD overhaul (2026-05-01)

A full visual reskin of the user interface, locked from a Claude Design handoff bundle (`Quest Failed.html` prototype, Crypt theme variant). Gameplay is unchanged except for three new build-mode actions (Sell / Move / Rotate) and minor data plumbing for run history. The bestiary boss picker (ArchetypeSelect) is **not** touched.

### Visual system

- **Theme: Crypt** — cold stone grays, blood-red accent (`#b03a48`), soul-cyan (`#6fd8d8`), bone-white ink (`#d8d2c2`). The previously-reverted Dark Codex used parchment/gold; this is intentionally distinct (cool stone, not warm parchment).
- **Fonts:** "Press Start 2P" for headings/labels, "VT323" for body text and numbers. Both loaded from Google Fonts.
- **Pixel chrome:** hard 2px bevels (highlight on top/left, shadow on bottom/right) with a 2px black outer outline. No gradients. 4px pixel grid. `image-rendering: pixelated`.
- **Tabs / buttons / build slots / bars** all share the bevel system. Selected build-slot has accent-coloured outline at 2px-out + 2px black-out-out.

### Title screen — split-screen, run-state-aware

- 1.4:1 split layout. **Left:** cinematic dungeon scene (faint, scaled, scanline overlay) with giant `QUEST / FAILED` title stack at bottom-left and an `EARLY BUILD · v0.x.x` corner stamp.
- **Right:** dark menu panel showing the current run's boss name + class + run readout ("Day 7 · Wave 3 / 10 · 47 kills · 4 escaped"), then a 6-button menu, then a flavor quote, then a version footer.
- **Menu actions** (top to bottom):
  - `CONTINUE` — resume the active run (primary). Subtitle "Resume Day N".
  - `NEW EVIL` — opens the bestiary boss picker (existing ArchetypeSelect screen, unchanged).
  - `DUNGEON ARCHIVE` — leaderboard (stub for now, button does nothing).
  - `OPTIONS` — opens new Options scene.
  - `QUIT` — closes game.
  - The design's "Bestiary" entry is dropped (ArchetypeSelect already serves that role).

### Main HUD layout (replaces current chrome)

The HUD is laid out as a single grid:

- **Top bar (3 columns):**
  - Left: boss avatar + class/day caption + boss name + boss HP bar. Clicking the avatar opens the **Boss Overview** popup.
  - Center: `WAVE n / N` caption + wave-progress bar. (No "QUEST FAILED" branding text — redundant in-game.)
  - Right: Gold readout. The Treasury panel shows Gold only.
- **Left column:**
  - Mini-map panel (top).
  - Build menu (below): tabs `ROOMS / MINIONS / TRAPS / ITEMS`, 2-col slot grid. ITEMS tab renders an empty grid with "Coming soon" caption.
- **Center:** dungeon scene (existing renderer). Overlay strip top-left shows LEVEL / ROOMS / MINIONS counts. Bottom-left "PLACING …" caption appears when a build slot is selected.
- **Right column:**
  - Knowledge Pin panel (top, always visible) — top 3–4 leaked facts + EXPOSURE bar.
  - **Dungeon Log** (renamed from Combat Log, always visible, takes remaining space) — type-coded entries (kill / dmg / warn / know).
- **Action bar (bottom):**
  - `Rotate` — click button, then click a placed room to rotate it 90°. Free.
  - `Move` — click button, then click a placed room to pick it up and re-place it. Minions inside stay assigned to that room as it moves. Free.
  - `Sell` — click button, then click a placed room (refunds 50% of gold spent on the room AND the minions inside it) OR click a single minion (refunds 50% of just that minion's gold cost; the room stays).
  - `Roster` — opens the **Minion Roster** popup (replaces the design's "Repair" button — repair is not a feature).
  - Phase indicator (center) — current phase label.
  - `Begin Day` (primary, right side) — toggles night→day. During day phase, becomes `End Wave` (existing behavior).
  - `Knowledge` — opens the **Knowledge Map** popup.
  - `Adventurer Intel` — opens the **Adventurer Intel** popup (formerly "Pre-Wave Prep").
  - `Menu` (≡) — opens the redesigned **Pause Menu**.

Build menu is locked to the **left side** (no left/right toggle).

### New build-mode actions: Sell / Move / Rotate

These are gameplay additions, kept minimal:

- **Click the action button**, then **click the target room**. Acting button is the active "tool" until cancelled (right-click / Esc cancels).
- **Sell** — clicking a placed room refunds 50% of the gold spent on it and on every minion currently assigned to it, removing the room and those minions. Clicking a single minion (with no room sold in the same click) instead sells just that minion: refund 50% of its gold cost, remove it, leave the room standing. No undo.
- **Move** — picks up a room. Cursor follows; click a valid empty area to drop. Minions inside the room stay assigned to that room and travel with it. No cost.
- **Rotate** — rotates the selected room 90° clockwise in place. Minions stay. If the rotated footprint collides with another room, the action is rejected with a flash/warning. No cost.

### Adventurer Intel popup (replaces design's "Pre-Wave Prep")

A popup overlay (in-scene UI group), opened from a HUD button at any time during night or day phase. Title text reads `ADVENTURER INTEL`.

- **During day phase:** shows full intel on the adventurers currently in the dungeon (class, level, HP, knowledge tags).
- **During night phase:** shows the next day's incoming party. Detailed fields are masked as `???` unless the player has built a **Library** room — the Library reveals adventurer names, classes, levels, HP, and knowledge tags for the upcoming wave. (This is the Library's intel-providing role.)
- Includes the adventurers' **knowledge map** (what they know about your dungeon) — replaces the design's "Predicted Route" panel.
- Footer: a single `Close` button (no "Keep Building" / "Summon Dawn" — players use the existing Begin Day flow on the action bar).

### Boss Overview popup

In-scene popup, opened by **clicking the boss avatar** in the top bar.

- Boss card: portrait, name, class, HP bar, run stats (kills, damage dealt, waves survived, escaped advs, current day).
- **Boss unique ability** — displays the boss's signature ability (per `bossAbilities.json`). Pending full implementation per archetype, but the slot exists.
- **Active Pacts** (dungeon mechanics chosen this run): grid of cards with name, glyph, short description.
- **Dungeon Census:** counts of rooms / minions / traps / items / doors / paths with breakdowns.

### Minion Roster popup

In-scene popup, opened from the **Roster button** on the action bar (replaces design's "Repair" slot).

- Information-only — no Summon, Heal All, Reassign, or Dismiss buttons.
- **Sortable list** (left): name, class, HP bar, level, kills.
- **Detail panel** (right): selected minion's portrait, class, name, assigned room, HP bar, kill / damage / armor / speed stats, traits.

### Knowledge Map popup

In-scene popup, opened from the **Knowledge button** on the action bar. Replaces full-screen `KnowledgeScreen`.

- Full dungeon map with room overlays color-coded `FULL / PARTIAL / RUMOR / UNKNOWN`.
- **Intel Ledger** sidebar: one row per known fact, showing the fact + the adventurer who leaked it (`via {adventurerName} (esc Day N)`) + accuracy level.
- Legend at bottom showing the four accuracy tiers.
- No "Misinformation" or "Burn Intel" actions (not implemented).

### Post-Wave Summary popup

In-scene popup shown immediately after the last adventurer leaves on a given day. Splits the existing `EndOfDay` newspaper-only.

- Header: "DAY N CONCLUDED · QUEST · FAILED".
- Three panels: **Casualties** (per-adventurer slain-by + gold reward), **Resources Earned** (gold deltas, repair costs, net), **Dungeon Performance** (most lethal minion, most lethal trap, minions lost, traps triggered, avg adv survival, boss damage taken, new intel leaked).
- Footer: `View Combat Log` button (stub for now or links to log filter), `Continue ⏵` button.
- After Continue:
  - **If the boss leveled up that day** → opens **Dark Pact** popup.
  - **Else** → returns to night phase directly.

### Dark Pact popup (level-gated)

In-scene popup shown after Post-Wave Summary, **only when the boss leveled up on that day**. Replaces the unconditional EndOfDay mechanic-card screen.

- Header: "NIGHTFALL · CHOOSE ONE / DARK · PACT".
- **Three cards** (existing `DungeonMechanicSystem.getOfferings(3, ...)`), each showing glyph, rarity tag (Common/Rare/Epic/Legendary), name, description, flavor text.
- Buttons: `⟳ Reroll All (1×)` — rerolls the three cards once per night, then becomes disabled. `Seal the Pact ⏵` — confirms selected card. **No skip option.**
- **Black grimoire variant (Damned pacts, added 2026-05-28):** when this popup fires there is a **10% chance the grimoire is rendered solid black instead of purple**, in which case all three offered cards are drawn from the **Damned** pool (all-curse pacts — see "Damned Pacts" above). On a normal (90%) purple grimoire, Damned pacts can still surface mixed into the regular offer, drawn at Epic weight (the tier just before Legendary).

### Pause Menu redesign

The pause menu (currently bound to ESC) is moved to the action bar `≡ Menu` button (ESC still triggers it). Redesigned in the new pixel-bevel style — same options as today, new chrome.

### Options scene

A new full-screen scene reachable from `OPTIONS` on the title menu. Initial slate: audio volumes (master / music / SFX), graphics toggles (TBD), keyboard shortcuts reference. Skeleton ships even if some controls are stubs — door for future settings.

### Game Over screen

Rewrite of `GameOver.js`. Headline reads **"DUNGEON FALLEN"** (boss-perspective) instead of the design's "QUEST · WON".

- Three panels: **Final Tally**, **Pacts Sealed** (per-day timeline), **Built · Lost**.
- Footer: `View Combat Log` (stub or filter), `↻ New Evil`, `Main Menu`. (No Export Run.)
- **Animation:** content populates one element at a time, with numbers counting up. Sequence: header fade-in (~1.5s) → Final Tally rows fade in one-by-one with per-row count-up (~120ms between rows, ~600ms count-up) → Pacts Sealed timeline (~200ms per row) → Built / Lost (same as Final Tally) → footer buttons fade in. Total ~6–8s. **Pressing any key skips** to fully populated state. Sound hook reserved per row for future SFX.

### Run history plumbing (data-only, no behavior change)

To make the Game Over screen and Pacts panels meaningful, gamestate gains:

- `gameState.history.pacts: [{ day, mechanicId, rarity }]` — appended in EndOfDay when a pact seals.
- Per-minion: `lifetime: { kills, damageDealt }` if not already tracked.
- Per-adventurer: `escapeCount` (so we can name "biggest leak").
- Per-day rolling counters on `gameState.run.totals`: kills, dmgDealt, dmgTaken, advsKilled, advsEscaped, gold, souls, roomsBuilt, roomsDestroyed, minionsSummoned, minionsLost, trapsPlaced, trapsDisarmed.

Existing fields are reused where they exist; only missing fields are added. SaveSystem must serialize them.

## Adventurer emote bubbles (2026-05-01)

Adventurers occasionally pop a 32×32 three-frame speech-bubble emote above their head while exploring the dungeon. Sprites live in `assets/sprites/emotes/` and are 96×32 sheets (three 32×32 frames each). Each PNG filename indicates which game event can trigger it.

**Triggers (filename groupings → game event):**

- `random exploring*.png` — ambient roll while `aiState === 'walking'`. Periodic per-adv timer (~6–10s window).
- `discovered a new room.png` / `discovered new room.png` / `entered unknown room*.png` — `ROOM_OBSERVED` with `firstVisit: true` (adv has no prior knowledge of this room).
- `walked into known room*.png` — `ROOM_OBSERVED` with `firstVisit: false` (adv already had intel/knowledge).
- `entered boss room.png` — `BOSS_FIGHT_INCOMING`.
- `fighting minion or boss*.png` + `found minion*.png` + class-specific (`barbarian attacking.png`, `mage attacking*.png`, `monk attacking.png`, `cleric healing.png`, `ranger or bard attacking.png`) — adv enters `aiState === 'fighting'`. Class-specific variants are mixed into the pool when the class matches.
- `fleeing*.png` — adv enters `aiState === 'fleeing'` / `ADVENTURER_FLED`.
- `low health*.png` — HP fraction crosses below 30%.
- `found loot*.png` — `MIMIC_REVEAL_TRIGGERED` or `TREASURY_CHEST_GRAB_STARTED` (chest/mimic discovery; gear pickup no longer exists).
- `found something.png` — `TRAP_TRIGGERED` (or other "discovered a feature" hooks if added later).
- `breaking down door*.png` / `finding a locked door.png` — deferred (no current locked-door event in code).
- `ressurected.png` — `ADVENTURER_RESURRECTED`.
- `beast master successful tame.png` — `MINION_TAMED`.

**Display:** sprite floats inside the adventurer's container at y ≈ -52 (just above HP bar at y = -38), plays its 3 frames once at ~3 fps (~900ms total), then destroys. Inherits the container's spawn/leave fade automatically.

**Frequency:** each trigger has a **20% chance** to actually pop an emote — most events stay silent. Per-adv cooldown of ~1.5s prevents stacking.

**Priority:** if a higher-stakes trigger fires (fleeing / low_health / fighting / boss room) while another emote is already playing, the new one replaces the old. Random ambient never overrides a state-driven emote.

## Dungeon events (2026-05-05)

Random events that fire between days to break up the standard build/invade loop. Each event is announced at the start of the **night phase** so the player can prepare during build, then resolves on the following **day phase**. (Two events — Dark Deal and Loot Goblin Heist — manifest during the night phase itself; see notes.)

**Cadence (revised 2026-05-21):** the first event lands on **day 3**, then one every **3 days** (deviation noted: was 6–8 days). Same event cannot fire back-to-back (no-repeat window of 1 occurrence). Harder events — **Legendary Speed Runner, Rival Dungeon** — only become eligible from **boss level 3** onward; each event also carries a per-event `minBossLevel` gate. All other events available from the first eligible day. (The Tournament was also a boss-level-3 event but was removed 2026-05-21.)

### Initial event pool

**Guild Raid!**
- Notification: *"Your dungeon has been discovered by a local Guild."*
- Effect: On the next day phase, double the usual amount of adventurers will raid the dungeon. Spawned as **steady pressure** (longer wave, not a single surge) so early-game rosters aren't instantly overwhelmed.

**Legendary Speed Runner**
- Notification: *"A high-level, legendary adventurer is trying to set a 'world record' for clearing your dungeon."*
- Name is intentionally fourth-wall-breaking for humor.
- Effect: This adventurer has twice the stats of a normal adventurer and moves at 2× speed and ignores all non-essential rooms and minions while he looks for the boss. If you kill them, the Boss gains a massive amount of XP.

**Dungeon Pestilence**
- Notification: *"A disease has broken out among your minions."*
- Effect: All minions start the next Day Phase with 50% Health (applies to existing AND newly placed minions while the event is active). The disease is contagious — any adventurer who fights a minion in melee range becomes "Blighted," losing health over time as they explore until they die or leave the dungeon. Blight does NOT persist after the adventurer leaves.

**Cartographer's Convention**
- Notification: *"A group of scholars are on their way to map out the dungeon."*
- Effect: These adventurers don't care about the Boss; they want to visit every single room. They never go to the boss room. Once they have been to every room to gain all knowledge, they try to leave the dungeon. **Every room they map permanently raises that room's "infamy"** — future adventurers spawn with knowledge of those rooms' layouts. This gives the player a real reason to engage and kill them rather than ignore them.
- Asset note: create 3 different LPC adventurers specifically for this event. They should wear glasses and look like scholars.

**Blood Moon Eclipse**
- Notification: *"A rare celestial event empowers the dark arts."*
- Effect: Minions do double damage on the next day phase, but **also take double damage** (sharpened risk/reward) AND no gold is claimed from dying adventurers.

**Negotiation Day**
- The Adventurer's Guild sends a single diplomat — **no combat at all**. Modal popup at start of day:
  - **Pay tribute:** lose 25% of treasury, get a free day (no adventurers).
  - **Refuse:** next day's wave size +50%.
- Tests greed vs. risk; gives the player a real day off.

**The Tournament** — ❌ REMOVED 2026-05-21 (cut at player request; the rival-vs-rival bloodsport AI never read cleanly in play)
- ~~Three named rivals enter — they hate each other more than they hate you. They actively try to "claim" the boss kill, sabotaging each other (steal each other's loot piles, body-block, even attack each other when in the same room). Funnel them together and they self-destruct. Fail to exploit it and they steamroll you.~~

**Rival Dungeon**
- Effect: On this event day phase a rival group of random monsters will enter the dungeon instead of the usual adventurers. The last one to enter will be a big random boss from the boss pool looking for the player's boss to defeat in combat. Big XP and gold for killing the boss.

**Twitch Con**
- Effect: The following day, all adventurers will be **twitch_streamer** class (class already exists in `adventurerClasses.json`). Pure chaos. However, killing these ones will not cause extra adventurers to arrive the next day afterwards (no escalation penalty for this day's kills).

**Dark Deal**
- Effect: A demon appears in the boss room on the next **night phase** and offers you a free dark pact choice immediately. In return, the demon steals half of the boss's max HP only for the next day phase. Player can click the demon to choose a dark pact. If the player does not accept the deal and choose a pact, the demon leaves without taking anything.
- Asset: demon sprite + animation at `Quest-Failed assets/!To do/Demon.png`. The sheet has 4 rows — first two lines are the demon **appearing**, second two lines are the demon **leaving**.

**Cosplay Contest**
- Effect: On this day adventurers wearing monster outfits enter the dungeon. These adventurers should not attack minions unless they are attacked by them first. These adventurers have a 75% chance to not aggro a minion and they allow them to walk past them ignoring them.
- Asset note: will need some new LPC adventurers for this event that are wearing different animal and monster parts: zombie, skeleton, tails, wings, fantasy, beastman, farm animal, furry, undead, and/or reptilian parts. Just make sure they are colored correctly (e.g. reptilian should be green like a lizard).

**Loot Goblin Heist**
- Notification: *"A pack of Loot Goblins has broken into your treasure hoard!"*
- Effect: Instead of adventurers entering the front door, a group of Loot Goblins spawn in the **Boss Room** and try to run for the dungeon exit. Each one killed provides a large amount of gold and they will not stop to fight anything; they just look for the exit. **Any goblin that escapes the dungeon steals 10% of your current gold total** (per goblin, applied at exit time).

**Rival Dungeon — boss combat AI:** the rival boss uses **simple AI** (not the full BossArchetypeSystem behavior set) — basic chase + attack against the player's boss. Keeps the event scope contained.

### Event pool — 2026-05-21 expansion (15 new events)

Added for variety, spanning four buckets: player boons/choices, threat waves, day-long state modifiers, and economy/meta. Difficulty mix of punishing and risk/reward.

**Tax Season** — *minBossLevel 1.* The guild skims 20% of the treasury at day start, but every kill that day pays double gold.

**Patron's Blessing** — *minBossLevel 1.* Boss XP from every kill that day is doubled. A pure-upside breather.

**The Gambler's Coin** — *minBossLevel 1.* Night modal — WAGER (50/50: double the treasury or halve it) or DECLINE.

**Memory Plague** — *minBossLevel 1.* The shared knowledge pool is wiped at announce — the next wave walks in with no inherited intel.

**Dense Fog** — *minBossLevel 1.* All intel adventurers gather that day registers only as RUMOR tier — exposure barely rises. Grey screen wash.

**Creeping Miasma** — *minBossLevel 1.* Chip damage every 2s to everything: invaders bleed to death, minions are weakened (floored at 1 HP), the boss is whittled toward a 25% HP floor. Green wash.

**Tremors** — *minBossLevel 1.* Every 8s a quake rocks one random room — screen shake + a damage hit to everyone standing in it (lethal to invaders, non-lethal to minions).

**Arcane Storm** — *minBossLevel 1.* Adventurer class-ability cooldowns are slashed to 40% — the invaders' spellcasters fire relentlessly. Purple wash. (Boss-archetype abilities use a separate timer system and are unaffected.)

**Bounty Hunters** — *minBossLevel 2.* A 5-strong hunter pack replaces the wave, all locked onto the player's highest-level minion; buffed; reuses the baked bounty_hunter sprite.

**Zombie Horde** — *minBossLevel 2.* A 14-strong shamble of slow, weak, never-fleeing undead replaces the wave — they maul everything en route to the boss. Rendered with the zombie minion sheets (tiers 1–3, varied).

**Infamy Spike** — *minBossLevel 2.* The normal wave, +50% size, every adventurer buffed to hero grade (×1.6 HP / ×1.5 ATK / ×1.3 DEF) and carrying a `hero` tag (gold ring + ★ HERO badge).

**Black Market** — *minBossLevel 1.* Night modal — pay 50 gold for a free random unlocked minion delivered that night.

**Mercenary Contract** — *minBossLevel 2.* Night modal — pay 120 gold to hire an elite Tier-3 minion with **doubled stats** that fights for 3 days, then leaves. If it dies in battle it dies **permanently** (no overnight revive).

**Cursed Relic** — *minBossLevel 1.* Night modal CLAIM/BANISH. CLAIM drops a cursed Tier-5 treasure chest in the boss room (pays gold daily, glows purple-black) — but every adventurer wave is **doubled** while it sits in the dungeon (a daily toast announces the curse). Sell the chest to lift the curse.

**The Saboteur** — *minBossLevel 2.* A lone masked, all-black ninja-rogue replaces the wave. They are invulnerable and minions ignore them; they run trap-to-trap disabling every trap for the day (traps re-arm overnight), then flee.

---

## Companion NPC — Lilith (2026-05-21)

The game gets a permanent companion NPC named **Lilith** — a succubus dungeon-keeper who appears in the gameplay HUD and reacts to everything the player does and everything that happens in the dungeon. She is the player's constant in-game presence: part advisor, part commentator, part hype-demon.

**Role & personality.** Lilith is the boss's devoted dungeon-keeper. Her voice is **flirty and wicked, with a sarcastic and sinister edge** — she dotes on the player ("my liege"), revels in cruelty, flirts and teases through the fourth wall, dryly roasts a bad play, and lets real menace slip through now and then. She **breaks the fourth wall** — she knows the player exists, knows they are *playing a game*, and references their clicking, building, and watching directly.

**Presence.** Lilith is **always visible** during gameplay — a waist-up character peeking in from the **bottom-left corner** of the HUD, with an RPG-style chat bubble that opens up-and-right of her so it clears the build menu. She idles with a gentle breathing animation when silent.

**Reactivity.** Lilith reacts to *anything and everything*:
- **Player actions** — placing/selling/moving rooms, minions, traps, items; sealing pacts; blocked placements; beginning the day; opening panels; possessing a minion.
- **Game events** — adventurers entering/dying/fleeing/escaping, party wipes, minion kills/deaths/level-ups/evolutions, boss fights, boss damage, boss level-ups, grid expansion, traps triggering, intel leaking, dungeon events, bounty hunters, Heroes returning, archetype mechanics firing.
- **Ambient/idle** — when nothing is happening she fills the silence with context-aware musings (about the day count, the treasury, exposure, an idle minion) and fourth-wall asides.
- She has a **massive, ever-expandable bank of lines** so reactions stay fresh; the bank is data-driven JSON.

**Tutorials.** Lilith **fully delivers the tutorial messages** — the existing how-to-play hints are spoken by her as paged RPG dialogue ("▶ to continue"), framed as her teaching the player. The standalone tutorial popup is retired while she is enabled (it remains as a fallback when she is hidden).

**Expressions.** Lilith uses a set of **42 hand-drawn expression sprites** (one static image per mood). Every line she says is tagged with the expression that fits it, so her face always matches her words and the moment. Expressions cover the full range: happy, smile, excited, cute, flirty, sexy, winking, confident, proud, smug, mischievous, evil, cackling, laughing, commanding, building, determined, aggressive, angry, worried, scared, sad, crying, guilty, upset, impatient, bored, sleeping, thinking, smart/reading, surprised, shocked, stunned, level-up, happy-with-gold, and more.

**Hide option.** The options menu has a **companion control** so a player who does not want the NPC can hide her entirely. It is a three-way setting — **Off** (hidden completely), **Quiet** (only major reactions + tutorials), **Normal** (full reactivity, default).

**Intent.** Lilith should feel *alive* and be *fully implemented* — not a static decoration. The goal is a companion who makes watching the dungeon-sim feel like sharing the throne room with a delighted, dangerous friend.

### Lilith expansion (2026-05-21)

A second pass deepening her into a full part of the experience:

- **She delivers the intro.** On a new run, instead of a separate welcome popup, Lilith introduces *herself* — her name, her role as the boss's dungeon keeper — then explains the game's premise (you are the boss; build by night, defend by day; grow endlessly). The final beat is a choice she offers the player directly: allow her to give tutorial hints, or not. The old welcome modal remains only as the fallback when the companion is hidden.
- **In-bubble hint opt-out.** While she is delivering a tutorial hint, the bubble carries a small "turn off hints" control so the player can dismiss all future hints without opening the menu.
- **She appears beside menus.** Opening any of these menus — Knowledge Map, Boss Overview, Adventurer Intel, Minion Roster, the full Dungeon Log, Game Over, Post-Wave Summary, Boss Level-Up — makes Lilith step out **in full (full body) to the left of the menu**, where she comments on that menu and on how the run is going. She returns to her corner when the menu closes. The player should always feel her presence — she is a full part of the experience, not just a corner decoration.
- **She is the Dark Pact broker.** Lilith replaces the demon broker who previously presided over the Grimoire of Dark Pacts. When the nightly pact choice appears, *she* presents the three pacts — tempting, wicked, delighting in the bargain. The Grimoire book + card UI is unchanged; only the broker character becomes Lilith.
- **Sizing.** Her corner portrait was tuned slightly larger than the first minimised pass.

### Lilith dialogue expansion (2026-05-21)

A large content pass so Lilith comments on *specifics*, not just generic categories — and uses her full expression range far more. Delivered in batches:

- **Specific commentary.** She comments on the *specific* thing in play: the boss archetype the player chose, the specific dungeon event announced, the specific room / minion / trap / item placed (and sold and moved), and the specific adventurer class entering / dying / fleeing. Mechanically: a keyed "specifics" bank — when she has a bespoke line for an entity she uses it, otherwise she falls back to the generic category.
- **Build suggestions.** She acts as an advisor — surfacing context-aware suggestions during the build phase: what to spend gold on, that the dungeon has no traps, that exposure is high, where locked doors help, etc. Each suggestion is gated on a game-state condition.
- **Inactivity nudges.** If the player goes a long while without doing anything — no placements, no progressing to the next day — Lilith gets visibly bored and nudges them ("are we building, my liege, or admiring?"), escalating in impatience the longer they idle.
- **Game-system commentary.** She remarks on the game's systems as they surface — adventurers learning the dungeon (knowledge), minions evolving, bounties being posted, intel leaking, and so on.
- **Pacts.** Per-pact bespoke lines are intentionally *not* written for all 60+ pacts — the Grimoire pact-picker already carries rich per-rarity/per-tag broker dialogue she delivers; held pacts are referenced generically by name. A few legendary pacts may get named callouts.
- **More extras.** Playstyle meta-commentary (she notices the player's habits), streaks, last-life tension lines, day-milestone callouts, named-minion milestones, and reactions to the boss's signature archetype abilities firing.

The aim: every one of her 42 expressions sees regular use, and she always has something *specific* to say.

## Second companion — Malakor (2026-05-21)

The game gets a **second companion**, **Malakor**, built the same way as Lilith. The player picks *one* companion per run.

- **Personality.** Malakor has a different personality from Lilith: **rude, sinister, likes to roast the player — but also loyal**. Where Lilith dotes and flirts, Malakor is a gruff, contemptuous dungeon-keeper who insults the player's choices and mocks them — addressing the player throughout as the sarcastic honorific **"little king"** — yet would never abandon them. The insults are real; the loyalty is realer. *(Deviation noted 2026-05-22: Malakor's address was originally a mix of "boss" / "your dread majesty" / "little king"; at the designer's request it was consolidated to one consistent mocking honorific — "little king".)*
- **Sprites.** Malakor ships with **39 expression sprites** (vs Lilith's 42). His dialogue only uses ids he has. Source art: `Quest-Failed assets/Main NPC 2`, baked to `assets/npc-malakor/`.
- **Reactivity & dialogue volume.** Malakor reacts to **all the same things Lilith does** and has **close to the same number of chat-bubble messages** — a full parallel dialogue bank (`src/data/malakorLines.json`), authored in batches, with the same category + specifics structure as Lilith's.
- **Companion-select screen.** A new screen appears **after clicking NEW EVIL / start game and before the boss-select screen**, where the player chooses their dungeon-keeper companion between Lilith and Malakor. After confirming, the player proceeds to the boss picker. The screen shows the **full-body sprite of both companions**; hovering a companion **previews** it. The companions **react to being hovered** and have **chat bubbles** in which they talk to the player and try to convince them to pick them — in their own personalities and using their own expression sprites. The companion the player is *not* hovering reacts too (it heckles / sulks). The choice is remembered between runs and stored on the run's game state (`meta.companionId`).

## Boss-select screen — decorative surround (2026-05-22)

The boss-select screen (`ArchetypeSelect`) keeps its bestiary book + picker exactly as-is, but the empty black space around the book is dressed up in the companion-select screen's style:

- **Header.** A title above the book — eyebrow line `◆ THE DUNGEON NEEDS A MASTER ◆` and a large `PICK YOUR DUNGEON BOSS` heading, using the CompanionSelect screen's pixel font.
- **Atmosphere.** A dark edge **vignette** framing the book, a warm **candle-glow** radiating from the book, and slow **drifting embers** rising through the surround.
- **Footer instruction bar.** An instruction line (`HOVER A PORTRAIT TO STUDY IT … CLICK TO CLAIM YOUR BOSS … BEGIN RUN TO DESCEND`), and the **BACK** button restyled and moved into the bottom-left of this footer band.
- **Boss-accent tint.** The header eyebrow and the candle-glow **tint to the signature colour** of whichever boss the player is currently inspecting. *(deviation noted 2026-05-22: a pixel corner-bracket frame was added, then removed at the player's request.)*
- **Companion at the side.** The run's chosen companion **stands at the right edge** and **reacts to each boss the player hovers**, speaking a line from their own `specifics.boss` dialogue bank in a chat bubble matching the in-game companion bubble, swapping expression sprites to match.

## Third companion — Zul'Gath (2026-05-22)

The game gets a **third companion**, **Zul'Gath**, built the same way as Lilith and Malakor. The player picks *one* companion per run. *(A fourth companion is planned; the system is built to accommodate it as a data edit.)*

- **Character.** Zul'Gath is a **male dragon** — ancient, eons old, having watched a thousand dungeon-bosses rise and fall. His personality is a third distinct axis from the others: where Lilith offers warmth and Malakor offers harsh truth, Zul'Gath offers **perspective** — **dry, deadpan, languid, faintly condescending but fond, and unbothered by everything** (catastrophe is routine). He hoards treasure and takes the long view. He addresses the player as **"small one"**.
- **Fourth-wall breaking.** Zul'Gath **breaks the fourth wall** more centrally than the others: old enough to perceive the *loop* — the runs, the reloads, the player beyond the glass — which he regards with serene amusement rather than alarm.
- **Sprites.** Zul'Gath ships with **39 expression sprites**. Source art: `Quest-Failed assets/Main NPC 3 - Zul'Gath`, baked to `assets/npc-zulgath/`. His dialogue uses **all 39** — the panic/distress faces (`scared`, `crying`, `shocked`, `guilty`, `shame`) appear only sparingly, as rare dry cracks in his calm.
- **Reactivity & dialogue volume.** Zul'Gath reacts to **all the same things** as the others and has a **full parallel dialogue bank** (`src/data/zulgathLines.json`, ~1011 lines) — same category + specifics structure.
- **Recruit screen.** The CompanionSelect screen now shows **three** companions (room for four), and their recruitment bicker is a **round-robin squabble** — the turn rotates through every companion rather than a two-way back-and-forth. Lilith's and Malakor's banter banks gained cross-banter lines that reference Zul'Gath.

## Expanded expression sets (2026-05-22)

The three companions each received **more hand-drawn expression sprites**, and the dialogue banks were rebalanced so every new face sees regular use — existing lines re-tagged where a new face fit the words better, plus newly authored lines so each new expression is used roughly as often as the companion's established faces.

- **Lilith — 45 → 63 expressions (+18).** New faces broaden her doting/flirty range (`adoring`, `in-love`, `heart-eyes`, `lovestruck`, `affection`, `swooning`, `obsessed`, `obsessive-love`, `adorable`), her vanity (`changing-outfit`, `preening`, `tail-play`, `sexy-2`), and her wicked side (`cruel`, `menacing`, `sneering`, `disgusted`, `giggling`). Her redrawn `cute-2` / `mischievous` / `mischievous-2` art replaced the old versions in-place (same ids — a re-bake swapped the art).
- **Malakor — 40 → 43 expressions (+3).** `battle-roar` (combat fury), `menacing` (intimidation), `salute` (a war-sergeant's loyalty beat).
- **Zul'Gath — 39 → 45 expressions (+6).** All deepen his deadpan register: `smug`, `self-satisfied`, `superior` (lofty "above all this"), a second bored face (`bored-2`), and the rare reflective cracks `nostalgic` / `wistful`.

A follow-up pass then topped up the rarely-used *existing* expressions as well, so each companion's whole sprite set sees regular use — every expression is now used at least ~9 times, with the sole exception of a few genuine-distress faces on the stoic characters (Malakor, Zul'Gath) deliberately held rarer (a floor of ~6), since a gruff war-sergeant or an unbothered ancient dragon should only rarely show those.

Adding a sprite later stays a data edit: drop the PNG in, extend `tools/bake-npc-sprites.mjs`'s map, re-run the bake, append the id in `companions.js` + the bank's embedded `expressions` array, then re-tag/author lines so it gets used.

## Fourth companion — Safira (2026-05-22)

The game gets its **fourth and final companion**, **Safira**, built the same way as Lilith, Malakor and Zul'Gath. The player picks *one* companion per run. With Safira the companion roster is complete.

- **Character.** Safira is a **genie girl** — bound for eons to a lamp, freed only lately and thrilled to finally *do* something. Her personality is the fourth distinct axis: where Lilith offers warmth, Malakor offers harsh truth and Zul'Gath offers perspective, Safira offers **chaotic, dazzling over-eagerness**. Eons in the lamp left her a touch unhinged; she frames the player's every action as a **"wish"** she is granting (and tends to over-grant / embellish), and swings between giddy delight and theatrical panic. She addresses the player as **"Master"**.
- **Fourth-wall breaking.** Safira breaks the fourth wall **more than any other companion** — and differently from Zul'Gath. Where his meta-awareness is serene cosmic detachment, hers is **direct and intimate**: a wish-granting genie is literally a game character bound to serve whoever holds the controller, so she speaks straight to "Master out there", names the game's systems and UI by name, and treats saving / loading / respawns as lamp-magic.
- **Sprites.** Safira ships with **53 expression sprites**. Source art: `Quest-Failed assets/Main NPC 4 - Safira`, baked to `assets/npc-safira/`. Her dialogue uses **all 53**.
- **Reactivity & dialogue volume.** Safira reacts to **all the same things** as the others and has a **full parallel dialogue bank** (`src/data/safiraLines.json`) — same category + specifics structure, comparable line count.
- **Recruit screen.** The CompanionSelect screen now shows **four** companions. Safira sits **third — between Malakor and Zul'Gath — facing right** (toward Zul'Gath). The round-robin recruitment squabble now rotates through all four; the other three banks gained cross-banter lines referencing Safira.

## Unlockable companions + Nocturna (2026-05-25)

The companion roster expands beyond the original four — additional companions are **unlockable** as the player progresses (specific unlock conditions TBD per companion). The CompanionSelect screen keeps the original full-size cards and **paginates** the roster: **three companions are visible at a time**, flanked by ◀ / ▶ arrow buttons that swap to the next page of three.

- **Pagination.** Cards are at their original single-row size (no shrinking). The screen shows three at a time; arrow buttons on each side of the card row flip to the previous / next page. Arrows are **clamped** at the edges (disabled when there's no further page, no wrap-around). A row of dots under the cards indicates the current page (one dot per page, the active page filled). Keyboard nav: ←/→/↑/↓ cycle through *unlocked* companions across the full roster and auto-flip the page to follow the selection; PageUp / PageDown jump pages explicitly. Arrows are pinned to the screen edges (not in the card row's flow) so a wide companion sprite's overflow can never push them off-screen or visually cover them.
- **No banter on the recruit screen** *(deviation noted 2026-05-25: round-robin recruitment chatter was REMOVED — the chat bubbles ate too much vertical space and the bigger portraits the player wanted needed that room. Each companion's `recruit.banter` line bank stays in their dialogue JSON for the boss-select side panel and any future re-introduction, but it is no longer surfaced on the recruit screen itself. The recruit screen now shows pure portraits + name plates only — character / tagline / traits, no live conversation.)*
- **Locked-card visual.** A locked companion still renders in its slot — the player sees the character's **silhouette** (the sprite is dimmed + desaturated so the pose, outfit and colour palette stay readable; the face/details are muted). A pixel-art **padlock badge** sits in the portrait's top-right corner and the plate shows the companion's **name** plus a `◆ LOCKED ◆` caption (tagline + traits hidden). Locked cards are **inert** — no banter, no hover-handed-turn, no click selection. The intent is "teased, not hidden": the player sees *who* is coming and roughly what they look like, but not what they sound like or what their full character is.
- **Mystery placeholders.** When the visible roster doesn't divide evenly into pages of three, the **last partial page** is padded with neutral **"??? — COMING SOON"** placeholder cards (no portrait, just a giant `?` silhouette). Today: 5 real companions (4 unlocked + Nocturna locked) → 2 pages of 3, last page padded with 1 placeholder.
- **Unlock plumbing.** Per-player unlocked-companion list persists to `localStorage` under `qf.companions.unlocked:<name>` — name-scoped (refactored 2026-05-26 along with achievement storage). Each name gets its own slot, seeded with the starter companions on first read. The **cheat name** (`mango`) unlocks every companion in the registry. A new `PlayerProfile.unlockCompanion(id)` helper is the entry-point for individual unlocks once unlock conditions are wired up.
- **Fifth companion — Nocturna.** The first unlockable companion is **Nocturna**, a moonlit night-keeper (cat-girl witch carrying a grimoire). She ships **locked** on the recruit screen with only her idle portrait wired up — full expression bank, dialogue and unlock condition are deferred. Source art: `Quest-Failed assets/Main NPC 5 - Nocturna`, baked to `assets/npc-nocturna/`. Accent colour: twilight-violet (`#7c6cff` — distinct from Malakor's warmer purple).
- **Sixth companion — Luna.** Added 2026-05-26 as a second teaser slot next to Nocturna. Ships **locked** on the recruit screen with only her idle portrait wired up (same treatment as Nocturna). Full expression bank, dialogue, and unlock condition are deferred. Source art: `Quest-Failed assets/Companions/Luna`, baked to `assets/npc-luna/`.
- **Seventh companion — Rattle Bones.** Added 2026-05-26 as a third teaser slot; **fleshed out 2026-05-26** into a full companion equivalent to Lilith / Malakor / Safira / Zul'Gath. A **macabre jester skeleton** — three centuries dead, court jester turned crypt-comic, finds the whole death business hilarious. **He/him.** Voice: gallows humour, vaudeville delivery, theatrical and fourth-wall-breaking ("you're the audience, this is the show"), but underneath the bit is real practical advice and real fondness for the boss. Calls the player **"boss"** / **"pal"** / **"skull-pal"**. Tagline: *"Three centuries dead and still cracking jokes — the crypt's resident comic."* Accent colour: jester-yellow (`#ffe34d`). Expression bank: **46 faces** planned across 10 tonal registers (idle / laughing / mischievous / shocked / theatrical / quiet / dismissive / proud / affectionate / skeleton-physical-gags like `falling-apart`, `jaw-dropped`, `peace-sign`, `salute`). Source art: `Quest-Failed assets/Companions/Rattle Bones`, baked to `assets/npc-rattlebones/`. **Dialogue bank fully written** (`src/data/rattleBonesLines.json`, ~730 lines, all categories matching the other fleshed-out companions — including boss / advClass / event / room / minion / trap / item specifics sub-banks). Cross-banter added to all four sibling companions' banks (Lilith / Malakor / Safira / Zul'Gath). **Unlock condition (2026-05-26):** the `curtain_call` legendary achievement — *"Kill 100 adventurers with traps in a single run."* Thematic — a macabre jester wants a perfect setup-punchline show before he'll sign on. Title reward: **The Showrunner**. Tracking lives in `AchievementSystem.js` as a new `trapKillsInRunMax` metric (mirrors `bossKillsInRunMax`). Locked card on the recruit screen now shows "CURTAIN CALL ACHIEVEMENT" in its tooltip (same machinery as Zul'Gath's `hoard_lord` hint). Once sprites land and the bake script's `rattlebones.map` is filled in, the visual side is done — the achievement-driven flip handles his playable state per-player automatically.
- **Eighth companion — Necroknight.** Added 2026-05-26 as a fourth locked teaser slot; **fleshed out 2026-05-28** into a full companion equivalent to the others. Personality direction chosen by the user: **"Oathkeeper of the Dead."** An armored undead knight who died mid-vow and kept marching — he serves not the player but the **duty** of the dungeon, which the player embodies. Grave, ceremonial, archaic, measured; frames everything as oath, debt, honour, and rite. Death is **sacred** to him (never a joke like Rattle Bones, never tedious like Zul'Gath); he commands the slain like a general at a war memorial and — uniquely among the keepers — genuinely **grieves** the adventurers he kills, because each corpse is a soldier he'll raise and a debt he now owes. **Merciless yet reverent** is his whole register. Short declarative sentences, eulogies, vows; dry buried wit surfaces rarely (the grimmer the moment, the drier the line). **Signature address: "my Monarch"** — chosen 2026-05-28 because no other keeper uses it (Lilith="my liege", Malakor="little king", Zul'Gath="small one", Safira="Master", Rattle Bones="skull-pal", Spectra="senpai") AND it ties to his unlock: you earn him by defeating the **Shadow Monarch** (the "Arise" achievement), so you have *become* his Monarch. Unique secondary tags *warden / sovereign / commander* (also used by no other companion); "keeper" is the shared-generic everyone uses. Never chummy, never gendered. **He/him.** Tagline kept: *"Sworn to no king, served by every restless dead."* Traits: *unflinching counsel · honour in slaughter · grim steadiness*. Accent colour: spectral phosphor green (`#4dff7a`) so his halo reads as ghostfire. `restExpr: at-attention` (an honour-guard default; resting on a smile would read wrong). **59-expression sprite bank** baked 2026-05-28 from `Quest-Failed assets/Companions/The Necroknight/` (`-Photoroom` source suffix; `done/` + `dont use/` subfolders ignored) → `assets/npc-necroknight/`. **485-line dialogue bank** at `src/data/necroknightLines.json` (`necroknightLines` key, loaded in Preload) — 6 intro pages + 70 categories (479 category lines), every one of the 59 expressions used ≥3× and the most balanced spread of any keeper (max 32 uses vs. 60–97 for the older banks). His unique emotional axis is the **grief register** (`mourning / grieving / regret / weary / haunted / wistful`) and the rare **`unmasked`** "man under the helm" beat. **Unlock: the `monarch_slayer` "Arise" achievement** (defeat Sung Jinwoo, the Shadow Monarch) — already wired via `reward: { type: "companion", id: "necroknight" }` in achievements.json; he ships `locked: true` and that achievement flips him playable, same pattern as Zul'Gath/Rattle/Spectra. **No recruit/cross-banter** — see the cross-banter removal note below.
- **Ninth companion — Spectra.** Added 2026-05-26 as a fifth locked teaser slot; **fleshed out 2026-05-27** into a full companion equivalent to Lilith / Malakor / Safira / Zul'Gath / Rattle Bones. A **ghost-girl otaku** — died choking on a Pocky mid-binge, now haunts the dungeon. Brain runs on anime/games/manga/snacks vocabulary; ADHD-bursts (locked-in when engaged, easily pulled away mid-sentence by a stimulus); pure-flavor companion (no mechanical edge, like Rattle). **She/her.** Voice: immersed in the world but sees everything through gamer/anime tropes (heroes = MOBS, waves = BOSS PATTERNS, deaths = K/D RATIO, pacts = BUFF SCROLLS, throne = SAVE POINT). Calls the player **"senpai"** (signature) and **"DM"** / **"player 1"** / **"champ"** as rotating alternates. Verbal tics: *OMG OMG OMG*, *wait wait wait —*, *plot twist!*, *no cap*, *iconic*, onomatopoeia (*doki-doki*, *nyaa*, *ehhhh?!*), trailing-off mid-sentence. Tagline: *"A ghost with a head full of tropes — the dungeon's resident weeb."* Accent colour: pastel ghost-purple (`#9b4dff`). **Crypt-mate dynamic with Rattle Bones** (both undead, different generations — boomer-vs-zoomer-dead-people gag). Source art: `Quest-Failed assets/Companions/Spectra` (115 source PNGs), baked to `assets/npc-spectra/` (113 webps — `idle 1 see through.png` deliberately dropped from the bake). **Two systems unique to Spectra that future companions can opt into:**
  - **`variantGroups` — runtime expression-variant rotation.** Maps a SEMANTIC expression id (what dialogue banks use in `x:`) to a list of variant webp basenames. `NpcCompanion._setExpression` picks a random variant per delivery so all 113 source sprites see screen-time. `ArchetypeDecorOverlay` does the same for the boss-select screen. Dialogue writer thinks in semantic emotions (66 ids); the renderer handles variation. Audit treats the bank as semantic-only — variants are an art-rotation detail, not a balance concern. Companions without `variantGroups` behave exactly as before (file basename = id).
  - **`ghostFlickerRate` / `ghostFlickerAlpha` — translucent-roll on each delivery.** 25% chance per expression change to render at 0.70 alpha instead of 1.0. Sells the ghost identity without needing per-emotion see-through variants. Rolled once per expression change; alpha holds for the line's full duration (no strobing mid-typewriter). `solidOnlyExpressions` are exempt — the spooky group (`scary`, `skulls`, `ghost-power`) always lands full-alpha for impact.
  - **Dialogue bank**: `src/data/spectraLines.json`, **627 lines** across all categories matching the other fleshed-out companions plus full `specifics` coverage (boss × 12, advClass × 14, event × 26, room × 20, minion × 19, trap × 8, item × 4). All 65 non-idle semantic ids hit ≥4 uses each (audit verified). Spooky group reserved for boss-fight / last-life / party-wipe / horror-event beats; teasing group (`teasing`, `seductive`, `sexy`) sprinkled as rare flavor across poke + event reactions.
  - **Unlock condition (2026-05-27):** the `flawless_reign` legendary achievement — *"Survive 30 days in a single run without the boss taking any damage."* Strict no-hit: any HP loss from any source (adventurer combat, mechanic self-cost like Lightning, Summon-Add toll) invalidates the run's no-hit streak. Tracking lives in `AchievementSystem.js` as a new `daysSurvivedNoHitMax` metric; `BossSystem._applyDamageToBoss` now emits a `BOSS_DAMAGED` event consumed by the tracker. Title reward: **The Flawless**.
  - **NOTE — recruit-banter dropped.** The `recruit.banter` section is omitted from Spectra's bank since the CompanionSelect screen stopped using banter 2026-05-25 (vertical-space refactor). Cross-companion references happen organically inside other categories (intro / welcome / etc.) when she namedrops Rattle as her crypt-mate.
- **Unlock conditions — partially DEFERRED.** As of 2026-05-28 the wired unlock achievements are: Zul'Gath ← `hoard_lord` (10,000 gold in a run), Rattle Bones ← `curtain_call` (100 trap kills in a run), Spectra ← `flawless_reign` (30 days in a single run with the boss undamaged), **Necroknight ← `monarch_slayer` "Arise"** (defeat Sung Jinwoo, the Shadow Monarch). Nocturna, Luna, and any future companions still have **deferred** unlock terms — the system is built so each can be plugged in later as a data edit + a single `unlockCompanion()` call (or reward-tagged achievement) at the right trigger point.
- **REMOVED — cross-banter / recruit-banter, all companions (2026-05-28).** The CompanionSelect screen stopped rendering recruit banter on 2026-05-25 (vertical-space refactor; cards are now "pure visual portraits"), which left dead `recruit.banter` blocks in the five older banks (Lilith / Malakor / Zul'Gath / Safira / Rattle Bones) plus the freshly-written Necroknight bank. Those blocks were stripped 2026-05-28 (Spectra never had one). **Going forward, new companions ship with NO `recruit` block** — cross-companion references, if any, happen organically inside normal categories. (History note, not a silent delete: the banter lines are gone from the JSON but the decision + rationale live here.)

## Achievements (2026-05-25)

The game gets an **achievements section** that surfaces progression milestones, gates some content unlocks, and serves as long-term replay motivation. Reachable from the main menu (new button) and from the leaderboard (per-row chip + viewer modal — see leaderboard section below).

- **Approach.** Achievements ARE the unlock layer for new content. Meeting the criteria for an achievement both records it on the achievements screen AND unlocks any associated reward (boss / companion). The existing implicit boss-level gate stays in place — the achievement system mirrors / surfaces it on the screen.
- **Scope (first cut).** 45 achievements total:
  - **20 boss-level achievements** — one per boss level 1–20. Levels 2–10 each unlock the corresponding boss archetype (Golem at lvl 2, Lich at lvl 3, …, Slime at lvl 10). Levels 11–20 are pure recognition (titles for the leaderboard's future title rewards).
  - **25 non-level achievements** spanning easy onboarding, cumulative grind, single-run challenges, mastery feats, and variety completionist goals. Categories: progression / combat / economy / variety / mastery.
- **Companion unlock — Zul'Gath via "Hoard Lord".** Accumulate 10,000 gold in a single run. Thematic — an ancient dragon recognises a fellow hoarder. Zul'Gath was previously a starter companion; he's now locked at first-boot and unlocks via this achievement. (Removed from `STARTER_COMPANIONS` in `src/systems/companions.js`.)
- **Companion unlock — Rattle Bones via "Curtain Call".** Added 2026-05-26. Kill 100 adventurers with traps in a single run. Thematic — a macabre jester wants a perfect setup-punchline show before he'll sign on. Title reward: **The Showrunner**. Tracking lives in `AchievementSystem.js` as a new `trapKillsInRunMax` metric (mirrors `bossKillsInRunMax`).
- **Companion unlock — Spectra via "Flawless Reign".** Added 2026-05-27. Survive 30 days in a single run without the boss taking any damage (STRICT — any HP loss from any source invalidates the run's no-hit streak: adventurer combat, mechanic self-cost like Lightning, Summon-Add toll, etc.). Thematic — a ghost-otaku respects a clean run more than anything. Title reward: **The Flawless**. Tracking lives in `AchievementSystem.js` as a new `daysSurvivedNoHitMax` metric; `BossSystem._applyDamageToBoss` now emits a `BOSS_DAMAGED` event consumed by the tracker, and `SUMMON_ADD_DEATH_BOSS_TOLL` + `PACT_BOSS_LIGHTNING_FIRED.selfCost` are also wired as damage signals so the no-hit run flag flips faithfully across every HP-loss path.
- **Nocturna's unlock — STILL DEFERRED.** Will be assigned its own achievement once her character work is further along.
- **No hidden achievements.** All 45 are visible from the start; locked ones show their name + description + reward chip, but with a greyscale icon + locked styling.
- **Retroactive unlock.** On first boot of the achievements system with an existing save profile, any thresholds the player has already met fire their unlocks immediately (queued toasts). Important for not punishing existing players when the system ships.
- **Icons.** Pix-font Unicode glyphs per-category for first cut: ▲ progression · ✦ combat · ◇ economy · ✧ variety · ★ mastery · ◆ boss unlock · ♥ companion unlock. Custom pixel-art icons land later as art bandwidth allows.
- **Categories (final counts):** progression 27 · combat 5 · economy 2 · variety 6 · mastery 5.

## Achievements leaderboard (2026-05-25)

The achievement-rankings live **inside the achievements page itself**, not as add-ons to the main run-leaderboard. Separation of concerns: main leaderboard ranks runs; achievements page ranks achievements.

- **Entry point.** A prominent gold-burst **LEADERBOARD button** sits next to the category-filter tabs in the achievements page — visually distinct (pulsing glow, brighter background, larger padding) so it reads as a destination rather than another filter. Pressing it swaps the achievement grid for the leaderboard view.
- **Layout.**
  - **YOUR RANK band** at the top: "#5 of 47 players · 17 / 45 unlocked." Always visible.
  - **Top-3 podium** with gold/silver/bronze accent borders, matching the main leaderboard's accolade pattern.
  - **Ranked list** of the top 50 players. Each row clickable.
  - **YOUR row pinned** at the bottom of the list (with a "…" separator above) when you're outside the top 50.
- **Click any row** → opens the AchievementsOverlay in viewer mode for that player. The same overlay used for self-view, just driven by the bitmask instead of localStorage.
- **"Compare with you" toggle** on the viewer modal — colour-tags each card: 🟢 both · 🔵 their edge (chase target) · 🟡 your edge (your flex) · ⚪ neither.
- **Storage.** `meta.achievement_bits` (string of `1`/`0` chars, one per achievement in canonical id order) + `meta.achievement_count` (pre-decoded integer). Stored in `meta` (jsonb) so no schema migration is needed. Submitted on every run-end via the existing leaderboard payload path.
- **Data flow.** Lazy fetch on first activation via `Leaderboard.fetchTop(500)`; dedupe by player_name (latest run per player); sort by achievement_count desc; cache for the overlay's lifetime so re-entry is instant.
- **Rarity stats / recent-unlocks feed** are deferred to a follow-up pass — the leaderboard tab + viewer + comparison mode is the v1.

## Titles & player display (2026-05-25)

17 of the 45 achievements grant **titles** (the 10 boss-level achievements at levels 11–20, plus 7 high-tier non-level achievements: Reaper, Untouchable, Class Hunter, Boss Slayer, Endless Reign, Hoard Lord → "The Hoarder", Veteran Exterminator). Titles are the leaderboard-visible boast.

- **Active title.** Each player has exactly one active title at a time. It appears in the header chip on the achievements page and in the player's row chip on the main run-leaderboard (podium + detail panel — replaces the legacy IMMORTAL / BUTCHER / CUNNING accolades when present).
- **Selection.** Click the active-title chip in the achievements header → a floating picker drops in beneath the chip with one row per unlocked title plus an **AUTO** row. Selecting a title pins it; selecting AUTO clears the pin so the active title auto-tracks the most-recently-unlocked title from then on.
- **Default behaviour (no selection).** First title to unlock becomes active automatically; each subsequent unlock replaces the previous active title until the player makes an explicit selection. The AUTO row shows the current "most recent" target as its subtitle.
- **Persistence.** Active-title id stored in `localStorage` under `qf.player.active_title_id:<name>` (`null` = AUTO). Unlock timestamps stored under `qf.achievements.timestamps:<name>` (drives both the recent-unlocks strip and the AUTO target). Both keys are name-scoped — mango's cheat unlocks don't leak into other player accounts.
- **Leaderboard payload.** Sent as `meta.active_title` (display string) on every run submission. Older rows lacking the field render the legacy top-3 accolade exactly as before — backward-compatible.
- **Long-title overflow.** The longest title is **"Veteran Exterminator"** (20 chars). Podium / detail chip styles clamp with `max-width` + ellipsis so cramped layouts never break.

## Recent-unlocks strip (2026-05-25)

The achievements page header (self-view only) shows a **RECENT UNLOCKS** strip above the grid — three most-recent unlocks with relative-time labels ("12 minutes ago" / "3 days ago" / "Just now"). Auto-hidden when the player has zero unlocks. Driven by the unlock-timestamps store, so it back-fills on first achievement-system boot from the retroactive scan.

## Achievements popup + visual language (2026-05-26)

The achievements screen is now a **centered popup** mirroring the main run-leaderboard — same 1300×840 dimensions, gold accent, unfurl animation, shared `Overlay` shell with backdrop + close X + Esc dismiss. The two read as sibling "Hall of X" surfaces. Closing the popup returns to whatever was underneath; opening it doesn't pause the game.

- **Layout.** Header band (counter + active-title chip), category-filter tabs + LEADERBOARD button, recent-unlocks strip, scrollable 3-column grid of achievement cards. Header title "◆ HALL OF TROPHIES ◆" sits in the Overlay shell's title bar, centered.
- **Per-card anatomy.** Pixel-art "trophy plaque" feel: dark wood card body + neutral parchment nameplate ("FIRST SPARK" etc. in cream `#ece2d2`) + one colored medal (the icon). The medal is the only fully-colored element on the card — three competing same-color elements (border + icon + name) used to fight for attention; now the icon owns the focal point.
- **Two color axes per card.**
  - **Border + bg tint** → CATEGORY (progression amber / combat blood-pink / economy gold / variety cyan / mastery violet)
  - **Icon medal color** → REWARD TYPE (pure-recognition cream / boss-unlock oxblood / companion-unlock rose / title-grant violet)
  - Reward chip below the description matches the icon color so the reward signal reads on both elements.
- **Icon glyphs.** Every achievement has a thematic emoji glyph in `achievements.json` (⚡ First Spark, ☠ Hardened Throne, 🦎 Crown of Iron, 🍄 Echoing Roar, ⚔ Sixth Seal, 🧛 Seventh Sigil, 👻 Spectral Reign, 💋 Witchbane, 💧 Dread Sovereign, 👑 Tyrant, 💀 Demilich, 😈 Avatar of Dread, 🏆 Throne Eternal, 🔪 First Blood, 🪤 First Trap, 💰 Hoard Lord, etc.). Glyphs that default to text-presentation get a U+FE0F variation selector to force emoji rendering. Renders as native OS emoji color — the icon's hue is the OS palette, but the badge frame around it still inherits the reward-type color so reward-coding isn't lost.
- **Legendary tier.** Six hand-picked endgame achievements (Throne Eternal, Endless Reign, Hoard Lord, Veteran Exterminator, Boss Slayer, Class Hunter) carry `legendary: true` in the data file. On their grid cards they get a persistent showcase treatment: animated linear-gradient shimmer sweep across the card, slow gold pulse, inner ember glow. The legendary flag also branches the unlock toast (see below).
- **Hover affordances.** Cards have no outer glow at rest — the page reads calm. On hover, a per-category outer glow lights up at 35% intensity as the affordance.

## Achievements leaderboard view (2026-05-26 overhaul)

Inside the achievements popup, the LEADERBOARD button swaps the category grid for a full-featured leaderboard view that visually pairs with the main run-leaderboard.

- **YOUR RANK band** at the top — always visible. Shows the player's local rank + total achievement count. Special states: `EXCLUDED (CHEAT)` for mango; `UNNAMED` for no name set; `NO DATA YET` when the board is empty.
- **Podium step (2-1-3 layout).** Three cards, always rendered. DOM order is silver-left / gold-center-tallest / bronze-right with `grid-template-columns: 1fr 1.2fr 1fr` + `align-items: end` so cards step UPWARD into a real podium silhouette (200/170/140px heights). Each card is a triptych: [companion sprite | floating #N badge + boss portrait + player name + title chip + trophy block | achievement-derived stats]. Missing slots show inert "AWAITING CHALLENGER" placeholders so the layout reads balanced even on a sparse board.
- **Trophy block.** The headline stat on each podium card: rank-colored big number with soft glow + `/ 45` denominator + thin progress bar showing % of total achievements unlocked. Bar gives an at-a-glance "how complete is this player" cue.
- **Stats block.** Three mini-frames showing achievement-derived TOTAL ACCESS counts (not run stats):
  - TITLES — count of unlocked title-bearing achievements (X / 17)
  - BOSSES — 3 starters + count of unlocked boss-unlock achievements (X / 12 total)
  - COMPANIONS — 3 starters + count of unlocked companion-unlock achievements (X / 4 total — scales as more companion unlocks ship)
- **Ranked list** below the podium — top-50 keepers in a grid table mirroring the main leaderboard's row anatomy (rank | sprite | name | trophies | arrow), with rank-colored left border (gold/silver/bronze for top 3, blood-red for YOU). Click a row → opens the viewer modal for that player.
- **YOU pinned** at the bottom when outside top-50, with an ellipsis separator above.
- **Global stats panel** below the list — always visible when the board has data. Four cells: TOTAL KEEPERS / AVG TROPHIES / RAREST TROPHY / MOST POPULAR TITLE. Computed client-side from the in-memory player roster and the rarity sample already ingested.
- **Viewer mode.** Click any player row → opens a SECOND achievements popup in viewer mode for that player. Shows their grid driven by their bitmask, NOT their local storage. The LEADERBOARD button is hidden in viewer mode (you're already in the comparison context), but a **COMPARE WITH YOU** toggle appears in the header — color-tags each card 🟢 both / 🔵 their edge / 🟡 your edge / ⚪ neither.

## Legendary unlock celebration (2026-05-26)

Legendary-tier achievements (the 6 with `legendary: true` in the data file) get a tier-aware unlock moment instead of the common golden trophy toast:

- **RARE TROPHY eyebrow** above the title line.
- **"LEGENDARY UNLOCKED"** header (instead of "ACHIEVEMENT UNLOCKED").
- **Gold-bright frame** with 2px border + ember inset glow + slow 2.2s pulse animation.
- **Larger glyph + title** (22px / 13px) with stronger gold-glow text shadow.
- **10s dwell** instead of the standard 5s.
- **22-particle gold burst** spawned alongside, fountaining leftward into the play area (the toast sits on the right edge of the HUD, so particles bias into the screen). CSS-animated via per-particle `--dx` / `--dy` trajectory vars; auto-cleanup after ~1.3s.

Common achievement unlocks keep the unchanged golden trophy toast — the tier difference is the visible distinction.

## Solo Leveling — Epic Boss Duel (2026-05-28)

*(Back-documenting: the Solo Leveling event itself — the rare **Shadow Monarch** invader "Sung Jinwoo", his persistent black-flame aura, shadow-extraction minions, stat-matched boss duel, entrance/VS cinematic and legendary achievement — shipped earlier but was never recorded in this file. This section captures the feature and the duel-cinematic overhaul the designer asked for.)*

The standard boss fight treats every invader the same: they orbit the boss and trade abstract damage rounds. For the Shadow Monarch that reads as anticlimactic — a legendary 1-on-1 should feel like a *duel*, not a trash-mob skirmish. The throne-room fight between Jinwoo and the boss is therefore reworked into a bespoke cinematic. **Everything below applies ONLY to the Jinwoo-vs-boss duel** (the sole-combatant Shadow Monarch case); all other boss fights are unchanged. The duel stays strictly **1:1** — his extracted shadows do *not* appear in the throne room (they clear the halls; the duel is just him and the boss). Any **dungeon minions already standing in the boss room are annihilated the instant Jinwoo steps in** (a shadow-blue burst as his aura snuffs them out) — they die outright, *not* raised as shadows, so the throne is cleared for a true 1:1 the moment he arrives.

- **Roaming clash choreography.** Instead of Jinwoo orbiting a near-stationary boss, **both fighters range across the whole arena trading blows**. They converge on a shared point, exchange a flurry, then break apart to opposite sides of the room and re-engage from a new angle — repeatedly, all over the chamber. The fight should never look like two figures standing next to each other; it should look like a moving battle.
- **Director layer (camera + time).** When the duel begins: cinematic **letterbox bars** frame the screen for its duration, the camera **pushes in** on the throne room, and key clashes punch with **hitstop** (a brief slow-motion freeze) plus **screen shake**. The killing blow lands in hard slow-motion.
- **Signature Monarch moves.** Jinwoo fights with bespoke blue-black VFX — **shadow-dash blinks** (he flickers across the room to reappear at the boss), **flame-slash arcs**, and **dark eruptions** on impact — distinct from the generic yellow strike sparks every other adventurer uses.
- **Rising phase beats.** The duel has an arc, not a flat damage race. Scripted one-shot moments fire at HP thresholds — the boss **enrages** when wounded; Jinwoo hits a **power surge** (flame flares brighter, the screen pulses) when pushed low — each punctuated by one of his battle-cry lines.
- **Two climaxes.** *Jinwoo wins:* a slow-motion **shadow execution** — a final dash, a blue-white flash, the boss dissolving into shadow. *The boss kills Jinwoo* (the rare path that grants the legendary achievement): a **last stand** — he drops to one knee, his flame guttering, before the finishing blow lands. The loss is framed as earned, not abrupt.
- **Framing & audio.** A live **two-bar duel header** (THE SHADOW MONARCH vs the boss, both HP bars updating in real time) frames the fight, his unique chat lines fire on the duel's beats, and an impact/music sting marks the clash where audio assets allow.

Intent: the Shadow Monarch's arrival is already the rarest, most theatrical event in the game — the fight that pays it off should match.

**Duel chatter discipline (2026-05-28).** Jinwoo's normal *exploring* chat lines are **suppressed for the whole duel + win/loss outro** — they were leaking through generic contextual/ambient triggers mid-fight and after a result. During the duel he instead throws **occasional combat-flavoured barks** (a dedicated fight-line pool — "Show me everything you have.", "You'll make a fine shadow.", etc.) on a ~6–9s cadence, plus a bark on his power-surge beat. Only these scripted lines and the outro's closing lines speak once the duel begins; his wandering exploring pool resumes only on a future appearance. On the **loss** path, his death animation is given a **3-second hold** before the post-wave summary pops, so the death reads fully. He also **never shows the cutesy emoji emote bubbles** the ordinary adventurers do — at any point in the event — keeping him stoic; he communicates only through his own shadow chat bubbles.

### Duel win/loss outro cutscenes (2026-05-28)

When the duel resolves, the post-wave summary is **held back** until a short scripted outro plays out, so the player sees the ending in full. (Mechanically free: Jinwoo stays in the active-adventurer list during the outro, so the day-end auto-timer doesn't fire until he's gone.) The camera stays locked on the throne for the whole outro.

**If the boss kills Jinwoo (the rare achievement path):**
1. On the killing blow he **stops and stands** (no death animation yet) and speaks a couple of in-character closing lines (defiant / unbroken-in-defeat).
2. *Then* his **death animation** plays.
3. A short beat later the active list clears and the **post-wave summary** appears as normal.
4. The player is awarded **+1000 gold** for slaying him (a flat bounty on top of nothing else — no double-count with normal kill gold).

**If Jinwoo wins (your boss falls):**
1. He **stands** over the fallen boss and speaks closing lines, ending on **"Arise."** (a normal chat bubble).
2. On "Arise.", the **boss sprite revives visually** — it stands back up wreathed in the same **blue shadow-flame + tint** his extracted shadow minions wear.
3. A **portal fades in** in the boss room — the existing demon-portal sprite, **recolored blue** (hue-shifted, baked as a separate asset).
4. Jinwoo **walks to the portal and fades away** — that's how he leaves the dungeon (no normal flee-to-exit).
5. Once he's gone, the **post-wave summary** appears.
6. **Lasting mark:** the boss **keeps the shadow-flame + blue-tint visual for the rest of the run** — it's now part of Jinwoo's army. *(Purely cosmetic — the boss is still the player's boss and is otherwise unaffected; it only ever loses the one life from the defeat. Persisted via a flag on the boss so it survives save/load and shows on every later appearance.)* *(Reconciliation note: the boss does NOT dissolve/leave with Jinwoo — keeping it flame-marked for the run takes precedence over the earlier "he takes it as a shadow" idea, since those conflict.)*
7. **Reclaimed by defeat (2026-05-28):** the mark isn't permanent. If the Solo Leveling event **recurs later in the same run** and this time the boss **kills Jinwoo**, it breaks free of his claim — the shadow-flame + blue tint **drop the instant he dies** (with the Monarch slain, his hold on the boss breaks), so the boss renders normally for the rest of the run. Persisted (cleared once, stays cleared across save/load).

**Recurrence (2026-05-28).** Solo Leveling rolls **organically** in the natural event rotation (no longer dev-trigger-only). It uses the normal shuffle-bag cadence — fires once, then the roster has to cycle before it repeats — **except** when the **boss dies to it** (Jinwoo wins the duel and the boss loses a life). In that case the event is **thrown back into the pool**: it isn't marked spent, so it stays eligible and can recur **without waiting for the whole roster to cycle** (a defeated boss invites the Monarch back). If Jinwoo *loses* (the boss survives), it's marked spent like any other event and must wait its turn.

---

## Treasure Raid — recurring 10-day wealth raid (2026-05-29) ~~(scheduling reverted 2026-06-01)~~

> **CHANGED 2026-06-01 (by user).** The dedicated **10-day raid track was removed**. `treasure_hunters` is now a **normal shuffle-bag dungeon event** again — it rolls randomly in the regular rotation like every other event (gated only on a non-empty treasury, since it steals gold), instead of firing on a fixed day-10/20/30 schedule. The event's **behavior is unchanged**: when it fires, the whole wave still arrives as treasure hunters who skim liquid gold on escape, still capped at 80% of the day-start treasury, still telegraphed the night before with the chest-sell lock. Only the cadence changed (scheduled raid → random shuffle event). **Items 1, 2 and 4 below — the dedicated track, the day-10 "no grace period", and the collision rule — no longer apply;** the remaining items still describe the event's behavior.

The original one-off **Treasure Hunters** dungeon event is promoted to a **recurring, scheduled Treasure Raid** with its own cadence, separate from the normal dungeon-event rotation. The design goal is an **anti-hoarding pressure valve**: the fatter your liquid treasury, the more a raid bleeds you — so sitting on a pile of gold becomes genuinely dangerous, and the smart play is to spend it down into defenses (which then protect you) before each raid.

1. **Own track, every 10 days.** A dedicated scheduler fires the raid on **day 10, 20, 30, …** — completely independent of the regular ~3-day dungeon-event rotation, so the raid never crowds the random event variety. **Treasure Hunters is removed from the random event pool** entirely; it now happens *only* as the scheduled raid.
2. **No grace period.** The first raid lands on day 10 regardless of wealth. The raid always happens on the beat — gold only changes *how much it hurts*, not whether it occurs.
3. **The wave is a normal day.** The raiding party is **that day's normal-size adventurer wave plus any modifiers the player has active** (pact/event wave-size changes such as the Cursed Relic doubling) — all of them arrive as treasure hunters who ignore the throne and rush the hoard. No gold-scaled party size.
4. **Collision rule.** When a raid day coincides with a regular dungeon-event day (every 30 days), the **raid takes priority and the regular event is skipped** for that day; the normal event cadence resumes afterward.
5. **They steal liquid gold (not just chests).** Raiders skim your **liquid treasury** — chests are now only a *bonus* visual target (looting a chest has no separate gold or income consequence; chest income is paid per-tier at night regardless). Each raider that **escapes the dungeon** carries off a share of your gold; raiders **killed before they escape steal nothing**.
6. **Severity scales with wealth, capped at an 80% loss.** The total a raid can take is **up to 80% of the treasury it found** at day-start — the player always keeps **at least 20%**. The loss is split into equal per-raider shares (`0.80 × start-treasury ÷ party-size`), so:
   - whole wave escapes → you lose the full **80%** (left with 20%);
   - kill half → you lose **~40%**;
   - kill them all → they leave **empty-handed**.

   This makes a fat treasury terrifying on a bad-defense day while still rewarding the player who spent gold on defense. *(Tunable: 10-day interval + 80% cap are the two balance knobs.)*
7. **Telegraphed + sell-locked.** The raid is announced the **night before** via the normal event banner so the player can spend down / reinforce, and **treasure chests can't be sold** on the raid night (so you can't dodge it by liquidating).

---

## Boss Event tier (2026-05-29)

Some dungeon events are *bigger* than others — they aren't just another themed wave, they're a personal challenge to the boss. Those events get a **Boss Event** category badge so the player reads them as a tier above the normal rotation the instant they're announced.

A Boss Event keeps its own `colorTheme` (its identity colour) but gets a **gold overlay layer** stacked on top:

- **Banner:** the kicker line above the title reads **"◆ BOSS EVENT ◆"** in gold (vs. the normal "◆ DUNGEON EVENT ◆"), the four corner L-brackets bump to bigger gold brackets, and the inner panel does a brief **soft shake on slam-in** to sell the moment.
- **Pill:** a small **"BOSS"** chip is stitched to the top centre of the persistent status pill, and the pill carries a slow **ambient gold pulse** so it draws the eye throughout the event.
- **Sound:** Boss Events play a distinct **boss-event sting** (`sfx-event-boss`) on announcement instead of the usual event notification cue — so they sound as different as they look. Falls back to the standard cue if the asset hasn't loaded.

**Solo Leveling** is the first Boss Event. Its shadowmonarch black↔blue sweep stays as its identity; the gold tier overlay is layered on top. Promoting any future event to Boss tier is a one-line JSON change (`eventTier: 'boss'` in `events.json`) — no per-event code.

---

## Light Party — FFXIV Trinity Raid (2026-05-29)

The second Boss Event. Where Solo Leveling is one legendary champion who duels the boss alone, **Light Party** is the opposite challenge: a **coordinated 4-role raid party** — Tank, Healer, two DPS — moves through the dungeon as a single unit. Always exactly 4 members; stat scaling per boss level keeps the encounter threatening at any era without changing the count. Inspired by FFXIV light parties, with the **healer** as the strategic linchpin: she never attacks, she only heals and revives, and her HP fraction when the party reaches the throne **decides the duel**. Cut her down before she gets there and the dungeon wins; let her arrive intact and the boss falls. Held out of the random shuffle bag until the user opts to enable it (so it can be tested + tuned in isolation); the dev TEST EVENT button still force-fires it for QA.

### The four roles

Four new event-only adventurer classes (50 baked LPC variants each), tagged with role flags + a shared `partyId`:

- **Paladin (Tank)** — 150 HP / 4 ATK / 12 DEF. Plate + tower shield silhouette. **Provoke aura**: any minion within 4 tiles that picks a non-tank party member to attack is force-retargeted to the tank instead. **Hallowed Ground** at <30% HP — 3-second self-invuln, once per dungeon.
- **White Mage (Healer)** — 60 HP / **0 ATK** / 3 DEF. Robes + staff with crystal. **Never attacks** (CombatSystem short-circuits all swings). Heals the lowest-HP party member every 1.5 seconds, visible green-gold beam. On any ally death, channels a **3-second Raise cast** with a visible red-rimmed cast bar above her head — if she takes **>15% maxHp damage during the cast**, the resurrection fizzles ("INTERRUPTED!"). A successful raise brings the ally back at 50% HP. Unlimited revives — the puzzle is interrupting, not depleting.
- **Samurai (Melee DPS)** — 45 HP / 18 ATK / 3 DEF. Light lamellar + Saber (LPC katana proxy). Twice the damage of a normal melee adv.
- **Black Mage (Ranged DPS)** — 28 HP / 22 ATK / 1 DEF, **attack range 4**. Tall wizard hat + staff. Lobs spells over the tank's shoulder to hit your back-row minions.

### Wave size

Always exactly **4 members**: 1 Tank / 1 Healer / 2 DPS. The encounter scales by stats (per-boss-level scaling on every party member) rather than by count, keeping the FFXIV light-party feel intact regardless of era.

### Limit Break (shared gauge)

A shared LB gauge (0–100) fills as the party plays: **damage taken** (0.5 pt per 1% maxHp), **minion kills** (5 pt), and **successful raises** (10 pt). At full, the AI fires a **tactical LB** (once per dungeon) — situational dispatch picks the most-useful flavour:

- **Tank LB — Stronghold**: at ≤50% total party HP → **4-second party-wide invuln** (gold dome VFX).
- **Healer LB — Pulse of Life**: when ≥2 party members dead → **full revive + heal the entire party** (radial green wave).
- **DPS LB — Final Heaven / Meteor**: when ≥4 minions in a 5-tile radius of any DPS → **AoE-kill every minion in radius** (screen flash + banner).

A guaranteed **LB3 cinematic** also fires during the boss-fight climax (see below) regardless of gauge state.

### The boss-fight duel (FFXIV cinematic)

When the party reaches the throne, the normal boss fight is **replaced** by a bespoke FFXIV-style cinematic (BossSystem `_runLightPartyDuel`). Outcome is **rolled once at the start** from the party's state at the door:

```
winChance = 0.25 + healerHpFrac × 0.55 + livingDpsCount × 0.05 − (tankDead ? 0.15 : 0)
            clamped to [0.10, 0.90]
```

So a full-HP healer with everyone alive ≈ **90% win**; a dead healer with the tank gone ≈ **15% win**. The healer's HP is the dominant lever — exactly what the player optimized against during the dungeon run. The cinematic then plays out the rolled result.

**Beat sequence** (~17 seconds total): opener flourish → boss casts **Megaflare** (visible cast bar) → AoE telegraph "DODGE!" → healer recovers the party → boss casts **Holy Wrath** → stack mechanic "STACK!" → **LB3 climax** (Meteor on win, desperate LB on loss) → resolution. The cinematic UI is lifted from FFXIV raid HUDs: **boss HP bar top-center**, **party HP list bottom-left** with role icons, **boss cast bar** below the boss HP. Letterbox bars frame the fight.

### Win/loss + recurrence

- **Party wins** → boss loses a life (`deathsRemaining--`, `_diedThisDay=true`); survivors flee the dungeon with the standard `boss_defeated` goal. The event is **thrown back into the shuffle bag** (same recurrence rule as Solo Leveling: a boss death invites the threat back).
- **Boss wins** (party wipes) → every party member is `_killAdv`'d for proper book-keeping (graveyard entries, kill counts, achievements). Event marks spent normally.

### Persistent UI

- **Entrance card** on spawn: ◆ LIGHT PARTY ◆ / "WARRIORS OF LIGHT" / role chips fade in one at a time (🛡 ✨ ⚔ 🏹).
- **Persistent gold vignette** while the party is in the dungeon.
- **Corner party panel** (FFXIV party-list aesthetic) — 4 or 8 stacked HP bars with role icons + LB gauge below. Lifts when the duel begins.
- **World-space visuals**: small job icon hovers over each member's head; heal beam draws from healer staff to ally on every heal; raise cast bar over the healer's head during the 3-second window.
- **Theme**: `lightparty` colorTheme — sweeping white→gold→sky-blue gradient banner, distinct from Solo Leveling's shadowmonarch black↔blue. Gets the gold Boss Event overlay automatically.

### Achievement — "Warrior of Light"

Legendary achievement granted when the **boss wins the duel** (the player defeated the raiding party). Reward: **Luna companion unlock** (flips her `locked: true` via the existing `PlayerProfile.unlockCompanion` path) + the title **"Warrior of Light"** with a custom `lightparty` title FX (white→gold→sky-blue sweep, foil to monarch_slayer's shadowmonarch sweep).

---

## The Kingdom's Reckoning — act-based run structure & win condition (added 2026-05-31)

> The game's first **win condition** and run *spine*. Replaces pure endless survival with a 4-act campaign that builds to a climactic finale, while preserving Endless mode for post-victory leaderboard play. Designed 2026-05-31 with the player.

### Core concept

A run is a **4-act campaign** (~40 days, ~10 days per act) against a kingdom that is *escalating its response to your dungeon's rise*. Each act is a **different kind of war** — not a bigger version of the same one — and ends in a **Champion** encounter. Clear all four → **VICTORY** (the kingdom breaks). The boss-dies-3× loss condition is unchanged.

**Structure: fixed bookends, drafted middle.**
- **Act I and Act IV are fixed** — they carry the narrative (the Nemesis's birth and the final duel).
- **Acts II & III are drafted** from a pool of "Kingdom Responses," weighted by how the player has been playing — so no two runs have the same middle.

### Act I — The Apprentice Trials (FIXED)

A nearby adventurers' guild/academy treats your fresh, unproven dungeon as a cheap, lethal **training ground**. Waves of apprentices probe you while an instructor watches from the entrance. This is the gentle on-ramp act (small, manageable waves) AND the origin of the run's recurring **Nemesis**.

- **The Nemesis is born here:** the academy's **star pupil and sole survivor** of the trials escapes, marked. They return in every subsequent act having *studied specifically to beat you*.
- **Clear condition:** survive the Trials / repel the instructor's final "graduation" wave.

### The Nemesis (run-long throughline)

A single named Hero who ties the variable run together with constant personal stakes.
- **Born** in Act I (the surviving star apprentice).
- **Returns** as a mini-boss in Acts II & III — tougher each time, visibly scarred, having trained against your specific tricks. Taunts the player between acts via the Dungeon Log + companion (Lilith) dialogue.
- **Escalation:** each return raises level/stats, grants a new counter-ability (e.g. learns to avoid your most-used trap, resists your boss's signature), and deepens the grudge.
- **Final boss** in Act IV — ascended into the realm's "Hero King," fought in a cinematic 1v1 duel.
- Reuses the existing returning-veteran / "Hero" system + the Solo Leveling / Light Party duel tech.

#### Aldric — the Nemesis (specifics locked 2026-06-01)

**Who:** **Aldric** — a young swordsman insufferably convinced he is the greatest, out to become the kingdom's hero by cutting down all evil (you). Arrogant-rival archetype; gives himself grandiose self-titles ("Sir Aldric Brightsword, Future Hero-King") that the companion mocks ("sword boy").

**Emotional arc (he changes, not just his stats):**
- **Act I — Swagger.** Treats it as a joke / stepping stone. Pure trash talk.
- **Act II — Humbled & furious.** You slaughtered his classmates; now it's personal.
- **Act III — Obsessed & fraying.** Scarred, sleepless, rage covering fear; "I've studied every inch of your filth."
- **Act IV — Ascended** (see crowning below).
- Taunts get darker / more desperate across acts. He **remembers** ("Last time cost me an eye — I've come to collect").

**Escalation per return:** better gear + a NEW signature ability each act, and he learns YOUR dungeon (counters your most-used trap, comments on your boss archetype). Plot-armored across Acts I–III — he can't be killed except in the Act IV duel (reuse the Shadow Monarch / Light Party 10% HP-floor + can't-flee-cowardly pattern; he withdraws with a vow instead of panicking). **Disdains loot** — ignores your treasury bait (he's here for glory, not gold) — a mechanical tell that he's different.

**Right-side rival portrait system (mirrors the companion):** a large detailed NPC portrait that slides in from the **RIGHT** (opposite the companion on the left) **occasionally** during the day to talk — taunting **you**, and bantering with the **companion** (a running rivalry/odd-couple dynamic). His portrait **evolves every act** (Act I cocky academy kid → Act III scarred & grim → Act IV crowned Hero King), so "better gear each return" is a visual payoff you watch on his face. Gold/white identity + a heroic sting when he appears (foil to the dark dungeon). Data-driven line bank (`src/data/aldricLines.json`) like the companion lines. **Art-dependent:** build the system with a placeholder portrait (his scaled adventurer sprite); slot real hand-drawn evolving forms later, exactly as the companions came together.

**Act IV — becoming the Hero King:** **Crowned by a desperate Crown (now).** He is the only soul who keeps surviving your dungeon, so the broken kingdom officially anoints him their Champion — royal regalia, a blessed legendary blade, the realm's last hope. Beat him → the kingdom truly breaks (VICTORY). **Adaptive ascension (later, ties to KR P5):** how he ascends reflects your run — brutalize the kingdom → he goes dark/desperate; play cleaner → he ascends noble. Ship the crowned baseline first.

### Acts II & III — The Kingdom Responds (DRAFTED)

At each act transition the kingdom escalates with a new strategy, **drawn from the Kingdom Responses pool** (below) and **weighted by the player's style** (see Adaptive Weighting). Each response is a distinct act-type with its own threat, signature gimmick, and clear-condition. The Nemesis appears within each.

**Kingdom Responses pool** (9; Acts II & III draw 2, never repeating; extensible over time):

1. **Rival** — a rival dungeon boss invades *your* dungeon with monsters; culminates in a boss-vs-boss showdown. (Scales up the existing Rival Dungeon event.)
2. **Inquisition** — fanatical zealots immune to fear who **nullify your Dark Pacts and purge undead**; your usual tricks stop working, forcing a mundane (traps/minions) defense.
3. **Pantheon — Divine Judgment** — angels/divine avatars descend: **holy zones** that heal heroes + sear your minions, mid-fight resurrection of the fallen, radiant rule-breaking. (Escalated holy threat — reads as a "greater Inquisition.")
4. **The Betrayer** — one of *your own* turns: a defecting minion (or tempted companion) **leads the raid and sabotages from inside** — your own rooms/traps turn against you for the act. Paranoia / internal-threat act.
5. **The Reckoning of the Dead** — an enemy necromancer-king **raises everyone you've killed this run** against you. Army size scales with your run kill-count (strong Adaptive synergy). Karmic.
6. **The Forlorn Hope** — a suicide squad of the realm's best who **never flee, fight to the death, and grow stronger as each one falls** (martyrdom). Ties to the Glory Hounds / martyr systems.
7. **The Mage Tower — Arcane Assault** — archmages attack with **reality-warping offense**: teleport your minions out of position, transmute rooms, dispel your buffs, summon their own creatures. Scrambles your dungeon's rules mid-day. (Opposite of the anti-magic Inquisition.)
8. **The All-Stars — Champions' League** — a coordinated **dream-team of named legendary heroes**, each a mini-boss with a signature ability synergized with the others. Blockbuster elite team-up.
9. **The Plunderers** *(added 2026-06-01)* — a thieves' guild drawn by your hoard: **economic warfare**, the pool's only non-combat threat. Flee-prone thieves **pickpocket your treasury** while they live and **abscond with a heist purse if they escape** (drains scale as a % of your gold — robbing the rich proportionally). Cut down Vell the Guildmaster before your vault runs dry. The rich+evolved playstyle's second answer alongside the All-Stars.

Each drafted act ends in a **Champion raid**: a pre-announced elite encounter (the response's signature champion + retinue) that must be defeated to clear the act and advance. Clear-conditions vary by response where it fits the theme (e.g. Reckoning = survive the undead tide; Mage Tower = kill the archmages before they unmake your dungeon).

**Cadence — the kingdom's presence is felt ACROSS the act, not just at the climax (added 2026-06-01):** A drafted act plays out as **(1) the announce** (the "THE KINGDOM RESPONDS" reveal at act start), **(2) mid-act pressure** — themed *forerunners* of the response (e.g. the Pantheon's scouting acolytes, the Inquisition's preachers, the Rival's scouts) join the normal wave on each non-final day, **growing** as the act nears its climax, plus any *act-wide* modifier running the whole time (Betrayer's trap blackout, Inquisition's pact-suppression, Reckoning's swelling undead trickle), and **(3) the final-day Champion raid** climax with its combat modifiers. So a response is a slow build to a payoff, not a single day.

**Always-visible status (added 2026-06-01):** a persistent HUD pill (top-center) shows the current **act number + the active Kingdom Response + its modifier**, so the player never has to remember what they're up against. Fixed acts (I, IV) show the act name.

### Adaptive Weighting

The draft for Acts II & III (and the composition within each act) is **tilted by the player's run-stats** so the kingdom counters *this* dungeon:
- High kill-count / slaughter-heavy → **Reckoning of the Dead**, **Inquisition / Pantheon** (martyrs & holy vengeance) weighted up.
- High intel leaks (many escapees) → responses that arrive pre-countered weighted up.
- Rich treasury → **The Plunderers**, **All-Stars** (greed-flavored) weighted up.
- Heavy Dark-Pact reliance → **Inquisition / Pantheon** (pact-nullifying) weighted up.
- Powerful/evolved minions → **The Betrayer**, **All-Stars**, **The Plunderers**, **Rival** weighted up.

Reads the existing `gameState.run.totals` + knowledge/exposure data.

### Act IV — The Reckoning (FIXED)

The realm's last stand: a cinematic **1v1 duel** against the Nemesis, now ascended into the **Hero King**. Reuses the Solo Leveling / Light Party duel tech (letterbox, dual HP bars, scripted beats, slow-mo finish). **Defeating the Hero King = VICTORY** — the kingdom breaks and the dungeon stands triumphant.

**As built (v1, 2026-06-01) — the functional duel, cinematic deferred:** On Act IV's final day (day 40) the crowned Hero King arrives for a **solo throne duel that replaces the normal wave** (no normal adventurers that day — same set-piece pattern as Solo Leveling / Light Party, so no stray raider can game-over you the instant you've won). He is the **killable** form (`_nemesisDuel`, *not* the Acts I–III plot-armored `_nemesis`), never flees, ignores loot, and beelines the throne. **Putting him down → `RUN_VICTORY` → the Victory screen** (fires the moment he falls, via `NEMESIS_SLAIN`; an idempotent guard means simply surviving the day is an equivalent fallback win — you repelled the realm). What's *not* built yet (deferred): the duel **cinematic** (reuse of the SL/LP letterbox / dual-HP-header / scripted-beats / slow-mo tech), live **balance tuning** of his HP/atk vs the boss, and his signature **abilities as behaviours**.

### Boss evolution (per act)

Each cleared act, the player's boss **visibly transforms/ascends** — a new form, a power, and an upgraded throne — so the escalation is something the *player* feels, not just bigger enemy numbers. Four escalating forms across the run (act-gated cosmetic + a stat/ability bump). Builds on the existing boss-evolution scaffolding.

### Win / Loss / Meta / Endless

- **Win** (beat the Hero King) → **Victory screen** + **meta-unlock**: a new **"Reckoning" New Game+ difficulty tier** (harder acts / tougher draws) + a victory **achievement** (plus a possible cosmetic / boss / companion reward — TBD).
- After victory, the player may **continue into Endless mode** — today's infinite day-by-day scaling — for the leaderboard (the board can split "Victory" vs "Endless").
- **Loss** unchanged: boss dies 3× at any point → Game Over.
- Existing scripted events (Zombie Horde, Solo Leveling, Light Party, Treasure Raid, etc.) still fire *within* acts as flavor/variety, layered on top of the act framework.

### Open specifics to finalize during build

- Exact per-act day counts (default 10/10/10/10) and wave-scaling re-tuning around the act boundaries.
- Each Kingdom Response's precise mechanics, champion, and clear-condition.
- The Nemesis's exact per-return stat/ability escalation curve.
- The four boss-evolution forms (art + powers).
- Victory meta-unlock specifics (NG+ tuning + reward).

---

## Kingdom Responses — overhaul (locked design choices, 2026-06-03)

Each of the 9 Kingdom Responses is being elevated: more thematic, unique boss-level
champion, real VFX, balanced, fun. User's notes are captured VERBATIM below (build
from these, not paraphrase). ☐ = acceptance checklist item. ⚠ = needs a decision
before building (flagged to user). Champion sprites: user wants a UNIQUE LPC sprite
for each named champion (and themed retinue) — sprite-creation approach TBD (bake
themed LPC variants vs. hand-authored ULPC sheets).

**Cross-cutting (user request):** give EACH champion a powerful unique boss-level
ability so they feel like bosses, not buffed adventurers. (Proposals per response
below; confirm before building.)

### Inquisition
Facts: undead minions purged = the 13 undead-id minions (ghost1/2, lich1/2,
skeleton1/2/3, zombie1/2/3, dark_wraith, elder_lich, vampire_sovereign). Climax
spawn = 6 baseline (Mordrake + 3 Zealots + 2 Inquisitors), more with threat.
- ☐ Holy-light purge VFX must be a GREAT glow/light column hitting the undead, not an ugly graphic.
- ☐ Pact-suppression reads in HUD (grey out + "✝ PURGED"); non-undead builds also feel it.
- ☐ Unique LPC sprites for High Inquisitor + inquisitors + zealots.

### Pantheon
Facts: resurrection is AUTOMATIC on any pantheon-hero death — spawns a fresh
"Raised Guardian" (paladin, +10% HP), capped 4/act (not the seraph casting per se).
- ☑ Divine pillar resurrection VFX — must look good, not a simple effect.
- ☑ 50% of adventurer spawns are the Valkyrie class.
- ☐ Unique LPC sprites for Aurelia the Seraph + the angels.
- ☑ Mechanics+VFX SHIPPED 2026-06-03 — see "Pantheon — SHIPPED (slice #5 of 9)" below (divine pillar resurrection, 50% valkyrie wave, FINAL JUDGMENT row-wipe). Sprite still deferred.

### Rival
Facts: rival monsters currently use the monster_invader chassis (not specially
buffed). The Rival DUNGEON EVENT already uses real minion art + a random boss skin.
- 🟡 The "adventurers" are actual T1–T4 MINIONS (like the Rival Dungeon event), not normal adventurers. [retinue reads as monsters (monster_invader, noFlee); applying real T1–T4 minion SHEETS = sprite pass]
- ☑ The rival boss sprite is a random T4 boss when it spawns. [SHIPPED 2026-06-03 — Vorzak gets a random boss skin via rollRivalDungeonSprites().bossSkin → `_rivalBossSpriteKey` (renderer reads it), named "Vorzak, the <Archetype> Usurper".]
- 🟡 Unique cinematic for the boss-vs-boss fight, Aldric/Solo-Leveling style but completely unique animations + VFX. [DEFERRED — the SHOWDOWN set-piece]

**Rival status:** the rival-boss IDENTITY (random T4 boss skin on Vorzak) is shipped. The **boss-vs-boss SHOWDOWN** — the unique cinematic + the champion signature ("reuse the random-T4-boss-archetype's own kit, turned on you") — is a deep set-piece: the boss-archetype abilities live in BossSystem written for the PLAYER's boss vs. adventurers, so inverting one for an invader attacking your throne is real integration, and it pairs with the cinematic (reuse the Aldric/SL duel tech). Best built as a focused pass with live preview iteration, like the Aldric duel got its own phase. DEFERRED + flagged.

### Betrayer
Facts: a _spawnDefector already exists ("your strongest minion turns traitor, joins the raid mirroring its power").
- ☑ During the act, all traps damage ONLY my minions (turned against me). [SHIPPED — trap-flip, see "Betrayer — PARTIAL" below]
- 🟡 Night-phase intro (after Continue): the STRONGEST-tier minion runs to every trap at 2x speed and disables each, then leaves via the entry door; it does NOT respawn (abandoned you). [DEFERRED — animated set-piece; mechanical "lose strongest minion" already covered by _spawnDefector]
- 🟡 Champion looks like the minion that turned on you. [DEFERRED — sprite pass]
- ☑ Champion ability SABOTAGE (charm a minion to fight for the raid) SHIPPED 2026-06-03 — temporary defection, see "Betrayer — SHIPPED" below.
- ⚠ DECISION: "disable each trap" vs "all traps damage only my minions" read as opposite — assume the night-phase minion SABOTAGES/flips the traps so they then hit my minions for the act (confirm).

### Reckoning of the Dead
- ☑ Champion signature REANIMATE (Necrarch) SHIPPED 2026-06-03 — raises a just-killed unit as an undead THRALL marching the throne, rising from the freshest corpse (tracked via _onAdventurerDied) in a green grave-burst (necrotic pillar + bone shards + rune circle + crater). Reuses DayPhase._spawnRisenDead. Verified 10/10 (corpse-targeting, Necrarch fallback, no-op guards, dispatch via _championResponseId).
- ☑ Necrarch enters alone each day, stands still at the entrance, summons graves throughout the entry room(s), and summons the day's wave that way. [SHIPPED 2026-06-04 — DayPhase._spawnNecrarchSummoner: on each Reckoning mid-act day, spawn an immune Necrarch at the entry (RETURN suppresses the normal wave) + summon a tide of Risen Dead (the undead ARE the wave). NECRARCH_SUMMON → KingdomModifierSystem grave-burst VFX (necrotic pillars per risen) + a big summon at Necrarch + a standing necrotic aura. Verified LIVE.]
- ☑ Once all adventurers (besides Necrarch) are dead for the day, Necrarch leaves via the entry door. [SHIPPED — AISystem._tickAdventurer `_necrarch` branch freezes him at the entry until `_necrarchWaveSpent` (no other invader alive), then FLEE-out. Verified live: "His tide is broken — Necrarch withdraws through the entry, untouched."]
- ☑ Necrarch is IMMUNE to death + damage on the days he is not the champion. [SHIPPED — `_invuln` (CombatSystem) + `_invulnerable` (TrapSystem) + `_neverAttacks`. Verified: he withdrew untouched after the tide died.]
- ☑ Only on the LAST day does he join the wave as the champion (normal, killable). [ALREADY TRUE — the champion raid spawns Necrarch only on the climax day via _spawnChampionRaid; mid-act days currently use the undead trickle without a standing Necrarch]
- 🟡 Mix in undead-type minion sprites with the waves of risen adventurers. [partial — Risen Dead already use minion-zombie sheets; broader undead mix = sprite pass]
- ☐ Unique LPC sprite for Necrarch. [DEFERRED — sprite pass]

**Reckoning status:** champion signature (Reanimate) SHIPPED + the recurring-Necrarch-presence set-piece SHIPPED 2026-06-04 (enters alone → stands immune → summons the tide → withdraws when spent; champion-day Necrarch unchanged). Verified live via __qfDev.necrarch() / the SUMMON NECRARCH dev button. Unit test: 7/7 on the leave-condition (_necrarchWaveSpent). Remaining for Reckoning: undead-mix + Necrarch sprite (sprite pass). ⚠ BALANCE: mid-act undead tide = min(12, 5+dayInAct) — dial after a live look.

### Forlorn Hope
- ☐ Unique LPC sprite for Captain Halric. (Elevate ideas approved: rage-pulse VFX, fury counter, captain-death deflates the squad.)
- ☑ Mechanics+VFX SHIPPED 2026-06-03 — see "Forlorn Hope — SHIPPED (slice #3 of 9)" below for the full ticked checklist (rage-pulse, growing crimson aura, fury counter, oath-break rout, LAST VOW death-save). Sprite still deferred.

### Mage Tower
- ☑ 50% of each adventurer wave is the mage class.
- ☑ Room transmute: each wave disables at random 50% of your rooms' ABILITIES for the day, and shows the player which are disabled. (reroll daily — confirmed)
- ☑ They teleport minions to OTHER rooms (if not already there).
- ☐ Unique LPC sprite for Archmagus Velloran. (Elevate: blink-poof VFX + telegraph approved.)
- ☑ Mechanics+VFX SHIPPED 2026-06-03 — see "Mage Tower — SHIPPED (slice #4 of 9)" below for the full ticked checklist + the champion-dispatch fix. Sprite still deferred.

### All-Stars
- ☐ Unique LPC sprite for each of the four heroes (Myrine/Shadowfax/Elenwe/Aldous + Garreth).
- ☐ (My flagged gap: make it felt across the act, not just the climax — confirm desired.) — STILL OPEN, re-flagged in the SHIPPED block below.
- ☑ 4 signatures + VFX SHIPPED 2026-06-03 — see "All-Stars — SHIPPED (slice #6 of 9)" below. Sprites + the across-the-act question still open.

### Plunderers
- ☐ 50% of them are the pirate class. Pirate-themed response.
- ☐ Rename the champion to a pirate-captain name (not "Vell").
- ☐ Unique LPC sprite for the (renamed) captain. (Elevate: coins-streaming drain VFX + heist-to-treasury behavior approved.)

### Confirmations (2026-06-03) + build order

**Champion signature abilities — CONFIRMED** (each boss-level, themed, telegraphed, with VFX):
- Inquisition / Mordrake → **Excommunicate** (holy beam instakills one undead minion + silences a random pact for the fight)
- Pantheon / Aurelia → **Final Judgment** (channels a screen-wide smite that wipes a minion row unless interrupted)
- Rival boss → **its random-T4-boss-archetype's own signature** (reuse the boss ability kit, turned on you)
- Betrayer / Turncoat → **Sabotage** (briefly charms one of your minions to fight for it)
- Reckoning / Necrarch → **Reanimate** (raises a just-killed unit as an undead thrall)
- Forlorn / Halric → **Last Vow** (survives one lethal hit at 1 HP, then a massive fury roar)
- Mage Tower / Velloran → **Polymorph** (turns a minion into a harmless critter for a few seconds)
- All-Stars → each of the 4 a distinct signature (Stormcaller chain-lightning, Trueshot piercing volley, Aldous mass-heal, Shadowfax blink-backstab)
- Plunderers / pirate captain → **Grand Heist / Cannon Volley** (big gold-grab + pirate cannon barrage)

**Betrayer decision — RESOLVED:** the night-phase minion SABOTAGES/flips the traps so they hit MY minions; the flipped-traps-hit-only-my-minions lasts the WHOLE act.

**Mage Tower — CONFIRMED:** the disabled rooms RE-ROLL daily (different 50% each day).

**Sprites — DEFERRED (do last):** mix of (A) baked themed LPC variants + (B) hand-authored ULPC sheets; not a priority right now — wire behavior/ability/VFX first with existing/placeholder sprites.

**BUILD ORDER (one full vertical slice per response: behavior + signature ability + VFX + balance + dev-test):**
1. Plunderers  2. Inquisition  3. Forlorn Hope  4. Mage Tower  5. Pantheon
6. All-Stars  7. Betrayer  8. Reckoning of the Dead  9. Rival  → then the sprite pass.

### Plunderers — SHIPPED (mechanics, 2026-06-03) — slice #1 of 9
- ☑ 50% pirate class (themed-wave injection, plundererThief) — KR_THEMED_WAVE in DayPhase.
- ☑ Champion renamed → "Dread Captain Vane" (pirate chassis); retinue 50% pirate; pirate vanguard.
- ☑ Signature GRAND HEIST (gold grab + cannon volley) via the reusable champion-ability framework.
- ☑ Heist-the-vault AI (seek chest → rob w/ pirate bonus → escape with loot).
- ☑ Coin-drain VFX (steal burst + "−Xg" per thief).
- ☐ Unique LPC sprite for Dread Captain Vane (DEFERRED — sprite pass).
- ⚠ BALANCE: 50% thief waves draining+heisting may be too strong; dials = PLUNDER_PICKPOCKET_PCT + the 0.5 fraction.

### Inquisition — SHIPPED (mechanics+VFX, 2026-06-03) — slice #2 of 9
- ☑ Holy-light purge VFX — a beautiful light column (beamPillar + god-rays + motes + halo) on each purged undead, capped 5/tick.
- ☑ Champion signature EXCOMMUNICATE (Mordrake) — charge → BIG holy column → vaporizes strongest undead (or strongest minion of any type if none → non-undead builds feel it).
- ☑ Pact-suppression HUD readout — sealed pact glyphs grey out + a bright "✝" cross stamp (TopBar qf-buffs-sealed enhanced). Driven by the existing INQUISITION_SUPPRESS_CHANGED.
- ☐ Unique LPC sprites for High Inquisitor + inquisitors + zealots (DEFERRED — sprite pass).
- ☑ RESOLVED (user, 2026-06-03): Excommunicate's pact-silence stays the act-wide _inqSuppress (ALL pacts inert "✝ PURGED" while the Inquisition is in the dungeon). User chose "act-wide is fine" — the per-pact-engine refactor is explicitly dropped as redundant.

### Forlorn Hope — SHIPPED (mechanics+VFX, 2026-06-03) — slice #3 of 9
- ☑ Rage-pulse VFX per martyr death — dark-red death-ember implodes at the fallen, each survivor flares a crimson burst (burstRays + pulseRing + embers, hotter w/ stacks), faint red flash + micro-shake. (_forlornRagePulse)
- ☑ Growing crimson fury aura — a per-tick ground-pool under each living martyr scaling radius+heat with its fury stacks (faint doomed presence even at 0), rising ember flecks. (_tickForlornVfx / _forlornG)
- ☑ Fury counter — an in-world "⚔ FURY ×N" tag floating over the captain (or squad lead), punch-scales on each fresh kill, shifts orange→gold as fury climbs.
- ☑ Captain-death deflates the squad — killing Halric (the binder) SHATTERS the oath: survivors lose all fury (collapse to base×0.6), drop noFlee, and rout for the exit; auras snuff (grey implosion). Day-end clear means the rout is visible. (_forlornOathBreak + FORLORN_OATH_BROKEN log)
- ☑ Champion signature LAST VOW (Halric) — the FIRST lethal hit can't kill him: CombatSystem clamps it to 1 HP (same reactive mould as Lay on Hands / Grog Rage) and fires a fury ROAR — crimson shockwave + the whole squad surges +3 fury for his final stand; ChampionBar flashes "⚡ LAST VOW!". (CombatSystem _lastVow floor + _onForlornLastVow)
- ☑ Fury math hardened — stacks recompute from a stashed pre-fury BASE (no rounding drift; clean revert on oath-break). (_applyFury)
- ☐ Unique LPC sprite for Captain Halric (DEFERRED — sprite pass).
- Verified: 34/34 isolation asserts (fury idempotency, living-only stacking, death routing, oath-break rout, Last-Vow roar, + the REAL CombatSystem death-save: first hit→1 HP + emits once, second hit kills, non-Last-Vow dies normally).
- ⚠ BALANCE (eyeball): FORLORN_DEMORALIZE_MULT=0.6, LAST_VOW_STACKS=3, ATK/SPD per death 1.12/1.08 — tune after a live look.

### Mage Tower — SHIPPED (mechanics+VFX, 2026-06-03) — slice #4 of 9
- ☑ 50% mage themed wave (KR_THEMED_WAVE.mage_tower in DayPhase).
- ☑ Room transmute — each COMBAT day, a random ~50% of your ABILITY rooms (special/combat/utility/trap categories; never the boss room or structural starters) are SEALED: their special function is disabled via the existing `room.isActive` gate (~30 read-sites already respect it; the renderer auto-dims the room). RE-ROLLS daily (restore-then-repick at DAY_PHASE_STARTED), restored at NIGHT so the build phase is clean. MAGE_TRANSMUTE event drives the HUD log ("which rooms"). + arcane seal-poof + per-tick violet rune shimmer over each sealed room.
- ☑ Teleport minions to OTHER rooms — _mageBlink now prefers a partner in a DIFFERENT room so the swap relocates both across the dungeon; violet depart+arrival poofs at both endpoints.
- ☑ Champion signature POLYMORPH (Velloran) — turns a random minion into a harmless critter for ~5.2s: it can't attack (CombatSystem `_polymorphed` gate) or move (MinionAISystem gate); poof-in + a floating "🐑" critter bubble + poof-back. MINION_POLYMORPHED/_END events.
- ☑ Champion-ability dispatch hardened — `_tickChampionAbility` now dispatches on the champion's OWN `_championResponseId` (not the ambient act response), so a DEV-spawned raid card fires the right signature. **Fixes dev-card eyeballing for ALL champion abilities (Grand Heist / Excommunicate / Polymorph).**
- ☐ Unique LPC sprite for Archmagus Velloran (DEFERRED — sprite pass). The "🐑" critter is a tag, not a sprite swap (also a sprite-pass item).
- Verified: 26/26 isolation asserts (ability-room classification, 50% seal + boss/starter exclusion, non-mage-act no-op + restore, daily re-roll + night restore, polymorph flag+revert, REAL CombatSystem attack-gate, champion-response dispatch).
- ⚠ BALANCE (eyeball): MAGE_TRANSMUTE_FRACTION=0.5, MAGE_POLY_MS=5200 — tune after a live look.

### Pantheon — SHIPPED (mechanics+VFX, 2026-06-03) — slice #5 of 9
- ☑ 50% Valkyrie themed wave (KR_THEMED_WAVE.pantheon, flagged pantheonHero so the winged host also gets the holy aura + auto-resurrect).
- ☑ Divine pillar resurrection VFX — _pantheonRaise now repositions the Raised Guardian ONTO the corpse tile and fires a GRAND pillar there: resurrectBeam core + beamPillar + godRays + holy magicCircle + sunburst + rising motes + shockwave ring + soft flash. (was: spawn at entry, no VFX.)
- ☑ Champion signature FINAL JUDGMENT (Aurelia) — channels a screen-wide smite over the minion ROW (±1.5-tile horizontal band) holding the MOST minions: gold danger band + per-minion telegraphs during the ~1.5s channel, then holy pillars sweep the band for wipe-grade damage (max(flat, 60% maxHp)). INTERRUPTIBLE — cut her down mid-channel and it FIZZLES (no damage). PANTHEON_JUDGMENT event (hit / fizzled) drives the HUD beat.
- ☐ Unique LPC sprites for Aurelia + the angels (DEFERRED — sprite pass).
- Verified: 14/14 isolation asserts (raise reposition+cap+event, judgment band-targeting + wipe-grade damage + spares-out-of-band, fizzle-on-interrupt, empty no-op).
- ⚠ BALANCE (eyeball): Valkyries are already strong (ignore-traps + Rally self-revive); making 50% of the wave pantheonHero valkyries (holy heal + extra resurrect) may be a lot — watch it. JUDGMENT_CAST_MS=1500, band ±1.5 tiles, 60% maxHp wipe.

### All-Stars — SHIPPED (mechanics+VFX, 2026-06-03) — slice #6 of 9
- ☑ FOUR distinct champion signatures, one per named hero, each on its OWN staggered cadence (a "deadly concert", not a synchronized nuke):
  - Myrine the Stormcaller (mage) → **Chain Lightning** — bolt leaps through up to 4 nearest minions with per-hop falloff.
  - Elenwe Trueshot (ranger) → **Piercing Volley** — 3 arrows skewer every minion within ~20px of the firing line (down the row).
  - Brother Aldous (cleric) → **Mass Heal** — holy nova restoring every living All-Star incl. the leader Garreth.
  - Shadowfax the Quick (rogue) → **Blink-Backstab** — vanishes and reappears on your strongest minion for a heavy strike.
- ☑ Heroes tagged `_allStarSig` by class at spawn (DayPhase); fired by `_tickAllStarAbilities` (UNIT-gated, not resp-gated → dev raid card works) alongside the existing crown/synergy-link VFX.
- ☑ ALLSTAR_ABILITY event → RightPanels names the hero + move each cast.
- ☐ Unique LPC sprites for the 4 heroes + Garreth (DEFERRED — sprite pass).
- ⚠ FLAGGED GAP (needs user confirm): "felt across the act, not just the climax." Right now only the climax raid carries the 4 heroes (vanguard = a single Champion's Herald). The other responses inject a themed 50% wave all act; All-Stars doesn't (a 4-legend team doesn't map to a wave-fraction). Confirm if you want mid-act pressure here and how (e.g. herald scouts, or rotating single-hero cameos).
- Verified: 18/18 isolation asserts (staggered dispatch → all 4 fire distinct moves; chain falloff + 4-hop cap; volley on-line hit / off-line spared; mass-heal all + clamp; blink targets strongest + repositions).
- ⚠ BALANCE (eyeball): ALLSTAR_CD_MS=7600, per-ability damage/heal scale with boss level — tune after a live look.

### Betrayer — SHIPPED (mechanics+VFX, 2026-06-03) — slice #7 of 9
- ☑ TRAP FLIP (the marquee mechanic) — for the WHOLE Betrayer act, every trap targets AND is triggered by YOUR MINIONS instead of the invaders. Was a full blackout; now a true flip per the resolved design. Implemented in TrapSystem._targets() + _trapTriggerers() + the 2 direct trigger checks (LOS scan, bomb fuse), all gated on _betrayerFlip(). Minions take FULL trap damage (the adv-only 30% cap / instakill clamps don't apply to them). Verified 11/11.
- ☑ Flipped-trap VFX — a pulsing green "⇄ turned" mark over each live trap during the act (_tickBetrayerVfx).
- ☑ Champion signature SABOTAGE (the Turncoat) — briefly CHARMS one of your minions to fight for the raid: a TEMPORARY defection (flips the minion's faction to 'adventurer' for ~6s, then snaps it back), reusing the SAME faction='adventurer' path the permanent defector already runs through — so the AI knows how to drive a turned minion (not a blind faction hack). Green charm poof + a per-tick "⤝" charm ring while it lasts. Verified 13/13 (flip→raid, revert-on-expiry, valid-target filtering, no-op, dispatch via _championResponseId).
- 🟡 DEFERRED (polish / sprite — best done with live iteration):
  - **Night-phase animated sabotage intro** (the strongest minion physically dashing trap-to-trap at 2× then exiting via the entry door). The mechanical flip is already whole-act + the trap-flip VFX shows the result; this is an extra spectacle wrapper (a scripted minion-dash animation). The "you lose your strongest minion" beat is ALREADY covered by _spawnDefector (it removes your strongest + mirrors its power at the climax).
  - **Champion looks like the turned minion** — a sprite swap; folds into the deferred sprite pass (could merge defector→champion).
- ⚠ BALANCE (eyeball, IMPORTANT): flipped traps fire on patrolling minions continuously — this could SHRED your minion line over a whole act. Faithful to the spec ("all traps damage only my minions all act") but watch it hard in a live run; may want a per-minion cooldown or a damage cap.

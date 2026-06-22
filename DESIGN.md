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
8. ~~**The Undying Court** — Up: every adventurer who dies rises the next night as an undead minion of its class (stats carried over). / Down: each occupies 2 minion slots and buffs living adventurers; with no free slots, 2 of your minions are sacrificed to make room.~~ **(reworked 2026-06-04 — see "The Undying Court rework" below)**

The trade-off should really make you think before choosing them. **I want tons and tons of different mechanics and trade offs to be added.**

### The Undying Court rework (2026-06-04) — full replacement of the legendary above

Stays **legendary**. The old auto-raise / living-buff / 2-slot mechanic is fully replaced by an opt-in, click-to-revive devil's bargain.

**Benefit (user's verbatim spec):**
> I want it to allow the player to revive dead adventurers as minions if they chose. reviving a dead adventurer will sacrifice a random normal minion (not another revived adventurer). if there is no minion to sacrifice, the reviving fails (with a error toast to let them know and know why it failed). when the player has this pact, I want the game to now keep dead adventurer sprites from the day phase to last to the following night phase. but during the night phase, i want those dead adventures to have a slight red glow to indicate that the player can click and revive them. That way the player can click adventures and get an option to revive them at the cost of another minion. the adventurer should then revive on the spot where it died and look like a darker version of itself (to avoid confusion with normal adventures). that revived adventurer should then function like a normal minion, in that they can be moved, or sold just like normal ones. selling them does not give back any gold. each revived adventurer counts a 1 minion slot. they should look exactly like the original adventurer sprite that died and have the same class and abilities.

**Curse (user's verbatim spec):**
> I want the cost of all minions and traps and items to double and stay doubled through the rest of their run.

**Confirmed design decisions (from the 2026-06-04 review):**
- Revive is **opt-in** via clicking a red-glowing corpse at night → a small "Revive — cost: 1 minion" confirm (works regardless of active night tool).
- Sacrifice = a **random NORMAL minion** (never another revived adventurer); a small death-puff plays on whichever is taken. Sacrifice is unconditional even with free slots. If no normal minion exists → revive fails with an **error toast** (`showToast(..., {type:'error'})`).
- Corpses persist **only the night after death** (die day N → revivable night N → gone by day N+1 if ignored).
- Corpse = red glow (clickable). Revived unit = **exact class sprite, dark-tinted** (~0.55 multiply + faint desaturation), no red glow. Three distinct reads: living adv / revivable corpse / my undead minion.
- Revived unit is a normal minion: movable, **sellable for 0 gold** (`_revivedAdv` flag the sell logic checks), counts **1 slot**. Net slot change of a revive is zero (−1 sacrifice, +1 revived), so it can never exceed cap.
- Curse routes through the existing `def.goldCost × buildScaleMul(gameState)` cost path: ×2 when the flag is set (shows doubled prices everywhere automatically) + a one-time toast on seal. It's a **curse**, so it survives Inquisitor suppression. 2× is the headline (tunable to 1.5× post-playtest).
- **VFX:** every carried ability reuses the **same `AbilityVfx.*` calls** as the living version (they take scene + world-coords, not the adv entity) → identical visuals.

**Ability carry-over (revived unit DEFENDS the dungeon — does the ability still make sense?):**

*Carried (run the SAME ability code, faction-flipped):* Knight (Protective Aura, Taunt) · Mage (Arcane Burst + Elemental Affinity) · Cleric (Heal, **Resurrection** 1/day) · Necromancer (Bone Armor, **Summon Undead** — summons are temporary, **cleaned up at `DAY_PHASE_ENDED`**) · Ranger (Volley) · Barbarian (Unstoppable + Rage Scaling) · Monk (Focus, Inner Peace) · Bard (Inspire Party, Song of Speed, Encore) · Gladiator (Block, Crowd Roar) · Peasant (Strength in Numbers) · Gambler (Roll the Dice, **Double or Nothing in full** — WIN self-revive / LOSE house pays the owner) · Valkyrie (**Winged Flight** — kept, since some traps damage your minions by design; **Rally the Fallen** 1/day) · Rogue (**Invisibility** — brief untargetable/ambush).

*Not carried (raid-only — flagged `carriesToRevived:false` in `ABILITY_DEFS`):* Rogue Lockpick · Ranger Trap Expert · Beast Master Tame Beast & Scout Ahead · Barbarian Break Door · Miner Tunnel.

*No special ability (revive = stats + sprite + basic attack):* Templar, Pirate, Cosplayer, Cartographer, Loot Goblin.

*NOT revivable at all (flagged `revivable:false` in `adventurerClasses.json`):* **Cheater**, Sung Jinwoo (shadow_monarch), Aldric, Rival Monster (monster_invader), Rival Dungeon Boss (rival_boss_invader), Light Party (paladin / white_mage / samurai / black_mage), Twitch Streamer (REMOVED 2026-06-05).

**Architecture (so future content "just works"):**
- Revived units run the **same `ClassAbilitySystem` defs + `_considerX` logic + `AbilityVfx`** — no duplicated copy — with ally/enemy lookups made **side-aware** in the shared helpers (`_allyInDangerNearby`, `_hostileMinionWithin`, `_findFallenToRevive`, …). ⇒ future ability tweaks / new abilities inherit automatically (contract: new abilities must use those shared helpers).
- **Opt-OUT, data-driven, default-on:** `revivable:false` on a class JSON excludes it; `carriesToRevived:false` on an ability def excludes that ability. **New classes are revivable and their new abilities carry by default** — you only ever edit these flags to exclude.

**Acceptance checklist (tick each against actual code before claiming done):**
- [ ] Corpses persist day→following night; cleaned next day if not revived
- [ ] Corpse red-glow at night + clickable; revive-confirm popup ("cost: 1 minion")
- [ ] Revive sacrifices a random NORMAL minion (never a revived one) + death-puff on it
- [ ] No normal minion → revive fails + error toast explaining why
- [ ] Revived unit spawns on the death tile, dark-tinted exact class sprite, no red glow
- [ ] Revived unit is a minion: movable, sells for 0 gold, counts 1 slot
- [ ] Carried abilities fire for revived units via shared code + identical VFX
- [ ] Necromancer Summon Undead summons despawn at `DAY_PHASE_ENDED`
- [ ] Gambler Double or Nothing works in full for a revived gambler
- [ ] Curse: all minion/trap/item costs ×2 run-long, shown in buy menus, survives Inquisitor, seal toast
- [ ] `revivable:false` on the 11 excluded classes; `carriesToRevived:false` on the 6 raid-only abilities
- [ ] Pact description + tradeoffDescription rewritten (propagates to all surfaces)

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
3. **Mage** — *Arcane Mastery* (passive; flat +30% spell damage). *Arcane Burst* (cooldown ~20s; activate → next spell hits 1-tile AoE). *(Was Elemental Affinity — 1.5× vs a target's elemental weakness — retired 2026-06-10 with the vulnerability system; a cosmetic spell element still tints the Arcane Burst VFX.)*
4. **Cleric** — *Resurrection* (1/run; revive a fallen party member at 30% HP). *Heal* (medium CD ~10s; targets lowest-HP ally <70% in range). Passive: 1.5× damage vs undead minions.
5. **Necromancer** — *Summon Undead* (large CD; spawns 2 fresh low-HP/low-ATK skeletons or zombies on adventurer faction). *Bone Armor* (active, large CD; +ATK/+DEF buff for set duration, scales with currently-living summons).
6. **Ranger** — *Volley* (every-5th-shot proc; fires a 3-arrow cone). *Trap Expert* (1–5/day by level, 20% fail-then-trigger; disabled traps stay disabled until day end). Arrow consumption removed.
7. **Twitch Streamer** — ❌ REMOVED 2026-06-05 (class fully cut, per user + IP cleanup). *Viewers Choice* (random auto-trigger; slot-machine UI; RNG buff/debuff: heal, ATK ±20% 10s, DEF ±2 10s, random teleport, slow poison, invis 10s, etc). *Chat Decides* (random ~15s interval; chat picks one of: investigate-trap / fight-engaged-enemy / abandon-current-goal / charge-boss-room). Passive: *Subscriber Revenge* — on death, 50% chance next day's spawn count gets +3, with arrival notifier.
8. **Beast Master** — *Tame Beast* (single companion enforced; ~~50% success~~ **now always succeeds — fail chance removed 2026-06-20**). *Scout Ahead* (1/day; companion leaves to scout, knowledge transfers back to BM, BM is companion-less while scouting).
9. **Barbarian** — *Break Door* (active; opens locked doors but alerts neighbor rooms — dormant until doors land). *Unstoppable* (passive; immune to all flee triggers). Passive: *Rage Scaling* (damage = base × (1 + (1−hpFrac)) up to 2× at 1 HP; VFX kicks in at high rage).
10. **Monk** — *Focus* (medium CD; 30% dodge vs damage AND traps for set duration). *Inner Peace* (large CD; +1 HP/sec for set duration).
11. **Bard** — *Inspire Party* (medium CD; 2-tile, +15% ATK during set duration). *Song of Speed* (medium CD; 2-tile, +20% SPD during set duration). Passive: *Encore* — when Bard dies, all party members heal 25% as a final flourish.

Cooldown buckets: short = 5–8s, medium = 12–18s, large = 30–60s. Per-day budgets refilled at day start. Debug toggle (Ctrl+Shift+C) clamps every cooldown to 1 second so all abilities can be visually verified within a single dungeon run.

**Element vulnerabilities** — ❌ REMOVED 2026-06-10 (per user: "too complicated"). The
`vulnerableToElements` field was stripped from all minions, the Mage's Elemental Affinity
became the flat Arcane Mastery passive, and the (always-empty) WEAK TO / RESISTS chips were
removed from the Adv Intel panel. `damageType` (hit-spark colors + minion damage-reduction
gating) and the Cleric's tag-based anti-undead bonus are separate systems and were kept.

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

## Boss base-stat combat profiles (2026-06-21)

Previously deferred (*"boss stats flat for now"* — all 12 archetypes shared `baseFightStats`
200/12/10; differentiation was abilities-only). **Un-deferred + shipped 2026-06-21:** each
archetype now has a distinct combat profile that reinforces its fantasy, redistributed around
the **same centroid** (avg ≈ 200/12/10) so overall difficulty is unchanged — it redistributes,
it doesn't inflate. Profiles (HP / ATK / DEF · role):

Golem 300/8/16 Living Fortress · Slime 280/8/7 Endless Mass · Myconid 250/9/12 Attrition Tank ·
Orc 240/15/9 Heavy Bruiser · Lizardman 230/12/11 Resilient · Vampire 200/14/10 Sustain Duelist ·
Gnoll 180/16/7 Frenzied Striker · Beholder 170/15/9 Caster Tyrant · Wraith 150/11/16 Evasive
Phantom · Demon 160/16/6 Glass Cannon · Lich 150/15/6 Frail Archmage · Succubus 130/13/6
Fragile Controller.

The **boss-select screen** (`ArchetypeSelectOverlay`) shows each boss's HP/ATK/DEF with
comparative fill **bars** (value ÷ field max) + a one-word **combat-role label** so the player
reads the playstyle at a glance. Data-only stat change; the existing `_recomputeBossFightStats`
level/ascension/pact scaling applies on top. **Caveat:** base *ratios* compress late-game under
the shared `(base + 15·lvl)·1.20^lvl` curve — a follow-up could add per-archetype scaling
multipliers (needs `sim:balance`) if sharper high-level identity is wanted.

## Endless meta-game — PROPOSED / FUTURE (explored 2026-06-21, NOT built)

Design exploration the user liked but deliberately parked ("not something I want to implement
now, but something we will do later"). Three interlocking systems that convert Endless from a
numeric treadmill into a press-your-luck roguelite meta-game. Addresses STATUS.md's two biggest
acknowledged gaps (no win/exit in endless; spectator day phase). **Endless-only** (`isActsEnabled
(gs)===false`); campaign keeps its own act structure. Build from THIS spec when picked up.

**1. Cash-out / "press your luck" loop (the spine).** New persistent run-currency **Infamy**
(accrues from days survived + kills + difficulty). At milestones (boss tier-ups at Lv 4/7/10, or
a named "Siege" wave every ~5 days) a **Crossroads** choice fires:
- *Seal the Dungeon* → run ends VOLUNTARILY, bank 100% Infamy + clean-exit bonus, leaderboard
  score flagged "sealed".
- *Delve Deeper* → continue; adventurers take a stacking difficulty step AND Infamy/gold gain a
  multiplier (this is what dynamically raises Wrath, see #3).
- Death (boss 3× down) instead of sealing → keep only ~40% Infamy. That gap IS the tension.
- Infamy spends on a persistent meta-track (a "Dark Throne" tree / boons / cosmetics) in
  `PlayerProfile` — answers "what did this run earn me?". Touches: PlayerProfile, a Crossroads
  overlay in the EndOfDay popup queue, Leaderboard (sealed vs died). Effort L; Phase A = the
  decision + Infamy banking + death penalty, Phase B = the meta-spend tree.

**2. Day-phase "react" layer (fixes spectator day).** A small pool of REACTIVE interventions
(NOT unit control — keep watch-the-sim identity) on a **Command** resource that refills over the
day: *Rally* (one-shot send a roaming minion to a tile), *Fear Pulse* (panic a cluster → easy
kills; rides NerveSystem, cashes out as a player win), *Collapse* (drop a floor tile: dmg+slow),
*Re-arm/re-aim a trap*. The boss's unique day-active stays its signature; this is the shared
baseline. Touches: a Command HUD bar (day only), MinionAISystem, NerveSystem, TrapSystem,
AbilityVfx. Effort M–L. ⚠ Keep it to a few impactful casts (intervention, not RTS micro) — that
line protects the genre feel.

**3. Hades-style "Wrath" meter (player-authored difficulty).** A summed, toggleable difficulty
ladder reusing the damned/curse-pact infrastructure as the conditions (e.g. `+1` advs +15% HP,
`+2` parties a day early, `+3` champion raids 2×, `+1` one fewer minion slot…). Sum = **Wrath
Level**; higher Wrath → tougher invaders BUT → reward multiplier (gold, Infamy, better pact offers,
leaderboard prestige). Per-boss Wrath high-score (like Hades per-weapon Heat). Replaces invisible
auto-scaling with a legible self-set dial. Touches: DungeonMechanicSystem + existing curse effects,
a Wrath-config UI, Leaderboard. Effort M. ⚠ Keep DISTINCT from the random end-of-day pact draws
(those stay the build-diversity RNG layer; Wrath = standing player-chosen difficulty).

**They interlock:** Wrath sets stakes → react layer lets you survive them → cash-out banks the run
(Infamy scaled by Wrath) and Delve-Deeper raises Wrath mid-run. Endless becomes "set your stakes,
actively defend, choose when to bank." **Suggested build order if picked up: #1 (spine+currency) →
#3 (cheap once Infamy exists) → #2 (meatiest, most genre-risky).**

## Older-class ability redesign (2026-06-14)

The 9 "older" adventurer classes (Knight, Bard, Monk, Cleric, Mage, Necromancer, Ranger,
Beast Master, Barbarian) predate the more interesting newer kits (Gladiator/Valkyrie/Gambler/
Miner/Peasant). User directive (2026-06-14): *"go through them and let me know what you think.
some might be fine as is, some may need minor tweaks, some may need major overhauls."* Bar to
clear: each ability should create a **distinct strategy or player counterplay**, not a flat stat
buff/damage reskin. Verdicts: **Cleric + Necromancer = fine, leave them.** The other 7 get
proposals below. Build order: **Barbarian first**, then Bard/Mage/Monk, then Beast Master/Ranger/
Knight. VFX is a SEPARATE second phase (build mechanics first, then the bespoke-VFX pass).

### 🪓 Barbarian — Reckless Charge (LOCKED 2026-06-14, building now)

**Problem:** today the Barbarian is all-passive (Rage Scaling + Unstoppable) with a dormant
Break Door — nothing the player ever sees fire. Add one real active.

- **Passives (unchanged):** Rage Scaling (`dmg × (1 + (1 − hpFrac))`, up to 2× at 1 HP) ·
  Unstoppable (immune to ALL flee triggers).
- **Reckless Charge (new active):**
  - **Trigger:** a hostile-minion cluster of **2+** within **~6 tiles**, off cooldown. Targets
    the **densest** cluster (most minions within 1 tile of a candidate), not just the nearest.
  - **Telegraph:** ~0.4s wind-up (stands still, `_castingUntil`) so the player can read it — the
    counterplay window.
  - **Charge:** dashes in a **straight line** to the target tile at ~3× speed, AISystem yielding
    via `_castingUntil` (ClassAbilitySystem drives position directly). Stops early at a wall.
  - **Path effect (LOCKED: knockback + stagger ONLY, no path damage):** every minion the line
    passes through is knocked back **1 tile** (along the charge dir, clamped to walkable) and
    **staggered ~1s** (`_staggeredUntil` → skips its AI turn). Full damage hits ONLY the end target.
  - **Impact:** ends adjacent to the densest point and swings normally (Rage Scaling applies).
  - **Cooldown:** ~12s.
  - **Counterplay (the point):** he overcommits deep, away from party support; Unstoppable means
    he won't retreat — bait the charge and surround him in a kill-box.
- **Systems:** `ClassAbilitySystem` (`_considerBarbarian` + `_tickCharge` mover + knockback
  helper) · `AISystem` (already yields on `_castingUntil`) · `MinionAISystem` (ADD the missing
  minion-side `isStaggered` reader — API exists in MinionAbilities, only the adv reader was wired)
  · `SaveSystem` (strip new `_charge*` fields; `_staggeredUntil` already stripped).

#### Acceptance checklist (tick against CODE before "done")
_(Code-built + verified 2026-06-14: headless ability harness 25/25, soak 120/120 clean, and a
live deterministic dash trace in-engine — placeholder VFX; the bespoke-VFX pass is phase 2.)_
- ✅ Rage Scaling + Unstoppable unchanged (CombatSystem / AISystem passives untouched)
- ✅ Charge triggers only on a 2+ cluster within ~6 tiles, off ~12s cooldown (`_pickChargeCluster`)
- ✅ Targets the densest cluster, not merely nearest (live: chose (24,24), the 3-cluster centre)
- ✅ ~0.4s telegraph wind-up before the dash (`_chargePhase:'windup'` + `_castingUntil`)
- ✅ Straight-line dash, AISystem yields via `_castingUntil`, lands one tile short / stops at walls (live: (24,28)→(24,25))
- ✅ Path minions: knocked back 1 tile (walkable-clamped) + staggered ~1s, NO path damage (live: all 3 → y24→y23, staggered, full HP). Whole cluster caught via line + impact radius.
- ✅ Minion stagger skips the minion's turn (new `isStaggered` reader in MinionAISystem.updateMinion)
- ✅ End target takes a full swing (lands adjacent; normal CombatSystem swing, Rage Scaling applies)
- ✅ Transient `_charge*` fields stripped on load; soak 120/120 no save/freeze regression
- ✅ Verified live in-engine + `sim:soak` (balance unaffected — charge deals no extra damage)

### 🎵 Bard — Crescendo (LOCKED 2026-06-14, built + verified)

**Problem:** three flat percentage auras (+15% atk / +20% spd / death-heal) = a stat-buff reskin.
**Replaced** Inspire + Song of Speed with ONE escalating anthem. **Kept** Encore (death-heal).

- **Anthem:** while the Bard is alive and combat is near (a party ally engaged within ~4 tiles, or
  the bard is fighting), he builds **+1 stack every ~3s**, cap **4**.
- **Effect:** nearby party (within ~3 tiles) gets **+5% atk / +4% spd per stack** → +20% / +16% at
  full. Read at the existing `_inspireActiveUntil` (CombatSystem) / `_songSpeedActiveUntil`
  (AISystem) gates, but the MULTIPLIER now comes from the bard's live `_crescendoAtkMul` /
  `_crescendoSpdMul` (stored on the entity).
- **Shatter (counterplay, LOCKED: solid hit OR CC):** a single blow **≥10% of the bard's max HP**
  (via a COMBAT_HIT listener) OR any stun/stagger/root/fear/petrify resets stacks to 0 + **2s
  silence**. Chip damage does NOT break it — reward a committed burst on the bard.
- **Decay:** out of combat, −1 stack every ~2s.
- **VFX:** placeholder (note motes / discord shatter) — phase 2.

#### Acceptance checklist (verified live 2026-06-14)
_(Ability harness 25/25, soak 120/120, live in-engine trace.)_
- ✅ One escalating anthem replaces the two flat auras; Encore kept
- ✅ +1 stack / ~3s while in combat, cap 4 (live: 1→2→3→4)
- ✅ +5% atk / +4% spd per stack → +20%/+16% at cap (live mults 1.05→1.20 / 1.04→1.16)
- ✅ Buff reads through to nearby party (live: ally base-100 hit → 120 atk; speed mult 1.16)
- ✅ Solid hit ≥10% max HP shatters → stacks 0 + 2s silence (live)
- ✅ Chip hit does NOT shatter (live: 3 dmg < threshold, stayed at 2)
- ✅ CC (stagger/root/panic/petrify) shatters the song
- ✅ Out-of-combat decay −1/~2s (live: 2→1→0)
- ✅ Transient `_crescendo*` fields stripped on load; intel description updated

### 🔮 Mage — Elemental Arcana (LOCKED 2026-06-14, built + verified)

**Problem:** Arcane Burst was a generic AoE button; the rolled element was purely cosmetic after
vulnerabilities were gutted. **Keep** Arcane Mastery (+30%). The element now has an **intrinsic
effect** on minions the mage hits — modest per swing, amplified by Arcane Burst (no vuln tables):
- 🔥 **Fire** — applies/refreshes a **Burn DoT** (~25% of hit/tick × 3); burst = AoE + stronger burn.
- ❄️ **Ice** — **Chills** (move ×0.6 / ~1.8s); burst = AoE + deeper chill. (Added the missing
  minion-movement slow reader in `MinionAISystem._moveToward`.)
- ⚡ **Lightning** — **arcs** to 1 neighbor (~45%, gated ~1.2s); burst = **branching bolt**, up to 3 hops.
- 💨 **Wind** — **knocks** target back 1 tile (gated ~2.5s); burst = AoE + scatters all hit.

**Systems:** `CombatSystem._applyMageElement` + `_fireArcaneBurst` + `_nearestMinionsTo`/
`_dealSplash`/`_knockbackMinion`; reuses `_dot` + `_slowUntil/_slowMult`. SaveSystem strips
`_arcLastAt`/`_gustLastAt`. Intel updated.

#### Acceptance checklist (verified 2026-06-14)
_(Ability harness 25/25, soak 120/120, `tools/sim/mage-element-check.mjs` 9/9, balance sweep normal.)_
- ✅ +30% Arcane Mastery kept; element rolled once
- ✅ Fire burn (refreshes, no stack) · Ice slow (+ minion-move reader) · Lightning chain (gated) · Wind knockback (gated)
- ✅ Burst lightning = branching bolt (≥2 hops) · burst fire/ice/wind = radial AoE + strong element
- ✅ Transient gate fields stripped on load; intel description updated

### 🧘 Monk — Riposte + Stunning Palm (LOCKED 2026-06-14, built + verified)

**Problem:** Focus (dodge) + Inner Peace (self-regen) were both invisible self-stats with no
counterplay. Made the kit active + reactive. **Inner Peace cut.**

- **Riposte** — the guard stance (was Focus, internal field `_focusActiveUntil`): raised when a
  hostile is near (~14s cd, 5s window). While up, a **30% chance to dodge** an incoming hit AND
  **instantly counter-strike** the attacker for **80% of the monk's attack** (− their defense).
  Turns the invisible dodge into an offensive exchange. (CombatSystem dodge block.)
- **Stunning Palm** — a periodic (~9s cd) melee strike on the nearest minion within 1.5 tiles:
  **stuns it ~2s** (reuses the `_staggeredUntil` skip) + a light palm hit (atk − def). Single-target
  CC to neutralize a key minion for a beat.

**Systems:** `ClassAbilitySystem._considerMonk` (rewritten) + `CombatSystem` dodge-block counter
(`MONK_RIPOSTE_FRAC`). No new save fields (`_focusActiveUntil` already stripped; palm cd in
`adv.cooldowns`; stun via minion `_staggeredUntil`). Intel description updated.

#### Acceptance checklist (verified 2026-06-14)
_(Ability harness 27/27, soak 120/120, `tools/sim/monk-riposte-check.mjs` 3/3.)_
- ✅ Riposte stance fires when threatened (harness)
- ✅ A dodge negates the hit AND counters the attacker for ~80% atk−def (live test: 4 dmg, monk unhurt)
- ✅ Stunning Palm fires on a nearby minion, stuns it (`_staggeredUntil`) + light hit (harness)
- ✅ Inner Peace removed (def + consider block gone; no dangling refs)
- ✅ Intel description updated

### 🐺 Beast Master — Sic 'Em + Pack Tactics (LOCKED 2026-06-14, built + verified)

**Problem:** Tame Beast is great (flips your minion), but Scout Ahead was near-invisible (room
reveal + a 1s vanish stub). **Kept Tame; replaced Scout Ahead.**

- **Sic 'Em** (~7s cd) — command the living companion to **pounce** the nearest hostile within 5
  tiles: a directed **maul for the beast's attack ×1.6** (− defense), and the beast then engages it.
  The companion becomes an active threat the player watches.
- **Pack Tactics** (passive) — the BM and its tamed beast deal **+25%** when BOTH are adjacent to
  the same target (flanking). Applies to the BM's hits AND the beast's hits. **Counterplay: kill
  the beast to defang the pair.**

**Systems:** `ClassAbilitySystem._considerBeastMaster` (Sic 'Em replaces the Scout Ahead block;
removed `_scout*`/`_scoutingUntil`) + `CombatSystem._computeDamage` Pack Tactics block
(`PACK_TACTICS_PCT`). HUD label maps updated (`sic_em`; dropped `scout_ahead`). No new save fields.

#### Acceptance checklist (verified 2026-06-14)
_(Ability harness 27/27, soak 120/120, `tools/sim/beastmaster-check.mjs` 6/6.)_
- ✅ Tame Beast unchanged
- ✅ Sic 'Em: companion mauls nearest hostile for atk×1.6−def (test: 14) + sets the beast onto it
- ✅ Pack Tactics: +25% when BM's beast flanks the target (BM-attacker side, test)
- ✅ Pack Tactics: +25% when the BM flanks the target (beast-attacker side, test)
- ✅ Scout Ahead removed (no dangling refs); intel + HUD labels updated

### 🏹 Ranger — Piercing Shot (LOCKED 2026-06-14, built + verified)

**Problem:** Trap Expert is good (counters your traps), but Volley was a bland every-5th-shot splash
to 2 nearby minions. **Kept Trap Expert; reworked Volley.**

- **Piercing Shot** — every **5th** arrow becomes a **line shot** that pierces every minion in a row
  along the ranger→target ray (through the primary and up to ~6 tiles beyond), each for **full
  damage**. Rewards the player for NOT lining minions up. (Proc in `CombatSystem.tryAttack`,
  replacing the splash Volley; consts `RANGER_PIERCE_*`.)
- **Trap Expert** — unchanged.

#### Acceptance checklist (verified 2026-06-14)
_(Ability harness 27/27, soak 120/120, `tools/sim/ranger-pierce-check.mjs` 4/4.)_
- ✅ Every 5th shot fires the line; lands on the primary
- ✅ Pierces minions BETWEEN ranger and target AND BEYOND it (test)
- ✅ Spares minions OFF the line (perp > 0.7) (test)
- ✅ Volley removed (def `ranger_volley`→`ranger_piercing`; HUD label + intel + comments updated)

### 🛡️ Knight — Bulwark (LOCKED 2026-06-14, built + verified)

**Problem:** Taunt is good (pulls minions off squishies), but Protective Aura was a flavorless flat
−25% bubble. **Kept Taunt; reworked the aura into a positional shield-wall.**

- **Bulwark** (~20s cd, 6s) — raised when an ally is in danger OR a hostile is near. While up, an
  ally (or the Knight) within ~2.5 tiles takes **−35%** damage **only when sheltered behind/beside
  the Knight**: the Knight stands toward the threat from the ally AND is at least as forward (close
  to the attacker). Attacking from a side the Knight isn't covering **bypasses** it — positional,
  rewards front-lining. (Internal stance window stays `_auraActiveUntil`.)
- **Taunt** — unchanged.

**Systems:** `ClassAbilitySystem._considerKnight` (Bulwark trigger) + `CombatSystem._applyBulwark`
(directional shelter test; consts `KNIGHT_BULWARK_REDUCTION`/`KNIGHT_BULWARK_RANGE`). Def
`knight_aura`→`knight_bulwark`; HUD label + intel + comment refs updated. No new save fields
(`_auraActiveUntil` already stripped).

#### Acceptance checklist (verified 2026-06-14)
_(Ability harness 27/27, soak 120/120, `tools/sim/knight-bulwark-check.mjs` 5/5.)_
- ✅ Sheltered (Knight between threat and ally) → −35% (test)
- ✅ Exposed (Knight on the wrong side) → full damage (test)
- ✅ The Knight always shelters himself (test); out-of-range / stance-down → no shelter (tests)
- ✅ Taunt unchanged; def/HUD/intel/comment refs updated, no dangling `protective_aura`

---

## ✅ Older-class ability redesign — COMPLETE (mechanics)

All 7 reworked: **Barbarian** (Reckless Charge) · **Bard** (Crescendo) · **Mage** (Elemental
Arcana) · **Monk** (Riposte + Stunning Palm) · **Beast Master** (Sic 'Em + Pack Tactics) ·
**Ranger** (Piercing Shot) · **Knight** (Bulwark). Cleric + Necromancer left as-is (already good).
Each has a headless effect-test under `tools/sim/`. **NEXT PHASE: the bespoke-VFX pass** for the
whole set (the placeholder rings/floaters were deliberate — VFX was always phase 2).

---

## Boss ability + VFX overhaul (2026-06-14) — per-tier kit + throne fight + VFX

The big pass: overhaul ALL 12 player bosses so their abilities feel boss-tier mechanically AND
visually, elevated above minion/adventurer. Locked decisions (verbatim): tier model = **"Full
per-tier phase redesign"** (redesign each boss's whole kit around 4 tier phases from scratch);
fight scope = **"Yes — fight + kit + VFX"** (rework each archetype's throne fight to be unique +
tier-escalating, plus dungeon kit + VFX); tier driver = **"Acts (T1–T4)"** = `currentAct(gameState)`.
Cadence: I give **multiple options per boss → user picks one → build it out** (Loot-the-Fallen-style
"not boss-level" mechanics are rejected). Animations for boss abilities/attacks must be very
well done where they'd improve the read (user note, applies to all bosses).

### Boss #1 — Orc Veteran → **TROPHY HUNTER** (LOCKED 2026-06-14)

**Core loop:** the Veteran claims a **trophy** from every hero class the dungeon kills. First kill
of a class **claims** its trophy type (arms that attack); repeat kills of the same type **empower**
it (stacks → more damage/range). Kill history builds his arsenal for the throne fight. (Replaces
"Loot the Fallen.")

**The 5 trophy types** (mapped from class tags → throne attack):
- **⚔ Blade** — melee dps/rage/evade (barbarian, monk, samurai, pirate, gambler, miner, peasant, rogue, knight, cosplay) → **Cleave** (frontal crescent + knockback). Blade is also his innate basic.
- **🛡 Heavy** — tanks/bruisers (gladiator, paladin, templar) → **Shield Bash** (gap-close charge, then guards / DR for a beat).
- **🔮 Arcane** — spellcasters (mage, necromancer, black_mage) → **Hexbolt** (chained stolen-magic orb hurled at highest-aggro hero).
- **🏹 Hunter** — ranged/pets (ranger, bard, beast_master) → **Volley** (fan of spinning thrown weapons).
- **✚ Faith** — healers (cleric, white_mage, valkyrie) → **Reaver's Smite** (overhead strike that heals him for damage dealt).
- Event/non-combatant classes (invaders, loot goblin, cartographer, cheater, nemeses) DON'T grant trophies.

**Tier escalation (Acts I→IV):**
- **T1** — claims trophies; throne fight wields his **2 strongest** claimed attacks (+ basic swings).
- **T2** — wields **3**; repeat-kill **stacks scale** each attack's damage/range.
- **T3** — wields **all** claimed attacks and **chains two back-to-back**; gains the **Mastery aura**.
- **T4** — **Veteran's Armory** ult: below ~30% HP he unleashes a sequence firing *every* claimed trophy attack, plus a Last Stand speed/ATK surge.

**Dungeon-phase payoff:** a **Trophy Wall** on the boss inspect panel (claimed types + stack counts).
**Mastery aura (T3+):** most-claimed type → dungeon-wide passive — Blade→minions +ATK, Heavy→minions
+DEF, Arcane→traps recharge faster, Hunter→minion attack range, Faith→boss heals over time.

**VFX language:** iron/bronze brutality + the stolen class's color. Claim = fallen's emblem streaks
to a growing throne rack. Cleave = iron crescent w/ class-color edge; Shield Bash = sparking charge +
brace flash; Hexbolt = crude orb bound in rattling iron chains; Volley = fan of trailing axes;
Reaver's Smite = overhead strike with a light-thread siphoning back; Armory = every weapon orbits
then fires outward in sequence. All bespoke `AbilityVfx` primitives, lab-testable.

**Acceptance checklist (Trophy Hunter):**
- ☐ Class→trophy-type classifier covers the full roster (tag-driven, Blade default); event/non-combatant excluded.
- ☐ First kill of a type CLAIMS; repeat kills EMPOWER (stacks) — stored JSON-serializable on `boss.trophies`, save-safe.
- ☐ Throne fight: Cleave / Shield Bash / Hexbolt / Volley / Reaver's Smite implemented as tier-gated boss actions, each with windup→strike→damage like the slam.
- ☐ Reaver's Smite heals the boss for a fraction of damage dealt.
- ☐ Tier gating: T1 = 2 strongest, T2 = 3 + stack-scaling, T3 = all + 2-chain combo, T4 = Armory ult <30% HP + Last Stand surge.
- ☐ Mastery aura (T3+): top type → its dungeon-wide passive; baseline-captured + reversible like Warband/Bloodlust.
- ☐ Trophy Wall in InspectPopup boss content.
- ☐ Bespoke VFX for each attack + claim + Armory, evolving feel by tier; all in the VFX Lab; lint-vfx clean.
- ☐ Headless harness green; soak clean; bossArchetypes.json headline/mechanics text updated.

#### Orc Trophy Hunter — DAY-PHASE ACTIVE retrofit: **TROPHY THROW** (LOCKED 2026-06-15)

The Orc shipped without a day-phase active ability; every boss needs one. **TROPHY THROW** makes his
existing trophy arsenal his day weapon. DOM button `TROPHY THROW · N` (uses left) → arm → click a room
→ he hurls one weapon **per claimed trophy type** into that room (room-wide AoE, hits every hero inside).

Per-weapon effect, tinted its stolen-class color:
- **⚔ Blade** — heaviest raw damage (no rider, the cleaver).
- **🛡 Heavy** — knockback + brief **root** (`_rootedUntil`).
- **🔮 Arcane** — **hex** (`_hexUntil`/`_hexVulnMul`): hexed heroes take more from minions/traps.
- **🏹 Hunter** — hits + **slows** the room (`_slowUntil`/`_slowMult`).
- **✚ Faith** — lifesteal: **heals the boss** for a fraction of damage dealt.

Each weapon's damage = `boss.attack × frac × (1 + stack bonus)` (reuses `ORC_TROPHY_DMG_PER_STACK`, so
empowered trophies hit harder). **Tier gating** (`currentAct`) = how much of the arsenal he hurls at
once: T1 ≤2 weapons · T2 ≤3 · T3 ≤4 · T4 the ENTIRE claimed arsenal, effects amplified. Weapons thrown
= `min(claimed types, tier cap)` — early game throw what little is claimed, late game throw everything.
Scales early→late: damage rides day-scaled `boss.attack`, room-wide (crowd), more trophies = more
weapons, higher act = bigger. Uses/day = `1 + floor(level × 0.25)`, reset on night. Tell = the existing
Trophy Wall (claimed types + stacks) + the button's uses count. Bespoke `trophyThrowFx` (claimed weapons
spin out in an arc from the throne, type-colored impacts), lab-wired.

**Acceptance checklist (Trophy Throw):**
- ☑ DOM button (`qf-archstrip-throw`) + Phaser room-pick (`_installThrowRoomPick`) + `ORC_TROPHY_THROW_ARM/DISARM/TARGET` (+ `_ARMED/_DISARMED/_FIRED`); uses/day reset on night; `boss._orcThrow={usesLeft}` persists.
- ☑ Hurls one weapon per CLAIMED trophy type, capped by tier (T1≤2/T2≤3/T3≤4/T4 all); damage = boss.attack × frac × stack bonus (×Blade bonus, ×T4 amp); room-wide.
- ☑ Per-type riders: Blade raw, Heavy knockback+root (`_rootedUntil`), Arcane hex (`_hexUntil`/`_hexVulnMul`), Hunter slow (`_slowUntil`/`_slowMult`), Faith boss-lifesteal — all AI-respected, already in SaveSystem strip.
- ☑ Bespoke `trophyThrowFx` (claimed weapons spin out in an arc + per-type impact bursts), lab-wired (orc group + stand-in + `_fireRaw`); lint-vfx clean.
- ☑ node --check; orc harness green (Trophy Throw section added); live preview verified (weapons arc + impacts, no console errors); soak clean.

### Boss #2 — Elder Lich → **THE WITHERING** (LOCKED 2026-06-14)

**Core resource — Soul Essence.** Every adventurer who dies anywhere in the dungeon banks **Soul
Essence** on the boss (`boss.soulEssence`, persists all run, visible gauge). Essence is the Lich's
**lifeline** (the folded Phylactery — it regenerates HP while holding essence), the **ammo** for the
day-phase active ability, and the **reserve** it carries into the throne fight. **Necromancy is CUT**
(no raised undead). **Phylactery Heart is retired** (folded into Soul Essence; the `phylactery_heart`
build item is removed from the menu).

**Design mandates honored:** every effect SCALES (room-wide / per-victim / with banked essence) so it
never falls off late game ([[feedback_ability_scaling_early_late]]); the day kit is PLAYER-ACTIVE
([[feedback_boss_day_phase_agency]]).

**Day phase — active player ability: CHANNEL SOULS** (button → arm → click a target room → fire;
spends essence; mirrors Golem Earthquake's arm/target/fire). ONE button that ESCALATES by tier
(act), all room-wide so it scales with the crowd:
- **T1 · Soul Bolt** — blast every adventurer in the room; damage scales with essence spent.
- **T2 · +Soul Siphon** — also drains the room over a few seconds → heals the boss + banks bonus essence per victim.
- **T3 · +Wither** — also curses the room: reduced healing + stacking soul-rot DoT for the day.
- **T4 · Soul Cage** — cages everyone in the room (trapped + drained); late game = jail a whole swarm.
*(Passive underneath: Soul Harvest banks essence on every death; the Lich regenerates HP while holding essence.)*
Player choice each day: HOARD essence (regen + bigger final fight) or SPEND it now (kill pressure) and WHERE.

**Throne fight — lifedrain death-caster** (enters with banked essence as a reserve; all multi-target so big parties don't trivialize it):
- **T1 · Death Coil** — soul-bolt damages a hero + heals the Lich (chains to more targets at higher tiers).
- **T2 · Soul Siphon** — sustained beam tethering 2–3 heroes, draining HP to the Lich each tick.
- **T3 · Soul Nova** — AoE burst damaging all + big self-heal + applies Wither (reduced healing) on hit.
- **T4 · Soul Cage (ult)** — cages the highest-threat cluster (removed + drained) while the Lich feasts for a massive heal.

**VFX language:** sickly soul-fire (green↔violet), wispy/ghostly — distinct from the Orc's iron/bronze.
Harvest wisps streaking to the Lich; drain threads pulling stolen life back; wailing-face Soul Nova;
soul-bar Cage; grey Wither aura. All bespoke `AbilityVfx` primitives, tier-escalating, lab-testable.

**Acceptance checklist (The Withering):**
- ☐ Necromancy raise CUT (no pendingRaises enqueued for lich); Phylactery `phylactery_heart` item removed from build menu.
- ☐ Soul Essence banks on every dungeon death (`boss.soulEssence`), persists; passive HP regen while holding essence.
- ☐ Day ability CHANNEL SOULS: arm→click room→fire, spends essence, DOM button (BossArchetypeStrip) + Phaser room-pick + arm/disarm/fired events; disabled when no essence / not day.
- ☐ Channel effect escalates by act-tier (bolt → +siphon/heal → +wither → cage) and is room-wide (scales with crowd) + scales with essence spent.
- ☐ Throne fight: Death Coil / Soul Siphon / Soul Nova / Soul Cage as tier-gated boss actions, all multi-target, lifedrain heals the boss.
- ☐ Soul Essence gauge shown on the boss overview panel.
- ☐ Bespoke soul-fire VFX for harvest + each attack; tier-escalating; all in the VFX Lab; lint-vfx clean.
- ☐ Headless harness green; soak clean; bossArchetypes.json lich headline/mechanics updated; live preview positions verified.

### Boss #3 — Slime King → **MITOSIS / THE UNKILLABLE HORDE** (LOCKED 2026-06-14)

**Core — Mass.** The King is a self-multiplying ooze with a **Mass** value (`boss.slimeMass`, persists)
that swells as it buds/absorbs. Mass is PHYSICAL, not a spent currency: more Mass → the King's body
grows bigger AND it splits into a bigger horde in the throne fight. Elevates the existing Mitosis
(split-at-half-HP) + Absorb & Excrete machinery; doesn't replace it.

**Dungeon kit (escalates per act):**
- **T1 · Budding + Absorb** — buds free gooplings over time + from absorbing dead minions (off the cap); each absorb also +Mass (elevates existing Absorb & Excrete).
- **T2 · Coalesce** — roaming gooplings that linger/touch MERGE into bigger slimes over the day.
- **T3 · Acidic Trail** — roaming slimes leave a corrosive trail on their tiles; adventurers crossing take damage.
- **T4 · The Tide** — at high Mass, killing a slime near a big one SPAWNS a replacement (the horde self-heals).

**Day-phase active ability — MITOSIS SURGE** (arm → click a room → fire; uses/day scale with boss level):
floods a target room with a wave of gooplings that swarm everyone inside; count scales with Mass +
the crowd in the room (room-wide → never falls off late game).

**Throne fight — the splitting horde (elevates existing mitosis):**
- Mass → bigger entry (more HP + more starting blobs at high Mass).
- **T1 · Mitosis** — splits at half HP into 2 (existing); split gen-cap grows by tier (more blobs each act).
- **T2 · Recombine** — unkilled small blobs drift together and MERGE back into a bigger one if not bursted fast.
- **T3 · Acid Split** — each split drops an acid puddle that damages the party.
- **T4 · Mini-King elites + Ooze Tide** — at high Mass the King's children are mini-kings (split deeper); slain blobs near a big one respawn.

**Tells:** body SIZE scales with Mass (physical danger read, uses the existing generation scale); a
gooey **pulsing Glow-OUTLINE aura** (the standard aura) whose intensity scales with Mass; the visible
goopling population IS the horde tell; a Mass/Horde readout on the boss panel.

**VFX (gooey green, bespoke, lab-testable):** split (blob stretches→pinches→divides w/ goo splatter,
replacing the generic particleBurst/pulseRing), merge/coalesce, acid puddle/trail, engulf, Mitosis
Surge flood. Tier-escalating.

**Acceptance checklist (Mitosis/Horde):**
- ☐ `boss.slimeMass` grows on absorb + time-budding; persists; save-safe.
- ☐ Body size scales with Mass (BossRenderer); gooey Glow-OUTLINE aura scales with Mass; Mass/Horde readout on the panel.
- ☐ Dungeon kit: Budding(T1)/Coalesce(T2)/Acidic Trail(T3)/The Tide(T4), act-gated.
- ☐ MITOSIS SURGE active: arm→room→fire, DOM (BossArchetypeStrip) + Phaser room-pick + events; room/Mass-scaling; uses/day.
- ☐ Throne fight: Mass→entry size; split gen-cap by tier; Recombine(T2); acid puddles(T3); mini-kings + tide-respawn(T4).
- ☐ Bespoke slime VFX (split/merge/acid/engulf/surge); lint-vfx clean; lab-wired.
- ☐ Headless harness green; soak clean; bossArchetypes.json slime text updated; live preview verified.

### Boss #4 — Beholder Tyrant → **EYE TYRANT** (a barrage of rays) (LOCKED 2026-06-14)

**Core — the Eyes.** Each eye-stalk fires a different curse-ray. NO banked resource (deliberate
variety); power = how many eyes are open, which grows with the act. A control/debuff boss: strips the
party's tools + locks them down; you read the eyes and react. Reframes the existing **Petrify Gaze**
(fight) + **Anti-Magic Aura** (day) as two of its rays.

**Throne fight — the Eye Barrage** (elevates `_firePetrifyGaze` → a tier-gated ray rotation fired by
the existing fight timer). Combat-impactful rays (all wired to direct HP / freeze / vuln):
- **Petrify** — freeze a target *(existing)*. · **Drain** — beam: damage + heal the boss. ·
  **Hex** — mark targets to take +X% damage (reuses `_hexUntil`/`_hexVulnMul`/`MinionAbilities.hexMult`). ·
  **Disintegrate** — heavy telegraphed single-target death-ray (T4).
- Tier: **T1** Petrify+Drain (1 beam) · **T2** +Hex · **T3** 2 beams/beat · **T4** +Disintegrate death-ray on the highest-aggro hero.

**Day-phase active — TYRANT'S GAZE** (arm → click a room → fire; uses/day scale w/ boss level): fixes
an eye on a room and locks down everyone inside (per-adv, at fire) — **Silence** (T1, `_silencedUntil`,
new ClassAbilitySystem read) → **+Slow** (T2, `_slowUntil`/`_slowMult`, AISystem already honors) →
**+Petrify** (T3, `_petrifiedUntil`) → **+Disintegrate damage** (T4). Room-wide → scales with crowd.
The daily auto Anti-Magic room marks stay as the T1 baseline.

**Tells:** eyes-open count = danger read (more rays each tier; an eye charges/glows before firing);
standard pulsing violet **Glow-outline aura** with intensity scaling by TIER; an "EYES OPEN · N rays"
panel readout.

**VFX (violet geometric eye-beams, bespoke, lab-testable):** distinct beam + on-hit per ray — Petrify
(stone crackle, existing) · Silence (null-rune) · Slow (blue tar-web) · Drain (red siphon thread to
the boss) · Disintegrate (searing white-violet lance + disintegration burst) — plus the central eye
blink/charge + the Tyrant's Gaze room-sweep. Tier-escalating.

**Build note (within the spec's "final list confirmed at build" latitude):** Slow lives in the DAY
gaze (movement matters in exploration, not the pooled auto-fight); the FIGHT uses Hex in its place
(combat-impactful). All rays map to already-respected flags + one new `_silencedUntil` read.

**Acceptance checklist (Eye Tyrant):**
- ☑ Fight Eye Barrage: tier-gated ray rotation (Petrify/Drain/Hex; +Disintegrate death-ray T4 on highest-aggro; 2 beams/beat T3), beams + on-hit, scales w/ party+tier; Hex multiplies the boss's fight damage via `MinionAbilities.gazeHexMul` (applied in BossSystem `_runOneRound` melee + slam). Drain heals the boss. (Build-note: Slow→day, Hex→fight.)
- ☑ Day TYRANT'S GAZE: arm→room→fire, per-adv silence/slow/petrify/damage by tier; DOM button (`qf-archstrip-gaze`) + Phaser room-pick + ARM/DISARM/TARGET/ARMED/DISARMED/FIRED events; uses/day reset on night.
- ☑ `_silencedUntil` honored in ClassAbilitySystem (folded into the anti-magic `silenced` gate); stripped on save.
- ☑ Tells: tier-scaled violet glow-outline aura (BossRenderer `_updateBeholderAura`); Eyes-Open panel readout (BossOverviewOverlay `_renderEyesOpen`).
- ☑ Bespoke ray VFX (`beholderRayFx` per-kind beam+impact, `beholderEyeChargeFx`, `tyrantGazeSweepFx`); lint-vfx clean; lab-wired (group + stand-in abilities + `_fireRaw`).
- ☑ Headless harness green (`tools/sim/beholder-eyetyrant-check.mjs`); soak clean (120 games, 0 issues); bossArchetypes.json beholder text updated; live preview verified in VFX Lab (Disintegrate lance+burst, Hex beam+sigil, T4 violet glow-outline aura, Tyrant's Gaze eye+ray-fan sweep all render; no console errors).

### Boss #5 — Predator Myconid → **THE BLOOM** (terrain colonizer) (LOCKED 2026-06-15)

**Core resource — BIOMASS** (`boss.biomass`, persists; visible gauge). Grows from every dungeon death
(scaled by hero level) + passively per bloomed room per day. Biomass drives spread reach/chance,
bloomed-terrain potency, and the boss's throne power.

**Bloomed rooms** (`boss.bloomedRooms[]`, persists; visibly overgrown on the map). While a hero stands
in one: spore **DoT** (% max-HP/tick, reuse the spore-tick pattern), **can't heal** (`_noHealUntil`),
**slowed** (`_slowUntil`/`_slowMult`); your **minions** inside get **regen + a little ATK** (symbiosis).

**Dungeon Kit — the Bloom escalates by act:** T1 **Creep** (bloomed rooms apply spore DoT — replaces the
old corridors-gas-every-3rd-day with persistent player-seeded bloom) → T2 **Rot** (+heal-block + slow;
minion regen) → T3 **Spread** (each day start, every bloomed room has a Biomass-scaled chance to creep
into an ADJACENT room) → T4 **Sporestorm** (bloomed rooms periodically erupt spore-pods; network pulse;
bigger minion buff). **Corpse Bloom retained + folded in:** dead heroes leave fungal corpses, and a
corpse now AUTO-BLOOMS its room (feeds the colony) instead of only adding venom stacks.

**Day-phase active — SEED THE BLOOM** (arm → click a room → colonize it instantly; + at higher tiers an
immediate spore-burst on heroes inside). Uses/day = `1 + floor(level × 0.25)`, reset on night. Player
agency = choose where the colony grows. Room-wide → scales with crowd; potency scales with Biomass+tier.

**Throne fight — the colonized arena** (rooted fungal caster; arena hazards scale with bloomedRooms +
Biomass; bigger entry the more colonized the dungeon): T1 **Spore Vent** (periodic spore-cloud AoE DoT on
heroes) → T2 **Creeping Rot** (rot zones crawl across the floor; standing = DoT + heal-block, telegraphed)
→ T3 **Bursting Pods** (fungal pods grow + burst after a windup; more Biomass = more pods) → T4 **The
Bloom finale** (at low HP the arena erupts: boss channels and the dungeon-wide colony HEALS it — heal
scales with bloomedRooms count — under a massive room-wide sporestorm).

**Tells:** Biomass gauge + bloomed-room count in the boss panel; bloomed rooms overgrown on the map
(persistent bloom overlay, extending the spore overlay); pulsing sickly-green **Glow-outline aura** whose
intensity reads Biomass saturation.

**VFX (bespoke, fungal, lab-wired):** `bloomFx` (mycelium tendrils creep out + spores rise as a room
colonizes) · `sporeBurstFx` (puffball pod eruption) · `sporeVentFx` (cloud vent on heroes) ·
`creepingRotFx` (rot crawling across tiles) · `bloomFinaleFx` (arena eruption) — reuse `_drawMiasmaPuff`.

**Scales early→late:** DoT is %max-HP (auto-scales), bloom is room-wide (crowd), Biomass+spread+tier
compound over the run. **Deviation noted:** replaces the passive corridor-spore-every-3-days with the
persistent player-seeded bloom system.

**Acceptance checklist (The Bloom):**
- ☑ BIOMASS resource (`boss.biomass`) banks on death (level-scaled) + per bloomed room/day; persists; visible gauge.
- ☑ Bloomed rooms (`boss.bloomedRooms[]`) apply spore DoT + (T2) heal-block + slow to heroes; minions inside get regen+ATK (captured-baseline, restored on leave/save); persist; overgrown map overlay (`_renderBloomOverlay`).
- ☑ Dungeon kit by act: T1 Creep / T2 Rot / T3 auto-Spread to adjacent (`_bloomDayBegan`) / T4 Sporestorm pods (`_tickMyconid`); corpse auto-blooms its room on death.
- ☑ Day active SEED THE BLOOM: arm→room→colonize (+T2 burst); DOM button (`qf-archstrip-seed`) + Phaser room-pick + `MYCONID_SEED_*` events; uses/day reset on night; `boss._myconidSeed={usesLeft}`.
- ☑ Throne fight tier-gated (`_tickBloomFight` fight timer): Spore Vent / Creeping Rot / Bursting Pods / Bloom-finale (channel heal scales w/ bloomedRooms count) at <30% HP.
- ☑ Tells: BIOMASS + bloomed-room panel readout (`_renderBloomStatus`); green glow-outline aura (`BossRenderer._updateBloomAura`) reading Biomass saturation.
- ☑ Bespoke fungal VFX (bloomFx/sporeBurstFx/sporeVentFx/creepingRotFx/bloomFinaleFx), lab-wired; lint-vfx clean.
- ☑ SaveSystem persists biomass/bloomedRooms + strips transient riders; node --check; new harness `myconid-bloom-check.mjs` green; soak clean; bossArchetypes.json text; live preview verified (all 5 fungal VFX render, no console errors).

### Boss #6 — Demon Lord → **THE BRIMSTONE PACT** (sacrifice engine) (LOCKED 2026-06-15, v2)

**Fantasy:** death → fuel → hellfire. The more your dungeon kills (and the more you feed it), the more
catastrophic the Demon's hellfire — a run-long snowball that rewards a strong dungeon and stays scary late.

**Core resource — INFERNAL POWER (Brimstone)** (`boss.brimstone`, persists; gauge; cap scales w/ act).
Banks from (a) sacrificing your own minions (big chunk, scaled by minion value) and (b) EVERY adventurer
death anywhere (the engine). Passive: the Demon regenerates HP while holding Brimstone.

**Day active — INFERNAL PACT** (arm → click a room): auto-burns one expendable Hellgate imp AND spends
banked Brimstone to rain hellfire on the room. **Damage scales with Brimstone spent** (small reserve =
poke, full reserve = room-wipe); all %-max-HP, room-wide (scales w/ crowd). Riders by act: T1 blast · T2
+burning ground (room keeps burning several seconds — lingering AoE DoT) · T3 +heal-block in the burning
room · T4 +**Soulfire Execute**: heroes the hellfire/burn drag below a %-HP THRESHOLD are consumed AND
refund Brimstone (chains into the next Pact). Threshold-based → scales w/ crowd + stays lethal at any HP
curve. Uses/day = `1 + floor(level × DEMON_PACT_USES_PER_BOSS_LV)`, reset on night.
*(Deviation: replaces the old no-pick Sacrifice that instakilled a random adv anywhere.)*

**Dungeon kit — escalates by act (verbs, not stat bumps):** T1 **Brimstone** (bank + regen lifeline) →
T2 **Volatile Legion** (Hellgate imps EXPLODE on death — hellfire AoE on whoever killed them) → T3 **Soul
Harvest** (every adv death anywhere banks a big Brimstone chunk — the snowball) → T4 **Infernal Ascendance**
(while Brimstone near cap: every dungeon minion's attacks BURN + boss regen surges). Hellgate retained
(free imps each dawn; now Pact fuel + Volatile bombs).

**Throne fight — hellfire caster fueled by the bank** (bigger entry/more starting imps the more Brimstone):
T1 **Hellbolt** (AoE hellfire bolts) → T2 **Immolation** (sacrifices a summoned imp mid-duel for a bigger
nova + banks Brimstone) → T3 **Brimstone Rain** (hellfire meteors; count+dmg scale w/ Brimstone) → T4
**The Pact Fulfilled** (finale at low HP: dumps ALL Brimstone in one room-wide cataclysm scaling w/ the
spent reserve + heals the Demon proportionally).

**Tells:** Brimstone gauge + panel readout; the Demon's existing pulsing ORANGE Glow-outline aura now
reads Brimstone saturation; Hellgate portal visible.

**VFX:** compose from the existing infernal set (`infernoFx` room-eruption, `combustFx`, `hellfireAuraFx`,
`emberRiseFx`, `flameLickFx`, `heatShimmerFx`) + new bespoke `infernalPactFx` (sacrificed imp erupts →
flame streams to the Demon → hellfire rains on the room + burning ground), `brimstoneMeteorFx` (falling
hellfire meteor + impact), `pactFinaleFx` (the cataclysm). Lab-wired; meet the visual bar.

**Always-useful:** every number is %-max-HP or scales with Brimstone (which snowballs from the dungeon's
kills all run) — no fixed magnitudes; T4 execute is threshold-based, finale scales with the whole reserve.

**Acceptance checklist (Brimstone Pact):**
- ☑ BRIMSTONE resource (`boss.brimstone`) banks on sacrifice (big) + every adv death (`_bankBrimstoneFromDeath`, T3 doubles); persists; cap/act; passive HP regen (`_tickDemonBrimstone`); visible gauge.
- ☑ Day INFERNAL PACT (reworked Sacrifice → arm→room): burns an imp + spends Brimstone → hellfire (dmg scales w/ Brimstone spent), %maxHP room-wide; T2 burning ground (`_tickDemonHellfire` zones), T3 heal-block, T4 %-threshold Soulfire Execute + refund. DOM button (`INFERNAL PACT · N`) + Phaser room-pick (`_installPactRoomPick`) + DEMON_SACRIFICE_* events; uses/day reset on night.
- ☑ Dungeon kit by act: T2 Volatile Legion (`_onDemonMinionDied` — imps explode on death), T3 Soul Harvest (death-bank ×2), T4 Infernal Ascendance (`_tickInfernalAscendance` — minion ATK surge + regen ×surge near cap).
- ☑ Throne fight tier-gated (`_tickBrimstoneFight`): Hellbolt / Immolation (consumes a chamber imp → nova + bank) / Brimstone Rain (meteors scale w/ Brimstone) / Pact-Fulfilled finale (dump-all cataclysm + heal at <30% HP).
- ☑ Tells: BRIMSTONE panel readout (`_renderBrimstoneStatus`); orange glow-outline aura (`BossRenderer._updateBrimstoneAura`) reading Brimstone saturation.
- ☑ Bespoke infernal VFX (infernalPactFx/brimstoneMeteorFx/pactFinaleFx + reuse inferno/combust), lab-wired; lint-vfx clean; live-verified (room eruption + meteors + finale cataclysm).
- ☑ SaveSystem persists brimstone + restores Ascendance atk baseline (burn zones transient on system); node --check; new harness `demon-brimstone-check.mjs` green; soak clean; bossArchetypes.json text; live preview verified.

### Boss #7 — Golem → **THE LIVING FORTRESS** (the dungeon is its body) (LOCKED 2026-06-15)

**Fantasy:** the Golem IS the dungeon you build — the bigger/deeper your fortress, the mightier and more
unkillable it gets, and the harder the earth hits when it moves.

**Core resource — BEDROCK** = your built dungeon (room count; tracked via `_golem.roomsCounted`). Drives
Living Architecture (each placed room → permanent +HP/+DEF, existing) + seismic damage + body size + aura.
The snowball that stays useful all run (no fixed magnitudes — seismic dmg = rooms × per-room).

**Day active — SEISMIC SLAM** (elevated Earthquake; arm → click a room; uses/day scale w/ boss level).
Damage = rooms × per-room (scales w/ dungeon, room-wide). Riders by act: T1 **Quake** (AoE, existing) →
T2 **Fissure** (lingering crack: aftershock DoT + slow for a few s) → T3 **Collapse** (+ heroes BURIED:
brief can't-act, `_petrifiedUntil`, reads as rubble/stone) → T4 **Cataclysm** (room + adjacent rooms
convulse; harder Bedrock scaling; longer burial).

**Dungeon kit — escalates by act (verbs):** T1 **Living Architecture** (rooms → +HP/+DEF, existing) → T2
**Aftershock** (every few s a tremor chips the most-occupied room, scales w/ dungeon size) → T3 **Tremor
Network** (aftershocks hit ALL occupied rooms) → T4 **Tectonic Upheaval** (aftershocks also briefly root +
bigger). A constant escalating seismic presence.

**Throne fight — THE FORTRESS** (rooted wall reshaping the arena; entry HP/DEF already scale w/ rooms):
T1 **Slam** (AoE ground-slam) → T2 **Raise Pillars** (stone pillars erupt, telegraphed, dmg + knockback)
→ T3 **Bulwark** (encases in stone — a damage-reduction window via `boss._bulwarkUntil`, read in
`BossSystem._applyDamageToBoss` like `_braceUntil`) → T4 **Collapse finale** (<low HP: arena ceiling caves
— room-wide rubble cataclysm scaling w/ Bedrock + buries the party).

**Tells:** body grows + armors with room count (BossRenderer scale); stone-grey/amber Glow-outline aura
reading Bedrock saturation; "BEDROCK · N rooms" panel readout (+ live +HP/+DEF granted).

**VFX (seismic, high bar, bespoke):** `seismicSlamFx` (radiating ground cracks + dust + flying rubble +
heavy shake), `fissureFx` (jagged crack tears open w/ a glowing seam, lingers), `risePillarFx` (stone
pillar heaves up + debris), `bulwarkFx` (stone plates slam around the boss), `collapseFx` (ceiling rubble
rains + dust pall + big shake). Lab-wired.

**Always-useful:** seismic dmg scales w/ rooms (snowball), Aftershock/Fissure %-based, Bulwark %-DR,
burial time-based CC, finale Bedrock-scaled. **Build note:** Bulwark lives in the throne fight (DR only
matters there); dungeon-kit T3 is the Tremor Network aftershock escalation.

**Acceptance checklist (Living Fortress):**
- ☑ BEDROCK = room count drives Living Architecture (+HP/+DEF, existing) + seismic dmg + body size + aura; `_renderBedrockStatus` panel readout.
- ☑ Day SEISMIC SLAM (`_seismicHitRoom`/`_fireEarthquake`): dmg = rooms × per-room; T2 Fissure zone (DoT+slow, ticked in `_tickGolem`), T3 Collapse burial (`_petrifiedUntil`), T4 Cataclysm (adjacent rooms + longer). Button "SEISMIC SLAM · N"; uses/day scale w/ level.
- ☑ Dungeon kit by act (`_tickGolem`): T2 Aftershock (most-occupied room chip), T3 Tremor Network (all occupied rooms), T4 Tectonic Upheaval (+root).
- ☑ Throne fight tier-gated (`_tickFortressFight`): Slam / Raise Pillars / Bulwark (DR window `boss._bulwarkUntil` read in `BossSystem._applyDamageToBoss`) / Collapse finale (Bedrock-scaled).
- ☑ Tells: body grows w/ rooms + stone glow-outline aura (`BossRenderer._updateFortressAura`); BEDROCK panel readout.
- ☑ Bespoke seismic VFX (seismicSlamFx/fissureFx/risePillarFx/bulwarkFx/collapseFx + `_spawnRubble`), lab-wired; lint-vfx clean; live-verified (cracks+dust+rubble, magma fissures, rising pillars, stone plates, collapse rain).
- ☑ SaveSystem strips `_bulwarkUntil` (fissure zones transient on system); node --check; new harness `golem-fortress-check.mjs` green; soak clean (120/0); bossArchetypes.json text; live preview verified.

### Boss #8 — Lizardman (Serpent Captain) → **THE PLAGUE-BEARER** (contagion) (LOCKED 2026-06-15)

**Fantasy:** a swamp-born reptilian warrior whose bite carries a living plague. It doesn't kill one hero
— it infects the herd, and the sickness spreads body-to-body until the whole raid rots. The more
adventurers packed in, the faster it cascades. (Rejected v1 snake/ambush + heal-block; this is boss-own,
crowd-scaling, poison-route.)

**Core resource — VIRULENCE** (`boss.virulence`, persists; gauge). Banks each time an INFECTED adventurer
dies. Drives spread target-count, spread reach, and plague tick damage — a run-long snowball.

**The plague engine:** infected heroes carry `_plagueStacks` and (a) take DoT = %maxHP × stacks ×
Virulence factor (never falls off), (b) SPREAD on a cadence — each carrier infects nearby uninfected
heroes; count + reach scale w/ Virulence + tier. Packed dungeon → chains through the whole party.

**Dungeon kit by act:** T1 **Infection** (carriers take plague DoT) → T2 **Contagion** (carriers spread to
nearby heroes) → T3 **Virulent Strain** (spread more/farther + harder + feverish SLOW) → T4 **Pandemic**
(jumps ACROSS rooms, no radius cap; an infected death BURSTS, infecting everyone near the corpse).

**Day active — PLAGUE SPIT** (arm → click a room): bile-bomb infects everyone in the room w/ a heavy dose,
which then spreads on its own. Scales w/ crowd + Virulence. Uses/day scale w/ level.

**Throne fight — the plague-bearer:** T1 **Infected Bite** (bites stack plague) → T2 **Contagion** (party
cross-infects each round) → T3 **Miasma Spew** (room-wide heavy infect) → T4 **Outbreak finale** (low HP:
every infected fighter detonates for a burst scaling w/ stacks, re-infecting survivors).

**Tells:** Virulence gauge + panel readout; sickly-green Glow-outline aura reading Virulence; infected
heroes get a green plague tint that deepens with stacks (AdventurerRenderer).

**VFX (plague/contagion — DETAILED + ANIMATED, the minimum bar):** `plagueSpitFx` (a glistening bile glob
arcs+wobbles w/ a trail, then SPLATTERS into a roiling billowing miasma + droplet spray), `contagionFx` (a
writhing green miasma TENDRIL leaps carrier→carrier w/ a traveling mote + puff at the new host),
`outbreakFx` (an infected hero RUPTURES — bile burst + miasma shockwave + chunky droplets), `miasmaSpewFx`
(a sweeping FAN of overlapping miasma puffs + droplets + lingering haze). New `_drawBileGlob`; reuse
`_drawMiasmaPuff`; particle-driven + onUpdate motion; lab-wired; lint-clean; unique names.

**Always-useful:** plague reaches the WHOLE herd (spreads to all), DoT %maxHP×Virulence (no falloff), Spit
+ Outbreak crowd-wide, Virulence snowballs. No single-target, no heal-block.

**Acceptance checklist (Plague-Bearer):**
- ☑ VIRULENCE (`boss.virulence`) banks on infected-adv death; persists; drives spread/tick; gauge + readout.
- ☑ Plague engine (`_tickPlague`): `_plagueStacks` DoT (%maxHP×stacks×Virulence) + contagion spread (T2+) + T3 feverish slow + T4 cross-room + death-burst.
- ☑ Day PLAGUE SPIT: arm→room, heavy infect all inside; DOM button + Phaser room-pick + events; uses/day reset on night.
- ☑ Throne fight tier-gated: Infected Bite / Contagion / Miasma Spew / Outbreak finale.
- ☑ Tells: green glow-outline aura (BossRenderer) reading Virulence; infected-tint on advs (AdventurerRenderer); Virulence panel readout.
- ☑ Bespoke animated plague VFX (plagueSpit/contagion/outbreak/miasmaSpew), lab-wired; lint-vfx clean (incl. dup-key guard); meets detail bar (live-verified in VFX lab 2026-06-15).
- ☑ SaveSystem persists virulence + plague stacks, strips scene-time tick stamps; node --check; new harness green; soak clean (120 games, 0 issues); bossArchetypes.json text; live preview verified.

---

## Boss overhaul #9 — Vampire Sovereign → THE BLOOD SOVEREIGN (locked 2026-06-15)

**Fantasy:** an aristocrat who runs the dungeon as a blood economy. Everything that bleeds feeds him; he
spends that blood on lavish Rites and a growing charmed Court, and personally feasts in the throne fight.

**BLOOD — banked resource (`boss.blood`, persists):** banks from a dungeon-wide blood tax (a % cut of ALL
damage dealt to heroes by dungeon sources — minions, thralls, traps, his own Rites — reframes the canon
"Blood Tax" into a pool, still heals him as it banks) + a big gulp on every hero death (level-scaled). Caps
by act (`BASE + act×PER_ACT`). Passive trickle of self-regen scaled to current Blood; saturation drives the
aura. NO heal-block anywhere in the kit.

**Day active — BLOOD RITE** (arm → pick room → fire; uses/day scale w/ level, refill nightly; crowd-wide,
%maxHP, escalates by act): T1 **Tithe** (drain %maxHP from everyone in the room → bank + heal) → T2 **Court
Levy** (bigger drain; the lowest-HP hero in the room is charmed into a thrall) → T3 **Sanguine Pool** (leaves
a blood pool on the floor that keeps taxing heroes standing in it, banks Blood) → T4 **Crimson Rite** (heavy
room-wide exsanguinate; any hero dropped below a threshold is instantly charmed → mass conversion; huge Blood
spike).

**Dungeon kit by act — the Court + economy (`_tickVampire`):** T1 **Blood Tax + Charm** (tax banks/heals;
charm 1 hero/day → roaming thrall, canon kept) → T2 **Growing Court** (charm count + thrall strength scale,
Blood-scaled) → T3 **Sanguine Vigor** (while Blood is high, Sovereign + thralls gain lifesteal on hits —
a flourish, not the identity) → T4 **Blood Bond** (a charmed hero who dies erupts in a %maxHP blood AoE to
nearby heroes, banked, AND charms a neighbor — chain, capped).

**Throne fight — the Sovereign** (tier-gated fight-timer hazard layer, reuses canon names): T1 **Crimson
Lance** (blood-bolt at top-aggro hero, %maxHP, lifesteal heal) → T2 **Sanguine Embrace** (seize + drain-channel
one hero %maxHP, big self-heal + Blood) → T3 **Blood Tempest** (swirling blood storm, %maxHP to all heroes,
heals per hero hit — crowd lifesteal) → T4 **Blood Moon** finale (<30% HP: floods the arena, repeated mass
exsanguinate scaling with banked Blood → near-unkillable burst).

**Tells:** crimson pulsing glow-outline aura reading Blood saturation (maroon → crimson → searing red); body
unchanged. Charmed heroes get a crimson charm tint + heart-mote so you can see the Court forming. BLOOD gauge
+ thrall count + phase in the boss panel.

**VFX (bespoke, animated; new `blood*`/`vampire*`-prefixed — won't touch existing `bloodThread`/`bloodShield`/
`bloodShieldHit`/`bloodFeast`):** `bloodRiteFx` (room exsanguinate → tendrils + droplets stream into the
Sovereign), `sanguinePoolFx` (rippling shaded blood pool zone), `charmBindFx` (hypnotic crimson hearts/mist +
conversion flash), `bloodEruptFx` (thrall death nova + chain-charm tendril), `crimsonLanceFx`,
`sanguineEmbraceFx` (blood tether drain), `bloodTempestFx` (swirling storm), `bloodMoonFx` (rising blood moon
+ arena flood). Shaded helpers `_drawBloodDrop`/`_drawBloodPool`/`_drawBloodTendril`.

**Always-useful:** Rite + tax + tempest + bond are all crowd-wide/%maxHP; Blood snowballs; charm scales the
Court with the crowd. No single-target fixed-magnitude, no heal-block.

**Acceptance checklist (Blood Sovereign):**
- ☑ BLOOD (`boss.blood`) banks from dungeon damage-to-heroes + per-kill gulp; persists; caps/act; passive regen; gauge + readout.
- ☑ Day BLOOD RITE: arm→room, tier-gated Tithe/Court Levy/Sanguine Pool/Crimson Rite; DOM button + Phaser room-pick + events; uses/day reset on night; crowd %maxHP.
- ☑ Dungeon kit: T1 Blood Tax + daily charm→thrall; T2 Court scaling; T3 Sanguine Vigor lifesteal; T4 Blood Bond charmed-death erupt + chain-charm (capped).
- ☑ Throne fight tier-gated: Crimson Lance / Sanguine Embrace / Blood Tempest / Blood Moon finale (Blood-scaled).
- ☑ Tells: crimson glow-outline aura (BossRenderer) reading Blood; charmed crimson tint + heart-mote (AdventurerRenderer); BLOOD + thrall panel readout.
- ☑ Bespoke animated blood VFX (bloodRite/sanguinePool/charmBind/bloodErupt/crimsonLance/sanguineEmbrace/bloodTempest/bloodMoon), lab-wired; lint-vfx clean (incl. dup-key guard); meets detail bar; live-verified (incl. redesigned gory _drawBloodPool 2026-06-15).
- ☑ SaveSystem persists blood (no strip needed); node --check; vampire-bloodcourt-check.mjs green; soak clean (120/0); bossArchetypes.json text; live preview verified. Committed 7d991453.

---

## Boss overhaul #10 — Dark Wraith → THE DREAD HARVEST (locked 2026-06-15)

**Fantasy:** the dungeon's terror is its food. The Wraith banks DREAD from every fright and spends it to break
minds — and every broken mind pays the player (a kill, a knifed ally, or scattered gold). Builds on the
existing per-adv Fear engine (`_addFear`/`_fear`, flee/friendly-fire/panic-death thresholds) + Haunting ghosts.

**DREAD — banked resource (`boss.dread`, persists, caps by act):** pools dungeon-wide — a cut of EVERY fear
point added anywhere banks DREAD, plus a chunk each time a hero breaks (panics, knifes an ally, flees, dies of
fear). While banked it (a) multiplies all fear gain (DREAD multiplier on `_addFear`), (b) adds a passive
ambient terror tick to everyone in the dungeon scaled to DREAD saturation, (c) nudges the break thresholds
down. Crowd-scaling, threshold-based (no HP falloff). NO heal-block.

**Dungeon kit by act (`_tickWraith`):** T1 **Haunting + Fear** (existing) → T2 **Creeping Dread** (passive
ambient fear to everyone in non-entry rooms, DREAD-scaled) → T3 **Contagious Panic** (a hero who breaks spikes
nearby allies' fear) → T4 **The Pall** (dungeon-wide elevated baseline fear, thresholds at floor, ghosts
everywhere).

**Player-positive break outcomes (refine existing — never a clean escape):** Flee (≥flee thresh) → panics to a
random room AND drops gold + spreads panic to allies passed. Friendly-fire (≥ff thresh) → attacks allies.
Frighten-to-death (max fear) → instant heart-stop kill (HP-independent → scales late).

**Day active — NIGHT TERROR** (`WRAITH_TERROR_*` events; strip button + Phaser room-pick; uses/day scale w/
level, refill nightly): floods a room with a big DREAD-scaled fear spike (crowd-wide). T1 spike → T2 + lingering
haunted **dread zone** (keeps adding fear a few s) → T3 + instantly break the most-afraid hero (friendly-fire)
→ T4 + any hero past the panic threshold is frightened to death at once. Banks DREAD from the terror.

**Throne fight — fight-timer terror duelist (`_tickDreadFight`):** T1 **Dread Pulse** (wave: all fighters fear
+ small %maxHP) → T2 **Phantom Assault** (haunt-ghosts manifest + strike) → T3 **Mass Hysteria** (fighters past
ff-thresh attack each other) → T4 **Night Terror finale** (<30% HP: room goes black, big fear spike, the
most-terrified frightened to death — instant if past panic thresh else %maxHP; scales w/ DREAD).

**Tells:** cold spectral-indigo glow-outline aura reading DREAD saturation (washed-out ghost-blue → pale
white-violet; distinct from Beholder bright-violet + Vampire crimson). High-fear heroes get a trembling pale
dread tint. DREAD gauge + "N breaking" party-fear readout + phase in the boss panel.

**VFX (bespoke; won't clobber existing minion ghost VFX `fearStrikeFx`/`dreadAuraFx`/`hauntCloakFx`/
`pallOfDreadFx`/`panicState`):** `nightTerrorFx` (room plunges dark, spectral faces/claws lunge from edges),
`dreadZoneFx` (lingering haunted shroud), `frightDeathFx` (soul/shadow rips out on a heart-stop), `dreadPulseFx`
(expanding wail ring), `phantomAssaultFx` (manifesting ghosts strike), `panicBreakFx` (terror burst + scattered
gold on a flee). NO `Balance` ref inside AbilityVfx — pass magnitudes/durations via opts.

**Always-useful:** thresholds are %-of-party not fixed-target; fright-death is HP-independent; ambient +
contagion + Pall scale with crowd; DREAD snowballs. No single-target fixed-magnitude, no heal-block.

**Acceptance checklist (Dread Harvest):**
- ☑ DREAD (`boss.dread`) banks from fear added + hero breaks; persists; caps/act; multiplies fear gain + ambient tick + threshold nudge; gauge + readout.
- ☑ Dungeon kit: T1 Haunting+Fear; T2 Creeping Dread (ambient); T3 Contagious Panic (break spreads); T4 The Pall (dungeon-wide).
- ☑ Player-positive breaks: flee drops gold + spreads panic; friendly-fire; frighten-to-death instant kill.
- ☑ Day NIGHT TERROR: arm→room, tier-gated spike/zone/break/mass-death; DOM button + Phaser room-pick + events; uses reset on night.
- ☑ Throne fight tier-gated: Dread Pulse / Phantom Assault / Mass Hysteria / Night Terror finale (DREAD-scaled).
- ☑ Tells: spectral-indigo glow-outline aura (BossRenderer) reading DREAD; high-fear tint (AdventurerRenderer); DREAD + breaking panel readout.
- ☑ Bespoke animated dread VFX (nightTerror/dreadZone/frightDeath/dreadPulse/phantomAssault/panicBreak) — all built on the animated ghost sprite (`_makeSoulSprite`, no drawn faces), lab-wired; lint-vfx clean (incl. dup-key guard); live-verified.
- ☑ SaveSystem (dread + terror uses are plain persisted fields; no strip needed); node --check; wraith-dread-check.mjs green; soak clean (120/0); bossArchetypes.json text; live preview verified.

---

## Boss overhaul #11 — Gnoll Alpha → THE BLOOD HUNT (locked 2026-06-15)

**Fantasy:** an apex pack-leader who turns the dungeon into a hunting ground. The pack's carnage banks FEROCITY,
which whips them into a frenzy and fuels coordinated hunts the Alpha leads in person. Builds on the canon
Bloodlust + Hunters Pack. Burst/swarm + pursuit boss — deliberately NO bleed-DoT (stays distinct from the
Lizardman plague; reads as savage physical carnage). No heal-block.

**FEROCITY — banked resource (`boss.ferocity`, persists, caps by act):** banks from every kill + a cut of all
damage the pack/Alpha deal to heroes. Drives a pack-wide FRENZY — all Hunters Pack gnolls gain attack AND move
speed by Ferocity saturation (captured baselines), visibly FRENZIED above a threshold; also fuels the day-active
+ throne finale. No falloff. Canon **Bloodlust** (per-kill daily ATK ramp) stays as the T1 baseline underneath.

**Dungeon kit by act:** T1 **Bloodlust + Pack** (existing) → T2 **Frenzy** (high Ferocity = pack atk+speed surge)
→ T3 **Pack Tactics** (gnolls focus-fire: extra dmg to a hero already engaged by another gnoll) → T4 **The Great
Hunt** (whole party is quarry; pack roams aggressively dungeon-wide; Ferocity gain amplified).

**Day active — SOUND THE HUNT** (`GNOLL_HUNT_*` events; strip button + Phaser room-pick; uses/day scale w/ level,
refill nightly): the Alpha howls, the Hunters Pack re-homes to the target room and swarms it + a crowd-wide
%maxHP rend. T1 converge+rend → T2 harder + sustained swarm → T3 + the Alpha LEAPS in for a heavy rend on the
most-wounded → T4 + survivors stay marked and the pack pursues room-to-room. Banks Ferocity from the carnage.

**Throne fight — the Alpha leads (`_tickHuntFight`):** T1 **Rend** (top-aggro hero %maxHP) → T2 **Pack Tactics**
(manifested pack multi-strikes a focused hero) → T3 **Frenzy** (rends hit all engaged + bonus vs wounded) → T4
**Blood Hunt finale** (<30% HP: a leaping rend flurry across ALL fighters, %maxHP, scales with Ferocity).

**Tells:** savage blood-red FEROCITY glow-outline aura on the Alpha (fiercer pure red — distinct from vampire
pink-crimson + demon orange); frenzied gnolls get a rage tint/pulse; FEROCITY gauge + FRENZIED state + pack count
in the boss panel.

**VFX (new, won't clobber gnoll minion `bleedSlashFx`/`bleedingAuraFx`/`bloodTrailFx`/`ruptureFx`/`bloodFrenzyFx`):**
`soundHuntFx` (howl ring + converging claw-streaks + blood spray), `packRendFx` (overlapping claw-slashes + blood
burst on a hero), `alphaLeapFx` (pounce arc → slam + dust + claws), `frenzyHowlFx` (howl + rage-pulse on the pack),
`bloodHuntFinaleFx` (room-wide claw-rake flurry + blood + shake). Small `_drawClaw` helper; reuse `_drawBloodDroplet`/
`_drawBloodClot`. NO `Balance` ref inside AbilityVfx.

**Always-useful:** frenzy (atk+speed) + Hunt rend + finale are all crowd-wide / %maxHP; Ferocity snowballs; pack
scales with the crowd. No single-target fixed-magnitude, no heal-block.

**Acceptance checklist (Blood Hunt):**
- ☑ FEROCITY (`boss.ferocity`) banks from kills + dmg; persists; caps/act; drives pack frenzy (atk+speed, captured baselines); gauge + readout.
- ☑ Dungeon kit: T1 Bloodlust+Pack (kept); T2 Frenzy; T3 Pack Tactics (focus-fire); T4 Great Hunt (dungeon-wide + amplified gain).
- ☑ Day SOUND THE HUNT: arm→room, pack re-homes + %maxHP rend; T2 sustained, T3 Alpha leap, T4 pursuit; DOM button + Phaser room-pick + events; uses reset on night.
- ☑ Throne fight tier-gated: Rend / Pack Tactics / Frenzy / Blood Hunt finale (Ferocity-scaled).
- ☑ Tells: blood-red glow-outline aura (BossRenderer) reading Ferocity; frenzied pack tint (MinionRenderer rage-glow); FEROCITY + frenzied + pack panel readout.
- ☑ Bespoke animated VFX (soundHunt/packRend/alphaLeap/frenzyHowl/bloodHuntFinale) — built on REAL lunging gnoll sprites (`_makeGnollSprite`) + detailed tapered claw-gashes (`_drawClaw`); lab-wired; lint-vfx clean (incl. dup-key guard); live-verified (detail-polish pass per user).
- ☑ SaveSystem (ferocity + hunt uses plain-persist; pack baselines self-heal via `_tickGnoll`); node --check; gnoll-bloodhunt-check.mjs green; soak clean (120/0); bossArchetypes.json text; live preview verified.

---

## Boss overhaul #12 — Succubus Queen → THE RAPTURE (locked 2026-06-15, FINALE)

**Fantasy:** an irresistible Queen who turns the party's own desire into a weapon — banks ALLURE and spends it
to mesmerize heroes into helpless rapture, set them on each other, and lure them to their deaths, all while
hiding behind seductive illusions. Pure crowd-CONTROL, NOT the Vampire's permanent conversion. Builds on the
canon bat-form charm (`aiState='charmed'` + `_tickCharmedAdv`) + Doppelgänger decoys. No heal-block.

**ALLURE — banked resource (`boss.allure`, persists, caps by act):** banks from each hero mesmerized (per
application) + a gulp per hero death (level-scaled) + a small passive trickle while heroes are alive. Scales
how many heroes each mesmerize hits, the mesmerize duration, and the finale magnitude. %-of-party, no falloff.

**The three mesmerize states (player-positive control — every one is a kill opening):**
- **Infatuated** — turns on their own party (reuses canon `charmed` AI: `_charmerId='succubus'`, `_tickCharmedAdv`).
- **Enraptured** — frozen defenseless AND takes bonus damage: sets `_petrifiedUntil` (freeze) + `_hexUntil`/
  `_hexVulnMul`=`RAPTURE_VULN_MULT` (the existing gazeHexMul vuln read by CombatSystem + BossSystem) + a new
  `_raptureUntil` (drives the PINK bliss tint so it doesn't render as grey petrify). Your minions/traps shred them.
- **Lured** — walks helplessly toward a chosen room (EXPLORE_ROOM goal, like the wraith flee) into your traps/minions; `_luredUntil` for the tint.

**Dungeon kit by act:** T1 **Seduction** (existing bat-flight → 1 hero Infatuated/cooldown) → T2 **Entrancing
Aura** (passive allure field periodically Enraptures an explorer, ALLURE-scaled) → T3 **Fickle Heart** (mesmerize
hits more heroes + lasts longer as ALLURE climbs; Lure unlocks) → T4 **The Rapture** (periodic dungeon-wide
rapture pulses; much of the party perpetually mesmerized).

**Day active — KISS OF RAPTURE** (`SUCCUBUS_KISS_*` events; strip button + Phaser room-pick; uses/day scale w/
level, refill nightly): beguile a whole room — T1 Infatuate all inside → T2 + Enrapture the most-wounded → T3 +
Lure survivors toward the dungeon → T4 mass Enrapture (whole room frozen-in-ecstasy kill window). Banks ALLURE.

**Throne fight — the Queen + illusions (`_tickRaptureFight`, reuses canon names):** T1 **Heartpiercer**
(entrancing strike on top-aggro, %maxHP + brief Enrapture) → T2 **Doppelgänger** (reuse the decoy split; shatter
copies to hit the real Queen) → T3 **Maelstrom of Desire** (room-wide allure pulse: Infatuate/Enrapture, %maxHP)
→ T4 **Rapture's End** finale (<30% HP: whole party enraptured + drained, ALLURE-scaled mass %maxHP).

**Tells:** hot-magenta ALLURE glow-outline aura on the Queen (distinct from vampire crimson); mesmerized heroes
get a pink rapture tint + floating hearts; ALLURE gauge + mesmerized-count + phase in the boss panel.

**VFX (new; reuse my `_drawHeart` helper + boss sprite for doppelgängers; won't clobber existing succubus/charm
VFX):** `kissOfRaptureFx` (room beguile — heart bloom + allure mist + blown-kiss pulse), `raptureBindFx` (a hero
enraptured — hearts spiral + freeze shimmer), `lureFx` (a ribbon-of-desire tether), `doppelgangerSplitFx`
(mirror-image copies peel off the Queen), `maelstromFx` (heart-vortex room pulse), `raptureFinaleFx` (mass
ecstasy bloom + flush). NO `Balance` ref inside AbilityVfx.

**Always-useful:** mesmerize is %-of-party (Kiss + aura + pulses hit crowds); enrapture freeze+vuln + infatuate
friendly-fire + lure-into-hazards are all kill openings; ALLURE snowballs. No single-target fixed-magnitude, no heal-block.

**Acceptance checklist (The Rapture):**
- ☑ ALLURE (`boss.allure`) banks from mesmerize + death + trickle; persists; caps/act; scales count/duration/finale; gauge + readout.
- ☑ Mesmerize states: Infatuated (canon charm), Enraptured (freeze + `_hexVulnMul` ×1.5 bonus damage + pink tint), Lured (walk into hazards).
- ☑ Dungeon kit: T1 Seduction; T2 Entrancing Aura (auto-enrapture); T3 Fickle Heart (more/longer + Lure); T4 Rapture pulses (dungeon-wide).
- ☑ Day KISS OF RAPTURE: arm→room, tier infatuate/enrapture/lure/mass; DOM button + Phaser room-pick + events; uses reset on night.
- ☑ Throne fight tier-gated: Heartpiercer / Doppelgänger / Maelstrom / Rapture's End finale (Allure-scaled).
- ☑ Tells: magenta glow-outline aura (BossRenderer) reading Allure; rapture pink tint + hearts (AdventurerRenderer, petrify-grey suppressed); ALLURE + mesmerized panel readout.
- ☑ Bespoke animated VFX (kissOfRapture/raptureBind/lure/doppelgangerSplit/maelstrom/raptureFinale) — doppelgängers are real succubus-sprite copies; lab-wired; lint-vfx clean (incl. dup-key guard); user-approved.
- ☑ SaveSystem persists allure + kiss uses, strips `_raptureUntil`/`_luredUntil` (freeze/hex/charm fields already stripped); node --check; succubus-rapture-check.mjs green; soak clean (120/0); bossArchetypes.json text.

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
9. **Barracks** — Minions actively sleep here between patrols. Parties can sneak through silently — but any combat wakes everyone. The Speedrunner wants to dash through. The Paranoid refuses to move until every minion is dead. *(🚫 SLEEP MECHANIC REMOVED 2026-06-21, by user — the "sleep until an adventurer enters / combat fires" behaviour (and the barracks HP-regen perk) is gone; a `starter_barracks` now simply grants minion slots, and minions placed there aggro like any other room. The sneak-through/ambush idea is retired.)*

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
| **Library of Whispers** | 1 | Reveals next party intel the night before. **(2026-06-20 redesign)** A single Library reveals the FULL forecast — size, classes, personalities, scaled stats, route — and the room is now **capped at 1 per dungeon** (the old "more Libraries = deeper tiers" model is retired). Per-class intel (stats / personality / **abilities**) is further gated: a class's dossier unlocks only once you have a Library AND have **killed one of that class this run** (event-tier invaders are exempt from the kill). Applies everywhere — the ADV INTEL dossier, the hover InspectPopup, and the Codex adventurer tab. (Moved from L4 → L2 on 2026-05-19.) |

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
| **Wandering Gate** | 1 | On entry, % chance to teleport adventurer: **60%** nearby room, **35%** any built room, **5%** Boss Chamber. *(deviation noted 2026-06-17 — reworked to "Disorienting Gate": the 5% Boss-Chamber bucket was a room the PLAYER builds that occasionally handed an invader a free trip to the boss. Now a pure setback — distance-weighted scatter to a random NON-boss room, biased toward rooms far from the boss [flung back toward the entrance], + path wipe. Tinkered = always the farthest room. See "Room balance + additions 2026-06-17".)* |
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
| **Wishing Well** | 1 | On entry, coin flip. **Heads:** adventurer gains +ATK and +HP buff. **Tails:** adventurer gains "Marked" (skull icon, takes +50% damage from minions for the rest of the day). *(deviation noted 2026-06-17 — "Flip the odds": heads buffing the invader meant the player's own room strengthened invaders half the time. Now 75% Marked / 25% small boon (+2 ATK / +10 maxHp, no free heal); a boon'd adventurer drops +15 bonus gold when killed, so the boon still pays the player. Tinkered "Cursed Well" = 90% Marked. See "Room balance + additions 2026-06-17".)* |
| **False Exit** | 1 | Has its own entry door. Adventurers fleeing the dungeon have a chance to flee here instead of the Entry Hall. Trying to leave teleports them to a random built room. |

#### L9 unlocks

| Room | Cap | Effect |
|---|---|---|
| **Hall of Madness** | 1 | Adventurers in this room have a % chance to attack each other instead of moving on. (Heavy implementation lift — needs new AI state.) |
| **Throne Room** | scales 1 → 2 | Spawns 1 **Mini-Boss (garrison, room-bound)** that scales with boss level. No other minions may be placed in this room. Respawns nightly. *(deviation noted 2026-05-22: the original "T1→T2→T3 family progression" spec was simplified to a skeleton3 baseline whose HP/ATK/DEF scale via `MINION_HP_PER_BOSS_LV` / `MINION_ATK_PER_BOSS_LV`. Stat scaling already creates the difficulty curve; family-tier visual swap is deferred polish.)* |

#### L10 unlocks (capstone)

| Room | Cap | Effect |
|---|---|---|
| **Sanctum** | 1 | Passive: boss regenerates HP between fights. Aura: minions in directly door-connected rooms also regen. *(balance note 2026-06-17 — boss regen changed from a flat 8 HP/round to **1.5% maxHP/round** per Sanctum so it stays relevant at its lv15 unlock [~84 HP/round vs the old laughable 8]. Tinkered = 3%/round.)* |

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

*(table updated 2026-05-22 to match `src/data/rooms.json`. **Library** — ⚠ the multi-Library tier model described in older revisions is RETIRED as of 2026-06-20: the Library is capped at **1 per dungeon** and that one Library reveals the full forecast; per-class detail is gated by a per-run kill instead (see the Library of Whispers row above + `src/hud/wavePreview.js` `hasClassIntel`). **Barracks** ships at 1→9 instead of the original 1→5 spec — kept at the higher cap as a quality-of-life decision per user 2026-05-22; design row retained for historical reference.)*

### Room cost rework — power-based pricing (2026-05-20)

Room `goldCost` values were retuned so price reflects **how powerful the room's effect is**, not just how late it unlocks. Gateway rooms (Barracks, Trap Factory) and free-recurring-unit rooms (Crypt, Throne Room, Hall of Trials, Catacombs) cost more; the pure-information room (Library of Whispers) costs less; capstones (Sanctum) sting.

**Escalating cost** — every multi-instance ("scaling") room now costs more for each additional copy. The first paid copy costs the base `goldCost`; each copy after adds a `costStep` (a top-level room field in `rooms.json`). So a 4th Barracks costs far more than the 1st — spamming a strong room snowballs its price. Single-instance rooms keep a flat cost. Sell-refund is 50% of what that specific copy actually cost (escalation-aware).

### Removed from the original room list

The original 9-room list above (Hall of Echoes, Healing Fountain, Necropolis Wing, Colosseum, Mirror Maze, Obelisk Room, Treasure Room, plus the existing additions Trap Room, Prison Block, Serpent Pit, Power Core, Secret Passage, Lava Floor, Collapsing Pillars) is **superseded by this redesign**. Their behavior either (a) maps onto a new room, (b) becomes a trap in a future Trap Factory pass, or (c) is dropped. The existing handler code remains in place as orphaned no-ops until a follow-up cleanup phase removes it.

The False Exit, Crypt, Armory, Barracks, Guard Post, Entry Hall, Boss Chamber, and Corridor are kept (with reworked behavior where noted).

## Room balance + additions 2026-06-17 (LOCKED — user sign-off in session)

A balance pass over existing rooms plus three new rooms. User approved each item explicitly.

### Balance fixes to existing rooms

1. **Garrison-spawn scaling fix.** Crypt (Risen Bones), Hall of Trials (elite), Catacombs (Revenant), and Mimic Vault (mimics) spawned at **flat base tier stats** and only rescaled on a *future* boss level-up — so at high boss level they were near-useless chaff. Now they scale to the **current boss level at spawn time** via `applyMinionScaling` (the same helper roster minions use), matching the Throne Room which already did this. Throne Room is unchanged (it pre-scales via `statsOverride`; scaling again would double-count).
2. **Sanctum** boss regen: flat 8 HP/round → **1.5% maxHP/round** per Sanctum (3% tinkered).
3. **Armory** minion buff: flat +2 ATK → **+15% attack** per swing (+30% tinkered).
4. **Wandering Gate → Disorienting Gate** and **Wishing Well → Flip the odds** — see the annotated rows above. (Wandering Gate: implemented as "biased toward rooms far from the **boss**" rather than the loosely-worded "far from the exit," because for an advancing adventurer "far from exit" = closer to the boss, which would re-introduce the helping-the-invader problem the rework removes.)

### New rooms (3)

| Room | id | Unlock (boss lv) | Gold | Cap | Effect |
|---|---|---|---|---|---|
| **Tar Pit** | `tar_pit` | 4 | 30 (+22/step) | 1→3 | Control room. Adventurers *inside* move at **50% speed** (folded into the floored slow group — stacks with webs/chills, can't trip the path watchdogs). Minions unaffected. A chokepoint you route the path through into traps/minions. **Tinkered "Sucking Mire":** also **roots 0.75s on entry**, then the slow. VFX: organic bubbling tar pool (lobed pool + popping bubbles), animated. |
| **Silence Ward** | `silence_ward` | 6 | 34 (flat) | 1→2 | Anti-caster. Adventurers in this room **and directly door-connected rooms** can't use class abilities (reuses the `_silencedUntil` / anti-magic silence path). Shuts off Cleric heals / Mage & Necro nukes / Bard songs in the kill pocket. **Tinkered "Dead Zone":** silenced adventurers also take **+15% damage**. VFX: void/null sigil (geometric OK — it's a ward) + suppression pulse over connected doorways. |
| **Bramble Hall** | `thorn_hall` | 5 | 32 (+24/step) | 1→3 | Punish-attacker. When an adventurer makes a **melee** attack while standing here, **30% of damage dealt reflects back** to them (reuses `MinionAbilities.thornsReflect`). Pairs with a tanky minion in the room. **Tinkered "Iron Thorns":** reflect **50%** and also catches **ranged** attackers. VFX: bramble/spike silhouettes erupting at the attacker's feet on reflect (custom path, not a ring). |

VFX bar for all three: organic + detailed, no generic rings (user reminder in this session). Ambient persistent VFX (tar pool, void sigil) go in dedicated per-room renderers modelled on `CobwebRenderer`/`FountainRenderer`; event bursts (mire root, thorns reflect, silence pulse) compose from `AbilityVfx`.

---

## Room VFX pass — telegraph every room's effect (LOCKED 2026-06-17, user sign-off)

**Problem:** the 3 new rooms are the ONLY rooms with dynamic VFX. Every other room
communicates only via static decor + a floor tint + spawned creatures. The player
often can't tell what a room *does* (an Armory buff, a Watchtower watch, a Sanctum
regen are all invisible). This pass gives each room a player-readable, organic,
detailed VFX — held to the same anti-generic bar (each a distinct composition, no
"objects in a ring round the centre").

**Hard constraints (user, this session):**
- **Player-only.** VFX is for the player. Adventurers are NPCs driven by mechanics,
  not by what's on screen — so VFX never needs to "fool" or inform them. This frees
  the deception rooms (False Exit, Mimic Vault) to carry clear *player* tells; the
  NPCs still fall for the mechanic regardless.
- **No decor anchoring.** Decor props are being removed in favour of room skins, so
  NO VFX may attach to a decor prop (forge/anvil/well/bookshelf/skull-niche/throne-
  gem/banner). Anchor only to **room geometry** (centre / floor / interior wall line
  / doorways) or **real gameplay entities** (treasure chests, minions, the mini-boss).
- **No Barracks VFX** (dropped per user).
- Persistent ambience → a dedicated per-room renderer (modelled on `TarPitRenderer`).
  Triggered beats → compose from `AbilityVfx`. A reusable "connected-doorway world
  positions" helper serves the door-conduit rooms (Armory / Sanctum / Veil / Watchtower).

### HIGH priority — invisible-effect rooms (build first)

- **Armory — "Forge-light & travelling edge".** A drawn ember forge-glow rises from the
  room CENTRE (heat-haze: irregular breathing warp, deep orange→ash, spitting spark
  arcs that fall + die). Telegraph: a molten-ember line runs from the room out through
  each *connected* doorway a short way into the buffed room, pulsing on a ~2s loop, so
  the player sees the coverage. Trigger (buffed minion swing): a small ember spark-flick
  at the hit. Composition: heat-source + directional door-conduit.
- **Watchtower — "The watch-beam".** A slow rotating SEARCHLIGHT CONE (soft gradient,
  irregular flicker so it's not a hard wedge) sweeps from room centre across connected
  doorways (~1 rev / 4s); dust motes catch in the beam. Trigger (`WATCHTOWER_FIRST_STRIKE`):
  the beam snaps to the entering adventurer + a sharp "spotted!" glint, then a converging
  light-stab. Composition: rotating directional sweep (unique in the set).
- **Sanctum — "Restorative font".** A drawn luminous light-pool breathes up from room
  centre (irregular, never a clean disc) shedding slow upward feather/petal-motes that
  PEEL OFF and flow OUT through connected doorways toward the rooms it regens. Trigger
  (regen tick): a gentle pulse + 1–2 motes settle/dissolve on the healed unit with a soft
  "+". Composition: rising font + outward mote-stream. (Differentiate from Pantheon holy
  ground — this exhales motes outward.)
- **Veil of Forgetting — "The amnesiac exhale".** Persistent: a thin slow grey churning
  ground-mist (organic lobed fog, desaturating). Trigger (`VEIL_ERASED_INTEL`, night): the
  room EXHALES — a pale mist-wave rolls out each connected doorway and faint glyph-scraps
  (the wiped rooms) drift up + crumble into static. Composition: low fog + outward
  dissolving exhale.
- **Wandering Gate — "The spatial tear".** A ragged VERTICAL rift hovers at room centre —
  torn flickering edges, a dark churning vortex of smeared displaced-room imagery inside,
  spitting reality-sparks; gentle breathing width. Trigger (`WANDERING_GATE_TELEPORTED`):
  the rift flares + yanks the adventurer into streaks sucked into the tear, then recoils.
  Composition: vertical torn rift (unique silhouette; "step here = teleport").
- **Hall of Madness — "Warping miasma".** No central object — the whole space is afflicted:
  a sickly heat-warp shimmer over the floor, entities' shadows split into a jittering
  second shadow (paranoia made visible), half-formed whispering face-wisps surface + melt.
  Bruised red-violet. Trigger (friendly-fire turn): a red madness-pulse over the afflicted
  adventurer + a brief cracked-glass flash. Composition: full-room warp + doubled shadows.

### MEDIUM priority — identity & flavour

- **Crypt — "Grave-mist & clawing hands".** Low necrotic ground-mist (sickly green-grey
  lobed fog) in the floor seams; skeletal hands occasionally claw up from cracks + sink
  back (anticipation→reach→retract). Trigger (`CRYPT_SPAWNED`): a grave heaves — bone-shard
  burst + green soul-wisp coalescing into the Risen Bones. Composition: ground fog +
  vertical claw-ups.
- **Catacombs — "Death-bloom assembly".** Faint flickering ember-eyes drawn along the
  interior WALL line (geometry, not niche decor). Trigger (`CATACOMBS_REVENANT_RAISED`): at
  the corpse tile, bone-shards spiral INWARD + assemble upward into the revenant +
  violet death-bloom. Composition: converging on-death assembly (distinct from Crypt).
- **Treasury — "Heap-glow & siren-lure".** A warm gold centre-glow + sharp coin-glints on
  the actual chest ENTITIES + gold-dust motes; a faint gold glow bleeds out the doorways
  (the lure). Trigger (`TREASURY_STIPEND`, night): coins spill with a clink + gold sparkle.
- **Library of Whispers — "Airborne whispers".** Glowing runic script + translucent
  page-scraps drift through the room AIR (ambient). Trigger (`LIBRARY_FORECAST`, night):
  pages swirl up + a spectral scrying-glow blooms over room centre, then settles.
- **Wishing Well — "Fate-shimmer basin".** A drawn luminous basin at room centre whose
  surface shimmers gold↔violet (the two fates) with fate-wisps curling up. Trigger
  (`WISHING_WELL_BOON`): gold up-burst + sparkles settle on the adv; (`WISHING_WELL_CURSE`):
  violet down-pull + a Marked brand. Composition: luminous water (vs tar's opaque pool).
- **Trap Factory — "Working machine-shop".** Intermittent orange spark-bursts + small
  steam puffs vent from a drawn central workbench-glow; slow gear-glint. Composition:
  mechanical sparks + steam.
- **Hall of Trials — "The crucible".** Heat-shimmer + faint embers rising from a drawn
  central floor fissure. Trigger (`HALL_OF_TRIALS_SPAWNED`): an ember geyser erupts + the
  elite rises from it. Composition: heat-crucible + vertical geyser.

### LOW / optional & special

- **Throne Room** (flair only): drifting dark-majesty motes fill the room + a dark
  crown-flare anchored to the mini-boss ENTITY on `THRONE_MINIBOSS_SPAWNED`.
- **Guard Post** (optional): a faint sentry alert-glint when a minion sallies.
- **False Exit** (now player-readable per player-only rule): an inviting daylight-bleed
  under the door with a faint *wrongness* (light flickers, shadow-wisps crawl back
  inward); on `FALSE_EXIT_TELEPORTED` the doorway light snuffs + folds the fleer back in.
- **Mimic Vault** (now free of the mirror-Treasury constraint for the player): a subtle
  predatory ambiance (a faint hungry shimmer / a too-still wrongness) so the PLAYER can
  tell it from a real Treasury. The mimics still render as red-tinted chests for the NPC
  disguise.
- **None:** Boss Chamber, Entry Hall, Corridor, Barracks.

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

### Title screen — REBUILD (2026-06-09, supersedes the split-screen layout above)

User-locked spec, verbatim. The title screen drops the boss-video shuffle pool +
the right-side panel + the Venture jam-portal button, and rebuilds as a
**center-stacked layout** with the player's last-played archetype rendered
*in-engine* as a throne-room backdrop.

User's structural choices (2026-06-09):
> **Left/centre fill:** *#1 In-engine boss render* — live Phaser BossRenderer of
> the currently equipped archetype in a throne room.
> **Layout:** *B — center-stacked, no side panel.* Logo top, boss scene
> full-screen, menu items as a tight strip overlaid bottom-center on a parchment
> slab.
> **Editor buttons:** mango-gated only (already the case via single DEV TOOLS row).
> **Empty-save boss:** last-played archetype (PlayerProfile).
> **Reign info placement:** above the menu button row.
> **Companion in scene:** no — boss only.
> **Button arrangement:** vertical stack, narrow.
> **Ambient drift:** camera pan.
> **Torch placement:** framing the logo at top.
> **Venture jam portal:** removed everywhere (title screen + in-game corner). The
> portal.js SDK file stays untouched per jam rules.

Acceptance checklist (all ☑ verified live 2026-06-10):
- ☑ No `<video>` element renders on the title screen. No MP4 fetched. `BOSS_VIDEO_*` constants gone. Verified: `document.querySelector('.qf-mm-video') === null`.
- ☑ Phaser `MainMenu` scene renders the player's last-played archetype idle sprite, centered on the canvas, with a breathing tween. Verified: `mm._boss.texture.key === 'gnoll-idle'`, scaleX 5.0, scaleY 5.09 (mid-breath), `mm._breatheTween` active.
- ☑ Throne-room ambience: 2 torch sprites flanking the `QUEST / FAILED` logo at the top + a slow ambient camera pan (~±22px over 13s). Verified: `mm._torches.length === 2`, both `torch` textured, `mm._panTween` active.
- ☑ `PlayerProfile.getLastArchetypeId()` returns the archetype the most recent run committed; updated in `ArchetypeSelect._startRun` on run start. Per-name persistence (`qf.player.last_archetype:<name>`).
- ☑ Fresh profile / no save / no past runs → boss scene shows the default (`orc`). Falls through: save → profile → `FALLBACK_ARCHETYPE`.
- ☑ Logo (`QUEST` / `FAILED`) sits **top-center**. Verified in screenshot.
- ☑ Menu items render as a centered narrow stack below the identity + reign-state strip (CONTINUE/NEW EVIL full-width primaries, secondaries flow 2-col, QUIT alone).
- ☑ Player name + title pill + reign-state line ("YOUR REIGN, MY LORD" + boss/day/kills) live above the button stack. Verified: `.qf-mm-identity` + `.qf-mm-reign` both present.
- ☑ Footer (version / SAVE OK / © BONEMAKER) at the bottom edge. Verified: `.qf-mm-footer-bottom` bottom = 1038, stage bottom = 1048 → fits within the 1080 stage.
- ☑ Editor row stays mango-gated (no behaviour change). `DEV TOOLS` row shown only when `PlayerProfile.isCheatName()`.
- ☑ Venture jam portal removed from both the title screen AND the in-game `JamPortalCorner`. `portal.js` SDK untouched. `JamPortalCorner.js` orphaned with a SUPERSEDED banner (kept per removal-not-deletion policy).
- ☑ Stale header comment in `MainMenuOverlay.js` rewritten to describe the new layout.
- ☑ No console errors at boot.

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

**Twitch Con** — ❌ REMOVED 2026-06-05 (event + the `twitch_streamer` class fully cut, per user + IP cleanup).
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

**As built (v1, 2026-06-01) — the functional duel, cinematic deferred:** On Act IV's final day (day 40) the crowned Hero King arrives for a **solo throne duel that replaces the normal wave** (no normal adventurers that day — same set-piece pattern as Solo Leveling / Light Party, so no stray raider can game-over you the instant you've won). He is the **killable** form (`_nemesisDuel`, *not* the Acts I–III plot-armored `_nemesis`), never flees, ignores loot, and beelines the throne. **Putting him down → `RUN_VICTORY` → the Victory screen** (fires the moment he falls, via `NEMESIS_SLAIN`).

**Duel-loss → rematch overtime (locked 2026-06-09, verbatim user spec):**
> *Option 2 — Overtime / rematch. Mirror the drafted-act Champion overtime: Aldric retreats to recover, comes back the next day stronger, until either side falls for good.*

If Aldric **wins** the Act IV duel and the boss still has lives remaining, the run does NOT end and the Victory screen does NOT fire. Instead the boss loses one life (current behaviour) and the act enters **overtime**: Aldric retreats, returns the next day for a rematch, escalating per overtime day, until either the boss puts him down (→ victory) or the boss runs out of lives (→ Game Over). Mirrors the existing KR P3 Champion-overtime mechanic for the drafted middle acts.

User-locked details (2026-06-09):
- **Escalation:** Aldric escalates per rematch — `+HP / +ATK` per overtime day, capped (mirrors the Champion overtime curve `1 + min(0.4, ot × 0.1)`).
- **Overtime wave:** Aldric **solo** on overtime days. No royal wave, no honour guard — just the rematch.
- **Life cost:** Each duel loss costs the boss **one life** (current behaviour). 3 losses = run over. The 3-lives ceiling caps the rematch loop naturally.

Acceptance checklist (all ✅ 2026-06-09):
- ☑ Victory screen no longer fires from the "survived Act IV final day" fallback — gated on `meta.nemesis.slainByBoss` in `ActSystem._onDayEnded`. Verified via 4-scenario eval harness (lost-duel → ACT_OVERTIME only; won-duel → RUN_VICTORY only).
- ☑ Losing the duel with lives left → enter overtime (`meta.act.overtime = true`, `overtimeDays++`). Verified: scenarios A (overtimeDays 0→1) + C (overtimeDays 1→2) — counter accumulates per rematch loss (the early bug where it reset to 0 was caught + fixed by hoisting the Act IV branch above the cleared-bookkeeping).
- ☑ Each Act IV overtime day spawns Aldric **solo** (no normal wave) at full HP, escalated by the overtime multiplier. `DayPhase._spawnNemesis` applies `1 + min(0.4, ot × 0.1)` to HP + ATK when `overtimeDays > 0`. Solo spawn handled by the existing `_act === 4 && return _spawnNemesis(true)` path; the gate now accepts overtime days + bypasses `_lastAppearedAct` on Act IV overtime so the re-spawn fires.
- ☑ Boss out of lives during a rematch → `BOSS_DEFEATED_FINAL` → Game Over (existing flow, unchanged in `BossSystem._finishNemesisDuel`).
- ☑ `ACT_OVERTIME` banner reads as a **rematch** on Act IV (`ActIntro._onOvertime` branches on `act === 4`): "REMATCH ×N / THE HERO KING RETURNS / Aldric rises again — break him, or the crown breaks you."
- ☑ Dungeon log line distinguishes Act IV rematch (`RightPanels` `ACT_OVERTIME` handler branches on `act === 4`).

What's *not* built yet (deferred): the duel **cinematic** (reuse of the SL/LP letterbox / dual-HP-header / scripted-beats / slow-mo tech), live **balance tuning** of his HP/atk vs the boss, and his signature **abilities as behaviours**.

### Boss evolution (per act)

Each cleared act, the player's boss **visibly transforms/ascends** — a new form, a power, and an upgraded throne — so the escalation is something the *player* feels, not just bigger enemy numbers. Four escalating forms across the run (act-gated cosmetic + a stat/ability bump). Builds on the existing boss-evolution scaffolding.

### Win / Loss / Meta / Endless

- **Win** (beat the Hero King) → **Victory screen** + **meta-unlock**: a new **"Reckoning" New Game+ difficulty tier** (harder acts / tougher draws) + a victory **achievement** (plus a possible cosmetic / boss / companion reward — TBD).
- After victory, the player may **continue into Endless mode** — today's infinite day-by-day scaling — for the leaderboard (the board can split "Victory" vs "Endless").
- **Loss** unchanged: boss dies 3× at any point → Game Over.
- Existing scripted events (Zombie Horde, Solo Leveling, Light Party, Treasure Raid, etc.) still fire *within* acts as flavor/variety, layered on top of the act framework.

### Mode Select — "Choose Your Path" (visual redesign, 2026-06-21)

The mode picker (NEW EVIL → **ModeSelect** → CompanionSelect) was rebuilt to a
high-fidelity design handoff ("Choose Your Path"): two hero **gate cards** — each
a runic medallion set into a carved stone doorway with jamb runes, pixel
wall-torches, and a per-mode particle motif (Campaign = rising war-embers + an
engraved **rune-halo** ring + crossed-swords glyph; Endless = orbiting motes + an
interlocking **iron-chain** ring + infinity glyph). Hover/focus/active lights the
gate and animates the medallion. Reaching this screen always starts a **fresh
run** (Continue/Resume lives on the Main Menu), so both cards read **"Begin"**
(Begin the Reckoning / Raise the Siege) with informational **record chips** driven
by real profile data — Campaign shows "Reckoning won · NG+N ready" once the
campaign has been cleared (`PlayerProfile.getReckoningTier()`); Endless shows
"Best · N days held" (`AchievementSystem` metric `daysSurvivedMax`), each hidden
when there's no data. Implemented in `src/hud/ModeSelectOverlay.js` +
`src/hud/modeSelectArt.js` (SVG art) + `src/hud/modeSelect.css`.

Below each mode sits a **teaser card** for a future mode:
- **New Game +** ("The Deeper Dark") — already a real feature (the Reckoning NG+
  tier, chosen at boss-select). Sealed until the campaign is won; once unsealed it
  shows an accent-tinted "available" treatment with a ✦ New badge and launches a
  Campaign run.
- **Challenge Mode** ("The Gauntlet") — *re-teased as a PLANNED mode.* "Curated
  trials with brutal modifiers and a single life." NOTE: this revives the
  challenge-run concept struck on 2026-04-28 (above) — but **only as a sealed
  teaser**, not yet built. Sealed card shows an unlock-progress bar (days held in
  Endless, target 50). Building it out is future work; the card promises it.

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
- ☑ The "adventurers" are actual T1–T4 MINIONS (like the Rival Dungeon event), not normal adventurers. [SHIPPED 2026-06-04 — the rival block in DayPhase._spawnChampionRaid rolls rollRivalDungeonSprites() and stamps `_minionSheet` (a `minion-<id>` key, T1 sheets first half / T2 second half) on each `_monster` retinue unit; AdventurerRenderer then draws real minion sheets instead of the monster_invader chassis's borrowed adventurer LPC. Verified: 8/8 horde monsters render isMinionSheet=true.]
- ☑ The rival boss sprite is a random T4 boss when it spawns. [SHIPPED 2026-06-03 — Vorzak gets a random boss skin via rollRivalDungeonSprites().bossSkin → `_rivalBossSpriteKey` (renderer reads it), named "Vorzak, the <Archetype> Usurper".]
- ☑ Unique cinematic for the boss-vs-boss fight, Aldric/Solo-Leveling style but completely unique animations + VFX. [SHIPPED 2026-06-04 — the RIVAL SHOWDOWN, see "Rival — SHIPPED" below.]

**Rival status:** the rival-boss IDENTITY (random T4 boss skin on Vorzak), the **retinue minion sprites** (T1/T2 minion sheets), AND the **boss-vs-boss SHOWDOWN cinematic** are all shipped (2026-06-03/04). The champion signature ("reuse the random-T4-boss-archetype's own kit, turned on you") was **CUT by user decision 2026-06-04** — the showdown rolls its outcome from relative power, so a separate signature ability isn't needed. **The Rival slice is COMPLETE.**

### Rival — boss-vs-boss SHOWDOWN

**⚠ SUPERSEDED v1 (2026-06-04):** the first showdown REUSED the Aldric melee-duel engine recolored purple (`_runRivalDuel` → the shared `_startDuel`/`_buildNemPlan`/`_nemMove` + a portrait-less repaint of the `qf-ald-*` two-HP-bar cinematic). User flagged it 2026-06-04 as "basically copy-pasted the Aldric fight — the entire fight sequence AND effects need to be completely different and unique." The wiring (trigger, `_runRivalDuel`, the `_rivalBoss` reward flow via `_finishNemesisDuel → _killAdv → ADVENTURER_DIED`, the DayPhase tagging, the dev hook) stays; the FIGHT CONTENT + the cinematic are being rebuilt.

**LOCKED v2 — "Clash of Dominions" (user-chosen 2026-06-04, VERBATIM):**
> *"A power-struggle, not a sword fight. The two lords stand at OPPOSITE ends and channel colliding energy beams; a central nexus orb slides toward whoever's losing. HUD = one tug-of-war DOMINANCE bar (not two HP bars). Beats: SURGE / COUNTER-SURGE / FEEDBACK, ending in the loser's beam collapsing + detonating on them. Totally unlike the melee duel — stationary, arcane, two auras swelling/shrinking around a crackling beam-lock."*
> Preview locked: `VORZAK ◀━━━━━●━━━━━▶ YOUR BOSS` (purple ↔ crimson, ▲nexus); two beams `))))))))> <(((((((` colliding at a ✦ nexus; "nexus lurches toward the loser each SURGE; on FEEDBACK it detonates → throne held / usurped."

Acceptance checklist — ALL met + verified live (commit 616bfef, 2026-06-04):
- ☑ **Stationary, not melee** — `_dominionMove` holds the lords at throne/south anchors and leans/recoils them by `dom`; no orbit/clash/knockback. Verified: phases run with the lords held (not the Aldric `_nemMove`).
- ☑ **Colliding beams + a nexus orb** — `_dominionBeamRedraw` draws two tapered crackling beams (crimson + purple) meeting at a nexus orb at `1-dom` along the axis. Verified on-canvas (305 draw cmds, green-test render confirmed; nexus coords track `dom`).
- ☑ **Dominance, not HP** — engine eases a single `D.dom`; emits `RIVAL_DUEL_DOMINION { dom }` (HP derived only so the rolled loser hits 0). No two-HP-bar feed on the rival path.
- ☑ **HUD = one tug-of-war bar** — `qf-riv-track` with a purple (left) + crimson (right) fill meeting at a sliding `qf-riv-nexus`. Verified DOM (fills 30/70%, nexus left% = dom) + screenshot.
- ☑ **Beat sequence = SURGE / COUNTER-SURGE / FEEDBACK** — `_buildDominionPlan` = ignite→lock→v_surge→b_counter→strain→feedback→overload→collapse; beats fire in order (verified live), nexus lurches + auras swell per surge.
- ☑ **Collapse finale** — `collapse` phase detonates the loser's side; `_onEnd` card win = "THE THRONE HOLDS / THE USURPER FALLS", loss = "THE THRONE IS USURPED / VORZAK CLAIMS THE THRONE". Both verified.
- ☑ **Unique VFX + unique cinematic CSS** — bespoke `qf-riv-*` stylesheet (NO `qf-ald-root` present); beam/nexus/aura/feedback VFX, not blade/dome/god-rays. Verified (`hasAldRoot:false`).
- ☑ **New event contract** — `RIVAL_DUEL_BEGAN/_DOMINION/_BEAT/_END`; cinematic renders from `dom` + rival beat kinds (no advFrac/bossFrac).
- ✂ Champion signature ("reuse the random-T4-boss-archetype's own kit, turned on you") — **CUT (user decision 2026-06-04)**: the showdown rolls its outcome from relative power, so a separate signature ability isn't needed. Not a TODO.
- 🟡 Retinue minion SHEETS + unique Vorzak look — sprite pass, DEFERRED.

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
- ~~Rival boss → **its random-T4-boss-archetype's own signature** (reuse the boss ability kit, turned on you)~~ — ✂ CUT 2026-06-04 (user call; the boss-vs-boss showdown carries the Rival response — outcome rolled from relative power, no separate signature needed)
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
- ☑ NIGHT-DASH sabotage intro SHIPPED 2026-06-04 — once per Betrayer act (first build phase, NIGHT_PHASE_STARTED gated + `_betrayerDashDone`), the STRONGEST minion turns traitor: a scripted frame-step lerp dashes it trap-to-trap (BETRAYER_DASH_SPEED) flipping each in a green sabotage burst, then it bolts for the entry and ABANDONS you (removed, no respawn). MinionAISystem skips it via `_saboteurDashing`; immune mid-dash via `_invulnerable`. Dev: `__qfDev.betrayerDash()` / BETRAYER DASH button. Verified LIVE (full dash→flip→exit→removed cycle).
  - NOTE: fixed a latent bug in the same pass — KingdomModifierSystem was using `TILE` (the tile-TYPE enum) as the tile SIZE, so all its tile→world VFX (Pantheon Final Judgment band, Mage seal marks, Betrayer ⇄ marks, the dash) rendered at NaN. Now uses `TS = Balance.TILE_SIZE`.
- 🟡 DEFERRED (sprite): **Champion looks like the turned minion** — a sprite swap; folds into the deferred sprite pass (could merge defector→champion).
- ⚠ BALANCE (eyeball, IMPORTANT): flipped traps fire on patrolling minions continuously — this could SHRED your minion line over a whole act. Faithful to the spec ("all traps damage only my minions all act") but watch it hard in a live run; may want a per-minion cooldown or a damage cap.

---

## Day-Tier Class Unlocks + "New Threats" Reveal + Twitch Removal (locked 2026-06-05)

**User's verbatim request:** "instead of being level gated, I want them to be based on the day
number in the game. Every 10 days, I want a new set of classes added to the pool. None should be
rarer than others, except the cheater. Cheater class should be very rare. See my list below. Also,
I want a thematic notification for the player once a new set of classes have been added to the
potential adventurers that enter the dungeon so that they are aware of the new threats. … I also
want to completely remove the twitch streamer class and twitch con event from the game."

**Verbatim schedule (additive — each tier ADDS to the pool, never replaces):**
- Day 1–10: knight, rogue, mage, cleric, ranger
- Day 11–20: peasant, bard, pirate, gladiator, monk
- Day 21–30: templar, gambler, barbarian, beast_master, miner
- Day 31–40: cheater, necromancer, Valkyrie

**Locked decisions (confirmed by user 2026-06-05):**
1. Classes gated by **day number**, NOT boss level. (Boss-level scaling of adventurer stats stays; only
   the class-availability gate changes.)
2. Event-only classes (the `unlockLevel: 99` set — Shadow Monarch, Light Party, Loot Goblin,
   monster_invader, etc.) STAY excluded from the normal pool (keep the 99 sentinel).
3. **Flat rarity** — every eligible class equal `spawnWeight` (=1), EXCEPT **cheater = very rare**
   (`spawnWeight` ~0.08 ≈ ~0.5% per adventurer once unlocked).
4. **New-threats notification:** a polished full-screen thematic card (modeled on the act-intro cards)
   that fires **the night BEFORE** a new tier's day (when the upcoming day is 11/21/31), so the player
   gets build-time to prep. Day-number triggered (works in endless `?acts=0` mode too; sequences after
   any act-intro if they coincide). Fires once per tier per run.
5. Card lists the new classes with **sprite thumbnail + name + a very brief "what they do"** line.
6. **NG+:** the **full roster** is unlocked regardless of day (a day reset must NOT re-lock to tier 1).
7. **Twitch:** completely remove the `twitch_streamer` class AND the `twitch_con` event (also clears one
   of the IP references flagged for commercial release).

**Acceptance checklist:**
- ☑ Shared `getEligibleClasses(allClasses, day, {ngPlus})` helper (single source of truth), day-gated, excludes
  `unlockLevel:99` + `shadow_monarch`. All 5 gate sites point at it (DayPhase spawn, NightPhase preview,
  RightPanels forecast, AdventurerIntelPopup, RoomBehaviorSystem library forecast). (2026-06-05)
- ☑ `unlockDay` set per the schedule; boss-level gate removed for normal classes. Verified: 5/10/15/18-class
  cohorts at days 1/11/21/31; live wave preview at day 10 shows only tier-1.
- ☑ Flat `spawnWeight` (cheater = 0.08).
- ☑ NG+ full-roster unlock (reckoningTier>0 → ngPlus → full roster from day 1).
- ☑ Night-before reveal card (`hud/NewThreatsReveal.js`, days 11/21/31), once-per-tier-per-run
  (meta.revealedClassTiers, save-persisted), lists new classes w/ real sprite + name + brief blurb; sequences
  behind act/response intros; dismiss on button/key/backdrop. Verified live at day 11 + day 31 (rare cheater
  styling).
- ☑ Endless-mode (`?acts=0`) reveal still works (NewThreatsReveal constructed unconditionally, day-triggered).
- ☑ `twitch_streamer` class + `twitch_con` event fully removed (2026-06-05 — code, data, AI, HUD, sprites,
  chat lines, balance, docs; 14MB sprite folder deleted; STATUS.md counts synced: events 35, classes 29;
  lint-content + verify-docs green; headless sim/soak clean).

---

## Adventurer AI & Personality Overhaul (2026-06-10) — VERBATIM SPEC (locked with user)

> This is the **canonical spec** for the AI/personality rework. Build from THIS, not from
> memory or chat. Acceptance checklist lives in `DESIGN_COVERAGE.md §"AI & Personality
> Overhaul"` — tick each box against the actual code before claiming any part "done."
> This is the long-deferred "full personality revamp" STATUS.md flagged; it supersedes the
> dead-field state of the current personality data.

### Why (the framing that drives every decision)

The **Day phase is spectator-only** — the player builds the dungeon, then *watches*. So the
adventurer AI is not plumbing; **it is the show.** The adventurers' reactions are the feedback
that tells the player whether their dungeon is scary / clever / deadly. Today the AI reads as
"units executing a path to the boss" (most of `AISystem.js` is anti-thrash machinery), and
**personalities are weak because there is nothing for them to drive** — a personality is 7
weight scalars plus two arrays (`decisionOverrides`, `reactions`) that are **almost entirely
dead code**. The fix is to build the *verbs* (the three threads below) and make personalities
the dial-settings on them.

**Guiding principle:** every behavior should produce a **legible, on-screen consequence the
player built.** Scary dungeon → you watch nerve crater and parties break. Clever trap maze →
the Scholar/paranoid expose your layout. A loot room → greed exposes itself.

### Build order (locked)

1. **Nerve/Morale spine first** (Thread 1) — appraisal + social plug into it.
2. **Room Appraisal + revive `decisionOverrides`** (Thread 2).
3. **Party Social layer incl. the Confer beat** (Thread 3 + Enhancement A).
4. **Enhancements B (unreliable rumors/bait) + C (react to what you built)** — core, fold in.
5. **Personality roster + data schema** rewrites land alongside the systems they need.
6. **Enhancements D/E/F** — phase-2 polish pass.

**Mood-tell visibility (locked decision):** build the on-screen tells **both ways**
(always-on mood pip + body language VS body-language-only with pip on hover) as a toggle and
**decide in the preview** against the visual bar. Do not hard-commit the HUD treatment up front.

---

### Thread 1 — Nerve / Morale (the spine)

Every adventurer carries an **inner-state block** of plain fields on the adventurer object
(stays JSON-serializable for saves; add to SaveSystem transient-strip review). Core field:
`nerve` (0–100).

- **Mood bands:** Bold → Steady → Wary → Spooked → Breaking (thresholds TBD, tune in sim/preview).
- **Drains** (nerve down): stepping into an unknown/unobserved room; sighting a strong or
  known-dangerous minion; springing a trap; an ally dying nearby; low HP; "in too deep"
  (distance/time from the nearest exit).
- **Recovers** (nerve up): clearing a room of threats; landing a kill; grabbing loot; healing at
  a fountain; returning to already-cleared/known ground; a steadying ally nearby (Veteran/Zealot).
- **Drives behavior dynamically** — nerve, not a static `fleeThreshold` coin-flip, governs
  flee/push decisions, movement pace, and appraisal boldness. The point is an **arc**: an
  adventurer who enters Bold, is ground down to Breaking, and either shatters (flees) or pushes
  through (hero beat) is a *story*.
- **Body-language tells** keyed to band, via the existing `worldX/worldY` + speed-multiplier
  seams (pattern already proven by `_paranoidSpeedMultiplier`): confident **stride** (cleared
  room) / cautious **creep** (unknown room) / panicked **sprint** (Breaking) / frozen
  **hesitation** (threshold). Plus an optional mood pip/aura (see visibility decision above).
- **Personalities tune:** nerve baseline/floor/ceiling, drain & recovery rates, and *what*
  rattles them (e.g. Claustrophobe ← geometry, Berserker ← inverted).

### Thread 2 — Room Appraisal (the decision the dungeon earns)

At a **doorway**, before committing to a room, the adventurer runs an **appraisal** from what it
*knows* (`KnowledgeSystem.getIntelReport()` — never re-derive tiers from sharedPool):

- Compute a **risk score** (known traps, minions, room danger, tier-weighted) and a **reward
  score** (known loot/chests, room type, objective progress).
- **Threshold beat:** pause, "read" the room (a visible hesitation), then pick an action:
  **enter boldly / creep in (slow, trap-careful) / peek-and-back-off / call the party (confer) /
  detour.** Choice is driven by nerve + personality + risk/reward.
- **Revive `decisionOverrides`:** implement a real **trigger → action dispatch table** that reads
  the `decisionOverrides` already authored in `personalities.json`. Triggers fire at the
  appraisal/threshold (`any_door → check_for_trap_first`, `party_warns_danger →
  ignore_warning_and_charge`, `chest_in_room → open_chest` / `avoid_unless_forced`,
  `corpse_in_room → loot_corpse`, etc.), resolved by `priority`. This is the mechanism that makes
  personalities *act*, not just weight a roll.
- **Dwelling:** let adventurers **stop and do something** in a room (inspect a chest, warm at a
  fountain, study/loot with a beat of weight) instead of flowing straight through. Explorers linger.

### Thread 3 — Party Social (make them characters) + Enhancement A (the Confer beat)

**Gap being fixed:** living party members currently do **not** share knowledge — only survivors
update the shared pool on death/escape. So a party walking together never actually communicates.

- **The Confer beat (Enhancement A — CORE):** when a party reaches a junction, a scary
  threshold, a sprung trap, an ally death, or the boss door, they **stop, cluster, and confer** —
  visible speech bubbles, a point at the dangerous door, a head-shake. **That huddle is the literal
  tick where living-party knowledge merges** (so the social knowledge-share is a watchable event,
  not a silent data op). Then they act on the consensus: push / split / retreat. Personalities
  flavor it (leader directs, paranoid warns, overconfident waves it off and walks in). Trigger
  points: dungeon entry (plan), multi-door junctions, post-trap, post-ally-death, pre-boss.
- **Real-time warnings that reroute:** one adventurer springs/spots a trap → nearby allies learn
  it *now* (knowledge merge) and visibly path around it. (`_maybeWarnParty` exists but only puffs
  a bubble — wire it to knowledge + nerve.)
- **Banter call-and-response with consequence:** scout warns → overconfident scoffs, charges, and
  eats it on screen. The player sees the dynamic and its cost.
- **Felt roles:** scout edges ahead, leader holds, healer trails, anchor (Veteran/Zealot)
  steadies nerve. Generalize a lightweight version of the existing Light Party leash.
- **Ally-death ripple:** a nearby death is a nerve event + a personality fork (avenge / break /
  rally / scatter).

### Enhancement B — Unreliable rumors + baiting (CORE)

Lean into the existing **RUMOR** knowledge tier being *wrong*. Stale intel ("treasure in the east
room") the player has since sold or moved sends adventurers chasing nothing — visible
frustration/comedy — and creates a real **strategic layer:** the player can deliberately **bait**
with rumors. Knowledge stops being pure truth and becomes something you can poison. (Cheap — the
tier already exists; make RUMOR-acted-on outcomes resolve against *current* reality and react.)

### Enhancement C — Adventurers react to what you built (CORE)

Make the player's **architecture visible to the AI.** Adventurers acknowledge what you made: gawk
at an ornate/expensive room, recoil at a gruesome theme, mutter "this corridor is a death trap" at
a long approach, whistle at a treasure vault. Directly **rewards the player's design choices** with
reactions; pure visual-bar legibility win. Hooks off room cost/theme/decor + geometry.

### Enhancements D / E / F — Phase-2 polish (after the spine is in)

- **D. Party-level collective morale:** nerve is also a *group* quantity. A party ground to its
  last two makes a collective call — defiant "we've come too far" boss-rush vs. total break-and-flee.
- **E. Hero / last-stand moments:** the sole survivor of a wipe gets a beat — break and flee
  (traumatized) or a defiant final push with a buff + cinematic flourish (visual-bar candidate).
- **F. Returning-veteran briefing:** veterans already inherit full knowledge — make it
  *expressive*. A returner recognizes rooms ("not this corridor again"), strides through cleared
  ground, and **briefs the rookies at the entrance** (a Confer beat at spawn).

---

### Personality roster — FINAL (18 total; all equal-chance, ungated)

**Flat roll (locked):** ALL personalities have **equal probability** and are **not gated** by
`unlockLevel` or rarity. Strip the rarity weighting (`common×4/uncommon×2/rare×1`) and the
`unlockLevel` filter from `PersonalitySystem.rollPersonalities`. (Keep `rarity`/`icon` fields for
display only; they no longer affect the roll.)

**CUT (3):** `speed_runner` (one-note; also collides with the `_speedrunner` event-role flag —
verify nothing references the *personality* id before deleting), `the_fan` (too narrow),
`mimic_handler` (narrow, unimplemented, overlaps paranoid — its "spot the trap-chest" flavor moves
to Scholar/paranoid).

**KEEP + deepen (9)** — the substrate makes these sing; their `decisionOverrides` finally run:
- **greedy** — reward-biased appraisal (loot inflates a room's worth); nerve recovers hard from loot.
- **paranoid** — `check_for_trap_first` becomes real at the doorway; high nerve-caution, creeps, peeks.
- **completionist** — won't leave a room unappraised; mild nerve penalty for *un*explored rooms.
- **cartographer** — methodical layout-mapper; shares full map on escape. (Maps **layout**; Scholar
  reads **contents/threats** — keep them distinct.)
- **overconfident** — `ignore_warning_and_charge` becomes real in the social layer; scoffs, charges, eats it.
- **vulture** — keeps distance (parasite role); nerve calm while others bleed; loots aftermath/corpses.
- **traumatized** — fragile nerve, the survivor; shares full knowledge on party-wipe; pairs with the arc.
- **solo** — ignores party social entirely; self-appraises everything; high-variance.
- **echo** — copies last adventurer's path; dies in the leader's trap. Social layer cleans up the
  fragility; the fragility is *intended drama*.

**REWORK (2):**
- **coward** — *(was: flee every fight, escape as a scout carrying intel)* → **now trails behind
  other adventurers at a distance and avoids fighting minions where possible.** A clingy,
  combat-dodging follower, not a flee-the-dungeon scout. **Edge case:** if isolated or last alive
  with no one to trail, *then* they break and run for the exit (don't let them freeze).
- **underdog** — *(was: invisible 2× XP buff)* → **nerve-arc:** low nerve baseline, timid early;
  **every kill raises nerve + aggression** (a snowball you can *watch*). Keep the 2× XP as the payoff.

**BUILD FOR REAL (2)** — currently stubs/weights, treat as new builds on the checklist:
- **martyr** — build the headline **taunt**: at low HP, pull all enemy aggro onto themselves so the
  party can escape (a real social act + nerve-anchor for the retreat). *(User confirmed: build it.)*
- **raid_leader** — build the **social-anchor role**: leader holds, party leashes loosely to them,
  their death = nerve crash / cohesion loss across the party.

**ADD (5)** — each hooks a *different* game system:
- **Veteran / Grizzled** — high nerve floor, slow drain; **steadies nearby allies' nerve.** The
  anti-coward party morale anchor. *(Morale + social.)*
- **Berserker / Bloodthirsty** — **inverse morale:** *gains* nerve + speed as HP drops and as it
  kills. The lower it goes, the scarier it gets. *(Combat + morale arc.)*
- **Scholar / Lorekeeper** — **dwells to study** rooms; gains FULL knowledge fast, IDs mimics & the
  boss archetype, calls threats out to the party. Absorbs mimic_handler's niche. *(Knowledge.)*
- **Zealot / Devout** — emboldened in shrine/fountain/themed rooms; prays for nerve; **rallies party
  morale.** Reacts to room *themes*. *(Room themes + social.)*
- **Claustrophobe** — **nerve driven by your geometry:** panics in tight corridors (or, inverse
  variant, in big open rooms — pick one at build). Your *architecture* becomes a weapon. Novel —
  nothing else reacts to layout. *(Dungeon layout.)*

### Open tunables (decide in sim/preview, not up front)
- Nerve band thresholds + drain/recovery rates per source and per personality.
- Confer-beat trigger set + duration + how often (avoid over-stopping / pacing drag — mind the
  existing anti-thrash watchdogs; the Confer pause must not trip the hard-stuck/oscillation kills).
- Whether Claustrophobe fears tight corridors or open rooms (or both as two variants).
- Mood-pip HUD treatment (the prototype-both decision).

---

# Minion AI & Roster Overhaul (locked 2026-06-10) — "alive, not just stat-blocks"

Parallel to the Adventurer AI & Personality Overhaul. Goal: make the dungeon's
**defenders** feel characterful and legible without stealing the player's authorship
(minions stay the *predictable engineered defense* the player builds — just more alive,
reactive, and distinct). Grounded against the real code (MinionAISystem.js,
MinionAbilities.js, minionTypes.json, minionEvolutions.json) — not the brainstorm.

## User's locked decisions (verbatim from the selection)
- **Pursue Threads B, C, D, E** (NOT A pack-morale, NOT F minion-side knowledge).
- **"lets widen and deepen"** the roster.
- **Widen — new roles (all 4 selected):** Crowd-controller, Commander/buffer, Summoner,
  Terrain-shaper/debuffer.
- **Widen — scope:** "Medium (3-4 new)" → **4 new placeable families**, one per role.
- **Thread C — wounded behavior:** **"Mix per-archetype"** — bruisers ENRAGE (stand & hit
  harder), ranged/casters KITE (keep range), fragile/support FALL BACK to a guarded room.
- **Thread D — scope:** **"Finals + mid-forms"** — every tier-2 AND tier-3/miniboss form
  that currently has NO ability gets a signature behavior.
- **Same process:** verbatim spec + per-detail checklist + build + headless-verify + sim:soak.

## Ground-truth that shapes the build (verified in code)
- Minion combat abilities are **hard-coded by family-ID Sets** in MinionAbilities.js; the
  `abilities:[]` field in minionTypes.json is always empty. (Thread E moves them to data.)
- A JSON seam already exists: the `lifesteal` **tag** triggers Bloodthirst generically
  (MinionAbilities.js:137). Thread E generalizes that pattern.
- Abilities are **tier-1-only by design** (MinionAbilities.js:79) — so several evolved forms
  are "ability deserts": `skeleton2/3`, `zombie2/3`, `lich2`, `elder_lich` (heal aura keys on
  `lich1` only → the *upgraded* lich stops healing), `mushroom2`, `myconid_stalker`, `imp3`,
  `ent2/3`, and the slime mid/finals (Split keys on `slime1-4` only → the "splits when struck"
  elders **don't actually split**). These are the Thread D targets.
- New minions need **no art** — MinionRenderer falls back to a placeholder rect + sigil
  (MinionRenderer.js:14). Widen = JSON + color + sigil only.
- Build-menu = `unlocks.minionTypes` ∩ chain[0] starters, sorted by `unlockLevel`
  (BuildMenu.js:838; seed in GameState.js:195). New families append to all three.

## Thread E — Data-drive minion abilities (FOUNDATION; build first)
- Add an `abilities: [ {type, trigger, ...params} ]` schema to minionTypes.json, run by a
  data-driven registry in MinionAbilities.js. Triggers: `onHit`, `onDeath`, `onTick`.
- Migrate the **combat** abilities (DoT poison/burn, lifesteal, root, stagger, pickpocket,
  split, aoeOnDeath, staggerCloud, revive, healAura) to JSON descriptors — **behavior-parity
  verified via sim:soak** (no gameplay change from the migration itself).
- Keep purely-spatial **movement behaviors** (hide/ceiling, teleport, scavenger, march,
  demon-sense, camouflage) in code (`tickBehavior`) — that line is deliberate: *combat
  abilities → data, movement AI → code.*
- Keep MINION_ABILITY_INFO tooltip text in sync with the descriptors.

## Thread D — Evolution signatures (finals + mid-forms; authored as E-abilities)
Family-coherent signatures for every ability-less evolved form:
- **Skeleton** (skeleton2 Boneguard, skeleton3 Grave Knight) — **Shieldwall:** reduces damage
  taken by same-room skeletons (formation defense).
- **Zombie** (zombie2 Plague Walker, zombie3 Crypt Lord) — zombie2 **Rotbite** (poison DoT on
  hit, matches "bites carry rot"); zombie3 **Contagion Aura** (same-room advs take periodic poison).
- **Lich** (lich2 Death Acolyte, elder_lich) — extend **Heal Undead** to all lich tiers;
  elder_lich **Raise Dead** (periodically revives one fallen undead minion in-room).
- **Mushroom** (mushroom2 Toxic Cap, myconid_stalker) — **Spore Cloud:** attacks leave a
  lingering poison hazard zone; mushroom2 chance to stagger on hit.
- **Imp** (imp3 Plague Imp) — **Plaguebrand:** poison DoT on hit ("carries every disease").
- **Ent** (ent2, ent3) — extend **Gnarled Hide** (50% physical reduction) to all ent tiers
  (verify ent1's even fires); **Entangle:** chance to root on hit.
- **Slime mid/finals** (slime1,5,6,7,8,9, elder_slime1/2/3) — extend **Split on Death** to ALL
  slime tiers so the elders' "splits when struck" is finally true.
- Minibosses already carrying a family passive (demon_lord, gnoll_alpha, vampire_sovereign,
  beholder_tyrant, golem_warden, serpent_captain, orc_veteran, dark_wraith) keep their inherited
  ability AND now get a bespoke signature **ULT** (DONE 2026-06-10, was optional/stretch): a
  generic `novaBurst` onTick (periodic room AoE + status + optional self-heal + shockwave) drives
  Hellfire Nova / Sanguine Drain / Tyrant's Gaze / Seismic Slam / Venom Storm / Whirlwind / Wail of
  Sorrow; Gnoll Alpha instead leads the pack with a Rally `buffAura`.

## Thread B — Flavor-vs-mechanic audit + wire dead flavor
- **Sorrow Wisp (ghost2)** "drains hope before it drains blood" → **Nerve Drain** on hit
  (reduces the target adventurer's nerve — ties into the new NerveSystem). Keeps possession.
- **Vinekin (plant1)** "slows whatever brushes it" — code only *roots* once; add a genuine
  brief **slow** on hit so the flavor is true (keep the tier-1 snare as its signature).
- **Frost Slime (slime4)** "slows what it touches" → add **slow** on hit.
- **Ent Gnarled Hide** — verify the 50% physical reduction actually fires; wire it if dead.
- Sweep all 64 descriptions for other mismatches; log + fix.

## Thread C — Reactive states (mix per-archetype; MinionAISystem state machine)
- Wounded threshold (~HP < 0.35 maxHp):
  - **Bruiser** (melee/tank, not ranged/caster/support) → **ENRAGE:** +damage (and/or +atk
    speed) while wounded; never abandons post. (Don't double-stack orc Berserker Rage.)
  - **Ranged/caster** (attackRange>1 or caster tag) → **KITE:** step away to keep range when
    an adv closes inside ~2 tiles, still attacking.
  - **Fragile/support** (support category or low-maxHp non-tank) → **FALL BACK:** path to the
    nearest guarded/friendly room and regroup; resume when safe/healed.
- Constraints: **watchdog-exempt** (no hard-stuck/oscillation kill), respects **leashing**
  (garrison stays room-bound), **player-legible** (enrage red glow / kite backstep / fall-back
  move + cue). Stationary minions (ghost/mushroom/lizardman/mimic/plant) exempt from kite/fall-back.

## Widen — 4 new placeable families (3-tier chains; E-abilities; color+sigil render)
1. **Crowd-controller — Webspinner line** (spider; beast/control). **Web:** slow + chance root
   on hit; final tier lays a slowing web hazard zone (area denial).
2. **Commander/buffer — Drillmaster line** (support/commander). **Rally Aura:** buffs nearby
   dungeon minions' ATK/DEF; killing it removes the buff. Hangs back, frail, high-value target.
3. **Summoner — Bone Totem line** (stationary summoner). **Summon:** periodically spawns a
   weak, capped add ("swarmling"); frail, high-value. Needs a minimal non-placeable add type.
4. **Terrain-shaper/debuffer — Rust Gremlin line** (debuffer). **Armor Shred** on hit (reduce
   target defense) + a light **Hazard Trail** (lingering damage zone) as it roams.
- Each: minionTypes (3 tiers) + minionEvolutions chain + unlocks seed + unlockLevel + goldCost
  + tooltip + ability descriptors. New infra as needed: summon cap + lightweight hazard zone.

## Open tunables (decide in sim/preview)
- Wounded threshold + enrage magnitude + kite distance + fall-back trigger.
- Ability magnitudes (slow %, web root chance, rally aura %, summon interval/cap, shred amount,
  hazard DoT) — run sim:balance before claiming balanced.
- Whether the terrain-shaper leans armor-shred vs hazard-trail (infra cost dependent).

---

# Minion Ability Ground-Up Redesign (in progress 2026-06-10)

Supersedes the earlier (wiped) minion ability work. **All minion abilities + base-behavior
quirks were removed to a clean slate** (engine kept: the data-driven ability runner + handler
library + HazardRenderer + CoinBurstRenderer; mimic Devour left as-is). Rebuilding family by
family, discussing each kit with the user before building.

## Locked design principles
- **One mechanic per family; each tier EXPANDS that same mechanic** (never a bolted-on second
  ability). T1 = the mechanic; T2 = a deeper/wider expression of it; T3 (final, also stat-promoted
  to mini-boss) = a climactic ULT of it. Slimes carry a 4th tier.
- **Each ability must shape a distinct strategy / play style** — wide variety, not damage reskins.
- **Every ability needs legible, detailed VFX/animation** so the player sees it fire (reuse
  existing sprites — e.g. the `ui-coin` coin sprite — where they fit).
- **Pricier minions/tiers ⇒ stronger abilities.**
- **UI must always be correct:** construction menu shows the current tier's ability; the UPGRADE
  preview / hover shows the NEXT tier's ability the player will get.
- Minion **names may change** to fit their ability (ids stay fixed to preserve chains/saves).

## Goblin — mechanic: PLUNDER (steal gold)  [LOCKED 2026-06-10]
Identity: the dungeon's gold engine & petty thieves — they don't out-fight heroes, they rob them.
Enables the "goblin gold-rush" build (pack cheap goblins to mint gold every invasion).
- **T1 · Sneak Goblin** (`goblin1`, 8g) — **Pilfer:** every hit instantly banks **+2g** to the
  treasury (no survival condition, no kill-to-deny). VFX: coin pops off the hero (ui-coin burst + "+2g").
- **T2 · Cutpurse** (`goblin2`, rename from Goblin Scrapper) — keeps Pilfer **+ Mark for Plunder:**
  hits **brand** the hero; while branded, **every dungeon minion that hits them also steals gold**
  for you (**+1g/hit**) plus a slow **gold-bleed** off the brand (**+1g / 1.5s**). One goblin makes
  a hero payday for the whole room. VFX: a coin-brand snaps onto the hero (bobbing ui-coin) + gold
  flecks on each ally hit.
- **T3 · Plunder King** (`goblin3`, rename from Warband Boss; final/mini-boss) — keeps Pilfer + Mark,
  adds **Warband's Cut** (passive: **all goblin plunder in its room is DOUBLED**) + **Grand Heist**
  (ult, ~every 8s: **brands every hero in its room** for 6s — mass Mark for Plunder). VFX: golden
  warhorn shock-ring, a coin-brand snaps onto every hero, coin rain as minions swing.
- Arc: steal from one hero → mark one hero for the team → mark the whole party + double the take.

## Skeleton — mechanic: REASSEMBLY ("they don't stay dead")  [LOCKED 2026-06-10]
Identity: the attrition wall — the opposite pole to the Goblin's smash-and-grab on the treasury.
Skeletons make the party pay twice: spend HP, time, and cooldowns killing the same bones again.
Enables a chokepoint-stall build. Reassembly is **unconditional** (the fire-deny-reassembly hook
was dropped when elemental vulnerabilities were removed 2026-06-10).
- **T1 · Risen Bones** (`skeleton1`, 10g) — **Reassemble:** on death it collapses into a bone pile
  instead of dying; after ~3s it clatters back together at **50% HP**, **once**. The party must kill
  it twice. VFX: bones scatter → pile rattles → fragments spiral upward → necrotic flash → it stands.
- **T2 · Boneguard** (`skeleton2`) — same mechanic, harder to keep down: reassembles **up to 2×**, and
  **each** rise it returns sheathed in a **bone-armor shell** (temporary damage-reduction that decays)
  and flings a **ring of bone shards** outward (chip damage to adjacent heroes). "The more you break
  it, the angrier it gets." VFX: reknit + plating shimmer + shard-ring burst; eye-glow white→amber.
- **T3 · Grave Knight** (`skeleton3`; final/mini-boss) — keeps Reassemble, adds **Undying Legion**
  (ult): it plants its sword and fires a **necrotic pulse** — **every fallen bone-pile in range erupts
  back to its feet**, and for the ult window the Knight itself **revives almost instantly** when downed
  (a near-unkillable window). A "cleared" room becomes a full fight again. VFX: sword slam → green-white
  death-pulse ring → bone piles geyser into skeletons → shared aura links the risen → roar.
- Arc: get back up once → get back up twice, armored & spiteful → raise the whole graveyard and refuse
  to stay down.

## Orc — mechanic: BLOODLUST ("the longer they fight, the harder they hit")  [LOCKED 2026-06-10]
Identity: the offensive-tempo bruisers — third archetype after Goblin (economy) and Skeleton (defense).
They get STRONGER the longer a fight drags; enables an aggressive "feed them a sustained brawl"
build that snowballs into a wipe threat. **Bloodlust stacks build PER HIT LANDED** (locked — most
legible / rewards staying in the fight) and decay out of combat.
- **T1 · Orc Marauder** (`orc1`, 12g) — **Bloodlust:** each hit it lands adds a stack (+ATK per stack,
  up to a cap); stacks decay when it's out of combat. A lone brawler that ramps. VFX: a low blood-mist
  aura that thickens + rises redder as stacks climb (roiling, NOT a ring); a red claw-slash flash per
  stack; a roar + screen-shake at max stacks.
- **T2 · Warlord Orc** (`orc2`) — keeps Bloodlust **+ War Cry:** periodically shouts, granting Bloodlust
  stacks to **every orc in the room** (the whole pack ramps together). VFX: a sound-wave shout — expanding
  chevron/arc bands sweeping outward (megaphone cone) + screen-shake; each affected orc flashes red with a
  small "↑RAGE" tick.
- **T3 · Orc Veteran** (`orc_veteran`; final/mini-boss) — keeps Bloodlust + War Cry, adds **Warpath**
  (ult): instantly maxes its OWN + the warband's Bloodlust and enters a **Rampage** (big ATK/speed surge,
  bulldozes/cleaves) for a window. VFX: a Warstomp ground-crack + dust ring, a towering blood-red aura
  column, motion-streak charge trails, heavy screen-shake, a war-skull glyph rising.
- Arc: one orc ramps itself → the Warlord ramps the pack → the Veteran maxes everyone and goes on a rampage.
- New reusable `AbilityVfx` primitives added for this (variety mandate): `furyAura`, `soundWave`,
  `groundCrack`, `streakDash`, `screenShake` — deliberately non-ring looks.

## Slime — THREE distinct 4-tier chains (the only 4-tier minions)  [LOCKED 2026-06-10] · ✅ ALL 3 CHAINS BUILT 2026-06-11
Slimes are 3 separate buildable chains, each its own mechanic/strategy (all "ooze"-flavored). Pricier
root = stronger kit. Tier names reflavored coherently (the old mixed-element names were a grab-bag).
Build one chain at a time (Splitter → Plague → Corrosive), verifying each. Each gets its own detailed,
distinct gooey VFX (to the detail bar — see [[feedback_vfx_variety_mandate]]).
Verified: headless `slime-{split,plague,corrosive}-check.mjs` all green + soak 120/120 clean + in-lab.

### Splitter (ids `slime2`→`slime9`→`slime1`→`elder_slime2`; root 6g, day 1) — mechanic: SPLIT
The classic. Cheap, multiplies — kill it and it becomes two. Strategy: overwhelm with bodies, tie up
and soak the party.
- **T1 Slime** (`slime2`) — splits into 2 weak slimelings on death.
- **T2 Splitter Slime** (`slime9`) — splits on death **+ buds off a slimeling when it takes a big hit**.
- **T3 Brood Slime** (`slime1`) — splits into 3 on death, and the slimelings can split once themselves
  (cascading division).
- **T4 The Endless** (`elder_slime2`; mini-boss ULT) — **Mitosis Storm:** constantly buds slimelings on a
  timer + erupts a big batch on death. A slime tide.
- VFX: wet blob that stretches & pinches apart with a gooey splat + jiggle.

### Plague (ids `slime3`→`slime7`→`slime8`→`elder_slime1`; root 10g, day 3) — mechanic: CONTAGION
Infect the party; the poison jumps hero to hero. Strategy: spreading DoT attrition — the more they
cluster, the worse.
- **T1 Toxic Slime** (`slime3`) — hits apply a stacking poison DoT.
- **T2 Plague Slime** (`slime7`) — infected heroes **spread** the poison to nearby allies (it jumps).
- **T3 Pestilent Slime** (`slime8`) — stronger DoT, spreads farther/faster + infected heroes leave a
  brief toxic trail.
- **T4 Pandemic** (`elder_slime1`; mini-boss ULT) — **Outbreak:** periodically infects everyone in the
  room at once + contagion turns virulent.
- VFX: sickly green-purple miasma + contagion tendrils linking infected heroes + a plague cloud.

### Corrosive (ids `slime4`→`slime5`→`slime6`→`elder_slime3`; root 12g, day 5) — mechanic: ACID PUDDLES
Melts the floor — lay caustic puddles that damage + slow whoever stands in them. Strategy: zone control,
shape the room into a hazard maze. Reuses the existing hazard-zone engine (`_hazardTrail`/`tickHazards`).
- **T1 Acid Slime** (`slime4`) — leaves a caustic puddle where it dies.
- **T2 Caustic Slime** (`slime5`) — leaves an acid **trail as it moves** (paints corridors).
- **T3 Corrosive Ooze** (`slime6`) — bigger/longer puddles + standing in them **melts armor** (def shred)
  + slows.
- **T4 The Dissolving** (`elder_slime3`; mini-boss ULT) — **Acid Flood:** periodically floods its whole
  room with acid for a window — total floor denial.
- VFX: bubbling yellow-green acid puddles with hissing sizzle + drips.
- **Puddles PERSIST for the whole raid** (don't fade on a timer); cleared at day-end (`Game._onDayEnded`
  wipes `dungeon.hazards`). Capped at 60 acid zones (oldest dissolve first) so a roaming Caustic Slime
  can't carpet the room. Puddle **size scales with tier** (`radiusTiles` 1.0→1.9; `acidSplash` scales to it).
  The Acid Flood pulse stays timed (it re-floods on its own cadence).
- **Acid Flood VFX = `acidFloodFx`** (rebuilt 2026-06-11 — was a generic ring): an irregular lobed acid
  SHEET floods the floor (foaming jagged rim) + a wave of erupting `acidGeyser` columns sweeping outward +
  steam + green room-tint. Plague/acid VFX also de-circled (`_drawMiasmaPuff` lumpy cloud puffs,
  `_drawAcidBlob` lobed pools). No ring/circle hero shapes anywhere in the slime kit.

## Vampire — mechanic: LIFE DRAIN ("you can't out-damage it")  [LOCKED 2026-06-11]
Chain `vampire_minion1` → `vampire_minion2` → `vampire_sovereign` (root 18g, day 9; final = mini-boss
ULT). ONE mechanic: it heals off the life it takes, and each tier converts drained blood into more
staying power. Strategy: an ATTRITION WALL — the party must BURST it down fast or it heals through
everything (counter = focus-fire / front-load damage). Distinct from Goblin (economy) / Skeleton (revive)
/ Orc (offense) / Slime (zoning).
- **T1 Vampire Spawn** (`vampire_minion1`) — **Lifesteal:** heals a % of the damage it deals on every
  hit. Outlasts a slow fight.
- **T2 Vampire Thrall** (`vampire_minion2`) — **Bloodgorge:** stronger lifesteal, and healing PAST full
  HP banks as a temporary **blood-shield** (overheal → absorb, capped at a fraction of maxHP, decays out
  of combat). The longer it drains, the tankier it gets.
- **T3 Vampire Sovereign** (`vampire_sovereign`; mini-boss ULT) — **Blood Feast:** periodically siphons HP
  from EVERY adventurer in the room at once, healing itself to overflow (big blood-shield) + topping up
  nearby vampire-kin. Single-target drain → the whole party bleeds for it.
- VFX (concept-first, no rings): **bloodThread** (lifesteal — a crimson ribbon whips off the bitten hero
  + fang-mark, reels into the vampire), **bloodShieldFx** (lumpy blood-platelet husk that thickens with
  overheal, sheds shards when hit), **bloodFeastFx** (threads lash to ALL heroes then reel inward to a
  rising blood-geyser column at the vampire — converging inward, the opposite of an expanding ring).

### Vampire acceptance checklist — ✅ ALL BUILT + VERIFIED 2026-06-11
- ✅ T1 lifesteal heals attacker by `frac` of damage dealt (existing `lifesteal` type) + fires bloodThread
- ✅ T2 lifesteal `overheal:true` banks excess heal into `_bloodShield` (cap `shieldFracMax`×maxHP)
- ✅ `_bloodShield` ABSORBS damage before HP (CombatSystem:339 `absorbBloodShield`) + sheds-shard VFX
- ✅ `_bloodShield` DECAYS over time (tickVampire, wired MinionAISystem); cleared at dawn; stripped in SaveSystem
- ✅ T3 bloodFeast onTick drains every adv in room, heals self→overflow shield + tops vampire-kin
- ✅ bloodThread / bloodShieldFx / bloodShieldHit / bloodFeastFx built to the detail bar, lint-vfx clean, in gallery
- ✅ MINION_ABILITY_INFO text for all 3 tiers (current + next-tier shown in UI)
- ✅ headless `vampire-drain-check.mjs` 15/15 · soak 120/120 clean · verified in lab

## Rat — mechanic: SWARM ("strength in numbers")  [LOCKED 2026-06-11]
Chain `rat1` → `rat2` → `rat3` (root 6g, day 1; cheap/fast/low-HP beasts). ONE mechanic: *the pack
empowers each rat by its size* — only swarm-rats in the SAME room count (via a `swarm` ability marker),
so it won't free-ride on unrelated minions. Strategy: cheap board-flooding swarm, only scary while
clustered — the counter is AoE/cleave to thin the pack (distinct from slime, which SPAWNS more bodies).
- **T1 Plague Rat** (`rat1`) — **Swarm:** +atk for each other swarm-rat in its room (capped). Pathetic
  alone, dangerous in a pack.
- **T2 Sewer Skitterer** (`rat2`) — **Pack Tactics:** steeper atk-per-rat **+ Pack Armor** — clustered
  rats also take LESS damage per pack member (so cleaving them apart, dropping the count, is the counter).
- **T3 Dire Vermin** (`rat3`; final ULT) — **Vermin Tide:** periodically whips EVERY rat in the room into
  a frenzy — max swarm bonus (atk + DR) + a speed surge for a window, the whole pack a devouring tide.
- Engine (reuses the bloodlust/rampage pattern): `swarmAtkMul(minion,scene,gs)` read in CombatSystem +
  `swarmDrMul` folded into `damageTakenMul`; both count living swarm-rats in the room (`_swarmCount`).
  Vermin Tide sets `_swarmFrenzyUntil` on all room rats (forces max stacks) + a speed surge restored by
  `tickRat`. Dawn-reset + SaveSystem-stripped.
- VFX (concept-first, no rings): `_drawRat` tiny shaded rat-silhouette → **swarmBiteFx** (on a packed hit,
  a few rats skitter in + a bite-chomp + kicked grime, more rats the bigger the pack) + **verminTideFx**
  (the ult — a tide of scurrying rat-silhouettes floods outward + dust wave + red frenzy glints).

### Rat acceptance checklist — ✅ ALL BUILT + VERIFIED 2026-06-11
- ✅ T1 `swarm` onHit ability: `swarmAtkMul` gives +atk per OTHER swarm-rat in room (capped), read in CombatSystem
- ✅ swarm counts ONLY living swarm-rats in the same room (`_swarmCount` via the `swarm` ability marker)
- ✅ T2 Pack Armor: `swarmDrMul` reduces damage per pack member (floored at 0.35), via `damageTakenMul`
- ✅ T3 Vermin Tide onTick: frenzy all room rats (`_swarmFrenzyUntil` → max stacks for atk+DR) + speed surge; `tickRat` restores speed; dawn-reset + SaveSystem strip
- ✅ swarmBiteFx (scaled by pack count) on a packed hit + verminTideFx on the ult — `_drawRat` silhouette, lint-vfx clean, in gallery+lab; VERIFIED on-screen (legible brown rat silhouettes skitter in / pour outward, no rings)
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `rat-swarm-check.mjs` 16/16 · soak 120/120 clean · verified in lab

## Zombie — mechanic: RAISE THE DEAD ("the outbreak turns your kills into your army")  [LOCKED 2026-06-11]
Chain `zombie1` → `zombie2` → `zombie3` (root 8g, day 2; slow relentless undead). ONE mechanic: zombies
convert slain heroes into more zombies (a snowball). Strategy: kill the party and the dead JOIN your horde
— counter is to kill fast / not let the horde build. Distinct from Skeleton (self-revive), Slime (self-copy),
Rat (count-buff).
- **T1 Shambler** (`zombie1`) — **Reanimate:** a hero this zombie lands the killing blow on rises as a weak
  **Risen** zombie under your control (room-capped, sterile so no recursion). Slow but relentless.
- **T2 Plague Walker** (`zombie2`) — **Contagion Bite:** its bites INFECT heroes with rot; an infected hero
  that dies to ANYTHING (trap/boss/other minion) rises as a zombie — spreads the reanimate trigger to the
  whole party.
- **T3 Crypt Lord** (`zombie3`; final ULT) — **Mass Grave:** periodically claws the room's fallen back up at
  once (raise a batch from the run graveyard) + a room-wide rot infection. The outbreak peaks.
- Engine: subscribe `ADVENTURER_DIED` (`{adventurer,killerId,roomId}`) → `MinionAbilities.onAdventurerDied`:
  raise if the killer is a non-raised `reanimate`-zombie (T1) OR the hero was `_rotInfected` (T2). `_raiseZombie`
  reuses the slime-split runtime-spawn pattern (a weak zombie1-stat minion, `class:'garrison'`, `_raisedZombie`
  → wiped each dawn via `isPermadeadAtDawn`, sterile = no reanimate/contagion, room-capped `ZOMBIE_ROOM_CAP`).
  `rotBite` onHit sets `_rotInfectedUntil`. `_massGrave` onTick raises a batch from the graveyard + room-infects.
- VFX (concept-first, no rings): `_drawClawHand` rotten grasping-hand silhouette → **reanimateFx** (clawing
  hands burst from the ground + grave-dirt + sickly green-brown necrotic mist as the corpse jerks upright) +
  **massGraveFx** (hand-bursts erupt across the room + a necrotic ground pall). Rot infect = a small rot wisp.

### Zombie acceptance checklist — ✅ BUILT + verified 2026-06-11 (⚠ in-lab visual pending preview reopen)
- ✅ T1 Reanimate: a hero killed by a (non-raised) `reanimate`-zombie rises as a Risen zombie (room-capped, sterile)
- ✅ T2 Contagion Bite (`rotBite` onHit): infected hero that dies to ANY source rises (`onAdventurerDied` checks `_rotInfectedUntil`)
- ✅ Raised zombies are sterile (no recursion) + `class:'garrison'` + wiped each dawn (`isPermadeadAtDawn` `_raisedZombie`)
- ✅ T3 Mass Grave onTick: raise a batch from the run graveyard (each corpse once) + room-wide rot infect
- ✅ `ADVENTURER_DIED` subscribed in MinionAISystem (unsub in destroy — EventBus-leak gotcha); adv `_rotInfectedUntil` SaveSystem-stripped
- ✅ reanimateFx — green necrotic upwelling (grave-crack + green energy wells up + mist; clawing-hands REMOVED per user, `_drawClawHand` deleted) + rot burst — lint-vfx clean, in gallery+lab
- ✅ massGraveFx — final = TOMBSTONES IN A RING (v1 scattered hands + v2 fissure/climbing-corpses rejected as messy; v3 straight row → user wanted a circle): grey gravestones (`_drawTombstone`) thrust up in an evenly-spaced ELLIPSE ring around the crypt at a distance (squashed for floor perspective, front stones bigger + drawn over back ones), each with a green necrotic glow + rising soul-wisp + earth-kick, over a faint pall. Tuned (user): slower (durationMs 2600 + longer hold), BIGGER stones (sS base 7.4), ring a bit CLOSER (rx halfW×0.55). VERIFIED on-screen (clean ring encircling the sprite).
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `zombie-raise-check.mjs` 18/18 · soak 120/120 clean · VFX verified in lab

## Demon — mechanic: HELLFIRE / IMMOLATION ("a walking bonfire")  [LOCKED 2026-06-11]
Chain `demon1` → `demon2` → `demon_lord` (root 26g, day 13; premium hard-hitting fire elites). ONE mechanic:
escalating HELLFIRE heat — the demon radiates a burn aura that stacks heat on nearby heroes (more heat =
more burn); back off and it cools. Strategy: you can't fight it up close — burst from range or it cooks the
party. Distinct from slime-acid (floor zones + armor-melt) — this is a damaging heat AURA + escalating burn.
- **T1 Brimstone Fiend** (`demon1`) — **Burning Aura:** heroes within ~2.5 tiles take fire damage each second
  that ESCALATES with a per-hero Hellfire stack (builds while close `_hellfireStacks`, cools via `tickDemon`).
- **T2 Hellforged Reaper** (`demon2`) — bigger/hotter aura **+ Combustion:** a hero whose heat hits MAX
  COMBUSTS — a fire blast damaging nearby heroes, then their heat resets (punishes clustering, chains a packed party).
- **T3 Demon Lord** (`demon_lord`; final ULT) — **Inferno:** periodically erupts the whole room into hellfire —
  max heat on everyone + a big fire AoE.
- Engine: `_burningAura` onTick (damage + stack, `combust` flag detonates at maxStacks via `_combust`), `tickDemon`
  decays stale `_hellfireStacks` (wired MinionAISystem), `_inferno` onTick ult. adv `_hellfireStacks/_hellfireAt`
  SaveSystem-stripped. VFX (reuse `_drawFlameTongue`): `hellfireAuraFx` (roiling flame-tongues + embers around the
  demon), small flame-lick per burning hero, `combustFx` (flame burst out), `infernoFx` (staggered fire bursts
  across the room + ember rain + heat wash).

### Demon acceptance checklist — ✅ BUILT + verified 2026-06-11 (⚠ in-lab visual pending preview reopen)
- ✅ T1 `burningAura` onTick: heroes in radius take fire dmg escalating with `_hellfireStacks` (build in aura), far heroes safe
- ✅ `tickDemon` decays `_hellfireStacks` when a hero leaves the aura (cools, wired MinionAISystem); SaveSystem strips `_hellfire*`
- ✅ T2 `combust:true`: a hero at maxStacks detonates (`_combust` AoE fire to nearby heroes, splash heat) + heat resets
- ✅ T3 `inferno` onTick: room-wide fire AoE + maxes everyone's heat
- ✅ hellfireAuraFx + combustFx + infernoFx — built from `flameLickFx` (animated flickering flame, `_drawFlame` teardrop; NOT static spikes/worms) + ORGANIC fields (irregular layered breathing heat-glow aura, soft lobed heat pall for inferno — NOT a flat oval / square). Burn DoT rides in front of heroes (depth fix). lint-vfx clean, in gallery+lab. VERIFIED + user-approved on-screen.
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `demon-hellfire-check.mjs` 15/15 · soak 120/120 clean · VFX verified + approved in lab

## Golem — mechanic: FORTRESS / BULWARK ("an immovable protector wall")  [LOCKED 2026-06-11]
Chain `golem1` → `golem2` → `golem_warden` (root 30g, day 14; huge-HP, crawling-slow constructs). ONE
mechanic: DAMAGE MITIGATION, scope widening per tier (self → allies → room). Strategy: a literal wall —
break the golem first or you make no progress on anything behind it. Distinct ROLE (no protector family).
- **T1 Stone Sentinel** (`golem1`) — **Bulwark:** takes heavily reduced damage (`damageReduction` passive,
  read in `damageTakenMul`). A slow immovable wall.
- **T2 Iron Behemoth** (`golem2`) — bigger self-DR **+ Aegis aura:** allied minions within ~2.5 tiles take
  reduced damage too (`aegis` passive; `aegisMul` folded into `damageTakenMul` — strongest nearby guardian wins).
- **T3 Golem Warden** (`golem_warden`; final ULT) — **Bastion:** periodically raises a stone bastion — a big
  DR spike on itself AND every allied minion in the room for a window (`_bastionUntil/_bastionMul`).
- Engine: self-DR via the existing `damageReduction` ability; `aegisMul(target,scene,gs)` + the bastion-window
  read added to `damageTakenMul`; `_bastion` onTick stamps `_bastionUntil/_bastionMul` on all room allies
  (dawn-reset + SaveSystem strip). Per-hit `bulwarkFx` fired from CombatSystem when a `construct` soaks a DR'd hit.
- VFX (organic, no hard shapes/rings — NEW `_drawRockShard` jagged stone helper): `bulwarkFx` (stone chips fly
  off + dust when the golem soaks a hit), `bastionFx` (rough stone slabs HEAVE up from the ground in a ring
  forming a jagged rampart + earthen ground-glow + dust — the earth rising into a fortress).

### Golem acceptance checklist — ✅ BUILT + verified on-screen 2026-06-11
- ✅ T1 `damageReduction` passive reduces the golem's damage taken (via `damageTakenMul`)
- ✅ T2 `aegis`: `aegisMul` reduces damage for allied minions within radius of the guardian (strongest wins); not for far/enemy
- ✅ T3 `bastion` onTick: DR spike (`_bastionUntil/_bastionMul`) on self + ALL room allies for the window; read in `damageTakenMul`; dawn-reset + SaveSystem strip
- ✅ `bulwarkFx` fires from CombatSystem when a construct soaks a DR'd hit; `bastionFx` on the ult
- ✅ VFX organic + INNOVATIVE — Bastion reworked from ring-of-slabs (user: "you keep doing a graphic in a circle around the sprite") into **Stone Carapace**: `_drawRockShard` plates fly INWARD and CLAMP onto anatomical body slots (helm/pauldrons/chest/vambraces/greaves) sheathing the golem in stone + a petrify pulse + per-ally `_hardenFlashFx`. Converge-and-lock ON the unit — opposite of the erupt-outward ult pattern. lint-vfx clean, in gallery+lab. **✅ VERIFIED ON-SCREEN** (zoom 4.2 on a spawned golem_warden — plates clamp onto the sprite body)
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `golem-bulwark-check.mjs` 13/13 · soak 120/120 clean · ✅ on-sprite screenshot verified

## Ghost — mechanic: FEAR ("win by breaking morale, not HP")  [LOCKED 2026-06-11]
Chain `ghost1` → `ghost2` → `dark_wraith`. ONE mechanic: NERVE WARFARE — drain the adventurers' courage
(`adv.nerve` 0–100 → bands → `_checkMoraleBreak`, which already routs any `breaking`-band adv under pressure;
a nearby ghost IS that pressure). Scope/depth widens per tier: bite → sticky+spreading affliction → mass rout.
Strategy: ghosts don't out-muscle — they erode resolve; stack them to push the party to Breaking, then let your
traps/killzones punish the rout. The ONLY family that attacks the mind. ghost2 (Sorrow Wisp) becomes a buyable T2.
- **T1 Restless Wraith** (`ghost1`) — **Dread:** psychic attacks frighten as they wound — every hit drains the
  target's NERVE (`fear` onHit, on top of HP), and lingering near it bleeds nerve faster than an ordinary threat
  (`dreadAura` onTick presence). Softens the party's resolve.
- **T2 Sorrow Wisp** (`ghost2`) — **Haunt** (deepens fear into a sticky, spreading affliction): a hit HAUNTS the
  target — for a window their nerve keeps bleeding and CANNOT recover; a haunted adv who is already Spooked/Breaking
  FIGHTS WORSE (reduced attack via `_computeDamage`); and panic is CONTAGIOUS (a haunted adv leaks dread to nearby
  party-mates each tick). Keeps the T1 fear-on-hit + dread presence.
- **T3 Dark Wraith** (`dark_wraith`; final ULT) — **Pall of Dread:** the sovereign throws up a shroud and craters
  the NERVE of every adventurer in the room (slams them toward Breaking, `nerveFloor`), forcing a MASS ROUT — the
  advancing party turns and flees (via the existing morale-break path). Keeps fear + haunt + dread presence.
- Engine: `_applyFear(adv, amount, scene)` clamps `adv.nerve` + updates `adv.mood` band + emits `NERVE_BAND_CHANGED`
  (precedent: AISystem already writes nerve for beats). `case 'fear'`/`'haunt'` onHit; `case 'dreadAura'`/`'pallOfDread'`
  onTick (interval-gated by `tickAbilities`); `tickGhost(scene,gs,delta)` drains haunted advs + contagion + expires
  haunt (wired MinionAISystem); NerveSystem suppresses safe-recovery while `_hauntedUntil`; `fearAtkMul(attacker,now)`
  read in `_computeDamage` for the haunted-fumble; SaveSystem strips `_haunted*`/`_hauntNervePerSec`/etc.
- VFX (organic, NON-RING composition — varied per the gate): `fearStrikeFx` (a spectral wail-FACE lunges from the
  ghost into the target + the TARGET blanches/desaturates with a fright-mark — on-the-unit); `dreadMistFx` (a low cold
  mist that TENDRILS toward nearby advs — directional reach, not a ring); `hauntCloakFx` (a translucent ghost-face
  CLINGS to / orbits the haunted adv — sticky, on-the-unit); `pallOfDreadFx` (a gloom shroud DESCENDS over the room
  from above, desaturating, while wailing wisps STREAK through and each adv recoils with a terror-mark — descend +
  streak + per-unit reaction, NOT a ring of objects).

### Ghost acceptance checklist — ✅ BUILT + verified 2026-06-11 (⚠ on-screen VFX capture pending live preview)
- ✅ T1 `fear` onHit drains the struck adv's nerve + updates mood band; `dreadAura` onTick bleeds nerve off advs in radius (not far/non-adv)
- ✅ T2 `haunt` onHit sets `_hauntedUntil` + params; `tickGhost` drains haunted nerve over the window, expires cleanly
- ✅ T2 haunted adv can't safe-recover nerve (NerveSystem suppression while `_hauntedUntil`)
- ✅ T2 haunted adv in Spooked/Breaking deals reduced damage (`fearAtkMul` in `_computeDamage`); normal adv unaffected
- ✅ T2 contagion: a haunted adv bleeds a little nerve off nearby party-mates each tick
- ✅ T3 `pallOfDread` onTick craters every room adv's nerve toward `nerveFloor` → they rout (existing morale-break)
- ✅ ghost2 buyable (unlockLevel 14, goldCost 36); dark_wraith stays miniboss
- ✅ VFX organic + NON-RING (wail-face/blanch · mist tendrils · clinging cloak · descending shroud), lint-vfx clean, in gallery+lab. ⚠ ON-SCREEN capture pending (preview loop throttled / boot-wedged during this build)
- ✅ MINION_ABILITY_INFO text for all 3 tiers (current + next-tier reads)
- ✅ headless `ghost-fear-check.mjs` 24/24 · soak 120/120 clean · SaveSystem strips transient fields

## Nerve → PLAYER-POSITIVE rework (Ghost follow-up)  [LOCKED 2026-06-11]
**Problem (user):** "adventurers fleeing the dungeon due to nerve is bad for the player because they lose out
on a kill, xp, gold, and the adventurer spreads knowledge. so we need to make high nerve benefit the player."
**Principle:** the player IS the dungeon — every adventurer mind-state must cash out as a KILL for the player.
Nerve currently has only a player-NEGATIVE tail (flee = the one outcome that denies kill+xp+gold+seals no knowledge
leak). Rework so BOTH ends feed the player kills; only the calm middle is "safe" for the adventurer. User picked
all 4 (verbatim selections):
1. **"Fear = panic in place"** (RECOMMENDED core fix) — low nerve no longer routes heroes out. Terror makes them
   freeze/cower, drop their guard (take MORE damage), and fumble attacks: a helpless easy kill pinned in your
   killzone. The Ghost family delivers kills, not escapes.
2. **"Bold = reckless (high-nerve payoff)"** — overconfident heroes overextend: rush deeper, split from the group,
   ignore traps, fight on while wounded → they die more. Player can win by baiting heroes bold.
3. **"Punish the rare true flee"** — keep a real break possible for drama but make it player-positive: a routed
   hero drops gold in panic and runs exposed/unable to fight back through your dungeon (traps + minions cut most
   down); any escapee spreads PANIC (weakens the next wave's starting nerve), not useful intel.
4. **"also probably need a vfx animation to show the nerve levels of adventurers when they are panicking"** — a
   readable panic-state visual on cowering heroes (tremble / sweat / terror emote) so the player can SEE the fear.

### Implementation map (build in verifiable pieces)
- **A · Panic-in-place** — new `_panickedUntil` status. `AISystem._checkMoraleBreak`: breaking-band + pressure now
  SETS panic (refreshed while the condition holds) instead of `_setFleeGoal('morale_break')`. While panicked: hero
  COWERS (no advance, no attack — gate movement + `tryAttack`), is VULNERABLE (CombatSystem: incoming dmg ×panicVuln
  ~1.5), and fumbles. Snaps out when nerve recovers above Breaking. SaveSystem-strip `_panicked*`.
- **B · Bold = reckless** — at the BOLD band (>80): suppress the low-HP retreat (fight to the death) + ignore
  trap-caution routing (path through known-trapped rooms). Both = "they die more."
- **C · Punish true flee** — on a genuine flee-start (low-HP retreat of a non-bold hero, scripted breaks): credit
  the player a "panic-dropped gold" sum + VFX; fleeing hero is vulnerable (reuse panicVuln) + can't fight; on actual
  ESCAPE, lower next wave's nerve baseline (panic-spread) and suppress that escapee's intel contribution.
- **D · Panic VFX** — `panicStateFx` (tremble shudder + sweat-flick droplets + a terror emote / fright-mark), shown
  on panicked heroes (driven from the panic tick or a StatusVfx-style tracker). Reuses `_drawFrightMark`.
- **E · Ghost ult reframe** — "Pall of Dread" mass-rout → **mass PANIC** (craters nerve → the room panics in place =
  mass slaughter, not mass flee). Update MINION_ABILITY_INFO/flavor; the `pallOfDreadFx` apparition still fits.

### Nerve-rework acceptance checklist — ✅ BUILT + verified 2026-06-11 (⚠ on-screen VFX pending live preview; intel-suppression deferred)
- ✅ A: breaking+pressure sets `_panickedUntil` (NOT flee, in `_checkMoraleBreak`); panicked hero COWERS (early-return freeze gate in `_tickAdventurer`, watchdog-exempt) + can't attack (CombatSystem gate) + takes ×1.5 damage; lapses on recovery; SaveSystem strips `_panickedUntil/_panicVfxAt/_breakingMs`
- ✅ B: BOLD hero skips low-HP retreat (`_checkFleeTrigger` early-out) + ignores trap/minion-room caution routing (`reckless` disables `useKnowledgeCost` in `_replan`)
- ✅ C: genuine flee drops gold to the player (`_setFleeGoal`, once per hero) + fleeing hero is vulnerable (×1.5) + can't-fight (CombatSystem gates); an ESCAPEE raises `_guildPanic` → NerveSystem `_seed` lowers next-wave nerve, decays nightly. ⚠ **intel-suppression DEFERRED** — left the existing intel-leak intact (gutting it destabilises the knowledge-escalation + leaderboard leak stats); the panic-spread is the additive player-positive half. Ask user whether to also reduce/suppress escapee intel.
- ✅ D: `panicStateFx` (sweat beads + head-tremble jitter + terror emote, organic non-ring), fired on a cadence from `_checkMoraleBreak`; in gallery+lab; lint-vfx clean. ⚠ ON-SCREEN capture pending (preview throttled/wedged during build)
- ✅ E: Pall of Dread = mass PANIC-in-place (`_pallOfDread` seeds `_panickedUntil` on victims + craters nerve; text reframed to "freeze/panic", not "rout"); ghost kit still 24/24
- ✅ headless `nerve-rework-check.mjs` 17/17 · ghost 24/24 · lint-vfx/lint-content/verify-docs clean · soak 120/120 clean

## Beholder — mechanic: GAZE / DOMINATION ("the eye that seizes control")  [LOCKED 2026-06-11]
Chain `beholder1` Watcher Eye → `beholder2` Tendril Seer (made buyable T2) → `beholder_tyrant` Beholder Tyrant
(T3 miniboss ULT). ONE mechanic: the gaze SEIZES CONTROL of heroes, escalating one → several → total. Fully
player-positive (charmed heroes kill each other; petrified heroes are sitting ducks — nothing escapes). The only
ranged mind-control / hard-control family. User-locked: T1/T2 = DOMINATION (charm, "turn the party against itself");
T3 = Tyrant's Glare (petrify + hex), kept from the first pitch. Reuses existing engine: `_possessedUntil` +
`maybeRedirectPossessedAttack` (already wired in CombatSystem.tryAttack), `_petrifiedUntil` (hook + hard-stuck
exemption already present), `_slowUntil/_slowMult`.
- **T1 Watcher Eye** (`beholder1`) — **Mesmerize:** its gaze-ray CHARMS the struck hero (`mesmerize` onHit →
  `_possessedUntil`) — for a few seconds they attack their OWN nearest ally. One eye, one traitor. (Gets a real
  attackRange — a floating gaze sentry, not a melee.)
- **T2 Tendril Seer** (`beholder2`) — **Mass Hypnosis:** keeps the on-hit charm + a periodic eyestalk VOLLEY
  (`massHypnosis` onTick) that charms SEVERAL nearest room heroes at once → a chunk of the party turns on each other.
- **T3 Beholder Tyrant** (`beholder_tyrant`; final ULT) — **Tyrant's Glare:** the great central eye sweeps the room —
  every hero is PETRIFIED (`_petrifiedUntil` freeze: can't move or act) AND deep-HEXED (`_hexUntil/_hexVulnMul`,
  heavy +damage-taken) for a window. A room frozen solid + softened = free massacre.
- Engine: `case 'mesmerize'` onHit (set `_possessedUntil` + mesmerizeFx); `_massHypnosis` onTick (charm N nearest
  room heroes); `_tyrantGlare` onTick (petrify + hex all room heroes); `gazeHexMul(target,now)` read in
  `_computeDamage`; AISystem petrify freeze gate reading `_petrifiedUntil` (next to the panic gate, watchdog-exempt);
  CombatSystem attack-gate extended so a petrified hero can't swing; SaveSystem strips `_possessedUntil/_petrifiedUntil/_hexUntil/_hexVulnMul`.
- VFX (organic, non-ring; deliberately distinct from the ghost's PALE hollow eyes): NEW `_drawBeholderEye` (a FLESHY
  bloodshot eye — sclera + coloured dilating iris/pupil + veins) and `_drawStoneCrust`. `mesmerizeFx` (the eye glares +
  a wavering iris-textured GAZE-RAY lances to the hero + a hypnotic SWIRL spins over the charmed head), `manyEyesFx`
  (a FAN of gaze-rays to several heroes), `tyrantGlareFx` (the giant central eye OPENS + per-hero STONE CRUST crackles
  over them + grey-out — not a ring, not the ghost pall).

### Beholder acceptance checklist — ✅ BUILT + verified 2026-06-11 (⚠ on-screen VFX pending live preview)
- ✅ T1 `mesmerize` onHit charms the struck hero (`_possessedUntil`) → swing redirects to a same-party ally (`maybeRedirectPossessedAttack`); beholder1 got attackRange 4
- ✅ T2 `massHypnosis` onTick charms the N nearest room heroes at once (+ keeps the on-hit charm)
- ✅ T3 `tyrantGlare` onTick PETRIFIES (`_petrifiedUntil` freeze: no move/attack) + HEXES (`_hexUntil/_hexVulnMul`) every room hero; `_canControl` immunities (barbarian/scripted/already-charmed)
- ✅ AISystem petrify freeze gate (`_petrifiedUntil`, folded into the panic gate + watchdog-exempt); CombatSystem petrified-can't-attack; `gazeHexMul` in `_computeDamage`; SaveSystem strips `_possessedUntil/_hexUntil/_hexVulnMul` (`_petrifiedUntil` already stripped)
- ✅ beholder2 buyable (unlock 16, goldCost 38); beholder_tyrant stays miniboss
- ✅ VFX organic + NON-RING — NEW `_drawBeholderEye` (fleshy bloodshot, distinct from ghost's pale eye) + `_drawStoneCrust`; `mesmerizeFx` (eye + wavering gaze-ray + hypnotic swirl), `manyEyesFx` (fan of rays), `tyrantGlareFx` (giant eye opens + per-hero stone crust). lint-vfx clean, gallery+lab.
- ✅ Polish pass (user, 2026-06-11): (1) mesmerize gaze-ray now lands on the CENTRE of the swirl (over the head, not the body); (2) T2 "HYPNOTISED" given a DISTINCT tell — `_hypnoDazeFx` = dazed stars ORBITING the head (vs mesmerize's single spinning spiral) so the player reads them apart; (3) **PETRIFY now greys the SPRITE** — AdventurerRenderer applies a true-grayscale ColorMatrix postFX (`pImg.postFX.addColorMatrix().grayscale(1).brightness(0.78,true)`) while `_petrifiedUntil`, removed when it ends (tracked via `s._petrifyFx`; WebGL renderer confirmed). ⚠ ON-SCREEN capture pending (preview throttled)
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `beholder-gaze-check.mjs` 18/18 · nerve 17/17 + ghost 24/24 regressions clean · soak 120/120 clean · SaveSystem strips transient fields

## Gnoll — mechanic: BLOOD HUNT ("bleed them, smell it, run them down")  [LOCKED 2026-06-11, replaces the scrapped HAMSTRING pitch]
Chain `gnoll1` Hyena Whelp → `gnoll2` Pack Stalker (buyable T2) → `gnoll_alpha` Gnoll Alpha (T3 miniboss ULT).
ONE mechanic: BLEED + the HUNT for the bleeding. Distinct from Rat's count-swarm (this is a DoT + cross-room
pursuit). Player-positive: bleeds tick free damage + the pack abandons its post to chase wounded/fleeing prey down.
- **T1 Hyena Whelp** (`gnoll1`) — **Bleed:** each attack applies a long-lasting BLEED that STACKS (capped). VFX:
  a claw-slash on hit, a persistent bleeding tell on the hero, and a BLOOD TRAIL dripped behind them as they move.
  (`bleed` onHit → `_bleedStacks`/`_bleedUntil`; damage ticked in `tickGnoll` = stacks × perStack each interval.)
- **T2 Pack Stalker** (`gnoll2`) — **Bloodhound:** these gnolls SMELL bleeding prey anywhere in the dungeon and
  ABANDON their room to SPRINT after them (boosted speed + the run animation + a faded after-image trail). Keeps Bleed.
  (`bloodhound` passive → tickGnoll sets `_bloodScent`/sprint when a bleeding hero exists; `_pickTarget` early-return
  in MinionAISystem makes a scenting gnoll target the nearest BLEEDING hero cross-room — no room gate, no behaviorType
  swap; run anim is automatic via `aiState==='engaging'`; after-image ghost-trail in MinionRenderer while sprinting.)
- **T3 Gnoll Alpha** (`gnoll_alpha`; final ULT) — **Blood Frenzy / Rupture:** the alpha HOWLS — every bleed stack on
  every hero RUPTURES at once (a burst scaled by how deep you stacked it), bleeds deepen to max + CAN'T BE HEALED for
  a window, and the WHOLE pack goes feral (sprint + after-images) to run down the bloodied. Pays off the bleed-stacking
  AND the hunt. (`bloodFrenzy` onTick → `_bloodFrenzy`: rupture dmg = stacks × ruptureDmgPerStack; max bleeds; `_noHealUntil`
  anti-heal gated at fountain/templar/cleric heal sites; force-scent all pack gnolls.)
- Engine: `case 'bleed'` onHit (`_bleed` — stack + refresh); `tickGnoll(scene,gs)` (apply bleed dmg + drip the blood
  trail + expire bleeds + manage bloodhound scent/sprint + restore speed); `_pickTarget` bloodhound early-return
  (`_nearestBleedingAdv`); `_bloodFrenzy` onTick; `_noHealUntil` checks added at the heal sites. SaveSystem strips
  `_bleedStacks/_bleedUntil/_bleedAt/_bleedSource/_noHealUntil/_bloodScent/_sprintBaseSpeed/_huntSprinting`.
- VFX (organic, non-ring; reuse `_drawClawSlash`): `bleedSlashFx` (claw-slash + blood spray on the hit hero),
  `bleedingAuraFx` (a small dripping/oozing tell while bleeding), `bloodTrailFx` (a dark splat dripped under a moving
  bleeder), `ruptureFx` (a blood burst scaled by stacks), `bloodFrenzyFx` (the alpha's feral howl + per-victim ruptures).
  After-image = `MinionRenderer` ghost-trail (fading sprite copies of the current frame) emitted while `_huntSprinting`.

### Blood Hunt acceptance checklist — ✅ BUILT + verified 2026-06-11 (⚠ on-screen VFX pending live preview)
- ✅ T1 `bleed` onHit stacks (cap 6) a long (9s) bleed; `tickGnoll` ticks stacks×perStack dmg + drips `bloodTrailFx` on movement + `bleedingAuraFx` tell; bleed kills attributed to the gnoll source
- ✅ T2 `bloodhound`: `_pickTarget` early-return → nearest BLEEDING hero cross-room (verified through the real MinionAISystem); tickGnoll sets `_bloodScent`+sprint (run anim auto via `aiState==='engaging'`) only while a bleeder exists, restores when none; MinionRenderer after-image ghost-trail while `_huntSprinting`
- ✅ T3 `bloodFrenzy` onTick: every bleed RUPTURES (burst = stacks×ruptureDmgPerStack) + bleeds maxed + `_noHealUntil` anti-heal + whole pack `_forceScentUntil` (incl T1 gnolls)
- ✅ anti-heal gates added (fountain heal + bless-regen [AISystem] / templar Lay on Hands / cleric `tryHeal` [CombatSystem]); gnoll2 buyable (unlock 12, gold 30); gnoll_alpha miniboss
- ✅ VFX organic + non-ring; **detail pass (user, 2026-06-11: "you've fallen back to generic stuff again"):** NEW helpers `_drawClawGashes` (layered wound: dark torn interior + blood + bright torn edge), `_drawGoreGob` (shaded heavy droplet), `_drawBloodColumn` (geyser silhouette). `bleedSlashFx` CENTRED on the sprite (y−10) + directional gravity arterial spray + gore gobs + red flash; `bleedingAuraFx` scales HARD with stacks (pulsing wound-glow + welling beads + gushing rivulets at ≥3 stacks) at depth 43 (IN FRONT of the sprite); `bloodTrailFx` richer (layered pool + glossy spot + flecks by stacks); `ruptureFx` gory (core flash + radiating streaks + gravity spray + gore gobs, stack-scaled); `bloodFrenzyFx` REDESIGNED (was a generic surge) → feral HOWL core + radiating claw-streaks + red blood-moon camera flash + per-victim GORE GEYSERS (blood columns fountain up). after-image = red-tinted fading sprite copies. lint-vfx clean. ⚠ on-screen capture still blocked (preview render won't composite for automated screenshots; renders live for the user)
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `gnoll-hunt-check.mjs` 23/23 (rewritten) · beholder 18/18 + nerve 17/17 + ghost 24/24 + vampire 15/15 regressions clean · soak 120/120 clean · SaveSystem strips `_bleed*`/`_noHealUntil`/`_bloodDrip*` + sprint state

## Ent — mechanic: THORNS / OLD GROWTH ("an enduring tree that turns your assault against you")  [LOCKED 2026-06-11]
Chain `ent1` Sapling Sentinel → `ent2` Mossback Treant → `ent3` Ancient Oakwarden (slow, high-def guardians).
ONE mechanic: a LOSING TRADE — attacking it backfires (thorns reflect), and it REGROWS so you can't out-damage it.
The only defensive-PUNISH family (Golem is the only other defensive one, and it just mitigates). Player-positive:
the party's own swings rack up kills, and it stalls the assault as a near-unkillable wall. NOTE: T2/T3 are
UPGRADE-only (unlock 99 / gold 0 — never touched); only ent1 is shop-placeable. (See [[minion tier gating]].)
- **T1 Sapling Sentinel** (`ent1`) — **Thornskin:** a hero who hits it in MELEE takes THORN damage back (reflect a
  fraction + a flat minimum). Ranged heroes don't trigger it (not touching the thorns).
- **T2 Mossback Treant** (`ent2`) — **Old Growth:** thicker bark (reflects more) **+ REGROW** — slowly heals a % of
  max HP each tick, so you can't out-trade it; the thorns keep coming.
- **T3 Ancient Oakwarden** (`ent3`; final ULT) — **Thornburst:** erupts a thorn-thicket — a burst of thorns rakes
  EVERY hero in the room, the oak SURGES with regrowth (big self-heal), and its thorns are amplified for a window.
- Engine: `thorns` passive — `MinionAbilities.thornsReflect(target,attacker,dmg,scene)` called from CombatSystem
  after a MELEE adventurer damages an ent → reflect `max(flat, dmg×reflectFrac)` to the attacker (×amp during
  Thornburst). `regrow` onTick (`_regrow` self-heal % maxHp). `thornburst` onTick ULT (`_thornburst`: room AoE thorn
  dmg + self-heal surge + sets `_thornsAmpUntil/_thornsAmpMul`). SaveSystem strips the amp window.
- VFX (organic, detailed; thorns are the FICTION here, drawn as curved wooden barbs not generic spikes): NEW
  `_drawThorn` (a shaded curved wood barb) + a leaf helper. `thornLashFx` (barbs jab out toward the attacker + a
  wood-chip puff), `regrowFx` (green-gold leaves + new shoots spiral up the trunk + a healing glow), `thornburstFx`
  (an irregular thorn-thicket erupts around the oak + a big regrowth bloom).

### Ent acceptance checklist — ✅ BUILT + verified 2026-06-11 (⚠ on-screen VFX pending live preview)
- ✅ T1 `thorns`: a MELEE hero that damages the ent takes reflect dmg (max of flat + frac via `thornsReflect` in CombatSystem); a RANGED hero (attackRange>1.5) does NOT
- ✅ T2 `regrow` onTick self-heals a % of maxHp (capped); thorns reflect more
- ✅ T3 `thornburst` onTick: room AoE thorn dmg + a big self-heal surge + thorns amplified (`_thornsAmpUntil`) for a window
- ✅ reflect amplified during the Thornburst window; SaveSystem strips `_thornsAmp*`; T2/T3 stay upgrade-only (99/0)
- ✅ VFX organic + detailed — NEW `_drawThorn` (curved wood barb) + `_drawLeaf`; `thornLashFx` (barbs jab into the attacker + wood-chip/blood puff), `regrowFx` (leaves drift up + heal glow), `thornburstFx` (regrowth bloom + an irregular thorn-thicket erupts from the ground + per-victim rakes). lint-vfx clean, gallery+lab. ⚠ on-screen capture pending (preview throttled)
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `ent-thorns-check.mjs` 16/16 · ghost 24 + beholder 18 + gnoll 23 + nerve 17 regressions clean (after fixing stale "buyable" assertions) · soak 120/120 clean (0 issues)

## Lich — mechanic: SOUL HARVEST ("death feeds the necromancer")  [LOCKED 2026-06-11]
Chain `lich1` Bone Cleric → `lich2` Death Acolyte → `elder_lich` Elder Lich (slow ranged necrotic caster).
ONE mechanic: the Lich EATS the souls of the dead. Every death near it (either faction) banks a SOUL → escalating
necrotic power. A death-fuelled scaling-artillery identity. **Deliberately distinct from the families that already
own bodies:** Zombie converts dead HEROES into a horde (Reanimate/Mass Grave); Skeleton self-reassembles + raises
fallen undead — so the Lich makes NO bodies. It's the only "deaths → escalating caster power" family (Orc Bloodlust
escalates from the orc's OWN melee hits; the Lich escalates from DEATHS anywhere in its room, ranged, and shares the
power to the crypt). Fully player-positive: your dungeon is a kill-factory, so the Lich is always fed — pile bodies
near it and it becomes a room-nuke. (User picked "Soul Harvest" over Curse-of-Wither / narrowed-Reanimation after I
flagged that Reanimation overlapped the Zombie family, 2026-06-11.) NOTE: T2/T3 are UPGRADE-only (unlock 99 / gold 0
— never touched); only lich1 is shop-placeable. (See [[minion tier gating]].)
- **T1 Bone Cleric** (`lich1`) — **Soul Siphon:** whenever any unit dies in the Lich's room (hero OR minion), the
  Lich harvests a soul (`_souls` +1, capped). Each banked soul boosts the Lich's own attack — its necrotic blasts hit
  harder the more bodies have fallen. Weak early, terrifying after the room fills with corpses.
- **T2 Death Acolyte** (`lich2`) — **Soul Conduit:** the harvested power overflows — nearby UNDEAD allies also gain an
  attack share scaled by the Lich's soul count (self → crypt). Higher soul cap. The whole garrison sharpens as bodies
  pile up.
- **T3 Elder Lich** (`elder_lich`; final ULT) — **Soul Storm + Phylactery:** periodically SPENDS the entire soul bank
  in a room-wide necrotic detonation (damage scales with souls banked, then souls reset to 0) — the payoff for the
  harvest. **PLUS the phylactery — the Elder Lich cannot stay dead: the first time it's killed it self-resurrects once**
  (after a short delay, at a fraction of HP, wreathed in green soul-flame; keeps its souls). Put it down twice.
- Engine: `soulHarvest` onTick (`_soulHarvest`) — scans the room for NEW corpses (fresh same-day hero graveyard
  entries + dead dungeon minions, each flagged `_soulHarvested` so counted once) and increments `lich._souls` (cap
  `soulCap`); if `shareUndead`, stamps a soul-share atk window on nearby undead allies. `MinionAbilities.soulAtkMul
  (attacker, scene)` (read in CombatSystem `_computeDamage`, attacker-side >1, alongside bloodlust/swarm) returns
  `1 + min(souls,cap)·perSoulAtk` for the Lich itself and the share window for buffed allies. `soulStorm` onTick ULT
  (`_soulStorm`: room AoE = `baseDmg + souls·dmgPerSoul`, then spends souls). `phylactery` onDying — intercepted in
  `onMinionDying` (first death → schedule a timed revive, `keepSouls`) + `tickLich` performs the soul-flame
  resurrection. SaveSystem strips the scene-time soul-share/phylactery-timer flags; `_souls` persists (wave progress).
- VFX (organic, non-ring; sickly-green SOUL fiction — clearly distinct from the Ghost's pale wail-faces and the
  Skeleton's bone-shatter): NEW `_drawSoulWisp` (a green necrotic will-o-wisp with a wispy tail), `_drawPhylactery`
  (a cracked soul-gem). `soulHarvestFx` (a soul-wisp tears free of the corpse and STREAMS into the Lich, which pulses
  brighter), `soulConduitFx` (green soul-threads tether the Lich to nearby undead, who flash with necrotic empower —
  directional tethers, NOT a ring), `soulStormFx` (the banked souls erupt into a swirling vortex of wisps that
  detonates across the room + per-victim necrotic bursts + screen flash), `phylacteryReviveFx` (the phylactery gem
  shatters then reknits as the Lich reforms in a green-flame column). MinionRenderer adds a soft green soul-glow on
  the Lich that scales with `_souls` (a readable power tell; mirrors the `_shadowExtracted` glow precedent).

### Lich acceptance checklist — ✅ BUILT + verified 2026-06-11 (on-screen VFX fire confirmed; fine detail best eyeballed live)
- ✅ T1 `soulHarvest` onTick: any unit dying in the Lich's room (hero via fresh same-day graveyard entry + dead dungeon minion) banks one soul (counted once via `_soulHarvested`), capped at `soulCap`; the Lich's attack scales with souls (`soulAtkMul` in CombatSystem `_computeDamage`, attacker-side)
- ✅ T2 `soulHarvest` deepened: higher cap + `shareUndead` stamps a soul-scaled atk share (`_soulShareUntil/_soulShareMul`) on nearby undead allies (read by the same `soulAtkMul`); a non-undead ally is NOT buffed
- ✅ T3 `soulStorm` onTick: room AoE = baseDmg + souls·dmgPerSoul to every room hero, then spends the souls (reset to 0)
- ✅ T3 `phylactery` onDying: the elder lich's FIRST death is intercepted (`onMinionDying` → collapse + `_phylacteryReviveAt`) → revives once after a delay (`tickLich`) at a fraction of HP, keeping its souls; the SECOND death is permanent
- ✅ souls are wave-scoped: reset each dawn (`resetOneShotsForNight`); SaveSystem drops the scene-time soul-share window + finishes any mid-save phylactery revive (`_souls` persists as wave progress)
- ✅ T2/T3 stay UPGRADE-only (unlock 99 / gold 0); only lich1 shop-placeable
- ✅ VFX organic + non-ring — NEW `_drawSoulWisp` (green teardrop flame + tail) + `_drawPhylactery` (cracked soul-gem); `soulHarvestFx`, `soulConduitFx`, `soulStormFx`, `phylacteryShatterFx`/`phylacteryReviveFx`. lint-vfx clean, gallery+lab registered. **VFX upgrade pass (user, 2026-06-11 — "make some better"):** (A) the Lich now WEARS its souls — soul-wisp Images (cached `AbilityVfx.soulWispTexture`) ORBIT the caster, one per `_souls` (capped), + a scaling green glow (MinionRenderer); you watch souls accumulate and Soul Storm visibly spends them. (B) Soul Storm REDESIGNED off the flat green-wash → souls rush in → compress to a blinding core → ERUPT as streaking soul-bolts that slam each hero (per-victim burst) over green flame-tongues raking the floor; short punchy flash (no room fill). (C) harvest is a real transfer — corpse spirit-exhale gasp + a mote trail following the wisp + an intake flare on the Lich on arrival. (D) Soul Conduit beads FLOW Lich→ally along the thread + a green flame-lick (not a circle) on the ally; the phylactery loop closes — the soul that escapes on shatter plunges back down on revive. On-screen: confirmed via dev sandbox — orbiting wisps + green glow read clearly on the Lich sprite; Soul Storm fires with NO green wash; zero console errors across all five effects
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `lich-soul-check.mjs` 28/28 · ghost 24 + beholder 18 + gnoll 23 + ent 16 + nerve 17 regressions clean · soak 120/120 clean (0 issues) · lint-vfx/lint-content/verify-docs clean

## Lizardman — mechanic: CAMOUFLAGE ("the hunter you can't hit")  [LOCKED 2026-06-11]
Chain `lizardman1` Marsh Stalker → `lizardman2` Scaled Hunter → `serpent_captain` Serpent Captain (cold-blooded
reptile ambushers). ONE mechanic: ACTIVE CAMOUFLAGE — a lizardman blends into the dungeon and is UNTARGETABLE while
hidden (heroes literally can't see/hit it), strikes from concealment for a devastating ambush bonus, then can melt
back into hiding to do it again. **Deliberately deeper/distinct from the generic ambush** (`behaviorType:'ambush'` →
`_hidden`+`_ambushBuffActive` 1.5× one-shot, used by plant2/imp2): that's a passive lurk-in-an-empty-room pop on entry;
the Lizardman's is the only "untargetable + renewable MID-COMBAT re-cloak + mass vanish" family. **Reuses the existing
`_camouflaged` plumbing** (Phase 1b.6: `AISystem._findEngageableMinion` skips camo minions = untargetable;
`MinionRenderer` 0.5 alpha so the PLAYER still sees them; `KnowledgeSystem` skips camo minions for intel) but that
system was boss-archetype-gated (`_archId()==='lizardman'`) with its reveal/ambush bonus WIPED in the redesign — so the
family kit makes camouflage intrinsic via the ability engine and rebuilds reveal/ambush/re-camo/ult on top.
Player-positive: your lizardmen are persistent damage the party can't remove; pairs perfectly with chip families (a
camo stalker safely finishing bleeding/poisoned heroes). Counterplay/balance lever: STRIKING BREAKS CAMO, exposing it
for a window. (User picked camouflage/sneaky + "untargetable while hidden", 2026-06-11.) NOTE: T2/T3 are UPGRADE-only
(unlock 99 / gold 0 — never touched); only lizardman1 is shop-placeable. (See [[minion tier gating]].)
- **T1 Marsh Stalker** (`lizardman1`) — **Camouflage:** starts the wave hidden (untargetable); its strike from
  camouflage lands a big ambush bonus (`ambushMul`). Striking REVEALS it (clears `_camouflaged`) — one free ambush per
  wave, then it's a normal fragile melee until next dawn.
- **T2 Scaled Hunter** (`lizardman2`) — **Stalk:** deepened — after striking it RE-CAMOUFLAGES mid-combat once it's
  been out of attacking for `recamoMs` (slinks back into stealth), moves FASTER while hidden to reposition
  (`hiddenSpeedMul`), and landing a KILL instantly re-cloaks it (`killRecamo` — a clean getaway). Vanishes and
  re-strikes over and over.
- **T3 Serpent Captain** (`serpent_captain`; final ULT) — **Vanishing Warband:** periodically the captain hisses and
  the WHOLE reptile warband in the room re-camouflages at once (every target the party was fighting vanishes), priming
  a synchronized ambush volley as they each strike from the renewed concealment.
- Engine: `camouflage` passive (read by combat hooks + `tickLizard`, NOT a tick/hit dispatch). `tickLizard(scene,gs)`
  = lifecycle: initial cloak, mid-combat re-camo timer (T2+ `recamoMs` since `_revealedAt`), faster-while-hidden speed
  swap (`_camoBaseSpeed`). CombatSystem: (1) untargetable hard-guard in `tryAttack` (`target._camouflaged` + non-dungeon
  attacker → null); (2) ambush bonus + REVEAL after `finalDmg` (`MinionAbilities.ambushStrikeMul` ×, then
  `revealCamouflage`); (3) kill-recamo after the hit applies (`maybeKillRecamo` if `killRecamo` + target died).
  `vanishingWarband` onTick ULT (`_vanishingWarband`: re-cloak every reptile in the captain's room). `resetOneShots
  ForNight` re-arms the cloak each dawn. SaveSystem strips scene-time `_revealedAt` + restores `_camoBaseSpeed`.
- VFX (organic, non-ring; reptile-scales/heat-shimmer fiction): NEW `_drawScaleFleck` (a small shaded reptile scale);
  `camouflageFx` (the lizardman dissolves into a heat-shimmer + a scatter of green scale-flecks settling — a VANISH),
  `ambushStrikeFx` (it materializes in a snap with a fang/claw lunge as it strikes from hiding), `vanishingWarbandFx`
  (a wave of camo-shimmer washes across the room + a vanish puff at each reptile). MinionRenderer keeps the 0.5-alpha
  hidden read; add a faint scales-shimmer while camouflaged.

### Lizardman acceptance checklist — ✅ BUILT + verified 2026-06-11 (on-screen VFX confirmed via dev sandbox)
- ✅ T1 `camouflage`: a lizardman starts the wave `_camouflaged` (untargetable via the existing `_findEngageableMinion` skip + a NEW CombatSystem `tryAttack` hard-guard); its strike from camo gets `ambushMul` (`ambushStrikeMul` in `_computeDamage`) then REVEALS it (`revealCamouflage` clears `_camouflaged`, stamps `_revealedAt`)
- ✅ T2 deepened: `recamoMs` mid-combat re-cloak (`tickLizard`, since `_revealedAt`) + `hiddenSpeedMul` faster while hidden (`_camoBaseSpeed` swap) + `killRecamo` instant re-cloak on a kill (CombatSystem `maybeKillRecamo` when the hit drops the hero)
- ✅ T3 `vanishingWarband` onTick: re-camouflages every camo-kit reptile in the captain's room at once (room-scoped)
- ✅ camouflage is intrinsic to the FAMILY (driven by the ability, works under ANY boss — not just the lizardman archetype); reuses the existing `_camouflaged` flag so renderer (0.5 alpha) / knowledge-skip / targeting-skip all already honor it
- ✅ camo re-arms each dawn (`resetOneShotsForNight`); SaveSystem strips `_revealedAt` + restores `_camoBaseSpeed`
- ✅ T2/T3 stay UPGRADE-only (unlock 99 / gold 0); only lizardman1 shop-placeable; `lizardman1` behaviorType moved `ambush`→`roam` so it doesn't double up with the generic `_ambushBehavior`
- ✅ VFX organic + non-ring — NEW `_drawScaleFleck` (shaded reptile scale); `camouflageFx` (heat-shimmer veil + scale-flecks scatter = VANISH), `ambushStrikeFx` (reveal pop + claw-rake lunge + scale-flecks reassemble), `vanishingWarbandFx` (brief faint room shimmer-sweep + per-reptile vanish puffs). lint-vfx clean, gallery+lab registered. On-screen capture pending final eyeball
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `lizardman-camo-check.mjs` 25/25 · ghost 24 + beholder 18 + gnoll 23 + ent 16 + nerve 17 + lich 28 regressions clean · soak 120/120 clean (0 issues) · lint-vfx/lint-content/verify-docs clean

## Imp — mechanic: BLINK ("the uncatchable harasser")  [LOCKED 2026-06-11]
Chain `imp1` Ember Imp → `imp2` Shadow Imp → `imp3` Plague Imp (fast, fragile, ranged pint-sized devils). ONE
mechanic: BLINK — the imp TELEPORTS, so the party can never corner it and never shield their backline from it.
The only mobility/teleport family. Distinct from Demon (which owns the escalating hellfire AURA — the imp just
plinks ranged attacks while teleporting) and from the generic ambush. (The teleport base-behavior quirk was WIPED
in the redesign, so this is a clean build via the ability engine.) Player-positive: a durable chip-damage harasser
that always reaches the enemy's squishies, wastes the party's time (uncorner-able), and ends in a room-wide fire
storm. Unifies the through-line of the three previously-incoherent tiers (damage-type flavor stays per-sprite-art —
the MECHANIC is what's unified). (User picked Blink over Sabotage-silence / Wildfire, 2026-06-11.) NOTE: T2/T3 are
UPGRADE-only (unlock 99 / gold 0 — never touched); only imp1 is shop-placeable. (See [[minion tier gating]].)
- **T1 Ember Imp** (`imp1`) — **Blink:** a fast ranged attacker that BLINKS to a new spot the instant a hero closes
  to melee (`escapeRangeTiles`), teleporting to kite range (`kiteRangeTiles`) from the heroes. Uncorner-able — it's
  never where you swing, plinking from safety all fight. (On a `cooldownMs`.)
- **T2 Shadow Imp** (`imp2`) — **Flicker Strike:** + blinks OFFENSIVELY (`flicker`) — when not threatened it flickers
  to within attack range of the MOST-WOUNDED hero in the room and strikes, then escape-blinks back out. Your tank
  can't body-block it; the backline is never safe.
- **T3 Plague Imp** (`imp3`; final ULT) — **Hellrift Frenzy:** periodically tears a rift (`hellrift` onTick) — a
  room-wide fire pulse + a dramatic self-teleport + it whips the whole imp pack in the room into a blink FRENZY
  (`_blinkFrenzyUntil`, slashed blink cooldown) for a window, so the room fills with teleporting, fire-flinging devils.
- Engine: `blink` passive (read by `tickImp(scene,gs,dungeonGrid)`, wired in MinionAISystem next to tickLizard) —
  cooldown-gated (`_blinkAt`): ESCAPE blink (hero within `escapeRangeTiles` → `_teleportMinion` to a sampled floor
  tile ≥ `kiteRangeTiles` from the nearest hero) takes priority; else (T2+ `flicker`) a FLICKER blink to within
  `flickerRangeTiles` of the lowest-HP room hero. `_pickBlinkTile` samples room floor tiles (`_isFloorTile` accepts
  the grid's numeric 1/5 AND the headless 'floor'/'boss_floor'). `hellrift` onTick ULT (`_hellrift`: room AoE fire +
  self-teleport + stamp `_blinkFrenzyUntil` on room imps → tickImp uses `frenzyCdMs`). `resetOneShotsForNight` clears
  the blink timers; SaveSystem strips `_blinkAt`/`_flickerAt`/`_blinkFrenzyUntil`.
- VFX (organic, non-ring; fire-tinged teleport): NEW `_drawEmber` (a shaded flame-mote); `blinkFx(scene,fromX,fromY,
  toX,toY)` (the imp IMPLODES to a point + an ember puff at the OUT end, a quick arc streak, then a fire burst-in
  flash at the IN end), `hellriftFx` (a vertical hellfire rift tears open + a fire AoE pulse + scattered blink-sparks
  around the room). MinionRenderer: a brief stretch/pop on the teleported sprite (optional).

### Imp acceptance checklist — ✅ BUILT + verified 2026-06-11 (hellrift confirmed on-screen; blinkFx verified by construction)
- ✅ T1 `blink`: when a hero is within `escapeRangeTiles`, the imp teleports (`tickImp`, cooldown `_blinkAt`) to a sampled room floor tile ≥ `kiteRangeTiles` from EVERY room hero (kiting); never corner-able
- ✅ T2 `flicker`: when not threatened, blinks to within `flickerRangeTiles` of the LOWEST-HP room hero (center-biased tile sampling so it reliably reaches the backline), targets it; the escape-blink takes it back out when a hero closes
- ✅ T3 `hellrift` onTick: room AoE fire pulse + `_blinkFrenzyUntil` frenzy (blink cooldown → `frenzyCdMs`) on every blink-kit imp in the room (non-imps unaffected)
- ✅ teleport lands on a real floor tile (`_pickBlinkTile` + `_isFloorTile` accepts numeric 1/5 AND string 'floor'); `_teleportMinion` clears path/pathIndex/_patrolTarget; cooldown-gated
- ✅ blink timers reset each dawn (`resetOneShotsForNight`); SaveSystem strips `_blinkAt`/`_flickerAt`/`_blinkFrenzyUntil`
- ✅ T2/T3 stay UPGRADE-only (unlock 99 / gold 0); only imp1 shop-placeable; imp2 behaviorType moved `ambush`→`roam`; all three imps made ranged (attackRange 3) for the kiter identity
- ✅ VFX organic + non-ring — NEW `_drawEmber`; `blinkFx(from,to)` (implode + ember-puff-out + arc streak + fire burst-in scatter), `hellriftFx` (vertical hellfire rift + FAINT room fire-pulse + scattered blink-sparks + per-victim bursts). lint-vfx clean, gallery+lab registered. On-screen pending final eyeball
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `imp-blink-check.mjs` 21/21 · ghost 24 + beholder 18 + gnoll 23 + ent 16 + nerve 17 + lich 28 + lizardman 25 regressions clean · soak 120/120 clean (0 issues) · lint-vfx/lint-content/verify-docs clean

## Plant — mechanic: ENTANGLE ("root them in the kill zone")  [LOCKED 2026-06-11]
Chain `plant1` Vinekin → `plant2` Carnivore Bloom → `plant3` Blood Briar (slow, rooted-in-place carnivorous flora).
ONE mechanic: ENTANGLE — the plant GRABS heroes with vines and ROOTS them in place: they can still swing, but they
CAN'T move (can't advance to the boss, can't flee, can't reposition). The dungeon's living flypaper — a control/zoning
family. **Deliberately distinct from its two flora neighbours:** Ent owns reflect+regrow (thorns), and the upcoming
Mushroom will own spores — so Plant touches NONE of reflect/regen/spores. Also distinct from Beholder (petrify = can't
ACT) and Ghost (panic = cower/morale): a plant root = can't MOVE but fights on. Deepens the Vinekin's existing "slows
whatever brushes it". **Reuses the existing, working root status** (`MinionAbilities._applyRoot`/`isRooted`/`_rootedUntil`,
already honored by `AISystem` line ~1550 — "a rooted adv stands still; minions in range get free swings"). Player-positive:
pin the party in your traps and gauntlets, deny escape AND advance, and bonus-damage the trapped. (User picked Entangle
over Devour-swallow / Sap-drain, 2026-06-11.) NOTE: T2/T3 are UPGRADE-only (unlock 99 / gold 0 — never touched); only
plant1 is shop-placeable. (See [[minion tier gating]].)
- **T1 Vinekin** (`plant1`) — **Entangle:** its hit ROOTS the struck hero (`_applyRoot`, `durationMs`) — vines snare the
  legs; they're locked in the kill zone for the rest of the dungeon to butcher.
- **T2 Carnivore Bloom** (`plant2`) — **Devour:** longer/stronger root, AND it CHOMPS a rooted hero for bonus damage
  (`devourMul`, read in CombatSystem) — the man-eater feeds harder on prey it's already holding down.
- **T3 Blood Briar** (`plant3`; final ULT) — **Stranglethorn:** periodically erupts a thicket (`stranglethorn` onTick)
  that ROOTS every hero in the room at once + DRAINS HP from each rooted hero (blood-fed, healing the briar) — the whole
  party pinned in the briar patch while it feeds.
- Engine: `entangle` onHit (`_entangle` → `_applyRoot` on an adventurer target only + VFX). `devourMul(attacker,target,
  scene)` read in CombatSystem `_computeDamage` (attacker-side, alongside bloodlust/swarm/soul): if the attacker's
  entangle ability has `devourMul` AND the target is currently rooted → ×devourMul. `stranglethorn` onTick ULT
  (`_stranglethorn`: room-root every hero + per-hero drain + self-heal). Root lives on the ADVENTURER (`_rootedUntil`)
  so there's no minion state to reset; SaveSystem already clears adv `_rootedUntil` (verify; add if missing).
- VFX (organic, non-ring; vines/thorns fiction — reuse `_drawThorn` + NEW `_drawVine`): `entangleFx` (vines whip up out
  of the ground and CINCH around the hero's legs — a snare, with a few leaves), `stranglethornFx` (a briar thicket
  erupts across the room + grasping vines cinch every hero + a blood-drain mote stream back to the briar). MinionRenderer
  / a status tell: a small vine-cuff at the rooted hero's feet while `_rootedUntil` (optional, via the renderer).

### Plant acceptance checklist — ✅ BUILT + verified 2026-06-11 (on-screen VFX confirmed via dev sandbox)
- ✅ T1 `entangle` onHit: a struck ADVENTURER is rooted (`_applyRoot`, `_rootedUntil`), honored by AISystem (stands still, minions get free swings); a dungeon-faction target is NOT rooted
- ✅ T2 `devourMul`: the plant deals bonus damage to a target that is currently rooted (`MinionAbilities.devourMul` in CombatSystem `_computeDamage`, attacker-side); no bonus vs an un-rooted target, and plant1 (no devourMul) gets none even vs rooted
- ✅ T3 `stranglethorn` onTick: roots EVERY room hero + drains HP from each + heals the briar per hero drained (capped at maxHp)
- ✅ reuses the existing root system (no new movement code); SaveSystem now strips adv `_rootedUntil`/`_staggeredUntil`/`_slowUntil`/`_slowMult`
- ✅ T2/T3 stay UPGRADE-only (unlock 99 / gold 0); only plant1 shop-placeable; plant2 behaviorType moved `ambush`→`guard`
- ✅ VFX organic + non-ring — NEW `_drawVine` (curling tendril) + reuse `_drawLeaf`; `entangleFx` (vines whip up from the ground + cinch the legs + a tightening flutter of leaves), `stranglethornFx` (briar thicket erupts room-wide + per-hero vine-cinch + a blood-drain mote stream siphoned back to the briar + a dark-red feed glow). lint-vfx clean, gallery+lab registered. On-screen pending final eyeball
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `plant-entangle-check.mjs` 17/17 · ghost 24 + beholder 18 + gnoll 23 + ent 16 + nerve 17 + lich 28 + lizardman 25 + imp 21 regressions clean · soak 120/120 clean (0 issues) · lint-vfx/lint-content/verify-docs clean

## Mushroom — mechanic: HALLUCINATION ("daze them blind")  [LOCKED 2026-06-11 — the FINAL family]
Chain `mushroom1` Spore Sprite → `mushroom2` Toxic Cap → `myconid_stalker` Myconid Stalker (sentient fungal casters).
ONE mechanic: HALLUCINOGENIC SPORES that DAZE — a dazed hero can't fight straight, swinging at phantoms and WHIFFING
their attacks (an accuracy/DPS-denial family). **The only family that attacks ACCURACY** (Ghost reduces hero damage
via fear-fumble, but nobody makes heroes outright MISS). Matches the T1 sprite's literal "confusing spores", and
deliberately dodges every overlap: NOT poison-DoT/contagion (Slime PLAGUE), NOT acid floor-denial (Slime CORROSIVE),
and NOT the Myconid BOSS-ARCHETYPE's Spore Network (spore-cloud DoT) / Corpse Bloom (dead → fungal sprouts). Reuses
the existing CombatSystem WHIFF path (`{hit:false, whiffed:true}`, already used by the Gambler dice). Player-positive:
a dazed party can't kill your minions, so your bruisers survive and the dungeon holds; pairs with everything (whiffing
heroes can't break your tanks). (User picked Hallucination over Spore-Cloud / Corpse-Bloom — both flagged as
overlapping existing systems, 2026-06-11.) NOTE: T2/T3 are UPGRADE-only (unlock 99 / gold 0 — never touched); only
mushroom1 is shop-placeable. (See [[minion tier gating]].)
- **T1 Spore Sprite** (`mushroom1`) — **Hallucinogenic Spores:** its hit DAZES the hero (`_applyDaze`, `durationMs` +
  `missChance`) — for a few seconds they have a chance to WHIFF each attack (swinging at phantoms). A fragile
  spore-puffer that craters the party's damage.
- **T2 Toxic Cap** (`mushroom2`) — **Disorienting Cloud:** a stronger/longer daze on hit, AND it periodically puffs a
  spore cloud (`sporePuff` onTick, `radiusTiles`) that dazes every hero near it — the front line starts missing en masse.
- **T3 Myconid Stalker** (`myconid_stalker`; final ULT) — **Spore Storm:** a room-wide hallucinogenic bloom
  (`sporeStorm` onTick) — every hero in the room is HEAVILY dazed (high `missChance`), whiffing most of their attacks
  and flailing at phantoms while your real minions cut them down.
- Engine: `daze` onHit (`_applyDaze` on an ADVENTURER target only → `_dazedUntil` + `_dazeMissChance`, keep-strongest).
  `MinionAbilities.dazeMissChance(attacker, now)` read in CombatSystem.tryAttack (right after the Gambler whiff): if a
  dazed adventurer rolls under the chance → return the existing WHIFF result (the swing does nothing). `sporePuff` onTick
  (`_sporePuff`: daze heroes within `radiusTiles` of the mushroom) + `sporeStorm` onTick ULT (`_sporeStorm`: daze every
  room hero, heavy). Daze lives on the ADVENTURER so there's no minion state to reset; SaveSystem strips adv
  `_dazedUntil`/`_dazeMissChance`.
- VFX (organic, non-ring; spore-mote/cap fiction — NEW `_drawSporeCap` (a small toadstool) + spore motes): `dazeFx`
  (a puff of drifting spore motes around the hero's head + wobbling phantom "?"/swirl over them — the disorientation
  tell), `sporePuffFx` (the cap belches a spreading spore cloud — drifting motes, low + textured, not a wash),
  `sporeStormFx` (a room-wide haze of rising spore motes + per-hero daze puffs). MinionRenderer / a status tell on the
  dazed hero (optional spore-mote loop while `_dazedUntil`).

### Mushroom acceptance checklist — ✅ BUILT + verified 2026-06-11 (on-screen VFX confirmed via dev sandbox) — **FINAL FAMILY · REDESIGN COMPLETE**
- ✅ T1 `daze` onHit: a struck ADVENTURER gets `_dazedUntil`+`_dazeMissChance` (`_applyDaze`); a dungeon-faction target is NOT dazed
- ✅ a dazed hero WHIFFS attacks at `missChance` (`MinionAbilities.dazeMissChance` rolled in CombatSystem.tryAttack → the existing `{hit:false,whiffed:true}` result); an un-dazed hero never whiffs from this (verified statistically: 0% vs ~50%)
- ✅ T2 `sporePuff` onTick: dazes every hero within `radiusTiles` of the mushroom (not the far ones)
- ✅ T3 `sporeStorm` onTick: dazes EVERY room hero at a high miss chance (0.55)
- ✅ daze keep-strongest (max chance + latest expiry); lives on the adv (no minion reset); SaveSystem strips `_dazedUntil`/`_dazeMissChance`
- ✅ T2/T3 stay UPGRADE-only (unlock 99 / gold 0); only mushroom1 shop-placeable
- ✅ VFX organic + non-ring — NEW `_drawSporeCap` (toadstool); `dazeFx` (drifting spore motes + a wobbling dizzy SPIRAL over the head — the hallucination tell), `sporePuffFx` (a spreading purple spore haze [low alpha, not a wash] + rising motes + a few little caps puffing out), `sporeStormFx` (faint room haze + a gust of rising spore motes + a per-hero daze puff). lint-vfx clean, gallery+lab registered. On-screen pending final eyeball
- ✅ MINION_ABILITY_INFO text for all 3 tiers
- ✅ headless `mushroom-daze-check.mjs` 18/18 · ghost 24 + beholder 18 + gnoll 23 + ent 16 + nerve 17 + lich 28 + lizardman 25 + imp 21 + plant 17 regressions clean · soak 120/120 clean (0 issues) · lint-vfx/lint-content/verify-docs clean

> **🎉 MINION ABILITY REDESIGN COMPLETE — all 18 families** have a distinct, deepened-per-tier mechanic with a
> capstone ULT and bespoke non-generic VFX: Goblin (Plunder) · Skeleton (Reassemble) · Orc (Bloodlust) · Slime
> (Split/Plague/Acid) · Vampire (Lifesteal) · Rat (Swarm) · Zombie (Reanimate-horde) · Demon (Hellfire aura) · Golem
> (Fortress/DR) · Ghost (Fear/nerve) · Beholder (Gaze/charm-petrify) · Gnoll (Blood Hunt) · Ent (Thorns) · Lich (Soul
> Harvest) · Lizardman (Camouflage) · Imp (Blink) · Plant (Entangle) · Mushroom (Hallucination). Push still HELD (main
> would deploy the half-wiped roster); all work is LOCAL.

---

## Adventurer AI Intelligence & Adaptive Learning (locked 2026-06-15, build IN PROGRESS)

> **MAJOR AI FEATURE.** Build it correctly and in full; verify there are no issues as each phase lands AND
> at completion. Source-of-truth spec — implement from the VERBATIM quotes + the locked model below, tick
> the acceptance checklist against the actual code, never from memory.

### Verbatim spec (user's exact wording — do not paraphrase)

> "we recently redid all adventurer, boss, and minion abilities. so now i want adventurer ai to know when and
> where the best time is to use their class abilities. i want them to be smarter basically and to get smarter
> over time using the knowledge system. this is to make the player have a challenge and have to adapt to the
> adventurers getting smarter as the game progresses."

> "so i want them to all fully know how their abilities work (minions and bosses should also know their
> abilities and how they work and when best to use them) and when to use them (and not just spam them for no
> reason). but for knowledge i want adventurers to gain knowledge of specific enemies and their abilities if
> they survive them and escape the dungeon. so if the player i building lots of golems, adventures that survive
> golem attacks and escape the dungeon after surviving should learn exactly how those minions abilities work
> and how to counter them or fight them better. this pushed the player to use other strategies throughout the game."

> "also, one adventurer escaping after surviving a minion should teach them everything about that minion. the
> kingdom need to gradually learn minions with the more knowledge they gain about them to make them smarter and
> smarter over time after fighting them."

> Decisions (locked via Q&A 2026-06-15): counter effects = ALL FOUR (defensive timing, smarter positioning,
> focus/target priority, combat edge vs known foes); decay = STALE-SNAPS-BACK; legibility = BOTH (a
> Bestiary/Doctrine panel + in-world tells); veterans = individually smarter. Reveal/mastery reconciliation
> CONFIRMED (see Layer B).

### The locked model — two layers

**LAYER A — Competence (always on; adventurers, minions, bosses).** Every entity uses its OWN abilities with
real timing and targeting — fire when it pays off, at the best target, NOT mindless spam. Pure AI quality, NOT
knowledge-gated. Biggest lift on adventurers (today they fire-ASAP in `ClassAbilitySystem._consider*()`); the
overhauled boss kit already has tier-gated timing; minions sit in between (audit + tighten each).

**LAYER B — Bestiary learning (adventurers, anti-*player*, fed by survive-and-escape).** A new `bestiary`
branch of the knowledge shared pool, keyed per enemy **TYPE** (minion family e.g. `golem`, or the boss
archetype). Two distinct dials:
- **Reveal — fast/binary.** ONE adventurer who survives an enemy and ESCAPES the dungeon teaches the kingdom
  *everything* about that type — its abilities become fully KNOWN, basic counters switch on. Death teaches
  nothing (consistent with knowledge today: death destroys personal knowledge).
- **Mastery — gradual/scaling.** Beyond knowing it, the kingdom gets BETTER at fighting that type the more they
  face-and-survive it — a per-type mastery (0→max) that climbs with cumulative successful escapes, making the
  counters progressively sharper/stronger over the run ("smarter and smarter over time").
- **Counters (all four, scaled by mastery, gated by reveal+freshness):** (1) **defensive timing** — pre-pop
  their own defensive/control ability before the known enemy's telegraphed big move; (2) **smarter
  positioning** — spread vs known AoE, avoid the slam/cluster zone, space a known melee threat; (3)
  **focus/target priority** — kill the known-dangerous type first; (4) **combat edge** — a modest, mastery-
  scaled accuracy/damage/damage-reduction bonus vs studied foes.
- **Decay = stale-snaps-back.** Stop using a type → its mastery goes STALE (counters mis-time/weaken via the
  existing staleness mechanic), but it re-sharpens FAST if you bring the type back. Never a hard reset.
- **Persistence.** Bestiary lives in `gameState.knowledge.sharedPool.bestiary` → fed on escape, inherited by
  fresh waves, carried by veterans (who are individually sharper on BOTH layers). Never fed on death. Party
  wipe clears it like the rest of the pool.

**Legibility (both).** A **Bestiary / Kingdom Doctrine panel** in the existing knowledge/intel UI (per type:
*known?* + mastery ★s + which abilities studied) AND **in-world tells** (you visibly see adventurers begin to
dodge/counter the enemy types they've studied).

**The pressure loop.** Spam one enemy → kingdom reveals it instantly, then masters it → you must diversify;
rotate away → mastery goes stale → the window reopens. Forces the player to keep changing strategy.

### Phasing (each phase: verify with node --check + lint-content + lint-vfx + the headless sim + a dedicated
`tools/sim/*-check.mjs` harness + runtime `__qfCheck()`; get user sign-off before the next phase)

- **Phase 1 — Bestiary substrate + Doctrine panel (no behavior change).** Add `bestiary` to the knowledge pool
  (`empty()`, `_ensureAdvKnowledge`, `_mergeKnowledge`, save backfill). Feed it on survive-and-escape
  (`_onAdventurerFled`), inherit (`initKnowledgeForSpawn/Survivor`), apply reveal (binary) + mastery (cumulative)
  + staleness. Expose via `getBestiaryReport()`. Build the Doctrine panel in the knowledge HUD. Watch the kingdom
  learn before anything acts on it.
- **Phase 2 — Layer A competence: adventurers.** Rewrite `_consider*()` from "fire-ASAP" to "fire when it pays"
  + best-target selection, across all classes.
- **Phase 3 — Layer A competence: minions + bosses.** Audit + tighten their ability timing/targeting.
- **Phase 4 — Layer B counters wired to the bestiary.** The four counter effects, scaled by mastery + gated by
  reveal/freshness; flagship classes (Knight/Mage/Cleric/Rogue) first, then all. In-world tells.
- **Phase 5 — Balance + tuning** via the headless sim; final full-feature verification pass.

### Acceptance checklist (tick each against ACTUAL code; never mark ✅ unverified)

**Layer A — competence** (adventurers ✅ Phase 2; minions/bosses = Phase 3)
- ✅ Adventurer class abilities fire on a value test, not blind spam — AUDIT of all 15 classes found every ability already cooldown+condition gated (no spam to fix); documented per-class in DESIGN_COVERAGE `ai-P2-comp-adv`.
- ✅ Adventurer abilities pick the BEST target/position — heal→lowest ally + Barbarian→densest cluster already did; ADDED `_strongestHostileMinion` so Monk Stunning Palm + BeastMaster Tame/Sic'Em hit the SCARIEST foe (was nearest). Mage burst left (amplifies primary + splashes — not a single-target waste).
- ✅ Minions use their own abilities with sensible timing/targeting — AUDITED competent (onTick cooldown anti-spam + floor/room armed-gate + reactive enrage/kite/fallback + most-wounded heal targeting). No change: remaining "naive" cases would nerf (AoE-on-solo) or are harmless. [Phase 3]
- ✅ Bosses use their kit with good timing — throne fight-timers are tier-gated, 2.6s cadence, bail on empty room. FIX: 4 single-target strikes (Gnoll/Succubus/Vampire T1–T2) used arbitrary `fighters[0]` despite "top-aggro" comments → now `_bestFightTarget` (damage core, ties→wounded). Day actives are player-triggered (not AI). [Phase 3]
- ✅ No regression: `class-ability-fire-check.mjs` 27/27 + `competence-targeting-check.mjs` 9/9 + gnoll/vampire boss harnesses + soak 120/0 (Phase 2) + lint clean. (Phase 3 soak running.)

**Layer B — bestiary learning** (substrate ✅ Phase 1, harness `bestiary-check.mjs` 21/21 + soak 120/0)
- ✅ `knowledge.sharedPool.bestiary[type]` exists; keyed per minion family (`_enemyFamily`) + `boss:<arch>`; old saves backfill (`_ensureState`); every pool literal carries the bucket (incl. the party-wipe reset).
- ✅ REVEAL: one adventurer surviving an enemy type AND escaping → that type fully KNOWN in the shared pool (abilities revealed).
- ✅ Death teaches nothing; reveal only commits on escape (`observeMinion`/`BOSS_FIGHT_STARTED` → per-run scratch → `_onAdventurerFled` → `_rebuildSharedPool`).
- ✅ MASTERY: per-type value SUMS across survivors' days-faced (climbs over time); ★ tiers via `KNOWLEDGE_BESTIARY_MASTERY_T1/2/3`. (Counter SCALING off it = Phase 4.)
- ✅ Inheritance: kingdom doctrine = the shared pool (consulted by all); veteran accumulation via survivor-record merge. Veterans *individually sharper* = a per-run VETERAN combat edge (Phase 5, `KNOWLEDGE_VETERAN_EDGE_*`): +dmg dealt / −dmg taken = min(cap, runs×0.04); killing them removes it AND drops kingdom mastery. Harness-verified (5-run ×0.80).
- ✅ STALENESS (data): per-type goes stale after `KNOWLEDGE_BESTIARY_STALE_DAYS`, mastery retained, snaps back on re-facing. (Counter *weakening* off stale = Phase 4.)
- ✅ Party wipe clears bestiary with the rest of the pool (bucket preserved as `{}`).

**Layer B — counters (each gated by reveal, scaled by mastery, weakened by staleness)** — Phase 4, IN PROGRESS
- ✅ Defensive timing: `_studiedThreatNear` → Knight raises Bulwark + Gladiator pre-Blocks a STUDIED dangerous minion (strength ≥ DEFENSE_TIER) in range, before its blow. Harness-verified.
- ✅ Smarter positioning: when a STUDIED AoE-threat minion (`MinionAbilities.isAoeThreat`, area/room ability) shares a room, the party spreads WIDER there (`AISystem._studiedAoeRoomIds` → a scoped 2nd `applyCrowdSeparation` pass incl. stationary fighters, radius 15) so the area attack catches fewer. Verified live (detection) + soak 120/0; reuses the proven separation util. Spread magnitude is a tuning knob.
- ✅ Focus/target priority: `AISystem._findEngageableMinion` biases toward STUDIED types (FOCUS_BIAS×strength, bounded so it never ignores an adjacent threat). Harness-verified.
- ✅ Combat edge: `KnowledgeSystem.getEnemyCounter()` → CombatSystem applies +DMG to / −DR from studied minion types, mastery-scaled, reveal-gated; never applies to unknown types (harness-verified 28/28).
- ✅ Counters weaken when knowledge is STALE (×`KNOWLEDGE_COUNTER_STALE_FACTOR` 0.4, snaps back on re-face) — shared strength, so it covers every counter built on `getEnemyCounter`.

**Legibility**
- 🟡 Bestiary/Doctrine panel in the knowledge HUD (`KnowledgeMapOverlay._renderDoctrine`, reads `getBestiaryReport()`): per type — known?/⟳studying/stale, mastery ★s, abilities-studied count. BUILT + node-checked; **visual QA pending** (no preview this session).
- ☐ In-world tells: visible behavior change vs studied enemies (dodging/countering), legible to the player. (Phase 4.)

**Quality / integration**
- ✅ Veterans: individually smarter — the per-run VETERAN combat edge (above) + they contribute more to the kingdom's bestiary (accumulate days-faced across runs); killing them is doubly rewarded.
- ✅ Systems-integration: bestiary lives in `gameState.knowledge` (JSON-serializable, persists with the save, party-wipe clears it); KnowledgeSystem listeners off in `destroy()` (no leak); Doctrine panel reads the API; ⚠ balance NOT sim-tunable (sim has 0 escapes → can't build the bestiary) → magnitudes are conservative defaults, play-test for feel.
- ✅ Per-phase verify done (node --check / lint-content / verify-docs / sim soak ×6 across phases / dedicated harnesses `bestiary`+`counters`+`competence-targeting`+`veteran-edge` / live preview) + this final full-feature pass.

## Minion behaviors — consolidated to 3 (locked 2026-06-20, by user)

Replaces the old fuzzy `behaviorType` set (guard/patrol/roam/ambush, where guard=patrol=ambush
functionally and ambush had no code). **Exactly three base behaviors, set per family at the T1; all
upgrade tiers (T2/T3/T4) inherit the T1's behavior** (so a chain is never mixed):

- **`home`** — wander home room only; engage advs in home room; return home after combat.
- **`patrol`** — wander home + door-adjacent rooms; engage advs in home OR an adjacent room (walks
  over via the generalised neighbour-room reach, ex-Guard-Post logic); resume patrol (no ping-pong).
- **`roam`** — wander the whole dungeon; engage wherever it currently stands; never returns home.

Shared rules (these were ALREADY the game's behaviour — confirmed, no change): a minion ALWAYS
aggros a non-invisible adv sharing its room (no distance gate); charmed / Saboteur / on-a-doorway
advs stay excepted (kept, per user); a minion chases a fleeing adv it entered-room-with or was
already fighting, giving up at the entry hall. `hunt` stays a runtime-only escalation (boss adds),
not a base behavior. The `starter_guard_post` room still promotes its occupants to patrol scope.

**Family → behavior (T1, inherited by the whole chain):**
- roam: gnoll1, imp1, orc1, zombie1, lizardman1, slime2, slime3, slime4
- patrol: beholder1, rat1, mushroom1, skeleton1
- home: demon1, ent1, plant1, golem1, lich1, ghost1, goblin1, vampire_minion1, mimic
  (mimic = home, but its chest-disguise logic keeps it stationary until sprung)

Implementation: `src/data/minionTypes.json` behaviorType per minion (roam 27 / home 25 / patrol 12);
wander-scope + engagement-scope + return-home in `MinionAISystem` driven off the 3 types.

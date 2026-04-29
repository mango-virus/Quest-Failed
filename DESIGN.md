# Quest Failed — Game Design Sheet

> This document is the **source of truth** for what the game is and what it must include.
> It is the player/designer's original brief, preserved verbatim and structured for navigation.
> Every concrete deliverable referenced here must show up in `DESIGN_COVERAGE.md` with a phase + status.
>
> If anything in this file conflicts with `ARCHITECTURE.md` or any code, **this file wins** — update the others.

---

## Core concept

As the boss I want to be able to place traps, monsters, minions, mini bosses, hidden keys, locked doors, loot, and other stuff to try and prevent the adventurer from reaching the boss room. The dungeon grid should be fixed tile size placement where every room snaps to a slot.

Rooms connect to each other directly through their doorways — when you place a room near another, it auto-aligns so a doorway on one room sits next to a facing doorway on the other. There are no separate corridor / hallway tiles to draw; adventurers walk straight from one room into the next through the doorway. (deviation noted: original prototype had drawable corridor segments — replaced with doorway-snap placement so every cell of the dungeon is meaningful gameplay space.)

The game should work in days and be endless. Meaning that each day during the day phase, adventures should enter the dungeon solo, with a small party, large party, or a full on raid group. I want adventurers to have different personalities that change how they tackle the dungeon. They also can choose to either fight through the dungeon if they think they can beat it, leave the dungeon for the day to return another day, or sleep in the dungeon to heal up so they can continue to fight through it the next day. During the night phase, I can build out the dungeon, add traps rooms, minions, mini bosses, loot to lure adventurers and more. When I am satisfied I can choose to move to the next day phase.

---

## Knowledge system

I want adventurers to be able to learn the dungeon, the enemies, traps, rooms, and so on and use this knowledge to their advantage. An adventurer without knowledge will enter it "blind" and learn as they go. If an adventurer leaves the dungeon, he can share knowledge of the dungeon for specific rooms or minions or traps or treasure he saw. He shares that with other adventurers that can enter the dungeon and adapt to the knowledge they gained. Avoiding traps, certain minions or mini bosses, taking specific paths to avoid dangers. Sometimes the knowledge is accurate, and sometimes its completely wrong. Sometimes that adventurer should return leading a party the next time he returns, with all of their party knowing what he knows from his last visit to the dungeon.

---

## Dungeon mechanics (end-of-day choice)

If all the adventures have been killed, or decided to leave the dungeon because they don't think they will survive. I want me (the boss) to get a choice at the end of each day provided to me to change the mechanics, and other stuff about the dungeon so that the dungeon can change in certain ways, making the adventurers have to come up with new strategies to beat my dungeon. These choices should be called "Dungeon Mechanics" and should sometimes come with a strategic trade-off. Here are some examples:

1. **Mimicry Plague** = 20% of all loot chests have a chance to be a Mimic when opened by an adventurer. Trade-off: mimics count as minions, so adventurers killing them gain XP from them
2. **Taxation of Souls** = Adventurers lose 5% HP when entering a new room. Trade-Off: You gain less XP from killing them because they were already weakened.
3. **Gravitational Anomaly** = Projectiles move 50% slower; melee deals 20% more damage. Trade-Off: Great against Rangers/Mages, but makes your melee Minions vulnerable.
4. **Cursed Fountains** = turns the water in healing fountain rooms into acid to damage adventurers instead of heal them.
5. **No Health Regeneration** = Adventurers cannot heal while sleeping
6. **Memory Fog** = adventurers who sleep in the dungeon forget 50% of what they learned. Trade-off: they heal faster.
7. **Eternal Night** = adventurers can't see past 1 room. Trade-off: your minions also have reduced patrol range
8. **Hunger** = adventurers lose 1 HP per minute in the dungeon. Trade-off: ?
9. **Bloodbound** = your minions deal +50% damage but die permanently (no respawn) instead of regenerating overnight
10. **Knowledge is Pain** = Adventurers take +10% damage in rooms they've already cleared. The more they know, the more the dungeon resists them. Directly punishes returning experienced adventurers. Trade-off: First-timers are completely unaffected. Guilds start sending fresh rookies first to scout instead of their veterans.
11. **Paranoia Protocol** = All chests, doors, and fountains have a visible 10% chance indicator — whether or not they're actually trapped. Adventurers see "10%" on everything, even safe objects. The uncertainty is the trap. Trade off: ?
12. **Spectral Reinforcements** = Ghosts of previously killed adventurers appear as hostile phantoms in the rooms where they died. They fight with the abilities they had when they died. Rooms with high kill counts become haunted gauntlets. Trade-off: Spectral adventurers deal spirit damage that also affects your living minions. Rooms with many ghosts become chaotic for everyone.
13. **Loot Curse** = All loot dropped in the dungeon is cursed. Adventurers who pick it up gain the stat bonus but also a hidden debuff that worsens over time. They don't know until it's too late. Trade-off: The curse can be cleansed by a cleric. If there's a cleric in the party, this mechanic is neutralized entirely. Also, Greedy adventurers hoard cursed loot faster.

The trade-off should really make you think before choosing them. **I want tons and tons of different mechanics and trade offs to be added.**

---

## Adventurer goals

I want different adventures to enter the dungeon with different goals, for example some can be hunting for certain loot from mini bosses or secret rooms in the dungeon. Or they can just be there to farm and level up.

---

## Loot equipping & minion XP

Whenever an adventurer dies in a dungeon I want to be able to equip their gear they dropped to minions and monsters in my dungeon. Minions and monsters that kill an adventurer should gain experience and level up so that they become stronger and harder to kill.

---

## Dungeon expansion

As the game goes on I want the ability to place new dungeon rooms to expand my dungeon. Rooms like trap rooms, treasure rooms guarded by a mini boss, secret rooms that adventures can stumble into, rooms with tons of enemies, and so much more.

My dungeon should start out as a level 1 dungeon, but as I kill more adventurers and expand it levels up. Adventures that enter the dungeon should start at level 1. As the dungeon grows and levels up, so should the adventures. As I kill adventures I should get experience that I can use to level up monsters/minions in the dungeon so they are stronger and get new abilities.

---

## Personalities and class types

I want adventures to have different personalitys and class types that sway how they decided to attempt the dungeon. They can have multiple personality types as the game gets harder as the dungeon levels up. For example I have these Ideas but **we need so many more**:

1. **greedy** — usually tried to go for the loot first and shiny objects
2. **speed runner** — runs past weaker enemies
3. **paranoid** — assumes every door is trapped and every chest is a mimic. Extremely slow, never opens chests voluntarily. Near impossible to kill with traps — but takes forever to reach the boss room and may convince other party members to leave.
4. **party** — four adventures that usually work together and move together
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
18. **Beast tamer** — will try to tame monsters in the dungeon to have them fight by their side
19. **mage** — long rage fighter that uses spells
20. **cleric** — can heal other adventures and deal extra damage to undead monsters/minions
21. **knight** — close combat fighter that tries to protect other adventures
22. **necromancer** — Tries to raise defeated minions to fight for the party. If they succeed, i temporarily lose a minion. but if i have undead minions and a Lich boss type, there's a chance the raised minion turns on the party instead.
23. **twitch streamer** — a rare late game adventurer type with extra features. they enters the dungeon live, with thousands of viewers watching. Their behavior is constantly influenced by chat, making them wildly unpredictable and socially contagious. Their chat votes on decisions in real time as they explore the dungeon. A fork in the path, a suspicious chest, a tough enemy — a poll appears over their head and they follow the majority vote, even if it's obviously suicidal. "PogChamp the chest! PogChamp the chest!" and suddenly a paranoid/streamer type opens a mimic because 60% of chat said so. When they die, chat goes absolutely feral — and their death clip spreads. The next day, a larger party shows up specifically because they saw the stream and want to attempt the dungeon themselves. If they survive, they share a full recorded run — more detailed than even the Cartographer's map, since viewers also spotted things the adventurer missed. These adventurers also have special streamer-like names.

**I want a large amount of different personalitys and class types like these.**

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

Different types of dungeon room ideas for example:

1. **The Hall of Echoes** — Any sound made in this room alerts minions in the adjacent rooms. Perfect for setting up an ambush for Speed Runners.
2. **The False Exit** — A room that looks like a way out but send the player to a random location in the dungeon instead. It's a "Stamina Drainer" for parties trying to escape.
3. **The Treasure Room** — lures more adventurers to the dungeon so I can gain more xp but hold valuable items that can make the adventures stronger if they get to it.
4. **The Healing Fountain Room** — A room that looks like a safe haven. Adventurers will stop to "Sleep" or "Heal" here leaving them vulnerable to being attacked by patroling minions/monsters while they sleep.
5. **The Necropolis Wing** — A special late-game room that turns every adventurer corpse that dies in it into a weak skeleton minion permanently. Not respawnable, no XP — but they were once adventurers, so they "remember" the dungeon layout and patrol the dungeon suspiciously well.
6. **The Colosseum** — A large arena room. When adventurers enter, doors lock and waves of minions spawn. The trick: there's a lever mid-room the party has to reach to open the exit. Greedy types ignore the lever to loot the mini boss first.
7. **The Mirror Maze** — A room full of reflective pillars. Adventurers can lose track of each other. Minions with stealth thrive here. Cartographers are less effective — the map geometry is intentionally disorienting.
8. **The Obelisk Room** — A dark room with a glowing obelisk. Standing near it heals adventurers — but slowly charges a trap that summons a wave of minions when fully charged. Do they heal or rush through? They decide based on their personality/type.
9. **Barracks** — Minions actively sleep here between patrols. Parties can sneak through silently — but any combat wakes everyone. The Speedrunner wants to dash through. The Paranoid refuses to move until every minion is dead.

**I want many many different rooms that can be added to the dungeon.**

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

## Mana / Essence economy

Mana/Essence economy where every room, trap, and minion has an upkeep cost paid daily from XP harvested. Overbuild and your dungeon starts shutting off rooms.

---

## Architectural rules

Some traps need power from a Core room; minions need a Barracks within N rooms; treasure rooms must be 3+ rooms deep. Layout of the dungeon should be a puzzle.

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

Replace the current 15 archetypes with **10 specific monster-type bosses**. Each has one *headline mechanic* that defines how the game feels to play, plus a couple of supporting modifiers. The goal: every pick should change which rooms you build, which minions you favour, and what the win condition feels like — no two bosses doing the same thing.

The 10 bosses:

### 1. Beholder — Information Warfare
- **Headline: Omniscient Eye.** Player sees full stats / personality / inventory / next-room intent of every adventurer the moment they enter. In return, adventurers always have rumour-grade intel on the dungeon — neither side can surprise the other.
- Floating Eye minions cost no essence (cap 1 per room).
- Once per day, mark a tile; any adventurer that steps on it next turn loses half HP from a death-stare.
- *Plays like: chess with all pieces face-up.*

### 2. Demon — Faustian Bargains
- **Headline: Daily Contract.** Every dawn, an infernal bargain appears — accept and gain a powerful effect (huge essence, free room tier-up, stat boost) at a price (sacrifice a minion, lose a boss life, all advs tomorrow are +1 tier). Player must accept *something*; the only choice is which.
- Adventurer corpses auto-rise as Imp minions (free, weak, expire after 1 day).
- Hellfire traps cost Dark Power instead of Essence.
- *Plays like: push-your-luck negotiations.*

### 3. Myconid — Patient Growth (renamed from Ent 2026-04-28 to match available portrait art)
- **Headline: Living Dungeon.** Every placed room gains +1 *growth tier* at the end of each day, accumulating permanent buffs (more HP, extra trap fires, denser minion spawns). Weak early, monstrous late.
- Corridors slowly overgrow — every 3 days a corridor tile reverts to wall, forcing detours.
- Treant minions regenerate between fight rounds. *(Note: minion flavor still tree-themed; consider reskinning to fungal/spore creatures when mechanic ships.)*
- *Plays like: survive early, dominate late.*

### 4. Wraith — Psychological Warfare
- **Headline: Fear Meter.** Adventurers accumulate FEAR each time they see a corpse, hear a scream, or trigger a trap. At thresholds they panic-flee, attack their own party, or drop loot. You don't kill them — you *break* them.
- Minions can phase through walls when fleeing (escape bad fights without dying).
- "Haunt" traps deal psychic damage proportional to current FEAR (worthless on fresh advs, devastating on rattled ones).
- *Plays like: attrition + crowd control.*

### 5. Gnoll — Pack Aggression
- **Headline: Hunger & Pack Bonus.** Place a single Gnoll, get a pack of 3 (each at –33% stats). Killing an adventurer fully feeds the pack and grants +20% ATK for the rest of the day. Unfed packs grow weaker each day instead — you must keep killing to stay strong.
- Bonus damage when adventurers are in groups of 2+ (pack-hunts parties).
- Scavenger sub-minion auto-loots corpses for extra essence.
- *Plays like: snowball with momentum, starve and collapse.*

### 6. Golem — Fortress Mode
- **Headline: Reinforced Construction.** No traps, no minion variety — but you get **Reinforce** (1×/night, double a chosen room's HP and stat output) and exclusive Stone Wall tiles that block pathing entirely. Boss is immobile but +50% HP/DEF.
- Healing fountains restore minions to full instantly each dawn.
- Minions move 30% slower but hit 30% harder.
- *Plays like: defensive engineering, choke-point design.*

### 7. Lich — Soul Economy
- **Headline: Phylactery.** Place an item in any room as the boss's spare life — die in a fight and respawn there. Adventurers can hunt and destroy it; only one phylactery exists at a time, moving it costs a full day. The whole game becomes "where do I hide my second life?"
- Every adventurer kill banks a soul; spend 5 to skip a day's incoming party.
- Skeleton minions are free, capped 1/room.
- *Plays like: resource hoarding + hidden objective.*

### 8. Lizardman — Hidden Strikes
- **Headline: Hidden Traps.** Traps don't show up in adventurer rumour intel until they kill someone — every trap is a free first hit. After the first kill, the rumour pool starts knowing about it normally.
- Cold-blooded: minions weaker in fire rooms, stronger in water rooms (room temperature matters).
- All minion attacks apply 1-stack poison (DoT).
- Egg-laying: kills have 25% chance to spawn a free juvenile minion in that room.
- *Plays like: ambush, attrition, surprise.*

### 9. Orc — WAAAGH! Scaling
- **Headline: Loot the Fallen.** Every orc minion permanently keeps gear from adventurers it kills (+1 ATK per kill, no cap). Late-game veterans become walking arsenals — but cannot use any "magic"-tagged room (no alchemy, scrying, mirror maze).
- Brawl pit: if 3+ adventurers are in a room, orcs there deal 2× damage.
- Boss has +50% ATK / –25% DEF (glass berserker).
- *Plays like: brute-force damage scaling, anti-magic lockout.*

### 10. Vampire — Charm & Conversion
- **Headline: Charm.** Once per day, mark an adventurer — they leave their party, walk to the boss room willingly, and either join you as a thrall minion or get drained for massive essence. Player's call.
- Vampire minions lifesteal 50% of damage dealt.
- Cannot use any "light"-tagged room (no torches, healing fountains, sun-shrines).
- Charmed adventurers killed in your dungeon convert to vampire spawn at the next dawn.
- *Plays like: manipulation, conversion, sustain.*

### Niche coverage

| Boss | Playstyle |
|---|---|
| Beholder | Information / pre-emption |
| Demon | Risk/reward bargaining |
| Myconid | Slow scaling |
| Wraith | Psychological / debuff |
| Gnoll | Snowball / momentum |
| Golem | Fortify / turtle |
| Lich | Resource hoarding + hidden objective |
| Lizardman | Stealth / attrition |
| Orc | Brute scaling / lockout |
| Vampire | Conversion / sustain |

### Implementation notes (deferred until ready)
- Replaces `bossArchetypes.json` and the entire archetype-modifier wiring (`AISystem._kill` essence multiplier, `EvolutionSystem` XP multiplier, `NightPhase` trap palette filter, etc.).
- Each headline mechanic is non-trivial — many need new systems (Fear Meter, Phylactery hunt target, growth tiers, hidden-trap intel masking, loot-stat carryover on minions, charm flow). Plan to land them as a coherent group in their own phase.
- ArchetypeSelect carousel UI stays — just re-skinned with the 10 monster types.
- Existing 15 archetypes can be preserved as legacy/unlockable variants OR retired entirely; defer that call to implementation time.

---

## Loot stories

Every piece of gear in the dungeon should have a story. For example: When a Knight dies dropping his Flameblade weapon and i re-equip that Flameblade onto a Skeleton minion, the knights brother could only want to enter the dungeon to specifically hunt down that skeleton to reclaim his brothers weapon.

- So gear should remember its history (for example: small text: "wielded by Sir Aldric, killed in Room 7")
- Adventurers having vendettas against specific minions ("avenge my brother" quests)
- Cursed loot you can deliberately let them take, that hurts them

---

## Trap types

There should be a variety the usual traps (spike traps, arrow traps, pitfall traps, and more) but there should also be of interaction traps I can place in the dungeon. interesting traps are ones that interact with adventurer behavior for example these plus many many more:

1. **Greed Trap** — only triggers if an adventurer picks up loot (perfect for Greedy types)
2. **Whisper Trap** — only triggers when adventurers talk strategy (hits parties harder than solos)
3. **Patience Trap** — pressure plate that only triggers if you stand still for 3+ seconds (counters Paranoid)
4. **Speed Trap** — triggers if you move too fast through the room (counters Speed runners)
5. **Mercy Trap** — triggers when an adventurer heals an ally
6. **Torch Trap** — triggers when light is brought into a dark room
7. **Echo Mine** — triggers on the second footstep, so the leader is safe but the follower dies
8. **Memory Trap** — only affects adventurers who've been in this room before (punishes returning parties)
9. **Curse Brand Trap** — Brands a random adventurer with a glowing mark. Monsters in the dungeon now prioritize that target. Doesn't deal damage — just redirects all aggro.

---

## Progressive unlocks

As you play the game you should not have access to all rooms, minion types, and so on. As the dungeon levels up, so should your options of rooms and minions and traps and more that you can place.

---

## Reputation system

The game gets harder over time through a reputation system. The dungeon gets a Reputation Score — a public legend that grows as adventurers tell stories of their failures to other adventurers. High rep attracts better loot hunters, legendary heroes, and guild raids. Low rep makes solo scrubs feel confident enough to attempt it.

---

## Bounty hunters

After a minion kills 3+ adventurers, bounty hunters specifically enter the dungeon to slay it. The minion or monster can get a wanted poster and the poster includes the minion's name, kills, and current gear — making that minion feel famous.

---

## Adventurer resources

Adventurers should also enter the dungeon with limited resources. For example, a ranger has a limited number of arrows before they decide to leave the dungeon and come back another day. The mage can run out of mana to cast spells if he doesn't have enough mana potions and may need to stand still in the dungeon to concentrate and regen their mana. Adventurers can being in health potions to heal themselves, but may run out and become more vulnerable to death. And more like this.

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

## Adventurer graveyard UI

A persistent screen outside of the main dungeon view that shows every adventurer who has ever died in your dungeon. Their name, class, personality, how they died, what killed them, and how far they got. This costs almost nothing to build but adds enormous emotional weight to the game. Players will start recognizing names, feeling bad about killing certain adventurers, and celebrating when a recurring nemesis finally falls. It also makes the gear history system you already planned feel much more meaningful when you can look up exactly who Sir Aldric was before his Flameblade ended up on your skeleton.

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

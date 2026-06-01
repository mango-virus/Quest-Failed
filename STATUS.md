# Quest Failed — Current Status (source of truth for "what exists")

> **Read this FIRST each session.** It is the short, reality-derived snapshot of what
> is actually built right now. When it disagrees with `DESIGN_COVERAGE.md`,
> `ARCHITECTURE.md`, or any memory, **this file + the code win.**
>
> Last verified against code: **2026-05-31**.
>
> Rule: the **code is the source of truth for what exists**. Counts below were read
> straight from `src/data/*.json` and `src/systems/`. Before asserting any feature is
> "done" or "missing," grep/read the actual code — never trust a ✅ in another doc blindly.

---

## What the game is

Top-down **reverse roguelike**. You are the dungeon **Boss/Architect**. NPC adventurers
invade by Day to kill you; you build the dungeon by Night. Endless — the boss levels up,
adventurers scale with it. Boss dies 3 times → Game Over → new run. No win condition yet
(it's pure survival). Phaser 3 canvas (dungeon sim) + a DOM HUD overlay (all chrome/menus).
Vanilla JS ES modules, no build step, static deploy. Live at mango-virus.github.io.

## Content counts (verified 2026-05-31)

> These counts are mechanically checked: run **`npm run verify-docs`** to confirm every count
> below still matches `src/data/`, or **`npm run verify-docs:fix`** to auto-update them from the
> data. The check exits non-zero on any mismatch (`tools/verify-docs.mjs`).

| Content | Count | File | Notes |
|---|---|---|---|
| Boss archetypes | **12** | `bossArchetypes.json` | beholder, demon, myconid, wraith, gnoll, golem, lich, lizardman, orc, vampire, succubus, slime. All have wired headline abilities. **Base fight stats are flat (200/12/10) across all 12** — differentiation is abilities-only (deferred stat-profile pass). |
| Rooms | **21** | `rooms.json` | ~16 have wired behaviors in `RoomBehaviorSystem.js`; the rest are pure layout. |
| Minions | **64** | `minionTypes.json` | Families × tiers (e.g. goblin1/2/3, slime1–9, skeleton1/2/3). |
| Evolution chains | **22** | `minionEvolutions.json` | Evolution data lives HERE, not in `minionTypes.json`'s `evolutionPaths` (which is empty by design). |
| Traps | **8** | `trapTypes.json` | shooting_arrows, bomb, cannon, spike_pillar, dragon_trap, spike_pit, rotating_blades, saw_blade. Fully wired in `TrapSystem.js`. **(NOTE: older docs/memories that say traps are unimplemented are STALE — traps shipped.)** |
| Pacts (dungeon mechanics) | **96** | `dungeonMechanics.json` | 9 common · 14 uncommon · 24 rare · 9 epic · 16 legendary · 24 damned. |
| Events | **36** | `events.json` | Incl. scripted set-pieces: Solo Leveling (Shadow Monarch), Light Party (FFXIV trinity), Rival Dungeon, Loot Goblin Heist, etc. |
| Adventurer classes | **25** | `adventurerClasses.json` | 6 core (knight/rogue/mage/cleric/necromancer/ranger) + expansions + event-only (unlockLevel 99). |
| Personalities | **17** | `personalities.json` | greedy, paranoid, speed_runner, completionist, martyr, coward, overconfident, cartographer, solo, raid_leader, underdog, inquisitor, vulture, traumatized, the_fan, echo, mimic_handler. |
| Personality combos | **0** | `personalityCombos.json` | **RETIRED (Phase 5c).** File is empty; `PersonalitySystem` combo path is a no-op kept for call-site compat. Do NOT treat as "done". |
| Companions | **9** | `companions.js` | lilith, safira, rattlebones, necroknight, nocturna, malakor, spectra, luna, zulgath. 3 starters (lilith/malakor/safira), rest unlock via achievements. |
| Achievements | **92** | `achievements.json` | 34 progression · 20 combat · 4 economy · 18 variety · 16 mastery. 9 boss unlocks + 5 companion unlocks + titles. |

## System maturity (what's solid vs. stubbed)

**Solid / shipped:**
- Adventurer AI (`AISystem.js`, ~4.8k lines) — goal stack, knowledge-gated decisions, party
  warnings, flee logic, anti-thrash watchdogs. Genuinely deep.
- Combat (`CombatSystem.js`), pathfinding (A*, knowledge-weighted), boss fight (auto-resolved + cinematic).
- Knowledge system (4-tier FULL/PARTIAL/RUMOR/UNKNOWN, inheritance, staleness).
- Economy (boss-level + day cost scaling, treasury stipend, chest passive income).
- Full DOM HUD (`src/hud/`, ~60 modules) — default on (`newhud` flag). Settings, saves, achievements, leaderboard, companions, cinematics all live.
- Audio (SfxSystem + music), VFX/juice (phase transitions, boss-fight overlay, event banners, floating numbers).
- Meta-progression: per-name `PlayerProfile`, Supabase leaderboard, achievements, companion/boss/title unlocks.

**Stubbed / partial / deferred (don't assume these work):**
- **Personality combos** — retired/empty (see above).
- **Special minion roles** — scavenger, mimic_handler, engineer, mourner, echo are partially/not implemented despite older "✅ DONE" claims.
- **Boss per-archetype base stats** — flat 200/12/10; differentiation deferred.
- **Personality data** — carries dead fields (`decisionOverrides`, `reactions`, unused tags); full revamp pending. Don't fix personality bugs in isolation — wait for the rework.
- **Nocturna achievement unlock** — pending (her character work in progress).

## Biggest design gaps for a "full game" (not bugs — direction)

- **No win condition / no climax** — endless survival, numerical treadmill late-game.
- **Day phase is spectator-only** — no active boss agency (the Marionette pact hints at what could be).
- **IP/legal** — Solo Leveling / FFXIV / Twitch named references need filing-off before any commercial release.

See `DESIGN.md` for original intent and `DESIGN_COVERAGE.md` for the full per-feature ledger.

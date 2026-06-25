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
>
> ⛔ **Steam-bound:** this is a commercial game now — visuals/VFX/animation are first-class.
> Read **`VISUAL_STANDARDS.md`** before any UI/VFX/screen/animation work and verify visuals in
> the preview before committing (gate at the top of `CLAUDE.md`).
>
> 🛠 **Dev tooling — use it:** `npm run sim:balance`/`sim:pacts`/`sim:soak` (headless sim),
> `window.__qfCheck()` (runtime invariants), `window.__qfDev.gallery()` (VFX review); a
> pre-commit hook runs `verify-docs` + `lint-content`. When to use what → the "Dev tooling"
> section in `CLAUDE.md`; full reference → `tools/sim/README.md`.
>
> 🎨 **UI polish push (active, started 2026-06-18):** the prioritized backlog to take the UI
> from "polished game" to "polished **Steam** product" lives in **`UI_POLISH_PLAN.md`** —
> phased (0 sweep → 1 input/accessibility → 2 hero moments → 3 onboarding → 4 discipline),
> worked one item at a time. Read it before starting UI work.

---

## What the game is

Top-down **reverse roguelike**. You are the dungeon **Boss/Architect**. NPC adventurers
invade by Day to kill you; you build the dungeon by Night. Endless — the boss levels up,
adventurers scale with it. Boss dies 3 times → Game Over → new run. The DEFAULT mode is pure
survival (no win condition); a 4-act WIN-CONDITION campaign — "The Kingdom's Reckoning" — is
built + complete behind the `acts` flag (climax duel, kingdom responses, ascension, victory→NG+).
Phaser 3 canvas (dungeon sim) + a DOM HUD overlay (all chrome/menus).
Vanilla JS ES modules, no build step, static deploy. Live at mango-virus.github.io.

## Content counts (verified 2026-05-31)

> These counts are mechanically checked: run **`npm run verify-docs`** to confirm every count
> below still matches `src/data/`, or **`npm run verify-docs:fix`** to auto-update them from the
> data. The check exits non-zero on any mismatch (`tools/verify-docs.mjs`).

| Content | Count | File | Notes |
|---|---|---|---|
| Boss archetypes | **12** | `bossArchetypes.json` | beholder, demon, myconid, wraith, gnoll, golem, lich, lizardman, orc, vampire, succubus, slime. All have wired headline abilities. **Base fight stats are now per-archetype combat profiles** (e.g. Golem 300/8/16 fortress, Demon 160/16/6 glass cannon; avg ≈ centroid 200/12/10) shown on the boss-select screen with comparative bars + a role label. |
| Rooms | **23** | `rooms.json` | ~16 have wired behaviors in `RoomBehaviorSystem.js`; the rest are pure layout. |
| Minions | **64** | `minionTypes.json` | Families × tiers (e.g. goblin1/2/3, slime1–9, skeleton1/2/3). |
| Evolution chains | **22** | `minionEvolutions.json` | Evolution data lives HERE, not in `minionTypes.json`'s `evolutionPaths` (which is empty by design). |
| Traps | **8** | `trapTypes.json` | shooting_arrows, bomb, cannon, spike_pillar, dragon_trap, spike_pit, rotating_blades, saw_blade. Fully wired in `TrapSystem.js`. **(NOTE: older docs/memories that say traps are unimplemented are STALE — traps shipped.)** |
| Pacts (dungeon mechanics) | **92** | `dungeonMechanics.json` | 9 common · 14 uncommon · 24 rare · 9 epic · 16 legendary · 24 damned. |
| Events | **33** | `events.json` | Incl. scripted set-pieces: Rival Dungeon, Loot Goblin Heist, Cartographer's Convention, etc. (Solo Leveling + Light Party removed 2026-06-22 for IP.) |
| Adventurer classes | **28** | `adventurerClasses.json` | 6 core (knight/rogue/mage/cleric/necromancer/ranger) + expansions + event-only (unlockLevel 99). |
| Personalities | **18** | `personalities.json` | **AI & Personality Overhaul roster (2026-06-10):** greedy, paranoid, completionist, martyr, coward (reworked: trail+avoid-fights), overconfident, cartographer, solo, raid_leader, underdog (reworked: nerve-arc), vulture, traumatized, echo, **+ veteran, berserker, scholar, zealot, claustrophobe (new)**. CUT: speed_runner, the_fan, mimic_handler. **FLAT ROLL** — all equal-chance + ungated (rarity weighting + unlockLevel gate removed). Now driven by the nerve/appraisal/social substrate (NerveSystem `nerve{}` fields, real `decisionOverrides`). (Inquisitor removed 2026-06-09.) |
| Personality combos | **0** | `personalityCombos.json` | **RETIRED (Phase 5c).** File is empty; `PersonalitySystem` combo path is a no-op kept for call-site compat. Do NOT treat as "done". |
| Companions | **9** | `companions.js` | lilith, safira, rattlebones, necroknight, nocturna, malakor, spectra, luna, zulgath. 3 starters (lilith/malakor/safira), rest unlock via achievements. |
| Achievements | **91** | `achievements.json` | 34 progression · 20 combat · 4 economy · 18 variety · 16 mastery. 9 boss unlocks + 5 companion unlocks + titles. |

## System maturity (what's solid vs. stubbed)

**Solid / shipped:**
- Adventurer AI (`AISystem.js`, ~4.8k lines) — goal stack, knowledge-gated decisions, party
  warnings, flee logic, anti-thrash watchdogs. Genuinely deep.
- Combat (`CombatSystem.js`), pathfinding (A*, knowledge-weighted), boss fight (auto-resolved + cinematic).
- Knowledge system (4-tier FULL/PARTIAL/RUMOR/UNKNOWN, inheritance, staleness).
- Economy (boss-level + day cost scaling, treasury stipend, chest passive income).
- Full DOM HUD (`src/hud/`, ~60 modules) — the only HUD (the legacy Phaser chrome + `newhud` flag were retired in UI-polish P0-6). Settings, saves, achievements, leaderboard, companions, cinematics all live.
- Audio (SfxSystem + music), VFX/juice (phase transitions, boss-fight overlay, event banners, floating numbers).
- Meta-progression: per-name `PlayerProfile`, Supabase leaderboard, achievements, companion/boss/title unlocks.

**Stubbed / partial / deferred (don't assume these work):**
- **Personality combos** — retired/empty (see above).
- **Special minion roles** — scavenger, mimic_handler, engineer, mourner, echo are partially/not implemented despite older "✅ DONE" claims.
- ~~**Boss per-archetype base stats** — flat 200/12/10; differentiation deferred.~~ **DONE** — distinct per-archetype combat profiles (centroid-neutral), shown on boss-select. (Late-game: base *ratios* compress under the shared `(base + 15·lvl)·1.20^lvl` curve — a follow-up could add per-archetype scaling multipliers if sharper high-level identity is wanted.)
- **Personality data** — carries dead fields (`decisionOverrides`, `reactions`, unused tags); full revamp pending. Don't fix personality bugs in isolation — wait for the rework.
- **Nocturna achievement unlock** — pending (her character work in progress).

## Biggest design gaps for a "full game" (not bugs — direction)

- **No win condition in the DEFAULT (endless) mode** — numerical treadmill late-game. **ADDRESSED for campaign mode:** "The Kingdom's Reckoning" 4-act win-condition campaign is **BUILT + complete** (P1–P7 + polish, ✅ 2026-06-02) behind the `acts` flag — fixed Acts I/IV + drafted Kingdom Responses (II/III), the Aldric nemesis + Act IV climax duel (real per-act sprites + cinematic), boss ascension/growth, the Inquisition pact-benefit counter, victory → NG+ (Reckoning tiers), per-response VFX. Remaining: enable it by default (currently flag-off), live balance tuning, and a full validation playthrough. See DESIGN_COVERAGE.md §"The Kingdom's Reckoning".
- **Day phase is spectator-only** — no active boss agency (the Marionette pact hints at what could be).
- **IP/legal** — ✅ Solo Leveling + Light Party (FFXIV) set-pieces removed entirely 2026-06-22 (member classes kept but renamed: White Mage→Priest, Black Mage→Sorcerer). (Twitch removed 2026-06-05.)

See `DESIGN.md` for original intent and `DESIGN_COVERAGE.md` for the full per-feature ledger.

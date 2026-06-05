# Headless sim harness (`tools/sim/`)

Runs the **real** Quest Failed game systems in Node with no Phaser canvas, so a
full day/night game resolves in milliseconds and thousands of games can be
batched for balance analysis. This is the "fast-forward + balance report" tool
from the dev-tooling roadmap (Phase B).

## Use it

```bash
npm run sim                       # one full game, per-day trace
npm run sim:balance               # sweep: bosses × bare / defended / building
npm run sim:pacts                 # per-pact Δ(survival) vs baseline — balance outliers
node tools/sim/balance.mjs --runs 100 --boss lich,vampire --build   # building-only
node tools/sim/pactsweep.mjs --rarity legendary --runs 20
node tools/sim/balance.mjs --json # machine-readable
```

`runGame({ boss, maxDays, loadout, pacts, build })`:
- `loadout` — a fixed `{minions:[ids], traps:[ids]}` placed once.
- `pacts` — pact ids sealed at start (via `dungeonMechanicSystem.activate`).
- `build` — `true` or `{stipend, rooms, roomCap, minionCapBase, minionCapPerLv,
  upgrade, ...}`: each night, build **functional rooms** (treasury→income,
  crypt→garrison) up to `roomCap`, take a stipend, buy minions/traps to a cap,
  and invest surplus in minion tier **upgrades**. A growing-dungeon playthrough.

Sample report:

```
  CONFIG               boss-died    days(mean±sd)  med  min  max  kills  finalLv
  lich · bare               100%          6.3±0.8    6    5    8    5.5  1.1 (2)
  lich · defended           100%          9.2±1.5    9    6   12   14.7  2.2 (3)
```

## Files

- `headless.mjs` — runtime: browser-global stubs, a fake Phaser scene (real JSON
  cache backed by `src/data/*` via Preload's key→file map, an advancing clock,
  an instant door-opener), `boot()` (constructs the sim subset of Game.js's
  systems in order), and `frame()` (one faithful `Game.update()` day tick:
  fixed sub-stepping + the AI 1-in-3 throttle).
- `harness.mjs` — `spawnWave()` (faithful `DayPhase` wave-gen: count formula,
  unlock-gated weighted class pick, boss-level stat scaling, personality +
  knowledge init), `buildNight()` (connect entry→boss), `placeLoadout()`
  (scaled minions + traps), `endDay()` (boss/minion HP refill — the day-end
  reset), `runDay()`, `runGame()`.
- `balance.mjs` — batch runner + aggregated report (CLI).

## What it models faithfully

Real `AISystem`/`CombatSystem`/`BossSystem`/`BossArchetypeSystem`/etc. drive
everything: adventurer pathfinding + goal logic, combat, traps, boss fights + XP
leveling, **per-archetype boss mechanics** (charm/phase/phylactery — bosses
genuinely differ), **minion tier upgrades** (the night-building policy evolves
minions; auto-evolve was removed, upgrades are paid), boss/minion HP day-reset,
day-level stat scaling. The fake scene only stands in for rendering/audio/input.

## Known limitations (by design for v1)

- **Night-building is a SIMPLE policy.** With `build`, the dungeon grows (buy
  affordable minions/traps each night), but the policy does not model minion
  *evolution*, *room upgrades*, *boss-ability* unlocks, or economy buildings
  (abstracted as a flat stipend). Those are the *quality* multipliers that carry
  real late-game, so survival plateaus (~10-12 days). It captures the growth
  *dynamic* and is tunable, not optimal play.
- **Some functional rooms modeled, not all.** The build policy now builds
  **treasury** (real scaling gold income) and **crypt** (free garrison Risen
  Bones) — chained off the entry hall. NOT modeled: trap factories, watchtowers,
  most behavior rooms, and the large-maze room-knowledge that long-game / spatial
  pacts (e.g. `great_erasure`) trade on (the dungeon stays small).
- **Generic boss abilities** (the 6 power-cost `bossAbilities.json` picks) and
  **companions** are not modeled. Per-archetype mechanics ARE (BossArchetypeSystem).
- **Pacts** apply via `pacts:[...]`, but their effect under-reads when it depends
  on building (a static/simple dungeon). Global modifiers read faithfully.
  Events are not applied; wave-gen skips pact/event wave modifiers.
- **Unseeded RNG** — results are distributions over N runs, not reproducible
  single runs (seeded RNG was deliberately deferred; see the dev-tooling notes).

If Game.js's system construction or the day-tick changes materially, mirror it
in `headless.mjs` (`boot`/`frame`) — that file names Game.js as its source of
truth.

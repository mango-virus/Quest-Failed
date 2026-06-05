# Headless sim harness (`tools/sim/`)

Runs the **real** Quest Failed game systems in Node with no Phaser canvas, so a
full day/night game resolves in milliseconds and thousands of games can be
batched for balance analysis. This is the "fast-forward + balance report" tool
from the dev-tooling roadmap (Phase B).

## Use it

```bash
npm run sim                       # one full game (bare vs defended), per-day trace
npm run sim:balance               # default sweep: lich/demon/slime × bare/defended
node tools/sim/balance.mjs --runs 100 --days 80 --boss lich,vampire
node tools/sim/balance.mjs --json # machine-readable
```

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

Real `AISystem`/`CombatSystem`/`BossSystem`/etc. drive everything: adventurer
pathfinding + goal logic, combat, traps, boss fights + XP leveling, boss/minion
HP day-reset, day-level stat scaling. The fake scene only stands in for
rendering/audio/input.

## Known limitations (by design for v1)

- **No night-building progression.** The loadout is fixed; the sim does not
  spend gold to add rooms/minions/traps/upgrades or unlock boss abilities each
  night. So it measures *"how long does this fixed dungeon hold against scaling
  waves"* — a comparative baseline, not a full playthrough.
- **Bosses read near-identical** because base fight stats are flat (200/12/10)
  and differentiation is abilities-only (which require night-building). See
  `STATUS.md`. This is a *useful confirmation*, not a bug.
- **No pacts/events** are applied (clean run). Wave-gen skips the pact/event
  wave modifiers.
- **Unseeded RNG** — results are distributions over N runs, not reproducible
  single runs (seeded RNG was deliberately deferred; see the dev-tooling notes).

If Game.js's system construction or the day-tick changes materially, mirror it
in `headless.mjs` (`boot`/`frame`) — that file names Game.js as its source of
truth.

# Quest Failed

**A reverse roguelike dungeon-builder.** You aren't the hero — you're the dungeon. Adventurers
invade by **day** to kill you; you rebuild and re-arm by **night**. Survive, level up, and watch
the kingdom send ever-stronger heroes to die in your halls.

> Originally built for **Ordinary Game Jam #1** — now in active development as a full, commercial
> game heading to **Steam**.

🎮 **Play in the browser:** https://mango-virus.github.io/Quest-Failed/

---

## The loop

You are the **Boss / Architect** of a living dungeon.

- **Night (build phase):** spend gold to place rooms, summon and upgrade minions, set traps, and
  sign **Dark Pacts** — risk/reward modifiers that reshape the run.
- **Day (invasion):** a party of NPC adventurers enters and tries to reach you. They scout, panic,
  flee, and fight based on a deep knowledge-and-morale AI — your job is to make sure they never
  make it out.
- **Endless by default:** the boss levels up and the adventurers scale with it. Die three times and
  the run ends. An optional 4-act **win-condition campaign — "The Kingdom's Reckoning"** — is built
  behind a flag (climax duel, kingdom responses, boss ascension, victory → New Game+).

## At a glance

| | |
|---|---|
| **12** boss archetypes | each with a unique, scaling ability kit |
| **24** rooms · **8** traps | layout + wired behaviors |
| **64** minions / **22** evolution chains | families that upgrade across tiers |
| **92** Dark Pacts | 6 rarities, including 24 "damned" devil's-bargains |
| **29** adventurer classes · **18** personalities | driven by a nerve / appraisal / social AI |
| **35** events · **9** companions · **93** achievements | scripted set-pieces + meta-progression |

## Tech

- **Phaser 3** canvas for the dungeon simulation + a **DOM HUD** overlay (`src/hud/`) for all
  chrome and menus.
- **Vanilla JS, ES modules, no build step.** All game content is data-driven JSON in `src/data/`.
- Deploys as a **static site** (GitHub Pages, on every push to `main`).
- A **desktop build** (Electron, in [`desktop/`](desktop/README.md)) wraps the unmodified web game
  for offline play and the Steam release — see its README for the roadmap (Steam Cloud /
  achievements / packaging).

---

## Run it locally

**Web (dev server):**

```sh
npm install
npm run serve      # serves the repo at http://localhost:8080
```

Any static file server works too — there's no build step. Open `index.html` through a server (not
`file://`, so ES modules load).

**Desktop (Electron):**

```sh
cd desktop
npm install        # one-time: pulls Electron
npm start          # launches the game in a desktop window
```

## Project layout

```
src/
  scenes/      Phaser scenes (Game, NightPhase, menus)
  systems/     simulation: AI, combat, knowledge, economy, bosses, traps…
  hud/         the DOM HUD overlay — every menu / panel / overlay
  ui/          canvas renderers (dungeon, minions, adventurers) + VFX
  data/        all game content as JSON (bosses, rooms, minions, pacts, events…)
tools/         dev tooling — headless balance sim, content linters, sprite baking
desktop/       Electron shell (the Steam-bound desktop build)
```

## Docs

The repo keeps a small set of living reference docs (the **code** is always the source of truth):

- **[STATUS.md](STATUS.md)** — reality-checked snapshot of what's actually built right now (read first).
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — systems, scenes, the two-layer rendering, state schema, gotchas.
- **[DESIGN.md](DESIGN.md)** / **[DESIGN_COVERAGE.md](DESIGN_COVERAGE.md)** — design intent + the per-feature ledger.
- **[VISUAL_STANDARDS.md](VISUAL_STANDARDS.md)** — the visual / VFX / animation bar for the Steam release.

### Dev tooling

```sh
npm run sim:balance     # headless balance sim (real systems, ~18 games/sec)
npm run sim:soak        # randomized crash / invariant finder across the boss×pact space
npm run verify-docs     # check content counts in the docs still match src/data
npm run lint-content    # static content linter (dangling refs, bad evolution/reward graphs)
```

---

## Status

Quest Failed is a **commercial project in active development** — it's playable and content-rich, but
balance, polish, and the Steam build are ongoing. It is **not** licensed for redistribution; all
rights reserved.

Built with the [Universal LPC Spritesheet Generator](https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator)
and other open art (attribution in the asset folders).

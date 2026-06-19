# Quest-Failed — Architecture Reference

> Technical map of systems, scenes, schemas, and cross-cutting patterns.
> **Regenerated from the actual codebase on 2026-05-31** (the prior version was
> ~6 months stale and referenced deleted systems / a pre-DOM-HUD world).
>
> For "what content exists / what's done," read **`STATUS.md`** first — it's the
> short, reality-derived ledger. This file is the *how it's wired* companion.
> When this file and the code disagree, **the code wins** — update this file.

---

## 1. Game concept

Top-down reverse roguelike. The player is the dungeon **Boss/Architect**. NPC
adventurers invade during the **Day Phase** to kill the boss; the player builds the
dungeon during the **Night Phase**. Endless: the boss levels up from kills, adventurers
scale with boss level + day number. Boss is defeated 3 times → Game Over (eulogy) → new run.

Loop: **Night (build) → Day (watch the invasion sim) → End-of-Day (summary + level-ups +
pick a Dark Pact) → Night …**

---

## 2. Tech stack & Phaser config

- **Phaser 3** — owns the canvas, camera, input, and the game loop for the **dungeon
  simulation view**. WebGL preferred (`Phaser.AUTO`).
- **DOM HUD overlay** (`src/hud/`) — all chrome, menus, panels, popups, and cinematics
  are plain-DOM, layered over the canvas. See §4.
- **Vanilla JS, ES modules, no build step** — direct `<script type=module>`, static deploy
  to GitHub Pages. Keep it build-free.
- **portal.js** — jam requirement, **never modify** (inter-game portal travel; lives on MainMenu).
- **Supabase** — backs the global leaderboard (`Leaderboard.js`).

**Phaser config (`src/main.js`):**
- Logical design size **1920×1080**, `Scale.FIT`, `autoCenter`. The DOM HUD uses the same
  1920×1080 logical stage (transform-scaled), so canvas and DOM share one coordinate space —
  that alignment is what keeps the dungeon view inside the HUD frame and makes mouse coords
  line up between layers.
- `backgroundColor: '#000000'` (letterbox bars).
- Text resolution bumped to 3 (crisp small fonts through the FIT downscale).
- Tile size **32px** (`Balance.TILE_SIZE`); world coords = tile × 32. Never hardcode 32.
- Starting grid `STARTING_GRID_WIDTH × STARTING_GRID_HEIGHT` (see `balance.js`), expands with
  boss level toward a max.
- `window.__game` = the Phaser game instance (console-debug handle).

**`src/main.js` also installs:** a localhost-only Page Visibility shim (forces
`document.hidden=false` so the Claude preview pane doesn't background-throttle the render
loop), the custom pixel cursor, a debounced resize→scene-restart pass (with a
`NON_LAYOUT_SCENES` skip-list so live-run scenes aren't restarted), canvas-scale recovery on
focus/visibility, and a game-wide contextmenu suppressor.

---

## 3. Scene flow & lifecycle

Scenes are registered in `src/main.js` in this order. Most gameplay scenes are **overlays
that coexist** rather than replace each other.

```
Boot → Preload → MainMenu ──▶ CompanionSelect ──▶ ArchetypeSelect ──▶ Game (+NightPhase/DayPhase + HudScene)
                    │                                                      │
                    ├─ Options / Leaderboard (aux)                        ├─ EndOfDay (overlay between waves)
                    └─ RoomTileEditor (cheat-gated tool: rooms/tiles/themes/skins) └─ GameOver → Graveyard
```

- **Boot / Preload** — asset load (`Preload.js` loads sprites, themes, audio, all `data/*.json`
  into the Phaser JSON cache, and dynamically inits late systems like AchievementSystem).
- **MainMenu** — early-returns and mounts the DOM `MainMenuOverlay` (the only
  menu surface). portal.js lives here.
- **CompanionSelect / ArchetypeSelect** — pick keeper (companion) + boss archetype. Both have
  DOM-overlay counterparts.
- **Game** — the persistent world host scene. Owns the dungeon renderer, camera, and most
  world-space systems. Does **not** sleep while NightPhase/DayPhase run on top of it.
- **NightPhase** — build-mode overlay (placement, MOVE/SELL/UPGRADE tools, wave preview).
- **DayPhase** — watch-mode overlay (spawns the wave, runs the sim, time-speed control).
- **HudScene** — always-on overlay; builds/tears down the DOM HUD (`HudRoot`) and owns the
  Phaser-side `BossArchetypeUI` (in-world VFX + room/minion targeting).
- **EndOfDay** — popup-chain controller (Post-Wave Summary → Boss Level-Up(s) → Dark Pact(s)).
- **GameOver / Graveyard** — eulogy + persistent adventurer graveyard.
- **KnowledgeScreen** — legacy full-screen knowledge map (DOM `KnowledgeMapOverlay` is the
  current surface).
- **Options / Leaderboard / PauseMenu** — aux scenes (DOM overlays are the live surfaces).
- **RoomTileEditor** — cheat-name-gated in-game authoring tool for rooms, tiles, themes, and
  full-room skins (writes back to disk via File System Access API; see `FsHandle.js`). The old
  standalone TilesetEditor was folded into its ⚙ Themes + 🎨 Skins modals and removed.

**Scene shutdown gotcha:** Phaser does NOT auto-call a scene class's `shutdown()` on
`scene.stop()` — it only fires a `shutdown` event. Game, NightPhase, DayPhase, EndOfDay, and
KnowledgeScreen each bind `this.events.once('shutdown', this.shutdown, this)` at the top of
`create()` so their systems actually tear down and unsubscribe from EventBus. Omitting this
binding in a new scene leaks every system it constructs.

---

## 4. The two rendering layers (key architectural fact)

There are **two layered UIs**, and most "UI" work today happens in the DOM layer:

1. **Phaser canvas** (`src/ui/` renderers) — the world-space dungeon view: rooms, tiles,
   minions, adventurers, traps, VFX, world-anchored bubbles/overlays. Examples:
   `DungeonRenderer`, `AdventurerRenderer`, `MinionRenderer`, `BossRenderer`, `TrapRenderer`,
   `TreasureChestRenderer`, `ChatBubbles`, `CartographerOverlay`, `KnowledgeOverlay`,
   `AbilityVfx`, `BossPactVfx`, `CoinBurstRenderer`.

2. **DOM HUD** (`src/hud/`, ~60 modules) — all chrome, menus, panels, popups, toasts, and
   cinematics. Mounted into `#hud-root` / `#hud-stage` via `HudRoot.js`, scaled to the same
   1920×1080 logical stage as the canvas (`stageScale.js`). This is the **default** UI.

**The DOM HUD is the only HUD.** The old `newhud` feature flag and the legacy Phaser
chrome it gated (`BossTopBar`, `ActionBar`, `BuildMenu`, `MiniMapPanel`, `KnowledgePin`,
`DungeonLog`, and all of `src/ui/popups/*`) were **retired 2026-06-18** (UI_POLISH_PLAN
P0-6): the flag function, its `?newhud=0` / `localStorage.newhud='0'` branches, and those
modules were deleted. When touching chrome/menus/panels/popups, work in `src/hud/`.
(`src/ui/` still hosts the world-space Phaser **renderers** — see layer 1 above.)

DOM↔canvas coordinate bridge: world position → screen px is
`(worldX − cam.scrollX) × cam.zoom` (FIT mode keeps canvas logical px == stage logical px).
Used by `DungeonFx` floating numbers and `RoomTooltip` hover.

---

## 5. GameState — the serializable contract

`createGameState()` (`src/state/GameState.js`) builds the run state. **It must stay
JSON-serializable — plain objects only, no class instances.** `SaveSystem` rehydrates it on
load. Top-level shape:

- **`meta`** — `version`, `dayNumber`, `bossDefeatedCount`, `runId`, `phase`
  (`'night'|'day'`), `companionId`, `introSeen`, `tutorialEnabled`, `seenTutorials`.
- **`player`** — `bossArchetypeId`, `bossEvolution{unlockedAbilities, appliedEvolutions}`,
  `gold`, `totalKills`, `totalDaysElapsed`.
- **`dungeon`** — `gridWidth/Height`, `tiles` (2D int grid), `rooms[]`, `corridors[]`,
  `traps[]`, `lootPiles[]`, `locks[]`, `keyChests[]`, `beacons[]`, `fountains[]`,
  `treasureChests[]`, `activeMechanics[]`, `expansions[]`.
- **`minions[]`** — live minion instances (plain objects).
- **`adventurers`** — `{ active[], known[], graveyard[] }`.
- **`guilds[]`**, **`history`** `{ days[], events[], pacts[] }`.
- **`run`** — `{ startedAt, totals{ kills, dmgDealt, dmgTaken, advsKilled, advsEscaped, gold,
  souls, roomsBuilt, roomsDestroyed, minionsSummoned, minionsLost, trapsPlaced, trapsDisarmed }}`.
- **`knowledge`** — `{ sharedPool{rooms,traps,enemiesPerRoom,loot}, survivors[], partyWipeOccurred }`.
- **`events`** — `{ nextEventDay, lastEventId, scheduledId }` (EventSystem scheduler state).
- **`unlocks`** — `{ rooms[], minionTypes[], trapTypes[], dungeonMechanics[], bossAbilities[],
  archetypes[] }`.

`boss` live stats (hp/maxHp/level/xp/xpToNext/deathsRemaining/unlockedAbilities) are managed
at runtime by `BossSystem` (note: `meta.bossDefeatedCount` + `deathsRemaining` track the
3-lives game-over condition).

> Note: `unlocks.archetypes` in the bootstrap still lists the **legacy** 5 archetype ids
> (`the_lich`, `the_architect`, …). Live archetype selection uses the current 12 monster-boss
> ids from `bossArchetypes.json` via ArchetypeSelect — the bootstrap list is vestigial.

---

## 6. Systems catalog (`src/systems/`)

**Simulation core**
- `EventBus.js` — central pub/sub. Everything communicates through it; scenes/systems never
  call each other directly. New systems subscribe/emit and unsubscribe in `destroy()`.
- `DungeonGrid.js` — tile grid, room placement + doorway auto-snap/auto-connect, validation,
  effective cost / max-per-dungeon resolution, grid expansion.
- `AISystem.js` (~4.8k lines) — per-adventurer decision-making: goal stack, knowledge-gated
  goal picking, flee logic, party warnings, treasure-seeking, event-role overrides (Speedrunner,
  Shadow Monarch, Light Party, Treasure Hunters, Saboteur, Cartographer…), anti-thrash/anti-loop
  watchdogs. Reads/writes `worldX/worldY` consumed by `AdventurerRenderer`.
- `PathfinderSystem.js` — A* with knowledge-weighted tile costs + soft-block costs + doorway
  lane gating; per-frame repath budget.
- `CombatSystem.js` — real-time combat resolution, crit/dodge/aura/class-ability hooks, typed
  kill events, pact damage multipliers, percentage-based boss defense.
- `MinionAISystem.js` / `MinionAbilities.js` — minion behavior (guard/patrol/roam/ambush/support)
  + special abilities (lifesteal, ranged, heal, etc.).
- `BossSystem.js` (~4.5k lines) — boss stats/scaling/XP/leveling, auto-resolved boss fight +
  cinematic layer, phylactery redirect, Shadow Monarch / Light Party duel scripts.
- `BossArchetypeSystem.js` — per-archetype headline abilities (Petrify, Sacrifice, Spore
  Network, Fear Meter, Phylactery, Earthquake, Charm, Necromancy, …).
- `KnowledgeSystem.js` — adventurer intel: per-room/trap/minion observation, 4-tier
  FULL/PARTIAL/RUMOR/UNKNOWN, flee-share with personality accuracy, inheritance on spawn,
  staleness on dungeon mutation. `getIntelReport()` is the authoritative intel API (don't
  re-derive tiers from `sharedPool` fields).
- `PersonalitySystem.js` — personality behavior-weight blending. **Combo path is retired/no-op**
  (`personalityCombos.json` is empty).
- `ClassAbilitySystem.js` — adventurer class abilities.
- `TrapSystem.js` — trap placement, slot caps (Trap Factory gateway), firing, break/rebuild.
- `RoomBehaviorSystem.js` — per-room behaviors (Crypt spawn, Treasury stipend, Barracks
  respawn, Library forecast, Watchtower first-strike, Wandering Gate teleport, Veil intel-wipe,
  Mimic Vault, etc.). Hooks: `onNightStart` / `onDayStart` / `onAdventurerEnter`.
- `EvolutionSystem.js` / `MinionEvolutionSystem.js` — kill-method-driven minion evolution.
- `LightPartyAi.js` — Light Party (FFXIV) event role AI (tank provoke, healer raise, LB gauge).
- `RivalBossShowdown.js` — Rival Dungeon event (rival boss vs. player boss).
- `InquisitorSystem.js` — inquisitor mechanic (disable a pact).

**Content / scheduling / meta**
- `DungeonMechanicSystem.js` — the 96 Dark Pacts: weighted offering draw, activate/deactivate,
  per-day ticks, tradeoff/curse enforcement.
- `EventSystem.js` — dungeon-event scheduler (cadence, shuffle bag, per-event preconditions,
  the recurring Treasure Raid track, scripted set-pieces).
- `AchievementSystem.js` — 92 achievements; career/run/day metric layers, retroactive scan,
  reward grants (boss/companion/title unlocks). Loaded in `Preload`.
- `PlayerProfile.js` — **per-name** persistence (`<key>:<name>` scoping): max boss level,
  achievements + metrics + timestamps, companion/title unlocks, active title. localStorage.
- `Leaderboard.js` — Supabase global leaderboard (`fetchTop`, `submitRun`, `buildRunPayload`);
  mango cheat-account submissions are blocked.
- `LiveRunPublisher.js` — live-run streaming to the backend.
- `SaveSystem.js` — full GameState serialize/deserialize, per-name save slots, legacy-global
  migration, heavy-array trimming + retry against the localStorage quota, transient-field strip
  on save (watch exact field-name matches — a typo silently freezes an entity on Continue).
- `RunHistorySystem.js` — updates `gameState.run.totals` rolling counters from events.
- `NewspaperSystem.js` — generates the end-of-day newspaper from the day record.
- `TutorialSystem.js` — gated how-to-play hints (`SHOW_TUTORIAL`), respects `tutorialEnabled`,
  uses counted soft-pause; `NpcDirector` can deliver hints as companion dialogue instead.
- `NpcDirector.js` + `companions.js` — companion dialogue brain (priority bands, cooldowns,
  coalescing, dedup, idle musings) + the 9-companion registry.

**Infrastructure / services**
- `PauseManager.js` — pause state (counted soft-pause so nested tutorials release cleanly);
  emits `PAUSE_STATE_CHANGED`.
- `GameRequests.js` — queued game-request/prompt system.
- `ThemeManager.js` / `DecorManager.js` — tile-theme + decor resolution per room.
- `FsHandle.js` — File System Access API wrapper (editors write PNG/JSON back to disk).

**Audio**
- `SfxSystem.js` (event→SFX dispatcher, measured per-cue volume table, rate-limiting,
  focus-aware), `SfxVolume.js` (master×sfx volume, mute), `TitleMusic.js` / `GameplayMusic.js`
  / `GameOverMusic.js`.

**VFX / feedback**
- `BossAttackVfxSystem.js`, `CheaterAttackVfxSystem.js`, `HitSparkSystem.js`,
  `ScreenShakeSystem.js`, `CombatFeedback.js`, `CompanionWorldFx.js`, `EmoteSystem.js`.

**Debug**
- `DebugOverlay.js` (`src/systems/`), `PerfHud.js` (`src/hud/`, Ctrl+Shift+P), `DebugOverlay*`
  in `src/ui/`.

---

## 7. Entities (`src/entities/`)

Runtime instance factories/classes (plain-object friendly): `Adventurer.js`, `Minion.js`,
`Trap.js`. (Rooms are plain objects placed via `DungeonGrid`, not a class.)
`Minion.js` holds `applyBossLevelToMinion()` (retroactive +HP/+ATK scaling on boss level-up).

---

## 8. Data (`src/data/`) — all content is JSON-driven

JSON content: `rooms.json`, `minionTypes.json`, `minionEvolutions.json`, `trapTypes.json`,
`bossArchetypes.json`, `bossAbilities.json`, `dungeonMechanics.json`, `events.json`,
`items.json`, `adventurerClasses.json`, `personalities.json`, `personalityCombos.json` (empty),
`achievements.json`, plus dialogue banks (`chatLines.json`, `lastWords.json`, `npcLines.json`,
and per-companion `*Lines.json`).

JS data modules: `achievementBitOrder.js` (leaderboard bitmask order), `bossUnlocks.js`
(archetype unlock gates), `cornerPattern.js`, `whatsNew.js` (patch notes).

Adding a room/minion/trap/pact is a **JSON edit**; behavior hooks reference handler ids
registered in code (e.g. `RoomBehaviorSystem`, `DungeonMechanicSystem`). See `STATUS.md` for
current counts.

---

## 9. UI layers in detail

- **`src/hud/`** — the live DOM HUD. Shell: `HudRoot.js`, `Overlay.js`, `dom.js`,
  `stageScale.js`, `styles.css`, `userSettings.js`, `HudSfx.js`. Always-on panels: `TopBar`,
  `BottomBar`, `LeftPanels` (minimap + construction), `RightPanels` (incoming wave + intel +
  log). Overlays: `MainMenuOverlay`, `BossOverviewOverlay`, `RosterOverlay`,
  `KnowledgeMapOverlay`, `AdvIntelOverlay`, `SettingsOverlay`, `AchievementsOverlay`,
  `LeaderboardOverlay`, `PactPicker`, `PostWaveOverlay`, `BossLevelUpOverlay`,
  `GameOverOverlay`, `CompanionSelectOverlay`, `PauseOverlay`, `ConfirmPopup`,
  `InspectPopup` (the one unified hover inspector), etc. Cinematics: `PhaseTransition`,
  `BossFightOverlay`, `EventBanner`, `SoloLevelingCinematic`, `LightPartyCinematic`,
  `CoinFlipCinematic`, `ToastQueue`, `UnlockNotificationOverlay`, `DungeonFx` (FX/floating
  numbers). Companion: `NpcCompanion`, `CompanionCursor`.
- **`src/ui/`** — Phaser canvas renderers (world-space): `DungeonRenderer`,
  `AdventurerRenderer`, `MinionRenderer`, `BossRenderer`, `TrapRenderer`, `ChatBubbles`,
  `KnowledgeOverlay`, `AbilityVfx`, etc., plus shared primitives (`UIKit.js`) and the
  `BossArchetypeUI` day-action wiring. The legacy Phaser HUD chrome + `src/ui/popups/*`
  that used to live here were **deleted in P0-6** (2026-06-18); the DOM HUD (`src/hud/`)
  is the only chrome now. (A couple of standalone Phaser panels — `DossierPanel`,
  `NameEntryPanel` — still remain.)

---

## 10. Util (`src/util/`)

`merchantPricing.js` (boss-level + day build-cost scaling, Goblin-Market repricing),
`slotCaps.js` (trap/minion slot caps), `classSpawn.js`, `displayNames.js`, `cheaterNames.js`,
`cheaterVfx.js`, `fleeFlavor.js`, `minionRevive.js`, `rivalDungeon.js`, `roomRotation.js`,
`trapRebuild.js`.

---

## 11. Cross-cutting patterns & gotchas

- **EventBus-only communication.** Subscribe in constructor, unsubscribe in `destroy()`.
- **GameState stays JSON-serializable** — no class instances inside it.
- **All content is data-driven JSON** — new content = JSON edit + handler id.
- **Tile size 32px** via `Balance.TILE_SIZE`. World = tile × 32. Don't hardcode 32.
- **DOM HUD is the only HUD** — all chrome/menus/panels/popups live in `src/hud/` (the old
  `newhud` flag + legacy Phaser chrome were retired in P0-6). New UI goes in `src/hud/`.
- **Per-name profile scoping** — player progress keys are `<base>:<name>`; `setName()` emits
  `NAME_CHANGED` so systems re-hydrate. Mango cheat name unlocks everything but is excluded
  from the leaderboard.
- **Scene `shutdown` binding** (see §3) — required or systems leak.
- **EventBus leak on `scene.restart()`** — `create()` can re-run without `shutdown()`; defensively
  clean up subscriptions in any `create()`/`_wireXxx` that subscribes.
- **Preview/visibility shim** (`main.js`) keeps the render loop alive in embedded browsers.
- **Audio cues** go through `SfxSystem` / `HudSfx` (volume + cooldown + mute-aware), never raw
  `sound.play()`.
- **Cheat name** (`mango`) — gates dev tools (Tileset/Room editors, test-fire menu items) and
  flattens unlock gates.

---

## 12. Removed systems (historical — do not re-add)

- **Daily upkeep** (removed 2026-05-02) — `EssenceSystem.js` gone; placement cost is the only
  economy pressure.
- **Reputation system** (removed 2026-05-02) — `ReputationSystem.js` gone; difficulty scales off
  boss level + day.
- **Loot pickup mechanic** (largely removed 2026-05-02) — `LootSystem.js` / `LootGreedSystem.js` /
  `LootItem.js` / `LootRenderer.js` gone. Adventurer kills drop gold directly. Treasure Chests
  (item, 10 tiers) and the Treasury stipend are the current loot-economy. (`lootPiles` in
  GameState is the small corpse-buff pickup, a separate later feature.)
- **Sleep goal** (removed 2026-05-04) — adventurers don't rest mid-dungeon.
- **Personality combos** (retired Phase 5c) — `personalityCombos.json` empty; detection is a no-op.
- **The Tournament event** (removed 2026-05-21) — deleted from `events.json`; inert spawn/AI code left unreachable.

---

## 13. Tooling & assets

- **Asset bake scripts** in `tools/*.mjs|*.cjs` (e.g. `bake-lpc-variants`, `bake-npc-sprites`,
  `bake-traps`, `bake-shadow-portal`, `reassign-rarities`). Plus root `bake-weapons.cjs`.
  These regenerate sprites/portraits from source art; re-runnable, source untouched.
- **Editors** — `TilesetEditor` + `RoomTileEditor` scenes write themes / per-cell `tileLayout`
  back to disk via `FsHandle`. Cheat-name gated.

## 14. Known cruft (cleanup candidates)

- `src/scenes/NightPhase.js.bak` and `src/systems/AISystem.js.bak` — stale backups, safe to delete.
- Root `fix_mojibake.py` / `fix_mojibake.mjs` — one-off encoding-fix scripts.
- ~~Legacy `src/ui/` chrome + `src/ui/popups/*`~~ — **deleted in P0-6 (2026-06-18)**; the DOM
  HUD is the only chrome now.

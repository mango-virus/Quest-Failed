# Quest-Failed — Architecture Reference

> Paste this file at the start of every new session to restore full context.
> Keep this document updated whenever a system changes, is added, or is removed.

---

## Game Concept

Top-down reverse roguelike. Player is the dungeon Boss/Architect. NPC adventurers enter to kill you and steal treasure. Player builds the dungeon during the **Night Phase** and watches the simulation play out during the **Day Phase**. Endless — the dungeon levels up over time, adventurers scale with it. Boss dies 3 times → game over (eulogy screen → new run).

---

## Removed systems

Several systems were retired in cleanup passes. Older sections of this document still describe them; treat any mention of these as historical, not current.

**2026-05-02 cleanup:**
- **Soul Essence currency** → renamed to **gold**. Field is `gameState.player.gold`; balance constants are `STARTING_GOLD`, `GOLD_PER_KILL`, `DEV_INFINITE_GOLD`, `MINION_RESPAWN_COST_GOLD`. Archetype modifier renamed `goldGainMultiplier`. Mechanic constant `MECHANIC_TAXATION_GOLD_PENALTY`.
- **Daily upkeep** → removed entirely. `EssenceSystem.js` is gone. `upkeepCost` fields stripped from JSON data and entity factories. Placement cost is the only economy pressure.
- **Reputation system** → removed entirely. `ReputationSystem.js` is gone. Difficulty scales purely off boss level. Legendary heroes still appear at a flat 5% per spawn in `DayPhase._spawnAdventurers`. Guild raids dropped.
- **Loot pickup mechanic** → removed entirely. `LootSystem.js`, `LootRenderer.js`, `LootGreedSystem.js`, `LootItem.js`, and `MimicRenderer.js` are gone. `gameState.loot.dungeon` is gone. Adventurer kills drop gold directly. Treasury rooms still pay a flat daily gold stipend; chests / hidden keys / vendetta-on-equip / vulture-loot-grab / mimic chest disguise / Greed Trap / `LOOT_PICKED_UP` / `LOOT_SCAVENGED` / `TREASURY_CHEST_*` / `MIMIC_REVEAL_*` events are all gone. Mimics in the Mimic Vault now spawn as plain hostile garrison minions.

**2026-05-04 cleanup:**
- **Sleep goal** → removed. Adventurers no longer rest mid-dungeon. `ADVENTURER_SLEEPING` event is dead. The barracks regen-when-empty cosmetic is unrelated.

**2026-05-05 cleanup:**
- **Dark Power currency** → retired. Was the long-term unlock currency; the design collapsed to a single Gold currency. `gameState.player.darkPower` field still loads from old saves but is ignored. Boss-archetype evolution-tree `cost` fields, ability `powerCostToUnlock`, and `startingDarkPower` are no-ops. Currency-migration to Gold is partial — some unlock buttons may display stale costs until that pass lands. `DARK_POWER_*` events are gone.

**Replacement layer (added since 2026-05-02):**
- **Item entities** — Door Lock + Key Chest (forced-pair placement, locked doors block until keyed), Soul-Bound Beacon + Healing Fountain (forced-pair, room buff with adventurer-tradeoff), Treasure Chest (10 tiers — pay daily gold, may be looted by tempted advs), Phylactery Heart (Lich-only, spare life). All defined in `src/data/items.json`.
- **Knowledge tier system** — FULL / PARTIAL / RUMOR / UNKNOWN classification on every pool entry, scaling pathfinder cost weight by tier. See `KnowledgeSystem.tierForEntry`.
- **Tutorial pipeline** — see `TutorialSystem` below.
- **Welcome intro popup + Boss Level-Up popup + Pact Detail popup** — added to HudScene's popup roster.
- **Coin-burst VFX** on adv kill (CoinBurstRenderer) and combat hit-feedback (CombatFeedback).

---

## Tech Stack

- **Phaser 3** (game framework — scenes, tilemaps, camera, input, game loop)
- **Vanilla JS** (ES modules, no build step — keeps deployment to GitHub Pages simple)
- **portal.js** (jam requirement — DO NOT modify; handles inter-game portal travel)
- Static hosting via GitHub Pages (`.github/workflows/pages.yml` already wired)

### Phaser Config Decisions
- Tile size: **32px**
- Starting grid: **30×30 tiles** (960px × 960px world space)
- Grid expands as dungeon levels up (unlock additional sections, e.g. +10 tiles per expansion)
- Max planned grid: ~100×100 tiles (tunable)
- Camera: scroll (drag or WASD) + zoom (scroll wheel), with bounds. Mini-map for navigation.
- Renderer: WebGL preferred, Canvas fallback

---

## Currencies

> **2026-05-05: Dark Power was retired.** Gold is the only currency in the game now. The strikethrough rows below preserve historical context but do not reflect runtime behavior. Lingering `darkPower` / `souls` field references in code (e.g. GameOver leaderboard submit, `run.totals.souls` counter) default to 0 and are inert — a follow-up cleanup pass is owed.

| Currency | Name | Earned By | Spent On |
|---|---|---|---|
| Build  | **Gold**       | Adventurer kills, treasury room daily stipend, treasure-chest passive income | One-time placement cost of rooms / traps / minions / items |
| ~~Upgrade~~ | ~~**Dark Power**~~ | ~~Adventurer kills (secondary, lower rate), boss kills, dungeon level-ups~~ | ~~Minion evolution, boss upgrades, unlocking new room/trap/minion types~~ — *all costs converted to Gold or removed.* |

There is no daily upkeep — the only economy pressure is placement cost. Rooms, traps, and minions never shut off after placement.

**Starting state (new run):**
- Boss room: pre-placed (fixed position, never removed)
- 3 starter rooms: pre-placed (free placement cost)
- Gold: tunable constant (`STARTING_GOLD` in `src/config/balance.js`)
- ~~Dark Power: 0~~ *(currency retired)*
- All amounts designed to be tweaked without code changes

---

## File Structure

```
Quest-Failed/
├── index.html
├── style.css
├── portal.js                    ← jam requirement, never modify
├── ARCHITECTURE.md              ← this file
├── src/
│   ├── main.js                  ← Phaser game config + scene registration
│   ├── config/
│   │   └── balance.js           ← all tunable numbers (costs, rates, thresholds)
│   ├── scenes/
│   │   ├── Boot.js
│   │   ├── Preload.js
│   │   ├── MainMenu.js          ← portal lives here
│   │   ├── ArchetypeSelect.js
│   │   ├── Game.js              ← persistent world scene (never sleeps)
│   │   ├── NightPhase.js        ← overlay: build mode
│   │   ├── DayPhase.js          ← overlay: watch/inspect mode
│   │   ├── BossFight.js         ← full overlay: animated boss fight
│   │   ├── EndOfDay.js          ← overlay: newspaper + mechanic selection
│   │   ├── Graveyard.js         ← overlay: persistent adventurer graveyard
│   │   ├── HudScene.js          ← always-on overlay: minimap (zoom-1 camera)
│   │   └── GameOver.js          ← full scene: eulogy screen
│   ├── systems/
│   │   ├── EventBus.js          ← central pub/sub (everything emits here)
│   │   ├── SaveSystem.js        ← serialize/deserialize full GameState
│   │   ├── DungeonGrid.js       ← tile grid, room placement, corridor routing, validation
│   │   ├── AISystem.js          ← per-adventurer decision making
│   │   ├── PathfinderSystem.js  ← A* with knowledge-weighted tile costs
│   │   ├── CombatSystem.js      ← real-time combat, typed kill events
│   │   ├── KnowledgeSystem.js   ← per-adventurer knowledge state + spreading
│   │   ├── PersonalitySystem.js ← behavior weight evaluation + combo detection
│   │   ├── EvolutionSystem.js   ← minion evolution triggered by kill-method events
│   │   ├── DungeonMechanicSystem.js ← activate/deactivate mechanics, tradeoff logic
│   │   ├── BossSystem.js        ← boss archetype stats, fight resolution, evolution
│   │   └── NewspaperSystem.js   ← generate end-of-day newspaper from DayRecord
│   ├── data/                    ← all game content as JSON (data-driven)
│   │   ├── rooms.json
│   │   ├── personalities.json
│   │   ├── personalityCombos.json
│   │   ├── dungeonMechanics.json
│   │   ├── minionTypes.json
│   │   ├── trapTypes.json
│   │   └── bossArchetypes.json
│   ├── entities/
│   │   ├── Adventurer.js        ← runtime adventurer instance
│   │   ├── Minion.js            ← runtime minion instance
│   │   ├── Room.js              ← runtime room instance
│   │   └── Trap.js              ← runtime trap instance
│   ├── ui/
│   │   ├── Palette.js           ← night phase room/trap/minion picker
│   │   ├── InspectPanel.js      ← day phase read-only entity detail panel
│   │   ├── TimeControls.js      ← pause/1x/2x/4x buttons
│   │   ├── KnowledgeOverlay.js  ← knowledge overlay toggle
│   │   ├── ThoughtBubbles.js    ← state icons above adventurer heads
│   │   ├── EventFeed.js         ← Slay the Spire-style condensed combat log
│   │   ├── MiniMap.js           ← dungeon overview + camera position indicator
│   │   ├── Newspaper.js         ← end-of-day generated newspaper UI
│   │   ├── DossierPanel.js      ← pre-day adventurer info (with ?-marks)
│   │   └── MechanicSelector.js  ← dungeon mechanic choice UI
│   └── utils/
│       ├── NameGenerator.js     ← minion + adventurer name generation
│       └── RNG.js               ← seeded random (for reproducible runs)
├── assets/
│   ├── tilesets/
│   ├── sprites/
│   └── ui/
```

---

## Scene Architecture

Phaser runs multiple scenes simultaneously. The **Game** scene is the persistent world — it owns the dungeon renderer, all game state, and all systems. Phase-specific scenes run as overlays on top of it.

```
Boot → Preload → MainMenu
                    │
                    ├─ (new game) → ArchetypeSelect → Game + NightPhase
                    └─ (continue) → Game + NightPhase or DayPhase (from save)

Game (always running once started)
 ├── HudScene overlay     ← screen-locked HUD (minimap)
 ├── NightPhase overlay   ← build mode
 └── DayPhase overlay     ← watch/inspect mode
      └── BossFight overlay (pauses DayPhase when boss room reached)

NightPhase end → EndOfDay overlay → back to NightPhase
DayPhase end (all adventurers out) → EndOfDay overlay → NightPhase

Any time: Graveyard overlay (toggled from UI)
Boss defeated 3x: GameOver scene (full replace)
```

### Scene Responsibilities

**Boot** — Load minimal assets (loading bar). Launch Preload.

**Preload** — Load all assets (tilesets, sprites, UI). Launch MainMenu.

**MainMenu** — New Game, Continue (if save exists), Leaderboard. Contains portal object that calls `Portal.sendPlayerThroughPortal()`.

**ArchetypeSelect** — Display available boss archetypes. Locked ones shown with unlock condition. Confirm initializes GameState and launches Game + NightPhase.

**Game** (persistent) — Owns `GameState`, `EventBus`, all systems, Phaser tilemap, entity sprites, camera. Renders dungeon world at all times. Systems tick here every update. Day/Night overlays add their input and UI layers on top; Game never handles input directly.

**NightPhase** (overlay) — Palette UI, grid placement interaction (hover preview, snap, confirm), constraint feedback, dungeon stats panel (essence/power/day), "Begin Day" button. Launches DayPhase on confirm.

**DayPhase** (overlay) — Time controls (pause/1x/2x/4x), entity click-to-inspect (read-only InspectPanel), knowledge overlay toggle, thought bubbles, EventFeed, camera lock to adventurer on click. END DAY button is disabled while adventurers are still active in the dungeon (force-ending mid-run is blocked). No placement allowed. Ends when all adventurers are dead/fled/sleeping (auto-timer) or via the unlocked END DAY button, OR when boss fight starts.

**HudScene** (always-on overlay) — Screen-locked HUD that must not be affected by the world camera's zoom or scroll. Owns the MiniMap (with toggle, click-to-pan, click-and-drag-to-pan). Launched by Game.create() and stopped on Game shutdown. Reads world camera state through a `gameScene` reference for the viewport indicator math, but its own camera stays at zoom 1 / scroll 0 so all UI uses literal pixel coordinates.

**BossFight** (overlay) — Pauses DayPhase time. Shows boss + adventurer party HP bars. Animated fight sequence driven by BossSystem. Boss abilities fire visually. Result written to GameState. Returns to DayPhase (or triggers GameOver if 3rd boss death).

**EndOfDay** (overlay) — Generated Newspaper front page. Mechanic selection UI (offered when all adventurers are eliminated or fled). Dossier preview of tomorrow's incoming adventurers. "Start Night" button.

**Graveyard** (overlay) — Scrollable list of every adventurer who has died. Per-entry: name, class, personalities, day died, killed by, room, gear dropped (with provenance tooltip). Accessible from DayPhase and EndOfDay.

**GameOver** — Eulogy cinematic. Every named minion's kill count. Notable run moments. Stats summary. Play Again / Main Menu.

---

## Core Data Model (GameState)

This is the **single serializable object** saved and loaded by SaveSystem. Every piece of mutable game state lives here. Nothing is stored in scene variables that isn't also reflected here.

```js
GameState {
  meta: {
    version: string,           // save format version for migration
    dayNumber: number,
    dungeonLevel: number,
    bossDefeatedCount: number, // 0, 1, or 2 (3rd = game over)
    reputation: number,
    runId: string,             // unique ID for leaderboard
    phase: "night" | "day"     // which phase we're in (for save/reload)
  },

  player: {
    bossArchetypeId: string,
    bossEvolution: BossEvolutionState,
    soulEssence: number,             // legacy field name; displayed as "Gold"
    darkPower: number,               // RETIRED 2026-05-05 — defaults to 0; no system writes/reads it any longer
    totalKills: number,
    totalDaysElapsed: number
  },

  dungeon: {
    gridWidth: number,         // current unlocked size in tiles
    gridHeight: number,
    tiles: number[][],         // 2D array of TileType (index into tile definitions)
    rooms: Room[],
    corridors: Corridor[],
    traps: Trap[],
    activeMechanics: string[], // active DungeonMechanic IDs
    expansions: GridExpansion[] // which grid sections have been unlocked
  },

  minions: Minion[],

  adventurers: {
    active: Adventurer[],         // currently in dungeon
    known: AdventurerRecord[],    // all known adventurers (visited or not)
    graveyard: DeadAdventurer[]   // permanent record of the dead
  },

  guilds: Guild[],

  loot: {
    dungeon: LootItem[],                      // items on dungeon floors
    minionEquipment: { [minionId]: string[] } // minionId → LootItem instanceIds
  },

  history: {
    days: DayRecord[],    // one per completed day, drives newspaper generation
    events: GameEvent[]   // ring buffer of recent events (last 3 days, drives replay ghosts)
  },

  unlocks: {
    rooms: string[],
    minionTypes: string[],
    trapTypes: string[],
    dungeonMechanics: string[],
    bossAbilities: string[],
    archetypes: string[]
  }
}
```

---

## Entity Schemas

### Room (runtime instance)
```js
{
  instanceId: string,
  definitionId: string,       // key into RoomDefinition registry
  gridX: number,              // top-left tile position
  gridY: number,
  width: number,              // in tiles (from definition)
  height: number,
  isActive: boolean,          // false if shut off by essence shortage
  upkeepCost: number,         // copied from definition (0 = free)
  connectionPoints: ConnectionPoint[], // active corridor attachment points
  state: {}                   // room-type-specific mutable state
}
```

### Minion (runtime instance)
```js
{
  instanceId: string,
  definitionId: string,
  name: string | null,        // null until first level-up; player can rename
  tileX: number,
  tileY: number,
  assignedRoomId: string,     // home room
  behaviorType: "patrol" | "guard" | "hunt" | "support" | string,
  stats: MinionStats,
  level: number,
  xp: number,
  evolutionHistory: EvolutionEntry[],
  killHistory: KillEntry[],   // each entry: { adventurerId, damageType, day }
  equippedGear: string[],     // LootItem instanceIds
  hasBounty: boolean,
  bountyKillCount: number,
  // Transient AI state (also serialized for mid-day saves)
  currentTargetId: string | null,
  aiState: "idle" | "patrol" | "combat" | "alert" | "sleeping"
}
```

### Adventurer (runtime instance)
```js
{
  instanceId: string,
  name: string,
  classId: string,            // "knight", "mage", "cleric", etc.
  personalityIds: string[],   // can have multiple (grows with dungeon level)
  partyId: string | null,
  tileX: number,
  tileY: number,
  stats: AdventurerStats,
  resources: {
    hp: number,
    maxHp: number,
    mana: number | null,      // null if class doesn't use mana
    arrows: number | null,
    potions: number
  },
  knowledge: AdventurerKnowledge,
  gear: string[],             // LootItem instanceIds
  gold: number,
  goal: AdventurerGoal,       // current objective
  goalStack: AdventurerGoal[],
  visitHistory: VisitRecord[], // prior dungeon runs with this adventurer
  aiState: string,
  // Special flags (personality-driven)
  flags: { [key: string]: any }
}
```

### Trap (runtime instance)
```js
{
  instanceId: string,
  definitionId: string,
  tileX: number,
  tileY: number,
  isTriggered: boolean,       // shows "spent" icon
  isKnownToAdventurers: boolean, // shows different icon from boss view
  repairProgress: number,     // 0-1, Sapper repairs over night phase
  state: {}                   // trap-type-specific state
}
```

### LootItem (runtime instance)
```js
{
  instanceId: string,
  definitionId: string,
  provenance: [
    {
      type: "crafted" | "wielded_by" | "dropped_at" | "equipped_to",
      entityName: string,
      entityClass: string | null,
      roomId: string | null,
      day: number,
      flavorText: string     // e.g. "wielded by Sir Aldric, killed in Room 7"
    }
  ],
  currentEquippedBy: string | null,  // entity instanceId
  dungeonRoomId: string | null,      // if lying on dungeon floor
  statModifiers: StatModifier[],
  curseLevel: number,                // always 0 — field retained on LootItem schema; mechanic cut 2026-05-02
  isVendettaTarget: boolean,         // another adventurer is hunting this item
  vendettaHunterId: string | null
}
```

---

## Data-Driven Definition Formats (JSON)

All game content lives in `src/data/`. Adding new content never requires code changes — only JSON edits. Behavior hooks reference handler IDs that are registered in code, keeping logic out of JSON.

### RoomDefinition
```js
{
  id: "healing_fountain",
  name: "Healing Fountain",
  category: "utility",        // "starter" | "trap" | "combat" | "treasure" | "special" | "utility"
  width: 6,                   // tiles
  height: 6,
  tileLayout: number[][],     // 2D array of tile type indices (matches width×height)
  connectionPoints: [
    { x: 3, y: 0, direction: "N" },  // relative tile, which wall
    { x: 3, y: 5, direction: "S" }
  ],
  upkeepCost: 5,              // Soul Essence per day; 0 = free (starter rooms)
  essenceCostToPlace: 20,     // one-time placement cost
  powerCostToUnlock: 0,       // (Dark Power retired 2026-05-05) historically Dark Power; field still parsed but inert
  unlockLevel: 1,             // minimum dungeon level to see it in the palette
  placementRules: {
    minDepthFromBoss: 0,
    maxDepthFromBoss: null,
    requiresAdjacentTags: [],    // room type tags that must be adjacent
    requiresPowerSource: false,
    maxPerDungeon: null
  },
  tags: ["rest_point", "healing", "vulnerable"],
  onAdventurerEnter: "healingFountain_onEnter",  // handler ID registered in code
  onAdventurerExit: null,
  onNightStart: null,
  onDayStart: null,
  description: "A room with a restorative fountain. Adventurers will stop to heal here.",
  flavorText: "The water smells faintly of copper."
}
```

### PersonalityDefinition
```js
{
  id: "greedy",
  name: "Greedy",
  tags: ["greedy", "loot_seeker", "impulsive"],
  behaviorWeights: {
    lootPriority: 0.9,        // 0-1: how strongly they prioritize loot
    fleeThreshold: 0.4,       // HP fraction at which they consider fleeing
    trapCaution: 0.2,         // tendency to check for traps before moving
    partyCooperation: 0.3,    // follow party vs. go solo
    explorationDrive: 0.5,    // explore side rooms vs. head for boss
    aggressionLevel: 0.6,     // fight vs. avoid enemies
    riskTolerance: 0.8,       // willingness to take dangerous paths
    healPriority: 0.3         // how quickly they seek healing
  },
  decisionOverrides: [
    // Specific decision override: always open chests regardless of danger level
    { trigger: "chest_in_room", action: "open_chest", priority: 100 }
  ],
  reactions: [
    // e.g. "on seeing loot, emit GREEDY_FIXATED event"
    { event: "LOOT_SPOTTED", handler: "greedy_lootSpotted" }
  ],
  unlockLevel: 1,
  rarity: "common",
  description: "Prioritizes loot above all else. Will detour into dangerous rooms for a shiny chest."
}
```

### PersonalityComboDefinition
Combos use tags, not specific personality IDs, so they apply automatically to new personalities that share tags. A combo fires when both tag sets are represented in the same party.

```js
{
  id: "greedy_cartographer_clash",
  name: "Treasure Detour",
  requiresTags: [["greedy"], ["mapper"]],   // one member with "greedy" AND one with "mapper"
  effect: "constant_detour",                // effect handler ID
  description: "The cartographer maps efficiently but the greedy one keeps diverting the route.",
  visibleToPlayer: true,                    // show relationship icon above their heads
  icon: "icon_clash"
}
```

### DungeonMechanicDefinition
```js
{
  id: "taxation_of_souls",
  name: "Taxation of Souls",
  description: "Adventurers lose 5% max HP when entering a new room.",
  tradeoffDescription: "Adventurers are already weakened on kill — you gain slightly less Soul Essence per death.",
  unlockLevel: 2,
  weight: 4,
  availableToArchetypes: "all",    // or array of archetype IDs
  onActivate: "taxationOfSouls_activate",
  onDeactivate: "taxationOfSouls_deactivate",
  onDailyTick: null,
  tags: ["damage", "attrition"],
  exclusiveWith: [],               // mechanic IDs that can't coexist
  synergyWith: []
}
```

### MinionTypeDefinition
```js
{
  id: "skeleton_warrior",
  name: "Skeleton Warrior",
  category: "combat",             // "combat" | "support" | "utility"
  behaviorType: "patrol",
  baseStats: {
    hp: 30, attack: 8, defense: 4, speed: 1.0,
    damageType: "physical",
    abilities: []
  },
  goldCost: 10,                   // gold to place (was essenceCostToPlace; Soul Essence retired 2026-05-02)
  // upkeepCost / essenceCostToPlace fields retired with EssenceSystem.
  // powerCostToUnlock retired with Dark Power 2026-05-05; ignored if present.
  unlockLevel: 1,
  evolutionPaths: [
    // Conditions checked against KillEntry[] by EvolutionSystem
    {
      id: "plague_bringer",
      name: "Plague Bringer",
      condition: { killMethod: "poison", killCount: 3 },
      statDeltas: { attack: +5 },
      newAbility: "poison_aura",
      flavorText: "Death by a thousand punctures. It learned."
    },
    {
      id: "mana_eater",
      name: "Mana Eater",
      condition: { killedClassType: "mage", killCount: 5 },
      statDeltas: { defense: +3 },
      newAbility: "drain_mana",
      flavorText: "Five mages. All their spells. None of their regrets."
    }
  ],
  tags: ["undead", "melee"],
  description: "A basic patrolling skeleton. Cheap, reliable, expendable."
}
```

### TrapDefinition
```js
{
  id: "greed_trap",
  name: "Greed Trap",
  triggerCondition: "loot_picked_up",  // handler ID evaluated by TrapSystem
  damageType: "physical",
  baseDamage: 25,
  tags: ["behavioral", "anti-greedy"],
  goldCost: 8,                          // gold to place (was essenceCostToPlace)
  // powerCostToUnlock + repairCost retired with their respective currencies.
  unlockLevel: 1,
  isVisible: false,                     // adventurers can't see it until triggered
  description: "Only triggers when an adventurer picks up loot.",
  flavorText: "The real treasure was the hubris all along."
}
```

### BossArchetypeDefinition
```js
{
  id: "the_lich",
  name: "The Lich",
  description: "Undead synergies, soul economy. Weak to clerics.",
  modifiers: {
    goldGainMultiplier: 1.2,            // (was essenceGainMultiplier; Soul Essence retired)
    minionXpMultiplier: 1.0,
    availableRoomTags: [],              // no restrictions beyond defaults
    blockedRoomTags: [],
    availableMechanicTags: ["undead", "curse", "soul"],
    roomCostMultiplier: 1.0
  },
  startingRooms: ["boss_chamber", "starter_corridor", "starter_barracks", "starter_crypt"],
  startingGold: 30,                     // overrides Balance.STARTING_GOLD if set
  // startingEssence / startingDarkPower fields retired (Soul Essence 2026-05-02,
  // Dark Power 2026-05-05). Stale data in saves is ignored on load.
  baseFightStats: { hp: 200, attack: 15, defense: 10, abilities: ["soul_drain"] },
  evolutionTree: [
    {
      id: "raise_dead",
      name: "Raise Dead",
      cost: 30,                         // gold (was Dark Power; currency migration in progress)
      description: "Summon undead adds during the boss fight.",
      requiresLevel: 3,
      statDeltas: {},
      newAbility: "summon_skeletal_adds"
    }
  ],
  unlockCondition: null,               // null = available from start
  flavorText: "It has waited a thousand years. It can wait one more day."
}
```

---

## Systems Reference

### EventBus (`src/systems/EventBus.js`)
Central pub/sub. All systems and UI components communicate through it — never call each other directly. This keeps systems decoupled and makes the newspaper, combat log, auto-pause, and replay ghost trivially easy (they're just subscribers).

Key events (the catalog has grown well past this snapshot — search
`EventBus.emit(` across `src/` for the live list. Retired events are
kept here with their successors noted so old code-comments still grep):

```
GAME_STATE_LOADED
DAY_PHASE_STARTED / DAY_PHASE_BEGAN / DAY_PHASE_ENDED
NIGHT_PHASE_STARTED / NIGHT_PHASE_ENDED
ADVENTURER_ENTERED_DUNGEON { adventurer }
ADVENTURERS_SPAWNED { adventurers }
ADVENTURER_ROOM_CHANGED { adventurer, fromRoomId, toRoomId }
ADVENTURER_DIED { adventurer, killerId, killerName, roomId, damageType }
ADVENTURER_FLED { adventurer, reason }
TRAP_TRIGGERED { trap, adventurer, damage, roomId }
TRAP_SPOTTED { trap, adventurer }          ← adventurer detected trap without triggering
COMBAT_HIT { sourceId, targetId, damage, damageType, isCritical }
COMBAT_KILL { sourceId, targetId, damageType, method }
CHARMED_ATTACK { attackerId, victimId, dmg }   ← succubus-charmed adv hits former ally
MINION_LEVELED_UP { minion }
MINION_EVOLVED { minion, fromIdx, toIdx, isFinal }
MINION_DIED { minion, killerId }
MINION_PLACED { minion }
MINION_OBSERVED { advId, minionId, roomId }
ROOM_PLACED { room }
ROOM_REMOVED { room }
ROOM_OBSERVED { adventurer, roomId, firstVisit }
LOCK_PLACED / LOCKS_CHANGED / KEY_CHEST_OPENED / KEY_CHEST_REMOVED
TREASURE_CHEST_OPENED / TREASURE_CHEST_REMOVED / TREASURE_PAYOUT
MECHANIC_ACTIVATED { mechanic }
MECHANIC_DEACTIVATED { mechanic }
PACT_SEALED { mechanicId, rarity }
DARK_PACT_SEALED { mechanicId }
BOSS_FIGHT_INCOMING / BOSS_FIGHT_STARTED / BOSS_FIGHT_RESOLVED
BOSS_DEFEATED { bossDefeatedCount }
BOSS_LEVELED_UP { newLevel }
BOSS_LEVEL_UP_DISMISSED
KNOWLEDGE_SURVIVOR_SAVED / KNOWLEDGE_PARTY_WIPED
DUNGEON_LEVELED_UP { newLevel }
GRID_EXPANDED { newWidth, newHeight }
PERSONALITY_COMBO_ACTIVATED { combo, partyId }
PLACEMENT_BLOCKED { reason }              ← drives the resource-warning hint pipeline
RESOURCES_AWARDED { gold, reason, worldX?, worldY? }
SHOW_TUTORIAL { title, body, onClose }
SHOW_POST_WAVE_SUMMARY / SHOW_DARK_PACT / SHOW_BOSS_LEVEL_UP / SHOW_PACT_DETAIL
INTRO_DISMISSED { tutorialEnabled }

# Per-archetype events (full list in BossArchetypeSystem.js):
BEHOLDER_PETRIFY_FIRED / BEHOLDER_ANTIMAGIC_ROOMS_SET
GOLEM_LIVING_ARCH_TICK / GOLEM_EARTHQUAKE_*
LICH_PHYLACTERY_* / PHYLACTERY_DESTROYED
LIZARDMAN_VENOM_APPLIED / LIZARDMAN_CAMO_REVEAL
MYCONID_SPORE_DAY_BEGAN / MYCONID_CORPSE_*
DEMON_SACRIFICE_* / DEMON_HELLGATE_SPAWNED
VAMPIRE_CHARM_MARKED / VAMPIRE_THRALL_* / VAMPIRE_BLOOD_TAX_*
GNOLL_HUNTERS_PACK_REFILLED / GNOLL_BLOODLUST_STACK
WRAITH_FEAR_CHANGED / WRAITH_FEAR_FLEE / WRAITH_FRIENDLY_FIRE / WRAITH_HAUNT_*
SUCCUBUS_TRANSFORM_OUT / SUCCUBUS_TRANSFORM_IN / SUCCUBUS_BAT_FLYING_OUT /
  SUCCUBUS_BAT_FLYING_BACK / SUCCUBUS_CHARM_APPLIED / SUCCUBUS_FLIGHT_ENDED

# Retired (do not emit, kept for grep):
ADVENTURER_SLEEPING                       ← Sleep goal removed 2026-05-04
ROOM_DEACTIVATED / ESSENCE_WARNING / ESSENCE_CRITICAL  ← Soul Essence retired 2026-05-02
GEAR_DROPPED / GEAR_EQUIPPED_TO_MINION / VENDETTA_CREATED  ← LootSystem retired 2026-05-02
KNOWLEDGE_SHARED                          ← replaced by sharedPool rebuild on ADVENTURER_FLED
```

### SaveSystem (`src/systems/SaveSystem.js`)
- `SaveSystem.save(gameState)` → serializes full GameState to JSON → `localStorage`
- `SaveSystem.load()` → deserializes → returns GameState (or null if no save)
- `SaveSystem.hasSave()` → boolean
- `SaveSystem.deleteSave()` → clears localStorage
- Versioned: if `meta.version` doesn't match current version, runs migration function
- Auto-save: triggered on NIGHT_PHASE_STARTED and END_OF_DAY events
- Manual save: available from menu at any time during night phase

### DungeonGrid (`src/systems/DungeonGrid.js`)
Owns the tile grid and all spatial queries. Does NOT own the Phaser tilemap (that's in Game.js) — it owns the data layer that the tilemap reads from.

Key responsibilities:
- `placeRoom(definition, gridX, gridY)` → validates constraints, writes tiles, returns Room instance
- `removeRoom(instanceId)` → removes room and its corridors
- `autoRouteCorridor(roomA, roomB)` → finds matching connection points, runs A* to route corridor tiles between them, returns Corridor
- `validatePlacement(definition, gridX, gridY)` → returns `{ valid: boolean, violations: string[] }`
- `getRoomAtTile(tileX, tileY)` → Room | null
- `getTileType(tileX, tileY)` → TileType
- `getNeighborRooms(roomId)` → Room[]
- `getDepthFromBoss(roomId)` → number (graph distance in rooms)
- `expandGrid(newWidth, newHeight)` → grows tile array

**Corridor auto-routing:** When a room is placed, DungeonGrid scans for nearby rooms with compatible facing connection points (N↔S or E↔W). For each valid pair, it routes a 2-tile-wide L-shaped or straight corridor (A* on grid, cost avoids room interiors). Player can suppress auto-routing and connect manually via the Palette UI.

**Constraint validation:** Checked on every placement attempt before confirming:
- Room overlap
- Min/max depth from boss
- Required adjacent room tags
- Power source requirement (must have path to Core room)
- Max-per-dungeon limits
- Grid bounds

### PathfinderSystem (`src/systems/PathfinderSystem.js`)
A* on the tile graph. Returns a path as an array of `{tileX, tileY}` waypoints.

`findPath(fromTile, toTile, knowledgeState, personalityWeights)` — knowledge-weighted costs:
- Known triggered traps: very high cost (avoid)
- Known dangerous rooms: moderate cost multiplier
- Unknown rooms: base cost (adventurer may enter anyway based on `explorationDrive` weight)
- Cost multipliers configurable per personality

### AISystem (`src/systems/AISystem.js`)
Runs per-adventurer per tick. Does NOT do pathfinding directly — requests paths from PathfinderSystem and follows them.

Decision loop per tick:
1. Re-evaluate current goal (still valid? blocked? complete?)
2. Check personality reactions (any triggers firing this tick?)
3. Check party state (combo effects, party leader still alive?)
4. Evaluate resource state (low HP → flee? Out of mana → stand still?)
5. Choose action: MOVE, ATTACK, USE_ITEM, OPEN_CHEST, SLEEP, FLEE, WAIT, EXPLORE
6. Execute action (move along path, initiate combat, etc.)

Goal types: `ENTER_DUNGEON`, `EXPLORE_ROOM`, `SEEK_LOOT`, `SEEK_BOSS`, `FLEE`, `SLEEP`, `HEAL`, `FOLLOW_PARTY`, `AVOID_ENEMY`, `SCOUT`

### CombatSystem (`src/systems/CombatSystem.js`)
Real-time (simulated). Runs at game time scale (affected by TimeControls).

On each combatant's attack timer firing:
1. Calculate damage (attacker stats + gear + personality modifiers + active mechanics)
2. Apply defense
3. Emit `COMBAT_HIT`
4. If HP reaches 0: emit `COMBAT_KILL` with full kill context (damageType, method)
5. On adventurer death: trigger LootSystem (drop gear), EvolutionSystem (check triggers), emit `ADVENTURER_DIED`
6. On minion death: emit `MINION_DIED`, schedule respawn for night phase

**Kill context** (critical — feeds EvolutionSystem):
```js
{ killerMinionId, victimId, damageType, method, roomId, day }
// method examples: "melee", "ranged", "poison", "backstab", "spell_fire", "trap_spike"
```

### KnowledgeSystem (`src/systems/KnowledgeSystem.js`)
Manages `AdventurerKnowledge` per adventurer. Knowledge is per-entity (rooms, traps, minions) and carries an accuracy flag.

- `recordObservation(adventurerId, entityType, entityId, data)` — called when adventurer enters a room, spots a trap, sees a minion
- `shareKnowledge(fromId, toId, filter?)` — transfers knowledge entries; some entries may transfer as inaccurate ("rumor")
- `degradeKnowledge(adventurerId, fraction)` — used by Memory Fog mechanic
- Knowledge affects PathfinderSystem costs — KnowledgeSystem exposes `getPathCostModifier(adventurerId, tileX, tileY)`
- Player can view the knowledge overlay: KnowledgeOverlay queries KnowledgeSystem for all known rooms aggregated across all adventurers

**KnowledgeEntry schema:**
```js
{
  entityId: string,
  data: any,                          // room info, trap type, minion stats, etc.
  accurate: boolean,                  // false = misinformation (adventurer's memory is wrong)
  source: "witnessed" | "told" | "rumor",
  dayLearned: number
}
```

### PersonalitySystem (`src/systems/PersonalitySystem.js`)
- `evaluateDecision(adventurer, situation)` → returns weighted decision using adventurer's personality blend
- `checkCombos(party)` → scans party member tags against PersonalityComboDefinitions; fires combo effects and emits `PERSONALITY_COMBO_ACTIVATED` for UI
- Multiple personalities stack: behavior weights are averaged (or max'd for certain weights — configurable per weight)

### EvolutionSystem (`src/systems/EvolutionSystem.js`)
Subscribes to `COMBAT_KILL`. For each kill event, checks the killer minion's kill history against all evolution paths in its MinionTypeDefinition. When a condition is met, applies stat deltas, grants new ability, updates minion name, emits `MINION_EVOLVED`.

### ~~EssenceSystem~~ (RETIRED)
Soul Essence + nightly upkeep was cut. The two-currency model collapsed
to a single Gold currency; rooms / traps / minions have no recurring
cost. No system file exists for this anymore — kept as a historical
reference only. `ESSENCE_WARNING` and `ROOM_DEACTIVATED` events are gone.

### DungeonMechanicSystem (`src/systems/DungeonMechanicSystem.js`)
- `activateMechanic(mechanicId, gameState)` — calls `onActivate` handler, adds to `activeMechanics`
- `deactivateMechanic(mechanicId, gameState)` — calls `onDeactivate` handler
- `getOfferedMechanics(gameState)` → array of mechanic IDs the player is offered this end-of-day (filtered by archetype, dungeon level, exclusivity)
- `tickAll(gameState)` — calls `onDailyTick` for all active mechanics

### ~~LootSystem~~ (RETIRED 2026-05-02)
Full gear / equip / vendetta-tracking pipeline was cut. Adventurers
now drop simple loot piles via AISystem._dropLootPile (consumed by
LOOT_CORPSE goal for a small permanent stat buff) — no equipment, no
provenance, no cross-run vendetta on items. Vendetta hunters still
exist but target a specific minion id directly via SEEK_VENDETTA goal.
GEAR_DROPPED / GEAR_EQUIPPED_TO_MINION / VENDETTA_CREATED events are
gone.

### BossSystem (`src/systems/BossSystem.js`)
- `resolveBossFight(adventurers, bossState)` → simulates the fight, returns frame-by-frame event log for BossFightScene to animate
- `applyEvolution(evolutionId, bossState)` → upgrades boss stats/abilities
- `getBossRoomModifiers(bossState)` → current environmental hazards for boss room

### NewspaperSystem (`src/systems/NewspaperSystem.js`)
Subscribes to all events during a day. On end-of-day, compiles a `DayRecord` and generates newspaper text from templates + event data. Tone is dryly comedic.

### BossArchetypeSystem (`src/systems/BossArchetypeSystem.js`)
Owns the per-archetype headline mechanics for all 11 monster bosses (Orc Loot the Fallen + Warband, Golem Living Architecture + Earthquake, Beholder Petrify Gaze + Anti-Magic Aura, Lich Phylactery + Necromancy, Lizardman Camouflage + Venom, Myconid Spore Network + Corpse Bloom, Demon Sacrifice + Hellgate, Vampire Charm + Blood Tax, Gnoll Hunters Pack + Bloodlust, Wraith Fear Meter + Haunting, Succubus Bat-Form Seduction). All hooks gate on `gameState.player.bossArchetypeId` so a single system hosts every archetype rule. Subscribes to most combat / phase / mutation events; ticks per frame from Game.update.

### TutorialSystem (`src/systems/TutorialSystem.js`)
One-shot how-to-play hint pipeline. Owns 24 tutorial entries across 4 categories (phase intros, mechanic intros, boss-archetype hooks, resource-warning hints). On a gate event, enqueues the matching hint if `meta.tutorialEnabled` and not yet `meta.seenTutorials[id]`; emits `SHOW_TUTORIAL` for HudScene to route to TutorialPopup. Drains the queue one popup at a time with a 450ms inter-popup gap. Holds emission until `meta.introSeen` flips so hints don't fire over the welcome popup.

### CombatFeedback (`src/systems/CombatFeedback.js`)
Hit-feedback layer: damage-number floaters, knockback, hit-flash tints. Subscribes to COMBAT_HIT events.

### EventSystem (`src/systems/EventSystem.js`)
Distinct from EventBus — runs the daily dungeon-event roller (Loot Goblin Heist, Cartographer's Convention, Tournament, Rival Dungeon, Negotiation Day, Twitch Con, Cosplay Contest, Dark Deal, Pestilence, etc.). Sets `gameState._eventFlags.<flag>Active` for the day. DayPhase reads these flags to swap out the normal spawn for the event's bespoke wave.

### MinionEvolutionSystem (`src/systems/MinionEvolutionSystem.js`)
Chain-based evolution alongside the legacy EvolutionSystem. Each minion's chain (e.g. `skeleton1 → skeleton2 → skeleton3`) is XP-driven via `minionEvolutions.json`. Emits `MINION_EVOLVED` with `{ minion, fromIdx, toIdx, isFinal }`.

### RunHistorySystem (`src/systems/RunHistorySystem.js`)
Passive aggregator that subscribes to PACT_SEALED / RESOURCES_AWARDED / MINION_DIED / ADVENTURER_DIED and folds counts into `gameState.run.totals` + `gameState.history.pacts`. No gameplay effect — drives Boss Overview "Active Pacts" + GameOver leaderboard submit.

### InquisitorSystem (`src/systems/InquisitorSystem.js`)
Inquisitor-personality dispel ability. Inquisitors dispel one active dungeon mechanic per encounter via DungeonMechanicSystem.deactivate.

### EmoteSystem (`src/systems/EmoteSystem.js`)
Speech-bubble + emote glyph dispatcher for adventurers (chat lines on goal change, gloating after kills, fear cues, etc.). Subscribes to SAY_* / COMBAT_KILL / WRAITH_FEAR_CHANGED / etc.

### ClassAbilitySystem (`src/systems/ClassAbilitySystem.js`)
Per-class active abilities (Cleric heal-ally, Necromancer raise, Bard Song of Speed, Twitch Streamer trail, etc.). Cooldown-driven; per-day budgets; called from AISystem when the adv's ability conditions are met.

### SfxSystem (`src/systems/SfxSystem.js`)
Routes EventBus events → sound-effect playback. Owns the audio mixer.

### Music systems (`src/systems/TitleMusic.js`, `src/systems/GameplayMusic.js`)
TitleMusic loops on MainMenu / ArchetypeSelect; GameplayMusic shuffles a 5-track playlist while Game scene is active.

### PauseManager (`src/systems/PauseManager.js`)
Esc-driven pause overlay manager. Pauses every gameplay scene (NightPhase / DayPhase / HudScene) so timers + AI freeze behind the panel.

### PlayerProfile (`src/systems/PlayerProfile.js`)
Persistent cross-run profile (player name, max boss level reached). Drives ArchetypeSelect's unlock gates (e.g. Succubus requires lifetime max bossLevel ≥ 7).

### Theme + Decor managers (`src/ui/ThemeManager.js`, `src/ui/DecorManager.js`)
Async-loaded room tile + decoration manifests. Optional — game runs in procedural mode if manifests are missing.

### Renderers (in `src/ui/`)
DungeonRenderer, AdventurerRenderer, MinionRenderer, BossRenderer, TrapRenderer, LootPileRenderer, KeyChestRenderer, LockRenderer, BeaconRenderer, FountainRenderer, TreasureChestRenderer, DarkDealDemonRenderer, PhylacteryRenderer, FungalCorpseRenderer, SuccubusBatRenderer, CoinBurstRenderer, SunderedFloorRenderer, CartographerOverlay, ChatBubbles, ReplayGhostRenderer, MinionInspector, KnowledgeOverlay, WantedPoster, EventBanner, BossArchetypeUI. Each subscribes to its relevant events + reads its slice of gameState; updated per-frame from Game.update / HudScene.update.

---

## Dungeon Grid & Camera

**World coordinates:** (0, 0) is top-left of the dungeon grid. X increases right, Y increases down. Tile (tx, ty) maps to world pixel `(tx * 32, ty * 32)`.

**Camera (Game.js):**
- Bounds: `(0, 0)` to `(gridWidth * 32, gridHeight * 32)`
- Zoom: min `0.25`, max `2.0`, default `1.0`
- Scroll: drag (middle mouse or right mouse), or WASD during build phase
- **Camera lock (day phase):** clicking an adventurer sprite calls `camera.startFollow(sprite)`. Clicking elsewhere or pressing Escape calls `camera.stopFollow()`.

**Mini-map (ui/MiniMap.js):** Fixed-position overlay (bottom-right). Shows dungeon at reduced scale. Camera viewport indicator shows current view position. Clickable to jump camera.

---

## Build Phase — Room Placement Flow

1. Player clicks room type in Palette
2. Room preview sprite follows cursor, snaps to 32px grid
3. `DungeonGrid.validatePlacement()` runs every tick — preview tints red/green
4. Violation tooltips show on invalid placement
5. Left-click confirms placement: `DungeonGrid.placeRoom()` → auto-routes corridors → tilemap updates → Soul Essence deducted
6. Right-click cancels

**Corridor auto-routing** (triggered after every room placement):
1. Scan all rooms for connection points facing the newly placed room
2. For each compatible pair, check if distance is within corridor routing range
3. If connectable: run A* to route corridor tiles (prefers empty space, avoids room interiors)
4. If multiple valid routes exist: choose shortest

---

## Day Phase — Time Controls

Phaser's `this.time.timeScale` controls simulation speed. UI updates always run at real time.

| Button | timeScale |
|---|---|
| Pause | 0 |
| 1× | 1 |
| 2× | 2 |
| 4× | 4 |

**Auto-pause triggers** (subscribed to EventBus):
- `BOSS_FIGHT_STARTED`
- `PARTY_WIPED` (all members of a party die in one day)
- `MECHANIC_ACTIVATED`
- `ADVENTURER_DIED` (optional, player-toggled)

---

## Phase Build Order

This is the agreed implementation sequence. Do not skip ahead. Stop and ask before making design decisions not covered in this document.

| Phase | What Gets Built |
|---|---|
| **1 — Foundation** ✅ | Phaser setup, Boot/Preload/MainMenu scenes, portal.js integration, EventBus, SaveSystem, core GameState schema, balance.js |
| **2 — Dungeon Rendering** ✅ | DungeonGrid, Game scene (tilemap + camera + mini-map), boss room pre-placed, grid scroll/zoom, NightPhase overlay with palette + room placement |
| **3 — Build Phase** ✅ | DayPhase scene stub, EssenceSystem (upkeep enforcement), more room definitions, room removal UI, placement undo |
| **4 — Adventurer AI** ✅ | Adventurer entity, PathfinderSystem (basic A*), AISystem (walk dungeon, enter rooms), DayPhase scene (time controls, click-to-inspect), day/night cycle loop |
| **5 — Personality System** ✅ | PersonalitySystem, 8 personality definitions, combo detection, thought bubbles, party formation |
| **6 — Combat (kernel)** ✅ | CombatSystem (typed kill events), Minion entity + 5 types, MinionAISystem (guard/same-room engage), MinionRenderer, adventurer FLEE goal, mid-dungeon death, barracks-distance validation, minion upkeep, night-respawn |
| **6b — Combat enrichment (traps + UI)** ✅ | TrapSystem + 5 traps + placement UI, combat log, last words, chat bubbles, wider thought-bubble states, trap upkeep |
| **6c — Combat enrichment (abilities + behavior)** ✅ | Mage mana drain, cleric heal_ally + smite_undead, HEAL goal (potion), martyr taunt, coward flee-on-enemy, paranoid slow-movement, mercy trap |
| **6d — Faction system + remaining mechanics** ✅ | Minion faction field, necromancer raise_corpse, beast_tamer tame, traumatized panic-flee, curse brand trap, echo mine, mana regen, the_fan spare_idol |
| **6e — Backfill (orphaned phase-6 items)** ✅ | Archetype modifiers, ranger class, resource-flee, room behaviors, utility minions, SLEEP goal |
| **7 — XP / Leveling / Evolution / Loot** ✅ | LootSystem (drop/equip/provenance), LootRenderer, EvolutionSystem (XP/level/evolution), minion naming generator, MinionInspector UI, bounty flag, level badges |
| **7b — XP/loot polish** ✅ | Dungeon level progression, adventurer scaling, vendetta, mini-bosses, SEEK_LOOT, vulture skip-combat, underdog 2× XP, wanted poster, vengeful_wraith |
| **8 — Knowledge System** ✅ | KnowledgeSystem, room/trap/minion observation, flee-share with personality accuracy, inheritance on spawn, returning leader, pathfinder weighting, knowledge overlay UI, memory_trap |
| **8b — Knowledge polish** | Replay ghosts, Mirror Maze, vandal disarm, between-run shopping, Eternal Night fog-of-war |
| **9 — Dungeon Mechanics** | DungeonMechanicSystem, EndOfDay scene, newspaper, 10+ mechanic definitions |
| **10 — Boss Fight + Polish** | BossFightScene, BossSystem, boss evolution tree, ArchetypeSelect, Graveyard scene, GameOver eulogy, reputation + guilds, loot provenance, leaderboard |

---

## Phase 7b Implementation Notes (Backfill)

Ten items, no new top-level systems — all hooks into existing AISystem/EvolutionSystem/LootSystem/PersonalitySystem/Game.

### Dungeon level progression trigger
- `AISystem._checkDungeonLevelUp` fires after every adventurer kill. Cumulative kills follow a geometric curve: `BASE × SCALE^(n-2)` summed (BASE 5, SCALE 1.4 → kills needed 5, 12, 22, 36, 56, …).
- Increments `gameState.meta.dungeonLevel` and emits `DUNGEON_LEVELED_UP { newLevel, totalKills }` on cross-over.
- Capped at `DUNGEON_LEVEL_MAX` (20).

### Adventurer stat scaling
- DayPhase._scaleAdventurerByDungeonLevel applies after `createAdventurer`. `+ADVENTURER_HP_PER_DUNGEON_LV` (10%) per level above 1, `+ADVENTURER_ATK_PER_DUNGEON_LV` (7%) for attack. Compounded linearly, not multiplicatively.

### Vendetta system
- LootSystem._maybeCreateVendetta runs on every equip with `VENDETTA_TRIGGER_CHANCE` (0.4). Reads the item's `wielded_by` provenance entry to pick a "sibling" — uses the same class as the avengee.
- Persisted to `gameState.vendettas[]` with `{ itemInstanceId, minionInstanceId, claimantClass, avengeeName, ... }`.
- DayPhase._pickActiveVendetta filters to vendettas whose target minion is still alive on the dungeon faction. 35% chance per spawn day to inject a Vendetta Hunter (named after the dead family) with goal `{ type: 'SEEK_VENDETTA', minionId, itemId }`.
- AISystem._goalToTile resolves SEEK_VENDETTA to the target minion's current tile; falls back to SEEK_BOSS if the minion has died.

### Mini-bosses
- Auto-promotion: when a minion is placed in a `treasure_room`, NightPhase._confirmMinionPlacement applies `MINIBOSS_HP_MULT` (3×) and `MINIBOSS_ATTACK_MULT` (1.6×), sets `isMiniBoss=true`, emits `MINIBOSS_PROMOTED`.
- LootSystem subscribes to `MINION_DIED`. On a mini-boss death, generates a guaranteed high-tier item (preferring max available tier given dungeon level).

### SEEK_LOOT goal
- PersonalitySystem.evaluateGoal extended with `floorLoot` situation parameter. If `lootPriority > 0.6` and any floor loot exists, ~lootPriority chance to set `goal: { type: 'SEEK_LOOT', itemId }`.
- AISystem._goalToTile resolves to the loot's tile. _pickNextGoal queries `gameState.loot.dungeon` filtered to `tileX != null` (skip equipped items).
- _onGoalReached for SEEK_LOOT: removes the item from `loot.dungeon`, pushes to `adv.gear`, emits `GEAR_PICKED_UP`, picks the next goal.

### Vulture loot-stealing
- AISystem._tickAdventurer: if adventurer has `vulture` tag AND there's floor loot in their current room, skips combat engagement entirely (`return` before tryAttack). Their existing high lootPriority already steers them to SEEK_LOOT goals.

### Underdog adventurer XP
- EvolutionSystem._onCombatKill detects when source is an adventurer, awards `8 × UNDERDOG_XP_MULT` (2× for underdogs, 1× otherwise).
- `_awardAdventurerXp` runs a while-loop in case of multi-level pops. Each level: +3 attack, +5 maxHp. Threshold curve: lv2 at 30 XP, lv3 at 60, etc.

### Wanted poster popup
- New UI module `src/ui/WantedPoster.js`. Subscribes to `MINION_BOUNTY_POSTED`. Renders a parchment-styled popup at top-right with name + kills + gear count + flavor line "Hunters approach. Reinforce the wing." Stacks vertically; each fades after 5s.

### vengeful_wraith evolution + respawn count
- MinionAISystem.respawnAll increments `minion.timesKilledAndRespawned` for any minion with `aiState === 'dead'` at respawn time. Emits `MINION_RESPAWNED { minion, count }`.
- EvolutionSystem subscribes to MINION_RESPAWNED → re-runs `_checkEvolutions` on the minion. The `timesKilledAndRespawned` condition check now reads the counter and fires vengeful_wraith at threshold 3.

### Equipped-item display by name
- LootSystem.equipToMinion now keeps the LootItem in `loot.dungeon` (with `tileX=null` to mark "equipped, not on floor"). Floor renderers and goal evaluators already filter by tile coords so this doesn't disrupt them.
- MinionInspector resolves equipped items via `gameState.loot.dungeon.find(i => i.instanceId === id)` and shows the lootDef's name with rarity-based color.

### Balance constants added (Phase 7b)
- `DUNGEON_LEVEL_KILLS_BASE: 5`, `DUNGEON_LEVEL_KILLS_SCALE: 1.4`, `DUNGEON_LEVEL_MAX: 20`
- `ADVENTURER_HP_PER_DUNGEON_LV: 0.10`, `ADVENTURER_ATK_PER_DUNGEON_LV: 0.07`
- `UNDERDOG_XP_MULT: 2.0`
- `MINIBOSS_HP_MULT: 3.0`, `MINIBOSS_ATTACK_MULT: 1.6`, `MINIBOSS_GUARANTEED_DROP: true`
- `VENDETTA_TRIGGER_CHANCE: 0.4`
- `VULTURE_LOOT_STEAL_RANGE: 2` (reserved — not yet used)
- `WRAITH_RESPAWN_THRESHOLD: 3`

### Deferred to Phase 10 polish
- Rename-minion UI (input field flow)
- Scavenger / Cleaner minions (corpse handling — interacts with future graveyard-on-floor system)
- Backstab kill-method emission (would require adventurer "stealth attack" classifier — can ride along with combat polish)

---

## Phase 6e Implementation Notes (Backfill)

Phase 6e closes out the orphaned phase-6 items that the kernel/b/c/d phases didn't include because they were combat-focused. Eight backfill items, no new top-level systems — all hooks into existing AISystem/MinionAISystem/CombatSystem/TrapSystem.

### Archetype-gated minion modifiers
- Game.create caches `gameState.player.archetypeModifiers` at boot from the chosen archetype's JSON entry. Other systems read from there.
- **Minion stats**: NightPhase._confirmMinionPlacement applies `minionStatMultiplier` to attack/defense/maxHp at placement time (Tyrant 2×, Architect implicit ~0.85×).
- **Minion XP**: EvolutionSystem._onCombatKill multiplies the kill XP by `minionXpMultiplier` (Beast Lord 1.6×).
- **Essence gain**: AISystem._kill multiplies SOUL_ESSENCE_PER_KILL by `essenceGainMultiplier` (Lich 1.2×).
- **Room cost**: NightPhase._confirmPlacement applies `roomCostMultiplier` to essenceCostToPlace (Tyrant 2×, Architect 0.75×).
- **Trap palette filter**: NightPhase._renderTrapCards filters by `blockedTrapTypes` (Beast Lord blocks `'*'` → no traps shown).

### Ranger class + arrow resource
- New entry in adventurerClasses.json: HP 35, attack 9, speed 1.9, attackRange 4, starting arrows 18.
- CombatSystem._computeDamage: rangers consume 1 arrow per attack. Out of arrows → 0.4× melee fallback (close-quarters knife).
- CombatSystem._inferMethod returns `'ranged'` when rangers have arrows, `'melee'` otherwise — feeds Phase 7 `vengeful_wraith` evolution detection.

### Resource depletion → leave dungeon
- AISystem._resourceExhaustedShouldFlee runs each tick before standard flee check.
- Mages: empty mana **AND** hostile minion in room → flee with reason `'out_of_mana'`.
- Rangers: empty quiver **AND** hostile minion in room → flee with reason `'out_of_arrows'`.
- Helper `_anyHostileMinionInRoom(adv)` filters dungeon-faction minions in current room.

### Hall of Echoes sound-alert
- MinionAISystem subscribes to `COMBAT_HIT`. If the hit happens in a `hall_of_echoes` room, all *adjacent* rooms get added to `_alertedRooms` map with an 8000ms expiry.
- During alert, `_pickTarget` ignores `ENGAGE_REQUIRES_SAME_ROOM` and extends the aggro range to 2.5×, so minions chase the source across rooms briefly.
- Auto-cleared on `NIGHT_PHASE_STARTED`.

### Healing Fountain heal-on-stand
- AISystem._applyRoomEffects called every tick. If room is `healing_fountain` AND room.isActive AND adventurer not in `'fighting'` state → restore HP at `HEALING_FOUNTAIN_HP_PER_SEC` (4 HP/sec).
- Doesn't trigger if essence-shut-off has deactivated the room.

### Barracks sneak-through
- MinionAISystem maintains `_wokenRooms` set. Combat in a `starter_barracks` (or `barracks`) room flips that room's id into the set.
- `_isRoomSleeping(homeRoom)` returns true while the room hasn't seen combat → `_pickTarget` returns null early, so guard minions there don't engage adventurers walking through.
- Once any combat fires (adventurer attacking, trap firing — anything that emits COMBAT_HIT in the room), all minions wake up permanently for the rest of the day.

### Utility minion behaviors
- **Sapper**: `_tickSapper` per tick. For each triggered trap in the same room, accumulates `repairProgress` at ~0.0004 per ms (≈ 2.5 sec per trap). Hits 1.0 → flips `isTriggered=false`, clears state, emits `TRAP_REPAIRED`.
- **Herald**: `_tickHerald`. If any adventurer is inside herald's home room, alerts adjacent rooms via `_alertedRooms` with `HERALD_ALERT_DURATION_MS` (5s). Stacks with hall_of_echoes alert.
- **Engineer**: passive. TrapSystem._fireTrap checks `_engineerInRoom(roomId)` — if any engineer minion is in the trap's room, multiplies damage by `ENGINEER_TRAP_DAMAGE_BUFF` (1.25×).
- **Mourner**: event-driven. Subscribes to `MINION_DIED`. For each surviving mourner in the same room as the dead minion, increments `stats.attack` by `MOURNER_DAMAGE_BUFF_PER_DEATH` (2). Tracks `_mournerStacks` for inspector display.
- New minion type defs added: `engineer`, `mourner` (sapper + herald already existed).
- Starting unlocks now include all 4 utility minions.

### SLEEP goal
- AISystem._shouldSleep / `_sleep`. Triggers when:
  - HP fraction ≤ POTION_HEAL_THRESHOLD (0.4)
  - No potions left (otherwise sip first)
  - No hostile minions in same room (`SLEEP_REQUIRES_NO_HOSTILES`)
  - HP < maxHp
- `aiState='sleeping'`, no movement, no attacks. Restores `SLEEP_HP_PER_SEC` (3 HP/sec). Wakes at full HP → `aiState='walking'`.
- Damage breaks sleep automatically because `_checkFleeTrigger` runs on incoming hits and may switch to FLEE.

### AdventurerRenderer thought-bubble states
- New states: `sleeping` → 'z' blue, `healing` → '+' purple. Existing fighting/fleeing/exploring still cover the rest.

### Balance constants added (Phase 6e)
- `HEALING_FOUNTAIN_HP_PER_SEC: 4`
- `ECHOES_ALERT_DURATION_MS: 8000`
- `HERALD_ALERT_DURATION_MS: 5000`
- `MOURNER_DAMAGE_BUFF_PER_DEATH: 2`
- `ENGINEER_TRAP_DAMAGE_BUFF: 1.25`
- `SLEEP_HP_PER_SEC: 3`
- `SLEEP_REQUIRES_NO_HOSTILES: true`

---

## Phase 8 Implementation Notes

### KnowledgeSystem (`src/systems/KnowledgeSystem.js`)
- Owns the per-adventurer + global knowledge state. Subscribes to `TRAP_TRIGGERED`, `ADVENTURER_FLED`, `ADVENTURER_DIED` for automatic recording / sharing.
- Per-adventurer state lives on `adv.knowledge = { rooms, traps, minions }`. Each entry has `accurate`, `source` ('witnessed' | 'told' | 'rumor'), `dayLearned`.
- Global pool: `gameState.sharedKnowledge` — aggregated intel from all flee events. New adventurers inherit a fraction at spawn (`KNOWLEDGE_INHERIT_FRACTION` 0.5) with rumor-grade accuracy.
- Public API: `observeCurrentRoom(adv)`, `observeMinion(adv, minion)`, `initializeKnowledgeForSpawn(adv)`, `rollReturnLeader()`, `costMultiplierForTile(adv, tx, ty)`, `computeKnowledgeMap()`, `hasVisitedRoom(adv, roomId)`.
- Trap awareness wires automatically through the `TRAP_TRIGGERED` event handler — every adventurer in the same room learns about the trap, including its tile and current sprung state.

### AISystem hooks
- New constructor param: `knowledgeSystem`. Stored on `_knowledgeSystem`; `setKnowledgeSystem(ks)` setter for late binding.
- Each tick: `_knowledgeSystem?.observeCurrentRoom(adv)` records the room (idempotent — only emits ROOM_OBSERVED on first visit per day).
- Inside `_findEngageableMinion`: any minion within engagement reach gets `observeMinion(adv, m)` called even before combat starts (you can't fight what you can't see).
- Pathfinder calls now pass an optional `costFn` derived from `_knowledgeSystem.costMultiplierForTile`. Tiles with known traps get a 6× multiplier — adventurers route around dangers they remember.

### Sharing on flee (`_onAdventurerFled`)
- Personality-driven accuracy multiplier:
  - `mapper` tag (cartographer)            → 1.00 (full intel)
  - `traumatized` or `flags.fullKnowledgeOnFlee` → 1.00 (sole-survivor adrenaline)
  - `coward` tag                           → 0.85 (ran past too fast to verify everything)
  - default                                → 0.85
- The fled adventurer's `knowledge.{rooms,traps,minions}` is merged into the shared pool. Each entry only overwrites the global if its accuracy beats the existing entry — so a careful cartographer's report beats a cowardly rumor.
- The fled adventurer is then `_addOrUpdateKnown` → persisted to `gameState.adventurers.known[]` with deep-cloned knowledge so `rollReturnLeader()` can revive them next day.

### Returning leader spawn flow (DayPhase)
- `_spawnDailyAdventurers` consults `KnowledgeSystem.rollReturnLeader()` first. On hit, picks the most-recent fled record.
- Builds a party of `KNOWLEDGE_RETURN_PARTY_SIZE_MIN..MAX` (2–4) around the leader.
- Leader spawns with `knowledge` deep-cloned from their record — same intel they fled with.
- Followers inherit from shared pool (rumor-grade) AND get the leader's intel copied with `source: 'told'` (full intel, second-hand). Implements the design intent: "with all of their party knowing what he knows from his last visit".
- Sets `flags.returningLeader = true` on the leader and emits `ADVENTURER_RETURNED` event.

### PathfinderSystem extension
- `findPath(start, end, dungeonGrid, costFn?)` now accepts an optional cost function `(tx, ty) => multiplier`. Multiplier ≥ 1; default falls back to 1 (uniform).
- `tentativeG = gScore[currKey] + tileCost` where `tileCost = max(1, costFn(nx, ny))`.

### TrapSystem additions
- New trigger: `adventurer_was_here_before` — fires only when `adv.knowledge.rooms[roomId].visitCount >= 2`. Memory trap uses this.
- Existing `_onTrapTriggered` hook in KnowledgeSystem flips `trap.isKnownToAdventurers = true` and stamps every adventurer in the same room.

### KnowledgeOverlay (`src/ui/KnowledgeOverlay.js`)
- Single Graphics object at depth 2.5 (above grid + corridors, below room outlines). Toggleable via `setEnabled(on)`.
- `update()` (called from Game.update during day phase) reads `KnowledgeSystem.computeKnowledgeMap()` — a roomId → 0..1 warmth map combining:
  - shared-pool baseline (0.3 + 0.5 × accuracy)
  - active-adventurer boost (1.0 if visited, 0.6 if accurately rumored)
- Color: cool blue → purple → red gradient, alpha 0.35 fill + brighter outline.
- DayPhase has a KNOWLEDGE button (left of END DAY) that calls `Game.knowledgeOverlay.setEnabled(active)`.

### Game.js wiring
- New systems: `knowledgeSystem`, `knowledgeOverlay`. Both instantiated in `create()` after CombatSystem (KnowledgeSystem before AISystem so AISystem gets the reference at construction).
- DayPhase reads `game.knowledgeSystem` for `rollReturnLeader` and `initializeKnowledgeForSpawn`.

### Balance constants added
- `KNOWLEDGE_TRAP_COST_MULTIPLIER: 6.0`
- `KNOWLEDGE_DANGER_ROOM_MULT: 1.8`
- `KNOWLEDGE_INHERIT_FRACTION: 0.5`
- `KNOWLEDGE_INHERIT_ACCURACY: 0.7`
- `KNOWLEDGE_RETURN_CHANCE: 0.35`
- `KNOWLEDGE_RETURN_PARTY_SIZE_MIN: 2`, `_MAX: 4`
- `KNOWLEDGE_CARTOGRAPHER_BOOST: 1.0`
- `KNOWLEDGE_COWARD_PARTIAL: 0.85`
- `KNOWLEDGE_TRAUMATIZED_PARTIAL: 1.0`

### What's deferred to 8b
- Replay Ghosts (visual replay of prior runs — significant new render path)
- Mirror Maze room (cartographer-disrupting room mechanic with reflective tile geometry)
- Vandal disarm action (per-trap repair flow, ties to trap-state mutation)
- Between-run shopping (adventurer leaves dungeon → buys gear → returns stronger; orthogonal economy)
- Eternal Night fog-of-war (Phase 9 mechanic foundation, ties into vision range)

---

## Phase 8b Implementation Notes (Knowledge polish)

### Replay Ghosts
- `AISystem._samplePath(adv, delta)` writes `{x, y, day}` samples to `adv.pathHistory` every `Balance.REPLAY_PATH_SAMPLE_MS` (500ms). Capped at `REPLAY_PATH_MAX_SAMPLES` (60) — old samples shift off the front.
- `KnowledgeSystem._addOrUpdateKnown` snapshots `pathHistory` into the persisted `AdventurerRecord` so it survives across day cycles.
- `DayPhase._spawnDailyAdventurers` copies the record's path into `leader.priorPathHistory` and emits `ADVENTURER_RETURNED { adventurer, source, priorPathHistory }`.
- `ui/ReplayGhostRenderer.js` subscribes to that event, allocates a `Graphics` at depth 2.6 (between the knowledge overlay and entities), and per-frame fades the trail over `REPLAY_GHOST_FADE_MS` (8000ms). Newer dots brighter; trail self-destructs at full fade. Cleared on phase change.

### Mirror Maze
- New `mirror_maze` room in `rooms.json` (8×8, special tag, 30 essence to place).
- `KnowledgeSystem.observeCurrentRoom` now rolls `Math.random() < MIRROR_MAZE_KNOWLEDGE_ACCURACY` (0.4) on first visit when `room.definitionId === 'mirror_maze'`. Failed roll → `accurate: false`, `source: 'mirror_maze'`. Knowledge of this room is rumour-grade for everyone, including cartographers.

### Vandal disarm
- `TrapSystem._tryVandalDisarm(trap, def)` runs before the normal evaluator. If a vandal-tagged adventurer occupies the trap tile, the trap is set `isTriggered = true` with `disarmedByVandalId`. Damage = `VANDAL_DISARM_DAMAGE` (0). Emits both `TRAP_DISARMED` and `TRAP_TRIGGERED { …, disarmed: true }` so KnowledgeSystem still records the room as known.
- `TrapRenderer` already dims+slashes triggered traps — disarmed traps inherit that "spent" look.
- `TrapSystem.resetAll()` (NIGHT_PHASE_STARTED) re-arms — vandal disarm is a per-day effect.

### Between-run shopping
- When `KnowledgeSystem.rollReturnLeader()` returns a record, `DayPhase` now also adds `RETURNING_GEAR_BONUS_HP` (8) to `maxHp`/`hp` and `RETURNING_GEAR_BONUS_ATK` (2) to attack on the spawned leader, then sets `flags.shoppedBetweenRuns = true`.

---

## Phase 9 Implementation Notes (Dungeon Mechanics + Newspaper)

### DungeonMechanicSystem (`src/systems/DungeonMechanicSystem.js`)
- Manages `gameState.activeMechanics: string[]` (mechanic IDs). Definitions are JSON-driven via `src/data/dungeonMechanics.json` (9 active pacts: taxation_of_souls, bloodbound, gold_rush, undying_horde, sealed_paths, pack_synergy, blood_money, hasty_architect, great_erasure).
- Each definition has `onActivate`, `onDeactivate`, optional `onDailyTick` handler IDs that are looked up in the in-file `_buildHandlerRegistry()`.
- Public API: `activate(id)`, `deactivate(id)`, `isActive(id)`, `getOfferings(count, archetypeId, dungeonLevel)`, `tickDay(deltaMs)`.
- `getOfferings` filters by:
  - already-active set
  - archetype `blockedMechanics` modifier
  - `unlockLevel ≤ dungeonLevel + 1`
  - `exclusiveWith` already-active ⇒ unavailable
  - `availableToArchetypes` array (unless `'all'`)
- Handler `ctx` exposes a `subscribe(event, fn)` helper that auto-tracks subscriptions for cleanup on deactivate.
- On Game scene boot, `loadDefinitions()` re-activates every mechanic in saved state — handlers re-bind their listeners.

### Mechanic readers in other systems
- **AISystem essence award**: applies `MECHANIC_TAXATION_ESSENCE_PENALTY` (0.7×) when `taxationOfSouls` is on.
- **CombatSystem._computeDamage**: applies `MECHANIC_BLOODBOUND_DAMAGE_MULT` (1.5×) for minion attackers; `packSynergy` adds +15% per ally in room up to +60%; `sealedPaths` adds 1.25× for cornered fleeing adventurers.
- **MinionAISystem.respawnAll**: under `bloodbound`, dead minions are spliced out instead of revived. Emits `BLOODBOUND_LOSSES`.

### EndOfDay scene (`src/scenes/EndOfDay.js`)
- Lifecycle: `DayPhase._endDay() → scene.start('EndOfDay')` instead of going straight to NightPhase. Skip button or any card click → `scene.start('NightPhase')`.
- Left panel: newspaper (headline + body paragraphs + footer with casualty/flee/active-mechanic counts).
- Right panel: 3 mechanic offer cards filtered by `getOfferings(3, archetypeId, dungeonLevel)`. Each card shows name, description, and tradeoff (gold italic).

### NewspaperSystem (`src/systems/NewspaperSystem.js`)
- Subscribes during the day to: `ADVENTURER_DIED`, `ADVENTURER_FLED`, `MINION_DIED`, `TRAP_TRIGGERED`, `TRAP_DISARMED`, `MINION_LEVELED_UP`, `MINION_EVOLVED`, `MINION_BOUNTY_POSTED`, `DUNGEON_LEVELED_UP`, `VENDETTA_HUNTER_ARRIVED`, `ADVENTURER_RETURNED`, `MECHANIC_ACTIVATED`, `BLOODBOUND_LOSSES`. Buffer is reset on `DAY_PHASE_STARTED`.
- `compose()` returns `{ day, headline, body[], casualties, fled, mechanics[] }`.
- Tone: workplace memo. Headlines parameterised by death/flee counts; casualty list uses adventurer name + class + killer; flees note "embarrassing internal documents."

### What's deferred to 9b (acknowledged orphans)
- Dossier system (pre-day adventurer info card)
- Trap memory UI (per-adventurer "spent" icons showing what they know)
- Hidden keys + locked doors progression
- Auto-pause on key events
- Inquisitor mechanic-disable behaviour
- Adventurers fight among themselves over loot
- Mimic AI and Echo (mimic-the-last-seen-adventurer) personalities — Phase 10

---

## Phase 9b Implementation Notes (Dungeon polish)

### AutoPauseSystem — **REMOVED**
- Originally paused the game on key events (boss fight, level-up, etc.) via `AUTOPAUSE_TRIGGERED`.
- Removed because the boss-fight pause caused fleeing adventurers to freeze: AISystem ticks were gated on `timeScale > 0`, so the cinematic flee animation in BossSystem couldn't hand off to the AISystem `FLEE` goal until the player manually resumed.
- All wiring stripped: no `AutoPauseSystem.js`, no listeners in DayPhase, no `_showAutoPauseBanner`.  The player can still pause manually via the time-control buttons.

### InquisitorSystem (`src/systems/InquisitorSystem.js`)
- On `ADVENTURER_ENTERED_DUNGEON` for an inquisitor-tagged adventurer, schedules an 8-second "investigate" delay then deactivates a random active dungeon mechanic.
- Snapshot of dispelled mechanic stored per `advId` in `_suspended`. Restored on `ADVENTURER_DIED`, `ADVENTURER_FLED`, or `DAY_PHASE_ENDED`.

### DossierPanel (`src/ui/DossierPanel.js`)
- Created in `DayPhase.create()` and `show(spawned)` is called 300 ms after spawn.
- Renders one card per spawned adventurer with class, personality tags, prior-visit count from `gameState.adventurers.known`, and flags for `shoppedBetweenRuns`, `vendettaMinionId`. Auto-dismisses after 4.5 s or on click.

### LootGreedSystem (`src/systems/LootGreedSystem.js`)
- Per-day tick scan every 4 s. Groups greedy-tagged adventurers by current room; if 2+ are present in a room with unclaimed loot, picks two at random and applies 6% maxHP `COMBAT_HIT` damage to each (also emits `LOOT_GREED_BRAWL`). Damage feeds the existing flee/kill plumbing so brawls naturally end with someone fleeing or dying — free XP for the dungeon.

### Trap-memory UI (in `TrapRenderer`)
- New `knownBadge` text (👁 glyph) is added to each trap container; visible when any active adventurer's knowledge map flags this trap as `accurate`, or the shared pool has a record. Shown only on un-triggered traps (since triggered traps already display the spent slash).

---

## Phase 10 Implementation Notes (Boss Fight, Eulogy, Reputation)

### BossSystem (`src/systems/BossSystem.js`)
- Initialises `gameState.boss = { hp, maxHp, attack, defense, deathsRemaining }` from the chosen archetype's `baseFightStats`. `deathsRemaining` starts at `BOSS_DEFEATS_TO_GAME_OVER` (3).
- AISystem `_onGoalReached` for `SEEK_BOSS` no longer instant-kills — it switches `adv.goal = { type: 'AT_BOSS' }` and emits `BOSS_FIGHT_INCOMING`.
- BossSystem listens for `BOSS_FIGHT_INCOMING`, waits 1.5 s (so the auto-pause banner is visible), then `_resolve()`:
  - Collects party in/adjacent to boss_chamber.
  - Iterates rounds: party totalAttack vs boss defense → boss HP damage; boss attack divided across alive members → party damage. Up to 12 rounds, with stat variance.
  - Emits `BOSS_FIGHT_RESOLVED { winner, bossHpRemaining, deathsRemaining, rounds, roundLog, party }`.
- On party win: deathsRemaining decrements, dead party-mates dispatched via COMBAT_KILL emit, survivors fleed with reason `boss_defeated`.
- On boss win: every adventurer in the room dies via COMBAT_KILL emit (loot/evolution chain naturally).
- `BOSS_DEFEATED_FINAL` fires when deathsRemaining hits 0 → Game.js stops the active scene and starts `GameOver`.

### GameOver scene (`src/scenes/GameOver.js`)
- Eulogy panel: days survived, total kills, top minion (by `bountyKillCount`), notable graveyard entries, active mechanics at end of run.
- Two buttons: NEW RUN (`SaveSystem.deleteSave()` + ArchetypeSelect) and GRAVEYARD (open Graveyard scene with `returnTo: 'GameOver'`).

### Graveyard scene (`src/scenes/Graveyard.js`)
- Scrollable list of every dead adventurer (most-recent first). Per row: name + class + day + killer + personality tags. Mouse-wheel scroll. ESC/Back returns to caller.
- Reachable from GameOver kernel; Phase 10b will add NightPhase debug shortcut + sort/filter UI.

### ReputationSystem (`src/systems/ReputationSystem.js`)
- Subscribes to `COMBAT_KILL` (+1), `MINION_BOUNTY_POSTED` (+5), `DUNGEON_LEVELED_UP` (+10), `DAY_PHASE_ENDED` (+5), `ADVENTURER_FLED` (-1).
- Tier ladder: unknown → whispered (25) → feared (75) → legendary (150) → mythic (300). Tier change emits `REPUTATION_TIER_CHANGED`.
- `legendarySpawnChance()` returns 0 / 0.10 / 0.20 / 0.30 by tier — DayPhase rolls per first-spawned non-leader; on hit promotes adventurer with `isLegendary=true` and 1.5× HP / 1.4× ATK / 1.3× DEF, emits `LEGENDARY_HERO_ARRIVED`.

### Mimic minion (Mimic Vault room) — chest disguise (rebuilt 2026-05-02)
- `mimic` minion type in `minionTypes.json` — HP 60 / ATK 22 / DEF 5, `unlockLevel: 10`, gold cost 35. Not placeable from the build menu; only `RoomBehaviorSystem._refillMimicVault` spawns them.
- Spawn extras: `{ isMimicVaultSpawn: true, isMimic: true, mimicState: 'chest' }` — start as chests.
- **Behavior gating** while `mimicState === 'chest'`:
  - `MinionAISystem._tickMinion` early-returns — they sit still.
  - `AISystem._findEngageableMinion` skips them — advs see chests, not threats.
- **Open-roll** in `RoomBehaviorSystem._rollMimicOpens`, fired on every `ADVENTURER_ROOM_CHANGED` into a Mimic-Vault room. Per-chest:
  - `Balance.MIMIC_OPEN_CHANCE_UNKNOWN = 0.40` if the adv has no `knowledge.mimics[mimicId]` entry.
  - `Balance.MIMIC_OPEN_CHANCE_KNOWN = 0.05` if they do.
- **Reveal** in `_revealMimic`: flip `mimicState='revealed'`, set `aiState='engaging'`, deal `0.30 × maxHp` bite to the opener, mark every alive adv's `knowledge.mimics[mimicId]`, emit `MIMIC_REVEALED` + `COMBAT_HIT` (+ `COMBAT_KILL` if the bite kills).
- **Persistence** — `KnowledgeSystem.sharedPool.mimics` mirrors `knowledge.traps`. Survivors carry their mimic knowledge into the survivor record; `_rebuildSharedPool` unions it; next-day fresh spawns inherit via `initKnowledgeForSpawn` → low open-chance from day 1.
- **Visual** — `MinionRenderer` paints a chest sprite (wooden body, gold corner trim, lock) while in chest state and hides the normal sprite/HP bar/lvLabel. On reveal the chest hides and the regular mimic anim takes over.

### Echo personality
- New `echo` personality in `personalities.json` (rare, unlock 4). Tags: `echo`, `mimic_path`, `cautious`.
- AISystem `_pickNextGoal` short-circuits for echo-tagged advs: returns `{ type: 'FOLLOW_LEADER', leaderId, targetX, targetY }` targeting the most-recent non-echo party member's current tile.
- `_goalToTile` resolves FOLLOW_LEADER to the leader's CURRENT tile each replan (so the echo dynamically retraces). On `_onGoalReached` for FOLLOW_LEADER, replans via `_pickNextGoal` to keep tracking.
- If the leader dies/disappears, falls back to SEEK_BOSS.

### Hidden keys + locked doors (foundation)
- `iron_key` loot type added to `lootDefinitions.json` (type: `key`).
- AISystem `_pickNextGoal` filters out rooms where `room.locked === true` unless the adventurer carries a key in `gear`. Full pathfinder/door-rendering integration deferred to Phase 10b.

### BossFightOverlay (`src/ui/BossFightOverlay.js`)
- Subscribes to `BOSS_FIGHT_INCOMING` (shows pulsing "INTRUDER AT THE GATE" banner with lives-remaining sub) and `BOSS_FIGHT_RESOLVED` (replaces with red "YOU LOST A LIFE" or green "INTRUDER REPELLED" banner; auto-fades after 2 s).

### What's deferred to 10b (acknowledged orphans)
- Boss evolution tree (XP-spent abilities), summon adds, environmental hazards
- Guild raid teams, endless mode, challenge runs, Supabase leaderboard
- 10 unlockable boss archetypes (currently 5)
- Full Graveyard sort/filter UI
- (Resolved 2026-05-02) Mimic chest visual — `MinionRenderer` chest sprite with gold trim + lock
- Twitch streamer chat_poll behavior

---

## Phase 10b Implementation Notes (Endgame polish)

### Boss evolution tree
- New `src/data/bossAbilities.json` with 6 nodes across 3 tiers. Each node has `powerCost`, `requires[]`, `effect` ID.
- `BossSystem` persists `gameState.boss.unlockedAbilities[]`. Public API: `getAvailableAbilities(filterAffordable)` and `unlockAbility(id)` — validates ownership / requires / cost, ~~deducts Dark Power~~ (Dark Power retired 2026-05-05; cost path is currently no-op pending follow-up to switch to Gold), applies passive stat bonuses.
- EndOfDay scene gains "BOSS UPGRADES (N DP)" button → modal with full ability grid (state colours: owned green ✓ / available purple / locked dim).
- `_resolve()` reads owned abilities each fight: `soul_drain` → boss starts at 125% HP; `summon_adds` → 2 skeleton helpers via `_summonAddsNearBoss`; `second_wind` → one-time +30 HP if boss < 20%; `necrotic_aura` → 5% maxHp AOE per round.

### Environmental hazards
- New rooms in `rooms.json`: `lava_floor` (6×6, 40 essence) and `collapsing_pillars` (8×6, 35 essence).
- `AISystem._applyRoomEffects` handles them: lava drains 3 HP/sec; pillars accumulate per-adv timer, every ~4s rolls 50% chance of 8 phys dmg (`PILLAR_FALLEN` event).

### Guild Raid teams
- `DayPhase._spawnDailyAdventurers` early-returns into a guild-raid branch when `repTier ∈ {feared, legendary, mythic}` (probability scales with tier) OR `runConfig.allRaids`.
- Spawns 4 advs sharing a `partyId`, `flags.guildRaid=true`, +25% HP/atk, 2 personalities each. Combo detection still runs. Emits `GUILD_RAID_ARRIVED`.

### Endless mode + Challenge runs
- `gameState.runConfig: { endless?, hardcore?, noTraps?, allRaids? }`.
- `ArchetypeSelect._renderChallengeRow` adds 3 toggle chips above BEGIN that set runConfig.
- `BossSystem._init` reads `runConfig.hardcore` → `deathsRemaining = 1`.
- `NightPhase._buildPalettes` reads `runConfig.noTraps` → empty trap palette.
- `DayPhase` reads `runConfig.allRaids` → forces guild-raid path daily.
- `GameOver._endless()` sets `runConfig.endless`, `boss.deathsRemaining=1`, +1 dungeon level, restarts NightPhase.

### 5 new boss archetypes
Added to `bossArchetypes.json`: the_warden (detention/prison), the_pyromancer (fire), the_shadow (knowledge denial), the_collector (loot/vendetta), the_swarm (mass weak minions). Each has `unlockCondition` referencing future progression hooks. Colour entries added to `ArchetypeSelect.ARCH_COLOR`.

### Graveyard sort + filter
- `Graveyard.init` accepts `sortKey` and `filterClass` so `scene.restart` round-trips selection.
- `_renderControls` row of chips: 4 sort options (recent/day/class/killer) + class filter (ALL + per-class chips). `_refresh` restarts the scene with current selection.
- Sort applied in `_renderList` before iteration; filter narrows `grave[]` first.

### Twitch streamer chat_poll
- `AISystem._tickAdventurer` accumulates `_chatPollAccum` for `classId === 'twitch_streamer'`. Every 10 s of game-time, picks a random unvisited non-boss room, replaces goal with `EXPLORE_ROOM`, clears path, emits `TWITCH_CHAT_POLL`. Doesn't fire while fighting/fleeing.

### What's still deferred (acknowledged final orphans)
- Supabase leaderboard (needs backend infra) — explicit defer
- 5 more boss archetypes (target was 15 total — 10 implemented)
- Locked-door render + pathfinder block (foundation in place: `room.locked` + key in gear filter; full path-blocking needs Pathfinder rework)
- Per-mimic chest sprite (gameplay works; cosmetic only)

---

## Phase 7 Implementation Notes

### LootItem entity (`src/entities/LootItem.js`)
- Plain JS factory; instances live in `gameState.loot.dungeon[]` while on the floor and in `gameState.loot.minionEquipment[minionId]` once equipped.
- `provenance: []` is append-only — every drop / equip / transfer adds an entry. Drives loot stories, vendettas, and Phase 9 newspaper flavor.
- `appendProvenance(item, entry)` exported helper for systems that touch ownership.
- `_statsToModifiers(baseStats)` converts the JSON's `{attackBonus: 3, defenseBonus: 2}` shape into a normalized modifier list applied uniformly.

### LootSystem (`src/systems/LootSystem.js`)
- Subscribes to `ADVENTURER_DIED` in its constructor — the AISystem death path didn't need to change.
- `dropFromAdventurer(victim, killerId, killerName)`:
  - Filters loot pool by `def.tier <= maxTier` (where `maxTier = 1 + floor((dungeonLevel-1) / LOOT_TIER_BY_DUNGEON_LEVEL)`)
  - Filters by `def.fromClasses` matching the victim's class
  - Rolls `LOOT_DROP_ROLLS_PER_DEATH` times (2), each gated by `def.dropChance`
  - De-dupes within a single death so the same definition can't drop twice
  - Builds a provenance entry: `wielded by ${name} (${classId}), killed by ${killerName} in ${roomId}`
  - Scatter-pattern offsets multi-drops onto adjacent tiles via `_scatter(idx)`
- `equipToMinion(itemInstanceId, minionInstanceId)`:
  - Removes from `loot.dungeon`, clears tile coords
  - Pushes to `minion.equippedGear` and `loot.minionEquipment[id]`
  - Calls `_applyModifiersToMinion(minion, statModifiers, +1)` which writes attack/defense/hp/speed onto the minion's stats
  - Special bonuses (spellBonus, fireDamageBonus, etc.) collect on `minion.equipBonuses` for combat to read in 7b
  - Appends `equipped_to` provenance entry, emits `GEAR_EQUIPPED_TO_MINION`

### LootRenderer (`src/ui/LootRenderer.js`)
- Container per item at depth 5 (above corridors, below adventurers/minions)
- Color-coded by rarity: `common` grey, `uncommon` green, `rare` blue, `epic` purple, `legendary` gold
- Glyph by type: `/` weapon, `#` armor, `*` accessory
- Click → emits `LOOT_CLICKED` (Phase 7b inspector hook)
- Skips items with null tile coords (already equipped)

### EvolutionSystem (`src/systems/EvolutionSystem.js`)
- Owns minion progression — XP awards, level-ups, evolution checks, bounty flagging, naming.
- Subscribes to `COMBAT_KILL`. Filters: only minion-faction='dungeon' kills of adventurers count.
- `_awardXp` runs a while-loop in case multiple level-ups happen at once; each level applies `MINION_LEVEL_HP_BONUS`/`MINION_LEVEL_ATTACK_BONUS`/`MINION_LEVEL_DEFENSE_BONUS` (defense every other level).
- `_checkEvolutions` iterates the minion's typeDef `evolutionPaths`; supports four condition shapes (`killMethod` + `killCount`, `killedClassType` + `killCount`, `daysAliveWithoutKill`, `timesKilledAndRespawned` — last one returns false in Phase 7).
- `_applyEvolution` stacks stat deltas, adds new ability strings, and renames the minion ("Plague Bringer (was Grumbolt the Mage-Eater)").
- `_generateName` (called on first level-up) picks `NAME_PREFIXES[random]` + a class-specific suffix derived from the most-frequent killed class — e.g. "Skarn the Knight-Slayer".
- `_checkBounty` increments `minion.bountyKillCount` and sets `hasBounty=true` at the threshold; emits `MINION_BOUNTY_POSTED`.

### MinionInspector (`src/ui/MinionInspector.js`)
- Subscribes to `MINION_CLICKED` (emitted by MinionRenderer on body-click) and re-renders on `GEAR_EQUIPPED_TO_MINION` / `MINION_LEVELED_UP` / `MINION_EVOLVED` / `MINION_NAMED`.
- Auto-closes on `NIGHT_PHASE_STARTED` / `DAY_PHASE_STARTED` (clean state per phase).
- Shows: name + bounty banner, type/level row, full stats block, evolution chain ("→ Plague Bringer (Day 5)"), equipped gear list, available loot in same room with one-click `EQUIP` buttons that call `LootSystem.equipToMinion`.

### MinionRenderer additions
- `lvLabel` (gold "L2"/"L3" badge bottom-right of body, hidden at level 1)
- `bountyMark` (gold ★ above HP bar) — only visible when `hasBounty=true`
- Diff'd via `_lastLv` / `_lastBounty` cache so we only call `setText` / `setVisible` on actual change.

### Game scene wiring
- New systems instantiated in `create()`: `lootSystem`, `evolutionSystem`. Both call `loadDefinitions()` post-construct.
- New renderers: `lootRenderer`, `minionInspector`. Both run via `update()` ticks during day AND night phase (so the player sees floor loot during build mode).
- `this._evolutionSystem` alias exposed for MinionInspector to look up XP-for-next-level.

### Balance constants added
- `MINION_XP_PER_KILL: 10`
- `MINION_XP_LEVEL_BASE: 25`, `MINION_XP_LEVEL_SCALE: 1.5` (geometric XP curve)
- `MINION_LEVEL_HP_BONUS: 5`, `MINION_LEVEL_ATTACK_BONUS: 1`, `MINION_LEVEL_DEFENSE_BONUS: 1` (defense every other level)
- `LOOT_DROP_ROLLS_PER_DEATH: 2`
- `LOOT_TIER_BY_DUNGEON_LEVEL: 3` (dungeon level 4 unlocks tier-2 loot, level 7 unlocks tier-3)
- `BOUNTY_KILL_THRESHOLD: 3`

### What's deferred to 7b
- Vendetta system (sibling adventurer hunts a specific gear instanceId)
- Mini-bosses (variant minion type guarding treasure rooms with guaranteed drops)
- SEEK_LOOT goal (treasure-hunting adventurer detours to high-tier items)
- Vulture personality loot-stealing (post-fight cleanup)
- Underdog 2× XP (needs adventurer XP/level system)
- Adventurer stat scaling with `meta.dungeonLevel`
- Scavenger / Cleaner minions (corpse handling)
- Wanted poster popup UI
- Rename-minion UI (input field flow)
- vengeful_wraith evolution (needs respawn-count tracking)
- Backstab kill method emission (combat method classifier)
- Equipped-item display by name in MinionInspector (current shows only IDs)

---

## Phase 6d Implementation Notes

### Minion faction system
- New fields on Minion entity: `faction` (`'dungeon'` default | `'adventurer'` defected), `factionExpiresOn` (day number — null = permanent), `raisedByAdvId`, `tamedByAdvId`.
- **MinionAISystem._pickTarget**: branches on faction. `dungeon` minions target adventurers (with priority overrides) plus any `'adventurer'`-faction minions. `'adventurer'`-faction minions target only `'dungeon'`-faction minions.
- **AISystem._findEngageableMinion**: skips `'adventurer'`-faction minions (they're allies now) and skips minions matching the_fan's idolized class.
- **MinionAISystem.respawnAll** now drops all `'adventurer'`-faction minions before resetting (defections don't carry over to next day). Other minions get full HP + return to home tile as before.
- **MinionRenderer**: defected minions render with a green stroke (0x33cc77) instead of class color so the player can see who's switched sides.

### Necromancer raise_corpse
- AISystem subscribes to `MINION_DIED`. Handler scans the same room for a necromancer in range (`NECROMANCER_RAISE_RANGE` = 3 tiles).
- Quota: `NECROMANCER_RAISES_PER_DAY` (2). Day-scoped via `adv._raisesUsedDay` / `adv._raisesUsedCount`.
- Mana cost: `NECROMANCER_RAISE_MANA_COST` (10).
- On raise: minion's `faction='adventurer'`, hp restored to 40% of max, `aiState='idle'`, `raisedByAdvId` recorded. Emits `MINION_RAISED` event.
- The Lich-archetype variant ("raised minions can turn on the party") is data-only for now — implementation slots in alongside the dungeon-mechanic system in Phase 9.

### Beast tamer tame
- AISystem._tickAdventurer routes through `_tryTame` before the standard attack when the adventurer has the `beast_tamer` tag.
- Cooldown: `TAME_COOLDOWN_MS` (1500ms), independent of attack cooldown.
- Mana cost: `TAME_MANA_COST` (6). Range: `TAME_RANGE_TILES` (1.5, melee).
- Success: `TAME_SUCCESS_RATE` (40%) per attempt. On success → minion defects (faction='adventurer'); emits `MINION_TAMED`. On fail → emits `TAME_FAILED`. Either way the swing uses the cooldown; standard attack happens on the next tick if the minion is still in range.

### Traumatized panic-flee
- AISystem subscribes to `ADVENTURER_DIED`. After processing, scans the dead adventurer's party. If 0 living members remain → emits `PARTY_WIPED { partyId, lastDead }`.
- If exactly 1 survivor remains and they have the `traumatized` personality → emits `PARTY_WIPED { partyId, lastSurvivor }`, sets `flags.fullKnowledgeOnFlee = true` (Phase 8 will read), and immediately calls `_setFleeGoal(survivor, 'traumatized_panic')`.

### The_fan spare_idol
- At spawn (`pickInitialGoal`), if the adventurer has the `the_fan` personality and no `flags.idolizedMinionClass` yet, picks a random minion type from `minionTypes.json` and stores its id on `flags.idolizedMinionClass`.
- AISystem._findEngageableMinion skips minions whose `definitionId` matches the idol — the_fan won't attack their favorite class.

### Mana regen via standing still
- AISystem._regenManaIfIdle (called every tick before goal logic).
- Mages only. Skipped if `aiState` is `fighting` or `fleeing`.
- Standing-still detection: same `tileX/tileY` as previous tick.
- Regen rate: `MAGE_MANA_REGEN_PER_SEC` (0.5) — caps at `resources.maxMana` (= starting mana from class def).
- Adventurer entity gained `resources.maxMana` field mirroring `resources.mana` at creation.

### Curse brand trap (`curse_brand_trap`)
- TrapSystem._fireTrap routes by `def.id`. For curse_brand_trap, calls `_applyCurseBrand` instead of dealing damage.
- Sets `adv.flags.cursedBrand = true` and `cursedBrandUntil = scene.time.now + CURSE_BRAND_DURATION_MS` (30s).
- TrapSystem.update each tick scans for expired brands and clears them, emitting `CURSE_BRAND_EXPIRED`.
- MinionAISystem priority-3 (above martyr taunt at 2): cursed adventurers pull all minion aggro until the brand expires.

### Echo mine (`echo_mine`)
- New trigger `second_footstep`. TrapSystem maintains `trap.state.stepCount` per trap.
- First step on the trap → increment stepCount, no fire (armed). Second step (any adventurer) → fire (35 explosive dmg).
- Implements the design: "Front man's fine. Second man learns a lesson."

### Updated starting unlocks (`gameState.unlocks.trapTypes`)
- Added: echo_mine, curse_brand_trap (alongside the 6 already unlocked: spike, arrow, pitfall, patience, speed, mercy).
- All ten interaction + standard traps now placeable from day 1 for testing. Phase 9's progression system will gate them by dungeon level later.

### Balance constants added
- `NECROMANCER_RAISES_PER_DAY: 2`, `NECROMANCER_RAISE_RANGE: 3`, `NECROMANCER_RAISE_MANA_COST: 10`, `NECROMANCER_RAISE_HP_FRACTION: 0.4`
- `TAME_SUCCESS_RATE: 0.40`, `TAME_MANA_COST: 6`, `TAME_RANGE_TILES: 1.5`, `TAME_COOLDOWN_MS: 1500`
- `ECHO_MINE_FOOTSTEP_THRESHOLD: 2`
- `CURSE_BRAND_DURATION_MS: 30000`

---

## Phase 6c Implementation Notes

### CombatSystem class abilities
- **Mage mana drain**: every attack from a mage costs `Balance.MAGE_SPELL_COST` (5) mana. With mana → spell-empowered (×1.1 attack). Without mana → tired-mage half-attack (×0.5). `_inferMethod` reports `'spell_arcane'` for mage hits with mana, `'melee'` without.
- **Cleric smite_undead**: when target carries `'undead'` tag, attack damage is ×1.5. Implemented via the `_isUndead` helper at the bottom of CombatSystem.js.
- **Cleric heal_ally** (`tryHeal(healer, target, opts)`): the only non-damage action — restores HP, costs `CLERIC_HEAL_MANA_COST` (4), respects the same cooldown as attacks. Emits `ALLY_HEALED { sourceId, targetId, amount, roomId }`. Mercy trap and any future heal-reactive systems subscribe.

### AISystem behavior additions
- **Coward flee-on-enemy**: `_cowardShouldFlee(adv)` checks the personality system tags for `'coward'`. If any minion is alive in the same room, sets `goal = { type: 'FLEE', reason: 'coward_panic' }` immediately — even at full HP. Visible in graveyard / events as a separate flee reason.
- **HEAL goal (potion sip)**: `_shouldDrinkPotion(adv)` triggers when HP fraction ≤ `POTION_HEAL_THRESHOLD` (0.4) and adventurer has `resources.potions > 0`. Drinking is instant — decrements potion count, restores `POTION_HEAL_AMOUNT` (15) HP, sets `aiState = 'healing'`, emits `ALLY_HEALED` (self-target — counts toward mercy trap). Runs **before** the standard flee check so adventurers prefer recovery over retreat.
- **Cleric heal target picking**: when adventurer is class `cleric`, scans party-mates within `HEAL_RANGE_TILES` (2). If any is below `CLERIC_HEAL_TARGET_THRESHOLD` (0.7) HP fraction, calls `combatSystem.tryHeal` instead of attacking an enemy. Prioritises the most-wounded ally.
- **Paranoid speed multiplier**: `_paranoidSpeedMultiplier(adv)` returns `PARANOID_SPEED_MULTIPLIER` (0.55) when the personality has tag `'paranoid'` AND the adventurer is in a non-`starter_*` room. Phase 8 will replace this proxy with a real "knowledge of room" check.

### MinionAISystem martyr taunt
- New `_adventurerPriority(adv)` helper. Martyrs at HP fraction ≤ `MARTYR_TAUNT_HP_FRACTION` (0.3) report priority 2; everyone else 0. `_pickTarget` now selects the highest-priority adventurer first, breaking ties by distance — so a tauntable martyr in the room pulls every minion to them.

### Mercy trap (TrapSystem)
- TrapSystem subscribes to `ALLY_HEALED` in its constructor and resolves matching `mercy_trap` instances in the same room, firing one per heal event. Damage routes through the same `_fireTrap` path so combat-log + flee-trigger plumbing reuses unchanged.
- `mercy_trap` added to default starting unlocks (`gameState.unlocks.trapTypes`) so it's selectable in the NightPhase TRAPS palette without needing dungeon-level unlocks for testing.

### Balance constants added (Phase 6c)
- `MAGE_SPELL_COST: 5`, `MAGE_MANA_REGEN_PER_SEC: 0.5` (regen wires in 6d)
- `CLERIC_HEAL_MANA_COST: 4`, `CLERIC_HEAL_AMOUNT: 12`, `CLERIC_HEAL_TARGET_THRESHOLD: 0.7`
- `HEAL_RANGE_TILES: 2`
- `POTION_HEAL_AMOUNT: 15`, `POTION_HEAL_THRESHOLD: 0.4`
- `MARTYR_TAUNT_HP_FRACTION: 0.3`
- `PARANOID_SPEED_MULTIPLIER: 0.55`

### What's deferred to 6d
- Necromancer raise_corpse, beast_tamer tame — both need a faction system (`controlledBy` / faction field on minion) to flip a defending minion to fight on the adventurer side.
- Curse brand trap (aggro redirect) and echo mine (leader-vs-follower tracking) — both need new state plumbing.
- SLEEP and FOLLOW_PARTY goals — meaningful only after faction defection introduces "safe room" state.
- Traumatized panic-flee on PARTY_WIPED — the event isn't emitted yet; needs party-wipe detection.
- Mana regen via standing still — small, slots in alongside the SLEEP goal.
- the_fan spare-idol behaviour — needs minion class tagging the fan can recognise.

---

## Phase 6b Implementation Notes

### TrapSystem (`src/systems/TrapSystem.js`)
- Per-tick during day phase. Iterates active adventurers; updates per-adventurer "still time" counter; then evaluates each non-triggered trap against the matching adventurers.
- Trigger conditions wired in 6b:
  - `stepped_on` → fires when adventurer's tile == trap's tile
  - `line_of_sight_broken` → 6b proxy: same as `stepped_on`. Real LOS handling lands when arrow_trap gets a wall-edge orientation field.
  - `stood_still_3_seconds` → uses `adv._stillTimeMs` accumulator; fires at >= 3000ms on the trap tile.
  - `moved_too_fast` → fires when `adv.stats.speed >= 2.0` AND state is 'walking' AND on the trap tile.
- Other triggers (loot_picked_up, ally_healed_nearby, second_footstep, adventurer_was_here_before) deferred to 6c+ when their host systems exist.
- Damage routes through `EventBus.emit('COMBAT_HIT')` with the trap's instanceId as `sourceId`, so all the existing combat plumbing (flee check, lastHitBy attribution, kill recording) reuses unchanged.
- `resetAll()` is called by Game.js on `NIGHT_PHASE_STARTED` — clears `isTriggered` and `state` so traps re-arm overnight (Bloodbound mechanic in Phase 9 will optionally disable this).

### Trap entity (`src/entities/Trap.js`)
- Plain JS factory. `gameState.dungeon.traps[]` array. Triggered traps stay in the array with `isTriggered: true` for the rest of the day.
- `state: {}` is reserved for trap-type-specific scratch data (per-adventurer dwell counters, etc.). Phase 6c+ will use it.

### TrapRenderer (`src/ui/TrapRenderer.js`)
- One container per trap at depth 4 (below minions/adventurers). Small dark square + colored stroke + glyph.
- Triggered traps render at alpha 0.35 with a diagonal "spent" slash mark. Restored to full visibility on `NIGHT_PHASE_STARTED`.
- Phase 8 will add visibility differentiation for `isKnownToAdventurers` (different icon when adventurers know about it).

### NightPhase third tab (TRAPS)
- Three-tab palette now: ROOMS / MINIONS / TRAPS. Each tab counter shows in the header.
- `_validateTrapPlacement`: tile must be FLOOR or CORRIDOR, no overlap with another trap, no minion on tile, gold sufficient.
- Removal is **sell-button-only** (action-bar SELL tool → click a room, refunds 50% room cost + 50% per minion inside). Right-click does NOT remove anything any more — it only cancels armed tools / placement candidates. Ctrl+Z still undoes the most recent placement (full refund).

### CombatLog overlay (`src/ui/CombatLog.js`)
- Owned by DayPhase. Subscribes to: `ADVENTURER_ENTERED_DUNGEON`, `TRAP_TRIGGERED`, `COMBAT_HIT` (adventurer→minion only — minion→adventurer is conveyed by trap/kill/flee), `ADVENTURER_DIED`, `ADVENTURER_FLED`, `MINION_DIED`.
- Stack of up to 7 lines bottom-left, each fades after 7s, color-coded (cyan = info, yellow = trap, red = death, green = flee).
- Cleaned up on `DAY_PHASE_ENDED`.

### Last words (`src/data/lastWords.json` + DayPhase)
- Lookup is `byClassAndKiller[classId][killerKey]` with cascade fallback `byClassAndKiller[default][default]`.
- `killerKey` resolution: 'boss' → 'boss', trap instanceId → trap.definitionId (e.g. 'spike_trap'), minion instanceId → 'minion', else 'default'.
- Floats above the dying adventurer's last position; fades in over 220ms, holds 2.5s, fades out.
- Class+killer combinations cover the 6 character classes. Easy to extend with more lines without code changes.

### ChatBubbles (`src/ui/ChatBubbles.js`)
- Owned by Game scene; ticks during day phase only when adventurer is `aiState='walking'`.
- Per-adventurer next-chat timestamp randomly scheduled 7–15s out. One bubble at a time per adventurer, lives 2.2s.
- Line picker: 60% personality bias if any personality assigned (pulls from `byPersonality[id]`), else class lines (`byClass[classId]`).
- Lines added in `src/data/chatLines.json` — 5–6 lines per class, 3–4 lines per personality.

### AdventurerRenderer thought-bubble state expansion
- `_updateBubbleState(s, adv)` now runs every frame. Glyph + color switch by aiState/goal:
  - `fighting` → '*' red
  - `fleeing` or goal=FLEE → '!' yellow
  - goal=EXPLORE_ROOM → '?' green (searching)
  - default → primary personality icon + color (existing behaviour)
- Cached previous glyph/color on the sprite to avoid redundant `setText` / `setFillStyle` calls.

### EssenceSystem update
- `calculateDailyUpkeep` now sums **room + alive minion + (all trap)** upkeep. Triggered traps still draw upkeep (the upkeep funds the overnight re-arm).

---

## Phase 6 Kernel Implementation Notes

### CombatSystem (`src/systems/CombatSystem.js`)
- `tryAttack(attacker, target, opts)` is the only public API. Returns `{hit, damage, killed, damageType, method}` or `null` if on cooldown / out of range.
- Cooldown: `Balance.ATTACK_INTERVAL_MS / max(0.5, attacker.stats.speed)` — fast attackers fire more often.
- Damage formula: `max(1, attack - defense) * (1 ± 0.15 variance)`, with 10% crit chance for ×1.5 damage.
- Emits `COMBAT_HIT` always, `COMBAT_KILL` when target HP drops to 0. The kill event carries `damageType` and `method` for the Phase 7 EvolutionSystem.
- Populates `attacker.killHistory[]` on kill — feeds evolution checks later.
- **Death cleanup is the AI system's responsibility.** CombatSystem only mutates HP and emits.

### Minion entity (`src/entities/Minion.js`)
- Plain JS factory, identical pattern to Adventurer entity (serializable).
- Lives in `gameState.minions[]`. Dead minions stay in the array with `aiState='dead'`, hp=0, until `MinionAISystem.respawnAll()` revives them at NIGHT_PHASE_STARTED.
- `homeTileX/Y` is captured at placement — minions return there when no enemy is in range.
- `attackRange` is read from `baseStats.attackRange` (default 1 = melee) — archers can shoot from 4 tiles away.

### MinionAISystem (`src/systems/MinionAISystem.js`)
- Per-tick state machine: idle (at home) → engaging (chase + attack target) → returning (no target, walk home).
- Targeting: Phase 6 kernel only engages adventurers **inside the home room** (Balance.ENGAGE_REQUIRES_SAME_ROOM). Hunt-across-rooms behavior moved to Phase 6b.
- `aggro` range = 5 tiles within home room. Chase movement uses straight-line lerp; A* pathfinding for chase added in 6b.
- Utility minions (`behaviorType: 'utility'` like Sapper/Herald) skip combat — their roles bind in 6b.
- `respawnAll()` is called by Game.js on NIGHT_PHASE_STARTED — restores hp, returns to home, clears state.

### AISystem combat additions
- New constructor param: `combatSystem`. AISystem subscribes to `COMBAT_HIT` to track `_lastHitBy`/`_lastHitType` per adventurer (for kill attribution + flee triggering).
- Per-tick: before moving, scans for engageable minions in melee range and calls `combatSystem.tryAttack`. Sets `aiState='fighting'` while engaged.
- After every incoming hit, runs `_checkFleeTrigger`: if `hp/maxHp <= personalityWeights.fleeThreshold + FLEE_BUFFER`, switches to `goal: { type: 'FLEE' }`.
- New goal `FLEE`: targets `adv.spawnTileX/Y` (set at spawn time). On `_onGoalReached`, emits `ADVENTURER_FLED` with reason `'low_hp_retreat'`.
- `_kill` now reads `_lastHitBy` for proper attribution; minion that landed the killing blow shows up correctly in graveyard entries and the ADVENTURER_DIED event.
- `_lookupKillerName` resolves a minion ID to "Skeleton Warrior" / etc. via cached minion type names.

### MinionRenderer (`src/ui/MinionRenderer.js`)
- Container per minion at depth 7 (below adventurers at 8). Body = small dark rect with stroke in minion's color.
- HP bar floats above body. Dead minions render at alpha 0 — re-appear on respawn since the same sprite container is reused.
- Click → `MINION_CLICKED` event for future inspector binding.

### (Removed 2026-05-02) EssenceSystem upkeep extension
- The upkeep system was deleted along with `EssenceSystem.js`. No daily drain of any kind exists in the game now.

### NightPhase palette refactor
- Palette panel gained **tabs**: ROOMS / MINIONS, click to switch. Active tab highlighted with accent border.
- All cards for the active tab tracked in `_paletteObjects` and torn down on tab switch (no leaks).
- New unified `_selectItem(def, kind)` replaces `_selectRoom`. `_selectedKind` ('room'|'minion') drives preview shape (single-tile for minions, room rect for rooms) and which validator runs.
- Minion placement validation: tile must be FLOOR/BOSS_FLOOR, must be inside a room, that room must have a barracks within `Balance.MINION_BARRACKS_DISTANCE` (default 3) — except when placing IN a barracks-tagged room.
- Removal goes through the SELL tool, not right-click. Ctrl+Z still undoes the most recent placement (full refund).

### DungeonGrid additions
- `hasBarracksWithinDistance(roomId, maxDist)` — BFS on room adjacency graph; treats `starter_barracks` and `crypt` as barracks-tagged.

### Balance constants added
- `ATTACK_INTERVAL_MS: 900` (base attack cooldown)
- `MELEE_RANGE_TILES: 1.5` / `AGGRO_RANGE_TILES: 5`
- `ENGAGE_REQUIRES_SAME_ROOM: true` (kernel scope; 6b will add cross-room hunt)
- `MINION_BARRACKS_DISTANCE: 3`
- `FLEE_BUFFER: 0.05` (hysteresis on flee threshold)

### Game.js wiring
- `combatSystem`, `minionAiSystem`, `minionRenderer` instantiated alongside existing systems.
- `update()` now ticks `minionAiSystem.update(scaled)` and `minionRenderer.update()` during day phase. Minion renderer also runs during night so placed minions are visible while building.
- `NIGHT_PHASE_STARTED` listener calls `minionAiSystem.respawnAll()` to revive dead minions.

---

## Phase 5 Implementation Notes

### PersonalitySystem (`src/systems/PersonalitySystem.js`)
- Owned by Game scene (`game.personalitySystem`); calls `loadDefinitions()` once on Game.create
- 8 personalities ship in `src/data/personalities.json`: greedy, paranoid, speed_runner, completionist, martyr, coward, overconfident, cartographer
- 6 combos in `src/data/personalityCombos.json` — all use **tag groups**, not personality IDs (so new personalities sharing tags activate combos automatically)
- **Weight blending**: `getWeights(adv)` averages most weights across personalities, but uses MAX-blend for `fleeThreshold`, `trapCaution`, `lootPriority`, `explorationDrive` (any single personality pushing those high should dominate the disposition)
- **Combo detection**: `checkCombos(party)` requires distinct party members for each tag group via a small bipartite-matching helper (`_hasDistinctAssignment`); returns combos that activate
- `rollPersonalities(count, dungeonLevel)` weights by rarity: common=4×, uncommon=2×, rare=1×
- `evaluateGoal(adv, situation)` — uses `explorationDrive` to decide whether to pick a side room or push to boss
- `emitCombosForParty()` runs combo detection + emits `PERSONALITY_COMBO_ACTIVATED` per combo

### AISystem updates
- New constructor param: `personalitySystem` (optional — falls back to plain SEEK_BOSS when null)
- New goal type: `EXPLORE_ROOM` with `roomId`. `_goalToTile` resolves to room centre.
- `_onGoalReached` for EXPLORE_ROOM: marks room visited (`adv.visitedRooms.push`), emits `ADVENTURER_ROOM_CHANGED`, picks next goal via personality
- `pickInitialGoal(adv)` — DayPhase calls this AFTER personality assignment so a cartographer's first move is to a side room, not the boss
- Spawn-room is auto-marked visited so adventurers don't re-explore it

### DayPhase updates
- **Party formation**: all adventurers spawned on the same day share `partyId` (only when count >= 2; soloists stay null)
- **Personality assignment**: `1 + floor((dungeonLv-1)/5)` personalities per adventurer, rolled by rarity
- **Combo activation**: after spawn loop, `personalitySystem.emitCombosForParty(spawned, partyId)` fires events; adventurers tagged with `activeCombos` array (effects wire in Phase 6+)
- **Inspector**: shows personality names, goal type (with EXPLORE_ROOM target), party id, visited room count, active combos
- **Combo banner**: subscribes to `PERSONALITY_COMBO_ACTIVATED`; shows a purple-glow banner under the top bar with name + description; auto-dismisses after 4.5s; banners stack vertically when multiple combos fire

### AdventurerRenderer thought bubbles
- Per-adventurer: small coloured circle above the HP bar showing the **primary personality's** icon glyph (defined in `personalities.json` as `icon` + `iconColor`)
- Reads from `scene.personalitySystem` to look up the definition; gracefully renders nothing if no personality assigned
- Only the first personality is shown for now; multi-personality bubble cycling is a future polish item

### Adventurer entity additions
- `visitedRooms: []` — drives EXPLORE_ROOM picking
- `activeCombos: []` — combo IDs currently affecting this adventurer (Phase 6+ effects read this)

### Combo effects status
- Combos currently DETECT and DISPLAY — the `effect` field is data-only.
- Behaviour wires in later phases when the necessary systems exist:
  - `constant_detour` → AISystem (already partly works via raised explorationDrive)
  - `party_split` → Phase 8 knowledge / pathfinding split
  - `coward_escapes_during_taunt` → Phase 6 combat
  - `party_argument_loop` → AISystem oscillation
  - `both_race_to_loot` → Phase 7 loot priority
  - `cartographer_shareFullMap` (reaction) → Phase 8 knowledge sharing on flee

### Design coverage (post-Phase-5 expansion)

The personality + class roster now matches the 23 entries in the original game design sheet.

**Personalities (18 total) — all data complete, deep effects layer in noted phases**:
- Phase 5 active: greedy, paranoid, speed_runner, completionist, martyr, coward, overconfident, cartographer, party_loyal, solo, raid_leader, vandal, the_fan, beast_tamer (data + AI-goal effects)
- Phase 6 (combat) wires: traumatized (panic-flee on PARTY_WIPED), raid_leader (cascade), martyr (taunt), the_fan (spare idol), beast_tamer (tame attempt)
- Phase 7 (XP/loot) wires: underdog (double-XP reaction), vulture (loot-stealing decisionOverride)
- Phase 8 (knowledge) wires: vandal (disarm), traumatized (full-knowledge spread on flee), coward (full-knowledge on flee — already declared in cartographer reaction)
- Phase 9 (mechanics) wires: inquisitor (mechanic disable on focal point)

**Classes (6 total)**: knight, mage, rogue (bonus add — not in original design but kept), cleric, necromancer, twitch_streamer
- Class tags (e.g. `healer`, `minion_raiser`, `chat_driven`) participate in combo detection — `getTags()` folds them in alongside personality tags
- twitch_streamer has `unlockLevel: 6` and `rarity: rare` — DayPhase filters classes by `unlockLevel <= dungeonLevel` so it only appears late game
- Class abilities (`heal_ally`, `raise_corpse`, `chat_poll`) wire into combat / minion / UI systems in later phases

**Combos (14 total)** — added in Phase 5 expansion:
- Match design list: greedy_cartographer, paranoid_speedrunner, martyr_vulture, raidleader_traumatized
- Added leveraging new tags: solo_coward (Scout And Run), vandal_speedrunner (Demolition Dash), underdog_fan (Believer's Boost), loyal_traumatized (Survivor's Burden), beasttamer_necromancer (Defection Plague — class+personality cross combo)
- Carried over from initial drop: overconfident_paranoid, greedy_overconfident, completionist_speedrunner, martyr_coward (now redundant with martyr_vulture but kept for variety)

---

## Phase 4 Implementation Notes

### Adventurer entity (`src/entities/Adventurer.js`)
- Plain JS object factory (no class) so adventurers serialize cleanly via SaveSystem
- Lives in `gameState.adventurers.active` while in dungeon, moves to `graveyard` on death
- Random fantasy first/surname generator inline (replace with utils/NameGenerator.js in Phase 9 when newspaper ships)
- Tracks both tile (logical) and world (smooth render) coordinates — AISystem updates worldX/worldY each tick

### PathfinderSystem (`src/systems/PathfinderSystem.js`)
- Standard A* with Manhattan heuristic, uniform tile costs (Phase 8 adds knowledge weights)
- Walkable tile set: FLOOR, CORRIDOR, BOSS_FLOOR, DOOR
- Uses Set-based open list with linear-scan lowest-fScore (fast enough for 30×30 grid)
- `findPath(start, end, dungeonGrid)` returns array of waypoints (excludes start, includes end), or `null` if no path

### AISystem (`src/systems/AISystem.js`)
- Owned by Game scene (`game.aiSystem`); ticks from Game.update() when `phase === 'day'`
- `update(delta)` is called with timeScale-adjusted delta — DayPhase pause/2x/4x feeds in here
- Per-adventurer state machine: walking → reaches boss → instant kill (Phase 6/10 will replace with combat)
- `pickSpawnTile()` finds the deepest-from-boss room with a valid path to the boss; returns null if dungeon has no entrance reachable to boss
- On death: emits `ADVENTURER_DIED`, awards `SOUL_ESSENCE_PER_KILL` ~~+ `DARK_POWER_PER_KILL`~~ (Dark Power retired 2026-05-05), moves entity to graveyard

### AdventurerRenderer (`src/ui/AdventurerRenderer.js`)
- Owned by Game scene; renders one Container per active adventurer (depth 8, above corridors and rooms)
- Visual: outer glow ring + body circle (stroked in class colour) + sigil letter + HP bar
- Reads adv.worldX/worldY each frame — smooth interpolation comes from AISystem updating those values
- Click handler emits `ADVENTURER_CLICKED` for the inspector to consume
- Auto-cleans on `ADVENTURER_DIED` / `ADVENTURER_FLED` / `NIGHT_PHASE_STARTED`

### DayPhase (`src/scenes/DayPhase.js`)
- `_spawnDailyAdventurers()` runs at scene create; count = `ADVENTURERS_PER_DAY_BASE + floor((day-1) / 2)`
- Random class per adventurer (knight / rogue / mage); spawn tile from `aiSystem.pickSpawnTile()`
- If no spawn tile available, status text reads "No path into your dungeon" and player can end day manually
- Click-to-inspect: subscribes to `ADVENTURER_CLICKED`, shows right-side panel with stats + goal + position; refreshes when state changes; auto-closes when subject dies
- Auto-end-day: 1.5s after the last adventurer leaves the active list

### Game scene updates
- `update(time, delta)` now drives AISystem and AdventurerRenderer — only when phase is 'day' and DayPhase is active
- Time scale read from DayPhase scene via `_getDayTimeScale()`; pause (0) skips the AI update entirely
- DungeonGrid gained `getTiles()` and `getGridSize()` accessors for PathfinderSystem

### Adventurer classes (`src/data/adventurerClasses.json`)
- knight (50 HP, slow, armoured), rogue (30 HP, fast, fragile), mage (25 HP, glass cannon)
- Class colour string (e.g. `"0xaaccdd"`) parsed into int by createAdventurer
- Phase 5 adds personality blends layered on top of class

### Balance additions
- `ADVENTURERS_PER_DAY_BASE: 1` — scales up over days
- `ADVENTURER_BASE_TILES_PER_SEC: 1.5` — multiplied by class.speed when needed (currently class.speed is used directly)

---

## Phase 3 Implementation Notes

### Economy (gold; upkeep removed)
- Single currency: `gameState.player.gold`. Constants: `STARTING_GOLD`, `GOLD_PER_KILL`, `DEV_INFINITE_GOLD`, `MINION_RESPAWN_COST_GOLD`.
- Daily upkeep was removed in the 2026-05-02 cleanup. Rooms / minions / traps cost gold to **place** but no longer drain anything per day; the only gold sinks are placements + Mimic Vault chest theft. `EssenceSystem.js` and `upkeepCost` JSON fields are gone.
- Sell rules (all paths refund **50%** of the entity's `goldCost`):
  - **SELL tool** (action bar): click a room → refunds 50% of the room cost + 50% per minion inside, removes them all in one stroke.
  - **Ctrl+Z**: undoes the most recent placement at full refund (single-level).

### DayPhase (`src/scenes/DayPhase.js`)
- Overlay scene (Game scene stays running); launched by NightPhase._beginDay() via `this.scene.start('DayPhase', { gameState })`
- Top bar: day number + gold accent (visually distinct from NightPhase purple)
- Bottom bar: time controls (⏸ / 1× / 2× / 4×) using `this.time.timeScale`; End Day button
- End Day: increments `dayNumber`, sets `phase = 'night'`, saves, starts NightPhase
- Placeholder text removed in Phase 4 when adventurers are added

### NightPhase updates
- **Removal**: SELL tool only — click a room to refund 50% room cost + 50% per minion inside; right-click cancels armed tool / selection but does NOT remove placed content.
- **Undo**: Ctrl+Z undoes the last placement (full refund); single-level only.
- **Begin Day** calls `this.scene.start('DayPhase', ...)`.
- (2026-05-02) Upkeep enforcement and the per-card "/day" cost row were deleted along with `EssenceSystem.js`. The Stats panel no longer shows an "Upkeep/day" line.

### Room definitions added (rooms.json)
- `entry_hall` — starter, 10×6, 4 connections, free — crossroads entrance room
- `crypt` — combat, 6×8, upkeep 4, place 15 — undead spawn room
- `armory` — utility, 6×6, upkeep 6, place 18 — adjacent minion attack buff
- `prison_block` — combat, 10×6, upkeep 5, place 20 — capture mechanic (future)
- `serpent_pit` — trap, 8×8, upkeep 10, place 30 — poison damage per tick

### Starting unlocks (GameState.js)
All 4 starter rooms + crypt, trap_room, healing_fountain, armory, prison_block, serpent_pit unlocked from day 1. Higher-tier rooms unlock via dungeon level-ups (Phase 7+).

---

## Phase 2 Implementation Notes

### TILE constants (`src/systems/DungeonGrid.js`)
```js
TILE = { VOID:0, FLOOR:1, WALL:2, CORRIDOR:3, CORRIDOR_WALL:4,
         BOSS_FLOOR:5, BOSS_WALL:6, DOOR:7 }
```

### Tileset texture
Generated programmatically at Game.create() time using Phaser Graphics + `generateTexture('dungeon-tiles')`. 8 tiles × 32px wide. Replace with real sprite sheet later by swapping the texture key — no other code changes needed.

### DungeonGrid (`src/systems/DungeonGrid.js`)
- Instantiated by Game.js as `this.dungeonGrid = new DungeonGrid(this.gameState.dungeon)`
- Mutates `gameState.dungeon.tiles` directly (plain 2D array)
- After every `placeRoom()` / `removeRoom()`, emits `ROOM_PLACED` / `ROOM_REMOVED` — Game.js listens and rebuilds the Phaser tilemap layer
- Corridor routing: **exit-first L-shape** — steps one tile out of each room wall perpendicular to the door direction before making the L-turn. Prevents corridors from sliding along the exterior wall face.
- NightPhase accesses DungeonGrid via `this.scene.get('Game').dungeonGrid` for validation reads and placement writes

### MiniMap (`src/ui/MiniMap.js`)
- Lives on **HudScene** (a dedicated parallel scene) so it's immune to the world camera's zoom/scroll
- HudScene is launched by Game.create() with `{ gameScene, gameState }` and stopped on Game shutdown
- Dungeon image: a Graphics object redrawn on `ROOM_PLACED` / `ROOM_REMOVED` / `GRID_EXPANDED` (tiles are stamped with `fillRect(mx + tx*tw, my + ty*th, ...)`)
- Viewport indicator: a Rectangle whose size + position track the world camera's `cam.worldView` rect each frame; the indicator is masked to the minimap rect so it can be cursor-centered without bleeding outside the UI
- Click anywhere on the map → `cam.centerOn()`; hold and drag → continuous pan with the cursor at the center of the indicator
- Toggle button (top-right of the map): hides/shows the map contents while staying visible itself
- Lifted `BOTTOM_UI_CLEARANCE` (72 px) above the bottom edge to avoid overlapping NightPhase/DayPhase's bottom HUD strip

### NightPhase (`src/scenes/NightPhase.js`)
- Overlay scene launched by Game.js via `this.scene.launch('NightPhase', { gameState })`
- Left panel (220px): title, stats (day/essence/power/rooms), room palette cards, Begin Day button
- Palette shows unlocked rooms where `!placementRules.fixed`
- Placement preview: Graphics overlay drawn in screen space using camera scroll/zoom transform
- Validation: red tint = invalid, green tint = valid; runs on every pointer move while room selected
- R or Escape cancels selection; left-click confirms

---

## Design Constraints (do not violate without asking)

- All game content (rooms, personalities, mechanics, minions, traps, archetypes) is defined in JSON under `src/data/`. No hardcoded if/else chains for game content.
- Personality combos are tag-based, never name-to-name pairs.
- Kill events always carry `damageType` and `method` — EvolutionSystem depends on this.
- Every piece of GameState must be JSON-serializable. No circular references, no class instances in GameState (plain objects only — instances are reconstructed on load).
- Starter rooms have `upkeepCost: 0`. All tunable numbers live in `src/config/balance.js`.
- Phaser scenes never call each other directly — they communicate only via EventBus.
- portal.js is never modified.

---

## Open Questions / Future Decisions

- Audio/music plan
- Sprite art style (pixel art dimensions, palette)
- Multiplayer (currently solo; jam template includes P2P via Trystero — decision deferred)

## Locked Decisions (post-design-doc)

- **Boss room position:** Centered on the grid. Player builds outward in all directions.
- **Leaderboard backend:** Supabase (free tier, hosted Postgres + REST API, browser-callable). Player needs to create account at supabase.com and provide project URL + anon key. Wired in during Phase 10. Table schema: `id`, `player_name`, `dungeon_level`, `days_survived`, `adventurers_killed`, `boss_archetype`, `run_id`, `created_at`.

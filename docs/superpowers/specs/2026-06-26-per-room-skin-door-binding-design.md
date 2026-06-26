# Per-room-skin door binding — design

**Date:** 2026-06-26
**Status:** Approved (design), pending implementation plan
**Area:** Room Editor + dungeon rendering (room/door skins)

## Problem

A room can declare a **pool** of room skins (`backgroundImagePool`). At
placement, one skin is rolled and baked onto the instance as
`room.backgroundImage` (persisted, stable for that room's life). Today a
room's door skins are fixed regardless of which pool skin rolled — so an
Entry Hall with three different room-skin variants always shows the same
door art.

**Goal:** Let the Room Editor bind a specific door skin to a specific
room skin in a room's pool, so when that skin rolls, its paired door
shows. Covers **both** the external entrance door and interior connecting
doors. Per closed/open/locked state, like the rest of the door system.

**Out of scope (deferred):** the boss chamber's per-boss skin pools
(`backgroundImagePoolByBoss`/`backgroundImageByBoss`). Boss-chamber rolled
skins are cached in `backgroundImageByBoss`, not `backgroundImage`, so
per-skin door binding there is a separate, more complex follow-up. Boss
chamber keeps its existing per-boss door logic.

## How skins/doors work today (context)

- **Room skin pool → instance:** `DungeonGrid.placeRoom()`
  (`src/systems/DungeonGrid.js:270`) rolls one entry of
  `definition.backgroundImagePool` and bakes it onto the instance as
  `room.backgroundImage`. Single-skin rooms just carry
  `definition.backgroundImage`.
- **Door skin resolution:** `DungeonRenderer._roomOwnDoorSkinId(room,
  state, cp)` (`src/ui/DungeonRenderer.js:719`) resolves a door's skin id
  per connection-point + state, precedence:
  `entrance set → per-boss → connecting → (global default added by
  _doorSkinKeyFor)`. `_cpIsEntrance(cp)` = `cp.external || cp.style ===
  'entrance'`.
- **Door fields on the room instance/def:** `doorSkin[state]`
  (connecting), `doorSkinEntrance[state]` (entrance),
  `doorSkinByBoss[boss][state]` (boss chamber). The renderer reads these
  off the **instance**, so they are copied def→instance at placement and
  re-applied on def-save.
- **Door size** lives ON the door skin in the manifest
  (`ThemeManager.doorSkinSize(id)`); `_doorSkinSizeTiles` resolves the
  skin id via `_roomOwnDoorSkinId`, so size follows whatever skin id wins.
- **Editor door tools** already have a "target" axis (default vs each
  boss), an entrance/connecting role toggle, and a closed/open/locked
  state control; the Apply flow writes the picked door skin to the right
  field (`RoomTileEditor._setDoorSkinId`).

## Design (chosen: Approach A — per-skin overrides on the room def)

Mirror the existing `doorSkinByBoss` pattern, but key by **room-skin id**
instead of boss id. Surface it in the editor as a new "target" in the
existing door-assignment flow.

### 1. Data model

Two new optional, sparse fields on the room def (and live instance),
keyed by room-skin id (the same ids that appear in `backgroundImagePool`):

```jsonc
"doorSkinBySkin":         { "<roomSkinId>": { "closed": "<doorSkinId>", "open": "...", "locked": "..." } },
"doorSkinEntranceBySkin": { "<roomSkinId>": { "closed": "...", "open": "...", "locked": "..." } }
```

- `doorSkinBySkin` → connecting-door overrides per rolled room skin.
- `doorSkinEntranceBySkin` → entrance-door overrides per rolled room skin.
- No size field — size lives on the door skin in the manifest and is
  resolved from the winning skin id automatically.

### 2. Render resolution (the only behavior change)

`DungeonRenderer._roomOwnDoorSkinId(room, state, cp)`: read the instance's
rolled skin (`room.backgroundImage`) and check the per-skin maps **first**
(most specific), then fall through to today's chain. New precedence:

- **entrance cp:** `doorSkinEntranceBySkin[skin][state]` →
  `doorSkinEntrance[state]` → `doorSkinBySkin[skin][state]` →
  `doorSkinByBoss[boss][state]` → `doorSkin[state]` → (global default via
  `_doorSkinKeyFor`)
- **connecting cp:** `doorSkinBySkin[skin][state]` →
  `doorSkinByBoss[boss][state]` → `doorSkin[state]` → (global default)

`_doorSkinKeyFor` and `_doorSkinSizeTiles` both delegate to
`_roomOwnDoorSkinId`, so the door **texture and size** follow the per-skin
override with no further render edits. If `room.backgroundImage` has no
entry in the maps, behavior is byte-for-byte today's (zero regression).

### 3. Editor UI

In the Doors tab / Door-skins modal, add a **"Room skin"** target selector:
`[ All skins ▾ | <skin 1> | <skin 2> | … ]`, populated from the active
room's `backgroundImagePool`. Shown only when the pool has ≥2 skins.

- "All skins" (default) → Apply writes the existing `doorSkin` /
  `doorSkinEntrance` fields (unchanged behavior).
- A specific skin selected → Apply writes `doorSkinBySkin[skin]` /
  `doorSkinEntranceBySkin[skin]` (entrance vs connecting per the existing
  role toggle, state per the existing state control).
- The door-skin preview swaps its room-background thumbnail to the
  selected skin's art, so the pairing is shown as it will render.
- The "currently applied" highlight in the modal respects the selected
  room-skin target.

This adds exactly one new control (the target dropdown). Everything else
reuses the existing entrance/connecting + state + Apply flow.

### 4. Plumbing (persist + apply live, mirroring `doorSkinByBoss`)

- **`DungeonGrid.placeRoom`** — copy `doorSkinBySkin` /
  `doorSkinEntranceBySkin` def→instance (alongside the existing
  `doorSkinByBoss` copy).
- **Editor def-reapply** (`Game._refreshRoomFromDef` / `reapplyRoomDef`,
  wherever `doorSkin*` is copied onto live instances) — copy the two new
  fields so edits apply without re-placement.
- **`RoomTileEditor._save()`** — serialize + prune the two new fields into
  `rooms.json`; drop empty maps.
- **Editor undo snapshot** — capture the two new fields.
- **`lint-content`** — validate the new door-skin refs resolve (a typo'd
  door-skin id is caught at commit time, like other skin refs).

### 5. Edge cases

- Rolled skin absent from the maps → falls back to today's chain (no
  regression for existing rooms / single-skin rooms).
- On save, prune per-skin entries whose skin id is no longer in the
  room's pool (keep data clean).
- An instance that rolled skin X keeps X in `room.backgroundImage` even if
  the def's pool later changes; resolution stays correct (uses X's entry
  if present, else falls back).

## Touchpoint summary

| File | Change |
|---|---|
| `src/ui/DungeonRenderer.js` | `_roomOwnDoorSkinId` — per-skin lookup first |
| `src/systems/DungeonGrid.js` | `placeRoom` — copy new fields def→instance |
| `src/scenes/Game.js` | def-reapply — copy new fields onto live instances |
| `src/scenes/RoomTileEditor.js` | new target state + methods; `_setDoorSkinId` branch; `_save()` serialize/prune; undo capture; preview thumb |
| `src/hud/RoomEditorOverlay.js` | "Room skin" target dropdown in the Doors UI |
| `tools/lint-content.mjs` | validate `doorSkinBySkin`/`doorSkinEntranceBySkin` refs |

## Verification

- Renderer-level: for an Entry Hall instance, set distinct door skins for
  two pool skins; confirm `_roomOwnDoorSkinId` / `_doorSkinRect` return the
  paired door skin per the instance's `room.backgroundImage`, and the
  fallback path is unchanged when no per-skin entry exists.
- `npm test` (lint-content gate green, incl. the new ref validation).
- In-Electron eyeball: place multiple Entry Halls so different pool skins
  roll, confirm each shows its paired door.

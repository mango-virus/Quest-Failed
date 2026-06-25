# Room Connections — 1-tile-gap model (LOCKED 2026-06-24)

Canonical spec for changing room-to-room connections from **wall-to-wall** to a
**one-tile-gap connector**. Build from THIS doc + the acceptance checklist, not
from memory. Supersedes the touching-doorway behaviour described in `DESIGN.md`
"Core concept" (deviation noted there).

> ## ⚠ REVISION 2026-06-25 — connectors are now VISIBLE dug passages (not black walk-unders)
> The original render (Step 3 below) made the gap connector a **near-black tile
> drawn ABOVE entities** so travellers walked *under* it and it blended into the
> flat void — i.e. invisible. The user reversed this: the gaps now read as the
> **solid bedrock the dungeon is carved into**, and connectors as **visible dug
> tunnels** characters walk *along*. So as of this revision:
> - **Void = textured bedrock**, not flat black. `_drawBedrockTexture` stamps subtle
>   cold mottle/fleck/crack onto the `_gVoidOcc` void layer (depth 12, masked to
>   void); `_drawCarveHalo` (cool 1-tile rim, `BEDROCK_HALO`) softens the room→void
>   cut. Both moved onto `_gVoidOcc` so they show above the occluder.
> - **Connector = visible dug passage, drawn ABOVE entity bodies but BELOW the
>   skins (walk-UNDER).** `_drawDugPassage` (renamed from `_drawGapStubCap`)
>   paints a bare dug-rock floor (`PASSAGE_FLOOR`) on `_gConnector` (re-added,
>   **depth 8.8**: above entity bodies — which y-sort ~7-8 — so it COVERS a
>   traveller crossing the gap like the room arches; BELOW the door/room skin
>   layers — door skin high 9, skin-wall 9.1, procedural arch 9 — so the skinned
>   arch + room art draw OVER it instead of being overdrawn). Light (9.5) is
>   masked off the gap cell so sitting below it doesn't brighten the tunnel.
>   The floor is extended `SEAM=3` px toward each room-opening end so it meets
>   the skin with no sliver. `_drawConnectorPassages` (ex-`_drawConnectorOccluders`)
>   does the same for the skinned-door gap case. `CONNECTOR_BLACK` is **removed**.
>   (Fixes 2026-06-25: char popped out visible in the gap → walk-under; then
>   connector tucked under the skins so it doesn't overdraw the arch.)
> - **Passage side-flares.** `_drawPassageSideFlares` extends the dug look ½ tile
>   SIDEWAYS into the VOID cells flanking a connector (along the wall seam, *next
>   to* the rooms — NOT into the doorways), on `_gVoidOcc` so it shows over bedrock.
> - **Lighting unchanged** — light stays masked to room footprints, so passages +
>   bedrock are dark dug tunnels (user choice: "dark, subtle & moody").
> - Everything below about the connector being **black / walk-under / above
>   entities / excluded from the void mask** is the OLD model — superseded here.
> All in `src/ui/DungeonRenderer.js`; user-confirmed in the preview 2026-06-25; `npm test` 50/50.

## Progress

- ✅ **Step 1 (grid/connection core)** — DONE + `npm test` 50/50. Auto-connect detects 1-gap
  (`+2`); connector cells stamped/cleared as `TILE.DOOR`; `getNeighborRooms` + `_unpairNeighbourCps`
  step across the gap; touching forbidden in `validatePlacement`; `_rectsAdjacent` 1-gap aware.
  Sim harness updated to place rooms 1-gap apart.
- ✅ **Step 2 (AI adjacency mirror)** — DONE + `npm test` 50/50. `AISystem._getRoomNeighbors` +
  `roomPorts.connectedDoorPorts` step across the gap. (Combat sims require advs to path
  room→connector→room, so this is exercised.)
- ✅ **Step 3 (rendering)** — DONE, user-confirmed in Electron ("looks good"). Connector cell
  (`_drawGapStubCap`) renders near-black (`CONNECTOR_BLACK`) on `_gOverhead` (above entities →
  walk-under); void mask skips it (it's `TILE.DOOR`, not VOID); each room's facing wall opens
  per-cp; `_findPairedCp` steps across the gap so door open/close syncs both sides. Door SKIN
  spanning the gap (`_paintingCellForDoorCell`) left for a later refinement pass if wanted.
- ✅ **Step 4 (doors-as-objects)** — NO CODE NEEDED. The contiguous `TILE.DOOR` corridor
  (room opening + connector + room opening) means: the Door Lock flood-fill captures the whole
  corridor + its cleanup catches it via the in-room opening (`inRoomBounds`); the patroller
  opens on entry / closes behind itself at each wall opening; wall-trap suppression stays
  per-room. Flagged for Electron spot-check (lock a gap doorway; watch a vampire-thrall patrol).
- ✅ **Step 5 (saves)** — DONE. `CURRENT_VERSION` 1.1.0 → 1.2.0; old saves discarded on load
  (`_migrate` returns null). Accepted reset (D4).
- ✅ **Step 6 (onboarding + dev)** — DONE. `npm test` 50/50. DevSandbox `arena()` places rooms
  1-gap apart; the onboarding hard-rail already works (it gates on `computeAutoConnectPairs`,
  fixed in Step 1) — updated the stale "touching" wording in GuidedRun + NightPhase hints.

**ALL STEPS IMPLEMENTED.** Remaining: final full Electron pass (placement UX, onboarding run,
lock/patroller spot-checks, `__qfDev.arena()`), then commit.

## Goal (user intent — captured verbatim in spirit)

Rooms should connect **only when placed exactly ONE TILE APART** (today they
connect when placed wall-to-wall/touching). That one-tile gap becomes a **black
connector** that joins the two rooms; each room's facing wall opens onto it; and
characters **walk UNDER the connector** (it draws above them like an arch) as
they travel from one room to the next.

## Locked decisions

- **D1 — Connector tile type:** reuse `TILE.DOOR` (no new tile type).
- **D2 — Connector width:** **2 tiles** wide along the shared edge (same as today's doors).
- **D3 — Doors stay gameplay objects, UNCHANGED:** the auto open/close animation, the
  **Door Lock** item (+ `dungeon.locks` persistence), and the **patroller open-relock**
  minion mechanic (vampire thrall etc.) all keep working — just relocated onto the connector.
- **D4 — Saves:** **discard** old in-progress saves on a version bump (acceptable). No
  backward migration of touching layouts.
- **D5 — Touching placement:** **FORBID.** Placing a room flush (0 gap) against another is
  an invalid placement. (≥1-tile gap required; exactly 1 connects.)

## Geometry (the exact target)

`WALL_THICKNESS` (WT) = 2. Example: room **B** north of room **A**.
- **Today (touching):** B.bottomRow = A.topRow − 1. Door = a `2×WT` block carved through the
  two touching walls.
- **New (1-gap):** B.bottomRow = A.topRow − **2**; one empty row (the gap) at A.topRow − 1.
- The **connector corridor**, along the connection axis, is **2 cells wide** and
  **`WT + 1 + WT` = `2·WT+1` = 5 cells deep**: B's wall opening (WT) + the gap row (1) + A's
  wall opening (WT). All become `TILE.DOOR`.
- The **gap row** cell(s) (2 wide) are the **black connector** — rendered black, walkable,
  and occluding (entities pass under).
- This matches the dormant lane math already in the code: `_doorwayLaneAxisAt` uses
  `MAX_DEPTH = 2·WT+1`, commented "the gap-stub DOOR tile between two rooms sits 2·WT+1 cells
  from the nearest floor."

## Connection model

- Auto-connect pairs two rooms whose facing edges are **exactly one tile apart** with **≥2
  cells of overlap** along the shared axis (so the 2-wide connector fits), clamped away from
  corners (existing mid-wall-band clamp).
- A connection = a paired `cp` on each room (on its own facing wall) + the stamped connector
  corridor (both wall openings + the gap cells), all `TILE.DOOR`.
- The connector is a **relocated door**: keeps `cp.open/opening/openProgress`, lock state, and
  patroller behaviour exactly like a current door.
- Boss chamber: still **max 1** connection, centred on a wall (existing rule).

## Implementation plan (ordered; each item traces to the cross-system audit)

### Step 1 — Grid / connection core (`src/systems/DungeonGrid.js`)
- `_computeAutoConnectPairs`: adjacency tests `+1 → +2` (`oB+2===nT`, `oT-2===nB`, `oR+2===nL`,
  `oL-2===nR`); overlap/clamp ranges unchanged; cp anchors stay on each room's own wall.
- `_stampCpDoor` / `_autoConnect`: also stamp the **gap connector cells** (2 wide × the gap
  row, dungeon-absolute, outside both footprints) as `TILE.DOOR`.
- `_unstampCpDoor` / `_unpairNeighbourCps` / `removeRoom`: clear the gap cells back to
  `TILE.VOID` on teardown; resolve the paired neighbour **across the gap (step 2)**.
- `getNeighborRooms`: step **2** outward (across the connector) to find the facing room + match.
- `validatePlacement`: **forbid touching** — reject a candidate footprint that is directly
  adjacent (0 gap) to any existing room. Allow ≥1-gap.
- `_rectsAdjacent` / `_bfsDepth` (minDepthFromBoss): "adjacent" = within-the-1-gap connected.

### Step 2 — Pathing / AI adjacency (mirror the spine fix)
- `AISystem._getRoomNeighbors`: step 2 across the connector.
- `util/roomPorts.connectedDoorPorts`: step 2.
- `PathfinderSystem`: no change (connector is `TILE.DOOR` → already walkable); verify the lane
  gate handles the 2-wide connector across the `2·WT+1` corridor.
- Verify: Begin-Day connectivity gate, depth-from-boss, barracks distance, minion patrol
  scope, room auras (Sanctum / Watchtower / Veil) all resolve.

### Step 3 — Rendering (`src/ui/DungeonRenderer.js`)
- Open BOTH facing walls + cap jambs; render the gap connector cell **black**; entities pass
  **under** it.
- Reuse: the low/high split containers + masks (walk-under), `_gOverhead` (depth 9), the carve
  utils (`doorSkinCarve.js`, geometry-agnostic), and `_drawGapStubCap`/`_drawDoorGap`
  (re-dispatch; change fill to black).
- `_findPairedCp` / `_doorBlockCells` / `_paintingCellForDoorCell`: gap-aware (partner 2 cells
  out; door block now = own-wall opening + gap cell).
- Exclude the connector cell from the void mask/occluder (depth 12) so it isn't painted over.
- Placement preview: show the gap connection (and that touching is invalid).

### Step 4 — Doors-as-objects re-home (behaviour identical)
- **Door Lock** item: target the connector tile; store the connector cells in
  `dungeon.locks.doorTiles`; widen MOVE/SELL orphan-cleanup to the connector band (it's
  outside both footprints).
- **Patroller minions**: trigger open/relock on the connector tile.
- **Wall-trap-suppresses-doorway**: rework against the connector band; fix `recheckAutoConnect`
  coord.

### Step 5 — Saves / migration
- Bump save version; `_migrate` discards old saves (explicit, per D4). Player-facing note:
  "this update resets in-progress dungeons."

### Step 6 — Onboarding + dev + verify
- Update **Onboarding Beat 1** (currently hard-rails touching placement) to teach the 1-gap
  connection.
- Update **DevSandbox** arena builder (places rooms touching) to a 1-gap.
- Full verify in Electron + `npm test` + sim.

## Acceptance checklist (tick against ACTUAL code before "done")

- ☐ Rooms placed exactly 1 tile apart auto-connect; touching is rejected; >1 gap does not connect.
- ☐ Connector is 2 wide, `TILE.DOOR`, walkable; corridor = `2·WT+1` deep.
- ☐ Both facing walls open with capped jambs; gap connector renders **black**; travelers pass **under** it.
- ☐ Begin-Day connectivity gate passes for a valid 1-gap layout; disconnected detection still correct.
- ☐ Adventurers + minions path room→connector→room; patrol scope, auras, depth-from-boss correct.
- ☐ Door open/close animation works on the connector; Door Lock locks it; patroller open-relock works.
- ☐ Removing/moving a room clears its connector(s) to VOID; no dangling cps/locks.
- ☐ Boss chamber still max 1, centred.
- ☐ Old saves discarded cleanly on version bump (no crash); new saves round-trip.
- ☐ Onboarding Beat 1 + dev arena updated; `npm test` green; Electron-verified.

## Risks / verify-on-screen (don't trust reasoning for these)

- Geometry/rotation is error-prone — verify in Electron, not by reasoning.
- The 2-wide connector lane centring (`getLaneCenterWorld`) — confirm single-file traversal
  across the longer (`2·WT+1`) corridor doesn't stutter/oscillate.
- Corner clamping — the connector must not land in a room's corner zone.
- Corridors are a placeable room type — confirm corridor-to-room and corridor-to-corridor
  connections behave under the 1-gap rule.

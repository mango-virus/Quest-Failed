# Rooms connect only at wall midpoints — design (LOCKED 2026-06-26)

Make every room connect to its neighbours **only when their facing walls'
midpoints align** — exactly the rule the boss chamber already follows — instead
of connecting anywhere their edges overlap. Builds on the 1-tile-gap connector
model (`ROOM_CONNECTIONS.md`); this changes only **where along the shared edge a
connection is allowed to form**, not the gap/connector geometry.

## Goal (user intent)

> "Allow rooms to only connect at their middle points. Like the boss room.
> Make sure this doesn't break anything; fix and verify if it does. Update any
> onboarding guides affected."

## Locked decisions

- **D1 — Strict center alignment.** Two rooms connect **iff** their facing
  walls' exact midpoint cells land on the **same** dungeon cell, 1 tile apart.
  Misaligned centers → **no connection** (not an off-center door). This is the
  boss rule, applied to every room.
- **D2 — Snap-to-align placement assist.** While dragging a room (initial place
  **and** MOVE), if it's near a center-aligned + 1-gap position relative to a
  placed room, the ghost snaps to the exact connecting spot.
- **D3 — Saves discarded on a version bump.** Bump `CURRENT_VERSION` (SaveSystem)
  `1.3.0 → 1.4.0`, and align `meta.version` in GameState `createGameState`
  (currently a stale `1.2.0`) to `1.4.0` so both read the same. Old in-progress
  dungeons are discarded on load (consistent with the 1-gap change's precedent).
  ⛔ Both constants must read the same version or every save can discard silently
  (known gotcha) — note the save path already stamps `CURRENT_VERSION` on write,
  so the discard hinges on `CURRENT_VERSION`, but align both anyway.
- **D4 — Boss rule unchanged in spirit.** The boss already center-aligns; its
  only extra rule — **max 1 door** — stays. The boss special-case in the pairing
  code collapses into the now-universal center rule.
- **D5 — Connector geometry unchanged.** 1-tile gap, 2-wide `TILE.DOOR`
  connector, `2·WT+1` corridor depth, dug-passage rendering — all as-is. Only the
  *allowed position* along the wall changes.

## The exact geometry

`WALL_THICKNESS` (WT) = 2. Along the shared axis, a room's **wall-center cell**
(the lower-coord cell of its 2-wide door) is:

```
center = origin + floor((size − 2) / 2)
```

where `origin`/`size` are the room's `gridX`/`width` (N/S walls) or
`gridY`/`height` (E/W walls). This is the **existing boss formula** — reused
verbatim so boss and regular rooms are identical and parity/rotation edge cases
match what already ships.

A pair `(newRoom, other)` connects iff:
1. Facing edges are exactly **1 tile apart** (existing `+2` adjacency test).
2. `centerNew === centerOther`.
3. That cell lies in the legal **mid-wall band** `[lo, hi]` (existing corner
   clamp) — guards tiny/odd rooms whose center would clip a corner zone. (Same
   guard the boss already applies; if it fails, no connection forms.)

## Architecture & components

### 1. Connection core — `DungeonGrid._computeAutoConnectPairs`

- Keep the `+2` adjacency detection, `oxRange/oyRange` overlap, and the `[lo,hi]`
  corner-clamp computation as-is.
- Replace the `wcenter` selection. Today:
  - non-boss → `wcenter = floor((lo + hi) / 2)` (overlap midpoint)
  - boss → forced to its wall center, skip if outside `[lo,hi]`
- New (universal):
  ```
  centerNew   = newOrigin + floor((newSize - 2) / 2)
  centerOther = otherOrigin + floor((otherSize - 2) / 2)
  if (centerNew !== centerOther) continue
  wcenter = centerNew
  if (wcenter < lo || wcenter > hi) continue
  ```
  (`newOrigin/newSize` and `otherOrigin/otherSize` chosen by axis, mirroring how
  the boss branch picks `bossRoom.width/height` and `gridX/gridY`.)
- The `bossRoom` branch is **removed** — boss center == its wall center, so the
  general path produces the identical result. Boss's **max-1-door** cap stays
  (the `isBossNew && newDoorCount >= 1` / `connectionPoints.length >= 1` checks).
- Everything downstream (cp construction, trap-block check, `out.push`) unchanged.

### 2. Snap-to-align — `NightPhase` drag + MOVE

- Current room drag (`pointermove`, `_selectedKind === 'room'`) is free placement:
  `tx = round(wp.x/TS − w/2)`, `ty = round(wp.y/TS − h/2)`.
- Add `_snapRoomToAlign(def, tx, ty)`:
  - For the candidate footprint at `(tx,ty)`, scan placed rooms.
  - For each neighbour and each of the 4 sides, compute the **exact** `(tx,ty)`
    that yields (a) a 1-tile gap and (b) `candidateCenter === neighbourCenter`
    on that axis.
  - If the candidate is within a small threshold (≈1 tile/axis) of that exact
    spot, it's a snap candidate. Pick the **nearest** snap; else return `(tx,ty)`
    unchanged.
  - Snap is **advisory only** — placement still runs `validatePlacement`, so snap
    can never produce an illegal overlap.
- Apply the snapped coords before `_drawPreview`, so the ghost + connection
  preview reflect the snapped position.
- The **MOVE tool** (re-placing an existing room) routes through the same helper
  (D2) so moving re-snaps into alignment.

### 3. Breakage fixes (programmatic dungeon builders)

Every place that builds a dungeon in code assumes the loose overlap rule and will
silently produce **disconnected** rooms under the strict rule:

- **Sim harness** (`tools/sim/harness.mjs`):
  - `attachRoom` E/W placement: `y = anchor.gridY` →
    `y = anchor.gridY + floor((anchor.height−2)/2) − floor((def.height−2)/2)`
    so vertical centers match.
  - Entry-hall N/S placement (~line 207): align `gridX` centers the same way.
  - **Load-bearing**: if wrong, sim checks relying on treasury/crypt room
    behaviours fail in `npm test` — the canary that the rule is wrong.
- **DevSandbox `arena()`**: re-center its rooms so the sandbox dungeon connects.
- **Onboarding Beat 1** (GuidedRun / NightPhase scripted placement + hints):
  - Verify the scripted placement coords land on a center-aligned spot (connect
    under the new rule), correcting them if not.
  - Update teaching copy from "place 1 tile apart" → "line up the middles"
    (snap makes this natural).
- **Placement preview**: already calls `computeAutoConnectPairs`, so the
  connection read updates for free — verify misaligned shows "no connect",
  aligned/snapped shows "connect".

### 4. Saves — `GameState` + `SaveSystem`

- `CURRENT_VERSION` (SaveSystem) `1.3.0 → 1.4.0`; align `createGameState`
  `meta.version` `1.2.0 → 1.4.0`. The version check discards older saves (returns
  null). No backward migration of off-center layouts.

## Data flow

Place/move room → `NightPhase.pointermove` snaps coords → `_drawPreview` (ghost +
`computeAutoConnectPairs` preview) → `pointerdown` → `placeRoom` →
`_autoConnect` → `_computeAutoConnectPairs` (center rule) → cps + stamped
`TILE.DOOR` connector. Begin Day → connectivity gate walks the cp graph (unchanged).

## What is explicitly NOT changing

- Connector tile type / width / corridor depth / dug-passage rendering.
- Door-as-object behaviour (auto open/close, Door Lock, patroller open-relock).
- Adjacency-across-the-gap resolution (`getNeighborRooms`, AI neighbours,
  `roomPorts` — they step 2 cells, independent of *where* on the wall the door is).
- Boss max-1-door cap.

## Verification plan

- `npm test` green (lint + all sim checks; the harness center fix is validated
  here).
- `npm run sim:soak` — connectivity/crash pass across the build space.
- Electron (primary surface):
  - Drag a room near another → snaps into a centered connection; misaligned →
    no connection; aligned → connects (door appears).
  - **MOVE** a room → re-snaps into alignment.
  - **SELL** a room → its connector clears to VOID; no dangling cp/lock.
  - **Onboarding** start→finish — Beat 1 still completes under the new rule.
  - **Begin Day** connectivity gate passes a valid layout, flags a disconnected one.
  - Boss chamber still connects (centered, max 1).
  - Screenshot the snap + a centered connection as proof.

## Acceptance checklist (tick against ACTUAL code before "done")

- ☐ Two rooms connect iff facing-wall midpoints coincide on the same cell, 1 gap apart.
- ☐ Misaligned centers do not connect; >1 gap does not connect; touching still rejected.
- ☐ Boss special-case removed from `_computeAutoConnectPairs`; boss still max-1, centered.
- ☐ Snap-to-align nudges a dragged room onto the centered connecting spot (place + MOVE).
- ☐ Snap never produces an invalid placement (validatePlacement still authoritative).
- ☐ Sim harness builds a CONNECTED dungeon; `npm test` green; `sim:soak` clean.
- ☐ DevSandbox `arena()` dungeon is connected.
- ☐ Onboarding Beat 1 completes; copy updated to "line up the middles".
- ☐ Placement preview shows connect/no-connect correctly.
- ☐ Save version bumped on BOTH `meta.version` and `CURRENT_VERSION`; old saves discarded cleanly; new saves round-trip.
- ☐ Electron-verified (snap, MOVE, SELL, onboarding, Begin-Day gate, boss) + screenshot proof.

## Risks (verify on screen, don't trust reasoning)

- Center/parity math for even vs odd room sizes — verify in Electron, and reuse
  the boss formula verbatim rather than re-deriving.
- Snap threshold tuning — too large feels magnetic/sticky, too small feels like
  no help. Tune in-preview.
- Strict rule makes connected layouts harder to build — snap is the mitigation;
  confirm a normal dungeon is still comfortable to assemble.
- Corridors are placeable rooms — confirm corridor↔room and corridor↔corridor
  center-connect under the rule.

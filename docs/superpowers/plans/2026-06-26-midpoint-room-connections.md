# Midpoint-Only Room Connections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every room connect to a neighbour only when their facing walls' midpoints align on the same cell (the boss chamber's rule, made universal), with snap-to-align placement so it stays comfortable to build.

**Architecture:** One rule change in `DungeonGrid._computeAutoConnectPairs` (require both wall-centers to coincide; the boss special-case collapses into it). Implement the already-stubbed `findSnap` to pull a dragged/moved room onto the centered connecting spot (both placement and MOVE already route through `placeRoom`, which already calls `findSnap`). Fix the programmatic dungeon builders (sim harness, DevSandbox `arena`) to center-align so they still build CONNECTED dungeons. Update onboarding copy. Bump the save version to discard old layouts.

**Tech Stack:** Phaser 3 game, vanilla ES modules, Node test harness (`tools/sim/*-check.mjs`, run by `npm test`). No build step — `src/` is served directly.

## Global Constraints

- Tile size is 32px via `Balance.TILE_SIZE`; `WALL_THICKNESS` (WT) = `Balance.WALL_THICKNESS` = 2. Never hardcode these.
- A room's **wall-center cell** along an axis = `origin + Math.floor((size - 2) / 2)` (origin/size = `gridX`/`width` for N/S walls, `gridY`/`height` for E/W). This is the EXISTING boss formula — reuse it verbatim everywhere, never re-derive with offsets.
- Connector geometry is unchanged: 1-tile gap, 2-wide `TILE.DOOR` connector. "1 tile apart" means facing edges are exactly 2 cells apart (`oB + 2 === nT`, etc.).
- `npm test` must stay green at every commit. It auto-discovers every `tools/sim/*-check.mjs` (each in its own node process) plus the lints.
- Save constants must read the SAME version string in both `SaveSystem.CURRENT_VERSION` and `GameState.createGameState` `meta.version`, or saves can silently discard (known gotcha).
- Geometry/rotation is error-prone in this codebase — anything visual is verified in the Electron desktop build (the primary surface), not by reasoning.

---

### Task 1: Center-alignment connection rule + programmatic-builder fixes

Promote the boss "door at exact wall center, reject if not reachable" behaviour to the universal rule, and fix every place that builds a dungeon in code so the test suite still produces CONNECTED dungeons.

**Files:**
- Test (create): `tools/sim/room-midpoint-connect-check.mjs`
- Modify: `src/systems/DungeonGrid.js` (`_computeAutoConnectPairs`, ~lines 1216-1232)
- Modify: `tools/sim/harness.mjs` (`attachRoom` ~line 62-75, `buildNight` ~line 200-211)
- Modify: `src/dev/DevSandbox.js` (`arena` ~line 318-387)

**Interfaces:**
- Consumes: `DungeonGrid.prototype._computeAutoConnectPairs(newRoom)` — iterates `this._d.rooms`, returns `[{ newCp, otherRoom, otherCp }]`.
- Produces: the rule "a pair connects iff facing-wall midpoints coincide AND that cell is in `[lo,hi]`". No signature change.

- [ ] **Step 1: Write the failing test**

Create `tools/sim/room-midpoint-connect-check.mjs`:

```js
// Headless check — room MIDPOINT connection rule. Two rooms 1 tile apart connect
// ONLY when their facing walls' center cells coincide (the boss rule, universal).
//
//   node tools/sim/room-midpoint-connect-check.mjs
//
// Drives the REAL DungeonGrid._computeAutoConnectPairs via Object.create (no
// Phaser). A placed room A sits in _d.rooms; a candidate B is tested against it.

import { DungeonGrid } from '../../src/systems/DungeonGrid.js'

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

const grid = Object.create(DungeonGrid.prototype)
// Placed room A: regular, 16×12, top-left (20,40). centerX = 20 + floor((16-2)/2) = 27.
const A = { instanceId: 'A', definitionId: 'starter_barracks', gridX: 20, gridY: 40, width: 16, height: 12, connectionPoints: [] }
grid._d = { rooms: [A], traps: [] }

// Candidate B directly SOUTH of A, 1-gap: B.gridY = A.gridY + A.height + 1 = 53.
const mkB = (gridX) => ({ definitionId: 'starter_barracks', instanceId: 'B', gridX, gridY: 53, width: 16, height: 12, connectionPoints: [] })

console.log('\n[1] Center-aligned rooms connect')
{
  const pairs = grid._computeAutoConnectPairs(mkB(20))   // B.centerX = 27 == A.centerX
  ok(pairs.length === 1 && pairs[0].otherRoom === A, 'aligned (centerX match) → 1 connection to A')
}

console.log('\n[2] Misaligned centers do NOT connect (even though edges overlap)')
{
  ok(grid._computeAutoConnectPairs(mkB(21)).length === 0, 'shifted +1 (centerX 28 ≠ 27) → no connection')
  ok(grid._computeAutoConnectPairs(mkB(19)).length === 0, 'shifted -1 (centerX 26 ≠ 27) → no connection')
}

console.log('\n[3] Wrong gap does not connect')
{
  const touching = { ...mkB(20), gridY: 52 }   // 0-gap: A.bottom(51)+2=53 ≠ 52
  ok(grid._computeAutoConnectPairs(touching).length === 0, 'touching (0-gap) → no auto-connect pair')
}

console.log(fails === 0 ? '\n✅ room-midpoint-connect-check: ALL PASS' : `\n❌ room-midpoint-connect-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tools/sim/room-midpoint-connect-check.mjs`
Expected: FAIL on `[2]` — the current loose rule places the door at the overlap midpoint, so a +1/-1 shift still connects (returns a pair).

- [ ] **Step 3: Implement the center rule**

In `src/systems/DungeonGrid.js`, replace the boss-special-case `wcenter` block (currently ~lines 1217-1232, from the comment `// Boss connection —` through the `else { wcenter = Math.floor((lo + hi) / 2) }`) with the universal center rule:

```js
      // Connection is allowed ONLY when both facing walls' MIDPOINTS coincide
      // on the same cell (the boss rule, now universal). Each room's wall-center
      // cell (the lower-coord cell of its 2-wide door) uses the boss formula
      // origin + floor((size - 2) / 2). If the centers differ, or the shared
      // center falls outside the legal mid-wall band [lo,hi], no door forms.
      let centerNew, centerOther
      if (oxRange) {
        centerNew   = newRoom.gridX + Math.floor((newRoom.width  - 2) / 2)
        centerOther = other.gridX   + Math.floor((other.width    - 2) / 2)
      } else {
        centerNew   = newRoom.gridY + Math.floor((newRoom.height - 2) / 2)
        centerOther = other.gridY   + Math.floor((other.height   - 2) / 2)
      }
      if (centerNew !== centerOther) continue
      const wcenter = centerNew
      if (wcenter < lo || wcenter > hi) continue
```

Notes:
- Delete the `const bossRoom = ...` line and its `if (bossRoom) { ... } else { ... }` block — fully replaced by the above. The boss now flows through the same path (boss center == its wall center). The boss MAX-1-door cap is untouched (it lives earlier: the `isBossNew && newDoorCount >= 1` / `connectionPoints.length >= 1` checks at ~lines 1152-1153).
- Everything after (`let cpNew, cpOther` cp construction, style propagation, trap-block, `out.push`) is unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tools/sim/room-midpoint-connect-check.mjs`
Expected: PASS — all three groups green.

- [ ] **Step 5: Fix the sim harness so it builds CONNECTED dungeons**

The harness places rooms edge-aligned, which under the center rule disconnects them whenever room sizes differ. Center-align both placements.

In `tools/sim/harness.mjs`, `attachRoom` (the E/W chain), replace `const y = anchor.gridY` (~line 66) with:

```js
  // Center-align on the shared (vertical) axis so the facing-wall MIDPOINTS
  // coincide — required for a connection under the midpoint rule.
  const y = anchor.gridY + Math.floor((anchor.height - 2) / 2) - Math.floor((def.height - 2) / 2)
```

In `tools/sim/harness.mjs`, `buildNight` (the N/S entry hall), replace `grid.placeRoom(entryDef, boss.gridX, gy, { noSnap: true })` (~line 208) with a center-aligned X:

```js
  const ex = boss.gridX + Math.floor((boss.width - 2) / 2) - Math.floor((entryDef.width - 2) / 2)
  grid.placeRoom(entryDef, ex, gy, { noSnap: true })
  for (let dx = 1; dx < entryDef.width - 1; dx++) grid.recheckAutoConnect?.(ex + dx, boss.gridY)
```

(Note: the `recheckAutoConnect` loop's X origin changes from `boss.gridX` to `ex` to match.)

- [ ] **Step 6: Fix the DevSandbox arena builder**

In `src/dev/DevSandbox.js`, the `arena()` builder hand-places rooms at edge-aligned offsets (the `[lib.gridX, lib.gridY - eh - 1]` etc. candidate lists and the library/barracks/entry placements). Re-center each placed room against its anchor on the shared axis using the same formula, so the sandbox dungeon connects. For each placement of a room `def` 1-gap from an anchor `a`:
- N/S of `a` (sharing the vertical edge): `gx = a.gridX + Math.floor((a.width - 2)/2) - Math.floor((def.width - 2)/2)`, keep the gap `gy`.
- E/W of `a` (sharing the horizontal edge): `gy = a.gridY + Math.floor((a.height - 2)/2) - Math.floor((def.height - 2)/2)`, keep the gap `gx`.

Apply this to the library-vs-boss placement, the barracks/trap-factory-vs-library candidates, and the entry-vs-boss placement. After the edit, the function's own `getDisconnectedRooms()` check (it already logs "built a connected test dungeon" vs "arena partial") is the in-code assertion — it must report connected.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — the new `room-midpoint-connect` check passes, and all existing checks (which build dungeons via the now-center-aligned harness) stay green. If any combat/behaviour check fails with disconnected rooms, the harness center-align in Step 5 is wrong — re-derive against the adjacency tests, do not guess.

- [ ] **Step 8: Commit**

```bash
git add src/systems/DungeonGrid.js tools/sim/room-midpoint-connect-check.mjs tools/sim/harness.mjs src/dev/DevSandbox.js
git commit -m "feat: rooms connect only at aligned wall midpoints"
```

---

### Task 2: Snap-to-align placement (findSnap + preview wiring)

Implement the stubbed `findSnap` to pull a dragged room onto the centered 1-gap connecting spot, and make the NightPhase ghost preview reflect the snap. Both initial placement and MOVE already call `placeRoom` → `findSnap`, so this covers both.

**Files:**
- Test (create): `tools/sim/room-snap-check.mjs`
- Modify: `src/systems/DungeonGrid.js` (`findSnap`, ~lines 570-572)
- Modify: `src/scenes/NightPhase.js` (`pointermove` room branch, ~lines 1665-1671)

**Interfaces:**
- Consumes: `SNAP_RADIUS` (module const = 1), `Balance.WALL_THICKNESS`, `this._d.rooms`.
- Produces: `findSnap(definition, gridX, gridY) → { gridX, gridY } | null`. NightPhase preview uses it to set `tx/ty` before `_drawPreview`.

- [ ] **Step 1: Write the failing test**

Create `tools/sim/room-snap-check.mjs`:

```js
// Headless check — findSnap pulls a dragged room onto the center-aligned, 1-gap
// connecting spot relative to a placed room, within SNAP_RADIUS.
//
//   node tools/sim/room-snap-check.mjs

import { DungeonGrid } from '../../src/systems/DungeonGrid.js'

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

const grid = Object.create(DungeonGrid.prototype)
// Placed room A: 16×12 at (20,40). centerX = 27. The aligned SOUTH connecting
// spot for a 16×12 candidate is gridX=20, gridY = 40+12+1 = 53.
const A = { instanceId: 'A', definitionId: 'starter_barracks', gridX: 20, gridY: 40, width: 16, height: 12, connectionPoints: [] }
grid._d = { rooms: [A], traps: [] }
const def = { width: 16, height: 12 }

console.log('\n[1] Near the aligned spot → snaps to it')
{
  const s = grid.findSnap(def, 21, 53)   // 1 tile off in X (within radius 1)
  ok(s && s.gridX === 20 && s.gridY === 53, 'drag at (21,53) snaps to (20,53)')
}

console.log('\n[2] On the aligned spot → idempotent')
{
  const s = grid.findSnap(def, 20, 53)
  ok(s && s.gridX === 20 && s.gridY === 53, 'drag at (20,53) returns (20,53)')
}

console.log('\n[3] Too far → no snap')
{
  ok(grid.findSnap(def, 24, 53) === null, 'drag at (24,53) (4 off) → null')
  ok(grid.findSnap(def, 20, 80) === null, 'drag far below → null')
}

console.log(fails === 0 ? '\n✅ room-snap-check: ALL PASS' : `\n❌ room-snap-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tools/sim/room-snap-check.mjs`
Expected: FAIL on `[1]`/`[2]` — `findSnap` is currently a stub returning `null`, so the expected snap is never produced.

- [ ] **Step 3: Implement findSnap**

In `src/systems/DungeonGrid.js`, replace the no-op `findSnap` (~lines 567-572) with:

```js
  // Snap a dragged/moved room onto the center-aligned, 1-tile-gap connecting
  // spot relative to the nearest placed room, if the cursor position is within
  // SNAP_RADIUS of it. Returns { gridX, gridY } or null (free placement).
  // Geometry mirrors _computeAutoConnectPairs' adjacency tests exactly:
  //   candidate SOUTH of other: gy = o.gridY + o.height + 1
  //   candidate NORTH of other: gy = o.gridY - h - 1
  //   candidate EAST  of other: gx = o.gridX + o.width  + 1
  //   candidate WEST  of other: gx = o.gridX - w - 1
  // The off-axis coord aligns wall-centers via origin + floor((size-2)/2).
  findSnap(definition, gridX, gridY) {
    if (!definition) return null
    const w = definition.width, h = definition.height
    if (!w || !h) return null
    const cOff = (size) => Math.floor((size - 2) / 2)   // center offset along an axis
    let best = null, bestDist = Infinity
    for (const o of this._d.rooms ?? []) {
      const alignX = o.gridX + cOff(o.width)  - cOff(w)   // gx so X-centers coincide
      const alignY = o.gridY + cOff(o.height) - cOff(h)   // gy so Y-centers coincide
      const spots = [
        { gx: alignX, gy: o.gridY + o.height + 1 },   // S of o
        { gx: alignX, gy: o.gridY - h - 1 },          // N of o
        { gx: o.gridX + o.width + 1, gy: alignY },    // E of o
        { gx: o.gridX - w - 1,       gy: alignY },    // W of o
      ]
      for (const s of spots) {
        const d = Math.abs(s.gx - gridX) + Math.abs(s.gy - gridY)
        if (d <= SNAP_RADIUS && d < bestDist) { bestDist = d; best = { gridX: s.gx, gridY: s.gy } }
      }
    }
    return best
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tools/sim/room-snap-check.mjs`
Expected: PASS — all three groups green.

- [ ] **Step 5: Wire the snap into the NightPhase ghost preview**

So the player SEES the room snap (not just at commit), apply `findSnap` to the preview coords. In `src/scenes/NightPhase.js`, in the `pointermove` handler's room branch (~lines 1665-1671), after computing the raw `tx`/`ty`, add the snap:

```js
      if (this._selectedKind === 'room') {
        // Use fractional tile position so the room center tracks the cursor
        // precisely rather than snapping to the nearest tile edge.
        const rotDef = this._getRotatedDef(this._selected)
        tx = Math.round(wp.x / TS - rotDef.width  / 2)
        ty = Math.round(wp.y / TS - rotDef.height / 2)
        // Snap onto the center-aligned, 1-gap connecting spot when near one.
        const snapped = this._dungeonGrid.findSnap?.(rotDef, tx, ty)
        if (snapped) { tx = snapped.gridX; ty = snapped.gridY }
      } else if (this._selectedKind === 'trap') {
```

(`placeRoom` will re-run `findSnap` at commit; snapping an already-snapped position is idempotent, so this is safe and the validated/committed coords match the ghost.)

- [ ] **Step 6: Run the full suite (no regression)**

Run: `npm test`
Expected: PASS (the new snap check + everything else).

- [ ] **Step 7: Commit**

```bash
git add src/systems/DungeonGrid.js tools/sim/room-snap-check.mjs src/scenes/NightPhase.js
git commit -m "feat: snap-to-align rooms onto centered connecting spots"
```

---

### Task 3: Update onboarding copy

The onboarding rail already gates placement on `computeAutoConnectPairs` (so it auto-respects the new rule); only the teaching copy needs to match the new "line up the middles, it snaps" reality.

**Files:**
- Modify: `src/hud/GuidedRun.js` (~lines 230, 238, 241)
- Modify: `src/scenes/NightPhase.js` (`_onboardingConnectHint`, ~lines 2618-2622)

**Interfaces:** none (string copy only).

- [ ] **Step 1: Update GuidedRun hint/coach copy**

In `src/hud/GuidedRun.js`:
- Line ~230 hint `'Green = 1 tile from the entry hall →'` → `'Green = lined up with the entry hall →'`
- Line ~238 coach text `'See? A one-tile gap links rooms with a doorway'` → `'See? Rooms snap together at their middles to link up'`
- Line ~241 coach text `'Place rooms one tile apart so doorways link them'` → `'Line rooms up by their middles — they snap together with a doorway'`

- [ ] **Step 2: Update the placement-blocked hint**

In `src/scenes/NightPhase.js`, `_onboardingConnectHint` (~lines 2618-2622):

```js
  _onboardingConnectHint() {
    return this._gameState.meta?.guidedPlace === 'boss'
      ? 'Line the room up with the middle of the boss chamber to connect'
      : 'Line the room up with another room’s middle to connect'
  }
```

- [ ] **Step 3: Run the suite (sanity)**

Run: `npm test`
Expected: PASS (copy-only change; nothing should break).

- [ ] **Step 4: Commit**

```bash
git add src/hud/GuidedRun.js src/scenes/NightPhase.js
git commit -m "docs: onboarding copy for midpoint room connection"
```

---

### Task 4: Bump save version (discard old in-progress dungeons)

Old saves restore connections as-stored (off-center doors). Discard them on load by bumping the version; align both constants.

**Files:**
- Modify: `src/systems/SaveSystem.js` (`CURRENT_VERSION`, line ~23)
- Modify: `src/state/GameState.js` (`createGameState` `meta.version`, line ~106)

**Interfaces:** none (constant strings).

- [ ] **Step 1: Bump SaveSystem.CURRENT_VERSION**

In `src/systems/SaveSystem.js` line ~23, change `const CURRENT_VERSION = '1.3.0'` → `const CURRENT_VERSION = '1.4.0'`.

- [ ] **Step 2: Align GameState meta.version**

In `src/state/GameState.js` line ~106, change `version: '1.2.0',` → `version: '1.4.0',`.

- [ ] **Step 3: Verify both read the same version**

Run: `node -e "const fs=require('fs'); const sv=fs.readFileSync('src/systems/SaveSystem.js','utf8').match(/CURRENT_VERSION = '([\d.]+)'/)[1]; const gv=fs.readFileSync('src/state/GameState.js','utf8').match(/version: '([\d.]+)'/)[1]; console.log('save',sv,'state',gv, sv===gv?'OK':'MISMATCH'); process.exit(sv===gv?0:1)"`
Expected: `save 1.4.0 state 1.4.0 OK`

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/SaveSystem.js src/state/GameState.js
git commit -m "chore: bump save version to 1.4.0 (discard pre-midpoint dungeons)"
```

---

### Task 5: Full verification + finish the branch

Verify the whole feature in the Electron desktop build (the primary surface) and close out.

**Files:** none (verification only).

- [ ] **Step 1: Green the automated gate**

Run: `npm test`
Expected: PASS (lints + all checks incl. the two new ones).

- [ ] **Step 2: Connectivity/crash soak**

Run: `npm run sim:soak`
Expected: completes with no crashes / invariant breaks.

- [ ] **Step 3: Electron verification pass (use the qf-verify skill)**

Build a dungeon and confirm, capturing screenshots:
- Drag a room near another → it SNAPS into a centered connection (door appears). Drag it off-center → NO connection (red/no-door). Aligned → connects.
- MOVE an existing room → it re-snaps into alignment.
- SELL a connected room → its connector clears to VOID, no dangling door.
- Run the GUIDED onboarding start→finish → Beat 1 (entry hall → boss) and Beat 2 (barracks) complete under the new rule; copy reads correctly.
- Begin Day → connectivity gate passes a fully-connected layout and blocks a deliberately disconnected one.
- Boss chamber still connects (centered, max 1 door).
- `__qfDev.arena()` builds a CONNECTED test dungeon (console logs "built a connected test dungeon").

- [ ] **Step 4: Update STATUS/docs if a count or tracked feature changed**

Run: `npm run verify-docs` (fix with `:fix` if it flags drift). This change adds no content counts, but run the check to be safe.

- [ ] **Step 5: Finish the branch (use the finishing-a-development-branch skill)**

Present merge/PR options to the user. Do not merge without the user's go-ahead.

---

## Self-Review

**Spec coverage:**
- D1 strict center alignment → Task 1 (rule) + test.
- D2 snap-to-align (place + MOVE) → Task 2 (`findSnap` + preview wiring; both flow through `placeRoom`).
- D3 saves discarded, both constants aligned to 1.4.0 → Task 4.
- D4 boss rule (max-1 kept, special-case collapsed) → Task 1 Step 3 notes.
- D5 connector geometry unchanged → no task touches it (only `wcenter` selection changes).
- Breakage fixes: sim harness + DevSandbox arena → Task 1; onboarding → Task 3; placement preview (auto via `computeAutoConnectPairs`) → verified Task 5 Step 3.
- Verification (npm test, sim:soak, Electron) → Task 5.

**Placeholder scan:** none — every code/test step shows full content; commands have expected output.

**Type consistency:** `findSnap(definition, gridX, gridY) → {gridX,gridY}|null` defined in Task 2 Step 3 and consumed in Task 2 Step 5 with matching shape. Center formula `origin + floor((size-2)/2)` identical in the global constraints, Task 1 rule, harness fix, arena fix, and `findSnap`. `_computeAutoConnectPairs` signature unchanged.

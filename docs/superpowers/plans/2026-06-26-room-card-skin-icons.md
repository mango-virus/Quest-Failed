# Room-Card Skin Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the construction (build) menu's room cards show each room's actual skin PNG as the icon (8 skinned rooms), with skinless rooms rendering blank.

**Architecture:** Extract a tiny pure helper `roomCardSkinSrc(def)` (room def → skin-PNG URL or null) so the icon-source decision is unit-testable headless, then rewire the one room-card icon branch in `BuildMenu._cardArt` to use it (skin `<img>` with smooth scaling, else blank). Delete the now-dead `roomThumbnailCache.js`.

**Tech Stack:** Phaser 3 game, vanilla ES modules (no build step — `src/` served directly), DOM HUD (`src/hud/`), Node test harness (`tools/sim/*-check.mjs` run by `npm test`).

## Global Constraints

- Skin icon URL = `assets/themes/roomskins/<def.backgroundImage>.png` (the web/app root serves from `src/`; matches `DungeonRenderer`'s default skin path). A room is "skinned" iff `typeof def.backgroundImage === 'string'`.
- Skinless rooms render **blank** — the icon builder returns `null`, so the `bsh-vis` slot is empty (the `h()` helper skips `null` children). Only card text shows. This matches today's appearance (no regression).
- Skin icons use **smooth** scaling: `img.style.imageRendering = 'auto'` (NOT `'pixelated'`).
- Only the `cat.kind === 'room'` branch of `BuildMenu._cardArt` changes; trap/item/minion icons and in-game `DungeonRenderer` skin rendering are untouched.
- `npm test` must stay green. It auto-discovers every `tools/sim/*-check.mjs` and runs the lints (incl. `lint-syntax`, which `node --check`s every `src/**/*.js` — so a broken import in `BuildMenu.js` or a dangling reference to the deleted module fails the gate).
- Don't edit `rooms.json` (read-only here) or any room skin data.

---

### Task 1: Pure skin-source helper + headless test

Extract the room-def → icon-URL decision into a dependency-free module so it can be unit-tested without a DOM, and lock the 8-skinned-rooms expectation with a regression test against real data.

**Files:**
- Create: `src/hud/roomCardSkin.js`
- Create (test): `tools/sim/room-card-skin-check.mjs`

**Interfaces:**
- Produces: `roomCardSkinSrc(def) → string | null` — returns `assets/themes/roomskins/<def.backgroundImage>.png` when `def.backgroundImage` is a string, else `null`. Consumed by Task 2's `BuildMenu._cardArt`.

- [ ] **Step 1: Write the failing test**

Create `tools/sim/room-card-skin-check.mjs`:

```js
// Headless check — roomCardSkinSrc maps a room def to its skin-PNG icon URL
// (or null when the room has no skin). Guards the asset-path format and the
// set of skinned rooms against real rooms.json data.
//
//   node tools/sim/room-card-skin-check.mjs

import { readFileSync } from 'node:fs'
import { roomCardSkinSrc } from '../../src/hud/roomCardSkin.js'

const rooms = JSON.parse(readFileSync(new URL('../../src/data/rooms.json', import.meta.url), 'utf8'))
const byId = (id) => rooms.find(r => r.id === id)

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

console.log('\n[1] Skinned rooms map to assets/themes/roomskins/<skin>.png')
{
  ok(roomCardSkinSrc(byId('entry_hall'))       === 'assets/themes/roomskins/entry_room_1.png',  'entry_hall → entry_room_1.png')
  ok(roomCardSkinSrc(byId('starter_barracks')) === 'assets/themes/roomskins/barracks_room.png', 'starter_barracks → barracks_room.png')
  ok(roomCardSkinSrc(byId('treasury'))         === 'assets/themes/roomskins/treasure_room_1.png','treasury → treasure_room_1.png')
}

console.log('\n[2] Skinless rooms → null')
{
  ok(roomCardSkinSrc(byId('crypt')) === null, 'crypt (no backgroundImage) → null')
  ok(roomCardSkinSrc({ id: 'x' })   === null, 'def with no backgroundImage → null')
  ok(roomCardSkinSrc(null)          === null, 'null def → null (defensive)')
}

console.log('\n[3] Non-null count equals rooms with a string backgroundImage')
{
  const expected = rooms.filter(r => typeof r.backgroundImage === 'string').length
  const actual   = rooms.filter(r => roomCardSkinSrc(r) !== null).length
  ok(actual === expected, `${actual} skinned cards === ${expected} rooms with backgroundImage`)
}

console.log(fails === 0 ? '\n✅ room-card-skin-check: ALL PASS' : `\n❌ room-card-skin-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tools/sim/room-card-skin-check.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../../src/hud/roomCardSkin.js` (the module doesn't exist yet).

- [ ] **Step 3: Create the helper module**

Create `src/hud/roomCardSkin.js`:

```js
// roomCardSkin — pure mapping from a room definition to its build-menu skin-PNG
// icon URL, or null when the room has no skin (those cards render blank). No DOM
// or Phaser deps, so it is unit-testable headless (tools/sim/room-card-skin-check.mjs).

export function roomCardSkinSrc(def) {
  const skin = def && typeof def.backgroundImage === 'string' ? def.backgroundImage : null
  return skin ? `assets/themes/roomskins/${skin}.png` : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tools/sim/room-card-skin-check.mjs`
Expected: PASS — all three groups green.

- [ ] **Step 5: Commit**

```bash
git add src/hud/roomCardSkin.js tools/sim/room-card-skin-check.mjs
git commit -m "feat: roomCardSkinSrc helper + test for room-card skin icons"
```

---

### Task 2: Rewire BuildMenu room-card icon to the skin PNG; delete dead thumbnail module

Point the room-card icon at the skin PNG (smooth-scaled) for skinned rooms, blank for skinless, and remove the now-unused procedural-thumbnail path and module.

**Files:**
- Modify: `src/hud/BuildMenu.js` (import at line 19; `_cardArt` room branch ~lines 523-546)
- Delete: `src/hud/roomThumbnailCache.js`

**Interfaces:**
- Consumes: `roomCardSkinSrc(def)` from Task 1.

- [ ] **Step 1: Swap the import**

In `src/hud/BuildMenu.js`, replace line 19:

```js
import { getRoomThumbnail } from './roomThumbnailCache.js'
```

with:

```js
import { roomCardSkinSrc } from './roomCardSkin.js'
```

- [ ] **Step 2: Rewrite the room branch of `_cardArt`**

In `src/hud/BuildMenu.js`, replace the entire `if (cat.kind === 'room') { ... }` block (currently ~lines 523-546) with:

```js
    if (cat.kind === 'room') {
      // Use the room's actual skin PNG so the card shows the exact room that
      // will be placed. Rooms with no skin render blank (return null → the
      // bsh-vis slot stays empty; h() skips null children).
      const src = roomCardSkinSrc(def)
      if (!src) return null
      const MAX_W = 120, MAX_H = 64
      const img = document.createElement('img')
      img.style.display = 'block'
      img.style.imageRendering = 'auto'   // smooth downscale — skins are detailed art, not pixel art
      img.style.maxWidth = `${MAX_W}px`; img.style.maxHeight = `${MAX_H}px`
      img.style.width = 'auto'; img.style.height = 'auto'; img.style.objectFit = 'contain'
      img.className = 'qf-snap qf-snap-room'
      img.onerror = () => { img.style.display = 'none' }
      img.src = src
      return img
    }
```

- [ ] **Step 3: Delete the dead thumbnail module**

```bash
git rm src/hud/roomThumbnailCache.js
```

(Confirmed before planning: its only consumer was the `_cardArt` room branch above; `precacheRoomThumbnails`/`clearRoomThumbnailCache` have no callers and `ROOM_THUMBNAIL_READY` has no listener.)

- [ ] **Step 4: Verify no dangling references remain**

Run: `grep -rn "roomThumbnailCache\|getRoomThumbnail\|room-thumbnails" src`
Expected: no matches (the import, the call, and the empty static-asset path are all gone).

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: PASS — including `lint:lint-syntax` (which `node --check`s every `src/**/*.js`, so it would catch a broken import or a reference to the deleted module) and the new `check:room-card-skin`.

- [ ] **Step 6: Verify in Electron (use the qf-verify skill)**

Launch the desktop build, open the construction menu, and confirm (capture a screenshot):
- The 8 skinned rooms (entry hall, barracks, treasury, library of whispers, mimic vault, hall of trials, sanctum, boss chamber if it appears as a card) show their actual room art, aspect-fit within the card, smooth (not blurry-harsh, not blocky).
- The 15 skinless rooms show blank icon areas with intact card text/labels and tidy layout (Steam visual bar).
- No console error referencing `roomThumbnailCache` or a missing asset.

- [ ] **Step 7: Commit**

```bash
git add src/hud/BuildMenu.js
git commit -m "feat: room cards use the skin PNG as their icon; remove dead thumbnail module"
```

---

## Self-Review

**Spec coverage:**
- D1 skinned rooms show skin PNG → Task 1 helper + Task 2 Step 2.
- D2 skinless render blank → Task 2 Step 2 (`return null`).
- D3 smooth scaling → Task 2 Step 2 (`imageRendering = 'auto'`).
- D4 drop old room-thumbnails/getRoomThumbnail paths → Task 2 Steps 1-2, verified Step 4.
- D5 delete dead `roomThumbnailCache.js` → Task 2 Step 3, verified Step 4.
- Verification (npm test, Electron, screenshot) → Task 2 Steps 5-6.

**Placeholder scan:** none — every code/test step shows full content; commands have expected output.

**Type consistency:** `roomCardSkinSrc(def) → string|null` defined in Task 1 Step 3, consumed in Task 2 Step 2 with matching usage (`const src = roomCardSkinSrc(def); if (!src) return null; img.src = src`). Asset path format `assets/themes/roomskins/<skin>.png` identical in the global constraints, the helper, and the Task 1 test assertions.

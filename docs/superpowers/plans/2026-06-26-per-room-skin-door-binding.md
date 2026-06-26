# Per-room-skin door binding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Room Editor bind a specific door skin to a specific room skin in a room's pool, so when that skin rolls on a placed instance, its paired door (entrance + connecting, per closed/open/locked state) shows.

**Architecture:** Mirror the existing `doorSkinByBoss` pattern, keyed by room-skin id instead of boss id (`doorSkinBySkin` / `doorSkinEntranceBySkin` on the room def). One render-resolution change picks the per-skin override first (keyed on the instance's already-rolled `room.backgroundImage`), else falls through to today's chain. The editor surfaces it as one new "Room skin" target dropdown in the existing door tools.

**Tech Stack:** Vanilla ES modules, Phaser 3.88.2 (canvas), DOM HUD. Tests are headless node `tools/sim/*-check.mjs` run by `npm test`; in-game verification via the MCP preview (`preview_eval`) and the Electron build.

## Global Constraints

- GameState/room-def objects must stay JSON-serializable (plain objects only). [from CLAUDE.md]
- Tile size is 32px (`Balance.TILE_SIZE`); never hardcode 32. (Not directly touched here, but applies to any coords.)
- Every commit is gated by the pre-commit hook (`verify-docs` + `lint-content` + `lint-vfx` + `lint-hex`); a broken ref blocks the commit.
- Scope: NON-boss rooms only (rolled skin lives in `room.backgroundImage`). Boss chamber's per-boss skin pools are explicitly out of scope.
- Spec: `docs/superpowers/specs/2026-06-26-per-room-skin-door-binding-design.md`.
- Door size needs no new field — it lives on the door skin in `manifest.json` and is resolved from the winning skin id automatically.

---

### Task 1: Pure door-skin resolver + render wiring

Extract the door-skin id resolution into a pure, testable function that adds the per-skin lookup, and make `DungeonRenderer._roomOwnDoorSkinId` delegate to it. This is the only behavior change; `_doorSkinKeyFor` and `_doorSkinSizeTiles` both call `_roomOwnDoorSkinId`, so texture AND size follow automatically.

**Files:**
- Create: `src/ui/doorSkinResolve.js`
- Create (test): `tools/sim/door-skin-by-skin-check.mjs`
- Modify: `src/ui/DungeonRenderer.js` (the `_roomOwnDoorSkinId` method, currently at lines 719-725; add the import near the other `../ui`/`../systems` imports at the top, ~line 19-20)

**Interfaces:**
- Produces: `resolveDoorSkinId(room, state, opts)` where `opts = { isEntrance?: boolean, boss?: string|null }`, returns a door-skin id string or `null`. Reads only `room.doorSkinEntranceBySkin`, `room.doorSkinEntrance`, `room.doorSkinBySkin`, `room.doorSkinByBoss`, `room.doorSkin`, and `room.backgroundImage`. Pure (no scene/DOM).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `tools/sim/door-skin-by-skin-check.mjs`:

```js
// Headless check for resolveDoorSkinId — the per-room-skin door override
// resolution. Run standalone: `node tools/sim/door-skin-by-skin-check.mjs`
// (also picked up by `npm test`).
import { resolveDoorSkinId } from '../../src/ui/doorSkinResolve.js'

let failures = 0
const eq = (label, got, want) => {
  if (got !== want) { console.error(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); failures++ }
  else console.log(`ok   ${label}`)
}

// A room that rolled skin "sk2", with a per-skin entrance + connecting override,
// plus the existing all-skins fields and a per-boss override.
const room = {
  backgroundImage: 'sk2',
  doorSkin:                 { closed: 'conn_all' },
  doorSkinEntrance:         { closed: 'ent_all' },
  doorSkinByBoss:           { orc: { closed: 'conn_orc' } },
  doorSkinBySkin:           { sk2: { closed: 'conn_sk2' } },
  doorSkinEntranceBySkin:   { sk2: { closed: 'ent_sk2' } },
}

// Per-skin wins for both roles.
eq('entrance per-skin wins',   resolveDoorSkinId(room, 'closed', { isEntrance: true }),  'ent_sk2')
eq('connecting per-skin wins', resolveDoorSkinId(room, 'closed', { isEntrance: false }), 'conn_sk2')

// Rolled skin with NO per-skin entry → falls back to today's chain.
const room2 = { ...room, backgroundImage: 'OTHER' }
eq('entrance fallback to all',   resolveDoorSkinId(room2, 'closed', { isEntrance: true }),  'ent_all')
eq('connecting fallback to boss', resolveDoorSkinId(room2, 'closed', { isEntrance: false, boss: 'orc' }), 'conn_orc')
eq('connecting fallback to all',  resolveDoorSkinId(room2, 'closed', { isEntrance: false }), 'conn_all')

// No backgroundImage at all → identical to legacy behavior.
const legacy = { doorSkin: { open: 'c' }, doorSkinEntrance: { open: 'e' } }
eq('legacy entrance',   resolveDoorSkinId(legacy, 'open', { isEntrance: true }),  'e')
eq('legacy connecting', resolveDoorSkinId(legacy, 'open', { isEntrance: false }), 'c')
eq('missing state → null', resolveDoorSkinId(legacy, 'locked', { isEntrance: true }), null)

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log('\nall passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/sim/door-skin-by-skin-check.mjs`
Expected: FAIL — `Cannot find module '.../src/ui/doorSkinResolve.js'` (the module doesn't exist yet).

- [ ] **Step 3: Create the resolver module**

Create `src/ui/doorSkinResolve.js`:

```js
// Resolve a room's OWN door-skin id for a state (WITHOUT the global default —
// callers add that). Pure: reads only room fields + the passed boss/isEntrance.
//
// Precedence (most specific first):
//   entrance cp:  entranceBySkin[skin] → entrance → connectingBySkin[skin] → byBoss → connecting
//   connecting:   connectingBySkin[skin] → byBoss → connecting
//
// `skin` is the instance's rolled room-skin id (room.backgroundImage); a
// non-boss placed room bakes its pool pick there at placement, so per-skin
// overrides key off it. Rooms with no matching per-skin entry behave exactly
// as before this feature (zero regression).
export function resolveDoorSkinId(room, state, { isEntrance = false, boss = null } = {}) {
  if (!room) return null
  const skin = typeof room.backgroundImage === 'string' ? room.backgroundImage : null
  let id = null
  if (isEntrance) {
    if (skin) id = room.doorSkinEntranceBySkin?.[skin]?.[state] || null
    if (!id)  id = room.doorSkinEntrance?.[state] || null
  }
  if (!id) {
    if (skin) id = room.doorSkinBySkin?.[skin]?.[state] || null
    if (!id)  id = (boss && room.doorSkinByBoss?.[boss]?.[state]) || room.doorSkin?.[state] || null
  }
  return id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/sim/door-skin-by-skin-check.mjs`
Expected: PASS — `all passed`.

- [ ] **Step 5: Wire DungeonRenderer to the resolver**

In `src/ui/DungeonRenderer.js`, add the import next to the existing `../util`/`../systems` imports near the top (e.g. after line 19 `import { carveDoorOpening, ... } from '../util/doorSkinCarve.js'`):

```js
import { resolveDoorSkinId } from './doorSkinResolve.js'
```

Replace the existing method (lines 719-725):

```js
  _roomOwnDoorSkinId(room, state, cp = null) {
    const boss = this._gameState?.player?.bossArchetypeId
    let id = null
    if (this._cpIsEntrance(cp)) id = room.doorSkinEntrance?.[state] || null
    if (!id) id = (boss && room.doorSkinByBoss?.[boss]?.[state]) || room.doorSkin?.[state] || null
    return id
  }
```

with:

```js
  _roomOwnDoorSkinId(room, state, cp = null) {
    return resolveDoorSkinId(room, state, {
      isEntrance: this._cpIsEntrance(cp),
      boss: this._gameState?.player?.bossArchetypeId,
    })
  }
```

- [ ] **Step 6: Run the full gate**

Run: `npm test`
Expected: PASS — all checks green, including `check:door-skin-by-skin`.

- [ ] **Step 7: Commit**

```bash
git add src/ui/doorSkinResolve.js tools/sim/door-skin-by-skin-check.mjs src/ui/DungeonRenderer.js
git commit -m "Door skins: per-room-skin resolution (resolveDoorSkinId) + render wiring"
```

---

### Task 2: Carry the new fields onto live room instances

The renderer reads `doorSkin*` off the room INSTANCE, so the two new fields must be copied def→instance at placement (`DungeonGrid.placeRoom`) and on editor def-reapply (`Game._refreshRoomFromDef`), exactly like `doorSkinByBoss`.

**Files:**
- Modify: `src/systems/DungeonGrid.js` (placeRoom field block, after line 323 `doorSkinByBoss: ...`)
- Modify: `src/scenes/Game.js` (`_refreshRoomFromDef`, after line 776 `room.doorSkinByBoss = ...`)

**Interfaces:**
- Consumes: the field names from Task 1 / the spec (`doorSkinBySkin`, `doorSkinEntranceBySkin`).
- Produces: placed/refreshed room instances that carry both fields, so `resolveDoorSkinId` (Task 1) can read them in-game.

- [ ] **Step 1: Copy fields at placement**

In `src/systems/DungeonGrid.js`, immediately after the `doorSkinByBoss` line (line 322-323):

```js
      doorSkinByBoss: (definition.doorSkinByBoss && typeof definition.doorSkinByBoss === 'object')
                      ? definition.doorSkinByBoss : null,
```

add:

```js
      // Per-room-skin door overrides: { <roomSkinId>: { <state>: skinId } }.
      // Keyed by the instance's rolled room skin (backgroundImage); the
      // renderer (resolveDoorSkinId) checks these first. Connecting + entrance.
      doorSkinBySkin: (definition.doorSkinBySkin && typeof definition.doorSkinBySkin === 'object')
                      ? structuredClone(definition.doorSkinBySkin) : null,
      doorSkinEntranceBySkin: (definition.doorSkinEntranceBySkin && typeof definition.doorSkinEntranceBySkin === 'object')
                      ? structuredClone(definition.doorSkinEntranceBySkin) : null,
```

- [ ] **Step 2: Copy fields on editor def-reapply**

In `src/scenes/Game.js`, in `_refreshRoomFromDef`, immediately after line 776 (`room.doorSkinByBoss = ...`):

```js
    room.doorSkinByBoss  = (def.doorSkinByBoss && typeof def.doorSkinByBoss === 'object') ? def.doorSkinByBoss : null
```

add:

```js
    room.doorSkinBySkin         = (def.doorSkinBySkin && typeof def.doorSkinBySkin === 'object') ? def.doorSkinBySkin : null
    room.doorSkinEntranceBySkin = (def.doorSkinEntranceBySkin && typeof def.doorSkinEntranceBySkin === 'object') ? def.doorSkinEntranceBySkin : null
```

- [ ] **Step 3: Sanity-check the modules parse**

Run: `node -e "import('./src/systems/DungeonGrid.js').then(()=>import('./src/scenes/Game.js')).then(()=>console.log('ok')).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `ok` (Game.js may import Phaser-only deps; if it errors on a browser global rather than a syntax error, instead run `node --check src/scenes/Game.js && node --check src/systems/DungeonGrid.js` and expect no output).

- [ ] **Step 4: Commit**

```bash
git add src/systems/DungeonGrid.js src/scenes/Game.js
git commit -m "Door skins: carry doorSkinBySkin/doorSkinEntranceBySkin onto live room instances"
```

---

### Task 3: Editor — per-room-skin target state, read & write

Add a "room-skin target" axis to the editor's door tools and branch the door-skin read/write through it. Reuses the existing entrance/connecting role (`_doorRoleEntrance`) and state (`_curDoorState`).

**Files:**
- Modify: `src/scenes/RoomTileEditor.js` (add methods near the skin-target block at lines 485-534; edit `_editorDoorSkinId` at 912-920 and `_setDoorSkinId` at 925-942; reset the target in `uiSelectRoom`)

**Interfaces:**
- Produces (called by Task 4's UI): `uiDoorSkinTargets()` → `null | Array<{key, label, thumb?}>`; `uiDoorSkinTarget()` → string (`'__all__'` default); `uiSetDoorSkinTarget(key)`.
- Consumes: `this._activeRoom()`, `this._doorRoleEntrance()`, `this._curDoorState()`, `roomSkinTextureKey`, `this._texThumb` (all existing).

- [ ] **Step 1: Add target state + accessors**

In `src/scenes/RoomTileEditor.js`, after `uiSetDoorRole` / `_doorRoleEntrance` (line 517), add:

```js
  // ── Per-room-skin door target ────────────────────────────────────────────
  // A room with a multi-skin POOL can bind a specific door skin to a specific
  // pool skin. The active target is '__all__' (the room's normal doorSkin /
  // doorSkinEntrance fields) or a room-skin id in the pool. Only non-boss rooms
  // with a 2+ skin pool expose this.
  _roomSkinPool(room) {
    return Array.isArray(room?.backgroundImagePool)
      ? room.backgroundImagePool.filter(s => typeof s === 'string') : []
  }
  uiDoorSkinTargets() {
    if (this._isBossChamber()) return null
    const pool = this._roomSkinPool(this._activeRoom())
    if (pool.length < 2) return null
    return [
      { key: '__all__', label: 'All skins' },
      ...pool.map(id => ({ key: id, label: id, thumb: this._texThumb(roomSkinTextureKey(id)) })),
    ]
  }
  uiDoorSkinTarget() { return this._doorSkinTarget || '__all__' }
  uiSetDoorSkinTarget(key) { this._doorSkinTarget = key || '__all__'; this._refreshAll() }
  _doorSkinTargetActive(room) {
    const t = this.uiDoorSkinTarget()
    return t !== '__all__' && this._roomSkinPool(room || this._activeRoom()).includes(t)
  }
```

- [ ] **Step 2: Reset the target on room switch**

Find `uiSelectRoom` (it already resets editor selection state). Add `this._doorSkinTarget = '__all__'` alongside the existing resets. If `uiSelectRoom` does not currently reset `_doorRole`/`_skinTarget`, add the line at the start of its body:

```js
  uiSelectRoom(/* …existing args… */) {
    this._doorSkinTarget = '__all__'
    // …existing body…
  }
```

- [ ] **Step 3: Branch the WRITE (`_setDoorSkinId`)**

Replace `_setDoorSkinId` (lines 925-942) with a version that handles the per-skin target first (composing with the entrance/connecting role):

```js
  _setDoorSkinId(room, state, id) {
    if (this._doorSkinTargetActive(room)) {
      const skin  = this.uiDoorSkinTarget()
      const field = this._doorRoleEntrance() ? 'doorSkinEntranceBySkin' : 'doorSkinBySkin'
      room[field] = room[field] || {}
      room[field][skin] = room[field][skin] || {}
      if (id) room[field][skin][state] = id
      else delete room[field][skin][state]
      return
    }
    if (this._doorRoleEntrance()) {
      room.doorSkinEntrance = room.doorSkinEntrance || {}
      if (id) room.doorSkinEntrance[state] = id
      else delete room.doorSkinEntrance[state]
      return
    }
    if (this._doorTargetActive(room)) {
      room.doorSkinByBoss = room.doorSkinByBoss || {}
      room.doorSkinByBoss[this._skinTarget] = room.doorSkinByBoss[this._skinTarget] || {}
      if (id) room.doorSkinByBoss[this._skinTarget][state] = id
      else delete room.doorSkinByBoss[this._skinTarget][state]
    } else {
      room.doorSkin = room.doorSkin || {}
      if (id) room.doorSkin[state] = id
      else delete room.doorSkin[state]
    }
  }
```

- [ ] **Step 4: Branch the READ (`_editorDoorSkinId`)**

Replace `_editorDoorSkinId` (lines 912-920) so the modal highlights the right skin for the active target (falling back to the all-skins value so the user sees the effective door):

```js
  _editorDoorSkinId(room, state) {
    if (this._doorSkinTargetActive(room)) {
      const skin  = this.uiDoorSkinTarget()
      const field = this._doorRoleEntrance() ? 'doorSkinEntranceBySkin' : 'doorSkinBySkin'
      const fallback = this._doorRoleEntrance() ? room?.doorSkinEntrance?.[state] : room?.doorSkin?.[state]
      return room?.[field]?.[skin]?.[state] || fallback || null
    }
    if (this._doorRoleEntrance()) {
      return room?.doorSkinEntrance?.[state] || null
    }
    if (this._doorTargetActive(room)) {
      return room.doorSkinByBoss?.[this._skinTarget]?.[state] || room.doorSkin?.[state] || null
    }
    return room?.doorSkin?.[state] || null
  }
```

- [ ] **Step 5: Verify parse**

Run: `node --check src/scenes/RoomTileEditor.js`
Expected: no output (valid syntax).

- [ ] **Step 6: Commit**

```bash
git add src/scenes/RoomTileEditor.js
git commit -m "Room editor: per-room-skin door target — read/write + state"
```

---

### Task 4: Editor UI — the "Room skin" target dropdown

Surface the new target in the Doors tab and the Door-skins modal, and point the door-skin preview at the selected skin's room art.

**Files:**
- Modify: `src/hud/RoomEditorOverlay.js` (the doors panel `_doorsPanel`, lines 494-544; the door-skins modal state-selector area, lines 1062-1066; the preview box `_doorSkinPreviewBox` call near 1106)

**Interfaces:**
- Consumes: `this.scene.uiDoorSkinTargets()`, `this.scene.uiDoorSkinTarget()`, `this.scene.uiSetDoorSkinTarget(key)` (Task 3); existing `this.scene.uiCurrentRoomSkin()` / skin-thumb helpers for the preview.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the dropdown to the Doors panel**

In `_doorsPanel(s)` (lines 494-544), directly above the "Door state" segmented control (the `_segment(DOOR_STATES…)` block around line 514-516), insert a target selector that renders only when targets exist:

```js
      ...(this.scene.uiDoorSkinTargets?.() ? [
        h('span', { className: 'qf-redit__field-label' }, 'Room skin'),
        h('select', {
          className: 'qf-themes__theme-sel',
          on: { change: (e) => this.scene.uiSetDoorSkinTarget?.(e.target.value) },
        }, this.scene.uiDoorSkinTargets().map(t =>
          h('option', { value: t.key, selected: t.key === this.scene.uiDoorSkinTarget() }, t.label))),
      ] : []),
```

(Use the spread-into-array form so it cleanly contributes zero nodes when `uiDoorSkinTargets()` is null. Match the surrounding `h(...)` children syntax of `_doorsPanel`.)

- [ ] **Step 2: Add the same dropdown to the Door-skins modal**

In `_renderDoorSkins()`, next to the existing State `<select>` (lines 1062-1066), add an adjacent room-skin `<select>` with the same options, so the modal can switch target without leaving it:

```js
        ...(this.scene.uiDoorSkinTargets?.() ? [
          h('span', { className: 'qf-skins__roomnote' }, '·  Room skin:'),
          h('select', {
            className: 'qf-themes__theme-sel',
            on: { change: (e) => { this.scene.uiSetDoorSkinTarget?.(e.target.value); this._renderDoorSkins() } },
          }, this.scene.uiDoorSkinTargets().map(t =>
            h('option', { value: t.key, selected: t.key === this.scene.uiDoorSkinTarget() }, t.label))),
        ] : []),
```

- [ ] **Step 3: Point the preview background at the selected skin**

The door-skin preview (`_doorSkinPreviewBox(curThumb, bgThumb, roomW, roomH)`, called ~line 1106) takes a `bgThumb` for the room background. When a specific room-skin target is active, pass that skin's thumbnail instead of the room's default. Where `bgThumb` is computed for that call, replace its source with:

```js
        // When a specific pool skin is the door target, preview the pairing on
        // THAT skin's room art; else the room's current/default skin.
        const _dsTarget = this.scene.uiDoorSkinTarget?.()
        const _bgSkinId = (_dsTarget && _dsTarget !== '__all__') ? _dsTarget : this.scene.uiCurrentRoomSkin?.()
        const bgThumb = _bgSkinId ? this.scene.uiRoomSkinThumb?.(_bgSkinId) : null
```

If no `uiRoomSkinThumb(id)` helper exists, add this one-liner to `RoomTileEditor.js` next to `uiListRoomSkins` (line 482):

```js
  uiRoomSkinThumb(id) { return id ? this._texThumb(roomSkinTextureKey(id)) : null }
```

- [ ] **Step 4: Verify parse**

Run: `node --check src/hud/RoomEditorOverlay.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/hud/RoomEditorOverlay.js src/scenes/RoomTileEditor.js
git commit -m "Room editor: Room-skin door-target dropdown + paired preview"
```

---

### Task 5: Persistence — save serialization + undo

Persist the two new fields to `rooms.json`, prune empties (and entries whose skin id left the pool), and capture them in the editor undo snapshot.

**Files:**
- Modify: `src/scenes/RoomTileEditor.js` (the `_save()` `cleaned` block, around lines 2672-2691 where `doorSkin`/`doorSkinByBoss` are pruned; `_snapshotRoom` at 416-420 and the undo restore at 457-461)

**Interfaces:**
- Consumes: `pruneSkinByBoss(map)` — the existing local helper in `_save` that returns a pruned `{key:{state:id}}` map or null (used for `doorSkinByBoss`); the new fields share that exact shape.
- Produces: `rooms.json` defs carrying `doorSkinBySkin`/`doorSkinEntranceBySkin`; undo that restores them.

- [ ] **Step 1: Capture in the undo snapshot**

In `_snapshotRoom` (after line 420, `doorSkinSizeEntrance: …`), add:

```js
      doorSkinBySkin:         room.doorSkinBySkin ? structuredClone(room.doorSkinBySkin) : null,
      doorSkinEntranceBySkin: room.doorSkinEntranceBySkin ? structuredClone(room.doorSkinEntranceBySkin) : null,
```

In the undo restore block (after line 461, `room.doorSkinSizeEntrance = snap.doorSkinSizeEntrance`), add:

```js
      room.doorSkinBySkin         = snap.doorSkinBySkin
      room.doorSkinEntranceBySkin = snap.doorSkinEntranceBySkin
```

- [ ] **Step 2: Serialize + prune in `_save()`**

In `_save()`, just after the `doorSkinByBoss` prune (the `const dsb = pruneSkinByBoss(r.doorSkinByBoss); if (dsb) cleaned.doorSkinByBoss = dsb; else delete cleaned.doorSkinByBoss` lines, ~2688-2690), add — pruning per-skin entries whose skin id is no longer in the pool, then dropping empties via the shared helper:

```js
        // Per-room-skin door overrides: drop entries whose skin left the pool,
        // then prune empty state-maps (reuses pruneSkinByBoss — same shape).
        const _pool = new Set(Array.isArray(r.backgroundImagePool) ? r.backgroundImagePool : [])
        const pruneBySkin = (m) => {
          if (!m || typeof m !== 'object') return null
          const kept = {}
          for (const [skin, states] of Object.entries(m)) if (_pool.has(skin)) kept[skin] = states
          return pruneSkinByBoss(kept)
        }
        const dbs = pruneBySkin(r.doorSkinBySkin)
        if (dbs) cleaned.doorSkinBySkin = dbs; else delete cleaned.doorSkinBySkin
        const debs = pruneBySkin(r.doorSkinEntranceBySkin)
        if (debs) cleaned.doorSkinEntranceBySkin = debs; else delete cleaned.doorSkinEntranceBySkin
```

(If `pruneSkinByBoss` is defined as a module-level/local function not in `_save`'s scope, call it where it's reachable — it is already called for `doorSkinByBoss` in this same block, so the same scope applies.)

- [ ] **Step 3: Verify parse**

Run: `node --check src/scenes/RoomTileEditor.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/RoomTileEditor.js
git commit -m "Room editor: persist + undo per-room-skin door overrides"
```

---

### Task 6: lint-content — validate the new door-skin refs

Catch a dangling door-skin id in the new fields at commit time. New fields only (no risk of failing on pre-existing data).

**Files:**
- Modify: `tools/lint-content.mjs` (add a check that reads `manifest.json` doorSkins and validates every `doorSkinBySkin`/`doorSkinEntranceBySkin` ref in `rooms.json`)

**Interfaces:**
- Consumes: the lint harness's `data(path)` loader + `WARN(tag, msg)` / error helpers already used in the file (see the class-sprites check ~line 198-219 for the pattern: load a manifest, iterate content, report).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the validation check**

In `tools/lint-content.mjs`, mirroring the existing manifest-backed checks, add a function that loads the door-skins registry from `assets/themes/manifest.json` and flags any room whose `doorSkinBySkin`/`doorSkinEntranceBySkin` references an id not in that registry. Use the file's existing error reporter (the same one that makes a dangling pact/evolution ref fail the commit) so a typo blocks the commit:

```js
// Per-room-skin door overrides must reference a door skin that exists in the
// theme manifest. (New fields only — keyed by room-skin id → { state: id }.)
function checkDoorSkinBySkinRefs() {
  let doorSkins = {}
  try { doorSkins = (data('../assets/themes/manifest.json')?.doorSkins) ?? {} }
  catch { return }  // no manifest in this context → skip (matches class-sprites guard)
  const rooms = data('../src/data/rooms.json') ?? []
  for (const r of rooms) {
    for (const field of ['doorSkinBySkin', 'doorSkinEntranceBySkin']) {
      const m = r?.[field]
      if (!m || typeof m !== 'object') continue
      for (const [skin, states] of Object.entries(m)) {
        for (const id of Object.values(states || {})) {
          if (id && !(id in doorSkins)) {
            ERR('door-skin-by-skin', `room "${r.id}" ${field}["${skin}"] → "${id}" is not a door skin in manifest.json`)
          }
        }
      }
    }
  }
}
```

Then register `checkDoorSkinBySkinRefs()` in the file's run sequence alongside the other checks. **Match the exact local names** the file uses: if the error helper is named `ERR`/`error`/`fail` and the loader `data`/`load`/`readJson`, use those — read the top of `tools/lint-content.mjs` first and adapt the two identifiers (`ERR`, `data`) to the real ones.

- [ ] **Step 2: Run the linter on clean data**

Run: `npm run lint-content`
Expected: PASS (no rooms reference the new fields yet, so no errors).

- [ ] **Step 3: Prove it catches a bad ref (temporary)**

Temporarily add `"doorSkinBySkin": { "entry_room_1": { "closed": "NOPE_does_not_exist" } }` to the `entry_hall` def in `src/data/rooms.json`, then run `npm run lint-content`.
Expected: FAIL — `door-skin-by-skin: room "entry_hall" doorSkinBySkin["entry_room_1"] → "NOPE_does_not_exist" is not a door skin in manifest.json`. Then **revert** the temporary edit and re-run to confirm PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/lint-content.mjs
git commit -m "lint-content: validate per-room-skin door-skin refs resolve"
```

---

### Task 7: Integration verification

Confirm the whole feature end-to-end in the running game (renderer-level + visual), since renderer methods aren't unit-testable headless.

**Files:** none (verification only).

- [ ] **Step 1: Full regression gate**

Run: `npm test`
Expected: PASS — all checks green incl. `check:door-skin-by-skin`, all four linters.

- [ ] **Step 2: Renderer-level integration check (preview)**

Start/确认 the preview server (`preview_start` name `quest-failed`), then in `preview_eval` import the live modules and assert resolution against a synthetic room (reliable; not a flaky screenshot):

```js
(async () => {
  const base = location.origin + '/src/';
  const { resolveDoorSkinId } = await import(base + 'ui/doorSkinResolve.js?v=' + Math.floor(performance.now()));
  const room = {
    backgroundImage: 'sk2',
    doorSkin: { closed: 'conn_all' },
    doorSkinEntrance: { closed: 'ent_all' },
    doorSkinBySkin: { sk2: { closed: 'conn_sk2' } },
    doorSkinEntranceBySkin: { sk2: { closed: 'ent_sk2' } },
  };
  return {
    entrance: resolveDoorSkinId(room, 'closed', { isEntrance: true }),   // expect 'ent_sk2'
    connecting: resolveDoorSkinId(room, 'closed', { isEntrance: false }), // expect 'conn_sk2'
    fallback: resolveDoorSkinId({ ...room, backgroundImage: 'x' }, 'closed', { isEntrance: true }), // expect 'ent_all'
  };
})()
```

Expected: `{ entrance: 'ent_sk2', connecting: 'conn_sk2', fallback: 'ent_all' }`.

- [ ] **Step 3: Editor + in-game eyeball (Electron)**

In the Electron build (per the qf-verify skill): open the Room Editor on a room with a 2+ skin pool (e.g. give `entry_hall` two pool skins), confirm the "Room skin" dropdown appears, assign a distinct entrance door skin to skin A vs skin B, save (writes rooms.json + emits ROOMS_ALL_RESET), then place multiple Entry Halls until both pool skins roll and confirm each shows its paired entrance door. Capture a screenshot as proof.

- [ ] **Step 4: Final doc sync (if a content count changed)**

If this added/removed any tracked content counts, run `npm run verify-docs:fix`. (This feature adds no rooms/minions/etc., so expect no change — but run `npm run verify-docs` to confirm clean.)

- [ ] **Step 5: Commit (only if Step 4 changed anything)**

```bash
git add -A && git commit -m "Docs: sync after per-room-skin door binding"
```

---

## Self-review notes

- **Spec coverage:** data model → Task 2/5; render resolution → Task 1; editor UI → Task 4; editor read/write/target → Task 3; plumbing (placeRoom + reapply) → Task 2; save/prune + undo → Task 5; lint → Task 6; edge cases (fallback, prune-removed-pool-skin) → Task 1 test + Task 5 prune; verification → Task 7. All covered.
- **Type consistency:** field names `doorSkinBySkin` / `doorSkinEntranceBySkin`, target sentinel `'__all__'`, and helpers `resolveDoorSkinId` / `uiDoorSkinTargets` / `uiDoorSkinTarget` / `uiSetDoorSkinTarget` / `_doorSkinTargetActive` / `_roomSkinPool` are used identically across tasks.
- **Known caveat (not a blocker):** `Game._refreshRoomFromDef` resets `room.backgroundImage` to `def.backgroundImage` on editor def-reapply (existing behavior, pre-dates this feature). Normal gameplay (placeRoom rolls + persists) is unaffected; only an editor live-reapply could transiently show pool[0]'s door. Out of scope; noted for the implementer.

# Room cards use the skin PNG as their icon — design (LOCKED 2026-06-26)

Make the construction (build) menu's room cards show each room's actual **skin
PNG** as the icon, so the player sees the exact room they're about to place.

## Goal (user intent)

> "In the construction build menu, I want the room icons to use the skin PNG as
> the icon for the room so the player sees the exact room they are going to place."

## Current state (verified against code)

- Room-card icons are built in `src/hud/BuildMenu.js`, the `cat.kind === 'room'`
  branch (~lines 523-546). It currently: sets `img.src =
  assets/ui/room-thumbnails/<id>.png`; on error falls back to a procedural
  themesprite thumbnail from `getRoomThumbnail(def.id)` (`roomThumbnailCache.js`);
  if that's null too, hides the icon.
- **In practice every room card is blank today:** `src/assets/ui/room-thumbnails/`
  is **empty** (0 files → the static src always 404s), and
  `precacheRoomThumbnails` is **never called** anywhere → the procedural cache is
  always empty → `getRoomThumbnail` always returns `null` → the icon is hidden.
- **Room skins:** 8 of 23 rooms define a single `backgroundImage` skin id in
  `src/data/rooms.json` (e.g. `entry_hall → entry_room_1`, `starter_barracks →
  barracks_room`, `treasury → treasure_room_1`, `library_of_whispers → library`,
  `mimic_vault → mimc_room`, `hall_of_trials → 12x12`, `sanctum → 12x12_3`,
  `boss_chamber → basic_boss_room`). **0 rooms** use the random per-boss pool
  (`backgroundImagePoolByBoss`), so the skin is deterministic. The 15 other rooms
  have no skin.
- All 8 skin PNGs exist at `src/assets/themes/roomskins/<skinId>.png`. The web/app
  root serves from `src/`, so the load URL is `assets/themes/roomskins/<skinId>.png`
  (matches `DungeonRenderer`'s default skin path and the existing build-menu
  `assets/ui/...` URL convention).

## Locked decisions

- **D1 — Skinned rooms show their skin PNG.** A room whose def has a string
  `backgroundImage` gets a card icon of `assets/themes/roomskins/<backgroundImage>.png`.
- **D2 — Skinless rooms render blank.** No image, just the card's text/label.
  (This is already how all cards look today, so it is not a regression.)
- **D3 — Smooth scaling.** The skin icon uses smooth (bilinear) downscaling
  (`image-rendering: auto`), NOT the current `pixelated` — several skins are
  detailed/AI art at ~512px and look harsh under nearest-neighbour. This matches
  how skins are scaled in-game.
- **D4 — Drop the old room paths.** For rooms, remove the
  `assets/ui/room-thumbnails/<id>.png` static src and the procedural
  `getRoomThumbnail` fallback. Skin-or-blank only.
- **D5 — Delete the dead thumbnail module.** `src/hud/roomThumbnailCache.js`
  becomes fully unreferenced after D4 (its only consumer is this branch; its
  `precacheRoomThumbnails`/`clearRoomThumbnailCache` exports have no callers and
  its `ROOM_THUMBNAIL_READY` event has no listener). Delete the file and its
  import in `BuildMenu.js`.

## Architecture & components

Single touch point: the room-card icon builder in `src/hud/BuildMenu.js`.

New `cat.kind === 'room'` behavior:
1. Read `const skin = (typeof def.backgroundImage === 'string') ? def.backgroundImage : null`.
2. If `skin`:
   - Create `<img>` with `src = assets/themes/roomskins/${skin}.png`.
   - Style: `display:block`, `image-rendering:auto` (smooth, D3), `max-width:120px`,
     `max-height:64px`, `width/height:auto`, `object-fit:contain`; class
     `qf-snap qf-snap-room`.
   - `img.onerror` → hide the icon (`img.style.display = 'none'`) — defensive only.
   - Return the `<img>`.
3. Else (no skin) → return blank: an empty/hidden element (no image), so only the
   card text shows. (Match whatever the existing "no icon" return is — e.g. a
   hidden `<img>` or the `fallback` empty node — so card layout is unchanged.)

Remove from this branch: the `room-thumbnails` static src, the `getRoomThumbnail`
canvas fallback, and (file-level) the `getRoomThumbnail` import. Then delete
`src/hud/roomThumbnailCache.js`.

## Data flow

Build menu renders a room card → icon builder reads `def.backgroundImage` →
either an `<img>` pointed at the skin PNG (already preloaded as a Phaser texture,
but here loaded fresh by the browser via the same on-disk asset) or a blank node.
No game-state, no async cache, no events.

## What is explicitly NOT changing

- The 15 skinless rooms' appearance (blank, same as today).
- In-game room rendering (`DungeonRenderer` skins/`_drawRoomSkins`) — untouched.
- Trap/item/minion card icons — untouched.
- Room skin data (`rooms.json` `backgroundImage`) — read-only here.

## Verification plan

- `npm test` green (includes `lint-syntax` over all src; ensures the BuildMenu
  edit and the deleted import leave no broken reference).
- Electron (primary surface): open the construction menu and confirm —
  - the 8 skinned rooms show their actual room art, correctly aspect-fit and not
    blurry/harsh (smooth scaling reads clean);
  - the 15 skinless rooms show blank icons with intact card text/layout;
  - no console error from the removed `roomThumbnailCache` import or a missing
    asset; the cards line up tidily (Steam visual bar).
  - Screenshot the build menu as proof.

## Risks / verify on screen

- Skin aspect ratios vary; confirm `object-fit: contain` within 120×64 keeps every
  card tidy (no overflow, no distortion).
- Smooth vs pixelated is a judgment call per-asset — verify the detailed skins
  read clean at icon size; if any specific skin looks bad, note it (don't silently
  switch the global rule).
- Confirm `roomThumbnailCache.js` deletion breaks nothing else (grep confirmed no
  other consumer, but the `lint-syntax`/test gate + an Electron boot confirm it).

# Remove the rotate option for rooms — design (LOCKED 2026-06-26)

Players can no longer rotate a room while placing it. Rooms always go down in
their default orientation. Trap rotation and the minion-roster key are untouched.

## Goal (user intent)

> "Remove the rotate option for rooms."

## Scope decision

Remove only the player-facing rotate **option** for rooms — not the underlying
rotation machinery. The rotation plumbing (`getRotatedDef`, the per-room
`rotation` field, the MOVE-tool rotation handling) stays, because:
- Traps still rotate and share the same key.
- Any room already placed/saved with a non-zero rotation keeps rendering as-is
  (grandfathered). New rooms are always placed at rotation 0 because `_rotation`
  is never advanced for rooms.

This avoids a large, risky rewrite for no functional gain.

## The three changes (all in `src/scenes/NightPhase.js`)

1. **R key (the `keydown` handler, ~line 1834-1854):** remove the
   `if (this._selectedKind === 'room') { this._rotation = (this._rotation + 90) % 360; ... }`
   branch. R then does nothing while a room is held; it still rotates a held trap
   (the `else if (this._selectedKind === 'trap' ...)` branch) and still opens the
   Minion Roster when nothing is held. `_rotation` therefore stays 0 for rooms, so
   rooms always place un-rotated.
2. **Room placement ghost label (~line 2145-2151):** remove the block that shows
   the floating `[R] ROTATE` label over a room being placed (set `_rotLabel`
   hidden instead). The trap ghost's own `[R] ROTATE` label (~line 2028, guarded
   by `def.rotatable`) is unchanged.
3. **Bottom help text (~line 1469):** change the `R = rotate room` part to
   `R = rotate trap` (R still rotates traps).

## What is explicitly NOT changing

- Trap rotation (R key + `[R] ROTATE` label for traps).
- The minion-roster contextual R binding.
- `getRotatedDef`, the room `rotation` field, save format, MOVE-tool rotation
  restore — all stay; new rooms simply always use rotation 0.
- In-game rendering of any already-rotated saved room.

## Verification

- `npm test` stays green (includes the syntax lint over all `src`).
- Electron: open the build menu, pick a room, press R → it does NOT rotate and no
  `[R] ROTATE` prompt shows. Pick a trap, press R → it still rotates. Place a room
  → it lands in its normal orientation. Bottom hint reads "rotate trap".

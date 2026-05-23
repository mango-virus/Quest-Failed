// Shared room-rotation helpers.
//
// Rooms in Quest-Failed can be placed at 0°/90°/180°/270° rotation. The
// rotated form is what gets stored on the room instance (width/height
// swapped, tileLayout grid rotated, connectionPoints rotated). Two paths
// need to perform the same rotation:
//
//   1. NightPhase placement — applies the player-chosen rotation at the
//      moment a room is dropped into the dungeon.
//   2. Game.js load-time reapplication — when a save is continued we
//      re-derive each placed room's tile grid from its current JSON def
//      (so Room-Builder edits flow through, and to repair saves with
//      void-filled tile arrays). The reapplied def MUST be rotated to
//      match the saved `room.rotation`, otherwise the unrotated layout
//      gets stamped onto a rotated footprint and the visible result is
//      a mismatched / patchy overlay sprite grid.
//
// These helpers used to live as private functions inside NightPhase.js;
// they're factored out here so both call sites stay in lock-step on the
// exact rotation math. (Decorations and tile-override `tiles` arrays are
// intentionally NOT rotated — matches the legacy NightPhase._getRotatedDef
// behaviour. Changing that would be a separate piece of work.)

import { ThemeManager, spriteCoverage } from '../systems/ThemeManager.js'

// Rotate a single tileLayout cell entry 90° CW. Strings become {id, rot:90};
// objects keep flipH/flipV and have their per-cell rot incremented.
export function rotateCellEntryCW(cell) {
  if (cell == null) return null
  if (typeof cell === 'string') return { id: cell, rot: 90 }
  if (typeof cell === 'object' && typeof cell.id === 'string') {
    const rot = (((cell.rot ?? 0) + 90) % 360 + 360) % 360
    const out = { id: cell.id, rot }
    if (cell.flipH) out.flipH = true
    if (cell.flipV) out.flipV = true
    return out
  }
  return null
}

// Rotate a tileLayout 2D array 90° CW. layout is indexed [ry][rx] for a
// room of (oldW × oldH); the result is indexed for (oldH × oldW).
//
// Sprites with coverage > 1 anchor at the top-left of a cov×cov block;
// the other cov*cov - 1 cells are null. CW rotation moves the block such
// that the original (ox, oy) anchor's new TL is at
//   newX = oldH - cov - oy,  newY = ox.
// We walk the source layout and place each anchor at its new TL — non-
// anchor null cells in the source need no work since the result grid
// starts fully null.
export function rotateTileLayoutCW(layout, oldW, oldH) {
  const newW = oldH
  const newH = oldW
  const out = Array.from({ length: newH }, () => new Array(newW).fill(null))
  for (let oy = 0; oy < oldH; oy++) {
    const row = Array.isArray(layout?.[oy]) ? layout[oy] : null
    if (!row) continue
    for (let ox = 0; ox < oldW; ox++) {
      const cell = row[ox]
      if (cell == null) continue
      const id  = (typeof cell === 'string') ? cell : cell.id
      const cov = Math.max(1, spriteCoverage(ThemeManager.getSprite(id)) || 1)
      const newX = oldH - cov - oy
      const newY = ox
      if (newY < 0 || newY >= newH || newX < 0 || newX >= newW) continue
      out[newY][newX] = rotateCellEntryCW(cell)
    }
  }
  return out
}

// Rotate a connection point (cx, cy, direction) by `steps` × 90° CW within
// a room originally (w × h). w and h swap each step.
export function rotateCP(cp, w, h, steps) {
  const DIR_CW = { N: 'E', E: 'S', S: 'W', W: 'N' }
  let { x, y, direction } = cp
  for (let i = 0; i < steps; i++) {
    const nx = h - 1 - y
    const ny = x
    x = nx; y = ny
    direction = DIR_CW[direction] ?? direction
    const tmp = w; w = h; h = tmp
  }
  return { ...cp, x, y, direction }
}

// Return a copy of `def` with width/height swapped (as needed), tileLayout
// rotated, and connectionPoints rotated. `rotation` is in degrees (0, 90,
// 180, 270). Rotation 0 / falsy returns the def untouched.
//
// Mirrors the long-standing NightPhase._getRotatedDef behaviour. Other
// def fields (decorations, doorTiles, tiles, theme, colorAdjust, …) are
// preserved unchanged via the spread.
export function getRotatedDef(def, rotation) {
  const steps = (((rotation ?? 0) / 90) % 4 + 4) % 4
  if (steps === 0) return def
  const w = steps % 2 === 0 ? def.width  : def.height
  const h = steps % 2 === 0 ? def.height : def.width
  const connectionPoints = (def.connectionPoints ?? []).map(cp =>
    rotateCP(cp, def.width, def.height, steps)
  )
  let layout = Array.isArray(def.tileLayout) ? def.tileLayout : []
  let lw = def.width, lh = def.height
  for (let i = 0; i < steps; i++) {
    layout = rotateTileLayoutCW(layout, lw, lh)
    const tmp = lw; lw = lh; lh = tmp
  }
  return { ...def, width: w, height: h, connectionPoints, tileLayout: layout }
}

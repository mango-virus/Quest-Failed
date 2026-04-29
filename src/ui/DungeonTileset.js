// Dungeon tileset — autotile helpers for the per-cell sprite renderer.
//
// Each TILE enum value resolves to a Phaser texture key loaded by
// Preload.js.  Walls additionally run through pickWallKey(), which
// inspects the four orthogonal neighbours and returns one of:
//
//   tile-WALL                regular flat top wall (room is below)
//   tile-WALL_BOTTOM         flat bottom wall (room is above)
//   tile-WALL_L              flat left wall (room is to the right)
//   tile-WALL_R              flat right wall (room is to the left)
//   tile-WALL_CORNER_TL/TR/BL/BR   outer corners
//
// Caps (tile-WALL_CAP) are spawned in the cell ABOVE any wall whose
// neighbour above isn't also a wall — gives the back wall its tall
// silhouette without making walls multi-tile in the data.
//
// Corridor and boss-chamber walls currently share the regular room
// texture set; when those tile assets land we'll add separate key sets
// and dispatch on tile type.

import { TILE } from '../systems/DungeonGrid.js'

// Texture keys (must match the load.image() keys in Preload.js)
export const TILE_KEYS = {
  FLOOR:             'tile-FLOOR',
  WALL:              'tile-WALL',
  WALL_CAP:          'tile-WALL_CAP',
  WALL_BOTTOM:       'tile-WALL_BOTTOM',
  WALL_L:            'tile-WALL_L',
  WALL_R:            'tile-WALL_R',
  WALL_CORNER_TL:    'tile-WALL_CORNER_TL',
  WALL_CORNER_TR:    'tile-WALL_CORNER_TR',
  WALL_CORNER_BL:    'tile-WALL_CORNER_BL',
  WALL_CORNER_BR:    'tile-WALL_CORNER_BR',
}

const WALL_TILE_TYPES  = new Set([TILE.WALL, TILE.BOSS_WALL])
const FLOOR_TILE_TYPES = new Set([TILE.FLOOR, TILE.BOSS_FLOOR, TILE.DOOR])

export function isWallType(t)  { return WALL_TILE_TYPES.has(t) }
export function isFloorType(t) { return FLOOR_TILE_TYPES.has(t) }

// Resolve a tile enum + position to the texture key that should render
// at that cell.  Returns null for VOID / unknown tiles (renderer skips
// them, dark background shows through).
export function pickTileKey(tiles, x, y) {
  const t = tiles[y]?.[x]
  if (t == null || t === TILE.VOID) return null
  if (t === TILE.WALL_CAP)          return TILE_KEYS.WALL_CAP
  if (FLOOR_TILE_TYPES.has(t))      return TILE_KEYS.FLOOR
  if (WALL_TILE_TYPES.has(t))       return pickWallKey(tiles, x, y)
  return null
}

// Pick the wall variant rendered at cell (x, y).  Top corners (S+E and
// S+W patterns) now return the SIDE-WALL texture so the corner column
// reads as a continuous left/right side wall.  The actual corner-curve
// art is rendered as a cap one row above (see pickCapKey) — that's how
// we get the corner to line up with the cap row instead of sitting one
// tile too low.
export function pickWallKey(tiles, x, y) {
  const isWall  = (tx, ty) => WALL_TILE_TYPES.has(tiles[ty]?.[tx])
  const isFloor = (tx, ty) => FLOOR_TILE_TYPES.has(tiles[ty]?.[tx])
  const N = isWall(x, y - 1)
  const S = isWall(x, y + 1)
  const E = isWall(x + 1, y)
  const W = isWall(x - 1, y)

  // Top corners — render as the side-wall continuation at the wall row.
  if (S && E && !N && !W) return TILE_KEYS.WALL_L          // top-left → left side wall
  if (S && W && !N && !E) return TILE_KEYS.WALL_R          // top-right → right side wall
  // Bottom corners stay as their own corner sprite (no cap above them).
  if (N && E && !S && !W) return TILE_KEYS.WALL_CORNER_BL
  if (N && W && !S && !E) return TILE_KEYS.WALL_CORNER_BR

  // Horizontal wall — pick top vs bottom by which side the room is on.
  if (E && W) {
    if (isFloor(x, y + 1)) return TILE_KEYS.WALL          // room below → top edge
    if (isFloor(x, y - 1)) return TILE_KEYS.WALL_BOTTOM   // room above → bottom edge
    return TILE_KEYS.WALL
  }

  // Vertical wall — pick left vs right by which side the room is on.
  if (N && S) {
    if (isFloor(x + 1, y)) return TILE_KEYS.WALL_L        // room to right → left edge
    if (isFloor(x - 1, y)) return TILE_KEYS.WALL_R        // room to left → right edge
    return TILE_KEYS.WALL_L
  }

  // Single-neighbour or isolated wall — fall back to flat top.
  return TILE_KEYS.WALL
}

// Pick the cap texture to draw ONE ROW ABOVE a top-edge wall cell.
// Returns null when no cap should be drawn (cell isn't a wall, the row
// above is also a wall, or the wall isn't part of the room's top edge).
//   • Top corners get their proper corner-curve sprite — that puts the
//     corner art at the cap row, integrated with the back-wall silhouette.
//   • Top mid-walls (E+W neighbours both walls) get the flat brick cap.
//   • Bottom corners and side walls get nothing (cell above already wall).
export function pickCapKey(tiles, x, y) {
  const t = tiles[y]?.[x]
  if (!WALL_TILE_TYPES.has(t)) return null
  if (y === 0) return null
  const above = tiles[y - 1]?.[x] ?? TILE.VOID
  if (WALL_TILE_TYPES.has(above)) return null
  // Don't double-cap if the designer authored an explicit cap one row up.
  if (above === TILE.WALL_CAP) return null

  const isWall  = (tx, ty) => WALL_TILE_TYPES.has(tiles[ty]?.[tx])
  const isFloor = (tx, ty) => FLOOR_TILE_TYPES.has(tiles[ty]?.[tx])
  const N = isWall(x, y - 1)
  const S = isWall(x, y + 1)
  const E = isWall(x + 1, y)
  const W = isWall(x - 1, y)

  // Top corners — corner-curve sprite at the cap row.
  if (S && E && !N && !W) return TILE_KEYS.WALL_CORNER_TL
  if (S && W && !N && !E) return TILE_KEYS.WALL_CORNER_TR
  // Horizontal mid-wall — only cap when this is a TOP edge (room below).
  // For bottom walls (room above) the cell above is the room interior,
  // and dropping a brick cap there leaves a stripe of bricks across the
  // floor's bottom row.
  if (E && W && isFloor(x, y + 1)) return TILE_KEYS.WALL_CAP
  return null
}

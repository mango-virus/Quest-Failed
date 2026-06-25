// roomPorts — shared helper for room-aura VFX (Armory / Sanctum / Veil /
// Watchtower). Returns the WORLD-space door "ports" of a room that lead to an
// active, matched neighbour (the same door-connected set DungeonGrid's
// getNeighborRooms uses), so a renderer can stream a glow / motes / mist /
// beam OUT through each connected doorway and the player sees the coverage.
//
// Each port: { x, y, dx, dy, neighbor } where (x,y) is the door-tile world
// centre and (dx,dy) is the outward unit direction (into the neighbour).

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE
const DIR_VEC = { N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 }, E: { dx: 1, dy: 0 }, W: { dx: -1, dy: 0 } }
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' }

export function connectedDoorPorts(room, grid, opts = {}) {
  if (!room || !grid?.getRoomAtTile) return []
  const exclude = opts.excludeDefs ?? []
  const ports = []
  for (const cp of room.connectionPoints ?? []) {
    if (cp.external) continue
    const v = DIR_VEC[cp.direction]
    if (!v) continue
    const dtx = room.gridX + cp.x            // door tile (on the room wall)
    const dty = room.gridY + cp.y
    const ox = dtx + 2 * v.dx                 // across the gap to the neighbour's wall
    const oy = dty + 2 * v.dy
    const other = grid.getRoomAtTile(ox, oy)
    if (!other || other.instanceId === room.instanceId || other.isActive === false) continue
    // Confirm the neighbour faces back at us (mirrors getNeighborRooms).
    const opp = OPP[cp.direction]
    const matched = (other.connectionPoints ?? []).some(ocp =>
      !ocp.external && ocp.direction === opp &&
      other.gridX + ocp.x === ox && other.gridY + ocp.y === oy)
    if (!matched) continue
    if (exclude.includes(other.definitionId)) continue
    ports.push({
      x: (dtx + 0.5) * TS,
      y: (dty + 0.5) * TS,
      dx: v.dx, dy: v.dy,
      neighbor: other,
    })
  }
  return ports
}

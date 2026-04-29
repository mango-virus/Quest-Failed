// Basic A* pathfinder on the tile grid.
// Phase 4: uniform tile costs, no knowledge weights yet (those come in Phase 8).
// Returns array of { x, y } waypoints from start (exclusive) to end (inclusive),
// or null if no path exists.

import { TILE } from './DungeonGrid.js'

const WALKABLE = new Set([
  TILE.FLOOR,
  TILE.BOSS_FLOOR,
  TILE.DOOR,
])

export class PathfinderSystem {
  /**
   * Standard A* with Manhattan heuristic.
   * Phase 8: optional `costFn(tx, ty)` lets callers add per-tile multipliers
   * (e.g. KnowledgeSystem.costMultiplierForTile so adventurers route around
   * traps they know about).
   *
   * @param {{x:number,y:number}} start
   * @param {{x:number,y:number}} end
   * @param {DungeonGrid} dungeonGrid
   * @param {(tx:number, ty:number) => number} [costFn] returns multiplier (default 1)
   * @returns {Array<{x:number,y:number}> | null}
   */
  static findPath(start, end, dungeonGrid, costFn = null) {
    if (start.x === end.x && start.y === end.y) return []

    const tiles = dungeonGrid.getTiles()
    const gh = tiles.length
    const gw = tiles[0]?.length ?? 0

    if (!this._inBounds(end.x, end.y, gw, gh)) return null

    const sKey = _k(start.x, start.y)
    const eKey = _k(end.x, end.y)

    const gScore = { [sKey]: 0 }
    const fScore = { [sKey]: _h(start, end) }
    const cameFrom = {}
    const open = new Set([sKey])

    while (open.size > 0) {
      let currKey = null
      let lowestF = Infinity
      for (const k of open) {
        const f = fScore[k] ?? Infinity
        if (f < lowestF) { lowestF = f; currKey = k }
      }
      if (currKey === null) break

      if (currKey === eKey) return _reconstruct(cameFrom, currKey)

      open.delete(currKey)
      const [cx, cy] = _unk(currKey)

      for (const [dx, dy] of NEIGHBOURS) {
        const nx = cx + dx, ny = cy + dy
        if (!this._inBounds(nx, ny, gw, gh)) continue
        const nKey = _k(nx, ny)
        if (nKey !== eKey && !WALKABLE.has(tiles[ny][nx])) continue

        const tileCost = costFn ? Math.max(1, costFn(nx, ny)) : 1
        const tentativeG = (gScore[currKey] ?? Infinity) + tileCost
        if (tentativeG < (gScore[nKey] ?? Infinity)) {
          cameFrom[nKey] = currKey
          gScore[nKey]   = tentativeG
          fScore[nKey]   = tentativeG + _h({ x: nx, y: ny }, end)
          open.add(nKey)
        }
      }
    }
    return null
  }

  static isWalkable(tileType) {
    return WALKABLE.has(tileType)
  }

  static _inBounds(x, y, gw, gh) {
    return x >= 0 && y >= 0 && x < gw && y < gh
  }
}

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function _k(x, y)   { return `${x},${y}` }
function _unk(key)  { const [x, y] = key.split(',').map(Number); return [x, y] }
function _h(a, b)   { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) }

function _reconstruct(cameFrom, endKey) {
  const path = []
  let key = endKey
  while (key) {
    const [x, y] = _unk(key)
    path.unshift({ x, y })
    key = cameFrom[key]
  }
  // Drop the start tile so the path starts with the first STEP
  return path.slice(1)
}

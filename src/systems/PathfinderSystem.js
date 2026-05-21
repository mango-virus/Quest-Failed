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

// Per-tile cost added for a "soft" obstacle (collision item / solid trap
// the caller flagged as passable-as-last-resort). Large enough that any
// detour around it is always cheaper — A* only routes THROUGH a soft
// obstacle when there is genuinely no other way. Dwarfs any real path
// length on dungeons up to ~100×100 tiles.
const SOFT_BLOCK_COST = 100000

export class PathfinderSystem {
  /**
   * Standard A* with Manhattan heuristic.
   * Phase 8: optional `costFn(tx, ty)` lets callers add per-tile multipliers
   * (e.g. KnowledgeSystem.costMultiplierForTile so adventurers route around
   * traps they know about).
   *
   * `jitter` (>0) adds a stable per-tile random multiplier in [1, 1+jitter] so
   * paths between equivalent routes vary across calls — adventurers stop
   * marching down the same straight line every time. Values are cached per
   * tile within a single call so the resulting path is internally consistent.
   * Pass 0 (default) for deterministic shortest-path behavior.
   *
   * @param {{x:number,y:number}} start
   * @param {{x:number,y:number}} end
   * @param {DungeonGrid} dungeonGrid
   * @param {(tx:number, ty:number) => number} [costFn] returns multiplier (default 1)
   * @param {number} [jitter=0] random per-tile cost noise amplitude
   * @param {Set<string>} [blockedTiles] hard-blocked tile keys ("x,y") — skipped entirely
   * @param {{softBlocked?:Set<string>, softTraps?:boolean}} [opts] soft-obstacle handling:
   *        `softBlocked` tiles and (when `softTraps`) solid traps cost SOFT_BLOCK_COST
   *        instead of hard-blocking, so the path routes around them but can pass
   *        through as a last resort rather than failing entirely.
   * @returns {Array<{x:number,y:number}> | null}
   */
  static findPath(start, end, dungeonGrid, costFn = null, jitter = 0, blockedTiles = null, opts = null) {
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
    const jitterCache = jitter > 0 ? new Map() : null

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
        // Doorway lane gate — keep all doorway crossings on the
        // canonical column/row so entities visibly walk straight
        // through the centre instead of diagonal-skimming the 2-tile
        // opening.  Allowed for the goal tile (so something parked on
        // the secondary column is still reachable).
        if (nKey !== eKey && dungeonGrid.isDoorBlocked?.(nx, ny)) continue
        // Solid decoration blocking — designer-placed objects that physically
        // occupy a floor tile (pillars, barrels, etc.). Goal tile is exempt
        // so something can still path to a unit standing next to a decor.
        if (nKey !== eKey && dungeonGrid.isSolidDecor?.(nx, ny)) continue
        // Solid traps (cannon / bomb / spike pillar / rotating blades) are
        // physical blockers — units route around them. Goal tile exempt.
        // `opts.softTraps` (adventurer pathing) downgrades them to a heavy
        // detour cost instead of a hard block, so an adv whose ONLY route
        // runs through one walks through rather than failing to path.
        let softPenalty = 0
        if (nKey !== eKey && dungeonGrid.isSolidTrap?.(nx, ny)) {
          if (opts?.softTraps) softPenalty += SOFT_BLOCK_COST
          else continue
        }
        // Mimic chests + any other dynamic blockers the caller wants
        // to route around (chest mimics on the floor, etc.). Goal tile
        // is exempt — the only way to reveal a chest is to walk onto it.
        if (nKey !== eKey && blockedTiles?.has?.(nKey)) continue
        // Soft blockers — collision items (Beacon / Fountain / Treasure
        // Chest) the caller wants routed around when possible but passable
        // as a last resort. Same heavy-cost treatment as softTraps.
        if (nKey !== eKey && opts?.softBlocked?.has?.(nKey)) softPenalty += SOFT_BLOCK_COST

        let tileCost = costFn ? Math.max(1, costFn(nx, ny)) : 1
        if (jitterCache) {
          let mul = jitterCache.get(nKey)
          if (mul === undefined) {
            mul = 1 + Math.random() * jitter
            jitterCache.set(nKey, mul)
          }
          tileCost *= mul
        }
        tileCost += softPenalty
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

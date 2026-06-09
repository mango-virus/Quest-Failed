// Soft crowd separation for STANDING entities — nudges same-group entities
// (adventurers among adventurers, minions among minions) that are stacked on the
// same tile apart, so idle guards / settled packs / spawn clusters fan out
// instead of reading as one blob.
//
// Scope is deliberately STATIONARY only. Measurement showed that nudging WALKING
// entities backfires: the movement code snaps them to tile centres each waypoint
// (overwriting the nudge) and any off-centre push manufactures new overlaps with
// neighbours on adjacent tiles — and roaming overlap is already marginal. So the
// caller's `eligible` predicate must pass ONLY entities that are standing still
// (not walking, not in combat). Those aren't running `_moveToward`, so the nudge
// sticks; and once spread across distinct tiles they settle (≥1 tile = no overlap).
//
// Doorway-safe: an entity in a door tile is left to the single-file funnel, and a
// nudge can never land an entity on a door column or non-walkable tile — so the
// funnel + seam logic + the door-stuck fixes are untouched.

import { Balance } from '../config/balance.js'
import { TILE } from '../systems/DungeonGrid.js'
import { PathfinderSystem } from '../systems/PathfinderSystem.js'

const TS = Balance.TILE_SIZE

// Deterministic tie-break direction for two entities at the EXACT same point
// (stacked spawns) — stable across ticks, varied per pair so a stack fans out
// instead of all shoving the same way.
function _tieBreak(a, b) {
  const s = String(a.instanceId) + String(b.instanceId)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  const ang = ((h >>> 0) % 360) * Math.PI / 180
  return { x: Math.cos(ang), y: Math.sin(ang) }
}

/**
 * Nudge stacked, STATIONARY same-group entities apart.
 * @param {Array} entities  the group (active adventurers, or all minions)
 * @param {DungeonGrid} grid
 * @param {object} [opts]
 * @param {number} [opts.radius=11]    entity radius px (min centre spacing = 2×)
 * @param {number} [opts.strength=0.5] fraction of the overlap resolved per tick
 * @param {number} [opts.maxPush=6]    max px any entity moves per tick (smoothness)
 * @param {(e:any)=>boolean} [opts.eligible] return false to skip an entity —
 *        MUST exclude walking / combat entities (see header).
 */
export function applyCrowdSeparation(entities, grid, opts = {}) {
  if (!Array.isArray(entities) || entities.length < 2 || !grid) return
  const radius   = opts.radius   ?? 11
  const strength = opts.strength ?? 0.5
  const maxPush  = opts.maxPush  ?? 6
  const eligible = opts.eligible ?? (() => true)
  const minDist  = radius * 2
  const minDist2 = minDist * minDist
  const tiles    = grid.getTiles?.()

  // Bucket by room → O(k²) per room. Roomless (mid-doorway) entities skipped —
  // the single-file lane owns them.
  const byRoom = new Map()
  for (const e of entities) {
    if (!eligible(e)) continue
    const room = grid.getRoomAtTile?.(e.tileX, e.tileY)
    if (!room) continue
    const arr = byRoom.get(room.instanceId)
    if (arr) arr.push(e); else byRoom.set(room.instanceId, [e])
    e._sepX = 0; e._sepY = 0
  }

  // 1) accumulate pairwise pushes (symmetric, order-independent)
  for (const arr of byRoom.values()) {
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i]
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j]
        let dx = a.worldX - b.worldX
        let dy = a.worldY - b.worldY
        let d2 = dx * dx + dy * dy
        if (d2 >= minDist2) continue
        let d = Math.sqrt(d2)
        if (d < 0.001) { const t = _tieBreak(a, b); dx = t.x; dy = t.y; d = 1 }
        const push = (minDist - d) * 0.5 * strength
        const ux = dx / d, uy = dy / d
        a._sepX += ux * push; a._sepY += uy * push
        b._sepX -= ux * push; b._sepY -= uy * push
      }
    }
  }

  // 2) apply — doorway-safe + clamped to walkable open floor
  for (const arr of byRoom.values()) {
    for (const e of arr) {
      let px = e._sepX, py = e._sepY
      e._sepX = 0; e._sepY = 0
      if (!px && !py) continue
      // Leave entities standing IN a doorway to the single-file funnel.
      if (grid.getTileType?.(e.tileX, e.tileY) === TILE.DOOR) continue
      const mag = Math.hypot(px, py)
      if (mag > maxPush) { px = px / mag * maxPush; py = py / mag * maxPush }
      const nx = e.worldX + px, ny = e.worldY + py
      const tx = Math.floor(nx / TS), ty = Math.floor(ny / TS)
      // Never push onto a wall/void, a door column, or the blocked secondary
      // lane — that would break the funnel / seam logic.
      if (!tiles?.[ty] || !PathfinderSystem.isWalkable(tiles[ty][tx])) continue
      if (grid.getTileType?.(tx, ty) === TILE.DOOR) continue
      if (grid.isDoorBlocked?.(tx, ty)) continue
      e.worldX = nx; e.worldY = ny
      e.tileX = tx; e.tileY = ty
    }
  }
}

// Combat slots — so several attackers RING a target instead of all pathing to
// its exact tile and piling into one blob. Each attacker claims a stable slot
// around the target; slots fill INNER ring first, then spill outward into a
// second / third rank when more attackers converge than the inner ring holds
// (so a big mob reads as ranks surrounding the target, never a pile). The slot
// TILE is recomputed from the target's CURRENT centre each call, so it tracks a
// moving target (the attacker flanks it to its assigned side).
//
// Goal-level, like the adventurer explore-spread: it changes WHERE an attacker
// aims, not how it's drawn or moved — so it never fights the tile-centre snap or
// the doors. For melee (inner ring, distance 1–1.4) an adjacent slot is in range
// (MELEE_RANGE_TILES ~1.5); outer ranks are a queue that fills in as the front
// thins. Used for: the minion swarm, adventurers ganging a minion, and the whole
// wave forming up around the boss.

// Ring of (dx,dy) offsets at Chebyshev distance r, ordered around the perimeter
// by angle so consecutive slots are spatially adjacent (a tidy ring, not a
// scan-order zigzag). Cached per radius.
const _ringCache = new Map()
function ringOffsets(r) {
  if (_ringCache.has(r)) return _ringCache.get(r)
  const out = []
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([dx, dy])
    }
  }
  out.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]))
  _ringCache.set(r, out)
  return out
}

/**
 * Tile an attacker should path to: a distinct slot in a ring around the target,
 * inner ranks first, spilling outward on overflow. Stores `attacker._slotOffset`
 * (a [dx,dy] relative to the ring centre) + `_slotTargetId` so the choice is
 * stable across ticks (no thrash) and tracks a moving target.
 * @param {*} attacker        the entity doing the attacking
 * @param {*} target          the entity being attacked (instanceId; default centre = tileX/tileY)
 * @param {Iterable} coAttackers entities that might attack the same target (their `_slotOffset` is avoided)
 * @param {(tx:number,ty:number)=>boolean} isWalkable validates a candidate slot
 * @param {object} [opts] { cx, cy, innerRadius=1, maxRadius=innerRadius+3 }
 *        cx/cy override the ring centre (e.g. the boss body centre); innerRadius
 *        is the first rank's distance (1 for a single-tile target; ~body+1 for a boss).
 * @returns {{x:number,y:number}}
 */
export function ringSlotTile(attacker, target, coAttackers, isWalkable, opts = {}) {
  const tid    = target.instanceId
  const cx     = opts.cx ?? target.tileX
  const cy     = opts.cy ?? target.tileY
  const inner  = opts.innerRadius ?? 1
  const maxR   = opts.maxRadius ?? (inner + 3)

  if (attacker._slotTargetId !== tid || attacker._slotOffset === undefined) {
    const taken = new Set()
    for (const o of coAttackers) {
      if (o === attacker || !o) continue
      if (o._slotTargetId === tid && o._slotOffset) taken.add(o._slotOffset[0] + ',' + o._slotOffset[1])
    }
    // Per-attacker start rotation (hashed off id) so attackers don't all probe
    // the same side of a ring first.
    let h = 0
    const s = String(attacker.instanceId)
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    h = h >>> 0
    let chosen = null
    // Pass 1: inner ring → out; a FREE (unclaimed) walkable slot.
    for (let r = inner; r <= maxR && !chosen; r++) {
      const ring = ringOffsets(r), start = h % ring.length
      for (let i = 0; i < ring.length; i++) {
        const off = ring[(start + i) % ring.length]
        if (taken.has(off[0] + ',' + off[1])) continue
        if (isWalkable(cx + off[0], cy + off[1])) { chosen = off; break }
      }
    }
    // Pass 2: inner → out, ANY walkable slot (only when every nearer slot is
    // already claimed — a little doubling-up beats idling).
    for (let r = inner; r <= maxR && !chosen; r++) {
      const ring = ringOffsets(r), start = h % ring.length
      for (let i = 0; i < ring.length; i++) {
        const off = ring[(start + i) % ring.length]
        if (isWalkable(cx + off[0], cy + off[1])) { chosen = off; break }
      }
    }
    attacker._slotOffset = chosen   // null → no walkable slot anywhere; fall back to centre
    attacker._slotTargetId = tid
  }

  const off = attacker._slotOffset
  if (!off) return { x: cx, y: cy }
  return { x: cx + off[0], y: cy + off[1] }
}

// Melee convenience — ring the target's own tile, inner radius 1 (overflow to 2–4).
export function meleeSlotTile(attacker, target, coAttackers, isWalkable) {
  return ringSlotTile(attacker, target, coAttackers, isWalkable, { innerRadius: 1, maxRadius: 4 })
}

// Drop a held slot (call when an attacker disengages so a fresh engagement
// re-picks cleanly). Optional — the helpers re-pick on target change anyway.
export function clearCombatSlot(attacker) {
  if (!attacker) return
  attacker._slotOffset = undefined
  attacker._slotTargetId = null
}

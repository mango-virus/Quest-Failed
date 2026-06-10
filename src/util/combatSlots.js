// Combat slots — so several melee attackers RING a target instead of all
// pathing to its exact tile and piling into one blob. Each attacker claims a
// stable slot offset around the target (cardinals first — true melee-adjacent —
// then diagonals), avoiding slots its co-attackers already took. The slot TILE
// is recomputed from the target's CURRENT tile each call, so it tracks a moving
// target (the attacker flanks it to its assigned side).
//
// Goal-level, like the adventurer explore-spread: it changes WHERE an attacker
// aims, not how it's drawn or moved — so it never fights the tile-centre snap or
// the doors. Melee reach is ~1.5 tiles, so an adjacent slot is still in range.

// Cardinals first (distance 1 — squarely in melee range), then diagonals
// (distance ~1.41, still within MELEE_RANGE_TILES 1.5).
const SURROUND = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]

/**
 * Tile an attacker should path to: a distinct slot around `target`, or the
 * target's own tile as a last resort. Stores `attacker._slotOffset` +
 * `_slotTargetId` so the choice is stable across ticks (no thrash).
 * @param {*} attacker        the minion / adventurer doing the attacking
 * @param {*} target          the entity being attacked (has tileX/tileY/instanceId)
 * @param {Iterable} coAttackers entities that might attack the same target
 *                              (their `_slotOffset` is avoided)
 * @param {(tx:number,ty:number)=>boolean} isWalkable validates a candidate slot
 * @returns {{x:number,y:number}}
 */
export function meleeSlotTile(attacker, target, coAttackers, isWalkable) {
  const tid = target.instanceId
  // (Re)assign an offset when the target changes or none is held yet.
  if (attacker._slotTargetId !== tid || attacker._slotOffset === undefined) {
    const taken = new Set()
    for (const o of coAttackers) {
      if (o === attacker || !o) continue
      if (o._slotTargetId === tid && o._slotOffset) taken.add(o._slotOffset[0] + ',' + o._slotOffset[1])
    }
    // Per-attacker start rotation so attackers don't all probe from the same
    // side first (hashed off the id → stable).
    let h = 0
    const s = String(attacker.instanceId)
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    const start = (h >>> 0) % SURROUND.length
    let chosen = null
    // First pass: a free, walkable slot no co-attacker has claimed.
    for (let i = 0; i < SURROUND.length && !chosen; i++) {
      const off = SURROUND[(start + i) % SURROUND.length]
      if (taken.has(off[0] + ',' + off[1])) continue
      if (isWalkable(target.tileX + off[0], target.tileY + off[1])) chosen = off
    }
    // Second pass: any walkable slot (a little overlap beats idling — happens
    // only when more attackers than free slots converge on one target).
    for (let i = 0; i < SURROUND.length && !chosen; i++) {
      const off = SURROUND[(start + i) % SURROUND.length]
      if (isWalkable(target.tileX + off[0], target.tileY + off[1])) chosen = off
    }
    attacker._slotOffset = chosen   // null → no walkable slot; fall back to target tile
    attacker._slotTargetId = tid
  }
  const off = attacker._slotOffset
  if (!off) return { x: target.tileX, y: target.tileY }
  return { x: target.tileX + off[0], y: target.tileY + off[1] }
}

// Drop a held slot (call when an attacker disengages, so a fresh engagement
// re-picks cleanly). Optional — meleeSlotTile re-picks on target change anyway.
export function clearCombatSlot(attacker) {
  if (!attacker) return
  attacker._slotOffset = undefined
  attacker._slotTargetId = null
}

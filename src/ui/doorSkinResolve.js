// Resolve a room's OWN door-skin id for a state (WITHOUT the global default —
// callers add that). Pure: reads only room fields + the passed boss/isEntrance.
//
// Precedence (most specific first):
//   entrance cp:  entranceBySkin[skin] → entrance → connectingBySkin[skin] → byBoss → connecting
//   connecting:   connectingBySkin[skin] → byBoss → connecting
//
// `skin` is the instance's rolled room-skin id (room.backgroundImage); a
// non-boss placed room bakes its pool pick there at placement, so per-skin
// overrides key off it. Rooms with no matching per-skin entry behave exactly
// as before this feature (zero regression).
export function resolveDoorSkinId(room, state, { isEntrance = false, boss = null } = {}) {
  if (!room) return null
  const skin = typeof room.backgroundImage === 'string' ? room.backgroundImage : null
  let id = null
  if (isEntrance) {
    if (skin) id = room.doorSkinEntranceBySkin?.[skin]?.[state] || null
    if (!id)  id = room.doorSkinEntrance?.[state] || null
  }
  if (!id) {
    if (skin) id = room.doorSkinBySkin?.[skin]?.[state] || null
    if (!id)  id = (boss && room.doorSkinByBoss?.[boss]?.[state]) || room.doorSkin?.[state] || null
  }
  return id
}

// Default door-skin footprint (in tiles) for a skin that never got a manual
// size. Anchors the WIDTH at baseW (keeps doorway coverage) and derives the
// HEIGHT from the PNG's native aspect, so a freshly-applied skin shows at its
// real proportions instead of being stretched into a fixed box. A 4:3 source
// (the original door art) → {w:4, h:3}, identical to the old hardcoded default.
// Height is rounded to 0.1 to match the size-slider step. Falls back to {4,3}
// when source dimensions are unavailable.
export function defaultDoorSkinSize(srcW, srcH, baseW = 4) {
  if (!(srcW > 0) || !(srcH > 0)) return { w: baseW, h: 3, nudge: 0 }
  const h = Math.round((baseW * srcH / srcW) * 10) / 10
  return { w: baseW, h, nudge: 0 }
}

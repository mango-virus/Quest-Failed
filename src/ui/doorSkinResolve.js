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

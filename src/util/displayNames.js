// displayNames — player-facing display-name resolver.
//
// The game is data-driven: every adventurer class, minion, trap, room,
// item and pact carries a human `name` in its JSON definition, but the
// code passes around the raw `id` (cosplay_adventurer, rat1,
// shooting_arrows, endless_garrison). Player-facing UI must NEVER print
// that raw id — always route it through one of the label helpers here.
//
// Resolution: look the id up in the loaded JSON def and return its
// `name`. If the def can't be found (cache not ready, unknown id), fall
// back to prettifyId() so the worst case is a Title-Cased guess — never
// a bare underscore_id.

// The Phaser JSON cache is global (one CacheManager per game), so the
// game instance on window.__game is the single source of truth. Returns
// [] when the cache or key is missing so callers can `.find` safely.
function _defs(key) {
  const arr = window.__game?.cache?.json?.get?.(key)
  return Array.isArray(arr) ? arr : []
}

function _name(key, id) {
  if (!id) return null
  const def = _defs(key).find(d => d.id === id)
  return def?.name ?? null
}

// Turn a raw id into a readable Title-Cased phrase: strips a trailing
// tier digit (rat1 → rat), swaps underscores / hyphens for spaces and
// capitalises each word. The last line of defence so a missing def
// never leaks `cosplay_adventurer` to the player.
export function prettifyId(id) {
  if (id == null || id === '') return ''
  return String(id)
    .replace(/\d+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Adventurer class id → display name (adventurerClasses.json).
export function classLabel(classId, fallback = 'Adventurer') {
  if (!classId) return fallback
  return _name('adventurerClasses', classId) ?? prettifyId(classId)
}

// Minion definitionId → display name (minionTypes.json).
export function minionLabel(defId, fallback = 'Minion') {
  if (!defId) return fallback
  return _name('minionTypes', defId) ?? prettifyId(defId)
}

// Trap definitionId → display name (trapTypes.json).
export function trapLabel(defId, fallback = 'Trap') {
  if (!defId) return fallback
  return _name('trapTypes', defId) ?? prettifyId(defId)
}

// Room definitionId → display name (rooms.json).
export function roomLabel(defId, fallback = 'Room') {
  if (!defId) return fallback
  return _name('rooms', defId) ?? prettifyId(defId)
}

// Item id → display name (items.json).
export function itemLabel(itemId, fallback = 'Item') {
  if (!itemId) return fallback
  return _name('items', itemId) ?? prettifyId(itemId)
}

// Pact / dungeon-mechanic id → display name (dungeonMechanics.json).
export function pactLabel(mechanicId, fallback = 'Pact') {
  if (!mechanicId) return fallback
  return _name('dungeonMechanics', mechanicId) ?? prettifyId(mechanicId)
}

const NAME_KEY           = 'qf.player.name'
const MAX_LEVEL_KEY_BASE = 'qf.player.maxBossLevel'
// Cheat handle that unlocks every boss archetype + the dev-only Room /
// Tileset editor entries on the main menu. Case-insensitive comparison.
const CHEAT_NAME         = 'mango'

function _isCheatName(name) {
  return (name ?? '').trim().toLowerCase() === CHEAT_NAME
}

function _maxLevelKeyFor(name) {
  return `${MAX_LEVEL_KEY_BASE}:${(name ?? '').trim()}`
}

export const PlayerProfile = {
  getName()     { return localStorage.getItem(NAME_KEY) ?? '' },
  setName(name) { localStorage.setItem(NAME_KEY, name.trim()) },
  hasName()     { const n = localStorage.getItem(NAME_KEY); return !!n && n.trim().length > 0 },
  clearName()   { localStorage.removeItem(NAME_KEY) },

  // Is the current player name the "unlock-everything" cheat? Used both
  // to bypass the boss-archetype unlock gates in ArchetypeSelect and to
  // surface the dev-only Room / Tileset editor entries on the main menu.
  isCheatName() {
    return _isCheatName(this.getName())
  },

  // Persistent record of the highest boss level the player has reached
  // across all runs, scoped to the current player name. Drives the
  // archetype-unlock gates on the picker (e.g. Succubus unlocks once the
  // player has hit boss level 7 with THIS name). Each name has its own
  // slot — renaming starts a fresh progression. The cheat name bypasses
  // the gates entirely (returns MAX_SAFE_INTEGER so every check passes);
  // an unnamed run unlocks nothing.
  //
  // History: an earlier version migrated a legacy global slot
  // (`qf.player.maxBossLevel`, no per-name suffix) into the first name
  // read after the per-name update. That was dropped — it had a habit of
  // silently handing the first newly-named player all the unlocks
  // accumulated by anonymous play, which read as "any name unlocks
  // everything" during testing.
  getMaxBossLevel() {
    const name = this.getName().trim()
    if (_isCheatName(name)) return Number.MAX_SAFE_INTEGER
    if (!name) return 0
    const v = parseInt(localStorage.getItem(_maxLevelKeyFor(name)) ?? '0', 10)
    return Number.isFinite(v) ? v : 0
  },
  recordBossLevel(level) {
    const n = parseInt(level, 10)
    if (!Number.isFinite(n) || n <= 0) return
    const name = this.getName().trim()
    if (!name) return                  // unnamed runs don't bank progress
    if (_isCheatName(name)) return     // the cheat is always max — nothing to record
    if (n > this.getMaxBossLevel()) {
      localStorage.setItem(_maxLevelKeyFor(name), String(n))
    }
  },
}

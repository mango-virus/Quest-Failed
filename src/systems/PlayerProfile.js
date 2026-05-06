const NAME_KEY      = 'qf.player.name'
// Legacy global slot (one-shared-progress for everyone on this browser).
// Now superseded by per-name slots; getMaxBossLevel migrates the legacy
// value into the current player's per-name key on first read and then
// deletes it, so the legacy slot exists only for transient unnamed runs
// and for one-time migration of pre-update saves.
const MAX_LEVEL_KEY = 'qf.player.maxBossLevel'

function _maxLevelKeyFor(name) {
  const n = (name ?? '').trim()
  return n ? `${MAX_LEVEL_KEY}:${n}` : MAX_LEVEL_KEY
}

export const PlayerProfile = {
  getName()     { return localStorage.getItem(NAME_KEY) ?? '' },
  setName(name) { localStorage.setItem(NAME_KEY, name.trim()) },
  hasName()     { const n = localStorage.getItem(NAME_KEY); return !!n && n.trim().length > 0 },
  clearName()   { localStorage.removeItem(NAME_KEY) },

  // Persistent record of the highest boss level the player has reached
  // across all runs, scoped to the current player name. Drives
  // archetype-unlock gates on the picker (e.g. Succubus unlocks once the
  // player has hit boss level 7 with this name). Renaming starts a
  // fresh progression — only the first named player to open the game
  // after the per-name update inherits the legacy global progress.
  getMaxBossLevel() {
    const name = this.getName().trim()
    if (!name) {
      // Unnamed (pre-prompt) — read/write the legacy slot directly.
      const v = parseInt(localStorage.getItem(MAX_LEVEL_KEY) ?? '0', 10)
      return Number.isFinite(v) ? v : 0
    }
    const perKey = _maxLevelKeyFor(name)
    let raw = localStorage.getItem(perKey)
    if (raw == null) {
      // First read for this name — migrate legacy global if present, so
      // an existing pre-update player doesn't appear to lose all their
      // unlocks the first time they reopen the picker.
      const legacy = localStorage.getItem(MAX_LEVEL_KEY)
      if (legacy != null) {
        localStorage.setItem(perKey, legacy)
        localStorage.removeItem(MAX_LEVEL_KEY)
        raw = legacy
      }
    }
    const v = parseInt(raw ?? '0', 10)
    return Number.isFinite(v) ? v : 0
  },
  recordBossLevel(level) {
    const n = parseInt(level, 10)
    if (!Number.isFinite(n) || n <= 0) return
    if (n > this.getMaxBossLevel()) {
      const key = _maxLevelKeyFor(this.getName().trim())
      localStorage.setItem(key, String(n))
    }
  },
}

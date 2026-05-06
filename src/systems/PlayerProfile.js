const NAME_KEY      = 'qf.player.name'
const MAX_LEVEL_KEY = 'qf.player.maxBossLevel'

export const PlayerProfile = {
  getName()     { return localStorage.getItem(NAME_KEY) ?? '' },
  setName(name) { localStorage.setItem(NAME_KEY, name.trim()) },
  hasName()     { const n = localStorage.getItem(NAME_KEY); return !!n && n.trim().length > 0 },
  clearName()   { localStorage.removeItem(NAME_KEY) },

  // Persistent record of the highest boss level the player has reached
  // across all runs. Drives archetype-unlock gates on the picker (e.g.
  // Succubus unlocks once the player has hit boss level 4 with any boss).
  getMaxBossLevel() {
    const v = parseInt(localStorage.getItem(MAX_LEVEL_KEY) ?? '0', 10)
    return Number.isFinite(v) ? v : 0
  },
  recordBossLevel(level) {
    const n = parseInt(level, 10)
    if (!Number.isFinite(n) || n <= 0) return
    if (n > this.getMaxBossLevel()) localStorage.setItem(MAX_LEVEL_KEY, String(n))
  },
}

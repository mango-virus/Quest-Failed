// PlayerProfile — per-player state persistence.
//
// EVERY player-progress key is name-scoped (`<base>:<name>`) so switching
// names switches between independent state slots. The cheat name `mango`
// has its own slot like any other name — its writes never leak into a
// real player's account. (This was the gotcha that drove the 2026-05-26
// refactor: prior versions stored achievement unlocks / titles /
// companion unlocks under global keys, so any mango testing would
// silently unlock everything for the next player who logged in.)
//
// `getName()` is the only global read — the active player name. Every
// other helper resolves the per-name key from the current name and
// reads/writes to that slot.
//
// Cheat-name short-circuits (`mango` reports max boss level, every
// companion / achievement unlocked) operate at READ time only — they
// don't depend on what's actually persisted in the mango slot, so a
// fresh-install mango session still reads as everything-unlocked.
// `AchievementSystem._mangoUnlockAll` writes the unlocks into the mango
// slot at boot so titles + companion rewards + leaderboard bitmask
// also reflect the cheat (but only inside the mango slot — switching
// away from mango shows the other player's actual state).

const NAME_KEY = 'qf.player.name'

// All other keys are BASES — the per-name slot lives at `<base>:<name>`.
const MAX_LEVEL_KEY_BASE          = 'qf.player.maxBossLevel'
const UNLOCKED_COMPANIONS_KEY_BASE = 'qf.companions.unlocked'
const UNLOCKED_ACHIEVEMENTS_KEY_BASE = 'qf.achievements.unlocked'
const ACHIEVEMENT_METRICS_KEY_BASE   = 'qf.achievements.metrics'
const TITLES_KEY_BASE                = 'qf.player.titles'
const ACHIEVEMENT_TIMESTAMPS_KEY_BASE = 'qf.achievements.timestamps'
const ACTIVE_TITLE_ID_KEY_BASE        = 'qf.player.active_title_id'

// Legacy global keys — wiped at module load (Option A from the user's
// 2026-05-26 decision). Any data here was pre-refactor pollution and
// will not be migrated.
const LEGACY_GLOBAL_KEYS = [
  'qf.companions.unlocked',
  'qf.achievements.unlocked',
  'qf.achievements.metrics',
  'qf.player.titles',
  'qf.achievements.timestamps',
  'qf.player.active_title_id',
]

// Starter companion ids — duplicated here as a local fallback to avoid a
// circular import on PlayerProfile ← companions.js ← (anything). Keep in
// sync with STARTER_COMPANIONS in companions.js. Zul'Gath was moved to
// locked-status 2026-05-25 (unlocks via `hoard_lord` achievement).
const _STARTER_COMPANION_IDS = ['lilith', 'malakor', 'safira']
// Cheat handle that unlocks every boss archetype + the dev-only Room /
// Tileset editor entries on the main menu + every locked companion.
// Case-insensitive comparison.
const CHEAT_NAME = 'mango'

function _isCheatName(name) {
  return (name ?? '').trim().toLowerCase() === CHEAT_NAME
}

// Per-name key resolvers. All resolve to `<base>:<trimmed-name>`. An
// unnamed player ends up at `<base>:` — a separate slot from any named
// player. Empty-name access is allowed (won't crash) but `recordBossLevel`
// + `unlockAchievement` etc. early-return on empty names so no progress
// banks until the player chooses a name.
function _maxLevelKeyFor(name)        { return `${MAX_LEVEL_KEY_BASE}:${(name ?? '').trim()}` }
function _companionsKeyFor(name)      { return `${UNLOCKED_COMPANIONS_KEY_BASE}:${(name ?? '').trim()}` }
function _achievementsKeyFor(name)    { return `${UNLOCKED_ACHIEVEMENTS_KEY_BASE}:${(name ?? '').trim()}` }
function _metricsKeyFor(name)         { return `${ACHIEVEMENT_METRICS_KEY_BASE}:${(name ?? '').trim()}` }
function _titlesKeyFor(name)          { return `${TITLES_KEY_BASE}:${(name ?? '').trim()}` }
function _timestampsKeyFor(name)      { return `${ACHIEVEMENT_TIMESTAMPS_KEY_BASE}:${(name ?? '').trim()}` }
function _activeTitleIdKeyFor(name)   { return `${ACTIVE_TITLE_ID_KEY_BASE}:${(name ?? '').trim()}` }

// One-time cleanup of the legacy global keys. Runs at module load.
// Idempotent — removeItem on a missing key is a no-op. Once every dev
// machine has been through this pass, these legacy keys are gone and
// the cleanup is a free no-op forever after.
;(function _cleanupLegacyGlobalKeys() {
  try {
    for (const k of LEGACY_GLOBAL_KEYS) localStorage.removeItem(k)
  } catch {}
})()

// Read the unlocked-companion id set from localStorage for the current
// name. Returns a fresh Set each call; mutate-then-write via
// `_writeUnlockedSet`. Returns null if the slot is absent or unparseable
// so callers can seed the starter list.
function _readUnlockedSet(name) {
  try {
    const raw = localStorage.getItem(_companionsKeyFor(name))
    if (!raw) return null
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr) : null
  } catch {
    return null
  }
}

function _writeUnlockedSet(name, set) {
  try {
    localStorage.setItem(_companionsKeyFor(name), JSON.stringify(Array.from(set)))
  } catch {}
}

export const PlayerProfile = {
  getName()     { return localStorage.getItem(NAME_KEY) ?? '' },
  setName(name) {
    const prev = localStorage.getItem(NAME_KEY) ?? ''
    const next = (name ?? '').trim()
    localStorage.setItem(NAME_KEY, next)
    // Fire NAME_CHANGED so dependent systems (AchievementSystem in
    // particular) can re-hydrate their in-memory state from the new
    // name's slot. Lazy-imported to avoid a circular dep on EventBus.
    if (prev !== next) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        import('./EventBus.js').then(m => m.EventBus?.emit?.('NAME_CHANGED', { prev, next })).catch(() => {})
      } catch {}
    }
  },
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

  // ── Companion unlocks (per-name) ─────────────────────────────────────
  // The starter three companions ship unlocked; further companions
  // (Zul'Gath via Hoard Lord, Nocturna in the future) are gated behind
  // achievements. Per-name storage — mango's "everything unlocked" cheat
  // doesn't leak into other player accounts.

  getUnlockedCompanions() {
    const name = this.getName()
    let set = _readUnlockedSet(name)
    if (!set) {
      // First read for this name — seed with the starter list. Each
      // player name gets its own fresh starter roster.
      set = new Set(_STARTER_COMPANION_IDS)
      _writeUnlockedSet(name, set)
    }
    return set
  },

  // Is a specific companion id unlocked for the current player?
  // Cheat-name short-circuits to `true` for every id.
  isCompanionUnlocked(id) {
    if (!id) return false
    if (_isCheatName(this.getName())) return true
    return this.getUnlockedCompanions().has(id)
  },

  // Add `id` to the unlocked set + persist. No-op if already unlocked.
  // Returns true on a real first-time unlock so callers can fire a
  // toast / SFX. Mango writes are persisted to the mango slot too — that
  // way `_mangoUnlockAll` can bulk-unlock for mango without leaking.
  unlockCompanion(id) {
    if (!id) return false
    const name = this.getName()
    const set = this.getUnlockedCompanions()
    if (set.has(id)) return false
    set.add(id)
    _writeUnlockedSet(name, set)
    return true
  },

  // Remove every companion unlock for the CURRENT name — primarily for
  // dev / test. After clearing, the next `getUnlockedCompanions()`
  // re-seeds with the starter list (for the current name only).
  clearCompanionUnlocks() {
    try { localStorage.removeItem(_companionsKeyFor(this.getName())) } catch {}
  },

  // ── Achievements (per-name) ──────────────────────────────────────────
  // Read-side helpers only — AchievementSystem owns the write path (it
  // tracks live progress against achievement definitions and calls
  // `unlockAchievement` when a threshold is crossed). The data here is
  // also what the leaderboard submission packs into its bitmask field.

  // Returns the Set of unlocked achievement ids for the current name.
  // Empty Set for fresh / unnamed players. Cheat-name short-circuit is
  // applied per-id by `isAchievementUnlocked` rather than here — the
  // overlay reads this directly for the counter, and we want mango's
  // counter to reflect actually-written unlocks (which `_mangoUnlockAll`
  // populates on init), not an in-memory "all" fudge.
  getUnlockedAchievements() {
    try {
      const raw = localStorage.getItem(_achievementsKeyFor(this.getName()))
      if (!raw) return new Set()
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? new Set(arr) : new Set()
    } catch {
      return new Set()
    }
  },

  // Is a specific achievement id unlocked for the current player? Cheat
  // name (`mango`) short-circuits to `true` for every id — and on boot,
  // `AchievementSystem._mangoUnlockAll` also populates the persisted
  // mango slot so the overlay counter / titles / leaderboard bitmask all
  // reflect "everything unlocked." For a non-mango name the answer comes
  // straight from the per-name slot — completely independent of mango.
  isAchievementUnlocked(id) {
    if (!id) return false
    if (_isCheatName(this.getName())) return true
    return this.getUnlockedAchievements().has(id)
  },

  // Mark an achievement id as unlocked + persist to the current name's
  // slot. Returns true on a real first-time unlock (so callers can fire
  // toast / SFX). Used by AchievementSystem when a metric threshold is
  // crossed. Also stamps the unlock timestamp so the recent-unlocks UI +
  // leaderboard most-recent-title fallback can sort by it.
  unlockAchievement(id) {
    if (!id) return false
    const name = this.getName()
    const set = this.getUnlockedAchievements()
    if (set.has(id)) return false
    set.add(id)
    try {
      localStorage.setItem(_achievementsKeyFor(name), JSON.stringify(Array.from(set)))
    } catch {}
    // Stamp timestamp into the same name's timestamps slot.
    try {
      const ts = this._readAchievementTimestamps()
      ts[id] = Date.now()
      localStorage.setItem(_timestampsKeyFor(name), JSON.stringify(ts))
    } catch {}
    return true
  },

  // Internal helper — returns the raw timestamp map for the current
  // name (mutate-and-write via the per-name key). Returns {} if missing
  // / unparseable.
  _readAchievementTimestamps() {
    try {
      const raw = localStorage.getItem(_timestampsKeyFor(this.getName()))
      if (!raw) return {}
      const obj = JSON.parse(raw)
      return (obj && typeof obj === 'object') ? obj : {}
    } catch { return {} }
  },

  // When did the current player unlock this achievement (ms epoch)?
  // Null when the id is unknown OR was unlocked before timestamp tracking
  // landed (retroactive scans stamp `Date.now()` so this only matters
  // for the very first session after the feature shipped).
  getAchievementTimestamp(id) {
    return this._readAchievementTimestamps()[id] ?? null
  },

  // Most-recent-first list of unlocks with timestamps for the current
  // player. Used by the "RECENT UNLOCKS" strip in the achievements
  // overlay. Pass a limit to cap the result; default is 5.
  getRecentUnlocks(limit = 5) {
    const ts = this._readAchievementTimestamps()
    const entries = Object.entries(ts).map(([id, t]) => ({ id, ts: Number(t) || 0 }))
    entries.sort((a, b) => b.ts - a.ts)
    return entries.slice(0, Math.max(0, limit))
  },

  // Achievement-metric reads — per-name. AchievementSystem owns the
  // write path. Returns the full metrics object (or {} if absent).
  // Mutate-and-write via `setAchievementMetrics`.
  getAchievementMetrics() {
    try {
      const raw = localStorage.getItem(_metricsKeyFor(this.getName()))
      if (!raw) return {}
      const obj = JSON.parse(raw)
      return (obj && typeof obj === 'object') ? obj : {}
    } catch {
      return {}
    }
  },

  setAchievementMetrics(metrics) {
    try {
      localStorage.setItem(_metricsKeyFor(this.getName()), JSON.stringify(metrics ?? {}))
    } catch {}
  },

  // Dev / test helper — clears the CURRENT name's unlocks, metrics,
  // titles, timestamps, AND active-title selection so the next session
  // starts clean. Does NOT touch other players' slots.
  clearAchievements() {
    const name = this.getName()
    try { localStorage.removeItem(_achievementsKeyFor(name)) } catch {}
    try { localStorage.removeItem(_metricsKeyFor(name)) } catch {}
    try { localStorage.removeItem(_titlesKeyFor(name)) } catch {}
    try { localStorage.removeItem(_timestampsKeyFor(name)) } catch {}
    try { localStorage.removeItem(_activeTitleIdKeyFor(name)) } catch {}
  },

  // ── Titles (per-name) ────────────────────────────────────────────────
  // Granted by certain high-tier achievements. Each entry is
  // { id, name, ts } — `id` matches the achievement id that granted it
  // (so deduplication is trivial), `name` is the display string, `ts` is
  // unlock timestamp (drives default-active-title selection).

  getUnlockedTitles() {
    try {
      const raw = localStorage.getItem(_titlesKeyFor(this.getName()))
      if (!raw) return []
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr : []
    } catch { return [] }
  },

  // Unlock a title for the current player. No-op if the id is already
  // in the list. Returns true on a fresh unlock so AchievementSystem
  // can fire its toast / SFX.
  unlockTitle(id, name) {
    if (!id || !name) return false
    const playerName = this.getName()
    const list = this.getUnlockedTitles()
    if (list.some(t => t.id === id)) return false
    list.push({ id, name, ts: Date.now() })
    try {
      localStorage.setItem(_titlesKeyFor(playerName), JSON.stringify(list))
    } catch {}
    return true
  },

  // The active title for the current player — either the one they've
  // EXPLICITLY chosen via the picker, OR (when no explicit pick) the
  // most-recently-unlocked one. Null when no titles unlocked at all.
  getActiveTitle() {
    const list = this.getUnlockedTitles()
    if (!list.length) return null
    const selectedId = this.getActiveTitleId()
    if (selectedId) {
      const found = list.find(t => t.id === selectedId)
      if (found) return found
    }
    // Fallback — most-recent-unlocked by timestamp.
    return list.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))[0]
  },

  // Selected title id for the current player (null = auto-pick most
  // recent). Always a string-or-null.
  getActiveTitleId() {
    try {
      const v = localStorage.getItem(_activeTitleIdKeyFor(this.getName()))
      return v && v.length > 0 ? v : null
    } catch { return null }
  },

  // Set the current player's active title to a specific achievement id.
  // Pass null (or empty string) to clear the selection — `getActiveTitle`
  // then falls back to the most-recently-unlocked title.
  setActiveTitleId(id) {
    const name = this.getName()
    try {
      if (id == null || id === '') {
        localStorage.removeItem(_activeTitleIdKeyFor(name))
      } else {
        localStorage.setItem(_activeTitleIdKeyFor(name), String(id))
      }
    } catch {}
  },

  // Pack the unlocked-achievement set into a compact bitmask string for
  // the leaderboard submission. `allIds` is the canonical id-order array
  // from the achievements data file (must match the order AchievementsOverlay
  // displays so the receiver can decode positions correctly). Returns a
  // string of '0'/'1' chars, one per achievement id, in `allIds` order.
  getAchievementBitmask(allIds) {
    if (!Array.isArray(allIds) || allIds.length === 0) return ''
    const unlocked = this.getUnlockedAchievements()
    let out = ''
    for (const id of allIds) out += unlocked.has(id) ? '1' : '0'
    return out
  },
}

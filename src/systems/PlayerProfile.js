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
// Per-name flag — set the first time the player opens the achievements
// overlay (any mode). Drives the "NEW" badge next to the ACHIEVEMENTS
// item on the main menu: visible only while this flag is unset for the
// current name, cleared once the player has actually looked at the page.
// Stored as the literal string '1' for presence detection — value
// content doesn't matter; only the key's existence does.
const ACHIEVEMENTS_SEEN_KEY_BASE      = 'qf.player.achievements_seen'
// Per-id NEW-tag tracking (per-name) for the reusable "NEW" badge system.
// Stored as a JSON array of ids the player has been "introduced to" (either
// by opening the relevant overlay, by snapshot-on-first-open, or by
// hover-dismissing a single card). When a new id appears in the achievement
// data file / companion registry that isn't in the player's set, the NEW
// tag renders. Auto-detect approach — designer doesn't have to flag anything,
// the diff between "what exists in code" vs "what's in the seen set" drives
// the tag. See AchievementsOverlay + CompanionSelectOverlay for the renders.
const ACHIEVEMENTS_NEW_SEEN_KEY_BASE  = 'qf.player.achievements_newseen'
const COMPANIONS_NEW_SEEN_KEY_BASE    = 'qf.player.companions_newseen'
const BOSSES_NEW_SEEN_KEY_BASE        = 'qf.player.bosses_newseen'
const LEADERBOARD_NEW_SEEN_KEY_BASE   = 'qf.player.leaderboard_newseen'

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
function _achievementsSeenKeyFor(name){ return `${ACHIEVEMENTS_SEEN_KEY_BASE}:${(name ?? '').trim()}` }
function _achievementsNewSeenKeyFor(name) { return `${ACHIEVEMENTS_NEW_SEEN_KEY_BASE}:${(name ?? '').trim()}` }
function _companionsNewSeenKeyFor(name)   { return `${COMPANIONS_NEW_SEEN_KEY_BASE}:${(name ?? '').trim()}` }
function _bossesNewSeenKeyFor(name)       { return `${BOSSES_NEW_SEEN_KEY_BASE}:${(name ?? '').trim()}` }
function _leaderboardNewSeenKeyFor(name)  { return `${LEADERBOARD_NEW_SEEN_KEY_BASE}:${(name ?? '').trim()}` }

// Generic helpers shared by the achievement + companion seen-id sets.
// `getSet` parses a stored JSON array into a Set<string>; `writeSet`
// serialises back out. Both are best-effort and tolerate missing /
// corrupt entries by returning an empty Set / no-oping respectively.
function _readIdSet(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.filter(s => typeof s === 'string') : [])
  } catch { return new Set() }
}
function _writeIdSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])) } catch {}
}

// One-time cleanup of the legacy global keys. Runs at module load.
// Idempotent — removeItem on a missing key is a no-op. Once every dev
// machine has been through this pass, these legacy keys are gone and
// the cleanup is a free no-op forever after.
;(function _cleanupLegacyGlobalKeys() {
  try {
    for (const k of LEGACY_GLOBAL_KEYS) localStorage.removeItem(k)
  } catch {}
})()

// One-time migration — wipe over-eager NEW-tag seen-set seeds across all
// per-name slots. The initial version of the NEW-tag system bulk-seeded
// every currently-unlocked id into the seen-set on first open, which
// suppressed NEW tags from ever appearing on existing rosters. That
// behavior was removed (auto-detect is now strict — no seeding), but
// the data those buggy opens wrote is still in localStorage and would
// keep hiding the tags. Detected via a version flag; runs once per
// browser, then never again. Safe across multiple player names (walks
// all matching keys, not just the active name).
const NEWSEEN_MIGRATION_FLAG = 'qf.player.newseen_seed_reset_v1'
;(function _resetOverEagerNewSeenSeeds() {
  try {
    if (localStorage.getItem(NEWSEEN_MIGRATION_FLAG) === '1') return
    const prefixes = [
      ACHIEVEMENTS_NEW_SEEN_KEY_BASE + ':',
      COMPANIONS_NEW_SEEN_KEY_BASE + ':',
      BOSSES_NEW_SEEN_KEY_BASE + ':',
      LEADERBOARD_NEW_SEEN_KEY_BASE + ':',
    ]
    const toRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && prefixes.some(p => k.startsWith(p))) toRemove.push(k)
    }
    for (const k of toRemove) localStorage.removeItem(k)
    localStorage.setItem(NEWSEEN_MIGRATION_FLAG, '1')
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

  // ── "Achievements seen" badge state (per-name) ──────────────────────
  // The main menu shows a "NEW" badge beside the ACHIEVEMENTS button
  // until the player has opened the overlay at least once. Once they
  // do, `markAchievementsSeen()` flips a per-name flag and the badge
  // doesn't show again FOR THAT NAME. Switching to a fresh name will
  // surface the badge again (each player gets the introduction).

  hasSeenAchievements() {
    try { return localStorage.getItem(_achievementsSeenKeyFor(this.getName())) === '1' }
    catch { return false }
  },

  markAchievementsSeen() {
    try { localStorage.setItem(_achievementsSeenKeyFor(this.getName()), '1') }
    catch {}
  },

  // ── Per-id NEW-tag tracking (per-name) ──────────────────────────────
  // The reusable "NEW" badge system — same visual as the menu-bar
  // achievement intro badge, surfaced wherever the player encounters a
  // newly-added thing for the first time. Auto-detect: when an id
  // appears in code that's NOT in the player's seen-set, it renders as
  // NEW. Hover (companion card) / opening the overlay (achievements)
  // dismisses by adding the id to the seen-set.
  //
  // Achievements: opening AchievementsOverlay marks ALL current ids as
  // seen (replaces the old binary `markAchievementsSeen` flag for the
  // menu-badge logic; the old method still flips for backward compat
  // but is no longer the source of truth).
  // Companions: hovering an UNLOCKED card marks just that id as seen.
  // The first-ever open of CompanionSelectOverlay also bulk-snapshots
  // every CURRENTLY-UNLOCKED companion id so the existing-content
  // baseline doesn't pop NEW on every starter for fresh players.

  getKnownAchievementIds() {
    return _readIdSet(_achievementsNewSeenKeyFor(this.getName()))
  },

  // Add `ids` to the player's seen-achievement set. Idempotent — re-adds
  // are no-ops. No-ops on an empty name (pre-name slot) so the
  // unnamed-player slot doesn't accumulate noise.
  markAchievementsKnown(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return
    if (!this.getName()) return
    const key = _achievementsNewSeenKeyFor(this.getName())
    const set = _readIdSet(key)
    let dirty = false
    for (const id of ids) {
      if (typeof id === 'string' && id && !set.has(id)) { set.add(id); dirty = true }
    }
    if (dirty) _writeIdSet(key, set)
  },

  // Returns true if any id in `allIds` is NOT in the player's seen set.
  // Drives the main-menu NEW badge: as long as there's an achievement
  // the player hasn't been introduced to, the badge shows.
  hasUnseenNewAchievements(allIds) {
    if (!Array.isArray(allIds) || allIds.length === 0) return false
    const seen = this.getKnownAchievementIds()
    for (const id of allIds) if (!seen.has(id)) return true
    return false
  },

  getKnownCompanionIds() {
    return _readIdSet(_companionsNewSeenKeyFor(this.getName()))
  },

  // Mark a single companion as known (hover-dismiss path).
  markCompanionKnown(id) {
    if (!id || typeof id !== 'string') return
    if (!this.getName()) return
    const key = _companionsNewSeenKeyFor(this.getName())
    const set = _readIdSet(key)
    if (set.has(id)) return
    set.add(id)
    _writeIdSet(key, set)
  },

  // Bulk-snapshot many ids at once. Used by CompanionSelectOverlay's
  // first-ever open to seed the baseline so fresh players don't see
  // NEW on every starter card. Idempotent.
  markCompanionsKnown(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return
    if (!this.getName()) return
    const key = _companionsNewSeenKeyFor(this.getName())
    const set = _readIdSet(key)
    let dirty = false
    for (const id of ids) {
      if (typeof id === 'string' && id && !set.has(id)) { set.add(id); dirty = true }
    }
    if (dirty) _writeIdSet(key, set)
  },

  // Returns true if any UNLOCKED companion id in `unlockedIds` is NOT in
  // the player's seen set. Drives the cross-surface "NEW EVIL" main-menu
  // badge: if a freshly-unlocked companion has not been hover-dismissed
  // on the recruit screen yet, the main menu's start-a-run button glows.
  // Pass the result of `getUnlockedCompanions()` (as a Set or array).
  hasUnseenNewCompanions(unlockedIds) {
    const ids = Array.isArray(unlockedIds) ? unlockedIds : [...(unlockedIds || [])]
    if (ids.length === 0) return false
    const seen = this.getKnownCompanionIds()
    for (const id of ids) if (!seen.has(id)) return true
    return false
  },

  // ── Boss-archetype NEW-tag tracking ─────────────────────────────────
  // Same shape as the companion side. The boss-select scene (Phaser-
  // rendered, src/scenes/ArchetypeSelect.js) reads + writes these to
  // paint and dismiss the NEW pill above unlocked boss portraits. The
  // main-menu NEW EVIL badge OR's the boss + companion checks together.

  getKnownBossIds() {
    return _readIdSet(_bossesNewSeenKeyFor(this.getName()))
  },

  markBossKnown(id) {
    if (!id || typeof id !== 'string') return
    if (!this.getName()) return
    const key = _bossesNewSeenKeyFor(this.getName())
    const set = _readIdSet(key)
    if (set.has(id)) return
    set.add(id)
    _writeIdSet(key, set)
  },

  markBossesKnown(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return
    if (!this.getName()) return
    const key = _bossesNewSeenKeyFor(this.getName())
    const set = _readIdSet(key)
    let dirty = false
    for (const id of ids) {
      if (typeof id === 'string' && id && !set.has(id)) { set.add(id); dirty = true }
    }
    if (dirty) _writeIdSet(key, set)
  },

  hasUnseenNewBosses(unlockedIds) {
    const ids = Array.isArray(unlockedIds) ? unlockedIds : [...(unlockedIds || [])]
    if (ids.length === 0) return false
    const seen = this.getKnownBossIds()
    for (const id of ids) if (!seen.has(id)) return true
    return false
  },

  // ── Leaderboard top-3 NEW-tag tracking ──────────────────────────────
  // Dedup key is the per-RUN row id (Supabase PK, unique per run). Two
  // runs by the same player produce two independent NEW chips that
  // dismiss separately — matches the "each podium spot is its own
  // notable thing" UX. Self-rows are filtered by callers (no NEW signal
  // on your own run). Previous versions used canonical player names but
  // that conflated multiple top-3 runs by the same player into a single
  // dismiss-everywhere identity — wrong for podium-spot semantics.

  getKnownLeaderboardIds() {
    return _readIdSet(_leaderboardNewSeenKeyFor(this.getName()))
  },

  // Mark a single podium run as known (hover-dismiss path). `id` is the
  // Supabase row id of the run.
  markLeaderboardIdKnown(id) {
    if (!id || typeof id !== 'string') return
    if (!this.getName()) return
    const storeKey = _leaderboardNewSeenKeyFor(this.getName())
    const set = _readIdSet(storeKey)
    if (set.has(id)) return
    set.add(id)
    _writeIdSet(storeKey, set)
  },

  // Returns true if any of the supplied podium row ids is NOT in the
  // player's seen set. `top3Ids` is an array of Supabase row id strings.
  // The local player's own row should be filtered out by the caller
  // (e.g. by skipping rows whose isYou is true).
  hasUnseenNewLeaderboardIds(top3Ids) {
    if (!Array.isArray(top3Ids) || top3Ids.length === 0) return false
    const seen = this.getKnownLeaderboardIds()
    for (const id of top3Ids) {
      if (id && typeof id === 'string' && !seen.has(id)) return true
    }
    return false
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

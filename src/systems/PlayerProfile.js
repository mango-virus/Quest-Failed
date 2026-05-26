const NAME_KEY           = 'qf.player.name'
const MAX_LEVEL_KEY_BASE = 'qf.player.maxBossLevel'
// Per-player roster of unlocked companions, persisted as a JSON array of ids
// under this key. The set is seeded with `STARTER_COMPANIONS` (the four base
// companions) on first read so existing saves don't lose access. Locked
// companions (e.g. nocturna) are added by `unlockCompanion()` when their
// unlock condition fires.
const UNLOCKED_COMPANIONS_KEY = 'qf.companions.unlocked'
// Starter companion ids — duplicated here as a local fallback to avoid a
// circular import on PlayerProfile ← companions.js ← (anything). Keep in
// sync with STARTER_COMPANIONS in companions.js.
const _STARTER_COMPANION_IDS = ['lilith', 'malakor', 'safira', 'zulgath']
// Cheat handle that unlocks every boss archetype + the dev-only Room /
// Tileset editor entries on the main menu + every locked companion.
// Case-insensitive comparison.
const CHEAT_NAME         = 'mango'

function _isCheatName(name) {
  return (name ?? '').trim().toLowerCase() === CHEAT_NAME
}

function _maxLevelKeyFor(name) {
  return `${MAX_LEVEL_KEY_BASE}:${(name ?? '').trim()}`
}

// Read the unlocked-companion id set from localStorage. Returns a fresh Set
// each call; mutate-then-write via `_writeUnlockedSet`. Returns null if the
// key is absent or unparseable so callers can seed the starter list.
function _readUnlockedSet() {
  try {
    const raw = localStorage.getItem(UNLOCKED_COMPANIONS_KEY)
    if (!raw) return null
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr) : null
  } catch {
    return null
  }
}

function _writeUnlockedSet(set) {
  try {
    localStorage.setItem(UNLOCKED_COMPANIONS_KEY, JSON.stringify(Array.from(set)))
  } catch {}
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

  // ── Companion unlocks ─────────────────────────────────────────────────
  // The starter four companions ship unlocked; further companions (Nocturna
  // and beyond) are gated behind player progression. The actual unlock
  // conditions are deferred — when an unlock fires (boss defeat / specific
  // event / etc.) the caller invokes `unlockCompanion(id)` and the recruit
  // screen surfaces them on the next visit.
  //
  // Cheat-name override: the `mango` cheat unlocks every companion known to
  // the COMPANIONS registry without writing anything to storage — same
  // pattern as `getMaxBossLevel` above.

  // Returns a Set of unlocked companion ids. Seeds with the starter four on
  // first read so any save predating this system still gets a usable roster.
  // Cheat-name returns the seeded set (caller should also short-circuit via
  // `isCompanionUnlocked` for any id check, which handles the cheat).
  getUnlockedCompanions() {
    let set = _readUnlockedSet()
    if (!set) {
      set = new Set(_STARTER_COMPANION_IDS)
      _writeUnlockedSet(set)
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

  // Add `id` to the unlocked set + persist. No-op if already unlocked or
  // under the cheat name (the cheat is computed, not persisted). Returns
  // true on a real first-time unlock so callers can fire a toast / SFX.
  unlockCompanion(id) {
    if (!id) return false
    if (_isCheatName(this.getName())) return false
    const set = this.getUnlockedCompanions()
    if (set.has(id)) return false
    set.add(id)
    _writeUnlockedSet(set)
    return true
  },

  // Remove every companion unlock — primarily for dev / test. Doesn't
  // touch the player's name or boss-level slot. After clearing, the next
  // `getUnlockedCompanions()` re-seeds with the starter four.
  clearCompanionUnlocks() {
    try { localStorage.removeItem(UNLOCKED_COMPANIONS_KEY) } catch {}
  },
}

const SAVE_KEY = 'quest_failed_save'
const CURRENT_VERSION = '1.1.0'

export const SaveSystem = {
  save(gameState) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(gameState))
      return true
    } catch (e) {
      console.error('[SaveSystem] Save failed:', e)
      return false
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return null
      const state = JSON.parse(raw)
      if (!state?.meta?.version) return null
      if (state.meta.version !== CURRENT_VERSION) {
        const migrated = _migrate(state)
        if (!migrated) return null
        return _rehydrateRunHistory(migrated)
      }
      return _rehydrateRunHistory(state)
    } catch (e) {
      console.error('[SaveSystem] Load failed:', e)
      return null
    }
  },

  hasSave() {
    return localStorage.getItem(SAVE_KEY) !== null
  },

  deleteSave() {
    localStorage.removeItem(SAVE_KEY)
  },
}

function _migrate(state) {
  // Future migration logic goes here as save format evolves.
  // Return null to discard saves that cannot be migrated cleanly.
  console.warn('[SaveSystem] Version mismatch — save discarded. Was:', state?.meta?.version)
  return null
}

// Phase 31I — backfill run-history fields on saves that predate the UI overhaul.
// Old saves stay version='1.0.0'; we just fill in any missing keys with safe
// defaults so the new HUD/Game Over consumers don't blow up reading them.
// Mutates and returns the same state object.
function _rehydrateRunHistory(state) {
  if (!state) return state

  state.history ??= { days: [], events: [] }
  state.history.days   ??= []
  state.history.events ??= []
  state.history.pacts  ??= []

  state.run ??= { startedAt: Date.now(), totals: {} }
  state.run.totals ??= {}
  const t = state.run.totals
  t.kills            ??= 0
  t.dmgDealt         ??= 0
  t.dmgTaken         ??= 0
  t.advsKilled       ??= 0
  t.advsEscaped      ??= 0
  t.gold             ??= 0
  t.souls            ??= 0
  t.roomsBuilt       ??= 0
  t.roomsDestroyed   ??= 0
  t.minionsSummoned  ??= 0
  t.minionsLost      ??= 0
  t.trapsPlaced      ??= 0
  t.trapsDisarmed    ??= 0

  if (Array.isArray(state.minions)) {
    for (const m of state.minions) {
      m.lifetime ??= { kills: 0, damageDealt: 0 }
      m.lifetime.kills        ??= 0
      m.lifetime.damageDealt  ??= 0
    }
  }

  // Dungeon-event scheduler slice (added 2026-05-05). Older saves predate
  // the EventSystem; safe defaults let the system schedule the first event
  // fresh on next NIGHT_PHASE_BEGAN.
  state.events ??= { nextEventDay: null, lastEventId: null, scheduledId: null }
  state.events.nextEventDay ??= null
  state.events.lastEventId  ??= null
  state.events.scheduledId  ??= null

  state.adventurers ??= { active: [], known: [], graveyard: [] }
  state.adventurers.known ??= []
  for (const a of state.adventurers.known) {
    a.escapeCount ??= 0
  }
  // active/graveyard advs may also lack escapeCount (per-instance field)
  for (const a of (state.adventurers.active   ?? [])) a.escapeCount ??= 0
  for (const a of (state.adventurers.graveyard ?? [])) a.escapeCount ??= 0

  return state
}

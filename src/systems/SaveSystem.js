const SAVE_KEY = 'quest_failed_save'
const CURRENT_VERSION = '1.0.0'

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
        return _migrate(state)
      }
      return state
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

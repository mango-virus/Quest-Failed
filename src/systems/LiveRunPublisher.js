// LiveRunPublisher — broadcasts the player's current run as a 'live'
// row on the global leaderboard, refreshed each night.
//
// One row per run, keyed by `gameState.meta.runId`. The row is
// upserted on:
//   • Run start (construction) — so it appears the moment the player
//     enters the dungeon.
//   • Every NIGHT_PHASE_STARTED — keeps days/kills/escapes current.
// On run end (GameOverOverlay._submitRun / PauseManager abandon path)
// the SAME row is upserted again with status='finished' or
// 'abandoned', completing its lifecycle. LeaderboardOverlay filters
// stale live rows client-side (no heartbeat in N min) so closed-tab
// orphans don't pollute the board.
//
// Heartbeats are fire-and-forget — network failures are swallowed in
// Leaderboard.heartbeatLiveRun, never block the game loop.
//
// To remove this feature entirely: stop constructing this class in
// Game.create() and the live-run path lapses silently (any existing
// live rows stale out naturally).

import { EventBus }     from './EventBus.js'
import { Leaderboard }  from './Leaderboard.js'
import { PlayerProfile } from './PlayerProfile.js'

export class LiveRunPublisher {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._listeners = []
    this._wireEvents()
    // Initial heartbeat — fire as soon as we're constructed so the
    // player's row appears on any open leaderboard view without
    // waiting for the first NIGHT_PHASE_STARTED transition.
    this._beat()
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
  }

  _wireEvents() {
    const on = (evt, fn) => {
      EventBus.on(evt, fn)
      this._listeners.push([evt, fn])
    }
    // Snapshot at each day flip. Cheap (1 POST per in-game day) and
    // captures days_survived / total_kills / escapes / gold etc.
    on('NIGHT_PHASE_STARTED', () => this._beat())
    // Also catch the day-start so a fresh load picks up immediately
    // even if the player never sees a night transition this session.
    on('DAY_PHASE_STARTED',   () => this._beat())
  }

  _beat() {
    try {
      const gs = this._gameState
      if (!gs?.meta?.runId)               return
      if (!gs?.player?.bossArchetypeId)   return
      const pactNames = this._resolvePactNames()
      Leaderboard.heartbeatLiveRun({
        gameState:  gs,
        playerName: PlayerProfile.getName?.() || 'ANON',
        pactNames,
      })
    } catch {
      // Swallow — heartbeats never block the game.
    }
  }

  // Resolve sealed-pact display names from dungeonMechanics.json so the
  // live row's pact chips match the finished-row chips. Falls back to a
  // humanised id when the def is missing.
  _resolvePactNames() {
    const dMechs = this._scene?.cache?.json?.get?.('dungeonMechanics') ?? []
    const pacts  = this._gameState?.history?.pacts ?? []
    return pacts.map(p => {
      const def = dMechs.find(d => d?.id === p?.mechanicId)
      if (def?.name) return def.name
      return String(p?.mechanicId || '')
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
        .trim()
    }).filter(Boolean)
  }
}

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
    // Auto-clean any OLD live row by this same player (different
    // run_id). Catches save-overwrite paths (NEW EVIL, JUMP TO DAY 50,
    // any future path) without needing per-call-site plumbing. Runs
    // at FIRST-HEARTBEAT time, not at NEW-EVIL click time, so backing
    // out of CompanionSelect before committing leaves the old row
    // untouched.
    this._abandonOldRunsByThisPlayer()
  }

  destroy() {
    // Final upsert before tearing down — backdate last_heartbeat_at so
    // the row immediately reads as PAUSED on the leaderboard instead of
    // showing as LIVE for the next ~10 minutes (until the natural
    // stale window kicks in). Quit-to-menu now reflects "this player
    // stepped away" right away.
    //
    // SAFE against finished runs: the RLS UPDATE policy on `runs` only
    // permits updates where the EXISTING row's status='live', so if
    // GameOverOverlay._submitRun or PauseManager._submitAbandonedRun
    // already flipped the row to 'finished' / 'abandoned' before our
    // shutdown fires, this upsert silently no-ops (0 rows affected).
    this._sendPauseHeartbeat()
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn)
    this._listeners = []
  }

  async _abandonOldRunsByThisPlayer() {
    try {
      const runId = this._gameState?.meta?.runId
      if (!runId) return
      const playerName = PlayerProfile.getName?.() || 'ANON'
      if (!playerName || playerName === 'ANON') return
      await Leaderboard.abandonOtherLiveRunsByPlayer(playerName, runId)
    } catch {
      // Swallow — cleanup is best-effort.
    }
  }

  _sendPauseHeartbeat() {
    try {
      const gs = this._gameState
      if (!gs?.meta?.runId)             return
      if (!gs?.player?.bossArchetypeId) return
      const pactNames = this._resolvePactNames()
      const run = Leaderboard.buildRunPayload({
        gameState:  gs,
        // status stays 'live' — the row represents an in-progress run
        // the player intends to resume. The backdated heartbeat alone
        // is what flips the leaderboard chip from LIVE to PAUSED.
        status:     'live',
        endCause:   'in_progress',
        playerName: PlayerProfile.getName?.() || 'ANON',
        pactNames,
      })
      if (!run || !run.run_id) return
      // 15 minutes ago — comfortably past the 10-min stale window in
      // LeaderboardOverlay (LB_LIVE_STALE_MS). Could read that constant
      // here but importing a HUD module from a systems module isn't
      // worth the coupling for a one-line magic number.
      run.last_heartbeat_at = new Date(Date.now() - 15 * 60 * 1000).toISOString()
      Leaderboard.submitRun(run).catch(() => null)
    } catch {
      // Swallow — pause-heartbeats are best-effort.
    }
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

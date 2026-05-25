// Leaderboard — minimal Supabase REST client for the global runs table.
//
// We talk to Supabase via the auto-generated PostgREST endpoint (no SDK
// dependency, no build step). The anon key is browser-safe — Row-Level
// Security policies on the `runs` table allow public SELECT and INSERT
// only; UPDATE and DELETE have no policies, so they're denied.
//
// Schema (created via SQL editor):
//   id, created_at, player_name, boss_id, boss_level, days_survived,
//   total_kills, gold, dark_power, end_cause, meta(jsonb)
//
// Sort order on fetch: days_survived desc, total_kills desc (tiebreak),
// created_at asc (older runs win further ties).

const SUPABASE_URL  = 'https://atodgpvdmrdjtqrzvtks.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0b2RncHZkbXJkanRxcnp2dGtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMTgwMDcsImV4cCI6MjA5MzU5NDAwN30.6OHUI6oCIr_TseFEq37PRyOTsExsGUc2bbnrlX_tf28'

const REST = `${SUPABASE_URL}/rest/v1`
const HEADERS = {
  'apikey':        SUPABASE_ANON,
  'Authorization': `Bearer ${SUPABASE_ANON}`,
  'Content-Type':  'application/json',
}

export const Leaderboard = {
  // Build a leaderboard submission payload from current gameState.
  // Shared by every submission path (death via GameOverOverlay/GameOver,
  // abandon via PauseManager) so the schema stays in one place.
  //
  // Pact display names must be resolved by the caller (they own the
  // Phaser cache reference; this helper stays scene-free). Returns null
  // when there's no boss archetype set — sub-noise filters live in the
  // caller since they're context-specific.
  //
  // endCause: 'death' | 'abandoned' | future codes — LeaderboardOverlay's
  // _thematicCause maps these to flavour phrases.
  buildRunPayload({ gameState, endCause = 'death', playerName = 'ANON', pactNames = [], status = 'finished' } = {}) {
    if (!gameState) return null
    const gs     = gameState
    const tot    = gs.run?.totals ?? {}
    const player = gs.player   ?? {}
    if (!player.bossArchetypeId) return null
    const days   = Number(player.totalDaysElapsed ?? gs.meta?.dayNumber ?? 0)
    const kills  = Number(tot.advsKilled ?? player.totalKills ?? 0)
    return {
      player_name:   String(playerName || 'ANON').trim().slice(0, 32) || 'ANON',
      boss_id:       String(player.bossArchetypeId),
      boss_level:    Number(gs.boss?.level ?? 1),
      days_survived: days,
      total_kills:   kills,
      gold:          Number(tot.gold ?? player.soulEssence ?? 0),
      dark_power:    Number(player.darkPower ?? 0),
      end_cause:     String(endCause),
      // Live-run plumbing (2026-05-25). `run_id` is the stable id from
      // gameState.meta.runId — the unique index on the runs table makes
      // upserts match this row, so a single run heartbeats one row from
      // 'live' through to 'finished' / 'abandoned' instead of inserting
      // duplicates. `status` drives the LIVE chip in LeaderboardOverlay
      // and gates the RLS UPDATE policy (only live rows are updatable).
      // `last_heartbeat_at` is set server-side via now() in heartbeats,
      // but we include the field for shape consistency on submit paths.
      status:            String(status),
      run_id:            gs.meta?.runId ?? null,
      last_heartbeat_at: new Date().toISOString(),
      meta: {
        roomsBuilt:      Number(tot.roomsBuilt ?? 0),
        minionsSummoned: Number(tot.minionsSummoned ?? 0),
        minionsLost:     Number(tot.minionsLost ?? 0),
        advsEscaped:     Number(tot.advsEscaped ?? 0),
        dmgDealt:        Number(tot.dmgDealt ?? 0),
        dmgTaken:        Number(tot.dmgTaken ?? 0),
        // leaks_count lives in meta because the schema has no dedicated
        // leaks column. LeaderboardOverlay reads it back from there.
        leaks_count:     Number(tot.intelLeaks ?? 0),
        leak_events:     Number(tot.leakEvents ?? 0),
        pacts:           Array.isArray(pactNames) ? pactNames : [],
        // Companion the player ran with this game. Display-side gating
        // lives in LeaderboardOverlay (LB_SHOW_COMPANIONS). Persisted
        // unconditionally so we don't get a data gap if the display is
        // turned off and back on later. To fully remove the feature,
        // delete this line and the LB_SHOW_COMPANIONS code block in
        // LeaderboardOverlay.
        companionId:     gs.meta?.companionId ?? null,
      },
    }
  },

  // POST or UPSERT a single run row. Returns the inserted/updated row
  // on success, throws on failure. Caller should swallow errors — a
  // missed submission shouldn't block the player from continuing.
  //
  // When `run.run_id` is set, the request is a PostgREST upsert on the
  // `run_id` unique index (resolution=merge-duplicates), so:
  //   • First heartbeat of a run → INSERT (status='live').
  //   • Subsequent heartbeats   → UPDATE the same row.
  //   • Run-end submit          → UPDATE the same row, flipping status
  //                               to 'finished' / 'abandoned'.
  // When `run_id` is null (legacy / no-runId path), it's a plain
  // INSERT — back-compat for any caller that hasn't been migrated.
  //
  // Dev-account guard: runs by "mango" (case-insensitive — same handle
  // PlayerProfile.isCheatName matches on) never post. Mango bypasses
  // every unlock gate, the 9999 gold floor, and the late-game JUMP-TO-
  // DAY-50 shortcut; including those runs in the global leaderboard
  // would muddy real-player rankings. Resolves to null silently so the
  // rest of the end-of-run flow continues normally.
  async submitRun(run) {
    if (String(run?.player_name ?? '').trim().toLowerCase() === 'mango') {
      return null
    }
    const hasRunId = !!run?.run_id
    const url = hasRunId ? `${REST}/runs?on_conflict=run_id` : `${REST}/runs`
    const prefer = hasRunId
      ? 'resolution=merge-duplicates,return=representation'
      : 'return=representation'
    const res = await fetch(url, {
      method:  'POST',
      headers: { ...HEADERS, 'Prefer': prefer },
      body:    JSON.stringify(run),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Leaderboard submit failed: ${res.status} ${body}`)
    }
    const rows = await res.json()
    return rows?.[0] ?? null
  },

  // Lightweight heartbeat — convenience wrapper around submitRun that
  // builds + sends a live-status payload. Called from LiveRunPublisher
  // on NIGHT_PHASE_STARTED (and once at run start). Fire-and-forget at
  // call sites; errors swallowed here so a flaky network never stutters
  // the game loop.
  heartbeatLiveRun(opts) {
    const run = this.buildRunPayload({ ...opts, status: 'live', endCause: 'in_progress' })
    if (!run || !run.run_id) return Promise.resolve(null)
    return this.submitRun(run).catch(() => null)
  },

  // Submit a saved-but-now-abandoned run from outside a scene context
  // (e.g., MainMenu's "ABANDON CURRENT RUN" confirm, called when the
  // player tosses a save to start fresh). Shares the noise gate +
  // pact-name resolution with PauseManager's in-scene abandon path, so
  // a leaderboard row gets flipped to status='abandoned' via the
  // existing run_id upsert — orphan 'live' rows in the DB get cleaned
  // up at the moment the player formally abandons the save.
  //
  // Returns a Promise that always resolves (never rejects) so callers
  // can fire-and-forget without try/catch boilerplate. Resolves to
  // null when the run is too thin to bother submitting (matches the
  // PauseManager noise gate: days < 3 AND kills < 5) or when there's
  // no bossArchetypeId on the gameState.
  async submitAbandonedRun(gameState) {
    try {
      if (!gameState) return null
      const tot    = gameState.run?.totals ?? {}
      const player = gameState.player ?? {}
      if (!player.bossArchetypeId) return null
      const days   = Number(player.totalDaysElapsed ?? gameState.meta?.dayNumber ?? 0)
      const kills  = Number(tot.advsKilled ?? player.totalKills ?? 0)
      // Abandon-specific noise gate (same as PauseManager): runs that
      // made almost no progress are skipped to keep clutter down.
      // The live row, if any, will stale-filter out of the leaderboard
      // naturally; clearer to never submit at all for a "I just opened
      // the game and clicked New Game" cancel.
      if (days < 3 && kills < 5) return null
      // Pact name resolution — same shape as PauseManager._submitAbandonedRun.
      // Walks any active scene's JSON cache to find dungeonMechanics.
      const scenes = window.__game?.scene?.scenes ?? []
      let dMechs = []
      for (const s of scenes) {
        const v = s?.cache?.json?.get?.('dungeonMechanics')
        if (Array.isArray(v)) { dMechs = v; break }
      }
      const pactNames = (gameState.history?.pacts ?? []).map(p => {
        const def = dMechs.find(d => d.id === p?.mechanicId)
        if (def?.name) return def.name
        return String(p?.mechanicId || '')
          .split('_')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
          .trim()
      }).filter(Boolean)
      // Player name — resolved lazily so this module stays free of
      // PlayerProfile coupling. Falls back to 'ANON' when unavailable.
      let playerName = 'ANON'
      try {
        const mod = await import('./PlayerProfile.js')
        playerName = mod?.PlayerProfile?.getName?.() || 'ANON'
      } catch {}
      const run = this.buildRunPayload({
        gameState,
        endCause:   'abandoned',
        playerName,
        pactNames,
        status:     'abandoned',
      })
      if (!run) return null
      return await this.submitRun(run).catch(() => null)
    } catch {
      return null
    }
  },

  // GET top N runs. Default sort: days desc, kills desc.
  async fetchTop(limit = 50) {
    const order = 'days_survived.desc,total_kills.desc,created_at.asc'
    const url   = `${REST}/runs?select=*&order=${order}&limit=${limit}`
    const res   = await fetch(url, { headers: HEADERS })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Leaderboard fetch failed: ${res.status} ${body}`)
    }
    return res.json()
  },
}

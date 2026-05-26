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
// Achievement bitmask (added 2026-05-25) lives inside `meta.achievement_bits`
// — a string of '0'/'1' chars in canonical id order. No schema migration
// needed (jsonb). Decoded on the read side via AchievementSystem.getOrderedIds().
//
// Sort order on fetch: days_survived desc, total_kills desc (tiebreak),
// created_at asc (older runs win further ties).

import { AchievementSystem } from './AchievementSystem.js'
import { PlayerProfile }     from './PlayerProfile.js'

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
    // Achievement bitmask — '0'/'1' string in canonical id order. The
    // receiver decodes via AchievementSystem.getOrderedIds() so the i-th
    // char maps to the i-th id. Stored under `meta.achievement_bits`
    // (jsonb) — no schema migration needed.
    const orderedIds = AchievementSystem.getOrderedIds()
    const achievementBits  = PlayerProfile.getAchievementBitmask(orderedIds)
    const achievementCount = PlayerProfile.getUnlockedAchievements().size
    // Active title — what the player has chosen to display next to their
    // run row on the leaderboard. If they haven't picked one explicitly,
    // PlayerProfile.getActiveTitle() auto-promotes the most-recently-
    // unlocked title. Sent as a plain string so the leaderboard read
    // side can render it without consulting the achievement registry;
    // `null` when the player has zero title-bearing unlocks (e.g. fresh
    // save — they keep the legacy ACCOLADES top-3 labels in that case).
    const activeTitle = PlayerProfile.getActiveTitle()
    const activeTitleName = activeTitle?.name ?? null
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
        // Achievement state at submission time. `achievement_count` is a
        // pre-decoded integer for the leaderboard chip (cheap display);
        // `achievement_bits` is the full bitmask for the viewer-modal
        // drill-down. Both can be absent on older rows — LeaderboardOverlay
        // treats missing values as zero.
        achievement_count: achievementCount,
        achievement_bits:  achievementBits,
        // Active title display string (see derivation above). Optional —
        // older rows lack this and the leaderboard view falls back to
        // the legacy IMMORTAL / BUTCHER / CUNNING accolades for top-3.
        active_title:      activeTitleName,
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

  // Flip any OTHER live rows by the same player_name (different
  // run_id) to 'abandoned'. Called from LiveRunPublisher when a new
  // run's first heartbeat fires — so save-overwrite paths (NEW EVIL,
  // JUMP TO DAY 50, future paths) auto-clean the old live row without
  // any per-call-site plumbing. Doing it at FIRST-HEARTBEAT time
  // (rather than at NEW-EVIL click time) means backing out of
  // CompanionSelect doesn't accidentally end the old run.
  //
  // Edge case: two physical players sharing a name would clobber each
  // other's live rows. Acceptable for a friend-group game with unique
  // names; revisit if collision becomes real.
  //
  // Fire-and-forget at the call site; returns the updated rows on
  // success, null on any failure (network / RLS / etc.).
  async abandonOtherLiveRunsByPlayer(playerName, currentRunId) {
    try {
      if (!playerName || !currentRunId) return null
      if (String(playerName).trim().toLowerCase() === 'mango') return null   // dev account never writes
      const url = `${REST}/runs?status=eq.live` +
        `&player_name=eq.${encodeURIComponent(playerName)}` +
        `&run_id=neq.${encodeURIComponent(currentRunId)}`
      const res = await fetch(url, {
        method:  'PATCH',
        headers: { ...HEADERS, 'Prefer': 'return=representation' },
        body:    JSON.stringify({ status: 'abandoned', end_cause: 'abandoned' }),
      })
      if (!res.ok) return null
      return await res.json().catch(() => null)
    } catch {
      return null
    }
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
    const rows = await res.json()
    // Side-effect: cache the current top-3 player names so the main
    // menu's LEADERBOARD button can paint its NEW badge without firing
    // its own fetch. The cache is global (the leaderboard is global) —
    // each per-name seen-set is compared against this same cached list.
    // Tolerant of a malformed response; only caches a usable shape.
    try {
      if (Array.isArray(rows)) {
        const top3 = rows.slice(0, 3)
          .map(r => (typeof r?.player_name === 'string' ? r.player_name : ''))
          .filter(Boolean)
        localStorage.setItem(TOP3_CACHE_KEY, JSON.stringify(top3))
      }
    } catch {}
    return rows
  },

  // Read the cached top-3 player names from the most recent `fetchTop`.
  // Returns an array of raw `player_name` strings (un-canonicalized — the
  // caller dedups via PlayerProfile's NEW-tag helpers). Returns [] if
  // no fetch has happened yet this browser. Safe to call before the
  // overlay has opened — just won't paint the badge until first fetch.
  getCachedTop3Names() {
    try {
      const raw = localStorage.getItem(TOP3_CACHE_KEY)
      if (!raw) return []
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.filter(s => typeof s === 'string') : []
    } catch { return [] }
  },
}

// Global localStorage slot — single source of truth for the most recent
// top-3 player names. Re-written on every `fetchTop` call (one call per
// leaderboard-overlay open). Used by MainMenuOverlay to paint the
// LEADERBOARD button's NEW badge without firing its own fetch.
const TOP3_CACHE_KEY = 'qf.leaderboard.last_top3'

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
  buildRunPayload({ gameState, endCause = 'death', playerName = 'ANON', pactNames = [] } = {}) {
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
      },
    }
  },

  // POST a single run row. Returns the inserted row on success, throws on
  // failure. Caller should swallow errors — a missed submission shouldn't
  // block the player from continuing.
  async submitRun(run) {
    const res = await fetch(`${REST}/runs`, {
      method:  'POST',
      headers: { ...HEADERS, 'Prefer': 'return=representation' },
      body:    JSON.stringify(run),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Leaderboard submit failed: ${res.status} ${body}`)
    }
    const rows = await res.json()
    return rows?.[0] ?? null
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

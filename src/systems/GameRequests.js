// GameRequests — Supabase REST client for the player-feedback table.
//
// Same approach as Leaderboard.js: anon-key PostgREST, no SDK, no build
// step. RLS on the server enforces validation + access policy; client
// just shapes payloads and reads results.
//
// ──────────────────────────────────────────────────────────────────────
// ONE-TIME SUPABASE SETUP — paste this into the SQL editor in the
// Supabase dashboard (Project → SQL Editor → New query), hit RUN:
//
//   create table game_requests (
//     id          uuid primary key default gen_random_uuid(),
//     created_at  timestamptz default now(),
//     player_name text not null,
//     category    text not null,    -- bug | difficulty | boss | item | companion | room | achievement | mechanic | other
//     feeling     text,             -- too_easy | too_hard | just_right (only for difficulty)
//     title       text not null,
//     body        text not null,
//     context     jsonb default '{}'::jsonb,
//     status      text default 'new',
//     notes       text
//   );
//   alter table game_requests enable row level security;
//   create policy "insert valid" on game_requests for insert with check (
//     length(title) between 5 and 80
//     and length(body) between 10 and 1500
//     and category in ('bug','difficulty','boss','item','companion','room','achievement','mechanic','other')
//     and (feeling is null or feeling in ('too_easy','too_hard','just_right'))
//   );
//   create policy "select all" on game_requests for select using (true);
//
// That's it. The table is created, RLS is enabled, and the policies
// allow anyone with the anon key to INSERT (validated) and SELECT.
// UPDATE / DELETE have no policies so they're denied — manage status /
// notes via the Supabase dashboard.
// ──────────────────────────────────────────────────────────────────────
//
// Schema notes:
//  - `category` is the request type. The 'difficulty' bucket pairs with
//    `feeling`; all other buckets leave `feeling` null.
//  - `context` is a free-form jsonb blob stamped client-side at submit
//    time so each request carries the player's day / boss / build /
//    runtime context — saves a back-and-forth "what day were you on?"
//  - `status` is a free-form admin field (managed via Supabase dash):
//    'new' / 'triaged' / 'planned' / 'shipped' / 'wontfix'.
//  - `notes` is a private admin field — never shown to other players.
//
// Anti-spam:
//  - Client side: localStorage rate-limit (1 per 60 s, 10 per day per
//    player_name). Tries first, only POSTs if under the cap.
//  - Server side: RLS check constraints enforce length + enum membership,
//    so a hostile client can't insert junk rows. Volume-floods aren't
//    blocked here — if it becomes an issue, add a Postgres function with
//    a sliding-window counter and call it via RPC.

import { PlayerProfile } from './PlayerProfile.js'

const SUPABASE_URL  = 'https://atodgpvdmrdjtqrzvtks.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0b2RncHZkbXJkanRxcnp2dGtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMTgwMDcsImV4cCI6MjA5MzU5NDAwN30.6OHUI6oCIr_TseFEq37PRyOTsExsGUc2bbnrlX_tf28'

const REST = `${SUPABASE_URL}/rest/v1`
const HEADERS = {
  'apikey':        SUPABASE_ANON,
  'Authorization': `Bearer ${SUPABASE_ANON}`,
  'Content-Type':  'application/json',
}

// localStorage keys for the per-player rate-limit tracker. Single JSON
// blob with the last-submit timestamp + a sliding 24h count, keyed on
// trimmed lowercase name so identical names share the bucket (cheaper
// than per-id and the spam vector is volume from one identity anyway).
const RATELIMIT_KEY      = 'qf.gameRequests.rateLimit'
const MIN_INTERVAL_MS    = 60_000           // 1 per minute
const DAILY_CAP          = 10               // 10 per 24h
const DAILY_WINDOW_MS    = 24 * 60 * 60 * 1000

function _readRateBuckets() {
  try {
    const raw = localStorage.getItem(RATELIMIT_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return (obj && typeof obj === 'object') ? obj : {}
  } catch { return {} }
}
function _writeRateBuckets(obj) {
  try { localStorage.setItem(RATELIMIT_KEY, JSON.stringify(obj)) } catch {}
}

// Returns null if the submission is allowed; otherwise a human-readable
// rejection reason ('Wait 42 s before sending another' / 'Daily limit
// reached — try again tomorrow').
function _rateLimitCheck(playerName) {
  const key = String(playerName ?? '').trim().toLowerCase() || 'anon'
  const now = Date.now()
  const buckets = _readRateBuckets()
  const b = buckets[key] ?? { last: 0, timestamps: [] }
  // Drop expired timestamps from the 24h window.
  const fresh = (b.timestamps ?? []).filter(t => now - t < DAILY_WINDOW_MS)
  if (now - (b.last ?? 0) < MIN_INTERVAL_MS) {
    const wait = Math.ceil((MIN_INTERVAL_MS - (now - b.last)) / 1000)
    return `Wait ${wait}s before sending another.`
  }
  if (fresh.length >= DAILY_CAP) {
    return 'You’ve hit the daily limit (10 / 24h). Try again tomorrow.'
  }
  return null
}

function _recordSubmission(playerName) {
  const key = String(playerName ?? '').trim().toLowerCase() || 'anon'
  const now = Date.now()
  const buckets = _readRateBuckets()
  const b = buckets[key] ?? { last: 0, timestamps: [] }
  const fresh = (b.timestamps ?? []).filter(t => now - t < DAILY_WINDOW_MS)
  fresh.push(now)
  buckets[key] = { last: now, timestamps: fresh }
  _writeRateBuckets(buckets)
}

// Build the auto-context jsonb stamped onto every submission. Reads
// gameState (when in-run) + PlayerProfile (always) so mango sees what
// the player was doing without needing to ask follow-up questions.
// Safe to call without a gameState — defaults to a sparse blob.
function _buildContext(gameState) {
  const gs = gameState ?? window.__game?.scene?.getScene?.('Game')?.gameState ?? null
  const meta   = gs?.meta   ?? {}
  const player = gs?.player ?? {}
  const boss   = gs?.boss   ?? {}
  let unlockedCompanions = 0
  let unlockedAchievements = 0
  try { unlockedCompanions = (PlayerProfile.getUnlockedCompanions?.()?.size) ?? 0 } catch {}
  try { unlockedAchievements = (PlayerProfile.getUnlockedAchievements?.()?.size) ?? 0 } catch {}
  return {
    day:               meta.dayNumber ?? null,
    phase:             meta.phase ?? null,
    bossArchetype:     player.bossArchetypeId ?? null,
    bossLevel:         boss.level ?? null,
    bossMaxLevelEver:  (() => { try { return PlayerProfile.getMaxBossLevel?.() ?? null } catch { return null } })(),
    totalDaysElapsed:  player.totalDaysElapsed ?? null,
    totalKills:        player.totalKills ?? gs?.run?.totals?.advsKilled ?? null,
    gold:              player.gold ?? null,
    darkPower:         player.darkPower ?? null,
    unlockedCompanions,
    unlockedAchievements,
    // newhud is the active UI surface (1 in modern DOM HUD, 0 in legacy
    // Phaser HUD); helps mango reproduce in the matching surface.
    newhud:            (() => { try { return localStorage.getItem('newhud') ?? '1' } catch { return '1' } })(),
    userAgent:         (typeof navigator !== 'undefined' && navigator.userAgent) || null,
    // Stamped at write time — useful for correlating against shipped
    // changes when reading later. Not a real build hash, but the wall
    // date the request landed is enough for triage.
    submittedAt:       new Date().toISOString(),
  }
}

export const GameRequests = {
  CATEGORIES: ['bug','difficulty','boss','item','companion','room','achievement','mechanic','other'],
  FEELINGS:   ['too_easy','too_hard','just_right'],

  // Build the row payload from form fields + auto-context. Returns null
  // if validation fails (caller should keep the form open and surface
  // an error toast).
  buildPayload({ category, feeling, title, body, gameState } = {}) {
    const playerName = (PlayerProfile.getName?.() ?? '').trim() || 'ANON'
    if (!this.CATEGORIES.includes(category)) return { error: 'Pick a category.' }
    const trimmedTitle = String(title ?? '').trim()
    const trimmedBody  = String(body ?? '').trim()
    if (trimmedTitle.length < 5)   return { error: 'Title must be at least 5 characters.' }
    if (trimmedTitle.length > 80)  return { error: 'Title must be 80 characters or fewer.' }
    if (trimmedBody.length < 10)   return { error: 'Description must be at least 10 characters.' }
    if (trimmedBody.length > 1500) return { error: 'Description must be 1500 characters or fewer.' }
    // Feeling only applies to the difficulty bucket; ignore on other
    // categories so a stale radio selection doesn't bleed in.
    let feelingOut = null
    if (category === 'difficulty') {
      if (feeling && !this.FEELINGS.includes(feeling)) {
        return { error: 'Pick how difficulty feels.' }
      }
      feelingOut = feeling || null
    }
    return {
      payload: {
        player_name: playerName,
        category,
        feeling: feelingOut,
        title:   trimmedTitle,
        body:    trimmedBody,
        context: _buildContext(gameState),
      },
    }
  },

  // Submit a row. Returns { ok: true } on success, { ok: false, error }
  // on validation / rate-limit / network failure.
  async submit({ category, feeling, title, body, gameState } = {}) {
    const built = this.buildPayload({ category, feeling, title, body, gameState })
    if (built.error) return { ok: false, error: built.error }
    const playerName = built.payload.player_name
    const rate = _rateLimitCheck(playerName)
    if (rate) return { ok: false, error: rate }
    try {
      const res = await fetch(`${REST}/game_requests`, {
        method:  'POST',
        headers: { ...HEADERS, 'Prefer': 'return=minimal' },
        body:    JSON.stringify([built.payload]),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, error: `Could not send (${res.status}). ${text}`.trim() }
      }
      _recordSubmission(playerName)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `Network error: ${err?.message ?? err}` }
    }
  },

  // Fetch recent submissions for the admin inbox. mango-gated UI-side
  // (no server-side filter — SELECT is currently open per the policy
  // above; a determined player could fetch this too, but the inbox view
  // is gated behind PlayerProfile.isCheatName()).
  //
  // opts: { limit = 100, since = null (ISO string) }
  async list({ limit = 100, since = null } = {}) {
    const params = new URLSearchParams()
    params.set('select', '*')
    params.set('order',  'created_at.desc')
    params.set('limit',  String(Math.min(Math.max(limit, 1), 500)))
    if (since) params.set('created_at', `gte.${since}`)
    try {
      const res = await fetch(`${REST}/game_requests?${params.toString()}`, {
        method:  'GET',
        headers: HEADERS,
      })
      if (!res.ok) {
        return { ok: false, error: `Could not load (${res.status}).`, rows: [] }
      }
      const rows = await res.json()
      return { ok: true, rows: Array.isArray(rows) ? rows : [] }
    } catch (err) {
      return { ok: false, error: `Network error: ${err?.message ?? err}`, rows: [] }
    }
  },
}

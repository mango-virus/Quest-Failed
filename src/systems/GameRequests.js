// GameRequests — Supabase REST client for the player-feedback table.
//
// Same approach as Leaderboard.js: anon-key PostgREST, no SDK, no build
// step. RLS on the server enforces validation + access policy; client
// just shapes payloads and reads results.
//
// ──────────────────────────────────────────────────────────────────────
// SUPABASE SETUP — paste these blocks into the SQL editor in the
// Supabase dashboard (Project → SQL Editor → New query), hit RUN.
// Both blocks are idempotent (use IF NOT EXISTS / DROP IF EXISTS) so
// running them twice is safe.
//
// ── BLOCK 1: initial table + insert/select policies ────────────────
//
//   create table if not exists game_requests (
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
//   drop policy if exists "insert valid" on game_requests;
//   create policy "insert valid" on game_requests for insert with check (
//     length(title) between 1 and 80
//     and length(body) between 1 and 1500
//     and category in ('bug','difficulty','boss','item','companion','room','achievement','mechanic','other')
//     and (feeling is null or feeling in ('too_easy','too_hard','just_right'))
//   );
//   drop policy if exists "select all" on game_requests;
//   create policy "select all" on game_requests for select using (true);
//
// ── BLOCK 2: in-game admin controls (added 2026-05-27) ─────────────
// Adds updated_at column + auto-bump trigger so player MY-MAIL inboxes
// know when a reply lands. Opens UPDATE (status / notes only) and
// DELETE policies — mango's in-game inbox uses these to flag requests
// as shipped/wontfix and to delete spam. UI-side gated by isCheatName.
//
//   alter table game_requests add column if not exists updated_at timestamptz default now();
//
//   create or replace function _bump_game_requests_updated_at() returns trigger as $$
//   begin
//     new.updated_at = now();
//     return new;
//   end;
//   $$ language plpgsql;
//
//   drop trigger if exists bump_game_requests_updated_at on game_requests;
//   create trigger bump_game_requests_updated_at
//     before update on game_requests
//     for each row execute function _bump_game_requests_updated_at();
//
//   drop policy if exists "update any" on game_requests;
//   create policy "update any" on game_requests for update
//     using (true)
//     with check (status in ('new','triaged','planned','shipped','wontfix'));
//
//   drop policy if exists "delete any" on game_requests;
//   create policy "delete any" on game_requests for delete using (true);
//
// That's it. Run both blocks (or just block 2 if you already ran
// block 1 earlier).
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

// Mail badge tracking — when did the player / admin last view their
// respective inbox? Stored per-name as an ISO timestamp. A submission's
// updated_at > playerLastSeenAt means the player has unread mail; a
// row's created_at > adminLastSeenAt means mango has a new request to
// triage. Cleared by markPlayerMailSeen / markAdminMailSeen, which
// stamp `now()`.
const PLAYER_MAIL_SEEN_KEY = 'qf.gameRequests.playerMailSeen'   // value: { '<nameLower>': ISO }
const ADMIN_MAIL_SEEN_KEY  = 'qf.gameRequests.adminMailSeen'    // value: ISO timestamp string (mango is singular)

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
    // No minimum length other than "must not be empty" — players can
    // send a one-liner if that's all they need. The maximums stay so
    // the table doesn't grow unbounded and the inbox cards still
    // render at a sane size.
    if (trimmedTitle.length === 0) return { error: 'Add a title.' }
    if (trimmedTitle.length > 80)  return { error: 'Title must be 80 characters or fewer.' }
    if (trimmedBody.length === 0)  return { error: 'Add a description.' }
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
  // opts: { limit = 100, since = null (ISO string), playerName = null }
  // When playerName is set, the query filters server-side to rows owned
  // by that name (used by the MY MAIL view).
  async list({ limit = 100, since = null, playerName = null } = {}) {
    const params = new URLSearchParams()
    params.set('select', '*')
    params.set('order',  'created_at.desc')
    params.set('limit',  String(Math.min(Math.max(limit, 1), 500)))
    if (since)      params.set('created_at',  `gte.${since}`)
    if (playerName) params.set('player_name', `eq.${playerName}`)
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

  // ── Admin actions (mango-gated UI-side) ─────────────────────────────
  // The Supabase UPDATE policy lets the anon key change any row's
  // status / notes / etc., and the server-side check constraint pins
  // status to the valid enum. mango's UI is the only surface that
  // exposes these affordances, and PlayerProfile.isCheatName() gates
  // the admin controls in GameRequestsOverlay before render.

  // Update a row by id. `patch` is { status?, notes? } — anything else
  // is dropped client-side as a soft guard (the RLS check constraint
  // also protects on the server).
  async update(id, patch = {}) {
    if (!id) return { ok: false, error: 'Missing id.' }
    const allowed = {}
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      const VALID = ['new','triaged','planned','shipped','wontfix']
      if (!VALID.includes(patch.status)) return { ok: false, error: 'Invalid status.' }
      allowed.status = patch.status
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'notes')) {
      allowed.notes = patch.notes == null ? null : String(patch.notes).slice(0, 2000)
    }
    if (Object.keys(allowed).length === 0) return { ok: false, error: 'Nothing to update.' }
    try {
      const res = await fetch(`${REST}/game_requests?id=eq.${encodeURIComponent(id)}`, {
        method:  'PATCH',
        headers: { ...HEADERS, 'Prefer': 'return=minimal' },
        body:    JSON.stringify(allowed),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, error: `Could not save (${res.status}). ${text}`.trim() }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `Network error: ${err?.message ?? err}` }
    }
  },

  // Delete a row by id. mango-only via UI gate; RLS allows it via the
  // open delete policy.
  async remove(id) {
    if (!id) return { ok: false, error: 'Missing id.' }
    try {
      const res = await fetch(`${REST}/game_requests?id=eq.${encodeURIComponent(id)}`, {
        method:  'DELETE',
        headers: { ...HEADERS, 'Prefer': 'return=minimal' },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, error: `Could not delete (${res.status}). ${text}`.trim() }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `Network error: ${err?.message ?? err}` }
    }
  },

  // ── Mail-badge tracking ─────────────────────────────────────────────
  // Two distinct mail counts:
  //   • PLAYER MAIL — rows owned by `playerName` whose updated_at is
  //     newer than the player's last MY MAIL view AND whose status has
  //     moved past 'new'. So a fresh submission doesn't fire mail
  //     against the player themselves — only mango's reply does.
  //   • ADMIN MAIL — rows whose created_at is newer than the admin's
  //     last INBOX view. New submissions count; admin edits don't.
  //
  // Both cached at module level; populated by prefetchUnreadCounts()
  // and read synchronously by hasCached* / getCached* getters. Cache
  // is per-name so flipping handles invalidates the previous count.
  _cache: { playerName: null, playerMail: 0, adminMail: 0, fetchedAt: 0 },

  _getPlayerMailSeen(playerName) {
    try {
      const raw = localStorage.getItem(PLAYER_MAIL_SEEN_KEY)
      const obj = raw ? JSON.parse(raw) : {}
      const key = String(playerName ?? '').trim().toLowerCase()
      return obj?.[key] ?? null
    } catch { return null }
  },
  _setPlayerMailSeen(playerName, isoTs) {
    try {
      const raw = localStorage.getItem(PLAYER_MAIL_SEEN_KEY)
      const obj = raw ? JSON.parse(raw) : {}
      const key = String(playerName ?? '').trim().toLowerCase()
      if (key) obj[key] = isoTs
      localStorage.setItem(PLAYER_MAIL_SEEN_KEY, JSON.stringify(obj))
    } catch {}
  },
  _getAdminMailSeen() {
    try { return localStorage.getItem(ADMIN_MAIL_SEEN_KEY) ?? null } catch { return null }
  },
  _setAdminMailSeen(isoTs) {
    try { localStorage.setItem(ADMIN_MAIL_SEEN_KEY, isoTs) } catch {}
  },

  // Stamp "right now" as the player's last-seen marker. Called when
  // GameRequestsOverlay opens the MY MAIL tab.
  markPlayerMailSeen(playerName) {
    this._setPlayerMailSeen(playerName ?? PlayerProfile.getName?.() ?? '', new Date().toISOString())
    // Zero the cached count so the next main-menu render hides the
    // chip without waiting for another prefetch.
    if (this._cache.playerName?.toLowerCase() === String(playerName ?? PlayerProfile.getName?.() ?? '').toLowerCase()) {
      this._cache.playerMail = 0
    }
  },
  // Stamp "right now" as mango's last-seen marker. Called when the
  // INBOX tab opens.
  markAdminMailSeen() {
    this._setAdminMailSeen(new Date().toISOString())
    this._cache.adminMail = 0
  },

  getCachedPlayerMail() { return this._cache.playerMail ?? 0 },
  getCachedAdminMail()  { return this._cache.adminMail  ?? 0 },

  // Fetch fresh counts and update the cache. Called by MainMenuOverlay
  // when the menu opens (and after submit / admin update). Non-blocking
  // for the caller — the menu renders immediately with the previous
  // cached counts, and a `MAIL_COUNTS_UPDATED` event fires when the
  // fetch resolves so the menu can refresh badges in place.
  async prefetchUnreadCounts({ playerName, isMango = false, onUpdated = null } = {}) {
    const name = String(playerName ?? PlayerProfile.getName?.() ?? '').trim()
    if (!name) return { playerMail: 0, adminMail: 0 }
    this._cache.playerName = name
    this._cache.fetchedAt = Date.now()

    // PLAYER MAIL — rows owned by this name that mango has touched since
    // the player last opened MY MAIL. "Touched" = status moved past 'new'
    // OR notes were written. Both are admin-only actions (players can't
    // set status or notes at submit time), so this never fires on the
    // player's own fresh submission — only on a genuine dev reply.
    //   updated_at > lastSeen      → newer than the player's last view
    //   or(status≠new, notes≠null) → mango changed status and/or replied
    let playerMail = 0
    try {
      const seen = this._getPlayerMailSeen(name) ?? new Date(0).toISOString()
      const params = new URLSearchParams()
      params.set('select', 'id,status,notes,updated_at')
      params.set('player_name', `eq.${name}`)
      params.set('updated_at', `gt.${seen}`)
      params.set('or', '(status.neq.new,notes.not.is.null)')
      params.set('limit', '100')
      const res = await fetch(`${REST}/game_requests?${params.toString()}`, { headers: HEADERS })
      if (res.ok) {
        const rows = await res.json()
        playerMail = Array.isArray(rows) ? rows.length : 0
      }
    } catch {}

    // ADMIN MAIL (mango only) — rows with created_at > admin lastSeen.
    let adminMail = 0
    if (isMango) {
      try {
        const seen = this._getAdminMailSeen() ?? new Date(0).toISOString()
        const params = new URLSearchParams()
        params.set('select', 'id,created_at')
        params.set('created_at', `gt.${seen}`)
        params.set('limit', '500')
        const res = await fetch(`${REST}/game_requests?${params.toString()}`, { headers: HEADERS })
        if (res.ok) {
          const rows = await res.json()
          adminMail = Array.isArray(rows) ? rows.length : 0
        }
      } catch {}
    }

    this._cache.playerMail = playerMail
    this._cache.adminMail  = adminMail
    try { onUpdated?.({ playerMail, adminMail }) } catch {}
    return { playerMail, adminMail }
  },
}

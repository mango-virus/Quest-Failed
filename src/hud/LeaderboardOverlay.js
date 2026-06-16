// LeaderboardOverlay — DOM port of moments.jsx → LeaderboardOverlay.
//
// Replaces the Phaser Leaderboard scene. Tab strip (GLOBAL / LIVE /
// PERSONAL), podium row (top 3 with gold/silver/bronze accolades),
// ranked table (left), detail panel (right) with portrait + KEEPER
// narrative (boss × companion) + stats + NOTABLE PACTS chips. The
// LIVE tab is gated on the LB_SHOW_LIVE_RUNS feature flag.
//
// Data source: `src/systems/Leaderboard.js` → `fetchTop(N)`. Returns
// rows shaped:
//   { id, created_at, player_name, boss_id, boss_level, days_survived,
//     total_kills, gold, dark_power, end_cause, leaks_count?, meta? }
// FRIENDS tab was removed 2026-05-19 — no friends backend yet, so the
// tab was inert. Re-add later when friends data exists.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { pixelSprite, spriteKindForDefId } from './sprites.js'
import { Leaderboard as LeaderboardAPI } from '../systems/Leaderboard.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { COMPANIONS, getCompanion } from '../systems/companions.js'
import { runCountUp } from './countUp.js'
import { EventBus } from '../systems/EventBus.js'

// Feature flag — show the companion the player used on each leaderboard
// row, on the podium card, and in the detail panel (incl. a
// boss × companion narrative line). Flip to `false` to fully hide the
// feature without deleting any code; the rows in the DB still carry
// `meta.companionId` so re-enabling later loses no data.
//
// To REMOVE entirely:
//   1. Set this flag to `false` (instant rollback).
//   2. Optional cleanup: delete the LB_SHOW_COMPANIONS code blocks in
//      this file (search for `LB_SHOW_COMPANIONS`) and the
//      `companionId:` line in Leaderboard.buildRunPayload.
const LB_SHOW_COMPANIONS = true

// Feature flag — fetch/show live (in-progress) runs alongside finished
// ones. Live rows are tagged with a LIVE chip and filtered out if the
// last heartbeat is older than LB_LIVE_STALE_MS (closed-tab orphans).
// To fully remove: set this to `false` (instant rollback). Storage
// keeps flowing — heartbeats from LiveRunPublisher still run in the
// background, so re-enabling later just starts showing them again.
const LB_SHOW_LIVE_RUNS = true
// A live row is considered stale (closed tab, crashed game) when no
// heartbeat has refreshed it in this many ms. Stale rows are silently
// dropped from the rendered board. With heartbeats firing on every
// NIGHT_PHASE_STARTED, a healthy run beats far more often than this.
const LB_LIVE_STALE_MS = 10 * 60 * 1000   // 10 minutes

// Pact rarity → chip colour. Mirrors the bright (c1) tones of the
// PactPicker tome (src/hud/PactPicker.js RARITY) so a pact reads the
// same hue everywhere it surfaces.
// Build a small boss-portrait <div> from assets/ui/bestiary/portraits/
// <id>_p.png. Used in place of the procedural pixelSprite blobs the
// leaderboard previously rendered. Falls back to pixelSprite if the
// portrait path 404s (older boss ids without baked portraits).
function _bossPortrait(bossId, size) {
  const id = String(bossId || '').replace(/^the_/, '')
  const wrap = h('div', {
    className: 'qf-lb-portrait-img',
    style: {
      width:  `${size}px`,
      height: `${size}px`,
      backgroundImage:  `url('assets/ui/bestiary/portraits/${id}_p.png')`,
      backgroundSize:   'contain',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      imageRendering:   'pixelated',
    },
  })
  return wrap
}

// Thematic cause-of-end strings. The raw `end_cause` we get from
// Supabase is typically a terse dev-code or a blunt one-liner; map it
// to richer narrative copy with per-run variety (PHRASE_POOL picked
// by run id hash so the same row always shows the same flavor but
// different rows get different lines). Falls back to a generic line.
const END_CAUSE_PHRASES = {
  boss_defeated: [
    'Slain in their own throne room — the bone-halls fell silent.',
    'A hero put steel through the boss\'s heart on the final day.',
    'The dungeon\'s master fell before the last torch guttered out.',
    'Cut down at the foot of the throne by a single relentless adventurer.',
    'Their phylactery shattered first — then they did.',
  ],
  party_wipe_too_late: [
    'Outlasted the party but bled out from a thousand wounds.',
    'The dungeon held, but the boss could not rise to greet the dawn.',
    'Stood victorious over the corpses for a single breath, then collapsed.',
  ],
  intel_leak: [
    'Bled too much intel — the next wave walked through unopposed.',
    'The Guild rebuilt their maps from survivor tales and came back ready.',
    'Word spread, walls fell — they came knowing every trap.',
  ],
  starvation: [
    'Treasury empty, dungeon thinning, the dark consumed itself.',
    'Could not afford to rebuild after a brutal raid — the next overran it.',
  ],
  abandoned: [
    'Walked away from the bone-halls — the title passed to no one.',
    'The keeper laid down their authority and was forgotten.',
  ],
  // Always-available generic pool for unknown end_cause codes.
  generic: [
    'The dungeon fell in the manner of all things mortal.',
    'A run that ended too soon, too quietly, too far from glory.',
    'The bone-halls grew silent — no chronicler recorded how.',
    'Steel, treachery, or hubris — the records do not say.',
    'They were a name in the dark, then nothing at all.',
    'The last torch guttered out before the last enemy did.',
    'They held the throne until they didn\'t.',
    'A keeper who burned bright, briefly.',
  ],
}

// Stable hash so the same run always renders the same phrase.
function _hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

// Specific leaderboard row id flagged as "pre nerf patch" — pinned by
// row id (NOT player_name) so any future submissions under the same
// "dark lord" name don't inherit the badge. Set 2026-05-25 after the
// trap-scaling halving + 75%-of-maxHp cap + bomb falloff +
// minions-per-room cap nerfs landed; this run predates all of them.
// To retire the badge, set to -1.
const PRE_NERF_ROW_ID = 18

// Map a raw end_cause into a thematic phrase. Picks deterministically
// from the appropriate phrase pool via run id, so every run keeps the
// same flavor on every leaderboard refresh.
function _thematicCause(raw, runId) {
  if (!raw) return _pick(END_CAUSE_PHRASES.generic, runId)
  const norm = String(raw).toLowerCase().trim()
  // Match against known dev codes first.
  for (const key of Object.keys(END_CAUSE_PHRASES)) {
    if (key === 'generic') continue
    if (norm.includes(key) || norm.includes(key.replace(/_/g, ' '))) {
      return _pick(END_CAUSE_PHRASES[key], runId)
    }
  }
  // If the stored cause already reads as a sentence (capital letter +
  // ends with punctuation, ≥ 20 chars), trust it and pass it through.
  if (raw.length >= 20 && /[A-Z]/.test(raw[0]) && /[.!?"]$/.test(raw)) return raw
  // Otherwise — generic pool, varied per run.
  return _pick(END_CAUSE_PHRASES.generic, runId)
}

function _pick(arr, seed) {
  if (!arr || arr.length === 0) return 'Cause unknown.'
  return arr[_hashStr(String(seed ?? '')) % arr.length]
}

const TABS = [
  { id: 'global',   label: 'GLOBAL',   icon: '◆', color: 'var(--blood)' },
  // LIVE tab — only shows status='live' rows (filtered for staleness).
  // Conditionally included so flipping LB_SHOW_LIVE_RUNS=false hides
  // the tab entirely too. Insertion order = tab order in the strip.
  ...(LB_SHOW_LIVE_RUNS
    ? [{ id: 'live', label: 'LIVE', icon: '◉', color: '#33dd66' }]
    : []),
  { id: 'personal', label: 'PERSONAL', icon: '☠', color: 'var(--gold)'  },
]

const ACCOLADES = ['IMMORTAL', 'BUTCHER', 'CUNNING']
const TOP_N = 50

function rankColor(rank) {
  if (rank === 1) return '#ffd86a'
  if (rank === 2) return '#c8c8d0'
  if (rank === 3) return '#c8884a'
  if (rank <= 10) return 'var(--text)'
  return 'var(--text-mute)'
}

export class LeaderboardOverlay {
  constructor(opts = {}) {
    this._onClose = opts.onClose ?? null
    this._tab = 'global'
    this._openRow = null   // expanded ledger row (by name) in the accordion
    this._selected = null
    this._rows = []
    this._loading = true
    this._error = null
    this._overlay = null
    this._cuCancel = null
    // Set of row ids (Supabase PK per run) that should paint a NEW chip
    // on their podium card THIS open. Computed in `_loadRows` once the
    // top-3 settles; hover-dismiss mutates it in place (so a re-render
    // via `_rerender` doesn't re-paint a chip the player just cleared
    // mid-session). Per-run identity means two runs by the same player
    // produce two independent chips that dismiss separately.
    this._newPodiumAtOpen = new Set()
    // EventBus handle for the NAME_CHANGED listener — bound in open(),
    // released in close(). Re-snapshots + re-renders if the player
    // renames while the overlay is up (so the new name's seen-set
    // drives the chips instead of the previous name's).
    this._onNameChanged = null
  }

  open() {
    if (this._overlay) return
    const body = this._renderBody()
    this._overlay = new Overlay({
      eyebrow:    'THE CHRONICLE',
      title:      'HALL OF EVIL',
      width:      1240,
      height:     836,
      accent:     'var(--gold)',
      atmosphere: true,
      footer:     this._youStandingBar(),
      onClose: () => {
        this._overlay = null
        this._cuCancel?.(); this._cuCancel = null
        if (this._onNameChanged) {
          EventBus.off('NAME_CHANGED', this._onNameChanged)
          this._onNameChanged = null
        }
        this._onClose?.()
      },
      body,
    })
    this._overlay.open()
    this._cuCancel = runCountUp(body)
    // NAME_CHANGED listener — if the player renames mid-overlay (e.g.
    // dev tools, future code paths), re-fetch + re-snapshot so the
    // podium chips reflect the NEW name's seen-set instead of the
    // previous name's. `_loadRows` is idempotent and async — it sets
    // _loading=true (no flicker since we just re-render after) and
    // re-populates _newPodiumAtOpen against the new name's data.
    this._onNameChanged = () => {
      if (!this._overlay) return
      this._loading = true
      this._loadRows()
    }
    EventBus.on('NAME_CHANGED', this._onNameChanged)
    this._loadRows()
  }

  close() { this._overlay?.close() }

  async _loadRows() {
    try {
      // Fetch enough to cover finished + every live row (fresh OR
      // stale). The per-tab filter in _filteredRows decides what's
      // shown where. With live runs disabled, we still drop them at
      // fetch-normalize time so rank numbering matches the legacy view.
      const fetchN = LB_SHOW_LIVE_RUNS ? Math.max(TOP_N + 50, 100) : TOP_N
      const rows = await LeaderboardAPI.fetchTop(fetchN)
      let prepared = rows || []
      if (!LB_SHOW_LIVE_RUNS) {
        prepared = prepared.filter(r => r?.status !== 'live')
      }
      // Normalize ALL rows (including stale-live). The VM carries
      // status + isStale; _filteredRows applies tab-specific cuts.
      // Rank here is the global fetch position; the LIVE tab re-ranks
      // its own subset so "the leading live run" reads as #1.
      this._rows = prepared.map((r, i) => this._normalize(r, i + 1))
      // NEW-tag bookkeeping for the podium. After rows normalize,
      // capture which top-3 RUN ROW IDS are NOT in the local player's
      // seen-set. Dedup is per-row (per-run), NOT per-player name — two
      // runs by the same player produce two independent chips that
      // dismiss separately. Each podium spot is its own notable thing.
      // Filters out self-rows via `r.isYou` AND a canonical-name match
      // (defense in depth: `isYou` is computed by case-sensitive ===,
      // which can miss case-mismatched player_name values).
      const top3 = (this._rows || []).slice(0, 3)
      const newSet = new Set()
      const seen   = PlayerProfile.getKnownLeaderboardIds?.() || new Set()
      const myCanon = (() => {
        const n = PlayerProfile.getName?.() ?? ''
        return typeof n === 'string' ? n.trim().toLowerCase() : ''
      })()
      for (const r of top3) {
        if (!r || r.isYou) continue
        // Coerce `r._raw.id` to a string — Supabase bigint PKs come in
        // as numbers, and the seen-set is a Set<string>, so we need a
        // string identity at every boundary (cache write, snapshot,
        // render, seen-set storage).
        const rawId = r._raw?.id
        if (rawId == null) continue
        const rowId = String(rawId)
        if (!rowId) continue
        // Belt-and-braces self-filter (canonical name compare in case
        // `isYou` missed a case-mismatched submission).
        if (myCanon) {
          const rawName = r._raw?.player_name ?? r.name ?? ''
          const canon = typeof rawName === 'string' ? rawName.trim().toLowerCase() : ''
          if (canon && canon === myCanon) continue
        }
        if (!seen.has(rowId)) newSet.add(rowId)
      }
      this._newPodiumAtOpen = newSet
      // The redesign drops the per-podium NEW chips; viewing the board IS the
      // acknowledgement, so mark the top-3 row ids known here — that clears the
      // LEADERBOARD menu badge once the player has opened the Hall.
      for (const r of top3) {
        const rawId = r?._raw?.id
        if (rawId != null) { try { PlayerProfile.markLeaderboardIdKnown?.(String(rawId)) } catch {} }
      }
      this._loading = false
    } catch (e) {
      this._error = e?.message || String(e)
      this._loading = false
    }
    if (this._rows.length > 0 && !this._selected) this._selected = this._rows[0]
    this._rerender()
  }

  _normalize(r, rank) {
    const myName = (() => {
      try { return PlayerProfile.getName?.() } catch { return null }
    })()
    // Adventurers-escaped count (column displayed as ESCAPES). Prefer
    // the explicit `advsEscaped` count, fall back to `leak_events`
    // (one per fled adv that carried intel — close approximation for
    // older rows that wrote leak_events but not advsEscaped), then 0.
    // The legacy `leaks_count` field counted INTEL ITEMS carried out,
    // not escapes, so it's NOT in the chain — better to show 0 for
    // rows that genuinely lack the data than a wildly inflated number.
    const escapes =
      r.meta?.advsEscaped ??
      r.meta?.leak_events ??
      0
    // Pact names can land in meta.pacts (preferred) or run.history.pacts.
    // Normalise to a flat array of strings so the chip renderer doesn't
    // care which shape it got.
    const rawPacts =
      r.meta?.pacts ??
      r.history?.pacts ??
      r.run?.history?.pacts ??
      []
    const pacts = Array.isArray(rawPacts)
      ? rawPacts.map(p => typeof p === 'string'
          ? p
          : (p?.name ?? p?.mechanicId ?? p?.id ?? null))
        .filter(Boolean)
      : []
    return {
      rank,
      name:  r.player_name ?? 'Unnamed',
      bossId: r.boss_id ?? null,
      boss:  spriteKindForDefId(r.boss_id),
      days:  r.days_survived ?? 0,
      kills: r.total_kills ?? 0,
      escapes,
      pacts,
      cause: _thematicCause(r.end_cause, r.id ?? r.created_at ?? r.player_name),
      date:  this._formatDate(r.created_at),
      // Player-chosen title (e.g. "The Hoarder", "Crown of Iron"). Stored
      // in the run's meta jsonb so it back-fills without a schema change.
      // The podium / detail-panel sites prefer this over the legacy
      // IMMORTAL / BUTCHER / CUNNING accolade — if a player has selected
      // (or auto-equipped) a title, it owns the slot, otherwise the top-3
      // accolade takes over so the podium never reads as bare.
      title: (typeof r.meta?.active_title === 'string' && r.meta.active_title.trim())
        ? r.meta.active_title.trim()
        : null,
      accolade: rank <= 3 ? ACCOLADES[rank - 1] : null,
      isYou: !!(myName && r.player_name === myName),
      prePatch: r.id === PRE_NERF_ROW_ID,
      // Boss level the run reached. Surfaced as "LV N" in the table
      // row, the podium card, and the detail-panel subline.
      bossLevel: Number(r.boss_level ?? 1),
      // LB_SHOW_COMPANIONS — companion id is left on the VM even when
      // the display flag is off so toggling the flag back on works
      // without re-normalising.
      companionId: r.meta?.companionId ?? null,
      // LB_SHOW_LIVE_RUNS — status drives the LIVE chip + sort tag.
      // Defaults to 'finished' so legacy rows (no column / null) render
      // exactly as before. `isStale` is true for live rows whose last
      // heartbeat is older than LB_LIVE_STALE_MS — they're "paused"
      // (player closed tab / went to menu) but the run isn't formally
      // ended. The LIVE tab shows these with a PAUSED chip; GLOBAL
      // filters them out (see _filteredRows).
      status: r.status ?? 'finished',
      isStale: (() => {
        if ((r.status ?? 'finished') !== 'live') return false
        const lastBeat = Date.parse(r.last_heartbeat_at ?? '')
        if (!Number.isFinite(lastBeat)) return true
        return (Date.now() - lastBeat) > LB_LIVE_STALE_MS
      })(),
      _raw: r,
    }
  }

  // Resolve a boss archetype's display name ("Earth Golem", "Elder
  // Lich", …) from bossArchetypes.json. Falls back to a humanised id
  // if the cache hasn't loaded or the id isn't in the registry — so
  // legacy / unknown bossIds still render readably.
  _bossDisplayName(bossId) {
    if (!bossId) return 'dungeon'
    const list = this._cachedJson('bossArchetypes') ?? []
    const def = list.find(b => b?.id === bossId)
    if (def?.name) return def.name
    return String(bossId).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
  }

  _formatDate(iso) {
    if (!iso) return 'recently'
    try {
      const d = new Date(iso)
      const diffMs = Date.now() - d.getTime()
      const days = Math.floor(diffMs / 86400000)
      if (days < 1)  return 'today'
      if (days < 2)  return 'yesterday'
      if (days < 30) return `${days} days ago`
      return d.toLocaleDateString()
    } catch { return 'recently' }
  }

  // Walk every Phaser scene's JSON cache for `key`. The leaderboard can
  // open from the main menu or in-game, so we don't assume a specific
  // scene owns the cache entry.
  _cachedJson(key) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.(key)
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
    }
    return null
  }

  _rerender() {
    if (!this._overlay) return
    // Cancel any in-flight count-up before swapping the body, then
    // re-run it on the fresh DOM (the selected keeper's stat tiles
    // count up each time the detail panel re-renders).
    this._cuCancel?.()
    const body = this._renderBody()
    this._overlay.setBody(body)
    this._overlay.setFooter?.(this._youStandingBar())
    this._cuCancel = runCountUp(body)
  }

  _selectTab(id) {
    this._tab = id
    this._rerender()
  }

  // True when the active tab changed since last render — fades the content on
  // tab switch but not on row-selection rerenders.
  _consumeTabSwap() {
    const changed = this._tab !== this._lastRenderedTab
    this._lastRenderedTab = this._tab
    return changed
  }

  _filteredRows() {
    if (this._tab === 'global') {
      // GLOBAL shows ALL rows — finished, fresh-live (green LIVE chip),
      // and stale-live (orange PAUSED chip). The chip variant makes the
      // run state obvious at a glance; nothing is hidden, so the board
      // is a complete view of every run anyone's started.
      return this._rows.slice(0, TOP_N)
    }
    // LIVE tab — every in-progress run, fresh AND paused (stale). The
    // chip variant differentiates them visually. Re-ranks 1..N within
    // the live subset so the leading active run reads as #1 on this
    // tab (accolades follow the in-tab rank).
    if (this._tab === 'live') {
      return this._rows
        .filter(r => r.status === 'live')
        .map((r, i) => ({
          ...r,
          rank:     i + 1,
          accolade: i < 3 ? ACCOLADES[i] : null,
        }))
    }
    if (this._tab === 'personal') {
      let myName = null
      try { myName = PlayerProfile.getName?.() } catch {}
      if (!myName) return []
      return this._rows.filter(r => r.name === myName)
    }
    return []
  }

  // ── Render ──────────────────────────────────────────────────────
  // ─── Render (Crypt — Hall of Evil) ──────────────────────────────
  _renderBody() {
    return h('div', { className: 'qf-lb2' }, [
      this._renderTabs(),
      this._loading
        ? h('div', { className: 'qf-lb2-empty' }, '— consulting the chronicle… —')
        : this._error
          ? h('div', { className: 'qf-lb2-empty' }, ['⚠ Could not reach the Chronicle.', h('br'), this._error])
          : this._renderContent(),
    ])
  }

  _renderTabs() {
    return h('div', { className: 'qf-lb2-tabs' },
      TABS.map(t => {
        const on = this._tab === t.id
        const icColor = on ? (t.id === 'live' ? '#33dd66' : 'var(--gold-bright)') : 'var(--text-mute)'
        return h('button', {
          className: 'qf-lb2-tab', dataset: { on: on ? 'true' : 'false' },
          on: { click: () => { this._openRow = null; this._selectTab(t.id) } },
        }, [
          h('span', { className: 'ic', style: { color: icColor } }, t.icon),
          t.label,
        ])
      }))
  }

  _renderContent() {
    const rows = this._filteredRows()
    if (!rows.length) {
      return h('div', { className: 'qf-lb2-empty' },
        this._tab === 'personal'
          ? '— no submitted runs yet. die and you shall be remembered. —'
          : this._tab === 'live'
            ? '— no live runs right now. begin a dungeon to claim the throne. —'
            : '— the chronicle is empty. —')
    }
    const top3 = rows.slice(0, 3)
    const rest = rows.slice(3)
    return h('div', { className: `qf-lb2-content${this._consumeTabSwap() ? ' qf-tab-swap' : ''}` }, [
      this._renderPodium(top3),
      rest.length ? this._renderLedger(rest, rows.length) : null,
    ])
  }

  _renderPodium(top3) {
    // Visual order: #2 (left), #1 (center, bigger), #3 (right).
    const order = [[top3[1], 2], [top3[0], 1], [top3[2], 3]]
    return h('div', { className: 'qf-lb2-pods' },
      order.map(([e, place]) => e ? this._podCard(e, place) : h('div', null)))
  }

  _podCard(e, place) {
    const c = rankColor(place)
    const portraitSize = place === 1 ? 84 : place === 2 ? 70 : 48
    const titleText = e.title || e.accolade
    return h('div', {
      className: `qf-lb2-pod p${place}${e.isYou ? ' you' : ''}`,
      style: { '--rc': c },
    }, [
      e.status === 'live' && h('span', { className: 'sil live' + (e.isStale ? ' stale' : '') }, e.isStale ? 'PAUSED' : 'LIVE'),
      h('div', { className: 'potop' }, [
        h('div', { className: 'frame' }, [this._portrait(e.bossId, portraitSize)]),
        h('div', { className: 'poinfo' }, [
          h('div', { className: 'pix rkbadge' }, [
            place === 1 && h('span', { className: 'cr' }, '♛'),
            h('span', null, '#' + String(place).padStart(2, '0')),
          ]),
          h('div', { className: 'pix nm' }, e.name),
          titleText && h('div', { className: 'sil ti' }, titleText),
          h('div', { className: 'sil kp' }, 'KEEPER · ' + this._compName(e.companionId)),
        ]),
      ]),
      this._podStats(e),
    ])
  }

  _podStats(e) {
    const st = (label, val, color) => h('span', null, [
      h('i', null, label),
      h('b', { style: color ? { color } : undefined }, String(val)),
    ])
    return h('div', { className: 'stats' }, [
      st('LV', e.bossLevel, 'var(--gold)'),
      st('DAYS', e.days),
      st('KILLS', e.kills, 'var(--blood-glow)'),
      st('ESC', e.escapes, e.escapes ? 'var(--warn)' : 'var(--text-dim)'),
    ])
  }

  _renderLedger(rest, total) {
    return h('div', null, [
      h('div', { className: 'qf-lb2-ledgerhead' }, [
        h('span', { className: 'pix t' }, 'THE LESSER DAMNED'),
        h('span', { className: 'ln' }),
        h('span', { className: 'sil m' }, `RANKS 04—${String(total).padStart(2, '0')}`),
      ]),
      h('div', { className: 'qf-lb2-rows' }, rest.map(r => this._ledgerRow(r))),
    ])
  }

  _ledgerRow(r) {
    const c = rankColor(r.rank)
    const isOpen = this._openRow === r.name
    const titleText = r.title || r.accolade
    const stat = (label, val, color) => h('span', { className: 's' }, [
      h('i', null, label),
      h('span', { style: color ? { color } : undefined }, String(val)),
    ])
    return h('div', {
      className: 'qf-lb2-tab-row',
      dataset: { you: r.isYou ? 'true' : 'false', open: isOpen ? 'true' : 'false' },
      style: { '--rc': c },
    }, [
      h('button', {
        className: 'qf-lb2-r',
        on: { click: () => { this._openRow = isOpen ? null : r.name; this._rerender() } },
      }, [
        h('span', { className: 'pix qf-lb2-rnum' }, String(r.rank)),
        h('span', { className: 'qf-lb2-rart' }, [this._portrait(r.bossId, 30)]),
        h('span', { className: 'qf-lb2-rmid' }, [
          h('span', { className: 'pix qf-lb2-rname', style: { color: r.isYou ? 'var(--gold-bright)' : 'var(--text)' } }, [
            r.name,
            r.isYou && h('span', { className: 'sil qf-lb2-ryou' }, 'YOU'),
            titleText && h('span', {
              className: 'sil',
              style: { fontSize: '8px', letterSpacing: '.1em', color: c, border: `1px solid ${c}`, padding: '1px 6px' },
            }, titleText),
          ]),
          h('span', { className: 'sil qf-lb2-rsub' }, [
            h('span', null, this._bossDisplayName(r.bossId)),
            h('span', { style: { color: 'var(--line-2)' } }, '·'),
            h('span', { className: 'kp' }, this._compName(r.companionId)),
            r.status === 'live' && h('span', { className: 'qf-lb2-rlive' + (r.isStale ? ' stale' : '') }, r.isStale ? 'PAUSED' : 'LIVE'),
          ]),
        ]),
        h('span', { className: 'pix qf-lb2-rstats' }, [
          stat('LV', r.bossLevel, 'var(--gold)'),
          stat('DAYS', r.days),
          stat('KILLS', r.kills, 'var(--blood-glow)'),
          stat('ESC', r.escapes, r.escapes ? 'var(--warn)' : 'var(--text-dim)'),
        ]),
        h('span', { className: 'qf-lb2-chev' }, '▶'),
      ]),
      isOpen && h('div', { className: 'qf-lb2-exp' }, [
        h('div', { className: 'sil qf-lb2-keeper' },
          `KEEPER · ${this._compName(r.companionId)} · ${this._bossDisplayName(r.bossId)}`),
        r.pacts?.length
          ? h('div', { className: 'qf-lb2-pacts' }, r.pacts.map((p, i) => {
              const pc = ['#ffd86a', '#e2a6f2', '#86e89a'][i % 3]
              return h('span', { className: 'sil qf-lb2-pact', style: { color: pc, borderColor: pc } }, p)
            }))
          : h('div', { className: 'sil', style: { color: 'var(--text-dim)', fontSize: '8px' } }, 'NO PACTS SEALED'),
      ]),
    ])
  }

  // YOUR STANDING footer plinth — the player's GLOBAL rank (independent of tab).
  _youStandingBar() {
    const you = (this._rows || []).find(r => r.isYou)
    if (!you) {
      return h('div', { className: 'sil', style: { color: 'var(--text-dim)', fontSize: '9px', letterSpacing: '.1em' } },
        '— no submitted run yet · die and be remembered —')
    }
    const st = (label, val, color) => h('span', { className: 'st' }, [
      h('i', null, label), h('b', { style: color ? { color } : undefined }, String(val)),
    ])
    return h('div', { className: 'qf-lb2-you' }, [
      h('span', { className: 'sil badge' }, 'YOUR STANDING'),
      h('span', { className: 'pix rk' }, '#' + String(you.rank).padStart(2, '0')),
      h('span', { className: 'pt' }, [this._portrait(you.bossId, 26)]),
      h('span', { className: 'pix nm' }, you.name),
      (you.title || you.accolade) && h('span', { className: 'sil ti' }, you.title || you.accolade),
      h('span', { className: 'sp' }),
      st('LV', you.bossLevel, 'var(--gold)'),
      st('DAYS', you.days),
      st('KILLS', you.kills, 'var(--blood-glow)'),
      st('ESC', you.escapes, you.escapes ? 'var(--warn)' : 'var(--text-dim)'),
    ])
  }

  // ─── small helpers ──────────────────────────────────────────────
  _compName(id) {
    if (!id) return '—'
    try { const c = getCompanion(id); if (c?.name) return c.name } catch {}
    return '—'
  }

  _portrait(bossId, size) {
    const clean = String(bossId || '').replace(/^the_/, '')
    return h('img', {
      src: `assets/ui/bestiary/portraits/${clean}_p.png`,
      alt: '',
      style: { width: `${size}px`, height: `${size}px`, objectFit: 'contain', imageRendering: 'pixelated', display: 'block' },
      on: { error: (e) => { e.currentTarget.style.visibility = 'hidden' } },
    })
  }

  destroy() { this.close() }
}

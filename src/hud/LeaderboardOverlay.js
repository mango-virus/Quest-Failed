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

import { h, mount } from './dom.js'
import { Overlay } from './Overlay.js'
import { pixelSprite, spriteKindForDefId } from './sprites.js'
import { Leaderboard as LeaderboardAPI } from '../systems/Leaderboard.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { COMPANIONS, getCompanion } from '../systems/companions.js'
import { runCountUp } from './countUp.js'

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
const RARITY_COLOR = {
  common:    '#d8d2c0',
  uncommon:  '#86e89a',
  rare:      '#ffd86a',
  epic:      '#e2a6f2',
  legendary: '#ff8a96',
}

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
    this._selected = null
    this._rows = []
    this._loading = true
    this._error = null
    this._overlay = null
    this._cuCancel = null
  }

  open() {
    if (this._overlay) return
    const body = this._renderBody()
    this._overlay = new Overlay({
      title:    'CHRONICLE · HALL OF EVIL',
      width:    1300,
      height:   840,
      accent:   'var(--gold)',
      animation: 'unfurl',
      onClose: () => {
        this._overlay = null
        this._cuCancel?.(); this._cuCancel = null
        this._onClose?.()
      },
      body,
    })
    this._overlay.open()
    this._cuCancel = runCountUp(body)
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

  // LB_SHOW_LIVE_RUNS — chip beside an in-progress run's name. Two
  // visual variants:
  //   • Fresh heartbeat → green pulsing "LIVE" (player is right now).
  //   • Stale heartbeat → orange static "PAUSED" (closed tab / saved
  //     and walked away, but never formally ended the run). Only ever
  //     rendered in the LIVE tab — the GLOBAL board filters stale
  //     rows out entirely so it doesn't read as a fake-active player.
  // Small "LV N" badge for the run's peak boss level. Used on table
  // rows so progression depth reads at a glance without opening the
  // detail panel. Defensive: a missing / non-positive level renders
  // nothing rather than "LV 0".
  _bossLevelChip(level) {
    const lv = Number(level)
    if (!Number.isFinite(lv) || lv < 1) return null
    return h('span', {
      className: 'pix qf-lb-bosslvl-chip',
      title: `Boss reached level ${lv}.`,
      style: {
        display: 'inline-block',
        marginLeft: '6px',
        padding: '1px 5px',
        background: 'var(--bg-0)',
        color: 'var(--gold)',
        border: '1px solid var(--gold)',
        fontSize: '7px',
        letterSpacing: '0.5px',
        verticalAlign: 'middle',
        textShadow: '0 0 4px rgba(255,228,136,0.45)',
      },
    }, `LV ${lv}`)
  }

  _liveChip(opts = {}) {
    if (!LB_SHOW_LIVE_RUNS) return null
    const paused = !!opts.paused
    // `inline: false` strips the left margin used for sitting beside
    // a name — call with `{ inline: false }` when placing the chip on
    // its own row (e.g., above the podium DAYS/KILLS stats block).
    const inline = opts.inline !== false
    const label = paused ? 'PAUSED' : 'LIVE'
    const accent = paused ? '#ff9933' : '#33dd66'
    const glow   = paused ? 'rgba(255,153,51,0.65)' : 'rgba(51,221,102,0.75)'
    return h('span', {
      className: 'pix qf-lb-live-chip',
      title: paused
        ? 'Run in progress but no heartbeat in the last 10 minutes — the player has stepped away.'
        : 'Run in progress — actively playing.',
      style: {
        display: 'inline-block',
        marginLeft: inline ? '6px' : '0',
        padding: '1px 5px',
        background: accent,
        color: '#0a0e16',
        border: '1px solid #0a0e16',
        fontSize: '7px',
        letterSpacing: '0.5px',
        verticalAlign: 'middle',
        boxShadow: `0 0 6px ${glow}`,
        // Pulse only on LIVE — PAUSED stays static so the eye reads
        // "not currently moving" at a glance.
        animation: paused ? null : 'qf-lb-live-pulse 1.6s ease-in-out infinite',
      },
    }, label)
  }

  // ── LB_SHOW_COMPANIONS — companion chip (icon + name) ────────────────
  // Returns null when the feature is off or the row predates the
  // feature (no companionId). `size` controls the icon px; `compact`
  // hides the name text for the tightest spots.
  _companionChip(companionId, opts = {}) {
    if (!LB_SHOW_COMPANIONS || !companionId) return null
    if (!COMPANIONS[companionId]) return null
    const c = getCompanion(companionId)
    const size = opts.size ?? 14
    const compact = !!opts.compact
    const fontSize = opts.fontSize ?? 8
    const src = `${c.spriteDir}${c.restExpr}.webp`
    return h('span', {
      className: 'pix qf-lb-companion-chip',
      title: `Keeper: ${c.name}`,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        marginLeft: '6px',
        padding: '1px 5px 1px 2px',
        border: '1px solid var(--line-2)',
        background: 'var(--bg-0)',
        verticalAlign: 'middle',
        fontSize: `${fontSize}px`,
        color: 'var(--text-mute)',
        letterSpacing: '0.5px',
      },
    }, [
      h('img', {
        src,
        alt: c.name,
        style: {
          width: `${size}px`,
          height: `${size}px`,
          objectFit: 'cover',
          objectPosition: '50% 0%',  // crop to head/shoulders
          imageRendering: 'auto',
          borderRadius: '50%',
          background: 'var(--bg-1)',
        },
        // Hide the chip entirely if the sprite 404s — never show a
        // broken-image box on the leaderboard.
        onerror: (e) => { const p = e.currentTarget?.parentNode; if (p) p.style.display = 'none' },
      }),
      !compact && h('span', null, c.name.toUpperCase()),
    ])
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

  // LB_SHOW_COMPANIONS — detail-panel Keeper field + a one-line
  // boss × companion narrative. Sentence pattern reads like a small
  // chronicle entry instead of a stat row, so the run feels like a
  // story (rather than a row of numbers).
  _renderDetailCompanion(sel) {
    const c = getCompanion(sel.companionId)
    // sel.boss is the SPRITE KIND (used to pick the portrait art), not
    // the boss display name — and the mapping can collapse multiple
    // archetypes onto one sprite, so reading `sel.boss` here would give
    // wrong names (e.g. Earth Golem rendered as "Imp"). Resolve the
    // display name from bossArchetypes.json keyed on `sel.bossId`
    // (the raw archetype id); humanise the id as a final fallback.
    const bossWord = this._bossDisplayName(sel.bossId)
    const days = sel.days || 0
    const dayWord = days === 1 ? 'day' : 'days'
    // Narrative is past-tense — every row on the board represents a
    // finished (or abandoned) run. (Previously this read `sel.cause`
    // to maybe flip to "stands" for indefinite endings, but no live
    // end_cause phrase ever matched the check, and the cause field
    // has been removed from the panel entirely.)
    const narrative = `This dungeon stood for ${days} ${dayWord} under the ${bossWord}, with ${c.name} at their side.`
    return h('div', {
      className: 'qf-lb-detail-keeper',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 8px',
        margin: '6px 0',
        border: '1px solid var(--line-2)',
        background: 'var(--bg-1)',
      },
    }, [
      h('img', {
        src: `${c.spriteDir}${c.restExpr}.webp`,
        alt: c.name,
        style: {
          width: '28px',
          height: '28px',
          objectFit: 'cover',
          objectPosition: '50% 0%',
          borderRadius: '50%',
          background: 'var(--bg-0)',
          flex: '0 0 auto',
        },
        onerror: (e) => { const p = e.currentTarget?.parentNode; if (p) p.style.display = 'none' },
      }),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } }, [
        h('div', {
          className: 'pix',
          style: { fontSize: '8px', color: 'var(--text-mute)', letterSpacing: '0.5px' },
        }, `KEEPER · ${c.name.toUpperCase()}`),
        h('div', {
          style: {
            fontSize: '11px',
            color: 'var(--text)',
            fontStyle: 'italic',
            lineHeight: 1.3,
          },
        }, narrative),
      ]),
    ])
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

  // Lazy lookup of pact identifier → rarity. Keyed by BOTH the lowercased
  // display name and the raw id so it resolves whichever shape
  // _normalize() left in the pacts array. Built from dungeonMechanics.json.
  _pactRarityMap() {
    if (this._rarityMap) return this._rarityMap
    const map = {}
    for (const m of (this._cachedJson('dungeonMechanics') ?? [])) {
      const rar = String(m?.rarity ?? '').toLowerCase()
      if (!rar) continue
      if (m.id)   map[String(m.id).toLowerCase()]   = rar
      if (m.name) map[String(m.name).toLowerCase()] = rar
    }
    // Only memoise once the cache actually had the data — guards against
    // an early open before Preload finished registering the JSON.
    if (Object.keys(map).length > 0) this._rarityMap = map
    return map
  }

  // Resolve a pact string (display name or id) to its rarity chip colour.
  // Unknown / unmatched pacts fall back to the common tone.
  _pactColor(pact) {
    const key = String(pact ?? '').trim().toLowerCase()
    const rar = this._pactRarityMap()[key]
    return RARITY_COLOR[rar] ?? RARITY_COLOR.common
  }

  _rerender() {
    if (!this._overlay) return
    // Cancel any in-flight count-up before swapping the body, then
    // re-run it on the fresh DOM (the selected keeper's stat tiles
    // count up each time the detail panel re-renders).
    this._cuCancel?.()
    const body = this._renderBody()
    this._overlay.setBody(body)
    this._cuCancel = runCountUp(body)
  }

  _selectTab(id) {
    this._tab = id
    this._rerender()
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
  _renderBody() {
    return h('div', { className: 'qf-lb-body' }, [
      // Tab strip
      h('div', { className: 'qf-lb-tabstrip' },
        TABS.map(t => {
          const active = this._tab === t.id
          return h('button', {
            className: 'qf-lb-tab',
            dataset: { active: active ? 'true' : 'false' },
            style: { '--tab-color': t.color },
            on: { click: () => this._selectTab(t.id) },
          }, [
            h('span', {
              className: 'pix qf-lb-tab-icon',
              style: { color: t.color },
            }, t.icon),
            h('span', { className: 'pix qf-lb-tab-label' }, t.label),
          ])
        })
      ),
      this._loading
        ? h('div', { className: 'qf-lb-loading' },
            'The Chronicle gathers itself…')
        : this._error
          ? h('div', { className: 'qf-lb-error' }, [
              h('div', null, '⚠ Could not reach the Chronicle.'),
              h('div', { className: 'qf-lb-error-msg' }, this._error),
            ])
          : this._renderContent(),
    ])
  }

  _renderContent() {
    const rows = this._filteredRows()
    if (rows.length === 0) {
      return h('div', { className: 'qf-lb-empty' },
        this._tab === 'personal'
          ? '— no submitted runs yet. die and you shall be remembered. —'
          : this._tab === 'live'
            ? '— no live runs right now. begin a dungeon to claim the throne. —'
            : '— no entries in this view —')
    }
    const top3 = rows.slice(0, 3)
    return h('div', { className: 'qf-lb-content' }, [
      // Podium row (top 3)
      h('div', { className: 'qf-lb-podium' }, [
        top3[1] ? this._podiumCard(top3[1], 2) : h('div', { className: 'qf-lb-podium-empty' }),
        top3[0] ? this._podiumCard(top3[0], 1) : h('div', { className: 'qf-lb-podium-empty' }),
        top3[2] ? this._podiumCard(top3[2], 3) : h('div', { className: 'qf-lb-podium-empty' }),
      ]),
      // Main two-column
      h('div', { className: 'qf-lb-main' }, [
        // Table
        h('div', { className: 'panel bevel qf-lb-tablepanel' }, [
          h('div', { className: 'panel-head' }, [
            h('div', { className: 'title' }, 'ALL TIME RANKINGS'),
            h('div', { className: 'meta' }, `${rows.length} OF ${this._rows.length}`),
          ]),
          h('div', { className: 'qf-lb-tablehead' }, [
            h('span', { style: { textAlign: 'right' } }, '#'),
            h('span'),
            h('span', null, 'KEEPER'),
            h('span', { style: { textAlign: 'right', color: 'var(--gold)' } }, 'LV'),
            h('span', { style: { textAlign: 'right' } }, 'DAYS'),
            h('span', { style: { textAlign: 'right', color: 'var(--blood)' } }, 'KILLS'),
            h('span', { style: { textAlign: 'right', color: 'var(--warn)' } }, 'ESCAPES'),
          ]),
          h('div', { className: 'qf-lb-tablebody' },
            rows.map(r => this._tableRow(r))
          ),
        ]),
        // Detail
        this._renderDetail(this._selected || rows[0]),
      ]),
    ])
  }

  _podiumCard(entry, place) {
    const c = rankColor(place)
    const active = this._selected === entry
    // LB_SHOW_COMPANIONS — when a companion is shown, the card flips to
    // a horizontal layout: [big keeper sprite on the left | existing
    // boss/name/stats column on the right]. Cards without a companion
    // (legacy rows) keep the original vertical layout.
    const showCompanion = LB_SHOW_COMPANIONS && entry.companionId && COMPANIONS[entry.companionId]
    const cardStyle = {
      '--rank-color': c,
      background: active
        ? `linear-gradient(180deg, ${c}26, var(--bg-2) 60%)`
        : 'linear-gradient(180deg, var(--bg-2), var(--bg-1))',
      borderColor: active ? c : 'var(--line-2)',
      borderTop: `3px solid ${c}`,
      boxShadow: active
        ? `0 0 20px ${c}55, 0 4px 0 rgba(0,0,0,0.5)`
        : '0 4px 0 rgba(0,0,0,0.5)',
    }
    if (showCompanion) {
      cardStyle.display = 'flex'
      cardStyle.flexDirection = 'row'
      cardStyle.alignItems = 'stretch'
      cardStyle.gap = '10px'
    }
    // The existing column of card content (rank → boss → name → accolade)
    // is wrapped in its own flex column so the keeper sprite can sit
    // alongside it without disturbing internal alignment. When the
    // keeper is shown, the days/kills stats move into the keeper block
    // (left side) — see _podiumCompanionSprite. When no keeper, stats
    // stay here in their original spot.
    const contentColumn = h('div', {
      style: showCompanion
        ? { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 1 auto', minWidth: 0 }
        : null,
    }, [
      h('div', {
        className: 'pix qf-lb-podium-badge',
        style: {
          borderColor: c, color: c,
          boxShadow: `0 0 12px ${c}66`,
          textShadow: `0 0 6px ${c}`,
        },
      }, `#${place}`),
      h('div', {
        className: 'qf-lb-podium-sprite',
        style: { borderColor: c },
      }, _bossPortrait(entry.bossId, place === 1 ? 80 : 64)),
      h('div', {
        className: 'pix qf-lb-podium-name',
        style: {
          color: c,
          fontSize: place === 1 ? '15px' : '13px',
          textShadow: `0 0 6px ${c}66`,
        },
      }, entry.name),
      // BOSS LV now renders as a framed box in the right-side stats
      // block (see _podiumStatsBlock) — matches the visual language
      // of the DAYS / KILLS frames stacked next to it.
      // Days/kills only stay here in the legacy (no-keeper) layout.
      // With a keeper, stats move to their own framed block on the
      // RIGHT side (see _podiumStatsBlock) so the card reads as
      // [keeper | hero | stats] — three matching framed panels.
      !showCompanion && h('div', { className: 'pix qf-lb-podium-stats' }, [
        h('span', null, `${entry.days}d`),
        h('span', { style: { color: 'var(--blood)' } }, `${entry.kills} KILLS`),
      ]),
      // Title-or-accolade: player-chosen title (e.g. "The Hoarder")
      // takes the slot when present; otherwise the legacy IMMORTAL /
      // BUTCHER / CUNNING accolade fills it for top-3 podium ranks.
      // Older runs with neither render the slot empty (no chip).
      (entry.title || entry.accolade) && h('div', {
        className: 'pix qf-lb-podium-accolade',
        style: { color: c, borderColor: c },
      }, entry.title || entry.accolade),
    ])
    return h('button', {
      className: 'qf-lb-podium-card',
      dataset: { place, active: active ? 'true' : 'false' },
      style: cardStyle,
      on: { click: () => { this._selected = entry; this._rerender() } },
    }, [
      showCompanion ? this._podiumCompanionSprite(entry, place) : null,
      contentColumn,
      // Right-side stats block — mirrors the keeper block's width so
      // the content column sits visually centred. Same framed-panel
      // styling as the keeper sprite frame so the card reads as a
      // balanced [keeper | hero | stats] triptych.
      showCompanion ? this._podiumStatsBlock(entry, place) : null,
    ])
  }

  // LB_SHOW_COMPANIONS — right-side framed stats panel for the podium
  // card. Two stacked mini-frames (DAYS / KILLS) styled to match the
  // keeper sprite's framing (rank-coloured border + glow). Sized to
  // mirror the keeper block on the opposite side so the centre column
  // stays centred.
  _podiumStatsBlock(entry, place) {
    const accent = rankColor(place)
    // Mirror the keeper block's width so the centre column stays centred.
    const w = place === 1 ? 84 : 64
    const labelStyle = {
      fontSize: '6px',
      color: 'var(--text-mute)',
      letterSpacing: '0.5px',
    }
    const valueFontSize = place === 1 ? '11px' : '9px'
    const miniFrame = (labelText, valueNode, frameColor, glowColor) => h('div', {
      style: {
        background: 'var(--bg-1)',
        border: `1px solid ${frameColor}`,
        boxShadow: `0 0 4px ${glowColor}`,
        padding: '2px 4px 3px',
        textAlign: 'center',
        width: '100%',
        boxSizing: 'border-box',
      },
    }, [
      h('div', { className: 'pix', style: labelStyle }, labelText),
      valueNode,
    ])
    return h('div', {
      className: 'qf-lb-podium-stats-block',
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        gap: '4px',
        flex: '0 0 auto',
        width: `${w}px`,
        padding: '2px',
      },
    }, [
      // LB_SHOW_LIVE_RUNS — chip sits ABOVE the stat frames so the run
      // state reads top-down with the numbers. Centred horizontally;
      // `inline: false` strips the chip's default left-margin (which
      // was for sitting beside a name).
      entry.status === 'live'
        ? h('div', {
            style: { display: 'flex', justifyContent: 'center', marginBottom: '2px' },
          }, this._liveChip({ paused: entry.isStale, inline: false }))
        : null,
      // BOSS LV — sits at the TOP of the stack so progression depth
      // reads first. Gold-tinted (rank colour for top-3) to mark it as
      // the "headline" stat while DAYS / KILLS carry the run details.
      entry.bossLevel >= 1 ? miniFrame(
        'BOSS LV',
        h('div', {
          className: 'pix',
          style: {
            fontSize: valueFontSize,
            color: accent,
            textShadow: `0 0 4px ${accent}88`,
            marginTop: '1px',
          },
        }, String(entry.bossLevel)),
        `${accent}88`,
        `${accent}33`,
      ) : null,
      miniFrame(
        'DAYS',
        h('div', {
          className: 'pix',
          style: {
            fontSize: valueFontSize,
            color: 'var(--text)',
            textShadow: `0 0 4px ${accent}66`,
            marginTop: '1px',
          },
        }, String(entry.days)),
        `${accent}88`,
        `${accent}33`,
      ),
      miniFrame(
        'KILLS',
        h('div', {
          className: 'pix',
          style: {
            fontSize: valueFontSize,
            color: 'var(--blood)',
            textShadow: '0 0 4px rgba(255,68,88,0.6)',
            marginTop: '1px',
          },
        }, String(entry.kills)),
        'rgba(255,68,88,0.55)',
        'rgba(255,68,88,0.25)',
      ),
    ])
  }

  // LB_SHOW_COMPANIONS — big keeper sprite block for the podium card's
  // left side. Per-place sizing so the #1 keeper reads as the biggest.
  // Self-contained so removing the feature is one delete.
  _podiumCompanionSprite(entry, place) {
    const c = getCompanion(entry.companionId)
    const accent = rankColor(place)
    const w = place === 1 ? 84 : 64
    return h('div', {
      className: 'qf-lb-podium-keeper',
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: '4px',
        flex: '0 0 auto',
        // Outer block has no background / border / padding — just lays
        // out the sprite + name + stats. The yellow frame around the
        // sprite itself is the only chrome, and it lives on the <img>
        // below.
        padding: '2px',
        background: 'transparent',
      },
    }, [
      h('img', {
        src: `${c.spriteDir}${c.restExpr}.webp`,
        alt: c.name,
        style: {
          width: `${w}px`,
          // Tall aspect so the head + shoulders + a bit of chest read.
          // Companions are framed quite differently across the four
          // sprite sets; cover + top-anchor keeps them all centred on
          // the face.
          height: `${Math.round(w * 1.15)}px`,
          objectFit: 'cover',
          objectPosition: '50% 0%',
          imageRendering: 'auto',
          background: 'var(--bg-1)',
          border: `1px solid ${accent}88`,
          boxShadow: `0 0 8px ${accent}33`,
        },
        // Hide the keeper block entirely if the sprite 404s — never
        // ship a broken-image box. Removing the parent keeps the card
        // gracefully reflowing to its no-companion layout.
        onerror: (e) => { const p = e.currentTarget?.parentNode; if (p) p.style.display = 'none' },
      }),
      h('div', {
        className: 'pix',
        style: {
          color: accent,
          fontSize: place === 1 ? '9px' : '8px',
          letterSpacing: '0.5px',
          textShadow: `0 0 4px ${accent}66`,
        },
      }, c.name.toUpperCase()),
    ])
  }

  _tableRow(r) {
    const c = rankColor(r.rank)
    const active = this._selected === r
    return h('button', {
      className: 'qf-lb-row',
      dataset: { active: active ? 'true' : 'false', isyou: r.isYou ? 'true' : 'false' },
      style: {
        '--row-color': c,
        background: r.isYou
          ? 'linear-gradient(90deg, rgba(255,68,88,0.18), var(--bg-2))'
          : active
            ? `linear-gradient(90deg, ${c}22, var(--bg-3))`
            : 'transparent',
        borderLeft: r.isYou
          ? '3px solid var(--blood)'
          : active ? `3px solid ${c}` : '3px solid transparent',
      },
      on: { click: () => { this._selected = r; this._rerender() } },
    }, [
      h('span', {
        className: 'pix qf-lb-row-rank',
        style: { color: c, textShadow: r.rank <= 3 ? `0 0 6px ${c}` : 'none' },
      }, String(r.rank)),
      h('div', { className: 'qf-lb-row-sprite' }, _bossPortrait(r.bossId, 24)),
      h('div', { className: 'qf-lb-row-textcol' }, [
        h('div', {
          className: 'pix qf-lb-row-name',
          style: { color: r.isYou ? 'var(--blood)' : 'var(--text)' },
        }, [
          r.name,
          r.isYou && h('span', { className: 'pix qf-lb-row-youtag' }, ' · YOU'),
          // LB_SHOW_COMPANIONS — companion chip beside the name.
          this._companionChip(r.companionId, { size: 12, fontSize: 7 }),
          // LB_SHOW_LIVE_RUNS — green LIVE / orange PAUSED chip placed
          // AFTER the companion chip so the status reads last (most
          // recent state of the run).
          r.status === 'live' ? this._liveChip({ paused: r.isStale }) : null,
          r.prePatch && h('span', {
            className: 'pix',
            style: {
              marginLeft: '6px',
              padding: '1px 5px',
              background: '#b03a48',
              color: '#fff8e8',
              border: '1px solid #2a0a0c',
              fontSize: '7px',
              letterSpacing: '0.5px',
              verticalAlign: 'middle',
              boxShadow: '0 0 4px rgba(176,58,72,0.7)',
            },
          }, 'PRE NERF PATCH'),
        ]),
      ]),
      h('span', {
        className: 'pix qf-lb-row-cell',
        style: { color: 'var(--gold)' },
      }, String(r.bossLevel)),
      h('span', { className: 'pix qf-lb-row-cell' }, String(r.days)),
      h('span', {
        className: 'pix qf-lb-row-cell',
        style: { color: 'var(--blood)' },
      }, String(r.kills)),
      h('span', {
        className: 'pix qf-lb-row-cell',
        style: { color: r.escapes > 0 ? 'var(--warn)' : 'var(--text-dim)' },
      }, String(r.escapes)),
    ])
  }

  _renderDetail(sel) {
    if (!sel) {
      return h('div', { className: 'panel bevel qf-lb-detail qf-lb-detail-empty' },
        '— select a keeper to see their chronicle —')
    }
    const c = rankColor(sel.rank)
    return h('div', { className: 'panel bevel qf-lb-detail' }, [
      // Portrait + rank
      h('div', {
        className: 'qf-lb-detail-head',
        dataset: { isyou: sel.isYou ? 'true' : 'false' },
        style: {
          background: sel.isYou
            ? 'linear-gradient(180deg, rgba(255,68,88,0.18), rgba(255,68,88,0.04))'
            : 'var(--bg-0)',
          borderColor: sel.isYou ? 'var(--blood)' : 'var(--line-2)',
          boxShadow: sel.isYou ? '0 0 18px rgba(255,68,88,0.3)' : 'none',
        },
      }, [
        h('div', {
          className: 'qf-lb-detail-portrait',
          style: {
            borderColor: c,
            boxShadow: `0 0 14px ${c}55`,
          },
        }, _bossPortrait(sel.bossId, 56)),
        h('div', { className: 'qf-lb-detail-info' }, [
          h('div', { className: 'qf-lb-detail-rankrow' }, [
            h('span', {
              className: 'pix qf-lb-detail-rank',
              style: { color: c, textShadow: `0 0 8px ${c}55` },
            }, `#${String(sel.rank).padStart(2, '0')}`),
            // Title-or-accolade — same fallback rule as the podium card.
            (sel.title || sel.accolade) && h('span', {
              className: 'pix qf-lb-detail-accolade',
              style: { color: c, borderColor: c },
            }, sel.title || sel.accolade),
            sel.isYou && h('span', { className: 'pix qf-lb-detail-youtag' }, 'YOU'),
          ]),
          h('div', {
            className: 'pix qf-lb-detail-name',
            style: { color: sel.isYou ? 'var(--blood)' : 'var(--text)' },
          }, sel.name),
          h('div', { className: 'pix qf-lb-detail-sub' },
            `${String(sel.boss).toUpperCase()} · LV ${sel.bossLevel} · ${sel.date}`),
        ]),
      ]),
      // LB_SHOW_COMPANIONS — boss × companion narrative line + Keeper
      // field. Sits between the head and the stat grid. Renders nothing
      // when the row predates the feature (no companionId) or the flag
      // is off.
      LB_SHOW_COMPANIONS && sel.companionId && COMPANIONS[sel.companionId]
        ? this._renderDetailCompanion(sel)
        : null,
      // Stat grid. Skull glyph removed from KILLS at user request —
      // the personal-tab tab icon still uses ☠. KILLS uses a sword
      // mark so the trio (◇ DAYS · ⚔ KILLS · ↗ ESCAPES) reads as three
      // distinct beats without redundancy.
      h('div', { className: 'qf-lb-detail-stats' }, [
        this._detailStat('DAYS',    sel.days,    'var(--text)',  '◇'),
        this._detailStat('KILLS',   sel.kills,   'var(--blood)', '⚔'),
        this._detailStat('ESCAPES', sel.escapes, 'var(--warn)',  '↗'),
      ]),
      // Cause-of-end block removed at user request — the thematic phrase
      // wasn't earning its space alongside the keeper narrative + stats.
      // Notable pacts. Pulled from the normalized `sel.pacts` array
      // which _normalize() now walks across every plausible source
      // location (meta.pacts, history.pacts, run.history.pacts) so the
      // chips populate regardless of which writer path saved the row.
      // Show ALL pacts the run sealed — the chips container is
      // flex-wrap so a long list just takes more rows; the detail panel
      // scrolls (overflow:auto in styles.css) when needed.
      h('div', { className: 'qf-lb-detail-pacts' }, [
        h('div', { className: 'pix qf-lb-pacts-label' }, '◇ NOTABLE PACTS'),
        h('div', { className: 'qf-lb-pacts-chips' },
          sel.pacts && sel.pacts.length > 0
            ? sel.pacts.map(p => {
                // Tint the chip by the pact's rarity (common → legendary).
                const color = this._pactColor(p)
                return h('span', {
                  className: 'pix qf-lb-pact-chip',
                  style: {
                    color,
                    borderColor: `${color}99`,
                    background:  `${color}1f`,
                    textShadow:  `0 0 6px ${color}55`,
                  },
                }, String(p).toUpperCase())
              })
            : [h('span', {
                className: 'pix qf-lb-pact-chip',
                style: {
                  fontStyle: 'italic',
                  opacity: 0.55,
                  borderStyle: 'dashed',
                },
              }, '— NO PACTS SEALED —')]
        ),
      ]),
    ])
  }

  _detailStat(label, value, color, icon) {
    return h('div', { className: 'qf-lb-stat' }, [
      h('span', {
        className: 'pix qf-lb-stat-icon',
        style: { color, opacity: 0.4 },
      }, icon),
      h('div', {
        className: 'pix qf-lb-stat-value cu',
        style: { color, textShadow: `0 0 8px ${color}55` },
      }, String(value)),
      h('div', { className: 'pix qf-lb-stat-label' }, label),
    ])
  }

  destroy() { this.close() }
}

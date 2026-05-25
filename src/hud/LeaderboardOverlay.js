// LeaderboardOverlay — DOM port of moments.jsx → LeaderboardOverlay.
//
// Replaces the Phaser Leaderboard scene. Tab strip (GLOBAL / PERSONAL),
// podium row (top 3 with gold/silver/bronze accolades), ranked table
// (left), detail panel (right) with portrait + stats + CAUSE OF END
// callout + NOTABLE PACTS chips + VIEW FULL CHRONICLE.
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
import { runCountUp } from './countUp.js'

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
      const rows = await LeaderboardAPI.fetchTop(TOP_N)
      this._rows = (rows || []).map((r, i) => this._normalize(r, i + 1))
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
    // Leak count can land under several keys depending on which writer
    // path saved the row. Walk every plausible location so leaks always
    // show even when the older fetch shape uses different naming.
    const leaks =
      r.meta?.leaks_count ??
      r.meta?.leaks ??
      r.leaks_count ??
      r.leaks ??
      r.run?.totals?.advsEscaped ??
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
      leaks,
      pacts,
      cause: _thematicCause(r.end_cause, r.id ?? r.created_at ?? r.player_name),
      date:  this._formatDate(r.created_at),
      accolade: rank <= 3 ? ACCOLADES[rank - 1] : null,
      isYou: !!(myName && r.player_name === myName),
      prePatch: r.id === PRE_NERF_ROW_ID,
      _raw: r,
    }
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
    if (this._tab === 'global') return this._rows
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
            h('span', { style: { textAlign: 'right' } }, 'DAYS'),
            h('span', { style: { textAlign: 'right', color: 'var(--blood)' } }, 'KILLS'),
            h('span', { style: { textAlign: 'right', color: 'var(--warn)' } }, 'LEAKS'),
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
    return h('button', {
      className: 'qf-lb-podium-card',
      dataset: { place, active: active ? 'true' : 'false' },
      style: {
        '--rank-color': c,
        background: active
          ? `linear-gradient(180deg, ${c}26, var(--bg-2) 60%)`
          : 'linear-gradient(180deg, var(--bg-2), var(--bg-1))',
        borderColor: active ? c : 'var(--line-2)',
        borderTop: `3px solid ${c}`,
        boxShadow: active
          ? `0 0 20px ${c}55, 0 4px 0 rgba(0,0,0,0.5)`
          : '0 4px 0 rgba(0,0,0,0.5)',
      },
      on: { click: () => { this._selected = entry; this._rerender() } },
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
      }, _bossPortrait(entry.bossId, place === 1 ? 56 : 44)),
      h('div', {
        className: 'pix qf-lb-podium-name',
        style: {
          color: c,
          fontSize: place === 1 ? '12px' : '10px',
          textShadow: `0 0 6px ${c}66`,
        },
      }, entry.name),
      entry.prePatch && h('div', {
        className: 'pix',
        style: {
          display: 'inline-block',
          marginTop: '4px',
          padding: '2px 6px',
          background: '#b03a48',
          color: '#fff8e8',
          border: '1px solid #2a0a0c',
          fontSize: place === 1 ? '9px' : '8px',
          letterSpacing: '0.5px',
          boxShadow: '0 0 6px rgba(176,58,72,0.8)',
          textShadow: 'none',
        },
      }, 'PRE NERF PATCH'),
      h('div', { className: 'pix qf-lb-podium-stats' }, [
        h('span', null, `${entry.days}d`),
        // Skull glyph removed at user request — kill count reads plain.
        h('span', { style: { color: 'var(--blood)' } }, `${entry.kills} KILLS`),
      ]),
      entry.accolade && h('div', {
        className: 'pix qf-lb-podium-accolade',
        style: { color: c, borderColor: c },
      }, entry.accolade),
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
        h('div', { className: 'qf-lb-row-cause' }, r.cause),
      ]),
      h('span', { className: 'pix qf-lb-row-cell' }, String(r.days)),
      h('span', {
        className: 'pix qf-lb-row-cell',
        style: { color: 'var(--blood)' },
      }, String(r.kills)),
      h('span', {
        className: 'pix qf-lb-row-cell',
        style: { color: r.leaks > 0 ? 'var(--warn)' : 'var(--text-dim)' },
      }, String(r.leaks)),
    ])
  }

  _renderDetail(sel) {
    if (!sel) {
      return h('div', { className: 'panel bevel qf-lb-detail qf-lb-detail-empty' },
        '— select a keeper to see their chronicle —')
    }
    const c = rankColor(sel.rank)
    const survived = sel.cause.toLowerCase().includes('indef')
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
            sel.accolade && h('span', {
              className: 'pix qf-lb-detail-accolade',
              style: { color: c, borderColor: c },
            }, sel.accolade),
            sel.isYou && h('span', { className: 'pix qf-lb-detail-youtag' }, 'YOU'),
          ]),
          h('div', {
            className: 'pix qf-lb-detail-name',
            style: { color: sel.isYou ? 'var(--blood)' : 'var(--text)' },
          }, sel.name),
          h('div', { className: 'pix qf-lb-detail-sub' },
            `${String(sel.boss).toUpperCase()} · ${sel.date}`),
        ]),
      ]),
      // Stat grid. Skull glyph removed from KILLS at user request —
      // the personal-tab tab icon still uses ☠. KILLS uses a sword
      // mark so the trio (◇ DAYS · ⚔ KILLS · ⚠ LEAKS) reads as three
      // distinct beats without redundancy.
      h('div', { className: 'qf-lb-detail-stats' }, [
        this._detailStat('DAYS',  sel.days,  'var(--text)',  '◇'),
        this._detailStat('KILLS', sel.kills, 'var(--blood)', '⚔'),
        this._detailStat('LEAKS', sel.leaks, 'var(--warn)',  '⚠'),
      ]),
      // Cause of end
      h('div', {
        className: 'qf-lb-detail-cause',
        style: {
          borderLeft: `3px solid ${survived ? 'var(--gold)' : 'var(--blood)'}`,
        },
      }, [
        h('div', { className: 'pix qf-lb-cause-label' },
          survived ? '◇ FINAL STANDING' : '☠ CAUSE OF END'),
        h('div', { className: 'qf-lb-cause-text' }, sel.cause),
      ]),
      // Notable pacts. Pulled from the normalized `sel.pacts` array
      // which _normalize() now walks across every plausible source
      // location (meta.pacts, history.pacts, run.history.pacts) so the
      // chips populate regardless of which writer path saved the row.
      // Show up to 4; render a single italic placeholder when the run
      // genuinely sealed no pacts.
      h('div', { className: 'qf-lb-detail-pacts' }, [
        h('div', { className: 'pix qf-lb-pacts-label' }, '◇ NOTABLE PACTS'),
        h('div', { className: 'qf-lb-pacts-chips' },
          sel.pacts && sel.pacts.length > 0
            ? sel.pacts.slice(0, 4).map(p => {
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
      // View full chronicle — placeholder for the per-run event log
      // feature. The leaderboard summary doesn't carry the full journal
      // yet, so the button is shown in a disabled "coming soon" state
      // (tooltip + greyed style) rather than firing a no-op click. When
      // per-run logs ship, drop the disabled flag and wire the handler.
      h('button', {
        className: 'btn qf-lb-fullchron qf-lb-fullchron--disabled',
        disabled: true,
        'aria-disabled': 'true',
        title: 'Coming soon — per-run chronicles will be recorded in a future update.',
      }, [
        h('span', { style: { color: 'var(--gold)' } }, '▶ '),
        'VIEW FULL CHRONICLE',
        h('span', { className: 'qf-lb-fullchron-soon' }, ' (coming soon)'),
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

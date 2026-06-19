// AchievementsOverlay — the Hall of Trophies. Player's-eye view of the
// 45-achievement set. Opened from the main menu's ACHIEVEMENTS item +
// (in Phase C) from the per-row 🏆 chip on the leaderboard.
//
// Layout:
//   HEADER   — eyebrow line ◆ HALL OF TROPHIES ◆, big title, counter
//              "13 / 45 unlocked".
//   TABS     — All · Progression · Combat · Economy · Variety · Mastery.
//   GRID     — scrollable grid of achievement cards. Each card shows the
//              category glyph, name, description, optional progress bar,
//              optional reward chip. Locked cards greyscale + fade.
//   FOOTER   — BACK button.
//
// Viewer modes:
//   • self (default) — `unlockedSet` comes from PlayerProfile;
//     in-progress numeric metrics show their current progress.
//   • other (Phase C) — `unlockedSet` comes from another player's
//     leaderboard-row bitmask. Progress bars now show too, sourced
//     from the career-metric snapshot submitted with their row
//     (meta.ach_metrics → viewer.metrics). Rows submitted before the
//     snapshot existed fall back to a partial snapshot derived from
//     their run-summary columns (boss level / days) — see
//     _achMetricsFromRow. Optional "Compare with you" toggle re-colours
//     the cards by both/their-edge/your-edge.
//
// State lives in AchievementSystem (data + progress tracking) and
// PlayerProfile (persisted unlock set). This overlay is pure DOM display.

import { h } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { HudSfx, installHudSfxDelegates } from './HudSfx.js'
import { Overlay }           from './Overlay.js'
import { AchievementSystem } from '../systems/AchievementSystem.js'
import { PlayerProfile }     from '../systems/PlayerProfile.js'
import { rankColor as _rankColor, bossPortrait, dismissNewChip } from './hudShared.js'
import { Leaderboard }       from '../systems/Leaderboard.js'
import { COMPANIONS, getCompanion, COMPANION_ORDER } from '../systems/companions.js'
import { titleFxClassById, titleFxBorderClassById, titleColorById,
         titleFxClassByName, titleFxBorderClassByName, titleColorByName } from './titleFx.js'

// Filter tabs. The LEADERBOARD entry is intentionally NOT in this list —
// it's its own prominent button (see `_render` below) so it reads as a
// destination rather than a filter.
//
// `companions` + `titles` are reward-based pseudo-tabs (not `category`
// values): companions = achievements whose reward unlocks a companion;
// titles = achievements that grant a title. `mastery` is still a real
// category (the legendary showcase). The old progression / combat /
// economy / variety category tabs were removed 2026-05-28 — those
// achievements still exist + keep their category (for icon tint), they
// just live under ALL now. See `_defMatchesTab`.
const TABS = [
  { id: 'all',         label: 'ALL' },
  { id: 'companions',  label: 'COMPANIONS' },
  { id: 'titles',      label: 'TITLES' },
  { id: 'mastery',     label: 'MASTERY' },
]

// Difficulty TIER for the card border + shelves. Fully data-driven: each
// achievement carries `tier: 'gold' | 'silver' | 'bronze'` in achievements.json
// (gold = legendary/hard, silver = medium, bronze = easy/early). gold also drives
// the showcase shimmer + the bigger unlock toast. Defaults to silver if unset.
function achievementTier(def) {
  return def?.tier ?? 'silver'
}

// Pseudo-tab id for the leaderboard view. Stored in `_activeTab` so the
// rest of the render plumbing (active highlight, view selection) can
// branch on it without a separate boolean.
const LEADERBOARD_TAB = 'leaderboard'
// How many rows to pull from Supabase when building the achievement
// leaderboard. We over-fetch beyond the displayed top-50 because the
// runs table holds MULTIPLE rows per player (one per submitted run);
// deduplication by player_name only keeps the latest, so we need a
// buffer to ensure we capture enough distinct players.
const LB_FETCH_LIMIT = 500
const LB_DISPLAY_LIMIT = 50

// Boss-portrait + rank-colour come from the shared hud helpers (P4-2). The
// achievement leaderboard uses its own frame class on the portrait tile.
const _bossPortrait = (bossId, size) => bossPortrait(bossId, size, 'qf-ach-lb-portrait-img')

// Default fallback icons by category (overridden per-achievement when
// the data file specifies an `icon`). Same vocab the data file uses so
// nothing is hard-coded here that the JSON can't override.
const CATEGORY_FALLBACK_ICON = {
  progression: '▲',
  combat:      '✦',
  economy:     '◇',
  variety:     '✧',
  mastery:     '★',
}

// Per-category icon tint inside the medallion disc (crypt redesign).
const AC_CAT_COLOR = {
  progression: 'var(--gold)',
  combat:      'var(--blood-glow)',
  economy:     'var(--gold)',
  variety:     'var(--info)',
  mastery:     'var(--gold-bright)',
}

// Tier shelves — GOLD / SILVER / BRONZE, keyed off the data-driven `tier` field.
const AC_SHELVES = [
  { tier: 'gold',   label: 'GOLD',   glyph: '✦', color: '#ffd86a' },
  { tier: 'silver', label: 'SILVER', glyph: '◆', color: '#c8c8d0' },
  { tier: 'bronze', label: 'BRONZE', glyph: '◇', color: '#c8884a' },
]

// Tier is data-driven — each achievement def carries `tier` in
// `src/data/achievements.json`. The grid card renderer reads `tier === 'gold'`
// for the showcase shimmer, and ToastQueue reads the same to fire the bigger
// "RARE TROPHY" toast + particle burst when a gold one unlocks.

// Always-accessible starter counts. Used to compute "total ACCESS"
// stats on the podium card (starters + achievement-unlocked). Keep in
// sync with the actual game data:
//   • Boss archetypes — `src/data/bossArchetypes.json` has 12; 9 of
//     those gate behind boss-level-2..10 achievements (golem, lich,
//     lizardman, myconid, orc, vampire, wraith, succubus, slime), so
//     3 are starters (beholder, demon, gnoll).
//   • Companions — `src/systems/companions.js` `STARTER_COMPANIONS`
//     is [lilith, malakor, safira] (3). Zul'Gath unlocks via Hoard
//     Lord; Nocturna is deferred (no unlock condition yet) so she's
//     excluded from the denominator.
const STARTER_BOSS_COUNT      = 3
const STARTER_COMPANION_COUNT = 3

export class AchievementsOverlay {
  // Constructor signature matches LeaderboardOverlay / SettingsOverlay —
  // `{ onClose }` callback fires when the player clicks BACK / ESC so
  // the caller can null its handle. Optional `viewer` is the Phase-C
  // hook for showing another player's grid; Phase B ships self only.
  constructor(opts = {}) {
    this._el          = null     // body root inside the Overlay shell
    this._overlay     = null     // Overlay shell instance
    this._onClose     = opts.onClose || null
    this._viewer      = opts.viewer || null
    this._compareMode = false
    this._activeTab   = 'all'
    this._titleOpen   = false     // rail equipped-title picker open state
    this._defs        = AchievementSystem.getDefinitions()
    // Leaderboard-tab state. Lazily fetched on first activation; cached
    // for the rest of the overlay's lifetime so re-entering the tab is
    // instant. `null` = not yet fetched, `[]` = fetched but empty.
    this._lbRows         = null
    this._lbLoading      = false
    this._lbError        = null
    // Viewer-modal handle for the drill-in path. Click a player row in
    // the leaderboard view → instantiate a SECOND AchievementsOverlay
    // in viewer mode for that player. We retain a reference so close()
    // can tear it down cleanly.
    this._playerViewer   = null
    // Achievement IDs that were UNSEEN at the moment `open()` ran. Per-
    // card rendering reads this to decide whether to paint the NEW chip.
    // open() recomputes it from PlayerProfile.getKnownAchievementIds()
    // and then marks the current id list as seen, so the next open of
    // this overlay (and the main-menu badge) sees them as known.
    this._newAtOpen      = new Set()
  }

  // Open as a centered popup using the shared `Overlay` shell — same
  // dimensions (1300×840), accent (`var(--gold)`), and `unfurl`
  // animation that `LeaderboardOverlay` uses, so the two overlays
  // visually pair as sibling Hall-of-X screens. Esc / backdrop-click
  // / close-X are all handled by the shell.
  open() {
    if (this._overlay) return
    installHudSfxDelegates()
    ensureStageScaled()
    // Mark the overlay as seen for the current player — clears the
    // "NEW" badge next to the ACHIEVEMENTS button on the main menu.
    // Skip in viewer mode (drilled into another player's grid via
    // leaderboard click) — that doesn't count as the player having
    // engaged with the achievements page in self-view.
    if (!this._viewer) {
      // Legacy binary "ever opened" flag — preserved for backward compat
      // with any older code paths still reading it (none should remain).
      PlayerProfile.markAchievementsSeen()
      // Capture the pre-open seen-set into the in-memory snapshot used
      // by per-card rendering. The chip is painted on every card whose
      // id is NOT in this set. Hovering an individual card (mouseenter
      // on `.qf-ach-card`) is the ONLY thing that dismisses its chip —
      // it adds the id to PlayerProfile's persisted set AND to this
      // in-memory snapshot, then fades the chip out. Opening the popup
      // does NOT bulk-mark anything (intentional — the player asked for
      // explicit per-card acknowledgement). The main-menu badge logic
      // (`PlayerProfile.hasUnseenNewAchievements`) automatically clears
      // once the player has hovered every flagged card, since it reads
      // the same per-id seen-set from disk.
      this._newAtOpen = new Set()
      const knownIds  = PlayerProfile.getKnownAchievementIds()
      for (const def of this._defs) {
        if (def?.id && !knownIds.has(def.id)) this._newAtOpen.add(def.id)
      }
    } else {
      this._newAtOpen = new Set()
    }
    this._el = this._renderBody()
    this._keyHandler = (e) => this._onKey(e)
    this._overlay = new Overlay({
      eyebrow:    'THE RECKONING',
      title:      this._viewer
        ? `${this._viewer.name.toUpperCase()}'S TROPHIES`
        : 'HALL OF TROPHIES',
      width:      1340,
      height:     844,
      accent:     'var(--gold)',
      atmosphere: true,
      onClose:    () => this._onOverlayClose(),
      body:       this._el,
    })
    this._overlay.open()
    // Arrow-key tab cycling. The Overlay shell already binds Esc; this
    // is only for ←/→ category navigation. Bound on window so it works
    // regardless of which child element has focus.
    window.addEventListener('keydown', this._keyHandler)
    // Kick off the leaderboard fetch eagerly (not just when the LB tab
    // activates) so rarity stats can populate on every card in the
    // category grid too. Cached after first fetch for the rest of the
    // overlay's lifetime. Self-view only — viewer mode doesn't need this.
    if (!this._viewer && this._lbRows == null && !this._lbLoading) {
      this._loadLeaderboard()
    }
  }

  close() {
    // Delegate to the shell — its onClose fires `_onOverlayClose` which
    // does the teardown work.
    this._overlay?.close()
  }

  // Centralized teardown — fires when the Overlay shell closes for any
  // reason (close button, Esc, backdrop click, programmatic close).
  _onOverlayClose() {
    // Tear down a nested viewer overlay if the player had drilled into
    // another player's grid.
    this._playerViewer?.close?.()
    this._playerViewer = null
    // Arrow-key tab cycling listener.
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler)
      this._keyHandler = null
    }
    // Tear down the title-picker outside-click handler if it's still
    // bound. Picker is normally closed via _selectTitle / _toggleTitlePicker,
    // but the player can close the whole overlay while the picker is
    // open — without this cleanup the document-level click listener leaks.
    if (this._outsideClickHandler) {
      document.removeEventListener('click', this._outsideClickHandler)
      this._outsideClickHandler = null
    }
    this._el      = null
    this._overlay = null
    this._onClose?.()
  }

  // ── render ────────────────────────────────────────────────────────────
  // Builds the body content that lives INSIDE the Overlay shell's
  // modal box. The shell provides the dim backdrop, the centered modal
  // chrome (border, shadow, header bar with title + close X), and Esc /
  // backdrop-click affordances — so the body just needs the counter
  // band, title chip, tabs row, recent strip, and the view wrap.
  // ─── Render (Crypt — Hall of Trophies) ──────────────────────────
  _renderBody() {
    return h('div', { className: 'qf-ac' }, [
      this._acRail(),
      this._acHall(),
    ])
  }

  _rerenderBody() {
    if (!this._overlay) return
    this._el = this._renderBody()
    this._overlay.setBody(this._el)
  }

  // ── dossier rail ──
  _acRail() {
    const unlocked = this._unlockedSet()
    const total = this._defs.length
    const pct = total ? Math.round((unlocked.size / total) * 100) : 0
    const inLb = this._activeTab === LEADERBOARD_TAB
    return h('div', { className: 'qf-ac-rail' }, [
      // trophy-ladder toggle (leaderboard view)
      !this._viewer && h('div', {
        className: 'pix qf-ac-lbbtn' + (inLb ? ' on' : ''),
        on: { click: () => {
          this._activeTab = inLb ? 'all' : LEADERBOARD_TAB
          if (!inLb && this._lbRows == null && !this._lbLoading) this._loadLeaderboard()
          this._rerenderBody()
        } },
      }, inLb ? '◀  BACK TO TROPHIES' : '🏆 TROPHY LADDER'),
      // completion sigil
      this._acSigil(pct, unlocked.size, total),
      // equipped title plate
      this._acTitlePlate(),
      // vault breakdown (tier bars)
      this._acVault(unlocked),
      // recent unlocks
      this._acRecent(),
    ])
  }

  _acSigil(pct, n, total) {
    return h('div', { className: 'qf-ac-sigil' }, [
      h('div', { className: 'qf-ac-ring', style: { '--pct': String(pct) } }, [
        h('div', { className: 'pc' }, [
          h('b', { className: 'pix' }, pct + '%'),
          h('i', { className: 'sil' }, 'SWORN'),
        ]),
      ]),
      h('div', { className: 'pix qf-ac-count' }, [h('b', null, String(n)), ` / ${total} TROPHIES`]),
    ])
  }

  _acTitlePlate() {
    if (this._viewer) return null
    const active = PlayerProfile.getActiveTitle()
    if (!active) return null
    const titles = PlayerProfile.getUnlockedTitles()
    const fxCls   = titleFxClassById(active.id)
    const fxBord  = titleFxBorderClassById(active.id)
    const tColor  = fxBord ? null : titleColorById(active.id)
    const activeId = PlayerProfile.getActiveTitleId()
    return h('div', {
      className: 'qf-ac-tplate' + (this._titleOpen ? ' open' : ''),
      on: { click: () => { this._titleOpen = !this._titleOpen; this._rerenderBody() } },
    }, [
      h('div', { className: 'sil l' }, '✦ EQUIPPED TITLE'),
      h('div', { className: 'row' }, [
        h('span', {
          className: ('pix n ' + fxCls).trimEnd(),
          style: tColor ? { color: tColor } : undefined,
        }, active.name),
        h('span', { className: 'cv' }, `${titles.length} ▾`),
      ]),
      this._titleOpen && h('div', { className: 'qf-ac-picker', on: { click: (e) => e.stopPropagation() } }, [
        h('button', {
          className: 'pix qf-ac-prow' + (activeId == null ? ' on' : ''),
          on: { click: () => this._acSelectTitle(null) },
        }, '◇ AUTO'),
        ...titles.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)).map(t => {
          const fc = titleFxClassById(t.id)
          const tc = fc ? null : titleColorById(t.id)
          return h('button', {
            className: ('pix qf-ac-prow ' + fc).trimEnd() + (activeId === t.id ? ' on' : ''),
            style: tc ? { color: tc } : undefined,
            on: { click: () => this._acSelectTitle(t.id) },
          }, '✦ ' + t.name)
        }),
      ]),
    ])
  }

  _acSelectTitle(id) {
    PlayerProfile.setActiveTitleId(id)
    HudSfx.playUi('hover')
    this._titleOpen = false
    this._rerenderBody()
  }

  _acVault(unlocked) {
    return h('div', { className: 'qf-ac-tiers' }, [
      h('div', { className: 'sil hd' }, 'VAULT BREAKDOWN'),
      ...AC_SHELVES.map(s => {
        const items = this._defs.filter(d => achievementTier(d) === s.tier)
        const have = items.filter(d => unlocked.has(d.id)).length
        const pct = items.length ? (have / items.length) * 100 : 0
        return h('div', { className: 'qf-ac-trow' }, [
          h('div', { className: 'sil top' }, [
            h('span', { style: { color: s.color } }, `${s.glyph} ${s.label}`),
            h('span', { style: { color: 'var(--text-mute)' } }, `${have}/${items.length}`),
          ]),
          h('div', { className: 'bar' }, [
            h('div', { className: 'fill', style: { width: pct + '%', background: s.color, boxShadow: `0 0 6px ${s.color}88` } }),
          ]),
        ])
      }),
    ])
  }

  _acRecent() {
    const recent = (PlayerProfile.getRecentUnlocks?.(4) || [])
      .map(r => ({ ...r, def: AchievementSystem.getDefinition(r.id) }))
      .filter(x => x.def)
    if (!recent.length) return null
    return h('div', { className: 'qf-ac-recent' }, [
      h('div', { className: 'sil hd' }, 'RECENT UNLOCKS'),
      ...recent.map(r => h('div', { className: 'qf-ac-ritem' }, [
        h('span', { className: 'ic' }, r.def.icon || '◆'),
        h('div', null, [
          h('div', { className: 'pix n' }, r.def.name),
          h('div', { className: 't' }, this._formatRelative(r.ts)),
        ]),
      ])),
    ])
  }

  // ── trophy hall (filters + tier shelves, OR the trophy-ladder view) ──
  _acHall() {
    if (this._activeTab === LEADERBOARD_TAB) {
      return h('div', { className: 'qf-ac-hall' }, [this._renderLeaderboardView()])
    }
    return h('div', { className: 'qf-ac-hall' }, [
      h('div', { className: 'qf-ac-filters' },
        TABS.map(t => h('button', {
          className: 'pix qf-ac-fl' + (t.id === this._activeTab ? ' on' : ''),
          on: { click: () => { this._activeTab = t.id; this._rerenderBody() } },
        }, t.label))),
      h('div', { className: 'qf-ac-shelves' }, this._acShelves()),
    ])
  }

  _acShelves() {
    const unlocked = this._unlockedSet()
    const out = AC_SHELVES.map(s => {
      const items = this._defs.filter(d =>
        achievementTier(d) === s.tier && this._defMatchesTab(d, this._activeTab))
      if (!items.length) return null
      const have = items.filter(d => unlocked.has(d.id)).length
      return h('div', { className: 'qf-ac-shelf' }, [
        h('div', { className: 'qf-ac-shelfhd', style: { '--sc': s.color } }, [
          h('span', { className: 'g' }, s.glyph),
          h('span', { className: 'pix t' }, s.label),
          h('span', { className: 'sil ct' }, `${have}/${items.length}`),
          h('span', { className: 'ln' }),
        ]),
        h('div', { className: 'qf-ac-grid' }, items.map(d => this._acMedallion(d, unlocked))),
      ])
    }).filter(Boolean)
    if (!out.length) {
      return [h('div', { className: 'qf-ac-empty' }, '— no trophies in this category yet —')]
    }
    return out
  }

  _acMedallion(def, unlocked) {
    const isUnlocked = unlocked.has(def.id)
    const tier = achievementTier(def)
    const sc = { gold: '#ffd86a', silver: '#c8c8d0', bronze: '#c8884a' }[tier]
    const catc = AC_CAT_COLOR[def.category] || 'var(--text)'
    const icon = def.icon || CATEGORY_FALLBACK_ICON[def.category] || '◆'
    const target = def.target ?? 1
    const progress = this._viewer ? this._viewerProgress(def) : AchievementSystem.getProgress(def.id)
    const showProg = !isUnlocked && progress != null && target > 1
    const p = showProg ? Math.max(0, Math.min(100, (progress / target) * 100)) : null
    const isNew = !this._viewer && this._newAtOpen?.has(def.id)
    return h('div', {
      className: 'qf-ac-med',
      dataset: { locked: isUnlocked ? 'false' : 'true', leg: tier === 'gold' ? 'true' : 'false' },
      style: { '--sc': sc, '--catc': catc },
      on: isNew ? { mouseenter: (e) => this._ackNew(def, e.currentTarget) } : null,
    }, [
      isNew && h('span', { className: 'sil qf-ac-new qf-newchip' }, 'NEW'),
      h('div', { className: 'qf-ac-disc' }, [
        h('span', { className: 'ic' }, icon),
        isUnlocked && h('span', { className: 'pix seal' }, '✓'),
        (!isUnlocked && p == null) && h('span', { className: 'lk' }, '🔒'),
      ]),
      h('div', { className: 'qf-ac-mbody' }, [
        h('div', { className: 'pix qf-ac-mname' }, def.name),
        h('div', { className: 'qf-ac-mdesc' }, def.description),
        showProg && h('div', { className: 'qf-ac-prog' }, [
          h('div', { className: 'tk' }, [h('div', { className: 'fl', style: { width: p + '%' } })]),
          h('span', { className: 'sil pt' }, `${progress}/${target}`),
        ]),
        this._acRewardChip(def),
      ]),
    ])
  }

  // Hover-acknowledge a card's NEW chip: fade it out, drop it from the in-memory
  // snapshot, and persist the id as seen (so it doesn't reappear, and the main-
  // menu badge clears once every flagged card has been hovered).
  _ackNew(def, cardEl) {
    if (this._viewer || !def?.id || !this._newAtOpen?.has(def.id)) return
    this._newAtOpen.delete(def.id)
    PlayerProfile.markAchievementsKnown([def.id])
    dismissNewChip(cardEl?.querySelector('.qf-newchip'))
  }

  _acRewardChip(def) {
    if (def.reward?.type === 'boss') {
      return h('div', { className: 'sil qf-ac-rw boss' }, '◆ ' + def.reward.id.replace(/_/g, ' ').toUpperCase())
    }
    if (def.reward?.type === 'companion') {
      const cName = (COMPANIONS[def.reward.id]?.name || def.reward.id).toUpperCase()
      return h('div', { className: 'sil qf-ac-rw comp' }, '♥ ' + cName)
    }
    if (def.title) {
      return h('div', { className: 'sil qf-ac-rw title' }, '✦ ' + def.title)
    }
    return null
  }

  // "12 minutes ago" / "3 days ago" / "Just now" — picks the largest unit
  // that yields a non-zero count. Returns "—" for unknown timestamps.
  _formatRelative(ms) {
    if (!ms) return '—'
    const d = Date.now() - ms
    if (d < 0) return 'Just now'
    const s = Math.floor(d / 1000)
    if (s < 60) return 'Just now'
    const min = Math.floor(s / 60)
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
    const day = Math.floor(hr / 24)
    if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`
    const wk = Math.floor(day / 7)
    if (wk < 5) return `${wk} week${wk === 1 ? '' : 's'} ago`
    const mo = Math.floor(day / 30)
    if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
    const yr = Math.floor(day / 365)
    return `${yr} year${yr === 1 ? '' : 's'} ago`
  }

  // Achievement-leaderboard podium title chip — fx titles get the
  // animated gradient border + gradient text; color titles get their
  // solid color on words + border; plain titles fall back to the rank
  // color. Resolved by NAME (remote player's title string).
  _lbTitleChip(title, rankColor) {
    const fxBorder = titleFxBorderClassByName(title)
    if (fxBorder) {
      return h('div', { className: ('pix qf-ach-lb-podium-title ' + fxBorder).trim() }, [
        h('span', { className: titleFxClassByName(title) }, title),
      ])
    }
    const tColor = titleColorByName(title)
    if (tColor) {
      return h('div', {
        className: 'pix qf-ach-lb-podium-title',
        style: { color: tColor, borderColor: tColor },
      }, title)
    }
    return h('div', {
      className: 'pix qf-ach-lb-podium-title',
      style: { color: rankColor, borderColor: rankColor },
    }, title)
  }

  // Does an achievement belong under the given tab?
  //   all        — everything
  //   companions — its reward unlocks a companion
  //   titles     — it grants a title. An achievement that rewards BOTH a
  //                companion (or boss) AND a title now shows under BOTH the
  //                companions/boss tab AND titles (e.g. "Arise" → Necroknight
  //                + "King of the Dead"; Curtain Call → Rattle Bones + "The
  //                Showrunner"). The card renders both reward chips, so it
  //                reads correctly in either tab.
  //   mastery    — EVERY legendary achievement (regardless of its
  //                category), so the tab is the complete legendary
  //                showcase. An achievement can match more than one tab
  //                (a legendary that grants a title shows in MASTERY and
  //                TITLES) — intended; ALL lists it once.
  //   <category> — fallback: category match (no other category tab ships
  //                today, kept for forward-compat).
  _defMatchesTab(def, tab) {
    if (tab === 'all')        return true
    if (tab === 'companions') return def.reward?.type === 'companion'
    if (tab === 'titles')     return !!def.title
    if (tab === 'mastery')    return achievementTier(def) === 'gold'
    return def.category === tab
  }

  // Remote player's progress toward an achievement, read from the metric
  // snapshot that shipped with their leaderboard row (viewer.metrics,
  // keyed by metric name). Returns null when there's no snapshot (rows
  // submitted before the snapshot existed) or the metric is absent /
  // non-numeric — _card then skips the progress bar, matching the
  // legacy viewer behavior. Self-view never calls this (it reads
  // AchievementSystem.getProgress directly).
  _viewerProgress(def) {
    const metrics = this._viewer?.metrics
    if (!metrics || typeof metrics !== 'object') return null
    const v = metrics[def?.metric]
    return (typeof v === 'number' && isFinite(v)) ? v : null
  }

  // Resolve a leaderboard row's metric snapshot for the viewer's progress
  // bars. Prefers the FULL career snapshot submitted with the row
  // (meta.ach_metrics, present on runs submitted after the snapshot
  // shipped). For older rows that lack it, derives a PARTIAL fallback
  // from the run-summary columns every row already has:
  //   • boss_level    → maxBossLevel
  //   • days_survived → daysSurvivedMax
  // so the prominent progression achievements ("reach boss level N",
  // "survive N days") still show bars on legacy rows. These are the
  // latest run's figures, so they can understate a career best from an
  // earlier run — but any achievement already cleared shows as unlocked
  // (no bar) anyway, so the approximation only ever affects still-locked
  // rows where it reads as a reasonable "how close" indicator. Cumulative
  // metrics (career kills, rooms placed, type-sets, …) aren't faithfully
  // recoverable from one run's summary, so they stay absent until the
  // player resubmits with a full snapshot. Returns null when neither the
  // snapshot nor the fallback yields anything → viewer shows no bars.
  _achMetricsFromRow(r) {
    const snap = r?.meta?.ach_metrics
    if (snap && typeof snap === 'object') return snap
    const fallback = {}
    const bossLevel = Number(r?.boss_level ?? 0)
    const days      = Number(r?.days_survived ?? 0)
    if (bossLevel > 0) fallback.maxBossLevel    = bossLevel
    if (days > 0)      fallback.daysSurvivedMax = days
    return Object.keys(fallback).length ? fallback : null
  }

  // Which unlocked-id set are we showing? Self = PlayerProfile;
  // viewer = decode the bitmask we were handed at construction.
  _unlockedSet() {
    if (!this._viewer) return PlayerProfile.getUnlockedAchievements()
    // Decode the bitmask string against the canonical ordered ids.
    const ids = AchievementSystem.getOrderedIds()
    const bits = this._viewer.bitmask || ''
    const out = new Set()
    for (let i = 0; i < ids.length && i < bits.length; i++) {
      if (bits[i] === '1') out.add(ids[i])
    }
    return out
  }

  // ── interactions ──────────────────────────────────────────────────────
  _selectTab(tabId) {
    if (tabId === this._activeTab) return
    this._activeTab = tabId
    HudSfx.playUi('hover')
    // Lazy leaderboard fetch on first activation; cached after.
    if (tabId === LEADERBOARD_TAB && this._lbRows == null && !this._lbLoading) {
      this._loadLeaderboard()
    }
    this._rerenderBody()
  }

  // ── Leaderboard view ────────────────────────────────────────────────
  // Fetch top-N rows from Supabase via the existing Leaderboard module,
  // dedupe by player_name (keep latest run per player), aggregate the
  // achievement bitmask + count, sort by count desc, render the top-50
  // (plus YOUR row pinned even if you're outside the top 50).
  async _loadLeaderboard() {
    if (this._lbLoading) return
    this._lbLoading = true
    this._lbError   = null
    try {
      // Pull a wide slice ordered by recency; we need DISTINCT PLAYERS
      // not distinct rows, so we over-fetch and dedupe client-side.
      // `fetchTop` sorts by days_survived which captures active players
      // well enough — anyone with achievements has been playing.
      const rows = await Leaderboard.fetchTop(LB_FETCH_LIMIT)
      // Dedupe by player_name → latest row (by created_at). Achievement
      // state is monotonic (only goes up), so latest = current.
      const byPlayer = new Map()
      for (const r of (rows || [])) {
        const name = r?.player_name
        if (!name) continue
        const ts = Date.parse(r.created_at ?? '') || 0
        const existing = byPlayer.get(name)
        if (!existing || ts > existing._ts) {
          // Pull the rich-card data fields too — the podium uses
          // companion sprite + boss portrait + stats block + active
          // title chip (mirrors the main run-leaderboard's podium).
          // Older rows that predate these fields fall back to nulls /
          // zeros and the podium gracefully degrades.
          byPlayer.set(name, {
            name,
            achievementCount: Number(r.meta?.achievement_count ?? 0),
            achievementBits:  String(r.meta?.achievement_bits ?? ''),
            // Per-metric career snapshot for the viewer's progress bars.
            // Prefers the full submitted snapshot; falls back to a partial
            // one derived from the row's run-summary columns for legacy
            // rows (see _achMetricsFromRow). Null only when neither yields
            // anything → viewer shows no bars (the original behavior).
            achMetrics:       this._achMetricsFromRow(r),
            bossId:           r.boss_id ?? null,
            bossLevel:        Number(r.boss_level ?? 0),
            days:             Number(r.days_survived ?? 0),
            kills:            Number(r.total_kills ?? 0),
            companionId:      r.meta?.companionId ?? null,
            activeTitle:      (typeof r.meta?.active_title === 'string' && r.meta.active_title.trim())
              ? r.meta.active_title.trim()
              : null,
            _ts:              ts,
          })
        }
      }
      const players = Array.from(byPlayer.values())
        .filter(p => p.achievementCount > 0 || p.achievementBits)
        .sort((a, b) => b.achievementCount - a.achievementCount || b._ts - a._ts)
      this._lbRows = players
      // Feed the rarity computation while we have the dataset in memory.
      // The grid-view cards read AchievementSystem.getRarity(id) next
      // render; on initial mount before any leaderboard fetch they just
      // show no rarity badge (graceful absence).
      AchievementSystem.ingestRarityFromRows(players)
    } catch (err) {
      console.warn('[AchievementsOverlay] leaderboard fetch failed:', err)
      this._lbError = err?.message || 'Failed to load.'
      this._lbRows = []
    } finally {
      this._lbLoading = false
      // Re-render so the trophy-ladder view (or retroactive rarity badges)
      // reflect the now-loaded rows.
      if (this._overlay) this._rerenderBody()
    }
  }

  _renderLeaderboardView() {
    // Loading + error states.
    if (this._lbLoading && this._lbRows == null) {
      return h('div', { className: 'qf-ach-lb-status' }, 'Loading achievement leaderboard…')
    }
    if (this._lbError) {
      return h('div', { className: 'qf-ach-lb-status qf-ach-lb-status--error' },
        `Couldn't load leaderboard: ${this._lbError}`)
    }
    const players = this._lbRows || []
    const myName  = (PlayerProfile.getName() || '').trim()
    const isMango = PlayerProfile.isCheatName?.() === true
    const myCount = PlayerProfile.getUnlockedAchievements().size
    const total   = this._defs.length

    // Find the player's own rank — even if they're outside the top 50,
    // we want to show their position in the YOUR-RANK band. Mango never
    // appears on the leaderboard (submissions are blocked by the
    // dev-account guard in Leaderboard.submitRun) so we don't even
    // look for them — the YOUR-RANK band shows "EXCLUDED (CHEAT)".
    let myIndex = -1
    if (myName && !isMango) {
      myIndex = players.findIndex(p =>
        p.name.toLowerCase() === myName.toLowerCase())
    }
    const myRank = myIndex >= 0 ? myIndex + 1 : null

    // YOUR-RANK band — always rendered first, even when the leaderboard
    // is empty or the player is excluded. This way the player ALWAYS
    // sees their own local unlock count, and the empty-leaderboard case
    // explains itself instead of being a dead-end.
    let yourRankValue
    if (isMango)         yourRankValue = 'EXCLUDED (CHEAT)'
    else if (!myName)    yourRankValue = 'UNNAMED'
    else if (myRank)     yourRankValue = `#${myRank} of ${players.length} players`
    else if (players.length === 0) yourRankValue = 'NO DATA YET'
    else                 yourRankValue = `UNRANKED of ${players.length}`
    const yourRankBand = h('div', { className: 'qf-ach-lb-yourrank' }, [
      h('span', { className: 'pix qf-ach-lb-yourrank-label' }, 'YOUR RANK:'),
      h('span', { className: 'pix qf-ach-lb-yourrank-value' }, yourRankValue),
      h('span', { className: 'pix qf-ach-lb-yourrank-count' },
        `${myCount} / ${total} unlocked`),
    ])

    // Empty-state below the band — gives context about WHY no data
    // shows up (so the player understands the leaderboard isn't broken).
    if (players.length === 0) {
      let msg = 'No achievement data yet. Be the first to claim a trophy.'
      if (isMango) {
        msg = 'No other players on the leaderboard yet. Mango runs don\'t submit (cheat-account guard) — switch to a real name to compete.'
      }
      return h('div', { className: 'qf-ach-lb' }, [
        yourRankBand,
        h('div', { className: 'qf-ach-lb-status' }, msg),
      ])
    }

    // The displayed list: top-50, then pin YOUR row at the bottom if
    // outside that window.
    const top50  = players.slice(0, LB_DISPLAY_LIMIT)
    const pinYou = (myIndex >= LB_DISPLAY_LIMIT) ? players[myIndex] : null

    return h('div', { className: 'qf-ach-lb' }, [
      yourRankBand,

      // Top-3 podium — ALWAYS renders 3 slots, even with a sparse
      // leaderboard. Missing slots show "AWAITING CHALLENGER"
      // placeholder cards. DOM order is [#2, #1, #3] so the visual
      // layout reads as a podium step: silver-left, gold-center
      // (tallest), bronze-right. Matches the main run-leaderboard's
      // podium pattern.
      h('div', { className: 'qf-ach-lb-podium' }, [
        this._podiumCardOrPlaceholder(players[1], 2, myName),  // left
        this._podiumCardOrPlaceholder(players[0], 1, myName),  // center
        this._podiumCardOrPlaceholder(players[2], 3, myName),  // right
      ]),

      // Header strip for the ranked list — mirrors `.qf-lb-tablehead`
      // grid: rank | sprite | KEEPER | TROPHIES | arrow.
      h('div', { className: 'qf-ach-lb-listhead' }, [
        h('span', { style: { textAlign: 'right' } }, '#'),
        h('span'),
        h('span', null, 'KEEPER'),
        h('span', { style: { textAlign: 'right', color: 'var(--gold-bright, #ffd964)' } }, 'TROPHIES'),
        h('span'),
      ]),

      // Ranked list.
      h('div', { className: 'qf-ach-lb-list' },
        top50.map((p, i) => this._listRow(p, i + 1, myName))),

      // Pinned YOU row if outside the top 50.
      pinYou && h('div', { className: 'qf-ach-lb-pinned' }, [
        h('div', { className: 'pix qf-ach-lb-pinned-label' }, '…'),
        this._listRow(pinYou, myRank, myName),
      ]),

      // GLOBAL STATS panel — bordered stats block below the list.
      // Always visible (even with 1 player) because it gives context
      // for the overall achievement landscape and fills the empty
      // space that sparse leaderboards otherwise leave behind.
      this._renderStatsPanel(players),
    ])
  }

  // Helper for the always-3-slot podium — returns a real card when
  // there's a player at that rank, a placeholder card otherwise.
  _podiumCardOrPlaceholder(player, rank, myName) {
    if (player) return this._podiumCard(player, rank, myName)
    return this._podiumPlaceholder(rank)
  }

  // "AWAITING CHALLENGER" placeholder podium card — same external
  // dimensions as `_podiumCard` so the podium row reads as a balanced
  // [#1, #2, #3] strip regardless of how many real entries we have.
  // Visually dimmed (muted colors, no glow, no hover lift) so it's
  // clearly an empty slot, not a real player. Inert — no click handler.
  _podiumPlaceholder(rank) {
    const c = _rankColor(rank)
    const w = rank === 1 ? 80 : 64
    return h('div', {
      className: 'qf-ach-lb-podium-card qf-ach-lb-podium-card--placeholder',
      dataset: { rank: String(rank) },
      style: {
        '--rank-color': c,
        borderTop: `3px solid color-mix(in srgb, ${c} 50%, #000)`,
        background: 'linear-gradient(180deg, var(--bg-0), #07050c)',
        cursor: 'default',
      },
    }, [
      h('div', {
        className: 'pix qf-ach-lb-podium-badge',
        style: {
          borderColor: c,
          color: c,
          opacity: 0.55,
          textShadow: 'none',
          boxShadow: 'none',
        },
      }, `#${rank}`),
      // Empty-slot sprite frame with a big "?" — same outer dimensions
      // as a real boss portrait so the card height matches.
      h('div', {
        className: 'qf-ach-lb-podium-sprite',
        style: { borderColor: `color-mix(in srgb, ${c} 40%, #000)`, opacity: 0.5 },
      }, [
        h('div', {
          style: {
            width:  `${w}px`,
            height: `${w}px`,
            display: 'grid',
            placeItems: 'center',
            fontSize: rank === 1 ? '40px' : '32px',
            color: 'var(--text-mute)',
            fontFamily: 'var(--pix)',
            letterSpacing: '0',
          },
        }, '?'),
      ]),
      h('div', {
        className: 'pix qf-ach-lb-podium-name',
        style: {
          color: 'var(--text-mute)',
          fontSize: rank === 1 ? '12px' : '10px',
          letterSpacing: '2px',
        },
      }, 'AWAITING'),
      h('div', {
        className: 'pix qf-ach-lb-podium-name',
        style: {
          color: 'var(--text-dim, var(--text-mute))',
          fontSize: rank === 1 ? '10px' : '8px',
          letterSpacing: '1.5px',
          opacity: 0.7,
          marginTop: '-4px',
        },
      }, 'CHALLENGER'),
      // Placeholder trophy block — matches the structure of the real
      // _podiumTrophyBlock so the card height is consistent, but with
      // muted dashes instead of real numbers and an empty progress bar.
      h('div', { className: 'qf-ach-lb-podium-trophies' }, [
        h('div', { className: 'qf-ach-lb-podium-trophies-row' }, [
          h('span', {
            className: 'qf-ach-lb-podium-trophies-glyph',
            style: { fontSize: rank === 1 ? '20px' : '16px', opacity: 0.4 },
          }, '🏆'),
          h('span', {
            className: 'pix qf-ach-lb-podium-trophies-num',
            style: {
              fontSize: rank === 1 ? '28px' : rank === 2 ? '22px' : '20px',
              color: 'var(--text-dim, var(--text-mute))',
              opacity: 0.6,
              textShadow: 'none',
            },
          }, '—'),
          h('span', {
            className: 'pix qf-ach-lb-podium-trophies-of',
            style: {
              fontSize: rank === 1 ? '14px' : '12px',
              opacity: 0.5,
            },
          }, '/ —'),
        ]),
        h('div', {
          className: 'qf-ach-lb-podium-trophies-bar',
          style: { opacity: 0.4 },
        }),
      ]),
    ])
  }

  // GLOBAL STATS panel — server-wide aggregate stats below the ranked
  // list. Computes from the in-memory player roster (no extra fetch)
  // plus the rarity sample that AchievementSystem already ingested
  // when the leaderboard fetch landed. Four cells:
  //   • TOTAL KEEPERS — count of distinct players on the board
  //   • AVG TROPHIES — mean achievement_count across players
  //   • RAREST TROPHY — achievement with the lowest >0% rarity
  //   • MOST POPULAR TITLE — most-equipped active_title across players
  _renderStatsPanel(players) {
    if (!players || players.length === 0) return null
    const totalKeepers = players.length
    const avgTrophies = Math.round(
      players.reduce((sum, p) => sum + (p.achievementCount || 0), 0) /
      totalKeepers)
    // Rarest trophy — iterate def list, find lowest fraction > 0.
    // Skip 0% achievements (no one has them yet — not really "rare,"
    // just unclaimed).
    let rarestDef = null
    let rarestPct = 101
    for (const def of this._defs) {
      const rarity = AchievementSystem.getRarity(def.id)
      if (!rarity || !rarity.sample) continue
      const pct = rarity.fraction * 100
      if (pct > 0 && pct < rarestPct) { rarestPct = pct; rarestDef = def }
    }
    // Most popular title — count active_title occurrences.
    const titleCounts = new Map()
    for (const p of players) {
      if (p.activeTitle) {
        titleCounts.set(p.activeTitle, (titleCounts.get(p.activeTitle) || 0) + 1)
      }
    }
    let topTitle = null, topTitleCount = 0
    for (const [title, count] of titleCounts) {
      if (count > topTitleCount) { topTitle = title; topTitleCount = count }
    }
    const total = this._defs.length
    return h('div', { className: 'qf-ach-lb-stats' }, [
      h('div', { className: 'pix qf-ach-lb-stats-head' }, '◆  GLOBAL STATS  ◆'),
      h('div', { className: 'qf-ach-lb-stats-grid' }, [
        this._statCell('TOTAL KEEPERS', String(totalKeepers)),
        this._statCell('AVG TROPHIES', `${avgTrophies} / ${total}`),
        this._statCell('RAREST TROPHY',
          rarestDef
            ? `${rarestDef.name} · ${Math.round(rarestPct)}%`
            : '—'),
        this._statCell('MOST POPULAR TITLE',
          topTitle ? topTitle.toUpperCase() : '—'),
      ]),
    ])
  }

  _statCell(label, value) {
    return h('div', { className: 'qf-ach-lb-stat' }, [
      h('div', { className: 'pix qf-ach-lb-stat-label' }, label),
      h('div', { className: 'pix qf-ach-lb-stat-value' }, value),
    ])
  }

  // One podium card — full rich layout matching the main run-leaderboard
  // podium: [companion sprite | boss + name + title + trophy count |
  // stats block]. Rank-colored top border, floating `#N` badge,
  // tiered heights so #1 reads taller than #2/#3. Stats block shows
  // BOSS LV / DAYS / KILLS in framed mini-panels mirroring the main
  // leaderboard. Companion sprite + stats block only render when the
  // row has the data (graceful degradation for legacy rows).
  _podiumCard(player, rank, myName) {
    const isYou = myName && player.name.toLowerCase() === myName.toLowerCase()
    const c = _rankColor(rank)
    const total = this._defs.length
    const hasCompanion = !!(player.companionId && COMPANIONS[player.companionId])
    // The stats block is achievement-derived now (TITLES / BOSSES /
    // COMPANIONS counts decoded from the bitmask), so it always has
    // something to show as long as the row has a bitmask. Legacy rows
    // without bitmask data render an empty bitmask → all-zero counts.
    const hasStats = !!player.achievementBits

    // CENTER COLUMN — floating badge, boss portrait, name, title chip,
    // trophy count.
    const centerColumn = h('div', { className: 'qf-ach-lb-podium-center' }, [
      h('div', {
        className: 'pix qf-ach-lb-podium-badge',
        style: {
          borderColor: c,
          color: c,
          boxShadow: `0 0 12px ${c}66`,
          textShadow: `0 0 6px ${c}`,
        },
      }, `#${rank}`),
      h('div', {
        className: 'qf-ach-lb-podium-sprite',
        style: { borderColor: c },
      }, _bossPortrait(player.bossId, rank === 1 ? 80 : 64)),
      h('div', {
        className: 'pix qf-ach-lb-podium-name',
        style: {
          color: c,
          fontSize: rank === 1 ? '15px' : '13px',
          textShadow: `0 0 6px ${c}66`,
        },
      }, isYou ? `${player.name} · YOU` : player.name),
      // Title chip — render with the title's OWN look (fx gradient border
      // + gradient text, or solid title color), resolved by name since
      // this is a remote player's title string. Falls back to the rank
      // color for plain titles.
      player.activeTitle && this._lbTitleChip(player.activeTitle, c),
      // Trophy count — the headline stat for this leaderboard. Built as
      // a stylized block: trophy glyph + big rank-colored number + "/45"
      // + progress bar fill showing % of total achievements unlocked.
      // Sized per rank (bigger for #1) so the podium step reads visually.
      this._podiumTrophyBlock(player.achievementCount, total, rank, c),
    ])

    return h('button', {
      className: 'qf-ach-lb-podium-card' + (isYou ? ' is-you' : ''),
      dataset: { rank: String(rank) },
      style: {
        '--rank-color': c,
        borderTop: `3px solid ${c}`,
        background: 'linear-gradient(180deg, var(--bg-1), var(--bg-0))',
      },
      on: { click: () => this._openPlayerViewer(player) },
    }, [
      hasCompanion ? this._podiumCompanionSprite(player, rank) : null,
      centerColumn,
      hasStats ? this._podiumStatsBlock(player, rank) : null,
    ])
  }

  // Left-side companion sprite — keeper portrait + name. Mirrors
  // LeaderboardOverlay._podiumCompanionSprite. Loaded via an <img>
  // pointing at the companion's rest expression; if the file 404s the
  // parent block hides itself (graceful degradation).
  _podiumCompanionSprite(player, rank) {
    const cmp = getCompanion(player.companionId)
    const accent = _rankColor(rank)
    const w = rank === 1 ? 84 : 64
    return h('div', { className: 'qf-ach-lb-podium-keeper' }, [
      h('img', {
        src: `${cmp.spriteDir}${cmp.restExpr}.webp`,
        alt: cmp.name,
        style: {
          width:  `${w}px`,
          height: `${Math.round(w * 1.15)}px`,
          objectFit: 'cover',
          objectPosition: '50% 0%',
          imageRendering: 'auto',
          background: 'var(--bg-1)',
          border: `1px solid ${accent}88`,
          boxShadow: `0 0 8px ${accent}33`,
        },
        onerror: (e) => { const p = e.currentTarget?.parentNode; if (p) p.style.display = 'none' },
      }),
      h('div', {
        className: 'pix qf-ach-lb-podium-keeper-name',
        style: {
          color: accent,
          fontSize: rank === 1 ? '9px' : '8px',
          textShadow: `0 0 4px ${accent}66`,
        },
      }, cmp.name.toUpperCase()),
    ])
  }

  // Right-side stats block — achievement-derived counts decoded from
  // the player's `achievementBits`. Three mini-frames stacked:
  //   TITLES     — count of unlocked title-grant achievements
  //   BOSSES     — count of unlocked boss-archetype achievements (lvl 2-10)
  //   COMPANIONS — count of unlocked companion-unlock achievements
  // (Replaces the previous BOSS LV / DAYS / KILLS block which showed
  // RUN-specific stats — wrong context for an achievement leaderboard.)
  _podiumStatsBlock(player, rank) {
    const accent = _rankColor(rank)
    const w = rank === 1 ? 84 : 64
    const valueFontSize = rank === 1 ? '11px' : '9px'
    const labelStyle = {
      fontSize: '6px',
      color: 'var(--text-mute)',
      letterSpacing: '0.5px',
    }
    // ACCESS counts — starters (always playable) + the ones unlocked
    // via achievements. This matches what the player can actually use:
    // a fresh keeper has 3 bosses + 3 companions before any achievement
    // unlock fires. Titles is achievement-only (no starter titles).
    //
    // COMPANIONS denominator uses `COMPANION_ORDER.length` (the FULL
    // registry, currently 9 — lilith, malakor, safira, zulgath,
    // nocturna, rattlebones, luna, necroknight, spectra) rather than
    // starters + achievement-unlockable. This matches what the player
    // sees on the recruit screen, where all companions are visible
    // (locked ones without unlock conditions still appear as silhouette
    // teasers). Pre-fix the denominator was `3 + 1 = 4` which read as
    // a bug since the recruit screen shows more companions than that.
    // As the locked teasers get their unlock conditions wired up, the
    // max reachable numerator grows toward 9 organically.
    const achCounts = this._playerAchievementCounts(player.achievementBits)
    const maxAch    = this._maxAchievementCounts()
    const counts = {
      titles:     achCounts.titles,
      bosses:     STARTER_BOSS_COUNT      + achCounts.bosses,
      companions: STARTER_COMPANION_COUNT + achCounts.companions,
    }
    const maxCounts = {
      titles:     maxAch.titles,
      bosses:     STARTER_BOSS_COUNT      + maxAch.bosses,
      companions: COMPANION_ORDER.length,
    }
    const miniFrame = (label, value, valueColor) => h('div', {
      className: 'qf-ach-lb-podium-stat',
      style: {
        background: 'var(--bg-1)',
        border: `1px solid ${accent}88`,
        boxShadow: `0 0 4px ${accent}33`,
        padding: '2px 4px 3px',
        textAlign: 'center',
        boxSizing: 'border-box',
      },
    }, [
      h('div', { className: 'pix', style: labelStyle }, label),
      h('div', {
        className: 'pix',
        style: {
          fontSize: valueFontSize,
          color: valueColor || 'var(--text)',
          textShadow: `0 0 4px ${accent}66`,
          marginTop: '1px',
        },
      }, value),
    ])
    return h('div', {
      className: 'qf-ach-lb-podium-statsblock',
      style: { width: `${w}px` },
    }, [
      miniFrame('TITLES',
        `${counts.titles} / ${maxCounts.titles}`,
        'var(--qf-reward-title)'),
      miniFrame('BOSSES',
        `${counts.bosses} / ${maxCounts.bosses}`,
        'var(--qf-reward-boss)'),
      miniFrame('COMPANIONS',
        `${counts.companions} / ${maxCounts.companions}`,
        'var(--qf-reward-companion)'),
    ])
  }

  // Trophy-count block — the headline stat on each podium card. Built
  // as: [trophy emoji] [big rank-colored number] [/total in small text],
  // followed by a thin progress bar showing % of total achievements
  // unlocked. Sized by rank — #1's bigger so the podium step reads.
  _podiumTrophyBlock(count, total, rank, rankColor) {
    const pct = total > 0 ? Math.max(0, Math.min(100, (count / total) * 100)) : 0
    const numSize = rank === 1 ? '28px' : rank === 2 ? '22px' : '20px'
    const slashSize = rank === 1 ? '14px' : '12px'
    const glyphSize = rank === 1 ? '20px' : '16px'
    return h('div', { className: 'qf-ach-lb-podium-trophies' }, [
      h('div', { className: 'qf-ach-lb-podium-trophies-row' }, [
        h('span', {
          className: 'qf-ach-lb-podium-trophies-glyph',
          style: { fontSize: glyphSize },
        }, '🏆'),
        h('span', {
          className: 'pix qf-ach-lb-podium-trophies-num',
          style: {
            fontSize: numSize,
            color: rankColor,
            textShadow: `0 0 12px ${rankColor}aa, 0 0 4px ${rankColor}`,
          },
        }, String(count)),
        h('span', {
          className: 'pix qf-ach-lb-podium-trophies-of',
          style: { fontSize: slashSize },
        }, `/ ${total}`),
      ]),
      h('div', { className: 'qf-ach-lb-podium-trophies-bar' }, [
        h('div', {
          className: 'qf-ach-lb-podium-trophies-fill',
          style: {
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${rankColor}88, ${rankColor})`,
            boxShadow: `0 0 8px ${rankColor}aa`,
          },
        }),
      ]),
    ])
  }

  // Decode a player's achievement bitmask into per-category unlock
  // counts. Used by the podium stats block (and could be reused by
  // any future "achievement report" surface). Tolerant of empty /
  // missing bitmask — returns all zeros.
  _playerAchievementCounts(achievementBits) {
    let titles = 0, bosses = 0, companions = 0
    const bits = String(achievementBits || '')
    if (!bits) return { titles, bosses, companions }
    const ids = AchievementSystem.getOrderedIds()
    const n = Math.min(ids.length, bits.length)
    for (let i = 0; i < n; i++) {
      if (bits[i] !== '1') continue
      const def = AchievementSystem.getDefinition(ids[i])
      if (!def) continue
      if (def.title) titles++
      if (def.reward?.type === 'boss') bosses++
      if (def.reward?.type === 'companion') companions++
    }
    return { titles, bosses, companions }
  }

  // Total possible counts across all achievement definitions — the
  // denominator in the "X / N" mini-frames. Cached after first call
  // since it only depends on the static `this._defs` list.
  _maxAchievementCounts() {
    if (!this._maxCountsCache) {
      let titles = 0, bosses = 0, companions = 0
      for (const def of this._defs) {
        if (def.title) titles++
        if (def.reward?.type === 'boss') bosses++
        if (def.reward?.type === 'companion') companions++
      }
      this._maxCountsCache = { titles, bosses, companions }
    }
    return this._maxCountsCache
  }

  // One row in the ranked list below the podium. Visual language mirrors
  // `.qf-lb-row` from the main run-leaderboard: grid columns
  // (rank | sprite | name | count | arrow), rank-colored left border
  // (or blood-red for YOU), hover state, click → drill into viewer.
  _listRow(player, rank, myName) {
    const isYou = myName && player.name.toLowerCase() === myName.toLowerCase()
    const c = _rankColor(rank)
    return h('button', {
      className: 'qf-ach-lb-row',
      dataset: { isyou: isYou ? 'true' : 'false' },
      style: {
        '--row-color': c,
        background: isYou
          ? 'linear-gradient(90deg, rgba(255,68,88,0.18), transparent)'
          : 'transparent',
        borderLeft: isYou ? '3px solid var(--blood)' : `3px solid ${c}`,
      },
      on: { click: () => this._openPlayerViewer(player) },
    }, [
      h('span', {
        className: 'pix qf-ach-lb-row-rank',
        style: { color: c, textShadow: rank <= 3 ? `0 0 6px ${c}` : 'none' },
      }, String(rank)),
      h('div', { className: 'qf-ach-lb-row-sprite' },
        _bossPortrait(player.bossId, 24)),
      h('div', { className: 'qf-ach-lb-row-textcol' },
        h('div', {
          className: 'pix qf-ach-lb-row-name',
          style: { color: isYou ? 'var(--blood)' : 'var(--text)' },
        }, [
          player.name,
          isYou && h('span', { className: 'pix qf-ach-lb-row-youtag' }, ' · YOU'),
        ])),
      h('span', {
        className: 'pix qf-ach-lb-row-count',
        style: { color: rank <= 3 ? c : 'var(--gold-bright, #ffd964)' },
      }, `🏆 ${player.achievementCount}`),
      h('span', { className: 'qf-ach-lb-row-arrow' }, '▸'),
    ])
  }

  // Click a player row → open the viewer overlay for them. Uses a
  // SECOND AchievementsOverlay instance in viewer mode (the simplest
  // path — reuses every bit of the grid render + compare logic).
  _openPlayerViewer(player) {
    if (this._playerViewer) return
    this._playerViewer = new AchievementsOverlay({
      viewer:  {
        name:    player.name,
        bitmask: player.achievementBits,
        // Career metric snapshot → drives the per-card progress bars in
        // viewer mode (how close THIS player is to each achievement).
        // null on legacy rows → _viewerProgress returns null → no bars.
        metrics: player.achMetrics,
      },
      onClose: () => { this._playerViewer = null },
    })
    this._playerViewer.open()
  }

  // Arrow-key tab cycling. Escape is owned by the Overlay shell now
  // (close on Esc is part of the shell's default behavior). Bound on
  // window during open(), removed in _onOverlayClose so it doesn't leak
  // into game-controls when the modal is closed.
  _onKey(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      if (this._activeTab === LEADERBOARD_TAB) {
        this._selectTab(TABS[0].id)
        return
      }
      const i = TABS.findIndex(t => t.id === this._activeTab)
      const dir = e.key === 'ArrowRight' ? 1 : -1
      const next = TABS[(i + dir + TABS.length) % TABS.length].id
      this._selectTab(next)
    }
  }
}

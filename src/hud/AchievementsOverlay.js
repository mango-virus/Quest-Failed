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
//     leaderboard-row bitmask; no progress bars (we don't know their
//     numerics, only what's binary-unlocked); optional "Compare with
//     you" toggle re-colours the cards by both/their-edge/your-edge.
//
// State lives in AchievementSystem (data + progress tracking) and
// PlayerProfile (persisted unlock set). This overlay is pure DOM display.

import { h } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { HudSfx, installHudSfxDelegates } from './HudSfx.js'
import { Overlay }           from './Overlay.js'
import { AchievementSystem } from '../systems/AchievementSystem.js'
import { PlayerProfile }     from '../systems/PlayerProfile.js'
import { Leaderboard }       from '../systems/Leaderboard.js'
import { COMPANIONS, getCompanion, COMPANION_ORDER } from '../systems/companions.js'

// Category-filter tabs. The LEADERBOARD entry is intentionally NOT in
// this list — it's its own prominent button (see `_render` below) so it
// reads as a destination rather than a filter.
const TABS = [
  { id: 'all',          label: 'ALL' },
  { id: 'progression',  label: 'PROGRESSION' },
  { id: 'combat',       label: 'COMBAT' },
  { id: 'economy',      label: 'ECONOMY' },
  { id: 'variety',      label: 'VARIETY' },
  { id: 'mastery',      label: 'MASTERY' },
]

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

// Boss-portrait helper mirroring LeaderboardOverlay._bossPortrait so the
// achievement leaderboard rows can show the same boss sprite the main
// run-leaderboard does. Strips the legacy `the_` prefix and falls back
// to a blank box if the portrait 404s.
function _bossPortrait(bossId, size) {
  const id = String(bossId || '').replace(/^the_/, '')
  return h('div', {
    className: 'qf-ach-lb-portrait-img',
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
}

// Per-rank color, identical mapping to LeaderboardOverlay.rankColor so
// the achievement leaderboard's gold/silver/bronze top-3 + neutral
// remainder reads the same as the main run-leaderboard.
function _rankColor(rank) {
  if (rank === 1) return '#ffd86a'
  if (rank === 2) return '#c8c8d0'
  if (rank === 3) return '#c8884a'
  if (rank <= 10) return 'var(--text)'
  return 'var(--text-mute)'
}

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

// Legendary tier is now data-driven — each achievement def carries
// `legendary: true` in `src/data/achievements.json`. The grid card
// renderer reads it via `def.legendary`. ToastQueue reads the same
// flag to fire the bigger "RARE TROPHY" toast + particle burst when
// one unlocks.

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
      title:     this._viewer
        ? `◆  ${this._viewer.name.toUpperCase()}'S TROPHIES  ◆`
        : '◆  HALL OF TROPHIES  ◆',
      width:     1300,
      height:    840,
      accent:    'var(--gold)',
      animation: 'unfurl',
      onClose:   () => this._onOverlayClose(),
      body:      this._el,
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
  _renderBody() {
    const unlocked = this._unlockedSet()
    const total    = this._defs.length

    // Active title chip — clickable in self-view (opens the title
    // picker popup); hidden in viewer mode (we don't know the other
    // player's active title locally, and changing the chip wouldn't
    // make sense for someone else's screen).
    const activeTitle = this._viewer ? null : PlayerProfile.getActiveTitle()
    const titleCount  = this._viewer ? 0 : PlayerProfile.getUnlockedTitles().length
    // Source-category for the active title — the chip border + glow
    // inherit the category color of the achievement that granted it,
    // so "The Hoarder" reads gold (economy), "The Tyrant" reads amber
    // (progression), "The Hunter" reads cyan (variety), etc.
    const titleSourceDef = activeTitle ? AchievementSystem.getDefinition(activeTitle.id) : null
    const titleSourceCat = titleSourceDef?.category || 'mastery'
    const titleChip = activeTitle ? h('button', {
      className: 'pix qf-ach-titlechip',
      dataset: { sourceCat: titleSourceCat },
      on: { click: () => this._toggleTitlePicker() },
    }, [
      h('span', { className: 'qf-ach-titlechip-label' }, '✦  TITLE'),
      h('span', { className: 'qf-ach-titlechip-name' }, activeTitle.name),
      titleCount > 1 && h('span', { className: 'qf-ach-titlechip-count' },
        ` · ${titleCount} unlocked  ▼`),
      titleCount === 1 && h('span', { className: 'qf-ach-titlechip-count' }, '  ▼'),
    ]) : null

    // Title chip + picker share a `position: relative` wrapper so the
    // picker can `position: absolute; top: 100%` directly under the
    // chip — robust to any layout changes above. Replaces the previous
    // fixed `top: 160px` against `.qf-ach`.
    const titleChipWrap = titleChip ? h('div', { className: 'qf-ach-titlechip-wrap' }, [
      titleChip,
      this._renderTitlePicker(),
    ]) : null

    return h('div', { className: 'qf-ach' }, [
      // HEADER BAND — counter + title chip + (viewer-only) compare toggle.
      // The Overlay shell's title bar above already shows "HALL OF
      // TROPHIES", so this body header is just the player-facing chips.
      h('div', { className: 'qf-ach-head' }, [
        h('div', { className: 'pix qf-ach-counter' },
          `${unlocked.size} / ${total} UNLOCKED`),
        titleChipWrap,
        // Phase-C "Compare with you" toggle. Hidden in self-view since
        // it has nothing to compare against.
        this._viewer && h('button', {
          className: 'btn qf-ach-compare-toggle',
          on: { click: () => this._toggleCompare() },
        }, this._compareMode ? '◉ COMPARING' : '◇ COMPARE WITH YOU'),
      ]),

      // TABS ROW — category filters on the left + the prominent
      // LEADERBOARD destination button on the right. The leaderboard
      // is deliberately NOT styled as another tab; it's a gold-burst
      // pulsing button that reads as "go somewhere new" instead of
      // "filter the current view."
      h('div', { className: 'qf-ach-tabsrow' }, [
        h('div', { className: 'qf-ach-tabs' },
          TABS.map(t => h('button', {
            className: 'qf-ach-tab' + (t.id === this._activeTab ? ' is-active' : ''),
            dataset: { cat: t.id },
            on: { click: () => this._selectTab(t.id) },
          }, t.label))),
        // LEADERBOARD destination button — hidden in viewer mode (drilled
        // into another player's grid). The viewer overlay is reached BY
        // clicking a row from the leaderboard view, so offering another
        // LEADERBOARD button inside it would be confusing — you're already
        // looking at the comparison context. Also avoids the visual conflict
        // with the compare-toggle button that takes its slot in viewer mode.
        !this._viewer && h('button', {
          className: 'qf-ach-lb-btn' + (this._activeTab === LEADERBOARD_TAB ? ' is-active' : ''),
          on: { click: () => this._selectTab(LEADERBOARD_TAB) },
        }, [
          h('span', { className: 'qf-ach-lb-btn-glyph' }, '🏆'),
          h('span', { className: 'pix qf-ach-lb-btn-label' }, 'LEADERBOARD'),
        ]),
      ]),

      // RECENT UNLOCKS strip — 3 most recent unlocks. Self-view only.
      !this._viewer && this._renderRecentStrip(),

      // VIEW — either the category grid OR the leaderboard, depending on
      // active tab. Wrapped so we can swap one child without rebuilding
      // the entire chrome.
      h('div', { className: 'qf-ach-view-wrap' }, [
        this._renderActiveView(),
      ]),
    ])
  }

  // ── Recent unlocks strip ──────────────────────────────────────────────
  // Three most-recent unlocks for the player, with relative-time labels.
  // Renders nothing when there are no unlocks yet (clean empty state).
  _renderRecentStrip() {
    const recent = PlayerProfile.getRecentUnlocks(3)
    if (!recent.length) return null
    // Filter out unknown ids (achievement defs that were removed from
    // the data file but linger in the player's timestamps).
    const items = recent
      .map(r => ({ ...r, def: AchievementSystem.getDefinition(r.id) }))
      .filter(x => x.def)
    if (!items.length) return null
    return h('div', { className: 'qf-ach-recent' }, [
      h('span', { className: 'pix qf-ach-recent-label' }, 'RECENT UNLOCKS'),
      h('div', { className: 'qf-ach-recent-list' },
        items.map(item => h('div', { className: 'qf-ach-recent-item' }, [
          h('span', { className: `pix qf-ach-recent-icon qf-ach-icon--${item.def.category}` },
            item.def.icon || '◆'),
          h('div', { className: 'qf-ach-recent-textcol' }, [
            h('div', { className: 'pix qf-ach-recent-name' }, item.def.name),
            h('div', { className: 'qf-ach-recent-time' }, this._formatRelative(item.ts)),
          ]),
        ]))),
    ])
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

  // ── Title picker ──────────────────────────────────────────────────────
  // Floating popup beneath the title chip. Lists all unlocked titles +
  // an "AUTO" option. The `data-open` attribute drives visibility (CSS
  // toggles display: none / block). Click outside or pick a title to
  // close — handled via the document-level click listener bound on toggle.
  _renderTitlePicker() {
    const titles = PlayerProfile.getUnlockedTitles()
    if (!titles.length) return null
    const activeId = PlayerProfile.getActiveTitleId()
    const sorted = titles.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    return h('div', {
      className: 'qf-ach-titlepicker',
      dataset: { open: 'false' },
      ref: el => { this._titlePickerEl = el },
    }, [
      h('div', { className: 'pix qf-ach-titlepicker-head' }, 'SELECT TITLE'),
      // AUTO entry — clears the explicit selection so the active title
      // tracks "most recently unlocked" going forward.
      h('button', {
        className: 'qf-ach-titlepicker-row' + (activeId == null ? ' is-active' : ''),
        on: { click: () => this._selectTitle(null) },
      }, [
        h('span', { className: 'pix qf-ach-titlepicker-name' }, '◇ AUTO'),
        h('span', { className: 'qf-ach-titlepicker-sub' },
          '(most recent: ' + (sorted[0]?.name || '—') + ')'),
      ]),
      // One row per unlocked title (most-recent first).
      ...sorted.map(t => h('button', {
        className: 'qf-ach-titlepicker-row' + (activeId === t.id ? ' is-active' : ''),
        on: { click: () => this._selectTitle(t.id) },
      }, [
        h('span', { className: 'pix qf-ach-titlepicker-name' }, '✦ ' + t.name),
      ])),
    ])
  }

  _toggleTitlePicker() {
    if (!this._titlePickerEl) return
    const isOpen = this._titlePickerEl.dataset.open === 'true'
    this._titlePickerEl.dataset.open = isOpen ? 'false' : 'true'
    // Bind / unbind an outside-click closer so clicking anywhere else
    // dismisses the popup.
    if (!isOpen) {
      this._outsideClickHandler = (e) => {
        if (!this._el) return
        if (e.target.closest('.qf-ach-titlechip')) return  // don't re-toggle
        if (e.target.closest('.qf-ach-titlepicker')) return // click inside
        this._titlePickerEl.dataset.open = 'false'
        document.removeEventListener('click', this._outsideClickHandler)
        this._outsideClickHandler = null
      }
      // Defer the binding by one tick — otherwise the click that opened
      // the popup also closes it immediately.
      setTimeout(() => document.addEventListener('click', this._outsideClickHandler), 0)
    } else if (this._outsideClickHandler) {
      document.removeEventListener('click', this._outsideClickHandler)
      this._outsideClickHandler = null
    }
  }

  _selectTitle(achId) {
    PlayerProfile.setActiveTitleId(achId)
    HudSfx.playUi('hover')
    // Close picker.
    if (this._titlePickerEl) this._titlePickerEl.dataset.open = 'false'
    if (this._outsideClickHandler) {
      document.removeEventListener('click', this._outsideClickHandler)
      this._outsideClickHandler = null
    }
    // Update the chip text in-place — rerender the whole overlay is
    // overkill, so just patch the chip's name span.
    const newTitle = PlayerProfile.getActiveTitle()
    const nameEl = this._el?.querySelector('.qf-ach-titlechip-name')
    if (nameEl && newTitle) nameEl.textContent = newTitle.name
  }

  // Pick the right inner view for the active tab. Wrapped this way so
  // `_selectTab` can re-render only `.qf-ach-view-wrap`'s child without
  // disturbing the header/tabs/footer.
  _renderActiveView() {
    if (this._activeTab === LEADERBOARD_TAB) {
      return this._renderLeaderboardView()
    }
    return this._renderGrid()
  }

  // Build the cards grid as a fresh DOM subtree. Caller can replace just
  // the grid-wrap's child to refresh without nuking the rest of the screen.
  _renderGrid() {
    const unlocked = this._unlockedSet()
    const myUnlocked = this._viewer ? PlayerProfile.getUnlockedAchievements() : null
    const cards = []
    for (const def of this._defs) {
      if (this._activeTab !== 'all' && def.category !== this._activeTab) continue
      cards.push(this._card(def, unlocked, myUnlocked))
    }
    return h('div', { className: 'qf-ach-grid' }, cards)
  }

  _card(def, unlockedSet, myUnlockedSet) {
    const isUnlocked = unlockedSet.has(def.id)
    const icon       = def.icon || CATEGORY_FALLBACK_ICON[def.category] || '◆'
    const target     = def.target ?? 1
    // Progress is only meaningful in self-view; viewer-mode has no
    // per-metric numerics for other players (just binary unlock state).
    const progress   = this._viewer ? null : AchievementSystem.getProgress(def.id)

    // Reward-type classification — drives BOTH the reward chip's color
    // AND the icon medal color. Boss-unlock / companion-unlock / title-
    // grant achievements get a colored icon matching their reward chip
    // (visually doubling the "this gives you X" signal). Pure-recognition
    // achievements (no reward, no title) get a cream icon to read as
    // "unclaimed plaque" — most of the grid, which gives natural contrast
    // against the colored category borders.
    let rewardType = 'recognition'
    if (def.reward?.type === 'boss')           rewardType = 'boss'
    else if (def.reward?.type === 'companion') rewardType = 'companion'
    else if (def.title)                        rewardType = 'title'

    // Reward chip — boss / companion / title unlocks call out what the
    // player gets. Pure-recognition achievements skip the chip entirely.
    let rewardChip = null
    if (rewardType === 'boss') {
      rewardChip = h('div', {
        className: 'qf-ach-reward qf-ach-reward--boss',
        dataset: { rewardType: 'boss' },
      }, `◆ Unlocks ${def.reward.id.replace(/_/g, ' ').toUpperCase()}`)
    } else if (rewardType === 'companion') {
      // Pull the display name from the COMPANIONS registry so "rattlebones"
      // → "RATTLE BONES" (with the space) and "zulgath" → "ZUL'GATH" (with
      // the apostrophe) instead of the squashed id-derived string. Falls
      // back to the id if the companion is somehow missing from the
      // registry. Format matches the boss chip's brevity ("◆ Unlocks
      // BEHOLDER") — the heart icon + chip color already signal "this
      // unlocks a companion", so the redundant "companion:" label is
      // dropped (it was overflowing the card width on longer names).
      const cName = (COMPANIONS[def.reward.id]?.name || def.reward.id).toUpperCase()
      rewardChip = h('div', {
        className: 'qf-ach-reward qf-ach-reward--companion',
        dataset: { rewardType: 'companion' },
      }, `♥ Unlocks ${cName}`)
    } else if (rewardType === 'title') {
      // Title-granting achievements show their title here as the reward.
      rewardChip = h('div', {
        className: 'qf-ach-reward qf-ach-reward--title',
        dataset: { rewardType: 'title' },
      }, `✦ Title: ${def.title}`)
    }

    // Rarity badge — appears once the leaderboard sample has been
    // ingested. Format: "5% have this" with the gold-bright accent for
    // rare (<10%) achievements. Absent when no data yet.
    let rarityChip = null
    const rarity = AchievementSystem.getRarity(def.id)
    if (rarity != null && rarity.sample > 0) {
      const pct = Math.round(rarity.fraction * 100)
      const isRare = rarity.fraction < 0.1
      rarityChip = h('div', {
        className: 'qf-ach-rarity' + (isRare ? ' qf-ach-rarity--rare' : ''),
      }, [
        h('span', { className: 'qf-ach-rarity-pct' }, `${pct}%`),
        h('span', { className: 'qf-ach-rarity-label' }, isRare ? 'rare' : 'earned'),
      ])
    }

    // Progress bar — shown for numeric in-progress (not unlocked yet AND
    // target > 1). One-shot booleans (target=1) skip the bar.
    let progressEl = null
    if (!isUnlocked && progress != null && target > 1) {
      const pct = Math.max(0, Math.min(100, (progress / target) * 100))
      progressEl = h('div', { className: 'qf-ach-progress' }, [
        h('div', { className: 'qf-ach-progress-track' }, [
          h('div', { className: 'qf-ach-progress-fill', style: { width: pct + '%' } }),
        ]),
        h('div', { className: 'qf-ach-progress-text' }, `${progress} / ${target}`),
      ])
    }

    // "NEW" chip — paints in the top-LEFT corner of any card whose id was
    // UNSEEN at the moment `open()` ran (i.e. added to achievements.json
    // since the player last opened this overlay). open() already marked
    // every current id as seen, so the chip only renders on this one
    // visit — closing + reopening the overlay clears it. Self-view only
    // (viewer mode browses someone else's grid). Visual matches the
    // main-menu NEW badge so the two read as the same kind of signal.
    let newChip = null
    if (!this._viewer && this._newAtOpen?.has(def.id)) {
      newChip = h('span', { className: 'pix qf-ach-new-chip' }, 'NEW')
    }

    // Compare-mode badge (Phase C). 🟢 both / 🔵 they have, you don't /
    // 🟡 you have, they don't / ⚪ neither.
    let compareBadge = null
    if (this._viewer && this._compareMode && myUnlockedSet) {
      const theyHave = isUnlocked
      const youHave  = myUnlockedSet.has(def.id)
      let cls = 'neither'
      if (theyHave && youHave)        cls = 'both'
      else if (theyHave && !youHave)  cls = 'their-edge'
      else if (!theyHave && youHave)  cls = 'your-edge'
      compareBadge = h('div', {
        className: 'qf-ach-compare-badge qf-ach-compare-badge--' + cls,
      })
    }

    const cardAttrs = {
      className: 'qf-ach-card',
      dataset: {
        id:        def.id,
        category:  def.category,
        unlocked:  isUnlocked ? 'true' : 'false',
        // Legendary tier — data-driven via `def.legendary` in
        // `achievements.json`. Drives the CSS `[data-legendary="true"]`
        // block (showcase shimmer border + ember glow).
        legendary: def.legendary ? 'true' : 'false',
        // Reward-type classification on the card so descendant elements
        // (the icon medal, in particular) can match the reward color
        // even though the reward chip is a sibling. Values:
        // 'boss' | 'companion' | 'title' | 'recognition'.
        rewardType: rewardType,
      },
      // NEW-chip hover dismiss — the ONLY way to clear an achievement's
      // NEW chip per the design (matches the companion-card pattern).
      // Marks just this id known in PlayerProfile (persisted), removes
      // it from the in-memory snapshot so a sibling re-render won't
      // re-paint, fades the chip out, and removes it from the DOM. Self-
      // view only — viewer mode is browsing someone else's grid and
      // shouldn't mutate the local player's state.
      on: this._viewer ? undefined : {
        mouseenter: (e) => {
          if (!this._newAtOpen?.has(def.id)) return
          PlayerProfile.markAchievementsKnown([def.id])
          this._newAtOpen.delete(def.id)
          const chip = e.currentTarget?.querySelector('.qf-ach-new-chip')
          if (chip) {
            chip.classList.add('is-dismissing')
            setTimeout(() => chip.remove(), 260)
          }
        },
      },
    }
    // `.qf-ach-card-body` exists so the locked-card desaturation filter
    // can be applied to a SUBTREE of the card instead of the whole card.
    // CSS `filter` applies at composite time to the parent + ALL its
    // descendants, with no way for a descendant to opt back out (a child
    // `filter: none` just adds an identity filter — it doesn't escape).
    // The body wraps ONLY the icon-+-text row, leaving compareBadge,
    // rarityChip, and newChip as direct children of the card so their
    // absolute positions still resolve relative to the card itself
    // (preserving the corner placements they had before the refactor)
    // AND they all sit outside the dim filter so the NEW chip pulses
    // bright on locked cards. The rarity + compare chips reading at
    // full brightness on locked cards is fine — they're informational
    // overlays, not part of the "you don't have this" visual cue.
    return h('div', cardAttrs, [
      compareBadge,
      rarityChip,
      newChip,
      h('div', { className: 'qf-ach-card-body' }, [
        h('div', { className: 'qf-ach-card-row' }, [
          h('div', { className: `pix qf-ach-icon qf-ach-icon--${def.category}` }, icon),
          h('div', { className: 'qf-ach-card-col' }, [
            h('div', { className: 'pix qf-ach-name' }, def.name),
            h('div', { className: 'qf-ach-desc' }, def.description),
            progressEl,
            rewardChip,
          ]),
        ]),
      ]),
    ])
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
    // Refresh CATEGORY tab active state visually.
    for (const tabEl of this._el.querySelectorAll('.qf-ach-tab')) {
      tabEl.classList.toggle('is-active', tabEl.dataset.cat === tabId)
    }
    // Refresh LEADERBOARD button active state — different selector so
    // the gold-burst styling toggles correctly.
    const lbBtn = this._el.querySelector('.qf-ach-lb-btn')
    if (lbBtn) lbBtn.classList.toggle('is-active', tabId === LEADERBOARD_TAB)
    // Kick off leaderboard fetch on first activation of the LEADERBOARD
    // tab (lazy — saves a Supabase round-trip if the player never
    // opens it). Subsequent re-entry reuses the cached `_lbRows`.
    if (tabId === LEADERBOARD_TAB && this._lbRows == null && !this._lbLoading) {
      this._loadLeaderboard()
    }
    // Re-render the view region (grid OR leaderboard).
    const wrap = this._el.querySelector('.qf-ach-view-wrap')
    if (wrap) wrap.replaceChildren(this._renderActiveView())
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
      // Refresh the grid too in case we're not on the leaderboard tab
      // when the fetch lands — the rarity badges should appear retro-
      // actively.
      if (this._activeTab !== LEADERBOARD_TAB) {
        const wrap = this._el?.querySelector('.qf-ach-view-wrap')
        if (wrap) wrap.replaceChildren(this._renderActiveView())
      }
    } catch (err) {
      console.warn('[AchievementsOverlay] leaderboard fetch failed:', err)
      this._lbError = err?.message || 'Failed to load.'
      this._lbRows = []
    } finally {
      this._lbLoading = false
      // If we're still on the leaderboard tab, refresh the view.
      if (this._activeTab === LEADERBOARD_TAB) {
        const wrap = this._el?.querySelector('.qf-ach-view-wrap')
        if (wrap) wrap.replaceChildren(this._renderActiveView())
      }
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
      // Title chip — when the player has an active title, show it here
      // (matches the main lb's accolade chip slot).
      player.activeTitle && h('div', {
        className: 'pix qf-ach-lb-podium-title',
        style: { color: c, borderColor: c },
      }, player.activeTitle),
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
      viewer:  { name: player.name, bitmask: player.achievementBits },
      onClose: () => { this._playerViewer = null },
    })
    this._playerViewer.open()
  }

  _toggleCompare() {
    if (!this._viewer) return
    this._compareMode = !this._compareMode
    const btn = this._el.querySelector('.qf-ach-compare-toggle')
    if (btn) btn.textContent = this._compareMode ? '◉ COMPARING' : '◇ COMPARE WITH YOU'
    const wrap = this._el.querySelector('.qf-ach-grid-wrap')
    if (wrap) wrap.replaceChildren(this._renderGrid())
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

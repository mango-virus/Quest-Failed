// MainMenuOverlay — DOM-hosted title screen (post-2026-06-09 rebuild).
//
// Sits OVER the Phaser MainMenu scene, which renders the throne-room
// backdrop (last-played archetype + flanking torches + slow camera pan —
// see src/scenes/MainMenu.js). Mounts directly into #hud-stage (the
// 1920×1080 logical stage), independent of the in-game HudRoot.
//
// Layout B — center-stacked, no side panel:
//   * Top-center: QUEST / FAILED logo (flanked in-canvas by the torches)
//   * Background: the Phaser boss throne scene shows through
//   * Bottom-center slab: identity strip (player name + title pill) +
//     reign-state line ("YOUR REIGN, MY LORD" + boss / day / kills) +
//     vertical narrow button stack:
//       CONTINUE (red primary, gated by hasSave) → load saved gameState
//       NEW EVIL (gold)                          → confirm + ArchetypeSelect
//       LEADERBOARD (cyan)                       → LeaderboardOverlay
//       ACHIEVEMENTS / COMPANIONS                → respective overlays
//       DEV TOOLS (mango-only)                   → DevToolsOverlay (editors etc.)
//       WHAT'S NEW                               → WhatsNewOverlay
//       OPTIONS (warn)                           → SettingsOverlay
//       QUIT (mute)                              → tries window.close()
//     + "› PRESS Z TO CONTINUE" prompt + italic flavor quote
//   * Footer (bottom edge): version / SAVE OK · NO SAVE / © BONEMAKER · MMXXVI
//
// Removed in the 2026-06-09 rebuild: the boss-video shuffle pool, the CRT
// scanline + vignette filters, the right-side panel + split-grid layout,
// and the Venture jam-portal button (both here and the in-game
// JamPortalCorner). portal.js SDK untouched per jam rules.

import { h, mount } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { SaveSystem } from '../systems/SaveSystem.js'
import { SettingsOverlay } from './SettingsOverlay.js'
import { ConfirmPopup } from './ConfirmPopup.js'
import { EventBus } from '../systems/EventBus.js'
import { HudSfx, installHudSfxDelegates } from './HudSfx.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { AchievementSystem } from '../systems/AchievementSystem.js'
import { getUnlockedBossIds } from '../data/bossUnlocks.js'
import { Leaderboard } from '../systems/Leaderboard.js'
import { GameRequests } from '../systems/GameRequests.js'
import { NameEntryOverlay } from './NameEntryOverlay.js'
import { TitlePickerOverlay } from './TitlePickerOverlay.js'
import { WhatsNewOverlay } from './WhatsNewOverlay.js'
import {
  titleFxClassById, titleFxBorderClassById, titleColorById,
} from './titleFx.js'

// (2026-06-09 rebuild) Boss-video pool removed — the title-screen backdrop
// is now an in-engine throne-room render owned by the Phaser MainMenu
// scene (see src/scenes/MainMenu.js).

// Scene keys to stop before any MainMenu→elsewhere transition. Two groups:
//
//   * The in-flight RUN scenes (mirrors PauseManager.GAMEPLAY_SCENES). The
//     previous run's listeners must not leak into the new one — e.g. an old
//     DungeonRenderer responding to ROOM_PLACED emitted during createGameState,
//     or an old NpcDirector emitting old-companion lines into the new bubble.
//
//   * `MainMenu` itself. We use `game.scene.start(target)` (the GLOBAL scene
//     plugin) which only starts the target — it does NOT stop the calling
//     scene. Before the 2026-06-09 rebuild this leak was invisible (the
//     Phaser MainMenu drew nothing), but the new throne-room backdrop (boss
//     sprite + torches + gradient) was rendering through under the dungeon
//     because MainMenu kept ticking. Explicit stop fixes it.
const SCENES_TO_STOP_ON_LEAVE = [
  'Game', 'NightPhase', 'DayPhase', 'EndOfDay',
  'Graveyard', 'KnowledgeScreen', 'HudScene',
  'MainMenu',
]

function _stopAllGameplayScenes(sm) {
  if (!sm) return
  for (const key of SCENES_TO_STOP_ON_LEAVE) {
    if (sm.isActive(key) || sm.isPaused(key)) sm.stop(key)
  }
}

export class MainMenuOverlay {
  constructor() {
    this._el = null
    this._settings = null
    this._leaderboard = null
    this._confirm = null
    this._nameEntry = null
    this._devTools = null
    this._whatsNew = null
    this._hovered = 'continue'
    this._save = null
    this._closed = false
    this._keyHandler = (e) => this._onKey(e)
  }

  open() {
    if (this._el) return
    // Install the delegated click/hover SFX listeners on #hud-stage so
    // MainMenu / Options / Leaderboard reached from the title screen
    // get button sounds — HudRoot installs the same delegates during
    // gameplay, but on a fresh page load MainMenu opens BEFORE HudRoot
    // mounts and the delegates would otherwise be missing. Idempotent.
    installHudSfxDelegates()
    // Own a ConfirmPopup — the in-game one lives in HudRoot, which isn't
    // mounted at the title screen. Used by the jam-portal "are you sure"
    // prompt; listens for SHOW_CONFIRM.
    this._confirm = new ConfirmPopup()
    this._save = SaveSystem.hasSave() ? SaveSystem.load() : null
    if (!this._save) this._hovered = 'new'   // CONTINUE is disabled — default-focus NEW EVIL
    this._render()
    window.addEventListener('keydown', this._keyHandler)
    // Background prefetch of the top-3 leaderboard so the LEADERBOARD
    // button's NEW badge can compute correctly on the very first menu
    // render of a session (when the cache might be empty — e.g. a fresh
    // browser, or someone who renamed to a brand-new name and hasn't
    // opened the leaderboard yet under it). The fetch is fire-and-forget;
    // when it resolves it writes the global cache, and we then re-sync
    // the menu badges so the LEADERBOARD pill can appear retroactively
    // without the player needing to open the overlay first.
    Leaderboard.fetchTop?.(3)
      .then((rows) => {
        if (this._closed || !this._el) return
        this._refreshMenuItems()
        // Top-3 celebration check — queues an entry on PlayerProfile's
        // pending-unlocks list if the player's most recent finished run
        // placed in the top 3. The fire below picks it up alongside any
        // achievement cards already queued from the run.
        this._maybeQueueTop3Celebration(rows)
        // Demotion check — the negative counterpart: if the player USED
        // to hold a podium spot and has since been knocked down / off,
        // queue the "dethroned" card. Runs after the celebration check
        // (the two are mutually exclusive for a given fetch — you can't
        // simultaneously climb and fall).
        this._maybeQueueLeaderboardDemotion(rows)
        this._maybeFireUnlockOverlay()
        this._maybeAutoOpenWhatsNew()
      })
      .catch(() => {
        // Fetch failed (offline / Supabase down) — still fire any
        // achievement unlocks already queued from the just-finished run.
        // The top-3 celebration is naturally skipped (we can't know
        // placement without the fetch); a later main-menu visit with
        // working network will catch it as long as the celebrated-runId
        // gate hasn't been burned yet.
        if (this._closed || !this._el) return
        this._maybeFireUnlockOverlay()
        this._maybeAutoOpenWhatsNew()
      })
    // Same idea for the GAME REQUESTS mail-chip — prefetch counts so
    // the ✉ badge can render on first paint. Caches the result inside
    // GameRequests; we just trigger a re-sync of the menu items when
    // the fetch lands.
    GameRequests.prefetchUnreadCounts?.({
      playerName: PlayerProfile.getName?.(),
      isMango:    !!PlayerProfile.isCheatName?.(),
    }).then(() => {
      if (this._closed || !this._el) return
      this._refreshMenuItems()
    }).catch(() => {})
    // Listen for player-name swaps from ANY source (NameEntryOverlay
    // confirm path is already wired locally, but a name swap could
    // also originate from the legacy Options scene or future surfaces).
    // Refresh per-name UI in-place: the player-name pill, then the
    // NEW badges (driven by the new name's seen-sets). No full
    // re-render — that would re-fire menu-item entrance animations
    // and recreate the boss-video element without a src.
    this._onNameChanged = () => {
      if (this._closed || !this._el) return
      this._syncNameDependentUI()
    }
    EventBus.on('NAME_CHANGED', this._onNameChanged)
    // Unlock-celebration overlay firing is now driven by the leaderboard
    // fetch above — fetch resolve (success or failure) calls
    // _maybeFireUnlockOverlay, which checks PlayerProfile's pending-
    // unlocks queue and opens the overlay if anything's in it. This
    // ordering ensures the optional top-3 celebration card (queued by
    // _maybeQueueTop3Celebration once we have the row data) is in the
    // queue BEFORE the overlay snapshots it at construction time. If
    // the queue had been drained while the fetch was still in flight,
    // any late-arriving top-3 entry would have been silently cleared.
  }

  close() {
    this._closed = true
    this._el?.remove()
    this._el = null
    this._refs = null
    window.removeEventListener('keydown', this._keyHandler)
    if (this._onNameChanged) {
      EventBus.off('NAME_CHANGED', this._onNameChanged)
      this._onNameChanged = null
    }
    this._settings?.close()
    this._settings = null
    this._confirm?.destroy()
    this._confirm = null
    this._nameEntry?.close()
    this._nameEntry = null
    this._titlePicker?.close()
    this._titlePicker = null
    this._devTools?.close()
    this._devTools = null
    this._whatsNew?.close()
    this._whatsNew = null
    // Close the unlock-notification overlay if it's still up (player
    // hits NEW EVIL / CONTINUE / QUIT during the celebration). Its
    // close handler also calls clearPendingUnlocks(), so they don't
    // replay.
    this._unlockOverlay?.close()
    this._unlockOverlay = null
  }

  // ─── Rendering ─────────────────────────────────────────────────
  _render() {
    if (!this._el) {
      this._el = h('div', { className: 'mm-root qf-mm' })
      // Mount into the 1920×1080 #hud-stage so MainMenu letterboxes on
      // non-16:9 viewports the same way the in-game HUD does. Ensure the
      // stage is scaled even if HudRoot hasn't mounted yet (which it
      // hasn't, at the title screen).
      ensureStageScaled()
      const stage = document.getElementById('hud-stage') || document.body
      stage.appendChild(this._el)
    }
    mount(this._el, this._renderInner())
  }

  _renderInner() {
    const items = this._menuItems()
    return [
      // TOP — QUEST / FAILED logo block, centered. Sits above the in-engine
      // torches the Phaser MainMenu draws to either side (their positions
      // mirror LOGO_CENTER_* / TORCH_OFFSET_X in src/scenes/MainMenu.js).
      h('div', { className: 'qf-mm-logoblock qf-mm-logoblock-top' }, [
        h('div', { className: 'pix mm-logo-eyebrow qf-mm-eyebrow' }, [
          h('span', { className: 'qf-mm-eye-glyph' }, '◇'),
          'A DUNGEON-BUILDER ROGUELIKE',
          h('span', { className: 'qf-mm-eye-glyph' }, '◇'),
        ]),
        h('div', { className: 'pix mm-logo qf-mm-logo-quest' }, 'QUEST'),
        h('div', {
          className: 'pix mm-logo qf-mm-logo-failed',
          style: { animationDelay: '180ms' },
        }, 'FAILED'),
      ]),
      // BOTTOM SLAB — identity strip + reign-state line + vertical button
      // stack + flavor + footer. Centered, narrow. The throne-room boss
      // sprite (Phaser canvas) is visible above the slab.
      h('div', { className: 'qf-mm-slab' }, [
        h('div', { className: 'qf-mm-identity' }, [
          // Player-name row — clickable to open NameEntryOverlay. Persistent
          // identity above the reign info so the player can see / change
          // their name from the title screen at any time.
          this._renderPlayerName(),
          // Equipped-title pill — shows the title the player is currently
          // wearing (rendered in its own fx/colour), click to change it
          // via TitlePickerOverlay. Hidden entirely until they unlock
          // their first title.
          this._renderTitlePill(),
        ]),
        h('div', { className: 'qf-mm-reign' }, [
          h('div', { className: 'pix qf-mm-eyebrow-sm mm-logo-eyebrow' },
            'YOUR REIGN, MY LORD'),
          h('div', {
            className: 'pix qf-mm-currentboss mm-current-boss',
            ref: el => { (this._refs ||= {}).bossName = el },
          }, this._currentBossName()),
          h('div', {
            className: 'qf-mm-currentsub',
            ref: el => { (this._refs ||= {}).bossSub = el },
          }, this._currentBossSub()),
        ]),
        h('div', {
          className: 'qf-mm-items',
          // Keep a ref so the cheat-name flip (mango on/off) can surgically
          // swap the items without re-rendering the entire menu.
          ref: el => { this._refs = { ...(this._refs || {}), menuItems: el } },
        }, items.map((m, i) => this._renderItem(m, i))),
        h('div', { className: 'qf-mm-bottom' }, [
          h('div', { className: 'pix mm-prompt qf-mm-prompt' },
            '› PRESS Z TO CONTINUE'),
          h('div', { className: 'mm-logo-tag qf-mm-quote' }, [
            '"The fools come bearing torches and prayers.',
            h('br'),
            'They will leave bearing nothing."',
          ]),
        ]),
      ]),
      // FOOTER — version / save state / copyright, anchored to the very
      // bottom edge of the 1920×1080 stage.
      h('div', { className: 'pix qf-mm-footer qf-mm-footer-bottom' }, [
        h('span', null, 'v 0.1.4'),
        h('span', {
          ref: el => { (this._refs ||= {}).savePill = el },
          style: { color: this._save ? 'var(--poison)' : 'var(--text-dim)' },
        }, this._save ? 'SAVE OK' : 'NO SAVE'),
        h('span', null, '© BONEMAKER · MMXXVI'),
      ]),
    ]
  }

  _renderItem(m, i) {
    const dimmed = m.enabled === false
    let btnEl
    // Hover visuals are pure CSS now — flipping a JS state flag on
    // mouseenter caused the whole item list to re-render, which re-fired
    // each button's `mm-item-in` animation (with its own 500-700ms delay)
    // and made the menu flash empty mid-hover. The primary tint applies
    // via .qf-mm-item.qf-mm-item-primary:hover.
    return h('button', {
      className: `btn mm-item qf-mm-item${m.primary ? ' qf-mm-item-primary' : ''}`,
      dataset: { id: m.id, dimmed: dimmed ? 'true' : 'false' },
      style: {
        '--item-color': m.color,
        animationDelay: `${500 + i * 70}ms`,
        opacity: dimmed ? 0.4 : 1,
      },
      disabled: dimmed,
      ref: el => { btnEl = el },
      // Gate on the LIVE disabled state, not the render-time `dimmed` closure —
      // _refreshMenuItems flips el.disabled in place when the active player's
      // save changes (name switch), so the captured value would go stale.
      on: { click: () => { if (!btnEl?.disabled) this._activate(m.id) } },
    }, [
      h('span', {
        className: 'pix qf-mm-item-icon',
        // Inline color as a defensive fallback — if for any reason the
        // --item-color var is missing on this button, the icon still gets
        // its design tint.
        style: { color: m.color },
      }, m.icon),
      h('div', { className: 'qf-mm-item-textcol' }, [
        h('div', { className: 'pix qf-mm-item-label' }, m.label),
        h('div', { className: 'qf-mm-item-sub' }, m.sub),
      ]),
      // "NEW" badge — appears beside the label on items the player
      // hasn't engaged with yet (currently just the ACHIEVEMENTS entry
      // via `newBadge: !PlayerProfile.hasSeenAchievements()`). Cleared
      // by the surgical DOM removal in `_openAchievements`'s onClose
      // path so the badge disappears immediately after first use,
      // without re-running the item's entrance animation.
      m.newBadge && h('span', { className: 'pix qf-mm-item-new' }, 'NEW'),
      // Mail-icon badge — used by GAME REQUESTS to signal that there's
      // unseen mail (a dev reply to the player's submission, or new
      // submissions for mango to triage). Different colour family than
      // NEW so both can co-exist if needed; positioned on the opposite
      // edge so they don't overlap.
      m.mailBadge > 0 && h('span', { className: 'pix qf-mm-item-mail' }, [
        h('span', { className: 'qf-mm-item-mail-icon' }, '✉'),
        ' ',
        String(m.mailBadge),
      ]),
    ])
  }

  _menuItems() {
    const items = [
      { id: 'continue', label: 'CONTINUE', sub: this._continueSub(), icon: '▶',
        primary: true, enabled: !!this._save, color: 'var(--blood)' },
      { id: 'new', label: 'NEW EVIL', sub: 'Begin a new run', icon: '+', color: 'var(--gold)',
        // Cross-surface NEW badge — fires if EITHER an unlocked companion
        // OR an unlocked boss is still tagged on its respective select
        // screen. Both surfaces clear their own tags via hover-dismiss,
        // and once the underlying seen-set has no unseen unlocked ids
        // left on either side, this OR collapses to false and the badge
        // goes away. Drives the player to the start-a-run flow when they
        // have something fresh to encounter at picking time.
        newBadge: PlayerProfile.hasUnseenNewCompanions(
                    [...PlayerProfile.getUnlockedCompanions()]
                  ) ||
                  PlayerProfile.hasUnseenNewBosses(getUnlockedBossIds()) },
      { id: 'leader', label: 'LEADERBOARD', sub: 'Global hall of evil', icon: '◆', color: 'var(--rumor)',
        // NEW badge fires when the last-known top-3 contains any
        // run ROW ID the local player hasn't hover-acknowledged on
        // the leaderboard podium yet. Source for the top-3 list is
        // `Leaderboard.getCachedTop3()` — written by every `fetchTop`
        // call, so this badge stays live across sessions without
        // firing its own fetch. Self-rows are filtered out by
        // canonical-name compare against the local player's name.
        //
        // Optimistic-default: when the cache is empty (fresh browser,
        // post-v2-migration session, or a prefetch that hasn't landed
        // yet) we DON'T have data to compare against, so we fire the
        // badge anyway. Opening the leaderboard once populates the
        // cache and seeds the real comparison; the badge then settles
        // to the accurate "any unseen id?" state on subsequent renders.
        // Without this default, fresh sessions never see the badge
        // until they manually open the overlay — which is the very
        // thing the badge is supposed to encourage them to do.
        newBadge: (() => {
          const myCanon = PlayerProfile.getName().trim().toLowerCase()
          const cached = Leaderboard.getCachedTop3?.() || []
          // Optimistic-on when there's nothing cached yet — see comment
          // above. The prefetch fired in `open()` will resolve shortly
          // and re-sync (which may then HIDE the badge if everything's
          // already in the seen-set, but only after we have real data).
          if (cached.length === 0) return true
          const ids = cached
            .filter(e => e && typeof e.id === 'string' && e.id &&
                         (!myCanon ||
                          (typeof e.name !== 'string') ||
                          e.name.trim().toLowerCase() !== myCanon))
            .map(e => e.id)
          // After filtering self-rows, if the cache only contained
          // your own runs, `ids` is empty → nothing to flag — return
          // false here (not optimistic, since we DO have data and it's
          // genuinely empty for the badge's purpose).
          if (ids.length === 0) return false
          return PlayerProfile.hasUnseenNewLeaderboardIds(ids)
        })() },
      { id: 'achievements', label: 'ACHIEVEMENTS', sub: 'Hall of trophies', icon: '🏆',
        color: 'var(--gold-bright, #ffd964)',
        // Show a "NEW" badge whenever there's an achievement in the data
        // file the player hasn't been introduced to yet. Drives both the
        // first-time-player intro (fresh seen-set → all current ids are
        // unseen → badge shows) AND the "we just added a new achievement,
        // tag comes back" behavior (seen-set lacks the new id → badge
        // shows). Cleared when the player opens the overlay — at which
        // point AchievementsOverlay calls markAchievementsKnown(allIds).
        newBadge: PlayerProfile.hasUnseenNewAchievements(
          (AchievementSystem.getDefinitions?.() || []).map(d => d.id)
        ) },
      { id: 'requests', label: 'GAME REQUESTS', sub: 'Requests and feedback', icon: '✉',
        color: 'var(--rumor)',
        // Per-name NEW badge — fires until the player has opened the
        // overlay at least once. Cleared in _openGameRequests after
        // PlayerProfile.markGameRequestsSeen.
        newBadge: !PlayerProfile.hasSeenGameRequests(),
        // Mail-icon chip — count of unseen replies (for the player) +
        // unseen new submissions (for mango). Sourced from the in-
        // memory cache populated by GameRequests.prefetchUnreadCounts
        // (fired in open(), and again on overlay close so a viewed
        // tab clears its chip on the next render). Sum so a single
        // ✉ chip serves both purposes — clicking GAME REQUESTS lands
        // on whatever tab has mail.
        mailBadge: (GameRequests.getCachedPlayerMail?.() ?? 0) +
                   (GameRequests.getCachedAdminMail?.() ?? 0) },
    ]
    // Dev surfaces (editors, day-jump, notification tests) are mango-only
    // and live behind a SINGLE "DEV TOOLS" row that opens DevToolsOverlay —
    // they used to be listed individually here, but the growing list ran
    // off the bottom of the panel. One row keeps the menu compact and
    // scales as more tools are added (just edit DEV_TOOL_GROUPS in
    // DevToolsOverlay.js + add the matching _activate case). The menu-items
    // list is re-rendered (surgically) on name change so this row appears /
    // disappears when flipping into / out of the cheat name.
    if (PlayerProfile.isCheatName()) {
      items.push(
        { id: 'devtools', label: 'DEV TOOLS', sub: 'Editors · day-jump · tests', icon: '⚙', color: 'var(--poison)' },
      )
    }
    items.push(
      // Permanent re-open of the recent-updates panel. NEW badge shows
      // while there's an update the player hasn't acknowledged yet (same
      // badge mechanism as ACHIEVEMENTS); cleared once they open it.
      { id: 'whatsnew', label: "WHAT'S NEW", sub: 'Recent updates & additions', icon: '✨',
        color: 'var(--gold-bright, #ffd964)', newBadge: WhatsNewOverlay.hasUnseen() },
      { id: 'options', label: 'OPTIONS', sub: 'Audio · controls', icon: '◇', color: 'var(--warn)' },
      { id: 'quit', label: 'QUIT', sub: 'Return to the mortal realm', icon: '✖', color: 'var(--text-mute)' },
    )
    return items
  }

  _continueSub() {
    if (!this._save) return 'No saved run'
    const day = this._save.meta?.dayNumber ?? 1
    return `Resume Day ${day}`
  }

  _currentBossName() {
    if (!this._save) return 'A NEW DUNGEON AWAITS'
    const archId = String(this._save.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (!archId) return 'YOUR BOSS'
    // Try to resolve the archetype name from the cache.
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const archs = s.cache?.json?.get?.('bossArchetypes')
      if (Array.isArray(archs)) {
        const arch = archs.find(a => a.id === archId)
        if (arch?.name) return arch.name.toUpperCase()
      }
    }
    return archId.replace(/_/g, ' ').toUpperCase()
  }

  _currentBossSub() {
    if (!this._save) return 'Begin your evil to claim a name in the bone-halls.'
    const day   = this._save.meta?.dayNumber ?? 1
    const kills = this._save.player?.totalKills
                ?? this._save.run?.totals?.advsKilled
                ?? 0
    return `Day ${day} · ${kills} kill${kills === 1 ? '' : 's'}`
  }

  // ─── Player name ───────────────────────────────────────────────
  // Pill above the boss heading that shows the current player name (or
  // "SET YOUR NAME" if unset) and opens NameEntryOverlay on click. The
  // old Phaser MainMenu prompted via NameEntryPanel before each new run;
  // this is the DOM equivalent, persistent so the player can change their
  // name from the title screen at any time. Drives per-name progression
  // in PlayerProfile (boss-level unlocks scope to the current name).
  _renderPlayerName() {
    const name = PlayerProfile.getName().trim()
    const hasName = !!name
    return h('button', {
      className: 'qf-mm-playername' + (hasName ? '' : ' qf-mm-playername-empty'),
      title: hasName
        ? `Change your name (currently ${name})`
        : 'Set your name — required to begin a new run',
      'aria-label': hasName ? `Change name from ${name}` : 'Set your name',
      // Keep a ref so we can surgically swap the pill on name change
      // instead of re-rendering the whole menu — a full _render() would
      // recreate the boss-video <video> element with no src and leave a
      // black stage until the next clip would have queued.
      ref: el => { this._refs = { ...(this._refs || {}), playerName: el } },
      on: { click: () => this._editName() },
    }, [
      // Tiny eyebrow above the name itself — names this control as an
      // action ("YOUR NAME · CLICK TO CHANGE") so it reads as a button
      // even at a glance, instead of looking like decorative metadata.
      h('div', { className: 'pix qf-mm-playername-eyebrow' },
        hasName ? 'YOUR NAME · CLICK TO CHANGE' : 'YOUR NAME — REQUIRED'),
      h('div', { className: 'qf-mm-playername-row' }, [
        h('span', { className: 'qf-mm-playername-icon' }, '✎'),
        h('span', { className: 'pix qf-mm-playername-label' },
          hasName ? name.toUpperCase() : 'SET YOUR NAME'),
      ]),
    ])
  }

  // ─── Equipped title ────────────────────────────────────────────
  // Pill beneath the player-name button showing the title the player is
  // currently wearing — drawn in the title's own signature look (animated
  // gradient for the legendary fx titles, solid signature colour for the
  // normal coloured ones, gold fallback otherwise). Click opens the
  // TitlePickerOverlay so they can swap it without leaving the menu.
  // Returns null (renders nothing) until the player has unlocked a title.
  _renderTitlePill() {
    const active = PlayerProfile.getActiveTitle()
    // Wrap so _refreshTitlePill can surgically swap the inner pill on
    // change without re-rendering the whole panel head (which would
    // recreate the boss-video element and blank the stage).
    return h('div', {
      className: 'qf-mm-titlepill-wrap',
      ref: el => { this._refs = { ...(this._refs || {}), titlePill: el } },
    }, active ? [this._buildTitlePillButton(active)] : [])
  }

  _buildTitlePillButton(active) {
    const count    = PlayerProfile.getUnlockedTitles().length
    const fxBorder = titleFxBorderClassById(active.id)
    const tColor   = fxBorder ? null : titleColorById(active.id)
    return h('button', {
      className: ('qf-mm-titlepill ' + fxBorder).trimEnd(),
      title: `Change your equipped title (currently ${active.name})`,
      'aria-label': `Change equipped title from ${active.name}`,
      style: tColor
        ? { borderColor: tColor, boxShadow: `0 0 16px ${tColor}55` }
        : undefined,
      on: { click: () => this._openTitlePicker() },
    }, [
      h('div', { className: 'pix qf-mm-titlepill-eyebrow' },
        count > 1 ? 'EQUIPPED TITLE · CLICK TO CHANGE'
                  : 'EQUIPPED TITLE'),
      h('div', { className: 'qf-mm-titlepill-row' }, [
        h('span', { className: 'qf-mm-titlepill-icon' }, '✦'),
        h('span', {
          className: ('pix qf-mm-titlepill-name ' + titleFxClassById(active.id)).trimEnd(),
          style: tColor ? { color: tColor } : undefined,
        }, active.name),
        count > 1 && h('span', { className: 'qf-mm-titlepill-count' },
          `· ${count} unlocked ▼`),
      ]),
    ])
  }

  // Open the standalone title picker. Refreshes the pill on every pick so
  // the menu reflects the new title live while the modal stays open.
  _openTitlePicker() {
    if (this._titlePicker) return
    this._titlePicker = new TitlePickerOverlay({
      onChange: () => this._refreshTitlePill(),
      onClose:  () => { this._titlePicker = null; this._refreshTitlePill() },
    })
    this._titlePicker.open()
  }

  // Surgically rebuild the title pill in place (e.g. after a pick).
  _refreshTitlePill() {
    const wrap = this._refs?.titlePill
    if (!wrap) return
    const active = PlayerProfile.getActiveTitle()
    wrap.replaceChildren(...(active ? [this._buildTitlePillButton(active)] : []))
  }

  // Open NameEntryOverlay seeded with the current name (if any). Saves on
  // confirm and surgically refreshes the player-name pill so the rest of
  // the menu (boss-video chain in particular) keeps playing untouched.
  _editName() {
    if (this._nameEntry) return
    const current = PlayerProfile.getName().trim()
    this._nameEntry = new NameEntryOverlay({
      title:        'YOUR NAME, MY LORD',
      instruction:  current
        ? 'Rename yourself — the dungeon will remember the new one.'
        : 'Enter your title — the dungeon will remember it.',
      initial:      current,
      confirmLabel: current ? 'SAVE' : 'BEGIN REIGN',
      onConfirm: (n) => {
        PlayerProfile.setName(n)
        this._nameEntry = null
        // Names are profiles: titles AND the save slot are per-name, so
        // re-resolve this name's save + refresh every name-dependent surface.
        this._syncNameDependentUI()
      },
      onCancel: () => { this._nameEntry = null },
    })
    this._nameEntry.open()
  }

  // Modal flavour used when NEW EVIL is clicked without a name set —
  // forces a name before the run can begin, then calls `after()` to
  // continue the new-run flow. Cancelling leaves the player on the menu.
  _promptForName(after) {
    if (this._nameEntry) return
    this._nameEntry = new NameEntryOverlay({
      title:        'YOUR NAME, MY LORD',
      instruction:  'A boss without a name is just another beast. Enter yours before you take the throne.',
      initial:      '',
      confirmLabel: 'BEGIN REIGN',
      onConfirm: (n) => {
        PlayerProfile.setName(n)
        this._nameEntry = null
        this._syncNameDependentUI()
        if (typeof after === 'function') after()
      },
      onCancel: () => { this._nameEntry = null },
    })
    this._nameEntry.open()
  }

  // Top-3 leaderboard celebration check — called after Leaderboard.fetchTop
  // resolves on main menu open. Given the fetched rows, looks up the
  // player's most recent finished run by runId; if it's in the top 3
  // AND we haven't already celebrated this specific run, queues a
  // 'leaderboard' unlock card and persists the celebrated runId.
  //
  // Match key: run_id (NOT player_name) — survives mid-run name changes,
  // correctly distinguishes between multiple runs by the same player,
  // and naturally fires again for a new run if it also places top-3.
  _maybeQueueTop3Celebration(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return
    const name = PlayerProfile.getName?.()
    if (!name) return
    const lastRunId = PlayerProfile.getLastFinishedRunId?.(name)
    if (!lastRunId) return
    const celebratedId = PlayerProfile.getCelebratedTop3RunId?.(name)
    if (celebratedId && celebratedId === lastRunId) return
    const top3 = rows.slice(0, 3)
    const myRowIdx = top3.findIndex(r =>
      r?.run_id === lastRunId &&
      String(r?.player_name ?? '').trim().toLowerCase() === name.trim().toLowerCase()
    )
    if (myRowIdx < 0) return
    const myRow = top3[myRowIdx]
    const rank = myRowIdx + 1
    // Record the placement for the leaderboard_top1/2/3 achievements
    // (idempotent — keeps the best rank ever). Fires the unlock card(s)
    // alongside the celebration below.
    AchievementSystem.recordLeaderboardRank?.(rank)
    PlayerProfile.queueUnlock?.({
      type:        'leaderboard',
      rank,
      runId:       lastRunId,
      bossId:      myRow.boss_id,
      bossLevel:   myRow.boss_level,
      days:        myRow.days_survived,
      kills:       myRow.total_kills,
      companionId: myRow.meta?.companionId,
    })
    PlayerProfile.setCelebratedTop3RunId?.(name, lastRunId)
  }

  // Demotion check — fires the "dethroned" notification when the player
  // has LOST ground on the podium since the last main-menu visit. The
  // negative mirror of _maybeQueueTop3Celebration.
  //
  // Standing grain: PODIUM rank by NAME (best/lowest 1-based index among
  // the fetched top-3 rows whose player_name matches), 0 = not on the
  // podium. We track the player's STANDING (not a specific run) because
  // demotion is about being overtaken by OTHERS — any of your runs
  // holding a slot counts, and you lose it when someone surpasses it.
  //
  // Fires when: a previously-recorded standing existed AND the new one
  // is strictly worse (a higher rank number, or off the podium). Seeded
  // silently on the first observation (getLastPodiumRank === -1) so a
  // player who was already below their historical peak when this feature
  // shipped doesn't get a spurious card. Always re-stamps the standing
  // so re-climbing resets the baseline and the next drop can fire again.
  _maybeQueueLeaderboardDemotion(rows) {
    if (!Array.isArray(rows)) return
    const name = PlayerProfile.getName?.()
    if (!name) return
    const me = name.trim().toLowerCase()
    const top3 = rows.slice(0, 3)
    let current = 0   // 0 = not on the podium
    top3.forEach((r, i) => {
      if (String(r?.player_name ?? '').trim().toLowerCase() === me) {
        const rank = i + 1
        if (current === 0 || rank < current) current = rank
      }
    })
    const prev = PlayerProfile.getLastPodiumRank?.(name) ?? -1
    // prev === -1 → never recorded: seed silently, no notification.
    // A drop = previously on the podium (prev >= 1) and now strictly
    // worse (off the podium, or a higher rank number).
    const dropped = prev >= 1 && (current === 0 || current > prev)
    if (dropped) {
      PlayerProfile.queueUnlock?.({
        type:     'demotion',
        fromRank: prev,
        toRank:   current,   // 0 = off the podium entirely
      })
    }
    PlayerProfile.setLastPodiumRank?.(name, current)
  }

  // Fire the UnlockNotificationOverlay if the pending-unlocks queue has
  // anything in it (achievement / boss / companion / title cards from
  // the just-finished run, OR the leaderboard top-3 celebration card
  // queued by _maybeQueueTop3Celebration above). Called from both the
  // success and failure branches of the leaderboard fetch chain so that
  // achievements still celebrate even if the fetch failed.
  //
  // 250ms delay so the menu's per-item entrance animations finish first.
  // Lazy import keeps the overlay off the main bundle on sessions where
  // nothing was unlocked.
  _maybeFireUnlockOverlay() {
    if ((PlayerProfile.getPendingUnlocks?.() || []).length === 0) return
    setTimeout(() => {
      if (this._closed || !this._el || this._unlockOverlay) return
      import('./UnlockNotificationOverlay.js').then(({ UnlockNotificationOverlay }) => {
        if (this._closed || !this._el || this._unlockOverlay) return
        this._unlockOverlay = new UnlockNotificationOverlay({
          onClose: () => {
            this._unlockOverlay = null
            // Queue is cleared by the overlay itself; re-sync badges
            // in case any unlock affected them (e.g. a new companion
            // now counts as "unseen" on the recruit screen).
            if (!this._closed && this._el) this._refreshMenuItems()
            // Chain the What's New auto-pop AFTER the celebration so a
            // returning-after-update player who also had unlocks never
            // misses it. The pending-unlocks queue is now cleared, so
            // _maybeAutoOpenWhatsNew's "skip if unlocks pending" gate
            // passes; the once-per-session flag still prevents a repeat.
            if (!this._closed && this._el) this._maybeAutoOpenWhatsNew()
          },
        })
        this._unlockOverlay.open()
      }).catch(() => {})
    }, 250)
  }

  // Swap just the player-name button without re-rendering the whole menu —
  // a full _render() would re-fire the menu-item entrance animations.
  _refreshPlayerName() {
    const old = this._refs?.playerName
    if (!old || !old.parentNode) return
    const fresh = this._renderPlayerName()
    old.parentNode.replaceChild(fresh, old)
  }

  // Rebuild the menu items list IN PLACE only when the cheat-name flip
  // actually changes the item set — ordinary renames (callum → alex) leave
  // the items untouched, so the per-item entrance animations don't re-fire.
  // Flipping into / out of "mango" rebuilds so ROOM/TILESET editors appear
  // or disappear without leaving the menu and coming back.
  //
  // For ordinary renames, also surgically swap the per-item NEW badges so
  // they reflect the NEW player's seen-set instead of the previous name's.
  // Without this, 123 → LJ would leave LJ looking at 123's stale badges
  // until the menu was fully torn down and reopened. The badge state is
  // the only per-name UI on these items today (other than the player-pill,
  // already handled by _refreshPlayerName); if that changes, extend the
  // sync block below to cover the new fields.
  _refreshMenuItems() {
    const host = this._refs?.menuItems
    if (!host) return
    const items = this._menuItems()
    if (items.length !== host.children.length) {
      // Full rebuild when the item set itself changed (cheat-name toggle).
      host.replaceChildren()
      items.forEach((m, i) => host.appendChild(this._renderItem(m, i)))
      return
    }
    // Count unchanged: walk the existing DOM and sync each NEW badge in
    // place. Adding the badge inserts the same `.qf-mm-item-new` span the
    // initial render would have, in the same slot (last child of the
    // item button), so the cleared-state DOM and the live-state DOM are
    // structurally identical — only the badge presence differs.
    for (let i = 0; i < items.length; i++) {
      const m  = items[i]
      const el = host.children[i]
      if (!el) continue
      const existing = el.querySelector(':scope > .qf-mm-item-new')
      const shouldShow = !!m.newBadge
      if (shouldShow && !existing) {
        // Build a span identical to the one `_renderItem` produces.
        const badge = document.createElement('span')
        badge.className = 'pix qf-mm-item-new'
        badge.textContent = 'NEW'
        el.appendChild(badge)
      } else if (!shouldShow && existing) {
        existing.remove()
      }
      // Mail-icon badge — same sync pattern, on the opposite edge.
      // Count > 0 → show; otherwise drop. Re-stamping the count text
      // each refresh keeps it accurate when the prefetch resolves.
      const mailEl = el.querySelector(':scope > .qf-mm-item-mail')
      const mailCount = m.mailBadge ?? 0
      if (mailCount > 0) {
        if (mailEl) {
          // Refresh just the count text (icon is a child span).
          const txtNode = Array.from(mailEl.childNodes).find(n => n.nodeType === Node.TEXT_NODE && /\d/.test(n.textContent))
          if (txtNode) txtNode.textContent = String(mailCount)
        } else {
          const badge = document.createElement('span')
          badge.className = 'pix qf-mm-item-mail'
          const icon = document.createElement('span')
          icon.className = 'qf-mm-item-mail-icon'
          icon.textContent = '✉'
          badge.appendChild(icon)
          badge.appendChild(document.createTextNode(' '))
          badge.appendChild(document.createTextNode(String(mailCount)))
          el.appendChild(badge)
        }
      } else if (mailEl) {
        mailEl.remove()
      }
      // Save-dependent state — CONTINUE flips enabled/disabled + subtitle when
      // the active player's save changes (a name switch swaps save slots).
      // Re-applied in place so we keep the no-full-rebuild guarantee above.
      const dimmed = m.enabled === false
      if (el.disabled !== dimmed) {
        el.disabled = dimmed
        el.dataset.dimmed = dimmed ? 'true' : 'false'
        el.style.opacity = dimmed ? '0.4' : '1'
      }
      const subEl = el.querySelector(':scope .qf-mm-item-sub')
      if (subEl && subEl.textContent !== (m.sub ?? '')) subEl.textContent = m.sub ?? ''
    }
  }

  // Re-apply the chrome that reads `this._save` outside the menu items — the
  // boss heading + sub and the SAVE OK / NO SAVE footer pill. (The CONTINUE
  // button's enabled-state + subtitle are synced inside _refreshMenuItems.)
  _refreshSaveDependentUI() {
    if (this._refs?.bossName) this._refs.bossName.textContent = this._currentBossName()
    if (this._refs?.bossSub)  this._refs.bossSub.textContent  = this._currentBossSub()
    if (this._refs?.savePill) {
      this._refs.savePill.textContent = this._save ? 'SAVE OK' : 'NO SAVE'
      this._refs.savePill.style.color = this._save ? 'var(--poison)' : 'var(--text-dim)'
    }
  }

  // Single entry point for "the active player name changed": re-resolve the
  // name's save slot (saves are name-scoped — see SaveSystem._saveKey) then
  // refresh every name-dependent surface. Called from the NAME_CHANGED event
  // and the inline NameEntryOverlay confirm paths.
  _syncNameDependentUI() {
    this._save = SaveSystem.hasSave() ? SaveSystem.load() : null
    this._refreshPlayerName()
    this._refreshTitlePill()
    this._refreshSaveDependentUI()
    this._refreshMenuItems()
  }

  // ─── Keybinds + actions ────────────────────────────────────────
  _onKey(e) {
    if (e.key === 'z' || e.key === 'Z') {
      // PRESS Z TO CONTINUE — load saved game if any, otherwise NEW EVIL.
      e.preventDefault()
      this._activate(this._save ? 'continue' : 'new')
    }
  }

  _activate(id) {
    const game = window.__game
    if (!game) return
    switch (id) {
      case 'continue': {
        // Re-load from disk at click time, NOT at overlay-open time.
        // `this._save` is captured in open() and would otherwise be
        // stale if the player resumed gameplay in this same tab after
        // the overlay opened and then returned to the menu — the
        // captured snapshot would replay them back to an earlier day.
        // Reading fresh here closes that window completely.
        const fresh = SaveSystem.hasSave() ? SaveSystem.load() : null
        if (!fresh) return
        this.close()
        // Stop any in-flight gameplay scenes BEFORE handing off so the
        // OLD Game / HudScene / NightPhase / DayPhase don't linger with
        // their EventBus subscriptions live. Without this, a player who
        // opens the main-menu overlay mid-run and clicks CONTINUE ends
        // up with stale DungeonRenderer / NpcDirector listeners from
        // the old run firing into the new one (observed as: ROOM_PLACED
        // crashes during createGameState, companions speaking each
        // other's lines). scene.start swaps the menu→Game in one
        // direction but does NOT cascade-stop scenes running in
        // parallel.
        _stopAllGameplayScenes(game.scene)
        game.scene.start('Game', { gameState: fresh })
        break
      }
      case 'new':
        // Gate on having a player name — drives per-name boss-level
        // progression in PlayerProfile and the leaderboard. The old Phaser
        // MainMenu's NameEntryPanel gate was lost in the DOM port; this
        // restores it. If unset, prompt; on confirm, proceed.
        if (!PlayerProfile.hasName()) {
          this._promptForName(() => {
            this.close()
            // Same cleanup as the continue path — see comment above.
            _stopAllGameplayScenes(game.scene)
            // CompanionSelect runs first (pick a companion), then hands off
            // to ArchetypeSelect (boss picker). Leaderboard cleanup of any
            // OLD live row happens automatically when the new run's
            // LiveRunPublisher boots — so backing out of CompanionSelect
            // here leaves the old row untouched.
            game.scene.start('CompanionSelect')
          })
          return
        }
        this.close()
        _stopAllGameplayScenes(game.scene)
        game.scene.start('CompanionSelect')
        break
      case 'leader':
        this._openLeaderboard()
        break
      case 'achievements':
        this._openAchievements()
        break
      case 'requests':
        this._openGameRequests()
        break
      case 'whatsnew':
        // Menu button shows the FULL changelog history, not just unseen.
        this._openWhatsNew(true)
        break
      case 'devtools':
        // Mango-only — opens the consolidated dev panel. Each tool in
        // the panel routes its id back through _activate (so the cases
        // below are still the single source of truth for what each
        // shortcut does).
        this._openDevTools()
        break
      case 'jump50':
        // Mango dev shortcut — stamps one-shot localStorage flags that
        // ArchetypeSelect._beginRun reads after createGameState to bump
        // meta.dayNumber + boss.level. Falls through to the normal new-evil
        // flow so the player still picks companion + archetype as usual.
        // Boss lv 12 ≈ the realistic level a committed player reaches by
        // day 50 (XP curve BASE 50, SCALE 1.4, ~700 kills @ 10 XP/kill).
        try {
          localStorage.setItem('qf.dev.startDayNumber', '50')
          localStorage.setItem('qf.dev.startBossLevel', '12')
        } catch {}
        this.close()
        _stopAllGameplayScenes(game.scene)
        game.scene.start('CompanionSelect')
        break
      case 'teststage':
        // Mango dev — a CLEAN VFX test stage. Lands on a mid-Act-I day (no drafted
        // kingdom-response intro, NOT an act-final day → no climax/duel), then the
        // dev sandbox (window.__qfDev) auto-builds an arena + starts a QUIET day
        // (no normal wave) so the only units on the field are your dev-spawns.
        // Use TEST EVENT → Populate / champion cards to test any VFX in isolation.
        try {
          // Boss L4 (under the forced multi-entry thresholds at L5/L10) so a single
          // auto-built entry hall is enough for the day to start. VFX read the same
          // at any level; use the day-50 jump if you want late-game numbers.
          localStorage.setItem('qf.dev.startDayNumber', '8')
          localStorage.setItem('qf.dev.startBossLevel', '4')
          localStorage.setItem('qf.dev.testStage', '1')
        } catch {}
        this.close()
        _stopAllGameplayScenes(game.scene)
        game.scene.start('CompanionSelect')
        break
      case 'rooms':
        this.close()
        // Stop MainMenu so its throne-room backdrop (boss sprite + torches)
        // doesn't keep rendering under the editor — `game.scene.start` only
        // starts the target, it doesn't stop the calling scene.
        _stopAllGameplayScenes(game.scene)
        game.scene.start('RoomTileEditor')
        break
      // 'tiles' (standalone Tileset Editor) retired — theme/tile authoring now
      // lives in the Room Editor's ⚙ Themes modal.
      case 'testunlock':
        // Dev-only entry (mango gate) — queues one of each unlock card
        // type + fires the UnlockNotificationOverlay right here so the
        // designer can sanity-check the four card layouts without
        // grinding an actual unlock. Uses real ids that exist in the
        // shipped data so the sprites/portraits resolve normally.
        this._testFireUnlocks()
        break
      case 'testtop1': this._testFireTop3(1); break
      case 'testtop2': this._testFireTop3(2); break
      case 'testtop3': this._testFireTop3(3); break
      // Demotion cards — dethroned off the podium vs slipped within it.
      case 'testdemoteoff':  this._testFireDemotion(1, 0); break
      case 'testdemoteslip': this._testFireDemotion(1, 2); break
      case 'options':
        this._openSettings()
        break
      case 'quit':
        // Browser context — window.close only works for windows the script
        // opened. Best-effort: try, then fall back to a no-op visual.
        try { window.close() } catch {}
        break
    }
  }

  _openSettings() {
    if (this._settings) return
    this._settings = new SettingsOverlay({
      onClose: () => { this._settings = null },
    })
    this._settings.open()
  }

  _openLeaderboard() {
    if (this._leaderboard) return
    // Lazy import so the leaderboard module doesn't load unless asked
    // (it pulls in network helpers).
    import('./LeaderboardOverlay.js').then(({ LeaderboardOverlay }) => {
      this._leaderboard = new LeaderboardOverlay({
        onClose: () => {
          this._leaderboard = null
          // Re-sync menu-item badges. The leaderboard session may have
          // populated the cached top-3 (if it was empty before) AND/OR
          // mutated the seen-set via hover-dismisses — both directions
          // need to land on the badge state. `_refreshMenuItems` walks
          // all items and adds/removes badges based on current truth.
          this._refreshMenuItems()
        },
      })
      this._leaderboard.open()
    })
  }

  _openAchievements() {
    if (this._achievements) return
    // Lazy import — AchievementsOverlay pulls in AchievementSystem
    // (which is already booted at this point but still nice to defer
    // the DOM module until needed).
    import('./AchievementsOverlay.js').then(({ AchievementsOverlay }) => {
      this._achievements = new AchievementsOverlay({
        onClose: () => {
          this._achievements = null
          // Re-sync every menu-item badge against the current seen-set
          // state. Handles both directions in one path: if the player
          // hovered every NEW chip the ACHIEVEMENTS badge disappears;
          // if the popup opened with a stale cache and fresh fetches
          // arrived during the session, badges can also reappear.
          // Simpler + more correct than the previous remove-only code.
          this._refreshMenuItems()
        },
      })
      this._achievements.open()
    })
  }

  _openGameRequests() {
    if (this._requests) return
    // Mark seen at open so the NEW badge clears immediately, even if the
    // player closes the overlay without submitting anything. Mirrors the
    // achievement intro-badge flow — seeing the page counts as engagement.
    PlayerProfile.markGameRequestsSeen?.()
    import('./GameRequestsOverlay.js').then(({ GameRequestsOverlay }) => {
      this._requests = new GameRequestsOverlay({
        onClose: () => {
          this._requests = null
          // Re-prefetch counts after close — any tab the player viewed
          // (MY MAIL / INBOX) called markSeen on its way through, so a
          // fresh fetch will return the updated counts. Then re-sync
          // menu items so the ✉ chip drops without re-running entrance
          // animations.
          GameRequests.prefetchUnreadCounts?.({
            playerName: PlayerProfile.getName?.(),
            isMango:    !!PlayerProfile.isCheatName?.(),
          }).then(() => {
            if (this._closed || !this._el) return
            this._refreshMenuItems()
          }).catch(() => {})
          // Sync immediately too so the ✉ chip clears from any view-
          // tab the player already touched (cached counts were zeroed
          // by markSeen synchronously).
          this._refreshMenuItems()
        },
      })
      this._requests.open()
    })
  }

  // Mango-only — opens the consolidated DevToolsOverlay. The overlay
  // routes each tool's id back through _activate(id), so this method
  // only handles construction / lifecycle. Lazy import keeps the dev
  // panel off the bundle for ordinary players (who never see the row).
  _openDevTools() {
    if (this._devTools) return
    import('./DevToolsOverlay.js').then(({ DevToolsOverlay }) => {
      if (this._closed || !this._el) return
      if (this._devTools) return
      this._devTools = new DevToolsOverlay({
        onAction: (id) => this._activate(id),
        onClose:  () => { this._devTools = null },
      })
      this._devTools.open()
    }).catch(() => {})
  }

  // Open the recent-updates panel. On close it marks everything seen, so
  // the NEW badge clears — re-sync the menu items so the badge disappears
  // without re-running the entrance animations. `full` (menu button) shows
  // the whole changelog; the auto-pop leaves it false to show only unseen.
  _openWhatsNew(full = false) {
    if (this._whatsNew) return
    this._whatsNew = new WhatsNewOverlay({
      full,
      onClose: () => {
        this._whatsNew = null
        if (!this._closed && this._el) this._refreshMenuItems()
      },
    })
    this._whatsNew.open()
  }

  // Auto-pop the WHAT'S NEW panel once per session when there's an update
  // the player hasn't seen — so a returning player catches up on first
  // launch. Skipped when an unlock / top-3 celebration is queued (that
  // takes the spotlight; the NEW badge still flags the update for manual
  // open) so two popups never stack. The 400ms delay lets the menu's
  // entrance animations settle first.
  _maybeAutoOpenWhatsNew() {
    if (MainMenuOverlay._whatsNewAutoShown) return
    if (!WhatsNewOverlay.hasUnseen()) return
    if ((PlayerProfile.getPendingUnlocks?.() || []).length > 0) return
    MainMenuOverlay._whatsNewAutoShown = true
    setTimeout(() => {
      if (this._closed || !this._el || this._whatsNew || this._unlockOverlay) return
      this._openWhatsNew()
      // Auto-pop chime — ONLY on this returning-player auto-open. The manual
      // menu-row open (case 'whatsnew' → _openWhatsNew(true)) stays silent.
      HudSfx.playUi('whats_new')
    }, 400)
  }

  // Dev-only helper — wired to the mango-gated TEST UNLOCKS menu item.
  // Pushes a sample entry of each card type to the pending-unlocks
  // queue (mirrors what `AchievementSystem._unlock` would do in real
  // play) and immediately opens the notification overlay. Reuses real
  // ids that ship in the data so sprites / portraits / names all
  // resolve as they would in a live unlock. On close the overlay
  // clears the queue normally — no special cleanup required.
  _testFireUnlocks() {
    if (this._unlockOverlay) return
    // 1 achievement (no reward) + 1 boss + 2 companions (rattle + spectra
    // — exercise the ghost-flicker variant rotation in the unlock card) +
    // 1 title. Order mirrors the live "you earned it → here's what it
    // gives you" sequence the real _unlock funnel produces.
    try {
      PlayerProfile.queueUnlock({ type: 'achievement', id: 'first_trap' })
      PlayerProfile.queueUnlock({ type: 'boss',        id: 'lich',        achId: 'hardened_throne' })
      PlayerProfile.queueUnlock({ type: 'companion',   id: 'rattlebones', achId: 'curtain_call' })
      PlayerProfile.queueUnlock({ type: 'companion',   id: 'spectra',     achId: 'flawless_reign' })
      PlayerProfile.queueUnlock({
        type: 'title',
        id:    'flawless_reign',
        title: 'The Flawless',
        achId: 'flawless_reign',
      })
    } catch {}
    import('./UnlockNotificationOverlay.js').then(({ UnlockNotificationOverlay }) => {
      if (this._closed || !this._el) return
      if (this._unlockOverlay) return
      this._unlockOverlay = new UnlockNotificationOverlay({
        onClose: () => {
          this._unlockOverlay = null
          if (!this._closed && this._el) this._refreshMenuItems()
        },
      })
      this._unlockOverlay.open()
    }).catch(() => {})
  }

  // Dev-only — fires the top-3 celebration overlay at the chosen rank
  // with sample run data. Does NOT touch PlayerProfile.setCelebratedTop3RunId
  // so the test path can be re-fired indefinitely. The boss id is one
  // that always ships (the_lich), so the portrait inset resolves. The
  // numeric stats are recognisable "designer test" values rather than
  // round numbers so a real-run card and a test-run card don't get
  // confused in screenshots.
  _testFireTop3(rank) {
    if (this._unlockOverlay) return
    try {
      PlayerProfile.queueUnlock({
        type:      'leaderboard',
        rank,
        runId:     `test-top${rank}-${Date.now()}`,
        bossId:    'the_lich',
        bossLevel: 12,
        days:      51,
        kills:     742,
      })
    } catch {}
    import('./UnlockNotificationOverlay.js').then(({ UnlockNotificationOverlay }) => {
      if (this._closed || !this._el) return
      if (this._unlockOverlay) return
      this._unlockOverlay = new UnlockNotificationOverlay({
        onClose: () => {
          this._unlockOverlay = null
          if (!this._closed && this._el) this._refreshMenuItems()
        },
      })
      this._unlockOverlay.open()
    }).catch(() => {})
  }

  // Dev-only — fires the leaderboard DEMOTION card without touching the
  // persisted standing (PlayerProfile.setLastPodiumRank), so it can be
  // re-fired indefinitely. `fromRank` = the podium spot they held;
  // `toRank` = where they fell (0 / falsy = off the podium entirely).
  _testFireDemotion(fromRank, toRank) {
    if (this._unlockOverlay) return
    try {
      PlayerProfile.queueUnlock({
        type:     'demotion',
        fromRank,
        toRank:   toRank || 0,
      })
    } catch {}
    import('./UnlockNotificationOverlay.js').then(({ UnlockNotificationOverlay }) => {
      if (this._closed || !this._el) return
      if (this._unlockOverlay) return
      this._unlockOverlay = new UnlockNotificationOverlay({
        onClose: () => {
          this._unlockOverlay = null
          if (!this._closed && this._el) this._refreshMenuItems()
        },
      })
      this._unlockOverlay.open()
    }).catch(() => {})
  }

  destroy() { this.close() }
}

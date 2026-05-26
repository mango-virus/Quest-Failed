// MainMenuOverlay — DOM port of the design's title screen
// (moments.jsx → MainMenuOverlay). Replaces the Phaser MainMenu scene
// when newhud is on. Mounts directly into #hud-root (independent of the
// in-game HudRoot, since the MainMenu shows BEFORE a run starts and
// after gameState is torn down).
//
// Layout: split 1fr | 520px.
//   * Left stage: dark backdrop with CRT scanlines + vignette + the
//     QUEST / FAILED logo (cream + blood-red, 120px each)
//   * Right panel: "YOUR REIGN, MY LORD" eyebrow + current saved boss
//     heading ("GNOLL ALPHA · Day 4 · 6 kills") + 7 menu buttons:
//       CONTINUE  (red primary, gated by hasSave)  → load saved gameState
//       NEW EVIL  (gold)                            → confirm overwrite + ArchetypeSelect
//       LEADERBOARD (cyan)                          → LeaderboardOverlay
//       ROOM EDITOR (poison)                        → start RoomTileEditor scene
//       TILESET EDITOR (info)                       → start TilesetEditor scene
//       OPTIONS (warn)                              → SettingsOverlay
//       QUIT (mute)                                 → tries window.close()
//     + "› PRESS Z TO CONTINUE" prompt + italic flavor + footer
//     (version / SAVE OK / © BONEMAKER · MMXXVI).

import { h, mount } from './dom.js'
import { ensureStageScaled } from './stageScale.js'
import { SaveSystem } from '../systems/SaveSystem.js'
import { SettingsOverlay } from './SettingsOverlay.js'
import { ConfirmPopup } from './ConfirmPopup.js'
import { EventBus } from '../systems/EventBus.js'
import { installHudSfxDelegates } from './HudSfx.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { AchievementSystem } from '../systems/AchievementSystem.js'
import { getUnlockedBossIds } from '../data/bossUnlocks.js'
import { Leaderboard } from '../systems/Leaderboard.js'
import { NameEntryOverlay } from './NameEntryOverlay.js'

// Title-screen boss video pool. File pattern is `assets/title-screen/
// videos/bgNN.mp4` where NN is the zero-padded number from the list
// below. Mirrors the TITLE_VIDEO_NUMBERS list the Phaser MainMenu used
// to register video keys at preload — keeps the two surfaces drawing
// from the same content set. Adding a clip is a number addition here +
// dropping the file into the assets folder.
const BOSS_VIDEO_NUMBERS = [2, 4, 5, 6, 9, 11, 12, 13, 14, 15, 16, 17]
// Clips where the boss faces "wrong" relative to the QUEST/FAILED title
// stack on the bottom-left. CSS flips them horizontally so the boss
// always reads as facing INTO the menu, never out of frame.
const BOSS_VIDEO_FLIP_NUMBERS = new Set([5, 11])
const BOSS_VIDEO_PATH = (n) => `assets/title-screen/videos/bg${String(n).padStart(2, '0')}.mp4`

// Mirrors PauseManager.GAMEPLAY_SCENES — the scene keys that hold all
// the systems / renderers / event subscriptions belonging to an
// in-flight run. We stop every one of them before booting CompanionSelect
// or re-entering Game so the previous run's listeners can't leak into
// the new one (e.g. an old DungeonRenderer responding to ROOM_PLACED
// emitted during createGameState, or an old NpcDirector emitting old-
// companion lines into the new bubble).
const GAMEPLAY_SCENES = [
  'Game', 'NightPhase', 'DayPhase', 'EndOfDay',
  'Graveyard', 'KnowledgeScreen', 'HudScene',
]

function _stopAllGameplayScenes(sm) {
  if (!sm) return
  for (const key of GAMEPLAY_SCENES) {
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
    // Set up the boss-video shuffle queue. Each play picks the next
    // clip from the queue; when the queue empties we reshuffle and
    // bias the head so the same clip doesn't repeat back-to-back.
    this._bossVidQueue = null
    this._bossVidLast  = null
    this._render()
    this._spawnNextBossVideo()
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
      .then(() => {
        if (this._closed || !this._el) return
        this._refreshMenuItems()
      })
      .catch(() => {})
    // Listen for player-name swaps from ANY source (NameEntryOverlay
    // confirm path is already wired locally, but a name swap could
    // also originate from the legacy Options scene or future surfaces).
    // Refresh per-name UI in-place: the player-name pill, then the
    // NEW badges (driven by the new name's seen-sets). No full
    // re-render — that would re-fire menu-item entrance animations
    // and recreate the boss-video element without a src.
    this._onNameChanged = () => {
      if (this._closed || !this._el) return
      this._refreshPlayerName()
      this._refreshMenuItems()
    }
    EventBus.on('NAME_CHANGED', this._onNameChanged)
    // First-main-menu-open-after-unlocks celebration. If the pending-
    // unlocks queue has entries (filled by AchievementSystem._unlock
    // during the last run), pop the UnlockNotificationOverlay 250ms
    // after the menu renders — gives the menu's per-item entrance
    // animations time to settle so the modal doesn't fight for
    // attention. Overlay drains + clears the queue itself; the menu
    // doesn't need to do anything else. Lazy import keeps the overlay
    // off the main bundle on sessions where nothing was unlocked.
    if ((PlayerProfile.getPendingUnlocks?.() || []).length > 0) {
      setTimeout(() => {
        if (this._closed || !this._el) return
        import('./UnlockNotificationOverlay.js').then(({ UnlockNotificationOverlay }) => {
          if (this._closed || !this._el) return
          if (this._unlockOverlay) return
          this._unlockOverlay = new UnlockNotificationOverlay({
            onClose: () => {
              this._unlockOverlay = null
              // Queue is already cleared by the overlay itself; just
              // re-sync badges in case any unlock affected them (e.g.
              // a new companion now counts as "unseen" on the recruit
              // screen). Cheap, no-op if nothing changed.
              if (!this._closed && this._el) this._refreshMenuItems()
            },
          })
          this._unlockOverlay.open()
        }).catch(() => {})
      }, 250)
    }
  }

  close() {
    this._closed = true
    // Stop the boss-video chain BEFORE detaching the DOM. In Chrome a
    // <video> removed from the document keeps PLAYING, and its `ended`
    // handler keeps re-spawning the next 1080p clip — so without this,
    // leaving the title screen leaves a detached video decoding MP4s
    // forever, which chokes the tab the instant the next screen opens.
    const vid = this._refs?.video
    if (vid) {
      try { vid.pause(); vid.removeAttribute('src'); vid.load() } catch {}
    }
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
      // LEFT STAGE — boss video (looping random clip) + logo + CRT effects
      h('div', { className: 'qf-mm-stage' }, [
        // Animated boss video. Cycles through the same MP4 pool the
        // Phaser MainMenu used (assets/title-screen/videos/bgNN.mp4).
        // Z-stack: video at bottom → scan/vignette overlays → logo on top.
        h('video', {
          className: 'qf-mm-video',
          ref: el => { this._refs = { ...(this._refs || {}), video: el } },
          muted: true,
          autoplay: true,
          playsInline: true,
          on: {
            ended:    () => this._spawnNextBossVideo(),
            loadeddata: () => { this._refs?.video?.play?.().catch(() => {}) },
          },
        }),
        h('div', { className: 'qf-mm-scan' }),
        h('div', { className: 'qf-mm-vignette' }),
        h('div', { className: 'qf-mm-logoblock' }, [
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
      ]),
      // RIGHT PANEL
      h('div', { className: 'qf-mm-panel' }, [
        h('div', { className: 'qf-mm-panelhead' }, [
          // Player-name row — clickable to open NameEntryOverlay. Persistent
          // identity above the boss heading so the player can see / change
          // their name from the title screen at any time (drives the
          // per-name boss-level unlock progression in PlayerProfile).
          this._renderPlayerName(),
          h('div', { className: 'pix qf-mm-eyebrow-sm mm-logo-eyebrow' },
            'YOUR REIGN, MY LORD'),
          h('div', {
            className: 'pix qf-mm-currentboss mm-current-boss',
          }, this._currentBossName()),
          h('div', { className: 'qf-mm-currentsub' }, this._currentBossSub()),
        ]),
        h('div', {
          className: 'qf-mm-items',
          // Keep a ref so the cheat-name flip (mango on/off) can surgically
          // swap the items without re-rendering the entire menu and
          // restarting the boss-video chain.
          ref: el => { this._refs = { ...(this._refs || {}), menuItems: el } },
        }, items.map((m, i) => this._renderItem(m, i))),
        h('div', { className: 'qf-mm-spacer' }),
        // Jam Portal — animated sprite link to the game-jam lobby.
        // Mirrors what the Phaser MainMenu drew via `_drawJamPortal()`.
        // Click route: window.Portal.sendPlayerThroughPortal(LOBBY_URL)
        // if the portal helper exists, else direct nav. Hidden when the
        // sprite asset failed to load (rare — Preload background-fetches).
        h('button', {
          className: 'qf-mm-jamportal',
          title: 'Jam Portal — enter the game-jam lobby',
          on: { click: () => this._openJamPortal() },
        }, [
          // "VENTURE" label above the spinning portal — re-added so
          // first-time players read the icon as a deliberate exit to
          // the jam hub rather than just decoration. (Previously
          // removed for visual quiet; the affordance cue is worth
          // the extra noise.)
          h('div', { className: 'pix qf-mm-jamportal-label' }, 'VENTURE'),
          h('div', { className: 'qf-mm-jamportal-sprite' }),
        ]),
        h('div', { className: 'qf-mm-bottom' }, [
          h('div', { className: 'pix mm-prompt qf-mm-prompt' },
            '› PRESS Z TO CONTINUE'),
          h('div', { className: 'mm-logo-tag qf-mm-quote' }, [
            '"The fools come bearing torches and prayers.',
            h('br'),
            'They will leave bearing nothing."',
          ]),
          h('div', { className: 'pix qf-mm-footer' }, [
            h('span', null, 'v 0.1.4'),
            h('span', {
              style: { color: this._save ? 'var(--poison)' : 'var(--text-dim)' },
            }, this._save ? 'SAVE OK' : 'NO SAVE'),
            h('span', null, '© BONEMAKER · MMXXVI'),
          ]),
        ]),
      ]),
    ]
  }

  _renderItem(m, i) {
    const dimmed = m.enabled === false
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
      on: { click: () => { if (!dimmed) this._activate(m.id) } },
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
    ]
    // ROOM EDITOR + TILESET EDITOR are dev surfaces — only shown when the
    // player's name is the cheat handle (PlayerProfile.isCheatName). Regular
    // players don't see them at all. The menu-items list is re-rendered
    // (surgically) on name change so flipping into / out of the cheat name
    // makes these entries appear / disappear without leaving the menu.
    if (PlayerProfile.isCheatName()) {
      items.push(
        { id: 'jump50', label: 'JUMP TO DAY 50', sub: 'Late-game wave test (day 50, boss L7)', icon: '▶', color: 'var(--blood)' },
        { id: 'rooms', label: 'ROOM EDITOR', sub: 'Edit room layouts', icon: '▤', color: 'var(--poison)' },
        { id: 'tiles', label: 'TILESET EDITOR', sub: 'Author tile themes', icon: '▦', color: 'var(--info)' },
      )
    }
    items.push(
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
        this._refreshPlayerName()
        this._refreshMenuItems()
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
        this._refreshPlayerName()
        this._refreshMenuItems()
        if (typeof after === 'function') after()
      },
      onCancel: () => { this._nameEntry = null },
    })
    this._nameEntry.open()
  }

  // Swap just the player-name button without re-rendering the whole menu.
  // A full _render() would recreate the boss-video <video> element with no
  // `src` (the video src is set imperatively in `_spawnNextBossVideo`, not
  // declaratively in the markup), which left the stage dark behind the
  // QUEST/FAILED title after every name change.
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
    }
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
      case 'jump50':
        // Mango dev shortcut — stamps one-shot localStorage flags that
        // ArchetypeSelect._beginRun reads after createGameState to bump
        // meta.dayNumber + boss.level. Falls through to the normal new-evil
        // flow so the player still picks companion + archetype as usual.
        try {
          localStorage.setItem('qf.dev.startDayNumber', '50')
          localStorage.setItem('qf.dev.startBossLevel', '7')
        } catch {}
        this.close()
        _stopAllGameplayScenes(game.scene)
        game.scene.start('CompanionSelect')
        break
      case 'rooms':
        this.close()
        game.scene.start('RoomTileEditor')
        break
      case 'tiles':
        this.close()
        game.scene.start('TilesetEditor')
        break
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

  // Game-jam lobby portal. Clicking it leaves the game, so confirm first
  // via the shared ConfirmPopup (SHOW_CONFIRM) — only navigate on confirm.
  _openJamPortal() {
    EventBus.emit('SHOW_CONFIRM', {
      title: 'LEAVE QUEST FAILED?',
      message: 'This takes you to the game-jam lobby and leaves Quest '
             + 'Failed. Are you sure you want to leave?',
      confirmLabel: 'LEAVE',
      cancelLabel:  'STAY',
      theme:        'shadow',
      onConfirm: () => this._goToJamLobby(),
    })
  }

  // Uses the shared `window.Portal` helper when available so the lobby
  // gets the caller's referrer; falls back to a direct navigate if the
  // helper isn't loaded.
  _goToJamLobby() {
    const LOBBY_URL = 'https://callumhyoung.github.io/gamejam1-lobby/'
    try {
      if (window.Portal?.sendPlayerThroughPortal) {
        window.Portal.sendPlayerThroughPortal(LOBBY_URL)
        return
      }
    } catch {}
    window.location.href = LOBBY_URL
  }

  // ─── Boss video chain ─────────────────────────────────────────
  // Pick the next clip from a shuffled queue and assign its src to
  // the <video> element. When the queue empties, reshuffle the full
  // pool and bias so the first pick isn't the clip that just ended.
  // Bound to the <video> tag's `ended` event so playback chains
  // continuously through every clip before repeating.
  _spawnNextBossVideo() {
    // Belt-and-suspenders: if the overlay was closed, never re-arm the
    // chain (the `ended` event can still fire once on a detached video).
    if (this._closed) return
    const vid = this._refs?.video
    if (!vid) return
    if (!this._bossVidQueue?.length) {
      const q = BOSS_VIDEO_NUMBERS.slice()
      // Fisher-Yates shuffle.
      for (let i = q.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[q[i], q[j]] = [q[j], q[i]]
      }
      // Bias the head away from a repeat across the queue boundary.
      if (q.length > 1 && q[0] === this._bossVidLast) {
        const swap = 1 + Math.floor(Math.random() * (q.length - 1))
        ;[q[0], q[swap]] = [q[swap], q[0]]
      }
      this._bossVidQueue = q
    }
    const n = this._bossVidQueue.shift()
    this._bossVidLast = n
    vid.classList.toggle('qf-mm-video-flip', BOSS_VIDEO_FLIP_NUMBERS.has(n))
    // Belt-and-suspenders mute: the `muted` attribute is set declaratively
    // in the JSX but some browsers (and DevTools "unmute" actions) strip
    // it on src change. Set both the property AND volume = 0 every spawn
    // so no clip ever plays sound regardless of what the previous one
    // did or how the user fiddled with the element.
    vid.muted = true
    vid.volume = 0
    vid.src = BOSS_VIDEO_PATH(n)
    // load() pumps the new src; autoplay + muted + playsinline lets
    // browsers start playback without a user gesture on most engines.
    // play() returns a promise that may reject if the browser blocks
    // autoplay — swallow so the chain keeps trying on subsequent clips.
    try { vid.load(); vid.play()?.catch?.(() => {}) } catch {}
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

  destroy() { this.close() }
}

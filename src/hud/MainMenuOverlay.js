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
// scanline + vignette filters, and the right-side panel + split-grid layout.

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
import { WhatsNewOverlay } from './WhatsNewOverlay.js'

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

// Menu index → _activate id. The new "Crypt Tablet" layout is a 3-row grid:
//   row 0: [CONTINUE(0), NEW EVIL(1)]   row 1: [LEADERBOARD(2), ACHIEVEMENTS(3)]
//   row 2: [OPTIONS(4), QUIT(5)]
// Arrow keys move within/between rows; Z/Enter activates; hover selects.
const MENU_IDS = ['continue', 'new', 'leader', 'achievements', 'options', 'quit']
const MENU_ROWS = [[0, 1], [2, 3], [4, 5]]

export class MainMenuOverlay {
  constructor() {
    this._el = null
    this._settings = null
    this._leaderboard = null
    this._confirm = null
    this._nameEntry = null
    this._devTools = null
    this._whatsNew = null
    this._sel = 0          // selected menu index (see MENU_IDS / MENU_ROWS)
    this._btns = []        // menu button els by index — keyboard nav + press fx
    this._walkers = null   // MenuWalkers atmosphere instance (lazy)
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
    this._sel = this._save ? 0 : 1   // no save → CONTINUE disabled, focus NEW EVIL
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
    this._walkers?.destroy?.()
    this._walkers = null
    this._el?.remove()
    this._el = null
    this._refs = null
    this._btns = []
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
      this._el = h('div', { className: 'qf-cm qcm-pixelbtn' })
      // Mount into the 1920×1080 #hud-stage so MainMenu letterboxes on
      // non-16:9 viewports the same way the in-game HUD does. Ensure the
      // stage is scaled even if HudRoot hasn't mounted yet (which it
      // hasn't, at the title screen). The .qf-cm root is OPAQUE — it owns
      // the whole backdrop (brick wall + torches + walkers), so the Phaser
      // MainMenu scene behind it is no longer the visible title backdrop.
      ensureStageScaled()
      const stage = document.getElementById('hud-stage') || document.body
      stage.appendChild(this._el)
    }
    this._btns = []
    mount(this._el, this._renderInner())
    this._applySelection()
    this._mountAtmosphere()
    this._applyReignTint()
  }

  // Re-tint the whole title screen to the colour of the boss you currently
  // reign as (design: the crypt palette keys off your archetype). Empty throne
  // (no save) → leave the CSS default crypt-red. Only --acc/--accDk/--bgTint
  // shift; --emb stays the gold treasure accent.
  _applyReignTint() {
    if (!this._el) return
    const raw = this._currentArch()?.color
    const st = this._el.style
    if (raw == null) {
      st.removeProperty('--acc'); st.removeProperty('--accDk'); st.removeProperty('--bgTint')
      return
    }
    const c = MainMenuOverlay._hexToCss(raw)
    st.setProperty('--acc', c)
    st.setProperty('--accDk', `color-mix(in srgb, ${c} 50%, #050208)`)
    st.setProperty('--bgTint', `color-mix(in srgb, ${c} 26%, #100a12)`)
  }

  static _hexToCss(c) {
    if (typeof c === 'number') return '#' + c.toString(16).padStart(6, '0')
    const s = String(c || '').replace(/^0x/, '')
    return /^[0-9a-fA-F]{6}$/.test(s) ? '#' + s : '#c8334a'
  }

  _renderInner() {
    this._refs ||= {}
    return [
      // ── Backdrop layers (z0, pointer-events:none) ───────────────────────
      h('div', { className: 'qcm-bricks' }),
      h('div', { className: 'qcm-torchglow l' }),
      h('div', { className: 'qcm-torchglow r' }),
      this._buildEmbers(),
      h('div', { className: 'qcm-fog' }),
      // Walkers mount here (MenuWalkers, lazy in _mountAtmosphere).
      h('div', { className: 'qcm-walkers', ref: el => { this._refs.walkers = el } }),
      // Real torch.png (43×288, 6-frame vertical strip) flanking the logo.
      h('div', { className: 'qcm-torch l' }, [h('div', { className: 'qcm-torchsprite' })]),
      h('div', { className: 'qcm-torch r' }, [h('div', { className: 'qcm-torchsprite' })]),

      // ── Title ───────────────────────────────────────────────────────────
      h('div', { className: 'qcm-title' }, [
        h('span', { className: 'pix qcm-t1' }, 'QUEST'),
        h('span', { className: 'pix qcm-t2' }, 'FAILED'),
      ]),
      h('div', { className: 'sil qcm-tag' }, '◦  A Dungeon‑Builder Roguelike  ◦'),

      // ── Tablet (foreground) ─────────────────────────────────────────────
      h('div', { className: 'qcm-tablet' }, [
        h('div', { className: 'qcm-crest', ref: el => { this._refs.crest = el } },
          this._buildCrestInner()),
        h('div', { className: 'qcm-prim', ref: el => { this._refs.prim = el } },
          this._buildPrimInner()),
        h('div', { className: 'qcm-grid', ref: el => { this._refs.grid = el } },
          this._buildGridInner()),
        h('div', { className: 'qcm-hints' }, this._buildHints()),
      ]),

      // ── Footer chips: WHAT'S NEW (version, right) + DEV TOOLS (mango, left)
      h('div', { className: 'qcm-foot' }, [this._buildVersionChip()]),
      PlayerProfile.isCheatName() && this._buildDevChip(),
    ]
  }

  // ─── Atmosphere builders ───────────────────────────────────────────────
  _buildEmbers() {
    const n = 34
    const spans = []
    for (let i = 0; i < n; i++) {
      const left = Math.random() * 100
      const bottom = Math.random() * 40
      const delay = -(Math.random() * 9)
      const dur = 6 + Math.random() * 7
      const drift = (Math.random() * 2 - 1) * 40
      const sz = 3 * (0.6 + Math.random() * 1.1)
      const op = 0.85 * (0.5 + Math.random() * 0.5)
      spans.push(h('span', {
        className: 'qcm-ember',
        style: {
          left: left + '%', bottom: bottom + '%', width: sz + 'px', height: sz + 'px',
          '--qf-drift': drift + 'px', '--qf-ember-op': op,
          animationDuration: dur + 's', animationDelay: delay + 's',
        },
      }))
    }
    return h('div', { className: 'qcm-embers' }, spans)
  }

  // Lazily spin up the walkers (real adventurer + boss sprite-sheets pacing /
  // fleeing along the base of the wall). Only one instance; bound to the boss
  // the player currently reigns as (or their last archetype / orc fallback).
  _mountAtmosphere() {
    const host = this._refs?.walkers
    if (!host || this._walkers) return
    const bossId = String(
      this._save?.player?.bossArchetypeId
      ?? PlayerProfile.getLastArchetypeId?.()
      ?? 'orc'
    ).replace(/^the_/, '')
    import('./menuWalkers.js').then(({ MenuWalkers }) => {
      if (this._closed || !this._refs?.walkers) return
      this._walkers = new MenuWalkers(this._refs.walkers, { bossId, stageW: 1920 })
      this._walkers.start()
      this._walkers.fire()   // a little life on first paint
    }).catch(() => {})
  }

  // ─── Reign crest (boss portrait + name + quote, or empty-throne state) ──
  _buildCrestInner() {
    const arch = this._currentArch()
    if (this._save && arch) {
      return [
        h('div', { className: 'qcm-namerow' }, [
          h('div', { className: 'qcm-avatar' }, [this._bossPortraitImg(arch.id)]),
          h('div', { className: 'qcm-rname' }, (arch.name || arch.id).toUpperCase()),
        ]),
        h('div', { className: 'qcm-quote' }, [
          h('span', { className: 'qcm-qline' },
            arch.flavorText ? `“${arch.flavorText}”` : ''),
        ]),
      ]
    }
    return [
      h('div', { className: 'qcm-namerow' }, [
        h('div', { className: 'qcm-avatar qcm-avatar-empty' },
          [h('span', { className: 'qcm-emptglyph' }, '♛')]),
        h('div', { className: 'qcm-rname qcm-rname-empty' }, 'THE THRONE AWAITS'),
      ]),
      h('div', { className: 'qcm-quote' }, [
        h('span', { className: 'qcm-qline qcm-tip' },
          'The crown sits unclaimed — begin a New Evil to take your first throne.'),
      ]),
    ]
  }

  _bossPortraitImg(id) {
    const clean = String(id || '').replace(/^the_/, '')
    return h('img', {
      className: 'qcm-portrait',
      src: `assets/ui/bestiary/portraits/${clean}_p.png`,
      alt: '',
      // Hide the <img> (keeping the framed avatar box) if the portrait 404s.
      on: { error: (e) => { e.currentTarget.style.visibility = 'hidden' } },
    })
  }

  // Resolve the saved run's boss archetype object from the JSON cache. Returns
  // null when there's no save. Falls back to a minimal {id,name} if the cache
  // isn't reachable yet.
  _currentArch() {
    if (!this._save) return null
    const archId = String(this._save.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (!archId) return null
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const archs = s.cache?.json?.get?.('bossArchetypes')
      if (Array.isArray(archs)) {
        const a = archs.find(x => x.id === archId)
        if (a) return a
      }
    }
    return { id: archId, name: archId.replace(/_/g, ' '), flavorText: '' }
  }

  // ─── Primary cards: CONTINUE run-card + NEW EVIL ───────────────────────
  _buildPrimInner() {
    return [this._buildContinueCard(), this._buildNewEvilCard()]
  }

  _buildContinueCard() {
    const hasSave = !!this._save
    const day = this._save?.meta?.dayNumber ?? 1
    const cls = 'qcm-item qcm-cont'
      + (hasSave ? ' qcm-primary' : ' qcm-disabled')
      + (this._sel === 0 ? ' on' : '')
    return h('button', {
      className: cls,
      disabled: !hasSave,
      ref: el => { this._btns[0] = el },
      on: {
        mouseenter: () => { if (hasSave) this._select(0) },
        // Gamepad nav focuses native buttons — mirror hover so the menu's
        // own `.on` highlight tracks the controller focus ring.
        focus: () => { if (hasSave) this._select(0) },
        click: () => { if (hasSave) this._press(0) },
      },
    }, [
      h('div', { className: 'qcm-cont-top' }, [
        h('span', { className: 'qcm-glyph' }, '▶'),
        h('span', { className: 'pix qcm-cont-label' }, 'CONTINUE'),
        h('span', { className: 'qcm-cont-resume' }, [
          hasSave ? this._buildMiniMap() : null,
          hasSave ? `Resume · Day ${day}` : 'Nothing to resume yet',
          hasSave ? h('span', { className: 'pix qcm-cont-go' }, '›') : null,
        ]),
      ]),
      hasSave ? h('div', { className: 'qcm-cont-stats' }, this._buildContStats()) : null,
    ])
  }

  // Decorative dungeon-map glyph beside the resume line (static — evokes the
  // minimap without wiring live room data into the title screen).
  _buildMiniMap() {
    const dot = (left, top, kind) => h('i', {
      className: kind || '', style: { left: left + 'px', top: top + 'px' },
    })
    return h('span', { className: 'qcm-cont-map', 'aria-hidden': 'true' }, [
      dot(3, 3, 'dim'), dot(14, 3), dot(25, 3), dot(47, 4),
      dot(14, 13), dot(36, 13, 'boss'), dot(58, 13),
      dot(3, 23), dot(25, 23), dot(58, 23, 'dim'),
    ])
  }

  _buildContStats() {
    const s = this._save
    const kills = s.player?.totalKills ?? s.run?.totals?.advsKilled ?? 0
    const pacts = s.activeMechanics?.length ?? s.history?.pacts?.length ?? 0
    const bossLv = s.boss?.level ?? 1
    const act = s.meta?.act?.current
    const day = s.meta?.dayNumber ?? 1
    const stat = (label, val) => h('span', { className: 'st' }, [
      h('span', { className: 'k' }, label),
      h('span', { className: 'v' }, String(val)),
    ])
    // Campaign ("acts") mode shows ACT pips; default survival mode has no act,
    // so the 4th stat falls back to the current DAY.
    const lastCol = act
      ? h('span', { className: 'st' }, [
          h('span', { className: 'k' }, 'Act'),
          h('span', { className: 'pips' },
            [0, 1, 2, 3].map(i => h('i', { className: i < act ? 'on' : '' }))),
        ])
      : stat('Day', day)
    return [stat('Kills', kills), stat('Pacts', pacts), stat('Boss Lv', bossLv), lastCol]
  }

  _buildNewEvilCard() {
    const hasSave = !!this._save
    const cls = 'qcm-item qcm-newevil'
      + (!hasSave ? ' qcm-primary' : '')
      + (this._sel === 1 ? ' on' : '')
    return h('button', {
      className: cls,
      ref: el => { this._btns[1] = el },
      on: { mouseenter: () => this._select(1), focus: () => this._select(1), click: () => this._press(1) },
    }, [
      h('span', { className: 'qcm-glyph', style: { color: 'var(--blood-glow)' } }, '✦'),
      h('span', { className: 'qcm-itxt' }, [
        h('span', { className: 'pix qcm-il' }, 'NEW EVIL'),
        h('span', { className: 'qcm-is' }, 'Begin a new run'),
      ]),
    ])
  }

  // ─── Grid: LEADERBOARD / ACHIEVEMENTS / OPTIONS / QUIT ─────────────────
  _buildGridInner() {
    const items = [
      { idx: 2, l: 'LEADERBOARD', g: '◆', c: 'var(--rumor)', nu: this._leaderboardNewBadge() },
      { idx: 3, l: 'ACHIEVEMENTS', g: '♛', c: 'var(--gold-bright, #ffd964)', nu: this._achievementsNewBadge() },
      { idx: 4, l: 'OPTIONS', g: '◇', c: '#ff5fb0' },
      { idx: 5, l: 'QUIT', g: '✕', c: 'var(--warn)' },
    ]
    return items.map(it => this._buildGridItem(it))
  }

  _buildGridItem(it) {
    const on = this._sel === it.idx
    return h('button', {
      className: 'qcm-item' + (on ? ' on' : ''),
      ref: el => { this._btns[it.idx] = el },
      on: { mouseenter: () => this._select(it.idx), focus: () => this._select(it.idx), click: () => this._press(it.idx) },
    }, [
      h('span', { className: 'qcm-glyph', style: on ? undefined : { color: it.c } }, it.g),
      h('span', { className: 'qcm-itxt' }, [h('span', { className: 'pix qcm-il' }, it.l)]),
      it.nu && h('span', { className: 'sil qcm-new' }, 'NEW'),
    ])
  }

  _buildHints() {
    const hint = (caps, label) => h('span', { className: 'h' },
      [...caps.map(c => h('kbd', null, c)), ' ' + label])
    return [
      hint(['↑', '↓'], 'Navigate'),
      hint(['Z'], 'Select'),
      hint(['Esc'], 'Quit'),
    ]
  }

  _buildVersionChip() {
    const nu = WhatsNewOverlay.hasUnseen()
    return h('button', {
      className: 'qcm-ver',
      title: "What's new in this version",
      // Peripheral footer chip — kept out of gamepad spatial nav so it can't
      // hijack a cardinal move from the primary menu items (it's a tiny
      // bottom-right corner button). Still mouse-clickable. See GamepadNav.
      dataset: { navSkip: '1' },
      ref: el => { (this._refs ||= {}).version = el },
      on: { click: () => this._activate('whatsnew') },
    }, ['v ', h('b', null, '0.1.4'), nu && h('span', { className: 'sil qcm-ver-nu' }, 'NEW')])
  }

  _buildDevChip() {
    return h('button', {
      className: 'qcm-dev',
      title: 'Mango dev tools',
      dataset: { navSkip: '1' },   // peripheral footer chip — out of gamepad nav
      on: { click: () => this._activate('devtools') },
    }, [h('span', { className: 'qcm-dev-gear' }, '⚙'), 'DEV TOOLS'])
  }

  // ─── NEW-badge helpers (ported from the prior _menuItems) ──────────────
  _achievementsNewBadge() {
    return PlayerProfile.hasUnseenNewAchievements(
      (AchievementSystem.getDefinitions?.() || []).map(d => d.id)
    )
  }

  _leaderboardNewBadge() {
    const myCanon = PlayerProfile.getName().trim().toLowerCase()
    const cached = Leaderboard.getCachedTop3?.() || []
    // Optimistic-on when nothing is cached yet (fresh session) — the open()
    // prefetch resolves shortly and re-syncs to the accurate state.
    if (cached.length === 0) return true
    const ids = cached
      .filter(e => e && typeof e.id === 'string' && e.id &&
        (!myCanon || typeof e.name !== 'string' ||
          e.name.trim().toLowerCase() !== myCanon))
      .map(e => e.id)
    if (ids.length === 0) return false
    return PlayerProfile.hasUnseenNewLeaderboardIds(ids)
  }

  // ─── Selection + activation ────────────────────────────────────────────
  _select(i) {
    if (this._sel === i) return
    this._sel = i
    this._applySelection()
  }

  _applySelection() {
    for (let i = 0; i < this._btns.length; i++) {
      const el = this._btns[i]
      if (!el) continue
      el.classList.toggle('on', i === this._sel && !el.disabled)
    }
  }

  // Press: tactile fire flash + walker burst, then route to the action.
  _press(i) {
    const el = this._btns[i]
    if (el && !el.disabled) {
      el.classList.add('fire')
      setTimeout(() => el?.classList.remove('fire'), 300)
      this._walkers?.fire?.()
    }
    this._activate(MENU_IDS[i])
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
      validate:     (raw) => PlayerProfile.validateName(raw),
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

  // Destructive-action gate for NEW EVIL while a reign is in progress —
  // starting a new run overwrites the current save. Mirrors the design's
  // "ABANDON YOUR REIGN?" grave decision (the red `danger` ConfirmPopup, which
  // MainMenuOverlay already owns + listens for SHOW_CONFIRM). On confirm it
  // runs the new-run flow; cancel / Esc / backdrop just dismisses.
  _confirmAbandonReign(onConfirm) {
    const arch = this._currentArch()
    // Same reign label the menu crest shows, so the two never disagree.
    const bossName = String(arch?.name || arch?.id || 'your boss').toUpperCase()
    const day = this._save?.meta?.dayNumber ?? 1
    EventBus.emit('SHOW_CONFIRM', {
      danger:       true,
      title:        'ABANDON YOUR REIGN?',
      messageNode: [
        'Beginning a ', h('b', null, 'NEW EVIL'),
        ` ends your Day ${day} reign as the `, h('b', null, bossName),
        '. This cannot be undone.',
      ],
      confirmLabel: 'NEW EVIL',
      cancelLabel:  'KEEP REIGN',
      onConfirm,
    })
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

  // Rebuild the badge-bearing surfaces in place (grid items + version chip).
  // Called after the leaderboard / achievements / what's-new / requests
  // overlays close, and after the background prefetches land — so NEW badges
  // appear/clear without a full menu re-render (the entrance animation is on
  // the whole tablet, not per-item, so rebuilding these regions is flicker-
  // free). Re-binds this._btns for the grid and re-applies selection.
  _refreshMenuItems() {
    if (this._refs?.grid) mount(this._refs.grid, this._buildGridInner())
    if (this._refs?.version?.parentNode) {
      const fresh = this._buildVersionChip()
      this._refs.version.parentNode.replaceChild(fresh, this._refs.version)
    }
    this._applySelection()
  }

  // Re-apply the save-dependent surfaces — the reign crest (boss portrait +
  // name + quote) and the primary cards (CONTINUE enabled/stats vs. NEW EVIL
  // primary). Rebuilt in place; re-binds CONTINUE/NEW EVIL in this._btns.
  _refreshSaveDependentUI() {
    if (this._refs?.crest) mount(this._refs.crest, this._buildCrestInner())
    if (this._refs?.prim)  mount(this._refs.prim, this._buildPrimInner())
    this._applySelection()
    this._applyReignTint()
  }

  // Single entry point for "the active player name changed": re-resolve the
  // name's save slot (saves are name-scoped — see SaveSystem._saveKey) then
  // refresh every name-dependent surface. Called from the NAME_CHANGED event
  // and the inline NameEntryOverlay confirm path (the new-run name prompt).
  _syncNameDependentUI() {
    this._save = SaveSystem.hasSave() ? SaveSystem.load() : null
    this._refreshSaveDependentUI()
    this._refreshMenuItems()
    this._refreshDevChip()
  }

  // The DEV TOOLS chip is mango-only. It's rendered once in _renderInner and
  // lives at the menu root (NOT inside the grid that _refreshMenuItems rebuilds),
  // so a name change away from 'mango' would otherwise leave it stranded. Add or
  // remove it to match the live cheat-name state on every name change.
  _refreshDevChip() {
    if (!this._el) return
    const existing = this._el.querySelector('.qcm-dev')
    const should = PlayerProfile.isCheatName()
    if (should && !existing) this._el.appendChild(this._buildDevChip())
    else if (!should && existing) existing.remove()
  }

  // ─── Keybinds: grid navigation + select + quit ─────────────────────────
  _onKey(e) {
    // A child overlay (What's New / Options / Leaderboard / name-entry /
    // confirm …) owns input while it's open — don't let the menu's arrow
    // nav move the selection behind it, and (critically) don't let Esc fall
    // through to QUIT when the player only meant to close the overlay. The
    // overlay's own Esc handler closes it; this menu must stay inert. Mirrors
    // the modal-open guard in HudKeybinds / GamepadNav.
    if (document.querySelector('.overlay, .qf-cf-layer, .qf-nameentry')) return
    const find = (i) => {
      for (let r = 0; r < MENU_ROWS.length; r++) {
        const c = MENU_ROWS[r].indexOf(i)
        if (c >= 0) return [r, c]
      }
      return [0, 0]
    }
    const [r, c] = find(this._sel)
    switch (e.key) {
      case 'ArrowRight':
        this._select(MENU_ROWS[r][(c + 1) % MENU_ROWS[r].length]); e.preventDefault(); break
      case 'ArrowLeft':
        this._select(MENU_ROWS[r][(c - 1 + MENU_ROWS[r].length) % MENU_ROWS[r].length]); e.preventDefault(); break
      case 'ArrowDown': {
        const nr = (r + 1) % MENU_ROWS.length
        this._select(MENU_ROWS[nr][Math.min(c, MENU_ROWS[nr].length - 1)]); e.preventDefault(); break
      }
      case 'ArrowUp': {
        const nr = (r - 1 + MENU_ROWS.length) % MENU_ROWS.length
        this._select(MENU_ROWS[nr][Math.min(c, MENU_ROWS[nr].length - 1)]); e.preventDefault(); break
      }
      case 'z': case 'Z': case 'Enter': {
        e.preventDefault()
        // CONTINUE selected but no save → fall through to NEW EVIL.
        let i = this._sel
        if (i === 0 && !this._save) i = 1
        this._press(i)
        break
      }
      case 'Escape':
        e.preventDefault(); this._press(5); break
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
      case 'new': {
        // The new-run flow: name-gate, then CompanionSelect → ArchetypeSelect.
        // Gating on a player name drives per-name boss-level progression +
        // the leaderboard. The old Phaser MainMenu's NameEntryPanel gate was
        // lost in the DOM port; this restores it. Leaderboard cleanup of any
        // OLD live row happens automatically when the new run's LiveRunPublisher
        // boots — so backing out of CompanionSelect leaves the old row untouched.
        const begin = () => {
          if (!PlayerProfile.hasName()) {
            this._promptForName(() => {
              this.close()
              _stopAllGameplayScenes(game.scene)
              game.scene.start('ModeSelect')
            })
            return
          }
          this.close()
          _stopAllGameplayScenes(game.scene)
          game.scene.start('ModeSelect')
        }
        // Beginning a NEW EVIL wipes the current reign's save. When a reign is
        // in progress, confirm first (design: the "ABANDON YOUR REIGN?" grave
        // decision). No save → nothing to abandon, so start straight in.
        if (this._save) this._confirmAbandonReign(begin)
        else begin()
        break
      }
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
          localStorage.setItem('qf.runMode', 'campaign')   // dev shortcut skips Mode Select
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
          localStorage.setItem('qf.runMode', 'campaign')   // dev shortcut skips Mode Select
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

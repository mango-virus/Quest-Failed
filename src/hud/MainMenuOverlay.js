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
    this._settings?.close()
    this._settings = null
    this._confirm?.destroy()
    this._confirm = null
    this._nameEntry?.close()
    this._nameEntry = null
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
          h('div', { className: 'qf-mm-jamportal-sprite' }),
          // Label removed at user request — the spinning portal sprite
          // is recognisable on its own and the bare label was reading
          // as noise next to the menu's terser button copy.
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
    ])
  }

  _menuItems() {
    const items = [
      { id: 'continue', label: 'CONTINUE', sub: this._continueSub(), icon: '▶',
        primary: true, enabled: !!this._save, color: 'var(--blood)' },
      { id: 'new', label: 'NEW EVIL', sub: 'Begin a new run', icon: '+', color: 'var(--gold)' },
      { id: 'leader', label: 'LEADERBOARD', sub: 'Global hall of evil', icon: '◆', color: 'var(--rumor)' },
    ]
    // ROOM EDITOR + TILESET EDITOR are dev surfaces — only shown when the
    // player's name is the cheat handle (PlayerProfile.isCheatName). Regular
    // players don't see them at all. The menu-items list is re-rendered
    // (surgically) on name change so flipping into / out of the cheat name
    // makes these entries appear / disappear without leaving the menu.
    if (PlayerProfile.isCheatName()) {
      items.push(
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
  _refreshMenuItems() {
    const host = this._refs?.menuItems
    if (!host) return
    const items = this._menuItems()
    if (items.length === host.children.length) return    // no add/remove
    host.replaceChildren()
    items.forEach((m, i) => host.appendChild(this._renderItem(m, i)))
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
      case 'continue':
        if (!this._save) return
        this.close()
        // Hand off to the Game scene with the saved state.
        game.scene.start('Game', { gameState: this._save })
        break
      case 'new':
        // Gate on having a player name — drives per-name boss-level
        // progression in PlayerProfile and the leaderboard. The old Phaser
        // MainMenu's NameEntryPanel gate was lost in the DOM port; this
        // restores it. If unset, prompt; on confirm, proceed.
        if (!PlayerProfile.hasName()) {
          this._promptForName(() => {
            this.close()
            // CompanionSelect runs first (pick a companion), then hands off
            // to ArchetypeSelect (boss picker).
            game.scene.start('CompanionSelect')
          })
          return
        }
        this.close()
        game.scene.start('CompanionSelect')
        break
      case 'leader':
        this._openLeaderboard()
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
        onClose: () => { this._leaderboard = null },
      })
      this._leaderboard.open()
    })
  }

  destroy() { this.close() }
}

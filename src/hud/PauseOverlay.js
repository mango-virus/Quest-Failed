// PauseOverlay — DOM port of the design's pause menu (overlays.jsx ~1878).
//
// Surface: pulsing skull glyph + run-snapshot strip (DAY / GOLD / KILLS)
// + 7 menu items as a 2-column grid (RESUME / BOSS STATS / MINION ROSTER /
// KNOWLEDGE MAP / DUNGEON LOG / OPTIONS / ABANDON RUN), styled as
// pixel-bevel buttons with per-item accent colors. Footer reminds the
// player of the ESC shortcut and shows a "PROGRESS SAVED" tag.
//
// Wired to the same EventBus channels the existing chrome uses so the
// game's pause / scene-pausing pipeline doesn't change:
//
//   * Subscribes to OPEN_PAUSE_MENU — opens itself (BottomBar's MENU
//     button emits this, plus PauseManager triggers it elsewhere).
//   * Calls PauseManager.open()/close() to freeze/unfreeze gameplay
//     scenes (which now skip booting the Phaser PauseMenu scene when the
//     new HUD is on; the DOM overlay is the only pause surface).
//   * Menu actions:
//       RESUME           → close()
//       BOSS STATS       → emit OPEN_BOSS_OVERVIEW   (handled by Phaser popup until 34C.2)
//       MINION ROSTER    → emit OPEN_MINION_ROSTER   (ditto)
//       KNOWLEDGE MAP    → emit OPEN_KNOWLEDGE_MAP   (ditto)
//       DUNGEON LOG      → close (right-column DungeonLog is always visible already)
//       OPTIONS          → mount the SettingsOverlay
//       ABANDON RUN      → PauseManager.saveAndExitToMenu(gameState)

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'
import { PauseManager } from '../systems/PauseManager.js'
import { SettingsOverlay } from './SettingsOverlay.js'
import { FullLogOverlay } from './FullLogOverlay.js'
import { userSettings } from './userSettings.js'

const MENU_ITEMS = [
  { id: 'resume',    label: 'RESUME',        sub: 'return to the bone-halls',     icon: '▶', color: 'var(--blood)',  primary: true },
  { id: 'boss',      label: 'BOSS STATS',    sub: 'inspect your champion',        icon: '★', color: 'var(--gold)' },
  { id: 'roster',    label: 'MINION ROSTER', sub: 'review your hunters',          icon: '✦', color: 'var(--poison)' },
  { id: 'knowledge', label: 'KNOWLEDGE MAP', sub: 'what the world has learned',   icon: '◇', color: 'var(--rumor)' },
  { id: 'log',       label: 'DUNGEON LOG',   sub: 'replay the night',             icon: '▤', color: 'var(--info)' },
  { id: 'options',   label: 'OPTIONS',       sub: 'audio · controls',             icon: '◈', color: 'var(--warn)' },
  { id: 'quit',      label: 'QUIT TO MENU',  sub: 'save and step away',           icon: '⏏', color: 'var(--text-dim)' },
  { id: 'abandon',   label: 'ABANDON RUN',   sub: 'erase this dungeon forever',   icon: '✖', color: 'var(--text-mute)', danger: true },
]

export class PauseOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._settings = null
    this._listeners = []
    this._hovered = 'resume'
    this._wireEvents()
  }

  _wireEvents() {
    const sub = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    // OPEN_PAUSE_MENU (from the BottomBar MENU button) just delegates to
    // PauseManager.toggle — the actual mount/unmount is driven by the
    // PAUSE_STATE_CHANGED event PauseManager fires when it succeeds. This
    // shape also lets ESC presses in any gameplay scene (which call
    // PauseManager.toggle() directly) mount the overlay too.
    sub('OPEN_PAUSE_MENU', () => PauseManager.toggle(null))
    sub('PAUSE_STATE_CHANGED', ({ isPaused }) => {
      if (isPaused) this._mountOverlay()
      else          this._unmountOverlay()
    })
  }

  isOpen() { return !!this._overlay?.isOpen() }

  _mountOverlay() {
    if (this.isOpen()) return
    this._overlay = new Overlay({
      title:   'PAUSED',
      width:   760,
      height:  640,
      accent:  'var(--blood)',
      onClose: () => {
        // Overlay close came from ESC / X button / backdrop click — ask
        // PauseManager to resume, which will fire PAUSE_STATE_CHANGED
        // back through us and unmount the overlay. Guard against
        // double-fire: clear our own ref first.
        const ov = this._overlay
        this._overlay = null
        if (PauseManager.isPaused) PauseManager.close()
        // ov is already removed from DOM by Overlay.close() at this point
        void ov
      },
      body: this._renderBody(),
    })
    this._overlay.open()
  }

  _unmountOverlay() {
    if (!this._overlay) return
    const ov = this._overlay
    this._overlay = null
    // Suppress the onClose callback path (which would call PauseManager.close
    // again and re-fire PAUSE_STATE_CHANGED). We're already responding to
    // that state event right now.
    ov._opts.onClose = null
    ov.close()
  }

  close() {
    // Public API — user-initiated close (RESUME button, etc.).
    if (PauseManager.isPaused) PauseManager.close()
    else this._unmountOverlay()
  }

  _renderBody() {
    const gs = this._gameState
    const stats = [
      { l: 'DAY',   v: String(gs?.meta?.dayNumber ?? 1).padStart(2, '0'), c: 'var(--text)' },
      { l: 'GOLD',  v: String(gs?.player?.gold ?? 0),                     c: 'var(--gold-bright)' },
      { l: 'KILLS', v: String(gs?.player?.totalKills ?? 0).padStart(2, '0'), c: 'var(--blood)' },
    ]
    return h('div', { className: 'qf-pause-body' }, [
      // Skull + flavor
      h('div', { className: 'qf-pause-header' }, [
        h('div', { className: 'pix pm-skull qf-pause-skull' }, '☠'),
        h('div', { className: 'pix qf-pause-eyebrow' }, '⸺ THE NIGHT HOLDS ITS BREATH ⸺'),
        h('div', { className: 'qf-pause-flavor' }, '"Even tyrants must rest, my lord."'),
      ]),
      // Run snapshot
      h('div', { className: 'qf-pause-stats' },
        stats.map(s => h('div', { className: 'qf-pause-stat' }, [
          h('div', {
            className: 'pix qf-pause-stat-value',
            style: { color: s.c, textShadow: `0 0 6px ${s.c}55` },
          }, s.v),
          h('div', { className: 'pix qf-pause-stat-label' }, s.l),
        ]))
      ),
      // Menu grid
      h('div', { className: 'qf-pause-menu' },
        MENU_ITEMS.map((m, i) => h('button', {
          className: 'btn qf-pause-item',
          dataset: { id: m.id, primary: m.primary ? 'true' : 'false', danger: m.danger ? 'true' : 'false' },
          style: { '--item-color': m.color, animationDelay: `${120 + i * 60}ms` },
          on: { click: () => this._onItemClick(m.id) },
        }, [
          h('span', { className: 'pix qf-pause-item-icon' }, m.icon),
          h('div', { className: 'qf-pause-item-textcol' }, [
            h('div', { className: 'pix qf-pause-item-label' }, m.label),
            h('div', { className: 'qf-pause-item-sub' }, m.sub),
          ]),
        ]))
      ),
      // Footer
      h('div', { className: 'qf-pause-footer' }, [
        h('span', { className: 'pix qf-pause-footer-l' }, 'ESC TO RESUME'),
        h('span', {
          className: 'pix qf-pause-footer-r',
          style: { color: 'var(--poison)' },
        }, '● PROGRESS SAVED'),
      ]),
    ])
  }

  _onItemClick(id) {
    switch (id) {
      case 'resume':
        this.close()
        break
      case 'boss':
        this.close()
        // Defer so the resume happens before the popup opens — otherwise the
        // Phaser popup sees a paused scene and renders frozen.
        setTimeout(() => EventBus.emit('OPEN_BOSS_OVERVIEW'), 50)
        break
      case 'roster':
        this.close()
        setTimeout(() => EventBus.emit('OPEN_MINION_ROSTER'), 50)
        break
      case 'knowledge':
        this.close()
        setTimeout(() => EventBus.emit('OPEN_KNOWLEDGE_MAP'), 50)
        break
      case 'log':
        // Open the full DUNGEON LOG · FULL RUN overlay (same FullLogOverlay
        // PostWaveOverlay uses). PauseOverlay manages its own instance so
        // closing the log returns the player here; clicking RESUME or Esc
        // out of pause cleans both up.
        this._openFullLog()
        break
      case 'options':
        this._openSettings()
        break
      case 'abandon':
        // ABANDON RUN deletes the save outright — the player is committing
        // to starting over, so CONTINUE shouldn't bring them back here.
        // Confirm-abandon gating is a player preference; off → exit
        // immediately, on → SHOW_CONFIRM with explicit warning copy.
        if (userSettings.isConfirmAbandonEnabled()) {
          EventBus.emit('SHOW_CONFIRM', {
            title:        'ABANDON RUN',
            message:      'All progress in this dungeon will be ERASED. Continue?',
            confirmLabel: 'ABANDON',
            cancelLabel:  'STAY',
            theme:        'crimson',
            onConfirm: () => {
              this.close()
              setTimeout(() => PauseManager.abandonAndExitToMenu(), 50)
            },
          })
        } else {
          this.close()
          setTimeout(() => PauseManager.abandonAndExitToMenu(), 50)
        }
        break
      case 'quit':
        // QUIT TO MAIN MENU — saves first so CONTINUE can pick this run
        // back up later. Distinct from ABANDON (which erases the save).
        this.close()
        setTimeout(() => PauseManager.saveAndExitToMenu(this._gameState), 50)
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

  // Open the FullLogOverlay on top of the pause modal. Two stacked
  // Overlay shells (both z-index 150) — second one wins by DOM order,
  // so the log lands above pause and Esc/× returns to pause.
  _openFullLog() {
    if (this._fullLog) return
    this._fullLog = new FullLogOverlay(this._gameState, {
      onClose: () => { this._fullLog = null },
    })
    this._fullLog.open()
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this._settings?.close()
    this._fullLog?.close()
    this._fullLog = null
    this._overlay?.close()
  }
}

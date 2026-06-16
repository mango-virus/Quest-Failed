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
import { SaveSystem }   from '../systems/SaveSystem.js'
import { SettingsOverlay } from './SettingsOverlay.js'
import { FullLogOverlay } from './FullLogOverlay.js'
import { userSettings } from './userSettings.js'

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
      if (isPaused) {
        // Autosave when the pause menu opens — defence-in-depth so that
        // the player's "Save & Exit" snapshot is ALWAYS current, even if
        // they linger on the menu before clicking. Without this the
        // SaveAndExit handler ships whatever gameState we held at that
        // exact instant; saving here guarantees the latest dayNumber /
        // boss / minion state is committed before any quit-flow runs.
        // Gated by the autosave setting + skip-if-game-over guard so a
        // dead run can't accidentally resurrect itself.
        try {
          if (this._gameState
              && (this._gameState.boss?.deathsRemaining ?? 1) > 0
              && localStorage.getItem('qf.gameplay.autosave') !== 'false') {
            SaveSystem.save(this._gameState)
          }
        } catch {}
        this._mountOverlay()
      } else {
        this._unmountOverlay()
      }
    })
  }

  isOpen() { return !!this._overlay?.isOpen() }

  _mountOverlay() {
    if (this.isOpen()) return
    this._overlay = new Overlay({
      title:   'PAUSED',
      eyebrow: 'THE DUNGEON HOLDS ITS BREATH',
      width:   500,
      height:  452,
      accent:  'var(--blood)',
      frame:   'plain',   // subtle main-menu edge instead of the accent frame
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

  // Resolve the boss archetype's display name + portrait id from the JSON
  // cache (mirrors TopBar). Falls back to a humanised id.
  _bossIdentity() {
    const rawId = String(this._gameState?.player?.bossArchetypeId ?? '')
    const id = rawId.replace(/^the_/, '')
    let name = id.replace(/_/g, ' ')
    try {
      const scenes = window.__game?.scene?.scenes || []
      for (const s of scenes) {
        const archs = s.cache?.json?.get?.('bossArchetypes')
        if (Array.isArray(archs) && archs.length) {
          const arch = archs.find(a => a.id === id || a.id === rawId)
          if (arch?.name) { name = arch.name; break }
        }
      }
    } catch {}
    return { id, name: name.toUpperCase() }
  }

  _renderBody() {
    const gs = this._gameState
    const { id, name } = this._bossIdentity()
    const day     = gs?.meta?.dayNumber ?? 1
    const kills   = gs?.player?.totalKills ?? 0
    const gold    = gs?.player?.gold ?? 0
    const minions = Array.isArray(gs?.minions)
      ? gs.minions.filter(m => (m?.class ?? 'roster') === 'roster' && m?.aiState !== 'dead').length
      : 0

    const reignStat = (label, val, color) => h('span', { className: 'sil qf-pse-st' }, [
      label + ' ', h('b', { className: 'pix', style: { color } }, String(val)),
    ])

    const btn = (cls, icon, label, gc, onClick) => h('button', {
      className: 'pix qf-pse-btn' + cls,
      style: gc ? { '--gc': gc } : undefined,
      on: { click: onClick },
    }, [h('span', { className: 'qf-pse-g' }, icon), label])

    return h('div', { className: 'qf-pse' }, [
      // Reign summary card
      h('div', { className: 'qf-pse-card' }, [
        h('div', {
          className: 'qf-pse-port',
          style: id ? { backgroundImage: `url('assets/ui/bestiary/portraits/${id}_p.png')` } : {},
        }),
        h('div', { className: 'qf-pse-id' }, [
          h('span', { className: 'sil qf-pse-eye' }, 'YOUR REIGN, MY LORD'),
          h('span', { className: 'pix qf-pse-name' }, name),
          h('div', { className: 'qf-pse-reign' }, [
            reignStat('DAY', day, 'var(--gold)'),
            reignStat('☠', kills, 'var(--blood)'),
            reignStat('◐', gold, 'var(--gold-bright)'),
            reignStat('▤', minions, 'var(--poison)'),
          ]),
        ]),
      ]),
      // Actions
      h('div', { className: 'qf-pse-btns' }, [
        btn(' primary', '▶', 'RESUME', null, () => this._onItemClick('resume')),
        h('div', { className: 'qf-pse-row' }, [
          btn('', '◇', 'OPTIONS', 'var(--gold)', () => this._onItemClick('options')),
          btn('', '⏏', 'QUIT TO MENU', 'var(--text-mute)', () => this._onItemClick('quit')),
        ]),
        btn(' danger', '☠', 'ABANDON RUN', 'var(--blood)', () => this._onItemClick('abandon')),
      ]),
      // Footer
      h('div', { className: 'qf-pse-foot' }, [
        h('kbd', { className: 'pix' }, 'ESC'), ' RESUME',
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
        // ABANDON RUN posts the run to the leaderboard, then deletes the
        // save outright — the player is committing to starting over, so
        // CONTINUE shouldn't bring them back here. Confirm-abandon gating
        // is a player preference; off → exit immediately, on → SHOW_CONFIRM.
        if (userSettings.isConfirmAbandonEnabled()) {
          EventBus.emit('SHOW_CONFIRM', {
            title:        'ABANDON RUN',
            message:      'This dungeon will be ERASED and your run posted to the leaderboard. Continue?',
            confirmLabel: 'ABANDON',
            cancelLabel:  'STAY',
            theme:        'crimson',
            onConfirm: () => {
              this.close()
              setTimeout(() => PauseManager.abandonAndExitToMenu(this._gameState), 50)
            },
          })
        } else {
          this.close()
          setTimeout(() => PauseManager.abandonAndExitToMenu(this._gameState), 50)
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

// GameOverOverlay — DOM port of the design's run-end screen
// (moments.jsx → GameOverOverlay).
//
// Surface:
//   * "◆ ◆ ◆ YOUR REIGN ENDS ◆ ◆ ◆" eyebrow
//   * Giant "QUEST / FAILED" title with burn-in + continuous ember glow
//   * Italic flavor quote
//   * "⸺ THE RECKONING ⸺" panel:
//       - Header (SURVIVED N DAYS · CAUSE: X)
//       - 6-stat top row with tickers
//       - DAILY HARVEST timeline (per-day kill bars, final-day red + "FELL")
//       - 3 MVP cards (MVP MINION / SEALED PACTS / FINAL BLOW)
//   * Footer: FULL LOG + RISE AGAIN
//
// Shown on the SHOW_GAME_OVER event (emitted by Game._onBossFinal once the
// boss is out of lives). RISE AGAIN restarts MainMenu; FULL LOG opens
// FullLogOverlay. (The legacy Phaser GameOver scene was removed 2026-05-31.)

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'
import { pixelSprite, spriteKindForDefId } from './sprites.js'
import { snapshotMinion, snapshotAdventurerEntity } from './inGameSnapshot.js'
import { runCountUp } from './countUp.js'
import { FullLogOverlay } from './FullLogOverlay.js'
import { Leaderboard } from '../systems/Leaderboard.js'
import { GameOverMusic } from '../systems/GameOverMusic.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { classLabel, minionLabel } from '../util/displayNames.js'

export class GameOverOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._fullLog = null
    this._countUpCancel = null
    this._listener = () => this.show()
    EventBus.on('SHOW_GAME_OVER', this._listener)
  }

  show() {
    if (this._overlay) return
    const body = this._renderBody()
    this._overlay = new Overlay({
      npcKind:  'gameover',
      title:    'YOUR REIGN ENDS',
      hideClose: true,   // terminal screen — closes via RISE AGAIN (design: no ✕)
      hideHeader: true,  // body renders its own QUEST FAILED header
      width:    1100,
      height:   860,
      accent:   'var(--blood)',
      frame:    'plain',   // single subtle main-menu-edge border (matches other menus)
      // No backdrop-click close — this is a terminal screen.
      closeOnBackdrop: false,
      onClose: () => { this._overlay = null; this._cancelCountUp() },
      body,
    })
    if (this._overlay?.el) {
      // Hide the X close button — the only way out is RISE AGAIN or FULL LOG.
      const closeBtn = this._overlay.el.querySelector('.qf-overlay-close')
      if (closeBtn) closeBtn.style.visibility = 'hidden'
      // Defang Esc.
      window.removeEventListener('keydown', this._overlay._escHandler)
      this._overlay._escHandler = () => {}
    }
    this._overlay.open()
    // Stop the dungeon / boss music and loop the game-over track for as
    // long as this terminal screen is up.
    GameOverMusic.start(window.__game)
    // Cascade every tagged number up from 0 (with count / gold SFX).
    this._countUpCancel = runCountUp(body)
    // Submit run to leaderboard once per show. Mirrors the Phaser
    // GameOver scene's submission so newhud-mode runs still post.
    this._submitRun()
  }

  // ─── Leaderboard submission ──────────────────────────────────
  // Submits the finished run to the leaderboard, including the
  // `leaks_count` field RunHistorySystem.intelLeaks tracks.
  _submitRun() {
    if (this._submitted) return
    this._submitted = true
    try {
      const gs     = this._gameState ?? {}
      const tot    = gs.run?.totals ?? {}
      const player = gs.player ?? {}
      const days   = Number(player.totalDaysElapsed ?? gs.meta?.dayNumber ?? 0)
      const kills  = Number(tot.advsKilled ?? player.totalKills ?? 0)
      // Death-path noise gate — skip quitting before any kills on day 1
      // (the abandon path uses a tighter day>=3 OR kills>=5 in PauseManager).
      if (days <= 1 && kills === 0) return
      const run = Leaderboard.buildRunPayload({
        gameState:  gs,
        endCause:   'death',
        playerName: PlayerProfile.getName?.() || 'ANON',
        pactNames:  this._pactNames(),
      })
      if (!run) return
      // Cache the runId so MainMenuOverlay's top-3 check can resolve
      // "which run was this" after the gameplay save is deleted.
      // Independent of the submit succeeding — if the network's down,
      // we still want to celebrate on next leaderboard fetch.
      const runId = gs.meta?.runId
      const playerName = PlayerProfile.getName?.()
      if (runId && playerName) {
        PlayerProfile.setLastFinishedRunId?.(playerName, runId)
      }
      Leaderboard.submitRun(run).catch(err => {
        // eslint-disable-next-line no-console
        console.warn('[Leaderboard] submit failed:', err?.message)
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Leaderboard] submit threw:', err?.message)
    }
  }

  _cancelCountUp() {
    this._countUpCancel?.()
    this._countUpCancel = null
  }

  _dailyHarvest() {
    const grave = this._gameState.adventurers?.graveyard ?? []
    const known = this._gameState.adventurers?.known     ?? []
    const totalDays = Math.max(1, this._gameState.player?.totalDaysElapsed ?? 1)
    const buckets = []
    for (let day = 1; day <= totalDays; day++) {
      const kills = grave.filter(a => (a.diedOnDay ?? -1) === day).length
      const lost  = (known.filter(k => (k.lastEscapedDay ?? -1) === day)).length
      buckets.push({ day, kills, lost })
    }
    // Add a final "fell" entry if the player died on a day not yet logged.
    // Otherwise the last bucket's day is the day of death.
    return buckets
  }

  _mvpMinion() {
    const minions = this._gameState.minions ?? []
    if (minions.length === 0) return null
    return minions.reduce((best, m) =>
      (m.lifetime?.kills ?? 0) > (best?.lifetime?.kills ?? 0) ? m : best, null)
  }

  _finalBlow() {
    // BossSystem records the actual killer (the fight-party adventurer
    // credited with the final blow) on gameState.run.finalBlow when the
    // boss is defeated. Prefer that.
    const recorded = this._gameState.run?.finalBlow
    if (recorded && (recorded.classId || recorded.name)) return recorded
    // Fallback for runs with no logged fight party — pick the highest-level
    // known adventurer as a rough proxy.
    const known = this._gameState.adventurers?.known ?? []
    if (known.length === 0) return null
    return known.reduce((best, k) =>
      (k.level ?? k.lv ?? 1) > (best?.level ?? best?.lv ?? 1) ? k : best, known[0])
  }

  _pactSummary() {
    const pacts = this._gameState.history?.pacts ?? []
    return pacts
  }

  // Resolve a JSON asset out of whichever scene cache currently has it.
  _cachedJson(key) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.(key)
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
    }
    return null
  }

  // Human-readable names of every pact sealed this run — submitted to
  // the leaderboard so a run's chronicle can list its pacts. Resolves
  // the display name from dungeonMechanics.json, falling back to a
  // humanized mechanicId.
  _pactNames() {
    const defs = this._cachedJson('dungeonMechanics') ?? []
    return (this._gameState.history?.pacts ?? []).map(p => {
      const id = p?.mechanicId ?? p?.id ?? p
      const def = defs.find(d => d.id === id)
      if (def?.name) return def.name
      return String(id || '')
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
        .trim()
    }).filter(Boolean)
  }

  _renderBody() {
    const player = this._gameState.player ?? {}
    const totals = this._gameState.run?.totals ?? {}
    const days     = player.totalDaysElapsed ?? this._gameState.meta?.dayNumber ?? 0
    const slain    = totals.advsKilled  ?? player.totalKills ?? 0
    const escaped  = totals.advsEscaped ?? 0
    const minLost  = totals.minionsLost ?? 0
    const gold     = totals.gold        ?? 0
    const bossLv   = this._gameState.boss?.level ?? 1
    const timeline = this._dailyHarvest()
    const maxKills = Math.max(1, ...timeline.map(t => t.kills))
    const mvpMinion = this._mvpMinion()
    const final     = this._finalBlow()
    const pacts     = this._pactSummary()

    return h('div', { className: 'qf-go-body' }, [
      // Cinematic title block
      h('div', { className: 'qf-go-cinematic' }, [
        h('div', { className: 'pix qf-go-eyebrow' },
          '◆ ◆ ◆  YOUR REIGN ENDS  ◆ ◆ ◆'),
        h('div', { className: 'pix qf-go-title' }, ['QUEST', h('br'), 'FAILED']),
        h('div', { className: 'qf-go-flavor' },
          '"The fools have at last seen sunlight. The bone-halls weep without their master."'),
      ]),
      // RECKONING panel
      h('div', { className: 'qf-go-summary' }, [
        h('div', { className: 'qf-go-reckoning-head' }, [
          h('div', { className: 'pix qf-go-reckoning-title' }, '⸺ THE RECKONING ⸺'),
          h('div', { className: 'pix qf-go-reckoning-meta' }, [
            `SURVIVED ${days} DAYS · CAUSE: `,
            h('span', { style: { color: 'var(--blood)' } }, 'OVERRUN'),
          ]),
        ]),
        // 6-stat top row
        h('div', { className: 'qf-go-statgrid' }, [
          this._statTile('DAYS',    days,     'var(--text)',        '◇'),
          this._statTile('SLAIN',   slain,    'var(--poison)',      '☠'),
          this._statTile('ESCAPED', escaped,  'var(--warn)',        '↗'),
          this._statTile('MIN LOST',minLost,  'var(--blood)',       '✦'),
          this._statTile('BOSS LV', bossLv,   'var(--gold-bright)', '★'),
          this._statTile('GOLD',    gold,     'var(--gold)',        '$', true),
        ]),
        // Timeline + MVP grid
        h('div', { className: 'qf-go-bottomgrid' }, [
          // Daily harvest timeline
          h('div', { className: 'qf-go-timeline go-timeline' }, [
            h('div', { className: 'pix qf-go-section-title' }, '◇ DAILY HARVEST'),
            h('div', {
              className: 'qf-go-timeline-bars',
              style: { gridTemplateColumns: `repeat(${timeline.length}, 1fr)` },
            }, timeline.map((t, i) => {
              const isLast = i === timeline.length - 1
              const pct = (t.kills / maxKills) * 100
              return h('div', { className: 'qf-go-timeline-col' }, [
                h('span', {
                  className: 'pix qf-go-timeline-kills',
                  style: {
                    color: isLast ? 'var(--blood-glow)' : 'var(--text)',
                    textShadow: isLast ? '0 0 6px var(--blood-glow)' : 'none',
                  },
                }, String(t.kills)),
                h('div', {
                  className: 'qf-go-timeline-bar go-bar',
                  style: {
                    height: `${Math.max(pct, t.kills > 0 ? 4 : 1)}%`,
                    background: isLast
                      ? 'linear-gradient(180deg, var(--blood-glow), var(--blood))'
                      : 'linear-gradient(180deg, var(--poison), #3a6818)',
                    boxShadow: isLast
                      ? '0 0 12px var(--blood), inset 0 -1px 0 rgba(0,0,0,0.5)'
                      : 'inset 0 -1px 0 rgba(0,0,0,0.5)',
                    animationDelay: `${2700 + i * 100}ms`,
                  },
                }),
                h('div', { className: 'pix qf-go-timeline-day' }, `D${t.day}`),
                isLast && h('span', { className: 'pix qf-go-timeline-fell' }, 'FELL'),
              ])
            })),
          ]),
          // MVP cards column
          h('div', { className: 'qf-go-mvpcol' }, [
            this._mvpCard(
              'MVP MINION',
              mvpMinion ? (mvpMinion.name || minionLabel(mvpMinion.definitionId)) : '— none —',
              mvpMinion ? `${mvpMinion.lifetime?.kills ?? 0}☠` : '—',
              'var(--poison)',
              mvpMinion
                ? (snapshotMinion(mvpMinion.definitionId, 28)
                  || pixelSprite(spriteKindForDefId(mvpMinion.definitionId), 28))
                : null,
            ),
            this._mvpCard(
              'SEALED PACTS',
              pacts.length > 0 ? this._formatPactList(pacts) : '— none —',
              String(pacts.length),
              'var(--gold)',
              h('div', {
                className: 'qf-go-mvp-glyph',
                style: { color: 'var(--gold)' },
              }, '▣'),
            ),
            this._mvpCard(
              'FINAL BLOW',
              final ? `${final.name} · ${classLabel(final.classId).toUpperCase()}` : '— unknown —',
              final ? `LV ${final.level ?? final.lv ?? 1}` : '—',
              'var(--blood)',
              final ? (snapshotAdventurerEntity(final, 28)
                || pixelSprite(spriteKindForDefId(final.classId), 28)) : null,
            ),
          ]),
        ]),
      ]),
      // Footer
      h('div', { className: 'qf-go-footer' }, [
        h('button', {
          className: 'btn lg',
          on: { click: () => this._openFullLog() },
        }, 'FULL LOG'),
        h('button', {
          className: 'btn primary lg',
          on: { click: () => this._riseAgain() },
        }, 'RISE AGAIN'),
      ]),
    ])
  }

  _statTile(label, value, color, icon, gold = false) {
    return h('div', {
      className: 'qf-go-stat go-stat',
      style: {
        borderColor: `${color}66`,
        borderTop: `2px solid ${color}`,
      },
    }, [
      h('div', {
        className: 'pix qf-go-stat-icon',
        style: { color },
      }, icon),
      h('div', {
        className: `pix qf-go-stat-value cu${gold ? ' cu-gold' : ''}`,
        style: { color, textShadow: `0 0 10px ${color}66` },
      }, String(value)),
      h('div', { className: 'pix qf-go-stat-label' }, label),
    ])
  }

  _mvpCard(label, value, badge, color, leftEl) {
    return h('div', {
      className: 'qf-go-mvp go-mvp',
      style: {
        borderColor: color,
        borderLeft: `3px solid ${color}`,
      },
    }, [
      h('div', {
        className: 'qf-go-mvp-spritebox',
        style: { borderColor: color },
      }, leftEl),
      h('div', { className: 'qf-go-mvp-textcol' }, [
        h('div', { className: 'pix qf-go-mvp-label' }, label),
        h('div', { className: 'pix qf-go-mvp-value' }, value),
      ]),
      h('div', {
        className: 'pix qf-go-mvp-badge cu',
        style: { color },
      }, badge),
    ])
  }

  _formatPactList(pacts) {
    if (pacts.length === 0) return '— none —'
    const names = pacts.slice(0, 2).map(p => {
      // Try to humanize the mechanicId
      return String(p.mechanicId || '?')
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    })
    const remaining = pacts.length - names.length
    return remaining > 0 ? `${names.join(' · ')} · +${remaining} more` : names.join(' · ')
  }

  _openFullLog() {
    if (this._fullLog) return
    // Stop any in-flight count-up so its loop tone doesn't keep playing
    // underneath the log overlay that's about to open on top.
    this._cancelCountUp()
    this._fullLog = new FullLogOverlay(this._gameState, {
      onClose: () => { this._fullLog = null },
    })
    this._fullLog.open()
  }

  _riseAgain() {
    // Close the overlay, return to main menu. Mirrors GameOver scene's
    // "rise again" behaviour.
    this._cancelCountUp()
    // Leaving the game-over screen — stop the loop so MainMenu's title
    // music can take over.
    GameOverMusic.stop()
    const ov = this._overlay
    this._overlay = null
    ov?._opts && (ov._opts.onClose = null)
    ov?.close()
    this._fullLog?.close()
    this._fullLog = null
    const game = window.__game
    if (game?.scene) {
      // Stop all gameplay scenes, then start MainMenu fresh.
      const stopKeys = ['Game', 'NightPhase', 'DayPhase', 'EndOfDay', 'HudScene',
                        'Graveyard', 'KnowledgeScreen', 'GameOver']
      for (const k of stopKeys) {
        if (game.scene.isActive(k) || game.scene.isPaused?.(k)) game.scene.stop(k)
      }
      game.scene.start('MainMenu')
    }
  }

  destroy() {
    EventBus.off('SHOW_GAME_OVER', this._listener)
    this._cancelCountUp()
    GameOverMusic.stop()
    this._fullLog?.close()
    this._fullLog = null
    const ov = this._overlay
    this._overlay = null
    ov?._opts && (ov._opts.onClose = null)
    ov?.close()
  }
}

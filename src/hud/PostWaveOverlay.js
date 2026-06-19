// PostWaveOverlay — DOM port of the design's day-end summary
// (moments.jsx → PostWaveOverlay).
//
// Surface:
//   * Hero strip: "THE DUST SETTLES" eyebrow + DAY {n} slam-in + flavor +
//     SLAIN/ESCAPED tally pills + NET GOLD vault badge with ticker
//   * Left: per-adventurer Fate cards (slain → red border + giant ×
//     death stamp; escaped → warn border + leaked-intel chip)
//   * Right: MVP MINION card + DUNGEON PERFORMANCE 6-stat grid +
//     INTEL LEAKED pulse warning (when any escaped)
//   * Footer: "VIEW DUNGEON LOG" + "CONTINUE TO NIGHT"
//
// Same event contract as the Phaser popup: subscribes to
// `SHOW_POST_WAVE_SUMMARY { snapshot }`. Snapshot shape:
//   { graveyardLen, totals: { gold, advsKilled, advsEscaped, dmgDealt,
//                              dmgTaken, minionsLost, ... } }
// — the index/baseline at the start of the day. We compute today's
// deltas client-side.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'
import { pixelSprite, spriteKindForDefId } from './sprites.js'
import { snapshotMinion, snapshotAdventurerEntity } from './inGameSnapshot.js'
import { runCountUp } from './countUp.js'
import { FullLogOverlay } from './FullLogOverlay.js'
import { mvpMinion } from './hudShared.js'
import { classLabel, minionLabel } from '../util/displayNames.js'

export class PostWaveOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._snapshot = null
    this._countUpCancel = null
    this._listener = ({ snapshot } = {}) => this.showFor(snapshot)
    EventBus.on('SHOW_POST_WAVE_SUMMARY', this._listener)
  }

  showFor(snapshot) {
    if (this._overlay) this._closeNow()
    this._snapshot = snapshot ?? {}
    // Reset the idempotency guard so the next day's CONTINUE click can
    // advance EndOfDay too.
    this._fired = false
    const body = this._renderBody()
    this._overlay = new Overlay({
      npcKind:  'postwave',
      title:    'POST-WAVE SUMMARY',
      hideClose: true,   // closes via CONTINUE TO NIGHT (design: no ✕)
      hideHeader: true,  // body renders its own header
      width:    1400,
      height:   840,
      accent:   'var(--blood)',
      frame:    'plain',   // single subtle main-menu-edge border (matches other menus)
      animation: 'unfurl',
      // X / Esc / backdrop dismiss MUST advance the day→night chain just
      // like the CONTINUE TO NIGHT button — route every dismiss path
      // through _closeNow(). Without this, closing via X never emits
      // POST_WAVE_CONTINUE, EndOfDay hangs, NightPhase never starts, and
      // the play area is left black. (Overlay.close() is guarded by its
      // own _open flag, so _closeNow's ov.close() call here just no-ops.)
      onClose:  () => this._closeNow(),
      body,
    })
    this._overlay.open()
    // Cascade every tagged number up from 0 (with count / gold SFX).
    this._countUpCancel = runCountUp(body)
  }

  _closeNow() {
    const ov = this._overlay
    this._overlay = null
    this._cancelCountUp()
    this._fullLog?.close()
    this._fullLog = null
    ov?._opts && (ov._opts.onClose = null)
    ov?.close()
    // Drive the EndOfDay → (boss-level-up queue) → DarkPact → NightPhase
    // chain. Without this the orchestrator hangs forever and the screen
    // goes black (no scene visible, no controls). Idempotent guard: only
    // fire on user-driven dismiss, not on a replace-with-new-payload swap.
    if (!this._fired) {
      this._fired = true
      EventBus.emit('POST_WAVE_CONTINUE')
    }
  }

  _cancelCountUp() {
    this._countUpCancel?.()
    this._countUpCancel = null
  }

  // ── Data helpers ────────────────────────────────────────────────
  _todayStats() {
    const snap = this._snapshot ?? {}
    const totals = this._gameState.run?.totals ?? {}
    const baseline = snap.totals ?? {}
    return {
      goldDelta:   (totals.gold ?? 0)         - (baseline.gold ?? 0),
      goldLost:    (totals.goldLost ?? 0)     - (baseline.goldLost ?? 0),
      advsKilled:  (totals.advsKilled ?? 0)   - (baseline.advsKilled ?? 0),
      advsEscaped: (totals.advsEscaped ?? 0)  - (baseline.advsEscaped ?? 0),
      dmgDealt:    (totals.dmgDealt ?? 0)     - (baseline.dmgDealt ?? 0),
      dmgTaken:    (totals.dmgTaken ?? 0)     - (baseline.dmgTaken ?? 0),
      minionsLost: (totals.minionsLost ?? 0)  - (baseline.minionsLost ?? 0),
    }
  }

  _todayAdventurers() {
    const snap = this._snapshot ?? {}
    const grave    = this._gameState.adventurers?.graveyard ?? []
    const known    = this._gameState.adventurers?.known     ?? []
    const day = (this._gameState.meta?.dayNumber ?? 1) - 1  // day that just ended
    const sliceFrom = snap.graveyardLen ?? 0
    const slain    = grave.slice(sliceFrom).filter(a => (a.diedOnDay ?? day) === day)
    const escaped  = known.filter(k => (k.lastEscapedDay ?? -1) === day)
    return { slain, escaped, day }
  }

  _mvpMinion() { return mvpMinion(this._gameState.minions) }

  // ── Render ──────────────────────────────────────────────────────
  _renderBody() {
    const { slain, escaped, day } = this._todayAdventurers()
    const stats = this._todayStats()
    const mvp = this._mvpMinion()
    const fallen = [
      ...slain.map(a => ({ ...a, _status: 'slain' })),
      ...escaped.map(a => ({ ...a, _status: 'escaped' })),
    ]
    // Loot Goblins escape with stolen gold, not intel; monster invaders
    // (zombie horde, rival dungeon) don't report to the Guild at all —
    // exclude both from the "INTEL LEAKED" warning so it only counts
    // real Guild leakers.
    const intelLeakers = escaped.filter(a => a.classId !== 'loot_goblin' && !a._monster)

    return h('div', { className: 'qf-pws-body' }, [
      this._renderHero(slain.length, escaped.length, stats.goldDelta, stats.goldLost, day),
      h('div', { className: 'qf-pws-main' }, [
        // LEFT: fates
        h('div', { className: 'panel bevel qf-pws-fatespanel' }, [
          // Panel head — title only; the SLAIN/ESCAPED tallies are
          // already shown prominently in the hero pills above, so the
          // duplicate "X SLAIN · X ESCAPED" subtitle has been removed.
          h('div', { className: 'panel-head' }, [
            h('div', { className: 'title' }, 'ADVENTURER FATES'),
          ]),
          h('div', { className: 'qf-pws-fates-body' },
            fallen.length === 0
              ? [h('div', { className: 'qf-pws-empty' }, '— no arrivals today —')]
              : fallen.map((a, i) => this._renderFate(a, i))
          ),
        ]),
        // RIGHT: performance
        h('div', { className: 'qf-pws-rightcol' }, [
          this._renderMvp(mvp),
          this._renderStats(stats),
          intelLeakers.length > 0 && this._renderLeakWarn(intelLeakers),
        ]),
      ]),
      // Footer
      h('div', { className: 'qf-pws-footer' }, [
        h('button', {
          className: 'btn',
          style: { minWidth: '200px' },
          on: { click: () => this._openFullLog() },
        }, [
          h('span', { style: { color: 'var(--rumor)' } }, '◇ '),
          'VIEW DUNGEON LOG',
        ]),
        h('button', {
          className: 'btn primary lg',
          style: { minWidth: '320px' },
          on: { click: () => this._closeNow() },
        }, 'CONTINUE TO NIGHT'),
      ]),
    ])
  }

  // FullLogOverlay opens on top of this overlay (Overlay shell sits at
  // z-index 150 — two siblings stack by DOM insertion order). Closing
  // it returns to the PostWave underneath; player can then click
  // CONTINUE TO NIGHT to advance.
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

  _renderHero(slainCount, escapedCount, goldDelta, goldLost, day) {
    // NET GOLD = gold looted this day minus anything loot goblins skimmed
    // from the treasury. Net can go negative on a bad goblin day.
    const net = goldDelta - goldLost
    const netStr = net >= 0 ? `+${net}` : String(net)
    return h('div', { className: 'qf-pws-hero' }, [
      h('div', null, [
        h('div', { className: 'pix qf-pws-eyebrow' }, '⸺  THE DUST SETTLES  ⸺'),
        h('div', {
          className: 'pix qf-pws-daystamp pws-stamp',
        }, `DAY ${day}`),
        h('div', { className: 'qf-pws-flavor' },
          `"${slainCount} fell. ${escapedCount} fled with stories."`),
      ]),
      // Tally pills
      h('div', { className: 'qf-pws-pills' }, [
        this._tallyPill('SLAIN',   slainCount,   'var(--blood)', '☠', 520),
        this._tallyPill('ESCAPED', escapedCount, 'var(--warn)',  '↗', 680),
      ]),
      // Net gold callout — looted vs. stolen breakdown.
      h('div', { className: 'qf-pws-gold pws-gold-callout' }, [
        h('div', null, [
          h('div', { className: 'pix qf-pws-gold-label' }, 'NET GOLD'),
          h('div', { className: 'pix qf-pws-gold-sub' },
            goldLost > 0
              ? `+${goldDelta} LOOTED · −${goldLost} STOLEN`
              : `+${goldDelta} LOOTED`),
        ]),
        h('div', { className: 'qf-pws-gold-amount' }, [
          h('div', { className: 'qf-coin' }),
          h('span', {
            className: 'pix qf-pws-gold-num cu cu-gold',
          }, netStr),
        ]),
      ]),
    ])
  }

  _tallyPill(label, value, color, icon, delay) {
    return h('div', {
      className: 'qf-pws-pill pws-pill',
      style: {
        border: `1px solid ${color}`,
        boxShadow: `0 0 12px ${color}33`,
        animationDelay: `${delay}ms`,
      },
    }, [
      h('div', {
        className: 'pix qf-pws-pill-value cu',
        style: { color, textShadow: `0 0 8px ${color}` },
      }, `${icon} ${value}`),
      h('div', { className: 'pix qf-pws-pill-label' }, label),
    ])
  }

  _renderFate(adv, idx) {
    const isSlain = adv._status === 'slain'
    const color = isSlain ? 'var(--blood)' : 'var(--warn)'
    const advKind = spriteKindForDefId(adv.classId)
    const killerName = adv.killerName || '???'
    // Loot goblins are NOT adventurers — they raid for gold, not glory.
    // When one escapes the dungeon they steal gold, not leak intel.
    // Sprite + message + chip all differ from a normal adv.
    const isGoblin = adv.classId === 'loot_goblin'
    // Monster invaders (zombie horde, rival dungeon) retreat — they never
    // carry intel back to the Guild.
    const isMonster = !!adv._monster
    // Sprite resolution: goblins use the minion-goblin1 sheet (same
    // sheet AdventurerRenderer borrows for the loot_goblin class);
    // everyone else uses their LPC variant via snapshotAdventurer.
    const spriteEl = isGoblin
      ? (snapshotMinion('goblin1', 38) || pixelSprite('goblin', 38))
      : (snapshotAdventurerEntity(adv, 38)
         || pixelSprite(advKind, 38))
    return h('div', {
      className: 'qf-pws-row pws-row',
      style: {
        borderLeft: `4px solid ${color}`,
        animationDelay: `${idx * 120}ms`,
      },
    }, [
      h('div', { className: 'qf-pws-row-sprite' }, [
        h('div', {
          className: 'qf-pws-sprite-box',
          style: {
            borderColor: color,
            filter: isSlain ? 'grayscale(0.6) brightness(0.7)' : 'none',
          },
        }, spriteEl),
        isSlain && h('div', {
          className: 'pix qf-pws-x pws-x',
          style: { animationDelay: `${idx * 120 + 360}ms` },
        }, '×'),
      ]),
      h('div', { className: 'qf-pws-row-info' }, [
        h('div', { className: 'qf-pws-row-headline' }, [
          h('span', { className: 'pix qf-pws-row-name' }, adv.name || 'Unnamed'),
          h('span', { className: 'pix qf-pws-row-class' },
            `${classLabel(adv.classId).toUpperCase()} · LV ${adv.displayLevel ?? adv.level ?? adv.lv ?? 1}`),
        ]),
        h('div', {
          className: 'qf-pws-row-detail',
          style: { color: isSlain ? 'var(--text-mute)' : 'var(--warn)' },
        }, isSlain
          ? ['slain by ', h('span', { style: { color: 'var(--poison)' } }, killerName)]
          : isGoblin
            ? 'escaped — made off with stolen gold'
            : isMonster
              ? 'retreated from the dungeon'
              : 'escaped — carried intel back to the guild'
        ),
        // Tag chip
        h('div', { className: 'qf-pws-row-tags' }, [
          isSlain && h('span', {
            className: 'pix qf-pws-tag-gold',
          }, `+ ${adv.goldDropped ?? 0}g LOOT`),
          // Escape chip: anyone who got away with gold — a loot goblin,
          // or an adventurer who cracked a treasure chest — shows the
          // loss-gold "Ng STOLEN" chip. Empty-handed escapees just leaked
          // intel. Monster invaders carry neither gold nor intel — no chip.
          !isSlain && !isMonster && ((isGoblin || (adv.goldStolen ?? 0) > 0)
            ? h('span', {
                className: 'pix qf-pws-tag-leak',
                style: {
                  color: 'var(--gold-bright)',
                  borderColor: 'var(--gold)',
                  background: 'rgba(212, 166, 72, 0.12)',
                },
              }, `◐ ${adv.goldStolen ?? 0}g STOLEN`)
            : h('span', {
                className: 'pix qf-pws-tag-leak',
              }, '⚠ INTEL LEAKED')),
        ]),
      ]),
      isSlain && adv.killerKind && h('div', {
        className: 'qf-pws-row-killer',
      }, snapshotMinion(adv.killerKind, 28)
         || pixelSprite(spriteKindForDefId(adv.killerKind), 28)),
    ])
  }

  _renderMvp(mvp) {
    return h('div', { className: 'panel bevel qf-pws-mvp pws-mvp' }, [
      h('div', { className: 'pix qf-pws-mvp-title' }, '◇ MVP MINION'),
      mvp
        ? h('div', { className: 'qf-pws-mvp-card' }, [
            h('div', { className: 'qf-pws-mvp-spritebox' },
              snapshotMinion(mvp.definitionId, 36)
              || pixelSprite(spriteKindForDefId(mvp.definitionId), 36)),
            h('div', { className: 'qf-pws-mvp-textcol' }, [
              h('div', { className: 'pix qf-pws-mvp-name' },
                mvp.name || minionLabel(mvp.definitionId)),
              h('div', { className: 'pix qf-pws-mvp-class' },
                `${minionLabel(mvp.definitionId).toUpperCase()} · LV ${mvp.level ?? 1}`),
            ]),
            h('div', { className: 'pix qf-pws-mvp-kills' },
              `☠ ${mvp.lifetime?.kills ?? 0} KILLS`),
          ])
        : h('div', { className: 'qf-pws-mvp-empty' }, '— no minion kills yet —'),
    ])
  }

  _renderStats(stats) {
    const bossLv = this._gameState.boss?.level ?? 1
    const xpEarned = stats.advsKilled * 10  // Balance.BOSS_XP_PER_KILL default
    // GOLD GAINED tile dropped — it duplicated the prominent NET GOLD
    // callout in the hero strip above. The 5-tile grid still renders
    // cleanly (2 rows × 3 cols with one empty slot, see CSS grid-auto-flow).
    const tiles = [
      { l: 'DMG DEALT',    v: stats.dmgDealt,    c: 'var(--blood)',     i: '⚔', prefix: '' },
      { l: 'DMG TAKEN',    v: stats.dmgTaken,    c: 'var(--warn)',      i: '◆', prefix: '' },
      { l: 'MINIONS LOST', v: stats.minionsLost, c: 'var(--poison)',    i: '✦', prefix: '' },
      { l: 'XP EARNED',    v: xpEarned,          c: 'var(--xp-bright)', i: '◈', prefix: '+' },
      { l: 'BOSS LV',      v: bossLv,            c: 'var(--gold-bright)', i: '★', prefix: '' },
    ]
    return h('div', { className: 'panel bevel qf-pws-stats pws-stats' }, [
      h('div', { className: 'pix qf-pws-stats-title' }, '◇ DUNGEON PERFORMANCE'),
      h('div', { className: 'qf-pws-stats-grid' },
        tiles.map((t, i) => h('div', {
          className: 'qf-pws-stat-tile pws-stat-tile',
          style: { animationDelay: `${1100 + i * 90}ms` },
        }, [
          h('div', {
            className: 'pix qf-pws-stat-icon',
            style: { color: t.c },
          }, t.i),
          h('div', {
            className: 'pix qf-pws-stat-value cu',
            style: { color: t.c, textShadow: `0 0 8px ${t.c}55` },
          }, `${t.prefix}${t.v}`),
          h('div', { className: 'pix qf-pws-stat-label' }, t.l),
        ]))
      ),
    ])
  }

  // Current dungeon exposure % from the live KnowledgeSystem, or null
  // if the Game scene / system can't be reached.
  _currentExposure() {
    const mgr = window.__game?.scene
    let sys = mgr?.getScene?.('Game')?.knowledgeSystem
    if (!sys && mgr?.scenes) {
      for (const s of mgr.scenes) { if (s?.knowledgeSystem) { sys = s.knowledgeSystem; break } }
    }
    const r = sys?.getIntelReport?.()
    return (r && typeof r.exposurePct === 'number') ? r.exposurePct : null
  }

  _renderLeakWarn(escaped) {
    const names = escaped.map(e => e.name || 'Unnamed').slice(0, 2).join(', ')
    const textChildren = [
      h('span', { style: { color: 'var(--warn)' } }, names),
      ' escaped carrying intel back to the guild.',
    ]
    // Real exposure delta: end-of-day exposure minus the day-start
    // baseline DayPhase stamped on the snapshot. Escapees are the only
    // adventurers that feed the shared pool, so this is exactly the cost
    // of today's escapes. Tier-weighted, capped — never the old fake
    // `escaped.length * 6`. If the system is unreachable, omit the figure
    // rather than print a guess.
    const current = this._currentExposure()
    if (current != null) {
      const delta = Math.max(0, current - (this._snapshot?.exposurePct ?? 0))
      textChildren.push(' Exposure ')
      textChildren.push(h('span', { style: { color: 'var(--blood)' } }, `+${delta}%`))
      textChildren.push(` (now ${current}%).`)
    }
    return h('div', { className: 'qf-pws-warn pws-warning' }, [
      h('div', { className: 'pix qf-pws-warn-title' }, '⚠ INTEL LEAKED'),
      h('div', { className: 'qf-pws-warn-text' }, textChildren),
    ])
  }

  destroy() {
    EventBus.off('SHOW_POST_WAVE_SUMMARY', this._listener)
    this._closeNow()
  }
}

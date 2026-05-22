// FullLogOverlay — DOM port of the design's run-end log viewer
// (moments.jsx → FullLogOverlay).
//
// Surface:
//   * Filter strip: ALL / KILLS / LEAKS / PACTS / LOSSES / LEVELS
//   * Chronological log grouped by day. Each day section:
//       - Gold-bordered "DN" marker badge (final day red + " · THE FALL")
//       - Event rows: timestamp + color-coded glyph + text + optional loot tag
//   * Footer: filter count + "SCROLL · ESC TO CLOSE"
//
// Reads from `gameState.history.events` if populated, otherwise falls
// back to `gameState.history.pacts` + `adventurers.graveyard` to
// synthesize a basic log. The Phaser game doesn't keep a per-event
// timestamped log yet, so this is best-effort.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { pactLabel } from '../util/displayNames.js'

// Color palette + glyphs MUST stay in sync with RightPanels.js LOG_KINDS
// so the live dungeon log and the full-run log read identically. Notes:
//   * kill is GREEN — boss killed an adventurer (player WIN).
//   * minion-fell is RED — minion died (player LOSS); the live panel
//     calls this 'minion-lost', so we accept both kind names below.
//   * day-phase vs night-phase get distinct colors so the day brackets
//     read as a beat instead of all looking the same.
//   * spawn gets a soft violet so adventurer arrivals stand out from
//     night transitions.
const LOG_KIND_META = {
  info:          { c: 'var(--text-mute)',                glyph: '◇' },
  phase:         { c: 'var(--text-mute)',                glyph: '◇' },
  // ── Wins ─────────────────────────────────────────────────────
  kill:          { c: 'var(--poison)',                   glyph: '☠' },
  // ── Losses (multiple kind names — live panel uses minion-lost) ─
  'minion-fell': { c: 'var(--blood)',                    glyph: '✦' },
  'minion-lost': { c: 'var(--blood)',                    glyph: '✦' },
  wound:         { c: 'var(--blood)',                    glyph: '⚠' },
  damage:        { c: 'var(--blood)',                    glyph: '⚠' },
  'room-down':   { c: 'var(--blood)',                    glyph: '✕' },
  steal:         { c: 'var(--blood)',                    glyph: '◐' },
  // ── Gains ────────────────────────────────────────────────────
  gold:          { c: 'var(--gold)',                     glyph: '◐' },
  flee:          { c: 'var(--gold)',                     glyph: '↗' },
  // ── Milestones ───────────────────────────────────────────────
  level:         { c: 'var(--gold-bright, #ffe488)',     glyph: '★' },
  // ── Warnings ─────────────────────────────────────────────────
  trap:          { c: 'var(--warn)',                     glyph: '▲' },
  leak:          { c: 'var(--warn)',                     glyph: '⚠' },
  veteran:       { c: 'var(--warn)',                     glyph: '⚑' },
  // ── Pacts / events ───────────────────────────────────────────
  pact:          { c: 'var(--info)',                     glyph: '▣' },
  event:         { c: 'var(--info)',                     glyph: '◈' },
  // ── Arrivals / phase transitions ─────────────────────────────
  spawn:         { c: '#c39bff',                         glyph: '↘' },
  'day-phase':   { c: 'var(--gold)',                     glyph: '☀' },
  'night-phase': { c: '#7a93c4',                         glyph: '☾' },
  // ── Boss fight + ability ────────────────────────────────────
  'boss-fight':  { c: 'var(--blood-glow, #ff7777)',      glyph: '⚔' },
  ability:       { c: '#a8e8e8',                         glyph: '◆' },
  // ── Run-end marker (keeps blood-red so the finale stands out) ─
  death:         { c: 'var(--blood-glow, #ff7777)',      glyph: '✸' },
  end:           { c: 'var(--blood)',                    glyph: '⸺' },
}

const FILTERS = [
  { id: 'ALL',    label: 'ALL',    match: () => true },
  { id: 'KILLS',  label: 'KILLS',  match: (e) => e.kind === 'kill' || e.kind === 'death' },
  { id: 'LEAKS',  label: 'LEAKS',  match: (e) => e.kind === 'leak' },
  { id: 'PACTS',  label: 'PACTS',  match: (e) => e.kind === 'pact' },
  { id: 'LOSSES', label: 'LOSSES', match: (e) => e.kind === 'minion-fell' || e.kind === 'wound' },
  { id: 'LEVELS', label: 'LEVELS', match: (e) => e.kind === 'level' },
]

export class FullLogOverlay {
  constructor(gameState, opts = {}) {
    this._gameState = gameState
    this._onClose = opts.onClose ?? null
    this._filter = 'ALL'
    this._overlay = null
  }

  open() {
    if (this._overlay) return
    this._overlay = new Overlay({
      npcKind:  'log',
      title:    'DUNGEON LOG · FULL RUN',
      width:    1100,
      height:   840,
      accent:   'var(--blood)',
      animation: 'unfurl',
      onClose: () => { this._overlay = null; this._onClose?.() },
      body:    this._renderBody(),
    })
    this._overlay.open()
  }

  close() {
    this._overlay?.close()
    this._overlay = null
  }

  _rerender() {
    if (this._overlay) this._overlay.setBody(this._renderBody())
  }

  _buildLog() {
    // Build a per-day log from gameState. Best-effort: the live game
    // doesn't keep per-event timestamps, so we synthesize from:
    //   - history.pacts          → pact events
    //   - history.events         → if populated (future-proofing)
    //   - adventurers.graveyard  → kill events (diedOnDay)
    //   - adventurers.known      → leak events (lastEscapedDay)
    //   - phase transitions      → bookends per day
    const totalDays = Math.max(1, this._gameState.player?.totalDaysElapsed ?? 1)
    const grave = this._gameState.adventurers?.graveyard ?? []
    const known = this._gameState.adventurers?.known ?? []
    const pacts = this._gameState.history?.pacts ?? []
    const byDay = []
    for (let d = 1; d <= totalDays; d++) {
      const dayEvents = []
      dayEvents.push({ t: '02:00', kind: 'night-phase', text: `Night ${d} build phase` })
      for (const p of pacts.filter(p => p.day === d)) {
        const rarity = (p.rarity || 'common').toUpperCase()
        dayEvents.push({
          t: '02:30', kind: 'pact',
          text: `PACT SEALED · ${pactLabel(p.mechanicId)} (${rarity})`,
        })
      }
      dayEvents.push({ t: '06:00', kind: 'day-phase', text: `Dawn breaks · Day ${d} begins` })
      const killedToday = grave.filter(a => (a.diedOnDay ?? -1) === d)
      for (const a of killedToday) {
        dayEvents.push({
          t: '— ', kind: 'kill',
          text: `${a.killerName ?? 'A minion'} slays ${a.name ?? 'an adventurer'}`,
          loot: a.goldDropped ? `+${a.goldDropped}g` : null,
        })
      }
      const leakedToday = known.filter(k => (k.lastEscapedDay ?? -1) === d)
      for (const k of leakedToday) {
        dayEvents.push({
          t: '— ', kind: 'leak',
          text: `${k.name ?? 'An adventurer'} ESCAPED with intel`,
        })
      }
      dayEvents.push({
        t: '18:00', kind: 'day-phase',
        text: `Day ${d} ends · ${killedToday.length} slain · ${leakedToday.length} escaped`,
      })
      // Mark final day
      if (d === totalDays) {
        dayEvents.push({
          t: '—', kind: 'end',
          text: '⸺  THE BONE-HALLS GO SILENT  ⸺',
        })
      }
      byDay.push({ day: d, events: dayEvents })
    }
    return byDay
  }

  _renderBody() {
    const log = this._buildLog()
    const activeFilter = FILTERS.find(f => f.id === this._filter) || FILTERS[0]
    const totalEvents = log.reduce(
      (n, d) => n + d.events.filter(activeFilter.match).length, 0)
    return h('div', { className: 'qf-fl-body' }, [
      // Filter strip
      h('div', { className: 'qf-fl-filterstrip' }, [
        h('span', { className: 'pix qf-fl-filterlabel' }, 'FILTER'),
        ...FILTERS.map(f => h('button', {
          className: 'qf-fl-filterbtn',
          dataset: { active: this._filter === f.id ? 'true' : 'false' },
          on: { click: () => { this._filter = f.id; this._rerender() } },
        }, f.label)),
      ]),
      // Scrolling log
      h('div', { className: 'qf-fl-scroll' }, [
        h('div', { className: 'qf-fl-rail' }),
        ...log.map(day => {
          const events = day.events.filter(activeFilter.match)
          if (events.length === 0) return null
          const isFinal = day.day === log.length
          return h('div', { className: 'qf-fl-day' }, [
            // Day header
            h('div', { className: 'qf-fl-dayhead' }, [
              h('div', {
                className: 'pix qf-fl-daybadge',
                dataset: { final: isFinal ? 'true' : 'false' },
              }, `D${day.day}`),
              h('div', {
                className: 'pix qf-fl-daytitle',
                style: { color: isFinal ? 'var(--blood)' : 'var(--text)' },
              }, `DAY ${day.day}${isFinal ? ' · THE FALL' : ''}`),
              h('div', { className: 'qf-fl-dayrule' }),
              h('div', { className: 'pix qf-fl-daycount' },
                `${events.length} EVENTS`),
            ]),
            // Events. Text-color uses the kind's color for high-emphasis
            // beats (mirrors RightPanels' TEXT_COLOR_KINDS treatment) so
            // wins/losses/leaks pop; generic info / phase rows stay
            // text-default so they read as background.
            h('div', { className: 'qf-fl-events' },
              events.map(e => {
                const meta = LOG_KIND_META[e.kind] || LOG_KIND_META.phase
                const isLoot = e.loot && e.loot.startsWith('+')
                const TEXT_COLOR_KINDS = new Set([
                  'kill', 'minion-fell', 'minion-lost', 'damage', 'room-down',
                  'steal', 'wound', 'gold', 'flee', 'level',
                  'trap', 'leak', 'veteran',
                  'pact', 'event', 'spawn',
                  'day-phase', 'night-phase',
                  'boss-fight', 'ability', 'death', 'end',
                ])
                const isColored = TEXT_COLOR_KINDS.has(e.kind)
                return h('div', { className: 'qf-fl-line' }, [
                  h('span', { className: 'pix qf-fl-time' }, e.t),
                  h('span', {
                    className: 'pix qf-fl-glyph',
                    style: { color: meta.c, textShadow: `0 0 4px ${meta.c}` },
                  }, meta.glyph),
                  h('span', {
                    className: 'qf-fl-text',
                    style: {
                      color: isColored ? meta.c : 'var(--text)',
                      fontStyle: e.kind === 'end' ? 'italic' : 'normal',
                      letterSpacing: e.kind === 'end' ? '3px' : '0',
                    },
                  }, e.text),
                  e.loot && h('span', {
                    className: 'pix qf-fl-loot',
                    style: {
                      color: isLoot ? 'var(--gold-bright)' : 'var(--text-mute)',
                      background: isLoot ? 'rgba(212,166,72,0.12)' : 'transparent',
                      borderColor: isLoot ? 'var(--gold)' : 'var(--line-2)',
                    },
                  }, e.loot),
                ])
              })
            ),
          ])
        }),
      ]),
      // Footer
      h('div', { className: 'pix qf-fl-footer' }, [
        h('span', null, `${totalEvents} EVENTS · ${log.length} DAYS`),
        h('span', null, 'SCROLL · ESC TO CLOSE'),
      ]),
    ])
  }

  destroy() {
    this.close()
  }
}

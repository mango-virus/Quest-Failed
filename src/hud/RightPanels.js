// RightPanels — DOM port of the design's right HUD column.
//
// Stacks three panels:
//   1. IncomingWave   — preview of tomorrow's adventurers (night-only).
//                       The current game doesn't expose a pre-spawn party
//                       preview, so this renders a "WAVE UNKNOWN" stub
//                       sourced from intel exposure. Real data wires up
//                       when (if) a scheduled-wave field lands in
//                       gameState — at that point only this panel's data
//                       function needs updating.
//   2. AdventurerIntel — exposure % bar + room-by-room leak list. Same
//                       contract as the existing KnowledgePin: reads
//                       gameState.knowledge.sharedPool.
//   3. DungeonLog     — chronological event feed. Listens to the same
//                       EventBus events the Phaser DungeonLog does:
//                       ADVENTURER_ENTERED_DUNGEON, ADVENTURER_DIED,
//                       ADVENTURER_FLED, MINION_DIED, TRAP_TRIGGERED,
//                       PACT_SEALED, BOSS_LEVELED_UP, phase changes.
//                       Maps each onto the design's 7 kind glyphs
//                       (info/kill/gold/leak/pact/level/spawn).

import { h, mount } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { adventurerDisplayLevel } from '../config/balance.js'
import { pixelSprite } from './sprites.js'
import { snapshotAdventurer } from './inGameSnapshot.js'

// AI-side `ADVENTURER_FLED` events carry a `reason` code that's useful
// for systems but reads as dev jargon in the player-facing log
// ("goal_unreachable", "coward_panic", etc.). This map translates each
// internal reason to a thematic one-line story beat. The full message
// is built with the adventurer's name interpolated — using a function
// per reason keeps the grammar natural ("Lyra panics and flees!" vs.
// "Lyra fled — coward_panic.").
const FLEE_REASON_FLAVOR = {
  // ── Path / goal failures ────────────────────────────────────────
  goal_unreachable:    n => `${n} can't find a way through and flees the dungeon!`,
  oscillation:         n => `${n} loses their nerve and bolts for the exit!`,
  tour_complete:       n => `${n} has mapped enough — they head for home.`,

  // ── HP / morale ─────────────────────────────────────────────────
  low_hp_retreat:      n => `${n} is gravely wounded and retreats!`,
  coward_panic:        n => `${n} panics and runs!`,
  out_of_arrows:       n => `${n} is out of arrows and falls back!`,
  whisperer_panic:     n => `${n} hears the whispers and flees in terror!`,
  traumatized_panic:   n => `${n} is broken by what they've seen and flees!`,
  raid_leader_dead:    n => `${n}'s raid leader fell — they scatter!`,
  panic_witnessed_death: n => `${n} watched an ally die and breaks ranks!`,

  // ── Boss-room consequences ──────────────────────────────────────
  boss_defeated:       n => `${n} flees from the boss chamber in awe!`,
  fled_from_boss:      n => `${n} loses their nerve before the boss and flees!`,
  rival_boss_defeated: n => `${n} sees their rival boss fall — they retreat!`,
  rival_squad_scatter: n => `${n}'s squad shatters and scatters into the dungeon!`,

  // ── Archetype-driven ────────────────────────────────────────────
  phylactery_gone:           n => `${n} senses your phylactery is unguarded and flees to report.`,
  phylactery_destroyed:      n => `${n} sees the phylactery destroyed and breaks for the exit!`,
  wraith_fear_window_ended:  n => `${n} comes to their senses and flees the dread!`,

  // ── Loot escape ─────────────────────────────────────────────────
  treasure_escape:     n => `${n} grabs the loot and bolts for the exit!`,
}

function _fleeReasonFlavor(reason, name) {
  const fn = reason && FLEE_REASON_FLAVOR[reason]
  if (fn) return fn(name)
  // Unknown reason — fall back to a generic flavor line that still
  // reads as story, not as a dev code dump.
  return `${name} loses their nerve and flees!`
}
import { FullLogOverlay } from './FullLogOverlay.js'

// Tiny seeded PRNG (mulberry32). Used to produce a deterministic party
// preview that stays stable across re-renders within the same day —
// avoids the preview "rolling" every time the panel re-rebuilds.
function _mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Adventurer-class → sprite-kind alias map. The base `spriteKindForDefId`
// only knows minion families and falls back to 'gnoll' for anything
// unknown, which makes every non-knight/monk/cleric adventurer appear
// as a gnoll. Map adventurer classes to the closest available sprite
// grid so they at least read as human/civilized rather than monsters.
const ADV_SPRITE = {
  knight:       'knight',
  paladin:      'knight',
  barbarian:    'knight',
  monk:         'monk',
  cleric:       'cleric',
  bard:         'cleric',
  druid:        'cleric',
  mage:         'cleric',     // robed caster — closest to cleric silhouette
  necromancer:  'cleric',
  ranger:       'knight',
  rogue:        'knight',
  beast_master: 'knight',
  twitch_streamer: 'knight',
  cosplay_adventurer: 'knight',
  // Event-replacement classes — distinct sprites so the preview reads
  // immediately as "this is a special wave, not normal adventurers".
  loot_goblin:          'hyena',    // monster-ish silhouette for goblins
  cartographer_scholar: 'cleric',   // robed scholar
  tournament_rival_warrior: 'knight',
  tournament_rival_rogue:   'knight',
  tournament_rival_mage:    'cleric',
  monster_invader:    'imp',
  rival_boss_invader: 'lich',       // ominous robed silhouette
}
function _advKind(classId) {
  if (!classId) return 'knight'
  const id = String(classId).toLowerCase()
  return ADV_SPRITE[id] || 'knight'
}

const LOG_KINDS = {
  // Player-perspective color coding. Every meaningful kind has its own
  // color so the log reads at a glance; only generic system-info rows
  // stay text-mute. Categories:
  //   GREEN  (poison)      = WIN — boss killed an adventurer
  //   RED    (blood)       = LOSS — minion died, room damaged, gold stolen
  //   BRT-RED (blood-glow) = BOSS FIGHT — special combat moment
  //   GOLD   (gold)        = GAINS — gold awarded, adv fled with loot
  //   BRT-GOLD             = MILESTONE — boss leveled up
  //   ORANGE (warn)        = WARNING — trap fired, intel leaked
  //   CYAN   (rumor)       = ARRIVAL / NIGHT — adv entered, night begins
  //   AMBER  (gold)        = DAY START — wave-incoming alarm
  //   LT-CYAN              = ABILITY — class ability triggered
  //   PURPLE (info)        = PACT — dark pact sealed
  //   DIM    (text-mute)   = generic system info
  info:        { color: 'var(--text-mute)', glyph: '◇' },

  // ── Wins / kills ───────────────────────────────────────────────
  // ADVENTURER_DIED — boss killed an adventurer (player wins).
  kill:        { color: 'var(--poison)',    glyph: '☠' },

  // ── Losses ─────────────────────────────────────────────────────
  'minion-lost': { color: 'var(--blood)',   glyph: '✦' },
  damage:        { color: 'var(--blood)',   glyph: '⚠' },
  'room-down':   { color: 'var(--blood)',   glyph: '✕' },
  steal:         { color: 'var(--blood)',   glyph: '◐' },

  // ── Gains ──────────────────────────────────────────────────────
  gold:        { color: 'var(--gold)',      glyph: '◐' },
  flee:        { color: 'var(--gold)',      glyph: '↗' },

  // ── Milestones ─────────────────────────────────────────────────
  level:       { color: 'var(--gold-bright, #ffe488)', glyph: '★' },

  // ── Warnings ───────────────────────────────────────────────────
  trap:        { color: 'var(--warn)',      glyph: '▲' },
  leak:        { color: 'var(--warn)',      glyph: '⚠' },
  veteran:     { color: 'var(--warn)',      glyph: '⚑' },

  // ── Pacts ──────────────────────────────────────────────────────
  pact:        { color: 'var(--info)',      glyph: '▣' },

  // ── Arrivals — unique color so adventurer entries stand out from
  //    every other beat (the cyan-rumor used to collide with
  //    night-phase rows). Soft violet reads as "new soul arriving". ─
  spawn:       { color: '#c39bff',          glyph: '↘' },

  // ── Phase transitions — day BEGAN and ENDED share the amber-gold
  //    so the rhythm "day starts ... day ends" reads consistently;
  //    night gets its own muted steel-blue so it sits between gold
  //    and the spawn-violet without colliding with either. ────────
  'day-phase':   { color: 'var(--gold)',    glyph: '☀' },
  'night-phase': { color: '#7a93c4',        glyph: '☾' },

  // ── Boss fight ─────────────────────────────────────────────────
  'boss-fight':  { color: 'var(--blood-glow, #ff7777)', glyph: '⚔' },

  // ── Class ability (used when ABILITY_TRIGGERED carries a message) ─
  ability:     { color: '#a8e8e8',          glyph: '◆' },

  // ── Dungeon event announcement ────────────────────────────────
  event:       { color: 'var(--info)',      glyph: '◈' },
}
const LOG_MAX = 200

export class RightPanels {
  constructor(gameState) {
    this._gameState = gameState
    this._listeners = []
    this._logRows = []   // { text, kind }

    this.el = this._build()
    this._wireEvents()
    this._renderIntel()
    this._renderWave()
    this._tickHandle = requestAnimationFrame(() => this._tick())
  }

  _build() {
    this._refs = {}
    const root = h('div', {
      className: 'qf-rightpanels',
      ref: el => { this._refs.root = el },
    }, [
      // IncomingWave
      h('div', {
        className: 'panel bevel qf-wavepanel',
        ref: el => { this._refs.wavePanel = el },
      }, [
        h('div', { className: 'panel-head' }, [
          h('div', { className: 'title' }, [
            h('span', {
              className: 'diamond',
              style: { background: 'var(--blood)', boxShadow: '0 0 6px var(--blood)' },
            }),
            'INCOMING WAVE',
          ]),
        ]),
        h('div', {
          className: 'qf-wave-body',
          ref: el => { this._refs.waveBody = el },
        }),
      ]),

      // AdventurerIntel
      h('div', { className: 'panel bevel qf-intelpanel' }, [
        h('div', { className: 'panel-head' }, [
          h('div', { className: 'title' }, [
            h('span', {
              className: 'diamond',
              style: { background: 'var(--info)', boxShadow: '0 0 6px var(--info)' },
            }),
            'ADVENTURER INTEL',
          ]),
          h('div', {
            className: 'meta up qf-intel-leakcount',
            ref: el => { this._refs.leakCount = el },
          }, 'NO LEAKS'),
        ]),
        h('div', {
          className: 'qf-intel-body',
          ref: el => { this._refs.intelBody = el },
        }),
      ]),

      // DungeonLog — header is clickable to open the full-run log
      // overlay (same FullLogOverlay PostWaveOverlay + PauseOverlay use).
      h('div', { className: 'panel bevel qf-logpanel' }, [
        h('div', {
          className: 'panel-head qf-logpanel-head',
          style: { cursor: 'pointer' },
          title: 'Open full dungeon log',
          on: { click: () => this._openFullLog() },
        }, [
          h('div', { className: 'title' }, [
            h('span', {
              className: 'diamond',
              style: { background: 'var(--warn)', boxShadow: '0 0 6px var(--warn)' },
            }),
            'DUNGEON LOG',
          ]),
          h('div', { className: 'meta qf-log-meta' }, [
            h('span', {
              className: 'qf-log-live',
              style: { color: 'var(--blood)' },
            }, [
              h('span', {
                className: 'blink',
                style: {
                  width: '6px', height: '6px', background: 'var(--blood)',
                  boxShadow: '0 0 6px var(--blood)', display: 'inline-block',
                },
              }),
              ' LIVE',
            ]),
          ]),
        ]),
        h('div', {
          className: 'qf-log-body',
          ref: el => { this._refs.logBody = el },
        }, [
          h('div', { className: 'qf-log-rail' }),
        ]),
      ]),
    ])
    return root
  }

  // ── IncomingWave ────────────────────────────────────────────────
  // Forecasts the next day's wave size + threat using the same formula
  // DayPhase._spawnDailyAdventurers uses. Class breakdown isn't computed
  // here (DayPhase picks classes at spawn time, not in advance); the
  // panel shows count + threat as a "best-effort" preview.
  _renderWave() {
    const body = this._refs.waveBody
    if (!body) return
    const forecast = this._forecastWave()
    if (!forecast) {
      mount(body, h('div', { className: 'qf-wave-stub' }, [
        h('div', { className: 'pix qf-wave-stub-label' }, 'PARTY · UNKNOWN'),
        h('div', { className: 'qf-wave-stub-flavor' },
          '"Listen for boots on the stair."'),
      ]))
      return
    }
    const tierColor =
      forecast.threatPct >= 80 ? 'var(--blood)' :
      forecast.threatPct >= 55 ? 'var(--warn)' :
      forecast.threatPct >= 30 ? 'var(--gold)' : 'var(--poison)'
    const tierLabel =
      forecast.threatPct >= 80 ? 'CRITICAL' :
      forecast.threatPct >= 55 ? 'HIGH' :
      forecast.threatPct >= 30 ? 'MODERATE' : 'LOW'
    mount(body, [
      // PartyRow — design pattern: ≤3 → static grid, >3 → conveyor scroll.
      this._renderPartyRow(forecast.party),
      // ThreatMeter — segmented VU-style indicator with tier labels under.
      h('div', { className: 'qf-wave-threat' }, [
        h('div', { className: 'qf-wave-threat-head' }, [
          h('span', {
            className: 'pix qf-wave-threat-label',
            style: { color: 'var(--text-mute)' },
          }, 'THREAT'),
          h('span', {
            className: 'pix qf-wave-threat-tier',
            style: { color: tierColor },
          }, tierLabel),
        ]),
        this._renderThreatMeter(forecast.threatPct),
      ]),
      // Notes / leaked intel
      forecast.notes.length > 0 && h('div', { className: 'qf-wave-notes' },
        forecast.notes.map(n => h('div', { className: 'qf-wave-note' }, [
          h('span', { className: 'qf-wave-note-glyph' }, '⚠'),
          h('span', null, n),
        ]))
      ),
    ])
  }

  // PartyRow — direct port of the design's `PartyRow`. Static grid when
  // ≤3 adventurers, conveyor-belt scroll when >3. The conveyor duplicates
  // the list so the CSS animation loops seamlessly.
  _renderPartyRow(party) {
    const VISIBLE = 3
    if (!party || party.length === 0) {
      return h('div', { className: 'qf-wave-party-empty' }, [
        h('div', { className: 'pix qf-wave-party-empty-label' }, 'PARTY · UNKNOWN'),
      ])
    }
    if (party.length <= VISIBLE) {
      return h('div', { className: 'qf-wave-party qf-wave-party-static' },
        party.map((p, i) => this._renderPartyTile(p, i))
      )
    }
    // Conveyor-belt: duplicate so the scroll wraps without gaps.
    const looped = [...party, ...party]
    // ~60px per tile travelled at the design's "PX_PER_SEC = 24" target.
    const durationSec = Math.max(8, (party.length * 60) / 24)
    return h('div', { className: 'qf-wave-party-wrap' }, [
      h('div', { className: 'qf-wave-party-mask' }, [
        h('div', {
          className: 'qf-wave-party-conveyor',
          style: {
            width: `${(looped.length / VISIBLE) * 100}%`,
            animationDuration: `${durationSec}s`,
          },
        }, looped.map((p, i) => this._renderPartyTile(p, i % party.length))),
      ]),
    ])
  }

  // `idx` is the adventurer's position in the forecast party — it lines
  // up 1:1 with AdvIntelOverlay's night-phase list (both order
  // [vendettaHunter?, ...preview.classIds]), so clicking a tile opens
  // the Adventurer Intel page focused on that exact adventurer.
  _renderPartyTile(p, idx = 0) {
    // p.kind is the sprite-grid key (knight / cleric / monk / etc.);
    // p.classId is the original adventurer class id used as the visible
    // label so players see real class names ("MAGE", "RANGER") instead
    // of the underlying sprite family.
    const label = String(p.classId || p.kind || '').toUpperCase()
    // Real LPC adventurer sprite from the baked spritesheets — same
    // texture the in-game AdventurerRenderer uses. Falls back to the
    // procedural pixelSprite when the LPC texture isn't loaded yet
    // (cold start, before Preload's adv-* bake finishes). Event /
    // special classes (cosplay_adventurer, cartographer_scholar,
    // tournament_rival_*, loot_goblin, etc.) all bake under their own
    // classId — snapshotAdventurer falls back through to v01 inside
    // the helper if a specific variant isn't loaded.
    // Prefer the pre-rolled "<class>/vNN" variant if NightPhase
    // pre-rolled one — that way the preview shows the EXACT character
    // that will spawn tomorrow, not a generic class placeholder.
    // Falls back to bare classId (snapshotAdventurer defaults to v01)
    // for legacy saves / event-replacement spawns with no pre-roll.
    const advSnap = snapshotAdventurer(p.spriteVariant || p.classId || p.kind, 48)
    const spriteEl = advSnap
      ? (() => {
          advSnap.classList.add('qf-wave-tile-adv')
          return advSnap
        })()
      : pixelSprite(p.kind, 32)
    return h('div', {
      className: 'qf-wave-tile qf-wave-tile-clickable',
      title: `View intel — ${label}`,
      on: { click: () => EventBus.emit('OPEN_ADV_INTEL', { selectIndex: idx }) },
    }, [
      p.veteran ? h('div', {
        className: 'pix qf-wave-tile-vet',
        title: 'Returning veteran',
      }, '★') : null,
      h('div', { className: 'qf-wave-tile-sprite' }, spriteEl),
      h('div', { className: 'pix qf-wave-tile-name' }, label),
      h('div', { className: 'pix qf-wave-tile-lv' }, `LV ${p.lv}`),
    ])
  }

  // 16-segment threat meter (4 tiers × 4 segments each), with peak-segment
  // pulse + tier labels under. Mirrors the design's `ThreatMeter`.
  _renderThreatMeter(pct) {
    const SEGMENTS = 16
    const filled = Math.round((pct / 100) * SEGMENTS)
    const tierColor = (i) =>
      i < 4  ? 'var(--poison)' :
      i < 8  ? 'var(--gold)' :
      i < 12 ? 'var(--warn)'  : 'var(--blood)'
    const tierGlow = (i) =>
      i < 4  ? 'rgba(107, 160, 58, 0.7)' :
      i < 8  ? 'rgba(212, 166, 72, 0.7)' :
      i < 12 ? 'rgba(232, 154, 60, 0.8)' : 'rgba(200, 51, 74, 0.9)'
    const tierLabels = [
      { l: 'LOW',  c: 'var(--poison)' },
      { l: 'MOD',  c: 'var(--gold)' },
      { l: 'HIGH', c: 'var(--warn)' },
      { l: 'CRIT', c: 'var(--blood)' },
    ]
    return h('div', null, [
      h('div', { className: 'qf-wave-meter' },
        Array.from({ length: SEGMENTS }).map((_, i) => {
          const lit = i < filled
          const isPeak = i === filled - 1
          const c = tierColor(i)
          return h('div', {
            className: `qf-wave-meter-seg${lit ? ' lit' : ''}${isPeak ? ' peak' : ''}`,
            style: {
              background: lit ? c : 'var(--bg-1)',
              boxShadow: lit
                ? `inset 0 -1px 0 rgba(0,0,0,0.3), 0 0 ${isPeak ? 8 : 4}px ${tierGlow(i)}`
                : 'inset 0 -1px 0 rgba(0,0,0,0.5)',
              opacity: lit ? 1 : 0.35,
            },
          })
        })
      ),
      h('div', { className: 'qf-wave-meter-tiers' },
        tierLabels.map((t, i) => {
          const active = pct >= [0, 25, 50, 75][i] && pct < [25, 50, 75, 101][i]
          return h('span', {
            className: 'pix qf-wave-meter-tier',
            style: {
              color: active ? t.c : 'var(--text-faint)',
              opacity: active ? 1 : 0.5,
            },
          }, t.l)
        })
      ),
    ])
  }

  // Light-weight forecast — mirrors the simple parts of DayPhase's
  // wave-size formula. Doesn't compute classes (those are picked at
  // spawn time). Returns null if we can't peek at gameState yet.
  _forecastWave() {
    const gs = this._gameState
    if (!gs?.meta) return null
    // Wave-forecast targets the NEXT day. During night phase the next
    // day is `meta.dayNumber` (count hasn't bumped yet); during day
    // phase it's `meta.dayNumber + 1` (already started).
    const phase = gs.meta?.phase
    const nextDay = (gs.meta.dayNumber ?? 1) + (phase === 'day' ? 1 : 0)
    const ADV_BASE = 2   // mirrors Balance.ADVENTURERS_PER_DAY_BASE default
    let count = ADV_BASE + Math.floor((nextDay - 1) / 2)
    const notes = []
    // Treasury rooms each add an adventurer (DayPhase formula).
    const treasuries = (gs.dungeon?.rooms ?? [])
      .filter(r => r.definitionId === 'treasury' && r.isActive !== false).length
    if (treasuries > 0) {
      count += treasuries
      notes.push(`${treasuries} treasury room${treasuries === 1 ? '' : 's'} — extra adventurers`)
    }
    // Gold Rush pact adds +1 / day.
    if ((gs._mechanicFlags ?? {}).goldRush) {
      count += 1
      notes.push('Gold Rush — +1 adventurer')
    }
    // Guild Raid doubles count.
    if ((gs._eventFlags ?? {}).guildRaidActive) {
      count *= 2
      notes.push('GUILD RAID — doubled wave')
    }
    // Threat % — heuristic. Day number + boss level scale up; mechanic
    // flags add on top.
    const bossLv = gs.boss?.level ?? 1
    const dayFactor = Math.min(60, nextDay * 5)
    const lvFactor  = Math.min(30, (bossLv - 1) * 8)
    const flagBoost = ((gs._eventFlags ?? {}).guildRaidActive ? 20 : 0)
                    + ((gs._eventFlags ?? {}).legendarySpeedrunnerActive ? 30 : 0)
    const threatPct = Math.max(0, Math.min(100, dayFactor + lvFactor + flagBoost))
    const party = this._forecastParty(count, nextDay, bossLv)
    // Prefer the authoritative pre-roll count so the pill/badge matches
    // the party tiles. The fallback `count` was a best-effort forecast.
    // Add +1 when a vendetta hunter is pre-rolled to appear alongside.
    const preview = gs.run?.nextWavePreview
    let finalCount = count
    if (preview && preview.day === nextDay && typeof preview.count === 'number') {
      finalCount = preview.count + (preview.vendettaHunter ? 1 : 0)
    }
    return { count: finalCount, threatPct, notes, party }
  }

  // Build the party preview from the authoritative pre-roll that
  // NightPhase._rollNextWavePreview persists on
  // `gameState.run.nextWavePreview` (and that DayPhase._spawnDailyAdventurers
  // consumes at day start). The preview shows EXACTLY the classes that
  // will spawn — including event-replacement waves and the vendetta
  // hunter when one has been pre-rolled to appear.
  _forecastParty(_count, dayNum, bossLv) {
    const preview = this._gameState.run?.nextWavePreview
    if (!preview || preview.day !== dayNum || !Array.isArray(preview.classIds)) {
      return []
    }
    // Library of Whispers is the gating room for adventurer intel.
    // Without one placed, the player gets the threat meter + count
    // but NOT the per-adv class breakdown / sprites. Placing a Library
    // unlocks the full party preview. (Future tiers — personalities at
    // L6, stats at L8, route at L10 — layer on this same gate.)
    const hasLibrary = (this._gameState.dungeon?.rooms ?? [])
      .some(r => r.definitionId === 'library_of_whispers' && r.isActive !== false)
    if (!hasLibrary) {
      // Empty party array → _renderPartyRow falls into "PARTY ·
      // UNKNOWN" stub treatment naturally. Threat meter + count still
      // render so the player isn't blind, they just don't know which
      // classes are coming.
      return []
    }
    // Display level of this wave — the same value DayPhase stamps on
    // each adventurer at spawn, so the preview matches what arrives.
    const waveLevel = adventurerDisplayLevel(
      bossLv, dayNum,
      this._gameState?._mechanicFlags?.bloodMoneyHpBonus ?? 0,
    )
    const rand = _mulberry32((dayNum * 7919) ^ (bossLv * 31))
    const knownByClass = new Map()
    for (const k of (this._gameState.adventurers?.known ?? [])) {
      if ((k.escapeCount ?? 0) > 0 && k.classId) {
        knownByClass.set(k.classId, true)
      }
    }
    // Vendetta hunter (when present) is rendered FIRST with the veteran
    // star — they're a returning enemy and their slot is fixed.
    const party = []
    if (preview.vendettaHunter?.claimantClass) {
      party.push({
        kind:    _advKind(preview.vendettaHunter.claimantClass),
        classId: preview.vendettaHunter.claimantClass,
        // Pre-rolled variant from NightPhase so the preview shows the
        // exact sprite that spawns. Falls back to undefined → v01.
        spriteVariant: preview.vendettaHunter.spriteVariant ?? null,
        lv:      waveLevel,
        veteran: true,
      })
    }
    const variantList = Array.isArray(preview.spriteVariants) ? preview.spriteVariants : []
    for (let i = 0; i < preview.classIds.length; i++) {
      const id = preview.classIds[i]
      party.push({
        kind:    _advKind(id),
        classId: id,
        spriteVariant: variantList[i] ?? null,
        lv:      waveLevel,
        veteran: knownByClass.has(id) && rand() < 0.15,
      })
    }
    return party
  }

  // Pull adventurerClasses from any Phaser scene's JSON cache and apply
  // the same unlock-gate filter DayPhase uses.
  _eligibleClasses(dayNum, bossLv) {
    const scenes = window.__game?.scene?.scenes ?? []
    let allClasses = []
    for (const s of scenes) {
      const arr = s.cache?.json?.get?.('adventurerClasses')
      if (Array.isArray(arr) && arr.length) { allClasses = arr; break }
    }
    return allClasses.filter(c =>
      (c.unlockLevel ?? 1) <= bossLv &&
      (c.unlockDay   ?? 1) <= dayNum,
    )
  }

  // ── AdventurerIntel ─────────────────────────────────────────────
  // Mirrors KnowledgePin._topFacts. Pulls leaked rooms / traps / enemies
  // from gameState.knowledge.sharedPool, resolves instance IDs to display
  // names via the Phaser JSON cache, and shows exposure %.
  _renderIntel() {
    const body = this._refs.intelBody
    if (!body) return
    const facts = this._topFacts()
    const exposure = this._exposurePct()
    const leakCount = facts.length
    if (this._refs.leakCount) {
      this._refs.leakCount.textContent = leakCount === 0
        ? 'NO LEAKS'
        : `${leakCount} LEAK${leakCount === 1 ? '' : 'S'}`
      this._refs.leakCount.style.color =
        leakCount > 0 ? 'var(--warn)' : 'var(--rumor)'
    }
    const rows = facts.length > 0
      ? facts.map(f => h('div', { className: 'qf-intel-row' }, [
          h('span', { className: 'qf-intel-name' }, f.label),
          h('span', {
            className: 'pix qf-intel-lvl',
            style: { color:
              f.lvl === 'FULL' ? 'var(--blood)' :
              f.lvl === 'PARTIAL' ? 'var(--warn)' : 'var(--rumor)' },
          }, f.lvl),
        ]))
      : Array.from({ length: 6 }, () => h('div', {
          className: 'qf-intel-row qf-intel-empty',
        }, '—'))

    mount(body, [
      ...rows,
      h('div', { className: 'qf-intel-exposure' }, [
        h('div', { className: 'qf-intel-exposure-row' }, [
          h('span', { className: 'pix', style: { color: 'var(--text-mute)' } }, 'EXPOSURE'),
          h('span', {
            className: 'pix',
            style: { color:
              exposure > 70 ? 'var(--blood)' :
              exposure > 30 ? 'var(--warn)' : 'var(--rumor)' },
          }, `${exposure}%`),
        ]),
        h('div', { className: 'bar exposure thin' }, [
          h('div', { className: 'fill', style: { width: `${exposure}%` } }),
        ]),
      ]),
    ])
  }

  _topFacts() {
    const pool   = this._gameState.knowledge?.sharedPool ?? {}
    const rooms  = this._gameState.dungeon?.rooms ?? []
    const traps  = this._gameState.dungeon?.traps ?? []
    const game = window.__game
    const scenes = game?.scene?.scenes || []
    const cached = (key) => {
      for (const s of scenes) {
        const v = s.cache?.json?.get?.(key)
        if (Array.isArray(v)) return v
      }
      return []
    }
    const roomDefs = cached('rooms')
    const trapDefs = cached('trapTypes')
    const lookupRoomName = (instanceId) => {
      const r = rooms.find(x => x.instanceId === instanceId)
      const d = roomDefs.find(x => x.id === r?.definitionId)
      return d?.name ?? r?.definitionId ?? instanceId
    }
    const lookupTrapName = (instanceId) => {
      const t = traps.find(x => x.instanceId === instanceId)
      const d = trapDefs.find(x => x.id === t?.definitionId)
      return d?.name ?? t?.definitionId ?? instanceId
    }
    const out = []
    for (const k of Object.keys(pool.rooms ?? {})) {
      out.push({ label: lookupRoomName(k), lvl: this._levelFor(pool.rooms[k]) })
    }
    for (const k of Object.keys(pool.traps ?? {})) {
      out.push({ label: lookupTrapName(k), lvl: this._levelFor(pool.traps[k]) })
    }
    for (const k of Object.keys(pool.enemiesPerRoom ?? {})) {
      out.push({ label: `Enemies in ${lookupRoomName(k)}`, lvl: this._levelFor(pool.enemiesPerRoom[k]) })
    }
    const seen = new Set()
    const uniq = []
    for (const f of out) {
      if (seen.has(f.label)) continue
      seen.add(f.label)
      uniq.push(f)
    }
    const order = { FULL: 0, PARTIAL: 1, RUMOR: 2 }
    uniq.sort((a, b) => (order[a.lvl] ?? 9) - (order[b.lvl] ?? 9))
    return uniq.slice(0, 8)
  }

  _levelFor(entry) {
    if (entry == null) return 'RUMOR'
    if (entry === true) return 'FULL'
    const acc = entry.accuracy ?? entry.level ?? entry
    if (typeof acc === 'number') {
      if (acc >= 0.7) return 'FULL'
      if (acc >= 0.3) return 'PARTIAL'
      return 'RUMOR'
    }
    return 'PARTIAL'
  }

  _exposurePct() {
    const pool   = this._gameState.knowledge?.sharedPool ?? {}
    const known  = (pool.rooms ? Object.keys(pool.rooms).length : 0)
                 + (pool.traps ? Object.keys(pool.traps).length : 0)
    const total  = Math.max(1, (this._gameState.dungeon?.rooms?.length ?? 0)
                              + (this._gameState.dungeon?.traps?.length ?? 0))
    return Math.min(100, Math.round((known / total) * 100))
  }

  // ── DungeonLog ──────────────────────────────────────────────────
  _addLog(text, kind = 'info') {
    this._logRows.push({ text, kind })
    if (this._logRows.length > LOG_MAX) this._logRows.shift()
    this._renderLog()
  }

  _renderLog() {
    const body = this._refs.logBody
    if (!body) return
    // Keep the rail element; replace just the row list.
    const rows = this._logRows.map((row, idx) => {
      const meta = LOG_KINDS[row.kind] || LOG_KINDS.info
      const isRecent = idx >= this._logRows.length - 3
      // Color the row TEXT (not just glyph) for every meaningful kind.
      // Only generic `info` rows fall back to the default text color,
      // so the log feels varied instead of mostly-white. Mirrors the
      // original DungeonLog's full-color-row treatment.
      const TEXT_COLOR_KINDS = new Set([
        'kill', 'minion-lost', 'damage', 'room-down', 'steal',
        'gold', 'flee', 'level',
        'trap', 'leak', 'veteran',
        'pact', 'spawn',
        'day-phase', 'night-phase',
        'boss-fight', 'ability', 'event',
      ])
      return h('div', {
        className: 'log-row qf-log-row',
        style: { opacity: isRecent ? 1 : 0.72 },
      }, [
        h('span', {
          className: 'pix qf-log-glyph',
          style: { color: meta.color, textShadow: `0 0 4px ${meta.color}` },
        }, meta.glyph),
        h('span', {
          className: 'qf-log-text',
          style: { color: TEXT_COLOR_KINDS.has(row.kind) ? meta.color : 'var(--text)' },
        }, row.text),
      ])
    })
    // Keep rail (first child) intact; just replace rows after it.
    body.replaceChildren(h('div', { className: 'qf-log-rail' }), ...rows)
    // Scroll to bottom
    body.scrollTop = body.scrollHeight
  }

  // ── Events ──────────────────────────────────────────────────────
  _wireEvents() {
    const sub = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    sub('ADVENTURER_ENTERED_DUNGEON', ({ adventurer }) => {
      const cls  = adventurer?.className || adventurer?.classId || 'Adventurer'
      const name = adventurer?.name || 'Unnamed'
      this._addLog(`${name} (${cls}) entered the dungeon.`, 'spawn')
    })
    sub('ADVENTURER_DIED', ({ adventurer, killerName }) => {
      const name = adventurer?.name || 'Adventurer'
      const k = killerName ? ` by ${killerName}` : ''
      this._addLog(`${name} slain${k}.`, 'kill')
    })
    sub('ADVENTURER_FLED', ({ adventurer, reason }) => {
      const name = adventurer?.name || 'Adventurer'
      // Flee is gold-colored "partial win" in the original scheme — they
      // got away but dropped gold and leaked intel. Not red (kill) and
      // not bare-orange (leak) — its own tier.
      // Reason gets translated to player-facing flavor text via
      // FLEE_REASON_FLAVOR so the log reads as story instead of
      // exposing internal AI dev codes ("goal_unreachable" etc.).
      const flavor = _fleeReasonFlavor(reason, name)
      this._addLog(flavor, 'flee')
      this._renderIntel()   // a flee usually leaks intel
    })
    sub('MINION_DIED', ({ minion }) => {
      const name = minion?.name || minion?.type || 'Minion'
      // Minion loss is the player-NEGATIVE counterpart to ADVENTURER_DIED
      // — the original DungeonLog drew this in blood-red while adventurer
      // kills were green. New 'minion-lost' kind preserves that contrast.
      this._addLog(`${name} fell.`, 'minion-lost')
    })
    sub('TRAP_TRIGGERED', ({ def, adventurer, damage }) => {
      const tn = def?.name || 'Trap'
      const an = adventurer?.name || 'an adventurer'
      const d  = damage != null ? ` (${damage} dmg)` : ''
      // Traps get the warn-orange "action beat" color, matching the
      // original DungeonLog (was previously dropping into the
      // text-mute info color, which made them disappear visually).
      this._addLog(`${tn} hits ${an}${d}.`, 'trap')
    })
    sub('PACT_SEALED', ({ mechanicId, rarity }) => {
      const tag = rarity ? rarity.toUpperCase() : 'PACT'
      this._addLog(`${tag} pact sealed: ${mechanicId}.`, 'pact')
    })
    sub('BOSS_LEVELED_UP', ({ toLevel }) => {
      this._addLog(`The boss ascends — level ${toLevel || '?'}.`, 'level')
    })
    sub('DAY_PHASE_BEGAN',   () => this._addLog('Day phase begins — the invasion.', 'day-phase'))
    // Both day-begin and day-end share the same gold/amber color — they
    // bracket the same "day cycle" beat. Don't reuse night-phase here.
    sub('DAY_PHASE_ENDED',   () => this._addLog('Day phase ends — the dust settles.', 'day-phase'))
    sub('NIGHT_PHASE_BEGAN', () => {
      this._addLog('Night phase — build undisturbed.', 'night-phase')
      // Re-render the wave panel — NightPhase.create() has just pre-
      // rolled the next day's wave on `gameState.run.nextWavePreview`,
      // and the IncomingWave panel reads from that.
      this._renderWave()
    })
    // NightPhase re-rolls the preview on PACT_SEALED / ROOM_PLACED /
    // ROOM_REMOVED / DUNGEON_EVENT_ANNOUNCED and emits this event so
    // we stay in sync without subscribing to every trigger ourselves.
    sub('WAVE_PREVIEW_UPDATED', () => this._renderWave())

    // ── Additional event coverage ──────────────────────────────────
    // Room loss — distinct from minion loss, gets its own glyph.
    sub('ROOM_DAMAGED', ({ roomName }) => {
      this._addLog(`${roomName || 'A room'} damaged.`, 'damage')
    })
    sub('ROOM_DESTROYED', ({ roomName }) => {
      this._addLog(`${roomName || 'A room'} destroyed.`, 'room-down')
    })
    // Boss fight — bright-red beats so the boss-room moment stands out.
    sub('BOSS_FIGHT_STARTED', () => {
      this._addLog('Boss fight — defend the throne!', 'boss-fight')
    })
    sub('BOSS_FIGHT_RESOLVED', ({ winner } = {}) => {
      this._addLog(
        winner === 'party' ? 'You lost a life.' : 'Intruder repelled.',
        winner === 'party' ? 'damage' : 'kill',
      )
    })
    // Veteran / vendetta / legendary returners — all warn-orange.
    sub('VETERAN_APPROACHING', ({ adventurer } = {}) => {
      const n = adventurer?.name || 'A returning adventurer'
      this._addLog(`${n} returns to the dungeon.`, 'veteran')
    })
    sub('VENDETTA_HUNTER_ARRIVED', ({ adventurer } = {}) => {
      const n = adventurer?.name || 'A vendetta hunter'
      this._addLog(`${n} comes for revenge.`, 'veteran')
    })
    sub('LEGENDARY_HERO_ARRIVED', ({ adventurer } = {}) => {
      const n = adventurer?.name || 'A legendary hero'
      this._addLog(`★ ${n} arrives.`, 'veteran')
    })
    // Intel leaks — flee already covers most, but explicit emit can fire too.
    sub('INTEL_LEAKED', ({ roomName } = {}) => {
      this._addLog(`Intel leaked${roomName ? ` — ${roomName}` : ''}.`, 'leak')
    })
    // Gold steal — loot goblin escaped with gold.
    sub('LOOT_GOBLIN_ESCAPED', ({ stolen, adventurer } = {}) => {
      const amt = stolen ?? '?'
      const who = adventurer?.name || 'A goblin'
      this._addLog(`${who} escaped with ${amt}g stolen.`, 'steal')
    })
    // Class abilities — only log when the payload carries a message so we
    // don't spam the log with every passive aura tick.
    sub('ABILITY_TRIGGERED', ({ message } = {}) => {
      if (!message) return
      this._addLog(message, 'ability')
    })
    // Dungeon event announcement (boss-tier "something's coming" beat).
    sub('DUNGEON_EVENT_ANNOUNCED', ({ def } = {}) => {
      if (!def) return
      this._addLog(`${def.title || 'Dungeon event'} announced.`, 'event')
    })
    // Intel events that should refresh the panel
    sub('INTEL_LEAKED', () => this._renderIntel())
    sub('KNOWLEDGE_LEAK_FROM_FLEE', () => this._renderIntel())
  }

  _tick() {
    // Cheap pass: re-evaluate exposure occasionally — every ~1s is fine
    // since the panel mostly redraws on events.
    const now = performance.now()
    if (!this._lastIntelTick || now - this._lastIntelTick > 1000) {
      this._lastIntelTick = now
      // Only re-render if facts changed (signature compare)
      const sig = JSON.stringify({
        rooms: Object.keys(this._gameState.knowledge?.sharedPool?.rooms ?? {}).sort(),
        traps: Object.keys(this._gameState.knowledge?.sharedPool?.traps ?? {}).sort(),
        per:   Object.keys(this._gameState.knowledge?.sharedPool?.enemiesPerRoom ?? {}).sort(),
        roomsN: this._gameState.dungeon?.rooms?.length ?? 0,
      })
      if (sig !== this._intelSig) { this._intelSig = sig; this._renderIntel() }
    }
    this._tickHandle = requestAnimationFrame(() => this._tick())
  }

  setVisible(v) {
    if (this._refs.root) this._refs.root.style.display = v ? '' : 'none'
  }

  // Hide the wave panel during day phase — HudRoot calls this on phase events.
  setWaveVisible(v) {
    if (this._refs.wavePanel) this._refs.wavePanel.style.display = v ? '' : 'none'
  }

  // Open the full-run dungeon log overlay (shared with PostWaveOverlay
  // and PauseOverlay). Singleton per RightPanels instance — re-clicks
  // while one is open are a no-op.
  _openFullLog() {
    if (this._fullLog) return
    this._fullLog = new FullLogOverlay(this._gameState, {
      onClose: () => { this._fullLog = null },
    })
    this._fullLog.open()
  }

  destroy() {
    if (this._tickHandle) cancelAnimationFrame(this._tickHandle)
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this._fullLog?.close()
    this._fullLog = null
    this.el?.remove()
  }
}

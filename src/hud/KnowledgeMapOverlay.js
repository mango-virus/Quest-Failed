// KnowledgeMapOverlay — DOM port of the design's Knowledge Map popup
// (overlays.jsx → KnowledgeMapOverlay).
//
// Summary strip: EXPOSURE % + delta + 7-day sparkline, ROOMS LEAKED,
// INTEL ENTRIES (+ "N fresh today"), LAST LEAK.
//
// Left pane: DUNGEON BLUEPRINT with zoom (− / ◇ / +) + click-drag pan
// (when zoomed > 100%) + animated scan line. Rooms tinted by intel
// state (FULL red / PARTIAL orange / RUMOR cyan / UNKNOWN dashed grey),
// fresh-leak rooms pulse. Click any room to filter the right-pane
// ledger to just that room. Below: 4-state legend.
//
// Right pane: INTEL LEDGER. Per-room cards with leak source attribution
// (class sprite + adv name + day), mitigation hint, SCRUB INTEL button
// with gold cost.
//
// Data sources:
//   * `gameState.knowledge.sharedPool` — rooms / traps / enemiesPerRoom
//     keyed by instance id. Same heuristic as KnowledgePin to derive
//     intel level (FULL > 0.7 accuracy, PARTIAL > 0.3, else RUMOR).
//   * `gameState.dungeon.rooms` — room placements (tileX/tileY/width/height).
//   * `gameState.knowledge.survivors` — adventurers who fled with intel;
//     used for source attribution per leaked room.
//   * Exposure TREND (delta + sparkline) needs a per-day intel timeline
//     gameState doesn't keep — those fake placeholders were removed.
//     LAST LEAK is real (newest `adventurers.known` lastEscapedDay).
//
// Wiring: SCRUB INTEL button emits `KNOWLEDGE_SCRUB_REQUEST { roomId, cost }`,
// handled by `KnowledgeSystem._onScrubRequest` (debits gold + scrubs the
// room's room/enemy/trap intel from the shared pool + every survivor).

import { h } from './dom.js'
import { TrayShell } from './TrayShell.js'
import { EventBus } from '../systems/EventBus.js'
import { snapshotMinion } from './inGameSnapshot.js'

// Design tier metadata for the bespoke MAP tray (KnowledgeTray): maps our
// FULL/PARTIAL/RUMOR/UNKNOWN intel states → the tray's id / colour / label /
// glyph. (UNKNOWN reads as "HIDDEN" — what the kingdom can't see.)
const MAP_TIER = {
  FULL:    { id: 'full',    c: 'var(--blood)', n: 'KNOWN',   g: '◉' },
  PARTIAL: { id: 'partial', c: 'var(--warn)',  n: 'PARTIAL', g: '◐' },
  RUMOR:   { id: 'rumor',   c: 'var(--rumor)', n: 'RUMOR',   g: '◌' },
  UNKNOWN: { id: 'hidden',  c: 'var(--dim)',   n: 'HIDDEN',  g: '?' },
}

// Base scrub cost by the room's own intel tier. The full cost also
// scales with how much the room exposes — see _scrubCost().
const SCRUB_COST = { FULL: 22, PARTIAL: 12, RUMOR: 6, UNKNOWN: 0 }
// Extra scrub cost per known aspect inside the room (each leaked trap /
// minion / item) and per room unlock-tier above the first.
const SCRUB_PER_ASPECT     = 8
const SCRUB_PER_ROOM_LEVEL = 5

export class KnowledgeMapOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._tray = null
    this._selRoomId = null    // selected room in the tray's schematic
    this._listener = () => this.toggle()
    this._onResize = () => this._fitMapStage()
    // Rebuild the open tray when the dungeon layout changes, so the map reflects
    // placed/removed/moved rooms live (no close-and-reopen needed). Only the MAP
    // mode reads rooms — skip in MINION INTEL to keep its selection intact.
    this._onDungeonChanged = () => { if (this._tray && (this._mapMode || 'map') === 'map') this._rerender() }
    EventBus.on('OPEN_KNOWLEDGE_MAP', this._listener)
  }

  toggle() {
    if (this._tray) this.close()
    else this.open()
  }
  isOpen() { return !!this._tray }

  // The knowledge map now flies out of its action-bar button as a bespoke
  // map-first tray (schematic dungeon + tier filter + per-room dossier with
  // a SCRUB INTEL action) instead of the old full-screen Overlay. All the
  // intel/tier/scrub helpers below are reused.
  open() {
    if (this._tray) return
    this._mapMode = 'map'
    this._selRoomId = null
    this._selDoctrine = null
    this._tray = new TrayShell({
      anchorSel: '[data-tray-anchor="MAP"]',
      align:  'right',
      vAlign: 'up',
      accent: 'var(--rumor)',
      width:  'min(64vw, 1040px)',
      height: 384,
      onClose: () => { this._tray = null },
    })
    this._tray.setContent(this._renderTrayContent())
    this._tray.open()
    window.addEventListener('resize', this._onResize)
    // Live layout updates while open (place / remove / move a room).
    EventBus.on('ROOM_PLACED', this._onDungeonChanged)
    EventBus.on('ROOM_REMOVED', this._onDungeonChanged)
    EventBus.on('ROOM_MOVED', this._onDungeonChanged)
    // Drive the live pip layer (minions/adventurers/items moving in real time).
    this._pipTick = requestAnimationFrame(() => this._tickPips())
  }

  close() {
    window.removeEventListener('resize', this._onResize)
    EventBus.off('ROOM_PLACED', this._onDungeonChanged)
    EventBus.off('ROOM_REMOVED', this._onDungeonChanged)
    EventBus.off('ROOM_MOVED', this._onDungeonChanged)
    if (this._pipTick) cancelAnimationFrame(this._pipTick)
    this._pipTick = null
    this._pipEls = null
    this._tray?.close()
    this._tray = null
  }

  _rerender() {
    if (this._tray) this._tray.setContent(this._renderTrayContent())
  }

  // ── Bespoke map tray (schematic + dossier) ──────────────────────
  _renderTrayContent() {
    this._report = this._intelReport()
    const mode = this._mapMode || 'map'
    // Mode switch: the dungeon MAP (room intel) vs the KINGDOM DOCTRINE (what
    // the kingdom has learned about your monster TYPES — mastery + abilities).
    const modeTabs = [
      { id: 'map',      label: 'KNOWLEDGE MAP',    glyph: '⊞' },
      { id: 'doctrine', label: 'MINION INTEL', glyph: '✦' },
    ]
    const seg = modeTabs.map(m => h('div', {
      className: 'htr-segtab mp-modetab' + (mode === m.id ? ' on' : ''),
      on: { click: () => { if (this._mapMode !== m.id) { this._mapMode = m.id; this._rerender() } } },
    }, [ h('span', { className: 'tg' }, m.glyph), h('span', { className: 'lb' }, m.label) ]))

    let content
    if (mode === 'doctrine') {
      content = this._renderDoctrine()
    } else {
      const all = this._roomEntries()   // { id, defId, name, x, y, w, h, state }
      if (!all.length) {
        content = h('div', { className: 'mp-main' }, [
          h('div', { className: 'mp-empty' }, [
            h('div', { className: 'mp-empty-eye' }, '◇  NO DUNGEON  ◇'),
            h('div', { className: 'mp-empty-hint' }, 'Build rooms — then watch what the kingdom learns.'),
          ]),
        ])
      } else {
        // No tier-filter pills — the schematic is already colour-coded by intel.
        content = this._renderMapMode(all)
      }
    }
    return h('div', { className: 'htr-chrome m-col' }, [
      h('div', { className: 'htr-segbar mp-segbar' }, seg),
      h('div', { className: 'htr-content' }, [ content ]),
    ])
  }

  // The dungeon-map view (schematic + room dossier). `all` = room entries.
  _renderMapMode(all) {
    const isBoss = (e) => e.defId === 'boss_chamber'
    // Corridors render as rooms too (tier-coloured), so the layout reads as one
    // connected map. TRUE tile proportions: lay everything out in px (tile ×
    // BASE) inside .mp-scale, then _fitMapStage() uniformly scales the whole
    // box to fit the stage — so a 4×4 room stays square, never stretched.
    const BASE = 16
    const minX = Math.min(...all.map(e => e.x)), minY = Math.min(...all.map(e => e.y))
    const maxX = Math.max(...all.map(e => e.x + e.w)), maxY = Math.max(...all.map(e => e.y + e.h))
    const cW = Math.max(1, maxX - minX) * BASE, cH = Math.max(1, maxY - minY) * BASE
    const PX = (v, min) => ((v - min) * BASE) + 'px'
    // Layout for the per-frame pip tick; reset the (now-detached) pip pool.
    this._mapLayout = { minX, minY, BASE }
    this._pipEls = new Map()
    if (this._selRoomId == null && all.length) this._selRoomId = all[0].id
    const stageInner = h('div', {
      className: 'mp-scale',
      style: { width: cW + 'px', height: cH + 'px' },
    }, [
      ...all.map((r, i) => {
        const t = MAP_TIER[r.state] || MAP_TIER.UNKNOWN
        const on = r.id === this._selRoomId
        return h('div', {
          className: 'mp-room' + (isBoss(r) ? ' boss' : '') + (r.state === 'FULL' ? ' known' : '') + (on ? ' on' : ''),
          style: { left: PX(r.x, minX), top: PX(r.y, minY), width: r.w * BASE + 'px', height: r.h * BASE + 'px', '--rc': t.c, '--i': i },
          on: { click: () => { this._selRoomId = r.id; this._rerender() } },
        }, [
          r.state === 'FULL' ? h('span', { className: 'reye' }, isBoss(r) ? '♛' : '◉') : null,
          h('span', { className: 'rn' }, r.name),
          h('span', { className: 'rt' }, t.n),
        ].filter(Boolean))
      }),
      // Live entity-pip layer — populated + moved every frame by _tickPips().
      h('div', { className: 'mp-pips' }),
    ])
    // Pip legend (floats bottom-left of the stage) so the colours are readable.
    const legend = h('div', { className: 'mp-legend' }, [
      ['BOSS', '#fff'], ['HEROES', 'var(--bloodG)'], ['MINIONS', 'var(--poison)'], ['TRAPS', 'var(--warn)'], ['ITEMS', 'var(--info)'],
    ].map(([label, color]) => h('span', { className: 'mp-leg' }, [
      h('span', { className: 'mp-leg-d', style: { background: color } }),
      label,
    ])))
    const stage = h('div', { className: 'mp-stage' }, [ stageInner, legend ])
    // Uniformly scale the schematic to fit the stage once it mounts.
    requestAnimationFrame(() => this._fitMapStage())
    const sel = all.find(r => r.id === this._selRoomId) || all[0]
    const st = MAP_TIER[sel?.state] || MAP_TIER.UNKNOWN
    const expo = this._exposurePct()
    const scrubCost = sel ? this._scrubCost(sel) : 0
    const side = h('div', { className: 'mp-side' }, [
      h('div', { className: 'mp-expo' }, [
        h('span', { className: 'mp-expo-pct', style: { color: expo >= 70 ? 'var(--blood)' : expo >= 40 ? 'var(--warn)' : 'var(--poison)' } }, `${expo}%`),
        h('span', { className: 'mp-expo-l' }, [ 'DUNGEON', h('br'), 'EXPOSURE' ]),
      ]),
      sel ? h('div', { className: 'mp-det', style: { '--dc': st.c } }, [
        h('span', { className: 'mp-det-eye' }, isBoss(sel) ? 'YOUR THRONE' : 'SCOUTED ROOM'),
        h('span', { className: 'mp-det-name' }, sel.name),
        h('span', { className: 'mp-det-tier' }, `${st.g} ${st.n}`),
        h('span', { className: 'mp-det-desc' }, sel.state === 'UNKNOWN'
          ? 'The kingdom has no knowledge of this room. Keep it buried.'
          : 'Scouting reports place this room — its full contents are still being pieced together.'),
        h('div', { className: 'mp-det-bury' }, [ h('span', { className: 'i' }, '▶'), h('span', null, this._mitigationFor(sel.state)) ]),
        // SCRUB INTEL — the room dossier's call-to-action. Prominent warn-amber
        // button with a pulsing glow so it reads as "do this" (was easy to miss).
        scrubCost > 0 ? h('button', {
          className: 'mp-scrub',
          title: 'Spend gold to wipe this room from the kingdom’s intel',
          on: { click: () => this._onScrub(sel, scrubCost) },
        }, [
          h('span', { className: 'si' }, '⌫'),
          h('span', { className: 'sl' }, 'SCRUB INTEL'),
          h('span', { className: 'sc' }, [ h('span', { className: 'mp-scrub-coin' }), `${scrubCost}g` ]),
        ]) : null,
      ].filter(Boolean)) : null,
    ])
    return h('div', { className: 'mp-main' }, [ stage, side ])
  }

  // Kingdom Doctrine — the adaptive-learning bestiary: per monster TYPE the
  // kingdom has faced-and-survived, its mastery ★ (how hard they now counter
  // it), and the abilities they've learned. Master-detail: a card list (with
  // the real idle sprite) + a detail panel (counter strength + abilities +
  // SCRUB DOCTRINE). Driven by getBestiaryReport().
  _renderDoctrine() {
    const rep = this._knowledgeSystem()?.getBestiaryReport?.() ?? { entries: [], knownCount: 0, studyingCount: 0 }
    // Also list the player's OWN minion types the kingdom hasn't studied yet, so
    // the doctrine shows every monster you field + whether it's been figured out.
    const entries = this._mergeUnknownTypes(rep.entries)
    const hidden = entries.length - rep.entries.length
    const sub = [
      `${rep.knownCount} known`,
      rep.studyingCount ? `${rep.studyingCount} studying` : null,
      hidden ? `${hidden} hidden` : null,
    ].filter(Boolean).join(' · ')
    const head = h('div', { className: 'mp-doc-head' }, [
      h('span', { className: 'mp-doc-h-l' }, '✦ MINION INTEL'),
      h('span', { className: 'mp-doc-h-sub' }, sub || 'no forces'),
    ])
    if (!entries.length) {
      return h('div', { className: 'mp-doc' }, [ head, h('div', { className: 'mp-doc-empty' }, [
        h('div', { className: 'mp-doc-empty-eye' }, '◇  NO FORCES  ◇'),
        h('div', { className: 'mp-doc-empty-hint' }, 'Place minions to field a force. Intel on them only spreads when an adventurer FACES one and ESCAPES — kill them before they flee to keep your monsters a mystery.'),
      ]) ])
    }
    if (!entries.find(e => e.type === this._selDoctrine)) this._selDoctrine = entries[0]?.type
    const sel = entries.find(e => e.type === this._selDoctrine) || entries[0]
    const list = h('div', { className: 'mp-doc-list' }, entries.map((e, i) => this._doctrineCard(e, i)))
    return h('div', { className: 'mp-doc' }, [
      head,
      h('div', { className: 'mp-doc-main' }, [ list, this._doctrineDetail(sel) ]),
    ])
  }

  // Append the player's currently-fielded minion families that AREN'T already in
  // the kingdom's report — as "unknown" entries (no mastery, no abilities) so the
  // doctrine is a complete roster of "your monsters vs what they've figured out".
  _mergeUnknownTypes(known) {
    const out = known.slice()
    const have = new Set(out.map(e => e.type))
    const fam = (id) => String(id).replace(/\d+$/, '')
    const seen = new Set()
    for (const m of (this._gameState.minions ?? [])) {
      if (!m || m.aiState === 'dead' || (m.resources?.hp ?? 1) <= 0) continue
      const f = fam(m.definitionId)
      if (!f || have.has(f) || seen.has(f)) continue
      seen.add(f)
      out.push({
        type: f, label: this._prettyAbility(f), isBoss: false,
        known: false, studyingNow: false, mastery: 0, masteryTier: 0, stale: false, abilities: [],
      })
    }
    return out
  }

  // Colour by HOW MUCH the kingdom knows (a threat heat-gradient): green = they
  // have no clue (safe) → red = fully figured out (they hard-counter it). Stale
  // intel reads orange (it's fading). Boss-ness no longer overrides the colour.
  _docColor(e) {
    const ORANGE = '#ff7a2a'
    if (!e.known && !e.studyingNow) return 'var(--poison)'   // UNKNOWN → green (safe)
    if (!e.known)                   return 'var(--gold)'      // STUDYING → yellow (forming)
    if (e.stale)                    return ORANGE             // STALE → orange (fading)
    const t = e.masteryTier ?? 0                              // KNOWN → green→red by mastery
    return t >= 3 ? 'var(--blood)'                            // full → red
         : t >= 2 ? ORANGE                                    // high → orange
         : 'var(--gold)'                                      // partial → yellow
  }
  _docStar(t)  { return '★★★'.slice(0, Math.max(0, t)) + '☆☆☆'.slice(0, Math.max(0, 3 - t)) }
  _docState(e) { return (e.studyingNow && !e.known) ? '⟳ STUDYING' : e.stale ? 'STALE · counters fading' : e.known ? 'KNOWN' : 'UNKNOWN' }
  _prettyAbility(id) { return String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }

  _doctrineCard(e, i) {
    const on = e.type === this._selDoctrine
    return h('div', {
      className: 'mp-doc-card' + (e.isBoss ? ' boss' : '') + (on ? ' on' : ''),
      style: { '--dc': this._docColor(e), '--i': i },
      on: { click: () => { this._selDoctrine = e.type; this._rerender() } },
    }, [
      h('div', { className: 'mp-doc-port' }, [ this._typeSprite(e, 64) ].filter(Boolean)),
      h('div', { className: 'mp-doc-cardinfo' }, [
        h('span', { className: 'mp-doc-name' }, e.label),
        h('span', { className: 'mp-doc-state' }, this._docState(e)),
      ]),
      // Big mastery stars on the right (fills the card; ☆ ghosts when unknown).
      h('span', { className: 'mp-doc-stars' + (e.known ? '' : ' dim') }, e.known ? this._docStar(e.masteryTier) : '☆☆☆'),
    ])
  }

  _doctrineDetail(e) {
    if (!e) return h('div', { className: 'mp-doc-side' })
    const counter = this._knowledgeSystem()?.getEnemyCounter?.(e.type) ?? { known: e.known, strength: 0, stale: e.stale }
    const pct = Math.round((counter.strength ?? 0) * 100)
    const cost = this._bestiaryScrubCost(e)
    const hint = (!e.known && !e.studyingNow)
      ? 'No doctrine yet — kill adventurers before they flee to keep it a mystery.'
      : (e.studyingNow && !e.known)
        ? 'Being studied now — kill them before they escape to stop it committing.'
        : e.stale
          ? 'Counter fading. Leave it to lapse, or scrub now to wipe the slate.'
          : 'Each survivor sharpens their counter. Scrub to make them forget.'
    return h('div', { className: 'mp-doc-side', style: { '--dc': this._docColor(e) } }, [
      h('div', { className: 'mp-doc-d-top' }, [
        h('div', { className: 'mp-doc-d-port' }, [ this._typeSprite(e, 80) ].filter(Boolean)),
        h('div', { className: 'mp-doc-d-id' }, [
          h('span', { className: 'mp-doc-d-name' }, e.label),
          h('span', { className: 'mp-doc-d-stars' + (e.known ? '' : ' dim') }, e.known ? this._docStar(e.masteryTier) : '☆☆☆'),
          h('span', { className: 'mp-doc-d-state' }, this._docState(e)),
        ]),
      ]),
      h('div', { className: 'mp-doc-d-div' }),
      h('div', { className: 'mp-doc-counter' }, [
        h('div', { className: 'mp-doc-counter-top' }, [ h('span', null, 'COUNTER STRENGTH'), h('b', null, `${pct}%`) ]),
        h('div', { className: 'mp-doc-counter-bar' }, [ h('div', { className: 'mp-doc-counter-fill', style: { width: pct + '%' } }) ]),
        h('span', { className: 'mp-doc-counter-note' }, counter.stale
          ? 'Fading — they haven’t faced it lately.'
          : pct > 0 ? 'They fight this monster smarter.' : 'No counter yet — they fight it blind.'),
      ]),
      h('div', { className: 'mp-doc-abilsec' }, [
        h('span', { className: 'mp-doc-abilsec-h' }, 'ABILITIES THEY KNOW'),
        e.abilities.length
          ? h('div', { className: 'mp-doc-abils' }, e.abilities.map(a => h('span', { className: 'mp-doc-abil' }, this._prettyAbility(a))))
          : h('span', { className: 'mp-doc-noabil' }, e.known ? 'None learned yet.' : 'Nothing — they haven’t seen it fight.'),
      ]),
      h('div', { className: 'mp-doc-d-hint' }, hint),
      cost > 0 ? h('button', {
        className: 'mp-scrub',
        title: 'Spend gold to make the kingdom forget this monster',
        on: { click: () => this._onScrubBestiary(e, cost) },
      }, [
        h('span', { className: 'si' }, '⌫'),
        h('span', { className: 'sl' }, 'SCRUB DOCTRINE'),
        h('span', { className: 'sc' }, [ h('span', { className: 'mp-scrub-coin' }), `${cost}g` ]),
      ]) : h('div', { className: 'mp-doc-d-noscrub' }, 'No intel to scrub.'),
    ].filter(Boolean))
  }

  // The monster's live idle sprite (minion) or bestiary portrait (boss).
  _typeSprite(e, size) {
    if (e.isBoss) {
      const arch = String(e.type).replace(/^boss:/, '')
      return h('div', { className: 'mp-doc-sprite', style: {
        width: size + 'px', height: size + 'px',
        backgroundImage: `url('assets/ui/bestiary/portraits/${arch}_p.png'), radial-gradient(circle at center, var(--bg-2), var(--bg-0))`,
        backgroundSize: 'contain, cover', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', imageRendering: 'pixelated',
      } })
    }
    const defId = this._minionDefIdForFamily(e.type)
    const snap = defId ? snapshotMinion(defId, size) : null
    if (snap) { snap.classList.add('mp-doc-sprite'); return snap }
    return h('div', { className: 'mp-doc-sprite mp-doc-sprite-fb', style: { width: size + 'px', height: size + 'px' } }, (e.label || '?').charAt(0))
  }

  // Resolve a bestiary family (e.g. "imp") to a real minion definitionId for
  // the sprite, by scanning cached minionTypes for a def whose family matches.
  _minionDefIdForFamily(family) {
    const defs = this._cachedJson('minionTypes') ?? []
    const fam = (id) => String(id).replace(/\d+$/, '')
    return defs.find(d => fam(d.id) === family)?.id ?? `${family}1`
  }

  // Gold to scrub a monster type's doctrine — scales with mastery + learned
  // abilities; boss doctrine costs more.
  _bestiaryScrubCost(e) {
    if (!e || (!e.known && !e.studyingNow)) return 0
    const base = [8, 16, 28, 42][e.masteryTier ?? 0] ?? 8
    return Math.max(0, Math.round((base + (e.abilities?.length ?? 0) * 5) * (e.isBoss ? 1.6 : 1)))
  }

  _onScrubBestiary(e, cost) {
    EventBus.emit('SHOW_CONFIRM', {
      title:        'SCRUB DOCTRINE',
      message:      `Spend ${cost}g to make the kingdom forget ${e.label}? Their counters reset until an adventurer faces it again.`,
      confirmLabel: 'SCRUB',
      cancelLabel:  'KEEP',
      theme:        'blue',
      onConfirm: () => {
        EventBus.emit('BESTIARY_SCRUB_REQUEST', { type: e.type, cost })
        setTimeout(() => this._rerender(), 60)
      },
    })
  }

  // Uniformly scale the px schematic (.mp-scale) to fit the stage box,
  // preserving the dungeon's true aspect ratio (so rooms never stretch).
  _fitMapStage() {
    const stage = this._tray?.trayEl?.querySelector('.mp-stage')
    const scale = stage?.querySelector('.mp-scale')
    if (!stage || !scale) return
    const cW = scale.offsetWidth || 1, cH = scale.offsetHeight || 1
    const pad = 16
    const s = Math.min((stage.clientWidth - pad) / cW, (stage.clientHeight - pad) / cH)
    scale.style.transform = `translate(-50%, -50%) scale(${s > 0 ? s : 1})`
  }

  // Live entities to plot as pips: boss (chamber centre), minions,
  // adventurers (day-phase invaders), traps, and items (chests / beacons /
  // fountains / locks / key-chests / phylactery). Each carries a stable `key`
  // so _tickPips() can pool the elements and just move them as things shift.
  // Tile coords; _tickPips converts to px via the stored layout.
  _entityPips() {
    const gs = this._gameState
    const d  = gs.dungeon ?? {}
    const pips = []
    // Boss pip — its LIVE position (BossSystem updates boss.tileX/tileY as it
    // roams its room + fights), falling back to the chamber centre pre-spawn.
    const b = gs.boss
    if (b && b.tileX != null && b.tileY != null) {
      pips.push({ key: 'boss', x: b.tileX + 0.5, y: b.tileY + 0.5, cls: 'boss', label: 'The Boss' })
    } else {
      const bossRoom = (d.rooms ?? []).find(r => r.definitionId === 'boss_chamber')
      if (bossRoom) pips.push({ key: 'boss', x: (bossRoom.gridX ?? 0) + (bossRoom.width || 1) / 2, y: (bossRoom.gridY ?? 0) + (bossRoom.height || 1) / 2, cls: 'boss', label: 'Boss Chamber' })
    }
    for (const m of (gs.minions ?? [])) {
      if (!m || m.aiState === 'dead' || (m.resources?.hp ?? 1) <= 0) continue
      if (m.tileX == null || m.tileY == null) continue
      pips.push({ key: 'm:' + m.instanceId, x: m.tileX + 0.5, y: m.tileY + 0.5, cls: 'minion', label: m.name || 'Minion' })
    }
    for (const a of (gs.adventurers?.active ?? [])) {
      if (!a || a.tileX == null || a.tileY == null) continue
      if ((a.resources?.hp ?? a.hp ?? 1) <= 0 || a.aiState === 'dead') continue
      pips.push({ key: 'a:' + a.instanceId, x: a.tileX + 0.5, y: a.tileY + 0.5, cls: 'adv', label: a.name || 'Adventurer' })
    }
    for (const t of (d.traps ?? [])) {
      if (t?.tileX == null) continue
      pips.push({ key: 't:' + t.tileX + ',' + t.tileY, x: t.tileX + 0.5, y: t.tileY + 0.5, cls: 'trap', label: 'Trap' })
    }
    const itemArrays = [d.treasureChests, d.beacons, d.fountains, d.locks, d.keyChests]
    for (const arr of itemArrays) {
      for (const it of (arr ?? [])) {
        if (it?.tileX == null) continue
        pips.push({ key: 'i:' + it.tileX + ',' + it.tileY, x: it.tileX + 0.5, y: it.tileY + 0.5, cls: 'item', label: 'Item' })
      }
    }
    if (gs.phylactery && gs.phylactery.tileX != null) {
      pips.push({ key: 'i:phyl', x: gs.phylactery.tileX + 0.5, y: gs.phylactery.tileY + 0.5, cls: 'item', label: 'Phylactery' })
    }
    return pips
  }

  // Per-frame pip updater (runs while the map tray is open). Pools elements by
  // entity key and only writes left/top — so minions / adventurers / moved or
  // sold items track in real time without a full re-render. Pips have no
  // re-created animation (rings live on ::after), so pooling keeps them smooth.
  _tickPips() {
    if (!this._tray) { this._pipTick = null; return }
    const layer = this._tray.trayEl?.querySelector('.mp-pips')
    const lay = this._mapLayout
    if (layer && lay) {
      if (!this._pipEls) this._pipEls = new Map()
      const BASE = lay.BASE
      const seen = new Set()
      for (const p of this._entityPips()) {
        seen.add(p.key)
        let el = this._pipEls.get(p.key)
        if (!el) {
          el = h('div', { className: 'mp-pip mp-pip-' + p.cls, title: p.label })
          const sz = Math.round(p.cls === 'boss' ? BASE * 1.35 : BASE * 0.8)
          el.style.width = sz + 'px'; el.style.height = sz + 'px'
          this._pipEls.set(p.key, el)
          layer.appendChild(el)
        }
        el.style.left = ((p.x - lay.minX) * BASE) + 'px'
        el.style.top  = ((p.y - lay.minY) * BASE) + 'px'
      }
      for (const [k, el] of this._pipEls) {
        if (!seen.has(k)) { el.remove(); this._pipEls.delete(k) }
      }
    }
    this._pipTick = requestAnimationFrame(() => this._tickPips())
  }

  // ── Data helpers ────────────────────────────────────────────────
  _cachedJson(key) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.(key)
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
    }
    return null
  }

  // Resolve the live KnowledgeSystem off the Game scene. It owns the
  // authoritative tier classifier + live-pool union; the HUD must never
  // re-derive intel state from raw gameState fields (that's what made
  // every room read PARTIAL).
  _knowledgeSystem() {
    const mgr = window.__game?.scene
    if (!mgr) return null
    const game = mgr.getScene?.('Game')
    if (game?.knowledgeSystem) return game.knowledgeSystem
    for (const s of (mgr.scenes ?? [])) {
      if (s?.knowledgeSystem) return s.knowledgeSystem
    }
    return null
  }

  // Pull the HUD intel snapshot from the live system. Falls back to an
  // empty report (everything UNKNOWN, 0% exposure) when there's no Game
  // scene — e.g. opened from a menu context.
  _intelReport() {
    const sys = this._knowledgeSystem()
    if (sys?.getIntelReport) return sys.getIntelReport()
    return { exposurePct: 0, rooms: {}, traps: {}, enemiesPerRoom: {}, items: {}, leakedRoomCount: 0 }
  }

  // Room intel state — one of the four state strings. Reads the cached
  // report computed once per render in _renderBody().
  _intelStateFor(roomInstanceId) {
    return this._report?.rooms?.[roomInstanceId] ?? 'UNKNOWN'
  }

  _roomEntries() {
    const rooms = this._gameState.dungeon?.rooms ?? []
    const roomDefs = this._cachedJson('rooms') ?? []
    return rooms.map(r => {
      const def = roomDefs.find(d => d.id === r.definitionId)
      return {
        id:    r.instanceId,
        defId: r.definitionId,
        name:  def?.name ?? r.definitionId,
        // Room placements use gridX/gridY (DungeonGrid.placeRoom). Minions
        // use tileX/tileY (Minion entity). Don't confuse them.
        x: r.gridX ?? 0, y: r.gridY ?? 0,
        w: r.width || 1, h: r.height || 1,
        state: this._intelStateFor(r.instanceId),
        // Without a per-leak timestamp, treat every leaked room as
        // potentially fresh. Future hud2-knowledge-history-data row
        // populates this properly.
        fresh: false,
      }
    })
  }

  // Mitigation advice — tied to mechanics that actually exist: SCRUB
  // INTEL (the button below, wipes the room from the shared pool) and
  // relocating the room (fires ROOM_REMOVED → KnowledgeSystem marks the
  // intel stale, dropping its tier). Garrisoning does NOT affect room
  // intel — don't claim it does.
  _mitigationFor(state) {
    if (state === 'FULL')    return 'They know this room cold. Scrub the intel, or relocate the room to break their map.'
    if (state === 'PARTIAL') return 'Rough map only — scrub it, or relocate the room before a revisit sharpens it back to FULL.'
    if (state === 'RUMOR')   return 'Stale rumours — barely acted on. Low priority; scrub it for a clean slate.'
    return 'They walk in blind here — keep it dark.'
  }

  _exposurePct() {
    return this._report?.exposurePct ?? 0
  }

  // Total gold to scrub a room's intel. Scales with three things the
  // player can see on the card: the base intel tier (FULL/PARTIAL/
  // RUMOR), the number of known aspects inside it (leaked traps +
  // minions + items), and the room's own unlock tier. So a late-game
  // room with a known trap and minion costs far more to wipe than a
  // barely-glimpsed empty starter room.
  _scrubCost(r) {
    const base = SCRUB_COST[r.state] ?? 0
    if (base === 0) return 0   // UNKNOWN layout — nothing to scrub
    const d = this._knowledgeSystem()?.getRoomKnowledgeDetails?.(r.id)
    const aspects = (d?.traps?.length   ?? 0)
                  + (d?.enemies?.length ?? 0)
                  + (d?.items?.length   ?? 0)
    const roomDef  = (this._cachedJson('rooms') ?? []).find(x => x.id === r.defId)
    const unlockLv = Math.max(1, roomDef?.unlockLevel ?? 1)
    return base
         + aspects * SCRUB_PER_ASPECT
         + (unlockLv - 1) * SCRUB_PER_ROOM_LEVEL
  }

  _onScrub(room, cost) {
    EventBus.emit('SHOW_CONFIRM', {
      title:        'SCRUB INTEL',
      message:      `Spend ${cost}g to scrub ${room.name} intel from the shared pool?`,
      confirmLabel: 'SCRUB',
      cancelLabel:  'KEEP',
      theme:        'blue',
      onConfirm: () => {
        EventBus.emit('KNOWLEDGE_SCRUB_REQUEST', { roomId: room.id, cost })
        // Defer rerender so the gameplay side has a chance to update pool first
        setTimeout(() => this._rerender(), 60)
      },
    })
  }

  destroy() {
    EventBus.off('OPEN_KNOWLEDGE_MAP', this._listener)
    this._overlay?.close()
    this._overlay = null
  }
}

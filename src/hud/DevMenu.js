// DevMenu — the single consolidated in-game developer menu (mango-only).
//
// Replaces the three old floating dev buttons (TEST EVENT / TEST KR / TEST ADV)
// with ONE "⚙ DEV" button that opens one tabbed panel:
//
//   STAGE    — set up & control the test environment + boss/run/debug controls
//   SPAWN    — put units on the field (adventurers, minions, special units, companion)
//   PACTS    — apply / remove any dungeon mechanic
//   EVENTS   — force scripted beats (Aldric set-pieces + scheduled events)
//   KINGDOM  — the acts / Kingdom-Response hub (responses, champion raids, ascension)
//
// Visible only when PlayerProfile.isCheatName() (player name === 'mango'). Every
// control is a card with icon + NAME + a plain-English description of what it does.
// The header carries a live STATE strip (day · phase · boss lvl · gold · flags).
//
// Backend is unchanged: cards fire the same EventBus events / window.__qfDev calls
// the old buttons used — this is purely a UI consolidation. MUST be constructed
// AFTER HudRoot.mount() (it appends to #hud-stage immediately, like the old buttons).

import { h, mount } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { PlayerProfile } from '../systems/PlayerProfile.js'
import { PauseManager } from '../systems/PauseManager.js'
import { isActsEnabled } from '../config/acts.js'
import { DebugOverlay } from '../systems/DebugOverlay.js'
import { COMPANION_ORDER, getCompanion } from '../systems/companions.js'

const TABS = [
  { id: 'STAGE',   label: 'STAGE',   icon: '🏗' },
  { id: 'SPAWN',   label: 'SPAWN',   icon: '☠' },
  { id: 'PACTS',   label: 'PACTS',   icon: '📜' },
  { id: 'EVENTS',  label: 'EVENTS',  icon: '🎬' },
  { id: 'KINGDOM', label: 'KINGDOM', icon: '👑' },
]

const RARITY_COLOR = { common: '#9fb0bd', uncommon: '#7ed18a', rare: '#6fa8ff', epic: '#c08bff', legendary: '#ffcf6b', damned: '#ff5a6a' }
const RARITY_ORDER = { legendary: 0, damned: 1, epic: 2, rare: 3, uncommon: 4, common: 5 }

const CHAMPIONS = [
  ['rival',          'RIVAL · VORZAK',        '⚑'],
  ['inquisition',    'INQUISITION · MORDRAKE', '⚖'],
  ['pantheon',       'PANTHEON · AURELIA',    '☼'],
  ['betrayer',       'BETRAYER · TURNCOAT',   '⇄'],
  ['reckoning_dead', 'DEAD · NECRARCH',       '☠'],
  ['forlorn_hope',   'FORLORN · HALRIC',      '♟'],
  ['mage_tower',     'MAGE TOWER · VELLORAN', '✶'],
  ['all_stars',      'ALL-STARS · GARRETH',   '★'],
  ['plunderers',     'PLUNDERERS · VANE',     '⚿'],
]

export class DevMenu {
  constructor() {
    this._btn       = null
    this._modal     = null
    this._content   = null
    this._stateEl   = null
    this._railEl    = null
    this._escFn     = null
    this._activeTab = 'STAGE'
    if (!PlayerProfile.isCheatName?.()) return
    this._mount()
  }

  destroy() {
    this._closeModal()
    this._btn?.remove()
    this._btn = null
  }

  // ── Button ────────────────────────────────────────────────────────────────
  _mount() {
    const stage = document.getElementById('hud-stage')
    if (!stage) return
    this._btn = h('button', {
      className: 'qf-dev-btn',
      title: 'Mango dev menu — stage, spawn, pacts, events, kingdom',
      on: { click: () => this._openModal() },
    }, [h('span', { className: 'qf-dev-btn-gear' }, '⚙'), h('span', null, 'DEV')])
    stage.appendChild(this._btn)
  }

  // ── Modal shell ─────────────────────────────────────────────────────────────
  _openModal() {
    if (this._modal) return
    const stage = document.getElementById('hud-stage') ?? document.body

    this._stateEl = h('div', { className: 'qf-dev-state pix' })
    this._railEl  = h('div', { className: 'qf-dev-tabs' },
      TABS.map(t => h('button', {
        className: ['qf-dev-tab', t.id === this._activeTab ? 'on' : ''],
        dataset: { tab: t.id },
        on: { click: () => this._selectTab(t.id) },
      }, [h('span', { className: 'qf-dev-tab-icon' }, t.icon), h('span', { className: 'pix' }, t.label)])))
    this._content = h('div', { className: 'qf-dev-content' })

    const panel = h('div', { className: 'qf-dev-panel' }, [
      h('div', { className: 'qf-dev-head' }, [
        h('div', { className: 'qf-dev-title pix' }, 'DEV MENU · MANGO ONLY'),
        this._stateEl,
        h('button', { className: 'qf-dev-x pix', title: 'Close (Esc)', on: { click: () => this._closeModal() } }, '✕'),
      ]),
      h('div', { className: 'qf-dev-body' }, [this._railEl, this._content]),
    ])

    this._modal = h('div', {
      className: 'qf-dev-modal',
      on: { click: (e) => { if (e.target === e.currentTarget) this._closeModal() } },
    }, [panel])

    PauseManager.softPause()   // freeze the world while the dev menu is open
    stage.appendChild(this._modal)
    this._renderState()
    this._renderTab()

    this._escFn = (e) => { if (e.key === 'Escape') this._closeModal() }
    window.addEventListener('keydown', this._escFn)
  }

  _closeModal() {
    if (this._escFn) { window.removeEventListener('keydown', this._escFn); this._escFn = null }
    if (this._modal) {
      this._modal.remove()
      this._modal = null
      this._content = this._stateEl = this._railEl = null
      PauseManager.softResume()
    }
  }

  _selectTab(id) {
    this._activeTab = id
    for (const tab of this._railEl?.children ?? []) {
      tab.classList.toggle('on', tab.dataset?.tab === id)
    }
    this._renderTab()
  }

  _renderTab() {
    if (!this._content) return
    const builder = {
      STAGE:   () => this._tabStage(),
      SPAWN:   () => this._tabSpawn(),
      PACTS:   () => this._tabPacts(),
      EVENTS:  () => this._tabEvents(),
      KINGDOM: () => this._tabKingdom(),
    }[this._activeTab] ?? (() => [])
    mount(this._content, builder())
    this._content.scrollTop = 0
  }

  // ── Live state strip ─────────────────────────────────────────────────────────
  _renderState() {
    if (!this._stateEl) return
    const g = this._gs()
    const active = (window.__game?.scene?.scenes ?? []).filter(s => s.scene.isActive()).map(s => s.scene.key)
    const phase = active.includes('DayPhase') ? 'DAY' : active.includes('NightPhase') ? 'BUILD' : (g?.meta?.phase || '—').toUpperCase()
    const gold = g?.player?.gold ?? g?.economy?.gold ?? g?.gold
    const cell = (label, val, on) => h('span', { className: ['qf-dev-stat', on ? 'hot' : ''] }, `${label} ${val}`)
    mount(this._stateEl, g ? [
      cell('DAY', g?.meta?.dayNumber ?? '—'),
      cell('PHASE', phase),
      cell('BOSS L', g?.boss?.level ?? '—'),
      gold != null ? cell('GOLD', gold) : null,
      cell('PACTS', g?.activeMechanics?.length ?? 0),
      globalThis.__qfDevQuietDay ? cell('QUIET', 'ON', true) : null,
      globalThis.__qfDevFastAbilities ? cell('FAST', 'ON', true) : null,
      g?.boss?._devInvuln ? cell('INVULN', 'ON', true) : null,
    ].filter(Boolean) : [cell('no run', '— start a run first')])
  }

  // ── Card / section helpers ───────────────────────────────────────────────────
  _section(label, cls) {
    return h('div', { className: ['qf-dev-section', cls || '', 'pix'] }, label)
  }

  _hint(text) {
    return h('div', { className: 'qf-dev-hint pix' }, text)
  }

  _grid(cards, cls) {
    return h('div', { className: ['qf-dev-grid', cls || ''] }, cards)
  }

  // A control card. opts: { icon, name, desc, accent, keepOpen, on }.
  // keepOpen cards stay in the menu (toggles / spawns) and may return a string
  // to overwrite their NAME line; close cards dismiss the menu first (so the
  // world resumes) then run — needed for day-start actions.
  _card({ icon, name, desc, accent, keepOpen, cls, on }) {
    const nameEl = h('div', { className: 'qf-dev-card-name pix' }, name)
    return h('button', {
      className: ['qf-dev-card', cls || ''],
      style: accent ? { borderColor: accent } : null,
      on: { click: () => {
        if (keepOpen) {
          const r = on?.()
          if (typeof r === 'string') nameEl.textContent = r
          this._renderState()
        } else {
          this._closeModal()
          on?.()
        }
      } },
    }, [
      h('div', { className: 'qf-dev-card-icon', style: accent ? { color: accent } : null }, icon),
      nameEl,
      h('div', { className: 'qf-dev-card-desc' }, desc),
    ])
  }

  // ── Tab: STAGE ───────────────────────────────────────────────────────────────
  _tabStage() {
    const d = () => this._qfDev()
    const out = []

    out.push(this._section('DAY & STAGE', 'sandbox'))
    out.push(this._hint('Set up a clean, isolated test stage. Toggles stay open so you can chain them; START/END DAY close the menu so the world resumes.'))
    out.push(this._grid([
      this._card({ icon: '🏗', name: 'BUILD ARENA', desc: 'Wire a connected starter dungeon to the boss (day-jumps leave only a bare boss room).', keepOpen: true, on: () => d()?.arena() }),
      this._card({ icon: '▶', name: 'START DAY', desc: 'Begin a day (quiet, if Quiet Mode is on). Resumes the build phase first.', on: () => d()?.startDay() }),
      this._card({ icon: '⏭', name: 'END DAY', desc: 'Finish the current day now → EndOfDay → night.', on: () => d()?.endDay() }),
      this._card({ icon: '🔇', name: this._lbl('QUIET MODE', globalThis.__qfDevQuietDay), desc: 'Days spawn NO wave and a wave-less day stays open (a persistent VFX stage).', keepOpen: true, on: () => this._lbl('QUIET MODE', d()?.quietDay(!globalThis.__qfDevQuietDay)) }),
      this._card({ icon: '⚡', name: this._lbl('FAST ABILITIES', globalThis.__qfDevFastAbilities), desc: 'Collapse champion/All-Star cast cadence to ~0.6s for screenshotting.', keepOpen: true, on: () => this._lbl('FAST ABILITIES', d()?.fastAbilities(!globalThis.__qfDevFastAbilities)) }),
      this._card({ icon: '✖', name: 'CLEAR SANDBOX', desc: 'Remove every dev-spawned minion / trap / raid unit.', keepOpen: true, on: () => d()?.clear() }),
    ]))

    out.push(this._section('BOSS', 'champ'))
    out.push(this._bossLevelRow())
    out.push(this._bossTierRow())
    out.push(this._grid([
      this._card({ icon: '✚', name: 'FULL HEAL', desc: 'Restore the boss to full HP.', keepOpen: true, on: () => d()?.healBoss() }),
      this._card({ icon: '🛡', name: this._lbl('INVINCIBLE', this._gs()?.boss?._devInvuln), desc: 'Boss takes no damage — watch a long fight without it dying.', keepOpen: true, on: () => this._lbl('INVINCIBLE', d()?.invincible(!this._gs()?.boss?._devInvuln)) }),
    ]))

    out.push(this._section('RUN', 'kr'))
    out.push(this._grid([
      this._card({ icon: '🏆', name: 'FORCE WIN', desc: 'Fire RUN_VICTORY → jump straight to the Victory screen.', accent: '#ffcf6b', on: () => d()?.forceWin() }),
      this._card({ icon: '💀', name: 'FORCE LOSE', desc: 'Run the real final-death path → Game Over screen (ends + deletes the run).', accent: '#ff5a6a', on: () => d()?.forceLose() }),
    ]))

    out.push(this._section('DEBUG OVERLAYS', 'evt'))
    const dbg = DebugOverlay.snapshot()
    out.push(this._grid([
      this._card({ icon: '▦', name: this._lbl('COLLISION', dbg.showCollision), desc: 'Tint walkable vs blocking tiles over the dungeon grid.', keepOpen: true, on: () => this._lbl('COLLISION', d()?.debug('showCollision')) }),
      this._card({ icon: '⊡', name: this._lbl('DOORS', dbg.showDoors), desc: 'Connection-point dots on each room wall.', keepOpen: true, on: () => this._lbl('DOORS', d()?.debug('showDoors')) }),
      this._card({ icon: '🧭', name: this._lbl('AI DIAGNOSTICS', dbg.aiDiagnostics), desc: 'Console-log adventurer goal changes, path recomputes, stuck warnings.', keepOpen: true, on: () => this._lbl('AI DIAGNOSTICS', d()?.debug('aiDiagnostics')) }),
    ]))
    return out
  }

  _lbl(base, on) { return `${base}: ${on ? 'ON' : 'OFF'}` }

  // Boss "set level" — number input + APPLY.
  _bossLevelRow() {
    const input = h('input', {
      className: 'qf-dev-input pix', type: 'number', min: '1', max: '999',
      value: String(this._gs()?.boss?.level ?? 1),
    })
    return h('div', { className: 'qf-dev-row' }, [
      h('div', { className: 'qf-dev-row-label pix' }, 'SET LEVEL'),
      input,
      h('button', { className: 'qf-dev-mini pix', on: { click: () => {
        this._qfDev()?.setBossLevel(input.value); this._renderState()
      } } }, 'APPLY'),
      h('div', { className: 'qf-dev-row-desc' }, 'Set boss level + rescale HP/ATK/DEF (current HP % kept).'),
    ])
  }

  // Boss "evolution tier" — T1–T4 sprite preview.
  _bossTierRow() {
    return h('div', { className: 'qf-dev-row' }, [
      h('div', { className: 'qf-dev-row-label pix' }, 'EVO TIER'),
      h('div', { className: 'qf-dev-tier-btns' }, [1, 2, 3, 4].map(t =>
        h('button', { className: 'qf-dev-mini pix', on: { click: () => this._qfDev()?.bossTier(t) } }, 'T' + t))),
      h('div', { className: 'qf-dev-row-desc' }, 'Preview the boss’s evolved sprite (visual only — no act/stat change).'),
    ])
  }

  // ── Tab: SPAWN ───────────────────────────────────────────────────────────────
  _tabSpawn() {
    const d = () => this._qfDev()
    const out = []

    // Adventurers
    const classes = this._json('adventurerClasses')
    out.push(this._section(`ADVENTURER  (${classes.length})`, 'sandbox'))
    out.push(this._hint('Spawn one solo raider of any class into the current DAY (it enters at an entry hall and acts immediately). No-op during the build phase — start a day first. Stays open so you can queue several; close to watch.'))
    out.push(this._grid(classes.map(def => this._card({
      icon: '◆', accent: '#' + String(def.color || '0xaabbcc').replace(/^0x/, ''),
      name: def.name || def.id, desc: def.id, keepOpen: true,
      on: () => { EventBus.emit('DEV_SPAWN_CLASS', { classId: def.id }); return def.name || def.id },
    }))))

    // Minion sprite viewer
    const minions = this._json('minionTypes')
    out.push(this._section(`MINION · SPRITE VIEWER  (${minions.length})`, 'champ'))
    out.push(this._hint('Spawn one of any minion type near the boss — each evolution tier is its own id (beholder1 / beholder2 / beholder_tyrant), so you can inspect any tier’s sprite + animations.'))
    const mGrid = this._grid(minions.map(def => h('button', {
      className: 'qf-dev-card mini',
      dataset: { mname: String(def.name || def.id).toLowerCase(), mid: String(def.id).toLowerCase() },
      on: { click: () => { d()?.spawnMinion(def.id); this._renderState() } },
    }, [
      h('div', { className: 'qf-dev-card-name pix' }, def.name || def.id),
      h('div', { className: 'qf-dev-card-desc' }, def.id),
    ])))
    out.push(this._search('search minions…', mGrid, ['mname', 'mid']))
    out.push(mGrid)

    // Special units
    out.push(this._section('SPECIAL UNITS', 'kr'))
    out.push(this._grid([
      this._card({ icon: '☠', name: 'POPULATE TARGETS', desc: '8 mixed-tier minions (+ undead) + 3 traps near the boss, so abilities have things to hit.', keepOpen: true, on: () => d()?.populate({ minions: 8, traps: 3 }) }),
      this._card({ icon: '⚰', name: 'SUMMON NECRARCH', desc: 'Reckoning: the immune undead king + a tide of risen dead. Needs an active day.', keepOpen: true, on: () => d()?.necrarch() }),
      this._card({ icon: '⇄', name: 'BETRAYER DASH', desc: 'Strongest minion dashes trap-to-trap sabotaging each, then flees. Populate first.', keepOpen: true, on: () => d()?.betrayerDash() }),
      this._card({ icon: '♚', name: 'RIVAL SHOWDOWN', desc: 'Boss-vs-boss duel — Vorzak marches on your throne. Needs an active day.', on: () => d()?.rivalDuel() }),
    ]))

    // Companion (portrait only)
    out.push(this._section('ACTIVE COMPANION', 'evt'))
    out.push(this._hint('Companions are ambient HUD portrait + dialogue, not field units — this swaps who’s active (portrait refreshes on next companion render).'))
    out.push(this._grid(COMPANION_ORDER.map(id => {
      const c = getCompanion(id)
      return this._card({ icon: '☻', name: c?.name || id, desc: id, keepOpen: true, on: () => { d()?.setCompanion(id); return c?.name || id } })
    })))
    return out
  }

  // ── Tab: PACTS ───────────────────────────────────────────────────────────────
  _tabPacts() {
    const pacts = this._json('dungeonMechanics')
    const sorted = [...pacts].sort((a, b) =>
      ((RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9)) || String(a.name || '').localeCompare(String(b.name || '')))
    const grid = this._grid(sorted.map(def => this._pactCard(def)), 'pacts')
    return [
      this._section(`PACTS · APPLY / REMOVE ANY  (${pacts.length})`, 'pact'),
      this._hint('Click a pact to SEAL it on your dungeon (the real activate handler runs — seal effects fire and it shows in your active pacts); click again to remove it. Test any pact without the RNG draw.'),
      this._search('search pacts…', grid, ['pname', 'pid']),
      grid,
    ]
  }

  _pactCard(def) {
    const rc = RARITY_COLOR[def.rarity] ?? '#9fb0bd'
    const on0 = !!this._dms()?.isActive?.(def.id)
    const desc = h('div', { className: 'qf-dev-card-desc' }, on0 ? '✓ ACTIVE · click to remove' : `${def.rarity} · click to apply`)
    return h('button', {
      className: ['qf-dev-card', 'pact', on0 ? 'on' : ''],
      dataset: { pname: String(def.name || def.id).toLowerCase(), pid: String(def.id).toLowerCase() },
      style: { borderColor: on0 ? '#67e667' : rc },
      on: { click: (e) => {
        const dms = this._dms(); if (!dms) return
        if (dms.isActive(def.id)) dms.deactivate(def.id); else dms.activate(def.id)
        const on = dms.isActive(def.id)
        e.currentTarget.classList.toggle('on', on)
        e.currentTarget.style.borderColor = on ? '#67e667' : rc
        desc.textContent = on ? '✓ ACTIVE · click to remove' : `${def.rarity} · click to apply`
        this._renderState()
      } },
    }, [
      h('div', { className: 'qf-dev-card-icon', style: { color: rc } }, def.symbol || '◆'),
      h('div', { className: 'qf-dev-card-name pix' }, def.name || def.id),
      desc,
    ])
  }

  // ── Tab: EVENTS ──────────────────────────────────────────────────────────────
  _tabEvents() {
    const out = []
    out.push(this._section('ALDRIC · THE NEMESIS', 'kr'))
    out.push(this._hint('Force the Kingdom’s Reckoning nemesis. SCOUT (Acts I–III) spawns the stalking Aldric with decoys; DUEL spawns the Act IV climax duel in either form. Needs an active day.'))
    out.push(this._grid([
      this._card({ icon: '⚔', name: 'SCOUT · ACT I', desc: 'aldric_scout · act 1', on: () => EventBus.emit('DEV_FORCE_ALDRIC_SCOUT', { act: 1 }) }),
      this._card({ icon: '⚔', name: 'SCOUT · ACT II', desc: 'aldric_scout · act 2', on: () => EventBus.emit('DEV_FORCE_ALDRIC_SCOUT', { act: 2 }) }),
      this._card({ icon: '⚔', name: 'SCOUT · ACT III', desc: 'aldric_scout · act 3', on: () => EventBus.emit('DEV_FORCE_ALDRIC_SCOUT', { act: 3 }) }),
      this._card({ icon: '♔', name: 'DUEL · RADIANT', desc: 'Act IV climax duel — crowned Hero King.', on: () => EventBus.emit('DEV_FORCE_ALDRIC_DUEL', { form: 'radiant' }) }),
      this._card({ icon: '♛', name: 'DUEL · DESPERATE', desc: 'Act IV climax duel — desperate form.', on: () => EventBus.emit('DEV_FORCE_ALDRIC_DUEL', { form: 'desperate' }) }),
    ]))

    const events = this._json('events')
    out.push(this._section(`SCHEDULED EVENTS  (${events.length})`, 'evt'))
    out.push(this._hint('Force any scheduled event to fire now (bypasses cadence + eligibility).'))
    const grid = this._grid(events.map(def => h('button', {
      className: 'qf-dev-card',
      dataset: { ename: String(def.title || def.id).toLowerCase(), eid: String(def.id).toLowerCase() },
      on: { click: () => { this._closeModal(); EventBus.emit('DEV_FORCE_EVENT', { eventId: def.id }) } },
    }, [
      h('div', { className: 'qf-dev-card-icon' }, def.icon || '◆'),
      h('div', { className: 'qf-dev-card-name pix' }, def.title || def.id),
      h('div', { className: 'qf-dev-card-desc' }, def.id),
    ])))
    out.push(this._search('search events…', grid, ['ename', 'eid']))
    out.push(grid)
    return out
  }

  // ── Tab: KINGDOM ─────────────────────────────────────────────────────────────
  _tabKingdom() {
    const out = []
    if (!isActsEnabled()) {
      out.push(this._hint('The acts / Kingdom-Response system is disabled in this build.'))
      return out
    }
    const responses = this._json('kingdomResponses')
    out.push(this._section(`KINGDOM RESPONSES  (${responses.length})`, 'kr'))
    out.push(this._hint('Make a response the current drafted act: activates its act-wide modifier + the HUD eyebrow, and (if a day is running) spawns its Champion raid so the combat modifier is live.'))
    out.push(this._grid(responses.map(def => this._card({
      icon: def.emblem || '◆', accent: def.accent || 'var(--gold)',
      name: def.name || def.id, desc: def.id,
      on: () => EventBus.emit('DEV_FORCE_KINGDOM_RESPONSE', { responseId: def.id }),
    }))))

    out.push(this._section('BOSS ASCENSION', 'champ'))
    out.push(this._grid([
      this._card({ icon: '▲', name: 'TEST ASCENSION', desc: 'Preview the boss-ascension cinematic from live boss/archetype data (deploys nothing).', accent: '#ff9a5a', on: () => EventBus.emit('DEV_TEST_ASCENSION', {}) }),
    ]))

    out.push(this._section('CHAMPION RAIDS · 9 ACT BOSSES', 'champ'))
    out.push(this._hint('Force any act boss (+ its retinue) right now to fight + balance-check it. One at a time — kill the live champion before spawning the next. Needs an active day.'))
    out.push(this._grid(CHAMPIONS.map(([id, label, icon]) => this._card({
      icon, name: label, desc: `champion · ${id}`,
      on: () => EventBus.emit('DEV_FORCE_CHAMPION_RAID', { responseId: id }),
    }))))
    return out
  }

  // ── Shared: a search box that filters a grid by dataset keys ─────────────────
  _search(placeholder, grid, keys) {
    return h('input', {
      className: 'qf-dev-search pix', type: 'text', placeholder,
      on: { input: (e) => {
        const q = String(e.target.value || '').trim().toLowerCase()
        for (const c of grid.children) {
          const hit = !q || keys.some(k => (c.dataset?.[k] || '').includes(q))
          c.style.display = hit ? '' : 'none'
        }
      } },
    })
  }

  // ── Data access ──────────────────────────────────────────────────────────────
  _json(key) {
    return (window.__game?.scene?.scenes ?? [])
      .map(s => s?.cache?.json?.get?.(key))
      .find(Array.isArray) ?? []
  }
  _gs() { return window.__game?.scene?.keys?.Game?.gameState ?? null }
  _qfDev() {
    const api = window.__qfDev
    if (!api) console.warn('[dev] __qfDev not installed — start a run first')
    return api
  }
  _dms() {
    const dms = window.__game?.scene?.keys?.Game?.dungeonMechanicSystem
    if (!dms) console.warn('[dev] dungeonMechanicSystem not available — start a run first')
    return dms
  }
}

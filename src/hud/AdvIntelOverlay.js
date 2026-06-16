// AdvIntelOverlay — DOM port of the design's Adventurer Intel popup
// (overlays.jsx → AdventurerIntelOverlay).
//
// Summary strip (NEXT WAVE / PARTY SIZE / VETERANS / OVERALL THREAT).
// Left pane: approaching-party list, one card per adventurer (sprite +
// name + class·LV + threat chip + redacted flag + veteran badge).
// Right pane: selected-adv detail (portrait + stat tiles HP/ATK/SPD +
// notes) and intel ledger ("WHAT THEY KNOW").
//
// Data sources:
//   * Day phase: reads `gameState.adventurers.active` (live in-dungeon).
//   * Night phase: reads `gameState.run.nextWavePreview` (the
//     authoritative pre-spawn forecast NightPhase re-rolls on every
//     ROOM_PLACED). Synthetic stubs are built from classIds +
//     spriteVariants + the class JSON's baseStats, so the intel panel
//     shows EXACTLY who will arrive tomorrow with the EXACT LPC sprite
//     they'll wear. Event waves (guild raid double-count, loot goblin
//     heist, rival dungeon invaders, cosplay
//     contest, etc.) flow through the same preview, so
//     this view covers them automatically.
//   * Vendetta hunters get prepended as an extra stub (avenger of the
//     dead adv, +1 LV over baseline).
//   * When neither feed has anything, the panel falls back to an
//     "INTEL UNKNOWN" placeholder.
//   * Veteran flag from `adv.isVeteran` or a presence in
//     `gameState.adventurers.known[].escapeCount > 0`.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'
import { snapshotAdventurerEntity, warmAdvSnapshotsThen } from './inGameSnapshot.js'
import { adventurerDisplayLevel, adventurerScaleMultipliers, ngPlusEnemyMul } from '../config/balance.js'

const THREAT_TIERS = [
  { label: 'CRITICAL', color: 'var(--blood)',  min: 75 },
  { label: 'HIGH',     color: 'var(--warn)',   min: 50 },
  { label: 'MODERATE', color: 'var(--gold)',   min: 25 },
  { label: 'LOW',      color: 'var(--poison)', min: 0 },
]

function tierFor(score) {
  return THREAT_TIERS.find(t => score >= t.min) || THREAT_TIERS[3]
}

// Library tier gates — count of active Library of Whispers rooms
// determines how much intel the night preview reveals:
//   0 → empty state ("Build a LIBRARY")
//   1 → wave size + classes (basic)
//   2 → + per-adv personalities
//   3 → + per-adv scaled stats (HP / ATK / SPD / DEF)
//   4 → + per-adv planned route
// Day-phase view is the live truth (Library count irrelevant once they
// arrive — you can see them).
const TIER_PERSONALITIES = 2
const TIER_STATS         = 3
const TIER_ROUTE         = 4

export class AdvIntelOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._selIdx = 0
    this._pendingSelIdx = null
    this._listener = (payload) => this._onOpenRequest(payload)
    EventBus.on('OPEN_ADV_INTEL', this._listener)
  }

  // OPEN_ADV_INTEL handler. A bare event (BottomBar "Adventurer Intel"
  // button) toggles the overlay. An event carrying `selectIndex` — a
  // click on an adventurer sprite in the wave panel — opens the overlay
  // (if not already open) focused on that adventurer.
  _onOpenRequest(payload) {
    const idx = payload && Number.isInteger(payload.selectIndex)
      ? payload.selectIndex : null
    if (idx == null) { this.toggle(); return }
    if (this._overlay) {
      this._selIdx = idx
      this._rerender()
    } else {
      this._pendingSelIdx = idx
      this.open()
    }
  }

  toggle() {
    if (this._overlay) this.close()
    else this.open()
  }
  isOpen() { return !!this._overlay }

  open() {
    if (this._overlay) return
    // DAMNED · Blind Architect — the adventurer-intel panel is disabled.
    if (this._gameState?._mechanicFlags?.blindArchitect) {
      EventBus.emit('SHOW_TOAST', { text: 'Blind Architect — you have no intel.', kind: 'warn' })
      return
    }
    this._selIdx = this._pendingSelIdx ?? 0
    this._pendingSelIdx = null
    this._overlay = new Overlay({
      npcKind: 'intel',
      title:   'ADVENTURER INTEL',
      eyebrow: 'KNOW THY INVADERS',   // → crypt shell (eyebrow + no X)
      width:  1300,
      height: 820,
      accent: 'var(--warn)',
      frame:  'plain',   // subtle main-menu edge instead of the accent frame
      onClose: () => { this._overlay = null },
      body:   this._renderBody(),
    })
    this._overlay.open()
    this._warmSprites()
  }

  close() {
    this._overlay?.close()
    this._overlay = null
  }

  _rerender(skipWarm = false) {
    if (!this._overlay) return
    this._overlay.setBody(this._renderBody())
    if (!skipWarm) this._warmSprites()
  }

  // Warm the on-demand LPC base sheets for the adventurers shown, then
  // re-render (DOM-only, skipWarm=true so the warmer isn't re-armed) as each
  // sheet lands — so portraits show the real sprite instead of an empty box.
  _warmSprites() {
    warmAdvSnapshotsThen(this._adventurers(), () => this._rerender(true), 'advintel')
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

  // True only when a Library of Whispers is built and active. The
  // Library is the gating room for ALL adventurer intel — without one
  // the player should learn nothing about who is in (or coming to) the
  // dungeon. Mirrors the same gate RightPanels._forecastParty uses.
  _hasLibrary() {
    return (this._gameState.dungeon?.rooms ?? [])
      .some(r => r.definitionId === 'library_of_whispers' && r.isActive !== false)
  }

  _adventurers() {
    // Intel is Library-gated. With no Library placed, return an empty
    // roster so the panel falls through to the "build a LIBRARY" empty
    // state instead of leaking class / stat / sprite intel for free.
    if (!this._hasLibrary()) return []

    const phase = this._gameState.meta?.phase
    if (phase === 'day') {
      // In-dungeon adventurers, live data.
      return this._gameState.adventurers?.active ?? []
    }
    // Night phase — read the authoritative pre-spawn forecast that
    // NightPhase rolls (and re-rolls on every ROOM_PLACED) into
    // gameState.run.nextWavePreview. This carries:
    //   * classIds[]      — one per adv in the upcoming wave
    //   * spriteVariants[]— parallel "<sourceClass>/vNN" strings, the
    //                       EXACT sprite each adv will arrive with
    //   * eventType       — for guild raids / goblin heists
    //   * vendettaHunter  — optional extra adv hunting the player
    //
    // Previously this fell back to gameState.adventurers.known, which
    // is the HISTORICAL "ever-seen" pool — so the intel panel showed
    // last day's escapees instead of who's actually coming, and event
    // waves (guild raid 2x, goblins, etc.) never appeared.
    const preview = this._gameState.run?.nextWavePreview
    if (!preview || !Array.isArray(preview.classIds) || preview.classIds.length === 0) {
      // Fallback: panel shows the "INTEL UNKNOWN" empty state via the
      // length check in _renderBody — return empty rather than the
      // misleading .known pool.
      return preview?.vendettaHunter ? [this._stubFromVendetta(preview.vendettaHunter)] : []
    }
    const defs = this._cachedJson('adventurerClasses') ?? []
    const stubs = preview.classIds.map((classId, i) => {
      const stub = this._stubFromPreview(classId, preview.spriteVariants?.[i] ?? null, defs)
      // Phase QW (Library tiers) — attach the night-pre-rolled
      // personalities so tier-2+ reveals can render the same set the
      // wave will actually arrive with. Empty array when not pre-rolled
      // (legacy saves, event-replacement waves like Zombie Horde).
      const pids = preview.personalityIds?.[i]
      stub.personalityIds = Array.isArray(pids) ? [...pids] : []
      // Event waves carry pre-rolled sprites parallel to classIds —
      // minionSheets[i] = a `minion-<id>` key (rival monsters, zombies),
      // bossSkin = the rival boss's archetype skin. Attach them so the
      // stub renders the real creature, not a humanoid stand-in.
      if (Array.isArray(preview.minionSheets) && preview.minionSheets[i]) {
        stub._minionSheet = preview.minionSheets[i]
      }
      // Rival boss skin — Boss Royale carries a per-slot `bossSkins[]`
      // (each invader is a different archetype); Rival Dungeon carries a
      // single `bossSkin` for its lone champion. Prefer the per-slot array.
      if (classId === 'rival_boss_invader') {
        const skin = preview.bossSkins?.[i] ?? preview.bossSkin
        if (skin) stub._rivalBossSpriteKey = skin
      }
      return stub
    })
    if (preview.vendettaHunter) stubs.unshift(this._stubFromVendetta(preview.vendettaHunter, defs))
    return stubs
  }

  // Build a fake-but-renderable adv object out of a preview slot.
  // Mirrors what createAdventurer would produce just enough to satisfy
  // _threatScore, _classDef, _isVeteran, and _renderAdvSprite. Stats
  // come from the class JSON defaults (the live stats only exist after
  // spawn).
  //
  // Veteran flag is ALWAYS false here: a wave preview carries only
  // classId + spriteVariant, never per-adventurer identity (name).
  // We genuinely cannot know whether a specific upcoming adventurer
  // has raided before — flagging by class would mark every future
  // knight a veteran the moment one knight ever escaped. Veteran
  // status only becomes knowable once the adv spawns with a real
  // name (handled in _isVeteran's day-phase path).
  _stubFromPreview(classId, spriteVariant, defs) {
    const def = defs.find(d => d.id === classId) || null
    const baseStats = def?.baseStats || def?.stats || {}
    const name = def?.name || classId
    // The wave's display level — the same value DayPhase will stamp on
    // every adventurer when they actually spawn, so the preview matches.
    const level = this._waveLevel()
    // Scale HP/ATK to what they'll actually spawn with (shared formula),
    // so the preview doesn't show tiny class-base numbers next to a huge
    // scaled LV. Speed isn't scaled in-game, so it stays at the base.
    const { hpMul, atkMul } = this._waveScaleMuls()
    const hp  = Math.round((baseStats.hp     ?? baseStats.maxHp ?? 30) * hpMul)
    const atk = Math.round((baseStats.attack ?? baseStats.atk   ?? 5)  * atkMul)
    return {
      classId,
      spriteVariant,
      name: name + ' (incoming)',
      level,
      stats: {
        hp,
        attack: atk,
        speed:  baseStats.speed  ?? baseStats.spd   ?? 1.0,
      },
      // Mirror the scaled HP onto resources so the panel's
      // resources.maxHp-first read (and the threat score) pick it up.
      resources: { hp, maxHp: hp },
      isVeteran: false,
      redacted: false,
    }
  }

  _stubFromVendetta(hunter, defs) {
    const classId = hunter.claimantClass || 'knight'
    defs = defs || this._cachedJson('adventurerClasses') || []
    const def = defs.find(d => d.id === classId) || null
    const baseStats = def?.baseStats || def?.stats || {}
    return {
      classId,
      spriteVariant: hunter.spriteVariant || null,
      name: hunter.avengeeName
        ? `Avenger of ${hunter.avengeeName}`
        : 'Vendetta Hunter',
      level: this._waveLevel(),  // matches the level stamped at spawn
      // Vendetta hunters are slightly tougher than base (+10 HP / +2 ATK),
      // then scaled by the same wave multipliers so the preview tracks the
      // displayed LV. Speed isn't scaled in-game, so it stays at the base.
      ...(() => {
        const { hpMul, atkMul } = this._waveScaleMuls()
        const hp  = Math.round(((baseStats.hp     ?? 30) + 10) * hpMul)
        const atk = Math.round(((baseStats.attack ?? 5)  + 2)  * atkMul)
        return {
          stats: {
            hp,
            attack: atk,
            speed:  baseStats.speed ?? 1.0,
          },
          resources: { hp, maxHp: hp },
        }
      })(),
      // A vendetta hunter is a NEW adventurer come to avenge a fallen
      // comrade — they have not personally raided this dungeon before,
      // so they are not a "veteran" in the been-here-before sense.
      isVeteran: false,
      // Mark them so the detail panel can still surface the avenger
      // framing without claiming prior dungeon knowledge.
      isVendettaHunter: true,
      redacted: false,
    }
  }

  _classDef(adv) {
    const defs = this._cachedJson('adventurerClasses') ?? []
    return defs.find(d => d.id === adv.classId) || null
  }

  // Count of active Library of Whispers rooms in the dungeon. Drives
  // the tier-gated reveal during night phase.
  _libraryCount() {
    const rooms = this._gameState.dungeon?.rooms ?? []
    return rooms.filter(r =>
      r.definitionId === 'library_of_whispers' && r.isActive !== false
    ).length
  }

  // During day phase the panel always shows the truth (advs are visible
  // in the dungeon — Library is irrelevant). During night phase, reveals
  // are gated by Library count. Returns true when the field at `tier`
  // should be visible. `tier` is one of TIER_PERSONALITIES / TIER_STATS /
  // TIER_ROUTE.
  _canReveal(tier) {
    if (this._gameState.meta?.phase === 'day') return true
    return this._libraryCount() >= tier
  }

  // Personality definition lookup. Used for the personality chip row
  // (tier 2 reveal).
  _personalityDef(id) {
    const defs = this._cachedJson('personalities') ?? []
    return defs.find(d => d.id === id) || null
  }

  // Planned route — entry-hall → boss-chamber shortest path through the
  // currently-active rooms, with personality-driven detour bias
  // (e.g. greedy → biased toward Treasury). Returns an array of room
  // definitionIds in visit order, or empty if no clear path. Computed
  // on-demand at render time (Library tier 4 reveal).
  _plannedRoute(adv) {
    const rooms = this._gameState.dungeon?.rooms ?? []
    const entry = rooms.find(r => r.definitionId === 'entry_hall')
    const boss  = rooms.find(r => r.definitionId === 'boss_chamber')
    if (!entry || !boss) return []
    const grid = this._gameScene()?.dungeonGrid
    if (!grid?.getNeighborRooms) return []
    // Simple BFS through the door-graph; not the AI's real pathfinder,
    // but represents the most likely traversal order.
    const seen = new Set([entry.instanceId])
    const prev = new Map()
    const queue = [entry.instanceId]
    while (queue.length > 0) {
      const cur = queue.shift()
      if (cur === boss.instanceId) break
      const room = rooms.find(r => r.instanceId === cur)
      const neighbors = grid.getNeighborRooms(cur) ?? []
      for (const n of neighbors) {
        if (seen.has(n.instanceId) || n.isActive === false) continue
        seen.add(n.instanceId)
        prev.set(n.instanceId, cur)
        queue.push(n.instanceId)
      }
    }
    if (!prev.has(boss.instanceId)) return []
    const path = [boss.instanceId]
    let step = boss.instanceId
    while (prev.has(step)) {
      step = prev.get(step)
      path.unshift(step)
    }
    // Personality-driven detour notes: if any of the adv's personalities
    // imply attraction to a room category, surface that as a parenthetical.
    return path.map(id => rooms.find(r => r.instanceId === id)?.definitionId).filter(Boolean)
  }

  _gameScene() {
    return (typeof window !== 'undefined' && window.__game?.scene?.getScene)
      ? window.__game.scene.getScene('Game')
      : null
  }

  // Display level of the upcoming wave — matches the `displayLevel`
  // DayPhase stamps on each adventurer at spawn (see balance.js). The
  // wave targets the next day: during night phase that's the current
  // day counter, during day phase it's one ahead.
  _waveLevel() {
    const gs = this._gameState
    const phase = gs?.meta?.phase
    const nextDay = (gs?.meta?.dayNumber ?? 1) + (phase === 'day' ? 1 : 0)
    return adventurerDisplayLevel(
      gs?.boss?.level ?? 1,
      nextDay,
      gs?._mechanicFlags?.bloodMoneyHpBonus ?? 0,
    )
  }

  // HP/ATK scaling multipliers for the upcoming wave — same boss-level +
  // day + blood-money inputs as _waveLevel (and the SAME shared formula
  // DayPhase uses at spawn), so the preview's "(incoming)" HP/ATK match
  // both the displayed LV and the stats the advs will actually have.
  _waveScaleMuls() {
    const gs = this._gameState
    const phase = gs?.meta?.phase
    const nextDay = (gs?.meta?.dayNumber ?? 1) + (phase === 'day' ? 1 : 0)
    const base = adventurerScaleMultipliers(
      gs?.boss?.level ?? 1,
      nextDay,
      gs?._mechanicFlags?.bloodMoneyHpBonus ?? 0,
    )
    // Reckoning NG+ (KR P7) — the preview reflects the harder run, matching spawn.
    const ng = ngPlusEnemyMul(gs?.meta?.reckoningTier ?? 0)
    return { hpMul: base.hpMul * ng, atkMul: base.atkMul * ng }
  }

  _threatScore(adv) {
    // Rough heuristic — combine LV, hp, atk into a 0..100 score.
    const lv  = adv.displayLevel ?? adv.level ?? adv.lv ?? 1
    const atk = adv.stats?.attack ?? adv.atk ?? 5
    // HP comes from resources.maxHp — that's the scaled actual pool that
    // _scaleAdventurerByBossLevel writes. stats.hp is the unscaled class
    // base (never updated by scaling), so reading it first showed a tiny
    // wrong number on high-day/level advs. Matches InspectPopup.
    const hp  = adv.resources?.maxHp ?? adv.stats?.hp ?? adv.hp ?? 30
    const score = lv * 8 + atk * 2 + Math.min(40, hp / 2)
    return Math.max(0, Math.min(100, Math.round(score)))
  }

  // True only when THIS specific adventurer has raided before. The
  // adventurers.known pool is keyed by name (RunHistorySystem._onAdvFled
  // upserts by `k.name === adv.name`) and never carries an instanceId,
  // so we match by name and require an actual recorded escape. The old
  // `k.instanceId === adv.instanceId` test compared undefined to
  // undefined for wave-preview stubs and flagged the entire wave as
  // veterans the moment any adventurer had ever escaped.
  _isVeteran(adv) {
    if (adv.isVeteran) return true
    if (!adv.name) return false
    const known = this._gameState.adventurers?.known ?? []
    return known.some(k => k.name && k.name === adv.name && (k.escapeCount ?? 0) > 0)
  }

  _overallThreat(advs) {
    if (advs.length === 0) return 0
    return Math.round(
      advs.reduce((s, a) => s + this._threatScore(a), 0) / advs.length
    )
  }

  // ── Render ──────────────────────────────────────────────────────
  _renderBody() {
    const advs = this._adventurers()
    if (advs.length === 0) return this._renderEmpty()
    if (this._selIdx >= advs.length) this._selIdx = 0
    const sel = advs[this._selIdx]
    const veteranCount = advs.filter(a => this._isVeteran(a)).length
    const overall = this._overallThreat(advs)
    const phase = this._gameState.meta?.phase
    const day = this._gameState.meta?.dayNumber ?? 1
    const nextLabel = phase === 'night' ? `DAY ${day + 1} · DAWN` : `DAY ${day} · IN PROGRESS`

    return h('div', { className: 'qf-advintel-body' }, [
      // Summary strip
      h('div', { className: 'qf-advintel-summary' }, [
        this._summaryItem('NEXT WAVE',  nextLabel, 'var(--warn)'),
        h('div', { className: 'qf-advintel-divider' }),
        this._summaryItem('PARTY SIZE', `${advs.length} APPROACHING`, 'var(--text)'),
        h('div', { className: 'qf-advintel-divider' }),
        this._summaryItem(
          'HEROES',
          veteranCount > 0 ? `${veteranCount} ★ RETURN` : '— NONE —',
          veteranCount > 0 ? 'var(--warn)' : 'var(--text-mute)',
        ),
        h('div', { className: 'qf-advintel-divider' }),
        h('div', null, [
          h('div', { className: 'pix qf-advintel-summary-label' }, 'OVERALL THREAT'),
          this._threatMeter(overall),
        ]),
      ]),
      // Two-column main
      h('div', { className: 'qf-advintel-main' }, [
        this._renderList(advs),
        this._renderDetail(sel),
      ]),
    ])
  }

  _renderEmpty() {
    return h('div', { className: 'qf-advintel-empty' }, [
      h('div', { className: 'pix qf-advintel-empty-eyebrow' },
        '◇  INTEL UNKNOWN  ◇'),
      h('div', { className: 'qf-advintel-empty-flavor' },
        '"Listen for boots on the stair."'),
      h('div', { className: 'qf-advintel-empty-hint' },
        'Build a LIBRARY to peer into who comes calling.'),
    ])
  }

  _summaryItem(label, value, color) {
    return h('div', null, [
      h('div', { className: 'pix qf-advintel-summary-label' }, label),
      h('div', {
        className: 'pix qf-advintel-summary-value',
        style: { color },
      }, value),
    ])
  }

  _threatMeter(pct) {
    const segments = 10
    const filled = Math.round((pct / 100) * segments)
    return h('div', { className: 'qf-advintel-threat' },
      Array.from({ length: segments }).map((_, i) => {
        const lit = i < filled
        const color = i < 3 ? 'var(--poison)'
                    : i < 5 ? 'var(--gold)'
                    : i < 7 ? 'var(--warn)' : 'var(--blood)'
        return h('div', {
          className: 'qf-advintel-threat-cell',
          style: {
            background: lit ? color : 'var(--bg-1)',
            opacity: lit ? 1 : 0.4,
            boxShadow: lit ? `0 0 4px ${color}88` : 'none',
          },
        })
      })
    )
  }

  _renderList(advs) {
    const redactedCount = advs.filter(a => a.redacted).length
    return h('div', { className: 'panel bevel qf-advintel-listpanel' }, [
      h('div', { className: 'qf-advintel-listhead' }, [
        h('div', { className: 'pix qf-advintel-listhead-title' }, 'APPROACHING PARTY'),
        redactedCount > 0 && h('div', { className: 'pix qf-advintel-listhead-redact' },
          `${redactedCount} REDACTED · BUILD LIBRARY TO REVEAL`),
      ]),
      h('div', { className: 'qf-advintel-listbody' },
        advs.map((adv, i) => this._renderCard(adv, i))
      ),
    ])
  }

  _renderCard(adv, idx) {
    const score = this._threatScore(adv)
    const tier = tierFor(score)
    const active = idx === this._selIdx
    const def = this._classDef(adv)
    const name = adv.name || 'Unnamed'
    const classLabel = (def?.name || adv.classId || 'Adventurer').toUpperCase()
    // Sung Jinwoo's level reads as ∞ (flavour only — never used in any stat
    // calc; his real `level` is untouched).
    const lv = (adv._shadowMonarch || adv.classId === 'shadow_monarch')
      ? '∞' : (adv.displayLevel ?? adv.level ?? adv.lv ?? 1)
    const veteran = this._isVeteran(adv)
    const redacted = !!adv.redacted

    // Library tier 3 — at night, raw stats are hidden until the player
    // has 3+ Libraries. Render '?' placeholders so the slot is still
    // visible (preserves the row's visual rhythm) but the values are
    // redacted. Day phase always shows the live numbers (Library
    // irrelevant once the adv is in front of you).
    const _statsRevealed = this._canReveal(TIER_STATS)
    // HP from resources.maxHp (scaled actual), not stats.hp (unscaled base).
    const hp  = _statsRevealed ? (adv.resources?.maxHp ?? adv.stats?.hp ?? adv.hp ?? 30) : '?'
    const atk = _statsRevealed ? (adv.stats?.attack ?? adv.atk ?? 5) : '?'
    const spd = _statsRevealed ? (adv.stats?.speed ?? adv.spd ?? 1.0) : '?'

    return h('button', {
      className: 'qf-advintel-card',
      dataset: { active: active ? 'true' : 'false' },
      style: {
        '--threat-color': tier.color,
        background: active
          ? `linear-gradient(90deg, ${tier.color}1a, var(--bg-3))`
          : 'var(--bg-2)',
        borderColor: active ? tier.color : 'var(--line-2)',
        borderLeft: `3px solid ${tier.color}`,
        boxShadow: active ? `0 0 12px ${tier.color}33` : 'none',
      },
      on: { click: () => { this._selIdx = idx; this._rerender() } },
    }, [
      // Sprite — same LPC-snapshot treatment as the detail portrait.
      // The bestiary-portrait fallback under it covers cold-start
      // (textures not yet loaded) and event-class cases where no
      // adventurer LPC bake exists.
      h('div', {
        className: 'qf-advintel-sprite',
        style: {
          filter: redacted ? 'grayscale(0.85) brightness(0.5)' : 'none',
          ...this._classSpriteBg(adv),
        },
      }, [
        this._renderAdvSprite(adv),
      ]),
      // Info
      h('div', { className: 'qf-advintel-card-info' }, [
        h('div', { className: 'qf-advintel-card-row' }, [
          h('span', {
            className: 'pix qf-advintel-card-name',
            style: { color: redacted ? 'var(--text-dim)' : 'var(--text)' },
          }, name),
          veteran && h('span', {
            className: 'pix qf-advintel-card-vet',
            title: 'returning hero',
          }, '★ HERO'),
        ]),
        h('div', { className: 'pix qf-advintel-card-class' }, lv === '∞'
          ? [`${classLabel} · LV `, h('span', { style: { fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontWeight: 'bold', lineHeight: '1' } }, '∞')]
          : `${classLabel} · LV ${lv}`),
        h('div', { className: 'qf-advintel-card-stats' }, [
          h('span', null, [h('span', { style: { color: 'var(--hp)' } }, 'HP'), ' ', _statsRevealed ? String(hp) : '?']),
          h('span', null, [h('span', { style: { color: 'var(--blood)' } }, 'ATK'), ' ', _statsRevealed ? String(atk) : '?']),
          h('span', null, [h('span', { style: { color: 'var(--gold)' } }, 'SPD'), ' ', _statsRevealed ? (spd?.toFixed?.(1) ?? String(spd)) : '?']),
        ]),
      ]),
      // Threat chip
      h('div', { className: 'qf-advintel-card-chipcol' }, [
        h('span', {
          className: 'pix qf-advintel-card-chip',
          style: {
            color: tier.color,
            background: `${tier.color.replace(')', '1a)').replace('var(', 'var(')}`,
            borderColor: tier.color,
          },
        }, tier.label),
        redacted && h('span', { className: 'pix qf-advintel-card-redact' }, '🔒 REDACTED'),
      ]),
    ])
  }

  _renderDetail(sel) {
    const score = this._threatScore(sel)
    const tier = tierFor(score)
    const def = this._classDef(sel)
    const name = sel.name || 'Unnamed'
    const classLabel = (def?.name || sel.classId || 'Adventurer').toUpperCase()
    // Jinwoo's level shows as ∞ (flavour only — see card renderer above).
    const lv = (sel._shadowMonarch || sel.classId === 'shadow_monarch')
      ? '∞' : (sel.level ?? sel.lv ?? 1)
    // Library tier reveals — drives which sections of the detail card
    // are visible. Stats require Tier 3 (3+ Libs);
    // personalities require Tier 2 (2+ Libs); planned route requires
    // Tier 4 (4 Libs). Day phase is always "all revealed".
    const _statsRevealed         = this._canReveal(TIER_STATS)
    const _personalitiesRevealed = this._canReveal(TIER_PERSONALITIES)
    const _routeRevealed         = this._canReveal(TIER_ROUTE)
    const libCount               = this._libraryCount()
    const isNight                = this._gameState.meta?.phase === 'night'
    // HP from resources.maxHp (scaled actual), not stats.hp (unscaled base).
    const hp  = sel.resources?.maxHp ?? sel.stats?.hp ?? sel.hp ?? 30
    const atk = sel.stats?.attack ?? sel.atk ?? 5
    const spd = sel.stats?.speed ?? sel.spd ?? 1.0
    const notes = def?.flavorText || def?.description || '—'
    const veteran = this._isVeteran(sel)
    const redacted = !!sel.redacted
    const intel = this._knownAboutDungeon(sel)
    const personalityIds = Array.isArray(sel.personalityIds) ? sel.personalityIds : []
    const plannedRoute = _routeRevealed ? this._plannedRoute(sel) : []
    const roomDefs = this._cachedJson('rooms') ?? []
    const _roomLabel = (defId) => roomDefs.find(d => d.id === defId)?.name?.toUpperCase() ?? String(defId).toUpperCase()

    return h('div', { className: 'qf-advintel-detail' }, [
      // Adv detail card
      h('div', { className: 'panel bevel qf-advintel-detail-card' }, [
        h('div', { className: 'qf-advintel-detail-head' }, [
          h('div', {
            className: 'qf-advintel-detail-portrait',
            style: {
              borderColor: tier.color,
              boxShadow: `inset 0 0 0 1px var(--bg-0), 0 0 14px ${tier.color}33`,
              filter: redacted ? 'grayscale(0.7) brightness(0.6)' : 'none',
              ...this._classSpriteBg(sel),
            },
          }, [
            // Real LPC adventurer snapshot — uses this specific adv's
            // pre-rolled spriteVariant when it exists (every spawned adv
            // has one), falls through to v01 if we only have the
            // classId (e.g. a Library forecast row before spawn time).
            // Layered on TOP of the bestiary portrait background fill,
            // so on a cold start the bg shows until the LPC bake lands.
            this._renderAdvSprite(sel),
          ]),
          h('div', { className: 'qf-advintel-detail-info' }, [
            h('div', { className: 'pix qf-advintel-detail-class' }, lv === '∞'
              ? [`${classLabel} · LV `, h('span', { style: { fontFamily: 'system-ui, sans-serif', fontSize: '17px', fontWeight: 'bold', lineHeight: '1' } }, '∞')]
              : `${classLabel} · LV ${lv}`),
            h('div', {
              className: 'pix qf-advintel-detail-name',
              style: { color: redacted ? 'var(--text-dim)' : 'var(--text)' },
            }, name),
            h('div', { className: 'qf-advintel-detail-chiprow' }, [
              h('span', {
                className: 'pix qf-advintel-detail-chip',
                style: { color: tier.color, borderColor: tier.color },
              }, `THREAT · ${tier.label}`),
              veteran && h('span', {
                className: 'pix qf-advintel-detail-vetchip',
              }, '★ HERO'),
            ]),
          ]),
        ]),
        // Stat row — redacted at night until 3+ Libraries are built.
        h('div', { className: 'qf-advintel-detail-stats' }, [
          this._statTile('HP',  _statsRevealed ? String(hp)                       : '?', 'var(--hp)'),
          this._statTile('ATK', _statsRevealed ? String(atk)                      : '?', 'var(--blood)'),
          this._statTile('SPD', _statsRevealed ? (spd?.toFixed?.(1) ?? String(spd)) : '?', 'var(--gold)'),
        ]),
        // Library tier 2 — personality chips. Visible during day phase
        // (live truth), or at night with 2+ Libraries. With fewer Libraries
        // shows a redaction stub explaining how to unlock.
        h('div', { className: 'qf-advintel-detail-personalities' }, [
          h('div', { className: 'pix qf-advintel-relation-label rumor' }, 'TENDENCIES'),
          (_personalitiesRevealed && personalityIds.length > 0)
            ? h('div', { className: 'qf-advintel-chips' },
                personalityIds.map(pid => {
                  const pd = this._personalityDef(pid)
                  const label = (pd?.name ?? pid).toUpperCase()
                  const flavor = pd?.flavorText || pd?.description || ''
                  return h('span', {
                    className: 'pix qf-advintel-chip qf-advintel-chip-rumor',
                    title: flavor,
                  }, label)
                })
              )
            : (_personalitiesRevealed
                ? h('div', { className: 'qf-advintel-chips' },
                    [h('span', { className: 'qf-advintel-chip-empty' }, '—')])
                : h('div', { className: 'qf-advintel-redact-note' },
                    isNight
                      ? `🔒 build ${TIER_PERSONALITIES - libCount} more LIBRARY to reveal`
                      : '—')
              ),
        ]),
        // Notes
        h('div', { className: 'qf-advintel-detail-notes' }, notes),
      ]),
      // Intel ledger
      h('div', { className: 'panel bevel qf-advintel-ledger' }, [
        h('div', { className: 'qf-advintel-ledger-head' }, [
          h('div', { className: 'pix qf-advintel-ledger-title' },
            veteran ? "WHAT THEY'LL TELL THE OTHERS" : 'WHAT THEY KNOW'),
        ]),
        h('div', { className: 'qf-advintel-ledger-body' },
          intel.length === 0
            ? [h('div', { className: 'qf-advintel-ledger-empty' },
                'No corroborated intel. They walk in blind.')]
            : intel.map(line => h('div', { className: 'qf-advintel-ledger-row' }, [
                h('span', { className: 'qf-advintel-ledger-icon' }, '⚠'),
                h('span', null, line),
              ]))
        ),
        // Library tier 4 — planned route through the dungeon. Visible
        // during day phase or at night with all 4 Libraries. Computed
        // on-demand via _plannedRoute (entry → boss BFS through the
        // active room graph). Hidden at lower tiers with a redaction
        // stub explaining how to unlock.
        h('div', { className: 'qf-advintel-route' }, [
          h('div', { className: 'pix qf-advintel-counter-label' }, '◇ PLANNED ROUTE'),
          _routeRevealed
            ? (plannedRoute.length > 0
                ? h('div', { className: 'qf-advintel-route-list' },
                    plannedRoute.map((defId, idx) => h('span', { className: 'qf-advintel-route-step' }, [
                      idx > 0 ? h('span', { className: 'qf-advintel-route-arrow' }, ' › ') : null,
                      h('span', {
                        className: 'pix qf-advintel-route-room',
                        style: { color: defId === 'boss_chamber' ? 'var(--blood)'
                                      : defId === 'entry_hall'   ? 'var(--text-mute)'
                                      : 'var(--text)' },
                      }, _roomLabel(defId)),
                    ]))
                  )
                : h('div', { className: 'qf-advintel-route-empty' },
                    'No clear path entry → boss.')
              )
            : h('div', { className: 'qf-advintel-redact-note' },
                isNight
                  ? `🔒 build ${TIER_ROUTE - libCount} more LIBRARY to reveal`
                  : '—'),
        ]),
      ]),
    ])
  }

  _statTile(label, value, color) {
    return h('div', { className: 'qf-advintel-stat' }, [
      h('div', {
        className: 'pix qf-advintel-stat-value',
        style: { color },
      }, value),
      h('div', { className: 'pix qf-advintel-stat-label' }, label),
    ])
  }

  // What this adv knows about the dungeon — pulled from the shared
  // knowledge pool keyed by room / trap / item instance IDs. Returns a
  // list of human-readable strings. Surfaces rooms, minions, traps, and
  // placed items uniformly so this ledger matches the other intel
  // surfaces (KnowledgeScreen / RightPanels / KnowledgeMap).
  _knownAboutDungeon(adv) {
    const pool = this._gameState.knowledge?.sharedPool ?? {}
    const out = []
    const rooms = this._gameState.dungeon?.rooms ?? []
    const traps = this._gameState.dungeon?.traps ?? []
    const roomDefs = this._cachedJson('rooms') ?? []
    const trapDefs = this._cachedJson('trapTypes') ?? []
    const itemDefs = this._cachedJson('items') ?? []
    const roomName = (id) => {
      const r = rooms.find(x => x.instanceId === id)
      const d = roomDefs.find(x => x.id === r?.definitionId)
      return d?.name ?? r?.definitionId ?? id
    }
    const trapName = (id) => {
      const t = traps.find(x => x.instanceId === id)
      const d = trapDefs.find(x => x.id === t?.definitionId)
      return d?.name ?? t?.definitionId ?? id
    }
    const itemName = (entry) => {
      const d = itemDefs.find(x => x.id === entry?.itemType)
      return d?.name ?? entry?.itemType ?? 'placed item'
    }
    for (const k of Object.keys(pool.rooms ?? {}).slice(0, 4)) {
      out.push(`Knows the ${roomName(k)} exists.`)
    }
    for (const k of Object.keys(pool.enemiesPerRoom ?? {}).slice(0, 3)) {
      out.push(`Has seen guards in the ${roomName(k)}.`)
    }
    for (const k of Object.keys(pool.traps ?? {}).slice(0, 3)) {
      out.push(`Knows where the ${trapName(k)} is set.`)
    }
    for (const e of Object.values(pool.items ?? {}).slice(0, 3)) {
      out.push(`Knows the ${itemName(e)} is placed.`)
    }
    // Only claim prior dungeon knowledge for genuine veterans — same
    // name-keyed check as the veteran badge. The old instanceId test
    // matched undefined-to-undefined and added this line for every
    // adventurer once anyone had escaped.
    if (this._isVeteran(adv)) {
      out.unshift('Has been here before — full layout map.')
    }
    return out
  }

  // Real LPC adventurer sprite, anchored at the bottom of the portrait
  // box. Returns null when neither the spriteVariant nor the class's
  // v01 texture is loaded (cold-start) so the background portrait
  // shows through unobscured.
  _renderAdvSprite(adv) {
    const snap = snapshotAdventurerEntity(adv, 120)
    if (!snap) return null
    snap.style.position = 'absolute'
    snap.style.left = '50%'
    snap.style.bottom = '4px'
    snap.style.transform = 'translateX(-50%)'
    snap.style.imageRendering = 'pixelated'
    snap.style.pointerEvents = 'none'
    snap.classList.add('qf-advintel-sprite')
    return snap
  }

  // Neutral dark disc placeholder behind the portrait. The real LPC sprite
  // layers on top via _renderAdvSprite once its on-demand sheet streams in
  // (warmed by _warmSprites). NOTE: adventurer classes ship NO bestiary
  // portrait — only the 12 boss archetypes do — so we must not request a
  // per-class `${id}_p.png` here (it 404s for every adventurer card).
  _classSpriteBg(adv) {
    return {
      backgroundImage: 'radial-gradient(circle at center, var(--bg-2), var(--bg-0))',
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      imageRendering: 'pixelated',
    }
  }

  destroy() {
    EventBus.off('OPEN_ADV_INTEL', this._listener)
    this._overlay?.close()
    this._overlay = null
  }
}

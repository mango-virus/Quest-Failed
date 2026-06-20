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
import { TrayShell } from './TrayShell.js'
import { EventBus } from '../systems/EventBus.js'
import { snapshotAdventurerEntity, warmAdvSnapshotsThen } from './inGameSnapshot.js'
import { adventurerDisplayLevel, adventurerScaleMultipliers, ngPlusEnemyMul } from '../config/balance.js'
import { hasActiveLibrary, hasClassIntel } from './wavePreview.js'

const THREAT_TIERS = [
  { label: 'CRITICAL', color: 'var(--blood)',  min: 75 },
  { label: 'HIGH',     color: 'var(--warn)',   min: 50 },
  { label: 'MODERATE', color: 'var(--gold)',   min: 25 },
  { label: 'LOW',      color: 'var(--poison)', min: 0 },
]

function tierFor(score) {
  return THREAT_TIERS.find(t => score >= t.min) || THREAT_TIERS[3]
}

// Library intel gate (2026-06-20): a single active Library of Whispers
// reveals ALL intel — size, classes, personalities, scaled stats and route.
// (The old tiered model that required more Libraries for deeper intel was
// dropped; the Library is now capped at 1 per dungeon.)
//   0 → empty state ("Build a LIBRARY")
//   1 → everything
// Day-phase view is the live truth (Library irrelevant once they arrive —
// you can see them).
const TIER_PERSONALITIES = 1
const TIER_STATS         = 1

export class AdvIntelOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._tray = null
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
    if (this._tray) {
      this._selIdx = idx
      this._rerender()
    } else {
      this._pendingSelIdx = idx
      this.open()
    }
  }

  toggle() {
    if (this._tray) this.close()
    else this.open()
  }
  isOpen() { return !!this._tray }

  // Intel now flies out of its action-bar button as an anchored tray (a
  // bespoke threat-briefing dossier) instead of the old full-screen Overlay.
  // All forecast / threat / reveal-gating helpers below are reused.
  open() {
    if (this._tray) return
    // DAMNED · Blind Architect — the adventurer-intel panel is disabled.
    if (this._gameState?._mechanicFlags?.blindArchitect) {
      EventBus.emit('SHOW_TOAST', { text: 'Blind Architect — you have no intel.', kind: 'warn' })
      return
    }
    this._selIdx = this._pendingSelIdx ?? 0
    this._pendingSelIdx = null
    this._tray = new TrayShell({
      anchorSel: '[data-tray-anchor="INTEL"]',
      align:  'right',
      vAlign: 'up',
      accent: 'var(--info)',
      width:  'min(46vw, 760px)',
      height: 384,
      onClose: () => { this._tray = null },
    })
    this._tray.setContent(this._renderTrayContent())
    this._tray.open()
    this._warmSprites()
  }

  close() {
    this._tray?.close()
    this._tray = null
  }

  _rerender(skipWarm = false) {
    if (!this._tray) return
    this._tray.setContent(this._renderTrayContent())
    if (!skipWarm) this._warmSprites()
  }

  // ── Bespoke intel tray (threat briefing) ────────────────────────
  _renderTrayContent() {
    const advs = this._adventurers()
    if (advs.length === 0) return this._renderTrayEmpty()
    if (this._selIdx >= advs.length) this._selIdx = 0
    const sel = advs[this._selIdx]
    const day = this._gameState.meta?.dayNumber ?? 1
    const phase = this._gameState.meta?.phase
    const eyebrow = phase === 'night' ? `DAY ${day + 1} · INCOMING COLUMN` : `DAY ${day} · IN PROGRESS`
    const overall = this._overallThreat(advs)
    const oTier = tierFor(overall)
    const filled = Math.round((overall / 100) * 16)
    const segs = Array.from({ length: 16 }, (_, i) => h('span', {
      className: 'itl-seg' + (i < filled ? ' lit' : ''),
      style: { '--i': i, '--sc': i < 6 ? 'var(--poison)' : i < 11 ? 'var(--gold)' : 'var(--blood)' },
    }))
    const banner = h('div', { className: 'itl-banner', style: { '--tc': oTier.color } }, [
      h('div', { className: 'itl-bn-l' }, [
        h('span', { className: 'itl-bn-eye' }, eyebrow),
        h('span', { className: 'itl-bn-ttl' }, `${advs.length}-STRONG COLUMN`),
      ]),
      h('div', { className: 'itl-bn-meta' }, [
        h('div', { className: 'itl-size' }, [ h('span', { className: 'v' }, String(advs.length)), h('span', { className: 'l' }, 'STRONG') ]),
        h('div', { className: 'itl-meter-wrap' }, [
          h('div', { className: 'itl-meter-top' }, [ h('span', null, 'THREAT'), h('b', null, oTier.label) ]),
          h('div', { className: 'itl-meter' }, segs),
        ]),
      ]),
    ])
    const lineup = h('div', { className: 'itl-lineup' }, advs.map((p, i) => {
      const tc = tierFor(this._threatScore(p)).color
      const def = this._classDef(p)
      const cls = (def?.name || p.classId || 'Adventurer')
      const lv = p.level ?? p.lv ?? 1
      return h('button', {
        className: 'itl-bust' + (this._selIdx === i ? ' on' : ''),
        style: { '--tc2': tc, '--i': i },
        on: { click: () => { this._selIdx = i; this._rerender() } },
      }, [
        h('span', { className: 'itl-bust-port' }, [ this._renderAdvSprite(p) ].filter(Boolean)),
        h('span', { className: 'itl-bust-id' }, [
          h('span', { className: 'itl-bust-n' }, p.name || cls),
          h('span', { className: 'itl-bust-c' }, `${cls} · LV ${lv}`),
        ]),
        h('span', { className: 'itl-bust-th' }),
      ])
    }))
    return h('div', { className: 'itl-wrap' }, [
      banner,
      h('div', { className: 'itl-main' }, [ lineup, this._renderIntelDossier(sel) ]),
    ])
  }

  _renderIntelDossier(sel) {
    const tier = tierFor(this._threatScore(sel))
    const def = this._classDef(sel)
    const cls = (def?.name || sel.classId || 'Adventurer')
    const lv = sel.level ?? sel.lv ?? 1
    // Per-class intel gate (2026-06-20): full dossier (stats / personality /
    // abilities) unlocks only with a Library AND a kill of this class this run.
    // Event-tier invaders are exempt from the kill (handled in hasClassIntel).
    const intel = hasClassIntel(this._gameState, def)
    const statsRev = intel
    const persRev = intel
    const hp = sel.resources?.maxHp ?? sel.stats?.hp ?? 30
    const atk = sel.stats?.attack ?? def?.baseStats?.attack ?? 5
    const dfn = sel.stats?.defense ?? def?.baseStats?.defense ?? 0
    const spd = sel.stats?.speed ?? def?.baseStats?.speed ?? 1
    const flavor = def?.flavorText || def?.description || ''
    const pids = Array.isArray(sel.personalityIds) ? sel.personalityIds : []
    const statTile = (v, l) => h('div', { className: 'itl-stat' }, [
      h('span', { className: 'v' }, statsRev ? String(v) : '?'),
      h('span', { className: 'l' }, l),
    ])
    return h('div', { className: 'itl-dossier', style: { '--tc2': tier.color } }, [
      h('div', { className: 'itl-dtop' }, [
        h('span', { className: 'itl-dport', style: this._classSpriteBg(sel) }, [ this._renderAdvSprite(sel) ].filter(Boolean)),
        h('div', { className: 'itl-dhead' }, [
          h('span', { className: 'itl-dname' }, sel.name || cls),
          h('span', { className: 'itl-dsub' }, `${cls} · LV ${lv}`),
          h('span', { className: 'itl-dthreat' }, `◆ ${tier.label} THREAT`),
        ]),
      ]),
      h('div', { className: 'itl-stats' }, [
        statTile(hp, 'HP'),
        statTile(atk, 'ATK'),
        statTile(dfn, 'DEF'),
        statTile(typeof spd === 'number' ? spd.toFixed(1) : spd, 'SPD'),
        h('div', { className: 'itl-stat' }, [ h('span', { className: 'v' }, String(lv)), h('span', { className: 'l' }, 'LVL') ]),
      ]),
      flavor ? h('div', { className: 'itl-flavor' }, `“${flavor}”`) : null,
      // Unlocked → behavioural tendencies (personalities) + the ability kit.
      // Locked → a single notice telling the player how to unlock the dossier.
      ...(intel
        ? [
            h('div', { className: 'itl-abils' },
              pids.length
                ? pids.map(pid => {
                    const pd = this._personalityDef(pid)
                    return h('div', { className: 'itl-abil' }, [
                      h('span', { className: 'itl-abil-n' }, (pd?.name ?? pid).toUpperCase()),
                      h('span', { className: 'itl-abil-d' }, pd?.flavorText || pd?.description || ''),
                    ])
                  })
                : [ h('div', { className: 'itl-abil' }, [
                    h('span', { className: 'itl-abil-n' }, 'TENDENCIES'),
                    h('span', { className: 'itl-abil-d' }, '—'),
                  ]) ]),
            this._dossierAbilities(def),
          ]
        : [ this._dossierLocked(cls) ]),
    ].filter(Boolean))
  }

  // The ability kit for an unlocked class — each ability's name + what it
  // does (from adventurerClasses.json's `abilities`). Null for classes
  // without authored abilities (most event-only invaders).
  _dossierAbilities(def) {
    const abilities = Array.isArray(def?.abilities) ? def.abilities : []
    if (!abilities.length) return null
    return h('div', { className: 'itl-abils itl-kit' }, [
      h('div', { className: 'itl-abil itl-kit-hd' }, [
        h('span', { className: 'itl-abil-n' }, 'ABILITIES'),
        h('span', { className: 'itl-abil-d' }, ''),
      ]),
      ...abilities.map(ab => h('div', { className: 'itl-abil' }, [
        h('span', { className: 'itl-abil-n' }, String(ab.name || '').toUpperCase()),
        h('span', { className: 'itl-abil-d' }, ab.desc || ''),
      ])),
    ])
  }

  // Locked-dossier notice — shown when the class's intel isn't unlocked yet.
  // Tells the player exactly what's missing (a Library, or a kill of this
  // class this run).
  _dossierLocked(cls) {
    const notice = hasActiveLibrary(this._gameState)
      ? `Defeat a ${cls} this run to reveal its stats, tactics & abilities.`
      : 'Build a Library of Whispers to gather adventurer intel.'
    return h('div', { className: 'itl-abils itl-locked' }, [
      h('div', { className: 'itl-abil' }, [
        h('span', { className: 'itl-abil-n' }, '⊘ LOCKED'),
        h('span', { className: 'itl-abil-d' }, notice),
      ]),
    ])
  }

  _renderTrayEmpty() {
    return h('div', { className: 'itl-wrap' }, [
      h('div', { className: 'itl-empty' }, [
        h('div', { className: 'itl-empty-eye' }, '◇  INTEL UNKNOWN  ◇'),
        h('div', { className: 'itl-empty-flavor' }, '“Listen for boots on the stair.”'),
        h('div', { className: 'itl-empty-hint' }, 'Build a LIBRARY to peer into who comes calling.'),
      ]),
    ])
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

  _overallThreat(advs) {
    if (advs.length === 0) return 0
    return Math.round(
      advs.reduce((s, a) => s + this._threatScore(a), 0) / advs.length
    )
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

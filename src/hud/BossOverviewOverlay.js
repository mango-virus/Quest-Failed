// BossOverviewOverlay — DOM port of the design's Boss Overview popup
// (overlays.jsx → BossOverlay).
//
// Two-column layout. Left: cinematic portrait card (counter-rotating
// rune rings, corner registration marks, big sprite, gold LV chip, hearts
// row, boss name + tagline + flavor, chip-damage HP + XP bars, tally
// grid). Right: 3-tab dossier (OVERVIEW / ABILITIES / PACTS).
//
// OVERVIEW: top-2 abilities preview + VIEW ALL link → ABILITIES tab,
//           active pacts list, dungeon census (4 stat tiles).
// ABILITIES: full 4-row ability tree (locked rows desaturated).
// PACTS: expanded pact rows; hover surfaces PactDetailPopup via
//        SHOW_PACT_DETAIL event.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'
import { animatedBossSprite } from './inGameSnapshot.js'
import { ascensionInfo, currentAct } from '../config/acts.js'
import { TROPHY_TYPES } from '../config/orcTrophies.js'

export class BossOverviewOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._tab = 'overview'
    this._listener = () => this.toggle()
    EventBus.on('OPEN_BOSS_OVERVIEW', this._listener)
  }

  toggle() {
    if (this._overlay) this.close()
    else this.open()
  }
  isOpen() { return !!this._overlay }

  open() {
    if (this._overlay) return
    this._tab = 'overview'
    this._overlay = new Overlay({
      npcKind: 'boss',
      title:  'BOSS OVERVIEW',
      width:  1300,
      height: 820,
      accent: 'var(--blood)',
      frame:  'plain',   // subtle main-menu edge instead of the accent frame
      onClose: () => { this._overlay = null },
      body:   this._renderBody(),
    })
    this._overlay.open()
  }

  close() {
    this._bossSprite?.stop?.()
    this._bossSprite = null
    this._overlay?.close()
    this._overlay = null
  }

  _rerender() {
    if (this._overlay) this._overlay.setBody(this._renderBody())
  }

  // True when the active tab changed since last render — drives the tab-swap
  // fade (fires on tab switches, not on passive refreshes).
  _consumeTabSwap() {
    const changed = this._tab !== this._lastRenderedTab
    this._lastRenderedTab = this._tab
    return changed
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

  _archetype() {
    const rawId = this._gameState.player?.bossArchetypeId
    if (!rawId) return null
    const id = String(rawId).replace(/^the_/, '')
    const archs = this._cachedJson('bossArchetypes') ?? []
    return archs.find(a => a.id === id || a.id === rawId) || null
  }

  // Per-archetype abilities. The Phaser BossOverviewPopup pulls these
  // from the active archetype's `headline` + `mechanics` arrays in
  // bossArchetypes.json — they're the archetype's signature kit. The
  // DOM port was previously reading bossAbilities.json (a generic
  // pool of unlockable boss abilities used elsewhere), which showed
  // abilities from OTHER archetypes regardless of who you were playing.
  _abilities() {
    const arch = this._archetype()
    if (!arch) return []
    const out = []
    if (arch.headline?.name) {
      out.push({
        id: `${arch.id}_headline`,
        name: arch.headline.name,
        description: arch.headline.summary ?? '',
        unlocked: true,
        implemented: arch.headline.implemented !== false,
      })
    }
    for (const m of (arch.mechanics ?? [])) {
      const text = m?.text ?? ''
      // Convention: mechanic text is "Name — description". Split into a
      // name + description pair when possible; otherwise treat the whole
      // string as the description with a generic name.
      const dash = text.indexOf(' — ')
      const name = dash > 0 ? text.slice(0, dash) : 'Mechanic'
      const desc = dash > 0 ? text.slice(dash + 3) : text
      out.push({
        id: `${arch.id}_${name.toLowerCase().replace(/\s+/g, '_')}`,
        name,
        description: desc,
        unlocked: true,
        implemented: m?.implemented !== false,
      })
    }
    return out
  }

  _activePacts() {
    const ids = this._gameState.activeMechanics ?? []
    const defs = this._cachedJson('dungeonMechanics') ?? []
    return ids.map(id => defs.find(d => d.id === id)).filter(Boolean)
  }

  // Pact rarity → tier colour (mirrors TopBar._rarityColor so the boss
  // overview, the in-game pact strip and the grimoire all agree on hue).
  _rarityColor(rarity) {
    switch (String(rarity || 'common').toLowerCase()) {
      case 'damned':    return '#3a2b30'   // black grimoire (near-black, blood sheen) — epic owns purple
      case 'legendary': return 'var(--blood)'
      case 'epic':      return 'var(--info)'
      case 'rare':      return 'var(--gold)'
      case 'uncommon':  return 'var(--poison)'
      default:          return 'var(--text-mute)'
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  _renderBody() {
    return h('div', { className: 'qf-boss-body' }, [
      this._renderLeft(),
      this._renderRight(),
    ])
  }

  _renderLeft() {
    const gs = this._gameState
    const arch = this._archetype()
    const archId = String(gs.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    const hp    = gs.boss?.hp ?? 0
    const maxHp = gs.boss?.maxHp ?? 100
    const xp    = gs.boss?.xp ?? 0
    const xpMax = gs.boss?.xpToNext ?? 100
    const level = gs.boss?.level ?? 1
    const lives = gs.boss?.deathsRemaining ?? 3
    const atk   = gs.boss?.attack  ?? 0
    const def   = gs.boss?.defense ?? 0
    const hpPct = maxHp > 0 ? (hp / maxHp) * 100 : 0
    const xpPct = xpMax > 0 ? Math.min(100, (xp / xpMax) * 100) : 0
    const archName = (arch?.name || archId).toUpperCase()
    const tagline  = (arch?.tagline || arch?.description || '').toUpperCase()
    const flavor   = arch?.flavorText || arch?.description || ''
    const totals = gs.run?.totals ?? {}

    return h('div', { className: 'panel bevel qf-boss-left' }, [
      // Portrait card
      h('div', { className: 'qf-boss-portrait' }, [
        // Counter-rotating rune rings
        h('div', { className: 'qf-boss-ring qf-boss-ring-outer' }),
        h('div', { className: 'qf-boss-ring qf-boss-ring-inner' }),
        // Corner registration marks
        ...['tl','tr','bl','br'].map(p => h('div', {
          className: `qf-boss-corner qf-boss-corner-${p}`,
        })),
        // Big boss sprite — live idle animation from the boss's sheet,
        // falling back to the static bestiary portrait if it can't load.
        this._buildBossSprite(archId),
        // LV chip
        h('div', { className: 'pix qf-boss-lv-chip' }, `LV ${level}`),
        // Evolution form badge (KR P6) — the boss's current per-act form. Only
        // present in a campaign run (ascensionInfo null otherwise).
        this._formBadge(),
        // Hearts row
        h('div', { className: 'qf-boss-hearts' }, [
          ...[1,2,3].map(i => h('span', {
            className: i <= lives ? 'heart' : 'heart empty',
          })),
        ]),
      ]),
      // Vitals
      h('div', { className: 'qf-boss-vitals' }, [
        h('div', { className: 'pix qf-boss-archname' }, archName || 'BOSS'),
        h('div', { className: 'pix qf-boss-tagline' }, tagline || 'CHAMPION OF THE PIT'),
        flavor && h('div', { className: 'qf-boss-flavor' }, `"${flavor}"`),
        // HP
        h('div', { className: 'qf-boss-barhead' }, [
          h('span', null, 'HP'),
          h('span', {
            style: { color: hpPct < 30 ? 'var(--hp-low)' : 'var(--text)' },
          }, `${hp} / ${maxHp}`),
        ]),
        h('div', {
          className: `bar chip-bar ${hpPct < 30 ? 'heartbeat' : ''}`,
          style: { marginBottom: '10px' },
        }, [
          h('div', { className: 'fill ghost', style: { width: `${hpPct}%` } }),
          h('div', {
            className: 'fill',
            style: { width: `${hpPct}%`, background: hpPct < 30 ? 'var(--hp-low)' : 'var(--hp)' },
          }),
        ]),
        // XP
        h('div', { className: 'qf-boss-barhead' }, [
          h('span', null, `XP TO LV ${level + 1}`),
          h('span', { style: { color: 'var(--xp-bright)' } }, `${xp} / ${xpMax}`),
        ]),
        h('div', { className: 'bar xp' }, [
          h('div', { className: 'fill', style: { width: `${xpPct}%` } }),
        ]),
        // Live combat stats — ATK / DEF chips. Sits with HP/XP rather
        // than the run-totals tally below because these are state
        // values the boss carries into every fight, not historical
        // counters. Per-level growth via BOSS_ATK_PER_LEVEL /
        // BOSS_DEF_PER_LEVEL means the numbers climb visibly as the
        // boss earns XP — important for the player to see "I'm
        // hitting for 17 / soaking 15" when planning the next fight.
        h('div', { className: 'qf-boss-statpair' }, [
          h('div', { className: 'qf-boss-statchip' }, [
            h('span', {
              className: 'qf-boss-statchip-icon',
              style: { color: 'var(--gold)' },
            }, '⚔'),
            h('span', { className: 'pix qf-boss-statchip-label' }, 'ATK'),
            h('span', {
              className: 'pix qf-boss-statchip-value',
              style: { color: 'var(--gold)' },
            }, String(atk)),
          ]),
          h('div', { className: 'qf-boss-statchip' }, [
            h('span', {
              className: 'qf-boss-statchip-icon',
              style: { color: 'var(--info)' },
            }, '◈'),
            h('span', { className: 'pix qf-boss-statchip-label' }, 'DEF'),
            h('span', {
              className: 'pix qf-boss-statchip-value',
              style: { color: 'var(--info)' },
            }, String(def)),
          ]),
        ]),
        // Dark-ascension panel (KR P6) — what the campaign's per-act ascension
        // has earned the boss so far. Only in an acts run.
        this._ascensionPanel(),
      ]),
      // Tally
      h('div', { className: 'qf-boss-tally' }, [
        this._tallyRow('KILLS',     totals.kills ?? 0,        'var(--blood)',  '☠'),
        this._tallyRow('DMG DEALT', totals.dmgDealt ?? 0,     'var(--gold)',   '⚔'),
        this._tallyRow('DMG TAKEN', totals.dmgTaken ?? 0,     'var(--warn)',   '◆'),
        this._tallyRow('ESCAPED',   totals.advsEscaped ?? 0,  'var(--rumor)',  '↗'),
        this._tallyRow('ROOMS',     (gs.dungeon?.rooms ?? []).length, 'var(--text)', '◰'),
        this._tallyRow('DAY',       gs.meta?.dayNumber ?? 1,  'var(--poison)', '◇'),
      ]),
    ])
  }

  // Boss portrait. Prefers the live idle animation (a canvas cycling the
  // `${archId}-idle-down` frames); falls back to the static bestiary
  // portrait when the boss sheet isn't loaded. The overlay re-renders on
  // tab switch — which rebuilds this column — so any prior animation
  // loop is stopped before a fresh sprite is built.
  _buildBossSprite(archId) {
    this._bossSprite?.stop?.()
    this._bossSprite = null
    if (archId) {
      // Tier-aware (KR P6): show the boss's CURRENT per-act form sheet
      // (`${id}-t${tier}`) when one exists — matching the in-world BossRenderer
      // and the form badge — instead of always the canonical T3 base. tier comes
      // from ascensionInfo().tier (= currentAct), the SAME source the badge uses,
      // so the sprite and the "T2 RISEN" badge can never disagree. Falls back to
      // the base anim when the tier sheet/anim isn't present (T3 for most bosses,
      // or off-campaign where ascensionInfo is null).
      const tier   = ascensionInfo(this._gameState)?.tier
      const tierId  = tier ? `${archId}-t${Math.max(1, Math.min(4, tier))}` : null
      const useTier = tierId && window.__game?.textures?.exists?.(`${tierId}-idle`)
      const anim = animatedBossSprite(useTier ? tierId : archId, 200)
        || (useTier ? animatedBossSprite(archId, 200) : null)
      if (anim) {
        this._bossSprite = anim
        return h('div', { className: 'qf-boss-sprite-large' }, [anim.el])
      }
    }
    return h('div', {
      className: 'qf-boss-sprite-large',
      style: archId ? {
        backgroundImage: `url('assets/ui/bestiary/portraits/${archId}_p.png'), radial-gradient(circle at center, var(--bg-2), transparent)`,
        backgroundSize: 'contain, cover',
        backgroundRepeat: 'no-repeat, no-repeat',
        backgroundPosition: 'center, center',
        imageRendering: 'pixelated',
      } : {},
    })
  }

  _tallyRow(label, value, color, icon) {
    return h('div', { className: 'qf-boss-tally-row' }, [
      h('span', { className: 'qf-boss-tally-label' }, [
        h('span', { style: { color, opacity: 0.7 } }, icon),
        ' ',
        label,
      ]),
      h('span', {
        className: 'qf-boss-tally-value',
        style: { color },
      }, String(value)),
    ])
  }

  // Small form badge sat under the LV chip on the portrait — glanceable
  // "which evolved form is this" without reading the panel. Null off-campaign.
  _formBadge() {
    const a = ascensionInfo(this._gameState)
    if (!a) return null
    return h('div', { className: `pix qf-boss-form-badge${a.apex ? ' apex' : ''}` }, [
      h('span', { className: 'qf-boss-form-pip' }, `T${a.tier}`),
      h('span', { className: 'qf-boss-form-name' }, a.form.toUpperCase()),
    ])
  }

  // The "what has ascending earned me" panel: current form + the cumulative
  // power surge it carries + what the dungeon-growth fields. Null off-campaign.
  _ascensionPanel() {
    const a = ascensionInfo(this._gameState)
    if (!a) return null
    return h('div', { className: `qf-boss-ascension${a.apex ? ' apex' : ''}` }, [
      h('div', { className: 'qf-boss-ascension-head' }, [
        h('span', { className: 'qf-boss-ascension-icon' }, '✦'),
        h('span', null, a.ascended ? 'DARK ASCENSION' : 'AWAITING ASCENSION'),
        h('span', { className: 'qf-boss-ascension-form' }, `${a.form} Form`),
      ]),
      a.ascended
        ? h('div', { className: 'qf-boss-ascension-bonus' }, [
            h('span', null, [h('b', null, `+${a.hpBonusPct}%`), ' MAX HP']),
            h('span', null, [h('b', null, `+${a.atkBonusPct}%`), ' ATTACK']),
          ])
        : h('div', { className: 'qf-boss-ascension-note' },
            'Clear an act and the boss absorbs the kingdom’s power.'),
      a.ascended
        ? h('div', { className: 'qf-boss-ascension-note' },
            a.apex
              ? 'Final form — sears invaders in its chamber and fields ascended kin.'
              : 'Sears nearby invaders and fields ascended kin each act.')
        : null,
    ])
  }

  _renderRight() {
    const abilities = this._abilities()
    const pacts = this._activePacts()
    const unlockedCount = abilities.filter(a => a.unlocked).length
    const tabs = [
      { id: 'overview',  label: 'OVERVIEW' },
      { id: 'abilities', label: `ABILITIES (${unlockedCount}/${abilities.length})` },
      { id: 'pacts',     label: `PACTS (${pacts.length})` },
    ]
    return h('div', { className: 'qf-boss-right' }, [
      // Tab bar
      h('div', { className: 'qf-boss-tabs' },
        tabs.map(t => h('button', {
          className: 'qf-boss-tab',
          dataset: { active: this._tab === t.id ? 'true' : 'false' },
          on: { click: () => { this._tab = t.id; this._rerender() } },
        }, t.label))
      ),
      // Tab content — fades in on tab change.
      h('div', { className: `qf-boss-content${this._consumeTabSwap() ? ' qf-tab-swap' : ''}` }, this._renderTab(abilities, pacts)),
    ])
  }

  _renderTab(abilities, pacts) {
    if (this._tab === 'overview')  return this._renderOverview(abilities, pacts)
    if (this._tab === 'abilities') return this._renderAbilities(abilities)
    if (this._tab === 'pacts')     return this._renderPacts(pacts)
    return null
  }

  _renderOverview(abilities, pacts) {
    return h('div', { className: 'qf-boss-overview' }, [
      // Top-2 abilities preview
      h('div', { className: 'panel bevel qf-boss-section' }, [
        h('div', { className: 'qf-boss-section-head' }, [
          h('span', { className: 'pix qf-boss-section-title' }, 'ABILITIES'),
          h('button', {
            className: 'qf-boss-viewall',
            on: { click: () => { this._tab = 'abilities'; this._rerender() } },
          }, 'VIEW ALL ▸'),
        ]),
        h('div', { className: 'qf-boss-abilities-grid' },
          abilities.slice(0, 2).map(a => this._abilityCard(a, true))
        ),
      ]),
      // Trophy Wall (Orc Veteran — Trophy Hunter)
      this._renderTrophyWall(),
      // Soul Essence gauge (Elder Lich — The Withering)
      this._renderSoulGauge(),
      // Mass / Horde readout (Slime King — Mitosis)
      this._renderSlimeMass(),
      // Eyes-Open readout (Beholder — Eye Tyrant)
      this._renderEyesOpen(),
      // Biomass / Bloom readout (Myconid — The Bloom)
      this._renderBloomStatus(),
      // Brimstone readout (Demon — The Brimstone Pact)
      this._renderBrimstoneStatus(),
      // Bedrock readout (Golem — The Living Fortress)
      this._renderBedrockStatus(),
      // Virulence readout (Lizardman — The Plague-Bearer)
      this._renderVirulenceStatus(),
      // Blood readout (Vampire — The Blood Sovereign)
      this._renderBloodStatus(),
      // Dread readout (Wraith — The Dread Harvest)
      this._renderDreadStatus(),
      // Active pacts list
      h('div', { className: 'panel bevel qf-boss-section qf-boss-section-grow' }, [
        h('div', { className: 'pix qf-boss-section-title' },
          `ACTIVE PACTS · ${pacts.length}`),
        pacts.length === 0
          ? h('div', { className: 'qf-boss-empty' }, 'No pacts sealed yet.')
          : h('div', { className: 'qf-boss-pacts-list' },
              pacts.map(p => this._pactRow(p))
            ),
      ]),
      // Census
      h('div', { className: 'panel bevel qf-boss-section' }, [
        h('div', { className: 'pix qf-boss-section-title' }, 'DUNGEON CENSUS'),
        h('div', { className: 'qf-boss-census' }, [
          this._censusTile('ROOMS',   (this._gameState.dungeon?.rooms ?? []).length,    'var(--gold)'),
          this._censusTile('MINIONS', (this._gameState.minions ?? []).filter(m => m.aiState !== 'dead' && m.deathDay == null).length, 'var(--poison)'),
          this._censusTile('TRAPS',   (this._gameState.dungeon?.traps ?? []).length,    'var(--blood)'),
          this._censusTile('LOCKS',   (this._gameState.dungeon?.locks ?? []).length,    'var(--rumor)'),
        ]),
      ]),
    ])
  }

  _renderAbilities(abilities) {
    return h('div', { className: 'qf-boss-abilities-list' },
      abilities.length === 0
        ? [h('div', { className: 'qf-boss-empty' }, 'No abilities defined.')]
        : abilities.map(a => this._abilityCard(a, false))
    )
  }

  _renderPacts(pacts) {
    // Inquisition pact-benefit suppression (KR) — call it out at the top of the
    // list so the player understands WHY their gifts went quiet.
    const suppressed = !!this._gameState?._mechanicFlags?._inqSuppress
    const rows = pacts.length === 0
      ? [h('div', { className: 'qf-boss-empty' }, 'No pacts sealed yet — survive a day to be offered one.')]
      : pacts.map(p => this._pactRowExpanded(p))
    return h('div', { className: 'qf-boss-pacts-full', dataset: { suppressed: suppressed ? 'true' : 'false' } }, [
      suppressed && h('div', { className: 'qf-boss-inq-banner pix' },
        '⚠ THE INQUISITION — your pact BENEFITS are SEALED while an inquisitor walks your halls. The curses remain.'),
      ...rows,
    ])
  }

  _abilityCard(a, compact) {
    const color = a.color || (a.unlocked ? 'var(--blood)' : 'var(--text-dim)')
    const locked = !a.unlocked
    return h('div', {
      className: 'qf-boss-ability',
      dataset: { locked: locked ? 'true' : 'false', compact: compact ? 'true' : 'false' },
      style: { '--ab-color': color },
    }, [
      h('div', { className: 'qf-boss-ability-head' }, [
        h('span', {
          className: 'pix qf-boss-ability-icon',
          style: { color },
        }, locked ? '🔒' : (a.icon || '◆')),
        h('span', { className: 'pix qf-boss-ability-name' }, a.name || a.id),
        h('span', { className: 'pix qf-boss-ability-cd' }, a.cd || (a.cooldown || 'PASSIVE')),
      ]),
      h('div', { className: 'qf-boss-ability-desc' },
        compact ? (a.summary || a.description || '—') : (a.description || a.summary || '—')
      ),
      locked && h('div', { className: 'pix qf-boss-ability-locked' },
        `🔒 LV ${a.unlockLevel ?? a.lvl ?? 1}`),
    ])
  }

  _pactRow(p) {
    const color = this._rarityColor(p.rarity)
    return h('div', {
      className: 'qf-boss-pact-row',
      style: { '--pact-color': color },
      on: {
        mouseenter: (e) => this._showPactTooltip(p, e.currentTarget),
        mouseleave: () => this._hidePactTooltip(),
      },
    }, [
      h('span', {
        className: 'pix qf-boss-pact-glyph',
        style: { color, textShadow: `0 0 6px ${color}` },
      }, p.symbol || '▣'),
      h('div', { className: 'qf-boss-pact-textcol' }, [
        h('span', { className: 'pix qf-boss-pact-name' }, p.name || p.id),
        h('span', {
          className: 'pix qf-boss-pact-rarity',
          style: { color },
        }, (p.rarity || 'COMMON').toUpperCase()),
      ]),
    ])
  }

  _pactRowExpanded(p) {
    const color = this._rarityColor(p.rarity)
    return h('div', {
      className: 'qf-boss-pact-expanded',
      style: { '--pact-color': color },
    }, [
      h('div', { className: 'qf-boss-pact-head' }, [
        h('span', {
          className: 'pix qf-boss-pact-glyph',
          style: { color, textShadow: `0 0 6px ${color}` },
        }, p.symbol || '▣'),
        h('span', { className: 'pix qf-boss-pact-name' }, p.name || p.id),
        h('span', {
          className: 'pix qf-boss-pact-rarity',
          style: { color },
        }, (p.rarity || 'COMMON').toUpperCase()),
      ]),
      p.flavorText && h('div', { className: 'qf-boss-pact-flavor' }, `"${p.flavorText}"`),
      (p.description || p.boon) && h('div', { className: 'qf-boss-pact-boon' }, [
        h('span', { style: { color: 'var(--poison)' } }, '▲ '),
        p.description || p.boon,
      ]),
      (p.tradeoffDescription || p.bane) && h('div', { className: 'qf-boss-pact-bane' }, [
        h('span', { style: { color: 'var(--blood)' } }, '▼ '),
        p.tradeoffDescription || p.bane,
      ]),
    ])
  }

  // Orc Veteran — Trophy Hunter. The arsenal he's seized over the run: each
  // claimed trophy type + its empower stacks. The most-claimed type is his
  // Mastery (its dungeon-wide aura is live from Act III). Null for other bosses.
  _renderTrophyWall() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (archId !== 'orc') return null
    const tr = this._gameState.boss?.trophies ?? {}
    const claimed = TROPHY_TYPES.filter(t => (tr[t.id]?.stacks ?? 0) > 0)
    // top (Mastery) type — most stacks, ties by TROPHY_TYPES order
    let topId = null, topStacks = 0
    for (const t of TROPHY_TYPES) {
      const s = tr[t.id]?.stacks ?? 0
      if (s > topStacks) { topStacks = s; topId = t.id }
    }
    const masteryLive = currentAct(this._gameState) >= 3 && topId
    const css = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6)
    return h('div', { className: 'panel bevel qf-boss-section' }, [
      h('div', { className: 'qf-boss-section-head' }, [
        h('span', { className: 'pix qf-boss-section-title' }, 'TROPHY WALL'),
        h('span', { className: 'pix', style: { fontSize: '11px', color: 'var(--text-mute)' } },
          `${claimed.length}/${TROPHY_TYPES.length} CLAIMED`),
      ]),
      claimed.length === 0
        ? h('div', { className: 'qf-boss-empty' }, 'No trophies claimed — slay heroes to seize their arms.')
        : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' } },
            claimed.map(t => {
              const c = css(t.color)
              const stacks = tr[t.id].stacks
              const isTop = t.id === topId
              return h('div', {
                style: {
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '5px 9px', borderRadius: '6px',
                  border: `1px solid ${c}`,
                  background: `${c}1a`,
                  boxShadow: isTop && masteryLive ? `0 0 10px ${c}66` : 'none',
                },
              }, [
                h('span', { style: { fontSize: '15px', color: c } }, t.icon),
                h('span', { className: 'pix', style: { fontSize: '12px', color: 'var(--text)' } }, t.label.toUpperCase()),
                h('span', { className: 'pix', style: { fontSize: '12px', fontWeight: 'bold', color: c } }, `×${stacks}`),
                isTop && masteryLive && h('span', {
                  className: 'pix',
                  style: { fontSize: '10px', color: c, opacity: 0.9, borderLeft: `1px solid ${c}55`, paddingLeft: '6px' },
                }, `★ ${t.mastery}`),
              ])
            })
          ),
      masteryLive
        ? h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '6px' } },
            'Mastery aura active — the most-claimed trophy empowers your whole dungeon.')
        : (claimed.length > 0
            ? h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '6px' } },
                'Mastery aura unlocks at Act III.')
            : null),
    ])
  }

  // Elder Lich — The Withering. The banked Soul Essence: lifeline (day regen),
  // ammo for CHANNEL SOULS, and the throne-fight reserve. Null for other bosses.
  _renderSoulGauge() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (archId !== 'lich') return null
    const ess  = Math.floor(this._gameState.boss?.soulEssence ?? 0)
    const cost = 12   // Balance.LICH_CHANNEL_COST
    const casts = Math.floor(ess / cost)
    // bar fills toward the next cast (cosmetic; essence has no hard cap)
    const pct = Math.max(0, Math.min(100, ((ess % cost) / cost) * 100))
    const C = '#9affb0'
    return h('div', { className: 'panel bevel qf-boss-section' }, [
      h('div', { className: 'qf-boss-section-head' }, [
        h('span', { className: 'pix qf-boss-section-title' }, 'SOUL ESSENCE'),
        h('span', { className: 'pix', style: { fontSize: '12px', fontWeight: 'bold', color: C, textShadow: `0 0 8px ${C}66` } }, String(ess)),
      ]),
      h('div', { className: 'bar', style: { marginTop: '6px', height: '10px', background: '#0e1a12', border: '1px solid #2a3a2c', borderRadius: '4px', overflow: 'hidden' } }, [
        h('div', { className: 'fill', style: { width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#5fae6a,#9affb0)' } }),
      ]),
      h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '6px' } },
        casts > 0
          ? `${casts} Channel Souls cast${casts === 1 ? '' : 's'} ready · harvested from every death · the Lich regenerates while it holds essence.`
          : 'Harvested from every death in your dungeon — fuels Channel Souls + regenerates the Lich. Need 12 to channel.'),
    ])
  }

  // Slime King — Mitosis. Mass (drives body size, aura, and the throne-fight
  // horde) + the live goopling count. Null for other bosses.
  _renderSlimeMass() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (archId !== 'slime') return null
    const mass = Math.floor(this._gameState.boss?.slimeMass ?? 0)
    const gooplings = (this._gameState.minions ?? []).filter(m => m._isGoopling && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0).length
    const C = '#9aff7a'
    const cap = 40 + 40 + 6   // rough act/level reference for the bar (cosmetic)
    const pct = Math.max(0, Math.min(100, (mass / Math.max(1, cap)) * 100))
    return h('div', { className: 'panel bevel qf-boss-section' }, [
      h('div', { className: 'qf-boss-section-head' }, [
        h('span', { className: 'pix qf-boss-section-title' }, 'SLIME MASS'),
        h('span', { className: 'pix', style: { fontSize: '12px', fontWeight: 'bold', color: C, textShadow: `0 0 8px ${C}66` } }, String(mass)),
      ]),
      h('div', { className: 'bar', style: { marginTop: '6px', height: '10px', background: '#0e1a12', border: '1px solid #2a3a2c', borderRadius: '4px', overflow: 'hidden' } }, [
        h('div', { className: 'fill', style: { width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#3a8f44,#9aff7a)' } }),
      ]),
      h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '6px' } },
        `${gooplings} goopling${gooplings === 1 ? '' : 's'} roaming · Mass swells the King's body, aura, and the horde it splits into.`),
    ])
  }

  _renderEyesOpen() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (archId !== 'beholder') return null
    const tier = currentAct(this._gameState)
    // Fight rays open this act (mirrors _fireEyeBarrage's tier gating).
    const rays = ['Petrify', 'Drain']
    if (tier >= 2) rays.push('Hex')
    if (tier >= 4) rays.push('Disintegrate')
    const beams = tier >= 3 ? 2 : 1
    const gazeUses = this._gameState.boss?._beholderGaze?.usesLeft ?? 0
    const C = '#c9a6ff'
    const pct = Math.max(0, Math.min(100, (rays.length / 4) * 100))
    return h('div', { className: 'panel bevel qf-boss-section' }, [
      h('div', { className: 'qf-boss-section-head' }, [
        h('span', { className: 'pix qf-boss-section-title' }, 'EYES OPEN'),
        h('span', { className: 'pix', style: { fontSize: '12px', fontWeight: 'bold', color: C, textShadow: `0 0 8px ${C}66` } }, `${rays.length} rays`),
      ]),
      h('div', { className: 'bar', style: { marginTop: '6px', height: '10px', background: '#160e26', border: '1px solid #3a2a5a', borderRadius: '4px', overflow: 'hidden' } }, [
        h('div', { className: 'fill', style: { width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#5a2a8a,#c9a6ff)' } }),
      ]),
      h('div', { style: { fontSize: '11px', color: C, marginTop: '6px', fontWeight: 'bold' } }, rays.join(' · ')),
      h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '4px' } },
        `${beams} beam${beams === 1 ? '' : 's'}/beat in the throne · Tyrant's Gaze ×${gazeUses} today. More eyes open each act.`),
    ])
  }

  _renderBloomStatus() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (archId !== 'myconid') return null
    const boss = this._gameState.boss ?? {}
    const biomass = Math.floor(boss.biomass ?? 0)
    const bloomed = (boss.bloomedRooms ?? []).length
    const tier = currentAct(this._gameState)
    const cap = (Balance.MYCONID_BIOMASS_CAP_BASE ?? 60) + tier * (Balance.MYCONID_BIOMASS_CAP_PER_ACT ?? 40)
    const C = '#9ee870'
    const pct = Math.max(0, Math.min(100, (biomass / Math.max(1, cap)) * 100))
    const phase = tier >= 4 ? 'Sporestorm' : tier >= 3 ? 'Spread' : tier >= 2 ? 'Rot' : 'Creep'
    return h('div', { className: 'panel bevel qf-boss-section' }, [
      h('div', { className: 'qf-boss-section-head' }, [
        h('span', { className: 'pix qf-boss-section-title' }, 'BIOMASS'),
        h('span', { className: 'pix', style: { fontSize: '12px', fontWeight: 'bold', color: C, textShadow: `0 0 8px ${C}66` } }, String(biomass)),
      ]),
      h('div', { className: 'bar', style: { marginTop: '6px', height: '10px', background: '#0e1a10', border: '1px solid #2a3a2c', borderRadius: '4px', overflow: 'hidden' } }, [
        h('div', { className: 'fill', style: { width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#3a8f3a,#9ee870)' } }),
      ]),
      h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '6px' } },
        `${bloomed} room${bloomed === 1 ? '' : 's'} bloomed · phase: ${phase}. Biomass spreads the colony, fuels bloomed terrain, and feeds the throne.`),
    ])
  }

  _renderBrimstoneStatus() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (archId !== 'demon') return null
    const boss = this._gameState.boss ?? {}
    const brim = Math.floor(boss.brimstone ?? 0)
    const tier = currentAct(this._gameState)
    const cap = (Balance.DEMON_BRIMSTONE_CAP_BASE ?? 80) + tier * (Balance.DEMON_BRIMSTONE_CAP_PER_ACT ?? 60)
    const C = '#ff8a3a'
    const pct = Math.max(0, Math.min(100, (brim / Math.max(1, cap)) * 100))
    const phase = tier >= 4 ? 'Ascendance' : tier >= 3 ? 'Soul Harvest' : tier >= 2 ? 'Volatile Legion' : 'Brimstone'
    return h('div', { className: 'panel bevel qf-boss-section' }, [
      h('div', { className: 'qf-boss-section-head' }, [
        h('span', { className: 'pix qf-boss-section-title' }, 'BRIMSTONE'),
        h('span', { className: 'pix', style: { fontSize: '12px', fontWeight: 'bold', color: C, textShadow: `0 0 8px ${C}66` } }, String(brim)),
      ]),
      h('div', { className: 'bar', style: { marginTop: '6px', height: '10px', background: '#1f1006', border: '1px solid #3a2410', borderRadius: '4px', overflow: 'hidden' } }, [
        h('div', { className: 'fill', style: { width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#a8401a,#ff8a3a)' } }),
      ]),
      h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '6px' } },
        `phase: ${phase}. Banked from sacrifices + every kill; the Infernal Pact spends it for hellfire (bigger reserve = bigger blast) and the Demon regenerates while it burns.`),
    ])
  }

  _renderBedrockStatus() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (archId !== 'golem') return null
    const boss = this._gameState.boss ?? {}
    const rooms = this._gameState.dungeon?.rooms?.length ?? 0
    const g = boss._golem ?? {}
    const tier = currentAct(this._gameState)
    const cap = Balance.GOLEM_BEDROCK_CAP_ROOMS ?? 20
    const C = '#d8a24a'
    const pct = Math.max(0, Math.min(100, (rooms / Math.max(1, cap)) * 100))
    const phase = tier >= 4 ? 'Tectonic Upheaval' : tier >= 3 ? 'Tremor Network' : tier >= 2 ? 'Aftershock' : 'Living Architecture'
    return h('div', { className: 'panel bevel qf-boss-section' }, [
      h('div', { className: 'qf-boss-section-head' }, [
        h('span', { className: 'pix qf-boss-section-title' }, 'BEDROCK'),
        h('span', { className: 'pix', style: { fontSize: '12px', fontWeight: 'bold', color: C, textShadow: `0 0 8px ${C}66` } }, `${rooms} rooms`),
      ]),
      h('div', { className: 'bar', style: { marginTop: '6px', height: '10px', background: '#1c160e', border: '1px solid #3a2e1c', borderRadius: '4px', overflow: 'hidden' } }, [
        h('div', { className: 'fill', style: { width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#7a5a2a,#d8a24a)' } }),
      ]),
      h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '6px' } },
        `phase: ${phase}. The dungeon IS its body — +${Math.round(g.hpApplied ?? 0)} HP, +${Math.round(g.defApplied ?? 0)} DEF from your rooms; Seismic Slam hits harder the more you build.`),
    ])
  }

  _renderVirulenceStatus() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (archId !== 'lizardman') return null
    const boss = this._gameState.boss ?? {}
    const vir = Math.floor(boss.virulence ?? 0)
    const tier = currentAct(this._gameState)
    const cap = (Balance.LIZARD_VIRULENCE_CAP_BASE ?? 50) + tier * (Balance.LIZARD_VIRULENCE_CAP_PER_ACT ?? 40)
    const infected = (this._gameState.adventurers?.active ?? []).filter(a => (a._plagueStacks ?? 0) > 0 && (a.resources?.hp ?? 0) > 0).length
    const C = '#9ada3a'
    const pct = Math.max(0, Math.min(100, (vir / Math.max(1, cap)) * 100))
    const phase = tier >= 4 ? 'Pandemic' : tier >= 3 ? 'Virulent Strain' : tier >= 2 ? 'Contagion' : 'Infection'
    return h('div', { className: 'panel bevel qf-boss-section' }, [
      h('div', { className: 'qf-boss-section-head' }, [
        h('span', { className: 'pix qf-boss-section-title' }, 'VIRULENCE'),
        h('span', { className: 'pix', style: { fontSize: '12px', fontWeight: 'bold', color: C, textShadow: `0 0 8px ${C}66` } }, String(vir)),
      ]),
      h('div', { className: 'bar', style: { marginTop: '6px', height: '10px', background: '#16210c', border: '1px solid #2c3a1c', borderRadius: '4px', overflow: 'hidden' } }, [
        h('div', { className: 'fill', style: { width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#4a7a2a,#9ada3a)' } }),
      ]),
      h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '6px' } },
        `${infected} infected · phase: ${phase}. The plague spreads body-to-body and ticks harder as Virulence (banked per infected kill) climbs.`),
    ])
  }

  _renderBloodStatus() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (archId !== 'vampire') return null
    const boss = this._gameState.boss ?? {}
    const blood = Math.floor(boss.blood ?? 0)
    const tier = currentAct(this._gameState)
    const cap = (Balance.VAMPIRE_BLOOD_CAP_BASE ?? 60) + tier * (Balance.VAMPIRE_BLOOD_CAP_PER_ACT ?? 50)
    const thralls = (this._gameState.minions ?? []).filter(m => m._isVampireThrall && m.aiState !== 'dead' && (m.resources?.hp ?? 0) > 0).length
    const C = '#ff3a6a'
    const pct = Math.max(0, Math.min(100, (blood / Math.max(1, cap)) * 100))
    const phase = tier >= 4 ? 'Blood Moon' : tier >= 3 ? 'Sanguine Vigor' : tier >= 2 ? 'Growing Court' : 'Blood Tax'
    return h('div', { className: 'panel bevel qf-boss-section' }, [
      h('div', { className: 'qf-boss-section-head' }, [
        h('span', { className: 'pix qf-boss-section-title' }, 'BLOOD'),
        h('span', { className: 'pix', style: { fontSize: '12px', fontWeight: 'bold', color: C, textShadow: `0 0 8px ${C}66` } }, String(blood)),
      ]),
      h('div', { className: 'bar', style: { marginTop: '6px', height: '10px', background: '#220810', border: '1px solid #3a141c', borderRadius: '4px', overflow: 'hidden' } }, [
        h('div', { className: 'fill', style: { width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#7a0f24,#ff3a6a)' } }),
      ]),
      h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '6px' } },
        `${thralls} thrall${thralls === 1 ? '' : 's'} in the Court · phase: ${phase}. BLOOD banks from every wound the dungeon deals + each kill; spend it on Blood Rites and feast in the throne fight.`),
    ])
  }

  _renderDreadStatus() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    if (archId !== 'wraith') return null
    const boss = this._gameState.boss ?? {}
    const dread = Math.floor(boss.dread ?? 0)
    const tier = currentAct(this._gameState)
    const cap = (Balance.WRAITH_DREAD_CAP_BASE ?? 60) + tier * (Balance.WRAITH_DREAD_CAP_PER_ACT ?? 50)
    const ff = Balance.WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD ?? 75
    const breaking = (this._gameState.adventurers?.active ?? []).filter(a => (a._fear ?? 0) >= ff && (a.resources?.hp ?? 0) > 0).length
    const C = '#b6c2f0'
    const pct = Math.max(0, Math.min(100, (dread / Math.max(1, cap)) * 100))
    const phase = tier >= 4 ? 'The Pall' : tier >= 3 ? 'Contagious Panic' : tier >= 2 ? 'Creeping Dread' : 'Haunting'
    return h('div', { className: 'panel bevel qf-boss-section' }, [
      h('div', { className: 'qf-boss-section-head' }, [
        h('span', { className: 'pix qf-boss-section-title' }, 'DREAD'),
        h('span', { className: 'pix', style: { fontSize: '12px', fontWeight: 'bold', color: C, textShadow: `0 0 8px ${C}66` } }, String(dread)),
      ]),
      h('div', { className: 'bar', style: { marginTop: '6px', height: '10px', background: '#14162a', border: '1px solid #2a2c44', borderRadius: '4px', overflow: 'hidden' } }, [
        h('div', { className: 'fill', style: { width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#2a3050,#b6c2f0)' } }),
      ]),
      h('div', { style: { fontSize: '11px', color: 'var(--text-mute)', marginTop: '6px' } },
        `${breaking} breaking · phase: ${phase}. Every fright feeds DREAD, which amplifies fear and drops the break thresholds — terror cashes out as panic, friendly-fire, and heart-stops.`),
    ])
  }

  _censusTile(label, value, color) {
    return h('div', { className: 'qf-boss-census-tile' }, [
      h('div', {
        className: 'pix qf-boss-census-value',
        style: { color, textShadow: `0 0 8px ${color}55` },
      }, String(value)),
      h('div', { className: 'pix qf-boss-census-label' }, label),
    ])
  }

  _showPactTooltip(p, anchorEl) {
    const r = anchorEl.getBoundingClientRect()
    EventBus.emit('SHOW_PACT_DETAIL', {
      pact: p,
      // Anchor to the left of the row, vertically centered.
      x: r.left - 12,
      y: r.top + r.height / 2,
    })
  }

  _hidePactTooltip() {
    EventBus.emit('HIDE_PACT_DETAIL')
  }

  destroy() {
    EventBus.off('OPEN_BOSS_OVERVIEW', this._listener)
    this._bossSprite?.stop?.()
    this._bossSprite = null
    this._overlay?.close()
    this._overlay = null
  }
}

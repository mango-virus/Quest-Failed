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
import { ascensionInfo } from '../config/acts.js'

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
      const anim = animatedBossSprite(archId, 200)
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
      // Tab content
      h('div', { className: 'qf-boss-content' }, this._renderTab(abilities, pacts)),
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
    return h('div', { className: 'qf-boss-pacts-full' },
      pacts.length === 0
        ? [h('div', { className: 'qf-boss-empty' }, 'No pacts sealed yet — survive a day to be offered one.')]
        : pacts.map(p => this._pactRowExpanded(p))
    )
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

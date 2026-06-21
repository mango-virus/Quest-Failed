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
import { TrayShell } from './TrayShell.js'
import { EventBus } from '../systems/EventBus.js'

export class BossOverviewOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._tray = null
    this._tab = 'abilities'   // SKILLS | PACTS | EMPIRE (bespoke tray tabs)
    this._listener = () => this.toggle()
    EventBus.on('OPEN_BOSS_OVERVIEW', this._listener)
  }

  toggle() {
    if (this._tray) this.close()
    else this.open()
  }
  isOpen() { return !!this._tray }

  // The boss dossier now flies out of the portrait as an anchored tray (the
  // design's BossTray) instead of the old full-screen Overlay. Identity card
  // (left) + segmented SKILLS / PACTS / EMPIRE body (right). All data helpers
  // (_archetype / _abilities / _activePacts / _rarityColor) are reused.
  open() {
    if (this._tray) return
    this._tab = 'abilities'
    this._tray = new TrayShell({
      anchorSel: '[data-tray-anchor="BOSS"]',
      align:  'left',
      vAlign: 'down',
      accent: 'var(--blood)',
      width:  'min(50vw, 820px)',
      height: 340,
      detachable: true,
      title: 'BOSS',
      detachedSize:      { width: '540px', height: '560px' },
      detachedSizeSmall: { width: '440px', height: '470px' },
      onClose: () => { this._tray = null },
    })
    this._tray.setContent(this._renderTrayContent())
    this._tray.open()
  }

  close() {
    this._tray?.close()
    this._tray = null
  }

  _rerender() {
    if (this._tray) this._tray.setContent(this._renderTrayContent())
  }

  // ── Bespoke boss tray (identity card + tabbed body) ─────────────
  _renderTrayContent() {
    const gs = this._gameState
    const arch = this._archetype()
    const archId = String(gs.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    const hp    = Math.round(gs.boss?.hp ?? 0)
    const maxHp = Math.round(gs.boss?.maxHp ?? 100)
    const xp    = gs.boss?.xp ?? 0
    const xpMax = gs.boss?.xpToNext ?? 100
    const level = gs.boss?.level ?? 1
    const lives = gs.boss?.deathsRemaining ?? 3
    const maxLives = Math.max(lives, gs.boss?.maxDeaths ?? gs.boss?.startingLives ?? 3)
    const atk   = gs.boss?.attack  ?? 0
    const def   = gs.boss?.defense ?? 0
    const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0
    const xpPct = xpMax > 0 ? Math.max(0, Math.min(100, (xp / xpMax) * 100)) : 0
    const name = (arch?.name || archId || 'THE DARK LORD').toUpperCase()
    const tagline = (arch?.tagline || arch?.description || 'CHAMPION OF THE PIT').toUpperCase()
    const flavor = arch?.flavorText || arch?.description || ''
    const totals = gs.run?.totals ?? {}
    const kills = totals.kills ?? 0
    const abilities = this._abilities()
    const pacts = this._activePacts()

    const hero = h('div', { className: 'bss-hero' }, [
      h('div', { className: 'bss-id', style: { display: 'flex', gap: '12px', alignItems: 'center' } }, [
        h('div', { className: 'bss-portwrap' }, [
          h('div', {
            className: 'bss-port',
            style: { backgroundImage: `url('assets/ui/bestiary/portraits/${archId}_p.png'), radial-gradient(circle at center, var(--bg-2), var(--bg-0))` },
          }),
          h('span', { className: 'bss-lv' }, `LV ${level}`),
        ]),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 } }, [
          h('span', { className: 'bss-name' }, name),
          h('span', { className: 'bss-tag' }, tagline),
        ]),
      ]),
      h('div', { className: 'bss-hp' }, [
        h('div', { className: 'bss-bar-top' }, [ h('span', null, 'HEALTH'), h('b', null, `${hp} / ${maxHp}`) ]),
        h('div', { className: 'bss-bar-track' }, [ h('div', { className: 'bss-bar-fill hp', style: { width: hpPct + '%' } }) ]),
      ]),
      h('div', { className: 'bss-lives' }, [
        h('span', { className: 'll' }, 'LIVES'),
        ...Array.from({ length: maxLives }, (_, i) => h('span', { className: 'h' + (i < lives ? '' : ' dim') }, '♥')),
      ]),
      h('div', { className: 'bss-xp' }, [
        h('div', { className: 'bss-bar-top' }, [ h('span', null, `XP → LV ${level + 1}`), h('b', null, `${xp} / ${xpMax}`) ]),
        h('div', { className: 'bss-bar-track' }, [ h('div', { className: 'bss-bar-fill xp', style: { width: xpPct + '%' } }) ]),
      ]),
      h('div', { className: 'bss-core' }, [
        h('div', { className: 'c' }, [ h('span', { className: 'v' }, String(atk)), h('span', { className: 'l' }, 'ATK') ]),
        h('div', { className: 'c' }, [ h('span', { className: 'v' }, String(def)), h('span', { className: 'l' }, 'DEF') ]),
        h('div', { className: 'c' }, [ h('span', { className: 'v' }, String(kills)), h('span', { className: 'l' }, 'KILLS') ]),
      ]),
      flavor ? h('div', { className: 'bss-flavor' }, `“${flavor}”`) : null,
    ].filter(Boolean))

    const TABS = [
      { id: 'abilities', label: 'SKILLS', glyph: '✦', count: abilities.length },
      { id: 'pacts',     label: 'PACTS',  glyph: '◈', count: pacts.length },
      { id: 'empire',    label: 'EMPIRE', glyph: '⌂' },
    ]
    const segbar = h('div', { className: 'htr-segbar' }, TABS.map(tb => h('div', {
      className: 'htr-segtab' + (this._tab === tb.id ? ' on' : ''),
      on: { click: () => { this._tab = tb.id; this._rerender() } },
    }, [
      h('span', { className: 'tg' }, tb.glyph),
      h('span', { className: 'lb' }, tb.label),
      tb.count != null ? h('span', { className: 'ct' }, String(tb.count)) : null,
    ].filter(Boolean))))

    const body = h('div', { className: 'bss-content' }, [ this._renderBossSection(this._tab, abilities, pacts, totals) ])

    const chrome = h('div', { className: 'htr-chrome m-col' }, [ segbar, h('div', { className: 'htr-content' }, [ body ]) ])
    return h('div', { className: 'bss-main', style: { display: 'flex', flex: '1', minWidth: 0 } }, [ hero, chrome ])
  }

  _renderBossSection(id, abilities, pacts, totals) {
    const gs = this._gameState
    if (id === 'abilities') {
      if (!abilities.length) return h('div', { className: 'bss-empty' }, 'No signature abilities.')
      return h('div', { className: 'bss-skills' }, abilities.map((a, i) => h('div', {
        className: 'bss-abil' + (a.implemented ? '' : ' locked'),
        style: { '--ac': 'var(--blood)', '--i': i },
      }, [
        h('div', { className: 'bss-abil-ic' }, a.implemented ? '✦' : '⋯'),
        h('div', { className: 'bss-abil-b' }, [
          h('div', { className: 'bss-abil-top' }, [
            h('span', { className: 'bss-abil-n' }, a.name),
            a.implemented ? null : h('span', { className: 'bss-lock' }, 'SOON'),
          ].filter(Boolean)),
          h('span', { className: 'bss-abil-d' }, a.description),
        ]),
      ])))
    }
    if (id === 'pacts') {
      if (!pacts.length) return h('div', { className: 'bss-empty' }, 'No pacts sealed yet.')
      return h('div', { className: 'bss-pacts' }, pacts.map((p, i) => h('div', {
        className: 'bss-pact',
        style: { '--rar': this._rarityColor(p.rarity), '--i': i },
      }, [
        h('div', { className: 'bss-pact-top' }, [
          h('div', { className: 'bss-pact-g' }, p.symbol || '◈'),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 } }, [
            h('span', { className: 'bss-pact-n' }, p.name || p.id),
            h('span', { className: 'bss-pact-r' }, String(p.rarity || 'common').toUpperCase()),
          ]),
        ]),
        p.flavorText ? h('span', { className: 'bss-pact-fl' }, `“${p.flavorText}”`) : null,
        h('div', { className: 'bss-pact-bb' }, [
          p.description ? h('span', { className: 'ln boon' }, [ h('span', { className: 's' }, '+'), p.description ]) : null,
          p.tradeoffDescription ? h('span', { className: 'ln bane' }, [ h('span', { className: 's' }, '−'), p.tradeoffDescription ]) : null,
        ].filter(Boolean)),
      ].filter(Boolean))))
    }
    // EMPIRE
    const tile = (v, l, hl) => h('div', { className: 'bss-tile' + (hl ? ' hl' : '') }, [
      h('span', { className: 'v' }, String(v)),
      h('span', { className: 'l' }, l),
    ])
    return h('div', { className: 'bss-empire' }, [
      h('div', { className: 'bss-emp-group' }, [
        h('div', { className: 'bss-emp-h' }, [ h('span', { className: 'd' }), 'THIS SIEGE' ]),
        h('div', { className: 'bss-emp-row' }, [
          tile(totals.kills ?? 0, 'KILLS', true),
          tile(totals.dmgDealt ?? 0, 'DMG DEALT'),
          tile(totals.dmgTaken ?? 0, 'DMG TAKEN'),
          tile(totals.advsEscaped ?? 0, 'ESCAPED'),
        ]),
      ]),
      h('div', { className: 'bss-emp-group' }, [
        h('div', { className: 'bss-emp-h', style: { '--gc': 'var(--rumor)' } }, [ h('span', { className: 'd' }), 'YOUR EMPIRE' ]),
        h('div', { className: 'bss-emp-row' }, [
          tile((gs.dungeon?.rooms ?? []).length, 'ROOMS'),
          tile((gs.minions ?? []).filter(m => m && m.aiState !== 'dead').length, 'MINIONS'),
          tile((gs.dungeon?.traps ?? []).length, 'TRAPS'),
          tile((gs.dungeon?.locks ?? []).length, 'LOCKS'),
        ]),
      ]),
    ])
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

  destroy() {
    EventBus.off('OPEN_BOSS_OVERVIEW', this._listener)
    this._bossSprite?.stop?.()
    this._bossSprite = null
    this._overlay?.close()
    this._overlay = null
  }
}

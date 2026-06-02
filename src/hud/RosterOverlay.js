// RosterOverlay — DOM port of the design's Minion Roster popup
// (overlays.jsx → RosterOverlay).
//
// Surface: summary strip (GARRISON / TOTAL KILLS / AVG LV / WOUNDED),
// filter row (ALL / READY / WOUNDED / IDLE), per-minion list (sprite +
// tier + name + status + HP bar + LV + kills), big detail card on the
// right (portrait + name + assignment + HP bar + 4-tile stat grid +
// TRAITS chips + description + RECENT log + REASSIGN/RENAME/SACRIFICE).
//
// Wired to OPEN_MINION_ROSTER (toggle-open behaviour mirrors the Phaser
// popup contract).

import { h, mount } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'
import { NameEntryOverlay } from './NameEntryOverlay.js'
import { snapshotMinion } from './inGameSnapshot.js'
import { minionLabel } from '../util/displayNames.js'

const FILTERS = ['ALL', 'READY', 'WOUNDED', 'IDLE']
const FILTER_COLORS = {
  ALL:     'var(--text)',
  READY:   'var(--poison)',
  WOUNDED: 'var(--warn)',
  IDLE:    'var(--text-dim)',
}

export class RosterOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._listeners = []
    this._filter = 'ALL'
    this._selIdx = 0
    this._listener = () => this.toggle()
    EventBus.on('OPEN_MINION_ROSTER', this._listener)
  }

  toggle() {
    if (this._overlay) this.close()
    else this.open()
  }

  isOpen() { return !!this._overlay }

  open() {
    if (this._overlay) return
    this._filter = 'ALL'
    this._selIdx = 0
    this._overlay = new Overlay({
      npcKind: 'roster',
      title:  'MINION ROSTER',
      width:  1300,
      height: 780,
      accent: 'var(--poison)',
      frame:  'plain',   // subtle main-menu edge instead of the accent frame
      onClose: () => { this._overlay = null },
      body:   this._renderBody(),
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

  // ── Data helpers ────────────────────────────────────────────────
  _minions() {
    // Only show living roster minions (the player's hunters), not
    // garrison/system minions that ride along.
    return (this._gameState.minions ?? [])
      .filter(m => m.aiState !== 'dead' && m.deathDay == null)
  }

  _classifyStatus(m) {
    const hp    = m.resources?.hp ?? 0
    const maxHp = m.resources?.maxHp ?? 1
    if (maxHp > 0 && hp / maxHp < 0.6) return 'wounded'
    if (m.aiState === 'idle')          return 'idle'
    return 'ready'
  }

  // Sprite uses the existing bestiary portrait when one exists for the
  // minion's archetype family — otherwise a colored-glyph fallback.
  // Looks for `assets/ui/bestiary/portraits/{family}_p.png`.
  _spriteFor(m) {
    const id = String(m.definitionId || '').replace(/[0-9]+$/, '') // strip tier suffix
    return id
  }

  _roomName(roomId) {
    if (!roomId) return '—'
    const rooms = this._gameState.dungeon?.rooms ?? []
    const r = rooms.find(x => x.instanceId === roomId)
    if (!r) return '—'
    // Resolve definition name via cache
    const defs = this._cachedJson('rooms') ?? []
    const d = defs.find(x => x.id === r.definitionId)
    return d?.name ?? r.definitionId ?? '—'
  }

  // Location label for the roster row. For roamers (behaviorType:
  // 'roam' — zombies / imps / gnolls / slimes / orcs) and Guard Post
  // patrols + Demon Hellgate imps, look up the minion's CURRENT room
  // by scanning room bounds against tileX/tileY. Falls back to the
  // home room when the minion is on a doorway tile (between rooms) or
  // genuinely outside any active room. For garrison / room-bound
  // minions, just resolves the static assignedRoomId as before.
  _minionLocationLabel(m) {
    if (!m) return '—'
    const isMobile = m.behaviorType === 'roam' || m._isDemonImp || m._isVampireThrall
    if (!isMobile) return this._roomName(m.assignedRoomId)
    const rooms = this._gameState.dungeon?.rooms ?? []
    const tx = m.tileX, ty = m.tileY
    if (Number.isFinite(tx) && Number.isFinite(ty)) {
      for (const r of rooms) {
        if (tx >= r.gridX && tx < r.gridX + r.width &&
            ty >= r.gridY && ty < r.gridY + r.height) {
          const defs = this._cachedJson('rooms') ?? []
          const d = defs.find(x => x.id === r.definitionId)
          return d?.name ?? r.definitionId ?? '—'
        }
      }
    }
    return this._roomName(m.assignedRoomId)
  }

  _minionDefinition(m) {
    const defs = this._cachedJson('minionTypes') ?? []
    return defs.find(d => d.id === m.definitionId)
  }

  _cachedJson(key) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.(key)
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
    }
    return null
  }

  _tierOf(m) {
    // Tier = the minion's position in its evolution chain: chain[0] is
    // T1, chain[1] T2, chain[2] T3. The definitionId mutates up the
    // chain on each evolution, so the current id directly encodes the
    // tier. (The old unlockLevel heuristic was wrong — unlockLevel is
    // the boss level the type unlocks at, not its evolution stage. e.g.
    // orc1 "Orc Marauder" is a T1 starter but unlocks at boss-lvl 3, so
    // it was mislabeled T2; every evolution-only form has unlockLevel 99
    // so they all collapsed to T3.)
    const id     = m?.definitionId
    const chains = this._cachedJson('minionEvolutions') ?? {}
    for (const data of Object.values(chains)) {
      const chain = data?.chain
      if (Array.isArray(chain)) {
        const i = chain.indexOf(id)
        if (i !== -1) return `T${i + 1}`
      }
    }
    // Not part of any evolution chain (summoned adds, special minions) —
    // fall back to an explicit tier field if the def has one, else T1.
    const def = this._minionDefinition(m)
    return def?.tier ? `T${def.tier}` : 'T1'
  }

  // Tier badge colour. T4 exists for the slime lines (their evolution
  // chains are four deep).
  _tierColor(tier) {
    return tier === 'T1' ? 'var(--text-mute)'
         : tier === 'T2' ? 'var(--gold)'
         : tier === 'T3' ? 'var(--blood)'
         : 'var(--info)'
  }

  // ── Render ──────────────────────────────────────────────────────
  _renderBody() {
    const minions = this._minions()
    const counts = {
      ALL:     minions.length,
      READY:   minions.filter(m => this._classifyStatus(m) === 'ready').length,
      WOUNDED: minions.filter(m => this._classifyStatus(m) === 'wounded').length,
      IDLE:    minions.filter(m => this._classifyStatus(m) === 'idle').length,
    }
    const filtered = this._filter === 'ALL'
      ? minions
      : minions.filter(m => this._classifyStatus(m).toUpperCase() === this._filter)
    if (this._selIdx >= filtered.length) this._selIdx = 0
    const sel = filtered[this._selIdx]
    const totalKills = minions.reduce((s, m) => s + (m.lifetime?.kills ?? 0), 0)
    const avgLv = minions.length > 0
      ? (minions.reduce((s, m) => s + (m.bossLevel ?? 1), 0) / minions.length).toFixed(1)
      : '0.0'
    const wounded = counts.WOUNDED

    return h('div', { className: 'qf-roster-body' }, [
      // Summary strip
      h('div', { className: 'qf-roster-summary' }, [
        this._summaryTile('GARRISON',     String(minions.length),        'var(--text)'),
        this._summaryTile('TOTAL KILLS',  String(totalKills),            'var(--blood)'),
        this._summaryTile('AVG LEVEL',    avgLv,                         'var(--gold)'),
        this._summaryTile('WOUNDED',      `${wounded}/${minions.length}`, wounded > 0 ? 'var(--warn)' : 'var(--poison)'),
      ]),
      // Two-column layout
      h('div', { className: 'qf-roster-main' }, [
        this._renderList(minions, filtered, counts),
        this._renderDetail(sel),
      ]),
    ])
  }

  _summaryTile(label, value, color) {
    return h('div', { className: 'qf-roster-tile' }, [
      h('div', {
        className: 'pix qf-roster-tile-value',
        style: { color, textShadow: `0 0 8px ${color}33` },
      }, value),
      h('div', { className: 'pix qf-roster-tile-label' }, label),
    ])
  }

  _renderList(allMinions, filtered, counts) {
    return h('div', { className: 'panel bevel qf-roster-listpanel' }, [
      // Filter row
      h('div', { className: 'qf-roster-filters' },
        FILTERS.map(k => {
          const active = this._filter === k
          const color = FILTER_COLORS[k]
          return h('button', {
            className: 'qf-roster-filter',
            dataset: { active: active ? 'true' : 'false' },
            style: {
              '--fc': color,
              color: active ? color : 'var(--text-mute)',
              borderTopColor: active ? color : 'transparent',
            },
            on: { click: () => { this._filter = k; this._selIdx = 0; this._rerender() } },
          }, [k, h('span', { className: 'qf-roster-filter-count' }, ` ${counts[k]}`)])
        })
      ),
      // Header row
      h('div', { className: 'qf-roster-listhead' }, [
        h('div'),
        h('div', { style: { textAlign: 'center' } }, 'TIER'),
        h('div', null, 'NAME'),
        h('div', null, 'HP'),
        h('div', null, 'LV'),
        h('div', { style: { color: 'var(--blood)' } }, 'KILLS'),
      ]),
      // Body
      h('div', { className: 'qf-roster-listbody' },
        filtered.length === 0
          ? h('div', { className: 'qf-roster-listempty' }, '— no minions match this filter —')
          : filtered.map((m, idx) => this._renderRow(m, idx, allMinions))
      ),
    ])
  }

  _renderRow(m, idx, allMinions) {
    const status = this._classifyStatus(m)
    const statusColor = status === 'wounded' ? 'var(--warn)'
                      : status === 'idle'    ? 'var(--text-dim)'
                      : 'var(--poison)'
    const hp = m.resources?.hp ?? 0
    const maxHp = m.resources?.maxHp ?? 1
    const pct = maxHp > 0 ? (hp / maxHp) * 100 : 0
    const active = idx === this._selIdx
    const tier = this._tierOf(m)
    const tierColor = this._tierColor(tier)
    const kills = m.lifetime?.kills ?? 0
    const name = m.name || this._minionDefinition(m)?.name || m.definitionId || '?'

    return h('button', {
      className: 'qf-roster-row',
      dataset: { active: active ? 'true' : 'false', status },
      style: {
        background: active ? `linear-gradient(90deg, ${statusColor}1a, var(--bg-3))` : 'transparent',
        borderLeft: `3px solid ${active ? statusColor : (status === 'wounded' ? 'var(--warn)55' : 'transparent')}`,
      },
      on: { click: () => { this._selIdx = idx; this._rerender() } },
    }, [
      // Sprite
      h('div', { className: 'qf-roster-sprite' }, [
        this._minionVisual(m, 56, 'qf-roster-sprite-img'),
      ]),
      // Tier — its own column (was an overlay badge on the sprite's feet).
      h('div', { className: 'qf-roster-tier-cell' }, [
        h('span', {
          className: 'pix qf-roster-tier',
          style: { color: tierColor, borderColor: tierColor },
        }, tier),
      ]),
      // Name + status. A gold ★ flags a minion that has a bounty on its
      // head — bounty hunters will enter the dungeon specifically to kill it.
      h('div', null, [
        h('div', { className: 'qf-roster-row-name' }, [
          m.hasBounty && h('span', {
            style: { color: 'var(--gold)', marginRight: '4px' },
            title: 'BOUNTY — hunters will come for this minion',
          }, '★'),
          // ✦ flags an ascension reinforcement — the boss's kin the dungeon
          // fielded for free each act (KR P6), so it doesn't read as a mystery unit.
          m._reinforcement && h('span', {
            style: { color: '#c98bff', marginRight: '4px' },
            title: m._reinforcementElite ? 'ELITE ASCENSION REINFORCEMENT' : 'ASCENSION REINFORCEMENT',
          }, '✦'),
          name,
        ]),
        h('div', {
          className: 'pix qf-roster-row-status',
          style: { color: statusColor },
        }, [
          h('span', {
            className: status === 'wounded' ? 'blink' : '',
            style: {
              display: 'inline-block', width: '4px', height: '4px',
              background: statusColor, marginRight: '4px',
              verticalAlign: 'middle', boxShadow: `0 0 4px ${statusColor}`,
            },
          }),
          `${status.toUpperCase()} · ${this._minionLocationLabel(m)}`,
        ]),
      ]),
      // HP bar
      h('div', null, [
        h('div', { className: 'bar thin' }, [
          h('div', {
            className: 'fill',
            style: {
              width: `${pct}%`,
              background: pct < 50 ? 'var(--warn)' : 'var(--poison)',
            },
          }),
          h('div', { className: 'num', style: { fontSize: '7px' } }, `${hp}/${maxHp}`),
        ]),
      ]),
      // LV — minions scale to the BOSS level (m.bossLevel), not a per-minion
      // XP level (that system was removed 2026-05-29).
      h('div', { className: 'pix qf-roster-row-lv' }, String(m.bossLevel ?? 1)),
      // Kills + lethal skull
      h('div', { className: 'qf-roster-row-kills' }, [
        h('span', {
          className: 'pix',
          style: { color: kills > 0 ? 'var(--blood)' : 'var(--text-dim)' },
        }, String(kills)),
        kills >= 3 && h('span', {
          className: 'pix',
          style: { fontSize: '8px', color: 'var(--blood)' },
          title: 'lethal',
        }, '☠'),
      ]),
    ])
  }

  _renderDetail(sel) {
    if (!sel) {
      return h('div', { className: 'panel bevel qf-roster-detail qf-roster-detail-empty' }, [
        h('div', { className: 'pix' }, '◇ NO MINION SELECTED ◇'),
      ])
    }
    const status = this._classifyStatus(sel)
    const tier = this._tierOf(sel)
    const tierColor = this._tierColor(tier)
    const hp = sel.resources?.hp ?? 0
    const maxHp = sel.resources?.maxHp ?? 1
    const pct = maxHp > 0 ? (hp / maxHp) * 100 : 0
    const def = this._minionDefinition(sel)
    const name = sel.name || def?.name || sel.definitionId || '?'
    const dmg = sel.stats?.attack ?? 0
    const armor = sel.stats?.defense ?? 0
    const speed = sel.stats?.speed ?? 0
    const kills = sel.lifetime?.kills ?? 0
    const tags = def?.tags ?? []
    const description = def?.description ?? def?.flavorText ?? '—'

    return h('div', { className: 'panel bevel qf-roster-detail' }, [
      // Portrait card
      h('div', {
        className: 'qf-roster-portrait',
        style: {
          background: `radial-gradient(circle at 50% 60%, ${status === 'wounded' ? 'rgba(232,154,60,0.18)' : 'rgba(107,160,58,0.16)'}, transparent 65%), var(--bg-0)`,
          borderColor: status === 'wounded' ? 'var(--warn)' : 'var(--line-2)',
          boxShadow: status === 'wounded' ? 'inset 0 0 24px rgba(232,154,60,0.15)' : 'inset 0 0 24px rgba(0,0,0,0.5)',
        },
      }, [
        // Corner registration marks
        ...['tl','tr','bl','br'].map(p => h('div', {
          className: `qf-roster-corner qf-roster-corner-${p}`,
        })),
        // Big sprite
        this._minionVisual(sel, 208, 'qf-roster-portrait-sprite'),
        // Tier+LV chip
        h('div', {
          className: 'pix qf-roster-tier-chip',
          style: { color: tierColor, borderColor: tierColor },
        }, `${tier} · LV ${sel.bossLevel ?? 1}`),
      ]),
      // Name + assignment
      h('div', { className: 'pix qf-roster-detail-name' }, name),
      h('div', { className: 'qf-roster-detail-assign' }, [
        h('span', { className: 'pix qf-roster-detail-kind' }, minionLabel(sel.definitionId).toUpperCase()),
        h('span', { style: { margin: '0 6px', color: 'var(--text-dim)' } }, '·'),
        ' stationed at ',
        h('span', { style: { color: 'var(--poison)' } }, this._minionLocationLabel(sel)),
      ]),
      // HP bar
      h('div', { className: 'bar', style: { marginBottom: '12px' } }, [
        h('div', {
          className: 'fill',
          style: {
            width: `${pct}%`,
            background: pct < 50 ? 'var(--warn)' : 'var(--poison)',
          },
        }),
        h('div', { className: 'num' }, `${hp} / ${maxHp}`),
      ]),
      // Stat grid
      h('div', { className: 'qf-roster-stats' }, [
        this._statTile('DMG',   String(dmg),                   'var(--blood)',  '⚔'),
        this._statTile('ARMOR', String(armor),                 'var(--rumor)',  '◇'),
        this._statTile('SPEED', Number(speed).toFixed(1),      'var(--gold)',   '▸'),
        this._statTile('KILLS', String(kills),                 'var(--poison)', '☠'),
      ]),
      // Traits
      h('div', { className: 'pix qf-roster-section-label' }, 'TRAITS'),
      h('div', { className: 'qf-roster-traits' },
        tags.length === 0
          ? [h('span', { className: 'pix qf-roster-trait' }, 'BEAST')]
          : tags.slice(0, 6).map(t => h('span', { className: 'pix qf-roster-trait' }, String(t).toUpperCase()))
      ),
      // Description
      h('div', { className: 'qf-roster-desc' }, description),
      // Recent — placeholder. The existing minion entity doesn't store a
      // tagged event log per-minion; killHistory could be summarized
      // here but it's just IDs. Left as a static placeholder for now.
      h('div', { className: 'pix qf-roster-section-label' }, 'RECENT'),
      h('div', { className: 'qf-roster-recent' },
        kills > 0
          ? [h('div', null, [
              h('span', null, `${kills} kill${kills === 1 ? '' : 's'} this run.`),
              h('span', { className: 'pix', style: { fontSize: '7px', color: 'var(--text-dim)' } }, `D${this._gameState.meta?.dayNumber ?? '?'}`),
            ])]
          : [h('div', { style: { color: 'var(--text-dim)', fontStyle: 'italic' } }, '— no events —')]
      ),
      // Actions — UI-only for now (no gameplay paths wired yet)
      h('div', { className: 'qf-roster-actions' }, [
        h('button', { className: 'btn qf-roster-action' }, [
          h('span', { style: { color: 'var(--poison)' } }, '⤧'),
          ' REASSIGN',
        ]),
        h('button', {
          className: 'btn qf-roster-action',
          on: { click: () => this._onRename(sel) },
        }, [
          h('span', { style: { color: 'var(--gold)' } }, '✎'),
          ' RENAME',
        ]),
        h('button', {
          className: 'btn qf-roster-action qf-roster-action-danger',
          on: { click: () => this._onSacrifice(sel) },
        }, [
          h('span', { style: { color: 'var(--blood)' } }, '☠'),
          ' SACRIFICE',
        ]),
      ]),
    ])
  }

  _statTile(label, value, color, icon) {
    return h('div', { className: 'qf-roster-stat' }, [
      h('div', {
        className: 'pix qf-roster-stat-icon',
        style: { color, opacity: 0.5 },
      }, icon),
      h('div', {
        className: 'pix qf-roster-stat-value',
        style: { color },
      }, value),
      h('div', { className: 'pix qf-roster-stat-label' }, label),
    ])
  }

  // Prefer the live in-game minion texture (so the roster shows the
  // exact LPC sprite the player sees in the dungeon view). Falls back
  // to the bestiary family portrait when the Phaser texture isn't
  // loaded yet — same contract as the old _spriteBg path.
  _minionVisual(m, size, className) {
    const snap = snapshotMinion(m?.definitionId, size)
    if (snap) {
      // Let the CSS class drive the displayed size — the canvas's
      // native pixel resolution (passed as `size`) just controls
      // sample quality during the CSS pixelated upscale.
      snap.classList.add(className)
      return snap
    }
    return h('div', { className, style: this._spriteBg(this._spriteFor(m)) })
  }

  // Sprite background — uses the same bestiary portraits the TopBar
  // uses, keyed by the family name (definitionId minus trailing digit).
  _spriteBg(family) {
    if (!family) return {}
    return {
      backgroundImage: `url('assets/ui/bestiary/portraits/${family}_p.png'), radial-gradient(circle at center, var(--bg-2), var(--bg-0))`,
      backgroundSize: 'contain, cover',
      backgroundRepeat: 'no-repeat, no-repeat',
      backgroundPosition: 'center, center',
      imageRendering: 'pixelated',
    }
  }

  _onRename(minion) {
    if (!minion) return
    if (this._nameEntry) return
    const current = minion.name || ''
    this._nameEntry = new NameEntryOverlay({
      title:       'RENAME MINION',
      instruction: 'A true name to remember the slaughter by.',
      initial:     current,
      confirmLabel:'CONFIRM',
      onConfirm: (name) => {
        this._nameEntry = null
        if (!name) return
        minion.name = name
        EventBus.emit('MINION_NAMED', { minion, name })
        // Re-render to reflect the new name immediately.
        this._rerender?.()
      },
      onCancel: () => { this._nameEntry = null },
    })
    this._nameEntry.open()
  }

  _onSacrifice(minion) {
    EventBus.emit('SHOW_CONFIRM', {
      title:        'SACRIFICE MINION',
      message:      `Permanently destroy ${minion.name || minionLabel(minion.definitionId)}?`,
      confirmLabel: 'SACRIFICE',
      cancelLabel:  'CANCEL',
      theme:        'crimson',
      onConfirm: () => {
        // Wired 2026-06-02 — NightPhase listens for MINION_SACRIFICE_REQUEST
        // and permanently destroys the minion (no refund) via
        // _doSacrificeMinion (build-phase action).
        EventBus.emit('MINION_SACRIFICE_REQUEST', { instanceId: minion.instanceId })
        this._rerender()
      },
    })
  }

  destroy() {
    EventBus.off('OPEN_MINION_ROSTER', this._listener)
    this._overlay?.close()
    this._overlay = null
  }
}

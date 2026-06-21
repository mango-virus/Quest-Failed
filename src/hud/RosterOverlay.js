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

import { h } from './dom.js'
import { TrayShell } from './TrayShell.js'
import { EventBus } from '../systems/EventBus.js'
import { NameEntryOverlay } from './NameEntryOverlay.js'
import { minionLabel } from '../util/displayNames.js'
import { liveMinion } from './inGameSnapshot.js'

export class RosterOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._tray = null
    this._listeners = []
    this._filter = 'ALL'
    this._selId = null   // selected minion instanceId (reveals row actions)
    this._listener = () => this.toggle()
    EventBus.on('OPEN_MINION_ROSTER', this._listener)
  }

  toggle() {
    if (this._tray) this.close()
    else this.open()
  }

  isOpen() { return !!this._tray }

  // The roster now flies out of its action-bar button as an anchored tray
  // (crypt-console redesign) — a bespoke barracks ledger — instead of the old
  // full-screen Overlay. All the data helpers + actions below are reused.
  open() {
    if (this._tray) return
    this._filter = 'ALL'
    this._selId = null
    this._tray = new TrayShell({
      anchorSel: '[data-tray-anchor="ROSTER"]',
      align:  'right',
      vAlign: 'up',
      accent: 'var(--poison)',
      width:  'min(52vw, 820px)',
      height: 348,
      detachable: true,
      title: 'ROSTER',
      detachedSize:      { width: '520px', height: '540px' },
      detachedSizeSmall: { width: '420px', height: '450px' },
      onClose: () => { this._tray = null },
    })
    // Reused animated sprite canvases (keyed per minion) so the live refresh
    // can rebuild rows without recreating sprites (which would restart the idle
    // loop) — see _rosterSprite.
    this._spriteCache = new Map()
    this._refreshTick = 0
    this._tray.setContent(this._renderTrayContent())
    this._tray.open()
    // Live refresh: while open, re-render ~5×/sec so HP drain, deaths, moves,
    // etc. show in real time as the wave plays.
    this._refreshLoop()
  }

  close() {
    if (this._refreshRaf) cancelAnimationFrame(this._refreshRaf)
    this._refreshRaf = null
    this._spriteCache = null
    this._tray?.close()
    this._tray = null
  }

  // ~5 fps live refresh. Paused while a row is selected (the action panel is
  // open and the player is interacting) — unless that minion just died, in which
  // case we resume + clear the stale selection. Scroll position is preserved.
  _refreshLoop() {
    this._refreshRaf = requestAnimationFrame(() => this._refreshLoop())
    if ((this._refreshTick = (this._refreshTick + 1) % 12) !== 0) return
    if (this._selId != null) {
      const sel = (this._gameState.minions ?? []).find(x => x.instanceId === this._selId)
      if (sel && this._classifyStatus(sel) !== 'dead') return   // still actionable → hold
      this._selId = null
    }
    const list = this._tray?.trayEl?.querySelector?.('.rst-list')
    const scroll = list ? list.scrollTop : 0
    this._rerender()
    const list2 = this._tray?.trayEl?.querySelector?.('.rst-list')
    if (list2) list2.scrollTop = scroll
  }

  _rerender() {
    if (this._tray) this._tray.setContent(this._renderTrayContent())
  }

  // ── Bespoke roster tray (barracks ledger) ───────────────────────
  _renderTrayContent() {
    const minions = this._minions()
    const cls = (m) => this._classifyStatus(m)
    const counts = {
      ALL:  minions.length,
      HURT: minions.filter(m => cls(m) === 'hurt').length,
      DEAD: minions.filter(m => cls(m) === 'dead').length,
    }
    let filtered = this._filter === 'HURT' ? minions.filter(m => cls(m) === 'hurt')
                 : this._filter === 'DEAD' ? minions.filter(m => cls(m) === 'dead')
                 : minions
    // Dead minions sink to the bottom as their own faded section (stable sort).
    filtered = [...filtered].sort((a, b) => (cls(a) === 'dead' ? 1 : 0) - (cls(b) === 'dead' ? 1 : 0))
    const TABS = [
      { id: 'ALL',  label: 'ALL',  glyph: '▤', c: counts.ALL },
      { id: 'HURT', label: 'HURT', glyph: '✚', c: counts.HURT },
      { id: 'DEAD', label: 'DEAD', glyph: '☠', c: counts.DEAD },
    ]
    const segbar = h('div', { className: 'htr-segbar' }, TABS.map(tb => h('div', {
      className: 'htr-segtab' + (this._filter === tb.id ? ' on' : ''),
      on: { click: () => { this._filter = tb.id; this._rerender() } },
    }, [
      h('span', { className: 'tg' }, tb.glyph),
      h('span', { className: 'lb' }, tb.label),
      h('span', { className: 'ct' }, String(tb.c)),
    ])))
    const summary = h('div', { className: 'rst-summary' }, [
      h('span', null, [ h('b', null, String(minions.length)), ' MINIONS' ]),
      h('span', { className: 'chip', style: { '--c': '#ff7a2a' } }, [ h('span', { className: 'd' }), `${counts.HURT} HURT` ]),
      h('span', { className: 'chip', style: { '--c': 'var(--mute)' } }, [ h('span', { className: 'd' }), `${counts.DEAD} DEAD` ]),
    ])
    const list = h('div', { className: 'rst-list' },
      filtered.length === 0
        ? [ h('div', { className: 'rst-empty' }, [
            h('span', { className: 'ic' }, '◌'),
            this._filter === 'ALL' ? 'No minions in roster' : `No ${this._filter.toLowerCase()} minions`,
          ]) ]
        : filtered.map((m, i) => this._renderRosterRow(m, i)))
    return h('div', { className: 'htr-chrome m-col' }, [
      segbar,
      h('div', { className: 'htr-content' }, [
        h('div', { className: 'rst-col' }, [ summary, list ]),
      ]),
    ])
  }

  _renderRosterRow(m, idx) {
    const status = this._classifyStatus(m)          // healthy / hurt / dead
    const statusColor = status === 'healthy' ? 'var(--poison)'
                      : status === 'hurt'    ? '#ff7a2a'
                      : 'var(--mute)'               // dead
    const dead = status === 'dead'
    const tier = this._tierOf(m)
    const tierColor = this._tierColor(tier)
    const hp = Math.round(m.resources?.hp ?? 0)
    const maxHp = Math.round(m.resources?.maxHp ?? 1)
    const pct = maxHp > 0 ? Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100))) : 0
    const def = this._minionDefinition(m)
    const name = m.name || def?.name || minionLabel(m.definitionId) || '?'
    const kind = (def?.name || minionLabel(m.definitionId) || '').toString()
    const tags = (m._revivedAdv ? ['undead'] : (def?.tags ?? [])).slice(0, 3)
    const loc = this._minionLocationLabel(m)
    const selected = !dead && this._selId === m.instanceId   // dead rows aren't actionable
    return h('div', {
      className: 'rst-row' + (selected ? ' on' : ''),
      dataset: { st: status },
      style: { '--rar': statusColor, '--sc': statusColor, '--tier': tierColor, '--i': idx },
      on: dead ? {} : { click: () => { this._selId = selected ? null : m.instanceId; this._rerender() } },
    }, [
      h('div', { className: 'rst-port' }, [ this._rosterSprite(m) ].filter(Boolean)),
      h('div', { className: 'rst-id' }, [
        h('span', { className: 'rst-name' }, [
          h('span', { className: 'rst-nm' }, name),
          h('span', { className: 'rst-tierchip' }, tier),
          m.hasBounty ? h('span', { className: 'rst-bnty' }, '◎') : null,
        ].filter(Boolean)),
        h('span', { className: 'rst-kind' }, `${kind} · ${loc}`),
        tags.length
          ? h('div', { className: 'rst-traits' }, tags.map(t => h('span', { className: 'rst-trait' }, String(t).toUpperCase())))
          : null,
      ].filter(Boolean)),
      // Right slot: HP + status normally; when selected, the row actions
      // (MOVE / RENAME / SELL) replace them so all roster actions stay reachable.
      selected
        ? h('div', { className: 'rst-acts' }, [
            h('button', { className: 'rst-act', on: { click: (e) => { e.stopPropagation(); this._onReassign(m) } } }, 'MOVE'),
            h('button', { className: 'rst-act', on: { click: (e) => { e.stopPropagation(); this._onRename(m) } } }, 'RENAME'),
            h('button', { className: 'rst-act sell', on: { click: (e) => { e.stopPropagation(); this._onSacrifice(m) } } }, 'SELL'),
          ])
        : h('div', { className: 'rst-hp' }, [
            h('div', { className: 'rst-hp-top' }, [ h('span', null, 'HP'), h('span', { className: 'rst-hp-val' }, `${hp}/${maxHp}`) ]),
            h('div', { className: 'rst-hp-bar' }, [ h('div', { className: 'rst-hp-fill', style: { width: pct + '%' } }) ]),
          ]),
      selected ? null : h('div', { className: 'rst-status' }, status.toUpperCase()),
    ].filter(Boolean))
  }

  // ── Data helpers ────────────────────────────────────────────────
  _minions() {
    // The player's roster — including the dead (shown faded in their own
    // section). Permadead minions are spliced from gameState.minions elsewhere,
    // so anything still here with aiState 'dead' is a wave casualty worth showing.
    return (this._gameState.minions ?? [])
  }

  // healthy (full HP) → green, hurt (any missing HP) → orange, dead → grey.
  _classifyStatus(m) {
    if (m.aiState === 'dead' || m.deathDay != null) return 'dead'
    const hp    = Math.round(m.resources?.hp ?? 0)
    const maxHp = Math.round(m.resources?.maxHp ?? 1)
    return (hp < maxHp) ? 'hurt' : 'healthy'
  }

  // Sprite uses the existing bestiary portrait when one exists for the
  // minion's archetype family — otherwise a colored-glyph fallback.
  // Looks for `assets/ui/bestiary/portraits/{family}_p.png`.
  _spriteFor(m) {
    const id = String(m.definitionId || '').replace(/[0-9]+$/, '') // strip tier suffix
    return id
  }

  // The minion's actual idle sprite (same source as the bestiary doctrine), so
  // every family shows — the old bestiary-portrait PNGs were missing for many.
  _rosterSprite(m) {
    // Reuse the same canvas across live re-renders (it gets re-parented into the
    // new row) so the idle animation keeps playing instead of restarting.
    const key = `${m.instanceId}:${m.definitionId}`
    const cache = this._spriteCache
    if (cache?.has(key)) return cache.get(key)
    const snap = liveMinion(m.definitionId, 56)
    if (!snap) return null
    snap.style.maxWidth = '100%'
    snap.style.maxHeight = '100%'
    snap.style.imageRendering = 'pixelated'
    snap.style.pointerEvents = 'none'
    cache?.set(key, snap)
    return snap
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

  _onReassign(minion) {
    // Enter NightPhase's "click a room" reassign mode (it listens for
    // MINION_REASSIGN_BEGIN), then close the roster so the dungeon map is
    // clickable. Wired 2026-06-02 — the button was previously inert.
    EventBus.emit('MINION_REASSIGN_BEGIN', { instanceId: minion.instanceId })
    this.close()
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

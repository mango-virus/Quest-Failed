// CodexOverlay — in-game reference encyclopedia opened from the Pause menu.
//
// Tabs: ADVENTURERS / MINIONS / ROOMS / TRAPS / GUIDE. Each non-guide tab is a
// scrollable 2-column card grid populated LIVE from the JSON caches
// (adventurerClasses / minionTypes / rooms / trapTypes) so it never drifts from
// the real content — name, cost, unlock level, description. GUIDE is a set of
// static how-to-play cards. Crypt shell (eyebrow + no ✕); closes on Esc /
// backdrop. Ported from hud-overlay-codex.jsx.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'

// Per-category glyph + accent (the raw JSON carries no icon field, so the codex
// keys each category by a single sigil + colour rather than per-item art).
const TABS = [
  { id: 'adv',   label: 'ADVENTURERS', color: 'var(--warn)',   glyph: '⚔', cache: 'adventurerClasses' },
  { id: 'min',   label: 'MINIONS',     color: 'var(--poison)', glyph: '✦', cache: 'minionTypes' },
  { id: 'room',  label: 'ROOMS',       color: 'var(--gold)',   glyph: '◰', cache: 'rooms' },
  { id: 'trap',  label: 'TRAPS',       color: 'var(--blood)',  glyph: '⚒', cache: 'trapTypes' },
  { id: 'guide', label: 'GUIDE',       color: 'var(--rumor)',  glyph: '◈', cache: null },
]

// Static how-to-play cards (from the design — these are reference copy, not data).
const GUIDE = [
  { icon: '☾', c: 'var(--rumor)',          name: 'THE NIGHT · BUILD',    desc: 'Spend gold on rooms, traps and minions to fortify the deep. End the night with BEGIN DAY when your path is ready.' },
  { icon: '☀', c: 'var(--gold)',           name: 'THE DAY · INVASION',   desc: 'Adventurers raid your dungeon. Funnel them through traps and minions; protect the boss and your treasury.' },
  { icon: '☠', c: 'var(--blood)',          name: 'THE BOSS',             desc: 'You are the dark lord. If the boss falls you lose a life; lose all lives and your reign ends.' },
  { icon: '◈', c: 'var(--info)',           name: 'DARK PACTS',           desc: 'Powerful boons with a price, chosen on level-up. Stack them to shape your run — mind the trade-offs.' },
  { icon: '◇', c: 'var(--gold-bright)',    name: 'GOLD & GREED',         desc: 'Treasuries and chests pay out nightly but lure greedier invaders. Looters that escape steal a cut of your hoard.' },
  { icon: '◉', c: 'var(--warn)',           name: 'INTEL & EXPOSURE',     desc: 'Every adventurer that escapes leaks your layout. The more they know, the smarter the next wave arrives.' },
]

export class CodexOverlay {
  constructor(opts = {}) {
    this._onClose = opts.onClose ?? null
    this._overlay = null
    this._tab = 'adv'
  }

  open() {
    if (this._overlay) return
    this._overlay = new Overlay({
      npcKind: 'codex',
      title:   'CODEX',
      eyebrow: 'LORE OF THE DEEP',
      width:   1300,
      height:  820,
      accent:  'var(--rumor)',
      frame:   'plain',
      animation: 'unfurl',
      onClose: () => { this._overlay = null; this._onClose?.() },
      body:    this._renderBody(),
    })
    this._overlay.open()
  }

  close() { this._overlay?.close() }
  destroy() { this.close() }

  _selectTab(id) {
    if (id === this._tab) return
    this._tab = id
    this._overlay?.setBody(this._renderBody())
  }

  // Pull a content array from whichever scene cache holds it.
  _cacheArr(key) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.(key)
      if (Array.isArray(v)) return v
    }
    return []
  }

  // Real, player-buildable / encounterable entries: drop hidden + event-only
  // (unlockLevel 99 sentinel) defs, sort by unlock tier then name.
  _entriesFor(cacheKey) {
    return this._cacheArr(cacheKey)
      .filter(d => d && !d.hidden && (d.unlockLevel ?? 1) < 99)
      .sort((a, b) => (a.unlockLevel ?? 1) - (b.unlockLevel ?? 1) || String(a.name).localeCompare(String(b.name)))
  }

  // Live gameState (Codex opens in-game from Pause) — drives per-run discovery.
  _gs() {
    return window.__game?.scene?.getScene?.('Game')?.gameState ?? null
  }

  _bossLevel() { return this._gs()?.boss?.level ?? 1 }

  // Adventurer classes ENCOUNTERED this run (currently invading, killed, or in
  // the knowledge list). A class is "discovered" once any of its members shows up.
  _seenAdvClasses() {
    if (this._advSeen) return this._advSeen
    const a = this._gs()?.adventurers ?? {}
    const set = new Set()
    for (const list of [a.active, a.graveyard, a.known]) {
      if (!Array.isArray(list)) continue
      for (const e of list) {
        const c = e?.classId ?? e?.class ?? e?.classKey
        if (c) set.add(String(c))
      }
    }
    this._advSeen = set
    return set
  }

  // Is this entry discovered yet (per the per-run model)?
  //   adventurers — encountered this run; buildables — unlocked at boss level.
  _isDiscovered(tabId, d) {
    if (tabId === 'adv') return this._seenAdvClasses().has(String(d.id))
    return (d.unlockLevel ?? 1) <= this._bossLevel()
  }

  _count(tab) {
    if (tab.id === 'guide') return GUIDE.length
    const entries = this._entriesFor(tab.cache)
    const found = entries.filter(d => this._isDiscovered(tab.id, d)).length
    return `${found}/${entries.length}`
  }

  _renderBody() {
    return h('div', { className: 'qf-cdx' }, [
      // Tabs
      h('div', { className: 'qf-cdx-tabs' },
        TABS.map(t => h('button', {
          className: 'pix qf-cdx-tab' + (t.id === this._tab ? ' on' : ''),
          style: { '--tc': t.color },
          on: { click: () => this._selectTab(t.id) },
        }, [t.label, h('span', { className: 'sil ct' }, String(this._count(t)))]))
      ),
      // Card grid
      h('div', { className: 'qf-cdx-body' }, this._renderCards()),
    ])
  }

  _renderCards() {
    const tab = TABS.find(t => t.id === this._tab) ?? TABS[0]
    if (tab.id === 'guide') {
      return GUIDE.map(g => this._card({ color: g.c, glyph: g.icon, name: g.name, desc: g.desc }))
    }
    const showCost = tab.id !== 'adv'   // adventurers aren't bought, no cost chip
    const lv = tab.id === 'adv' ? null : true   // buildables show the unlock-level teaser
    return this._entriesFor(tab.cache).map(d => {
      const discovered = this._isDiscovered(tab.id, d)
      return this._card({
        color: tab.color,
        glyph: tab.glyph,
        name:  String(d.name ?? d.id ?? '').toUpperCase(),
        desc:  d.description ?? '',
        cost:  showCost ? d.goldCost : null,
        lv:    lv ? (d.unlockLevel ?? 1) : null,
        locked: !discovered,
        // Locked teaser: buildables reveal WHEN they unlock; adventurers stay coy.
        lockHint: tab.id === 'adv'
          ? 'Not yet encountered — defeat this foe to record it.'
          : `Unlocks at boss level ${d.unlockLevel ?? 1}.`,
      })
    })
  }

  _card({ color, glyph, name, desc, cost, lv, locked, lockHint } = {}) {
    if (locked) {
      // "???" card: hide the name + flavour, keep the unlock-level teaser (if any)
      // so the player knows something's coming and how to reach it.
      return h('div', { className: 'qf-cdx-card locked', style: { '--cc': color } }, [
        h('div', { className: 'qf-cdx-ico' }, '?'),
        h('div', { className: 'qf-cdx-txt' }, [
          h('div', { className: 'qf-cdx-head' }, [
            h('span', { className: 'pix qf-cdx-name' }, '? ? ?'),
            lv != null ? h('span', { className: 'sil qf-cdx-meta', style: { color } }, `LV ${lv}`) : null,
          ].filter(Boolean)),
          lockHint && h('div', { className: 'qf-cdx-desc qf-cdx-lockhint' }, lockHint),
        ]),
      ])
    }
    const meta = []
    if (cost != null) {
      meta.push(cost === 0
        ? h('span', { className: 'sil qf-cdx-meta', style: { color: 'var(--poison)' } }, 'FREE')
        : h('span', { className: 'pix qf-cdx-cost' }, [h('i'), String(cost)]))
    }
    if (lv != null) meta.push(h('span', { className: 'sil qf-cdx-meta', style: { color } }, `LV ${lv}`))
    return h('div', { className: 'qf-cdx-card', style: { '--cc': color } }, [
      h('div', { className: 'qf-cdx-ico' }, glyph),
      h('div', { className: 'qf-cdx-txt' }, [
        h('div', { className: 'qf-cdx-head' }, [
          h('span', { className: 'pix qf-cdx-name' }, name),
          ...meta,
        ]),
        desc && h('div', { className: 'qf-cdx-desc' }, desc),
      ].filter(Boolean)),
    ])
  }
}

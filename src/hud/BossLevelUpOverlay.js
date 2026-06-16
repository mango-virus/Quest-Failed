// BossLevelUpOverlay — DOM port of the boss level-up celebratory popup.
//
// Listens for `SHOW_BOSS_LEVEL_UP { fromLevel, toLevel }`. Hero burst
// (counter-rotating rune rings + LV X ▶ LV Y slam-in) + POWER GAINS stat
// tiles + NEWLY UNLOCKED 4-category grid (Rooms / Minions / Traps / Items)
// reading from each JSON cache filtered by `unlockLevel === toLevel`.
//
// Closes on CONTINUE — emits `BOSS_LEVEL_UP_DISMISSED` so EndOfDay can
// advance the queue if multiple level-ups happened in one day.

import { h } from './dom.js'
import { Overlay } from './Overlay.js'
import { EventBus } from '../systems/EventBus.js'
import { Balance } from '../config/balance.js'
import { runCountUp } from './countUp.js'

const CATEGORY_META = [
  { key: 'rooms',       title: 'ROOMS',   icon: '◰', color: 'var(--blood)' },
  { key: 'minionTypes', title: 'MINIONS', icon: '✦', color: 'var(--poison)' },
  { key: 'trapTypes',   title: 'TRAPS',   icon: '⚒', color: 'var(--warn)' },
  { key: 'items',       title: 'ITEMS',   icon: '◆', color: 'var(--info)' },
]

export class BossLevelUpOverlay {
  constructor(gameState) {
    this._gameState = gameState
    this._overlay = null
    this._fromLevel = 1
    this._toLevel   = 2
    this._cuCancel  = null
    this._listener = (payload) => this.showFor(payload)
    EventBus.on('SHOW_BOSS_LEVEL_UP', this._listener)
  }

  showFor({ fromLevel = 1, toLevel = 2 } = {}) {
    if (this._overlay) this._closeNow(/* fireDismiss */ false)
    this._fromLevel = fromLevel
    this._toLevel   = toLevel
    const body = this._renderBody()
    this._overlay = new Overlay({
      npcKind: 'levelup',
      // Stay screen-centered — the ASCENSION screen is a full-attention
      // celebratory moment, not a docked side menu.
      dock:    false,
      title:   'ASCENSION',
      hideClose: true,   // closes via CONTINUE THE NIGHT (design: no ✕)
      hideHeader: true,  // body renders its own ASCENSION hero burst
      width:   980,
      height:  680,
      accent:  'var(--gold)',
      frame:   'plain',   // single subtle main-menu-edge border (matches other menus)
      onClose: () => { this._overlay = null; this._cancelCountUp(); EventBus.emit('BOSS_LEVEL_UP_DISMISSED') },
      body,
    })
    this._overlay.open()
    // Cascade the new power-gain numbers up from 0 (with count SFX).
    this._cuCancel = runCountUp(body)
  }

  _cancelCountUp() {
    this._cuCancel?.()
    this._cuCancel = null
  }

  _cachedJson(key) {
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.(key)
      if (Array.isArray(v) || (v && typeof v === 'object')) return v
    }
    return null
  }

  _unlockedAt(cacheKey, level) {
    const all = this._cachedJson(cacheKey) ?? []
    return all.filter(d => (d?.unlockLevel ?? 1) === level && !d?.hidden)
  }

  _renderBody() {
    const archId = String(this._gameState.player?.bossArchetypeId ?? '').replace(/^the_/, '')
    return h('div', { className: 'qf-levelup-body' }, [
      // Hero burst
      h('div', { className: 'qf-levelup-hero' }, [
        h('div', { className: 'qf-boss-ring qf-boss-ring-outer' }),
        h('div', { className: 'qf-boss-ring qf-boss-ring-inner' }),
        h('div', { className: 'qf-levelup-spokes' },
          Array.from({ length: 16 }, (_, i) => h('div', {
            className: 'qf-levelup-spoke',
            style: { transform: `rotate(${i * 22.5}deg)` },
          }))
        ),
        h('div', {
          className: 'qf-levelup-sprite',
          style: archId ? {
            backgroundImage: `url('assets/ui/bestiary/portraits/${archId}_p.png')`,
            backgroundSize:  'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            imageRendering: 'pixelated',
          } : {},
        }),
        h('div', { className: 'pix qf-levelup-eyebrow' }, '◇ ASCENSION ◇'),
        h('div', { className: 'qf-levelup-lvrow' }, [
          h('span', { className: 'pix qf-levelup-lv-from' },
            `LV ${String(this._fromLevel).padStart(2, '0')}`),
          h('span', { className: 'pix qf-levelup-lv-arrow' }, '▶'),
          h('span', { className: 'pix qf-levelup-lv-to day-stamp' },
            `LV ${String(this._toLevel).padStart(2, '0')}`),
        ]),
      ]),
      // Power gains
      h('div', { className: 'qf-levelup-section' }, [
        h('div', { className: 'pix qf-levelup-section-title' }, '◇ POWER GAINS'),
        h('div', { className: 'qf-levelup-stats' }, this._renderStats()),
      ]),
      // Newly unlocked
      h('div', { className: 'qf-levelup-section' }, [
        h('div', { className: 'pix qf-levelup-section-title' }, '◇ NEWLY UNLOCKED'),
        h('div', { className: 'qf-levelup-unlocks' }, this._renderUnlocks()),
      ]),
      // Continue
      h('button', {
        className: 'btn primary lg qf-levelup-continue',
        on: { click: () => this._closeNow(true) },
      }, 'CONTINUE THE NIGHT'),
    ])
  }

  _renderStats() {
    const toLv   = this._toLevel
    const fromLv = this._fromLevel
    const levels = Math.max(1, toLv - fromLv)

    // Boss fight-stat gains. The boss object already carries the
    // post-level-up values by the time this popup shows (Game's
    // BOSS_LEVELED_UP handler ran first), so back out the pre-level-up
    // numbers from the per-level constants.
    const boss = this._gameState.boss ?? {}
    const bossHpGain  = Balance.BOSS_HP_PER_LEVEL  * levels
    const bossAtkGain = Balance.BOSS_ATK_PER_LEVEL * levels
    const bossDefGain = Balance.BOSS_DEF_PER_LEVEL * levels
    const bossHpTo  = boss.maxHp   ?? 0
    const bossAtkTo = boss.attack  ?? 0
    const bossDefTo = boss.defense ?? 0

    // Minion HP / ATK scale is (1 + perLv·(level - 1)) — illustrated
    // against a reference 100 HP / 10 ATK minion.
    const hpBase  = 100
    const atkBase = 10
    const hpFrom  = Math.round(hpBase  * (1 + Balance.MINION_HP_PER_BOSS_LV  * (fromLv - 1)))
    const hpTo    = Math.round(hpBase  * (1 + Balance.MINION_HP_PER_BOSS_LV  * (toLv   - 1)))
    const atkFrom = Math.round(atkBase * (1 + Balance.MINION_ATK_PER_BOSS_LV * (fromLv - 1)))
    const atkTo   = Math.round(atkBase * (1 + Balance.MINION_ATK_PER_BOSS_LV * (toLv   - 1)))
    const dHpPct  = Math.round((hpTo  / hpFrom  - 1) * 100)
    const dAtkPct = Math.round((atkTo / atkFrom - 1) * 100)

    const tiles = [
      { label: 'BOSS HP',   from: bossHpTo  - bossHpGain,  to: bossHpTo,  delta: `+${bossHpGain}`,  color: 'var(--hp)' },
      { label: 'BOSS ATK',  from: bossAtkTo - bossAtkGain, to: bossAtkTo, delta: `+${bossAtkGain}`, color: 'var(--blood)' },
      { label: 'BOSS DEF',  from: bossDefTo - bossDefGain, to: bossDefTo, delta: `+${bossDefGain}`, color: 'var(--info)' },
      { label: 'MINION HP', from: hpFrom,  to: hpTo,  delta: `+${dHpPct}%`,  color: 'var(--poison)' },
      { label: 'MINION ATK',from: atkFrom, to: atkTo, delta: `+${dAtkPct}%`, color: 'var(--gold)' },
      { label: 'GRID',      from: 'fixed', to: 'expanded', delta: '+', color: 'var(--rumor)' },
    ]
    return tiles.map((t, i) => h('div', {
      className: 'qf-levelup-stat',
      style: { '--stat-color': t.color, animationDelay: `${600 + i * 100}ms` },
    }, [
      h('div', { className: 'pix qf-levelup-stat-label' }, t.label),
      h('div', { className: 'qf-levelup-stat-row' }, [
        h('span', { className: 'pix qf-levelup-stat-from' }, String(t.from)),
        h('span', { className: 'pix qf-levelup-stat-arrow' }, '▶'),
        h('span', {
          className: 'pix qf-levelup-stat-to cu',
          style: { color: t.color },
        }, String(t.to)),
      ]),
      h('div', {
        className: 'pix qf-levelup-stat-delta',
        style: { color: t.color },
      }, t.delta),
    ]))
  }

  _renderUnlocks() {
    return CATEGORY_META.map((cat, i) => {
      const items = this._unlockedAt(cat.key, this._toLevel)
      return h('div', {
        className: 'qf-levelup-unlock-card',
        style: {
          '--cat-color': cat.color,
          borderTopColor: cat.color,
          animationDelay: `${900 + i * 120}ms`,
        },
      }, [
        h('div', { className: 'qf-levelup-unlock-head' }, [
          h('span', {
            className: 'pix qf-levelup-unlock-icon',
            style: { color: cat.color, textShadow: `0 0 6px ${cat.color}` },
          }, cat.icon),
          h('span', { className: 'pix qf-levelup-unlock-title' }, cat.title),
        ]),
        items.length === 0
          ? h('div', { className: 'qf-levelup-unlock-empty' }, '— none —')
          : h('div', { className: 'qf-levelup-unlock-items' },
              items.slice(0, 4).map(item => h('div', { className: 'qf-levelup-unlock-row' }, [
                h('span', { className: 'pix qf-levelup-unlock-itemname' }, item.name || item.id),
                h('span', {
                  className: 'pix qf-levelup-unlock-newtag',
                  style: { color: cat.color, borderColor: cat.color },
                }, 'NEW'),
              ]))
            ),
      ])
    })
  }

  _closeNow(fireDismiss) {
    const ov = this._overlay
    this._overlay = null
    this._cancelCountUp()
    if (!fireDismiss) ov?._opts && (ov._opts.onClose = null)
    ov?.close()
  }

  destroy() {
    EventBus.off('SHOW_BOSS_LEVEL_UP', this._listener)
    this._closeNow(false)
  }
}

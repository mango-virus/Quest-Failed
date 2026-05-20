// TopBar — DOM port of the design's top HUD strip.
//
// 3-column layout:
//   LEFT   — boss portrait button + name + LV + HP chip-bar + XP bar + buff slots + hearts
//   CENTER — phase eyebrow + DAY {n} stamp
//   RIGHT  — TREASURY label + coin + animated gold number
//
// State is pulled by polling gameState each frame. EventBus subscriptions
// fire one-shot animation re-triggers (day stamp on phase change, etc.).
// Boss portrait click emits 'OPEN_BOSS_OVERVIEW' — same channel the
// existing Phaser ActionBar uses, so the popup wiring keeps working
// during the migration.

import { h, tween } from './dom.js'
import { EventBus } from '../systems/EventBus.js'

export class TopBar {
  constructor(gameState) {
    this._gameState = gameState
    this._listeners = []
    this._tweenCancel = null

    // Cached previous values so we only mutate the DOM on change.
    this._prev = {
      day:      null,
      phase:    null,
      hp:       null,
      maxHp:    null,
      xp:       null,
      xpMax:    null,
      level:    null,
      lives:    null,
      gold:     null,
    }

    this.el = this._build()
    this._wireEvents()
    this._tickHandle = requestAnimationFrame(() => this._tick())
  }

  _build() {
    // Refs the tick loop writes to.
    this._refs = {}

    const root = h('div', { className: 'qf-topbar', id: 'qf-topbar' }, [
      // LEFT — boss block
      h('div', { className: 'qf-topbar-left' }, [
        h('button', {
          className: 'boss-portrait-btn',
          title: 'Open boss overview',
          on: { click: () => EventBus.emit('OPEN_BOSS_OVERVIEW') },
        }, [
          h('div', {
            className: 'qf-boss-sprite',
            ref: el => { this._refs.bossSprite = el },
          }),
        ]),
        h('div', { className: 'qf-boss-info' }, [
          h('div', { className: 'qf-boss-headrow' }, [
            h('div', {
              className: 'pix qf-boss-name',
              ref: el => { this._refs.bossName = el },
            }, 'BOSS'),
            h('div', {
              className: 'pix qf-boss-level gold',
              ref: el => { this._refs.bossLevel = el },
            }, 'LV 1'),
          ]),
          // HP chip-bar
          h('div', {
            className: 'bar chip-bar',
            ref: el => { this._refs.hpBar = el },
          }, [
            h('div', {
              className: 'fill ghost',
              ref: el => { this._refs.hpGhost = el },
              style: { width: '100%' },
            }),
            h('div', {
              className: 'fill',
              ref: el => { this._refs.hpFill = el },
              style: { width: '100%' },
            }),
            h('div', {
              className: 'num',
              ref: el => { this._refs.hpNum = el },
            }, '0 / 0'),
          ]),
          // XP bar
          h('div', { className: 'bar xp thin', style: { marginTop: '3px' } }, [
            h('div', {
              className: 'fill',
              ref: el => { this._refs.xpFill = el },
              style: { width: '0%' },
            }),
            h('div', {
              className: 'num',
              ref: el => { this._refs.xpNum = el },
              style: { fontSize: '7px' },
            }, '0 / 0 XP'),
          ]),
          // Buff slots + hearts row
          h('div', { className: 'qf-buff-row' }, [
            h('div', {
              className: 'qf-buff-slots',
              ref: el => { this._refs.buffSlots = el },
            }),
            h('div', {
              className: 'hearts',
              ref: el => { this._refs.hearts = el },
            }),
          ]),
        ]),
      ]),

      // CENTER — day stamp
      h('div', { className: 'qf-topbar-center' }, [
        h('div', {
          className: 'pix qf-phase-eyebrow',
          ref: el => { this._refs.phaseEyebrow = el },
        }, 'NIGHTFALL · BUILD'),
        h('div', {
          className: 'pix qf-day-number',
          ref: el => { this._refs.dayNumber = el },
        }, 'DAY 1'),
      ]),

      // RIGHT — treasury
      h('div', { className: 'qf-topbar-right' }, [
        h('div', { className: 'qf-treasury-label' }, [
          h('span', { className: 'diamond sm gold' }),
          ' TREASURY',
        ]),
        h('div', {
          className: 'qf-treasury-amount',
          ref: el => { this._refs.treasury = el },
        }, [
          h('div', {
            className: 'qf-coin',
            ref: el => { this._refs.coin = el },
          }),
          h('span', {
            className: 'pix qf-gold-number',
            ref: el => { this._refs.gold = el },
          }, '0'),
        ]),
      ]),
    ])

    this._renderHearts(0)
    this._renderBossSprite()
    this._renderBuffSlots()
    return root
  }

  _emptyBuffSlot() {
    return h('div', { className: 'qf-buff-slot' }, [
      h('span', { className: 'pix qf-buff-empty' }, '+'),
    ])
  }

  // Resolve a mechanic ID against the dungeonMechanics.json cache and
  // return a normalized object the slot/tooltip can read.
  _resolveMechanic(id) {
    if (!id) return null
    let defs = null
    const scenes = window.__game?.scene?.scenes || []
    for (const s of scenes) {
      const v = s.cache?.json?.get?.('dungeonMechanics')
      if (Array.isArray(v)) { defs = v; break }
    }
    const def = defs?.find(d => d.id === id)
    if (!def) return { id, name: id, rarity: 'common' }
    const rarity = String(def.rarity || 'common').toLowerCase()
    return {
      id: def.id,
      name: (def.name || def.id).toUpperCase(),
      rarity: rarity.toUpperCase(),
      color: this._rarityColor(rarity),
      glyph: this._glyphForRarity(rarity),
      boon:  def.description ?? null,
      bane:  def.tradeoffDescription ?? null,
      flavorText: def.flavorText ?? null,
    }
  }

  _rarityColor(rarity) {
    switch (rarity) {
      case 'legendary': return 'var(--blood)'
      case 'epic':      return 'var(--info)'
      case 'rare':      return 'var(--gold)'
      case 'uncommon':  return 'var(--poison)'
      default:          return 'var(--text-mute)'
    }
  }

  _glyphForRarity(rarity) {
    switch (rarity) {
      case 'legendary': return '▣'
      case 'epic':      return '◈'
      case 'rare':      return '◆'
      case 'uncommon':  return '✦'
      default:          return '◐'
    }
  }

  _renderBuffSlots() {
    const slotsEl = this._refs.buffSlots
    if (!slotsEl) return
    const all = this._gameState.activeMechanics ?? []
    const VISIBLE = 4
    // The 4 most-recently-sealed pacts get slots; any older ones fold
    // into a "+N" overflow chip the player can hover to read.
    const shown     = all.slice(-VISIBLE)
    const hiddenIds = all.slice(0, Math.max(0, all.length - VISIBLE))
    const slots = []
    for (let i = 0; i < VISIBLE; i++) {
      const id = shown[i]
      const m = id ? this._resolveMechanic(id) : null
      if (!m) {
        slots.push(this._emptyBuffSlot())
        continue
      }
      const isLegendary = m.rarity === 'LEGENDARY'
      const slot = h('div', {
        className: 'qf-buff-slot qf-buff-slot-filled',
        dataset: { rarity: m.rarity.toLowerCase() },
        style: {
          borderColor: m.color,
          boxShadow: `inset 0 0 0 1px var(--bg-0), inset 1px 1px 0 rgba(255,255,255,0.04), 0 0 8px ${m.color}33`,
        },
        on: {
          mouseenter: (e) => this._onBuffEnter(m, e.currentTarget),
          mouseleave: () => this._onBuffLeave(),
        },
      }, [
        h('span', {
          className: 'pix qf-buff-glyph',
          style: { color: m.color, textShadow: `0 0 6px ${m.color}` },
        }, m.glyph),
        isLegendary && h('span', { className: 'qf-buff-legendary-pip blink' }),
      ])
      slots.push(slot)
    }
    if (hiddenIds.length > 0) slots.push(this._buffOverflowChip(hiddenIds))
    slotsEl.replaceChildren(...slots)
  }

  // "+N" overflow chip for pacts beyond the 4 visible slots. Hovering it
  // drops a list of those extra pacts (pure-CSS :hover reveal).
  _buffOverflowChip(hiddenIds) {
    const rows = hiddenIds
      .map(id => this._resolveMechanic(id))
      .filter(Boolean)
      .map(m => h('div', { className: 'qf-buff-overflow-row' }, [
        h('span', {
          className: 'pix qf-buff-overflow-glyph',
          style: { color: m.color || 'var(--text-mute)' },
        }, m.glyph || '◐'),
        h('span', { className: 'qf-buff-overflow-name' }, m.name),
      ]))
    return h('div', { className: 'qf-buff-slot qf-buff-overflow' }, [
      h('span', { className: 'pix qf-buff-overflow-num' }, `+${hiddenIds.length}`),
      h('div', { className: 'qf-buff-overflow-tip' }, [
        h('div', { className: 'pix qf-buff-overflow-tip-title' }, 'ALSO ACTIVE'),
        ...rows,
      ]),
    ])
  }

  _onBuffEnter(mechanic, anchorEl) {
    const r = anchorEl.getBoundingClientRect()
    // Position below the slot, horizontally centered. PactDetailPopup
    // anchors at (x, y) with translate(-100%, -50%) — i.e. the tooltip's
    // right edge lands at x and its vertical center at y. For a slot that
    // sits in the upper-left of the screen, we want the tooltip to drop
    // BELOW the slot instead — emit a payload with the right anchor.
    EventBus.emit('SHOW_PACT_DETAIL', {
      pact: mechanic,
      x: r.left + r.width / 2,
      y: r.bottom + 8,
      anchor: 'below',
    })
  }

  _onBuffLeave() {
    EventBus.emit('HIDE_PACT_DETAIL')
  }

  _renderHearts(lives) {
    const heartsEl = this._refs.hearts
    if (!heartsEl) return
    // Pull MAX from the boss's run-long counter so death-causing
    // pacts / events that shift the cap (or future archetypes with
    // a different life total) render the right number of slots.
    // Falls back to 3 — the Balance.BOSS_DEFEATS_TO_GAME_OVER
    // default — when state hasn't initialised yet.
    const MAX = this._gameState?.boss?.totalLivesEverHad ?? 3
    heartsEl.replaceChildren()
    for (let i = 1; i <= MAX; i++) {
      heartsEl.appendChild(h('span', {
        className: i <= lives ? 'heart' : 'heart empty',
      }))
    }
  }

  // Use the same 22×22 bestiary portrait Phaser loads — image lives at
  // assets/ui/bestiary/portraits/{id}_p.png. bestiary IDs drop any
  // leading `the_` prefix (gameState may use `the_lich`, asset is `lich`).
  _renderBossSprite() {
    if (!this._refs.bossSprite) return
    const rawId = this._gameState.player?.bossArchetypeId || ''
    const id = String(rawId).replace(/^the_/, '')
    this._refs.bossSprite.dataset.archetype = id
    // Set background-image instead of an inner <img> so we keep CSS sizing.
    // image-rendering: pixelated is inherited from the .qf-boss-sprite rule.
    if (!id) return
    // Probe via Image so a 404 (e.g. lich has no portrait file) leaves the
    // underlying gradient placeholder visible instead of stamping a broken
    // image icon onto the panel.
    const probe = new Image()
    probe.onload = () => {
      this._refs.bossSprite.style.backgroundImage = `url('${probe.src}')`
      this._refs.bossSprite.style.backgroundSize = 'contain'
      this._refs.bossSprite.style.backgroundRepeat = 'no-repeat'
      this._refs.bossSprite.style.backgroundPosition = 'center'
    }
    probe.src = `assets/ui/bestiary/portraits/${id}_p.png`
  }

  _wireEvents() {
    const sub = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    // Replay the day-stamp slam-in animation on phase change.
    const triggerStamp = () => {
      const el = this._refs.dayNumber
      if (!el) return
      el.classList.remove('day-stamp')
      // Force reflow so the animation re-fires.
      void el.offsetWidth
      el.classList.add('day-stamp')
    }
    sub('DAY_PHASE_BEGAN',   triggerStamp)
    sub('NIGHT_PHASE_BEGAN', triggerStamp)
    sub('BOSS_LEVELED_UP',   () => {
      const el = this._refs.bossLevel
      if (!el) return
      el.classList.remove('pop')
      void el.offsetWidth
      el.classList.add('pop')
    })
    // Re-render buff slots when a new pact seals or one drops off.
    sub('PACT_SEALED',     () => this._renderBuffSlots())
    sub('PACT_DEACTIVATED', () => this._renderBuffSlots())
  }

  // Pull values from gameState; write DOM only on change. Runs ~60 Hz.
  _tick() {
    const gs = this._gameState
    if (!gs) {
      this._tickHandle = requestAnimationFrame(() => this._tick())
      return
    }

    const phase = gs.meta?.phase ?? 'night'
    const day   = gs.meta?.dayNumber ?? 1
    const hp    = gs.boss?.hp ?? 0
    const maxHp = gs.boss?.maxHp ?? 100
    const xp    = gs.boss?.xp ?? 0
    const xpMax = gs.boss?.xpToNext ?? 100
    const level = gs.boss?.level ?? 1
    const lives = gs.boss?.deathsRemaining ?? 3
    const gold  = gs.player?.gold ?? 0

    if (day !== this._prev.day || phase !== this._prev.phase) {
      // Stamp reads "NIGHT N" during the build phase and "DAY N" during
      // the invasion phase — was previously hard-coded to "DAY" both
      // ways, which read as wrong during the long night-build stretch.
      const label = phase === 'night' ? 'NIGHT' : 'DAY'
      this._refs.dayNumber.textContent = `${label} ${day}`
      this._refs.dayNumber.classList.toggle('phase-night', phase === 'night')
      this._refs.dayNumber.classList.toggle('phase-day',   phase === 'day')
      this._refs.phaseEyebrow.textContent =
        phase === 'night' ? 'NIGHTFALL · BUILD' : 'DAWN · INVASION'
      this._prev.day   = day
      this._prev.phase = phase
    }

    if (hp !== this._prev.hp || maxHp !== this._prev.maxHp) {
      const pct = maxHp > 0 ? (hp / maxHp) * 100 : 0
      const low = pct < 30
      this._refs.hpFill.style.width  = `${pct}%`
      this._refs.hpGhost.style.width = `${pct}%`
      this._refs.hpFill.style.background = low ? 'var(--hp-low)' : 'var(--hp)'
      this._refs.hpBar.classList.toggle('heartbeat', low)
      this._refs.hpNum.textContent   = `${hp} / ${maxHp}`
      this._prev.hp    = hp
      this._prev.maxHp = maxHp
    }

    if (xp !== this._prev.xp || xpMax !== this._prev.xpMax) {
      const pct = xpMax > 0 ? Math.min(100, (xp / xpMax) * 100) : 0
      this._refs.xpFill.style.width = `${pct}%`
      this._refs.xpNum.textContent  = `${xp} / ${xpMax} XP`
      this._prev.xp    = xp
      this._prev.xpMax = xpMax
    }

    if (level !== this._prev.level) {
      this._refs.bossLevel.textContent = `LV ${level}`
      this._prev.level = level
    }
    // Boss name may not be resolvable on the first tick — the Phaser cache
    // populates async during Preload. Retry until we find a match.
    if (!this._nameResolved) this._updateBossName()

    if (lives !== this._prev.lives) {
      this._renderHearts(lives)
      this._prev.lives = lives
    }

    if (gold !== this._prev.gold) {
      const from = this._prev.gold ?? gold
      this._prev.gold = gold
      if (this._tweenCancel) this._tweenCancel()
      this._tweenCancel = tween(from, gold, 600, v => {
        this._refs.gold.textContent = String(v)
      })
      // Wealth tier — escalate the coin icon + glow as the hoard grows.
      this._applyWealthTier(gold)
      // Gain feedback — coin spin, brightness flash, floating +Ng, sparkle.
      if (gold > from) {
        const coin = this._refs.coin
        coin.classList.remove('spin')
        void coin.offsetWidth
        coin.classList.add('spin')
        const num = this._refs.gold
        num.classList.add('gold-pulse')
        setTimeout(() => num.classList.remove('gold-pulse'), 700)
        this._spawnGoldGain(gold - from)
        this._spawnCoinSparkle()
      }
    }

    this._tickHandle = requestAnimationFrame(() => this._tick())
  }

  // ── Treasury juice ──────────────────────────────────────────────────────

  // Escalate the coin icon (single coin → pile → bag) and its glow as the
  // gold total climbs, so being rich visibly reads as rich.
  _applyWealthTier(gold) {
    const tier = gold >= 200 ? 3 : gold >= 26 ? 2 : 1
    if (tier === this._wealthTier) return
    this._wealthTier = tier
    const t = this._refs.treasury
    if (!t) return
    t.classList.remove('wealth-1', 'wealth-2', 'wealth-3')
    t.classList.add(`wealth-${tier}`)
  }

  // Floating "+Ng" that rises off the counter when gold is earned.
  _spawnGoldGain(delta) {
    const host = this._refs.treasury
    if (!host || delta <= 0) return
    const f = document.createElement('div')
    f.className = 'qf-gold-gain'
    f.textContent = `+${delta}`
    host.appendChild(f)
    f.addEventListener('animationend', () => f.remove())
  }

  // Small radial burst of gold sparks from the coin on a gain.
  _spawnCoinSparkle() {
    const host = this._refs.treasury
    if (!host) return
    const N = 5
    for (let i = 0; i < N; i++) {
      const s = document.createElement('div')
      s.className = 'qf-coin-spark'
      const ang  = (i / N) * Math.PI * 2 + Math.random() * 0.7
      const dist = 16 + Math.random() * 16
      s.style.setProperty('--dx', `${Math.round(Math.cos(ang) * dist)}px`)
      s.style.setProperty('--dy', `${Math.round(Math.sin(ang) * dist)}px`)
      host.appendChild(s)
      s.addEventListener('animationend', () => s.remove())
    }
  }

  // Look up the archetype's display name from the Phaser scene cache, if a
  // scene is registered. Falls back to the archetype id, then a hard
  // 'BOSS' default. The cache only populates after Preload runs.
  _updateBossName() {
    const rawId = this._gameState.player?.bossArchetypeId
    if (!rawId) return
    const id = String(rawId).replace(/^the_/, '')
    let name = null
    try {
      const game = window.__game
      const scenes = game?.scene?.scenes || []
      for (const s of scenes) {
        const archs = s.cache?.json?.get?.('bossArchetypes')
        if (Array.isArray(archs) && archs.length) {
          const arch = archs.find(a => a.id === id || a.id === rawId)
          if (arch?.name) { name = arch.name; break }
        }
      }
    } catch {}
    const fallback = id.replace(/_/g, ' ')
    this._refs.bossName.textContent = (name || fallback).toUpperCase()
    if (name) this._nameResolved = true
  }

  destroy() {
    if (this._tickHandle) cancelAnimationFrame(this._tickHandle)
    if (this._tweenCancel) this._tweenCancel()
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    this.el?.remove()
  }
}

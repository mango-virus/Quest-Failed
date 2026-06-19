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
import { ascensionInfo } from '../config/acts.js'
import { SfxVolume } from '../systems/SfxVolume.js'
import { isReducedMotion } from './motion.js'

// Per-archetype fallback emblem for the hero portrait button, shown whenever the
// bestiary portrait PNG is missing / fails to load (a future archetype with no
// art, an id→file mismatch, an offline asset) so the button is never a bare
// gradient. Keyed by the `the_`-stripped archetype id; '☠' is the generic default.
const BOSS_GLYPHS = {
  beholder: '👁', demon: '😈', myconid: '🍄', wraith: '👻',
  gnoll: '🐺', golem: '🗿', lich: '💀', lizardman: '🐍',
  orc: '🪓', vampire: '🦇', succubus: '💋', slime: '🟢',
}

// Coin-tick SFX pacing — the treasury "ka-ching" as flying coins land. The pitch
// rises with each consecutive tick (a streak) and resets after a gap.
const COIN_TICK_THROTTLE_MS = 30    // ignore ticks closer together than this (burst overlap)
const COIN_TICK_RESET_MS    = 240   // gap after which the rising-pitch streak resets
const COIN_TICK_RATE_BASE   = 1.0   // playback rate (pitch) at streak 0
const COIN_TICK_RATE_MAX    = 1.9   // pitch ceiling
const COIN_TICK_RATE_STEP   = 0.045 // pitch gain per consecutive tick

export class TopBar {
  constructor(gameState) {
    this._gameState = gameState
    this._listeners = []
    this._tweenCancel = null
    // Treasury count-up state. `_displayGold` is the number actually shown; it
    // lags `gameState.gold` and is driven UP by flying coins (creditGold) for
    // positional payouts, or eased by the reconcile in _tick for everything
    // else. `_coinsIncoming` = gold currently promised by in-flight coins (held
    // back from the auto-count so it isn't double-counted).
    this._displayGold   = null
    this._prevGold      = null
    this._coinsIncoming = 0
    this._lastCreditAt  = 0
    this._lastCoinTickAt = 0
    this._coinTickStreak = 0
    // Wave-progress bar state — driven by DAY_WAVE_INFO + the kill/flee events.
    this._wave = { total: 0, killed: 0, escaped: 0, label: '', mode: 'none' }

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
            // LV reads in the box's upper-right (space-between in the headrow).
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
              // 6px (+ tighter spacing) so "n / n XP" fits the thin 8px
              // XP bar without the glyph tops/bottoms clipping.
              style: { fontSize: '6px', letterSpacing: '0.5px' },
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

      // CENTER — day stamp with the act folded in (KR P4): "ACT II — NIGHT 1"
      // where the accent-coloured ACT prefix is set on act events, and hovering
      // it reveals the response name + threat (qf-day-act-pop). The prefix span
      // stays empty when acts are off / between acts.
      h('div', { className: 'qf-topbar-center' }, [
        h('div', {
          className: 'pix qf-day-number',
          ref: el => { this._refs.dayNumber = el },
        }, [
          h('span', { className: 'qf-day-act',   ref: el => { this._refs.dayAct = el } }),
          h('span', { className: 'qf-day-phase', ref: el => { this._refs.dayPhase = el } }, 'DAY 1'),
          h('div',  { className: 'qf-day-act-pop', ref: el => { this._refs.dayActPop = el } }),
        ]),
        // WAVE PROGRESS — total threats today, filled green (killed) +
        // orange (escaped). Shown only during the day phase (see _renderWaveBar).
        h('div', {
          className: 'qf-wave',
          ref: el => { this._refs.wave = el },
          style: { display: 'none' },
        }, [
          h('div', { className: 'qf-wave-track' }, [
            h('div', { className: 'qf-wave-killed',  ref: el => { this._refs.waveKilled  = el } }),
            h('div', { className: 'qf-wave-escaped', ref: el => { this._refs.waveEscaped = el } }),
          ]),
          h('div', { className: 'pix qf-wave-readout', ref: el => { this._refs.waveReadout = el } }),
        ]),
      ]),

      // RIGHT — treasury
      h('div', { className: 'qf-topbar-right' }, [
        h('div', { className: 'qf-treasury-label' }, [
          h('span', { className: 'diamond sm white' }),
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
      // The pact's own thematic emoji (dungeonMechanics.json `symbol`);
      // falls back to a per-rarity glyph only if a pact has no symbol.
      glyph: def.symbol || this._glyphForRarity(rarity),
      boon:  def.description ?? null,
      bane:  def.tradeoffDescription ?? null,
      flavorText: def.flavorText ?? null,
    }
  }

  _rarityColor(rarity) {
    switch (rarity) {
      case 'damned':    return '#3a2b30'   // black grimoire (near-black, blood sheen) — epic owns purple
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

  // `opts.animateNewest` (set only from the PACT_SEALED path) plays a one-shot
  // slide/pop + rarity glow + "NEW" flag on the just-sealed slot so a freshly
  // forged pact gets a beat of celebration in the chrome — not just appear.
  _renderBuffSlots(opts = {}) {
    const slotsEl = this._refs.buffSlots
    if (!slotsEl) return
    const all = this._gameState.activeMechanics ?? []
    const VISIBLE = 4
    // The 4 most-recently-sealed pacts get slots; any older ones fold
    // into a "+N" overflow chip the player can hover to read.
    const shown     = all.slice(-VISIBLE)
    const hiddenIds = all.slice(0, Math.max(0, all.length - VISIBLE))
    const newestIdx = shown.length - 1   // the just-sealed pact is last in `shown`
    const slots = []
    let newestSlot = null, newestColor = null
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
      if (i === newestIdx) { newestSlot = slot; newestColor = m.color }
      slots.push(slot)
    }
    if (hiddenIds.length > 0) slots.push(this._buffOverflowChip(hiddenIds))
    slotsEl.replaceChildren(...slots)
    if (opts.animateNewest && newestSlot) this._playBuffSealFx(newestSlot, newestColor)
    this._applyBuffSuppress()   // re-apply the Inquisition "sealed" dim after a re-render
  }

  // One-shot entrance feedback on a freshly-sealed buff slot. The "NEW" flag
  // self-fades via CSS (and any next re-render clears it); the pop/glow are
  // motion and so are gated on the reduced-motion preference.
  _playBuffSealFx(slot, color) {
    slot.style.setProperty('--nc', color || '#fff')
    if (!isReducedMotion()) slot.classList.add('qf-buff-slot-new')
    slot.appendChild(h('span', { className: 'pix qf-buff-new-tag' }, 'NEW'))
  }

  // Toggle the Inquisition "sealed" dim on the buff slots from `_inqSuppress`.
  _applyBuffSuppress() {
    const sealed = !!this._gameState?._mechanicFlags?._inqSuppress
    this._refs.buffSlots?.classList.toggle('qf-buffs-sealed', sealed)
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
    const el = this._refs.bossSprite
    if (!el) return
    const rawId = this._gameState.player?.bossArchetypeId || ''
    const id = String(rawId).replace(/^the_/, '')
    el.dataset.archetype = id
    // Always paint a per-archetype emblem first, so the portrait is never a bare
    // gradient while the art loads (or if it never does). The probe below swaps
    // it for the real portrait on success and leaves it in place on a 404.
    el.classList.add('qf-boss-sprite-glyph')
    el.textContent = BOSS_GLYPHS[id] || '☠'
    el.style.backgroundImage = ''
    if (!id) return
    // Set background-image instead of an inner <img> so we keep CSS sizing.
    // image-rendering: pixelated is inherited from the .qf-boss-sprite rule.
    const probe = new Image()
    probe.onload = () => {
      el.textContent = ''
      el.classList.remove('qf-boss-sprite-glyph')
      el.style.backgroundImage = `url('${probe.src}')`
      el.style.backgroundSize = 'contain'
      el.style.backgroundRepeat = 'no-repeat'
      el.style.backgroundPosition = 'center'
    }
    probe.src = `assets/ui/bestiary/portraits/${id}_p.png`
  }

  _wireEvents() {
    const sub = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    // Treasury coin-fly count-up: CoinFly streams these as coins fly to the
    // counter. INCOMING holds that gold back from the auto-count; each ARRIVED
    // bumps the shown total + plays a coin tick — so the number ka-chings up in
    // lockstep with the coins landing.
    sub('TREASURY_COINS_INCOMING', ({ amount } = {}) => this._onCoinBurstStart(amount))
    sub('TREASURY_COIN_ARRIVED',   ({ amount } = {}) => this.creditGold(amount))
    // Snap the display to the real total on phase change (no lagging coins
    // straddling a night→day boundary, where the player might spend).
    sub('DAY_PHASE_BEGAN',   () => this._snapGold())
    sub('NIGHT_PHASE_BEGAN', () => this._snapGold())
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
    sub('PACT_SEALED',     () => this._renderBuffSlots({ animateNewest: true }))
    sub('PACT_DEACTIVATED', () => this._renderBuffSlots())

    // Act / Kingdom-Response eyebrow (KR P4). ACT_STARTED paints the fixed
    // bookend acts (I, IV); KINGDOM_RESPONSE_DRAWN fills the drafted response.
    // Both re-fire at run start / on continue, so the eyebrow is always current.
    sub('ACT_STARTED',            p => this._onActStarted(p))
    sub('KINGDOM_RESPONSE_DRAWN', p => this._onActResponse(p))
    // Inquisition pact-suppression — dim the buff slots so the player can SEE
    // their active pacts have gone inert (the log/boss-overview explain why).
    sub('INQUISITION_SUPPRESS_CHANGED', () => this._applyBuffSuppress())

    // ── Wave-progress bar ──────────────────────────────────────────
    // DayPhase publishes the day's threat count + label at day start;
    // each kill / escape tallies into the bar.
    sub('DAY_WAVE_INFO', (info) => {
      this._wave = { total: info?.total ?? 0, killed: 0, escaped: 0,
                     label: info?.label ?? '', mode: info?.mode ?? 'none' }
      this._renderWaveBar()
    })
    sub('ADVENTURER_DIED', () => {
      if (this._wave.mode === 'none') return
      this._wave.killed++
      this._renderWaveBar()
    })
    sub('ADVENTURER_FLED', () => {
      if (this._wave.mode === 'none') return
      this._wave.escaped++
      this._renderWaveBar()
    })
    // Hide the bar outside the day phase (build night has no wave).
    const hideWave = () => { this._wave.mode = 'none'; this._renderWaveBar() }
    sub('NIGHT_PHASE_STARTED', hideWave)
    sub('DAY_PHASE_ENDED',     hideWave)
  }

  // ── Act / Kingdom-Response eyebrow (KR P4) ──────────────────────────────────
  static _ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI']

  // Fixed bookend acts (I, IV) paint from ACT_STARTED; drafted acts (II/III) are
  // filled by the KINGDOM_RESPONSE_DRAWN that fires right after, so skip them here.
  _onActStarted({ act, def } = {}) {
    if (def?.kind === 'drafted') return
    this._paintAct({ act, accent: '#d4a648', name: def?.name ?? `Act ${act}`, detail: def?.tagline ?? '' })
  }

  _onActResponse({ act, response } = {}) {
    if (!response) return
    this._paintAct({
      act, accent: response.accent || '#d4a648',
      name: response.name || 'The Kingdom Responds', detail: response.threat || '',
      effect: response.gimmick || '',
    })
  }

  // Fold the act into the day stamp: "ACT {N} — NIGHT 1", the accent-coloured
  // ACT prefix carrying the response identity. Hover reveals the response name,
  // threat, and the act's mechanical effect ("THIS ACT: …") in qf-day-act-pop.
  // The phase part is updated by the tick.
  _paintAct({ act, accent, name, detail, effect } = {}) {
    const acc = accent || 'var(--gold)'
    // The boss's per-act ascension (form + cumulative HP/ATK surge) shows in the
    // hover popover + the boss-overview form badge — kept off the stamp itself so
    // the eyebrow stays clean.
    const asc = ascensionInfo(this._gameState)
    // The "ACT N —" prefix was dropped from the phase stamp per the design — the
    // stamp reads just "NIGHT N" / "DAY N". The act identity still lives in the
    // hover popover below + the boss-overview form badge.
    if (this._refs.dayAct) this._refs.dayAct.textContent = ''
    if (this._refs.dayActPop) {
      this._refs.dayActPop.replaceChildren(
        h('div', { className: 'qf-day-act-pop-name', style: { color: acc } }, name || 'The Kingdom'),
        detail ? h('div', { className: 'qf-day-act-pop-detail' }, detail) : null,
        effect ? h('div', { className: 'qf-day-act-pop-effect' }, [
          h('span', { className: 'qf-day-act-pop-effect-ico' }, '⚠'),
          h('b', {}, ' THIS ACT: '),
          effect,
        ]) : null,
        asc ? h('div', { className: 'qf-day-act-pop-asc' }, [
          h('span', { className: 'qf-day-act-pop-asc-icon' }, '✦'),
          asc.ascended
            ? `${asc.form} Form · +${asc.hpBonusPct}% HP · +${asc.atkBonusPct}% ATK`
            : `${asc.form} Form · ascends each act`,
        ]) : null,
      )
    }
    this._refs.dayNumber?.style.setProperty('--act-accent', acc)
    this._refs.dayNumber?.classList.add('has-act')
  }

  // Render the wave-progress bar from `this._wave`. Green = killed, orange =
  // escaped, dim remainder = still in the dungeon / yet to arrive. Hidden when
  // mode 'none'; numbers-only (no fill) for endless waves (mode 'count').
  _renderWaveBar() {
    const w = this._wave
    const box = this._refs.wave
    if (!box) return
    if (w.mode === 'none') { box.style.display = 'none'; return }
    box.style.display = ''

    const { killed: k, escaped: e, total: t, mode } = w
    if (mode === 'bar' && t > 0) {
      // Clamp so the two fills never exceed the track.
      const killPct = Math.min(100, (k / t) * 100)
      const escPct  = Math.min(100 - killPct, (e / t) * 100)
      if (this._refs.waveKilled)  this._refs.waveKilled.style.width  = `${killPct}%`
      if (this._refs.waveEscaped) this._refs.waveEscaped.style.width = `${escPct}%`
    } else {
      // Endless / unknown total — no fill target.
      if (this._refs.waveKilled)  this._refs.waveKilled.style.width  = '0%'
      if (this._refs.waveEscaped) this._refs.waveEscaped.style.width = '0%'
    }

    const ro = this._refs.waveReadout
    if (ro) {
      const parts = []
      if (w.label && w.label !== 'ADVENTURERS') parts.push(`${w.label}  `)
      parts.push(`<span class="k">☠ ${k}</span>  <span class="e">↗ ${e}</span>`)
      if (mode === 'bar' && t > 0) parts.push(`  <span class="t">/ ${t}</span>`)
      ro.innerHTML = parts.join('')
    }
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
    const hp    = Math.round(gs.boss?.hp ?? 0)
    const maxHp = Math.round(gs.boss?.maxHp ?? 100)
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
      if (this._refs.dayPhase) this._refs.dayPhase.textContent = `${label} ${day}`
      this._refs.dayNumber.classList.toggle('phase-night', phase === 'night')
      this._refs.dayNumber.classList.toggle('phase-day',   phase === 'day')
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

    // ── Treasury count-up ──────────────────────────────────────────────────
    // Positional payouts (kills/drops) are delivered by flying coins (CoinFly →
    // creditGold), which drive `_displayGold` up as each lands. Only the
    // un-coined remainder (passives, bribes) and spends are eased here.
    if (this._displayGold == null) { this._displayGold = gold; this._prevGold = gold; this._renderGold() }
    const goldChanged = gold !== this._prevGold
    if (gold < this._displayGold - 0.5) {
      // Spend / any drop — coins are moot; ease the digits down.
      this._coinsIncoming = 0
      if (this._tweenCancel) { this._tweenCancel(); this._tweenCancel = null }
      if (goldChanged) this._onGoldSpendVisual(gold - this._prevGold)
      this._displayGold += (gold - this._displayGold) * 0.30
      if (this._displayGold < gold + 0.5) this._displayGold = gold
      this._renderGold()
    } else if (this._coinsIncoming <= 0 && this._displayGold < gold - 0.5) {
      // Un-coined gain (passive/bribe) or leftover after coins — ease the digits up.
      if (goldChanged) this._onGoldGainVisual(gold - this._prevGold)
      this._displayGold += Math.max(0.5, (gold - this._displayGold) * 0.16)
      if (this._displayGold > gold) this._displayGold = gold
      this._renderGold()
    }
    // Safety net: if coins were promised but stopped arriving (CoinFly absent /
    // a lost animation), release the hold so the counter can't stick low.
    if (this._coinsIncoming > 0 && performance.now() - this._lastCreditAt > 1500) this._coinsIncoming = 0
    this._applyWealthTier(gold)
    this._prevGold = gold

    this._tickHandle = requestAnimationFrame(() => this._tick())
  }

  // ── Treasury juice ──────────────────────────────────────────────────────

  // Render the (rounded) currently-shown total.
  _renderGold() {
    if (this._refs?.gold) this._refs.gold.textContent = String(Math.round(this._displayGold ?? 0))
  }

  // A coin-fly burst started — hold its gold back from the auto-count (coins
  // will deliver it via creditGold) and fire the burst's gain flourish once.
  _onCoinBurstStart(amount) {
    if (!(amount > 0)) return
    this._coinsIncoming += amount
    this._onGoldGainVisual(amount)
  }

  // One flying coin landed: bump the shown total by its share, tick the coin
  // sound, and give the counter a small tactile bump.
  creditGold(n) {
    if (!(n > 0)) return
    const gold = this._gameState?.player?.gold ?? this._displayGold ?? 0
    this._coinsIncoming = Math.max(0, this._coinsIncoming - n)
    this._displayGold = Math.min(gold, (this._displayGold ?? gold) + n)
    this._lastCreditAt = performance.now()
    this._renderGold()
    this._playCoinTick()
    const amt = this._refs.treasury
    if (amt) { amt.classList.remove('bump'); void amt.offsetWidth; amt.classList.add('bump') }
  }

  // Snap the shown total to the real total (phase change) — clears any lagging
  // coins so the counter is exact when the player can act (night build/spend).
  _snapGold() {
    const gold = this._gameState?.player?.gold ?? 0
    if (this._tweenCancel) { this._tweenCancel(); this._tweenCancel = null }
    this._coinsIncoming = 0
    this._displayGold = gold
    this._prevGold = gold
    this._renderGold()
  }

  // The collect-gold tick, throttled + pitch-ramped so a cascade rises in pitch
  // (a satisfying brr-ring) rather than machine-gunning the wav.
  _playCoinTick() {
    if (SfxVolume.isMuted?.()) return
    const g = window.__game
    if (!g?.sound) return
    if (!(g.scene?.scenes ?? []).some(s => s.cache?.audio?.exists?.('sfx-collect-gold'))) return
    const now = performance.now()
    if (now - this._lastCoinTickAt < COIN_TICK_THROTTLE_MS) return       // throttle overlapping bursts
    if (now - this._lastCoinTickAt > COIN_TICK_RESET_MS) this._coinTickStreak = 0   // reset pitch after a gap
    this._lastCoinTickAt = now
    const rate = Math.min(COIN_TICK_RATE_MAX, COIN_TICK_RATE_BASE + this._coinTickStreak * COIN_TICK_RATE_STEP)
    this._coinTickStreak++
    try { g.sound.play('sfx-collect-gold', { rate, volume: Math.min(3, 1.5 * (SfxVolume.getVolume?.() ?? 1)) }) } catch (e) {}
  }

  // Gain flourish — coin spin, digit pulse, floating "+Ng", sparkle.
  _onGoldGainVisual(delta) {
    const coin = this._refs.coin
    if (coin) { coin.classList.remove('spin'); void coin.offsetWidth; coin.classList.add('spin') }
    const num = this._refs.gold
    if (num) { num.classList.add('gold-pulse'); setTimeout(() => num.classList.remove('gold-pulse'), 700) }
    this._spawnGoldGain(delta)
    this._spawnCoinSparkle()
  }

  // Spend flourish — red "−Ng" floater + a brief red tint on the digits.
  _onGoldSpendVisual(delta) {
    this._spawnGoldGain(delta)
    const num = this._refs.gold
    if (num) { num.classList.add('qf-gold-spend'); setTimeout(() => num.classList.remove('qf-gold-spend'), 440) }
  }

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

  // Floating "+Ng" / "−Ng" that rises off the counter when gold changes.
  // Positive delta = gold (gain); negative = blood-red (spend).
  _spawnGoldGain(delta) {
    const host = this._refs.treasury
    if (!host || delta === 0) return
    const spend = delta < 0
    const f = document.createElement('div')
    f.className = `qf-gold-gain${spend ? ' spend' : ''}`
    f.textContent = `${spend ? '−' : '+'}${Math.abs(delta)}`
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

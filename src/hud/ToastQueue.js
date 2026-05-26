// ToastQueue — DOM port of the design's top-right ephemeral notifications.
//
// Listens to a handful of gameplay events and surfaces them as toasts.
// Up to 4 stacked; each persists ~3.4s with a 360ms slide-in / 280ms
// slide-out animation owned by `.toast` keyframes in styles.css.
//
// Event → toast mapping (matches the 7 kinds in the design's README):
//   BOSS_LEVELED_UP             → level
//   PACT_SEALED                 → pact
//   ADVENTURER_DIED             → kill
//   ROOM_DAMAGED / ROOM_DESTROYED → damage
//   INTEL_LEAKED                → leak (rare event; design calls this out)
//   GOLD_LOOTED                 → gold (no canonical event in code yet —
//                                  reads from PACT or stays inert)
//
// Toasts are pure status output: pointer-events: none so they never eat
// clicks on the DOM HUD.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { HudSfx } from './HudSfx.js'

const MAX_TOASTS = 4
const TOAST_TTL  = 6500
const FADE_OUT   = 280

const KIND_STYLE = {
  level:  { color: 'var(--gold)',      glyph: '★' },
  pact:   { color: 'var(--info)',      glyph: '▣' },
  kill:   { color: 'var(--blood)',     glyph: '☠' },
  damage: { color: 'var(--warn)',      glyph: '⚠' },
  leak:   { color: 'var(--warn)',      glyph: '◈' },
  gold:   { color: 'var(--gold)',      glyph: '◐' },
  bounty: { color: 'var(--gold)',      glyph: '★' },
  info:   { color: 'var(--text-mute)', glyph: '◇' },
  // Achievement unlock — bright-gold trophy chip. Same color family as
  // level / bounty (celebratory) but distinct glyph so the player can
  // pick it out of a busy run-end toast wash.
  achievement: { color: 'var(--gold-bright, #ffd964)', glyph: '🏆' },
  // Legendary achievement unlock — same trophy but bigger, brighter,
  // longer-dwell, with a "RARE TROPHY" eyebrow above the title and a
  // gold particle burst on arrival. Triggered when `def.legendary` is
  // true on the unlocked achievement (currently 6 hand-picked endgame
  // achievements in `src/data/achievements.json`).
  legendary_achievement: { color: 'var(--gold-bright, #ffd964)', glyph: '🏆' },
}

// Bounty toasts get a longer dwell — they're the parchment-poster replacement
// and carry 3 lines of info (header / type · kills · gear / italic flavor)
// so they need more reading time than a one-line kill/damage chip.
const BOUNTY_TTL = 9000
// Legendary achievement toasts dwell even longer so the player has
// time to register that something big happened.
const LEGENDARY_TTL = 10000

export class ToastQueue {
  constructor() {
    this._listeners = []
    this._toasts = []  // [{ el, timer }]

    this.el = h('div', { className: 'qf-toasts' })
    this._wireEvents()
  }

  _push(kind, title, subtitle, opts = {}) {
    const meta = KIND_STYLE[kind] || KIND_STYLE.info
    const flavor = opts.flavor || null
    const eyebrow = opts.eyebrow || null
    const isLegendary = kind === 'legendary_achievement'
    // Build the toast root. Legendary toasts get an extra wrapper class
    // for the gold-burst frame + the optional eyebrow line ("RARE
    // TROPHY") above the title.
    const t = h('div', {
      className: `toast qf-toast${flavor ? ' qf-toast-bounty' : ''}${isLegendary ? ' qf-toast-legendary' : ''}`,
      style: { borderLeftColor: meta.color, boxShadow: `inset 4px 0 0 ${meta.color}, 0 8px 24px rgba(0,0,0,0.5), 0 0 18px ${meta.color}33` },
    }, [
      h('div', { className: 'qf-toast-row' }, [
        h('span', {
          className: 'pix qf-toast-glyph',
          style: { color: meta.color, textShadow: `0 0 6px ${meta.color}` },
        }, meta.glyph),
        h('div', { className: 'qf-toast-titlecol' }, [
          eyebrow && h('div', {
            className: 'pix qf-toast-eyebrow',
            style: { color: meta.color },
          }, eyebrow),
          h('div', {
            className: 'pix qf-toast-title',
            style: { color: meta.color },
          }, title),
          subtitle && h('div', { className: 'qf-toast-subtitle' }, subtitle),
          flavor   && h('div', { className: 'qf-toast-flavor' }, flavor),
        ]),
      ]),
    ])
    const entry = { el: t, kind }
    this._toasts.push(entry)
    this.el.appendChild(t)
    // Trim to MAX_TOASTS — eldest first
    while (this._toasts.length > MAX_TOASTS) {
      const old = this._toasts.shift()
      old.el.remove()
      clearTimeout(old._dismiss)
    }
    const ttl = kind === 'bounty'                 ? BOUNTY_TTL
              : kind === 'legendary_achievement'  ? LEGENDARY_TTL
              : TOAST_TTL
    entry._dismiss = setTimeout(() => this._dismiss(entry), ttl)
    // Soft "arrives" chip — HudSfx rate-limits so a burst doesn't stack.
    HudSfx.playUi('toast')
    // Legendary unlocks get a gold particle burst fountaining out from
    // the toast's spawn point on the right edge of the screen. Pure
    // DOM effect — no Phaser dependencies. Brief (~1s), then self-
    // cleans. See `_spawnLegendaryBurst` below.
    if (isLegendary) {
      this._spawnLegendaryBurst(t)
    }
  }

  // Spawn a ring of gold particles bursting outward from the toast's
  // position. Each particle is a small absolutely-positioned div that
  // animates via CSS keyframes from center → fountain trajectory, then
  // fades. Auto-cleanup via `animationend`. Count + spread tuned to
  // feel celebratory without overwhelming the page.
  _spawnLegendaryBurst(toastEl) {
    if (!toastEl || !toastEl.parentNode) return
    const PARTICLE_COUNT = 22
    const burst = h('div', { className: 'qf-toast-legendary-burst' })
    // Anchor the burst to the toast's parent so its position tracks
    // the toast stack naturally as the player scrolls / resizes.
    toastEl.appendChild(burst)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Fountain leftward (toward the game area). The toast sits on
      // the right edge of the HUD, so particles flying right would
      // clip off-screen — bias angles to [120°, 240°] (a 120° arc
      // opening to the LEFT) for a clean fan-out into the play area.
      const baseAngle = 120 + Math.random() * 120
      const distance  = 70 + Math.random() * 90
      const dx = Math.cos(baseAngle * Math.PI / 180) * distance
      const dy = Math.sin(baseAngle * Math.PI / 180) * distance
      // Slight per-particle randomization for an organic burst.
      const delay = Math.random() * 80
      const dur   = 700 + Math.random() * 400
      const size  = 4 + Math.random() * 4
      const p = h('span', {
        className: 'qf-toast-legendary-particle',
        style: {
          width: `${size}px`,
          height: `${size}px`,
          '--dx': `${dx}px`,
          '--dy': `${dy}px`,
          animationDelay: `${delay}ms`,
          animationDuration: `${dur}ms`,
        },
      })
      burst.appendChild(p)
    }
    // Tear down the burst after the longest particle finishes.
    setTimeout(() => burst.remove(), 1300)
  }

  _dismiss(entry) {
    if (!entry?.el || entry._dismissing) return
    entry._dismissing = true
    entry.el.classList.add('leaving')
    setTimeout(() => {
      entry.el.remove()
      const i = this._toasts.indexOf(entry)
      if (i >= 0) this._toasts.splice(i, 1)
    }, FADE_OUT)
  }

  _wireEvents() {
    const sub = (event, fn) => {
      EventBus.on(event, fn)
      this._listeners.push([event, fn])
    }
    sub('BOSS_LEVELED_UP', ({ toLevel } = {}) => {
      this._push('level', 'BOSS LEVELED UP',
        toLevel ? `Now level ${toLevel}.` : 'You grow stronger.')
    })
    sub('PACT_SEALED', ({ mechanicId, rarity } = {}) => {
      const tag = rarity ? rarity.toUpperCase() : 'PACT'
      this._push('pact', `${tag} PACT SEALED`, mechanicId || '')
    })
    sub('ADVENTURER_DIED', ({ adventurer, killerName } = {}) => {
      const n = adventurer?.name || 'Adventurer'
      this._push('kill', 'KILL', killerName ? `${n} fell to ${killerName}.` : `${n} fell.`)
    })
    sub('ROOM_DAMAGED', ({ roomName } = {}) => {
      this._push('damage', 'ROOM DAMAGED', roomName || 'Structural integrity falling.')
    })
    sub('ROOM_DESTROYED', ({ roomName } = {}) => {
      this._push('damage', 'ROOM DESTROYED', roomName || 'A chamber has fallen.')
    })
    sub('INTEL_LEAKED', ({ roomName } = {}) => {
      this._push('leak', 'INTEL LEAKED', roomName || 'They learned more than you wanted.')
    })
    // VETERAN APPROACHING — fires when an adventurer who's previously
    // escaped re-enters the dungeon. RunHistorySystem stamps
    // `escapeCount` on the matching `adventurers.known` entry on flee.
    sub('ADVENTURER_ENTERED_DUNGEON', ({ adventurer } = {}) => {
      if (!adventurer) return
      const escapeCount = adventurer.escapeCount
        ?? adventurer.knownEscapeCount
        ?? (adventurer.isVeteran ? 1 : 0)
      if (escapeCount > 0) {
        this._push('damage', 'HERO APPROACHING',
          `${adventurer.name || 'A returning adventurer'} is back for more.`)
      }
    })
    // GOLD LOOTED — the canonical "they stole your treasure" event is
    // EventSystem's loot-goblin heist escape.
    sub('LOOT_GOBLIN_ESCAPED', ({ stolen, adventurer } = {}) => {
      const amt = stolen ?? '?'
      this._push('gold', 'GOLD LOOTED',
        `${amt}g stolen by ${adventurer?.name || 'a goblin'}.`)
    })
    // TREASURE PAYOUT — sum of every placed treasure chest's
    // tier.goldPerDay, awarded at NIGHT_PHASE_STARTED by AISystem.
    // Without this toast the gold trickle is invisible.
    //
    // Dedupe per-day so a leaked old-run AISystem (the Game.shutdown
    // bug documented in memory:project_quest_failed_open_followups.md)
    // can't pop two toasts at once. The leaked instance's gold goes to
    // an orphaned gameState that nothing reads; we just suppress its
    // duplicate toast on the bubble side.
    sub('TREASURE_PAYOUT', ({ gold } = {}) => {
      const amt = gold ?? 0
      if (amt <= 0) return
      const day = window.__game?.scene?.getScene?.('Game')?.gameState?.meta?.dayNumber ?? -1
      if (this._lastTreasurePayoutDay === day) return
      this._lastTreasurePayoutDay = day
      this._push('gold', 'TREASURE PAID',
        `+${amt}g from your chests.`)
    })
    // Generic SHOW_TOAST channel — lets in-canvas Phaser surfaces
    // (BossArchetypeUI "EARTHQUAKE armed" toasts, NightPhase placement
    // errors, etc.) route through the DOM ToastQueue under the new HUD
    // so they stop rendering behind the DOM TopBar.
    // Payload: { message, type?, duration? }
    //   type: 'info' (default) | 'error' | 'success'
    sub('SHOW_TOAST', ({ message, type } = {}) => {
      if (!message) return
      const kind = type === 'error'   ? 'damage'
                 : type === 'success' ? 'level'
                 : 'info'
      this._push(kind, message, null)
    })
    // BOUNTY POSTED — replaces the parchment WantedPoster surface.
    // The richer toast carries the type/kills/gear meta + an italic
    // flavor line ("Hunters approach. Reinforce the wing.") that the
    // original poster had.
    sub('MINION_BOUNTY_POSTED', ({ minion } = {}) => {
      if (!minion) return
      const typeName = this._minionTypeName(minion) || minion.definitionId
      const name     = minion.name || typeName || 'A minion'
      const kills    = minion.bountyKillCount ?? 0
      const gear     = minion.equippedGear?.length ?? 0
      this._push(
        'bounty',
        `★ WANTED · ${name.toUpperCase()} ★`,
        `${typeName}  ·  ${kills} kill${kills === 1 ? '' : 's'}  ·  ${gear} gear`,
        { flavor: 'Hunters approach. Reinforce the wing.' },
      )
    })
    // ACHIEVEMENT UNLOCKED — golden trophy chip with name + flavor line.
    // Fired by AchievementSystem when a metric threshold is crossed.
    // Reward callouts (e.g. "Unlocks: Golem") land in the flavor slot
    // when the achievement has a reward attached.
    //
    // Legendary tier (data-driven via `def.legendary === true`) routes
    // to a richer toast: "RARE TROPHY" eyebrow, gold-burst frame, 10s
    // dwell, and a gold particle burst fountaining outward from the
    // toast. Common unlocks use the basic golden trophy chip.
    sub('ACHIEVEMENT_UNLOCKED', ({ def } = {}) => {
      if (!def) return
      let flavor = null
      if (def.reward?.type === 'boss') {
        flavor = `Unlocks boss: ${def.reward.id.toUpperCase()}`
      } else if (def.reward?.type === 'companion') {
        flavor = `Unlocks companion: ${def.reward.id.toUpperCase()}`
      } else if (def.title) {
        flavor = `Title earned: ${def.title}`
      }
      const isLegendary = !!def.legendary
      this._push(
        isLegendary ? 'legendary_achievement' : 'achievement',
        isLegendary ? 'LEGENDARY UNLOCKED' : 'ACHIEVEMENT UNLOCKED',
        def.name,
        {
          flavor: flavor || undefined,
          eyebrow: isLegendary ? '✦  RARE TROPHY  ✦' : null,
        },
      )
    })
  }

  // Resolve a minion definitionId to its display name. Reads from any
  // active Phaser scene's cache (json: 'minionTypes') — same data the
  // Phaser WantedPoster used. Tolerant of missing cache.
  _minionTypeName(minion) {
    const scenes = window.__game?.scene?.scenes ?? []
    for (const s of scenes) {
      const types = s.cache?.json?.get?.('minionTypes')
      if (Array.isArray(types)) {
        const def = types.find(d => d.id === minion.definitionId)
        if (def?.name) return def.name
      }
    }
    return null
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    for (const t of this._toasts) { t.el.remove(); clearTimeout(t._dismiss) }
    this._toasts = []
    this.el?.remove()
  }
}

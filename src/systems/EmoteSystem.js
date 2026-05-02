// Adventurer emote bubbles — small 3-frame speech-bubble sprites that pop
// above an adventurer's head when something noteworthy happens.
//
// Sprites: 96×32 PNGs in assets/sprites/emotes/, three 32×32 frames each.
// Filenames map to trigger IDs. Multiple variants per trigger are picked
// at random.
//
// Each event has a 20% roll to actually pop an emote — most events stay
// silent so the dungeon doesn't become visual noise. Per-adventurer
// cooldown of 1500ms prevents stacking. Higher-priority triggers (fight /
// flee / low_hp / boss room) replace any active emote; the ambient
// random_exploring trigger never overrides a state-driven one.
//
// Sprite is parented to the adventurer's container (created by
// AdventurerRenderer), so it inherits position, alpha (spawn/leave fade),
// and is destroyed automatically when the adv is cleaned up.

import { EventBus } from './EventBus.js'

// ── Catalog ───────────────────────────────────────────────────────────────
// Variant strings are filenames without the .png extension.
// (Keep in sync with files in assets/sprites/emotes/.)

const RANDOM_EXPLORING_VARIANTS = (() => {
  const out = ['random exploring']
  for (let i = 2; i <= 23; i++) {
    if (i === 8) continue // random exploring8.png missing in source pack
    out.push(`random exploring${i}`)
  }
  return out
})()

export const EMOTE_CATALOG = {
  random_exploring: RANDOM_EXPLORING_VARIANTS,
  discovered_room: [
    'discovered a new room',
    'discovered new room',
    'entered unknown room',
    'entered unknown room2',
    'entered unknown room3',
    'entered unknown room4',
  ],
  known_room: [
    'walked into known room',
    'walked into known room2',
    'walked into known room3',
    'walked into known room4',
    'walked into known room5',
  ],
  boss_room: ['entered boss room'],
  fighting_generic: [
    'fighting minion or boss',
    'fighting minion or boss2',
    'fighting minion or boss3',
    'found minion',
    'found minion2',
  ],
  fleeing: ['fleeing', 'fleeing2', 'fleeing3'],
  low_health: ['low health', 'low health2'],
  found_loot: ['found loot3', 'found loot4', 'found loot5', 'found loot6', 'found loot7'],
  found_something: ['found something'],
  resurrected: ['ressurected'],
  tame_success: ['beast master successful tame'],
}

// Per-class fighting variants — mixed into the fighting pool when class matches.
export const CLASS_FIGHTING_VARIANTS = {
  barbarian: ['barbarian attacking'],
  mage:      ['mage attacking', 'mage attacking2'],
  monk:      ['monk attacking'],
  cleric:    ['cleric healing'],
  ranger:    ['ranger or bard attacking'],
  bard:      ['ranger or bard attacking'],
}

// All variants flattened — used by Preload to iterate the load list.
export function allEmoteVariants() {
  const set = new Set()
  for (const arr of Object.values(EMOTE_CATALOG)) for (const v of arr) set.add(v)
  for (const arr of Object.values(CLASS_FIGHTING_VARIANTS)) for (const v of arr) set.add(v)
  return [...set]
}

// Convert a variant filename to its texture / animation key.
export function emoteKey(variant) {
  return `emote-${variant.replace(/\s+/g, '_')}`
}

// ── Tunables ──────────────────────────────────────────────────────────────

const TRIGGER_CHANCE         = 0.20    // 20% per event
const ANIM_FRAME_RATE        = 4       // 3 frames @ 4fps = 750ms per loop
const ANIM_REPEATS           = 2       // 0 = play once; 2 = play 3 times total (~2.25s)
const COOLDOWN_MS            = 2500    // per-adventurer; covers full anim duration + a beat
const RANDOM_INTERVAL_MIN_MS = 6000
const RANDOM_INTERVAL_MAX_MS = 10000
const BUBBLE_OFFSET_Y        = -42     // just above head (HP bar is at -38, top of LPC sprite ~-41)
const LOW_HP_FRAC            = 0.30

// Lower number = higher priority. random_exploring won't replace anything
// state-driven; state triggers replace lower or equal priority.
const PRIORITY = {
  random_exploring: 100,
  known_room:        50,
  discovered_room:   50,
  found_something:   50,
  found_loot:        40,
  tame_success:      40,
  resurrected:       40,
  low_health:        20,
  fighting:          20,
  fleeing:           15,
  boss_room:         10,
}

// ── System ────────────────────────────────────────────────────────────────

export class EmoteSystem {
  constructor(scene, gameState, adventurerRenderer) {
    this._scene     = scene
    this._gameState = gameState
    this._renderer  = adventurerRenderer
    // adventurerInstanceId → { sprite, triggerId, priority, expiresAt }
    this._active = {}
    // adventurerInstanceId → { lastAiState, lastLowHp, nextRandomAt, cooldownUntil }
    this._advState = {}

    EventBus.on('ROOM_OBSERVED',                this._onRoomObserved,    this)
    EventBus.on('BOSS_FIGHT_INCOMING',          this._onBossRoom,        this)
    EventBus.on('TRAP_TRIGGERED',               this._onTrapTriggered,   this)
    EventBus.on('ADVENTURER_RESURRECTED',       this._onResurrected,     this)
    EventBus.on('MINION_TAMED',                 this._onMinionTamed,     this)
    EventBus.on('ADVENTURER_DIED',              this._onAdvRemoved,      this)
    EventBus.on('ADVENTURER_FLED',              this._onAdvRemoved,      this)
    EventBus.on('NIGHT_PHASE_STARTED',          this._clearAll,          this)
  }

  destroy() {
    EventBus.off('ROOM_OBSERVED',                this._onRoomObserved,    this)
    EventBus.off('BOSS_FIGHT_INCOMING',          this._onBossRoom,        this)
    EventBus.off('TRAP_TRIGGERED',               this._onTrapTriggered,   this)
    EventBus.off('ADVENTURER_RESURRECTED',       this._onResurrected,     this)
    EventBus.off('MINION_TAMED',                 this._onMinionTamed,     this)
    EventBus.off('ADVENTURER_DIED',              this._onAdvRemoved,      this)
    EventBus.off('ADVENTURER_FLED',              this._onAdvRemoved,      this)
    EventBus.off('NIGHT_PHASE_STARTED',          this._clearAll,          this)
    this._clearAll()
  }

  // Per-frame poll for state-transition triggers + ambient random emotes.
  update() {
    const now = this._scene.time.now
    for (const adv of this._gameState.adventurers?.active ?? []) {
      const s = this._ensureAdvState(adv)

      // Fighting transition — fires once when aiState flips into 'fighting'.
      if (adv.aiState === 'fighting' && s.lastAiState !== 'fighting') {
        this._tryTrigger(adv, 'fighting', this._fightingPool(adv))
      }
      // Fleeing transition — both aiState and goal type can flag a flee.
      const isFleeing = adv.aiState === 'fleeing' || adv.goal?.type === 'FLEE'
      if (isFleeing && !s.wasFleeing) {
        this._tryTrigger(adv, 'fleeing', EMOTE_CATALOG.fleeing)
      }
      s.wasFleeing    = isFleeing
      s.lastAiState   = adv.aiState

      // Low-HP edge trigger — fire only on the crossing.
      const maxHp = adv.resources?.maxHp ?? 1
      const frac  = (adv.resources?.hp ?? 0) / Math.max(1, maxHp)
      const nowLow = frac > 0 && frac < LOW_HP_FRAC
      if (nowLow && !s.lastLowHp) {
        this._tryTrigger(adv, 'low_health', EMOTE_CATALOG.low_health)
      }
      s.lastLowHp = nowLow

      // Ambient random_exploring — only while plain walking.
      if (adv.aiState === 'walking' && !isFleeing) {
        if (s.nextRandomAt == null) s.nextRandomAt = now + this._randomIntervalMs()
        if (now >= s.nextRandomAt) {
          this._tryTrigger(adv, 'random_exploring', EMOTE_CATALOG.random_exploring)
          s.nextRandomAt = now + this._randomIntervalMs()
        }
      } else {
        // Reset the timer so the next walking stretch starts fresh.
        s.nextRandomAt = null
      }
    }

    // Tick active emote sprites — destroy any that have completed.
    for (const id of Object.keys(this._active)) {
      const e = this._active[id]
      if (!e?.sprite || !e.sprite.scene) { delete this._active[id]; continue }
      if (now >= e.expiresAt) {
        e.sprite.destroy()
        delete this._active[id]
      }
    }
  }

  // ── Event handlers ─────────────────────────────────────────────────────

  _onRoomObserved({ adventurer, firstVisit }) {
    if (!adventurer) return
    if (firstVisit) {
      this._tryTrigger(adventurer, 'discovered_room', EMOTE_CATALOG.discovered_room)
    } else {
      this._tryTrigger(adventurer, 'known_room', EMOTE_CATALOG.known_room)
    }
  }

  _onBossRoom({ adventurer }) {
    if (!adventurer) return
    this._tryTrigger(adventurer, 'boss_room', EMOTE_CATALOG.boss_room)
  }

  _onTrapTriggered({ adventurer }) {
    if (!adventurer) return
    this._tryTrigger(adventurer, 'found_something', EMOTE_CATALOG.found_something)
  }

  _onResurrected({ adventurer }) {
    if (!adventurer) return
    this._tryTrigger(adventurer, 'resurrected', EMOTE_CATALOG.resurrected)
  }

  _onMinionTamed({ tamer }) {
    if (!tamer) return
    this._tryTrigger(tamer, 'tame_success', EMOTE_CATALOG.tame_success)
  }

  _onAdvRemoved({ adventurer }) {
    if (!adventurer?.instanceId) return
    const e = this._active[adventurer.instanceId]
    if (e?.sprite?.scene) e.sprite.destroy()
    delete this._active[adventurer.instanceId]
    delete this._advState[adventurer.instanceId]
  }

  _clearAll() {
    for (const id of Object.keys(this._active)) {
      const e = this._active[id]
      if (e?.sprite?.scene) e.sprite.destroy()
    }
    this._active = {}
    this._advState = {}
  }

  // ── Internals ─────────────────────────────────────────────────────────

  _ensureAdvState(adv) {
    let s = this._advState[adv.instanceId]
    if (!s) {
      s = {
        lastAiState:   adv.aiState,
        wasFleeing:    adv.aiState === 'fleeing' || adv.goal?.type === 'FLEE',
        lastLowHp:     false,
        nextRandomAt:  null,
        cooldownUntil: 0,
      }
      this._advState[adv.instanceId] = s
    }
    return s
  }

  _randomIntervalMs() {
    return RANDOM_INTERVAL_MIN_MS +
      Math.random() * (RANDOM_INTERVAL_MAX_MS - RANDOM_INTERVAL_MIN_MS)
  }

  // Build the fighting variant pool — universal pool plus class-specific
  // additions when this adventurer's class has a matching attack emote.
  _fightingPool(adv) {
    const extras = CLASS_FIGHTING_VARIANTS[adv.classId] ?? []
    return [...EMOTE_CATALOG.fighting_generic, ...extras]
  }

  // Roll, check cooldown / priority, and play.
  _tryTrigger(adv, triggerId, pool) {
    if (!adv?.instanceId || !pool || pool.length === 0) return
    if (Math.random() >= TRIGGER_CHANCE) return

    const now = this._scene.time.now
    const s = this._ensureAdvState(adv)
    if (now < s.cooldownUntil) return

    const prio = PRIORITY[triggerId] ?? 100
    const existing = this._active[adv.instanceId]
    if (existing && existing.priority <= prio) return // existing wins

    const variant = pool[Math.floor(Math.random() * pool.length)]
    this._playEmote(adv, triggerId, variant, prio)
    s.cooldownUntil = now + COOLDOWN_MS
  }

  _playEmote(adv, triggerId, variant, priority) {
    const advSprite = this._renderer?._sprites?.[adv.instanceId]
    if (!advSprite?.container) return

    const animKey = emoteKey(variant)
    if (!this._scene.anims.exists(animKey)) return

    // Replace any active emote on this adv.
    const prev = this._active[adv.instanceId]
    if (prev?.sprite?.scene) prev.sprite.destroy()

    const sprite = this._scene.add.sprite(0, BUBBLE_OFFSET_Y, animKey, 0)
    sprite.setOrigin(0.5, 1)
    advSprite.container.add(sprite)
    sprite.anims.play(animKey, true)

    // Anim plays (1 + ANIM_REPEATS) times then ends. We track an expiry as
    // a safety net so a stuck sprite is reclaimed even if anim 'complete'
    // misfires.
    const durationMs = (1000 / ANIM_FRAME_RATE) * 3 * (1 + ANIM_REPEATS) + 50
    sprite.once('animationcomplete', () => {
      if (sprite.scene) sprite.destroy()
      const cur = this._active[adv.instanceId]
      if (cur?.sprite === sprite) delete this._active[adv.instanceId]
    })

    this._active[adv.instanceId] = {
      sprite,
      triggerId,
      priority,
      expiresAt: this._scene.time.now + durationMs + 250,
    }
  }
}

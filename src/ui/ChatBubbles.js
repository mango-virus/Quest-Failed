// Occasional chat bubbles above adventurers.
// Pulls a random class, personality, or fourth-wall line every N seconds (timer path).
// Also fires contextual lines immediately on EventBus events: traps, rooms, combat
// transitions, low HP, ally death, fleeing, boss room.

import { EventBus } from '../systems/EventBus.js'
import { createBubble } from './Bubble.js'

// Ambient chatter cadence. The base interval is what each adv targets;
// _scheduleNextChat() lengthens it on big waves so total bubbles/sec
// stays bounded regardless of how many advs are alive (see
// AMBIENT_TARGET_RATE_HZ below). Bumped from 7-15s → 12-24s on
// 2026-05-25; per-adv scaling layered on 2026-05-26.
const MIN_INTERVAL_MS      = 12000
const MAX_INTERVAL_MS      = 24000
const BUBBLE_LIFE_MS       = 2200
const CONTEXTUAL_LIFE_MS   = 3000
const CONTEXTUAL_COOLDOWN  = 3000
const FOURTH_WALL_CHANCE   = 0.08   // 8% of ambient chatter is 4th-wall

// Target rate of ambient bubbles per second across the whole wave.
// At 80 advs and 1.5 Hz target, each adv chats every ~53s — visually
// the chatter density on screen stays roughly constant whether the
// wave is 5 or 80 strong. Contextual events (trap fired, ally died,
// etc.) bypass this; only the timer-based ambient is scaled.
const AMBIENT_TARGET_RATE_HZ = 1.5

// Hard cap on concurrently-rendered bubbles. Past this, new bubble
// creation drops silently — the bubbles are pure flavour, no
// gameplay depends on seeing every line. Contextual events still
// fire FIRST so the priority moments aren't the ones dropped.
const MAX_CONCURRENT_BUBBLES = 12

// Off-camera bubble cull — bubbles whose owner is outside the
// camera viewport (plus margin) skip their per-frame position
// update. Matches the cull margin / pattern used in MinionRenderer.
const BUBBLE_CULL_MARGIN_PX = 200

export class ChatBubbles {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._bubbles   = {}      // advId → { container, expiresAt }
    this._nextChatAt        = {}  // advId → ms timestamp
    this._lastContextualAt  = {}  // advId → ms timestamp (contextual cooldown)
    this._lastAiState       = {}  // advId → previous aiState (for transition detection)
    this._lowHpNotified     = {}  // advId → bool (rate-limit low-HP lines)
    this._lines = null

    EventBus.on('TRAP_TRIGGERED',       this._onTrapTriggered,     this)
    EventBus.on('ROOM_OBSERVED',        this._onRoomObserved,      this)
    EventBus.on('BOSS_FIGHT_INCOMING',  this._onBossFightIncoming, this)
    EventBus.on('ADVENTURER_DIED',      this._onAdventurerDied,    this)
    EventBus.on('ADVENTURER_FLED',      this._onAdventurerFled,    this)
    EventBus.on('NIGHT_PHASE_STARTED',  this._onNightStarted,      this)
    // Adventurer-goal reaction lines. Each event carries `{ adventurer }`
    // and pulls one random line from the matching `byEvent.<key>` pool.
    for (const key of [
      'investigateNoiseHeard', 'regroupAtParty', 'avoidTrap',
      'lootCorpseStart', 'lootCorpseDone', 'rescueAlly',
      'gloatOverKill', 'warnParty', 'scoutAhead',
      'pickedKey', 'unlockedDoor', 'lockpicked', 'brokeDoor', 'seekKey',
      'seekHeal', 'healed',
      'seekTreasure', 'stoleTreasure', 'escapingWithLoot',
    ]) {
      const handler = ({ adventurer }) => {
        if (adventurer) this._showContextualBubble(adventurer, this._pickEventLine(key))
      }
      this._goalHandlers ??= {}
      this._goalHandlers[key] = handler
      EventBus.on(`SAY_${key}`, handler)
    }
  }

  destroy() {
    EventBus.off('TRAP_TRIGGERED',       this._onTrapTriggered,     this)
    EventBus.off('ROOM_OBSERVED',        this._onRoomObserved,      this)
    EventBus.off('BOSS_FIGHT_INCOMING',  this._onBossFightIncoming, this)
    EventBus.off('ADVENTURER_DIED',      this._onAdventurerDied,    this)
    EventBus.off('ADVENTURER_FLED',      this._onAdventurerFled,    this)
    EventBus.off('NIGHT_PHASE_STARTED',  this._onNightStarted,      this)
    for (const [key, handler] of Object.entries(this._goalHandlers ?? {})) {
      EventBus.off(`SAY_${key}`, handler)
    }
    this._goalHandlers = {}
    for (const id of Object.keys(this._bubbles)) this._destroyBubble(id)
  }

  // Called every Game.update() during day phase.
  update() {
    if (!this._lines) this._lines = this._scene.cache.json.get('chatLines') ?? {}
    const now = this._scene.time.now

    for (const adv of this._gameState.adventurers.active) {
      const prevState = this._lastAiState[adv.instanceId]
      const curState  = adv.aiState
      this._lastAiState[adv.instanceId] = curState

      // Detect combat transitions
      if (prevState && prevState !== curState) {
        if (curState === 'fighting') {
          this._showContextualBubble(adv, this._pickEventLine('combatStart'))
        } else if (prevState === 'fighting' && (curState === 'walking' || curState === 'idle')) {
          this._showContextualBubble(adv, this._pickEventLine('combatWon'))
        }
      }

      // Low HP threshold
      const maxHp = adv.resources?.maxHp ?? 1
      const hp    = adv.resources?.hp    ?? maxHp
      if (hp / maxHp < 0.3 && !this._lowHpNotified[adv.instanceId]) {
        this._lowHpNotified[adv.instanceId] = true
        this._showContextualBubble(adv, this._pickEventLine('lowHp'))
      } else if (hp / maxHp >= 0.5) {
        this._lowHpNotified[adv.instanceId] = false
      }

      // Timer-based ambient chatter (walking only, no active bubble)
      if (adv.aiState !== 'walking') continue
      if (this._bubbles[adv.instanceId]) continue

      const next = this._nextChatAt[adv.instanceId]
      if (next == null) {
        this._scheduleNextChat(adv.instanceId, now)
        continue
      }
      if (now < next) continue

      this._showBubbleFor(adv)
      this._scheduleNextChat(adv.instanceId, now)
    }

    // Position update + expiration. Each bubble carries its owning
    // `adv` reference directly (set in _createBubble), so per-frame
    // lookup is O(1) instead of an Array.find() per bubble — that
    // .find() was the dominant cost in late-game waves (10 bubbles
    // x 80 advs = 800 scans/frame, ~50k ops/sec at 60fps).
    //
    // Off-camera cull skips the setPosition() call when the adv is
    // off-screen. The container's stale position is fine; it'll be
    // refreshed the moment the camera pans it back into view.
    const cam = this._scene.cameras?.main
    const camLeft   = cam ? (cam.worldView.x - BUBBLE_CULL_MARGIN_PX) : -Infinity
    const camRight  = cam ? (cam.worldView.x + cam.worldView.width  + BUBBLE_CULL_MARGIN_PX) : Infinity
    const camTop    = cam ? (cam.worldView.y - BUBBLE_CULL_MARGIN_PX) : -Infinity
    const camBottom = cam ? (cam.worldView.y + cam.worldView.height + BUBBLE_CULL_MARGIN_PX) : Infinity

    for (const id of Object.keys(this._bubbles)) {
      const b = this._bubbles[id]
      if (now >= b.expiresAt) {
        this._destroyBubble(id)
        continue
      }
      const adv = b.adv
      // Defensive — if the adv reference was lost (re-creation race,
      // graveyard cleanup), drop the bubble.
      if (!adv || adv.aiState === 'dead') { this._destroyBubble(id); continue }
      const wx = adv.worldX, wy = adv.worldY
      if (wx < camLeft || wx > camRight || wy < camTop || wy > camBottom) continue
      b.container.setPosition(wx, wy - 30)
    }
  }

  // ── EventBus handlers ────────────────────────────────────────────────────

  _onTrapTriggered({ adventurer }) {
    if (!adventurer) return
    this._showContextualBubble(adventurer, this._pickEventLine('trapTriggered'))
  }

  _onRoomObserved({ adventurer, firstVisit }) {
    if (!adventurer) return
    if (!firstVisit && Math.random() > 0.25) return   // only react ~25% for revisits
    const key = firstVisit ? 'firstRoom' : 'knownRoom'
    this._showContextualBubble(adventurer, this._pickEventLine(key))
  }

  _onBossFightIncoming({ adventurer }) {
    if (!adventurer) return
    this._showContextualBubble(adventurer, this._pickEventLine('bossRoom'))
  }

  _onAdventurerDied({ adventurer }) {
    // Show an allyDied reaction on a random nearby living adventurer
    const survivors = (this._gameState.adventurers?.active ?? []).filter(
      a => a.instanceId !== adventurer?.instanceId && a.aiState !== 'dead'
    )
    if (!survivors.length) return
    const reactor = survivors[Math.floor(Math.random() * survivors.length)]
    this._showContextualBubble(reactor, this._pickEventLine('allyDied'))
  }

  _onAdventurerFled({ adventurer }) {
    if (!adventurer) return
    this._showContextualBubble(adventurer, this._pickEventLine('fleeing'))
  }

  _onNightStarted() {
    for (const id of Object.keys(this._bubbles)) this._destroyBubble(id)
    this._nextChatAt       = {}
    this._lastContextualAt = {}
    this._lastAiState      = {}
    this._lowHpNotified    = {}
  }

  // ── Bubble creation ──────────────────────────────────────────────────────

  _scheduleNextChat(advId, now) {
    // Per-adv interval scales UP with the active adv count so the
    // total ambient bubble rate stays roughly AMBIENT_TARGET_RATE_HZ
    // regardless of wave size. With 5 advs the base 12-24s window
    // applies (well under the target rate — fine). With 80 advs each
    // adv is pushed to ~53s avg so the wave collectively still emits
    // ~1.5 ambient bubbles/sec, not 4-5/sec.
    const base = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS)
    const advCount = Math.max(1, (this._gameState.adventurers?.active ?? []).length)
    // Required per-adv interval to hit the wave-wide target rate.
    const targetPerAdvMs = (advCount / AMBIENT_TARGET_RATE_HZ) * 1000
    const dur = Math.max(base, targetPerAdvMs)
    this._nextChatAt[advId] = now + dur
  }

  _showBubbleFor(adv) {
    const line = this._pickLine(adv)
    if (!line) return
    this._createBubble(adv, line, BUBBLE_LIFE_MS)
  }

  // Shows a contextual bubble, bypassing the walking-only restriction.
  // Per-adventurer cooldown prevents rapid stacking.
  _showContextualBubble(adv, line) {
    if (!adv || !line || adv.aiState === 'dead') return
    const now  = this._scene.time.now
    const last = this._lastContextualAt[adv.instanceId] ?? 0
    if (now - last < CONTEXTUAL_COOLDOWN) return
    this._lastContextualAt[adv.instanceId] = now
    this._destroyBubble(adv.instanceId)
    this._createBubble(adv, line, CONTEXTUAL_LIFE_MS)
  }

  _createBubble(adv, line, lifeMs) {
    // Event-spawned monsters (zombie horde, rival-dungeon invaders) are
    // not chatty adventurers — they never show speech bubbles.
    if (!adv || adv._monster) return
    // Concurrent-cap safety net. Pure flavour — silently drop new
    // bubbles past the cap so a pathological "everyone bubbles at
    // once" frame can't spike DOM/Phaser allocation. Contextual
    // events (which take CONTEXTUAL_LIFE_MS, longer than ambient)
    // tend to win the existing slots since they fire on a per-adv
    // priority cooldown; ambient drops first when at cap.
    const currentCount = Object.keys(this._bubbles).length
    if (currentCount >= MAX_CONCURRENT_BUBBLES && !this._bubbles[adv.instanceId]) return

    // Build via the shared BubbleFactory — pixel-art square bubble
    // with downward tail, wrapped Press Start 2P text (140 px max,
    // capped at 3 lines), scale-pop entrance. Container origin is
    // the tail tip; we anchor it at (worldX, worldY - 30) so the
    // tail points at the adv's head — same offset the old single-
    // line render used.
    const c = createBubble(this._scene, {
      x:     adv.worldX,
      y:     adv.worldY - 30,
      text:  line,
      kind:  'chat',
      depth: 11,
      // No auto-lifeMs — this module manages its own expiry timer
      // via expiresAt + the per-frame update() sweep below.
    })

    this._bubbles[adv.instanceId] = {
      container: c,
      // Stash the adv reference here so update()'s per-frame loop
      // does O(1) lookup instead of Array.find() over active advs.
      adv,
      expiresAt: this._scene.time.now + lifeMs,
    }

    const room = this._gameState.dungeon?.rooms?.find(r =>
      adv.tileX >= r.gridX && adv.tileX < r.gridX + r.width &&
      adv.tileY >= r.gridY && adv.tileY < r.gridY + r.height
    )
    EventBus.emit('CHAT_BUBBLE_EMITTED', {
      adventurer: adv,
      line,
      roomId: room?.instanceId ?? null,
    })
  }

  _destroyBubble(id) {
    const b = this._bubbles[id]
    if (!b) return
    b.container.destroy()
    delete this._bubbles[id]
  }

  // ── Line selection ────────────────────────────────────────────────────────

  _pickLine(adv) {
    const byClass       = this._lines.byClass       ?? {}
    const byPersonality = this._lines.byPersonality ?? {}
    const fourthWall    = this._lines.fourthWall    ?? []

    // Small chance for a fourth-wall line regardless of class/personality
    if (fourthWall.length && Math.random() < FOURTH_WALL_CHANCE) {
      return fourthWall[Math.floor(Math.random() * fourthWall.length)]
    }

    const personalityLines = (adv.personalityIds ?? [])
      .flatMap(p => byPersonality[p] ?? [])
    const classLines = byClass[adv.classId] ?? byClass.default ?? []

    let pool = []
    if (personalityLines.length && Math.random() < 0.6) pool = personalityLines
    else pool = classLines

    if (!pool.length) pool = classLines.length ? classLines : (byClass.default ?? ['...'])
    return pool[Math.floor(Math.random() * pool.length)]
  }

  _pickEventLine(eventKey) {
    if (!this._lines) this._lines = this._scene.cache.json.get('chatLines') ?? {}
    const pool = this._lines.byEvent?.[eventKey] ?? []
    if (!pool.length) return null
    return pool[Math.floor(Math.random() * pool.length)]
  }
}

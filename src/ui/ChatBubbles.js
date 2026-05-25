// Occasional chat bubbles above adventurers.
// Pulls a random class, personality, or fourth-wall line every N seconds (timer path).
// Also fires contextual lines immediately on EventBus events: traps, rooms, combat
// transitions, low HP, ally death, fleeing, boss room.

import { EventBus } from '../systems/EventBus.js'

// Ambient chatter cadence — bumped from 7-15s → 12-24s (and contextual
// cooldown 2s → 3s) on 2026-05-25 so late-game waves of 30+ advs don't
// blanket the screen with bubbles. Each adv still talks; just less often.
const MIN_INTERVAL_MS      = 12000
const MAX_INTERVAL_MS      = 24000
const BUBBLE_LIFE_MS       = 2200
const CONTEXTUAL_LIFE_MS   = 3000
const CONTEXTUAL_COOLDOWN  = 3000
const FOURTH_WALL_CHANCE   = 0.08   // 8% of ambient chatter is 4th-wall

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

    // Position update + expiration
    for (const id of Object.keys(this._bubbles)) {
      const b = this._bubbles[id]
      if (now >= b.expiresAt) {
        this._destroyBubble(id)
        continue
      }
      const adv = this._gameState.adventurers.active.find(a => a.instanceId === id)
      if (!adv) { this._destroyBubble(id); continue }
      b.container.setPosition(adv.worldX, adv.worldY - 30)
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
    const dur = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS)
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
    const c   = this._scene.add.container(adv.worldX, adv.worldY - 30).setDepth(11)
    const txt = this._scene.add.text(0, 0, line, {
      fontSize: '9px', color: '#e0e6f0', fontFamily: 'monospace',
      backgroundColor: '#10141c', padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1)
    c.add(txt)

    this._bubbles[adv.instanceId] = {
      container: c,
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

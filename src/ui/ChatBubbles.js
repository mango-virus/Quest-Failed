// Occasional chat bubbles above adventurers.
// Phase 6b: pulls a random class or personality line every N seconds per adventurer
// and displays a short speech bubble for ~2s above their head.
// Sparse by design — flavor, not noise.

import { EventBus } from '../systems/EventBus.js'

const MIN_INTERVAL_MS = 7000
const MAX_INTERVAL_MS = 15000
const BUBBLE_LIFE_MS  = 2200

export class ChatBubbles {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._bubbles = {}      // adventurerId → { container, expiresAt }
    this._nextChatAt = {}   // adventurerId → ms timestamp for next chat attempt
    this._lines = null      // loaded lazily
  }

  destroy() {
    for (const id of Object.keys(this._bubbles)) this._destroyBubble(id)
  }

  // Called every Game.update() during day phase.
  update() {
    if (!this._lines) this._lines = this._scene.cache.json.get('chatLines') ?? {}
    const now = this._scene.time.now

    for (const adv of this._gameState.adventurers.active) {
      // Chat eligibility: only walking, alive, no current bubble
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

  _scheduleNextChat(advId, now) {
    const dur = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS)
    this._nextChatAt[advId] = now + dur
  }

  _showBubbleFor(adv) {
    const line = this._pickLine(adv)
    if (!line) return

    const c = this._scene.add.container(adv.worldX, adv.worldY - 30).setDepth(11)
    const txt = this._scene.add.text(0, 0, line, {
      fontSize: '9px', color: '#e0e6f0', fontFamily: 'monospace',
      backgroundColor: '#10141c', padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1)
    c.add(txt)

    this._bubbles[adv.instanceId] = {
      container: c,
      expiresAt: this._scene.time.now + BUBBLE_LIFE_MS,
    }

    // Phase QW — surface chat-bubble emission so Whisper traps can react.
    const room = this._gameState.dungeon.rooms?.find(r =>
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
    // 60% chance personality line if any personality is assigned, else class line
    const byClass       = this._lines.byClass ?? {}
    const byPersonality = this._lines.byPersonality ?? {}

    const personalityLines = (adv.personalityIds ?? [])
      .flatMap(p => byPersonality[p] ?? [])
    const classLines = byClass[adv.classId] ?? byClass.default ?? []

    let pool = []
    if (personalityLines.length && Math.random() < 0.6) pool = personalityLines
    else pool = classLines

    if (pool.length === 0) pool = classLines.length ? classLines : byClass.default ?? ['...']
    return pool[Math.floor(Math.random() * pool.length)]
  }
}

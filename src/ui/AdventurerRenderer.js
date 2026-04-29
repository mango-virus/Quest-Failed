// Renders all active adventurers as world-space markers.
// Phase 4: a colored circle + sigil letter per adventurer (placeholder for sprites).
// Each frame, the marker reads the adventurer's worldX/worldY (set by AISystem) and updates.
// Click-to-inspect is wired here — emits ADVENTURER_CLICKED on EventBus.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE
const RADIUS = 11

export class AdventurerRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    // adventurerInstanceId → { container, ring, body, label, hp, hpBg, builder? }
    this._sprites = {}

    // Cached map of class def by id — used to look up builderAnimations
    // (CharacterEditor edits) when creating sprites.
    const defs = scene.cache.json.get('adventurerClasses') ?? []
    this._defMap = Object.fromEntries(defs.map(d => [d.id, d]))

    EventBus.on('ADVENTURER_DIED',     this._onRemove,   this)
    EventBus.on('ADVENTURER_FLED',     this._onRemove,   this)
    EventBus.on('NIGHT_PHASE_STARTED', this._clearAll,   this)
  }

  // Called every Game.update() frame
  update() {
    const active = this._gameState.adventurers.active
    const seen = new Set()
    const dt = this._scene.game.loop.delta

    for (const adv of active) {
      seen.add(adv.instanceId)
      let s = this._sprites[adv.instanceId]
      if (!s) s = this._createSprite(adv)
      s.container.setPosition(adv.worldX, adv.worldY)
      const hpFrac = adv.resources.maxHp > 0
        ? Math.max(0, adv.resources.hp / adv.resources.maxHp) : 0
      s.hp.width = Math.max(0, hpFrac * (RADIUS * 2))
      this._updateBubbleState(s, adv)
      this._tickBuilderAnim(s, adv, dt)
    }

    // Clean up sprites whose adventurers are no longer active
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(id)) this._destroySprite(id)
    }
  }

  // Advance the per-sprite builder animation if the class has one. Picks
  // an animation state from AI state (fighting → attack, fleeing → hurt,
  // dead → death, otherwise idle).
  _tickBuilderAnim(s, adv, dt) {
    if (!s.builder) return
    const def = this._defMap?.[adv.classId]
    if (!def?.builderAnimations) return
    const wantState = adv.aiState === 'fighting' ? 'attack'
                    : adv.aiState === 'fleeing' ? 'hurt'
                    : adv.resources?.hp <= 0 ? 'death'
                    : (adv.aiState === 'walking' || adv.goal?.type === 'EXPLORE_ROOM') ? 'walk'
                    : 'idle'
    const dirs = def.builderDirections ?? 1
    let dirKey = 'default'
    if (dirs === 2) dirKey = (adv._lastDx ?? 0) < 0 ? 'left' : 'right'
    const anim   = def.builderAnimations[wantState] ?? def.builderAnimations.idle
    const frames = anim?.frames?.[dirKey] ?? anim?.frames?.default ?? []
    if (frames.length === 0) return
    if (s.builder.state !== wantState) {
      s.builder.state = wantState
      s.builder.idx = 0
      s.builder.accum = 0
    }
    s.builder.accum += dt
    const cur = frames[s.builder.idx % frames.length]
    if (s.builder.accum >= (cur?.durationMs ?? 120)) {
      s.builder.accum = 0
      const next = anim.loop ? (s.builder.idx + 1) % frames.length
                             : Math.min(s.builder.idx + 1, frames.length - 1)
      s.builder.idx = next
      const f = frames[next]
      if (f && this._scene.textures.exists(f.key)) {
        s.builder.image.setTexture(f.key)
        s.builder.image.setFlipX(!!f.flipX)
      }
    }
  }

  // Switch the thought bubble glyph + color based on aiState / goal.
  // Walking + no special goal → primary personality icon.
  // Fighting / fleeing / searching → state-specific glyph.
  _updateBubbleState(s, adv) {
    if (!s.bubble) return
    const ps = this._scene.personalitySystem ?? this._scene.scene.get('Game')?.personalitySystem
    const primaryDef = ps?.getDefinition(adv.personalityIds?.[0])

    let glyph, color
    if (adv.aiState === 'fighting') {
      glyph = '*'; color = 0xcc4422
    } else if (adv.aiState === 'fleeing' || adv.goal?.type === 'FLEE') {
      glyph = '!'; color = 0xddcc44
    } else if (adv.aiState === 'sleeping') {
      glyph = 'z'; color = 0x4488cc
    } else if (adv.aiState === 'healing') {
      glyph = '+'; color = 0xcc88ee
    } else if (adv.goal?.type === 'EXPLORE_ROOM') {
      glyph = '?'; color = 0x44cc88
    } else if (primaryDef) {
      glyph = primaryDef.icon ?? '?'
      color = parseInt(primaryDef.iconColor ?? '0xaaaabb', 16) || 0xaaaabb
    } else {
      glyph = '?'; color = 0xaaaabb
    }

    if (s._lastBubbleGlyph !== glyph) {
      s.bubbleLabel.setText(glyph)
      s._lastBubbleGlyph = glyph
    }
    if (s._lastBubbleColor !== color) {
      s.bubble.setFillStyle(color, 0.85)
      s._lastBubbleColor = color
    }
  }

  destroy() {
    EventBus.off('ADVENTURER_DIED',     this._onRemove,   this)
    EventBus.off('ADVENTURER_FLED',     this._onRemove,   this)
    EventBus.off('NIGHT_PHASE_STARTED', this._clearAll,   this)
    this._clearAll()
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _createSprite(adv) {
    const c = this._scene.add.container(adv.worldX, adv.worldY).setDepth(8)

    // Outer ring (faction/colour glow)
    const ring = this._scene.add.circle(0, 0, RADIUS + 3, adv.classColor, 0.25)
    // Body
    const body = this._scene.add.circle(0, 0, RADIUS, 0x10141c, 1)
    body.setStrokeStyle(2, adv.classColor, 1)
    // Sigil letter
    const label = this._scene.add.text(0, 0, adv.sigil, {
      fontSize: '12px', color: '#f0f4ff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5)

    // HP bar floats above
    const hpBg = this._scene.add.rectangle(0, -RADIUS - 6, RADIUS * 2, 3, 0x220a06, 0.9)
      .setOrigin(0.5)
    const hp   = this._scene.add.rectangle(-RADIUS, -RADIUS - 6, RADIUS * 2, 3, 0x33cc77, 1)
      .setOrigin(0, 0.5)

    // Thought bubble — primary personality icon floating above the HP bar.
    // Phase 5: shows the dominant personality as a small coloured glyph.
    const ps = this._scene.personalitySystem ?? this._scene.scene.get('Game')?.personalitySystem
    const primaryDef = ps?.getDefinition(adv.personalityIds?.[0])
    let bubble = null, bubbleLabel = null
    if (primaryDef) {
      const tint = parseInt(primaryDef.iconColor ?? '0xaaaabb', 16) || 0xaaaabb
      bubble = this._scene.add.circle(0, -RADIUS - 16, 7, tint, 0.85)
      bubble.setStrokeStyle(1, 0x000000, 0.4)
      bubbleLabel = this._scene.add.text(0, -RADIUS - 16, primaryDef.icon ?? '?', {
        fontSize: '9px', color: '#0a0a14', fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5)
    }

    // Phase QW — combo icon: a small ★ to the right of the head when this
    // adventurer is part of an active personality combo.
    let comboBadge = null
    if ((adv.activeCombos ?? []).length > 0) {
      comboBadge = this._scene.add.text(RADIUS + 4, -RADIUS - 4, '★', {
        fontSize: '10px', color: '#ffeeaa', fontFamily: 'monospace', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0, 0.5)
    }

    // Veteran badge — shown for returning survivors
    let veteranBadge = null
    if (adv.flags?.returningVeteran) {
      veteranBadge = this._scene.add.text(-(RADIUS + 4), -RADIUS - 4,
        `↩${adv.flags.runsCompleted ?? ''}`, {
          fontSize: '9px', color: '#ff6644', fontFamily: 'monospace', fontStyle: 'bold',
          stroke: '#000000', strokeThickness: 2,
        }).setOrigin(1, 0.5)
    }

    const children = [ring, body, label, hpBg, hp]
    if (bubble) children.push(bubble, bubbleLabel)
    if (comboBadge) children.push(comboBadge)
    if (veteranBadge) children.push(veteranBadge)
    c.add(children)

    // Click-to-inspect
    body.setInteractive({ useHandCursor: true })
    body.on('pointerdown', (pointer, x, y, event) => {
      event?.stopPropagation?.()
      EventBus.emit('ADVENTURER_CLICKED', { adventurer: adv })
    })

    const sprite = { container: c, ring, body, label, hp, hpBg, bubble, bubbleLabel, comboBadge, veteranBadge }

    // Builder sprite — if the class def has a CharacterEditor-authored
    // idle animation, swap the placeholder body for the real sprite Image.
    const def = this._defMap?.[adv.classId]
    const idleFrames = def?.builderAnimations?.idle?.frames?.default
                    ?? def?.builderAnimations?.idle?.frames?.right
                    ?? []
    if (idleFrames.length > 0 && this._scene.textures.exists(idleFrames[0].key)) {
      const img = this._scene.add.image(0, 0, idleFrames[0].key).setOrigin(0.5)
      if (def.builderScale) img.setScale(def.builderScale)
      if (def.builderTint != null) img.setTint(def.builderTint)
      if (idleFrames[0].flipX) img.setFlipX(true)
      c.addAt(img, 0)
      body.setVisible(false)
      ring.setVisible(false)
      sprite.builder = { image: img, state: 'idle', idx: 0, accum: 0 }
    }

    this._sprites[adv.instanceId] = sprite
    return sprite
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    s.container.destroy()
    delete this._sprites[id]
  }

  _onRemove({ adventurer }) {
    if (adventurer?.instanceId) this._destroySprite(adventurer.instanceId)
  }

  _clearAll() {
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
  }
}

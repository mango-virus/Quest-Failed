// Renders all active adventurers as world-space markers.
//
// Original look: a colored circle + sigil letter per adventurer.
// Now: if the manifest at assets/sprites/adventurers/manifest.json is loaded
// AND the class has at least one baked LPC variant, the renderer swaps in a
// proper Phaser sprite driven by LPC walk/idle/run/slash/thrust/shoot/cast/
// hurt animations. Each adventurer is assigned a save-stable spriteVariant
// (e.g. 'knight/v07') the first time we render it.
//
// Each frame, the marker reads the adventurer's worldX/worldY (set by
// AISystem) and updates. Click-to-inspect is wired here — emits
// ADVENTURER_CLICKED on EventBus.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE
const RADIUS = 11
// LPC sheets ship at 64×64 per frame; render at 0.75 so adventurers come in
// at ~48px tall — about 1.5 dungeon tiles, a readable size for top-down view.
const LPC_SCALE = 0.75
// Map adventurer movement vector → LPC direction key.
function _dirFromVelocity(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'down' : 'up'
}

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

    // LPC manifest — list of baked variant ids per class. Used for save-stable
    // random assignment in _ensureSpriteVariant. If the manifest didn't load
    // (older builds, missing assets), we transparently fall back to the
    // procedural circle marker.
    const manifest = scene.cache.json.get('adventurerManifest')
    this._lpcVariantsByClass = {}
    if (manifest?.variants) {
      for (const [classId, list] of Object.entries(manifest.variants)) {
        this._lpcVariantsByClass[classId] = list.map((v) => v.id)
      }
    }

    EventBus.on('ADVENTURER_DIED',     this._onRemove,   this)
    EventBus.on('ADVENTURER_FLED',     this._onRemove,   this)
    EventBus.on('NIGHT_PHASE_STARTED', this._clearAll,   this)
    // Stagger fade-in so a party of N spawns one-by-one through the door
    // instead of all popping in at once. _spawnQueueNextAt tracks the next
    // free slot in scene-time ms; each new adv starts fading at that time.
    this._spawnQueueNextAt = 0
    EventBus.on('ADVENTURER_ENTERED_DUNGEON', this._onAdvEntered, this)
    // Replay the attack animation on every swing — without this, the
    // attack anim only plays once when aiState first flips to 'fighting'
    // and then sits on its last frame for repeat hits against the same
    // target.
    EventBus.on('COMBAT_HIT',          this._onCombatHit, this)
  }

  // ADVENTURER_ENTERED_DUNGEON handler — snaps the adv to the center of
  // the entry-hall doorway tile and schedules a staggered fade-in. Each
  // adv reserves the next slot in the queue; when their fade finishes
  // the next adv (if any) starts. _spawnQueueNextAt is reset on every
  // night phase via _clearAll so a new day starts with an empty queue.
  // While `_spawnFadeEnd` is in the future, AISystem skips the per-tick
  // motion/goal logic so the adv stays put and idles in the doorway.
  _onAdvEntered({ adventurer }) {
    if (!adventurer) return
    const now = this._scene?.time?.now ?? 0
    const FADE_MS    = 600
    const STAGGER_MS = 700
    const start = Math.max(now, this._spawnQueueNextAt)
    adventurer._spawnFadeStart = start
    adventurer._spawnFadeEnd   = start + FADE_MS
    this._spawnQueueNextAt     = start + STAGGER_MS

    // Snap to the geometric center of the entry-hall doorway opening (the
    // 2-tile-wide × WALL_THICKNESS-tile-tall door rect). All spawning
    // advs appear stacked in the same spot — visibly "right in the
    // doorway" — until their fade ends and AI walks them in.
    const door = this._entryDoorWorldCenter()
    if (door) {
      adventurer.tileX  = door.tileX
      adventurer.tileY  = door.tileY
      adventurer.worldX = door.worldX
      adventurer.worldY = door.worldY
    }
  }

  // Compute the world-space center of the entry hall's north-facing door
  // rect. Cached for the day. Doorways are 2 cells wide (along the wall
  // axis) × WALL_THICKNESS cells across, with the extra cell slid toward
  // whichever side has more wall — so the center isn't simply the cp tile.
  _entryDoorWorldCenter() {
    if (this._entryDoorCache) return this._entryDoorCache
    const entry = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'entry_hall')
    if (!entry) return null
    const cp = (entry.connectionPoints ?? []).find(c => c.direction === 'N')
    if (!cp) {
      // Fallback — center of top wall row.
      const x = entry.gridX + Math.floor(entry.width / 2)
      this._entryDoorCache = { tileX: x, tileY: entry.gridY, worldX: x * TS + TS / 2, worldY: entry.gridY * TS + TS / 2 }
      return this._entryDoorCache
    }
    // Match DungeonRenderer._cpDoorRect: 2-tile width slid into the side
    // with more wall space; WALL_THICKNESS-tile height starting at top row.
    const WT      = 2
    const alongDx = ((entry.width - 1) - cp.x) >= cp.x ? 1 : -1
    const xStart  = Math.min(cp.x, cp.x + alongDx)
    const tileX   = entry.gridX + xStart
    const tileY   = entry.gridY
    // Center of the 2 × WT tile rect.
    const worldX = tileX * TS + TS              // center of 2-tile width
    const worldY = tileY * TS + (WT * TS) / 2   // center of WT-tile height
    this._entryDoorCache = { tileX, tileY, worldX, worldY }
    return this._entryDoorCache
  }

  // Returns the alpha (0..1) the sprite should render at right now given
  // any active spawn-fade window. Returns 1 once the fade has completed.
  _spawnAlpha(adv) {
    if (adv._spawnFadeEnd == null) return 1
    const now = this._scene?.time?.now ?? 0
    if (now >= adv._spawnFadeEnd) {
      adv._spawnFadeStart = null
      adv._spawnFadeEnd = null
      return 1
    }
    const span = Math.max(1, adv._spawnFadeEnd - adv._spawnFadeStart)
    return Math.max(0, Math.min(1, (now - adv._spawnFadeStart) / span))
  }

  _onCombatHit({ sourceId }) {
    const adv = this._gameState.adventurers?.active?.find(a => a.instanceId === sourceId)
    if (!adv) return
    const s = this._sprites[adv.instanceId]
    if (!s?.lpc) return
    const cls = this._defMap?.[adv.classId]
    const tags = new Set(cls?.tags ?? [])
    let anim
    if (tags.has('spellcaster') || tags.has('healer'))                              anim = 'spellcast'
    else if (tags.has('ranged') && (cls?.id === 'ranger' || cls?.id === 'bard'))    anim = 'shoot'
    else if (cls?.id === 'monk' || cls?.id === 'beast_master')                      anim = 'thrust'
    else                                                                            anim = 'slash'
    const dir = adv._lpcDir ?? 'down'
    const wantKey = `${s.lpc.textureKey}-${anim}-${dir}`
    if (!this._scene.anims.exists(wantKey)) return
    s.lpc.image.anims.play(wantKey, true)
    // Force the per-tick guard to re-pick on the next idle/walk transition.
    s.lpc.lastAnim = wantKey
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
      // Track movement direction for the LPC sprite — derived from the
      // last frame's worldX/Y delta. Stored on adv (transient, save-safe).
      const prevX = adv._lastWorldX ?? adv.worldX
      const prevY = adv._lastWorldY ?? adv.worldY
      const dx = adv.worldX - prevX, dy = adv.worldY - prevY
      adv._lastWorldX = adv.worldX
      adv._lastWorldY = adv.worldY
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) adv._lpcDir = _dirFromVelocity(dx, dy)
      s.container.setPosition(adv.worldX, adv.worldY)
      const hpFrac = adv.resources.maxHp > 0
        ? Math.max(0, adv.resources.hp / adv.resources.maxHp) : 0
      s.hp.width = Math.max(0, hpFrac * (RADIUS * 2))
      // Hide the HP bar entirely when at full health — only show damage state.
      const hpVisible = hpFrac < 0.999
      s.hp.setVisible(hpVisible)
      s.hpBg.setVisible(hpVisible)
      this._updateBubbleState(s, adv)
      this._tickBuilderAnim(s, adv, dt)
      this._tickLpcAnim(s, adv)

      // Spawn fade-in: until the fade window finishes, scale the entire
      // container's alpha so the sprite, HP bar, etc. all fade together.
      // Invisibility (Rogue) takes precedence — when invisible the alpha
      // override is already 0.15, applied directly to the LPC sprite.
      const spawnA = this._spawnAlpha(adv)
      if (s.container && spawnA < 1) s.container.setAlpha(spawnA)
      else if (s.container) s.container.setAlpha(1)
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

  // Pick an LPC animation+direction based on AI state and play it on the
  // adventurer's sprite. Idempotent — only triggers a play() when the desired
  // (anim, dir) actually changed, so Phaser doesn't restart the animation
  // every frame.
  _tickLpcAnim(s, adv) {
    if (!s.lpc) return
    const dir = adv._lpcDir ?? 'down'
    let anim = 'idle'
    const cls = this._defMap?.[adv.classId]
    const tags = new Set(cls?.tags ?? [])
    if (adv.resources?.hp <= 0) {
      anim = 'hurt'
    } else if (adv.aiState === 'fighting') {
      // Pick the swing style that matches the class's combat flavor.
      if (tags.has('spellcaster') || tags.has('healer'))    anim = 'spellcast'
      else if (tags.has('ranged') && (cls?.id === 'ranger' || cls?.id === 'bard'))  anim = 'shoot'
      else if (cls?.id === 'monk' || cls?.id === 'beast_master')                    anim = 'thrust'
      else                                                                          anim = 'slash'
    } else if (adv.aiState === 'fleeing' || adv.goal?.type === 'FLEE') {
      anim = 'run'
    } else if (adv.aiState === 'walking' || adv.aiState === 'searching') {
      anim = 'walk'
    } else {
      anim = 'idle'
    }

    // Hurt sheet only has a south-facing strip; force `down` for that anim.
    const targetDir = anim === 'hurt' ? 'down' : dir
    const wantKey = `${s.lpc.textureKey}-${anim}-${targetDir}`
    if (s.lpc.lastAnim === wantKey) return
    s.lpc.lastAnim = wantKey
    if (this._scene.anims.exists(wantKey)) {
      s.lpc.image.anims.play(wantKey, true)
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
    EventBus.off('ADVENTURER_ENTERED_DUNGEON', this._onAdvEntered, this)
    EventBus.off('COMBAT_HIT',          this._onCombatHit, this)
    this._clearAll()
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _createSprite(adv) {
    // Depth 8 — below the dungeon overhead (9) and doors (9.5) so the
    // adventurer walks UNDER wall caps + closed doors, matching the design
    // intent. (Bumped to 11 briefly during a doorway-visibility debugging
    // pass — that turned out to be an invisible-rogue alpha issue, not a
    // depth issue.)
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

    // HP bar — positioned just above the LPC sprite's head. The LPC sprite
    // is 64×64 rendered at 0.75 scale with origin (0.5, 0.85), so the
    // sprite's head sits at roughly y = -41 from container center. HP bar
    // at y = -38 sits just at hairline height — readable without floating
    // off into space.
    const HP_BAR_Y = -38
    const hpBg = this._scene.add.rectangle(0, HP_BAR_Y, RADIUS * 2, 3, 0x220a06, 0.9)
      .setOrigin(0.5)
    const hp   = this._scene.add.rectangle(-RADIUS, HP_BAR_Y, RADIUS * 2, 3, 0x33cc77, 1)
      .setOrigin(0, 0.5)

    // Phase 5c — personality icon bubble removed (was clutter above heads).
    let bubble = null, bubbleLabel = null

    // Phase 5c — combo badge removed (personality combos retired entirely).
    let comboBadge = null

    // Veteran badge — shown for returning survivors. Sits just above the HP
    // bar so it's clearly readable.
    let veteranBadge = null
    if (adv.flags?.returningVeteran) {
      veteranBadge = this._scene.add.text(-(RADIUS + 4), HP_BAR_Y - 8,
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

    // LPC sprite — preferred over the procedural circle when a baked variant
    // is available for this adventurer's class. Picks a save-stable variant
    // the first time, then renders + animates from the LPC sheet.
    const lpc = this._buildLpcSprite(adv)
    if (lpc) {
      // LPC sprite is positioned slightly above center so the feet sit on
      // the tile, then origin-anchored at (0.5, 0.85) so the bottom is the
      // movement reference point.
      lpc.image.setOrigin(0.5, 0.85)
      lpc.image.setScale(LPC_SCALE)
      // Insert below all existing children (ring/body/label) so the HP bar +
      // thought bubble float above the sprite.
      c.addAt(lpc.image, 0)
      // Hide the procedural circle when LPC is in play.
      body.setVisible(false)
      ring.setVisible(false)
      label.setVisible(false)
      sprite.lpc = lpc
    }

    this._sprites[adv.instanceId] = sprite
    return sprite
  }

  // Pick (or fetch the previously-picked) LPC variant for this adventurer
  // and instantiate a Phaser sprite for it. Returns null if the manifest
  // isn't loaded or this class has no baked variants.
  _buildLpcSprite(adv) {
    const variants = this._lpcVariantsByClass[adv.classId]
    if (!variants || variants.length === 0) return null
    // Save-stable: assign once, persist on adv for save/load identity.
    if (!adv.spriteVariant) {
      const picked = variants[Math.floor(Math.random() * variants.length)]
      adv.spriteVariant = `${adv.classId}/${picked}`
    }
    const [cls, vId] = adv.spriteVariant.split('/')
    const textureKey = `adv-${cls}-${vId}`
    if (!this._scene.textures.exists(textureKey)) return null
    const image = this._scene.add.sprite(0, 0, textureKey, 0)
    return { image, textureKey, lastAnim: null }
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
    // Reset the spawn-fade stagger queue so the next day starts fresh.
    this._spawnQueueNextAt = 0
    // Drop the cached doorway tile in case the player rebuilt the entry
    // hall between days.
    this._entryDoorCache = null
  }
}

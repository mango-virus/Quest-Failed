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
import { entryDoorWorldCenter } from '../systems/DungeonGrid.js'

const TS = Balance.TILE_SIZE
const RADIUS = 11
// LPC sheets ship at 64×64 per frame; render at 0.75 so adventurers come in
// at ~48px tall — about 1.5 dungeon tiles, a readable size for top-down view.
const LPC_SCALE = 0.75
// Anims using the separate _atk texture (192×192 frames). When playing one of
// these, the sprite swaps to the atk texture and adjusts origin so the
// character body's foot stays at the same world position.
const ATK_ANIMS = new Set(['slash', 'thrust'])
// Body sprite origin: foot at y = 0.85 of 64 = 54.4px. In the 192×192 atk
// frame the body is centered (top=64), so the foot sits at y = 64 + 54.4 =
// 118.4px → origin y = 118.4 / 192 ≈ 0.617. Keeps the character's foot at the
// same world position when swapping textures.
const LPC_BODY_ORIGIN_Y = 0.85
const LPC_ATK_ORIGIN_Y  = 0.617
// Weapons that should always render combat as `thrust`, regardless of the
// class's default animation. Spear/Cane only have thrust frames; staves and
// the Crossbow have a thrust_oversize that looks more dynamic than the static
// spellcast/shoot poses, and ensures the weapon is actually visible mid-attack.
const THRUST_ANIM_WEAPONS = new Set([
  'Spear', 'Cane', 'Crossbow',
  'Simple staff', 'Diamond staff', 'S staff', 'Loop staff', 'Gnarled staff',
])
// Weapons that should override the class default to `slash`. Necromancers play
// spellcast by default, but a Scythe has only slash_oversize layers — without
// this override the scythe never appears mid-attack.
const SLASH_ANIM_WEAPONS = new Set(['Scythe'])
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
    // Map 'class/vNN' → weapon name, used to pick the right combat animation
    // (e.g. spear-wielders thrust instead of slashing).
    this._lpcWeaponByVariant = {}
    if (manifest?.variants) {
      for (const [classId, list] of Object.entries(manifest.variants)) {
        this._lpcVariantsByClass[classId] = list.map((v) => v.id)
        for (const v of list) {
          this._lpcWeaponByVariant[`${classId}/${v.id}`] = v.weapon
        }
      }
    }

    // DIED keeps the body on-screen as a corpse until NIGHT_PHASE_STARTED.
    // FLED still destroys (the adventurer ran off, no body left behind).
    EventBus.on('ADVENTURER_DIED',     this._onAdvDied,  this)
    EventBus.on('ADVENTURER_FLED',     this._onRemove,   this)
    EventBus.on('NIGHT_PHASE_STARTED', this._clearAll,   this)
    // Myconid Corpse Bloom — when a fungal corpse sprouts a Vinekin, take
    // down the dead-adv body sprite that's been parked on the death tile
    // since ADVENTURER_DIED. The Vinekin replaces it as the room occupant.
    EventBus.on('MYCONID_CORPSE_SPROUTED', this._onMyconidSprouted, this)
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
    // Phase: alive AI — pop a "+2 ATK" floater above the adv when they
    // gain a buff (currently only fired by LOOT_CORPSE completion).
    EventBus.on('BUFF_GAINED',         this._onBuffGained, this)
    // Phase D — persistent gold-bag label that follows every adv carrying
    // stolen treasure. Created on TREASURE_STOLEN, destroyed on death,
    // escape, or recover. Position updates each tick.
    this._carrierLabels = {}
    EventBus.on('TREASURE_STOLEN',     this._onTreasureStolen,     this)
    EventBus.on('TREASURE_RECOVERED',  this._onTreasureCleared,    this)
    EventBus.on('TREASURE_ESCAPED',    this._onTreasureCleared,    this)
    EventBus.on('ADVENTURER_DIED',     this._onTreasureCleared,    this)
    EventBus.on('NIGHT_PHASE_STARTED', this._clearAllCarrierLabels, this)
  }

  _onTreasureStolen({ adv, gold }) {
    if (!adv || !gold) return
    const id = adv.instanceId
    if (this._carrierLabels[id]) this._carrierLabels[id].destroy?.()
    // 24×26 gold-coins icon. Sits just above the HP bar (HP_BAR_Y = -38)
    // so it reads as "this adv is carrying loot" without obscuring chat
    // bubbles, which anchor higher (worldY - 30, extending upward).
    if (!this._scene.textures.exists('item-gold-coins')) return
    const img = this._scene.add.image(adv.worldX, adv.worldY - 42, 'item-gold-coins')
      .setOrigin(0.5, 1).setDepth(40)
    this._carrierLabels[id] = img
  }

  _onTreasureCleared({ adv, adventurer }) {
    const id = (adv ?? adventurer)?.instanceId
    if (!id) return
    this._carrierLabels[id]?.destroy?.()
    delete this._carrierLabels[id]
  }

  _clearAllCarrierLabels() {
    for (const t of Object.values(this._carrierLabels ?? {})) t?.destroy?.()
    this._carrierLabels = {}
  }

  // Floating "+ATK" / "+5 HP" text that drifts upward and fades. Keeps
  // each adv's last-floater so a rapid second buff replaces the first
  // instead of stacking on top of itself.
  _onBuffGained({ adventurer, label }) {
    if (!adventurer || !label) return
    const x = adventurer.worldX
    const y = adventurer.worldY - 18
    const t = this._scene.add.text(x, y, label, {
      fontSize:        '11px',
      color:           '#ffe066',
      fontFamily:      '"Press Start 2P", monospace',
      stroke:          '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(40)
    this._scene.tweens.add({
      targets:    t,
      y:          y - 22,
      alpha:      { from: 1, to: 0 },
      duration:   1400,
      ease:       'Quad.easeOut',
      onComplete: () => t.destroy(),
    })
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
    //
    // Exception: spawn-in-place advs (Loot Goblin Heist drops a pack
    // inside the boss room) keep the position the spawner chose. Without
    // this guard the renderer teleports them back to the entry-hall door
    // immediately after the spawner placed them, breaking the heist.
    const door = adventurer._spawnedInPlace ? null : this._entryDoorWorldCenter()
    if (door) {
      adventurer.tileX  = door.tileX
      adventurer.tileY  = door.tileY
      adventurer.worldX = door.worldX
      adventurer.worldY = door.worldY
    }

    // Arrival flourish — expanding-and-fading dust puff at the doorway,
    // scheduled to fire when this adv's fade-in BEGINS so the puff
    // lines up with the visible "pop". Geometry is drawn around the
    // graphics' LOCAL (0,0) and the graphics object is positioned at
    // the doorway — that way `scale` tweens cause the puff to expand
    // around its centre instead of drifting diagonally toward the
    // world origin (which is what happened when I drew at world
    // coords directly).
    if (door) {
      const fireAt = Math.max(0, start - now)
      this._scene.time.delayedCall(fireAt, () => {
        if (!this._scene || !this._scene.add) return
        const puff = this._scene.add.graphics()
          .setPosition(door.worldX, door.worldY - 6)
          .setDepth(20)
        // Solid (non-blended) light fill is more reliably visible over
        // the dungeon floor than ADD blending. Two stacked circles for
        // a chunkier "poof" silhouette.
        puff.fillStyle(0xfff4d0, 0.85)
        puff.fillCircle(0, 0, 7)
        puff.fillStyle(0xe8c898, 0.55)
        puff.fillCircle(-3, -2, 5)
        puff.fillCircle(3,  2, 5)
        this._scene.tweens.add({
          targets: puff,
          scale:   2.6,
          alpha:   0,
          duration: 520,
          ease:    'Quad.easeOut',
          onComplete: () => puff.destroy(),
        })
      })
    }
  }

  // World-space center of the entry hall's doorway rect, wherever the
  // (possibly rotated) entrance ended up. Cached for the day — the cache
  // is cleared on day start, so a rotation done in the night phase is
  // picked up next day. Delegates to the shared rotation-aware helper.
  _entryDoorWorldCenter() {
    if (this._entryDoorCache) return this._entryDoorCache
    const entry = this._gameState?.dungeon?.rooms?.find(r => r.definitionId === 'entry_hall')
    if (!entry) return null
    this._entryDoorCache = entryDoorWorldCenter(entry)
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

  // Mirror of _spawnAlpha for the leave-fade: while AISystem holds the
  // adv at the entry doorway and runs the fade-out clock, return an
  // alpha that ramps from 1 → 0.  AISystem splices the adv off `active`
  // the tick after the fade ends, so we never see alpha 0 lingering.
  _leaveAlpha(adv) {
    if (adv._leaveFadeEnd == null) return 1
    const now = this._scene?.time?.now ?? 0
    const span = Math.max(1, adv._leaveFadeEnd - adv._leaveFadeStart)
    const t = Math.max(0, Math.min(1, (now - adv._leaveFadeStart) / span))
    return 1 - t
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
    else if (cls?.id === 'ranger' || cls?.id === 'bard')                            anim = 'shoot'
    else if (cls?.id === 'monk' || cls?.id === 'beast_master')                      anim = 'thrust'
    else                                                                            anim = 'slash'
    {
      const wpn = this._lpcWeaponByVariant[adv.spriteVariant]
      if      (THRUST_ANIM_WEAPONS.has(wpn)) anim = 'thrust'
      else if (SLASH_ANIM_WEAPONS.has(wpn))  anim = 'slash'
    }
    const dir = adv._lpcDir ?? 'down'
    const { animKey, originY } = this._resolveLpcAnimKey(s, anim, dir)
    if (!this._scene.anims.exists(animKey)) return
    if (s.lpc.image.originY !== originY) s.lpc.image.setOrigin(0.5, originY)
    s.lpc.image.anims.play(animKey, true)
    // Force the per-tick guard to re-pick on the next idle/walk transition.
    s.lpc.lastAnim = animKey
  }

  // Resolve the (animKey, originY) pair for a desired anim+dir, switching to
  // the `_atk` texture for slash/thrust when one is registered for this
  // variant. Falls back to the main texture (and main origin) otherwise.
  _resolveLpcAnimKey(s, anim, dir) {
    const useAtk = ATK_ANIMS.has(anim) && s.lpc.atkTextureKey
    const baseKey = useAtk ? s.lpc.atkTextureKey : s.lpc.textureKey
    const targetDir = anim === 'hurt' ? 'down' : dir
    return {
      animKey: `${baseKey}-${anim}-${targetDir}`,
      originY: useAtk ? LPC_ATK_ORIGIN_Y : LPC_BODY_ORIGIN_Y,
    }
  }

  // Called every Game.update() frame
  update() {
    const active = this._gameState.adventurers.active
    const seen = new Set()
    const dt = this._scene.game.loop.delta

    for (const adv of active) {
      seen.add(adv.instanceId)
      // Phase D — keep the gold-coins icon glued above the adv carrying
      // stolen treasure. Sits just above the HP bar (y - 42) — chat
      // bubbles anchor higher (y - 30 extending up) so they don't clash.
      const tag = this._carrierLabels?.[adv.instanceId]
      if (tag) tag.setPosition(adv.worldX, adv.worldY - 42)
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
      // While locked into the boss fight, always face the boss — even
      // when the adv is stationary mid-swing. Skipped while moving (so
      // run-away / reposition animations still use the velocity-derived
      // facing).
      const boss = this._gameState.boss
      if (adv.aiState === 'fighting' &&
          adv.goal?.type === 'AT_BOSS' &&
          boss && boss.worldX !== undefined &&
          Math.abs(dx) <= 0.05 && Math.abs(dy) <= 0.05) {
        adv._lpcDir = _dirFromVelocity(boss.worldX - adv.worldX, boss.worldY - adv.worldY)
      }
      s.container.setPosition(adv.worldX, adv.worldY)
      // Y-sort against the boss + minions: larger worldY draws on top.
      s.container.setDepth(7 + adv.worldY * 0.0005)
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

      // Spawn fade-in / leave fade-out: the smaller of the two alphas
      // wins (so an adv re-leaving while still spawning would still
      // fade out). Container alpha covers the sprite, HP bar, labels.
      // Invisibility (Rogue) takes precedence — when invisible the
      // alpha override is already 0.15, applied directly to the LPC
      // sprite below.
      // Doorway shadow dim: standing on a doorway INNER (threshold) cell
      // dims the adv to 0.55, so they look like they're stepping into the
      // dark of the underpass. Multiplies with spawn/leave alpha.
      const spawnA = this._spawnAlpha(adv)
      const leaveA = this._leaveAlpha(adv)
      const tx = (adv.worldX / TS) | 0
      const ty = (adv.worldY / TS) | 0
      const inDoorwayShadow = this._scene._dungeonRenderer?.isDoorwayShadowCell(tx, ty)
      const shadowA = inDoorwayShadow ? 0.55 : 1
      const fadeA  = Math.min(spawnA, leaveA) * shadowA
      if (s.container) s.container.setAlpha(fadeA)

      // Phase 1b.8 — Wraith Fear Meter bar. 0..100. Hidden at 0; full purple
      // fill at 100. Cheap re-render only when the rounded value changes.
      const fearRaw = adv._fear ?? 0
      const fearMax = 100
      const fearFracClamped = Math.max(0, Math.min(1, fearRaw / fearMax))
      const fearKey = Math.round(fearRaw)
      if (s._lastFear !== fearKey) {
        const visible = fearKey > 0
        if (s.fearBg)   s.fearBg.setVisible(visible)
        if (s.fearFill) {
          s.fearFill.setVisible(visible)
          s.fearFill.width = (RADIUS * 2) * fearFracClamped
          // Gradually shift hue from purple → red as fear nears panic death.
          const t = fearFracClamped
          const r = Math.round(0x9b + (0xff - 0x9b) * t)
          const g = Math.round(0x32 + (0x22 - 0x32) * t)
          const b = Math.round(0xd4 + (0x22 - 0xd4) * t)
          s.fearFill.fillColor = (r << 16) | (g << 8) | b
        }
        s._lastFear = fearKey
      }

      // Phase 1b.6 — Lizardman Venom Stack VFX. Green tint on the body /
      // sprite + a "Nx" badge above the HP bar. Cleared as soon as stacks
      // hit zero (heart-purged or DoT timed out).
      const stacks = adv._venomStacks ?? 0
      if (s._lastVenomStacks !== stacks) {
        if (s.venomBadge) {
          if (stacks > 0) s.venomBadge.setText(`${stacks}×`).setVisible(true)
          else            s.venomBadge.setVisible(false)
        }
        // Tint the LPC sprite (or fallback body) green when poisoned.
        const tint = stacks > 0 ? 0x66ee88 : 0xffffff
        if (s.builder?.image?.setTint) {
          if (stacks > 0) s.builder.image.setTint(tint)
          else             s.builder.image.clearTint()
        } else if (s.body?.setStrokeStyle) {
          s.body.setStrokeStyle(2, stacks > 0 ? 0x66ee88 : adv.classColor, 1)
        }
        s._lastVenomStacks = stacks
      }

      // Dungeon event: Pestilence — show a skull glyph + sickly olive tint
      // while the adv is Blighted. Skipped when venom stacks are also
      // present so we don't double-tint (venom wins for color, blight
      // still shows its own badge).
      const blighted = !!adv._blighted
      if (s._lastBlight !== blighted) {
        if (s.blightBadge) s.blightBadge.setVisible(blighted)
        // Apply olive tint only when the adv isn't already venom-tinted —
        // venom's vivid green is more urgent and should win.
        if (stacks === 0) {
          const tint = blighted ? 0x88aa66 : 0xffffff
          if (s.builder?.image?.setTint) {
            if (blighted) s.builder.image.setTint(tint)
            else          s.builder.image.clearTint()
          }
        }
        s._lastBlight = blighted
      }
    }

    // Clean up sprites whose adventurers are no longer active. Corpses (dead
    // sprites) stay parked at their death position until NIGHT_PHASE_STARTED.
    for (const id of Object.keys(this._sprites)) {
      const s = this._sprites[id]
      if (s.isDead) continue
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
    } else if (adv.aiState === 'leaving') {
      // Standing in the doorway during the exit fade — idle, not run,
      // so the adv visibly stops before they vanish.
      anim = 'idle'
    } else if (adv.aiState === 'fighting') {
      // Pick the swing style that matches the class's combat flavor.
      if (tags.has('spellcaster') || tags.has('healer'))    anim = 'spellcast'
      else if (cls?.id === 'ranger' || cls?.id === 'bard')                          anim = 'shoot'
      else if (cls?.id === 'monk' || cls?.id === 'beast_master')                    anim = 'thrust'
      else                                                                          anim = 'slash'
      // Weapon-specific overrides so the actual weapon shows mid-attack —
      // see THRUST_ANIM_WEAPONS / SLASH_ANIM_WEAPONS for rationale.
      {
        const wpn = this._lpcWeaponByVariant[adv.spriteVariant]
        if      (THRUST_ANIM_WEAPONS.has(wpn)) anim = 'thrust'
        else if (SLASH_ANIM_WEAPONS.has(wpn))  anim = 'slash'
      }
    } else if (adv.aiState === 'fleeing' || adv.goal?.type === 'FLEE') {
      anim = 'run'
    } else if (adv.aiState === 'walking' || adv.aiState === 'searching') {
      anim = 'walk'
    } else if (adv.aiState === 'charmed') {
      // Charmed adv runs at their target between damage ticks. Attack
      // swings are layered on by COMBAT_HIT (see _onCombatHit + the
      // generalized in-flight attack guard below).
      anim = 'walk'
    } else {
      anim = 'idle'
    }

    // Resolve the right texture/anim — slash and thrust swap to the `_atk`
    // texture (192×192 frames) so long weapons render at native scale.
    const { animKey: wantKey, originY } = this._resolveLpcAnimKey(s, anim, dir)
    if (s.lpc.lastAnim === wantKey) return

    // Let an in-flight attack swing finish before transitioning back to
    // walk/idle. The COMBAT_HIT listener fires off slash/thrust/shoot/
    // spellcast as one-shots; without this guard, the very next update
    // tick clobbers them with the state-machine's preferred anim and
    // the player only ever sees a 1-frame stub. Applies whether the
    // wanted anim is itself an attack (direction jitter mid-swing) or
    // a different state (e.g. charmed advs whose ambient anim is walk).
    const ATTACK_ANIMS = new Set(['slash', 'thrust', 'shoot', 'spellcast'])
    if (s.lpc.image.anims?.isPlaying) {
      const curKey = s.lpc.image.anims.currentAnim?.key ?? ''
      for (const atk of ATTACK_ANIMS) {
        if (curKey.endsWith(`-${atk}-up`) || curKey.endsWith(`-${atk}-down`) ||
            curKey.endsWith(`-${atk}-left`) || curKey.endsWith(`-${atk}-right`)) {
          return
        }
      }
    }

    s.lpc.lastAnim = wantKey
    // Minion-sheet sprites (loot_goblin) keep their centered origin — the
    // LPC body/atk origin doesn't apply to 64×64 minion frames.
    if (!s.lpc.isMinionSheet && s.lpc.image.originY !== originY) {
      s.lpc.image.setOrigin(0.5, originY)
    }
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
    EventBus.off('ADVENTURER_DIED',     this._onAdvDied,  this)
    EventBus.off('ADVENTURER_FLED',     this._onRemove,   this)
    EventBus.off('NIGHT_PHASE_STARTED', this._clearAll,   this)
    EventBus.off('ADVENTURER_ENTERED_DUNGEON', this._onAdvEntered, this)
    EventBus.off('COMBAT_HIT',          this._onCombatHit, this)
    EventBus.off('MYCONID_CORPSE_SPROUTED', this._onMyconidSprouted, this)
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

    // Room redesign 2026-04-30 — Wishing Well "Marked" badge.
    let markedBadge = null
    const today = this._gameState?.meta?.dayNumber
    if (adv.flags?.marked && adv.flags?.markedExpiresOnDay === today) {
      markedBadge = this._scene.add.text(RADIUS + 4, HP_BAR_Y - 8, '☠', {
        fontSize: '11px', color: '#cc3322', fontFamily: 'monospace', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0, 0.5)
    }

    // Phase 1b.6 — Lizardman Venom Stack badge. Shown only when the adv has
    // venom stacks > 0. Anchored to the right of the HP bar, two pixels up.
    const venomBadge = this._scene.add.text(RADIUS + 4, HP_BAR_Y - 1, '', {
      fontSize: '9px', color: '#88ff88', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#053018', strokeThickness: 2,
    }).setOrigin(0, 0.5).setVisible(false)

    // Dungeon event: Pestilence — small skull glyph above the HP bar
    // when the adv has been Blighted. Distinct from the venom green to
    // avoid visual collision with Lizardman venom stacks.
    const blightBadge = this._scene.add.text(0, HP_BAR_Y - 12, '☠', {
      fontSize: '10px', color: '#aacc88', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#1c2a14', strokeThickness: 2,
    }).setOrigin(0.5).setVisible(false)

    // Phase 1b.8 — Wraith Fear Meter bar. Sits two pixels BELOW the HP bar
    // so the two read as separate gauges. Hidden until fear > 0.
    const FEAR_BAR_Y = HP_BAR_Y + 5
    const fearBg = this._scene.add.rectangle(0, FEAR_BAR_Y, RADIUS * 2, 2, 0x180a14, 0.9)
      .setOrigin(0.5).setVisible(false)
    const fearFill = this._scene.add.rectangle(-RADIUS, FEAR_BAR_Y, RADIUS * 2, 2, 0x9b32d4, 1)
      .setOrigin(0, 0.5).setVisible(false)

    const children = [ring, body, label, hpBg, hp, venomBadge, blightBadge, fearBg, fearFill]
    if (bubble) children.push(bubble, bubbleLabel)
    if (comboBadge) children.push(comboBadge)
    if (veteranBadge) children.push(veteranBadge)
    if (markedBadge) children.push(markedBadge)
    c.add(children)

    // Click-to-inspect
    body.setInteractive({ useHandCursor: true })
    body.on('pointerdown', (pointer, x, y, event) => {
      event?.stopPropagation?.()
      EventBus.emit('ADVENTURER_CLICKED', { adventurer: adv })
    })

    const sprite = { container: c, ring, body, label, hp, hpBg, bubble, bubbleLabel, comboBadge, veteranBadge, venomBadge, blightBadge, fearBg, fearFill, _lastVenomStacks: null, _lastFear: null, _lastBlight: null }

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
      // movement reference point. Minion-sheet sprites (loot_goblin) use
      // a centered origin + 1.0 scale to match how the same sheets render
      // when worn by an actual goblin minion in the dungeon.
      if (lpc.isMinionSheet) {
        lpc.image.setOrigin(0.5, 0.5)
        lpc.image.setScale(1.0)
      } else {
        lpc.image.setOrigin(0.5, 0.85)
        lpc.image.setScale(LPC_SCALE)
      }
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
    // Rival Dungeon boss: render with one of the boss-archetype skins
    // instead of an adventurer LPC sheet, so they read as a peer-tier
    // threat. Texture is loaded by Preload's BOSS_SKINS list; we just
    // pick frame 0 of the idle sheet at boss-scale.
    if (adv._rivalBossSpriteKey) {
      const key = `${adv._rivalBossSpriteKey}-idle`
      if (this._scene.textures.exists(key)) {
        const image = this._scene.add.sprite(0, 0, key, 0)
        const idleAnim = `${adv._rivalBossSpriteKey}-idle-down`
        if (this._scene.anims.exists(idleAnim)) image.play(idleAnim)
        // Scale 1.5 — between adv (~0.5) and player boss (2.0) so the
        // rival reads as imposing without overpowering the player's boss
        // visually during the showdown.
        image.setScale(1.5)
        return { image, textureKey: key, atkTextureKey: null, lastAnim: null }
      }
      // Texture missing — fall through to LPC fallback below.
    }
    // Loot Goblin Heist — render the goblin "adventurers" with the goblin
    // MINION sheets so they read visually as the goblin race that's
    // raiding the dungeon, not as a humanoid LPC adventurer. Animation
    // keys are shaped `${textureKey}-${anim}-${dir}` which matches the
    // minion anim registration (minion-goblin1-walk-down etc.), so the
    // existing _tickLpcAnim flow drives walk/run/idle/hurt without any
    // additional handling. atkTextureKey null because goblins never
    // swing — they're FLEE-only.
    if (adv.classId === 'loot_goblin') {
      const baseKey = 'minion-goblin1'
      const idleKey = `${baseKey}-idle`
      if (this._scene.textures.exists(idleKey)) {
        const image = this._scene.add.sprite(0, 0, idleKey, 0)
        const startAnim = `${baseKey}-run-down`
        if (this._scene.anims.exists(startAnim)) image.play(startAnim)
        return { image, textureKey: baseKey, atkTextureKey: null, lastAnim: null, isMinionSheet: true }
      }
      // Texture missing — fall through to the LPC path (cartographer_scholar bake).
    }
    // Event-only classes (tournament_rival_*, monster_invader, rival_boss_invader,
    // loot_goblin) don't ship their own LPC bake — they declare a
    // spriteSourceClassId on their adventurerClasses.json entry that points at
    // an existing baked class to borrow art from. Falls through to the normal
    // path when the class IS baked.
    const def = this._defMap?.[adv.classId]
    const sourceClassId =
      (this._lpcVariantsByClass[adv.classId]?.length ? adv.classId : null) ??
      def?.spriteSourceClassId ?? adv.classId
    const variants = this._lpcVariantsByClass[sourceClassId]
    if (!variants || variants.length === 0) return null
    // Save-stable: assign once, persist on adv for save/load identity.
    if (!adv.spriteVariant) {
      const picked = variants[Math.floor(Math.random() * variants.length)]
      adv.spriteVariant = `${sourceClassId}/${picked}`
    }
    const [cls, vId] = adv.spriteVariant.split('/')
    const textureKey = `adv-${cls}-${vId}`
    if (!this._scene.textures.exists(textureKey)) return null
    const image = this._scene.add.sprite(0, 0, textureKey, 0)
    // Optional 192×192 attack texture for slash/thrust classes — null if this
    // variant didn't ship an _atk.png (e.g. spellcasters, weapon: null variants).
    const atkKey = `${textureKey}-atk`
    const atkTextureKey = this._scene.textures.exists(atkKey) ? atkKey : null
    return { image, textureKey, atkTextureKey, lastAnim: null }
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

  // Myconid Corpse Bloom — sprout consumed the corpse, so take the body
  // sprite down too if it's still around.
  _onMyconidSprouted({ advId }) {
    if (advId && this._sprites[advId]) this._destroySprite(advId)
  }

  // Death turns the sprite into a "corpse": play the hurt anim (one-shot,
  // freezes on last frame), strip the HUD bits, mark it dead so update()
  // leaves it parked at the death position. Cleaned up by _clearAll on
  // NIGHT_PHASE_STARTED.
  _onAdvDied({ adventurer }) {
    const s = this._sprites[adventurer?.instanceId]
    if (!s) return
    // Myconid archetype paints its own corpse via FungalCorpseRenderer on
    // the death tile (green-tinted last-hurt frame inside the glow). If we
    // also leave the parked body here, both render and the player sees a
    // duplicate corpse. Tear our sprite down immediately for myconid runs.
    if (this._gameState?.player?.bossArchetypeId === 'myconid') {
      this._destroySprite(adventurer.instanceId)
      return
    }
    s.isDead = true
    s.hp?.setVisible(false)
    s.hpBg?.setVisible(false)
    s.bubble?.setVisible(false)
    s.bubbleLabel?.setVisible(false)
    s.veteranBadge?.setVisible(false)
    s.markedBadge?.setVisible(false)
    s.body?.disableInteractive()
    if (s.lpc) {
      // Snap back to the body texture/origin in case we died mid-attack on
      // the atk sheet, then play the LPC hurt strip. Minion-sheet sprites
      // (loot_goblin) keep their centered origin.
      if (!s.lpc.isMinionSheet && s.lpc.image.originY !== LPC_BODY_ORIGIN_Y) {
        s.lpc.image.setOrigin(0.5, LPC_BODY_ORIGIN_Y)
      }
      const wantKey = `${s.lpc.textureKey}-hurt-down`
      if (this._scene.anims.exists(wantKey)) {
        s.lpc.image.anims.play(wantKey, true)
        s.lpc.lastAnim = wantKey
      }
    }
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

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
import { AbilityVfx } from './AbilityVfx.js'
import { Balance }  from '../config/balance.js'
import { entryDoorWorldCenter } from '../systems/DungeonGrid.js'
import { rgbParticleBurst } from '../util/cheaterVfx.js'
import { ensureAdventurerBaseSheet } from '../scenes/AdventurerBaseLoader.js'

const TS = Balance.TILE_SIZE
const RADIUS = 11
// Lerp between two 0xRRGGBB colors (k in 0..1) → packed 0xRRGGBB. Used for
// Jinwoo's RGB-style blue↔black flame cycle.
function _lerpHex(a, b, k) {
  const r = Math.round((a >> 16 & 255) + ((b >> 16 & 255) - (a >> 16 & 255)) * k)
  const g = Math.round((a >> 8  & 255) + ((b >> 8  & 255) - (a >> 8  & 255)) * k)
  const bl = Math.round((a       & 255) + ((b       & 255) - (a       & 255)) * k)
  return (r << 16) | (g << 8) | bl
}

// Nerve mood-pip colour by band (AI overhaul). Confident green → dread red.
function _moodPipColor(mood) {
  switch (mood) {
    case 'bold':     return 0x6fe09a
    case 'steady':   return 0xbfe06f
    case 'wary':     return 0xf0d24a
    case 'spooked':  return 0xf09a3a
    case 'breaking': return 0xe2483a
    default:         return 0xbfe06f
  }
}
// LPC sheets ship at 64×64 per frame; render at 0.75 so adventurers come in
// at ~48px tall — about 1.5 dungeon tiles, a readable size for top-down view.
const LPC_SCALE = 0.75
// Valkyrie flight — she hovers above the floor as a winged angel. We lift her
// LPC sprite a few px and add a slow vertical bob, while a small ground-shadow
// ellipse stays planted on the tile. That sprite↔shadow GAP is what reads as
// "flying" from a top-down view. Each valkyrie gets a random phase so a party
// of them doesn't bob in lock-step.
const VALK_FLIGHT_LIFT   = 8     // px the sprite floats above its feet anchor
const VALK_FLIGHT_BOB    = 3     // px amplitude of the slow up/down bob
const VALK_FLIGHT_BOB_MS = 1100  // ms per half-bob (drives the sine frequency)
// Anims using the separate _atk texture (192×192 frames). When playing one of
// these, the sprite swaps to the atk texture and adjusts origin so the
// character body's foot stays at the same world position.
const ATK_ANIMS = new Set(['slash', 'thrust'])
// Anims that render from the 128×128 CARRY texture (_walk128) for oversize-walk
// weapons — their blade/shaft can't fit the 64px base walk row, so the carry
// sheet (body + full-size weapon) is used for walking/standing/running. Weapons
// that need it (their LPC walk is a `walk_128` animation).
//   • Dragon/Long spear + Trident: long polearm shafts.
//   • Scimitar + Katana: their LPC art is walk_128-ONLY (no standard 64px walk
//     layer at all), so without the carry sheet the blade never composites into
//     the base walk/idle/run rows — the sprite walks with an INVISIBLE sword
//     (only the slash _atk sheet shows the blade). MUST stay in sync with the
//     same set in AdventurerAtkLoader.js + bake-weapons.cjs.
const CARRY_WALK_ANIMS = new Set(['walk', 'idle', 'run'])
const CARRY_WALK_WEAPONS = new Set(['Dragon spear', 'Long spear', 'Trident', 'Scimitar', 'Katana'])
// LPC attack-anim names that minion sheets + boss-archetype sheets have
// no dedicated frames for (those sheets ship a single `attack` state).
// _resolveLpcAnimKey collapses every one of these onto `attack`.
const SHEET_ATTACK_ANIMS = new Set(['slash', 'thrust', 'shoot', 'spellcast'])
// Body sprite origin: foot at y = 0.85 of 64 = 54.4px. In the 192×192 atk
// frame the body is centered (top=64), so the foot sits at y = 64 + 54.4 =
// 118.4px → origin y = 118.4 / 192 ≈ 0.617. Keeps the character's foot at the
// same world position when swapping textures.
const LPC_BODY_ORIGIN_Y = 0.85
const LPC_ATK_ORIGIN_Y  = 0.617
// 128×128 carry frame: body centered at top=32, foot at 32 + 54.4 = 86.4px →
// origin y = 86.4 / 128 = 0.675. Keeps the foot at the same world position.
const LPC_CARRY_ORIGIN_Y = 0.675
// Light Party travel formation — render-only sub-tile offsets (px) so the four
// members walk side-by-side / front-and-back instead of stacking on one tile.
// tank leads, melee on the left flank, ranged on the right, healer trails.
const LP_TRAVEL_FORMATION = { tank: [0, -20], meleeDps: [-28, 10], rangedDps: [28, 10], healer: [0, 32] }
// Light Party classes use a single hand-authored ULPC costume (v01) for EVERY
// spawn — the FFXIV "Warriors of Light" look — instead of rolling a random
// v01–v50 generic variant. Pinning here (not deleting the other variants) keeps
// the atk-sheet + manifest plumbing intact while guaranteeing the iconic look.
const LP_FIXED_VARIANT_CLASSES = new Set(['paladin', 'white_mage', 'black_mage', 'samurai'])
// Weapons that should always render combat as `thrust`, regardless of the
// class's default animation. Spear/Cane only have thrust frames; staves and
// the Crossbow have a thrust_oversize that looks more dynamic than the static
// spellcast/shoot poses, and ensures the weapon is actually visible mid-attack.
const THRUST_ANIM_WEAPONS = new Set([
  'Spear', 'Cane', 'Crossbow',
  'Simple staff', 'Diamond staff', 'S staff', 'Loop staff', 'Gnarled staff',
  // Peasant hand tool (LPC "Thrust" tool: hoe / shovel / watering can) — its
  // only attack art is the `thrust` (jab) pose, so always thrust with it.
  'Thrust',
  // Valkyrie polearms — Dragon/Long spear ship ONLY a thrust_oversize attack
  // (no slash art), so the class-default slash leaves the spear invisible
  // mid-swing. Force thrust so the baked _atk thrust row actually renders.
  'Dragon spear', 'Long spear',
])
// Weapons that should override the class default to `slash`. Necromancers play
// spellcast by default, but a Scythe has only slash_oversize layers — without
// this override the scythe never appears mid-attack.
const SLASH_ANIM_WEAPONS = new Set(['Scythe'])
// Bows / thrown weapons override the class default to `shoot`. Non-archer
// classes can roll a bow from a chaos pool (e.g. the Cosplay Adventurer); their
// default slash leaves the bow swinging at empty air (the bow only ships `shoot`
// art). `shoot` renders from the base sheet's shoot row, where the bow + its
// nocked Arrow are already baked. (Rangers/bards already shoot via class default.)
const SHOOT_ANIM_WEAPONS = new Set(['Normal', 'Great', 'Recurve', 'Slingshot'])
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
    // Solo Leveling — fade Jinwoo out as he steps into his portal (win outro).
    EventBus.on('SHADOW_MONARCH_FADE', this._onMonarchFade, this)
    // Myconid Corpse Bloom — when a fungal corpse sprouts a Vinekin, take
    // down the dead-adv body sprite that's been parked on the death tile
    // since ADVENTURER_DIED. The Vinekin replaces it as the room occupant.
    EventBus.on('MYCONID_CORPSE_SPROUTED', this._onMyconidSprouted, this)
    // Stagger fade-in so a party of N spawns one-by-one through the door
    // instead of all popping in at once. _spawnQueueNextAt tracks the next
    // free slot in scene-time ms; each new adv starts fading at that time.
    this._spawnQueueNextAt = 0
    this._spawnQueueCount  = 0   // wave entry index — drives stagger ramp
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
    // A floating key icon that follows any adventurer holding a door key
    // (adv.keys, an array of lock ids) until they spend it on a lock. Driven by
    // polling adv.keys in update() — created on pickup, removed the instant the
    // key is consumed, the adv dies/flees, or night resets. id → Phaser.Image.
    this._keyIcons = {}
    // Nerve mood pip (AI overhaul) — a small colour-coded morale dot above each
    // adventurer's head, band-coloured (bold→breaking). id → Phaser.Arc. Visibility
    // is gated by window.__qfMoodPips ('always'|'off'|'hover'); default 'always' so
    // the spine is visible in preview. Body-language PACE tells live in AISystem and
    // are always on — turning pips 'off' is the "body-language-only" prototype.
    this._moodPips = {}
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
    for (const k of Object.values(this._keyIcons ?? {})) k?.destroy?.()
    this._keyIcons = {}
    for (const p of Object.values(this._moodPips ?? {})) p?.destroy?.()
    this._moodPips = {}
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
    const FADE_MS = 600
    // Stagger gap COMPRESSES as the wave grows (2026-05-27). A fixed
    // 700ms gap meant a 50-strong late-game wave took ~35s just to walk
    // in. Now the first few keep a readable trickle, then the gap ramps
    // down to a floor so big waves pour in fast. _spawnQueueCount tracks
    // the wave's entry index (reset with _spawnQueueNextAt in _clearAll).
    const idx = this._spawnQueueCount ?? 0
    this._spawnQueueCount = idx + 1
    const STAGGER_MS = idx < 5  ? 350    // first 5 — visible one-by-one
                     : idx < 12 ? 200    // next chunk — brisk
                     :            90     // the rest — rapid-fire floor
    const start = Math.max(now, this._spawnQueueNextAt)
    adventurer._spawnFadeStart = start
    adventurer._spawnFadeEnd   = start + FADE_MS
    this._spawnQueueNextAt     = start + STAGGER_MS

    // Snap to the geometric center of the doorway opening of the entry
    // hall this adventurer spawned at (the 2-tile-wide × WALL_THICKNESS-
    // tile-tall door rect). With multiple entry halls each adventurer
    // snaps to whichever one they were spawned at, so a wave visibly
    // pours out of every doorway it used.
    //
    // Exception: spawn-in-place advs (Loot Goblin Heist drops a pack
    // inside the boss room) keep the position the spawner chose. Without
    // this guard the renderer teleports them back to the entry-hall door
    // immediately after the spawner placed them, breaking the heist.
    const door = adventurer._spawnedInPlace ? null : this._entryDoorWorldCenter(adventurer)
    if (door) {
      adventurer.tileX  = door.tileX
      adventurer.tileY  = door.tileY
      adventurer.worldX = door.worldX
      adventurer.worldY = door.worldY
    }

  }

  // World-space center of the doorway rect of the entry hall `adv` spawned
  // at, wherever the (possibly rotated) entrance ended up. With multiple
  // entry halls the adventurer is snapped to the entry hall nearest their
  // spawn tile — DayPhase already placed them at that entry's doorway.
  // Delegates to the shared rotation-aware helper.
  _entryDoorWorldCenter(adv) {
    const entries = this._gameState?.dungeon?.rooms
      ?.filter(r => r.definitionId === 'entry_hall') ?? []
    if (entries.length === 0) return null
    let best = entries[0], bestD = Infinity
    for (const e of entries) {
      const cx = e.gridX + e.width / 2
      const cy = e.gridY + e.height / 2
      const d  = Math.hypot((adv?.tileX ?? 0) - cx, (adv?.tileY ?? 0) - cy)
      if (d < bestD) { bestD = d; best = e }
    }
    return entryDoorWorldCenter(best)
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

  // Solo Leveling — Jinwoo's portal fade-out (win outro). 1 → 0 over ~700ms
  // from the stamp set by _onMonarchFade.
  _monarchFadeAlpha(s) {
    if (!s || s._fadeOutAt == null) return 1
    const now = this._scene?.time?.now ?? 0
    return Math.max(0, 1 - (now - s._fadeOutAt) / 700)
  }

  _onCombatHit({ sourceId, targetId }) {
    const adv = this._gameState.adventurers?.active?.find(a => a.instanceId === sourceId)
    if (!adv) return
    const s = this._sprites[adv.instanceId]
    if (!s?.lpc) return

    // Cheater attack VFX — fire a glitchy magenta particle burst at
    // both the attacker and the target so the swing reads as a hack
    // pulse, not a normal slash. Uses the cheater's rolled aura hue
    // for the attacker-side burst (consistency with the body tint)
    // and a fixed magenta on the target. Plus a brief horizontal
    // sprite-jitter "screen tear" on the cheater themselves — the
    // sprite snaps a few pixels left/right over ~120ms then settles.
    // Banned cheaters skip the burst — their cheats are locked out.
    if (adv.classId === 'cheater' && !adv._banned && targetId) {
      // RGB-cycling burst at the cheater themselves on every swing —
      // matches the ground halo + the floater colors so the visual
      // language is consistent (everything rainbow, all the time).
      rgbParticleBurst(this._scene, adv.worldX, adv.worldY - 12,
        { count: 8, durationMs: 280, speed: 70 })
      const target =
        this._gameState.adventurers?.active?.find(a => a.instanceId === targetId) ??
        this._gameState.minions?.find(m => m.instanceId === targetId) ??
        (this._gameState.boss?.instanceId === targetId ? this._gameState.boss : null)
      if (target && Number.isFinite(target.worldX)) {
        // Second burst at the hit location — slightly denser so the
        // impact reads as the focal point of the swing.
        rgbParticleBurst(this._scene, target.worldX, target.worldY - 8,
          { count: 10, durationMs: 320, speed: 90 })
      }
      // Screen-tear jitter on the cheater sprite. Two short tweens (10ms
      // each direction, then settle) over the container's x offset so it
      // reads as a frame skip / desync. Guarded by _glitchTweening so
      // back-to-back attacks don't stack jitters and leave the sprite
      // permanently offset.
      if (s.container && !s._glitchTweening) {
        s._glitchTweening = true
        const baseX = s.container.x
        const offset = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.floor(Math.random() * 3))
        this._scene.tweens.add({
          targets: s.container,
          x: baseX + offset,
          duration: 40,
          yoyo: true,
          repeat: 1,
          onComplete: () => {
            if (s.container) s.container.x = baseX
            s._glitchTweening = false
          },
        })
      }
    }
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
      else if (SHOOT_ANIM_WEAPONS.has(wpn))  anim = 'shoot'
    }
    const dir = adv._lpcDir ?? 'down'
    const { animKey, originY } = this._resolveLpcAnimKey(s, anim, dir)
    if (!this._scene.anims.exists(animKey)) return
    // Minion-sheet + boss-archetype sprites keep the centered/anchored
    // origin the spawner gave them — the LPC body/atk origin math only
    // applies to true LPC adventurer sheets.
    if (!s.lpc.isMinionSheet && !s.lpc.bossSheet && s.lpc.image.originY !== originY) {
      s.lpc.image.setOrigin(0.5, originY)
    }
    s.lpc.image.anims.play(animKey, true)
    // Force the per-tick guard to re-pick on the next idle/walk transition.
    s.lpc.lastAnim = animKey
  }

  // Resolve the (animKey, originY) pair for a desired anim+dir, switching to
  // the `_atk` texture for slash/thrust when one is registered for this
  // variant. Falls back to the main texture (and main origin) otherwise.
  _resolveLpcAnimKey(s, anim, dir) {
    // Minion sheets (zombie horde, rival-dungeon monsters, loot goblins)
    // and boss-archetype sheets (Rival Dungeon boss) only ship idle/walk/
    // run/attack/hurt/death states — there's no slash/thrust/shoot/
    // spellcast and no separate `_atk` texture. Collapse every LPC attack
    // variant onto the single `attack` state so they visibly swing.
    if (s.lpc.bossSheet || s.lpc.isMinionSheet) {
      const mapped = SHEET_ATTACK_ANIMS.has(anim) ? 'attack' : anim
      const targetDir = anim === 'hurt' ? 'down' : dir
      return {
        animKey: `${s.lpc.textureKey}-${mapped}-${targetDir}`,
        originY: LPC_BODY_ORIGIN_Y,
      }
    }
    // Lazily upgrade to the `_atk` texture once it streams in. The atk load is
    // 3s-delayed + throttled (see AdventurerAtkLoader), so a sprite created
    // before its sheet lands gets atkTextureKey=null at creation. Without this
    // re-check it would stay stuck on the shrunk 64px slash/thrust forever —
    // most visible on Jinwoo, who spawns mid-run via the event (after the title
    // screen) and whose 64px slash row is weaponless (Scimitar swing is
    // oversize-only). Resolving here means the next swing uses the atk sheet.
    if (!s.lpc.atkTextureKey && ATK_ANIMS.has(anim)) {
      const atkKey = `${s.lpc.textureKey}-atk`
      if (this._scene.textures.exists(atkKey)) s.lpc.atkTextureKey = atkKey
    }
    const targetDir = anim === 'hurt' ? 'down' : dir
    // Oversize CARRY (dragon/long spear walk): walk/idle/run render from the
    // 128px _walk128 sheet (the carry sheet only ships a `walk` block, so idle
    // uses its idle 1-frame and run reuses walk). Lazily upgrade if it streams
    // in late, like the atk texture.
    if (s.lpc.carryTextureKey === undefined && CARRY_WALK_ANIMS.has(anim)) {
      const cKey = `${s.lpc.textureKey}-walk128`
      s.lpc.carryTextureKey = this._scene.textures.exists(cKey) ? cKey : null
    }
    if (CARRY_WALK_ANIMS.has(anim) && s.lpc.carryTextureKey) {
      const carryAnim = anim === 'run' ? 'walk' : anim // run reuses the walk cycle
      return {
        animKey: `${s.lpc.carryTextureKey}-${carryAnim}-${targetDir}`,
        originY: LPC_CARRY_ORIGIN_Y,
      }
    }
    const useAtk = ATK_ANIMS.has(anim) && s.lpc.atkTextureKey
    const baseKey = useAtk ? s.lpc.atkTextureKey : s.lpc.textureKey
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

    // Camera world-view bounds (with margin) for off-screen culling.
    // Computed once per frame and reused for every adv. Margin keeps advs
    // near the edge fully updated so chat bubbles / name labels don't pop
    // as the camera scrolls into them. Followed adv ALWAYS passes the
    // cull (camera is centred on them by definition).
    const cam = this._scene.cameras?.main
    const CULL_MARGIN = 200
    const camLeft   = cam ? (cam.worldView.x - CULL_MARGIN) : -Infinity
    const camRight  = cam ? (cam.worldView.x + cam.worldView.width + CULL_MARGIN) : Infinity
    const camTop    = cam ? (cam.worldView.y - CULL_MARGIN) : -Infinity
    const camBottom = cam ? (cam.worldView.y + cam.worldView.height + CULL_MARGIN) : Infinity

    // LOD (level of detail) — when zoomed far enough out that HP bars /
    // badges / sprite animation frames are visually subpixel anyway,
    // skip the per-tick work that draws them. Sprite stays positioned
    // so the silhouette is still on screen; player can see WHERE all
    // the entities are without paying for HOW detailed each looks.
    // Threshold 0.5 means anything ≤ half-zoom triggers LOD (default
    // zoom is 1.0; zoom-min is 0.25 per Balance).
    const camZoom = cam?.zoom ?? 1
    const lod = camZoom < 0.5
    // First frame after exiting LOD: invalidate every sprite's change-
    // detection markers so the full per-tick body re-renders badges +
    // HP bar state at full detail. Without this, a stable adv (no fear
    // change, no HP change) would stay hidden until the next state flip.
    if (this._lastLod && !lod) {
      for (const id in this._sprites) {
        const s = this._sprites[id]
        if (!s) continue
        s._lastFear = null
        s._lastVenomStacks = null
        s._lastBlight = null
        s._lastHpFrac = null
      }
    }
    this._lastLod = lod

    for (const adv of active) {
      seen.add(adv.instanceId)
      let s = this._sprites[adv.instanceId]
      if (!s) s = this._createSprite(adv)
      // On-demand LPC upgrade — the sprite was created as the procedural circle
      // because its base sheet hadn't streamed in yet. The instant the sheet (+
      // its anims, registered by AdventurerBaseLoader before this tick) lands,
      // drop the circle and rebuild as the real LPC sprite.
      else if (s._lpcPending && this._scene.textures.exists(s._lpcPending)) {
        this._destroySprite(adv.instanceId)
        s = this._createSprite(adv)
      }
      // Off-screen cull — hide the container, hide any side-attached
      // labels (gold-carrier tag), and skip every per-tick state
      // update (LPC anim, HP bar, badge re-render, fear/venom/blight
      // recompute, doorway shadow lookup, etc.). When the adv comes
      // back into view next frame the full pipeline re-runs and state
      // catches up — one frame of stale rendering is acceptable for
      // entities the player isn't looking at. Huge win at high adv
      // counts when the camera is zoomed in on a fight.
      const offScreen = adv.worldX < camLeft || adv.worldX > camRight ||
                        adv.worldY < camTop  || adv.worldY > camBottom
      if (offScreen) {
        if (s.container && s.container.visible) s.container.setVisible(false)
        const cullTag = this._carrierLabels?.[adv.instanceId]
        if (cullTag && cullTag.visible) cullTag.setVisible(false)
        const cullPip = this._moodPips?.[adv.instanceId]
        if (cullPip && cullPip.visible) cullPip.setVisible(false)
        continue
      }
      // Miner Tunnel — while burrowed underground (between digging hole A and
      // surfacing at hole B) hide the sprite entirely, so the cross-dungeon
      // relocation never reads as a slide across the floor.
      if (adv._underground) {
        if (s.container?.visible) s.container.setVisible(false)
        const ugTag = this._carrierLabels?.[adv.instanceId]
        if (ugTag?.visible) ugTag.setVisible(false)
        const ugPip = this._moodPips?.[adv.instanceId]
        if (ugPip?.visible) ugPip.setVisible(false)
        continue
      }
      if (s.container && !s.container.visible) s.container.setVisible(true)
      // Solo Leveling — pulse Jinwoo's violet flame-aura glow while on-screen.
      if (s.shadowGlow) s.shadowGlow.setAlpha(0.16 + 0.20 * Math.sin(this._scene.time.now / 320))
      // Marked-threat aura (Aldric / a Kingdom-Response champion) — pulse the
      // body glow alpha + the ground ring (alpha + a slight scale breathe). Strong
      // values so it's clearly visible, not a faint shimmer.
      if (s.threatGlow || s.threatRing) {
        const p = 0.5 + 0.5 * Math.sin(this._scene.time.now / 360)   // 0..1
        if (s.threatGlow) s.threatGlow.setAlpha(0.32 + 0.46 * p)      // 0.32–0.78
        if (s.threatRing) { s.threatRing.setAlpha(0.55 + 0.4 * p); s.threatRing.setScale(1 + 0.07 * p) }
      }
      // Jinwoo's OWN flame cycles a blue↔black vertical gradient (RGB-style
      // colour shift via a 4-corner tint that lerps over time). His shadow
      // minions keep their plain flame — that's rendered by MinionRenderer and
      // untouched here.
      if (s.shadowFlame) {
        const k   = (Math.sin(this._scene.time.now / 650) + 1) / 2   // 0..1 cycle
        // Jinwoo runs a UNIQUELY bluer variant than his shadow minions: even
        // the darkest corner stays a clear deep-blue (no near-black), and the
        // top sweeps up to a bright sky-blue so the colour reads strongly.
        const top = _lerpHex(0x2a72e6, 0x86d0ff, k)   // bright-blue → sky-blue
        const bot = _lerpHex(0x0a2a6b, 0x2e7bff, k)   // deep-blue → bright-blue
        s.shadowFlame.setTint(top, top, bot, bot)
      }
      // Phase D — keep the gold-coins icon glued above the adv carrying
      // stolen treasure. Sits just above the HP bar (y - 42) — chat
      // bubbles anchor higher (y - 30 extending up) so they don't clash.
      const tag = this._carrierLabels?.[adv.instanceId]
      if (tag) { tag.setPosition(adv.worldX, adv.worldY - 42); if (!tag.visible) tag.setVisible(true) }
      // Floating key over a key-holder's head until they spend it. Sits above
      // the gold-coins carrier (y-52 vs y-42) so an adv carrying both shows both,
      // with a gentle bob so it reads as a held, floating key. Polls adv.keys so
      // it vanishes the same frame the key is consumed in _tryUnlockTile.
      const hasKey = (adv.keys?.length ?? 0) > 0
      let kic = this._keyIcons[adv.instanceId]
      if (hasKey && !kic && this._scene.textures.exists('item-key')) {
        kic = this._scene.add.image(adv.worldX, adv.worldY - 52, 'item-key')
          .setOrigin(0.5, 1).setDepth(41).setScale(1.4)
        this._keyIcons[adv.instanceId] = kic
      }
      if (kic) {
        if (hasKey) {
          const bob = Math.sin(this._scene.time.now / 240) * 3
          kic.setPosition(adv.worldX, adv.worldY - 52 + bob)
          if (!kic.visible) kic.setVisible(true)
        } else {
          kic.destroy(); delete this._keyIcons[adv.instanceId]
        }
      }
      // Nerve mood pip — band-coloured dot at the upper-left of the head.
      this._updateMoodPip(adv)
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
      // Light Party cinematic duel — the whole party squares up on the throne to
      // the north. Force boss-facing EVERY frame (overriding the lunge/recoil
      // velocity above) so no member ever turns their back mid-fight. The boss
      // sits at smaller worldY, so this resolves to 'up' for all four slots.
      if (adv._lpInDuel && boss && boss.worldX !== undefined) {
        adv._lpcDir = _dirFromVelocity(boss.worldX - adv.worldX, boss.worldY - adv.worldY)
      }
      // Aldric — the climax duel. Always face his opponent (the boss) so the
      // swordsman reads as engaged through every dash, clash, and knockback
      // (boss-facing while shoved back = backpedaling, which reads correctly).
      if (adv._nemDuel && boss && boss.worldX !== undefined) {
        adv._lpcDir = _dirFromVelocity(boss.worldX - adv.worldX, boss.worldY - adv.worldY)
      }
      // Stationary-entity gate — same pattern as MinionRenderer. Many
      // advs sit at the same tile while fighting / healing / talking;
      // skipping setPosition + setDepth when world coords haven't
      // changed cuts the display-list churn that's part of the
      // ~30ms/frame untracked Phaser overhead.
      // Light Party travel formation — fan the four out by a small render-only
      // offset so they never stack on one tile while walking the dungeon (tank
      // front, melee left, ranged right, healer back). Purely visual: the AI
      // tile/world position is untouched. Skipped at the throne, where they're
      // no longer 'walking' (BossSystem owns their positions during the duel).
      let drawX = adv.worldX, drawY = adv.worldY
      if (adv._lightParty && adv.aiState === 'walking' && adv.goal?.type !== 'AT_BOSS') {
        const o = LP_TRAVEL_FORMATION[adv._lightPartyRole]
        if (o) { drawX += o[0]; drawY += o[1] }
      }
      if (s._lastSetX !== drawX || s._lastSetY !== drawY) {
        s.container.setPosition(drawX, drawY)
        // Y-sort against the boss + minions: larger worldY draws on top.
        s.container.setDepth(7 + drawY * 0.0005)
        s._lastSetX = drawX
        s._lastSetY = drawY
      }
      // LOD fast-path: at low zoom, skip HP bar / badge / anim work and
      // hide the cosmetic overlay objects (sub-pixel at this scale
      // anyway). Sprite container stays positioned so the entity is
      // visible in the overview. State re-renders next non-LOD tick.
      if (lod) {
        if (s.hp?.visible)         s.hp.setVisible(false)
        if (s.hpBg?.visible)       s.hpBg.setVisible(false)
        if (s.lvLabel?.visible)    s.lvLabel.setVisible(false)
        if (s.fearBg?.visible)     s.fearBg.setVisible(false)
        if (s.fearFill?.visible)   s.fearFill.setVisible(false)
        if (s.venomBadge?.visible) s.venomBadge.setVisible(false)
        if (s.blightBadge?.visible) s.blightBadge.setVisible(false)
        if (s.bubble?.visible)     s.bubble.setVisible(false)
        if (s.bubbleLabel?.visible) s.bubbleLabel.setVisible(false)
        if (s.veteranBadge?.visible) s.veteranBadge.setVisible(false)
        if (s.markedBadge?.visible) s.markedBadge.setVisible(false)
        // Spawn-fade alpha STILL applies in LOD so entries don't pop.
        const _spawnA_lod = this._spawnAlpha(adv)
        const _leaveA_lod = this._leaveAlpha(adv)
        if (s.container) s.container.setAlpha(Math.min(_spawnA_lod, _leaveA_lod) * this._monarchFadeAlpha(s))
        continue
      }
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
      if (s.flightShadow) this._tickValkyrieFlight(s)

      // Spawn fade-in / leave fade-out: the smaller of the two alphas
      // wins (so an adv re-leaving while still spawning would still
      // fade out). Container alpha covers the sprite, HP bar, labels.
      // Invisibility (Rogue) takes precedence — when invisible the
      // alpha override is already 0.15, applied directly to the LPC
      // sprite below.
      const spawnA = this._spawnAlpha(adv)
      const leaveA = this._leaveAlpha(adv)
      const fadeA  = Math.min(spawnA, leaveA) * this._monarchFadeAlpha(s)
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

      // Cheater RGB-cycle tint — every cheater's sprite hue rotates
      // through the full spectrum (red→yellow→green→cyan→blue→
      // magenta→red) over ~6 s. Channels are sine waves 120° apart
      // (same math as cheaterVfx._rgbAt) so all three peak at
      // different phases and the result is always saturated.
      // Phase-offset by the adv's spawn tile so a pack of cheaters
      // doesn't strobe in lockstep. Suppressed when venom or blight
      // is active (those tints carry urgent gameplay info) and when
      // banned (the modded client is locked out — they look normal
      // while fleeing).
      //
      // Replaced the older per-cheater-hue + persistent ground halo
      // — the sprite itself now carries the entire RGB read, which
      // makes the cheater pop just as hard at the cluttered tile
      // level without an extra ground ellipse to clean up.
      if (adv.classId === 'cheater' && !adv._banned) {
        if (stacks === 0 && !blighted && s.lpc?.image?.setTint) {
          const t = (this._scene.time.now ?? 0) * 0.001
          const phase = (adv.spawnTileX ?? 0) * 0.7
          const r = Math.max(0, Math.min(255, Math.round(127 + 127 * Math.sin(t + phase))))
          const g = Math.max(0, Math.min(255, Math.round(127 + 127 * Math.sin(t + phase + 2.094))))
          const b = Math.max(0, Math.min(255, Math.round(127 + 127 * Math.sin(t + phase + 4.188))))
          s.lpc.image.setTint((r << 16) | (g << 8) | b)
        }
      } else if (adv.classId === 'cheater' && adv._banned) {
        // Banned cheater — modded client is locked out, tint clears.
        if (s.lpc?.image?.clearTint) s.lpc.image.clearTint()
      }

      // Beholder PETRIFY — while petrified (Tyrant's Glare), the hero is turned to
      // STONE: desaturate the sprite to true grayscale via a ColorMatrix postFX, and
      // revert the instant the petrify ends. Added/removed once per state change
      // (tracked on the sprite) so it doesn't re-stack every frame.
      {
        const pImg = s.lpc?.image ?? s.builder?.image
        const petrified = (adv._petrifiedUntil ?? 0) > (this._scene.time.now ?? 0)
        if (pImg && pImg.postFX) {
          if (petrified && !s._petrifyFx) {
            try {
              const cm = pImg.postFX.addColorMatrix()
              // grayscale (replace), then darken slightly to read as stone (multiply=true
              // so it STACKS onto the grayscale rather than resetting the matrix).
              if (cm) { cm.grayscale(1); if (cm.brightness) cm.brightness(0.78, true) }
              s._petrifyFx = cm ?? true
            } catch (e) { s._petrifyFx = null }
          } else if (!petrified && s._petrifyFx) {
            try { if (s._petrifyFx !== true) pImg.postFX.remove(s._petrifyFx); else pImg.postFX.clear() } catch (e) {}
            s._petrifyFx = null
          }
        }
      }

      // Slime PLAGUE — while infected (`_infectUntil`), the hero is visibly ROTTING:
      // a faint sickly-green glow on the sprite + a low-cadence rising sick-spore
      // puff, so the player reads who's poisoned at a glance (parallel to the Gnoll
      // bleed-aura). Cleared the instant the infection lapses.
      {
        const pImg = s.lpc?.image ?? s.builder?.image
        const now = this._scene.time.now ?? 0
        const infected = (adv._infectUntil ?? 0) > now
        if (pImg && pImg.postFX && this._scene.renderer?.type === Phaser.WEBGL) {
          if (infected && !s._plagueFx) { try { s._plagueFx = pImg.postFX.addGlow(0x88cc33, 2.4, 0, false, 0.05, 6) } catch (e) { s._plagueFx = null } }
          else if (!infected && s._plagueFx) { try { if (s._plagueFx !== true) pImg.postFX.remove(s._plagueFx) } catch (e) {} s._plagueFx = null }
        }
        if (infected && Number.isFinite(adv.worldX) && now - (s._plagueAuraAt ?? 0) >= 700) {
          s._plagueAuraAt = now
          AbilityVfx.plagueAuraFx?.(this._scene, adv.worldX, adv.worldY)
        }
      }

      // Lizardman THE PLAGUE-BEARER — carriers glow sickly-PURPLE, DEEPENING with
      // their plague-stack count (you can watch the infection worsen + spread).
      {
        const pImg = s.lpc?.image ?? s.builder?.image
        const now = this._scene.time.now ?? 0
        const pstacks = adv._plagueStacks ?? 0
        if (pImg && pImg.postFX && this._scene.renderer?.type === Phaser.WEBGL) {
          if (pstacks > 0) {
            const str = Math.min(5, 1.6 + pstacks * 0.5)
            if (!s._lzPlagueFx) { try { s._lzPlagueFx = pImg.postFX.addGlow(0xb45ce6, str, 0, false, 0.05, 7) } catch (e) { s._lzPlagueFx = null } }
            else if (s._lzPlagueFx !== true) { try { s._lzPlagueFx.outerStrength = str } catch (e) {} }
          } else if (s._lzPlagueFx) { try { if (s._lzPlagueFx !== true) pImg.postFX.remove(s._lzPlagueFx) } catch (e) {} s._lzPlagueFx = null }
        }
        if (pstacks > 0 && Number.isFinite(adv.worldX) && now - (s._lzPlagueAuraAt ?? 0) >= 800) {
          s._lzPlagueAuraAt = now
          AbilityVfx.plagueAuraFx?.(this._scene, adv.worldX, adv.worldY, { green: 0xa83ce0, purple: 0xd9a6ff })
        }
      }

      // Vampire THE BLOOD SOVEREIGN — a CHARMED hero (joining the Court) glows
      // crimson with a slow pulse + drifting heart-motes, so you can watch the
      // Court form before each thrall conversion.
      {
        const cImg = s.lpc?.image ?? s.builder?.image
        const now = this._scene.time.now ?? 0
        const charmed = !!adv._charmed
        if (cImg && cImg.postFX && this._scene.renderer?.type === Phaser.WEBGL) {
          if (charmed) {
            const str = 2.2 + 0.8 * Math.sin(now / 220)
            if (!s._vampCharmFx) { try { s._vampCharmFx = cImg.postFX.addGlow(0xff2a52, str, 0, false, 0.06, 8) } catch (e) { s._vampCharmFx = null } }
            else if (s._vampCharmFx !== true) { try { s._vampCharmFx.outerStrength = str } catch (e) {} }
          } else if (s._vampCharmFx) { try { if (s._vampCharmFx !== true) cImg.postFX.remove(s._vampCharmFx) } catch (e) {} s._vampCharmFx = null }
        }
        if (charmed && Number.isFinite(adv.worldX) && now - (s._vampCharmMoteAt ?? 0) >= 900) {
          s._vampCharmMoteAt = now
          AbilityVfx.charmBindFx?.(this._scene, adv.worldX, (adv.worldY ?? 0) - 16, { mote: true })
        }
      }

      // Zombie ROT — while rot-infected (`_rotInfectedUntil`), the hero is a walking
      // CORPSE-in-waiting (it rises as YOUR zombie if it dies). Distinct from the
      // slime's bright-green glow: an ASHEN necrotic pallor (partial desaturate + dim
      // via ColorMatrix, state-tracked like petrify), a "DOOMED" skull pip bobbing
      // over the head, and a low-cadence fly/rot waft.
      {
        const pImg = s.lpc?.image ?? s.builder?.image
        const now = this._scene.time.now ?? 0
        const rotting = (adv._rotInfectedUntil ?? 0) > now && (adv.resources?.hp ?? 0) > 0
        if (pImg && pImg.postFX) {
          if (rotting && !s._rotFx) {
            try { const cm = pImg.postFX.addColorMatrix(); if (cm) { cm.saturate(-0.55, true); if (cm.brightness) cm.brightness(0.82, true) } s._rotFx = cm ?? true } catch (e) { s._rotFx = null }
          } else if (!rotting && s._rotFx) {
            try { if (s._rotFx !== true) pImg.postFX.remove(s._rotFx) } catch (e) {}
            s._rotFx = null
          }
        }
        if (rotting && Number.isFinite(adv.worldX)) {
          if (!s._doomPip) { try { s._doomPip = this._scene.add.image(adv.worldX, adv.worldY - 38, 'doom-skull').setDepth(60).setScale(0.09) } catch (e) { s._doomPip = null } }
          if (s._doomPip) { s._doomPip.setPosition(adv.worldX, adv.worldY - 38 + Math.sin(now / 260) * 1.2).setAlpha(0.85 + 0.15 * Math.sin(now / 180)) }
        } else if (s._doomPip) { try { s._doomPip.destroy() } catch (e) {} s._doomPip = null }
        if (rotting && Number.isFinite(adv.worldX) && now - (s._rotAuraAt ?? 0) >= 620) {
          s._rotAuraAt = now
          AbilityVfx.rotAuraFx?.(this._scene, adv.worldX, adv.worldY)
        }
      }

      // Plant ENTANGLE root — while ROOTED (`_rootedUntil`), vines GRIP the hero's legs
      // the whole time (a held snare that subtly tightens/struggles), so the player reads
      // WHY the hero is stuck — not just the one-shot entangle whip. Mirrors the doom-pip.
      {
        const now = this._scene.time.now ?? 0
        const rooted = (adv._rootedUntil ?? 0) > now && (adv.resources?.hp ?? 0) > 0
        if (rooted && Number.isFinite(adv.worldX)) {
          if (!s._rootVines) { try { s._rootVines = this._scene.add.image(adv.worldX, adv.worldY, AbilityVfx.rootVineTexture(this._scene)).setDepth(58).setScale(0.95) } catch (e) { s._rootVines = null } }
          if (s._rootVines) { s._rootVines.setPosition(adv.worldX, adv.worldY - 4).setScale(0.92 + 0.07 * Math.sin(now / 170), 0.95 + 0.05 * Math.sin(now / 150)).setRotation(0.05 * Math.sin(now / 320)) }
        } else if (s._rootVines) { try { s._rootVines.destroy() } catch (e) {} s._rootVines = null }
      }

      // Mushroom DAZE — while dazed (`_dazedUntil`), the hero is HALLUCINATING (whiffs
      // its attacks): a faint purple "swim" Glow wavering on the sprite + a persistent
      // dizzy-spiral/spore-mote tell re-fired over the head on a cadence, so the miss-
      // window reads the WHOLE time — not just the one-shot daze puff.
      {
        const pImg = s.lpc?.image ?? s.builder?.image
        const now = this._scene.time.now ?? 0
        const dazed = (adv._dazedUntil ?? 0) > now && (adv.resources?.hp ?? 0) > 0
        if (pImg && pImg.postFX && this._scene.renderer?.type === Phaser.WEBGL) {
          if (dazed) {
            const str = 1.5 + 1.0 * Math.sin(now / 240)   // the "swim"
            if (!s._dazeFx) { try { s._dazeFx = pImg.postFX.addGlow(0x9966cc, str, 0, false, 0.06, 6) } catch (e) { s._dazeFx = null } }
            else if (s._dazeFx !== true) s._dazeFx.outerStrength = str
          } else if (s._dazeFx) { try { if (s._dazeFx !== true) pImg.postFX.remove(s._dazeFx) } catch (e) {} s._dazeFx = null }
        }
        if (dazed && Number.isFinite(adv.worldX) && now - (s._dazeAuraAt ?? 0) >= 780) {
          s._dazeAuraAt = now
          AbilityVfx.dazeFx?.(this._scene, adv.worldX, adv.worldY)
        }
      }

      // Demon HELLFIRE heat — a hero standing in the Burning Aura visibly HEATS UP: a
      // Glow that intensifies with the Hellfire stack + rising heat-shimmer that gets
      // brighter/faster (white-hot) as it nears max → so the player reads WHO's about to
      // COMBUST. Distinct from slime green-plague / zombie ashen rot. Cools when it leaves.
      {
        const pImg = s.lpc?.image ?? s.builder?.image
        const now = this._scene.time.now ?? 0
        const stacks = adv._hellfireStacks ?? 0
        const maxS = Math.max(1, adv._hellfireMax ?? 6)
        const k = Math.max(0, Math.min(1, stacks / maxS))
        const hot = stacks > 0 && (adv.resources?.hp ?? 0) > 0
        if (pImg && pImg.postFX && this._scene.renderer?.type === Phaser.WEBGL) {
          if (hot) {
            if (!s._heatFx) { try { s._heatFx = pImg.postFX.addGlow(0xff5a1e, 2 + k * 4, 0, false, 0.05, 8) } catch (e) { s._heatFx = null } }
            else if (s._heatFx !== true) { s._heatFx.outerStrength = 2 + k * 4 }
          } else if (s._heatFx) {
            try { if (s._heatFx !== true) pImg.postFX.remove(s._heatFx) } catch (e) {}
            s._heatFx = null
          }
        }
        if (hot && Number.isFinite(adv.worldX) && now - (s._heatShimAt ?? 0) >= (520 - k * 300)) {
          s._heatShimAt = now
          AbilityVfx.heatShimmerFx?.(this._scene, adv.worldX, adv.worldY - 4, { k })
        }
      }
    }

    // Clean up sprites whose adventurers are no longer active. Corpses (dead
    // sprites) stay parked at their death position until NIGHT_PHASE_STARTED.
    //
    // Zombie reanimation crossfade — a rot-infected hero's corpse DISSOLVES as a
    // Risen zombie fades in over it (MinionRenderer). The graveyard entry carries
    // `_reanimFadeOutFrom`; ramp the corpse alpha 1→0 over the same window, then
    // destroy it. (The corpse left `active` on death, so it's only reachable here.)
    const reanimGraves = {}
    for (const g of (this._gameState.adventurers?.graveyard ?? [])) {
      if (g._reanimFadeOutFrom) reanimGraves[g.instanceId] = g
    }
    const _rnow = this._scene.time.now ?? 0
    for (const id of Object.keys(this._sprites)) {
      const s = this._sprites[id]
      const g = reanimGraves[id]
      if (g) {
        const p = Math.min(1, (_rnow - g._reanimFadeOutFrom) / Math.max(1, g._reanimFadeMs ?? 1))
        s.container?.setAlpha?.(1 - p)
        if (p >= 1) { g._reanimFadeOutFrom = null; this._destroySprite(id) }
        continue
      }
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
  // Valkyrie winged flight — lift the sprite above its grounded shadow and add
  // a slow vertical bob so she reads as hovering, not walking. Called every
  // non-LOD frame for valkyrie sprites (they're the only ones with a
  // flightShadow). The shadow stays planted at its creation Y; only the LPC
  // image's local Y moves, so the sprite↔shadow gap pulses with the bob.
  _tickValkyrieFlight(s) {
    if (!s.lpc?.image || s._flyBaseY == null) return
    const now = this._scene.time?.now ?? 0
    const bob = VALK_FLIGHT_BOB * Math.sin(now / VALK_FLIGHT_BOB_MS + (s._flyPhase ?? 0))
    s.lpc.image.y = s._flyBaseY - VALK_FLIGHT_LIFT + bob
    // Gentle shadow breathing: shrink/fatten the shadow as she rises/falls so
    // the hover feels physical (higher → smaller, tighter shadow).
    if (s.flightShadow) {
      // height above ground (in LIFT units): higher → smaller, fainter shadow.
      const k = (VALK_FLIGHT_LIFT - bob) / VALK_FLIGHT_LIFT // ~0.6 (low) .. 1.4 (high)
      const sc = 1 / Math.max(0.6, k)
      s.flightShadow.setScale(sc, sc)
      s.flightShadow.setAlpha(0.34 * Math.max(0.55, Math.min(1, 2 - k)))
    }
  }

  _tickLpcAnim(s, adv) {
    if (!s.lpc) return
    const dir = adv._lpcDir ?? 'down'
    let anim = 'idle'
    const cls = this._defMap?.[adv.classId]
    const tags = new Set(cls?.tags ?? [])
    // Aldric — the Act IV climax duel. BossSystem._tickNemesisDuel drives his
    // position and pulses `_nemStrikeAt` (a timestamp) at each clash. WALK is the
    // always-looping base (weapon composited, never freezes); a strike plays the
    // one-shot slash/thrust for a short window then falls straight back to walk —
    // so he can never get stranded holding the extended final frame of a swing
    // (the "stuck mid-attack" bug). Facing is set to the boss in the position
    // pass above.
    if (adv._nemDuel && (adv.resources?.hp ?? 0) > 0) {
      const now = this._scene.time?.now ?? 0
      const striking = adv._nemStrikeAt && (now - adv._nemStrikeAt) < (adv._nemStrikeMs ?? 340)
      const dAnim = striking ? (adv._nemStrikeKind === 'thrust' ? 'thrust' : 'slash') : 'walk'
      const { animKey, originY } = this._resolveLpcAnimKey(s, dAnim, dir)
      if (!this._scene.anims.exists(animKey)) return
      const img = s.lpc.image
      if (!s.lpc.isMinionSheet && !s.lpc.bossSheet && img.originY !== originY) img.setOrigin(0.5, originY)
      if (striking) {
        // One-shot attack — (re)start once per strike pulse, identified by its
        // timestamp so a new clash always re-swings.
        if (s._nemStrikePlayed !== adv._nemStrikeAt) {
          img.anims.play(animKey); s.lpc.lastAnim = animKey; s._nemStrikePlayed = adv._nemStrikeAt
        }
      } else if (s.lpc.lastAnim !== animKey) {
        // Looping walk base — restart only on a key change.
        img.anims.play(animKey, true); s.lpc.lastAnim = animKey
      }
      return
    }
    // Light Party cinematic duel — alive members hold a WEAPON-OUT combat pose
    // and re-swing at the boss on a steady cadence. The ULPC *idle* pose draws
    // no weapon/shield (only walk/slash/thrust/spellcast composite the equipped
    // gear), so a stationary duel member would otherwise look unarmed. The swing
    // anims are repeat:0 (they hold their final frame), so we replay every
    // LP_DUEL_SWING_MS for a lively, readable "the party is attacking" loop.
    if (adv._lpInDuel && (adv.resources?.hp ?? 0) > 0) {
      let dAnim = 'slash'
      if (tags.has('spellcaster') || tags.has('healer'))            dAnim = 'spellcast'
      else if (cls?.id === 'ranger' || cls?.id === 'bard')          dAnim = 'shoot'
      else if (cls?.id === 'monk' || cls?.id === 'beast_master')    dAnim = 'thrust'
      const wpn = this._lpcWeaponByVariant[adv.spriteVariant]
      if      (THRUST_ANIM_WEAPONS.has(wpn)) dAnim = 'thrust'
      else if (SLASH_ANIM_WEAPONS.has(wpn))  dAnim = 'slash'
      const { animKey, originY } = this._resolveLpcAnimKey(s, dAnim, dir)
      if (!this._scene.anims.exists(animKey)) return
      const img = s.lpc.image
      const now = this._scene.time?.now ?? 0
      const LP_DUEL_SWING_MS = 900
      const startSwing = () => {
        if (!s.lpc.isMinionSheet && !s.lpc.bossSheet && img.originY !== originY) img.setOrigin(0.5, originY)
        img.anims.play(animKey)         // restart — atk anims are repeat:0
        s.lpc.lastAnim = animKey
        s._lpSwingAt   = now
        s._lpSwinging  = true
        // One attack SFX per visible swing — SfxSystem rate-limits + picks the
        // class sound. Keeps the duel's combat audio in sync with the anim.
        EventBus.emit('LIGHT_PARTY_DUEL_ATTACK', { classId: adv.classId, role: adv._lightPartyRole })
      }
      if (s.lpc.lastAnim !== animKey) {
        // Entering the duel (or a facing change) — swing now, then stagger the
        // NEXT swing by a random phase so the four don't strike in lockstep.
        startSwing()
        s._lpSwingAt = now - Math.random() * LP_DUEL_SWING_MS
      } else if (now - (s._lpSwingAt ?? 0) >= LP_DUEL_SWING_MS) {
        startSwing()
      } else if (s._lpSwinging && !img.anims.isPlaying) {
        // Swing finished — rest on the WIND-UP (frame 0) guard pose, NOT the
        // extended final frame, so the gap between strikes reads as a combat
        // stance instead of a freeze.
        s._lpSwinging = false
        const a = this._scene.anims.get(animKey)
        if (a?.frames?.length) img.anims.setCurrentFrame(a.frames[0])
      }
      return
    }
    if (adv._vfxLabAnim) {
      // VFX Lab override — pin a specific LPC state for animation review.
      anim = adv._vfxLabAnim
    } else if (adv.resources?.hp <= 0) {
      // Minion + boss sheets have a real `death` animation; LPC adventurer
      // sheets fall back to the `hurt` strip as their corpse pose.
      anim = (s.lpc.isMinionSheet || s.lpc.bossSheet) ? 'death' : 'hurt'
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

    // RISE FROM DEATH (generic) — if this sprite was a corpse last frame and the
    // adventurer is alive again now, it just got revived (cleric Resurrection,
    // valkyrie Rally, any future raise). For sheets with a real `death` clip
    // (minion/boss-archetype advs) play it in REVERSE so the body stands back
    // up. LPC adventurer sheets have no death clip (they use the hurt frame as a
    // corpse), so they just resume normally. Detected from the dead→alive
    // transition, so revival code never has to know about the renderer.
    const nowT = this._scene.time?.now ?? 0
    const isDeadNow = (adv.resources?.hp ?? 1) <= 0
    const stillRising = !isDeadNow && s._riseUntil && nowT < s._riseUntil
    if (!isDeadNow && s._wasDead && (s.lpc.isMinionSheet || s.lpc.bossSheet) && !adv._vfxLabAnim) {
      s._wasDead = false
      const { animKey: deathKey } = this._resolveLpcAnimKey(s, 'death', dir)
      if (this._scene.anims.exists(deathKey)) {
        s._riseUntil = nowT + ((this._scene.anims.get(deathKey)?.duration) || 500)
        s.lpc.lastAnim = '__rising__'
        s.lpc.image.anims.playReverse(deathKey)
        return
      }
    }
    s._wasDead = isDeadNow
    if (stillRising) return   // hold the reverse-death rise clip

    if (s.lpc.lastAnim === wantKey) return

    // Let an in-flight attack swing finish before transitioning back to
    // walk/idle. The COMBAT_HIT listener fires off slash/thrust/shoot/
    // spellcast as one-shots; without this guard, the very next update
    // tick clobbers them with the state-machine's preferred anim and
    // the player only ever sees a 1-frame stub. Applies whether the
    // wanted anim is itself an attack (direction jitter mid-swing) or
    // a different state (e.g. charmed advs whose ambient anim is walk).
    // `attack` covers the boss-archetype sheet's one-shot swing.
    const ATTACK_ANIMS = new Set(['slash', 'thrust', 'shoot', 'spellcast', 'attack'])
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
    // Minion-sheet sprites (loot_goblin, horde) and boss-archetype sheets
    // (Rival Dungeon boss) keep the origin the spawner gave them — the LPC
    // body/atk origin math doesn't apply to those frame layouts.
    if (!s.lpc.isMinionSheet && !s.lpc.bossSheet && s.lpc.image.originY !== originY) {
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
    EventBus.off('SHADOW_MONARCH_FADE', this._onMonarchFade, this)
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

    // Outer ring (faction/colour glow). Returning veterans get a bright
    // gold aura instead — wider, brighter, with a hard outline — so they
    // read as veterans at a glance even in a crowded party.
    // Returning survivors AND Infamy-Spike heroes both get the gold
    // hero treatment (ring + badge).
    const isVeteran = !!(adv.flags?.returningVeteran || adv.flags?.hero)
    const ring = this._scene.add.circle(
      0, 0,
      isVeteran ? RADIUS + 6 : RADIUS + 3,
      isVeteran ? 0xffcc44 : adv.classColor,
      isVeteran ? 0.5 : 0.25,
    )
    if (isVeteran) ring.setStrokeStyle(2, 0xffe488, 0.95)
    // Body
    const body = this._scene.add.circle(0, 0, RADIUS, 0x10141c, 1)
    body.setStrokeStyle(2, isVeteran ? 0xffcc44 : adv.classColor, 1)
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

    // Veteran badge — gold star + prior-raid count, shown for returning
    // survivors. Centred above the HP bar (origin 0.5, 0.5 at x=0 = the
    // adventurer's centre); paired with the gold aura ring so a veteran is
    // unmistakable at a glance.
    let veteranBadge = null
    if (isVeteran) {
      // Returning survivors show their prior-run count; a fresh
      // Infamy-Spike hero has none, so the badge is just "★ HERO".
      const runs = adv.flags.runsCompleted
      veteranBadge = this._scene.add.text(0, HP_BAR_Y - 9,
        runs ? `★ HERO ${runs}` : '★ HERO', {
          fontSize: '9px', color: '#ffe488', fontFamily: 'monospace', fontStyle: 'bold',
          stroke: '#3a2a06', strokeThickness: 3,
        }).setOrigin(0.5, 0.5)
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

    // Click to follow. The procedural `body` circle is only the hit
    // target when no LPC/builder sprite is shown — Phaser skips input
    // hit-testing on invisible objects, so when a real sprite replaces
    // `body` (the usual case) the input must be wired onto that sprite
    // too. _wireSpriteInput is called again below for the builder / LPC
    // images.
    this._wireSpriteInput(adv, body)

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
      this._wireSpriteInput(adv, img)
    }

    // LPC sprite — preferred over the procedural circle when a baked variant
    // is available for this adventurer's class. Picks a save-stable variant
    // the first time, then renders + animates from the LPC sheet.
    const lpc = this._buildLpcSprite(adv)
    if (lpc) {
      // LPC sprite is positioned slightly above center so the feet sit on
      // the tile, then origin-anchored at (0.5, 0.85) so the bottom is the
      // movement reference point. Minion-sheet sprites (loot_goblin, zombie
      // horde, rival-dungeon monsters) use a centered origin + a scale that
      // defaults to 1.0 — matching how the same sheets render when worn by
      // an actual minion in the dungeon.
      if (lpc.isMinionSheet) {
        lpc.image.setOrigin(0.5, 0.5)
        lpc.image.setScale(adv._minionSheetScale ?? 1.0)
      } else if (lpc.bossSheet) {
        // Rival Dungeon boss — boss-archetype sprite anchored + scaled to
        // the same footprint as the player's own boss so the throne-room
        // showdown reads as a genuine peer fight.
        lpc.image.setOrigin(0.5, 0.85)
        lpc.image.setScale(lpc.bossScale ?? 2.0)
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
      // Dungeon event: The Saboteur reads as an all-black ninja — dark
      // tint over the rogue LPC sprite.
      if (adv._saboteur) lpc.image.setTint(0x1c1c26)
      this._wireSpriteInput(adv, lpc.image)

      // Valkyrie — winged flight. Plant a small dark ground-shadow ellipse on
      // the tile (behind the sprite) and remember the sprite's resting local
      // Y. _tickValkyrieFlight() then lifts + bobs the sprite above the shadow
      // every frame, so the gap reads as hovering. Phase is per-instance so a
      // squad of valkyries bobs out of sync. (Drawn behind the sprite via
      // addAt(…,0) AFTER the sprite already sits at index 0 → shadow takes
      // index 0, sprite shifts above it.)
      if (adv.classId === 'valkyrie' || adv.spriteVariant?.startsWith('valkyrie/')) {
        const flightShadow = this._scene.add.ellipse(0, 4, RADIUS * 1.5, RADIUS * 0.7, 0x05070c, 0.34)
        c.addAt(flightShadow, 0)
        sprite.flightShadow = flightShadow
        sprite._flyBaseY = lpc.image.y
        // Stable per-instance phase derived from the instanceId so it survives
        // re-creation without Math.random (and stays varied across a party).
        const seed = String(adv.instanceId ?? adv.sigil ?? '')
        let h = 0
        for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff
        sprite._flyPhase = (h / 0xffff) * Math.PI * 2
      }
    }

    // Solo Leveling — Sung Jinwoo is wreathed in a persistent black-flame aura.
    // A pulsing violet glow + the looping black-flame sheet are inserted BEHIND
    // the LPC sprite so he always renders in front of his own flames.
    if (lpc && (adv.classId === 'shadow_monarch' ||
                adv._shadowMonarch ||
                adv.spriteVariant?.startsWith('shadow_monarch/'))) {
      this._attachShadowMonarchAura(sprite)
    }

    // The Nemesis (Aldric, all acts) — a gold threat aura so the player can pick
    // him out at a glance in a crowded wave. Pulsed per-frame in update().
    if (lpc && (adv._nemesis || adv._nemesisDuel)) {
      this._attachThreatAura(sprite, { color: 0xffd24a, scale: 1.5 })
    }

    // Kingdom-Response CHAMPION (the act boss) — a threat aura tinted to the
    // response accent + a crown tag, so the boss is unmistakable amid its retinue.
    if (lpc && adv._championResponseId) {
      const accentCss = adv._championAccent || '#ffd24a'
      const accentInt = parseInt(accentCss.replace('#', ''), 16) || 0xffd24a
      this._attachThreatAura(sprite, { color: accentInt, scale: 1.65 })
      this._attachChampionLabel(sprite, accentCss)
    }

    // On-demand base-sheet upgrade: if this variant's 64px sheet hadn't streamed
    // in yet, _buildLpcSprite returned null and we're showing the procedural
    // circle. Remember the texture key so the update loop can swap in the real
    // LPC sprite the moment the sheet (+ its anims) land. (Skip event-class /
    // builder sprites — they use other texture keys or are already real.)
    if (!sprite.lpc && !sprite.builder && adv.spriteVariant) {
      const k = `adv-${adv.spriteVariant.replace('/', '-')}`
      if (!this._scene.textures.exists(k)) sprite._lpcPending = k
    }

    this._sprites[adv.instanceId] = sprite
    return sprite
  }

  // Always-on "marked threat" aura behind a key unit (the Nemesis Aldric, or a
  // Kingdom-Response champion) so it stands out in a crowd at a glance: a glowing
  // GROUND RING at its feet + a bright pulsing body glow. `color` is the marker
  // tint. Both elements are slotted BEHIND the sprite and pulsed per-frame in
  // update(). Strong on purpose — a faint glow was hard to spot.
  _attachThreatAura(s, { color = 0xffd24a, scale = 1.5 } = {}) {
    const c = s.container
    // Ground ring at the feet — the clearest "this unit is marked" read. A flat
    // ellipse stroke that breathes (alpha + scale pulse).
    const ring = this._scene.add.ellipse(0, 8, RADIUS * 2.8, RADIUS * 1.4, color, 0)
      .setStrokeStyle(2.5, color, 0.95)
    c.add(ring); c.sendToBack(ring)
    s.threatRing = ring
    // Brighter body glow rising around the torso.
    if (this._scene.textures.exists('vfx-soft-glow')) {
      const glow = this._scene.add.image(0, -11, 'vfx-soft-glow')
        .setScale(scale)
        .setTint(color)
        .setBlendMode(Phaser.BlendModes.SCREEN)
      c.add(glow); c.sendToBack(glow)
      s.threatGlow = glow
    }
  }

  // A bold accent-coloured crown above a champion's HP bar — the in-world "this is
  // the act boss" tag. The full name + HP + objective live in the ChampionBar; the
  // crown just marks WHICH unit it is (paired with the threat aura).
  _attachChampionLabel(s, accentCss = '#ffe8b0') {
    const crown = this._scene.add.text(0, -47, '♛', {
      fontSize: '15px', color: accentCss, fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#1a0f04', strokeThickness: 4,
    }).setOrigin(0.5, 1)
    s.container.add(crown)
    s.championLabel = crown
  }

  // Build the Shadow Monarch's always-on black-flame aura and slot it behind
  // his sprite. Order (back→front): violet glow → black flame → LPC sprite.
  // sendToBack pushes each to index 0, so adding the flame first then the glow
  // leaves glow(0) < flame(1) < lpc — i.e. Jinwoo overlaid in front of both.
  _attachShadowMonarchAura(s) {
    const c = s.container
    if (this._scene.textures.exists('vfx-shadow-flame')) {
      if (!this._scene.anims.exists('vfx-shadow-flame-loop')) {
        const tex = this._scene.textures.get('vfx-shadow-flame')
        if (tex.setFilter) tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
        this._scene.anims.create({
          key: 'vfx-shadow-flame-loop',
          frames: this._scene.anims.generateFrameNumbers('vfx-shadow-flame', { start: 0, end: 5 }),
          frameRate: 10,
          repeat: -1,
        })
      }
      // Centre-anchored (origin 0.5,0.5) and positioned so the flame's measured
      // content BASE sits at Jinwoo's feet (~container y+6.5) and rises up
      // around his body. The flame art leans up-and-left in its frame, so x=+7
      // re-centres it horizontally; y=-30 drops the base to his feet; 2.3×
      // engulfs his ~0.75-scale body.
      const flame = this._scene.add.sprite(7, -30, 'vfx-shadow-flame', 0)
        .setOrigin(0.5, 0.5)
        .setScale(2.3)
      flame.anims.play('vfx-shadow-flame-loop', true)
      c.add(flame)
      c.sendToBack(flame)
      s.shadowFlame = flame
    }
    // Pulsing violet aura around his body — a soft radial glow tinted violet
    // (same colour language as his extracted shadows) so the near-black flame
    // reads against dark floors. Pulse alpha is driven per-frame in update().
    if (this._scene.textures.exists('vfx-soft-glow')) {
      const glow = this._scene.add.image(0, -13, 'vfx-soft-glow')
        .setScale(0.95)
        .setTint(0x9b2fe0)
        .setBlendMode(Phaser.BlendModes.SCREEN)
      c.add(glow)
      c.sendToBack(glow)
      s.shadowGlow = glow
    }
  }

  // Pick (or fetch the previously-picked) LPC variant for this adventurer
  // and instantiate a Phaser sprite for it. Returns null if the manifest
  // isn't loaded or this class has no baked variants.
  _buildLpcSprite(adv) {
    // Rival Dungeon boss: a T3 minion final-form (beholder_tyrant,
    // demon_lord, …) — those forms render with a boss-archetype skin, so
    // we render the matching boss sheet rather than an adventurer LPC
    // sheet. `bossSheet` flags the caller to anchor + scale it like the
    // player's own boss. Texture is loaded by Preload's BOSS_SKINS list.
    if (adv._rivalBossSpriteKey) {
      const archetype = adv._rivalBossSpriteKey
      const idleTex = `${archetype}-idle`
      if (this._scene.textures.exists(idleTex)) {
        const image = this._scene.add.sprite(0, 0, idleTex, 0)
        const idleAnim = `${archetype}-idle-down`
        if (this._scene.anims.exists(idleAnim)) image.play(idleAnim)
        // textureKey is the bare archetype (NOT the idle sheet) so
        // _resolveLpcAnimKey builds `<archetype>-<state>-<dir>` keys that
        // match how _registerBossAnimations registered them — that's what
        // drives the boss's walk + attack animation instead of a freeze.
        return {
          image, textureKey: archetype, atkTextureKey: null, lastAnim: null,
          bossSheet: true, bossScale: 2.0,
        }
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
    // Dungeon events Zombie Horde + Rival Dungeon — render the invaders
    // with actual MINION sheets so they read as the monster race they are
    // rather than as humanoid adventurers. `_minionSheet` is set per-adv
    // at spawn (a `minion-<id>` key) — varied zombie tiers for the horde,
    // T1/T2 minion ids for the rival pack. Same minion-sheet anim contract
    // as the loot-goblin path above.
    if (adv._minionSheet) {
      const baseKey = adv._minionSheet
      const idleKey = `${baseKey}-idle`
      if (this._scene.textures.exists(idleKey)) {
        const image = this._scene.add.sprite(0, 0, idleKey, 0)
        const startAnim = `${baseKey}-walk-down`
        if (this._scene.anims.exists(startAnim)) image.play(startAnim)
        return { image, textureKey: baseKey, atkTextureKey: null, lastAnim: null, isMinionSheet: true }
      }
      // Texture missing — fall through to the LPC path.
    }
    // Event-only classes (monster_invader, rival_boss_invader,
    // loot_goblin) don't ship their own LPC bake — they declare a
    // spriteSourceClassId on their adventurerClasses.json entry that points at
    // an existing baked class to borrow art from. Falls through to the normal
    // path when the class IS baked.
    const def = this._defMap?.[adv.classId]
    // Cheater variant chaos — pool every baked class's variant list so a
    // cheater can spawn as Knight-body + Mage-weapon + Bard-hat (or any
    // other "shouldn't exist" combo). When the user bakes dedicated
    // cheater variants, drop them into the manifest under "cheater" and
    // this same logic still works (the cheater pool just becomes those
    // baked variants instead of the shuffle). Save-stable: rolled once,
    // persists on adv.spriteVariant across the run.
    //
    // Weapon → range sync: whichever source class the picked variant
    // came from drives the cheater's gameplay attackRange. A Mage-
    // variant cheater attacks at range 4, a Ranger-variant at range 5,
    // a Knight/Rogue/Barbarian variant stays melee. Stamped onto
    // adv.stats.attackRange so CombatSystem's reach check honours the
    // weapon they're visibly holding instead of falling through to the
    // default melee 1.
    if (adv.classId === 'cheater' && !adv.spriteVariant) {
      const dedicated = this._lpcVariantsByClass['cheater']
      if (dedicated && dedicated.length > 0) {
        const picked = dedicated[Math.floor(Math.random() * dedicated.length)]
        adv.spriteVariant = `cheater/${picked}`
      } else {
        // Shuffle across ALL baked class pools as a fallback until
        // dedicated cheater variants land.
        const all = []
        for (const [cId, list] of Object.entries(this._lpcVariantsByClass)) {
          for (const v of list) all.push(`${cId}/${v}`)
        }
        if (all.length > 0) adv.spriteVariant = all[Math.floor(Math.random() * all.length)]
      }
      // Sync attackRange. Two paths:
      //  1. Dedicated cheater variants (sourceCls === 'cheater') —
      //     the class def has no attackRange of its own, so we map
      //     directly from the variant's weapon name (read off
      //     _lpcWeaponByVariant, populated from the manifest).
      //  2. Cross-class shuffle fallback — the picked variant was
      //     baked for another class (mage/ranger/bard), so the source
      //     class's attackRange already encodes the range.
      // Either way the result lands on adv.stats.attackRange and
      // adv.attackRange so CombatSystem's reach check honours the
      // weapon they're visibly holding.
      if (adv.spriteVariant) {
        const sourceCls = adv.spriteVariant.split('/')[0]
        let resolvedRange = null
        if (sourceCls === 'cheater') {
          const wpn = this._lpcWeaponByVariant[adv.spriteVariant]
          // Bows + slingshot at range 4 (matches Ranger/Bard); Crossbow
          // at 5 (matches Bounty Hunter); all five staves at 4 (matches
          // Mage). Anything else (melee blade/axe/mace/flail/scythe/cane)
          // stays at the default melee 1.
          const RANGE_BY_WEAPON = {
            'Normal': 4, 'Great': 4, 'Recurve': 4, 'Slingshot': 4,
            'Crossbow': 5,
            'Simple staff': 4, 'Gnarled staff': 4, 'Diamond staff': 4,
            'Loop staff': 4, 'S staff': 4,
          }
          resolvedRange = RANGE_BY_WEAPON[wpn] ?? null
        } else {
          const sourceDef = this._defMap?.[sourceCls]
          resolvedRange = sourceDef?.baseStats?.attackRange ?? null
        }
        if (Number.isFinite(resolvedRange) && resolvedRange > 1) {
          adv.stats ??= {}
          adv.stats.attackRange = resolvedRange
          adv.attackRange       = resolvedRange
        }
      }
    }
    const sourceClassId =
      (this._lpcVariantsByClass[adv.classId]?.length ? adv.classId : null) ??
      def?.spriteSourceClassId ?? adv.classId
    const variants = this._lpcVariantsByClass[sourceClassId]
    if (!variants || variants.length === 0) return null
    // Save-stable: assign once, persist on adv for save/load identity.
    if (!adv.spriteVariant) {
      // Light Party classes are pinned to their single definitive costume (v01)
      // so the paladin/healer/samurai/mage always look like THE Warriors of Light.
      const picked = LP_FIXED_VARIANT_CLASSES.has(sourceClassId) && variants.includes('v01')
        ? 'v01'
        : variants[Math.floor(Math.random() * variants.length)]
      adv.spriteVariant = `${sourceClassId}/${picked}`
    }
    const [cls, vId] = adv.spriteVariant.split('/')
    const textureKey = `adv-${cls}-${vId}`
    if (!this._scene.textures.exists(textureKey)) {
      // Base sheets are no longer eager-loaded at boot — stream this variant's
      // sheet on demand (renders the procedural-circle fallback until it lands;
      // _createSprite marks _lpcPending so the update loop upgrades it).
      ensureAdventurerBaseSheet(this._scene, cls, vId)
      return null
    }
    const image = this._scene.add.sprite(0, 0, textureKey, 0)
    // Optional 192×192 attack texture for slash/thrust classes — null if this
    // variant didn't ship an _atk.png (e.g. spellcasters, weapon: null variants).
    const atkKey = `${textureKey}-atk`
    const atkTextureKey = this._scene.textures.exists(atkKey) ? atkKey : null
    // Optional 128×128 CARRY texture for oversize-walk polearms (dragon/long
    // spear etc.) — their walk shaft is too long for the 64px base sheet, so
    // walk/idle/run render from this sheet instead. Null for normal weapons.
    const wpn = this._lpcWeaponByVariant[adv.spriteVariant]
    const carryKey = `${textureKey}-walk128`
    const carryTextureKey = (CARRY_WALK_WEAPONS.has(wpn) && this._scene.textures.exists(carryKey)) ? carryKey : null
    return { image, textureKey, atkTextureKey, carryTextureKey, lastAnim: null }
  }

  // ── Click ──────────────────────────────────────────────────────────────────

  // Make a sprite/marker clickable. Click emits ADVENTURER_CLICKED — the
  // Game scene locks the camera onto the adv. Wired onto whichever marker
  // is actually visible (procedural circle, builder image, or LPC sprite),
  // since Phaser skips input hit-testing on invisible objects.
  _wireSpriteInput(adv, obj) {
    if (!obj || obj.input) return
    obj.setInteractive({ useHandCursor: true })
    obj.on('pointerdown', (pointer, x, y, event) => {
      event?.stopPropagation?.()
      EventBus.emit('ADVENTURER_CLICKED', { adventurer: adv })
    })
  }

  _destroySprite(id) {
    const s = this._sprites[id]
    if (!s) return
    // Legacy: cheater ground halo lived outside the sprite container —
    // removed when the RGB cycle moved onto the sprite itself. Keep
    // the defensive teardown for any save that still has a halo
    // reference parked on the sprite record.
    if (s.cheaterHalo?.active) s.cheaterHalo.destroy()
    s.cheaterHalo = null
    s._doomPip?.destroy?.()
    s._doomPip = null
    s._rootVines?.destroy?.()
    s._rootVines = null
    s.container.destroy()
    delete this._sprites[id]
    this._keyIcons?.[id]?.destroy?.()
    if (this._keyIcons) delete this._keyIcons[id]
    this._moodPips?.[id]?.destroy?.()
    if (this._moodPips) delete this._moodPips[id]
  }

  // ── Nerve mood pip ──────────────────────────────────────────────────────────
  // A small band-coloured dot above the head reflecting adv.mood (set by
  // NerveSystem). Lazily created, repositioned each frame, pulses when the
  // adventurer is rattled (spooked/breaking). Honours window.__qfMoodPips:
  // 'always' (default) shows it on everyone; 'off' hides it (body-language-only
  // prototype — the pace tells in AISystem stay on); 'hover' reserved for the
  // inspect-on-hover variant.
  _updateMoodPip(adv) {
    // Decided in preview (2026-06-10): HOVER-ONLY. No persistent pips — mood reads
    // in the InspectPopup on hover (the MOOD line). The body-language PACE tells in
    // AISystem stay always-on. Override with window.__qfMoodPips='always' to debug.
    const mode = (typeof window !== 'undefined' && window.__qfMoodPips) || 'hover'
    let pip = this._moodPips[adv.instanceId]
    if (mode === 'off' || mode === 'hover') {
      if (pip) pip.setVisible(false)
      return
    }
    const mood = adv.mood || 'steady'
    if (!pip) {
      pip = this._scene.add.circle(adv.worldX - 13, adv.worldY - 30, 4, _moodPipColor(mood))
        .setDepth(41)
      pip.setStrokeStyle(1.25, 0x12131a, 0.85)
      this._moodPips[adv.instanceId] = pip
    }
    // Colour + a gentle pulse that intensifies as morale falls.
    pip.setFillStyle(_moodPipColor(mood), 1)
    let scale = 1, alpha = 1
    if (mood === 'breaking')      { const p = (Math.sin(this._scene.time.now / 150) + 1) / 2; scale = 1 + 0.5 * p; alpha = 0.7 + 0.3 * p }
    else if (mood === 'spooked')  { const p = (Math.sin(this._scene.time.now / 260) + 1) / 2; scale = 1 + 0.28 * p; alpha = 0.85 + 0.15 * p }
    pip.setScale(scale)
    pip.setPosition(adv.worldX - 13, adv.worldY - 30)
    pip.setAlpha(alpha)
    if (!pip.visible) pip.setVisible(true)
  }

  _onRemove({ adventurer }) {
    if (adventurer?.instanceId) this._destroySprite(adventurer.instanceId)
  }

  // Solo Leveling — start Jinwoo's fade-out (win outro). Stamps the sprite
  // record; update() multiplies a 1→0 alpha over ~0.7s into the container.
  _onMonarchFade({ adventurer } = {}) {
    const s = this._sprites[adventurer?.instanceId]
    if (s) s._fadeOutAt = this._scene.time.now
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
    // A key-holder who dies before spending it drops the key — clear the
    // floating icon so it doesn't hover over the corpse (the parked body stays
    // until night, but the loop won't visit a dead adv to poll it away).
    this._keyIcons?.[adventurer.instanceId]?.destroy?.()
    if (this._keyIcons) delete this._keyIcons[adventurer.instanceId]
    if (s.lpc) {
      // Snap back to the body texture/origin in case we died mid-attack on
      // the atk sheet, then play the hurt strip. Minion-sheet and boss-
      // archetype sheets keep the origin the spawner gave them.
      if (!s.lpc.isMinionSheet && !s.lpc.bossSheet && s.lpc.image.originY !== LPC_BODY_ORIGIN_Y) {
        s.lpc.image.setOrigin(0.5, LPC_BODY_ORIGIN_Y)
      }
      // Minion + boss sheets ship a dedicated `death` animation (all four
      // facings); LPC adventurer sheets only have a single-dir `hurt`
      // strip, used as the corpse pose. Match the dir _tickLpcAnim will
      // request so the corpse pose doesn't re-trigger on the next frame.
      const isSheet = s.lpc.isMinionSheet || s.lpc.bossSheet
      const corpseState = isSheet ? 'death' : 'hurt'
      const dir = isSheet ? (adventurer._lpcDir ?? 'down') : 'down'
      const wantKey = `${s.lpc.textureKey}-${corpseState}-${dir}`
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
    this._spawnQueueCount  = 0
  }
}

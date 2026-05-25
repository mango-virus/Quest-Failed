// BloodSplatRenderer — transient floor decals spawned on adventurer
// death. Always a blood puddle; sometimes also a skull or skeleton
// body. Decay over a few days then disappear, with a faded-alpha last
// day so they don't pop out instantly.
//
// Triggered by EventBus 'ADVENTURER_DIED' — fires regardless of cause
// (trap kill, minion kill, boss kill, event-spawned enemy kill, etc).
// All counts as "adversary defeated in the dungeon," all leave a
// puddle.
//
// Data lives on `gameState.dungeon.deathDecals` so it saves + loads
// cleanly. Each entry:
//   {
//     id,                  // unique sprite key
//     kind: 'blood' | 'skull' | 'skel',
//     variant,             // index into texture pool for the kind
//     x, y,                // world coords (px) — anchor centre
//     spawnedDay,          // gameState.meta.dayNumber at spawn
//     expiresDay,          // gameState.meta.dayNumber at which it
//                          // gets pruned
//     flipX, flipY, angle, // visual variety knobs
//   }
//
// Pruning runs on every NIGHT_PHASE_STARTED. Each tick of the renderer
// also rebuilds alpha (in case dayNumber changed and the decal entered
// its "final day" fade window).
//
// Caps: max 1 blood AND 1 bone per tile (new spawn replaces an old
// one at the same tile); per-room cap evicts the oldest entry of the
// matching kind when a new one would push the room over MAX_PER_ROOM.
//
// Boss-chamber rule: decals here get a shorter lifespan (BOSS_DAYS)
// because the boss room sees the heaviest adv-death traffic and
// stacks fast.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'

const TS = Balance.TILE_SIZE

// Lifespan ranges (inclusive). Rolled per spawn so two puddles spawned
// the same night might evaporate one day apart.
const BLOOD_DAYS_MIN = 3
const BLOOD_DAYS_MAX = 5
const BONE_DAYS_MIN  = 3
const BONE_DAYS_MAX  = 7
// Boss chamber gets a flat shorter window — most adv deaths happen
// here so a longer life means towers of bones + blood by day 4.
const BOSS_DAYS = 3

// Bone-spawn-on-death chance. Total odds + which kind:
//   60% nothing (blood only)
//   25% skull
//   15% skeleton body
const BONE_CHANCE        = 0.40
const SKULL_FRACTION     = 0.625  // 25% of 40% = skull → 25/40
// (so SKELETON share is the remainder, 15/40 = 0.375)

const MAX_PER_ROOM_BLOOD = 12
const MAX_PER_ROOM_BONE  = 8

// Source PNGs are huge (~1000–1400px wide pixel-art at ~30 px per
// effective pixel). Render scale 0.07 lands them at ~63–98 px on
// screen — roughly 2–3 tiles wide. NEAREST filter keeps the chunky
// pixel look crisp at that downscale. Was 0.05; user wanted bigger
// puddles for more visible "this room saw a lot of dying" feel.
const BLOOD_SCALE = 0.07

// Floor decals — alpha holds at 1.0 until the final day, then drops
// to FADED_ALPHA so the player can see it's about to clear. Hard
// remove on expiresDay.
const FADED_ALPHA = 0.4

// Depth band: above floor tiles (~1) but below DecorRenderer's
// pre-placed floor skeletons (~3.4) and below entities (~7). So
// blood pools sit beneath room dressing and adventurers walk on top.
// Bones (skull / skel) spawned by THIS renderer sit at the same
// band as DecorRenderer's so they layer naturally with pre-placed
// room props.
const DEPTH_BLOOD = 1.7
const DEPTH_BONE  = 3.45

// Texture pools.
const BLOOD_TEX_KEYS = [
  'blood-1', 'blood-2', 'blood-3', 'blood-4', 'blood-5', 'blood-6', 'blood-7',
]
const SKULL_TEX_KEYS = ['decor-skull-s', 'decor-skull-w']
const SKEL_TEX_KEYS  = ['decor-skel-floor-1', 'decor-skel-floor-2', 'decor-skel-floor-3']

// Bones reuse DecorRenderer's scale for consistency.
const SKULL_SCALE = 1.5
const SKEL_SCALE  = 1.4

let _nextId = 1

export class BloodSplatRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // decal.id → { sprite }
    this._listeners = []

    // Ensure the slice exists for older saves.
    if (!this._gameState.dungeon) return
    this._gameState.dungeon.deathDecals ??= []

    this._wire()
    // Initial prune in case dayNumber advanced while the system was
    // offline (e.g. paused / page reloaded mid-day-transition).
    this._pruneExpired()
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
    this._sprites = {}
  }

  // ── Wiring ─────────────────────────────────────────────────────────────

  _on(evt, fn) {
    const bound = fn.bind(this)
    EventBus.on(evt, bound, this)
    this._listeners.push([evt, bound])
  }

  _wire() {
    this._on('ADVENTURER_DIED',     this._onAdventurerDied)
    this._on('NIGHT_PHASE_STARTED', this._pruneExpired)
  }

  // ── Spawn ──────────────────────────────────────────────────────────────

  _onAdventurerDied({ adventurer } = {}) {
    if (!adventurer) return
    // World position — adventurer worldX/worldY is updated each AI tick
    // and reflects the cell-centre of their death tile (or the smooth
    // path point if they died mid-tween).
    const wx = adventurer.worldX
    const wy = adventurer.worldY
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return

    // Blood — always.
    this._spawnDecal('blood', wx, wy)

    // Bones — sometimes (40% overall, split skull / skel).
    if (Math.random() < BONE_CHANCE) {
      const kind = Math.random() < SKULL_FRACTION ? 'skull' : 'skel'
      this._spawnDecal(kind, wx, wy)
    }
  }

  _spawnDecal(kind, wx, wy) {
    const decals = this._gameState.dungeon?.deathDecals
    if (!Array.isArray(decals)) return
    const day = this._gameState.meta?.dayNumber ?? 1
    const tx = Math.floor(wx / TS)
    const ty = Math.floor(wy / TS)

    // Per-tile dedup — if the same kind already exists on this tile,
    // remove it. Spawning a fresh entry refreshes the timer + re-rolls
    // the variant so the visual changes too. (Different kinds on the
    // same tile coexist — a blood puddle and a skull happily share.)
    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i]
      if (d.kind !== kind) continue
      const dtx = Math.floor(d.x / TS)
      const dty = Math.floor(d.y / TS)
      if (dtx === tx && dty === ty) {
        this._removeDecal(i)
        break
      }
    }

    // Per-room cap — evict the oldest entry of the same kind in the
    // owning room if we'd push it past the limit. Tiles outside any
    // room (the void) skip this check.
    const grid = this._scene.dungeonGrid
    const room = grid?.getRoomAtTile?.(tx, ty)
    if (room) {
      const cap = (kind === 'blood') ? MAX_PER_ROOM_BLOOD : MAX_PER_ROOM_BONE
      const inRoom = this._decalsInRoom(decals, room, kind)
      while (inRoom.length >= cap) {
        // Oldest = lowest spawnedDay, break ties by lowest id.
        inRoom.sort((a, b) =>
          (a.spawnedDay - b.spawnedDay) || (a.id - b.id))
        const victim = inRoom.shift()
        const idx = decals.indexOf(victim)
        if (idx >= 0) this._removeDecal(idx)
      }
    }

    // Roll lifespan. Boss room gets the flat short window.
    const isBossRoom = room?.definitionId === 'boss_chamber'
    const range = (kind === 'blood')
      ? [BLOOD_DAYS_MIN, BLOOD_DAYS_MAX]
      : [BONE_DAYS_MIN,  BONE_DAYS_MAX]
    const life = isBossRoom ? BOSS_DAYS : this._randInt(range[0], range[1])

    decals.push({
      id:         _nextId++,
      kind,
      variant:    this._pickVariant(kind),
      x:          wx,
      y:          wy,
      spawnedDay: day,
      expiresDay: day + life,
      flipX:      Math.random() < 0.5,
      // Blood gets random vertical flip too (asymmetric splatters);
      // bones have a clearer "up" so leave Y alone for them.
      flipY:      kind === 'blood' && Math.random() < 0.5,
      // Random small rotation so identical sprites don't read as
      // copy-pasted. Bones rotate further (lying corpses on the
      // floor) — bones get a free full random direction.
      angle:      kind === 'blood'
                    ? (Math.random() * 30 - 15)        // ±15°
                    : (Math.random() * 360),
    })
  }

  _decalsInRoom(decals, room, kind) {
    const x0 = room.gridX * TS
    const y0 = room.gridY * TS
    const x1 = (room.gridX + room.width)  * TS
    const y1 = (room.gridY + room.height) * TS
    const out = []
    for (const d of decals) {
      if (d.kind !== kind) continue
      if (d.x >= x0 && d.x < x1 && d.y >= y0 && d.y < y1) out.push(d)
    }
    return out
  }

  _pickVariant(kind) {
    if (kind === 'blood') return Math.floor(Math.random() * BLOOD_TEX_KEYS.length)
    if (kind === 'skull') return Math.floor(Math.random() * SKULL_TEX_KEYS.length)
    if (kind === 'skel')  return Math.floor(Math.random() * SKEL_TEX_KEYS.length)
    return 0
  }

  _randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1))
  }

  // ── Pruning + alpha refresh ────────────────────────────────────────────

  _pruneExpired() {
    const decals = this._gameState.dungeon?.deathDecals
    if (!Array.isArray(decals)) return
    const day = this._gameState.meta?.dayNumber ?? 1
    for (let i = decals.length - 1; i >= 0; i--) {
      if (decals[i].expiresDay <= day) this._removeDecal(i)
    }
  }

  _removeDecal(index) {
    const decals = this._gameState.dungeon?.deathDecals
    if (!Array.isArray(decals)) return
    const d = decals[index]
    if (!d) return
    decals.splice(index, 1)
    this._destroySprite(d.id)
  }

  // ── Render ─────────────────────────────────────────────────────────────

  update() {
    // LOD — at wide zoom, skip the per-frame alpha refresh across
    // every decal. Decay only fires once per day-change (rare during
    // play), so the alpha snap re-runs the first non-LOD frame.
    const cam = this._scene.cameras?.main
    if (cam && cam.zoom < 0.5) return

    const decals = this._gameState.dungeon?.deathDecals
    if (!Array.isArray(decals)) return
    const day = this._gameState.meta?.dayNumber ?? 1
    const seen = new Set()
    for (const d of decals) {
      seen.add(d.id)
      let rec = this._sprites[d.id]
      if (!rec) {
        rec = this._createSprite(d)
        if (!rec) continue
        this._sprites[d.id] = rec
      }
      // Refresh alpha each tick so a day change during play (rare —
      // dayNumber only advances at end of DayPhase, but a save load
      // can also shift it) updates the fade state without a sprite
      // rebuild.
      const daysLeft = d.expiresDay - day
      rec.sprite.setAlpha(daysLeft > 1 ? 1.0 : FADED_ALPHA)
    }
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(Number(id))) this._destroySprite(id)
    }
  }

  _createSprite(d) {
    const s = this._scene
    let texKey, scale, depth
    if (d.kind === 'blood') {
      texKey = BLOOD_TEX_KEYS[d.variant] ?? BLOOD_TEX_KEYS[0]
      scale  = BLOOD_SCALE
      depth  = DEPTH_BLOOD
    } else if (d.kind === 'skull') {
      texKey = SKULL_TEX_KEYS[d.variant] ?? SKULL_TEX_KEYS[0]
      scale  = SKULL_SCALE
      depth  = DEPTH_BONE
    } else if (d.kind === 'skel') {
      texKey = SKEL_TEX_KEYS[d.variant] ?? SKEL_TEX_KEYS[0]
      scale  = SKEL_SCALE
      depth  = DEPTH_BONE
    } else {
      return null
    }
    if (!s.textures.exists(texKey)) return null
    // NEAREST so the pixel art stays crisp at our aggressive
    // downscale. Idempotent across repeat calls (the filter is set
    // on the shared TextureSource).
    s.textures.get(texKey)?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
    const sprite = s.add.sprite(d.x, d.y, texKey)
      .setOrigin(0.5, 0.5)
      .setScale(scale)
      .setFlipX(!!d.flipX)
      .setFlipY(!!d.flipY)
      .setAngle(d.angle ?? 0)
      .setDepth(depth)
    return { sprite }
  }

  _destroySprite(id) {
    const rec = this._sprites[id]
    if (!rec) return
    rec.sprite?.destroy()
    delete this._sprites[id]
  }
}

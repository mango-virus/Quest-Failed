// TorchRenderer — wall-mounted torches + boss-chamber braziers.
//
// Data lives on each placed room as `room.torches = [{ localX, localY,
// kind: 'torch' | 'brazier', instanceId, frameOffset }]`, in room-local
// tile coords so the lights travel with the room across move/rotate/save.
// `room._torchRotation` (and `_torchW` / `_torchH`) record the rotation
// the local coords were authored in; this renderer rotates them on the
// fly when the room is rotated mid-move so they stay on the same wall
// of the room.
//
// Assignment:
//   • Boss chamber → 4 braziers at the interior floor corners (no random
//     torches). Brazier graphic is centred on the floor tile.
//   • Every other room → 0..3 torches spread round-robin across the four
//     interior walls (excluding the two flanking corner cells and any
//     cell occupied by a connection-point doorway). Multiple torches on
//     the same wall must respect MIN_TORCH_SPACING so they don't cluster
//     on adjacent cells. _anchorFor handles the inward offset per side
//     so the flame sits TORCH_WALL_RISE px up the wall from the room edge.
//
// Door-conflict pruning: if a tile that holds a torch later becomes a
// doorway (auto-connect carves through a wall when an adjacent room is
// placed), the torch is dropped — _pruneDoorConflicts checks each torch
// tile against the live `gameState.dungeon.tiles` grid.
//
// Rendering: each torch / brazier is an animated sprite (6 frames @ 8 fps,
// starting at a random offset so the dungeon doesn't flicker in lockstep)
// plus a warm light pool underneath. As of Frontier #2 the pool is delegated
// to the shared LightingSystem (a smooth radial-gradient texture — so torches
// match the boss/ability lighting), driven here via moveLight() each frame:
// positioned on the flame and alpha-flickered for a "live flame" feel. The
// pool sits below the entity layer so adventurers aren't tinted, only the
// floor. If lighting is disabled (qf.video.lighting), the flame still renders.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { TILE }     from '../systems/DungeonGrid.js'

const TS = Balance.TILE_SIZE

const TORCH_FRAMES     = 6
const ANIM_FRAME_RATE  = 8

// Warm light pools (radius px, peak alpha) for the additive glow under each
// flame. As of the Frontier-#2 migration these are delegated to the shared
// LightingSystem (smooth radial-gradient texture) instead of hand-drawn
// concentric circles — so torches/braziers match the boss/ability light. The
// dungeon shouldn't read as floodlit; alphas are deliberately low so torches
// just warm the floor around them. If lighting is OFF (qf.video.lighting), the
// flame sprite still renders — just without the floor pool.
// Both torches AND braziers use a BIG radius + the LightingSystem's soft texture
// so each fills more of the room with a gentle, wide warm glow (not a tight bright
// disc). Braziers are grander, so they spread a little further than torches.
const TORCH_GLOW_COLOR    = 0xff8844
const TORCH_LIGHT_R       = 108
const TORCH_LIGHT_ALPHA   = 0.30   // matches the brazier dimness
const BRAZIER_GLOW_COLOR  = 0xffaa55
const BRAZIER_LIGHT_R     = 138    // keep the wide spread…
const BRAZIER_LIGHT_ALPHA = 0.30   // …but much lower intensity (4 braziers in the boss room were too hot)

// Sprite depth — ABOVE jambs/decor-floor (~1.5–6) but BELOW the entity layer
// (boss/minions/adventurers Y-sort at 7 + worldY * 0.0005, i.e. ~7.0–7.5) so
// creatures walk IN FRONT of the torches/braziers instead of looking like
// they're walking under them. The light pool sits lower still (LightingSystem
// LIGHT_DEPTH ~2.5) so the glow warms the floor without tinting characters.
const DEPTH_SPRITE = 6.5

// Subtle alpha modulation for "the flame breathes" — sine wave over time.
const FLICKER_AMPL    = 0.10
const FLICKER_FREQ_MS = 220   // ~4.5 Hz per torch (phase-offset per sprite)

// How far (in px) the torch's flame anchor sits UP the wall from the wall
// tile's interior (room-facing) edge — toward the wall's outer edge. Larger =
// higher up the wall / further from the floor. Tuned so the torch reads as
// mounted partway up the wall, not slumped down by the floor.
const TORCH_WALL_RISE = 22

// Room light count: a regular room rolls 2–4 light sources, at most ONE torch
// per wall. With some chance, 1–2 of those slots become free-standing floor
// braziers at the room's interior corners instead of wall torches.
const ROOM_LIGHTS_MIN     = 2
const ROOM_LIGHTS_MAX     = 4
const ROOM_BRAZIER_CHANCE = 0.35   // chance a regular room gets corner braziers
const ROOM_BRAZIER_MAX    = 2      // up to this many braziers when it does
// Minimum tile distance between ANY two lights (torch↔torch, torch↔brazier,
// brazier↔brazier) so they don't cluster — e.g. a wall torch landing right next
// to a corner brazier, or two torches by a shared corner.
const MIN_LIGHT_SPACING   = 3

let _nextId = 1

export class TorchRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // `${room.instanceId}:${torch.instanceId}` → { sprite, lightId, ... }
    this._listeners = []

    // `_nextId` is a module global that RESETS to 1 on every page reload, but a
    // loaded save already carries torches with ids 1..N. Without re-seeding,
    // newly-placed rooms would mint ids 1,2,3… that collide with the loaded
    // ones — and (before the composite sprite key below) collided sprites
    // stomped each other, scrambling torch/brazier orientation. Seed past the
    // existing max so fresh ids stay unique.
    this._seedNextId()

    this._registerAnims()
    this._wire()
    // First pass: assign braziers to the pre-placed boss room (and any
    // other rooms that lack `torches`, e.g. a save loaded before this
    // feature existed).
    this._ensureAllRoomsAssigned()
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    for (const id of Object.keys(this._sprites)) this._destroySprite(id)
    this._sprites = {}
  }

  // ── Wiring ────────────────────────────────────────────────────────────

  _on(evt, fn) {
    const bound = fn.bind(this)
    EventBus.on(evt, bound, this)
    this._listeners.push([evt, bound])
  }

  _wire() {
    this._on('ROOM_PLACED', this._onRoomPlaced)
    // New rooms / moves can spawn auto-doors that conflict with existing
    // torches on the affected walls — re-validate every torch's tile.
    this._on('ROOM_PLACED',   this._pruneDoorConflicts)
    this._on('ROOM_MOVED',    this._pruneDoorConflicts)
    this._on('ROOM_REMOVED',  this._pruneDoorConflicts)
    this._on('LOCKS_CHANGED', this._pruneDoorConflicts)
  }

  _registerAnims() {
    const s = this._scene
    if (s.textures.exists('torch') && !s.anims.exists('torch-burn')) {
      s.anims.create({
        key: 'torch-burn',
        frames: s.anims.generateFrameNumbers('torch', { start: 0, end: TORCH_FRAMES - 1 }),
        frameRate: ANIM_FRAME_RATE,
        repeat: -1,
      })
    }
    if (s.textures.exists('brazier') && !s.anims.exists('brazier-burn')) {
      s.anims.create({
        key: 'brazier-burn',
        frames: s.anims.generateFrameNumbers('brazier', { start: 0, end: TORCH_FRAMES - 1 }),
        frameRate: ANIM_FRAME_RATE,
        repeat: -1,
      })
    }
  }

  // ── Assignment ────────────────────────────────────────────────────────

  // Bump the module-global id counter past every torch id already present in
  // the loaded dungeon, so post-load room placements never re-mint a colliding
  // id (see the constructor note).
  _seedNextId() {
    let max = 0
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      for (const t of (room.torches ?? [])) {
        if (typeof t.instanceId === 'number' && t.instanceId > max) max = t.instanceId
      }
    }
    if (_nextId <= max) _nextId = max + 1
  }

  // Sprite-map key — scoped to the ROOM so two rooms whose torches happen to
  // share an instanceId (e.g. a save minted before _seedNextId, or legacy data)
  // never collide into one another's sprite. Falls back to a positional key if
  // a room somehow lacks an instanceId.
  _spriteKey(room, t) {
    return `${room.instanceId ?? `${room.gridX},${room.gridY}`}:${t.instanceId}`
  }

  _ensureAllRoomsAssigned() {
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (!Array.isArray(room.torches)) this._assignForRoom(room)
    }
  }

  _onRoomPlaced({ room } = {}) {
    if (!room) return
    if (!Array.isArray(room.torches)) this._assignForRoom(room)
  }

  _assignForRoom(room) {
    if (room.definitionId === 'boss_chamber') {
      room.torches = this._brazierCorners(room)
    } else {
      room.torches = this._rollTorches(room)
    }
    // NOTE: do NOT snapshot _torchRotation / _torchW / _torchH here.
    // `DungeonGrid.placeRoom` emits ROOM_PLACED before NightPhase stamps
    // `room.rotation = this._rotation`, so reading it now would record
    // 0 even for a rotated drop — and the next _syncRoomRotation tick
    // would then "rotate" the already-rotated torch coords onto floor
    // tiles. Defer the snapshot to _syncRoomRotation's lazy-init path
    // (runs on the first update tick, by which point room.rotation has
    // been written).
  }

  // Roll a regular room's lights: 2–4 total sources, at most ONE TORCH PER WALL,
  // with a chance for 1–2 of the slots to be free-standing floor BRAZIERS at the
  // interior corners instead. Wall cells exclude flanking corners + doorways and
  // are validated against the live tile grid; brazier corners are validated as
  // floor. The torch sprite reads fine on any of the four interior walls
  // (_anchorFor handles the per-side inward offset).
  _rollTorches(room) {
    const total = ROOM_LIGHTS_MIN + Math.floor(Math.random() * (ROOM_LIGHTS_MAX - ROOM_LIGHTS_MIN + 1)) // 2..4

    // How many of the slots are corner braziers (chance-gated, capped).
    let brazierCount = 0
    if (Math.random() < ROOM_BRAZIER_CHANCE) {
      brazierCount = Math.min(1 + Math.floor(Math.random() * ROOM_BRAZIER_MAX), ROOM_BRAZIER_MAX, total)
    }
    const torchTarget = total - brazierCount

    const out = []
    // A candidate must sit ≥ MIN_LIGHT_SPACING tiles from every light already
    // placed, so nothing clusters.
    const farEnough = (lx, ly) => out.every(o => Math.hypot(o.localX - lx, o.localY - ly) >= MIN_LIGHT_SPACING)
    const add = (lx, ly, kind) => out.push({ localX: lx, localY: ly, kind, instanceId: _nextId++, frameOffset: Math.floor(Math.random() * TORCH_FRAMES) })

    // Braziers FIRST — interior floor corners (free-standing). Placed before the
    // torches so the wall torches route around them. Corners that are too close
    // to an already-placed brazier (tiny rooms) are skipped.
    if (brazierCount > 0) {
      let placed = 0
      for (const c of this._shuffle(this._floorCornerCandidates(room))) {
        if (placed >= brazierCount) break
        if (farEnough(c.localX, c.localY)) { add(c.localX, c.localY, 'brazier'); placed++ }
      }
    }

    // Torches — one per wall, walls in random order, choosing a cell that's far
    // enough from every light already placed (braziers + other torches).
    const dirs = this._shuffle(['N', 'S', 'W', 'E'])
    for (const d of dirs) {
      if (out.filter(o => o.kind === 'torch').length >= torchTarget) break
      const c = this._shuffle(this._wallCandidates(room, d)).find(cell => farEnough(cell.localX, cell.localY))
      if (c) add(c.localX, c.localY, 'torch')
    }

    return out
  }

  // Interior floor CORNER cells for free-standing braziers — the first floor
  // tile in from each outer wall, at each of the four corners. Validated as
  // actual floor tiles so odd/small rooms don't drop a brazier on a wall or
  // doorway.
  _floorCornerCandidates(room) {
    const wt = Balance.WALL_THICKNESS ?? 1
    const w = room.width, h = room.height
    const tiles = this._gameState.dungeon?.tiles
    const cand = [[wt, wt], [w - 1 - wt, wt], [wt, h - 1 - wt], [w - 1 - wt, h - 1 - wt]]
    const out = []
    for (const [lx, ly] of cand) {
      const t = tiles?.[room.gridY + ly]?.[room.gridX + lx]
      if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) out.push({ localX: lx, localY: ly })
    }
    return out
  }

  // Candidate wall cells on the given direction's interior edge.
  // dir: 'N' (top row, localY=0) | 'S' (bottom row) | 'W' (left col)
  //      | 'E' (right col). Skips the two flanking corner cells and any
  // cell that holds a connection-point doorway.
  _wallCandidates(room, dir) {
    const tiles = this._gameState.dungeon?.tiles
    if (!tiles) return []
    const w = room.width, h = room.height
    const out = []
    if (dir === 'N' || dir === 'S') {
      const ly = (dir === 'N') ? 0 : (h - 1)
      const doorXs = new Set(
        (room.connectionPoints ?? [])
          .filter(cp => cp.y === ly)
          .map(cp => cp.x)
      )
      for (let lx = 1; lx < w - 1; lx++) {
        if (doorXs.has(lx)) continue
        const tx = room.gridX + lx
        const ty = room.gridY + ly
        const t = tiles[ty]?.[tx]
        if (t === TILE.WALL || t === TILE.BOSS_WALL) {
          out.push({ localX: lx, localY: ly })
        }
      }
    } else {
      const lx = (dir === 'W') ? 0 : (w - 1)
      const doorYs = new Set(
        (room.connectionPoints ?? [])
          .filter(cp => cp.x === lx)
          .map(cp => cp.y)
      )
      for (let ly = 1; ly < h - 1; ly++) {
        if (doorYs.has(ly)) continue
        const tx = room.gridX + lx
        const ty = room.gridY + ly
        const t = tiles[ty]?.[tx]
        if (t === TILE.WALL || t === TILE.BOSS_WALL) {
          out.push({ localX: lx, localY: ly })
        }
      }
    }
    return out
  }

  _shuffle(arr) {
    const out = arr.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = out[i]; out[i] = out[j]; out[j] = tmp
    }
    return out
  }

  // Four braziers — one per interior floor corner of the boss chamber.
  // Wall thickness = 1 (game-wide); corners sit one cell in from the
  // outer wall on each axis.
  _brazierCorners(room) {
    const wt = Balance.WALL_THICKNESS ?? 1
    const w  = room.width
    const h  = room.height
    const corners = [
      [wt,         wt],
      [w - 1 - wt, wt],
      [wt,         h - 1 - wt],
      [w - 1 - wt, h - 1 - wt],
    ]
    return corners.map(([lx, ly]) => ({
      localX:      lx,
      localY:      ly,
      kind:        'brazier',
      instanceId:  _nextId++,
      frameOffset: Math.floor(Math.random() * TORCH_FRAMES),
    }))
  }

  // ── Door-conflict pruning ─────────────────────────────────────────────
  // After any event that could carve a doorway through a wall, walk every
  // torch and drop ones whose tile is no longer a wall. Braziers sit on
  // floor and are never affected.
  _pruneDoorConflicts() {
    const tiles = this._gameState.dungeon?.tiles
    if (!tiles) return
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (!Array.isArray(room.torches) || room.torches.length === 0) continue
      room.torches = room.torches.filter(t => {
        if (t.kind === 'brazier') return true
        const tx = room.gridX + t.localX
        const ty = room.gridY + t.localY
        const tile = tiles[ty]?.[tx]
        return tile === TILE.WALL || tile === TILE.BOSS_WALL
      })
    }
  }

  // ── Rotation sync ─────────────────────────────────────────────────────
  // If the room was rotated since the torches were authored (move-drop
  // with R pressed), rotate every torch's local coords by the delta so
  // they stick to the same wall of the rotated room.
  _syncRoomRotation(room) {
    if (!Array.isArray(room.torches) || room.torches.length === 0) return
    const cur = room.rotation ?? 0
    // Lazy init — `room.rotation` is stamped by NightPhase AFTER
    // ROOM_PLACED fires, so we record the authoring frame on the first
    // tick (when it's settled) rather than during _assignForRoom.
    if (room._torchRotation == null) {
      room._torchRotation = cur
      room._torchW = room.width
      room._torchH = room.height
      return
    }
    const stored = room._torchRotation
    if (cur === stored) return
    let steps = (((cur - stored) / 90) % 4 + 4) % 4
    if (steps === 0) { room._torchRotation = cur; return }
    let w = room._torchW ?? room.width
    let h = room._torchH ?? room.height
    for (let s = 0; s < steps; s++) {
      for (const t of room.torches) {
        const nx = h - 1 - t.localY
        const ny = t.localX
        t.localX = nx
        t.localY = ny
      }
      const tmp = w; w = h; h = tmp
    }
    room._torchRotation = cur
    room._torchW = w
    room._torchH = h
  }

  // Placement anchor + orientation for a torch/brazier on the given room.
  // Returns { x, y, ox, oy, angle, flipY }.
  //
  // TORCHES are rotated per-wall to MATCH the DecorRenderer wall-mount
  // convention so they orient the same way as the wall decor on every wall.
  // It matches DecorRenderer._wallMountAnchor EXACTLY: origin (0.5, 0) pinned
  // at the wall's interior face, with per-side angles N=0 / S=180 / W=-90 / E=90.
  //
  //   N wall  angle=  0  extends DOWN  (south, into room)
  //   S wall  angle=180  extends UP    (north, into room)
  //   W wall  angle=-90  extends RIGHT (east,  into room)
  //   E wall  angle= 90  extends LEFT  (west,  into room)
  //
  // BRAZIERS are free-standing floor objects centred on their corner tile
  // (bottom-anchored so the base rests on the tile, flame rising upward).
  // They render the same at every corner — the art is fire-on-top, so a
  // vertical flip would point the flame DOWNWARD (upside-down), which reads
  // as broken; brazier orientation is therefore left upright everywhere.
  _anchorFor(room, t) {
    const w = room.width, h = room.height
    const cellCx = (room.gridX + t.localX) * TS + TS / 2
    const cellCy = (room.gridY + t.localY) * TS + TS / 2

    if (t.kind === 'brazier') {
      const bottomY = (room.gridY + t.localY + 1) * TS - 4
      return { x: cellCx, y: bottomY, ox: 0.5, oy: 1, angle: 0, flipY: false }
    }

    // Wall torch — match the decor wall-mount transform (origin 0.5,0 at the
    // wall's interior face). BIAS nudges it a touch inward.
    const BIAS = TORCH_WALL_RISE   // raises the flame up the wall, off the floor
    if (t.localY === 0) {                       // North wall
      return { x: cellCx, y: (room.gridY + t.localY + 1) * TS - BIAS, ox: 0.5, oy: 0, angle: 0, flipY: false }
    } else if (t.localY === h - 1) {            // South wall
      return { x: cellCx, y: (room.gridY + t.localY) * TS + BIAS, ox: 0.5, oy: 0, angle: 180, flipY: false }
    } else if (t.localX === 0) {                // West wall
      return { x: (room.gridX + t.localX + 1) * TS - BIAS, y: cellCy, ox: 0.5, oy: 0, angle: -90, flipY: false }
    } else if (t.localX === w - 1) {            // East wall
      return { x: (room.gridX + t.localX) * TS + BIAS, y: cellCy, ox: 0.5, oy: 0, angle: 90, flipY: false }
    }
    // Interior fallback (shouldn't happen) — upright, no rotation.
    return { x: cellCx, y: (room.gridY + t.localY + 1) * TS, ox: 0.5, oy: 0, angle: 0, flipY: false }
  }

  // Where the FLAME sits relative to the anchor (for centring the light pool).
  // With origin (0.5,0) the flame end is AT the anchor; nudge the glow a little
  // way INTO the room (along the sprite's into-room normal) so it lights the
  // floor rather than the wall. Brazier flame is just above the bowl.
  _flamePos(t, a) {
    const FWD = TS * 0.45
    if (t.kind === 'brazier') return { x: a.x, y: a.y - TS * 0.55 }   // flame above the bowl
    switch (a.angle) {
      case 0:   return { x: a.x,       y: a.y + FWD }   // N wall, into room = south
      case 180: return { x: a.x,       y: a.y - FWD }   // S wall, into room = north
      case -90: return { x: a.x + FWD, y: a.y }         // W wall, into room = east
      case 90:  return { x: a.x - FWD, y: a.y }         // E wall, into room = west
      default:  return { x: a.x,       y: a.y - TS / 2 }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  update() {
    // LOD — at wide-overview zoom (the common play mode per user
    // playtests), skip the per-frame iteration over every torch in
    // every room. Sprites keep their last position; the sine-based
    // flicker pauses (barely visible at zoom ≤ 0.5 anyway, since the
    // glow circle is sub-30px on screen). State resumes the next
    // frame zoom climbs back above the threshold.
    const cam = this._scene.cameras?.main
    if (cam && cam.zoom < 0.5) return

    const seen = new Set()
    const now  = this._scene.time?.now ?? 0
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      this._syncRoomRotation(room)
      const torches = room.torches
      if (!Array.isArray(torches)) continue
      for (const t of torches) {
        const key = this._spriteKey(room, t)
        seen.add(key)
        const a = this._anchorFor(room, t)
        let rec = this._sprites[key]
        if (!rec) {
          rec = this._createSprite(t, a, key)
          if (!rec) continue
          this._sprites[key] = rec
        } else {
          // Re-snap position + orientation each frame so a mid-move room
          // rotation (which rewrites localX/localY → a different wall/corner)
          // keeps the sprite correctly oriented. Depth is fixed in
          // _createSprite (below the entity layer) so creatures pass in front.
          rec.sprite?.setPosition(a.x, a.y)
          rec.sprite?.setOrigin(a.ox, a.oy)
          rec.sprite?.setAngle(a.angle ?? 0)
          rec.sprite?.setFlipY(!!a.flipY)
        }
        // Drive the light pool — centre it on the FLAME (which, after rotation,
        // is offset from the sconce/base anchor) and flicker its alpha with a
        // per-torch sine so "the flame breathes". Via the shared LightingSystem.
        const fp = this._flamePos(t, a)
        const phase = (now / FLICKER_FREQ_MS) + rec.flickerSeed
        const flicker = 1 + FLICKER_AMPL * Math.sin(phase)
        this._scene.lightingSystem?.moveLight(rec.lightId, fp.x, fp.y, (rec.lightAlpha ?? 0.4) * flicker)
      }
    }
    // Drop sprites whose torches are gone (room removed / sold / pruned).
    // Keys are composite strings (`${roomId}:${torchId}`); compare as-is.
    for (const key of Object.keys(this._sprites)) {
      if (!seen.has(key)) this._destroySprite(key)
    }
  }

  _createSprite(t, a, key) {
    const s = this._scene
    const isBrazier = t.kind === 'brazier'
    const texKey  = isBrazier ? 'brazier'      : 'torch'
    const animKey = isBrazier ? 'brazier-burn' : 'torch-burn'
    if (!s.textures.exists(texKey)) return null

    // Light pool — delegated to the shared LightingSystem (smooth radial-
    // gradient texture, ADD-blended, drawn below the entity layer so it warms
    // the floor without tinting characters). Registered WITHOUT a follow() fn,
    // so this renderer drives its position + flicker each frame via moveLight().
    const color     = isBrazier ? BRAZIER_GLOW_COLOR  : TORCH_GLOW_COLOR
    const lightR    = isBrazier ? BRAZIER_LIGHT_R     : TORCH_LIGHT_R
    const lightA    = isBrazier ? BRAZIER_LIGHT_ALPHA : TORCH_LIGHT_ALPHA
    // Light id must be room-scoped too (same collision story as the sprite key).
    const lightId   = `torch_${key ?? t.instanceId}`
    // setLight no-ops if lighting is disabled — the flame sprite still renders.
    // Both torches and braziers use the soft (wider/gentler) texture so the glow
    // fills the room instead of reading as a tight bright disc. moveLight()
    // re-centres it on the flame next frame, so the init point is approximate.
    const fp = this._flamePos(t, a)
    s.lightingSystem?.setLight(lightId, { x: fp.x, y: fp.y, radius: lightR, color, intensity: lightA, pulse: 0, soft: true })

    // Sprite — origin/angle/flip come from the anchor so the sconce pins to
    // the wall and the flame rotates into the room (braziers: bottom-corner
    // vertical flip).
    const sprite = s.add.sprite(a.x, a.y, texKey)
      .setOrigin(a.ox, a.oy)
      .setAngle(a.angle ?? 0)
      .setFlipY(!!a.flipY)
      .setDepth(DEPTH_SPRITE)
    // Start at a random frame so the dungeon doesn't flicker in lockstep.
    sprite.play({ key: animKey, startFrame: t.frameOffset ?? 0 })

    return {
      sprite,
      lightId,
      lightAlpha: lightA,
      // Random phase so each light flickers on its own schedule.
      flickerSeed: Math.random() * Math.PI * 2,
    }
  }

  _destroySprite(id) {
    const rec = this._sprites[id]
    if (!rec) return
    rec.sprite?.destroy()
    if (rec.lightId) this._scene.lightingSystem?.removeLight(rec.lightId)
    delete this._sprites[id]
  }
}

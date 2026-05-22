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
//   • Every other room → 0..3 torches randomly placed on the north
//     interior wall (top row, excluding the two flanking corner cells and
//     any cell occupied by a connection-point doorway). The torch sprite
//     reads naturally on the north wall (camera-facing) so we restrict
//     placement to that edge.
//
// Door-conflict pruning: if a tile that holds a torch later becomes a
// doorway (auto-connect carves through a wall when an adjacent room is
// placed), the torch is dropped — _pruneDoorConflicts checks each torch
// tile against the live `gameState.dungeon.tiles` grid.
//
// Rendering: each torch / brazier is an animated sprite (6 frames @ 8 fps,
// starting at a random offset so the dungeon doesn't flicker in lockstep)
// plus a 3-layer additive-blend warm glow underneath. Glow alpha jitters
// over time for a subtle "live flame" feel; glow sits below the entity
// layer so adventurers walking through aren't tinted, only the floor.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { TILE }     from '../systems/DungeonGrid.js'

const TS = Balance.TILE_SIZE

const TORCH_FRAMES     = 6
const ANIM_FRAME_RATE  = 8

// Glow layers (radius, alpha) for the additive-blend warm light. Alphas
// are deliberately low — the dungeon view shouldn't read as floodlit, the
// torches just warm the floor around them.
const TORCH_GLOW_COLOR   = 0xff8844
const TORCH_GLOW_LAYERS  = [[14, 0.16], [28, 0.09], [48, 0.045]]
const BRAZIER_GLOW_COLOR = 0xffaa55
const BRAZIER_GLOW_LAYERS = [[18, 0.19], [36, 0.11], [62, 0.055]]

// Depths. Sprite above wall-overhead (which DungeonRenderer puts at 9);
// glow above floor/tints but below the entity layer (~7) so creatures
// walking through aren't washed in orange.
const DEPTH_GLOW   = 2.6
const DEPTH_SPRITE = 9.5

// Subtle alpha modulation for "the flame breathes" — sine wave over time.
const FLICKER_AMPL    = 0.10
const FLICKER_FREQ_MS = 220   // ~4.5 Hz per torch (phase-offset per sprite)

// How far (in px) the torch sprite is anchored INSIDE the room from the
// wall tile's interior edge. Pulls the torch off the room's outer edge so
// it reads as mounted on the wall facing the room, not stuck on the rim.
const TORCH_INSET = 14

// Minimum tile-distance between two torches on the same wall, so a
// multi-torch room doesn't cluster them on adjacent cells.
const MIN_TORCH_SPACING = 3

let _nextId = 1

export class TorchRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // torch.instanceId → { sprite, glow, glowBase, flickerSeed }
    this._listeners = []

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
    // Snapshot the orientation we authored these coords in so a later
    // rotate-during-move can rotate them to follow the room.
    room._torchRotation = room.rotation ?? 0
    room._torchW = room.width
    room._torchH = room.height
  }

  // 0..3 torches on the room's north interior wall, excluding the two
  // flanking corner cells and any cell that holds a connection-point
  // doorway. Cells are validated against the live dungeon tile grid so
  // pillar / decorative non-wall cells don't get a torch.
  _rollTorches(room) {
    const candidates = this._northWallCandidates(room)
    if (candidates.length === 0) return []
    const count = Math.floor(Math.random() * 4)   // 0..3 uniform
    const pool = candidates.slice()
    const picked = []
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      picked.push(pool.splice(idx, 1)[0])
    }
    return picked.map(c => ({
      localX:      c.localX,
      localY:      c.localY,
      kind:        'torch',
      instanceId:  _nextId++,
      frameOffset: Math.floor(Math.random() * TORCH_FRAMES),
    }))
  }

  _northWallCandidates(room) {
    const tiles = this._gameState.dungeon?.tiles
    if (!tiles) return []
    const doorXs = new Set(
      (room.connectionPoints ?? [])
        .filter(cp => cp.y === 0)
        .map(cp => cp.x)
    )
    const out = []
    // Skip the two outer columns — those are corner cells; we want flat
    // wall between them. localY=0 is the top edge.
    for (let lx = 1; lx < room.width - 1; lx++) {
      if (doorXs.has(lx)) continue
      const tx = room.gridX + lx
      const ty = room.gridY
      const t = tiles[ty]?.[tx]
      if (t === TILE.WALL || t === TILE.BOSS_WALL) {
        out.push({ localX: lx, localY: 0 })
      }
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
    const cur    = room.rotation ?? 0
    const stored = room._torchRotation ?? cur
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

  // ── Render ────────────────────────────────────────────────────────────

  update() {
    const seen = new Set()
    const now  = this._scene.time?.now ?? 0
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      this._syncRoomRotation(room)
      const torches = room.torches
      if (!Array.isArray(torches)) continue
      for (const t of torches) {
        seen.add(t.instanceId)
        // Anchor: south edge of the tile (bottom of cell) so the sprite's
        // bottom-center (mount) sits on the wall/floor and the flame
        // extends up over it.
        const wx = (room.gridX + t.localX) * TS + TS / 2
        const wy = (room.gridY + t.localY) * TS + TS
        let rec = this._sprites[t.instanceId]
        if (!rec) {
          rec = this._createSprite(t, wx, wy)
          if (!rec) continue
          this._sprites[t.instanceId] = rec
        } else {
          rec.sprite?.setPosition(wx, wy)
          // Glow sits at the cell center (above the floor / on the wall
          // base) so its halo is centered on the light source.
          rec.glow?.setPosition(wx, wy - TS / 2)
          // Y-sort for braziers — they're free-standing on the floor and
          // can be occluded by entities passing in front.
          if (t.kind === 'brazier') {
            rec.sprite?.setDepth(7 + wy * 0.0005)
          }
        }
        // Flicker — sine wave over time, phase-offset per torch.
        if (rec.glow) {
          const phase = (now / FLICKER_FREQ_MS) + rec.flickerSeed
          const flicker = 1 + FLICKER_AMPL * Math.sin(phase)
          rec.glow.setAlpha(flicker)
        }
      }
    }
    // Drop sprites whose torches are gone (room removed / sold / pruned).
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(Number(id))) this._destroySprite(id)
    }
  }

  _createSprite(t, wx, wy) {
    const s = this._scene
    const isBrazier = t.kind === 'brazier'
    const texKey  = isBrazier ? 'brazier'      : 'torch'
    const animKey = isBrazier ? 'brazier-burn' : 'torch-burn'
    if (!s.textures.exists(texKey)) return null

    // Glow first — additive blend, layered concentric circles to fake a
    // radial gradient. Sits below the entity layer so it warms the floor
    // around the light without tinting characters that walk through.
    const layers = isBrazier ? BRAZIER_GLOW_LAYERS : TORCH_GLOW_LAYERS
    const color  = isBrazier ? BRAZIER_GLOW_COLOR  : TORCH_GLOW_COLOR
    const glow = s.add.graphics()
    // Draw from outermost to innermost so the bright core sits on top.
    for (let i = layers.length - 1; i >= 0; i--) {
      const [r, a] = layers[i]
      glow.fillStyle(color, a)
      glow.fillCircle(0, 0, r)
    }
    glow.setBlendMode(Phaser.BlendModes.ADD)
    glow.setDepth(DEPTH_GLOW)
    glow.setPosition(wx, wy - TS / 2)

    // Sprite — bottom-center origin so positioning at the south edge of
    // the tile lands the mount on the wall / floor and the flame above.
    const sprite = s.add.sprite(wx, wy, texKey)
      .setOrigin(0.5, 1)
      .setDepth(isBrazier ? (7 + wy * 0.0005) : DEPTH_SPRITE)
    // Start at a random frame so the dungeon doesn't flicker in lockstep.
    sprite.play({ key: animKey, startFrame: t.frameOffset ?? 0 })

    return {
      sprite,
      glow,
      // Random phase so each light flickers on its own schedule.
      flickerSeed: Math.random() * Math.PI * 2,
    }
  }

  _destroySprite(id) {
    const rec = this._sprites[id]
    if (!rec) return
    rec.sprite?.destroy()
    rec.glow?.destroy()
    delete this._sprites[id]
  }
}

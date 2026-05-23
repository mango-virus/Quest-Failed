// CobwebRenderer — dusty cobwebs in the four interior corners of each
// dungeon room.
//
// Mirrors TorchRenderer's data + lifecycle pattern so the two systems
// behave consistently:
//
//   • Data lives on each placed room as
//       room.cobwebs = [{ corner: 0|1|2|3, size: 's'|'m'|'l', instanceId }]
//     in room-local frame so it travels with move / rotate / save.
//   • `room._cobwebRotation` is the rotation the corner indices were
//     authored in. _syncRoomRotation lazy-inits on the first update tick
//     (room.rotation is stamped by NightPhase AFTER ROOM_PLACED fires —
//     reading it during _assignForRoom would record 0 even for rotated
//     drops; same gotcha that bit TorchRenderer).
//
// Assignment per room:
//   • crypt / catacombs / throne_room / sanctum → roll 0..3 + 1, cap 4
//   • everything else (incl. boss chamber + entry_hall) → roll 0..3 uniform
//
// Within those counts the actual corners filled are picked by a random
// shuffle of [TL, TR, BR, BL]. Size is rolled per slot from a weighted
// table favouring "medium".
//
// Rendering:
//   • Three plain images (`cobweb-small/medium/large`, loaded in Preload).
//   • Origin (0,0); positioned so the sprite's DENSE corner (the radial
//     hub in the source art) sits a short INSET diagonally INSIDE the
//     wall corner — pulling it off the very junction so it reads as
//     hanging just inside the corner rather than glued to the seam.
//     flipX / flipY mirror per corner.
//   • TR is the source-art canonical orientation (dense hub at the
//     sprite's top-right, strands radiating down-left into the room).
//     TL is flipX, BR is flipY, BL is flipX+flipY.
//   • Tinted to a soft bone-white (close to --text) so the webs stay
//     visible against the dim stone backdrop; the line-art reads as a
//     pale silk thread rather than a faded smudge.
//   • Same depth band as torches (just below) — entities pass IN FRONT.
//
// Door-conflict pruning: very unlikely (auto-connect doors carve mid-
// wall, not corners) but checked defensively against the live tile grid
// after any event that could mutate walls.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { TILE }     from '../systems/DungeonGrid.js'

const TS = Balance.TILE_SIZE

// Texture key per size. Cobwebs are single-frame images, not sheets.
const TEX_BY_SIZE = { s: 'cobweb-small', m: 'cobweb-medium', l: 'cobweb-large' }

// Size pick weights (cumulative sum is 1.0). Medium dominates because
// the small sprite is shaped more like a tatter strand than a full
// corner web — it works but reads as a lighter accent.
const SIZE_WEIGHTS = [['s', 0.15], ['m', 0.55], ['l', 0.30]]

// Per-definition modifiers. HEAVY adds +1 to the rolled count (capped
// at 4). NO_WEB_DEFS is empty — entry_hall used to be excluded but is
// now allowed to roll like any other room (per user feedback).
const HEAVY_WEB_DEFS = new Set(['crypt', 'catacombs', 'throne_room', 'sanctum'])
const NO_WEB_DEFS    = new Set()

// Top layer (the visible silk) — pure white, fully opaque. The line-art
// can blend into the dim stone if it's even slightly off-white, so
// don't compromise here; the shadow layer below handles standing out
// against bright backgrounds.
const COBWEB_TINT  = 0xffffff
const COBWEB_ALPHA = 1.0

// Drop-shadow layer — same sprite, tinted near-black, offset 2px down
// and 2px in the direction the strands radiate. Gives the silk
// guaranteed contrast against grey walls and pale floors alike (the
// problem the previous tints couldn't solve: bone-on-stone has almost
// no luminance gap, so the cobweb effectively disappeared).
const COBWEB_SHADOW_TINT  = 0x000000
const COBWEB_SHADOW_ALPHA = 0.6
const COBWEB_SHADOW_DX    = 2
const COBWEB_SHADOW_DY    = 2

// Depth band: just below torch sprites (6.5), well above floor / decor
// (1–4), and below the entity Y-sort floor (~7.0). Characters walking
// past a corner pass IN FRONT of the cobweb, which reads naturally.
// Shadow sits one tick below the top layer so it draws underneath; the
// additive "boost" layer sits one tick above so it brightens the
// strands beyond the source art's half-transparent pixel values.
const DEPTH_COBWEB_SHADOW = 6.39
const DEPTH_COBWEB        = 6.40
const DEPTH_COBWEB_BOOST  = 6.41

// Additive top layer that whitens the silk — source PNGs are line art
// with anti-aliased strand edges, so tinting them 0xffffff still left
// the strands looking semi-grey. Adding a screen-blended copy on top
// pushes the strand pixels toward pure white without blowing out the
// surrounding floor.
const COBWEB_BOOST_ALPHA = 0.6

// Pull the sprite's dense end diagonally INSIDE the wall junction by
// this many pixels so the web reads as "hanging just inside the corner"
// instead of glued to the outer pixel where two walls meet. Once
// COBWEB_SCALE bumped to 1.6 the visible hub effectively shifted
// further inward on its own, so this inset came back down from 32
// to 14 to keep the dense end snug against the corner.
const COBWEB_INSET = 14

// Up-scale the source art so the cobwebs read as a real piece of
// dungeon decoration rather than a tiny corner accent. 1.6 ≈ a 31×31
// medium web rendered at ~50×50 px (one and a half tiles diagonal),
// which fills the corner without spilling onto far walls / doorways.
const COBWEB_SCALE = 1.6

let _nextId = 1

export class CobwebRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // cobweb.instanceId → { sprite }
    this._listeners = []

    this._wire()
    // First pass: assign cobwebs to any room missing them (the boss
    // chamber on a fresh run; every room on a save loaded from before
    // this feature shipped).
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
    this._on('ROOM_PLACED',   this._onRoomPlaced)
    // Defensive prune — auto-connect doors carve mid-wall, not corners,
    // but a future room shape could put a door in a corner cell.
    this._on('ROOM_PLACED',   this._pruneCornerConflicts)
    this._on('ROOM_MOVED',    this._pruneCornerConflicts)
    this._on('ROOM_REMOVED',  this._pruneCornerConflicts)
    this._on('LOCKS_CHANGED', this._pruneCornerConflicts)
  }

  // ── Assignment ────────────────────────────────────────────────────────

  _ensureAllRoomsAssigned() {
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (!Array.isArray(room.cobwebs)) this._assignForRoom(room)
    }
  }

  _onRoomPlaced({ room } = {}) {
    if (!room) return
    if (!Array.isArray(room.cobwebs)) this._assignForRoom(room)
  }

  _assignForRoom(room) {
    room.cobwebs = this._rollCobwebs(room)
    // NOTE: do NOT snapshot _cobwebRotation here. DungeonGrid.placeRoom
    // emits ROOM_PLACED before NightPhase stamps `room.rotation =
    // this._rotation`, so reading it now records 0 even for rotated
    // drops, and the first _syncRoomRotation tick would then "rotate"
    // already-rotated corner indices. Lazy-init handles it on the next
    // tick when room.rotation has settled.
  }

  _rollCobwebs(room) {
    if (NO_WEB_DEFS.has(room.definitionId)) return []
    const base  = Math.floor(Math.random() * 4)   // 0..3 uniform
    const bonus = HEAVY_WEB_DEFS.has(room.definitionId) ? 1 : 0
    const count = Math.min(4, base + bonus)
    if (count === 0) return []
    const corners = [0, 1, 2, 3]
    this._shuffle(corners)
    const out = []
    for (let i = 0; i < count; i++) {
      out.push({
        corner:     corners[i],
        size:       this._rollSize(),
        instanceId: _nextId++,
      })
    }
    return out
  }

  _rollSize() {
    const r = Math.random()
    let acc = 0
    for (const [size, w] of SIZE_WEIGHTS) {
      acc += w
      if (r < acc) return size
    }
    return 'm'
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
    }
    return arr
  }

  // ── Door-conflict pruning ─────────────────────────────────────────────
  // Re-check each cobweb against the live tile grid; drop any whose
  // corner cell is no longer a wall (would-be a doorway carve, etc).
  _pruneCornerConflicts() {
    const tiles = this._gameState.dungeon?.tiles
    if (!tiles) return
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (!Array.isArray(room.cobwebs) || room.cobwebs.length === 0) continue
      room.cobwebs = room.cobwebs.filter(c => {
        const [lx, ly] = this._cornerCell(room, c.corner)
        const tx = room.gridX + lx
        const ty = room.gridY + ly
        const t  = tiles[ty]?.[tx]
        return t === TILE.WALL || t === TILE.BOSS_WALL
      })
    }
  }

  // Local-coord cell for a given corner index. Always the outermost
  // wall tile on that corner (room.width / height already reflect the
  // post-rotation footprint).
  _cornerCell(room, corner) {
    const w = room.width, h = room.height
    switch (corner) {
      case 0: return [0,        0       ]   // TL
      case 1: return [w - 1,    0       ]   // TR
      case 2: return [w - 1,    h - 1   ]   // BR
      case 3: return [0,        h - 1   ]   // BL
    }
    return [0, 0]
  }

  // ── Rotation sync ─────────────────────────────────────────────────────
  // Rotating a room 90° CW maps each corner CW around the perimeter:
  //   TL(0) → TR(1) → BR(2) → BL(3) → TL(0)
  // so a step of k CW rotations is just `corner = (corner + k) % 4`.
  _syncRoomRotation(room) {
    if (!Array.isArray(room.cobwebs) || room.cobwebs.length === 0) return
    const cur = room.rotation ?? 0
    if (room._cobwebRotation == null) {
      // Lazy init — see _assignForRoom comment.
      room._cobwebRotation = cur
      return
    }
    const stored = room._cobwebRotation
    if (cur === stored) return
    const steps = (((cur - stored) / 90) % 4 + 4) % 4
    if (steps === 0) { room._cobwebRotation = cur; return }
    for (const c of room.cobwebs) c.corner = (c.corner + steps) % 4
    room._cobwebRotation = cur
  }

  // ── Render ────────────────────────────────────────────────────────────

  update() {
    const seen = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      this._syncRoomRotation(room)
      const cobwebs = room.cobwebs
      if (!Array.isArray(cobwebs)) continue
      for (const c of cobwebs) {
        seen.add(c.instanceId)
        let rec = this._sprites[c.instanceId]
        if (!rec) {
          rec = this._createSprite(room, c)
          if (!rec) continue
          this._sprites[c.instanceId] = rec
        } else {
          this._positionSprite(rec.sprite, room, c, { shadow: rec.shadow, boost: rec.boost })
        }
      }
    }
    // Drop sprites whose cobwebs are gone (room removed / sold / pruned).
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(Number(id))) this._destroySprite(id)
    }
  }

  _createSprite(room, c) {
    const s = this._scene
    const texKey = TEX_BY_SIZE[c.size] ?? TEX_BY_SIZE.m
    if (!s.textures.exists(texKey)) return null
    // Force NEAREST filtering on the shared texture so the 1.6×
    // upscale stays crisp — Phaser defaults to LINEAR (because of
    // `antialias: true` in main.js) which blurs pixel art.
    s.textures.get(texKey)?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
    // Shadow first (drawn underneath because of its lower depth).
    const shadow = s.add.sprite(0, 0, texKey)
      .setOrigin(0, 0)
      .setScale(COBWEB_SCALE)
      .setTint(COBWEB_SHADOW_TINT)
      .setAlpha(COBWEB_SHADOW_ALPHA)
      .setDepth(DEPTH_COBWEB_SHADOW)
    // Bright top layer.
    const sprite = s.add.sprite(0, 0, texKey)
      .setOrigin(0, 0)
      .setScale(COBWEB_SCALE)
      .setTint(COBWEB_TINT)
      .setAlpha(COBWEB_ALPHA)
      .setDepth(DEPTH_COBWEB)
    // Additive boost — same texture stacked on top with SCREEN blend
    // so the strand pixels brighten past the source PNG's transparency.
    const boost = s.add.sprite(0, 0, texKey)
      .setOrigin(0, 0)
      .setScale(COBWEB_SCALE)
      .setTint(0xffffff)
      .setAlpha(COBWEB_BOOST_ALPHA)
      .setDepth(DEPTH_COBWEB_BOOST)
      .setBlendMode(Phaser.BlendModes.SCREEN)
    this._positionSprite(sprite, room, c, { shadow, boost })
    return { sprite, shadow, boost }
  }

  // Place the sprite so its DENSE end (radial hub) sits diagonally
  // INSET pixels inside the wall corner, with strands radiating into
  // the room. When called with a `shadow` ref, also locks the shadow
  // sprite onto the same position offset by (COBWEB_SHADOW_DX/DY) and
  // mirrored with the same flips.
  //
  // Source art is authored for the TR corner — dense hub at the
  // sprite's TOP-RIGHT, strands flowing down-left into the room. So
  // TR is the no-flip canonical case. TL mirrors flipX, BR flips Y,
  // BL flips both. The inset shifts the anchor by +INSET on each axis
  // pointing INTO the room (where the strands radiate).
  _positionSprite(sprite, room, c, opts = {}) {
    const w  = room.width, h = room.height
    // displayWidth/displayHeight account for setScale — needed so the
    // right/bottom edge of a scaled sprite still aligns with the wall
    // corner anchor instead of overflowing past it.
    const sw = sprite.displayWidth  || sprite.width
    const sh = sprite.displayHeight || sprite.height
    const I  = COBWEB_INSET
    let x, y, fx = false, fy = false
    switch (c.corner) {
      case 0:                                 // TL — flipX of TR canonical
        x = room.gridX * TS + I
        y = room.gridY * TS + I
        fx = true
        break
      case 1:                                 // TR — canonical orientation
        x = (room.gridX + w) * TS - sw - I
        y = room.gridY * TS + I
        break
      case 2:                                 // BR — flipY of TR canonical
        x = (room.gridX + w) * TS - sw - I
        y = (room.gridY + h) * TS - sh - I
        fy = true
        break
      case 3:                                 // BL — flipX + flipY of TR
        x = room.gridX * TS + I
        y = (room.gridY + h) * TS - sh - I
        fx = true; fy = true
        break
      default:
        x = room.gridX * TS
        y = room.gridY * TS
    }
    sprite.setPosition(x, y)
    sprite.setFlipX(fx)
    sprite.setFlipY(fy)
    const shadow = opts.shadow ?? null
    if (shadow) {
      shadow.setPosition(x + COBWEB_SHADOW_DX, y + COBWEB_SHADOW_DY)
      shadow.setFlipX(fx)
      shadow.setFlipY(fy)
    }
    const boost = opts.boost ?? null
    if (boost) {
      boost.setPosition(x, y)
      boost.setFlipX(fx)
      boost.setFlipY(fy)
    }
  }

  _destroySprite(id) {
    const rec = this._sprites[id]
    if (!rec) return
    rec.sprite?.destroy()
    rec.shadow?.destroy()
    rec.boost?.destroy()
    delete this._sprites[id]
  }
}

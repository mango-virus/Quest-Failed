// DecorRenderer — themed cosmetic props placed inside each dungeon room.
// Pure dressing; no gameplay effect.
//
// Sprite families and their placement rules:
//   • skel_floor   — top-down skeleton sprawled on the floor. Random
//                    variant (3) + random flipX/Y for orientation.
//                    Placed on any interior floor tile.
//   • skull_pile   — small heap on the floor. Same placement rules as
//                    skel_floor.
//   • skull        — single skull on a floor tile against an interior
//                    wall, facing INTO the room. Two source facings
//                    (south, west) are mirrored to fill all four
//                    directions, picked per slot from which wall it
//                    sits against.
//   • skel_wall    — vertical skeleton-on-chains. Anchored top to a
//                    wall tile, hanging down into the room. N or S
//                    wall only (sprite is drawn for vertical mount).
//   • statue       — tall robed figure on the floor, one tile inward
//                    from a N or S wall. Y-sorted with entities so
//                    adventurers correctly pass behind / in front.
//   • chain_single — thin single chain hanging from a wall. Three
//                    lengths; any of the four walls.
//   • chain_pair   — pair of chains with broken-cuff terminations
//                    ("a prisoner used to hang here"). Six variants
//                    (3 widths × 2 heights). N or S wall only.
//
// Data model lives on each placed room as
//   room.decorProps = [{ kind, variant, localX, localY, side, flipX, flipY,
//                        instanceId }]
// in room-local frame so it travels through move / rotate / save.
// `side` is 'N' | 'S' | 'W' | 'E' for wall props, used to pick the
// correct flipped sprite for the current orientation. `room._decorRotation`
// snapshot lazy-inits on the first update tick — same gotcha as the
// torch / cobweb renderers (room.rotation is stamped by NightPhase AFTER
// ROOM_PLACED fires).
//
// Theme kits per room definition: each definitionId lists the prop
// kinds it can roll. 1–3 props per room (entry_hall = 0). Unknown
// definitions fall back to a neutral default kit.
//
// Door / occupancy pruning: re-validated on every event that can
// mutate walls (ROOM_PLACED / MOVED / REMOVED / LOCKS_CHANGED).
// Wall props on a cell that's no longer a wall are dropped.

import { EventBus } from '../systems/EventBus.js'
import { Balance }  from '../config/balance.js'
import { TILE }     from '../systems/DungeonGrid.js'

const TS = Balance.TILE_SIZE
const WT = Balance.WALL_THICKNESS ?? 1

let _nextId = 1

// ── Texture tables ────────────────────────────────────────────────────────

// Texture key lookups per kind. Values can be either a single string
// (single-texture prop) or an array (variant pool, picked uniformly).
const TEX = {
  skel_floor:   ['decor-skel-floor-1', 'decor-skel-floor-2', 'decor-skel-floor-3'],
  skel_wall:    ['decor-skel-wall-1', 'decor-skel-wall-2'],
  skull_s:       'decor-skull-s',         // canonical south-facing
  skull_w:       'decor-skull-w',         // canonical west-facing
  skull_pile:    'decor-skull-pile',
  statue:       ['decor-statue-m', 'decor-statue-l'],
  chain_single: ['decor-chain-single-s', 'decor-chain-single-m', 'decor-chain-single-l'],
  chain_pair:   ['decor-chain-pair-1a', 'decor-chain-pair-1b',
                 'decor-chain-pair-2a', 'decor-chain-pair-2b',
                 'decor-chain-pair-3a', 'decor-chain-pair-3b'],
  // Themed kits — cropped from decor sprite packs by tools/crop-decor.mjs
  bookshelf:    ['decor-bookshelf-1', 'decor-bookshelf-2', 'decor-bookshelf-3',
                 'decor-bookshelf-4', 'decor-bookshelf-5', 'decor-bookshelf-6'],
  chest:        ['decor-chest-1', 'decor-chest-2', 'decor-chest-3',
                 'decor-chest-4', 'decor-chest-5', 'decor-chest-6'],
  weapon_rack:  ['decor-weapon-rack-1', 'decor-weapon-rack-2',
                 'decor-weapon-rack-3', 'decor-weapon-rack-4'],
  // Skull-relief — spritesheet, not single image. Single 6-frame
  // animation (eye-glow pulse) laid out top-to-bottom; DecorRenderer
  // plays `skull-relief-anim` on every placed medallion.
  skull_relief: 'decor-skull-relief-sheet',
  // Batch 2 — themed centerpieces + flat decals.
  banner:        'decor-banner-sigil',
  forge:         'decor-forge',
  // Ritual circle — 3 variants picked uniformly per placement.
  ritual_circle: ['decor-ritual-pentacle', 'decor-ritual-hex', 'decor-ritual-small'],
  // Batch 3 — smithy + storage + decorative pottery.
  anvil:         ['decor-anvil-1', 'decor-anvil-2'],
  cauldron:      'decor-cauldron',
  crate:         ['decor-crate-large', 'decor-crate-medium'],
  sack:          'decor-sack',
  vase:          ['decor-vase-1', 'decor-vase-2'],
  // Wishing well centerpiece — placed dead-centre in the wishing_well
  // room (capped 1/room).
  well:          'decor-wishing-well',
}

// ── Theme kits ────────────────────────────────────────────────────────────
// Which prop kinds each room can roll. _default catches anything not
// explicitly listed.
const THEME_KITS = {
  // Themed rooms now lean on their kit props so each room type reads
  // distinctly. Generic horror props (skeletons / chains) still appear
  // mixed in for atmosphere.
  crypt:               ['skel_floor', 'skull_pile', 'skel_wall', 'chain_single', 'chain_pair', 'skull_relief'],
  catacombs:           ['skel_floor', 'skull_pile', 'skel_wall', 'chain_single', 'chain_pair', 'skull_relief'],
  // Boss chamber gets a banner on top of the existing horror props.
  boss_chamber:        ['banner', 'skel_floor', 'skull_pile', 'skel_wall', 'skull_relief'],
  throne_room:         ['banner', 'banner', 'statue', 'skull', 'skull_relief', 'vase'],
  // Sanctum — ritual floor + bookshelves + cauldron / vase for the
  // ceremonial-witchy feel.
  sanctum:             ['ritual_circle', 'statue', 'skull', 'bookshelf', 'skull_relief', 'cauldron', 'vase'],
  // Treasury / mimic vault — chests are the focus, with crates + sacks
  // as overflow loot bags.
  treasury:            ['chest', 'chest', 'chest', 'crate', 'sack', 'skull_pile', 'skull'],
  mimic_vault:         ['chest', 'chest', 'crate', 'sack', 'skull_pile', 'skull'],
  // Armory — forge centrepiece + weapon racks + anvils + crates.
  armory:              ['forge', 'weapon_rack', 'weapon_rack', 'anvil', 'crate', 'skel_floor'],
  // Trap factory — workshop kit: forge + anvil + cauldron + crates.
  trap_factory:        ['forge', 'anvil', 'cauldron', 'weapon_rack', 'crate', 'skel_floor', 'chain_single'],
  library_of_whispers: ['bookshelf', 'bookshelf', 'bookshelf', 'ritual_circle', 'vase', 'skull'],
  hall_of_trials:      ['skel_wall', 'chain_pair', 'chain_single', 'weapon_rack'],
  wandering_gate:      ['skel_wall', 'chain_single'],
  hall_of_madness:     ['skel_floor', 'skull_pile', 'skull', 'chain_single', 'skull_relief', 'ritual_circle'],
  // Wishing well — the well centerpiece + bones / scattered offerings
  // from past supplicants.
  wishing_well:        ['well', 'skull_pile', 'skull', 'sack', 'chain_single'],
  false_exit:          ['skel_floor', 'skull', 'chain_single'],
  entry_hall:          [],
  _default:            ['skel_floor', 'skull', 'chain_single'],
}

// Kinds that should appear AT MOST ONCE per room (large centrepieces /
// rituals). Without this cap, a roll could drop two forges on the
// same floor. Cauldron joins the list — it's the focal point of a
// sanctum / trap-factory hearth, not background clutter.
const ONCE_PER_ROOM = new Set([
  'forge', 'ritual_circle', 'cauldron', 'well',
])

// Count rolled per room: 1..3 picks from the kit (with replacement so
// e.g. a crypt can have 2 skeletons + 1 skull pile).
const COUNT_MIN = 1
const COUNT_MAX = 3

// Per-kind render scale. Source sprites are authored at tile-fit pixel
// sizes (skulls at 11–13 px wide etc), which reads as too small dropped
// onto a 32 px floor tile. Bumped per user feedback so the skeletal
// decor reads as actual room dressing rather than tiny accents. Statues
// and chains stay at 1× — statues are already tall (~34–39 px) and
// chains are intentionally thin vertical pieces.
const SCALE_BY_KIND = {
  skel_floor: 1.4,
  skull_pile: 1.4,
  skull:      1.5,   // smallest source sprites — bump a touch harder
  skel_wall:  1.4,
  statue:     1.0,
  chain_single: 1.0,
  chain_pair:   1.0,
  // Themed kit props — source crops are already roughly tile-sized
  // (bookshelves 38×59, chests 25×28, weapon racks ~49×48, skull
  // reliefs 18×25). Skull reliefs get the biggest bump because the
  // medallions are tiny in source.
  bookshelf:    1.0,
  chest:        1.1,
  weapon_rack:  0.85,
  skull_relief: 1.5,
  // Batch 2 — all sources are already roughly tile-scale after the
  // user's hand-crops, so default to 1×.
  banner:          1.0,
  ritual_circle:   1.0,
  forge:           1.0,   // source 64×108 (≈2×3.4 tiles) reads at 1×
  // Batch 3 — small clutter sources, bumped where source under-1-tile.
  anvil:           1.0,   // 31×30 / 37×32 (≈1 tile)
  cauldron:        1.0,   // 37×28
  crate:           1.2,   // 25×32 / 19×26 — bump so even medium reads
  sack:            1.4,   // 16×17 — small source, scale up to read
  vase:            1.0,   // 17×34 — tall narrow, already nicely sized
  well:            1.2,   // 27×32 — slight bump so it reads as a centerpiece
}
function scaleFor(kind) { return SCALE_BY_KIND[kind] ?? 1.0 }

// ── Depths ─────────────────────────────────────────────────────────────────
// Floor decals sit above the floor tile layer (~1) but well below the
// entity Y-sort floor (~7), so creatures walking over them draw on top.
// Vertical / wall-mounted props use Y-sort so they correctly occlude
// entities walking past — same band as the entity layer.
const DEPTH_FLOOR_DECAL = 3.4
const DEPTH_VERT_BASE   = 7.0
const DEPTH_VERT_YK     = 0.0005

// Y-sort helper: depth = base + worldY * yk
function ysort(worldY) { return DEPTH_VERT_BASE + worldY * DEPTH_VERT_YK }

// Per-kind classification — does this prop sit on the floor (fixed depth)
// or stand vertically (Y-sorted with entities)?
function isFloorKind(kind) {
  return kind === 'skel_floor' || kind === 'skull_pile' || kind === 'skull' ||
         kind === 'ritual_circle'
}

export class DecorRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._sprites   = {}    // prop.instanceId → { sprite }
    this._listeners = []

    this._registerAnims()
    this._wire()
    this._ensureAllRoomsAssigned()
    // One-shot startup prune so continued saves with pre-existing
    // door-blocking props (e.g. bookshelf in front of a doorway
    // carved when a neighbouring room was placed) clean themselves
    // up without waiting for the next ROOM_PLACED / MOVED event.
    this._pruneConflicts()
  }

  // Register the skull-relief medallion animation — a single 6-frame
  // loop laid out top-to-bottom in the source sheet. Slow framerate
  // so the eye-glow pulse reads as gentle rather than rapid flicker.
  _registerAnims() {
    const s = this._scene
    if (!s.textures.exists('decor-skull-relief-sheet')) return
    if (s.anims.exists('skull-relief-anim')) return
    s.anims.create({
      key: 'skull-relief-anim',
      frames: s.anims.generateFrameNumbers('decor-skull-relief-sheet',
        { start: 0, end: 5 }),
      frameRate: 4,    // ~0.25s per frame → ~1.5s full pulse
      repeat: -1,
    })
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
    this._on('ROOM_PLACED',   this._onRoomPlaced)
    this._on('ROOM_PLACED',   this._pruneConflicts)
    this._on('ROOM_MOVED',    this._pruneConflicts)
    this._on('ROOM_REMOVED',  this._pruneConflicts)
    this._on('LOCKS_CHANGED', this._pruneConflicts)
  }

  _ensureAllRoomsAssigned() {
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (!Array.isArray(room.decorProps)) this._assignForRoom(room)
    }
  }

  _onRoomPlaced({ room } = {}) {
    if (!room) return
    if (!Array.isArray(room.decorProps)) {
      this._assignForRoom(room)
      // TEMP DIAG — only warn for the bug case (zero props rolled).
      if (room.decorProps.length === 0) {
        const kit = THEME_KITS[room.definitionId] ?? THEME_KITS._default
        // eslint-disable-next-line no-console
        console.warn(
          `[DecorDiag] BUG: ${room.definitionId} @(${room.gridX},${room.gridY}) ` +
          `${room.width}×${room.height} rolled ZERO props from kit ` +
          `[${kit.join(', ')}]. Torches=${room.torches?.length ?? 0}, ` +
          `Cobwebs=${room.cobwebs?.length ?? 0}, CPs=${room.connectionPoints?.length ?? 0}`
        )
      }
    } else {
      // TEMP DIAG — also warn if decorProps was pre-set somehow.
      // eslint-disable-next-line no-console
      console.warn(`[DecorDiag] BUG: ${room.definitionId} arrived with decorProps PRE-SET (length ${room.decorProps.length}) — SKIPPED roll`)
    }
  }

  // ── Assignment / rolling ──────────────────────────────────────────────

  _assignForRoom(room) {
    room.decorProps = this._rollDecor(room)
    // NOTE: _decorRotation lazy-inits in _syncRoomRotation on the first
    // update tick (room.rotation is undefined at ROOM_PLACED time).
  }

  _rollDecor(room) {
    const kit = THEME_KITS[room.definitionId] ?? THEME_KITS._default
    if (kit.length === 0) return []
    const count = COUNT_MIN + Math.floor(Math.random() * (COUNT_MAX - COUNT_MIN + 1))
    // Track cells we've already covered with a decor prop so two props
    // in the same room don't stack on the same tile.
    const used = new Set()
    // Track kinds that are gated to once-per-room (large centrepieces
    // like forge / carpet / ritual circles) so a single roll doesn't
    // drop two of them on top of each other.
    const placedKinds = new Set()
    // Cells held by torches / cobwebs / connection points so we don't
    // collide with sibling renderers.
    const occupied = this._existingOccupancy(room)
    const out = []
    let attempts = 0
    // TEMP DIAG — tracking why subsequent rooms get no decor.
    const diag = []
    while (out.length < count && attempts < 30) {
      attempts++
      const kind = kit[Math.floor(Math.random() * kit.length)]
      if (ONCE_PER_ROOM.has(kind) && placedKinds.has(kind)) {
        diag.push(`${kind}:OnceCap`)
        continue
      }
      const prop = this._placeKind(room, kind, used, occupied)
      if (prop) {
        used.add(`${prop.localX},${prop.localY}`)
        placedKinds.add(prop.kind)
        out.push(prop)
        diag.push(`${kind}:OK@(${prop.localX},${prop.localY})`)
      } else {
        diag.push(`${kind}:NULL`)
      }
    }
    if (out.length < count) {
      // eslint-disable-next-line no-console
      console.info(`[DecorDiag] _rollDecor short: want ${count}, got ${out.length}/${attempts} attempts. Trace: ${diag.join(' | ')}`)
    }
    return out
  }

  // Build a set of "lx,ly" cells already covered by other renderers'
  // props on this room (torches, cobweb anchor cells, doorway CP cells).
  // Decor placement avoids these so the visual layers don't fight.
  _existingOccupancy(room) {
    const out = new Set()
    for (const t of room.torches ?? [])  out.add(`${t.localX},${t.localY}`)
    for (const c of room.cobwebs ?? []) {
      // Cobwebs anchor at the four wall corners.
      const w = room.width, h = room.height
      const cell = c.corner === 0 ? [0,     0    ]
                 : c.corner === 1 ? [w - 1, 0    ]
                 : c.corner === 2 ? [w - 1, h - 1]
                 :                  [0,     h - 1]
      out.add(`${cell[0]},${cell[1]}`)
    }
    for (const cp of room.connectionPoints ?? []) {
      out.add(`${cp.x},${cp.y}`)
    }
    return out
  }

  // Dispatch to the right placement strategy by kind. Returns a prop
  // object (with `kind`, position, variant, etc) or null if no valid
  // slot could be found.
  _placeKind(room, kind, used, occupied) {
    if (kind === 'skel_floor' || kind === 'skull_pile') return this._placeFloor(room, kind, used, occupied)
    if (kind === 'skull')                                return this._placeWallFloor(room, kind, used, occupied)
    if (kind === 'statue')                               return this._placeStatue(room, kind, used, occupied)
    // Wall-mounted vertical props (skel_wall + both chain kinds) and
    // wall-adjacent floor props (statue / bookshelf / weapon_rack) now
    // rotate based on `side` in _anchorFor — source-TOP rotates to the
    // wall edge so the sprite reads correctly on N, S, W, or E walls.
    if (kind === 'skel_wall')    return this._placeWallProp(room, kind, used, occupied, ['N','S','W','E'])
    if (kind === 'chain_single') return this._placeWallProp(room, kind, used, occupied, ['N','S','W','E'])
    if (kind === 'chain_pair')   return this._placeWallProp(room, kind, used, occupied, ['N','S','W','E'])
    if (kind === 'bookshelf')    return this._placeWallFloor(room, kind, used, occupied, ['N','S','W','E'])
    if (kind === 'weapon_rack')  return this._placeWallFloor(room, kind, used, occupied, ['N','S','W','E'])
    // Chest — free-standing on any interior floor cell.
    if (kind === 'chest')        return this._placeFloor(room, kind, used, occupied)
    // Skull-relief plaque — symmetric medallion, wall-mounted on any
    // of the four walls. Rotation orients its face inward.
    if (kind === 'skull_relief') return this._placeWallProp(room, kind, used, occupied, ['N','S','W','E'])
    // Batch 2 placements.
    //   banner        — wall plaque on any wall (rotates to face inward).
    //   ritual_circle — floor decal, ALWAYS centred on the room so
    //                   the larger circle variants don't extend onto
    //                   wall tiles when randomly placed near the edge.
    //                   Capped to one per room. Variant picked
    //                   uniformly from the 3 sources.
    //   forge         — tall workshop centerpiece against the N wall.
    if (kind === 'banner')        return this._placeWallProp(room, kind, used, occupied, ['N','S','W','E'])
    if (kind === 'ritual_circle') return this._placeRoomCentre(room, kind, used, occupied)
    if (kind === 'forge')         return this._placeWallFloor(room, kind, used, occupied, ['N'])
    // Batch 3 placements — all small/medium clutter that sits on a
    // floor cell. Random interior placement keeps things scattered
    // rather than clustered.
    if (kind === 'anvil'    || kind === 'cauldron' ||
        kind === 'crate'    || kind === 'sack'     ||
        kind === 'vase')  return this._placeFloor(room, kind, used, occupied)
    // Wishing-well centerpiece — always centred on the room (same
    // helper as ritual_circle so it can't drift off-centre onto a
    // wall tile).
    if (kind === 'well')  return this._placeRoomCentre(room, kind, used, occupied)
    return null
  }

  // Place a prop dead-centre in the room. Used by large floor decals
  // (ritual circles) that would visibly clip onto wall tiles if
  // placed via the generic interior-floor roller. Returns null if the
  // centre cell is already used / not a floor tile.
  _placeRoomCentre(room, kind, used, occupied) {
    const tiles = this._gameState.dungeon?.tiles
    if (!tiles) return null
    const lx = Math.floor(room.width  / 2)
    const ly = Math.floor(room.height / 2)
    const key = `${lx},${ly}`
    if (used.has(key) || occupied.has(key)) return null
    const t = tiles[room.gridY + ly]?.[room.gridX + lx]
    if (t !== TILE.FLOOR && t !== TILE.BOSS_FLOOR) return null
    return {
      kind, variant: this._pickVariant(kind),
      localX: lx, localY: ly,
      instanceId: _nextId++,
    }
  }

  // Floor cell, anywhere on the interior. Random orientation via flips.
  _placeFloor(room, kind, used, occupied) {
    const tiles = this._gameState.dungeon?.tiles
    if (!tiles) return null
    const candidates = []
    for (let ly = WT; ly < room.height - WT; ly++) {
      for (let lx = WT; lx < room.width - WT; lx++) {
        const key = `${lx},${ly}`
        if (used.has(key) || occupied.has(key)) continue
        const t = tiles[room.gridY + ly]?.[room.gridX + lx]
        if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) candidates.push([lx, ly])
      }
    }
    if (candidates.length === 0) return null
    const [lx, ly] = candidates[Math.floor(Math.random() * candidates.length)]
    const variant = this._pickVariant(kind)
    return {
      kind, variant,
      localX: lx, localY: ly,
      flipX: kind === 'skel_floor' && Math.random() < 0.5,
      flipY: kind === 'skel_floor' && Math.random() < 0.5,
      instanceId: _nextId++,
    }
  }

  // Floor cell directly against an interior wall (1 tile inside the
  // perimeter on a randomly picked side from `allowedSides`). Used for
  // skulls (any side, flipping orients them into the room) and tall
  // floor props with a clear "back against wall" silhouette like
  // bookshelves/weapon racks/statues (N-only typically).
  _placeWallFloor(room, kind, used, occupied, allowedSides = ['N','S','W','E']) {
    const tiles = this._gameState.dungeon?.tiles
    if (!tiles) return null
    const sides = this._shuffle(allowedSides.slice())
    for (const side of sides) {
      const candidates = this._candidatesAgainstSide(room, side, /*onWall*/ false)
      const valid = candidates.filter(([lx, ly]) => {
        const key = `${lx},${ly}`
        if (used.has(key) || occupied.has(key)) return false
        const t = tiles[room.gridY + ly]?.[room.gridX + lx]
        return t === TILE.FLOOR || t === TILE.BOSS_FLOOR
      })
      if (valid.length === 0) continue
      const [lx, ly] = valid[Math.floor(Math.random() * valid.length)]
      return {
        kind, variant: this._pickVariant(kind),
        localX: lx, localY: ly,
        side,
        instanceId: _nextId++,
      }
    }
    return null
  }

  // Statue: floor cell 1 tile inward from N or S wall, anchored bottom
  // edge against the wall so the figure stands "with its back to the
  // wall". Picks an interior x-column away from CP doorways.
  _placeStatue(room, kind, used, occupied) {
    return this._placeWallFloor(room, kind, used, occupied)
  }

  // Wall-mounted prop (skel_wall, chain_single, chain_pair). Anchored
  // on the wall tile itself, on one of `allowedSides`. Skips doorway
  // cells and corner cells.
  _placeWallProp(room, kind, used, occupied, allowedSides) {
    const tiles = this._gameState.dungeon?.tiles
    if (!tiles) return null
    const sides = this._shuffle(allowedSides.slice())
    for (const side of sides) {
      const candidates = this._candidatesAgainstSide(room, side, /*onWall*/ true)
      const valid = candidates.filter(([lx, ly]) => {
        const key = `${lx},${ly}`
        if (used.has(key) || occupied.has(key)) return false
        const t = tiles[room.gridY + ly]?.[room.gridX + lx]
        return t === TILE.WALL || t === TILE.BOSS_WALL
      })
      if (valid.length === 0) continue
      const [lx, ly] = valid[Math.floor(Math.random() * valid.length)]
      return {
        kind, variant: this._pickVariant(kind),
        localX: lx, localY: ly,
        side,
        instanceId: _nextId++,
      }
    }
    return null
  }

  // Cells along (or immediately inside) a given wall side.
  //   onWall=true  → the perimeter wall row itself
  //   onWall=false → one tile inside the perimeter (floor row adjacent
  //                  to the wall, useful for "against the wall" props)
  // Always skips the two flanking corner cells.
  _candidatesAgainstSide(room, side, onWall) {
    const w = room.width, h = room.height
    const out = []
    if (side === 'N' || side === 'S') {
      const ly = onWall
        ? (side === 'N' ? 0 : h - 1)
        : (side === 'N' ? WT : h - 1 - WT)
      for (let lx = WT; lx < w - WT; lx++) out.push([lx, ly])
    } else {
      const lx = onWall
        ? (side === 'W' ? 0 : w - 1)
        : (side === 'W' ? WT : w - 1 - WT)
      for (let ly = WT; ly < h - WT; ly++) out.push([lx, ly])
    }
    return out
  }

  _pickVariant(kind) {
    const t = TEX[kind]
    if (Array.isArray(t)) return Math.floor(Math.random() * t.length)
    return 0
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
    }
    return arr
  }

  // ── Door / wall pruning ────────────────────────────────────────────────
  // Drop wall-mounted props whose wall tile is no longer a wall (became
  // a doorway via auto-connect). Floor-decal kinds are unaffected.
  _pruneConflicts() {
    const tiles = this._gameState.dungeon?.tiles
    if (!tiles) return
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      if (!Array.isArray(room.decorProps) || room.decorProps.length === 0) continue
      room.decorProps = room.decorProps.filter(p => {
        // Door-clearance check — drop wall-adjacent floor props (and
        // chests in the room interior) if a doorway has been carved
        // into the wall they're against. Adventurers walking through
        // the new door would otherwise bump into the bookshelf /
        // statue / chest blocking the path.
        if (this._isInDoorPath(room, p, tiles)) return false
        // Floor decals — always allowed.
        if (isFloorKind(p.kind)) return true
        // Wall-adjacent floor props (statue / bookshelf / weapon_rack
        // / chest / forge / batch-3 clutter / well) sit on a floor
        // cell, not on a wall tile, so the wall-existence check below
        // doesn't apply to them.
        if (p.kind === 'statue'      || p.kind === 'bookshelf' ||
            p.kind === 'weapon_rack' || p.kind === 'chest'     ||
            p.kind === 'forge'       || p.kind === 'anvil'     ||
            p.kind === 'cauldron'    || p.kind === 'crate'     ||
            p.kind === 'sack'        || p.kind === 'vase'      ||
            p.kind === 'well') return true
        // Wall-mounted props (chains / skel_wall / skull_relief) need
        // their cell to still be a wall — drop if it's been carved
        // into a doorway.
        const tx = room.gridX + p.localX
        const ty = room.gridY + p.localY
        const t  = tiles[ty]?.[tx]
        return t === TILE.WALL || t === TILE.BOSS_WALL
      })
    }
  }

  // Does this prop sit in (or directly adjacent to) a doorway? Drops
  // are based on tile type, not on whether the door is open/closed —
  // a door tile is always a path adventurers will walk through.
  //
  // For wall-adjacent floor props (statue / bookshelf / weapon_rack /
  // skull) the check is one cell in the prop's `side` direction —
  // that's the wall behind it, which becomes TILE.DOOR if a doorway
  // is carved straight through. For chests (no `side`, sitting in
  // open floor) all four cardinal neighbours are checked.
  _isInDoorPath(room, p, tiles) {
    if (isFloorKind(p.kind))    return false  // flat decals don't block
    if (p.kind === 'skull_relief') return false  // wall plaque, removed via the wall-tile check
    if (p.kind === 'skel_wall' || p.kind === 'chain_single' || p.kind === 'chain_pair' ||
        p.kind === 'banner') {
      return false  // these are ON a wall tile — the wall-tile check below handles them
    }
    const lx = p.localX, ly = p.localY
    if (p.kind === 'chest') {
      // Chest can sit anywhere; check 4 cardinal neighbours.
      const neigh = [[0,-1], [0,1], [-1,0], [1,0]]
      for (const [dx, dy] of neigh) {
        const t = tiles[room.gridY + ly + dy]?.[room.gridX + lx + dx]
        if (t === TILE.DOOR) return true
      }
      return false
    }
    // Statue / bookshelf / weapon_rack / skull — wall is one cell in
    // the `side` direction.
    let dx = 0, dy = 0
    if (p.side === 'N') dy = -1
    else if (p.side === 'S') dy = +1
    else if (p.side === 'W') dx = -1
    else if (p.side === 'E') dx = +1
    else return false   // no side stored — leave alone
    const t = tiles[room.gridY + ly + dy]?.[room.gridX + lx + dx]
    return t === TILE.DOOR
  }

  // ── Rotation sync ──────────────────────────────────────────────────────
  // 90° CW maps a (localX, localY) point to (h - 1 - localY, localX) on
  // the new grid (swap w/h). Side codes map N→E→S→W→N. We rotate every
  // prop's coords and side in lockstep with room.rotation changes.
  _syncRoomRotation(room) {
    if (!Array.isArray(room.decorProps) || room.decorProps.length === 0) return
    const cur = room.rotation ?? 0
    if (room._decorRotation == null) {
      room._decorRotation = cur
      room._decorW = room.width
      room._decorH = room.height
      return
    }
    const stored = room._decorRotation
    if (cur === stored) return
    const steps = (((cur - stored) / 90) % 4 + 4) % 4
    if (steps === 0) { room._decorRotation = cur; return }
    let w = room._decorW ?? room.width
    let h = room._decorH ?? room.height
    const sideMap = { N: 'E', E: 'S', S: 'W', W: 'N' }
    for (let s = 0; s < steps; s++) {
      for (const p of room.decorProps) {
        const nx = h - 1 - p.localY
        const ny = p.localX
        p.localX = nx
        p.localY = ny
        if (p.side) p.side = sideMap[p.side]
      }
      const tmp = w; w = h; h = tmp
    }
    room._decorRotation = cur
    room._decorW = w
    room._decorH = h
  }

  // ── Render ─────────────────────────────────────────────────────────────

  update() {
    const seen = new Set()
    for (const room of (this._gameState.dungeon?.rooms ?? [])) {
      this._syncRoomRotation(room)
      const props = room.decorProps
      if (!Array.isArray(props)) continue
      for (const p of props) {
        seen.add(p.instanceId)
        let rec = this._sprites[p.instanceId]
        if (!rec) {
          rec = this._createSprite(room, p)
          if (!rec) continue
          this._sprites[p.instanceId] = rec
        } else {
          this._positionSprite(rec.sprite, room, p)
        }
      }
    }
    for (const id of Object.keys(this._sprites)) {
      if (!seen.has(Number(id))) this._destroySprite(id)
    }
  }

  // Resolve a (kind, variant, side) → (texture key, flipX, flipY,
  // animKey). animKey is non-null only for the skull-relief
  // spritesheet — every other kind is a still image.
  _resolveTexture(p) {
    if (p.kind === 'skull_relief') {
      return {
        key:     TEX.skull_relief,           // spritesheet key
        flipX:   false,
        flipY:   false,
        animKey: 'skull-relief-anim',
      }
    }
    if (p.kind === 'skull') {
      // side decides facing — skull faces AWAY from the wall it sits
      // against, into the room interior.
      //   N wall  → south-facing (source skull-s, no flip)
      //   S wall  → north-facing (skull-s + flipY)
      //   W wall  → east-facing  (skull-w + flipX)
      //   E wall  → west-facing  (skull-w, no flip)
      switch (p.side) {
        case 'N': return { key: TEX.skull_s, flipX: false, flipY: false }
        case 'S': return { key: TEX.skull_s, flipX: false, flipY: true  }
        case 'W': return { key: TEX.skull_w, flipX: true,  flipY: false }
        case 'E': return { key: TEX.skull_w, flipX: false, flipY: false }
      }
      return { key: TEX.skull_s, flipX: false, flipY: false }
    }
    const tex = TEX[p.kind]
    const key = Array.isArray(tex) ? (tex[p.variant] ?? tex[0]) : tex
    return { key, flipX: !!p.flipX, flipY: !!p.flipY }
  }

  // Anchor + origin + rotation per kind. Returns the (x, y) world
  // coords for the sprite anchor, the origin (ox, oy) the sprite
  // should use, and the rotation angle in degrees (Phaser convention:
  // positive = clockwise).
  //
  // The rotation lets wall-mounted / against-wall props appear on
  // ANY wall, not just the N wall. Source art is authored with the
  // wall side at the TOP of the sprite (back of bookshelf, chains of
  // skeleton, hook of chain). For each `side`, we rotate the sprite
  // so that source-TOP ends up at the wall edge with the rest of the
  // sprite extending INTO the room.
  //
  //   side=N   angle=  0   sprite extends DOWN  (south, into room)
  //   side=S   angle=180   sprite extends UP    (north, into room)
  //   side=W   angle= 90   sprite extends RIGHT (east, into room)
  //   side=E   angle=-90   sprite extends LEFT  (west, into room)
  _anchorFor(room, p) {
    const TS_ = TS
    const lx = p.localX, ly = p.localY
    const cellCx = (room.gridX + lx) * TS_ + TS_ / 2
    const cellCy = (room.gridY + ly) * TS_ + TS_ / 2

    if (isFloorKind(p.kind)) {
      // Floor decals — centered on the tile, no rotation.
      return { x: cellCx, y: cellCy, ox: 0.5, oy: 0.5, angle: 0 }
    }
    if (p.kind === 'chest' || p.kind === 'anvil' || p.kind === 'cauldron' ||
        p.kind === 'crate' || p.kind === 'sack'  || p.kind === 'vase'    ||
        p.kind === 'well') {
      // Free-standing 3D floor object. Anchor bottom-center on the
      // floor cell so the object's "feet" rest on the tile and any
      // height extends UP into the room. Small -4 offset puts the
      // anchor just south of the cell's exact south edge for a
      // tighter visual fit. Y-sort handles entity layering.
      const bottomY = (room.gridY + ly + 1) * TS_ - 4
      return { x: cellCx, y: bottomY, ox: 0.5, oy: 1, angle: 0 }
    }
    if (p.kind === 'statue' || p.kind === 'bookshelf' || p.kind === 'weapon_rack' ||
        p.kind === 'forge') {
      // Tall floor prop against a wall. With origin (0.5, 0) anchored
      // at the WALL's interior face on the prop's `side`, rotation
      // brings source-TOP (back of prop) onto the wall and extends
      // the rest of the sprite into the room.
      return this._wallAdjacentAnchor(room, p, lx, ly, cellCx, cellCy)
    }
    if (p.kind === 'skel_wall' || p.kind === 'chain_single' || p.kind === 'chain_pair' ||
        p.kind === 'banner') {
      // Wall-mounted vertical prop, anchored on the WALL TILE itself.
      // Origin (0.5, 0) lands source-TOP at the wall's interior face;
      // rotation extends the rest of the sprite into the room.
      return this._wallMountAnchor(room, p, lx, ly, cellCx, cellCy)
    }
    if (p.kind === 'skull_relief') {
      // Wall plaque. Origin (0.5, 0.5) keeps it centred on the wall
      // tile; we apply an inset toward the room interior so it sits
      // slightly off the corner edge (same TORCH_INSET-style offset
      // used by torches). Rotation faces the medallion INTO the room.
      return this._plaqueAnchor(room, p, lx, ly, cellCx, cellCy)
    }
    return { x: cellCx, y: cellCy, ox: 0.5, oy: 0.5, angle: 0 }
  }

  // Floor-adjacent tall prop. Pivot = source-BOTTOM-CENTER (the
  // "feet" of the prop) at the FAR edge of the floor cell from the
  // wall, so the sprite extends "back into the wall" by however
  // much the sprite is taller than one tile. The user's design
  // target: feet on the floor (south edge of N-wall-adjacent floor
  // cell, etc.) with the back tucking into the wall row, never the
  // entire sprite stranded in the wall area or hovering a full tile
  // out from the wall.
  //
  // W/E angle directions are swapped vs my first cut — Phaser's
  // positive angle is visual CW (Y-down convention), so for a sprite
  // with origin at source-BOTTOM-CENTER and content pointing UP from
  // the pivot, +90 rotates content to the RIGHT and -90 to the LEFT.
  // W wall wants content (the back of the prop) to the LEFT of the
  // pivot → angle -90. E wall wants content to the RIGHT → +90.
  _wallAdjacentAnchor(room, p, lx, ly, cellCx, cellCy) {
    switch (p.side) {
      case 'N':
        return { x: cellCx, y: (room.gridY + ly + 1) * TS, ox: 0.5, oy: 1, angle:   0 }
      case 'S':
        return { x: cellCx, y: (room.gridY + ly)     * TS, ox: 0.5, oy: 1, angle: 180 }
      case 'W':
        return { x: (room.gridX + lx + 1) * TS, y: cellCy, ox: 0.5, oy: 1, angle: -90 }
      case 'E':
        return { x: (room.gridX + lx)     * TS, y: cellCy, ox: 0.5, oy: 1, angle:  90 }
    }
    return { x: cellCx, y: cellCy, ox: 0.5, oy: 1, angle: 0 }
  }

  // Wall-mounted vertical prop. Pivot = source-TOP at the wall's
  // interior face (with a small bias toward the room interior so the
  // sprite doesn't render on the outermost row of the wall tile).
  // W/E angles match _wallAdjacentAnchor's convention — see that
  // helper's comment for the Phaser-rotation derivation.
  _wallMountAnchor(room, p, lx, ly, cellCx, cellCy) {
    const BIAS = 2   // small offset toward room interior
    switch (p.side) {
      case 'N':
        return { x: cellCx, y: (room.gridY + ly + 1) * TS - BIAS, ox: 0.5, oy: 0, angle:   0 }
      case 'S':
        return { x: cellCx, y: (room.gridY + ly) * TS + BIAS,     ox: 0.5, oy: 0, angle: 180 }
      case 'W':
        return { x: (room.gridX + lx + 1) * TS - BIAS, y: cellCy, ox: 0.5, oy: 0, angle: -90 }
      case 'E':
        return { x: (room.gridX + lx) * TS + BIAS,     y: cellCy, ox: 0.5, oy: 0, angle:  90 }
    }
    return { x: cellCx, y: cellCy, ox: 0.5, oy: 0, angle: 0 }
  }

  // Wall plaque (medallion). Centred on the wall tile, shifted INSET
  // pixels toward the room interior so it sits "down the wall a bit"
  // off the corner. W/E angles match the other rotation helpers —
  // +90 for E (room is west of the wall, face rotates from south to
  // west) and -90 for W (face rotates from south to east).
  _plaqueAnchor(room, p, lx, ly, cellCx, cellCy) {
    const INSET = 12   // pushed a touch further inward per user feedback
    switch (p.side) {
      case 'N':
        return { x: cellCx, y: cellCy + INSET, ox: 0.5, oy: 0.5, angle:   0 }
      case 'S':
        return { x: cellCx, y: cellCy - INSET, ox: 0.5, oy: 0.5, angle: 180 }
      case 'W':
        return { x: cellCx + INSET, y: cellCy, ox: 0.5, oy: 0.5, angle: -90 }
      case 'E':
        return { x: cellCx - INSET, y: cellCy, ox: 0.5, oy: 0.5, angle:  90 }
    }
    return { x: cellCx, y: cellCy, ox: 0.5, oy: 0.5, angle: 0 }
  }

  _createSprite(room, p) {
    const s = this._scene
    const { key, flipX, flipY, animKey } = this._resolveTexture(p)
    if (!s.textures.exists(key)) return null
    const { x, y, ox, oy, angle } = this._anchorFor(room, p)
    const sprite = s.add.sprite(x, y, key)
      .setOrigin(ox, oy)
      .setScale(scaleFor(p.kind))
      .setFlipX(flipX)
      .setFlipY(flipY)
      .setAngle(angle ?? 0)
    // Force NEAREST-neighbour filtering so the pixel art stays crisp
    // when scaled by SCALE_BY_KIND. Phaser defaults to LINEAR (bilinear)
    // because main.js has `antialias: true`, which blurs sub-pixel-
    // sampled pixel art. setFilter operates on the shared texture, so
    // calling it once per kind is enough — repeats are idempotent.
    sprite.texture?.setFilter?.(Phaser.Textures.FilterMode.NEAREST)
    // Animated kinds (currently only skull_relief) — play the per-
    // variant blink loop. Animation keys are registered once in
    // _registerAnims(); each prop instance plays its own loop with
    // a random start frame so a wall of medallions doesn't blink in
    // lockstep.
    if (animKey && s.anims.exists(animKey)) {
      sprite.play({ key: animKey, startFrame: Math.floor(Math.random() * 2) })
    }
    // Floor decals → fixed low depth. Vertical / wall-mounted props →
    // Y-sort with entities so the layering reads naturally. Y-sort
    // depth uses the prop's CELL CENTRE rather than the anchor — the
    // anchor for rotated wall props sits at the wall edge, which
    // would put it outside the floor row entities walk on and cause
    // mis-sorting (entities one tile away would always sort in front).
    if (isFloorKind(p.kind)) {
      sprite.setDepth(DEPTH_FLOOR_DECAL)
    } else {
      const sortY = (room.gridY + p.localY) * TS + TS / 2
      sprite.setDepth(ysort(sortY))
    }
    this._positionSprite(sprite, room, p)
    return { sprite }
  }

  // Re-snap position + flips + rotation. Needed after rotation sync
  // changes a prop's localX/Y or side. Re-applies origin in case the
  // kind's anchor scheme depends on it (statues/walls vs floor decals).
  _positionSprite(sprite, room, p) {
    const { key, flipX, flipY } = this._resolveTexture(p)
    if (sprite.texture?.key !== key && this._scene.textures.exists(key)) {
      sprite.setTexture(key)
    }
    const { x, y, ox, oy, angle } = this._anchorFor(room, p)
    sprite.setOrigin(ox, oy)
    sprite.setPosition(x, y)
    sprite.setFlipX(flipX)
    sprite.setFlipY(flipY)
    sprite.setAngle(angle ?? 0)
    if (isFloorKind(p.kind)) {
      sprite.setDepth(DEPTH_FLOOR_DECAL)
    } else {
      const sortY = (room.gridY + p.localY) * TS + TS / 2
      sprite.setDepth(ysort(sortY))
    }
  }

  _destroySprite(id) {
    const rec = this._sprites[id]
    if (!rec) return
    rec.sprite?.destroy()
    delete this._sprites[id]
  }
}

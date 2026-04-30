// Graphics-based dungeon renderer with procedural depth.
//
// Layers (depth assignments):
//   _gBg        0    void background + grid lines
//   _gTiles     1    floor stipple, walls with bevels, door bases
//   _gTints     1.2  per-room category-tint wash over floors
//   _gOverlay   3    connection dots + inactive tint
//   _gCollision 3.2  debug collision overlay
//   _gIcon      4    reserved
//
// All layers redraw on dungeon-mutation events. No sprites, no animation.

import { EventBus }     from '../systems/EventBus.js'
import { Balance }      from '../config/balance.js'
import { TILE }         from '../systems/DungeonGrid.js'
import { DebugOverlay } from '../systems/DebugOverlay.js'
import { PALETTE }      from './UIKit.js'
import { loadCornerPattern } from '../scenes/CornerEditor.js'

// Public hook for the CornerEditor: paint a procedural corner-tile (no user
// overlay) into any Phaser-Graphics-shaped target. The renderer's drawing
// methods only use `g.fillStyle(color, alpha)` and `g.fillRect(x, y, w, h)`,
// so a hand-rolled 2D-canvas adapter is enough — no real Phaser scene
// needed. Used by CornerEditor's LOAD CURRENT button to seed the grid with
// the current procedural look.
export function paintProceduralCorner(g, kind) {
  const fake = Object.create(DungeonRenderer.prototype)
  fake._cornerPattern = null   // skip user-overlay layer
  fake._drawWallCorner(g, 0, 0, kind)
}

const TS = Balance.TILE_SIZE // 32

// Floor variants used by the stipple — three subtle shades hashed per cell so
// floors break up into a soft mottled texture instead of one flat colour.
const FLOOR_BASE   = 0x0d1e30
const FLOOR_LIGHT  = 0x122439
const FLOOR_DARK   = 0x0a1825

// Wall masonry palette. Bricks are laid in a staggered course pattern
// (BRICK_W × BRICK_H), with mortar between, a 1-px top highlight inside each
// row, and a 1-px bottom shadow. About ~10 % of bricks get a hashed tint
// (lighter or darker) to break up uniformity.
const WALL_BASE        = 0x1e3248
const WALL_HIGHLIGHT   = 0x32485e
const WALL_SHADOW      = 0x121f30
const MORTAR           = 0x0a1420
const BRICK_W          = 32
const BRICK_H          = 8
const ROWS_PER_TILE    = TS / BRICK_H   // 4

// Capstone band — the lighter "top of the wall, viewed from above" stripe
// running along the outer edge of every wall ring. Walls now show two
// surfaces: an outer CAPSTONE_W-wide capstone band and an inner brick face.
// Cool-gray palette so it reads as the same stone material lit differently
// (instead of a contrasting tan, which would clash with the blue-gray base).
const CAPSTONE_W            = 9
const CAPSTONE_BASE         = 0x6a7888
const CAPSTONE_HIGHLIGHT    = 0x8a98a8
const CAPSTONE_SHADOW       = 0x4a5868
const CAPSTONE_SEAM         = 0x344050
const CAPSTONE_SEAM_SPACING = 24    // px between capstone-block seams

// Px the brick zone is shifted toward the capstone. 1 leaves the smallest
// brick row half-visible above the baseboard and gives the largest brick
// row most of its height above the capstone overlap.
const BRICK_ZONE_SHIFT = 0

// Cornerstone — distinct CORNERSTONE_W × CORNERSTONE_W block at the room's
// outer corner of every corner tile, slightly darker than the capstone band
// so it reads as the structural "corner cap" that the pillar terminates
// into. CORNERSTONE_W > CAPSTONE_W so the block pokes into the brick zone
// past the band's normal width.
// Sized so inner edges land on the same brick row/column boundary the
// pre-shift cornerstone hit (= 18 − BRICK_ZONE_SHIFT). When the brick zone
// shift changes, the cornerstone has to follow or the seam stutters.
const CORNERSTONE_W    = 18 - BRICK_ZONE_SHIFT
const CORNERSTONE_BASE = 0x5a6878

// Baseboard — a darker band along the room-facing edge of every wall tile,
// reading as the recessed shadow where wall meets floor. Sits on top of the
// brick face, so the smallest brick row is effectively swallowed by it.
const BASEBOARD_W      = 3
const BASEBOARD_BASE   = 0x101824
const BASEBOARD_TOP    = 0x1a2438    // 1-px lighter line at the brick-facing edge

// Overhang shadow — a soft semi-transparent band painted along the brick
// face just inside the capstone's inner edge, so the capstone reads as
// hanging slightly over the bricks. Black + alpha so it darkens whatever's
// underneath (bricks, mortar, diagonal seam) without erasing detail.
const OVERHANG_SHADOW_W     = 2
const OVERHANG_SHADOW_COLOR = 0x000000
const OVERHANG_SHADOW_ALPHA = 0.40

// Corner pillar — chunky stepped diagonal running from the cornerstone
// inwards to the room's inner corner. Reads as the structural column that
// the capstone rests on. Tapers along its length (wider at the cornerstone
// end, narrower at the floor end) for perspective recede.
//
// Asymmetric across the lit edge: the V-bricks side gets the full body, the
// H-bricks side gets a thinner mirror that reads as a softer shadow on the
// lit-edge's opposite face. PILLAR_EDGE_HIGHLIGHT is the 1-px lit edge.
const PILLAR_V_W_MAX        = 11   // V-side body width at cornerstone end
const PILLAR_V_W_MIN        = 2    // V-side body width at floor end
const PILLAR_H_W_MAX        = 8    // H-side mirror width at cornerstone end
const PILLAR_H_W_MIN        = 2    // H-side mirror width at floor end
const PILLAR_EDGE_HIGHLIGHT = 0x8aa0c0
const PILLAR_EDGE_ALPHA     = 0.85

// Brick-size taper. Outer + inner ring brick zones together span 55 px
// (outer 23 px + inner 32 px) and read as ONE continuous wall: bricks
// shrink monotonically from the outer face toward the floor.
// Combined sequence (outermost → innermost): 12, 11, 11, 11, 10.
//
// 4-row inner-ring designs with bricks ≥ 9 are infeasible (4×9 = 36 > 32),
// so the inner ring uses 3 rows here, dropping the wall total to 5 rows.
//
// Outer ring (2 rows, sum 23). The "tall/wide" end is the outer face (next
// to the capstone), where bricks are largest.
const ROW_HEIGHTS_TALLTOP  = [12, 11]
const ROW_HEIGHTS_TALLBOT  = [11, 12]
const COL_WIDTHS_WIDELEFT  = [12, 11]
const COL_WIDTHS_WIDERIGHT = [11, 12]

// Inner ring (3 rows, sum 32, full TS height — no capstone reserved).
// Plateau at 11 then a single 1-px drop to 10 at the floor edge. Used by
// _drawWallH/V when fullHeight=true.
const ROW_HEIGHTS_FULL_TALLTOP  = [11, 11, 10]
const ROW_HEIGHTS_FULL_TALLBOT  = [10, 11, 11]
const COL_WIDTHS_FULL_WIDELEFT  = [11, 11, 10]
const COL_WIDTHS_FULL_WIDERIGHT = [10, 11, 11]

// Brick row/col counts per ring. Used by the dispatcher to compute a
// "globalRowOffset" / "globalColOffset" that ensures the brick stagger
// alternates correctly across the seam between the outer and inner rings,
// regardless of how many rows live in each ring.
const OUTER_ROW_COUNT = ROW_HEIGHTS_TALLTOP.length
const INNER_ROW_COUNT = ROW_HEIGHTS_FULL_TALLTOP.length
const OUTER_COL_COUNT = COL_WIDTHS_WIDELEFT.length
const INNER_COL_COUNT = COL_WIDTHS_FULL_WIDELEFT.length

// Doorway palette — stone jambs (capstone-toned), dark passage interior,
// and a worn threshold slab at the floor-side edge.
const DOOR_PASSAGE_DARK   = 0x121826    // shaded passage interior, "stone shadow"
const DOOR_PASSAGE_LIGHT  = 0x1f2940    // lit centre stripe of passage (worn footpath)
const DOOR_THRESHOLD      = 0x4a5868    // worn stone sill where doorway meets floor
const DOOR_THRESHOLD_HI   = 0x6a7888    // 1-px highlight along the threshold
const DOOR_KEYSTONE_HI    = 0x8a98a8    // brighter wedge above the opening
const DOOR_ARCH_INNER     = 0x2a3548    // thin arched-shadow line under capstone

// Door-open animation duration (seconds). Each cp's openProgress ramps
// from 0 (closed) to 1 (fully open) over this interval, with a quadratic
// ease-out for a slightly punchy slide.
const DOOR_OPEN_DURATION_S = 0.5

// Doorway architecture — jambs (frame stones flanking the opening),
// threshold (worn slab at the floor-side edge), and an inner bevel that
// sells "the passage is recessed". Drawn whether the door is open or closed
// (door fits within the frame). Jambs go on _gOverhead so adventurers
// passing through the doorway visually walk UNDER them; threshold + bevel
// go on _gTiles so adventurers walk ON them at floor level.
const JAMB_W      = 3
const THRESHOLD_W = 4
const ARCH_STYLES = {
  regular: {
    jamb:        0x6a7888,    // light stone
    jambHi:      0x8a98a8,    // bright stone bevel
    jambShadow:  0x4a5868,    // inner shadow at jamb edge
    threshold:   0x4a5868,    // worn stone slab
    thresholdHi: 0x6a7888,    // top edge highlight
    bevel:       0x121826,    // dark recess at passage edge
  },
  entrance: {
    jamb:        0x8a8a4a,    // brass-iron framing
    jambHi:      0xb0a060,    // bright brass
    jambShadow:  0x5a5a2a,
    threshold:   0x6a5a3a,    // weathered bronze sill
    thresholdHi: 0x9a8a4a,
    bevel:       0x121826,
  },
  boss: {
    jamb:        0x3a1414,    // dark crimson stone
    jambHi:      0x6a2020,    // blood red bevel
    jambShadow:  0x1a0808,
    threshold:   0x2a0a0a,    // black-blood sill
    thresholdHi: 0x4a1010,
    bevel:       0x080000,
  },
}

// Stone bedrock palette — warm gray-brown, deliberately contrasting with the
// blue-gray brick walls so the player reads the empty grid as "uncarved
// rock" rather than just background. Used by _drawBackground +
// _drawVoidStoneTexture for per-cell variation, plus _drawCarveHalo for
// the freshly-chiseled rim around each room.
const STONE_BASE   = 0x2a221c
const STONE_DARK   = 0x1a1410
const STONE_LIGHT  = 0x3a322a
const STONE_VEIN   = 0x4a4238
const STONE_HALO   = 0x4a3e30   // 1-tile rim around rooms (lighter, "freshly carved")
const STONE_HALO_HI = 0x6a5a48  // 1-px highlight on the inside edge of the halo

// Direction-vector lookup for cp-pairing (mirror of DungeonGrid's private
// DIR_VEC). Used by the closed-door overlay to find a doorway's partner room
// without round-tripping through DungeonGrid.
const DIR_VECS = {
  N: { dx:  0, dy: -1 },
  S: { dx:  0, dy:  1 },
  E: { dx:  1, dy:  0 },
  W: { dx: -1, dy:  0 },
}

// Closed-door overlay styles. Each connection point in rooms.json may carry
// `style: 'regular'|'entrance'|'boss'`; the renderer also escalates a paired
// cp to 'boss' if its mate sits in the boss chamber. Doors render on
// _gOverhead so they cover both the dark passage and any adventurer
// underneath them.
const DOOR_STYLES = {
  regular: {
    base:    0x2e1f12,    // dark walnut wood
    grain:   0x4a341e,    // lighter wood streak
    edge:    0x6a4a2c,    // bevel highlight on outer rim
    band:    0x1a1410,    // iron banding
    bandHi:  0x5a4a3a,    // bronze highlight on band
    split:   0x080404,    // dark seam where the two halves meet
  },
  entrance: {
    base:    0x4a4a52,    // weathered stone gray
    grain:   0x5a5a62,    // lighter stone speckle
    edge:    0x7a7a82,    // bright stone bevel
    band:    0x2a2a32,    // dark iron framing
    bandHi:  0x9a8a4a,    // brass sigil / studs
    split:   0x080808,    // pure-dark center seam
  },
  boss: {
    base:    0x1a0a0a,    // near-black charred wood
    grain:   0x3a1010,    // dark blood-red streak
    edge:    0x4a1010,    // crimson rim
    band:    0x080404,    // matte black banding
    bandHi:  0xc83030,    // glowing red rivets
    split:   0xc83030,    // glowing red seam
  },
}

// Wall cap (when explicitly authored by Room Builder).
const WALL_CAP_FILL = 0x3a4a64

// Room border colours by category — connection-dot markers + tint wash.
const ROOM_STYLE = {
  special:  { border: PALETTE.bossBorder, tint: 0x6622aa },
  starter:  { border: PALETTE.roomBorder, tint: null     },
  trap:     { border: 0xcc4422,           tint: 0xaa2222 },
  treasure: { border: 0xddaa22,           tint: 0xaa8822 },
  combat:   { border: 0xcc2244,           tint: 0x882244 },
  utility:  { border: 0x22cc88,           tint: 0x22aa66 },
  default:  { border: PALETTE.roomBorder, tint: null     },
}

// Tile-coord hash used for the floor stipple — deterministic so the pattern
// doesn't shimmer between redraws when a single room is added or removed.
function _tileHash(x, y) {
  let h = (x | 0) * 73856093 ^ (y | 0) * 19349663
  h = (h ^ (h >>> 13)) >>> 0
  return h
}


export class DungeonRenderer {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} gameState
   */
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState

    this._gBg        = scene.add.graphics().setDepth(0)
    // Grid lines live on their own layer so NightPhase can toggle them
    // (placement-preview hover) without redrawing the bedrock.
    this._gGrid      = scene.add.graphics().setDepth(0.5)
    this._showGrid   = false
    this._gTiles     = scene.add.graphics().setDepth(1)
    this._gTints     = scene.add.graphics().setDepth(1.2)
    this._gOverlay   = scene.add.graphics().setDepth(3)
    this._gCollision = scene.add.graphics().setDepth(3.2)
    this._gIcon      = scene.add.graphics().setDepth(4)
    // Overhead layer — drawn ABOVE entities (adv ~depth 8, minion ~7) so
    // doorway architecture (capstone band, jambs, keystone, arch shadow)
    // visually frames entities passing underneath. The dark passage floor
    // and threshold stay on _gTiles (depth 1) so entities walk over them.
    this._gOverhead  = scene.add.graphics().setDepth(9)
    // Dedicated door-overlay layer drawn just above _gOverhead. Animates
    // independently of the main wall art so opening doors don't force a
    // full redraw. Cleared + repainted by _redrawDoors() on every animation
    // frame (see update()).
    // Depth 6.5 — BELOW characters (minion 7, adventurer 8) so an entity
    // standing in a doorway is rendered in front of the door panel instead
    // of being hidden by it. Wall jambs + capstones are still on _gOverhead
    // (depth 9, above characters), so the framing of the doorway still
    // occludes entities passing under it as designed.
    this._gDoors     = scene.add.graphics().setDepth(6.5)
    // Passage shadow — the dark "underpass" gradient inside an open
    // doorway. Renders BEHIND the door panel (which is at 6.5) and behind
    // characters, but above the floor tiles. Used to live on _gOverhead
    // (depth 9) which made the shadow draw on top of the door slab and on
    // top of characters, both incorrect after the door layer was lowered.
    this._gPassageShadow = scene.add.graphics().setDepth(5.5)

    // User-painted corner override (sparse 32×32 array of hex/null). When
    // set, _drawWallCorner overlays it on top of the procedural draw with
    // mirroring per corner kind. Re-loads each redraw so edits made in the
    // CornerEditor scene apply immediately on return to gameplay.
    this._cornerPattern = loadCornerPattern()

    EventBus.on('ROOM_PLACED',           this.redraw, this)
    EventBus.on('ROOM_PLACED',           this._burstCarveDust, this)
    EventBus.on('ROOM_REMOVED',          this.redraw, this)
    EventBus.on('GRID_EXPANDED',         this.redraw, this)
    EventBus.on('DEBUG_OVERLAY_CHANGED', this.redraw, this)

    this.redraw()
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  redraw() {
    this._gBg.clear()
    this._gGrid.clear()
    this._gTiles.clear()
    this._gTints.clear()
    this._gOverlay.clear()
    this._gIcon.clear()
    this._gCollision.clear()
    this._gOverhead.clear()
    this._gDoors.clear()
    this._gPassageShadow.clear()

    this._wallOrient = this._buildWallOrientation()
    // Pick up any newly saved corner pattern from the editor.
    this._cornerPattern = loadCornerPattern()

    this._drawBackground()
    this._drawGrid()
    this._drawTiles()
    if (Balance.WALL_THICKNESS > 1) this._drawCornerBlockOverlays()
    this._drawCategoryTints()
    this._drawRoomOverlays()
    this._drawDoorwayArchitecture()
    this._drawClosedDoors()
    if (DebugOverlay.showCollision) this._drawCollisionOverlay()
  }

  // Tag every wall cell with a rich orientation object describing its role:
  //
  //   { kind: 'top'|'bot'|'lft'|'rgt', depth }
  //     — straight wall in the WALL_THICKNESS-deep ring; depth=0 is the
  //       outermost layer (faces void), depth=WT-1 is the innermost (faces
  //       floor). Outer cells get a capstone band, inner cells a baseboard.
  //
  //   { kind: 'corner', side, role }
  //     — cell inside a WT×WT corner block at the named room corner
  //       ('tl'|'tr'|'bl'|'br'). role is one of:
  //         'outer'  — the very outer corner (capstone L)
  //         'h-arm'  — outer-layer cell on the horizontal arm of the corner
  //         'v-arm'  — outer-layer cell on the vertical arm of the corner
  //         'inner'  — innermost cell of the corner block (baseboard L
  //                    wrapping the room's interior corner)
  //         'mid'    — interior of the corner block (only when WT > 2)
  _buildWallOrientation() {
    const orient = new Map()
    const WT = Balance.WALL_THICKNESS
    for (const room of this._gameState.dungeon.rooms) {
      const { gridX: rx, gridY: ry, width: rw, height: rh } = room
      for (let dy = 0; dy < rh; dy++) {
        for (let dx = 0; dx < rw; dx++) {
          const dt = dy
          const db = rh - 1 - dy
          const dl = dx
          const dr = rw - 1 - dx
          const inTop = dt < WT, inBot = db < WT
          const inLft = dl < WT, inRgt = dr < WT
          if (!inTop && !inBot && !inLft && !inRgt) continue   // floor

          let tag
          if ((inTop || inBot) && (inLft || inRgt)) {
            // Corner block. Compute distance from outer corner along each axis.
            const side = (inTop && inLft) ? 'tl'
                       : (inTop && inRgt) ? 'tr'
                       : (inBot && inLft) ? 'bl' : 'br'
            const ax = inLft ? dl : dr
            const ay = inTop ? dt : db
            let role
            if (ax === 0 && ay === 0)                     role = 'outer'
            else if (ay === 0)                            role = 'h-arm'
            else if (ax === 0)                            role = 'v-arm'
            else if (ax === WT - 1 && ay === WT - 1)      role = 'inner'
            else                                          role = 'mid'
            tag = { kind: 'corner', side, role, ax, ay }
          } else if (inTop) tag = { kind: 'top', depth: dt }
          else if (inBot)   tag = { kind: 'bot', depth: db }
          else if (inLft)   tag = { kind: 'lft', depth: dl }
          else              tag = { kind: 'rgt', depth: dr }

          orient.set(`${rx + dx},${ry + dy}`, tag)
        }
      }
    }
    return orient
  }

  destroy() {
    EventBus.off('ROOM_PLACED',           this.redraw, this)
    EventBus.off('ROOM_PLACED',           this._burstCarveDust, this)
    EventBus.off('ROOM_REMOVED',          this.redraw, this)
    EventBus.off('GRID_EXPANDED',         this.redraw, this)
    EventBus.off('DEBUG_OVERLAY_CHANGED', this.redraw, this)
    this._gBg.destroy()
    this._gGrid.destroy()
    this._gTiles.destroy()
    this._gTints.destroy()
    this._gOverlay.destroy()
    this._gCollision.destroy()
    this._gIcon.destroy()
    this._gOverhead.destroy()
    this._gDoors.destroy()
    this._gPassageShadow.destroy()
  }

  // ── Tile fills ─────────────────────────────────────────────────────────────

  _drawTiles() {
    const { tiles, gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    const g = this._gTiles

    for (let y = 0; y < gh; y++) {
      const row = tiles[y]
      if (!row) continue
      for (let x = 0; x < gw; x++) {
        const t = row[x]
        if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) {
          this._drawFloorCell(g, x, y)
        } else if (t === TILE.WALL || t === TILE.BOSS_WALL) {
          this._drawWallCellByTag(g, x, y, this._wallOrient.get(`${x},${y}`))
        } else if (t === TILE.DOOR) {
          this._drawDoorCell(g, x, y)
        } else if (t === TILE.WALL_CAP) {
          g.fillStyle(WALL_CAP_FILL, 1)
          g.fillRect(x * TS, y * TS, TS, TS)
        }
      }
    }
  }

  // Floor: hashed stipple over a base fill. Hash buckets:
  //   0..127  → base
  //   128..191→ slightly lighter speck
  //   192..255→ slightly darker speck
  // Rather than a per-pixel stipple (very expensive in Graphics), we tint a
  // single ~6×6 patch in one corner so each cell reads as base-with-detail.
  _drawFloorCell(g, x, y) {
    const px = x * TS, py = y * TS
    g.fillStyle(FLOOR_BASE, 1)
    g.fillRect(px, py, TS, TS)

    const h = _tileHash(x, y)
    const bucket = h & 0xff
    if (bucket >= 128) {
      const variant = bucket >= 192 ? FLOOR_DARK : FLOOR_LIGHT
      const sx = (h >>> 8)  & 0x1f   // 0..31
      const sy = (h >>> 13) & 0x1f
      const sw = 4 + ((h >>> 18) & 0x07)   // 4..11
      const sh = 4 + ((h >>> 21) & 0x07)
      g.fillStyle(variant, 0.55)
      g.fillRect(px + (sx % (TS - sw)), py + (sy % (TS - sh)), sw, sh)
    }
  }

  // Horizontal-orientation wall: bricks lay flat (BRICK_W wide × BRICK_H
  // tall), used for the top/bottom rows of a room's wall ring. Each tile
  // holds ROWS_PER_TILE rows of bricks; rows alternate horizontal offset
  // (worldRow & 1) so bricks stagger like real masonry. Brick coordinates
  // are computed in world space so adjacent wall tiles share a continuous
  // brick pattern. Per row we paint: optional per-brick tint + pock mark +
  // crack, top mortar, top highlight, bottom shadow, then vertical mortar
  // at brick edges.
  _drawWallH(g, x, y, fillFn, tallTop = true, drawCapstone = true, drawBaseboard = true, fullHeight = false, globalRowOffset = 0, brickW = BRICK_W) {
    const px = x * TS, py = y * TS
    const fr = fillFn ?? ((rx, ry, rw, rh) => g.fillRect(rx, ry, rw, rh))
    // fullHeight=true: bricks span the full TS without reserving a capstone
    // band. Used by inner-ring straight walls (the outer-ring above/below
    // already supplies the capstone).
    const rowHeights = fullHeight
      ? (tallTop ? ROW_HEIGHTS_FULL_TALLTOP : ROW_HEIGHTS_FULL_TALLBOT)
      : (tallTop ? ROW_HEIGHTS_TALLTOP      : ROW_HEIGHTS_TALLBOT)

    // Brick zone is shifted toward the capstone by BASEBOARD_W so the smallest
    // brick row at the room-facing edge stays fully visible (not swallowed by
    // the baseboard). The capstone is drawn AFTER bricks and overlaps the
    // outermost BASEBOARD_W px of the largest brick row instead.
    const brickY = fullHeight
      ? py
      : (tallTop ? py + CAPSTONE_W - BRICK_ZONE_SHIFT : py + BRICK_ZONE_SHIFT)
    const brickH = fullHeight ? TS : TS - CAPSTONE_W
    g.fillStyle(WALL_BASE, 1)
    fr(px, brickY, TS, brickH)

    let by = brickY
    for (let row = 0; row < rowHeights.length; row++) {
      const rh       = rowHeights[row]
      // worldRow drives the brick-stagger parity. Using a wall-relative
      // offset (instead of y * ROWS_PER_TILE) keeps the offset alternating
      // across the outer/inner ring seam even when the two rings have
      // different row counts.
      const worldRow = globalRowOffset + row
      const offsetX  = (worldRow & 1) ? brickW / 2 : 0

      const firstBrickX = Math.floor((px - offsetX) / brickW) * brickW + offsetX

      for (let bx = firstBrickX; bx < px + TS; bx += brickW) {
        const x0 = Math.max(bx, px)
        const x1 = Math.min(bx + brickW, px + TS)
        const w  = x1 - x0
        if (w <= 0) continue
        const h          = _tileHash(bx, by)
        const tintBucket = h & 0xff
        const pockBucket = (h >>> 8) & 0xff

        let tint = null, tintA = 0
        if      (tintBucket <  50) { tint = WALL_SHADOW;    tintA = 0.40 }
        else if (tintBucket < 100) { tint = WALL_SHADOW;    tintA = 0.20 }
        else if (tintBucket < 156) { tint = null }
        else if (tintBucket < 200) { tint = WALL_HIGHLIGHT; tintA = 0.25 }
        else                       { tint = WALL_HIGHLIGHT; tintA = 0.45 }
        if (tint !== null && rh > 2) {
          g.fillStyle(tint, tintA)
          fr(x0, by + 1, w, rh - 2)
        }

        if (pockBucket > 191) {
          const pockLocalX = ((h >>> 16) & 0x0f) % 12 + 2
          // Clamp pock-y into the brick body (1..rh-2) so it never lands on
          // the mortar/highlight/shadow stripes regardless of row height.
          const pockLocalY = Math.min(rh - 2, Math.max(1, ((h >>> 20) & 0x07) % 4 + 2))
          const pockWX = bx + pockLocalX
          const pockWY = by + pockLocalY
          if (pockWX >= px && pockWX + 1 < px + TS) {
            g.fillStyle(MORTAR, 0.75)
            fr(pockWX, pockWY, 2, 1)
          }
        }

        const h2 = _tileHash(bx + 9999, by)
        if ((h2 & 0xff) > 242 && rh >= 6) {
          const cLocalX = ((h2 >>> 8)  & 0x0f) % 8 + 4
          // Clamp crack y so all 4 stepping pixels fit inside the brick body.
          const cLocalY = Math.min(rh - 4, Math.max(1, ((h2 >>> 16) & 0x07) % 3 + 2))
          const stepX   = ((h2 >>> 20) & 1) ? 1 : -1
          const startWX = bx + cLocalX
          const startWY = by + cLocalY
          g.fillStyle(MORTAR, 0.85)
          for (let i = 0; i < 4; i++) {
            const cx = startWX + i * stepX
            const cy = startWY + i
            if (cx >= px && cx < px + TS) fr(cx, cy, 1, 1)
          }
        }
      }

      // Top mortar (1 px), highlight (1 px under it), shadow (1 px at brick base).
      g.fillStyle(MORTAR, 0.85)
      fr(px, by, TS, 1)

      g.fillStyle(WALL_HIGHLIGHT, 0.55)
      fr(px, by + 1, TS, 1)
      g.fillStyle(WALL_SHADOW, 0.45)
      fr(px, by + rh - 1, TS, 1)

      // Vertical mortar at brick edges. Drawn at each tile's LEFT edge (and
      // any interior brick boundaries), inclusive of the tile origin and
      // exclusive of the right edge. The next tile draws its own left-edge
      // mortar — drawing on the right edge would be clobbered by that tile's
      // _fillWallBase pre-fill.
      g.fillStyle(MORTAR, 0.85)
      for (let bx = firstBrickX; bx <= px + TS; bx += brickW) {
        if (bx >= px && bx < px + TS) {
          fr(bx, by, 1, rh)
        }
      }

      by += rh
    }

    // Overhang shadow — soft 2-px band darkening the bricks just below the
    // capstone (or just above, for bottom walls).
    if (drawCapstone) {
      const shY = tallTop ? py + CAPSTONE_W : py + TS - CAPSTONE_W - OVERHANG_SHADOW_W
      g.fillStyle(OVERHANG_SHADOW_COLOR, OVERHANG_SHADOW_ALPHA)
      fr(px, shY, TS, OVERHANG_SHADOW_W)
    }

    // Capstone band hugs the outer side of the wall. Drawn AFTER bricks so it
    // covers the top BASEBOARD_W px of the largest brick row. Corners skip
    // this and draw an L instead.
    if (drawCapstone) {
      const capY = tallTop ? py : py + TS - CAPSTONE_W
      this._drawCapstoneBand(g, fr, px, capY, TS, CAPSTONE_W, tallTop ? 'top' : 'bottom')
    }

    // Baseboard — recessed shadow strip at the room-facing edge of the tile.
    // Sits beyond the brick zone now (no longer swallows the smallest brick).
    // Corners draw an L-shaped baseboard separately.
    if (drawBaseboard) {
      const bbY = tallTop ? py + TS - BASEBOARD_W : py
      this._drawBaseboard(g, fr, px, bbY, TS, BASEBOARD_W, tallTop ? 'bottom' : 'top')
    }
  }

  // Vertical-orientation wall: same brick math as _drawWallH but transposed
  // 90°. Bricks are now BRICK_H wide × BRICK_W tall (8×16); each tile holds
  // (TS / BRICK_H) = 4 columns of bricks. Stagger runs along the column
  // axis (worldCol & 1), so brick rows interlock between adjacent columns.
  // Mortar/highlight/shadow stripes flip to be column-aligned (vertical
  // full-tile-height stripes per column) instead of row-aligned. Used for
  // left/right walls and corners — sells the 2.5D enclosed-room feel.
  _drawWallV(g, x, y, fillFn, wideLeft = true, drawCapstone = true, drawBaseboard = true, fullHeight = false, globalColOffset = 0, brickW = BRICK_W) {
    const px = x * TS, py = y * TS
    const VH = brickW        // brick "height" (vertical-orientation long axis)
    const COLS_PER_TILE = 4
    const colWidths = fullHeight
      ? (wideLeft ? COL_WIDTHS_FULL_WIDELEFT : COL_WIDTHS_FULL_WIDERIGHT)
      : (wideLeft ? COL_WIDTHS_WIDELEFT      : COL_WIDTHS_WIDERIGHT)
    const fr = fillFn ?? ((rx, ry, rw, rh) => g.fillRect(rx, ry, rw, rh))

    // Brick zone shifted toward the capstone by BASEBOARD_W so the smallest
    // brick column stays visible past the baseboard; capstone (drawn last)
    // covers the outermost BASEBOARD_W px of the widest brick column.
    const brickX = fullHeight
      ? px
      : (wideLeft ? px + CAPSTONE_W - BRICK_ZONE_SHIFT : px + BRICK_ZONE_SHIFT)
    const zoneW = fullHeight ? TS : TS - CAPSTONE_W
    g.fillStyle(WALL_BASE, 1)
    fr(brickX, py, zoneW, TS)

    let bx = brickX
    for (let col = 0; col < colWidths.length; col++) {
      const cw       = colWidths[col]
      // worldCol drives the brick-stagger parity. Using a wall-relative
      // offset keeps the stagger alternating across the outer/inner ring
      // seam even when the two rings have different column counts.
      const worldCol = globalColOffset + col
      const offsetY  = (worldCol & 1) ? VH / 2 : 0
      const firstBrickY = Math.floor((py - offsetY) / VH) * VH + offsetY

      for (let by = firstBrickY; by < py + TS; by += VH) {
        const y0 = Math.max(by, py)
        const y1 = Math.min(by + VH, py + TS)
        const visH = y1 - y0
        if (visH <= 0) continue

        const h          = _tileHash(bx, by)
        const tintBucket = h & 0xff
        const pockBucket = (h >>> 8) & 0xff

        let tint = null, tintA = 0
        if      (tintBucket <  50) { tint = WALL_SHADOW;    tintA = 0.40 }
        else if (tintBucket < 100) { tint = WALL_SHADOW;    tintA = 0.20 }
        else if (tintBucket < 156) { tint = null }
        else if (tintBucket < 200) { tint = WALL_HIGHLIGHT; tintA = 0.25 }
        else                       { tint = WALL_HIGHLIGHT; tintA = 0.45 }
        if (tint !== null && cw > 2) {
          g.fillStyle(tint, tintA)
          fr(bx + 1, y0, cw - 2, visH)
        }

        if (pockBucket > 191) {
          const pockLocalY = ((h >>> 16) & 0x0f) % 12 + 2
          // Clamp pock-x into the brick body so it never lands on the
          // left mortar/highlight or right shadow regardless of column width.
          const pockLocalX = Math.min(cw - 2, Math.max(1, ((h >>> 20) & 0x07) % 4 + 2))
          const pockWY = by + pockLocalY
          const pockWX = bx + pockLocalX
          if (pockWY >= py && pockWY + 1 < py + TS) {
            g.fillStyle(MORTAR, 0.75)
            fr(pockWX, pockWY, 1, 2)
          }
        }

        const h2 = _tileHash(bx + 9999, by)
        if ((h2 & 0xff) > 242 && cw >= 6) {
          const cLocalY = ((h2 >>> 8)  & 0x0f) % 8 + 4
          // Clamp crack-x so all 4 stepping pixels fit inside the brick body.
          const cLocalX = Math.min(cw - 4, Math.max(1, ((h2 >>> 16) & 0x07) % 3 + 2))
          const stepY   = ((h2 >>> 20) & 1) ? 1 : -1
          const startWY = by + cLocalY
          const startWX = bx + cLocalX
          g.fillStyle(MORTAR, 0.85)
          for (let i = 0; i < 4; i++) {
            const cy = startWY + i * stepY
            const cx = startWX + i
            if (cy >= py && cy < py + TS) fr(cx, cy, 1, 1)
          }
        }
      }

      // Left mortar, highlight, and right shadow — full tile height.
      g.fillStyle(MORTAR, 0.85)
      fr(bx, py, 1, TS)

      g.fillStyle(WALL_HIGHLIGHT, 0.55)
      fr(bx + 1, py, 1, TS)
      g.fillStyle(WALL_SHADOW, 0.45)
      fr(bx + cw - 1, py, 1, TS)

      // Horizontal mortar at brick row boundaries. Drawn at each tile's TOP
      // edge (and any interior boundaries), inclusive of the top and
      // exclusive of the bottom — matches the left-edge convention in
      // _drawWallH so the mortar isn't clobbered by the next tile's pre-fill.
      g.fillStyle(MORTAR, 0.85)
      for (let by = firstBrickY; by <= py + TS; by += VH) {
        if (by >= py && by < py + TS) {
          fr(bx, by, cw, 1)
        }
      }

      bx += cw
    }

    // Overhang shadow — 2 px just inside the capstone, darkening bricks.
    if (drawCapstone) {
      const shX = wideLeft ? px + CAPSTONE_W : px + TS - CAPSTONE_W - OVERHANG_SHADOW_W
      g.fillStyle(OVERHANG_SHADOW_COLOR, OVERHANG_SHADOW_ALPHA)
      fr(shX, py, OVERHANG_SHADOW_W, TS)
    }

    // Capstone drawn AFTER bricks so it covers the outermost BASEBOARD_W px
    // of the widest brick column.
    if (drawCapstone) {
      const capX = wideLeft ? px : px + TS - CAPSTONE_W
      this._drawCapstoneBand(g, fr, capX, py, CAPSTONE_W, TS, wideLeft ? 'left' : 'right')
    }

    // Baseboard at the room-facing edge (right of left walls, left of right walls).
    if (drawBaseboard) {
      const bbX = wideLeft ? px + TS - BASEBOARD_W : px
      this._drawBaseboard(g, fr, bbX, py, BASEBOARD_W, TS, wideLeft ? 'right' : 'left')
    }
  }

  // Corner-tile draw: splits the tile diagonally and draws horizontal
  // bricks in the half adjacent to the top/bottom-wall neighbour, vertical
  // bricks in the half adjacent to the side-wall neighbour, then a darker
  // diagonal seam ("structural pillar") on top.
  //
  // Diagonals run from the room's outer corner to the inner corner:
  //   cTL: TL→BR    H above-right (rx > ry), V below-left (rx < ry)
  //   cBR: BR→TL    H below-left  (rx < ry), V above-right (rx > ry)
  //   cTR: TR→BL    H upper-left  (rx + ry < TS-1), V lower-right
  //   cBL: BL→TR    H lower-right (rx + ry > TS-1), V upper-left
  //
  // Per-row clipping is applied to every fillRect via a closure. That keeps
  // the brick logic in _drawWallH/V completely shared — corners just invoke
  // those methods with a different fill function.
  _drawWallCorner(g, x, y, kind, drawBaseboard = true, suppressCornerArt = false, globalRowOffset = 0, globalColOffset = 0) {
    const tilePx = x * TS, tilePy = y * TS

    // Map kind → (H clip mode, V clip mode, diag direction, taper directions).
    // Clip modes: 'A' rx>ry, 'B' rx<ry, 'C' rx+ry<TS-1, 'D' rx+ry>TS-1.
    // tallTop/wideLeft tell each half's taper to match its wall neighbour:
    //   cTL: H-side is part of top wall going right    → tallTop=true
    //        V-side is part of left wall going down    → wideLeft=true
    //   cTR: H-side is part of top wall going left     → tallTop=true
    //        V-side is part of right wall going down   → wideLeft=false
    //   cBL: H-side is part of bottom wall going right → tallTop=false
    //        V-side is part of left wall going up      → wideLeft=true
    //   cBR: H-side is part of bottom wall going left  → tallTop=false
    //        V-side is part of right wall going up     → wideLeft=false
    let hMode, vMode, isMainDiag, tallTop, wideLeft
    switch (kind) {
      case 'cTL': hMode = 'A'; vMode = 'B'; isMainDiag = true;  tallTop = true;  wideLeft = true;  break
      case 'cBR': hMode = 'B'; vMode = 'A'; isMainDiag = true;  tallTop = false; wideLeft = false; break
      case 'cTR': hMode = 'C'; vMode = 'D'; isMainDiag = false; tallTop = true;  wideLeft = false; break
      case 'cBL': hMode = 'D'; vMode = 'C'; isMainDiag = false; tallTop = false; wideLeft = true;  break
    }

    // Bricks first (with diagonal clipping), capstone L on top so the L
    // overdraws any brick fragments that strayed into its territory at the
    // diagonal's extreme rows. drawCapstone=false / drawBaseboard=false on
    // both calls because the corner draws its own L-shaped capstone and
    // baseboard at the end (running through the room's outer/inner corners).
    // Override brick width to 16 for corner cells. With BRICK_W=32 globally,
    // a corner's diagonal-clipped half-tile only contains at most one brick
    // edge per row, leaving the H side reading as a flat stripe. Halving
    // the brick width here gives the corner enough vertical mortar lines to
    // read as bricks without changing the long bricks on straight walls.
    const CORNER_BRICK_W = 16
    this._drawWallH(g, x, y, this._cornerFill(g, tilePx, tilePy, hMode), tallTop, false, false, false, globalRowOffset, CORNER_BRICK_W)
    this._drawWallV(g, x, y, this._cornerFill(g, tilePx, tilePy, vMode), wideLeft, false, false, false, globalColOffset, CORNER_BRICK_W)
    this._drawCapstoneL(g, tilePx, tilePy, kind)
    // suppressCornerArt: 2-thick wall blocks render the cornerstone + shadow
    // + pillar at block scale via _drawCornerBlockOverlays(); skip the small
    // single-tile versions that would sit underneath.
    if (suppressCornerArt) {
      // Bricks + capstone L only — exit before cornerstone/shadow/pillar.
      if (this._cornerPattern) this._drawCornerOverlay(g, tilePx, tilePy, kind)
      return
    }
    // Shadow before cornerstone so the (larger) cornerstone overdraws the
    // shadow band where they overlap, leaving a clean cornerstone edge.
    this._drawCapstoneShadowL(g, tilePx, tilePy, kind)
    this._drawCornerstone(g, tilePx, tilePy, kind)

    // Pillar — a tapered stepped diagonal from the cornerstone (PILLAR_W_MAX
    // wide where it anchors at the capstone) down to the room's inner corner
    // (PILLAR_W_MIN wide). Reads as a structural stone column receding into
    // the floor. MORTAR body with a 1-px PILLAR_EDGE_HIGHLIGHT capping the
    // trailing edge.
    // Pillar starts where the cornerstone ends (its inner corner). Skip
    // rows that fall inside the cornerstone L so the pillar visibly anchors
    // at the cornerstone instead of running underneath it.
    //
    // bulgeSign tells which side of the diagonal the pillar body sits on.
    // We always put the body on the V-bricks side so all 4 corners match
    // (without this flip the top and bottom corners end up mirrored).
    const pillarLen = TS - CORNERSTONE_W
    for (let i = 0; i < TS; i++) {
      const dx = isMainDiag ? i : (TS - 1 - i)

      let skip = false, distFromStone = 0, bulgeSign = +1
      switch (kind) {
        case 'cTL': skip = i < CORNERSTONE_W;       distFromStone = i - CORNERSTONE_W;            bulgeSign = -1; break
        case 'cTR': skip = i < CORNERSTONE_W;       distFromStone = i - CORNERSTONE_W;            bulgeSign = +1; break
        case 'cBL': skip = i >= TS - CORNERSTONE_W; distFromStone = (TS - CORNERSTONE_W - 1) - i; bulgeSign = -1; break
        case 'cBR': skip = i >= TS - CORNERSTONE_W; distFromStone = (TS - CORNERSTONE_W - 1) - i; bulgeSign = +1; break
      }
      if (skip) continue

      const t  = distFromStone / Math.max(1, pillarLen - 1)   // 0..1
      const wV = Math.round(PILLAR_V_W_MAX - t * (PILLAR_V_W_MAX - PILLAR_V_W_MIN))
      const wH = Math.round(PILLAR_H_W_MAX - t * (PILLAR_H_W_MAX - PILLAR_H_W_MIN))

      // Leading-edge highlight — 1 px on the diagonal itself.
      g.fillStyle(PILLAR_EDGE_HIGHLIGHT, PILLAR_EDGE_ALPHA)
      if (dx >= 0 && dx < TS) g.fillRect(tilePx + dx, tilePy + i, 1, 1)

      // MORTAR body — asymmetric around the highlight. Full V-side body
      // (wider, current taper) plus thinner H-side mirror (a softer shadow).
      g.fillStyle(MORTAR, 0.95)
      for (let j = 1; j < wV; j++) {
        const pxV = dx + j * bulgeSign
        if (pxV >= 0 && pxV < TS) g.fillRect(tilePx + pxV, tilePy + i, 1, 1)
      }
      for (let j = 1; j < wH; j++) {
        const pxH = dx - j * bulgeSign
        if (pxH >= 0 && pxH < TS) g.fillRect(tilePx + pxH, tilePy + i, 1, 1)
      }
    }

    // First-pillar-row patch — the very first row's leading edge would
    // visually break the H-mirror's connection to the cornerstone (V-mirror
    // gets free vertical adjacency to the cornerstone; the H-mirror sits on
    // the opposite side of the diagonal and only has the leading edge as a
    // bridge). Painting MORTAR at the first row's leading column merges the
    // V/H mirrors into a continuous dark stripe, and the lit edge resumes
    // from the next row down/up. The result is the H-side reads as solidly
    // anchored at the cornerstone, the same way the V-side does.
    {
      let firstRowI, firstRowDx
      switch (kind) {
        case 'cTL': firstRowI = CORNERSTONE_W;          firstRowDx = CORNERSTONE_W;          break
        case 'cTR': firstRowI = CORNERSTONE_W;          firstRowDx = TS - CORNERSTONE_W - 1; break
        case 'cBL': firstRowI = TS - CORNERSTONE_W - 1; firstRowDx = CORNERSTONE_W;          break
        case 'cBR': firstRowI = TS - CORNERSTONE_W - 1; firstRowDx = TS - CORNERSTONE_W - 1; break
      }
      g.fillStyle(MORTAR, 0.95)
      g.fillRect(tilePx + firstRowDx, tilePy + firstRowI, 1, 1)
    }

    // Baseboard L on top of everything, wrapping the inner corner (the room
    // corner). Drawn last so it caps the pillar where it would have exited
    // into the room's interior corner. Skipped when the corner cell's inward
    // neighbours are themselves walls (WALL_THICKNESS > 1) — the inner-corner
    // sub-cell handles the baseboard L for the room's interior corner.
    if (drawBaseboard) this._drawBaseboardL(g, tilePx, tilePy, kind)

    // User-painted overlay (CornerEditor). The user paints the cTL pattern;
    // we mirror it across kinds so all 4 corners stay consistent. Drawn
    // last so it overrides anything procedural — null pixels in the pattern
    // leave the procedural pixel showing through.
    if (this._cornerPattern) this._drawCornerOverlay(g, tilePx, tilePy, kind)
  }

  // Apply the saved corner pattern at this tile, mirroring per kind:
  //   cTL → as painted
  //   cTR → flipped horizontally
  //   cBL → flipped vertically
  //   cBR → flipped both
  // null entries in the pattern are left untouched (procedural shows through).
  _drawCornerOverlay(g, tilePx, tilePy, kind) {
    const pat = this._cornerPattern
    const flipX = (kind === 'cTR' || kind === 'cBR')
    const flipY = (kind === 'cBL' || kind === 'cBR')
    for (let py = 0; py < TS; py++) {
      const sy = flipY ? (TS - 1 - py) : py
      const row = pat[sy]
      if (!row) continue
      for (let px = 0; px < TS; px++) {
        const sx = flipX ? (TS - 1 - px) : px
        const c = row[sx]
        if (c == null) continue
        g.fillStyle(c, 1)
        g.fillRect(tilePx + px, tilePy + py, 1, 1)
      }
    }
  }

  // Capstone band — solid CAPSTONE_BASE fill with subtle perpendicular
  // seams (suggesting flat blocks viewed from above), an outer-edge
  // highlight, and an inner-edge shadow where it meets the brick face.
  // Used by both straight-wall draws (single band) and corner draws
  // (two bands forming an L).
  _drawCapstoneBand(g, fr, x, y, w, h, outerSide) {
    fr = fr || ((rx, ry, rw, rh) => g.fillRect(rx, ry, rw, rh))
    g.fillStyle(CAPSTONE_BASE, 1)
    fr(x, y, w, h)

    // Seams placed at world-coord multiples of CAPSTONE_SEAM_SPACING so they
    // line up consistently across multi-tile bands (every tile draws only the
    // seams that fall inside its slice, no double-draw at the boundary).
    g.fillStyle(CAPSTONE_SEAM, 0.7)
    const SP = CAPSTONE_SEAM_SPACING
    if (outerSide === 'top' || outerSide === 'bottom') {
      const firstSeam = Math.ceil(x / SP) * SP
      for (let wx = firstSeam; wx < x + w; wx += SP) {
        if (wx > x) fr(wx, y, 1, h)   // skip a seam at the band's exact start
      }
    } else {
      const firstSeam = Math.ceil(y / SP) * SP
      for (let wy = firstSeam; wy < y + h; wy += SP) {
        if (wy > y) fr(x, wy, w, 1)
      }
    }

    g.fillStyle(CAPSTONE_HIGHLIGHT, 0.7)
    if      (outerSide === 'top')    fr(x, y, w, 1)
    else if (outerSide === 'bottom') fr(x, y + h - 1, w, 1)
    else if (outerSide === 'left')   fr(x, y, 1, h)
    else if (outerSide === 'right')  fr(x + w - 1, y, 1, h)

    g.fillStyle(CAPSTONE_SHADOW, 0.85)
    if      (outerSide === 'top')    fr(x, y + h - 1, w, 1)
    else if (outerSide === 'bottom') fr(x, y, w, 1)
    else if (outerSide === 'left')   fr(x + w - 1, y, 1, h)
    else if (outerSide === 'right')  fr(x, y, 1, h)
  }

  // L-shaped capstone for a corner tile — two perpendicular bands that meet
  // at the outer corner. The second call overdraws the elbow square but
  // that's harmless (same colour, same alpha 1).
  _drawCapstoneL(g, tilePx, tilePy, kind) {
    const fr = (rx, ry, rw, rh) => g.fillRect(rx, ry, rw, rh)
    let topBand = false, bottomBand = false, leftBand = false, rightBand = false
    switch (kind) {
      case 'cTL': topBand    = true; leftBand  = true; break
      case 'cTR': topBand    = true; rightBand = true; break
      case 'cBL': bottomBand = true; leftBand  = true; break
      case 'cBR': bottomBand = true; rightBand = true; break
    }
    if (topBand)    this._drawCapstoneBand(g, fr, tilePx, tilePy, TS, CAPSTONE_W, 'top')
    if (bottomBand) this._drawCapstoneBand(g, fr, tilePx, tilePy + TS - CAPSTONE_W, TS, CAPSTONE_W, 'bottom')
    if (leftBand)   this._drawCapstoneBand(g, fr, tilePx, tilePy, CAPSTONE_W, TS, 'left')
    if (rightBand)  this._drawCapstoneBand(g, fr, tilePx + TS - CAPSTONE_W, tilePy, CAPSTONE_W, TS, 'right')
  }

  // Cornerstone — a CAPSTONE_W × CAPSTONE_W square at the room's outer
  // corner of a corner tile (the capstone-L elbow). Painted with a slightly
  // darker fill plus seam lines on the inner edges (where it borders the
  // rest of the capstone L) and lighter highlights on the outer edges, so
  // it reads as a distinct corner block instead of just continuous capstone.
  _drawCornerstone(g, tilePx, tilePy, kind) {
    let cx, cy, innerSideX, innerSideY   // innerSide* tells which 2 edges face the rest of the L
    switch (kind) {
      case 'cTL': cx = tilePx;                          cy = tilePy;                          innerSideX = 'right';  innerSideY = 'bottom'; break
      case 'cTR': cx = tilePx + TS - CORNERSTONE_W;     cy = tilePy;                          innerSideX = 'left';   innerSideY = 'bottom'; break
      case 'cBL': cx = tilePx;                          cy = tilePy + TS - CORNERSTONE_W;     innerSideX = 'right';  innerSideY = 'top';    break
      case 'cBR': cx = tilePx + TS - CORNERSTONE_W;     cy = tilePy + TS - CORNERSTONE_W;     innerSideX = 'left';   innerSideY = 'top';    break
    }
    const W = CORNERSTONE_W

    // Slightly darker fill than the rest of the band.
    g.fillStyle(CORNERSTONE_BASE, 1)
    g.fillRect(cx, cy, W, W)

    // Seams on the 2 inner edges (boundary with the rest of the capstone L).
    g.fillStyle(CAPSTONE_SEAM, 0.85)
    if (innerSideX === 'right') g.fillRect(cx + W - 1, cy, 1, W)
    else                        g.fillRect(cx,         cy, 1, W)
    if (innerSideY === 'bottom') g.fillRect(cx, cy + W - 1, W, 1)
    else                         g.fillRect(cx, cy,         W, 1)

    // Highlights on the 2 outer edges (the very outermost wall corner).
    g.fillStyle(CAPSTONE_HIGHLIGHT, 0.7)
    if (innerSideX === 'right') g.fillRect(cx,         cy, 1, W)   // outer is left
    else                        g.fillRect(cx + W - 1, cy, 1, W)   // outer is right
    if (innerSideY === 'bottom') g.fillRect(cx, cy,         W, 1)  // outer is top
    else                         g.fillRect(cx, cy + W - 1, W, 1)  // outer is bottom
  }

  // Overhang shadow L for a corner tile — two perpendicular semi-transparent
  // bands tracing the inner edge of the capstone L. Bricks just inside the
  // capstone get visibly darker, completing the "capstone hangs over the
  // brick face" depth effect (matching the per-axis bands drawn by
  // _drawWallH / _drawWallV on straight wall tiles).
  _drawCapstoneShadowL(g, tilePx, tilePy, kind) {
    g.fillStyle(OVERHANG_SHADOW_COLOR, OVERHANG_SHADOW_ALPHA)
    const inner = TS - CAPSTONE_W
    const W = OVERHANG_SHADOW_W
    switch (kind) {
      case 'cTL':
        g.fillRect(tilePx + CAPSTONE_W, tilePy + CAPSTONE_W, inner, W)            // below top capstone
        g.fillRect(tilePx + CAPSTONE_W, tilePy + CAPSTONE_W, W, inner)            // right of left capstone
        break
      case 'cTR':
        g.fillRect(tilePx, tilePy + CAPSTONE_W, inner, W)                         // below top capstone
        g.fillRect(tilePx + TS - CAPSTONE_W - W, tilePy + CAPSTONE_W, W, inner)   // left of right capstone
        break
      case 'cBL':
        g.fillRect(tilePx + CAPSTONE_W, tilePy + TS - CAPSTONE_W - W, inner, W)   // above bottom capstone
        g.fillRect(tilePx + CAPSTONE_W, tilePy, W, inner)                         // right of left capstone
        break
      case 'cBR':
        g.fillRect(tilePx, tilePy + TS - CAPSTONE_W - W, inner, W)                // above bottom capstone
        g.fillRect(tilePx + TS - CAPSTONE_W - W, tilePy, W, inner)                // left of right capstone
        break
    }
  }

  // Baseboard strip — solid darker fill plus a 1-px slightly-lighter line
  // along the brick-facing edge for clean separation. innerSide is which
  // side faces the room interior (which IS the side the strip sits on).
  _drawBaseboard(g, fr, x, y, w, h, innerSide) {
    g.fillStyle(BASEBOARD_BASE, 1)
    fr(x, y, w, h)
    g.fillStyle(BASEBOARD_TOP, 0.85)
    if      (innerSide === 'bottom') fr(x, y, w, 1)             // top of strip
    else if (innerSide === 'top')    fr(x, y + h - 1, w, 1)
    else if (innerSide === 'right')  fr(x, y, 1, h)             // left of strip
    else if (innerSide === 'left')   fr(x + w - 1, y, 1, h)
  }

  // Post-pass that overlays a block-scale cornerstone + capstone-shadow L +
  // pillar on every WT×WT corner block. The per-cell pass (run by
  // _drawTiles) already painted bricks + capstone L bands continuously
  // across the block; this pass adds the larger structural-corner art so
  // the corner reads as one big stone elbow instead of a small chip stuck
  // at the outer sub-cell. The OUTER sub-cell's _drawWallCorner call is
  // invoked with suppressCornerArt=true so its small versions don't show
  // through underneath.
  _drawCornerBlockOverlays() {
    const WT  = Balance.WALL_THICKNESS
    const g   = this._gTiles
    const BS  = WT * TS
    // csW is capped at TS - CAPSTONE_W so the big cornerstone never covers
    // the entire outer sub-cell — leaves room for the brick face to read
    // through underneath. CORNERSTONE_W * WT would be 36 for WT=2, which
    // would eat the whole 32-px-wide outer cell.
    const csW = Math.min(CORNERSTONE_W * WT, TS - CAPSTONE_W)
    for (const room of this._gameState.dungeon.rooms) {
      const { gridX: rx, gridY: ry, width: rw, height: rh } = room
      const corners = [
        { kind: 'cTL', bx: rx * TS,             by: ry * TS              },
        { kind: 'cTR', bx: (rx + rw - WT) * TS, by: ry * TS              },
        { kind: 'cBL', bx: rx * TS,             by: (ry + rh - WT) * TS  },
        { kind: 'cBR', bx: (rx + rw - WT) * TS, by: (ry + rh - WT) * TS  },
      ]
      for (const c of corners) {
        this._drawBigCapstoneShadowL(g, c.bx, c.by, c.kind, BS)
        this._drawBigCornerstone   (g, c.bx, c.by, c.kind, BS, csW)
        this._drawBigPillar        (g, c.bx, c.by, c.kind, BS, csW)
      }
    }
  }

  // Block-scale cornerstone (csW × csW) at the outermost pixel-corner of a
  // WT×WT corner block. Same fill / seam-highlight pattern as the single-tile
  // version, just bigger; the per-cell capstone L bands meet flush against
  // its outer edges so the corner reads as one large structural elbow.
  _drawBigCornerstone(g, bx, by, kind, BS, csW) {
    let cx, cy, innerSideX, innerSideY
    switch (kind) {
      case 'cTL': cx = bx;            cy = by;            innerSideX = 'right'; innerSideY = 'bottom'; break
      case 'cTR': cx = bx + BS - csW; cy = by;            innerSideX = 'left';  innerSideY = 'bottom'; break
      case 'cBL': cx = bx;            cy = by + BS - csW; innerSideX = 'right'; innerSideY = 'top';    break
      case 'cBR': cx = bx + BS - csW; cy = by + BS - csW; innerSideX = 'left';  innerSideY = 'top';    break
    }
    g.fillStyle(CORNERSTONE_BASE, 1)
    g.fillRect(cx, cy, csW, csW)
    g.fillStyle(CAPSTONE_SEAM, 0.85)
    if (innerSideX === 'right') g.fillRect(cx + csW - 1, cy, 1, csW)
    else                        g.fillRect(cx,           cy, 1, csW)
    if (innerSideY === 'bottom') g.fillRect(cx, cy + csW - 1, csW, 1)
    else                         g.fillRect(cx, cy,           csW, 1)
    g.fillStyle(CAPSTONE_HIGHLIGHT, 0.7)
    if (innerSideX === 'right') g.fillRect(cx,           cy, 1, csW)
    else                        g.fillRect(cx + csW - 1, cy, 1, csW)
    if (innerSideY === 'bottom') g.fillRect(cx, cy,           csW, 1)
    else                         g.fillRect(cx, cy + csW - 1, csW, 1)
  }

  // Block-scale capstone overhang shadow — two perpendicular semi-transparent
  // bands tracing the inner edge of the capstone L across the whole block.
  _drawBigCapstoneShadowL(g, bx, by, kind, BS) {
    g.fillStyle(OVERHANG_SHADOW_COLOR, OVERHANG_SHADOW_ALPHA)
    const inner = BS - CAPSTONE_W
    const W = OVERHANG_SHADOW_W
    switch (kind) {
      case 'cTL':
        g.fillRect(bx + CAPSTONE_W, by + CAPSTONE_W, inner, W)
        g.fillRect(bx + CAPSTONE_W, by + CAPSTONE_W, W, inner)
        break
      case 'cTR':
        g.fillRect(bx,                       by + CAPSTONE_W, inner, W)
        g.fillRect(bx + BS - CAPSTONE_W - W, by + CAPSTONE_W, W, inner)
        break
      case 'cBL':
        g.fillRect(bx + CAPSTONE_W, by + BS - CAPSTONE_W - W, inner, W)
        g.fillRect(bx + CAPSTONE_W, by,                       W, inner)
        break
      case 'cBR':
        g.fillRect(bx,                       by + BS - CAPSTONE_W - W, inner, W)
        g.fillRect(bx + BS - CAPSTONE_W - W, by,                       W, inner)
        break
    }
  }

  // Block-scale pillar — diagonal MORTAR band running from the inner edge of
  // the bigger cornerstone to the inner-pixel-corner of the WT×WT block.
  // Mirrors the per-tile pillar geometry in _drawWallCorner but with TS→BS
  // and CORNERSTONE_W→csW.
  _drawBigPillar(g, bx, by, kind, BS, csW) {
    const isMainDiag = (kind === 'cTL' || kind === 'cBR')
    const pillarLen  = BS - csW
    for (let i = 0; i < BS; i++) {
      const dx = isMainDiag ? i : (BS - 1 - i)
      let skip = false, distFromStone = 0, bulgeSign = +1
      switch (kind) {
        case 'cTL': skip = i < csW;       distFromStone = i - csW;            bulgeSign = -1; break
        case 'cTR': skip = i < csW;       distFromStone = i - csW;            bulgeSign = +1; break
        case 'cBL': skip = i >= BS - csW; distFromStone = (BS - csW - 1) - i; bulgeSign = -1; break
        case 'cBR': skip = i >= BS - csW; distFromStone = (BS - csW - 1) - i; bulgeSign = +1; break
      }
      if (skip) continue
      const t  = distFromStone / Math.max(1, pillarLen - 1)
      const wV = Math.round(PILLAR_V_W_MAX - t * (PILLAR_V_W_MAX - PILLAR_V_W_MIN))
      const wH = Math.round(PILLAR_H_W_MAX - t * (PILLAR_H_W_MAX - PILLAR_H_W_MIN))
      g.fillStyle(PILLAR_EDGE_HIGHLIGHT, PILLAR_EDGE_ALPHA)
      if (dx >= 0 && dx < BS) g.fillRect(bx + dx, by + i, 1, 1)
      g.fillStyle(MORTAR, 0.95)
      for (let j = 1; j < wV; j++) {
        const pxV = dx + j * bulgeSign
        if (pxV >= 0 && pxV < BS) g.fillRect(bx + pxV, by + i, 1, 1)
      }
      for (let j = 1; j < wH; j++) {
        const pxH = dx - j * bulgeSign
        if (pxH >= 0 && pxH < BS) g.fillRect(bx + pxH, by + i, 1, 1)
      }
    }
  }

  // Dispatch a WALL/BOSS_WALL cell to the right draw method based on its rich
  // orientation tag (see _buildWallOrientation). Handles both straight walls
  // (outer/inner ring) and corner-block sub-cells. Pre-fills WALL_BASE so the
  // few-pixel gaps left by drawCapstone=false / drawBaseboard=false never
  // show through to the void background.
  _drawWallCellByTag(g, x, y, o) {
    if (!o) {
      // Fallback — wall not in any room rect. Render as a plain top wall.
      return this._drawWallH(g, x, y, null, true, true, true)
    }
    if (o.kind === 'corner') {
      if (o.role === 'outer') {
        // Outermost corner of the room — capstone L wraps two outward faces.
        // Skip the baseboard L; the inner-corner sub-cell paints it instead.
        // For WT > 1, also suppress the small cornerstone + pillar + capstone
        // shadow; _drawCornerBlockOverlays() will overlay block-scale versions
        // that span the full WT×WT corner block.
        const kind = 'c' + o.side.toUpperCase()
        const suppress = Balance.WALL_THICKNESS > 1
        // Outer corner is the outermost cell of both its H and V wall runs.
        const rowOff = (o.side === 'tl' || o.side === 'tr') ? 0 : INNER_ROW_COUNT
        const colOff = (o.side === 'tl' || o.side === 'bl') ? 0 : INNER_COL_COUNT
        return this._drawWallCorner(g, x, y, kind, false, suppress, rowOff, colOff)
      }
      if (o.role === 'inner') {
        return this._drawInnerCornerCell(g, x, y, o.side)
      }
      if (o.role === 'h-arm') {
        // Outer-row cell on the horizontal arm of the corner block — looks
        // like a straight outer top/bottom wall (capstone, no baseboard).
        const tallTop = (o.side === 'tl' || o.side === 'tr')
        const rowOff  = tallTop ? 0 : INNER_ROW_COUNT
        this._fillWallBase(g, x, y)
        return this._drawWallH(g, x, y, null, tallTop, true, false, false, rowOff)
      }
      if (o.role === 'v-arm') {
        const wideLeft = (o.side === 'tl' || o.side === 'bl')
        const colOff   = wideLeft ? 0 : INNER_COL_COUNT
        this._fillWallBase(g, x, y)
        return this._drawWallV(g, x, y, null, wideLeft, true, false, false, colOff)
      }
      // 'mid' (only with WT > 2) — flat WALL_BASE fill.
      return this._fillWallBase(g, x, y)
    }
    // Straight wall (top/bot/lft/rgt). depth=0 is the outermost ring,
    // depth=WT-1 the innermost. Outer cells get a capstone band on their
    // outward face; inner cells fill the full tile with bricks (so the
    // brick pattern continues seamlessly from the outer ring) and add a
    // baseboard on their room-facing face. globalRow/ColOffset puts each
    // cell's brick rows in the right slot of a wall-wide stagger sequence
    // (visual top→bottom for H walls, left→right for V walls).
    const WT = Balance.WALL_THICKNESS
    const isOuter = (o.depth === 0)
    const isInner = (o.depth === WT - 1)
    const fullHeight = !isOuter   // inner / mid layers fill the full tile
    let rowOff = 0, colOff = 0
    if      (o.kind === 'top') rowOff = isOuter ? 0 : OUTER_ROW_COUNT
    else if (o.kind === 'bot') rowOff = isOuter ? INNER_ROW_COUNT : 0
    else if (o.kind === 'lft') colOff = isOuter ? 0 : OUTER_COL_COUNT
    else if (o.kind === 'rgt') colOff = isOuter ? INNER_COL_COUNT : 0
    this._fillWallBase(g, x, y)
    if (o.kind === 'top') return this._drawWallH(g, x, y, null, true,  isOuter, isInner, fullHeight, rowOff)
    if (o.kind === 'bot') return this._drawWallH(g, x, y, null, false, isOuter, isInner, fullHeight, rowOff)
    if (o.kind === 'lft') return this._drawWallV(g, x, y, null, true,  isOuter, isInner, fullHeight, colOff)
    if (o.kind === 'rgt') return this._drawWallV(g, x, y, null, false, isOuter, isInner, fullHeight, colOff)
  }

  _fillWallBase(g, x, y) {
    g.fillStyle(WALL_BASE, 1)
    g.fillRect(x * TS, y * TS, TS, TS)
  }

  // Inner-corner sub-cell of a WALL_THICKNESS-deep corner block. Sits at the
  // room-facing diagonal of the corner block, where two perpendicular
  // inner-ring runs (e.g. inner-top-wall and inner-left-wall for TL block)
  // meet. Renders with the same diagonal-split brick pattern as the outer
  // corner of the same `side` (since the geometry is congruent), but
  // full-height (no capstone reserved) and without the cornerstone / pillar
  // / capstone-shadow art. Closes with a baseboard L at the room-facing
  // pixel-corner so the floor side reads as a finished room corner.
  //   side: 'tl'|'tr'|'bl'|'br' — which room corner this block sits at; the
  //         baseboard L is drawn at the pixel-corner that faces the room
  //         interior (BR for tl, BL for tr, TR for bl, TL for br).
  _drawInnerCornerCell(g, x, y, side) {
    const px = x * TS, py = y * TS
    // Pre-fill so any unfilled stripes show wall base, not void.
    g.fillStyle(WALL_BASE, 1)
    g.fillRect(px, py, TS, TS)

    // Diagonal-split brick fill. Mode mapping matches the outer corner of
    // the same side — the inner sub-cell's edges align so that "H bricks
    // on this half" / "V bricks on this half" are continuous with the
    // adjacent h-arm / v-arm / inner-ring straight cells.
    let hMode, vMode, tallTop, wideLeft
    switch (side) {
      case 'tl': hMode = 'A'; vMode = 'B'; tallTop = true;  wideLeft = true;  break
      case 'tr': hMode = 'C'; vMode = 'D'; tallTop = true;  wideLeft = false; break
      case 'bl': hMode = 'D'; vMode = 'C'; tallTop = false; wideLeft = true;  break
      case 'br': hMode = 'B'; vMode = 'A'; tallTop = false; wideLeft = false; break
    }
    // globalRow/ColOffset matches the inner ring of the corresponding wall
    // direction — keeps the brick stagger continuous with the adjacent
    // straight inner-ring cells.
    const rowOff = (side === 'tl' || side === 'tr') ? OUTER_ROW_COUNT : 0
    const colOff = (side === 'tl' || side === 'bl') ? OUTER_COL_COUNT : 0

    // fullHeight=true (inner ring), drawCapstone=false, drawBaseboard=false —
    // we skip both so the cell is just bricks + the L baseboard below.
    this._drawWallH(g, x, y, this._cornerFill(g, px, py, hMode), tallTop, false, false, true, rowOff)
    this._drawWallV(g, x, y, this._cornerFill(g, px, py, vMode), wideLeft, false, false, true, colOff)

    // Baseboard L at the room-facing pixel-corner.
    const kind = 'c' + side.toUpperCase()
    this._drawBaseboardL(g, px, py, kind)
  }

  // Baseboard wraparound for a corner tile. The corner tile's inner edges
  // face OTHER wall tiles (not floor), so no continuous strip along them
  // makes sense. Instead we paint a single BASEBOARD_W × BASEBOARD_W block
  // at the room's inner corner of the tile — it bridges the two adjacent
  // baseboards (from the perpendicular hT/hB and vL/vR neighbours) so they
  // wrap cleanly around the room corner.
  _drawBaseboardL(g, tilePx, tilePy, kind) {
    let bx, by, hLineSide, vLineSide
    switch (kind) {
      case 'cTL': // room-inner corner = BR of tile
        bx = tilePx + TS - BASEBOARD_W; by = tilePy + TS - BASEBOARD_W
        hLineSide = 'top';   vLineSide = 'left';  break
      case 'cTR': // room-inner corner = BL of tile
        bx = tilePx;                     by = tilePy + TS - BASEBOARD_W
        hLineSide = 'top';   vLineSide = 'right'; break
      case 'cBL': // room-inner corner = TR of tile
        bx = tilePx + TS - BASEBOARD_W; by = tilePy
        hLineSide = 'bot';   vLineSide = 'left';  break
      case 'cBR': // room-inner corner = TL of tile
        bx = tilePx;                     by = tilePy
        hLineSide = 'bot';   vLineSide = 'right'; break
    }

    g.fillStyle(BASEBOARD_BASE, 1)
    g.fillRect(bx, by, BASEBOARD_W, BASEBOARD_W)

    // Continue the brick-facing highlight lines from the adjacent strips
    // across this block so the visual line wraps unbroken around the corner.
    g.fillStyle(BASEBOARD_TOP, 0.85)
    if (hLineSide === 'top') g.fillRect(bx, by, BASEBOARD_W, 1)
    else                     g.fillRect(bx, by + BASEBOARD_W - 1, BASEBOARD_W, 1)
    if (vLineSide === 'left') g.fillRect(bx, by, 1, BASEBOARD_W)
    else                      g.fillRect(bx + BASEBOARD_W - 1, by, 1, BASEBOARD_W)
  }

  // Returns a fillRect-shaped function that clips each rect to one half of
  // a corner tile's diagonal split. mode picks which half to keep:
  //   'A' rx > ry         (TL_h, BR_v)
  //   'B' rx < ry         (TL_v, BR_h)
  //   'C' rx + ry < TS-1  (TR_h, BL_v)
  //   'D' rx + ry > TS-1  (TR_v, BL_h)
  // Per-row implementation: each row clips to one contiguous x-range, so a
  // single fillRect emits at most one sub-fillRect per row.
  _cornerFill(g, tilePx, tilePy, mode) {
    return (rx, ry, rw, rh) => {
      for (let dy = 0; dy < rh; dy++) {
        const localY = (ry - tilePy) + dy
        if (localY < 0 || localY >= TS) continue
        let lo = Math.max(0, rx - tilePx)
        let hi = Math.min(TS, rx - tilePx + rw)   // exclusive
        switch (mode) {
          case 'A': lo = Math.max(lo, localY + 1); break
          case 'B': hi = Math.min(hi, localY);     break
          case 'C': hi = Math.min(hi, TS - 1 - localY); break
          case 'D': lo = Math.max(lo, TS - localY); break
        }
        if (hi > lo) g.fillRect(tilePx + lo, tilePy + localY, hi - lo, 1)
      }
    }
  }

  // Per-cell door render. With 2-thick walls every connection point paints a
  // 2×WALL_THICKNESS block of DOOR cells (and the inter-room gap stamps a
  // 2×1 strip), so the per-cell archway + jamb composition that worked for
  // 1-thick walls would draw 4 overlapping arches per doorway. Phase 2 first
  // pass: paint a flat dark-passage floor on every DOOR cell — the wall ring
  // around the door already frames the opening, and the player reads the
  // 2×2 dark patch as a clear passage. The legacy arch helpers
  // (_drawDoorEW/_drawDoorNS/_drawDoorGap) are kept intact for a future
  // multi-cell-aware rework but no longer dispatched.
  _drawDoorCell(g, x, y) {
    const px = x * TS, py = y * TS
    // Passage floor is intentionally darker than the room floor so the
    // doorway reads as a recessed underpass. The graduated shadow added by
    // _drawPassageShadow (above entities) deepens this further toward the
    // outward face, so adventurers visually emerge from darkness as they
    // reach the threshold.
    g.fillStyle(DOOR_PASSAGE_DARK, 1)
    g.fillRect(px, py, TS, TS)
    const over = this._gOverhead
    // Find which room (if any) contains this cell. Gap-stub cells between
    // two rooms aren't in any room rect — they get the full wall-cap look.
    const room = (this._gameState.dungeon.rooms ?? []).find(r =>
      x >= r.gridX && x < r.gridX + r.width &&
      y >= r.gridY && y < r.gridY + r.height)
    if (!room) {
      // Gap stub: paint the whole cell as wall-cap surface so the gap reads
      // as a continuation of the capstone band running over both walls.
      this._drawCapstoneBand(over, null, px, py, TS, TS, 'top')
      return
    }
    // For DOOR cells in a room's OUTER wall ring, repaint the outward
    // strip with a capstone band — keeps the wall-cap line continuous
    // across the doorway and lets the closed door sit underneath it.
    const dt = y - room.gridY
    const db = (room.gridY + room.height - 1) - y
    const dl = x - room.gridX
    const dr = (room.gridX + room.width  - 1) - x
    if      (dt === 0) this._drawCapstoneBand(over, null, px, py, TS, CAPSTONE_W, 'top')
    else if (db === 0) this._drawCapstoneBand(over, null, px, py + TS - CAPSTONE_W, TS, CAPSTONE_W, 'bottom')
    else if (dl === 0) this._drawCapstoneBand(over, null, px, py, CAPSTONE_W, TS, 'left')
    else if (dr === 0) this._drawCapstoneBand(over, null, px + TS - CAPSTONE_W, py, CAPSTONE_W, TS, 'right')
  }

  // Closed-door overlays. Walks every room's connection points and stamps a
  // 2 × WALL_THICKNESS door visual on the door layer for each cp whose
  // `open` flag is false. Style is taken from cp.style (or 'regular' default),
  // upgraded to 'boss' if the doorway pairs with the boss chamber. Drawn on
  // _gDoors (depth 9.5) so adventurers walking under the doorway pass
  // visually behind the closed door.
  // Doorway architecture (jambs + threshold + inner bevel) — drawn for
  // every cp regardless of door state, so the frame is visible whether the
  // door is closed, animating, or fully open. Jambs sit on _gOverhead
  // (above entities, so adventurers pass under the frame); threshold and
  // bevel go on _gTiles (below entities, so adventurers walk on/over them).
  _drawDoorwayArchitecture() {
    const overhead = this._gOverhead
    const tiles    = this._gTiles
    const passage  = this._gPassageShadow
    for (const room of this._gameState.dungeon.rooms ?? []) {
      for (const cp of room.connectionPoints ?? []) {
        const rect = this._cpDoorRect(room, cp)
        if (!rect) continue
        const style = this._effectiveDoorStyle(room, cp)
        const pal   = ARCH_STYLES[style] || ARCH_STYLES.regular
        this._drawDoorJambs(overhead, rect, pal)
        this._drawDoorThreshold(tiles, rect, pal)
        // Passage shadow now sits on its own depth-5.5 layer so it
        // renders BEHIND the door panel (depth 6.5) and behind any
        // character standing in the doorway. Was on _gOverhead at 9.
        this._drawPassageShadow(passage, rect)
      }
    }
  }

  // Graduated dark overlay on _gOverhead, inset between the jambs, fading
  // from heavy darkness at the outward face (the "deep underpass beyond
  // the door") to nearly transparent at the threshold. Renders above
  // adventurers — they appear to emerge from shadow as they cross the
  // doorway. Stays out of the threshold strip so the floor-side stays clean.
  _drawPassageShadow(g, rect) {
    const ALPHAS = [0.9, 0.7, 0.5, 0.25]
    const { px, py, pw, ph, axis, outerSide } = rect

    if (axis === 'h') {
      const sx = px + JAMB_W
      const sw = pw - 2 * JAMB_W
      // Carve the threshold strip out of the shadow zone.
      const sy = (outerSide === 'top') ? py : py + THRESHOLD_W
      const sh = ph - THRESHOLD_W
      const stripeH = Math.max(1, Math.floor(sh / ALPHAS.length))
      for (let i = 0; i < ALPHAS.length; i++) {
        g.fillStyle(0x000000, ALPHAS[i])
        // i=0 is the heaviest stripe; place it at the outward face.
        const sy_i = (outerSide === 'top')
          ? sy + i * stripeH
          : sy + sh - (i + 1) * stripeH
        const sh_i = (i === ALPHAS.length - 1)
          ? Math.max(0, sh - i * stripeH)
          : stripeH
        if (sw > 0 && sh_i > 0) g.fillRect(sx, sy_i, sw, sh_i)
      }
    } else {
      const sy = py + JAMB_W
      const sh = ph - 2 * JAMB_W
      const sx = (outerSide === 'left') ? px : px + THRESHOLD_W
      const sw = pw - THRESHOLD_W
      const stripeW = Math.max(1, Math.floor(sw / ALPHAS.length))
      for (let i = 0; i < ALPHAS.length; i++) {
        g.fillStyle(0x000000, ALPHAS[i])
        const sx_i = (outerSide === 'left')
          ? sx + i * stripeW
          : sx + sw - (i + 1) * stripeW
        const sw_i = (i === ALPHAS.length - 1)
          ? Math.max(0, sw - i * stripeW)
          : stripeW
        if (sw_i > 0 && sh > 0) g.fillRect(sx_i, sy, sw_i, sh)
      }
    }
  }

  // Two stone strips flanking the passage. For h-axis doorways (top/bottom
  // walls) jambs are vertical at the left and right edges of the rect; for
  // v-axis (left/right walls) they're horizontal at the top and bottom.
  // Each jamb is JAMB_W px thick with a bright outer-edge highlight and a
  // 1-px shadow on its inner edge for depth.
  _drawDoorJambs(g, rect, pal) {
    const { px, py, pw, ph, axis } = rect
    if (axis === 'h') {
      g.fillStyle(pal.jamb, 1)
      g.fillRect(px,             py, JAMB_W, ph)              // left jamb
      g.fillRect(px + pw - JAMB_W, py, JAMB_W, ph)            // right jamb
      g.fillStyle(pal.jambHi, 0.85)
      g.fillRect(px,             py, 1, ph)                   // outer left highlight
      g.fillRect(px + pw - 1,    py, 1, ph)                   // outer right highlight
      g.fillStyle(pal.jambShadow, 0.7)
      g.fillRect(px + JAMB_W - 1,    py, 1, ph)               // inner left shadow
      g.fillRect(px + pw - JAMB_W,   py, 1, ph)               // inner right shadow
      g.fillStyle(pal.bevel, 0.55)
      g.fillRect(px + JAMB_W,        py, 1, ph)               // recess bevel
      g.fillRect(px + pw - JAMB_W - 1, py, 1, ph)
    } else {
      g.fillStyle(pal.jamb, 1)
      g.fillRect(px, py,                   pw, JAMB_W)
      g.fillRect(px, py + ph - JAMB_W,     pw, JAMB_W)
      g.fillStyle(pal.jambHi, 0.85)
      g.fillRect(px, py,                   pw, 1)
      g.fillRect(px, py + ph - 1,          pw, 1)
      g.fillStyle(pal.jambShadow, 0.7)
      g.fillRect(px, py + JAMB_W - 1,      pw, 1)
      g.fillRect(px, py + ph - JAMB_W,     pw, 1)
      g.fillStyle(pal.bevel, 0.55)
      g.fillRect(px, py + JAMB_W,          pw, 1)
      g.fillRect(px, py + ph - JAMB_W - 1, pw, 1)
    }
  }

  // Worn-stone slab at the floor-facing edge of the doorway opening, with a
  // bright top-edge highlight and a 1-px dark bevel on its passage-facing
  // edge (inner shadow that sells "the passage is recessed").
  _drawDoorThreshold(g, rect, pal) {
    const { px, py, pw, ph, outerSide } = rect
    let tx, ty, tw, th, hiSide, bevelSide
    switch (outerSide) {
      case 'top':    tx = px;            ty = py + ph - THRESHOLD_W; tw = pw;          th = THRESHOLD_W; hiSide = 'bottom'; bevelSide = 'top';    break
      case 'bottom': tx = px;            ty = py;                    tw = pw;          th = THRESHOLD_W; hiSide = 'top';    bevelSide = 'bottom'; break
      case 'left':   tx = px + pw - THRESHOLD_W; ty = py;            tw = THRESHOLD_W; th = ph;          hiSide = 'right';  bevelSide = 'left';   break
      case 'right':  tx = px;            ty = py;                    tw = THRESHOLD_W; th = ph;          hiSide = 'left';   bevelSide = 'right';  break
      default: return
    }
    g.fillStyle(pal.threshold, 1)
    g.fillRect(tx, ty, tw, th)
    g.fillStyle(pal.thresholdHi, 0.85)
    if      (hiSide === 'bottom') g.fillRect(tx, ty + th - 1, tw, 1)
    else if (hiSide === 'top')    g.fillRect(tx, ty,          tw, 1)
    else if (hiSide === 'right')  g.fillRect(tx + tw - 1, ty, 1, th)
    else if (hiSide === 'left')   g.fillRect(tx,          ty, 1, th)
    g.fillStyle(pal.bevel, 0.6)
    if      (bevelSide === 'top')    g.fillRect(tx, ty - 1,        tw, 1)
    else if (bevelSide === 'bottom') g.fillRect(tx, ty + th,       tw, 1)
    else if (bevelSide === 'left')   g.fillRect(tx - 1,        ty, 1, th)
    else if (bevelSide === 'right')  g.fillRect(tx + tw,       ty, 1, th)
  }

  _drawClosedDoors() {
    const g = this._gDoors
    for (const room of this._gameState.dungeon.rooms ?? []) {
      for (const cp of room.connectionPoints ?? []) {
        if (cp.open) continue                 // fully open — nothing to draw
        const rect = this._cpDoorRect(room, cp)
        if (!rect) continue
        const style    = this._effectiveDoorStyle(room, cp)
        const progress = cp.openProgress || 0
        this._drawClosedDoor(g, rect, style, progress)
      }
    }
  }

  // Per-frame animation tick. Advances any cp.opening progress and triggers
  // a partial redraw of the door overlay layer when a door's state changed
  // (without redrawing the whole dungeon). Game.update() must call this.
  update(deltaMs) {
    if (!this._gameState?.dungeon?.rooms) return
    const dt = (deltaMs || 0) / 1000
    let changed = false
    for (const room of this._gameState.dungeon.rooms) {
      for (const cp of room.connectionPoints ?? []) {
        if (!cp.opening) continue
        cp.openProgress = Math.min(1, (cp.openProgress || 0) + dt / DOOR_OPEN_DURATION_S)
        changed = true
        if (cp.openProgress >= 1) {
          cp.opening      = false
          cp.open         = true
          cp.openProgress = 1
          EventBus.emit('DOOR_OPENED', { roomId: room.instanceId, cp })
        }
      }
    }
    if (changed) this._redrawDoors()
  }

  // Public helper — kicks an opening animation on this cp. Idempotent: a
  // cp already open or already opening doesn't restart. Used by the
  // adventurer step-on trigger and the day-start hook.
  openDoor(cp) {
    if (!cp || cp.open || cp.opening) return false
    cp.opening      = true
    cp.openProgress = 0
    EventBus.emit('DOOR_OPENING', { cp })
    this._redrawDoors()
    return true
  }

  // Force a cp back to closed state (no animation). Used by the day-end
  // hook to reset entry-hall external doors so they re-animate next day.
  closeDoor(cp) {
    if (!cp) return
    cp.open         = false
    cp.opening      = false
    cp.openProgress = 0
    this._redrawDoors()
  }

  _redrawDoors() {
    this._gDoors.clear()
    this._drawClosedDoors()
  }

  // Pixel rect of the 2 × WALL_THICKNESS DOOR block belonging to this cp.
  // Returns null for a cp that doesn't sit on the room's edge (corner /
  // interior cps don't paint a door block — see DungeonGrid._writeTiles).
  _cpDoorRect(room, cp) {
    const WT = Balance.WALL_THICKNESS
    const onTop = cp.y === 0
    const onBot = cp.y === room.height - 1
    const onLft = cp.x === 0
    const onRgt = cp.x === room.width - 1
    if ((onTop || onBot) && (onLft || onRgt)) return null
    if (!onTop && !onBot && !onLft && !onRgt)  return null

    let rect
    if (onTop || onBot) {
      // Horizontal wall — door block is 2 cells wide × WT cells tall.
      const alongDx = ((room.width - 1) - cp.x) >= cp.x ? 1 : -1
      const xStart  = Math.min(cp.x, cp.x + alongDx)
      const yStart  = onTop ? 0 : room.height - WT
      rect = {
        px: (room.gridX + xStart) * TS,
        py: (room.gridY + yStart) * TS,
        pw: 2 * TS,
        ph: WT * TS,
        axis: 'h',
        outerSide: onTop ? 'top' : 'bottom',
      }
    } else {
      // Vertical wall — door block is WT cells wide × 2 cells tall.
      const alongDy = ((room.height - 1) - cp.y) >= cp.y ? 1 : -1
      const yStart  = Math.min(cp.y, cp.y + alongDy)
      const xStart  = onLft ? 0 : room.width - WT
      rect = {
        px: (room.gridX + xStart) * TS,
        py: (room.gridY + yStart) * TS,
        pw: WT * TS,
        ph: 2 * TS,
        axis: 'v',
        outerSide: onLft ? 'left' : 'right',
      }
    }
    // Shrink by CAPSTONE_W on the outward side so the wall cap (drawn on
    // each DOOR cell by _drawDoorCell) shows above the closed door.
    switch (rect.outerSide) {
      case 'top':    rect.py += CAPSTONE_W; rect.ph -= CAPSTONE_W; break
      case 'bottom': rect.ph -= CAPSTONE_W; break
      case 'left':   rect.px += CAPSTONE_W; rect.pw -= CAPSTONE_W; break
      case 'right':  rect.pw -= CAPSTONE_W; break
    }
    return rect
  }

  // Effective style for the door: cp.style verbatim unless the doorway
  // partners with the boss chamber, in which case both sides render boss.
  _effectiveDoorStyle(room, cp) {
    const own = cp.style || 'regular'
    if (own === 'boss')                         return 'boss'
    if (room.definitionId === 'boss_chamber')   return 'boss'
    if (cp.external)                            return own
    // Find the paired room by tracing 2 cells outward (matches the snap
    // model — rooms share a 1-cell gap between their outer wall rings).
    const v = DIR_VECS[cp.direction]
    if (!v) return own
    const matchX = room.gridX + cp.x + v.dx * 2
    const matchY = room.gridY + cp.y + v.dy * 2
    for (const other of this._gameState.dungeon.rooms ?? []) {
      if (other.instanceId === room.instanceId)            continue
      if (matchX < other.gridX || matchX >= other.gridX + other.width)  continue
      if (matchY < other.gridY || matchY >= other.gridY + other.height) continue
      if (other.definitionId === 'boss_chamber')           return 'boss'
      break
    }
    return own
  }

  // Paint a single closed door over the given rect. `progress` (0..1) drives
  // the split-aside animation: 0 = fully closed (full art), 1 = fully open
  // (nothing drawn). Mid-progress: the two door halves shrink toward the
  // walls on either side, sliding the doorway open.
  _drawClosedDoor(g, rect, style, progress = 0) {
    if (progress >= 1) return
    const pal = DOOR_STYLES[style] || DOOR_STYLES.regular
    // Inset the closed-door art by JAMB_W on each lateral side so the
    // doorway jambs (drawn separately by _drawDoorwayArchitecture) are
    // visible as a frame around the door.
    const baseRect = rect
    const axis = baseRect.axis
    let px = baseRect.px, py = baseRect.py, pw = baseRect.pw, ph = baseRect.ph
    if (axis === 'h') { px += JAMB_W; pw -= 2 * JAMB_W }
    else              { py += JAMB_W; ph -= 2 * JAMB_W }

    // Mid-animation: render simplified shrinking halves and bail before the
    // detailed (closed-state) art. Quadratic ease-out so the door starts
    // moving fast and settles open.
    if (progress > 0) {
      const eased = 1 - (1 - progress) * (1 - progress)
      if (axis === 'h') {
        const halfW = pw / 2
        const visW  = Math.max(0, Math.round(halfW * (1 - eased)))
        if (visW > 0) {
          g.fillStyle(pal.base, 1)
          g.fillRect(px,                    py, visW, ph)   // left half
          g.fillRect(px + pw - visW,        py, visW, ph)   // right half
          // Inner edge (the half's sliding edge) gets a 1-px split-seam
          // accent so the moving edge reads as the door's seam.
          g.fillStyle(pal.split, 1)
          g.fillRect(px + visW - 1,         py, 1, ph)
          g.fillRect(px + pw - visW,        py, 1, ph)
        }
      } else {
        const halfH = ph / 2
        const visH  = Math.max(0, Math.round(halfH * (1 - eased)))
        if (visH > 0) {
          g.fillStyle(pal.base, 1)
          g.fillRect(px, py,                pw, visH)       // top half
          g.fillRect(px, py + ph - visH,    pw, visH)       // bottom half
          g.fillStyle(pal.split, 1)
          g.fillRect(px, py + visH - 1,     pw, 1)
          g.fillRect(px, py + ph - visH,    pw, 1)
        }
      }
      return
    }

    // Base fill — covers the entire door block.
    g.fillStyle(pal.base, 1)
    g.fillRect(px, py, pw, ph)

    // Wood-grain / stone-grain streaks. For a horizontal wall (axis 'h') the
    // door's "long axis" runs left-right (the passage opens N-S); for a
    // vertical wall the long axis runs top-bottom. Streaks run along the
    // long axis so the door visually reads like planks set into the doorway.
    g.fillStyle(pal.grain, 0.45)
    if (axis === 'h') {
      // 2 horizontal streaks at 1/3 and 2/3 of the door height.
      g.fillRect(px + 2, py + Math.floor(ph / 3),     pw - 4, 1)
      g.fillRect(px + 2, py + Math.floor(2 * ph / 3), pw - 4, 1)
    } else {
      g.fillRect(px + Math.floor(pw / 3),     py + 2, 1, ph - 4)
      g.fillRect(px + Math.floor(2 * pw / 3), py + 2, 1, ph - 4)
    }

    // Outer bevel — 1-px highlight on the side that faces "up" (the lit
    // edge), darker shadow on the opposite side. Sells the doorway as set
    // into the wall ring rather than floating on top.
    g.fillStyle(pal.edge, 0.7)
    if (axis === 'h') {
      g.fillRect(px, py,            pw, 1)             // top edge highlight
      g.fillRect(px, py + ph - 1,   pw, 1)             // bottom edge
    } else {
      g.fillRect(px,            py, 1, ph)
      g.fillRect(px + pw - 1,   py, 1, ph)
    }

    // Banding — 2 perpendicular bands across the door (iron straps for
    // regular/boss, brass framing for entrance). Drawn at 1/4 and 3/4 of
    // the perpendicular axis so they read as sturdy hardware.
    g.fillStyle(pal.band, 0.85)
    if (axis === 'h') {
      const bandH = 3
      g.fillRect(px, py + Math.floor(ph / 4)     - 1, pw, bandH)
      g.fillRect(px, py + Math.floor(3 * ph / 4) - 1, pw, bandH)
    } else {
      const bandW = 3
      g.fillRect(px + Math.floor(pw / 4)     - 1, py, bandW, ph)
      g.fillRect(px + Math.floor(3 * pw / 4) - 1, py, bandW, ph)
    }

    // Rivets — small 2x2 highlight squares near the band ends. For boss
    // doors these glow red; for entrance, brass studs.
    g.fillStyle(pal.bandHi, 0.9)
    if (axis === 'h') {
      const yA = py + Math.floor(ph / 4)
      const yB = py + Math.floor(3 * ph / 4)
      for (const ry of [yA, yB]) {
        g.fillRect(px + 4,        ry, 2, 2)
        g.fillRect(px + pw - 6,   ry, 2, 2)
        g.fillRect(px + Math.floor(pw / 2) - 1, ry, 2, 2)
      }
    } else {
      const xA = px + Math.floor(pw / 4)
      const xB = px + Math.floor(3 * pw / 4)
      for (const rx of [xA, xB]) {
        g.fillRect(rx, py + 4,        2, 2)
        g.fillRect(rx, py + ph - 6,   2, 2)
        g.fillRect(rx, py + Math.floor(ph / 2) - 1, 2, 2)
      }
    }

    // Split seam — 2-px line down the centre of the wall axis. Animation
    // (Phase B) will tween the two halves apart from this seam.
    g.fillStyle(pal.split, 1)
    if (axis === 'h') {
      g.fillRect(px + Math.floor(pw / 2) - 1, py, 2, ph)
    } else {
      g.fillRect(px, py + Math.floor(ph / 2) - 1, pw, 2)
    }

    // Style-specific extras.
    if (style === 'entrance') {
      // Decorative sigil — a small cross at the centre of the door block.
      g.fillStyle(pal.bandHi, 1)
      const cx = px + Math.floor(pw / 2)
      const cy = py + Math.floor(ph / 2)
      g.fillRect(cx - 4, cy,     9, 1)
      g.fillRect(cx,     cy - 4, 1, 9)
    } else if (style === 'boss') {
      // Glowing eyes — 2 red dots above the centre, suggesting "watching".
      g.fillStyle(pal.bandHi, 1)
      const cx = px + Math.floor(pw / 2)
      const cy = py + Math.floor(ph / 2)
      if (axis === 'h') {
        g.fillRect(cx - 8, cy - Math.floor(ph / 6), 2, 2)
        g.fillRect(cx + 6, cy - Math.floor(ph / 6), 2, 2)
      } else {
        g.fillRect(cx - Math.floor(pw / 6), cy - 8, 2, 2)
        g.fillRect(cx - Math.floor(pw / 6), cy + 6, 2, 2)
      }
    }
  }

  // Plain dark-passage render for the 1-tile gap between two adjacent
  // rooms' doorways. No jambs, capstone, or threshold — the framing belongs
  // to the room walls on either end. The gap IS the doorway interior, so
  // it renders on the overhead layer (above entities) — entities passing
  // through visually disappear under the archway between the two rooms.
  _drawDoorGap(_gFloor, px, py, ctx) {
    const gOver = this._gOverhead
    gOver.fillStyle(DOOR_PASSAGE_DARK, 1)
    gOver.fillRect(px, py, TS, TS)
    gOver.fillStyle(DOOR_PASSAGE_LIGHT, 0.45)
    if (ctx.NisDoor && ctx.SisDoor) {
      // N–S passage gap — vertical footpath stripe.
      gOver.fillRect(px + Math.floor((TS - 4) / 2), py, 4, TS)
    } else {
      // E–W passage gap — horizontal stripe.
      gOver.fillRect(px, py + Math.floor((TS - 4) / 2), TS, 4)
    }
  }

  // Detect doorway orientation and which side faces "outside" the room.
  // axis  — 'NS' means passage runs N–S (door sits in a top/bottom wall;
  //         jambs frame the opening on left/right); 'EW' = inverse.
  // outer — 'N' | 'S' | 'E' | 'W' | null. The cardinal whose neighbour is
  //         NOT a floor — i.e. the side that gets the capstone header.
  //         null when both passage-axis ends are floor (room-to-room).
  _detectDoorContext(x, y) {
    const tiles = this._gameState.dungeon?.tiles
    if (!tiles) return { axis: 'NS', outer: 'N' }
    const rows = tiles.length
    const cols = tiles[0]?.length ?? 0
    const at = (cx, cy) => {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return TILE.VOID
      return tiles[cy][cx]
    }
    const isWall  = t => t === TILE.WALL || t === TILE.BOSS_WALL || t === TILE.WALL_CAP
    const isFloor = t => t === TILE.FLOOR || t === TILE.BOSS_FLOOR
    const isDoor  = t => t === TILE.DOOR
    // For widened (multi-tile) doorways the wall-axis neighbour is itself a
    // DOOR. Treat door-neighbours as walls for axis detection so the pair
    // still reads as "in a wall ring", and surface per-side door flags so
    // the renderer can drop the inner jambs at the seam.
    const wallOrDoor = t => isWall(t) || isDoor(t)

    const N = at(x,     y - 1)
    const S = at(x,     y + 1)
    const E = at(x + 1, y)
    const W = at(x - 1, y)

    let axis = (wallOrDoor(W) && wallOrDoor(E)) ? 'NS'
             : (wallOrDoor(N) && wallOrDoor(S)) ? 'EW'
             : (isFloor(N) || isFloor(S)) ? 'NS' : 'EW'

    let outer = null
    if (axis === 'NS') {
      if (isFloor(S) && !isFloor(N)) outer = 'N'
      else if (isFloor(N) && !isFloor(S)) outer = 'S'
    } else {
      if (isFloor(E) && !isFloor(W)) outer = 'W'
      else if (isFloor(W) && !isFloor(E)) outer = 'E'
    }
    return {
      axis, outer,
      WisDoor: isDoor(W), EisDoor: isDoor(E),
      NisDoor: isDoor(N), SisDoor: isDoor(S),
    }
  }

  // N–S passage doorway (door sits in a top or bottom wall). Jambs frame the
  // opening on left/right; the capstone header continues across the outer
  // edge with a brighter keystone wedge above the opening.
  _drawDoorNS(g, px, py, ctx) {
    const outer = ctx.outer
    const gOver = this._gOverhead   // architectural elements go above entities
    const JAMB_W   = 9
    // For widened doorways the inner-seam jamb is suppressed so the pair
    // reads as a single wide opening. Outer jambs (away from the seam) stay.
    const drawLeftJamb  = !ctx.WisDoor
    const drawRightJamb = !ctx.EisDoor
    const openX    = drawLeftJamb  ? px + JAMB_W      : px
    const openR    = drawRightJamb ? px + TS - JAMB_W : px + TS
    const openW    = openR - openX
    const openYTop = py + CAPSTONE_W                 // brick-face start
    const openYBot = py + TS - BASEBOARD_W           // brick-face end (above baseboard area)

    // ── FLOOR LAYER (g, under entities) — passage, footpath, threshold ──
    g.fillStyle(DOOR_PASSAGE_DARK, 1)
    g.fillRect(openX, openYTop, openW, openYBot - openYTop)
    if (!ctx.WisDoor) {
      const stripeOriginX = openX + (ctx.EisDoor ? Math.floor((openW * 2 - 4) / 2)
                                                 : Math.floor((openW - 4) / 2))
      const stripeW = 4
      const stripeRightCap = ctx.EisDoor ? px + 2 * TS : px + TS
      const stripeX = Math.min(stripeOriginX, stripeRightCap - stripeW)
      g.fillStyle(DOOR_PASSAGE_LIGHT, 0.55)
      g.fillRect(stripeX, openYTop, stripeW, openYBot - openYTop)
    }
    if (outer === 'S') {
      g.fillStyle(DOOR_THRESHOLD, 1)
      g.fillRect(openX, openYTop, openW, 4)
      g.fillStyle(DOOR_THRESHOLD_HI, 0.6)
      g.fillRect(openX, openYTop, openW, 1)
    } else {
      g.fillStyle(DOOR_THRESHOLD, 1)
      g.fillRect(openX, openYBot - 4, openW, 4)
      g.fillStyle(DOOR_THRESHOLD_HI, 0.6)
      g.fillRect(openX, openYBot - 1, openW, 1)
    }

    // ── OVERHEAD LAYER (gOver, above entities) — capstone, jambs, keystone ──
    const capY = (outer === 'S') ? py + TS - CAPSTONE_W : py
    const capSide = (outer === 'S') ? 'bottom' : 'top'
    const frOver = (rx, ry, rw, rh) => gOver.fillRect(rx, ry, rw, rh)
    this._drawCapstoneBand(gOver, frOver, px, capY, TS, CAPSTONE_W, capSide)
    if (drawLeftJamb)  this._drawDoorJamb(gOver, px,                openYTop, JAMB_W, openYBot - openYTop, 'left')
    if (drawRightJamb) this._drawDoorJamb(gOver, px + TS - JAMB_W,  openYTop, JAMB_W, openYBot - openYTop, 'right')
    gOver.fillStyle(DOOR_ARCH_INNER, 0.85)
    if (outer !== 'S') gOver.fillRect(openX, openYTop, openW, 1)
    else               gOver.fillRect(openX, openYBot - 1, openW, 1)
    if (!ctx.WisDoor) {
      const keyOpenW = ctx.EisDoor ? openW * 2 : openW
      const keyOpenX = openX
      const keyX = keyOpenX + Math.floor((keyOpenW - 5) / 2)
      gOver.fillStyle(DOOR_KEYSTONE_HI, 0.70)
      if (outer === 'S') gOver.fillRect(keyX, py + TS - CAPSTONE_W + 1, 5, CAPSTONE_W - 2)
      else               gOver.fillRect(keyX, py + 1,                    5, CAPSTONE_W - 2)
    }
  }

  // E–W passage doorway (door sits in a left or right wall). Mirrored layout
  // of _drawDoorNS — jambs frame the opening top/bottom, capstone header runs
  // down the outer side.
  _drawDoorEW(g, px, py, ctx) {
    const outer = ctx.outer
    const gOver = this._gOverhead
    const JAMB_H   = 9
    const drawTopJamb = !ctx.NisDoor
    const drawBotJamb = !ctx.SisDoor
    const openY    = drawTopJamb ? py + JAMB_H        : py
    const openB    = drawBotJamb ? py + TS - JAMB_H   : py + TS
    const openH    = openB - openY
    const openXLft = px + CAPSTONE_W
    const openXRgt = px + TS - BASEBOARD_W

    // ── FLOOR LAYER ──
    g.fillStyle(DOOR_PASSAGE_DARK, 1)
    g.fillRect(openXLft, openY, openXRgt - openXLft, openH)
    if (!ctx.NisDoor) {
      const stripeOpenH = ctx.SisDoor ? openH * 2 : openH
      const stripeY     = openY + Math.floor((stripeOpenH - 4) / 2)
      const stripeBotCap = ctx.SisDoor ? py + 2 * TS : py + TS
      const stripeYC = Math.min(stripeY, stripeBotCap - 4)
      g.fillStyle(DOOR_PASSAGE_LIGHT, 0.55)
      g.fillRect(openXLft, stripeYC, openXRgt - openXLft, 4)
    }
    if (outer === 'E') {
      g.fillStyle(DOOR_THRESHOLD, 1)
      g.fillRect(openXLft, openY, 4, openH)
      g.fillStyle(DOOR_THRESHOLD_HI, 0.6)
      g.fillRect(openXLft, openY, 1, openH)
    } else {
      g.fillStyle(DOOR_THRESHOLD, 1)
      g.fillRect(openXRgt - 4, openY, 4, openH)
      g.fillStyle(DOOR_THRESHOLD_HI, 0.6)
      g.fillRect(openXRgt - 1, openY, 1, openH)
    }

    // ── OVERHEAD LAYER ──
    const capX = (outer === 'E') ? px + TS - CAPSTONE_W : px
    const capSide = (outer === 'E') ? 'right' : 'left'
    const frOver = (rx, ry, rw, rh) => gOver.fillRect(rx, ry, rw, rh)
    this._drawCapstoneBand(gOver, frOver, capX, py, CAPSTONE_W, TS, capSide)
    if (drawTopJamb) this._drawDoorJamb(gOver, openXLft, py,               openXRgt - openXLft, JAMB_H, 'top')
    if (drawBotJamb) this._drawDoorJamb(gOver, openXLft, py + TS - JAMB_H, openXRgt - openXLft, JAMB_H, 'bottom')
    gOver.fillStyle(DOOR_ARCH_INNER, 0.85)
    if (outer !== 'E') gOver.fillRect(openXLft, openY, 1, openH)
    else               gOver.fillRect(openXRgt - 1, openY, 1, openH)
    if (!ctx.NisDoor) {
      const keyOpenH = ctx.SisDoor ? openH * 2 : openH
      const keyY = openY + Math.floor((keyOpenH - 5) / 2)
      gOver.fillStyle(DOOR_KEYSTONE_HI, 0.70)
      if (outer === 'E') gOver.fillRect(px + TS - CAPSTONE_W + 1, keyY, CAPSTONE_W - 2, 5)
      else               gOver.fillRect(px + 1,                   keyY, CAPSTONE_W - 2, 5)
    }
  }

  // Single stone jamb — a column of CAPSTONE_BASE stone with edge highlights
  // and a faint horizontal seam suggesting two stacked blocks.
  // `side` ∈ 'left' | 'right' (vertical jamb) | 'top' | 'bottom' (horizontal).
  _drawDoorJamb(g, jx, jy, jw, jh, side) {
    g.fillStyle(CAPSTONE_BASE, 1)
    g.fillRect(jx, jy, jw, jh)

    g.fillStyle(CAPSTONE_HIGHLIGHT, 0.7)
    g.fillStyle(CAPSTONE_SHADOW,    0.85)
    if (side === 'left') {
      g.fillStyle(CAPSTONE_HIGHLIGHT, 0.7); g.fillRect(jx,            jy, 1,  jh)
      g.fillStyle(CAPSTONE_SHADOW,    0.85); g.fillRect(jx + jw - 1,  jy, 1,  jh)
      g.fillStyle(CAPSTONE_SHADOW,    0.6);  g.fillRect(jx, jy + Math.floor(jh / 2), jw, 1)
    } else if (side === 'right') {
      g.fillStyle(CAPSTONE_HIGHLIGHT, 0.7); g.fillRect(jx + jw - 1,  jy, 1,  jh)
      g.fillStyle(CAPSTONE_SHADOW,    0.85); g.fillRect(jx,           jy, 1,  jh)
      g.fillStyle(CAPSTONE_SHADOW,    0.6);  g.fillRect(jx, jy + Math.floor(jh / 2), jw, 1)
    } else if (side === 'top') {
      g.fillStyle(CAPSTONE_HIGHLIGHT, 0.7); g.fillRect(jx, jy,            jw, 1)
      g.fillStyle(CAPSTONE_SHADOW,    0.85); g.fillRect(jx, jy + jh - 1,  jw, 1)
      g.fillStyle(CAPSTONE_SHADOW,    0.6);  g.fillRect(jx + Math.floor(jw / 2), jy, 1, jh)
    } else {
      g.fillStyle(CAPSTONE_HIGHLIGHT, 0.7); g.fillRect(jx, jy + jh - 1,  jw, 1)
      g.fillStyle(CAPSTONE_SHADOW,    0.85); g.fillRect(jx, jy,           jw, 1)
      g.fillStyle(CAPSTONE_SHADOW,    0.6);  g.fillRect(jx + Math.floor(jw / 2), jy, 1, jh)
    }
  }

  // ── Per-room category tint wash ────────────────────────────────────────────
  // A faint coloured rectangle painted over each room's interior so trap
  // rooms feel angry-red, treasure feels gold, etc. — no per-tile work, just
  // one fill per room. Skipped for categories with no tint.
  _drawCategoryTints() {
    const roomDefs = this._scene.cache.json.get('rooms') ?? []
    const defMap   = Object.fromEntries(roomDefs.map(d => [d.id, d]))
    const g = this._gTints
    for (const room of this._gameState.dungeon.rooms) {
      const def   = defMap[room.definitionId] ?? {}
      const style = ROOM_STYLE[def.category] ?? ROOM_STYLE.default
      if (!style.tint) continue
      const px = room.gridX * TS
      const py = room.gridY * TS
      const pw = room.width  * TS
      const ph = room.height * TS
      g.fillStyle(style.tint, 0.08)
      g.fillRect(px, py, pw, ph)
    }
  }

  // ── Background & grid ──────────────────────────────────────────────────────

  _drawBackground() {
    const { gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    const W = gw * TS
    const H = gh * TS

    // Stone bedrock base — warm gray-brown across the entire grid. Rooms
    // get overpainted on top by _drawTiles. The empty grid reads as "rock
    // we haven't carved yet" instead of dark void.
    this._gBg.fillStyle(STONE_BASE, 1)
    this._gBg.fillRect(0, 0, W, H)
    // Soft central darkening — the further you get from the dungeon's
    // center, the gloomier the rock; gives the grid a slight vignette.
    this._gBg.fillStyle(0x000000, 0.18)
    this._gBg.fillEllipse(W / 2, H / 2, W * 1.4, H * 1.4)
    // Per-cell hash texture — speckles, pock marks, rare cracks/veins.
    this._drawVoidStoneTexture()
    // Lighter halo immediately around each placed room — "freshly chiseled
    // edge" effect. Drawn after texture so the halo isn't speckled over.
    this._drawCarveHalo()
  }

  // Per-cell stone-texture pass. Walks every TILE.VOID cell and stamps a
  // few hash-driven detail bits — light speckles, dark pock marks, the
  // occasional vein streak — so the empty grid doesn't read as a flat
  // fill. Only paints VOID cells; floor/wall cells get their own art
  // from _drawTiles.
  _drawVoidStoneTexture() {
    const { tiles, gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    const g = this._gBg
    for (let y = 0; y < gh; y++) {
      const row = tiles[y]
      if (!row) continue
      for (let x = 0; x < gw; x++) {
        if (row[x] !== TILE.VOID) continue
        const h  = _tileHash(x, y)
        const px = x * TS, py = y * TS
        // Bucket 0..255 → light/dark/vein/clean
        const tint = h & 0xff
        if (tint < 32) {
          // Heavier shadow patch — covers most of the cell.
          g.fillStyle(STONE_DARK, 0.55)
          g.fillRect(px + ((h >>> 8) & 0x0f), py + ((h >>> 12) & 0x0f), 14, 14)
        } else if (tint < 80) {
          // Single dark pock.
          g.fillStyle(STONE_DARK, 0.7)
          g.fillRect(px + ((h >>> 8) & 0x1f) % (TS - 4), py + ((h >>> 13) & 0x1f) % (TS - 4), 2, 2)
        } else if (tint > 220) {
          // Lighter speckle.
          g.fillStyle(STONE_LIGHT, 0.55)
          g.fillRect(px + ((h >>> 8) & 0x1f) % (TS - 6), py + ((h >>> 13) & 0x1f) % (TS - 6), 4, 3)
        } else if (tint > 196) {
          // Tiny highlight chip.
          g.fillStyle(STONE_LIGHT, 0.45)
          g.fillRect(px + ((h >>> 8) & 0x1f) % (TS - 2), py + ((h >>> 13) & 0x1f) % (TS - 2), 1, 1)
        }
        // Rare vein — diagonal streak crossing the cell.
        if (((h >>> 16) & 0xff) > 246) {
          g.fillStyle(STONE_VEIN, 0.45)
          const len = 8 + ((h >>> 24) & 0x07)
          const dir = (h >>> 20) & 1 ? 1 : -1
          const sx  = px + 4 + ((h >>> 21) & 0x07)
          const sy  = py + 4 + ((h >>> 18) & 0x07)
          for (let i = 0; i < len; i++) {
            const cx = sx + i * dir
            const cy = sy + i
            if (cx >= px && cx < px + TS && cy >= py && cy < py + TS) {
              g.fillRect(cx, cy, 1, 1)
            }
          }
        }
      }
    }
  }

  // Lighter rim around every placed room — frames the rooms against the
  // deep bedrock so they read as "carved out". For each VOID cell that
  // sits 1 tile outside any room's outer perimeter, paint a soft lighter
  // stone wash with a 1-px brighter edge on the side facing the room.
  _drawCarveHalo() {
    const { tiles, gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    const g = this._gBg
    const isVoid = (tx, ty) =>
      tx >= 0 && ty >= 0 && tx < gw && ty < gh && tiles[ty]?.[tx] === TILE.VOID
    const isInsideRoom = (tx, ty) => {
      if (tx < 0 || ty < 0 || tx >= gw || ty >= gh) return false
      const t = tiles[ty]?.[tx]
      return t != null && t !== TILE.VOID
    }
    for (const room of this._gameState.dungeon.rooms ?? []) {
      const x0 = room.gridX - 1, x1 = room.gridX + room.width
      const y0 = room.gridY - 1, y1 = room.gridY + room.height
      // Top & bottom rows of the halo (full width including corners).
      for (let tx = x0; tx <= x1; tx++) {
        if (isVoid(tx, y0)) this._stampHalo(g, tx, y0, 'top', isInsideRoom)
        if (isVoid(tx, y1)) this._stampHalo(g, tx, y1, 'bottom', isInsideRoom)
      }
      // Left & right columns (excluding corners already done).
      for (let ty = y0 + 1; ty < y1; ty++) {
        if (isVoid(x0, ty)) this._stampHalo(g, x0, ty, 'left',  isInsideRoom)
        if (isVoid(x1, ty)) this._stampHalo(g, x1, ty, 'right', isInsideRoom)
      }
    }
  }

  // Spawn a short dust burst around a freshly-placed room — sells the
  // "I just chiseled this out of bedrock" feel. Particles drift outward
  // from the room's center and fade over ~0.5s. Each is its own scene-level
  // GameObject so they live OUTSIDE the renderer's redraw cycle and clean
  // themselves up via tween onComplete.
  _burstCarveDust(payload) {
    const room = payload?.room
    if (!room) return
    const scene = this._scene
    const cx = (room.gridX + room.width  / 2) * TS
    const cy = (room.gridY + room.height / 2) * TS
    const Wp = room.width  * TS
    const Hp = room.height * TS
    const PERIM = 2 * (Wp + Hp)
    const COUNT = 30
    const COLORS = [0x6a5a48, 0x8a7a60, 0x4a3e30]
    for (let i = 0; i < COUNT; i++) {
      // Walk perimeter at evenly-spaced offsets (with random jitter so the
      // particles don't fall on a uniform grid).
      const t = ((i + Math.random()) / COUNT) * PERIM
      let x, y
      if (t < Wp)               { x = room.gridX * TS + t;             y = room.gridY * TS }
      else if (t < Wp + Hp)     { x = room.gridX * TS + Wp;            y = room.gridY * TS + (t - Wp) }
      else if (t < 2 * Wp + Hp) { x = room.gridX * TS + (2 * Wp + Hp - t); y = room.gridY * TS + Hp }
      else                       { x = room.gridX * TS;                 y = room.gridY * TS + (2 * (Wp + Hp) - t) }

      const jx = (Math.random() - 0.5) * 6
      const jy = (Math.random() - 0.5) * 6
      const color = COLORS[(Math.random() * COLORS.length) | 0]
      const size  = 2 + Math.floor(Math.random() * 3)   // 2–4 px
      const dust = scene.add.rectangle(x + jx, y + jy, size, size, color, 0.9).setDepth(4.5)

      // Drift OUTWARD from the room center so dust flies into the void.
      const dx = (x - cx), dy = (y - cy)
      const len = Math.hypot(dx, dy) || 1
      const drift = 10 + Math.random() * 14
      scene.tweens.add({
        targets:  dust,
        x:        dust.x + (dx / len) * drift,
        y:        dust.y + (dy / len) * drift,
        alpha:    0,
        scale:    0.3,
        duration: 350 + Math.random() * 300,
        ease:     'Quad.Out',
        onComplete: () => dust.destroy(),
      })
    }
  }

  // Paint a single carve-halo cell. `side` indicates which face of the
  // cell touches the room (so the highlight goes there).
  _stampHalo(g, tx, ty, side, isInsideRoom) {
    const px = tx * TS, py = ty * TS
    g.fillStyle(STONE_HALO, 0.55)
    g.fillRect(px, py, TS, TS)
    g.fillStyle(STONE_HALO_HI, 0.8)
    if      (side === 'top'    && isInsideRoom(tx, ty + 1)) g.fillRect(px, py + TS - 1, TS, 1)
    else if (side === 'bottom' && isInsideRoom(tx, ty - 1)) g.fillRect(px, py,           TS, 1)
    else if (side === 'left'   && isInsideRoom(tx + 1, ty)) g.fillRect(px + TS - 1, py, 1, TS)
    else if (side === 'right'  && isInsideRoom(tx - 1, ty)) g.fillRect(px,          py, 1, TS)
  }

  // Grid lines render on a dedicated layer so they can be toggled without
  // re-rendering the bedrock. Hidden by default; NightPhase shows them
  // while a room placement preview is active (see setGridVisible).
  _drawGrid() {
    if (!this._showGrid) return
    const { gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    const g = this._gGrid

    g.lineStyle(1, PALETTE.gridLine, 0.35)
    for (let tx = 0; tx <= gw; tx++) {
      g.beginPath(); g.moveTo(tx * TS, 0); g.lineTo(tx * TS, gh * TS); g.strokePath()
    }
    for (let ty = 0; ty <= gh; ty++) {
      g.beginPath(); g.moveTo(0, ty * TS); g.lineTo(gw * TS, ty * TS); g.strokePath()
    }
    g.lineStyle(1, PALETTE.gridLine, 0.7)
    for (let tx = 0; tx <= gw; tx += 5) {
      g.beginPath(); g.moveTo(tx * TS, 0); g.lineTo(tx * TS, gh * TS); g.strokePath()
    }
    for (let ty = 0; ty <= gh; ty += 5) {
      g.beginPath(); g.moveTo(0, ty * TS); g.lineTo(gw * TS, ty * TS); g.strokePath()
    }
  }

  // Public toggle — NightPhase calls setGridVisible(true) when a placement
  // is active and false on cancel/place. Triggers a redraw of just the
  // grid layer (no full dungeon redraw needed).
  setGridVisible(visible) {
    if (this._showGrid === visible) return
    this._showGrid = visible
    this._gGrid.clear()
    this._drawGrid()
  }

  // ── Room overlays (connection dots / inactive tint) ────────────────────────

  _drawRoomOverlays() {
    const roomDefs = this._scene.cache.json.get('rooms') ?? []
    const defMap   = Object.fromEntries(roomDefs.map(d => [d.id, d]))

    for (const room of this._gameState.dungeon.rooms) {
      const def   = defMap[room.definitionId] ?? {}
      const style = ROOM_STYLE[def.category] ?? ROOM_STYLE.default
      this._drawRoomOverlay(room, def, style)
    }
  }

  _drawRoomOverlay(room, def, style) {
    const px = room.gridX * TS
    const py = room.gridY * TS
    const pw = room.width  * TS
    const ph = room.height * TS

    // Connection-point markers — gated by DebugOverlay.showDoors.
    if (DebugOverlay.showDoors) {
      for (const cp of room.connectionPoints) {
        const mx = (room.gridX + cp.x) * TS + TS / 2
        const my = (room.gridY + cp.y) * TS + TS / 2
        this._gOverlay.fillStyle(style.border, 0.9)
        this._gOverlay.fillRect(mx - 3, my - 3, 6, 6)
        this._gOverlay.fillStyle(PALETTE.door, 1)
        this._gOverlay.fillRect(mx - 1, my - 1, 2, 2)
      }
    }

    // Inactive tint overlay.
    if (!room.isActive) {
      this._gOverlay.fillStyle(0x000000, 0.55)
      this._gOverlay.fillRect(px, py, pw, ph)
    }
  }

  // ── Collision overlay (debug) ──────────────────────────────────────────────

  _drawCollisionOverlay() {
    const g       = this._gCollision
    const roomDefs = this._scene.cache.json.get('rooms') ?? []
    const defMap   = Object.fromEntries(roomDefs.map(d => [d.id, d]))
    const tiles    = this._gameState.dungeon.tiles
    const WALL     = new Set([TILE.WALL, TILE.BOSS_WALL])

    for (const room of this._gameState.dungeon.rooms) {
      const def      = defMap[room.definitionId]
      const explicit = Array.isArray(def?.builderCollision) ? def.builderCollision : null
      for (let dy = 0; dy < room.height; dy++) {
        for (let dx = 0; dx < room.width; dx++) {
          const tx = room.gridX + dx
          const ty = room.gridY + dy
          const t  = tiles[ty]?.[tx] ?? TILE.VOID
          const blocking = explicit ? !!explicit[dy]?.[dx] : WALL.has(t)
          const px = tx * TS, py = ty * TS
          if (blocking) {
            g.fillStyle(0xff2244, 0.35)
            g.fillRect(px, py, TS, TS)
            g.lineStyle(1, 0xff7788, 0.7)
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + TS, py + TS); g.strokePath()
            g.beginPath(); g.moveTo(px + TS, py); g.lineTo(px, py + TS); g.strokePath()
          } else {
            g.fillStyle(0x33cc77, 0.18)
            g.fillRect(px, py, TS, TS)
          }
        }
      }
    }
  }
}

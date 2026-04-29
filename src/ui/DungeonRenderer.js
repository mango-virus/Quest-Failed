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
const BRICK_W          = 16
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
const BRICK_ZONE_SHIFT = 1

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

// Brick-size taper rescaled to the inner brick zone (TS - CAPSTONE_W = 23 px).
// Sum of each array is 23. Same convention as before: "tall/wide" end faces
// away from the floor.
const ROW_HEIGHTS_TALLTOP  = [8, 6, 5, 4]
const ROW_HEIGHTS_TALLBOT  = [4, 5, 6, 8]
const COL_WIDTHS_WIDELEFT  = [8, 6, 5, 4]
const COL_WIDTHS_WIDERIGHT = [4, 5, 6, 8]

// Doorway palette — stone jambs (capstone-toned), dark passage interior,
// and a worn threshold slab at the floor-side edge.
const DOOR_PASSAGE_DARK   = 0x121826    // shaded passage interior, "stone shadow"
const DOOR_PASSAGE_LIGHT  = 0x1f2940    // lit centre stripe of passage (worn footpath)
const DOOR_THRESHOLD      = 0x4a5868    // worn stone sill where doorway meets floor
const DOOR_THRESHOLD_HI   = 0x6a7888    // 1-px highlight along the threshold
const DOOR_KEYSTONE_HI    = 0x8a98a8    // brighter wedge above the opening
const DOOR_ARCH_INNER     = 0x2a3548    // thin arched-shadow line under capstone

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
    this._gTiles     = scene.add.graphics().setDepth(1)
    this._gTints     = scene.add.graphics().setDepth(1.2)
    this._gOverlay   = scene.add.graphics().setDepth(3)
    this._gCollision = scene.add.graphics().setDepth(3.2)
    this._gIcon      = scene.add.graphics().setDepth(4)

    // User-painted corner override (sparse 32×32 array of hex/null). When
    // set, _drawWallCorner overlays it on top of the procedural draw with
    // mirroring per corner kind. Re-loads each redraw so edits made in the
    // CornerEditor scene apply immediately on return to gameplay.
    this._cornerPattern = loadCornerPattern()

    EventBus.on('ROOM_PLACED',           this.redraw, this)
    EventBus.on('ROOM_REMOVED',          this.redraw, this)
    EventBus.on('GRID_EXPANDED',         this.redraw, this)
    EventBus.on('DEBUG_OVERLAY_CHANGED', this.redraw, this)

    this.redraw()
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  redraw() {
    this._gBg.clear()
    this._gTiles.clear()
    this._gTints.clear()
    this._gOverlay.clear()
    this._gIcon.clear()
    this._gCollision.clear()

    this._wallOrient = this._buildWallOrientation()
    // Pick up any newly saved corner pattern from the editor.
    this._cornerPattern = loadCornerPattern()

    this._drawBackground()
    this._drawGrid()
    this._drawTiles()
    this._drawCategoryTints()
    this._drawRoomOverlays()
    if (DebugOverlay.showCollision) this._drawCollisionOverlay()
  }

  // Tag every wall cell with one of:
  //   'hT'  — horizontal bricks, top wall    (taper smaller toward bottom)
  //   'hB'  — horizontal bricks, bottom wall (taper smaller toward top)
  //   'vL'  — vertical bricks,   left wall   (taper smaller toward right)
  //   'vR'  — vertical bricks,   right wall  (taper smaller toward left)
  //   'cTL' — top-left corner    (diagonal seam TL→BR)
  //   'cTR' — top-right corner   (TR→BL)
  //   'cBL' — bottom-left corner (BL→TR)
  //   'cBR' — bottom-right corner (BR→TL)
  _buildWallOrientation() {
    const orient = new Map()
    for (const room of this._gameState.dungeon.rooms) {
      const { gridX: rx, gridY: ry, width: rw, height: rh } = room
      for (let dx = 1; dx < rw - 1; dx++) {
        orient.set(`${rx + dx},${ry}`, 'hT')
        orient.set(`${rx + dx},${ry + rh - 1}`, 'hB')
      }
      for (let dy = 1; dy < rh - 1; dy++) {
        orient.set(`${rx},${ry + dy}`, 'vL')
        orient.set(`${rx + rw - 1},${ry + dy}`, 'vR')
      }
      orient.set(`${rx},${ry}`,                 'cTL')
      orient.set(`${rx + rw - 1},${ry}`,        'cTR')
      orient.set(`${rx},${ry + rh - 1}`,        'cBL')
      orient.set(`${rx + rw - 1},${ry + rh - 1}`, 'cBR')
    }
    return orient
  }

  destroy() {
    EventBus.off('ROOM_PLACED',           this.redraw, this)
    EventBus.off('ROOM_REMOVED',          this.redraw, this)
    EventBus.off('GRID_EXPANDED',         this.redraw, this)
    EventBus.off('DEBUG_OVERLAY_CHANGED', this.redraw, this)
    this._gBg.destroy()
    this._gTiles.destroy()
    this._gTints.destroy()
    this._gOverlay.destroy()
    this._gCollision.destroy()
    this._gIcon.destroy()
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
          const o = this._wallOrient.get(`${x},${y}`)
          if      (o === 'cTL' || o === 'cTR' || o === 'cBL' || o === 'cBR') {
            this._drawWallCorner(g, x, y, o)
          }
          else if (o === 'vL') this._drawWallV(g, x, y, null, true)
          else if (o === 'vR') this._drawWallV(g, x, y, null, false)
          else if (o === 'hB') this._drawWallH(g, x, y, null, false)
          else                 this._drawWallH(g, x, y, null, true)   // 'hT' or unknown
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
  _drawWallH(g, x, y, fillFn, tallTop = true, drawCapstone = true, drawBaseboard = true) {
    const px = x * TS, py = y * TS
    const fr = fillFn ?? ((rx, ry, rw, rh) => g.fillRect(rx, ry, rw, rh))
    const rowHeights = tallTop ? ROW_HEIGHTS_TALLTOP : ROW_HEIGHTS_TALLBOT

    // Brick zone is shifted toward the capstone by BASEBOARD_W so the smallest
    // brick row at the room-facing edge stays fully visible (not swallowed by
    // the baseboard). The capstone is drawn AFTER bricks and overlaps the
    // outermost BASEBOARD_W px of the largest brick row instead.
    const brickY = tallTop ? py + CAPSTONE_W - BRICK_ZONE_SHIFT : py + BRICK_ZONE_SHIFT
    const brickH = TS - CAPSTONE_W
    g.fillStyle(WALL_BASE, 1)
    fr(px, brickY, TS, brickH)

    let by = brickY
    for (let row = 0; row < ROWS_PER_TILE; row++) {
      const rh       = rowHeights[row]
      const worldRow = y * ROWS_PER_TILE + row
      const offsetX  = (worldRow & 1) ? BRICK_W / 2 : 0

      const firstBrickX = Math.floor((px - offsetX) / BRICK_W) * BRICK_W + offsetX

      for (let bx = firstBrickX; bx < px + TS; bx += BRICK_W) {
        const x0 = Math.max(bx, px)
        const x1 = Math.min(bx + BRICK_W, px + TS)
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

      // Vertical mortar at brick edges that fall inside the tile, height rh.
      g.fillStyle(MORTAR, 0.85)
      for (let bx = firstBrickX; bx <= px + TS; bx += BRICK_W) {
        if (bx > px && bx < px + TS) {
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
  _drawWallV(g, x, y, fillFn, wideLeft = true, drawCapstone = true, drawBaseboard = true) {
    const px = x * TS, py = y * TS
    const VH = BRICK_W        // 16 — brick height in vertical orientation (fixed)
    const COLS_PER_TILE = 4
    const colWidths = wideLeft ? COL_WIDTHS_WIDELEFT : COL_WIDTHS_WIDERIGHT
    const fr = fillFn ?? ((rx, ry, rw, rh) => g.fillRect(rx, ry, rw, rh))

    // Brick zone shifted toward the capstone by BASEBOARD_W so the smallest
    // brick column stays visible past the baseboard; capstone (drawn last)
    // covers the outermost BASEBOARD_W px of the widest brick column.
    const brickX = wideLeft ? px + CAPSTONE_W - BRICK_ZONE_SHIFT : px + BRICK_ZONE_SHIFT
    const brickW = TS - CAPSTONE_W
    g.fillStyle(WALL_BASE, 1)
    fr(brickX, py, brickW, TS)

    let bx = brickX
    for (let col = 0; col < COLS_PER_TILE; col++) {
      const cw       = colWidths[col]
      const worldCol = x * COLS_PER_TILE + col
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

      // Horizontal mortar at brick row boundaries within this column, cw wide.
      g.fillStyle(MORTAR, 0.85)
      for (let by = firstBrickY; by <= py + TS; by += VH) {
        if (by > py && by < py + TS) {
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
  _drawWallCorner(g, x, y, kind) {
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
    this._drawWallH(g, x, y, this._cornerFill(g, tilePx, tilePy, hMode), tallTop, false, false)
    this._drawWallV(g, x, y, this._cornerFill(g, tilePx, tilePy, vMode), wideLeft, false, false)
    this._drawCapstoneL(g, tilePx, tilePy, kind)
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
    // into the room's interior corner.
    this._drawBaseboardL(g, tilePx, tilePy, kind)

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

  // Arched stone doorway. The door tile sits inside the wall ring; we detect
  // its orientation (N-S passage vs E-W passage) and which side faces outside
  // by looking at the four cardinal neighbours, then draw matching capstone
  // header, two stone jambs framing the opening, a dark passage interior,
  // and a worn threshold slab where the doorway meets the room floor.
  _drawDoorCell(g, x, y) {
    const px = x * TS, py = y * TS
    const ctx = this._detectDoorContext(x, y)

    // Floor base under everything (covers any spillover at the inner end).
    g.fillStyle(FLOOR_BASE, 1)
    g.fillRect(px, py, TS, TS)

    if (ctx.axis === 'EW') this._drawDoorEW(g, px, py, ctx)
    else                   this._drawDoorNS(g, px, py, ctx)
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

    // Capstone band runs the full width — seamless with adjacent wall tiles.
    const capY = (outer === 'S') ? py + TS - CAPSTONE_W : py
    const capSide = (outer === 'S') ? 'bottom' : 'top'
    const fr = (rx, ry, rw, rh) => g.fillRect(rx, ry, rw, rh)
    this._drawCapstoneBand(g, fr, px, capY, TS, CAPSTONE_W, capSide)

    if (drawLeftJamb)  this._drawDoorJamb(g, px,                openYTop, JAMB_W, openYBot - openYTop, 'left')
    if (drawRightJamb) this._drawDoorJamb(g, px + TS - JAMB_W,  openYTop, JAMB_W, openYBot - openYTop, 'right')

    // Dark passage interior — spans the full opening width.
    g.fillStyle(DOOR_PASSAGE_DARK, 1)
    g.fillRect(openX, openYTop, openW, openYBot - openYTop)
    // Worn-footpath centre stripe. For widened doorways the "centre" sits
    // over the seam between tiles; only the leftmost tile of the pair
    // (no door to its W) needs to draw it, and it spans both halves.
    if (!ctx.WisDoor) {
      const stripeOriginX = openX + (ctx.EisDoor ? Math.floor((openW * 2 - 4) / 2)
                                                 : Math.floor((openW - 4) / 2))
      const stripeW = 4
      const stripeRightCap = ctx.EisDoor ? px + 2 * TS : px + TS
      const stripeX = Math.min(stripeOriginX, stripeRightCap - stripeW)
      g.fillStyle(DOOR_PASSAGE_LIGHT, 0.55)
      g.fillRect(stripeX, openYTop, stripeW, openYBot - openYTop)
    }

    // Arch shadow — 1-px line under the capstone above the opening.
    g.fillStyle(DOOR_ARCH_INNER, 0.85)
    if (outer !== 'S') g.fillRect(openX, openYTop, openW, 1)
    else               g.fillRect(openX, openYBot - 1, openW, 1)

    // Keystone wedge — brighter trapezoid in the capstone above the opening.
    // For widened doorways draw it once over the seam (only the leftmost tile
    // of the pair places it). Single-tile doorways draw it locally as before.
    if (!ctx.WisDoor) {
      const keyOpenW = ctx.EisDoor ? openW * 2 : openW
      const keyOpenX = openX
      const keyX = keyOpenX + Math.floor((keyOpenW - 5) / 2)
      g.fillStyle(DOOR_KEYSTONE_HI, 0.70)
      if (outer === 'S') g.fillRect(keyX, py + TS - CAPSTONE_W + 1, 5, CAPSTONE_W - 2)
      else               g.fillRect(keyX, py + 1,                    5, CAPSTONE_W - 2)
    }

    // Threshold slab — full opening width, worn stone with highlight stripe.
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
  }

  // E–W passage doorway (door sits in a left or right wall). Mirrored layout
  // of _drawDoorNS — jambs frame the opening top/bottom, capstone header runs
  // down the outer side.
  _drawDoorEW(g, px, py, ctx) {
    const outer = ctx.outer
    const JAMB_H   = 9
    const drawTopJamb = !ctx.NisDoor
    const drawBotJamb = !ctx.SisDoor
    const openY    = drawTopJamb ? py + JAMB_H        : py
    const openB    = drawBotJamb ? py + TS - JAMB_H   : py + TS
    const openH    = openB - openY
    const openXLft = px + CAPSTONE_W
    const openXRgt = px + TS - BASEBOARD_W

    const capX = (outer === 'E') ? px + TS - CAPSTONE_W : px
    const capSide = (outer === 'E') ? 'right' : 'left'
    const fr = (rx, ry, rw, rh) => g.fillRect(rx, ry, rw, rh)
    this._drawCapstoneBand(g, fr, capX, py, CAPSTONE_W, TS, capSide)

    if (drawTopJamb) this._drawDoorJamb(g, openXLft, py,               openXRgt - openXLft, JAMB_H, 'top')
    if (drawBotJamb) this._drawDoorJamb(g, openXLft, py + TS - JAMB_H, openXRgt - openXLft, JAMB_H, 'bottom')

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

    g.fillStyle(DOOR_ARCH_INNER, 0.85)
    if (outer !== 'E') g.fillRect(openXLft, openY, 1, openH)
    else               g.fillRect(openXRgt - 1, openY, 1, openH)

    if (!ctx.NisDoor) {
      const keyOpenH = ctx.SisDoor ? openH * 2 : openH
      const keyY = openY + Math.floor((keyOpenH - 5) / 2)
      g.fillStyle(DOOR_KEYSTONE_HI, 0.70)
      if (outer === 'E') g.fillRect(px + TS - CAPSTONE_W + 1, keyY, CAPSTONE_W - 2, 5)
      else               g.fillRect(px + 1,                   keyY, CAPSTONE_W - 2, 5)
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

    this._gBg.fillStyle(PALETTE.void, 1)
    this._gBg.fillRect(0, 0, W, H)
    this._gBg.fillStyle(0x0a1530, 0.18)
    this._gBg.fillEllipse(W / 2, H / 2, W * 1.1, H * 1.1)
  }

  _drawGrid() {
    const { gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    const g = this._gBg

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

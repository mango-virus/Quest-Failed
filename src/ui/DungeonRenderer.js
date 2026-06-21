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
import { loadCornerPattern } from '../data/cornerPattern.js'
import { carveDoorOpening, fillDoorTopOccluder, buildDoorSkyMask } from '../util/doorSkinCarve.js'
import { ThemeManager, FLOOR_SLOT, spriteCoverage, spriteCoverageHW, readCellEntry, doorSkinTextureKey } from '../systems/ThemeManager.js'

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
// Flat backdrop fill for the empty void under the dungeon grid. A neutral
// stone gray that matches the dungeon's *visible* walls: nearly every room
// desaturates its walls (rooms.json `colorAdjust.walls: { sat: -1 }`), so
// on-screen the walls read as grey — not the navy WALL_BASE constant. This
// is tuned to the mid-tone of that desaturated masonry (base bricks +
// lighter capstones/cornerstones averaged). Replaced the `void_bg.png` tile.
const VOID_BG_COLOR    = 0x2c2c30
// The "deep dark" the bedrock fades INTO past the build space — so the player
// never hits a hard bedrock→black-void edge. Matches Game's camera background
// so the fade rim and the area beyond it are seamless. (Edge-fade work 2026-06-20.)
const DEEP_DARK        = 0x0d0d10
// Edge fade distance in TILES — a FIXED pixel width on all four sides (not a
// fraction of the grid), so a wide/short dungeon fades by the same amount top
// and side. A radial/proportional fade compressed the short axis into a hard
// line; this rectangular border fade is uniform.
const EDGE_FADE_TILES  = 10
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


// Wall cap (when explicitly authored by Room Builder).
const WALL_CAP_FILL = 0x3a4a64

// Room border colours by category — connection-dot markers + tint wash.
// Tint washes removed from every category per user request: the per-
// room colorAdjust (hue/sat/bright on the sprite pixels) carries the
// per-room voice on its own, and the flat category overlay was reading
// as a muddy haze on top of it. Border colours retained — they still
// drive the connection-dot markers around each room.
const ROOM_STYLE = {
  special:  { border: PALETTE.bossBorder, tint: null },
  starter:  { border: PALETTE.roomBorder, tint: null },
  trap:     { border: 0xcc4422,           tint: null },
  treasure: { border: 0xddaa22,           tint: null },
  combat:   { border: 0xcc2244,           tint: null },
  utility:  { border: 0x22cc88,           tint: null },
  default:  { border: PALETTE.roomBorder, tint: null },
}

// Tile-coord hash used for the floor stipple — deterministic so the pattern
// doesn't shimmer between redraws when a single room is added or removed.
function _tileHash(x, y) {
  let h = (x | 0) * 73856093 ^ (y | 0) * 19349663
  h = (h ^ (h >>> 13)) >>> 0
  return h
}

// Phaser texture key for a theme sprite. Must match the convention used by
// TilesetEditor + RoomTileEditor + Preload (the second-pass loader queues
// every manifest sprite under this same key).
function _themeTextureKey(id) { return `themesprite-${id}` }
function _roomSkinTexKey(id) { return `roomskin-${id}` }

// Apply hue/sat/bright/contrast to a packed 0xRRGGBB colour and return a
// new packed colour.  Mirrors the transforms Phaser ColorMatrix applies so
// the procedural floor matches what the sprite-based walls look like.
function _adjustHex(hex, adj) {
  if (!adj) return hex
  const { hue = 0, sat = 0, bright = 0, contrast = 0 } = adj
  if (!hue && !sat && !bright && !contrast) return hex
  let r = ((hex >> 16) & 0xff) / 255
  let g = ((hex >>  8) & 0xff) / 255
  let b = ( hex        & 0xff) / 255
  if (bright)   { const f = 1 + bright;  r *= f; g *= f; b *= f }
  if (contrast) { const f = 1 + contrast; r = (r - 0.5) * f + 0.5; g = (g - 0.5) * f + 0.5; b = (b - 0.5) * f + 0.5 }
  if (hue || sat) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    let h = 0, s = 0, l = (mx + mn) / 2
    if (mx !== mn) {
      const d = mx - mn
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
      if      (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
      else if (mx === g) h = ((b - r) / d + 2) / 6
      else               h = ((r - g) / d + 4) / 6
    }
    if (hue) h = (h + hue / 360 + 1) % 1
    if (sat) s = Math.max(0, Math.min(1, s + sat))
    if (s === 0) { r = g = b = l } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
      const h2r = (p2, q2, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p2 + (q2 - p2) * 6 * t; if (t < 0.5) return q2; if (t < 2/3) return p2 + (q2 - p2) * (2/3 - t) * 6; return p2 }
      r = h2r(p, q, h + 1/3); g = h2r(p, q, h); b = h2r(p, q, h - 1/3)
    }
  }
  const ri = Math.max(0, Math.min(255, Math.round(r * 255)))
  const gi = Math.max(0, Math.min(255, Math.round(g * 255)))
  const bi = Math.max(0, Math.min(255, Math.round(b * 255)))
  return (ri << 16) | (gi << 8) | bi
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
    // Flat bedrock backdrop (VOID_BG_COLOR) under the whole grid + the edge-fade
    // margin. A crisp Graphics fillRect (drawn each redraw in _drawEdgeFade),
    // depth -0.5 (below _gBg's carve-halo overlay). It used to be a VOID_BG_COLOR-
    // tinted TileSprite, but that bled a 1px WHITE edge texel that showed as a
    // hairline at the dungeon's top edge at the exact initial camera zoom (and
    // cleared once the player first zoomed). Graphics fills have hard edges → no
    // bleed. (Replaced the old tiled `void-bg` PNG before that.)
    this._gBgFill = scene.add.graphics().setDepth(-0.5)
    // EDGE FADE — the bedrock backdrop dissolves into the deep dark past the
    // build space so there's never a hard bedrock→void seam. A uniform-width
    // rectangular border fade (4 edge strips + 4 corners, each a per-corner
    // alpha gradient via fillGradientStyle), drawn in _drawEdgeFade(). It draws
    // ONLY the margin frame (never the grid interior), so it sits at a HIGH depth
    // (12.2 — above the torch/light glow at 9.5 and the void-occluder at 12) where
    // it ALSO occludes any additive light bleeding past the grid edge into the dark
    // surround (a torch on a room at the very edge used to leak its glow + a hairline
    // out there). Rooms are never touched — the frame stops at the grid boundary.
    this._gFade = scene.add.graphics().setDepth(12.2)
    // Void-occluder at depth 12 (same role as _gVoidMask): a flat fill in
    // the void colour so sprites bleeding into void cells are hidden behind
    // the backdrop.  A GeometryMask built from _voidMaskMaskG clips it to
    // VOID cells only; _voidMaskMaskG is rebuilt each redraw.
    this._voidMaskMaskG  = scene.add.graphics()
    // Crisp Graphics fill (not a tinted TileSprite) for the same reason as the
    // backdrop — the TileSprite bled a 1px WHITE edge texel at the grid's top
    // row, which (empty on a fresh dungeon) showed as a full-width hairline at
    // the initial camera zoom. Filled each redraw, clipped to VOID cells by the
    // shared geometry mask.
    this._gVoidOcc = scene.add.graphics()
      .setDepth(12)
      .setMask(this._voidMaskMaskG.createGeometryMask())
    // Grid lines — drawn ABOVE the void-occluder (depth 12) and masked to
    // VOID cells by the same _voidMaskMaskG geometry, so the blueprint grid
    // shows on the empty bedrock but never clutters placed-room art. An
    // always-on faint ambient pass keeps the flat void from reading blank;
    // NightPhase toggles a brighter overlay on during placement.
    this._gGrid      = scene.add.graphics().setDepth(12.5)
      .setMask(this._voidMaskMaskG.createGeometryMask())
    this._showGrid   = false
    this._gTiles     = scene.add.graphics().setDepth(1)
    // Theme-driven sprite tiles. When a placed room has a theme assigned (or
    // a per-cell override in tileLayout), every floor + wall cell in that
    // room is rendered as a 32×32 sprite Image laid into this container,
    // suppressing the procedural draw on _gTiles for the same cell. Cells
    // without a resolved sprite fall back to procedural so partially-themed
    // rooms render coherently. Span sprites (64×64 → 2×2, 128×128 → 4×4)
    // anchor at their top-left covered cell and skip-fill from neighbours.
    // Sits between _gTiles (1) and _gTints (1.2) so category tints still
    // wash over a sprite-rendered floor.
    this._cTileSprites = scene.add.container(0, 0).setDepth(1.1)
    // Full-room skins (Phase 4): one stretched image per skinned room, drawn
    // just under the tile-sprite layer. For a skinned room the per-cell floor/
    // wall draw is suppressed entirely, so this image IS the room's surface;
    // doors (1.15+) and decor (1.5 / 8.9) still overlay on top.
    this._cRoomSkins = scene.add.container(0, 0).setDepth(1.08)
    // Doorway swatch sprites are split into TWO containers with masks so
    // characters walking through a doorway pass OVER the threshold cells
    // (Inner side — closer to each room's interior) but UNDER the door
    // panel / arch cells (Outer side — at the seam). Each cov>1 sprite
    // straddles both Inner and Outer rows; a GeometryMask on each
    // container clips it to just the cells that should appear at that
    // depth.
    //   - Low depth (1.15): Inner cells (rows 1, 3 in extended canonical).
    //     Drawn under characters (~7-8) → chars walk over the threshold.
    //   - High depth (9):   Outer cells (rows 0, 2). Drawn above
    //     characters → chars walk under the door panel / archway.
    this._cDoorSpritesLow  = scene.add.container(0, 0).setDepth(1.15)
    this._cDoorSpritesHigh = scene.add.container(0, 0).setDepth(9)
    this._innerCellMaskG = scene.make.graphics({ x: 0, y: 0, add: false })
    this._outerCellMaskG = scene.make.graphics({ x: 0, y: 0, add: false })
    this._cDoorSpritesLow.setMask(this._innerCellMaskG.createGeometryMask())
    this._cDoorSpritesHigh.setMask(this._outerCellMaskG.createGeometryMask())
    // Decoration layers. Floor decor (rugs, runes, markings) renders just
    // above floor sprites but below entities so characters walk over them.
    // Object decor (torches, banners, chandeliers) renders above entities,
    // framing the room architecture overhead.
    // Decorative door "aprons" (Phase: door apron) — sprites painted in the
    // door swatch's 3rd row, rendered one tile into the room below each door.
    // Floor-level decoration (below entities), no collision.
    this._cDoorAprons  = scene.add.container(0, 0).setDepth(1.45)
    // Single-image door skins, split like the painted door sprites so a
    // character walking through an open doorway emerges from it: the LOW copy
    // (below entities) carries the inner/passage + apron, while the HIGH copy
    // (above entities, masked to the OUTER cells) is the archway/frame the
    // entity passes under. Without the split the one image sat above entities
    // and hid them in the doorway.
    this._cDoorSkins     = scene.add.container(0, 0).setDepth(1.6)
    // Clipped to the OUTER (seam/archway) cells — same as the painted-door high
    // layer. Without it, a skinned door's opaque ROOM-SIDE pillars/frame bled over
    // the cells where a character stands NEXT TO the door and swallowed their head;
    // clipping keeps only the doorway archway above characters (they pass UNDER it
    // through the seam) while the room-side frame sits in the LOW copy (below them).
    // ⚠ TRADE-OFF: this reverses the see-through-gate-top occluder (which un-masked
    // this layer so its baked fill reached the wall above) — for full-room-skinned
    // rooms _cDoorSkinWall still covers the sky, but a theme-based room with a
    // transparent-topped gate could let a head poke out the top again.
    this._cDoorSkinsHigh = scene.add.container(0, 0).setDepth(9)
    this._cDoorSkinsHigh.setMask(this._outerCellMaskG.createGeometryMask())
    // Per-pixel WALL above a transparent-topped gate: a copy of the room's own
    // skin, masked to the door's SKY region, drawn just over the colour-fill copy
    // so the actual wall texture continues up instead of a flat patch. The colour
    // fill underneath remains a no-hole fallback. Mask GameObjects are tracked
    // separately (bitmap masks need their source object kept alive + destroyed).
    this._cDoorSkinWall  = scene.add.container(0, 0).setDepth(9.1)
    this._doorSkinWallMasks = []
    this._cDecorFloor  = scene.add.container(0, 0).setDepth(1.5)
    this._cDecorObject = scene.add.container(0, 0).setDepth(8.9)
    this._gTints     = scene.add.graphics().setDepth(1.2)
    this._gOverlay   = scene.add.graphics().setDepth(3)
    this._gCollision = scene.add.graphics().setDepth(3.2)
    this._gIcon      = scene.add.graphics().setDepth(4)
    // Overhead layer — drawn ABOVE entities (adv ~depth 8, minion ~7) so
    // doorway architecture (capstone band, jambs, keystone, arch shadow)
    // visually frames entities passing underneath. The dark passage floor
    // and threshold stay on _gTiles (depth 1) so entities walk over them.
    this._gOverhead  = scene.add.graphics().setDepth(9)
    // Void mask — re-paints VOID tile fills on a layer ABOVE characters
    // (which sit at depth 7-8) so any sprite whose head intrudes into a
    // void cell gets occluded by the gap. Same colour family as _gBg so
    // the void looks continuous. Depth 12 puts it above the wall
    // capstone overhead (9) and door-frame overlays as well, so the
    // void truly always wins occlusion.
    this._gVoidMask = scene.add.graphics().setDepth(12)

    // User-painted corner override (sparse 32×32 array of hex/null). When
    // set, _drawWallCorner overlays it on top of the procedural draw with
    // mirroring per corner kind. Re-loads each redraw so edits made in the
    // CornerEditor scene apply immediately on return to gameplay.
    this._cornerPattern = loadCornerPattern()

    EventBus.on('ROOM_PLACED',           this.redraw, this)
    EventBus.on('ROOM_PLACED',           this._playCarveAnimation, this)
    EventBus.on('ROOM_REMOVED',          this.redraw, this)
    EventBus.on('GRID_EXPANDED',         this.redraw, this)
    EventBus.on('DEBUG_OVERLAY_CHANGED', this.redraw, this)

    this.redraw()
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  redraw() {
    // Backdrop fill + edge fade are drawn (grid + fade-margin) in _drawEdgeFade;
    // the void occluder fill (clipped to void cells) is drawn in _drawVoidMask.
    this._gBgFill?.clear()
    this._gFade?.clear()
    this._voidMaskMaskG?.clear()   // rebuilt by _drawVoidMask() below

    this._gBg.clear()
    this._gGrid.clear()
    this._gTiles.clear()
    this._cTileSprites.removeAll(true)
    this._cRoomSkins.removeAll(true)
    this._cDoorAprons.removeAll(true)
    this._cDoorSkins.removeAll(true)
    this._cDoorSkinsHigh.removeAll(true)
    this._clearDoorSkinWall()
    this._cDecorFloor.removeAll(true)
    this._cDecorObject.removeAll(true)
    this._cDoorSpritesLow.removeAll(true)
    this._cDoorSpritesHigh.removeAll(true)
    this._innerCellMaskG.clear()
    this._outerCellMaskG.clear()
    this._gTints.clear()
    this._gOverlay.clear()
    this._gIcon.clear()
    this._gCollision.clear()
    this._gOverhead.clear()
    this._gVoidMask.clear()

    this._wallOrient = this._buildWallOrientation()
    // Pick up any newly saved corner pattern from the editor.
    this._cornerPattern = loadCornerPattern()

    this._drawBackground()
    this._drawGrid()
    this._drawTiles()
    if (Balance.WALL_THICKNESS > 1) this._drawCornerBlockOverlays()
    this._drawCategoryTints()
    this._drawRoomDecorations()
    this._drawRoomOverlays()
    this._drawVoidMask()
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
    EventBus.off('ROOM_PLACED',           this._playCarveAnimation, this)
    EventBus.off('ROOM_REMOVED',          this.redraw, this)
    EventBus.off('GRID_EXPANDED',         this.redraw, this)
    EventBus.off('DEBUG_OVERLAY_CHANGED', this.redraw, this)
    this._gBgFill?.destroy()
    this._gFade?.destroy()
    this._gVoidOcc?.destroy()
    this._voidMaskMaskG?.destroy()
    this._gBg.destroy()
    this._gGrid.destroy()
    this._gTiles.destroy()
    this._cTileSprites.destroy(true)
    this._cDecorFloor.destroy(true)
    this._cDecorObject.destroy(true)
    this._cDoorSkins?.destroy(true)
    this._cDoorSkinsHigh?.destroy(true)
    this._clearDoorSkinWall()
    this._cDoorSkinWall?.destroy(true)
    this._cDoorSpritesLow.destroy(true)
    this._cDoorSpritesHigh.destroy(true)
    this._innerCellMaskG.destroy()
    this._outerCellMaskG.destroy()
    this._gTints.destroy()
    this._gOverlay.destroy()
    this._gCollision.destroy()
    this._gIcon.destroy()
    this._gOverhead.destroy()
    this._gVoidMask.destroy()
  }

  // ── Tile fills ─────────────────────────────────────────────────────────────

  _drawTiles() {
    const { tiles, gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    const g = this._gTiles

    // Build the cell→room lookup once per redraw. Used by the sprite path
    // to find each cell's owning room (and through that, its theme +
    // tileLayout overrides).
    this._cellRoomMap = this._buildCellRoomMap()
    // Cells covered by some span-sprite anchor in a room's tileLayout.
    // The anchor itself is NOT in the set; only the other cov*cov - 1
    // covered cells. Iteration in `_drawTiles` skips covered cells so the
    // anchor's larger image shows through unobstructed.
    this._spanCoveredSet = this._buildSpanCoveredSet()
    // Door cell lookup — for each TILE.DOOR cell that belongs to a cp's 2×2
    // door block, records { room, cp, axis, sub, state, renderable }. A door
    // is "renderable" when all 4 sub-cells will resolve to a sprite (theme
    // variant or per-cell override); otherwise the entire 2×2 falls back to
    // procedural so we never see a half-themed door.
    this._doorCellMap = this._buildDoorCellMap()
    // Re-exempt every doorway anchor (cell with a doorway spanRender) from
    // the spanCoveredSet so its iteration draws the doorway sprite. The
    // doorway sprite goes to _cDoorSprites (higher depth) and visually
    // overlays any wall-template tileLayout sprite that would also paint
    // this cell.
    for (const [k, v] of this._doorCellMap.entries()) {
      if (v.spanRender) this._spanCoveredSet.delete(k)
    }

    // Full-room skins: paint one stretched image per skinned room. The skin
    // replaces that room's floor/wall surface, so the cell loop below skips
    // those cells (doors still render so they overlay the skin).
    this._drawRoomSkins()

    // Skinned doors: a single standalone image (_drawDoorSkins) covers the
    // door's WHOLE footprint (the 4×3 region the image is stretched over) on its
    // own wall. Suppress ALL procedural art under that footprint — not just the
    // DOOR cells — so the surrounding WALL (incl. its capstone band, drawn on
    // _gTiles at depth 1, BELOW the skin at 1.6) can't bleed through the skin's
    // transparent margins. That bleed was the "black line above the door": the
    // lintel wall cell's capstone showing through the skin's transparent top.
    // FLOOR cells in the footprint still draw (so the room floor shows under the
    // skin's transparent base — the apron row).
    this._doorSkinFootprint = new Set()
    // When a global DEFAULT door skin exists, EVERY room can have skinned doors,
    // so don't skip rooms that lack a skin of their own — the per-cp check decides.
    const _hasDefaultDoorSkin = !!ThemeManager.getDefaultDoorSkin?.()
    for (const room of (this._gameState?.dungeon?.rooms || [])) {
      if (!_hasDefaultDoorSkin && !room.doorSkin && !room.doorSkinByBoss && !room.doorSkinEntrance) continue
      for (const cp of (room.connectionPoints || [])) {
        if (!this._cpHasDoorSkin(room, cp)) continue
        // Per-room doors: a room's skin only covers ITS OWN wall. The paired
        // room renders its own door on its side.
        for (const k of this._doorSkinFootprintCells(room, cp)) this._doorSkinFootprint.add(k)
      }
    }

    for (let y = 0; y < gh; y++) {
      const row = tiles[y]
      if (!row) continue
      for (let x = 0; x < gw; x++) {
        // Cells covered by a span-sprite anchor at a neighbouring cell:
        // skip both sprite path AND procedural — the anchor's image
        // already paints across this cell.
        if (this._spanCoveredSet.has(`${x},${y}`)) continue

        const t = row[x]
        // A single-image door skin covers this cell's whole footprint — skip the
        // per-cell DOOR and WALL art (incl. the wall capstone band, which is
        // drawn on _gTiles below the skin and otherwise bleeds through the skin's
        // transparent margins). FLOOR cells still draw so the room floor shows
        // under the skin's transparent base.
        if (this._doorSkinFootprint.has(`${x},${y}`) &&
            (t === TILE.DOOR || t === TILE.WALL || t === TILE.BOSS_WALL)) continue
        // Skinned-room surface: a full-room image already covers this cell's
        // floor/wall. Skip the per-cell draw — but let DOOR cells through so
        // doors render (overlaid) as normal.
        if (t !== TILE.DOOR && this._skinKeyForCell(x, y)) continue
        // For DOOR cells, paint the underlying wall sprite first so the
        // door sprite (drawn next) visually overlays the wall instead
        // of replacing it.  No-op when the cell has no room / theme.
        if (t === TILE.DOOR) this._renderWallSpriteUnderDoor(x, y)
        // Try the sprite path. For DOOR cells, the resolver only returns
        // a sprite when the door is fully renderable (all 4 sub-cells); a
        // partial mismatch falls back to procedural for visual consistency.
        if (this._renderTileSprite(x, y, t)) continue

        if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) {
          const floorRoom = this._cellRoomMap?.get(`${x},${y}`)
          this._drawFloorCell(g, x, y, floorRoom?.colorAdjust?.floor)
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
    this._drawDoorAprons()
    this._drawDoorSkins()
  }

  // ── Single-image door skins ───────────────────────────────────────────────────
  // A cp is the MAIN ENTRANCE (the external door adventurers enter through) when
  // it's external / styled 'entrance'; otherwise it's a CONNECTING door. The two
  // get independent skin sets + sizes (doorSkinEntrance / doorSkinSizeEntrance vs
  // doorSkin / doorSkinSize), with the entrance falling back to the connecting set.
  _cpIsEntrance(cp) { return cp?.external === true || cp?.style === 'entrance' }
  // Resolve a door's skin texture key for a state. Entrance cps prefer the
  // entrance set (→ fall back to the connecting set); connecting cps use the
  // connecting set (per-boss override → default). `cp` is optional — when omitted
  // (paired-room lookups), the connecting set is used.
  _doorSkinKeyFor(room, state, cp = null) {
    let id = this._roomOwnDoorSkinId(room, state, cp)
    // Global fallback: every door with NO skin of its own uses the editor's
    // default door skin (connecting, per-boss, and entrance alike).
    if (!id) id = ThemeManager.defaultDoorSkinId?.(state) || null
    if (!id) return null
    const key = doorSkinTextureKey(id)
    return this._scene.textures.exists(key) ? key : null
  }
  // The room's OWN door-skin id for this state/cp (entrance → per-boss →
  // connecting), WITHOUT the global default — lets size resolution tell an
  // explicit room skin from one that fell through to the default.
  _roomOwnDoorSkinId(room, state, cp = null) {
    const boss = this._gameState?.player?.bossArchetypeId
    let id = null
    if (this._cpIsEntrance(cp)) id = room.doorSkinEntrance?.[state] || null
    if (!id) id = (boss && room.doorSkinByBoss?.[boss]?.[state]) || room.doorSkin?.[state] || null
    return id
  }
  // True when this cp's door has a skin for its current state — used to
  // suppress the sliced / procedural door so the single image stands alone.
  _cpHasDoorSkin(room, cp) {
    return !!this._doorSkinKeyFor(room, this._doorStateFor(cp), cp)
  }
  // Per-room door-skin footprint, in TILES. Defaults to the canonical
  // 4-wide (along the wall) × 3-deep (outer/inner/apron) box every door uses.
  // A room can override it (e.g. the grand entrance) via `room.doorSkinSize`
  // (connecting doors) or `room.doorSkinSizeEntrance` (the entrance cp):
  //   { w, h, nudge } — w = tiles along the wall, h = tiles deep into the room,
  //   nudge = extra tiles to shift the whole image further into the room.
  // The OUTER (wall) edge stays anchored; extra depth grows toward the floor.
  // `cp` optional — entrance cps read the entrance size (→ fall back to the
  // connecting size → default); omitting cp uses the connecting size.
  _doorSkinSizeTiles(room, cp = null) {
    const s = (this._cpIsEntrance(cp) ? room?.doorSkinSizeEntrance : null) ?? room?.doorSkinSize
    if (s) return { w: s.w ?? 4, h: s.h ?? 3, nudge: s.nudge ?? 0 }
    // No per-room override: a door rendering the GLOBAL DEFAULT skin (room has no
    // skin of its own for this state) uses the default skin's size.
    if (cp && !this._roomOwnDoorSkinId(room, this._doorStateFor(cp), cp)) {
      const d = ThemeManager.defaultDoorSkinSize?.()
      if (d) return { w: d.w ?? 4, h: d.h ?? 3, nudge: d.nudge ?? 0 }
    }
    return { w: 4, h: 3, nudge: 0 }
  }
  // Dungeon-space center + rotation of a door's canonical 4×3 region (cols =
  // jambs+door, rows = outer/inner/apron), so one image can be drawn over it.
  _doorSkinRect(room, cp) {
    const block = this._doorBlockCells(room, cp)
    if (!block) return null
    const dir = cp.direction
    const norm = { S: { dx: 0, dy: -1 }, N: { dx: 0, dy: 1 }, E: { dx: -1, dy: 0 }, W: { dx: 1, dy: 0 } }[dir]
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const add = (c) => { if (!c) return; minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y) }
    for (let col = 0; col < 4; col++) {
      add(this._doorPaintedToDungeon(block, dir, col, 0))   // outer
      const inner = this._doorPaintedToDungeon(block, dir, col, 1)
      add(inner)                                            // inner
      if (inner && norm) add({ x: inner.x + norm.dx, y: inner.y + norm.dy })   // apron
    }
    if (!isFinite(minX)) return null
    // A free-form door image is authored "face-on" (its own up = screen up),
    // unlike the per-cell swatch which follows the outer-row-on-top convention.
    // The swatch rotation lands N/S doors 180° off for a whole-image skin, so
    // flip those (E/W already read correctly).
    const baseRot = this._doorPaintedRotDeg(dir)
    const rot = (baseRot + ((dir === 'N' || dir === 'S') ? 180 : 0)) % 360
    // Oversized skins (e.g. the grand entrance) anchor their OUTER (wall) edge
    // and grow the extra depth into the room, so a tall gate's base reaches the
    // floor instead of floating in the wall. Default (h=3) → grow 0 → unchanged.
    const { h: hTiles, nudge } = this._doorSkinSizeTiles(room, cp)
    const grow = (hTiles - 3) / 2 + (nudge || 0)
    return {
      cx: (minX + maxX + 1) / 2 * TS + (norm ? norm.dx * grow * TS : 0),
      cy: (minY + maxY + 1) / 2 * TS + (norm ? norm.dy * grow * TS : 0),
      rot,
    }
  }
  // Every dungeon cell the door-skin IMAGE is stretched over — the filled
  // bounding rectangle of the drawn region (canonical 4×3, or the room's
  // `doorSkinSize` override). Used to suppress procedural wall/door art under
  // the standalone skin (see _doorSkinFootprint in redraw). Derived from the
  // SAME center + size that _drawDoorSkins / _doorSkinRect use, so it always
  // matches what's actually painted (incl. the grown-into-room offset).
  _doorSkinFootprintCells(room, cp) {
    const block = this._doorBlockCells(room, cp)
    const rect = this._doorSkinRect(room, cp)
    if (!block || !rect) return []
    const { w, h } = this._doorSkinSizeTiles(room, cp)
    // Rotation maps w → along-wall and h → depth; for an h-axis door (top/bottom
    // wall) along-wall is X, for a v-axis door (left/right wall) along-wall is Y.
    const horiz = block.axis === 'h'
    const xExt = horiz ? w : h
    const yExt = horiz ? h : w
    const cxT = rect.cx / TS, cyT = rect.cy / TS
    const minX = Math.floor(cxT - xExt / 2), maxX = Math.ceil(cxT + xExt / 2) - 1
    const minY = Math.floor(cyT - yExt / 2), maxY = Math.ceil(cyT + yExt / 2) - 1
    const cells = []
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) cells.push(`${x},${y}`)
    return cells
  }
  // Build ONE previewed door-skin sprite for a (room, cp, state) — used by the
  // placement preview to show the ACTUAL assigned door skin right where an auto-
  // connect seam will form. `room` may be a CANDIDATE that isn't placed yet: only
  // gridX/gridY/width/height + connectionPoints + doorSkin* are read, and it uses
  // the SAME rect / rotation / size as a placed door (_doorSkinRect /
  // _doorSkinSizeTiles), so the preview matches exactly what will land. Returns
  // null when the door has no skin or the cp isn't a single valid wall. The
  // CALLER positions / alpha-fades / destroys it.
  buildDoorSkinPreview(room, cp, state = 'closed') {
    const key = this._doorSkinKeyFor(room, state, cp)
    if (!key) return null
    const rect = this._doorSkinRect(room, cp)
    if (!rect) return null
    const { w: wTiles, h: hTiles } = this._doorSkinSizeTiles(room, cp)
    const img = this._scene.add.image(rect.cx, rect.cy, key).setOrigin(0.5)
    img.setDisplaySize(wTiles * TS, hTiles * TS)
    if (rect.rot) img.setAngle(rect.rot)
    return img
  }

  _drawDoorSkins() {
    const rooms = this._gameState?.dungeon?.rooms || []
    // Draw one 4×3 skin image over a single cp's door block (its own side).
    // Drawn TWICE: a low copy (below entities) + a high copy masked to the
    // OUTER cells (above entities) so a character walking through the open
    // doorway shows over the passage but under the archway/frame.
    const drawOne = (forRoom, forCp, key, colorRoom, state) => {
      const rect = this._doorSkinRect(forRoom, forCp)
      if (!rect) return
      // Natural canonical size: 4 cells along the wall × 3 deep (outer/inner/
      // apron). setAngle rotates it into the dungeon's door orientation.
      const { w: wTiles, h: hTiles } = this._doorSkinSizeTiles(forRoom, forCp)
      const make = (container, texKey) => {
        const img = this._scene.add.image(rect.cx, rect.cy, texKey).setOrigin(0.5)
        img.setDisplaySize(wTiles * TS, hTiles * TS)
        if (rect.rot) img.setAngle(rect.rot)
        this._applyColorAdj(img, colorRoom?.colorAdjust?.walls, true)
        container.add(img)
      }
      make(this._cDoorSkins, key)  // low — full image, under entities (passage + black opening)
      // High (over-entity) copy. For an OPEN door, use a black-keyed copy whose
      // dark opening is transparent, so a character walking out always shows
      // OVER the dark passage (from the low copy) and UNDER only the lit frame —
      // emerging from under the door frame whatever shape the opening is. The
      // outer-cell geometry mask still keeps it to the archway region; the
      // black-key follows the ART instead of a fixed tile line. Other states
      // (closed/locked) keep the full image — nobody walks through them.
      // High (over-entity) copy = the occluder build: transparent SKY above the
      // gate filled opaque (so heads don't poke out), passage carved for OPEN
      // doors (so a character still shows through it, under the frame).
      const wallColor = this._doorWallFillColor(forRoom, forCp)
      const highKey = this._ensureDoorOccluderTexture(key, state === 'open', wallColor)
      make(this._cDoorSkinsHigh, highKey)   // high — over entities (texture alpha occludes)
      // Per-pixel wall: the room's real skin masked to this door's sky region,
      // just above the colour fill (which stays as a no-hole fallback).
      this._addDoorSkinWallTexture(forRoom, forCp, rect, wTiles, hTiles, key)
    }
    const hasDefaultDoorSkin = !!ThemeManager.getDefaultDoorSkin?.()
    for (const room of rooms) {
      if (!hasDefaultDoorSkin && !room.doorSkin && !room.doorSkinByBoss && !room.doorSkinEntrance) continue
      for (const cp of (room.connectionPoints || [])) {
        const state = this._doorStateFor(cp)
        const key = this._doorSkinKeyFor(room, state, cp)
        if (!key) continue
        // Per-room doors: a room's skin shows ONLY on its own wall. The paired
        // room renders its own door (skin / theme / default) on its side.
        drawOne(room, cp, key, room, state)
      }
    }
  }

  // Bake-once: a "frame-only" copy of an OPEN door skin with its near-black
  // opening keyed to transparent. The high (over-entity) door-skin copy uses
  // this so the dark passage never paints over a character walking out — they
  // always read as emerging from under the lit frame, whatever shape the
  // opening is (the fixed outer/inner cell split couldn't follow arbitrary
  // shapes; pixel luminance does). The full (low) copy still supplies the black
  // BEHIND them. Cached under `<key>__frame`; falls back to the full image on
  // any canvas failure (preserves the prior look rather than erroring).
  _ensureDoorFrameTexture(key) {
    const tex = this._scene.textures
    if (!key || !tex.exists(key)) return key
    const frameKey = `${key}__frame`
    if (tex.exists(frameKey)) return frameKey
    const src = tex.get(key).getSourceImage()
    const w = src?.width | 0, h = src?.height | 0
    if (!w || !h) return key
    try {
      const ct = tex.createCanvas(frameKey, w, h)
      if (!ct) return key
      const ctx = ct.getContext()
      ctx.drawImage(src, 0, 0)
      const img = ctx.getImageData(0, 0, w, h)
      // Carve ONLY the enclosed passage (flood-fill from the lower-centre), not
      // every black pixel — so the dark sky, corners, and mortar detail lines
      // stay opaque (no see-through frame / seam holes). See doorSkinCarve.js.
      carveDoorOpening(img.data, w, h, Balance.DOOR_SKIN_BLACK_THRESHOLD ?? 24)
      ctx.putImageData(img, 0, 0)
      ct.refresh()
      // Match the source skin's NEAREST filter — a fresh canvas texture defaults
      // to the game's LINEAR (antialias:true), which would blur this open-door
      // frame copy when the camera magnifies it.
      if (ct.setFilter) ct.setFilter(Phaser.Textures.FilterMode.NEAREST)
      return frameKey
    } catch (e) {
      if (tex.exists(frameKey)) tex.remove(frameKey)
      return key
    }
  }

  // The room's actual WALL COLOUR at a door, for the over-entity occluder to fill
  // its sky with (so it reads as the wall continuing up, not a stranger stone).
  // These rooms wall themselves with a full-room skin image, so sample THAT at
  // the door's wall cell (a small box, average of opaque pixels). Returns [r,g,b]
  // or null (→ occluder falls back to the skin's own frame stone). The draw-time
  // `colorAdjust.walls` then tints this the same as the surrounding wall.
  _doorWallFillColor(room, cp) {
    if (!room || !cp) return null
    const skinKey = this._roomSkinKeyFor(room)
    if (!skinKey) return null
    const tex = this._scene.textures
    if (!tex.exists(skinKey)) return null
    try {
      const src = tex.get(skinKey).getSourceImage()
      const sw = src?.width | 0, sh = src?.height | 0
      if (!sw || !sh || !(room.width > 0) || !(room.height > 0)) return null
      const wx = (room.gridX | 0) + (cp.x | 0), wy = (room.gridY | 0) + (cp.y | 0)
      // The room skin is stretched over the room bbox (origin 0.5) — map the door
      // cell to its centre UV, then a small box around it for a stable colour.
      const u = (wx - room.gridX + 0.5) / room.width
      const v = (wy - room.gridY + 0.5) / room.height
      const cx = Math.max(0, Math.min(sw - 1, (u * sw) | 0))
      const cy = Math.max(0, Math.min(sh - 1, (v * sh) | 0))
      const rad = Math.max(2, Math.round(Math.min(sw / room.width, sh / room.height) * 0.3))
      const x0 = Math.max(0, cx - rad), y0 = Math.max(0, cy - rad)
      const bw = Math.max(1, Math.min(sw, cx + rad) - x0), bh = Math.max(1, Math.min(sh, cy + rad) - y0)
      const cv = document.createElement('canvas'); cv.width = sw; cv.height = sh
      const ctx = cv.getContext('2d'); ctx.drawImage(src, 0, 0)
      const d = ctx.getImageData(x0, y0, bw, bh).data
      let r = 0, g = 0, b = 0, n = 0
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++ } }
      if (!n) return null
      return [(r / n) | 0, (g / n) | 0, (b / n) | 0]
    } catch (e) { return null }
  }

  // Bake-once: the OVER-ENTITY copy of a door skin — its transparent TOP MARGIN
  // (the empty sky above the gate/arch) filled with an opaque occluder, so a
  // character walking through is hidden above the frame instead of poking out
  // into the see-through top. The sky is filled with the room's actual WALL colour
  // (when `fillColor` resolves) so it reads as the wall continuing up — else a flat
  // sampled stone. For an OPEN door the passage is ALSO carved (after the fill) so
  // the character still shows THROUGH the opening but UNDER the frame. Cached under
  // `<key>__occ[C][__rgb]`; falls back to the source on failure.
  _ensureDoorOccluderTexture(key, carve, fillColor = null) {
    const tex = this._scene.textures
    if (!key || !tex.exists(key)) return key
    const colTag = Array.isArray(fillColor) ? `__${fillColor[0]}_${fillColor[1]}_${fillColor[2]}` : ''
    const occKey = `${key}__occ${carve ? 'C' : ''}${colTag}`
    if (tex.exists(occKey)) return occKey
    const src = tex.get(key).getSourceImage()
    const w = src?.width | 0, h = src?.height | 0
    if (!w || !h) return key
    try {
      const ct = tex.createCanvas(occKey, w, h)
      if (!ct) return key
      const ctx = ct.getContext()
      ctx.drawImage(src, 0, 0)
      const img = ctx.getImageData(0, 0, w, h)
      fillDoorTopOccluder(img.data, w, h, fillColor)                        // sky → wall colour (or flat stone)
      if (carve) carveDoorOpening(img.data, w, h, Balance.DOOR_SKIN_BLACK_THRESHOLD ?? 24)
      ctx.putImageData(img, 0, 0)
      ct.refresh()
      if (ct.setFilter) ct.setFilter(Phaser.Textures.FilterMode.NEAREST)
      return occKey
    } catch (e) {
      if (tex.exists(occKey)) tex.remove(occKey)
      return key
    }
  }

  // Bake-once: a MASK texture for a door skin's SKY region (opaque white where
  // the occluder fills, transparent elsewhere). Cached `<key>__skymask`. Returns
  // the key or null (no sky → nothing to show wall through).
  _ensureDoorSkyMaskTexture(key) {
    const tex = this._scene.textures
    if (!key || !tex.exists(key)) return null
    const maskKey = `${key}__skymask`
    if (tex.exists(maskKey)) return maskKey
    const src = tex.get(key).getSourceImage()
    const w = src?.width | 0, h = src?.height | 0
    if (!w || !h) return null
    try {
      const ct = tex.createCanvas(maskKey, w, h)
      if (!ct) return null
      const ctx = ct.getContext()
      ctx.drawImage(src, 0, 0)
      const img = ctx.getImageData(0, 0, w, h)
      const n = buildDoorSkyMask(img.data, w, h)
      if (!n) { tex.remove(maskKey); return null }
      ctx.putImageData(img, 0, 0)
      ct.refresh()
      if (ct.setFilter) ct.setFilter(Phaser.Textures.FilterMode.NEAREST)
      return maskKey
    } catch (e) {
      if (tex.exists(maskKey)) tex.remove(maskKey)
      return null
    }
  }

  // Show the room's ACTUAL wall texture above a transparent-topped gate: a copy of
  // the room skin (at its real position/size) masked to THIS door's sky region, so
  // the wall continues up per-pixel. Rotation-safe — the mask image carries the
  // door's transform, the room-skin copy stays at its natural place, and Phaser
  // composites them. No-op unless the room has a full-room skin AND the skin has a
  // sky region. The colour-fill occluder underneath stays as a no-hole fallback.
  _addDoorSkinWallTexture(room, cp, rect, wTiles, hTiles, doorKey) {
    const skinKey = this._roomSkinKeyFor(room)
    if (!skinKey || !this._scene.textures.exists(skinKey)) return
    const maskKey = this._ensureDoorSkyMaskTexture(doorKey)
    if (!maskKey) return
    // Room-skin copy at the room's natural footprint (mirrors _drawRoomSkins).
    const rw = room.width * TS, rh = room.height * TS
    const wall = this._scene.add.image(room.gridX * TS + rw / 2, room.gridY * TS + rh / 2, skinKey).setOrigin(0.5)
    wall.setDisplaySize(rw, rh)
    // Mask image at the DOOR's transform (same as the door-skin image), invisible.
    const maskImg = this._scene.add.image(rect.cx, rect.cy, maskKey).setOrigin(0.5)
    maskImg.setDisplaySize(wTiles * TS, hTiles * TS)
    if (rect.rot) maskImg.setAngle(rect.rot)
    maskImg.setVisible(false)
    wall.setMask(maskImg.createBitmapMask())
    this._cDoorSkinWall.add(wall)
    this._doorSkinWallMasks.push(maskImg)
  }

  // Clear the wall-texture container + destroy its (display-list-detached) mask
  // images. Bitmap masks keep their source object alive independently, so the
  // container's removeAll won't reach them — destroy them explicitly.
  _clearDoorSkinWall() {
    this._cDoorSkinWall?.removeAll(true)
    if (this._doorSkinWallMasks) {
      for (const m of this._doorSkinWallMasks) m?.destroy()
      this._doorSkinWallMasks.length = 0
    }
  }

  // Decorative door aprons: the door swatch's 3rd row, painted one tile into
  // each room below its doors. Each room renders its own apron into its own
  // interior (no cross-seam mirroring). Purely visual — the tile grid /
  // collision is unchanged. Orientation mirrors the door's per-direction
  // rotation; may need a per-direction tweak after live eyeballing.
  _drawDoorAprons() {
    const rooms = this._gameState?.dungeon?.rooms || []
    const INNER_NORMAL = { S: { dx: 0, dy: -1 }, N: { dx: 0, dy: 1 }, E: { dx: -1, dy: 0 }, W: { dx: 1, dy: 0 } }
    for (const room of rooms) {
      if (!room.doorApron && !room.doorApronByBoss) continue
      for (const cp of (room.connectionPoints || [])) {
        const block = this._doorBlockCells(room, cp)
        if (!block) continue
        const apronRow = this._doorApronFor(room, this._doorStateFor(cp))
        if (!Array.isArray(apronRow)) continue
        const norm = INNER_NORMAL[cp.direction]
        if (!norm) continue
        const baseRot = this._doorPaintedRotDeg(cp.direction)
        for (let col = 0; col < 4; col++) {
          const entry = readCellEntry(apronRow[col])
          if (!entry) continue
          const inner = this._doorPaintedToDungeon(block, cp.direction, col, 1)
          if (!inner) continue
          const ax = inner.x + norm.dx, ay = inner.y + norm.dy
          if (ax < room.gridX || ax >= room.gridX + room.width ||
              ay < room.gridY || ay >= room.gridY + room.height) continue
          const sprite = ThemeManager.getSprite(entry.id)
          const key = _themeTextureKey(entry.id)
          if (!sprite || !this._scene.textures.exists(key)) continue
          const { w: covW, h: covH } = spriteCoverageHW(sprite)
          const sizeW = covW * TS, sizeH = covH * TS
          const img = this._scene.add.image(ax * TS + sizeW / 2, ay * TS + sizeH / 2, key).setOrigin(0.5)
          img.setDisplaySize(sizeW, sizeH)
          const angle = (baseRot + (entry.rot || 0)) % 360
          if (angle) img.setAngle(angle)
          if (entry.flipH) img.flipX = true
          if (entry.flipV) img.flipY = true
          this._applyColorAdj(img, room.colorAdjust?.walls, true)
          this._cDoorAprons.add(img)
        }
      }
    }
  }

  // Skin texture key for a room if it has a loaded full-room skin, else null.
  // The boss chamber can carry per-boss skin overrides — pick the active
  // archetype's skin, falling back to the room's default backgroundImage.
  _roomSkinKeyFor(room) {
    let id = room?.backgroundImage
    if (room?.backgroundImageByBoss) {
      const boss = this._gameState?.player?.bossArchetypeId
      if (boss && room.backgroundImageByBoss[boss]) id = room.backgroundImageByBoss[boss]
    }
    if (!id) return null
    const key = _roomSkinTexKey(id)
    return this._scene.textures.exists(key) ? key : null
  }

  // Skin key for the room owning cell (x,y), or null. Used by the tile loop to
  // suppress per-cell floor/wall drawing under a skinned room.
  _skinKeyForCell(x, y) {
    const room = this._cellRoomMap?.get(`${x},${y}`)
    return room ? this._roomSkinKeyFor(room) : null
  }

  // Draw one stretched skin image per skinned room over its footprint.
  _drawRoomSkins() {
    const rooms = this._gameState?.dungeon?.rooms || []
    for (const room of rooms) {
      const key = this._roomSkinKeyFor(room)
      if (!key) continue
      // room.width/height are the placed (rotated) footprint; the skin image is
      // authored for the room's ORIGINAL orientation. Size it to the original
      // (pre-rotation) dims, ROTATE by room.rotation, and centre on the footprint
      // — so the skin turns WITH the room instead of staying upright.
      const rot  = room.rotation ?? 0
      const swap = (rot === 90 || rot === 270)
      const ow = (swap ? room.height : room.width)  * TS
      const oh = (swap ? room.width  : room.height) * TS
      const cx = room.gridX * TS + (room.width  * TS) / 2
      const cy = room.gridY * TS + (room.height * TS) / 2
      const img = this._scene.add.image(cx, cy, key).setOrigin(0.5)
      img.setDisplaySize(ow, oh)
      if (rot) img.setAngle(rot)
      this._cRoomSkins.add(img)
    }
  }

  // Pre-pass: walk every room's tileLayout, find override cells whose
  // sprite has coverage > 1, and add the cov×cov - 1 non-anchor cells to
  // the covered set. The renderer skips drawing on those cells (sprite
  // AND procedural) so the anchor's larger image shows through cleanly.
  //
  // Doorway anchor cells get RE-EXEMPTED from this set after
  // `_buildDoorCellMap` runs (in `_drawTiles`), so they iterate and
  // render the doorway sprite — which goes to a higher-depth container
  // and visually overlays whatever wall sprite was painting that cell.
  _buildSpanCoveredSet() {
    const set = new Set()
    for (const room of this._gameState.dungeon.rooms ?? []) {
      const layout = room.tileLayout
      if (!Array.isArray(layout) || layout.length === 0) continue
      for (let dy = 0; dy < room.height; dy++) {
        for (let dx = 0; dx < room.width; dx++) {
          const entry = readCellEntry(layout[dy]?.[dx])
          if (!entry) continue
          const sprite = ThemeManager.getSprite(entry.id)
          const { w: covW, h: covH } = spriteCoverageHW(sprite)
          if (covW <= 1 && covH <= 1) continue
          const wx = room.gridX + dx
          const wy = room.gridY + dy
          for (let oy = 0; oy < covH; oy++) {
            for (let ox = 0; ox < covW; ox++) {
              if (ox === 0 && oy === 0) continue
              set.add(`${wx + ox},${wy + oy}`)
            }
          }
        }
      }
    }
    return set
  }

  // True when the cell is the anchor of a cov>1 tileLayout sprite that
  // should still render despite a doorway projection covering this cell
  // — i.e. the anchor needs to render its sprite to fill its OTHER
  // coverage cells (typically corner/pillar art adjacent to a doorway).
  //
  // Returns false for TILE.DOOR cells: those are inside the door zone
  // and we explicitly want the doorway sprite to fill them, not the
  // leftover wall-template tileLayout entry from the room author.
  _isTileLayoutSpanAnchor(x, y) {
    const tile = this._gameState.dungeon.tiles[y]?.[x]
    if (tile === TILE.DOOR) return false
    const room = this._cellRoomMap?.get(`${x},${y}`)
    if (!room || !Array.isArray(room.tileLayout) || !room.tileLayout.length) return false
    const rx = x - room.gridX, ry = y - room.gridY
    const entry = readCellEntry(room.tileLayout[ry]?.[rx])
    if (!entry) return false
    const sprite = ThemeManager.getSprite(entry.id)
    return spriteCoverage(sprite) > 1
  }

  // Build the set of cells covered by every cp's 4×2 doorway swatch
  // zone (door cells + adjacent jamb cells, on this room's wall slab
  // only — paired room contributes its own cps). This is the region
  // where the doorway swatch should win over wall-template tileLayout
  // sprites.
  _buildDoorwayZoneSet() {
    const zone = new Set()
    for (const room of this._gameState.dungeon.rooms ?? []) {
      for (const cp of room.connectionPoints ?? []) {
        const block = this._doorBlockCells(room, cp)
        if (!block || block.w !== 2 || block.h !== 2) continue
        let zx0, zy0, zx1, zy1
        if (block.axis === 'h') {
          zx0 = block.x0 - 1; zy0 = block.y0
          zx1 = block.x0 + 2; zy1 = block.y0 + block.h - 1
        } else {
          zx0 = block.x0;     zy0 = block.y0 - 1
          zx1 = block.x0 + block.w - 1; zy1 = block.y0 + 2
        }
        for (let y = zy0; y <= zy1; y++) {
          for (let x = zx0; x <= zx1; x++) {
            zone.add(`${x},${y}`)
          }
        }
      }
    }
    return zone
  }

  // ── Theme sprite path ──────────────────────────────────────────────────────

  // Build a (x,y) → placed-room map covering every cell within every room's
  // bounding box.  Last write wins on the (impossible per game rules)
  // overlap case.  Used by the sprite-resolver to find the room a cell
  // belongs to.
  _buildCellRoomMap() {
    const m = new Map()
    for (const room of this._gameState.dungeon.rooms) {
      const { gridX: rx, gridY: ry, width: rw, height: rh } = room
      for (let dy = 0; dy < rh; dy++) {
        for (let dx = 0; dx < rw; dx++) m.set(`${rx + dx},${ry + dy}`, room)
      }
    }
    return m
  }

  // Find the room that "owns" cell (x, y, t) for theme purposes. WALL_CAP
  // cells sit in the row above their room (not in the room's bounding box),
  // so we check the cell directly below them.
  _roomForCell(x, y, t) {
    if (t === TILE.WALL_CAP) return this._cellRoomMap.get(`${x},${y + 1}`) || null
    return this._cellRoomMap.get(`${x},${y}`) || null
  }

  // Map a cell's tile type + wall orientation to a ThemeManager slot id.
  // Returns null for cells with no sprite slot (e.g. DOOR, void).
  _slotForCell(x, y, t) {
    if (t === TILE.FLOOR || t === TILE.BOSS_FLOOR) return FLOOR_SLOT
    if (t === TILE.WALL_CAP)                       return 'wall_cap'
    if (t === TILE.WALL || t === TILE.BOSS_WALL) {
      const o = this._wallOrient.get(`${x},${y}`)
      if (!o) return null
      if (o.kind === 'top') return 'wall'
      if (o.kind === 'bot') return 'wall_bottom'
      if (o.kind === 'lft') return 'wall_left'
      if (o.kind === 'rgt') return 'wall_right'
      if (o.kind === 'corner') {
        if (o.role === 'outer') return 'wall_corner_' + o.side
        // Sub-cells of a WT×WT corner block.  Map their visual character to
        // the closest straight wall slot so the corner block reads as a
        // continuous run when the sprite art is consistent.
        if (o.role === 'h-arm') return (o.side === 'tl' || o.side === 'tr') ? 'wall' : 'wall_bottom'
        if (o.role === 'v-arm') return (o.side === 'tl' || o.side === 'bl') ? 'wall_left' : 'wall_right'
        // 'inner' diagonal cell + rare 'mid' (WT > 2): fall back to the
        // adjacent top/bottom wall slot.
        return (o.side === 'tl' || o.side === 'tr') ? 'wall' : 'wall_bottom'
      }
    }
    return null
  }

  // Resolve the sprite id (and metadata) to render at (x, y, t).  Returns
  // null when no sprite applies (no theme, no override, slot has no
  // variants, or the texture didn't load).  Per-cell overrides in the
  // owning room's tileLayout win over the theme default.
  _resolveCellSprite(x, y, t) {
    // Door cells take a special path — the door cell map already encodes
    // the owning room/cp + the per-cell sub-position + whether the cp's
    // door is "renderable as sprite" (all 4 sub-cells resolve). Cells whose
    // cp isn't fully renderable fall through to the procedural overlay.
    if (t === TILE.DOOR) {
      const door = this._doorCellMap.get(`${x},${y}`)
      if (!door || door.kind !== 'door' || !door.renderable) return null
      return this._resolveDoorCellSprite(door, x, y)
    }

    // Wall cells adjacent to a doorway can be overridden by the cp's jamb
    // painting (cols 0 / 3 of room.doorTiles[state]). Unset jamb cells
    // fall through to the normal wall-slot logic below.
    if (t === TILE.WALL || t === TILE.BOSS_WALL) {
      const jamb = this._doorCellMap.get(`${x},${y}`)
      if (jamb && jamb.kind === 'jamb') {
        const sprite = this._resolveJambCellSprite(jamb, x, y)
        if (sprite) return sprite
        // No painted jamb — continue to default wall rendering below.
      }
    }

    const room = this._roomForCell(x, y, t)
    if (!room) return null

    // Per-cell override (paints any cell, even ones with no slot mapping).
    // Cell entries can be a sprite-id string OR { id, rot?, flipH?, flipV? }.
    if (Array.isArray(room.tileLayout) && room.tileLayout.length) {
      const rx = x - room.gridX
      const ry = y - room.gridY
      const entry = readCellEntry(room.tileLayout[ry]?.[rx])
      if (entry) {
        const sprite = ThemeManager.getSprite(entry.id)
        if (sprite && this._scene.textures.exists(_themeTextureKey(entry.id))) {
          return { id: entry.id, sprite, rot: entry.rot, flipH: entry.flipH, flipV: entry.flipV }
        }
      }
    }

    // Theme default — pick a variant for this cell's slot. Theme variants
    // are never rotated/flipped (those are per-cell-override features only).
    if (!room.theme) return null
    const slot = this._slotForCell(x, y, t)
    if (!slot) return null
    const id = ThemeManager.pickVariant(slot, x, y, room.theme)
    if (!id) return null
    const sprite = ThemeManager.getSprite(id)
    if (!sprite || !this._scene.textures.exists(_themeTextureKey(id))) return null
    return { id, sprite, rot: 0, flipH: false, flipV: false }
  }

  // Resolve sprite for a door cell whose cp is renderable. Resolution order:
  //   1. Per-cell tileLayout override on the owning room (cell-precise).
  //   2. Owning room's doorTiles[state] painting (per-room door swatch).
  //   3. doorTheme/theme variant for the door_<state>_<axis>_<sub> slot.
  // (Option B / cross-seam fall-through dropped — every painted cell now
  // sits inside the room's own wall ring, so no cross-seam ambiguity.)
  _resolveDoorCellSprite(door, x, y) {
    const { room, axis, sub, state, isOwner } = door
    // (0) Pre-resolved span anchor from a cov>1 sprite in the swatch.
    if (door.spanRender) return door.spanRender

    // (1) Per-cell tileLayout override. Skip cov>1 entries — those are
    // typically wall-template art baked at room-author time (e.g. a
    // wall_c span that the door now sits on top of). The doorTiles
    // swatch should paint instead.
    if (Array.isArray(room.tileLayout) && room.tileLayout.length) {
      const rx = x - room.gridX
      const ry = y - room.gridY
      const entry = readCellEntry(room.tileLayout[ry]?.[rx])
      if (entry) {
        const sprite = ThemeManager.getSprite(entry.id)
        const cov = spriteCoverage(sprite)
        if (cov <= 1 && sprite && this._scene.textures.exists(_themeTextureKey(entry.id))) {
          return { id: entry.id, sprite, rot: entry.rot, flipH: entry.flipH, flipV: entry.flipV }
        }
      }
    }

    // (2) This room's doorTiles painting. Normally only the owner paints (the
    // non-owner defers so the doorway reads as one unit). EXCEPTION: when the
    // paired (owner) room has a door SKIN for this state, its skin covers its
    // own wall and its door tiles are hidden — so the non-owner must render ITS
    // OWN door here instead of deferring to art it can't show. This is what
    // makes a room connected to a skinned boss door render its own painted door.
    const pairedHasSkin = !!(door.pairedRoom && this._doorSkinKeyFor(door.pairedRoom, state))
    if (isOwner !== false || pairedHasSkin) {
      const ownPaint = this._lookupDoorTilePainted(room, door.cp, state, x, y)
      if (ownPaint) return ownPaint
    }

    // (3) Paired room's painting (used by non-owner cps to render the
    // owner's swatch on this side of the seam).
    if (door.pairedRoom && door.pairedCp) {
      const pairPaint = this._lookupDoorTilePainted(door.pairedRoom, door.pairedCp, state, x, y)
      if (pairPaint) return pairPaint
    }

    // (4) Theme variant.
    const doorTheme = room.doorTheme || room.theme
    if (!doorTheme) return null
    const slot = `door_${state}_${axis}_${sub}`
    const id = ThemeManager.pickVariant(slot, x, y, doorTheme)
    if (!id) return null
    const sprite = ThemeManager.getSprite(id)
    if (!sprite || !this._scene.textures.exists(_themeTextureKey(id))) return null
    return { id, sprite, rot: 0, flipH: false, flipV: false }
  }

  // Resolve sprite for a JAMB cell — a wall cell adjacent to a doorway,
  // overlaid with the jamb columns (0 / 3) of this room's doorTiles
  // painting. Returns null when the painting cell at this position is
  // unset, in which case the caller falls through to normal wall
  // rendering.
  _resolveJambCellSprite(jamb, x, y) {
    // Pre-resolved span anchor wins (a cov>1 sprite extending into this
    // jamb cell from the door region uses this same code path).
    if (jamb.spanRender) return jamb.spanRender
    // If this cell is a tileLayout cov>1 anchor (corner / pillar at the
    // jamb position), defer so the user's wall art renders. The doorway
    // sprite at higher depth will overlay where they overlap.
    if (this._isTileLayoutSpanAnchor(x, y)) return null
    // Owner paints its own jambs; non-owner defers to paired (= owner) UNLESS
    // the paired room has a door skin (then render this room's own jamb).
    const pairedHasSkin = !!(jamb.pairedRoom && this._doorSkinKeyFor(jamb.pairedRoom, jamb.state))
    if (jamb.isOwner !== false || pairedHasSkin) {
      const own = this._lookupDoorTilePainted(jamb.room, jamb.cp, jamb.state, x, y)
      if (own) return own
    }
    if (jamb.pairedRoom && jamb.pairedCp) {
      return this._lookupDoorTilePainted(jamb.pairedRoom, jamb.pairedCp, jamb.state, x, y)
    }
    return null
  }

  // Returns true if room.doorTiles[state] has at least one non-null cell —
  // i.e. this room has a painted swatch for this state. Used to decide
  // whether the paired room's painting should "spill over" Option-B-style.
  _roomHasDoorTilesFor(room, state) {
    const grid = this._doorTilesFor(room, state)
    if (!Array.isArray(grid)) return false
    for (const row of grid) {
      if (!Array.isArray(row)) continue
      for (const v of row) if (v) return true
    }
    return false
  }

  // Map a dungeon cell (x, y) sitting inside a cp's 8-cell doorway back to
  // the painted (col, row) within the cp's room.doorTiles canonical 4×2
  // grid. Returns the resolved sprite + per-direction sprite rotation, or
  // null if the cell isn't covered by this cp's doorway or the painting
  // has nothing for that cell. Span anchors with cov>1: only the dungeon
  // cell that maps to the canonical anchor (paintedCol, paintedRow) gets
  // the sprite — the other cov×cov - 1 cells are recorded in
  // _spanCoveredSet so the cell-iteration in _drawTiles skips them.
  _lookupDoorTilePainted(room, cp, state, x, y) {
    const cellInfo = this._paintingCellForDoorCell(room, cp, x, y)
    if (!cellInfo) return null
    const grid = this._doorTilesFor(room, state)
    if (!Array.isArray(grid)) return null
    // Rows 2..3 of the extended canonical sit in the PAIRED room's wall.
    // Mirror them back to rows 0..1 of THIS room's painting (so the door
    // looks symmetric across the seam) and flip the sprite vertically.
    // With the row 0 = Outer / row 1 = Inner convention, distance-paired
    // mapping is: paintedRow 2 (paired Outer) ↔ row 0 (own Outer);
    // paintedRow 3 (paired Inner) ↔ row 1 (own Inner). lookupRow = paintedRow - 2.
    const isMirror = cellInfo.paintedRow >= 2
    const lookupRow = isMirror ? (cellInfo.paintedRow - 2) : cellInfo.paintedRow
    // Direct hit? Use the sprite at this painted cell.
    let entry = readCellEntry(grid[lookupRow]?.[cellInfo.paintedCol])
    if (!entry) {
      // No direct entry — walk up-left in the painting looking for a span
      // anchor that covers this painted cell. Coverage can be 1 or 2 (with
      // the 4×2 grid). Walks the LOOKUP row (mirrored when isMirror=true).
      const MAX_BACK = 3
      for (let dy = 0; dy <= MAX_BACK && lookupRow - dy >= 0; dy++) {
        for (let dx = 0; dx <= MAX_BACK && cellInfo.paintedCol - dx >= 0; dx++) {
          if (dx === 0 && dy === 0) continue
          const ax = cellInfo.paintedCol - dx, ay = lookupRow - dy
          const candidate = readCellEntry(grid[ay]?.[ax])
          if (!candidate) continue
          const cov = spriteCoverage(ThemeManager.getSprite(candidate.id))
          if (cov > Math.max(dx, dy)) {
            // The anchor at (ax, ay) covers this cell, but THIS cell is a
            // non-anchor spancell — return null so it stays blank; the
            // dungeon cell that maps to (ax, ay) will render the sprite.
            return null
          }
        }
      }
      return null
    }
    const sprite = ThemeManager.getSprite(entry.id)
    if (!sprite || !this._scene.textures.exists(_themeTextureKey(entry.id))) return null
    // Stack rotations: per-cell user rot + per-direction auto-rotate.
    // Under the row 0 = Outer / row 1 = Inner convention with the new
    // row math, paired-row lookup already maps to the right swatch entry
    // (lookupRow = paintedRow - 2), and the rendering position already
    // lands at the correct paired cell — so no extra V-flip is needed
    // for the mirror case. cov>1 anchors found via direct lookup get the
    // own-projection flipV treatment (image-top = source row 0 needs to
    // land at MAX-y outer cell for forward directions).
    const rot = ((entry.rot || 0) + cellInfo.rotDeg) % 360
    const cov = spriteCoverage(sprite)
    const flipV = (cov > 1 && !isMirror) ? !entry.flipV : !!entry.flipV
    return { id: entry.id, sprite, rot, flipH: !!entry.flipH, flipV }
  }

  // Geometry helper: which painted (col, row) of the canonical 4×2 swatch
  // (4 cols along the wall, 2 rows through the wall depth) does dungeon
  // cell (x, y) correspond to, viewed through this cp's direction?
  // Returns { paintedCol, paintedRow, rotDeg } or null when (x, y) is
  // outside the cp's 8-cell doorway footprint.
  //
  // Canonical orientation = cp.direction 'S':
  //   col 0 = LEFT JAMB, col 1/2 = DOOR, col 3 = RIGHT JAMB
  //   row 0 = OUTER (toward outer wall face / seam)
  //   row 1 = INNER (toward room interior)
  // Extended row range 0..3:
  //   row 2 = paired room's OUTER (across the seam)
  //   row 3 = paired room's INNER (deeper into paired)
  // For other directions the whole swatch rotates as a unit (cell positions
  // remap AND sprite rotation applied).
  _paintingCellForDoorCell(room, cp, x, y) {
    const block = this._doorBlockCells(room, cp)
    if (!block) return null
    // Convert axial offset (own=0 inner, own=1 outer/seam, beyond=paired's
    // wall) to swatch row: 0 outer, 1 inner, 2 paired-outer, 3 paired-inner.
    const offsetToRow = (offset) =>
      offset === 0 ? 1
      : offset === 1 ? 0
      : offset >= 2 ? offset
      : null   // negative = past own's interior, not a doorway cell
    let paintedCol, paintedRow, rotDeg
    switch (cp.direction) {
      case 'S': {
        paintedCol = x - block.x0 + 1
        paintedRow = offsetToRow(y - block.y0)
        rotDeg = 0
        break
      }
      case 'N': {
        // For N, axial offset goes the other way: own outer is at y=block.y0
        // (top of wall, north face). Paired's wall is north of that, so
        // negative dungeon offsets map to extended rows.
        const dy = y - block.y0
        paintedCol = (block.x0 + 2) - x
        paintedRow = dy >= 0 ? offsetToRow(1 - dy)   // dy=0→outer(0), dy=1→inner(1)
                             : (1 - dy)              // dy=-1→2, dy=-2→3
        rotDeg = 180
        break
      }
      case 'E': {
        paintedCol = y - block.y0 + 1
        paintedRow = offsetToRow(x - block.x0)
        rotDeg = 270
        break
      }
      case 'W': {
        const dx = x - block.x0
        paintedCol = (block.y0 + 2) - y
        paintedRow = dx >= 0 ? offsetToRow(1 - dx)
                             : (1 - dx)
        rotDeg = 90
        break
      }
      default:
        return null
    }
    if (paintedRow == null) return null
    if (paintedCol < 0 || paintedCol > 3) return null
    if (paintedRow < 0 || paintedRow > 3) return null
    return { paintedCol, paintedRow, rotDeg }
  }

  // Find the cp on the room across the seam that pairs with this cp.
  // Returns { pairedRoom, pairedCp } or null for external/unpaired cps.
  // With no inter-room gap, the paired cp's room sits 1 cell outward from
  // this cp; the matching cp anchors on the same dungeon coord.
  _findPairedCp(room, cp) {
    if (!cp || cp.external) return null
    const v = ({ N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 }, E: { dx: 1, dy: 0 }, W: { dx: -1, dy: 0 } })[cp.direction]
    if (!v) return null
    const ox = room.gridX + cp.x + v.dx
    const oy = room.gridY + cp.y + v.dy
    const otherRoom = this._cellRoomMap?.get(`${ox},${oy}`) ||
      (this._gameState.dungeon.rooms ?? []).find(r =>
        ox >= r.gridX && ox < r.gridX + r.width && oy >= r.gridY && oy < r.gridY + r.height)
    if (!otherRoom || otherRoom === room) return null
    const opp = ({ N: 'S', S: 'N', E: 'W', W: 'E' })[cp.direction]
    const pairedCp = (otherRoom.connectionPoints ?? []).find(o =>
      !o.external && o.direction === opp &&
      otherRoom.gridX + o.x === ox && otherRoom.gridY + o.y === oy)
    if (!pairedCp) return null
    return { pairedRoom: otherRoom, pairedCp }
  }

  // ── Door geometry helpers ──────────────────────────────────────────────────

  // Cells covered by a cp's door block, in (col, row) order tl/tr/bl/br.
  // Returns null for cps that don't sit on a single edge (corner/interior).
  // Block size is always 2 × WALL_THICKNESS along the wall × through the
  // wall — for the default WT=2 this is a 2×2 block.
  _doorBlockCells(room, cp) {
    const WT = Balance.WALL_THICKNESS
    const onTop = cp.y === 0
    const onBot = cp.y === room.height - 1
    const onLft = cp.x === 0
    const onRgt = cp.x === room.width - 1
    if ((onTop || onBot) && (onLft || onRgt)) return null
    if (!onTop && !onBot && !onLft && !onRgt)  return null

    if (onTop || onBot) {
      const alongDx = (cp.alongDx === 1 || cp.alongDx === -1) ? cp.alongDx
        : (((room.width - 1) - cp.x) >= cp.x ? 1 : -1)
      const xStart = Math.min(cp.x, cp.x + alongDx)
      const yStart = onTop ? 0 : room.height - WT
      return { x0: room.gridX + xStart, y0: room.gridY + yStart, w: 2,  h: WT, axis: 'h' }
    }
    const alongDy = (cp.alongDy === 1 || cp.alongDy === -1) ? cp.alongDy
      : (((room.height - 1) - cp.y) >= cp.y ? 1 : -1)
    const yStart = Math.min(cp.y, cp.y + alongDy)
    const xStart = onLft ? 0 : room.width - WT
    return { x0: room.gridX + xStart, y0: room.gridY + yStart, w: WT, h: 2,  axis: 'v' }
  }

  // Logical state of a cp at draw time:
  //   'open'   when cp.open === true OR cp.opening === true (the sprite
  //            path swaps to the open swatch as soon as the opening
  //            animation starts, so the adventurer doesn't see "closed"
  //            art while walking through the half-open doorway. The
  //            procedural panel still uses cp.openProgress for its split
  //            animation independently.)
  //   'locked' when cp.locked === true (Phase 10 hidden-keys feature)
  //   'closed' otherwise
  _doorStateFor(cp) {
    if (cp.locked === true)            return 'locked'
    if (cp.open === true || cp.opening) return 'open'
    return 'closed'
  }

  // Per-boss door swatch resolution: the boss chamber can override its door
  // tiles / apron per boss (room.doorTilesByBoss[boss][state]); fall back to the
  // shared room.doorTiles[state] / doorApron[state].
  _doorTilesFor(room, state) {
    const boss = this._gameState?.player?.bossArchetypeId
    const o = boss && room.doorTilesByBoss?.[boss]?.[state]
    return Array.isArray(o) ? o : room.doorTiles?.[state]
  }
  _doorApronFor(room, state) {
    const boss = this._gameState?.player?.bossArchetypeId
    const o = boss && room.doorApronByBoss?.[boss]?.[state]
    return Array.isArray(o) ? o : room.doorApron?.[state]
  }

  // Forward-map a canonical (col, row) of room.doorTiles back into a dungeon
  // cell, given a cp's door block and direction. Inverse of
  // _paintingCellForDoorCell. Used by _buildDoorCellMap to project span
  // anchors (cov>1 sprites in the swatch) onto the right dungeon cells.
  //
  // Row convention: 0 = OUTER (own seam-side), 1 = INNER (own interior-side),
  // 2 = paired OUTER (across seam), 3 = paired INNER.
  _doorPaintedToDungeon(block, direction, col, row) {
    // axial offset for "outward" directions (S, E): 0 inner, 1 outer, 2/3 paired.
    const offsetForward = row === 0 ? 1 : row === 1 ? 0 : row
    // axial offset for "inward" directions (N, W): 0 outer, 1 inner, -1/-2 paired.
    const offsetReverse = row === 0 ? 0 : row === 1 ? 1 : -(row - 1)
    switch (direction) {
      case 'S': return { x: block.x0 + col - 1,        y: block.y0 + offsetForward }
      case 'N': return { x: block.x0 + 2 - col,        y: block.y0 + offsetReverse }
      case 'E': return { x: block.x0 + offsetForward,  y: block.y0 + col - 1 }
      case 'W': return { x: block.x0 + offsetReverse,  y: block.y0 + 2 - col }
      default:  return null
    }
  }

  // Per-direction sprite rotation that the auto-rotated swatch applies on
  // top of any user-set rotation per painted cell. Calibrated for the
  // row 0 = Outer / row 1 = Inner convention so source (col=0, row=0)
  // lands at the dungeon "Outer + L Jamb" position for each direction.
  _doorPaintedRotDeg(direction) {
    return ({ S: 0, N: 180, E: 90, W: 270 })[direction] ?? 0
  }

  // Build the cell→door-info lookup for this redraw. Three passes:
  //   1. Stamp door + jamb entries from every cp (so cross-seam writes in
  //      pass 2 land on already-existing entries).
  //   2. Project span anchors. For shared doorways, exactly one cp owns
  //      the seam and projects its swatch onto BOTH halves (own wall +
  //      mirrored across into paired wall). The non-owner skips. This
  //      makes the doorway read as one coherent painted door instead of
  //      two halves stamped at 180° relative orientations.
  //   3. Renderability check per cp.
  //
  // Owner rule: cp.direction in {'S', 'E'} owns. The user's swatches are
  // authored in the canonical 'S' orientation (Inner row at top, Outer
  // row at bottom), so picking the upper/left room as owner means the
  // canonical swatch lands upright in the dungeon and is mirrored into
  // the lower/right half via flipV.
  _buildDoorCellMap() {
    const map = new Map()
    const SUB = ['tl', 'tr', 'bl', 'br']  // ordered (col, row) row-major in a 2×2
    const cpInfos = []

    // ── Pass 1: stamp door + jamb entries for every cp.
    for (const room of this._gameState.dungeon.rooms ?? []) {
      for (const cp of room.connectionPoints ?? []) {
        const block = this._doorBlockCells(room, cp)
        if (!block || block.w !== 2 || block.h !== 2) continue
        const state = this._doorStateFor(cp)
        const pair = this._findPairedCp(room, cp)
        const pairedRoom = pair?.pairedRoom || null
        const pairedCp   = pair?.pairedCp   || null
        const isOwner = !pairedRoom || cp.direction === 'S' || cp.direction === 'E'

        // Mark a doorway cell into the inner / outer mask graphics so the
        // split-depth doorway containers (incl. the low/high door-skin
        // copies) know which cells they should make visible. Inner = swatch
        // row 1 or 3 (closer to room interior), Outer = row 0 or 2 (closer
        // to seam / outer face).
        const markMaskCell = (wx, wy) => {
          const cellInfo = this._paintingCellForDoorCell(room, cp, wx, wy)
          if (!cellInfo) return
          const isInner = (cellInfo.paintedRow % 2) === 1
          const target = isInner ? this._innerCellMaskG : this._outerCellMaskG
          target.fillStyle(0xffffff, 1)
          target.fillRect(wx * TS, wy * TS, TS, TS)
        }

        for (let i = 0; i < 4; i++) {
          const dx = i % 2, dy = (i / 2) | 0
          const wx = block.x0 + dx, wy = block.y0 + dy
          map.set(`${wx},${wy}`, {
            kind: 'door',
            room, cp, axis: block.axis, sub: SUB[i], state, renderable: false,
            pairedRoom, pairedCp, isOwner,
          })
          markMaskCell(wx, wy)
        }

        const jambCells = (block.axis === 'h')
          ? [[block.x0 - 1, block.y0], [block.x0 - 1, block.y0 + 1],
             [block.x0 + 2, block.y0], [block.x0 + 2, block.y0 + 1]]
          : [[block.x0,     block.y0 - 1], [block.x0 + 1, block.y0 - 1],
             [block.x0,     block.y0 + 2], [block.x0 + 1, block.y0 + 2]]
        for (const [wx, wy] of jambCells) {
          if (!map.has(`${wx},${wy}`)) {
            map.set(`${wx},${wy}`, { kind: 'jamb', room, cp, state, pairedRoom, pairedCp, isOwner })
          }
          markMaskCell(wx, wy)
        }

        cpInfos.push({ room, cp, block, state, pairedRoom, pairedCp, isOwner })
      }
    }

    // ── Pass 2: project span anchors. Owner-only.
    for (const info of cpInfos) {
      if (!info.isOwner) continue
      const { room, cp, block, state, pairedRoom } = info
      const swatch = this._doorTilesFor(room, state)
      if (!Array.isArray(swatch)) continue
      const dirRot = this._doorPaintedRotDeg(cp.direction)
      const projectMirror = !!pairedRoom

      for (let cr = 0; cr < swatch.length; cr++) {
        for (let cc = 0; cc < (swatch[cr]?.length || 0); cc++) {
          const e = readCellEntry(swatch[cr]?.[cc])
          if (!e) continue
          const sprite = ThemeManager.getSprite(e.id)
          if (!sprite || !this._scene.textures.exists(_themeTextureKey(e.id))) continue
          const cov = spriteCoverage(sprite)
          if (cov <= 1) continue

          const projectAt = (anchorRow, mirror) => {
            const dCells = []
            let okSpan = true
            for (let dy = 0; dy < cov && okSpan; dy++) {
              for (let dx = 0; dx < cov; dx++) {
                const dxy = this._doorPaintedToDungeon(
                  block, cp.direction, cc + dx, anchorRow + dy)
                if (!dxy) { okSpan = false; break }
                dCells.push(dxy)
              }
            }
            if (!okSpan) return
            let minX = Infinity, minY = Infinity
            for (const c of dCells) { if (c.x < minX) minX = c.x; if (c.y < minY) minY = c.y }
            const tlEntry = map.get(`${minX},${minY}`)
            if (tlEntry) {
              // Under the row 0 = Outer / row 1 = Inner convention, the
              // sprite IMAGE (authored with image-top = swatch row 0
              // visually) needs `flipV` applied in these cases so
              // source-row-0 content lands at the dungeon's outer-face cell:
              //
              //   - S/N OWNER projection (own wall, no mirror): the wall
              //     is horizontal, perpendicular axis is Y. Rotation 0°/180°
              //     alone leaves source-top at the interior cell. flipV
              //     swaps it to the outer cell. (N applies for external
              //     cps like entry_hall's entrance — N is normally a
              //     non-owner, but external cps are always owners.)
              //
              //   - E OWNER MIRROR projection: rotation is 90° CW which
              //     normally maps source rows → display columns. To get
              //     the transpose mapping needed for paired's wall
              //     (source(col,row) → display(row,col)), we need
              //     flipV + 90°CW = transpose.
              //
              // The other cases (S/N mirror, E/W own) need no flip — the
              // rotation alone already yields the correct mapping.
              const dir = cp.direction
              const needsFlipV = mirror
                ? dir === 'E'
                : (dir === 'S' || dir === 'N')
              tlEntry.spanRender = {
                id: e.id, sprite,
                rot: ((e.rot || 0) + dirRot) % 360,
                flipV: needsFlipV ? !e.flipV : !!e.flipV,
                flipH: !!e.flipH,
              }
            }
            for (const c of dCells) {
              if (c.x === minX && c.y === minY) continue
              // Don't span-cover a tileLayout cov>1 anchor — its sprite
              // still needs to iterate and render so its OTHER coverage
              // cells (outside the doorway zone) aren't left blank. The
              // doorway sprite at higher depth will overlay where they
              // overlap.
              if (this._isTileLayoutSpanAnchor(c.x, c.y)) continue
              this._spanCoveredSet?.add(`${c.x},${c.y}`)
            }
          }

          // Own wall (canonical rows cr..cr+cov-1).
          projectAt(cr, false)
          // Mirrored across the seam into the paired room's wall. Distance-
          // preserving pairing under the row 0 = Outer / row 1 = Inner
          // convention: own row 0 ↔ paired row 2, own row 1 ↔ paired row 3.
          // mirrorAnchorRow = cr + 2 (which keeps cov>1 spans aligned).
          if (projectMirror) {
            const mirrorAnchorRow = cr + 2
            projectAt(mirrorAnchorRow, true)
          }
        }
      }
    }

    // ── Pass 3: renderability check per cp.
    for (const info of cpInfos) {
      const { room, cp, block, state, pairedRoom, pairedCp, isOwner } = info
      const doorTheme = room.doorTheme || room.theme
      let renderable = true
      for (let i = 0; i < 4; i++) {
        const dx = i % 2, dy = (i / 2) | 0
        const wx = block.x0 + dx, wy = block.y0 + dy
        const rx = wx - room.gridX, ry = wy - room.gridY
        const cellKey = `${wx},${wy}`

        const overrideId = room.tileLayout?.[ry]?.[rx]
        if (overrideId && typeof overrideId === 'string'
            && ThemeManager.getSprite(overrideId)
            && this._scene.textures.exists(_themeTextureKey(overrideId))) continue

        const doorEntry = map.get(cellKey)
        if (doorEntry?.spanRender) continue
        if (this._spanCoveredSet?.has(cellKey)) continue

        // Direct-painted (cov=1) lookups. Owner checks own first; a non-owner
        // whose paired (owner) room has a door SKIN also checks its own (so it
        // renders its own door rather than defer to the hidden skin); otherwise
        // it defers to the paired (= owner) swatch.
        const pairedHasSkin = !!(pairedRoom && this._doorSkinKeyFor(pairedRoom, state))
        if ((isOwner || pairedHasSkin) && this._lookupDoorTilePainted(room, cp, state, wx, wy)) continue
        if (pairedRoom && pairedCp &&
            this._lookupDoorTilePainted(pairedRoom, pairedCp, state, wx, wy)) continue

        if (!doorTheme) { renderable = false; break }
        const slot = `door_${state}_${block.axis}_${SUB[i]}`
        const variants = ThemeManager.getTheme(doorTheme)?.slots[slot] || []
        const ok = variants.some(id => {
          const s = ThemeManager.getSprite(id)
          return s && this._scene.textures.exists(_themeTextureKey(id))
        })
        if (!ok) { renderable = false; break }
      }
      for (let i = 0; i < 4; i++) {
        const dx = i % 2, dy = (i / 2) | 0
        const wx = block.x0 + dx, wy = block.y0 + dy
        const entry = map.get(`${wx},${wy}`)
        if (entry && entry.kind === 'door') entry.renderable = renderable
      }
    }

    return map
  }

  // True when room.tileLayout has any string entry at any cell of the door
  // block — used as a fast-path so a fully-overridden door doesn't need a
  // theme to render.
  _anyTileLayoutCells(room, block) {
    if (!Array.isArray(room.tileLayout) || !room.tileLayout.length) return false
    for (let dy = 0; dy < block.h; dy++) {
      for (let dx = 0; dx < block.w; dx++) {
        const rx = block.x0 + dx - room.gridX
        const ry = block.y0 + dy - room.gridY
        if (typeof room.tileLayout[ry]?.[rx] === 'string') return true
      }
    }
    return false
  }

  // Render the sprite for cell (x, y, t).  Returns true if a draw was
  // performed (or intentionally suppressed for a span-sprite non-anchor
  // cell, which should stay blank to let the anchor's larger image show
  // through), false to fall back to procedural.
  _renderTileSprite(x, y, t) {
    const resolved = this._resolveCellSprite(x, y, t)
    if (!resolved) return false
    const { id, sprite, rot, flipH, flipV } = resolved
    const key = _themeTextureKey(id)
    // Anchor-from-override: this cell IS the anchor. Coverage > 1 sprites
    // span cov×cov starting here; the pre-pass `_spanCoveredSet` ensures
    // neighbour cells skip rendering so the anchor's image shows through.
    const { w: covW, h: covH } = spriteCoverageHW(sprite)
    const sizeW = covW * TS, sizeH = covH * TS

    const isFloor = (t === TILE.FLOOR || t === TILE.BOSS_FLOOR)
    const _room   = this._cellRoomMap?.get(`${x},${y}`)

    // Decide which container this sprite goes into. Three cases:
    //   1. The cell is a door-projection ANCHOR (spanRender set): this
    //      IS a doorway sprite — route to BOTH door containers (low +
    //      high), masks clip each copy to Inner / Outer cells.
    //   2. The cell is in the doorway zone (door or jamb) AND the
    //      resolved sprite came from a wall-template tileLayout cov>1
    //      anchor (corner, pillar, etc. that happens to overlap the
    //      doorway): treat as a wall sprite — route to _cTileSprites
    //      so it renders at low depth across its full 2×2 footprint.
    //      Door sprites at depth 1.15+ overlay it where they overlap.
    //   3. Doorway-zone cell with neither spanRender nor a tileLayout
    //      anchor: cov=1 painted jamb art via _lookupDoorTilePainted —
    //      route to BOTH door containers.
    //   4. Non-doorway cell: route to _cTileSprites (wall / floor art).
    const doorEntry = this._doorCellMap?.get(`${x},${y}`)
    const isDoorwayCell = !!doorEntry && (doorEntry.kind === 'door' || doorEntry.kind === 'jamb')
    const isTileLayoutWall = !doorEntry?.spanRender && this._isTileLayoutSpanAnchor(x, y)
    const isDoorContainer = isDoorwayCell && !isTileLayoutWall
    const buildImg = () => {
      const img = this._scene.add.image(x * TS + sizeW / 2, y * TS + sizeH / 2, key)
        .setOrigin(0.5)
      img.setDisplaySize(sizeW, sizeH)
      // Non-square tiles ignore their stored rotation (footprint is always
      // covW×covH; you pick 1×2 vs 2×1 explicitly) so art and footprint align.
      const effRot = (covW === covH) ? rot : 0
      if (effRot) img.setAngle(effRot)
      if (flipH) img.flipX = true
      if (flipV) img.flipY = true
      // Always use preFX (inline render pass). PostFX renders to an offscreen
      // framebuffer that doesn't resize with the canvas, which caused floor /
      // wall tile sprites to visibly slide on window resize. PreFX works with
      // geometry masks too, so door sprites are also safe.
      const adj = isDoorContainer
        ? _room?.colorAdjust?.walls   // doors share the room's wall colour
        : _room?.colorAdjust?.[isFloor ? 'floor' : 'walls']
      this._applyColorAdj(img, adj, true)
      return img
    }

    if (isDoorContainer) {
      this._cDoorSpritesLow.add(buildImg())
      this._cDoorSpritesHigh.add(buildImg())
    } else {
      this._cTileSprites.add(buildImg())
    }
    return true
  }

  // Paint the wall sprite that *would* exist at a DOOR cell, so the
  // door sprite drawn afterwards visually overlaps the wall instead of
  // replacing it.  The wall slot is picked from the cell's position
  // within its owning room (top/bottom/left/right edge).  No-op when:
  //   - the cell isn't inside any room (gap stub between two rooms),
  //   - the room has no theme / no variant for the slot,
  //   - or the resolved texture failed to load.
  _renderWallSpriteUnderDoor(x, y) {
    const room = this._cellRoomMap.get(`${x},${y}`)
    if (!room) return false
    const dt = y - room.gridY
    const db = (room.gridY + room.height - 1) - y
    const dl = x - room.gridX
    const dr = (room.gridX + room.width  - 1) - x
    let slot = null
    if      (dt === 0) slot = 'wall'
    else if (db === 0) slot = 'wall_bottom'
    else if (dl === 0) slot = 'wall_left'
    else if (dr === 0) slot = 'wall_right'
    if (!slot) return false
    const theme = room.theme
    if (!theme) return false
    const id = ThemeManager.pickVariant(slot, x, y, theme)
    if (!id) return false
    const sprite = ThemeManager.getSprite(id)
    if (!sprite) return false
    const key = _themeTextureKey(id)
    if (!this._scene.textures.exists(key)) return false
    const { w: covW, h: covH } = spriteCoverageHW(sprite)
    const sizeW = covW * TS, sizeH = covH * TS
    const img = this._scene.add.image(x * TS + sizeW / 2, y * TS + sizeH / 2, key)
      .setOrigin(0.5)
    img.setDisplaySize(sizeW, sizeH)
    this._applyColorAdj(img, room?.colorAdjust?.walls, true)
    this._cTileSprites.add(img)
    return true
  }

  // Floor: hashed stipple over a base fill. Hash buckets:
  //   0..127  → base
  //   128..191→ slightly lighter speck
  //   192..255→ slightly darker speck
  // Rather than a per-pixel stipple (very expensive in Graphics), we tint a
  // single ~6×6 patch in one corner so each cell reads as base-with-detail.
  _drawFloorCell(g, x, y, adj) {
    const px = x * TS, py = y * TS
    g.fillStyle(_adjustHex(FLOOR_BASE, adj), 1)
    g.fillRect(px, py, TS, TS)

    const h = _tileHash(x, y)
    const bucket = h & 0xff
    if (bucket >= 128) {
      const variant = bucket >= 192 ? _adjustHex(FLOOR_DARK, adj) : _adjustHex(FLOOR_LIGHT, adj)
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

  // Capstone fill for a gap-stub door tile (the 1-tile passage between two
  // adjacent rooms, after auto-connect placed paired cps). Detects whether
  // the walkway runs vertically (rooms above + below) or horizontally
  // (rooms left + right) and orients the seams + accents to continue the
  // adjacent rooms' capstone bands seamlessly. The gap-facing edges get no
  // highlight/shadow because the neighbour walls' caps already provide the
  // visual line on those sides — accents only paint on edges facing void.
  _drawGapStubCap(g, px, py, tx, ty) {
    const tiles = this._gameState.dungeon.tiles
    const get = (cx, cy) => tiles?.[cy]?.[cx] ?? TILE.VOID
    const isWallish = (t) => t === TILE.WALL || t === TILE.BOSS_WALL || t === TILE.DOOR || t === TILE.WALL_CAP
    const wallN = isWallish(get(tx,     ty - 1))
    const wallS = isWallish(get(tx,     ty + 1))
    const wallW = isWallish(get(tx - 1, ty))
    const wallE = isWallish(get(tx + 1, ty))
    const vertical = (wallN && wallS) || (!wallW && !wallE)   // default to vertical when ambiguous

    // Base fill.
    g.fillStyle(CAPSTONE_BASE, 1)
    g.fillRect(px, py, TS, TS)

    // Seams oriented along the walkway axis — vertical seams for vertical
    // walkway, horizontal seams for horizontal walkway. Anchored to global
    // coords so they line up across the gap and the neighbour walls.
    g.fillStyle(CAPSTONE_SEAM, 0.7)
    const SP = CAPSTONE_SEAM_SPACING
    if (vertical) {
      const first = Math.ceil(px / SP) * SP
      for (let wx = first; wx < px + TS; wx += SP) {
        if (wx > px) g.fillRect(wx, py, 1, TS)
      }
    } else {
      const first = Math.ceil(py / SP) * SP
      for (let wy = first; wy < py + TS; wy += SP) {
        if (wy > py) g.fillRect(px, wy, TS, 1)
      }
    }

    // Edge accents only on void-facing sides (skip wall-facing sides — the
    // neighbouring wall's cap already paints its highlight/shadow there).
    g.fillStyle(CAPSTONE_HIGHLIGHT, 0.7)
    if (!wallN) g.fillRect(px, py, TS, 1)
    if (!wallW) g.fillRect(px, py, 1, TS)
    g.fillStyle(CAPSTONE_SHADOW, 0.85)
    if (!wallS) g.fillRect(px, py + TS - 1, TS, 1)
    if (!wallE) g.fillRect(px + TS - 1, py, 1, TS)
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
    // doorway reads as a recessed underpass (fallback for unskinned doors;
    // skinned doors suppress this cell and supply their own art).
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
      // Orientation matches the walkway axis so seams + edge accents line
      // up with the neighbour rooms' capstones on either side.
      this._drawGapStubCap(over, px, py, x, y)
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

  // Per-frame door-open timer. The open SKIN already swapped to its open
  // variant the instant openDoor() ran (cp.opening flips _doorStateFor to
  // 'open' → redrawDoors), so there's nothing to animate here — this just
  // ramps openProgress and flips cp.open=true (+ DOOR_OPENED) when the timer
  // completes, for save-state continuity and the door-opened event.
  // Game.update() must call this.
  update(deltaMs) {
    if (!this._gameState?.dungeon?.rooms) return
    const dt = (deltaMs || 0) / 1000
    for (const room of this._gameState.dungeon.rooms) {
      for (const cp of room.connectionPoints ?? []) {
        if (!cp.opening) continue
        cp.openProgress = Math.min(1, (cp.openProgress || 0) + dt / DOOR_OPEN_DURATION_S)
        if (cp.openProgress >= 1) {
          cp.opening      = false
          cp.open         = true
          cp.openProgress = 1
          EventBus.emit('DOOR_OPENED', { roomId: room.instanceId, cp })
        }
      }
    }
  }

  // Public helper — kicks an opening animation on this cp. Idempotent: a
  // cp already open or already opening doesn't restart. Used by the
  // adventurer step-on trigger and the day-start hook.
  //
  // When the cp is paired (a normal inter-room doorway), this ALSO opens
  // the partner cp. The sprite path projects from the OWNER cp only
  // (S/E direction), so triggering only the non-owner side (N/W) would
  // leave the owner's state stuck on 'closed' and the sprite wouldn't
  // swap to the open swatch until the adventurer crossed the seam.
  // Opening both keeps owner + paired in sync regardless of entry side.
  openDoor(cp) {
    if (!cp) return false
    const pairedCp = this._findPairedCpForCp(cp)
    let didOpen = false
    for (const target of [cp, pairedCp]) {
      if (!target || target.open || target.opening) continue
      target.opening      = true
      target.openProgress = 0
      EventBus.emit('DOOR_OPENING', { cp: target })
      didOpen = true
    }
    if (!didOpen) return false
    // Lightweight door-only redraw. A full redraw() rebuilds the entire
    // dungeon (walls, floors, decor, void mask, sprites, ...) and was
    // causing a noticeable freeze on every door open/close.
    this.redrawDoors()
    return true
  }

  // Helper: locate the paired cp for a given cp without requiring the
  // caller to know the room. Walks the rooms list to find the cp's owner
  // room, then delegates to _findPairedCp. Returns null for external or
  // unpaired cps.
  _findPairedCpForCp(cp) {
    if (!cp || cp.external) return null
    const room = (this._gameState?.dungeon?.rooms ?? [])
      .find(r => (r.connectionPoints ?? []).includes(cp))
    if (!room) return null
    return this._findPairedCp(room, cp)?.pairedCp || null
  }

  // Force a cp back to closed state (no animation). Used by the day-end
  // hook to reset entry-hall external doors so they re-animate next day.
  closeDoor(cp) {
    if (!cp) return
    const pairedCp = this._findPairedCpForCp(cp)
    let didChange = false
    for (const target of [cp, pairedCp]) {
      if (!target) continue
      const wasOpenOrAnimating = target.open || target.opening
      target.open         = false
      target.opening      = false
      target.openProgress = 0
      if (wasOpenOrAnimating) didChange = true
    }
    // If we just closed an open door, the sprite/skin path needs to swap
    // door_open_* art for door_closed_*. Use the lightweight door-only
    // redraw — a full redraw() was causing a noticeable freeze on every
    // door event. A no-op close needs no redraw at all.
    if (didChange) {
      this.redrawDoors()
      EventBus.emit('DOOR_CLOSED', { cp })
    }
  }

  // Lightweight redraw for door state changes (open/close). Rebuilds ONLY
  // the door sprite containers, the door cell map (so per-cell `state` +
  // `renderable` flags reflect the current cp.open/cp.opening state), and
  // the single-image door skins / aprons. Leaves walls, floors, decor,
  // void mask, etc. untouched.
  //
  // A full redraw() was causing a ~0.5 s freeze on every door event because
  // it rebuilt the entire dungeon.
  redrawDoors() {
    this._cDoorSpritesLow.removeAll(true)
    this._cDoorSpritesHigh.removeAll(true)

    const tiles = this._gameState?.dungeon?.tiles
    if (tiles) {
      // The doorway mask graphics + shadow-cell set get accumulating fills
      // every time _buildDoorCellMap runs. Clear them first so the rebuild
      // starts clean. Geometry masks read their source graphics' current
      // state at render time, so re-painting the same shapes is fine.
      this._innerCellMaskG?.clear()
      this._outerCellMaskG?.clear()

      // Rebuild the door cell map — this captures fresh per-cell `state`
      // and `renderable` flags. Without it, the sprite resolver keeps using
      // the state ('closed') captured at the last full redraw and the door
      // art never swaps to the open swatch.
      this._doorCellMap = this._buildDoorCellMap()

      // _drawTiles normally exempts doorway anchors from _spanCoveredSet
      // after the map is built so they iterate and render. Replicate that.
      for (const [k, v] of this._doorCellMap.entries()) {
        if (v.spanRender) this._spanCoveredSet?.delete(k)
      }

      for (const [k, doorEntry] of this._doorCellMap.entries()) {
        const isDoorwayCell = doorEntry.kind === 'door' || doorEntry.kind === 'jamb'
        if (!isDoorwayCell) continue
        const comma = k.indexOf(',')
        const x = +k.slice(0, comma)
        const y = +k.slice(comma + 1)
        // Skip cells that route to _cTileSprites (tileLayout span anchors
        // overlapping the doorway zone) — we don't clear that container
        // here, so re-rendering would duplicate its contents.
        const isTileLayoutWall = !doorEntry.spanRender && this._isTileLayoutSpanAnchor(x, y)
        if (isTileLayoutWall) continue
        if (this._spanCoveredSet?.has(k) && !doorEntry.spanRender) continue
        const t = tiles[y]?.[x]
        if (t == null) continue
        this._renderTileSprite(x, y, t)
      }
    }

    // Single-image door skins + aprons are per-state too, so re-render them
    // here — otherwise an opening / locking door keeps showing the CLOSED skin
    // instead of swapping to its open / locked one.
    this._cDoorSkins.removeAll(true)
    this._cDoorSkinsHigh.removeAll(true)
    this._clearDoorSkinWall()
    this._drawDoorSkins()
    this._cDoorAprons.removeAll(true)
    this._drawDoorAprons()
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

  // Re-paint VOID tiles on _gVoidMask (depth 8.5, ABOVE characters at 7-8)
  // so any sprite intruding into a void cell — typically the upper portion
  // of a tall LPC adventurer (64x64 frame) whose head extends into the
  // wall/void tile north of their feet — is properly hidden by the gap.
  // Solid STONE_BASE fill matches the _gBg base so the void looks
  // continuous; per-cell texture stays on _gBg.
  _drawVoidMask() {
    const { tiles, gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    // Build the GeometryMask for the void-occluder: fill every VOID cell so
    // the occluder fill is visible there (hiding any sprite overdraw into the
    // void).  _voidMaskMaskG was cleared at redraw() start.
    const mg = this._voidMaskMaskG
    mg.fillStyle(0xffffff, 1)   // colour is irrelevant for GeometryMask
    for (let y = 0; y < gh; y++) {
      const row = tiles[y]
      if (!row) continue
      for (let x = 0; x < gw; x++) {
        if (row[x] !== TILE.VOID) continue
        mg.fillRect(x * TS, y * TS, TS, TS)
      }
    }
    // Crisp Graphics occluder, clipped to those VOID cells by the mask (no
    // TileSprite edge bleed).
    if (this._gVoidOcc) {
      this._gVoidOcc.clear()
      this._gVoidOcc.fillStyle(VOID_BG_COLOR, 1)
      this._gVoidOcc.fillRect(0, 0, gw * TS, gh * TS)
    }
  }

  _drawBackground() {
    // The flat bedrock backdrop fill + the edge fade that darkens its outer
    // margin into DEEP_DARK (so there's no hard bedrock→void seam) are both
    // drawn in _drawEdgeFade(); then the "freshly chiseled" carve halo.
    this._drawEdgeFade()
    this._drawCarveHalo()
  }

  // Uniform-width border fade: the bedrock darkens to DEEP_DARK over a FIXED
  // EDGE_FADE_TILES margin on ALL four sides (so a wide/short dungeon fades by
  // the same amount top and side), then the camera background (also DEEP_DARK)
  // takes over — no hard seam, no aspect-skewed line, no corner poke-through.
  // Drawn on _gFade (depth -0.4): below the room art, so rooms stay bright.
  _drawEdgeFade() {
    const g = this._gFade
    if (!g) return
    const { gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    const W = gw * TS, H = gh * TS
    const FD = EDGE_FADE_TILES * TS
    const C = DEEP_DARK
    // Solid bedrock backdrop, grid + fade-margin on all sides (crisp Graphics
    // fill — no TileSprite texel-bleed seam). The strips below darken its margin.
    if (this._gBgFill) {
      this._gBgFill.fillStyle(VOID_BG_COLOR, 1)
      this._gBgFill.fillRect(-FD, -FD, W + 2 * FD, H + 2 * FD)
    }
    // Opaque void-colour base over the MARGIN frame only (never the grid interior,
    // so placed rooms stay visible). At this layer's high depth it hides additive
    // torch/light glow that bleeds past the grid edge; the gradient strips below
    // then darken it to DEEP_DARK exactly as before (so the look is unchanged).
    g.fillStyle(VOID_BG_COLOR, 1)
    g.fillRect(0, -FD, W, FD); g.fillRect(0, H, W, FD)        // top / bottom strips
    g.fillRect(-FD, 0, FD, H); g.fillRect(W, 0, FD, H)        // left / right strips
    g.fillRect(-FD, -FD, FD, FD); g.fillRect(W, -FD, FD, FD)  // TL / TR corners
    g.fillRect(-FD, H, FD, FD); g.fillRect(W, H, FD, FD)      // BL / BR corners
    // Edge strips — alpha 0 at the grid edge → 1 at the outer rim (grid+FD).
    // fillGradientStyle(tl, tr, bl, br, aTL, aTR, aBL, aBR)
    g.fillGradientStyle(C, C, C, C, 1, 1, 0, 0); g.fillRect(0, -FD, W, FD)   // top
    g.fillGradientStyle(C, C, C, C, 0, 0, 1, 1); g.fillRect(0,  H,  W, FD)   // bottom
    g.fillGradientStyle(C, C, C, C, 1, 0, 1, 0); g.fillRect(-FD, 0, FD, H)   // left
    g.fillGradientStyle(C, C, C, C, 0, 1, 0, 1); g.fillRect(W,   0, FD, H)   // right
    // Corners — clear ONLY at the inner (grid) corner, full dark on the other
    // three so they meet both adjoining strips' outer edges (no diagonal seam).
    g.fillGradientStyle(C, C, C, C, 1, 1, 1, 0); g.fillRect(-FD, -FD, FD, FD) // TL (grid corner = BR)
    g.fillGradientStyle(C, C, C, C, 1, 1, 0, 1); g.fillRect(W,   -FD, FD, FD) // TR (grid corner = BL)
    g.fillGradientStyle(C, C, C, C, 1, 0, 1, 1); g.fillRect(-FD,  H,  FD, FD) // BL (grid corner = TR)
    g.fillGradientStyle(C, C, C, C, 0, 1, 1, 1); g.fillRect(W,    H,  FD, FD) // BR (grid corner = TL)
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

  // Dramatic placement animation. Sequence (~900ms):
  //   1. Camera shake + outline flash (impact)
  //   2. Stone-cover overlay hides the just-rendered room
  //   3. Cover cells "shatter" outward in a wave from edges → center,
  //      revealing the room beneath; chunks of stone fly into the void
  //   4. Existing dust settles
  // All elements live as scene-level GameObjects with tween-onComplete
  // cleanup, so the animation runs above _gOverhead / the door layers and
  // never pollutes the renderer's redraw cycle.
  _playCarveAnimation(payload) {
    const room = payload?.room
    if (!room) return
    const scene  = this._scene
    // Defensive bail — if this DungeonRenderer's scene has already been
    // torn down (Phaser stop event ran, scene.cameras.main is gone),
    // an EventBus.off() race or a leaked subscription can still fire
    // this listener. Without this guard the next line crashes with
    // "Cannot read properties of undefined (reading 'shake')" and
    // poisons the whole ROOM_PLACED emit chain (the rest of the
    // listeners — and the brand-new boss room placement during
    // createGameState — never get to run).
    if (!scene || !scene.sys || scene.sys.isActive?.() === false) return
    if (!scene.cameras?.main) return
    const px = room.gridX * TS, py = room.gridY * TS
    const pw = room.width  * TS, ph = room.height * TS
    const cx = px + pw / 2, cy = py + ph / 2

    // 1) Brief camera shake to sell the impact — gated by the
    // SettingsOverlay SCREEN SHAKE toggle (qf.video.shake).
    let _shakeOk = true
    try { _shakeOk = localStorage.getItem('qf.video.shake') !== 'false' } catch {}
    if (_shakeOk) scene.cameras.main.shake(180, 0.0035)

    // 2) Bright outline flash that fades over ~280ms
    const flashG = scene.add.graphics().setDepth(9.9)
    flashG.lineStyle(4, 0xfff2a0, 1).strokeRect(px - 1, py - 1, pw + 2, ph + 2)
    scene.tweens.add({
      targets: flashG, alpha: 0, duration: 280, ease: 'Quad.Out',
      onComplete: () => flashG.destroy(),
    })

    // 3) Stone-cover cells — one rectangle per tile in the room, layered
    //    (depth 9.7) above the renderer's door layers so the room is hidden beneath.
    //    Cells fade + scale outward starting from the edges; delay grows
    //    with distance from the nearest edge so the carve front sweeps
    //    inward like a chisel knocking off perimeter chunks first.
    const SHATTER_BASE_DURATION = 260
    const PER_RING_DELAY = 55
    for (let dy = 0; dy < room.height; dy++) {
      for (let dx = 0; dx < room.width; dx++) {
        const distToEdge = Math.min(dx, dy, room.width - 1 - dx, room.height - 1 - dy)
        const delay = distToEdge * PER_RING_DELAY + Math.random() * 50
        const cell = scene.add.rectangle(
          px + dx * TS + TS / 2,
          py + dy * TS + TS / 2,
          TS, TS, STONE_BASE, 1,
        ).setDepth(9.7)
        // Subtle pre-shake before shatter — tiny x/y wobble for ~80ms
        scene.tweens.add({
          targets: cell, x: cell.x + (Math.random() - 0.5) * 2, y: cell.y + (Math.random() - 0.5) * 2,
          delay: Math.max(0, delay - 80), duration: 80, yoyo: true, repeat: 1,
        })
        scene.tweens.add({
          targets: cell, alpha: 0, scaleX: 1.35, scaleY: 1.35,
          delay, duration: SHATTER_BASE_DURATION, ease: 'Cubic.Out',
          onComplete: () => cell.destroy(),
        })
      }
    }

    // 4) Stone chunk burst — heavier than the dust, with rotation + slight
    //    gravity so they read as physical debris, not just particles.
    const chunkColors = [0x4a3e30, 0x6a5a48, 0x8a7a60, 0x3a2e22]
    const chunkCount  = Math.min(28, Math.floor((pw + ph) / 12))
    for (let i = 0; i < chunkCount; i++) {
      const angle = Math.random() * Math.PI * 2
      const sR    = Math.min(pw, ph) * (0.15 + Math.random() * 0.25)
      const sx    = cx + Math.cos(angle) * sR
      const sy    = cy + Math.sin(angle) * sR
      const size  = 3 + Math.floor(Math.random() * 4)
      const chunk = scene.add.rectangle(sx, sy, size, size,
        chunkColors[(Math.random() * chunkColors.length) | 0], 1).setDepth(9.86)
      chunk.setRotation(Math.random() * Math.PI * 2)
      const dist = 30 + Math.random() * 50
      scene.tweens.add({
        targets: chunk,
        x: sx + Math.cos(angle) * dist,
        y: sy + Math.sin(angle) * dist + 18,   // gravity drop
        alpha: 0,
        angle: 360 * (Math.random() > 0.5 ? 1 : -1),
        delay: Math.random() * 120,
        duration: 600 + Math.random() * 250, ease: 'Quad.Out',
        onComplete: () => chunk.destroy(),
      })
    }

    // 5) Dust settles last (existing burst layered on top of the new effects)
    this._burstCarveDust(payload)
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
    const { gridWidth: gw, gridHeight: gh } = this._gameState.dungeon
    const g = this._gGrid
    // Ambient grid — always drawn (masked to VOID cells via _gGrid's setup)
    // so the flat void backdrop reads as dungeon bedrock, not a blank field.
    // Kept very faint so it's texture, not visual noise.
    this._strokeGrid(g, gw, gh, 0.05, 0.10)
    // Placement grid — a brighter overlay while a build placement is active,
    // so the grid "lighting up" still reads as a placement affordance.
    if (this._showGrid) this._strokeGrid(g, gw, gh, 0.46, 0.85)
  }

  // One full grid pass: thin minor lines on every cell boundary + stronger
  // lines every 5th. Run once for the ambient pass, again (brighter) for
  // the placement overlay.
  _strokeGrid(g, gw, gh, minorAlpha, majorAlpha) {
    g.lineStyle(1, PALETTE.gridLine, minorAlpha)
    for (let tx = 0; tx <= gw; tx++) {
      g.beginPath(); g.moveTo(tx * TS, 0); g.lineTo(tx * TS, gh * TS); g.strokePath()
    }
    for (let ty = 0; ty <= gh; ty++) {
      g.beginPath(); g.moveTo(0, ty * TS); g.lineTo(gw * TS, ty * TS); g.strokePath()
    }
    g.lineStyle(1, PALETTE.gridLine, majorAlpha)
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

  // ── Color adjustment ────────────────────────────────────────────────────────

  // Applies hue/saturation/brightness/contrast via Phaser 3.60 ColorMatrix.
  // adj = { hue, sat, bright, contrast } — all optional, default 0 = no change.
  // usePre=true → preFX (inline render pass, compatible with geometry masks).
  // usePre=false → postFX (offscreen pass, breaks geometry masks on containers).
  _applyColorAdj(img, adj, usePre = false) {
    if (!adj) return
    const { hue = 0, sat = 0, bright = 0, contrast = 0 } = adj
    if (!hue && !sat && !bright && !contrast) return
    try {
      const fx = usePre ? img.preFX : img.postFX
      const cm = fx?.addColorMatrix?.()
      if (!cm) return
      if (hue)      cm.hue(hue, true)
      if (sat)      cm.saturate(sat, true)
      if (bright)   cm.brightness(1 + bright, true)
      if (contrast) cm.contrast(contrast, true)
    } catch (_) {}
  }

  // ── Decoration sprites ──────────────────────────────────────────────────────

  _drawRoomDecorations() {
    for (const room of this._gameState.dungeon.rooms) {
      const decorations = room.decorations
      if (!Array.isArray(decorations) || decorations.length === 0) continue
      for (const decor of decorations) {
        const key = `decor-${decor.spriteId}`
        if (!this._scene.textures.exists(key)) continue
        const sz = decor.size ?? 1
        const wx = (room.gridX + decor.x) * TS + (sz * TS) / 2
        const wy = (room.gridY + decor.y) * TS + (sz * TS) / 2
        const img = this._scene.add.image(wx, wy, key)
          .setOrigin(0.5).setDisplaySize(sz * TS, sz * TS)
        if (decor.rot)   img.setAngle(decor.rot)
        if (decor.flipH) img.flipX = true
        if (decor.flipV) img.flipY = true
        if (decor.layer === 'object') {
          this._cDecorObject.add(img)
        } else {
          this._cDecorFloor.add(img)
        }
      }
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

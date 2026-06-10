// RoomGhostRenderer — build a translucent visual ghost of a room def at a
// given rotation, used by NightPhase's placement preview.
//
// Two render strategies, picked in order:
//   1. SKINNED room — the def carries a `backgroundImage` (or per-boss skin
//      for the boss chamber). Render that one image stretched over the room
//      footprint. Matches what DungeonRenderer does for placed skinned rooms.
//   2. TILE-LAYOUT room — walk the rotated tileLayout and stamp each cell's
//      themesprite at its local (rx, ry) tile. Same sprite resolution
//      pipeline as DungeonRenderer._resolveCellSprite (per-cell override
//      path) so what you see in the ghost matches what'll land on placement.
//
// We don't try to replicate DungeonRenderer's theme-default fallback (live
// _wallOrient / _slotForCell) — those depend on the LIVE tile grid + neighbour
// rooms, which we don't have for a candidate placement. In practice rooms in
// this game have explicit tileLayout entries for every meaningful wall/floor
// cell, so the explicit path covers what the player needs to see.
//
// Returns a Phaser Container whose top-left is at (0, 0) local — the caller
// positions it at the cursor world coords and tints/alpha-fades it for the
// validity look.

import { ThemeManager, spriteCoverageHW, readCellEntry } from '../systems/ThemeManager.js'
import { getRotatedDef } from '../util/roomRotation.js'
import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

function _themeTextureKey(id) { return `themesprite-${id}` }
function _roomSkinTexKey(id)  { return `room-skin-${id}` }

// Build the ghost. `scene` = the Phaser scene that owns the canvas (typically
// the Game scene — its DungeonRenderer textures are registered there).
// `rotation` = 0/90/180/270 degrees.
//
// Returns a Phaser Container at local origin (0, 0); the caller positions and
// alpha-fades it. Caller owns destruction.
export function buildRoomGhost(scene, def, rotation) {
  const rotDef = getRotatedDef(def, rotation)
  const container = scene.add.container(0, 0)
  // Carry the rotated def's footprint so the caller can compute the rotation
  // label's centred-above position without re-rotating.
  container._roomWidth  = rotDef.width
  container._roomHeight = rotDef.height

  // (1) SKINNED room — one stretched image. Stamps over the entire footprint;
  // the actual texture file already includes the walls/doors/floor art.
  const skinKey = _resolveSkinKey(scene, rotDef)
  if (skinKey) {
    const img = scene.add.image(0, 0, skinKey).setOrigin(0, 0)
    img.setDisplaySize(rotDef.width * TS, rotDef.height * TS)
    container.add(img)
    return container
  }

  // (2) TILE-LAYOUT room — stamp each explicit cell entry.
  const layout = Array.isArray(rotDef.tileLayout) ? rotDef.tileLayout : []
  for (let ry = 0; ry < layout.length; ry++) {
    const row = layout[ry] || []
    for (let rx = 0; rx < row.length; rx++) {
      const entry = readCellEntry(row[rx])
      if (!entry) continue
      const sprite = ThemeManager.getSprite(entry.id)
      if (!sprite) continue
      const key = _themeTextureKey(entry.id)
      if (!scene.textures.exists(key)) continue
      const { w: covW, h: covH } = spriteCoverageHW(sprite)
      const sizeW = covW * TS
      const sizeH = covH * TS
      // Origin (0.5) so per-cell rot/flip pivots on the sprite's centre.
      const img = scene.add.image(rx * TS + sizeW / 2, ry * TS + sizeH / 2, key).setOrigin(0.5)
      img.setDisplaySize(sizeW, sizeH)
      if (entry.rot)   img.setAngle(entry.rot)
      if (entry.flipH) img.flipX = true
      if (entry.flipV) img.flipY = true
      container.add(img)
    }
  }

  return container
}

// Resolve a skin texture key for a (rotated) def, if any. Boss chamber may
// carry per-boss skins on `backgroundImageByBoss` — we don't have a live boss
// archetype yet during placement preview, so fall back to the def's default
// backgroundImage rather than rendering the wrong boss's chamber.
function _resolveSkinKey(scene, def) {
  const id = def?.backgroundImage
  if (!id) return null
  const key = _roomSkinTexKey(id)
  return scene.textures.exists(key) ? key : null
}

// Tint every child Image in the ghost by the validity colour. Phaser Containers
// don't surface a tint of their own, so iterate. The desaturated soft colours
// (light green / light red) let the actual room art show through.
export function tintRoomGhost(container, tint) {
  if (!container || !container.list) return
  for (const child of container.list) {
    if (child.setTint) child.setTint(tint)
  }
}

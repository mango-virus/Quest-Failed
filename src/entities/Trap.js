// Runtime trap entity factory + geometry helpers.
// Plain JSON-serializable objects — SaveSystem persists gameState.dungeon.traps[].
//
// 2026-05-20 trap redesign. Supersedes the old single-tile step/event traps.
// Supports multi-tile (2x2) footprints, wall mounting, rotation, and the saw
// blade's travel track. Per-trap behaviour lives in TrapSystem; per-trap
// visuals in TrapRenderer; tuning in src/data/trapTypes.json.

import { Balance } from '../config/balance.js'

const TS = Balance.TILE_SIZE

function _uid() {
  return `trap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function _defaultFacing(typeDef) {
  if (typeDef.id === 'saw_blade') return 'E'   // E = horizontal track
  return 'S'                                   // cannon / wall traps point down
}

// Create a placed trap instance. `opts` = { tileX, tileY, facing }.
// tileX/tileY is the anchor (top-left tile of the footprint). `facing` is
// meaningful for rotatable traps (cannon: N/S/E/W), the saw blade (E =
// horizontal track, S = vertical track), and wall traps (the direction the
// trap fires into the room — resolved from the wall side at placement).
export function createTrap(typeDef, opts) {
  const fw = typeDef.footprint?.w ?? 1
  const fh = typeDef.footprint?.h ?? 1
  const { tileX, tileY } = opts
  return {
    instanceId:   _uid(),
    definitionId: typeDef.id,
    tileX,
    tileY,
    footprint:    { w: fw, h: fh },
    placement:    typeDef.placement,
    solid:        !!typeDef.solid,   // collision — pathfinding routes around it
    facing:       opts.facing ?? _defaultFacing(typeDef),
    worldX:       (tileX + fw / 2) * TS,
    worldY:       (tileY + fh / 2) * TS,
    isTriggered:  false,             // spent for the day (consumable bomb / spike pit sprung)
    isKnownToAdventurers: false,     // flips on trigger or damage-survived
    cooldownUntil: 0,                // scene.time.now ms gate before the next fire
    state:        {},                // per-trap scratch (fuse, saw pos, per-adv hit timers…)
  }
}

// Tiles covered by the trap's footprint (collision + overlap checks).
export function footprintTiles(trap) {
  const out = []
  for (let dy = 0; dy < trap.footprint.h; dy++)
    for (let dx = 0; dx < trap.footprint.w; dx++)
      out.push({ x: trap.tileX + dx, y: trap.tileY + dy })
  return out
}

// Tiles the saw blade's track runs along — `length` tiles from the anchor
// in the facing axis. facing E/W → horizontal, N/S → vertical.
export function trackTiles(trap, length) {
  const horiz = trap.facing === 'E' || trap.facing === 'W'
  const out = []
  for (let i = 0; i < length; i++) {
    out.push(horiz ? { x: trap.tileX + i, y: trap.tileY }
                   : { x: trap.tileX, y: trap.tileY + i })
  }
  return out
}

// Saw blade position along its track at time `now` (ms) — a triangle wave
// oscillating 0 ↔ (length-1) at `speed` tiles/sec. A pure function of time
// so TrapSystem (damage) and TrapRenderer (animation) stay in sync without
// sharing mutable state — and the renderer can animate the saw during the
// night phase, when TrapSystem isn't ticking.
export function sawPosAt(now, length, speed) {
  const span   = Math.max(1, length - 1)
  const period = (2 * span) / Math.max(0.1, speed)   // seconds, full there-and-back
  const phase  = ((now / 1000) % period) / period     // 0..1
  return phase < 0.5 ? phase * 2 * span : (1 - phase) * 2 * span
}

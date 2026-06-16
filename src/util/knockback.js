// Dungeon knockback — tiered, both factions (adv + minion). A BIG hit flings the
// target hard, a MEDIUM hit nudges it, a normal melee never knocks back. The
// target slides (suspending its AI movement for the brief window) and SLAMS to a
// stop against walls with an impact spark. Mirrors the boss-fight knockback
// (BossSystem fs.vx/vy + wall clamp) but for AI-driven dungeon entities.
//
// Trigger lives in CombatSystem (a COMBAT_HIT listener → applyKnockback); the
// SLIDE (tickKnockback) is called each frame from the entity's AI tick — when it
// returns true the caller must SKIP normal movement (the slide owns position).
//
// `delta` is MILLISECONDS (matches AISystem/MinionAISystem: step = v·delta/1000).

import { Balance } from '../config/balance.js'
import { PathfinderSystem } from '../systems/PathfinderSystem.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'
import { EventBus } from '../systems/EventBus.js'
import { TILE } from '../systems/DungeonGrid.js'

const TS = Balance.TILE_SIZE

// Knockback must never leave an entity STANDING on a door tile — doorways are for
// transit (the single-file funnel), and an entity parked there gets stuck. When a
// knockback stops on a door, snap it onto the nearest adjacent FLOOR tile (prefer
// continuing the slide direction). `vx/vy` give the slide heading for that pick.
function _clearDoorway(entity, grid, vx, vy) {
  if (!grid || typeof grid.getTileType !== 'function') return
  const tx = Math.floor((entity.worldX ?? 0) / TS), ty = Math.floor((entity.worldY ?? 0) / TS)
  if (grid.getTileType(tx, ty) !== TILE.DOOR) return
  const sx = Math.sign(vx || 0), sy = Math.sign(vy || 0)
  const cands = [[sx, sy], [sx, 0], [0, sy], [1, 0], [-1, 0], [0, 1], [0, -1]]
  for (const [ox, oy] of cands) {
    if (ox === 0 && oy === 0) continue
    const t = grid.getTileType(tx + ox, ty + oy)
    if (t !== TILE.DOOR && PathfinderSystem.isWalkable(t)) {
      entity.worldX = (tx + ox) * TS + TS / 2
      entity.worldY = (ty + oy) * TS + TS / 2
      entity.tileX = tx + ox; entity.tileY = ty + oy
      return
    }
  }
}

// Knockback speed (px/s) for a hit of `damage` on `target`. `heavy` forces a tier
// regardless of size: 'big' → big, truthy → at least small. Returns 0 = no knockback.
export function knockbackSpeedFor(target, damage, heavy = false) {
  const maxHp = target?.resources?.maxHp ?? 0
  const frac  = maxHp > 0 ? (damage / maxHp) : 0
  if (heavy === 'big' || frac >= (Balance.KNOCKBACK_BIG_FRAC ?? 0.22)) return Balance.KNOCKBACK_BIG_SPEED ?? 15 * TS
  if (heavy || frac >= (Balance.KNOCKBACK_MED_FRAC ?? 0.10))           return Balance.KNOCKBACK_SMALL_SPEED ?? 8 * TS
  return 0
}

// Push `entity` away from (fromX,fromY) at `speed` px/s for the knockback window.
// Sets the transient _kb* fields the slide reads. No-op if speed ≤ 0.
export function applyKnockback(entity, fromX, fromY, speed, now) {
  if (!entity || !(speed > 0)) return
  let dx = (entity.worldX ?? 0) - fromX, dy = (entity.worldY ?? 0) - fromY
  let d = Math.hypot(dx, dy)
  if (d < 0.01) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); d = 1 }
  entity._kbVx = (dx / d) * speed
  entity._kbVy = (dy / d) * speed
  entity._knockbackUntil = now + (Balance.KNOCKBACK_DUR_MS ?? 300)
}

// Per-frame slide. Returns true while a knockback is active (caller skips normal
// AI movement). Moves by velocity, decays, clamps to WALKABLE tiles (slam stop +
// impact spark on a wall), syncs tile coords.
export function tickKnockback(entity, deltaMs, grid, scene, now) {
  if ((entity._knockbackUntil ?? 0) <= now) return false
  const vx = entity._kbVx ?? 0, vy = entity._kbVy ?? 0
  const sec = (deltaMs ?? 16) / 1000
  const nx = (entity.worldX ?? 0) + vx * sec
  const ny = (entity.worldY ?? 0) + vy * sec
  const realGrid = grid && typeof grid.getTileType === 'function'
  const tx = Math.floor(nx / TS), ty = Math.floor(ny / TS)
  const walkable = !realGrid || PathfinderSystem.isWalkable(grid.getTileType(tx, ty))
  if (walkable) {
    entity.worldX = nx; entity.worldY = ny
  } else {
    // WALL SLAM — stop hard, spark an impact, end the knockback.
    if (scene?.add && AbilityVfx?.impactFx) { try { AbilityVfx.impactFx(scene, entity.worldX, entity.worldY, { color: 0xffffff }) } catch (e) {} }
    if (Math.hypot(vx, vy) > (Balance.KNOCKBACK_WALL_IMPACT_MIN ?? 6 * TS)) {
      EventBus.emit('KNOCKBACK_WALL_IMPACT', { id: entity.instanceId, x: entity.worldX, y: entity.worldY })
    }
    entity.tileX = Math.floor((entity.worldX ?? 0) / TS)
    entity.tileY = Math.floor((entity.worldY ?? 0) / TS)
    if (realGrid) _clearDoorway(entity, grid, vx, vy)   // never park in a doorway
    entity._kbVx = 0; entity._kbVy = 0; entity._knockbackUntil = 0
    return true
  }
  entity.tileX = Math.floor(entity.worldX / TS)
  entity.tileY = Math.floor(entity.worldY / TS)
  const decay = Balance.KNOCKBACK_DECAY ?? 0.88
  entity._kbVx *= decay; entity._kbVy *= decay
  // Ended by decay or the window expiring → settle to a clean stop (zero velocity),
  // and never leave the entity parked on a door tile.
  if (Math.hypot(entity._kbVx, entity._kbVy) < (Balance.KNOCKBACK_MIN_SPEED ?? 1 * TS) || now >= entity._knockbackUntil) {
    if (realGrid) _clearDoorway(entity, grid, entity._kbVx, entity._kbVy)
    entity._kbVx = 0; entity._kbVy = 0; entity._knockbackUntil = 0
  }
  return true
}

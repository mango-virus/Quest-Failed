// Headless check — dungeon KNOCKBACK util (Hit-reaction #2).
//
//   node tools/sim/knockback-check.mjs
//
// Drives the REAL knockback util: tiered speed (none/small/big by %maxHP + tag),
// applyKnockback sets a velocity AWAY from the attacker, and tickKnockback slides
// the entity, clamps to WALKABLE tiles (slam-stops at a wall), and ends on
// decay/window. No Phaser needed (VFX is skipped when the scene has no `.add`).

import { applyKnockback, tickKnockback, knockbackSpeedFor } from '../../src/util/knockback.js'
import { TILE } from '../../src/systems/DungeonGrid.js'

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

const TS = 32
const tgt = (maxHp = 100) => ({ instanceId: 't', worldX: 5 * TS, worldY: 5 * TS, resources: { hp: maxHp, maxHp } })
// Open floor everywhere EXCEPT a wall column at tileX >= 6 (1 tile right of the
// target at tileX 5) — close enough that a big knockback SLAMS into it.
const grid = { getTileType: (tx) => (tx >= 6 ? TILE.WALL : TILE.FLOOR) }
const scene = {} // no `.add` → VFX skipped

// ── 1) Tiered speed: none / small / big ─────────────────────────────────────
console.log('\n[1] knockbackSpeedFor tiers')
{
  const t = tgt(100)
  ok(knockbackSpeedFor(t, 5)  === 0, 'small hit (5% maxHP) → NO knockback (normal melee)')
  ok(knockbackSpeedFor(t, 12) > 0 && knockbackSpeedFor(t, 12) < knockbackSpeedFor(t, 30), '12% → small, less than a big hit')
  ok(knockbackSpeedFor(t, 30) === (knockbackSpeedFor(t, 99)), '30% and 99% both cap at BIG speed')
  ok(knockbackSpeedFor(t, 1, 'big') > 0, 'a TAGGED big ability knocks back even on tiny damage')
  ok(knockbackSpeedFor(t, 1, true) > 0, 'a tagged (truthy) ability → at least small')
}

// ── 2) applyKnockback pushes AWAY from the attacker ─────────────────────────
console.log('\n[2] applyKnockback direction')
{
  const t = tgt(); // attacker to the LEFT of target → target flung RIGHT (+x)
  applyKnockback(t, 3 * TS, 5 * TS, knockbackSpeedFor(t, 30), 1000)
  ok(t._kbVx > 0 && Math.abs(t._kbVy) < 1e-6, 'flung directly away from the attacker (+x)')
  ok(t._knockbackUntil > 1000, 'knockback window set')
}

// ── 3) tickKnockback slides, then SLAMS to a stop at a wall ──────────────────
console.log('\n[3] slide + wall clamp')
{
  const t = tgt()
  applyKnockback(t, 3 * TS, 5 * TS, knockbackSpeedFor(t, 99), 0) // big, straight toward the +x wall
  const x0 = t.worldX
  let slid = false, stopped = false
  for (let i = 0; i < 60 && (t._knockbackUntil ?? 0) > 0; i++) {
    const active = tickKnockback(t, 16, grid, scene, i * 16)
    if (t.worldX > x0 + 1) slid = true
    if (!active || t._knockbackUntil === 0) { stopped = true; break }
  }
  ok(slid, 'entity slid in the knockback direction')
  ok(stopped, 'knockback ended (wall slam or decay)')
  ok(Math.floor(t.worldX / TS) < 6, 'clamped BEFORE the wall column (never tunnels into a wall tile)')
  ok((t._kbVx === 0 && t._kbVy === 0), 'velocity zeroed on stop')
  ok((t._knockbackUntil ?? 0) === 0, 'window cleared')
  // tile coords synced to the new world position
  ok(t.tileX === Math.floor(t.worldX / TS), 'tile coords synced to world position')
}

// ── 3b) Never parked in a doorway ───────────────────────────────────────────
console.log('\n[3b] knockback never stops on a door tile')
{
  // Floor everywhere except a single DOOR tile at tileX 6 (floor beyond it).
  const doorGrid = { getTileType: (tx) => (tx === 6 ? TILE.DOOR : TILE.FLOOR) }
  const t = { instanceId: 'd', worldX: 5.5 * TS, worldY: 5.5 * TS, resources: { hp: 100, maxHp: 100 } }
  // small knockback +x → slides onto the door tile and decays there
  applyKnockback(t, 4.5 * TS, 5.5 * TS, knockbackSpeedFor(t, 12), 0)
  let onDoorEver = false
  for (let i = 0; i < 80 && (t._knockbackUntil ?? 0) > 0; i++) {
    tickKnockback(t, 16, doorGrid, scene, i * 16)
    if (Math.floor(t.worldX / TS) === 6) onDoorEver = true
    if ((t._knockbackUntil ?? 0) === 0) break
  }
  ok(onDoorEver, 'slide passed over the door tile (test is exercising the path)')
  ok(doorGrid.getTileType(Math.floor(t.worldX / TS)) !== TILE.DOOR, 'final resting tile is NOT a door (cleared off the doorway)')
}

// ── 4) No-op when not knocked back ──────────────────────────────────────────
console.log('\n[4] inert when idle')
ok(tickKnockback(tgt(), 16, grid, scene, 5000) === false, 'tickKnockback returns false with no active knockback')

console.log(fails === 0 ? '\n✅ knockback-check: ALL PASS' : `\n❌ knockback-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)

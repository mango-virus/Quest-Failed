// Headless check — findSnap pulls a dragged room onto the center-aligned, 1-gap
// connecting spot relative to a placed room, within SNAP_RADIUS.
//
//   node tools/sim/room-snap-check.mjs

import { DungeonGrid } from '../../src/systems/DungeonGrid.js'

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

const grid = Object.create(DungeonGrid.prototype)
// Placed room A: 16×12 at (20,40). centerX = 27. The aligned SOUTH connecting
// spot for a 16×12 candidate is gridX=20, gridY = 40+12+1 = 53.
const A = { instanceId: 'A', definitionId: 'starter_barracks', gridX: 20, gridY: 40, width: 16, height: 12, connectionPoints: [] }
grid._d = { rooms: [A], traps: [] }
const def = { width: 16, height: 12 }

console.log('\n[1] Near the aligned spot → snaps to it')
{
  const s = grid.findSnap(def, 21, 53)   // 1 tile off in X (within radius 1)
  ok(s && s.gridX === 20 && s.gridY === 53, 'drag at (21,53) snaps to (20,53)')
}

console.log('\n[2] On the aligned spot → idempotent')
{
  const s = grid.findSnap(def, 20, 53)
  ok(s && s.gridX === 20 && s.gridY === 53, 'drag at (20,53) returns (20,53)')
}

console.log('\n[3] Too far → no snap')
{
  ok(grid.findSnap(def, 24, 53) === null, 'drag at (24,53) (4 off) → null')
  ok(grid.findSnap(def, 20, 80) === null, 'drag far below → null')
}

console.log('\n[4] E/W axis snaps too')
{
  const s = grid.findSnap(def, 37, 41)   // 1 tile off in Y (within radius 1)
  ok(s && s.gridX === 37 && s.gridY === 40, 'drag at (37,41) snaps to (37,40) — EAST of A')
  ok(grid.findSnap(def, 37, 44) === null, 'drag at (37,44) (3 off) → null')
}

console.log(fails === 0 ? '\n✅ room-snap-check: ALL PASS' : `\n❌ room-snap-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)

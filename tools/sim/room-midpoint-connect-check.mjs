// Headless check — room MIDPOINT connection rule. Two rooms 1 tile apart connect
// ONLY when their facing walls' center cells coincide (the boss rule, universal).
//
//   node tools/sim/room-midpoint-connect-check.mjs
//
// Drives the REAL DungeonGrid._computeAutoConnectPairs via Object.create (no
// Phaser). A placed room A sits in _d.rooms; a candidate B is tested against it.

import { DungeonGrid } from '../../src/systems/DungeonGrid.js'

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

const grid = Object.create(DungeonGrid.prototype)
// Placed room A: regular, 16×12, top-left (20,40). centerX = 20 + floor((16-2)/2) = 27.
const A = { instanceId: 'A', definitionId: 'starter_barracks', gridX: 20, gridY: 40, width: 16, height: 12, connectionPoints: [] }
grid._d = { rooms: [A], traps: [] }

// Candidate B directly SOUTH of A, 1-gap: B.gridY = A.gridY + A.height + 1 = 53.
const mkB = (gridX) => ({ definitionId: 'starter_barracks', instanceId: 'B', gridX, gridY: 53, width: 16, height: 12, connectionPoints: [] })

console.log('\n[1] Center-aligned rooms connect')
{
  const pairs = grid._computeAutoConnectPairs(mkB(20))   // B.centerX = 27 == A.centerX
  ok(pairs.length === 1 && pairs[0].otherRoom === A, 'aligned (centerX match) → 1 connection to A')
}

console.log('\n[2] Misaligned centers do NOT connect (even though edges overlap)')
{
  ok(grid._computeAutoConnectPairs(mkB(21)).length === 0, 'shifted +1 (centerX 28 ≠ 27) → no connection')
  ok(grid._computeAutoConnectPairs(mkB(19)).length === 0, 'shifted -1 (centerX 26 ≠ 27) → no connection')
}

console.log('\n[3] Wrong gap does not connect')
{
  const touching = { ...mkB(20), gridY: 52 }   // 0-gap: A.bottom(51)+2=53 ≠ 52
  ok(grid._computeAutoConnectPairs(touching).length === 0, 'touching (0-gap) → no auto-connect pair')
}

console.log(fails === 0 ? '\n✅ room-midpoint-connect-check: ALL PASS' : `\n❌ room-midpoint-connect-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)

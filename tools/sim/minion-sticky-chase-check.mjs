// Headless correctness check for STICKY MINION PURSUIT (2026-06-21, by user):
// once a minion aggros (locks onto) an adventurer it must NOT give up chasing,
// across rooms, UNLESS the adv escapes to the entry hall, reaches the boss
// chamber, or a higher-priority target (taunt/brand/retaliation) re-aggros it.
//   node tools/sim/minion-sticky-chase-check.mjs
//
// Drives MinionAISystem._pickTarget directly against a fake 4-room grid:
//   A = home (starter_lair)   B = neighbour (treasure)
//   E = entry_hall            K = boss_chamber
import { boot } from './headless.mjs'
import { MinionAISystem } from '../../src/systems/MinionAISystem.js'

const { scene } = boot({ boss: 'lich' })
scene.time.now = 10000

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

// ── Fake 4-room grid (rooms are 6×6, spaced apart on the x axis) ──
const ROOMS = [
  { instanceId: 'A', definitionId: 'starter_lair', gridX: 0,  gridY: 0, width: 6, height: 6, isActive: true },
  { instanceId: 'B', definitionId: 'treasure',     gridX: 10, gridY: 0, width: 6, height: 6, isActive: true },
  { instanceId: 'E', definitionId: 'entry_hall',   gridX: 20, gridY: 0, width: 6, height: 6, isActive: true },
  { instanceId: 'K', definitionId: 'boss_chamber', gridX: 30, gridY: 0, width: 6, height: 6, isActive: true },
]
const roomAt = (x, y) => ROOMS.find(r => x >= r.gridX && x < r.gridX + r.width && y >= r.gridY && y < r.gridY + r.height) ?? null
const grid = {
  getRoomAtTile: (x, y) => roomAt(x, y),
  getTileType: () => 99,          // never a DOOR tile
  getNeighborRooms: () => [],
}

// ── Entities ──
const mkMinion = (o = {}) => ({
  instanceId: 'm1', definitionId: 'goblin1', class: 'minion', faction: 'dungeon',
  behaviorType: 'roam', assignedRoomId: 'A', tileX: 3, tileY: 3, aiState: 'engaging',
  currentTargetId: null, resources: { hp: 20, maxHp: 20 }, stats: {}, ...o,
})
const mkAdv = (o = {}) => ({
  instanceId: 'a1', classId: 'knight', faction: 'adventurer', aiState: 'idle',
  tileX: 3, tileY: 3, personalityIds: [], flags: {}, resources: { hp: 30, maxHp: 30 }, ...o,
})

const gs = { minions: [], adventurers: { active: [] }, dungeon: { rooms: ROOMS }, _mechanicFlags: {}, run: {} }
const ai = new MinionAISystem(scene, gs, grid, {})
ai._isRoomAlerted  = () => false

// Pick a target after positioning `adv` in (tx,ty). The per-tick adv bucket is
// keyed by the adv's CURRENT room, exactly as MinionAISystem.update() builds it.
function pick(minion, advs) {
  gs.minions = [minion]
  gs.adventurers.active = advs
  const bucket = new Map()
  for (const a of advs) {
    const r = roomAt(a.tileX, a.tileY)
    if (!r) continue
    const arr = bucket.get(r.instanceId)
    if (arr) arr.push(a); else bucket.set(r.instanceId, [a])
  }
  ai._tickAdvsByRoom = bucket
  return ai._pickTarget(minion)
}

const inB = { tileX: 12, tileY: 3 }   // neighbour room
const inE = { tileX: 22, tileY: 3 }   // entry hall (escape)
const inK = { tileX: 32, tileY: 3 }   // boss chamber
const inA = { tileX: 3,  tileY: 3 }   // home room

// 1. LOCKED, adv walked into another room (non-fleeing) → still chased.
{
  const adv = mkAdv({ ...inB, aiState: 'idle' })
  const m = mkMinion({ currentTargetId: 'a1' })
  check('locked non-fleeing adv in a FAR room is still targeted (sticky)', pick(m, [adv]) === adv)
}

// 2. LOCKED, fleeing adv in a far room → still chased.
{
  const adv = mkAdv({ ...inB, aiState: 'fleeing' })
  const m = mkMinion({ currentTargetId: 'a1' })
  check('locked FLEEING adv in a far room is still targeted', pick(m, [adv]) === adv)
}

// 3. LOCKED, NON-fleeing adv reaches the ENTRY HALL → released (it's a fresh
//    arrival / not an escape run; minions don't loiter in the entryway).
{
  const adv = mkAdv({ ...inE })   // default aiState: 'idle'
  const m = mkMinion({ currentTargetId: 'a1' })
  check('lock RELEASED when a NON-fleeing adv is in the entry hall', pick(m, [adv]) === null)
}

// 3b. LOCKED, FLEEING adv reaches the ENTRY HALL → STILL chased (2026-06-22):
//     a minion follows a fleeing adventurer into the entryway to cut off its
//     escape — the one case a minion is allowed to enter the entry hall.
{
  const adv = mkAdv({ ...inE, aiState: 'fleeing' })
  const m = mkMinion({ currentTargetId: 'a1' })
  check('locked FLEEING adv in the entry hall is STILL chased', pick(m, [adv]) === adv)
}

// 4. LOCKED, adv reaches the BOSS CHAMBER → released (boss's fight).
{
  const adv = mkAdv({ ...inK })
  const m = mkMinion({ currentTargetId: 'a1' })
  check('lock RELEASED when the adv reaches the boss chamber', pick(m, [adv]) === null)
}

// 5. NOT locked, adv in a far room → NOT chased (no dungeon-wide stampede).
{
  const adv = mkAdv({ ...inB })
  const m = mkMinion({ currentTargetId: null })
  check('an UN-locked adv in a far room is ignored', pick(m, [adv]) === null)
}

// 6. Normal same-room engage still works (locked or not).
{
  const adv = mkAdv({ ...inA })
  check('un-locked adv in the home room is engaged', pick(mkMinion(), [adv]) === adv)
  check('locked adv in the home room is engaged', pick(mkMinion({ currentTargetId: 'a1' }), [adv]) === adv)
}

// 7. GARRISON minions never chase out of their room (throne mini-bosses stay put).
{
  const adv = mkAdv({ ...inB })
  const m = mkMinion({ class: 'garrison', currentTargetId: 'a1' })
  check('garrison minion does NOT sticky-chase out of its room', pick(m, [adv]) === null)
}

// 8. "Aggroed to someone else": a TAUNTING adv in the home room out-prioritises
//    the locked quarry that ran into another room → minion switches.
{
  const locked = mkAdv({ instanceId: 'a1', ...inB })
  const taunter = mkAdv({ instanceId: 'a2', classId: 'cleric', ...inA, _tauntActiveUntil: 999999 })
  const m = mkMinion({ currentTargetId: 'a1' })
  const got = pick(m, [locked, taunter])
  check('a taunting adv re-aggros a minion off its locked quarry', got === taunter, `got=${got?.instanceId}`)
}

// 9. REGRESSION (2026-06-21): a minion whose OWN ROOM is the entry hall must
//    engage adventurers standing in it. Advs spawn / enter there, and the
//    "escaped to the entry hall" lock-release must NOT fire for the defender's
//    OWN room — before the fix the minion gave up the instant it locked on, so
//    entry-hall defenders ignored every adv in their own room.
{
  const advU = mkAdv({ ...inE })
  check('entry-hall defender engages an UN-locked adv in its own (entry-hall) room',
        pick(mkMinion({ assignedRoomId: 'E', ...inE }), [advU]) === advU)
  const advL = mkAdv({ ...inE })
  check('entry-hall defender keeps a LOCKED adv in its own (entry-hall) room (no premature release)',
        pick(mkMinion({ assignedRoomId: 'E', ...inE, currentTargetId: 'a1' }), [advL]) === advL)
}

// 10. Same guard for a boss-chamber defender (handled by the standing-room
//     early-return, but assert it so the two "own room == release zone" cases
//     stay covered together).
{
  const adv = mkAdv({ ...inK })
  check('boss-chamber defender engages an adv raiding the boss chamber',
        pick(mkMinion({ assignedRoomId: 'K', ...inK, currentTargetId: 'a1' }), [adv]) === adv)
}

console.log(`\nMinion sticky-pursuit check — ${pass}/${pass + fail} passed\n`)
console.log(out.join('\n'))
process.exit(fail ? 1 : 0)

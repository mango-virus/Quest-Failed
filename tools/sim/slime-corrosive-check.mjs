// Headless correctness check for the SLIME · CORROSIVE chain — mechanic: ACID PUDDLES.
//   node tools/sim/slime-corrosive-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { MinionAbilities } from '../../src/systems/MinionAbilities.js'

installGlobals()
const scene = makeScene()
const DEFS = scene.cache.json.get('minionTypes')
const byId = Object.fromEntries(DEFS.map(d => [d.id, d]))

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

let uid = 0
function room() { return { instanceId: 'r1', definitionId: 'starter_barracks', gridX: 0, gridY: 0, width: 12, height: 12 } }
function gs() { return { minions: [], adventurers: { active: [] }, dungeon: { rooms: [room()], hazards: [] }, player: { gold: 0 }, _mechanicFlags: {} } }
function minion(id, over = {}) {
  const d = byId[id], b = d.baseStats
  return {
    instanceId: `m${uid++}`, definitionId: id, color: d.color, tags: [...(d.tags ?? [])],
    tileX: 5, tileY: 5, worldX: 160, worldY: 160, assignedRoomId: 'r1', faction: 'dungeon', aiState: 'fighting',
    stats: { attack: b.attack, defense: b.defense ?? 0, speed: b.speed ?? 1, abilities: [] }, resources: { hp: b.hp, maxHp: b.hp }, ...over,
  }
}
function adv(over = {}) { return { instanceId: `a${uid++}`, classId: 'knight', tileX: 5, tileY: 5, worldX: 160, worldY: 160, assignedRoomId: 'r1', aiState: 'fighting', resources: { hp: 100, maxHp: 100 }, stats: { defense: 6 }, ...over } }
const tick = ms => { scene.time.now += ms }
const acidZones = g => (g.dungeon.hazards ?? []).filter(h => h.element === 'acid')

// T1 Acid Burst — dies, leaving a lingering acid puddle.
{
  const g = gs(); const s = minion('slime4'); g.minions.push(s)
  MinionAbilities.runDeathAbilities(scene, s, g)
  const z = acidZones(g)
  check('T1 death drops an acid puddle', z.length > 0)
  check('T1 puddle deals damage + lingers', z[0] && z[0].dmg > 0 && z[0].expiresAt > scene.time.now)
  check('T1 puddle has NO armor-shred (basic tier)', z[0] && !z[0].armorShred)
}

// T2 Acid Trail — drops a trail hazard when it moves to a new tile.
{
  const g = gs(); const s = minion('slime5'); g.minions.push(s)
  MinionAbilities._hazardTrail(s, scene, g, { type: 'hazardTrail', element: 'acid', dmg: 2, radiusTiles: 0.7, zoneMs: 3500 })
  check('T2 lays a trail puddle on first tile', acidZones(g).length === 1)
  // same tile → no new puddle
  MinionAbilities._hazardTrail(s, scene, g, { type: 'hazardTrail', element: 'acid', dmg: 2 })
  check('T2 does NOT re-drop on the same tile', acidZones(g).length === 1)
  // moved → new puddle
  s.tileX = 6; MinionAbilities._hazardTrail(s, scene, g, { type: 'hazardTrail', element: 'acid', dmg: 2 })
  check('T2 lays a new puddle after moving', acidZones(g).length === 2)
}

// T3 Corrosive — standing in the puddle melts armor + slows the hero.
{
  const g = gs(); const s = minion('slime6'); g.minions.push(s)
  const a = adv({ tileX: 5, tileY: 5 }); g.adventurers.active.push(a)
  // drop a corrosive trail puddle under the hero
  MinionAbilities._hazardTrail(s, scene, g, { type: 'hazardTrail', element: 'acid', dmg: 3, radiusTiles: 0.8, zoneMs: 4500, armorShred: 2, armorShredMax: 8, slow: 0.6 })
  tick(1000); MinionAbilities.tickHazards(scene, g, 1000)
  check('T3 acid melts the standing hero\'s armor', (a._armorShred ?? 0) > 0, `shred=${a._armorShred}`)
  check('T3 armorShredOf reports the shred', MinionAbilities.armorShredOf(a, scene.time.now) > 0)
  check('T3 acid slows the standing hero', MinionAbilities.slowMult(a, scene.time.now) < 1, `slow=${a._slowMult}`)
  check('T3 acid still deals damage', a.resources.hp < 100)
}

// T4 Acid Flood — floods the whole room with acid puddles.
{
  const g = gs(); const s = minion('elder_slime3'); g.minions.push(s)
  MinionAbilities._acidFlood(s, scene, g, { type: 'acidFlood', dmg: 4, floodMs: 4500, armorShred: 2, slow: 0.6 })
  check('T4 flood blankets the room in many puddles', acidZones(g).length >= 10, `n=${acidZones(g).length}`)
  check('T4 flood puddles carry armor-shred', acidZones(g).every(h => h.armorShred > 0))
}

// Control — a non-acid minion (splitter) does NOT drop acid on death.
{
  const g = gs(); const s = minion('slime2'); g.minions.push(s)
  MinionAbilities.runDeathAbilities(scene, s, g)
  check('Splitter death drops NO acid puddle', acidZones(g).length === 0)
}

// Data wiring — every Corrosive tier carries an acid ability.
for (const id of ['slime4', 'slime5', 'slime6', 'elder_slime3']) {
  const abs = byId[id].abilities ?? []
  check(`${id} has an acid ability wired`, abs.some(a => ['acidPool', 'hazardTrail', 'acidFlood'].includes(a.type)))
}

console.log('\nSlime · Corrosive — ACID PUDDLES kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

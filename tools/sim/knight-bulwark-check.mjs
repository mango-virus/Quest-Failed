// Headless effect-test for the Knight Bulwark (directional shield-wall). The ally
// is sheltered only when the Knight stands toward the threat AND is at least as
// forward as the ally; attacking from another side bypasses it.
//   node tools/sim/knight-bulwark-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { CombatSystem } from '../../src/systems/CombatSystem.js'

installGlobals()
const scene = makeScene()
if (scene.time) scene.time.now = 100000
const now = scene.time.now

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

let uid = 0
const ent = (over) => ({ instanceId: `e${uid++}`, tileX: 0, tileY: 0, aiState: 'fighting', resources: { hp: 50, maxHp: 50 }, ...over })
const BASE = 20            // base damage; reduced = floor(20 * 0.65) = 13
const REDUCED = 13

// Threat comes from the NORTH (attacker above the ally).
const attacker = ent({ classId: undefined, faction: 'dungeon', tileX: 10, tileY: 6 })
const ally     = ent({ classId: 'monk', partyId: 'P', tileX: 10, tileY: 10 })

function run(knight) {
  const gs = { adventurers: { active: [knight, ally] }, minions: [attacker], player: {}, _mechanicFlags: {} }
  const cb = new CombatSystem(scene, gs)
  return cb._applyBulwark(attacker, ally, BASE)
}

// A. Knight BETWEEN attacker and ally → ally sheltered.
{
  const k = ent({ classId: 'knight', partyId: 'P', tileX: 10, tileY: 8, _auraActiveUntil: now + 5000 })
  check('sheltered: Knight between threat and ally reduces damage', run(k) === REDUCED, `dmg=${run(k)}`)
}
// B. Knight on the FAR side (behind the ally, away from the threat) → NOT sheltered.
{
  const k = ent({ classId: 'knight', partyId: 'P', tileX: 10, tileY: 12, _auraActiveUntil: now + 5000 })
  check('exposed: Knight covering the wrong side does NOT reduce', run(k) === BASE, `dmg=${run(k)}`)
}
// C. The Knight himself is always the wall.
{
  const k = ent({ classId: 'knight', partyId: 'P', tileX: 10, tileY: 8, _auraActiveUntil: now + 5000 })
  const gs = { adventurers: { active: [k, ally] }, minions: [attacker], player: {}, _mechanicFlags: {} }
  const cb = new CombatSystem(scene, gs)
  check('self: the Knight always shelters himself', cb._applyBulwark(attacker, k, BASE) === REDUCED, `dmg=${cb._applyBulwark(attacker, k, BASE)}`)
}
// D. Knight out of range → no shelter.
{
  const k = ent({ classId: 'knight', partyId: 'P', tileX: 20, tileY: 20, _auraActiveUntil: now + 5000 })
  check('range: a far Knight does NOT shelter', run(k) === BASE, `dmg=${run(k)}`)
}
// E. Stance down → no shelter even if positioned right.
{
  const k = ent({ classId: 'knight', partyId: 'P', tileX: 10, tileY: 8, _auraActiveUntil: 0 })
  check('inactive: no shelter when Bulwark is down', run(k) === BASE, `dmg=${run(k)}`)
}

console.log('\nKnight Bulwark (directional shield-wall) checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

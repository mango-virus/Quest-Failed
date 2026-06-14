// Headless effect-test for the Ranger Piercing Shot: every 5th arrow becomes a
// line shot that pierces minions along the ranger→target ray (and spares those
// off the line).
//   node tools/sim/ranger-pierce-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { CombatSystem } from '../../src/systems/CombatSystem.js'

installGlobals()
const scene = makeScene()
scene.dungeonGrid = null          // skip the chainable-proxy same-room gate
if (scene.time) scene.time.now = 100000

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

let uid = 0
const TS = 32
const w = (t) => t * TS + 16
function minion(tx, ty) {
  return { instanceId: `m${uid++}`, definitionId: 'goblin1', faction: 'dungeon', aiState: 'idle',
    tileX: tx, tileY: ty, worldX: w(tx), worldY: w(ty), resources: { hp: 60, maxHp: 60 }, stats: { attack: 5, defense: 0, speed: 1 } }
}

const ranger = {
  instanceId: 'r1', classId: 'ranger', tileX: 5, tileY: 6, worldX: w(5), worldY: w(6),
  resources: { hp: 35, maxHp: 35 }, stats: { attack: 12, defense: 3, speed: 1 },
  attackRange: 4, lastAttackAt: 0, _shotCount: 4,   // next shot is the 5th → pierces
}
const primary  = minion(8, 6)   // the shot's target (along the +x ray, in range)
const between  = minion(6, 6)   // between ranger and primary, on the line → pierced
const beyond   = minion(10, 6)  // past the primary, within pierce range → pierced
const offline  = minion(6, 8)   // 2 tiles off the ray → spared

const gs = { adventurers: { active: [ranger] }, minions: [primary, between, beyond, offline], player: { gold: 0 }, _mechanicFlags: {} }
const cb = new CombatSystem(scene, gs)

const hp = { primary: primary.resources.hp, between: between.resources.hp, beyond: beyond.resources.hp, offline: offline.resources.hp }
const res = cb.tryAttack(ranger, primary)

check('the shot lands on the primary target', res && primary.resources.hp < hp.primary, `res=${JSON.stringify(res)} primary ${hp.primary}->${primary.resources.hp}`)
check('pierces a minion BETWEEN ranger and target', between.resources.hp < hp.between, `${hp.between}->${between.resources.hp}`)
check('pierces a minion BEYOND the target (in a row)', beyond.resources.hp < hp.beyond, `${hp.beyond}->${beyond.resources.hp}`)
check('spares a minion OFF the line', offline.resources.hp === hp.offline, `${hp.offline}->${offline.resources.hp}`)

console.log('\nRanger Piercing Shot check\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

// Headless effect-test for the Monk Riposte counter. Forces a dodge (stubbed RNG)
// and asserts the dodge negates the hit AND counter-strikes the attacker.
//   node tools/sim/monk-riposte-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { CombatSystem } from '../../src/systems/CombatSystem.js'

installGlobals()
const scene = makeScene()
// Advance the headless clock so attackers aren't treated as on-cooldown (now - 0).
if (scene.time) scene.time.now = 100000
// Drop the chainable-proxy grid so the same-room gate is skipped (its proxy
// getRoomAtTile returns two distinct objects → a false room mismatch → null).
scene.dungeonGrid = null
const now = scene.time?.now ?? 0
const TS = 32

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

const monk = {
  instanceId: 'monk1', classId: 'monk', tileX: 6, tileY: 6, worldX: 6 * TS + 16, worldY: 6 * TS + 16,
  resources: { hp: 32, maxHp: 32 }, stats: { attack: 8, defense: 2, speed: 1 },
  _focusActiveUntil: now + 5000, attackRange: 1,
}
const goblin = {
  instanceId: 'g1', definitionId: 'goblin1', faction: 'dungeon', aiState: 'engaging',
  tileX: 6, tileY: 7, worldX: 6 * TS + 16, worldY: 7 * TS + 16,
  resources: { hp: 40, maxHp: 40 }, stats: { attack: 6, defense: 2, speed: 1 },
  attackRange: 1, damageType: 'physical', lastAttackAt: 0,
}
const gs = { adventurers: { active: [monk] }, minions: [goblin], player: { gold: 0 }, _mechanicFlags: {} }
const cb = new CombatSystem(scene, gs)

// Force the 30% dodge roll to always succeed.
const realRandom = Math.random
Math.random = () => 0

const monkHpBefore = monk.resources.hp
const gobHpBefore = goblin.resources.hp
const res = cb.tryAttack(goblin, monk)   // goblin swings at the monk

Math.random = realRandom

check('riposte: the hit is dodged (no monk HP lost)', monk.resources.hp === monkHpBefore, `monk ${monkHpBefore}->${monk.resources.hp}, res=${JSON.stringify(res)}`)
// counter = max(1, floor(8 * 0.8) - goblin.def 2) = max(1, 6 - 2) = 4
check('riposte: counter-strikes the attacker', goblin.resources.hp < gobHpBefore, `goblin ${gobHpBefore}->${goblin.resources.hp}`)
check('riposte: counter damage is the expected ~4', gobHpBefore - goblin.resources.hp === 4, `dealt ${gobHpBefore - goblin.resources.hp}`)

console.log('\nMonk Riposte counter check\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

// Headless check for the VFX Lab's adventurer-ability force-fire path
// (ClassAbilitySystem.devFireAbility). Confirms each class's abilities actually
// fire (emit ABILITY_TRIGGERED) when the lab's fake arena conditions are met.
//   node tools/sim/class-ability-fire-check.mjs
import { makeScene, installGlobals, EventBus } from './headless.mjs'
import { ClassAbilitySystem, CLASS_ABILITIES, ABILITY_DEFS } from '../../src/systems/ClassAbilitySystem.js'

installGlobals()
const scene = makeScene()

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

let uid = 0
function room() { return { instanceId: 'r1', definitionId: 'starter_barracks', gridX: 0, gridY: 0, width: 12, height: 12 } }
function adv(classId, over = {}) {
  return {
    instanceId: `a${uid++}`, classId, name: classId, level: 3, partyId: '__vfxlab',
    tileX: 6, tileY: 6, worldX: 200, worldY: 200, assignedRoomId: 'r1', aiState: 'fighting',
    resources: { hp: 100, maxHp: 100 }, stats: { attack: 10, speed: 1 }, cooldowns: {}, usesLeftToday: {},
    ...over,
  }
}
function hostileMinion() {
  return {
    instanceId: `m${uid++}`, definitionId: 'goblin1', faction: 'dungeon', aiState: 'idle',
    tileX: 5, tileY: 6, worldX: 168, worldY: 200, assignedRoomId: 'r1', tags: ['goblin'],
    resources: { hp: 30, maxHp: 30 }, stats: { attack: 5, defense: 2, speed: 1 },
  }
}
function woundedAlly() { return adv('knight', { resources: { hp: 30, maxHp: 100 }, tileX: 7, tileY: 6 }) }
function fallenAlly()  { return adv('knight', { resources: { hp: 0, maxHp: 100 }, aiState: 'dead', tileX: 8, tileY: 6 }) }

// Fire one class's ability through the real arena + devFireAbility, and assert
// ABILITY_TRIGGERED fired for it.
function fireOne(classId, key) {
  const gs = {
    adventurers: { active: [] }, minions: [hostileMinion()],
    dungeon: { rooms: [room()] }, player: { gold: 0 }, _mechanicFlags: {},
  }
  const hero = adv(classId)
  gs.adventurers.active.push(hero, woundedAlly(), fallenAlly())
  const cas = new ClassAbilitySystem(scene, gs)
  let firedId = null
  const onTrig = (p) => { firedId = p?.abilityId }
  EventBus.on('ABILITY_TRIGGERED', onTrig)
  const ok = cas.devFireAbility(hero, key, 1000)
  EventBus.off('ABILITY_TRIGGERED', onTrig)
  return { ok, firedId, expectedId: ABILITY_DEFS[key]?.id }
}

// Spot-check the headline active abilities across classes.
const TESTS = [
  ['mage', 'mage_arcane_burst'],
  ['cleric', 'cleric_heal'],
  ['knight', 'knight_aura'],
  ['knight', 'knight_taunt'],
  ['necromancer', 'necro_summon'],
  ['rogue', 'rogue_invisibility'],
  ['bard', 'bard_inspire'],
  ['monk', 'monk_focus'],
]
for (const [cls, key] of TESTS) {
  const r = fireOne(cls, key)
  check(`${cls} → ${key} fires (ABILITY_TRIGGERED=${r.expectedId})`, r.firedId === r.expectedId, `got '${r.firedId}', dispatch=${r.ok}`)
}

// Coverage: every class with a _consider method should have ≥1 ability listed.
const considerClasses = ['knight', 'bard', 'monk', 'cleric', 'mage', 'necromancer', 'ranger', 'beast_master', 'barbarian', 'rogue', 'cheater', 'gladiator', 'peasant', 'valkyrie', 'miner']
for (const c of considerClasses) check(`${c} has abilities listed`, (CLASS_ABILITIES[c] ?? []).length > 0, `${(CLASS_ABILITIES[c] ?? []).length}`)

console.log('\nClass-ability force-fire checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

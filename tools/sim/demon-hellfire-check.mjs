// Headless correctness check for the DEMON chain — mechanic: HELLFIRE / IMMOLATION.
//   node tools/sim/demon-hellfire-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { MinionAbilities } from '../../src/systems/MinionAbilities.js'

installGlobals()
const scene = makeScene()
const DEFS = scene.cache.json.get('minionTypes')
const byId = Object.fromEntries(DEFS.map(d => [d.id, d]))

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

let uid = 0
function room() { return { instanceId: 'r1', definitionId: 'lair', gridX: 0, gridY: 0, width: 12, height: 12 } }
function gs() { return { minions: [], adventurers: { active: [], graveyard: [] }, dungeon: { rooms: [room()], hazards: [] }, player: {}, boss: { level: 4 }, _mechanicFlags: {} } }
function demon(id, over = {}) {
  const d = byId[id], b = d.baseStats
  return { instanceId: `m${uid++}`, definitionId: id, tags: [...(d.tags ?? [])], tileX: 6, tileY: 6, worldX: 192, worldY: 192, assignedRoomId: 'r1', faction: 'dungeon', aiState: 'fighting', stats: { attack: b.attack, defense: b.defense, speed: b.speed }, resources: { hp: b.hp, maxHp: b.hp }, ...over }
}
function adv(over = {}) { return { instanceId: `a${uid++}`, classId: 'knight', tileX: 6, tileY: 6, worldX: 192, worldY: 192, assignedRoomId: 'r1', aiState: 'fighting', resources: { hp: 100, maxHp: 100 }, ...over } }
const auraOf = id => (byId[id].abilities ?? []).find(a => a.type === 'burningAura')

// T1 Burning Aura — a nearby hero takes escalating fire damage; far hero is safe.
{
  const g = gs(); const d = demon('demon1'); const near = adv({ tileX: 7, tileY: 6 }); const far = adv({ tileX: 11, tileY: 11 })
  g.minions.push(d); g.adventurers.active.push(near, far)
  const ab = auraOf('demon1')
  MinionAbilities._burningAura(d, scene, g, ab)
  check('T1 aura burns a NEARBY hero', near.resources.hp < 100 && (near._hellfireStacks ?? 0) === 1, `hp=${near.resources.hp} st=${near._hellfireStacks}`)
  check('T1 aura does NOT reach a far hero', far.resources.hp === 100 && !far._hellfireStacks)
  // damage escalates as heat builds
  const hp1 = near.resources.hp; MinionAbilities._burningAura(d, scene, g, ab)
  const dmg2 = hp1 - near.resources.hp; const dmg1 = 100 - hp1
  check('T1 burn ESCALATES with heat', dmg2 > dmg1, `dmg1=${dmg1} dmg2=${dmg2}`)
  check('T1 heat stacks are capped', (() => { for (let i = 0; i < 12; i++) MinionAbilities._burningAura(d, scene, g, ab); return near._hellfireStacks === ab.maxStacks })(), `st=${near._hellfireStacks}`)
}

// Heat COOLS when a hero leaves the aura (tickDemon).
{
  const g = gs(); const d = demon('demon1'); const a = adv({ tileX: 7, tileY: 6, _hellfireStacks: 4, _hellfireAt: 0 })
  g.minions.push(d); g.adventurers.active.push(a)
  scene.time.now += 2000   // > 1400ms since last stack
  MinionAbilities.tickDemon(scene, g)
  check('heat decays when out of the aura', a._hellfireStacks === 3, `st=${a._hellfireStacks}`)
}

// T2 Combustion — a hero at MAX heat detonates, hitting a neighbour, then resets.
{
  const g = gs(); const d = demon('demon2'); const ab = auraOf('demon2')
  const hot = adv({ tileX: 6, tileY: 6, _hellfireStacks: ab.maxStacks - 1 }); const neighbour = adv({ tileX: 7, tileY: 6 })
  g.minions.push(d); g.adventurers.active.push(hot, neighbour)
  MinionAbilities._burningAura(d, scene, g, ab)   // hot reaches max → combust
  check('T2 max-heat hero COMBUSTS (heat resets)', hot._hellfireStacks === 0, `st=${hot._hellfireStacks}`)
  check('T2 combustion blasts a nearby hero', neighbour.resources.hp < 100, `hp=${neighbour.resources.hp}`)
}
// T1 does NOT combust (no combust flag).
{
  const g = gs(); const d = demon('demon1'); const ab = auraOf('demon1')
  const hot = adv({ tileX: 6, tileY: 6, _hellfireStacks: ab.maxStacks - 1 }); g.minions.push(d); g.adventurers.active.push(hot)
  MinionAbilities._burningAura(d, scene, g, ab)
  check('T1 does NOT combust (no flag) — heat holds at max', hot._hellfireStacks === ab.maxStacks)
}

// T3 Inferno — every hero in the room burns + maxes out, even far ones.
{
  const g = gs(); const d = demon('demon_lord'); g.minions.push(d)
  const advs = [adv({ tileX: 2, tileY: 2 }), adv({ tileX: 10, tileY: 10 }), adv({ tileX: 6, tileY: 6 })]
  g.adventurers.active.push(...advs)
  MinionAbilities._inferno(d, scene, g, { type: 'inferno', dmg: 6, maxStacks: 6 })
  check('T3 Inferno burns EVERY hero in the room', advs.every(a => a.resources.hp < 100))
  check('T3 Inferno maxes everyone\'s heat', advs.every(a => a._hellfireStacks === 6))
}

// Data wiring.
for (const id of ['demon1', 'demon2', 'demon_lord']) check(`${id} has a burning aura`, (byId[id].abilities ?? []).some(a => a.type === 'burningAura'))
check('demon2 has Combustion (combust flag)', auraOf('demon2')?.combust === true)
check('demon_lord has the Inferno ult', (byId['demon_lord'].abilities ?? []).some(a => a.type === 'inferno'))

console.log('\nDemon — HELLFIRE kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

// Headless correctness check for the VAMPIRE chain — mechanic: LIFE DRAIN.
//   node tools/sim/vampire-drain-check.mjs
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

// T1 Lifesteal — a hit heals the vampire by a share of damage dealt.
{
  const g = gs(); const v = minion('vampire_minion1', { resources: { hp: 20, maxHp: 44 } }); const a = adv()
  g.minions.push(v); g.adventurers.active.push(a)
  MinionAbilities.onHit(scene, v, a, 10, g)
  check('T1 lifesteal heals the vampire on hit', v.resources.hp > 20, `hp=${v.resources.hp}`)
  check('T1 does NOT bank a blood-shield (no overheal)', (v._bloodShield ?? 0) === 0)
}

// T2 Bloodgorge — at full HP, overheal banks as a blood-shield (capped).
{
  const g = gs(); const v = minion('vampire_minion2'); const a = adv()   // full HP
  g.minions.push(v); g.adventurers.active.push(a)
  MinionAbilities.onHit(scene, v, a, 30, g)
  check('T2 overheal banks a blood-shield', (v._bloodShield ?? 0) > 0, `shield=${v._bloodShield}`)
  const cap = Math.ceil(v.resources.maxHp * 0.6)
  // hammer many hits — shield must not exceed the cap
  for (let i = 0; i < 20; i++) MinionAbilities.onHit(scene, v, a, 40, g)
  check('T2 blood-shield is capped at shieldFracMax×maxHP', v._bloodShield <= cap, `shield=${v._bloodShield} cap=${cap}`)
}

// Blood-shield ABSORBS damage before HP, then decays (temporary).
{
  const g = gs(); const v = minion('vampire_minion2', { _bloodShield: 12, _bloodShieldAt: scene.time.now })
  const rem = MinionAbilities.absorbBloodShield(v, 8, scene)
  check('shield absorbs damage before HP', rem === 0 && v._bloodShield === 4, `rem=${rem} shield=${v._bloodShield}`)
  const rem2 = MinionAbilities.absorbBloodShield(v, 10, scene)
  check('overflow damage passes through once shield is gone', rem2 === 6 && v._bloodShield === 0, `rem2=${rem2}`)
  // decay
  g.minions.push(v)
  v._bloodShield = 50; v._bloodShieldAt = scene.time.now
  tick(2000); const before = v._bloodShield
  MinionAbilities.tickVampire(scene, g, 1000)
  check('blood-shield decays over time (temporary)', v._bloodShield < before, `before=${before} after=${v._bloodShield}`)
}

// T3 Blood Feast — drains EVERY hero in the room, heals self→shield, tops kin.
{
  const g = gs(); const v = minion('vampire_sovereign', { resources: { hp: 100, maxHp: 105 } })
  const kin = minion('vampire_minion1', { resources: { hp: 20, maxHp: 44 } })
  const a1 = adv({ tileX: 4, tileY: 4 }), a2 = adv({ tileX: 8, tileY: 8 }), far = adv({ tileX: 20, tileY: 20, assignedRoomId: 'other' })
  g.minions.push(v, kin); g.adventurers.active.push(a1, a2, far)
  const ab = { type: 'bloodFeast', drainPerAdv: 6, shieldFracMax: 0.8 }
  MinionAbilities._bloodFeast(v, scene, g, ab)
  check('T3 feast drains every hero in the room', a1.resources.hp < 100 && a2.resources.hp < 100)
  check('T3 feast does NOT reach a hero in another room', far.resources.hp === 100)
  check('T3 feast gorges the vampire to an overflow shield', (v._bloodShield ?? 0) > 0, `shield=${v._bloodShield}`)
  check('T3 feast tops up vampire-kin', kin.resources.hp > 20, `kin=${kin.resources.hp}`)
}

// Control — a non-vampire hit neither lifesteals nor shields.
{
  const g = gs(); const m = minion('skeleton1', { resources: { hp: 10, maxHp: 30 } }); const a = adv()
  g.minions.push(m); g.adventurers.active.push(a)
  MinionAbilities.onHit(scene, m, a, 10, g)
  check('Non-vampire does not lifesteal/shield', m.resources.hp === 10 && (m._bloodShield ?? 0) === 0)
}

// Data wiring — every vampire tier carries a lifesteal/feast ability.
for (const id of ['vampire_minion1', 'vampire_minion2', 'vampire_sovereign']) {
  const abs = byId[id].abilities ?? []
  check(`${id} has a drain ability wired`, abs.some(a => ['lifesteal', 'bloodFeast'].includes(a.type)))
}

console.log('\nVampire — LIFE DRAIN kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

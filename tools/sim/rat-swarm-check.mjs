// Headless correctness check for the RAT chain — mechanic: SWARM (strength in numbers).
//   node tools/sim/rat-swarm-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { MinionAbilities } from '../../src/systems/MinionAbilities.js'

installGlobals()
const scene = makeScene()
const DEFS = scene.cache.json.get('minionTypes')
const byId = Object.fromEntries(DEFS.map(d => [d.id, d]))

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }
const near = (a, b, e = 0.001) => Math.abs(a - b) < e

let uid = 0
function gs() { return { minions: [], adventurers: { active: [] }, dungeon: { rooms: [] }, player: { gold: 0 }, _mechanicFlags: {} } }
function rat(id, room = 'r1', over = {}) {
  const d = byId[id], b = d.baseStats
  return {
    instanceId: `m${uid++}`, definitionId: id, color: d.color, tags: [...(d.tags ?? [])],
    tileX: 5, tileY: 5, worldX: 160, worldY: 160, assignedRoomId: room, faction: 'dungeon', aiState: 'fighting',
    stats: { attack: b.attack, defense: b.defense ?? 0, speed: b.speed ?? 1, abilities: [] }, resources: { hp: b.hp, maxHp: b.hp }, ...over,
  }
}
function pack(id, count, room = 'r1', g) { const arr = []; for (let i = 0; i < count; i++) { const m = rat(id, room); g.minions.push(m); arr.push(m) } return arr }

// T1 Swarm — alone = no bonus; in a pack = +atk per other rat.
{
  const g = gs(); const [r] = pack('rat1', 1, 'r1', g)
  check('T1 alone gets NO swarm bonus', near(MinionAbilities.swarmAtkMul(r, scene, g), 1), `mul=${MinionAbilities.swarmAtkMul(r, scene, g)}`)
}
{
  const g = gs(); const rats = pack('rat1', 3, 'r1', g)
  const mul = MinionAbilities.swarmAtkMul(rats[0], scene, g)
  check('T1 pack of 3 = +24% atk (2 stacks × 0.12)', near(mul, 1.24), `mul=${mul}`)
}
// swarm counts ONLY same-room rats.
{
  const g = gs(); const [r] = pack('rat1', 1, 'r1', g); pack('rat1', 4, 'other', g)
  check('swarm ignores rats in another room', near(MinionAbilities.swarmAtkMul(r, scene, g), 1))
}
// T1 has NO pack armor.
{
  const g = gs(); const rats = pack('rat1', 4, 'r1', g)
  check('T1 has no Pack Armor (DR mul = 1)', near(MinionAbilities.swarmDrMul(rats[0], scene, g), 1))
}

// T2 Pack Armor — clustered rats take less damage; reflected in damageTakenMul.
{
  const g = gs(); const rats = pack('rat2', 4, 'r1', g)
  const dr = MinionAbilities.swarmDrMul(rats[0], scene, g)
  check('T2 pack of 4 reduces damage (3 stacks × 0.05 → 0.85)', near(dr, 0.85), `dr=${dr}`)
  const att = { damageType: 'physical' }
  const dtm = MinionAbilities.damageTakenMul(rats[0], att, g, scene)
  check('T2 Pack Armor flows through damageTakenMul', dtm < 1, `dtm=${dtm}`)
}
// DR is floored — a huge pack is tanky, never invincible.
{
  const g = gs(); const rats = pack('rat2', 30, 'r1', g)
  check('Pack Armor is floored (never below 0.35)', MinionAbilities.swarmDrMul(rats[0], scene, g) >= 0.35)
}

// T3 Vermin Tide — frenzy every rat in the room + speed surge.
{
  const g = gs(); const lord = rat('rat3', 'r1'); g.minions.push(lord)
  const minions = pack('rat1', 3, 'r1', g)
  g.dungeon.rooms.push({ instanceId: 'r1', gridX: 0, gridY: 0, width: 12, height: 12 })
  const baseSpeed = lord.stats.speed
  MinionAbilities._verminTide(lord, scene, g, { type: 'verminTide', frenzyMs: 4000, speedMul: 1.4 })
  check('Vermin Tide frenzies every rat in the room', minions.every(m => (m._swarmFrenzyUntil ?? 0) > scene.time.now) && lord._swarmFrenzyUntil > scene.time.now)
  check('Vermin Tide surges speed (×1.4)', near(lord.stats.speed, baseSpeed * 1.4), `spd=${lord.stats.speed}`)
  // during frenzy a rat fights at MAX swarm stacks regardless of live count
  const lone = rat('rat1', 'solo'); g.minions.push(lone); lone._swarmFrenzyUntil = scene.time.now + 2000
  const mul = MinionAbilities.swarmAtkMul(lone, scene, g)
  // frenzy = MAX stacks (cap 6 × 0.12 = +72%) + the default frenzy punch (+0.2) = 1.92
  check('frenzied rat uses MAX swarm stacks + frenzy punch', near(mul, 1.92), `mul=${mul}`)
  // tickRat restores speed once the frenzy window passes
  scene.time.now += 5000
  MinionAbilities.tickRat(scene, g)
  check('tickRat restores base speed after the frenzy ends', near(lord.stats.speed, baseSpeed), `spd=${lord.stats.speed}`)
}

// Control — a non-swarm minion gets no swarm atk/DR.
{
  const g = gs(); const s = rat('skeleton1', 'r1'); g.minions.push(s); pack('rat1', 3, 'r1', g)
  check('Non-swarm minion gets no swarm bonus', near(MinionAbilities.swarmAtkMul(s, scene, g), 1) && near(MinionAbilities.swarmDrMul(s, scene, g), 1))
}

// Data wiring.
for (const id of ['rat1', 'rat2', 'rat3']) check(`${id} has a swarm ability`, (byId[id].abilities ?? []).some(a => a.type === 'swarm'))
check('rat3 has the Vermin Tide ult', (byId['rat3'].abilities ?? []).some(a => a.type === 'verminTide'))

console.log('\nRat — SWARM kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

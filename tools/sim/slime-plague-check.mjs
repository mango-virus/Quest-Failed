// Headless correctness check for the SLIME · PLAGUE chain — mechanic: CONTAGION.
//   node tools/sim/slime-plague-check.mjs
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
function adv(over = {}) { return { instanceId: `a${uid++}`, classId: 'knight', tileX: 5, tileY: 5, worldX: 160, worldY: 160, assignedRoomId: 'r1', aiState: 'fighting', resources: { hp: 100, maxHp: 100 }, ...over } }
const tick = ms => { scene.time.now += ms }
const infected = (a) => (a._infectUntil ?? 0) > scene.time.now

// T1 Infect — a hit applies a poison DoT + infection marker; the DoT damages over time.
{
  const g = gs(); const s = minion('slime3'); const a = adv(); g.minions.push(s); g.adventurers.active.push(a)
  MinionAbilities.onHit(scene, s, a, 5, g)
  check('T1 hit infects the hero', infected(a) && (a._dot?.length > 0))
  const hp0 = a.resources.hp
  tick(1600); MinionAbilities.tickEntity(a, scene, 1600)
  check('T1 infection ticks poison damage', a.resources.hp < hp0, `dmg=${hp0 - a.resources.hp}`)
}

// T2 Contagion — an infected hero spreads to a nearby uninfected ally (not a far one).
{
  const g = gs(); const s = minion('slime7'); g.minions.push(s)
  const a1 = adv({ tileX: 5, tileY: 5 }), a2 = adv({ tileX: 6, tileY: 5 }), a3 = adv({ tileX: 11, tileY: 11 })
  g.adventurers.active.push(a1, a2, a3)
  MinionAbilities._infect(scene, s, a1, { dmgPerTick: 2, intervalMs: 1500, ticks: 4 })
  MinionAbilities._contagion(s, scene, g, { type: 'contagion', spreadRadiusTiles: 3, maxSpread: 3 })
  check('T2 contagion spreads to a nearby ally', infected(a2))
  check('T2 contagion does NOT reach a far ally', !infected(a3))
}

// T3 Toxic trail — an infected hero drops a poison hazard.
{
  const g = gs(); const s = minion('slime8'); g.minions.push(s)
  const a1 = adv({ tileX: 5, tileY: 5 }); g.adventurers.active.push(a1)
  MinionAbilities._infect(scene, s, a1, { dmgPerTick: 3, intervalMs: 1200, ticks: 5 })
  MinionAbilities._contagion(s, scene, g, { type: 'contagion', spreadRadiusTiles: 4, maxSpread: 4, trail: true, trailDmg: 1, trailMs: 2000 })
  check('T3 infected hero drops a toxic trail hazard', (g.dungeon.hazards?.length ?? 0) > 0)
}

// T4 Outbreak — infects EVERY hero in the room at once.
{
  const g = gs(); const s = minion('elder_slime1'); g.minions.push(s)
  const advs = [adv({ tileX: 3, tileY: 3 }), adv({ tileX: 7, tileY: 7 }), adv({ tileX: 9, tileY: 2 })]
  g.adventurers.active.push(...advs)
  MinionAbilities._outbreak(s, scene, g, { type: 'outbreak', dotDmg: 3, dotIntervalMs: 1200, dotTicks: 5, radius: 120 })
  check('T4 outbreak infects every hero in the room', advs.every(infected))
}

// Control — a non-plague minion doesn't infect.
{
  const g = gs(); const s = minion('skeleton1'); const a = adv(); g.minions.push(s); g.adventurers.active.push(a)
  MinionAbilities.onHit(scene, s, a, 5, g)
  check('Non-plague does not infect', !infected(a))
}

console.log('\nSlime · Plague — CONTAGION kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

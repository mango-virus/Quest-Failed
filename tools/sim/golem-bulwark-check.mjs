// Headless correctness check for the GOLEM chain — mechanic: FORTRESS / BULWARK.
//   node tools/sim/golem-bulwark-check.mjs
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
function room() { return { instanceId: 'r1', definitionId: 'vault', gridX: 0, gridY: 0, width: 12, height: 12 } }
function gs() { return { minions: [], adventurers: { active: [] }, dungeon: { rooms: [room()] }, player: {}, boss: { level: 4 }, _mechanicFlags: {} } }
function minion(id, over = {}) {
  const d = byId[id], b = d.baseStats
  return { instanceId: `m${uid++}`, definitionId: id, tags: [...(d.tags ?? [])], tileX: 5, tileY: 5, worldX: 160, worldY: 160, assignedRoomId: 'r1', faction: 'dungeon', aiState: 'fighting', stats: { attack: b.attack, defense: b.defense, speed: b.speed }, resources: { hp: b.hp, maxHp: b.hp }, ...over }
}
const adv = { damageType: 'physical', faction: 'adventurer' }
const dtm = (t, g) => MinionAbilities.damageTakenMul(t, adv, g, scene)

// T1 Bulwark — the golem itself takes reduced damage.
{
  const g = gs(); const golem = minion('golem1'); g.minions.push(golem)
  check('T1 golem takes reduced damage (self DR)', dtm(golem, g) < 1, `mul=${dtm(golem, g)}`)
}

// T2 Aegis — an ally NEAR the guardian golem takes reduced damage; a FAR ally doesn't.
{
  const g = gs(); const golem = minion('golem2', { tileX: 5, tileY: 5 })
  const near1 = minion('skeleton1', { tileX: 6, tileY: 5 }), far = minion('skeleton1', { tileX: 11, tileY: 11 })
  g.minions.push(golem, near1, far)
  check('T2 ally near the golem is shielded (aegis)', dtm(near1, g) < 1, `mul=${dtm(near1, g)}`)
  check('T2 ally far from the golem is NOT shielded', near(dtm(far, g), 1), `mul=${dtm(far, g)}`)
}
// Aegis does not protect adventurers / enemies.
{
  const g = gs(); const golem = minion('golem2'); g.minions.push(golem)
  check('aegisMul ignores adventurer-faction targets', near(MinionAbilities.aegisMul({ faction: 'adventurer', assignedRoomId: 'r1', tileX: 5, tileY: 5 }, scene, g), 1))
}
// Strongest guardian wins (two auras → the lower mult applies).
{
  const g = gs(); const a = minion('golem2', { tileX: 5, tileY: 5 }), b = minion('golem_warden', { tileX: 6, tileY: 5 })
  const ally = minion('skeleton1', { tileX: 5, tileY: 5 }); g.minions.push(a, b, ally)
  check('aegis takes the STRONGEST nearby guardian', near(MinionAbilities.aegisMul(ally, scene, g), 0.65), `mul=${MinionAbilities.aegisMul(ally, scene, g)}`)
}

// T3 Bastion — the Warden's ult drops a DR window on itself + every room ally.
{
  const g = gs(); const warden = minion('golem_warden', { tileX: 6, tileY: 6 })
  const ally = minion('skeleton1', { tileX: 1, tileY: 1 })   // far — bastion is room-wide, not radius-bound
  g.minions.push(warden, ally)
  const ab = (byId['golem_warden'].abilities ?? []).find(a => a.type === 'bastion')
  const before = dtm(ally, g)
  MinionAbilities._bastion(warden, scene, g, ab)
  check('T3 Bastion sets a DR window on a far room ally', (ally._bastionUntil ?? 0) > scene.time.now)
  check('T3 Bastion reduces that ally\'s damage taken', dtm(ally, g) < before, `before=${before} after=${dtm(ally, g)}`)
  check('T3 Bastion also shields the Warden itself', (warden._bastionUntil ?? 0) > scene.time.now)
  // window expires
  scene.time.now += (ab.durationMs ?? 5000) + 100
  check('Bastion DR expires after its window', near(dtm(ally, g), 1), `mul=${dtm(ally, g)}`)
}

// Control — a non-construct minion gets no self-DR and no aegis on its own.
{
  const g = gs(); const m = minion('skeleton1'); g.minions.push(m)
  check('non-golem minion has no bulwark/aegis', near(dtm(m, g), 1), `mul=${dtm(m, g)}`)
}

// Data wiring.
check('golem1 has Bulwark (damageReduction)', (byId['golem1'].abilities ?? []).some(a => a.type === 'damageReduction'))
check('golem2 has Aegis', (byId['golem2'].abilities ?? []).some(a => a.type === 'aegis'))
check('golem_warden has the Bastion ult', (byId['golem_warden'].abilities ?? []).some(a => a.type === 'bastion'))

console.log('\nGolem — FORTRESS / BULWARK kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

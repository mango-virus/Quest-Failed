// Headless correctness check for the ORC — BLOODLUST (escalating attack) kit.
//   node tools/sim/orc-bloodlust-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { MinionAbilities } from '../../src/systems/MinionAbilities.js'

installGlobals()
const scene = makeScene()
const DEFS = scene.cache.json.get('minionTypes')
const byId = Object.fromEntries(DEFS.map(d => [d.id, d]))

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

let uid = 0
function gs() { return { minions: [], adventurers: { active: [] }, dungeon: { rooms: [], hazards: [] }, player: { gold: 0 }, _mechanicFlags: {} } }
function minion(id, over = {}) {
  const d = byId[id], b = d.baseStats
  return {
    instanceId: `m${uid++}`, definitionId: id, tags: [...(d.tags ?? [])],
    tileX: 5, tileY: 5, worldX: 160, worldY: 160, assignedRoomId: 'r1', faction: 'dungeon', aiState: 'fighting',
    stats: { attack: b.attack, defense: b.defense ?? 0, speed: b.speed ?? 1, abilities: [] },
    resources: { hp: b.hp, maxHp: b.hp }, ...over,
  }
}
function adv(over = {}) { return { instanceId: `a${uid++}`, classId: 'knight', tileX: 5, tileY: 5, worldX: 160, worldY: 160, aiState: 'fighting', resources: { hp: 100, maxHp: 100 }, ...over } }
const tick = ms => { scene.time.now += ms }
const near = (a, b) => Math.abs(a - b) < 1e-6

// T1 Bloodlust — hits stack ATK, capped, decays out of combat.
{
  const g = gs(); const o = minion('orc1'); const a = adv(); g.minions.push(o); g.adventurers.active.push(a)
  check('T1 no bloodlust before hitting', MinionAbilities.bloodlustAtkMul(o, scene) === 1)
  MinionAbilities.onHit(scene, o, a, 5, g)
  check('T1 one landed hit grants a stack (+8% ATK)', near(MinionAbilities.bloodlustAtkMul(o, scene), 1.08), `mul=${MinionAbilities.bloodlustAtkMul(o, scene)}`)
  for (let i = 0; i < 10; i++) MinionAbilities.onHit(scene, o, a, 5, g)
  check('T1 stacks cap at maxStacks (6 → +48%)', near(MinionAbilities.bloodlustAtkMul(o, scene), 1.48), `mul=${MinionAbilities.bloodlustAtkMul(o, scene)}`)
  tick(5000)
  check('T1 stacks decay out of combat', MinionAbilities.bloodlustAtkMul(o, scene) === 1 && (o._bloodlustStacks ?? 0) === 0)
}

// T2 War Cry — grants Bloodlust stacks to every orc in the room.
{
  const g = gs(); const w = minion('orc2', { tileX: 5, tileY: 5 }); const pawn = minion('orc1', { tileX: 6, tileY: 5 }); g.minions.push(w, pawn)
  const hit = MinionAbilities._warCry(w, scene, g, { type: 'warCry', stacks: 2 })
  check('T2 War Cry ramps every orc in the room', hit === 2 && pawn._bloodlustStacks === 2 && w._bloodlustStacks === 2, `hit=${hit}`)
  check('T2 cried orc gains ATK', MinionAbilities.bloodlustAtkMul(pawn, scene) > 1)
  // a NON-orc in the room is unaffected
  const skel = minion('skeleton1', { tileX: 5, tileY: 6 }); g.minions.push(skel)
  MinionAbilities._warCry(w, scene, g, { type: 'warCry', stacks: 2 })
  check('T2 War Cry ignores non-orcs', (skel._bloodlustStacks ?? 0) === 0)
}

// T3 Warpath — max warband fury + a Rampage (ATK + speed surge), then restore.
{
  const g = gs(); const v = minion('orc_veteran', { tileX: 5, tileY: 5 }); const pawn = minion('orc1', { tileX: 6, tileY: 5 }); g.minions.push(v, pawn)
  const base = v.stats.speed
  MinionAbilities._warpath(v, scene, g, { type: 'warpath', rampageMs: 5000, atkMult: 1.6, speedMult: 1.5 })
  check('T3 Warpath maxes the warband bloodlust', pawn._bloodlustStacks === pawn._bloodlustMax && v._bloodlustStacks === v._bloodlustMax)
  check('T3 Rampage surges speed (×1.5)', near(v.stats.speed, base * 1.5), `spd=${v.stats.speed}`)
  check('T3 Rampage surges ATK (bloodlust × rampage)', MinionAbilities.bloodlustAtkMul(v, scene) > 1.6, `mul=${MinionAbilities.bloodlustAtkMul(v, scene)}`)
  tick(3000); MinionAbilities.tickOrc(scene, g)
  check('T3 speed still boosted mid-window', near(v.stats.speed, base * 1.5))
  tick(2500); MinionAbilities.tickOrc(scene, g)
  check('T3 speed restored after Rampage ends', near(v.stats.speed, base) && !v._rampageUntil, `spd=${v.stats.speed}`)
}

console.log('\nOrc — BLOODLUST kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

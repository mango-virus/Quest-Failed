// Headless correctness check for the GNOLL chain — mechanic: BLOOD HUNT.
//   node tools/sim/gnoll-hunt-check.mjs
import { boot } from './headless.mjs'
import { MinionAbilities as MA } from '../../src/systems/MinionAbilities.js'

const { scene, gs, systems } = boot({ boss: 'lich' })
const cs = systems.combatSystem, mai = systems.minionAiSystem
const byId = Object.fromEntries(scene.cache.json.get('minionTypes').map(d => [d.id, d]))
const abOf = (id, t) => (byId[id].abilities ?? []).find(a => a.type === t)

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }
let uid = 0
const hero = (o = {}) => ({ instanceId: `h${uid++}`, classId: 'knight', faction: 'adventurer', tileX: 5, tileY: 5, worldX: 160, worldY: 160, aiState: 'walking', resources: { hp: 200, maxHp: 200 }, stats: { speed: 1 }, ...o })
const room = () => ({ instanceId: 'rG', gridX: 0, gridY: 0, width: 12, height: 12 })
const g2 = () => ({ minions: [], adventurers: { active: [] }, dungeon: { rooms: [room()] } })
const gnoll = (id, o = {}) => ({ instanceId: `g${uid++}`, definitionId: id, assignedRoomId: 'rG', tileX: 6, tileY: 6, worldX: 192, worldY: 192, faction: 'dungeon', aiState: 'fighting', stats: { speed: 1.1 }, resources: { hp: 50, maxHp: 50 }, ...o })

// ── T1 Bleed — stacks a long bleed (capped) ──
{
  const G = g2(); const gn = gnoll('gnoll1'); const h = hero(); G.minions.push(gn); G.adventurers.active.push(h)
  scene.time.now = 10000
  const ab = abOf('gnoll1', 'bleed')
  MA._applyHitAbility(scene, gn, h, 5, G, ab)
  check('T1 bleed adds a stack', h._bleedStacks === 1)
  check('T1 bleed sets a long window', h._bleedUntil > scene.time.now + 5000)
  for (let i = 0; i < 10; i++) MA._applyHitAbility(scene, gn, h, 5, G, ab)
  check('bleed stacks cap at maxStacks', h._bleedStacks === 6, `stacks=${h._bleedStacks}`)
}
// bleed ticks damage in tickGnoll (stacks × perStack), attributed to the gnoll
{
  const G = g2(); const h = hero({ _bleedStacks: 3, _bleedUntil: scene.time.now + 5000, _bleedPerStack: 2, _bleedInterval: 1000, _bleedTickAt: scene.time.now - 1100, _bleedSource: 'gsrc' }); G.adventurers.active.push(h)
  const before = h.resources.hp
  MA.tickGnoll(scene, G)
  check('tickGnoll ticks bleed = stacks×perStack', h.resources.hp === before - 6, `hp=${h.resources.hp}`)
  check('bleed kills are attributed to the gnoll source', h._lastHitBy === 'gsrc')
}
// bleed expires when the window lapses
{
  const G = g2(); const h = hero({ _bleedStacks: 3, _bleedUntil: scene.time.now - 100 }); G.adventurers.active.push(h)
  MA.tickGnoll(scene, G)
  check('bleed expires (stacks cleared) after the window', !h._bleedStacks)
}

// ── isBleeding + nearestBleedingAdv (drives the hunt) ──
{
  const G = g2(); const gn = gnoll('gnoll2'); G.minions.push(gn)
  const near = hero({ tileX: 6, tileY: 7, _bleedStacks: 2, _bleedUntil: scene.time.now + 5000 })
  const far = hero({ tileX: 1, tileY: 1, _bleedStacks: 1, _bleedUntil: scene.time.now + 5000 })
  const clean = hero({ tileX: 6, tileY: 6 })
  G.adventurers.active.push(clean, far, near)
  check('isBleeding true for a bleeding hero', MA.isBleeding(near, scene.time.now))
  check('isBleeding false for a clean hero', !MA.isBleeding(clean, scene.time.now))
  check('nearestBleedingAdv returns the NEAREST bleeder', MA.nearestBleedingAdv(G, gn, scene.time.now) === near)
}

// ── T2 Bloodhound — scent + sprint when a hero bleeds; restore when none ──
{
  const G = g2(); const gn = gnoll('gnoll2', { stats: { speed: 1.1 } }); G.minions.push(gn)
  const h = hero({ _bleedStacks: 2, _bleedUntil: scene.time.now + 5000 }); G.adventurers.active.push(h)
  MA.tickGnoll(scene, G)
  check('T2 bloodhound scents + sprints when a hero bleeds', gn._bloodScent === true && gn.stats.speed > 1.1, `scent=${gn._bloodScent} spd=${gn.stats.speed}`)
  h._bleedStacks = 0; h._bleedUntil = 0
  MA.tickGnoll(scene, G)
  check('T2 bloodhound calms + restores speed when none bleed', gn._bloodScent === false && Math.abs(gn.stats.speed - 1.1) < 0.001, `scent=${gn._bloodScent} spd=${gn.stats.speed}`)
  const G2 = g2(); const g1 = gnoll('gnoll1'); const h2 = hero({ _bleedStacks: 2, _bleedUntil: scene.time.now + 5000 }); G2.minions.push(g1); G2.adventurers.active.push(h2)
  MA.tickGnoll(scene, G2)
  check('a T1 gnoll (no bloodhound) does NOT abandon its post', !g1._bloodScent)
}
// _pickTarget makes a scenting gnoll chase the bleeder cross-room
{
  const h = hero({ instanceId: 'preyX', tileX: 1, tileY: 1, _bleedStacks: 2, _bleedUntil: scene.time.now + 5000, assignedRoomId: 'other' })
  gs.adventurers.active = [h]
  const gn = gnoll('gnoll2', { _bloodScent: true })
  check('_pickTarget: a scenting gnoll targets the bleeding hero cross-room', mai._pickTarget(gn) === h)
}

// ── T3 Blood Frenzy — rupture + max bleeds + anti-heal + force-scent the pack ──
{
  const G = g2(); const a = gnoll('gnoll_alpha'); const mate = gnoll('gnoll1'); G.minions.push(a, mate)
  const h = hero({ _bleedStacks: 4, _bleedUntil: scene.time.now + 3000, _bleedPerStack: 2 }); G.adventurers.active.push(h)
  const before = h.resources.hp
  const ab = abOf('gnoll_alpha', 'bloodFrenzy')
  MA._bloodFrenzy(a, scene, G, ab)
  check('T3 rupture bursts a bleeder for stacks×dmg', h.resources.hp === before - (4 * (ab.ruptureDmgPerStack ?? 7)), `hp=${h.resources.hp}`)
  check('T3 deepens bleeds to max', h._bleedStacks === (ab.maxStacks ?? 6))
  check('T3 applies anti-heal (_noHealUntil)', h._noHealUntil > scene.time.now)
  check('T3 force-scents the WHOLE pack (incl T1)', (mate._forceScentUntil > scene.time.now) && (a._forceScentUntil > scene.time.now))
}
// anti-heal gate (CombatSystem.tryHeal)
{
  scene.time.now += 10000
  const healer = { instanceId: 'clr', classId: 'cleric', faction: 'adventurer', tileX: 5, tileY: 5, stats: { speed: 1 }, lastAttackAt: 0 }
  const target = hero({ tileX: 5, tileY: 5, resources: { hp: 50, maxHp: 200 }, _noHealUntil: scene.time.now + 5000 })
  const r = cs.tryHeal(healer, target, { amount: 50 })
  check('anti-heal: a frenzied hero cannot be healed', r === null && target.resources.hp === 50, `r=${r} hp=${target.resources.hp}`)
}

// ── Data wiring ──
check('gnoll1 has Bleed', !!abOf('gnoll1', 'bleed'))
check('gnoll2 has Bloodhound (+ bleed)', !!abOf('gnoll2', 'bloodhound') && !!abOf('gnoll2', 'bleed'))
check('gnoll_alpha has Blood Frenzy (+ both)', !!abOf('gnoll_alpha', 'bloodFrenzy') && !!abOf('gnoll_alpha', 'bloodhound') && !!abOf('gnoll_alpha', 'bleed'))
check('gnoll2 stays UPGRADE-only (unlock 99, gold 0)', byId['gnoll2'].unlockLevel === 99 && byId['gnoll2'].goldCost === 0)
check('gnoll_alpha stays a miniboss', (byId['gnoll_alpha'].tags ?? []).includes('miniboss'))

console.log('\nGnoll — BLOOD HUNT kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

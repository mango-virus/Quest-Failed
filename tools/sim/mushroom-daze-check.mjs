// Headless correctness check for the MUSHROOM chain — mechanic: HALLUCINATION (daze).
//   node tools/sim/mushroom-daze-check.mjs
import { boot } from './headless.mjs'
import { MinionAbilities as MA } from '../../src/systems/MinionAbilities.js'

const { scene, gs, systems } = boot({ boss: 'lich' })
const cs = systems.combatSystem
const byId = Object.fromEntries(scene.cache.json.get('minionTypes').map(d => [d.id, d]))
const abOf = (id, t) => (byId[id].abilities ?? []).find(a => a.type === t)

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }
const near = (a, b, e = 0.01) => Math.abs(a - b) < e
let uid = 0
const room = () => ({ instanceId: 'rM', gridX: 0, gridY: 0, width: 12, height: 12 })
const g2 = () => ({ minions: [], adventurers: { active: [] }, dungeon: { rooms: [room()] } })
const shroom = (id, o = {}) => ({ instanceId: `s${uid++}`, definitionId: id, assignedRoomId: 'rM', tileX: 6, tileY: 6, worldX: 208, worldY: 208, faction: 'dungeon', aiState: 'fighting', stats: { attack: byId[id].baseStats.attack, defense: 0, speed: byId[id].baseStats.speed }, resources: { hp: byId[id].baseStats.hp, maxHp: byId[id].baseStats.hp }, ...o })
const hero = (o = {}) => ({ instanceId: `h${uid++}`, classId: 'knight', faction: 'adventurer', aiState: 'walking', tileX: 6, tileY: 6, worldX: 208, worldY: 208, resources: { hp: 200, maxHp: 200 }, ...o })

// ── T1 Daze — onHit dazes an adventurer; a dungeon target is immune ──
{
  scene.time.now = 10000
  const h = hero()
  MA._applyHitAbility(scene, shroom('mushroom1'), h, 5, g2(), abOf('mushroom1', 'daze'))
  const ab = abOf('mushroom1', 'daze')
  check('T1 daze stamps a daze window', (h._dazedUntil ?? 0) > scene.time.now)
  check('T1 daze stamps the miss chance', near(h._dazeMissChance, ab.missChance))
  const ally = { instanceId: 'm', faction: 'dungeon', worldX: 208, worldY: 208, resources: { hp: 50, maxHp: 50 } }
  MA._applyHitAbility(scene, shroom('mushroom1'), ally, 5, g2(), ab)
  check('daze does NOT affect a dungeon-faction target', !(ally._dazedUntil > scene.time.now))
}

// ── dazeMissChance read + expiry + keep-strongest ──
{
  const now = scene.time.now
  const h = hero({ _dazedUntil: now + 5000, _dazeMissChance: 0.4 })
  check('dazeMissChance returns the chance while dazed', near(MA.dazeMissChance(h, now), 0.4))
  check('dazeMissChance is 0 after the window lapses', MA.dazeMissChance(h, now + 6000) === 0)
  check('dazeMissChance is 0 for a non-dazed hero', MA.dazeMissChance(hero(), now) === 0)
  // keep-strongest: a weaker daze must not lower the chance
  MA._applyDaze(h, scene, 1000, 0.2)
  check('daze keeps the STRONGEST miss chance', near(h._dazeMissChance, 0.4))
}

// ── T2 Spore Cloud — dazes heroes within radius, not far ones ──
{
  const G = g2(); const cap = shroom('mushroom2'); G.minions.push(cap)
  const near1 = hero({ tileX: 7, tileY: 6 }), far1 = hero({ tileX: 11, tileY: 11 })
  G.adventurers.active.push(near1, far1)
  scene.time.now += 5000
  MA._sporePuff(cap, scene, G, abOf('mushroom2', 'sporePuff'))
  check('T2 spore cloud dazes a NEARBY hero', MA.dazeMissChance(near1, scene.time.now) > 0)
  check('T2 spore cloud does NOT reach a far hero', MA.dazeMissChance(far1, scene.time.now) === 0)
}

// ── T3 Spore Storm — dazes EVERY room hero (heavy) ──
{
  const G = g2(); const stalker = shroom('myconid_stalker'); G.minions.push(stalker)
  const h1 = hero({ tileX: 2, tileY: 2 }), h2 = hero({ tileX: 10, tileY: 10 }), far = hero({ tileX: 40, tileY: 40 })
  G.adventurers.active.push(h1, h2, far)
  scene.time.now += 5000
  const ab = abOf('myconid_stalker', 'sporeStorm')
  MA._sporeStorm(stalker, scene, G, ab)
  check('T3 spore storm dazes EVERY room hero', MA.dazeMissChance(h1, scene.time.now) === ab.missChance && MA.dazeMissChance(h2, scene.time.now) === ab.missChance)
  check('T3 spore storm spares a hero out of the room', MA.dazeMissChance(far, scene.time.now) === 0)
}

// ── CombatSystem — a dazed hero WHIFFS a chunk of its swings ──
{
  const savedGrid = scene.dungeonGrid
  scene.dungeonGrid = { getTileType: () => 'floor', getRoomAtTile: () => ({ instanceId: 'rCb' }) }
  scene.time.now += 10000
  const mkMin = () => ({ instanceId: `tm${uid++}`, faction: 'dungeon', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 1, damageType: 'physical', stats: { attack: 0, defense: 0, speed: 1 }, resources: { hp: 100000, maxHp: 100000 }, lastAttackAt: 0 })
  const mkHero = (daze) => ({ instanceId: `ah${uid++}`, classId: 'knight', faction: 'adventurer', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 1, damageType: 'physical', stats: { attack: 20, defense: 0, speed: 1 }, resources: { hp: 100, maxHp: 100 }, lastAttackAt: 0, _dazedUntil: daze ? Infinity : 0, _dazeMissChance: daze ? 0.5 : 0 })
  const swings = (daze) => { const h = mkHero(daze); let whiffs = 0; const N = 300; for (let i = 0; i < N; i++) { const m = mkMin(); h.lastAttackAt = 0; scene.time.now += 5000; const r = cs.tryAttack(h, m); if (r && r.whiffed) whiffs++ } return whiffs / N }
  const calmWhiff = swings(false), dazedWhiff = swings(true)
  check('CombatSystem: an un-dazed hero NEVER whiffs from daze', calmWhiff === 0, `whiff=${calmWhiff}`)
  check('CombatSystem: a dazed hero whiffs ~missChance of swings', dazedWhiff > 0.35 && dazedWhiff < 0.65, `whiff=${dazedWhiff.toFixed(2)}`)
  scene.dungeonGrid = savedGrid
}

// ── Data wiring ──
check('mushroom1 has Daze (no spore tick)', !!abOf('mushroom1', 'daze') && !abOf('mushroom1', 'sporePuff') && !abOf('mushroom1', 'sporeStorm'))
check('mushroom2 has Daze + Spore Cloud', !!abOf('mushroom2', 'daze') && !!abOf('mushroom2', 'sporePuff'))
check('myconid_stalker has Daze + Spore Storm', !!abOf('myconid_stalker', 'daze') && !!abOf('myconid_stalker', 'sporeStorm'))
check('mushroom2/myconid_stalker stay UPGRADE-only (unlock 99, gold 0)', byId['mushroom2'].unlockLevel === 99 && byId['mushroom2'].goldCost === 0 && byId['myconid_stalker'].unlockLevel === 99 && byId['myconid_stalker'].goldCost === 0)
check('myconid_stalker stays a miniboss', (byId['myconid_stalker'].tags ?? []).includes('miniboss'))

console.log('\nMushroom — HALLUCINATION kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

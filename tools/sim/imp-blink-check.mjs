// Headless correctness check for the IMP chain — mechanic: BLINK.
//   node tools/sim/imp-blink-check.mjs
import { boot } from './headless.mjs'
import { MinionAbilities as MA } from '../../src/systems/MinionAbilities.js'

const { scene, gs, systems } = boot({ boss: 'lich' })
const byId = Object.fromEntries(scene.cache.json.get('minionTypes').map(d => [d.id, d]))
const abOf = (id, t) => (byId[id].abilities ?? []).find(a => a.type === t)

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }
let uid = 0
const grid = { getTileType: () => 'floor', getRoomAtTile: () => ({ instanceId: 'rI' }) }
const room = () => ({ instanceId: 'rI', gridX: 0, gridY: 0, width: 12, height: 12 })
const g2 = () => ({ minions: [], adventurers: { active: [] }, dungeon: { rooms: [room()] } })
const imp = (id, o = {}) => ({ instanceId: `i${uid++}`, definitionId: id, assignedRoomId: 'rI', tileX: 6, tileY: 6, worldX: 208, worldY: 208, faction: 'dungeon', aiState: 'fighting', stats: { attack: byId[id].baseStats.attack, defense: 0, speed: byId[id].baseStats.speed }, resources: { hp: 60, maxHp: 60 }, ...o })
const hero = (o = {}) => ({ instanceId: `h${uid++}`, classId: 'knight', faction: 'adventurer', aiState: 'walking', tileX: 6, tileY: 6, worldX: 208, worldY: 208, resources: { hp: 200, maxHp: 200 }, ...o })
const dist = (a, tx, ty) => Math.hypot(a.tileX - tx, a.tileY - ty)

// ── helpers ──
check('blinkAbilityOf finds the blink ability', !!MA.blinkAbilityOf(imp('imp1'), scene))
check('_isFloorTile accepts numeric FLOOR/BOSS_FLOOR + string', MA._isFloorTile(1) && MA._isFloorTile(5) && MA._isFloorTile('floor') && !MA._isFloorTile(0) && !MA._isFloorTile('wall'))
{
  const r = MA._pickBlinkTile(grid, room(), (tx, ty) => tx > 8 && ty > 8)
  check('_pickBlinkTile returns a tile matching the predicate', r && r.x > 8 && r.y > 8, `r=${JSON.stringify(r)}`)
}
{
  const m = imp('imp1'); MA._teleportMinion(m, 3, 9, scene)
  check('_teleportMinion sets tile + world + clears path', m.tileX === 3 && m.tileY === 9 && m.worldX === 3 * 32 + 16 && m.path === null)
}

// ── T1 ESCAPE blink — a hero in melee makes the imp teleport to kite range ──
{
  scene.time.now = 10000
  const G = g2(); const m = imp('imp1', { tileX: 6, tileY: 6 }); const h = hero({ tileX: 6, tileY: 6 })
  G.minions.push(m); G.adventurers.active.push(h)
  const ab = abOf('imp1', 'blink')
  MA.tickImp(scene, G, grid)
  check('T1 ESCAPE: a hero in melee → the imp blinks away', (m.tileX !== 6 || m.tileY !== 6) && dist(m, 6, 6) >= ab.kiteRangeTiles, `pos=${m.tileX},${m.tileY} d=${dist(m,6,6).toFixed(1)}`)
  check('T1 ESCAPE sets the blink cooldown', m._blinkAt > scene.time.now)
}
// cooldown — no blink while _blinkAt is in the future
{
  const G = g2(); const m = imp('imp1', { tileX: 6, tileY: 6, _blinkAt: scene.time.now + 5000 }); const h = hero({ tileX: 6, tileY: 6 })
  G.minions.push(m); G.adventurers.active.push(h)
  MA.tickImp(scene, G, grid)
  check('blink respects the cooldown (no teleport)', m.tileX === 6 && m.tileY === 6)
}
// T1 does NOT flicker — left alone when no hero is close
{
  const G = g2(); const m = imp('imp1', { tileX: 1, tileY: 1 }); const h = hero({ tileX: 10, tileY: 10 })
  G.minions.push(m); G.adventurers.active.push(h)
  MA.tickImp(scene, G, grid)
  check('T1 does NOT flicker (no offensive blink)', m.tileX === 1 && m.tileY === 1 && !(m._blinkAt > scene.time.now))
}

// ── T2 FLICKER — blink in to the most-wounded hero when not threatened ──
{
  const G = g2(); const m = imp('imp2', { tileX: 1, tileY: 1 })
  const prey = hero({ tileX: 10, tileY: 10, resources: { hp: 12, maxHp: 200 } })
  const healthy = hero({ tileX: 4, tileY: 4, resources: { hp: 200, maxHp: 200 } })
  G.minions.push(m); G.adventurers.active.push(healthy, prey)
  const ab = abOf('imp2', 'blink')
  MA.tickImp(scene, G, grid)
  check('T2 FLICKER: blinks to within range of the MOST-WOUNDED hero', dist(m, 10, 10) <= ab.flickerRangeTiles + 0.01 && dist(m, 10, 10) >= 1.39, `d=${dist(m,10,10).toFixed(2)}`)
  check('T2 FLICKER targets the wounded hero', m.currentTargetId === prey.instanceId)
}

// ── T3 Hellrift — room fire pulse + frenzy the imp pack ──
{
  const G = g2(); const t = imp('imp3', { tileX: 6, tileY: 6 }); const mate = imp('imp1', { tileX: 5, tileY: 5 }); const nonImp = { instanceId: 'sk', definitionId: 'skeleton1', faction: 'dungeon', assignedRoomId: 'rI', tileX: 6, tileY: 6, aiState: 'fighting', resources: { hp: 40, maxHp: 40 } }
  const h1 = hero({ tileX: 7, tileY: 6 }), h2 = hero({ tileX: 8, tileY: 8 })
  G.minions.push(t, mate, nonImp); G.adventurers.active.push(h1, h2)
  scene.time.now += 20000
  const ab = abOf('imp3', 'hellrift')
  const before = h1.resources.hp
  MA._hellrift(t, scene, G, ab)
  check('T3 Hellrift deals room-wide fire damage', h1.resources.hp === before - ab.dmg && h2.resources.hp === 200 - ab.dmg, `h1=${h1.resources.hp}`)
  check('T3 Hellrift frenzies the imp pack in the room', t._blinkFrenzyUntil > scene.time.now && mate._blinkFrenzyUntil > scene.time.now)
  check('T3 Hellrift does NOT frenzy a non-imp minion', !(nonImp._blinkFrenzyUntil > scene.time.now))
}
// frenzy shortens the blink cooldown
{
  scene.time.now += 20000
  const G = g2(); const ab = abOf('imp2', 'blink')
  const m = imp('imp2', { tileX: 6, tileY: 6, _blinkFrenzyUntil: scene.time.now + 3000 }); const h = hero({ tileX: 6, tileY: 6 })
  G.minions.push(m); G.adventurers.active.push(h)
  MA.tickImp(scene, G, grid)
  const cd = m._blinkAt - scene.time.now
  check('frenzy uses the short blink cooldown', Math.abs(cd - ab.frenzyCdMs) < 50, `cd=${cd} expect=${ab.frenzyCdMs}`)
}

// ── dawn reset clears the blink timers ──
{
  const m = imp('imp2', { _blinkAt: 99999, _flickerAt: 99999, _blinkFrenzyUntil: 99999 })
  MA.resetOneShotsForNight(m)
  check('dawn reset clears blink timers', m._blinkAt === 0 && m._flickerAt === 0 && m._blinkFrenzyUntil === 0)
}

// ── Data wiring ──
check('imp1 has Blink (no flicker)', !!abOf('imp1', 'blink') && !abOf('imp1', 'blink').flicker)
check('imp2 has Blink + Flicker', !!abOf('imp2', 'blink') && abOf('imp2', 'blink').flicker === true)
check('imp3 has Blink + Flicker + Hellrift', !!abOf('imp3', 'blink') && abOf('imp3', 'blink').flicker === true && !!abOf('imp3', 'hellrift'))
check('imp2/imp3 stay UPGRADE-only (unlock 99, gold 0)', byId['imp2'].unlockLevel === 99 && byId['imp2'].goldCost === 0 && byId['imp3'].unlockLevel === 99 && byId['imp3'].goldCost === 0)
check('imp2 behaviorType moved off generic "ambush"', byId['imp2'].behaviorType !== 'ambush')
check('all three imps are ranged (attackRange 3)', byId['imp1'].baseStats.attackRange === 3 && byId['imp2'].baseStats.attackRange === 3 && byId['imp3'].baseStats.attackRange === 3)

console.log('\nImp — BLINK kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

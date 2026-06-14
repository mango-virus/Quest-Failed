// Headless correctness check for the ENT chain — mechanic: THORNS / OLD GROWTH.
//   node tools/sim/ent-thorns-check.mjs
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
const ent = (id, o = {}) => ({ instanceId: `e${uid++}`, definitionId: id, faction: 'dungeon', aiState: 'fighting', tileX: 6, tileY: 6, worldX: 192, worldY: 192, resources: { hp: 100, maxHp: 100 }, ...o })
const hero = (o = {}) => ({ instanceId: `h${uid++}`, classId: 'knight', faction: 'adventurer', attackRange: 1, tileX: 6, tileY: 6, worldX: 192, worldY: 192, aiState: 'walking', resources: { hp: 100, maxHp: 100 }, ...o })

// ── T1 Thorns — a MELEE hero that hits the ent takes reflect; a RANGED one doesn't ──
{
  scene.time.now = 10000
  const e = ent('ent1'); const h = hero()
  const r = MA.thornsReflect(e, h, 10, scene)   // ent1: frac 0.4, flat 2 → max(2, 4)=4
  check('T1 melee reflect = max(flat, dmg×frac)', r === 4 && h.resources.hp === 96, `r=${r} hp=${h.resources.hp}`)
  check('reflect attributes the kill to the ent', h._lastHitBy === e.instanceId)
  const ranged = hero({ attackRange: 4 })
  check('a RANGED hero takes NO reflect (not touching the thorns)', MA.thornsReflect(e, ranged, 10, scene) === 0 && ranged.resources.hp === 100)
}
// amplified during the Thornburst window
{
  const e = ent('ent1', { _thornsAmpUntil: scene.time.now + 5000, _thornsAmpMul: 1.6 }); const h = hero()
  check('reflect is AMPLIFIED during Thornburst', MA.thornsReflect(e, h, 10, scene) === Math.round(4 * 1.6), `got ${MA.thornsReflect(ent('ent1', { _thornsAmpUntil: scene.time.now + 5000, _thornsAmpMul: 1.6 }), hero(), 10, scene)}`)
}
// a non-ent minion reflects nothing
{
  const skel = { instanceId: 's', definitionId: 'skeleton1', faction: 'dungeon', resources: { hp: 50, maxHp: 50 } }
  check('a non-thorned minion reflects nothing', MA.thornsReflect(skel, hero(), 10, scene) === 0)
}

// ── T2 Regrow — heals a % of max HP, capped ──
{
  const ab = abOf('ent2', 'regrow')   // healFrac 0.03
  const e = ent('ent2', { resources: { hp: 50, maxHp: 100 } })
  MA._regrow(e, scene, {}, ab)
  check('T2 regrow heals % of maxHp', e.resources.hp === 53, `hp=${e.resources.hp}`)
  const full = ent('ent2', { resources: { hp: 100, maxHp: 100 } })
  MA._regrow(full, scene, {}, ab)
  check('regrow does not overheal', full.resources.hp === 100)
}

// ── T3 Thornburst — room AoE thorn dmg + a big self-heal surge + amplified thorns ──
{
  const room = { instanceId: 'rE', gridX: 0, gridY: 0, width: 12, height: 12 }
  const g2 = { minions: [], adventurers: { active: [] }, dungeon: { rooms: [room] } }
  const oak = ent('ent3', { assignedRoomId: 'rE', resources: { hp: 50, maxHp: 200 } })
  const h1 = hero({ tileX: 2, tileY: 2 }), hFar = hero({ tileX: 20, tileY: 20 })
  g2.minions.push(oak); g2.adventurers.active.push(h1, hFar)
  const ab = abOf('ent3', 'thornburst')   // dmg 14, healFrac 0.25, ampMs 4000, ampMul 1.6
  scene.time.now = 50000
  MA._thornburst(oak, scene, g2, ab)
  check('T3 thornburst damages every room hero', h1.resources.hp === 100 - 14, `hp=${h1.resources.hp}`)
  check('T3 thornburst spares heroes out of the room', hFar.resources.hp === 100)
  check('T3 thornburst self-heals (regrowth surge)', oak.resources.hp === 50 + Math.round(200 * 0.25), `hp=${oak.resources.hp}`)
  check('T3 thornburst amplifies thorns for a window', (oak._thornsAmpUntil ?? 0) > scene.time.now && near(oak._thornsAmpMul, 1.6))
}

// ── CombatSystem integration — a melee hero attacking an ent gets pricked ──
{
  const savedGrid = scene.dungeonGrid
  scene.dungeonGrid = { getTileType: () => 'floor', getRoomAtTile: () => ({ instanceId: 'rE2' }) }
  scene.time.now += 10000
  const e = { instanceId: 'em', definitionId: 'ent1', faction: 'dungeon', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, damageType: 'physical', stats: { attack: 5, defense: 0, speed: 1 }, resources: { hp: 100000, maxHp: 100000 }, lastAttackAt: 0 }
  const mh = { instanceId: 'mh', classId: 'knight', faction: 'adventurer', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 1, damageType: 'physical', stats: { attack: 20, defense: 0, speed: 1 }, resources: { hp: 1000, maxHp: 1000 }, lastAttackAt: 0 }
  cs.tryAttack(mh, e)
  check('CombatSystem: a melee hero striking an ent takes thorns reflect', mh.resources.hp < 1000, `hp=${mh.resources.hp}`)
  scene.dungeonGrid = savedGrid
}

// ── Data wiring ──
check('ent1 has Thorns', !!abOf('ent1', 'thorns'))
check('ent2 has Thorns + Regrow', !!abOf('ent2', 'thorns') && !!abOf('ent2', 'regrow'))
check('ent3 has Thornburst (+ thorns + regrow)', !!abOf('ent3', 'thornburst') && !!abOf('ent3', 'regrow') && !!abOf('ent3', 'thorns'))
check('ent2/ent3 stay UPGRADE-only (unlock 99, gold 0)', byId['ent2'].unlockLevel === 99 && byId['ent2'].goldCost === 0 && byId['ent3'].unlockLevel === 99 && byId['ent3'].goldCost === 0)

console.log('\nEnt — THORNS / OLD GROWTH kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

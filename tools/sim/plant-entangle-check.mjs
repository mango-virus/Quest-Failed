// Headless correctness check for the PLANT chain — mechanic: ENTANGLE (root).
//   node tools/sim/plant-entangle-check.mjs
import { boot } from './headless.mjs'
import { MinionAbilities as MA } from '../../src/systems/MinionAbilities.js'

const { scene, gs, systems } = boot({ boss: 'lich' })
const cs = systems.combatSystem
const byId = Object.fromEntries(scene.cache.json.get('minionTypes').map(d => [d.id, d]))
const abOf = (id, t) => (byId[id].abilities ?? []).find(a => a.type === t)

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }
let uid = 0
const room = () => ({ instanceId: 'rP', gridX: 0, gridY: 0, width: 12, height: 12 })
const g2 = () => ({ minions: [], adventurers: { active: [] }, dungeon: { rooms: [room()] } })
const plant = (id, o = {}) => ({ instanceId: `p${uid++}`, definitionId: id, assignedRoomId: 'rP', tileX: 6, tileY: 6, worldX: 208, worldY: 208, faction: 'dungeon', aiState: 'fighting', stats: { attack: byId[id].baseStats.attack, defense: 0, speed: byId[id].baseStats.speed }, resources: { hp: byId[id].baseStats.hp, maxHp: byId[id].baseStats.hp }, ...o })
const hero = (o = {}) => ({ instanceId: `h${uid++}`, classId: 'knight', faction: 'adventurer', aiState: 'walking', tileX: 6, tileY: 6, worldX: 208, worldY: 208, resources: { hp: 200, maxHp: 200 }, ...o })

// ── T1 Entangle — onHit ROOTS an adventurer; a dungeon target is immune ──
{
  scene.time.now = 10000
  const h = hero()
  MA._applyHitAbility(scene, plant('plant1'), h, 5, g2(), abOf('plant1', 'entangle'))
  check('T1 entangle ROOTS the struck hero', (h._rootedUntil ?? 0) > scene.time.now && MA.isRooted(h, scene.time.now), `until=${h._rootedUntil}`)
  check('T1 entangle uses the ability duration', h._rootedUntil >= scene.time.now + abOf('plant1', 'entangle').durationMs - 1)
  const ally = { instanceId: 'm', faction: 'dungeon', tileX: 6, tileY: 6, worldX: 208, worldY: 208, resources: { hp: 50, maxHp: 50 } }
  MA._applyHitAbility(scene, plant('plant1'), ally, 5, g2(), abOf('plant1', 'entangle'))
  check('entangle does NOT root a dungeon-faction target', !(ally._rootedUntil > scene.time.now))
}

// ── isRooted clears after the window ──
{
  const h = hero({ _rootedUntil: scene.time.now - 10 })
  check('isRooted is false once the window lapses', !MA.isRooted(h, scene.time.now))
}

// ── T2 Devour — bonus damage vs a ROOTED target only ──
{
  const now = scene.time.now
  const p2 = plant('plant2'), p1 = plant('plant1')
  const rooted = hero({ _rootedUntil: now + 5000 }), free = hero({ _rootedUntil: 0 })
  check('T2 devourMul applies vs a ROOTED target', MA.devourMul(p2, rooted, scene) === abOf('plant2', 'entangle').devourMul)
  check('T2 devourMul is 1 vs an un-rooted target', MA.devourMul(p2, free, scene) === 1)
  check('T1 (no devourMul) gets NO bonus even vs a rooted target', MA.devourMul(p1, rooted, scene) === 1)
}

// ── T3 Stranglethorn — root every room hero + drain + self-heal ──
{
  const G = g2(); const briar = plant('plant3', { resources: { hp: 30, maxHp: 100 } })
  const h1 = hero({ tileX: 3, tileY: 3 }), h2 = hero({ tileX: 9, tileY: 9 }), far = hero({ tileX: 40, tileY: 40 })
  G.minions.push(briar); G.adventurers.active.push(h1, h2, far)
  scene.time.now += 5000
  const ab = abOf('plant3', 'stranglethorn')
  MA._stranglethorn(briar, scene, G, ab)
  check('T3 roots EVERY room hero', MA.isRooted(h1, scene.time.now) && MA.isRooted(h2, scene.time.now))
  check('T3 spares a hero out of the room', !MA.isRooted(far, scene.time.now) && far.resources.hp === 200)
  check('T3 drains HP from each rooted hero', h1.resources.hp === 200 - ab.drain && h2.resources.hp === 200 - ab.drain)
  check('T3 heals the briar from the drain (per hero)', briar.resources.hp === 30 + ab.healPerHit * 2, `hp=${briar.resources.hp}`)
}

// ── CombatSystem — a plant bites HARDER into a rooted hero (devour) ──
{
  const savedGrid = scene.dungeonGrid
  scene.dungeonGrid = { getTileType: () => 'floor', getRoomAtTile: () => ({ instanceId: 'rCb' }) }
  scene.time.now += 10000
  const mkHero = () => ({ instanceId: `t${uid++}`, classId: 'knight', faction: 'adventurer', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 1, resources: { hp: 100000, maxHp: 100000 }, stats: { attack: 0, defense: 0, speed: 1 }, lastAttackAt: 0 })
  const mkPlant = () => ({ instanceId: `cp${uid++}`, definitionId: 'plant2', faction: 'dungeon', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 1, damageType: 'physical', stats: { attack: 20, defense: 0, speed: 1 }, resources: { hp: 100, maxHp: 100 }, lastAttackAt: 0 })
  const swing = (rooted) => { const p = mkPlant(); let sum = 0; for (let i = 0; i < 16; i++) { const h = mkHero(); p.lastAttackAt = 0; scene.time.now += 5000; if (rooted) h._rootedUntil = scene.time.now + 100000; cs.tryAttack(p, h); sum += 100000 - h.resources.hp } return sum }
  const free = swing(false), held = swing(true)
  check('CombatSystem: a plant bites HARDER into a rooted hero', held > free * 1.3, `free=${free} held=${held}`)
  scene.dungeonGrid = savedGrid
}

// ── Data wiring ──
check('plant1 has Entangle (no devour)', !!abOf('plant1', 'entangle') && !abOf('plant1', 'entangle').devourMul)
check('plant2 has Entangle + Devour', !!abOf('plant2', 'entangle') && abOf('plant2', 'entangle').devourMul > 1)
check('plant3 has Entangle + Devour + Stranglethorn', !!abOf('plant3', 'entangle') && abOf('plant3', 'entangle').devourMul > 1 && !!abOf('plant3', 'stranglethorn'))
check('plant2/plant3 stay UPGRADE-only (unlock 99, gold 0)', byId['plant2'].unlockLevel === 99 && byId['plant2'].goldCost === 0 && byId['plant3'].unlockLevel === 99 && byId['plant3'].goldCost === 0)
check('plant2 behaviorType moved off generic "ambush"', byId['plant2'].behaviorType !== 'ambush')

console.log('\nPlant — ENTANGLE kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

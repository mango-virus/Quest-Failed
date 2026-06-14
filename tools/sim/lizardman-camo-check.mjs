// Headless correctness check for the LIZARDMAN chain — mechanic: CAMOUFLAGE.
//   node tools/sim/lizardman-camo-check.mjs
import { boot } from './headless.mjs'
import { MinionAbilities as MA } from '../../src/systems/MinionAbilities.js'

const { scene, gs, systems } = boot({ boss: 'lich' })
const cs = systems.combatSystem
const byId = Object.fromEntries(scene.cache.json.get('minionTypes').map(d => [d.id, d]))
const abOf = (id, t) => (byId[id].abilities ?? []).find(a => a.type === t)

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }
let uid = 0
const room = () => ({ instanceId: 'rZ', gridX: 0, gridY: 0, width: 12, height: 12 })
const g2 = () => ({ minions: [], adventurers: { active: [] }, dungeon: { rooms: [room()] } })
const liz = (id, o = {}) => ({ instanceId: `z${uid++}`, definitionId: id, assignedRoomId: 'rZ', tileX: 6, tileY: 6, worldX: 192, worldY: 192, faction: 'dungeon', aiState: 'fighting', stats: { attack: byId[id].baseStats.attack, defense: 0, speed: byId[id].baseStats.speed }, resources: { hp: 60, maxHp: 60 }, tags: [...(byId[id].tags ?? [])], ...o })

// ── camoAbilityOf + ambushStrikeMul ──
{
  const m = liz('lizardman1', { _camouflaged: true })
  check('camoAbilityOf finds the camouflage ability', !!MA.camoAbilityOf(m, scene))
  check('ambushStrikeMul returns ambushMul while camouflaged', MA.ambushStrikeMul(m, scene) === abOf('lizardman1', 'camouflage').ambushMul)
  m._camouflaged = false
  check('ambushStrikeMul is 1 once revealed', MA.ambushStrikeMul(m, scene) === 1)
}

// ── tickLizard — initial cloak + hidden speed ──
{
  const G = g2(); const m = liz('lizardman2'); G.minions.push(m)
  const base = m.stats.speed
  scene.time.now = 10000
  MA.tickLizard(scene, G)
  check('tickLizard cloaks a fresh stalker (initial)', m._camouflaged === true && m._camoInit === true)
  check('T2 moves FASTER while hidden (hiddenSpeedMul)', m.stats.speed > base, `spd=${m.stats.speed} base=${base}`)
  // reveal restores the base speed
  MA.revealCamouflage(m, scene)
  check('revealCamouflage clears _camouflaged + stamps _revealedAt', m._camouflaged === false && m._revealedAt === scene.time.now)
  MA.tickLizard(scene, G)
  check('hidden-speed is restored once revealed', Math.abs(m.stats.speed - base) < 0.001, `spd=${m.stats.speed}`)
}

// ── T2 mid-combat re-camo after recamoMs ──
{
  const G = g2(); const m = liz('lizardman2', { _camoInit: true, _camouflaged: false, _revealedAt: 10000 }); G.minions.push(m)
  const ab = abOf('lizardman2', 'camouflage')
  scene.time.now = 10000 + ab.recamoMs - 100
  MA.tickLizard(scene, G)
  check('does NOT re-camo before recamoMs elapses', m._camouflaged === false)
  scene.time.now = 10000 + ab.recamoMs + 50
  MA.tickLizard(scene, G)
  check('T2 RE-CAMOUFLAGES mid-combat after recamoMs', m._camouflaged === true)
}
// ── T1 does NOT re-camo (recamoMs 0 — one ambush per wave) ──
{
  const G = g2(); const m = liz('lizardman1', { _camoInit: true, _camouflaged: false, _revealedAt: 0 }); G.minions.push(m)
  scene.time.now += 60000
  MA.tickLizard(scene, G)
  check('T1 stays revealed (no mid-combat re-camo)', m._camouflaged === false)
}

// ── maybeKillRecamo — T2 vanishes on a kill, T1 does not ──
{
  const m2 = liz('lizardman2', { _camouflaged: false }); MA.maybeKillRecamo(m2, scene)
  check('T2 killRecamo re-cloaks on a kill', m2._camouflaged === true)
  const m1 = liz('lizardman1', { _camouflaged: false }); MA.maybeKillRecamo(m1, scene)
  check('T1 (no killRecamo) does NOT re-cloak on a kill', m1._camouflaged === false)
}

// ── T3 Vanishing Warband — re-cloak the whole reptile pack in the room ──
{
  const G = g2(); const cap = liz('serpent_captain'); const mate1 = liz('lizardman1', { _camouflaged: false }); const mate2 = liz('lizardman2', { _camouflaged: false })
  const other = liz('lizardman1', { assignedRoomId: 'OTHER', tileX: 40, tileY: 40, _camouflaged: false })
  G.minions.push(cap, mate1, mate2, other)
  MA._vanishingWarband(cap, scene, G, abOf('serpent_captain', 'vanishingWarband'))
  check('T3 re-cloaks every reptile in the captain\'s room', mate1._camouflaged === true && mate2._camouflaged === true)
  check('T3 does NOT reach a reptile in another room', other._camouflaged === false)
}

// ── CombatSystem — untargetable guard + ambush bonus + reveal + kill-recamo ──
{
  const savedGrid = scene.dungeonGrid
  scene.dungeonGrid = { getTileType: () => 'floor', getRoomAtTile: () => ({ instanceId: 'rCb' }) }
  const mkHero = (hp = 100000) => ({ instanceId: `h${uid++}`, classId: 'knight', faction: 'adventurer', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 1, damageType: 'physical', resources: { hp, maxHp: 100000 }, stats: { attack: 20, defense: 0, speed: 1 }, lastAttackAt: 0 })
  const mkLiz = (id) => ({ instanceId: `cz${uid++}`, definitionId: id, faction: 'dungeon', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 1, damageType: 'physical', stats: { attack: byId[id].baseStats.attack, defense: 0, speed: 1 }, resources: { hp: 100, maxHp: 100 }, lastAttackAt: 0, tags: [...byId[id].tags] })
  // untargetable: a hero cannot strike a camouflaged lizardman
  scene.time.now += 10000
  const camoZ = mkLiz('lizardman1'); camoZ._camouflaged = true; camoZ.resources.hp = 100
  const hero0 = mkHero(); const r = cs.tryAttack(hero0, camoZ)
  check('CombatSystem: a hero CANNOT hit a camouflaged lizardman', r === null && camoZ.resources.hp === 100, `r=${r} hp=${camoZ.resources.hp}`)
  // ambush bonus + reveal: a camo strike deals far more, then reveals
  const swing = (camo) => { const z = mkLiz('lizardman2'); let sum = 0; for (let i = 0; i < 16; i++) { const h = mkHero(); z.lastAttackAt = 0; scene.time.now += 5000; if (camo) z._camouflaged = true; cs.tryAttack(z, h); sum += 100000 - h.resources.hp } return sum }
  const plain = swing(false), ambush = swing(true)
  check('CombatSystem: a strike FROM camo hits much harder (ambush)', ambush > plain * 1.8, `plain=${plain} ambush=${ambush}`)
  const z2 = mkLiz('lizardman2'); z2._camouflaged = true; const h2 = mkHero(); scene.time.now += 5000; z2.lastAttackAt = 0
  cs.tryAttack(z2, h2)
  check('CombatSystem: striking REVEALS the lizardman (clears camo)', z2._camouflaged === false)
  // kill-recamo: a T2 stalker that lands a killing ambush vanishes again
  const z3 = mkLiz('lizardman2'); z3._camouflaged = true; const dying = mkHero(8); scene.time.now += 5000; z3.lastAttackAt = 0
  cs.tryAttack(z3, dying)
  check('CombatSystem: a killing ambush re-cloaks the T2 stalker (clean getaway)', dying.resources.hp <= 0 && z3._camouflaged === true, `hp=${dying.resources.hp} camo=${z3._camouflaged}`)
  scene.dungeonGrid = savedGrid
}

// ── dawn reset re-arms the cloak ──
{
  const m = liz('lizardman2', { _camoInit: true, _camouflaged: false, _revealedAt: 99999, _camoBaseSpeed: 1.0 })
  m.stats.speed = 1.5
  MA.resetOneShotsForNight(m)
  check('dawn reset re-cloaks + restores base speed', m._camouflaged === true && m._revealedAt === 0 && m.stats.speed === 1.0 && m._camoBaseSpeed == null)
}

// ── Data wiring ──
check('lizardman1 has Camouflage', !!abOf('lizardman1', 'camouflage'))
check('lizardman2 has Camouflage + recamo/hiddenSpeed/killRecamo', (() => { const a = abOf('lizardman2', 'camouflage'); return a && a.recamoMs > 0 && a.hiddenSpeedMul > 1 && a.killRecamo === true })())
check('serpent_captain has Camouflage + Vanishing Warband', !!abOf('serpent_captain', 'camouflage') && !!abOf('serpent_captain', 'vanishingWarband'))
check('lizardman2/serpent_captain stay UPGRADE-only (unlock 99, gold 0)', byId['lizardman2'].unlockLevel === 99 && byId['lizardman2'].goldCost === 0 && byId['serpent_captain'].unlockLevel === 99 && byId['serpent_captain'].goldCost === 0)
check('serpent_captain stays a miniboss', (byId['serpent_captain'].tags ?? []).includes('miniboss'))
check('lizardman1 behaviorType moved off generic "ambush"', byId['lizardman1'].behaviorType !== 'ambush')

console.log('\nLizardman — CAMOUFLAGE kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

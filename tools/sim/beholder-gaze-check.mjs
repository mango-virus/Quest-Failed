// Headless correctness check for the BEHOLDER chain — mechanic: GAZE / DOMINATION.
//   node tools/sim/beholder-gaze-check.mjs
import { boot } from './headless.mjs'
import { MinionAbilities as MA } from '../../src/systems/MinionAbilities.js'

const { scene, gs, systems } = boot({ boss: 'lich' })
const cs = systems.combatSystem
const byId = Object.fromEntries(scene.cache.json.get('minionTypes').map(d => [d.id, d]))
const abOf = (id, type) => (byId[id].abilities ?? []).find(a => a.type === type)

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }
const near = (a, b, e = 0.01) => Math.abs(a - b) < e
let uid = 0
const hero = (o = {}) => ({ instanceId: `h${uid++}`, classId: 'knight', faction: 'adventurer', partyId: 'p1', tileX: 5, tileY: 5, worldX: 160, worldY: 160, aiState: 'walking', resources: { hp: 1000, maxHp: 1000 }, stats: { attack: 10, defense: 0, speed: 1 }, attackRange: 1, ...o })
const room = () => ({ instanceId: 'rB', gridX: 0, gridY: 0, width: 12, height: 12 })
const g2 = () => ({ minions: [], adventurers: { active: [] }, dungeon: { rooms: [room()] } })
const eye = (id, o = {}) => ({ instanceId: `b${uid++}`, definitionId: id, assignedRoomId: 'rB', tileX: 6, tileY: 6, worldX: 192, worldY: 192, faction: 'dungeon', ...o })

// ── T1 Mesmerize — charm + attack-redirect ──
{
  const G = g2(); const b = eye('beholder1')
  const h = hero({ tileX: 6, tileY: 6, worldX: 192, worldY: 192 }), ally = hero({ tileX: 6, tileY: 6 })
  G.minions.push(b); G.adventurers.active.push(h, ally)
  scene.time.now = 10000
  MA._applyHitAbility(scene, b, h, 5, G, { type: 'mesmerize', durationMs: 3500 })
  check('T1 mesmerize charms the struck hero', (h._possessedUntil ?? 0) > scene.time.now)
  const redir = MA.maybeRedirectPossessedAttack(h, { instanceId: 'min', faction: 'dungeon', tileX: 6, tileY: 6 }, G, scene)
  check('T1 a charmed hero redirects its swing to an ALLY', redir === ally, `redir=${redir?.instanceId}`)
  const bar = hero({ classId: 'barbarian' }); G.adventurers.active.push(bar)
  MA._applyHitAbility(scene, b, bar, 5, G, { type: 'mesmerize', durationMs: 3500 })
  check('a barbarian resists mesmerize', !((bar._possessedUntil ?? 0) > scene.time.now))
}

// ── T2 Mass Hypnosis — charm the nearest N ──
{
  const G = g2(); const b = eye('beholder2'); G.minions.push(b)
  const near1 = hero({ tileX: 6, tileY: 6 }), near2 = hero({ tileX: 7, tileY: 6 }), far1 = hero({ tileX: 11, tileY: 11 }), far2 = hero({ tileX: 10, tileY: 11 })
  G.adventurers.active.push(near1, near2, far1, far2)
  scene.time.now = 20000
  MA._massHypnosis(b, scene, G, { type: 'massHypnosis', targets: 2, durationMs: 3500 })
  check('T2 mass hypnosis charms the 2 NEAREST heroes', (near1._possessedUntil > scene.time.now) && (near2._possessedUntil > scene.time.now))
  check('T2 mass hypnosis leaves farther heroes free', !(far1._possessedUntil > scene.time.now) && !(far2._possessedUntil > scene.time.now))
}

// ── T3 Tyrant's Glare — petrify + hex the room ──
{
  const G = g2(); const t = eye('beholder_tyrant'); G.minions.push(t)
  const h1 = hero({ tileX: 2, tileY: 2 }), h2 = hero({ tileX: 10, tileY: 10 }), bar = hero({ classId: 'barbarian', tileX: 6, tileY: 6 })
  G.adventurers.active.push(h1, h2, bar)
  scene.time.now = 30000
  MA._tyrantGlare(t, scene, G, { type: 'tyrantGlare', petrifyMs: 2200, hexMul: 1.6, hexMs: 5000 })
  check('T3 PETRIFIES every room hero', (h1._petrifiedUntil > scene.time.now) && (h2._petrifiedUntil > scene.time.now))
  check('T3 HEXES every room hero', (h1._hexUntil > scene.time.now) && near(h1._hexVulnMul, 1.6))
  check('T3 a barbarian resists petrify', !(bar._petrifiedUntil > scene.time.now))
  check('gazeHexMul returns the hex mult while hexed', near(MA.gazeHexMul(h1, scene.time.now), 1.6))
  check('gazeHexMul is 1 after the hex expires', near(MA.gazeHexMul(h1, scene.time.now + 6000), 1))
}

// ── CombatSystem — petrified can't attack; hexed takes more damage ──
{
  const savedGrid = scene.dungeonGrid, stubRoom = { instanceId: 'rCb' }
  scene.dungeonGrid = { getTileType: () => 'floor', getRoomAtTile: () => stubRoom }
  const minion = () => ({ instanceId: `m${uid++}`, faction: 'dungeon', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 1, damageType: 'physical', stats: { attack: 20, defense: 0, speed: 1 }, resources: { hp: 100, maxHp: 100 }, lastAttackAt: 0 })
  scene.time.now += 10000
  const pHero = hero({ tileX: 5, tileY: 5, _petrifiedUntil: scene.time.now + 5000, stats: { attack: 30, speed: 1 }, lastAttackAt: 0 })
  const tm = minion(); const r = cs.tryAttack(pHero, tm)
  check('CombatSystem: a petrified hero cannot attack', r === null && tm.resources.hp === 100, `r=${r} hp=${tm.resources.hp}`)
  const swingSum = (target, hex = false) => { let sum = 0; const m = minion(); for (let i = 0; i < 20; i++) { target.resources.hp = 100000; m.lastAttackAt = 0; scene.time.now += 5000; if (hex) { target._hexUntil = scene.time.now + 100000; target._hexVulnMul = 1.6 } cs.tryAttack(m, target); sum += 100000 - target.resources.hp } return sum }
  const calmSum = swingSum(hero({ tileX: 5, tileY: 5, resources: { hp: 100000, maxHp: 100000 }, stats: { attack: 0, defense: 0 } }), false)
  const hexSum = swingSum(hero({ tileX: 5, tileY: 5, resources: { hp: 100000, maxHp: 100000 }, stats: { attack: 0, defense: 0 } }), true)
  check('CombatSystem: a hexed target takes MORE damage', hexSum > calmSum * 1.2, `calm=${calmSum} hex=${hexSum}`)
  scene.dungeonGrid = savedGrid
}

// ── Data wiring ──
check('beholder1 has Mesmerize', !!abOf('beholder1', 'mesmerize'))
check('beholder2 has Mass Hypnosis (+ mesmerize)', !!abOf('beholder2', 'massHypnosis') && !!abOf('beholder2', 'mesmerize'))
check('beholder_tyrant has Tyrant Glare (+ both)', !!abOf('beholder_tyrant', 'tyrantGlare') && !!abOf('beholder_tyrant', 'massHypnosis') && !!abOf('beholder_tyrant', 'mesmerize'))
check('beholder2 stays UPGRADE-only (unlock 99, gold 0)', byId['beholder2'].unlockLevel === 99 && byId['beholder2'].goldCost === 0, `unlock=${byId['beholder2'].unlockLevel} gold=${byId['beholder2'].goldCost}`)
check('beholder_tyrant stays a miniboss', (byId['beholder_tyrant'].tags ?? []).includes('miniboss'))
check('beholder1 got a real attack range (ranged gaze)', (byId['beholder1'].baseStats.attackRange ?? 0) > 1)

console.log('\nBeholder — GAZE / DOMINATION kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

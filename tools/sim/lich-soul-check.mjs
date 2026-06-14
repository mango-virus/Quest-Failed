// Headless correctness check for the LICH chain — mechanic: SOUL HARVEST.
//   node tools/sim/lich-soul-check.mjs
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
const room = () => ({ instanceId: 'rL', gridX: 0, gridY: 0, width: 12, height: 12 })
const g2 = (day = 5) => ({ minions: [], adventurers: { active: [], graveyard: [] }, dungeon: { rooms: [room()] }, meta: { dayNumber: day } })
const lich = (id, o = {}) => ({ instanceId: `l${uid++}`, definitionId: id, assignedRoomId: 'rL', tileX: 6, tileY: 6, worldX: 192, worldY: 192, faction: 'dungeon', aiState: 'fighting', stats: { attack: 20, defense: 0, speed: 0.9 }, resources: { hp: 120, maxHp: 120 }, tags: ['undead', 'caster'], ...o })
const grave = (o = {}) => ({ instanceId: `g${uid++}`, classId: 'knight', tileX: 6, tileY: 6, worldX: 192, worldY: 192, diedOnDay: 5, resources: { hp: 0, maxHp: 120 }, stats: { attack: 12 }, ...o })
const deadMin = (o = {}) => ({ instanceId: `dm${uid++}`, definitionId: 'skeleton1', faction: 'dungeon', assignedRoomId: 'rL', tileX: 6, tileY: 6, worldX: 192, worldY: 192, aiState: 'dead', tags: ['undead'], resources: { hp: 0, maxHp: 40 }, stats: { attack: 8 }, ...o })

// ── T1 Soul Siphon — a hero corpse in the room banks a soul (counted once) ──
{
  scene.time.now = 10000
  const G = g2(); const L = lich('lich1'); G.minions.push(L)
  const gv = grave(); G.adventurers.graveyard.push(gv)
  const ab = abOf('lich1', 'soulHarvest')
  MA._soulHarvest(L, scene, G, ab)
  check('T1 a fresh hero corpse banks one soul', L._souls === 1, `souls=${L._souls}`)
  check('T1 the corpse is flagged harvested (counted once)', gv._soulHarvested === true)
  MA._soulHarvest(L, scene, G, ab)
  check('T1 the same corpse is NOT harvested twice', L._souls === 1, `souls=${L._souls}`)
}
// a corpse from another DAY or another room is ignored
{
  const G = g2(5); const L = lich('lich1'); G.minions.push(L)
  G.adventurers.graveyard.push(grave({ diedOnDay: 3 }))          // old day
  G.adventurers.graveyard.push(grave({ tileX: 40, tileY: 40 }))  // out of room
  MA._soulHarvest(L, scene, G, abOf('lich1', 'soulHarvest'))
  check('T1 ignores a corpse from another day / another room', (L._souls ?? 0) === 0, `souls=${L._souls}`)
}
// a fallen DUNGEON MINION in the room banks a soul too
{
  const G = g2(); const L = lich('lich1'); G.minions.push(L)
  const dm = deadMin(); G.minions.push(dm)
  MA._soulHarvest(L, scene, G, abOf('lich1', 'soulHarvest'))
  check('T1 a fallen dungeon minion banks a soul', L._souls === 1, `souls=${L._souls}`)
  check('T1 the fallen minion is flagged harvested', dm._soulHarvested === true)
}
// souls are capped at soulCap
{
  const G = g2(); const L = lich('lich1'); G.minions.push(L)
  const ab = abOf('lich1', 'soulHarvest')
  for (let i = 0; i < 20; i++) G.adventurers.graveyard.push(grave())
  MA._soulHarvest(L, scene, G, ab)
  check('T1 souls cap at soulCap', L._souls === (ab.soulCap ?? 8), `souls=${L._souls}`)
}

// ── soulAtkMul — banked souls scale the Lich's attack ──
{
  const L = lich('lich1', { _souls: 4, _soulCap: 8, _perSoulAtk: 0.07 })
  check('soulAtkMul scales with souls (4 × 0.07 = +28%)', near(MA.soulAtkMul(L, scene), 1.28), `mul=${MA.soulAtkMul(L, scene)}`)
  const none = lich('lich1', { _souls: 0 })
  check('soulAtkMul is 1 with no souls', near(MA.soulAtkMul(none, scene), 1))
}

// ── T2 Soul Conduit — share the soul-power to nearby undead allies ──
{
  const G = g2(); const L = lich('lich2', { _souls: 0 }); G.minions.push(L)
  const ally = { instanceId: 'al', faction: 'dungeon', assignedRoomId: 'rL', tileX: 7, tileY: 6, worldX: 224, worldY: 192, aiState: 'fighting', tags: ['undead'], resources: { hp: 30, maxHp: 30 }, stats: { attack: 10 } }
  const living = { instanceId: 'lv', faction: 'dungeon', assignedRoomId: 'rL', tileX: 7, tileY: 7, aiState: 'fighting', tags: ['beast'], resources: { hp: 30, maxHp: 30 }, stats: { attack: 10 } }
  G.minions.push(ally, living)
  G.adventurers.graveyard.push(grave(), grave())
  const ab = abOf('lich2', 'soulHarvest')
  MA._soulHarvest(L, scene, G, ab)
  check('T2 lich banks souls', L._souls === 2, `souls=${L._souls}`)
  check('T2 Soul Conduit stamps a share window on a nearby UNDEAD ally', (ally._soulShareUntil ?? 0) > scene.time.now && ally._soulShareMul > 1, `mul=${ally._soulShareMul}`)
  check('T2 Soul Conduit does NOT buff a non-undead ally', !((living._soulShareUntil ?? 0) > scene.time.now))
  check('soulAtkMul reads the ally share window', near(MA.soulAtkMul(ally, scene), ally._soulShareMul))
}

// ── T3 Soul Storm — spend the bank in a room AoE, then reset ──
{
  const G = g2(); const T = lich('elder_lich', { _souls: 6 }); G.minions.push(T)
  const h1 = { instanceId: 'h1', classId: 'knight', faction: 'adventurer', tileX: 3, tileY: 3, worldX: 96, worldY: 96, aiState: 'walking', resources: { hp: 500, maxHp: 500 } }
  const hFar = { instanceId: 'hf', classId: 'knight', faction: 'adventurer', tileX: 40, tileY: 40, aiState: 'walking', resources: { hp: 500, maxHp: 500 } }
  G.adventurers.active.push(h1, hFar)
  const ab = abOf('elder_lich', 'soulStorm')
  const expect = (ab.baseDmg ?? 8) + 6 * (ab.dmgPerSoul ?? 4)
  MA._soulStorm(T, scene, G, ab)
  check('T3 Soul Storm damages a room hero = base + souls×perSoul', h1.resources.hp === 500 - expect, `hp=${h1.resources.hp} expect-${expect}`)
  check('T3 Soul Storm spares a hero out of the room', hFar.resources.hp === 500)
  check('T3 Soul Storm SPENDS the souls (reset to 0)', T._souls === 0, `souls=${T._souls}`)
}

// ── T3 Phylactery — first death intercepted + revived; second is permanent ──
{
  scene.time.now += 5000
  const T = lich('elder_lich', { _souls: 5, resources: { hp: 0, maxHp: 120 } })
  const r1 = MA.onMinionDying(scene, T, gs)
  check('T3 phylactery intercepts the FIRST death', r1 === true && T.aiState === 'dead')
  check('T3 phylactery schedules a timed revive', (T._phylacteryReviveAt ?? 0) > scene.time.now)
  check('T3 phylactery keeps its souls (keepSouls)', T._souls === 5, `souls=${T._souls}`)
  // tickLich revives once the delay elapses
  scene.time.now = T._phylacteryReviveAt + 10
  MA.tickLich(scene, { minions: [T] })
  check('tickLich resurrects the lich at a fraction of HP', T.aiState !== 'dead' && T.resources.hp === Math.round(120 * 0.5), `hp=${T.resources.hp}`)
  // a SECOND death falls through (phylactery spent)
  T.resources.hp = 0
  const r2 = MA.onMinionDying(scene, T, gs)
  check('T3 the SECOND death is permanent (not intercepted)', r2 === false)
}

// ── CombatSystem integration — a soul-charged lich hits harder ──
{
  const savedGrid = scene.dungeonGrid
  scene.dungeonGrid = { getTileType: () => 'floor', getRoomAtTile: () => ({ instanceId: 'rCb' }) }
  scene.time.now += 10000
  const mkHero = () => ({ instanceId: `t${uid++}`, classId: 'knight', faction: 'adventurer', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 1, resources: { hp: 100000, maxHp: 100000 }, stats: { attack: 0, defense: 0, speed: 1 }, lastAttackAt: 0 })
  const mkLich = (souls) => ({ instanceId: `cl${uid++}`, definitionId: 'lich1', faction: 'dungeon', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, attackRange: 3, damageType: 'psychic', stats: { attack: 30, defense: 0, speed: 1 }, resources: { hp: 100, maxHp: 100 }, lastAttackAt: 0, _souls: souls, _soulCap: 8, _perSoulAtk: 0.07 })
  const swing = (souls) => { const L = mkLich(souls), h = mkHero(); let sum = 0; for (let i = 0; i < 12; i++) { h.resources.hp = 100000; L.lastAttackAt = 0; scene.time.now += 5000; cs.tryAttack(L, h); sum += 100000 - h.resources.hp } return sum }
  const calm = swing(0), charged = swing(8)
  check('CombatSystem: a soul-charged lich deals MORE damage', charged > calm * 1.3, `calm=${calm} charged=${charged}`)
  scene.dungeonGrid = savedGrid
}

// ── resetOneShotsForNight clears wave-scoped soul/phylactery state ──
{
  const T = lich('elder_lich', { _souls: 9, _soulShareUntil: 999999, _phylacteryUsed: 1, _phylacteryReviveAt: 123 })
  MA.resetOneShotsForNight(T)
  check('dawn reset empties souls + re-arms the phylactery', T._souls === 0 && T._phylacteryUsed === 0 && T._phylacteryReviveAt == null && (T._soulShareUntil ?? 0) === 0)
}

// ── Data wiring ──
check('lich1 has Soul Harvest', !!abOf('lich1', 'soulHarvest'))
check('lich2 has Soul Harvest + shareUndead', !!abOf('lich2', 'soulHarvest') && abOf('lich2', 'soulHarvest').shareUndead === true)
check('elder_lich has Soul Harvest + Soul Storm + Phylactery', !!abOf('elder_lich', 'soulHarvest') && !!abOf('elder_lich', 'soulStorm') && !!abOf('elder_lich', 'phylactery'))
check('lich2/elder_lich stay UPGRADE-only (unlock 99, gold 0)', byId['lich2'].unlockLevel === 99 && byId['lich2'].goldCost === 0 && byId['elder_lich'].unlockLevel === 99 && byId['elder_lich'].goldCost === 0)
check('elder_lich stays a miniboss', (byId['elder_lich'].tags ?? []).includes('miniboss'))

console.log('\nLich — SOUL HARVEST kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

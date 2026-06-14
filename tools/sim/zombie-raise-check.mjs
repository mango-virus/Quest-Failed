// Headless correctness check for the ZOMBIE chain — mechanic: RAISE THE DEAD.
//   node tools/sim/zombie-raise-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { MinionAbilities } from '../../src/systems/MinionAbilities.js'
import { isPermadeadAtDawn } from '../../src/util/minionRevive.js'

installGlobals()
const scene = makeScene()
const DEFS = scene.cache.json.get('minionTypes')
const byId = Object.fromEntries(DEFS.map(d => [d.id, d]))

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

let uid = 0
function room() { return { instanceId: 'r1', definitionId: 'crypt', gridX: 0, gridY: 0, width: 12, height: 12 } }
function gs() { return { minions: [], adventurers: { active: [], graveyard: [] }, dungeon: { rooms: [room()], hazards: [] }, player: {}, boss: { level: 3 }, _mechanicFlags: {} } }
function minion(id, over = {}) {
  const d = byId[id], b = d.baseStats
  return {
    instanceId: `m${uid++}`, definitionId: id, color: d.color, tags: [...(d.tags ?? [])],
    tileX: 5, tileY: 5, worldX: 160, worldY: 160, assignedRoomId: 'r1', faction: 'dungeon', aiState: 'fighting',
    stats: { attack: b.attack, defense: b.defense ?? 0, speed: b.speed ?? 1, abilities: [] }, resources: { hp: b.hp, maxHp: b.hp }, ...over,
  }
}
function adv(over = {}) { return { instanceId: `a${uid++}`, classId: 'knight', tileX: 5, tileY: 5, worldX: 160, worldY: 160, assignedRoomId: 'r1', aiState: 'fighting', resources: { hp: 0, maxHp: 100 }, ...over } }
const raised = g => g.minions.filter(m => m._raisedZombie)

// T1 Reanimate — a hero killed by a zombie rises as a Risen zombie.
{
  const g = gs(); const z = minion('zombie1'); const a = adv(); g.minions.push(z); g.adventurers.active.push(a)
  MinionAbilities.onAdventurerDied(scene, g, { adventurer: a, killerId: z.instanceId, roomId: 'r1' })
  check('T1 hero killed by a zombie rises as a Risen', raised(g).length === 1, `n=${raised(g).length}`)
  const r = raised(g)[0]
  check('Risen is a garrison zombie, flagged _raisedZombie', r && r._raisedZombie && r.class === 'garrison' && r.definitionId === 'zombie1')
}
// killed by a non-reanimate minion → no raise.
{
  const g = gs(); const s = minion('skeleton1'); const a = adv(); g.minions.push(s)
  MinionAbilities.onAdventurerDied(scene, g, { adventurer: a, killerId: s.instanceId, roomId: 'r1' })
  check('hero killed by a NON-zombie does not rise', raised(g).length === 0)
}
// killed by a RAISED zombie → no raise (recursion gate).
{
  const g = gs(); const z = minion('zombie1'); g.minions.push(z)
  MinionAbilities.onAdventurerDied(scene, g, { adventurer: adv(), killerId: z.instanceId, roomId: 'r1' })   // seed one Risen
  const risen = raised(g)[0]
  MinionAbilities.onAdventurerDied(scene, g, { adventurer: adv(), killerId: risen.instanceId, roomId: 'r1' })
  check('a Risen zombie killing a hero does NOT raise (sterile)', raised(g).length === 1)
}

// T2 Contagion Bite — an infected hero that dies to ANYTHING rises.
{
  const g = gs(); const z = minion('zombie2'); const a = adv({ resources: { hp: 100, maxHp: 100 } }); g.minions.push(z); g.adventurers.active.push(a)
  MinionAbilities.onHit(scene, z, a, 5, g)
  check('T2 rotBite infects the hero', (a._rotInfectedUntil ?? 0) > scene.time.now)
  a.resources.hp = 0
  MinionAbilities.onAdventurerDied(scene, g, { adventurer: a, killerId: 'a_trap_not_a_zombie', roomId: 'r1' })
  check('T2 infected hero killed by ANYTHING rises', raised(g).length === 1)
}
// uninfected hero killed by a non-zombie → no raise.
{
  const g = gs(); const a = adv()
  MinionAbilities.onAdventurerDied(scene, g, { adventurer: a, killerId: 'trap', roomId: 'r1' })
  check('uninfected hero killed by a non-zombie does not rise', raised(g).length === 0)
}

// Room cap — reanimation can't exceed ZOMBIE_ROOM_CAP.
{
  const g = gs(); const z = minion('zombie1'); g.minions.push(z)
  for (let i = 0; i < MinionAbilities.ZOMBIE_ROOM_CAP + 6; i++) MinionAbilities.onAdventurerDied(scene, g, { adventurer: adv(), killerId: z.instanceId, roomId: 'r1' })
  check('reanimation respects the room cap', raised(g).length === MinionAbilities.ZOMBIE_ROOM_CAP, `n=${raised(g).length}`)
}

// T3 Mass Grave — raise a batch from the room graveyard + infect the living; each corpse raises once.
{
  const g = gs(); const crypt = minion('zombie3'); g.minions.push(crypt)
  for (let i = 0; i < 4; i++) g.adventurers.graveyard.push({ instanceId: `grave${i}`, tileX: 5, tileY: 5, worldX: 160, worldY: 160 })
  const live = [adv({ resources: { hp: 100, maxHp: 100 } }), adv({ resources: { hp: 100, maxHp: 100 } })]
  g.adventurers.active.push(...live)
  MinionAbilities._massGrave(crypt, scene, g, { type: 'massGrave', maxRaise: 5, infectMs: 9000 })
  check('T3 Mass Grave raises the room\'s fallen heroes', raised(g).length === 4, `n=${raised(g).length}`)
  check('T3 Mass Grave infects the living', live.every(a => (a._rotInfectedUntil ?? 0) > scene.time.now))
  // fire again — the same corpses don't re-raise.
  MinionAbilities._massGrave(crypt, scene, g, { type: 'massGrave', maxRaise: 5 })
  check('T3 each corpse raises only ONCE', raised(g).length === 4, `n=${raised(g).length}`)
}

// Dawn — raised zombies are wiped (transient, can't build a permanent army).
{
  const g = gs(); const z = minion('zombie1'); g.minions.push(z)
  MinionAbilities.onAdventurerDied(scene, g, { adventurer: adv(), killerId: z.instanceId, roomId: 'r1' })
  const r = raised(g)[0]
  check('Risen zombies are permadead at dawn (wiped)', isPermadeadAtDawn(r, {}) === true)
  check('a placed Shambler is NOT wiped at dawn', isPermadeadAtDawn(z, {}) === false)
}

// Data wiring.
for (const id of ['zombie1', 'zombie2', 'zombie3']) check(`${id} has the reanimate marker`, (byId[id].abilities ?? []).some(a => a.type === 'reanimate'))
check('zombie2 has Contagion Bite (rotBite)', (byId['zombie2'].abilities ?? []).some(a => a.type === 'rotBite'))
check('zombie3 has the Mass Grave ult', (byId['zombie3'].abilities ?? []).some(a => a.type === 'massGrave'))

console.log('\nZombie — RAISE THE DEAD kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

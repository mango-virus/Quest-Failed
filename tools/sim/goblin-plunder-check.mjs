// Headless correctness check for the GOBLIN — PLUNDER (gold-steal) kit.
//   node tools/sim/goblin-plunder-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { MinionAbilities } from '../../src/systems/MinionAbilities.js'

installGlobals()
const scene = makeScene()
const DEFS = scene.cache.json.get('minionTypes')
const byId = Object.fromEntries(DEFS.map(d => [d.id, d]))

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

function room() { return { instanceId: 'r1', definitionId: 'starter_barracks', gridX: 0, gridY: 0, width: 12, height: 12 } }
function gs() { return { minions: [], adventurers: { active: [] }, dungeon: { rooms: [room()], hazards: [] }, player: { gold: 0 }, _mechanicFlags: {} } }
let uid = 0
function minion(id, over = {}) {
  const d = byId[id], b = d.baseStats
  return {
    instanceId: `m${uid++}`, definitionId: id, tags: [...(d.tags ?? [])],
    tileX: 5, tileY: 5, worldX: 160, worldY: 160, assignedRoomId: 'r1', faction: 'dungeon',
    aiState: 'idle', stats: { attack: b.attack, defense: b.defense ?? 0, speed: b.speed ?? 1, abilities: [] },
    resources: { hp: b.hp, maxHp: b.hp }, ...over,
  }
}
function adv(over = {}) { return { instanceId: `a${uid++}`, classId: 'knight', tileX: 5, tileY: 5, worldX: 160, worldY: 160, aiState: 'walking', resources: { hp: 100, maxHp: 100 }, ...over } }
const tick = ms => { scene.time.now += ms }

// T1 Pilfer — goblin1 hit banks +2g.
{
  const g = gs(); const m = minion('goblin1'); const a = adv(); g.minions.push(m); g.adventurers.active.push(a)
  MinionAbilities.onHit(scene, m, a, 5, g)
  check('T1 Pilfer banks +2g on hit', g.player.gold === 2, `gold=${g.player.gold}`)
}
// T2 Mark for Plunder — Cutpurse brands; ANY minion hitting the brand also steals.
{
  const g = gs(); const cut = minion('goblin2'); const a = adv(); g.minions.push(cut); g.adventurers.active.push(a)
  MinionAbilities.onHit(scene, cut, a, 5, g)
  check('T2 applies plunder brand', a._plunderUntil > scene.time.now)
  const goldAfterMark = g.player.gold   // includes Pilfer +2 (and the mark-hit's own marked-steal)
  // A NON-goblin minion (no stealGold) hits the marked hero → marked-steal fires.
  const skel = minion('skeleton1'); g.minions.push(skel)
  MinionAbilities.onHit(scene, skel, a, 5, g)
  check('T2 brand lets other minions steal too', g.player.gold > goldAfterMark, `+${g.player.gold - goldAfterMark}`)
}
// Bleed — branded hero leaks gold over time via tickPlunderMarks.
{
  const g = gs(); const cut = minion('goblin2'); const a = adv(); g.minions.push(cut); g.adventurers.active.push(a)
  MinionAbilities.onHit(scene, cut, a, 5, g)
  const before = g.player.gold
  tick(1500); MinionAbilities.tickPlunderMarks(scene, g, 1500)
  check('Brand bleeds gold over time', g.player.gold > before, `+${g.player.gold - before}`)
}
// T3 Warband's Cut — a Plunder King in the room DOUBLES goblin plunder.
{
  const g = gs(); const king = minion('goblin3'); const pawn = minion('goblin1')
  g.minions.push(king, pawn); const a = adv(); g.adventurers.active.push(a)
  MinionAbilities.onHit(scene, pawn, a, 5, g)
  check("T3 Warband's Cut doubles Pilfer (+4)", g.player.gold === 4, `gold=${g.player.gold}`)
}
// T3 Grand Heist — massMark brands every hero in the King's room.
{
  const g = gs(); const king = minion('goblin3'); g.minions.push(king)
  const a1 = adv({ tileX: 4 }), a2 = adv({ tileX: 7 }); g.adventurers.active.push(a1, a2)
  MinionAbilities.tickAbilities(king, scene, g, null, 8000)
  check('T3 Grand Heist brands every hero in room', a1._plunderUntil > scene.time.now && a2._plunderUntil > scene.time.now)
}
console.log('\nGoblin — PLUNDER kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

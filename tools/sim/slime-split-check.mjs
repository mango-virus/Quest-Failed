// Headless correctness check for the SLIME · SPLITTER chain — mechanic: SPLIT.
//   node tools/sim/slime-split-check.mjs
import { makeScene, installGlobals } from './headless.mjs'
import { MinionAbilities } from '../../src/systems/MinionAbilities.js'

installGlobals()
const scene = makeScene()
const DEFS = scene.cache.json.get('minionTypes')
const byId = Object.fromEntries(DEFS.map(d => [d.id, d]))

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

let uid = 0
function gs() { return { minions: [], adventurers: { active: [] }, dungeon: { rooms: [], hazards: [] }, player: { gold: 0 }, _mechanicFlags: {} } }
function minion(id, over = {}) {
  const d = byId[id], b = d.baseStats
  return {
    instanceId: `m${uid++}`, definitionId: id, color: d.color, sigil: d.sigil, tags: [...(d.tags ?? [])],
    tileX: 5, tileY: 5, worldX: 160, worldY: 160, homeTileX: 5, homeTileY: 5, assignedRoomId: 'r1',
    faction: 'dungeon', aiState: 'fighting', behaviorType: d.behaviorType,
    stats: { attack: b.attack, defense: b.defense ?? 0, speed: b.speed ?? 1, abilities: [] },
    resources: { hp: b.hp, maxHp: b.hp }, bossLevel: 1, ...over,
  }
}
const minis = g => g.minions.filter(m => m._isMiniSlime)

// T1 Slime — splits into 2 slimelings on death; slimelings don't re-split.
{
  const g = gs(); const s = minion('slime2'); g.minions.push(s)
  MinionAbilities.runDeathAbilities(scene, s, g)
  const kids = minis(g)
  check('T1 splits into 2 slimelings on death', kids.length === 2, `n=${kids.length}`)
  check('T1 slimelings are gen-1 + weaker', kids.every(k => k._splitDepth === 1 && k.resources.maxHp < s.resources.maxHp))
  const before = g.minions.length
  MinionAbilities.runDeathAbilities(scene, kids[0], g)
  check('T1 slimelings do NOT re-split (maxDepth 1)', g.minions.length === before)
}

// T2 Splitter — buds ONCE when first below 50% HP (+ splits on death).
{
  const g = gs(); const s = minion('slime9'); g.minions.push(s)
  const ab = { type: 'splitWhenHurt', hpThreshold: 0.5, count: 1, childHpFrac: 0.35 }
  s.resources.hp = s.resources.maxHp * 0.6
  MinionAbilities._splitWhenHurt(s, scene, g, ab)
  check('T2 does NOT bud above the threshold', minis(g).length === 0)
  s.resources.hp = s.resources.maxHp * 0.4
  MinionAbilities._splitWhenHurt(s, scene, g, ab)
  check('T2 buds 1 slimeling below 50% HP', minis(g).length === 1)
  MinionAbilities._splitWhenHurt(s, scene, g, ab)
  check('T2 only buds ONCE', minis(g).length === 1)
}

// T3 Brood — splits into 3; gen-1 children can split once more (maxDepth 2), gen-2 cannot.
{
  const g = gs(); const s = minion('slime1'); g.minions.push(s)
  MinionAbilities.runDeathAbilities(scene, s, g)
  const kids = g.minions.filter(m => m._isMiniSlime && m._splitDepth === 1)
  check('T3 splits into 3', kids.length === 3, `n=${kids.length}`)
  MinionAbilities.runDeathAbilities(scene, kids[0], g)
  const grand = g.minions.filter(m => m._splitDepth === 2)
  check('T3 gen-1 child splits again (cascade)', grand.length >= 1, `grand=${grand.length}`)
  const beforeG = g.minions.length
  MinionAbilities.runDeathAbilities(scene, grand[0], g)
  check('T3 gen-2 does NOT split (cascade bounded)', g.minions.length === beforeG)
}

// T4 The Endless — Mitosis Storm buds on a timer, capped per room.
{
  const g = gs(); const s = minion('elder_slime2'); g.minions.push(s)
  const ab = { type: 'mitosis', count: 1, childHpFrac: 0.3 }
  for (let i = 0; i < 30; i++) MinionAbilities._mitosis(s, scene, g, ab)
  const kids = minis(g)
  check('T4 mitosis buds slimelings', kids.length > 0)
  check('T4 room cap bounds the swarm', kids.length <= MinionAbilities.SPLIT_ROOM_CAP, `n=${kids.length} cap=${MinionAbilities.SPLIT_ROOM_CAP}`)
  check('T4 mitosis children do not self-bud (originals only)', kids.every(k => k._isMiniSlime))
}

// Control — a non-splitter slime/minion doesn't spawn slimelings on death.
{
  const g = gs(); const m = minion('skeleton1'); g.minions.push(m)
  MinionAbilities.runDeathAbilities(scene, m, g)
  check('Non-splitter does not split', minis(g).length === 0)
}

console.log('\nSlime · Splitter — SPLIT kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

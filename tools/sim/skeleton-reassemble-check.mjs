// Headless correctness check for the SKELETON — REASSEMBLY ("they don't stay
// dead") kit. Covers the T1 Risen Bones reassemble lifecycle.
//   node tools/sim/skeleton-reassemble-check.mjs
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
    instanceId: `m${uid++}`, definitionId: id, tags: [...(d.tags ?? [])],
    tileX: 5, tileY: 5, worldX: 160, worldY: 160, assignedRoomId: 'r1', faction: 'dungeon',
    aiState: 'fighting', currentTargetId: 'x',
    stats: { attack: b.attack, defense: b.defense ?? 0, speed: b.speed ?? 1, abilities: [] },
    resources: { hp: 0, maxHp: b.hp }, ...over,   // hp:0 — simulating the moment of death
  }
}
const tick = ms => { scene.time.now += ms }

// 1) First death → reassemble aborts the death (returns true), goes to a
//    self-reviving 'dead' bone pile.
{
  const g = gs(); const m = minion('skeleton1'); g.minions.push(m)
  const aborted = MinionAbilities.onMinionDying(scene, m, g)
  check('First death is aborted (reassemble)', aborted === true, `returned ${aborted}`)
  check('Collapsed to bone pile (dead + hp 0)', m.aiState === 'dead' && m.resources.hp === 0)
  check('Marked reassembling with a future timer', m._reassembling === true && m._reassembleAt > scene.time.now)

  // Before the delay elapses, it stays down.
  tick(1000); MinionAbilities.tickReassemble(scene, g, 1000)
  check('Stays down before the delay', m._reassembling === true && m.resources.hp === 0)

  // After the delay, it clatters back up at ~50% HP.
  tick(2500); MinionAbilities.tickReassemble(scene, g, 2500)
  const want = Math.round(byId.skeleton1.baseStats.hp * 0.5)
  check('Reassembles at 50% HP', m.resources.hp === want, `hp=${m.resources.hp} want=${want}`)
  check('Back on its feet (idle, alive)', m.aiState === 'idle' && !m._reassembling)
  check('Banked one revive', m._reassemblesUsed === 1)

  // 2) Second death → revives are spent, so it dies for real (returns false).
  m.resources.hp = 0
  const aborted2 = MinionAbilities.onMinionDying(scene, m, g)
  check('Second death is NOT aborted (revives spent)', aborted2 === false, `returned ${aborted2}`)
}

// 3) Dawn reset re-arms the revive.
{
  const g = gs(); const m = minion('skeleton1', { _reassemblesUsed: 1, _reassembling: true, _reassembleAt: 999 }); g.minions.push(m)
  MinionAbilities.resetOneShotsForNight(m)
  check('Dawn reset clears collapse + re-arms revive',
    m._reassemblesUsed === 0 && m._reassembling === false && m._reassembleAt === null)
}

// 4) A non-skeleton minion has no reassemble (control).
{
  const g = gs(); const m = minion('slime2'); g.minions.push(m)
  check('Non-skeleton does not reassemble', MinionAbilities.onMinionDying(scene, m, g) === false)
}

function advAt(tx, ty) { return { instanceId: `a${uid++}`, classId: 'knight', tileX: tx, tileY: ty, worldX: tx * 32, worldY: ty * 32, aiState: 'fighting', resources: { hp: 100, maxHp: 100 } } }

// T2 Boneguard — reassembles TWICE; each rise grants a bone-armor shell + a
// bone-shard burst at nearby heroes.
{
  const g = gs(); const b = minion('skeleton2'); b.tileX = 5; b.tileY = 5; g.minions.push(b)
  const a = advAt(5, 5); g.adventurers.active.push(a)
  check('T2 first death aborted', MinionAbilities.onMinionDying(scene, b, g) === true)
  const hpBefore = a.resources.hp
  tick(2600); MinionAbilities.tickReassemble(scene, g, 2600)
  check('T2 rose after first death', b.aiState === 'idle' && b.resources.hp > 0)
  check('T2 rise grants a bone-armor shell', b._boneShellUntil > scene.time.now)
  check('T2 rise flings shards at a nearby hero', a.resources.hp < hpBefore, `dmg=${hpBefore - a.resources.hp}`)
  const mul = MinionAbilities.damageTakenMul(b, { damageType: 'physical' }, g, scene)
  check('T2 bone-armor reduces incoming damage', mul < 1, `mul=${mul}`)
  b.resources.hp = 0
  check('T2 second death aborted', MinionAbilities.onMinionDying(scene, b, g) === true)
  tick(2600); MinionAbilities.tickReassemble(scene, g, 2600)
  check('T2 rose twice (revivesUsed=2)', b.aiState === 'idle' && b._reassemblesUsed === 2)
  b.resources.hp = 0
  check('T2 third death is real (2 revives spent)', MinionAbilities.onMinionDying(scene, b, g) === false)
}

// T3 Grave Knight — Undying Legion raises fallen undead + a near-unkillable
// rapid-revive window where rises are free (no charge spent).
{
  const g = gs(); const k = minion('skeleton3'); k.tileX = 5; k.tileY = 5; g.minions.push(k)
  const fallen = minion('skeleton1'); fallen.tileX = 6; fallen.tileY = 5; fallen.aiState = 'dead'; fallen.resources.hp = 0; g.minions.push(fallen)
  const abUlt = { type: 'undyingLegion', raiseRadiusTiles: 6, rapidReviveMs: 6000, label: 'UNDYING LEGION' }
  const raised = MinionAbilities._undyingLegion(k, scene, g, abUlt)
  check('T3 Undying Legion raises a fallen undead', fallen.aiState === 'idle' && fallen.resources.hp > 0 && raised === 1)
  check('T3 grants the Knight a rapid-revive window', k._reassembleRapidUntil > scene.time.now)
  k.resources.hp = 0
  const usedBefore = k._reassemblesUsed ?? 0
  check('T3 death during ult window is aborted', MinionAbilities.onMinionDying(scene, k, g) === true)
  check('T3 ult-window rise is flagged free', k._reassembleFree === true)
  tick(700); MinionAbilities.tickReassemble(scene, g, 700)
  check('T3 free rise did NOT consume a charge', (k._reassemblesUsed ?? 0) === usedBefore)
}

console.log('\nSkeleton — REASSEMBLY kit checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

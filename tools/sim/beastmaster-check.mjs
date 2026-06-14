// Headless effect-test for the Beast Master rework: Sic 'Em (companion maul) +
// Pack Tactics (flanking damage bonus when the BM and beast share a target).
//   node tools/sim/beastmaster-check.mjs
import { makeScene, installGlobals, EventBus } from './headless.mjs'
import { ClassAbilitySystem } from '../../src/systems/ClassAbilitySystem.js'
import { CombatSystem } from '../../src/systems/CombatSystem.js'

installGlobals()
const scene = makeScene()
scene.dungeonGrid = null   // skip the chainable-proxy same-room gate + grant reachability
if (scene.time) scene.time.now = 100000

let pass = 0, fail = 0; const out = []
const check = (n, c, d = '') => { if (c) { pass++; out.push(`  ✓ ${n}`) } else { fail++; out.push(`  ✗ ${n}${d ? ' — ' + d : ''}`) } }

let uid = 0
const TS = 32
const w = (t) => t * TS + 16
function bm(over = {}) {
  return { instanceId: `bm${uid++}`, classId: 'beast_master', tileX: 6, tileY: 6, worldX: w(6), worldY: w(6),
    resources: { hp: 35, maxHp: 35 }, stats: { attack: 7, defense: 3, speed: 1 }, cooldowns: {}, usesLeftToday: {}, ...over }
}
function companion(bmId, tx, ty) {
  return { instanceId: `c${uid++}`, definitionId: 'wolf', faction: 'adventurer', tamedByAdvId: bmId, aiState: 'idle',
    tileX: tx, tileY: ty, worldX: w(tx), worldY: w(ty), resources: { hp: 30, maxHp: 30 }, stats: { attack: 10, defense: 0, speed: 1 } }
}
function hostile(tx, ty) {
  return { instanceId: `h${uid++}`, definitionId: 'goblin1', faction: 'dungeon', aiState: 'idle',
    tileX: tx, tileY: ty, worldX: w(tx), worldY: w(ty), resources: { hp: 40, maxHp: 40 }, stats: { attack: 5, defense: 2, speed: 1 } }
}
const move = (e, tx, ty) => { e.tileX = tx; e.tileY = ty; e.worldX = w(tx); e.worldY = w(ty) }

// 1. SIC 'EM — the companion mauls a nearby hostile for atk×1.6 − def.
{
  const b = bm(); const c = companion(b.instanceId, 6, 6); const h = hostile(7, 6)
  b.companionId = c.instanceId
  const gs = { adventurers: { active: [b] }, minions: [c, h],
    dungeon: { rooms: [{ instanceId: 'r1', definitionId: 'starter_barracks', gridX: 0, gridY: 0, width: 12, height: 12 }] },
    player: { gold: 0 }, _mechanicFlags: {} }
  const cas = new ClassAbilitySystem(scene, gs)
  let fired = null
  const onTrig = (p) => { if (p?.abilityId === 'sic_em') fired = p.abilityId }
  EventBus.on('ABILITY_TRIGGERED', onTrig)
  const before = h.resources.hp
  cas.devFireAbility(b, 'bm_sic_em', scene.time.now)
  EventBus.off('ABILITY_TRIGGERED', onTrig)
  check('sic_em fires', fired === 'sic_em', `got '${fired}'`)
  check('sic_em mauls the prey', h.resources.hp < before, `${before}->${h.resources.hp}`)
  check('sic_em maul = atk×1.6 − def (14)', before - h.resources.hp === 14, `dealt ${before - h.resources.hp}`)
  check('sic_em sets the beast onto the prey', c.currentTargetId === h.instanceId, `tgt=${c.currentTargetId}`)
}

// 2. PACK TACTICS — flanking bonus when BM + beast both border the target.
{
  const b = bm(); const c = companion(b.instanceId, 15, 15); const t = hostile(7, 6)
  const gs = { adventurers: { active: [b] }, minions: [c, t], player: { gold: 0 }, _mechanicFlags: {} }
  const cb = new CombatSystem(scene, gs)
  // BM attacker: companion far → no bonus; companion adjacent to target → bonus.
  move(b, 6, 6)                          // BM borders target (7,6)
  const bmNoFlank = cb._computeDamage(b, t)
  move(c, 7, 7)                          // beast now borders target too
  const bmFlank = cb._computeDamage(b, t)
  check('pack tactics: BM hits harder when the beast flanks', bmFlank > bmNoFlank, `no=${bmNoFlank} flank=${bmFlank}`)
  // Companion attacker: BM far → no bonus; BM adjacent → bonus.
  move(b, 15, 15)
  const cNoFlank = cb._computeDamage(c, t)
  move(b, 8, 6)                          // BM borders target
  const cFlank = cb._computeDamage(c, t)
  check('pack tactics: beast hits harder when the BM flanks', cFlank > cNoFlank, `no=${cNoFlank} flank=${cFlank}`)
}

console.log('\nBeast Master (Sic \'Em + Pack Tactics) checks\n')
console.log(out.join('\n'))
console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

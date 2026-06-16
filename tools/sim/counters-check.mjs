// Headless check — bestiary COUNTERS: focus-fire + defensive timing (Phase 4).
//
//   node tools/sim/counters-check.mjs
//
// Drives the REAL methods (via Object.create, no Phaser constructor):
//   • AISystem._findEngageableMinion — focus-fire: among in-reach foes, a STUDIED
//     type is preferred over a nearer unstudied one (bounded by FOCUS_BIAS).
//   • ClassAbilitySystem._studiedThreatNear — defensive timing: true only when a
//     STUDIED type at strength ≥ DEFENSE_TIER is within range.
// A stub knowledge source supplies getEnemyCounter (the real one is covered by
// bestiary-check.mjs) so this isolates the counter LOGIC.

import { AISystem } from '../../src/systems/AISystem.js'
import { ClassAbilitySystem } from '../../src/systems/ClassAbilitySystem.js'
import { TILE } from '../../src/systems/DungeonGrid.js'

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

// Stub counter source: golems are STUDIED at full strength; everything else unknown.
const ks = {
  observeMinion() {},
  getEnemyCounter(m) {
    const fam = String(m?.definitionId || m || '').replace(/\d+$/, '')
    if (fam === 'golem')   return { known: true, strength: 1.0, stale: false }
    if (fam === 'skeleton') return { known: true, strength: 0.2, stale: false } // studied but weak (< DEFENSE_TIER)
    return { known: false, strength: 0, stale: false }
  },
}
const FLOOR = TILE.FLOOR ?? 0
const min = (id, def, x, over = {}) => ({
  instanceId: id, definitionId: def, tileX: x, tileY: 0, aiState: 'idle',
  faction: 'dungeon', resources: { hp: 100, maxHp: 100 }, stats: { attack: 10, defense: 0 }, ...over,
})

// ── 1) Focus-fire — studied type preferred over a NEARER unstudied one ───────
console.log('\n[1] Focus-fire: _findEngageableMinion prefers the STUDIED type')
{
  const ai = Object.create(AISystem.prototype)
  ai._scene = { time: { now: 1000 } }
  ai._knowledgeSystem = ks
  ai._dungeonGrid = { getRoomAtTile: () => ({ instanceId: 'r1' }), getTileType: () => FLOOR }
  const adv = { tileX: 0, tileY: 0, attackRange: 6 }

  ai._gameState = { minions: [min('rat', 'rat1', 1), min('golem', 'golem2', 1.4)] }
  ok(ai._findEngageableMinion(adv)?.instanceId === 'golem', 'studied golem @1.4 beats unstudied rat @1.0 (focus bias)')

  // Bias is BOUNDED — a large distance gap still favours the nearer foe.
  ai._gameState = { minions: [min('rat2', 'rat1', 1), min('golemFar', 'golem2', 2.2)] }
  ok(ai._findEngageableMinion(adv)?.instanceId === 'rat2', 'studied golem @2.2 does NOT override the much-nearer rat @1.0')

  // No knowledge → pure nearest (no regression).
  ai._knowledgeSystem = { observeMinion() {}, getEnemyCounter: () => ({ known: false, strength: 0 }) }
  ai._gameState = { minions: [min('a', 'rat1', 1), min('b', 'golem2', 2)] }
  ok(ai._findEngageableMinion(adv)?.instanceId === 'a', 'unknown everything → nearest (focus-fire is a no-op)')
}

// ── 2) Defensive timing — _studiedThreatNear gates on known + strength + range ─
console.log('\n[2] Defensive timing: _studiedThreatNear')
{
  const cas = Object.create(ClassAbilitySystem.prototype)
  cas._scene = { knowledgeSystem: ks }   // no dungeonGrid → _abilityCanReach permissive
  const adv = { tileX: 0, tileY: 0 }

  cas._gameState = { minions: [min('g', 'golem2', 1)] }
  ok(cas._studiedThreatNear(adv, 1.5) === true, 'studied-dangerous golem in range → true (pre-pop guard)')
  ok(cas._studiedThreatNear(adv, 0.5) === false, 'same golem out of range → false')

  cas._gameState = { minions: [min('r', 'rat1', 1)] }
  ok(cas._studiedThreatNear(adv, 1.5) === false, 'unknown type in range → false (reveal gate)')

  cas._gameState = { minions: [min('s', 'skeleton1', 1)] }
  ok(cas._studiedThreatNear(adv, 1.5) === false, 'studied-but-weak (strength 0.2 < DEFENSE_TIER) → false')
}

console.log(fails === 0 ? '\n✅ counters-check: ALL PASS' : `\n❌ counters-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)

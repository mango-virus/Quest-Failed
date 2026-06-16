// Headless check — Layer A competence targeting (AI Intelligence, Phase 2).
//
//   node tools/sim/competence-targeting-check.mjs
//
// Drives the REAL ClassAbilitySystem targeting helpers (via Object.create, no
// Phaser constructor) to verify the "best target, not nearest" upgrade used by
// Monk Stunning Palm + BeastMaster Tame/Sic'Em: _strongestHostileMinion picks
// the scariest reachable foe (ties → nearest), respects range/faction/alive,
// and _nearestHostileMinion still picks the nearest (no regression).

import { ClassAbilitySystem } from '../../src/systems/ClassAbilitySystem.js'

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

// _scene = {} → _realGrid() returns null → _abilityCanReach() is permissive.
const ctx = (minions) => { const c = Object.create(ClassAbilitySystem.prototype); c._scene = {}; c._gameState = { minions }; return c }
const M = (id, x, attack, maxHp, over = {}) => ({
  instanceId: id, tileX: x, tileY: 0, aiState: 'idle', faction: 'dungeon',
  resources: { hp: maxHp, maxHp }, stats: { attack, defense: 0 }, ...over,
})
const adv = { tileX: 0, tileY: 0 }

// ── 1) Strongest beats nearest ───────────────────────────────────────────────
console.log('\n[1] _strongestHostileMinion targets the scariest, not the nearest')
{
  const weakClose   = M('weak', 1, 5, 50)                                // near, feeble
  const strongFar   = M('strong', 4, 30, 200, { aiState: 'engaging' })   // far, deadly
  const c = ctx([weakClose, strongFar])
  ok(c._minionThreat(strongFar) > c._minionThreat(weakClose), 'threat(strong) > threat(weak)')
  ok(c._strongestHostileMinion(adv, 5)?.instanceId === 'strong', 'strongest → the deadly far one')
  ok(c._nearestHostileMinion(adv, 5)?.instanceId === 'weak', 'nearest (unchanged) → the feeble close one')
}

// ── 2) Ties break to the nearer foe ──────────────────────────────────────────
console.log('\n[2] Equal threat → pick the nearer')
{
  const near = M('near', 1, 10, 100)
  const far  = M('far', 3, 10, 100)
  const c = ctx([near, far])
  ok(c._strongestHostileMinion(adv, 5)?.instanceId === 'near', 'tie → nearer')
}

// ── 3) Range + faction + alive filters ───────────────────────────────────────
console.log('\n[3] Filters: range, faction, alive')
{
  const inRange   = M('in', 2, 10, 100)
  const tooFar    = M('out', 9, 99, 999, { aiState: 'engaging' })   // scariest but out of range
  const ally      = M('ally', 1, 99, 999, { faction: 'adventurer' })
  const corpse    = M('dead', 1, 99, 999, { aiState: 'dead', resources: { hp: 0, maxHp: 999 } })
  const c = ctx([inRange, tooFar, ally, corpse])
  ok(c._strongestHostileMinion(adv, 5)?.instanceId === 'in', 'out-of-range / tamed-ally / corpse all excluded')
}

// ── 4) Engaging weight tips the choice ───────────────────────────────────────
console.log('\n[4] Actively-engaging foe is prioritized at equal raw stats')
{
  const idle     = M('idle', 1, 12, 100)
  const engaging = M('engaging', 2, 12, 100, { aiState: 'engaging' })
  const c = ctx([idle, engaging])
  ok(c._strongestHostileMinion(adv, 5)?.instanceId === 'engaging', 'engaging foe chosen over an equal idle one')
}

console.log(fails === 0 ? '\n✅ competence-targeting-check: ALL PASS' : `\n❌ competence-targeting-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)

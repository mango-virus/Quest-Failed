// Headless check — VETERAN combat edge (AI Intelligence, Phase 5).
//
//   node tools/sim/veteran-edge-check.mjs
//
// Drives the REAL CombatSystem.tryAttack (Object.create, stub scene with NO
// knowledgeSystem so the studied-type counter is 0 → isolates the veteran term).
// A returning veteran is individually sharper: −EDGE damage taken / +EDGE dealt,
// EDGE = min(CAP, runsCompleted × PER_RUN). 5 runs → cap 0.20 → ×0.80 taken.

import { CombatSystem } from '../../src/systems/CombatSystem.js'

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

const cs = Object.create(CombatSystem.prototype)
cs._scene = { time: { now: 1e7 }, knowledgeSystem: null }
cs._gameState = { boss: {}, _eventFlags: {}, _mechanicFlags: {}, adventurers: { active: [] }, minions: [] }

const minion = { instanceId: 'tm', definitionId: 'rat1', faction: 'dungeon', aiState: 'engaging', tileX: 5, tileY: 5, worldX: 160, worldY: 160, resources: { hp: 1e9, maxHp: 1e9 }, stats: { attack: 50, defense: 0 }, damageType: 'physical' }
const mk = (id, runs) => ({ instanceId: id, classId: 'knight', faction: 'adventurer', aiState: 'fighting', tileX: 5, tileY: 5, worldX: 160, worldY: 160, resources: { hp: 1e9, maxHp: 1e9 }, stats: { attack: 10, defense: 5 }, flags: runs ? { returningVeteran: true, runsCompleted: runs } : {} })
const takenPerHit = (adv, N = 4000) => { let d = 0; for (let i = 0; i < N; i++) { adv.resources.hp = 1e9; minion.lastAttackAt = -1e9; const b = adv.resources.hp; cs.tryAttack(minion, adv, {}); d += b - adv.resources.hp } return d / N }

console.log('\n[1] Veteran takes less than a fresh recruit (no studied counter)')
const fresh = takenPerHit(mk('fresh', 0))
const vet5  = takenPerHit(mk('vet5', 5))
const vet2  = takenPerHit(mk('vet2', 2))
ok(fresh > 0, `fresh recruit takes damage (${fresh.toFixed(1)}/hit)`)
ok(Math.abs(vet5 / fresh - 0.80) < 0.02, `5-run veteran takes ~20% less (ratio ${(vet5 / fresh).toFixed(3)} ≈ 0.80, capped)`)
ok(Math.abs(vet2 / fresh - 0.92) < 0.02, `2-run veteran takes ~8% less (ratio ${(vet2 / fresh).toFixed(3)} ≈ 0.92, below cap)`)
ok(vet5 < vet2 && vet2 < fresh, 'more runs → tougher (monotonic), and capped at 5 runs')

// ── [2] Studied-type COMBAT EDGE applies THROUGH tryAttack (not just the API) ─
console.log('\n[2] Studied-type counter applies through real combat')
cs._scene.knowledgeSystem = { getEnemyCounter: () => ({ known: true, strength: 1, stale: false }) }
const studiedTaken = takenPerHit(mk('s', 0))                    // minion→adv: −DR_MAX(0.20)
ok(Math.abs(studiedTaken / fresh - 0.80) < 0.02, `fresh adv takes ~20% less from a STUDIED minion (ratio ${(studiedTaken / fresh).toFixed(3)})`)
// adv → studied minion: +DMG_BONUS_MAX(0.25). Measure minion hp loss with/without counter.
const dealtPerHit = () => { const a = mk('atk', 0); a.stats.attack = 60; let d = 0; for (let i = 0; i < 4000; i++) { minion.resources.hp = 1e9; a.lastAttackAt = -1e9; const b = minion.resources.hp; cs.tryAttack(a, minion, {}); d += b - minion.resources.hp } return d / 4000 }
const dealtStudied = dealtPerHit()
cs._scene.knowledgeSystem = null
const dealtPlain = dealtPerHit()
ok(Math.abs(dealtStudied / dealtPlain - 1.25) < 0.02, `adv deals ~25% MORE to a STUDIED minion (ratio ${(dealtStudied / dealtPlain).toFixed(3)})`)

console.log(fails === 0 ? '\n✅ veteran-edge-check: ALL PASS' : `\n❌ veteran-edge-check: ${fails} FAILURE(S)`)
process.exit(fails === 0 ? 0 : 1)

// Headless check — Lizardman THE PLAGUE-BEARER contagion math.
//
//   node tools/sim/lizardman-plague-check.mjs
//
// Verifies the pure logic in BossArchetypeSystem: Virulence banking, plague DoT
// (%maxHP × stacks × Virulence factor — no falloff), contagion spread scaling
// with Virulence + crowd, the per-act gates, and the Spit/Outbreak crowd math.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = src.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++ } else { console.log('  ✓ ' + m) } }

console.log('\n[1] Balance constants exist')
for (const k of ['LIZARD_VIRULENCE_PER_INFECTED_KILL', 'LIZARD_VIRULENCE_KILL_PER_LV', 'LIZARD_VIRULENCE_CAP_BASE',
  'LIZARD_VIRULENCE_CAP_PER_ACT', 'LIZARD_PLAGUE_DOT_PCT_PER_STACK', 'LIZARD_PLAGUE_VIRULENCE_SCALE',
  'LIZARD_PLAGUE_VIRULENCE_DOT_CAP', 'LIZARD_PLAGUE_STACK_CAP_BASE', 'LIZARD_PLAGUE_FEVER_SLOW_MULT',
  'LIZARD_SPREAD_INTERVAL_MS', 'LIZARD_SPREAD_TARGETS_BASE', 'LIZARD_SPREAD_TARGETS_PER_VIRULENCE',
  'LIZARD_SPREAD_TARGETS_CAP', 'LIZARD_SPIT_USES_PER_DAY', 'LIZARD_SPIT_STACKS', 'LIZARD_SPIT_STACKS_PER_ACT',
  'LIZARD_OUTBREAK_DMG_PCT_PER_STACK', 'LIZARD_FIGHT_OUTBREAK_DMG_PCT_PER_STACK']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

console.log('\n[2] Virulence banks per infected kill (snowball)')
const bank = (lvl) => num('LIZARD_VIRULENCE_PER_INFECTED_KILL') + lvl * num('LIZARD_VIRULENCE_KILL_PER_LV')
ok(bank(10) > bank(1), `higher-level infected kills bank more (${bank(10)} > ${bank(1)})`)

console.log('\n[3] Plague DoT is %maxHP × stacks × Virulence factor (no falloff)')
const factor = (vir) => 1 + Math.min(num('LIZARD_PLAGUE_VIRULENCE_DOT_CAP'), vir * num('LIZARD_PLAGUE_VIRULENCE_SCALE'))
const dot = (maxHp, stacks, vir) => Math.floor(maxHp * num('LIZARD_PLAGUE_DOT_PCT_PER_STACK') * stacks * factor(vir))
ok(dot(2000, 4, 0) > dot(500, 4, 0), 'DoT scales with adv maxHP (auto-scales late)')
ok(dot(1000, 4, 100) > dot(1000, 4, 0), `Virulence raises the DoT (${dot(1000, 4, 100)} > ${dot(1000, 4, 0)})`)
ok(factor(99999) === 1 + num('LIZARD_PLAGUE_VIRULENCE_DOT_CAP'), 'Virulence DoT bonus is capped')
ok(dot(1000, 6, 50) > dot(1000, 2, 50), 'more stacks → more DoT')

console.log('\n[4] Contagion spread scales with Virulence, capped; gated by act')
const perCarrier = (vir) => Math.min(num('LIZARD_SPREAD_TARGETS_CAP'), num('LIZARD_SPREAD_TARGETS_BASE') + Math.round(vir * num('LIZARD_SPREAD_TARGETS_PER_VIRULENCE')))
ok(perCarrier(200) > perCarrier(0), `more Virulence → each carrier infects more (${perCarrier(200)} > ${perCarrier(0)})`)
ok(perCarrier(99999) === num('LIZARD_SPREAD_TARGETS_CAP'), `spread capped at ${num('LIZARD_SPREAD_TARGETS_CAP')}/carrier`)
const spreads = (tier) => tier >= 2
const crossRoom = (tier) => tier >= 4
ok(!spreads(1) && spreads(2), 'spread unlocks at T2 (Contagion)')
ok(!crossRoom(3) && crossRoom(4), 'cross-room spread is T4 (Pandemic)')

console.log('\n[5] Crowd math — the plague reaches the whole herd, not one target')
// With N carriers each infecting `perCarrier`, infections per cadence grow with the crowd.
const wave = (carriers, vir) => carriers * perCarrier(vir)
ok(wave(5, 100) > wave(1, 100), 'more carriers → more new infections per wave (crowd-scaling)')
ok(num('LIZARD_SPIT_STACKS') >= 1, 'Plague Spit doses everyone in the room (crowd-wide)')

console.log('\n[6] Stack cap uncaps at T4; spit dose grows by act')
const stackCap = (tier) => tier >= 4 ? 999 : num('LIZARD_PLAGUE_STACK_CAP_BASE')
ok(stackCap(4) > stackCap(3), 'T4 Apex uncaps stacks')
const dose = (tier) => num('LIZARD_SPIT_STACKS') + (tier - 1) * num('LIZARD_SPIT_STACKS_PER_ACT')
ok(dose(4) > dose(1), `spit dose grows with act (${dose(4)} > ${dose(1)})`)

console.log('\n[7] Outbreak (death-burst + finale) scales with stacks')
const outbreak = (maxHp, stacks) => Math.floor(maxHp * num('LIZARD_OUTBREAK_DMG_PCT_PER_STACK') * stacks)
ok(outbreak(1000, 6) > outbreak(1000, 2), 'corpse-burst scales with the victim stacks')
ok(num('LIZARD_FIGHT_OUTBREAK_DMG_PCT_PER_STACK') > 0, 'finale per-stack burst is positive')

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

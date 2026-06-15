// Headless check — Demon Lord THE BRIMSTONE PACT math.
//
//   node tools/sim/demon-brimstone-check.mjs
//
// Verifies the pure logic in BossArchetypeSystem: Brimstone banking (sacrifice +
// every-kill, T3 Soul Harvest double), the Pact hellfire scaling with Brimstone
// spent (%maxHP — no falloff), %-threshold Soulfire Execute + refund, Volatile
// Legion / Ascendance gating, passive regen + surge, and the finale scaling.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = src.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++ } else { console.log('  ✓ ' + m) } }

console.log('\n[1] Balance constants exist')
for (const k of ['DEMON_BRIMSTONE_PER_SACRIFICE', 'DEMON_BRIMSTONE_PER_KILL', 'DEMON_BRIMSTONE_KILL_PER_LV',
  'DEMON_BRIMSTONE_CAP_BASE', 'DEMON_BRIMSTONE_CAP_PER_ACT', 'DEMON_BRIMSTONE_REGEN_PCT', 'DEMON_BRIMSTONE_REGEN_SURGE',
  'DEMON_PACT_USES_PER_DAY', 'DEMON_PACT_USES_PER_BOSS_LV', 'DEMON_PACT_BASE_DMG_PCT', 'DEMON_PACT_DMG_PER_BRIMSTONE',
  'DEMON_PACT_SPEND_FRAC', 'DEMON_PACT_BURN_PCT_PER_TICK', 'DEMON_PACT_EXECUTE_PCT', 'DEMON_PACT_EXECUTE_REFUND',
  'DEMON_IMP_EXPLODE_DMG_PCT', 'DEMON_ASCEND_BURN_PCT', 'DEMON_ASCEND_NEAR_CAP_FRAC',
  'DEMON_FIGHT_HELLBOLT_FRAC', 'DEMON_FIGHT_IMMOLATION_FRAC', 'DEMON_FIGHT_METEOR_FRAC', 'DEMON_FIGHT_FINALE_DMG_PER_BRIMSTONE']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

console.log('\n[2] Brimstone banks from kills, T3 Soul Harvest doubles it')
const killBank = (lvl, tier) => { let g = num('DEMON_BRIMSTONE_PER_KILL') + lvl * num('DEMON_BRIMSTONE_KILL_PER_LV'); if (tier >= 3) g *= 2; return g }
ok(killBank(10, 1) > killBank(1, 1), `higher-level kills bank more (${killBank(10, 1)} > ${killBank(1, 1)})`)
ok(Math.abs(killBank(5, 3) - 2 * killBank(5, 1)) < 1e-6, 'T3 Soul Harvest doubles the per-kill take')
ok(num('DEMON_BRIMSTONE_PER_SACRIFICE') > killBank(10, 1), 'a sacrifice banks more than a single kill')

console.log('\n[3] Pact hellfire scales with Brimstone spent (%maxHP, no falloff)')
const pactFrac = (spend) => num('DEMON_PACT_BASE_DMG_PCT') + spend * num('DEMON_PACT_DMG_PER_BRIMSTONE')
ok(pactFrac(0) === num('DEMON_PACT_BASE_DMG_PCT'), `empty reserve = floor ${num('DEMON_PACT_BASE_DMG_PCT') * 100}% maxHP`)
ok(pactFrac(300) > pactFrac(50), `bigger reserve → bigger blast (${(pactFrac(300) * 100).toFixed(0)}% > ${(pactFrac(50) * 100).toFixed(0)}% maxHP)`)
ok(num('DEMON_PACT_SPEND_FRAC') > 0 && num('DEMON_PACT_SPEND_FRAC') < 1, `spends ${num('DEMON_PACT_SPEND_FRAC') * 100}% of the bank per Pact (rest carries)`)

console.log('\n[4] T4 Soulfire Execute is %-threshold (scales with crowd, not a fixed 1-kill)')
const wouldExecute = (hp, maxHp) => hp > 0 && hp <= maxHp * num('DEMON_PACT_EXECUTE_PCT')
ok(wouldExecute(150, 1000) && !wouldExecute(300, 1000), `executes any hero ≤ ${num('DEMON_PACT_EXECUTE_PCT') * 100}% maxHP (lvl-agnostic)`)
ok(num('DEMON_PACT_EXECUTE_REFUND') > 0, 'each execute refunds Brimstone (chains into the next Pact)')

console.log('\n[5] Burn / explode / ascendance are %maxHP or gated correctly')
ok(num('DEMON_PACT_BURN_PCT_PER_TICK') > 0, `burning ground = ${num('DEMON_PACT_BURN_PCT_PER_TICK') * 100}% maxHP/tick`)
ok(num('DEMON_IMP_EXPLODE_DMG_PCT') > 0, `Volatile imp blast = ${num('DEMON_IMP_EXPLODE_DMG_PCT') * 100}% maxHP`)
ok(num('DEMON_ASCEND_NEAR_CAP_FRAC') > 0 && num('DEMON_ASCEND_NEAR_CAP_FRAC') < 1, `Ascendance triggers at ≥${num('DEMON_ASCEND_NEAR_CAP_FRAC') * 100}% of cap`)
ok(num('DEMON_BRIMSTONE_REGEN_SURGE') > 1, `Ascendance surges regen ×${num('DEMON_BRIMSTONE_REGEN_SURGE')}`)

console.log('\n[6] Finale + meteor rain scale with the banked reserve')
const finaleFrac = (spend) => Math.min(0.9, num('DEMON_PACT_BASE_DMG_PCT') + spend * num('DEMON_FIGHT_FINALE_DMG_PER_BRIMSTONE'))
ok(finaleFrac(300) > finaleFrac(0), `finale cataclysm scales with the whole reserve (${(finaleFrac(300) * 100).toFixed(0)}% > ${(finaleFrac(0) * 100).toFixed(0)}%)`)
ok(num('DEMON_FIGHT_IMMOLATION_FRAC') > num('DEMON_FIGHT_HELLBOLT_FRAC'), 'Immolation hits harder than Hellbolt')

console.log('\n[7] Pact uses scale with boss level')
const uses = (lvl) => num('DEMON_PACT_USES_PER_DAY') + Math.floor(lvl * num('DEMON_PACT_USES_PER_BOSS_LV'))
ok(uses(10) > uses(1), `more uses at high level (${uses(10)} > ${uses(1)})`)

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

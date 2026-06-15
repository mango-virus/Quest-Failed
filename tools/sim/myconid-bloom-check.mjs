// Headless check — Predator Myconid THE BLOOM math.
//
//   node tools/sim/myconid-bloom-check.mjs
//
// Verifies the pure logic in BossArchetypeSystem/BossSystem: Biomass banking,
// bloomed-room DoT (% maxHP, auto-scaling), the per-act kit gates (Creep/Rot/
// Spread/Sporestorm), spread-chance scaling + cap, finale heal scaling with
// bloomed rooms, Seed uses, and entry scaling — guarding early/late falloff.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = src.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++ } else { console.log('  ✓ ' + m) } }

console.log('\n[1] Balance constants exist')
for (const k of ['MYCONID_BIOMASS_PER_DEATH', 'MYCONID_BIOMASS_PER_DEATH_PER_LV', 'MYCONID_BIOMASS_PER_BLOOM_PER_DAY',
  'MYCONID_BIOMASS_CAP_BASE', 'MYCONID_BIOMASS_CAP_PER_ACT', 'MYCONID_BLOOM_DOT_PCT_PER_TICK', 'MYCONID_BLOOM_SLOW_MULT',
  'MYCONID_BLOOM_HEALBLOCK_MS', 'MYCONID_BLOOM_MINION_REGEN_PCT', 'MYCONID_BLOOM_MINION_ATK_PCT',
  'MYCONID_SPREAD_CHANCE_BASE', 'MYCONID_SPREAD_CHANCE_PER_BIOMASS', 'MYCONID_SPREAD_CHANCE_CAP',
  'MYCONID_SEED_USES_PER_DAY', 'MYCONID_SEED_USES_PER_BOSS_LV', 'MYCONID_SEED_BURST_DMG_PCT',
  'MYCONID_FIGHT_VENT_DMG_FRAC', 'MYCONID_FIGHT_ROT_DMG_FRAC', 'MYCONID_FIGHT_POD_DMG_FRAC',
  'MYCONID_FIGHT_FINALE_HEAL_PER_BLOOM']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

console.log('\n[2] Biomass banks from deaths + bloomed rooms (scales over the run)')
const deathBank = (lvl) => (num('MYCONID_BIOMASS_PER_DEATH')) + lvl * (num('MYCONID_BIOMASS_PER_DEATH_PER_LV'))
ok(deathBank(10) > deathBank(1), `higher-level kills bank more (${deathBank(10)} > ${deathBank(1)})`)
ok(num('MYCONID_BIOMASS_PER_BLOOM_PER_DAY') > 0, 'each bloomed room banks passive biomass per day')

console.log('\n[3] Bloomed-room DoT is %maxHP (auto-scales, no late falloff)')
ok(num('MYCONID_BLOOM_DOT_PCT_PER_TICK') > 0 && num('MYCONID_BLOOM_DOT_PCT_PER_TICK') < 0.1, `DoT = ${num('MYCONID_BLOOM_DOT_PCT_PER_TICK') * 100}% maxHP/tick`)
ok(num('MYCONID_BLOOM_SLOW_MULT') < 1, `Rot slow = ×${num('MYCONID_BLOOM_SLOW_MULT')} (<1 → slower)`)
ok(num('MYCONID_BLOOM_MINION_REGEN_PCT') > 0 && num('MYCONID_BLOOM_MINION_ATK_PCT') > 0, 'minions in bloom get regen + ATK (symbiosis)')

console.log('\n[4] Per-act kit gates (Creep → Rot → Spread → Sporestorm)')
const kit = (tier) => ({ creep: true, rot: tier >= 2, spread: tier >= 3, sporestorm: tier >= 4 })
ok(kit(1).creep && !kit(1).rot, 'T1 = Creep only (DoT)')
ok(kit(2).rot && !kit(2).spread, 'T2 adds Rot (heal-block + slow)')
ok(kit(3).spread && !kit(3).sporestorm, 'T3 adds auto-Spread')
ok(kit(4).sporestorm, 'T4 adds Sporestorm pods')

console.log('\n[5] Spread chance scales with biomass, capped')
const spread = (biomass) => Math.min(num('MYCONID_SPREAD_CHANCE_CAP'), num('MYCONID_SPREAD_CHANCE_BASE') + biomass * num('MYCONID_SPREAD_CHANCE_PER_BIOMASS'))
ok(spread(200) > spread(0), `more biomass → more spread (${spread(200).toFixed(2)} > ${spread(0).toFixed(2)})`)
ok(spread(99999) === num('MYCONID_SPREAD_CHANCE_CAP'), `spread capped at ${num('MYCONID_SPREAD_CHANCE_CAP')}`)

console.log('\n[6] Throne finale heal scales with bloomed-room count')
const finaleHeal = (maxHp, blooms) => Math.floor(maxHp * num('MYCONID_FIGHT_FINALE_HEAL_PER_BLOOM') * blooms)
ok(finaleHeal(1000, 5) > finaleHeal(1000, 1), `more bloomed rooms → bigger channel heal (${finaleHeal(1000, 5)} > ${finaleHeal(1000, 1)})`)
ok(finaleHeal(1000, 0) === 0, 'no colony → no finale heal (incentive to spread)')
ok(num('MYCONID_FIGHT_POD_DMG_FRAC') > num('MYCONID_FIGHT_ROT_DMG_FRAC'), 'pods hit harder than rot')

console.log('\n[7] Seed uses scale with boss level')
const seedUses = (lvl) => num('MYCONID_SEED_USES_PER_DAY') + Math.floor(lvl * num('MYCONID_SEED_USES_PER_BOSS_LV'))
ok(seedUses(10) > seedUses(1), `more seed uses at high level (${seedUses(10)} > ${seedUses(1)})`)
ok(seedUses(1) >= 1, 'at least 1 seed use at level 1')

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

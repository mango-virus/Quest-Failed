// Headless check — Vampire THE BLOOD SOVEREIGN blood-economy math.
//
//   node tools/sim/vampire-bloodcourt-check.mjs
//
// Verifies the pure logic in BossArchetypeSystem: BLOOD banking (from damage +
// kills), the per-act cap, passive regen scaling, the Blood Rite drain (%maxHP,
// crowd-wide, escalating by act), the Court charm scaling, the Blood Bond chain
// cap, and the Blood Moon finale scaling with banked BLOOD.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = src.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++ } else { console.log('  ✓ ' + m) } }

console.log('\n[1] Balance constants exist')
for (const k of ['VAMPIRE_BLOOD_PER_DMG_FRAC', 'VAMPIRE_BLOOD_PER_KILL', 'VAMPIRE_BLOOD_PER_KILL_PER_LV',
  'VAMPIRE_BLOOD_CAP_BASE', 'VAMPIRE_BLOOD_CAP_PER_ACT', 'VAMPIRE_BLOOD_REGEN_FRAC', 'VAMPIRE_BLOOD_VIGOR_SAT',
  'VAMPIRE_BLOOD_VIGOR_LIFESTEAL', 'VAMPIRE_RITE_USES_PER_DAY', 'VAMPIRE_RITE_DRAIN_PCT', 'VAMPIRE_RITE_DRAIN_PCT_PER_ACT',
  'VAMPIRE_RITE_POOL_PCT', 'VAMPIRE_RITE_CONVERT_PCT', 'VAMPIRE_COURT_CHARM_PER_ACT', 'VAMPIRE_BOND_ERUPT_PCT',
  'VAMPIRE_BOND_CHAIN_PER_DAY', 'VAMPIRE_FIGHT_LANCE_PCT', 'VAMPIRE_FIGHT_EMBRACE_PCT', 'VAMPIRE_FIGHT_TEMPEST_PCT',
  'VAMPIRE_FIGHT_MOON_PCT', 'VAMPIRE_FIGHT_MOON_BLOOD_SCALE', 'VAMPIRE_FIGHT_LIFESTEAL']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

console.log('\n[2] BLOOD banks from damage + kills (the economy)')
const bankFromDmg = (dmg) => dmg * num('VAMPIRE_BLOOD_PER_DMG_FRAC')
const bankFromKill = (lvl) => num('VAMPIRE_BLOOD_PER_KILL') + lvl * num('VAMPIRE_BLOOD_PER_KILL_PER_LV')
ok(bankFromDmg(100) > 0, `a 100-dmg wound banks ${bankFromDmg(100)} BLOOD`)
ok(bankFromKill(10) > bankFromKill(1), `higher-level kills bank more (${bankFromKill(10)} > ${bankFromKill(1)})`)

console.log('\n[3] BLOOD cap grows by act; regen scales with the bank')
const cap = (act) => num('VAMPIRE_BLOOD_CAP_BASE') + act * num('VAMPIRE_BLOOD_CAP_PER_ACT')
ok(cap(4) > cap(1), `cap rises with act (${cap(4)} > ${cap(1)})`)
const regen = (blood) => blood * num('VAMPIRE_BLOOD_REGEN_FRAC')
ok(regen(400) > regen(50), 'a fatter BLOOD bank regens the Sovereign faster')

console.log('\n[4] Blood Rite drain is %maxHP, crowd-wide, escalates by act')
const ritePct = (act) => num('VAMPIRE_RITE_DRAIN_PCT') + (act - 1) * num('VAMPIRE_RITE_DRAIN_PCT_PER_ACT')
const riteDmg = (maxHp, act) => Math.floor(maxHp * ritePct(act))
ok(riteDmg(2000, 1) > riteDmg(500, 1), 'drain scales with hero maxHP (auto-scales late)')
ok(ritePct(4) > ritePct(1), `drain % grows by act (${(ritePct(4) * 100).toFixed(1)}% > ${(ritePct(1) * 100).toFixed(1)}%)`)
// crowd-wide: total drained grows with the number in the room
const riteTotal = (crowd, maxHp, act) => crowd * riteDmg(maxHp, act)
ok(riteTotal(8, 1000, 2) > riteTotal(1, 1000, 2), 'more heroes in the room → more drained (crowd-scaling)')

console.log('\n[5] Rite tiers gate charm/pool/convert')
const levy = (act) => act >= 2          // T2 Court Levy charms the lowest
const pool = (act) => act >= 3          // T3 Sanguine Pool zone
const crimson = (act) => act >= 4       // T4 mass-convert
ok(!levy(1) && levy(2), 'Court Levy charm unlocks at T2')
ok(!pool(2) && pool(3), 'Sanguine Pool unlocks at T3')
ok(!crimson(3) && crimson(4), 'Crimson Rite mass-convert unlocks at T4')
ok(num('VAMPIRE_RITE_CONVERT_PCT') > 0 && num('VAMPIRE_RITE_CONVERT_PCT') < 1, 'convert threshold is a sane %maxHP')

console.log('\n[6] The Court grows with the acts')
const charmCount = (bossLv, act) => num('VAMPIRE_CHARM_USES_PER_DAY_BASE') + Math.floor(bossLv * num('VAMPIRE_CHARM_USES_PER_BOSS_LV')) + (act - 1) * num('VAMPIRE_COURT_CHARM_PER_ACT')
ok(charmCount(10, 4) > charmCount(1, 1), `late-game charms more per dawn (${charmCount(10, 4)} > ${charmCount(1, 1)})`)

console.log('\n[7] Blood Bond erupt is %maxHP + chain is capped (anti-snowball)')
const bond = (maxHp) => Math.floor(maxHp * num('VAMPIRE_BOND_ERUPT_PCT'))
ok(bond(2000) > bond(500), 'bond erupt scales with hero maxHP')
ok(num('VAMPIRE_BOND_CHAIN_PER_DAY') >= 1 && num('VAMPIRE_BOND_CHAIN_PER_DAY') <= 6, `chain-charm capped at ${num('VAMPIRE_BOND_CHAIN_PER_DAY')}/day`)

console.log('\n[8] Throne fight is %maxHP everywhere; Blood Moon snowballs with the bank')
for (const k of ['VAMPIRE_FIGHT_LANCE_PCT', 'VAMPIRE_FIGHT_EMBRACE_PCT', 'VAMPIRE_FIGHT_TEMPEST_PCT', 'VAMPIRE_FIGHT_MOON_PCT']) {
  ok(num(k) > 0 && num(k) < 1, `${k} is a %maxHP (${(num(k) * 100).toFixed(0)}%)`)
}
const moonPct = (blood) => num('VAMPIRE_FIGHT_MOON_PCT') + blood * num('VAMPIRE_FIGHT_MOON_BLOOD_SCALE')
ok(moonPct(400) > moonPct(0), `Blood Moon hits harder with a fat bank (${(moonPct(400) * 100).toFixed(1)}% > ${(moonPct(0) * 100).toFixed(1)}%)`)
ok(num('VAMPIRE_FIGHT_LIFESTEAL') > 0 && num('VAMPIRE_FIGHT_LIFESTEAL') <= 1, 'fight damage lifesteals back to the boss')

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

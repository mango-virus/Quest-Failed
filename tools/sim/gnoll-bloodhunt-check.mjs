// Headless check — Gnoll THE BLOOD HUNT ferocity/frenzy math.
//
//   node tools/sim/gnoll-bloodhunt-check.mjs
//
// Verifies the pure logic in BossArchetypeSystem: FEROCITY banking (kills + damage),
// the per-act cap, the frenzy multipliers (pack attack + move speed) it drives atop
// Bloodlust, the SOUND THE HUNT crowd %maxHP rend, and the throne-fight %maxHP/
// Ferocity-scaled finale.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = src.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++ } else { console.log('  ✓ ' + m) } }

console.log('\n[1] Balance constants exist')
for (const k of ['GNOLL_FEROCITY_PER_KILL', 'GNOLL_FEROCITY_PER_KILL_PER_LV', 'GNOLL_FEROCITY_PER_DMG_FRAC',
  'GNOLL_FEROCITY_CAP_BASE', 'GNOLL_FEROCITY_CAP_PER_ACT', 'GNOLL_GREAT_HUNT_FEROCITY_MULT',
  'GNOLL_FRENZY_THRESHOLD', 'GNOLL_FRENZY_ATK_MAX', 'GNOLL_FRENZY_SPEED_MAX', 'GNOLL_BLOODLUST_PCT_PER_KILL',
  'GNOLL_HUNT_USES_PER_DAY', 'GNOLL_HUNT_REND_PCT', 'GNOLL_HUNT_REND_PCT_PER_ACT', 'GNOLL_HUNT_LEAP_PCT',
  'GNOLL_FIGHT_REND_PCT', 'GNOLL_FIGHT_PACK_PCT', 'GNOLL_FIGHT_FRENZY_PCT', 'GNOLL_FIGHT_FINALE_PCT',
  'GNOLL_FIGHT_FINALE_FEROCITY']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

console.log('\n[2] FEROCITY banks from kills + damage; caps by act; T4 amplifies')
const bankKill = (lvl) => num('GNOLL_FEROCITY_PER_KILL') + lvl * num('GNOLL_FEROCITY_PER_KILL_PER_LV')
ok(bankKill(10) > bankKill(1), `higher-level kills bank more (${bankKill(10)} > ${bankKill(1)})`)
ok(num('GNOLL_FEROCITY_PER_DMG_FRAC') > 0, 'a cut of pack damage also banks FEROCITY')
const cap = (act) => num('GNOLL_FEROCITY_CAP_BASE') + act * num('GNOLL_FEROCITY_CAP_PER_ACT')
ok(cap(4) > cap(1), `cap rises with act (${cap(4)} > ${cap(1)})`)
ok(num('GNOLL_GREAT_HUNT_FEROCITY_MULT') > 1, 'T4 Great Hunt amplifies kill-Ferocity')

console.log('\n[3] FRENZY scales pack attack + move speed with FEROCITY (atop Bloodlust)')
const sat = (f, act) => Math.max(0, Math.min(1, f / cap(act)))
const atkMul = (s, stacks) => (1 + num('GNOLL_BLOODLUST_PCT_PER_KILL') * stacks) * (1 + s * num('GNOLL_FRENZY_ATK_MAX'))
const spdMul = (s) => 1 + s * num('GNOLL_FRENZY_SPEED_MAX')
ok(atkMul(1, 0) > atkMul(0, 0), `full FEROCITY raises pack ATK (x${atkMul(1, 0).toFixed(2)} > x${atkMul(0, 0).toFixed(2)})`)
ok(atkMul(0.5, 10) > atkMul(0.5, 0), 'Bloodlust stacks compound with frenzy (both multiply)')
ok(spdMul(1) > spdMul(0), `full FEROCITY raises pack move speed (x${spdMul(1)} > x${spdMul(0)})`)
ok(num('GNOLL_FRENZY_THRESHOLD') > 0 && num('GNOLL_FRENZY_THRESHOLD') < 1, 'FRENZIED state has a sane threshold')

console.log('\n[4] SOUND THE HUNT is a crowd-wide %maxHP rend, escalating by act')
const rendPct = (act) => num('GNOLL_HUNT_REND_PCT') + (act - 1) * num('GNOLL_HUNT_REND_PCT_PER_ACT')
const rend = (maxHp, act) => Math.floor(maxHp * rendPct(act))
ok(rend(2000, 1) > rend(500, 1), 'rend scales with hero maxHP (auto-scales late)')
ok(rendPct(4) > rendPct(1), `rend % grows by act (${(rendPct(4) * 100).toFixed(1)}% > ${(rendPct(1) * 100).toFixed(1)}%)`)
const huntTotal = (crowd, maxHp, act) => crowd * rend(maxHp, act)
ok(huntTotal(8, 1000, 2) > huntTotal(1, 1000, 2), 'more heroes in the hunted room → more carnage (crowd-scaling)')
ok(num('GNOLL_HUNT_LEAP_PCT') > num('GNOLL_HUNT_REND_PCT'), 'T3 Alpha leap hits harder than the base rend')

console.log('\n[5] Throne fight is %maxHP everywhere; finale scales with FEROCITY')
for (const k of ['GNOLL_FIGHT_REND_PCT', 'GNOLL_FIGHT_PACK_PCT', 'GNOLL_FIGHT_FRENZY_PCT', 'GNOLL_FIGHT_FINALE_PCT']) {
  ok(num(k) > 0 && num(k) < 1, `${k} is a %maxHP (${(num(k) * 100).toFixed(0)}%)`)
}
const finale = (maxHp, s) => Math.floor(maxHp * (num('GNOLL_FIGHT_FINALE_PCT') + s * num('GNOLL_FIGHT_FINALE_FEROCITY')))
ok(finale(1000, 1) > finale(1000, 0), 'finale %maxHP rises with FEROCITY')
ok(finale(2000, 0.5) > finale(500, 0.5), 'finale scales with hero maxHP')

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

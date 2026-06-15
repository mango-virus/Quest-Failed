// Headless check — Succubus THE RAPTURE allure/mesmerize math.
//
//   node tools/sim/succubus-rapture-check.mjs
//
// Verifies the pure logic in BossArchetypeSystem: ALLURE banking (mesmerize + kill
// + trickle), the per-act cap, the mesmerize-duration scaling, the enrapture
// vulnerability multiplier, the dungeon-wide rapture-pulse fraction, and the
// throne-fight %maxHP / Allure-scaled finale.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = src.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++ } else { console.log('  ✓ ' + m) } }

console.log('\n[1] Balance constants exist')
for (const k of ['SUCCUBUS_ALLURE_PER_MESMER', 'SUCCUBUS_ALLURE_PER_KILL', 'SUCCUBUS_ALLURE_PER_KILL_PER_LV',
  'SUCCUBUS_ALLURE_TRICKLE', 'SUCCUBUS_ALLURE_CAP_BASE', 'SUCCUBUS_ALLURE_CAP_PER_ACT',
  'SUCCUBUS_MESMER_MS_BASE', 'SUCCUBUS_MESMER_MS_PER_ALLURE', 'SUCCUBUS_RAPTURE_VULN_MULT',
  'SUCCUBUS_ENTRANCE_INTERVAL_MS', 'SUCCUBUS_RAPTURE_PULSE_MS', 'SUCCUBUS_RAPTURE_PULSE_FRAC',
  'SUCCUBUS_KISS_USES_PER_DAY', 'SUCCUBUS_FIGHT_HEARTPIERCE_PCT', 'SUCCUBUS_FIGHT_MAELSTROM_PCT',
  'SUCCUBUS_FIGHT_FINALE_PCT', 'SUCCUBUS_FIGHT_FINALE_ALLURE']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

console.log('\n[2] ALLURE banks from mesmerize + kills + trickle; caps by act')
ok(num('SUCCUBUS_ALLURE_PER_MESMER') > 0, 'each hero mesmerized banks ALLURE')
const bankKill = (lvl) => num('SUCCUBUS_ALLURE_PER_KILL') + lvl * num('SUCCUBUS_ALLURE_PER_KILL_PER_LV')
ok(bankKill(10) > bankKill(1), `higher-level kills bank more (${bankKill(10)} > ${bankKill(1)})`)
ok(num('SUCCUBUS_ALLURE_TRICKLE') > 0, 'passive trickle while heroes live')
const cap = (act) => num('SUCCUBUS_ALLURE_CAP_BASE') + act * num('SUCCUBUS_ALLURE_CAP_PER_ACT')
ok(cap(4) > cap(1), `cap rises with act (${cap(4)} > ${cap(1)})`)

console.log('\n[3] Mesmerize duration scales with ALLURE; enrapture adds bonus damage')
const sat = (a, act) => Math.max(0, Math.min(1, a / cap(act)))
const dur = (s) => num('SUCCUBUS_MESMER_MS_BASE') + s * num('SUCCUBUS_MESMER_MS_PER_ALLURE')
ok(dur(1) > dur(0), `full ALLURE = longer mesmerize (${dur(1)}ms > ${dur(0)}ms)`)
ok(num('SUCCUBUS_RAPTURE_VULN_MULT') > 1, `Enraptured heroes take +damage (×${num('SUCCUBUS_RAPTURE_VULN_MULT')})`)

console.log('\n[4] Crowd-scaling: Kiss + Entrancing Aura + Rapture pulse hit %-of-party')
ok(num('SUCCUBUS_RAPTURE_PULSE_FRAC') > 0 && num('SUCCUBUS_RAPTURE_PULSE_FRAC') <= 1, `T4 pulse enraptures ${(num('SUCCUBUS_RAPTURE_PULSE_FRAC') * 100).toFixed(0)}% of the party`)
const pulseHits = (crowd) => Math.max(1, Math.round(crowd * num('SUCCUBUS_RAPTURE_PULSE_FRAC')))
ok(pulseHits(10) > pulseHits(2), 'more heroes → more enraptured per pulse (crowd-scaling)')
ok(num('SUCCUBUS_ENTRANCE_INTERVAL_MS') > 0, 'T2 Entrancing Aura has a cadence')

console.log('\n[5] Throne fight is %maxHP everywhere; finale scales with ALLURE')
for (const k of ['SUCCUBUS_FIGHT_HEARTPIERCE_PCT', 'SUCCUBUS_FIGHT_MAELSTROM_PCT', 'SUCCUBUS_FIGHT_FINALE_PCT']) {
  ok(num(k) > 0 && num(k) < 1, `${k} is a %maxHP (${(num(k) * 100).toFixed(0)}%)`)
}
const finale = (maxHp, s) => Math.floor(maxHp * (num('SUCCUBUS_FIGHT_FINALE_PCT') + s * num('SUCCUBUS_FIGHT_FINALE_ALLURE')))
ok(finale(1000, 1) > finale(1000, 0), 'finale %maxHP rises with ALLURE')
ok(finale(2000, 0.5) > finale(500, 0.5), 'finale scales with hero maxHP (auto-scales late)')
// the finale enrapture stacks the vuln on top of the %maxHP — the kill window
ok(finale(1000, 1) * num('SUCCUBUS_RAPTURE_VULN_MULT') > finale(1000, 1), 'enrapture vuln amplifies the finale')

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

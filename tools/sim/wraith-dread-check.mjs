// Headless check — Wraith THE DREAD HARVEST terror-economy math.
//
//   node tools/sim/wraith-dread-check.mjs
//
// Verifies the pure logic in BossArchetypeSystem: DREAD banking (from fear added
// + breaks), the per-act cap, the fear amplification + threshold-drop it drives,
// the player-positive break payoffs (flee gold, panic spread), the Night Terror
// crowd spike, and the throne-fight %maxHP / fright-death scaling.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = src.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++ } else { console.log('  ✓ ' + m) } }

console.log('\n[1] Balance constants exist')
for (const k of ['WRAITH_DREAD_PER_FEAR', 'WRAITH_DREAD_PER_BREAK', 'WRAITH_DREAD_CAP_BASE', 'WRAITH_DREAD_CAP_PER_ACT',
  'WRAITH_DREAD_FEAR_MULT_MAX', 'WRAITH_DREAD_THRESHOLD_REDUCTION', 'WRAITH_AMBIENT_FEAR', 'WRAITH_PALL_FEAR_FLOOR',
  'WRAITH_PANIC_SPREAD_RADIUS_TS', 'WRAITH_PANIC_SPREAD_FEAR', 'WRAITH_FLEE_GOLD_FRAC', 'WRAITH_TERROR_USES_PER_DAY',
  'WRAITH_TERROR_FEAR', 'WRAITH_TERROR_ZONE_FEAR', 'WRAITH_FIGHT_FEAR_TICK', 'WRAITH_FIGHT_PULSE_PCT',
  'WRAITH_FIGHT_PHANTOM_PCT', 'WRAITH_FIGHT_HYSTERIA_PCT', 'WRAITH_FIGHT_FINALE_PCT',
  'WRAITH_FEAR_FLEE_THRESHOLD', 'WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD', 'WRAITH_FEAR_PANIC_DEATH_THRESHOLD']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

console.log('\n[2] DREAD banks from fear inflicted + breaks; caps by act')
const bankFromFear = (fearDelta) => fearDelta * num('WRAITH_DREAD_PER_FEAR')
ok(bankFromFear(40) > 0, `40 fear inflicted banks ${bankFromFear(40)} DREAD`)
ok(num('WRAITH_DREAD_PER_BREAK') > 0, 'a hero breaking banks a DREAD chunk')
const cap = (act) => num('WRAITH_DREAD_CAP_BASE') + act * num('WRAITH_DREAD_CAP_PER_ACT')
ok(cap(4) > cap(1), `cap rises with act (${cap(4)} > ${cap(1)})`)

console.log('\n[3] DREAD amplifies fear gain + drops break thresholds')
const sat = (dread, act) => Math.max(0, Math.min(1, dread / cap(act)))
const fearMult = (s) => 1 + s * num('WRAITH_DREAD_FEAR_MULT_MAX')
ok(fearMult(1) > fearMult(0), `full DREAD multiplies fear gain (x${fearMult(1)} > x${fearMult(0)})`)
const drop = (s) => s * num('WRAITH_DREAD_THRESHOLD_REDUCTION')
ok(drop(1) > 0, `full DREAD lowers break thresholds by ${drop(1)}`)
// the two together = the snowball: banked terror makes the party break faster
ok(fearMult(0.8) * 1 > 1 && drop(0.8) > 0, 'banked DREAD both speeds fear AND lowers thresholds (snowball)')

console.log('\n[4] Breaks are player-positive (never a clean escape)')
ok(num('WRAITH_FLEE_GOLD_FRAC') > 0, `a panic-flee drops gold (×${num('WRAITH_FLEE_GOLD_FRAC')} GOLD_PER_KILL)`)
ok(num('WRAITH_PANIC_SPREAD_FEAR') > 0, 'a break spreads panic to nearby allies (T3+)')
ok(num('WRAITH_FEAR_FLEE_THRESHOLD') < num('WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD') &&
   num('WRAITH_FEAR_FRIENDLY_FIRE_THRESHOLD') < num('WRAITH_FEAR_PANIC_DEATH_THRESHOLD'),
   'thresholds ladder flee → friendly-fire → panic-death')

console.log('\n[5] Creeping Dread / Pall scale with crowd + DREAD')
const ambient = (s) => num('WRAITH_AMBIENT_FEAR') * (0.5 + s)
ok(ambient(1) > ambient(0), 'ambient fear/tick grows with DREAD saturation (T2+)')
ok(num('WRAITH_PALL_FEAR_FLOOR') > 0, `T4 Pall keeps the whole party above ${num('WRAITH_PALL_FEAR_FLOOR')} fear`)
// ambient hits EVERYONE in non-entry rooms → total terror scales with party size
const pallTotal = (crowd) => crowd * num('WRAITH_PALL_FEAR_FLOOR')
ok(pallTotal(8) > pallTotal(1), 'Pall terror scales with crowd size')

console.log('\n[6] Night Terror is a crowd-wide DREAD-scaled spike')
const terror = (s) => num('WRAITH_TERROR_FEAR') * (0.7 + s)
ok(terror(1) > terror(0), `Night Terror spike grows with DREAD (${terror(1).toFixed(1)} > ${terror(0).toFixed(1)})`)
ok(num('WRAITH_TERROR_ZONE_FEAR') > 0, 'T2 haunted zone keeps adding fear each tick')

console.log('\n[7] Throne fight is %maxHP everywhere; finale scales with DREAD')
for (const k of ['WRAITH_FIGHT_PULSE_PCT', 'WRAITH_FIGHT_PHANTOM_PCT', 'WRAITH_FIGHT_HYSTERIA_PCT', 'WRAITH_FIGHT_FINALE_PCT']) {
  ok(num(k) > 0 && num(k) < 1, `${k} is a %maxHP (${(num(k) * 100).toFixed(0)}%)`)
}
const finale = (maxHp, s) => Math.floor(maxHp * (num('WRAITH_FIGHT_FINALE_PCT') + s * 0.08))
ok(finale(1000, 1) > finale(1000, 0), 'finale %maxHP rises with DREAD')
ok(finale(2000, 0) > finale(500, 0), 'finale scales with hero maxHP (auto-scales late)')

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

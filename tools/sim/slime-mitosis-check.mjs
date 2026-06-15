// Headless check — Slime King MITOSIS / THE UNKILLABLE HORDE math.
//
//   node tools/sim/slime-mitosis-check.mjs
//
// Verifies (replicating the pure logic in BossArchetypeSystem/BossSystem): Mass
// growth, the goopling cap, Mitosis Surge count scaling (crowd + Mass, capped),
// the tier-scaled split generation cap, and Mass→entry scaling — guarding against
// early/late falloff (room-wide surge + Mass scaling, deeper horde each act).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = src.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++ } else { console.log('  ✓ ' + m) } }

console.log('\n[1] Balance constants exist')
for (const k of ['SLIME_MASS_PER_ABSORB', 'SLIME_BUD_INTERVAL_MS', 'SLIME_BUD_MAX_ACTIVE', 'SLIME_BUD_MAX_PER_ACT',
  'SLIME_SURGE_BASE_COUNT', 'SLIME_SURGE_PER_VICTIM', 'SLIME_SURGE_PER_MASS', 'SLIME_SURGE_MAX',
  'SLIME_FIGHT_GENCAP_BASE', 'SLIME_FIGHT_GENCAP_PER_TIER', 'SLIME_MASS_SIZE_BONUS']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

console.log('\n[2] Goopling cap grows with act')
const budCap = (act) => (num('SLIME_BUD_MAX_ACTIVE')) + act * (num('SLIME_BUD_MAX_PER_ACT'))
ok(budCap(4) > budCap(1), `cap act4 (${budCap(4)}) > act1 (${budCap(1)})`)

console.log('\n[3] Mitosis Surge count scales with crowd + Mass, capped (no late-game falloff)')
const surge = (advs, mass) => Math.max(1, Math.min(num('SLIME_SURGE_MAX'),
  Math.round(num('SLIME_SURGE_BASE_COUNT') + advs * num('SLIME_SURGE_PER_VICTIM') + mass * num('SLIME_SURGE_PER_MASS'))))
ok(surge(6, 100) > surge(1, 0), `bigger crowd + Mass → bigger surge (${surge(6, 100)} > ${surge(1, 0)})`)
ok(surge(50, 9999) === num('SLIME_SURGE_MAX'), `surge capped at ${num('SLIME_SURGE_MAX')}`)
ok(surge(0, 0) >= 1, 'surge always spawns at least 1')

console.log('\n[4] Split generation cap grows with act (deeper horde each tier)')
const genCap = (act) => Math.floor((act - 1) * num('SLIME_FIGHT_GENCAP_PER_TIER') + num('SLIME_FIGHT_GENCAP_BASE'))
ok(genCap(1) === 2, `T1 gen-cap = ${genCap(1)}`)
ok(genCap(4) >= genCap(1), `T4 gen-cap (${genCap(4)}) >= T1 (${genCap(1)})`)
ok(genCap(4) >= 3, `T4 reaches gen ${genCap(4)} (mini-kings add +1 deeper)`)

console.log('\n[5] Mass → entry scaling (a fat King brings a starting horde)')
const massCap = (act, lvl) => num('SLIME_MASS_CAP_BASE') + act * num('SLIME_MASS_CAP_PER_ACT') + lvl * num('SLIME_MASS_CAP_PER_LEVEL')
const extra = (mass, act, lvl) => { const sat = mass / massCap(act, lvl); return sat >= 0.85 ? 2 : sat >= 0.5 ? 1 : 0 }
ok(extra(0, 1, 1) === 0, 'low Mass → no extra starting blobs')
ok(extra(massCap(2, 3), 2, 3) === 2, 'full Mass → 2 extra starting blobs')

console.log('\n[6] Body size grows with Mass (size bonus > 0)')
ok(num('SLIME_MASS_SIZE_BONUS') > 0, `body scale ×(1 + sat × ${num('SLIME_MASS_SIZE_BONUS')})`)

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

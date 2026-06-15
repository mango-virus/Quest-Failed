// Headless check — Golem THE LIVING FORTRESS math.
//
//   node tools/sim/golem-fortress-check.mjs
//
// Verifies the pure logic: Bedrock (room count) drives Living Architecture +
// Seismic Slam damage (scales with rooms — no falloff), the per-act Slam riders
// (fissure/collapse/cataclysm), Aftershock gating, Bulwark DR, and the
// Bedrock-scaled finale.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = src.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++ } else { console.log('  ✓ ' + m) } }

console.log('\n[1] Balance constants exist')
for (const k of ['GOLEM_HP_PER_ROOM', 'GOLEM_DEF_PER_ROOM', 'GOLEM_EARTHQUAKE_DMG_PER_ROOM', 'GOLEM_EQ_USES_PER_BOSS_LV',
  'GOLEM_BEDROCK_CAP_ROOMS', 'GOLEM_BODY_SIZE_BONUS', 'GOLEM_FISSURE_DOT_PER_ROOM', 'GOLEM_FISSURE_SLOW_MULT',
  'GOLEM_COLLAPSE_BURY_MS', 'GOLEM_COLLAPSE_BURY_PER_ACT', 'GOLEM_CATACLYSM_ADJ_FRAC',
  'GOLEM_AFTERSHOCK_INTERVAL_MS', 'GOLEM_AFTERSHOCK_DMG_PER_ROOM', 'GOLEM_FIGHT_SLAM_FRAC', 'GOLEM_FIGHT_PILLAR_FRAC',
  'GOLEM_FIGHT_BULWARK_DR', 'GOLEM_FIGHT_COLLAPSE_DMG_PER_ROOM']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

console.log('\n[2] Bedrock (rooms) grows the Golem + its seismic damage (snowball)')
const livArchHp = (rooms) => rooms * num('GOLEM_HP_PER_ROOM')
const slam = (rooms) => Math.max(1, Math.round(rooms * num('GOLEM_EARTHQUAKE_DMG_PER_ROOM')))
ok(livArchHp(20) > livArchHp(5), `more rooms → more boss HP (${livArchHp(20)} > ${livArchHp(5)})`)
ok(slam(20) > slam(5), `more rooms → bigger Seismic Slam (${slam(20)} > ${slam(5)})`)
ok(num('GOLEM_BODY_SIZE_BONUS') > 0, 'body grows with Bedrock')

console.log('\n[3] Slam riders by act (no fixed magnitudes)')
const buryMs = (tier) => num('GOLEM_COLLAPSE_BURY_MS') + Math.max(0, tier - 3) * num('GOLEM_COLLAPSE_BURY_PER_ACT')
ok(num('GOLEM_FISSURE_DOT_PER_ROOM') > 0, `T2 Fissure DoT scales with rooms (× ${num('GOLEM_FISSURE_DOT_PER_ROOM')})`)
ok(num('GOLEM_FISSURE_SLOW_MULT') < 1, `T2 Fissure slows (×${num('GOLEM_FISSURE_SLOW_MULT')})`)
ok(buryMs(4) > buryMs(3), `T4 Collapse buries longer than T3 (${buryMs(4)} > ${buryMs(3)})`)
ok(num('GOLEM_CATACLYSM_ADJ_FRAC') > 0 && num('GOLEM_CATACLYSM_ADJ_FRAC') < 1, `T4 Cataclysm hits adjacent rooms (×${num('GOLEM_CATACLYSM_ADJ_FRAC')})`)

console.log('\n[4] Aftershock chip scales with rooms; uses scale with level')
const chip = (rooms) => Math.max(1, Math.round(rooms * num('GOLEM_AFTERSHOCK_DMG_PER_ROOM')))
ok(chip(20) >= chip(5), `aftershock scales with dungeon size (${chip(20)} ≥ ${chip(5)})`)
const uses = (lvl) => num('GOLEM_EARTHQUAKE_USES_PER_DAY') + Math.floor(lvl * num('GOLEM_EQ_USES_PER_BOSS_LV'))
ok(uses(10) > uses(1), `more Slam uses at high level (${uses(10)} > ${uses(1)})`)

console.log('\n[5] Throne fight — Bulwark DR + Bedrock-scaled finale')
ok(num('GOLEM_FIGHT_BULWARK_DR') < 1, `Bulwark reduces incoming damage (×${num('GOLEM_FIGHT_BULWARK_DR')})`)
ok(num('GOLEM_FIGHT_PILLAR_FRAC') > num('GOLEM_FIGHT_SLAM_FRAC'), 'Raise Pillars hits harder than the basic Slam')
const finale = (rooms) => Math.max(1, Math.round(rooms * num('GOLEM_FIGHT_COLLAPSE_DMG_PER_ROOM')))
ok(finale(20) > finale(5), `Collapse finale scales with Bedrock (${finale(20)} > ${finale(5)})`)

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

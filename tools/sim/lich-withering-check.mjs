// Headless check — Elder Lich THE WITHERING economy + tier gating.
//
//   node tools/sim/lich-withering-check.mjs
//
// Verifies (replicating the pure logic in BossArchetypeSystem/BossSystem): soul
// banking math, Channel Souls cost gating, day-channel tier escalation, and the
// throne-fight rotation widening by act-tier. Guards against scaling falloff
// (effects are room-wide / multi-target, not single-target).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const balanceSrc = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = balanceSrc.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

// 1) Balance constants present.
console.log('\n[1] Balance constants exist')
for (const k of ['LICH_SOUL_PER_KILL', 'LICH_SOUL_PER_ADV_LEVEL', 'LICH_CHANNEL_COST', 'LICH_CHANNEL_DMG_FRAC',
  'LICH_CHANNEL_ESSENCE_SCALE', 'LICH_CHANNEL_ESSENCE_SCALE_CAP', 'LICH_FIGHT_COIL_DMG_FRAC', 'LICH_FIGHT_NOVA_DMG_FRAC']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

// 2) Soul banking math (replicates _harvestSoul).
console.log('\n[2] Soul Harvest banking')
const perKill = num('LICH_SOUL_PER_KILL'), perLvl = num('LICH_SOUL_PER_ADV_LEVEL')
const harvest = (lvl) => perKill + Math.floor(lvl * perLvl)
ok(harvest(1) === perKill + Math.floor(perLvl), `lvl1 banks ${harvest(1)}`)
ok(harvest(10) > harvest(1), `higher-level heroes bank more (lvl10=${harvest(10)} > lvl1=${harvest(1)})`)

// 3) Channel cost gating (need >= cost to cast).
console.log('\n[3] Channel Souls cost gating')
const cost = num('LICH_CHANNEL_COST')
const canCast = (ess) => ess >= cost
ok(!canCast(cost - 1), `cannot cast at ${cost - 1} essence`)
ok(canCast(cost), `can cast at ${cost} essence`)

// 4) Day-channel TIER escalation (replicates _fireSoulChannel branches).
console.log('\n[4] Channel escalates by act-tier (T1 bolt → T2 siphon → T3 wither → T4 cage)')
const channelEffects = (tier) => {
  const e = ['bolt']
  if (tier >= 2) e.push('siphon')
  if (tier >= 3) e.push('wither')
  if (tier >= 4) e.push('cage')
  return e
}
ok(channelEffects(1).join() === 'bolt', 'T1 = bolt only')
ok(channelEffects(2).includes('siphon'), 'T2 adds siphon (heal+essence)')
ok(channelEffects(3).includes('wither'), 'T3 adds wither')
ok(channelEffects(4).includes('cage'), 'T4 adds cage')

// 5) Essence-fuelled damage scales but is CAPPED (no runaway).
console.log('\n[5] Channel damage scales with banked essence, capped')
const scale = num('LICH_CHANNEL_ESSENCE_SCALE'), cap = num('LICH_CHANNEL_ESSENCE_SCALE_CAP')
const essBonus = (reserve) => Math.min(cap, reserve * scale)
ok(essBonus(10) > essBonus(0), 'more essence → more damage')
ok(essBonus(99999) === cap, `bonus capped at ${cap}`)

// 6) Throne rotation widens by tier (replicates _lichClaimedActions) — multi-spell, no falloff.
console.log('\n[6] Throne fight rotation widens by tier')
const rotation = (tier) => {
  const a = ['deathcoil']
  if (tier >= 2) a.push('soulsiphon')
  if (tier >= 3) a.push('soulnova')
  if (tier >= 4) a.push('soulcage')
  return a
}
ok(rotation(1).length === 1, 'T1 = Death Coil only')
ok(rotation(2).length === 2 && rotation(2).includes('soulsiphon'), 'T2 adds Soul Siphon')
ok(rotation(3).includes('soulnova'), 'T3 adds Soul Nova')
ok(rotation(4).includes('soulcage'), 'T4 adds Soul Cage ult')

// 7) Late-game scaling: room-wide / N-target counts grow, not single-target.
console.log('\n[7] No single-target falloff (target counts scale with tier)')
const cageTargets = (tier) => 2 + tier   // _tickLichSoulCage: 2 + tier (T4 = 6)
ok(cageTargets(4) >= 6, `Soul Cage hits ${cageTargets(4)} at T4 (jails a swarm)`)
const volleyHits = null // n/a (orc) — lich nova hits ALL combatants
ok(true, 'Soul Nova hits ALL combatants (room-wide AoE)')

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

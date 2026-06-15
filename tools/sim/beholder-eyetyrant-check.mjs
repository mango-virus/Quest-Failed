// Headless check — Beholder EYE TYRANT (boss archetype) ray math.
//
//   node tools/sim/beholder-eyetyrant-check.mjs
//
// Verifies (replicating the pure tier-gating logic in BossArchetypeSystem):
// the fight Eye Barrage ray pool / beam-count per tier, Drain heal + Disintegrate
// magnitudes, the day Tyrant's Gaze tier ladder (silence→slow→petrify→damage),
// gaze uses scaling with boss level, and that damage rides boss.attack so the kit
// stays useful early AND late (no falloff; room-wide → scales with the crowd).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(__dir, '../../src/config/balance.js'), 'utf8')
const num = (k) => { const m = src.match(new RegExp(k + ':\\s*([0-9.]+)')); return m ? parseFloat(m[1]) : undefined }

let fails = 0
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); fails++ } else { console.log('  ✓ ' + m) } }

console.log('\n[1] Balance constants exist')
for (const k of ['BEHOLDER_DRAIN_DMG_FRAC', 'BEHOLDER_DRAIN_HEAL_FRAC', 'BEHOLDER_HEX_MULT', 'BEHOLDER_HEX_MS',
  'BEHOLDER_DISINTEGRATE_DMG_FRAC', 'BEHOLDER_GAZE_USES_PER_DAY', 'BEHOLDER_GAZE_USES_PER_BOSS_LV',
  'BEHOLDER_GAZE_SILENCE_MS', 'BEHOLDER_GAZE_SLOW_MS', 'BEHOLDER_GAZE_SLOW_MULT',
  'BEHOLDER_GAZE_PETRIFY_MS', 'BEHOLDER_GAZE_DMG_FRAC', 'BEHOLDER_PETRIFY_INTERVAL_MS']) {
  ok(num(k) !== undefined, `${k} = ${num(k)}`)
}

// ── Fight Eye Barrage — replicates _fireEyeBarrage's tier gating ──
const rayPool = (tier) => { const p = ['petrify', 'drain']; if (tier >= 2) p.push('hex'); return p }
const beamsPerBeat = (tier) => tier >= 3 ? 2 : 1
const hasDisintegrate = (tier) => tier >= 4

console.log('\n[2] Fight ray pool opens with tier (more eyes each act)')
ok(rayPool(1).join() === 'petrify,drain', 'T1 = Petrify + Drain')
ok(rayPool(2).includes('hex'), 'T2 adds Hex to the rotation')
ok(beamsPerBeat(1) === 1 && beamsPerBeat(3) === 2, 'beams/beat: T1=1 → T3=2')
ok(!hasDisintegrate(3) && hasDisintegrate(4), 'Disintegrate death-ray is T4-only')
ok(rayPool(4).length + (hasDisintegrate(4) ? 1 : 0) > rayPool(1).length, 'T4 fields strictly more ray kinds than T1')

console.log('\n[3] Ray magnitudes ride boss.attack (scale early → late, no falloff)')
const drainDmg = (atk) => Math.max(1, Math.floor(atk * num('BEHOLDER_DRAIN_DMG_FRAC')))
const drainHeal = (atk) => Math.floor(drainDmg(atk) * num('BEHOLDER_DRAIN_HEAL_FRAC'))
const disintDmg = (atk) => Math.max(1, Math.floor(atk * num('BEHOLDER_DISINTEGRATE_DMG_FRAC')))
ok(drainDmg(200) > drainDmg(12), `Drain dmg scales with boss attack (${drainDmg(200)} > ${drainDmg(12)})`)
ok(drainHeal(100) > 0 && drainHeal(100) < drainDmg(100), 'Drain heals the boss a fraction of the damage dealt')
ok(disintDmg(100) > drainDmg(100), `Disintegrate hits harder than Drain (${disintDmg(100)} > ${drainDmg(100)})`)

console.log('\n[4] Hex amplifies the boss’s blows (combat-impactful, not a no-op)')
ok(num('BEHOLDER_HEX_MULT') > 1, `hex vuln mult = ${num('BEHOLDER_HEX_MULT')} (>1 → more damage taken)`)

// ── Day Tyrant's Gaze — replicates _fireGaze's tier ladder ──
const gazeEffects = (tier) => {
  const e = ['silence']
  if (tier >= 2) e.push('slow')
  if (tier >= 3) e.push('petrify')
  if (tier >= 4) e.push('disintegrate')
  return e
}

console.log('\n[5] Tyrant’s Gaze tier ladder (silence → +slow → +petrify → +damage)')
ok(gazeEffects(1).join() === 'silence', 'T1 = Silence only')
ok(gazeEffects(2).includes('slow'), 'T2 adds Slow')
ok(gazeEffects(3).includes('petrify'), 'T3 adds Petrify')
ok(gazeEffects(4).includes('disintegrate'), 'T4 adds Disintegrate damage')
ok(num('BEHOLDER_GAZE_SLOW_MULT') < 1, `slow mult = ${num('BEHOLDER_GAZE_SLOW_MULT')} (<1 → slower)`)

console.log('\n[6] Gaze uses scale with boss level')
const gazeUses = (lvl) => (num('BEHOLDER_GAZE_USES_PER_DAY')) + Math.floor(lvl * num('BEHOLDER_GAZE_USES_PER_BOSS_LV'))
ok(gazeUses(10) > gazeUses(1), `more uses at high level (${gazeUses(10)} > ${gazeUses(1)})`)
ok(gazeUses(1) >= 1, 'at least 1 use at level 1')

console.log('\n[7] Day damage frac is positive (the T4 disintegrate actually bites)')
ok(num('BEHOLDER_GAZE_DMG_FRAC') > 0, `gaze dmg frac = ${num('BEHOLDER_GAZE_DMG_FRAC')}`)

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

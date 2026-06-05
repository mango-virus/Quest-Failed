// Pact-effect sweep. For each pact, run N headless games with it sealed and
// compare survival/kills to a no-pact baseline → a ranked table of which pacts
// actually move the needle. Surfaces balance outliers (a "boon" that's secretly
// a nerf, a curse that's brutal) instead of tuning 95 pacts by feel.
//
//   node tools/sim/pactsweep.mjs                 # all pacts, 10 runs each
//   node tools/sim/pactsweep.mjs --runs 20
//   node tools/sim/pactsweep.mjs --rarity damned --runs 25
//   node tools/sim/pactsweep.mjs --top 12        # only first N pacts (quick)
//   node tools/sim/pactsweep.mjs --json
//
// READ: the player IS the boss, so +Δdays = the pact HELPS the boss survive,
// -Δdays = it makes the run harder (curse / wave amplifier). Sign = boon vs bane.
//
// Caveats (intentional v1): a STATIC defended loadout, no night-building, so
// pacts whose value is "you can build more/better" under-read; global modifiers
// (wave size, boss/minion stats, gold, on-kill effects) read faithfully. With
// ~N runs the per-pact noise is roughly ±(std/√N) days — only |Δ| past that is real.

import { readFileSync } from 'node:fs'
import { runGame } from './harness.mjs'
import { silenceConsole } from './headless.mjs'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const has  = (n) => args.includes('--' + n)
const RUNS   = parseInt(flag('runs', '10'), 10)
const BOSS   = flag('boss', 'lich')
const DAYS   = parseInt(flag('days', '80'), 10)
const RARITY = flag('rarity', null)
const TOP    = flag('top', null) ? parseInt(flag('top', null), 10) : null
const JSON_OUT = has('json')

const LOADOUT = { minions: ['skeleton1', 'skeleton1', 'goblin1', 'goblin1', 'orc1', 'orc1'], traps: ['shooting_arrows', 'spike_pit'] }

let pacts = JSON.parse(readFileSync(new URL('../../src/data/dungeonMechanics.json', import.meta.url), 'utf8'))
if (RARITY) pacts = pacts.filter(p => p.rarity === RARITY)
if (TOP) pacts = pacts.slice(0, TOP)

const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1)
const std  = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) }
const r1 = x => Math.round(x * 10) / 10
const sample = (pactIds, n) => {
  const days = [], kills = []
  for (let i = 0; i < n; i++) { const g = runGame({ boss: BOSS, maxDays: DAYS, loadout: LOADOUT, pacts: pactIds }); days.push(g.daysSurvived); kills.push(g.totalKills) }
  return { days, kills }
}

const totalGames = (pacts.length + 2) * RUNS
process.stderr.write(`sweeping ${pacts.length} pacts × ${RUNS} runs (~${totalGames} games)…\n`)

const restore = silenceConsole()
const t0 = Date.now()
const base = sample([], RUNS * 2)              // sturdier baseline (2× samples)
const baseDays = mean(base.days), baseKills = mean(base.kills)
const noise = std(base.days) / Math.sqrt(RUNS) // rough per-pact Δ noise floor

const rows = []
let done = 0
for (const p of pacts) {
  const s = sample([p.id], RUNS)
  rows.push({ id: p.id, rarity: p.rarity, dDays: r1(mean(s.days) - baseDays), dKills: r1(mean(s.kills) - baseKills), days: r1(mean(s.days)) })
  if (++done % 10 === 0) process.stderr.write(`  ${done}/${pacts.length}\n`)
}
restore()
rows.sort((a, b) => b.dDays - a.dDays)
const elapsed = Date.now() - t0

if (JSON_OUT) {
  console.log(JSON.stringify({ boss: BOSS, runs: RUNS, baseDays: r1(baseDays), baseKills: r1(baseKills), noiseFloor: r1(noise), rows }, null, 2))
} else {
  console.log(`\nQuest Failed — pact-effect sweep (boss=${BOSS}, ${RUNS} runs/pact, ${rows.length} pacts, ${elapsed}ms)`)
  console.log(`baseline: ${r1(baseDays)} days / ${r1(baseKills)} kills (defended, no pact)   ·   Δ noise floor ≈ ±${r1(noise)} days\n`)
  const pad = (s, n) => String(s).padEnd(n), padL = (s, n) => String(s).padStart(n)
  const sig = (d) => Math.abs(d) > noise ? (d > 0 ? '↑boon' : '↓bane') : '·'
  console.log(`  ${pad('PACT', 26)} ${pad('rarity', 10)} ${padL('Δdays', 7)} ${padL('Δkills', 8)} ${padL('days', 6)}  signal`)
  console.log(`  ${'-'.repeat(26)} ${'-'.repeat(10)} ${'-'.repeat(7)} ${'-'.repeat(8)} ${'-'.repeat(6)}  ------`)
  for (const r of rows) {
    const d = r.dDays > 0 ? '+' + r.dDays : '' + r.dDays
    console.log(`  ${pad(r.id, 26)} ${pad(r.rarity, 10)} ${padL(d, 7)} ${padL(r.dKills > 0 ? '+' + r.dKills : r.dKills, 8)} ${padL(r.days, 6)}  ${sig(r.dDays)}`)
  }
  const movers = rows.filter(r => Math.abs(r.dDays) > noise)
  console.log(`\n  ${movers.length}/${rows.length} pacts move survival past the noise floor. Extremes are the balance flags;`)
  console.log(`  near-zero = no measurable effect in a static sim (may be a build-dependent pact — see header caveats).\n`)
}

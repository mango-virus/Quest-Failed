// Batch balance runner. Runs many headless games per config and aggregates the
// outcome distribution — the payoff of the headless harness. Because the sim is
// stochastic (unseeded), N runs give a distribution, which is exactly what a
// balance question needs ("how long does boss X with loadout Y survive?").
//
// USAGE:
//   node tools/sim/balance.mjs                       # default sweep
//   node tools/sim/balance.mjs --runs 50 --days 80   # tune sample size / horizon
//   node tools/sim/balance.mjs --boss lich,demon     # restrict bosses
//   node tools/sim/balance.mjs --json                # machine-readable
//
// It is comparative by design: absolute day counts depend on the loadout, but
// "bare vs defended" or "boss A vs boss B" comparisons are meaningful.

import { runGame } from './harness.mjs'
import { silenceConsole } from './headless.mjs'

// ── args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }
const has  = (name) => args.includes('--' + name)
const RUNS = parseInt(flag('runs', '40'), 10)
const DAYS = parseInt(flag('days', '80'), 10)
const JSON_OUT = has('json')
const BOSSES = (flag('boss', 'lich,demon,slime')).split(',').map(s => s.trim()).filter(Boolean)

// A modest, fixed "starter defense" loadout — the comparison baseline.
const DEFENDED = { minions: ['skeleton1', 'skeleton1', 'goblin1', 'goblin1', 'orc1', 'orc1'], traps: ['shooting_arrows', 'spike_pit'] }
const CONFIGS = []
for (const b of BOSSES) {
  CONFIGS.push({ label: `${b} · bare`,     boss: b, loadout: null })
  CONFIGS.push({ label: `${b} · defended`, boss: b, loadout: DEFENDED })
}

// ── stats helpers ─────────────────────────────────────────────────────────────
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1)
const std  = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) }
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0 }
const r1 = x => Math.round(x * 10) / 10
const pct = (n, d) => d ? Math.round((n / d) * 100) : 0

// ── run ───────────────────────────────────────────────────────────────────────
const t0 = Date.now()
const restore = silenceConsole()
const rows = []
for (const cfg of CONFIGS) {
  const results = []
  for (let i = 0; i < RUNS; i++) results.push(runGame({ boss: cfg.boss, maxDays: DAYS, loadout: cfg.loadout }))
  const days = results.map(r => r.daysSurvived)
  const kills = results.map(r => r.totalKills)
  const lvls = results.map(r => r.finalBossLevel)
  rows.push({
    label: cfg.label,
    runs: RUNS,
    bossDiedPct: pct(results.filter(r => r.outcome === 'bossDied').length, RUNS),
    daysMean: r1(mean(days)), daysStd: r1(std(days)), daysMedian: median(days), daysMin: Math.min(...days), daysMax: Math.max(...days),
    killsMean: r1(mean(kills)),
    finalLvMean: r1(mean(lvls)), finalLvMax: Math.max(...lvls),
  })
}
restore()
const elapsed = Date.now() - t0
const totalGames = CONFIGS.length * RUNS

if (JSON_OUT) {
  console.log(JSON.stringify({ runs: RUNS, days: DAYS, totalGames, elapsedMs: elapsed, rows }, null, 2))
} else {
  console.log(`\nQuest Failed — headless balance sweep`)
  console.log(`${totalGames} games (${CONFIGS.length} configs × ${RUNS} runs, ≤${DAYS} days each) in ${elapsed}ms — ${Math.round(totalGames / (elapsed / 1000))} games/sec\n`)
  const pad = (s, n) => String(s).padEnd(n)
  const padL = (s, n) => String(s).padStart(n)
  console.log(`  ${pad('CONFIG', 20)} ${padL('boss-died', 9)} ${padL('days(mean±sd)', 16)} ${padL('med', 4)} ${padL('min', 4)} ${padL('max', 4)} ${padL('kills', 6)} ${padL('finalLv', 8)}`)
  console.log(`  ${'-'.repeat(20)} ${'-'.repeat(9)} ${'-'.repeat(16)} ${'-'.repeat(4)} ${'-'.repeat(4)} ${'-'.repeat(4)} ${'-'.repeat(6)} ${'-'.repeat(8)}`)
  for (const r of rows) {
    console.log(`  ${pad(r.label, 20)} ${padL(r.bossDiedPct + '%', 9)} ${padL(`${r.daysMean}±${r.daysStd}`, 16)} ${padL(r.daysMedian, 4)} ${padL(r.daysMin, 4)} ${padL(r.daysMax, 4)} ${padL(r.killsMean, 6)} ${padL(`${r.finalLvMean} (${r.finalLvMax})`, 8)}`)
  }
  console.log(`\n  Comparative read: 'defended' vs 'bare' shows the value of a fixed starter loadout;`)
  console.log(`  bosses read near-identical because base fight stats are flat (200/12/10) and this`)
  console.log(`  sim does no night-building, so no boss abilities get unlocked (see STATUS.md).\n`)
}

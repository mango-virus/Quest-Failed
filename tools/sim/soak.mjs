// Soak / fuzz crash-finder. Runs many RANDOMIZED games (random boss × random
// pacts × random build) through the real systems and reports anything that
// throws or corrupts state — with the exact setup to reproduce it. The headless
// sim already exercises real combat/AI/boss/room code across thousands of games;
// this points it at the boss×pact×class combinatorial space no human can play.
//
//   node tools/sim/soak.mjs                 # ~120 randomized games
//   node tools/sim/soak.mjs --runs 500      # deeper soak
//   node tools/sim/soak.mjs --seed-boss lich --pacts 3
//   node tools/sim/soak.mjs --json
//
// Catches three failure classes, deduped, each with an example repro setup:
//   tick-throw     — a system's per-frame update() threw (frame onError)
//   eventbus-throw — an EventBus listener threw (console.error)
//   invariant      — checkGameState found corrupt state (negative gold, NaN
//                    coords, hp>maxHp, non-serializable state, dup ids, …)
//   game-throw     — an exception propagated out of runGame entirely
//
// Repro: re-run the printed setup, e.g. runGame({boss, pacts, build}). Most
// crashes are setup-deterministic, so the setup is the handle (no seeded RNG).

import { readFileSync } from 'node:fs'
import { runGame } from './harness.mjs'
import { checkGameState } from '../../src/dev/DevInvariants.js'
import { silenceConsole } from './headless.mjs'

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }
const has  = (n) => args.includes('--' + n)
const N        = parseInt(flag('runs', '120'), 10)
const MAXPACTS = parseInt(flag('pacts', '3'), 10)
const SEEDBOSS = flag('seed-boss', null)
const JSON_OUT = has('json')

const data = (f) => JSON.parse(readFileSync(new URL('../../src/data/' + f, import.meta.url), 'utf8'))
const BOSSES = SEEDBOSS ? [SEEDBOSS] : data('bossArchetypes.json').map(b => b.id)
const PACTS  = data('dungeonMechanics.json').map(p => p.id)
const DEFENDED = { minions: ['skeleton1', 'skeleton1', 'goblin1', 'goblin1', 'orc1', 'orc1'], traps: ['shooting_arrows', 'spike_pit'] }

const pick   = a => a[Math.floor(Math.random() * a.length)]
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))
const sampleN = (a, n) => { const c = [...a]; const out = []; for (let i = 0; i < n && c.length; i++) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); return out }

function randomSetup() {
  const useBuild = Math.random() < 0.5
  return {
    boss: pick(BOSSES),
    pacts: sampleN(PACTS, randInt(0, MAXPACTS)),
    build: useBuild ? { stipend: 60, minionCapPerLv: 3 } : null,
    loadout: useBuild ? null : DEFENDED,
    maxDays: useBuild ? 18 : 25,   // capped: crashes surface early; we want VARIETY, not depth
  }
}

// ── failure collection (deduped by kind+message; first setup kept as repro) ───
const failures = new Map()
let currentSetup = null, gamesRun = 0
function record(kind, msg) {
  const key = kind + ' | ' + String(msg).slice(0, 160)
  if (!failures.has(key)) failures.set(key, { kind, msg: String(msg).slice(0, 200), count: 0, example: currentSetup })
  failures.get(key).count++
}

// EventBus listener throws surface via console.error — capture them globally.
const restore = silenceConsole()
const realErr = console.error
console.error = (...a) => {
  const m = (String(a[0]) + ' ' + (a.find(x => x && x.message)?.message ?? '')).trim()
  record('eventbus-throw', m)
}

const t0 = Date.now()
for (let i = 0; i < N; i++) {
  currentSetup = randomSetup()
  gamesRun++
  try {
    const g = runGame({
      ...currentSetup,
      onDay: (gs) => { for (const issue of checkGameState(gs)) if (issue.severity === 'error') record('invariant', issue.msg) },
    })
    for (const d of g.days) for (const e of (d.errors ?? [])) record('tick-throw', e)
  } catch (e) {
    record('game-throw', e?.stack?.split('\n').slice(0, 2).join(' ') ?? e?.message ?? e)
  }
  // Each game's full object graph is garbage once `g` goes out of scope, but
  // this tight synchronous loop never yields, so V8 grows the heap toward the
  // limit before collecting — a long run (~80+ games) OOMs even though the live
  // set is tiny (~24MB). A periodic explicit GC keeps it bounded. Guarded so a
  // plain `node soak.mjs` (no --expose-gc) still runs, just without the relief;
  // the npm script passes --expose-gc.
  if (global.gc && (i + 1) % 10 === 0) global.gc()
  if ((i + 1) % 20 === 0) process.stderr.write(`  ${i + 1}/${N} games, ${failures.size} distinct issues\n`)
}
console.error = realErr
restore()
const elapsed = Date.now() - t0

// ── report ────────────────────────────────────────────────────────────────────
const rows = [...failures.values()].sort((a, b) => b.count - a.count)
const reproStr = s => s ? `boss=${s.boss} pacts=[${s.pacts.join(',')}] ${s.build ? 'build' : 'static'}` : '?'

if (JSON_OUT) {
  console.log(JSON.stringify({ games: gamesRun, elapsedMs: elapsed, distinct: rows.length, failures: rows }, null, 2))
} else {
  console.log(`\nQuest Failed — soak / fuzz crash-finder`)
  console.log(`${gamesRun} randomized games in ${(elapsed / 1000).toFixed(0)}s — ${rows.length} distinct issue(s)\n`)
  if (rows.length === 0) {
    console.log('  ✓ No crashes, listener throws, or invariant violations. Clean across the random sweep.\n')
  } else {
    for (const r of rows) {
      console.log(`  ✗ [${r.kind}] ×${r.count}`)
      console.log(`      ${r.msg}`)
      console.log(`      repro: ${reproStr(r.example)}\n`)
    }
    console.log(`  Re-run a repro with: node -e "import('./tools/sim/harness.mjs').then(m=>m.runGame({boss:'<b>',pacts:[...],build:true}))"`)
  }
}
process.exit(rows.some(r => r.kind === 'game-throw') ? 1 : 0)

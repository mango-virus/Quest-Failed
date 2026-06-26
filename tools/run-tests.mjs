#!/usr/bin/env node
// Aggregate regression gate. Runs the static linters + every
// `tools/sim/*-check.mjs` behaviour test — each in its OWN node process so the
// headless harness's global stubs can't leak between tests — summarises
// pass/fail, and exits non-zero if anything failed.
//
//   npm test                 → lints + all *-check.mjs
//   npm test -- orc vampire  → only checks whose filename matches a term (no lints)
//   npm test -- --lints      → only the linters
//
// NOTE: the soak/fuzz (`npm run sim:soak`) is intentionally NOT included — it's
// slow (~75s) and randomized; run it separately when touching a core system.
import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const ROOT = fileURLToPath(new URL('..', import.meta.url))   // tools/ → repo root
const argv = process.argv.slice(2)
const terms = argv.filter(a => !a.startsWith('-'))
const lintsOnly = argv.includes('--lints')
const filtering = terms.length > 0

const LINTS = [
  ['verify-docs', 'tools/verify-docs.mjs'],
  ['lint-content', 'tools/lint-content.mjs'],
  ['lint-vfx', 'tools/lint-vfx.mjs'],
  ['lint-hex', 'tools/lint-hex.mjs'],
  ['lint-syntax', 'tools/lint-syntax.mjs'],
]

let checks = readdirSync(new URL('sim/', import.meta.url))
  .filter(f => f.endsWith('-check.mjs'))
  .sort()
if (filtering) checks = checks.filter(f => terms.some(t => f.includes(t)))

const CONCURRENCY = Math.max(2, (os.cpus()?.length || 4) - 1)
const TIMEOUT_MS = 120000

function run(label, file) {
  return new Promise(resolve => {
    const t0 = Date.now()
    const child = spawn(process.execPath, [file], { cwd: ROOT })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    const timer = setTimeout(() => { out += '\n[timed out]'; child.kill('SIGKILL') }, TIMEOUT_MS)
    child.on('close', code => { clearTimeout(timer); resolve({ label, ok: code === 0, code, out, ms: Date.now() - t0 }) })
    child.on('error', e => { clearTimeout(timer); resolve({ label, ok: false, code: -1, out: String(e), ms: Date.now() - t0 }) })
  })
}

async function pool(tasks) {
  const results = []
  let i = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < tasks.length) { const t = tasks[i++]; results.push(await t()) }
  }))
  return results
}

const jobs = []
if (!filtering || lintsOnly) for (const [name, file] of LINTS) jobs.push(() => run('lint:' + name, file))
if (!lintsOnly) for (const f of checks) jobs.push(() => run('check:' + f.replace('-check.mjs', ''), 'tools/sim/' + f))

if (!jobs.length) { console.log('No matching tests.'); process.exit(0) }

const t0 = Date.now()
console.log(`Running ${jobs.length} task(s), ${CONCURRENCY} at a time…\n`)
const results = (await pool(jobs)).sort((a, b) => a.label.localeCompare(b.label))
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label.padEnd(34)} ${(r.ms / 1000).toFixed(1)}s`)

const failed = results.filter(r => !r.ok)
if (failed.length) {
  console.log(`\n════ ${failed.length} FAILURE(S) ════`)
  for (const r of failed) console.log(`\n### ${r.label} (exit ${r.code})\n${r.out.trim()}`)
}
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(failed.length ? 1 : 0)

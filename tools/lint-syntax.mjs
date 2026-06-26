#!/usr/bin/env node
// Syntax-checks every .js file under src/ via `node --check`.
// Catches SyntaxErrors (unescaped quotes, bad tokens, etc.) before they
// silently break a module at runtime.
//
//   node tools/lint-syntax.mjs
//
// Exits 0 if all files parse OK, 1 if any fail.
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC  = join(ROOT, 'src')

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else if (entry.endsWith('.js')) files.push(full)
  }
  return files
}

const allFiles = walk(SRC)
let fails = 0
const failures = []

for (const file of allFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (e) {
    fails++
    const msg = (e.stderr?.toString() ?? e.stdout?.toString() ?? String(e)).trim()
    failures.push({ file: file.replace(ROOT, ''), msg })
    console.error(`  ✗ ${file.replace(ROOT, '')}`)
    console.error(`    ${msg.split('\n')[0]}`)
  }
}

if (fails === 0) {
  console.log(`✅ lint-syntax: all ${allFiles.length} src files parse OK`)
  process.exit(0)
} else {
  console.error(`\n❌ lint-syntax: ${fails} file(s) failed syntax check`)
  for (const f of failures) {
    console.error(`\n### ${f.file}\n${f.msg}`)
  }
  process.exit(1)
}

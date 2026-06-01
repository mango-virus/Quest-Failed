#!/usr/bin/env node
// verify-docs.mjs — keep STATUS.md's content-count table honest against the
// actual data files. This is the mechanical defense against the doc-drift
// class of bug (e.g. "96 pacts shown as 64", "92 achievements shown as 45")
// that a reconciliation pass on 2026-05-31 had to fix by hand.
//
// USAGE:
//   node tools/verify-docs.mjs            # CHECK mode (default): compare STATUS.md
//                                         # counts to the data files. Exit 1 on any
//                                         # mismatch/missing row. Use in CI / hooks.
//   node tools/verify-docs.mjs --fix      # WRITE mode: rewrite the count cells in
//                                         # STATUS.md to the computed values so the
//                                         # numbers self-generate from the data.
//
// The script's CHECKS list is the canonical "content type -> how to count it" map.
// It does NOT parse the file column of the table (too fragile) — it computes counts
// itself and matches each row by its first-column label. If you add a new content
// type, add a CHECKS entry AND a matching row in STATUS.md's count table.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT      = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA      = resolve(ROOT, 'src', 'data')
const STATUS_MD = resolve(ROOT, 'STATUS.md')

// ── Counters ────────────────────────────────────────────────────────────────
// Count the top-level entries in a data file: array length, or key count for a
// keyed object (e.g. minionEvolutions.json is `{ "<id>": {...}, ... }`).
function jsonCount(file) {
  const j = JSON.parse(readFileSync(resolve(DATA, file), 'utf8'))
  if (Array.isArray(j)) return j.length
  if (j && typeof j === 'object') return Object.keys(j).length
  throw new Error(`${file} is neither an array nor an object`)
}

// companions live in a JS module, not JSON — count COMPANION_ORDER ids.
function companionCount() {
  const src = readFileSync(resolve(ROOT, 'src', 'systems', 'companions.js'), 'utf8')
  const m = src.match(/COMPANION_ORDER\s*=\s*\[([^\]]*)\]/)
  if (!m) throw new Error('COMPANION_ORDER array not found in companions.js')
  return (m[1].match(/'[^']+'|"[^"]+"/g) ?? []).length
}

// ── The canonical checks. `label` MUST match the STATUS.md count-table row's
//    first column exactly. ─────────────────────────────────────────────────
const CHECKS = [
  { label: 'Boss archetypes',          count: () => jsonCount('bossArchetypes.json') },
  { label: 'Rooms',                    count: () => jsonCount('rooms.json') },
  { label: 'Minions',                  count: () => jsonCount('minionTypes.json') },
  { label: 'Evolution chains',         count: () => jsonCount('minionEvolutions.json') },
  { label: 'Traps',                    count: () => jsonCount('trapTypes.json') },
  { label: 'Pacts (dungeon mechanics)',count: () => jsonCount('dungeonMechanics.json') },
  { label: 'Events',                   count: () => jsonCount('events.json') },
  { label: 'Adventurer classes',       count: () => jsonCount('adventurerClasses.json') },
  { label: 'Personalities',            count: () => jsonCount('personalities.json') },
  { label: 'Personality combos',       count: () => jsonCount('personalityCombos.json') },
  { label: 'Companions',               count: companionCount },
  { label: 'Achievements',             count: () => jsonCount('achievements.json') },
]

// ── STATUS.md row parsing ─────────────────────────────────────────────────
// A count row looks like:  | <label> | **N** | `file.json` | notes... |
// We match by trimmed first cell == label, and read the integer in the 2nd cell.
function rowRegexFor(label) {
  // Escape regex metachars in the label, then match the markdown row.
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^(\\|\\s*${esc}\\s*\\|\\s*)([^|]*?)(\\s*\\|)`, 'm')
}

function docCountFor(md, label) {
  const m = md.match(rowRegexFor(label))
  if (!m) return { found: false }
  const digits = m[2].match(/-?\d+/)
  return { found: true, value: digits ? parseInt(digits[0], 10) : null, cell: m[2] }
}

// ── Run ────────────────────────────────────────────────────────────────────
const fix = process.argv.includes('--fix')
let md = readFileSync(STATUS_MD, 'utf8')

const rows = []
let mismatches = 0
let missing = 0

for (const chk of CHECKS) {
  let actual
  try {
    actual = chk.count()
  } catch (e) {
    rows.push({ label: chk.label, doc: '—', actual: `ERR: ${e.message}`, status: 'ERROR' })
    mismatches++
    continue
  }

  const doc = docCountFor(md, chk.label)
  if (!doc.found) {
    rows.push({ label: chk.label, doc: '(no row)', actual, status: 'MISSING' })
    missing++
    continue
  }

  if (doc.value === actual) {
    rows.push({ label: chk.label, doc: doc.value, actual, status: 'OK' })
    continue
  }

  // Mismatch.
  if (fix) {
    // Replace the integer in the 2nd cell, preserving surrounding markup (e.g. **bold**).
    const re = rowRegexFor(chk.label)
    md = md.replace(re, (full, head, cell, tail) => {
      const newCell = /-?\d+/.test(cell)
        ? cell.replace(/-?\d+/, String(actual))
        : ` **${actual}** `
      return head + newCell + tail
    })
    rows.push({ label: chk.label, doc: doc.value, actual, status: 'FIXED' })
  } else {
    rows.push({ label: chk.label, doc: doc.value, actual, status: 'MISMATCH' })
    mismatches++
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)
console.log(`\nSTATUS.md count check  (${fix ? 'FIX' : 'CHECK'} mode)\n`)
console.log(`  ${pad('CONTENT', 28)} ${pad('DOC', 10)} ${pad('ACTUAL', 10)} STATUS`)
console.log(`  ${'-'.repeat(28)} ${'-'.repeat(10)} ${'-'.repeat(10)} ------`)
for (const r of rows) {
  console.log(`  ${pad(r.label, 28)} ${pad(r.doc, 10)} ${pad(r.actual, 10)} ${r.status}`)
}

if (fix) {
  const fixedCount = rows.filter(r => r.status === 'FIXED').length
  if (fixedCount > 0) {
    writeFileSync(STATUS_MD, md)
    console.log(`\n  Updated ${fixedCount} count(s) in STATUS.md.`)
  } else {
    console.log(`\n  Nothing to fix — STATUS.md counts already match the data.`)
  }
  // In fix mode, only ERROR/MISSING are fatal (a mismatch was just fixed).
  const fatal = rows.filter(r => r.status === 'ERROR' || r.status === 'MISSING').length
  process.exit(fatal > 0 ? 1 : 0)
}

if (mismatches > 0 || missing > 0) {
  console.log(`\n  ✗ ${mismatches} mismatch(es), ${missing} missing row(s).`)
  console.log(`    Update STATUS.md (or run \`npm run verify-docs:fix\`) so the counts match the data.\n`)
  process.exit(1)
}
console.log(`\n  ✓ All ${rows.length} content counts in STATUS.md match the data files.\n`)
process.exit(0)

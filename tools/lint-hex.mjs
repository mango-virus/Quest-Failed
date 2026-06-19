#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Raw-hex ratchet lint  ·  npm run lint-hex   (regenerate: npm run lint-hex -- --update)
//
// VISUAL_STANDARDS §1: HUD colour should come from palette tokens (CSS vars) so
// it retints under boss palettes / colour-mode. Hundreds of raw `#hex` literals
// in src/hud/*.js predate that rule. A literal "convert all 642" is mostly churn
// (black/grey structure, intentional sprite palettes, per-cinematic identity),
// so instead this is a RATCHET: it grandfathers the current chromatic raw-hex
// count per file in tools/hex-baseline.json and fails the build only when a file
// gains NEW raw hex — stopping the bleeding without forcing a heroic sweep.
//
// A hex is NOT counted (already fine) when:
//   • the file is an art / sprite palette (ART_ALLOWLIST) — those ARE raw palettes;
//   • it is achromatic (R=G=B, incl. #000/#fff/greys) — no hue, nothing to retint;
//   • it is the value of a CSS custom-property definition (`--name: #hex`) — that
//     IS a token/local-palette declaration (this is what the cinematic→local-vars
//     conversion produces, and what :root-style blocks use);
//   • the line carries a  // hex-ok: <reason>  escape.
//
// To legitimately lower a file's count (after a token sweep) run with --update.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const HUD_DIR      = 'src/hud'
const BASELINE     = 'tools/hex-baseline.json'
const UPDATE       = process.argv.includes('--update')

// Files whose raw hex are genuine pixel-art / sprite palettes (NOT theme colour).
const ART_ALLOWLIST = new Set([
  'sprites.js',
  'inGameSnapshot.js',
  'NemesisPortrait.js',
])

const HEX_RE     = /#[0-9a-fA-F]{3,8}\b/g
const VAR_DEF_RE = /--[\w-]+\s*:\s*#[0-9a-fA-F]{3,8}\b/   // `--foo: #abc` (token def)
const OK_RE      = /\/\/\s*hex-ok:/

// Achromatic = all RGB channels equal (black/white/grey) → no hue → can't retint.
function isAchromatic(hex) {
  let h = hex.slice(1)
  if (h.length === 4 || h.length === 8) h = h.slice(0, h.length - (h.length === 4 ? 1 : 2)) // drop alpha
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length !== 6) return false
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6)
  return r.toLowerCase() === g.toLowerCase() && g.toLowerCase() === b.toLowerCase()
}

// Count the chromatic, non-exempt raw-hex literals in one file's source.
function countLintable(src) {
  let count = 0
  for (const line of src.split('\n')) {
    if (OK_RE.test(line)) continue
    const isVarDef = VAR_DEF_RE.test(line)
    const hits = line.match(HEX_RE)
    if (!hits) continue
    for (const hx of hits) {
      if (isAchromatic(hx)) continue
      // A var-def line exempts ONLY the hex that is the property value; any
      // EXTRA hex on the same line still counts.
      if (isVarDef && line.indexOf(hx) === line.search(VAR_DEF_RE) + line.match(VAR_DEF_RE)[0].indexOf(hx)) continue
      count++
    }
  }
  return count
}

const files = readdirSync(HUD_DIR).filter(f => f.endsWith('.js')).sort()
const current = {}
for (const f of files) {
  if (ART_ALLOWLIST.has(f)) continue
  const rel = `${HUD_DIR}/${f}`
  const n = countLintable(readFileSync(rel, 'utf8'))
  if (n > 0) current[rel] = n
}

console.log('\nRaw-hex ratchet lint — HUD colour should be palette tokens (VISUAL_STANDARDS §1)\n')

if (UPDATE) {
  const total = Object.values(current).reduce((a, b) => a + b, 0)
  writeFileSync(BASELINE, JSON.stringify({
    _comment: 'Grandfathered chromatic raw-hex counts per src/hud/*.js file. Regenerate with: npm run lint-hex -- --update. Counts may only DROP (a ratchet); new raw hex fails the build.',
    total,
    files: current,
  }, null, 2) + '\n')
  console.log(`  ✓ baseline updated — ${total} grandfathered raw-hex literals across ${Object.keys(current).length} files.\n`)
  process.exit(0)
}

let baseline
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).files || {} }
catch { console.log(`  ✗ missing/unreadable ${BASELINE} — generate it: npm run lint-hex -- --update\n`); process.exit(1) }

const regressions = []
for (const [rel, n] of Object.entries(current)) {
  const allowed = baseline[rel] ?? 0
  if (n > allowed) regressions.push({ rel, n, allowed })
}

if (regressions.length) {
  for (const r of regressions) {
    console.log(`  ✗ ${r.rel}  — ${r.n} raw hex (baseline ${r.allowed}, +${r.n - r.allowed} new)`)
  }
  console.log('\n  New raw #hex added to a HUD file. Prefer a palette token so it retints under')
  console.log('  boss palettes / colour-mode:')
  console.log('    • CSS/DOM colour  →  var(--blood) / var(--gold) / var(--rumor) / … (see :root in styles.css)')
  console.log('    • a genuine new palette colour  →  add a token (or a local `--name: #hex` var) and use that')
  console.log('    • an intentional one-off (sprite/canvas draw, deliberate shade)  →  tag the line: // hex-ok: <reason>')
  console.log('  If you legitimately REDUCED a file and want to lock the lower count in:')
  console.log('    npm run lint-hex -- --update\n')
  process.exit(1)
}

const total = Object.values(current).reduce((a, b) => a + b, 0)
console.log(`  ✓ No new raw hex. ${total} grandfathered literals (ratcheting down as the sweep continues).\n`)
process.exit(0)

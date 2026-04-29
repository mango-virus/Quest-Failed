// Targeted mojibake fixer. Operates on raw bytes to avoid over-matching.
// Replaces specific known byte patterns from double-encoded UTF-8.
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), 'src')

// Each entry: [from-bytes, to-bytes, label]. from-bytes is what the file
// currently contains (post-mojibake); to-bytes is the correct UTF-8 encoding
// of the original character.
const RULES = [
  // ── Already-broken multi-step mojibake ─────────────────────────────────
  // Á— (C3 81 E2 80 94) was originally × (C3 97). Got mojibaked + over-cleaned.
  [Buffer.from([0xC3, 0x81, 0xE2, 0x80, 0x94]), Buffer.from([0xC3, 0x97]), 'Á— → ×'],

  // ── Single-pass mojibake of multibyte UTF-8 ────────────────────────────
  // The general pattern: original UTF-8 bytes A B C, when decoded as cp1252,
  // become 3 visible chars; re-encoded as UTF-8 they take 6-9 bytes.
  // We list only the specific ones we know are in the source.

  // â + (cleaned ASCII " for U+201D) + €  — box-drawing horizontal ─ (E2 94 80)
  [Buffer.from([0xC3, 0xA2, 0x22, 0xE2, 0x82, 0xAC]), Buffer.from([0xE2, 0x94, 0x80]), 'â"€ → ─'],

  // â + € + (cleaned ASCII " for U+201D) — em-dash — (E2 80 94)
  [Buffer.from([0xC3, 0xA2, 0xE2, 0x82, 0xAC, 0x22]), Buffer.from([0xE2, 0x80, 0x94]), 'â€" → —'],

  // â + € + ¦ — ellipsis … (E2 80 A6)
  [Buffer.from([0xC3, 0xA2, 0xE2, 0x82, 0xAC, 0xC2, 0xA6]), Buffer.from([0xE2, 0x80, 0xA6]), 'â€¦ → …'],

  // â + š + ¡ — high voltage ⚡ (E2 9A A1)
  [Buffer.from([0xC3, 0xA2, 0xC5, 0xA1, 0xC2, 0xA1]), Buffer.from([0xE2, 0x9A, 0xA1]), 'âš¡ → ⚡'],

  // â + š + (space)  — warning ⚠ (E2 9A A0). Cleanup turned U+00A0 into space.
  [Buffer.from([0xC3, 0xA2, 0xC5, 0xA1, 0x20]), Buffer.from([0xE2, 0x9A, 0xA0, 0x20]), 'âš<sp> → ⚠<sp>'],

  // â + š + (cleaned ASCII " for U+201D) — warning ⚠ followed by cleaned trail
  [Buffer.from([0xC3, 0xA2, 0xC5, 0xA1, 0x22]), Buffer.from([0xE2, 0x9A, 0xA0]), 'âš" → ⚠'],

  // â + † + » — clockwise arrow ↻ (E2 86 BB)
  [Buffer.from([0xC3, 0xA2, 0xE2, 0x80, 0xA0, 0xC2, 0xBB]), Buffer.from([0xE2, 0x86, 0xBB]), 'â†» → ↻'],

  // â + † + (cleaned ASCII ' for U+2019) — right arrow → (E2 86 92)
  [Buffer.from([0xC3, 0xA2, 0xE2, 0x80, 0xA0, 0x27]), Buffer.from([0xE2, 0x86, 0x92]), "â†' → →"],

  // â + ¸ — pause ⏸ U+23F8. Original UTF-8: E2 8F B8. cp1252: â (E2), <ctrl> (8F), ¸ (B8).
  // 8F is undefined in cp1252; many implementations pass through, becoming bytes C2 8F.
  [Buffer.from([0xC3, 0xA2, 0xC2, 0x8F, 0xC2, 0xB8]), Buffer.from([0xE2, 0x8F, 0xB8]), 'â¸ → ⏸'],

  // ── Two-byte mojibake (Â<x>) for U+00A0–U+00FF ─────────────────────────
  // These haven't all been corrupted, but the script previously over-replaced
  // some Ã→Á patterns. The Á was wrong; we already handle Á— above.

  // ── Standalone leftovers ───────────────────────────────────────────────
  // š (C5 A1) — was probably part of âš sequence above. Don't touch standalone.
  // † (E2 80 A0) — was probably part of â† sequence. Don't touch standalone.
]

async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else if (e.isFile() && full.endsWith('.js')) yield full
  }
}

function bufferReplaceAll(haystack, needle, replacement) {
  if (!needle.length) return { result: haystack, count: 0 }
  const parts = []
  let i = 0, count = 0
  while (i < haystack.length) {
    const idx = haystack.indexOf(needle, i)
    if (idx === -1) { parts.push(haystack.subarray(i)); break }
    if (idx > i) parts.push(haystack.subarray(i, idx))
    parts.push(replacement)
    i = idx + needle.length
    count++
  }
  return { result: Buffer.concat(parts), count }
}

let totalFixed = 0
for await (const file of walk(ROOT)) {
  let bytes = await fs.readFile(file)
  let changed = false
  const stats = []
  for (const [from, to, label] of RULES) {
    const { result, count } = bufferReplaceAll(bytes, from, to)
    if (count > 0) {
      bytes = result
      changed = true
      stats.push(`${label} ×${count}`)
    }
  }
  if (changed) {
    await fs.writeFile(file, bytes)
    totalFixed++
    console.log(`FIXED ${path.relative(ROOT, file)}: ${stats.join(', ')}`)
  }
}

console.log(`\n${totalFixed} file(s) repaired.`)

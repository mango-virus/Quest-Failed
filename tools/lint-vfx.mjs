#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// VFX anti-generic lint  ·  npm run lint-vfx
//
// The recurring failure mode (flagged by the user more than once) is reaching for
// a plain circle / ellipse / ring (shockwaveFx, pulseRing) as the MAIN read of an
// effect — the cheap, same-y fallback. This lint makes every round/ring shape in
// the VFX toolkit a CONSCIOUS choice: each such call must carry a
//     // circle-ok: <reason>
// tag (a bubble, a spec dot, a flash core, a deliberate ring) — otherwise it fails
// and you must replace it with a custom shaded silhouette (see _drawBoneSpike /
// _drawAcidColumn / _drawMiasmaPuff for the bar) or justify it.
//
// The intentionally-round PRIMITIVES (pulseRing, shockwaveFx, glowPulseFx,
// sparkleFx, ringFx) are exempt inside their own bodies — they ARE the ring; the
// gate is about NOT leaning on them as a new effect's hero element.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'

const FILES = ['src/ui/AbilityVfx.js']

// Round-shape / ring producers that must be justified when used as a hero element.
const PATTERNS = [
  { re: /\.add\.circle\(/,    what: 'scene.add.circle' },
  { re: /\.add\.ellipse\(/,   what: 'scene.add.ellipse' },
  { re: /\.(pulseRing|shockwaveFx)\(/, what: 'ring primitive' },
]
// Primitives that are SUPPOSED to be round — round shapes inside their bodies are fine.
const EXEMPT_PRIMITIVES = new Set(['pulseRing', 'shockwaveFx', 'glowPulseFx', 'sparkleFx', 'ringFx'])
const METHOD_START = /^ {2}([A-Za-z_]\w*)\s*\(scene/   // `  name(scene, ...) {`

let violations = []
for (const f of FILES) {
  let src
  try { src = readFileSync(f, 'utf8') } catch { continue }
  const lines = src.split('\n')
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    const m = ln.match(METHOD_START)
    if (m) current = m[1]
    if (current && EXEMPT_PRIMITIVES.has(current)) continue
    if (/\/\/\s*circle-ok:/.test(ln)) continue
    const hit = PATTERNS.find(p => p.re.test(ln))
    if (hit) violations.push({ f, n: i + 1, what: hit.what, ln: ln.trim(), prim: current })
  }
}

console.log('\nVFX anti-generic lint — round/ring shapes must be a conscious choice\n')
if (violations.length) {
  for (const v of violations) {
    console.log(`  ✗ ${v.f}:${v.n}  (${v.what}${v.prim ? ` in ${v.prim}` : ''})`)
    console.log(`      ${v.ln}`)
  }
  console.log(`\n  ${violations.length} unjustified round/ring shape(s).`)
  console.log('  A circle/ellipse/ring as a HERO element is the generic fallback the user keeps catching.')
  console.log('  • If it is an intentional incidental (bubble, droplet, spec dot, flash core) or a')
  console.log('    deliberate ring, tag the line:  // circle-ok: <reason>')
  console.log('  • Otherwise replace it with a custom shaded silhouette — see _drawBoneSpike /')
  console.log('    _drawAcidColumn / _drawMiasmaPuff for the detail bar.\n')
  process.exit(1)
}
console.log('  ✓ All round/ring shapes are justified (tagged or inside a ring primitive).\n')

// ── Duplicate-key guard ──────────────────────────────────────────────────────
// A method defined twice in the AbilityVfx object literal silently CLOBBERS the
// earlier one (last-wins) — this is how a new boss VFX once overwrote a minion's
// (the `bulwarkFx` incident). Catch any AbilityVfx method or module helper
// declared more than once.
{
  const KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do'])
  const dupViol = []
  for (const f of FILES) {
    let src
    try { src = readFileSync(f, 'utf8') } catch { continue }
    const lines = src.split('\n')
    const objStart = lines.findIndex(l => /^export const AbilityVfx = \{/.test(l))
    const methods = {}   // 2-space-indented `name(` after the object opens
    for (let i = (objStart < 0 ? 0 : objStart); i < lines.length; i++) {
      const m = lines[i].match(/^ {2}([A-Za-z_$][\w$]*)\s*\(/)
      if (m && !KW.has(m[1])) (methods[m[1]] = methods[m[1]] || []).push(i + 1)
    }
    const helpers = {}   // module-level helper functions
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^function ([A-Za-z_$][\w$]*)\s*\(/)
      if (m) (helpers[m[1]] = helpers[m[1]] || []).push(i + 1)
    }
    for (const [k, at] of Object.entries(methods)) if (at.length > 1) dupViol.push({ f, k, at, kind: 'method' })
    for (const [k, at] of Object.entries(helpers)) if (at.length > 1) dupViol.push({ f, k, at, kind: 'helper' })
  }
  if (dupViol.length) {
    console.log('VFX duplicate-key guard — a name declared twice silently clobbers the earlier one\n')
    for (const v of dupViol) console.log(`  ✗ ${v.f}: ${v.kind} "${v.k}" defined ${v.at.length}× @ lines ${v.at.join(', ')}`)
    console.log('\n  Rename one (prefix boss-specific VFX, e.g. golemBulwarkFx) so it stops overwriting the other.\n')
    process.exit(1)
  }
  console.log('  ✓ No duplicate AbilityVfx method / helper names.\n')
}
process.exit(0)

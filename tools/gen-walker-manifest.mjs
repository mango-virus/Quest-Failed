// gen-walker-manifest — scans assets/sprites/adventurers/<class>/ for base walk
// sheets (vNN.png, excluding the _atk / _walk128 variants) and writes
// walkers.json = { "<class>": <maxVariantIndex> }.
//
// The title-screen MenuWalkers loads this so EVERY baked adventurer sprite has
// a chance to pace the wall, with each CLASS picked uniformly (a 1-variant
// class is as likely to appear as a 100-variant one). Re-run after (re)baking
// adventurer sprites so new classes / variants show up:
//
//   node tools/gen-walker-manifest.mjs        (or: npm run gen-walkers)
//
// `cheater` is excluded — it's the cheat-mode placeholder, not a real adventurer.
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR  = join(ROOT, 'assets/sprites/adventurers')
const EXCLUDE = new Set(['cheater'])

const out = {}
for (const entry of await fs.readdir(DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || EXCLUDE.has(entry.name)) continue
  const files = await fs.readdir(join(DIR, entry.name))
  let max = 0
  for (const f of files) {
    const m = /^v(\d+)\.png$/.exec(f)   // base sheets only — skip _atk / _walk128
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  if (max > 0) out[entry.name] = max
}

const dest = join(DIR, 'walkers.json')
await fs.writeFile(dest, JSON.stringify(out) + '\n')
console.log(`wrote ${dest} — ${Object.keys(out).length} classes`)

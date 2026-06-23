// apply-config.mjs — bake an exported Sound-Studio config into the shipped game.
//
// The Sound Studio (in-game dev tool) stores tweaks per-machine in localStorage and
// can EXPORT them as JSON. This tool writes those tweaks into the committed baked
// layer (src/data/soundConfigBaked.js) so they ship for everyone — SoundConfig
// merges: user override > baked > code default.
//
// USAGE:
//   npm run audio:apply-config -- <export.json>            # merge into existing baked
//   npm run audio:apply-config -- <export.json> --replace  # replace the baked set
//   npm run audio:apply-config -- --list                   # show current baked entries
//
// Custom UPLOADED sounds (entries with fileKey) are NOT baked — their audio blob
// lives only in your browser's IndexedDB. To ship one: export/convert the file into
// assets/audio/, add a DeferredAudioLoader entry, then set that key in the Studio.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOUND_TRIGGERS } from '../../src/data/soundTriggers.js'
import { BAKED_SOUND_CONFIG } from '../../src/data/soundConfigBaked.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'src/data/soundConfigBaked.js')
const VALID = new Set(SOUND_TRIGGERS.map(t => t.id))
const FIELDS = ['key', 'keys', 'vol', 'pitch', 'mute']

const HEADER = `// soundConfigBaked.js — BAKED sound-trigger overrides that SHIP with the game.
//
// This is the committed "tuned defaults" layer. The Sound Studio writes per-machine
// tweaks to localStorage; \`npm run audio:apply-config <export.json>\` bakes a chosen
// export into THIS file so the tuning ships for everyone. SoundConfig merges:
//   user localStorage override  >  BAKED_SOUND_CONFIG  >  code default
// Edit via the bake tool, not by hand. Keys are trigger ids (see soundTriggers.js);
// values may set { key, keys, vol, pitch, mute }. (Custom uploaded files are NOT
// baked here — ship the audio file + add a loader entry instead.)

export const BAKED_SOUND_CONFIG = `

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--list')) {
    const ids = Object.keys(BAKED_SOUND_CONFIG)
    console.log(ids.length ? ids.map(id => `  ${id}: ${JSON.stringify(BAKED_SOUND_CONFIG[id])}`).join('\n') : '  (baked layer is empty)')
    console.log(`\n  ${ids.length} baked entr${ids.length === 1 ? 'y' : 'ies'}`)
    return
  }
  const file = args.find(a => !a.startsWith('--'))
  const replace = args.includes('--replace')
  if (!file) { console.error('usage: npm run audio:apply-config -- <export.json> [--replace] | --list'); process.exit(1) }
  const path = resolve(ROOT, file)
  if (!existsSync(path)) { console.error(`  file not found: ${path}`); process.exit(1) }

  let parsed
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { console.error('  bad JSON: ' + e.message); process.exit(1) }
  const overrides = parsed.overrides || parsed || {}

  const baked = replace ? {} : { ...BAKED_SOUND_CONFIG }
  let applied = 0, skippedCustom = 0, skippedUnknown = 0
  for (const [id, ov] of Object.entries(overrides)) {
    if (!VALID.has(id)) { console.warn(`  ⚠ unknown trigger id, skipped: ${id}`); skippedUnknown++; continue }
    if (ov && ov.fileKey) { console.warn(`  ⚠ custom upload not bakeable, skipped: ${id} (ship the file + loader entry)`); skippedCustom++; continue }
    const clean = {}
    for (const f of FIELDS) if (ov && ov[f] !== undefined) clean[f] = ov[f]
    if (Object.keys(clean).length) { baked[id] = clean; applied++ }
    else delete baked[id]   // an empty/cleared override removes any baked entry
  }

  const body = HEADER + JSON.stringify(baked, null, 2) + '\n'
  writeFileSync(OUT, body)
  console.log(`\n  baked ${applied} trigger override(s) → src/data/soundConfigBaked.js`)
  if (skippedCustom)  console.log(`  (${skippedCustom} custom-upload entr${skippedCustom === 1 ? 'y' : 'ies'} skipped)`)
  if (skippedUnknown) console.log(`  (${skippedUnknown} unknown id(s) skipped)`)
  console.log(`  total baked entries now: ${Object.keys(baked).length}`)
}

main()

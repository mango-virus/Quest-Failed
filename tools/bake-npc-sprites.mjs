// bake-npc-sprites.mjs — one-time downscale of companion expression art.
//
// The source folders ship hand-drawn expression portraits at the full
// studio resolution (~1.2-3.5 MB each) — far too heavy to ship with a
// GitHub-Pages game. A companion only ever renders at a few hundred px
// wide, so this bakes each portrait down to a HUD-sized WebP with a
// clean, stable kebab-case id.
//
// Re-runnable: it overwrites <outDir>/*.webp every time. Source files
// are never touched.
//
//   node tools/bake-npc-sprites.mjs            # bakes ALL companions
//   node tools/bake-npc-sprites.mjs lilith     # one companion
//   node tools/bake-npc-sprites.mjs malakor 560
//
// Optional argv: [companion] [width]

import sharp from 'sharp'
import { promises as fs } from 'fs'
import path from 'path'

const WIDTH = Number(process.argv[3]) || 560

// One entry per companion. `map` is an explicit source-filename → output-id
// mapping — kept explicit (not auto-kebab) so the dialogue banks' `expr`
// values are a clean, controlled vocabulary and verbose / misspelled
// source filenames get sane ids.
const COMPANIONS = {
  lilith: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Main NPC',
    outDir: 'assets/npc',
    map: {
      'aggressive.png':               'aggressive',
      'angry.png':                    'angry',
      'bored.png':                    'bored',
      'building.png':                 'building',
      'cackling.png':                 'cackling',
      'commanding.png':               'commanding',
      'confident.png':                'confident',
      'crying.png':                   'crying',
      'cute.png':                     'cute',
      'cute 2.png':                   'cute-2',
      'determined.png':               'determined',
      'evil.png':                     'evil',
      'excited.png':                  'excited',
      'eye roll.png':                 'eye-roll',
      'flirty.png':                   'flirty',
      'guilty.png':                   'guilty',
      'happy.png':                    'happy',
      'happy with gold coins.png':    'happy-gold',
      'impatient.png':                'impatient',
      'laughing.png':                 'laughing',
      'level up.png':                 'level-up',
      'mischevious.png':              'mischievous',
      'mischevious 2.png':            'mischievous-2',
      'proud 1.png':                  'proud-1',
      'proud 2.png':                  'proud-2',
      'sad.png':                      'sad',
      'scared.png':                   'scared',
      'sexy.png':                     'sexy',
      'shocked.png':                  'shocked',
      'sleeping.png':                 'sleeping',
      'smart and reading a book.png': 'reading',
      'smile.png':                    'smile',
      'smug.png':                     'smug',
      'stunned.png':                  'stunned',
      'surprised 1.png':              'surprised',
      'surprised 2.png':              'surprised-2',
      'thinking.png':                 'thinking',
      'unimpressed 1.png':            'unimpressed',
      'unimpressed 2.png':            'unimpressed-2',
      'upset.png':                    'upset',
      'winking.png':                  'winking',
      'worried.png':                  'worried',
    },
  },

  // Malakor — second companion. 39 expressions. Adding more later is
  // just new rows here + a re-run, plus extending the `expressions`
  // list in src/systems/companions.js.
  malakor: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Main NPC 2',
    outDir: 'assets/npc-malakor',
    map: {
      'aggressive.png':               'aggressive',
      'angry.png':                    'angry',
      'bored.png':                    'bored',
      'building.png':                 'building',
      'commanding.png':               'commanding',
      'confident 1.png':              'confident-1',
      'confident 2.png':              'confident-2',
      'cool.png':                     'cool',
      'crying.png':                   'crying',
      'determined.png':               'determined',
      'evil.png':                     'evil',
      'excited.png':                  'excited',
      'eye roll annoyed.png':         'eye-roll',
      'guilty.png':                   'guilty',
      'happy.png':                    'happy',
      'happy with gold coins.png':    'happy-gold',
      'idle 1.png':                   'idle-1',
      'idle 2.png':                   'idle-2',
      'impatient.png':                'impatient',
      'laughing.png':                 'laughing',
      'level up.png':                 'level-up',
      'plotting mischevious.png':     'mischievous',
      'proud.png':                    'proud',
      'rude mocking1.png':            'mocking',
      'rude mocking2.png':            'mocking-2',
      'rude mocking 3.png':           'mocking-3',
      'sad.png':                      'sad',
      'scared.png':                   'scared',
      'shocked.png':                  'shocked',
      'sleeping.png':                 'sleeping',
      'smart and reading a book.png': 'reading',
      'smiling.png':                  'smile',
      'smug.png':                     'smug',
      'stunned.png':                  'stunned',
      'thinking.png':                 'thinking',
      'unimpressed.png':              'unimpressed',
      'upset1.png':                   'upset',
      'upset2.png':                   'upset-2',
      'worried.png':                  'worried',
    },
  },
}

async function bakeCompanion(id, cfg) {
  const outDir = path.resolve(process.cwd(), cfg.outDir)
  await fs.mkdir(outDir, { recursive: true })
  const entries = Object.entries(cfg.map)
  let ok = 0, bytesIn = 0, bytesOut = 0
  const missing = []

  console.log(`\n[${id}]  ${cfg.srcDir}  →  ${cfg.outDir}`)
  for (const [srcName, exprId] of entries) {
    const srcPath = path.join(cfg.srcDir, srcName)
    const outPath = path.join(outDir, `${exprId}.webp`)
    try {
      const stat = await fs.stat(srcPath)
      bytesIn += stat.size
    } catch {
      missing.push(srcName)
      continue
    }
    // No trim — every expression keeps its original framing so the HUD
    // character stays put when it cross-fades between expressions.
    await sharp(srcPath)
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: 84, alphaQuality: 90, effort: 6 })
      .toFile(outPath)
    const outStat = await fs.stat(outPath)
    bytesOut += outStat.size
    ok++
    process.stdout.write(`  ${exprId.padEnd(16)} ${(outStat.size / 1024).toFixed(0)}kb\n`)
  }

  const mb = (n) => (n / 1024 / 1024).toFixed(1)
  console.log(`  baked ${ok}/${entries.length}  ${mb(bytesIn)}MB → ${mb(bytesOut)}MB`)
  if (missing.length) {
    console.log(`  MISSING (${missing.length}): ${missing.join(', ')}`)
    process.exitCode = 1
  }
}

async function main() {
  const which = process.argv[2]
  const ids = which ? [which] : Object.keys(COMPANIONS)
  for (const id of ids) {
    const cfg = COMPANIONS[id]
    if (!cfg) { console.error(`Unknown companion: ${id}`); process.exitCode = 1; continue }
    await bakeCompanion(id, cfg)
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1 })

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
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Main NPC 1 - Lilith',
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
      'playing a video game 1.png':   'gaming-1',
      'playing a video game 2.png':   'gaming-2',
      'maid cosplay-Photoroom.png':   'maid',
      // 2026-05-22 expansion — 18 new expressions: romance / affection
      // shades, vanity, cruelty, and casual idle beats. (cute 2 /
      // mischevious / mischevious 2 source art was also redrawn — same
      // filenames + ids, so a re-bake picks up the new art.)
      'adorable.png':                 'adorable',
      'adoring.png':                  'adoring',
      'changing her outfit.png':      'changing-outfit',
      'cruel.png':                    'cruel',
      'deeply in love.png':           'in-love',
      'disgusted.png':                'disgusted',
      'examining her looks.png':      'preening',
      'giggling.png':                 'giggling',
      'heart eyes.png':               'heart-eyes',
      'lovestruck.png':               'lovestruck',
      'menacing.png':                 'menacing',
      'obsessed with the player.png': 'obsessed',
      'obsessive love.png':           'obsessive-love',
      'playing with tail.png':        'tail-play',
      'sexy 2.png':                   'sexy-2',
      'showing deep affection.png':   'affection',
      'sneering.png':                 'sneering',
      'swooning.png':                 'swooning',
    },
  },

  // Malakor — second companion. 39 expressions. Adding more later is
  // just new rows here + a re-run, plus extending the `expressions`
  // list in src/systems/companions.js.
  malakor: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Main NPC 2 - Malakor',
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
      'playing a game.png':           'gaming',
      // 2026-05-22 expansion — 3 new expressions.
      'battle roar.png':              'battle-roar',
      'menacing.png':                 'menacing',
      'salute.png':                   'salute',
    },
  },

  // Zul'Gath — third companion, an ancient dragon. 39 expressions.
  // His source art is a WIDE landscape composition (~2400×1339, aspect
  // ~1.79) — the humanoid companions are tall portraits. Baking him at
  // the default 560 width would leave him only ~312px tall and blurry
  // wherever he is shown at size, so he gets a larger per-companion width.
  zulgath: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Main NPC 3 - Zul\'Gath',
    outDir: 'assets/npc-zulgath',
    width: 1400,
    map: {
      'aggressive with fire.png':                           'aggressive',
      'angry.png':                                          'angry',
      'attacking breathing fire and covered in flames.png': 'attacking',
      'bored.png':                                          'bored',
      'building.png':                                       'building',
      'commanding.png':                                     'commanding',
      'confident.png':                                      'confident',
      'cool with sunglasses.png':                           'cool',
      'crying.png':                                         'crying',
      'determined.png':                                     'determined',
      'evil.png':                                           'evil',
      'extremely evil.png':                                 'evil-2',
      'eye roll annoyed.png':                               'eye-roll',
      'guilty.png':                                         'guilty',
      'hoarding treasure.png':                              'hoarding',
      'idle.png':                                           'idle',
      'impatient.png':                                      'impatient',
      'joking.png':                                         'joking',
      'laughing.png':                                       'laughing',
      'level up.png':                                       'level-up',
      'menacing.png':                                       'menacing',
      'mischevious.png':                                    'mischievous',
      'mocking.png':                                        'mocking',
      'playful.png':                                        'playful',
      'playing a video game.png':                           'gaming',
      'proud.png':                                          'proud',
      'reading book.png':                                   'reading',
      'sad.png':                                            'sad',
      'scared.png':                                         'scared',
      'shame.png':                                          'shame',
      'shocked.png':                                        'shocked',
      'sleeping.png':                                       'sleeping',
      'stunned.png':                                        'stunned',
      'thinking.png':                                       'thinking',
      'unimpressed.png':                                    'unimpressed',
      'upset.png':                                          'upset',
      'very happy.png':                                     'happy',
      'winking.png':                                        'winking',
      'worried.png':                                        'worried',
      // 2026-05-22 expansion — 6 new expressions.
      'acting better than everyone else-Photoroom.png':     'superior',
      'bored 2-Photoroom.png':                              'bored-2',
      'nostalgic-Photoroom.png':                            'nostalgic',
      'self satisfied-Photoroom.png':                       'self-satisfied',
      'smug-Photoroom.png':                                 'smug',
      'wistful-Photoroom.png':                              'wistful',
    },
  },

  // Nocturna — fifth companion, ships LOCKED on the recruit screen. Only
  // an idle portrait is needed today (she has no banter / expression bank
  // yet — the lock-screen card uses just the one frame, silhouette-tinted).
  // When she's unlockable, drop the rest of her expression art into the
  // src folder, fill in the map, re-run this bake, and remove `locked` in
  // companions.js. Source file renamed 2026-05-25: `idle.png` →
  // `Nocturna Idle.png` (the redrawn sit-pose art replaces the original).
  nocturna: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Main NPC 5 - Nocturna',
    outDir: 'assets/npc-nocturna',
    map: {
      'Nocturna Idle.png': 'idle',
    },
  },

  // Safira — fourth (and final) companion, a chaotic wish-granting genie.
  // 53 expressions. Tall portrait art (~1618×2400) like the humanoids, so
  // the default width is fine — no per-companion override.
  safira: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Main NPC 4 - Safira',
    outDir: 'assets/npc-safira',
    map: {
      'being summoned from lamp.png':  'summoned',
      'bored.png':                     'bored',
      'building a dungeon.png':        'building',
      'building with blueprint.png':   'blueprint',
      'chaotic 1.png':                 'chaotic-1',
      'chaotic 2.png':                 'chaotic-2',
      'cleaning her lamp.png':         'lamp-cleaning',
      'crazy 1.png':                   'crazy-1',
      'crazy 2.png':                   'crazy-2',
      'crying.png':                    'crying',
      'cute.png':                      'cute',
      'determined.png':                'determined',
      'evil.png':                      'evil',
      'excited.png':                   'excited',
      'explaining something.png':      'explaining',
      'flirty 1.png':                  'flirty-1',
      'flirty 2.png':                  'flirty-2',
      'getting more powerful.png':     'empowered',
      'granting a wish 1.png':         'wish-1',
      'granting a wish 2.png':         'wish-2',
      'granting a wish 3.png':         'wish-3',
      'guilty.png':                    'guilty',
      'happy.png':                     'happy',
      'has treasure.png':              'treasure',
      'holding up gaming controller.png': 'controller',
      'idle.png':                      'idle',
      'impatient.png':                 'impatient',
      'in love 1.png':                 'in-love-1',
      'in love 2.png':                 'in-love-2',
      'inspecting her genie lamp.png': 'lamp-inspecting',
      'laughing.png':                  'laughing',
      'mischevious.png':               'mischievous',
      'nervous 1.png':                 'nervous-1',
      'nervous 2.png':                 'nervous-2',
      'obsessive.png':                 'obsessive',
      'playing a video game.png':      'gaming',
      'pouting.png':                   'pouting',
      'really interested.png':         'interested',
      'sad.png':                       'sad',
      'scared.png':                    'scared',
      'sexy.png':                      'sexy',
      'shame.png':                     'shame',
      'shocked.png':                   'shocked',
      'sleeping.png':                  'sleeping',
      'smart reading a book.png':      'reading',
      'surprised.png':                 'surprised',
      'sweet.png':                     'sweet',
      'taunting.png':                  'taunting',
      'unimpressed.png':               'unimpressed',
      'upset.png':                     'upset',
      'using powerful magic.png':      'magic',
      'winking.png':                   'winking',
      'worried.png':                   'worried',
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
      .resize({ width: cfg.width || WIDTH, withoutEnlargement: true })
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

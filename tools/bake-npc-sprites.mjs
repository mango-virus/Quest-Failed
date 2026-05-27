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

  // Luna — sixth keeper, also ships LOCKED on the recruit screen
  // (teaser-only treatment matching Nocturna). Only an `idle` portrait
  // is wired today — when more art ships, fill in the map, re-run this
  // bake, expand `expressions` in companions.js, add a `linesKey` +
  // dialogue bank, and call `PlayerProfile.unlockCompanion('luna')`
  // at the chosen trigger (unlock condition TBD per user).
  luna: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Companions/Luna',
    outDir: 'assets/npc-luna',
    map: {
      'Luna Idle.png': 'idle',
    },
  },

  // Rattle Bones — seventh keeper, also ships LOCKED. Same teaser-only
  // treatment as Luna / Nocturna: one `idle` portrait, no dialogue,
  // unlock condition TBD. Promotion path is identical: drop expression
  // art into the source folder, expand the map, re-bake, register
  // expressions in companions.js, add a dialogue bank, call
  // `PlayerProfile.unlockCompanion('rattlebones')` at the chosen
  // trigger. Source filename is lowercase `idle.png` (no companion
  // prefix), unlike Luna / Nocturna whose source files are prefixed.
  rattlebones: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Companions/Rattle Bones',
    outDir: 'assets/npc-rattlebones',
    // Macabre Jester skeleton — full 55-expression bank shipped 2026-05-26.
    // Source filenames carry a `-Photoroom` suffix (artist's background-
    // removal tool); two stragglers don't (`disgusted.png`, `telling a
    // joke 5.png`). Output ids strip the suffix + kebab-case the rest.
    // The `dont use/` subfolder is ignored — only the top-level files
    // here are baked.
    //
    // Three name collisions resolved deliberately:
    //   • `bored 2-Photoroom.png` → id `bored` (artist's only "bored"
    //     pose; matches the dialogue bank's existing `bored` references)
    //   • `Laughing extremly hard-Photoroom.png` → id `cackling`
    //     (artist's "extreme laugh" lines up with the dialogue bank's
    //     `cackling` semantic — manic / over-the-top laughter)
    //   • `whispering-Photoroom.png` → id `whisper` (shorter; matches
    //     the dialogue bank).
    map: {
      // Idle / quiet beats
      'idle-Photoroom.png':                  'idle',
      'bored 2-Photoroom.png':               'bored',
      'sleeping-Photoroom.png':              'sleeping',
      'lazy-Photoroom.png':                  'lazy',

      // Laughing register
      'laughing 1-Photoroom.png':            'laughing',
      'laughing 2-Photoroom.png':            'laughing-2',
      'laughing 3-Photoroom.png':            'laughing-3',
      'laughing 4-Photoroom.png':            'laughing-4',
      'laughing hard 1-Photoroom.png':       'laughing-hard',
      'laughing hard 2-Photoroom.png':       'laughing-hard-2',
      'Laughing extremly hard-Photoroom.png':'cackling',
      'crying laughing-Photoroom.png':       'crying-laughing',
      'chefs kiss-Photoroom.png':            'chef-kiss',
      'facepalm laugh-Photoroom.png':        'facepalm-laugh',

      // Mischievous / smug
      'mischievous 1-Photoroom.png':         'mischievous',
      'mischievous 2-Photoroom.png':         'mischievous-2',
      'smug-Photoroom.png':                  'smug',
      'mocking-Photoroom.png':               'mocking',
      'winking-Photoroom.png':               'winking',
      'evil grin-Photoroom.png':             'evil-grin',

      // Excited / shocked
      'excited-Photoroom.png':               'excited',
      'surprised-Photoroom.png':             'surprised',
      'shocked-Photoroom.png':               'shocked',
      'mind blown-Photoroom.png':            'mind-blown',
      'mock horror-Photoroom.png':           'mock-horror',

      // Theatrical / performer
      'theatrical bow-Photoroom.png':        'theatrical-bow',
      'narrating-Photoroom.png':             'narrating',
      'pointing-Photoroom.png':              'pointing',
      'singing-Photoroom.png':               'singing',
      'dancing-Photoroom.png':               'dancing',
      'taunting-Photoroom.png':              'taunting',
      'showing a prop-Photoroom.png':        'showing-prop',

      // Telling-a-joke variants (5)
      'telling a joke 1-Photoroom.png':      'telling-joke',
      'telling a joke 2-Photoroom.png':      'telling-joke-2',
      'telling a joke 3-Photoroom.png':      'telling-joke-3',
      'telling a joke 4-Photoroom.png':      'telling-joke-4',
      'telling a joke 5.png':                'telling-joke-5',

      // Quiet / thoughtful
      'thinking-Photoroom.png':              'thinking',
      'whispering-Photoroom.png':            'whisper',
      'confused-Photoroom.png':              'confused',
      'melancholy-Photoroom.png':            'melancholy',
      'nostalgic-Photoroom.png':             'nostalgic',
      'out of time-Photoroom.png':           'out-of-time',

      // Dismissive / annoyed
      'eye roll-Photoroom.png':              'eye-roll',
      'unimpressed-Photoroom.png':           'unimpressed',
      'annoyed-Photoroom.png':               'annoyed',
      'disgusted.png':                       'disgusted',

      // Pride / victory
      'proud-Photoroom.png':                 'proud',
      'gloating-Photoroom.png':              'gloating',
      'applauding-Photoroom.png':            'applauding',
      'victorious-Photoroom.png':            'victorious',
      'clapping-Photoroom.png':              'clapping',

      // Skeleton-specific physical gags
      'falling apart-Photoroom.png':         'falling-apart',
      'jaw dropped-Photoroom.png':           'jaw-dropped',
      'salute-Photoroom.png':                'salute',
    },
  },

  // The Necroknight — eighth keeper, also ships LOCKED. Skeletal warrior
  // archetype: armored undead knight with a green spectral aura. Same
  // teaser-only treatment as Luna / Rattle Bones / Nocturna: one `idle`
  // portrait, no dialogue, unlock condition TBD. Promotion path identical
  // to the other locked teasers. Source filename is lowercase `idle.png`
  // (no companion prefix).
  necroknight: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Companions/The Necroknight',
    outDir: 'assets/npc-necroknight',
    map: {
      'idle.png': 'idle',
    },
  },

  // Spectra — ninth keeper, ships LOCKED (same teaser-only treatment
  // as the other unlock-pending companions). Single `idle` portrait,
  // no dialogue, unlock condition TBD. Source filename is `Idle.png`
  // with a capital I — case matters for the map key.
  spectra: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Companions/Spectra',
    outDir: 'assets/npc-spectra',
    map: {
      'Idle.png': 'idle',
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

  // Spectra — ghost-girl otaku companion. 113 source PNGs grouped into
  // ~62 semantic expression IDs. Variants get `-N` suffixes (`happy`,
  // `happy-2`, `happy-3`). Companion registry's `variantGroups` maps each
  // semantic id back to its variant list so NpcCompanion can rotate at
  // display time — see companions.js.
  //
  // Two deliberate drops:
  //   • `idle 1 see through.png` — user instruction. The ghost-flicker
  //     opacity overlay (NpcCompanion) gives this effect to every variant
  //     for free, so a dedicated see-through idle would just double up.
  //   • `weeb 4` doesn't exist in source — `weeb 5-Photoroom.png` becomes
  //     `weeb-4` so the variant ids stay gap-free.
  //
  // Naming notes:
  //   • Source PNGs use `-Photoroom` suffix (artist's BG-removal export).
  //     Three sources don't have it: `Idle.png`, `idle 1 see through.png`
  //     (dropped), `looking in mirror.png`.
  //   • Source filename misspelling `mischevious` → corrected to `mischievous`.
  //   • `cheerful` collapses into `happy-3` (visual variant of happy).
  //   • `pro gamer` collapses into `gaming-2` (gamer-pose variant).
  //   • `using ghost powers` joins `ghostly power 1/2` as `ghost-power-3`.
  //   • Spooky group (`scary`, `skulls`, `ghost-power-*`) and the
  //     teasing/seductive/sexy group get special handling in the
  //     companions.js registry (rare flavor + solidOnly flicker exempt).
  spectra: {
    srcDir: 'D:/Documents/Game Jam Code/Quest-Failed assets/Companions/Spectra',
    outDir: 'assets/npc-spectra',
    map: {
      // Idle / quiet beats
      'Idle.png':                                          'idle',
      'idle 2-Photoroom.png':                              'idle-2',
      'bored 1-Photoroom.png':                             'bored',
      'bored 2-Photoroom.png':                             'bored-2',
      'sleeping 1-Photoroom.png':                          'sleeping',
      'sleeping 2-Photoroom.png':                          'sleeping-2',
      'yawning-Photoroom.png':                             'yawning',

      // Generic emotional baseline
      'happy 1-Photoroom.png':                             'happy',
      'happy 2-Photoroom.png':                             'happy-2',
      'cheerful-Photoroom.png':                            'happy-3',
      'excited 1-Photoroom.png':                           'excited',
      'excited 2-Photoroom.png':                           'excited-2',
      'sad-Photoroom.png':                                 'sad',
      'upset-Photoroom.png':                               'upset',
      'crying-Photoroom.png':                              'crying',
      'proud-Photoroom.png':                               'proud',
      'confused 1-Photoroom.png':                          'confused',
      'confused 2-Photoroom.png':                          'confused-2',
      'shocked-Photoroom.png':                             'shocked',
      'surprised-Photoroom.png':                           'surprised',
      'thinking-Photoroom.png':                            'thinking',
      'focused 1-Photoroom.png':                           'focused',
      'focused 2-Photoroom.png':                           'focused-2',
      'annoyed-Photoroom.png':                             'annoyed',

      // Anger register
      'angry-Photoroom.png':                               'angry',
      'chibi rage-Photoroom.png':                          'chibi-rage',
      'anime dramatic anger-Photoroom.png':                'dramatic-anger',

      // Positive register
      'laughing-Photoroom.png':                            'laughing',
      'laughing 2-Photoroom.png':                          'laughing-2',
      'smug-Photoroom.png':                                'smug',
      'mischevious-Photoroom.png':                         'mischievous',
      'winking-Photoroom.png':                             'winking',

      // General poses
      'pointing-Photoroom.png':                            'pointing',
      'explaining something-Photoroom.png':                'explaining',
      'looking-away-Photoroom.png':                        'looking-away',

      // Anime reactions
      'sparkle eyes-Photoroom.png':                        'sparkle-eyes',
      'anime bishie sparkles-Photoroom.png':               'bishie-sparkles',
      'anime gasp 1-Photoroom.png':                        'anime-gasp',
      'anime gasp 2-Photoroom.png':                        'anime-gasp-2',
      'sweatdrop worried-Photoroom.png':                   'sweatdrop',
      'anime nose bleed-Photoroom.png':                    'nose-bleed',
      'heart eyes-Photoroom.png':                          'heart-eyes',
      'anime heart eyes-Photoroom.png':                    'heart-eyes-2',
      'anime wibbly mouth about to cry-Photoroom.png':     'wibbly-mouth',
      'senpai notice (excited at being noticed by senpai) 1-Photoroom.png': 'senpai-notice',
      'senpai notice (excited at being noticed by senpai) 2-Photoroom.png': 'senpai-notice-2',
      'senpai notice (excited at being noticed by senpai) 3-Photoroom.png': 'senpai-notice-3',
      'blushing 1-Photoroom.png':                          'blushing',
      'blushing 2-Photoroom.png':                          'blushing-2',
      'looking cute 1-Photoroom.png':                      'looking-cute',
      'looking cute 2-Photoroom.png':                      'looking-cute-2',
      'looking cute 3-Photoroom.png':                      'looking-cute-3',
      'weeb-Photoroom.png':                                'weeb',
      'weeb 2-Photoroom.png':                              'weeb-2',
      'weeb 3-Photoroom.png':                              'weeb-3',
      'weeb 5-Photoroom.png':                              'weeb-4',
      'watching anime 1-Photoroom.png':                    'watching-anime',
      'watching anime 2-Photoroom.png':                    'watching-anime-2',
      'reading manga 1-Photoroom.png':                     'reading-manga',
      'reading manga 2-Photoroom.png':                     'reading-manga-2',
      'reading manga 3-Photoroom.png':                     'reading-manga-3',
      'reading manga 4-Photoroom.png':                     'reading-manga-4',
      'taking photo excited-Photoroom.png':                'taking-photo',

      // Gamer
      'gaming-Photoroom.png':                              'gaming',
      'pro gamer-Photoroom.png':                           'gaming-2',
      'button mashing-Photoroom.png':                      'button-mashing',
      'twitch streamer 1-Photoroom.png':                   'streaming',
      'twitch streamer 2-Photoroom.png':                   'streaming-2',
      'twitch streamer 3-Photoroom.png':                   'streaming-3',
      'rage quit-Photoroom.png':                           'rage-quit',
      'gg victory-Photoroom.png':                          'gg-victory',
      'texting 1-Photoroom.png':                           'texting',
      'texting 2-Photoroom.png':                           'texting-2',
      'phone scrolling-Photoroom.png':                     'phone-scrolling',

      // Snacks
      'eating snacks 1-Photoroom.png':                     'eating-snacks',
      'eating snacks 2-Photoroom.png':                     'eating-snacks-2',
      'cheeks stuffed-Photoroom.png':                      'cheeks-stuffed',
      'pocky mouth 1-Photoroom.png':                       'pocky-mouth',
      'pocky mouth 2-Photoroom.png':                       'pocky-mouth-2',
      'chip-bag-shake (tipping crumbs out)-Photoroom.png': 'chip-bag-shake',
      'juice-box-sip-Photoroom.png':                       'juice-box-sip',
      'peering into empty chip bag-Photoroom.png':         'empty-bag',
      'caught snacking-Photoroom.png':                     'caught-snacking',

      // Distracted
      'distracted-Photoroom.png':                          'distracted',
      'distracted 2-Photoroom.png':                        'distracted-2',
      'distracted 3-Photoroom.png':                        'distracted-3',
      'distracted 4-Photoroom.png':                        'distracted-4',
      'doodling-absently 1-Photoroom.png':                 'doodling',
      'doodling absently 2-Photoroom.png':                 'doodling-2',
      'looking in mirror.png':                             'mirror-check',

      // Fan / hobby
      'holding favorite plush 1-Photoroom.png':            'plush-hug',
      'holding favorite plush 2-Photoroom.png':            'plush-hug-2',
      'holding favorite plush 3-Photoroom.png':            'plush-hug-3',
      'holding favorite plush 4-Photoroom.png':            'plush-hug-4',
      'holding favorite plush 5-Photoroom.png':            'plush-hug-5',
      'holding multiple plushies 1-Photoroom.png':         'holding-plushies',
      'holding multiple plushies 2-Photoroom.png':         'holding-plushies-2',
      'holding tons of anime plushies-Photoroom.png':      'holding-plushies-3',
      'holding up anime figure 1-Photoroom.png':           'figure-collection',
      'holding up anime figure 2-Photoroom.png':           'figure-collection-2',
      'holding multiple figures-Photoroom.png':            'figure-collection-3',

      // Teasing / flirty (rare flavor)
      'teasing 1-Photoroom.png':                           'teasing',
      'teasing 2-Photoroom.png':                           'teasing-2',
      'teasing 3-Photoroom.png':                           'teasing-3',
      'teasing 4-Photoroom.png':                           'teasing-4',
      'teasing 5-Photoroom.png':                           'teasing-5',
      'seductive-Photoroom.png':                           'seductive',
      'sexy-Photoroom.png':                                'sexy',

      // Spooky (rare, solidOnly — exempt from ghost-flicker overlay)
      'scary-Photoroom.png':                               'scary',
      'surrounded by skulls-Photoroom.png':                'skulls',
      'ghostly power 1-Photoroom.png':                     'ghost-power',
      'ghostly power 2-Photoroom.png':                     'ghost-power-2',
      'using ghost powers-Photoroom.png':                  'ghost-power-3',
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

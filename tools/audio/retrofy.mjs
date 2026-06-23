// retrofy.mjs — batch-convert modern/clean SFX into a 16-bit / SNES-era aesthetic.
//
// WHY: Quest Failed's art is 16-bit pixel art, but newly-acquired SFX (ElevenLabs
// AI generations, modern recorded samples, Sonniss/Freesound clips) come in clean
// and full-bandwidth — they sound "too HD" against the visuals. This bakes in the
// retro character so dropped-in audio matches the look.
//
// THE RECIPE (from the deep-research pass, see RESEARCH.md "Follow-up pass" Q2):
// an authentic SNES feel is NOT a plain bitcrush. It is three stacked steps:
//   1. Downsample below 32 kHz (real SNES samples ran ~8–16 kHz). We target 16 kHz.
//   2. Quantize toward 4-bit-ish ADPCM grit. A true emulation needs a BRR/ADPCM
//      codec (snesbrr/BRRtools); a generic bit-reduction (ffmpeg `acrusher`) gives
//      a similar lo-fi feel that is "good enough" for most cues. We default to a
//      MODERATE bit depth (7) because straight 4-bit PCM is much harsher than the
//      4-bit ADPCM *residuals* the SNES actually used.
//   3. High-frequency low-pass (~9 kHz) to mimic the SNES Gaussian interpolation.
// We then re-upsample to 44.1 kHz so the output plays at a standard rate in any
// browser/WebAudio decoder while RETAINING the lo-fi character baked in above.
//
// TOOLING: uses the bundled `ffmpeg-static` binary — no system ffmpeg install
// needed. `acrusher`, `aresample`, and `lowpass` are all standard ffmpeg filters.
//
// USAGE:
//   npm run audio:retrofy -- [options]
//   node tools/audio/retrofy.mjs --in <dir> --out <dir> [--rate N] [--bits N]
//                                [--lowpass N] [--keep-rate] [--dry] [--force]
//
// Defaults: --in assets/audio/_raw  --out assets/audio  --rate 16000 --bits 7
//           --lowpass 9000  (output re-upsampled to 44100 unless --keep-rate)
//
// EXAMPLES:
//   npm run audio:retrofy                       # convert assets/audio/_raw → assets/audio
//   npm run audio:retrofy -- --bits 5 --rate 11025   # grittier, more 8-bit
//   npm run audio:retrofy -- --in downloads/sfx --out assets/audio --dry
//
// For the most authentic SNES timbre on hero cues, run the clip through a real
// BRR codec instead (encode to .brr, decode back) — see RESEARCH.md. This tool
// is the fast, dependency-free "good enough" path for batch work.

import { spawnSync }   from 'node:child_process'
import { readdirSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, extname, basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ── ffmpeg binary ────────────────────────────────────────────────────────────
let FFMPEG = 'ffmpeg'   // system fallback
try {
  const mod = await import('ffmpeg-static')
  if (mod.default) FFMPEG = mod.default
} catch { /* fall back to system ffmpeg on PATH */ }

// ── presets ──────────────────────────────────────────────────────────────────
// The "pixelated 8-bit" character comes from HARD bit-depth reduction + sample-
// HOLD decimation (acrusher `samples`), with NO low-pass — the bright aliasing /
// quantization noise that survives IS the pixelated crunch. mode=lin is harsher
// (crunchier) than log. A true downsample (--rate) is OFF by default because it
// anti-aliases and just muffles. The 'snes' preset re-adds a low-pass for a
// smoother, fuller flavor (what the old "16bit" did).
//   bits    = bit-depth (lower = crunchier; 3–5 is the 8-bit zone)
//   samples = sample-hold decimation factor (higher = lo-fi-er / brighter aliasing)
//   lowpass = high-freq rolloff Hz (0 = OFF; only smooths, kills the crunch)
const PRESETS = {
  '8bit':     { bits: 4, samples: 4, lowpass: 0,    mode: 'lin' },  // bright, pixelated
  '8bit-lite':{ bits: 5, samples: 3, lowpass: 0,    mode: 'lin' },  // gentler crunch
  'crunchy':  { bits: 3, samples: 7, lowpass: 0,    mode: 'lin' },  // extreme/degraded
  'snes':     { bits: 7, samples: 2, lowpass: 9000, mode: 'log' },  // smooth, fuller
  '16bit':    { bits: 7, samples: 2, lowpass: 9000, mode: 'log' },  // alias of snes
}
const DEFAULT_PRESET = '8bit'

// ── args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  // bits/samples/lowpass/mode start null so we can tell explicit flags from preset
  // values. rate (true downsample) is opt-in only — null = off.
  const o = {
    in: 'assets/audio/_raw', out: 'assets/audio',
    preset: DEFAULT_PRESET, bits: null, samples: null, lowpass: null, mode: null,
    rate: null, dry: false, force: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--in':       o.in      = argv[++i]; break
      case '--out':      o.out     = argv[++i]; break
      case '--preset':   o.preset  = argv[++i]; break
      case '--bits':     o.bits    = parseInt(argv[++i], 10); break
      case '--samples':  o.samples = parseInt(argv[++i], 10); break
      case '--lowpass':  o.lowpass = parseInt(argv[++i], 10); break
      case '--mode':     o.mode    = argv[++i]; break
      case '--rate':     o.rate    = parseInt(argv[++i], 10); break
      case '--dry':      o.dry     = true; break
      case '--force':    o.force   = true; break
      case '-h': case '--help': o.help = true; break
      default:
        console.error(`Unknown option: ${a}`); o.help = true
    }
  }
  const base = PRESETS[o.preset]
  if (!base) { console.error(`Unknown preset: ${o.preset} (have: ${Object.keys(PRESETS).join(', ')})`); o.help = true; return o }
  // Explicit flags override the preset; otherwise take the preset's values.
  o.bits    ??= base.bits
  o.samples ??= base.samples
  o.lowpass ??= base.lowpass
  o.mode    ??= base.mode
  return o
}

const HELP = `
retrofy — batch retro styler for SFX (uses bundled ffmpeg)

  npm run audio:retrofy -- [options]

  --preset <name> ${Object.keys(PRESETS).join(' | ')}  (default ${DEFAULT_PRESET})
                    8bit=bright pixelated crunch · crunchy=extreme · snes=smooth
  --in <dir>      input folder   (default assets/audio/_raw)
  --out <dir>     output folder  (default assets/audio)
  --bits <N>      override bit-depth (lower = crunchier; 3–5 = 8-bit zone)
  --samples <N>   override sample-hold decimation (higher = lo-fi-er/brighter)
  --lowpass <N>   override high-freq rolloff Hz (0 = OFF; only smooths)
  --mode <lin|log> override crush curve (lin = harsher, log = softer)
  --rate <N>      optional true downsample Hz (off by default — it muffles)
  --dry           list what would be converted, write nothing
  --force         overwrite existing output files (default: skip ones that exist)
  -h, --help      this help

Examples:
  npm run audio:retrofy -- --preset 8bit --force      # bright pixelated 8-bit
  npm run audio:retrofy -- --preset crunchy --force   # extreme degraded
  npm run audio:retrofy -- --preset 8bit --bits 5     # a touch cleaner

Drops audio from --in, writes <basename>.wav to --out (same names, overwrites with --force).
`

const SRC_EXTS = new Set(['.wav', '.mp3', '.ogg', '.opus', '.flac', '.m4a'])

function buildFilter(o) {
  const parts = []
  // Optional TRUE downsample (off by default — it anti-aliases and muffles).
  if (o.rate) parts.push(`aresample=${o.rate}`)
  // Bit-depth reduction + sample-hold decimation = the bright digital crunch that
  // reads as "8-bit/pixelated". NO low-pass unless asked, so the aliasing survives.
  parts.push(`acrusher=bits=${o.bits}:mode=${o.mode}:samples=${o.samples}:mix=1`)
  if (o.lowpass > 0) parts.push(`lowpass=f=${o.lowpass}`)
  // Normalize container to 44100 so it plays everywhere (artifacts already baked in;
  // upsampling doesn't remove them).
  parts.push('aresample=44100')
  return parts.join(',')
}

function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.help) { console.log(HELP); process.exit(0) }

  const inDir  = resolve(ROOT, o.in)
  const outDir = resolve(ROOT, o.out)

  if (!existsSync(inDir)) {
    console.error(`\n  Input folder not found: ${inDir}`)
    console.error(`  Create it and drop your raw SFX in, e.g.:`)
    console.error(`    mkdir -p "${o.in}"   then  npm run audio:retrofy\n`)
    process.exit(1)
  }
  if (!o.dry) mkdirSync(outDir, { recursive: true })

  const files = readdirSync(inDir)
    .filter(f => SRC_EXTS.has(extname(f).toLowerCase()))
    .filter(f => statSync(join(inDir, f)).isFile())

  if (!files.length) {
    console.error(`\n  No audio files (${[...SRC_EXTS].join(', ')}) in ${inDir}\n`)
    process.exit(1)
  }

  const filter = buildFilter(o)
  console.log(`\n  retrofy  ${files.length} file(s)`)
  console.log(`  in:   ${inDir}`)
  console.log(`  out:  ${outDir}`)
  console.log(`  chain: ${filter}`)
  console.log(`  (preset ${o.preset} · bits ${o.bits} · samples ${o.samples} · mode ${o.mode} · ` +
              `lowpass ${o.lowpass || 'off'}${o.rate ? ` · downsample ${o.rate}Hz` : ''})` +
              `${o.dry ? '  [DRY RUN]' : ''}\n`)

  let done = 0, skipped = 0, failed = 0
  for (const f of files) {
    const src = join(inDir, f)
    const dst = join(outDir, `${basename(f, extname(f))}.wav`)

    if (!o.force && !o.dry && existsSync(dst)) {
      console.log(`  · skip (exists): ${basename(dst)}   (use --force to overwrite)`)
      skipped++; continue
    }
    if (o.dry) { console.log(`  · would write: ${basename(dst)}`); continue }

    // -y overwrite, -hide_banner quiet, 16-bit PCM output (-acodec pcm_s16le).
    const args = ['-hide_banner', '-loglevel', 'error', '-y',
                  '-i', src, '-af', filter, '-acodec', 'pcm_s16le', dst]
    const r = spawnSync(FFMPEG, args, { encoding: 'utf8' })
    if (r.status === 0) {
      console.log(`  ✓ ${basename(dst)}`)
      done++
    } else {
      console.error(`  ✗ ${basename(f)} — ffmpeg failed`)
      if (r.stderr) console.error(`      ${r.stderr.trim().split('\n').slice(-2).join('\n      ')}`)
      if (r.error)  console.error(`      ${r.error.message}`)
      failed++
    }
  }

  console.log(`\n  done: ${done}  skipped: ${skipped}  failed: ${failed}\n`)
  if (failed) process.exit(1)
}

main()

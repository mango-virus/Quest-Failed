// Crop the multi-prop sprite sheets in
//   ../!To do/decor/decor sprite packs/
// down to individual props in
//   ../assets/sprites/decor-*.png
//
// Run with:   node tools/crop-decor.mjs
//
// Each entry in CROPS is [sourceFile, outputName, x, y, w, h]. Sharp
// reads PNG transparency so the cropped output keeps its alpha
// channel — the renderer then draws it like any other decor sprite.

import sharp from 'sharp'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO     = path.resolve(__dirname, '..')
const SRC_DIR  = path.resolve(REPO, '..', 'Quest-Failed assets', '!To do', 'decor', 'decor sprite packs')
const OUT_DIR  = path.resolve(REPO, 'assets', 'sprites')

// [sourceFile, outputName (without `decor-` prefix and `.png`), x, y, w, h]
// Coordinates verified via tools/detect-gaps.mjs which finds the
// transparent gaps between props in each sheet. Padded by ~1px so the
// crop doesn't shave the prop's outermost pixels.
const CROPS = [
  // ─── chest.png (192×144) ───────────────────────────────────────────
  // 6 chests per row, each at x=6,38,70,102,134,166 with w=21.
  // Top row (closed): y=8..31 (h=24). 6-colour variation.
  ['chest.png', 'chest-1', 4,   6, 25, 28],
  ['chest.png', 'chest-2', 36,  6, 25, 28],
  ['chest.png', 'chest-3', 68,  6, 25, 28],
  ['chest.png', 'chest-4', 100, 6, 25, 28],
  ['chest.png', 'chest-5', 132, 6, 25, 28],
  ['chest.png', 'chest-6', 164, 6, 25, 28],

  // ─── scull_bas-relief.png — handled in Preload as a SPRITESHEET ────
  // (2 cols × 6 rows of 32×32 cells; col 0 = dark eyes, col 1 = lit
  // eyes; each row is a separate medallion → DecorRenderer registers
  // 6 two-frame blink animations off the same sheet). Not cropped
  // here because we need the frame-pair animation, which requires
  // the whole sheet loaded as a single texture with frame metadata.

  // ─── Interior_objects.png (288×272) ────────────────────────────────
  // Bookshelf row at y=5..61 (h=57). 6 shelves each w=36 at non-uniform
  // x positions: 8, 46, 84, 134, 182, 230 (note the larger gap after
  // shelf 3 — they're authored as two visual groups of 3).
  ['Interior_objects.png', 'bookshelf-1', 7,   4, 38, 59],
  ['Interior_objects.png', 'bookshelf-2', 45,  4, 38, 59],
  ['Interior_objects.png', 'bookshelf-3', 83,  4, 38, 59],
  ['Interior_objects.png', 'bookshelf-4', 133, 4, 38, 59],
  ['Interior_objects.png', 'bookshelf-5', 181, 4, 38, 59],
  ['Interior_objects.png', 'bookshelf-6', 229, 4, 38, 59],

  // ─── weapon racks.png (208×145) ────────────────────────────────────
  // Top row at y=1..46 (h=46). 4 racks at x=1..47, 49..95, 97..143
  // (w=47 each) plus a wider 4th rack at x=145..207 (w=63).
  ['weapon racks.png', 'weapon-rack-1', 0,   0, 49, 48],
  ['weapon racks.png', 'weapon-rack-2', 48,  0, 49, 48],
  ['weapon racks.png', 'weapon-rack-3', 96,  0, 49, 48],
  ['weapon racks.png', 'weapon-rack-4', 144, 0, 64, 48],

  // ─── Hand-cropped sprites (NOT in this auto-crop manifest) ─────────
  // The user hand-cropped these from the sprite packs and dropped
  // them into the source folder as standalone PNGs:
  //   alchemy hexagram.png, banner.png, forge.png,
  //   ritual circle big.png, ritual circle small.png
  // They get copied directly to assets/sprites/ rather than re-cut
  // here, so this auto-crop tool stays focused on uniform-grid
  // sheets (chests / bookshelves / skull reliefs / weapon racks).

  // (Batch 3 attempt reverted — auto-detection couldn't reliably
  // resolve paintings / plants / sacks on the dense source sheets.
  // Pending user hand-crops, same as the batch 2 fixes.)
]

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })
  let okCount = 0, errCount = 0
  for (const [src, name, x, y, w, h] of CROPS) {
    const srcPath = path.join(SRC_DIR, src)
    const outPath = path.join(OUT_DIR, `decor-${name}.png`)
    try {
      await sharp(srcPath)
        .extract({ left: x, top: y, width: w, height: h })
        .png()
        .toFile(outPath)
      okCount++
      console.log(`  ok  decor-${name}.png  (${w}×${h} from ${src} @${x},${y})`)
    } catch (err) {
      errCount++
      console.error(`  ERR decor-${name}.png  ${err.message}`)
    }
  }
  console.log(`\nDone: ${okCount} ok, ${errCount} errors.`)
}

main().catch(err => {
  console.error('FATAL', err)
  process.exit(1)
})

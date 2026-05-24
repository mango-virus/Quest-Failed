// One-shot: ingest the user's hand-painted full-body boss portraits from
// the external Craftpix pack and write resized copies into the project's
// bestiary asset folder, where Preload.js already loads them as
// `bestiary-full-{id}`. Replaces the prior tiny pixel-art stand-ins.
//
// Source files (one per archetype, ~2K × 2K, ~3 MB each):
//   D:/Documents/Game Jam Code/Quest-Failed assets/Craftpix/
//     ui/craftpix-net-767317-bestiary-book-pixel-art-asset-pack/
//     PNG/full boss image/<id> full.png
//
// Destination (existing folder, files are git-tracked):
//   D:/Documents/Game Jam Code/Quest-Failed/assets/ui/bestiary/full/<id>.png
//
// Resize: max 600 px tall, preserving aspect. ~3-4× the displayed size
// (100 px) for crispness. Brings the per-file size from ~3 MB → ~50-100 KB
// so the game payload doesn't balloon.
//
// Idempotent — running again just re-resizes from the same sources.

import sharp from 'sharp'
import { promises as fs } from 'fs'
import path from 'path'

const SRC_DIR = String.raw`D:\Documents\Game Jam Code\Quest-Failed assets\Craftpix\ui\craftpix-net-767317-bestiary-book-pixel-art-asset-pack\PNG\full boss image`
const DST_DIR = String.raw`D:\Documents\Game Jam Code\Quest-Failed\assets\ui\bestiary\full`

const BOSSES = [
  'beholder', 'demon', 'gnoll', 'golem', 'lich', 'lizardman',
  'myconid', 'orc', 'slime', 'succubus', 'vampire', 'wraith',
]

const TARGET_HEIGHT = 600

async function main() {
  for (const id of BOSSES) {
    const src = path.join(SRC_DIR, `${id} full.png`)
    const dst = path.join(DST_DIR, `${id}.png`)
    try {
      await fs.access(src)
    } catch {
      console.warn(`[skip] ${id} — source missing: ${src}`)
      continue
    }
    const meta = await sharp(src).metadata()
    await sharp(src)
      .resize({ height: TARGET_HEIGHT, withoutEnlargement: true, fit: 'inside' })
      .png({ compressionLevel: 9 })
      .toFile(dst)
    const out = await fs.stat(dst)
    console.info(
      `[ok]   ${id.padEnd(10)} ${meta.width}×${meta.height} → fit-${TARGET_HEIGHT}px  ` +
      `(${(out.size / 1024).toFixed(1)} KB)`
    )
  }
}

main().catch(err => { console.error(err); process.exit(1) })

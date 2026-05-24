// One-shot: update assets/layouts/ArchetypeSelect.json so each per-boss
// `{id}/boss-full-body` entry's scaleX/scaleY matches the new full-body
// image's resolution.
//
// Why: the UIEditor JSON had per-boss scaleX/scaleY (2.1×–2.95×) that
// were tuned for the old tiny pixel-art portraits (~45–90 px tall).
// After install-boss-fulls.mjs swapped those images for the new 600 px-
// tall versions, those same multipliers blew the portraits up to
// 1200–1800 px on screen — "massive".
//
// Formula: visible_height = image_height × scale. To preserve the OLD
// visible height with the NEW image:
//     new_scale = old_scale × (old_image_height / new_image_height)
// All new images are 600 px tall (per install-boss-fulls.mjs).
// Old heights were sampled from git HEAD before the swap.

import { promises as fs } from 'fs'
import path from 'path'

const LAYOUT_PATH = String.raw`D:\Documents\Game Jam Code\Quest-Failed\assets\layouts\ArchetypeSelect.json`

// Old (pre-swap) image heights, from `git show HEAD:assets/ui/bestiary/full/<id>.png`.
const OLD_HEIGHTS = {
  beholder:  54,
  demon:     89,
  gnoll:     61,
  golem:     51,
  lich:      58,
  lizardman: 87,
  myconid:   60,
  orc:       69,
  slime:     45,
  succubus:  72,
  vampire:   66,
  wraith:    70,
}

const NEW_HEIGHT = 600   // produced by install-boss-fulls.mjs (fit-inside 600 box)

async function main() {
  const raw = await fs.readFile(LAYOUT_PATH, 'utf8')
  const data = JSON.parse(raw)

  let touched = 0
  for (const [id, oldH] of Object.entries(OLD_HEIGHTS)) {
    const key = `${id}/boss-full-body`
    const entry = data[key]
    if (!entry) {
      console.warn(`[skip] ${key} — not in layout JSON`)
      continue
    }
    const oldScale = entry.scaleX
    if (typeof oldScale !== 'number') {
      console.warn(`[skip] ${key} — no numeric scaleX`)
      continue
    }
    const newScale = +(oldScale * (oldH / NEW_HEIGHT)).toFixed(3)
    entry.scaleX = newScale
    entry.scaleY = newScale
    console.info(`[ok]   ${id.padEnd(10)} scale ${oldScale.toFixed(3)} → ${newScale.toFixed(3)}  (visible h ≈ ${(NEW_HEIGHT * newScale).toFixed(0)} px)`)
    touched++
  }

  await fs.writeFile(LAYOUT_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.info(`Rewrote ${touched} entries in ${path.basename(LAYOUT_PATH)}`)
}

main().catch(err => { console.error(err); process.exit(1) })

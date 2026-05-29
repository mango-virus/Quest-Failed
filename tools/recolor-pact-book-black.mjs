// Recolor the Craftpix "magic book" sheets into a BLACK-leather grimoire for
// the Dark Pact picker's "black grimoire" (the all-Damned hand). Same approach
// as recolor-pact-book.mjs (purple), but the blue leather is mapped to
// near-black while KEEPING the gold filigree, cream pages, and wood edge — so
// the gold writing/design survives instead of being flattened by a CSS filter.
//
// Usage:  node tools/recolor-pact-book-black.mjs   (re-run-safe, deterministic)

import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const SRC = 'D:/Documents/Game Jam Code/Quest-Failed assets/Craftpix/ui/craftpix-net-809047-free-animated-magic-book-pixel-art-asset-pack/PNG'
const OUT = 'D:/Documents/Game Jam Code/Quest-Failed/assets/sprites/pact-book-black'

const BOOK_SHEETS = ['Open_book.png', 'Close_book.png', 'Turning_pages_left.png', 'Turning_pages_right.png']

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h, s; const l = (max + min) / 2
  if (max === min) { h = s = 0 }
  else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }
  return [h * 360, s, l]
}
function hsl2rgb(h, s, l) {
  h /= 360
  let r, g, b
  if (s === 0) { r = g = b = l }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

async function recolor(file) {
  const { data, info } = await sharp(path.join(SRC, file))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let leather = 0, pages = 0, gold = 0
  for (let i = 0; i < data.length; i += channels) {
    if (data[i + 3] === 0) continue
    const [h, s, l] = rgb2hsl(data[i], data[i + 1], data[i + 2])
    if (h >= 178 && h <= 262 && s > 0.12) {
      // Blue leather -> near-black (keep the light/shadow gradient so it reads
      // as black leather, not a flat fill).
      const [r, g, b] = hsl2rgb(265, s * 0.18, l * 0.22)
      data[i] = r; data[i + 1] = g; data[i + 2] = b
      leather++
    } else if (
      // GOLD filigree/lettering — preserve verbatim. Gold forms a hue
      // "horseshoe": orange midtones (h~38-46) + yellow highlights (S>=0.78).
      // Parchment is a yellow blob at h~48 that sits BETWEEN gold's two arms,
      // so neither a pure hue nor a pure lightness cut separates them — but
      // this two-clause gate does (measured against the asset's real clusters):
      //   - highlights: any warm hue with S>=0.78 (parchment maxes at ~S0.70)
      //   - orange midtones: h 38-46, mid-light, moderate sat (parchment fill
      //     is h~48 and excluded; page-edge shadows are h<=36 and excluded)
      // Gold's DARK outline (h~18, L~0.35) is intentionally NOT preserved — it
      // darkens with the pages, which is invisible on a black book and keeps
      // the parchment shadows from leaking through.
      (h >= 12 && h <= 64) &&
      (s >= 0.78 || (h >= 38 && h <= 46 && l >= 0.52 && s >= 0.42))
    ) {
      gold++
      // leave original RGB untouched
    } else if (h >= 10 && h <= 64 && l >= 0.16 && l < 0.95) {
      // Warm parchment pages + gold's dark outline -> dark neutral charcoal,
      // matching the old grayscale-filter "dark pages" look the player liked.
      const [r, g, b] = hsl2rgb(40, 0.07, l * 0.30)
      data[i] = r; data[i + 1] = g; data[i + 2] = b
      pages++
    }
  }
  await sharp(data, { raw: { width, height, channels } })
    .png().toFile(path.join(OUT, file))
  console.log(`  ${file.padEnd(26)} ${width}x${height}  (leather ${leather}, pages ${pages}, gold ${gold})`)
}

fs.mkdirSync(OUT, { recursive: true })
console.log('Recoloring magic-book sheets -> black leather (gold preserved):')
for (const f of BOOK_SHEETS) await recolor(f)
console.log('Done ->', OUT)

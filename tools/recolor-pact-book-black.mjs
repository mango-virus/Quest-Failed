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
  let hit = 0
  for (let i = 0; i < data.length; i += channels) {
    if (data[i + 3] === 0) continue
    const [h, s, l] = rgb2hsl(data[i], data[i + 1], data[i + 2])
    // Blue leather band (same as the purple tool). Map to a near-black with a
    // faint cool tint, keeping the light/shadow gradient so it reads as black
    // leather rather than a flat fill. Gold filigree (~45), cream pages (~50)
    // and wood (~30) are outside this band and stay untouched.
    if (h >= 178 && h <= 262 && s > 0.12) {
      const [r, g, b] = hsl2rgb(265, s * 0.18, l * 0.22)
      data[i] = r; data[i + 1] = g; data[i + 2] = b
      hit++
    }
  }
  await sharp(data, { raw: { width, height, channels } })
    .png().toFile(path.join(OUT, file))
  console.log(`  ${file.padEnd(26)} ${width}x${height}  (${hit} px blackened)`)
}

fs.mkdirSync(OUT, { recursive: true })
console.log('Recoloring magic-book sheets -> black leather (gold preserved):')
for (const f of BOOK_SHEETS) await recolor(f)
console.log('Done ->', OUT)

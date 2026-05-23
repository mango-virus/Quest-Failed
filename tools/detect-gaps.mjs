// Find vertical / horizontal gaps (columns/rows that are 100%
// transparent) in a PNG. Useful for auto-locating sprite boundaries
// inside hand-laid sheets.
//
// Run: node tools/detect-gaps.mjs <png> [--row y0 y1]
//   without --row: scan vertical columns over the full height
//   with --row y0 y1: only scan rows y0..y1 (useful when a single
//   horizontal band has props laid out side by side)

import sharp from 'sharp'

const file = process.argv[2]
if (!file) { console.error('usage: node detect-gaps.mjs <png> [--row y0 y1]'); process.exit(1) }
let yStart = 0, yEnd = null
const rowIdx = process.argv.indexOf('--row')
if (rowIdx >= 0) { yStart = +process.argv[rowIdx+1]; yEnd = +process.argv[rowIdx+2] }

const img = sharp(file)
const { width, height } = await img.metadata()
if (yEnd == null) yEnd = height

const { data, info } = await img
  .raw({ depth: 'uchar' })
  .toBuffer({ resolveWithObject: true })

const channels = info.channels   // 3 (rgb) or 4 (rgba)
console.log(`# ${file}  ${width}×${height}  ${channels} channels  scan rows ${yStart}..${yEnd}`)

// Per column, is EVERY row in [yStart, yEnd) fully transparent (alpha=0)?
// For channels==3 we treat 'transparent' as undefined → can't gap-detect.
if (channels < 4) { console.error('no alpha channel'); process.exit(1) }

const colIsGap = new Array(width).fill(true)
for (let y = yStart; y < yEnd; y++) {
  for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * channels + 3]
    if (alpha > 0) colIsGap[x] = false
  }
}

// Print runs of opaque columns (sprite bands) and gap widths between them.
let bands = []
let inBand = false, bandStart = 0
for (let x = 0; x < width; x++) {
  if (!colIsGap[x] && !inBand) { inBand = true; bandStart = x }
  else if (colIsGap[x] && inBand) { inBand = false; bands.push([bandStart, x - 1]) }
}
if (inBand) bands.push([bandStart, width - 1])

console.log('\nOpaque vertical bands (sprite columns):')
for (let i = 0; i < bands.length; i++) {
  const [a, b] = bands[i]
  const w = b - a + 1
  const gap = i < bands.length - 1 ? bands[i+1][0] - b - 1 : 0
  console.log(`  band ${String(i+1).padStart(2)}: x=${a}..${b}  w=${w}  (gap-to-next=${gap})`)
}

// Also scan horizontal gaps to detect band-row boundaries.
const rowIsGap = new Array(height).fill(true)
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * channels + 3]
    if (alpha > 0) rowIsGap[y] = false
  }
}
let yBands = []
let inY = false, yStart2 = 0
for (let y = 0; y < height; y++) {
  if (!rowIsGap[y] && !inY) { inY = true; yStart2 = y }
  else if (rowIsGap[y] && inY) { inY = false; yBands.push([yStart2, y - 1]) }
}
if (inY) yBands.push([yStart2, height - 1])

console.log('\nOpaque horizontal bands (sprite rows):')
for (let i = 0; i < yBands.length; i++) {
  const [a, b] = yBands[i]
  console.log(`  yband ${String(i+1).padStart(2)}: y=${a}..${b}  h=${b - a + 1}`)
}

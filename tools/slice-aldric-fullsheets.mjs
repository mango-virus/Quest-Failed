// One-off slicer: convert the four hand-authored Aldric full ULPC sheets (his
// per-ACT dungeon-adventurer forms) into the game's runtime body format:
//   aldric/act<N>.png — 832×1856 standard body sheet (manifest layout)
//
// Standalone (does NOT touch the shared bake-lpc-variants / bake-weapons tools).
// Modelled on slice-lightparty-fullsheets.mjs. An occupancy scan of all four
// sheets (tools/_aldric_scan.mjs) confirmed they share the SAME top body band
// layout as the Light Party sheets, so BODY_ROWS is identical:
//   spellcast b0(7) · thrust b4(8) · walk b8(9) · slash b12(6) · shoot b16(13)
//   hurt b20(6,1row) · idle b22(2) · run b38(8)
//
// NO _atk sheet is generated: the per-act oversize sections differ in width
// (1152 / 1536 / 1664), and Aldric is registered as a NORMAL_ATTACK weapon, so
// the renderer uses the contained 64px slash row (which already shows him
// swinging his sword) — no 1536-wide oversize needed.

import sharp from 'sharp'

const SRC_DIR = 'D:/Documents/Game Jam Code/Quest-Failed assets/!To do/aldric/'
const OUT_DIR = 'assets/sprites/adventurers/aldric/'

const F = 64
const BODY_ROWS = [
  { anim: 'spellcast', dstY: 0,    srcBand: 0,  frames: 7,  dirRows: 4 },
  { anim: 'thrust',    dstY: 256,  srcBand: 4,  frames: 8,  dirRows: 4 },
  { anim: 'walk',      dstY: 512,  srcBand: 8,  frames: 9,  dirRows: 4 },
  { anim: 'slash',     dstY: 768,  srcBand: 12, frames: 6,  dirRows: 4 },
  { anim: 'shoot',     dstY: 1024, srcBand: 16, frames: 13, dirRows: 4 },
  { anim: 'hurt',      dstY: 1280, srcBand: 20, frames: 6,  dirRows: 1 },
  { anim: 'idle',      dstY: 1344, srcBand: 22, frames: 2,  dirRows: 4 },
  { anim: 'run',       dstY: 1600, srcBand: 38, frames: 8,  dirRows: 4 },
]
const BODY_W = 832, BODY_H = 1856

// Output as v01..v04 (the loader's vNN convention; texture keys adv-aldric-vNN).
// v01 = Act I apprentice … v04 = Act IV crowned Hero-King.
const FILES = {
  v01: 'Aldric Act 1.png',
  v02: 'Aldric Act 2.png',
  v03: 'Aldric Act 3.png',
  v04: 'Aldric Act 4.png',
}

async function sliceBody(srcPath, srcW) {
  const composites = []
  for (const row of BODY_ROWS) {
    for (let d = 0; d < row.dirRows; d++) {
      const srcY = (row.srcBand + d) * F
      const dstY = row.dstY + d * F
      const w = row.frames * F
      const buf = await sharp(srcPath)
        .extract({ left: 0, top: srcY, width: Math.min(w, srcW), height: F })
        .toBuffer()
      composites.push({ input: buf, left: 0, top: dstY })
    }
  }
  return sharp({ create: { width: BODY_W, height: BODY_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites).png()
}

async function main() {
  const only = process.argv.slice(2)
  await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer() // warm sharp
  const fs = await import('fs')
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const [variant, file] of Object.entries(FILES)) {
    if (only.length && !only.includes(variant)) continue
    const srcPath = SRC_DIR + file
    const meta = await sharp(srcPath).metadata()
    const body = await sliceBody(srcPath, meta.width)
    await body.toFile(`${OUT_DIR}${variant}.png`)
    console.log(`${variant}: ${variant}.png (832x1856) ← ${file} (${meta.width}x${meta.height})`)
  }
  console.log('done')
}
main().catch(e => { console.error(e); process.exit(1) })

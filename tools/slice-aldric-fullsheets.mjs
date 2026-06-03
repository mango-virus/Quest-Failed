// One-off slicer: convert the four hand-authored Aldric full ULPC sheets (his
// per-ACT dungeon-adventurer forms) into the game's runtime format:
//   aldric/v0<N>.png      — 832×1856 standard body sheet (manifest layout)
//   aldric/v0<N>_atk.png  — 1536×1536 oversize attack sheet (192px frames)
//
// Standalone (does NOT touch the shared bake-lpc-variants / bake-weapons tools).
// Modelled on slice-lightparty-fullsheets.mjs. An occupancy scan of all four
// sheets confirmed they share the SAME top body band layout as the Light Party
// sheets, so BODY_ROWS is identical:
//   spellcast b0(7) · thrust b4(8) · walk b8(9) · slash b12(6) · shoot b16(13)
//   hurt b20(6,1row) · idle b22(2) · run b38(8)
//
// _atk sheet (added 2026-06-02): Aldric is a longsword swordsman, so his swing is
// slash_OVERSIZE — the blade extends well past the 64px frame and only exists in
// the bottom oversize band (the contained 64px slash row clips the blade away, so
// his sword was invisible mid-attack). All four acts put the 6-frame slash at
// src-Y 3456; Acts II–IV are native 192px frames, Act I (the 1664-wide expanded
// sheet) is 128px frames centered+feet-aligned into the 192 dest cell (same trick
// as the samurai). Verified by viewing each sheet's oversize band.

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

// _atk: 192px DEST frames, dest 1536×1536 (8 cols × 8 rows). Slash → dest rows
// 0–3 (N/W/S/E). Per-variant SOURCE frame size + Y of the first (N) direction row.
// v01 is 128px (1664-wide sheet) → centered + feet-aligned into the 192 cell
// (offX/offY 32), like the samurai; v02–v04 are native 192px (offset 0).
const A = 192, ATK_W = 1536, ATK_H = 1536
const ATK_DST_START_ROW = { slash: 0, thrust: 4 }
const ATK = {
  v01: { kind: 'slash', srcFrame: 128, srcY: 3456, frames: 6, offX: 32, offY: 32 },
  v02: { kind: 'slash', srcFrame: 192, srcY: 3456, frames: 6, offX: 0,  offY: 0  },
  v03: { kind: 'slash', srcFrame: 192, srcY: 3456, frames: 6, offX: 0,  offY: 0  },
  v04: { kind: 'slash', srcFrame: 192, srcY: 3456, frames: 6, offX: 0,  offY: 0  },
}

async function sliceAtk(srcPath, srcW, cfg) {
  const dstStartRow = ATK_DST_START_ROW[cfg.kind]
  const sf = cfg.srcFrame
  const composites = []
  for (let d = 0; d < 4; d++) {            // N / W / S / E
    const srcRowY = cfg.srcY + d * sf
    const dstRow = dstStartRow + d
    for (let f = 0; f < cfg.frames; f++) {
      const sx = f * sf
      if (sx + sf > srcW) break
      const buf = await sharp(srcPath).extract({ left: sx, top: srcRowY, width: sf, height: sf }).toBuffer()
      composites.push({ input: buf, left: f * A + cfg.offX, top: dstRow * A + cfg.offY })
    }
  }
  return sharp({ create: { width: ATK_W, height: ATK_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites).png()
}

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
    const cfg = ATK[variant]
    let atkNote = '(no atk cfg)'
    if (cfg) {
      const atk = await sliceAtk(srcPath, meta.width, cfg)
      await atk.toFile(`${OUT_DIR}${variant}_atk.png`)
      atkNote = `+ ${variant}_atk.png (1536x1536, ${cfg.kind}×${cfg.frames}, ${cfg.srcFrame}px)`
    }
    console.log(`${variant}: ${variant}.png (832x1856) ${atkNote} ← ${file} (${meta.width}x${meta.height})`)
  }
  console.log('done')
}
main().catch(e => { console.error(e); process.exit(1) })

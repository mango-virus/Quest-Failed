// One-off slicer: convert the four hand-authored Light Party full ULPC sheets
// (paladin / white mage / black mage / samurai) into the game's runtime format:
//   <class>/v01.png      — 832×1856 standard body sheet (the manifest layout)
//   <class>/v01_atk.png  — 1536×1536 oversize attack sheet (192px frames)
//
// Source sheets are modern ULPC "universal + expanded" exports (1536-wide, the
// samurai 1664-wide). Their 64px body section uses the standard row order at the
// TOP — but with the expanded set the rows we need are NOT all contiguous, so we
// copy each needed anim from its real source-Y to the destination-Y the game's
// manifest expects. The 192px oversize weapon-attack frames live at the bottom.
//
// Body layout the GAME expects (manifest.layout, frame=64, width=832, h=1856):
//   spellcast y0 (7f) · thrust y256 (8f) · walk y512 (9f) · slash y768 (6f)
//   shoot y1024 (13f) · hurt y1280 (6f,1row) · idle y1344 (2f) · run y1600 (8f)
//
// Source 64px bands (verified by occupancy scan, all 4 sheets identical top):
//   b0 spellcast(7) · b4 thrust(8) · b8 walk(9) · b12 slash(6) · b16 shoot(13)
//   b20 hurt(6) · b22 idle(2) · b26 sit(5) · b30 emote(3) · b38 run(8) · …
//   → idle src y=22*64=1408 ; run src y=38*64=2432
//
// _atk layout the GAME expects (AdventurerAtkLoader): 192px frames, 8 cols,
//   slash  rows 0-3 (6 frames each, dirs N/W/S/E)
//   thrust rows 4-7 (8 frames each, dirs N/W/S/E)
//
// Per-class atk choice (ATK_ANIMS={slash,thrust} drives which the renderer uses):
//   paladin → slash_oversize   (native 192px, 6 frames, src y=3456)
//   white_mage / black_mage → thrust_oversize (native 192px, 8 frames staff, src y=3456)
//   samurai → slash_oversize   (NOTE: samurai sheet is 1664-wide = 13×128, its
//     oversize frames are 128px — NOT 192 like the others. The 6-frame katana
//     slash lives at src y=3456 (rows 3456/3584/3712/3840 = N/W/S/E). Each 128px
//     frame is composited into the 192px dest cell at offset (32,32): centered
//     horizontally and feet-aligned (samurai feet ≈y93 in its 128 frame → land at
//     ≈y125 in the cell, matching the native-192 classes' feet line). Char height
//     is ~equal (48 vs 51px) so NO scaling — just placement.)

import sharp from 'sharp'

const SRC_DIR = 'D:/Documents/Game Jam Code/Quest-Failed assets/!To do/light party/'
const OUT_DIR = 'assets/sprites/adventurers/'

const F = 64
// Destination body rows (game manifest) → which source 64px band each starts at.
// All four sheets share the same top layout, so this map is shared.
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

// _atk: 192px DEST frames, dest 1536×1536 (8 cols × 8 rows).
const A = 192
const ATK_W = 1536, ATK_H = 1536
// Per class: the SOURCE oversize frame size (srcFrame — 192 for the 1536-wide
// sheets, 128 for the 1664-wide samurai), the absolute source-Y of the FIRST
// direction row (N; subsequent dirs are +srcFrame), the dest anim slot, frame
// count, and the placement offset used when the source frame is smaller than the
// 192 dest cell (centered + feet-aligned — see header note).
const ATK = {
  paladin:    { kind: 'slash',  srcFrame: 192, srcY: 3456, frames: 6, offX: 0,  offY: 0  },
  white_mage: { kind: 'thrust', srcFrame: 192, srcY: 3456, frames: 8, offX: 0,  offY: 0  },
  black_mage: { kind: 'thrust', srcFrame: 192, srcY: 3456, frames: 8, offX: 0,  offY: 0  },
  samurai:    { kind: 'slash',  srcFrame: 128, srcY: 3456, frames: 6, offX: 32, offY: 32 },
}
// Dest start row for each anim slot in the _atk sheet (matches AdventurerAtkLoader).
const ATK_DST_START_ROW = { slash: 0, thrust: 4 }

const FILES = {
  paladin:    'paladin.png',
  white_mage: 'white mage.png',
  black_mage: 'black mage.png',
  samurai:    'samurai.png',
}

async function sliceBody(srcPath, srcW) {
  const composites = []
  for (const row of BODY_ROWS) {
    for (let d = 0; d < row.dirRows; d++) {
      const srcY = (row.srcBand + d) * F
      const dstY = row.dstY + d * F
      const w = row.frames * F
      // Extract this direction-strip from the source and place it in the dest.
      const buf = await sharp(srcPath)
        .extract({ left: 0, top: srcY, width: Math.min(w, srcW), height: F })
        .toBuffer()
      composites.push({ input: buf, left: 0, top: dstY })
    }
  }
  return sharp({ create: { width: BODY_W, height: BODY_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites).png()
}

async function sliceAtk(srcPath, srcW, cfg) {
  const dstStartRow = ATK_DST_START_ROW[cfg.kind]
  const sf = cfg.srcFrame                  // source frame size (192 or 128)
  const composites = []
  for (let d = 0; d < 4; d++) {            // N / W / S / E
    const srcRowY = cfg.srcY + d * sf
    const dstRow = dstStartRow + d
    for (let f = 0; f < cfg.frames; f++) {
      const sx = f * sf
      if (sx + sf > srcW) break
      // Extract one source frame and drop it into its 192px dest cell at the
      // configured offset (0,0 for native-192; centered+feet-aligned for samurai).
      const buf = await sharp(srcPath)
        .extract({ left: sx, top: srcRowY, width: sf, height: sf })
        .toBuffer()
      composites.push({ input: buf, left: f * A + cfg.offX, top: dstRow * A + cfg.offY })
    }
  }
  return sharp({ create: { width: ATK_W, height: ATK_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites).png()
}

async function main() {
  // Optional CLI filter: `node slice-lightparty-fullsheets.mjs samurai` only
  // regenerates the named class(es), so re-slicing one class doesn't re-touch
  // the others' already-committed output.
  const only = process.argv.slice(2)
  for (const [cls, file] of Object.entries(FILES)) {
    if (only.length && !only.includes(cls)) continue
    const srcPath = SRC_DIR + file
    const meta = await sharp(srcPath).metadata()
    const body = await sliceBody(srcPath, meta.width)
    await body.toFile(`${OUT_DIR}${cls}/v01.png`)
    const atk = await sliceAtk(srcPath, meta.width, ATK[cls])
    await atk.toFile(`${OUT_DIR}${cls}/v01_atk.png`)
    console.log(`${cls}: v01.png (832x1856) + v01_atk.png (1536x1536, ${ATK[cls].kind}×${ATK[cls].frames}) ← ${file}`)
  }
  console.log('done')
}
main().catch(e => { console.error(e); process.exit(1) })

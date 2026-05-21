// One-time: re-pack the irregularly-trimmed trap sprite sheets into clean
// uniform horizontal strips Phaser can load as spritesheets. Source art lives
// outside the repo; output lands in assets/sprites/traps/ + manifest.json.
//
// Run:  node tools/bake-traps.mjs
//
// Per-sheet config derived from tools/analyze-traps.mjs gutter analysis.
// layout: 'row'  → frames left-to-right, stride cellW
//         'col'  → frames top-to-bottom, stride cellH (re-emitted L→R)
//         'grid' → cols×rows, column-major read order (saw_vertical)
import sharp from 'sharp'
import path from 'path'
import fs from 'fs'

const SRC = 'D:/Documents/Game Jam Code/Quest-Failed assets/!To do/TRAPS'
const OUT = 'D:/Documents/Game Jam Code/Quest-Failed/assets/sprites/traps'

const SHEETS = [
  { key: 'arrow',          file: 'Arrow2.png',               layout: 'row', count: 12, cellW: 16,  cellH: 157 },
  { key: 'bomb',           file: 'Bomb.png',                 layout: 'row', count: 12, cellW: 48,  cellH: 48  },
  { key: 'cannon-up',      file: 'Cannon_up.png',            layout: 'row', count: 12, cellW: 16,  cellH: 100 },
  { key: 'cannon-down',    file: 'Cannon_down.png',          layout: 'row', count: 12, cellW: 16,  cellH: 123 },
  { key: 'cannon-left',    file: 'Cannon_left.png',          layout: 'col', count: 12, cellW: 128, cellH: 32  },
  { key: 'cannon-right',   file: 'Cannon_right.png',         layout: 'col', count: 12, cellW: 127, cellH: 32  },
  { key: 'dragon-ud',      file: 'dragon_updown.png',        layout: 'row', count: 10, cellW: 32,  cellH: 76  },
  { key: 'dragon-rl',      file: 'dragon_rightleft.png',     layout: 'grid', cols: 3, rows: 4, colMajor: false, count: 10, cellW: 96, cellH: 32 },
  { key: 'spike-pillar',   file: 'column_trap.png',          layout: 'row', count: 6,  cellW: 48,  cellH: 64  },
  { key: 'spike-pit',      file: 'plate_trap.png',           layout: 'row', count: 6,  cellW: 48,  cellH: 32  },
  { key: 'rotating-blades',file: 'Rotating_blades.png',      layout: 'col', count: 4,  cellW: 48,  cellH: 48  },
  { key: 'saw-h',          file: 'trap_saw_horizontal.png',  layout: 'col', count: 6,  cellW: 70,  cellH: 32  },
  { key: 'saw-v',          file: 'trap_saw_vertical.png',    layout: 'grid',cols: 2, rows: 3, colMajor: true, cellW: 16, cellH: 64 },
]

function cellRects(cfg, imgW, imgH) {
  const rects = []
  if (cfg.layout === 'row') {
    for (let i = 0; i < cfg.count; i++) rects.push({ x: i * cfg.cellW, y: 0, w: cfg.cellW, h: cfg.cellH })
  } else if (cfg.layout === 'col') {
    for (let i = 0; i < cfg.count; i++) rects.push({ x: 0, y: i * cfg.cellH, w: cfg.cellW, h: cfg.cellH })
  } else { // grid — colMajor reads down-then-across, else across-then-down
    const order = []
    if (cfg.colMajor) {
      for (let c = 0; c < cfg.cols; c++) for (let r = 0; r < cfg.rows; r++) order.push([c, r])
    } else {
      for (let r = 0; r < cfg.rows; r++) for (let c = 0; c < cfg.cols; c++) order.push([c, r])
    }
    const n = cfg.count ?? order.length
    for (let i = 0; i < n; i++) {
      const [c, r] = order[i]
      rects.push({ x: c * cfg.cellW, y: r * cfg.cellH, w: cfg.cellW, h: cfg.cellH })
    }
  }
  // Clamp to image bounds (sheets are trimmed a few px short of count*cell).
  return rects.map(r => ({
    x: Math.min(r.x, imgW - 1),
    y: Math.min(r.y, imgH - 1),
    w: Math.max(1, Math.min(r.w, imgW - r.x)),
    h: Math.max(1, Math.min(r.h, imgH - r.y)),
  }))
}

fs.mkdirSync(OUT, { recursive: true })
const manifest = {}

for (const cfg of SHEETS) {
  const src = sharp(path.join(SRC, cfg.file))
  const meta = await src.metadata()
  const rects = cellRects(cfg, meta.width, meta.height)
  const fw = cfg.cellW, fh = cfg.cellH
  const count = rects.length

  // Extract each frame at its natural cell offset (no re-centring — that
  // shifts edge-of-sheet frames whose extract was clamped) and lay out L→R.
  const composites = []
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    const frame = await sharp(path.join(SRC, cfg.file))
      .extract({ left: r.x, top: r.y, width: r.w, height: r.h })
      .toBuffer()
    composites.push({ input: frame, left: i * fw, top: 0 })
  }

  const outFile = `${cfg.key}.png`
  await sharp({
    create: { width: fw * count, height: fh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(composites).png().toFile(path.join(OUT, outFile))

  manifest[cfg.key] = { file: `assets/sprites/traps/${outFile}`, frameWidth: fw, frameHeight: fh, count }
  console.log(`baked ${cfg.key.padEnd(16)} ${count} frames @ ${fw}x${fh}  ->  ${outFile}`)
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\nwrote ${OUT}/manifest.json`)

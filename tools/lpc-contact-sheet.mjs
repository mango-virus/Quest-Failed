// Build a contact sheet of an adventurer class's baked variants — extracts one
// frame (default: south-facing walk frame 1) from each variant spritesheet,
// upscales it, and tiles them into a single labelled PNG for visual review.
//
// Usage:
//   node tools/lpc-contact-sheet.mjs <class> [anim] [dir] [frame] [outPng]
//   node tools/lpc-contact-sheet.mjs knight            # walk/down/1
//   node tools/lpc-contact-sheet.mjs knight idle down 0
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT_ROOT = 'assets/sprites/adventurers';
const cls   = process.argv[2];
const anim  = process.argv[3] || 'walk';
const dir   = process.argv[4] || 'down';
const frame = parseInt(process.argv[5] ?? '1', 10);
const outPng = process.argv[6] || path.join('tools', `_contact_${cls}.png`);
if (!cls) { console.error('usage: node tools/lpc-contact-sheet.mjs <class> [anim] [dir] [frame] [out]'); process.exit(2); }

const layout = JSON.parse(fs.readFileSync(path.join(OUT_ROOT, 'layout.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT_ROOT, 'manifest.json'), 'utf8'));
const variants = manifest.variants[cls];
if (!variants?.length) { console.error(`no variants for class "${cls}"`); process.exit(1); }

const F = layout.frame;                                   // 64
const row = layout.rows.find((r) => r.anim === anim);
if (!row) { console.error(`unknown anim "${anim}"`); process.exit(1); }
const DIRS = { up: 0, left: 1, down: 2, right: 3 };
const dirIdx = row.dirRows === 1 ? 0 : (DIRS[dir] ?? 2);
const srcX = frame * F;
const srcY = row.y + dirIdx * F;

const SCALE = 3;                                          // 64 → 192
const CELL = F * SCALE;
const PAD = 10;
const LABEL_H = 26;
const COLS = Math.min(6, variants.length);
const ROWS = Math.ceil(variants.length / COLS);
const cellW = CELL + PAD * 2;
const cellH = CELL + PAD + LABEL_H;
const W = COLS * cellW;
const H = ROWS * cellH;

const composites = [];
const labels = [];
for (let i = 0; i < variants.length; i++) {
  const v = variants[i];
  const col = i % COLS, r = Math.floor(i / COLS);
  const cx = col * cellW + PAD;
  const cy = r * cellH + PAD;
  const sheet = path.join(OUT_ROOT, cls, `${v.id}.png`);
  if (!fs.existsSync(sheet)) continue;
  const crop = await sharp(sheet)
    .extract({ left: srcX, top: srcY, width: F, height: F })
    .resize(CELL, CELL, { kernel: 'nearest' })
    .toBuffer();
  composites.push({ input: crop, left: cx, top: cy });
  const wpn = (v.weapon || '—').replace(/&/g, '+');
  const extra = [v.bodyType, v.clothColor, wpn].filter(Boolean).join(' · ');
  labels.push(
    `<text x="${cx + CELL / 2}" y="${cy + CELL + 12}" font-family="monospace" font-size="11" fill="#e8e8f0" text-anchor="middle">${v.id} ${v.bodyType}</text>`,
    `<text x="${cx + CELL / 2}" y="${cy + CELL + 23}" font-family="monospace" font-size="9" fill="#9aa" text-anchor="middle">${v.clothColor}/${v.metalColor} ${wpn}</text>`,
  );
}
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${labels.join('')}</svg>`;

await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0x1a, g: 0x1c, b: 0x24, alpha: 1 } } })
  .composite([...composites, { input: Buffer.from(svg), left: 0, top: 0 }])
  .png()
  .toFile(outPng);
console.log(`wrote ${outPng} (${variants.length} variants, ${anim}/${dir}/${frame}, ${W}x${H})`);

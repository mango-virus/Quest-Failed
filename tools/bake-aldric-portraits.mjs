// Bake Aldric's per-act portrait PNGs (Photoroom alpha-cuts) into HUD-sized
// WebP, mirroring the companion pipeline (tools/bake-npc-sprites.mjs). The
// NemesisPortrait reads these per act + expression (assets/npc-aldric/act<N>/).
//
// Standalone (does NOT touch the shared bake-npc-sprites tool). Re-runnable.
//   node tools/bake-aldric-portraits.mjs 1     ← bake act 1
//   node tools/bake-aldric-portraits.mjs all   ← bake every act folder present

import sharp from 'sharp'
import fs from 'fs'

const WIDTH    = 560   // matches the companion default; HUD scales it down
const SRC_ROOT = 'D:/Documents/Game Jam Code/Quest-Failed assets/!To do/aldric'
const OUT_ROOT = 'assets/npc-aldric'

// "cocky vow-Photoroom.png" → "cocky-vow"; "aldric act 1 idle" / "aldric idle act 2"
// → "idle"; "badly hurt and dying" → "badly-hurt-and-dying".
function exprId(file) {
  return file
    .replace(/-Photoroom/i, '')
    .replace(/\.png$/i, '')
    .toLowerCase()
    .replace(/\baldric\b/g, '')        // drop the "aldric" token wherever it sits
    .replace(/\bact\s*\d+\b/g, '')     // drop the "act N" token wherever it sits
    .trim().replace(/\s+/g, '-')
}

async function bakeAct(act) {
  const srcDir = `${SRC_ROOT}/act ${act}`
  const outDir = `${OUT_ROOT}/act${act}`
  if (!fs.existsSync(srcDir)) { console.log(`(skip) no source: ${srcDir}`); return null }
  fs.mkdirSync(outDir, { recursive: true })
  const files = fs.readdirSync(srcDir).filter(f => /\.png$/i.test(f))
  const ids = []
  for (const f of files) {
    const id = exprId(f)
    await sharp(`${srcDir}/${f}`)
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: 84, alphaQuality: 90, effort: 6 })
      .toFile(`${outDir}/${id}.webp`)
    ids.push(id)
    console.log(`  ${id.padEnd(14)} ← ${f}`)
  }
  console.log(`act ${act}: ${ids.length} → ${outDir}/`)
  console.log(`ids: ${JSON.stringify(ids.sort())}\n`)
  return ids
}

async function main() {
  const arg = (process.argv[2] || '1').toLowerCase()
  const acts = arg === 'all' ? ['1', '2', '3', '4'] : [arg.replace(/\D/g, '') || '1']
  for (const a of acts) await bakeAct(a)
  console.log('done')
}
main().catch(e => { console.error(e); process.exit(1) })

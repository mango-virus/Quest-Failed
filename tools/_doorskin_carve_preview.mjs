import sharp from 'sharp'
import { carveDoorOpening } from '../src/util/doorSkinCarve.js'
const files = ['entry_open_1.png','gnoll_open_v2.png','vampire_open.png','wraith_open.png','myconid_open.png','beholder_opened.png','lizardman_opened.png']
const THR = 24
for (const f of files) {
  const p = `assets/themes/doorskins/${f}`
  let before, info
  try {
    const r = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    before = r.data; info = r.info
  } catch (e) { console.log(`${f}: ${e.message}`); continue }
  const { width: w, height: h } = info
  const after = Buffer.from(before)            // copy
  const carved = carveDoorOpening(after, w, h, THR)
  // Build an overlay: original art flattened over mid-grey, with CARVED pixels
  // (were opaque, now transparent) painted bright red. So red = exactly what the
  // carve removed. It must cover ONLY the passage, never the frame/sky/lines.
  const out = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const j = i * 4
    const wasOpaque = before[j + 3] > 0, nowGone = after[j + 3] === 0
    if (wasOpaque && nowGone) { out[j] = 255; out[j+1] = 0; out[j+2] = 0; out[j+3] = 255 } // carved → red
    else {
      // composite original over grey
      const a = before[j+3] / 255
      out[j]   = Math.round(before[j]   * a + 90 * (1 - a))
      out[j+1] = Math.round(before[j+1] * a + 90 * (1 - a))
      out[j+2] = Math.round(before[j+2] * a + 90 * (1 - a))
      out[j+3] = 255
    }
  }
  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(`tools/_carve_${f}`)
  console.log(`${f.padEnd(22)} ${w}x${h}  carved ${carved} px (${(carved/(w*h)*100).toFixed(1)}%)`)
}

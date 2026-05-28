// Bakes the blue "shadow portal" used in Sung Jinwoo's win-outro from the
// existing demon-portal sheet. True hue-rotation (preserves the swirl's
// shading/animation), shifting the demon portal's dominant ~132° green-teal to
// ~212° azure — the Shadow Monarch blue (#4aa0ff ≈ 210°).
//
//   node tools/bake-shadow-portal.cjs
//
// Output: assets/sprites/shadow_portal.png  (same 96×64, 6-frame layout)
const sharp = require('sharp')

const SRC    = 'assets/sprites/demon_portal.png'
const OUT    = 'assets/sprites/shadow_portal.png'
const ROTATE = 80   // demon dominant ~132° → ~193° azure-cyan (Shadow Monarch blue family)

function dominantHue(data, info) {
  const px = info.width * info.height
  let sx = 0, sy = 0, n = 0
  for (let i = 0; i < px; i++) {
    const r = data[i*4]/255, g = data[i*4+1]/255, b = data[i*4+2]/255, a = data[i*4+3]
    if (a < 128) continue
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx - mn
    if (d < 0.12) continue
    let h
    if (mx === r) h = ((g-b)/d) % 6
    else if (mx === g) h = (b-r)/d + 2
    else h = (r-g)/d + 4
    h *= 60; if (h < 0) h += 360
    const rad = h * Math.PI/180; sx += Math.cos(rad); sy += Math.sin(rad); n++
  }
  let mean = Math.atan2(sy, sx) * 180/Math.PI; if (mean < 0) mean += 360
  return { mean, n }
}

;(async () => {
  await sharp(SRC).modulate({ hue: ROTATE }).png().toFile(OUT)
  const { data, info } = await sharp(OUT).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { mean, n } = dominantHue(data, info)
  console.log(`baked ${OUT} (${info.width}×${info.height}) — new dominant hue ${mean.toFixed(1)}° over ${n} px`)
})()

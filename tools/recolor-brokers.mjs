// Recolour the pact-broker sprites into themed colour variants.
//
//  * Idle brokers (MOR'NUL / SYLTH / AG'AZOTH): the pink-hair + purple-
//    wing band (hue ~255-348) is remapped onto a narrow spread around a
//    target hue. Skin (hue ~350-20) and pure greys are left untouched.
//  * VEX'KAR (the dark-deal demon): a desaturated near-black version and
//    a deep blood-red version.
//
// Usage:  node tools/recolor-brokers.mjs   (deterministic; re-runnable)

import sharp from 'sharp'
import path from 'node:path'

const PB = 'D:/Documents/Game Jam Code/Quest-Failed/assets/sprites/pact-broker'
const DEMON = 'D:/Documents/Game Jam Code/Quest-Failed/assets/sprites/event_dark_deal_demon.png'

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
  h = (((h % 360) + 360) % 360) / 360
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
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3)
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

async function transform(src, out, fn) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const rgb = fn(data[i], data[i + 1], data[i + 2])
    if (rgb) { data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2] }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png().toFile(out)
  console.log('  ' + path.basename(out))
}

// Idle broker: remap the pink/purple band onto a tight spread around
// `target`. Band hue 255-348; the centre (300) maps to `target`, and
// the band's 93° width is compressed to ~25° so a hint of the original
// hair↔wing two-tone survives. Skin and greys (outside the band, or
// near-zero saturation) pass through.
const recolorIdle = (target) => (r, g, b) => {
  const [h, s, l] = rgb2hsl(r, g, b)
  if (s < 0.10 || h < 255 || h > 348) return null
  return hsl2rgb(target + (h - 300) * 0.27, s, l)
}

// VEX'KAR — near-black: crush saturation, darken.
const demonBlack = (r, g, b) => {
  const [h, s, l] = rgb2hsl(r, g, b)
  return hsl2rgb(h, s * 0.16, l * 0.6)
}
// VEX'KAR — blood-red: flatten hue to deep red, push saturation.
const demonRed = (r, g, b) => {
  const [h, s, l] = rgb2hsl(r, g, b)
  return hsl2rgb(3, Math.min(1, s * 1.1 + 0.25), l * 0.94)
}

// Idle broker — black/red: the pink band (hair + cape, hue 318-348)
// goes near-black; the purple band (outfit + wings, hue 255-318) goes
// blood-red. Lightness is kept on the red so the dark wing membrane
// reads as black-red rather than flat red. Skin and greys pass through.
const blackRed = (r, g, b) => {
  const [h, s, l] = rgb2hsl(r, g, b)
  if (s < 0.10) return null
  if (h >= 318 && h <= 348) return hsl2rgb(h, s * 0.14, l * 0.42)
  if (h >= 255 && h < 318)  return hsl2rgb(2, Math.min(1, s * 0.7 + 0.5), l * 0.96)
  return null
}

const GREEN = 128, GOLD = 41, BLUE = 205

console.log('Recolouring pact-broker variants:')
// Idle brokers (2, 3, 4) — 2 colour schemes + a black/red variant each.
await transform(`${PB}/broker-idle-2.png`, `${PB}/broker-idle-2-gold.png`,     recolorIdle(GOLD))
await transform(`${PB}/broker-idle-2.png`, `${PB}/broker-idle-2-green.png`,    recolorIdle(GREEN))
await transform(`${PB}/broker-idle-2.png`, `${PB}/broker-idle-2-blackred.png`, blackRed)
await transform(`${PB}/broker-idle-3.png`, `${PB}/broker-idle-3-blue.png`,     recolorIdle(BLUE))
await transform(`${PB}/broker-idle-3.png`, `${PB}/broker-idle-3-gold.png`,     recolorIdle(GOLD))
await transform(`${PB}/broker-idle-3.png`, `${PB}/broker-idle-3-blackred.png`, blackRed)
await transform(`${PB}/broker-idle-4.png`, `${PB}/broker-idle-4-green.png`,    recolorIdle(GREEN))
await transform(`${PB}/broker-idle-4.png`, `${PB}/broker-idle-4-blue.png`,     recolorIdle(BLUE))
await transform(`${PB}/broker-idle-4.png`, `${PB}/broker-idle-4-blackred.png`, blackRed)
// VEX'KAR variants.
await transform(DEMON, `${PB}/demon-black.png`, demonBlack)
await transform(DEMON, `${PB}/demon-red.png`,   demonRed)
console.log('Done.')

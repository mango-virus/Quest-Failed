// Generate per-archetype "dark ascension" T4 boss sheets (KR P6).
//
// Most bosses reuse their canonical (T3) sheet at T4, so the final form didn't
// read as distinct. This bakes a corrupted recolor of the canonical sheet into
// `assets/sprites/<id>/<id>-t4-<state>.png` so Act IV has a real evolved form
// (the slime sources its brown T3 instead, since its base sheet dupes T1).
//
// Technique per boss: modulate (darken + saturation, optional hue rotate) then
// MULTIPLY a tint layer (lerped white→tint by `strength`) so only the boss
// pixels are stained (multiply preserves the base alpha) toward a menacing
// palette. Run:  node tools/recolor-t4.mjs
//
// Re-runnable / idempotent — overwrites the t4 sheets each time, so it's the
// tuning loop: edit RECIPE, re-run, eyeball, repeat.

import sharp from 'sharp'
import { promises as fs } from 'fs'

const DIR = 'assets/sprites'
const STATES = ['idle', 'walk', 'run', 'attack', 'hurt', 'death']
const C = s => s[0].toUpperCase() + s.slice(1)

// Canonical (T3) source filename per boss. Slime sources its brown T3 sheet;
// succubus has no `_with_shadow` suffix.
const PREFIX = {
  beholder: 'Beholder3', demon: 'Demon3', gnoll: 'Gnoll3', golem: 'Golem3',
  lich: 'Lich3', lizardman: 'Lizardman3', myconid: 'Mushroom3', orc: 'orc3',
  vampire: 'Vampires3', wraith: 'Ghost3',
}
function srcPath(id, state) {
  if (id === 'slime')    return `${DIR}/slime/slime-t3-${state}.png`
  if (id === 'succubus') return `${DIR}/succubus/Succubus_${C(state)}.png`
  return `${DIR}/${id}/${PREFIX[id]}_${C(state)}_with_shadow.png`
}

// Per-archetype corruption recipe. tint = the stain colour; strength = how far
// toward it (0 none, 1 full multiply); bright/sat modulate; hue optional rotate.
const RECIPE = {
  beholder:  { bright: 0.80, sat: 1.22, hue: 55,     tint: [178,  50,  62], strength: 0.50 },  // void-purple → crimson eye
  demon:     { bright: 0.70, sat: 1.18, hue: 25,     tint: [92,   30,  98], strength: 0.50 },  // hellfire → void-purple, darker
  gnoll:     { bright: 0.82, sat: 1.08,              tint: [150,  60,  55], strength: 0.40 },
  golem:     { bright: 0.70, sat: 1.18, hue: 35,     tint: [112,  55, 168], strength: 0.52 },  // stone → obsidian-violet
  lich:      { bright: 0.86, sat: 1.22, hue: -30,    tint: [175,  40,  56], strength: 0.46 },
  lizardman: { bright: 0.82, sat: 1.20,              tint: [80,  150,  62], strength: 0.38 },
  myconid:   { bright: 0.80, sat: 1.25, hue: 45,     tint: [178,  50,  76], strength: 0.46 },  // fungal purple → crimson rot
  orc:       { bright: 0.80, sat: 1.16, hue: -60,    tint: [155,  46,  46], strength: 0.42 },
  slime:     { bright: 0.82, sat: 1.26,              tint: [115,  52, 178], strength: 0.46 },
  vampire:   { bright: 0.82, sat: 1.26,              tint: [165,  26,  48], strength: 0.46 },
  wraith:    { bright: 0.90, sat: 1.20,              tint: [125,  92, 185], strength: 0.40 },
  succubus:  { bright: 0.82, sat: 1.22,              tint: [172,  30,  70], strength: 0.48 },  // deeper crimson
}

const lerp = (a, b, t) => Math.round(a * (1 - t) + b * t)
const layerColor = (tint, strength) => tint.map(c => lerp(255, c, strength))

async function recolorOne(id, state) {
  const src = srcPath(id, state)
  try { await fs.access(src) } catch { return { id, state, ok: false, why: 'no source' } }
  const r = RECIPE[id]
  const [lr, lg, lb] = layerColor(r.tint, r.strength)
  const mod = { brightness: r.bright, saturation: r.sat }
  if (r.hue != null) mod.hue = r.hue
  // linear() multiplies the RGB channels per-tint (a darkening stain toward the
  // corruption colour) while leaving ALPHA untouched — so the transparent frame
  // padding stays transparent (a multiply-composite of an opaque layer would
  // fill it). ensureAlpha guarantees the 4th channel for the [r,g,b,1] map.
  const out = await sharp(src)
    .ensureAlpha()
    .modulate(mod)
    .linear([lr / 255, lg / 255, lb / 255, 1], [0, 0, 0, 0])
    .png().toBuffer()
  await fs.writeFile(`${DIR}/${id}/${id}-t4-${state}.png`, out)
  return { id, state, ok: true }
}

const ids = Object.keys(RECIPE)
let made = 0, failed = []
for (const id of ids) {
  for (const state of STATES) {
    const res = await recolorOne(id, state)
    if (res.ok) made++; else failed.push(`${res.id}-t4-${res.state} (${res.why})`)
  }
}
console.log(`recolor-t4: wrote ${made} sheets across ${ids.length} bosses`)
if (failed.length) console.log('FAILED:\n  ' + failed.join('\n  '))

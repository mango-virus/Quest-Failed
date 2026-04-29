// LPC variant baker for Quest-Failed.
//
// Reads the LPC sheet_definitions + spritesheets and produces N flattened
// 832x1856 spritesheets per adventurer class, one PNG per variant. Each
// sheet contains 8 animations stacked vertically:
//   spellcast (4×7 frames), thrust (4×8), walk (4×9), slash (4×6),
//   shoot (4×13), hurt (1×6), idle (4×2), run (4×8).
// Frames are 64×64 throughout (standard layout, no oversized custom anims).
//
// Usage:
//   node tools/bake-lpc-variants.mjs <lpc-root> [out-dir] [variants] [classes]
// Examples:
//   # bake one Knight (test):
//   node tools/bake-lpc-variants.mjs <lpc-root> assets/sprites/adventurers 1 knight
//   # full production bake:
//   node tools/bake-lpc-variants.mjs <lpc-root>

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { POOLS, COMMON, CRYSTAL_RULE, VARIANT_COUNT } from './lpc-pools.mjs';

const argv = process.argv.slice(2);
const lpcRoot = argv[0];
const outRoot = argv[1] || 'assets/sprites/adventurers';
const variantCount = parseInt(argv[2] || `${VARIANT_COUNT}`, 10) || VARIANT_COUNT;
const classFilter = (argv[3] || '').split(',').filter(Boolean);

if (!lpcRoot) {
  console.error('usage: node tools/bake-lpc-variants.mjs <lpc-root> [out-dir] [variants] [classes]');
  process.exit(2);
}
const sdRoot = path.join(lpcRoot, 'sheet_definitions');
const ssRoot = path.join(lpcRoot, 'spritesheets');
if (!fs.existsSync(sdRoot) || !fs.existsSync(ssRoot)) {
  console.error('sheet_definitions/ or spritesheets/ missing in', lpcRoot);
  process.exit(2);
}

// ---- Palette swap setup -----------------------------------------------------
// LPC hair / body / cloth / metal sprites ship in ONE base color; other
// colors come from palette remapping (replace the 6 source-palette shades
// with the 6 target shades, pixel-by-pixel). We do this for hair + body
// so adventurers don't all share the same orange hair / light skin.

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function loadPalette(materialDir) {
  const ulpcFile = path.join(lpcRoot, 'palette_definitions', materialDir, `${materialDir}_ulpc.json`);
  const metaFile = path.join(lpcRoot, 'palette_definitions', materialDir, 'meta_' + materialDir + '.json');
  if (!fs.existsSync(ulpcFile)) return null;
  const palettes = JSON.parse(fs.readFileSync(ulpcFile, 'utf8'));
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
  const base = meta.base;
  if (!base || !palettes[base]) return null;
  return {
    base,
    baseRgb: palettes[base].map(hexToRgb),
    options: Object.fromEntries(Object.entries(palettes).map(([k, v]) => [k, v.map(hexToRgb)])),
  };
}

const HAIR_PALETTE = loadPalette('hair');
const BODY_PALETTE = loadPalette('body');
const CLOTH_PALETTE = loadPalette('cloth');
const METAL_PALETTE = loadPalette('metal');

function packRgb(rgb) { return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]; }
function basePacked(p) { return p ? new Map(p.baseRgb.map((c, i) => [packRgb(c), i])) : null; }
const HAIR_BASE_PACKED = basePacked(HAIR_PALETTE);
const BODY_BASE_PACKED = basePacked(BODY_PALETTE);
const CLOTH_BASE_PACKED = basePacked(CLOTH_PALETTE);
const METAL_BASE_PACKED = basePacked(METAL_PALETTE);

// Hair: all 26 palettes available — user wants the full pool (natural + fantasy).
const HAIR_ALL = HAIR_PALETTE ? Object.keys(HAIR_PALETTE.options) : [];
// Body: natural skin tones for adventurers; Twitch Streamer can pull fantasy.
const BODY_NATURAL = ['light', 'amber', 'olive', 'taupe', 'bronze', 'brown', 'black'];
const BODY_FANTASY = ['blue', 'bright_green', 'dark_green'];
// Cloth: 24 palettes — all valid as clothing colors.
const CLOTH_ALL = CLOTH_PALETTE ? Object.keys(CLOTH_PALETTE.options) : [];
// Metal: 8 finishes — all valid for armor/weapons.
const METAL_ALL = METAL_PALETTE ? Object.keys(METAL_PALETTE.options) : [];

// ---- Output layout ----------------------------------------------------------

const LAYOUT = {
  frame: 64,
  width: 832, // 13 frames × 64 (matches LPC universal)
  rows: [
    { anim: 'spellcast', file: 'spellcast.png', frames: 7,  dirRows: 4, y: 0 },
    { anim: 'thrust',    file: 'thrust.png',    frames: 8,  dirRows: 4, y: 256 },
    { anim: 'walk',      file: 'walk.png',      frames: 9,  dirRows: 4, y: 512 },
    { anim: 'slash',     file: 'slash.png',     frames: 6,  dirRows: 4, y: 768 },
    { anim: 'shoot',     file: 'shoot.png',     frames: 13, dirRows: 4, y: 1024 },
    { anim: 'hurt',      file: 'hurt.png',      frames: 6,  dirRows: 1, y: 1280 },
    { anim: 'idle',      file: 'idle.png',      frames: 2,  dirRows: 4, y: 1344 },
    { anim: 'run',       file: 'run.png',       frames: 8,  dirRows: 4, y: 1600 },
  ],
  height: 1856,
};

// ---- Index sheet_definitions by `name` --------------------------------------

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (f.name.endsWith('.json') && !f.name.startsWith('meta_')) out.push(p);
  }
  return out;
}

const byName = new Map();
const byCategory = {};
for (const f of walk(sdRoot)) {
  let def;
  try { def = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  const rel = path.relative(sdRoot, f).split(path.sep).join('/');
  const category = rel.split('/')[0];
  if (def.name) {
    byName.set(def.name, { def, file: rel, category });
    (byCategory[category] = byCategory[category] || []).push({ name: def.name, def, file: rel });
  }
}

// Hair pool helpers — LPC hair items are designed to layer (a "long" piece
// often wants bangs on top to look complete). Until we add multi-piece hair
// stacking, restrict the hair pool to self-contained hairstyle subdirs:
// short/, bald/, bob/, afro/, curly/, spiky/. Long/xlong/braids/pigtails
// are extension-style pieces that don't read well alone.
const SELF_CONTAINED_HAIR_DIRS = ['hair/short/', 'hair/bald/', 'hair/bob/', 'hair/afro/', 'hair/curly/', 'hair/spiky/'];
const HAIR_HEAD = []; // hairstyles
const HAIR_BEARDS = []; // beards/mustaches
for (const h of byCategory.hair || []) {
  if (h.file.startsWith('hair/beards/') || h.file.startsWith('hair/mustaches/')) HAIR_BEARDS.push(h);
  else if (SELF_CONTAINED_HAIR_DIRS.some((d) => h.file.startsWith(d))) HAIR_HEAD.push(h);
}

function reqAnimsCovered(item, full = true) {
  const anims = item.def.animations || [];
  const need = full
    ? ['walk', 'run', 'idle', 'slash', 'thrust', 'shoot', 'spellcast', 'hurt']
    : ['walk'];
  return need.every((a) => anims.includes(a));
}
const HAIR_HEAD_FULL = HAIR_HEAD.filter((h) => reqAnimsCovered(h));
const HAIR_BEARDS_FULL = HAIR_BEARDS.filter((h) => reqAnimsCovered(h));

// ---- RNG --------------------------------------------------------------------

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function chance(rng, p) { return rng() < p; }

// ---- Pool sampling ----------------------------------------------------------

function resolvePool(p) {
  if (!p) return null;
  if (Array.isArray(p)) return { items: p, chance: 1.0 };
  return p;
}

function pickFromPool(rng, pool) {
  const r = resolvePool(pool);
  if (!r) return null;
  if (!chance(rng, r.chance)) return null;
  return pick(rng, r.items);
}

function sampleVariant(rng, className, classPool) {
  const v = { className, layers: [] };
  v.bodyType = pick(rng, classPool.bodyTypes);
  // 'auto_human' = pick a head shape that matches the chosen body type
  const heads = classPool.heads === 'auto_human'
    ? COMMON.humanHeadsByBody[v.bodyType] || COMMON.humanHeadsByBody.male
    : classPool.heads;
  v.head = pick(rng, heads);
  // Hair: every adventurer can roll any of the 26 palettes (incl. fantasy).
  v.hairColor = pick(rng, HAIR_ALL);
  // Body: natural skin tones; Twitch Streamer occasionally rolls fantasy.
  const bodyOpts = className === 'twitch_streamer' && rng() < 0.15
    ? [...BODY_NATURAL, ...BODY_FANTASY] : BODY_NATURAL;
  v.bodyColor = pick(rng, bodyOpts);
  // Cloth color — per-class override allowed (e.g. necromancer = dark only).
  const clothPool = (classPool.clothColorPool && classPool.clothColorPool.length)
    ? classPool.clothColorPool
    : CLOTH_ALL;
  v.clothColor = pick(rng, clothPool);
  // Metal color (one shared finish for all metal pieces — armor, helm, pauldrons).
  v.metalColor = pick(rng, METAL_ALL);
  v.nose = pick(rng, COMMON.noses);
  v.eyebrows = pick(rng, COMMON.eyebrows);
  // Hair: always pick a hairstyle. If male and beard rolls, layer a beard.
  v.hair = classPool.hair === 'all_human_hair'
    ? pick(rng, HAIR_HEAD_FULL).name
    : pick(rng, classPool.hair);
  v.beard = (v.bodyType !== 'female' && chance(rng, classPool.beardChance ?? 0))
    ? pick(rng, HAIR_BEARDS_FULL).name
    : null;
  // Torso: most classes pull straight from `torso`. Monk/Barbarian add a
  // `shirtlessTorso` set that's only valid when the body is in `shirtlessFor`
  // (male/muscular) — keeps the bare-chested look gated to male variants.
  let torsoOptions = classPool.torso;
  if (
    Array.isArray(classPool.shirtlessTorso) &&
    Array.isArray(classPool.shirtlessFor) &&
    classPool.shirtlessFor.includes(v.bodyType)
  ) {
    torsoOptions = [...torsoOptions, ...classPool.shirtlessTorso];
  }
  v.torso = pickFromPool(rng, torsoOptions);
  v.legs = pickFromPool(rng, classPool.legs);
  v.feet = pickFromPool(rng, classPool.feet);
  v.arms = pickFromPool(rng, classPool.arms);
  v.headwear = pickFromPool(rng, classPool.headwear);

  // Accessory: support "pickCount" for chaos mode (multiple picks).
  v.accessories = [];
  if (classPool.accessory) {
    const r = resolvePool(classPool.accessory);
    if (chance(rng, r.chance)) {
      const n = r.pickCount
        ? Math.floor(rng() * (r.pickCount.max - r.pickCount.min + 1)) + r.pickCount.min
        : 1;
      const picked = new Set();
      for (let i = 0; i < n && picked.size < r.items.length; i++) {
        let attempts = 0;
        while (attempts++ < 8) {
          const cand = pick(rng, r.items);
          if (!picked.has(cand)) { picked.add(cand); break; }
        }
      }
      v.accessories = [...picked];
    }
  }

  // Weapon (skipped if barehanded)
  v.weapon = classPool.barehanded ? null : pickFromPool(rng, classPool.weapon);
  // Crystal pair: when staff is Diamond/Loop, force-add a crystal layer.
  v.crystal = null;
  if (v.weapon && CRYSTAL_RULE.staves.has(v.weapon)) {
    v.crystal = { color: pick(rng, CRYSTAL_RULE.colors) };
  }

  // Shield
  v.shield = null;
  const allShields = (byCategory.weapons || []).filter((w) =>
    w.file.startsWith('weapons/shields/') &&
    !/^(per_|revised_per_|saltire|revised_saltire|cross|revised_cross|chevron|revised_chevron|chief|revised_chief|fess|revised_fess|pale|revised_pale|paly|revised_paly|bend|revised_bend|bendy|revised_bendy|barry|revised_barry|bordure|revised_bordure|lozengy|revised_lozengy|pall|revised_pall|quarterly|revised_quarterly)/.test(path.basename(w.file, '.json'))
  );
  // Heater Shield Base/Trim/Paint cover the actual rendered shield. Pick the Base.
  const shieldBase = allShields.find((s) => s.name === 'Heater Shield Base');
  const shieldTrim = allShields.find((s) => s.name === 'Heater Shield Trim');
  if (classPool.alwaysShield && shieldBase) {
    v.shield = shieldBase.name;
  } else if (classPool.sometimesShield && chance(rng, classPool.sometimesShield) && shieldBase) {
    v.shield = shieldBase.name;
  }

  return v;
}

// ---- Layer resolution -------------------------------------------------------

function dirForBodyType(layer, bodyType) {
  // Each layer has per-bodyType paths. Fall back to male if not present.
  return layer[bodyType] || layer.male || layer.female || layer.muscular || null;
}

function pickColorVariant(rng, animSubdir) {
  // animSubdir is `<spritesheet root>/<layer-path>/<anim>` directory.
  // List PNGs and pick one at random; return file path.
  if (!fs.existsSync(animSubdir)) return null;
  const files = fs.readdirSync(animSubdir).filter((f) => f.endsWith('.png'));
  if (!files.length) return null;
  return path.join(animSubdir, pick(rng, files));
}

function resolveLayerSourceForAnim(rng, layerSourceDir, animFile, animName, lockedColor) {
  // Try `<dir>/<animFile>` first (single-color item).
  const direct = path.join(ssRoot, layerSourceDir, animFile);
  if (fs.existsSync(direct)) return direct;
  // Try `<dir>/<animName>/<color>.png` (color-variant item).
  const subdir = path.join(ssRoot, layerSourceDir, animName);
  if (fs.existsSync(subdir) && fs.statSync(subdir).isDirectory()) {
    if (lockedColor) {
      const locked = path.join(subdir, `${lockedColor}.png`);
      if (fs.existsSync(locked)) return locked;
    }
    return pickColorVariant(rng, subdir);
  }
  return null;
}

function buildLayerManifest(variant) {
  // Returns sorted array of { sourceDir, zPos, lockedColor?, palette?, def, ... }.
  const layers = [];
  const add = (itemName, opts = {}) => {
    if (!itemName) return;
    const item = byName.get(itemName);
    if (!item) {
      console.warn(`  ! item "${itemName}" not found`);
      return;
    }
    // Determine recolor mode. LPC items declare a "material" (hair / body /
    // cloth / metal / eye). Heads use color_1 (skin = body) + color_2 (eye).
    const r = item.def?.recolors;
    const matDirect = r?.material;
    const matColor1 = r?.color_1?.material;
    const palettes = [];
    const wantHair  = (m) => m === 'hair'  && HAIR_PALETTE  && variant.hairColor  && variant.hairColor  !== HAIR_PALETTE.base;
    const wantBody  = (m) => m === 'body'  && BODY_PALETTE  && variant.bodyColor  && variant.bodyColor  !== BODY_PALETTE.base;
    const wantCloth = (m) => m === 'cloth' && CLOTH_PALETTE && variant.clothColor && variant.clothColor !== CLOTH_PALETTE.base;
    const wantMetal = (m) => m === 'metal' && METAL_PALETTE && variant.metalColor && variant.metalColor !== METAL_PALETTE.base;
    if (wantHair(matDirect)  || wantHair(matColor1))  palettes.push({ base: HAIR_BASE_PACKED,  target: HAIR_PALETTE.options[variant.hairColor]   });
    if (wantBody(matDirect)  || wantBody(matColor1))  palettes.push({ base: BODY_BASE_PACKED,  target: BODY_PALETTE.options[variant.bodyColor]   });
    if (wantCloth(matDirect) || wantCloth(matColor1)) palettes.push({ base: CLOTH_BASE_PACKED, target: CLOTH_PALETTE.options[variant.clothColor] });
    if (wantMetal(matDirect) || wantMetal(matColor1)) palettes.push({ base: METAL_BASE_PACKED, target: METAL_PALETTE.options[variant.metalColor] });

    let li = 1;
    while (item.def[`layer_${li}`]) {
      const layer = item.def[`layer_${li}`];
      // Skip oversized custom_animation layers (we're 64x64-only).
      if (layer.custom_animation) { li++; continue; }
      const srcDir = dirForBodyType(layer, variant.bodyType);
      if (srcDir) {
        layers.push({
          sourceDir: srcDir.replace(/\/$/, ''),
          zPos: layer.zPos ?? 0,
          lockedColor: opts.lockedColor || null,
          palettes,
          def: item.def,
          itemName,
          credits: item.def.credits || [],
        });
      }
      li++;
    }
  };

  // Order matches z-position; we sort numerically afterwards. Add everything.
  add('Body Color');
  add(variant.head);
  add(variant.nose);
  add(variant.eyebrows);
  add(variant.hair);
  add(variant.beard);
  add(variant.torso);
  add(variant.legs);
  add(variant.feet);
  add(variant.arms);
  add(variant.headwear);
  for (const a of variant.accessories) add(a);
  if (variant.weapon) add(variant.weapon);
  if (variant.crystal) add('Crystal', { lockedColor: variant.crystal.color });
  if (variant.shield) {
    add('Heater Shield Base');
    add('Heater Shield Trim');
  }

  layers.sort((a, b) => a.zPos - b.zPos);
  return layers;
}

// ---- Compositing ------------------------------------------------------------

async function applyPaletteSwap(srcPath, palettes) {
  // Read raw RGBA, remap pixels matching any base palette, return raw buffer.
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const buf = Buffer.from(data); // copy so we don't mutate cached buffer
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] === 0) continue;
    const key = (buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2];
    for (const p of palettes) {
      const idx = p.base.get(key);
      if (idx !== undefined) {
        buf[i] = p.target[idx][0];
        buf[i + 1] = p.target[idx][1];
        buf[i + 2] = p.target[idx][2];
        break;
      }
    }
  }
  return { buffer: buf, width: info.width, height: info.height };
}

async function compositeVariant(rng, variant, outFile) {
  const layers = buildLayerManifest(variant);

  // For each layer, for each animation row, prepare a composite descriptor.
  // If the layer has palette swaps, run them on the source PNG first.
  const composites = [];
  for (const layer of layers) {
    for (const row of LAYOUT.rows) {
      const src = resolveLayerSourceForAnim(rng, layer.sourceDir, row.file, row.anim, layer.lockedColor);
      if (!src) continue;
      if (layer.palettes && layer.palettes.length) {
        const remapped = await applyPaletteSwap(src, layer.palettes);
        composites.push({
          input: remapped.buffer,
          raw: { width: remapped.width, height: remapped.height, channels: 4 },
          top: row.y, left: 0,
        });
      } else {
        composites.push({ input: src, top: row.y, left: 0 });
      }
    }
  }

  await sharp({
    create: { width: LAYOUT.width, height: LAYOUT.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outFile);

  return { layers, composites: composites.length };
}

// ---- Bake -------------------------------------------------------------------

const allCredits = new Map(); // contributor → Set of files
const manifest = { variants: {}, layout: LAYOUT };

async function bakeClass(className) {
  const classPool = POOLS[className];
  if (!classPool) { console.warn(`unknown class ${className}, skipping`); return; }

  const outDir = path.join(outRoot, className);
  fs.mkdirSync(outDir, { recursive: true });

  const seen = new Set();
  const variants = [];
  const baseSeed = stringHash(className);
  let attempts = 0;
  for (let i = 0; i < variantCount && attempts < variantCount * 4; ) {
    const seed = baseSeed + attempts * 1000003 + i;
    const rng = makeRng(seed);
    const v = sampleVariant(rng, className, classPool);
    const sig = JSON.stringify(v);
    attempts++;
    if (seen.has(sig)) continue;
    seen.add(sig);

    const id = `v${String(i + 1).padStart(2, '0')}`;
    const outFile = path.join(outDir, `${id}.png`);
    const t0 = Date.now();
    const meta = await compositeVariant(rng, v, outFile);
    const ms = Date.now() - t0;

    // Roll up credits
    for (const layer of meta.layers) {
      for (const c of layer.credits) {
        for (const author of c.authors || []) {
          if (!allCredits.has(author)) allCredits.set(author, new Set());
          allCredits.get(author).add(c.file || layer.itemName);
        }
      }
    }

    variants.push({
      id,
      bodyType: v.bodyType,
      bodyColor: v.bodyColor,
      hairColor: v.hairColor,
      clothColor: v.clothColor,
      metalColor: v.metalColor,
      head: v.head,
      hair: v.hair,
      beard: v.beard,
      torso: v.torso,
      legs: v.legs,
      feet: v.feet,
      arms: v.arms,
      headwear: v.headwear,
      accessories: v.accessories,
      weapon: v.weapon,
      crystal: v.crystal,
      shield: v.shield,
    });
    console.log(`  ${className}/${id}.png — ${meta.layers.length} layers, ${meta.composites} comps, ${ms}ms`);
    i++;
  }

  manifest.variants[className] = variants;
}

function stringHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

async function main() {
  const classes = classFilter.length ? classFilter : Object.keys(POOLS);
  fs.mkdirSync(outRoot, { recursive: true });

  console.log(`Baking ${variantCount} variant(s) for ${classes.length} class(es) → ${outRoot}\n`);
  const t0 = Date.now();
  for (const c of classes) {
    console.log(`▶ ${c}`);
    await bakeClass(c);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${dt}s.`);

  // Write manifest + layout sidecar
  fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outRoot, 'layout.json'), JSON.stringify(LAYOUT, null, 2));

  // Write CREDITS.md
  const creditLines = ['# LPC Sprite Credits', '',
    'Adventurer spritesheets in this folder are baked from the Liberated Pixel Cup',
    '(LPC) asset set via `tools/bake-lpc-variants.mjs`. Every contributor whose layer',
    'appears in any variant is credited below. Source assets are licensed under',
    'CC-BY-SA 3.0, GPL 3.0, and/or OGA-BY 3.0.',
    '',
    '## Contributors',
    '',
  ];
  for (const [author, files] of [...allCredits].sort((a, b) => a[0].localeCompare(b[0]))) {
    creditLines.push(`- **${author}** — ${files.size} layer source(s)`);
  }
  fs.writeFileSync(path.join(outRoot, 'CREDITS.md'), creditLines.join('\n') + '\n');

  console.log(`Wrote manifest, layout, and CREDITS.md to ${outRoot}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });

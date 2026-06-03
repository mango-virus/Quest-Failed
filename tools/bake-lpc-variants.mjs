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
import { POOLS, COMMON, CRYSTAL_RULE, VARIANT_COUNT, HELMET_SAFE_HAIR_SHORT, HELMET_SAFE_HAIR_LONG } from './lpc-pools.mjs';

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

// Extra "LPC Revised" metal finishes — icy / holy tones for the Templar's
// blessed plate. Each is a 6-shade ramp that remaps the SAME metal "steel"
// base (meta_metal.base) by index, so they slot straight into the metal
// palette's options alongside the ulpc finishes (the swap is index-based).
// Sourced from the LPC-Revised METAL palette (revised silver/gold) + the
// LPC-Revised "all" palette (white / pearl / lavender / ice). Keyed under
// distinct names so they don't collide with the ulpc silver/gold.
(function mergeRevisedMetals() {
  if (!METAL_PALETTE) return;
  const n = METAL_PALETTE.baseRgb.length;
  const read = (rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(lpcRoot, 'palette_definitions', ...rel), 'utf8')); }
    catch (e) { return null; }
  };
  const metalLpcr = read(['metal', 'metal_lpcr.json']) || {};
  const allLpcr   = read(['all', 'all_lpcr.json']) || {};
  const put = (key, ramp) => {
    if (Array.isArray(ramp) && ramp.length === n) METAL_PALETTE.options[key] = ramp.map(hexToRgb);
    else console.warn(`  ! revised-metal "${key}" skipped (ramp len ${ramp?.length} ≠ ${n})`);
  };
  put('rev_silver', metalLpcr.silver);
  put('rev_gold',   metalLpcr.gold);
  put('white',      allLpcr.white);
  put('pearl',      allLpcr.pearl);
  put('lavender',   allLpcr.lavender);
  put('ice',        allLpcr.ice);
})();

// Hair: all 26 palettes available — user wants the full pool (natural + fantasy).
const HAIR_ALL = HAIR_PALETTE ? Object.keys(HAIR_PALETTE.options) : [];
// Body: natural skin tones for adventurers; Twitch Streamer can pull fantasy.
const BODY_NATURAL = ['light', 'amber', 'olive', 'taupe', 'bronze', 'brown', 'black'];
const BODY_FANTASY = ['blue', 'bright_green', 'dark_green'];
// Cloth: 24 palettes — all valid as clothing colors.
const CLOTH_ALL = CLOTH_PALETTE ? Object.keys(CLOTH_PALETTE.options) : [];
// Metal: 8 finishes — all valid for armor/weapons.
const METAL_ALL = METAL_PALETTE ? Object.keys(METAL_PALETTE.options) : [];

// Shield colour vocabularies (used by the shield picker in sampleVariant).
// Round Shield ships fixed colour-variant PNGs (brown/black/gold/green/silver/
// yellow). The Heater Shield Paint face uses its own large palette — only the
// names that ALSO exist as cloth/tabard colours can match a class's house
// colour, so SHIELD_PAINT_COLORS gates the heraldic-paint step to those.
const ROUND_SHIELD_COLORS = ['silver', 'gold', 'black', 'green', 'brown'];
// Kite shield ships pre-painted two-tone variants (face + border). These earthy/
// martial combos suit a Roman arena look. (Scutum + Spartan are single-design,
// so they need no colour vocab.)
const KITE_SHIELD_COLORS = ['kite red gray', 'kite orange', 'kite gray orange', 'kite gray'];
const SHIELD_PAINT_COLORS = new Set([
  'red', 'blue', 'navy', 'purple', 'forest', 'green', 'white', 'teal',
  'sky', 'orange', 'black', 'gray', 'pink', 'lavender', 'yellow',
]);

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

// Hair pool helpers. Self-contained hairstyle subdirs (each reads fine alone):
// short/, bald/, bob/, afro/, curly/, spiky/ PLUS long/, braids/, pigtails/,
// xlong/ — the latter four are full standalone styles (Long, Braid, Ponytail,
// Pigtails, Princess, Xlong …), NOT half-pieces. Only `extensions/` stays out
// (those are left/right HALF strands meant to layer on another base).
const SELF_CONTAINED_HAIR_DIRS = [
  'hair/short/', 'hair/bald/', 'hair/bob/', 'hair/afro/', 'hair/curly/', 'hair/spiky/',
  'hair/long/', 'hair/braids/', 'hair/pigtails/', 'hair/xlong/',
];
const HAIR_HEAD = []; // hairstyles
const HAIR_BEARDS = []; // beards/mustaches
for (const h of byCategory.hair || []) {
  if (h.file.startsWith('hair/beards/') || h.file.startsWith('hair/mustaches/')) HAIR_BEARDS.push(h);
  else if (SELF_CONTAINED_HAIR_DIRS.some((d) => h.file.startsWith(d))) HAIR_HEAD.push(h);
}

// Filter by DISK TRUTH, not the `animations` metadata array (which is blank /
// stale for many items — the project's core gotcha). A hairstyle is usable if
// its source dir ships art for every combat anim that does NOT fall back —
// walk/slash/thrust/shoot/spellcast/hurt (run + idle auto-fall-back to walk via
// GENERAL_ANIM_FALLBACK, so they're not required). This admits ~all 107 of the
// pack's complete styles and rejects only the genuinely broken ones (Child
// Wavy, Messy), instead of whatever the metadata happened to list.
const COMBAT_REQUIRED = ['walk', 'slash', 'thrust', 'shoot', 'spellcast', 'hurt'];
function combatAnimsOnDisk(item) {
  const L = item.def.layer_1;
  const src = L && (L.male || L.female || L.muscular);
  if (!src) return false;
  const base = path.join(ssRoot, src.replace(/\/$/, ''));
  return COMBAT_REQUIRED.every((a) => {
    if (fs.existsSync(path.join(base, `${a}.png`))) return true;
    const sub = path.join(base, a);
    return fs.existsSync(sub) && fs.statSync(sub).isDirectory() && fs.readdirSync(sub).some((x) => x.endsWith('.png'));
  });
}
// User-vetoed hairstyles — never used by ANY class (filtered out of the
// 'all_human_hair' pool; explicit array hair pools are not filtered). Pigtails /
// Long tied / Long band declare a `color_2` "hair tie" drawn in CYAN shades that
// the baker only recolours for color_1 (the hair) — so they render a stray teal
// ribbon. Excluded globally since that defect is intrinsic to those 3 styles.
const HAIR_EXCLUDE = new Set(['Afro', 'Pigtails', 'Long tied', 'Long band']);
const HAIR_HEAD_FULL = HAIR_HEAD.filter(combatAnimsOnDisk).filter((h) => !HAIR_EXCLUDE.has(h.name));
const HAIR_BEARDS_FULL = HAIR_BEARDS.filter(combatAnimsOnDisk);

// Headwear that WRAPS the head (vs a circlet/hat that sits on top) — voluminous
// or textured hair (afros, twists, dreads, spikes, topknots, buns, ponytails,
// xlong) pokes raggedly through these. When one is rolled, hair is swapped for
// a flat "covering-safe" style. Circlets/tiaras/crowns/hats are NOT here (hair
// shows cleanly under them). COVERING_SAFE = the curated flat short + flat long
// sets (same lists the always-helmeted Knight/Rogue draw from).
const HAIR_COVERINGS = new Set([
  'Hood', 'Sack Cloth Hood', 'Hijab', 'Bandana', 'Bordered Bandana', 'Pirate Bandana',
]);
const COVERING_SAFE_HAIR = new Set([...HELMET_SAFE_HAIR_SHORT, ...HELMET_SAFE_HAIR_LONG]);
const COVERING_SAFE_HAIR_LIST = [...COVERING_SAFE_HAIR];
// Bows get a nocked Arrow ("Ammo") layer that only composites during shoot
// (zPos 150, over the drawn bow) — the visible projectile mid-attack.
const BOW_WEAPONS = new Set(['Normal', 'Great', 'Recurve']);
// Multi-head tools that must lock to one variant (the "Smash" tool ships
// axe/hammer/pickaxe heads; we use only the axe — a two-handed great-axe).
// Glowsword ships only blue/red variants and has no carried-colour concept,
// so without a lock it re-rolls blue↔red every animation row (flicker) — pin
// it to a single blue blade everywhere it's used (cheater + streamer).
const WEAPON_VARIANT_LOCK = { Smash: 'axe', Glowsword: 'blue' };
// Hair that sticks UP (spikes, mohawks, crown-topknots, high buns/ponytails).
// Long/curly/flat hair flows fine UNDER a hat that sits on the crown, but these
// poke through or around it — so they're only used on BARE heads.
const HAIR_TALL = new Set([
  'Spiked', 'Spiked2', 'Spiked beehive', 'Spiked liberty', 'Spiked liberty2',
  'Spiked porcupine', 'Halfmessy', 'Longhawk', 'Shorthawk', 'Cowlick tall',
  'Long Topknot', 'Long Topknot 2', 'Short Topknot', 'Short Topknot 2',
  'High Bun', 'Bangs bun', 'High ponytail',
]);

// ---- RNG --------------------------------------------------------------------

function makeRng(seed) {
  // Scramble the seed (murmur3-style finalizer) BEFORE the LCG. A raw LCG seeded
  // with near-sequential values (variant i, i+1, …) produces correlated early
  // outputs, so a given pick (e.g. hairColor) only spanned part of its range —
  // the beast master's ear/tail colours were stuck to ~15 of 26 hair palettes.
  // The scramble decorrelates sequential seeds so picks span their full range.
  let s = seed >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  s = (s ^ (s >>> 16)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function chance(rng, p) { return rng() < p; }
// Build an EVENLY distributed "bag" of `count` picks from `pool` (each option
// repeated ⌊count/n⌋ or ⌈count/n⌉ times, remainder spread across the first few),
// then Fisher–Yates shuffle it with the seeded rng so the even counts aren't
// clustered. Used by `metalColorEven` so an armour metal can't dominate the way a
// uniform per-variant random pick does. Dedup of unique options keeps it stable
// if a pool lists the same value twice.
function buildEvenBag(pool, count, rng) {
  const opts = [...new Set(pool)];
  const bag = [];
  for (let i = 0; i < count; i++) bag.push(opts[i % opts.length]);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}
// Weighted key pick from a { key: weight } map (e.g. body-type bias). Weights
// need not sum to 1; zero/negative weights are dropped.
function weightedPick(rng, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (!entries.length) return null;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) { if ((r -= w) < 0) return k; }
  return entries[entries.length - 1][0];
}

// Resolve an item-pool name to its sheet_definition. Supports a
// category-qualified form ("legs:Armour") so pools can disambiguate items
// that share a `name` across categories — the plate "Armour" piece exists
// separately under arms/, legs/ AND feet/, and a bare byName lookup would
// silently keep whichever was indexed last. Plain names use the global index.
function resolveItem(itemName) {
  if (typeof itemName === 'string' && itemName.includes(':')) {
    const idx = itemName.indexOf(':');
    const cat = itemName.slice(0, idx);
    const nm = itemName.slice(idx + 1);
    const hit = (byCategory[cat] || []).find((x) => x.name === nm);
    return hit ? { def: hit.def, file: hit.file, category: cat } : null;
  }
  return byName.get(itemName) || null;
}

// ---- Pool sampling ----------------------------------------------------------

// Per-body-type pool gating. A slot pool may be given as a body map
// { male, female, muscular } (each value a list or { items, chance }) so a
// class can hand a different item set to each build — e.g. muscular knights
// get full plate vambraces (the only arm piece that covers their forearm)
// while male/female roll a varied set. Falls back male→female→muscular. A
// plain list / { items, chance } passes through unchanged (shared by all).
function resolveBodyPool(pool, bodyType) {
  if (pool && !Array.isArray(pool) && typeof pool === 'object'
      && !('items' in pool)
      && (pool.male || pool.female || pool.muscular)) {
    return pool[bodyType] || pool.male || pool.female || pool.muscular || null;
  }
  return pool;
}

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

function sampleVariant(rng, className, classPool, forced = {}) {
  const v = { className, layers: [] };
  // ── Mode split (e.g. cheater 50% chaos / 50% hacker) ─────────────────────
  // A class may define `modes: [{ name, weight, ...slotOverrides }]`. We pick
  // one weighted mode and MERGE its slot overrides over the base pool, so the
  // rest of the sampler stays mode-agnostic. v.mode is recorded for the
  // manifest. Shared slots (heads/hair/etc.) stay on the base; any field the
  // mode defines (torso/headwear/accessory/weapon/bodyColorPool/…) wins.
  if (Array.isArray(classPool.modes) && classPool.modes.length) {
    const total = classPool.modes.reduce((s, m) => s + (m.weight ?? 1), 0);
    // Always consume the weighted-pick draw so the rest of the stream is stable,
    // but when an EVEN mode split is requested (modesEven) the per-slot bag mode
    // (forced.mode, assigned in renderClass) wins. This pins the split to the
    // exact weighted proportion (e.g. a true 50/50 bare/armored) instead of a
    // probabilistic one the dedup retry can skew (bare has fewer distinguishing
    // layers, so it collides + gets rejected more, dragging the live share down).
    let r = rng() * total, chosen = classPool.modes[classPool.modes.length - 1];
    for (const m of classPool.modes) { r -= (m.weight ?? 1); if (r < 0) { chosen = m; break; } }
    if (forced.mode) chosen = classPool.modes.find((m) => m.name === forced.mode) || chosen;
    classPool = { ...classPool, ...chosen };
    v.mode = chosen.name || null;
  }
  // Body type — optionally biased per class (bodyTypeWeights) so a class can
  // lean toward the build that carries its signature silhouette (e.g. knights
  // skew male/muscular) while still rolling the others sometimes.
  v.bodyType = classPool.bodyTypeWeights
    ? weightedPick(rng, classPool.bodyTypeWeights)
    : pick(rng, classPool.bodyTypes);
  // Heads resolution supports three forms:
  //   'auto_human'  → pick a Human Male/Female head matched to the body
  //   array         → flat list, all body types share the same options
  //   object        → bodyType → head[] lookup (e.g. cosplay_adventurer's
  //                   monster heads where Lizard male / female / Skeleton /
  //                   Zombie need to pair with the matching body shape)
  let heads;
  if (classPool.heads === 'auto_human') {
    heads = COMMON.humanHeadsByBody[v.bodyType] || COMMON.humanHeadsByBody.male;
  } else if (Array.isArray(classPool.heads)) {
    heads = classPool.heads;
  } else if (classPool.heads && typeof classPool.heads === 'object') {
    heads = classPool.heads[v.bodyType] || classPool.heads.male || [];
  } else {
    heads = [];
  }
  v.head = pick(rng, heads);
  // ── Coordinated COSTUME sets (cosplay_adventurer) ────────────────────────
  // Each entry is a creature costume: a monster HEAD + the matching feature
  // pieces (wings / tail / horns) so a build reads as one intentional costume
  // — a green dragon (lizard head + green lizard wings + tail), a werewolf
  // (wolf head + fur tail), a vampire (bat wings), etc. The set OVERRIDES the
  // flat head pick above and fills v.costume with already-colour-resolved
  // pieces. `color` is the creature's shared hue applied to wings+tail so they
  // match; `hornColor` overrides for the horns when present.
  v.costume = null;
  if (Array.isArray(classPool.costumeSets) && classPool.costumeSets.length) {
    const set = pick(rng, classPool.costumeSets);
    // Heads accept a flat list OR a { male, female, muscular } body-map (so a
    // dragon picks 'Lizard male' on male/muscular bodies, 'Lizard female' on a
    // female body — the gendered monster heads only ship the matching shape).
    const hp = set.heads ? resolveBodyPool(set.heads, v.bodyType) : null;
    const hl = Array.isArray(hp) ? hp : (hp?.items || []);
    if (hl.length) v.head = pick(rng, hl);
    const col = (set.color && set.color.length) ? pick(rng, set.color) : null;
    const pieces = [];
    if (set.wings && set.wings.length) pieces.push({ item: pick(rng, set.wings), color: col });
    if (set.tail && set.tail.length)   pieces.push({ item: pick(rng, set.tail),  color: col });
    if (set.horns && set.horns.length) pieces.push({ item: pick(rng, set.horns), color: (set.hornColor && set.hornColor.length) ? pick(rng, set.hornColor) : col });
    v.costume = { setName: set.name || null, pieces };
  }
  // Hair: every adventurer can roll any of the 26 palettes (incl. fantasy),
  // unless the class locks it via hairColorPool (named characters do — e.g.
  // shadow_monarch = always black).
  v.hairColor = pick(rng, (classPool.hairColorPool?.length) ? classPool.hairColorPool : HAIR_ALL);
  // Body: natural skin tones for most classes. Twitch Streamer occasionally
  // rolls a fantasy palette (15%); Cheater leans into desync harder (30%)
  // so the modded-client silhouette can include obviously-not-human skin
  // (blue, bright green, dark green) without crowding the rest of the
  // adventurer roster.
  const fantasyChance = className === 'cheater' ? 0.30
                       : className === 'twitch_streamer' ? 0.15
                       : 0;
  const bodyOpts = fantasyChance > 0 && rng() < fantasyChance
    ? [...BODY_NATURAL, ...BODY_FANTASY] : BODY_NATURAL;
  // Body color — per-class override allowed (named characters lock their skin tone).
  v.bodyColor = pick(rng, (classPool.bodyColorPool?.length) ? classPool.bodyColorPool : bodyOpts);
  // Cloth color — per-class override allowed (e.g. necromancer = dark only).
  const clothPool = (classPool.clothColorPool && classPool.clothColorPool.length)
    ? classPool.clothColorPool
    : CLOTH_ALL;
  v.clothColor = pick(rng, clothPool);
  // Optional per-class FEET color override (e.g. shadow_monarch wants black
  // shoes; the bard wants NORMAL shoe colours, not its vibrant outfit colour).
  // Array → pick one; else fixed/null. Falls back to clothColor.
  v.feetColor = Array.isArray(classPool.feetColor)
    ? pick(rng, classPool.feetColor)
    : (classPool.feetColor ?? null);
  // Metal color (one shared finish for all metal pieces) — per-class override allowed.
  // Always consume the RNG draw so the rest of the stream is unaffected, but when
  // the class opts into an EVEN spread (metalColorEven) the per-slot bag colour
  // (forced.metalColor, assigned round-robin + shuffled in renderClass) wins, so
  // no single metal dominates over the 100 variants.
  const rolledMetal = pick(rng, (classPool.metalColorPool?.length) ? classPool.metalColorPool : METAL_ALL);
  v.metalColor = forced.metalColor || rolledMetal;
  // ── Two-tone layered outfit (e.g. mage kimono) ───────────────────────────
  // When a class defines `outfit`, roll a MAIN colour and a distinct ACCENT
  // colour, then compose the chosen base dress + ONE sleeve style (+ optional
  // bodice) into v.outfitLayers as { item, color } (colour already resolved).
  // The MAIN colour also becomes v.clothColor so palette-swap pieces (legs/
  // feet) follow it; the outfit OWNS the torso + arms slots (skipped below).
  // 'main'/'accent' tokens in the layer specs resolve to the two rolled colours
  // — the deliberate two-tone the design calls for (trim/bodice/sash = accent).
  v.outfitLayers = null;
  v.outfitMainColor = null;
  v.outfitAccentColor = null;
  // `outfit.chance` (optional) gates the outfit per-variant — a class can give
  // only SOME variants the layered outfit (e.g. necromancer ~40% kimono, the
  // rest a plain robe). Unset = always (mage). `chance==null` short-circuits so
  // no rng is consumed for classes that always use the outfit (keeps the mage
  // deterministic). Separate main/accent colour pools let the two tones draw
  // from different sets (e.g. necro main = 5 darks, accent = darks + occasional
  // colour); both fall back to clothColorPool.
  if (classPool.outfit && (classPool.outfit.chance == null || chance(rng, classPool.outfit.chance))) {
    const o = classPool.outfit;
    const mpal = (o.mainColors?.length) ? o.mainColors
               : (classPool.clothColorPool?.length) ? classPool.clothColorPool : CLOTH_ALL;
    const apal = (o.accentColors?.length) ? o.accentColors : mpal;
    const main = pick(rng, mpal);
    let accent = pick(rng, apal);
    let guard = 0;
    while (accent === main && guard++ < 16) accent = pick(rng, apal);
    v.outfitMainColor = main;
    v.outfitAccentColor = accent;
    v.clothColor = main; // palette-swap pieces (legs/feet) follow the main colour
    const resolveCol = (c) => (c === 'accent' ? accent : c === 'main' ? main : c);
    const out = [];
    const base = pick(rng, o.bases);
    for (const [item, col] of base.layers) out.push({ item, color: resolveCol(col) });
    if (o.sleeves) {
      const sleeves = pick(rng, o.sleeves);
      for (const [item, col] of sleeves.layers) out.push({ item, color: resolveCol(col) });
    }
    if (o.bodice && (base.forceBodice || chance(rng, o.bodice.chance))) {
      out.push({ item: o.bodice.item, color: resolveCol(o.bodice.color) });
    }
    v.outfitLayers = out;
  }
  // Nose / eyebrows render at zPos 105 / 106 — ON TOP of the head
  // sprite (zPos 100). For non-human heads (cosplay_adventurer's
  // monster heads) the head art has its own facial features built in,
  // so painting human eyebrows + a nose on top breaks the illusion.
  // Pool can opt out by setting `noses: null` / `eyebrows: null`.
  v.nose     = classPool.noses     === null ? null : pick(rng, COMMON.noses);
  v.eyebrows = classPool.eyebrows  === null ? null : pick(rng, COMMON.eyebrows);
  // Hair: pick a hairstyle, or skip entirely when classPool.hair is null
  // (e.g. cosplay_adventurer wears monster heads — hair zPos 120 would
  // render flowing locks on top of a wolf face). Beard follows the same
  // null-skip rule below.
  // `baldChance` — probability of a fully shaved/bald head (no hair layer), e.g.
  // monks. Rolled first; a bald head can still have a beard (classic old monk).
  if (classPool.baldChance && chance(rng, classPool.baldChance)) {
    v.hair = null;
  } else if (classPool.hair === null) {
    v.hair = null;
  } else if (classPool.hair === 'all_human_hair') {
    v.hair = pick(rng, HAIR_HEAD_FULL).name;
  } else if (Array.isArray(classPool.hair)) {
    v.hair = pick(rng, classPool.hair);
  } else if (classPool.hair && typeof classPool.hair === 'object') {
    // Per-body-type hair list — lets a class give one build extra styles
    // (e.g. female knights also roll long back/shoulder hair that hangs
    // below the helmet rim). Falls back male→female→muscular.
    const list = classPool.hair[v.bodyType]
      || classPool.hair.male || classPool.hair.female || classPool.hair.muscular || [];
    v.hair = list.length ? pick(rng, list) : null;
  } else {
    v.hair = pick(rng, classPool.hair);
  }
  v.beard = (v.bodyType !== 'female' && chance(rng, classPool.beardChance ?? 0))
    ? pick(rng, HAIR_BEARDS_FULL).name
    : null;
  // Beast-kin: a PAIRED animal-ears + matching tail (e.g. wolf/cat), coloured to
  // the hair so the fur matches. When present, headwear is skipped below (a hat/
  // hood would cover the ears). `beastKin: { chance, types: [{ears, tail}] }`.
  v.beast = null;
  if (classPool.beastKin && chance(rng, classPool.beastKin.chance)) {
    v.beast = pick(rng, classPool.beastKin.types);
  }
  // Torso: most classes pull straight from `torso`. Monk/Barbarian add a
  // `shirtlessTorso` set that's only valid when the body is in `shirtlessFor`
  // (male/muscular) — keeps the bare-chested look gated to male variants.
  let torsoOptions = resolveBodyPool(classPool.torso, v.bodyType);
  if (
    Array.isArray(classPool.shirtlessTorso) &&
    Array.isArray(classPool.shirtlessFor) &&
    classPool.shirtlessFor.includes(v.bodyType)
  ) {
    torsoOptions = [...torsoOptions, ...classPool.shirtlessTorso];
  }
  // When this variant actually got an outfit, it OWNS torso + arms (skip them).
  // Keyed on v.outfitLayers (not classPool.outfit) so the non-outfit variants of
  // a partial-outfit class (e.g. necromancer's reaper-robe 60%) still pick a torso.
  v.torso = v.outfitLayers ? null : pickFromPool(rng, torsoOptions);
  // Optional second torso layer composited at its OWN zPos — e.g. a Tabard
  // surcoat (zPos 55) under a Plate breastplate (zPos 60), so the coloured
  // skirt/shoulders show below the armour. Colour-locked to the cloth (house)
  // colour like the other wearables.
  v.torsoOverlay = pickFromPool(rng, resolveBodyPool(classPool.torsoOverlay, v.bodyType));
  // Overlay colour: a single name, an array (pick one — e.g. varied leather
  // belt tones), or null (falls back to the cloth colour).
  v.torsoOverlayColor = Array.isArray(classPool.torsoOverlayColor)
    ? pick(rng, classPool.torsoOverlayColor)
    : (classPool.torsoOverlayColor ?? null);
  // Resolve the outfit colour tokens (e.g. mage obi sash = 'accent').
  if (v.torsoOverlayColor === 'accent') v.torsoOverlayColor = v.outfitAccentColor;
  else if (v.torsoOverlayColor === 'main') v.torsoOverlayColor = v.outfitMainColor;
  // Legs: an outfit variant with `underLegs` uses those (e.g. leggings UNDER a
  // kimono, hidden by a full one / filling a split one) instead of the class
  // legs pool (which for some classes is a robe-skirt that would clash with the
  // dress). Non-outfit variants use the class legs pool as usual.
  v.legs = (v.outfitLayers && classPool.outfit?.underLegs)
    ? pick(rng, classPool.outfit.underLegs)
    : pickFromPool(rng, resolveBodyPool(classPool.legs, v.bodyType));
  // Optional separate legs/pants colour (e.g. bard's pants are a normal neutral
  // colour, NOT the vibrant torso colour). Array → pick one; else fixed/null.
  // When it's an array with options other than the shirt colour, GUARANTEE the
  // pants don't match the shirt (re-pick a few times) — the legsColor pool can
  // overlap the cloth pool, and "pants must differ from shirt" was an explicit
  // ask (cheater). A single-colour legsColor or a pool of only the shirt colour
  // is left as-is.
  if (Array.isArray(classPool.legsColor)) {
    v.legsColor = pick(rng, classPool.legsColor);
    if (classPool.legsColor.some((c) => c !== v.clothColor)) {
      let tries = 0;
      while (v.legsColor === v.clothColor && tries++ < 8) v.legsColor = pick(rng, classPool.legsColor);
    }
  } else {
    v.legsColor = classPool.legsColor ?? null;
  }
  v.feet = pickFromPool(rng, resolveBodyPool(classPool.feet, v.bodyType));
  v.arms = v.outfitLayers ? null : pickFromPool(rng, resolveBodyPool(classPool.arms, v.bodyType));
  // Optional separate arms colour (e.g. a fur shoulder-pelt Mantal in a natural
  // fur tone, distinct from the outfit). Affects cloth-material arm pieces;
  // metal pieces (bracers/pauldrons) still follow metalColor. Falls back to cloth.
  v.armsColor = Array.isArray(classPool.armsColor)
    ? pick(rng, classPool.armsColor)
    : (classPool.armsColor ?? null);
  // Optional SHOULDER overlay (zPos 60-75) layered ON TOP of the arm piece —
  // e.g. a Templar wearing full plate arms (arms:Armour) + a pauldron/spaulder
  // or segmented Legion shoulder over it. Metal pieces follow metalColor; cloth
  // ones the cloth colour. Separate from `arms` so both can be worn.
  v.shoulder = pickFromPool(rng, resolveBodyPool(classPool.shoulder, v.bodyType));
  // Optional HANDS layer (zPos 70) — metal gauntlets / cloth gloves over the
  // hands+forearm, so a fully-plated class has no bare hands. Metal → metalColor.
  v.hands = pickFromPool(rng, resolveBodyPool(classPool.hands, v.bodyType));
  // Cape — an optional layer with its own zPos (behind body + draped over).
  // Colour-locked to the cape colour (single/array/'accent'/'main' token) or
  // the cloth colour. The cape def carries BOTH its behind + front layers, so a
  // single add() composites the whole cloak.
  v.cape = pickFromPool(rng, resolveBodyPool(classPool.cape, v.bodyType));
  v.capeColor = Array.isArray(classPool.capeColor)
    ? pick(rng, classPool.capeColor)
    : (classPool.capeColor ?? null);
  if (v.capeColor === 'accent') v.capeColor = v.outfitAccentColor;
  else if (v.capeColor === 'main') v.capeColor = v.outfitMainColor;
  // Beast-kin wear no headwear (their ears need to show; a hood/cap would cover them).
  v.headwear = (v.beast || v.costume) ? null : pickFromPool(rng, resolveBodyPool(classPool.headwear, v.bodyType));
  // Headwear colour: a class may lock it to the outfit accent/main, a fixed
  // colour name, or (default, null) the cloth colour at compositing time.
  // 'any' → ONE random cloth colour, picked here so it's locked consistently
  // across all animation rows (a null lockedColor would re-roll per row →
  // colour flicker). 'accent'/'main' resolve to the outfit tones.
  v.headwearColor = classPool.headwearColor === 'accent' ? v.outfitAccentColor
                  : classPool.headwearColor === 'main' ? v.outfitMainColor
                  : classPool.headwearColor === 'any' ? pick(rng, CLOTH_ALL)
                  : Array.isArray(classPool.headwearColor) ? pick(rng, classPool.headwearColor)
                  : (classPool.headwearColor ?? null);
  // Headwear-safe hair. Two cases (bare heads keep the full range):
  //  • Head-WRAPPING covering (hood/veil/bandana): hides the crown, so ANY
  //    voluminous/textured style pokes through → swap to a flat covering-safe one.
  //  • Any OTHER headwear that sits on the crown (wizard/large hats, caps,
  //    circlets): long/curly/flat hair flows fine, but TALL/spiky styles
  //    (mohawks, spikes, crown-topknots, high buns/ponytails) poke → swap just
  //    those to a flat style.
  if (v.hair && v.headwear) {
    if (HAIR_COVERINGS.has(v.headwear)) {
      if (!COVERING_SAFE_HAIR.has(v.hair)) v.hair = pick(rng, COVERING_SAFE_HAIR_LIST);
    } else if (HAIR_TALL.has(v.hair)) {
      v.hair = pick(rng, COVERING_SAFE_HAIR_LIST);
    }
  }
  // Visor pairing — a visor is a face-plate (zPos 132) that recolors via the
  // metal palette, so it matches the helmet's finish. By default it only reads
  // over an open bascinet. A class may instead opt into `visorOnAnyHelm` to
  // pair a visor with EVERY helm it rolls (minus `visorExcludeHelms`, e.g. the
  // open-topped Flattop) — the Templar's full-face crusader look.
  v.visor = null;
  const _visorHelmOk = classPool.visorOnAnyHelm
    ? (v.headwear && !(classPool.visorExcludeHelms || []).includes(v.headwear))
    : (v.headwear === 'Bascinet' || v.headwear === 'Round bascinet');
  if (classPool.visorChance && _visorHelmOk && chance(rng, classPool.visorChance)) {
    v.visor = pick(rng, classPool.visors
      || ['Pigface visor', 'Grated visor', 'Slit visor', 'Round visor']);
  }
  // Head overlay pairing — a piece that only reads on TOP of a matching base
  // headwear (like a Skull Bandana Overlay over a bandana). Rule shape:
  //   { when: ['Bandana', …], items: ['Skull Bandana Overlay'], chance, color? }
  // Gated on classPool.headOverlay (unset for most classes → no rng consumed,
  // so it can't shift other classes' deterministic picks).
  // Head overlays — pieces layered on TOP of a matching base headwear (skull on
  // a bandana, a feather plume + trim band on a bonnie/cavalier cap). May be a
  // single rule {when,items,chance,color} OR an ARRAY of rules (so one hat can
  // stack several overlays, e.g. bonnie = center-trim + feather, each its own
  // colour). color 'any' = random, biased to differ from the base hat colour.
  v.headOverlays = [];
  const overlayRules = !classPool.headOverlay ? []
    : Array.isArray(classPool.headOverlay) ? classPool.headOverlay
    : [classPool.headOverlay];
  for (const r of overlayRules) {
    if (!r.when.includes(v.headwear) || !chance(rng, r.chance)) continue;
    let col;
    if (r.color === 'any') {
      col = pick(rng, CLOTH_ALL);
      let g = 0; while (col === v.headwearColor && g++ < 16) col = pick(rng, CLOTH_ALL);
    } else {
      col = Array.isArray(r.color) ? pick(rng, r.color) : (r.color ?? null);
    }
    v.headOverlays.push({ name: pick(rng, r.items), color: col });
  }

  // Accessories. Two pool forms:
  //   object  { items, chance, pickCount? }            — one group (legacy)
  //   array  [ { items, chance, pickCount?, color? } ] — independent groups,
  //          each rolled separately (e.g. scarf 60% + ring 30% + earring 25%).
  // Stored as { name, color } so per-group colour locks survive to the manifest.
  v.accessories = [];
  const accGroups = !classPool.accessory ? []
    : Array.isArray(classPool.accessory) ? classPool.accessory
    : [classPool.accessory];
  for (const g of accGroups) {
    const r = resolvePool(g);
    if (!r || !chance(rng, r.chance)) continue;
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
    // color may be a single name, an array (pick one), or null (item default).
    for (const name of picked) {
      const color = Array.isArray(r.color) ? pick(rng, r.color) : (r.color ?? null);
      v.accessories.push({ name, color });
    }
  }

  // ── Cargo: LPC basket + basket_contents (the Miner's haul) ──────────────────
  // A round/square Basket worn on the back, usually loaded with a SINGLE haul
  // (Ore OR Wood, never both). The contents declare required_tags:['basket'] and
  // ONLY composite correctly inside a basket — their fg (zPos 140) sits over the
  // basket rim fg (zPos 130), so the haul reads as piled in the basket. Rolling
  // a load WITHOUT a basket (the old independent-accessory bug) left the ore
  // floating / clipped. Modeling it as one unit guarantees the basket is present
  // whenever there's a load and keeps ore + wood from stacking in one basket.
  if (classPool.cargo && chance(rng, classPool.cargo.chance ?? 1)) {
    const cg = classPool.cargo;
    v.accessories.push({ name: 'Basket', color: pick(rng, cg.basketVariants || ['round', 'square']) });
    if (Array.isArray(cg.loads) && cg.loads.length && chance(rng, cg.loadChance ?? 1)) {
      const totalW = cg.loads.reduce((s, l) => s + (l.weight ?? 1), 0);
      let roll = rng() * totalW;
      let chosen = cg.loads[cg.loads.length - 1];
      for (const l of cg.loads) { roll -= (l.weight ?? 1); if (roll <= 0) { chosen = l; break; } }
      v.accessories.push({ name: chosen.item, color: pick(rng, chosen.colors) });
    }
  }

  // Weapon (skipped if barehanded)
  v.weapon = classPool.barehanded ? null : pickFromPool(rng, classPool.weapon);
  // Optional per-variant weapon colour (e.g. cheater glowswords mix blue/red).
  // Locked once here so it's consistent across every animation row; overrides
  // the global WEAPON_VARIANT_LOCK at compositing time. The `'metal'` keyword
  // ties the blade to the variant's armour metalColor (a matched gladius for the
  // gladiator) — this also pins it OUT of any colour the metalColorPool excludes
  // (e.g. copper) and keeps the base sheet + _atk swing on the same variant PNG
  // (no flicker), since both bakers read v.weaponColor.
  v.weaponColor = classPool.weaponColor === 'metal'
    ? (v.metalColor || null)
    : Array.isArray(classPool.weaponColor)
      ? pick(rng, classPool.weaponColor)
      : (classPool.weaponColor ?? null);
  // Crystal pair: when staff is Diamond/Loop, force-add a crystal layer.
  v.crystal = null;
  if (v.weapon && CRYSTAL_RULE.staves.has(v.weapon)) {
    v.crystal = { color: pick(rng, CRYSTAL_RULE.colors) };
  }

  // Shield — supports multiple shield "kinds" (classPool.shieldTypes, default
  // ['heater']). alwaysShield forces one; sometimesShield rolls one at the
  // given chance. The chosen kind is recorded as an object resolved into the
  // right layer recipe in buildLayerManifest:
  //   heater → wood Base + metal Trim + (optional) heraldic-painted face
  //   round  → one-piece Round Shield in a fixed colour variant
  v.shield = null;
  // A shield only makes sense with a ONE-handed weapon — `shieldWeapons`, when
  // set, gates the shield to those weapons (so a two-handed great-axe/halberd/
  // spear doesn't also sprout a shield).
  const shieldWeaponOk = !classPool.shieldWeapons || classPool.shieldWeapons.includes(v.weapon);
  const wantShield = (classPool.alwaysShield
    || (classPool.sometimesShield && chance(rng, classPool.sometimesShield)))
    && shieldWeaponOk;
  if (wantShield) {
    const kind = pick(rng, classPool.shieldTypes || ['heater']);
    if (kind === 'round') {
      const roundColors = classPool.roundShieldColors?.length ? classPool.roundShieldColors : ROUND_SHIELD_COLORS;
      v.shield = { kind: 'round', color: pick(rng, roundColors) };
    } else if (kind === 'scutum') {
      // Rectangular Roman scutum (single design, bg+fg layers). Optional gold
      // engrailed-style trim overlay on ~half (shieldTrimChance).
      v.shield = { kind: 'scutum', trim: chance(rng, classPool.shieldTrimChance ?? 0.5) };
    } else if (kind === 'spartan') {
      // Round Greek hoplon (single design, bg+fg layers). No trim variant.
      v.shield = { kind: 'spartan' };
    } else if (kind === 'kite') {
      const kiteColors = classPool.kiteShieldColors?.length ? classPool.kiteShieldColors : KITE_SHIELD_COLORS;
      v.shield = { kind: 'kite', color: pick(rng, kiteColors) };
    } else if (kind === 'crusader' || kind === 'plus') {
      // Fixed heraldic shields (single canonical design each, zPos 2). Either
      // kind may add the two-engrailed trim overlay (zPos 3); `shieldTrimChance`
      // (default 0.5) decides per-shield so ~half wear the engrailed border.
      v.shield = { kind, trim: chance(rng, classPool.shieldTrimChance ?? 0.5) };
    } else {
      // Paint the heater face in the house (cloth) colour when the class opts
      // into a heraldic shield (default) AND that colour exists as a paint.
      const paint = (classPool.heraldicShield !== false && SHIELD_PAINT_COLORS.has(v.clothColor))
        ? v.clothColor : null;
      v.shield = { kind: 'heater', paint };
    }
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

// Anim-fallback table — for layers whose source folder is missing certain
// animations, fall back to a related anim that does exist.  Only used for
// the Shadow layer right now: LPC ships shadow PNGs for walk/slash/thrust/
// spellcast/shoot/hurt but not for idle/run.  Both reuse the walk shadow
// (idle = standing pose ≈ first walk frame; run uses the same foot-cycle
// shape) so adventurers always cast a shadow regardless of state.  The
// frame-count mismatch is handled by repeated tiling further below.
const ANIM_FALLBACK = {
  'shadow/adult': { idle: 'walk', run: 'walk' },
  'shadow/child': { idle: 'walk', run: 'walk' },
};

// GENERAL anim fallback applied to EVERY layer (after any per-dir override).
// `run` and `idle` are newer LPC animations that many clothing items don't
// ship — without this, a coat/pants/etc. that lacks run art simply vanishes
// during the run animation. Both reuse `walk` (run = same foot-cycle shape,
// idle ≈ first walk frame). The composite copies the source top-left and the
// renderer samples only the first N frames per row, so a 9-frame walk strip
// overflowing the 8-frame run block is harmless.
const GENERAL_ANIM_FALLBACK = { run: 'walk', idle: 'walk' };

// Animation names a weapon layer path can end in (the per-anim weapon art
// dirs). A weapon layer's sourceDir already encodes its animation, e.g.
// `weapon/sword/scimitar/walk` (foreground) or `.../walk/behind`.
const WEAPON_PATH_ANIMS = new Set([
  'walk', 'slash', 'thrust', 'shoot', 'spellcast', 'hurt', 'idle', 'run',
  'backslash', 'halfslash', 'climb', 'jump', 'sit', 'emote', 'combat_idle',
]);

function resolveLayerSourceForAnim(rng, layerSourceDir, animFile, animName, lockedColor) {
  // ── Weapon layers ─────────────────────────────────────────────────────
  // Weapons are laid out per-animation: the layer path is the anim dir
  // itself (`weapon/<type>/<name>/<anim>[/behind]`) holding a single
  // `<name>.png` (or `<color>.png`). The generic "append <animFile>" path
  // below never matches these, so handle them explicitly: a weapon layer
  // only fills ITS OWN animation row (a `walk` layer also fills idle/run so
  // the carried weapon doesn't blink out when the adv stands still).
  if (layerSourceDir.startsWith('weapon/')) {
    const segs = layerSourceDir.split('/');
    const isBehind = segs[segs.length - 1] === 'behind';
    const layerAnim = isBehind ? segs[segs.length - 2] : segs[segs.length - 1];
    if (WEAPON_PATH_ANIMS.has(layerAnim)) {
      const matches = layerAnim === animName ||
        (layerAnim === 'walk' && (animName === 'idle' || animName === 'run'));
      if (!matches) return null;
      const dir = path.join(ssRoot, layerSourceDir);
      if (!fs.existsSync(dir)) return null;
      if (lockedColor) {
        const lp = path.join(dir, `${lockedColor}.png`);
        if (fs.existsSync(lp)) return lp;
      }
      const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
      return pngs.length ? path.join(dir, pngs[0]) : null;
    }
  }

  const subdir = path.join(ssRoot, layerSourceDir, animName);
  const subdirIsDir = fs.existsSync(subdir) && fs.statSync(subdir).isDirectory();
  // A locked color wins FIRST when this item ships a matching color-variant
  // in its `<animName>/` subdir — even if a flat single-color `<animFile>`
  // also exists. Several items (e.g. shoes/basic) ship BOTH a default
  // walk.png AND walk/<color>.png; without this the flat default shadowed
  // the variants and the lock never took (cream shoes despite a black.png).
  if (lockedColor && subdirIsDir) {
    const locked = path.join(subdir, `${lockedColor}.png`);
    if (fs.existsSync(locked)) return locked;
  }
  // Try `<dir>/<animFile>` (single-color item).
  const direct = path.join(ssRoot, layerSourceDir, animFile);
  if (fs.existsSync(direct)) return direct;
  // Try `<dir>/<animName>/<color>.png` (color-variant item) — random pick
  // when no color was locked (or the locked one wasn't available).
  if (subdirIsDir) {
    return pickColorVariant(rng, subdir);
  }
  // Anim fallback — per-dir override (e.g. Shadow) first, then the GENERAL
  // run/idle -> walk rule so any clothing item missing those newer anims
  // reuses its walk art instead of vanishing. Re-resolve with the fallback
  // anim (handles flat files, color-variant subdirs, and lockedColor the
  // same way). walk has no fallback, so this can't recurse forever.
  const fbAnim = ANIM_FALLBACK[layerSourceDir]?.[animName]
    ?? GENERAL_ANIM_FALLBACK[animName];
  if (fbAnim && fbAnim !== animName) {
    return resolveLayerSourceForAnim(rng, layerSourceDir, `${fbAnim}.png`, fbAnim, lockedColor);
  }
  return null;
}

function buildLayerManifest(variant) {
  // Returns sorted array of { sourceDir, zPos, lockedColor?, palette?, def, ... }.
  const layers = [];
  const add = (itemName, opts = {}) => {
    if (!itemName) return;
    const item = resolveItem(itemName);
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
    // Per-layer cloth-colour override (e.g. pants a different "normal" colour
    // than the vibrant torso). Falls back to the variant's clothColor.
    const clothColor = opts.clothColor || variant.clothColor;
    // The trailing `PALETTE.options[color]` guard skips the swap when the colour
    // isn't valid FOR THAT palette (e.g. a metal name like 'gold'/'silver' handed
    // to a cloth item) — otherwise the swap target is `undefined` and the recolor
    // either crashes or wipes the layer. The item keeps its lockedColor variant
    // PNG / base instead. (Hardened when headOverlay colours started flowing into
    // clothColor; also fixes the long-standing 'gold in a CLOTH pool' crash.)
    const wantHair  = (m) => m === 'hair'  && HAIR_PALETTE  && variant.hairColor  && variant.hairColor  !== HAIR_PALETTE.base  && HAIR_PALETTE.options[variant.hairColor];
    const wantBody  = (m) => m === 'body'  && BODY_PALETTE  && variant.bodyColor  && variant.bodyColor  !== BODY_PALETTE.base  && BODY_PALETTE.options[variant.bodyColor];
    const wantCloth = (m) => m === 'cloth' && CLOTH_PALETTE && clothColor && clothColor !== CLOTH_PALETTE.base && CLOTH_PALETTE.options[clothColor];
    const wantMetal = (m) => m === 'metal' && METAL_PALETTE && variant.metalColor && variant.metalColor !== METAL_PALETTE.base && METAL_PALETTE.options[variant.metalColor];
    // Recolor SOURCE shades. Most items are drawn in the palette's global base
    // shade, so the prebuilt *_BASE_PACKED maps work. But some items declare
    // their OWN base (recolors.base) — e.g. the stud-ring gem is drawn in
    // "teal", not the global cloth base — so a global-base swap never matches
    // their pixels (the ring stayed cyan). When an item declares a base that
    // exists in the relevant palette, remap FROM that base's shades instead.
    const itemBase = r?.base;
    const srcPacked = (PALETTE, globalPacked) =>
      (itemBase && PALETTE && PALETTE.options[itemBase])
        ? new Map(PALETTE.options[itemBase].map((c, i) => [packRgb(c), i]))
        : globalPacked;
    if (wantHair(matDirect)  || wantHair(matColor1))  palettes.push({ base: srcPacked(HAIR_PALETTE,  HAIR_BASE_PACKED),  target: HAIR_PALETTE.options[variant.hairColor]   });
    if (wantBody(matDirect)  || wantBody(matColor1))  palettes.push({ base: srcPacked(BODY_PALETTE,  BODY_BASE_PACKED),  target: BODY_PALETTE.options[variant.bodyColor]   });
    if (wantCloth(matDirect) || wantCloth(matColor1)) palettes.push({ base: srcPacked(CLOTH_PALETTE, CLOTH_BASE_PACKED), target: CLOTH_PALETTE.options[clothColor] });
    if (wantMetal(matDirect) || wantMetal(matColor1)) palettes.push({ base: srcPacked(METAL_PALETTE, METAL_BASE_PACKED), target: METAL_PALETTE.options[variant.metalColor] });

    let li = 1;
    while (item.def[`layer_${li}`]) {
      const layer = item.def[`layer_${li}`];
      // A layer may declare a `custom_animation` (an OVERSIZE attack sheet,
      // e.g. a weapon's slash_128). We can't bake the oversize frames into
      // the 64×64 sheet — BUT many such layers ALSO ship standard 64×64
      // per-bodytype art (a weapon's `walk` carry + `slash` swing). Use that
      // standard art (resolveLayerSourceForAnim returns null for any anim it
      // lacks, so oversize-only anims are simply skipped per-row). Without
      // this, every weapon was dropped from the base sheet — visible only
      // via the separate _atk pipeline, which this project no longer bakes.
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
  // Shadow layer (zPos 0) — LPC's drop-shadow sheet, baked under every
  // body so adventurers cast a small ground shadow that aligns with
  // their per-frame foot positions.  Walk / slash / thrust / spellcast /
  // shoot / hurt all have matching shadow PNGs in the LPC pack; idle
  // and run fall back to the walk shadow via the resolver's anim-fallback
  // (see resolveLayerSourceForAnim).
  add('Shadow');
  add('Body Color');
  add(variant.head);
  add(variant.nose);
  add(variant.eyebrows);
  add(variant.hair);
  add(variant.beard);
  // Pass the chosen clothColor as a locked variant for the wearables.
  // Palette-recolor items (e.g. Trench coat, material:cloth) ignore it and
  // use the palette swap; fixed color-VARIANT items (e.g. Frock coat, which
  // ships black.png/charcoal.png/… instead of a recolor) lock to the
  // matching color PNG when one exists, else fall back to a random variant.
  // Cape (e.g. necromancer Tattered cloak) — its def ships a behind layer
  // (zPos 5, under the body) AND a draped front layer (zPos 85, over the
  // torso), so this single add composites the whole cloak in the right order.
  add(variant.cape, { lockedColor: variant.capeColor || variant.clothColor });
  // Two-tone outfit layers (e.g. mage kimono) — each colour-variant piece
  // locks to its own resolved colour (main vs accent); composited by each
  // def's own zPos (kimono 30 < trim 31 < sleeve-trim 32 < bodice 45).
  if (variant.outfitLayers) {
    for (const o of variant.outfitLayers) add(o.item, { lockedColor: o.color });
  }
  add(variant.torso, { lockedColor: variant.clothColor });
  // Second torso layer (surcoat/tabard/belt) at its own zPos — composites under
  // or over the base torso purely by zPos (e.g. Tabard 55 < Plate 60 → under;
  // a belt at 70 > Leather 60 → over). Uses a fixed overlay colour when set
  // (e.g. a brown leather belt), else the cloth colour.
  add(variant.torsoOverlay, { lockedColor: variant.torsoOverlayColor || variant.clothColor });
  add(variant.legs,  { lockedColor: variant.legsColor || variant.clothColor, clothColor: variant.legsColor || variant.clothColor });
  add(variant.feet,  { lockedColor: variant.feetColor || variant.clothColor, clothColor: variant.feetColor || variant.clothColor });
  add(variant.arms,  { lockedColor: variant.armsColor || variant.clothColor, clothColor: variant.armsColor || variant.clothColor });
  // Shoulder overlay (pauldron / spaulder / Legion) on top of the arms, and a
  // hands layer (gauntlets / gloves). Metal pieces ignore lockedColor and follow
  // metalColor (so they match a plated suit); cloth ones take the cloth colour.
  add(variant.shoulder, { lockedColor: variant.armsColor || variant.clothColor, clothColor: variant.armsColor || variant.clothColor });
  add(variant.hands,    { lockedColor: variant.clothColor });
  // Lock cloth headwear (hoods / bandanas / masks) to the outfit colour so they
  // stay on-theme instead of rolling a random colour variant (the Plain Mask
  // was defaulting to bright white). Metal helmets are flat-PNG + metal-palette,
  // so they ignore lockedColor — unaffected.
  //
  // Headwear shares `name`s across slots: the Legion HELM, the Legion lorica
  // (torso) and the Legion pauldrons (arms) are ALL named "Legion", and the
  // global byName index keeps whichever was walked last (the torso armour). A
  // bare add('Legion') for a helmet therefore silently composited a SECOND
  // lorica at the head slot and rendered NO helmet (the gladiator missing-helmet
  // bug). Resolve headwear from the `headwear/` category first so a hat name can
  // never collide with a torso/arms item; fall back to the global index for any
  // hat that lives outside headwear/. v.headwear stays the clean name, so the
  // headOverlay `when:` matching above is unaffected.
  const hwName = variant.headwear
    && ((byCategory['headwear'] || []).some((x) => x.name === variant.headwear)
          ? `headwear:${variant.headwear}`
          : variant.headwear);
  add(hwName, { lockedColor: variant.headwearColor || variant.clothColor });
  // Visor overlay (zPos 132) — sits over the bascinet skull (zPos 130).
  add(variant.visor);
  // Head overlays (skull over a bandana; bonnie center-trim + feather; cavalier
  // feather; gladiator helm crest/plume) — each layered on the base hat,
  // optionally colour-locked. Pass the colour as BOTH lockedColor (variant-PNG
  // pick) AND clothColor: a CLOTH-material overlay (e.g. the horsehair Plumage)
  // recolours via the cloth PALETTE, which reads clothColor — NOT lockedColor —
  // so without the clothColor here the plume silently inherited the variant's
  // skirt colour (a 'forest' skirt → a GREEN plume, off the red/white/black/maroon
  // intent). Metal overlays (the Crest) ignore both and follow metalColor.
  for (const o of (variant.headOverlays || [])) add(o.name, o.color ? { lockedColor: o.color, clothColor: o.color } : {});
  // Beast-kin ears (zPos 130) + tail (zPos 125), both coloured to the hair so
  // the fur matches.
  if (variant.beast) {
    add(variant.beast.ears, { lockedColor: variant.hairColor });
    add(variant.beast.tail, { lockedColor: variant.hairColor });
  }
  // Coordinated costume pieces (cosplay_adventurer): wings (zPos 105) / tail
  // (85/125) / horns (126), each colour-locked to the creature's shared hue so
  // the whole costume reads as one (e.g. a green dragon's wings + tail match).
  if (variant.costume) {
    for (const p of variant.costume.pieces) add(p.item, p.color ? { lockedColor: p.color } : {});
  }
  // Accessories are { name, color } — colour-lock when the group set one. Pass
  // the colour as BOTH lockedColor (variant-PNG pick, e.g. a gold Necklace) AND
  // clothColor, so a CLOTH-material accessory (e.g. the Stud Ring's teal gemstone)
  // actually takes the requested colour instead of silently inheriting the
  // outfit's clothColor. Accessories with NO colour set (e.g. the rogue's
  // outfit-toned ring) are unchanged. The palette guard skips an invalid colour
  // for a given palette (e.g. a metal 'gold' on a cloth item) — no crash.
  for (const a of variant.accessories) add(a.name, a.color ? { lockedColor: a.color, clothColor: a.color } : {});
  // Lock the carried weapon's colour: a per-variant weaponColor (e.g. a cheater
  // glowsword's blue/red blade) wins, else the global WEAPON_VARIANT_LOCK (the
  // Smash great-axe → 'axe'; Glowsword → 'blue' fallback). Both keep the blade
  // consistent across every animation row instead of re-rolling (flicker).
  if (variant.weapon) {
    const wlock = variant.weaponColor || WEAPON_VARIANT_LOCK[variant.weapon];
    add(variant.weapon, wlock ? { lockedColor: wlock } : {});
  }
  // Bow users carry a nocked arrow (shoot-only layer).
  if (BOW_WEAPONS.has(variant.weapon)) add('Ammo');
  if (variant.crystal) add('Crystal', { lockedColor: variant.crystal.color });
  if (variant.shield) {
    if (variant.shield.kind === 'round') {
      add('Round Shield', { lockedColor: variant.shield.color });
    } else if (variant.shield.kind === 'scutum') {
      // Rectangular Roman scutum (bg paint + fg) + optional engrailed trim.
      add('Scutum shield');
      if (variant.shield.trim) add('Scutum shield trim');
    } else if (variant.shield.kind === 'spartan') {
      add('Spartan Shield'); // round hoplon, bg+fg
    } else if (variant.shield.kind === 'kite') {
      add('Kite', { lockedColor: variant.shield.color });
    } else if (variant.shield.kind === 'crusader' || variant.shield.kind === 'plus') {
      // Fixed heraldic face (zPos 2) + an optional engrailed trim border (zPos 3)
      // on ~half (variant.shield.trim).
      add(variant.shield.kind === 'plus' ? 'Plus shield' : 'Crusader shield');
      if (variant.shield.trim) add('Two engrailed shield trim');
    } else { // heater
      add('Heater Shield Base');                                       // wood face
      add('Heater Shield Trim', { lockedColor: variant.metalColor });  // metal rim, matched to armour
      if (variant.shield.paint) add('Heater Shield Paint', { lockedColor: variant.shield.paint }); // heraldic colour
    }
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
    // Prosthesis MASK sublayers (body/prosthesis/<peg_leg|hook>/…/mask) are
    // dest-out cutouts — they ERASE the original limb (incl. its pants/boot/
    // glove pixels already composited below) so the peg/hook art replaces it.
    // Without this they'd composite as a visible magenta silhouette. No other
    // item ships a /mask/ sublayer, so this only affects Peg leg / Hook hand.
    const blend = /\/mask$/.test(layer.sourceDir) ? 'dest-out' : 'over';
    for (const row of LAYOUT.rows) {
      const src = resolveLayerSourceForAnim(rng, layer.sourceDir, row.file, row.anim, layer.lockedColor);
      if (!src) continue;
      if (layer.palettes && layer.palettes.length) {
        const remapped = await applyPaletteSwap(src, layer.palettes);
        if (remapped.width > LAYOUT.width || remapped.height > LAYOUT.height) {
          console.warn(`  ! skip oversized layer "${layer.itemName}" ${remapped.width}x${remapped.height} (>${LAYOUT.width}x${LAYOUT.height})`);
          continue;
        }
        composites.push({
          input: remapped.buffer,
          raw: { width: remapped.width, height: remapped.height, channels: 4 },
          top: row.y, left: 0, blend,
        });
      } else {
        // Guard against oversize source art (e.g. 128px weapon sheets) that
        // can't fit the 64px base sheet — skip with a warning rather than
        // crash the whole bake.
        const meta = await sharp(src).metadata();
        if ((meta.width || 0) > LAYOUT.width || (meta.height || 0) > LAYOUT.height) {
          console.warn(`  ! skip oversized layer "${layer.itemName}" ${meta.width}x${meta.height} (>${LAYOUT.width}x${LAYOUT.height})`);
          continue;
        }
        composites.push({ input: src, top: row.y, left: 0, blend });
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
// When a class filter is in effect we MERGE into the existing manifest
// so we don't blow away the entries for classes we didn't re-bake (the
// PNGs on disk are still good — just the manifest entries would be
// missing, and AdventurerRenderer would silently fall back to the
// procedural-circle silhouette for every untouched class).
const manifestPath = path.join(outRoot, 'manifest.json');
const manifest = (classFilter.length && fs.existsSync(manifestPath))
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : { variants: {}, layout: LAYOUT };
manifest.variants ??= {};
manifest.layout = LAYOUT;

async function bakeClass(className) {
  const classPool = POOLS[className];
  if (!classPool) { console.warn(`unknown class ${className}, skipping`); return; }

  const outDir = path.join(outRoot, className);
  fs.mkdirSync(outDir, { recursive: true });

  const seen = new Set();
  const variants = [];
  const baseSeed = stringHash(className);
  // Optional EVEN metal-colour spread: a per-slot bag so no armour metal
  // dominates (vs a uniform random pick). Keyed off the accepted index `i`, so a
  // rejected duplicate re-rolls its OTHER fields with the same forced metal.
  const metalBag = classPool.metalColorEven
    ? buildEvenBag((classPool.metalColorPool?.length) ? classPool.metalColorPool : METAL_ALL,
                   variantCount, makeRng(baseSeed ^ 0x9e3779b9))
    : null;
  // Optional EXACT mode split (modesEven): replicate each mode name by its weight
  // share of `variantCount`, then shuffle, so the live bare/armored ratio matches
  // the weights regardless of dedup rejections. Keyed off the accepted index `i`.
  let modeBag = null;
  if (classPool.modesEven && Array.isArray(classPool.modes) && classPool.modes.length) {
    const totalW = classPool.modes.reduce((s, m) => s + (m.weight ?? 1), 0);
    const names = [];
    for (const m of classPool.modes) {
      const n = Math.round(((m.weight ?? 1) / totalW) * variantCount);
      for (let k = 0; k < n; k++) names.push(m.name);
    }
    while (names.length < variantCount) names.push(classPool.modes[0].name);
    names.length = variantCount; // trim any rounding overshoot
    // Shuffle in place (NOT buildEvenBag — that dedups and would drop the weight
    // replication, flattening unequal weights to an even round-robin).
    const mrng = makeRng(baseSeed ^ 0x85ebca6b);
    for (let k = names.length - 1; k > 0; k--) {
      const j = Math.floor(mrng() * (k + 1));
      [names[k], names[j]] = [names[j], names[k]];
    }
    modeBag = names;
  }
  let attempts = 0;
  for (let i = 0; i < variantCount && attempts < variantCount * 4; ) {
    const seed = baseSeed + attempts * 1000003 + i;
    const rng = makeRng(seed);
    const forced = {};
    if (metalBag) forced.metalColor = metalBag[i];
    if (modeBag)  forced.mode = modeBag[i];
    const v = sampleVariant(rng, className, classPool, forced);
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
      outfit: v.outfitLayers
        ? { main: v.outfitMainColor, accent: v.outfitAccentColor, layers: v.outfitLayers.map((l) => l.item) }
        : undefined,
      torsoOverlay: v.torsoOverlay,
      cape: v.cape,
      legs: v.legs,
      feet: v.feet,
      arms: v.arms,
      shoulder: v.shoulder || undefined,
      hands: v.hands || undefined,
      headwear: v.headwear,
      headOverlays: (v.headOverlays && v.headOverlays.length) ? v.headOverlays : undefined,
      beast: v.beast,
      costume: v.costume || undefined,
      mode: v.mode || undefined,
      visor: v.visor,
      accessories: v.accessories,
      weapon: v.weapon,
      weaponColor: v.weaponColor || undefined,
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

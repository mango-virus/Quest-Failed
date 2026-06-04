'use strict';

// Composites LPC weapon layers onto 550 pre-baked adventurer sprites.
// Run from Quest-Failed/: node bake-weapons.js
// Overwrites each assets/sprites/adventurers/{class}/{id}.png in-place.

const sharp    = require('sharp');
const fs       = require('fs');
const path     = require('path');

// ─── Paths ───────────────────────────────────────────────────────────────────
const REPO     = __dirname;
const LPC_BASE = path.resolve(REPO, '../Quest-Failed assets/Universal-LPC-Spritesheet-Character-Generator-master/Universal-LPC-Spritesheet-Character-Generator-master');
const SHEETS   = path.join(LPC_BASE, 'spritesheets');
const WDEFS    = path.join(LPC_BASE, 'sheet_definitions/weapons');
const ADV      = path.join(REPO, 'assets/sprites/adventurers');

// ─── Layout (from layout.json) ────────────────────────────────────────────────
const LAYOUT_RAW = JSON.parse(fs.readFileSync(path.join(ADV, 'layout.json'), 'utf8'));
const FRAME  = LAYOUT_RAW.frame; // 64
const CHAR_W = LAYOUT_RAW.width; // 832
const CHAR_H = LAYOUT_RAW.height; // 1856

const ANIM_LAYOUT = {}; // name → {y, frames, dirRows, w, h}
for (const row of LAYOUT_RAW.rows) {
  ANIM_LAYOUT[row.anim] = {
    y:       row.y,
    frames:  row.frames,
    dirRows: row.dirRows,
    w:       row.frames  * FRAME,
    h:       row.dirRows * FRAME,
  };
}

// ─── Oversize animation config ────────────────────────────────────────────────
// Maps custom_animation type → which standard row it targets + source frame size
const OVERSIZE = {
  slash_oversize:         { targetAnim: 'slash',  frameSize: 192 },
  slash_reverse_oversize: { targetAnim: 'slash',  frameSize: 192 },
  slash_128:              { targetAnim: 'slash',  frameSize: 128 },
  thrust_oversize:        { targetAnim: 'thrust', frameSize: 192 },
  walk_128:               { targetAnim: 'walk',   frameSize: 128 },
};
// Unknown custom_animations (backslash_128, halfslash_128, …) are silently skipped.

// ─── Animation aliases ────────────────────────────────────────────────────────
// Some weapons use a different animation than the game engine selects.
// Rangers/bards play 'shoot' but crossbow only has 'thrust' layers in LPC.
// Map: weaponName → { sourceAnim → extraTargetAnim }
// The layer composited at sourceAnim is ALSO composited at extraTargetAnim.
const ANIM_ALIASES = {
  Crossbow: { thrust: 'shoot' },
};

// ─── Attack sprite-sheet config ──────────────────────────────────────────────
// Classes whose combat animation is slash or thrust get a separate `_atk.png`
// at 192×192 frames so long weapons (longsword, halberd, spear, …) render at
// native scale instead of being clipped or shrunk into 64×64.
// Includes spellcasters and ranged classes too — staves and crossbows now
// render via the atk sheet's thrust row (see THRUST_ANIM_WEAPONS in
// AdventurerRenderer). Monks are excluded because they have weapon: null.
const ATK_CLASSES = new Set([
  'knight', 'rogue', 'barbarian', 'twitch_streamer', 'beast_master',
  'mage', 'cleric', 'necromancer', 'ranger', 'bard',
  // Event-only class — Cosplay Contest spawns; cosplayers retaliate
  // when attacked, so they need the oversize weapon attack sheet too.
  'cosplay_adventurer',
  // Bounty hunters carry crossbows — crossbow combat is the thrust-oversize
  // animation, which lives in the _atk.png sheet.
  'bounty_hunter',
  // Cheater — pulls from every weapon pool (longswords, halberds, scythes,
  // crossbows, staves, glowsword). The oversize attack sheet keeps long
  // weapons rendered at native 192×192 instead of being shrunk into 64×64.
  'cheater',
  // Templar — normal-roster holy crusader. Mace/Flail/Longsword are ALL
  // slash_oversize (their swing art only exists at 192×192), so the atk sheet
  // is required or the weapon is invisible mid-swing. The shield is inherited
  // from the base slash frames the atk body is extracted from.
  'templar',
  // Pirate — cutlass swashbuckler. Saber/Scimitar/Rapier swing via
  // slash_oversize, so the atk sheet is required for a visible blade.
  'pirate',
  // Miner — swings a pickaxe (the Smash tool, slash_128 oversize).
  'miner',
  // Valkyrie — holy sword (Longsword/Arming Sword) swings via slash_oversize;
  // spear variants thrust via the base sheet (no atk needed).
  'valkyrie',
  // Peasant — Scythe swings via slash_oversize (atk sheet needed); the Spear
  // (pitchfork) + Thrust hand-tool (hoe/shovel/watering) are contained 64px
  // weapons whose thrust is composited into the atk thrust row at native scale.
  'peasant',
  // Gladiator — gladius swings oversize (Arming Sword slash_128, Saber
  // slash_oversize) so the blade needs the 192px atk sheet; the Spear is
  // contained (base thrust).
  'gladiator',
  // Gambler — Rapier swings oversize (slash_oversize → 192px atk sheet); the
  // gentleman's Cane is a contained thrust (jab composited into the atk thrust
  // row at native scale). Dagger is in NORMAL_ATTACK_WEAPONS → no atk sheet.
  'gambler',
  // Sung Jinwoo (Solo Leveling event) — melee Saber whose only swing art is
  // the 192×192 slash_oversize sheet. Without the atk sheet his blade is
  // invisible mid-attack (the oversize slash can't fit the 64×64 main sheet).
  'shadow_monarch',
  // Light Party event classes — paladin (Longsword/Mace), samurai (Saber)
  // both have slash_oversize art; white_mage (Diamond/Loop staff) +
  // black_mage (Diamond/S/Gnarled/Loop staff) cast via thrust_oversize.
  // All four need the 192×192 atk sheet so their weapons render at native
  // scale during combat instead of being clipped into 64×64.
  'paladin', 'white_mage', 'samurai', 'black_mage',
  // KR Kingdom-Response champions — Garreth (Longsword) · Necrarch (Scythe) · Vane
  // (Scimitar) · Mordrake (Mace) swing slash_oversize; Velloran (S staff) +
  // Aurelia (Loop staff) cast thrust_oversize. All need the atk sheet.
  'champion_garreth', 'champion_necrarch', 'champion_vane', 'champion_mordrake', 'champion_velloran', 'champion_aurelia',
]);
// Weapons whose attack is the standard 64×64 slash (a contained "normal" swing
// with the shield up) rather than the oversize 192×192 arc. Variants wielding
// one of these get NO `_atk.png` — the renderer falls back to the base slash.
// MUST stay in sync with the same set in src/scenes/AdventurerAtkLoader.js.
// Dagger has its own 64px slash art (composited into the base sheet's slash
// row by the base bake), so it must NOT also go through the oversize atk sheet
// — that would render the blade twice. It uses the contained base slash, which
// is the right scale for a small blade anyway.
const NORMAL_ATTACK_WEAPONS = new Set(['Dagger', 'Club']);
const ATK_FRAME       = 192;          // frame size in atk sheet
const ATK_COLS        = 8;            // max frames per row (thrust = 8)
const ATK_ROW_COUNT   = 8;            // 4 slash dirs + 4 thrust dirs
const ATK_W           = ATK_COLS      * ATK_FRAME; // 1536
const ATK_H           = ATK_ROW_COUNT * ATK_FRAME; // 1536
const CHAR_OFFSET     = (ATK_FRAME - FRAME) / 2;   // 64 — character body centered in 192 frame
// Maps anim name → starting row in atk sheet + how many frames it uses
const ATK_ANIM_LAYOUT = {
  slash:  { startRow: 0, frames: 6 }, // rows 0..3
  thrust: { startRow: 4, frames: 8 }, // rows 4..7
};

// ─── Scan all weapon def JSONs, build name→def map ───────────────────────────
function scanWeaponDefs(dir) {
  const map = {};
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      Object.assign(map, scanWeaponDefs(full));
    } else if ((e.name.startsWith('weapon_') || e.name.startsWith('tool_')) && e.name.endsWith('.json')) {
      // weapon_*.json (sheet_definitions/weapons) AND tool_*.json
      // (sheet_definitions/tools) — the latter is how LPC ships the two-handed
      // "Smash" great-axe / "Thrust" etc. that we use as melee weapons.
      try {
        const def = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (def.name) map[def.name] = def;
      } catch (_) { /* skip malformed */ }
    }
  }
  return map;
}
const TDEFS = path.join(LPC_BASE, 'sheet_definitions/tools');
const WEAPON_DEFS = { ...scanWeaponDefs(WDEFS), ...scanWeaponDefs(TDEFS) };

// ─── Helpers ─────────────────────────────────────────────────────────────────
function exists(p) { try { fs.accessSync(p); return true; } catch (_) { return false; } }

// Returns layer-path string for this body-type, falling back to male.
function layerPath(layerDef, bodyType) {
  return layerDef[bodyType] || layerDef['male'] || layerDef['female'] || null;
}

// Stable string hash (FNV-1a) for deterministic per-variant choices.
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Pick a weapon variant (colour) name.
//  - Single-variant weapons (longsword, saber, mace, …): the only option.
//  - Multi-variant weapons (arming sword has 8 metal colours): pick a VARIED
//    colour deterministically from the variant id so blades aren't all the
//    same as the armour. Avoid an iron blade on iron armour (low contrast /
//    hard to see).
// Some multi-variant items must lock to ONE head (the "Smash" tool ships
// axe/hammer/pickaxe — the barbarian uses only the axe).
const WEAPON_VARIANT_LOCK = { Smash: 'axe', Glowsword: 'blue' };
function pickVariant(def, variant) {
  const list = def.variants || [];
  // Whip ships a single flat whip.png (no colour variants) — use it directly so
  // processVariant doesn't skip the weapon.
  if (def.name === 'Whip') return 'whip';
  if (!list.length) return null;
  // A per-variant weaponColor wins over the global lock so the atk swing matches
  // the carried art — e.g. the Miner's Smash locked to 'pickaxe' (vs the
  // barbarian's 'axe'), or the Cheater's red/blue Glowsword.
  if (variant.weaponColor && list.includes(variant.weaponColor)) return variant.weaponColor;
  const lock = WEAPON_VARIANT_LOCK[def.name];
  if (lock && list.includes(lock)) return lock;
  if (list.length === 1) return list[0];
  const metal = (variant.metalColor || '').toLowerCase();
  let candidates = list.slice();
  if (metal === 'iron') {
    const noIron = candidates.filter(v => v.toLowerCase() !== 'iron');
    if (noIron.length) candidates = noIron;
  }
  return candidates[hashStr(variant.id + def.name) % candidates.length];
}

// Extract all layer_N entries from a def, sorted by zPos ascending.
function getLayers(def) {
  const layers = [];
  for (const key of Object.keys(def)) {
    if (/^layer_\d+$/.test(key)) {
      layers.push({ key, ...def[key] });
    }
  }
  layers.sort((a, b) => (a.zPos ?? 0) - (b.zPos ?? 0));
  return layers;
}

// ─── Build a composite strip for one oversize layer ──────────────────────────
// Returns array of {input: Buffer, top, left} entries to be placed in the 832×1856 canvas.
async function oversizeComposites(srcPath, customAnim) {
  const cfg = OVERSIZE[customAnim];
  if (!cfg) return [];
  const targetRow = ANIM_LAYOUT[cfg.targetAnim];
  if (!targetRow) return [];
  if (!exists(srcPath)) return [];

  const fs_size  = cfg.frameSize;

  const meta     = await sharp(srcPath).metadata();
  const srcCols  = Math.floor(meta.width  / fs_size);
  const srcRows  = Math.floor(meta.height / fs_size);
  const useCols  = Math.min(srcCols, targetRow.frames);
  const useRows  = Math.min(srcRows, targetRow.dirRows);

  const ops = [];
  for (let row = 0; row < useRows; row++) {
    for (let col = 0; col < useCols; col++) {
      // Scale the full oversize frame down to 64×64 so the entire weapon arc
      // is visible. Center-cropping clips the weapon during swing frames where
      // it extends beyond the center 64px area.
      const buf = await sharp(srcPath)
        .extract({
          left:   col * fs_size,
          top:    row * fs_size,
          width:  fs_size,
          height: fs_size,
        })
        .resize(FRAME, FRAME, { kernel: sharp.kernel.nearest })
        .toBuffer();
      ops.push({
        input: buf,
        top:   targetRow.y + row * FRAME,
        left:  col * FRAME,
      });
    }
  }
  return ops;
}

// ─── Build composites for one layer of a weapon def ──────────────────────────
async function layerComposites(layerDef, def, variantFile, bodyType) {
  const lp = layerPath(layerDef, bodyType);
  if (!lp) return [];

  const ops = [];

  if (layerDef.custom_animation) {
    // Skip ALL oversize layers from the main sheet — they always create a
    // scaled-down "ghost" weapon next to the standard-size one. Every weapon
    // that ships an oversize layer also ships a standard 64×64 layer for
    // walk/hurt/etc. (e.g. bows have walk + walk_128, Katana has walk + slash_128),
    // so the main sheet still gets the full-size weapon via the standard path.
    // Slash/thrust oversize go exclusively to the atk sheet.
    return ops;
  } else {
    // Standard animations: file is at {SHEETS}/{lp}{anim}/{variantFile}.png
    const aliases = ANIM_ALIASES[def.name] ?? {};
    for (const anim of (def.animations || [])) {
      if (anim in OVERSIZE) continue; // skip oversize anim names in standard loop
      const targetRow = ANIM_LAYOUT[anim];
      if (!targetRow) continue; // anim not in our sheet (combat, backslash_128, …)
      const srcPath = path.join(SHEETS, lp, anim, variantFile + '.png');
      if (!exists(srcPath)) continue;
      ops.push({ input: srcPath, top: targetRow.y, left: 0 });
      // Apply to aliased row too (e.g. crossbow thrust → also shoot row).
      const aliasAnim = aliases[anim];
      if (aliasAnim) {
        const aliasRow = ANIM_LAYOUT[aliasAnim];
        if (aliasRow) ops.push({ input: srcPath, top: aliasRow.y, left: 0 });
      }
    }
  }
  return ops;
}

// ─── Attack-sheet layer composites ───────────────────────────────────────────
// Returns {input, top, left} entries to be placed on the 1536×1536 atk canvas.
// Oversize weapon frames are placed at full native resolution (or upscaled to
// 192) so the entire swing arc is visible. Standard 64×64 weapon frames are
// centered in their 192×192 cell with CHAR_OFFSET margin on each side so the
// weapon has room to extend past the character body.
async function atkLayerOps(layerDef, def, variantFile, bodyType) {
  const lp = layerPath(layerDef, bodyType);
  if (!lp) return [];

  const ops = [];

  // "Whip" (LPC Tool Whip): a flat 192px oversize sheet (the whip-crack, 8
  // frames × 4 dirs) with no declared custom_animation. Treat it as a
  // thrust-overlay attack — composite its native 192 frames into the atk thrust
  // rows. (No walk-carry art exists, so the whip only appears during the attack.)
  if (def.name === 'Whip') {
    const srcPath = path.join(SHEETS, lp, 'whip.png');
    if (!exists(srcPath)) return ops;
    const fs_size = 192;
    const animLayout = ATK_ANIM_LAYOUT.thrust;
    const meta = await sharp(srcPath).metadata();
    const useCols = Math.min(Math.floor(meta.width / fs_size), animLayout.frames);
    const useRows = Math.min(Math.floor(meta.height / fs_size), 4);
    for (let row = 0; row < useRows; row++) {
      for (let col = 0; col < useCols; col++) {
        const buf = await sharp(srcPath).extract({ left: col * fs_size, top: row * fs_size, width: fs_size, height: fs_size }).toBuffer();
        ops.push({ input: buf, left: col * ATK_FRAME, top: (animLayout.startRow + row) * ATK_FRAME });
      }
    }
    return ops;
  }

  if (layerDef.custom_animation) {
    // The atk sheet carries exactly ONE slash + ONE thrust animation. Some
    // weapons ship multiple slash variants that all map to the 'slash' row —
    // e.g. the longsword has slash_oversize AND slash_reverse_oversize (a
    // backhand return swing). Compositing both overlaps two blades in every
    // frame (the "multiple swords not lining up" bug). Use only the primary
    // forward slash; skip the reverse variant.
    if (layerDef.custom_animation === 'slash_reverse_oversize') return ops;
    const cfg = OVERSIZE[layerDef.custom_animation];
    if (!cfg) return ops;
    const animLayout = ATK_ANIM_LAYOUT[cfg.targetAnim];
    if (!animLayout) return ops; // walk_128 etc. — atk sheet only carries slash/thrust

    const srcPath = path.join(SHEETS, lp, variantFile + '.png');
    if (!exists(srcPath)) return ops;

    const meta    = await sharp(srcPath).metadata();
    const fs_size = cfg.frameSize;
    const useCols = Math.min(Math.floor(meta.width  / fs_size), animLayout.frames);
    const useRows = Math.min(Math.floor(meta.height / fs_size), 4);

    // Place each oversize frame at its NATIVE size, centered in the 192px atk
    // cell — do NOT upscale. Every oversize frame (192 or 128) is drawn around
    // a 64px character; the atk-sheet body is also 64px (centered with
    // CHAR_OFFSET). Upscaling a 128 frame to 192 enlarges its weapon for a 96px
    // character, so the blade's base overshoots the real 64px hand → a gap
    // between hand and blade (the "missing hilt"). Centering at native size
    // keeps the 64px character-reference aligned with the body so the blade
    // connects to the hand. 192 frames are unchanged (offset 0).
    const off = (ATK_FRAME - fs_size) / 2;
    for (let row = 0; row < useRows; row++) {
      for (let col = 0; col < useCols; col++) {
        const buf = await sharp(srcPath)
          .extract({
            left:   col * fs_size,
            top:    row * fs_size,
            width:  fs_size,
            height: fs_size,
          })
          .toBuffer();
        ops.push({
          input: buf,
          left: col * ATK_FRAME + off,
          top:  (animLayout.startRow + row) * ATK_FRAME + off,
        });
      }
    }
    return ops;
  }

  // Standard 64×64 animation files. Center each 64-frame in its 192 cell so
  // long weapons (spear etc.) have CHAR_OFFSET=64px of margin to extend into.
  const aliases = ANIM_ALIASES[def.name] ?? {};
  for (const animName of (def.animations || [])) {
    if (animName in OVERSIZE) continue;

    const targetAnims = [animName];
    if (aliases[animName]) targetAnims.push(aliases[animName]);

    const srcPath = path.join(SHEETS, lp, animName, variantFile + '.png');
    if (!exists(srcPath)) continue;

    for (const targetAnim of targetAnims) {
      const animLayout = ATK_ANIM_LAYOUT[targetAnim];
      if (!animLayout) continue;

      const meta    = await sharp(srcPath).metadata();
      const useCols = Math.min(Math.floor(meta.width  / FRAME), animLayout.frames);
      const useRows = Math.min(Math.floor(meta.height / FRAME), 4);

      for (let row = 0; row < useRows; row++) {
        for (let col = 0; col < useCols; col++) {
          const buf = await sharp(srcPath)
            .extract({
              left:   col * FRAME,
              top:    row * FRAME,
              width:  FRAME,
              height: FRAME,
            })
            .toBuffer();
          ops.push({
            input: buf,
            left: col * ATK_FRAME + CHAR_OFFSET,
            top:  (animLayout.startRow + row) * ATK_FRAME + CHAR_OFFSET,
          });
        }
      }
    }
  }

  return ops;
}

// ─── Build one variant's _atk.png ────────────────────────────────────────────
// Layout: 1536×1536, 192×192 frames, 8 cols × 8 rows.
// Rows 0–3 = slash up/left/down/right (cols 0–5 used).
// Rows 4–7 = thrust up/left/down/right (cols 0–7 used).
// Each cell: behind weapon → character body (extracted from main sheet's
// matching slash/thrust frame, centered) → front weapon. Before extracting
// character bodies we dest-out the main sheet's oversize "ghost" pixels (the
// scaled-down weapon copies the main bake left in the slash/thrust rows) so
// the atk sheet doesn't show a tiny weapon next to the full-size one.
async function buildAttackSheet(charPath, def, variantFile, bodyType) {
  const transparent = {
    create: { width: ATK_W, height: ATK_H, channels: 4, background: { r:0, g:0, b:0, alpha:0 } },
  };

  const layers = getLayers(def);
  const behindLayers = layers.filter(l => (l.zPos ?? 0) < 100);
  const frontLayers  = layers.filter(l => (l.zPos ?? 0) >= 100);

  // Behind weapon ops
  const behindOps = [];
  for (const layer of behindLayers) {
    behindOps.push(...await atkLayerOps(layer, def, variantFile, bodyType));
  }

  // Character-body ops: extract slash + thrust frames from the main sheet
  // (already ghost-cleaned by processVariant) and place each centered in its
  // 192×192 atk cell.
  const charOps = [];
  for (const [animName, cfg] of Object.entries(ATK_ANIM_LAYOUT)) {
    const srcRow = ANIM_LAYOUT[animName];
    if (!srcRow) continue;
    for (let dir = 0; dir < srcRow.dirRows; dir++) {
      for (let col = 0; col < cfg.frames; col++) {
        const buf = await sharp(charPath)
          .extract({
            left:   col * FRAME,
            top:    srcRow.y + dir * FRAME,
            width:  FRAME,
            height: FRAME,
          })
          .toBuffer();
        charOps.push({
          input: buf,
          left: col * ATK_FRAME + CHAR_OFFSET,
          top:  (cfg.startRow + dir) * ATK_FRAME + CHAR_OFFSET,
        });
      }
    }
  }

  // Front weapon ops
  const frontOps = [];
  for (const layer of frontLayers) {
    frontOps.push(...await atkLayerOps(layer, def, variantFile, bodyType));
  }

  const composites = [
    ...behindOps.map(o => ({ ...o, blend: 'over' })),
    ...charOps.map(o => ({ ...o, blend: 'over' })),
    ...frontOps.map(o => ({ ...o, blend: 'over' })),
  ];

  return await sharp(transparent)
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ─── Build one variant's _walk128.png (oversize CARRY sheet) ─────────────────
// Some polearms (Dragon spear, Long spear, Trident, …) ship their walking
// carry as a 128×128 `walk_128` animation — too long to fit the 64px base
// sheet (it mangles into a stray shaft). This bakes a 128px walk sheet
// (9 frames × 4 dirs) compositing: background weapon → the base-walk BODY
// (centred in the 128 frame) → foreground weapon. The renderer swaps to this
// texture for walk/idle/run. Mirrors buildAttackSheet but at 128px for walk.
const CARRY_FRAME  = 128;
const CARRY_OFFSET = (CARRY_FRAME - FRAME) / 2; // 32 — base body centred in 128
// Weapons that actually RENDER from the 128px carry sheet at walk/idle/run.
// MUST match CARRY_WALK_WEAPONS in AdventurerRenderer.js + AdventurerAtkLoader.js.
// Two reasons a weapon lands here:
//   1. Long polearm shafts (Dragon/Long spear, Trident) that overflow the 64px
//      base walk cell.
//   2. walk_128-ONLY weapons that ship NO standard 64px walk layer — the
//      **Scimitar** and **Katana** are entirely custom_animation (walk_128 +
//      slash_128), so layerComposites() skips them from the base sheet and the
//      blade NEVER appears while walking unless we build + carry-render the
//      _walk128 sheet. (Bows / Rapier / Saber / Glowsword DO ship a standard
//      walk layer, so they walk fine in the 64px base — do NOT add those here.)
const CARRY_WALK_WEAPONS = new Set(['Dragon spear', 'Long spear', 'Trident', 'Scimitar', 'Katana']);
// Set by main() from the `--carry-only` CLI flag (see processVariant).
let CARRY_ONLY = false;
async function buildCarrySheet(charPath, def, variantFile, bodyType) {
  const walkRow = ANIM_LAYOUT['walk'];
  if (!walkRow) return null;
  const cols = walkRow.frames;   // 9
  const dirs = walkRow.dirRows;  // 4
  const W = cols * CARRY_FRAME, H = dirs * CARRY_FRAME;

  // walk_128 weapon layers, split behind (zPos < 100) / front (>= 100).
  const wlayers = getLayers(def).filter(l => l.custom_animation === 'walk_128');
  const behind  = wlayers.filter(l => (l.zPos ?? 0) < 100);
  const front   = wlayers.filter(l => (l.zPos ?? 0) >= 100);

  const weaponOps = async (list) => {
    const ops = [];
    for (const layer of list) {
      const lp = layerPath(layer, bodyType);              // ends in .../walk/
      if (!lp) continue;
      const srcPath = path.join(SHEETS, lp, variantFile + '.png');
      if (!exists(srcPath)) continue;
      const meta  = await sharp(srcPath).metadata();
      const sCols = Math.floor(meta.width  / CARRY_FRAME);
      const sRows = Math.floor(meta.height / CARRY_FRAME);
      for (let d = 0; d < Math.min(dirs, sRows); d++) {
        for (let c = 0; c < Math.min(cols, sCols); c++) {
          const buf = await sharp(srcPath)
            .extract({ left: c * CARRY_FRAME, top: d * CARRY_FRAME, width: CARRY_FRAME, height: CARRY_FRAME })
            .toBuffer();
          ops.push({ input: buf, left: c * CARRY_FRAME, top: d * CARRY_FRAME });
        }
      }
    }
    return ops;
  };

  // Base-walk body frames, centred in each 128px cell.
  const bodyOps = [];
  for (let d = 0; d < dirs; d++) {
    for (let c = 0; c < cols; c++) {
      const buf = await sharp(charPath)
        .extract({ left: c * FRAME, top: walkRow.y + d * FRAME, width: FRAME, height: FRAME })
        .toBuffer();
      bodyOps.push({ input: buf, left: c * CARRY_FRAME + CARRY_OFFSET, top: d * CARRY_FRAME + CARRY_OFFSET });
    }
  }

  const behindOps = await weaponOps(behind);
  const frontOps  = await weaponOps(front);
  if (behindOps.length === 0 && frontOps.length === 0) return null; // no carry art

  const composites = [
    ...behindOps.map(o => ({ ...o, blend: 'over' })),
    ...bodyOps.map(o => ({ ...o, blend: 'over' })),
    ...frontOps.map(o => ({ ...o, blend: 'over' })),
  ];
  return await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();
}

// ─── Process one variant ──────────────────────────────────────────────────────
async function processVariant(className, variant, idx, total) {
  const charPath = path.join(ADV, className, variant.id + '.png');
  if (!exists(charPath)) {
    console.warn(`  MISSING char PNG: ${charPath}`);
    return;
  }

  const weaponName = variant.weapon;
  const def = WEAPON_DEFS[weaponName];
  if (!def) {
    console.warn(`  No def found for weapon "${weaponName}" (${className}/${variant.id})`);
    return;
  }

  const variantFile = pickVariant(def, variant);
  if (!variantFile) {
    console.warn(`  No variant file for "${weaponName}" (${className}/${variant.id})`);
    return;
  }

  const bodyType = variant.bodyType === 'muscular' ? 'muscular'
                 : variant.bodyType === 'female'   ? 'female'
                 :                                   'male';

  const layers = getLayers(def);

  // Separate behind (zPos < 100) and front (zPos >= 100) layers
  const behindLayers = layers.filter(l => (l.zPos ?? 0) < 100);
  const frontLayers  = layers.filter(l => (l.zPos ?? 0) >= 100);

  // Build composites for each phase
  const behindComposites = [];
  for (const layer of behindLayers) {
    const ops = await layerComposites(layer, def, variantFile, bodyType);
    behindComposites.push(...ops);
  }
  const frontComposites = [];
  for (const layer of frontLayers) {
    const ops = await layerComposites(layer, def, variantFile, bodyType);
    frontComposites.push(...ops);
  }

  // Build the behind-weapons buffer (transparent base + behind weapon pixels)
  const transparent = {
    create: { width: CHAR_W, height: CHAR_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  };

  // Strip the only oversize "ghost" the BASE bake actually leaves in the main
  // sheet: walk_128 (a scaled walk copy on bows / Katana / Scimitar). The base
  // bake never composites slash/thrust oversize art into the main sheet, so
  // dest-out'ing THOSE here just erases body pixels in the slash/thrust rows —
  // which then show as missing pixels / a missing hilt in the atk sheet (which
  // reuses this body). So only strip walk_128.
  const ghostOps = [];
  for (const layer of layers) {
    if (layer.custom_animation !== 'walk_128') continue;
    const lp = layerPath(layer, bodyType);
    if (!lp) continue;
    const srcPath = path.join(SHEETS, lp, variantFile + '.png');
    if (!exists(srcPath)) continue;
    // ONLY strip if the base bake actually composited a walk_128 ghost — i.e.
    // the sheet FITS the 832-wide base (bake-lpc-variants scales/keeps it). For
    // genuinely-oversize walk_128 (dragon/long spear, ~1664px) the base SKIPS
    // it entirely (no ghost) → its carry lives in the _walk128 sheet instead, so
    // dest-out'ing here would just gouge a spear-shaped hole in the body.
    const gm = await sharp(srcPath).metadata();
    if ((gm.width || 0) > CHAR_W || (gm.height || 0) > CHAR_H) continue;
    ghostOps.push(...await oversizeComposites(srcPath, layer.custom_animation));
  }
  let charSrc = charPath;
  if (ghostOps.length > 0) {
    const ghostMask = await sharp(transparent)
      .composite(ghostOps.map(op => ({ ...op, blend: 'over' })))
      .png()
      .toBuffer();
    charSrc = await sharp(charPath)
      .composite([{ input: ghostMask, blend: 'dest-out' }])
      .png()
      .toBuffer();
  }

  if (behindComposites.length === 0 && frontComposites.length === 0 && ghostOps.length === 0) {
    // Empty base-sheet weapon composites + no ghost to strip is EXPECTED for
    // weapons whose art is exclusively oversize:
    //   • The Whip (attack-only, 192px thrust) — needs its atk sheet built below.
    //   • Oversize polearms (dragon/long spear): walk_128 carry + thrust_oversize
    //     atk, nothing in the 64px base sheet. They still need the _walk128 carry
    //     sheet AND the _atk sheet built below.
    // So only bail when there's GENUINELY nothing left to produce — no atk sheet
    // and no carry sheet. Otherwise we'd skip buildCarrySheet/buildAttackSheet and
    // leave a stale (or missing) _walk128/_atk on disk. (This was the Valkyrie
    // "phantom second spear" bug: the guard tripped, processVariant returned early,
    // and the old gouged carry sheet was never rebuilt.)
    const needsAtk   = ATK_CLASSES.has(className) && !NORMAL_ATTACK_WEAPONS.has(weaponName);
    const needsCarry = ATK_CLASSES.has(className) && CARRY_WALK_WEAPONS.has(weaponName);
    if (weaponName !== 'Whip' && !needsAtk && !needsCarry) {
      console.warn(`  No usable layers for "${weaponName}" (${className}/${variant.id})`);
      return;
    }
  }

  let behindBuf;
  if (behindComposites.length > 0) {
    behindBuf = await sharp(transparent)
      .composite(behindComposites.map(op => ({ ...op, blend: 'over' })))
      .png()
      .toBuffer();
  }

  let frontBuf;
  if (frontComposites.length > 0) {
    frontBuf = await sharp(transparent)
      .composite(frontComposites.map(op => ({ ...op, blend: 'over' })))
      .png()
      .toBuffer();
  }

  // Final composite: behind → (ghost-cleaned) character → front
  const finalComposites = [];
  if (behindBuf) finalComposites.push({ input: behindBuf, blend: 'over' });
  finalComposites.push({ input: charSrc, blend: 'over' });
  if (frontBuf)  finalComposites.push({ input: frontBuf,  blend: 'over' });

  const result = await sharp(transparent)
    .composite(finalComposites)
    .png({ compressionLevel: 6 })
    .toBuffer();

  // CARRY_ONLY mode (CLI `--carry-only`): build/refresh just the _walk128 carry
  // sheet, leaving the base vXX.png + _atk.png on disk untouched. Used to back-
  // fill carry sheets for a weapon that was newly added to CARRY_WALK_WEAPONS
  // (e.g. Scimitar) across already-baked classes WITHOUT re-compositing their
  // weapons into the base (which would double-stamp standard-walk weapons and
  // churn every locked sprite). Safe because a carry-only weapon's base never
  // changes here anyway.
  if (!CARRY_ONLY) {
    fs.writeFileSync(charPath, result);

    // Atk sheet: only for classes whose combat anim is slash/thrust AND whose
    // weapon uses an oversize swing. Normal-attack weapons (arming sword) skip
    // it so the renderer falls back to the contained base slash. Any stale atk
    // sheet (e.g. the variant's weapon changed to a normal-attack one on re-bake)
    // is removed so the loader doesn't 404 / the renderer doesn't use it.
    const atkPath = path.join(ADV, className, variant.id + '_atk.png');
    if (ATK_CLASSES.has(className) && !NORMAL_ATTACK_WEAPONS.has(weaponName)) {
      const atkBuf  = await buildAttackSheet(charPath, def, variantFile, bodyType);
      fs.writeFileSync(atkPath, atkBuf);
    } else if (exists(atkPath)) {
      fs.unlinkSync(atkPath);
    }
  }

  // Oversize CARRY sheet (_walk128.png) — for the designated carry weapons in
  // CARRY_WALK_WEAPONS, which the renderer swaps to for walk/idle/run: long
  // polearms (dragon/long spear, trident) so the shaft renders at native size,
  // AND the Scimitar (walk_128-ONLY art — no base-walk layer, so the blade is
  // invisible while walking without this sheet). Bows/Rapier/Saber ship a
  // standard walk layer and aren't in the set; the else branch cleans up any
  // stale carry file if a variant's weapon changed off a carry weapon.
  const carryPath = path.join(ADV, className, variant.id + '_walk128.png');
  if (ATK_CLASSES.has(className) && CARRY_WALK_WEAPONS.has(weaponName)) {
    const carryBuf = await buildCarrySheet(charPath, def, variantFile, bodyType);
    if (carryBuf) fs.writeFileSync(carryPath, carryBuf);
    else if (exists(carryPath)) fs.unlinkSync(carryPath);
  } else if (exists(carryPath)) {
    fs.unlinkSync(carryPath);
  }

  process.stdout.write(`\r  [${idx + 1}/${total}] ${className}/${variant.id} (${weaponName}/${variantFile})          `);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ADV, 'manifest.json'), 'utf8'));

  // Optional CLI filters (positional, '--' flags ignored for position):
  //   argv[2] = comma class list   — restrict to specific classes
  //   argv[3] = comma weapon list  — restrict to specific weapons (by manifest weapon name)
  //   --carry-only                 — build ONLY the _walk128 carry sheet (leave base + _atk alone)
  // Examples:
  //   node bake-weapons.cjs cosplay_adventurer
  //   node bake-weapons.cjs cosplay_adventurer,cartographer_scholar
  //   node bake-weapons.cjs pirate,twitch_streamer,cosplay_adventurer Scimitar --carry-only
  const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const classFilter  = (positional[0] || '').split(',').map(s => s.trim()).filter(Boolean);
  const weaponFilter = (positional[1] || '').split(',').map(s => s.trim()).filter(Boolean);
  CARRY_ONLY = process.argv.includes('--carry-only');
  if (CARRY_ONLY) console.log('CARRY-ONLY mode: building _walk128 sheets only (base + _atk untouched).');

  // Collect all work items
  const tasks = [];
  for (const [className, variants] of Object.entries(manifest.variants)) {
    if (classFilter.length && !classFilter.includes(className)) continue;
    for (const variant of variants) {
      if (weaponFilter.length && !weaponFilter.includes(variant.weapon)) continue;
      tasks.push({ className, variant });
    }
  }

  console.log(`Found ${tasks.length} variants across ${Object.keys(manifest.variants).length} classes.`);
  console.log(`Known weapon defs: ${Object.keys(WEAPON_DEFS).length}`);

  const BATCH = 8; // concurrent sharp operations
  let done = 0;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    await Promise.all(
      batch.map(({ className, variant }, j) =>
        processVariant(className, variant, i + j, tasks.length)
      )
    );
    done += batch.length;
  }

  console.log('\nDone!');
}

main().catch(err => { console.error(err); process.exit(1); });

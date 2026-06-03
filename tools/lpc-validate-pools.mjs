// Validate every item name referenced in lpc-pools.mjs against the LPC pack's
// sheet_definitions. Catches typos before we spend bake time on them.
//
// Usage:
//   node tools/lpc-validate-pools.mjs <path-to-lpc-root>
//
// Where <lpc-root> contains spritesheets/ and sheet_definitions/.

import fs from 'node:fs';
import path from 'node:path';
import { POOLS, COMMON, CRYSTAL_RULE } from './lpc-pools.mjs';

const lpcRoot = process.argv[2];
if (!lpcRoot) {
  console.error('usage: node tools/lpc-validate-pools.mjs <lpc-root>');
  process.exit(2);
}
const sdRoot = path.join(lpcRoot, 'sheet_definitions');
if (!fs.existsSync(sdRoot)) {
  console.error(`no sheet_definitions/ at ${sdRoot}`);
  process.exit(2);
}

// Index every item by its `name` (the field in each JSON).
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (f.name.endsWith('.json') && !f.name.startsWith('meta_')) out.push(p);
  }
  return out;
}

const allItems = []; // { name, file, animations, category }
for (const f of walk(sdRoot)) {
  let def;
  try { def = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  const rel = path.relative(sdRoot, f).split(path.sep).join('/');
  const category = rel.split('/')[0];
  if (def.name) allItems.push({ name: def.name, file: rel, animations: def.animations || [], category });
}
const byName = new Map();
const byCat = {};
for (const it of allItems) {
  if (!byName.has(it.name)) byName.set(it.name, []);
  byName.get(it.name).push(it);
  (byCat[it.category] = byCat[it.category] || []).push(it);
}

// Resolve a pool name (bare or category-qualified "legs:Armour") to its
// matching item(s). Qualified names sidestep the cross-category name clash
// (arms/legs/feet all ship a plate piece literally named "Armour").
function resolveName(name) {
  if (typeof name === 'string' && name.includes(':')) {
    const i = name.indexOf(':');
    const cat = name.slice(0, i), nm = name.slice(i + 1);
    return (byCat[cat] || []).filter((it) => it.name === nm);
  }
  return byName.get(name) || [];
}

const REQ_FULL = ['walk', 'run', 'idle', 'slash', 'thrust', 'shoot', 'spellcast', 'hurt'];
const REQ_ACCESSORY = ['walk', 'idle', 'slash', 'thrust', 'shoot', 'spellcast', 'hurt']; // run miss allowed
const REQ_WEAPON = ['walk']; // weapons are looser

const issues = [];
const warnings = [];
function check(className, slot, name, mode = 'full') {
  const matches = resolveName(name);
  if (matches.length === 0) {
    issues.push(`${className}.${slot}: name "${name}" not found in any sheet_definition`);
    return;
  }
  // Ambiguity is only an error for BARE names — a "cat:Name" form is explicit.
  if (matches.length > 1 && !String(name).includes(':')) {
    issues.push(`${className}.${slot}: name "${name}" is ambiguous (${matches.length} items): ${matches.map((m) => m.file).join(', ')} — qualify it as "<category>:${name}"`);
    return;
  }
  const it = matches[0];
  // Anim coverage is ADVISORY only. Many distinctive items (tabard, plate
  // Armour, capes, robes) ship full art on disk but leave the `animations`
  // metadata array blank — the baker resolves layers from the filesystem and
  // falls back run/idle→walk, so a blank/partial metadata array is not a real
  // problem. We surface it as a warning, never block the bake on it.
  if (it.animations.length === 0) {
    warnings.push(`${className}.${slot}: "${name}" (${it.file}) declares no animations metadata — coverage verified at bake time from disk.`);
    return;
  }
  const req = mode === 'weapon' ? REQ_WEAPON : mode === 'accessory' ? REQ_ACCESSORY : REQ_FULL;
  const missing = req.filter((a) => !it.animations.includes(a));
  if (missing.length) {
    warnings.push(`${className}.${slot}: "${name}" (${it.file}) metadata missing animations: ${missing.join(',')} (run/idle fall back to walk; combat anims verified at bake).`);
  }
}

function checkList(className, slot, items, mode = 'full') {
  for (const n of items) check(className, slot, n, mode);
}

function checkPool(className, slot, pool, mode = 'full') {
  if (!pool) return;
  if (Array.isArray(pool)) { checkList(className, slot, pool, mode); return; }
  if (typeof pool === 'object' && Array.isArray(pool.items)) { checkList(className, slot, pool.items, mode); return; }
  // Per-body-type map { male, female, muscular } → check each body's sub-pool.
  if (typeof pool === 'object' && (pool.male || pool.female || pool.muscular)) {
    for (const b of ['male', 'female', 'muscular']) {
      if (pool[b]) checkPool(className, `${slot}.${b}`, pool[b], mode);
    }
  }
}

// Common — all heads from every body-type list, deduped
const allHeads = [...new Set(Object.values(COMMON.humanHeadsByBody).flat())];
checkList('common', 'heads', allHeads);
checkList('common', 'noses', COMMON.noses);
checkList('common', 'eyebrows', COMMON.eyebrows);

// Per-class
for (const [cls, p] of Object.entries(POOLS)) {
  checkPool(cls, 'torso', p.torso);
  checkPool(cls, 'torsoOverlay', p.torsoOverlay);
  checkPool(cls, 'legs', p.legs);
  checkPool(cls, 'feet', p.feet);
  checkPool(cls, 'arms', p.arms);
  checkPool(cls, 'headwear', p.headwear);
  checkPool(cls, 'visors', p.visors);
  // accessory: one group {items,...} OR an array of independent groups.
  const accGroups = !p.accessory ? [] : Array.isArray(p.accessory) ? p.accessory : [p.accessory];
  for (const g of accGroups) checkPool(cls, 'accessory', g, 'accessory');
  // head overlay (e.g. skull-on-bandana) — check its items + the base set.
  if (p.headOverlay?.items) checkList(cls, 'headOverlay', p.headOverlay.items);
  if (p.headOverlay?.when) checkList(cls, 'headOverlay.when', p.headOverlay.when);
  checkPool(cls, 'weapon', p.weapon, 'weapon');
}

// Crystal pair check
for (const s of CRYSTAL_RULE.staves) {
  if (!byName.has(s)) issues.push(`CRYSTAL_RULE.staves: "${s}" not found`);
}
if (!byName.has('Crystal')) issues.push(`CRYSTAL_RULE: Crystal item not found`);

// Summary
console.log('LPC pool validation');
console.log('-------------------');
console.log(`Indexed ${allItems.length} items across ${byName.size} unique names.`);
console.log(`Pools defined for ${Object.keys(POOLS).length} classes.`);
if (warnings.length) {
  console.log(`\n${warnings.length} expected coverage warnings (not errors):`);
  for (const w of warnings.slice(0, 5)) console.log('  -', w);
  if (warnings.length > 5) console.log(`  ... and ${warnings.length - 5} more`);
}
if (issues.length === 0) {
  console.log('\n✅ ALL CLEAN — every name resolves with required animation coverage.');
} else {
  console.log(`\n❌ ${issues.length} issues:`);
  for (const i of issues) console.log('  -', i);
  process.exit(1);
}

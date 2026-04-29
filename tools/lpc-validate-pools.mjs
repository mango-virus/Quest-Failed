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
for (const it of allItems) {
  if (!byName.has(it.name)) byName.set(it.name, []);
  byName.get(it.name).push(it);
}

const REQ_FULL = ['walk', 'run', 'idle', 'slash', 'thrust', 'shoot', 'spellcast', 'hurt'];
const REQ_ACCESSORY = ['walk', 'idle', 'slash', 'thrust', 'shoot', 'spellcast', 'hurt']; // run miss allowed
const REQ_WEAPON = ['walk']; // weapons are looser

const issues = [];
const warnings = [];
function check(className, slot, name, mode = 'full') {
  if (!byName.has(name)) {
    issues.push(`${className}.${slot}: name "${name}" not found in any sheet_definition`);
    return;
  }
  const matches = byName.get(name);
  if (matches.length > 1) {
    issues.push(`${className}.${slot}: name "${name}" is ambiguous (${matches.length} items): ${matches.map((m) => m.file).join(', ')}`);
  }
  const it = matches[0];
  const req = mode === 'weapon' ? REQ_WEAPON : mode === 'accessory' ? REQ_ACCESSORY : REQ_FULL;
  const missing = req.filter((a) => !it.animations.includes(a));
  if (missing.length) {
    issues.push(`${className}.${slot}: "${name}" (${it.file}) missing animations: ${missing.join(',')}`);
  }
  // Track expected partial coverage as warning, not error
  if (mode === 'accessory' && !it.animations.includes('run')) {
    warnings.push(`${className}.${slot}: "${name}" lacks run frames (will vanish briefly while fleeing — accepted)`);
  }
}

function checkList(className, slot, items, mode = 'full') {
  for (const n of items) check(className, slot, n, mode);
}

function checkPool(className, slot, pool, mode = 'full') {
  if (!pool) return;
  if (Array.isArray(pool)) checkList(className, slot, pool, mode);
  else if (typeof pool === 'object' && Array.isArray(pool.items)) checkList(className, slot, pool.items, mode);
}

// Common
checkList('common', 'heads', COMMON.humanHeads);
checkList('common', 'noses', COMMON.noses);
checkList('common', 'eyebrows', COMMON.eyebrows);

// Per-class
for (const [cls, p] of Object.entries(POOLS)) {
  checkPool(cls, 'torso', p.torso);
  checkPool(cls, 'legs', p.legs);
  checkPool(cls, 'feet', p.feet);
  checkPool(cls, 'arms', p.arms);
  checkPool(cls, 'headwear', p.headwear);
  checkPool(cls, 'accessory', p.accessory, 'accessory');
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

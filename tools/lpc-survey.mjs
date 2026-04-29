// One-off survey: counts how many LPC sheet_definitions in each category
// expose every animation we plan to use in Quest-Failed. Run from the
// LPC repo root.
import fs from 'node:fs';
import path from 'node:path';

// Per-category required-animation filter. Body, hair, head, torso, legs, feet,
// arms, headwear are visible in every animation, so they need full coverage.
// Weapons typically only have walk + their specific attack animation drawn —
// during idle/run/non-matching-attack frames, the weapon layer simply isn't
// composited. That's acceptable; it just means weapons disappear briefly
// during idle/run. We still require walk + at least one attack-style anim
// so the weapon is visible in motion and combat.
const FULL = ['walk', 'run', 'idle', 'slash', 'thrust', 'shoot', 'spellcast', 'hurt'];
const WEAPON_MIN = ['walk']; // plus at least one of slash/thrust/shoot/spellcast (checked below)
const ATTACK_ANIMS = ['slash', 'thrust', 'shoot', 'spellcast', 'slash_128', 'slash_oversize', 'thrust_oversize', '1h_slash', '1h_backslash', '1h_halfslash'];

const REQ_BY_CAT = {
  arms: FULL,
  body: FULL,
  feet: FULL,
  hair: FULL,
  head: FULL,
  headwear: FULL,
  legs: FULL,
  torso: FULL,
  weapons: WEAPON_MIN, // additional check below
  tools: FULL,
};
const root = process.argv[2] || 'sheet_definitions';

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (f.name.endsWith('.json')) out.push(p);
  }
  return out;
}

const files = walk(root);
const byCat = {};
const totalByCat = {};
const passingFiles = [];

for (const f of files) {
  const rel = path.relative(root, f).split(path.sep).join('/');
  const cat = rel.split('/')[0];
  totalByCat[cat] = (totalByCat[cat] || 0) + 1;
  let def;
  try { def = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  const anims = def.animations || [];
  const req = REQ_BY_CAT[cat] || FULL;
  let passes = req.every((a) => anims.includes(a));
  if (passes && cat === 'weapons') {
    passes = ATTACK_ANIMS.some((a) => anims.includes(a));
  }
  if (passes) {
    byCat[cat] = (byCat[cat] || 0) + 1;
    passingFiles.push({ cat, name: def.name || rel, file: rel, anims });
  }
}

console.log('category   |  total | passes (all 8 anims)');
console.log('-----------|--------|---------------------');
for (const cat of Object.keys(totalByCat).sort()) {
  console.log(cat.padEnd(10), '|', String(totalByCat[cat]).padStart(6), '|', String(byCat[cat] || 0).padStart(6));
}
const totT = Object.values(totalByCat).reduce((a, b) => a + b, 0);
const totP = Object.values(byCat).reduce((a, b) => a + b, 0);
console.log('TOTAL      |', String(totT).padStart(6), '|', String(totP).padStart(6));

if (process.argv.includes('--list')) {
  console.log('\n--- passing items ---');
  passingFiles.sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  for (const p of passingFiles) console.log(`${p.cat.padEnd(10)}  ${p.name}`);
}

// Headless check — Orc Veteran TROPHY HUNTER classifier + claim/tier logic.
//
//   node tools/sim/orc-trophy-check.mjs
//
// Verifies: (1) the class→trophy-type classifier covers the full roster with the
// locked buckets + exclusions; (2) claim/empower stack math; (3) tier-gated
// rotation width (T1=2, T2=3, T3+=all) and the Blade innate-basic rule.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { classifyTrophy, TROPHY_BY_ID, TROPHY_TYPES } from '../../src/config/orcTrophies.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const classes = JSON.parse(readFileSync(resolve(__dir, '../../src/data/adventurerClasses.json'), 'utf8'))

let fails = 0
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fails++ } else { console.log('  ✓ ' + msg) } }

// 1) Expected buckets (locked spec). null = excluded (no trophy).
const EXPECT = {
  knight: 'blade', templar: 'heavy', pirate: 'blade', rogue: 'blade', mage: 'arcane',
  cleric: 'faith', necromancer: 'arcane', ranger: 'hunter', beast_master: 'hunter',
  barbarian: 'blade', monk: 'blade', bard: 'hunter', monster_invader: null,
  rival_boss_invader: null, cartographer_scholar: null, cosplay_adventurer: 'blade',
  loot_goblin: null, cheater: null, shadow_monarch: null, paladin: 'heavy',
  white_mage: 'faith', samurai: 'blade', black_mage: 'arcane', aldric: null,
  gladiator: 'heavy', peasant: 'blade', valkyrie: 'faith', gambler: 'blade', miner: 'blade',
}

console.log('\n[1] Classifier covers the roster with the locked buckets')
for (const c of classes) {
  const got = classifyTrophy(c)
  const exp = EXPECT[c.id]
  if (exp === undefined) { console.warn(`  ? ${c.id} not in expectation table (got ${got})`); continue }
  ok(got === exp, `${c.id} → ${got ?? 'none'} (expected ${exp ?? 'none'})`)
}

console.log('\n[2] Every non-null type has a known attack + metadata')
for (const t of TROPHY_TYPES) {
  ok(!!t.attack && !!t.label && !!t.icon, `${t.id}: attack=${t.attack} label=${t.label}`)
}

// 3) Claim / empower stack math (replicates _claimTrophy).
console.log('\n[3] Claim then empower stacks')
const boss = { trophies: {} }
const claim = (type) => { boss.trophies[type] ??= { stacks: 0 }; boss.trophies[type].stacks++ }
claim('blade'); claim('blade'); claim('arcane')
ok(boss.trophies.blade.stacks === 2, 'blade empowered to 2 stacks')
ok(boss.trophies.arcane.stacks === 1, 'arcane claimed at 1 stack')
ok(boss.trophies.heavy === undefined, 'unclaimed type absent')

// 4) Tier-gated rotation width (replicates _orcClaimedAttacks/_orcAvailableAttacks).
console.log('\n[4] Tier gating: T1=2, T2=3, T3+=all; Blade is innate')
function claimed(tr) {
  const out = [{ type: 'blade', attack: 'cleave', stacks: Math.max(1, tr.blade?.stacks ?? 0) }]
  for (const id of ['heavy', 'arcane', 'hunter', 'faith']) {
    const s = tr[id]?.stacks ?? 0
    if (s > 0) out.push({ type: id, attack: TROPHY_BY_ID[id].attack, stacks: s })
  }
  return out
}
function avail(tr, tier) {
  const all = claimed(tr).sort((a, b) => b.stacks - a.stacks)
  const cap = tier <= 1 ? 2 : tier === 2 ? 3 : all.length
  return all.slice(0, cap)
}
// Fully-stocked arsenal
const full = { blade: { stacks: 5 }, heavy: { stacks: 4 }, arcane: { stacks: 3 }, hunter: { stacks: 2 }, faith: { stacks: 1 } }
ok(avail(full, 1).length === 2, 'T1 wields 2 strongest')
ok(avail(full, 2).length === 3, 'T2 wields 3')
ok(avail(full, 4).length === 5, 'T4 wields all 5')
// No trophies claimed at all → Blade/Cleave still available
ok(claimed({}).length === 1 && claimed({})[0].attack === 'cleave', 'Blade/Cleave is the innate basic with no trophies')
ok(avail(full, 1)[0].type === 'blade', 'strongest-first ordering puts top-stack Blade first')

console.log(`\n${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAILURE(S)`}`)
process.exit(fails === 0 ? 0 : 1)

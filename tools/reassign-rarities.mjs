// One-shot rarity-rebalance script. Reads src/data/dungeonMechanics.json,
// applies the curated rarity map below (chosen by strength + uniqueness),
// and writes the file back with stable 2-space indentation.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.resolve(__dirname, '..', 'src', 'data', 'dungeonMechanics.json')

// Curated rarity by strength + uniqueness:
//   common     — mild, symmetric, stat-only
//   uncommon   — modest tactical shift
//   rare       — meaningful build/tactic change
//   epic       — strong defining effect, often a new mechanic flag
//   legendary  — game-defining, often introduces a unique system
const RARITIES = {
  // --- Original 7 ---
  taxation_of_souls:        'common',
  bloodbound:               'rare',
  gold_rush:                'common',
  undying_horde:            'rare',
  sealed_paths:             'uncommon',
  pack_synergy:             'common',     // simple ally-stack, predictable
  blood_money:              'epic',

  // --- Phase 9-1.5 ---
  hasty_architect:          'uncommon',
  great_erasure:            'legendary',
  schism:                   'rare',
  glory_hounds:             'rare',
  sworn_rivals:             'epic',
  famine_decree:            'uncommon',

  // --- Batch A ---
  gilded_demise:            'uncommon',
  pyramid_scheme:           'common',
  ransom_note:              'common',
  tax_the_living:           'common',
  tower_tax:                'common',     // single ranged proc, mild
  crusaders_curse:          'rare',

  // --- Batch B ---
  kennel_discipline:        'uncommon',
  ironhide_rite:            'rare',
  frenzy_pact:              'epic',
  last_stand_doctrine:      'rare',
  mage_hunt:                'common',     // small anti-class +/-
  vampires_toll:            'common',     // tiny symmetric +/-5%

  // --- Batch C ---
  tyrants_gaze:             'epic',
  soul_tether:              'uncommon',   // small +/- on minion death
  avengers_rite:            'uncommon',   // mild boss-fight buff/daze
  final_breath:             'legendary',

  // --- Batch D ---
  false_maps:               'epic',
  whispered_lies:           'rare',
  open_book:                'epic',
  whisperers_tongue:        'rare',

  // --- Batch E ---
  doomsday_clock:           'legendary',
  the_long_game:            'legendary',
  inquisitors_mark:         'rare',

  // --- Batch F ---
  summon_adds_i:            'uncommon',
  summon_adds_ii:           'rare',
  summon_adds_iii:          'legendary',
  drill_sergeant:           'uncommon',
  endless_garrison:         'rare',
  the_cull:                 'rare',
  trap_masons_touch:        'uncommon',
  trapsmiths_guild:         'rare',
  forbidden_workshop:       'rare',
  architects_vision:        'rare',

  // --- Batch G (boss attacks) ---
  hellfire_breath:          'rare',
  lightning_strike:         'rare',
  shockwave_slam:           'rare',
  spectral_reach:           'rare',
  dark_vortex:              'uncommon',   // pull only, no damage
  soul_drain:               'epic',
  doppelgangers:            'epic',
  petrifying_stare:         'rare',

  // --- Batch H (unique mechanics) ---
  cursed_soil:              'rare',
  sundered_floor:           'rare',
  pact_of_the_mirror:       'legendary',
  pact_of_the_cartographer: 'uncommon',   // intel + mild speed buff
  pact_of_the_jester:       'epic',
  pact_of_the_whisperer:    'rare',
  pact_of_the_brand:        'uncommon',
  pact_of_the_reaper:       'uncommon',   // single -25%/-25% per dead-room next-adv
  pact_of_the_crucible:     'legendary',

  // --- Marionette ---
  pact_of_the_marionette:   'legendary',
}

const raw  = fs.readFileSync(FILE, 'utf8')
const defs = JSON.parse(raw)

let changed = 0
const unchanged = []
const missing = []
for (const def of defs) {
  const target = RARITIES[def.id]
  if (!target) { missing.push(def.id); continue }
  if (def.rarity === target) { unchanged.push(def.id); continue }
  def.rarity = target
  changed++
}

// Reorder keys so `rarity` appears right after `tradeoffDescription` for
// readability — every entry in the file already has that ordering, the
// reassignment above preserves it.

fs.writeFileSync(FILE, JSON.stringify(defs, null, 2) + '\n', 'utf8')

const tally = {}
for (const d of defs) tally[d.rarity] = (tally[d.rarity] ?? 0) + 1

console.log(`changed:   ${changed}`)
console.log(`unchanged: ${unchanged.length}`)
console.log(`missing:   ${missing.length}`, missing.length ? missing : '')
console.log('tally:', tally)
console.log('total pacts:', defs.length)

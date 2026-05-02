// One-shot T1 minion balance pass. Reads minionTypes.json, applies the
// curated stat/unlock/cost map below, writes back. Only T1s (chain[0]) get
// changed; T2/T3 forms are left alone.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.resolve(__dirname, '..', 'src', 'data', 'minionTypes.json')

// id → { stats?, unlockLevel, goldCost }
// stats present only when we're tuning a value; null means "leave alone".
const TUNE = {
  // Lvl 1 — starter pests
  rat1:            { unlockLevel:  1, goldCost:  6 },
  slime2:          { unlockLevel:  1, goldCost:  6 },
  plant1:          { unlockLevel:  1, goldCost:  6, stats: { hp: 16, attack: 4, defense: 2, speed: 0.8 } },

  // Lvl 2 — wretches
  skeleton1:       { unlockLevel:  2, goldCost:  8 },
  mushroom1:       { unlockLevel:  2, goldCost:  8, stats: { hp: 18, attack: 4, defense: 2, speed: 0.9 } },

  // Lvl 3 — skirmishers
  goblin1:         { unlockLevel:  3, goldCost: 10 },
  slime3:          { unlockLevel:  3, goldCost: 10 },

  // Lvl 4 — brawlers
  imp1:            { unlockLevel:  4, goldCost: 12 },
  slime4:          { unlockLevel:  4, goldCost: 12 },

  // Lvl 5 — hunters
  gnoll1:          { unlockLevel:  5, goldCost: 14 },
  beholder1:       { unlockLevel:  5, goldCost: 14, stats: { hp: 18, attack: 5, defense: 1, speed: 1.1 } },

  // Lvl 6 — glass cannons
  ghost1:          { unlockLevel:  6, goldCost: 16 },
  vampire_minion1: { unlockLevel:  6, goldCost: 16, stats: { hp: 16, attack: 6, defense: 1, speed: 1.4 } },

  // Lvl 7 — heavies
  zombie1:         { unlockLevel:  7, goldCost: 18 },
  lizardman1:      { unlockLevel:  7, goldCost: 18 },

  // Lvl 8 — elites
  ent1:            { unlockLevel:  8, goldCost: 22, stats: { hp: 28, attack: 6, defense: 3, speed: 0.8 } },
  lich1:           { unlockLevel:  8, goldCost: 22, stats: { hp: 24, attack: 5, defense: 3, speed: 0.9 } },

  // Lvl 9 — champions
  orc1:            { unlockLevel:  9, goldCost: 26, stats: { hp: 28, attack: 8, defense: 3, speed: 1.0 } },
  demon1:          { unlockLevel:  9, goldCost: 28, stats: { hp: 28, attack: 8, defense: 3, speed: 1.0 } },

  // Lvl 10 — apex
  golem1:          { unlockLevel: 10, goldCost: 32, stats: { hp: 42, attack: 8, defense: 6, speed: 0.5 } },
  mimic:           { unlockLevel: 10, goldCost: 35 },
}

const raw  = fs.readFileSync(FILE, 'utf8')
const defs = JSON.parse(raw)

let changed = 0
const skipped = []
for (const def of defs) {
  const t = TUNE[def.id]
  if (!t) { skipped.push(def.id); continue }
  if (t.unlockLevel != null) def.unlockLevel = t.unlockLevel
  if (t.goldCost    != null) def.goldCost    = t.goldCost
  if (t.stats) {
    def.baseStats ??= {}
    if (t.stats.hp      != null) def.baseStats.hp      = t.stats.hp
    if (t.stats.attack  != null) def.baseStats.attack  = t.stats.attack
    if (t.stats.defense != null) def.baseStats.defense = t.stats.defense
    if (t.stats.speed   != null) def.baseStats.speed   = t.stats.speed
  }
  changed++
}

fs.writeFileSync(FILE, JSON.stringify(defs, null, 2) + '\n', 'utf8')

console.log(`tuned T1 minions: ${changed}`)
console.log(`skipped (T2/T3):  ${skipped.length}`)

// Minion balance arena — ranks minions by how much value a gold-equal squad
// delivers against a standardized adventurer wave, swept across early/mid/late
// boss levels. Drives the REAL game systems (combat + minion AI + abilities) via
// the headless harness. Two rosters:
//   * T1 SHOP minions (goldCost>0) at base tier — what's priced + unlock-ordered.
//   * FAMILY CEILINGS — each chain's final form, priced at full buy+upgrade
//     investment, so unlock order can reflect a family's potential.
//
// ⚠ LIMITATION: minions whose power is loot/disguise/trap-based are UNDER-READ —
// e.g. the mimic's signature Devour (instakill whoever LOOTS the disguised chest)
// lives in AISystem, not as a combat ability, so the arena measures it as a plain
// bruiser. Treat such units' rows as a floor, not a verdict.
//
// Boss is neutralized as a KILLER (huge HP, zero offense) so outcomes are
// attributable to the minion line, not the boss. We measure: adventurers killed,
// adventurers that escaped (leak), squad survival, and gold netted (kill drops +
// steals). Composite value/gold is transparent + tunable (weights below).
//
// Run:  node tools/sim/minionbalance.mjs            (human report)
//       node tools/sim/minionbalance.mjs --json     (machine-readable)
//       node tools/sim/minionbalance.mjs --runs 20  (override runs/cell)

import { boot, silenceConsole } from './headless.mjs'
import { buildNight, placeLoadout, runDay, openAllDoors } from './harness.mjs'
import { EventBus } from './headless.mjs'
import { createMinion, applyMinionScaling } from '../../src/entities/Minion.js'
import { upgradeCost } from '../../src/util/minionRevive.js'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url)
const mDefs  = JSON.parse(readFileSync(new URL('src/data/minionTypes.json', ROOT), 'utf8'))
const chains = JSON.parse(readFileSync(new URL('src/data/minionEvolutions.json', ROOT), 'utf8'))
const defById = Object.fromEntries(mDefs.map(d => [d.id, d]))

// ── Tunables ──────────────────────────────────────────────────────────────────
const VALUE_PER_KILL = 6     // gold-equiv of a kill BEYOND its gold drop (XP / threat removed)
const W_SURVIVE      = 0.0   // survival is folded in via avoided replacement cost, not double-paid
const args = process.argv.slice(2)
const JSON_OUT = args.includes('--json')
const CEIL_ONLY = args.includes('--ceil-only')
const T1_ONLY = args.includes('--t1-only')
const RUNS = (() => { const i = args.indexOf('--runs'); return i >= 0 ? +args[i + 1] : 14 })()
// Ceiling units cost far more than the level squad budget, so give ceilings a
// budget that buys a real squad (≈ this many units) — otherwise a lone unit vs a
// big wave just measures "did it survive", not its defensive throughput.
const CEIL_SQUAD_UNITS = 5

// Per-level config. squadGold scales with the wave so the test stays meaningful
// (a 2-unit squad vs a 20-adventurer late wave tells you nothing).
const LEVELS = [
  { name: 'early', bossLevel: 3,  day: 6,  squadGold: 60  },
  { name: 'mid',   bossLevel: 8,  day: 16, squadGold: 150 },
  { name: 'late',  bossLevel: 15, day: 34, squadGold: 320 },
]

// ── Boss neutralization (killer only — still a wall the wave must get past) ─────
function neutralizeBoss(gs) {
  const b = gs.boss; if (!b) return
  b.maxHp = 1e9; b.hp = 1e9
  b.attack = 0; b.baseAttack = 0
  if (b.stats) b.stats.attack = 0
}

// Total gold to field one unit of `rootId`'s final form at this gs's scale:
// rootGold + Σ upgradeCost along the chain. Uses the REAL cost function.
function ceilingCostAndId(gs, rootId) {
  const chain = chains[rootId]?.chain
  if (!Array.isArray(chain) || chain.length < 2) return null
  const root = defById[rootId]
  let total = root?.goldCost ?? 0
  // Walk a throwaway minion up the chain, summing each step's cost at this scale.
  const m = createMinion(root, { x: 0, y: 0 }, null, { bossLevel: gs.boss.level, dayNumber: gs.meta.dayNumber })
  let guard = 0
  while (guard++ < 6) {
    const c = upgradeCost(gs, m, mDefs, chains)
    if (c <= 0) break
    total += c
    // advance definitionId to next tier for the next step's cost calc
    const idx = chain.indexOf(m.definitionId)
    if (idx < 0 || idx + 1 >= chain.length) break
    m.definitionId = chain[idx + 1]
  }
  return { finalId: chain[chain.length - 1], cost: Math.max(1, Math.round(total)) }
}

// One arena trial: a `squadGold`-budget squad of `placeId` (priced at unitCost)
// vs the standardized day wave.
function trial(placeId, unitCost, { bossLevel, day, squadGold }) {
  const ctx = boot({ boss: 'lich' })
  const { gs, scene, grid } = ctx
  gs.boss.level = bossLevel
  gs.meta.dayNumber = day
  EventBus.emit('NIGHT_PHASE_STARTED', { day })
  buildNight(scene, gs, grid)
  neutralizeBoss(gs)

  const count = Math.max(1, Math.round(squadGold / unitCost))
  placeLoadout(scene, gs, grid, { minions: Array(count).fill(placeId) })
  openAllDoors(gs)

  const goldBefore = gs.player.gold ?? 0
  const r = runDay(ctx, { maxFrames: 14000 })
  const alive = gs.minions.filter(m => m.aiState !== 'dead').length
  return {
    count, unitCost, squadGold: count * unitCost,
    waveSize: r.waveSize, kills: r.kills, escaped: r.escaped,
    minionsAlive: alive, minionsLost: count - alive,
    goldDelta: (gs.player.gold ?? 0) - goldBefore,
  }
}

function aggregate(placeId, unitCostFn, lvl) {
  const runs = []
  for (let i = 0; i < RUNS; i++) {
    const uc = unitCostFn()          // recomputed per run (ceiling cost depends on gs scale)
    runs.push(trial(placeId, uc.cost ?? uc, lvl))
  }
  const mean = k => runs.reduce((s, x) => s + x[k], 0) / runs.length
  const kills = mean('kills'), escaped = mean('escaped'), wave = mean('waveSize')
  const alive = mean('minionsAlive'), lost = mean('minionsLost'), gold = mean('goldDelta')
  const squadGold = mean('squadGold'), count = mean('count'), unitCost = mean('unitCost')
  // Net gold-equivalent value the squad produced over the day:
  //   kills' strategic worth + economy returned − cost to replace the dead.
  const netValue = kills * VALUE_PER_KILL + gold - lost * unitCost
  const valuePerGold = netValue / Math.max(1, squadGold)
  return {
    placeId, count: +count.toFixed(1), unitCost: Math.round(unitCost), squadGold: Math.round(squadGold),
    wave: +wave.toFixed(1), kills: +kills.toFixed(2), escaped: +escaped.toFixed(2),
    survival: +(alive / Math.max(1, count)).toFixed(2),
    leak: +(escaped / Math.max(1, wave)).toFixed(2),
    killsPer100g: +(kills / Math.max(1, squadGold) * 100).toFixed(2),
    econPer100g: +(gold / Math.max(1, squadGold) * 100).toFixed(2),
    valuePerGold: +valuePerGold.toFixed(3),
  }
}

// ── Roster ──────────────────────────────────────────────────────────────────
const T1 = mDefs.filter(d => (d.goldCost ?? 0) > 0).map(d => d.id)
const CEIL_ROOTS = Object.keys(chains).filter(k => k !== '_comment' && Array.isArray(chains[k]?.chain) && chains[k].chain.length >= 2)

function run() {
  const restore = silenceConsole()
  const out = { t1: {}, ceiling: {}, meta: { runs: RUNS, levels: LEVELS, valuePerKill: VALUE_PER_KILL } }
  for (const lvl of LEVELS) {
    out.t1[lvl.name] = []
    if (!CEIL_ONLY) for (const id of T1) {
      const uc = defById[id].goldCost
      out.t1[lvl.name].push({ ...aggregate(id, () => uc, lvl),
        gold: defById[id].goldCost, unlock: defById[id].unlockLevel, family: id.replace(/\d+$/, '') })
    }
    out.ceiling[lvl.name] = []
    if (!T1_ONLY) for (const root of CEIL_ROOTS) {
      // unitCost recomputed per run from a fresh gs at this level's scale
      const probe = boot({ boss: 'lich' }); probe.gs.boss.level = lvl.bossLevel; probe.gs.meta.dayNumber = lvl.day
      const ci = ceilingCostAndId(probe.gs, root)
      if (!ci) continue
      // Ceiling squads get a budget that buys ~CEIL_SQUAD_UNITS units.
      const clvl = { ...lvl, squadGold: Math.round(ci.cost * CEIL_SQUAD_UNITS) }
      out.ceiling[lvl.name].push({ ...aggregate(ci.finalId, () => {
        const p = boot({ boss: 'lich' }); p.gs.boss.level = lvl.bossLevel; p.gs.meta.dayNumber = lvl.day
        return ceilingCostAndId(p.gs, root)
      }, clvl), root, finalId: ci.finalId })
    }
  }
  restore()
  return out
}

const data = run()
if (JSON_OUT) { console.log(JSON.stringify(data, null, 1)); process.exit(0) }

// ── Human report ──────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)
const padl = (s, n) => String(s).padStart(n)
function table(rows, cols) {
  console.log(cols.map(c => c.h.padStart(c.w)).join(' '))
  for (const r of rows) console.log(cols.map(c => padl(c.f(r), c.w)).join(' '))
}
const COLS = [
  { h: 'minion', w: 16, f: r => r.placeId }, { h: 'g', w: 5, f: r => r.unitCost },
  { h: 'unlk', w: 4, f: r => r.unlock ?? '-' }, { h: 'cnt', w: 4, f: r => r.count },
  { h: 'wave', w: 5, f: r => r.wave }, { h: 'kills', w: 6, f: r => r.kills },
  { h: 'k/100g', w: 7, f: r => r.killsPer100g }, { h: 'surv', w: 5, f: r => r.survival },
  { h: 'leak', w: 5, f: r => r.leak }, { h: 'econ/100g', w: 9, f: r => r.econPer100g },
  { h: 'VALUE/g', w: 8, f: r => r.valuePerGold },
]
for (const lvl of LEVELS) {
  console.log(`\n========== T1 SHOP MINIONS — ${lvl.name.toUpperCase()} (bossLv${lvl.bossLevel}, day${lvl.day}, ${lvl.squadGold}g squads, ${RUNS} runs) ==========`)
  const rows = [...data.t1[lvl.name]].sort((a, b) => b.valuePerGold - a.valuePerGold)
  table(rows, COLS)
}
const CCOLS = [
  { h: 'family→final', w: 18, f: r => r.placeId }, { h: 'invest', w: 7, f: r => r.unitCost },
  { h: 'cnt', w: 4, f: r => r.count }, { h: 'wave', w: 5, f: r => r.wave },
  { h: 'kills', w: 6, f: r => r.kills }, { h: 'k/100g', w: 7, f: r => r.killsPer100g },
  { h: 'surv', w: 5, f: r => r.survival }, { h: 'leak', w: 5, f: r => r.leak },
  { h: 'econ/100g', w: 9, f: r => r.econPer100g }, { h: 'VALUE/g', w: 8, f: r => r.valuePerGold },
]
for (const lvl of LEVELS) {
  console.log(`\n========== FAMILY CEILINGS — ${lvl.name.toUpperCase()} (final form @ full buy+upgrade cost) ==========`)
  const rows = [...data.ceiling[lvl.name]].sort((a, b) => b.valuePerGold - a.valuePerGold)
  table(rows, CCOLS)
}

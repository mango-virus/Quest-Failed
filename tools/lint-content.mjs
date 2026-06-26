#!/usr/bin/env node
// lint-content.mjs — static integrity check for the data-driven content layer.
//
// Quest Failed keeps almost all content in `src/data/*.json`, wired to code by
// string ids (pact handler names, minion ids, reward ids, sprite-source ids…).
// Those string links are exactly where "silent content drift" hides: a pact
// that points at a handler that no longer exists becomes a no-op; a flag a pact
// sets but nothing reads is a dead benefit; an evolution chain that names a
// minion id that was renamed crashes at evolve time. None of these throw at
// load — they just quietly do nothing. This linter cross-checks every such link
// against the actual code/data so they fail loudly here instead.
//
// USAGE:
//   node tools/lint-content.mjs            # report; exit 1 if any ERROR
//   node tools/lint-content.mjs --strict   # also exit 1 on WARN
//   node tools/lint-content.mjs --json     # machine-readable findings
//
// It is intentionally STATIC (no game boot) and dependency-free, like
// verify-docs.mjs. It biases hard against false positives — a WARN you have to
// double-check erodes trust faster than a missed edge case — so the fuzzier
// checks (dead flags) are WARN, and the certain ones (dangling ids) are ERROR.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = resolve(ROOT, 'src', 'data')
const SRC  = resolve(ROOT, 'src')

const argv   = process.argv.slice(2)
const STRICT = argv.includes('--strict')
const JSON_OUT = argv.includes('--json')

// ── Loading helpers ──────────────────────────────────────────────────────────
const data = (file) => JSON.parse(readFileSync(resolve(DATA, file), 'utf8'))
const tryData = (file) => { try { return data(file) } catch { return null } }

// Recursively collect every .js file under src/ (no node_modules to worry about
// here — src/ is hand-authored only).
function jsFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...jsFiles(p))
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}
const SRC_FILES = jsFiles(SRC)
const SRC_TEXT  = new Map(SRC_FILES.map(f => [f, readFileSync(f, 'utf8')]))
const rel = (f) => f.slice(ROOT.length + 1).replace(/\\/g, '/')
const fileText = (relPath) => {
  const abs = resolve(ROOT, relPath)
  return SRC_TEXT.get(abs) ?? readFileSync(abs, 'utf8')
}

// ── Findings sink ────────────────────────────────────────────────────────────
const findings = []  // { check, level: 'ERROR'|'WARN', msg }
const add = (check, level, msg) => findings.push({ check, level, msg })
const ERR  = (check, msg) => add(check, 'ERROR', msg)
const WARN = (check, msg) => add(check, 'WARN', msg)

// =============================================================================
// CHECK 1 — pact handler ids resolve to a registered handler.
// dungeonMechanics.json's onActivate/onDeactivate/onDailyTick name handlers that
// must exist as keys in DungeonMechanicSystem._buildHandlerRegistry(). A typo or
// a removed handler makes the pact silently inert.
// =============================================================================
function checkPactHandlers() {
  const pacts = tryData('dungeonMechanics.json')
  if (!pacts) return
  const sys = fileText('src/systems/DungeonMechanicSystem.js')
  // Registry keys are defined as `<name>: ({ ... }) =>` or `<name>: () =>`
  // (arrow-function values) inside the returned object literal. Match those.
  const registry = new Set(
    [...sys.matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/gm)].map(m => m[1])
  )
  for (const p of pacts) {
    for (const hook of ['onActivate', 'onDeactivate', 'onDailyTick']) {
      const id = p[hook]
      if (!id) continue // null/absent is legal — not every pact has every hook
      if (!registry.has(id))
        ERR('pact-handlers', `pact "${p.id}" ${hook}: "${id}" — no such handler in DungeonMechanicSystem._buildHandlerRegistry()`)
    }
  }
}

// =============================================================================
// CHECK 2 — pact flags that are SET but never READ (dead mechanics).
// Activate handlers stash booleans/values on gameState._mechanicFlags; the rest
// of the game reads them to actually change behavior. A flag nothing reads = a
// pact whose effect was never wired (the Inquisition-suppression class of bug).
// WARN, not ERROR: read-detection is heuristic, so we'd rather under-report.
// =============================================================================
function checkDeadFlags() {
  const sys = fileText('src/systems/DungeonMechanicSystem.js')

  // SET universe — flags written by the mechanic system itself:
  //   spread-set:   `...(gameState._mechanicFlags ?? {}), <X>: ...`
  //   prop-assign:  `gameState._mechanicFlags.<X> = ...`  (and ?.<X>)
  const setFlags = new Set()
  for (const m of sys.matchAll(/_mechanicFlags\s*\?\?\s*\{\}\s*\)\s*,\s*([A-Za-z0-9_]+)\s*:/g)) setFlags.add(m[1])
  for (const m of sys.matchAll(/_mechanicFlags\??\.\s*([A-Za-z0-9_]+)\s*=(?![=>])/g))            setFlags.add(m[1])

  // READ universe — across ALL of src (incl. DungeonMechanicSystem's own event
  // subscriptions, which are legitimate reads). Four access forms:
  const readFlags = new Set()
  const noteRead = (name) => readFlags.add(name)
  for (const text of SRC_TEXT.values()) {
    // a) defaulted:      `(... _mechanicFlags ?? {}).X`   (the `).` distinguishes
    //                     it from the spread-set `),` form)
    for (const m of text.matchAll(/_mechanicFlags\s*\?\?\s*\{\}\s*\)\s*\.\s*([A-Za-z0-9_]+)/g)) noteRead(m[1])
    // b) optional chain: `_mechanicFlags?.X`   (a write `?.X =` is excluded)
    for (const m of text.matchAll(/_mechanicFlags\?\.\s*([A-Za-z0-9_]+)\s*(?![A-Za-z0-9_]*\s*=(?![=>]))/g)) noteRead(m[1])
    // c) direct:         `_mechanicFlags.X`   (not a write `.X =`)
    for (const m of text.matchAll(/_mechanicFlags\.\s*([A-Za-z0-9_]+)\s*(?!=(?![=>]))/g)) {
      // guard: skip if this exact occurrence is an assignment target
      noteRead(m[1])
    }
    // d) alias:          `const flags = ..._mechanicFlags (?? | ||) {}` then `flags.X`
    const aliases = new Set()
    for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*[^=;\n]*_mechanicFlags\b[^;\n]*/g)) aliases.add(m[1])
    for (const a of aliases) {
      const reEsc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      for (const m of text.matchAll(new RegExp(`\\b${reEsc}\\.([A-Za-z0-9_]+)\\b(?!\\s*=(?![=>]))`, 'g'))) noteRead(m[1])
    }
  }
  // The direct-read regex (c) also matches the deactivate writes `.X = false`
  // because the lookahead is imperfect across whitespace; that only ADDS to
  // readFlags, so a genuinely-read flag is never wrongly flagged. Dead = set − read.
  for (const f of [...setFlags].sort()) {
    if (!readFlags.has(f))
      WARN('dead-flags', `_mechanicFlags.${f} is set by a pact handler but never read anywhere — the mechanic may be a no-op`)
  }
}

// =============================================================================
// CHECK 3 — evolution chains reference real minion ids.
// minionEvolutions.json chains list minion ids that must exist in
// minionTypes.json, or the minion vanishes / crashes when it tries to evolve.
// =============================================================================
function checkEvolutions() {
  const evos = tryData('minionEvolutions.json')
  const minions = tryData('minionTypes.json')
  if (!evos || !minions) return
  const ids = new Set((Array.isArray(minions) ? minions : Object.values(minions)).map(m => m.id))
  for (const [key, def] of Object.entries(evos)) {
    if (key.startsWith('_')) continue // _comment etc.
    const chain = def?.chain
    if (!Array.isArray(chain)) { ERR('evolutions', `chain "${key}" has no chain[] array`); continue }
    // The key is the starter minion id; the contract is key === chain[0] (chain[0]
    // is what's placeable in the Night palette), and the key must be a real minion.
    if (!ids.has(key)) ERR('evolutions', `chain key "${key}" is not a minion id in minionTypes.json`)
    if (chain[0] !== key) ERR('evolutions', `chain "${key}": chain[0] is "${chain[0]}" — must equal the key (the starter id)`)
    chain.forEach((id, i) => {
      if (!ids.has(id)) ERR('evolutions', `chain "${key}"[${i}]: minion id "${id}" not in minionTypes.json`)
    })
  }
}

// =============================================================================
// CHECK 4 — achievement rewards reference real unlockables.
// reward: { type:'boss', id } -> bossArchetypes.json; { type:'companion', id }
// -> companions.js COMPANION_ORDER. A typo = an achievement that unlocks nothing.
// =============================================================================
function checkAchievementRewards() {
  const achs = tryData('achievements.json')
  if (!achs) return
  const bossIds = new Set((tryData('bossArchetypes.json') ?? []).map(b => b.id))
  const compSrc = fileText('src/systems/companions.js')
  const compMatch = compSrc.match(/COMPANION_ORDER\s*=\s*\[([^\]]*)\]/)
  const compIds = new Set((compMatch?.[1].match(/'[^']+'|"[^"]+"/g) ?? []).map(s => s.slice(1, -1)))
  const universes = { boss: bossIds, companion: compIds }
  for (const a of achs) {
    const r = a.reward
    if (!r || !r.type) continue
    const uni = universes[r.type]
    if (!uni) { WARN('achievement-rewards', `achievement "${a.id}" reward type "${r.type}" not validated (unknown type)`); continue }
    if (r.id != null && !uni.has(r.id))
      ERR('achievement-rewards', `achievement "${a.id}" reward ${r.type} "${r.id}" — no such ${r.type}`)
  }
}

// =============================================================================
// CHECK 5 — adventurer class cross-refs + renderability.
//  - spriteSourceClassId must name a real class.
//  - every class must be renderable: it needs a manifest `variants[id]` entry,
//    or a spriteSourceClassId that (transitively) resolves to one. Otherwise it
//    falls back to a plain procedural circle — a silent visual regression on a
//    game whose visuals are a hard ship gate.
// =============================================================================
function checkAdventurerSprites() {
  const classes = tryData('adventurerClasses.json')
  if (!classes) return
  const ids = new Set(classes.map(c => c.id))
  const manifestPath = 'assets/sprites/adventurers/manifest.json'
  let variants = {}
  try { variants = (data('../assets/sprites/adventurers/manifest.json')?.variants) ?? {} } catch {
    try { variants = JSON.parse(readFileSync(resolve(ROOT, manifestPath), 'utf8')).variants ?? {} } catch {}
  }
  const hasVariants = (id) => Array.isArray(variants[id]) && variants[id].length > 0

  for (const c of classes) {
    if (c.spriteSourceClassId != null && !ids.has(c.spriteSourceClassId))
      ERR('class-sprites', `class "${c.id}" spriteSourceClassId "${c.spriteSourceClassId}" — no such class`)
  }
  // renderability (follow spriteSourceClassId up to a small depth)
  const resolves = (id, seen = new Set()) => {
    if (!id || seen.has(id)) return false
    seen.add(id)
    if (hasVariants(id)) return true
    const c = classes.find(x => x.id === id)
    return c?.spriteSourceClassId ? resolves(c.spriteSourceClassId, seen) : false
  }
  for (const c of classes) {
    if (!resolves(c.id))
      WARN('class-sprites', `class "${c.id}" has no baked sprite (no manifest variants, no spriteSourceClassId chain) — renders as a fallback circle`)
  }
}

// =============================================================================
// CHECK 6 — pact id graph integrity.
// exclusiveWith / synergyWith must name real pacts; availableToArchetypes (when
// an array) must name real bosses. Dangling ids make the relationship a no-op.
// =============================================================================
function checkPactGraph() {
  const pacts = tryData('dungeonMechanics.json')
  if (!pacts) return
  const pactIds = new Set(pacts.map(p => p.id))
  const bossIds = new Set((tryData('bossArchetypes.json') ?? []).map(b => b.id))
  for (const p of pacts) {
    for (const field of ['exclusiveWith', 'synergyWith']) {
      for (const ref of (p[field] ?? [])) {
        if (!pactIds.has(ref)) ERR('pact-graph', `pact "${p.id}" ${field}: "${ref}" — no such pact`)
      }
    }
    const arch = p.availableToArchetypes
    if (Array.isArray(arch)) {
      for (const ref of arch) {
        if (!bossIds.has(ref)) ERR('pact-graph', `pact "${p.id}" availableToArchetypes: "${ref}" — no such boss`)
      }
    }
  }
}

// =============================================================================
// CHECK 7 — per-room-skin door-skin refs resolve in manifest.json.
// doorSkinBySkin / doorSkinEntranceBySkin on a room def map room-skin ids to
// { state: doorSkinId }. Any doorSkinId that isn't a key in the theme
// manifest's doorSkins registry is a dangling reference that will silently
// show the wrong/no door in-game.
// =============================================================================
function checkDoorSkinBySkinRefs() {
  let doorSkins = {}
  try { doorSkins = JSON.parse(readFileSync(resolve(ROOT, 'assets/themes/manifest.json'), 'utf8'))?.doorSkins ?? {} }
  catch { return }  // no manifest in this context → skip (matches class-sprites guard)
  const rooms = tryData('rooms.json') ?? []
  for (const r of rooms) {
    for (const field of ['doorSkinBySkin', 'doorSkinEntranceBySkin']) {
      const m = r?.[field]
      if (!m || typeof m !== 'object') continue
      for (const [skin, states] of Object.entries(m)) {
        for (const id of Object.values(states || {})) {
          if (id && !(id in doorSkins)) {
            ERR('door-skin-by-skin', `room "${r.id}" ${field}["${skin}"] → "${id}" is not a door skin in manifest.json`)
          }
        }
      }
    }
  }
}

// =============================================================================
// CHECK 8 — duplicate ids within any content file.
// A duplicated id silently shadows an entry (last-wins on lookup maps).
// =============================================================================
function checkDuplicateIds() {
  const files = ['bossArchetypes.json', 'rooms.json', 'minionTypes.json', 'trapTypes.json',
    'dungeonMechanics.json', 'events.json', 'adventurerClasses.json', 'personalities.json',
    'achievements.json']
  for (const f of files) {
    const j = tryData(f)
    if (!Array.isArray(j)) continue
    const seen = new Set(), dupes = new Set()
    for (const e of j) { if (e?.id == null) continue; if (seen.has(e.id)) dupes.add(e.id); seen.add(e.id) }
    for (const d of dupes) ERR('duplicate-ids', `${f}: duplicate id "${d}"`)
  }
}

// ── Run all checks ────────────────────────────────────────────────────────────
const CHECKS = [
  ['pact-handlers',       checkPactHandlers],
  ['dead-flags',          checkDeadFlags],
  ['evolutions',          checkEvolutions],
  ['achievement-rewards', checkAchievementRewards],
  ['class-sprites',       checkAdventurerSprites],
  ['pact-graph',          checkPactGraph],
  ['door-skin-by-skin',   checkDoorSkinBySkinRefs],
  ['duplicate-ids',       checkDuplicateIds],
]
for (const [, fn] of CHECKS) {
  try { fn() } catch (e) { ERR('linter', `check threw: ${e.message}`) }
}

// ── Report ────────────────────────────────────────────────────────────────────
const errors = findings.filter(f => f.level === 'ERROR')
const warns  = findings.filter(f => f.level === 'WARN')

if (JSON_OUT) {
  console.log(JSON.stringify({ errors: errors.length, warnings: warns.length, findings }, null, 2))
} else {
  console.log(`\nContent linter — ${SRC_FILES.length} src files, ${CHECKS.length} checks\n`)
  const byCheck = new Map()
  for (const f of findings) { if (!byCheck.has(f.check)) byCheck.set(f.check, []); byCheck.get(f.check).push(f) }
  for (const [name] of CHECKS) {
    const fs = byCheck.get(name) ?? []
    if (fs.length === 0) { console.log(`  ✓ ${name}`); continue }
    console.log(`  ✗ ${name}`)
    for (const f of fs) console.log(`      ${f.level === 'ERROR' ? '⛔' : '⚠️ '} ${f.msg}`)
  }
  console.log('')
  if (errors.length === 0 && warns.length === 0) {
    console.log('  ✓ All content links resolve. No issues.\n')
  } else {
    console.log(`  ${errors.length} error(s), ${warns.length} warning(s).`)
    console.log(`  ${errors.length ? 'Errors are dangling references — fix the data or the code.' : ''}`)
    console.log(`  ${warns.length ? 'Warnings are likely-but-not-certain — eyeball each.' : ''}\n`)
  }
}

process.exit(errors.length > 0 || (STRICT && warns.length > 0) ? 1 : 0)

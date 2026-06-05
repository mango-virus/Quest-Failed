// ─────────────────────────────────────────────────────────────────────────────
// Runtime invariant checks  (window.__qfInvariants / window.__qfCheck)
//
// Quest Failed is a long-running stochastic simulation: bugs often surface as
// quietly-corrupt state many days after the cause (a stale absolute timestamp
// that freezes an entity on Continue, an entity left in two lists at once, a
// Phaser object that snuck into the JSON-only gameState and breaks the next
// save). Screenshots and eyeballing don't catch those. This module asserts a
// set of cheap invariants at every phase transition and screams — with a path
// to the offender — the instant one breaks, instead of 20 days later.
//
// Design: the heavy lifting is a PURE function `checkGameState(gs)` returning a
// list of {severity,msg}. `installDevInvariants(scene)` is a thin wrapper that
// wires it to EventBus phase events. Keeping the core pure means it can be unit-
// tested in Node against mock state (good vs. deliberately-corrupt) with no
// browser — the same "prove it actually fires" discipline as the content linter.
//
// Dev-only: installed alongside the __qfDev sandbox (cheat-name / localhost
// gated). It NEVER throws into the game — every check is isolated.
// ─────────────────────────────────────────────────────────────────────────────

import { EventBus } from '../systems/EventBus.js'

// HP/coords live in slightly different shapes per entity (advs+minions carry a
// `resources` bag; the boss carries hp/maxHp directly). Read both.
const hpOf    = (e) => e?.resources?.hp    ?? e?.hp
const maxHpOf = (e) => e?.resources?.maxHp ?? e?.maxHp
const HP_TOL  = 0.51   // allow rounding slop before flagging hp > maxHp

// ── Entity sanity (coords + hp + ids) for one list ────────────────────────────
function checkEntities(list, label, issues) {
  if (!Array.isArray(list)) return
  const seenIds = new Map()
  list.forEach((e, i) => {
    if (!e || typeof e !== 'object') { issues.push({ severity: 'error', msg: `${label}[${i}] is not an object (${e})` }); return }
    const who = e.instanceId ?? e.name ?? `#${i}`

    // ids — present + unique (a dup id means two entities collapse on lookup)
    if (e.instanceId == null) issues.push({ severity: 'warn', msg: `${label}[${i}] (${who}) has no instanceId` })
    else if (seenIds.has(e.instanceId)) issues.push({ severity: 'error', msg: `${label}: duplicate instanceId "${e.instanceId}" (indices ${seenIds.get(e.instanceId)} & ${i})` })
    else seenIds.set(e.instanceId, i)

    // coords — only flag CORRUPT (NaN/Infinity); absent is fine (not yet placed)
    for (const ax of ['worldX', 'worldY', 'tileX', 'tileY']) {
      const v = e[ax]
      if (v !== undefined && v !== null && !Number.isFinite(v))
        issues.push({ severity: 'error', msg: `${label}[${i}] (${who}) ${ax} is not finite (${v})` })
    }

    // hp — finite, not negative, not above max (+tolerance)
    const hp = hpOf(e), mhp = maxHpOf(e)
    if (hp !== undefined && hp !== null) {
      if (!Number.isFinite(hp)) issues.push({ severity: 'error', msg: `${label}[${i}] (${who}) hp is not finite (${hp})` })
      else {
        if (hp < 0) issues.push({ severity: 'error', msg: `${label}[${i}] (${who}) hp is negative (${hp})` })
        if (Number.isFinite(mhp) && mhp > 0 && hp > mhp + HP_TOL)
          issues.push({ severity: 'error', msg: `${label}[${i}] (${who}) hp ${hp} exceeds maxHp ${mhp}` })
      }
    }
  })
  return seenIds
}

// ── JSON-serializable contract walk ───────────────────────────────────────────
// GameState MUST stay plain-JSON (SaveSystem rehydrates from JSON). A function,
// a class instance (Phaser object, Map, Set, Date…), a BigInt, or a circular ref
// all violate that and corrupt saves. Walk and report the PATH to each offender.
// Cycle detection uses the ANCESTOR stack (not a global visited set) so legitimate
// shared references aren't mistaken for cycles. Node-budgeted so it can't hang.
function walkSerializable(root, issues, budget = 300000) {
  const ancestors = new Set()
  let nodes = 0, reported = 0, truncated = false
  const MAX_REPORT = 20

  function ctorName(v) { try { return v?.constructor?.name || 'object' } catch { return 'object' } }
  function report(sev, msg) { if (reported < MAX_REPORT) { issues.push({ severity: sev, msg }); reported++ } }

  function walk(v, path) {
    if (truncated) return
    if (++nodes > budget) { truncated = true; report('warn', `serializable walk truncated at ${budget} nodes (not a failure — state is large)`); return }
    const t = typeof v
    if (v === null || t === 'string' || t === 'boolean' || t === 'number' || v === undefined) return
    if (t === 'function') { report('error', `non-serializable function at ${path}`); return }
    if (t === 'bigint')   { report('error', `non-serializable bigint at ${path}`); return }
    if (t === 'symbol')   { report('error', `non-serializable symbol at ${path}`); return }
    if (t === 'object') {
      if (ancestors.has(v)) { report('error', `circular reference at ${path}`); return }
      const proto = Object.getPrototypeOf(v)
      if (Array.isArray(v)) {
        ancestors.add(v)
        for (let i = 0; i < v.length && !truncated; i++) walk(v[i], `${path}[${i}]`)
        ancestors.delete(v)
        return
      }
      // plain object: prototype is Object.prototype or null
      if (proto === Object.prototype || proto === null) {
        ancestors.add(v)
        for (const k of Object.keys(v)) { if (truncated) break; walk(v[k], path ? `${path}.${k}` : k) }
        ancestors.delete(v)
        return
      }
      // anything else is a class instance — not plain JSON. Don't recurse into it.
      report('error', `non-plain ${ctorName(v)} instance at ${path} — gameState must be plain JSON`)
    }
  }
  walk(root, '')
}

// ── The pure check ────────────────────────────────────────────────────────────
export function checkGameState(gs, opts = {}) {
  const issues = []
  if (!gs || typeof gs !== 'object') { issues.push({ severity: 'error', msg: 'gameState is missing or not an object' }); return issues }

  // economy
  const gold = gs.player?.gold
  if (gold !== undefined) {
    if (!Number.isFinite(gold)) issues.push({ severity: 'error', msg: `player.gold is not finite (${gold})` })
    else if (gold < 0)          issues.push({ severity: 'error', msg: `player.gold is negative (${gold})` })
  }

  // entities
  const activeIds = checkEntities(gs.adventurers?.active, 'adventurers.active', issues)
  checkEntities(gs.minions, 'minions', issues)

  // an adventurer must not be both alive (active) and dead (graveyard)
  const grave = gs.adventurers?.graveyard
  if (activeIds && Array.isArray(grave)) {
    for (const g of grave) {
      if (g?.instanceId != null && activeIds.has(g.instanceId))
        issues.push({ severity: 'error', msg: `adventurer "${g.instanceId}" is in BOTH active and graveyard` })
    }
  }

  // boss
  const b = gs.boss
  if (b && typeof b === 'object') {
    const hp = hpOf(b), mhp = maxHpOf(b)
    if (hp !== undefined && !Number.isFinite(hp)) issues.push({ severity: 'error', msg: `boss.hp is not finite (${hp})` })
    else if (Number.isFinite(hp) && hp < 0)       issues.push({ severity: 'error', msg: `boss.hp is negative (${hp})` })
    if (Number.isFinite(hp) && Number.isFinite(mhp) && mhp > 0 && hp > mhp + HP_TOL)
      issues.push({ severity: 'error', msg: `boss.hp ${hp} exceeds maxHp ${mhp}` })
  }

  // serializable contract
  if (opts.serializable !== false) walkSerializable(gs, issues, opts.maxNodes)

  return issues
}

// ── Listener-leak heuristic (needs cross-call history) ────────────────────────
// A scene.restart() that re-runs create() without a matching shutdown leaks
// EventBus subscriptions. Total listener count should oscillate, not climb
// forever. Strictly-increasing over several checks is the leak signature.
function trackListeners(history, issues) {
  let total = 0
  for (const ls of Object.values(EventBus._listeners || {})) total += ls.length
  const h = history.totals || (history.totals = [])
  h.push(total)
  if (h.length > 6) h.shift()
  if (h.length >= 5 && h.every((v, i) => i === 0 || v > h[i - 1]))
    issues.push({ severity: 'warn', msg: `EventBus listener count strictly increasing over ${h.length} checks (${h.join('→')}) — possible listener leak` })
}

// ── Install (thin wrapper) ────────────────────────────────────────────────────
export function installDevInvariants(scene) {
  const gs = () => scene?.gameState ?? scene?._gameState
  const state = { enabled: true, runs: 0, lastIssues: [], verbose: true, history: {} }

  function run(label) {
    if (!state.enabled) return []
    let issues
    try { issues = checkGameState(gs()) }
    catch (e) { issues = [{ severity: 'error', msg: `invariant check threw: ${e?.message ?? e}` }] }
    try { trackListeners(state.history, issues) } catch {}
    state.runs++
    state.lastIssues = issues
    reportIssues(label, issues, state.verbose)
    return issues
  }

  const EVENTS = ['NIGHT_PHASE_STARTED', 'DAY_PHASE_STARTED', 'BOSS_FIGHT_RESOLVED', 'GAME_STATE_LOADED']
  const wired = EVENTS.map(ev => { const h = () => run(ev); EventBus.on(ev, h); return [ev, h] })

  const api = {
    check: () => run('manual'),
    enable()  { state.enabled = true;  console.log('[qfInvariant] enabled') },
    disable() { state.enabled = false; console.log('[qfInvariant] disabled') },
    get last() { return state.lastIssues },
    state,
    uninstall() { wired.forEach(([ev, h]) => EventBus.off(ev, h)); try { delete window.__qfInvariants; delete window.__qfCheck } catch {} },
  }
  try { window.__qfInvariants = api; window.__qfCheck = api.check } catch {}
  console.log('[qfInvariant] runtime invariant checks armed (phase transitions) — run window.__qfCheck() any time')
  return api
}

function reportIssues(label, issues, verbose) {
  const errs  = issues.filter(i => i.severity === 'error')
  const warns = issues.filter(i => i.severity === 'warn')
  if (errs.length === 0 && warns.length === 0) {
    if (verbose) console.debug(`[qfInvariant] ✓ ${label} — state OK`)
    return
  }
  console.error(`[qfInvariant] ✗ ${label} — ${errs.length} error(s), ${warns.length} warning(s):`)
  for (const e of errs)  console.error('  ⛔', e.msg)
  for (const w of warns) console.warn('  ⚠️', w.msg)
}

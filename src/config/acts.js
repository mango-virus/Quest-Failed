// "The Kingdom's Reckoning" — act-based run structure (KR P1: the framework).
//
// A run is a 4-act campaign: Act I + IV are FIXED narrative bookends, Acts II &
// III are DRAFTED from the Kingdom Responses pool (KR P4). This module is the
// pure config + day↔act math + feature flag. The runtime state machine that
// fires act transitions lives in src/systems/ActSystem.js.
//
// The campaign is now LIVE by default (isActsEnabled below); the old endless
// game is still reachable with `?acts=0` / `localStorage.acts='0'`. See DESIGN.md
// → "The Kingdom's Reckoning" and DESIGN_COVERAGE.md → KR P1–P7.

import { Balance } from './balance.js'

// ── Run mode ────────────────────────────────────────────────────────────────
// The campaign vs endless split is now a PER-RUN choice (Mode-Select screen),
// stored on `meta.mode`. Pass the live gameState and that's the source of truth:
// 'campaign' → acts on, 'endless' → acts off. With NO gameState (menus, preload,
// before a run exists) or an old save missing the field, fall back to the global
// default — campaign — with the `?acts=0` / `localStorage.acts='0'` dev escape
// hatch still honored (and `?acts=1` to force on).
export function isActsEnabled(gameState) {
  const m = gameState?.meta?.mode
  if (m === 'campaign') return true
  if (m === 'endless') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('acts') === '0') return false
    if (params.get('acts') === '1') return true
    if (localStorage.getItem('acts') === '0') return false
    return true
  } catch {
    return true
  }
}

// ── Act definitions ─────────────────────────────────────────────────────────
// Days per act (default 10 each → a 40-day campaign). Tunable.
export const ACT_DAYS = 10

// The four acts. `kind` ('fixed' | 'drafted') and `climax` ('trials' | 'raid' |
// 'duel') are the interface later phases hook into — kept here NOW (per the
// "lock the seams, not the content" plan) so the framework accommodates the
// Champion raids (KR P3), the drafted middle (KR P4), and the final duel without
// rework. Acts II & III carry a placeholder identity until KR P4 fills them in
// from the Kingdom Responses pool at draft time.
export const ACT_DEFS = [
  {
    num: 1, key: 'apprentice_trials', kind: 'fixed', climax: 'trials',
    name: 'The Apprentice Trials',
    tagline: 'You are an unproven rumor — so the academy sends its students to die on you.',
  },
  {
    num: 2, key: 'kingdom_responds', kind: 'drafted', climax: 'raid',
    name: 'The Kingdom Responds',
    tagline: 'Word has spread. The realm sends its answer.',
  },
  {
    num: 3, key: 'kingdom_responds', kind: 'drafted', climax: 'raid',
    name: 'The Kingdom Responds',
    tagline: 'They will not stop. They escalate.',
  },
  {
    num: 4, key: 'reckoning', kind: 'fixed', climax: 'duel',
    name: 'The Reckoning',
    tagline: 'The realm sends its champion. One of you ends here.',
  },
]

export const ACT_COUNT = ACT_DEFS.length          // 4
export const TOTAL_ACT_DAYS = ACT_COUNT * ACT_DAYS // 40

// ── Day ↔ act math ──────────────────────────────────────────────────────────
// All functions take the 1-based `meta.dayNumber`. Days beyond the campaign
// clamp to the final act (post-victory Endless mode lives there for now).

// Act number (1..ACT_COUNT) for a given day. day 1–10 → 1, 11–20 → 2, …
export function actForDay(day) {
  const d = Math.max(1, day | 0)
  return Math.min(ACT_COUNT, Math.floor((d - 1) / ACT_DAYS) + 1)
}

// 1-based day index WITHIN the current act (1..ACT_DAYS).
export function actDayIndex(day) {
  const d = Math.max(1, day | 0)
  return ((d - 1) % ACT_DAYS) + 1
}

// True on the final day of any act (the climax / Champion day; day 40 = the duel).
export function isActFinalDay(day) {
  return actDayIndex(day) === ACT_DAYS
}

// The act definition for an act number (clamped to the final act).
export function actDef(actNum) {
  return ACT_DEFS.find(a => a.num === actNum) ?? ACT_DEFS[ACT_DEFS.length - 1]
}

// The act definition covering a given day.
export function actDefForDay(day) {
  return actDef(actForDay(day))
}

// The Kingdom Response id governing the CURRENT act (or null) — read from live
// meta state. Used by systems that gate a deep modifier on the active act
// (e.g. TrapSystem's Betrayer trap-blackout, CombatSystem's Inquisition
// pact-suppress) without coupling to KingdomResponseSystem. Returns null when
// acts are off / no response drafted, so callers no-op safely.
export function currentActResponseId(gameState) {
  const a = gameState?.meta?.act
  return a?.responses?.[a?.current] ?? null
}

// Boss tier (1..ACT_COUNT) for an ENDLESS run — derived from the boss's LEVEL,
// not the day (endless has no acts). Tier 1 below the first threshold, then +1 per
// threshold crossed (Balance.BOSS_ENDLESS_TIER_LEVELS = the levels at which tier
// reaches 2 / 3 / 4). So the boss ascends + tiers up its abilities as it levels.
export function endlessTierForLevel(level) {
  const L = Math.max(1, level | 0)
  const th = Balance.BOSS_ENDLESS_TIER_LEVELS ?? [4, 7, 10]
  let tier = 1
  for (let i = 0; i < th.length && i < ACT_COUNT - 1; i++) if (L >= th[i]) tier = i + 2
  return Math.max(1, Math.min(ACT_COUNT, tier))
}

// The boss's current TIER — the single source for ascension form, ability scaling,
// and the visual sprite tier, in BOTH modes:
//   • CAMPAIGN: the act the run is in. Tracks meta.act.current (ActSystem sets it
//     on each clear), falling back to the day-derived act before act state exists.
//     P3 OVERTIME pins it past the nominal day range until the Champion falls, so
//     boss tier / active response / spawn dispatch don't recompute from the day.
//   • ENDLESS: no acts — derived from the boss LEVEL (endlessTierForLevel).
export function currentAct(gameState) {
  if (!isActsEnabled(gameState)) return endlessTierForLevel(gameState?.boss?.level ?? 1)
  const a = gameState?.meta?.act?.current
  if (Number.isFinite(a)) return Math.max(1, Math.min(ACT_COUNT, a))
  return actForDay(gameState?.meta?.dayNumber ?? 1)
}

// True while the run is in P3 overtime — the current (drafted) act's Champion
// survived its final day, so the act hasn't advanced and the raid re-runs each
// day until it falls. `meta.act.overtime` is set/cleared by ActSystem.
export function isActOvertime(gameState) {
  return !!gameState?.meta?.act?.overtime
}

// Per-act boss form names (T1..T4), indexed by tier.
const ASCENSION_FORMS = ['', 'Nascent', 'Risen', 'Dread', 'Ascended']

// Boss "dark ascension" state — the ONE source every UI surface (boss overview
// panel, top-bar badge, …) reads, so they never drift. `tier` (1..4) = the boss's
// current evolved form: the ACT in campaign, the LEVEL-derived tier in endless
// (currentAct handles the split). The bonuses are the CUMULATIVE surge the boss
// carries vs its tier-1 baseline (mirrors the multiplier in
// BossSystem._recomputeBossFightStats), so the panel can answer "what has
// ascending earned me" at a glance. Returns null only with no run.
export function ascensionInfo(gameState) {
  // Works in BOTH modes now: campaign tiers by act, endless tiers by boss level
  // (currentAct handles the split). Returns null only with no run/boss to read.
  if (!gameState) return null
  const tier = currentAct(gameState)   // campaign: pinned in overtime · endless: by level
  const e    = tier - 1
  const hpMul  = Math.pow(Balance.BOSS_ASCENSION_HP_MUL  ?? 1.28, e)
  const atkMul = Math.pow(Balance.BOSS_ASCENSION_ATK_MUL ?? 1.20, e)
  return {
    tier,
    form:        ASCENSION_FORMS[tier] || `Tier ${tier}`,
    ascended:    tier >= 2,          // has it ascended beyond its Act-I form?
    apex:        tier >= ACT_COUNT,  // final ascended form (T4)
    hpBonusPct:  Math.round((hpMul  - 1) * 100),
    atkBonusPct: Math.round((atkMul - 1) * 100),
  }
}

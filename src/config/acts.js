// "The Kingdom's Reckoning" — act-based run structure (KR P1: the framework).
//
// A run is a 4-act campaign: Act I + IV are FIXED narrative bookends, Acts II &
// III are DRAFTED from the Kingdom Responses pool (KR P4). This module is the
// pure config + day↔act math + feature flag. The runtime state machine that
// fires act transitions lives in src/systems/ActSystem.js.
//
// Everything is behind a feature flag (default OFF) so the current endless game
// is completely untouched until the act campaign is built out and we flip it on
// once the KR P3 vertical slice is solid. See DESIGN.md → "The Kingdom's
// Reckoning" and DESIGN_COVERAGE.md → KR P1–P7.

// ── Feature flag ────────────────────────────────────────────────────────────
// Opt-IN (mirrors HudRoot.isNewHudEnabled but defaults FALSE — this is an
// in-progress feature). `?acts=1` or `localStorage.acts='1'` turns it on;
// `?acts=0` forces it off.
export function isActsEnabled() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('acts') === '1') return true
    if (params.get('acts') === '0') return false
    return localStorage.getItem('acts') === '1'
  } catch {
    return false
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

// titleFx — shared helpers for rendering player titles with their
// visual effect (the "super special" legendary titles).
//
// Titles flow through the game as plain strings (PlayerProfile stores
// the name; the leaderboard submits it inside meta.active_title). The
// effect to apply is looked up from the achievement definition that
// granted the title — either by the achievement id (when the render
// site knows it, e.g. the in-game title chip) or by the title NAME
// (when it only has the string, e.g. a remote leaderboard row).
//
// Apply pattern at a render site:
//   import { titleFxClassByName } from './titleFx.js'
//   h('span', { className: `pix ${titleFxClassByName(title)}` }, title)
//
// The returned class string is `'qf-titlefx qf-titlefx-<fx>'` (or '' for
// a plain title). The CSS for each `qf-titlefx-<fx>` lives in styles.css.

import { AchievementSystem } from '../systems/AchievementSystem.js'

// Build the full class string for a given fx key, or '' when none.
export function titleFxClass(fx) {
  return fx ? `qf-titlefx qf-titlefx-${fx}` : ''
}

// Resolve fx from a title NAME (leaderboard rows, remote players).
export function titleFxClassByName(name) {
  const fx = AchievementSystem.getTitleFxByName?.(name) ?? null
  return titleFxClass(fx)
}

// Resolve fx from the granting achievement id (in-game title chip, where
// getActiveTitle() returns { id, name }).
export function titleFxClassById(id) {
  const fx = AchievementSystem.getTitleFxById?.(id) ?? null
  return titleFxClass(fx)
}

// ── Animated gradient BORDER ────────────────────────────────────────
// Returns `'qf-titlefx-<fx> qf-titlefx-border'` (the per-fx VAR-setting
// class + the border consumer — NOT the text-clip base class). Put this
// on a bordered title element (reward chip, title chip) so its border
// sweeps the same gradient as the title's animated word-coloring.
export function titleFxBorderClass(fx) {
  return fx ? `qf-titlefx-${fx} qf-titlefx-border` : ''
}
export function titleFxBorderClassById(id) {
  const fx = AchievementSystem.getTitleFxById?.(id) ?? null
  return titleFxBorderClass(fx)
}
export function titleFxBorderClassByName(name) {
  const fx = AchievementSystem.getTitleFxByName?.(name) ?? null
  return titleFxBorderClass(fx)
}

// ── Static per-title color (non-fx "normal" titles) ─────────────────
// Returns the hex color for a title, or null if it has none (or has an
// fx instead — fx wins). Render sites apply this as inline color +
// borderColor so the words and frame share the title's signature color.
export function titleColorById(id) {
  return AchievementSystem.getTitleColorById?.(id) ?? null
}
export function titleColorByName(name) {
  return AchievementSystem.getTitleColorByName?.(name) ?? null
}

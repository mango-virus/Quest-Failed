// motion.js — the reduced-motion source of truth (UI_POLISH_PLAN P1-4).
//
// A single `html.reduce-motion` class drives every reduced-motion CSS rule
// (the global reset in styles.css + the cinematics' injected keyframes, via
// !important duration overrides). The class is computed from the in-game
// setting folded with the OS `prefers-reduced-motion` media query, so the
// setting can override the OS in BOTH directions:
//
//   setting 'on'   → always reduced
//   setting 'off'  → never reduced (overrides an OS preference)
//   setting 'auto' → follow the OS (default)
//
// JS-driven motion that CSS can't reach (e.g. the count-up number climb)
// calls isReducedMotion() directly.

const STORE_KEY = 'qf.video.reduceMotion'

let _mql = null
function _mediaQuery() {
  if (_mql === null && typeof window !== 'undefined' && window.matchMedia) {
    _mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Re-apply when the OS preference flips (only matters in 'auto').
    const onChange = () => applyReduceMotion()
    if (_mql.addEventListener) _mql.addEventListener('change', onChange)
    else if (_mql.addListener) _mql.addListener(onChange)   // Safari < 14
  }
  return _mql
}

function _setting() {
  try { return localStorage.getItem(STORE_KEY) || 'auto' } catch { return 'auto' }
}

/**
 * True when motion should be reduced. Reads the persisted setting by default;
 * pass an explicit value ('auto'|'on'|'off') to evaluate a draft (Settings
 * live-preview before Apply).
 */
export function isReducedMotion(setting) {
  const s = setting ?? _setting()
  if (s === 'on')  return true
  if (s === 'off') return false
  const mql = _mediaQuery()
  return !!(mql && mql.matches)
}

/** Toggle the `reduce-motion` class on <html> to match isReducedMotion(). */
export function applyReduceMotion(setting) {
  try {
    document.documentElement.classList.toggle('reduce-motion', isReducedMotion(setting))
  } catch {}
}

// Apply once at import so the class is set before the main menu (and its
// entrance animations) render — main.js imports this early.
applyReduceMotion()

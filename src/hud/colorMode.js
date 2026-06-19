// colorMode.js — accessibility color modes (UI_POLISH_PLAN P1-6).
//
// A single class on <html> drives an accessibility palette that overrides the
// semantic accent tokens GLOBALLY (title menu + in-game HUD + overlays +
// cinematics). This is deliberately SEPARATE from the aesthetic THEME
// ("dungeon palette" — `.palette-necro` / `.palette-hellfire` on #hud-root):
// accessibility is orthogonal to aesthetic taste, must apply everywhere, and
// must persist across boots.
//
//   'off'      → no override (default)
//   'cbsafe'   → colorblind-safe palette (Okabe-Ito based; the red/green pair
//                blood↔poison becomes vermillion↔teal so it stays separable
//                for the common red-green types)
//   'contrast' → high-contrast (white text, darker surfaces, brighter
//                borders + accents) for low-vision legibility
//
// The token overrides live in styles.css (html.cb-safe / html.high-contrast,
// also scoped to `#hud-root` with !important so they beat an active aesthetic
// theme's ID-specificity redefinitions). This module only toggles the class.
//
// Scope note: this pass recolors the CSS-token DOM HUD only. The in-dungeon
// canvas (unit HP bars, minimap dots, entity/status tints, VFX) reads its own
// color source (Balance / sprites / Phaser) and is a separate follow-up.

const STORE_KEY = 'qf.video.colorMode'
const CLASS_FOR = { cbsafe: 'cb-safe', contrast: 'high-contrast' }

function _setting() {
  try { return localStorage.getItem(STORE_KEY) || 'off' } catch { return 'off' }
}

/**
 * Toggle the color-mode class on <html>. Reads the persisted setting by
 * default; pass a draft value ('off'|'cbsafe'|'contrast') for the Settings
 * live-preview before Apply.
 */
export function applyColorMode(setting) {
  try {
    const mode = setting ?? _setting()
    const el = document.documentElement
    el.classList.remove('cb-safe', 'high-contrast')
    const cls = CLASS_FOR[mode]
    if (cls) el.classList.add(cls)
  } catch {}
}

// Apply once at import so the palette is set before the main menu renders —
// main.js imports this early (alongside motion.js).
applyColorMode()

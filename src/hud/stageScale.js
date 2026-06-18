// stageScale — HUD UI-scale + native-resolution stage sizing.
//
// The DOM HUD lives inside `#hud-stage`. We render it at the screen's NATIVE
// resolution (no fractional fit-scaling — that softened pixel art), but we DO
// apply a UI-SCALE factor so the HUD chrome is a sensible physical size on every
// monitor (otherwise a 96px bar looks tiny on a 4K screen and the play area is
// lost). The trick that keeps it crisp: the scale factor defaults to a whole
// number, and an integer CSS `zoom` is pixel-perfect (each source pixel maps to
// an N×N block — no blending).
//
// Mechanism: size the stage to `window / uiScale` and `zoom` it by `uiScale`, so
// the zoomed stage exactly fills the window. The HUD chrome inside is authored in
// px and edge-anchored, so it renders at `uiScale×` its size and stays pinned to
// the window edges. At uiScale=1 this is identical to plain native rendering.
//
//   uiScale = 1  → native (covers ~1080p–1439p)              crisp
//   uiScale = 2  → 4K etc.; chrome doubled, integer zoom      crisp
//   override     → player's Options choice (non-integer = their call)

import { userSettings } from './userSettings.js'

export const DESIGN_W = 1920
export const DESIGN_H = 1080

// The reference height the auto factor steps from. floor(screenH / REF) gives 1
// up to <2160 and 2 at 4K — i.e. "the largest whole-number scale that fits,"
// favouring crispness over filling every last pixel on in-between resolutions.
const AUTO_REF_H = 1080

let _installed = false
let _stage = null
// A live preview override (the Options panel sets this while the player tries a
// value, before APPLY persists it). null = read the saved preference.
let _previewPref = null

// Resolve a stored/preview preference ('auto' | number) to a concrete factor.
function _resolve(pref) {
  if (typeof pref === 'number') return pref
  const h = (typeof window !== 'undefined' && window.innerHeight) || AUTO_REF_H
  // Largest whole-number scale that fits — favours crispness (1 up to <2160, 2 at 4K).
  return Math.max(1, Math.floor(h / AUTO_REF_H))
}

// The effective UI-scale right now (preview override if set, else saved pref).
export function effectiveUiScale() {
  return _resolve(_previewPref != null ? _previewPref : userSettings.uiScalePref())
}

function _fit() {
  if (!_stage) _stage = document.getElementById('hud-stage')
  if (!_stage) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const s = effectiveUiScale()
  // Size the stage to window/scale, then zoom by scale → the zoomed box exactly
  // fills the window. Integer `zoom` keeps pixel art crisp; the HUD's edge-anchored
  // chrome reflows to the (window/scale) logical size and renders at scale×.
  _stage.style.left = '0'
  _stage.style.top = '0'
  _stage.style.right = 'auto'
  _stage.style.bottom = 'auto'
  _stage.style.width = (vw / s) + 'px'
  _stage.style.height = (vh / s) + 'px'
  _stage.style.zoom = s === 1 ? '' : String(s)
  // Expose the live scale so other systems (camera framing, hit-testing) can read
  // it if they need to convert between logical HUD px and device px.
  document.documentElement.style.setProperty('--ui-scale', String(s))
}

// Call once when any DOM overlay mounts into #hud-stage. Installs the resize
// listener the first time and applies the current scale immediately. Idempotent.
export function ensureStageScaled() {
  if (!_stage) _stage = document.getElementById('hud-stage')
  if (!_stage) return
  if (!_installed) {
    window.addEventListener('resize', () => _fit())
    _installed = true
  }
  const root = document.getElementById('hud-root')
  if (root) root.hidden = false
  _fit()
}

// Re-apply the scale immediately so it takes effect without a reload. Pass a
// preview preference ('auto' | number) to live-preview a value before it's
// saved; pass null (or nothing) to clear the preview and read the saved setting.
export function applyUiScale(previewPref = null) {
  _previewPref = previewPref
  _fit()
}

// For HudRoot's destroy path — the stage stays in the DOM either way.
export function teardownStageScale() {
  // Intentionally a no-op (the resize listener is shared & idempotent).
}

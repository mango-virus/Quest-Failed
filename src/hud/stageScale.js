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
// DEV resolution-test simulator (set via setSimStage). When non-null, _fit()
// forces the stage to this logical size + uiScale and letterbox-fits it into the
// real window via transform:scale — so any target resolution (720p…4K…ultrawide)
// can be laid out + inspected on the current monitor. Not crisp (it's a sim of
// LAYOUT/anchoring, not pixels); clear with clearSimStage().
let _simStage = null   // { w, h, uiScale } | null

// Resolve a stored/preview preference ('auto' | number) to a concrete factor.
function _resolve(pref) {
  if (typeof pref === 'number') return pref
  const vw = (typeof window !== 'undefined' && window.innerWidth)  || DESIGN_W
  const vh = (typeof window !== 'undefined' && window.innerHeight) || AUTO_REF_H
  // Below the design WIDTH, scale the whole HUD DOWN uniformly so the fixed
  // ~1920-wide chrome fits instead of clipping at the screen edges (Steam Deck
  // 1280×800, 720p, small laptops). A 16:9 sub-res maps exactly to a 1920×1080
  // logical stage; 16:10 (Deck) to 1920×1200. Fitting to WIDTH (not height) means
  // a windowed 1920×1040 — a maximised 1080p window minus the taskbar — stays at
  // 1× with no needless blur. Slight softness from the non-integer downscale is
  // fine on a small/low-res screen.
  if (vw < DESIGN_W) return vw / DESIGN_W
  // At/above design width: largest whole-number scale that fits — crispness first
  // (1 up to <2160, 2 at 4K).
  return Math.max(1, Math.floor(vh / AUTO_REF_H))
}

// The effective UI-scale right now (sim override > preview override > saved pref).
export function effectiveUiScale() {
  if (_simStage) return _simStage.uiScale
  return _resolve(_previewPref != null ? _previewPref : userSettings.uiScalePref())
}

// DEV — force a simulated logical stage size + uiScale (resolution test harness).
// Pass null/clear to return to native sizing. Re-fits immediately.
export function setSimStage(w, h, uiScale = 1) {
  _simStage = (w && h) ? { w, h, uiScale } : null
  _fit()
}
export function clearSimStage() { _simStage = null; _fit() }
export function getSimStage() { return _simStage }

function _fit() {
  if (!_stage) _stage = document.getElementById('hud-stage')
  if (!_stage) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  // DEV simulator branch — lay the HUD out at the forced logical size, then
  // letterbox-fit it into the real window with transform:scale (no `zoom`).
  if (_simStage) {
    const { w, h } = _simStage
    const fit = Math.min(vw / w, vh / h)
    _stage.style.zoom = ''
    _stage.style.width = w + 'px'
    _stage.style.height = h + 'px'
    _stage.style.right = 'auto'
    _stage.style.bottom = 'auto'
    _stage.style.left = ((vw - w * fit) / 2) + 'px'
    _stage.style.top = ((vh - h * fit) / 2) + 'px'
    _stage.style.transformOrigin = '0 0'
    _stage.style.transform = `scale(${fit})`
    document.documentElement.style.setProperty('--ui-scale', String(_simStage.uiScale))
    return
  }
  _stage.style.transform = ''
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

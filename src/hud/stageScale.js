// stageScale — shared 1920×1080 stage scaler.
//
// The DOM HUD lives inside a fixed 1920×1080 stage that transform-scales
// to fit the viewport. This module owns the scaling logic so any
// overlay that wants to mount into `#hud-stage` (HudRoot, MainMenuOverlay,
// future title screens) can ensure the stage is sized correctly without
// duplicating the fit math.
//
// Idempotent. Multiple callers safely share one resize listener.

export const DESIGN_W = 1920
export const DESIGN_H = 1080

let _installed = false
let _stage = null

function _fit() {
  if (!_stage) _stage = document.getElementById('hud-stage')
  if (!_stage) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const scale = Math.min(vw / DESIGN_W, vh / DESIGN_H)
  // Use CSS `zoom` (not `transform: scale()`) to size the 1920×1080 stage to the
  // window. `transform: scale()` bitmap-scales a composited layer, which softens
  // the pixel-font text at any non-1.0 factor (i.e. any window ≠ 1920×1080).
  // `zoom` instead re-lays-out and re-rasterizes the content at the scaled size,
  // so text stays crisp. Electron/Chromium support it natively. translate keeps
  // centering — its percentages resolve against the (zoomed) border box.
  _stage.style.zoom = scale
  _stage.style.transform = 'translate(-50%, -50%)'
}

// Call once when any DOM overlay mounts into #hud-stage. Installs a
// resize listener the first time and applies the current scale
// immediately.
export function ensureStageScaled() {
  if (!_stage) _stage = document.getElementById('hud-stage')
  if (!_stage) return
  if (!_installed) {
    window.addEventListener('resize', _fit)
    _installed = true
  }
  // Also make sure #hud-root is visible — code that hides it on teardown
  // would otherwise leave the stage invisible.
  const root = document.getElementById('hud-root')
  if (root) root.hidden = false
  _fit()
}

// For HudRoot's destroy path — the stage stays in the DOM either way,
// so we don't actually uninstall the resize listener. This is a
// placeholder for symmetry / future use.
export function teardownStageScale() {
  // Intentionally a no-op for now.
}

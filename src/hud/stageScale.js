// stageScale — shared HUD stage helper.
//
// The DOM HUD lives inside `#hud-stage`, which now fills the window at the
// screen's NATIVE resolution (see the `#hud-stage` rule in styles.css). We no
// longer scale a fixed 1920×1080 design with CSS `zoom` — that fractional scaling
// was what softened the pixel fonts and pixel art. Instead the HUD chrome is laid
// out fluidly (edge-anchored / flex-centered) at the real window size, so text
// and art land on the device pixel grid and stay crisp at any size.
//
// This module's API is kept (many overlays call `ensureStageScaled()` when they
// mount) but it no longer transforms the stage — it just makes sure the HUD root
// is visible. Idempotent and safe to call repeatedly.

export const DESIGN_W = 1920
export const DESIGN_H = 1080

let _stage = null

// Call when any DOM overlay mounts into #hud-stage. With the fluid layout there
// is nothing to scale; we only ensure the HUD root is shown (teardown code may
// hide it). Kept as a stable entry point for the many call sites.
export function ensureStageScaled() {
  if (!_stage) _stage = document.getElementById('hud-stage')
  // Defensive: clear any legacy inline scale left over from the old zoom-to-fit
  // approach (or a stale save) so it can't re-soften the stage.
  if (_stage && (_stage.style.zoom || _stage.style.transform)) {
    _stage.style.zoom = ''
    _stage.style.transform = ''
  }
  const root = document.getElementById('hud-root')
  if (root) root.hidden = false
}

// For HudRoot's destroy path — the stage stays in the DOM either way.
export function teardownStageScale() {
  // Intentionally a no-op.
}

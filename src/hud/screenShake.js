// screenShake.js — brief DOM screen-shake for full-screen cinematics
// (UI_POLISH_PLAN P2-2).
//
// The pure-DOM set-pieces (Dark Ascension, The Kingdom Responds, the Coin
// Flip) dim the canvas, so a Phaser CAMERA shake
// (ScreenShakeSystem / BossSystem) wouldn't be visible behind them — they lean
// on a white flash alone. This jolts the cinematic's own DOM root with a brief,
// decaying transform jitter, the same DOM-transform approach BossFightOverlay
// already uses for its HP bar.
//
// Web Animations API (el.animate) so it self-reverts — fill defaults to 'none',
// restoring whatever transform the element's CSS defines once the shake ends —
// and needs no injected CSS. Gated on BOTH the SCREEN SHAKE setting AND
// reduced-motion: JS-driven motion isn't caught by the global html.reduce-motion
// CSS reset (P1-4), so it must check isReducedMotion() explicitly.
//
// NOTE: the duels (Aldric / Rival) are deliberately NOT shaken through here —
// they already get camera-shake + hitstop from BossSystem (the dungeon view is
// visible during those fights).

import { userSettings } from './userSettings.js'
import { isReducedMotion } from './motion.js'

/**
 * Briefly shake a DOM element with a decaying random jitter.
 * @param {Element} el          the element to jolt (a full-screen cinematic root)
 * @param {number}  intensity   peak amplitude in px (default 8)
 * @param {number}  durationMs  total shake length (default 340)
 */
export function domShake(el, { intensity = 8, durationMs = 340 } = {}) {
  if (!el || typeof el.animate !== 'function') return
  let on = true, reduced = false
  try { on = userSettings.isShakeEnabled() } catch {}
  try { reduced = isReducedMotion() } catch {}
  if (!on || reduced) return

  const steps = Math.max(8, Math.round(durationMs / 32))
  const frames = []
  for (let i = 0; i <= steps; i++) {
    const decay = 1 - i / steps
    const amp = intensity * decay * decay   // quadratic ease-out so it settles, not cuts
    const dx = (Math.random() * 2 - 1) * amp
    const dy = (Math.random() * 2 - 1) * amp
    frames.push({ transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)` })
  }
  // Pin the endpoints to dead-centre so it starts/ends clean (no visible jump).
  frames[0] = { transform: 'translate(0, 0)' }
  frames[frames.length - 1] = { transform: 'translate(0, 0)' }
  try { el.animate(frames, { duration: durationMs, easing: 'linear' }) } catch {}
}

// canvasShake — jolt the WebGL game CANVAS itself (the dungeon view) with a
// decaying jitter. This is the RELIABLE screen shake: the Phaser camera-matrix
// shake (ScreenShakeSystem / cam.shake) doesn't visibly move the dungeon in the
// native-res RESIZE setup, so we shake the canvas DOM element instead. The HUD
// is a separate DOM layer (#hud-stage), so chrome stays rock-steady. Gated on
// the SCREEN SHAKE setting only — matching ScreenShakeSystem, which likewise
// doesn't fold in reduced-motion. `composite:'add'` so it stacks on top of any
// transform Phaser put on the canvas instead of clobbering it.
let _canvasShakeAnim = null
export function canvasShake(intensity = 10, durationMs = 400) {
  let on = true
  try { on = userSettings.isShakeEnabled() } catch {}
  if (!on || !(intensity > 0)) return
  const canvas = (typeof window !== 'undefined') ? window.__game?.canvas : null
  if (!canvas || typeof canvas.animate !== 'function') return
  const steps = Math.max(8, Math.round(durationMs / 28))
  const frames = []
  for (let i = 0; i <= steps; i++) {
    const decay = 1 - i / steps
    const amp = intensity * decay * decay   // quadratic ease-out so it settles
    const dx = (Math.random() * 2 - 1) * amp
    const dy = (Math.random() * 2 - 1) * amp
    frames.push({ transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)` })
  }
  frames[0] = { transform: 'translate(0,0)' }
  frames[frames.length - 1] = { transform: 'translate(0,0)' }
  try { _canvasShakeAnim?.cancel?.() } catch {}
  try { _canvasShakeAnim = canvas.animate(frames, { duration: durationMs, easing: 'linear', composite: 'add' }) } catch {}
}

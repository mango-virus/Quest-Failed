// Cheater-specific VFX helpers. Drop-in alternatives to
// AbilityVfx.floatingText / particleBurst that continuously cycle the
// element's color through the full RGB spectrum over its lifetime, so
// every cheater floater + particle burst pulses red→yellow→green→cyan→
// blue→magenta in sync with the persistent ground halo. Matches the
// "everything is glitching" aesthetic without each call site having to
// implement its own update loop.
//
// Implementation: each element is created with a neutral base (white
// tint or white fillColor) and registered with the scene's update event.
// The handler runs every frame, computes a sine-RGB triple from
// scene.time.now, and pokes the element. On element destroy the
// listener auto-removes via the `active` check.
//
// Channels are sine waves 120° apart, same math as the halo in
// AdventurerRenderer so the floaters and halo cycle through identical
// hues at the same moment.

const TWO_PI_THIRD = 2.094  // ≈ 120° in radians
const FOUR_PI_THIRD = 4.188 // ≈ 240° in radians

// Speed of the hue rotation. 0.001 → ~6 s/full cycle, matches the halo.
const CYCLE_SPEED = 0.001

function _rgbAt(timeMs, phase = 0) {
  const t = timeMs * CYCLE_SPEED + phase
  const r = Math.max(0, Math.min(255, Math.round(127 + 127 * Math.sin(t))))
  const g = Math.max(0, Math.min(255, Math.round(127 + 127 * Math.sin(t + TWO_PI_THIRD))))
  const b = Math.max(0, Math.min(255, Math.round(127 + 127 * Math.sin(t + FOUR_PI_THIRD))))
  return [r, g, b]
}

function _packRgb(r, g, b) {
  return (r << 16) | (g << 8) | b
}

// Floating text that RGB-cycles over its lifetime. Mirrors AbilityVfx's
// pop-in + drift + fade behavior but with a Phaser tint applied each
// frame so the rendered color visibly rotates as the text floats up.
// Stroke stays black so the text remains legible against any backdrop.
export function rgbFloatingText(scene, x, y, str, opts = {}) {
  if (!scene?.add || !Number.isFinite(x) || !Number.isFinite(y)) return null
  const fontSize  = opts.fontSize ?? '12px'
  const durationMs = opts.durationMs ?? 900
  const driftY   = opts.driftY ?? -28
  const depth    = opts.depth ?? 1000
  const phase    = opts.phase ?? 0

  const txt = scene.add.text(x, y, str, {
    fontSize,
    color: '#ffffff',
    fontFamily: 'monospace',
    fontStyle: 'bold',
    stroke: '#000000',
    strokeThickness: 2,
  }).setOrigin(0.5).setDepth(depth)
  txt.setScale(0.55)
  scene.tweens.add({ targets: txt, scale: 1, duration: 160, ease: 'Back.easeOut' })
  scene.tweens.add({
    targets: txt, y: y + driftY, alpha: 0,
    duration: durationMs, ease: 'Quad.easeOut',
    onComplete: () => txt.destroy(),
  })

  // Per-frame RGB poke. Auto-detaches when txt is destroyed via
  // the `active` guard.
  const updateFn = () => {
    if (!txt.active) {
      scene.events.off('update', updateFn)
      return
    }
    const [r, g, b] = _rgbAt(scene.time?.now ?? 0, phase)
    txt.setTint(_packRgb(r, g, b))
  }
  scene.events.on('update', updateFn)
  return txt
}

// Particle burst whose dots each RGB-cycle as they fly outward. Each
// particle gets its own slight phase offset (i × 0.4) so the burst
// reads as a rainbow shower rather than a monochrome ring.
export function rgbParticleBurst(scene, x, y, opts = {}) {
  if (!scene?.add || !Number.isFinite(x) || !Number.isFinite(y)) return null
  const count      = Math.max(1, opts.count ?? 10)
  const speed      = opts.speed ?? 80
  const durationMs = opts.durationMs ?? 320
  const depth      = opts.depth ?? 1000
  const created    = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
    const dist  = speed * (0.6 + Math.random() * 0.6) * (durationMs / 1000)
    const dot   = scene.add.circle(x, y, 2 + Math.random() * 1.5, 0xffffff, 0.95)
    dot.setDepth(depth)
    created.push(dot)
    const dotPhase = i * 0.4
    scene.tweens.add({
      targets: dot,
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      alpha: 0,
      duration: durationMs,
      ease: 'Quad.easeOut',
      onComplete: () => dot.destroy(),
    })
    const updateFn = () => {
      if (!dot.active) {
        scene.events.off('update', updateFn)
        return
      }
      const [r, g, b] = _rgbAt(scene.time?.now ?? 0, dotPhase)
      dot.fillColor = _packRgb(r, g, b)
    }
    scene.events.on('update', updateFn)
  }
  return created
}

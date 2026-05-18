// Phase 5b — small reusable VFX primitives for ability activations.
//
// Goal: visually impressive but not overwhelming (per design call). Each
// helper is short-lived (≤1.5s), kills itself when done, and doesn't block
// gameplay. All take a Phaser scene + world-space (x, y) as the anchor.
//
// Primitives:
//   pulseRing(scene, x, y, opts)       — expanding circle ring
//   particleBurst(scene, x, y, opts)   — small burst of particles
//   floatingText(scene, x, y, str, opts) — drifting text label
//   tintFlash(target, color, opts)     — flash tint on a sprite, then revert
//   alphaSet(target, alpha)            — instant alpha set (for invis state)
//
// Each returns the created object so callers can chain or cancel if needed.

const DEFAULTS = {
  // Tuned 2026-04-30: rings dialed way down so they don't cover LPC sprites.
  ring:    { color: 0xffe066, fromR: 4, toR: 18, alpha: 0.55, durationMs: 300, depth: 6 },
  particles: { color: 0xffe066, count: 6, durationMs: 450, depth: 6, speed: 45 },
  text:    { color: '#ffe066', fontSize: '11px', driftY: -22, durationMs: 700, depth: 11 },
  tint:    { color: 0xffffff, durationMs: 200 },
}

// Phase 5c — defensive guard. If a caller passes undefined/null/NaN
// coordinates (most often because the source adv has been removed from
// the active list and its worldX/Y is now undefined), the underlying
// Phaser draw silently lands at world (0, 0) which manifests as black
// VFX shapes flashing in the upper-left corner of the dungeon. Skip the
// draw entirely instead.
function _validXY(x, y) {
  return Number.isFinite(x) && Number.isFinite(y)
}

export const AbilityVfx = {
  pulseRing(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { ...DEFAULTS.ring, ...opts }
    const ring = scene.add.circle(x, y, o.fromR, 0x000000, 0)
    ring.setStrokeStyle(2, o.color, o.alpha)
    ring.setDepth(o.depth)
    scene.tweens.add({
      targets: ring,
      radius: o.toR,
      alpha: 0,
      duration: o.durationMs,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    })
    return ring
  },

  particleBurst(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { ...DEFAULTS.particles, ...opts }
    const created = []
    for (let i = 0; i < o.count; i++) {
      const angle = (i / o.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
      const dist = o.speed * (0.6 + Math.random() * 0.6) * (o.durationMs / 1000)
      const dot = scene.add.circle(x, y, 2 + Math.random() * 1.5, o.color, 0.95)
      dot.setDepth(o.depth)
      created.push(dot)
      scene.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        duration: o.durationMs,
        ease: 'Quad.easeOut',
        onComplete: () => dot.destroy(),
      })
    }
    return created
  },

  floatingText(scene, x, y, str, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { ...DEFAULTS.text, ...opts }
    const txt = scene.add.text(x, y, str, {
      fontSize: o.fontSize,
      color: o.color,
      fontFamily: 'monospace',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(o.depth)
    // Pop-in: start small and overshoot to 1.0 with Back.easeOut so damage
    // numbers / status labels punch in instead of drifting in linearly.
    // Runs in parallel with the drift+fade tween below — multiple tweens
    // per target are fine in Phaser.
    txt.setScale(0.55)
    scene.tweens.add({
      targets: txt,
      scale:   1,
      duration: 160,
      ease:    'Back.easeOut',
    })
    scene.tweens.add({
      targets: txt,
      y: y + o.driftY,
      alpha: 0,
      duration: o.durationMs,
      ease: 'Quad.easeOut',
      onComplete: () => txt.destroy(),
    })
    return txt
  },

  tintFlash(target, color, opts = {}) {
    if (!target || typeof target.setTint !== 'function') return null
    const o = { ...DEFAULTS.tint, color, ...opts }
    target.setTint(o.color)
    if (target.scene && target.scene.time) {
      target.scene.time.delayedCall(o.durationMs, () => {
        if (target.active && typeof target.clearTint === 'function') target.clearTint()
      })
    }
    return target
  },

  alphaSet(target, alpha) {
    if (!target) return null
    target.setAlpha?.(alpha)
    return target
  },

  // Projectile — small dot tweened from (fromX,fromY) to (toX,toY).
  // Used for ranged minion attacks (lich heal beam, ghost spook,
  // mimic snap, etc.) so range > 1 reads visually instead of damage
  // appearing instantly at the target.
  //
  // Options: color (hex), durationMs, radius, depth.
  projectile(scene, fromX, fromY, toX, toY, opts = {}) {
    if (!_validXY(fromX, fromY) || !_validXY(toX, toY)) return null
    const o = {
      color:      opts.color      ?? 0xfff0aa,
      durationMs: opts.durationMs ?? 220,
      radius:     opts.radius     ?? 3,
      depth:      opts.depth      ?? 12,
    }
    const dot = scene.add.graphics().setDepth(o.depth)
    dot.fillStyle(o.color, 1).fillCircle(0, 0, o.radius)
    dot.setPosition(fromX, fromY)
    scene.tweens.add({
      targets:  dot,
      x:        toX,
      y:        toY,
      duration: o.durationMs,
      ease:     'Sine.easeIn',
      onComplete: () => dot.destroy(),
    })
    return dot
  },
}

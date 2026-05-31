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

// Phase 34C.5 — Particles quality setting. Inline localStorage read
// instead of importing src/hud/userSettings.js to keep src/ui/ free of
// HUD dependencies. Defaults to 'high' (multiplier 1.0). The 5 levels:
//   off → 0    (skip emit entirely)
//   low → 0.4
//   med → 0.7
//   high → 1.0  (default)
function _particlesMult() {
  try {
    const lvl = localStorage.getItem('qf.video.particles') ?? 'high'
    if (lvl === 'off')  return 0
    if (lvl === 'low')  return 0.4
    if (lvl === 'med')  return 0.7
    return 1.0
  } catch { return 1.0 }
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
    // Scale by the user's particles quality setting. At 'off' we skip
    // the emit entirely; at 'low' we cut count to ~40% (rounded so a
    // 6-dot burst still emits 2 dots), etc.
    const mult = _particlesMult()
    if (mult <= 0) return null
    const count = Math.max(1, Math.round(o.count * mult))
    const created = []
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
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

  // ─────────────────────────────────────────────────────────────────────────
  // Composite "limit-break-grade" effects. Bigger, layered, self-destroying.
  // Built for ability / Limit Break moments that need to read as STUNNING, not
  // a single ring. World-space; depth 29-33 draws above all world sprites
  // (sprites sit at ~7-8; the HUD is separate DOM, so high depths are safe).
  // All respect _validXY + the particles quality multiplier where heavy.
  // ─────────────────────────────────────────────────────────────────────────

  // Thick expanding shockwave ring (+ optional bright fading core).
  shockwave(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffe066, fromR: 8, toR: 120, thickness: 6, alpha: 0.9,
      durationMs: 520, depth: 30, core: true, ...opts }
    const ring = scene.add.circle(x, y, o.fromR, 0x000000, 0)
    ring.setStrokeStyle(o.thickness, o.color, o.alpha).setDepth(o.depth)
    scene.tweens.add({ targets: ring, radius: o.toR, alpha: 0, duration: o.durationMs,
      ease: 'Cubic.easeOut', onComplete: () => ring.destroy() })
    if (o.core) {
      const core = scene.add.circle(x, y, o.fromR, o.color, 0.5).setDepth(o.depth - 1)
      scene.tweens.add({ targets: core, radius: o.toR * 0.55, alpha: 0,
        duration: o.durationMs * 0.7, ease: 'Quad.easeOut', onComplete: () => core.destroy() })
    }
    return ring
  },

  // N radial light rays bursting outward from a point (sunburst).
  burstRays(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xfff2c0, count: 12, length: 90, thickness: 3, durationMs: 450, depth: 30, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const n = Math.max(4, Math.round(o.count * mult))
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2
      const g = scene.add.graphics().setDepth(o.depth)
      g.lineStyle(o.thickness, o.color, 0.95)
      g.lineBetween(0, 0, Math.cos(ang) * o.length * 0.3, Math.sin(ang) * o.length * 0.3)
      g.setPosition(x, y)
      scene.tweens.add({ targets: g, scaleX: 3.3, scaleY: 3.3, alpha: 0,
        duration: o.durationMs, ease: 'Cubic.easeOut', onComplete: () => g.destroy() })
    }
    return null
  },

  // Particles converging INWARD to a point — sells a charge / wind-up.
  chargeUp(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x9ad0ff, count: 14, radius: 70, durationMs: 600, depth: 29, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const n = Math.max(4, Math.round(o.count * mult))
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5
      const sx = x + Math.cos(ang) * o.radius, sy = y + Math.sin(ang) * o.radius
      const dot = scene.add.circle(sx, sy, 2 + Math.random() * 2, o.color, 0.95).setDepth(o.depth)
      scene.tweens.add({ targets: dot, x, y, alpha: 0.4,
        duration: o.durationMs * (0.7 + Math.random() * 0.3), ease: 'Cubic.easeIn',
        onComplete: () => dot.destroy() })
    }
    return null
  },

  // Vertical pillar / column of light flashing down at a point (holy, revive).
  beamPillar(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffffff, width: 46, height: 260, durationMs: 520, depth: 31, ...opts }
    const beam = scene.add.rectangle(x, y + 6, o.width, o.height, o.color)
      .setOrigin(0.5, 1).setDepth(o.depth).setAlpha(0)
    scene.tweens.add({ targets: beam, alpha: 0.85, scaleX: 1.6,
      duration: o.durationMs * 0.25, yoyo: true, hold: o.durationMs * 0.3,
      ease: 'Quad.easeOut', onComplete: () => beam.destroy() })
    return beam
  },

  // A meteor streak falling from off-screen-up to (x,y), then a big impact.
  meteor(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff9a3a, fallMs: 420, fromDX: -120, fromDY: -340, depth: 32, onImpact: null, ...opts }
    const head = scene.add.circle(x + o.fromDX, y + o.fromDY, 9, o.color, 1).setDepth(o.depth)
    const glow = scene.add.circle(head.x, head.y, 17, o.color, 0.3).setDepth(o.depth - 1)
    const trail = scene.time.addEvent({ delay: 16, repeat: Math.floor(o.fallMs / 16), callback: () => {
      const t = scene.add.circle(head.x, head.y, 6, o.color, 0.5).setDepth(o.depth - 2)
      scene.tweens.add({ targets: t, alpha: 0, scale: 0.3, duration: 260, onComplete: () => t.destroy() })
    } })
    scene.tweens.add({ targets: [head, glow], x, y, duration: o.fallMs, ease: 'Quad.easeIn',
      onComplete: () => {
        head.destroy(); glow.destroy(); trail.remove(false)
        AbilityVfx.shockwave(scene, x, y, { color: o.color, toR: 150, thickness: 8, durationMs: 600 })
        AbilityVfx.particleBurst(scene, x, y, { color: o.color, count: 18, speed: 130, durationMs: 600 })
        if (typeof o.onImpact === 'function') o.onImpact()
      } })
    return head
  },

  // Jagged lightning bolt between two points — flashes then fades.
  lightning(scene, x1, y1, x2, y2, opts = {}) {
    if (!_validXY(x1, y1) || !_validXY(x2, y2)) return null
    const o = { color: 0xbfe0ff, segments: 6, jitter: 14, thickness: 3, durationMs: 220, depth: 32, ...opts }
    const g = scene.add.graphics().setDepth(o.depth)
    g.lineStyle(o.thickness, o.color, 1).beginPath()
    g.moveTo(x1, y1)
    for (let i = 1; i < o.segments; i++) {
      const t = i / o.segments
      g.lineTo(x1 + (x2 - x1) * t + (Math.random() - 0.5) * o.jitter * 2,
               y1 + (y2 - y1) * t + (Math.random() - 0.5) * o.jitter * 2)
    }
    g.lineTo(x2, y2); g.strokePath()
    scene.tweens.add({ targets: g, alpha: 0, duration: o.durationMs, ease: 'Quad.easeIn',
      onComplete: () => g.destroy() })
    return g
  },

  // Full-screen color flash via the camera (guarded wrapper).
  screenFlash(scene, opts = {}) {
    const o = { color: 0xffffff, durationMs: 260, intensity: 0.6, ...opts }
    const r = (o.color >> 16) & 255, gg = (o.color >> 8) & 255, b = o.color & 255
    try {
      scene.cameras?.main?.flash?.(o.durationMs,
        Math.round(r * o.intensity), Math.round(gg * o.intensity), Math.round(b * o.intensity))
    } catch {}
  },

  // A holding dome / shield that pops in over a target and fades after a hold.
  domeShield(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd66b, radius: 54, holdMs: 600, depth: 30, ...opts }
    const dome = scene.add.circle(x, y, o.radius, o.color, 0.12).setDepth(o.depth)
    dome.setStrokeStyle(3, o.color, 0.9).setScale(0.2)
    scene.tweens.add({ targets: dome, scale: 1, duration: 220, ease: 'Back.easeOut' })
    scene.tweens.add({ targets: dome, alpha: 0, delay: o.holdMs, duration: 400,
      ease: 'Quad.easeIn', onComplete: () => dome.destroy() })
    return dome
  },
}

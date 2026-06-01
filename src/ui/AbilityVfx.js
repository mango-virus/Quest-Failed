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

  // ─────────────────────────────────────────────────────────────────────────
  // Cinematic-grade primitives (Light Party duel overhaul, 2026-06-01).
  // Ground markers draw BELOW sprites (depth ~4-6); impacts/rays/arcs draw
  // ABOVE (29-33). All self-destroy and respect _validXY + the quality mult.
  // ─────────────────────────────────────────────────────────────────────────

  // FFXIV-style ground telegraph that FILLS over `durationMs` then detonates
  // (a bright flash) so a mechanic reads before it lands. shape: 'circle'
  // (radius), 'line' (length+width at `angle`), or 'cone' (length, ±0.5rad).
  groundTelegraph(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { shape: 'circle', color: 0xff5544, radius: 84, length: 180, width: 52,
      angle: 0, durationMs: 2000, depth: 5, ...opts }
    const g = scene.add.graphics().setDepth(o.depth)
    const cosA = Math.cos(o.angle), sinA = Math.sin(o.angle)
    const px = -sinA, py = cosA, hw = o.width / 2
    const linePts = () => {
      const ex = x + cosA * o.length, ey = y + sinA * o.length
      return [
        { x: x + px * hw, y: y + py * hw }, { x: x - px * hw, y: y - py * hw },
        { x: ex - px * hw, y: ey - py * hw }, { x: ex + px * hw, y: ey + py * hw },
      ]
    }
    const shape = (stroke) => {
      if (o.shape === 'line') {
        if (stroke) g.strokePoints(linePts(), true); else g.fillPoints(linePts(), true)
      } else if (o.shape === 'cone') {
        g.beginPath(); g.slice(x, y, o.length, o.angle - 0.5, o.angle + 0.5, false); g.closePath()
        if (stroke) g.strokePath(); else g.fillPath()
      } else {
        if (stroke) g.strokeCircle(x, y, o.radius); else g.fillCircle(x, y, o.radius)
      }
    }
    const proxy = { a: 0 }
    const render = () => {
      g.clear()
      g.fillStyle(o.color, 0.10 + proxy.a * 0.42)
      shape(false)
      g.lineStyle(2.5, o.color, 0.55 + proxy.a * 0.4)
      shape(true)
    }
    render()
    scene.tweens.add({ targets: proxy, a: 1, duration: o.durationMs, ease: 'Sine.easeIn',
      onUpdate: render,
      onComplete: () => {
        g.clear(); g.fillStyle(0xffffff, 0.55); shape(false); g.lineStyle(3, o.color, 1); shape(true)
        scene.tweens.add({ targets: g, alpha: 0, duration: 180, onComplete: () => g.destroy() })
      } })
    return g
  },

  // "Stack here" marker — a pulsing ringed circle with inward chevrons that
  // rotate over the cast, then flash. Reads as the FFXIV stack mechanic.
  stackMarker(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd66b, radius: 60, arrows: 6, durationMs: 2200, depth: 5, ...opts }
    const cont = scene.add.container(x, y).setDepth(o.depth)
    const g = scene.add.graphics()
    g.lineStyle(2.5, o.color, 0.9)
    g.strokeCircle(0, 0, o.radius)
    g.strokeCircle(0, 0, o.radius * 0.62)
    for (let i = 0; i < o.arrows; i++) {
      const a = (i / o.arrows) * Math.PI * 2
      const ox = Math.cos(a), oy = Math.sin(a)
      const tipR = o.radius * 0.78, baseR = o.radius * 1.02, wob = 0.16
      g.fillStyle(o.color, 0.85)
      g.fillPoints([
        { x: ox * tipR, y: oy * tipR },
        { x: Math.cos(a - wob) * baseR, y: Math.sin(a - wob) * baseR },
        { x: Math.cos(a + wob) * baseR, y: Math.sin(a + wob) * baseR },
      ], true)
    }
    cont.add(g)
    cont.setScale(0.3).setAlpha(0)
    scene.tweens.add({ targets: cont, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' })
    scene.tweens.add({ targets: cont, angle: 30, duration: o.durationMs, ease: 'Sine.easeInOut' })
    scene.tweens.add({ targets: g, alpha: 0.4, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    scene.time.delayedCall(o.durationMs, () => {
      AbilityVfx.shockwave(scene, x, y, { color: o.color, toR: o.radius * 1.6, thickness: 5, durationMs: 320 })
      scene.tweens.add({ targets: cont, alpha: 0, scale: 1.3, duration: 200, onComplete: () => cont.destroy() })
    })
    return cont
  },

  // Layered impact — core flash + shockwave + sparks + tumbling debris (+ an
  // optional lingering scorch decal). The default heavy "something just HIT".
  impactBurst(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff8a3a, coreColor: 0xffffff, sparks: 16, debris: 7,
      radius: 130, decal: false, durationMs: 540, depth: 31, ...opts }
    const core = scene.add.circle(x, y, 6, o.coreColor, 0.95).setDepth(o.depth + 1)
    scene.tweens.add({ targets: core, radius: o.radius * 0.32, alpha: 0,
      duration: 200, ease: 'Quad.easeOut', onComplete: () => core.destroy() })
    AbilityVfx.shockwave(scene, x, y, { color: o.color, toR: o.radius, thickness: 6, durationMs: o.durationMs })
    AbilityVfx.particleBurst(scene, x, y, { color: o.color, count: o.sparks, speed: 165, durationMs: o.durationMs })
    const mult = _particlesMult()
    if (mult > 0) {
      const n = Math.max(2, Math.round(o.debris * mult))
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2, dist = o.radius * (0.35 + Math.random() * 0.6)
        const sz = 2 + Math.random() * 3
        const d = scene.add.rectangle(x, y, sz, sz, o.color, 0.9).setDepth(o.depth).setAngle(Math.random() * 360)
        const tx = x + Math.cos(ang) * dist
        const peakY = y - 18 - Math.random() * 26, ty = y + 8 + Math.random() * 18
        scene.tweens.add({ targets: d, x: tx, angle: d.angle + 220, duration: o.durationMs, ease: 'Quad.easeOut' })
        scene.tweens.add({ targets: d, y: peakY, duration: o.durationMs * 0.4, ease: 'Quad.easeOut',
          onComplete: () => scene.tweens.add({ targets: d, y: ty, alpha: 0, duration: o.durationMs * 0.6,
            ease: 'Quad.easeIn', onComplete: () => d.destroy() }) })
      }
    }
    if (o.decal) AbilityVfx.crater(scene, x, y, { color: 0x140a02, radius: o.radius * 0.42, holdMs: o.decal === true ? 2200 : o.decal })
    return null
  },

  // Rotating radial god-rays that bloom out + fade — the holy/LB "the heavens
  // open" layer. Persistent for `durationMs`, slow rotation.
  godRays(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xfff2c0, count: 14, length: 220, durationMs: 900, depth: 31, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const n = Math.max(6, Math.round(o.count * mult))
    const cont = scene.add.container(x, y).setDepth(o.depth)
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2
      const g = scene.add.graphics()
      g.fillStyle(o.color, 0.22)
      g.beginPath(); g.moveTo(0, 0)
      g.lineTo(Math.cos(ang - 0.035) * o.length, Math.sin(ang - 0.035) * o.length)
      g.lineTo(Math.cos(ang + 0.035) * o.length, Math.sin(ang + 0.035) * o.length)
      g.closePath(); g.fillPath()
      cont.add(g)
    }
    cont.setScale(0.15)
    scene.tweens.add({ targets: cont, scale: 1, duration: o.durationMs * 0.4, ease: 'Cubic.easeOut' })
    scene.tweens.add({ targets: cont, angle: 36, duration: o.durationMs, ease: 'Sine.easeInOut' })
    scene.tweens.add({ targets: cont, alpha: 0, delay: o.durationMs * 0.5, duration: o.durationMs * 0.5,
      onComplete: () => cont.destroy() })
    return cont
  },

  // Expanding, rotating summoning sigil on the ground (two rings + radial
  // ticks). The "channel a big spell" floor layer.
  magicCircle(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffd66b, radius: 92, ticks: 12, durationMs: 1400, depth: 5, ...opts }
    const cont = scene.add.container(x, y).setDepth(o.depth)
    const g = scene.add.graphics()
    g.lineStyle(2.5, o.color, 0.9)
    g.strokeCircle(0, 0, o.radius)
    g.strokeCircle(0, 0, o.radius * 0.66)
    for (let i = 0; i < o.ticks; i++) {
      const a = (i / o.ticks) * Math.PI * 2
      g.lineBetween(Math.cos(a) * o.radius * 0.66, Math.sin(a) * o.radius * 0.66,
        Math.cos(a) * o.radius, Math.sin(a) * o.radius)
    }
    cont.add(g)
    cont.setScale(0).setAlpha(0)
    scene.tweens.add({ targets: cont, scale: 1, alpha: 1, duration: o.durationMs * 0.25, ease: 'Back.easeOut' })
    scene.tweens.add({ targets: cont, angle: 50, duration: o.durationMs, ease: 'Linear' })
    scene.tweens.add({ targets: cont, alpha: 0, delay: o.durationMs * 0.6, duration: o.durationMs * 0.4,
      onComplete: () => cont.destroy() })
    return cont
  },

  // A crescent blade-slash trail that sweeps + fades fast — melee swing signature.
  bladeArc(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffffff, radius: 36, angle: 0, sweep: 2.1, thickness: 5, durationMs: 240, depth: 33, ...opts }
    const g = scene.add.graphics().setDepth(o.depth).setPosition(x, y)
    const start = o.angle - o.sweep / 2
    g.lineStyle(o.thickness, o.color, 0.95)
    g.beginPath(); g.arc(0, 0, o.radius, start, start + o.sweep, false); g.strokePath()
    g.setScale(0.6)
    scene.tweens.add({ targets: g, scaleX: 1.25, scaleY: 1.25, alpha: 0, duration: o.durationMs,
      ease: 'Cubic.easeOut', onComplete: () => g.destroy() })
    return g
  },

  // Floating arcane runes rising off a caster — spellcast signature.
  runeSigil(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xc9a9ff, count: 4, durationMs: 540, depth: 33, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const n = Math.max(2, Math.round(o.count * mult))
    for (let i = 0; i < n; i++) {
      const dx = (Math.random() - 0.5) * 30
      const r = scene.add.rectangle(x + dx, y + (Math.random() - 0.5) * 10, 6, 6, o.color, 0.9)
        .setDepth(o.depth).setAngle(45)
      scene.tweens.add({ targets: r, y: r.y - 26 - Math.random() * 16, angle: r.angle + 180, alpha: 0,
        duration: o.durationMs, ease: 'Quad.easeOut', onComplete: () => r.destroy() })
    }
    return null
  },

  // Lingering ground scorch / crater decal that fades after a hold.
  crater(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0x140a02, radius: 42, holdMs: 2000, depth: 4, ...opts }
    const e = scene.add.ellipse(x, y, o.radius * 2, o.radius * 1.05, o.color, 0.5).setDepth(o.depth).setScale(0.4)
    scene.tweens.add({ targets: e, scaleX: 1, scaleY: 1, duration: 180, ease: 'Quad.easeOut' })
    scene.tweens.add({ targets: e, alpha: 0, delay: o.holdMs, duration: 600, onComplete: () => e.destroy() })
    return e
  },

  // Drifting embers rising over an area — post-impact atmosphere.
  emberField(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xff9a3a, count: 10, area: 90, durationMs: 1200, depth: 32, ...opts }
    const mult = _particlesMult(); if (mult <= 0) return null
    const n = Math.max(3, Math.round(o.count * mult))
    for (let i = 0; i < n; i++) {
      const sx = x + (Math.random() - 0.5) * o.area, sy = y + (Math.random() - 0.5) * o.area * 0.5
      const d = scene.add.circle(sx, sy, 1.5 + Math.random() * 1.5, o.color, 0.9).setDepth(o.depth)
      scene.tweens.add({ targets: d, x: sx + (Math.random() - 0.5) * 30, y: sy - 30 - Math.random() * 40,
        alpha: 0, duration: o.durationMs * (0.6 + Math.random() * 0.4), ease: 'Sine.easeOut',
        onComplete: () => d.destroy() })
    }
    return null
  },

  // Micro freeze-frame for impact weight. Near-zero timeScale for `ms` (REAL
  // time, restored via setTimeout so the scaled clock can't strand it). Use
  // sparingly on hero beats (the LB killing blow) — overlapping slow-mos just
  // race to restore 1.0, which is a cosmetic blip, not a hang.
  hitStop(scene, ms = 90) {
    if (!scene?.time) return
    try {
      scene.time.timeScale = 0.0001
      window.setTimeout(() => { if (scene?.time) scene.time.timeScale = 1 }, ms)
    } catch {}
  },

  // Descending resurrection beam — gold pillar + halo ring + rising motes +
  // a soft sunburst. The Raise "they get back up" moment.
  resurrectBeam(scene, x, y, opts = {}) {
    if (!_validXY(x, y)) return null
    const o = { color: 0xffe9a8, durationMs: 700, depth: 31, ...opts }
    AbilityVfx.beamPillar(scene, x, y, { color: o.color, width: 34, height: 210, durationMs: o.durationMs })
    AbilityVfx.pulseRing(scene, x, y, { color: 0xffd66b, fromR: 6, toR: 36, thickness: 3, durationMs: o.durationMs })
    AbilityVfx.burstRays(scene, x, y, { color: o.color, count: 10, length: 64, durationMs: o.durationMs * 0.6 })
    const mult = _particlesMult()
    if (mult > 0) {
      const n = Math.max(3, Math.round(8 * mult))
      for (let i = 0; i < n; i++) {
        const dx = (Math.random() - 0.5) * 28
        const d = scene.add.circle(x + dx, y + 6, 1.5 + Math.random() * 1.5, o.color, 0.95).setDepth(o.depth)
        scene.tweens.add({ targets: d, y: y - 40 - Math.random() * 30, alpha: 0,
          duration: o.durationMs * (0.7 + Math.random() * 0.4), ease: 'Sine.easeOut',
          onComplete: () => d.destroy() })
      }
    }
    return null
  },
}

// BossPactVfx — visual effects for the 8 boss-attack Dark Pacts.
//
// BossSystem._runBossPactAttacks emits PACT_BOSS_* events when a pact's
// cooldown fires. Until now nothing was listening on the rendering side,
// so the player saw advs lose chunks of HP with no idea why. This module
// owns the spectacle — fireballs, lightning bolts, shockwave rings,
// soul tethers — wired into the same Game scene that owns the world
// camera (so screen shake reads correctly).
//
// Design priorities: every effect should have at least two visual layers
// (e.g. core shape + glow ring, or beam + impact flash) and most should
// kick the camera so a kill from a pact lands hard. Keep all timings
// short (< ~700 ms peak) so they don't stack into noise during chained
// fights.

import { EventBus }   from '../systems/EventBus.js'
import { AbilityVfx } from './AbilityVfx.js'

const TS = 32

// Phase 34C.5 — particles quality. Loose particle counts (ember swarm,
// smoke burst, streak lines) scale by this multiplier; structural counts
// (cracks, doppelganger copies) stay fixed because they affect the read
// of the effect, not just its density.
function _particlesMult() {
  try {
    const lvl = localStorage.getItem('qf.video.particles') ?? 'high'
    if (lvl === 'off')  return 0
    if (lvl === 'low')  return 0.4
    if (lvl === 'med')  return 0.7
    return 1.0
  } catch { return 1.0 }
}
// Round-and-clamp helper so a 6-particle burst at low (0.4) still emits
// at least 1 instead of vanishing to zero (which would erase the effect).
function _scaledCount(base) {
  const m = _particlesMult()
  if (m <= 0) return 0
  return Math.max(1, Math.round(base * m))
}

// Resolve any of the entity pools to a worldX/worldY by instanceId.
function _findEntity(gs, id) {
  if (!id) return null
  if (gs.boss?.instanceId === id) return gs.boss
  return (gs.adventurers?.active ?? []).find(a => a.instanceId === id)
      ?? (gs.minions ?? []).find(m => m.instanceId === id)
      ?? null
}

// Floating damage tag on a victim — colour-coded by pact theme. Stacks
// on top of the generic CombatFeedback numbers.
function _shoutDamage(scene, x, y, dmg, color = '#ffaa44', big = false) {
  AbilityVfx.floatingText(scene, x, y - 22, `-${dmg}`, {
    color, fontSize: big ? '18px' : '14px',
    durationMs: 850, driftY: -42, depth: 95,
  })
}

export class BossPactVfx {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('PACT_BOSS_HELLFIRE_WINDUP',     this._onHellfireWindup)
    on('PACT_BOSS_HELLFIRE_FIRED',      this._onHellfireFired)
    on('PACT_BOSS_LIGHTNING_FIRED',     this._onLightningFired)
    on('PACT_BOSS_SHOCKWAVE_FIRED',     this._onShockwaveFired)
    on('PACT_BOSS_VORTEX_FIRED',        this._onVortexFired)
    on('PACT_BOSS_SOULDRAIN_BEGUN',     this._onSoulDrainBegun)
    on('PACT_BOSS_SOULDRAIN_ENDED',     this._onSoulDrainEnded)
    on('PACT_BOSS_DOPPELGANGERS_SPAWNED', this._onDoppelSpawned)
    on('PACT_BOSS_PETRIFY_FIRED',       this._onPetrifyFired)
    on('PACT_BOSS_PETRIFY_BACKFIRE',    this._onPetrifyBackfire)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    if (this._soulDrain) this._destroySoulDrain()
  }

  _shake(intensity = 0.005, durationMs = 200) {
    this._scene._cam?.shake?.(durationMs, intensity)
  }

  _flashWorld(color = 0xffffff, alpha = 0.25, durationMs = 120) {
    const cam = this._scene._cam
    if (!cam) return
    const r = (color >> 16) & 0xff
    const g = (color >> 8)  & 0xff
    const b = color & 0xff
    cam.flash(durationMs, r, g, b)
  }

  // ── 1. Hellfire Breath ────────────────────────────────────────────
  // Windup: pulsing red aura beneath the boss. Fired: cone-shaped flame
  // wash toward each target + ember swarm + camera shake.
  _onHellfireWindup({ x, y, durationMs }) {
    const aura = this._scene.add.graphics().setPosition(x, y).setDepth(40).setAlpha(0)
    aura.fillStyle(0xff5522, 0.55)
    aura.fillCircle(0, 0, 28)
    aura.fillStyle(0xffaa33, 0.35)
    aura.fillCircle(0, 0, 44)
    this._scene.tweens.add({
      targets: aura, alpha: 1, scale: 1.6,
      duration: durationMs, ease: 'Quad.easeIn',
      onComplete: () => aura.destroy(),
    })
  }
  _onHellfireFired({ x, y, targetIds, damage }) {
    const ids = Array.isArray(targetIds) ? targetIds : []
    for (const tid of ids) {
      const t = _findEntity(this._gameState, tid)
      if (!t) continue
      // Flame cone — overlapping triangles fading orange→red→black.
      this._fireFlameCone(x, y, t.worldX, t.worldY)
      _shoutDamage(this._scene, t.worldX, t.worldY, damage, '#ff8844', true)
    }
    this._shake(0.012, 280)
    this._flashWorld(0xff5522, 0.20, 140)
  }
  _fireFlameCone(sx, sy, tx, ty) {
    const ang = Math.atan2(ty - sy, tx - sx)
    const len = Math.hypot(tx - sx, ty - sy)
    const halfWidth = TS * 0.7
    const g = this._scene.add.graphics().setDepth(45).setAlpha(0.85)
    // Base flame: hot core + outer flare
    g.fillStyle(0xfff4a8, 1)
    g.beginPath()
    g.moveTo(sx, sy)
    g.lineTo(sx + Math.cos(ang) * len + Math.cos(ang + Math.PI/2) * halfWidth,
             sy + Math.sin(ang) * len + Math.sin(ang + Math.PI/2) * halfWidth)
    g.lineTo(sx + Math.cos(ang) * len + Math.cos(ang - Math.PI/2) * halfWidth,
             sy + Math.sin(ang) * len + Math.sin(ang - Math.PI/2) * halfWidth)
    g.closePath()
    g.fillPath()
    const outer = this._scene.add.graphics().setDepth(44).setAlpha(0.55)
    outer.fillStyle(0xff5522, 1)
    outer.beginPath()
    outer.moveTo(sx, sy)
    outer.lineTo(sx + Math.cos(ang) * len + Math.cos(ang + Math.PI/2) * halfWidth*1.7,
                 sy + Math.sin(ang) * len + Math.sin(ang + Math.PI/2) * halfWidth*1.7)
    outer.lineTo(sx + Math.cos(ang) * len + Math.cos(ang - Math.PI/2) * halfWidth*1.7,
                 sy + Math.sin(ang) * len + Math.sin(ang - Math.PI/2) * halfWidth*1.7)
    outer.closePath()
    outer.fillPath()
    this._scene.tweens.add({
      targets: [g, outer], alpha: 0, duration: 380, ease: 'Quad.easeOut',
      onComplete: () => { g.destroy(); outer.destroy() },
    })
    // Ember swarm — 8 little circles drifting from source toward target.
    // Scales with the particles quality setting.
    const _emberCount = _scaledCount(8)
    for (let i = 0; i < _emberCount; i++) {
      const e = this._scene.add.graphics().setDepth(46)
      e.fillStyle(i % 2 ? 0xffcc55 : 0xff8833, 1)
      e.fillCircle(0, 0, 2 + Math.random() * 2)
      e.setPosition(sx, sy)
      const dx = (tx - sx) * (0.6 + Math.random() * 0.8)
      const dy = (ty - sy) * (0.6 + Math.random() * 0.8)
      const drift = (Math.random() - 0.5) * 24
      this._scene.tweens.add({
        targets: e,
        x: sx + dx + drift, y: sy + dy + drift,
        alpha: 0,
        duration: 450 + Math.random() * 200,
        ease: 'Quad.easeOut',
        onComplete: () => e.destroy(),
      })
    }
  }

  // ── 2. Lightning Strike ───────────────────────────────────────────
  // Bright sky-to-target jagged bolt, screen flash, target white-out.
  _onLightningFired({ x, y, targetId, damage }) {
    const target = _findEntity(this._gameState, targetId)
    if (!target) return
    // Bolt path: 5 jagged segments down from above the screen to target
    const startY = y - 240
    const segs = 6
    const points = []
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const px = x + (Math.random() - 0.5) * 22 * (1 - t)
      const py = startY + (y - startY) * t
      points.push({ x: px, y: py })
    }
    const g = this._scene.add.graphics().setDepth(48)
    // Outer glow
    g.lineStyle(8, 0x88aaff, 0.45)
    g.beginPath()
    g.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
    g.strokePath()
    // Inner core
    g.lineStyle(2, 0xffffff, 1)
    g.beginPath()
    g.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y)
    g.strokePath()
    // Impact ring
    const ring = this._scene.add.graphics().setPosition(x, y).setDepth(47)
    ring.lineStyle(3, 0xddeeff, 1)
    ring.strokeCircle(0, 0, 6)
    this._scene.tweens.add({
      targets: ring, scale: 4, alpha: 0,
      duration: 360, ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    })
    this._scene.tweens.add({
      targets: g, alpha: 0,
      duration: 220, ease: 'Quad.easeIn',
      onComplete: () => g.destroy(),
    })
    this._flashWorld(0xffffff, 0.5, 80)
    this._shake(0.018, 220)
    _shoutDamage(this._scene, target.worldX, target.worldY, damage, '#ddddff', true)
  }

  // ── 3. Shockwave Slam ─────────────────────────────────────────────
  // Expanding ring outward from boss, screen shake, all-defender flash.
  _onShockwaveFired({ x, y, damage, targets }) {
    const ring1 = this._scene.add.graphics().setPosition(x, y).setDepth(44)
    ring1.lineStyle(6, 0xffe488, 1)
    ring1.strokeCircle(0, 0, 8)
    const ring2 = this._scene.add.graphics().setPosition(x, y).setDepth(43)
    ring2.lineStyle(10, 0xff8833, 0.6)
    ring2.strokeCircle(0, 0, 8)
    this._scene.tweens.add({
      targets: [ring1, ring2], scale: 7, alpha: 0,
      duration: 420, ease: 'Quad.easeOut',
      onComplete: () => { ring1.destroy(); ring2.destroy() },
    })
    // Crack lines radiating out — 6 spokes
    const cracks = this._scene.add.graphics().setPosition(x, y).setDepth(42).setAlpha(0.85)
    cracks.lineStyle(2, 0x66442a, 1)
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 * i) / 6
      const len = TS * 3 + Math.random() * TS
      cracks.beginPath()
      cracks.moveTo(0, 0)
      cracks.lineTo(Math.cos(a) * len, Math.sin(a) * len)
      cracks.strokePath()
    }
    this._scene.tweens.add({
      targets: cracks, alpha: 0, duration: 700, ease: 'Quad.easeIn',
      onComplete: () => cracks.destroy(),
    })
    this._shake(0.025, 320)
    const ids = Array.isArray(targets) ? targets : []
    for (const id of ids) {
      const e = _findEntity(this._gameState, id)
      if (e) _shoutDamage(this._scene, e.worldX, e.worldY, damage, '#ffe488')
    }
  }

  // ── Dark Vortex ───────────────────────────────────────────────
  // Black void at boss centre that expands then collapses, with motion
  // streaks suggesting "things being pulled in".
  _onVortexFired({ x, y }) {
    const core = this._scene.add.graphics().setPosition(x, y).setDepth(44)
    core.fillStyle(0x110022, 0.9)
    core.fillCircle(0, 0, 12)
    core.lineStyle(3, 0x6633bb, 1)
    core.strokeCircle(0, 0, 16)
    this._scene.tweens.add({
      targets: core, scale: 3.2, duration: 220, ease: 'Quad.easeOut',
      onComplete: () => {
        this._scene.tweens.add({
          targets: core, scale: 0.2, alpha: 0,
          duration: 240, ease: 'Quad.easeIn',
          onComplete: () => core.destroy(),
        })
      },
    })
    // 12 streak lines spiralling inward (scaled by particles setting)
    const _streakCount = _scaledCount(12)
    for (let i = 0; i < _streakCount; i++) {
      const ang  = (Math.PI * 2 * i) / _streakCount + (Math.random() - 0.5) * 0.4
      const dist = TS * 3 + Math.random() * TS
      const sx = x + Math.cos(ang) * dist
      const sy = y + Math.sin(ang) * dist
      const streak = this._scene.add.graphics().setDepth(43)
      streak.lineStyle(2, 0xaa66ff, 0.85)
      streak.beginPath()
      streak.moveTo(sx, sy)
      streak.lineTo(sx - Math.cos(ang) * 14, sy - Math.sin(ang) * 14)
      streak.strokePath()
      this._scene.tweens.add({
        targets: streak,
        x: x - sx, y: y - sy,        // move endpoint to centre
        alpha: 0,
        duration: 380, ease: 'Quad.easeIn',
        onComplete: () => streak.destroy(),
      })
    }
    this._shake(0.015, 280)
    this._flashWorld(0x220044, 0.30, 220)
  }

  // ── 6. Soul Drain ────────────────────────────────────────────────
  // Persistent tether between boss and target until ENDED. Cyan/purple
  // particles flow along the curve toward the boss.
  _onSoulDrainBegun({ targetId }) {
    this._destroySoulDrain()
    const target = _findEntity(this._gameState, targetId)
    if (!target) return
    const tether = this._scene.add.graphics().setDepth(46)
    this._soulDrain = { tether, targetId, particles: [], t: 0 }
    // Tick: redraw tether every frame, spawn drifting orbs every ~120ms
    const update = () => {
      const sd = this._soulDrain
      if (!sd) return
      const t = _findEntity(this._gameState, sd.targetId)
      const boss = this._gameState.boss
      if (!t || !boss) { this._destroySoulDrain(); return }
      sd.tether.clear()
      sd.tether.lineStyle(3, 0x88ccff, 0.85)
      const midX = (boss.worldX + t.worldX) / 2
      const midY = (boss.worldY + t.worldY) / 2 - 30  // arch upward
      sd.tether.beginPath()
      sd.tether.moveTo(t.worldX, t.worldY)
      sd.tether.lineTo(midX, midY)
      sd.tether.lineTo(boss.worldX, boss.worldY)
      sd.tether.strokePath()
      sd.tether.lineStyle(1, 0xffffff, 0.6)
      sd.tether.strokePath()
      sd.t += 1
      if (sd.t % 6 === 0) {
        const orb = this._scene.add.graphics().setPosition(t.worldX, t.worldY).setDepth(47)
        orb.fillStyle(0x88ccff, 1)
        orb.fillCircle(0, 0, 3)
        sd.particles.push(orb)
        this._scene.tweens.add({
          targets: orb,
          x: boss.worldX, y: boss.worldY,
          alpha: 0, scale: 0.4,
          duration: 600, ease: 'Quad.easeIn',
          onComplete: () => {
            orb.destroy()
            const idx = sd.particles.indexOf(orb)
            if (idx >= 0) sd.particles.splice(idx, 1)
          },
        })
      }
    }
    this._soulDrain.timer = this._scene.time.addEvent({
      delay: 60, loop: true, callback: update,
    })
  }
  _onSoulDrainEnded() {
    this._destroySoulDrain()
    const boss = this._gameState.boss
    if (boss) {
      const flash = this._scene.add.graphics().setPosition(boss.worldX, boss.worldY).setDepth(48)
      flash.fillStyle(0x88ccff, 0.7)
      flash.fillCircle(0, 0, 18)
      this._scene.tweens.add({
        targets: flash, scale: 2, alpha: 0,
        duration: 280, ease: 'Quad.easeOut',
        onComplete: () => flash.destroy(),
      })
    }
  }
  _destroySoulDrain() {
    const sd = this._soulDrain
    if (!sd) return
    sd.timer?.remove?.(false)
    sd.tether?.destroy?.()
    for (const p of sd.particles) p.destroy()
    this._soulDrain = null
  }

  // ── 7. Doppelgangers ─────────────────────────────────────────────
  // Three boss-sprite illusions appear flanking the boss for the
  // duration. They orbit slowly and play the same idle animation as
  // the real boss, so the player genuinely cannot tell which is real.
  // Falls back to graphics circles if the boss spritesheet isn't
  // loaded (shouldn't happen in normal play).
  _onDoppelSpawned({ x, y, durationMs }) {
    const COUNT = 3
    const RADIUS = TS * 1.4
    const spriteKey = this._scene.bossRenderer?._spriteKey
    const idleAnim  = spriteKey ? `${spriteKey}-idle-down` : null
    const hasSprite = !!(spriteKey && this._scene.textures?.exists?.(spriteKey + '-idle'))
    const copies = []
    for (let i = 0; i < COUNT; i++) {
      let ghost
      if (hasSprite) {
        ghost = this._scene.add.sprite(x, y, `${spriteKey}-idle`, 0)
          .setScale(2.0)               // matches BOSS_SPRITE_SCALE in BossRenderer
          .setAlpha(0)
          .setDepth(38)
          .setTint(0xb088ff)           // soft purple wash so illusions read as ghostly
        if (idleAnim && this._scene.anims?.exists?.(idleAnim)) {
          ghost.play(idleAnim)
        }
      } else {
        // Fallback — original purple-orb look in case the boss sheet
        // didn't load.
        ghost = this._scene.add.graphics().setDepth(38).setAlpha(0)
        ghost.fillStyle(0x6633bb, 0.6)
        ghost.fillCircle(0, 0, 10)
        ghost.lineStyle(2, 0x9966ff, 0.9)
        ghost.strokeCircle(0, 0, 12)
        ghost.setPosition(x, y)
      }
      copies.push({ ghost, phaseOff: (Math.PI * 2 * i) / COUNT })
      this._scene.tweens.add({
        targets: ghost, alpha: hasSprite ? 0.6 : 0.85, duration: 200,
      })
    }
    const start = this._scene.time?.now ?? 0
    const tick = () => {
      const now = this._scene.time?.now ?? 0
      const t = (now - start) / 1200   // slower orbit so the player has time to read all 4 figures
      const boss = this._gameState.boss
      const cx = boss?.worldX ?? x
      const cy = boss?.worldY ?? y
      for (const c of copies) {
        const a = t * Math.PI * 2 + c.phaseOff
        c.ghost.setPosition(cx + Math.cos(a) * RADIUS, cy + Math.sin(a) * RADIUS)
      }
    }
    const timer = this._scene.time.addEvent({ delay: 33, loop: true, callback: tick })
    this._scene.time.delayedCall(durationMs, () => {
      timer.remove(false)
      for (const c of copies) {
        this._scene.tweens.add({
          targets: c.ghost, alpha: 0, duration: 240,
          onComplete: () => c.ghost.destroy(),
        })
      }
    })
  }

  // ── 8. Petrifying Stare ──────────────────────────────────────────
  // Beam from boss eye to target, target greys out for the petrify
  // duration. Backfire flips the colour to red and tints the boss.
  _onPetrifyFired({ targetId, durationMs }) {
    const boss   = this._gameState.boss
    const target = _findEntity(this._gameState, targetId)
    if (!boss || !target) return
    this._fireBeam(boss.worldX, boss.worldY - 18, target.worldX, target.worldY,
      0xddd4aa, durationMs)
    const sprite = this._scene.adventurerRenderer?._sprites?.[targetId]?.image
    if (sprite?.setTint) {
      sprite.setTint(0x999999)
      this._scene.time.delayedCall(durationMs, () => {
        if (sprite.active && sprite.clearTint) sprite.clearTint()
      })
    }
  }
  _onPetrifyBackfire({ stunMs }) {
    const boss = this._gameState.boss
    if (!boss) return
    this._fireBeam(boss.worldX, boss.worldY - 18, boss.worldX, boss.worldY - 18,
      0xff5555, 200)
    const sprite = this._scene.bossRenderer?._sprite ?? this._scene.bossRenderer?.sprite
    if (sprite?.setTint) {
      sprite.setTint(0x999999)
      this._scene.time.delayedCall(stunMs, () => {
        if (sprite.active && sprite.clearTint) sprite.clearTint()
      })
    }
    this._shake(0.02, 220)
  }
  _fireBeam(x1, y1, x2, y2, color, durationMs) {
    const g = this._scene.add.graphics().setDepth(48).setAlpha(0.9)
    g.lineStyle(6, color, 0.4)
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokePath()
    g.lineStyle(2, 0xffffff, 1)
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokePath()
    this._scene.tweens.add({
      targets: g, alpha: 0,
      duration: Math.min(durationMs, 280), ease: 'Quad.easeOut',
      onComplete: () => g.destroy(),
    })
  }
}

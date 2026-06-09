// CharmVfxRenderer — all "charmed adventurer" VFX, boss-aware (2026-06-09).
//
// Two bosses charm adventurers, and each gets its OWN look so the player can read
// WHICH power has its claws in a hero:
//   • SUCCUBUS ("Bat-Form Seduction") — pink/magenta seduction: glowing hearts
//     stream up off the thrall + a soft rose pulse.
//   • VAMPIRE  ("Charm & Blood Tax")   — crimson blood-thrall: dark blood droplets
//     drift up + a slow, ominous double-thump (heartbeat) pulse.
//
// Replaces the old hand-drawn Graphics hearts in SuccubusBatRenderer (flat circles
// + a triangle, no bloom). Built on Phaser 3.60 GPU particles + additive blend +
// Glow post-FX via the AbilityVfx toolkit — same family as every other ability VFX.
//
// Two layers:
//   1. APPLY BURST — one-shot when a hero is first charmed (hooked off the boss's
//      own charm events: SUCCUBUS_CHARM_APPLIED / VAMPIRE_CHARM_MARKED).
//   2. PERSISTENT AURA — a per-charmed-adv emitter that follows them while
//      aiState === 'charmed', reaped the instant they break free / die / leave.
//      Mirrors StatusVfxSystem's followed-emitter lifecycle (Map + scan + reap).
//
// Quality-aware (AbilityVfx honours the particles setting); self-cleaning.

import { EventBus }   from '../systems/EventBus.js'
import { Balance }    from '../config/balance.js'
import { AbilityVfx } from './AbilityVfx.js'

const TS = Balance.TILE_SIZE
const MAX_AURAS = 12   // safety cap — usually only 1 charmed adv at a time

// ── Per-boss aesthetic ──────────────────────────────────────────────────────────
// tex: which generated glyph the aura/burst emits. tints: 2-colour additive blend.
// rise/spread tune the drift; pulse* drives the periodic ring (vampire = heartbeat).
const STYLES = {
  succubus: {
    tex: 'heart',
    tints: [0xff66aa, 0xffb3e0],
    aura:  { freq: 200, life: 880, rise: [-44, -18], spread: 9, scale: 0.42, alpha: 0.78 },
    pulse: { color: 0xff66cc, everyMs: 1300, beats: 1, toR: 26, thickness: 2 },
    burst: { color: 0xff66cc, count: 16, label: '♥ CHARMED', textColor: '#ffaadd' },
  },
  vampire: {
    tex: 'drop',
    tints: [0xcc1133, 0x7a0a1a],
    aura:  { freq: 250, life: 1050, rise: [-30, -10], spread: 8, scale: 0.5, alpha: 0.66 },
    // Double-thump heartbeat — two quick rings ~150 ms apart, every 1.6 s.
    pulse: { color: 0xaa1126, everyMs: 1600, beats: 2, beatGapMs: 150, toR: 24, thickness: 2 },
    burst: { color: 0xcc1133, count: 14, label: 'ENTHRALLED', textColor: '#ff6677' },
  },
}

export class CharmVfxRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._auras     = new Map()   // advId -> { em, style, nextPulseAt }

    this._onSuccubus = (p) => this._burstFor('succubus', p?.targetId)
    this._onVampire  = (p) => this._burstFor('vampire',  p?.advId)
    EventBus.on('SUCCUBUS_CHARM_APPLIED', this._onSuccubus)
    EventBus.on('VAMPIRE_CHARM_MARKED',   this._onVampire)
  }

  destroy() {
    EventBus.off('SUCCUBUS_CHARM_APPLIED', this._onSuccubus)
    EventBus.off('VAMPIRE_CHARM_MARKED',   this._onVampire)
    for (const rec of this._auras.values()) this._killAura(rec)
    this._auras.clear()
  }

  // ── Style resolution ──────────────────────────────────────────────────────────
  _styleId() {
    const arch = this._gameState?.player?.bossArchetypeId
    return arch === 'vampire' ? 'vampire' : 'succubus'   // succubus pink = safe default
  }
  _style(id) { return STYLES[id] ?? STYLES.succubus }

  // ── Generated particle glyphs (white, soft — tinted + additive at emit time) ───
  _texKey(kind) {
    const key = '__qf_charm_' + kind
    if (this._scene.textures.exists(key)) return key
    const g = this._scene.make.graphics({ x: 0, y: 0, add: false })
    if (kind === 'heart') {
      // Soft heart: layered alpha passes for a glowing, soft-edged read.
      const cx = 16, cy = 14
      for (let i = 4; i >= 0; i--) {
        const a = 0.16 + i * 0.04, s = 1 + i * 0.16
        g.fillStyle(0xffffff, a)
        g.fillCircle(cx - 5 * s / 1.4, cy - 3, 5 * s)
        g.fillCircle(cx + 5 * s / 1.4, cy - 3, 5 * s)
        g.fillTriangle(cx - 9 * s, cy, cx + 9 * s, cy, cx, cy + 12 * s)
      }
      g.generateTexture(key, 32, 32)
    } else {
      // Soft blood droplet: round belly + a tapered point up top.
      const cx = 16, cy = 19
      for (let i = 4; i >= 0; i--) {
        const a = 0.16 + i * 0.04, s = 1 + i * 0.14
        g.fillStyle(0xffffff, a)
        g.fillCircle(cx, cy, 6 * s)
        g.fillTriangle(cx - 4 * s, cy - 2, cx + 4 * s, cy - 2, cx, cy - 16 * s)
      }
      g.generateTexture(key, 32, 36)
    }
    g.destroy()
    return key
  }

  // ── Apply burst (one-shot when a hero is charmed) ──────────────────────────────
  _burstFor(styleId, advId) {
    const adv = (this._gameState?.adventurers?.active ?? []).find(a => a.instanceId === advId)
    if (!adv) return
    const x = adv.worldX ?? (adv.tileX * TS + TS / 2)
    const y = adv.worldY ?? (adv.tileY * TS + TS / 2)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const st = this._style(styleId)

    // Glyph motes erupting upward (additive GPU explode, tinted to the boss colour).
    this._explode(x, y, st.tex, st.tints, st.burst.count)
    // Toolkit layers: a soft bloom ring, an aura swell, and a punched-in label.
    AbilityVfx.shockwave(this._scene, x, y, { color: st.burst.color, fromR: 6, toR: 40, thickness: 3, durationMs: 460, core: false, depth: 30 })
    AbilityVfx.glowPulseFx(this._scene, x, y - 6, { color: st.burst.color, r: 18, durationMs: 560, motes: 0, depth: 29 })
    AbilityVfx.floatingText(this._scene, x, y - 26, st.burst.label, { color: st.burst.textColor, fontSize: '11px', durationMs: 820 })
  }

  // One-shot GPU burst of the boss glyph (hearts erupt / blood splatters).
  _explode(x, y, kind, tints, count) {
    try {
      const em = this._scene.add.particles(x, y, this._texKey(kind), {
        lifespan: { min: 420, max: 720 },
        speed: { min: 30, max: 120 },
        angle: { min: 200, max: 340 },          // mostly upward fan
        gravityY: 90,
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.95, end: 0 },
        rotate: { min: -20, max: 20 },
        tint: tints,
        blendMode: 'ADD',
        emitting: false,
      })
      em.setDepth(31)
      em.explode(count)
      this._scene.time.delayedCall(900, () => { try { em.destroy() } catch (e) {} })
    } catch (e) { /* canvas / particles off */ }
  }

  // ── Per-frame: persistent aura on every charmed adventurer ─────────────────────
  update() {
    const now  = this._scene?.time?.now ?? 0
    const advs = this._gameState?.adventurers?.active ?? []
    const seen = new Set()
    const styleId = this._styleId()
    const st = this._style(styleId)

    for (const a of advs) {
      if (a.aiState !== 'charmed') continue
      if ((a.resources?.hp ?? 0) <= 0) continue
      const id = a.instanceId
      if (id == null) continue
      seen.add(id)
      const x = a.worldX ?? (a.tileX * TS + TS / 2)
      const y = a.worldY ?? (a.tileY * TS + TS / 2)
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue

      let rec = this._auras.get(id)
      if (rec && rec.styleId !== styleId) { this._killAura(rec); this._auras.delete(id); rec = null }
      if (!rec) {
        if (this._auras.size >= MAX_AURAS) continue
        const em = this._makeAura(x, y, st)
        rec = { em, styleId, nextPulseAt: now + 400 }
        this._auras.set(id, rec)
      }
      // Follow the thrall as they walk to the boss.
      rec.em?.setPosition?.(x, y + 6)
      // Periodic bloom pulse (vampire = double-thump heartbeat).
      if (now >= rec.nextPulseAt) {
        this._pulse(x, y, st.pulse)
        rec.nextPulseAt = now + st.pulse.everyMs
      }
    }

    // Reap auras whose adv broke free / died / left the field.
    if (this._auras.size) {
      for (const [id, rec] of this._auras) {
        if (!seen.has(id)) { this._killAura(rec); this._auras.delete(id) }
      }
    }
  }

  _makeAura(x, y, st) {
    try {
      const em = this._scene.add.particles(x, y, this._texKey(st.tex), {
        frequency: st.aura.freq, quantity: 1, lifespan: st.aura.life,
        speedY: { min: st.aura.rise[0], max: st.aura.rise[1] },
        speedX: { min: -12, max: 12 },
        x: { min: -st.aura.spread, max: st.aura.spread },
        y: { min: -2, max: 8 },
        scale: { start: st.aura.scale, end: 0 },
        alpha: { start: st.aura.alpha, end: 0 },
        tint: st.tints,
        blendMode: 'ADD',
      })
      em.setDepth(7)
      return em
    } catch (e) { return null }
  }

  _pulse(x, y, p) {
    const beats = Math.max(1, p.beats ?? 1)
    for (let i = 0; i < beats; i++) {
      const fire = () => AbilityVfx.pulseRing(this._scene, x, y + 6, {
        color: p.color, fromR: 6, toR: p.toR, thickness: p.thickness, alpha: 0.6, durationMs: 360, depth: 6,
      })
      if (i === 0) fire()
      else this._scene.time.delayedCall(i * (p.beatGapMs ?? 150), fire)
    }
  }

  _killAura(rec) {
    try { rec?.em?.stop?.() } catch (e) {}
    try { this._scene.time.delayedCall(900, () => { try { rec?.em?.destroy?.() } catch (e) {} }) } catch (e) { try { rec?.em?.destroy?.() } catch (e2) {} }
  }
}

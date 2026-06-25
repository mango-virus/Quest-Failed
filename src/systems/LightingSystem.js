import { Balance } from '../config/balance.js'
import { EventBus } from './EventBus.js'

// LightingSystem — VFX Frontier #2: fake dynamic lighting. Soft additive radial
// light POOLS that brighten the dark dungeon floor and, crucially, FOLLOW their
// source — the boss carries an ominous glow as it roams, and fireballs / meteors
// / big ability casts throw a burst of light into the room (`a fireball lights
// the room`). No normal maps — just an additive radial-gradient sprite, tinted.
//
// Two kinds of light:
//   • PERSISTENT (Map keyed by id) — re-positioned every frame via a follow()
//     fn, gently pulsing. The boss light is the headline one.
//   • EPHEMERAL flashes — fire-and-forget pops that grow + fade then self-destroy
//     (call `flash(x, y, opts)` from any VFX / system).
//
// The pool sprite is a real radial gradient (canvas texture) — smoother than the
// concentric-circle glows used elsewhere — tinted white→colour, ADD-blended,
// drawn BELOW the entity layer (~7) so it warms the floor without washing out
// the creatures standing on it. Save-safe (all Phaser objects live here, never
// on GameState), gated by the `qf.video.lighting` setting, perf-capped.

const TS = Balance.TILE_SIZE
const TEX_KEY = '__qf_lightpool'
const TEX_KEY_SOFT = '__qf_lightpool_soft'  // wider/gentler falloff — torches only
const TEX_R = 96                 // half-size of the gradient texture
// Torch/ability light glow renders OVER the dungeon — above the door skins
// (DungeonRenderer draws them at 1.6 AND a depth-9 copy masked to the outer
// doorway cells), so the light illuminates the door instead of the door art
// covering it. 9.5 sits just above the highest world layer (door skins / door
// sprites / overhead / decor-object, all ~8.9–9) and below the void mask (12),
// so the glow lights floor + walls + doors + creatures but stays inside rooms.
const LIGHT_DEPTH = 9.5
// The boss follow-light renders UNDER the boss (and other entities) so it pools
// on the floor without tinting the sprite — below the boss's Y-sort depth
// (7 + worldY*0.0005 ≈ 7.3+) but above the floor.
const BOSS_LIGHT_DEPTH = 6.5
const MAX_EPHEMERAL = 40         // perf cap on simultaneous flashes

// BLOOM CORE — a tighter, brighter additive glow co-located with each light, so
// the bright SOURCE itself (torch flame, spell cast, boss) visibly blooms — not
// just the broad floor pool. Uses the HOT (sharp-centre) texture over the soft
// pool, ADD-blended → the centre reads as an over-bright bloom that bleeds into
// its surroundings. This restores the soft glow the old scene post-FX bloom gave,
// but the 2D way: a per-source halo composited additively, so the base pixel art
// stays perfectly crisp and it's resize-safe (no offscreen render target).
const CORE_R_FRAC     = 0.46     // core radius as a fraction of the light radius
const CORE_ALPHA_MULT = 0.95     // core peak alpha relative to the light's alpha

// Per-archetype boss light tint — a little flavour (hot demon, sickly myconid,
// violet lich…). Falls back to a warm ember for anything unlisted.
const BOSS_LIGHT_COLOR = {
  demon: 0xff5530, lich: 0x9b6bff, vampire: 0xff3a6a, myconid: 0x88dd55,
  wraith: 0x7fd8ff, golem: 0xffae5a, slime: 0x66dd88, beholder: 0xff7ade,
  gnoll: 0xffa64d, lizardman: 0x7fe0a0, orc: 0xff8c4d, succubus: 0xff5fae,
}
const BOSS_LIGHT_FALLBACK = 0xff7a3a

function _lightingOn() {
  try { return localStorage.getItem('qf.video.lighting') !== 'false' } catch { return true }
}

// Smooth white radial-gradient texture (alpha 1 centre → 0 edge), generated once.
function _ensureTexture(scene) {
  if (scene.textures.exists(TEX_KEY)) return TEX_KEY
  try {
    const cv = scene.textures.createCanvas(TEX_KEY, TEX_R * 2, TEX_R * 2)
    const ctx = cv.getContext()
    const g = ctx.createRadialGradient(TEX_R, TEX_R, 0, TEX_R, TEX_R, TEX_R)
    g.addColorStop(0,    'rgba(255,255,255,1)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.5)')
    g.addColorStop(1,    'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, TEX_R * 2, TEX_R * 2)
    cv.refresh()
    return TEX_KEY
  } catch (e) { return null }
}

// A SOFTER, wider radial gradient for torch pools: lower centre (no hot spot)
// + brightness carried much further out before a gentle fade, so a big torch
// light FILLS the room evenly instead of reading as a bright disc. Kept
// separate from the main texture so braziers / boss / ability lights are
// unaffected.
function _ensureSoftTexture(scene) {
  if (scene.textures.exists(TEX_KEY_SOFT)) return TEX_KEY_SOFT
  try {
    const cv = scene.textures.createCanvas(TEX_KEY_SOFT, TEX_R * 2, TEX_R * 2)
    const ctx = cv.getContext()
    const g = ctx.createRadialGradient(TEX_R, TEX_R, 0, TEX_R, TEX_R, TEX_R)
    g.addColorStop(0,    'rgba(255,255,255,0.70)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.42)')
    g.addColorStop(0.85, 'rgba(255,255,255,0.13)')
    g.addColorStop(1,    'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, TEX_R * 2, TEX_R * 2)
    cv.refresh()
    return TEX_KEY_SOFT
  } catch (e) { return null }
}

export class LightingSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._enabled = _lightingOn()
    this._tex = this._enabled ? _ensureTexture(scene) : null
    this._texSoft = this._enabled ? _ensureSoftTexture(scene) : null
    this._lights = new Map()   // id -> { sprite, follow, baseR, baseAlpha, pulse, seed }
    this._ephemeral = []       // { sprite } (self-cleaning via tween)
    // Confine ALL light to within rooms — a geometry mask of every room's
    // footprint, applied to each light sprite, so the additive glow never
    // spills onto the inter-room connectors or the void. Rebuilt each update().
    this._roomMaskG = scene.make.graphics({ add: false })
    this._roomMask  = this._roomMaskG.createGeometryMask()
    this._rebuildRoomMask()
    // update() (mask rebuild) is dead during the night build phase, so refresh
    // the mask whenever rooms change — otherwise a room placed at night gets no
    // light (masked out) until the next day.
    this._onRoomsChanged = () => this._rebuildRoomMask()
    EventBus.on('ROOM_PLACED',  this._onRoomsChanged)
    EventBus.on('ROOM_REMOVED', this._onRoomsChanged)
    EventBus.on('ROOM_MOVED',   this._onRoomsChanged)
    if (this._enabled && this._tex) this._registerBossLight()
  }

  // Fill every room footprint (one rect per room — cheap) so the mask clips
  // light to within rooms. Light on the wall ring stays; light beyond the
  // room's edge (connectors, gaps, void) is masked away.
  _rebuildRoomMask() {
    const g = this._roomMaskG
    if (!g) return
    g.clear()
    g.fillStyle(0xffffff, 1)
    const rooms = this._gameState?.dungeon?.rooms ?? []
    for (const r of rooms) g.fillRect(r.gridX * TS, r.gridY * TS, r.width * TS, r.height * TS)
  }

  // Make a tinted, additive radial pool sprite of pixel-radius r. `soft` picks
  // the wider/gentler torch texture (falls back to the main one if unbuilt).
  _makeSprite(x, y, r, color, alpha, soft = false) {
    const tex = (soft && this._texSoft) ? this._texSoft : this._tex
    const spr = this._scene.add.image(x, y, tex)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(LIGHT_DEPTH)
      .setTint(color)
      .setAlpha(alpha)
    spr.setScale(r / TEX_R)
    if (this._roomMask) spr.setMask(this._roomMask)   // keep the glow within rooms
    return spr
  }

  // Bright bloom-core sprite (hot texture) paired with a light pool. `depth` sits
  // just above the pool so the source glows over it.
  _makeCore(x, y, r, color, alpha, depth) {
    if (!this._tex) return null
    const spr = this._scene.add.image(x, y, this._tex)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(depth)
      .setTint(color)
      .setAlpha(alpha)
    spr.setScale((r * CORE_R_FRAC) / TEX_R)
    if (this._roomMask) spr.setMask(this._roomMask)   // keep the bloom within rooms
    return spr
  }

  // Position / alpha / scale a light's bloom core to match its pool.
  _syncCore(rec, x, y, alpha, scaleMul = 1) {
    const c = rec.core
    if (!c) return
    c.setVisible(true)
    c.setPosition(x, y)
    if (alpha != null) c.setAlpha(Math.max(0, alpha * CORE_ALPHA_MULT))
    c.setScale(((rec.baseR ?? TS) * CORE_R_FRAC / TEX_R) * scaleMul)
  }

  _registerBossLight() {
    const b = this._gameState?.boss
    const color = BOSS_LIGHT_COLOR[b?.definitionId] ?? BOSS_LIGHT_FALLBACK
    // soft texture (like torches/braziers) so it reads the same dimness, not a
    // sharper/brighter pool at the same alpha.
    const sprite = this._makeSprite(b?.worldX ?? 0, b?.worldY ?? 0, TS * 2.8, color, 0.0, true)
    sprite.setDepth(BOSS_LIGHT_DEPTH)   // under the boss sprite — pools on the floor, no tint
    const core = this._makeCore(b?.worldX ?? 0, b?.worldY ?? 0, TS * 2.8, color, 0, BOSS_LIGHT_DEPTH + 0.05)
    this._lights.set('boss', { sprite, core, follow: () => this._bossPos(), baseR: TS * 2.8, baseAlpha: 0.3, pulse: 0.12, seed: 1.7, color })
  }

  _bossPos() {
    const b = this._gameState?.boss
    if (!b || b.aiState === 'dead') return null
    // Boss stores hp at the top level (not under `resources` like advs/minions).
    const hp = b.hp ?? b.resources?.hp ?? 1
    if (hp <= 0) return null
    if (!Number.isFinite(b.worldX) || !Number.isFinite(b.worldY)) return null
    return { x: b.worldX, y: b.worldY }
  }

  // Register / update a persistent light. follow() returns {x,y} or null to hide.
  setLight(id, opts = {}) {
    if (!this._enabled || !this._tex) return
    let rec = this._lights.get(id)
    const r = opts.radius ?? TS * 2
    const color = opts.color ?? 0xffffff
    if (!rec) {
      rec = { sprite: this._makeSprite(0, 0, r, color, 0, !!opts.soft), seed: Math.random() * 6.28 }
      rec.core = this._makeCore(0, 0, r, color, 0, LIGHT_DEPTH + 0.05)
      this._lights.set(id, rec)
    }
    rec.follow = opts.follow ?? rec.follow
    rec.baseR = r
    rec.baseAlpha = opts.intensity ?? 0.5
    rec.pulse = opts.pulse ?? 0
    rec.color = color
    rec.sprite.setTint(color)
    if (rec.core) rec.core.setTint(color)
  }

  removeLight(id) {
    const rec = this._lights.get(id)
    if (rec) { try { rec.sprite.destroy(); rec.core?.destroy() } catch (e) {} this._lights.delete(id) }
  }

  // Reposition + (optionally) set the live alpha on an EXTERNALLY-DRIVEN light —
  // one registered via setLight() WITHOUT a follow() fn (e.g. torches, whose
  // owner computes the anchor + flicker each frame). update() leaves these
  // alone, so the owner drives them through this. No-ops if lighting is off /
  // the id is unknown.
  moveLight(id, x, y, alpha) {
    const rec = this._lights.get(id)
    if (!rec) return
    rec.sprite.setVisible(true)
    rec.sprite.setPosition(x, y)
    if (alpha != null) rec.sprite.setAlpha(alpha)
    this._syncCore(rec, x, y, alpha)
  }

  // Transient burst of light — grows + fades, then self-destroys. Call from any
  // VFX/system so explosions / fireballs / casts light their surroundings.
  flash(x, y, opts = {}) {
    if (!this._enabled || !this._tex) return null
    if (!(x >= -1e5 && x <= 1e5 && y >= -1e5 && y <= 1e5)) return null
    if (this._ephemeral.length >= MAX_EPHEMERAL) return null
    const o = { color: 0xff8a44, radius: TS * 2.4, durationMs: 380, intensity: 0.85, ...opts }
    const spr = this._makeSprite(x, y, o.radius * 0.7, o.color, o.intensity)
    // Bright bloom core so the cast/explosion blooms, not just lights the floor.
    const core = this._makeCore(x, y, o.radius * 0.7, o.color, o.intensity, LIGHT_DEPTH + 0.1)
    const rec = { sprite: spr, core }
    this._ephemeral.push(rec)
    this._scene.tweens.add({
      targets: spr, scale: (o.radius / TEX_R) * 1.35, alpha: 0,
      duration: o.durationMs, ease: 'Quad.easeOut',
      onComplete: () => {
        try { spr.destroy(); core?.destroy() } catch (e) {}
        const i = this._ephemeral.indexOf(rec)
        if (i >= 0) this._ephemeral.splice(i, 1)
      },
    })
    if (core) this._scene.tweens.add({
      targets: core, scale: ((o.radius * CORE_R_FRAC) / TEX_R) * 1.5, alpha: 0,
      duration: o.durationMs, ease: 'Quad.easeOut',
    })
    return spr
  }

  update() {
    if (!this._enabled) return
    this._rebuildRoomMask()   // rooms may have been placed/moved/sold this frame
    const now = this._scene.time?.now ?? 0
    for (const [, rec] of this._lights) {
      // Externally-driven lights (no follow fn — e.g. torches) are positioned +
      // alpha'd by their owner via moveLight(); skip them here.
      if (!rec.follow) continue
      const pos = rec.follow()
      if (!pos) { rec.sprite.setVisible(false); if (rec.core) rec.core.setVisible(false); continue }
      rec.sprite.setVisible(true)
      rec.sprite.setPosition(pos.x, pos.y)
      // gentle breathing pulse on alpha + scale
      const wob = rec.pulse ? rec.pulse * Math.sin(now / 520 + rec.seed) : 0
      rec.sprite.setAlpha(Math.max(0, rec.baseAlpha * (1 + wob)))
      rec.sprite.setScale((rec.baseR / TEX_R) * (1 + wob * 0.4))
      this._syncCore(rec, pos.x, pos.y, rec.baseAlpha * (1 + wob), 1 + wob * 0.4)
    }
  }

  destroy() {
    for (const [, rec] of this._lights) { try { rec.sprite.destroy(); rec.core?.destroy() } catch (e) {} }
    this._lights.clear()
    for (const rec of this._ephemeral) { try { rec.sprite.destroy(); rec.core?.destroy() } catch (e) {} }
    this._ephemeral = []
    EventBus.off('ROOM_PLACED',  this._onRoomsChanged)
    EventBus.off('ROOM_REMOVED', this._onRoomsChanged)
    EventBus.off('ROOM_MOVED',   this._onRoomsChanged)
    try { this._roomMaskG?.destroy() } catch (e) {}
  }
}

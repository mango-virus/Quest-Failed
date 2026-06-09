import { EventBus }   from './EventBus.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'
import { Balance }    from '../config/balance.js'

// MomentVfxSystem — world-space VFX for the game's BIG discrete moments (the
// hero beats + meaningful gameplay events) that previously had no world reaction
// or only a DOM cinematic. Event-driven (no tick). Each handler composes the
// AbilityVfx toolkit + the lighting flash + the post-fx pulse + a routed shake,
// at the resolved world position. Save-safe (no GameState writes), leak-safe
// (listeners off in destroy), all downstream calls optional-chained.
//
//   BOSS_ASCENSION    boss dark-ascension → violet radiant burst + big flash + pulse
//   RUN_VICTORY       run won            → golden celebratory burst + warm flash + pulse
//   BOSS_LEVELED_UP   boss gains a level → gold glow-pulse + sparkle + flash + shake
//   MINION_EVOLVED    minion evolves     → radial burst + sparkle + light pop
//   *_SPAWNED (summons) minion appears   → small light pop + sparkle
//   TRAP_EXPLODED     bomb detonates     → shockwave ring + impact + big flash + shake + pulse

const TS = Balance.TILE_SIZE

export class MomentVfxSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('BOSS_ASCENSION',                 this._onAscension)
    on('RUN_VICTORY',                    this._onVictory)
    on('BOSS_LEVELED_UP',                this._onBossLevelUp)
    on('MINION_EVOLVED',                 this._onMinionEvolved)
    on('SUMMON_ADD_SPAWNED',             this._onMinionSpawned)
    on('WRAITH_HAUNT_SPAWNED',           this._onMinionSpawned)
    on('MIRROR_TWIN_SPAWNED',            this._onMinionSpawned)
    on('PACT_BOSS_DOPPELGANGERS_SPAWNED', this._onDoppelSpawned)
    on('TRAP_EXPLODED',                  this._onTrapExploded)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) { try { EventBus.off(evt, fn, this) } catch (e) {} }
    this._listeners = []
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  get _fx() { return AbilityVfx }
  _bossXY() { const b = this._gameState?.boss; return b && Number.isFinite(b.worldX) ? { x: b.worldX, y: b.worldY } : null }
  _flash(x, y, o) { if (Number.isFinite(x) && Number.isFinite(y)) this._scene.lightingSystem?.flash(x, y, o) }
  _pulse(s)  { this._scene.scenePostFx?.pulse(s) }
  _shake(lv) { this._scene.screenShakeSystem?.shake(lv) }
  _minionById(id) { return (this._gameState?.minions ?? []).find(m => m.instanceId === id) ?? null }

  // ── handlers ─────────────────────────────────────────────────────────────

  // Dark ascension — the boss transforms. The biggest world beat: violet
  // radiance erupting off the boss, the room flashing dark-violet, a hard pulse.
  _onAscension() {
    const p = this._bossXY(); if (!p) return
    const V = 0x9b6bff, V2 = 0x6a2fd0
    this._fx.shockwaveFx?.(this._scene, p.x, p.y, { color: V, fromR: 14, toR: 180, rings: 2, durationMs: 700 })
    this._fx.burstRays?.(this._scene, p.x, p.y, { color: V2, count: 16, length: 130, durationMs: 620 })
    this._fx.particleBurstFx?.(this._scene, p.x, p.y, { color: V, count: 30, speed: 150, durationMs: 700 })
    this._fx.glowPulseFx?.(this._scene, p.x, p.y, { color: V, r: 70, durationMs: 900, motes: 14 })
    this._flash(p.x, p.y, { color: V, radius: TS * 5, durationMs: 800, intensity: 1.0 })
    this._shake('big'); this._pulse(1.3)
  }

  // Victory — golden, triumphant. Warm radiance off the boss/throne.
  _onVictory() {
    const p = this._bossXY(); if (!p) return
    const G = 0xffe066, G2 = 0xffd23f
    this._fx.shockwaveFx?.(this._scene, p.x, p.y, { color: G, fromR: 14, toR: 200, rings: 3, durationMs: 800 })
    this._fx.burstRays?.(this._scene, p.x, p.y, { color: G2, count: 20, length: 150, durationMs: 750 })
    this._fx.particleBurstFx?.(this._scene, p.x, p.y, { color: G, count: 36, speed: 170, durationMs: 850 })
    this._fx.glowPulseFx?.(this._scene, p.x, p.y, { color: G, r: 80, durationMs: 1100, motes: 18 })
    this._flash(p.x, p.y, { color: G, radius: TS * 6, durationMs: 1000, intensity: 1.0 })
    this._shake('medium'); this._pulse(1.0)
  }

  // Boss gains a level — a rare, meaningful power-up beat.
  _onBossLevelUp() {
    const p = this._bossXY(); if (!p) return
    const C = 0xffd060
    this._fx.glowPulseFx?.(this._scene, p.x, p.y, { color: C, r: 56, durationMs: 800, motes: 12 })
    this._fx.sparkleFx?.(this._scene, p.x, p.y, { color: 0xfff2c0, count: 12, r: 40, durationMs: 700 })
    this._fx.shockwaveFx?.(this._scene, p.x, p.y, { color: C, fromR: 10, toR: 90, durationMs: 520 })
    this._flash(p.x, p.y, { color: C, radius: TS * 3, durationMs: 520, intensity: 0.9 })
    this._shake('small'); this._pulse(0.5)
  }

  // Minion evolves into a stronger form — a satisfying radial burst on it.
  _onMinionEvolved({ minion } = {}) {
    const m = minion; if (!m || !Number.isFinite(m.worldX)) return
    const C = 0x88dd66
    this._fx.shockwaveFx?.(this._scene, m.worldX, m.worldY, { color: C, fromR: 8, toR: 64, durationMs: 480 })
    this._fx.sparkleFx?.(this._scene, m.worldX, m.worldY, { color: 0xccff99, count: 10, r: 28, durationMs: 560 })
    this._flash(m.worldX, m.worldY, { color: C, radius: TS * 2, durationMs: 420, intensity: 0.8 })
  }

  // A minion is summoned into the world — small light pop + sparkle so it
  // doesn't appear from nothing. Resolves position from whatever the payload has.
  _onMinionSpawned(payload = {}) {
    const m = payload.minion ?? this._minionById(payload.minionId ?? payload.twinId)
    if (!m || !Number.isFinite(m.worldX)) return
    this._fx.sparkleFx?.(this._scene, m.worldX, m.worldY, { color: 0xc9a6ff, count: 8, r: 24, durationMs: 480 })
    this._flash(m.worldX, m.worldY, { color: 0x9b6bff, radius: TS * 1.6, durationMs: 360, intensity: 0.6 })
  }

  _onDoppelSpawned({ x, y } = {}) {
    if (!Number.isFinite(x)) return
    this._fx.sparkleFx?.(this._scene, x, y, { color: 0xc9a6ff, count: 10, r: 30, durationMs: 480 })
    this._flash(x, y, { color: 0x9b6bff, radius: TS * 2, durationMs: 400, intensity: 0.7 })
  }

  // Bomb / explosive trap detonates — a real explosion: shockwave + impact +
  // a big light flash + shake + pulse, scaled to the splash radius.
  _onTrapExploded({ worldX, worldY, radius } = {}) {
    if (!Number.isFinite(worldX)) return
    const r = (radius ?? 3) * TS
    this._fx.shockwaveFx?.(this._scene, worldX, worldY, { color: 0xff7a30, fromR: 12, toR: Math.max(80, r), rings: 2, durationMs: 560 })
    this._fx.impactFx?.(this._scene, worldX, worldY, { tint: 0xffaa44, count: 20, durationMs: 420 })
    this._flash(worldX, worldY, { color: 0xff7a30, radius: Math.max(TS * 2.5, r), durationMs: 520, intensity: 1.0 })
    this._shake('medium'); this._pulse(0.7)
  }
}

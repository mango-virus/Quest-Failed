import { EventBus } from './EventBus.js'

// CombatJuiceSystem — VFX Frontier #3: wire the impact primitives into ACTUAL
// combat so the big moments LAND. Listens to a curated set of combat events and
// fires:
//   • LightingSystem.flash()   — a burst of light at the impact/death point
//   • ScenePostFxSystem.pulse() — a brief barrel+bloom screen punch (biggest moments)
//   • ScreenShakeSystem.shake() — routed through the existing system so it still
//     respects the user's shake setting + throttle (no double-shake)
//
// Deliberately TASTEFUL — only impactful beats get juice, never every tick:
//   ADVENTURER_DIED  a hero falls   → light pop + small shake + small pulse
//   BOSS_MELEE_HIT   boss slam      → light flash on the victim + medium shake + pulse
//   BOSS_DAMAGED     big hit to boss→ light flash on boss + shake/pulse SCALED by chunk
//   MINION_DIED      minion dies    → small light pop only (frequent → no shake/pulse)
// COMBAT_HIT/COMBAT_KILL are intentionally NOT juiced here — HitSparkSystem +
// ScreenShakeSystem already cover hits, and ADVENTURER_DIED/MINION_DIED cover the
// deaths without double-firing.
//
// Save-safe (no GameState writes) + leak-safe (EventBus listeners off in destroy).
// All effect calls are optional-chained, so it degrades gracefully if a target
// system is disabled (e.g. lighting/post-fx/shake turned off in settings).

const PULSE_GAP_MS = 200   // throttle screen pulses so a wave-wipe can't strobe

// damageType → flash tint, so a fire kill lights orange, poison green, etc.
const DMG_COLOR = {
  fire: 0xff7a30, burn: 0xff7a30, poison: 0x88dd44, holy: 0xffe066,
  shadow: 0x9b6bff, arcane: 0xff5fbf, ice: 0x88d6ff, lightning: 0xbfe0ff,
  physical: 0xffd2a0,
}
const DEFAULT_COLOR = 0xffd2a0

export class CombatJuiceSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._lastPulse = 0
    this._listeners = []
    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('ADVENTURER_DIED', this._onAdvDied)
    on('MINION_DIED',     this._onMinionDied)
    on('BOSS_MELEE_HIT',  this._onBossSlam)
    on('BOSS_DAMAGED',    this._onBossDamaged)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) { try { EventBus.off(evt, fn, this) } catch (e) {} }
    this._listeners = []
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  _color(type) { return DMG_COLOR[type] ?? DEFAULT_COLOR }

  _entityById(id) {
    const gs = this._gameState
    if (id == null) return null
    if (gs?.boss && (id === 'boss' || gs.boss.instanceId === id)) return gs.boss
    return (gs?.adventurers?.active ?? []).find(a => a.instanceId === id)
        ?? (gs?.minions ?? []).find(m => m.instanceId === id)
        ?? null
  }

  _flash(x, y, opts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    this._scene.lightingSystem?.flash(x, y, opts)
  }

  _shake(level) { this._scene.screenShakeSystem?.shake(level) }

  _pulse(strength) {
    const now = this._scene.time?.now ?? 0
    if (now - this._lastPulse < PULSE_GAP_MS) return
    this._lastPulse = now
    this._scene.scenePostFx?.pulse(strength)
  }

  // ── handlers ─────────────────────────────────────────────────────────────

  // A hero falls — satisfying beat for the dungeon-boss player.
  _onAdvDied({ adventurer, damageType } = {}) {
    const a = adventurer
    if (!a || !Number.isFinite(a.worldX)) return
    const col = this._color(damageType)
    this._flash(a.worldX, a.worldY, { color: col, radius: 96, durationMs: 460, intensity: 0.95 })
    this._shake('small')
    this._pulse(0.45)
  }

  // A minion dies — frequent, so keep it to a small cheap light pop.
  _onMinionDied({ minion } = {}) {
    const m = minion
    if (!m || !Number.isFinite(m.worldX)) return
    this._flash(m.worldX, m.worldY, { color: 0xffb060, radius: 52, durationMs: 300, intensity: 0.6 })
  }

  // The boss lands a melee hit — a heavy SLAM.
  _onBossSlam({ targetId, damage } = {}) {
    const t = this._entityById(targetId)
    const bx = t?.worldX ?? this._gameState?.boss?.worldX
    const by = t?.worldY ?? this._gameState?.boss?.worldY
    this._flash(bx, by, { color: 0xff5530, radius: 104, durationMs: 420, intensity: 1.0 })
    this._shake('medium')
    this._pulse(0.7)
  }

  // The boss takes damage — only react when it's a real CHUNK, scaled by size.
  _onBossDamaged({ amount, hpAfter } = {}) {
    const boss = this._gameState?.boss
    if (!boss || typeof amount !== 'number' || amount <= 0) return
    const maxHp = boss.maxHp ?? boss.resources?.maxHp ?? 0
    if (maxHp <= 0) return
    const frac = amount / maxHp
    if (frac < 0.04) return                 // chip damage — let HitSpark handle it
    const big = frac >= 0.12
    this._flash(boss.worldX, boss.worldY, { color: 0xffe0a0, radius: big ? 120 : 90, durationMs: 420, intensity: big ? 1.0 : 0.8 })
    this._shake(big ? 'big' : 'medium')
    if (big) this._pulse(0.9)
  }
}

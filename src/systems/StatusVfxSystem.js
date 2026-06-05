import { AbilityVfx } from '../ui/AbilityVfx.js'

// StatusVfxSystem — paints a PERSISTENT aura on any entity currently afflicted by
// a damage-over-time status (poison / burn), filling the gap where a DoT was only
// a once-per-second floating number with no lingering "this unit is on fire /
// poisoned" read. Polls every frame, mirrors each afflicted entity's _dot[] to a
// followed `statusAuraFx` emitter, and tears the emitter down the instant the DoT
// expires or the entity dies/vanishes.
//
// SAVE-SAFETY: every Phaser object lives in THIS system's `_active` Map keyed by
// instanceId — never on the entity. GameState stays JSON-serializable; nothing to
// strip in SaveSystem. On load the entity's `_dot[]` rehydrates and the aura is
// simply re-created on the next tick.
//
// PERF: capped at MAX_AURAS concurrent emitters (late-game waves can poison many
// adventurers at once); the emitter itself is low-rate + additive so the cap is a
// safety net, not a usual limit. Honours the particles quality setting via
// statusAuraFx (returns null when particles are off → system no-ops cleanly).

const MAX_AURAS = 28

// DoT type → aura palette. burn reads hotter, poison sickly-green. burn wins when
// an entity carries both (the more legible "danger" read).
const TYPE_PALETTE = { burn: 'fire', poison: 'poison' }

export class StatusVfxSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gameState = gameState
    this._active = new Map() // instanceId -> { em, type }
  }

  // Called from Game.update()'s day render tick.
  update() {
    const gs = this._gameState
    if (!gs) return
    const seen = new Set()

    const advs = gs.adventurers?.active ?? []
    const minions = gs.minions ?? []
    this._scan(advs, seen)
    this._scan(minions, seen)

    // Reap auras whose entity no longer qualifies (DoT cleared, dead, gone).
    if (this._active.size) {
      for (const [id, rec] of this._active) {
        if (!seen.has(id)) { this._kill(rec); this._active.delete(id) }
      }
    }
  }

  _scan(list, seen) {
    for (const e of list) {
      if (!e || !e._dot || e._dot.length === 0) continue
      if (e.aiState === 'dead' || (e.resources?.hp ?? 0) <= 0) continue
      const id = e.instanceId
      if (id == null) continue
      const type = this._dominant(e._dot)
      if (!type) continue

      let rec = this._active.get(id)
      // Status changed type (poison→burn) — swap the aura.
      if (rec && rec.type !== type) { this._kill(rec); this._active.delete(id); rec = null }
      if (!rec) {
        if (this._active.size >= MAX_AURAS) continue // cap: skip new auras, keep existing
        const em = AbilityVfx.statusAuraFx(this._scene, e.worldX ?? 0, e.worldY ?? 0, { palette: TYPE_PALETTE[type] })
        if (!em) continue // particles off
        rec = { em, type }
        this._active.set(id, rec)
      }
      seen.add(id)
      // Follow the entity (advs walk; minions roam).
      try { rec.em.setPosition(e.worldX ?? 0, e.worldY ?? 0) } catch (err) {}
    }
  }

  _dominant(dots) {
    let hasPoison = false
    for (const d of dots) {
      if (d.type === 'burn') return 'burn'
      if (d.type === 'poison') hasPoison = true
    }
    return hasPoison ? 'poison' : null
  }

  _kill(rec) {
    try { rec.em.stop() } catch (e) {}
    try { rec.em.destroy() } catch (e) {}
  }

  destroy() {
    for (const [, rec] of this._active) this._kill(rec)
    this._active.clear()
  }
}

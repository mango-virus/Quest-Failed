// DungeonFx — Phase 34D dungeon-view FX layer.
//
// Owns the DOM-side overlay effects that sit over the Phaser dungeon
// view but below the HUD chrome. One layer mounted inside #hud-stage
// at z-index 5 (Phaser canvas is z:0, HUD chrome z:9-10).
//
// Surfaces:
//   1. Chromatic aberration — fullscreen .chromatic class (day/night variants)
//   2. Phase tint            — cool blue at night / warm red by day, fade on phase change
//   3. Ambient particles     — dust motes + embers, count scaled by user setting
//   4. Floating combat numbers — DOM elements at sprite worldX/worldY for COMBAT_HIT
//
// Brazier light cones were removed at user request (2026-05-19) — see git history
// for the prior implementation if we want to revisit.
//
// Coord conversion: Phaser runs Scale.RESIZE (native-res canvas), and the DOM
// FX layer is mounted inside the zoomed #hud-stage. _worldToStage() maps a world
// point through the camera's worldView into canvas CSS px, then divides by uiScale
// to land in the stage's logical coords (the stage's zoom re-applies it). No-op at
// uiScale 1; keeps combat floats on their entity at 4K (uiScale 2) and on small
// screens (sub-1× downscale). See _worldToStage.

import { h } from './dom.js'
import { EventBus } from '../systems/EventBus.js'
import { ensureStageScaled, effectiveUiScale } from './stageScale.js'
import { userSettings } from './userSettings.js'

const FLOAT_TTL = 1200       // ms — matches .combat-float keyframe
const MAX_FLOATS = 24        // ring cap, oldest evict

export class DungeonFx {
  constructor(gameState) {
    this._gameState = gameState
    this._listeners = []
    this._floats = []        // active floating-number DOM nodes
    this._particles = []     // {el, kind}

    this._build()
    ensureStageScaled()
    this._wireEvents()
    this._spawnAmbient()
  }

  _build() {
    this._stage = document.getElementById('hud-stage')
    if (!this._stage) return
    // Single FX layer parent — z-index sits between canvas (0) and HUD
    // chrome (9-10). Pointer-events: none so clicks pass through to the
    // Phaser canvas.
    this.el = h('div', { className: 'qf-fx', id: 'qf-fx' }, [
      h('div', { className: 'qf-fx-chromatic', ref: el => { this._chromatic = el } }),
      h('div', { className: 'qf-fx-phasetint', ref: el => { this._phaseTint = el } }),
      // Dungeon-viewport vignette. Visibility gated by the
      // `.dungeon-vignette` class on #hud-root (set/cleared by
      // SettingsOverlay._applyVideoFlags). Sits ABOVE chromatic/tint
      // so the darkening reads against any phase color, BELOW the
      // ambient particles + floating combat numbers so motes and
      // damage pop above the haze.
      h('div', { className: 'qf-fx-dungeon-vignette' }),
      h('div', { className: 'qf-fx-ambient',   ref: el => { this._ambient = el } }),
      h('div', { className: 'qf-fx-floats',    ref: el => { this._floatLayer = el } }),
    ])
    this._stage.appendChild(this.el)
    // Initial day/night tint to match current phase.
    this._applyPhase(this._gameState.meta?.phase ?? 'night')
  }

  _wireEvents() {
    const sub = (event, fn) => { EventBus.on(event, fn); this._listeners.push([event, fn]) }
    sub('DAY_PHASE_BEGAN',   () => this._applyPhase('day'))
    sub('NIGHT_PHASE_BEGAN', () => this._applyPhase('night'))
    sub('COMBAT_HIT',        (p) => this._onCombatHit(p))
    sub('ADVENTURER_DIED',   (p) => this._onAdvDied(p))
    sub('MINION_DIED',       (p) => this._onMinionDied(p))
    sub('STATUS_APPLIED',    (p) => this._onStatusApplied(p))
  }

  // Generic status-text float. Status systems emit STATUS_APPLIED with
  // `{ targetId, label, color? }` when an effect lands (poisoned,
  // petrified, charmed, etc.). DungeonFx renders the label above the
  // target via the floating-numbers pipeline. Color falls back to a
  // per-label palette so callers don't need to know hex values.
  _onStatusApplied({ targetId, label, color } = {}) {
    if (!label) return
    const target = this._lookupEntity(targetId)
    if (!target) return
    const kind = `status-${String(label).toLowerCase().replace(/[^a-z0-9-]/g, '')}`
    const el = this._spawnFloat({
      text:  String(label).toUpperCase(),
      kind,
      worldX: target.worldX,
      worldY: (target.worldY ?? 0) - 6,
    })
    // Caller-provided color wins over the per-kind CSS fallback.
    if (el && color) el.style.color = color
  }

  _applyPhase(phase) {
    const isDay = phase === 'day'
    if (this._chromatic) this._chromatic.classList.toggle('day', isDay)
    if (this._phaseTint) {
      this._phaseTint.style.background = isDay
        ? 'rgba(255, 80, 30, 0.06)'
        : 'rgba(40, 60, 140, 0.10)'
    }
  }

  // ─── Ambient particles ─────────────────────────────────────────
  _spawnAmbient() {
    if (!this._ambient) return
    const mult = userSettings.particlesMultiplier()
    const moteCount  = Math.round(38 * mult)
    const emberCount = Math.round(14 * mult)
    this._ambient.replaceChildren()
    this._particles = []
    for (let i = 0; i < moteCount; i++) {
      // Distribute motes across the entire dungeon view, not just the
      // bottom edge. Each mote rises through a portion of the viewport
      // (see mote-drift keyframe); randomized start positions + delays
      // give continuous coverage top-to-bottom.
      const el = h('div', {
        className: 'particle mote',
        style: {
          left:  `${Math.random() * 100}%`,
          top:   `${Math.random() * 110}%`,
          animationDuration: `${8 + Math.random() * 8}s`,
          animationDelay:    `${-Math.random() * 12}s`,
        },
      })
      this._ambient.appendChild(el)
      this._particles.push({ el, kind: 'mote' })
    }
    for (let i = 0; i < emberCount; i++) {
      // Spread embers across the full dungeon view. Originally clustered
      // around bottom-center (a stand-in for brazier hotspots) but the
      // braziers were removed, so cluster-anchoring no longer makes sense.
      const el = h('div', {
        className: 'particle ember',
        style: {
          left:  `${Math.random() * 100}%`,
          top:   `${20 + Math.random() * 80}%`,
          animationDuration: `${4 + Math.random() * 4}s`,
          animationDelay:    `${-Math.random() * 6}s`,
        },
      })
      this._ambient.appendChild(el)
      this._particles.push({ el, kind: 'ember' })
    }
  }

  // ─── Floating combat numbers ───────────────────────────────────
  _onCombatHit({ targetId, damage, isCritical } = {}) {
    if (typeof damage !== 'number') return
    const target = this._lookupEntity(targetId)
    if (!target) return
    if (damage <= 0) {
      this._spawnFloat({ text: 'MISS', kind: 'miss',
        worldX: target.worldX, worldY: target.worldY })
      return
    }
    this._spawnFloat({
      text: `-${Math.round(damage)}`,
      kind: isCritical ? 'crit' : 'damage',
      worldX: target.worldX,
      worldY: target.worldY,
    })
  }

  _onAdvDied({ adventurer } = {}) {
    if (!adventurer) return
    this._spawnFloat({
      text: '☠',
      kind: 'kill',
      worldX: adventurer.worldX,
      worldY: adventurer.worldY,
    })
    // Gold drop tag — bookkeep separately to avoid stacking with the skull.
    const gold = adventurer.goldDropped
    if (typeof gold === 'number' && gold > 0) {
      setTimeout(() => this._spawnFloat({
        text: `+${gold}g`,
        kind: 'gold',
        worldX: adventurer.worldX,
        worldY: (adventurer.worldY ?? 0) - 20,
      }), 220)
    }
  }

  _onMinionDied({ minion } = {}) {
    if (!minion) return
    this._spawnFloat({
      text: '✦',
      kind: 'minion-fell',
      worldX: minion.worldX,
      worldY: minion.worldY,
    })
  }

  _spawnFloat({ text, kind, worldX, worldY }) {
    if (!this._floatLayer || worldX == null || worldY == null) return
    const stagePos = this._worldToStage(worldX, worldY)
    if (!stagePos) return
    const el = h('div', {
      className: `combat-float qf-fx-float qf-fx-float-${kind}`,
      style: {
        left: `${stagePos.x}px`,
        top:  `${stagePos.y - 24}px`,
      },
    }, text)
    this._floatLayer.appendChild(el)
    const entry = { el, born: performance.now() }
    this._floats.push(entry)
    if (this._floats.length > MAX_FLOATS) {
      const old = this._floats.shift()
      old.el.remove()
    }
    setTimeout(() => {
      el.remove()
      const i = this._floats.indexOf(entry)
      if (i >= 0) this._floats.splice(i, 1)
    }, FLOAT_TTL)
    return el
  }

  _lookupEntity(id) {
    if (!id) return null
    const minions = this._gameState.minions ?? []
    const m = minions.find(x => x.instanceId === id)
    if (m) return m
    const advs = this._gameState.adventurers?.active ?? []
    return advs.find(x => x.instanceId === id) || null
  }

  // Convert Phaser world coords to stage (logical) coords. Returns null
  // when no Game scene is active.
  //
  // Uses cam.worldView (the actual visible world rect) rather than the
  // naive `(worldX - cam.scrollX) * cam.zoom`. Phaser cameras zoom
  // around the VIEWPORT CENTER, so the naive formula silently drifts
  // off whenever the camera zoom != 1 — which is why floating numbers
  // were landing in the wrong place. cam.worldView already accounts
  // for the midpoint pivot.
  _worldToStage(worldX, worldY) {
    const gs = window.__game?.scene?.getScene?.('Game')
    const cam = gs?.cameras?.main
    if (!cam || !gs.scene.isActive()) return null
    const wv = cam.worldView
    if (!wv || !wv.width || !wv.height) return null
    // Map the world rect into the camera's viewport rect, then offset by the
    // viewport's own position on the canvas (cam.x / cam.y) — this gives canvas
    // CSS px. The FX layer lives inside #hud-stage, which stageScale zooms by
    // uiScale, so divide by uiScale to land in the stage's LOGICAL coords (logical
    // × uiScale == canvas px == where the entity is). No-op at uiScale 1; required
    // at uiScale ≠ 1 (4K → 2, and small screens → sub-1× via the downscale).
    const ui = effectiveUiScale() || 1
    return {
      x: ((worldX - wv.x) / wv.width  * cam.width  + (cam.x ?? 0)) / ui,
      y: ((worldY - wv.y) / wv.height * cam.height + (cam.y ?? 0)) / ui,
    }
  }

  // ─── Settings hook ─────────────────────────────────────────────
  // Settings overlay calls this on APPLY when particles level changes.
  refreshFromSettings() {
    this._spawnAmbient()
  }

  destroy() {
    for (const [event, fn] of this._listeners) EventBus.off(event, fn)
    this._listeners = []
    for (const f of this._floats) f.el.remove()
    this._floats = []
    this.el?.remove()
  }
}

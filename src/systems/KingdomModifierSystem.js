// KingdomModifierSystem — KR P4 (deep modifiers). Hosts the rule-bending
// signature mechanics that make each Kingdom Response feel UNIQUE, on top of the
// themed champion + retinue composition (which lives in DayPhase). One system
// owns the event/tick-driven modifier behaviours; the few that gate EXISTING
// systems (Inquisition pact-suppress, Betrayer trap-blackout) expose an
// `isActive(id)` helper those systems check.
//
// Gated behind the `acts` flag; Game.js only constructs it when acts are on.
// Built incrementally — one response's modifier at a time. See DESIGN.md →
// "Acts II & III — The Kingdom Responds" and the kr-response-* coverage rows.

import { EventBus } from './EventBus.js'

// Forlorn Hope — each fallen martyr stokes the survivors' fury. Per-death
// multipliers (compounding); a ~6-strong squad tops out around ×1.9 atk / ×1.5
// speed, so it ramps hard the longer you let the fight drag without ending it.
const FORLORN_ATK_PER_DEATH   = 1.12
const FORLORN_SPEED_PER_DEATH = 1.08

export class KingdomModifierSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs = gameState
    EventBus.on('ADVENTURER_DIED', this._onAdventurerDied, this)
  }

  destroy() {
    EventBus.off('ADVENTURER_DIED', this._onAdventurerDied, this)
  }

  // Which Kingdom Response is governing the current act (or null). Act-wide
  // modifiers (Inquisition, Betrayer) gate on this; entity-behaviour modifiers
  // (Forlorn fury, etc.) self-gate on per-entity flags and don't need it.
  activeResponseId() {
    const act = this._gs.meta?.act?.current
    return act ? (this._gs.meta?.act?.responses?.[act] ?? null) : null
  }

  // True when `id`'s act-wide modifier should currently apply.
  isActive(id) {
    return this.activeResponseId() === id
  }

  // ── ADVENTURER_DIED router ──────────────────────────────────────────────────
  _onAdventurerDied({ adventurer } = {}) {
    if (!adventurer) return
    if (adventurer.flags?.forlornMartyr) this._forlornFury(adventurer)
  }

  // Forlorn Hope (escalating fury). A martyr fell — every surviving martyr in the
  // squad surges with atk + speed. Compounds per death; the captain counts too.
  _forlornFury(fallen) {
    const living = (this._gs.adventurers?.active ?? []).filter(a =>
      a !== fallen && a.flags?.forlornMartyr && (a.resources?.hp ?? 0) > 0)
    if (living.length === 0) return
    for (const a of living) {
      a.stats ??= {}
      a.stats.attack = Math.round((a.stats.attack ?? 10) * FORLORN_ATK_PER_DEATH)
      a.stats.speed  = (a.stats.speed ?? 1.4) * FORLORN_SPEED_PER_DEATH
      a._furyStacks  = (a._furyStacks ?? 0) + 1
    }
    EventBus.emit('FORLORN_FURY', {
      stacks: living[0]?._furyStacks ?? 1, remaining: living.length, fallen: fallen.name,
    })
  }
}

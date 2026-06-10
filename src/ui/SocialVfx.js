// SocialVfx — turns the AI & Personality Overhaul's social/reaction events into
// world-space VFX, composed from the AbilityVfx toolkit (no hand-drawn Graphics,
// no new art). Event-driven only — there's no per-frame update; it just listens.
//
//   PARTY_CONFER  → a huddle ring + a soft glow + thin beams linking the members
//                   (the visible "they're conferring" beat — Thread 3).
//   MARTYR_TAUNT  → a defiant double shockwave + a "TAUNT!" punch.
//   ADV_REACT_ROOM→ a small per-reaction accent (greed sparkle / dread ! / awe … /
//                   ghost ? / study glow / rally ring) — Enhancements B/C + roster.
//
// All beats are already self-rate-limited at the source (reactions are once-per-
// room-per-adv, confers are cooldown-gated, taunts fire once per low-HP crossing),
// so there's no extra throttle here. Each effect is short-lived and self-destroys.

import { EventBus } from '../systems/EventBus.js'
import { AbilityVfx } from './AbilityVfx.js'

export class SocialVfx {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs    = gameState
    EventBus.on('PARTY_CONFER',     this._onConfer,    this)
    EventBus.on('MARTYR_TAUNT',     this._onTaunt,     this)
    EventBus.on('ADV_REACT_ROOM',   this._onReact,     this)
    EventBus.on('HERO_LAST_STAND',  this._onLastStand, this)
    EventBus.on('ADV_AVENGE',       this._onAvenge,    this)
    EventBus.on('ADV_RALLY',        this._onRally,     this)
    EventBus.on('COLLECTIVE_MORALE', this._onCollective, this)
  }

  destroy() {
    EventBus.off('PARTY_CONFER',     this._onConfer,    this)
    EventBus.off('MARTYR_TAUNT',     this._onTaunt,     this)
    EventBus.off('ADV_REACT_ROOM',   this._onReact,     this)
    EventBus.off('HERO_LAST_STAND',  this._onLastStand, this)
    EventBus.off('ADV_AVENGE',       this._onAvenge,    this)
    EventBus.off('ADV_RALLY',        this._onRally,     this)
    EventBus.off('COLLECTIVE_MORALE', this._onCollective, this)
  }

  _onConfer({ adventurers, x, y } = {}) {
    const s = this._scene
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    AbilityVfx.pulseRing(s, x, y, { color: 0x9fd8ff, fromR: 10, toR: 50, durationMs: 720, alpha: 0.85 })
    AbilityVfx.glowPulseFx(s, x, y, { color: 0x9fd8ff, r: 18, durationMs: 700, motes: 8 })
    for (const a of (adventurers ?? [])) {
      if (a && Number.isFinite(a.worldX) && Number.isFinite(a.worldY) && (a.worldX !== x || a.worldY !== y)) {
        AbilityVfx.beamFx(s, x, y, a.worldX, a.worldY, { color: 0x9fd8ff, width: 2, durationMs: 480, sparks: 4 })
      }
    }
  }

  _onTaunt({ adventurer } = {}) {
    const a = adventurer
    if (!a || !Number.isFinite(a.worldX)) return
    AbilityVfx.shockwaveFx(this._scene, a.worldX, a.worldY, { color: 0xffcc44, fromR: 8, toR: 66, durationMs: 540, rings: 2 })
    AbilityVfx.floatingText(this._scene, a.worldX, a.worldY - 22, 'TAUNT!', { color: '#ffcc44' })
  }

  _onReact({ adventurer, reaction } = {}) {
    const a = adventurer
    if (!a || !Number.isFinite(a.worldX)) return
    const s = this._scene, x = a.worldX, y = a.worldY
    switch (reaction) {
      case 'greed': AbilityVfx.sparkleFx(s, x, y - 12, { color: 0xffd23f, count: 10, r: 14 }); break
      case 'dread': AbilityVfx.floatingText(s, x, y - 18, '!', { color: '#e2483a' }); break
      case 'awe':   AbilityVfx.floatingText(s, x, y - 18, '…', { color: '#cfe0ff' }); break
      case 'ghost': AbilityVfx.floatingText(s, x, y - 18, '?', { color: '#aaaaaa' }); break
      case 'study': AbilityVfx.glowPulseFx(s, x, y, { color: 0x6fa8dc, r: 16, durationMs: 600, motes: 6 }); break
      case 'rally': AbilityVfx.pulseRing(s, x, y, { color: 0xffe066, fromR: 8, toR: 42, durationMs: 600, alpha: 0.85 }); break
      default: break
    }
  }

  // Sole survivor steels themselves — a defiant golden flare (Enhancement E).
  _onLastStand({ adventurer } = {}) {
    const a = adventurer
    if (!a || !Number.isFinite(a.worldX)) return
    const s = this._scene
    AbilityVfx.glowPulseFx(s, a.worldX, a.worldY, { color: 0xffcc44, r: 26, durationMs: 900, motes: 14 })
    AbilityVfx.shockwaveFx(s, a.worldX, a.worldY, { color: 0xffe066, fromR: 8, toR: 72, durationMs: 620, rings: 2 })
    AbilityVfx.floatingText(s, a.worldX, a.worldY - 24, 'LAST STAND!', { color: '#ffe066' })
  }

  // Berserker avenges a fallen ally — a red rage flare (avenge fork).
  _onAvenge({ adventurer } = {}) {
    const a = adventurer
    if (!a || !Number.isFinite(a.worldX)) return
    AbilityVfx.glowPulseFx(this._scene, a.worldX, a.worldY, { color: 0xcc2222, r: 22, durationMs: 700, motes: 12 })
    AbilityVfx.floatingText(this._scene, a.worldX, a.worldY - 22, 'AVENGE!', { color: '#ff5566' })
  }

  // Raid leader rallies the party after a loss — a steadying golden ring + glow.
  _onRally({ adventurer } = {}) {
    const a = adventurer
    if (!a || !Number.isFinite(a.worldX)) return
    AbilityVfx.pulseRing(this._scene, a.worldX, a.worldY, { color: 0xffe066, fromR: 10, toR: 50, durationMs: 680, alpha: 0.9 })
    AbilityVfx.glowPulseFx(this._scene, a.worldX, a.worldY, { color: 0xffe066, r: 18, durationMs: 640, motes: 8 })
    AbilityVfx.floatingText(this._scene, a.worldX, a.worldY - 22, 'RALLY!', { color: '#ffe066' })
  }

  // A near-wiped band's collective call (Enhancement D) — a rallying ring on each
  // survivor for a desperate PUSH; a break is sold by the flee VFX already.
  _onCollective({ decision, survivors } = {}) {
    if (decision !== 'push') return
    const s = this._scene
    for (const a of (survivors ?? [])) {
      if (a && Number.isFinite(a.worldX)) {
        AbilityVfx.pulseRing(s, a.worldX, a.worldY, { color: 0xff8844, fromR: 8, toR: 44, durationMs: 640, alpha: 0.9 })
      }
    }
    const lead = (survivors ?? []).find(a => Number.isFinite(a?.worldX))
    if (lead) AbilityVfx.floatingText(s, lead.worldX, lead.worldY - 24, 'WE PUSH ON!', { color: '#ff8844' })
  }
}

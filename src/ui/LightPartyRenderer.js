// LightPartyRenderer — world-space VFX for the Light Party event.
//
// Two things, all Phaser primitives that follow party members across
// the dungeon view (the DOM HUD layer in LightPartyCinematic handles
// the screen-locked chrome — corner panel, boss-fight overlay, LB flash):
//
//   • Heal beam — when the healer beams a heal, draw a green-gold line
//     from the healer's staff to the target's chest for ~400ms and fade.
//   • Raise cast bar — when the healer starts a 3-second Raise cast, draw
//     a small red-rimmed cast bar above their head that fills over the
//     cast duration. Cleared on completion / interruption.
//
// (Job-role head glyphs were removed 2026-06-01 at the user's request — the
// role is already conveyed by the costume + the FFXIV party panel.)
//
// All visuals teardown on DAY_PHASE_ENDED + LIGHT_PARTY_DUEL_BEGAN (the
// in-dungeon view goes away during the cinematic boss fight) and rebuild
// the next time the party arrives. No-op the rest of the time.

import { EventBus } from '../systems/EventBus.js'

const RAISE_BAR_W   = 48
const RAISE_BAR_H   = 6
const RAISE_BAR_Y   = 42          // px above worldY for the bar

// Generic ability cast bar (Limit Breaks while exploring). Wider than the
// raise bar, sits above the caster's head with the spell name above it.
const CAST_BAR_W = 64
const CAST_BAR_H = 7
const CAST_BAR_Y = 54             // px above worldY for the ability cast bar
const HEAL_BEAM_MS  = 420
const HEAL_BEAM_COLOR = 0xaef0c4
const HEAL_BEAM_OUTLINE = 0xffd66b

export class LightPartyRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._listeners = []
    this._raises    = {}    // healerId   → { bg, fill, startedAt, duration }
    this._casts     = {}    // casterId   → { bg, fill, label, startedAt, duration, color }
    this._beams     = []    // { gfx, expireAt }

    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('LIGHT_PARTY_BEGAN',          this._onPartyBegan)
    on('LIGHT_PARTY_HEAL_BEAM',      this._onHealBeam)
    on('LIGHT_PARTY_RAISE_STARTED',  this._onRaiseStarted)
    on('LIGHT_PARTY_RAISE_INTERRUPTED', this._onRaiseEnded)
    on('LIGHT_PARTY_RAISED',         this._onRaiseEnded)
    on('LIGHT_PARTY_RAISE_CANCELLED', this._onRaiseEnded)
    // Generic ability cast bar (Limit Breaks while exploring). The caster
    // stands still and a labelled cast bar fills over the cast time above
    // their head; LightPartyAi fires START then ENDED (resolve or cancel).
    on('LIGHT_PARTY_CAST_STARTED',   this._onCastStarted)
    on('LIGHT_PARTY_CAST_ENDED',     this._onCastEnded)
    on('LIGHT_PARTY_DUEL_BEGAN',     this._teardown)   // duel takes over; hide world chrome
    on('DAY_PHASE_ENDED',            this._teardown)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    this._teardown()
  }

  _teardown() {
    for (const id of Object.keys(this._raises)) this._destroyRaiseBar(id)
    for (const id of Object.keys(this._casts ?? {})) this._destroyCastBar(id)
    for (const b of this._beams) b.gfx?.destroy?.()
    this._beams = []
  }

  _onPartyBegan() {
    this._teardown()
  }

  // Every renderer tick — keep cast bars + beams attached to live
  // worldX/worldY values (advs move every frame).
  update() {
    const flags = this._gameState._eventFlags ?? {}
    if (!flags.lightPartyActive) {
      // Lazy teardown if the event ended without firing DAY_PHASE_ENDED
      // (e.g. a dev-fired cleanup mid-day).
      if (Object.keys(this._raises).length || Object.keys(this._casts ?? {}).length || this._beams.length) this._teardown()
      return
    }
    const active = this._gameState.adventurers?.active ?? []
    const liveById = new Map(active.map(a => [a.instanceId, a]))

    // Raise cast bars — follow healer head; advance fill by elapsed time.
    const now = this._scene.time?.now ?? 0
    for (const healerId of Object.keys(this._raises)) {
      const state = this._raises[healerId]
      const healer = liveById.get(healerId)
      if (!healer) { this._destroyRaiseBar(healerId); continue }
      const frac = Math.max(0, Math.min(1, (now - state.startedAt) / state.duration))
      const x = healer.worldX
      const y = healer.worldY - RAISE_BAR_Y
      state.bg.clear()
      state.bg.fillStyle(0x080414, 0.85)
      state.bg.fillRect(x - RAISE_BAR_W / 2, y, RAISE_BAR_W, RAISE_BAR_H)
      state.bg.lineStyle(1, 0xff6b6b, 0.95)
      state.bg.strokeRect(x - RAISE_BAR_W / 2 - 0.5, y - 0.5, RAISE_BAR_W + 1, RAISE_BAR_H + 1)
      state.fill.clear()
      state.fill.fillStyle(0xffd6cf, 1.0)
      state.fill.fillRect(x - RAISE_BAR_W / 2, y, RAISE_BAR_W * frac, RAISE_BAR_H)
    }

    // Ability cast bars — follow caster head; fill by elapsed time. The
    // spell-name label sits just above the bar. Dropped when the cast ends
    // (LIGHT_PARTY_CAST_ENDED) or the caster dies/leaves.
    for (const casterId of Object.keys(this._casts)) {
      const state = this._casts[casterId]
      const caster = liveById.get(casterId)
      if (!caster) { this._destroyCastBar(casterId); continue }
      const frac = Math.max(0, Math.min(1, (now - state.startedAt) / state.duration))
      const x = caster.worldX
      const y = caster.worldY - CAST_BAR_Y
      state.bg.clear()
      state.bg.fillStyle(0x080414, 0.9)
      state.bg.fillRect(x - CAST_BAR_W / 2, y, CAST_BAR_W, CAST_BAR_H)
      state.bg.lineStyle(1.5, state.color, 0.95)
      state.bg.strokeRect(x - CAST_BAR_W / 2 - 0.5, y - 0.5, CAST_BAR_W + 1, CAST_BAR_H + 1)
      state.fill.clear()
      state.fill.fillStyle(state.color, 1.0)
      state.fill.fillRect(x - CAST_BAR_W / 2, y, CAST_BAR_W * frac, CAST_BAR_H)
      // top gloss
      state.fill.fillStyle(0xffffff, 0.4)
      state.fill.fillRect(x - CAST_BAR_W / 2, y, CAST_BAR_W * frac, 1.5)
      if (state.label) state.label.setPosition(x, y - 3)
    }

    // Heal beams — fade out over HEAL_BEAM_MS, drop expired.
    const remaining = []
    for (const b of this._beams) {
      const t = (b.expireAt - now) / HEAL_BEAM_MS
      if (t <= 0) { b.gfx?.destroy?.(); continue }
      b.gfx.setAlpha(Math.max(0, Math.min(1, t)))
      remaining.push(b)
    }
    this._beams = remaining
  }

  // ── Heal beam ──────────────────────────────────────────────────────────
  _onHealBeam({ healerId, targetId } = {}) {
    const active = this._gameState.adventurers?.active ?? []
    const healer = active.find(a => a?.instanceId === healerId)
    const target = active.find(a => a?.instanceId === targetId)
    if (!healer || !target) return
    const g = this._scene.add.graphics().setDepth(945)
    // Outer warm-gold glow (thick, semi-transparent).
    g.lineStyle(4, HEAL_BEAM_OUTLINE, 0.45)
    g.beginPath()
    g.moveTo(healer.worldX, healer.worldY - 8)
    g.lineTo(target.worldX, target.worldY - 8)
    g.strokePath()
    // Inner mint-green core (thin, opaque).
    g.lineStyle(1.5, HEAL_BEAM_COLOR, 1.0)
    g.beginPath()
    g.moveTo(healer.worldX, healer.worldY - 8)
    g.lineTo(target.worldX, target.worldY - 8)
    g.strokePath()
    const now = this._scene.time?.now ?? 0
    this._beams.push({ gfx: g, expireAt: now + HEAL_BEAM_MS })
  }

  // ── Raise cast bar ─────────────────────────────────────────────────────
  _onRaiseStarted({ healerId, durationMs = 3000 } = {}) {
    this._destroyRaiseBar(healerId)
    const bg   = this._scene.add.graphics().setDepth(955)
    const fill = this._scene.add.graphics().setDepth(956)
    this._raises[healerId] = {
      bg, fill,
      startedAt: this._scene.time?.now ?? 0,
      duration:  durationMs,
    }
  }

  _onRaiseEnded({ healerId } = {}) {
    this._destroyRaiseBar(healerId)
  }

  _destroyRaiseBar(healerId) {
    const state = this._raises[healerId]
    if (!state) return
    state.bg?.destroy?.()
    state.fill?.destroy?.()
    delete this._raises[healerId]
  }

  // ── Ability cast bar (Limit Breaks while exploring) ─────────────────────
  // { casterId, name, durationMs, color } — color is the role accent (hex int),
  // defaults to gold. The caster's sprite is frozen by LightPartyAi for the
  // cast; this just draws the bar + name and the update() loop fills it.
  _onCastStarted({ casterId, name = '', durationMs = 2000, color = 0xffd66b } = {}) {
    if (!casterId) return
    this._destroyCastBar(casterId)
    const bg    = this._scene.add.graphics().setDepth(957)
    const fill  = this._scene.add.graphics().setDepth(958)
    const label = this._scene.add.text(0, 0, String(name).toUpperCase(), {
      fontFamily: 'Press Start 2P, Courier New, monospace',
      fontSize: '7px', color: '#fff7d8',
    }).setOrigin(0.5, 1).setDepth(959)
    label.setShadow(0, 0, '#2a1505', 4, true, true)
    this._casts[casterId] = {
      bg, fill, label,
      startedAt: this._scene.time?.now ?? 0,
      duration:  durationMs,
      color,
    }
  }

  _onCastEnded({ casterId } = {}) {
    this._destroyCastBar(casterId)
  }

  _destroyCastBar(casterId) {
    const state = this._casts?.[casterId]
    if (!state) return
    state.bg?.destroy?.()
    state.fill?.destroy?.()
    state.label?.destroy?.()
    delete this._casts[casterId]
  }
}

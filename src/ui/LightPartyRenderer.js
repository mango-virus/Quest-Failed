// LightPartyRenderer — world-space VFX for the Light Party event.
//
// Three things, all Phaser primitives that follow party members across
// the dungeon view (the DOM HUD layer in LightPartyCinematic handles
// the screen-locked chrome — corner panel, boss-fight overlay, LB flash):
//
//   • Job icons — a small role glyph (🛡 ✨ ⚔ 🏹) hovers above each party
//     member's head, FFXIV party-list aesthetic. Persists for the whole
//     time the party is in the dungeon.
//   • Heal beam — when the healer beams a heal, draw a green-gold line
//     from the healer's staff to the target's chest for ~400ms and fade.
//   • Raise cast bar — when the healer starts a 3-second Raise cast, draw
//     a small red-rimmed cast bar above their head that fills over the
//     cast duration. Cleared on completion / interruption.
//
// All visuals teardown on DAY_PHASE_ENDED + LIGHT_PARTY_DUEL_BEGAN (the
// in-dungeon view goes away during the cinematic boss fight) and rebuild
// the next time the party arrives. No-op the rest of the time.

import { EventBus } from '../systems/EventBus.js'

const ROLE_ICON = {
  tank:      '\u{1F6E1}',  // 🛡
  healer:    '✨',      // ✨
  meleeDps:  '⚔',      // ⚔
  rangedDps: '\u{1F3F9}',   // 🏹
}
const ROLE_TINT = {
  tank:      0x6aaaff,
  healer:    0xaef0c4,
  meleeDps:  0xff8a6a,
  rangedDps: 0xc9a9ff,
}

const ICON_Y_OFFSET = 30          // px above the adv's worldY for the icon
const RAISE_BAR_W   = 48
const RAISE_BAR_H   = 6
const RAISE_BAR_Y   = 42          // px above worldY for the bar
const HEAL_BEAM_MS  = 420
const HEAL_BEAM_COLOR = 0xaef0c4
const HEAL_BEAM_OUTLINE = 0xffd66b

export class LightPartyRenderer {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._listeners = []
    this._icons     = {}    // instanceId → Phaser.GameObjects.Text
    this._raises    = {}    // healerId   → { bg, fill, startedAt, duration }
    this._beams     = []    // { gfx, expireAt }

    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('LIGHT_PARTY_BEGAN',          this._onPartyBegan)
    on('LIGHT_PARTY_HEAL_BEAM',      this._onHealBeam)
    on('LIGHT_PARTY_RAISE_STARTED',  this._onRaiseStarted)
    on('LIGHT_PARTY_RAISE_INTERRUPTED', this._onRaiseEnded)
    on('LIGHT_PARTY_RAISED',         this._onRaiseEnded)
    on('LIGHT_PARTY_RAISE_CANCELLED', this._onRaiseEnded)
    on('LIGHT_PARTY_DUEL_BEGAN',     this._teardown)   // duel takes over; hide world chrome
    on('DAY_PHASE_ENDED',            this._teardown)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    this._teardown()
  }

  _teardown() {
    for (const id of Object.keys(this._icons)) {
      this._icons[id]?.destroy?.()
      delete this._icons[id]
    }
    for (const id of Object.keys(this._raises)) this._destroyRaiseBar(id)
    for (const b of this._beams) b.gfx?.destroy?.()
    this._beams = []
  }

  _onPartyBegan({ members = [] } = {}) {
    this._teardown()
    for (const a of members) {
      if (!a?._lightPartyRole) continue
      this._ensureIcon(a)
    }
  }

  _ensureIcon(adv) {
    if (this._icons[adv.instanceId]) return
    const role = adv._lightPartyRole
    const icon = ROLE_ICON[role] || '◆'
    const text = this._scene.add.text(adv.worldX ?? 0, (adv.worldY ?? 0) - ICON_Y_OFFSET, icon, {
      fontFamily: 'sans-serif',
      fontSize:   '14px',
      color:      '#fff',
    }).setOrigin(0.5, 0.5).setDepth(950)
    text.setTint?.(ROLE_TINT[role] ?? 0xffffff)
    this._icons[adv.instanceId] = text
  }

  // Every renderer tick — keep icons + cast bars + beams attached to live
  // worldX/worldY values (advs move every frame).
  update() {
    const flags = this._gameState._eventFlags ?? {}
    if (!flags.lightPartyActive) {
      // Lazy teardown if the event ended without firing DAY_PHASE_ENDED
      // (e.g. a dev-fired cleanup mid-day).
      if (Object.keys(this._icons).length) this._teardown()
      return
    }
    const active = this._gameState.adventurers?.active ?? []
    const liveById = new Map(active.map(a => [a.instanceId, a]))

    // Icons — follow the head; destroy on death/leave.
    for (const id of Object.keys(this._icons)) {
      const adv = liveById.get(id)
      if (!adv || adv.aiState === 'dead' || (adv.resources?.hp ?? 0) <= 0) {
        this._icons[id]?.destroy?.()
        delete this._icons[id]
        continue
      }
      const t = this._icons[id]
      t.setPosition(adv.worldX, adv.worldY - ICON_Y_OFFSET)
    }
    // Cover late-joiners (revived members) by ensuring an icon exists for
    // every live Light Party member each tick.
    for (const adv of active) {
      if (adv?._lightParty && adv.aiState !== 'dead' && (adv.resources?.hp ?? 0) > 0) {
        this._ensureIcon(adv)
      }
    }

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
}

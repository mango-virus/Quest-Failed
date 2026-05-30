// LightPartyAi — per-role driver for the Light Party event (FFXIV trinity).
//
// Layers on top of the standard AISystem (which handles SEEK_BOSS pathing and
// regular combat). This system owns the per-role behaviors the trinity needs:
//
//   • Healer (white_mage) — periodic heal beam to the lowest-HP ally; on any
//     party-member death, starts a 3s Raise cast with a visible cast bar; if
//     interrupted by >15% maxHp damage during the cast, the rez fizzles.
//   • Tank (paladin) — Hallowed Ground self-invuln at <30% HP, once per
//     dungeon. (The Provoke aura itself is enforced in MinionAISystem._pickTarget
//     because that's where minion target selection lives.)
//   • Limit Break — shared party gauge (filled by EventSystem from damage /
//     kills / revives). Tactical fires in the dungeon:
//       - Tank LB "Stronghold" at <50% total party HP → 4s party invuln
//       - Healer LB "Pulse of Life" with ≥2 dead party members → full revive + heal
//       - DPS LB "Final Heaven" with ≥4 minions in a 5-tile radius → AoE kill
//     LB3 in the boss fight is a separate path (LightPartyCinematic).
//
// Game.js registers + ticks this system. update() is a cheap no-op when the
// event isn't live, so the per-frame cost is one flag check on normal days.

import { EventBus }   from './EventBus.js'
import { Balance }    from '../config/balance.js'
import { AbilityVfx } from '../ui/AbilityVfx.js'

const HEAL_INTERVAL_MS    = 1500   // healer beam every 1.5s
const HEAL_PCT_OF_MAXHP   = 0.15   // heals 15% of target's maxHp per beam
const HEAL_RANGE_TILES    = 6      // healer must be within 6 tiles of target

const RAISE_DURATION_MS   = 3000   // 3-second Raise cast
const RAISE_INTERRUPT_PCT = 0.15   // taking >15% of healer maxHp during the cast cancels it
const RAISE_REVIVE_PCT    = 0.50   // raised ally returns with 50% maxHp

const HALLOWED_TRIGGER_PCT = 0.30  // tank fires Hallowed Ground at <30% HP
const HALLOWED_DURATION_MS = 3000  // 3-second invuln window

// Limit Break trigger thresholds (gauge values 0..100, set by EventSystem).
const LB_GAUGE_MAX            = 100
const LB_TANK_PARTY_HP_PCT    = 0.50   // Stronghold fires when total party HP ≤ 50%
const LB_HEALER_DEAD_MIN      = 2      // Pulse of Life fires when ≥2 party members dead
const LB_DPS_MINION_RADIUS    = 5      // Final Heaven radius (tiles)
const LB_DPS_MIN_TARGETS      = 4      // … requires ≥4 minions in radius to fire
const LB_INVULN_DURATION_MS   = 4000   // Tank LB invuln window

export class LightPartyAi {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._listeners = []
    // Track in-flight Raise casts keyed by healer.instanceId — value carries
    // the dead ally id, the start time, and the snapshot healer HP we
    // compare against to detect "took >15% damage during the cast".
    this._raises    = new Map()
    // Per-day flag: any tank that has used Hallowed Ground this run can't
    // use it again until the next Light Party spawn. Cleared on
    // LIGHT_PARTY_BEGAN.
    this._hallowedFired = new Set()
    // Per-day flag: each LB type fires AT MOST ONCE per dungeon run (the
    // gauge is a continuous resource, but a tactical fire commits the
    // gauge and the cooldown). Re-set on LIGHT_PARTY_BEGAN.
    this._lbFiredTactical = false

    const on = (evt, fn) => { EventBus.on(evt, fn, this); this._listeners.push([evt, fn]) }
    on('LIGHT_PARTY_BEGAN', this._onPartyBegan)
    on('ADVENTURER_DIED',   this._onPartyMemberDied)
    on('COMBAT_HIT',        this._onCombatHit)
    on('DAY_PHASE_ENDED',   this._reset)
  }

  destroy() {
    for (const [evt, fn] of this._listeners) EventBus.off(evt, fn, this)
    this._listeners = []
    this._raises.clear()
    this._hallowedFired.clear()
  }

  _reset() {
    this._raises.clear()
    this._hallowedFired.clear()
    this._lbFiredTactical = false
  }

  _onPartyBegan() {
    this._reset()
  }

  // ── Per-tick driver ────────────────────────────────────────────────────

  update(delta) {
    const flags = this._gameState._eventFlags ?? {}
    if (!flags.lightPartyActive) return
    const party = this._liveParty()
    if (party.length === 0) return
    this._tickHealing(delta, party)
    this._tickRaiseCasts(delta, party)
    this._tickHallowedGround(party)
    this._tickLimitBreaks(party)
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  _liveParty() {
    return (this._gameState.adventurers?.active ?? [])
      .filter(a => a?._lightParty && a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0)
  }

  _liveHealers(party) {
    return party.filter(a => a._lightPartyRole === 'healer')
  }

  _liveTanks(party) {
    return party.filter(a => a._lightPartyRole === 'tank')
  }

  // ── Healing ────────────────────────────────────────────────────────────
  // Every HEAL_INTERVAL_MS, each healer beams a heal at the lowest-HP-fraction
  // ally within HEAL_RANGE_TILES. Visible green-gold beam (HEAL_BEAM_FIRED →
  // AdventurerRenderer paints it for one tick).
  _tickHealing(_delta, party) {
    const now = this._scene.time?.now ?? 0
    for (const healer of this._liveHealers(party)) {
      // Healers actively casting Raise can't heal — they're channeling.
      if (this._raises.has(healer.instanceId)) continue
      const last = healer._lpLastHealAt ?? 0
      if (now - last < HEAL_INTERVAL_MS) continue
      // Skip if the healer is unconscious (HP 0) — _liveParty already filtered
      // dead, but a fresh-rezzed healer at 0 wakes up next tick.
      const target = this._pickHealTarget(healer, party)
      if (!target) continue
      const heal = Math.max(1, Math.round((target.resources.maxHp || 1) * HEAL_PCT_OF_MAXHP))
      target.resources.hp = Math.min(target.resources.maxHp ?? target.resources.hp, target.resources.hp + heal)
      healer._lpLastHealAt = now
      EventBus.emit('LIGHT_PARTY_HEAL_BEAM', {
        healerId: healer.instanceId,
        targetId: target.instanceId,
        amount:   heal,
      })
    }
  }

  _pickHealTarget(healer, party) {
    let bestFrac = Infinity
    let best = null
    for (const a of party) {
      // Don't heal full-HP allies — wastes the beam visually and obscures
      // when the healer is "working". Healer can heal herself.
      const frac = (a.resources.hp ?? 0) / (a.resources.maxHp || 1)
      if (frac >= 1.0) continue
      const d = Math.hypot(a.tileX - healer.tileX, a.tileY - healer.tileY)
      if (d > HEAL_RANGE_TILES) continue
      if (frac < bestFrac) { bestFrac = frac; best = a }
    }
    return best
  }

  // ── Raise casts ────────────────────────────────────────────────────────
  // Listener — a party member just died. If a healer is alive + not already
  // mid-cast, start a 3-second Raise on the corpse.
  _onPartyMemberDied({ adventurer } = {}) {
    if (!adventurer?._lightParty) return
    const flags = this._gameState._eventFlags ?? {}
    if (!flags.lightPartyActive) return
    const party  = this._liveParty()
    const healer = this._liveHealers(party).find(h => !this._raises.has(h.instanceId))
    if (!healer) return
    const now = this._scene.time?.now ?? 0
    this._raises.set(healer.instanceId, {
      deadId:     adventurer.instanceId,
      startedAt:  now,
      healerHpAtStart: healer.resources?.hp ?? 0,
      damageTaken: 0,
    })
    EventBus.emit('LIGHT_PARTY_RAISE_STARTED', {
      healerId: healer.instanceId,
      deadId:   adventurer.instanceId,
      durationMs: RAISE_DURATION_MS,
    })
  }

  // Listener — accumulate damage taken on any in-flight healer so the cast
  // interrupt check at tick time has a running total to compare against.
  _onCombatHit({ targetId, damage } = {}) {
    if (!targetId || !damage) return
    const state = this._raises.get(targetId)
    if (state) state.damageTaken = (state.damageTaken ?? 0) + damage
  }

  _tickRaiseCasts(_delta, party) {
    const now = this._scene.time?.now ?? 0
    for (const [healerId, state] of [...this._raises]) {
      const healer = party.find(a => a.instanceId === healerId)
      if (!healer) {
        // Healer died mid-cast → cancel quietly. The newly-dead healer will
        // be flagged ADVENTURER_DIED separately which can kick off ANOTHER
        // raise cast on a different healer (Full Party only).
        this._raises.delete(healerId)
        EventBus.emit('LIGHT_PARTY_RAISE_CANCELLED', { healerId, reason: 'healer_dead' })
        continue
      }
      // Interrupt check — damage taken during the cast vs healer's maxHp.
      const interruptThreshold = (healer.resources.maxHp || 1) * RAISE_INTERRUPT_PCT
      if (state.damageTaken > interruptThreshold) {
        this._raises.delete(healerId)
        EventBus.emit('LIGHT_PARTY_RAISE_INTERRUPTED', { healerId, deadId: state.deadId })
        // Visible "Interrupted!" floater above the healer's head.
        if (this._scene && healer.worldY != null) {
          AbilityVfx.floatingText(this._scene, healer.worldX, healer.worldY - 16, 'INTERRUPTED', {
            color: '#ff6b6b', fontSize: '11px',
          })
        }
        continue
      }
      // Cast complete?
      if (now - state.startedAt >= RAISE_DURATION_MS) {
        this._raises.delete(healerId)
        this._completeRaise(healer, state.deadId)
      }
    }
  }

  _completeRaise(healer, deadId) {
    const dead = (this._gameState.adventurers?.active ?? []).find(a => a?.instanceId === deadId)
    if (!dead) return
    // Bring the ally back at 50% maxHp + clear AI dead state. They re-enter
    // the formation on the next AISystem tick.
    const reviveHp = Math.max(1, Math.round((dead.resources.maxHp || 1) * RAISE_REVIVE_PCT))
    dead.resources.hp = reviveHp
    dead.aiState      = 'idle'
    dead.deathDay     = null
    EventBus.emit('LIGHT_PARTY_RAISED', {
      healerId: healer.instanceId,
      raisedId: dead.instanceId,
      hp:       reviveHp,
    })
    // VFX — gold "ARISE" pop matching the Solo Leveling extraction beat.
    if (this._scene && dead.worldY != null) {
      AbilityVfx.floatingText(this._scene, dead.worldX, dead.worldY - 16, 'RAISE', {
        color: '#ffd66b', fontSize: '13px',
      })
      AbilityVfx.pulseRing(this._scene, dead.worldX, dead.worldY, { color: 0xffd66b })
    }
  }

  // ── Hallowed Ground (tank self-invuln at <30% HP, once per dungeon) ────
  _tickHallowedGround(party) {
    for (const tank of this._liveTanks(party)) {
      if (this._hallowedFired.has(tank.instanceId)) continue
      const frac = (tank.resources.hp ?? 0) / (tank.resources.maxHp || 1)
      if (frac > HALLOWED_TRIGGER_PCT) continue
      this._hallowedFired.add(tank.instanceId)
      tank._invuln = true
      tank._invulnUntil = (this._scene.time?.now ?? 0) + HALLOWED_DURATION_MS
      EventBus.emit('LIGHT_PARTY_HALLOWED_GROUND', { tankId: tank.instanceId })
      if (this._scene && tank.worldY != null) {
        AbilityVfx.floatingText(this._scene, tank.worldX, tank.worldY - 16, 'HALLOWED GROUND', {
          color: '#ffd66b', fontSize: '12px',
        })
        AbilityVfx.pulseRing(this._scene, tank.worldX, tank.worldY, { color: 0xffd66b })
      }
      this._scene.time?.delayedCall?.(HALLOWED_DURATION_MS, () => {
        tank._invuln = false
        tank._invulnUntil = 0
      })
    }
  }

  // ── Limit Breaks ───────────────────────────────────────────────────────
  // Tactical LB fires happen at most once in the dungeon (gauge resets to 0
  // on fire). LB3 in the boss fight is a separate path owned by
  // LightPartyCinematic.
  _tickLimitBreaks(party) {
    if (this._lbFiredTactical) return
    const flags = this._gameState._eventFlags ?? {}
    if ((flags.lightPartyGauge ?? 0) < LB_GAUGE_MAX) return

    // Choose which LB to fire by inspecting the current situation. Priority:
    //   1. Healer LB — most rescues at risk first (≥2 dead).
    //   2. DPS LB — wipe a clump (≥4 minions in radius of any DPS).
    //   3. Tank LB — survive the next hit (party HP fraction low).
    const deadIds = new Set((this._gameState.adventurers?.active ?? [])
      .filter(a => a?._lightParty && (a.aiState === 'dead' || (a.resources?.hp ?? 0) <= 0))
      .map(a => a.instanceId))
    if (deadIds.size >= LB_HEALER_DEAD_MIN) {
      const healer = this._liveHealers(party)[0]
      if (healer) return this._fireHealerLb(healer, deadIds)
    }
    const dpsLb = this._pickDpsLbTarget(party)
    if (dpsLb) return this._fireDpsLb(dpsLb.dps, dpsLb.minions)
    const partyHpFrac = this._partyHpFrac(party)
    if (partyHpFrac <= LB_TANK_PARTY_HP_PCT) {
      const tank = this._liveTanks(party)[0]
      if (tank) return this._fireTankLb(tank, party)
    }
  }

  _partyHpFrac(party) {
    let cur = 0, max = 0
    for (const a of party) {
      cur += a.resources?.hp    ?? 0
      max += a.resources?.maxHp ?? 0
    }
    return max > 0 ? cur / max : 1
  }

  _pickDpsLbTarget(party) {
    for (const dps of party) {
      if (dps._lightPartyRole !== 'meleeDps' && dps._lightPartyRole !== 'rangedDps') continue
      const minions = []
      for (const m of this._gameState.minions ?? []) {
        if (!m || m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
        if (m.faction !== 'dungeon') continue
        const d = Math.hypot(m.tileX - dps.tileX, m.tileY - dps.tileY)
        if (d <= LB_DPS_MINION_RADIUS) minions.push(m)
      }
      if (minions.length >= LB_DPS_MIN_TARGETS) return { dps, minions }
    }
    return null
  }

  // Tank LB — Stronghold. 4s invuln to the whole party + a gold dome ring.
  _fireTankLb(tank, party) {
    this._lbFiredTactical = true
    this._scene.eventSystem?.consumeLbGauge?.()
    const until = (this._scene.time?.now ?? 0) + LB_INVULN_DURATION_MS
    for (const a of party) {
      a._invuln      = true
      a._invulnUntil = until
    }
    EventBus.emit('LIGHT_PARTY_LB_FIRED', { kind: 'tank', tankId: tank.instanceId })
    if (this._scene && tank.worldY != null) {
      AbilityVfx.floatingText(this._scene, tank.worldX, tank.worldY - 18, 'STRONGHOLD', {
        color: '#ffd66b', fontSize: '14px',
      })
      AbilityVfx.pulseRing(this._scene, tank.worldX, tank.worldY, { color: 0xffd66b })
    }
    this._scene.time?.delayedCall?.(LB_INVULN_DURATION_MS, () => {
      for (const a of party) {
        if (a._invulnUntil === until) { a._invuln = false; a._invulnUntil = 0 }
      }
    })
  }

  // Healer LB — Pulse of Life. Full revive + full heal on every party
  // member (including the dead ones). Big green wave VFX.
  _fireHealerLb(healer, deadIds) {
    this._lbFiredTactical = true
    this._scene.eventSystem?.consumeLbGauge?.()
    let revived = 0
    for (const a of this._gameState.adventurers?.active ?? []) {
      if (!a?._lightParty) continue
      const wasDead = deadIds.has(a.instanceId) || (a.resources?.hp ?? 0) <= 0
      a.resources.hp = a.resources.maxHp ?? a.resources.hp ?? 1
      if (wasDead) {
        a.aiState  = 'idle'
        a.deathDay = null
        revived++
      }
    }
    EventBus.emit('LIGHT_PARTY_LB_FIRED', { kind: 'healer', healerId: healer.instanceId, revived })
    if (this._scene && healer.worldY != null) {
      AbilityVfx.floatingText(this._scene, healer.worldX, healer.worldY - 18, 'PULSE OF LIFE', {
        color: '#aef0c4', fontSize: '14px',
      })
      AbilityVfx.pulseRing(this._scene, healer.worldX, healer.worldY, { color: 0x6ad497 })
    }
  }

  // DPS LB — Final Heaven. Every minion in LB_DPS_MINION_RADIUS dies
  // outright. Screen flash via the cinematic layer.
  _fireDpsLb(dps, minions) {
    this._lbFiredTactical = true
    this._scene.eventSystem?.consumeLbGauge?.()
    for (const m of minions) {
      m.resources.hp = 0
      m.aiState      = 'dead'
      m.deathDay     = this._gameState.meta?.dayNumber ?? null
      EventBus.emit('MINION_DIED', { minion: m, killerId: dps.instanceId, source: 'light_party_lb' })
    }
    EventBus.emit('LIGHT_PARTY_LB_FIRED', {
      kind:     'dps',
      dpsId:    dps.instanceId,
      killed:   minions.length,
      role:     dps._lightPartyRole,
    })
    if (this._scene && dps.worldY != null) {
      AbilityVfx.floatingText(this._scene, dps.worldX, dps.worldY - 18,
        dps._lightPartyRole === 'rangedDps' ? 'METEOR' : 'FINAL HEAVEN', {
        color: '#ff9a3a', fontSize: '14px',
      })
      AbilityVfx.pulseRing(this._scene, dps.worldX, dps.worldY, { color: 0xff9a3a })
    }
  }
}

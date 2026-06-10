// NerveSystem — adventurer morale / "nerve" spine (AI & Personality Overhaul, 2026-06-10).
//
// The Day phase is spectator-only, so the AI is the show. Nerve is the per-adventurer
// inner-state value (0–100) that turns a flat "unit walking to the boss" into an ARC:
// an adventurer enters Bold, gets ground down by the dungeon to Breaking, and either
// shatters (flees) or pushes through. It drives flee/pace (in AISystem) and the
// body-language tells + mood pip (in AdventurerRenderer); personalities tune it.
//
// Design: NerveSystem owns the VALUE. It applies a CONTINUOUS component every tick
// (situational drains/recovers from where the adventurer is + what's around it) plus
// DISCRETE impulses on EventBus events (a kill emboldens, a trap/ally-death rattles).
// AISystem and AdventurerRenderer only READ adv.nerve / adv.mood — they never write it.
//
// Spec: DESIGN.md → "Adventurer AI & Personality Overhaul" (Thread 1). Numbers below are
// the first-pass tunables — settle them in sim/preview, not by guessing.

import { EventBus } from './EventBus.js'
import { Balance } from '../config/balance.js'

// ── Band thresholds (on the 0–100 nerve scale) ──────────────────────────────
const BAND_BOLD     = 80   // > 80  → bold
const BAND_STEADY   = 60   // > 60  → steady
const BAND_WARY     = 40   // > 40  → wary
const BAND_SPOOKED  = 20   // > 20  → spooked, else breaking

// ── Continuous rates (nerve points per SECOND, before personality multipliers) ──
const REGRESS_RATE   = 0.18  // gentle pull toward the personality baseline (per sec, ×gap)
const DRAIN_UNKNOWN  = 4.5   // standing in an unobserved room (the dark / the unknown)
const DRAIN_THREAT   = 9.0   // a live hostile minion within THREAT_RADIUS (scaled by closeness)
const DRAIN_LOWHP    = 11.0  // scaled by how far below half HP they are
const DRAIN_DEEP     = 2.2   // "in too deep" — far from the way they came in
const RECOVER_SAFE   = 4.0   // in known/cleared ground, no threat near, healthy (tapered above baseline)
const RECOVER_HEADROOM = 35  // safe-recovery tapers to 0 this many points above baseline — so
                             // reaching the BOLD band is EARNED (kills/loot/rally), not gained by
                             // strolling cleared rooms (keeps the early personality spread alive)

const THREAT_RADIUS  = 4.5   // tiles — a hostile within this range gnaws at nerve
const DEEP_TILES     = 14    // tiles from the entry point before "in too deep" bites

// ── Discrete impulses (instantaneous nerve deltas) ──────────────────────────
const IMP_KILL          =  12   // landed a kill — emboldened
const IMP_ALLY_DEATH_PT = -26   // a party-mate died
const IMP_ALLY_DEATH_NR = -15   // a non-party adventurer died within sight
const IMP_TRAP          = -16   // a trap went off on them
const IMP_LOOT          =  10   // grabbed loot / opened a chest
const IMP_HEAL          =  12   // healed at a fountain
const IMP_HIT_PER_PCT   = -0.28 // per 1% maxHP of a single incoming hit
const IMP_HIT_CAP       = -12   // floor on a single hit's nerve bite
const ALLY_DEATH_RADIUS = 7     // tiles — non-party deaths within this rattle witnesses

const TS = Balance.TILE_SIZE

export class NerveSystem {
  constructor(scene, gameState, dungeonGrid, personalitySystem = null) {
    this._scene       = scene
    this._gameState   = gameState
    this._dungeonGrid = dungeonGrid
    this._personalitySystem = personalitySystem
    // Derived personality nerve profiles, keyed by adventurer instanceId.
    // Recomputed lazily (survives save/load — adv.nerve itself serializes).
    this._profiles    = new Map()

    EventBus.on('COMBAT_KILL',        this._onKill,       this)
    EventBus.on('ADVENTURER_DIED',    this._onAdvDied,    this)
    EventBus.on('TRAP_TRIGGERED',     this._onTrap,       this)
    EventBus.on('COMBAT_HIT',         this._onHit,        this)
    EventBus.on('TREASURE_CHEST_OPENED', this._onLoot,    this)
    EventBus.on('BUFF_GAINED',        this._onLoot,       this)
    EventBus.on('FOUNTAIN_HEAL_USED', this._onHeal,       this)
  }

  destroy() {
    EventBus.off('COMBAT_KILL',        this._onKill,       this)
    EventBus.off('ADVENTURER_DIED',    this._onAdvDied,    this)
    EventBus.off('TRAP_TRIGGERED',     this._onTrap,       this)
    EventBus.off('COMBAT_HIT',         this._onHit,        this)
    EventBus.off('TREASURE_CHEST_OPENED', this._onLoot,    this)
    EventBus.off('BUFF_GAINED',        this._onLoot,       this)
    EventBus.off('FOUNTAIN_HEAL_USED', this._onHeal,       this)
    this._profiles.clear()
  }

  // ── Personality nerve profile ───────────────────────────────────────────────
  // The profile is DERIVED from behaviorWeights (so even personalities without an
  // explicit block feel distinct: bold/reckless start high+steady, cautious start
  // low+jumpy) and then OVERLAID with any explicit `nerve {}` fields from the
  // personality data (roster pass): baseline/floor/drainMul/recoverMul + the special
  // hooks invert (Berserker), steadyAllies (Veteran/Raid Leader), geometry
  // (Claustrophobe), boldInTags (Zealot), emboldenPerKill (Underdog).
  _profile(adv) {
    const cached = this._profiles.get(adv.instanceId)
    if (cached) return cached
    const w = this._personalitySystem?.getWeights?.(adv) ?? {
      riskTolerance: 0.5, aggressionLevel: 0.5, fleeThreshold: 0.5, trapCaution: 0.5,
    }
    let baseline = _clamp(
      55 + (w.riskTolerance - 0.5) * 70 + (w.aggressionLevel - 0.5) * 20
         - (w.fleeThreshold - 0.5) * 40,
      20, 95)
    let drainMul = _clamp(1 + (w.trapCaution - 0.5) * 0.7 + (0.5 - w.riskTolerance) * 0.7, 0.5, 1.8)
    let recoverMul = _clamp(0.7 + w.riskTolerance * 0.6, 0.5, 1.5)

    // Overlay explicit personality nerve fields.
    const ps = this._personalitySystem
    const bArr = [], dArr = [], rArr = []
    let floor = 0, invert = false, steadyAllies = 0, geometry = null, emboldenPerKill = 0
    let boldInTags = []
    for (const pid of (adv.personalityIds ?? [])) {
      const n = ps?.getDefinition?.(pid)?.nerve
      if (!n) continue
      if (n.baseline   != null) bArr.push(n.baseline)
      if (n.drainMul   != null) dArr.push(n.drainMul)
      if (n.recoverMul != null) rArr.push(n.recoverMul)
      if (n.floor      != null) floor = Math.max(floor, n.floor)
      if (n.invert)             invert = true
      if (n.steadyAllies != null) steadyAllies = Math.max(steadyAllies, n.steadyAllies)
      if (n.geometry)           geometry = n.geometry
      if (n.emboldenPerKill != null) emboldenPerKill = Math.max(emboldenPerKill, n.emboldenPerKill)
      if (Array.isArray(n.boldInTags)) boldInTags = boldInTags.concat(n.boldInTags)
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length
    if (bArr.length) baseline   = avg(bArr)
    if (dArr.length) drainMul   = avg(dArr)
    if (rArr.length) recoverMul = avg(rArr)

    const prof = { baseline, drainMul, recoverMul, floor, invert, steadyAllies, geometry, boldInTags, emboldenPerKill }
    this._profiles.set(adv.instanceId, prof)
    return prof
  }

  _seed(adv) {
    if (adv._nerveSeeded) return this._profile(adv)
    const prof = this._profile(adv)
    adv.nerve = prof.baseline
    adv._nerveSeeded = true
    adv.mood = _bandFor(adv.nerve)
    return prof
  }

  // ── Per-tick continuous update ──────────────────────────────────────────────
  update(delta) {
    const dtSec = delta / 1000
    if (dtSec <= 0) return
    const advs = this._gameState.adventurers?.active ?? []
    for (const adv of advs) {
      if (!adv || adv.aiState === 'dead') continue
      const prof = this._seed(adv)
      // Charm-walking / scripted-duel advs have their morale frozen as cosmetic;
      // still let it regress so the pip reads sensibly, but skip threat churn.
      const room = this._dungeonGrid?.getRoomAtTile?.(adv.tileX, adv.tileY) ?? null
      const roomId = room?.instanceId ?? null
      const known = !!(roomId && (adv._roomsEntered?.[roomId] || adv.visitedRooms?.includes?.(roomId)))
      const maxHp = adv.resources?.maxHp || 1
      const hpFrac = (adv.resources?.hp ?? maxHp) / maxHp
      const threatTiles = this._nearestHostileTiles(adv)

      let rate = (prof.baseline - adv.nerve) * REGRESS_RATE

      if (prof.invert) {
        // Berserker — nerve runs BACKWARDS: bleeding and carnage embolden them, and
        // they relish danger rather than fearing it. (Kills add a bigger impulse via
        // _onKill.) The lower they go, the scarier they get.
        if (hpFrac < 0.6) rate += DRAIN_LOWHP * ((0.6 - hpFrac) / 0.6) * 1.15
        if (room && !known) rate -= DRAIN_UNKNOWN * 0.35   // a flicker of the unknown, no more
      } else {
        // Drains
        if (room && !known)            rate -= DRAIN_UNKNOWN * prof.drainMul
        if (threatTiles <= THREAT_RADIUS) {
          const closeness = 1 - threatTiles / THREAT_RADIUS  // 0..1
          rate -= DRAIN_THREAT * closeness * prof.drainMul
        }
        if (hpFrac < 0.5)              rate -= DRAIN_LOWHP * ((0.5 - hpFrac) / 0.5) * prof.drainMul
        const deep = this._tilesFromEntry(adv)
        if (deep > DEEP_TILES)         rate -= DRAIN_DEEP * prof.drainMul
        // Recover — only when genuinely safe: known ground, no threat, healthy.
        // Tapered above baseline so cleared ground returns them toward their
        // baseline but NOT to Bold — reaching Bold is earned via the impulses.
        if (known && threatTiles > THREAT_RADIUS && hpFrac >= 0.5) {
          const headroom = Math.max(0, Math.min(1, 1 - (adv.nerve - prof.baseline) / RECOVER_HEADROOM))
          rate += RECOVER_SAFE * prof.recoverMul * headroom
        }
      }

      // Claustrophobe — your geometry is the weapon: tight corridors/cramped rooms
      // drain, open halls steady.
      if (prof.geometry === 'tight' && room) {
        const tight = this._roomTightness(room)        // 0..1
        if (tight > 0) rate -= 6 * tight
        else rate += 2
      }
      // Zealot — emboldened in sacred / wondrous rooms (shrine, fountain, blessing).
      if (prof.boldInTags.length && room && this._roomHasAnyTag(room, prof.boldInTags)) {
        rate += 5
      }

      this._apply(adv, rate * dtSec, prof.floor)

      // Veteran / Raid Leader — their calm steadies nearby party-mates' nerve.
      if (prof.steadyAllies > 0) this._steadyAllies(adv, prof.steadyAllies, dtSec)
    }
  }

  // Geometry tightness 0..1 (1 = corridor / very cramped). Pure dimensions so it
  // reads the player's architecture directly.
  _roomTightness(room) {
    const m = Math.min(room.width ?? 9, room.height ?? 9)
    if ((room.definitionId ?? '').includes('corridor') || m <= 3) return 1
    if (m <= 4) return 0.5
    return 0
  }

  _roomHasAnyTag(room, tags) {
    if (!this._roomTagCache) {
      const list = this._scene?.cache?.json?.get?.('rooms') ?? []
      this._roomTagCache = Object.fromEntries(list.map(d => [d.id, new Set(d.tags ?? [])]))
    }
    const set = this._roomTagCache[room.definitionId]
    return !!set && tags.some(t => set.has(t))
  }

  // Bump nearby living same-party mates' nerve up a touch each tick (the anchor aura).
  _steadyAllies(adv, strength, dtSec) {
    for (const m of this._gameState.adventurers?.active ?? []) {
      if (m === adv || m.aiState === 'dead' || m.partyId !== adv.partyId || !adv.partyId) continue
      if (Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY) > 5) continue
      this._seed(m)
      this._apply(m, strength * dtSec)
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  _nearestHostileTiles(adv) {
    let best = Infinity
    for (const m of this._gameState.minions ?? []) {
      if (m.faction !== 'dungeon') continue
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) continue
      const d = Math.hypot(m.tileX - adv.tileX, m.tileY - adv.tileY)
      if (d < best) best = d
    }
    return best
  }

  _tilesFromEntry(adv) {
    const sx = adv.spawnTileX ?? adv.tileX
    const sy = adv.spawnTileY ?? adv.tileY
    return Math.max(Math.abs(adv.tileX - sx), Math.abs(adv.tileY - sy))
  }

  _apply(adv, deltaNerve, floor = null) {
    if (!deltaNerve) return
    // A personality floor (Veteran/Martyr/Raid Leader) keeps nerve from dropping
    // below a set point — they don't fully break.
    const lo = floor != null ? Math.max(0, floor) : (this._profiles.get(adv.instanceId)?.floor ?? 0)
    const prev = adv.mood
    adv.nerve = _clamp((adv.nerve ?? 100) + deltaNerve, lo, 100)
    const band = _bandFor(adv.nerve)
    if (band !== prev) {
      adv.mood = band
      EventBus.emit('NERVE_BAND_CHANGED', { adventurer: adv, band, prev })
    }
  }

  // Resolve an adventurer object from an event source/victim that may be a bare
  // reference or just carry an instanceId.
  _resolveAdv(ref) {
    if (!ref) return null
    const id = ref.instanceId ?? ref
    return (this._gameState.adventurers?.active ?? []).find(a => a.instanceId === id) ?? null
  }

  // ── Discrete impulse handlers ───────────────────────────────────────────────
  _onKill({ source, victim } = {}) {
    if (victim?.isBoss) return            // boss kill is its own flow
    const adv = this._resolveAdv(source)
    if (!adv || adv.aiState === 'dead') return
    if (adv.faction === 'dungeon') return // a minion kill, not an adventurer's
    const prof = this._seed(adv)
    this._apply(adv, IMP_KILL)
    // Underdog — every kill emboldens (the snowball). Berserker — carnage feeds the frenzy.
    if (prof.emboldenPerKill) this._apply(adv, prof.emboldenPerKill)
    if (prof.invert)          this._apply(adv, 6)
  }

  _onAdvDied({ adventurer } = {}) {
    if (!adventurer) return
    for (const a of this._gameState.adventurers?.active ?? []) {
      if (a === adventurer || a.aiState === 'dead') continue
      this._seed(a)
      if (adventurer.partyId && a.partyId === adventurer.partyId) {
        this._apply(a, IMP_ALLY_DEATH_PT)
      } else {
        const d = Math.hypot(a.tileX - adventurer.tileX, a.tileY - adventurer.tileY)
        if (d <= ALLY_DEATH_RADIUS) this._apply(a, IMP_ALLY_DEATH_NR)
      }
    }
  }

  _onTrap({ adventurer, damaged } = {}) {
    if (!damaged || !adventurer || adventurer.aiState === 'dead') return
    this._seed(adventurer)
    this._apply(adventurer, IMP_TRAP)
  }

  _onHit({ targetId, damage } = {}) {
    // Only adventurers taking real damage. COMBAT_HIT payload is
    // { sourceId, targetId, damage, ... }; _resolveAdv returns null for
    // minion/boss targetIds (they aren't in adventurers.active), so this is
    // implicitly adventurer-only.
    if (!targetId || !(damage > 0)) return
    const adv = this._resolveAdv(targetId)
    if (!adv || adv.aiState === 'dead') return
    const maxHp = adv.resources?.maxHp || 1
    const pct = (damage / maxHp) * 100
    if (pct <= 0) return
    this._seed(adv)
    this._apply(adv, Math.max(IMP_HIT_CAP, IMP_HIT_PER_PCT * pct))
  }

  _onLoot({ adv, adventurer } = {}) {
    const a = adv ?? adventurer
    if (!a || a.aiState === 'dead') return
    this._seed(a)
    this._apply(a, IMP_LOOT)
  }

  _onHeal({ adventurer } = {}) {
    if (!adventurer || adventurer.aiState === 'dead') return
    this._seed(adventurer)
    this._apply(adventurer, IMP_HEAL)
  }
}

// ── Module helpers ────────────────────────────────────────────────────────────
function _clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

function _bandFor(nerve) {
  if (nerve > BAND_BOLD)    return 'bold'
  if (nerve > BAND_STEADY)  return 'steady'
  if (nerve > BAND_WARY)    return 'wary'
  if (nerve > BAND_SPOOKED) return 'spooked'
  return 'breaking'
}

// Exposed for AISystem / renderer so band logic lives in one place.
export const NerveBands = { BAND_BOLD, BAND_STEADY, BAND_WARY, BAND_SPOOKED, bandFor: _bandFor }

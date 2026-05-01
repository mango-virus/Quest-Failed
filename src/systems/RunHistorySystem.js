// Phase 31I — UI overhaul, run-history plumbing.
//
// Subscribes to gameplay events and folds them into per-run aggregates that
// the new HUD / Boss Overview / Post-Wave Summary / Game Over screens read.
// All writes target plain JSON-serializable fields on `gameState` (run.totals,
// history.pacts, minion.lifetime, adventurers.known[].escapeCount), so the
// SaveSystem can persist them without changes.
//
// This system carries NO gameplay behavior — it only observes and aggregates.
// Disabling it would not change any in-game effect.

import { EventBus } from './EventBus.js'

export class RunHistorySystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState

    // Schema safety: SaveSystem.load rehydrates these on read, but a fresh
    // run goes through createGameState which already initializes them. The
    // `??=` here is belt-and-braces for any path that constructed gameState
    // without going through either (tests, dev console).
    this._gameState.run        ??= { startedAt: Date.now(), totals: {} }
    this._gameState.run.totals ??= {}
    this._gameState.history    ??= { days: [], events: [], pacts: [] }
    this._gameState.history.pacts ??= []

    EventBus.on('ROOM_PLACED',       this._onRoomPlaced,    this)
    EventBus.on('ROOM_REMOVED',      this._onRoomRemoved,   this)
    EventBus.on('TRAP_PLACED',       this._onTrapPlaced,    this)
    EventBus.on('TRAP_REMOVED',      this._onTrapRemoved,   this)
    EventBus.on('MINION_PLACED',     this._onMinionPlaced,  this)
    EventBus.on('MINION_DIED',       this._onMinionDied,    this)
    EventBus.on('ADVENTURER_DIED',   this._onAdvDied,       this)
    EventBus.on('ADVENTURER_FLED',   this._onAdvFled,       this)
    EventBus.on('COMBAT_HIT',        this._onCombatHit,     this)
    EventBus.on('PACT_SEALED',       this._onPactSealed,    this)
    EventBus.on('RESOURCES_AWARDED', this._onResourcesAwarded, this)
  }

  destroy() {
    EventBus.off('ROOM_PLACED',       this._onRoomPlaced,    this)
    EventBus.off('ROOM_REMOVED',      this._onRoomRemoved,   this)
    EventBus.off('TRAP_PLACED',       this._onTrapPlaced,    this)
    EventBus.off('TRAP_REMOVED',      this._onTrapRemoved,   this)
    EventBus.off('MINION_PLACED',     this._onMinionPlaced,  this)
    EventBus.off('MINION_DIED',       this._onMinionDied,    this)
    EventBus.off('ADVENTURER_DIED',   this._onAdvDied,       this)
    EventBus.off('ADVENTURER_FLED',   this._onAdvFled,       this)
    EventBus.off('COMBAT_HIT',        this._onCombatHit,     this)
    EventBus.off('PACT_SEALED',       this._onPactSealed,    this)
    EventBus.off('RESOURCES_AWARDED', this._onResourcesAwarded, this)
  }

  // ─── Event handlers ────────────────────────────────────────────────────

  _onRoomPlaced()   { this._gameState.run.totals.roomsBuilt++ }
  _onRoomRemoved()  { this._gameState.run.totals.roomsDestroyed++ }
  _onTrapPlaced()   { this._gameState.run.totals.trapsPlaced++ }
  _onTrapRemoved()  { this._gameState.run.totals.trapsDisarmed++ }
  _onMinionPlaced() { this._gameState.run.totals.minionsSummoned++ }
  _onMinionDied()   { this._gameState.run.totals.minionsLost++ }

  _onAdvDied(payload) {
    const t = this._gameState.run.totals
    t.advsKilled++
    t.kills++
    // Bump killer minion's lifetime kill count when the killer is a minion.
    const killerId = payload?.killerId
    if (!killerId || killerId === 'boss' || killerId === 'unknown') return
    const m = this._gameState.minions?.find(x => x.instanceId === killerId)
    if (m) {
      m.lifetime ??= { kills: 0, damageDealt: 0 }
      m.lifetime.kills++
    }
  }

  _onAdvFled(payload) {
    this._gameState.run.totals.advsEscaped++
    const adv = payload?.adventurer
    if (!adv) return
    // Increment per-instance escape count + reconcile to the named-identity
    // entry in adventurers.known so a returning adventurer accumulates.
    adv.escapeCount = (adv.escapeCount ?? 0) + 1
    this._gameState.adventurers ??= { active: [], known: [], graveyard: [] }
    this._gameState.adventurers.known ??= []
    let known = this._gameState.adventurers.known.find(k => k.name === adv.name)
    if (!known) {
      known = {
        name:        adv.name,
        classId:     adv.classId,
        escapeCount: 0,
        lastEscapedDay: null,
      }
      this._gameState.adventurers.known.push(known)
    }
    known.escapeCount++
    known.lastEscapedDay = this._gameState.meta.dayNumber
  }

  _onCombatHit(payload) {
    const dmg = payload?.damage ?? 0
    if (!dmg) return
    const sourceId = payload.sourceId
    const targetId = payload.targetId
    const minions  = this._gameState.minions ?? []

    const sourceMinion = minions.find(m => m.instanceId === sourceId)
    if (sourceMinion) {
      sourceMinion.lifetime ??= { kills: 0, damageDealt: 0 }
      sourceMinion.lifetime.damageDealt += dmg
      this._gameState.run.totals.dmgDealt += dmg
      return
    }

    // Either trap or boss damaged an adv — count as dealt by the dungeon.
    const adv = this._gameState.adventurers?.active?.find(a => a.instanceId === targetId)
    if (adv) {
      this._gameState.run.totals.dmgDealt += dmg
      return
    }

    // Adventurer hit a minion (or the boss) — that's damage taken by the dungeon.
    const targetMinion = minions.find(m => m.instanceId === targetId)
    if (targetMinion || sourceId !== 'boss') {
      this._gameState.run.totals.dmgTaken += dmg
    }
  }

  _onResourcesAwarded(payload) {
    const t = this._gameState.run.totals
    if (typeof payload?.gold  === 'number') t.gold  += payload.gold
    if (typeof payload?.souls === 'number') t.souls += payload.souls
  }

  _onPactSealed(payload) {
    if (!payload?.mechanicId) return
    this._gameState.history.pacts ??= []
    this._gameState.history.pacts.push({
      day:        this._gameState.meta.dayNumber,
      mechanicId: payload.mechanicId,
      rarity:     payload.rarity ?? 'common',
    })
  }
}

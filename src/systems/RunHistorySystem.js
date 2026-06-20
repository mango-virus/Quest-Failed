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
    EventBus.on('INTEL_LEAKED',      this._onIntelLeaked,     this)
    EventBus.on('LOOT_GOBLIN_ESCAPED', this._onLootGoblinEscaped, this)
    // Treasure chests skim the player's gold when cracked, and refund it
    // if the thief is killed before escaping — track both so goldLost
    // ends up as the gold *permanently* lost to chests.
    EventBus.on('TREASURE_STOLEN',     this._onTreasureStolen,    this)
    EventBus.on('TREASURE_RECOVERED',  this._onTreasureRecovered, this)
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
    EventBus.off('INTEL_LEAKED',      this._onIntelLeaked,    this)
    EventBus.off('LOOT_GOBLIN_ESCAPED', this._onLootGoblinEscaped, this)
    EventBus.off('TREASURE_STOLEN',     this._onTreasureStolen,    this)
    EventBus.off('TREASURE_RECOVERED',  this._onTreasureRecovered, this)
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
    // Record the class kill for the per-run intel gate (Library + a kill of
    // this class reveals its full dossier/abilities for the rest of the run).
    const deadCls = payload?.adventurer?.classId
    if (deadCls) {
      const seen = (this._gameState.run.classesKilled ??= [])
      if (!seen.includes(deadCls)) seen.push(deadCls)
    }
    // A returning "hero" who dies is gone for good — scrub them from the
    // known-adventurer pool so they can never come back. (Their
    // knowledge-survivor record, which actually gates the returning-
    // veteran spawn, is purged separately by KnowledgeSystem._onAdventurerDied.)
    const dead = payload?.adventurer
    if (dead?.name) {
      const known = this._gameState.adventurers?.known
      if (Array.isArray(known)) {
        const i = known.findIndex(k => k.name === dead.name)
        if (i !== -1) known.splice(i, 1)
      }
    }
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
    // Loot Goblins raid once and leave — they never become a "known"
    // veteran/hero and can't return, so keep them out of the pool
    // entirely (no returning-adventurer UI, no FullLog leak entry).
    if (adv.classId === 'loot_goblin') return
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
        // Preserve the LPC variant + level so the PostWaveSummary,
        // AdvIntel, and any other "returning veteran" UI can render
        // the EXACT sprite the player saw flee, not a v01 stand-in.
        // Without this, every escaped adv in PostWave showed a
        // generic class portrait instead of the unique character that
        // got away.
        spriteVariant: adv.spriteVariant ?? null,
        // Event-invader sprite fields — rival-dungeon monsters render from
        // a minion sheet and the rival boss from a boss-archetype skin
        // (neither carries an LPC spriteVariant). Preserve them or the
        // escaped-adventurer UI (PostWaveSummary, AdvIntel) falls back to a
        // humanoid stand-in instead of the actual creature.
        _minionSheet:        adv._minionSheet        ?? null,
        _rivalBossSpriteKey: adv._rivalBossSpriteKey ?? null,
        // Monster invaders never "carry intel" — the post-wave summary
        // reads this to show a neutral retreat message instead.
        _monster:            adv._monster            ?? null,
        // `level` here is the cosmetic display level the player saw, not
        // the XP counter — so returning-veteran UI shows the same number.
        level:       adv.displayLevel ?? adv.level ?? 1,
        escapeCount: 0,
        lastEscapedDay: null,
      }
      this._gameState.adventurers.known.push(known)
    }
    // Update sprite + level each time a known adv escapes again — they
    // may have leveled between visits and their variant is the same
    // each return (spriteVariant persists on the live adv object).
    known.spriteVariant = adv.spriteVariant ?? known.spriteVariant ?? null
    known._minionSheet        = adv._minionSheet        ?? known._minionSheet        ?? null
    known._rivalBossSpriteKey = adv._rivalBossSpriteKey ?? known._rivalBossSpriteKey ?? null
    known._monster            = adv._monster            ?? known._monster            ?? null
    known.level = adv.displayLevel ?? adv.level ?? known.level ?? 1
    known.escapeCount++
    known.lastEscapedDay = this._gameState.meta.dayNumber
    // Carry the gold this escapee made off with onto the record so the
    // post-wave summary's "Ng STOLEN" chip shows it: the loot-goblin
    // heist skim (adv.goldStolen, stamped by EventSystem) PLUS any
    // treasure-chest loot they're still carrying (adv.stolenGold).
    known.goldStolen = (adv.goldStolen ?? 0) + (adv.stolenGold ?? 0)
  }

  // Loot Goblin Heist — fold the skimmed gold into a per-run loss total
  // so the post-wave summary can show net gold, not just gold earned.
  _onLootGoblinEscaped(payload) {
    const stolen = Number(payload?.stolen ?? 0)
    if (!stolen) return
    const t = this._gameState.run.totals
    t.goldLost = (t.goldLost ?? 0) + stolen
  }

  // Treasure chest cracked — gold skimmed straight from the player.
  _onTreasureStolen(payload) {
    const gold = Number(payload?.gold ?? 0)
    if (!gold) return
    const t = this._gameState.run.totals
    t.goldLost = (t.goldLost ?? 0) + gold
  }

  // Chest thief killed before escaping — their haul is refunded, so the
  // loss is reversed.
  _onTreasureRecovered(payload) {
    const gold = Number(payload?.gold ?? 0)
    if (!gold) return
    const t = this._gameState.run.totals
    t.goldLost = Math.max(0, (t.goldLost ?? 0) - gold)
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

  _onIntelLeaked(payload) {
    const n = Number(payload?.count ?? 0)
    if (!n) return
    const t = this._gameState.run.totals
    t.intelLeaks = (t.intelLeaks ?? 0) + n
    // Also bump a discrete leak-event counter (each fled adventurer
    // counts as one event regardless of how many items they took) so
    // the leaderboard can show "12 leak events" if it ever wants that.
    t.leakEvents = (t.leakEvents ?? 0) + 1
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

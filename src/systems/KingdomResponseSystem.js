// KingdomResponseSystem — KR P4. Owns the drafted middle of the campaign.
//
// Acts I and IV are fixed (the Nemesis's birth and the final duel). Acts II and
// III are DRAFTED: at each of those act transitions the kingdom escalates with a
// new strategy drawn from the Kingdom Responses pool (src/data/kingdomResponses.json),
// never repeating within a run. Each response gives its act a distinct identity —
// a threat, a signature gimmick, and a clear-condition.
//
// This system is the spine: it drafts a response when Act II / III begins, stores
// it on meta.act.responses (save-safe), and fires KINGDOM_RESPONSE_DRAWN so the
// announce set-piece (KingdomResponseIntro) and — later — each response's gameplay
// gimmick (KR P4 wiring) and Champion raid (KR P3) can react. The draft is uniform
// random today; KR P5 (Adaptive Weighting) tilts it by the player's run-stats via
// the _weightsFor() hook below. Gated behind the `acts` flag; Game.js only
// constructs it when acts are on.
//
// See DESIGN.md → "Acts II & III — The Kingdom Responds (DRAFTED)".

import { EventBus } from './EventBus.js'
import { actDef } from '../config/acts.js'

// Which acts draw a response. Acts I (apprentice trials) and IV (the reckoning)
// are fixed, so only II and III pull from the pool.
const DRAFTED_ACTS = [2, 3]

export class KingdomResponseSystem {
  constructor(scene, gameState) {
    this._scene = scene
    this._gs = gameState
    this._pool = scene?.cache?.json?.get('kingdomResponses') ?? []
    this._byId = new Map((Array.isArray(this._pool) ? this._pool : []).map(r => [r.id, r]))
    this._ensureState()
    // ActSystem emits ACT_STARTED both at run start (atRunStart:true, for the
    // current act on a fresh run / continue) and on every act transition. We
    // draft lazily on whichever fires for a drafted act that has no response yet.
    EventBus.on('ACT_STARTED', this._onActStarted, this)
    // The champion raid's payoff — putting down the response's champion breaks
    // that Kingdom Response (the act's intended challenge).
    EventBus.on('ADVENTURER_DIED', this._onAdventurerDied, this)
    // Mango-dev QA hook (DevKingdomButton) — force a response live without
    // grinding to a drafted act.
    EventBus.on('DEV_FORCE_KINGDOM_RESPONSE', this._onDevForce, this)
  }

  destroy() {
    EventBus.off('ACT_STARTED', this._onActStarted, this)
    EventBus.off('ADVENTURER_DIED', this._onAdventurerDied, this)
    EventBus.off('DEV_FORCE_KINGDOM_RESPONSE', this._onDevForce, this)
  }

  // Dev/QA: make `responseId` the current drafted act (act 2) right now — which
  // activates its act-wide modifier + the HUD eyebrow — announce it, and, if a
  // day is in progress, spawn its Champion raid so the combat modifier is live
  // too. Lets us QA any modifier instantly. Only fired by the mango dev button.
  _onDevForce({ responseId } = {}) {
    const response = this._byId.get(responseId)
    if (!response) return
    this._ensureState()
    const meta = this._gs.meta
    meta.act.current = 2
    meta.act.responses[2] = responseId
    EventBus.emit('KINGDOM_RESPONSE_DRAWN', { act: 2, def: actDef(2), response })
    const dayPhase = this._scene?.scene?.get?.('DayPhase')
    if (dayPhase?.scene?.isActive?.() && dayPhase._gameState &&
        typeof dayPhase._spawnChampionRaid === 'function') {
      dayPhase._spawnChampionRaid(response)
    }
  }

  // The Champion raid's payoff. When the response's champion (a `_kingdomChampion`
  // mini-boss) falls in the dungeon, that Kingdom Response is broken: record it
  // and fire CHAMPION_DEFEATED for the triumphant log beat (+ later scoring /
  // Aldric's adaptive ascension). Idempotent per act.
  _onAdventurerDied({ adventurer } = {}) {
    if (!adventurer?._kingdomChampion) return
    this._ensureState()
    const act = this._gs.meta?.act?.current ?? 0
    const responseId = adventurer._championResponseId || this._gs.meta?.act?.responses?.[act]
    const defeated = (this._gs.meta.act.championsDefeated ??= {})
    if (defeated[act]) return   // already credited this act
    defeated[act] = responseId || true
    EventBus.emit('CHAMPION_DEFEATED', {
      act, responseId, champion: adventurer.name,
      response: responseId ? this._byId.get(responseId) : null,
    })
  }

  // meta.act.responses maps act number → drafted response id. Backfilled here so
  // fresh runs and old saves both have it — no SaveSystem migration needed.
  _ensureState() {
    const meta = this._gs.meta ?? (this._gs.meta = {})
    meta.act ??= {}
    meta.act.responses ??= {}   // { "2": "reckoning_dead", "3": "mage_tower" }
  }

  _onActStarted({ act } = {}) {
    if (!DRAFTED_ACTS.includes(act)) return
    this._ensureState()
    const existing = this._gs.meta.act.responses[act]
    if (existing) {
      // Already drafted (transition re-announce, or a continue). Re-surface it so
      // the intro can play, but don't re-roll.
      this._announce(act, this._byId.get(existing))
      return
    }
    const response = this._draft(act)
    if (!response) return
    this._gs.meta.act.responses[act] = response.id
    this._announce(act, response)
  }

  // Draw an unused response for this act. Uniform among the not-yet-used pool for
  // now; KR P5 multiplies each candidate's odds by _weightsFor(id).
  _draft(act) {
    const used = new Set(Object.values(this._gs.meta.act.responses ?? {}))
    const available = (Array.isArray(this._pool) ? this._pool : []).filter(r => !used.has(r.id))
    if (available.length === 0) return null

    const weights = available.map(r => Math.max(0.0001, this._weightsFor(r.id)))
    const total = weights.reduce((a, b) => a + b, 0)
    let roll = Math.random() * total
    for (let i = 0; i < available.length; i++) {
      roll -= weights[i]
      if (roll <= 0) return available[i]
    }
    return available[available.length - 1]
  }

  // KR P5 hook: per-response weight from the player's run-stats so the kingdom
  // counters THIS dungeon (slaughter → Reckoning/Pantheon, pact-reliance →
  // Inquisition/Pantheon, etc. via each response's weightTags). Uniform until P5.
  _weightsFor(_id) {
    return 1
  }

  _announce(act, response) {
    if (!response) return
    EventBus.emit('KINGDOM_RESPONSE_DRAWN', { act, def: actDef(act), response })
  }

  // ── API for the announce set-piece, gimmick wiring, and Champion raid ──────

  responseForAct(act) {
    const id = this._gs.meta?.act?.responses?.[act]
    return id ? (this._byId.get(id) ?? null) : null
  }

  currentResponse() {
    return this.responseForAct(this._gs.meta?.act?.current ?? 0)
  }
}

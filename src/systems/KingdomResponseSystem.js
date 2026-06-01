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

// ── Adaptive weighting (KR P5) ──────────────────────────────────────────────
// The kingdom counters THIS dungeon. Each response carries `weightTags` naming
// the playstyle it answers; we turn the player's run-stats into a 0..1
// "pressure" per tag, and a response's draft odds = BASE + Σ(pressure × SCALE)
// over its tags. So a slaughter-heavy run tilts toward Pantheon / Reckoning, a
// pact-stacked run toward Inquisition / Mage Tower, a sprawling minion horde
// toward the Rival / Betrayer — without ever being deterministic.
const WEIGHT_BASE  = 1
const WEIGHT_SCALE = 1.6
// Reference points for "a lot of X" — pressure maxes out here. Tunable.
const REF_MINIONS  = 12
const REF_EVOLVED  = 6
const REF_PACTS    = 8
const REF_UNDEAD   = 8
const REF_KILLS    = 180
const REF_TREASURY = 1200

const _UNDEAD_RE = /ghost|lich|skelet|zombie|wraith|bone|undead|revenant|ghoul|vampire/
const _clamp01 = x => Math.max(0, Math.min(1, x))

// Per-tag pressure from a run-stat snapshot (see _runSignals). Tags map to the
// weightTags used across kingdomResponses.json.
const TAG_SIGNAL = {
  minions:   s => _clamp01(s.minionCount  / REF_MINIONS),
  evolved:   s => _clamp01(s.evolvedCount  / REF_EVOLVED),
  pacts:     s => _clamp01(s.pactCount     / REF_PACTS),
  buffs:     s => _clamp01(s.pactCount     / REF_PACTS),   // pacts ARE the dungeon's buffs
  undead:    s => _clamp01(s.undeadCount   / REF_UNDEAD),
  kills:     s => _clamp01(s.kills         / REF_KILLS),
  treasury:  s => _clamp01(s.gold          / REF_TREASURY),
  // Slaughter/martyr reward THOROUGH killers — ratio past 0.55 ramps to 1.
  slaughter: s => _clamp01((s.slaughterRatio - 0.55) / 0.35),
  martyr:    s => _clamp01((s.slaughterRatio - 0.55) / 0.35),
}

// Player-facing phrase for the strongest signal that drew a response — so the
// reveal can tell the player WHY the kingdom is countering them this way.
const TAG_REASON = {
  minions:   'your swarming horde',
  evolved:   'your evolved monsters',
  pacts:     'your dark pacts',
  buffs:     'your dark pacts',
  undead:    'your legion of undead',
  kills:     'the slaughter in your halls',
  slaughter: 'the slaughter in your halls',
  martyr:    'the martyrs you have made',
  treasury:  'your hoarded gold',
}

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

  // Draw an unused response for this act, with odds tilted by the player's run
  // (KR P5). We snapshot the run-stats ONCE per draft so every candidate is
  // judged against the same picture, then weighted-random over the pool.
  _draft(act) {
    const used = new Set(Object.values(this._gs.meta.act.responses ?? {}))
    const available = (Array.isArray(this._pool) ? this._pool : []).filter(r => !used.has(r.id))
    if (available.length === 0) return null

    this._signals = this._runSignals()
    const weights = available.map(r => Math.max(0.0001, this._weightsFor(r.id)))
    const total = weights.reduce((a, b) => a + b, 0)
    // Stash the reasoning so the reveal / a QA tool can explain "why this one".
    this._lastDraft = { act, weights: available.map((r, i) => [r.id, +weights[i].toFixed(2)]), signals: this._signals }
    let roll = Math.random() * total
    let chosen = available[available.length - 1]
    for (let i = 0; i < available.length; i++) {
      roll -= weights[i]
      if (roll <= 0) { chosen = available[i]; break }
    }
    // Stash WHY it was drawn (the strongest playstyle signal this response
    // answers) so the reveal can call it out — and so it survives a continue.
    this._gs.meta.act.draftReason ??= {}
    this._gs.meta.act.draftReason[act] = this._reasonFor(chosen)
    return chosen
  }

  // The player-facing reason a response was drawn: the highest-pressure tag it
  // answers (above a floor so a neutral run gets no spurious "why"). Null = the
  // draw was effectively uniform (nothing about the run stood out).
  _reasonFor(response) {
    const s = this._signals ?? this._runSignals()
    let best = null, bestP = 0.3
    for (const t of (response?.weightTags ?? [])) {
      const p = TAG_SIGNAL[t]?.(s) ?? 0
      if (p > bestP) { bestP = p; best = t }
    }
    return best ? (TAG_REASON[best] ?? null) : null
  }

  // Per-response draft weight (KR P5): BASE + Σ(tag-pressure × SCALE) over the
  // response's weightTags, so the kingdom leans toward countering how THIS
  // dungeon actually plays. Reads the per-draft `_signals` snapshot.
  _weightsFor(id) {
    const tags = this._byId.get(id)?.weightTags ?? []
    if (tags.length === 0) return WEIGHT_BASE
    const s = this._signals ?? (this._signals = this._runSignals())
    let w = WEIGHT_BASE
    for (const t of tags) {
      const fn = TAG_SIGNAL[t]
      if (fn) w += fn(s) * WEIGHT_SCALE
    }
    return w
  }

  // Snapshot the run-stats the adaptive draft reads. Live roster + run totals +
  // treasury; all plain reads so it's cheap to call per draft.
  _runSignals() {
    const gs = this._gs
    const minions = Array.isArray(gs.minions) ? gs.minions : []
    const alive = minions.filter(m => (m.resources?.hp ?? 1) > 0)
    const t = gs.run?.totals ?? {}
    const kills = t.kills ?? 0
    const escaped = t.advsEscaped ?? 0
    return {
      minionCount:  alive.length,
      evolvedCount: alive.filter(m => (m.evolutionHistory?.length ?? 0) > 0).length,
      undeadCount:  alive.filter(m => _UNDEAD_RE.test(String(m.definitionId ?? '').toLowerCase())).length,
      pactCount:    gs.history?.pacts?.length ?? gs.activeMechanics?.length ?? 0,
      kills,
      slaughterRatio: (kills + escaped) > 0 ? kills / (kills + escaped) : 0.5,
      gold:         gs.player?.gold ?? 0,
    }
  }

  _announce(act, response) {
    if (!response) return
    EventBus.emit('KINGDOM_RESPONSE_DRAWN', {
      act, def: actDef(act), response,
      reason: this._gs.meta?.act?.draftReason?.[act] ?? null,   // KR P5 — why this one
    })
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

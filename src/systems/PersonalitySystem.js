// Personality blending + combo detection.
// Phase 5: detects combos and exposes blended weights to AISystem.
// Combo *effects* (knowledge sharing, party split, taunts) wire in later phases
// when combat / knowledge / loot systems exist. For now combos are detected and
// displayed, but their behavioural impact is limited to what AISystem can act on
// (exploration weighting, goal selection).

import { EventBus } from './EventBus.js'

const DEFAULT_WEIGHTS = {
  fleeThreshold:    0.5,
  trapCaution:      0.5,
  partyCooperation: 0.5,
  explorationDrive: 0.5,
  aggressionLevel:  0.5,
  riskTolerance:    0.5,
  healPriority:     0.5,
}

// Some weights are MAX-blended instead of averaged: any single personality
// pushing a weight high should drive the party member that way (they are
// dispositions, not statistics).
const MAX_BLEND_WEIGHTS = new Set([
  'fleeThreshold',    // most cautious wins
  'trapCaution',      // most paranoid wins
  'explorationDrive', // most thorough wins
])

export class PersonalitySystem {
  constructor(scene) {
    this._scene = scene
    this._defs       = {}    // id → PersonalityDefinition
    this._comboDefs  = {}    // id → PersonalityComboDefinition
    this._classDefs  = {}    // id → AdventurerClassDefinition (for class-tag combos)
    this._loaded     = false
  }

  loadDefinitions() {
    if (this._loaded) return
    const personalities = this._scene.cache.json.get('personalities')      ?? []
    const combos        = this._scene.cache.json.get('personalityCombos')  ?? []
    const classes       = this._scene.cache.json.get('adventurerClasses')  ?? []
    this._defs       = Object.fromEntries(personalities.map(p => [p.id, p]))
    this._comboDefs  = Object.fromEntries(combos.map(c => [c.id, c]))
    this._classDefs  = Object.fromEntries(classes.map(c => [c.id, c]))
    this._loaded     = true
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  getDefinition(id)      { return this._defs[id] ?? null }
  getComboDefinition(id) { return this._comboDefs[id] ?? null }
  allDefinitions()       { return Object.values(this._defs) }
  allCombos()            { return Object.values(this._comboDefs) }

  // ── Personality assignment ────────────────────────────────────────────────

  // Roll N distinct personalities for a new adventurer.
  // Flat roll (AI & Personality Overhaul, 2026-06-10): every personality is
  // EQUALLY likely and UNGATED — the old rarity weighting (common×4/uncommon×2/
  // rare×1) and the `unlockLevel` day-gate were both removed at user request.
  // `rarity`/`unlockLevel` are kept in the data for display only. The dungeonLevel
  // arg is retained for call-site compatibility but no longer filters.
  rollPersonalities(count = 1, _dungeonLevel = 1) {
    const pool = this.allDefinitions()
    if (pool.length === 0) return []
    const out = []
    while (out.length < count && out.length < pool.length) {
      const pick = pool[Math.floor(Math.random() * pool.length)]
      if (!out.includes(pick.id)) out.push(pick.id)
    }
    return out
  }

  // ── Blended weights ───────────────────────────────────────────────────────

  // Returns the combined behaviorWeights for an adventurer's personality blend.
  getWeights(adventurer) {
    const ids = adventurer?.personalityIds ?? []
    if (ids.length === 0) return { ...DEFAULT_WEIGHTS }

    const buckets = {}
    for (const pid of ids) {
      const def = this._defs[pid]
      if (!def?.behaviorWeights) continue
      for (const [key, val] of Object.entries(def.behaviorWeights)) {
        (buckets[key] ??= []).push(val)
      }
    }
    const blended = { ...DEFAULT_WEIGHTS }
    for (const [key, values] of Object.entries(buckets)) {
      if (MAX_BLEND_WEIGHTS.has(key)) {
        blended[key] = Math.max(...values)
      } else {
        blended[key] = values.reduce((a, b) => a + b, 0) / values.length
      }
    }
    return blended
  }

  // Tags from all assigned personalities AND the adventurer's class.
  // Class tags participate in combo detection so cleric/necromancer/etc.
  // can pair with personality traits.
  getTags(adventurer) {
    const tags = new Set()
    for (const pid of (adventurer?.personalityIds ?? [])) {
      const def = this._defs[pid]
      if (def?.tags) for (const t of def.tags) tags.add(t)
    }
    const classDef = this._classDefs[adventurer?.classId]
    if (classDef?.tags) for (const t of classDef.tags) tags.add(t)
    return tags
  }

  // ── Combo detection ───────────────────────────────────────────────────────

  // Returns array of combos that activate for this party.
  // A combo activates when each tag group in `requiresTags` is satisfied by
  // at least one DIFFERENT party member (no self-pairing).
  checkCombos(party) {
    const activated = []
    if (!Array.isArray(party) || party.length < 2) return activated

    for (const combo of this.allCombos()) {
      if (this._partyMatchesCombo(party, combo)) activated.push(combo)
    }
    return activated
  }

  _partyMatchesCombo(party, combo) {
    const groups = combo.requiresTags ?? []
    if (groups.length === 0) return false
    if (party.length < groups.length) return false

    // For each group, find which party members satisfy it.
    const groupMatches = groups.map(group => {
      return party.filter(adv => {
        const tags = this.getTags(adv)
        return group.some(t => tags.has(t))
      })
    })
    if (groupMatches.some(matches => matches.length === 0)) return false

    // Check that we can pick distinct party members for each group.
    return _hasDistinctAssignment(groupMatches)
  }

  // ── AI hooks ──────────────────────────────────────────────────────────────

  // Called by AISystem when an adventurer needs a new goal.
  // situation.unvisitedRooms = rooms (excluding boss) the adventurer hasn't entered.
  evaluateGoal(adventurer, situation) {
    const weights = this.getWeights(adventurer)

    if (situation?.unvisitedRooms?.length > 0) {
      // Higher explorationDrive → higher chance to detour rather than rush boss.
      const drive = weights.explorationDrive ?? 0.5
      if (Math.random() < drive) {
        const room = _pickClosestRoom(adventurer, situation.unvisitedRooms)
        if (room) return { type: 'EXPLORE_ROOM', roomId: room.instanceId }
      }
    }
    return { type: 'SEEK_BOSS' }
  }

  // ── Combo activation event ────────────────────────────────────────────────

  emitCombosForParty(party, partyId) {
    // Phase 5c — personality combos retired entirely. Method kept for
    // backward compatibility with existing call sites (DayPhase) but no
    // longer fires events. personalityCombos.json is also empty.
    return []
  }
}

// ── Module helpers ──────────────────────────────────────────────────────────

function _pickClosestRoom(adv, rooms) {
  let best = null, bestDist = Infinity
  for (const room of rooms) {
    const cx = room.gridX + Math.floor(room.width / 2)
    const cy = room.gridY + Math.floor(room.height / 2)
    const d  = Math.abs(adv.tileX - cx) + Math.abs(adv.tileY - cy)
    if (d < bestDist) { best = room; bestDist = d }
  }
  return best
}

// Bipartite-matching-style check: can we assign each group to a distinct party member?
// Group sizes are tiny (1-3) so brute force is fine.
function _hasDistinctAssignment(groupMatches) {
  const used = new Set()
  function tryAssign(idx) {
    if (idx >= groupMatches.length) return true
    for (const adv of groupMatches[idx]) {
      if (used.has(adv.instanceId)) continue
      used.add(adv.instanceId)
      if (tryAssign(idx + 1)) return true
      used.delete(adv.instanceId)
    }
    return false
  }
  return tryAssign(0)
}

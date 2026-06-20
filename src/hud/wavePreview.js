// wavePreview — shared read of the authoritative incoming-wave roster.
//
// Single source of truth: `gameState.run.nextWavePreview`, the pre-roll
// NightPhase persists and DayPhase consumes at spawn. The RightPanels INCOMING
// WAVE panel and the day PhaseTransition both read it through here so they
// always agree on who's coming.
//
// Library gate: the per-adventurer class breakdown is intel — it only unlocks
// when an active Library of Whispers is placed. Without one, callers get an
// empty roster (they should fall back to a count-only / no-roster presentation).

// True when an active Library of Whispers is placed — the room that leaks the
// next wave's adventurer roster.
export function hasActiveLibrary(gs) {
  return (gs?.dungeon?.rooms ?? [])
    .some(r => r.definitionId === 'library_of_whispers' && r.isActive !== false)
}

// Per-class adventurer intel gate (2026-06-20). A class's full dossier —
// stats, personality, abilities — is revealed only when BOTH are true:
//   1. an active Library of Whispers is placed, AND
//   2. the dungeon has KILLED one of that class THIS run.
// Event-tier invaders (unlockLevel >= 99: Sung Jinwoo, Aldric, the FF/Solo
// set-pieces) are exempt from the kill requirement — they're one-off
// narrative foes you may never get to kill — but still need a Library.
// `classDef` is the adventurerClasses.json entry ({ id, unlockLevel }).
export function hasClassIntel(gs, classDef) {
  if (!hasActiveLibrary(gs)) return false
  if (!classDef) return false
  if ((classDef.unlockLevel ?? 1) >= 99) return true
  const killed = gs?.run?.classesKilled
  return Array.isArray(killed) && killed.includes(String(classDef.id))
}

// The exact adventurers coming in the previewed wave, as lightweight objects
// snapshotAdventurerEntity() can render ({ classId, spriteVariant, veteran,
// _minionSheet?, _rivalBossSpriteKey? }). Vendetta hunter (when pre-rolled)
// leads. Returns [] when there's no preview OR no active Library.
export function incomingWaveParty(gs) {
  const preview = gs?.run?.nextWavePreview
  if (!preview || !Array.isArray(preview.classIds)) return []
  if (!hasActiveLibrary(gs)) return []

  const party = []
  // Returning enemy with a vendetta leads the line, fixed slot.
  if (preview.vendettaHunter?.claimantClass) {
    party.push({
      classId: preview.vendettaHunter.claimantClass,
      spriteVariant: preview.vendettaHunter.spriteVariant ?? null,
      veteran: true,
    })
  }
  const variants = Array.isArray(preview.spriteVariants) ? preview.spriteVariants : []
  for (let i = 0; i < preview.classIds.length; i++) {
    const id = preview.classIds[i]
    // Pre-rolled `<class>/vNN` LPC variant (the EXACT sprite that spawns) wins
    // over the bare classId so the roster shows the real character.
    const tile = { classId: id, spriteVariant: variants[i] ?? null }
    // Event waves carry pre-rolled creature sprites parallel to classIds:
    //   minionSheets[i] — a `minion-<id>` key (rival monsters / zombie horde)
    //   bossSkins[i]    — per-slot rival-boss archetype skin (Boss Royale /
    //                     All-Stars: each invader is a DIFFERENT boss)
    //   bossSkin        — a single rival-boss skin (Rival Dungeon's lone champ)
    // Mirror AdvIntelOverlay: prefer the per-slot array, fall back to the single.
    if (Array.isArray(preview.minionSheets) && preview.minionSheets[i]) {
      tile._minionSheet = preview.minionSheets[i]
    }
    if (id === 'rival_boss_invader') {
      const skin = preview.bossSkins?.[i] ?? preview.bossSkin
      if (skin) tile._rivalBossSpriteKey = skin
    }
    party.push(tile)
  }
  return party
}

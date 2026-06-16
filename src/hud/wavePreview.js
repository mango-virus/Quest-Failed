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
    const tile = { classId: id, spriteVariant: variants[i] ?? null }
    // Event waves carry pre-rolled creature sprites parallel to classIds —
    // minionSheets[i] for rival monsters / zombies, bossSkin for the rival boss.
    if (Array.isArray(preview.minionSheets) && preview.minionSheets[i]) {
      tile._minionSheet = preview.minionSheets[i]
    }
    if (preview.bossSkin && id === 'rival_boss_invader') {
      tile._rivalBossSpriteKey = preview.bossSkin
    }
    party.push(tile)
  }
  return party
}

// bossUnlocks.js — single source of truth for "which boss archetypes are
// unlocked for the current player." Pulled out of ArchetypeSelect so non-
// Phaser surfaces (MainMenuOverlay's "NEW EVIL" badge logic, the NEW-tag
// system's hasUnseenNewBosses check) can enumerate the unlocked set
// without touching the scene module or the Phaser JSON cache.
//
// `ALL_BOSS_IDS` mirrors the `id` field of every entry in
// `src/data/bossArchetypes.json`. Hardcoded here as a small list rather
// than re-parsing the JSON at module-load time — these ids are stable
// (changing one would be a save-game breaking change, not a quiet edit),
// so the duplication is low-cost and lets this module stay synchronous
// + import-free.
//
// `UNLOCK_GATES` mirrors the legacy const that used to live inside
// ArchetypeSelect.js. ArchetypeSelect now imports UNLOCK_GATES from here
// instead of duplicating it. Bosses absent from the map are unlocked from
// the very first run (starters: beholder, demon, gnoll).

import { PlayerProfile } from '../systems/PlayerProfile.js'

export const ALL_BOSS_IDS = [
  'beholder', 'demon', 'myconid', 'wraith', 'gnoll', 'golem',
  'lich', 'lizardman', 'orc', 'vampire', 'succubus', 'slime',
]

export const UNLOCK_GATES = {
  golem:     { requiredLevel: 2,  label: 'REACH BOSS LV 2 TO UNLOCK',  achId: 'rising_power' },
  lich:      { requiredLevel: 3,  label: 'REACH BOSS LV 3 TO UNLOCK',  achId: 'hardened_throne' },
  lizardman: { requiredLevel: 4,  label: 'REACH BOSS LV 4 TO UNLOCK',  achId: 'crown_of_iron' },
  myconid:   { requiredLevel: 5,  label: 'REACH BOSS LV 5 TO UNLOCK',  achId: 'echoing_roar' },
  orc:       { requiredLevel: 6,  label: 'REACH BOSS LV 6 TO UNLOCK',  achId: 'sixth_seal' },
  vampire:   { requiredLevel: 7,  label: 'REACH BOSS LV 7 TO UNLOCK',  achId: 'seventh_sigil' },
  wraith:    { requiredLevel: 8,  label: 'REACH BOSS LV 8 TO UNLOCK',  achId: 'spectral_reign' },
  succubus:  { requiredLevel: 9,  label: 'REACH BOSS LV 9 TO UNLOCK',  achId: 'witchbane' },
  slime:     { requiredLevel: 10, label: 'REACH BOSS LV 10 TO UNLOCK', achId: 'dread_sovereign' },
}

// Returns the array of boss-archetype ids that are currently unlocked
// for the active player. Starters (no gate) are always included; gated
// bosses are included iff their gating achievement is unlocked. Uses the
// same `PlayerProfile.isAchievementUnlocked` check ArchetypeSelect uses,
// so the answer is consistent across surfaces (cheat-name `mango`
// short-circuits to all-unlocked there, so it does here too).
export function getUnlockedBossIds() {
  return ALL_BOSS_IDS.filter(id => {
    const gate = UNLOCK_GATES[id]
    if (!gate) return true
    return PlayerProfile.isAchievementUnlocked(gate.achId)
  })
}

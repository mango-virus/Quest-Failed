// Orc Veteran — TROPHY HUNTER.
//
// The Veteran claims a "trophy" from every hero CLASS the dungeon kills. The
// first kill of a class CLAIMS its trophy type (arming that throne-fight
// attack); repeat kills of the same type EMPOWER it (stacks → more damage /
// range). Five trophy types, mapped from the killed class's tags.
//
// This module is the single source of truth for the classifier + per-type
// metadata, shared by BossArchetypeSystem (claim/empower + Mastery aura),
// BossSystem (the throne-fight attacks), and InspectPopup (the Trophy Wall).
//
// Trophy state lives on `gameState.boss.trophies` as a plain, JSON-serializable
// map:  { blade: { stacks }, arcane: { stacks }, ... }  — a key being present
// means that type is CLAIMED; `stacks` starts at 1 on claim and grows by 1 per
// repeat kill.

// ── Type metadata ──────────────────────────────────────────────────────────
// id      — stable key stored on boss.trophies
// label   — display name on the Trophy Wall
// icon    — glyph for the wall
// color   — the "stolen class" accent color used to tint that attack's VFX
// attack  — the throne-fight action id this trophy arms
// mastery — short label for the dungeon-wide aura it grants when it's the top type
export const TROPHY_TYPES = [
  { id: 'blade',  label: 'Blade',  icon: '⚔', color: 0xd0d4dc, attack: 'cleave',      mastery: 'Minions +ATK' },
  { id: 'heavy',  label: 'Heavy',  icon: '🛡', color: 0xc9a23f, attack: 'shieldbash',  mastery: 'Minions +DEF' },
  { id: 'arcane', label: 'Arcane', icon: '🔮', color: 0x9a6cff, attack: 'hexbolt',     mastery: 'Traps recharge faster' },
  { id: 'hunter', label: 'Hunter', icon: '🏹', color: 0x66cc66, attack: 'volley',      mastery: 'Minion attack range' },
  { id: 'faith',  label: 'Faith',  icon: '✚', color: 0xffe9a8, attack: 'reaversmite',  mastery: 'Boss regenerates' },
]

export const TROPHY_BY_ID = Object.fromEntries(TROPHY_TYPES.map(t => [t.id, t]))

// Classes that are NOT heroes you farm — event invaders, set-piece nemeses,
// the non-combatants, the cheater. They never grant a trophy.
const EXCLUDE_TAGS = new Set([
  'non_combatant', 'monster_invader', 'rival_boss', 'nemesis', 'hero',
  'shadow_monarch', 'exploit', 'chaos',
])

// Map a killed adventurer's class definition → trophy type id (or null if the
// class is excluded). Tag-driven, with Blade as the default for any plain
// melee/combat class. Order matters: tanks beat their holy tag (paladin/templar
// are Heavy, not Faith), healers/holy-support are Faith, casters Arcane, ranged
// & pet classes Hunter, everything else Blade.
export function classifyTrophy(classDef) {
  if (!classDef) return null
  const tags = Array.isArray(classDef.tags) ? classDef.tags : []
  const has  = (t) => tags.includes(t)

  for (const t of tags) if (EXCLUDE_TAGS.has(t)) return null

  if (has('tank') || has('bruiser')) return 'heavy'
  if (has('healer') || (has('holy') && has('support'))) return 'faith'
  if (has('spellcaster')) return 'arcane'
  if (has('ranged') || has('ranged_low') || has('scout') ||
      has('pet_class') || has('beast_tamer')) return 'hunter'
  return 'blade'   // default: any melee / untagged combat class
}

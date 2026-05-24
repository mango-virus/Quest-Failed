// Flee-reason flavor strings — translates internal AI reason codes
// ("goal_unreachable", "coward_panic", etc.) into player-facing log
// lines. Used by both the new HUD's right panels and the legacy
// DungeonLog so the wording stays consistent.
//
// Each entry is a function of `(name, context)` so callers can pass
// situational detail and the flavor adapts. `context` is always
// optional — entries fall back to a generic line when context is
// missing, so passing nothing still works.

const FLEE_REASON_FLAVOR = {
  // ── Path / goal failures ────────────────────────────────────────
  goal_unreachable:    (n, c) => c?.goalLabel
    ? `${n} can't find a way through to the ${c.goalLabel} and flees the dungeon!`
    : `${n} can't find a way through and flees the dungeon!`,
  blocked_by_lock:     (n, c) => c?.goalLabel
    ? `${n} is locked out of the ${c.goalLabel} and flees the dungeon!`
    : `${n} is sealed off by a locked door and flees the dungeon!`,
  no_route:            (n, c) => c?.goalLabel
    ? `${n} can't find a path to the ${c.goalLabel} and flees the dungeon!`
    : `${n} is boxed in with no way through and flees the dungeon!`,
  goal_lost:           (n, c) => c?.goalLabel
    ? `${n} finds the ${c.goalLabel} gone and flees the dungeon!`
    : `${n} finds their target gone and flees the dungeon!`,
  oscillation:         n => `${n} can't see a way forward and bolts for the exit!`,
  tour_complete:       n => `${n} has mapped enough — they head for home.`,
  saboteur_done:       n => `${n} has wrecked every trap they can — they slip out.`,

  // ── HP / morale ─────────────────────────────────────────────────
  low_hp_retreat:      (n, c) => c?.hpPct != null
    ? `${n} is bleeding badly (${c.hpPct}% HP) and retreats!`
    : `${n} is gravely wounded and retreats!`,
  coward_panic:        (n, c) => c?.minionName
    ? `${n} catches sight of the ${c.minionName} and panics!`
    : `${n} panics at the sight of a hostile and runs!`,
  out_of_arrows:       n => `${n}'s quiver is empty — they fall back!`,
  whisperer_panic:     (n, c) => c?.minionName
    ? `${n} spots the ${c.minionName} as the whispers overwhelm them — they flee in terror!`
    : `${n} hears the whispers and flees in terror!`,
  traumatized_panic:   n => `${n} is the last one standing and breaks — they flee in horror!`,
  raid_leader_dead:    (n, c) => c?.leaderName
    ? `${n} sees ${c.leaderName} fall — morale shatters and they run!`
    : `${n}'s raid leader fell — they scatter!`,
  panic_witnessed_death: (n, c) => c?.allyName
    ? `${n} watches ${c.allyName} die at the boss's hand and breaks ranks!`
    : `${n} watches an ally die and breaks ranks!`,

  // ── Boss-room consequences ──────────────────────────────────────
  boss_defeated:       n => `${n} flees from the boss chamber in awe of their slain foe!`,
  boss_stalemate:      n => `${n} withdraws from the boss chamber — bruised but not beaten.`,
  fled_from_boss:      n => `${n} loses their nerve before the boss and flees!`,
  rival_boss_defeated: n => `${n} sees their rival boss fall — they retreat!`,
  rival_squad_scatter: n => `${n}'s squad shatters and scatters into the dungeon!`,

  // ── Archetype-driven ────────────────────────────────────────────
  phylactery_gone:           n => `${n} senses your phylactery is unguarded and flees to report.`,
  phylactery_destroyed:      n => `${n} sees the phylactery destroyed and breaks for the exit!`,
  wraith_fear_window_ended:  n => `${n} comes to their senses and flees the dread!`,

  // ── Loot escape ─────────────────────────────────────────────────
  treasure_escape:     (n, c) => c?.goalLabel
    ? `${n} clutches the ${c.goalLabel} and bolts for the exit!`
    : `${n} grabs the loot and bolts for the exit!`,

  // ── Despawn / forced exits ──────────────────────────────────────
  oscillation_at_exit: n => `${n} gives up wandering the entry and slips out.`,

  // ── Cheater class ──────────────────────────────────────────────
  cheater_banned:      n => `${n} got reported one too many times — anti-cheat boots them from the dungeon!`,
}

export function fleeReasonFlavor(reason, name, context = null) {
  const fn = reason && FLEE_REASON_FLAVOR[reason]
  if (fn) return fn(name, context)
  // Unknown reason — fall back to a generic flavor line that still
  // reads as story, not as a dev code dump.
  return `${name} loses their nerve and flees!`
}

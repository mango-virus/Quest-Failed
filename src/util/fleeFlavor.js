// Flee-reason flavor strings — translates internal AI reason codes
// ("goal_unreachable", "coward_panic", etc.) into player-facing log
// lines. Used by the HUD right-panel dungeon log so the wording stays
// thematic and consistent.
//
// Each reason maps to an ARRAY of variant builders `(name, context)`,
// and fleeReasonFlavor() picks one at random — so the same flee cause
// reads differently across a run instead of the same canned line every
// time. `context` is always optional; entries fall back to a generic
// phrasing when situational detail (goalLabel / hpPct / minionName /
// leaderName / allyName) is missing, so passing nothing still works.

const FLEE_REASON_FLAVOR = {
  // ── Path / goal failures ────────────────────────────────────────
  goal_unreachable: [
    (n, c) => c?.goalLabel
      ? `${n} can't find a way through to the ${c.goalLabel} and flees the dungeon!`
      : `${n} can't find a way through and flees the dungeon!`,
    (n, c) => c?.goalLabel
      ? `${n} paces the halls, finds no route to the ${c.goalLabel}, and storms out!`
      : `${n} paces the halls, finds no route onward, and storms out!`,
    n => `${n} curses the maze that has no end and turns for the gate!`,
    n => `${n} gives up untangling your labyrinth and retreats.`,
  ],
  blocked_by_lock: [
    (n, c) => c?.goalLabel
      ? `${n} is locked out of the ${c.goalLabel} and flees the dungeon!`
      : `${n} is sealed off by a locked door and flees the dungeon!`,
    n => `${n} rattles the locked door in vain, then abandons the raid.`,
    n => `${n} has no key for the sealed way and gives up the hunt.`,
  ],
  no_route: [
    (n, c) => c?.goalLabel
      ? `${n} can't find a path to the ${c.goalLabel} and flees the dungeon!`
      : `${n} is boxed in with no way through and flees the dungeon!`,
    n => `${n} hits dead end after dead end and bolts for the exit!`,
    n => `${n} finds every passage walled off and abandons the dungeon.`,
  ],
  goal_lost: [
    (n, c) => c?.goalLabel
      ? `${n} finds the ${c.goalLabel} gone and flees the dungeon!`
      : `${n} finds their target gone and flees the dungeon!`,
    n => `${n} arrives to find their prize already vanished — and leaves empty-handed.`,
    n => `${n}'s quarry is nowhere to be found; they give up and go.`,
  ],
  oscillation: [
    n => `${n} can't see a way forward and bolts for the exit!`,
    n => `${n} wanders the same halls twice over, loses heart, and leaves.`,
    n => `${n} goes in circles until frustration wins — they head out.`,
  ],
  tour_complete: [
    n => `${n} has mapped enough — they head for home.`,
    n => `${n} commits the dungeon's layout to memory and slips away to report it.`,
    n => `${n} has seen all they came to chart and withdraws.`,
  ],
  saboteur_done: [
    n => `${n} has wrecked every trap they can — they slip out.`,
    n => `${n} leaves your traps in ruins and melts back into the dark.`,
    n => `${n}'s sabotage is finished; they vanish the way they came.`,
  ],

  // ── HP / morale ─────────────────────────────────────────────────
  low_hp_retreat: [
    (n, c) => c?.hpPct != null
      ? `${n} is bleeding badly (${c.hpPct}% HP) and retreats!`
      : `${n} is gravely wounded and retreats!`,
    (n, c) => c?.hpPct != null
      ? `${n} can barely stand (${c.hpPct}% HP) and limps for the exit!`
      : `${n} can barely stand and limps for the exit!`,
    n => `${n} clamps a hand over a wound and pulls back before it's too late.`,
    n => `${n} decides the loot isn't worth dying for and retreats.`,
  ],
  coward_panic: [
    (n, c) => c?.minionName
      ? `${n} catches sight of the ${c.minionName} and panics!`
      : `${n} panics at the sight of a hostile and runs!`,
    (n, c) => c?.minionName
      ? `${n} takes one look at the ${c.minionName} and loses all nerve!`
      : `${n} takes one look at what waits ahead and loses all nerve!`,
    (n, c) => c?.minionName
      ? `${n}'s courage shatters before the ${c.minionName} — they flee!`
      : `${n}'s courage shatters and they flee!`,
    n => `${n} wants no part of this and scrambles for the way out!`,
  ],
  out_of_arrows: [
    n => `${n}'s quiver is empty — they fall back!`,
    n => `${n} reaches for an arrow, finds none, and retreats!`,
    n => `${n} is out of ammunition and won't fight bare-handed — they withdraw.`,
  ],
  whisperer_panic: [
    (n, c) => c?.minionName
      ? `${n} spots the ${c.minionName} as the whispers overwhelm them — they flee in terror!`
      : `${n} hears the whispers and flees in terror!`,
    n => `${n} claws at their ears against the whispering and breaks for the light!`,
    n => `${n} can't silence the voices in the dark — they run screaming for the exit!`,
  ],
  traumatized_panic: [
    n => `${n} is the last one standing and breaks — they flee in horror!`,
    n => `${n}, alone with the dead, finally cracks and bolts!`,
    n => `${n} can't face the dungeon without their party — they flee in horror!`,
  ],
  morale_break: [
    n => `${n}'s nerve finally cracks — they break and bolt for the exit!`,
    n => `${n} has seen too much; their will gives out and they run!`,
    n => `${n} throws down their weapon and flees in despair!`,
    n => `${n}'s resolve crumbles — they turn tail and run!`,
  ],
  nemesis_withdraw: [
    n => `${n} judges the dungeon too strong for now — he withdraws to the surface.`,
    n => `${n} marks your defenses, nods grimly, and retreats to plan his return.`,
    n => `${n} will not throw his life away today — he withdraws.`,
  ],
  last_survivor_break: [
    n => `${n} is the last one left and their nerve gives out — they run!`,
    n => `${n} looks around at the fallen, alone, and flees!`,
    n => `${n}, the sole survivor, abandons the doomed raid!`,
  ],
  collective_break: [
    n => `${n} breaks with what's left of the party — they scatter for the exit!`,
    n => `${n} joins the rout as the party's courage collapses!`,
    n => `${n} runs with the others as the raid falls apart!`,
  ],
  raid_leader_dead: [
    (n, c) => c?.leaderName
      ? `${n} sees ${c.leaderName} fall — morale shatters and they run!`
      : `${n}'s raid leader fell — they scatter!`,
    (n, c) => c?.leaderName
      ? `${n} watches ${c.leaderName} cut down and loses all heart for the fight!`
      : `${n} watches their captain cut down and loses all heart for the fight!`,
    n => `${n}, leaderless and afraid, bolts for the exit!`,
  ],
  panic_witnessed_death: [
    (n, c) => c?.allyName
      ? `${n} watches ${c.allyName} die at the boss's hand and breaks ranks!`
      : `${n} watches an ally die and breaks ranks!`,
    (n, c) => c?.allyName
      ? `${n} sees ${c.allyName} torn apart and flees in horror!`
      : `${n} sees a comrade torn apart and flees in horror!`,
    n => `${n} can't unsee what the boss just did — they break and run!`,
  ],

  // ── Boss-room consequences ──────────────────────────────────────
  boss_defeated: [
    n => `${n} flees from the boss chamber in awe of their slain foe!`,
    n => `${n} stares at the fallen boss, then turns and runs — this is no place for them.`,
    n => `${n} flees the throne room, shaken by the monster they witnessed.`,
  ],
  boss_stalemate: [
    n => `${n} withdraws from the boss chamber — bruised but not beaten.`,
    n => `${n} backs out of the throne room to lick their wounds.`,
    n => `${n} breaks off the boss fight, vowing to return better armed.`,
  ],
  fled_from_boss: [
    n => `${n} loses their nerve before the boss and flees!`,
    n => `${n} meets the boss's gaze, thinks better of it, and runs!`,
    n => `${n} won't face the throne's horror — they flee!`,
  ],
  rival_boss_defeated: [
    n => `${n} sees their rival boss fall — they retreat!`,
    n => `${n}'s champion has fallen; the survivors scatter and flee!`,
    n => `${n} flees as the rival boss is cut down before them!`,
  ],
  rival_squad_scatter: [
    n => `${n}'s squad shatters and scatters into the dungeon!`,
    n => `${n} is swept up in the rout as the squad breaks apart!`,
    n => `${n} flees with the scattering remnants of their squad!`,
  ],

  // ── Archetype-driven ────────────────────────────────────────────
  phylactery_gone: [
    n => `${n} senses your phylactery is unguarded and flees to report.`,
    n => `${n} feels the phylactery's pull and races out to warn the others.`,
    n => `${n} marks where the soul-vessel lies hidden and slips away to tell.`,
  ],
  phylactery_destroyed: [
    n => `${n} sees the phylactery destroyed and breaks for the exit!`,
    n => `${n} watches the soul-vessel shatter and flees the backlash!`,
    n => `${n} recoils from the phylactery's death-scream and runs!`,
  ],
  wraith_fear_window_ended: [
    n => `${n} comes to their senses and flees the dread!`,
    n => `${n} shakes off the wraith's terror and runs while they still can!`,
    n => `${n}, freed from the dread's grip, bolts for the light!`,
  ],

  // ── Loot escape ─────────────────────────────────────────────────
  treasure_escape: [
    (n, c) => c?.goalLabel
      ? `${n} clutches the ${c.goalLabel} and bolts for the exit!`
      : `${n} grabs the loot and bolts for the exit!`,
    (n, c) => c?.goalLabel
      ? `${n} pockets the ${c.goalLabel} and sprints for daylight!`
      : `${n} pockets their plunder and sprints for daylight!`,
    n => `${n} has what they came for — they run for the exit, grinning!`,
    n => `${n} decides greed beats glory and flees with the spoils!`,
  ],

  // ── Despawn / forced exits ──────────────────────────────────────
  oscillation_at_exit: [
    n => `${n} gives up wandering the entry and slips out.`,
    n => `${n} loiters at the threshold, loses interest, and leaves.`,
    n => `${n} thinks better of the whole venture and steps back outside.`,
  ],

  // ── Cheater class ──────────────────────────────────────────────
  cheater_banned: [
    n => `${n} got reported one too many times — anti-cheat boots them from the dungeon!`,
    n => `${n} is flagged for cheating and yanked out of the dungeon!`,
    n => `${n}'s exploits catch up with them — banned and ejected!`,
  ],
}

// Pure-random pick — this is HUD flavor (not sim state), so variety across a
// run is the whole point; a fixed seed would defeat it.
function _pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function fleeReasonFlavor(reason, name, context = null) {
  const variants = reason && FLEE_REASON_FLAVOR[reason]
  if (variants) {
    const fn = Array.isArray(variants) ? _pick(variants) : variants
    return fn(name, context)
  }
  // Unknown reason — fall back to a varied generic line that still reads as
  // story, not a dev code dump.
  return _pick([
    n => `${n} loses their nerve and flees!`,
    n => `${n} thinks better of this raid and runs!`,
    n => `${n} turns tail and flees the dungeon!`,
  ])(name)
}

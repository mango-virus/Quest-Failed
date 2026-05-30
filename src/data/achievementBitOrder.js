// Canonical, APPEND-ONLY bit order for the leaderboard achievement bitmask.
//
// Each id's INDEX in this array is its PERMANENT bit position in the
// `meta.achievement_bits` string submitted to / read from the leaderboard.
// The whole point of this file is to keep those bit positions STABLE so a
// row submitted months ago still decodes correctly today, no matter how
// `achievements.json` is reordered or how many new achievements are added.
//
// ── RULES (read before editing) ───────────────────────────────────────────
//   • NEVER reorder, insert into the middle of, or delete an entry. Doing so
//     retroactively corrupts every leaderboard row ever submitted — that's
//     exactly the bug this list was created to prevent (a level-19 player
//     showing the level-25 achievement because a mid-file insertion shifted
//     everyone's bits).
//   • To ADD an achievement: append its id to the END of this array. Its
//     position in `achievements.json` (the DISPLAY/grid order) is completely
//     independent and may be anything.
//   • To DEPRECATE an achievement: leave its id here as a permanent slot
//     (removing it would shift everything after). It simply won't resolve to
//     a card if it's gone from achievements.json — harmless.
//   • AchievementSystem.getOrderedIds() reconciles this list with the live
//     definitions: it returns this array verbatim, then appends any def id
//     NOT yet listed here (a freshly-added achievement) and console.warns so
//     you remember to lock it in. New ids therefore always land at the end —
//     beyond every older row's mask length — so they can never misalign an
//     existing row even before you add them here.
//
// Baseline snapshot taken 2026-05-28 (91 achievements), matching the order
// existing leaderboard masks were generated against — DO NOT re-sort.
export const ACHIEVEMENT_BIT_ORDER = [
  // Progression — boss levels 1-20
  'first_spark', 'rising_power', 'hardened_throne', 'crown_of_iron',
  'echoing_roar', 'sixth_seal', 'seventh_sigil', 'spectral_reign',
  'witchbane', 'dread_sovereign', 'tyrant', 'despot', 'worldbreaker',
  'architect_of_ruin', 'endless_crown', 'eldritch_throne', 'forgotten_god',
  'demilich_eternal', 'avatar_of_dread', 'throne_eternal',
  // Original combat / build / economy / variety / mastery set
  'first_blood', 'first_hire', 'first_trap', 'first_build', 'survivor',
  'skirmisher', 'reaper', 'soul_collector', 'master_architect', 'trapsmith',
  'architect', 'swarm_lord', 'diverse_roster', 'long_watch', 'daily_reaper',
  'untouchable', 'total_annihilation', 'trap_master', 'class_hunter',
  'boss_slayer', 'endless_reign', 'hoard_lord', 'curtain_call',
  'flawless_reign', 'veteran_exterminator', 'keeper_of_keepers',
  'personality_profiler', 'the_deathless', 'the_untouchable',
  'bringer_of_the_end', 'eternal_reaper', 'hand_of_midas', 'whole_coven',
  'the_soulkeeper', 'veterans_bane', 'avatar_of_slaughter',
  'warden_of_the_legion', 'death_by_design', 'the_warmonger',
  'master_builder', 'the_engineer', 'menagerie_lord',
  // Leaderboard placement legendaries
  'leaderboard_top3', 'leaderboard_top2', 'leaderboard_top1',
  // Event + activity achievements (added 2026-05-28)
  'first_event', 'event_regular', 'open_house', 'landlord', 'petty_cash',
  'boss_brawler', 'acceptable_losses', 'persistent', 'trap_tinkerer',
  'punching_bag', 'event_veteran', 'event_connoisseur', 'innkeeper',
  'eternal_host', 'magnate', 'headsman', 'martyrmaker', 'campaigner',
  'munitions_expert', 'the_unbreaking',
  // Solo Leveling event boss
  'monarch_slayer',
  // Light Party event boss
  'warrior_of_light',
  // Progression — boss levels 21-25 (moved to the end so old masks never
  // reach them; see the achievements.json reorder + this list's rules).
  'umbral_ascendant', 'devourer_of_stars', 'herald_of_oblivion',
  'empyrean_dread', 'the_last_god',
]

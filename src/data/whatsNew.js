// Player-facing "What's New" changelog — drives the WHAT'S NEW panel on
// the main menu (src/hud/WhatsNewOverlay.js).
//
// Each entry is one game update. `id` is a monotonic integer: the panel
// remembers the highest id the player has seen (localStorage key
// qf.whatsNew.lastSeenId) and shows everything newer, so a returning
// player sees exactly what they missed.
//
// ── AUTHORING RULES ───────────────────────────────────────────────────────
//   • NEWEST ENTRY GOES AT THE TOP, with the next id up.
//   • Write for PLAYERS, not developers: describe the feature / addition in
//     plain in-game terms. No commit messages, file names, or internals.
//   • Keep each item SHORT — one brief clause (aim for ≤ ~10 words),
//     lead with an emoji icon. Brevity over detail; players skim this.
//   • `version` / `date` are display-only labels; `id` is what tracking uses.
export const WHATS_NEW = [
  {
    id: 16,
    version: '0.1.17',
    date: 'June 2026',
    title: 'A Darker Throne',
    items: [
      { icon: '👁️', text: 'Every boss reworked with a signature power.' },
      { icon: '⚡', text: 'Fire a boss day-power: gaze a room, hurl trophies, flood gooplings…' },
      { icon: '🩸', text: 'Bosses bank a resource — Blood, Dread, Ferocity — and spend it.' },
      { icon: '🐲', text: 'Each boss now has a unique throne-room finale.' },
      { icon: '✨', text: 'All-new bespoke effects for every boss ability.' },
    ],
  },
  {
    id: 15,
    version: '0.1.16',
    date: 'June 2026',
    title: 'Minions Reborn',
    items: [
      { icon: '💰', text: 'Goblins plunder your gold from fallen heroes.' },
      { icon: '💀', text: 'Skeletons refuse to stay dead.' },
      { icon: '🟢', text: 'Slimes split, infect, or melt — three breeds.' },
      { icon: '👁️', text: 'Beholders dominate minds; Orcs build a killing frenzy.' },
      { icon: '⬆️', text: 'Every family deepens its one trick as it upgrades.' },
    ],
  },
  {
    id: 14,
    version: '0.1.15',
    date: 'June 2026',
    title: 'The Heroes Wise Up',
    items: [
      { icon: '🧠', text: 'Adventurers use their class abilities tactically now.' },
      { icon: '📖', text: 'Survivors teach the kingdom your defenses — keep them guessing.' },
      { icon: '😱', text: 'Morale & nerve: heroes panic, overextend, or flee with your gold.' },
      { icon: '🎭', text: 'Distinct personalities change how each hero behaves.' },
    ],
  },
  {
    id: 13,
    version: '0.1.14',
    date: 'June 2026',
    title: 'The Kingdom Answers',
    items: [
      { icon: '🏴‍☠️', text: 'The Plunderers raid your vault for gold.' },
      { icon: '✝️', text: 'The Inquisition marches in to purge your dark pacts.' },
      { icon: '🔮', text: 'The Mage Tower transmutes your rooms and polymorphs minions.' },
      { icon: '⚔️', text: 'The Forlorn Hope fights on past death with a final vow.' },
      { icon: '😇', text: 'The Pantheon resurrects its fallen in pillars of light.' },
      { icon: '🌟', text: 'The All-Stars send four legends to fight to the death.' },
      { icon: '🗡️', text: 'The Turncoat flips your own traps onto your minions.' },
      { icon: '💀', text: 'Necrarch raises the dead as an endless tide.' },
    ],
  },
  {
    id: 12,
    version: '0.1.13',
    date: 'June 2026',
    title: 'Seven New Adventurers',
    items: [
      { icon: '🏴‍☠️', text: 'Pirate — beelines your gold and flees with extra plunder.' },
      { icon: '✝️', text: 'Templar — soaks punishment that would fell a knight.' },
      { icon: '⛏️', text: 'Miner — tunnels underground and resurfaces anywhere.' },
      { icon: '🪽', text: 'Valkyrie — flies over your traps and rallies her allies.' },
      { icon: '🔱', text: 'Peasant — harmless alone, deadly in a mob.' },
      { icon: '🛡️', text: 'Gladiator — every kill stokes a louder Crowd Roar.' },
      { icon: '🎲', text: 'Gambler — each strike rolls the dice: crit, double-hit, payout.' },
    ],
  },
  {
    id: 11,
    version: '0.1.12',
    date: 'June 2026',
    title: 'The Kingdom’s Reckoning',
    items: [
      { icon: '🏰', text: 'A new campaign: clear four acts to WIN the run.' },
      { icon: '🎯', text: 'A Nemesis hero stalks you across every act.' },
      { icon: '⚔️', text: 'The kingdom escalates — rivals, crusades, traitors, and more.' },
      { icon: '💀', text: 'Your boss ascends into a darker form each act.' },
      { icon: '👑', text: 'Duel the Hero King in the finale to claim victory.' },
      { icon: '🏆', text: 'Win to unlock a tougher Reckoning New Game+.' },
    ],
  },
  {
    id: 10,
    version: '0.1.11',
    date: 'June 2026',
    title: 'The Light Party',
    items: [
      { icon: '⚔️', text: 'New event: a four-hero Light Party storms your throne.' },
      { icon: '✨', text: 'Their healer keeps reviving — cut the party down fast.' },
      { icon: '💥', text: 'A cinematic raid duel: telegraphs, mechanics, Limit Breaks.' },
      { icon: '🏆', text: 'Defeat the Light Party to free a new ally.' },
    ],
  },
  {
    id: 9,
    version: '0.1.10',
    date: 'May 2026',
    title: 'Trap Upkeep & Treasure Raids',
    items: [
      { icon: '🪤', text: 'Traps can now break after firing on an adventurer.' },
      { icon: '🔧', text: 'New REBUILD button restores broken traps for gold at night.' },
      { icon: '🗝️', text: 'Treasure Hunters can raid your gold — let the wave escape and lose up to 80%.' },
    ],
  },
  {
    id: 8,
    version: '0.1.9',
    date: 'May 2026',
    title: 'Minion Upgrades',
    items: [
      { icon: '⬆️', text: 'New UPGRADE tool — pay gold to advance a minion a tier.' },
      { icon: '✨', text: 'Upgrades stick — a revived minion keeps its tier.' },
      { icon: '📈', text: 'Minions now scale to your boss level, not the calendar.' },
      { icon: '🔁', text: 'No more auto-evolving on kills — you pick who powers up.' },
    ],
  },
  {
    id: 7,
    version: '0.1.8',
    date: 'May 2026',
    title: 'Wave Tracker & Treasury',
    items: [
      { icon: '📊', text: 'A bar under the day counter tracks your kills vs escapes each wave.' },
      { icon: '💎', text: 'Treasure chests and the treasury now pay more as your dungeon grows.' },
    ],
  },
  {
    id: 6,
    version: '0.1.7',
    date: 'May 2026',
    title: 'Economy & Revival',
    items: [
      { icon: '💰', text: 'Build prices now climb over a long run — gold stays valuable late game.' },
      { icon: '⚰', text: 'Fallen minions no longer return free — revive them at night for gold.' },
      { icon: '⏳', text: 'Don’t pay by dawn and your fallen minions are lost for good.' },
    ],
  },
  {
    id: 5,
    version: '0.1.6',
    date: 'May 2026',
    title: 'Eight New Dungeon Events',
    items: [
      { icon: '👑', text: 'Boss Royale: 11 rival overlords storm your throne.' },
      { icon: '🗡️', text: 'Solo Leveling: duel the Shadow Monarch.' },
      { icon: '🗝️', text: 'Treasure Hunters: a wave raids your chests.' },
      { icon: '🪙', text: 'Goblin Market: build prices scrambled for one night.' },
      { icon: '🩸', text: 'Sacrificial Altar: a hidden price for a minion buff.' },
      { icon: '👹', text: 'Demon’s Wager: coin-flip your boss level.' },
      { icon: '🛠️', text: 'Tinkerer’s Workshop: pick a room upgrade for the run.' },
      { icon: '📺', text: 'Speedrun Channel: the whole wave is one class.' },
    ],
  },
  {
    id: 4,
    version: '0.1.5',
    date: 'May 2026',
    title: 'The Damned Grimoire',
    items: [
      { icon: '☠', text: 'New Damned pacts: a small bribe, a steeper curse.' },
      { icon: '📕', text: 'The grimoire can open black — an all-Damned hand.' },
      { icon: '😈', text: 'The Dark Deal demon always deals the black grimoire.' },
    ],
  },
  {
    id: 3,
    version: '0.1.4',
    date: 'May 2026',
    title: 'Leaderboard & Trophies',
    items: [
      { icon: '🏆', text: 'Finish top 3 for a trophy card at the main menu.' },
      { icon: '📊', text: 'See rivals’ achievement progress, not just earned ones.' },
      { icon: '✖',  text: 'A “Dethroned” notice warns when a rival bumps your rank.' },
    ],
  },
  {
    id: 2,
    version: '0.1.3',
    date: 'May 2026',
    title: 'New Challenges & a New Ally',
    items: [
      { icon: '👑', text: 'Push past boss level 20 for new titles.' },
      { icon: '⚔️', text: 'Beat the Shadow Monarch to recruit the Necroknight.' },
      { icon: '🎖️', text: 'Dozens of new achievements, some with animated titles.' },
    ],
  },
  {
    id: 1,
    version: '0.1.2',
    date: 'May 2026',
    title: 'Dungeon Tuning',
    items: [
      { icon: '🎲', text: 'Events now cycle fully before repeating.' },
      { icon: '🗡️', text: 'Spike Pit instant-kill chance cut to 1%.' },
      { icon: '🏃', text: 'The Legendary Speed Runner now beelines your throne.' },
    ],
  },
]

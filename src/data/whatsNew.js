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
//   • Keep each item to one punchy sentence; lead with an emoji icon.
//   • `version` / `date` are display-only labels; `id` is what tracking uses.
export const WHATS_NEW = [
  {
    id: 5,
    version: '0.1.6',
    date: 'May 2026',
    title: 'Eight New Dungeon Events',
    items: [
      { icon: '👑', text: 'Boss Royale: no adventurers tonight — 11 rival overlords storm in at once, all gunning for your throne. Survive the gauntlet.' },
      { icon: '🗡️', text: 'Solo Leveling: the Shadow Monarch marches in alone, raising your fallen minions as his shadow army to duel you.' },
      { icon: '🗝️', text: 'Treasure Hunters: the whole wave ignores your throne to raid your chests and flee with the loot — guard your gold.' },
      { icon: '🪙', text: 'Goblin Market: a peddler scrambles every build-menu price for one night — snap up the bargains, dodge the ripoffs.' },
      { icon: '🩸', text: 'The Sacrificial Altar: pay an unknown price at a blood altar for a mystery permanent buff to all your minions.' },
      { icon: '👹', text: 'The Demon’s Wager: gamble your boss level on a coin flip — win a free level-up, or lose one and everything it gave you.' },
      { icon: '🛠️', text: 'The Tinkerer’s Workshop: pick a room upgrade that boosts every current and future room of that type for the rest of the run.' },
      { icon: '📺', text: 'The Speedrun Channel: a streamed raid where the entire wave is the same random class. Run start!' },
    ],
  },
  {
    id: 4,
    version: '0.1.5',
    date: 'May 2026',
    title: 'The Damned Grimoire',
    items: [
      { icon: '☠', text: 'A new Damned tier of dark pacts joins the Grimoire — true devil’s bargains that pair a small bribe with a far steeper curse.' },
      { icon: '📕', text: 'Sometimes the Grimoire opens jet black: a hand of nothing but Damned pacts, where every choice costs you.' },
      { icon: '😈', text: 'Strike the Dark Deal demon’s bargain and the black grimoire is always what you’re dealt.' },
    ],
  },
  {
    id: 3,
    version: '0.1.4',
    date: 'May 2026',
    title: 'Leaderboard & Trophies',
    items: [
      { icon: '🏆', text: 'Finish top 3 on the global leaderboard and a champion / runner-up / podium-finish card celebrates you the next time you reach the main menu.' },
      { icon: '📊', text: 'The achievement leaderboard now shows how close other keepers are to each achievement — not just which ones they’ve earned.' },
      { icon: '✖',  text: 'Knocked off the podium? A “Dethroned” notice tells you when a rival bumps you down a rank.' },
    ],
  },
  {
    id: 2,
    version: '0.1.3',
    date: 'May 2026',
    title: 'New Challenges & a New Ally',
    items: [
      { icon: '👑', text: 'Push your boss past level 20 to claim legendary new titles, all the way up to “The Last God.”' },
      { icon: '⚔️', text: 'Solo Leveling event: face Sung Jinwoo, the Shadow Monarch — defeat him to recruit the Necroknight companion.' },
      { icon: '🎖️', text: 'Dozens of new achievements across events, economy and survival, several with animated title rewards.' },
    ],
  },
  {
    id: 1,
    version: '0.1.2',
    date: 'May 2026',
    title: 'Dungeon Tuning',
    items: [
      { icon: '🎲', text: 'Dungeon events now cycle through the whole roster before any repeat — more variety every run.' },
      { icon: '🗡️', text: 'Spike Pit traps are far less swingy: their instant-kill chance is now a rare 1%.' },
      { icon: '🏃', text: 'The Legendary Speed Runner now beelines straight for your throne — stop them fast.' },
    ],
  },
]

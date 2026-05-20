// TutorialSystem — fires one-shot how-to-play hint popups at gate events.
//
// Each tutorial has:
//   - id        unique key tracked in gameState.meta.seenTutorials
//   - title     popup title
//   - body      popup copy
//   - subscribe (bus) => () to unsubscribe — wires the gate event
//
// On gate fire, if tutorialEnabled and not yet seen, the tutorial is
// enqueued. The system pops one at a time, opening the next only after
// the previous closes — so two gate events on the same frame don't stack
// popups on top of each other.

import { EventBus } from './EventBus.js'

// Phase 1 tutorial set (A + B from the design discussion). Boss-archetype
// hooks (C) and resource-warning hints (D) layer on later — this keeps
// the v1 surface focused on what every player needs.
//
// Add new tutorials here; no code changes needed elsewhere. Keep the
// list ordered roughly by when each typically fires so debugging the
// queue order is intuitive.
const TUTORIALS = [
  // ── A. Phase intros ───────────────────────────────────────────────────
  {
    id: 'firstNight', title: 'Build Phase',
    lead: 'NIGHT FALLS — THE DUNGEON IS YOURS',
    body: 'Each night you reshape the bone-halls. Open the CONSTRUCTION panel on the left to spend gold on rooms, minions, traps, and items. When the dungeon is ready, click BEGIN DAY in the top-right to summon the next wave of adventurers.',
    tips: [
      'Click a card once to select it, again to deselect.',
      'Hover the dungeon to preview placement; click to commit.',
      'Sell a placed room for partial gold from its right-click menu.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('NIGHT_PHASE_STARTED', fn)
      return () => EventBus.off('NIGHT_PHASE_STARTED', fn)
    },
  },
  {
    id: 'firstDay', title: 'Defend Phase',
    lead: 'DAWN BREAKS — THE INVASION BEGINS',
    body: 'Adventurers spill in through the entry hall and march toward your boss chamber. Your minions defend their assigned rooms, your traps spring on intruders, and your boss is the last line of defense. The day ends when every adventurer is dead or fled.',
    tips: [
      'Watch the INCOMING WAVE panel to see who is coming.',
      'Click the ADV INTEL panel to inspect each adventurer.',
      'A killed adventurer drops gold; a fled one steals it.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('DAY_PHASE_BEGAN', fn)
      return () => EventBus.off('DAY_PHASE_BEGAN', fn)
    },
  },
  {
    id: 'firstEndOfDay', title: 'End of Day',
    lead: 'THE DUST SETTLES — TALLY THE SPOILS',
    body: 'Each survived day pays gold from every kill plus XP toward your next boss level. Review who fell, who escaped with intel, and how much you earned. Levelling unlocks new rooms, minions, traps, and items in the Construction panel.',
    tips: [
      'Gold buys more dungeon; XP buys boss power.',
      'Escaped adventurers carry intel — expect them to return.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('SHOW_POST_WAVE_SUMMARY', fn)
      return () => EventBus.off('SHOW_POST_WAVE_SUMMARY', fn)
    },
  },
  {
    id: 'firstBossLevelUp', title: 'Boss Leveled',
    lead: 'POWER GROWS — NEW BUILDS UNLOCKED',
    body: 'Hitting a new boss level unlocks more rooms, minion types, traps, and items in the Construction panel. Some unlocks gate on level; some on specific archetype hooks. Check the panel between days to see what is newly available.',
    tips: [
      'Locked cards show a "LV X" badge — they will unlock at that boss level.',
      'Higher tiers cost more gold — plan upgrades around your treasury.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('BOSS_LEVEL_UP_DISMISSED', fn)
      return () => EventBus.off('BOSS_LEVEL_UP_DISMISSED', fn)
    },
  },
  {
    id: 'firstDarkPact', title: 'Dark Pact',
    lead: 'THE DUNGEON HUNGERS — STRIKE A BARGAIN',
    body: 'Dark Pacts grant a permanent buff in exchange for a permanent drawback. Pacts cannot be undone, refunded, or rerolled once sealed. Common pacts are mild, rare pacts are powerful, and legendary pacts rewrite a whole system — choose with care.',
    tips: [
      'Read both halves of a pact before sealing.',
      'Sealed pacts show in the top-right buff row.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('SHOW_DARK_PACT', fn)
      return () => EventBus.off('SHOW_DARK_PACT', fn)
    },
  },

  // ── B. Core-mechanic intros ───────────────────────────────────────────
  {
    id: 'firstMinionPlaced', title: 'Minions',
    lead: 'YOUR PACK — THE BONES OF THE DUNGEON',
    body: 'Minions defend the room they were placed in. Defender behaviours hold ground in their assigned room; patrol behaviours roam through connected rooms hunting intruders. Different species have different stats, attack ranges, and unique abilities — match the minion to the room.',
    tips: [
      'Open ROSTER (top button) to rename, reassign, or sacrifice.',
      'Patrol minions cover more ground but spread your defense thin.',
      'Minions level up from kills and can evolve into stronger forms.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('MINION_PLACED', fn)
      return () => EventBus.off('MINION_PLACED', fn)
    },
  },
  {
    id: 'firstAdvEnters', title: 'Invasion',
    lead: 'THE HEROES COME — KNOW YOUR ENEMY',
    body: 'Each adventurer has a class (Knight, Rogue, Mage, etc.), a personality that shapes their decisions, and a kit of class abilities. Some are tanks, some glass cannons, some bring utility. Scout them before they enter your dungeon — what you know shapes how you defend.',
    tips: [
      'Open the ADV INTEL panel to see HP, class, and ability list.',
      'Knowledge of an adv carries over between days — they remember too.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('ADVENTURERS_SPAWNED', fn)
      return () => EventBus.off('ADVENTURERS_SPAWNED', fn)
    },
  },
  {
    id: 'firstAdvFlees', title: 'Flee',
    lead: 'COWARDS — DO NOT LET THEM ESCAPE',
    body: 'Adventurers who fall below their personal flee threshold turn around and sprint for the exit. If they reach it, they escape with any gold they stole AND any intel they learned about your dungeon — making future waves harder. Kill them before they get out.',
    tips: [
      'Place fast patrol minions near the entry hall to intercept.',
      'Traps that slow or stun help close the kill window.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('ADVENTURER_FLED', fn)
      return () => EventBus.off('ADVENTURER_FLED', fn)
    },
  },
  {
    id: 'firstLockedDoor', title: 'Locked Door',
    lead: 'IRON & KEY — A CHOICE IS MADE',
    body: 'A Door Lock seals a doorway shut — only an adventurer with the matching key can pass. The trade-off: placing a lock also spawns a Key Chest in your dungeon. If a Rogue picks the lock or a Barbarian breaks it down, the door opens permanently for that run.',
    // LOCKS_CHANGED also fires during Game scene boot to sync cp.locked
    // flags on saved locks — would have triggered this at run start.
    // LOCK_PLACED only fires when the player drops a fresh Door Lock,
    // which is exactly when the player needs to know how it works.
    tips: [
      'Lock chokepoints to funnel adventurers past your kill zones.',
      'Guard the Key Chest — that is how a clever party gets through.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('LOCK_PLACED', fn)
      return () => EventBus.off('LOCK_PLACED', fn)
    },
  },
  {
    id: 'firstKnowledge', title: 'They Learn',
    lead: 'INTEL LEAKS — THE GUILD REMEMBERS',
    body: 'Every adventurer who escapes carries home what they saw: room layouts, trap locations, minion placements. Returning parties use that intel to route around known dangers — what worked once will work less the next time. Kill them all to keep your dungeon a black box.',
    tips: [
      'The KNOWLEDGE MAP panel shows what the guild currently knows.',
      'Rebuild known rooms to invalidate stale intel.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('ADVENTURER_FLED', fn)
      return () => EventBus.off('ADVENTURER_FLED', fn)
    },
  },
  {
    id: 'firstMinionEvolved', title: 'Evolution',
    lead: 'BLOOD MAKES THE STRONG STRONGER',
    body: 'Minions that survive long enough and rack up kills evolve into their next form — bigger sprite, more HP, more damage, often a new ability. Evolution is permanent and carries the minion through future days. Protect your veterans.',
    tips: [
      'Evolved minions stay in their assigned room — no need to re-place.',
      'Check ROSTER to see kill counts and evolution chains.',
    ],
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('MINION_EVOLVED', fn)
      return () => EventBus.off('MINION_EVOLVED', fn)
    },
  },

  // ── C. Boss-archetype hooks ───────────────────────────────────────────
  // Each fires on the first NIGHT_PHASE_STARTED — gated by `archetype` so
  // the hint matches the player's chosen boss. Firing during night-1 lets
  // the player learn their archetype's identity + headline mechanic before
  // they place their first room or summon their first minion, so they can
  // make informed Build-phase choices on day-1.
  {
    id: 'arch_beholder', archetype: 'beholder', title: 'Beholder Tyrant',
    lead: 'A HUNDRED EYES — A THOUSAND SCHEMES',
    body: 'You are the Beholder Tyrant. During boss fights, Petrify Gaze freezes adventurers in place — letting your minions tear them apart. Anti-Magic rooms you place silence all class abilities for any adventurer inside, neutering casters and clerics.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },
  {
    id: 'arch_demon', archetype: 'demon', title: 'Demon Lord',
    lead: 'HELL OPENS ITS GATE',
    body: 'You are the Demon Lord. Every dawn, your Hellgate births free Imps into your dungeon — no gold cost, no roster slot. You can also Sacrifice any minion at any time to instantly kill one adventurer of your choice. Burn cheap minions for high-value kills.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },
  {
    id: 'arch_gnoll', archetype: 'gnoll', title: 'Gnoll Alpha',
    lead: 'THE PACK HUNTS — ONE MIND, MANY TEETH',
    body: 'You are the Gnoll Alpha. Each dawn, free gnolls spawn directly in your boss room. Every kill any gnoll makes stacks a permanent +ATK on every gnoll in your roster — the longer the run, the more terrifying the pack becomes.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },
  {
    id: 'arch_golem', archetype: 'golem', title: 'Earth Golem',
    lead: 'YOU ARE THE DUNGEON — STONE AND BONE',
    body: 'You are the Earth Golem. Every room you place increases your boss\'s HP and DEF stats permanently — your dungeon literally makes you tougher. Once per day you can Earthquake a chosen room, dealing damage to every adventurer inside.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },
  {
    id: 'arch_lich', archetype: 'lich', title: 'Elder Lich',
    lead: 'DEATH IS A DOORWAY YOU WALK BOTH WAYS',
    body: 'You are the Elder Lich. You start with one Phylactery Heart in your treasury — place it in any room as a hidden spare life: when your boss dies, the Heart resurrects you in that room. Every adventurer killed in your dungeon rises as a free skeleton minion the next dawn.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },
  {
    id: 'arch_lizardman', archetype: 'lizardman', title: 'Serpent Captain',
    lead: 'SHADOW AND VENOM — STRIKE UNSEEN',
    body: 'You are the Serpent Captain. Your lizardman minions spawn invisible to adventurers until the first strike — a free surprise round every encounter. Each lizardman hit stacks venom on the target; adventurers tick HP loss per stack until they die or flee.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },
  {
    id: 'arch_myconid', archetype: 'myconid', title: 'Predator Myconid',
    lead: 'THE FUNGUS REMEMBERS EVERY CORPSE',
    body: 'You are the Predator Myconid. Every third day, your corridors fill with damaging spores that tick HP off any adventurer walking through. Adventurer corpses bloom into free Vinekin minions on the spot — kill them in your corridors and the corridor itself grows new defenders.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },
  {
    id: 'arch_orc', archetype: 'orc', title: 'Orc Veteran',
    lead: 'BLOOD FOR BLOOD — STRENGTH FOREVER',
    body: 'You are the Orc Veteran. Every orc minion gains +1 ATK per kill, permanently — a veteran orc late in a run will hit like a small army. Orcs in the same room also buff each other\'s attack, so a clustered orc pack snowballs hard.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },
  {
    id: 'arch_vampire', archetype: 'vampire', title: 'Vampire Sovereign',
    lead: 'KISS THEM ONCE — OWN THEM FOREVER',
    body: 'You are the Vampire Sovereign. Once per day, you charm one adventurer of your choice — they break from their party and walk straight to your boss room, where they rise as a free thrall minion. The thrall then hunts down their former allies with personal grudges.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },
  {
    id: 'arch_wraith', archetype: 'wraith', title: 'Dark Wraith',
    lead: 'TERROR IS YOUR ONLY WEAPON',
    body: 'You are the Dark Wraith. Adventurers gain Fear stacks from corpses, sprung traps, and watching allies die. At 50% Fear they flee; at 75% they attack their own party in panic; at 100% they collapse dead on the spot. You don\'t need swords — you need fright.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },
  {
    id: 'arch_succubus', archetype: 'succubus', title: 'Succubus Queen',
    lead: 'A SMILE — A WHISPER — A KILL',
    body: 'You are the Succubus Queen. Once per boss level per day, you shapeshift into a bat-swarm, infiltrate the invading party, and charm one adventurer. The charmed adv turns on their team and fights for you until they kill an ally — then the spell breaks.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('NIGHT_PHASE_STARTED', fn); return () => EventBus.off('NIGHT_PHASE_STARTED', fn) },
  },

  // ── D. Resource-warning hints ─────────────────────────────────────────
  // Fire when the player runs into a placement wall. NightPhase emits
  // PLACEMENT_BLOCKED { reason } from the relevant validation sites.
  {
    id: 'warn_rosterFull', title: 'Roster Full',
    lead: 'THE PIT IS PACKED — NO ROOM FOR MORE',
    body: 'Your minion roster has hit its current capacity. Every Barracks you build adds +10 slots to the roster cap. Until you expand, you cannot summon another minion of any species.',
    tips: [
      'Place another Barracks to raise the cap by +10.',
      'Sacrifice a weak minion in ROSTER to free a slot now.',
    ],
    subscribe: (fire) => {
      const fn = (p) => { if (p?.reason === 'roster_full') fire() }
      EventBus.on('PLACEMENT_BLOCKED', fn)
      return () => EventBus.off('PLACEMENT_BLOCKED', fn)
    },
  },
  {
    id: 'warn_lowGold', title: 'Need More Gold',
    lead: 'THE TREASURY ECHOES — EMPTY',
    body: 'You do not have enough gold to build that. Gold comes in from adventurer kills, treasure chests, and surviving the day. Until you refill, you can sell a placed room from its right-click menu for a partial refund.',
    tips: [
      'Kills pay more than survival — fight greedy, not safe.',
      'Treasure chests in your dungeon pay passive gold per night.',
    ],
    subscribe: (fire) => {
      const fn = (p) => { if (p?.reason === 'insufficient_gold') fire() }
      EventBus.on('PLACEMENT_BLOCKED', fn)
      return () => EventBus.off('PLACEMENT_BLOCKED', fn)
    },
  },
  {
    id: 'warn_trapsFull', title: 'Trap Pool Full',
    lead: 'NO MORE TRAPS — THE FORGE IS COLD',
    body: 'Your active trap pool has reached its cap. Each Trap Factory you build raises the cap by +5. Until you expand, you cannot deploy another trap of any type.',
    tips: [
      'Place another Trap Factory to raise the cap by +5.',
      'Remove an unused or known-by-the-guild trap to free a slot.',
    ],
    subscribe: (fire) => {
      const fn = (p) => { if (p?.reason === 'trap_pool_full') fire() }
      EventBus.on('PLACEMENT_BLOCKED', fn)
      return () => EventBus.off('PLACEMENT_BLOCKED', fn)
    },
  },
]

export class TutorialSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._queue     = []
    this._queuedIds = new Set()  // in-session dedupe so the same gate event firing twice doesn't double-queue
    this._showing   = false
    this._unsubs    = []

    // Wire every tutorial's gate event. _enqueue() handles the "is this
    // currently allowed" filtering each call.
    for (const t of TUTORIALS) {
      const unsubscribe = t.subscribe(() => this._enqueue(t))
      if (typeof unsubscribe === 'function') this._unsubs.push(unsubscribe)
    }

    // Welcome popup gates the first wave of hints. Until the player clicks
    // Continue we silently queue gate events. INTRO_DISMISSED tells us
    // whether they want hints — drain the queue if yes, drop it if no.
    this._onIntroDismissed = (payload) => {
      if (payload?.tutorialEnabled === false) {
        // Player opted out — clear pending hints AND the dedupe set so
        // re-enabling later from the pause menu lets new gate events
        // through cleanly.
        this._queue = []
        this._queuedIds.clear()
        return
      }
      // Player opted in — drain whatever queued during the welcome popup
      if (!this._showing) this._popNext()
    }
    EventBus.on('INTRO_DISMISSED', this._onIntroDismissed)
  }

  destroy() {
    for (const fn of this._unsubs) fn()
    this._unsubs = []
    EventBus.off('INTRO_DISMISSED', this._onIntroDismissed)
    this._queue  = []
    this._queuedIds.clear()
  }

  // Pause-menu Tutorial Hints toggle calls this so previously-queued
  // hints don't dump on the player when they re-enable mid-run.
  resetQueue() {
    this._queue = []
    this._queuedIds.clear()
  }

  _enqueue(t) {
    const meta = this._gameState?.meta
    if (!meta) return
    if (!meta.tutorialEnabled) return
    // Global master toggle from SettingsOverlay > GAMEPLAY > GAMEPLAY HINTS.
    // ANDs with the per-run `meta.tutorialEnabled` (set by WelcomeIntro
    // checkbox) so either off disables.
    try {
      if (localStorage.getItem('qf.gameplay.tutorials') === 'false') return
    } catch {}
    // Per-archetype hints only fire when the player picked that boss.
    if (t.archetype && this._gameState.player?.bossArchetypeId !== t.archetype) return
    meta.seenTutorials ??= {}
    if (meta.seenTutorials[t.id]) return
    if (this._queuedIds.has(t.id)) return
    this._queuedIds.add(t.id)
    this._queue.push(t)
    // Hold all hints until the welcome popup is dismissed. Without this
    // gate, NIGHT_PHASE_STARTED fires during scene boot and the
    // firstNight hint pops up before / on top of the welcome screen.
    if (!meta.introSeen) return
    if (!this._showing) this._popNext()
  }

  _popNext() {
    if (this._queue.length === 0) {
      this._showing = false
      return
    }
    const meta = this._gameState?.meta
    if (!meta?.introSeen) {
      // Welcome popup still up — wait for INTRO_DISMISSED to drain.
      this._showing = false
      return
    }
    // Re-check the gameplay-hints gate at fire time. A tutorial may have
    // been enqueued while the toggle was on; if the player toggled it off
    // since, drop the queue rather than firing a popup they explicitly
    // disabled. Same dual check as _enqueue: per-run meta.tutorialEnabled
    // AND global localStorage key.
    let _globalOff = false
    try { _globalOff = localStorage.getItem('qf.gameplay.tutorials') === 'false' } catch {}
    if (!meta.tutorialEnabled || _globalOff) {
      this._queue.length = 0
      this._queuedIds.clear()
      this._showing = false
      return
    }
    const t = this._queue.shift()
    // Mark seen at SHOW time (not enqueue time) so a tutorial that got
    // suppressed during the welcome-or-disabled window can still fire
    // legitimately later.
    meta.seenTutorials ??= {}
    meta.seenTutorials[t.id] = true
    this._queuedIds.delete(t.id)
    this._showing = true
    // The HudScene owns the popup instance — emit a request and HudScene
    // routes to its TutorialPopup. Keeps this system free of UI imports.
    EventBus.emit('SHOW_TUTORIAL', {
      title:  t.title,
      lead:   t.lead ?? null,
      body:   t.body,
      tips:   t.tips ?? null,
      onClose: () => {
        // Small inter-popup gap so successive hints don\'t feel jammed
        this._scene.time.delayedCall(450, () => this._popNext())
      },
    })
  }
}

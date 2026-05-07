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
    body: 'Place rooms, minions, and traps. Click BEGIN DAY when ready.',
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('NIGHT_PHASE_STARTED', fn)
      return () => EventBus.off('NIGHT_PHASE_STARTED', fn)
    },
  },
  {
    id: 'firstDay', title: 'Defend Phase',
    body: 'Adventurers invade. Stop them before they reach the boss chamber.',
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('DAY_PHASE_BEGAN', fn)
      return () => EventBus.off('DAY_PHASE_BEGAN', fn)
    },
  },
  {
    id: 'firstEndOfDay', title: 'End of Day',
    body: 'Each day cleared earns gold and XP. New unlocks come with boss levels.',
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('SHOW_POST_WAVE_SUMMARY', fn)
      return () => EventBus.off('SHOW_POST_WAVE_SUMMARY', fn)
    },
  },
  {
    id: 'firstBossLevelUp', title: 'Boss Leveled',
    body: 'New rooms, minions, traps, and items unlocked — check the Construction menu.',
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('BOSS_LEVEL_UP_DISMISSED', fn)
      return () => EventBus.off('BOSS_LEVEL_UP_DISMISSED', fn)
    },
  },
  {
    id: 'firstDarkPact', title: 'Dark Pact',
    body: 'Pick a permanent buff with a tradeoff. Cannot be undone.',
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('SHOW_DARK_PACT', fn)
      return () => EventBus.off('SHOW_DARK_PACT', fn)
    },
  },

  // ── B. Core-mechanic intros ───────────────────────────────────────────
  {
    id: 'firstMinionPlaced', title: 'Minions',
    body: 'Minions defend their room. Patrol minions hunt in connected rooms.',
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('MINION_PLACED', fn)
      return () => EventBus.off('MINION_PLACED', fn)
    },
  },
  {
    id: 'firstAdvEnters', title: 'Invasion',
    body: 'Each adventurer has a class and abilities. Open Intel to scout.',
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('ADVENTURERS_SPAWNED', fn)
      return () => EventBus.off('ADVENTURERS_SPAWNED', fn)
    },
  },
  {
    id: 'firstAdvFlees', title: 'Flee',
    body: 'Fleers escape with stolen gold. Kill before they exit.',
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('ADVENTURER_FLED', fn)
      return () => EventBus.off('ADVENTURER_FLED', fn)
    },
  },
  {
    id: 'firstLockedDoor', title: 'Locked Door',
    body: 'Adventurers need a key. Rogues lockpick; Barbarians break through.',
    // LOCKS_CHANGED also fires during Game scene boot to sync cp.locked
    // flags on saved locks — would have triggered this at run start.
    // LOCK_PLACED only fires when the player drops a fresh Door Lock,
    // which is exactly when the player needs to know how it works.
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('LOCK_PLACED', fn)
      return () => EventBus.off('LOCK_PLACED', fn)
    },
  },
  {
    id: 'firstKnowledge', title: 'They Learn',
    body: 'Survivors remember. Returning advs avoid known traps.',
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('ADVENTURER_FLED', fn)
      return () => EventBus.off('ADVENTURER_FLED', fn)
    },
  },
  {
    id: 'firstMinionEvolved', title: 'Evolution',
    body: 'Minions evolve from kills — bigger, stronger, new abilities.',
    subscribe: (fire) => {
      const fn = () => fire()
      EventBus.on('MINION_EVOLVED', fn)
      return () => EventBus.off('MINION_EVOLVED', fn)
    },
  },

  // ── C. Boss-archetype hooks ───────────────────────────────────────────
  // Each fires on the first DAY_PHASE_BEGAN — gated by `archetype` so the
  // hint matches the player's chosen boss. Tutorial copy mirrors each
  // boss's headline mechanic in 1-2 lines.
  {
    id: 'arch_beholder', archetype: 'beholder', title: 'Beholder Tyrant',
    body: 'Petrify Gaze freezes adventurers during boss fights. Anti-Magic rooms silence their class abilities each day.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },
  {
    id: 'arch_demon', archetype: 'demon', title: 'Demon Lord',
    body: 'Hellgate births free Imps every dawn. Sacrifice can burn a minion to instakill an adventurer.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },
  {
    id: 'arch_gnoll', archetype: 'gnoll', title: 'Gnoll Alpha',
    body: 'Hunters Pack: free gnolls spawn in your boss room. Each kill stacks +ATK on every gnoll.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },
  {
    id: 'arch_golem', archetype: 'golem', title: 'Earth Golem',
    body: 'Each placed room gives the boss +HP and +DEF. Earthquake (1/day) damages every adv in a chosen room.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },
  {
    id: 'arch_lich', archetype: 'lich', title: 'Elder Lich',
    body: 'You start with one Phylactery Heart — place it in any room as a hidden spare life. Adventurers killed raise as free skeletons next dawn.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },
  {
    id: 'arch_lizardman', archetype: 'lizardman', title: 'Serpent Captain',
    body: 'Lizardman minions spawn invisible until they strike. Hits stack venom — adventurers tick HP per stack until they die or flee.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },
  {
    id: 'arch_myconid', archetype: 'myconid', title: 'Predator Myconid',
    body: 'Every third day, corridor rooms fill with damaging spores. Adv corpses bloom into free Vinekin minions.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },
  {
    id: 'arch_orc', archetype: 'orc', title: 'Orc Veteran',
    body: 'Orcs gain +1 ATK per kill, forever. Orcs in the same room buff each other.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },
  {
    id: 'arch_vampire', archetype: 'vampire', title: 'Vampire Sovereign',
    body: 'One adv per day is charmed — they walk to your boss room and rise as a free thrall hunting their old party.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },
  {
    id: 'arch_wraith', archetype: 'wraith', title: 'Dark Wraith',
    body: 'Adventurers gain Fear from corpses, traps, and dying allies. At 50% they flee; at 75% friendly fire; at 100% they drop dead.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },
  {
    id: 'arch_succubus', archetype: 'succubus', title: 'Succubus Queen',
    body: 'Once per boss level per day, shapeshift into a bat-swarm and charm an adventurer. They turn on their party until they kill an ally.',
    subscribe: (fire) => { const fn = () => fire(); EventBus.on('DAY_PHASE_BEGAN', fn); return () => EventBus.off('DAY_PHASE_BEGAN', fn) },
  },

  // ── D. Resource-warning hints ─────────────────────────────────────────
  // Fire when the player runs into a placement wall. NightPhase emits
  // PLACEMENT_BLOCKED { reason } from the relevant validation sites.
  {
    id: 'warn_rosterFull', title: 'Roster Full',
    body: 'Your minion roster is at capacity. Build another Barracks (+10 slots).',
    subscribe: (fire) => {
      const fn = (p) => { if (p?.reason === 'roster_full') fire() }
      EventBus.on('PLACEMENT_BLOCKED', fn)
      return () => EventBus.off('PLACEMENT_BLOCKED', fn)
    },
  },
  {
    id: 'warn_lowGold', title: 'Need More Gold',
    body: 'Earn gold by killing adventurers. Sell rooms or wait for the next day to refill.',
    subscribe: (fire) => {
      const fn = (p) => { if (p?.reason === 'insufficient_gold') fire() }
      EventBus.on('PLACEMENT_BLOCKED', fn)
      return () => EventBus.off('PLACEMENT_BLOCKED', fn)
    },
  },
  {
    id: 'warn_trapsFull', title: 'Trap Pool Full',
    body: 'Your trap pool is capped. Build another Trap Factory (+5 slots).',
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
      body:   t.body,
      onClose: () => {
        // Small inter-popup gap so successive hints don\'t feel jammed
        this._scene.time.delayedCall(450, () => this._popNext())
      },
    })
  }
}

// Occasional chat bubbles above adventurers.
// Pulls a random class, personality, or fourth-wall line every N seconds (timer path).
// Also fires contextual lines immediately on EventBus events: traps, rooms, combat
// transitions, low HP, ally death, fleeing, boss room.

import { EventBus } from '../systems/EventBus.js'
import { createBubble } from './Bubble.js'

// Ambient chatter cadence. The base interval is what each adv targets;
// _scheduleNextChat() lengthens it on big waves so total bubbles/sec
// stays bounded regardless of how many advs are alive (see
// AMBIENT_TARGET_RATE_HZ below). Bumped from 7-15s → 12-24s on
// 2026-05-25; per-adv scaling layered on 2026-05-26.
const MIN_INTERVAL_MS      = 12000
const MAX_INTERVAL_MS      = 24000
const BUBBLE_LIFE_MS       = 2200
const CONTEXTUAL_LIFE_MS   = 3000
const CONTEXTUAL_COOLDOWN  = 3000
const FOURTH_WALL_CHANCE   = 0.08   // 8% of ambient chatter is 4th-wall

// Target rate of ambient bubbles per second across the whole wave.
// At 80 advs and 1.5 Hz target, each adv chats every ~53s — visually
// the chatter density on screen stays roughly constant whether the
// wave is 5 or 80 strong. Contextual events (trap fired, ally died,
// etc.) bypass this; only the timer-based ambient is scaled.
const AMBIENT_TARGET_RATE_HZ = 1.5

// Hard cap on concurrently-rendered bubbles. Past this, new bubble
// creation drops silently — the bubbles are pure flavour, no
// gameplay depends on seeing every line. Contextual events still
// fire FIRST so the priority moments aren't the ones dropped.
const MAX_CONCURRENT_BUBBLES = 12

// Off-camera bubble cull — bubbles whose owner is outside the
// camera viewport (plus margin) skip their per-frame position
// update. Matches the cull margin / pattern used in MinionRenderer.
const BUBBLE_CULL_MARGIN_PX = 200

export class ChatBubbles {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState
    this._bubbles   = {}      // advId → { container, expiresAt }
    this._nextChatAt        = {}  // advId → ms timestamp
    this._lastContextualAt  = {}  // advId → ms timestamp (contextual cooldown)
    this._lastAiState       = {}  // advId → previous aiState (for transition detection)
    this._lowHpNotified     = {}  // advId → bool (rate-limit low-HP lines)
    this._lines = null

    EventBus.on('TRAP_TRIGGERED',       this._onTrapTriggered,     this)
    EventBus.on('ROOM_OBSERVED',        this._onRoomObserved,      this)
    EventBus.on('BOSS_FIGHT_INCOMING',  this._onBossFightIncoming, this)
    EventBus.on('ADVENTURER_DIED',      this._onAdventurerDied,    this)
    EventBus.on('ADVENTURER_FLED',      this._onAdventurerFled,    this)
    EventBus.on('NIGHT_PHASE_STARTED',  this._onNightStarted,      this)
    // Tier 1/2/3 reactions (2026-05-27) — fill in the chatter gaps
    // the player was missing. Each listener picks a brief line from
    // the matching `byEvent.<bucket>` pool and shows it via
    // _showContextualBubble (respects the per-adv 3 s cooldown).
    EventBus.on('MINION_OBSERVED',          this._onMinionObserved,    this)
    EventBus.on('BOSS_LEVELED_UP',          this._onBossLeveledUp,     this)
    EventBus.on('PHYLACTERY_DESTROYED',     this._onPhylacteryShattered, this)
    EventBus.on('MIMIC_SPRUNG',             this._onMimicSprung,       this)
    EventBus.on('COMBAT_HIT',               this._onCombatHit,         this)
    EventBus.on('ADVENTURER_ENTERED_DUNGEON', this._onAdvEnteredForVeteran, this)
    EventBus.on('DUNGEON_EVENT_ANNOUNCED',  this._onDungeonEventAnnounced, this)
    EventBus.on('STATUS_APPLIED',           this._onStatusApplied,     this)
    EventBus.on('NECROMANCY_RAISED',        this._onNecromancyRaised,  this)
    EventBus.on('DAY_PHASE_BEGAN',          this._onDayBeganLate,      this)
    // Boss-ability sightings — wired as a single shared "felt that"
    // reaction across every signature ability. Lines live in the
    // bossAbilityFelt bucket. Each event throttled per-day so a
    // beholder's 6 s gaze cooldown doesn't spam.
    for (const evt of [
      'GOLEM_EARTHQUAKE_FIRED',
      'BEHOLDER_PETRIFY_FIRED',
      'DEMON_SACRIFICE_FIRED',
      'PACT_BOSS_HELLFIRE_FIRED',
      'PACT_BOSS_LIGHTNING_FIRED',
      'PACT_BOSS_SHOCKWAVE_FIRED',
      'PACT_BOSS_SPECTRAL_FIRED',
      'PACT_BOSS_VORTEX_FIRED',
      'PACT_BOSS_PETRIFY_FIRED',
      'FINAL_BREATH_TRIGGERED',
      'CULL_TRIGGERED',
    ]) {
      const handler = () => this._onBossAbilityFelt(evt)
      this._bossAbilityHandlers ??= {}
      this._bossAbilityHandlers[evt] = handler
      EventBus.on(evt, handler)
    }
    // Adventurer-goal reaction lines. Each event carries `{ adventurer }`
    // and pulls one random line from the matching `byEvent.<key>` pool.
    for (const key of [
      'investigateNoiseHeard', 'regroupAtParty', 'avoidTrap',
      'lootCorpseStart', 'lootCorpseDone', 'rescueAlly',
      'gloatOverKill', 'warnParty', 'scoutAhead',
      'pickedKey', 'unlockedDoor', 'lockpicked', 'brokeDoor', 'seekKey',
      'seekHeal', 'healed',
      'seekTreasure', 'stoleTreasure', 'escapingWithLoot',
    ]) {
      const handler = ({ adventurer }) => {
        if (adventurer) this._showContextualBubble(adventurer, this._pickEventLine(key))
      }
      this._goalHandlers ??= {}
      this._goalHandlers[key] = handler
      EventBus.on(`SAY_${key}`, handler)
    }
  }

  destroy() {
    EventBus.off('TRAP_TRIGGERED',       this._onTrapTriggered,     this)
    EventBus.off('ROOM_OBSERVED',        this._onRoomObserved,      this)
    EventBus.off('BOSS_FIGHT_INCOMING',  this._onBossFightIncoming, this)
    EventBus.off('ADVENTURER_DIED',      this._onAdventurerDied,    this)
    EventBus.off('ADVENTURER_FLED',      this._onAdventurerFled,    this)
    EventBus.off('NIGHT_PHASE_STARTED',  this._onNightStarted,      this)
    EventBus.off('MINION_OBSERVED',          this._onMinionObserved,    this)
    EventBus.off('BOSS_LEVELED_UP',          this._onBossLeveledUp,     this)
    EventBus.off('PHYLACTERY_DESTROYED',     this._onPhylacteryShattered, this)
    EventBus.off('MIMIC_SPRUNG',             this._onMimicSprung,       this)
    EventBus.off('COMBAT_HIT',               this._onCombatHit,         this)
    EventBus.off('ADVENTURER_ENTERED_DUNGEON', this._onAdvEnteredForVeteran, this)
    EventBus.off('DUNGEON_EVENT_ANNOUNCED',  this._onDungeonEventAnnounced, this)
    EventBus.off('STATUS_APPLIED',           this._onStatusApplied,     this)
    EventBus.off('NECROMANCY_RAISED',        this._onNecromancyRaised,  this)
    EventBus.off('DAY_PHASE_BEGAN',          this._onDayBeganLate,      this)
    for (const [evt, handler] of Object.entries(this._bossAbilityHandlers ?? {})) {
      EventBus.off(evt, handler)
    }
    this._bossAbilityHandlers = {}
    for (const [key, handler] of Object.entries(this._goalHandlers ?? {})) {
      EventBus.off(`SAY_${key}`, handler)
    }
    this._goalHandlers = {}
    for (const id of Object.keys(this._bubbles)) this._destroyBubble(id)
  }

  // Called every Game.update() during day phase.
  update() {
    if (!this._lines) this._lines = this._scene.cache.json.get('chatLines') ?? {}
    const now = this._scene.time.now

    // Lone survivor check (Tier 1) — when active count drops to 1
    // (and there were more before), fire a one-shot loneSurvivor line
    // on whoever's left. Flag clears overnight in _onNightStarted.
    const active = this._gameState.adventurers.active
    if (!this._loneSurvivorFired && active.length === 1) {
      const survivor = active[0]
      if (survivor && survivor.aiState !== 'dead' && (survivor.resources?.hp ?? 0) > 0) {
        this._loneSurvivorFired = true
        this._showContextualBubble(survivor, this._pickEventLine('loneSurvivor'))
      }
    } else if (active.length > 1) {
      // Re-arm if wave grows (multi-wave day).
      this._loneSurvivorFired = false
    }

    for (const adv of this._gameState.adventurers.active) {
      const prevState = this._lastAiState[adv.instanceId]
      const curState  = adv.aiState
      this._lastAiState[adv.instanceId] = curState

      // Detect combat transitions
      if (prevState && prevState !== curState) {
        if (curState === 'fighting') {
          this._showContextualBubble(adv, this._pickEventLine('combatStart'))
        } else if (prevState === 'fighting' && (curState === 'walking' || curState === 'idle')) {
          this._showContextualBubble(adv, this._pickEventLine('combatWon'))
        }
      }

      // Tier 3 — echo personality follow-leader transition. Sticky
      // per-(adv, leader) so an echo doesn't keep shouting every
      // replan; only re-fires if the leader changes (rare).
      const goalType = adv.goal?.type
      const lastGoal = this._lastGoalType?.[adv.instanceId]
      this._lastGoalType ??= {}
      this._lastGoalType[adv.instanceId] = goalType
      if (goalType === 'FOLLOW_LEADER' && lastGoal !== 'FOLLOW_LEADER') {
        if ((adv.personalityIds ?? []).includes('echo')) {
          this._showContextualBubble(adv, this._pickEventLine('echoFollowLeader'))
        }
      }

      // Low HP threshold
      const maxHp = adv.resources?.maxHp ?? 1
      const hp    = adv.resources?.hp    ?? maxHp
      if (hp / maxHp < 0.3 && !this._lowHpNotified[adv.instanceId]) {
        this._lowHpNotified[adv.instanceId] = true
        this._showContextualBubble(adv, this._pickEventLine('lowHp'))
      } else if (hp / maxHp >= 0.5) {
        this._lowHpNotified[adv.instanceId] = false
      }

      // Timer-based ambient chatter (walking only, no active bubble)
      if (adv.aiState !== 'walking') continue
      if (this._bubbles[adv.instanceId]) continue

      const next = this._nextChatAt[adv.instanceId]
      if (next == null) {
        this._scheduleNextChat(adv.instanceId, now)
        continue
      }
      if (now < next) continue

      this._showBubbleFor(adv)
      this._scheduleNextChat(adv.instanceId, now)
    }

    // Position update + expiration. Each bubble carries its owning
    // `adv` reference directly (set in _createBubble), so per-frame
    // lookup is O(1) instead of an Array.find() per bubble — that
    // .find() was the dominant cost in late-game waves (10 bubbles
    // x 80 advs = 800 scans/frame, ~50k ops/sec at 60fps).
    //
    // Off-camera cull skips the setPosition() call when the adv is
    // off-screen. The container's stale position is fine; it'll be
    // refreshed the moment the camera pans it back into view.
    const cam = this._scene.cameras?.main
    const camLeft   = cam ? (cam.worldView.x - BUBBLE_CULL_MARGIN_PX) : -Infinity
    const camRight  = cam ? (cam.worldView.x + cam.worldView.width  + BUBBLE_CULL_MARGIN_PX) : Infinity
    const camTop    = cam ? (cam.worldView.y - BUBBLE_CULL_MARGIN_PX) : -Infinity
    const camBottom = cam ? (cam.worldView.y + cam.worldView.height + BUBBLE_CULL_MARGIN_PX) : Infinity

    for (const id of Object.keys(this._bubbles)) {
      const b = this._bubbles[id]
      if (now >= b.expiresAt) {
        this._destroyBubble(id)
        continue
      }
      const adv = b.adv
      // Defensive — if the adv reference was lost (re-creation race,
      // graveyard cleanup), drop the bubble.
      if (!adv || adv.aiState === 'dead') { this._destroyBubble(id); continue }
      const wx = adv.worldX, wy = adv.worldY
      if (wx < camLeft || wx > camRight || wy < camTop || wy > camBottom) continue
      b.container.setPosition(wx, wy - 30)
    }
  }

  // ── EventBus handlers ────────────────────────────────────────────────────

  _onTrapTriggered({ adventurer }) {
    if (!adventurer) return
    this._showContextualBubble(adventurer, this._pickEventLine('trapTriggered'))
  }

  _onRoomObserved({ adventurer, firstVisit, roomId }) {
    if (!adventurer) return
    if (!firstVisit && Math.random() > 0.25) return   // only react ~25% for revisits
    const key = firstVisit ? 'firstRoom' : 'knownRoom'
    this._showContextualBubble(adventurer, this._pickEventLine(key))

    // Tier 2/3 extensions on room observation:
    //
    // (a) Trap spotted — if the adv has any known trap in this room
    //     (intel from prior survivors or personal sighting), fire
    //     `trapSpotted`. Sticky per-(adv, room) so the same room
    //     entry doesn't re-fire on every revisit.
    // (b) Locked door blocked — if the room is gated by a lock the
    //     adv lacks the key for, fire `lockedDoorBlocked`. Same
    //     sticky-per-room rule.
    // (c) Room-type-flavored line — pull from byRoomType[def.id] if
    //     the room has a recognised type bucket. Falls back silently
    //     when no bucket exists (most generic rooms).
    if (!firstVisit || !roomId) return
    this._roomReactionFired ??= {}
    this._roomReactionFired[adventurer.instanceId] ??= {}
    if (this._roomReactionFired[adventurer.instanceId][roomId]) return
    this._roomReactionFired[adventurer.instanceId][roomId] = true

    const knownTraps = adventurer.knowledge?.traps ?? {}
    const trapInRoom = Object.values(knownTraps).some(t => {
      const tx = t?.tileX, ty = t?.tileY
      const room = this._gameState.dungeon?.rooms?.find(r => r.instanceId === roomId)
      if (!room) return false
      return tx >= room.gridX && tx < room.gridX + room.width
          && ty >= room.gridY && ty < room.gridY + room.height
    })
    if (trapInRoom) {
      this._showContextualBubble(adventurer, this._pickEventLine('trapSpotted'))
      return  // one reaction per room entry is plenty
    }

    const locks = this._gameState.dungeon?.locks ?? []
    const lockBlocking = locks.some(l => {
      if (!l || l.unlocked || l.broken) return false
      // Lock counts if any of its doorTiles touch this room AND the
      // adv has no matching key.
      const hasKey = (adventurer.keys ?? []).includes(l.id)
      if (hasKey) return false
      const room = this._gameState.dungeon?.rooms?.find(r => r.instanceId === roomId)
      if (!room) return false
      return (l.doorTiles ?? []).some(t =>
        t.x >= room.gridX && t.x < room.gridX + room.width &&
        t.y >= room.gridY && t.y < room.gridY + room.height,
      )
    })
    if (lockBlocking) {
      this._showContextualBubble(adventurer, this._pickEventLine('lockedDoorBlocked'))
      return
    }

    // Room-type flavor — only fires if byRoomType[def.id] exists in
    // the JSON. Most rooms fall back to silence here (the firstRoom
    // line above already covered the generic "I'm in a room" beat).
    const room = this._gameState.dungeon?.rooms?.find(r => r.instanceId === roomId)
    const typeLines = this._lines?.byRoomType?.[room?.definitionId]
    if (Array.isArray(typeLines) && typeLines.length) {
      this._showContextualBubble(adventurer, typeLines[Math.floor(Math.random() * typeLines.length)])
    }
  }

  _onBossFightIncoming({ adventurer }) {
    if (!adventurer) return
    this._showContextualBubble(adventurer, this._pickEventLine('bossRoom'))
  }

  _onAdventurerDied({ adventurer }) {
    // Show an allyDied reaction on a random nearby living adventurer
    const survivors = (this._gameState.adventurers?.active ?? []).filter(
      a => a.instanceId !== adventurer?.instanceId && a.aiState !== 'dead'
    )
    if (!survivors.length) return
    const reactor = survivors[Math.floor(Math.random() * survivors.length)]
    this._showContextualBubble(reactor, this._pickEventLine('allyDied'))
  }

  _onAdventurerFled({ adventurer }) {
    if (!adventurer) return
    this._showContextualBubble(adventurer, this._pickEventLine('fleeing'))
  }

  _onNightStarted() {
    for (const id of Object.keys(this._bubbles)) this._destroyBubble(id)
    this._nextChatAt       = {}
    this._lastContextualAt = {}
    this._lastAiState      = {}
    this._lowHpNotified    = {}
    // Tier 1/2/3 per-day one-shot flags also reset overnight.
    this._sightedMinionTypes = {}   // advId → bool (one shout per day)
    this._sawDungeonEvent    = false
    this._loneSurvivorFired  = false
    this._veteranGreeted     = {}   // advId → bool
    this._lastGoalType       = {}   // advId → previous goal.type (echo detection)
    this._roomReactionFired  = {}   // advId → roomId → bool
    this._bossAbilityFiredToday = {} // eventName → bool (per-day throttle)
  }

  // ── Tier 1/2/3 contextual reactions ─────────────────────────────────────
  //
  // All of these route through `_showContextualBubble` so they respect
  // the per-adv 3 s cooldown — a critical-hit cascade or noisy minion
  // sighting won't replace whatever the adv is currently saying.

  // MINION_OBSERVED fires from KnowledgeSystem the first time an adv
  // sees a given minion definitionId (per day). We bubble a brief
  // "spotted!" line — per-family-specific where the data has a
  // matching `byMinionType` bucket, generic `minionSighted` otherwise.
  //
  // Sticky per (adv) — only one minion-sighting shout per adv per
  // day, even if they see multiple new types. Prevents a wave of
  // chatter when an adv walks into a multi-minion room. The first
  // sighting wins (whichever specific type triggered the event).
  _onMinionObserved({ advId, minionId } = {}) {
    if (!advId) return
    const adv = (this._gameState.adventurers?.active ?? []).find(a => a.instanceId === advId)
    if (!adv) return
    this._sightedMinionTypes ??= {}
    if (this._sightedMinionTypes[advId]) return  // already shouted once today
    this._sightedMinionTypes[advId] = true

    // Resolve the minion's family name from its definitionId.
    // Minion ids are like "skeleton1" / "skeleton2" / "skeleton3" —
    // strip the trailing tier digit to get the family ("skeleton").
    // Some non-tiered ids (e.g. "orc_veteran", "demon_lord") are
    // their own family and match the byMinionType keys directly.
    const minion = (this._gameState.minions ?? []).find(m => m.instanceId === minionId)
    const defId  = minion?.definitionId ?? ''
    const family = defId.replace(/\d+$/, '')  // strip trailing tier digit
    const familyLines = this._lines?.byMinionType?.[family]
    if (Array.isArray(familyLines) && familyLines.length) {
      this._showContextualBubble(adv, familyLines[Math.floor(Math.random() * familyLines.length)])
    } else {
      this._showContextualBubble(adv, this._pickEventLine('minionSighted'))
    }
  }

  // BOSS_LEVELED_UP — pick a single random alive adv (not at-boss) to
  // call it out. Reads as "they felt it from across the dungeon."
  _onBossLeveledUp() {
    const candidates = (this._gameState.adventurers?.active ?? []).filter(a =>
      a.aiState !== 'dead' && a.goal?.type !== 'AT_BOSS',
    )
    if (candidates.length === 0) return
    const reactor = candidates[Math.floor(Math.random() * candidates.length)]
    this._showContextualBubble(reactor, this._pickEventLine('bossLeveled'))
  }

  // PHYLACTERY_DESTROYED — big moment. Up to 3 random survivors cheer
  // (the rest are about to flee, the bubble factory handles overlap).
  _onPhylacteryShattered() {
    const survivors = (this._gameState.adventurers?.active ?? []).filter(a =>
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0,
    )
    if (survivors.length === 0) return
    // Pool sample N (3 max) so we don't spawn 12 bubbles on a big wave.
    const sample = []
    const pool = survivors.slice()
    const n = Math.min(3, pool.length)
    for (let i = 0; i < n; i++) {
      const j = Math.floor(Math.random() * pool.length)
      sample.push(pool.splice(j, 1)[0])
    }
    for (const adv of sample) {
      this._showContextualBubble(adv, this._pickEventLine('phylacteryShattered'))
    }
  }

  // MIMIC_SPRUNG — opener dies instantly; the SHOCK is from the rest
  // of the party. Filter to nearby living advs in the same room as
  // the mimic (party-wise reaction, not the whole dungeon).
  _onMimicSprung({ mimic, opener } = {}) {
    if (!mimic) return
    const partyId = opener?.partyId
    const reactors = (this._gameState.adventurers?.active ?? []).filter(a =>
      a.instanceId !== opener?.instanceId &&
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 &&
      (!partyId || a.partyId === partyId),
    )
    if (reactors.length === 0) return
    // One witness reacts — keeps the moment punchy without a wave of bubbles.
    const reactor = reactors[Math.floor(Math.random() * reactors.length)]
    this._showContextualBubble(reactor, this._pickEventLine('mimicSprung'))
  }

  // COMBAT_HIT — fired by CombatSystem with isCritical flag. We split
  // into critLanded (attacker is an adv) vs critTaken (target is an
  // adv). Non-critical hits ignored. Adv-vs-adv crits (Hall of Madness
  // attack-ally, Twitch beef) fire the landed reaction on the attacker
  // and skip the target's panic so the moment reads cleanly.
  _onCombatHit({ sourceId, targetId, isCritical } = {}) {
    if (!isCritical) return
    const advs = this._gameState.adventurers?.active ?? []
    const attacker = advs.find(a => a.instanceId === sourceId)
    const target   = advs.find(a => a.instanceId === targetId)
    if (attacker) {
      this._showContextualBubble(attacker, this._pickEventLine('critLanded'))
    } else if (target) {
      this._showContextualBubble(target, this._pickEventLine('critTaken'))
    }
  }

  // ADVENTURER_ENTERED_DUNGEON — fire the veteran-swagger line on
  // returning advs (escapeCount > 0). Sticky per-adv so the line only
  // fires once per spawn, not every wave they've returned.
  _onAdvEnteredForVeteran({ adventurer } = {}) {
    if (!adventurer) return
    const ec = adventurer.escapeCount ?? adventurer.knownEscapeCount ?? 0
    if (ec <= 0) return
    if (this._veteranGreeted?.[adventurer.instanceId]) return
    this._veteranGreeted ??= {}
    this._veteranGreeted[adventurer.instanceId] = true
    this._showContextualBubble(adventurer, this._pickEventLine('veteranReturn'))
  }

  // DUNGEON_EVENT_ANNOUNCED — once per event-day. Random alive adv
  // notices the brewing thing.
  _onDungeonEventAnnounced() {
    if (this._sawDungeonEvent) return
    const candidates = (this._gameState.adventurers?.active ?? []).filter(a =>
      a.aiState !== 'dead',
    )
    if (candidates.length === 0) return
    this._sawDungeonEvent = true
    const reactor = candidates[Math.floor(Math.random() * candidates.length)]
    this._showContextualBubble(reactor, this._pickEventLine('dungeonEventAnnounced'))
  }

  // STATUS_APPLIED — fire on CHARMED label so the new thrall shouts a
  // last line before they walk to the boss. Adv has _charmed=true at
  // emit time so the chat is their final voluntary moment. Other
  // status labels (PETRIFIED, INVISIBLE, etc.) are silent here so we
  // don't drown the screen — those have their own VFX feedback.
  _onStatusApplied({ targetId, label } = {}) {
    if (label !== 'CHARMED') return
    const adv = (this._gameState.adventurers?.active ?? []).find(a => a.instanceId === targetId)
    if (!adv) return
    this._showContextualBubble(adv, this._pickEventLine('charmedByVampire'))
  }

  // NECROMANCY_RAISED — at dawn, dead advs rise as undead. The raised
  // entities are minions (no bubble surface) — but living advs in
  // the dungeon REACT to their fallen allies coming back wrong. Fire
  // the witness reaction on a random living non-AT_BOSS adv.
  _onNecromancyRaised({ count } = {}) {
    if (!count) return
    const witnesses = (this._gameState.adventurers?.active ?? []).filter(a =>
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0,
    )
    if (witnesses.length === 0) return
    const reactor = witnesses[Math.floor(Math.random() * witnesses.length)]
    this._showContextualBubble(reactor, this._pickEventLine('raisedAsUndead'))
  }

  // Boss-ability "felt that" reaction. Single shared bucket across
  // every signature emit (earthquake, petrify, hellfire, etc.) so
  // the player gets a consistent "the boss did something big"
  // chorus from advs in the dungeon. Per-day throttle keyed on the
  // event name so a 6 s beholder gaze doesn't spam.
  _onBossAbilityFelt(eventName) {
    this._bossAbilityFiredToday ??= {}
    if (this._bossAbilityFiredToday[eventName]) return
    this._bossAbilityFiredToday[eventName] = true
    const candidates = (this._gameState.adventurers?.active ?? []).filter(a =>
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0 && a.goal?.type !== 'AT_BOSS',
    )
    if (candidates.length === 0) return
    const reactor = candidates[Math.floor(Math.random() * candidates.length)]
    this._showContextualBubble(reactor, this._pickEventLine('bossAbilityFelt'))
  }

  // DAY_PHASE_BEGAN — fire the "day is late" tension line once at
  // the start of any day past DAY_LATE_THRESHOLD. The line lives in
  // the chat bucket; this trigger is just "we've been here a while
  // and tomorrow's about to hit different." Random adv reacts.
  _onDayBeganLate() {
    const day = this._gameState.meta?.dayNumber ?? 1
    if (day < 10) return                              // late = day 10+
    if (this._dayLateGreetedDay === day) return       // once per day
    const candidates = (this._gameState.adventurers?.active ?? []).filter(a =>
      a.aiState !== 'dead' && (a.resources?.hp ?? 0) > 0,
    )
    if (candidates.length === 0) return
    this._dayLateGreetedDay = day
    const reactor = candidates[Math.floor(Math.random() * candidates.length)]
    this._showContextualBubble(reactor, this._pickEventLine('dayGettingLate'))
  }

  // ── Bubble creation ──────────────────────────────────────────────────────

  _scheduleNextChat(advId, now) {
    // Per-adv interval scales UP with the active adv count so the
    // total ambient bubble rate stays roughly AMBIENT_TARGET_RATE_HZ
    // regardless of wave size. With 5 advs the base 12-24s window
    // applies (well under the target rate — fine). With 80 advs each
    // adv is pushed to ~53s avg so the wave collectively still emits
    // ~1.5 ambient bubbles/sec, not 4-5/sec.
    const base = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS)
    const advCount = Math.max(1, (this._gameState.adventurers?.active ?? []).length)
    // Required per-adv interval to hit the wave-wide target rate.
    const targetPerAdvMs = (advCount / AMBIENT_TARGET_RATE_HZ) * 1000
    const dur = Math.max(base, targetPerAdvMs)
    this._nextChatAt[advId] = now + dur
  }

  _showBubbleFor(adv) {
    const line = this._pickLine(adv)
    if (!line) return
    this._createBubble(adv, line, BUBBLE_LIFE_MS)
  }

  // Shows a contextual bubble, bypassing the walking-only restriction.
  // Per-adventurer cooldown prevents rapid stacking.
  _showContextualBubble(adv, line) {
    if (!adv || !line || adv.aiState === 'dead') return
    const now  = this._scene.time.now
    const last = this._lastContextualAt[adv.instanceId] ?? 0
    if (now - last < CONTEXTUAL_COOLDOWN) return
    this._lastContextualAt[adv.instanceId] = now
    this._destroyBubble(adv.instanceId)
    this._createBubble(adv, line, CONTEXTUAL_LIFE_MS)
  }

  _createBubble(adv, line, lifeMs) {
    // Event-spawned monsters (zombie horde, rival-dungeon invaders) are
    // not chatty adventurers — they never show speech bubbles.
    if (!adv || adv._monster) return
    // Concurrent-cap safety net. Pure flavour — silently drop new
    // bubbles past the cap so a pathological "everyone bubbles at
    // once" frame can't spike DOM/Phaser allocation. Contextual
    // events (which take CONTEXTUAL_LIFE_MS, longer than ambient)
    // tend to win the existing slots since they fire on a per-adv
    // priority cooldown; ambient drops first when at cap.
    const currentCount = Object.keys(this._bubbles).length
    if (currentCount >= MAX_CONCURRENT_BUBBLES && !this._bubbles[adv.instanceId]) return

    // Build via the shared BubbleFactory — pixel-art square bubble
    // with downward tail, wrapped Press Start 2P text (140 px max,
    // capped at 3 lines), scale-pop entrance. Container origin is
    // the tail tip; we anchor it at (worldX, worldY - 30) so the
    // tail points at the adv's head — same offset the old single-
    // line render used.
    const c = createBubble(this._scene, {
      x:     adv.worldX,
      y:     adv.worldY - 30,
      text:  line,
      kind:  'chat',
      depth: 11,
      // No auto-lifeMs — this module manages its own expiry timer
      // via expiresAt + the per-frame update() sweep below.
    })

    this._bubbles[adv.instanceId] = {
      container: c,
      // Stash the adv reference here so update()'s per-frame loop
      // does O(1) lookup instead of Array.find() over active advs.
      adv,
      expiresAt: this._scene.time.now + lifeMs,
    }

    const room = this._gameState.dungeon?.rooms?.find(r =>
      adv.tileX >= r.gridX && adv.tileX < r.gridX + r.width &&
      adv.tileY >= r.gridY && adv.tileY < r.gridY + r.height
    )
    EventBus.emit('CHAT_BUBBLE_EMITTED', {
      adventurer: adv,
      line,
      roomId: room?.instanceId ?? null,
    })
  }

  _destroyBubble(id) {
    const b = this._bubbles[id]
    if (!b) return
    b.container.destroy()
    delete this._bubbles[id]
  }

  // ── Line selection ────────────────────────────────────────────────────────

  _pickLine(adv) {
    const byClass       = this._lines.byClass       ?? {}
    const byPersonality = this._lines.byPersonality ?? {}
    const fourthWall    = this._lines.fourthWall    ?? []

    // Small chance for a fourth-wall line regardless of class/personality
    if (fourthWall.length && Math.random() < FOURTH_WALL_CHANCE) {
      return fourthWall[Math.floor(Math.random() * fourthWall.length)]
    }

    const personalityLines = (adv.personalityIds ?? [])
      .flatMap(p => byPersonality[p] ?? [])
    const classLines = byClass[adv.classId] ?? byClass.default ?? []

    let pool = []
    if (personalityLines.length && Math.random() < 0.6) pool = personalityLines
    else pool = classLines

    if (!pool.length) pool = classLines.length ? classLines : (byClass.default ?? ['...'])
    return pool[Math.floor(Math.random() * pool.length)]
  }

  _pickEventLine(eventKey) {
    if (!this._lines) this._lines = this._scene.cache.json.get('chatLines') ?? {}
    const pool = this._lines.byEvent?.[eventKey] ?? []
    if (!pool.length) return null
    return pool[Math.floor(Math.random() * pool.length)]
  }
}

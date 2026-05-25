const SAVE_KEY = 'quest_failed_save'
const CURRENT_VERSION = '1.1.0'

export const SaveSystem = {
  save(gameState) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(gameState))
      return true
    } catch (e) {
      console.error('[SaveSystem] Save failed:', e)
      return false
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (!raw) return null
      const state = JSON.parse(raw)
      if (!state?.meta?.version) return null
      if (state.meta.version !== CURRENT_VERSION) {
        const migrated = _migrate(state)
        if (!migrated) return null
        return _rehydrateRunHistory(migrated)
      }
      return _rehydrateRunHistory(state)
    } catch (e) {
      console.error('[SaveSystem] Load failed:', e)
      return null
    }
  },

  hasSave() {
    return localStorage.getItem(SAVE_KEY) !== null
  },

  deleteSave() {
    localStorage.removeItem(SAVE_KEY)
  },
}

function _migrate(state) {
  // Future migration logic goes here as save format evolves.
  // Return null to discard saves that cannot be migrated cleanly.
  console.warn('[SaveSystem] Version mismatch — save discarded. Was:', state?.meta?.version)
  return null
}

// Phase 31I — backfill run-history fields on saves that predate the UI overhaul.
// Old saves stay version='1.0.0'; we just fill in any missing keys with safe
// defaults so the new HUD/Game Over consumers don't blow up reading them.
// Mutates and returns the same state object.
function _rehydrateRunHistory(state) {
  if (!state) return state

  state.history ??= { days: [], events: [] }
  state.history.days   ??= []
  state.history.events ??= []
  state.history.pacts  ??= []

  state.run ??= { startedAt: Date.now(), totals: {} }
  state.run.totals ??= {}
  const t = state.run.totals
  t.kills            ??= 0
  t.dmgDealt         ??= 0
  t.dmgTaken         ??= 0
  t.advsKilled       ??= 0
  t.advsEscaped      ??= 0
  t.gold             ??= 0
  t.souls            ??= 0
  t.roomsBuilt       ??= 0
  t.roomsDestroyed   ??= 0
  t.minionsSummoned  ??= 0
  t.minionsLost      ??= 0
  t.trapsPlaced      ??= 0
  t.trapsDisarmed    ??= 0

  if (Array.isArray(state.minions)) {
    for (const m of state.minions) {
      m.lifetime ??= { kills: 0, damageDealt: 0 }
      m.lifetime.kills        ??= 0
      m.lifetime.damageDealt  ??= 0
    }
  }

  // Dungeon-event scheduler slice (added 2026-05-05). Older saves predate
  // the EventSystem; safe defaults let the system schedule the first event
  // fresh on next NIGHT_PHASE_BEGAN.
  state.events ??= { nextEventDay: null, lastEventId: null, scheduledId: null }
  state.events.nextEventDay ??= null
  state.events.lastEventId  ??= null
  state.events.scheduledId  ??= null

  state.adventurers ??= { active: [], known: [], graveyard: [] }
  state.adventurers.known ??= []
  for (const a of state.adventurers.known) {
    a.escapeCount ??= 0
  }
  // active/graveyard advs may also lack escapeCount (per-instance field)
  for (const a of (state.adventurers.active   ?? [])) a.escapeCount ??= 0
  for (const a of (state.adventurers.graveyard ?? [])) a.escapeCount ??= 0

  // Strip transient `_xUntil` timestamps and one-shot flags. These are
  // stamped against scene.time.now (resets to 0 each scene-load), so any
  // saved buff would phantom-stay-active until scene time catches up to
  // the old wall-clock value. Cleanest fix: drop them on load and let the
  // owning systems re-arm fresh.
  const ADV_TRANSIENT_KEYS = [
    // Class-ability windows
    '_summonGateUntil', '_focusActiveUntil', '_innerPeaceUntil',
    '_boneArmorUntil', '_invisibilityUntil', '_twitchEffectUntil',
    '_arcaneBurstQueued', '_madnessTargetId', '_wanderingGateCooldownDay',
    // Knight + Bard buff windows — same scene.time-stamped contract;
    // a saved value lingers as "in the future" after load and keeps
    // the buff active until the new scene's clock catches up.
    '_auraActiveUntil', '_tauntActiveUntil',
    '_inspireActiveUntil', '_songSpeedActiveUntil',
    // Cheater class ability windows + per-tick state. _aimhackUntil
    // gates the per-attack instakill roll; _speedhackUntil gates the
    // 2× movement burst; _lagStunUntil freezes movement after a lag
    // spike. All scene.time-stamped — drop on load so the cheater
    // doesn't load with a permanently-active aimbot window.
    '_aimhackUntil', '_speedhackUntil', '_lagStunUntil',
    '_lastReportFloaterAt',
    // Boss-archetype timed effects
    '_petrifiedUntil', '_fearAttackUntil', '_charmedAt',
    '_charmedAloneTimer', '_charmedAtkAcc', '_charmedPathAt',
    '_lootingUntil', '_gloatUntil', '_spawnFadeEnd', '_leaveFadeEnd',
    // AI tracking — scene-time based. `lastAttackAt` (no underscore) is
    // the real cooldown gate written by CombatSystem; a saved value from
    // the previous session's scene clock makes `now - lastAttackAt`
    // huge-negative on load → CombatSystem._tryAttack returns null
    // forever → adv stops swinging.
    'lastAttackAt', '_waitMs', '_tileStuckMs', '_hardStuckMs',
    '_oscNextAt', '_blightAcc', '_antiMagicNextPulseAt',
    '_fearPanicDeathTriggered', '_fearAttackArmed',
    '_fearFleeTriggered',
    // Retaliation lock (mirrors the minion fix). `_lastHitAt` is
    // scene.time-stamped; on load it'd appear "in the future" and
    // every adv would think it was just hit, jumping to retaliate on
    // a possibly-gone source.
    '_lastHitAt', '_lastHitBy', '_lastHitType',
    // Other AI-tick scene-time fields that surfaced in the audit —
    // each was used as `if (now < adv._xxxUntil)` so a saved future
    // timestamp keeps the effect active longer than intended.
    '_scatterUntil', '_warnedUntil', '_lastAvoidTrapAt', '_lastWarnAt',
    '_lastTameAt',
    // Anti-magic / silence
    '_provoked', '_invisible',
    // Tower Tax leak we already fixed via DAY_PHASE_STARTED reset, but
    // strip on load too so cross-save legacy state is clean.
    '_towerTaxFirstShotConsumed',
    // Per-target VFX throttle stamps (CombatFeedback / HitSparkSystem) —
    // scene.time.now timestamps. A saved future stamp from the previous
    // session would block every floating-damage number and spark for
    // the rest of the day post-load.
    '_fbAt', '_sparkAt',
  ]
  for (const a of (state.adventurers.active ?? [])) {
    for (const k of ADV_TRANSIENT_KEYS) if (k in a) delete a[k]
  }

  // Same treatment for minions — was a known freeze cause (loaded
  // minions stuck in perma-retaliate because `_lastHitAt` was a
  // scene-time stamp from the previous session, now far in the
  // future relative to the new scene's `time.now = 0`).
  const MIN_TRANSIENT_KEYS = [
    // `lastAttackAt` (no underscore) is the real cooldown gate written
    // by CombatSystem._tryAttack; without stripping, a saved scene-time
    // stamp makes the minion stop attacking after load and pins
    // MinionRenderer's wantState to 'attack' so the sprite freezes on
    // the attack anim's last frame.
    'lastAttackAt',
    '_lastClericHealAt',
    '_raisedBardBuffUntil',
    '_doorPatLastCp',           // patroller door state — re-derives at runtime
    '_tameTargetedAt',          // Beast Master scene-time stamp; ClassAbilitySystem re-arms
    '_tameTargetedBy',
    // Retaliation lock (was missing — main minion-freeze cause)
    '_lastHitAt', '_lastHitBy',
    // Per-target VFX throttle stamps (CombatFeedback / HitSparkSystem) —
    // see ADV_TRANSIENT_KEYS for the same rationale.
    '_fbAt', '_sparkAt',
  ]
  for (const m of (state.minions ?? [])) {
    for (const k of MIN_TRANSIENT_KEYS) if (k in m) delete m[k]
    // Wipe in-flight pathing / targeting so AI rebuilds from current
    // tile state. Cheap and avoids dangling references to entities
    // that may have been culled between save and load.
    if ('_patrolTarget' in m)  m._patrolTarget  = null
    if ('_chasePath'    in m)  m._chasePath     = null
    if ('_wasChasingFlee' in m) m._wasChasingFlee = false
    // Held-by-player flag — set during room pickup, cleared on drop.
    // If autosave caught a held room, minions would stay frozen
    // (MinionAISystem.update returns early on _heldByPlayer = true).
    if ('_heldByPlayer' in m) m._heldByPlayer = false
  }

  // Boss pact-ability cooldowns — same scene.time contract as the
  // adv/minion lists above. Every `_xxxReadyAt` / `_xxxUntil` /
  // `_xxxNextTick` on the boss is stamped with `scene.time.now + N`;
  // a saved value appears far-future on the next load (new scene's
  // time starts at 0), which locks every pact ability "on cooldown"
  // until wall-clock catches up — so the boss stops using Hellfire /
  // Soul Drain / Doppelgangers / Petrify / etc. and just stands
  // there. Strip the lot. Permanent fields on the boss (hp / level /
  // lives / ability flags) are untouched.
  const BOSS_TRANSIENT_KEYS = [
    '_hellfireReadyAt', '_hellfireWindupUntil',
    '_lightningReadyAt',
    '_shockwaveReadyAt', '_shockwaveStunUntil',
    '_spectralReadyAt',
    '_vortexReadyAt',
    '_soulDrainReadyAt', '_soulDrainChannelUntil', '_soulDrainNextTick',
    '_doppelReadyAt', '_doppelActiveUntil',
    '_petrifyReadyAt', '_petrifyBackfireUntil',
    '_avengerDazeUntil', '_avengerBuffUntil',
  ]
  if (state.boss) {
    for (const k of BOSS_TRANSIENT_KEYS) if (k in state.boss) delete state.boss[k]
  }

  // Traps — same audit. The in-flight per-trap state fields
  // (fuseEndsAt / firedAt / per-victim hitAt map) are all
  // scene-time stamps; loading mid-day with stale values either
  // freezes a trap (fuse "already triggered in the future") or
  // makes it spam-hit (last-hit timestamps stale).
  // Permanent flags (`_disabledThisDay`, `_brandBlessed`) are kept —
  // they're not time-based and represent real per-day state.
  for (const t of (state.dungeon?.traps ?? [])) {
    if (!t.state) continue
    delete t.state.fuseEndsAt
    delete t.state.firedAt
    delete t.state.hitAt
    delete t.state.fuseLit
    // revealed persists (knowledge — spike pit stays revealed for the day).
  }
  // Bombs are one-shot consumables — once `state.exploded` is set the
  // bomb is dead and TrapSystem.detonateBomb should have spliced it from
  // the array. If one ever slips through (older save where a chain-loop
  // throw skipped the splice), it'd render as a zombie sprite that
  // never triggers again. Filter detonated bombs out on load as a
  // backstop so the bug can't survive the fix.
  if (Array.isArray(state.dungeon?.traps)) {
    state.dungeon.traps = state.dungeon.traps.filter(t =>
      !(t?.definitionId === 'bomb' && t?.state?.exploded))
  }

  return state
}

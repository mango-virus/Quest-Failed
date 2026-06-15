import { EventBus } from './EventBus.js'
import { PlayerProfile } from './PlayerProfile.js'

// Per-player save slots (2026-05-29). Every other player-progress key in
// PlayerProfile is already name-scoped as `<base>:<name>` (max boss level,
// companion / achievement unlocks, metrics); the run save was the last global
// holdout. _saveKey() resolves the active player's slot:
//   • NAMED player  → `quest_failed_save:<name>`
//   • UNNAMED player → the bare `quest_failed_save` (identical to the old
//     behaviour, so an existing no-name save keeps working untouched).
// Switching names switches save slots — consistent with how PlayerProfile
// already treats the name as the profile selector.
const SAVE_KEY_BASE   = 'quest_failed_save'
const CURRENT_VERSION = '1.1.0'

function _saveKey() {
  const name = (PlayerProfile.getName?.() ?? '').trim()
  return name ? `${SAVE_KEY_BASE}:${name}` : SAVE_KEY_BASE
}

// One-time, self-guarding migration: a returning NAMED player still has their
// run under the old global key. Move it into their name slot the first time we
// touch storage. The condition can't re-fire once moved (name slot now exists +
// base key removed). Pure no-op for: unnamed players (their slot IS the base
// key), fresh named players (no legacy save to move), and anyone already
// migrated. Also transparently rescues a player who had a no-name save and
// THEN set a name — base → name-slot the moment a name exists.
function _migrateLegacySave() {
  let name
  try { name = (PlayerProfile.getName?.() ?? '').trim() } catch { return }
  if (!name) return
  const nameKey = `${SAVE_KEY_BASE}:${name}`
  if (localStorage.getItem(nameKey) != null) return   // already has a per-name save
  const legacy = localStorage.getItem(SAVE_KEY_BASE)
  if (legacy == null) return                          // nothing to migrate
  try {
    localStorage.setItem(nameKey, legacy)
    localStorage.removeItem(SAVE_KEY_BASE)
  } catch { /* quota — leave legacy in place; the read paths don't depend on the move */ }
}

// Heavy-array caps applied at SAVE time so a deep-day run doesn't
// blow past the ~5 MB localStorage quota. Each cap keeps the MOST
// RECENT N entries — older history is dropped from the save.
// The LIVE gameState in memory is untouched; only the on-disk
// payload is trimmed.
//
// Why this exists: a save at day ~30 with ~36 advs/day was hitting
// QuotaExceededError silently — `localStorage.setItem` throws and
// the catch below used to swallow it, leaving the OLD save in place.
// Result: player quits at day 30, Continue replays day 27 (the last
// successfully-written save). Fix: bound + surface failures.
const CAP_GRAVEYARD       = 500    // ~36 advs/day → ~14 days of corpse history
const CAP_HISTORY_EVENTS  = 200    // dungeon-log ring buffer; matches LOG_MAX in RightPanels
const CAP_HISTORY_DAYS    = 100    // per-day rollup rows
const CAP_HISTORY_PACTS   = 200    // sealed pacts; rarely > 50 in practice
const CAP_KNOWN_ADVS      = 300    // returning-veteran roster
// `knowledge.sharedPool.*` is per-CATEGORY (rooms/traps/minions/items/etc).
// A flee event dumps every observed entity in that adv's knowledge into
// the pool, so on a day-40+ run with 80 advs/day fleeing it can grow
// fast. Cap each category to keep the most recently-leaked entries.
const CAP_SHARED_POOL_PER_CAT = 400

// Aggressive caps applied as a RETRY when the first save still
// busts the quota. Trades more history for fitting on disk —
// always strictly better than silently losing the entire save.
const CAP_RETRY = {
  graveyard:      150,
  historyEvents:  50,
  historyDays:    30,
  historyPacts:   100,
  knownAdvs:      150,
  sharedPoolPerCat: 150,
}

// Build a slimmed JSON payload from the live gameState. The caller's
// gameState object is never mutated — we shallow-copy arrays that
// need trimming and reassign on the cloned wrapper. Smaller fields
// pass through by reference (cheap).
function _buildSavePayload(gameState, caps = null) {
  const C = {
    graveyard:        caps?.graveyard        ?? CAP_GRAVEYARD,
    historyEvents:    caps?.historyEvents    ?? CAP_HISTORY_EVENTS,
    historyDays:      caps?.historyDays      ?? CAP_HISTORY_DAYS,
    historyPacts:     caps?.historyPacts     ?? CAP_HISTORY_PACTS,
    knownAdvs:        caps?.knownAdvs        ?? CAP_KNOWN_ADVS,
    sharedPoolPerCat: caps?.sharedPoolPerCat ?? CAP_SHARED_POOL_PER_CAT,
  }
  // Shallow clone — only the top-level object + the slices we replace
  // need fresh references. The rest stays pointer-identical to the
  // live state, which keeps deep-copy cost off the save hot path.
  const out = { ...gameState }
  if (gameState.adventurers) {
    out.adventurers = { ...gameState.adventurers }
    const gv = gameState.adventurers.graveyard
    if (Array.isArray(gv)) {
      // Strip the bulky per-adv `knowledge` blob from graveyard
      // entries — they're DEAD, the runtime never reads their
      // knowledge again. Each knowledge object can be many KB on a
      // long-lived adv that explored most of the dungeon.
      const stripped = gv.map(_stripDeadAdvBulk)
      out.adventurers.graveyard = stripped.length > C.graveyard
        ? stripped.slice(-C.graveyard)
        : stripped
    }
    const known = gameState.adventurers.known
    if (Array.isArray(known) && known.length > C.knownAdvs) {
      out.adventurers.known = known.slice(-C.knownAdvs)
    }
  }
  if (gameState.history) {
    out.history = { ...gameState.history }
    const ev = gameState.history.events
    if (Array.isArray(ev) && ev.length > C.historyEvents) {
      out.history.events = ev.slice(-C.historyEvents)
    }
    const dys = gameState.history.days
    if (Array.isArray(dys) && dys.length > C.historyDays) {
      out.history.days = dys.slice(-C.historyDays)
    }
    const pcts = gameState.history.pacts
    if (Array.isArray(pcts) && pcts.length > C.historyPacts) {
      out.history.pacts = pcts.slice(-C.historyPacts)
    }
  }
  // Trim the shared knowledge pool — accumulates across every flee, no
  // built-in cap. On a deep-day run with many escapees this can dwarf
  // every other field combined. Each category gets independent trim so
  // the player still loads with USEFUL recent intel; only ancient
  // entries get dropped from the save.
  if (gameState.knowledge?.sharedPool) {
    const pool = gameState.knowledge.sharedPool
    const trimmedPool = {}
    let trimmedAny = false
    for (const key of Object.keys(pool)) {
      const cat = pool[key]
      if (cat && typeof cat === 'object' && !Array.isArray(cat)) {
        const entries = Object.entries(cat)
        if (entries.length > C.sharedPoolPerCat) {
          // Keep the LAST N (Object.entries iteration order is
          // insertion order in modern engines; this loses oldest).
          trimmedPool[key] = Object.fromEntries(entries.slice(-C.sharedPoolPerCat))
          trimmedAny = true
        } else {
          trimmedPool[key] = cat
        }
      } else {
        trimmedPool[key] = cat
      }
    }
    if (trimmedAny) {
      out.knowledge = { ...gameState.knowledge, sharedPool: trimmedPool }
    }
  }
  return out
}

// Auto-rewind a save that's somehow in mid-day state. This should be
// impossible after the night-only save guard (SaveSystem.save() refuses
// when phase === 'day'), but legacy saves written before that guard
// shipped — or any future bug that slips past the guard — could leave
// a player with a broken mid-day save that re-runs the same stuck day
// every reload. Detecting this on load + clearing the transient state
// gives them a guaranteed clean checkpoint.
//
// The mutation:
//   * `meta.phase` → 'night' so the game boots into the build phase.
//   * `adventurers.active` → [] so no stale advs come back to life.
//   * `meta._rewoundOnLoad` flag tagged so Game.create() can fire a
//     SHOW_TOAST after the HUD mounts (the toast subscriber doesn't
//     exist yet at load time — emitting here would be lost).
function _autoRewindIfMidDay(state) {
  if (state?.meta?.phase !== 'day') return
  console.warn('[SaveSystem] Loaded save was in day phase — auto-rewinding to night.')
  state.meta.phase = 'night'
  if (state.adventurers) state.adventurers.active = []
  state.meta._rewoundOnLoad = true
}

// Drop the heaviest transient fields from a graveyard entry so they
// don't bloat the save. Keeps display fields (name, classId, dayDied,
// killerName, etc.) intact for the Graveyard / GameOver readers.
function _stripDeadAdvBulk(adv) {
  if (!adv) return adv
  // Cheap presence check — only clone when there's something to drop.
  if (!adv.knowledge && !adv.path && !adv.pathHistory && !adv.priorPathHistory) {
    return adv
  }
  const slim = { ...adv }
  delete slim.knowledge
  delete slim.path
  delete slim.pathHistory
  delete slim.priorPathHistory
  return slim
}

export const SaveSystem = {
  save(gameState) {
    // Night-only save gate (added 2026-05-27). Saving mid-day captures
    // transient in-flight state (active adventurers, pathfinder caches,
    // half-resolved trap firings, etc.) — if any of that state ends up
    // stuck (looping wave, frozen pathfinder, leaked listener), the
    // save serialises the BROKEN state and reloading drops the player
    // straight back into the broken day with no clean recovery path.
    //
    // By only persisting saves when phase === 'night', the save file
    // always represents a clean checkpoint: no live adventurers, boss
    // ready for tomorrow, dungeon laid out, build phase entered. A
    // beforeunload or pause-save attempted mid-day silently no-ops —
    // the player loses unsaved mid-day progress, but gains a guaranteed
    // recoverable state on reload.
    //
    // Legit save points (NIGHT_PHASE_STARTED, end-of-day after the
    // phase flip, ArchetypeSelect run-start, pact-sealed, intro-
    // dismissed) all run with phase === 'night' so this is a no-op
    // for them. The blocked path is the mid-day beforeunload + the
    // PauseManager / PauseOverlay save when the player paused mid-day.
    if (gameState?.meta?.phase === 'day') {
      return false
    }
    _migrateLegacySave()   // claim the legacy global save into this name's slot before writing
    try {
      const payload = _buildSavePayload(gameState)
      const json = JSON.stringify(payload)
      localStorage.setItem(_saveKey(), json)
      // Verify-after-write — read the stored payload back and confirm
      // the meta we wrote actually landed. Some browsers (Safari
      // private mode, quota-exhausted Chrome under specific paths)
      // can fail setItem silently rather than throwing. Without this
      // check the load path would return a stale earlier save and the
      // player rewinds to an old day on Continue.
      if (!_verifySavedMeta(payload)) {
        throw new Error('save verification failed: written meta does not match read-back meta')
      }
      return true
    } catch (e) {
      // Quota error path — retry with aggressive caps before giving up.
      // QuotaExceededError can appear as e.name === 'QuotaExceededError'
      // (modern), code 22 / 1014 (legacy WebKit / Firefox), or a generic
      // message. Try the retry on ANY save throw so a misdetected quota
      // error doesn't end up silently dropping the save.
      console.warn('[SaveSystem] Save failed on first try, retrying with aggressive trim:', e?.name ?? e)
      try {
        const slim = _buildSavePayload(gameState, CAP_RETRY)
        const json = JSON.stringify(slim)
        localStorage.setItem(_saveKey(), json)
        if (!_verifySavedMeta(slim)) {
          throw new Error('save verification failed on retry')
        }
        console.info('[SaveSystem] Retry succeeded with slim payload — older history trimmed.')
        // Tell the player so they understand why log history dropped.
        try {
          EventBus.emit('SHOW_TOAST', {
            kind:    'leak',
            message: 'Save trimmed: old history dropped (storage full)',
          })
        } catch {}
        return true
      } catch (e2) {
        console.error('[SaveSystem] Save FAILED — storage quota exhausted. The current run will NOT persist past this point.', e2)
        // Surface to the player so they don't think their progress is
        // being saved while it's silently failing. SAVE_FAILED carries
        // structured detail so the pause / quit flow can BLOCK with a
        // modal rather than rely on a fleeting toast.
        try {
          EventBus.emit('SHOW_TOAST', {
            kind:    'leak',
            message: '⚠ SAVE FAILED — storage is full. Progress will not persist.',
          })
          EventBus.emit('SAVE_FAILED', {
            reason: 'quota',
            dayNumber: gameState?.meta?.dayNumber ?? null,
          })
        } catch {}
        return false
      }
    }
  },

  load() {
    _migrateLegacySave()
    try {
      const raw = localStorage.getItem(_saveKey())
      if (!raw) return null
      const state = JSON.parse(raw)
      if (!state?.meta?.version) return null
      let migrated = state
      if (state.meta.version !== CURRENT_VERSION) {
        migrated = _migrate(state)
        if (!migrated) return null
      }
      const ready = _rehydrateRunHistory(migrated)
      if (!ready) return null
      _autoRewindIfMidDay(ready)
      return ready
    } catch (e) {
      console.error('[SaveSystem] Load failed:', e)
      return null
    }
  },

  hasSave() {
    _migrateLegacySave()
    return localStorage.getItem(_saveKey()) !== null
  },

  deleteSave() {
    localStorage.removeItem(_saveKey())
  },
}

// Read the active save slot (_saveKey()) back from localStorage and confirm its meta matches
// the payload we just tried to write. Returns false on any mismatch
// (silent failure, wrong key, parse error). Cheap — only deserialises
// the meta block, not the full payload.
function _verifySavedMeta(payload) {
  try {
    const raw = localStorage.getItem(_saveKey())
    if (!raw) return false
    const stored = JSON.parse(raw)
    const wroteDay = payload?.meta?.dayNumber
    const wrotePhase = payload?.meta?.phase
    const wroteRunId = payload?.meta?.runId
    return (
      stored?.meta?.dayNumber === wroteDay &&
      stored?.meta?.phase     === wrotePhase &&
      stored?.meta?.runId     === wroteRunId
    )
  } catch {
    return false
  }
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
    '_boneArmorUntil', '_invisibilityUntil',
    '_arcaneBurstQueued', '_madnessTargetId', '_wanderingGateCooldownDay',
    // Mage Elemental Arcana — scene.time gates on the per-hit lightning chain /
    // wind shove (a saved future value would suppress them until the clock catches up).
    '_arcLastAt', '_gustLastAt',
    // Knight + Bard buff windows — same scene.time-stamped contract;
    // a saved value lingers as "in the future" after load and keeps
    // the buff active until the new scene's clock catches up.
    '_auraActiveUntil', '_tauntActiveUntil',
    '_inspireActiveUntil', '_songSpeedActiveUntil',
    // Bard Crescendo — stack state + scene.time-stamped build/decay/silence gates
    // + the derived mults. Drop on load so the bard re-builds the hymn fresh.
    '_crescendoStacks', '_crescendoAtkMul', '_crescendoSpdMul',
    '_crescendoNextStackAt', '_crescendoDecayAt', '_crescendoSilencedUntil',
    // Cheater class ability windows + per-tick state. _aimhackUntil
    // gates the per-attack instakill roll; _speedhackUntil gates the
    // 2× movement burst; _lagStunUntil freezes movement after a lag
    // spike. All scene.time-stamped — drop on load so the cheater
    // doesn't load with a permanently-active aimbot window.
    '_aimhackUntil', '_speedhackUntil', '_lagStunUntil',
    '_lastReportFloaterAt',
    // Slime · Plague infection — `_infectUntil` is scene-time-stamped (drives the
    // contagion-spread check); the rest carry the DoT params for the spread.
    '_infectUntil', '_infectDmg', '_infectInterval', '_infectTicks', '_infectSrc',
    // Zombie · Contagion Bite rot — scene-time-stamped; drives reanimation on death.
    '_rotInfectedUntil',
    // Demon · Hellfire heat — `_hellfireAt` is a scene-time stamp; all reset each night.
    '_hellfireStacks', '_hellfireAt', '_hellfireMax',
    // Ghost · Haunt — `_hauntedUntil` is scene-time-stamped (drives the per-tick
    // nerve bleed + contagion + recovery-suppression + attack-fumble); the rest
    // carry the haunt params. All drop on load (the haunt doesn't survive a reload).
    '_hauntedUntil', '_hauntNervePerSec', '_hauntContagionR', '_hauntContagionPS', '_hauntFumbleMul', '_hauntSource',
    // Nerve rework · panic-in-place — `_panickedUntil` is a scene-time stamp (drives the
    // cower freeze + attack-suppress + +50% vuln); drop on load so a hero doesn't load frozen.
    '_panickedUntil', '_panicVfxAt', '_breakingMs',
    // Gnoll BLOOD HUNT — `_bleedUntil`/`_bleedTickAt`/`_noHealUntil` are scene-time stamped;
    // drop on load so a hero doesn't load bleeding / un-healable / with a stale trail anchor.
    '_bleedStacks', '_bleedUntil', '_bleedTickAt', '_bleedPerStack', '_bleedInterval', '_bleedSource',
    '_noHealUntil', '_bloodDripX', '_bloodDripY', '_bleedAuraAt',
    // Boss-archetype timed effects
    '_petrifiedUntil', '_fearAttackUntil', '_charmedAt',
    // Beholder GAZE — `_possessedUntil` (charm→attack-allies) + `_hexUntil`/`_hexVulnMul`
    // (gaze hex vuln) + `_silencedUntil` (Tyrant's Gaze silence ray) are scene-time
    // stamped; drop on load.
    '_possessedUntil', '_hexUntil', '_hexVulnMul', '_silencedUntil',
    // Plant ENTANGLE / generic CC — scene-time root/slow/stagger stamps; a saved
    // future value would freeze or slow an adventurer on load until wall-clock catches up.
    '_rootedUntil', '_staggeredUntil', '_slowUntil', '_slowMult',
    // Mushroom HALLUCINATION — scene-time daze window + whiff chance; drop on load.
    '_dazedUntil', '_dazeMissChance',
    // Myconid THE BLOOM — scene-time spore/bloom DoT tick stamps; drop on load.
    '_bloomLastTickAt', '_sporeLastTickAt',
    // Lizardman THE PLAGUE-BEARER — scene-time plague DoT tick stamp; drop on
    // load (`_plagueStacks` persists — the infection lingers all run).
    '_plagueTickAt',
    // Succubus THE RAPTURE — enrapture/lure tint windows (the freeze/hex/charm
    // fields they ride on are already stripped above).
    '_raptureUntil', '_luredUntil',
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
    // False Exit re-trigger cooldown — scene.time-stamped; a saved
    // future value would block the teleport until the new clock catches
    // up. Drop on load.
    '_falseExitTpAt',
    // Healing Fountain blessing — _fountainBlessUntil gates the per-tick
    // regen and _fountainTouchAt gates the instant re-heal; both are
    // scene.time-stamped, so a saved value lingers as "in the future"
    // after load (regen would phantom-heal until the clock catches up).
    // _fountainRegenAcc is just a sub-1 carry float — reset it too.
    '_fountainBlessUntil', '_fountainTouchAt', '_fountainRegenAcc',
    // Goblin Mark for Plunder — scene.time-stamped brand window + its bleed
    // accumulator; a saved future value would phantom-bleed gold on load.
    '_plunderUntil', '_plunderBleedAccum', '_plunderMarkSteal',
    '_plunderBleedGold', '_plunderBleedMs', '_plunderSrcRoom',
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
    // Anti-ping-pong watchdog + AI-diag overlay fields (2026-05-27). All
    // scene.time.now-stamped — a saved value carries forward as a huge
    // future timestamp after load (visible as `t=-1229.1s` in the F4
    // overlay), which keeps panic-walk active forever and freezes the
    // progress baseline so the watchdog never re-arms. _exploreStreak is
    // a plain counter but also reset on load so a saved mid-cycle adv
    // gets a fresh shot at exploring the post-load dungeon.
    '_loopGoalKey', '_loopBestDist', '_loopBestAt', '_panicWalkUntil',
    '_diagLastGoal', '_lastDiagAt', '_exploreStreak',
    // Position-stagnation watchdog anchor (independent of the pathTarget
    // watchdog — catches goal-flip ping-pong around chokepoints/traps
    // where pathTarget changes faster than position does). _stagAnchorAt
    // is scene.time-stamped so it MUST strip; the X/Y are just stale
    // anchor coords that should rebuild from the adv's post-load tile.
    '_stagAnchorX', '_stagAnchorY', '_stagAnchorAt',
    // New-class abilities (2026-06-03). All scene.time-stamped windows or
    // in-flight sequence state. A saved value phantom-freezes the owner on
    // load — most dangerously a Miner saved mid-Tunnel, who would reload
    // hidden underground + movement-frozen forever, or a Valkyrie saved
    // mid-cast (stuck channelling). Drop them so the systems re-arm fresh.
    //   Gladiator — Block window + Crowd Roar stacks + mob flag + fx throttles
    '_blockActiveUntil', '_crowdRoarStacks', '_mobActive',
    '_blockSparkNextAt', '_blockFloatNextAt',
    //   Peasant — mob VFX throttle stamps (scene.time-stamped)
    '_peasantShoutAt', '_peasantDustAt',
    //   Gambler — Roll-the-Dice per-swing cooldown stamp (a saved future value
    //   suppresses the dice proc until the new clock catches up).
    '_diceRollReadyAt',
    //   Valkyrie — Rally channel / approach state + the shared cast-freeze gate
    '_castingUntil', '_rallyChannelUntil', '_rallyTargetId',
    '_rallyApproachId', '_rallyApproachTile',
    //   Miner — Tunnel startup gate + the multi-phase dig/underground sequence
    '_tunnelGateUntil', '_tunnelPhase', '_tunnelDig', '_underground',
    '_tunnelDigUntil', '_tunnelEmergeAt', '_tunnelDeadline', '_tunnelNextFx',
    //   Barbarian — Reckless Charge wind-up/dash sequence (scene.time stamps +
    //   one-shot phase state; a saved value would freeze him mid-charge on load).
    '_chargePhase', '_chargeTarget', '_chargeFrom', '_chargeWindupUntil',
    '_chargeDashStart', '_chargeDashUntil', '_chargeDashFrom', '_chargeDashTo',
    '_chargeEndTile',
    // Beast Master Pack Tactics — scene-time throttle for the flank-glint VFX.
    '_packFlankAt',
    //   AI overhaul — nerve morale-break accumulator + room-appraisal threshold
    //   beat + party confer huddle (scene.time-stamped freeze/creep/cooldown gates;
    //   a saved future value would freeze/slow the adv until the new clock catches
    //   up). NOTE: nerve/mood/_nerveSeeded are intentionally NOT stripped — morale
    //   persists across Continue.
    '_breakingMs', '_appraisingUntil', '_creepUntil', '_conferUntil', '_lastConferAt',
    // Elder Lich THE WITHERING — Channel Souls DoTs (scene-time stamped). A saved
    // future value would phantom-rot / keep a hero caged after load. (_noHealUntil
    // + _petrifiedUntil are already stripped above.)
    '_witherUntil', '_witherTickAt', '_soulCagedUntil', '_soulCageTickAt',
  ]
  for (const a of (state.adventurers.active ?? [])) {
    for (const k of ADV_TRANSIENT_KEYS) if (k in a) delete a[k]
    // The Miner Tunnel + Valkyrie Rally sequence state is stripped above, but the
    // GOAL that drove it persists. With the driver state gone (and the once/day
    // ability already spent) the consider-tick won't restart the sequence, so an
    // orphaned TUNNEL_DIG / RALLY_APPROACH goal would walk the adv to a dead tile.
    // Clear it so they re-pick a normal goal on the next AI tick.
    if (a?.goal?.type === 'TUNNEL_DIG' || a?.goal?.type === 'RALLY_APPROACH') {
      a.goal = null
      a.path = null
    }
  }

  // Day-42 SEEK_TREASURE ping-pong recovery (2026-05-27). A bug report
  // showed advs cycling indefinitely between two unopened chests because
  // every `_pickNextGoal` re-roll could flip the temptPct winner. The
  // fix landed in AISystem (sticky chest pick + per-day repick budget),
  // but EXISTING saves still have advs mid-cycle. Pre-charging
  // `_chestSeekCount` to the cap means: the adv keeps their current
  // SEEK_TREASURE attempt (one fair try at finishing the open they were
  // already walking toward), but any interrupt-and-repick after this
  // load short-circuits the chest pull → they fall through to normal
  // goal selection and the loop breaks. Keep this MAX in sync with
  // MAX_CHEST_SEEKS_PER_DAY in src/systems/AISystem.js.
  const MAX_CHEST_SEEKS_PER_DAY_LOAD = 3
  for (const a of (state.adventurers.active ?? [])) {
    if (a?.goal?.type === 'SEEK_TREASURE') {
      a._chestSeekCount = MAX_CHEST_SEEKS_PER_DAY_LOAD
    }
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
    // Generic CC stamps — minions can now be staggered/rooted/slowed (Barbarian
    // Reckless Charge knockback + future CC). Scene.time-stamped; a saved future
    // value would freeze a minion on load until the clock catches up. (Dawn reset
    // also clears these, but strip on mid-day save/load for correctness.)
    '_staggeredUntil', '_rootedUntil', '_slowUntil', '_slowMult',
  ]
  for (const m of (state.minions ?? [])) {
    for (const k of MIN_TRANSIENT_KEYS) if (k in m) delete m[k]
    // Wipe in-flight pathing / targeting so AI rebuilds from current
    // tile state. Cheap and avoids dangling references to entities
    // that may have been culled between save and load.
    if ('_patrolTarget' in m)  m._patrolTarget  = null
    if ('_chasePath'    in m)  m._chasePath     = null
    if ('_wasChasingFlee' in m) m._wasChasingFlee = false
    // Skeleton Reassemble — `_reassembleAt` is a scene-time stamp; a saved
    // future value would freeze a mid-collapse skeleton as a permanent corpse
    // after load. Clear the collapse so it loads either whole or truly dead.
    if ('_reassembleAt' in m)  m._reassembleAt  = null
    if ('_reassembling' in m)  m._reassembling  = false
    // Zombie Reanimation — `_reanimRiseAt`/`_reanimFadeFrom` are scene-time stamps.
    // A Risen saved mid-decay would freeze as a corpse on load (stale future stamp),
    // so finish the reanimation immediately: stand it up at full HP.
    if ('_reanimRiseAt' in m) {
      if (m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) {
        m.aiState = 'idle'
        if (m.resources) m.resources.hp = m.resources.maxHp ?? m.stats?.hp ?? 1
      }
      m._reanimRiseAt = null
    }
    if ('_reanimFadeFrom' in m) m._reanimFadeFrom = null
    if ('_reassembleRapidUntil' in m) m._reassembleRapidUntil = 0  // scene-time stamp (Undying Legion window)
    if ('_boneShellUntil' in m)       m._boneShellUntil       = 0  // scene-time stamp (bone-armor shell)
    // Orc Veteran TROPHY HUNTER — Mastery aura. The buffed stats are persisted;
    // restore the captured baselines + clear them so the aura re-applies fresh
    // on the next tick (mirrors the Warband / Bloodlust baseline contract).
    if (m._masteryBaseAtk != null)   { if (m.stats) m.stats.attack  = m._masteryBaseAtk;  m._masteryBaseAtk  = null }
    if (m._masteryBaseDef != null)   { if (m.stats) m.stats.defense = m._masteryBaseDef;  m._masteryBaseDef  = null }
    if (m._masteryBaseRange != null) { m.attackRange = m._masteryBaseRange; m._masteryBaseRange = null }
    // Myconid THE BLOOM — symbiosis ATK buff. Restore the captured baseline so
    // the +ATK doesn't bank into the saved stat; it re-applies on the next tick
    // while the minion stands in a bloomed room.
    if (m._bloomBaseAtk != null) { if (m.stats) m.stats.attack = m._bloomBaseAtk; m._bloomBaseAtk = null }
    if ('_bloomApplied' in m) m._bloomApplied = false
    if ('_bloomTickAt' in m)  m._bloomTickAt  = 0
    // Demon Infernal Ascendance — restore the captured ATK baseline (re-applies
    // on the next tick while Brimstone is near cap).
    if (m._ascendBaseAtk != null) { if (m.stats) m.stats.attack = m._ascendBaseAtk; m._ascendBaseAtk = null }
    if ('_ascendApplied' in m) m._ascendApplied = false
    // Orc Warpath — restore base speed + clear the scene-time rampage window.
    if (m._rampageBaseSpeed != null && m.stats) m.stats.speed = m._rampageBaseSpeed
    if ('_rampageUntil' in m)     m._rampageUntil     = 0
    if ('_rampageBaseSpeed' in m) m._rampageBaseSpeed = null
    if ('_bloodlustAt' in m)      m._bloodlustAt      = 0  // scene-time stamp; stacks lazily reset
    // Vampire Bloodgorge — blood-shield is a transient combat buff; `_bloodShieldAt`
    // is a scene-time stamp. Drop both so a loaded vampire starts unshielded.
    if ('_bloodShield' in m)      m._bloodShield      = 0
    if ('_bloodShieldAt' in m)    m._bloodShieldAt    = 0
    // Rat Vermin Tide — restore base speed + clear the scene-time frenzy window.
    if (m._swarmFrenzyBaseSpeed != null && m.stats) m.stats.speed = m._swarmFrenzyBaseSpeed
    if ('_swarmFrenzyUntil' in m)     m._swarmFrenzyUntil     = 0
    if ('_swarmFrenzyBaseSpeed' in m) m._swarmFrenzyBaseSpeed = null
    // Gnoll BLOOD HUNT bloodhound sprint — restore base speed + clear the scent/sprint state.
    if (m._sprintBaseSpeed != null && m.stats) m.stats.speed = m._sprintBaseSpeed
    if ('_sprintBaseSpeed' in m)  m._sprintBaseSpeed  = null
    if ('_bloodScent' in m)       m._bloodScent       = false
    if ('_huntSprinting' in m)    m._huntSprinting    = false
    if ('_forceScentUntil' in m)  m._forceScentUntil  = 0
    // Golem Warden Bastion — scene-time DR window; clears each night.
    if ('_bastionUntil' in m) m._bastionUntil = 0
    // Ghost Dread — scene-time projected-fear stamp (drives the renderer's reactive
    // seethe); null so a loaded ghost starts at a quiet idle drift until it ticks again.
    if ('_dreadAt' in m)     m._dreadAt     = 0
    if ('_dreadFearK' in m)  m._dreadFearK  = 0
    // Beholder Gaze — scene-time eye-blaze flash stamp (renderer Glow); clears on load.
    if ('_gazeFlashUntil' in m) m._gazeFlashUntil = 0
    // Ent Thornburst — scene-time thorns-amplify window; clears each night.
    if ('_thornsAmpUntil' in m) m._thornsAmpUntil = 0
    // Blood Briar — scene-time well-fed glow stamp; clears each night.
    if ('_briarFedUntil' in m) m._briarFedUntil = 0
    if ('_thornsAmpMul' in m)   m._thornsAmpMul   = 1
    if ('_bastionMul' in m)   m._bastionMul   = 1
    // Lich Soul Harvest — drop the scene-time Soul Conduit ally-share window
    // (_souls itself is a plain count and persists as wave progress). If the
    // save caught a phylactery-bound lich mid-resurrection (dead + pending),
    // finish the revive on load rather than leaving it a stuck corpse.
    if ('_soulShareUntil' in m) m._soulShareUntil = 0
    // Lizardman Camouflage — restore the hidden-speed base + drop the scene-time
    // reveal stamp (a saved future stamp would freeze the re-camo timer). The
    // `_camouflaged` flag itself persists (the stalker stays hidden across a load).
    if (m._camoBaseSpeed != null && m.stats) { m.stats.speed = m._camoBaseSpeed; m._camoBaseSpeed = null }
    if ('_revealedAt' in m) m._revealedAt = 0
    // Imp Blink — scene-time cooldown/frenzy windows; clear so a load doesn't freeze them.
    if ('_blinkAt' in m) m._blinkAt = 0
    if ('_flickerAt' in m) m._flickerAt = 0
    if ('_blinkFrenzyUntil' in m) m._blinkFrenzyUntil = 0
    if (m._phylacteryReviveAt != null) {
      if ((m.aiState === 'dead' || (m.resources?.hp ?? 0) <= 0) && m.resources) {
        const maxHp = m.resources.maxHp ?? m.stats?.hp ?? 1
        m.resources.hp = Math.max(1, Math.round(maxHp * (m._phylacteryFrac ?? 0.5)))
        m.aiState = 'idle'
      }
      m._phylacteryReviveAt = null
    }
    // Held-by-player flag — set during room pickup, cleared on drop.
    // If autosave caught a held room, minions would stay frozen
    // (MinionAISystem.update returns early on _heldByPlayer = true).
    if ('_heldByPlayer' in m) m._heldByPlayer = false
  }

  // Phylactery scene-time fields — same family as `lastAttackAt` on
  // minions/advs. `_lastTickAt` is stamped against scene.time.now and
  // gates the LICH_PHYLACTERY_DMG_INTERVAL_MS damage tick; a saved
  // future-stamp keeps `now - _lastTickAt < 800ms` true after load
  // until wall-clock catches up, so the heart silently stops taking
  // damage from hunters even though they're cardinal-adjacent and on
  // HUNT_PHYLACTERY. `_destroyedEmitted` is the one-shot guard around
  // PHYLACTERY_DESTROYED; the live entity should never have it set
  // (gameState.phylactery is nulled on destroy), but strip defensively.
  if (state.phylactery) {
    delete state.phylactery._lastTickAt
    delete state.phylactery._destroyedEmitted
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
    '_vortexReadyAt',
    '_soulDrainReadyAt', '_soulDrainChannelUntil', '_soulDrainNextTick',
    '_doppelReadyAt', '_doppelActiveUntil',
    '_petrifyReadyAt', '_petrifyBackfireUntil',
    '_avengerDazeUntil', '_avengerBuffUntil',
    // Orc Veteran TROPHY HUNTER — Mastery aura snapshot + throne-fight buffs.
    // `trophies` (the claimed arsenal) is PERMANENT and intentionally kept; only
    // these recomputed/transient fields are dropped. `_orcMastery` re-derives on
    // the next BossArchetypeSystem tick; `_lastStand`/`_braceUntil` are per-fight.
    '_orcMastery', '_orcMasteryActive', '_lastStand', '_braceUntil',
    // Golem Bulwark — scene-time damage-reduction window (fight-only).
    '_bulwarkUntil',
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
  for (const t of (state.dungeon?.traps ?? []) ) {
    // Top-level scene.time fire-cooldown on LOS / area traps — without
    // stripping, a saved future timestamp keeps the trap "still cooling
    // down" forever after reload (it never fires again until the new
    // scene clock catches up).
    delete t.cooldownUntil
    if (!t.state) continue
    delete t.state.fuseEndsAt
    delete t.state.firedAt
    delete t.state.hitAt
    delete t.state.fuseLit
    // Per-entity 4-second damage lockout. ALSO scene.time-stamped — a
    // saved value from the previous session is "in the future" relative
    // to the new scene clock, so _hitEntity's `if (now < cd) return false`
    // gate makes the trap silently stop damaging that adv (or every adv
    // that was hit before save). Match the same pattern as `hitAt` above.
    delete t.state.advDmgCooldownUntil
    // Throttle stamp for TRAP_TRIGGERED announces (every 2s). Stale
    // future value would block the trap from announcing itself on
    // first fire after reload.
    delete t.state._lastAnnounce
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

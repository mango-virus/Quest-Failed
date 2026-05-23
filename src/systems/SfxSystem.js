// Centralised sound-effects dispatcher.
// Subscribes to EventBus events and plays the matching one-shot SFX.
// SFX volume is independent of the music slider.
//
// Rules:
//   • Every SFX plays once per trigger (no looping).
//   • Death and take-damage sounds are rate-limited so rapid multi-kills
//     don't stack into a wall of noise.
//   • COMBAT_HIT dispatches class-specific attack sounds by looking up
//     the source unit's classId in gameState.
//   • playError() is a public method called directly by NightPhase for
//     placement failures (no EventBus round-trip needed there).

import { EventBus }   from './EventBus.js'
import { SfxVolume } from './SfxVolume.js'

// Per-sound volume table.  Values derived from measured peak/RMS levels:
//   take damge.wav  → -1.8 dBpk / -20.6 dBrms  (reference = 0.70)
//   Sounds louder than reference are turned down; quieter ones are boosted.
//   MP3s without direct measurement are estimated by type/context.
const SFX_VOLUMES = {
  // ── Combat ────────────────────────────────────────────────────────────
  'sfx-take-damage':    0.70,   // reference  (-1.8pk / -20.6rms) — minions/boss only
  'sfx-human-hit-1':    0.78,   // adventurer hurt — WAV estimate
  'sfx-human-hit-2':    0.78,
  'sfx-human-hit-3':    0.78,
  'sfx-human-die-1':    0.82,   // adventurer death — WAV estimate
  'sfx-human-die-2':    0.82,
  'sfx-melee-1':        0.95,   // very transient (-13.1pk / -36.5rms) — needs punch
  'sfx-melee-2':        0.95,   // very transient (-14.7pk / -38.5rms)
  'sfx-monk-1':         0.88,   // (-11.2pk / -28.1rms)
  'sfx-monk-2':         0.88,   // (-11.9pk / -28.8rms)
  'sfx-archer-shoot':   0.82,   // MP3 estimate
  'sfx-mage-attack':    0.88,   // (-13.1pk / -24.2rms)
  'sfx-beholder-beam':  0.80,   // MP3 estimate
  'sfx-boss-attack':    0.82,   // MP3 estimate
  'sfx-death':          0.75,   // (-8.9pk / -20.6rms)

  // ── Boss ──────────────────────────────────────────────────────────────
  'sfx-boss-death':     0.95,   // (-12.7pk / -26.6rms) — major moment

  // ── Abilities ─────────────────────────────────────────────────────────
  'sfx-cleric-heal':    0.90,   // (-13.6pk / -26.2rms)
  'sfx-revive':         0.58,   // (-0.2pk / -15.3rms) — louder than ref, trim down
  'sfx-necro-summon':   0.85,   // MP3 estimate

  // ── Doors ─────────────────────────────────────────────────────────────
  'sfx-door-open':      0.80,   // MP3 estimate
  'sfx-close-door':     0.75,   // (-6.4pk / -25.6rms)
  'sfx-door-unlock':    0.46,   // 8-bit (-0.5pk / -16.4rms) — very loud, reduce
  'sfx-break-door':     0.52,   // (-0.2pk / -15.1rms) — loud, reduce

  // ── Environment ───────────────────────────────────────────────────────
  'sfx-chest-open':     0.82,   // MP3 estimate
  'sfx-teleport':       0.90,   // (-13.6pk / -25.8rms)

  // ── Resources ─────────────────────────────────────────────────────────
  'sfx-collect-gold':   0.95,   // (-13.0pk / -26.8rms) — satisfying, boost it

  // ── Phase transitions ─────────────────────────────────────────────────
  'sfx-day-start':      0.82,   // (-18.6pk / -21.3rms)
  'sfx-day-end':        0.80,   // (-10.4pk / -22.0rms)

  // ── Building / night phase ────────────────────────────────────────────
  'sfx-remove-room':    0.95,   // (-19.7pk / -26.7rms) — quietest WAV, boost
  'sfx-error':          0.58,   // (-2.8pk / -17.5rms) — loud, reduce
  'sfx-dark-pact':      0.92,   // (-14.8pk / -28.4rms) — quiet, dramatic

  // ── Score countup (looping) ───────────────────────────────────────────
  'sfx-score-countup':  0.55,   // sits in background while numbers tally

  // ── Notifications / progression ───────────────────────────────────────
  'sfx-boss-levelup':   0.85,   // boss level-up screen — WAV estimate
  'sfx-event-notif':    0.80,   // event notification pop-in — MP3 estimate
  'sfx-scrub-intel':    0.78,   // intel scrubbed via Knowledge Map — WAV estimate
  'sfx-minion-levelup': 0.82,   // minion level-up / evolution — WAV estimate
}

// Fallback for any key not in the table.
const SFX_DEFAULT_VOL = 0.70

// Global SFX boost applied on top of the per-sound table + master slider,
// clamped to Phaser's 1.0 ceiling. Bumps quiet sounds (revive 0.58, error
// 0.58, score-countup 0.55, etc.) toward audibility when the master slider
// is near max. The originally-loud ones simply hit the cap.
const SFX_BOOST = 1.5

// ── Window-focus tracking ───────────────────────────────────────────────────
// SFX fired while the game window/tab is in the background are dropped, not
// queued. When the page loses focus the browser suspends the WebAudio clock,
// but the still-running simulation keeps triggering combat/event sounds —
// each one gets scheduled against that frozen clock and they all release in
// one burst the instant the player clicks back in. Dropping them at the
// source keeps the return quiet (the player already hears nothing while
// away — they just shouldn't get the backlog).
//
// Pure event-driven (no `document.hasFocus()` — it reports false in some
// automated/embedded contexts and would wrongly mute a focused game).
// Starts true: the game normally loads focused. Registered once at module
// load; the flag is process-global, not per-scene.
let _pageHasFocus = true
if (typeof window !== 'undefined') {
  window.addEventListener('blur',  () => { _pageHasFocus = false })
  window.addEventListener('focus', () => { _pageHasFocus = true })
  if (typeof document !== 'undefined') {
    // Belt-and-suspenders for minimize / tab-switch cases where 'blur' may
    // not fire. Becoming visible again re-fires a window 'focus', which
    // restores the flag — so only the hidden→true transition is handled here.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) _pageHasFocus = false
    })
  }
}

export class SfxSystem {
  constructor(scene, gameState) {
    this._scene     = scene
    this._gameState = gameState

    // Alternating indices for sounds that cycle between two variants.
    this._meleeAlt      = 0
    this._monkAlt       = 0
    this._bossAttackAlt = 0

    // Rate-limit timestamps (ms) — prevents the same sound stacking when
    // many events fire in the same frame.
    this._lastDeathAt      = 0
    this._lastTakeDamageAt = 0
    this._lastGoldAt       = 0
    this._lastSellAt       = 0
    this._lastTrapAt       = 0
    this._lastEvolvedAt    = 0
    this._lastHumanHitAt   = 0
    this._lastHumanDieAt   = 0

    // Day number of the most recent event-notification SFX — only the
    // first event notification each day gets a sound.
    this._lastEventNotifDay = -1

    this._handlers = []
    this._wire()
  }

  // ── Public API ────────────────────────────────────────────────────────────

  // Called directly by NightPhase._showPlacementError().
  playError() { this._play('sfx-error') }

  // ── Wiring ────────────────────────────────────────────────────────────────

  _wire() {
    const on = (evt, fn) => {
      const bound = fn.bind(this)
      EventBus.on(evt, bound)
      this._handlers.push([evt, bound])
    }

    // Combat
    on('COMBAT_HIT',              this._onCombatHit)
    on('BOSS_MELEE_HIT',          this._onBossMeleeHit)

    // Deaths
    on('ADVENTURER_DIED',         this._onAdventurerDeath)
    on('MINION_DIED',             this._onDeath)

    // Boss fight
    on('BOSS_FIGHT_STARTED',      this._onBossFightStarted)
    on('BOSS_FIGHT_RESOLVED',     this._onBossFightResolved)
    on('BOSS_LEVELED_UP',         this._onBossLeveledUp)
    on('SHOW_BOSS_LEVEL_UP',      this._onBossLevelUpScreen)

    // Abilities
    on('ABILITY_TRIGGERED',       this._onAbilityTriggered)
    on('ALLY_HEALED',             this._onAllyHealed)
    on('ADVENTURER_RESURRECTED',  this._onRevive)
    on('MINION_SUMMONED',         this._onNecroSummon)

    // Traps
    on('TRAP_TRIGGERED',          this._onTrapTriggered)

    // Minion level-up / evolution
    on('MINION_LEVELED_UP',       this._onMinionLevelUp)
    on('MINION_EVOLVED',          this._onMinionLevelUp)
    on('MINIBOSS_PROMOTED',       this._onMinibossPromoted)

    // Doors
    on('DOOR_OPENING',            this._onDoorOpened)
    on('DOOR_CLOSED',             this._onDoorClosed)
    on('PHYLACTERY_UNLOCKED',     this._onDoorUnlock)

    // Environment — MIMIC_SPRUNG fires when an adv triggers a disguised
    // mimic; reuses the chest-open SFX since the visual is the same.
    on('MIMIC_SPRUNG',            this._onChestOpen)
    on('WANDERING_GATE_TELEPORTED', this._onTeleport)
    on('FALSE_EXIT_TELEPORTED',   this._onTeleport)
    on('PACT_BOSS_PETRIFY_FIRED', this._onBeholderBeam)

    // Resources
    on('RESOURCES_AWARDED',       this._onResourcesAwarded)

    // Phase transitions
    on('DAY_PHASE_BEGAN',         this._onDayStart)
    on('DAY_PHASE_ENDED',         this._onDayEnd)
    on('NIGHT_PHASE_BEGAN',       this._onNightTransition)

    // Knowledge / dungeon events
    on('KNOWLEDGE_SCRUBBED',      this._onIntelScrubbed)
    on('DUNGEON_EVENT_ANNOUNCED', this._onEventNotif)

    // Night-phase building
    on('ROOM_REMOVED',            this._onSell)
    on('MINION_REMOVED',          this._onSell)
    on('ENTITY_SOLD',             this._onSellGold)
    on('BUILD_ERROR',             this._onBuildError)

    // Dark Pact
    on('SHOW_DARK_PACT',          this._onDarkPact)

    // ── New-HUD-specific cues (Phase 34C.5) ─────────────────────────────
    // Pact sealed (after the player picks a card in PactPicker). Distinct
    // from SHOW_DARK_PACT, which fires when the picker is *about* to open.
    on('PACT_SEALED',             this._onPactSealed)
    // Intel leaked — fires when an adventurer flees with new room intel.
    // Rate-limited so it doesn't stack across rapid leak events.
    on('INTEL_LEAKED',            this._onIntelLeaked)
    // Game-over title burn-in — fires once when the boss runs out of lives.
    on('SHOW_GAME_OVER',          this._onGameOver)
    // Minion bounty posted — the "hunters approach" beat.
    on('MINION_BOUNTY_POSTED',    this._onBountyPosted)
    // The Gambler's Coin cinematic — metallic toss + win/lose sting.
    // The double-or-nothing follow-up reuses the toss sting.
    on('GAMBLER_COIN_FLIP',       this._onCoinFlip)
    on('GAMBLER_DOUBLE_REQUEST',  this._onCoinFlip)
    on('GAMBLER_COIN_REVEALED',   this._onCoinRevealed)
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  _onCombatHit({ sourceId, targetId, damage }) {
    const now = this._now()
    // Hurt sound. Adventurers get Human_Hit (this replaces the generic
    // take-damage cue for advs); minions and the boss keep take-damage.
    // Trap damage routes here too — traps emit COMBAT_HIT per tick.
    if (targetId && this._findAdv(targetId)) {
      this._playHumanHit(damage)
    } else if (now - this._lastTakeDamageAt >= 120) {
      this._lastTakeDamageAt = now
      this._play('sfx-take-damage')
    }

    // Attack sound based on source class. Boss melee has its own handler.
    if (!sourceId || sourceId === 'boss') return
    const adv = this._findAdv(sourceId)
    if (!adv) return

    switch (adv.classId) {
      case 'ranger':
        this._play('sfx-archer-shoot')
        break
      case 'monk':
        this._play(this._monkAlt === 0 ? 'sfx-monk-1' : 'sfx-monk-2')
        this._monkAlt = 1 - this._monkAlt
        break
      case 'mage':
        // Mage fires sfx-mage-attack via ABILITY_TRIGGERED to avoid
        // double-playing on each AoE hit tick.
        break
      default:
        this._play(this._meleeAlt === 0 ? 'sfx-melee-1' : 'sfx-melee-2')
        this._meleeAlt = 1 - this._meleeAlt
    }
  }

  _onBossMeleeHit({ damage } = {}) {
    // Play boss attack sound every other hit to avoid rapid-fire repetition.
    if (this._bossAttackAlt === 0) this._play('sfx-boss-attack')
    this._bossAttackAlt = 1 - this._bossAttackAlt
    // Boss melee always targets an adventurer → Human_Hit.
    this._playHumanHit(damage)
  }

  // Adventurer hurt — picks one of the three Human_Hit variants at random.
  // One sound per hit, with a short anti-stack guard so a mass fight or an
  // AoE tick doesn't machine-gun the cue. Zero-damage hits (dodges) silent.
  _playHumanHit(damage) {
    if (damage != null && damage <= 0) return
    const now = this._now()
    if (now - this._lastHumanHitAt < 80) return
    this._lastHumanHitAt = now
    this._play(`sfx-human-hit-${1 + Math.floor(Math.random() * 3)}`)
  }

  // Minion death. Adventurer death has its own handler (_onAdventurerDeath).
  _onDeath() {
    const now = this._now()
    if (now - this._lastDeathAt < 250) return
    this._lastDeathAt = now
    this._play('sfx-death')
  }

  // Adventurer death — one of the two Human_Die variants at random, with a
  // short anti-stack guard so simultaneous kills don't stack into noise.
  _onAdventurerDeath() {
    const now = this._now()
    if (now - this._lastHumanDieAt < 250) return
    this._lastHumanDieAt = now
    this._play(`sfx-human-die-${1 + Math.floor(Math.random() * 2)}`)
  }

  _onBossFightStarted() {
    this._play('sfx-boss-attack')
  }

  _onBossFightResolved({ winner }) {
    if (winner === 'party') this._play('sfx-boss-death')
  }

  _onBossLeveledUp() {
    this._play('sfx-door-unlock')
  }

  _onTrapTriggered() {
    const now = this._now()
    if (now - this._lastTrapAt < 300) return
    this._lastTrapAt = now
    this._play('sfx-take-damage')
  }

  // Fires for both MINION_LEVELED_UP and MINION_EVOLVED. Shared 500ms guard
  // so a level-up that coincides with an evolution plays one celebration.
  _onMinionLevelUp() {
    const now = this._now()
    if (now - this._lastEvolvedAt < 500) return
    this._lastEvolvedAt = now
    this._play('sfx-minion-levelup')
  }

  _onMinibossPromoted() {
    this._play('sfx-necro-summon')
  }

  _onAbilityTriggered({ abilityId }) {
    if (abilityId === 'arcane_burst') this._play('sfx-mage-attack')
    if (abilityId === 'break_door')   this._play('sfx-break-door')
  }

  _onAllyHealed()    { this._play('sfx-cleric-heal') }
  _onRevive()        { this._play('sfx-revive') }
  _onNecroSummon()   { this._play('sfx-necro-summon') }
  _onDoorOpened()    { this._play('sfx-door-open') }
  _onDoorClosed()    { this._play('sfx-close-door') }
  _onDoorUnlock()    { this._play('sfx-door-unlock') }
  _onChestOpen()     { this._play('sfx-chest-open') }
  _onTeleport()      { this._play('sfx-teleport') }
  _onBeholderBeam()  { this._play('sfx-beholder-beam') }
  _onDayStart()      { this._play('sfx-day-start') }
  _onDayEnd()        { this._play('sfx-day-end') }

  // Night-phase transition — the dark-pact sting doubles as the
  // "night falls, build your dungeon" cue.
  _onNightTransition()  { this._play('sfx-dark-pact') }

  // The boss level-up / ASCENSION screen appeared (EndOfDay → overlay).
  // Distinct from BOSS_LEVELED_UP, which fires mid-day when the level
  // is actually earned.
  _onBossLevelUpScreen() { this._play('sfx-boss-levelup') }

  // Intel scrubbed via the Knowledge Map "SCRUB INTEL" button. Fires on
  // KNOWLEDGE_SCRUBBED — emitted only on a successful (paid) scrub.
  _onIntelScrubbed()    { this._play('sfx-scrub-intel') }

  // First dungeon-event notification of the day. EventSystem can announce
  // more than one event in a day; only the first gets the cue.
  _onEventNotif({ day } = {}) {
    const d = day ?? this._gameState?.meta?.dayNumber ?? 0
    if (d === this._lastEventNotifDay) return
    this._lastEventNotifDay = d
    this._play('sfx-event-notif')
  }
  _onSell() {
    const now = this._now()
    if (now - this._lastSellAt < 300) return
    this._lastSellAt = now
    this._play('sfx-remove-room')
  }

  // Gold-pickup chime layered on top of the remove-room sound when a sell
  // refunds gold. Shares the `_lastGoldAt` rate-limit with kill payouts so
  // a room sale (which fires ENTITY_SOLD per contained entity + once for
  // the room) plays the chime once, not a burst.
  _onSellGold({ refund } = {}) {
    if (!refund || refund <= 0) return
    const now = this._now()
    if (now - this._lastGoldAt < 400) return
    this._lastGoldAt = now
    this._play('sfx-collect-gold', 3.0)
  }
  _onBuildError()    { this._play('sfx-error') }
  _onDarkPact()      { this._play('sfx-dark-pact', 3.5) }

  _onPactSealed() {
    // Reuse the cinematic pact sting — slightly quieter than the popup
    // open since this fires on confirm rather than reveal.
    this._play('sfx-dark-pact', 2.0)
  }

  _onIntelLeaked() {
    // Rate-limit using the trap timer (300ms) so an intel-leak storm at
    // a wave's end doesn't machine-gun the error chirp.
    const now = this._now()
    if (now - this._lastTrapAt < 300) return
    this._lastTrapAt = now
    this._play('sfx-error', 1.2)
  }

  _onGameOver() {
    // Big dramatic stinger as QUEST FAILED burns in. Sfx-boss-death is
    // already loud + dramatic; bump the extra cap to make it cut through
    // even with the score-countup loop layered on top.
    this._play('sfx-boss-death', 2.5)
  }

  _onBountyPosted() {
    // Bounty posters are positive events for the boss ("hunters approach,
    // reinforce the wing"). Door-unlock reads as a portentous bell.
    this._play('sfx-door-unlock', 0.8)
  }

  _onCoinFlip() {
    // The coin leaves the imp's hand — a bright metallic toss.
    this._play('sfx-collect-gold', 1.6)
  }

  _onCoinRevealed({ won } = {}) {
    // Win — a fat gold chime; loss — the error chirp as the hoard drains.
    if (won) this._play('sfx-collect-gold', 3.5)
    else     this._play('sfx-error', 1.3)
  }

  _onResourcesAwarded({ gold }) {
    if (!gold || gold <= 0) return
    const now = this._now()
    if (now - this._lastGoldAt < 400) return
    this._lastGoldAt = now
    // Gold pickups get an extra boost — they're a satisfying milestone and
    // were getting buried under combat sounds at the standard 1.0 cap.
    this._play('sfx-collect-gold', 3.0)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Optional `extraBoost` multiplies on top of SFX_BOOST and lets the final
  // volume exceed 1.0 — Phaser's WebAudio GainNode accepts gain > 1, so we
  // rely on it for the "extra loud" pickup sounds (collect-gold) where the
  // standard ceiling makes them disappear in the mix.
  _play(key, extraBoost) {
    // Backgrounded — drop the sound entirely so it can't queue up and
    // burst on return (see the _pageHasFocus note above).
    if (!_pageHasFocus) return
    if (SfxVolume.isMuted()) return
    if (!this._scene?.cache?.audio?.exists?.(key)) return
    const baseGain = SFX_VOLUMES[key] ?? SFX_DEFAULT_VOL
    const cap = extraBoost ? 4 : 1
    const vol = Math.min(cap, baseGain * SFX_BOOST * (extraBoost ?? 1) * SfxVolume.getVolume())
    if (vol <= 0) return
    try { this._scene.sound.play(key, { volume: vol }) } catch {}
  }

  _now() { return this._scene?.time?.now ?? Date.now() }

  _findAdv(instanceId) {
    return this._gameState?.adventurers?.active?.find(a => a.instanceId === instanceId) ?? null
  }

  destroy() {
    for (const [evt, fn] of this._handlers) EventBus.off(evt, fn)
    this._handlers = []
  }
}

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
  'sfx-take-damage':    0.70,   // reference  (-1.8pk / -20.6rms)
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
}

// Fallback for any key not in the table.
const SFX_DEFAULT_VOL = 0.70

// Global SFX boost applied on top of the per-sound table + master slider,
// clamped to Phaser's 1.0 ceiling. Bumps quiet sounds (revive 0.58, error
// 0.58, score-countup 0.55, etc.) toward audibility when the master slider
// is near max. The originally-loud ones simply hit the cap.
const SFX_BOOST = 1.5

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
    on('ADVENTURER_DIED',         this._onDeath)
    on('MINION_DIED',             this._onDeath)

    // Boss fight
    on('BOSS_FIGHT_STARTED',      this._onBossFightStarted)
    on('BOSS_FIGHT_RESOLVED',     this._onBossFightResolved)
    on('BOSS_LEVELED_UP',         this._onBossLeveledUp)

    // Abilities
    on('ABILITY_TRIGGERED',       this._onAbilityTriggered)
    on('ALLY_HEALED',             this._onAllyHealed)
    on('ADVENTURER_RESURRECTED',  this._onRevive)
    on('MINION_SUMMONED',         this._onNecroSummon)

    // Traps
    on('TRAP_TRIGGERED',          this._onTrapTriggered)

    // Minion evolution
    on('MINION_EVOLVED',          this._onMinionEvolved)
    on('MINIBOSS_PROMOTED',       this._onMinibossPromoted)

    // Doors
    on('DOOR_OPENING',            this._onDoorOpened)
    on('DOOR_CLOSED',             this._onDoorClosed)
    on('PHYLACTERY_UNLOCKED',     this._onDoorUnlock)

    // Environment
    on('MIMIC_REVEALED',          this._onChestOpen)
    on('WANDERING_GATE_TELEPORTED', this._onTeleport)
    on('FALSE_EXIT_TELEPORTED',   this._onTeleport)
    on('PACT_BOSS_PETRIFY_FIRED', this._onBeholderBeam)

    // Resources
    on('RESOURCES_AWARDED',       this._onResourcesAwarded)

    // Phase transitions
    on('DAY_PHASE_BEGAN',         this._onDayStart)
    on('DAY_PHASE_ENDED',         this._onDayEnd)

    // Night-phase building
    on('ROOM_REMOVED',            this._onSell)
    on('MINION_REMOVED',          this._onSell)
    on('BUILD_ERROR',             this._onBuildError)

    // Dark Pact
    on('SHOW_DARK_PACT',          this._onDarkPact)
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  _onCombatHit({ sourceId, damageType }) {
    // Take-damage sound — rate-limited to avoid rapid-fire stacking.
    const now = this._now()
    if (now - this._lastTakeDamageAt >= 120) {
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

  _onBossMeleeHit() {
    // Play boss attack sound every other hit to avoid rapid-fire repetition.
    if (this._bossAttackAlt === 0) this._play('sfx-boss-attack')
    this._bossAttackAlt = 1 - this._bossAttackAlt
    // Also play take-damage for the target.
    const now = this._now()
    if (now - this._lastTakeDamageAt >= 120) {
      this._lastTakeDamageAt = now
      this._play('sfx-take-damage')
    }
  }

  _onDeath() {
    const now = this._now()
    if (now - this._lastDeathAt < 250) return
    this._lastDeathAt = now
    this._play('sfx-death')
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

  _onMinionEvolved() {
    const now = this._now()
    if (now - this._lastEvolvedAt < 500) return
    this._lastEvolvedAt = now
    this._play('sfx-revive')
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
  _onSell() {
    const now = this._now()
    if (now - this._lastSellAt < 300) return
    this._lastSellAt = now
    this._play('sfx-remove-room')
  }
  _onBuildError()    { this._play('sfx-error') }
  _onDarkPact()      { this._play('sfx-dark-pact', 3.5) }

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

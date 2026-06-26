import { SaveSystem }         from '../systems/SaveSystem.js'
import { playSfx }            from '../systems/SfxVolume.js'
import { EventBus }           from '../systems/EventBus.js'
import { effectiveUiScale }   from '../hud/stageScale.js'
import { DungeonGrid, TILE }  from '../systems/DungeonGrid.js'
import { AISystem }           from '../systems/AISystem.js'
import { PersonalitySystem }  from '../systems/PersonalitySystem.js'
import { CombatSystem }       from '../systems/CombatSystem.js'
import { MinionAISystem }     from '../systems/MinionAISystem.js'
import { TrapSystem }         from '../systems/TrapSystem.js'
import { EvolutionSystem }    from '../systems/EvolutionSystem.js'
import { MinionEvolutionSystem } from '../systems/MinionEvolutionSystem.js'
import { ClassAbilitySystem } from '../systems/ClassAbilitySystem.js'
import { KnowledgeSystem }    from '../systems/KnowledgeSystem.js'
import { DungeonMechanicSystem } from '../systems/DungeonMechanicSystem.js'
import { StoryRecapSystem }   from '../systems/StoryRecapSystem.js'
import { InquisitorSystem }   from '../systems/InquisitorSystem.js'
import { BossSystem }         from '../systems/BossSystem.js'
import { RoomBehaviorSystem } from '../systems/RoomBehaviorSystem.js'
import { RunHistorySystem }   from '../systems/RunHistorySystem.js'
import { LiveRunPublisher }  from '../systems/LiveRunPublisher.js'
import { BossArchetypeSystem } from '../systems/BossArchetypeSystem.js'
import { EmoteSystem }        from '../systems/EmoteSystem.js'
import { Balance }            from '../config/balance.js'
import { fallenRevivable, totalReviveCost, reviveCandidates, planRevive, reviveCapAllowed } from '../util/minionRevive.js'
import { brokenTraps, totalTrapRebuildCost } from '../util/trapRebuild.js'
import { createTrap }          from '../entities/Trap.js'
import { DungeonRenderer }    from '../ui/DungeonRenderer.js'
import { AdventurerRenderer } from '../ui/AdventurerRenderer.js'
import { NerveSystem } from '../systems/NerveSystem.js'
import { SocialVfx } from '../ui/SocialVfx.js'
import { AiDiagOverlay }      from '../ui/AiDiagOverlay.js'
import { MinionRenderer }     from '../ui/MinionRenderer.js'
import { TrapRenderer }       from '../ui/TrapRenderer.js'
import { LootPileRenderer }   from '../ui/LootPileRenderer.js'
import { KeyChestRenderer }   from '../ui/KeyChestRenderer.js'
import { LockRenderer }       from '../ui/LockRenderer.js'
import { BeaconRenderer }     from '../ui/BeaconRenderer.js'
import { FountainRenderer }   from '../ui/FountainRenderer.js'
import { TreasureChestRenderer } from '../ui/TreasureChestRenderer.js'
import { DarkDealDemonRenderer } from '../ui/DarkDealDemonRenderer.js'
import { GamblerImpRenderer }    from '../ui/GamblerImpRenderer.js'
import { DemonWagerRenderer }    from '../ui/DemonWagerRenderer.js'
import { PhylacteryRenderer } from '../ui/PhylacteryRenderer.js'
import { FungalCorpseRenderer } from '../ui/FungalCorpseRenderer.js'
import { PersistentCorpseRenderer } from '../ui/PersistentCorpseRenderer.js'
import { TrapBlessRenderer } from '../ui/TrapBlessRenderer.js'
import { ChatBubbles }        from '../ui/ChatBubbles.js'
import { KnowledgeOverlay }   from '../ui/KnowledgeOverlay.js'
// ReplayGhostRenderer removed 2026-05-21 (prior-run path trail cut at
// user request) — file kept in repo, just no longer imported/constructed.
import { SunderedFloorRenderer } from '../ui/SunderedFloorRenderer.js'
import { TunnelPortalRenderer } from '../ui/TunnelPortalRenderer.js'
import { CartographerOverlay }   from '../ui/CartographerOverlay.js'
import { BossRenderer }       from '../ui/BossRenderer.js'
import { SuccubusBatRenderer } from '../ui/SuccubusBatRenderer.js'
import { CharmVfxRenderer } from '../ui/CharmVfxRenderer.js'
import { CoinBurstRenderer }  from '../ui/CoinBurstRenderer.js'
import { SellFxRenderer }     from '../ui/SellFxRenderer.js'
import { TorchRenderer }      from '../ui/TorchRenderer.js'
import { CobwebRenderer }     from '../ui/CobwebRenderer.js'
import { TarPitRenderer }     from '../ui/TarPitRenderer.js'
import { SilenceWardRenderer } from '../ui/SilenceWardRenderer.js'
import { BrambleHallRenderer } from '../ui/BrambleHallRenderer.js'
import { WanderingGateRenderer } from '../ui/WanderingGateRenderer.js'
import { WatchtowerRenderer } from '../ui/WatchtowerRenderer.js'
import { ArmoryRenderer } from '../ui/ArmoryRenderer.js'
import { SanctumRenderer } from '../ui/SanctumRenderer.js'
import { VeilRenderer } from '../ui/VeilRenderer.js'
import { HallOfMadnessRenderer } from '../ui/HallOfMadnessRenderer.js'
import { CryptRenderer } from '../ui/CryptRenderer.js'
import { CatacombsRenderer } from '../ui/CatacombsRenderer.js'
import { TreasuryRenderer } from '../ui/TreasuryRenderer.js'
import { LibraryRenderer } from '../ui/LibraryRenderer.js'
import { WishingWellRenderer } from '../ui/WishingWellRenderer.js'
import { HallOfTrialsRenderer } from '../ui/HallOfTrialsRenderer.js'
import { GuardPostRenderer } from '../ui/GuardPostRenderer.js'
import { DecorRenderer }      from '../ui/DecorRenderer.js'
import { BloodSplatRenderer } from '../ui/BloodSplatRenderer.js'
import { HazardRenderer }     from '../ui/HazardRenderer.js'
import { PlunderMarkRenderer } from '../ui/PlunderMarkRenderer.js'
import { TitleMusic }         from '../systems/TitleMusic.js'
import { GameplayMusic }      from '../systems/GameplayMusic.js'
import { kickOffDeferredAudioLoad } from './DeferredAudioLoader.js'
import { PauseManager }       from '../systems/PauseManager.js'
import { SfxSystem }          from '../systems/SfxSystem.js'
import { EventSystem }        from '../systems/EventSystem.js'
import { PlayerProfile }      from '../systems/PlayerProfile.js'
import { CombatFeedback }     from '../systems/CombatFeedback.js'
import { CompanionWorldFx }   from '../systems/CompanionWorldFx.js'
import { HitSparkSystem }     from '../systems/HitSparkSystem.js'
import { StatusVfxSystem }    from '../systems/StatusVfxSystem.js'
import { ScenePostFxSystem }  from '../systems/ScenePostFxSystem.js'
import { LightingSystem }     from '../systems/LightingSystem.js'
import { CombatJuiceSystem }  from '../systems/CombatJuiceSystem.js'
import { MomentVfxSystem }    from '../systems/MomentVfxSystem.js'
import { CheaterAttackVfxSystem } from '../systems/CheaterAttackVfxSystem.js'
import { BossAttackVfxSystem }    from '../systems/BossAttackVfxSystem.js'
import { ScreenShakeSystem }  from '../systems/ScreenShakeSystem.js'
import { HitStopSystem }      from '../systems/HitStopSystem.js'
import { RivalBossShowdown }  from '../systems/RivalBossShowdown.js'
import { ActSystem }          from '../systems/ActSystem.js'
import { NemesisSystem }      from '../systems/NemesisSystem.js'
import { KingdomResponseSystem } from '../systems/KingdomResponseSystem.js'
import { KingdomModifierSystem } from '../systems/KingdomModifierSystem.js'
import { isActsEnabled }      from '../config/acts.js'
import { AbilityVfx }         from '../ui/AbilityVfx.js'
import { BossPactVfx }        from '../ui/BossPactVfx.js'
import { TutorialSystem }     from '../systems/TutorialSystem.js'
import { NpcDirector }        from '../systems/NpcDirector.js'
import { getRotatedDef }      from '../util/roomRotation.js'
import { installDevSandbox }  from '../dev/DevSandbox.js'

const TS = Balance.TILE_SIZE

export class Game extends Phaser.Scene {
  constructor() {
    super('Game')
    this.gameState           = null
    this.dungeonGrid         = null
    this.aiSystem            = null
    this.minionAiSystem      = null
    this.trapSystem          = null
    this.combatSystem        = null
    this.personalitySystem   = null
    this.evolutionSystem     = null
    this.knowledgeSystem     = null
    this.adventurerRenderer  = null
    this.minionRenderer      = null
    this.trapRenderer        = null
    this.minionInspector     = null
    this.knowledgeOverlay      = null
    this._dungeonRenderer    = null
    this._hudScene           = null
    this._cam                = null
    this._dragOrigin         = null
    this._keys               = null
    this._followId           = null
    this._duelCamLock        = false   // lock camera during a boss duel (Aldric)
    this.bossRenderer        = null
  }

  init(data) {
    this.gameState = data?.gameState || SaveSystem.load()
    // Reset per-start runtime camera flags. Phaser runs the constructor only
    // ONCE (at scene registration), NOT on scene.start — so a flag left set
    // when the player exits mid-cinematic (e.g. _duelCamLock during the Aldric
    // duel) would persist into the reloaded run and leave the camera
    // stuck locked. Clear them here so every (re)start begins unlocked.
    this._duelCamLock    = false
    this._fightCamActive = false
    this._preFightCam    = null
    this._followId       = null
    this._dragOrigin     = null
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  create() {
    // Phaser does NOT auto-invoke a `shutdown()` method on the user
    // scene class when scene.stop() runs — it only fires a SHUTDOWN
    // event on the scene's event emitter. Without this binding,
    // Game.shutdown() is unreachable from the normal stop path, so
    // EVERY system (DungeonRenderer, NpcDirector, AISystem,
    // BossSystem, ...) leaks its EventBus subscriptions when the
    // player ends a run and starts a new one. Symptoms observed:
    // companion voice leak (Malakor speaking Safira's lines),
    // ROOM_PLACED crash during createGameState (stale
    // DungeonRenderer's listener firing on a half-torn-down scene),
    // doubled chest-payout toasts (two AISystem instances both
    // emitting TREASURE_PAYOUT). HudScene knew about this Phaser
    // quirk and bound the same `events.once('shutdown', ...)`
    // workaround at line 83 of its create(); Game was missing the
    // same line, which is why all the workarounds piled up around
    // its missing teardown.
    //
    // Use `once` so a single stop fires shutdown once and detaches;
    // create() runs again on the next start with a fresh binding.
    this.events.once('shutdown', this.shutdown, this)

    // Auto-rewind notification — SaveSystem.load() detects a save that
    // was somehow in mid-day phase, clears the active-adv array, and
    // flips it back to night, marking `meta._rewoundOnLoad = true`.
    // We defer the toast by ~800ms so the HUD's ToastQueue has time to
    // subscribe (HUD mounts in HudScene, started in parallel with Game).
    // Without the delay the SHOW_TOAST emit happens before any subscriber
    // exists and the toast is silently lost.
    if (this.gameState?.meta?._rewoundOnLoad) {
      delete this.gameState.meta._rewoundOnLoad
      this.time.delayedCall(800, () => {
        EventBus.emit('SHOW_TOAST', {
          message: 'Save rewound — the in-progress day was cleared.',
          type:    'info',
        })
      })
    }

    // Catch-up stream for the deferred run audio (music + gameplay SFX). The
    // MainMenu pass usually finishes first, but if the player dove straight into
    // a run (or its loader was interrupted on scene-swap), this loads whatever's
    // left on the Game scene's loader. Already-cached keys are skipped.
    // GameplayMusic._playKey lazy-loads the current track too, so music still
    // starts immediately even before this batch lands.
    kickOffDeferredAudioLoad(this)
    // Pull dev Sound-Studio custom uploads into the cache so swapped sounds play.
    import('../systems/SoundCustom.js').then(m => m.hydrateCustomSounds(this)).catch(() => {})

    // Title music belongs to MainMenu / ArchetypeSelect only — kill
    // it on the way into the dungeon and hand off to the gameplay
    // playlist (shuffled in-run soundtrack).
    TitleMusic.stop()
    GameplayMusic.start(this)

    // Mango cheat — when the player's name is the dev-test handle,
    // unlock every room / minion / trap / item by stamping
    // `unlockLevel = 1` on every JSON def in Phaser's cache and
    // back-filling the gameState.unlocks allowlists. All downstream
    // gate checks (BuildMenu, NightPhase placement, DungeonGrid
    // validation, EventSystem minion pool, etc.) naturally pass.
    // Mutation reverts on page reload — switching off the cheat
    // mid-session requires a refresh. The same flag also drives the
    // 9999-gold floor refilled every update tick (see update()).
    this._isMangoCheat = PlayerProfile.isCheatName()
    if (this._isMangoCheat) {
      this._applyMangoCheatUnlocks()
    } else {
      // Per-name saves (2026-05-29) made mid-session name switches a real
      // workflow. A prior mango-session in this page would have mutated the
      // JSON cache (unlockLevel = 1 on every gated def) and that mutation
      // doesn't revert on a name change — so a player who tested as mango
      // and switched to a real name kept seeing everything unlocked. Revert
      // here, on every non-mango Game-scene boot, using the snapshot
      // _applyMangoCheatUnlocks stamped on the game instance. No-op if the
      // cheat never ran in this page session.
      this._revertMangoCheatUnlocks()
    }

    // Lifecycle registry. Every system + renderer constructed below is
    // wrapped in `track(...)`, which pushes it onto this._lifecycle and
    // returns it for assignment. Game.shutdown() iterates the list (in
    // LIFO order) and calls .destroy() on each — no parallel destroy
    // chain to maintain, so a newly-added system can never leak its
    // EventBus subscriptions across runs by being forgotten in shutdown.
    //
    // This pattern replaced the prior hand-maintained destroy chain
    // after BossArchetypeSystem leaked (vampire-charm-on-every-archetype
    // bug, 2026-05-27): the constructor was added in create() but the
    // matching destroy call was never added in shutdown(), so the
    // previous run's instance kept reacting to ADVENTURERS_SPAWNED on
    // the new run with stale archetype state.
    //
    // Skipping `destroy` gracefully — track() ignores any instance that
    // doesn't expose a destroy() method, so wrapping a plain helper
    // (e.g. DungeonGrid, which is pure data) is harmless.
    this._lifecycle = []
    const track = (instance) => {
      if (instance && typeof instance.destroy === 'function') {
        this._lifecycle.push(instance)
      }
      return instance
    }

    this.dungeonGrid         = track(new DungeonGrid(this.gameState.dungeon))

    // Re-apply current room definitions to every placed room so tile grids are
    // always derived from the definition, not stale data baked by a previous
    // session or an old Room Builder edit. This fixes:
    //   • Rooms that were saved with all-void tiles (appear as thin strips or blank)
    //   • Boss chamber missing tile art after a Room Builder pass over it
    // Do this BEFORE creating DungeonRenderer so the first draw sees clean data.
    this._reapplyAllRoomDefs()

    this._dungeonRenderer    = track(new DungeonRenderer(this, this.gameState))
    // Phase: items — push every saved lock onto cp.locked so the
    // DungeonRenderer's first draw picks the locked door variant. The
    // LOCKS_CHANGED listener handles every subsequent mutation.
    this._syncLockedCPs()
    this.personalitySystem   = track(new PersonalitySystem(this))
    this.personalitySystem.loadDefinitions()

    // Phase 6e: cache archetype modifiers on gameState for easy cross-system lookup
    this._cacheArchetypeModifiers()
    this.combatSystem        = track(new CombatSystem(this, this.gameState))
    this.knowledgeSystem     = track(new KnowledgeSystem(this, this.gameState, this.dungeonGrid))
    this.aiSystem            = track(new AISystem(this, this.gameState, this.dungeonGrid, this.personalitySystem, this.combatSystem, this.knowledgeSystem))
    this.nerveSystem         = track(new NerveSystem(this, this.gameState, this.dungeonGrid, this.personalitySystem))
    this.minionAiSystem      = track(new MinionAISystem(this, this.gameState, this.dungeonGrid, this.combatSystem))
    this.trapSystem          = track(new TrapSystem(this, this.gameState, this.dungeonGrid))
    this.trapSystem.loadDefinitions()
    this.evolutionSystem     = track(new EvolutionSystem(this, this.gameState))
    this.evolutionSystem.loadDefinitions()
    this.minionEvolutionSystem = track(new MinionEvolutionSystem(this, this.gameState))
    this.dungeonMechanicSystem = track(new DungeonMechanicSystem(this, this.gameState))
    this.dungeonMechanicSystem.loadDefinitions()
    this.storyRecapSystem    = track(new StoryRecapSystem(this, this.gameState))
    this.inquisitorSystem    = track(new InquisitorSystem(this, this.gameState, this.dungeonMechanicSystem, this.personalitySystem))
    this.bossSystem          = track(new BossSystem(this, this.gameState))
    this.sfxSystem           = track(new SfxSystem(this, this.gameState))
    this.eventSystem         = track(new EventSystem(this, this.gameState))
    this.combatFeedback      = track(new CombatFeedback(this, this.gameState))
    // Per-companion world-space VFX layered onto combat/death — pink
    // hearts on adv death for Lilith, purple sparks on every hit for
    // Malakor. Reads gameState.meta.companionId; no-ops for the others.
    this.companionWorldFx    = track(new CompanionWorldFx(this, this.gameState))
    this.hitSparkSystem      = track(new HitSparkSystem(this, this.gameState))
    // Persistent poison/burn DoT auras on afflicted entities (lingering status
    // read). Phaser objects live in the system, not on entities (save-safe).
    this.statusVfxSystem     = track(new StatusVfxSystem(this, this.gameState))
    // Scene-wide post-processing pipeline (grade + bloom + vignette) on the
    // dungeon camera; cross-fades by mood (day/night/boss/death/victory).
    this.scenePostFx         = track(new ScenePostFxSystem(this, this.gameState))
    // Fake dynamic lighting — additive radial light pools that follow the boss
    // + flash from fire/abilities (scene.lightingSystem.flash(x,y,opts)).
    this.lightingSystem      = track(new LightingSystem(this, this.gameState))
    // Combat juice — wires light flash / post-fx pulse / screen shake onto
    // impactful combat events (hero deaths, boss slams, big boss hits).
    this.combatJuiceSystem   = track(new CombatJuiceSystem(this, this.gameState))
    // World-space VFX for big moments: ascension, victory, boss level-up,
    // minion evolve/spawn, trap explosions.
    this.momentVfxSystem     = track(new MomentVfxSystem(this, this.gameState))
    // Wild glitch-burst overlay on every cheater swing — fires after
    // HitSparkSystem in the listener chain so the cheater layer paints
    // over the hit spark.
    this.cheaterAttackVfxSystem = track(new CheaterAttackVfxSystem(this, this.gameState))
    // Pact + archetype-basic boss attack VFX. Layers on top of the
    // existing pact telegraph/feedback (channel beams, rings, etc.)
    // — adds punch without replacing the mechanical telegraph.
    this.bossAttackVfxSystem    = track(new BossAttackVfxSystem(this, this.gameState))
    this.screenShakeSystem   = track(new ScreenShakeSystem(this))
    this.hitStopSystem       = track(new HitStopSystem(this))
    this.rivalBossShowdown   = track(new RivalBossShowdown(this, this.gameState))
    // "The Kingdom's Reckoning" act framework (KR P1). Gated behind the `acts`
    // feature flag (default OFF) so the current endless game is untouched until
    // the act campaign is built out. Tracks act state + fires ACT_STARTED /
    // ACT_CLEARED / RUN_VICTORY off the day-advance.
    // Ternary (not `if`) so the OFF branch explicitly NULLs the field — Phaser
    // reuses this scene instance across runs, so a bare `if` would leave a stale
    // (destroyed) reference from a prior campaign run alive in a later endless run.
    this.actSystem = isActsEnabled(this.gameState) ? track(new ActSystem(this, this.gameState)) : null
    // Aldric — the recurring Nemesis (KR P2). Tracks his per-act escalation +
    // fires NEMESIS_* taunts. Spawn integration + right-side rival portrait
    // build on this. Same `acts` gate as ActSystem.
    this.nemesisSystem = isActsEnabled(this.gameState) ? track(new NemesisSystem(this, this.gameState)) : null
    // The drafted middle (KR P4). Drafts a Kingdom Response when Act II / III
    // begins + fires KINGDOM_RESPONSE_DRAWN for the announce set-piece and the
    // per-response gimmicks. Same `acts` gate.
    this.kingdomResponseSystem = isActsEnabled(this.gameState) ? track(new KingdomResponseSystem(this, this.gameState)) : null
    // The deep per-response modifiers (KR P4) — the rule-bending signature
    // mechanics (Forlorn fury, Pantheon zones, etc.). Same `acts` gate.
    this.kingdomModifierSystem = isActsEnabled(this.gameState) ? track(new KingdomModifierSystem(this, this.gameState)) : null
    // Dev VFX sandbox (window.__qfDev) — cheat-name gated. Scriptable spawning of
    // test minions/traps + champion-raid firing so the Kingdom-Response set-pieces
    // can be verified without hand-playing a run. See src/dev/DevSandbox.js.
    if (this._isMangoCheat) { try { installDevSandbox(this) } catch (e) { console.warn('[qfDev] install failed', e) } }
    this.bossPactVfx         = track(new BossPactVfx(this, this.gameState))
    this.roomBehaviorSystem  = track(new RoomBehaviorSystem(this, this.gameState))
    this.classAbilitySystem  = track(new ClassAbilitySystem(this, this.gameState))
    // Phase 31I — passive run-history aggregator. Subscribes to event bus
    // and folds counts into gameState.run.totals + history.pacts. No gameplay.
    this.runHistorySystem    = track(new RunHistorySystem(this, this.gameState))
    // Live-run leaderboard heartbeat (2026-05-25). Upserts a 'live'
    // row to Supabase on NIGHT_PHASE_STARTED + run start so other
    // players can see the run in progress on the leaderboard. Fire-
    // and-forget; network failures swallowed.
    // ENDLESS-ONLY: the leaderboard ranks days-survived, which is the endless
    // metric; campaign is a fixed win-condition run (judged by victory + NG+),
    // so campaign runs never publish (the finished/abandoned submits are gated too).
    this.liveRunPublisher = isActsEnabled(this.gameState) ? null : track(new LiveRunPublisher(this, this.gameState))
    // Phase 1b — per-archetype headline mechanics (Orc Loot the Fallen, etc).
    this.bossArchetypeSystem = track(new BossArchetypeSystem(this, this.gameState))
    this._evolutionSystem    = this.evolutionSystem  // alias for MinionInspector lookup
    this.adventurerRenderer  = track(new AdventurerRenderer(this, this.gameState))
    // Social/reaction VFX (AI overhaul) — event-driven, no per-frame update.
    this.socialVfx           = track(new SocialVfx(this, this.gameState))
    // F4-toggled on-screen AI diagnostics: per-adv floating labels showing
    // goal, distance-to-target, time-since-progress, and panic-walk state.
    // Color-coded for stuck-detection. No-op when DebugOverlay.aiDiagnostics
    // is off (its default). Used to debug pathing ping-pongs in the wild.
    this.aiDiagOverlay       = track(new AiDiagOverlay(this, this.gameState))
    this.emoteSystem         = track(new EmoteSystem(this, this.gameState, this.adventurerRenderer))
    this.minionRenderer      = track(new MinionRenderer(this, this.gameState))
    this.trapRenderer        = track(new TrapRenderer(this, this.gameState))
    this.lootPileRenderer    = track(new LootPileRenderer(this, this.gameState))
    this.keyChestRenderer    = track(new KeyChestRenderer(this, this.gameState))
    this.lockRenderer        = track(new LockRenderer(this, this.gameState))
    this.beaconRenderer      = track(new BeaconRenderer(this, this.gameState))
    this.fountainRenderer    = track(new FountainRenderer(this, this.gameState))
    this.treasureChestRenderer = track(new TreasureChestRenderer(this, this.gameState))
    this.darkDealDemonRenderer = track(new DarkDealDemonRenderer(this, this.gameState))
    this.gamblerImpRenderer    = track(new GamblerImpRenderer(this, this.gameState))
    // Demon's Wager NPC — clones the gambler imp pattern with crimson
    // tinting + DEMON_WAGER_NPC_CLICKED event instead of GAMBLER_*.
    this.demonWagerRenderer    = track(new DemonWagerRenderer(this, this.gameState))
    this.phylacteryRenderer  = track(new PhylacteryRenderer(this, this.gameState))
    this.fungalCorpseRenderer = track(new FungalCorpseRenderer(this, this.gameState))
    this.persistentCorpseRenderer = track(new PersistentCorpseRenderer(this, this.gameState))
    this.trapBlessRenderer = track(new TrapBlessRenderer(this, this.gameState))
    // MinionInspector and WantedPoster were Phaser-only chrome; the DOM HUD
    // owns those surfaces now (ToastQueue 'bounty' kind + the DOM inspector),
    // so the legacy Phaser constructions were dropped with P0-6.
    this.chatBubbles         = track(new ChatBubbles(this, this.gameState))
    this.knowledgeOverlay      = track(new KnowledgeOverlay(this, this.gameState, this.knowledgeSystem))
    // Replay Ghost trail removed at user request (2026-05-21) — a
    // returning Hero no longer draws their prior-run path on the dungeon
    // floor. ReplayGhostRenderer.js stays in the repo (removal-not-
    // deletion); it just isn't constructed. The ?.update() / ?.destroy()
    // calls elsewhere no-op safely on the null field.
    this.replayGhostRenderer = null
    // BossFightOverlay moved to HudScene — it uses scene.uiW/uiH which
    // only HudScene sets via applyUiCamera. Game scene retains the
    // camera-zoom hooks below that pair with the overlay's intro slate.
    this.bossRenderer        = track(new BossRenderer(this, this.gameState))
    this.succubusBatRenderer = track(new SuccubusBatRenderer(this, this.gameState))
    // Boss-aware "charmed adventurer" VFX (succubus seduction hearts vs vampire
    // blood thrall) — apply burst + the persistent thrall aura.
    this.charmVfxRenderer = track(new CharmVfxRenderer(this, this.gameState))
    this.coinBurstRenderer   = track(new CoinBurstRenderer(this, this.gameState))
    this.sellFxRenderer      = track(new SellFxRenderer(this))
    this.torchRenderer       = track(new TorchRenderer(this, this.gameState))
    this.cobwebRenderer      = track(new CobwebRenderer(this, this.gameState))
    this.tarPitRenderer      = track(new TarPitRenderer(this, this.gameState))
    this.silenceWardRenderer = track(new SilenceWardRenderer(this, this.gameState))
    this.brambleHallRenderer = track(new BrambleHallRenderer(this, this.gameState))
    this.wanderingGateRenderer = track(new WanderingGateRenderer(this, this.gameState))
    this.watchtowerRenderer  = track(new WatchtowerRenderer(this, this.gameState))
    this.armoryRenderer      = track(new ArmoryRenderer(this, this.gameState))
    this.sanctumRenderer     = track(new SanctumRenderer(this, this.gameState))
    this.veilRenderer        = track(new VeilRenderer(this, this.gameState))
    this.hallOfMadnessRenderer = track(new HallOfMadnessRenderer(this, this.gameState))
    this.cryptRenderer       = track(new CryptRenderer(this, this.gameState))
    this.catacombsRenderer   = track(new CatacombsRenderer(this, this.gameState))
    this.treasuryRenderer    = track(new TreasuryRenderer(this, this.gameState))
    this.libraryRenderer     = track(new LibraryRenderer(this, this.gameState))
    this.wishingWellRenderer = track(new WishingWellRenderer(this, this.gameState))
    this.hallOfTrialsRenderer = track(new HallOfTrialsRenderer(this, this.gameState))
    this.guardPostRenderer   = track(new GuardPostRenderer(this, this.gameState))
    this.decorRenderer       = track(new DecorRenderer(this, this.gameState))
    this.bloodSplatRenderer  = track(new BloodSplatRenderer(this, this.gameState))
    this.hazardRenderer      = track(new HazardRenderer(this, this.gameState))
    this.plunderMarkRenderer = track(new PlunderMarkRenderer(this, this.gameState))
    // Companion NPC brain — constructed before TutorialSystem so its
    // INTRO_DISMISSED handler registers first and her welcome line is
    // queued ahead of the first tutorial.
    this.npcDirector         = track(new NpcDirector(this, this.gameState))
    this.tutorialSystem      = track(new TutorialSystem(this, this.gameState))
    this.sunderedFloorRenderer = track(new SunderedFloorRenderer(this))
    this.tunnelPortalRenderer  = track(new TunnelPortalRenderer(this))
    this.cartographerOverlay   = track(new CartographerOverlay(this, this.gameState))

    // Respawn dead minions when night starts (Phase 6 kernel)
    EventBus.on('NIGHT_PHASE_STARTED',  this._onNightStart,   this)
    // Pay-to-revive (2026-05-28): the night-phase REVIVE button (LeftPanels)
    // asks to bring fallen roster minions back for gold.
    EventBus.on('REVIVE_FALLEN_REQUEST', this._onReviveFallenRequest, this)
    // Pay-to-rebuild (2026-05-29): the night-phase REBUILD button (BottomBar)
    // asks to bring traps that broke during the day back for gold.
    EventBus.on('REBUILD_TRAPS_REQUEST', this._onRebuildTrapsRequest, this)
    // Lost-at-day-start: any fallen minion the player didn't pay to revive
    // during the build phase is purged when the day begins.
    EventBus.on('DAY_PHASE_STARTED',     this._purgeUnrevivedFallen,  this)
    // Phase 10: third boss defeat → game over
    EventBus.on('BOSS_DEFEATED_FINAL',  this._onBossFinal,    this)
    // Anti-save-scum (2026-05-31): commit the instant the boss loses a
    // (non-final) life so quitting can't rewind the death. See _onBossLifeCommit.
    EventBus.on('BOSS_FIGHT_RESOLVED',  this._onBossLifeCommit, this)
    // Re-clamp zoom whenever the dungeon grid expands so min zoom tracks map size
    EventBus.on('GRID_EXPANDED',        this._onGridExpanded,  this)
    // Boss levels up → expand grid + scale all live minions.
    EventBus.on('BOSS_LEVELED_UP',   this._onBossLeveledUp, this)
    // Boss level DROPS (Demon's Wager loss) → rescale every live
    // minion downward via applyBossLevelToMinion. Only fires on
    // negative deltas — positive deltas are owned by _onBossLeveledUp
    // above (which also grows the grid + bumps boss stats).
    EventBus.on('BOSS_LEVEL_CHANGED', this._onBossLevelChanged, this)
    // Room Builder saved a room def — rewrite tile grids for all placed
    // instances so structural changes appear immediately without remove + re-place.
    EventBus.on('ROOM_DEF_SAVED',       this._onRoomDefSaved,   this)
    // Room Builder reset ALL rooms — reapply every placed room in one pass.
    EventBus.on('ROOMS_ALL_RESET',      this._onRoomsAllReset,  this)
    // Phase: items — keep cp.locked flags + door sprites in sync with
    // gameState.dungeon.locks. Anything that mutates the locks list emits
    // LOCKS_CHANGED so this single listener owns all redraw timing.
    EventBus.on('LOCKS_CHANGED',        this._syncLockedCPs,    this)
    // Camera follow
    EventBus.on('ADVENTURER_CLICKED',   this._onAdvClicked,   this)
    EventBus.on('ADVENTURER_DIED',      this._onAdvRemoved,   this)
    EventBus.on('ADVENTURER_FLED',      this._onAdvRemoved,   this)
    // The Nemesis (Aldric) — zoom in + follow him by default the moment he enters
    // the dungeon (released the instant the player scrolls; see WASD/drag handlers).
    EventBus.on('NEMESIS_ARRIVED',       this._onNemesisArrived,      this)
    // Loot Goblin Heist — red floater at the goblin's last position + toast
    // banner so the player notices the gold drain.
    EventBus.on('LOOT_GOBLIN_ESCAPED',  this._onLootGoblinEscaped, this)
    // Blood Moon Eclipse — red wash overlay during the event day.
    EventBus.on('DUNGEON_EVENT_BEGAN',  this._onDungeonEventBegan, this)
    EventBus.on('DUNGEON_EVENT_ENDED',  this._onDungeonEventEnded, this)
    EventBus.on('ADVENTURERS_SPAWNED',  this._onAdvsSpawned,  this)
    EventBus.on('DAY_PHASE_ENDED',      this._onDayEnded,     this)
    // Day-cycle hooks for the entrance door — animate-open at day start,
    // hard-close at day end so it re-animates next day.
    EventBus.on('DAY_PHASE_STARTED',    this._onDayStartedDoors, this)
    EventBus.on('DAY_PHASE_ENDED',      this._onDayEndedDoors,   this)

    // Phase-transition camera fade — short fade-out on the OUTGOING
    // phase, fade-in on the INCOMING phase, so day/night swaps feel
    // like a transition instead of a hard cut. World camera only
    // (HUD scene's camera is independent and stays visible).
    EventBus.on('DAY_PHASE_BEGAN',      this._onPhaseFadeIn,  this)
    EventBus.on('NIGHT_PHASE_BEGAN',    this._onPhaseFadeIn,  this)
    EventBus.on('DAY_PHASE_ENDED',      this._onPhaseFadeOut, this)

    // Camera stays put during boss fights per user feedback — the intro
    // slate and bottom HP bar (BossFightOverlay) carry the cinematic on
    // their own without moving the world view.

    // Boss-fight music — starts when adventurer enters boss room, fades out on resolve.
    EventBus.on('BOSS_FIGHT_INCOMING',  this._onBossFightMusicStart, this)
    EventBus.on('BOSS_FIGHT_RESOLVED',  this._onBossFightMusicEnd,   this)
    // Cinematic camera push-in onto the throne for a boss duel (Aldric, below).
    // Reuses the midpoint-aware, follow-suspending fight-cam tween. Zoom-out on
    // resolve is a no-op unless a duel push-in actually snapshotted the pre-fight
    // view.
    EventBus.on('BOSS_FIGHT_RESOLVED',  this._onBossFightZoomOut, this)
    // Aldric — the Act IV climax duel uses the same cinematic push-in + camera
    // lock as the other duels. Release is driven by BOSS_FIGHT_RESOLVED (above),
    // which the duel emits ~2.6s AFTER its finale card — so the finale plays
    // zoomed-in on the throne, then the camera pulls back (the SL pattern).
    EventBus.on('ALDRIC_DUEL_BEGAN', this._onBossFightZoomIn,  this)
    // Persist the save the moment the intro is dismissed so `meta.introSeen`
    // hits disk immediately. The run-start save (ArchetypeSelect) is written
    // BEFORE the intro plays, so without this a player who quits during
    // night 1 — before any phase autosave — would see the intro replay on
    // Continue. Saving here closes that window.
    EventBus.on('INTRO_DISMISSED',      this._onIntroDismissed, this)

    this._setupCamera()
    this._setupInput()
    this.scale.on('resize', this._onSceneResize, this)
    // Tab-refocus camera recovery — see _onTabVisible. The browser relayout
    // on refocus can scroll the world camera into the void; this re-anchors
    // it once the viewport settles.
    this._onTabVisibleBound = () => this._onTabVisible()
    window.addEventListener('focus', this._onTabVisibleBound)
    document.addEventListener('visibilitychange', this._onTabVisibleBound)

    // Beforeunload autosave (fix 2026-05-25): the player closing the tab
    // / refreshing / navigating away SHOULD preserve their current run.
    // Previously the only autosaves fired at scene transitions (start of
    // night phase, end of day, etc.) — close the tab mid-day-29 active
    // fight and the last save was the start of night-before-day-29, so
    // Continue dropped them at the prior night's build phase (the
    // "actual day 27 point" bug). This snapshot catches every close
    // path the player has, including hard tab closes and refreshes.
    // Gated by the autosave setting so a player who explicitly disabled
    // autosaves doesn't have one forced on them at quit.
    this._onBeforeUnloadBound = () => {
      try {
        if (localStorage.getItem('qf.gameplay.autosave') === 'false') return
        // Don't overwrite the save with a dead-boss state — game-over
        // already deleted the save in _onBossFinal; re-saving here
        // would resurrect the dead run.
        if ((this.gameState?.boss?.deathsRemaining ?? 1) <= 0) return
        if (this.gameState) SaveSystem.save(this.gameState)
      } catch {}
    }
    window.addEventListener('beforeunload', this._onBeforeUnloadBound)
    // visibilitychange → hidden also fires on mobile-style tab-hide that
    // doesn't fire beforeunload (some browsers), and on focus loss when
    // the OS suspends the tab. Defensive double-coverage; saves are
    // idempotent.
    this._onVisibilitySaveBound = () => {
      if (document.visibilityState === 'hidden') this._onBeforeUnloadBound()
    }
    document.addEventListener('visibilitychange', this._onVisibilitySaveBound)

    // MiniMap lives on a dedicated HUD scene that doesn't share our world
    // camera's zoom/scroll. Launch it now and hand it the references it
    // needs to read camera state for the viewport indicator.
    this.scene.launch('HudScene', { gameScene: this, gameState: this.gameState })
    this._hudScene = this.scene.get('HudScene')

    // Resume the correct phase scene based on the saved state. Mid-day
    // saves (PauseManager "Save & Exit" mid-wave) stamp meta.phase = 'day'
    // — unconditionally launching NightPhase here strands the game in a
    // broken state: Game.update()'s day branch runs because phase is 'day',
    // but _getDayTimeScale() returns 0 (DayPhase not active), so AI ticks
    // are skipped while renderers keep updating animations. Visually:
    // adventurers + minions "walk in place" with no progress. Launch
    // DayPhase directly in that case; DayPhase.create() detects the
    // mid-wave resume (active.length > 0) and skips the daily wave spawn.
    if (this.gameState?.meta?.phase === 'day') {
      this.scene.launch('DayPhase', { gameState: this.gameState })
    } else {
      this.scene.launch('NightPhase', { gameState: this.gameState })
    }

    EventBus.emit('GAME_STATE_LOADED', this.gameState)
  }

  shutdown() {
    EventBus.off('NIGHT_PHASE_STARTED',  this._onNightStart,   this)
    EventBus.off('REVIVE_FALLEN_REQUEST', this._onReviveFallenRequest, this)
    EventBus.off('REBUILD_TRAPS_REQUEST', this._onRebuildTrapsRequest, this)
    EventBus.off('DAY_PHASE_STARTED',     this._purgeUnrevivedFallen,  this)
    EventBus.off('BOSS_DEFEATED_FINAL',  this._onBossFinal,    this)
    EventBus.off('BOSS_FIGHT_RESOLVED',  this._onBossLifeCommit, this)
    EventBus.off('GRID_EXPANDED',        this._onGridExpanded,  this)
    EventBus.off('BOSS_LEVELED_UP',   this._onBossLeveledUp, this)
    EventBus.off('BOSS_LEVEL_CHANGED', this._onBossLevelChanged, this)
    EventBus.off('ROOM_DEF_SAVED',       this._onRoomDefSaved,  this)
    EventBus.off('ROOMS_ALL_RESET',      this._onRoomsAllReset, this)
    EventBus.off('LOCKS_CHANGED',        this._syncLockedCPs,   this)
    EventBus.off('ADVENTURER_CLICKED',   this._onAdvClicked,   this)
    EventBus.off('ADVENTURER_DIED',      this._onAdvRemoved,   this)
    EventBus.off('ADVENTURER_FLED',      this._onAdvRemoved,   this)
    EventBus.off('NEMESIS_ARRIVED',       this._onNemesisArrived,      this)
    EventBus.off('ADVENTURERS_SPAWNED',  this._onAdvsSpawned,  this)
    EventBus.off('LOOT_GOBLIN_ESCAPED',  this._onLootGoblinEscaped, this)
    EventBus.off('DUNGEON_EVENT_BEGAN',  this._onDungeonEventBegan, this)
    EventBus.off('DUNGEON_EVENT_ENDED',  this._onDungeonEventEnded, this)
    EventBus.off('DAY_PHASE_ENDED',      this._onDayEnded,     this)
    EventBus.off('DAY_PHASE_STARTED',    this._onDayStartedDoors, this)
    EventBus.off('DAY_PHASE_ENDED',      this._onDayEndedDoors,   this)
    EventBus.off('DAY_PHASE_BEGAN',      this._onPhaseFadeIn,  this)
    EventBus.off('NIGHT_PHASE_BEGAN',    this._onPhaseFadeIn,  this)
    EventBus.off('DAY_PHASE_ENDED',      this._onPhaseFadeOut, this)
    EventBus.off('BOSS_FIGHT_INCOMING',  this._onBossFightMusicStart, this)
    EventBus.off('BOSS_FIGHT_RESOLVED',  this._onBossFightMusicEnd,   this)
    EventBus.off('BOSS_FIGHT_RESOLVED',  this._onBossFightZoomOut, this)
    EventBus.off('ALDRIC_DUEL_BEGAN',      this._onBossFightZoomIn,  this)
    EventBus.off('INTRO_DISMISSED',      this._onIntroDismissed, this)
    GameplayMusic.bossFightEnd(true)   // immediate stop if scene tears down mid-fight
    this.scale.off('resize', this._onSceneResize, this)
    if (this._resizeSettleTimer != null) { clearTimeout(this._resizeSettleTimer); this._resizeSettleTimer = null }
    if (this._onTabVisibleBound) {
      window.removeEventListener('focus', this._onTabVisibleBound)
      document.removeEventListener('visibilitychange', this._onTabVisibleBound)
      this._onTabVisibleBound = null
    }
    if (this._onBeforeUnloadBound) {
      window.removeEventListener('beforeunload', this._onBeforeUnloadBound)
      this._onBeforeUnloadBound = null
    }
    if (this._onVisibilitySaveBound) {
      document.removeEventListener('visibilitychange', this._onVisibilitySaveBound)
      this._onVisibilitySaveBound = null
    }
    this.scene.stop('HudScene')

    // Tear down every system / renderer registered via track() in create().
    // Iterating a registry replaced the prior 50-line hand-maintained
    // destroy chain — that pattern silently leaked any system whose
    // destroy call was forgotten (e.g. BossArchetypeSystem, which caused
    // the vampire-charm-on-every-archetype bug because the leaked
    // previous-run instance kept reacting to ADVENTURERS_SPAWNED with
    // stale archetype state). Reverse order so teardown mirrors
    // construction — safer if any destroy() reads sibling system state.
    for (let i = this._lifecycle.length - 1; i >= 0; i--) {
      const obj = this._lifecycle[i]
      try { obj.destroy() }
      catch (e) { console.error('[Game] destroy failed for', obj?.constructor?.name, e) }
    }
    this._lifecycle = []
  }

  // Anti-save-scum commit (2026-05-31). When the boss loses a life, the
  // decrement only lived in memory until the NEXT NIGHT_PHASE_STARTED autosave
  // — so a player could quit during the day (hard close / crash / mobile
  // app-switch, or with autosave turned off where the beforeunload save bails)
  // and reload to the pre-death night save, undoing the loss. We close that
  // window by committing the moment the life is lost.
  //
  // UNCONDITIONAL by design: this ignores the qf.gameplay.autosave setting.
  // That toggle governs *convenience* autosaves (build progress), not
  // permadeath consequences — letting it off hand out free life-undos was the
  // loophole. Same philosophy as the run-start + INTRO_DISMISSED saves, which
  // are also unconditional. Final death needs no save here: _onBossFinal
  // DELETES the save (no resumable dead run), so we skip deathsRemaining <= 0.
  _onBossLifeCommit({ winner } = {}) {
    if (winner !== 'party') return                                   // boss won → no life lost
    if ((this.gameState?.boss?.deathsRemaining ?? 0) <= 0) return    // final death handled by _onBossFinal
    try { SaveSystem.save(this.gameState) } catch {}
  }

  _onBossFinal() {
    // Stop everything and show the DOM Game Over overlay. HudScene stays
    // alive so GameOverOverlay can mount over the dimmed dungeon view; the
    // overlay handles RISE AGAIN by starting MainMenu itself.
    //
    // Save deletion (fix 2026-05-25): wipe the save the moment the run is
    // ABSOLUTELY over (boss out of lives — Phylactery would have intercepted
    // earlier if applicable). GameOverOverlay doesn't delete on its own, so
    // without this the dead run stays in localStorage and CONTINUE would
    // resume it. Deleting here also survives the player closing the tab on
    // the Game Over screen — a dead boss must never leave a resumable save.
    try { SaveSystem.deleteSave?.() } catch {}
    this.scene.stop('NightPhase')
    this.scene.stop('DayPhase')
    this.scene.stop('EndOfDay')
    EventBus.emit('SHOW_GAME_OVER')
  }

  // Merge a room def's static connection points with the live room's
  // saved CPs. Def CPs win on identity (template-defined doors / external
  // exits), but inherit any saved open/opening/openProgress state. Saved
  // CPs that don't match a def CP are auto-pair connections generated by
  // DungeonGrid._autoConnect() when the room was placed adjacent to a
  // neighbour — we keep those verbatim, otherwise the door tile is left
  // orphaned and the room becomes unreachable from that side.
  _mergeRoomConnectionPoints(room, def) {
    const sameSpot = (a, b) => a.x === b.x && a.y === b.y && a.direction === b.direction
    const savedCPs = Array.isArray(room.connectionPoints) ? room.connectionPoints : []
    const defCPs   = (def.connectionPoints ?? []).map(cp => ({ ...cp }))
    const merged   = defCPs.map(dcp => {
      const saved = savedCPs.find(s => sameSpot(s, dcp))
      return saved
        ? { ...dcp, open: saved.open, opening: saved.opening, openProgress: saved.openProgress }
        : dcp
    })
    // Auto-pair CPs (created by DungeonGrid._autoConnect when the room was
    // placed next to a neighbour) are the only saved CPs we keep that aren't
    // in the def. External / entrance CPs are template-defined — they come from
    // the def, never from auto-connect (auto-pairs are always external:false).
    // So a saved external/entrance CP that no longer matches a def CP means the
    // def MOVED the entrance (e.g. re-centred it); keep only the def's new
    // position, or the stale one survives as a phantom duplicate doorway.
    const autoPairs = savedCPs.filter(s =>
      !s.external && s.style !== 'entrance' &&
      !defCPs.some(dcp => sameSpot(dcp, s)))
    room.connectionPoints = [...merged, ...autoPairs]
  }

  // Room Builder emits this whenever it saves a room def to localStorage.
  // We rewrite the tile grid for every already-placed instance so structural
  // edits (floor/wall layout, doorway positions) appear immediately in the
  // dungeon without the player having to remove + re-place the room.
  // The renderer redraw is called last, after all tile data is current.
  _onRoomDefSaved({ roomId }) {
    const roomDefs = this.cache.json.get('rooms') ?? []
    const def = roomDefs.find(d => d.id === roomId)
    if (!def) return
    for (const room of this.gameState.dungeon.rooms) {
      if (room.definitionId !== roomId) continue
      // Rotated rooms need the def rotated to the same orientation
      // before merging — otherwise the unrotated tileLayout / CP
      // positions get stamped onto a rotated footprint (mismatched
      // overlay sprites, doors in the wrong walls).
      const rotDef = getRotatedDef(def, room.rotation ?? 0)
      // Sync the room instance's connectionPoints with the updated def so
      // doorway positions stay accurate for neighbour lookups. Auto-pair
      // CPs are preserved so door↔neighbour links survive a def edit.
      this._mergeRoomConnectionPoints(room, rotDef)
      this._refreshRoomFromDef(room, rotDef)
      this.dungeonGrid.reapplyRoomDef(room, rotDef)
    }
    this._dungeonRenderer?.redraw()
  }

  // Pull the editor-authored sprite/painting fields from the def onto the
  // live room instance. Without this, edits made in RoomTileEditor save to
  // rooms.json + the cache but never reach the runtime room object, so
  // DungeonRenderer keeps drawing the OLD doorTiles/theme/tileLayout.
  _refreshRoomFromDef(room, def) {
    if ('theme'       in def) room.theme       = typeof def.theme      === 'string' ? def.theme      : null
    if ('doorTheme'   in def) room.doorTheme   = typeof def.doorTheme  === 'string' ? def.doorTheme  : null
    if ('tileLayout'  in def) room.tileLayout  = Array.isArray(def.tileLayout) ? def.tileLayout : []
    if ('doorTiles'   in def) room.doorTiles   = (def.doorTiles && typeof def.doorTiles === 'object') ? def.doorTiles : null
    room.doorApron = (def.doorApron && typeof def.doorApron === 'object') ? def.doorApron : null
    // Per-boss door swatches + single-image door skins. Stripped-when-empty, so
    // apply unconditionally (absent = cleared) — without this a door skin
    // applied in the editor never reaches the live room and the old door art
    // keeps rendering.
    room.doorTilesByBoss = (def.doorTilesByBoss && typeof def.doorTilesByBoss === 'object') ? def.doorTilesByBoss : null
    room.doorApronByBoss = (def.doorApronByBoss && typeof def.doorApronByBoss === 'object') ? def.doorApronByBoss : null
    room.doorSkin        = (def.doorSkin && typeof def.doorSkin === 'object') ? def.doorSkin : null
    room.doorSkinByBoss  = (def.doorSkinByBoss && typeof def.doorSkinByBoss === 'object') ? def.doorSkinByBoss : null
    room.doorSkinSize    = (def.doorSkinSize && typeof def.doorSkinSize === 'object') ? def.doorSkinSize : null
    room.doorSkinEntrance     = (def.doorSkinEntrance && typeof def.doorSkinEntrance === 'object') ? def.doorSkinEntrance : null
    room.doorSkinSizeEntrance = (def.doorSkinSizeEntrance && typeof def.doorSkinSizeEntrance === 'object') ? def.doorSkinSizeEntrance : null
    // These fields are STRIPPED from the saved def when empty (decorations,
    // colorAdjust, backgroundImage). An absent field therefore means "cleared"
    // — apply unconditionally so e.g. resetting a room's colour or removing its
    // skin actually takes effect on the live room (not just on disk).
    room.decorations     = Array.isArray(def.decorations) ? def.decorations : []
    room.colorAdjust     = (def.colorAdjust && typeof def.colorAdjust === 'object') ? def.colorAdjust : null
    room.backgroundImage = typeof def.backgroundImage === 'string' ? def.backgroundImage : null
    room.backgroundImageByBoss = (def.backgroundImageByBoss && typeof def.backgroundImageByBoss === 'object') ? def.backgroundImageByBoss : null
  }

  // Room Builder reset ALL rooms — reapply every placed room's tile grid
  // from the current (freshly-cleared) cache defs in a single pass, then
  // redraw once.
  _onRoomsAllReset() {
    this._reapplyAllRoomDefs()
    this._dungeonRenderer?.redraw()
  }

  // Phase: items — propagate `gameState.dungeon.locks[]` onto each
  // affected connection point's `cp.locked` flag. DungeonRenderer reads
  // `cp.locked` in `_doorStateFor()` to pick the locked door variant
  // sprite, so this needs to run any time the locks list mutates: on
  // place, sell, unlock, break, and night reset (also at scene create
  // so a saved game restores the locked sprites).
  _syncLockedCPs() {
    for (const room of this.gameState.dungeon?.rooms ?? []) {
      for (const cp of room.connectionPoints ?? []) cp.locked = false
    }
    for (const lock of this.gameState.dungeon?.locks ?? []) {
      if (lock.unlocked || lock.broken) continue
      for (const t of lock.doorTiles) {
        const info = this.dungeonGrid?.getCpForDoorTile?.(t.x, t.y)
        if (info?.cp) info.cp.locked = true
      }
    }
    this._dungeonRenderer?.redrawDoors?.()
  }

  // Gold floor maintained for the mango cheat — anything below is
  // topped back up every update tick.
  static get MANGO_GOLD_FLOOR() { return 9999 }

  // Mango cheat — flatten every JSON def's unlockLevel to 1, back-fill
  // the gameState.unlocks allowlists so every room / minion / trap /
  // item is available from boss level 1, AND seed the gold to the
  // 9999 floor so a fresh-into-cheat run has buying power immediately
  // (the per-tick refill in update() keeps it topped up after spends).
  // Called once from create() when PlayerProfile.isCheatName() is
  // true. Mutates Phaser's cached defs in place; the change persists
  // until the page reloads (next run by a non-cheat name will need a
  // refresh to restore gates).
  _applyMangoCheatUnlocks() {
    // 1) Stamp unlockLevel = 1 on every gated def — and SNAPSHOT the original
    //    value first, so _revertMangoCheatUnlocks can restore it cleanly
    //    when the player switches off the cheat name. The snapshot lives on
    //    the Phaser game instance (survives scene restarts in the same page
    //    session, but gone after a real page reload — which gets a fresh
    //    JSON cache and doesn't need the revert). Idempotent: a snapshot
    //    that already exists is preserved (re-snapshotting after the cache
    //    is already mutated would store 1s and break the revert path).
    const game = this.game
    game._mangoUnlockSnap = game._mangoUnlockSnap ?? {}
    const snap = game._mangoUnlockSnap
    const keys = ['rooms', 'minionTypes', 'trapTypes', 'items']
    let touched = 0
    for (const key of keys) {
      const defs = this.cache.json.get(key)
      if (!Array.isArray(defs)) continue
      snap[key] = snap[key] ?? {}
      for (const def of defs) {
        if (def && (def.unlockLevel ?? 1) > 1) {
          if (!(def.id in snap[key])) snap[key][def.id] = def.unlockLevel
          def.unlockLevel = 1
          touched++
        }
      }
    }
    // 2) Back-fill the allowlists in gameState.unlocks so any IDs added
    //    to JSON since this save was first initialised still appear in
    //    the build menus (NightPhase / EventSystem / DungeonGrid all
    //    intersect against these lists).
    const u = this.gameState.unlocks ?? (this.gameState.unlocks = {})
    const ensureAll = (slot, defs) => {
      if (!Array.isArray(defs)) return
      const have = new Set(u[slot] ?? [])
      for (const d of defs) if (d?.id) have.add(d.id)
      u[slot] = [...have]
    }
    ensureAll('rooms',       this.cache.json.get('rooms'))
    ensureAll('minionTypes', this.cache.json.get('minionTypes'))
    ensureAll('trapTypes',   this.cache.json.get('trapTypes'))
    // Items don't have an allowlist — they're gated purely by
    // unlockLevel, which step 1 already neutralised.

    // 3) Seed gold to the floor so the player has buying power
    //    immediately. The update() tick keeps it topped up after spends.
    const p = this.gameState.player ?? (this.gameState.player = {})
    if ((p.gold ?? 0) < Game.MANGO_GOLD_FLOOR) p.gold = Game.MANGO_GOLD_FLOOR

    console.info(`[Mango cheat] Unlocked every room/minion/trap/item (${touched} defs flattened); gold pinned at ${Game.MANGO_GOLD_FLOOR}.`)
  }

  // Revert the mango-cheat cache mutation: walk the snapshot stored on the
  // game instance by _applyMangoCheatUnlocks and restore each def's original
  // unlockLevel, then drop the snapshot. No-op when there's no snapshot (the
  // cheat never ran in this page session). Called on every non-mango Game-
  // scene boot so a player who tests as mango and switches to a real name
  // gets correct unlock-gating without a page reload.
  //
  // NOTE: the gameState.unlocks allowlists back-filled in step (2) above are
  // per-save and per-name (SaveSystem is name-scoped as of 2026-05-29), so
  // they need no separate revert — a non-mango Game boot loads that name's
  // own gameState whose unlocks reflect their actual progress.
  _revertMangoCheatUnlocks() {
    const snap = this.game?._mangoUnlockSnap
    if (!snap) return
    const keys = ['rooms', 'minionTypes', 'trapTypes', 'items']
    let restored = 0
    for (const key of keys) {
      const bucket = snap[key]
      if (!bucket) continue
      const defs = this.cache.json.get(key)
      if (!Array.isArray(defs)) continue
      const byId = {}
      for (const d of defs) if (d?.id) byId[d.id] = d
      for (const id of Object.keys(bucket)) {
        const def = byId[id]
        if (def) { def.unlockLevel = bucket[id]; restored++ }
      }
    }
    this.game._mangoUnlockSnap = null
    if (restored > 0) console.info(`[Mango cheat] Reverted cache mutation — restored ${restored} unlockLevel values.`)
  }

  // Reapply current room definitions to every placed room instance.
  // Shared by the on-load fix and the live ROOMS_ALL_RESET event handler.
  // Door↔neighbour links are preserved via _mergeRoomConnectionPoints()
  // so a continued save doesn't end up with orphaned door tiles between
  // rooms that DungeonGrid._autoConnect() linked at placement time.
  _reapplyAllRoomDefs() {
    const roomDefs = this.cache.json.get('rooms') ?? []
    const defMap   = Object.fromEntries(roomDefs.map(d => [d.id, d]))
    for (const room of this.gameState.dungeon.rooms) {
      const def = defMap[room.definitionId]
      if (!def) continue
      // Rotated rooms (room.rotation > 0) need the def rotated to match
      // the saved orientation before any of the apply steps run. Without
      // this, _refreshRoomFromDef stamps the unrotated tileLayout onto a
      // rotated footprint, producing the patchy / mismatched overlay
      // sprites the user saw on continued saves of rotated rooms.
      const rotDef = getRotatedDef(def, room.rotation ?? 0)
      this._mergeRoomConnectionPoints(room, rotDef)
      this._refreshRoomFromDef(room, rotDef)
      this.dungeonGrid.reapplyRoomDef(room, rotDef)
    }
    // Rebuild the solid-decor tile set after all rooms have been reapplied.
    this.dungeonGrid.rebuildSolidDecors()
  }

  // The intro was just delivered + dismissed — `meta.introSeen` is now
  // true on the live gameState. Persist it straight away so a Continue
  // started before the first phase autosave doesn't replay the intro.
  // Unconditional (not gated by the AUTOSAVE setting) for the same reason
  // ArchetypeSelect's run-start save is: the save file already exists, and
  // the intro closes before the player builds anything, so this only
  // corrects the flag — it doesn't capture build progress.
  _onIntroDismissed() {
    if (this.gameState) SaveSystem.save(this.gameState)
  }

  _onNightStart() {
    // Apply any pending grid growth FIRST — it shifts boss + minion tile
    // coords and re-anchors the dungeon. Doing it before respawnAll
    // ensures revived dead minions land at the right (post-shift) tiles,
    // and before trapSystem.resetAll so traps are at their final coords
    // when state is wiped fresh. (2026-05-27 — symmetric grid expansion.)
    this._applyPendingGridGrowth()
    // Minion tier upgrades now PERSIST through death (2026-05-29) — there's no
    // evolution reset; respawnAll rescales each minion from its upgraded base,
    // so a revived minion returns at the tier the player paid for.
    this.minionAiSystem?.respawnAll()
    this.trapSystem?.resetAll()
    // Safety: if the boss fight ended without resolving (all fled etc.),
    // BOSS_FIGHT_RESOLVED already handled this — this is a belt-and-suspenders
    // guard to ensure boss music never leaks into the night phase.
    GameplayMusic.bossFightEnd(true)
  }

  // Pay-to-revive (2026-05-28) — the night-phase REVIVE button. Charges gold
  // here (the single charge site), then MinionAISystem.reviveFallen performs
  // the revive transform. Cost + eligibility come from the shared
  // util/minionRevive helpers, so this charge always matches the price the
  // build menu displays. No-ops outside the night/build phase or when there's
  // nothing fallen.
  _onReviveFallenRequest() {
    const gs = this.gameState
    if (!gs || gs.meta?.phase !== 'night') return
    const fallen = fallenRevivable(gs)
    if (fallen.length === 0) return
    // None of the fallen fit their rooms (each is full to MINIONS_PER_ROOM_CAP of
    // live minions) — nothing can be revived. Say so instead of charging 0 / no-op.
    if (reviveCapAllowed(gs, fallen).length === 0) {
      EventBus.emit('SHOW_TOAST', {
        message: 'Those rooms are full — sell or move a minion to make space, then revive.',
        type: 'error',
      })
      return
    }
    const minionDefs = this.cache.json.get('minionTypes') ?? []
    const chains     = this.cache.json.get('minionEvolutions')
    const total      = totalReviveCost(gs, minionDefs, chains)
    const have       = gs.player?.gold ?? 0

    // Can afford everyone (or dev infinite gold) — revive all, as before.
    if (Balance.DEV_INFINITE_GOLD || have >= total) {
      if (!Balance.DEV_INFINITE_GOLD && total > 0) gs.player.gold -= total
      this._finishRevive(null)
      return
    }

    // Can't afford all → plan both priorities so the player can choose.
    const candidates = reviveCandidates(gs, minionDefs, chains)
    const strongest  = planRevive(candidates, have, 'strongest')
    const quantity   = planRevive(candidates, have, 'quantity')

    // Can't even afford the cheapest one — no choice to make, just say so.
    if (strongest.count === 0 && quantity.count === 0) {
      const costs = candidates.map(c => c.cost).filter(c => c > 0)
      const cheapest = costs.length ? Math.min(...costs) : 0
      EventBus.emit('SHOW_TOAST', {
        message: `Not enough gold to revive any (cheapest is ${cheapest}g).`,
        type: 'error',
      })
      return
    }

    // Otherwise hand the strength-vs-quantity tradeoff to the player.
    EventBus.emit('SHOW_REVIVE_CHOICE', {
      fallenCount: fallen.length,
      totalCost:   total,
      have,
      strongest,
      quantity,
      onPick: (mode) => {
        const plan = mode === 'quantity' ? quantity : strongest
        if (plan.cost > 0) gs.player.gold -= plan.cost
        this._finishRevive(plan.ids)
      },
    })
  }

  // Shared revive completion: revives the chosen set (null = all), plays the
  // press SFX, and toasts how many are still fallen after a partial revive.
  _finishRevive(ids) {
    const revived = this.minionAiSystem?.reviveFallen(ids) ?? 0
    if (revived <= 0) return
    try {
      const key = this.cache.audio.exists('sfx-revive-minions') ? 'sfx-revive-minions'
                : this.cache.audio.exists('sfx-revive')          ? 'sfx-revive' : null
      if (key) playSfx(this.sound, key, 0.7)
    } catch { /* audio not ready — non-fatal */ }
    const remaining = fallenRevivable(this.gameState).length
    if (remaining > 0) {
      EventBus.emit('SHOW_TOAST', {
        message: `Revived ${revived} — ${remaining} still fallen.`,
        type: 'success',
      })
    }
  }

  // Pay-to-rebuild (2026-05-29) — the night-phase REBUILD button. Traps have a
  // 5% chance to break after firing on an adventurer (TrapSystem removes them
  // and snapshots them onto dungeon._brokenTraps). This charges gold here (the
  // single charge site) at half each trap's current build cost, then restores
  // every broken trap to dungeon.traps at its original tile/facing with fresh
  // state so the renderer + TrapSystem pick them straight back up. No-ops
  // outside the night/build phase, when nothing is broken, on a locked
  // (Insomniac) night, or when the player can't afford the full batch.
  _onRebuildTrapsRequest() {
    const gs = this.gameState
    if (!gs || gs.meta?.phase !== 'night') return
    // The Insomniac — a sealed night blocks all building, rebuilds included.
    if (gs._mechanicFlags?.insomniacLockTonight) {
      EventBus.emit('SHOW_TOAST', {
        message: 'The Insomniac — the dungeon is sealed tonight.',
        type: 'error',
      })
      return
    }
    const broken = brokenTraps(gs)
    if (broken.length === 0) return
    const trapDefs = this.cache.json.get('trapTypes') ?? []
    const total    = totalTrapRebuildCost(gs, trapDefs)
    const have     = gs.player?.gold ?? 0

    if (!Balance.DEV_INFINITE_GOLD && have < total) {
      EventBus.emit('SHOW_TOAST', {
        message: `Not enough gold to rebuild traps (need ${total}g).`,
        type: 'error',
      })
      return
    }
    if (!Balance.DEV_INFINITE_GOLD && total > 0) gs.player.gold -= total

    const byId = {}
    for (const d of trapDefs) byId[d.id] = d
    const dungeon = gs.dungeon
    dungeon.traps ??= []
    let rebuilt = 0
    for (const snap of broken) {
      const def = byId[snap.definitionId]
      if (!def) continue
      const trap = createTrap(def, { tileX: snap.tileX, tileY: snap.tileY, facing: snap.facing })
      trap.instanceId = snap.instanceId   // keep the original id so knowledge/refs reconnect
      dungeon.traps.push(trap)
      rebuilt++
    }
    dungeon._brokenTraps = []

    if (rebuilt > 0) {
      try {
        const keys = ['sfx-build-1', 'sfx-build-2', 'sfx-build-3'].filter(k => this.cache.audio.exists(k))
        const key  = keys.length ? keys[Math.floor(Math.random() * keys.length)] : null
        if (key) playSfx(this.sound, key, 0.7)
      } catch { /* audio not ready — non-fatal */ }
      EventBus.emit('TRAPS_REBUILT', { count: rebuilt })
      EventBus.emit('SHOW_TOAST', {
        message: `Rebuilt ${rebuilt} trap${rebuilt === 1 ? '' : 's'}.`,
        type: 'success',
      })
    }
  }

  // Lost-at-day-start: when the day begins, any fallen minion the player
  // didn't pay to revive during the build phase is gone for good. Uses the
  // shared predicate so only revivable fallen are purged — permanent-death
  // specials were already stripped by respawnAll at night start.
  _purgeUnrevivedFallen() {
    const gs = this.gameState
    if (!gs?.minions?.length) return
    const lost = fallenRevivable(gs)
    if (lost.length === 0) return
    const lostIds = new Set(lost.map(m => m.instanceId))
    gs.minions = gs.minions.filter(m => !lostIds.has(m.instanceId))
    EventBus.emit('MINIONS_LOST_FALLEN', { count: lost.length })
  }

  // ── Camera follow ─────────────────────────────────────────────────────────

  _onAdvClicked({ adventurer }) {
    this._setFollow(adventurer.instanceId)
  }

  // The Nemesis (Aldric) enters — zoom in + follow him by default so the player
  // sees his arrival. The smooth follow lerp tracks him; WASD/drag releases the
  // follow (see the scroll handlers). Only acts during the day phase.
  _onNemesisArrived({ adventurer } = {}) {
    if (!adventurer?.instanceId || this.gameState.meta?.phase !== 'day') return
    this._setFollow(adventurer.instanceId)
    const cam = this._cam
    if (!cam) return
    const target = Math.min(1.4, Balance.CAMERA_ZOOM_MAX ?? 1.4)
    if (cam.zoom < target) {
      this.tweens.add({ targets: cam, zoom: target, duration: 600, ease: 'Sine.easeOut' })
    }
  }

  _onAdvRemoved({ adventurer }) {
    if (this._followId !== adventurer?.instanceId) return
    const next = this.gameState.adventurers.active.find(
      a => a.instanceId !== adventurer.instanceId
    )
    this._setFollow(next?.instanceId ?? null)
  }

  _onAdvsSpawned({ adventurers }) {
    if (!adventurers?.length) return
    // Wait for DayPhase's entry-hall camera tween (~600ms) to finish before
    // handing the camera over to follow mode.
    this.time.delayedCall(750, () => {
      if (!this._followId) this._setFollow(adventurers[0].instanceId)
    })
  }

  // Loot Goblin escape feedback. Red "-Ng" floater at the goblin's last
  // world position + a center-screen toast banner so the gold drain is
  // unmissable. Without this the gold counter just silently drops.
  _onLootGoblinEscaped({ adventurer, stolen }) {
    if (!stolen || stolen <= 0) return
    const wx = adventurer?.worldX
    const wy = adventurer?.worldY
    if (typeof wx === 'number' && typeof wy === 'number') {
      AbilityVfx.floatingText(this, wx, wy - 18, `-${stolen}g`, {
        color: '#ff5555', fontSize: '14px', durationMs: 900, driftY: -36, depth: 95,
      })
    }
    const cam = this.cameras?.main
    if (!cam) return
    const cx = cam.midPoint.x
    const cy = cam.midPoint.y - 80
    const banner = this.add.text(cx, cy, `GOBLIN ESCAPED · -${stolen}g`, {
      fontSize: '20px', color: '#ff7777', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(120).setScrollFactor(0)
    this.tweens.add({
      targets:  banner,
      alpha:    { from: 1, to: 0 },
      y:        cy - 40,
      duration: 1400,
      ease:     'Quad.easeOut',
      onComplete: () => banner.destroy(),
    })
  }

  // Per-event ambient overlays.
  //
  // [Removed 2026-05-25] Phaser-side `_buildBloodMoonOverlay` +
  // `_buildEventTint` graphics overlays. Both drew a `cam.width × cam.height`
  // fill at world (0,0) with `setScrollFactor(0)` — but in Phaser that
  // does NOT make the graphics camera-relative. The rect rendered in
  // WORLD coordinates as a fixed 1280×720 chunk of the play area,
  // showing as a dark-red square that obscured rooms during Blood Moon
  // Eclipse (and a wrong-colour square for fog / miasma / arcane
  // storm). The DOM-side `EventFx` layer (`src/hud/EventFx.js` +
  // `fx-bloodmoon` / `fx-fog` / `fx-miasma` / `fx-arcane` classes in
  // styles.css) already paints the correct full-screen radial wash +
  // vignette over the actual viewport via CSS — that's the gentle
  // atmospheric red tint visible in the working screenshot. Removing
  // the Phaser duplicate.
  _onDungeonEventBegan(_payload) {
    // No-op — DOM EventFx handles every event's scene-wide chrome.
  }

  _onDungeonEventEnded(_payload) {
    // No-op — DOM EventFx tears down its own chrome on
    // DUNGEON_EVENT_ENDED.
  }

  // Phase-transition camera fade. Short, world-camera only — HUD stays
  // visible the whole time. Re-entrant by design: a phase change while
  // a previous fade is mid-tween just kicks off a new fadeIn (Phaser's
  // FadeIn effect cancels any in-flight fade automatically).
  _onPhaseFadeIn() {
    this._cam?.fadeIn?.(280, 0, 0, 0)
  }
  _onPhaseFadeOut() {
    this._cam?.fadeOut?.(220, 0, 0, 0)
  }

  _onDayEnded() {
    // Clear follow state silently — DayPhase UI is already tearing down.
    this._followId = null
    this._duelCamLock = false   // safety: never leave the duel lock set across phases
    // Wipe all floor hazards (acid puddles, fire/poison trails) — they last for
    // the raid then dissolve when the day ends; nothing carries into the next day.
    if (this.gameState?.dungeon) this.gameState.dungeon.hazards = []
    // The intel/knowledge heat map button lives on DayPhase, which is
    // shutting down. The overlay graphics live on this (Game) scene and
    // would otherwise stay visible into the night. Force-off here so the
    // map clears and the next day starts with the toggle off.
    this.knowledgeOverlay?.setEnabled(false)
  }

  // Day-start: animate-open every external cp (currently just entry_hall's
  // north entrance) so the dungeon's doorway swings open as adventurers
  // arrive. cps that aren't external are left in whatever state they're in
  // (closed for the first run, retained-open after first traversal).
  _onDayStartedDoors() {
    const r = this._dungeonRenderer
    if (!r) return
    for (const room of this.gameState.dungeon.rooms ?? []) {
      for (const cp of room.connectionPoints ?? []) {
        if (cp.external) r.openDoor(cp)
      }
    }
  }

  // Day-end: hard-close every cp (no animation) so the next day starts
  // with a fresh dungeon.  External doors re-animate open at day-start
  // (see _onDayStartedDoors), and internal doors swing open again the
  // first time an adventurer steps onto them — same as the very first
  // day.  Without this reset, internal doors stayed open forever after
  // first traversal.
  _onDayEndedDoors() {
    const r = this._dungeonRenderer
    if (!r) return
    for (const room of this.gameState.dungeon.rooms ?? []) {
      for (const cp of room.connectionPoints ?? []) {
        r.closeDoor(cp)
      }
    }
  }

  _setFollow(id) {
    this._followId = id
    const name = id
      ? (this.gameState.adventurers.active.find(a => a.instanceId === id)?.name ?? null)
      : null
    EventBus.emit('CAMERA_FOLLOW_CHANGED', { id, name })
  }

  // Phase 6e: cache the chosen archetype's modifiers on gameState so other
  // systems (EvolutionSystem, NightPhase trap palette, AISystem gold award)
  // can apply them without re-fetching the JSON each tick.
  _cacheArchetypeModifiers() {
    const id = this.gameState.player?.bossArchetypeId
    if (!id) return
    const archs = this.cache.json.get('bossArchetypes') ?? []
    const arch = archs.find(a => a.id === id)
    if (arch?.modifiers) {
      this.gameState.player.archetypeModifiers = { ...arch.modifiers }
    }
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  // Minimum zoom that still fits the full dungeon map in the viewport.
  // Shrinks as the map expands so the player can always zoom out to see everything.
  // The DOM HUD chrome footprint in LOGICAL (CSS) pixels — these MUST match the
  // --hud-side / --hud-top / --hud-bottom CSS vars in hud/styles.css. The DOM HUD
  // renders at a FIXED logical size (scaled only by the UI-scale zoom), so the
  // gameplay camera reserves the same fixed footprint — converted to canvas px —
  // rather than a fraction of the viewport. (The old min(sw/1280,sh/720) scaling
  // assumed the HUD shrank/grew with the window; once the HUD became native
  // fixed-px, that under-reserved at small windows and the dungeon ran behind the
  // panels, e.g. the boss appearing to walk outside the room.)
  static get _PLAY_AREA_INSETS() {
    return { left: 320, right: 320, top: 96, bottom: 116 }
  }

  // A thin breathing margin (logical px) kept between the dungeon view and the
  // HUD on EVERY side, on top of the panel footprint above — so the dungeon
  // never sits flush against (or under) the chrome. A small "void" border
  // reads cleaner and stops the UI from crowding/blocking the dungeon view.
  // Tunable; scales with uiScale/DPR like the insets do. (Per-axis tweakable
  // if the top ever needs a different amount than the sides.)
  static get _VIEW_GUTTER() { return 24 }

  // The play area is the sub-rectangle of the canvas not covered by HUD chrome,
  // returned in canvas pixels. The HUD footprint is `logical px × uiScale`
  // (the DOM zoom) × `canvas/CSS ratio` (the device pixel ratio).
  _computePlayArea() {
    const sw  = this.scale.width
    const sh  = this.scale.height
    const uiS = effectiveUiScale()
    const cssW = (typeof window !== 'undefined' && window.innerWidth)  || sw
    const cssH = (typeof window !== 'undefined' && window.innerHeight) || sh
    const rx  = sw / cssW   // canvas px per CSS px on X (≈ devicePixelRatio)
    const ry  = sh / cssH
    const ins = Game._PLAY_AREA_INSETS
    const g   = Game._VIEW_GUTTER
    return {
      left:   (ins.left   + g) * uiS * rx,
      right:  (ins.right  + g) * uiS * rx,
      top:    (ins.top    + g) * uiS * ry,
      bottom: (ins.bottom + g) * uiS * ry,
      sw, sh,
    }
  }

  // Padding (in tiles) kept around the placed-room bounding box — this is the
  // room you get to PAN and BUILD past the current dungeon edge. It needs to be
  // comfortably bigger than one room (rooms run up to ~14 tiles wide) so you can
  // pan out far enough to place the next room and move the view around; too
  // small and the camera feels locked, too large and you reach the empty grid
  // void. Tunable. (Clamped to the grid in _contentBoundsPx.)
  static get _CONTENT_PAD_TILES() { return 16 }

  // World-pixel rectangle the camera is allowed to frame: the bounding box
  // of all placed rooms, padded by _CONTENT_PAD_TILES and clamped to the
  // grid. This is what kills the black void at the edges — the clamp/zoom
  // used to be expressed against the FULL grid (gridWidth×gridHeight), most
  // of which is empty early on, so the player could pan/zoom into nothing.
  // Falls back to the full grid when no rooms exist yet (nothing to frame).
  _contentBoundsPx() {
    const d = this.gameState.dungeon
    const gw = d.gridWidth, gh = d.gridHeight
    const rooms = d.rooms || []
    if (!rooms.length) return { x0: 0, y0: 0, x1: gw * TS, y1: gh * TS }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const r of rooms) {
      if (r.gridX < minX) minX = r.gridX
      if (r.gridY < minY) minY = r.gridY
      if (r.gridX + r.width  > maxX) maxX = r.gridX + r.width
      if (r.gridY + r.height > maxY) maxY = r.gridY + r.height
    }
    const PAD = Game._CONTENT_PAD_TILES
    minX = Math.max(0,  minX - PAD)
    minY = Math.max(0,  minY - PAD)
    maxX = Math.min(gw, maxX + PAD)
    maxY = Math.min(gh, maxY + PAD)
    return { x0: minX * TS, y0: minY * TS, x1: maxX * TS, y1: maxY * TS }
  }

  _computeMinZoom() {
    const cb = this._contentBoundsPx()
    const contentW = cb.x1 - cb.x0
    const contentH = cb.y1 - cb.y0
    const pa = this._computePlayArea()
    const playW = pa.sw - pa.left - pa.right
    const playH = pa.sh - pa.top  - pa.bottom
    // Min zoom such that the framed content (rooms + pad) FILLS the play
    // area on both axes (the larger of the two ratios). Prevents zooming
    // out far enough to reveal empty grid around the dungeon — the
    // trade-off is the player can't see the whole content at once if its
    // aspect ratio differs from the play area's; they pan to see the rest.
    return Math.max(playW / contentW, playH / contentH)
  }

  // Camera scroll clamp + auto-centering, expressed against the *play area*
  // (the rectangle between the HUD panels) instead of the full canvas. The
  // camera viewport is still the whole canvas — that keeps geometry masks
  // working correctly — but the scroll is constrained so the dungeon never
  // hides behind a panel and centres in the play area when the player has
  // zoomed out far enough that the dungeon doesn't fill the viewport.
  _clampCameraToPlayArea() {
    const cam = this._cam
    if (!cam) return
    // Frame the placed rooms (+ pad), NOT the whole grid — see _contentBoundsPx.
    const cb = this._contentBoundsPx()
    const mapW = cb.x1 - cb.x0
    const mapH = cb.y1 - cb.y0
    const pa = this._computePlayArea()
    const playW = pa.sw - pa.left - pa.right
    const playH = pa.sh - pa.top  - pa.bottom
    const playCx = pa.left + playW / 2
    const playCy = pa.top  + playH / 2
    // Floor the zoom so a shrunk content box (e.g. after a room is removed)
    // can't leave the camera zoomed out into void. No-op when already above.
    const minZoom = this._computeMinZoom()
    if (cam.zoom < minZoom) cam.setZoom(minZoom)
    const z  = cam.zoom
    const cx = cam.centerX
    const cy = cam.centerY

    // Phaser zooms cameras around their viewport midpoint, not the
    // top-left. The inverse of "world W shows up at canvas-px X" is
    //   scrollX = W - cx - (X - cx) / z
    // (matching the wheel-zoom-to-cursor formula). The earlier clamp
    // used the top-left form (W - X/z) which silently mis-clamped any
    // time z != 1, leaving black void on whichever side the math
    // under-shot. With sf-driven UI scaling the camera's effective zoom
    // is rarely 1, so this bug appeared as soon as the canvas was any
    // size other than exactly 1280×720.
    const sxFor = (worldX, screenX) => worldX - cx - (screenX - cx) / z
    const syFor = (worldY, screenY) => worldY - cy - (screenY - cy) / z

    // [clamp] debug log removed — was leftover from camera-zoom diagnosis.

    // X axis — clamp so the content edges align with play-area edges.
    if (playW / z >= mapW) {
      // Content fits horizontally inside the play area → centre it.
      cam.scrollX = sxFor((cb.x0 + cb.x1) / 2, playCx)
    } else {
      const minScrollX = sxFor(cb.x0, pa.left)
      const maxScrollX = sxFor(cb.x1, pa.sw - pa.right)
      cam.scrollX = Phaser.Math.Clamp(cam.scrollX, minScrollX, maxScrollX)
    }

    // Y axis (mirrors X)
    if (playH / z >= mapH) {
      cam.scrollY = syFor((cb.y0 + cb.y1) / 2, playCy)
    } else {
      const minScrollY = syFor(cb.y0, pa.top)
      const maxScrollY = syFor(cb.y1, pa.sh - pa.bottom)
      cam.scrollY = Phaser.Math.Clamp(cam.scrollY, minScrollY, maxScrollY)
    }
  }

  // Cinematic zoom into the boss chamber when a fight starts. Pairs with
  // BossFightOverlay's intro slate. We snapshot the player's pre-fight
  // zoom + scroll so the resolved handler can ease back to whatever they
  // were watching before. Tween skipped if the boss room can't be found
  // (e.g. malformed save) so the camera never jumps to (0,0) silently.
  _onBossFightZoomIn() {
    if (!this._cam) return
    const boss = this.gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
    if (!boss) return
    // Lock the camera on the throne for the whole duel: the zoom-in plays, then
    // the player can't pan/zoom until the fight resolves (released in
    // _onBossFightZoomOut). Wired to the Aldric climax duel.
    this._duelCamLock = true
    this._dragOrigin = null
    const bx = (boss.gridX + boss.width  / 2) * TS
    const by = (boss.gridY + boss.height / 2) * TS
    // Snapshot only once — successive incoming events during a single
    // fight (chained adventurers) shouldn't overwrite the original view.
    if (!this._preFightCam) {
      this._preFightCam = {
        zoom:    this._cam.zoom,
        worldCX: this._cam.midPoint.x,
        worldCY: this._cam.midPoint.y,
        followId: this._followId,
      }
    }
    // Drop adv-follow while the cinematic plays — otherwise update()'s
    // follow lerp fights this tween every frame, dragging the camera
    // toward the lead adv and creating a visible wobble.
    if (this._followId) this._setFollow(null)
    const targetZoom = Math.max(this._cam.zoom, 1.5)
    this._tweenCameraTo(bx, by, targetZoom, 600, 'Sine.easeOut')
  }

  _onBossFightZoomOut() {
    // Release the duel camera lock the moment the fight resolves (before the
    // early-return, so it always clears even if the snapshot is missing).
    this._duelCamLock = false
    if (!this._cam || !this._preFightCam) return
    const snap = this._preFightCam
    this._tweenCameraTo(snap.worldCX, snap.worldCY, snap.zoom, 700, 'Sine.easeInOut',
      () => { this._preFightCam = null })
  }

  _onBossFightMusicStart() { GameplayMusic.bossFightStart(this) }
  _onBossFightMusicEnd()   { GameplayMusic.bossFightEnd() }

  // Tween the camera so its world midpoint eases linearly from the
  // current view to (worldX, worldY) while zoom eases to targetZoom.
  // Driving zoom + scroll independently caused the world midpoint to
  // drift mid-tween (the zoom <-> scroll relationship is non-linear) —
  // visibly the camera would swing past the boss room before snapping
  // back. Using a virtual `p` and recomputing both each frame keeps the
  // midpoint on a straight line throughout the ease.
  _tweenCameraTo(worldX, worldY, targetZoom, duration, ease, onComplete) {
    const cam = this._cam
    if (!cam) return
    const startZoom = cam.zoom
    const startMidX = cam.midPoint.x
    const startMidY = cam.midPoint.y
    if (this._fightCamTween) this._fightCamTween.stop()
    // Suspend the per-frame clamp + follow lerp while this tween owns
    // the camera — otherwise update() runs every frame and either
    // re-centres the dungeon (clamp) or pulls scroll back toward an
    // adventurer (follow), fighting the tween.
    this._fightCamActive = true
    const obj = { p: 0 }
    this._fightCamTween = this.tweens.add({
      targets:  obj,
      p:        1,
      duration,
      ease,
      onUpdate: () => {
        const t  = obj.p
        const z  = startZoom + (targetZoom - startZoom) * t
        const mx = startMidX + (worldX     - startMidX) * t
        const my = startMidY + (worldY     - startMidY) * t
        cam.setZoom(z)
        const pa = this._computePlayArea()
        const playCx = pa.left + (pa.sw - pa.left - pa.right) / 2
        const playCy = pa.top  + (pa.sh - pa.top  - pa.bottom) / 2
        // Mid-point-aware: place world (mx,my) at canvas px (playCx,playCy)
        cam.scrollX = mx - cam.centerX - (playCx - cam.centerX) / z
        cam.scrollY = my - cam.centerY - (playCy - cam.centerY) / z
      },
      onComplete: () => {
        this._fightCamActive = false
        // Final snap to the exact target — guarantees the resting
        // position matches the math regardless of where the last
        // onUpdate fired.
        cam.setZoom(targetZoom)
        const pa = this._computePlayArea()
        const playCx = pa.left + (pa.sw - pa.left - pa.right) / 2
        const playCy = pa.top  + (pa.sh - pa.top  - pa.bottom) / 2
        cam.scrollX = worldX - cam.centerX - (playCx - cam.centerX) / targetZoom
        cam.scrollY = worldY - cam.centerY - (playCy - cam.centerY) / targetZoom
        if (onComplete) onComplete()
      },
    })
  }

  _onGridExpanded() {
    // After a grid expansion the minimum zoom decreases (bigger map → can zoom
    // out further). If the camera happens to be below the new minimum, clamp up.
    const minZoom = this._computeMinZoom()
    if (this._cam.zoom < minZoom) this._cam.setZoom(minZoom)
    this._clampCameraToPlayArea()
  }

  // Fires (repeatedly) while Phaser's scale manager resizes the canvas. A
  // *continuous* window drag emits this every frame, so we must NOT re-anchor on
  // each event — doing so re-centres the camera every frame and the dungeon/boss
  // visibly chase the cursor around during the drag. Instead DEBOUNCE: capture
  // the look-point at the START of a drag burst (it drifts as the burst runs),
  // and only re-anchor once the drag has SETTLED. This keeps the view stable
  // during the drag and correctly framed on release.
  _onSceneResize() {
    if (!this._cam) return
    // Ignore degenerate mid-relayout collapses (0×0) — never record them, so a
    // minimize (→0) followed by a restore (→original) reads as "unchanged".
    const w = this.scale.width, h = this.scale.height
    if (w < 2 || h < 2) return
    // Only re-anchor on a REAL size change. A focus/visibility refresh
    // (minimize → restore, alt-tab) re-fires `resize` with the SAME dimensions;
    // re-anchoring there snaps the build camera to the boss chamber. Bail on an
    // unchanged size and let the clamp-only _onTabVisible path handle recovery.
    if (this._lastResizeW === w && this._lastResizeH === h) return
    this._lastResizeW = w
    this._lastResizeH = h
    if (this._resizeSettleTimer == null) {
      // Start of a burst — snapshot the pre-drag look-point (used for the day
      // phase; the build phase re-anchors on the chamber inside _reanchorCamera).
      this._resizeAnchorX = this._camWorldCX
      this._resizeAnchorY = this._camWorldCY
    }
    clearTimeout(this._resizeSettleTimer)
    this._resizeSettleTimer = setTimeout(() => {
      this._resizeSettleTimer = null
      this._reanchorCamera(this._resizeAnchorX, this._resizeAnchorY)
    }, 160)
  }

  // Re-anchor the world camera on `(wX, wY)` — the player's last look-point —
  // against the CURRENT viewport. Shared by the resize handler and the
  // tab-refocus recovery. Bails (returns false) while the viewport is
  // degenerate (a mid-relayout 0×0 collapse) so a transient never writes a
  // garbage scroll/zoom. Returns true once it has anchored successfully.
  _reanchorCamera(wX, wY) {
    // Re-frame whenever the dungeon is on screen — INCLUDING the build/night
    // phase, when the Game scene is PAUSED (it still renders, but isActive() is
    // false while paused). The old `!isActive()` bail meant resizing during the
    // build phase never re-framed: the canvas shrank but the camera kept its old
    // scroll/zoom, cropping the room off-screen so the boss appeared to drift
    // outside its walls. Only skip when the scene is fully stopped/sleeping (no
    // render) or the viewport is mid-relayout degenerate.
    if (!this._cam) return false
    if (!this.scene.isActive() && !this.scene.isPaused()) return false
    if (this.scale.width < 2 || this.scale.height < 2) return false
    // Phaser only auto-resizes the cameras of ACTIVE scenes on a canvas resize.
    // During the build/night phase the Game scene is paused, so its camera
    // viewport (cam.width/height → centerX/Y) goes stale — the re-anchor math
    // below would then frame against the OLD viewport and leave the dungeon
    // cropped. Sync the viewport to the live canvas first.
    if (this._cam.width !== this.scale.width || this._cam.height !== this.scale.height) {
      this._cam.setSize(this.scale.width, this.scale.height)
    }
    // During the BUILD phase (NightPhase is the active UI scene) the live
    // look-point (_camWorldCX/Y) drifts across a resize: Phaser resizes the
    // camera viewport, an update() tick then recomputes the look-point as the
    // world point now at the (shifted) play-area centre, so re-anchoring on it
    // just re-preserves the stale, off-centre frame — the room ends up cropped
    // and the boss appears to walk outside it. Anchor on the boss chamber
    // instead so a resize always re-centres the dungeon. During play (DayPhase)
    // we keep the player's look-point so combat isn't jerked around.
    if (this.scene.manager?.isActive('NightPhase')) { wX = undefined; wY = undefined }
    if (wX === undefined || wY === undefined) {
      const boss = this.gameState?.dungeon?.rooms?.find(r => r.definitionId === 'boss_chamber')
      wX = boss ? (boss.gridX + boss.width  / 2) * TS : 0
      wY = boss ? (boss.gridY + boss.height / 2) * TS : 0
    }
    const minZ = this._computeMinZoom()
    if (this._cam.zoom < minZ) this._cam.setZoom(minZ)
    // Re-centre on the look-point against the play-area centre (between the
    // HUD panels), not the canvas centre.
    const pa = this._computePlayArea()
    const playCx = pa.left + (pa.sw - pa.left - pa.right) / 2
    const playCy = pa.top  + (pa.sh - pa.top  - pa.bottom) / 2
    const z = this._cam.zoom
    this._cam.scrollX = wX - this._cam.centerX - (playCx - this._cam.centerX) / z
    this._cam.scrollY = wY - this._cam.centerY - (playCy - this._cam.centerY) / z
    this._clampCameraToPlayArea()
    return true
  }

  // Tab-refocus recovery. When the player clicks away from the game and
  // back, the browser re-lays-out the page and the game container can
  // briefly collapse to 0×0; that transient can scroll the WORLD camera
  // into the void (canvas + DOM HUD stay fine, so the dungeon just reads
  // as an all-dark play area).
  //
  // Recovery is CLAMP-ONLY: _clampCameraToPlayArea pulls the camera back
  // into valid bounds if it drifted off, but is a no-op when the camera is
  // already valid — so a normal tab-back never nudges the view. (An
  // earlier version re-anchored the camera here, which re-framed it to the
  // play-area centre on every refocus and visibly shifted the dungeon.)
  // Fired at a few delays so it still lands once the relayout settles.
  _onTabVisible() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    for (const delay of [0, 150, 400, 800]) {
      setTimeout(() => {
        if (!this._cam || !this.scene.isActive()) return
        if (this.scale.width < 2 || this.scale.height < 2) return
        const minZ = this._computeMinZoom()
        if (this._cam.zoom < minZ) this._cam.setZoom(minZ)
        this._clampCameraToPlayArea()
      }, delay)
    }
  }

  _onBossLeveledUp({ newLevel }) {
    // Persist the highest boss level the player has ever reached
    // (across all runs / archetypes) so the archetype-picker unlock
    // gates can read it on the next title-screen visit. e.g. Succubus
    // unlocks once any boss has hit level 4.
    PlayerProfile.recordBossLevel(newLevel)

    // Grid expansion is DEFERRED to the next NIGHT_PHASE_STARTED — see
    // _applyPendingGridGrowth. BOSS_LEVELED_UP can fire mid-day off an
    // adventurer kill, and the new symmetric (+5-each-side) growth has
    // to shift every existing entity's tile coords. Doing that with
    // live advs walking + path arrays in flight would scatter them.
    // Queueing the growth and applying at night means by the time we
    // re-anchor everything, advs are gone and only stationary minions
    // remain.
    this.gameState.meta._pendingGridGrowth =
      (this.gameState.meta._pendingGridGrowth ?? 0) + 1

    // Scale the boss's own fight stats. Additive per level so it layers
    // cleanly on top of ability bonuses (+4 ATK / +5 DEF) and event
    // modifiers — BOSS_LEVELED_UP fires exactly once per level gained.
    // Current HP keeps its fraction so a mid-fight level-up doesn't
    // full-heal the boss (matches the minion rescale below).
    const boss = this.gameState.boss
    if (boss) {
      const hpFrac = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1
      boss.maxHp   = (boss.maxHp ?? 0) + Balance.BOSS_HP_PER_LEVEL
      boss.hp      = Math.round(boss.maxHp * hpFrac)
      boss.attack  = (boss.attack ?? 0)  + Balance.BOSS_ATK_PER_LEVEL
      boss.defense = (boss.defense ?? 0) + Balance.BOSS_DEF_PER_LEVEL
    }

    // Scale all live minions up by the ratio from their last boss level to the new one.
    for (const m of this.gameState.minions ?? []) {
      if (m.aiState === 'dead') continue
      const oldLv   = m.bossLevel ?? 1
      if (oldLv >= newLevel) continue
      const oldHpM  = 1 + Balance.MINION_HP_PER_BOSS_LV  * (oldLv  - 1)
      const newHpM  = 1 + Balance.MINION_HP_PER_BOSS_LV  * (newLevel - 1)
      const oldAtkM = 1 + Balance.MINION_ATK_PER_BOSS_LV * (oldLv  - 1)
      const newAtkM = 1 + Balance.MINION_ATK_PER_BOSS_LV * (newLevel - 1)
      const hpFrac  = m.resources.maxHp > 0 ? m.resources.hp / m.resources.maxHp : 1
      m.resources.maxHp = Math.round(m.resources.maxHp * (newHpM / oldHpM))
      m.resources.hp    = Math.round(m.resources.maxHp * hpFrac)
      m.stats.attack    = Math.round(m.stats.attack    * (newAtkM / oldAtkM))
      m.bossLevel       = newLevel
    }
  }

  // Apply any boss-level-up grid expansion that was queued during the day.
  // Each pending level adds +5 tiles on EACH side (+10 per axis), capped
  // at 100×100. With non-zero leftOffset/topOffset the existing dungeon
  // is re-anchored inside the larger grid, so every entity's tile coord
  // shifts by (+leftOffset, +topOffset). DungeonGrid.expandGrid handles
  // dungeon-side entities (rooms, traps, fountains, etc.); this helper
  // handles everything outside the dungeon object's ownership (boss,
  // minions, defensive adv shift, knowledge buckets). Called from
  // _onNightStart. (2026-05-27 — symmetric grid expansion.)
  _applyPendingGridGrowth() {
    const pending = this.gameState.meta?._pendingGridGrowth ?? 0
    if (pending <= 0) return
    const cap = 100
    const PER_SIDE = 5
    const oldW = this.gameState.dungeon.gridWidth
    const oldH = this.gameState.dungeon.gridHeight
    // Each pending level → +PER_SIDE on each side → +2*PER_SIDE per axis.
    const totalGrowAxis = 2 * PER_SIDE * pending
    const newW = Math.min(cap, oldW + totalGrowAxis)
    const newH = Math.min(cap, oldH + totalGrowAxis)
    this.gameState.meta._pendingGridGrowth = 0
    const growW = newW - oldW
    const growH = newH - oldH
    if (growW <= 0 && growH <= 0) return
    // Split growth evenly between sides — if growth is odd, the extra
    // tile goes to the right/bottom (matching the original behavior).
    const leftOff = Math.floor(growW / 2)
    const topOff  = Math.floor(growH / 2)
    this.dungeonGrid.expandGrid(newW, newH, leftOff, topOff)
    this._shiftExternalEntitiesAfterGrowth(leftOff, topOff)
    // Camera bounds depend on grid size — re-clamp so the player can pan
    // into the new tiles.
    this._clampCameraToPlayArea?.()
  }

  // Shift everything in gameState that has tile coords but lives OUTSIDE
  // gameState.dungeon (DungeonGrid handles its own). Boss, minions,
  // defensive adv shift (should be empty at night), and knowledge
  // mirrors (sharedPool + survivors[].knowledge) that store trap
  // tileX/tileY/dangerTiles as copies. (2026-05-27 — symmetric grid.)
  _shiftExternalEntitiesAfterGrowth(dx, dy) {
    if (dx === 0 && dy === 0) return
    const TS = Balance.TILE_SIZE
    // Boss — may have its own tile / world coords on some archetypes.
    const boss = this.gameState.boss
    if (boss) {
      if (typeof boss.tileX  === 'number') { boss.tileX  += dx; boss.tileY  += dy }
      if (typeof boss.worldX === 'number') { boss.worldX += dx * TS; boss.worldY += dy * TS }
    }
    // Minions — stationary at night. Shift tile + world; clear any
    // in-flight pathing so MinionAISystem replans from new coords.
    for (const m of this.gameState.minions ?? []) {
      if (typeof m.tileX  === 'number') { m.tileX  += dx; m.tileY  += dy }
      if (typeof m.worldX === 'number') { m.worldX += dx * TS; m.worldY += dy * TS }
      // homeTileX/Y is an ABSOLUTE tile coord — the dawn-snap target in
      // MinionAISystem._dawnRefresh. It must shift with the grid too. Without
      // this, a grid expansion (boss level-up) left home at the OLD coords, so
      // at the next dawn the minion snapped to the wrong location while
      // assignedRoomId still read the (correctly shifted) room — the "minion
      // moves but the game thinks it's in the original room" desync, most
      // visible when over-level minions level the boss fast. (Fix 2026-06-02.)
      if (typeof m.homeTileX === 'number') { m.homeTileX += dx; m.homeTileY += dy }
      if (m._patrolTarget) { m._patrolTarget.x += dx; m._patrolTarget.y += dy }
      m._chasePath = null
    }
    // Active adventurers — should be empty at night, but defensive in
    // case a charmed thrall or undead-return adv survived into night.
    for (const a of this.gameState.adventurers?.active ?? []) {
      if (typeof a.tileX  === 'number') { a.tileX  += dx; a.tileY  += dy }
      if (typeof a.worldX === 'number') { a.worldX += dx * TS; a.worldY += dy * TS }
      a.path = null
      a.pathTarget = null
      this._shiftTrapKnowledge(a.knowledge?.traps, dx, dy)
    }
    // Knowledge buckets that store trap coords as copies. Without the
    // shift, returning-veteran briefings would point at the OLD coords
    // and the pathfinder's room-trap avoidance would mis-identify which
    // room the trap is in.
    this._shiftTrapKnowledge(this.gameState.knowledge?.sharedPool?.traps, dx, dy)
    for (const s of this.gameState.knowledge?.survivors ?? []) {
      this._shiftTrapKnowledge(s?.knowledge?.traps, dx, dy)
    }
  }

  // Shift the tileX/tileY (and any dangerTiles[].x/y) on every entry in a
  // trap-knowledge bucket. Bucket shape is { [trapId]: { tileX, tileY,
  // dangerTiles?: [{x,y}], ... } } — same on sharedPool, on each
  // survivor's snapshot, and on each live adv's in-progress knowledge.
  _shiftTrapKnowledge(traps, dx, dy) {
    if (!traps) return
    for (const t of Object.values(traps)) {
      if (!t) continue
      if (typeof t.tileX === 'number') { t.tileX += dx; t.tileY += dy }
      if (Array.isArray(t.dangerTiles)) {
        for (const d of t.dangerTiles) {
          if (typeof d?.x === 'number') { d.x += dx; d.y += dy }
        }
      }
    }
  }

  // BOSS_LEVEL_CHANGED — only handles the DOWN case (Demon's Wager loss).
  // Boss stat decrement is already applied by EventSystem._resolveDemonsWager
  // when the wager resolves. This handler rescales every live minion to
  // the new (lower) level so their HP/ATK shrink in lockstep. The grid
  // is deliberately NOT shrunk (would orphan placed rooms). The up-path
  // is owned by _onBossLeveledUp above — skipping positive deltas here
  // avoids double-rescaling.
  _onBossLevelChanged({ delta, newLevel } = {}) {
    if (!(delta < 0)) return
    for (const m of this.gameState.minions ?? []) {
      if (m.aiState === 'dead') continue
      const oldLv  = m.bossLevel ?? 1
      if (oldLv <= newLevel) continue
      const oldHpM  = 1 + Balance.MINION_HP_PER_BOSS_LV  * (oldLv    - 1)
      const newHpM  = 1 + Balance.MINION_HP_PER_BOSS_LV  * (newLevel - 1)
      const oldAtkM = 1 + Balance.MINION_ATK_PER_BOSS_LV * (oldLv    - 1)
      const newAtkM = 1 + Balance.MINION_ATK_PER_BOSS_LV * (newLevel - 1)
      const hpFrac  = m.resources.maxHp > 0 ? m.resources.hp / m.resources.maxHp : 1
      m.resources.maxHp = Math.max(1, Math.round(m.resources.maxHp * (newHpM / oldHpM)))
      m.resources.hp    = Math.max(1, Math.round(m.resources.maxHp * hpFrac))
      m.stats.attack    = Math.max(1, Math.round(m.stats.attack    * (newAtkM / oldAtkM)))
      m.bossLevel       = newLevel
    }
  }

  _setupCamera() {
    this._cam = this.cameras.main
    // Deep-dark backdrop the dungeon's bedrock fades INTO at its edges (matches
    // DungeonRenderer's DEEP_DARK / edge-fade rim), so the player never hits a
    // hard black void past the build space. (Was 0x050a12 navy.)
    this._cam.setBackgroundColor(0x0d0d10)

    // Seed the last-known canvas size so _onSceneResize can distinguish a REAL
    // resize (dragging the window edge) from a focus/visibility refresh
    // (minimize → restore), which fires Phaser's `resize` event with UNCHANGED
    // dimensions. Re-anchoring on the latter jumped the build-phase camera back
    // to the boss chamber — the user just wants the view left where it is.
    this._lastResizeW = this.scale.width
    this._lastResizeH = this.scale.height

    // Place the camera so the boss chamber sits at the play-area centre
    // (between the HUD panels), then let _clampCameraToPlayArea finalise
    // bounds in update(). Centring on play area instead of canvas means
    // the boss room isn't shifted off behind the build panel at startup.
    const boss = this.gameState.dungeon.rooms.find(r => r.definitionId === 'boss_chamber')
    const bossX = boss ? (boss.gridX + boss.width  / 2) * TS : 0
    const bossY = boss ? (boss.gridY + boss.height / 2) * TS : 0

    const startZoom = Math.max(Balance.CAMERA_ZOOM_DEFAULT, this._computeMinZoom())
    this._cam.setZoom(startZoom)

    const pa = this._computePlayArea()
    const playCx = pa.left + (pa.sw - pa.left - pa.right) / 2
    const playCy = pa.top  + (pa.sh - pa.top  - pa.bottom) / 2
    this._cam.scrollX = bossX - this._cam.centerX - (playCx - this._cam.centerX) / startZoom
    this._cam.scrollY = bossY - this._cam.centerY - (playCy - this._cam.centerY) / startZoom
    this._clampCameraToPlayArea()
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  _isCorridorMode() {
    const np = this.scene.get('NightPhase')
    return np && this.scene.isActive('NightPhase') && np._paletteTab === 'corridors'
  }

  _setupInput() {
    // (Browser context menu suppressed game-wide in main.js.)
    this.input.on('pointerdown', (p) => {
      if (this._duelCamLock) return   // boss duel — world input frozen
      if (p.middleButtonDown() || (p.rightButtonDown() && !this._isCorridorMode())) {
        this._dragOrigin = { x: p.x + this._cam.scrollX, y: p.y + this._cam.scrollY }
        if (this._followId) this._setFollow(null)
        return
      }
    })

    this.input.on('pointermove', (p) => {
      if (!this._dragOrigin) return
      if (!p.middleButtonDown() && !p.rightButtonDown()) {
        this._dragOrigin = null
        return
      }
      // If the player switched to corridor mode while right-dragging, release the pan.
      if (p.rightButtonDown() && !p.middleButtonDown() && this._isCorridorMode()) {
        this._dragOrigin = null
        return
      }
      this._cam.setScroll(
        this._dragOrigin.x - p.x,
        this._dragOrigin.y - p.y,
      )
      // Clamp the pan immediately. The per-frame update() clamp does NOT run
      // during the paused night/build phase, so without this a drag pans
      // freely into the void while building. Input events fire in both phases,
      // so clamping here bounds the pan during night AND day.
      if (!this._fightCamActive && !this._duelCamLock && !this._vfxLabActive) this._clampCameraToPlayArea()
    })

    this.input.on('pointerup', () => { this._dragOrigin = null })

    this.input.on('wheel', (pointer, _o, _dx, dy) => {
      if (this._duelCamLock) return   // boss duel — zoom locked
      // Let HudScene's BuildMenu eat wheels that happen over the slot
      // grid — without this guard, the wheel both scrolls the menu AND
      // zooms the dungeon view at the same time. Bounds-check is
      // delegated to BuildMenu.containsPointer so the comparison runs in
      // the menu's design-space (HudScene camera transform applied),
      // independent of canvas size or camera zoom.
      const buildMenu = this.scene.get('HudScene')?._buildMenu
      if (buildMenu?.containsPointer?.(pointer)) return

      const oldZoom = this._cam.zoom
      const newZoom = Phaser.Math.Clamp(
        oldZoom - dy * 0.001,
        this._computeMinZoom(),
        Balance.CAMERA_ZOOM_MAX,
      )
      if (newZoom === oldZoom) return

      // Zoom-to-cursor: the world point currently under the cursor stays
      // pinned to the cursor after the zoom change.
      //  1. Capture the world point at the cursor before zooming.
      //  2. Apply the new zoom to the camera.
      //  3. Re-position scroll so that same world point is under the cursor
      //     again. Phaser cameras zoom around their midpoint (cam.centerX,
      //     cam.centerY) — not the top-left — so the inverse formula is:
      //         scrollX = worldX - centerX - (pointerX - centerX) / zoom
      //     This is the Phaser-correct equivalent of the simple
      //     "scrollX = worldX - pointerX / zoom" formula that works only
      //     for top-left-anchored zoom.
      const worldPoint = this._cam.getWorldPoint(pointer.x, pointer.y)
      const cx = this._cam.centerX
      const cy = this._cam.centerY

      this._cam.setZoom(newZoom)

      this._cam.scrollX = worldPoint.x - cx - (pointer.x - cx) / newZoom
      this._cam.scrollY = worldPoint.y - cy - (pointer.y - cy) / newZoom
      this._clampCameraToPlayArea()
    })

    // WASD camera scroll. Pass `enableCapture=false` so Phaser doesn't
    // preventDefault the keystrokes globally — without this, any DOM
    // input on top of the Game scene (rename-minion box in Roster /
    // MinionInspector, name-change overlay, settings inputs) silently
    // loses 'a' / 's' / 'd' / 'w' the player types into it. Phaser
    // still updates the Key objects' .isDown state from the same
    // keystroke; the per-frame camera-scroll read just doesn't lock
    // out the browser's default text-input behaviour.
    this._keys = this.input.keyboard.addKeys('W,A,S,D', false)

    // ESC opens the pause menu. Wired here as a fallback for when neither
    // NightPhase nor DayPhase has keyboard focus (e.g. during the
    // BossFightOverlay cinematic, which lives inside this scene).
    this.input.keyboard.on('keydown-ESC', () => {
      // Defer to NightPhase first if it has anything armed — selected
      // item, tool mode, or a pending trade-off all want ESC
      // to cancel them, not open pause.
      const np = this.scene.get('NightPhase')
      if (np && np.scene?.isActive?.() &&
          (np._pendingTradeOff || np._selected || np._toolMode)) {
        return
      }
      PauseManager.toggle(this)
    })
  }

  update(_time, delta) {
    // Scene-wide post-processing (grade/bloom/vignette mood cross-fade + pulse
    // decay) runs every frame in both phases — cheap, and no-ops if disabled.
    this.scenePostFx?.update(delta)
    // Dynamic lighting (boss follow-light + ephemeral flashes) — both phases.
    this.lightingSystem?.update()

    // Mango cheat — refill gold floor every tick so spends instantly
    // restore. Cheap (one int compare + maybe one assignment per
    // frame), gated by the cheat flag so non-mango runs pay nothing.
    if (this._isMangoCheat) {
      const p = this.gameState?.player
      if (p && (p.gold ?? 0) < Game.MANGO_GOLD_FLOOR) p.gold = Game.MANGO_GOLD_FLOOR
    }

    // Capture the world point currently at the PLAY-AREA centre (the gap
    // between the HUD panels) so _onSceneResize can re-anchor on it after a
    // viewport change. The camera FRAMES on the play-area centre, not the
    // canvas centre — so this capture is the exact inverse of the scroll
    // formula in _reanchorCamera. Capturing the canvas-centre midPoint
    // instead made every re-anchor shift the view by the canvas-vs-play-
    // area offset, which surfaced as the dungeon nudging on each tab
    // refocus. Skipped on a degenerate 0×0 frame so a mid-relayout
    // transient can't overwrite the last good value with garbage.
    if (this.scale.width >= 2 && this.scale.height >= 2) {
      const pa = this._computePlayArea()
      const playCx = pa.left + (pa.sw - pa.left - pa.right) / 2
      const playCy = pa.top  + (pa.sh - pa.top  - pa.bottom) / 2
      const cx = this._cam.centerX, cy = this._cam.centerY, z = this._cam.zoom
      this._camWorldCX = this._cam.scrollX + cx + (playCx - cx) / z
      this._camWorldCY = this._cam.scrollY + cy + (playCy - cy) / z
    }

    const speed = Balance.CAMERA_SCROLL_SPEED / this._cam.zoom

    // WASD breaks follow mode then moves camera manually
    const anyWASD = this._keys.W.isDown || this._keys.S.isDown ||
                    this._keys.A.isDown || this._keys.D.isDown
    if (anyWASD && this._followId) this._setFollow(null)

    if (!this._duelCamLock) {
      if (this._keys.W.isDown) this._cam.scrollY -= speed
      if (this._keys.S.isDown) this._cam.scrollY += speed
      if (this._keys.A.isDown) this._cam.scrollX -= speed
      if (this._keys.D.isDown) this._cam.scrollX += speed
    }

    // Smooth camera follow (day phase only). Suspended while the boss-
    // fight cinematic tween owns the camera so the follow lerp doesn't
    // drag scroll back toward the lead adventurer mid-zoom.
    if (this._followId && this.gameState.meta.phase === 'day' && !this._fightCamActive && !this._duelCamLock) {
      const adv = this.gameState.adventurers.active.find(a => a.instanceId === this._followId)
      if (adv) {
        const tx = adv.worldX - this._cam.centerX
        const ty = adv.worldY - this._cam.centerY
        this._cam.scrollX += (tx - this._cam.scrollX) * 0.08
        this._cam.scrollY += (ty - this._cam.scrollY) * 0.08
      } else {
        this._setFollow(null)
      }
    }

    // After all camera-mutating logic above, clamp the scroll against the
    // play area (between HUD panels) — keeps the dungeon edges aligned
    // with the play area edges, and centres the dungeon when it fits
    // entirely inside the play area on a given axis. Suspended while
    // the boss-fight cinematic tween is running so it can place the
    // camera on the boss room without the clamp pulling it back to a
    // fitted-centre position each frame.
    if (!this._fightCamActive && !this._duelCamLock && !this._vfxLabActive) this._clampCameraToPlayArea()

    // Door open/close animations always tick at real time — the visual
    // shouldn't depend on time scale (and the entry-hall door auto-opens at
    // night→day transition where time scale isn't yet applied).
    this._dungeonRenderer?.update(delta)

    // Screen-shake trauma decay + per-frame camera shake. Ticked in REAL frame
    // time (not the scaled sim) so shake feels the same at any fast-forward
    // speed, and run in both phases so leftover trauma always bleeds off.
    this.screenShakeSystem?.update(delta)

    // Boss-archetype real-time tick — the passive zone DoTs (golem fissure,
    // myconid bloom, lizardman miasma) + lich phylactery bite. It runs on the
    // real clock (so it's speed-independent), which means it kept dealing
    // periodic damage while the day was PAUSED — the player saw damage numbers
    // tick on frozen, unmoving characters. Freeze it when the day is paused so a
    // paused dungeon takes no damage at all. (Still runs at night and at every
    // live speed incl. hit-stop; only a true pause — time scale 0 — stops it.)
    const _dayPausedTick = this.gameState.meta.phase === 'day' && this._getDayTimeScale() === 0
    if (!_dayPausedTick) this.bossArchetypeSystem?.tick?.(delta)

    if (this.gameState.meta.phase === 'day') {
      const ts = this._getDayTimeScale() * this._hitStopFactor()
      if (ts > 0) {
        // Cap real delta before scaling so a browser frame hitch
        // (tab refocus, GC pause, alt-tab return — anything that
        // makes Phaser report a huge `delta`) doesn't multiply into
        // a massive scaled tick.
        const realCapped = Math.min(delta, 50)
        const totalScaled = realCapped * ts

        // ── Fixed sub-stepping ──────────────────────────────────────
        // The simulation systems (movement, boss-fight combat, AI
        // pathing) are written for ~16ms ticks. Handing them one
        // coarse tick at high speed broke them: at 8× a single frame
        // is realCapped(50) × 8 = 400ms. A 400ms tick makes
        // adventurers teleport whole tiles past path waypoints, the
        // boss-fight round timer (0.6s/round) and movement overshoot
        // the room clamp, and the fight state machine wedge so the
        // encounter never resolves — the "freezes during fights at
        // 8×" report. Splitting the scaled time into sub-steps of at
        // most MAX_STEP ms makes every system run exactly as it does
        // at 1×, just more times per frame. steps is bounded (≤10 at
        // 8×) because realCapped caps the input, so this can never
        // itself run away.
        const MAX_STEP = 40
        const steps  = Math.max(1, Math.ceil(totalScaled / MAX_STEP))
        const stepDt = totalScaled / steps

        // ── Wall-clock budget breaker ───────────────────────────────
        // Sub-stepping multiplies per-frame simulation cost by `steps`
        // (≤10 at 8×). On a heavy wave — a guild-raid event spawns
        // DOUBLE the adventurers, so a boss fight can hold 12-16
        // combatants plus minions — 10× that cost can blow past the
        // frame budget and the tab appears frozen. This guard caps the
        // REAL time spent simulating per frame: once over budget we
        // stop sub-stepping and let the frame render. The game then
        // visibly runs slower than the chosen multiplier instead of
        // hard-freezing — graceful degradation. The check is AFTER each
        // sub-step so at least one always runs (the sim never stalls
        // completely), and `performance.now()` is monotonic so this
        // can never itself hang.
        const STEP_BUDGET_MS = 50
        const budgetStart = (typeof performance !== 'undefined' ? performance.now() : Date.now())
        // Per-system crash guard. An UNCAUGHT exception thrown inside a
        // system's update() propagates out of Game.update, out of the
        // Phaser scene step, and kills the requestAnimationFrame loop
        // dead — the entire game hard-freezes on the spot ("freezes
        // instantly"). EventBus already isolates event listeners this
        // way; the per-frame system ticks were the one unprotected
        // path. Each system is wrapped independently so a throw in one
        // (e.g. a boss-fight edge case on the second fight) can't
        // starve the others — adventurers keep moving, the game stays
        // responsive, and the real error + stack trace lands in the
        // console instead of a silent freeze. A boss fight that throws
        // every tick still self-terminates via BossSystem's 30s
        // _fightT hard cap (that timer advances before the throw).
        // Per-system perf instrumentation. PerfHud (Ctrl+Shift+P) reads
        // window.__perfStats to show per-system ms/sec budgets so we
        // can see exactly which system is eating the frame at high
        // entity counts. Zero-cost when the HUD isn't watching — just
        // two perf.now() calls per wrapped tick. Buckets are
        // accumulated, then drained by PerfHud on a 1Hz timer.
        if (!window.__perfStats) window.__perfStats = {}
        const _stats = window.__perfStats
        const tick = (sys, fn) => {
          const t0 = performance.now()
          try { fn() }
          catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[Game.update] ${sys}.update() threw — caught to keep the game loop alive:`, err)
          }
          _stats[sys] = (_stats[sys] ?? 0) + (performance.now() - t0)
        }
        // AI half-rate throttle — fires at EVERY speed, not just 1×.
        //
        // Originally gated to 1× to protect sub-step precision at high
        // speeds. PerfHud data at day-50 mango run (speed:8x, advs:55,
        // minions:110) proved that gating was the wrong call: at 8×
        // the sub-step loop runs AI 10×/frame across 165 entities,
        // burning the entire CPU budget and dropping to 12fps. The
        // user can't perceive 40ms vs 80ms tick precision at 12fps
        // anyway — the simulation is already updating in 80ms+ visible
        // hops.
        //
        // Per-sub-step parity (not per-frame) so the throttle does
        // useful work at high speeds where one frame contains many
        // sub-steps. At 1×: 1 sub-step/frame → AI ticks every other
        // frame (30Hz, same as before). At 8×: 10 sub-steps/frame →
        // AI ticks 5×/frame (every other sub-step). Each AI tick uses
        // 2× delta so total game-time covered is identical.
        if (!window.__perfCounts) window.__perfCounts = {}
        window.__perfCounts.gameUpdates = (window.__perfCounts.gameUpdates ?? 0) + 1
        window.__perfCounts.timeScale = ts
        window.__perfCounts.advCount = (this.gameState?.adventurers?.active?.length ?? 0)
        window.__perfCounts.minionCount = (this.gameState?.minions ?? []).filter(m => m?.aiState !== 'dead').length

        for (let i = 0; i < steps; i++) {
          this._aiSubstepCounter = ((this._aiSubstepCounter ?? 0) + 1) % 3
          const _skipAi = this._aiSubstepCounter !== 0
          // Boss fight runs at the same scaled rate as all other
          // day-phase systems so x2/x4/x8 speed applies during the
          // boss encounter.
          tick('bossSystem',            () => this.bossSystem?.update(stepDt))
          if (!_skipAi) {
            // 1-in-3 throttle (20Hz at 1×, ~3 ticks/frame at 8×).
            // Bumped from 1-in-2 after PerfHud showed aiSystem still
            // dominant at 359ms/s post-half-rate. 3× delta keeps total
            // game-time per real second identical.
            tick('aiSystem',            () => this.aiSystem?.update(stepDt * 3))
            tick('nerveSystem',         () => this.nerveSystem?.update(stepDt * 3))
            tick('minionAiSystem',      () => this.minionAiSystem?.update(stepDt * 3))
            window.__perfCounts.aiTicks = (window.__perfCounts.aiTicks ?? 0) + 1
          }
          tick('trapSystem',            () => this.trapSystem?.update(stepDt))
          tick('dungeonMechanicSystem', () => this.dungeonMechanicSystem?.tickDay(stepDt))
          tick('classAbilitySystem',    () => this.classAbilitySystem?.update(stepDt))
          tick('kingdomModifierSystem', () => this.kingdomModifierSystem?.update?.(stepDt))
          const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now())
          if (nowMs - budgetStart > STEP_BUDGET_MS) break
        }
      }
      // Renderer-tick instrumentation. Same shape as the simulation
      // wrappers above — accumulates into window.__perfStats for
      // PerfHud to read. Renderers run once per frame (no sub-stepping).
      if (!window.__perfStats) window.__perfStats = {}
      const _rstats = window.__perfStats
      const rtick = (sys, fn) => {
        const t0 = performance.now()
        try { fn() } catch (err) { console.error(`[Game.update] ${sys} threw:`, err) }
        _rstats[sys] = (_rstats[sys] ?? 0) + (performance.now() - t0)
      }
      // Day-pause (⏸ / SPACE → time scale 0) is meant to FREEZE the battlefield
      // so the player can read it. Combat/AI already stop (the ts>0 sim block is
      // skipped), but barks + emotes run on the always-on renderer tick — so a
      // paused dungeon kept chattering and emoting. Hold those while paused.
      // (Hit-stop keeps ts at 0.04, never 0, so it stays lively as intended.)
      const _dayPaused = this._getDayTimeScale() === 0
      rtick('adventurerRenderer',  () => this.adventurerRenderer?.update())
      rtick('statusVfxSystem',     () => this.statusVfxSystem?.update())
      rtick('emoteSystem',         () => { if (!_dayPaused) this.emoteSystem?.update() })
      rtick('minionRenderer',      () => this.minionRenderer?.update())
      rtick('bossRenderer',        () => this.bossRenderer?.update())
      rtick('succubusBatRenderer', () => this.succubusBatRenderer?.update())
      rtick('charmVfxRenderer',    () => this.charmVfxRenderer?.update())
      rtick('trapRenderer',        () => this.trapRenderer?.update())
      rtick('lootPileRenderer',    () => this.lootPileRenderer?.update())
      rtick('keyChestRenderer',    () => this.keyChestRenderer?.update())
      rtick('lockRenderer',        () => this.lockRenderer?.update())
      rtick('beaconRenderer',      () => this.beaconRenderer?.update())
      rtick('fountainRenderer',    () => this.fountainRenderer?.update())
      rtick('treasureChestRenderer', () => this.treasureChestRenderer?.update())
      rtick('phylacteryRenderer',  () => this.phylacteryRenderer?.update())
      rtick('fungalCorpseRenderer', () => this.fungalCorpseRenderer?.update())
      rtick('persistentCorpseRenderer', () => this.persistentCorpseRenderer?.update())
      rtick('trapBlessRenderer',   () => this.trapBlessRenderer?.update())
      rtick('torchRenderer',       () => this.torchRenderer?.update())
      rtick('cobwebRenderer',      () => this.cobwebRenderer?.update())
      rtick('tarPitRenderer',      () => this.tarPitRenderer?.update(delta))
      rtick('silenceWardRenderer', () => this.silenceWardRenderer?.update(delta))
      rtick('brambleHallRenderer', () => this.brambleHallRenderer?.update(delta))
      rtick('wanderingGateRenderer', () => this.wanderingGateRenderer?.update(delta))
      rtick('watchtowerRenderer',  () => this.watchtowerRenderer?.update(delta))
      rtick('armoryRenderer',      () => this.armoryRenderer?.update(delta))
      rtick('sanctumRenderer',     () => this.sanctumRenderer?.update(delta))
      rtick('veilRenderer',        () => this.veilRenderer?.update(delta))
      rtick('hallOfMadnessRenderer', () => this.hallOfMadnessRenderer?.update(delta))
      rtick('cryptRenderer',       () => this.cryptRenderer?.update(delta))
      rtick('catacombsRenderer',   () => this.catacombsRenderer?.update(delta))
      rtick('treasuryRenderer',    () => this.treasuryRenderer?.update(delta))
      rtick('libraryRenderer',     () => this.libraryRenderer?.update(delta))
      rtick('wishingWellRenderer', () => this.wishingWellRenderer?.update(delta))
      rtick('hallOfTrialsRenderer', () => this.hallOfTrialsRenderer?.update(delta))
      rtick('guardPostRenderer',   () => this.guardPostRenderer?.update(delta))
      rtick('decorRenderer',       () => this.decorRenderer?.update())
      rtick('bloodSplatRenderer',  () => this.bloodSplatRenderer?.update())
      rtick('hazardRenderer',      () => this.hazardRenderer?.update())
      rtick('plunderMarkRenderer', () => this.plunderMarkRenderer?.update())
      rtick('chatBubbles',         () => { if (!_dayPaused) this.chatBubbles?.update() })
      rtick('replayGhostRenderer', () => this.replayGhostRenderer?.update())
      rtick('cartographerOverlay', () => this.cartographerOverlay?.tick())
    } else {
      // Boss wanders its room during night at real time (cosmetic only).
      this.bossSystem?.update(delta)
      // Minions amble around their rooms during the build phase so the dungeon
      // feels alive (cosmetic only — movement, no combat/abilities). Freezes +
      // faces the camera while a sell/move/upgrade tool is active. Runs BEFORE
      // the renderer so the new positions are drawn this frame.
      this.minionAiSystem?.nightWander(delta)
      this.minionRenderer?.update()
      // Adventurers don't normally exist at night, so their renderer is skipped
      // here — EXCEPT in the VFX Lab, which parks a frozen adventurer to review.
      if (this._vfxLabActive) this.adventurerRenderer?.update()
      this.bossRenderer?.update()
      this.trapRenderer?.update()
      this.lootPileRenderer?.update()
      this.keyChestRenderer?.update()
      this.lockRenderer?.update()
      this.beaconRenderer?.update()
      this.fountainRenderer?.update()
      this.treasureChestRenderer?.update()
      this.phylacteryRenderer?.update()
      this.fungalCorpseRenderer?.update()
      this.persistentCorpseRenderer?.update()
      this.trapBlessRenderer?.update()
      this.torchRenderer?.update()
      this.cobwebRenderer?.update()
      this.tarPitRenderer?.update(delta)
      this.silenceWardRenderer?.update(delta)
      this.brambleHallRenderer?.update(delta)
      this.wanderingGateRenderer?.update(delta)
      this.watchtowerRenderer?.update(delta)
      this.armoryRenderer?.update(delta)
      this.sanctumRenderer?.update(delta)
      this.veilRenderer?.update(delta)
      this.hallOfMadnessRenderer?.update(delta)
      this.cryptRenderer?.update(delta)
      this.catacombsRenderer?.update(delta)
      this.treasuryRenderer?.update(delta)
      this.libraryRenderer?.update(delta)
      this.wishingWellRenderer?.update(delta)
      this.hallOfTrialsRenderer?.update(delta)
      this.guardPostRenderer?.update(delta)
      this.decorRenderer?.update()
      this.bloodSplatRenderer?.update()
      this.hazardRenderer?.update()
      // Persistent ability VFX (plunder brand over marked heroes) so the VFX
      // Lab can show them at night; inert otherwise (no marks exist at night).
      if (this._vfxLabActive) this.plunderMarkRenderer?.update()
      // Drive the lab's day-combat ability ticks (reassemble revival, DoTs,
      // plunder bleed) — the real AISystem.update loop is idle at night, so
      // without this the lab can't exercise time-based / death-triggered kit.
      if (this._vfxLabActive) this._vfxLab?.tick(delta)
      this.replayGhostRenderer?.update()
    }
    // Knowledge overlay updates in both phases — the rumour pool persists
    // across days, so the player can review what the next adventurers will
    // already know while building at night.
    this.knowledgeOverlay?.update()

    // MiniMap update runs on its own scene now (HudScene).
  }

  _getDayTimeScale() {
    const day = this.scene.get('DayPhase')
    if (!day || !this.scene.isActive('DayPhase')) return 0
    return day._timeScale ?? 1
  }

  // Hit-stop ("impact freeze") — briefly near-freezes the day simulation so a
  // heavy blow LANDS before the action resumes. Implemented as a multiplier on
  // the day-sim time scale (NOT scene.time.timeScale) so it NEVER clobbers the
  // 2×/4×/8× fast-forward the player picked: when the window lapses the sim is
  // back at the chosen speed with no restore-to-1 bug. Renderers, sprite anims,
  // particles and the camera keep running (they tick outside this scale), which
  // is exactly what gives the "frozen pose, world still alive" hit-stop feel.
  // Driven off REAL wall-clock so a scaled/frozen clock can't strand it;
  // overlapping requests extend the window (max), never stack or race.
  hitStop(ms = 70) {
    if (!(ms > 0)) return
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    this._hitStopUntil = Math.max(this._hitStopUntil ?? 0, now + ms)
  }

  _hitStopFactor() {
    if (!this._hitStopUntil) return 1
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    if (now >= this._hitStopUntil) { this._hitStopUntil = 0; return 1 }
    return Balance.VFX_HITSTOP_FACTOR ?? 0.04
  }
}
